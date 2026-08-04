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
 * terminal. `ms <= 0` never arms — 0 is the documented escape hatch, which
 * is why the env resolver uses envNumber (explicit 0 honored) rather than
 * the `Number(env) || default` idiom.
 *
 * PR3's live probe reuses this with a 30s override — ms is an input; only
 * the exported resolver reads the environment.
 */
'use strict';

const { envNumber } = require('./env-num');

const DEFAULT_NO_OUTPUT_BACKSTOP_MS = 120000;

/** @param {object} [env] test seam; defaults to process.env */
function resolveNoOutputBackstopMs(env) {
  return envNumber('AMICUS_NO_OUTPUT_BACKSTOP_MS', DEFAULT_NO_OUTPUT_BACKSTOP_MS, env);
}

/**
 * @param {{ms:number, startedAt:number}} opts
 * @returns {{tick:(progressed:boolean, nowMs:number)=>string, state:()=>string}}
 */
function createNoOutputBackstop({ ms, startedAt }) {
  let state = ms > 0 ? 'armed' : 'disarmed';
  const deadline = startedAt + ms;
  return {
    tick(progressed, nowMs) {
      if (state !== 'armed') { return state; }
      if (progressed) { state = 'disarmed'; return state; }
      if (nowMs >= deadline) { state = 'fired'; }
      return state;
    },
    state() { return state; },
  };
}

module.exports = { resolveNoOutputBackstopMs, createNoOutputBackstop, DEFAULT_NO_OUTPUT_BACKSTOP_MS };
