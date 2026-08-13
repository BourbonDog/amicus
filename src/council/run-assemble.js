// src/council/run-assemble.js
'use strict';

/**
 * @module council/run-assemble
 * Assembly + artifact emission for the headless council engine (spec §5), plus
 * the `--claude-review` pre-flight it now also owns: the five-keys tally input
 * (meta pins: claudeInCouncil false, models = bench seats exactly — critic
 * included, chair excluded — runType 'headless'), runStats rows copied
 * verbatim from leg docs, the run-dir artifact set (tally-input.json,
 * tally.json, verdict.json with overallVerdict, report.html, chair-output.md),
 * v4.1 §4.4 pre-flight validation of the file-sourced Claude review
 * (preflightClaudeReview — the reserved-seat/chair/critic guards), its review-N+1
 * labelling (labelClaudeReview), and its synthesized null-usage runStats row
 * (claudeRunStatsRow). Raiser self-votes are INCLUDED in adjudications —
 * exclusion is tally's job (tally.js:95); judged is tally's job (tally.js:110).
 */

const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('../utils/atomic-write');
const { buildVerdict, summarizeSeatLoss, deriveSeatLoss, writeVerdictAtomic } = require('./verdict');
const { buildReport } = require('./report');
const { validateFindings } = require('./findings');
const { toGlobalFindings } = require('./anonymize');
// Seat identity lives in ./seats (v4.8 PR1) — that module is require-free by
// design, so preflightSeats' body lives there and is re-exported here to keep
// the asm.preflightSeats(o) call spelling and this file under the size gate.
const { preflightSeats } = require('./seats');

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
 * `resolvedModel` (v4.7 GOA-7) preserves leg.model — the executable id that
 * actually served, post-fallback-substitution — emit-only-when-set and never
 * sourced from modelInput (an alias must never masquerade as a resolved id).
 *
 * ⚠️ LC-11 / review F1: `findingsUnverified` and `repairRefused` are the same
 * class of fact as `conformance` and ride the same row. They are the two halves
 * of the repair contract's outcome: `findingsUnverified` marks a 'repaired' seat
 * whose contract could NOT be checked (the original block was absent or
 * unparseable, so there was no finding count to compare), and `repairRefused`
 * ({code, detail}) marks the stronger case — the contract WAS checked and broken,
 * which is otherwise indistinguishable from a seat that never emitted JSON at
 * all. Both are additive and present only when set, so a run without either is
 * byte-for-byte unchanged.
 */
function buildRunStatsEntry({ leg, model, role, wasChair, conformance, findingsUnverified,
  repairRefused }) {
  return {
    model: model !== undefined ? model : (leg ? leg.model : null),
    role,
    wasChair: !!wasChair,
    conformance: conformance || 'clean',
    ...(findingsUnverified ? { findingsUnverified: true } : {}),
    ...(repairRefused ? { repairRefused } : {}),
    ...(leg && leg.waveId ? { waveId: leg.waveId } : {}),
    ...(leg && leg.model ? { resolvedModel: leg.model } : {}),
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
 * @param {{claudeReviewFile: ?string, chair: ?string, critic: ?string, models: ?Array<string>}} o run options
 * @returns {{claudeReview: object|null, error: ?{code: string, message: string}}}
 */
function preflightClaudeReview(o) {
  if (!o.claudeReviewFile) { return { claudeReview: null, error: null }; }
  const bad = (detail) => ({ claudeReview: null,
    error: { code: CLAUDE_REVIEW_ERROR, message: `council_claude_review_invalid: ${detail}` } });
  if (o.chair === CLAUDE_SEAT) {
    return bad('claude may not chair (it is judged, never votes or chairs)');
  }
  if (o.critic === CLAUDE_SEAT) {
    return bad("'claude' is a reserved seat name and cannot be the critic");
  }
  if (Array.isArray(o.models) && o.models.includes(CLAUDE_SEAT)) {
    // 'claude' is a reserved seat name for the file-sourced review N+1 (it
    // joins meta.models synthetically — see buildTallyInput). A real bench
    // leg ALSO named 'claude' would collide on that same key: labelMap gets
    // two 'claude' entries, and ledger.js's Map join lets the synthesized
    // claude row overwrite the real leg's role/conformance/wasChair and
    // double-count findingsRaised — permanently, since the ledger is
    // append-only. Reject it here so every entry point (CLI, MCP, GitHub
    // Action, direct require('./council/run')) is covered, not just the
    // CLI's option whitelist.
    return bad("'claude' is a reserved seat name and cannot also appear in --models");
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
 *   chairStats: object|null, claudeReview?: object|null, extraRows?: Array<object>}} args
 *   `claudeReview` (v4.1 §4.4) amends the v4.0 meta pin: present ⇒ claudeInCouncil
 *   true, 'claude' joins meta.models (the street-cred universe), its findings join
 *   the pool and it gets the synthesized null-usage runStats row. Absent ⇒ v4.0
 *   output byte-for-byte. `extraRows` (v4.7 D2/E4) are pre-built runStats rows
 *   (repair/superseded/dead-seat-error, from runStage1 today) appended right
 *   after the primary review rows, before judge/chair accounting — absent or
 *   empty ⇒ byte-for-byte unchanged, so the pre-v4.7 length-7 pins stay green.
 */
function buildTallyInput({ runId, date, bench, chair, reviews, judgeResults, chairStats,
  claudeReview, extraRows }) {
  const meta = {
    runId, date, runType: 'headless',
    models: bench.slice(),          // bench seats exactly: critic included, chair excluded
    chair,
    claudeInCouncil: false,         // pinned for headless runs
  };
  const findings = reviews.flatMap(r => r.globalFindings);
  const okJudges = judgeResults.filter(j => j.ok);
  const adjudications = okJudges.flatMap(j =>
    j.adjudications.map(a => ({ findingId: a.id, judge: j.judge, verdict: a.verdict,
      // v4.8 PR3 Task 5: emit-when-DIFFERENT (§3.3) — j.seat.id === j.judge on
      // a unique-alias bench, so this stays absent there.
      ...(j.seat && j.seat.id !== j.judge ? { seat: j.seat.id } : {}) })));
  const rankings = okJudges.map(j => ({ judge: j.judge, order: j.order }));
  const runStats = reviews.map(r => buildRunStatsEntry({
    leg: r.leg, model: r.model, role: r.role, wasChair: false, conformance: r.conformance,
    findingsUnverified: r.findingsUnverified, repairRefused: r.repairRefused,
  }));
  // v4.7 D2/E4: pre-built rows (repair/superseded/dead-seat-error) ride right
  // after the primary review rows — same "primary-adjacent" shape, just not
  // sourced from a surviving review. Absent/empty ⇒ no-op (pre-v4.7 byte parity).
  runStats.push(...(extraRows || []));
  if (claudeReview) {
    meta.models.push(CLAUDE_SEAT);      // last, mirroring its review-N+1 label
    meta.claudeInCouncil = true;
    findings.push(...claudeReview.globalFindings);
    runStats.push(claudeRunStatsRow());
  }
  // #83 (v4.6 Plan 2): Stage-2 judge legs are ~38% of a run's cost and had no
  // runStats row at all — per-leg cost was unattributable from the artifact.
  // One row per judge, attributing the judge's ORIGINAL Stage-2 wave leg (never
  // a repair solo's — run-stage2.js mirrors Stage-1's convention there); a judge
  // whose wave leg died still gets an honest error row.
  for (const j of (judgeResults || [])) {
    runStats.push(buildRunStatsEntry({
      leg: j.leg, model: j.judge, role: 'judge', conformance: j.conformance,
    }));
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
 * @param {{runDir: string, record: object, overallVerdict?: (string|null),
 *   chairText?: string, critic?: string, deadWaves?: Array<object>,
 *   degrades?: Array<object>}} o `degrades` (v4.6 Plan 2), when present, is
 *   both carried onto the verdict and used to DERIVE `seatLoss` (deriveSeatLoss)
 *   in preference to summarizing it from `deadWaves` (summarizeSeatLoss).
 * @returns {object} the verdict written to disk
 */
function writeVerdictFiles({ runDir, record, overallVerdict, chairText, critic, deadWaves, degrades }) {
  // v4.6 Plan 2 (spec D3): when the sink's records are available they are the
  // single source of truth — seatLoss derives from them so it can never
  // disagree with degrades[]. deadWaves remains the fallback for direct
  // callers that predate the sink (their tests pass unedited).
  const seatLoss = degrades
    ? deriveSeatLoss({ runId: record.meta.runId, critic, degrades })
    : summarizeSeatLoss({ runId: record.meta.runId, critic, deadWaves });
  const verdict = buildVerdict(record, [], { seatLoss, degrades });
  verdict.overallVerdict = (overallVerdict === undefined) ? null : overallVerdict;
  writeVerdictAtomic(path.join(runDir, 'verdict.json'), verdict);
  const html = buildReport({ verdict }, { format: 'html' });
  fs.writeFileSync(path.join(runDir, 'report.html'), html, { mode: 0o600 });
  if (chairText) {
    fs.writeFileSync(path.join(runDir, 'chair-output.md'), chairText, { mode: 0o600 });
  }
  return verdict;
}

/**
 * Build the chair packet and persist it as `chair-packet.md`. Lifted verbatim
 * out of run.js for the 300-line gate (v4.4.1 Task 0.5) — same composition,
 * same debate addendum, same file write.
 * @param {{runDir: string, reviews: Array, claudeReview: object|null,
 *   tallyInput: object, record: object, debateOutcomes: Array|null, date: string}} args
 *   `tallyInput`/`record` are the DEBATED ones when --debate ran, the
 *   provisional pair otherwise (run.js keeps that sequencing).
 * @returns {string} the packet text (run.js hands it straight to runChair)
 */
function buildChairPacketFile({ runDir, reviews, claudeReview, tallyInput, record, debateOutcomes, date }) {
  const { buildChairPacket } = require('./briefings-stage2');
  const { buildDebateAddendum } = require('./briefings-debate');
  const packet = buildChairPacket({
    // §4.4: the chair sees Claude's de-anonymized review like any other; it casts
    // no rankings/adjudications, so it appears ONLY as one more review block.
    reviews: reviews.map(r => ({ model: r.model, text: r.text }))
      .concat(claudeReview ? [{ model: 'claude', text: claudeReview.text }] : []),
    rankings: tallyInput.rankings,
    adjudications: tallyInput.adjudications,
    tierCounts: record.tierCounts, date,
  }) + (debateOutcomes ? '\n\n' + buildDebateAddendum({ outcomes: debateOutcomes }) : '');
  fs.writeFileSync(path.join(runDir, 'chair-packet.md'), packet, { mode: 0o600 });
  return packet;
}

module.exports = {
  buildRunStatsEntry, worseConformance, buildTallyInput, writeTallyFiles, writeVerdictFiles,
  buildChairPacketFile,
  preflightClaudeReview, labelClaudeReview, claudeRunStatsRow, CLAUDE_SEAT,
  preflightSeats,
};
