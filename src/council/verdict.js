// src/council/verdict.js
'use strict';
const fs = require('fs');

// v4.0 §7: council family v2 — verdict docs carry {schemaVersion, type} and a
// nullable overallVerdict (the chair's Ship-it line; populated by the headless
// engine in Plan B via opts.overallVerdict, null in every Stage-4 manual path).
const VERDICT_SCHEMA_VERSION = 2;

/**
 * Merge a tally record with Claude's Stage-4 decisions into the verdict record.
 * @param {object} record  tally() output
 * @param {Array<{id,decision,applied,duplicateOf,tierOverride}>} decisions
 * @param {{overallVerdict?: (string|null)}} [opts] engine hook (Plan B): the
 *   parsed chair `VERDICT:` line; omitted/undefined → null.
 */
function buildVerdict(record, decisions = [], opts = {}) {
  const byId = new Map(decisions.map(d => [d.id, d]));
  return {
    schemaVersion: VERDICT_SCHEMA_VERSION,
    type: 'council-verdict',
    runId: record.meta.runId,
    runType: record.meta.runType,
    date: record.meta.date,
    chair: record.meta.chair,
    council: record.meta.models,
    claudeInCouncil: record.meta.claudeInCouncil,
    overallVerdict: opts.overallVerdict === undefined ? null : opts.overallVerdict,
    findings: record.findings.map(f => {
      const d = byId.get(f.id) || {};
      const tierOverride = d.tierOverride || f.tierOverride || null;
      return {
        id: f.id, raiser: f.raiser, severity: f.severity,
        tier: tierOverride ? tierOverride.to : f.tier,
        basis: f.basis, confidence: f.confidence, tierOverride,
        duplicateOf: d.duplicateOf || null,
        adjudications: f.adjudications,
        decision: d.decision || null,
        applied: d.applied === true,
      };
    }),
    streetCred: record.streetCred.map(s => ({ model: s.model, withSelf: s.withSelf, peersOnly: s.peersOnly })),
    runStats: record.runStats,
    tierCounts: record.tierCounts,
  };
}

/** Atomic write: tmp + rename (matches the repo's wave.json convention). */
function writeVerdictAtomic(filePath, verdict) {
  const tmp = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(verdict, null, 2));
  fs.renameSync(tmp, filePath);
}

module.exports = { buildVerdict, writeVerdictAtomic, VERDICT_SCHEMA_VERSION };
