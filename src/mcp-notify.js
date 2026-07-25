/**
 * Pure helpers + in-process registry for the MCP `onComplete: 'mcp-notify'`
 * input (spec §5.3, Task 15).
 * @module mcp-notify
 *
 * Security property (THE defining property of this module): exec is
 * deliberately NOT exposed over MCP. A shell-exec tool input would be a
 * prompt-injection amplifier — an MCP client acting on untrusted content
 * could make amicus run arbitrary shell commands. So onComplete over MCP
 * accepts ONLY 'mcp-notify'; any other value (especially a command string)
 * is a validation error. Nothing is ever spawned/exec'd from this module or
 * from the MCP path that consumes it — it only ever sends a notification.
 *
 * Delivery seam: amicus_fanout/amicus_council_run spawn a DETACHED CLI child
 * and return 'running' immediately — there is no in-process finalize to
 * notify from. Instead, a run that requested notify is marked here (mirrors
 * mcp-wait.js's `_inProcessRuns` in-process Map), and the ONE place that
 * later sees the run reach terminal state — the `runWait` poll loop in
 * mcp-wait.js — consumes the mark and sends the notification. Advisory/
 * best-effort throughout: a send failure never changes the run outcome.
 */

'use strict';

/** MCP onComplete accepts ONLY 'mcp-notify' — exec is deliberately not exposed
 *  over MCP (a shell-exec tool input would be a prompt-injection amplifier). */
function validateOnComplete(value) {
  if (value === undefined || value === null) { return { ok: true, mode: null }; }
  if (value === 'mcp-notify') { return { ok: true, mode: 'mcp-notify' }; }
  return { ok: false, error: 'onComplete over MCP supports only \'mcp-notify\'; exec commands are not accepted over MCP.' };
}

/** Wrap a terminal event doc as an MCP logging notification payload. */
function buildNotifyPayload(terminalEvent) {
  return { level: 'info', logger: 'amicus', data: terminalEvent };
}

/** taskId/runId -> true, for runs (owned by THIS MCP server process) that
 *  requested a best-effort mcp-notify on terminal. */
const _notifyRequests = new Map();

/** Mark a run for a best-effort terminal notify (called once the run's id is known and launch succeeded). */
function requestMcpNotify(taskId) {
  _notifyRequests.set(taskId, true);
}

/** Once-semantics: true + delete on first read for a requested id; false (no-op) otherwise,
 *  including on a second call — so a re-wait on an already-terminal run never double-sends. */
function consumeMcpNotify(taskId) {
  if (_notifyRequests.has(taskId)) { _notifyRequests.delete(taskId); return true; }
  return false;
}

module.exports = { validateOnComplete, buildNotifyPayload, requestMcpNotify, consumeMcpNotify };
