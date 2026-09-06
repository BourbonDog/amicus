/**
 * Headless Mode Runner
 *
 * Spec Reference: §6.2 Headless Mode, §9 Implementation
 * Uses OpenCode SDK for headless execution (no CLI spawning required).
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('./utils/logger');
const { ensureNodeModulesBinInPath } = require('./utils/path-setup');
const { ensurePortAvailable } = require('./utils/server-setup');
const { mapAgentToOpenCode } = require('./utils/agent-mapping');
const { writeProgress, writeTerminalProgressSafe } = require('./sidecar/progress');
const { writeFileAtomic } = require('./utils/atomic-write');
const { createMirrorState, mirrorMessages, logMessage, getPendingToolCalls,
  getLiveToolCalls, mirrorUsageOnly, allAssistantUsagePresent } = require('./sidecar/conversation-mirror');
const { buildFoldMarker, trailingFoldMarkerRegex, generateFoldNonce } = require('./utils/fold-marker');
// v4.4 (cost-council finding 3): `Number(process.env.X) || DEFAULT` cannot express
// an explicit `0`, and `0` is the DOCUMENTED disable switch for every knob below
// that uses this helper. See src/utils/env-num.js for why the older `||` knobs are
// deliberately left alone.
const { envNumber } = require('./utils/env-num');
// v4.9 W10 (#133 piece 2): the engine's own error line for a dead session.
const { engineErrorForSession } = require('./utils/engine-log');
// v4.9 W10 (#133 piece 3): the standing engine version-skew record, if any.
const { currentEngineSkew, formatSkewSuffix } = require('./utils/engine-skew');
// #202: the session-status clause on a death report (see utils/session-status.js).
const { formatSessionStatusSuffix } = require('./utils/session-status');
// v4.9 W13 Task A (PR #207 round 3, B3): the one honesty predicate every ttftMs
// emit gate shares — see src/utils/ttft.js for why `typeof` was not it.
const { isMeasuredTtft } = require('./utils/ttft');

/**
 * Fold marker that the agent outputs when done.
 * Spec Reference: §6.2
 *
 * #BL-7 residual (15b.3): the bare `[SIDECAR_FOLD]` string is now a LEGACY
 * literal only, kept exported for external consumers with no nonce context
 * (the no-nonce fallback paths were retired in v4.0 §9 — the constant is
 * export-only back-compat now).
 * NOTE for anyone `.toContain('[SIDECAR_FOLD]')`-checking real run output:
 * that substring check does NOT match the real nonced marker — a nonced
 * marker is `[SIDECAR_FOLD:<nonce>]`, which lacks the literal closing
 * bracket immediately after FOLD that `[SIDECAR_FOLD]` requires. Real runs
 * always call buildFoldMarker(nonce), never this bare constant.
 */
const FOLD_MARKER = '[SIDECAR_FOLD]';
const COMPLETE_MARKER = FOLD_MARKER; // backward compat

/**
 * #BL-7: the fold marker used to be the fixed public string [SIDECAR_FOLD]. A
 * model can legitimately emit that bare string on its own line mid-output —
 * summarizing a prior sidecar, reproducing these instructions, or from
 * scraped content — which forced a PREMATURE fold even after pinning the
 * marker to the final non-empty line (the marker being fixed and public means
 * ANY echo of it, if it happened to land last, still completed the run).
 *
 * 15b.3 closes the residual gap: every run now carries a per-run random
 * nonce, and the model is instructed to emit `[SIDECAR_FOLD:<nonce>]` — a
 * string the model can only produce by actually finishing (it isn't public,
 * isn't in training data, and isn't guessable). A bare `[SIDECAR_FOLD]` or a
 * marker carrying a DIFFERENT run's nonce no longer completes.
 *
 * @param {string} output - Accumulated assistant output
 * @param {string} nonce - This run's fold nonce (required — see runHeadless)
 * @returns {number} char index where the trailing marker line begins, or -1
 */
function findTrailingFoldMarker(output, nonce) {
  if (!output || !nonce) { return -1; }
  // The marker must be the last non-empty line: it sits alone on its line
  // (only intra-line whitespace around it) and NOTHING but whitespace follows
  // to the end of the string. The `(?![\s\S]*\S)` lookahead pins it to the true
  // end — a marker followed by more prose is echoed content, not a signal.
  const m = trailingFoldMarkerRegex(nonce).exec(output);
  return m ? m.index : -1;
}

/**
 * Default timeout: 15 minutes per spec §6.2
 */
const DEFAULT_TIMEOUT = 15 * 60 * 1000;

/** Poll cadence + completion thresholds (env-overridable; injectable via options for tests). */
const POLL_INTERVAL_MS = Number(process.env.AMICUS_POLL_INTERVAL_MS) || 2000;
const STABLE_FINISHED_POLLS = Number(process.env.AMICUS_STABLE_FINISHED_POLLS) || 2;   // when time.completed is set
const STABLE_IDLE_POLLS = Number(process.env.AMICUS_STABLE_IDLE_POLLS) || 30;          // ~60s at 2s — no completion signal
const POLL_CALL_TIMEOUT_MS = Number(process.env.AMICUS_POLL_CALL_TIMEOUT_MS) || 30000; // per getMessages call (used by a later task)
const MAX_CONSECUTIVE_POLL_FAILURES = Number(process.env.AMICUS_MAX_CONSECUTIVE_POLL_FAILURES) || 15; // ≈30s at 2s polls
// B53: wedged tool call w/ no progress.
// ⚠️ 180000 -> 300000 (#219, council glm minor). 180 s was condemned by this
// file's OWN measurement — the 190.6 s `task` call recorded below, taken on a
// developer machine, not on CI. #202 widened only the CI override and left every
// local and library consumer on the number the evidence had already disproved.
// 300000 matches the sibling constant that same measurement set (USAGE/settle
// deferral below), so one measurement now governs both windows it bears on.
const TOOL_CALL_STALL_MS = Number(process.env.AMICUS_TOOL_CALL_STALL_MS) || 300000;
// #202: budget for the ONE session-status read on a death report. Short on
// purpose — this runs on a leg already known to be dying, so the report must not
// wait on the same engine that just failed to produce anything.
const STATUS_PROBE_MS = 5000;
/**
 * v4.4 B1 — bounded post-loop usage reconciliation. The fold-marker (:~540) and
 * SDK-idle (:~568) fast paths break WITHOUT requiring `info.time.completed`, but
 * OpenCode stamps `info.tokens`/`info.cost` at message finalization — so those
 * exits can win the race against the provider's usage payload and report a leg
 * as free. Measured on real paid legs: $0.00759441096 lost by 155 ms and
 * $0.00690565716 by 29 ms. 3 × 400 ms bounds the worst case at ~1.2 s of extra
 * wall time on a leg that already finished, and the loop breaks early the moment
 * every assistant message carries usage (the common case: one extra read).
 * Set AMICUS_USAGE_SETTLE_POLLS to 0 to disable the re-poll entirely.
 */
const USAGE_SETTLE_POLLS = envNumber('AMICUS_USAGE_SETTLE_POLLS', 3);
const USAGE_SETTLE_INTERVAL_MS = envNumber('AMICUS_USAGE_SETTLE_INTERVAL_MS', 400);
/** Deliberately much tighter than POLL_CALL_TIMEOUT_MS: the leg is already
 *  finished, so a hung settle read must not add 30 s × 3 to a run's wall time.
 *  0 means "no extra timer" (withTimeout passes the promise through untouched). */
const USAGE_SETTLE_CALL_TIMEOUT_MS = envNumber('AMICUS_USAGE_SETTLE_CALL_TIMEOUT_MS', 5000);
/**
 * v4.4 B4 part 1 — how long a completion signal may be DEFERRED while a tool
 * call has not yet reached a terminal `state.status`.
 *
 * THE DEFECT THIS BOUNDS. `council-wsgate02/wsgate02-s1-3` was declared
 * `complete` by the STABLE_IDLE_POLLS gate at 04:36:09.700 on **166 characters**
 * of reasoning preamble, while its `task` tool call ran until 04:38:19.061 —
 * 129 s later — and its session went on to bill $0.14279 of parent spend plus a
 * $0.47105 child session. 166 characters were adjudicated as a peer review.
 *
 * WHY IT MUST BE BOUNDED. 9 of the 1,307 tool parts persisted in this machine's
 * OpenCode database are stuck non-terminal forever: `time_updated` within
 * milliseconds of `time_created`, all from killed sessions that never wrote a
 * terminal status. A stale `running` can therefore outlive everything, so an
 * unbounded wait is not an option.
 *
 * WHY 5 MINUTES. The measured duration of the real subagent call that exposed
 * this is **190.6 s** (`task`, 04:35:08.427 → 04:38:19.061) — which was longer
 * than B53's THEN-180 s TOOL_CALL_STALL_MS, so anything at that scale would kill
 * a healthy `task` leg 10 s short of its answer. (#219 finally moved B53 itself
 * to 300 s for this exact reason; for four releases this measurement corrected
 * the neighbour and left its own subject alone.) 300 s clears the measured case
 * with margin and still lands far inside the 15-minute default `--timeout`.
 * Set to 0 to disable the deferral entirely (pre-v4.4 behaviour).
 *
 * ON EXCEEDING IT the leg COMPLETES anyway — never fails — carrying
 * `toolSettleTimedOut` on the result, the terminal progress record and the
 * error log channel. Owner's standing ruling: fail LOUD, not fail CLOSED.
 *
 * v4.4.1 LC-2 (owner ruling, 2026-07-26): the leg's completion and its partial
 * output are unchanged, but its OpenCode session is now ABORTED at the ceiling
 * (see the finalization block) so it stops billing for work nobody will read.
 */
const TOOL_SETTLE_GRACE_MS = envNumber('AMICUS_TOOL_SETTLE_GRACE_MS', 300000);
/**
 * v4.4.1 LC-2 — how long the ceiling's abort call may take before we stop
 * waiting on it. A hard constant rather than an env knob (the same disposition
 * as src/sidecar/child-sessions.js's bounds): it exists to stop a pathological
 * hang, not to be tuned. The leg is already complete and already paid for when
 * this runs, so an unbounded wait here would hold a finished answer hostage to a
 * best-effort cost optimization — exactly the trade A-8 forbids. Injectable via
 * `options.toolSettleAbortTimeoutMs` so the bound itself is testable.
 */
const TOOL_SETTLE_ABORT_TIMEOUT_MS = 5000;

/**
 * Race a promise against a timeout. Returns the promise's result, or rejects with
 * a timeout error after `ms`. A non-positive `ms` means "no extra timer" (return as-is).
 */
function withTimeout(promise, ms, label) {
  if (!(ms > 0)) { return promise; }
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      if (t.unref) { t.unref(); }
    }),
  ]);
}

/**
 * Task 6 (#129, #133): build the NO_OUTPUT_BACKSTOP reason string. Report
 * ONLY what the mechanism observed — a deadline passed with no substantive
 * activity (output/reasoning/tool calls) — never a cause. At the pre-send
 * firing site (runHeadless, where the backstop is armed just before
 * `sendPromptAsync`) the backstop can win the race against
 * sendPromptAsync before the send ever resolves, so "the endpoint accepted
 * the request" is not even something that site observed. The previous text
 * asserted "likely a listed-but-not-serving model or a dead endpoint" — a
 * canned guess with no evidence gate — which sent 30 minutes of #133's
 * debugging at model ids and API keys while the real cause (an opencode
 * engine version skew) sat in the engine's own log the whole time.
 *
 * v4.9 W10 (#133 piece 2): that log is now READ. When
 * src/utils/engine-log.js finds an ERROR line for this leg's session,
 * `engineLogExcerpt` carries it and ` — engine log: <excerpt>` is appended
 * AFTER the whole sentence below — so the `NO_OUTPUT_BACKSTOP:` prefix that
 * src/sidecar/models-probe.js classifies on stays byte-stable, and on every
 * miss path (no dir, no file, no session match, no ERROR line) the excerpt
 * clause is absent — a standing skew still appends its own clause, see below. NOTE the path this comment used to
 * name (a single `opencode/log/opencode.log`) was already stale when it was
 * written: the engine now writes one timestamped file per process, and both
 * schemes are live on real machines — engine-log.js's header records the
 * measurement and reads both.
 *
 * `fromEnv` distinguishes two ways `ms` was decided, NOT whether
 * AMICUS_NO_OUTPUT_BACKSTOP_MS is relevant — it is relevant on both branches:
 *   - fromEnv=true: `ms` IS the live env-resolved value (or its documented
 *     default) — the message says so directly, "(0 disables)" included,
 *     because raising the env var changes exactly this window.
 *   - fromEnv=false: `ms` arrived as a direct, caller-set numeric option.
 *     Task 6 review (Important finding): this is NOT synonymous with "the
 *     env var doesn't apply" — `run-retry.js :: retryStage1Losses`'s
 *     `escalatedBackstopMs` computes a Stage-1 retry's window as
 *     `2 * (Number.isFinite(o.noOutputBackstopMs) ? o.noOutputBackstopMs :
 *     resolveNoOutputBackstopMs())` and forwards it on `common` as a direct
 *     `noOutputBackstopMs` — so a 600s retry-fired backstop (the 300s env
 *     default, doubled) is "caller-set" by this predicate while still being
 *     *derived from* the env default. Only src/sidecar/models-probe.js:79's hardcoded,
 *     non-tunable 30s (PROBE_WINDOW_MS; docs/usage.md:406 promises it's "not
 *     tunable") is truly independent of the env var. Because a real
 *     `fromEnv` flag distinguishing those two cases would have to ride the
 *     same value through src/sidecar/fanout.js, which is line-locked at
 *     EXACTLY 300/300 this release, the caller-set branch instead names the
 *     var as something this window *overrides* rather than either claiming
 *     it governs (false on the probe) or omitting it (false/unhelpful on the
 *     retry) — true on both, and still points a user at the remedy.
 *
 * v4.9 W10 (#133 piece 3): `engineSkew` adds a SECOND, independent clause —
 * the two engine versions, when src/utils/engine-skew.js has a skew standing
 * for THIS leg's own server (the caller reads the record by client; see the
 * firing-site comment in runHeadless). It is
 * deliberately NOT gated on `engineLogExcerpt`: gating it would make the
 * reliable signal (two version strings both sides already publish) depend on
 * the unreliable one (a log file that may be absent or rotated), and in #133
 * the skew WAS the answer. Both clauses are append-only, so with neither the
 * string is byte-for-byte what it was before either piece existed.
 *
 * Kept module-scope and pure (not a closure over runHeadless locals) so it
 * can be asserted on directly in tests without driving the poll loop; the
 * `noOutputBackstopReason` closure inside runHeadless just forwards to this
 * with the per-run `noOutputBackstopMs`/`backstopFromEnv`/engine-log/skew
 * values, so the two firing sites there stay identical to what's tested here.
 * @param {{ms: number, fromEnv: boolean, engineLogExcerpt?: string|null,
 *          engineSkew?: {server: string, installed: string}|null}} args
 * @returns {string}
 */
function formatNoOutputBackstopReason({ ms, fromEnv, engineLogExcerpt, engineSkew, sessionStatus }) {
  const observed = 'NO_OUTPUT_BACKSTOP: no output, reasoning, or tool calls in '
    + `${Math.round(ms / 1000)}s — `
    + (fromEnv
      ? 'the AMICUS_NO_OUTPUT_BACKSTOP_MS window (0 disables)'
      : 'a caller-set window overriding the AMICUS_NO_OUTPUT_BACKSTOP_MS default');
  // Append-only: absent/empty excerpt ⇒ the string above, unchanged byte for byte.
  const quoted = engineLogExcerpt ? `${observed} — engine log: ${engineLogExcerpt}` : observed;
  // Append-only for the same reason: no skew ⇒ formatSkewSuffix returns ''.
  // #202 adds a THIRD clause on the same terms, and LAST so both clauses above
  // stay byte-stable: no status (or an unreadable one) ⇒ '' — see
  // utils/session-status.js. With none of the three the string is byte-for-byte
  // what it was before any of them existed.
  return `${quoted}${formatSkewSuffix(engineSkew)}${formatSessionStatusSuffix(sessionStatus)}`;
}

/**
 * #218 PR 3: the budget for the OUTPUT_LENGTH reason string. The engine's own
 * handle carries the value it was spawned with (opencode-client.js ::
 * startServer, council #232 r1 B3) and wins; config is read only for a handle
 * from outside amicus (a test seam or an older caller), and `undefined` when
 * that read fails -- the string then says so rather than claiming "unset".
 * `read` is a test seam (options._readOutputBudget).
 * @param {{outputBudget?: number|null}} [server] the leg's server handle
 * @param {() => (number|null)} [read]
 * @returns {number|null|undefined}
 */
function readOutputBudgetSafe(server, read) {
  if (server && Object.prototype.hasOwnProperty.call(server, 'outputBudget')) { return server.outputBudget; }
  try { return (read || require('./utils/config').getOutputBudget)(); } catch { return undefined; }
}

/**
 * v4.9 W10 (#133 piece 2): the engine-log lookup, wrapped so it can never
 * become the failure it reports on. The resolver is already best-effort
 * internally; this second belt is at the CALL site because the caller is a
 * leg's death report — the one place where an extra exception would replace a
 * usable failure reason with a stack trace. Missing sessionId ⇒ skip entirely.
 * @param {string|undefined} sessionId
 * @param {object|undefined} engineLogOptions - test seam (options._engineLog)
 * @returns {string|null}
 */
function engineErrorExcerptSafe(sessionId, engineLogOptions) {
  if (!sessionId) { return null; }
  try {
    return engineErrorForSession(sessionId, engineLogOptions || {});
  } catch (_e) {
    return null;
  }
}

/**
 * #202: read the engine's session status FOR A DEATH REPORT — best-effort and
 * bounded, with the same "never become the failure it reports on" discipline as
 * `engineErrorExcerptSafe` above, and one more constraint that read does not
 * have: this one does I/O against the very engine that just failed to produce
 * anything, so it must also be unable to HANG. Both belts are load-bearing and
 * both are pinned (S-W4 rejects, S-W5 hangs).
 *
 * A failed probe returns `null`, which `formatSessionStatusSuffix` renders as
 * '' — so a leg whose status could not be read carries the byte-for-byte reason
 * string it carried before #202, rather than a clause claiming nothing was
 * happening. Absence keeps its one meaning.
 *
 * `readStatus` is a parameter rather than a module import because
 * `getSessionStatus` is destructured inside runHeadless from the injectable
 * client module — taking it here keeps this helper pure and directly testable.
 * @returns {Promise<object|null>}
 */
async function sessionStatusSafe(readStatus, client, sessionId, dirArgs, ms) {
  // `!(ms > 0)` covers 0 (the documented disable), negatives and NaN — and it is
  // why 0 is never handed to withTimeout, which would read it as UNBOUNDED.
  if (typeof readStatus !== 'function' || !sessionId || !(ms > 0)) { return null; }
  try {
    return await withTimeout(
      readStatus(client, sessionId, ...(dirArgs || [])), ms, 'getSessionStatus(death-report)');
  } catch (err) {
    // #219 (council, deepseek minor): returning null is right for the REPORT —
    // absence keeps its one meaning — but it made a probe that timed out on a
    // loaded engine indistinguishable from a leg whose engine reported nothing,
    // i.e. a silent revert to pre-#202 behaviour. The engine log is where that
    // belongs: the death report stays byte-identical, and the degradation
    // becomes diagnosable instead of invisible.
    logger.debug('session-status probe failed; the death report will carry no session clause', {
      sessionId, error: err && err.message,
    });
    return null;
  }
}

/**
 * Wait for the OpenCode server to be ready using SDK health check
 */
async function waitForServer(client, checkHealthFn, maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const isHealthy = await checkHealthFn(client);
      if (isHealthy) {
        return true;
      }
    } catch (e) {
      // Server not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return false;
}

/**
 * Run a headless sidecar session
 * Spec Reference: §6.2, §9.1 runHeadless function
 *
 * @param {string} model - Model to use (e.g., 'openrouter/google/gemini-2.5-flash')
 * @param {string} systemPrompt - The system prompt for the agent (instruction-level context)
 * @param {string} userMessage - The user message (task briefing)
 * @param {string} taskId - Unique task identifier
 * @param {string} project - Project directory path
 * @param {number} [timeoutMs=DEFAULT_TIMEOUT] - Timeout in milliseconds
 * @param {string} [agent] - Agent mode: build (default), plan, explore, general
 * @param {object} [options] - Additional options
 * @param {object} [options.mcp] - MCP server configurations
 * @param {string} [options.summaryLength='normal'] - Desired summary length
 * @param {object} [options.reasoning] - Reasoning/thinking configuration
 * @param {string} [options.reasoning.effort] - Effort level: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'none'
 * @param {string} [options.nonce] - Per-run fold nonce (15b.3, #BL-7 residual). The
 *   PROMPT the caller built (prompt-builder.js buildPrompts) must have instructed the
 *   model with this SAME nonce — runHeadless only DETECTS, it never re-derives one from
 *   the prompt text, so caller and detector agreeing on the nonce is the caller's
 *   responsibility. Falls back to a freshly generated nonce if omitted (keeps this
 *   function usable standalone / in tests that don't care about the fold-nonce
 *   property) — but a fallback nonce the prompt never advertised means the model can
 *   never legitimately produce it, so such a run can only ever complete via one of the
 *   non-fold-marker paths (idle/timeout/etc.), never a premature bare-marker fold.
 * @returns {Promise<object>} Result object with summary, completed, timedOut flags
 */
async function runHeadless(model, systemPrompt, userMessage, taskId, project, timeoutMs = DEFAULT_TIMEOUT, agent, options = {}) {
  const {
    createSession,
    sendPromptAsync,
    getMessages,
    checkHealth,
    startServer,
    getSessionStatus
  } = require('./opencode-client');

  const { reasoning } = options;
  // 15b.3: never fall back to bare-marker detection — an omitted nonce still
  // gets ONE generated here so findTrailingFoldMarker always has something to
  // match, but since the prompt (built by the caller) never advertised THIS
  // fallback value, the model cannot legitimately produce it. No silent
  // bare-`[SIDECAR_FOLD]` acceptance path exists anywhere below.
  const foldNonce = options.nonce || generateFoldNonce();
  const { getSessionDir } = require('./session-manager');
  const sessionDir = getSessionDir(project, taskId);
  const conversationPath = path.join(sessionDir, 'conversation.jsonl');

  // #47: scope every per-session SDK call to the project directory so a SHARED
  // OpenCode server (one server, many projects) files and finds this session
  // under the right ?directory=. `dirArgs` is the trailing arg list for the
  // positional client wrappers (createSession/getMessages/getSessionStatus/
  // abortSession) and is EMPTY when no directory is supplied — so the un-scoped
  // (owned-server) call shape stays byte-for-byte identical. A scoped create
  // with un-scoped follow-ups reproduces the identical "session not found"
  // failure, so ALL of them must carry it.
  const { directory } = options;
  const dirArgs = directory === undefined ? [] : [directory];

  // Ensure session directory exists
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true, mode: 0o700 });
  }

  // Log system prompt as first message in conversation
  logMessage(conversationPath, {
    role: 'system',
    content: systemPrompt,
    timestamp: new Date().toISOString()
  });

  // Write initial progress
  writeProgress(sessionDir, 'initializing');

  // Ensure node_modules/.bin is in PATH so SDK can find opencode wrapper
  ensureNodeModulesBinInPath();

  // Use specified port, or 0 to let the OS auto-assign (enables parallel sessions)
  const port = options.port || 0;
  if (port > 0) {
    ensurePortAvailable(port);
  }

  // Detect shared-server mode: caller provides client + server directly
  const externalServer = !!(options.client && options.server);
  let client, server;

  if (externalServer) {
    client = options.client;
    server = options.server;
    logger.debug('Using external server (shared server mode)', { url: server.url });
  } else {
    // Start OpenCode server using SDK (no CLI spawning required)
    logger.debug('Starting OpenCode server via SDK', { model, hasMcp: !!options.mcp, port });
    try {
      // Pass MCP config and port to server
      const serverOptions = { port };
      if (options.mcp) {
        serverOptions.mcp = options.mcp;
      }
      // v4.5.2: explicit per-call override only — see the note at the matching
      // hop in src/sidecar/session-utils.js. The default and the env knob both
      // resolve downstream in buildServerOptions.
      if (options.timeout !== undefined) {
        serverOptions.timeout = options.timeout;
      }
      // v4.4.1 fix wave (F5): this is the OTHER server-start site. It calls
      // startServer directly rather than going through startOpenCodeServer, so
      // the lock-class retry added for the concurrent-start race never covered
      // it — a plain `amicus start` that lost the race still died on the first
      // `database is locked`. "Two separate amicus processes contending" is half
      // that retry's stated justification, and this is one of the two processes.
      // Same bounded, narrow policy: 5 attempts (Step 10.5 widened it from 3),
      // lock-class messages only, final failure rethrown unchanged into the
      // degrade path below.
      const { retryOnLockRace } = require('./utils/server-setup');
      const result = await retryOnLockRace(() => startServer(serverOptions),
        { retryDelayMs: options.retryDelayMs });
      client = result.client;
      server = result.server;
      logger.debug('Server started', { url: server.url });
    } catch (error) {
      logger.error('Failed to start OpenCode server', { error: error.message });
      // FR-1: this return predates the outer try — A3's terminal write never ran
      // for it, leaving 'initializing' on disk while metadata said 'error'.
      if (!writeTerminalProgressSafe(sessionDir, `Failed to start server: ${error.message}`)) {
        logger.debug('terminal progress write failed on server-start failure (best-effort)', { taskId });
      }
      return {
        summary: '',
        completed: false,
        timedOut: false,
        taskId,
        error: `Failed to start server: ${error.message}`
      };
    }
  }

  let sessionId;
  const { IdleWatchdog } = require('./utils/idle-watchdog');
  let watchdog;
  let uninstallSignals;
  // v4.9 W13 Task A — THE TTFT PROBE's storage. Milliseconds from the leg
  // asking for output (`outputClockStartedAt` below — the backstop's OWN clock
  // origin) to the first poll where `substantiveActivity` is true. `null` until
  // then, and EMIT-WHEN-SET from there: a leg that never produced anything
  // carries no ttftMs key on the result, on disk, or in any downstream
  // document. `0` is a real measurement (first substantive tick inside the
  // first poll), which is why the absence is a missing key rather than a falsy
  // value.
  //
  // ⚠️ Declared HERE, beside `sessionId`/`watchdog`, and NOT inside the try
  // below (PR #203 council round 1, finding A2). It used to live in the poll
  // loop's scope, so it was not even in scope at the catch-all return: a leg
  // that streamed real output and then threw discarded its own measurement.
  // Same shape as `sessionId`, for the same reason — the outer handler is a
  // return path like any other and must be able to report what was measured.
  //
  // ⚠️ PROBE ONLY — nothing derives from this number. No backstop change, no
  // threshold, no per-model window. W13 ruling R12 is explicitly "probe first,
  // derive later": the C2 derivation (per-model backstops from evidence) waits
  // for real field observations, which cannot exist until this ships. Do not
  // wire it into a decision without that evidence — and read the RESIDUAL
  // CENSORING note on the stamp site in the poll loop before you do.
  let ttftMs = null;

  try {
    if (!externalServer) {
      // Wait for server to be ready
      logger.debug('Waiting for OpenCode server to be ready');
      const serverReady = await waitForServer(client, checkHealth);
      logger.debug('Server ready', { serverReady });
      writeProgress(sessionDir, 'server_ready');

      if (!serverReady) {
        await server.close();
        // FR-1: returns out of the outer try — the A3 catch never sees it.
        if (!writeTerminalProgressSafe(sessionDir, 'OpenCode server failed to start')) {
          logger.debug('terminal progress write failed on server-not-ready (best-effort)', { taskId });
        }
        return {
          summary: '',
          completed: false,
          timedOut: false,
          taskId,
          error: 'OpenCode server failed to start'
        };
      }
    } else {
      writeProgress(sessionDir, 'server_ready');
    }

    // Start idle watchdog to enforce the headless timeout
    if (options.watchdog) {
      watchdog = options.watchdog;
    } else {
      watchdog = new IdleWatchdog({
        mode: 'headless',
        onTimeout: () => {
          logger.info('Headless idle timeout - shutting down', { taskId });
          const { idleBackstopTeardown } = require('./utils/session-abort');
          process.exit(idleBackstopTeardown(sessionDir, server, externalServer));
        },
      }).start();
    }

    // Create a new session using SDK
    logger.debug('Creating OpenCode session');
    if (options.sessionId) {
      sessionId = options.sessionId;
      logger.debug('Using existing session', { sessionId });
    } else {
      try {
        sessionId = await createSession(client, ...dirArgs);
      } catch (error) {
        if (watchdog) { watchdog.cancel(); }
        if (!externalServer) { await server.close(); }
        // FR-1: the one path a council leg can hit under T0.5's shared server —
        // pre-fix, the Workspace showed the seat perpetually live off a
        // non-terminal 'server_ready' while metadata.json said 'error'.
        if (!writeTerminalProgressSafe(sessionDir, error.message)) {
          logger.debug('terminal progress write failed on createSession failure (best-effort)', { taskId });
        }
        return {
          summary: '',
          completed: false,
          timedOut: false,
          taskId,
          error: error.message
        };
      }
    }
    logger.debug('Session ID', { sessionId });
    writeProgress(sessionDir, 'session_created');

    // F3 #20: abort this session if the parent process is signalled. Record the
    // Go server PID so `amicus list` liveness checks can see it. Only for the
    // owned (non-shared) server — shared servers are torn down by their owner.
    if (!externalServer) {
      if (server && server.goPid) {
        try {
          const metaPath = path.join(sessionDir, 'metadata.json');
          const m = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
          m.goPid = server.goPid;
          writeFileAtomic(metaPath, JSON.stringify(m, null, 2), { mode: 0o600 });
        } catch { /* metadata optional */ }
      }
      const { installSignalAbort, markAborted } = require('./utils/session-abort');
      let aborting = false;
      uninstallSignals = installSignalAbort({
        onAbort: (signal) => {
          if (aborting) { return; }
          aborting = true;
          logger.warn('Signal received — aborting headless session', { taskId, signal });
          markAborted(sessionDir, signal);
          try {
            const { abortSession } = require('./opencode-client');
            abortSession(client, sessionId, ...dirArgs).catch(() => {});
          } catch { /* best-effort */ }
          // close() is now async (B06 escalation) — this handler stays sync
          // (do not restructure signal handlers), so fire-and-forget with a
          // rejection guard. The REF'd escalation poll inside close() still
          // does its work; the pre-existing 300ms exit timer below may cut
          // that grace short — see task 15b.1 report for that known gap.
          try { server.close().catch(() => {}); } catch { /* best-effort */ }
          const { resolveTerminalState } = require('./sidecar/session-finalize');
          const code = resolveTerminalState({ aborted: true }, signal).exitCode;
          const t = setTimeout(() => process.exit(code), 300);
          if (t.unref) { t.unref(); }
        },
      });
    }

    // Log user message to conversation before sending
    logMessage(conversationPath, {
      role: 'user',
      content: userMessage,
      timestamp: new Date().toISOString()
    });

    // Send system prompt and user message using SDK
    logger.debug('Sending message to OpenCode', {
      sessionId,
      systemLength: systemPrompt.length,
      userMessageLength: userMessage.length
    });

    const promptOptions = {
      model: model,
      system: systemPrompt,
      parts: [{ type: 'text', text: userMessage }]
    };
    // #47: scope the prompt to the project on a shared server. Only set when a
    // directory was supplied so the owned-server options object is unchanged.
    if (directory !== undefined) { promptOptions.directory = directory; }

    // Default to 'build' in headless mode — 'chat' stalls without user interaction
    const agentConfig = mapAgentToOpenCode(agent || 'build');
    promptOptions.agent = agentConfig.agent;

    // Add reasoning/thinking configuration if provided
    if (reasoning) {
      promptOptions.reasoning = reasoning;
    }

    // v4.6.2 PR2 amendment (controller live smoke, field evidence): arm BEFORE
    // the prompt send, not after. OpenCode's prompt-send handler can itself
    // block on the upstream provider call before ever returning — a silently-
    // accepting endpoint (the v4.6.1 gemini class) hung the very next line's
    // await for 6+ minutes with the backstop never even created yet, upstream
    // of every mechanism that was supposed to catch it. `startedAt` here means
    // "time since the leg asked for output". Disarmed permanently by the first
    // SUBSTANTIVE-activity tick in the poll loop below (output/tool/result/
    // reasoning/settle — NOT the placeholder-compatible message/assistant-id
    // signals; see substantiveActivity); 0 (or negative) disables — the
    // send itself is unbounded in that case too (see withTimeout below).
    const { resolveNoOutputBackstopMs, createNoOutputBackstop } = require('./utils/no-output-backstop');
    // v4.6.2 PR3 Task 1: Number.isFinite, not `!== undefined` — a non-number
    // (e.g. a string arriving from a CLI/JSON boundary) must fall through to
    // env resolution instead of reaching the deadline arithmetic below.
    // `startedAt + ms` string-concatenates when ms is a string, producing a
    // deadline `nowMs >= deadline` can never satisfy — the backstop would
    // silently never fire. Finite zero (the documented explicit-disable
    // value) still takes the direct branch: Number.isFinite(0) === true.
    // Capture the source-of-truth predicate ONCE and reuse it (do not call
    // Number.isFinite a second time below) — `backstopFromEnv` is just its
    // complement: options.noOutputBackstopMs is a direct, caller-set value
    // exactly when Number.isFinite is true, so the window came from
    // resolveNoOutputBackstopMs's env-resolution seam exactly when it's false.
    // Reused both to pick noOutputBackstopMs and to decide whether the reason
    // string below may name the env var, so the two can never drift apart.
    const backstopFromEnv = !Number.isFinite(options.noOutputBackstopMs);
    const noOutputBackstopMs = backstopFromEnv
      ? resolveNoOutputBackstopMs(options._env) : options.noOutputBackstopMs;
    // v4.9 W13 Task A: ONE clock origin, captured once and shared with the
    // backstop instead of a second `Date.now()`. `startedAt` here already means
    // "time since the leg asked for output" (see the block comment above), so
    // the TTFT probe below measures from exactly the instant the backstop
    // starts counting — the two can never disagree about when the wait began.
    // #202: resolved HERE, not with the poll-loop options below. The pre-send
    // firing site calls noOutputBackstopReason() upstream of that block, so a
    // later `const` put this in its TDZ and the death report became
    // "Cannot access 'statusProbeMs' before initialization" — the exact class of
    // silent-diagnosis loss #202 exists to remove. Pinned by S-W6.
    // ⚠️ `=== undefined`, not `||` (#219 round 2, deepseek): 0 is a meaningful
    // value in this codebase's convention (usageSettlePolls,
    // AMICUS_NO_OUTPUT_BACKSTOP_MS) and must survive injection. It cannot be
    // FORWARDED as 0 though — withTimeout reads `ms <= 0` as NO timeout, so an
    // honest-looking 0 would make this probe unbounded on a leg already known to
    // be dying. sessionStatusSafe therefore SKIPS on a non-positive window.
    const statusProbeMs = options.statusProbeMs === undefined
      ? STATUS_PROBE_MS : options.statusProbeMs;
    const outputClockStartedAt = Date.now();
    const noOutputBackstop = createNoOutputBackstop({ ms: noOutputBackstopMs, startedAt: outputClockStartedAt });
    let backstopFired = false;
    // Single source for the reason string so the pre-send firing site below and
    // the per-poll firing site further down (still ticking the SAME instance)
    // can never drift apart. Forwards to the module-scope, pure
    // formatNoOutputBackstopReason (below/exported) so tests can assert on the
    // string shape directly without driving the whole poll loop.
    //
    // v4.9 W10 (#133 piece 2): the engine-log excerpt is resolved HERE, in the
    // one shared closure, rather than separately at each firing site — the
    // enrichment then reaches BOTH sites by construction, which is the same
    // no-drift argument that put the reason string here in the first place.
    // Resolved at CALL time (not once when this closure is defined) so the
    // engine has already written the line by the time we read it, and so the
    // read never happens on a leg that lives.
    //
    // v4.9 W10 (#133 piece 3): the skew record is read at call time for the
    // same reason — `createSession` above is what puts it there, and on the
    // shared-server path a sibling leg on THIS server may have been the one to
    // see it. Asked for by `client`, so what comes back is THIS leg's own
    // server's standing record and never a stranger's (W10 round-1 review A3):
    // the record is per server and refreshed on every create, so a skew that
    // was fixed mid-run, or one that belongs to another server this process
    // also talks to, cannot ride out on this death report. The read is a Map
    // lookup and does no I/O, so unlike the log read it needs no guard.
    //
    // #202 (piece 4): the closure is now ASYNC, because the third clause costs
    // one bounded HTTP call. The engine's session status is asked for at
    // :~1045 only when `mirror.output.length > 0` — a gate a zero-output leg
    // never satisfies — so the leg that most needs diagnosing was the only one
    // that never asked, and every silent death reported a window with no cause.
    // Asked for HERE instead, at the two firing sites and nowhere else, so a
    // living leg still makes no extra call. The read is best-effort and
    // bounded: `sessionStatusSafe` can neither throw nor hang (S-W4/S-W5).
    const noOutputBackstopReason = async () => formatNoOutputBackstopReason({
      ms: noOutputBackstopMs, fromEnv: backstopFromEnv,
      engineLogExcerpt: engineErrorExcerptSafe(sessionId, options._engineLog),
      engineSkew: currentEngineSkew(client),
      sessionStatus: await sessionStatusSafe(getSessionStatus, client, sessionId, dirArgs, statusProbeMs),
    });

    // Send prompt asynchronously (returns immediately, we poll for results) —
    // bounded by the backstop: an endpoint that accepts but never answers must
    // not hang this await the way it hung the field-observed leg.
    logger.info('Sending prompt to OpenCode', {
      sessionId,
      model,
      agent: promptOptions.agent,
      userMessageLength: userMessage.length
    });
    const sendPromptLabel = 'sendPromptAsync';
    const sendPromptPromise = sendPromptAsync(client, sessionId, promptOptions);
    let promptResult = null;
    try {
      promptResult = await withTimeout(sendPromptPromise, noOutputBackstopMs, sendPromptLabel);
      writeProgress(sessionDir, 'prompt_sent');
      logger.info('Prompt sent successfully, entering polling loop', {
        sessionId,
        timeoutMs
      });
    } catch (sendErr) {
      const isBackstopTimeout = noOutputBackstopMs > 0
        && sendErr.message === `${sendPromptLabel} timed out after ${noOutputBackstopMs}ms`;
      if (!isBackstopTimeout) { throw sendErr; } // a genuine sendPromptAsync failure — unchanged behavior
      // The backstop deadline won the race — OpenCode never returned from the
      // prompt-send call at all; the "accepts, never responds" shape dies
      // upstream of the poll loop entirely. Swallow the orphaned promise so it
      // can never surface as an unhandled rejection whenever/if it eventually
      // settles on its own (Promise.race already subscribes each racer
      // internally, so this is defensive belt-and-suspenders, not load-bearing
      // — verified empirically before relying on it).
      sendPromptPromise.catch(() => {});
      backstopFired = true;
      logger.warn('No-output backstop fired before the prompt send resolved', {
        taskId, sessionId, backstopMs: noOutputBackstopMs,
      });
    }

    const mirror = createMirrorState();
    let completed = false;
    let timedOut = false;
    let aborted = false;
    let sessionError = null; // Captures model/SDK errors from assistant messages

    // Seed sessionError exactly like the #37 boundary-provider-error case right
    // below does, so the run ends with a usable reason (the poll loop is
    // skipped entirely on this path — see the while-condition and the
    // backstop-abort block further down).
    if (backstopFired) {
      sessionError = await noOutputBackstopReason();
    }

    // Hard provider failure detected at the client boundary (#37): a non-2xx /
    // 402 from promptAsync surfaces here even when the server never emits an
    // assistant message carrying info.error. Seed sessionError so the loop's
    // "error with no output" gate ends the run promptly with a usable reason.
    const boundaryProviderError = !!(promptResult && promptResult.providerError);
    if (boundaryProviderError) {
      sessionError = promptResult.providerError;
      logger.error('Provider error at client boundary', { taskId, sessionId, reason: sessionError });
    }

    // Poll for completion by checking messages
    const startTime = Date.now();
    const deadline = startTime + timeoutMs;
    let pollCount = 0;
    const pollIntervalMs = options.pollIntervalMs || POLL_INTERVAL_MS;
    const stableFinishedPolls = options.stableFinishedPolls || STABLE_FINISHED_POLLS;
    const stableIdlePolls = options.stableIdlePolls || STABLE_IDLE_POLLS;
    const pollCallTimeoutMs = options.pollCallTimeoutMs || POLL_CALL_TIMEOUT_MS;
    const maxConsecutivePollFailures = options.maxConsecutivePollFailures || MAX_CONSECUTIVE_POLL_FAILURES;
    const toolCallStallMs = options.toolCallStallMs || TOOL_CALL_STALL_MS;
    // `=== undefined` rather than `||`: 0 is a meaningful value (disable the
    // v4.4 B1 settle re-poll entirely) and must survive injection.
    const usageSettlePolls = options.usageSettlePolls === undefined
      ? USAGE_SETTLE_POLLS : options.usageSettlePolls;
    const usageSettleIntervalMs = options.usageSettleIntervalMs === undefined
      ? USAGE_SETTLE_INTERVAL_MS : options.usageSettleIntervalMs;
    // `=== undefined` rather than `||`: 0 is meaningful (disable the deferral).
    const toolSettleGraceMs = options.toolSettleGraceMs === undefined
      ? TOOL_SETTLE_GRACE_MS : options.toolSettleGraceMs;
    const toolSettleAbortTimeoutMs = options.toolSettleAbortTimeoutMs === undefined
      ? TOOL_SETTLE_ABORT_TIMEOUT_MS : options.toolSettleAbortTimeoutMs;
    let consecutivePollFailures = 0;
    let pollFailureBail = false;
    let lastAssistantMsgId = null;
    let lastOutputLength = 0; // Track output growth to detect streaming
    let stablePolls = 0; // Count polls where nothing has changed
    let lastToolCallCount = 0;
    let lastToolResultCount = 0;
    let lastMessageCount = 0;
    let lastReasoningLength = 0; // B53: track reasoning-output growth to detect thinking
    let lastProgressAt = Date.now(); // B53: last poll where `progressed` was true
    // v4.9 W13 Task A: `ttftMs` itself is declared at function scope (see the
    // block comment beside `sessionId`) so the catch-all return can carry it.
    let toolStalled = false; // B53: distinct from completed/timedOut/aborted — see resolveTerminalState
    let lastSettledToolCount = 0; // B4: tool calls observed reaching a terminal status

    // ---- v4.4 B4 part 1: the tool-settle deferral -----------------------------
    // Recomputed once per poll (see the loop body) so every completion gate in a
    // single poll reads ONE consistent answer.
    let liveTools = [];      // POSITIVELY 'pending'/'running' — gates completion
    let pendingTools = [];   // not-yet-terminal incl. unknown shape — feeds B53
    let toolSettleDeferredSince = null; // ms timestamp of the first deferral, or null
    let toolSettleTimedOut = false;     // the grace ceiling was exceeded
    let unsettledAtCeiling = [];        // what was still live when it was exceeded
    let toolSettleAborted = false;      // LC-2: the ceiling's abort landed (see finalization)

    /**
     * Should this poll's completion signal be DEFERRED because a tool call has
     * not reached a terminal `state.status`?
     *
     * Keyed on the REAL SDK shape (src/sidecar/tool-part.js): terminal is
     * `state.status === 'completed' | 'error'`. It is deliberately NOT keyed on a
     * `tool_result` part — OpenCode emits no such part type (36 `tool_use` records
     * and 0 `tool_result` records across the 35 recorded legs), so the diagnosis's
     * proposed `pendingToolCalls` gate would have hung every tool-using leg.
     *
     * It reads `getLiveToolCalls`, NOT `getPendingToolCalls`: a leg is only ever
     * held open on POSITIVE evidence that OpenCode is still working ('pending' /
     * 'running'). A tool part carrying no `state` at all is unknown, not live, and
     * must not defer anything — deferring on an absence of evidence is exactly how
     * this gate would hang. B53 still owns that no-evidence case.
     *
     * @param {string} exitPath which completion gate is asking (for the logs)
     * @returns {boolean} true = keep polling; false = complete now
     */
    const deferForUnsettledTools = (exitPath) => {
      if (toolSettleTimedOut) { return false; }       // ceiling blown — never defer again
      if (!(toolSettleGraceMs > 0)) { return false; } // 0 = disabled (escape hatch)
      if (liveTools.length === 0) { return false; }
      if (toolSettleDeferredSince === null) {
        toolSettleDeferredSince = Date.now();
        logger.info('Deferring leg completion — tool call(s) still executing', {
          taskId, exitPath, live: liveTools.length,
          tools: liveTools.map(t => `${t.name}:${t.status}`).join(','), toolSettleGraceMs,
        });
        return true;
      }
      if ((Date.now() - toolSettleDeferredSince) <= toolSettleGraceMs) { return true; }
      // The ceiling. Complete the leg (keep whatever output it produced) and make
      // the uncertainty impossible to miss — never fail it closed.
      toolSettleTimedOut = true;
      unsettledAtCeiling = liveTools.slice();
      logger.error('Tool call(s) did not settle within the grace window — completing leg '
        + 'anyway; its OpenCode session may STILL be working and BILLING', {
        taskId, sessionId, exitPath, toolSettleGraceMs,
        unsettled: unsettledAtCeiling.length,
        tools: unsettledAtCeiling.map(t => `${t.name}@${t.firstSeenAt}`).join(','),
      });
      return false;
    };

    // `!backstopFired`: a no-op for the pre-existing mid-loop firing path (that
    // branch already `break`s the instant it sets backstopFired, so this outer
    // condition is never re-checked with it true from there) — it only matters
    // for the NEW pre-send-timeout path above, where backstopFired can already
    // be true before the loop ever starts. Skips the loop entirely rather than
    // burning one wasted pollIntervalMs sleep before falling through to the
    // post-loop abort block below.
    while (!completed && !backstopFired && (Date.now() - startTime) < timeoutMs) {
      watchdog.touch();
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));

      // Check for external abort signal (MCP tool or CLI command)
      try {
        const metaCheck = path.join(sessionDir, 'metadata.json');
        if (fs.existsSync(metaCheck)) {
          const metaContent = fs.readFileSync(metaCheck, 'utf-8');
          const meta = JSON.parse(metaContent);
          if (meta.status === 'aborted') {
            logger.info('External abort signal received', { taskId });
            try {
              const { abortSession } = require('./opencode-client');
              await abortSession(client, sessionId, ...dirArgs);
            } catch (abortErr) {
              logger.warn('Failed to abort OpenCode session', { error: abortErr.message });
            }
            aborted = true;
            break;
          }
        }
      } catch {
        // Ignore metadata read errors during polling
      }
      pollCount++;

      try {
        const remaining = deadline - Date.now();
        const messages = await withTimeout(
          getMessages(client, sessionId, ...dirArgs),
          Math.min(pollCallTimeoutMs, remaining),
          'getMessages'
        );
        consecutivePollFailures = 0;
        const messageCount = messages?.length || 0;

        const mr = mirrorMessages(messages, mirror);
        mr.appendLines.forEach(line => logMessage(conversationPath, line));
        // Surface A (spec §4.1): stamp raw usage on each 'receiving' flush from the
        // PERSISTENT mirror.usageByMsg Map (accumulated across polls) — NOT
        // mr.usageByMsg, which doesn't exist on mirrorMessages()'s per-poll delta.
        // Cost resolution happens at read time (Task 9); the writer stays cheap.
        const { sumPerMessageUsage } = require('./utils/pricing');
        mr.progressUpdates.forEach(p => writeProgress(
          sessionDir, p.stage,
          p.stage === 'receiving' ? { ...p.extra, usage: sumPerMessageUsage(mirror.usageByMsg) } : p.extra,
        ));
        const currentAssistantMsgId = mr.currentAssistantMsgId;
        const assistantFinished = mr.assistantFinished;
        // v4.4 B4 part 1: evaluate tool liveness ONCE per poll, before any
        // completion gate reads it. Clearing the deferral here (rather than
        // inside deferForUnsettledTools) matters: the gates only run when a
        // completion signal fires, so a leg that resumes working after a
        // deferral would otherwise keep B53 suppressed on a stale timestamp.
        pendingTools = getPendingToolCalls(mirror);
        liveTools = getLiveToolCalls(mirror);
        if (liveTools.length === 0) { toolSettleDeferredSince = null; }
        if (mr.sessionError) {
          sessionError = mr.sessionError;
          logger.error('Session error detected in assistant message', { sessionId, message: mr.sessionError });
        }

        logger.debug('Poll status', {
          pollCount,
          messageCount,
          assistantFinished,
          outputLength: mirror.output.length,
          elapsed: Date.now() - startTime
        });

        // ---- per-poll activity, read ONCE, ABOVE every completion gate --------
        // Activity-aware idle detection: ANY of text growth, a new tool call, a new
        // tool result, a new message, a new assistant message id, or reasoning-output
        // growth counts as progress. Only count toward completion when NOTHING changed
        // (genuine idle).
        //
        // ⚠️ POSITION IS LOAD-BEARING (v4.9 W13, PR #203 council round 1, findings
        // A1+B1). This block used to sit BELOW the four completion gates that
        // follow — fold-marker, boundary-provider-error, error-with-no-output and
        // sdk-idle — every one of which `break`s. A leg whose first substantive
        // output and whose completion landed in the SAME poll therefore never
        // reached the TTFT stamp, and those are exactly the FAST legs, so the
        // censoring truncated the left tail rather than sampling at random.
        // Hoisting is value-preserving, and the AUDIT that says so is below rather
        // than an appeal to construction (PR #207 round 4, B2 — the earlier wording
        // here claimed "every `last*` tracker is written only here" and "nothing
        // reads them after the loop", and BOTH are false as written, because
        // `lastAssistantMsgId` is a `last*` tracker this block never writes).
        // MEASURED, every reader in this file:
        //   · `mirror` changes only at the `mirrorMessages` call above, so every
        //     delta below reads the same numbers it read at the old site.
        //   · This block WRITES exactly seven trackers — output length, tool-call
        //     count, tool-result count, message count, reasoning length, settled-
        //     tool count and `lastProgressAt`. Outside this block those seven have
        //     exactly ONE reader in the whole file: `lastProgressAt`, in the B53
        //     tool-stall gate further down. That gate sat below the block's OLD
        //     position too, so their order is unchanged. None of the seven is read
        //     after the loop.
        //   · `lastAssistantMsgId` is READ here (`newAssistant`) and written where
        //     it always was, at the BOTTOM of the loop below every gate — so the
        //     comparison still runs against the previous poll's id, and the one
        //     post-loop `last*` reader (`hasAssistantMsg` on the timeout result)
        //     reads a tracker this block does not touch.
        // The only behaviour change is that a poll which BREAKS now advances those
        // seven first, and nothing observes them afterwards.
        // Hoisting the whole block (rather than adding a second stamp beside each
        // gate) is what keeps ONE definition of the predicate and ONE stamp site.
        const outputGrew = mirror.output.length > lastOutputLength;
        lastOutputLength = mirror.output.length;
        const toolActivity = mirror.toolCalls.length > lastToolCallCount;
        lastToolCallCount = mirror.toolCalls.length;
        const resultActivity = mirror.seenToolResultIds.size > lastToolResultCount;
        lastToolResultCount = mirror.seenToolResultIds.size;
        const messageActivity = messageCount > lastMessageCount;
        lastMessageCount = messageCount;
        const newAssistant = currentAssistantMsgId !== lastAssistantMsgId;
        // B53: an interleaved-thinking model with a pending tool call can stream ONLY
        // reasoning deltas for minutes with no text/tool/result/message growth — mirror
        // the F6d treatment in conversation-mirror.js (reasoning growth = activity) so
        // the stall clock resets instead of falsely firing "Tool call stalled".
        const reasoningActivity = mirror.reasoningOutput.length > lastReasoningLength;
        lastReasoningLength = mirror.reasoningOutput.length;
        // v4.4 B4: a tool call REACHING a terminal status is real activity. Before
        // the shape fix this could never be observed (pending never cleared), so a
        // multi-tool leg's stall clock only reset on text growth.
        const settleActivity = mirror.settledToolCallIds.size > lastSettledToolCount;
        lastSettledToolCount = mirror.settledToolCallIds.size;

        const progressed = outputGrew || toolActivity || resultActivity || messageActivity
          || newAssistant || reasoningActivity || settleActivity;
        if (progressed) { lastProgressAt = Date.now(); }

        // v4.6.2 PR2 amendment 2 (controller live smoke + debug trace): the
        // backstop disarms only on SUBSTANTIVE activity — output, reasoning,
        // or tool motion (the spec's "first token/reasoning/tool_use").
        // messageActivity/newAssistant are excluded: OpenCode creates an empty
        // assistant placeholder on prompt ACCEPTANCE, which is precisely the
        // accepted-but-not-serving bookkeeping the backstop must not trust.
        // `progressed` itself (and every stall/idle consumer of it above) is
        // deliberately untouched — this is the narrower signal.
        //
        // v4.9 W13 Task A: it now has TWO readers — the TTFT probe on the next
        // line and the backstop tick further down — which is why it stopped
        // being described as "backstop-only". They read the SAME const on
        // purpose: "the time to first token" and "the moment the backstop
        // disarms" are the same instant BY CONSTRUCTION, and a second definition
        // of the predicate is exactly how those two would silently drift apart.
        const substantiveActivity = outputGrew || toolActivity || resultActivity
          || reasoningActivity || settleActivity;

        // v4.9 W13 Task A — THE TTFT STAMP. One shot, never re-armed, reading
        // the same `substantiveActivity` const the backstop is ticked with
        // below. Keyed on `progressed` it would report a first-token time for
        // OpenCode's empty acceptance placeholder — the exact lie the
        // amendment-2 narrowing of `substantiveActivity` removed from the backstop.
        //
        // ⚠️ RESIDUAL CENSORING — READ THIS BEFORE DERIVING ANYTHING (the C2
        // derivation must know the bias; PR #203 round 1, B1). With the hoist
        // above, every leg whose activity is OBSERVED by a poll is measured.
        // What is still unmeasurable, and therefore what an ABSENT ttftMs can
        // mean besides "served nothing":
        //   1. Externally aborted legs. The metadata `status: 'aborted'` check
        //      runs at the TOP of the poll body, before `getMessages`, and
        //      breaks — so anything served since the previous poll is never
        //      mirrored.
        //   2. Poll-failure bail. `getMessages` failing
        //      `maxConsecutivePollFailures` times in a row ends the leg with
        //      whatever the last SUCCESSFUL poll saw.
        //   3. `--timeout` expiry between polls: the while-condition ends the
        //      loop, so output that arrived during the final sleep is unseen.
        //   4. The pre-send backstop path, which skips the poll loop entirely —
        //      a model that began streaming while `sendPromptAsync` hung is
        //      never polled at all.
        //   5. A backward wall-clock jump before the first substantive poll
        //      (PR #207 round 3, B3). The reading is taken but is not a
        //      measurement, so the emit gates drop it — see the ruling below.
        // And the value itself is QUANTIZED UPWARD: it is stamped at poll time,
        // not at token time, so every measurement is an upper bound carrying up
        // to one `pollIntervalMs` (plus the getMessages round-trip) of slack.
        // Nothing extra is recorded for the censored cases on purpose — there is
        // no honest number to record, and a sentinel would be read as data.
        //
        // ⚠️ CLOCK-SKEW RULING (PR #207 round 3, B3). This is a wall-clock
        // delta, not a monotonic one, so a backward jump between
        // `outputClockStartedAt` and this poll — NTP correction, a VM resuming
        // from suspend, a manual clock set — measures NEGATIVE. Such a reading
        // is DROPPED at the emit gates (`isMeasuredTtft`), never clamped:
        // clamping to `0` would publish "first token inside the first poll",
        // the most consequential value in the distribution the C2 derivation
        // will read, for a leg that measured nothing of the kind.
        //
        // The stamp stays one-shot and unguarded ON PURPOSE. Re-arming after a
        // skewed reading would let a LATER poll stamp a delta against the same
        // displaced origin: a bigger number, equally wrong, and no longer even
        // the first token. One decision point (the gate) beats two.
        if (ttftMs === null && substantiveActivity) { ttftMs = Date.now() - outputClockStartedAt; }

        // Check for the completion marker as the FINAL non-empty line, carrying
        // THIS run's nonce (#BL-7 + 15b.3). Models may emit a bare or wrong-nonce
        // marker on its own line mid-output (echoing a prior sidecar, these
        // instructions, or scraped content) — only the exact nonced marker,
        // with nothing but blank lines after it, is a completion signal.
        // v4.4 B4: a fold marker WITHOUT info.time.completed means OpenCode has
        // not finalized the message, so a tool call may still be live and billing
        // (this is the same window B1's usage race lives in). Defer, bounded.
        if (findTrailingFoldMarker(mirror.output, foldNonce) !== -1
            && !deferForUnsettledTools('fold-marker')) {
          completed = true;
          break;
        }

        // Hard provider failure at the client boundary (#37): the request was
        // rejected (e.g., 402) so no assistant message will ever arrive. Exit as
        // soon as we confirm nothing streamed — don't wait for assistantFinished
        // (which never flips here) or the full timeout.
        if (boundaryProviderError && !mirror.output) {
          logger.error('Provider error at boundary with no output, exiting', {
            sessionError, pollCount
          });
          break;
        }

        // If the model returned an error with no output, exit immediately
        // (don't wait for timeout — the model won't produce anything)
        if (sessionError && !mirror.output && assistantFinished) {
          logger.error('Model returned error with no output, exiting', {
            sessionError, pollCount
          });
          break;
        }

        // #218 PR 3: the engine finalized the message with finish 'length' and
        // no answer text -- the Mode 2 death (probe row L1: hidden reasoning,
        // no content part); decided on THAT message's parts, not on the
        // session's accumulated output (council #232 r1 B2/D1). Nothing more
        // will arrive; every exit below requires output, so without this one the
        // leg waits out the no-output backstop and dies under ITS name, which
        // says "silence past the deadline" about a message the engine had
        // already finished with a reason. Gated on 'length' only: the finalized
        // message's finish is never a step-level 'tool-calls' (B4's measured
        // evidence below: time.completed lands after the tool ends), and a
        // 'stop' with no text is a different, unnamed death. Named mutants
        // (tests/headless-output-length.test.js): "NOEXIT" drops this exit,
        // "SESSIONWIDE" tests `!mirror.output` here instead of the message flag.
        if (assistantFinished && mirror.lastAssistantFinish === 'length' && !mirror.lastAssistantHasText) {
          logger.error('Assistant message finished for length with no answer text, exiting', { taskId, pollCount });
          break;
        }

        // Authoritative idle signal from the OpenCode SDK (preferred over the heuristic).
        // Gate on real output so a pre-processing 'idle' cannot end the run early.
        // Best-effort: on any error, fall back to the activity heuristic below.
        if (mirror.output.length > 0) {
          try {
            const remainingForStatus = deadline - Date.now();
            const statusData = await withTimeout(
              getSessionStatus(client, sessionId, ...dirArgs),
              Math.min(pollCallTimeoutMs, remainingForStatus),
              'getSessionStatus'
            );
            const s = (statusData && statusData.type) ? statusData : (statusData && statusData[sessionId]);
            if (s && s.type === 'idle' && !deferForUnsettledTools('sdk-idle')) {
              logger.debug('Session reported idle by SDK — completing', { sessionId });
              completed = true;
              break;
            }
          } catch (statusErr) {
            logger.debug('session.status unavailable; using activity heuristic', { error: statusErr.message });
          }
        }

        // No-output backstop: one tick per poll. Fired is terminal — break the
        // loop; the post-loop block below mirrors the timeout path.
        if (noOutputBackstop.tick(substantiveActivity, Date.now()) === 'fired') {
          backstopFired = true;
          sessionError = await noOutputBackstopReason();
          logger.warn('No-output backstop fired', { taskId, backstopMs: noOutputBackstopMs });
          break;
        }

        // B53: a wedged tool call (tool_use emitted, result never arrives) otherwise
        // burns the full --timeout with zero output — the stable-poll idle gate above
        // requires mirror.output.length > 0, which a pre-text wedge never satisfies.
        // Fire ONLY when a tool call is genuinely pending AND no progress of any kind
        // (text/tool/result/message/new-assistant) has been observed for the stall
        // window — this cannot false-positive during active streaming (progress
        // resets the clock every poll) and cannot fire without a wedged tool.
        //
        // v4.4 B4: SKIPPED while a tool-settle deferral is active. B53 was written
        // against `pendingToolCalls`, which could never clear (no tool_result part
        // exists), so its 180 s window was never calibrated against real tool
        // durations — the measured `task` call that exposed this defect ran 190.6 s,
        // so B53 would kill a healthy subagent leg 10 s short of its answer, and
        // kill it CLOSED. Once a completion signal has fired, the bounded settle
        // grace owns that decision and ends in a LOUD completion instead. B53's
        // actual target — a wedge with NO output, where the idle gate never engages
        // and therefore no deferral is ever active — is untouched.
        if (pendingTools.length > 0 && toolSettleDeferredSince === null
            && (Date.now() - lastProgressAt) > toolCallStallMs) {
          const stalled = pendingTools[0];
          const pendingSeconds = Math.round((Date.now() - Date.parse(stalled.firstSeenAt)) / 1000);
          sessionError = `Tool call stalled: ${stalled.name} pending ${pendingSeconds}s with no result or output`;
          logger.error('Tool call stalled — no progress within threshold', {
            taskId, toolName: stalled.name, toolId: stalled.id, pendingSeconds, toolCallStallMs
          });
          toolStalled = true;
          try {
            const { abortSession } = require('./opencode-client');
            await abortSession(client, sessionId, ...dirArgs);
            logger.info('Session aborted after tool-call stall', { taskId, sessionId });
          } catch (abortErr) {
            logger.warn('Failed to abort session after tool-call stall', { error: abortErr.message });
          }
          break;
        }

        if (!progressed) {
          // Require real output before counting toward completion — the SDK creates an
          // empty assistant-message placeholder on promptAsync that is NOT a finished response.
          if (currentAssistantMsgId !== null && mirror.output.length > 0) {
            stablePolls++;
            const threshold = assistantFinished ? stableFinishedPolls : stableIdlePolls;
            // v4.4 B4 part 1 — THE MEASURED DEFECT SITE. This is the gate that
            // declared `wsgate02-s1-3` complete on 166 characters of preamble 129 s
            // before its `task` tool finished. Deferred (bounded) when a tool call
            // is still live.
            //
            // The `assistantFinished` branch is deliberately NOT deferred:
            // OpenCode finalizes an assistant message only AFTER its tool calls
            // end, so `time.completed` structurally implies settled. VERIFIED on
            // the defect leg itself — task end 04:38:19.061, message
            // time.completed 04:38:19.301 — and on both recorded multi-tool legs,
            // whose last tool ended 62.3 s and 14.8 s before the leg completed.
            // Gating it would add pure hang risk for no truth gained.
            if (stablePolls >= threshold
                && !(!assistantFinished && deferForUnsettledTools('stable-idle'))) {
              logger.debug('Session appears complete (idle)', { stablePolls, assistantFinished });
              completed = true;
              break;
            }
          } else {
            logger.debug('Waiting for model to produce output', {
              pollCount, hasAssistantMsg: currentAssistantMsgId !== null, outputLength: mirror.output.length
            });
          }
        } else {
          stablePolls = 0;
        }
        lastAssistantMsgId = currentAssistantMsgId;

      } catch (pollError) {
        consecutivePollFailures++;
        logger.debug('Polling error', {
          error: pollError.message, consecutivePollFailures
        });
        if (consecutivePollFailures >= maxConsecutivePollFailures) {
          // F4: a dead server otherwise burns the full timeout in futile polls.
          sessionError = sessionError
            || `Polling failed ${consecutivePollFailures} consecutive times: ${pollError.message}`;
          logger.error('Exiting poll loop after consecutive failures', {
            consecutivePollFailures, taskId
          });
          pollFailureBail = true;
          break;
        }
      }
    }

    // Log why the polling loop exited
    const logLevel = (completed && !sessionError) ? 'info' : 'error';
    logger[logLevel]('Polling loop exited', {
      taskId,
      completed,
      aborted,
      pollCount,
      stablePolls,
      outputLength: mirror.output.length,
      elapsed: Date.now() - startTime,
      hasAssistantMsg: lastAssistantMsgId !== null,
      sessionError: sessionError || null
    });

    // Handle timeout
    // v4.6.2 PR2 fix wave: `!backstopFired` — the backstop's own break can
    // land after the post-break poll tail (getMessages + mirror processing
    // already inside that iteration) has ALSO crossed timeoutMs when the two
    // thresholds are configured close together, so this block must yield
    // once the backstop already ended the leg. Exactly one terminal-timing
    // signal per leg: statusFromResult() (src/utils/result-schema.js) checks
    // timedOut BEFORE error, so a leg carrying both would misreport as an
    // ordinary 'timeout' instead of the distinctly-named backstop reason.
    if (!completed && !aborted && !backstopFired && (Date.now() - startTime) >= timeoutMs) {
      timedOut = true;
      logger.warn('Task timed out', { taskId, elapsed: Date.now() - startTime });

      // Abort the OpenCode session on timeout (agent keeps running otherwise)
      try {
        const { abortSession } = require('./opencode-client');
        await abortSession(client, sessionId, ...dirArgs);
        logger.info('Session aborted after timeout', { taskId, sessionId });
      } catch (abortErr) {
        logger.warn('Failed to abort session after timeout', { error: abortErr.message });
      }
    }

    // Backstop fired: abort the OpenCode session exactly like the timeout path
    // (the agent keeps running otherwise). The leg's error already carries the
    // NO_OUTPUT_BACKSTOP reason; no separate degrade machinery — the ordinary
    // dead-leg path (SL-2 retry, sink announcement, exit codes) inherits it.
    if (backstopFired && !completed && !aborted) {
      try {
        const { abortSession } = require('./opencode-client');
        await abortSession(client, sessionId, ...dirArgs);
        logger.info('Session aborted after no-output backstop', { taskId, sessionId });
      } catch (abortErr) {
        logger.warn('Failed to abort session after backstop', { error: abortErr.message });
      }
    }

    watchdog.cancel();
    if (uninstallSignals) { uninstallSignals(); }

    // ---- v4.4 B1: bounded post-loop usage reconciliation ----------------------
    // MUST run before server.close() — the client needs a live server — and MUST
    // NOT re-mirror text: mirrorMessages() would append the already-captured
    // assistant output to conversation.jsonl a second time, so this uses the
    // usage-only pass (src/sidecar/conversation-mirror.js mirrorUsageOnly).
    //
    // Strictly best-effort: every failure mode leaves the leg's completion
    // verdict, summary and error exactly as the loop decided them. B2 is the
    // safety net underneath — when the re-poll still sees nothing, the leg
    // resolves to `unknown`, never a fabricated $0.
    //
    // Skipped when there is nothing to settle: an aborted leg (the caller pulled
    // the plug), a leg that bailed on consecutive poll failures (the server is
    // gone — three more reads would only burn the settle timeout), and a leg that
    // errored with no output at all (no assistant message was ever billed).
    // Deliberately NOT restricted to `completed`: a timed-out or tool-stalled leg
    // spent real money too, and its usage is just as worth capturing.
    const canSettleUsage = !aborted && !pollFailureBail && !(sessionError && !mirror.output);
    if (canSettleUsage && usageSettlePolls > 0) {
      for (let i = 0; i < usageSettlePolls; i++) {
        // v4.4 (cost-council finding 2): the boundary covers the WHOLE loop body,
        // not just the network read. It previously wrapped only `withTimeout(...)`,
        // leaving `mirrorUsageOnly` and `allAssistantUsagePresent` — which inspect
        // an untrusted snapshot shape — outside it. A throw there escaped
        // runHeadless entirely and DISCARDED a leg whose answer was already
        // captured and already paid for: the most expensive possible outcome for
        // a path whose entire job is a nice-to-have usage top-up. "Best-effort"
        // has to mean the effort, not just its first statement.
        let done = false;
        try {
          const settled = await withTimeout(
            getMessages(client, sessionId, ...dirArgs),
            Math.min(pollCallTimeoutMs, USAGE_SETTLE_CALL_TIMEOUT_MS),
            'getMessages(usage-settle)',
          );
          mirrorUsageOnly(settled, mirror);
          done = allAssistantUsagePresent(settled);
          if (!done && i < usageSettlePolls - 1) {
            await new Promise(resolve => setTimeout(resolve, usageSettleIntervalMs));
          }
        } catch (settleErr) {
          // Same disposition as the pre-existing network-failure branch: stop
          // settling, keep every dollar already mirrored, and leave the loop's
          // completion verdict, summary and error untouched. B2 remains the net
          // underneath — no observation resolves to `unknown`, never a fake $0.
          logger.debug('usage-settle re-poll failed (best-effort, leg unaffected)', {
            taskId, attempt: i + 1, error: settleErr.message,
          });
          break;
        }
        if (done) { break; }
      }
    }

    // Log summary of tool calls for debugging.
    // v4.4 B4: this used to filter on `t.name === 'Task'` and was DEAD twice over —
    // the mirror read `part.name` (the real shape has `part.tool`) so every name
    // was undefined, and OpenCode's tool is named `task` in lowercase anyway.
    const { isSubagentToolCall } = require('./sidecar/tool-part');
    const subagentToolCalls = mirror.toolCalls.filter(isSubagentToolCall);

    // ---- v4.4.1 CA-1: enumerate CHILD (subagent) session spend ---------------
    // MUST run before server.close() — the walk needs a live server. A `task`
    // call spawns a child OpenCode session that OpenCode bills separately and
    // does NOT roll into this session's cost; amicus never looked, so $0.492506
    // across the four recorded paid runs was invisible to every total the
    // product prints. Safe to do at finalization only because dcb0792 stopped a
    // `task` part going terminal while its child session is still live — before
    // that, walking here would have captured a partial child cost and traded a
    // silent zero for a silent floor.
    //
    // Run for EVERY leg, not only ones whose tool calls looked like `task`: the
    // name-string proxy (src/sidecar/tool-part.js) was verified 1:1 on a
    // 37-session corpus and nowhere else, so a child created by some other
    // mechanism would be a silent under-count wearing a costExact badge — the
    // exact defect the flag exists to kill. Skipped only when there is nothing
    // to ask (same predicate as the usage settle: the server is gone, or the
    // caller pulled the plug), in which case the leg falls back to the proxy and
    // honestly reports its subtree as unknown.
    let subtree = null;
    if (canSettleUsage) {
      try {
        const { collectSubtreeUsage, subtreeIsUnknown } = require('./sidecar/child-sessions');
        const walked = await collectSubtreeUsage(client, sessionId, {
          directory,
          callTimeoutMs: Math.min(pollCallTimeoutMs, USAGE_SETTLE_CALL_TIMEOUT_MS),
          logger,
        });
        subtree = {
          sessions: walked.sessions.length,
          tokens: walked.tokens,
          costReported: walked.costReported,
          // The honesty verdict is decided HERE, where both observations live —
          // the walk's own completeness and the `task`-call evidence. See
          // subtreeIsUnknown for why a failed walk with no evidence of a
          // subagent must NOT flag (an older server would otherwise mark every
          // leg of every run inexact forever).
          unknown: subtreeIsUnknown({
            walkComplete: walked.complete,
            sessionsFound: walked.sessions.length,
            subagentCalls: subagentToolCalls.length,
          }),
        };
        if (walked.sessions.length > 0) {
          logger.info('Child session spend attributed to this leg', {
            taskId, sessions: walked.sessions.map((s) => s.id),
            costReported: walked.costReported, subtreeUnknown: subtree.unknown,
          });
        }
      } catch (subtreeErr) {
        // Cannot happen by construction (the collector swallows its own
        // failures), but a throw here must never cost a leg its answer.
        subtree = null;
        logger.debug('subtree enumeration failed (best-effort)', { taskId, error: subtreeErr.message });
      }
    }

    // ---- v4.4.1 LC-2: stop paying for a session nobody will read -------------
    // OWNER RULING (2026-07-26). The leg is complete and runHeadless is returning,
    // so nothing will ever read further session output — the outcome was already
    // discarded by completing. Aborting here does not truncate an answer that
    // would have been used; it stops paying for work nobody will read. The
    // original objection ("stops the bleeding at the cost of truncating a
    // possibly-healthy call") applied to aborting ON the completion route, where
    // the call might still have mattered. Here it cannot.
    //
    // ORDER IS LOAD-BEARING, on BOTH sides:
    //   AFTER the child-session walk above — aborting first risks losing the
    //     subtree cost data v4.4.0 exists to capture, trading one silent
    //     under-report for another.
    //   BEFORE server.close() below — the abort is an SDK call and needs a live
    //     server. It is not redundant with close(): on a SHARED server (every
    //     council run) close() is never called here, and the session would go on
    //     billing against a server that outlives this leg.
    //
    // A-8 APPLIES: "never lose the answer" outranks "never report inaccurate
    // usage". This is an optimization layered on an already-successful,
    // already-paid-for leg, so every failure — rejection, hang, or a missing
    // session id — is logged and dropped. Nothing here may alter `completed`,
    // `summary`, `usage` or `error`. `toolSettleAborted: false` is the honest
    // record of "we tried and could not; it may still be billing".
    if (toolSettleTimedOut && sessionId) {
      try {
        const { abortSession } = require('./opencode-client');
        await withTimeout(
          abortSession(client, sessionId, ...dirArgs),
          toolSettleAbortTimeoutMs,
          'abortSession(tool-settle)',
        );
        toolSettleAborted = true;
        // Task 6 review X2: a LANDED abort is the good outcome of a condition
        // that is already logged at `error` (the ceiling itself). Logging the
        // remedy at `warn` reads as a second problem; `info` reads honestly.
        // The FAILED abort below stays at `warn` — that one really is a problem
        // ("it may still be billing").
        logger.info('Aborted the OpenCode session after the tool-settle ceiling', {
          taskId, sessionId, unsettled: unsettledAtCeiling.length,
        });
      } catch (abortErr) {
        toolSettleAborted = false;
        logger.warn('Could not abort the session after the tool-settle ceiling — it may '
          + 'still be billing', { taskId, sessionId, error: abortErr.message });
      }
    }

    if (!externalServer) { await server.close(); }
    if (mirror.toolCalls.length > 0) {
      logger.info('Tool calls summary', {
        totalToolCalls: mirror.toolCalls.length,
        taskToolCalls: subagentToolCalls.length,
        subagentTypes: subagentToolCalls
          .filter(t => t.input && (t.input.subagent_type || t.input.description))
          .map(t => ({ type: t.input.subagent_type || t.input.description, model: (t.input && t.input.model) || 'inherited' }))
      });
    }

    // Propagate the error when the model errored with no output (F1 semantics:
    // a model error alongside streamed output still yields a usable summary),
    // and ALWAYS when the poll loop bailed on consecutive failures (F4: a dead
    // server must never classify as a complete leg, even with partial output)
    // or on a tool-call stall (B53: same — a wedged tool must never classify
    // as complete, even if some text streamed alongside it before the wedge).
    const { sumPerMessageUsage } = require('./utils/pricing');
    const usage = sumPerMessageUsage(mirror.usageByMsg);

    // #218 PR 3: name the Mode 2 death. The engine records `finish: 'length'`
    // when the provider stopped at the max_tokens reservation (probe rows
    // A/H1/L1-L4); with no answer text that is a dead leg, and it used to leave
    // here as `completed` with an empty summary -- or with its THINKING promoted
    // to the summary (L2/L4's shape). Named through the channel every other
    // death uses (sessionError -> leg.error -> metadata.reason -> the dead-leg
    // note), so no consumer needs a new case. An error the engine itself put on
    // the message wins: its own name is the better observation. Named mutants
    // (tests/headless-output-length.test.js): "ENGINEERRORLOST" drops the
    // `!sessionError` guard; "DEATHNOTFORCED" drops `|| outputLengthDeath` from
    // failedWithNoUsableOutput below.
    //
    // Decided on the LAST message's own facts (council #232 r1 B2/D1): a tool
    // loop's earlier text or promoted reasoning is not this message's answer.
    const { isOutputLengthDeath, formatOutputLengthReason } = require('./utils/output-length');
    const finish = mirror.lastAssistantFinish;
    const reasoningOnly = mirror.lastAssistantHasReasoning && !mirror.lastAssistantHasText;
    const outputLengthDeath = isOutputLengthDeath({ finish, hasText: mirror.lastAssistantHasText });
    if (outputLengthDeath && !sessionError) {
      sessionError = formatOutputLengthReason({
        tokens: usage.tokens, budget: readOutputBudgetSafe(server, options._readOutputBudget), reasoningOnly,
      });
      logger.error('Leg stopped for length with no answer text', { taskId, error: sessionError });
    }

    // ---- v4.4 B3: one TERMINAL progress record carrying the settled usage ----
    // progress.json's `usage` block was previously stamped only on 'receiving'
    // flushes, which fire on text/tool/reasoning GROWTH — always strictly before
    // OpenCode's finalization stamp — and writeProgress rebuilds the file from
    // scratch, so it could not preserve an earlier snapshot either. Net effect on
    // real runs: 31 of 35 legs ended with an all-zero usage snapshot while their
    // metadata.json held thousands of real tokens. That snapshot is what the LIVE
    // workspace GUI reads (src/observe/live-doc.js enrichLegUsage → resolveUsage),
    // so every completed leg rendered as free.
    //
    // `messagesReceived` is deliberately omitted: readProgress() derives `messages`
    // from conversation.jsonl's assistant entries and only falls back to this field
    // when there are none, so re-stating it here would add nothing and could only
    // disagree with the file it is meant to summarize.
    //
    // v4.4 B4: when the settle grace was exceeded the leg completed with tool
    // calls still live, so its reported cost is a FLOOR and its session may still
    // be billing. That must travel with the leg, not just sit in a log line — the
    // live GUI reads this file (src/observe/live-doc.js). `unsettledToolCalls` is
    // a COUNT here (progress.json is a compact snapshot); the full list is on the
    // returned result for the caller's metadata.
    //
    // v4.4.1 LC-2: `toolSettleAborted` rides alongside it — `true` = the session
    // was told to stop, `false` = it may still be billing. Both are meaningful
    // ONLY when the ceiling was hit, so neither appears on a clean leg.
    const settleFlags = toolSettleTimedOut
      ? { toolSettleTimedOut: true, unsettledToolCalls: unsettledAtCeiling.length,
        toolSettleAborted }
      : {};
    // v4.4 B4 (Task 2) + v4.4.1 CA-1: a leg that made a SUBAGENT call has spend
    // in a CHILD OpenCode session that is billed separately and is NOT rolled
    // into the parent session's cost. `subtree` carries what the walk MEASURED;
    // `subtreeUnknown` is what it could not. The proxy count survives as the
    // fallback for the case where the walk could not run at all (see the
    // enumeration block above) — src/sidecar/tool-part.js isSubagentToolCall
    // has the 1:1 evidence for it.
    const subtreeFlags = subagentToolCalls.length > 0
      ? { subagentToolCalls: subagentToolCalls.length }
      : {};
    const subtreeResult = subtree ? { subtree } : {};
    // The live workspace reads progress.json directly (src/observe/live-doc.js
    // enrichLegUsage), so the attribution has to travel on BOTH channels or the
    // GUI's cost-by-seat silently disagrees with run.json.
    const subtreeProgress = subtree
      ? { ...(subtree.sessions > 0
        ? { subtree: { sessions: subtree.sessions, tokens: subtree.tokens, costReported: subtree.costReported } }
        : {}),
      ...(subtree.unknown ? { subtreeUnknown: true } : {}) }
      : (subagentToolCalls.length > 0 ? { subtreeUnknown: true } : {});
    // ---- v4.4.1 LC-3: the terminal stage is DERIVED, never hardcoded ---------
    // This write sits above BOTH returns below, so EVERY terminal path reaches
    // it — the external-abort break, the --timeout, the poll-failure bail, the
    // tool-call wedge — and it used to stamp 'complete' on all of them. The live
    // workspace reads progress.json directly (src/observe/live-doc.js
    // enrichLegUsage), so an aborted or errored leg rendered with a green check
    // until metadata.json landed. Fix the WRITER: src/observe/council-legs.js
    // already prefers metadata.json for a terminal leg and is NOT the problem.
    //
    // resolveTerminalState is the codebase's single source of truth for the
    // (completed, timedOut, aborted, error) → status mapping, and it is what
    // start.js / continue.js / resume.js / finalizeHeadlessResult will run on
    // THIS function's return value to stamp metadata.json. Deriving the stage
    // from it — rather than re-deriving a second, hand-rolled expression here —
    // is what guarantees progress.json's stage and metadata.json's status cannot
    // disagree. It also covers the two cases a hand-rolled `aborted ? … :
    // sessionError ? …` would get wrong: a TIMED-OUT leg (which would still have
    // read 'complete'), and the F1 case where a session error arrived alongside
    // usable output and the leg legitimately returns completed (which would have
    // read a false 'error').
    //
    // `failedWithNoUsableOutput` is hoisted out of the `if` below so the stage
    // and the returned shape are decided by ONE predicate and cannot drift.
    // #218 PR 3: an OUTPUT_LENGTH death with PROMOTED reasoning has a non-empty
    // mirror.output and must still fail.
    const failedWithNoUsableOutput = !!(sessionError && (!mirror.output || pollFailureBail || toolStalled || outputLengthDeath));
    const { resolveTerminalState } = require('./sidecar/session-finalize');
    const terminalStage = resolveTerminalState({
      completed,
      timedOut,
      aborted,
      error: failedWithNoUsableOutput ? sessionError : null,
    }).status;
    try { writeProgress(sessionDir, terminalStage, { usage: { ...usage, ...subtreeProgress }, ...settleFlags }); }
    catch (progressErr) {
      logger.debug('terminal progress write failed (best-effort)', { taskId, error: progressErr.message });
    }
    const settleResult = toolSettleTimedOut
      ? { toolSettleTimedOut: true, unsettledToolCalls: unsettledAtCeiling, toolSettleAborted }
      : {};

    if (failedWithNoUsableOutput) {
      return {
        summary: mirror.output ? extractSummary(mirror.output, foldNonce) : '',
        completed: false,
        timedOut,
        aborted,
        taskId,
        toolCalls: mirror.toolCalls,
        usage,
        ...settleResult,
        ...subtreeFlags,
        ...subtreeResult,
        // #133 P1: sessionId was assigned at :413/:417, well before this
        // return — guaranteed set here, same as `taskId` above.
        opencodeSessionId: sessionId,
        // v4.9 W13 Task A: emit-when-set. This return is reached by legs that
        // failed with no USABLE output, which is not the same as no output at
        // all — a leg that streamed reasoning and then errored has a real ttft
        // and must keep it. (PR #207 round 3, B3: emit-when-VALID too — see the
        // clock-skew ruling at the stamp site above.)
        ...(isMeasuredTtft(ttftMs) ? { ttftMs } : {}),
        // #218 PR 3: the engine's finish for the last assistant message, emit-when-set like ttftMs.
        ...(typeof finish === 'string' ? { finish } : {}),
        error: sessionError
      };
    }

    return {
      summary: extractSummary(mirror.output, foldNonce),
      completed,
      timedOut,
      aborted,
      taskId,
      toolCalls: mirror.toolCalls, // Include tool calls in result for verification
      usage,
      ...settleResult,
      ...subtreeFlags,
      ...subtreeResult,
      // #133 P1: see the comment on the sibling return above — guaranteed set.
      opencodeSessionId: sessionId,
      // v4.9 W13 Task A: emit-when-set — see the sibling return above.
      ...(isMeasuredTtft(ttftMs) ? { ttftMs } : {}),
      // #218 PR 3: the engine's finish for the last assistant message, emit-when-set like ttftMs.
      ...(typeof finish === 'string' ? { finish } : {}),
      exitCode: 0
    };

  } catch (error) {
    logger.error('runHeadless caught exception', {
      taskId,
      error: error.message,
      stack: error.stack?.split('\n').slice(0, 3).join(' | ')
    });
    // Abort session on error (agent may keep running)
    if (sessionId) {
      try {
        const { abortSession } = require('./opencode-client');
        await abortSession(client, sessionId, ...dirArgs);
      } catch {
        // Ignore abort errors during error handling
      }
    }
    if (watchdog) { watchdog.cancel(); }
    if (uninstallSignals) { uninstallSignals(); }
    // ⚠️ v4.4.1 M2: guarded — this used to be a bare `await server.close()` sitting directly
    // above A3's terminal-write block, OUTSIDE any try, in the one place a close failure is
    // least affordable: the error handler. A rejection here would have skipped the terminal
    // progress write below entirely AND replaced the original `error` (the one A3 exists to
    // preserve) with this close failure instead. `close()` has already done its job of freeing
    // the port by the time we get here; a failure to close cleanly is not this handler's
    // problem to propagate, so it is logged and swallowed, same discipline as every other
    // best-effort close in this file (see the signal handler above).
    if (!externalServer) {
      try { await server.close(); } catch (closeErr) {
        logger.debug('server.close() failed in the outer exception handler (best-effort)', {
          taskId, error: closeErr.message,
        });
      }
    }
    // ⚠️ v4.4.1 A3 — the last hole in LC-3's story. LC-3 made the SUCCESS path's terminal
    // progress write derive its stage from resolveTerminalState instead of hardcoding 'complete',
    // so an aborted/errored/timed-out leg stopped rendering with a green check. This path — the
    // outer exception handler — wrote NO terminal progress record at all, so progress.json kept
    // whatever non-terminal stage the last flush left on it (usually 'receiving') while the
    // caller's finalizeHeadlessResult stamped metadata.json 'error' off the return value below.
    // The live workspace and `amicus watch` read progress.json DIRECTLY (live-doc.js
    // enrichLegUsage, council-legs.js), so a leg that exploded rendered as still-streaming
    // forever: exactly the stale-state class LC-3 closed one path over.
    //
    // ⚠️ This runs INSIDE an error handler: it must never throw and must never mask the original
    // error, so the whole thing sits in its own try and its failure is a debug line, exactly like
    // the success path's write. The stage comes from the same single source of truth that path
    // uses, so progress.json's stage and metadata.json's status still cannot disagree.
    //
    // ⚠️ The prior `usage` is READ BACK and re-attached deliberately. writeProgress REBUILDS
    // progress.json from `{stage, stageLabel, updatedAt, ...extra}` — it does not merge — so a
    // bare terminal write would silently delete whatever real spend the last 'receiving' flush had
    // already recorded, trading a stale-stage bug for a cost-under-report on exactly the legs that
    // failed. There are no settled totals on this path (that is what the exception cost us), so
    // carrying the last known usage forward unchanged is the honest maximum.
    //
    // v4.4.1 M3 — scope of "the last known ones": `usage` ONLY. That same 'receiving' flush also
    // wrote `p.extra` (e.g. `messagesReceived`), and that is deliberately left to drop here, not
    // carried forward too — the same call LC-3's success-path terminal write already made (see
    // that block's comment above): readProgress() derives `messages` from conversation.jsonl's
    // assistant entries directly and only falls back to `messagesReceived` when there are none, so
    // restating a stale count on an exception — where conversation.jsonl is the more truthful,
    // already-mirrored source — could only disagree with the file it exists to summarize.
    if (!writeTerminalProgressSafe(sessionDir, error.message)) {
      logger.debug('terminal progress write failed after exception (best-effort)', { taskId });
    }
    const { emptyUsageTotals } = require('./utils/pricing');
    return {
      summary: '',
      completed: false,
      timedOut: false,
      aborted: false,
      taskId,
      usage: emptyUsageTotals(),
      // #133 P1: measured, not assumed — `sessionId` (:365) is in scope
      // through this whole catch (it is already read at the `if (sessionId)`
      // abort-on-error above) but, unlike the two returns in the try body,
      // is NOT guaranteed assigned here: an exception thrown before session
      // creation (e.g. during the pre-session server-readiness wait) reaches
      // this same catch with sessionId still unset. `|| null` makes both
      // outcomes explicit and already schema-shaped (run.schema.json:23
      // wants string|null, never undefined).
      opencodeSessionId: sessionId || null,
      // v4.9 W13 Task A (PR #203 round 1, A2): emit-when-set, the SAME rule as
      // the two returns in the try body. An exception is not evidence that
      // nothing was served — a leg can stream a first token and explode in the
      // post-loop finalization (`server.close()` is the one unguarded await on
      // that path), and throwing away a measurement it already made would be a
      // second, silent loss on top of the first. Nothing is invented: a leg
      // that exploded before any poll observed activity still carries no key.
      ...(isMeasuredTtft(ttftMs) ? { ttftMs } : {}),
      error: error.message
    };
  }
}

/**
 * Extract summary from output (everything before the trailing fold marker)
 * Spec Reference: §6.2 - Return summary (everything before the fold marker)
 *
 * v4.0 §9 (BL-7 done-done): `nonce` is REQUIRED for any non-empty output.
 * The pre-15b.3 no-nonce fallback (matching the legacy bare `[SIDECAR_FOLD]`
 * marker) is retired — no code path, internal or external, may complete on a
 * bare marker. Callers with no nonce have no valid marker to split on and
 * must not call this.
 *
 * @param {string} output - Raw output from OpenCode
 * @param {string} nonce - This run's fold nonce (required for non-empty output)
 * @returns {string} Extracted summary
 * @throws {TypeError} when output is non-empty and nonce is missing/empty
 */
function extractSummary(output, nonce) {
  if (!output) {
    return '';
  }
  if (!nonce) {
    throw new TypeError('extractSummary requires a per-run nonce (15b.3/v4.0 §9)');
  }

  // Split on the fold marker only when it is the FINAL non-empty line (#BL-7).
  // A marker echoed mid-output (describing code, reproducing these
  // instructions, or from scraped content) is NOT a delimiter — keep it as
  // content. Only the true trailing marker is stripped.
  const idx = findTrailingFoldMarker(output, nonce);
  if (idx !== -1) {
    return output.slice(0, idx).trim();
  }
  return output.trim();
}

/**
 * Format a structured fold output with metadata
 * v4.0 §9: `nonce` is REQUIRED — the pre-15b.3 bare-`[SIDECAR_FOLD]` writer
 * fallback is retired; the bare literal is never written by any path. The
 * FOLD_MARKER/COMPLETE_MARKER constants remain exported for external
 * consumers' greps/back-compat only (docs/SHIMS.md).
 * @param {Object} options - Fold output options
 * @param {string} options.model - Model identifier
 * @param {string} options.sessionId - Session identifier
 * @param {string} [options.client='code-local'] - Client identifier
 * @param {string} [options.cwd] - Working directory (defaults to process.cwd())
 * @param {string} [options.mode='headless'] - Execution mode
 * @param {string} options.summary - Summary text
 * @param {string} options.nonce - This run's fold nonce (required)
 * @returns {string} Formatted fold output
 * @throws {TypeError} when nonce is missing/empty
 */
function formatFoldOutput({ model, sessionId, client, cwd, mode, summary, nonce }) {
  if (!nonce) {
    throw new TypeError('formatFoldOutput requires a per-run nonce (15b.3/v4.0 §9)');
  }
  return [
    buildFoldMarker(nonce),
    `Model: ${model}`,
    `Session: ${sessionId}`,
    `Client: ${client || 'code-local'}`,
    `CWD: ${cwd || process.cwd()}`,
    `Mode: ${mode || 'headless'}`,
    '---',
    summary
  ].join('\n');
}

module.exports = {
  runHeadless,
  waitForServer,
  withTimeout,
  extractSummary,
  findTrailingFoldMarker,
  formatFoldOutput,
  formatNoOutputBackstopReason,
  DEFAULT_TIMEOUT,
  FOLD_MARKER,
  COMPLETE_MARKER,
  // 15b.3: re-exported so callers that already `require('./headless')` don't
  // also need `require('./utils/fold-marker')` for the common case.
  buildFoldMarker,
  generateFoldNonce,
  POLL_INTERVAL_MS,
  STABLE_FINISHED_POLLS,
  STABLE_IDLE_POLLS,
  POLL_CALL_TIMEOUT_MS,
  MAX_CONSECUTIVE_POLL_FAILURES,
  TOOL_CALL_STALL_MS,
  USAGE_SETTLE_POLLS,
  USAGE_SETTLE_INTERVAL_MS,
  USAGE_SETTLE_CALL_TIMEOUT_MS,
  TOOL_SETTLE_GRACE_MS,
};
