// src/sidecar/conversation-mirror.js
'use strict';

/**
 * @module conversation-mirror
 * Pure transform of an OpenCode getMessages() snapshot into conversation.jsonl
 * append-lines + progress.json updates. Extracted from the headless poll loop so
 * the interactive GUI path can mirror the same way (WS-4 #7). No I/O, no clock
 * except the injectable `now`.
 */

/** Fresh cursor for a session's mirror. */
function createMirrorState() {
  return {
    seenTextParts: new Map(),   // partId -> last captured text length
    toolCalls: [],              // [{id,name,input}]
    seenToolResultIds: new Set(),
    receivingReported: false,
    output: '',                 // accumulated assistant text
    usageByMsg: new Map(),      // msgId -> {tokens, cost}
  };
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
      } else if ((part.type === 'tool_use' || part.type === 'tool') && !state.toolCalls.find(t => t.id === part.id)) {
        const toolCall = { id: part.id, name: part.name, input: part.input };
        state.toolCalls.push(toolCall);
        appendLines.push({ role: 'assistant', type: 'tool_use', toolCall, timestamp: now() });

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
      }
    }
  }

  // assistantFinished = true only when the LAST assistant message is complete
  // (earlier messages may finish while the model continues in new messages)
  const lastAssistant = list.filter(m => m.info && m.info.role === 'assistant').pop();
  assistantFinished = !!(lastAssistant && lastAssistant.info.time && lastAssistant.info.time.completed);

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

module.exports = { createMirrorState, mirrorMessages, logMessage };
