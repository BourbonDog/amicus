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

/** Fresh cursor for a session's mirror. */
function createMirrorState() {
  return {
    seenTextParts: new Map(),   // partId -> last captured text length
    toolCalls: [],              // [{id,name,input}] — capped at MAX_TOOL_CALLS (most-recent-N)
    seenToolCallIds: new Set(), // stable dedup identity for tool calls (survives the cap)
    seenToolResultIds: new Set(),
    pendingToolCalls: new Map(), // id -> {id,name,firstSeenAt} — tool_use with no tool_result yet (B53)
    receivingReported: false,
    output: '',                 // accumulated assistant text
    seenReasoningParts: new Map(), // partId -> last captured reasoning length
    reasoningOutput: '',        // accumulated reasoning text (promoted to output only if no text part arrives)
    usageByMsg: new Map(),      // msgId -> {tokens, cost}
  };
}

/**
 * Unresolved tool calls: tool_use ids seen with no matching tool_result yet
 * (matched by `part.tool_use_id`). Used by the headless poll loop's stall
 * detector (B53) to fail fast on a wedged tool call instead of burning the
 * full timeout. Returns a fresh array each call; `state.pendingToolCalls`
 * is the live source of truth.
 * @param {object} state from createMirrorState()
 * @returns {Array<{id:string,name:string,firstSeenAt:string}>}
 */
function getPendingToolCalls(state) {
  return Array.from(state.pendingToolCalls.values());
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
      if (msg.info.tokens || typeof msg.info.cost === 'number') {
        state.usageByMsg.set(msg.info.id, { tokens: msg.info.tokens, cost: msg.info.cost });
      }
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
      } else if ((part.type === 'tool_use' || part.type === 'tool') && !state.seenToolCallIds.has(part.id)) {
        const toolCall = { id: part.id, name: part.name, input: part.input };
        state.seenToolCallIds.add(part.id);
        state.toolCalls.push(toolCall);
        // Bound growth: keep the most recent N tool-call payloads (BL-4). Dedup is the
        // Set above, so dropping the oldest here never causes a re-append.
        if (state.toolCalls.length > MAX_TOOL_CALLS) { state.toolCalls.shift(); }
        appendLines.push({ role: 'assistant', type: 'tool_use', toolCall, timestamp: now() });

        // Track as pending until a matching tool_result arrives (B53 stall detector).
        // firstSeenAt is captured once here — never touched again for this id.
        state.pendingToolCalls.set(part.id, { id: part.id, name: part.name, firstSeenAt: now() });

        // Update progress on tool_use detection
        progressUpdates.push({
          stage: 'receiving',
          extra: {
            messagesReceived: state.toolCalls.length,
            latestTool: part.name || undefined,
            stageLabel: part.name ? `Calling tool: ${part.name}` : 'Executing tool call...',
          },
        });
        state.receivingReported = true;
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

module.exports = { createMirrorState, mirrorMessages, logMessage, getPendingToolCalls };
