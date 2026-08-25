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
  asm.writeVerdictFiles({ runDir: o.runDir, record, overallVerdict, chairText,
    critic: o.critic, deadWaves, degrades: degrade.all() });
  runState.updateStage(o.runDir, 'verdict', { status: 'complete', completedAt: now() });
  emitStageStarted(o.runDir, o.runId, 'verdict', null, o.follow);
  emitStageTerminal(o.runDir, o.runId, 'verdict', 'complete', null, o.follow);
}

module.exports = { finishRun };
