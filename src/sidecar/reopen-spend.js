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
      const { gatewayOf } = require('../utils/gateway-router');
      const gateway = metadata.gateway || gatewayOf(model);
      // v4.7.1 Task 7 D16: null-not-absent, the OPPOSITE convention from
      // metadata.tag's absent-not-null (D13) — same `|| null` idiom as start.js:240.
      // #218 PR 3/PR 4: `finish` and `variant` are the OPPOSITE — absent-not-null: appendSpend writes each key only when it is a string. Named mutant "SOLOROWNOVARIANT" (tests/continue-resume-spend.test.js): drop `variant`.
      appendSpend({ taskId, model, mode, usage, op, status, project, gateway, tag: metadata.tag || null, finish: result && result.finish, variant: result && result.variant }, ctx);
    } catch { /* best-effort */ }
  }
  return { usage };
}

module.exports = { finalizeSpendForReopen };
