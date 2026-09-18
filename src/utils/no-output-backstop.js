/**
 * @module utils/no-output-backstop
 * v4.6.2 PR2 (spec §5, D4): fail a headless leg fast when the model produces
 * ZERO output, reasoning, and tool calls — the "accepted but not serving"
 * class (the v4.6.1 gemini release-gate incident: requests accepted, zero
 * tokens, three suites burned 130s timeouts each to learn nothing).
 *
 * Pure state machine, loop-driven (no timers of its own — the poll loop
 * ticks it): armed at leg start, DISARMED PERMANENTLY by the first
 * `progressed` tick (a 30-90s cold-prefill local model is never affected),
 * fired when the deadline passes with nothing ever observed. `fired` is
 * terminal for ticks: progress cannot resurrect it. The ONE way back to
 * `armed` is `extend()`, which a caller may use exactly once (#251 item 1:
 * the engine reported the session busy at the deadline) and only to a LATER
 * deadline. `ms <= 0` never arms — 0 is the documented escape hatch, which
 * is why the env resolver uses envNumber (explicit 0 honored) rather than
 * the `Number(env) || default` idiom.
 *
 * PR3's live probe reuses this with a 30s override — ms is an input; only
 * the exported resolver reads the environment.
 */
'use strict';

const { envNumber } = require('./env-num');
const { isRenderableStatus, isProbeOutcome, MAX_STATUS_TYPE_CHARS } = require('./session-status');
const { collapseExcerpt } = require('./text-sanitize');

const DEFAULT_NO_OUTPUT_BACKSTOP_MS = 300000;

/** The reasons a busy/retry session was NOT extended (spec 2026-09-18 §5.2).
 *  #251 item 1 fix round 1 (F3, council C1/D1): `elapsed` is the fourth — the decision
 *  granted an extension whose deadline had ALREADY passed by the time it was applied
 *  (a stalled poll), so `extend()` refused it and nothing was granted. */
const BACKSTOP_WHY = ['at-cap', 'retry-beyond-window', 'pre-send', 'elapsed'];

/** #251 item 1 fix round 1 (F3): the exact key set isBackstopRecord accepts — "and nothing
 *  else" in its docblock, made true rather than merely claimed. */
const RECORD_KEYS = new Set(['windowMs', 'firedAtMs', 'status', 'extended', 'extendedToMs', 'why', 'retryNextIso']);

/** @param {object} [env] test seam; defaults to process.env */
function resolveNoOutputBackstopMs(env) {
  return envNumber('AMICUS_NO_OUTPUT_BACKSTOP_MS', DEFAULT_NO_OUTPUT_BACKSTOP_MS, env);
}

/**
 * @param {{ms:number, startedAt:number}} opts
 * @returns {{tick:(progressed:boolean, nowMs:number)=>string,
 *   extend:(deadlineMs:number, nowMs:number)=>boolean,
 *   state:()=>string, deadline:()=>number, extended:()=>boolean}}
 */
function createNoOutputBackstop({ ms, startedAt }) {
  let state = ms > 0 ? 'armed' : 'disarmed';
  let deadline = startedAt + ms;
  let extended = false;
  return {
    tick(progressed, nowMs) {
      if (state !== 'armed') { return state; }
      if (progressed) { state = 'disarmed'; return state; }
      if (nowMs >= deadline) { state = 'fired'; }
      return state;
    },
    // #251 item 1: re-arm a FIRED backstop once, at a later deadline. Refused —
    // false, nothing changes — while armed or disarmed, after one extension, or
    // for a deadline that is not strictly later. `!(deadlineMs > deadline)` also
    // refuses NaN/undefined, which `<=` would let through.
    // Fix round 1 (F3, council C1/D1): the deadline must also be strictly later than
    // `nowMs`, the caller's clock — an extension that has already elapsed grants nothing
    // and must not be recorded as granted. A stalled poll (a long `getMessages`) can put
    // `Date.now()` past `clockStartedAt + extendedMs` before the tick that fires, and the
    // re-armed backstop would then fire again on its very next tick while the record and
    // the death report both claimed a window the leg never got. `!(nowMs < deadlineMs)`
    // refuses NaN and undefined for the same reason the deadline guard is written that way.
    extend(deadlineMs, nowMs) {
      if (state !== 'fired' || extended || !(deadlineMs > deadline) || !(nowMs < deadlineMs)) { return false; }
      deadline = deadlineMs;
      extended = true;
      state = 'armed';
      return true;
    },
    state() { return state; },
    deadline() { return deadline; },
    extended() { return extended; },
  };
}

/**
 * The window a leg gets when it is given more time: doubled, clamped STRICTLY
 * below the leg cap. This is the Stage-1 retry's formula (#219) and, since #251
 * item 1, the one extension's — one function, re-exported by
 * council/run-retry-window.js, whose docblock holds the measured reasoning.
 * `2 * 0 === 0` keeps a disabled backstop disabled.
 * @param {number} baseMs the window in force
 * @param {number} legTimeoutMs the per-leg hard cap
 * @returns {number}
 */
function extendWindowMs(baseMs, legTimeoutMs) {
  return Math.min(2 * baseMs, Math.floor(legTimeoutMs * 0.95));
}

/**
 * #251 item 1 fix round 1 (F3) — render an epoch as an instant, or as itself.
 *
 * `status.next` is ENGINE-supplied and untrusted, and `Number.isFinite` does not
 * bound the Date range: a unit bug upstream (µs or ns where ms was meant) puts
 * `|next| > 8.64e15` on the wire, and `new Date(next).toISOString()` throws
 * `RangeError: Invalid time value`. Its caller runs on the KILL path, inside the
 * poll body's own `catch (pollError)` — so the throw did not even surface as a
 * named death: it was swallowed as a poll failure, the counter resets at the top
 * of every poll, and a fired backstop re-threw on each one until the leg burned
 * its whole `--timeout` and died as an ordinary timeout. MEASURED before the fix
 * (W11 hung to Jest's 20s ceiling on a 60s leg).
 *
 * The record keeps the FACT — the engine scheduled its next attempt past the
 * window — and reports the raw number when it cannot be an instant. A timestamp
 * nobody can read is still evidence; a lost classification is not.
 * @param {number} ms
 * @returns {string}
 */
function isoOrNumber(ms) {
  try { return new Date(ms).toISOString(); } catch (_) { return String(ms); }
}

/** Council #269 r2 (A2/D3) — the ONE classification of a session status, shared by
 *  `decideBackstopExtension` and `undecidedBackstopRecord` so the two firing sites can never
 *  classify the same status differently. ENGINE evidence (a renderable status the engine published,
 *  not an amicus probe outcome) records its SANITISED type; anything else records 'unknown'. */
function isEngineStatus(status) { return isRenderableStatus(status) && !isProbeOutcome(status); }
function statusTypeOf(status) {
  return isEngineStatus(status) ? collapseExcerpt(status.type, MAX_STATUS_TYPE_CHARS) : 'unknown';
}

/**
 * The record for a kill that never reaches the decision — today only the pre-send firing site
 * (the engine did not return from the prompt send; spec R3). Pure, total: the status is
 * classified exactly as decideBackstopExtension classifies it, and nothing here can throw
 * (council #269 r2, A2/D3). That site used to build this record by calling
 * `decideBackstopExtension` UNGUARDED and then discarding its verdict — a call to a function
 * that CAN throw, on a kill path, for an answer the site is forbidden to act on.
 * @param {{status:*, windowMs:number, firedAtMs:number, why:'pre-send'}} a
 * @returns {object} an isBackstopRecord-valid record with extended: false
 */
function undecidedBackstopRecord({ status, windowMs, firedAtMs, why }) {
  return { windowMs: Math.floor(windowMs), firedAtMs: Math.floor(firedAtMs), status: statusTypeOf(status), extended: false, why };
}

/**
 * #251 item 1 — the decision at the poll-loop firing site (spec 2026-09-18 §3),
 * as a pure function so every row is testable without the poll loop.
 * Classifies on the RAW `status.type` and records the SANITISED identifier —
 * the #219 r2 rule in session-status.js: display never decides semantics.
 * The `!isProbeOutcome` conjunct is documentary: `probeUnknown` always publishes
 * `type: 'unknown'`, so no fixture can distinguish it — it states the rule (a
 * probe outcome is never engine evidence) rather than adding a branch.
 *
 * Fix round 1 (F2, council B2): a `retry` whose `next` falls EXACTLY on the extended
 * deadline is beyond the window, not inside it — `next >= extendTo` kills. An attempt
 * firing at the very instant the backstop fires cannot have produced a persisted part
 * before the tick, so extending to meet it buys a window with nothing in it.
 *
 * Fix round 1 (D2, council glm, answered): `status.next` is an epoch-ms timestamp from
 * the engine, a LOCAL process on the same machine — the poll loop already compares it
 * with this process's own clock (`headless.js`, `lastSdkRetryNext > deadline` in the
 * RETRY_BEYOND_DEADLINE gate) — so it is compared here against a deadline derived from
 * `Date.now()` without a skew correction, and a non-finite `next` is treated as
 * unscheduled by the same `Number.isFinite` rule that site uses.
 *
 * Fix round 2 (D1, council deepseek, answered): a `retry` whose `next` is already in the PAST
 * still extends — a past `next` with the status still `retry` means the engine is BETWEEN
 * attempts (it fired and the status has not yet moved to `busy`); the owner ruled "extend once
 * on busy/retry", and `headless.js`'s `RETRY_BEYOND_DEADLINE` gate treats a past `next` the
 * same way (it acts only on `next > deadline`).
 * @param {{status:*, windowMs:number, firedAtMs:number, legTimeoutMs:number, clockStartedAt:number}} a
 *   status — sessionStatusSafe's answer: an engine SessionStatus or a probeUnknown outcome
 *   windowMs — the window in force at this firing; firedAtMs — elapsed on the backstop's clock
 *   legTimeoutMs — the leg cap; clockStartedAt — the backstop's clock origin (epoch ms)
 * @returns {{extendTo: number|null, record: object}} extendTo is the new deadline (epoch ms) or null
 */
function decideBackstopExtension({ status, windowMs, firedAtMs, legTimeoutMs, clockStartedAt }) {
  // #251 item 1 fix round 1 (F2): the record must be valid by construction — floor here rather
  // than trust the caller's inputs to already be integers (envNumber accepts any finite number,
  // fractions included), so isBackstopRecord never rejects what this function just built.
  const record = { windowMs: Math.floor(windowMs), firedAtMs: Math.floor(firedAtMs), status: statusTypeOf(status), extended: false };
  if (!isEngineStatus(status) || (status.type !== 'busy' && status.type !== 'retry')) { return { extendTo: null, record }; }
  const extendedMs = Math.floor(extendWindowMs(windowMs, legTimeoutMs));
  if (!(extendedMs > windowMs)) { return { extendTo: null, record: { ...record, why: 'at-cap' } }; }
  const extendTo = clockStartedAt + extendedMs;
  if (status.type === 'retry' && Number.isFinite(status.next) && status.next >= extendTo) {
    return { extendTo: null, record: { ...record, why: 'retry-beyond-window', retryNextIso: isoOrNumber(status.next) } };
  }
  return { extendTo, record: { ...record, extended: true, extendedToMs: Math.floor(extendedMs) } };
}

/**
 * Is this the record decideBackstopExtension writes — and nothing else? Every
 * writer of a leg document uses this before copying the field, so a forged or
 * partial object is dropped, never coerced (spec §5.2).
 * @param {*} x
 * @returns {boolean}
 */
function isBackstopRecord(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) { return false; }
  if (!Object.keys(x).every((k) => RECORD_KEYS.has(k))) { return false; }
  if (!(Number.isInteger(x.windowMs) && x.windowMs >= 0)) { return false; }
  if (!(Number.isInteger(x.firedAtMs) && x.firedAtMs >= 0)) { return false; }
  // #251 item 1 fix round 1 (F4): the identifier must already be sanitised — this pair's own
  // docblocks claim "no untrusted text enters" the clause, a property only the PRODUCER
  // (decideBackstopExtension, which records collapseExcerpt(status.type, ...)) can guarantee;
  // requiring the fixed point here makes the predicate enforce what it claims.
  if (typeof x.status !== 'string' || x.status === '' || collapseExcerpt(x.status, MAX_STATUS_TYPE_CHARS) !== x.status) { return false; }
  if (typeof x.extended !== 'boolean') { return false; }
  if (x.extended) {
    return Number.isInteger(x.extendedToMs) && x.extendedToMs > x.windowMs && x.why === undefined && x.retryNextIso === undefined;
  }
  if (x.extendedToMs !== undefined) { return false; }
  if (x.why === undefined) { return x.retryNextIso === undefined; }
  if (!BACKSTOP_WHY.includes(x.why)) { return false; }
  return x.why === 'retry-beyond-window' ? typeof x.retryNextIso === 'string' && x.retryNextIso !== '' : x.retryNextIso === undefined;
}

/**
 * The death report's fourth clause (spec §5.1). Append-only: '' whenever the
 * record has nothing to say (idle, unknown, an unknown arm, the pre-send site,
 * or not a record at all), so every such reason string is byte-identical to
 * one built before this clause existed. Every value here is a number amicus
 * measured, a sanitised type identifier, or an ISO timestamp amicus formatted
 * (or the raw number, when the engine publishes a `next` outside the Date
 * range) — no untrusted text enters.
 * @param {*} record
 * @returns {string}
 */
function formatBackstopExtensionClause(record) {
  if (!isBackstopRecord(record)) { return ''; }
  const s = (ms) => `${Math.round(ms / 1000)}s`;
  if (record.extended) {
    // Council #269 r2 (D4): whole-second rounding rendered a REAL extension as "from 3s to 3s"
    // whenever the two round the same way — the 0.95 clamp does exactly that (2800 → 2850). A
    // collision renders BOTH in ms (`firedAtMs` collides with nothing); 480 000 → 912 000 does not.
    const collide = Math.round(record.windowMs / 1000) === Math.round(record.extendedToMs / 1000);
    const from = collide ? `${record.windowMs}ms` : s(record.windowMs);
    const to = collide ? `${record.extendedToMs}ms` : s(record.extendedToMs);
    return ` — window extended once from ${from} to ${to} at ${s(record.firedAtMs)} on session ${record.status}`;
  }
  // Council #269 r2 (A1): the window that cannot be extended sits at the 0.95 CLAMP, strictly
  // BELOW the leg cap (the schema's gloss, "already at the leg-cap clamp", was right all along).
  // Only the sentence was wrong — the `at-cap` TOKEN every reader matches on is unchanged.
  if (record.why === 'at-cap') { return ' — not extended: the window is already at its clamp below the leg cap'; }
  if (record.why === 'retry-beyond-window') {
    return ` — not extended: the engine schedules its next attempt at ${record.retryNextIso}, past the extended window`;
  }
  // Fix round 1 (F3, council C1/D1): the extension was decided and then refused because
  // its deadline had already passed — the leg got nothing, and the report must say so.
  if (record.why === 'elapsed') { return ' — not extended: the extended window had already passed when the decision ran'; }
  return '';
}

module.exports = {
  resolveNoOutputBackstopMs, createNoOutputBackstop, extendWindowMs, decideBackstopExtension,
  undecidedBackstopRecord, isBackstopRecord, formatBackstopExtensionClause, BACKSTOP_WHY,
  DEFAULT_NO_OUTPUT_BACKSTOP_MS,
};
