// src/council/verdict.js
'use strict';
const fs = require('fs');
const path = require('path');
const { parseChairVerdict } = require('./parse-stage2');

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
      const out = {
        id: f.id, raiser: f.raiser, severity: f.severity,
        tier: tierOverride ? tierOverride.to : f.tier,
        basis: f.basis, confidence: f.confidence, tierOverride,
        duplicateOf: d.duplicateOf || null,
        adjudications: f.adjudications,
        decision: d.decision || null,
        applied: d.applied === true,
      };
      if (f.debate) { out.debate = f.debate; }   // v4.1: additive debate decoration carry-through (spec §5.6)
      return out;
    }),
    streetCred: record.streetCred.map(s => ({ model: s.model, withSelf: s.withSelf, peersOnly: s.peersOnly })),
    runStats: record.runStats,
    tierCounts: record.tierCounts,
  };
}

/**
 * Recover the chair's overall verdict for a run folder.
 *
 * The chair's synthesis is the council's most valuable output and it is stored
 * in exactly two places: the engine's `verdict.json` (parsed) and
 * `chair-output.md` (prose). Neither `tally.json` nor `run.json` carries a
 * copy — so the Stage-5 step that REPLACES `verdict.json` from `tally.json`
 * must read the verdict back out of the run folder first, or it destroys it.
 *
 * Preference order, both anchored on the run dir (never on the `-o` path — the
 * verdict belongs to the run, not to wherever the caller writes the result):
 *   1. `<runDir>/verdict.json` `overallVerdict` — the value the engine already
 *      parsed. Guarded by `runId`: a stale or foreign verdict.json sitting in
 *      the folder must never inject another run's chair line.
 *   2. `<runDir>/chair-output.md`, re-parsed with the engine's own
 *      `parseChairVerdict`, so there is no second parser to drift. This also
 *      recovers runs whose verdict.json was already nulled by the defect.
 *
 * Never invents: an absent, skipped, or unstructured chair yields null.
 * @param {string} runDir
 * @param {string} [runId] record.meta.runId — the run being rebuilt
 * @returns {string|null} a canonical chair verdict phrase, or null
 */
function readOverallVerdict(runDir, runId) {
  try {
    const prior = JSON.parse(fs.readFileSync(path.join(runDir, 'verdict.json'), 'utf-8'));
    if (typeof prior.overallVerdict === 'string' && prior.overallVerdict
      && (!runId || prior.runId === runId)) {
      return prior.overallVerdict;
    }
  } catch { /* no prior verdict.json, or unreadable — try the chair prose */ }
  try {
    return parseChairVerdict(fs.readFileSync(path.join(runDir, 'chair-output.md'), 'utf-8'));
  } catch { /* no chair-output.md — the chair genuinely produced nothing */ }
  return null;
}

/** Atomic write: tmp + rename (matches the repo's wave.json convention). */
function writeVerdictAtomic(filePath, verdict) {
  const tmp = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(verdict, null, 2));
  fs.renameSync(tmp, filePath);
}

module.exports = { buildVerdict, readOverallVerdict, writeVerdictAtomic, VERDICT_SCHEMA_VERSION };
