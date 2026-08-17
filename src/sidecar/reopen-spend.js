/**
 * @module sidecar/reopen-spend
 * Spend finalization for a REOPENED session (continue/resume). Split out of
 * sidecar/continue.js to keep that file under the 300-line gate; resume.js was
 * already reaching across for it, so the shared home is the honest one.
 */

'use strict';

/**
 * Resolve a reopened session's usage, write it onto metadata, and append one
 * attributed ledger row. Mirrors start.js's finalize (the only sites that
 * dropped usage - BACKLOG.md :: "continue/resume never compute per-run usage" — ⚠️ cited `BACKLOG.md:280` until T-A8 re-opened it 2026-08-17: `:280` is a docs/usage.md line, the entry is `:289`). Best-effort ledger append; never throws.
 * @returns {{usage: object|null}}
 */
function finalizeSpendForReopen({ taskId, model, mode, op, result, status, project, metadata }, ctx = {}) {
  const { resolveUsage } = require('../utils/pricing');
  const usage = result && result.usage ? resolveUsage({ model, usageTotals: result.usage }) : null;
  if (usage) {
    metadata.usage = usage; // buildRunResult surfaces metadata.usage into the --json doc for free
    try {
      const { appendSpend } = require('../utils/spend-ledger');
      const gateway = metadata.gateway || (String(model).startsWith('openrouter/') ? 'openrouter' : 'direct');
      // v4.7.1 Task 7 D16: null-not-absent, the OPPOSITE convention from
      // metadata.tag's absent-not-null (D13) — same `|| null` idiom as start.js:237.
      appendSpend({ taskId, model, mode, usage, op, status, project, gateway, tag: metadata.tag || null }, ctx);
    } catch { /* best-effort */ }
  }
  return { usage };
}

module.exports = { finalizeSpendForReopen };
