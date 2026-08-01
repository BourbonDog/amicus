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
  'dead-leg', 'dead-wave', 'budget-refusal', 'shared-server-unavailable',
  'dropped-members', 'chair-skipped-cost-ceiling', 'chair-failed',
  'thin-cross-review', 'debate-degraded', 'inexact-under-ceiling',
  'internal',
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
  return Object.freeze(record);
}

module.exports = { makeDegrade, DEGRADE_CHANNELS };
