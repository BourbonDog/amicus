'use strict';

/**
 * @module utils/degrade
 * The degrade/heal/info record: one shape, one vocabulary, shared by the
 * council runtime and `doctor`. Pure — no I/O, no council knowledge.
 *
 * WHY validation lives here and THROWS: it is what makes the announcement
 * contract real. A degrade that does not say what was lost, why, and what it
 * cost cannot be constructed. Callers never see the throw — run-degrade.js's
 * sink catches it and converts it into an `internal` degrade (spec §7).
 */

const DEGRADE_CHANNELS = Object.freeze(new Set([
  // council runtime channels
  'dead-leg', 'dead-wave', 'budget-refusal', 'shared-server-unavailable',
  'dropped-members', 'chair-skipped-cost-ceiling', 'chair-failed',
  'thin-cross-review', 'debate-degraded', 'inexact-under-ceiling',
  'stage1-retry',
  // #218 PR 3: a Stage-1 review the provider cut at the max_tokens reservation
  // (the leg's `finish` is 'length' and it still carried answer text). kind
  // 'info' only -- the review is in the packet, nothing was lost, the exit code
  // does not move; the chair just reads a review that ends where the
  // reservation ended. A cut with NO answer text is a dead leg (leg.error
  // starts `OUTPUT_LENGTH:`) and rides `dead-leg` like every other death.
  'output-truncated',
  // v4.9 task mode: a task run writes no reliability-ledger rows — announced as kind:'info'.
  'ledger-skipped',
  // v4.8: the seat<->leg join failed. THREE shapes, one channel: a launched seat whose wave
  // returned legs but none its own; a returned leg matching no roster slot; and (T5.5, `-rv` only)
  // a leg that DID match a slot but whose join key names no judge the wave launched.
  // Never a guess — silent mis-attribution is the failure seat identity exists to kill (§4.4).
  'seat-unbound',
  // #202: a Stage-2 JUDGE leg that came back dead — bound to its seat, so
  // neither `seat-unbound` nor an orphan, and until now it had no channel at all
  // and no case in run-stage2.js. Deliberately its own channel rather than
  // `dead-leg`: that one is the Stage-1 BENCH roster's, feeds the retry pass and
  // the seat-loss surface, and a judge death reused on it would be counted as a
  // lost reviewer by consumers that only ever meant seats (verdict-seat-loss.js
  // already gates the Stage-2 notes out of `seat-unbound` for the same reason).
  'stage2-judge',
  'internal',
  // doctor channels
  'doctor-check-failed', 'doctor-fix',
]));

// 'info' (v4.9): an announcement that is neither a loss nor a recovery — the
// sink records and prints it but never flips `degraded` (run-degrade.js gates
// the flip on kind === 'degrade').
const KINDS = Object.freeze(new Set(['degrade', 'heal', 'info']));
const REQUIRED = ['what', 'why', 'effect'];

function makeDegrade(input = {}) {
  const kind = input.kind === undefined ? 'degrade' : input.kind;
  if (!KINDS.has(kind)) {
    throw new Error(`degrade: unknown kind '${kind}' (expected 'degrade', 'heal', or 'info')`);
  }
  if (!DEGRADE_CHANNELS.has(input.channel)) {
    throw new Error(`degrade: unknown channel '${input.channel}'`);
  }
  for (const f of REQUIRED) {
    if (typeof input[f] !== 'string' || !input[f].trim()) {
      throw new Error(`degrade: '${f}' is required and must be a non-blank string`);
    }
  }
  const record = {
    kind, channel: input.channel,
    what: input.what.trim(), why: input.why.trim(), effect: input.effect.trim(),
  };
  if (typeof input.remedy === 'string' && input.remedy.trim()) {
    record.remedy = input.remedy.trim();
  }
  if (input.data !== undefined) {
    if (typeof input.data !== 'object' || input.data === null || Array.isArray(input.data)) {
      throw new Error("degrade: 'data' must be a plain object when provided");
    }
    record.data = Object.freeze({ ...input.data });
  }
  return Object.freeze(record);
}

/**
 * The ONE voice for every channel. Kept here rather than at call sites so ten
 * channels cannot drift into ten dialects.
 * @param {object} record from makeDegrade
 * @returns {string} one line, newline-terminated
 */
function formatDegrade(record) {
  // Lead map: degrade → Notice, heal → Recovered, info → Note. Anything else
  // (a legacy JSON-parsed record with no kind) keeps the pre-info default, Notice.
  const lead = record.kind === 'heal' ? 'Recovered' : record.kind === 'info' ? 'Note' : 'Notice';
  const remedy = record.remedy ? ` Try: ${record.remedy}.` : '';
  return `${lead}: ${record.what} — ${record.why}. ${record.effect}.${remedy}\n`;
}

module.exports = { makeDegrade, formatDegrade, DEGRADE_CHANNELS };
