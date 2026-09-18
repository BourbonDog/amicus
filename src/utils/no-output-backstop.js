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

/** The reasons a busy/retry session was NOT extended (spec 2026-09-18 §5.2). */
const BACKSTOP_WHY = ['at-cap', 'retry-beyond-window', 'pre-send'];

/** @param {object} [env] test seam; defaults to process.env */
function resolveNoOutputBackstopMs(env) {
  return envNumber('AMICUS_NO_OUTPUT_BACKSTOP_MS', DEFAULT_NO_OUTPUT_BACKSTOP_MS, env);
}

/**
 * @param {{ms:number, startedAt:number}} opts
 * @returns {{tick:(progressed:boolean, nowMs:number)=>string, extend:(deadlineMs:number)=>boolean,
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
    extend(deadlineMs) {
      if (state !== 'fired' || extended || !(deadlineMs > deadline)) { return false; }
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
 * #251 item 1 — the decision at the poll-loop firing site (spec 2026-09-18 §3),
 * as a pure function so every row is testable without the poll loop.
 * Classifies on the RAW `status.type` and records the SANITISED identifier —
 * the #219 r2 rule in session-status.js: display never decides semantics.
 * @param {{status:*, windowMs:number, firedAtMs:number, legTimeoutMs:number, clockStartedAt:number}} a
 *   status — sessionStatusSafe's answer: an engine SessionStatus or a probeUnknown outcome
 *   windowMs — the window in force at this firing; firedAtMs — elapsed on the backstop's clock
 *   legTimeoutMs — the leg cap; clockStartedAt — the backstop's clock origin (epoch ms)
 * @returns {{extendTo: number|null, record: object}} extendTo is the new deadline (epoch ms) or null
 */
function decideBackstopExtension({ status, windowMs, firedAtMs, legTimeoutMs, clockStartedAt }) {
  const isEngine = isRenderableStatus(status) && !isProbeOutcome(status);
  const type = isEngine ? collapseExcerpt(status.type, MAX_STATUS_TYPE_CHARS) : 'unknown';
  const record = { windowMs, firedAtMs, status: type, extended: false };
  if (!isEngine || (status.type !== 'busy' && status.type !== 'retry')) { return { extendTo: null, record }; }
  const extendedMs = extendWindowMs(windowMs, legTimeoutMs);
  if (!(extendedMs > windowMs)) { return { extendTo: null, record: { ...record, why: 'at-cap' } }; }
  const extendTo = clockStartedAt + extendedMs;
  if (status.type === 'retry' && Number.isFinite(status.next) && status.next > extendTo) {
    return { extendTo: null, record: { ...record, why: 'retry-beyond-window', retryNextIso: new Date(status.next).toISOString() } };
  }
  return { extendTo, record: { ...record, extended: true, extendedToMs: extendedMs } };
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
  if (!(Number.isInteger(x.windowMs) && x.windowMs >= 0)) { return false; }
  if (!(Number.isInteger(x.firedAtMs) && x.firedAtMs >= 0)) { return false; }
  if (typeof x.status !== 'string' || x.status === '') { return false; }
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
 * measured, a sanitised type identifier, or an ISO timestamp amicus formatted —
 * no untrusted text enters.
 * @param {*} record
 * @returns {string}
 */
function formatBackstopExtensionClause(record) {
  if (!isBackstopRecord(record)) { return ''; }
  const s = (ms) => `${Math.round(ms / 1000)}s`;
  if (record.extended) {
    return ` — window extended once from ${s(record.windowMs)} to ${s(record.extendedToMs)} at ${s(record.firedAtMs)} on session ${record.status}`;
  }
  if (record.why === 'at-cap') { return ' — not extended: the window is already at the leg cap'; }
  if (record.why === 'retry-beyond-window') {
    return ` — not extended: the engine schedules its next attempt at ${record.retryNextIso}, past the extended window`;
  }
  return '';
}

module.exports = {
  resolveNoOutputBackstopMs, createNoOutputBackstop, extendWindowMs, decideBackstopExtension,
  isBackstopRecord, formatBackstopExtensionClause, BACKSTOP_WHY, DEFAULT_NO_OUTPUT_BACKSTOP_MS,
};
