// src/council/run-finish.js
'use strict';
// Final tally (chair row included) + ledger gate + tally/verdict artifacts.
// Moved verbatim from run.js@6b0c3b6b:242-288 (v4.8 PR0 size-gate split, zero
// behavior). NOT run-finalize.js — that sibling owns exit codes and the
// terminal write; this module builds the final tally, appends the run
// record to the ledger (skipped for lens runs and task runs), and writes the
// tally/verdict artifact files + their stage events.
const { tally } = require('./tally');
const { decorateRecord } = require('./debate');
const runState = require('./run-state');
const asm = require('./run-assemble');
const { emitStageStarted, emitStageTerminal } = require('../observe/events');
const { isUnverifiedSeat, isRefusedSeat, seatLabel } = require('./verdict-seats-reviewed');

/**
 * Build the final tally, gate the ledger append, write tally+verdict
 * artifacts and their stage checkpoints. Void — run.js's trailing
 * `return finalize(...)` reads only degraded.value, which this never
 * mutates.
 */
function finishRun({ o, chairRes, debatedInput, debateFindings, appendRunFn, degrade, deadWaves, now }) {
  const { chairLeg, actualChair, chairText, chairConformance, overallVerdict, chairRows, chairAttempts } = chairRes;
  const chairStats = chairLeg ? asm.buildRunStatsEntry({
    leg: chairLeg, model: actualChair, role: 'chair', wasChair: true,
    conformance: chairConformance,
  }) : null;
  // v4.7 D2: a give-up (no chairLeg) with at least one recorded attempt gets
  // an explicit error row so the walk's outcome isn't silently absorbed.
  // Keyed on chairAttempts, NOT chairRows — attempts that die pre-wave (no
  // money spent) record an outcome but yield no row (errata E3).
  const giveUpRow = (!chairLeg && chairAttempts && chairAttempts.length)
    ? asm.buildRunStatsEntry({ leg: null, model: o.chair, role: 'chair', wasChair: false })
    : null;
  // Built on the (possibly debated) input so the debate's amended claims, replaced
  // adjudications and rebuttal/revote runStats rows all reach the final record.
  const finalInput = { ...debatedInput, meta: { ...debatedInput.meta, chair: actualChair || o.chair } };
  // Item 8, final-review consolidated wave: was three sequential
  // reassignments (chairStats, then chairRows, then giveUpRow), each
  // rebuilding finalInput.runStats from scratch — collapsed into the one
  // spread that was always the net effect. The `|| []` fallbacks were
  // dead: `runStats` is a real array on every debatedInput
  // (asm.buildTallyInput always returns one via .map()), never undefined.
  finalInput.runStats = [
    ...finalInput.runStats,
    ...(chairStats ? [chairStats] : []),
    ...chairRows,
    ...(giveUpRow ? [giveUpRow] : []),
  ];
  const record = tally(finalInput);
  if (debateFindings) { decorateRecord(record, debateFindings); }
  if (!o.lenses && o.intent !== 'task') {
    // Lens runs never feed cross-run reliability stats (spec §4 / skill rule);
    // task runs neither (v4.9 W5.4 gate 1 — task rankings measure concurrence,
    // never defect confirmation, so a task row would poison chair promotion).
    try { appendRunFn(record); }
    catch (e) { process.stderr.write(`Notice: council ledger append failed: ${e.message}\n`); }
  }
  asm.writeTallyFiles({ runDir: o.runDir, tallyInput: finalInput, record });
  const tallyStage = o.debate ? 'tally-final' : 'tally';
  runState.updateStage(o.runDir, tallyStage, { status: 'complete', completedAt: now() });
  emitStageStarted(o.runDir, o.runId, tallyStage, null, o.follow);
  emitStageTerminal(o.runDir, o.runId, tallyStage, 'complete', null, o.follow);
  // Verdict assembly is the degrade cut-off: anything noted after this line
  // reaches stderr + run.json but not verdict.json (spec §6 rule 1).
  const verdict = asm.writeVerdictFiles({ runDir: o.runDir, record, overallVerdict, chairText,
    critic: o.critic, deadWaves, degrades: degrade.all() });
  // council #248 round 1 (C1/D1): the census is in verdict.json and on the CI title, but a LOCAL
  // run said nothing — the product principle's silent-degrade shape. One stderr line, read off the
  // census the verdict already carries: no new computation, no artifact, no exit-code change, not a
  // sink record (so `degraded` never flips). Emitted only when a count is non-zero, so every other
  // run's stderr is byte-identical; names the seats so the reader need not open the report.
  // report.html is written by writeVerdictFiles in the call just above, so the pointer is never
  // dangling (council #248 r2, C3).
  const census = verdict && verdict.seatsReviewed;
  if (census && (census.unverified > 0 || census.refused > 0)) {
    const rows = Array.isArray(verdict.runStats) ? verdict.runStats : [];
    const parts = [];
    if (census.unverified > 0) {
      parts.push(`${census.unverified} of ${census.of} seats' findings came from a repair nothing could verify (${rows.filter(isUnverifiedSeat).map(seatLabel).join(', ')})`);
    }
    // council #248 round 2 (A2/C2, P3-R17): a refused repair — no findings tallied at all — is named
    // on the same line, so a seat that contributed nothing is never silent locally either.
    if (census.refused > 0) {
      parts.push(`${census.refused} of ${census.of} seats' repairs were refused and contributed no findings (${rows.filter(isRefusedSeat).map(seatLabel).join(', ')})`);
    }
    process.stderr.write(`Notice: ${parts.join('; ')} — see "What was lost" in report.html\n`);
  }
  runState.updateStage(o.runDir, 'verdict', { status: 'complete', completedAt: now() });
  emitStageStarted(o.runDir, o.runId, 'verdict', null, o.follow);
  emitStageTerminal(o.runDir, o.runId, 'verdict', 'complete', null, o.follow);
}

module.exports = { finishRun };
