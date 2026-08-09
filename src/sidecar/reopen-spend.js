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
 * dropped usage - BACKLOG.md:280). Best-effort ledger append; never throws.
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
      appendSpend({ taskId, model, mode, usage, op, status, project, gateway }, ctx);
    } catch { /* best-effort */ }
  }
  return { usage };
}

module.exports = { finalizeSpendForReopen };
