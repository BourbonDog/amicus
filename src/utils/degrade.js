'use strict';

/**
 * @module utils/degrade
 * The degrade/heal record: one shape, one vocabulary, shared by the council
 * runtime and `doctor`. Pure — no I/O, no council knowledge.
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
  'internal',
  // doctor channels
  'doctor-check-failed', 'doctor-fix',
]));

const KINDS = Object.freeze(new Set(['degrade', 'heal']));
const REQUIRED = ['what', 'why', 'effect'];

function makeDegrade(input = {}) {
  const kind = input.kind === undefined ? 'degrade' : input.kind;
  if (!KINDS.has(kind)) {
    throw new Error(`degrade: unknown kind '${kind}' (expected 'degrade' or 'heal')`);
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
  const lead = record.kind === 'heal' ? 'Recovered' : 'Notice';
  const remedy = record.remedy ? ` Try: ${record.remedy}.` : '';
  return `${lead}: ${record.what} — ${record.why}. ${record.effect}.${remedy}\n`;
}

module.exports = { makeDegrade, formatDegrade, DEGRADE_CHANNELS };
