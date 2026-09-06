// src/sidecar/conversation-mirror.js
'use strict';

/**
 * @module conversation-mirror
 * Pure transform of an OpenCode getMessages() snapshot into conversation.jsonl
 * append-lines + progress.json updates. Extracted from the headless poll loop so
 * the interactive GUI path can mirror the same way (WS-4 #7). No I/O, no clock
 * except the injectable `now`.
 */

// Bound the unbounded toolCalls accumulator (BL-4). This array holds {id,name,input}
// objects whose `input` can be large; it is the only mirror-state member that grows
// per tool call with no natural bound and carries heavy payloads. Keep the most recent
// N, dropping the oldest. Dedup identity lives in the separate seenToolCallIds Set so
// dropping an old array entry never causes a re-append or a spurious toolCalls.length
// bump in the headless idle detector.
const MAX_TOOL_CALLS = 2000;

const toolPart = require('./tool-part');
const { isToolPart, toolPartName, toolPartInput, toolPartStatus, isToolPartSettled } = toolPart;

/** Fresh cursor for a session's mirror. */
function createMirrorState() {
  return {
    seenTextParts: new Map(),   // partId -> last captured text length
    toolCalls: [],              // [{id,name,input}] — capped at MAX_TOOL_CALLS (most-recent-N)
    seenToolCallIds: new Set(), // stable dedup identity for tool calls (survives the cap)
    seenToolResultIds: new Set(),
    settledToolCallIds: new Set(), // ids that reached a TERMINAL state.status (v4.4 B4 part 1)
    pendingToolCalls: new Map(), // id -> {id,name,firstSeenAt} — tool call not yet TERMINAL (B53/B4)
    receivingReported: false,
    output: '',                 // accumulated assistant text
    seenReasoningParts: new Map(), // partId -> last captured reasoning length
    reasoningOutput: '',        // accumulated reasoning text (promoted to output only if no text part arrives)
    usageByMsg: new Map(),      // msgId -> {tokens, cost}
    // #218 PR 3: the LAST assistant message's `finish` (the engine stamps it at
    // finalization, beside tokens/cost) and whether `output` was promoted from
    // reasoning parts -- together the death test in utils/output-length.js.
    lastAssistantFinish: null,
    promotedReasoning: false,
  };
}

/**
 * Capture one assistant message's usage snapshot AND its finish into the state.
 * The poll loop re-reads ALL messages every poll, so the latest snapshot per
 * message id wins (keyed Map, never additive) — see pricing.sumPerMessageUsage.
 * @returns {boolean} true when this message carried a usage payload
 */
function captureMsgUsage(msg, state) {
  // #218 PR 3: `finish` is stamped at the same finalization as tokens/cost, so
  // both mirror passes record it here; the last assistant message in the
  // snapshot wins, and one still streaming (no finish yet) resets it to null.
  // Named mutant "NOFINISH" (tests/conversation-mirror.test.js).
  state.lastAssistantFinish = msg.info.finish ?? null;
  if (msg.info.tokens || typeof msg.info.cost === 'number') {
    state.usageByMsg.set(msg.info.id, { tokens: msg.info.tokens, cost: msg.info.cost });
    return true;
  }
  return false;
}

/**
 * USAGE-ONLY mirror pass (v4.4 B1). Captures `info.tokens`/`info.cost` from a
 * fresh getMessages() snapshot and NOTHING else — no appendLines, no
 * `state.output` growth, no progress updates, no pending-tool bookkeeping.
 *
 * This exists because the headless poll loop's fast-path exits (trailing fold
 * marker, SDK `idle`) break BEFORE OpenCode stamps usage at finalization, so a
 * bounded post-loop re-read is required to see it. Calling the full
 * mirrorMessages() there would append the already-mirrored assistant text to
 * conversation.jsonl a second time; this function cannot, because it never
 * touches seenTextParts/output at all.
 * @param {Array} messages getMessages() snapshot
 * @param {object} state from createMirrorState() (only usageByMsg is mutated)
 * @returns {number} count of messages whose usage was captured
 */
function mirrorUsageOnly(messages, state) {
  const list = Array.isArray(messages) ? messages : [];
  let captured = 0;
  for (const msg of list) {
    if (!msg || !msg.info || msg.info.role !== 'assistant') { continue; }
    if (captureMsgUsage(msg, state)) { captured += 1; }
  }
  return captured;
}

/**
 * Does EVERY assistant message in this snapshot carry a usage payload we can
 * act on — a billed cost, or genuinely observed tokens (v4.4 B1 early-break)?
 *
 * Keyed on `hasObservedTokens` rather than "tokens object exists" so an
 * all-zero placeholder block does not satisfy the predicate — that is exactly
 * the pre-finalization state the settle loop is waiting out. A legitimately
 * free local seat still reports real token counts, so it satisfies this on the
 * first re-read and never pays the full settle window.
 * @param {Array} messages
 * @returns {boolean} false when there are no assistant messages at all
 */
function allAssistantUsagePresent(messages) {
  const { hasObservedTokens } = require('../utils/pricing');
  const list = Array.isArray(messages) ? messages : [];
  const assistants = list.filter((m) => m && m.info && m.info.role === 'assistant');
  if (assistants.length === 0) { return false; }
  return assistants.every((m) => (typeof m.info.cost === 'number' && m.info.cost > 0)
    || hasObservedTokens(m.info.tokens));
}

/**
 * @param {Array} messages getMessages() snapshot
 * @param {object} state from createMirrorState() (mutated + returned)
 * @param {{now?: () => string}} [opts]
 */
function mirrorMessages(messages, state, opts = {}) {
  const now = opts.now || (() => new Date().toISOString());
  const appendLines = [];
  const progressUpdates = [];
  let currentAssistantMsgId = null;
  let assistantFinished = false;
  let sessionError = null;
  let reasoningActivity = false;
  const list = Array.isArray(messages) ? messages : [];
  const messageCount = list.length;

  for (const msg of list) {
    const role = msg.info && msg.info.role;

    // Track assistant message state
    if (role === 'assistant') {
      currentAssistantMsgId = msg.info.id;
      captureMsgUsage(msg, state);
      // Check for errors — capture for result propagation
      if (msg.info.error) {
        sessionError = (msg.info.error.data && msg.info.error.data.message)
          || msg.info.error.name || 'Unknown model error';
      }
    }

    // Only process parts from assistant messages (skip user messages)
    if (role !== 'assistant' || !msg.parts) { continue; }

    for (const part of msg.parts) {
      const partId = part.id || `${msg.info.id}:${part.type}:${msg.parts.indexOf(part)}`;

      if (part.type === 'text' && part.text) {
        const prevLen = state.seenTextParts.get(partId) || 0;
        if (part.text.length > prevLen) {
          // Append only the new portion (handles streaming growth)
          const newText = part.text.slice(prevLen);
          state.output += newText;
          state.seenTextParts.set(partId, part.text.length);
          appendLines.push({ role: 'assistant', content: newText, timestamp: now() });

          // Report 'receiving' stage on first text detection
          if (!state.receivingReported) {
            state.receivingReported = true;
            progressUpdates.push({ stage: 'receiving', extra: { messagesReceived: 1 } });
          }
        }
      } else if (isToolPart(part)) {
        // v4.4 B4 part 1: this branch runs on EVERY poll, not only first sight,
        // because a tool call's `state.status` transitions in place — that
        // transition is the only signal OpenCode gives that the call finished
        // (there is no tool_result part). Appending stays first-sight-only.
        const toolName = toolPartName(part);
        const firstSight = !state.seenToolCallIds.has(part.id);
        if (firstSight) {
          const toolCall = { id: part.id, name: toolName, input: toolPartInput(part) };
          state.seenToolCallIds.add(part.id);
          state.toolCalls.push(toolCall);
          // Bound growth: keep the most recent N tool-call payloads (BL-4). Dedup is the
          // Set above, so dropping the oldest here never causes a re-append.
          if (state.toolCalls.length > MAX_TOOL_CALLS) { state.toolCalls.shift(); }
          appendLines.push({ role: 'assistant', type: 'tool_use', toolCall, timestamp: now() });

          // Update progress on tool-call detection
          progressUpdates.push({
            stage: 'receiving',
            extra: {
              messagesReceived: state.toolCalls.length,
              latestTool: toolName || undefined,
              stageLabel: toolName ? `Calling tool: ${toolName}` : 'Executing tool call...',
            },
          });
          state.receivingReported = true;
        }
        // Pending until the status is positively observed TERMINAL. firstSeenAt
        // is captured once — never bumped while the call stays non-terminal, so
        // B53's "pending for Ns" reason string stays honest.
        if (isToolPartSettled(part)) {
          state.pendingToolCalls.delete(part.id);
          state.settledToolCallIds.add(part.id);
        } else if (!state.settledToolCallIds.has(part.id)) {
          const prior = state.pendingToolCalls.get(part.id);
          state.pendingToolCalls.set(part.id, {
            id: part.id, name: toolName,
            // undefined = legacy shape, status unknown. Kept explicitly so
            // getLiveToolCalls can tell "still running" from "no idea".
            status: toolPartStatus(part),
            firstSeenAt: prior ? prior.firstSeenAt : now(),
          });
        }
      } else if (part.type === 'tool_result') {
        // Dedup: append only on first sight (fixes latent double-log bug in headless poll loop)
        if (!state.seenToolResultIds.has(partId)) {
          state.seenToolResultIds.add(partId);
          appendLines.push({
            role: 'tool',
            type: 'tool_result',
            toolUseId: part.tool_use_id,
            isError: part.is_error || false,
            content: part.content,
            timestamp: now(),
          });
        }
        // Resolved: clear the pending entry regardless of dedup state above (a
        // result seen again for an id already cleared is a harmless no-op delete).
        if (part.tool_use_id) { state.pendingToolCalls.delete(part.tool_use_id); }
      } else if (part.type === 'reasoning' && part.text) {
        // Some providers (e.g. Gemini 3.x on the direct Google path) return the
        // answer as a reasoning part with no separate text part. Accumulate it in a
        // dedicated buffer; it is promoted to `output` at finalization ONLY when no
        // visible text part ever arrives (see below), so models that emit BOTH a
        // reasoning part and a text part are unaffected (their thinking never
        // pollutes the answer).
        const prevLen = state.seenReasoningParts.get(partId) || 0;
        if (part.text.length > prevLen) {
          state.reasoningOutput += part.text.slice(prevLen);
          state.seenReasoningParts.set(partId, part.text.length);
          reasoningActivity = true; // F6d: growth this poll = the model is thinking
        }
      }
    }
  }

  // F6d: thinking IS activity. Emit ONE progress tick per poll with reasoning
  // growth (only when no text/tool update already fired) so heartbeat/status
  // show "Thinking…" and the stall detector resets during long pre-text
  // reasoning — while a poll with NO growth still writes nothing, keeping
  // genuine-stall detection intact. OpenCode's getMessages() exposes these
  // deltas as growing part.type === 'reasoning' text.
  if (reasoningActivity && progressUpdates.length === 0) {
    const assistantCount = list.filter(m => m.info && m.info.role === 'assistant').length;
    progressUpdates.push({
      stage: 'receiving',
      extra: { messagesReceived: Math.max(assistantCount, 1), stageLabel: 'Thinking…' },
    });
    state.receivingReported = true;
  }

  // assistantFinished = true only when the LAST assistant message is complete
  // (earlier messages may finish while the model continues in new messages)
  const lastAssistant = list.filter(m => m.info && m.info.role === 'assistant').pop();
  assistantFinished = !!(lastAssistant && lastAssistant.info.time && lastAssistant.info.time.completed);

  // Reasoning-only fallback: if the assistant finished but emitted only reasoning
  // parts (no visible text), promote the reasoning text to `output` so the headless
  // completion gates fire and the answer isn't lost as "No Output". Runs once — once
  // `output` is non-empty this is skipped on subsequent polls.
  if (assistantFinished && !state.output && state.reasoningOutput) {
    state.promotedReasoning = true; // #218 PR 3: named mutant "NOPROMOTEFLAG"
    state.output = state.reasoningOutput;
    appendLines.push({ role: 'assistant', content: state.reasoningOutput, timestamp: now() });
  }

  return { appendLines, progressUpdates, state, currentAssistantMsgId, assistantFinished, sessionError, messageCount };
}

const fs = require('fs');

/**
 * Append one JSONL record to conversation.jsonl (0o600). Relocated here from
 * headless.js so BOTH the headless loop and the interactive mirror import it from
 * one place (no cross-module coupling to headless's 750-line surface).
 * @param {string} conversationPath @param {object} message
 */
function logMessage(conversationPath, message) {
  fs.appendFileSync(conversationPath, JSON.stringify(message) + '\n', { mode: 0o600 });
}

module.exports = { createMirrorState, mirrorMessages, logMessage,
  mirrorUsageOnly, allAssistantUsagePresent,
  // Re-exported from ./tool-part so callers have ONE import surface for the
  // mirror's tool-call model (that module exists separately to keep this file
  // under the 300-line size gate).
  ...toolPart };
