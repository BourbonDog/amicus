// src/council/run-assemble.js
'use strict';

/**
 * @module council/run-assemble
 * Assembly + artifact emission for the headless council engine (spec §5), plus
 * the `--claude-review` pre-flight it now also owns: the five-keys tally input
 * (meta pins: claudeInCouncil false, models = bench seats exactly — critic
 * included, chair excluded — runType 'headless'), runStats rows copied
 * verbatim from leg docs, the tally half of the run-dir artifact set
 * (tally-input.json, tally.json — the verdict half moved to
 * ./run-verdict-files and is re-exported below), the chair packet,
 * v4.1 §4.4 pre-flight validation of the file-sourced Claude review
 * (preflightClaudeReview — the reserved-seat/chair/critic guards), its review-N+1
 * labelling (labelClaudeReview), and its synthesized null-usage runStats row
 * (claudeRunStatsRow). Raiser self-votes are INCLUDED in adjudications —
 * exclusion is tally's job (tally.js :: tally — its `peers` filter, and `judged`).
 */

const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('../utils/atomic-write');
const { validateFindings } = require('./findings');
const { toGlobalFindings } = require('./anonymize');
// Seat identity lives in ./seats (v4.8 PR1) — that module is require-free by
// design, so preflightSeats' body lives there and is re-exported here to keep
// the asm.preflightSeats(o) call spelling and this file under the size gate.
const { preflightSeats } = require('./seats');
// Same precedent (v4.8 PR4c): writeVerdictFiles' body lives in
// ./run-verdict-files — with the ./verdict and ./report requires it was the
// sole consumer of — and is re-exported here so the asm.writeVerdictFiles(...)
// call spelling and every existing test survive the move untouched.
const { writeVerdictFiles } = require('./run-verdict-files');
// Same precedent (v4.8 Phase 1 T1.1): buildRunStatsEntry's body lives in
// ./run-stats-entry — which is require-free so consumers outside this file's
// graph can use it — and is re-exported here so every existing call spelling
// survives the move untouched.
const { buildRunStatsEntry } = require('./run-stats-entry');

const CONFORMANCE_RANK = { clean: 0, repaired: 1, unstructured: 2 };

/** v4.1 §4.4: the reserved seat name for the file-sourced Claude review. */
const CLAUDE_SEAT = 'claude';
const CLAUDE_REVIEW_ERROR = 'COUNCIL_CLAUDE_REVIEW_INVALID';

/** Worst-wins merge of Stage-1 findings conformance and Stage-2 judge conformance. */
function worseConformance(a, b) {
  return (CONFORMANCE_RANK[a] || 0) >= (CONFORMANCE_RANK[b] || 0) ? a : b;
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
 *   chairStats: object|null, claudeReview?: object|null, extraRows?: Array<object>,
 *   seats?: Array<object>}} args
 *   `claudeReview` (v4.1 §4.4) amends the v4.0 meta pin: present ⇒ claudeInCouncil
 *   true, 'claude' joins meta.models (the street-cred universe), its findings join
 *   the pool and it gets the synthesized null-usage runStats row. Absent ⇒ v4.0
 *   output byte-for-byte. `extraRows` (v4.7 D2/E4) are pre-built runStats rows
 *   (repair/superseded/dead-seat-error, from runStage1 today) appended right
 *   after the primary review rows, before judge/chair accounting — absent or
 *   empty ⇒ byte-for-byte unchanged, so the pre-v4.7 length-7 pins stay green.
 *   `seats` (v4.8 PR4c §3.2) is run.json's seat table; see meta.seats below.
 */
function buildTallyInput({ runId, date, bench, chair, reviews, judgeResults, chairStats,
  claudeReview, extraRows, seats }) {
  const meta = {
    runId, date, runType: 'headless',
    models: bench.slice(),          // bench seats exactly: critic included, chair excluded
    chair,
    claudeInCouncil: false,         // pinned for headless runs
    // v4.8 PR4c §3.2 (R4c-1 as amended by R4c-7): the seat table, a pure TAIL so
    // the shipped six-key order above is byte-identical in every case. Emitted
    // ONLY when the bench repeats an alias — the one case where the `alias#N`
    // seat ids on findings[].raiserSeat, adjudications[].seat and runStats[].seat
    // resolve to nothing else in the document (meta.models is the ALIAS list).
    // ⚠️ `seats ?` alone would be VACUOUS: run.js:133 sets o.seats unconditionally
    // past the preflight and buildSeats always returns an ARRAY ([] is still
    // truthy), so that spelling writes a full table into tally-input.json,
    // tally.json AND verdict.json on every unique-alias bench.
    // ⚠️ NARROW BY RULING, not by oversight. The guard asks "does the bench
    // repeat an alias?", which is a DIFFERENT question from "is anything in
    // seats[] unrecoverable?" — they part on a UNIQUE-alias lens/critic bench.
    // `position` and the raw lens text (runStats[].role has only the slug) ride
    // in meta.seats EXACTLY when it ships, i.e. on a repeated-alias bench, and
    // are absent BY DESIGN otherwise (measured 2026-08-16; BACKLOG SI-21, HOLD).
    // ⚠️ Consumers: absence means "no seat table available", NEVER "the bench was
    // unique" — two of appendRun's three call sites feed hand-assembled input no
    // seat machinery touches. And seats[] is BENCH-ONLY, so it must never be
    // joined positionally to meta.models (`claude` is pushed onto that at :226)
    // or to streetCred[].
    // .slice() is defence-in-depth only: the array is shared with
    // runState.checkpoint (run.js:135) and with both tally inputs. Nothing
    // mutates meta.seats — unlike models, which meta.models.push mutates below —
    // so no test can distinguish the copy from the reference.
    ...(Array.isArray(seats) && seats.some(s => s.id !== s.alias) ? { seats: seats.slice() } : {}),
  };
  const findings = reviews.flatMap(r => r.globalFindings);
  const okJudges = judgeResults.filter(j => j.ok);
  const adjudications = okJudges.flatMap(j =>
    j.adjudications.map(a => ({ findingId: a.id, judge: j.judge, verdict: a.verdict,
      // v4.8 PR3 Task 5, re-based by PR4c R4c-9: emit-when-DIFFERENT against
      // the seat's OWN alias, matching buildRunStatsEntry and run.js's
      // raiserSeat call site. It was `!== j.judge` — the alias as the LEG
      // reported it — which emitted a seat id equal to its own alias whenever
      // the two strings drifted (a padded --council member; a leg with no
      // modelInput), i.e. exactly where the field carries no information.
      ...(j.seat && j.seat.id !== j.seat.alias ? { seat: j.seat.id } : {}) })));
  // v4.8 T3.2: the SAME predicate as the adjudication map immediately above —
  // the judge's own seat, emit-when-DIFFERENT. `order` itself is untouched
  // (still alias-valued).
  // v4.8 T3.3 carries `orderSeats` the one further hop T3.2 deliberately
  // stopped short of: it reached judgeResults[] in run-stage2.js, but
  // `computeStreetCred` reads `rankings`, so without this the seat channel
  // never arrives where SI-20's collapse happens.
  // ⚠️ EMIT ONLY WHEN IT CARRIES AT LEAST ONE NON-NULL. rankingToOrder returns
  // a PARITY SHAPE, not an absence: on a unique-alias bench `orderSeats` is
  // `[null, null, null]`, and emitting that would add a key to rankings[] in
  // tally-input.json, tally.json and tally-provisional.json on every run that
  // has ever happened. `.flat()` is depth-1 because a tie group is the only
  // nesting rankingToOrder can produce (anonymize.js :: rankingToOrder maps
  // one level of `Array.isArray(slot)`). The named mutant that guards this
  // predicate is tests/council/street-cred-mutants.js :: EMITSET.
  const rankings = okJudges.map(j => ({ judge: j.judge, order: j.order,
    ...(Array.isArray(j.orderSeats) && j.orderSeats.flat().some(Boolean)
      ? { orderSeats: j.orderSeats } : {}),
    ...(j.seat && j.seat.id !== j.seat.alias ? { seat: j.seat.id } : {}) }));
  const runStats = reviews.map(r => buildRunStatsEntry({
    leg: r.leg, model: r.model, role: r.role, wasChair: false, conformance: r.conformance,
    findingsUnverified: r.findingsUnverified, repairRefused: r.repairRefused, seat: r.seat,
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
  // v4.8 PR5a T4 (R5-8): the judge row carries its SEAT. PR4c withheld it because
  // `joinsLedger` has no 'judge' member, so nothing consumed it; report.js's cost
  // table does now, and without it a twin bench's two judge rows are identical.
  // `buildRunStatsEntry` applies the shared emit-when-DIFFERENT predicate (:89), so
  // a unique bench stays byte-identical and no new predicate enters the tree.
  for (const j of (judgeResults || [])) {
    runStats.push(buildRunStatsEntry({
      leg: j.leg, model: j.judge, role: 'judge', conformance: j.conformance, seat: j.seat,
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
    // v4.8 PR5a T7: `record` is the TALLIED record, so its findings already carry
    // tally.js's R8 stamp. Passing the array the packet already has access to costs one
    // line here and keeps every rendering decision in briefings-chair.js.
    findings: record.findings,
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
  // Exported for ledger.js's drift guard only (v4.8 PR4b council A1): ledger.js
  // keeps a LOCAL copy of this table, and the guard deep-compares the two so a
  // level added here can never silently go missing there.
  CONFORMANCE_RANK,
};
