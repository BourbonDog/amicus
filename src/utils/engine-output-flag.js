/**
 * @module engine-output-flag
 * #218 PR 2 — the one engine env flag amicus sets: OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX.
 *
 * WHY A FLAG AT ALL. The per-model `limit` descriptor (model-output-limit.js)
 * can only LOWER a leg's max_tokens reservation: the pinned engine computes
 * `Math.min(limit.output, OUTPUT_TOKEN_MAX)` and OUTPUT_TOKEN_MAX defaults to
 * 32000. Raising it is this flag's job. The engine reads the flag from the env
 * it is SPAWNED with, as a positive integer; `64000abc` and `0` fall back to
 * 32000 with no error anywhere (probe rows D1/D2), and a negative value is
 * rejected by the same positive-integer check, read in the pinned binary
 * (`Number.isInteger(w) && w > 0`), not wire-measured.
 *
 * THE ONE RULE: when `outputBudget` is configured, the flag is set TO THE BUDGET
 * for every engine amicus starts — around the synchronous spawn only, restored
 * before anything is awaited. Measured on the wire by scripts/probe-max-tokens.js
 * (BACKLOG "v4.9.4 records", the PR 2 record):
 *   - a route the amicus catalog can clamp gets min(budget, ceiling) through the
 *     descriptor, and the flag never exceeds it (C2, K6);
 *   - a bare `{}` route the ENGINE knows gets min(engine ceiling, budget)
 *     (C3, K5, K12) — the flag reaches rows the amicus catalog cannot name;
 *   - a route neither knows gets the budget as-is (J2, K13), exactly as it got
 *     the raw 32000 before;
 *   - an ambient value the user exported themselves is honoured untouched when no
 *     budget is configured, and overridden for the spawn (then restored) when one is.
 *
 * WHY AROUND THE SYNCHRONOUS CALL. The pinned @opencode-ai/sdk spreads
 * process.env into the child's env inside createOpencodeServer BEFORE its first
 * await (node_modules/@opencode-ai/sdk/dist/server.js), so the flag has to be in
 * process.env at call time and may be gone by the time the promise settles.
 * Restoring in `finally` keeps it out of every OTHER child amicus spawns
 * (Electron, the MCP child, on-complete hooks) and out of the caller's own env.
 * The unit pin is tests/opencode-client-output-flag.test.js; the SDK-side pin is
 * tests/opencode-client-sdk-spawn-timing.test.js (the real SDK against a fake engine
 * on PATH); the engine-side canary is the probe's K6/K12/K13 rows, which CI's
 * keyless job runs on every push (tests/probe-flag-canary.integration.test.js).
 */
'use strict';

const { positiveCount } = require('./model-output-limit');

const OUTPUT_TOKEN_FLAG = 'OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX';
/** The engine's own default when the flag is absent or malformed (probe rows A, D1, D2). */
const ENGINE_DEFAULT_OUTPUT_TOKENS = 32000;

/**
 * The ONE form of OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX measured to be honoured:
 * a plain decimal integer with no leading zero -- the shape amicus writes
 * (outputTokenFlagValue) and the shape the probe ran (C1, K5, K12). `64000abc`
 * and `0` fell back to 32000 silently (D1/D2); ' 64000 ', '064000', '1e5',
 * '0x10' and '64000.7' have never been probed. Shared by the doctor row
 * (doctor-output-budget-check.js :: evaluateOutputBudget) and the death report
 * (output-length.js :: formatOutputLengthReason) so the two gates cannot drift.
 */
const PLAIN_OUTPUT_TOKEN_FLAG = /^[1-9]\d*$/;

/**
 * The flag value a budget produces, or null when no flag should be set.
 * Exactly normalizeOutputBudget's acceptance rule (a positive finite integer,
 * floored), rendered as plain decimal digits even above 1e21; everything else
 * is "no flag".
 * @param {*} budget raw or normalized outputBudget
 * @returns {string|null}
 */
function outputTokenFlagValue(budget) {
  const n = positiveCount(budget);
  if (n === null) { return null; }
  // String(1e21) is '1e+21', which the engine would read as malformed (D1) and
  // the doctor row would report as unmeasured. BigInt renders every
  // integer-valued double as plain digits, so the flag always has the one shape
  // measured to be honoured and a configured budget is never silently dropped
  // (council #231 B1/C2).
  return n >= 1e21 ? BigInt(n).toString() : String(n);
}

/**
 * Run `fn` with the flag set to `budget` in `env`, restoring the previous state
 * (absent, or the ambient value) before returning — whether `fn` returned a
 * value, returned a promise, or threw. With no usable budget `fn` runs untouched.
 *
 * `delete`, not `= undefined`: assigning undefined to a process.env key stores
 * the string 'undefined', which the engine would read as a malformed flag.
 * @template T
 * @param {*} budget outputBudget (positive integer, else no-op)
 * @param {() => T} fn called synchronously, exactly once
 * @param {NodeJS.ProcessEnv} [env] defaults to process.env — the env the SDK spreads
 * @returns {T} whatever fn returned (a promise is returned, never awaited here)
 */
function withOutputTokenFlag(budget, fn, env = process.env) {
  const value = outputTokenFlagValue(budget);
  if (value === null) { return fn(); }
  const had = Object.prototype.hasOwnProperty.call(env, OUTPUT_TOKEN_FLAG);
  const saved = env[OUTPUT_TOKEN_FLAG];
  env[OUTPUT_TOKEN_FLAG] = value;
  try {
    return fn();
  } finally {
    if (had) { env[OUTPUT_TOKEN_FLAG] = saved; } else { delete env[OUTPUT_TOKEN_FLAG]; }
  }
}

module.exports = {
  withOutputTokenFlag, outputTokenFlagValue, OUTPUT_TOKEN_FLAG, ENGINE_DEFAULT_OUTPUT_TOKENS,
  PLAIN_OUTPUT_TOKEN_FLAG,
};
