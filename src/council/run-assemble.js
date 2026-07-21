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
const { validateFindings } = require('./findings');
const { toGlobalFindings } = require('./anonymize');

const CONFORMANCE_RANK = { clean: 0, repaired: 1, unstructured: 2 };

/** v4.1 §4.4: the reserved seat name for the file-sourced Claude review. */
const CLAUDE_SEAT = 'claude';
const CLAUDE_REVIEW_ERROR = 'COUNCIL_CLAUDE_REVIEW_INVALID';

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
 * Pre-flight for `--claude-review <path>` (v4.1 §4.4). Runs AFTER initRun (so the
 * error doc lands in a run dir that exists) and BEFORE any launch, so an invalid
 * file costs zero spend. The orchestrator authored the file, so there is no repair
 * loop — fix and relaunch is free.
 * @param {{claudeReviewFile: ?string, chair: ?string}} o run options
 * @returns {{claudeReview: object|null, error: ?{code: string, message: string}}}
 */
function preflightClaudeReview(o) {
  if (!o.claudeReviewFile) { return { claudeReview: null, error: null }; }
  const bad = (detail) => ({ claudeReview: null,
    error: { code: CLAUDE_REVIEW_ERROR, message: `council_claude_review_invalid: ${detail}` } });
  if (o.chair === CLAUDE_SEAT) {
    return bad('claude may not chair (it is judged, never votes or chairs)');
  }
  let text = '';
  try { text = fs.readFileSync(o.claudeReviewFile, 'utf-8'); }
  catch (e) { return bad(`cannot read ${o.claudeReviewFile}: ${e.message}`); }
  const v = validateFindings(text);
  if (!v.ok) { return bad(v.errors.map(e => `${e.code}: ${e.detail}`).join('; ')); }
  return { claudeReview: { model: CLAUDE_SEAT, text, findings: v.findings }, error: null };
}

/**
 * Stamp the file-sourced Claude review with its label (always the LAST entry —
 * review N+1) and its run-global finding ids. Mutates + returns the new ids so
 * run.js can concat them onto the bench's globalFindings in one expression.
 * @returns {Array<object>} claude's run-global findings
 */
function labelClaudeReview(claudeReview, labels) {
  const e = labels.entries[labels.entries.length - 1];
  claudeReview.label = e.label;
  claudeReview.globalFindings = toGlobalFindings(e.letter, CLAUDE_SEAT, claudeReview.findings);
  return claudeReview.globalFindings;
}

/**
 * The synthesized runStats row for a review that never ran a leg (v4.1 §4.4).
 * durationMs/usage are null per the never-invent rule — nothing was launched.
 */
function claudeRunStatsRow() {
  return { model: CLAUDE_SEAT, role: CLAUDE_SEAT, wasChair: false, conformance: 'clean',
    status: 'complete', durationMs: null, usage: null };
}

/**
 * Assemble the five-keys tally input (spec §5 / SKILL.md Stage-2 recipe).
 * @param {{runId: string, date: string, bench: string[], chair: string,
 *   reviews: Array<{model, role, conformance, leg, globalFindings}>,
 *   judgeResults: Array<{judge, ok, order, adjudications}>,
 *   chairStats: object|null, claudeReview?: object|null}} args
 *   `claudeReview` (v4.1 §4.4) amends the v4.0 meta pin: present ⇒ claudeInCouncil
 *   true, 'claude' joins meta.models (the street-cred universe), its findings join
 *   the pool and it gets the synthesized null-usage runStats row. Absent ⇒ v4.0
 *   output byte-for-byte.
 */
function buildTallyInput({ runId, date, bench, chair, reviews, judgeResults, chairStats,
  claudeReview }) {
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
  if (claudeReview) {
    meta.models.push(CLAUDE_SEAT);      // last, mirroring its review-N+1 label
    meta.claudeInCouncil = true;
    findings.push(...claudeReview.globalFindings);
    runStats.push(claudeRunStatsRow());
  }
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
  preflightClaudeReview, labelClaudeReview, claudeRunStatsRow, CLAUDE_SEAT,
};
