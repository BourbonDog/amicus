// src/mcp-wait.js  (~115 lines, under the 300-line gate)
'use strict';

/**
 * @module mcp-wait
 * Engine for the amicus_wait MCP tool: block (inside one tool call) until a
 * session/wave reaches a terminal state or the wait window closes.
 *
 * Two wake sources, one loop:
 *  - disk polling of amicus_status (spawn-path CLI children, other-process
 *    sessions, waves), and
 *  - an in-process run registry: shared-server runs owned by THIS MCP process
 *    settle their waiter the moment finalizeHeadlessResult lands, waking the
 *    loop immediately instead of at the next poll tick.
 *
 * Client-timeout budget: the MCP TS SDK's default request timeout is 60s
 * (DEFAULT_REQUEST_TIMEOUT_MSEC in @modelcontextprotocol/sdk shared/protocol).
 * Claude Code can raise it via MCP_TOOL_TIMEOUT but we cannot assume it did,
 * so the DEFAULT wait returns {timedOut:true} at 50s — before a 60s client
 * kill — and the hard cap is 110s for clients with ~2min budgets.
 */

const { versionWarning } = require('./utils/version-info');

const DEFAULT_WAIT_MS = Number(process.env.AMICUS_WAIT_DEFAULT_MS) || 50000;
const MAX_WAIT_MS = Number(process.env.AMICUS_WAIT_MAX_MS) || 110000;
const MIN_WAIT_MS = 1000;
const WAIT_POLL_INTERVAL_MS = Number(process.env.AMICUS_WAIT_POLL_INTERVAL_MS) || 2000;

/** taskId -> {promise, resolve} for runs owned by this process. */
const _inProcessRuns = new Map();

/** Register a deferred for a run this process owns (shared-server path). */
function registerInProcessRun(taskId) {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  _inProcessRuns.set(taskId, { promise, resolve });
}

/** Settle (and forget) a run's waiter. Safe for unknown ids / double calls. */
function settleInProcessRun(taskId) {
  const w = _inProcessRuns.get(taskId);
  if (w) { _inProcessRuns.delete(taskId); w.resolve(); }
}

/** @returns {boolean} test hook */
function hasInProcessRun(taskId) { return _inProcessRuns.has(taskId); }

/** Clamp a requested timeout into [MIN, MAX]; default when absent/invalid. */
function clampTimeout(requested) {
  const n = Number(requested);
  if (!Number.isFinite(n) || n <= 0) { return Math.min(DEFAULT_WAIT_MS, MAX_WAIT_MS); }
  return Math.max(MIN_WAIT_MS, Math.min(n, MAX_WAIT_MS));
}

/** unref'd sleep so a pending wait never holds the MCP process open. */
function defaultSleep(ms) {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    if (t.unref) { t.unref(); }
  });
}

/** Parse the JSON payload out of an amicus_status result, or null. */
function parseStatusPayload(statusResult) {
  try { return JSON.parse(statusResult.content[0].text); } catch { return null; }
}

/**
 * Terminal check over a parsed amicus_status payload. Any status other than
 * running/unknown is terminal (TERMINAL_STATUSES omits 'timed-out', so an
 * allowlist would miss the canonical single-session timeout status). Waves:
 * terminal status wins; while the wave record still says 'running',
 * all-legs-terminal also counts (aggregator may still be writing wave.json,
 * but every leg has ended — the caller can read the legs).
 */
function isTerminalSnapshot(s) {
  const statusTerminal = !!s.status && s.status !== 'running' && s.status !== 'unknown';
  if (s.type === 'wave') {
    return statusTerminal
      || (Number.isFinite(s.legsTotal) && s.legsTotal > 0 && s.legsComplete >= s.legsTotal);
  }
  return statusTerminal;
}

/** Build the amicus_wait MCP result: status payload + {timedOut, waitedMs}. */
function buildWaitResult(snapshot, timedOut, waitedMs) {
  const body = { ...snapshot, timedOut, waitedMs };
  delete body.next_poll; // amicus_wait replaces the sleep-25 polling protocol
  if (timedOut) {
    body.hint = 'Run still in progress when the wait window closed. Call amicus_wait again to continue waiting.';
  }
  const content = [{ type: 'text', text: JSON.stringify(body) }];
  const warn = versionWarning();
  if (warn) { content.push({ type: 'text', text: warn }); }
  return { content };
}

/**
 * Wait for a session/wave to reach a terminal state, or time out.
 * @param {{taskId?:string, waveId?:string, timeoutMs?:number, project?:string}} input
 * @param {string} project resolved project dir
 * @param {{statusFn:Function, sleep?:Function, now?:Function, pollIntervalMs?:number}} deps
 *   statusFn(input, project) must be the amicus_status handler (or compatible).
 * @returns {Promise<object>} MCP tool result
 */
async function runWait(input, project, deps) {
  const { statusFn } = deps;
  const sleep = deps.sleep || defaultSleep;
  const now = deps.now || Date.now;
  const pollIntervalMs = deps.pollIntervalMs || WAIT_POLL_INTERVAL_MS;

  const taskId = input.taskId || input.waveId;
  if (!taskId) {
    return { isError: true, content: [{ type: 'text', text: "amicus_wait requires 'taskId' (or 'waveId')." }] };
  }

  const timeoutMs = clampTimeout(input.timeoutMs);
  const started = now();
  const deadline = started + timeoutMs;

  for (;;) {
    const statusResult = await statusFn({ taskId, project: input.project }, project);
    if (statusResult.isError) { return statusResult; } // e.g. session not found
    const snapshot = parseStatusPayload(statusResult);
    if (!snapshot) {
      return { isError: true, content: [{ type: 'text', text: `amicus_wait: unparseable status for ${taskId}.` }] };
    }
    if (isTerminalSnapshot(snapshot)) { return buildWaitResult(snapshot, false, now() - started); }
    const remaining = deadline - now();
    if (remaining <= 0) { return buildWaitResult(snapshot, true, now() - started); }
    const delay = Math.min(pollIntervalMs, remaining);
    const waiter = _inProcessRuns.get(taskId);
    // The waiter only ACCELERATES the wake — the sleep arm keeps the loop live
    // for evicted/never-settled runs (disk polling stays authoritative).
    await (waiter ? Promise.race([waiter.promise, sleep(delay)]) : sleep(delay));
  }
}

module.exports = {
  runWait, registerInProcessRun, settleInProcessRun, hasInProcessRun,
  clampTimeout, isTerminalSnapshot, parseStatusPayload, buildWaitResult,
  DEFAULT_WAIT_MS, MAX_WAIT_MS, WAIT_POLL_INTERVAL_MS,
};
