// src/council/run-assemble.js
'use strict';

/**
 * @module council/run-assemble
 * Pure assembly + artifact emission for the headless council engine (spec §5):
 * the five-keys tally input (meta pins: claudeInCouncil false, models = bench
 * seats exactly — critic included, chair excluded — runType 'headless'),
 * runStats rows copied verbatim from leg docs, and the run-dir artifact set
 * (tally-input.json, tally.json, verdict.json with overallVerdict, report.html,
 * chair-output.md). Raiser self-votes are INCLUDED in adjudications — exclusion
 * is tally's job (tally.js:95); judged is tally's job (tally.js:110).
 */

const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('../utils/atomic-write');
const { buildVerdict, writeVerdictAtomic } = require('./verdict');
const { buildReport } = require('./report');

const CONFORMANCE_RANK = { clean: 0, repaired: 1, unstructured: 2 };

/** Worst-wins merge of Stage-1 findings conformance and Stage-2 judge conformance. */
function worseConformance(a, b) {
  return (CONFORMANCE_RANK[a] || 0) >= (CONFORMANCE_RANK[b] || 0) ? a : b;
}

/**
 * One runStats row from a leg run document. Verbatim copies only — a missing
 * leg doc yields durationMs/usage null (never invent a value). `model` (the
 * council alias) overrides leg.model (the resolved executable id) so ledger
 * rows join meta.models by exact string (ledger.js:20-24).
 */
function buildRunStatsEntry({ leg, model, role, wasChair, conformance }) {
  return {
    model: model !== undefined ? model : (leg ? leg.model : null),
    role,
    wasChair: !!wasChair,
    conformance: conformance || 'clean',
    status: leg ? leg.status : 'error',
    durationMs: leg && typeof leg.durationMs === 'number' ? leg.durationMs : null,
    usage: (leg && leg.usage) || null,
  };
}

/**
 * Assemble the five-keys tally input (spec §5 / SKILL.md Stage-2 recipe).
 * @param {{runId: string, date: string, bench: string[], chair: string,
 *   reviews: Array<{model, role, conformance, leg, globalFindings}>,
 *   judgeResults: Array<{judge, ok, order, adjudications}>,
 *   chairStats: object|null}} args
 */
function buildTallyInput({ runId, date, bench, chair, reviews, judgeResults, chairStats }) {
  const meta = {
    runId, date, runType: 'headless',
    models: bench.slice(),          // bench seats exactly: critic included, chair excluded
    chair,
    claudeInCouncil: false,         // pinned for headless runs
  };
  const findings = reviews.flatMap(r => r.globalFindings);
  const okJudges = judgeResults.filter(j => j.ok);
  const adjudications = okJudges.flatMap(j =>
    j.adjudications.map(a => ({ findingId: a.id, judge: j.judge, verdict: a.verdict })));
  const rankings = okJudges.map(j => ({ judge: j.judge, order: j.order }));
  const runStats = reviews.map(r => buildRunStatsEntry({
    leg: r.leg, model: r.model, role: r.role, wasChair: false, conformance: r.conformance,
  }));
  if (chairStats) { runStats.push(chairStats); }
  return { meta, findings, adjudications, rankings, runStats };
}

/** Persist the assembled input (auditability) and the tally record. */
function writeTallyFiles({ runDir, tallyInput, record }) {
  writeFileAtomic(path.join(runDir, 'tally-input.json'),
    JSON.stringify(tallyInput, null, 2), { mode: 0o600 });
  writeFileAtomic(path.join(runDir, 'tally.json'),
    JSON.stringify(record, null, 2), { mode: 0o600 });
}

/**
 * Undecided verdict + deterministic report. Sets the nullable overallVerdict
 * (council family v2, Plan A) on buildVerdict's output — independent of
 * buildVerdict's own signature.
 * @returns {object} the verdict written to disk
 */
function writeVerdictFiles({ runDir, record, overallVerdict, chairText }) {
  const verdict = buildVerdict(record, []);
  verdict.overallVerdict = (overallVerdict === undefined) ? null : overallVerdict;
  writeVerdictAtomic(path.join(runDir, 'verdict.json'), verdict);
  const html = buildReport({ verdict }, { format: 'html' });
  fs.writeFileSync(path.join(runDir, 'report.html'), html, { mode: 0o600 });
  if (chairText) {
    fs.writeFileSync(path.join(runDir, 'chair-output.md'), chairText, { mode: 0o600 });
  }
  return verdict;
}

module.exports = {
  buildRunStatsEntry, worseConformance, buildTallyInput, writeTallyFiles, writeVerdictFiles,
};
