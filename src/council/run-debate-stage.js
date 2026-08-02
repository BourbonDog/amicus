// src/council/run-debate-stage.js
'use strict';

/**
 * @module council/run-debate-stage
 * Debate orchestration, extracted from run.js (v4.6 Plan 1 Task 1) so that file
 * could come off the 300-line size-gate cliff. Logic moved verbatim; the only
 * change is the explicit parameter object replacing closure access — PLUS one
 * necessary deviation the plan's block-boundary audit missed: the original
 * line here was `return finalize(dbg.aborted);` (spec §5.7, a signal arriving
 * mid-debate). `finalize` is a run.js-local closure bound to session/server
 * teardown state (uninstall, the shared OpenCode server) that cannot be
 * reconstructed in a separate module without duplicating that single-close-site
 * guarantee. Mirroring the SAME convention run.js already uses for Stage 1/2
 * (`runStage1`/`runStage2` return an `aborted` field; run.js itself decides to
 * call `finalize`), this module returns `{ ...the five bindings, aborted:
 * dbg.aborted }` on that one path instead, and run.js's call site now carries
 * a `if (debateAborted) { return finalize(debateAborted); }` guard, exactly
 * paralleling its existing `if (signalled || s1.aborted) { ... }` /
 * `if (signalled || s2.aborted) { ... }` lines. Verified against
 * tests/council/run-debate.test.js's "abort mid-debate (defense wave
 * signalled) → finalize aborted, NO tally-final, NO ledger" end-to-end case,
 * which exercises exactly this path through runCouncil and continues to pass
 * unedited.
 */
const fs = require('fs');
const path = require('path');
const runState = require('./run-state');
const runDebateMod = require('./run-debate');
const { tally } = require('./tally');
const { emitStageStarted, emitStageTerminal } = require('../observe/events');

const now = () => new Date().toISOString();

async function runDebateStage(ctx, { provisional, provisionalInput, overBudget }) {
  const { o } = ctx;
  let debatedInput = provisionalInput, debatedRecord = provisional;
  let debateOutcomes = null, debateFindings = null;
  let debateSummary = o.debate ? { enabled: true, outcome: 'nothing-to-debate',
    contested: 0, disputed: 0, defended: 0, amended: 0, withdrawn: 0, noResponse: 0,
    revoteJudges: 0, revoteApplied: 0, verdictChanges: 0 } : null;
  if (o.debate) {
    // spec §5.1: the provisional tally is ALSO an audit artifact, not just a stage
    // checkpoint — no ledger append, written before any debate leg launches.
    fs.writeFileSync(path.join(o.runDir, 'tally-provisional.json'), JSON.stringify(provisional, null, 2), { mode: 0o600 });
    runState.updateStage(o.runDir, 'tally-provisional', { status: 'complete', startedAt: now(), completedAt: now() });
    emitStageStarted(o.runDir, o.runId, 'tally-provisional', null, o.follow);
    emitStageTerminal(o.runDir, o.runId, 'tally-provisional', 'complete', null, o.follow);
    const worthDebating = !runDebateMod.nothingToDebate(provisional);
    if (worthDebating && !overBudget()) {
      runState.updateStage(o.runDir, 'debate-defense', { status: 'running', startedAt: now(), project: ctx.scratchDir });
      emitStageStarted(o.runDir, o.runId, 'debate-defense', null, o.follow);
      const dbg = await runDebateMod.runDebate(ctx, { provisionalRecord: provisional, tallyInput: provisionalInput });
      // A signal mid-debate aborts finalization: no tally-final, no ledger (spec §5.7). Close
      // the summary FIRST — the writer contract requires a valid `outcome` whenever the key exists.
      if (dbg.aborted) {
        runState.checkpoint(o.runDir, { debate: { ...debateSummary, outcome: 'ran',
          contested: dbg.contested, disputed: dbg.disputed } });
        // See module docblock: `finalize` lives in run.js, not here. Return the
        // signal (mirroring runStage1/runStage2's `aborted` field) instead of
        // calling it directly — run.js's call site finalizes on our behalf.
        return { debatedInput, debatedRecord, debateOutcomes, debateFindings, debateSummary, aborted: dbg.aborted };
      }
      runState.updateStage(o.runDir, 'debate-defense', { status: 'complete', completedAt: now() });
      emitStageTerminal(o.runDir, o.runId, 'debate-defense', 'complete', null, o.follow);
      // run-debate owns debate-revote's running/waveId/waveIds checkpoint — only it
      // knows whether the wave launched. Never advertise a `-rv` id here: a skipped
      // re-vote would leave the abort cascade chasing the v4.0 lens `-s1` phantom.
      // Mirror run-chair.js's 'skipped' convention (no startedAt) when nothing was
      // defended/amended or the cost ceiling skipped it — 'complete' would report
      // work that never happened.
      runState.updateStage(o.runDir, 'debate-revote', dbg.revoteLaunched
        ? { status: 'complete', completedAt: now() } : { status: 'skipped', completedAt: now() });
      // debate-revote-TERMINAL only — run-debate.js owns the START (spec §4.2 /
      // v4.3 Task 7 B3 note): only it knows the `-rv` waveId when launched.
      emitStageTerminal(o.runDir, o.runId, 'debate-revote',
        dbg.revoteLaunched ? 'complete' : 'skipped', dbg.revoteLaunched ? `${o.runId}-rv` : null, o.follow);
      ({ debatedInput, debateFindings, debateSummary } = dbg);
      debatedRecord = tally(debatedInput);
      // Defensive truthiness guard: `[]` is truthy in JS, so an empty outcomes
      // list must be normalized to null here — otherwise the packet-assembly
      // ternary below still calls buildDebateAddendum({outcomes: []}), which
      // emits a bare "--- Debate round outcomes ---" heading with nothing
      // under it (same defect class ee447b6 fixed on the report renderer).
      debateOutcomes = (dbg.addendumOutcomes && dbg.addendumOutcomes.length > 0)
        ? dbg.addendumOutcomes : null;
      // Dead/unstructured defense, partial/fully-dead re-vote or a cost-ceiling re-vote skip
      // each degrade the run → exit 2 (spec §5.7), same channel as a dead Stage-1 leg.
      if (dbg.degraded) {
        ctx.degrade.note({
          channel: 'debate-degraded',
          what: 'the debate round did not complete cleanly',
          why: 'one or more defense or re-vote legs died or returned unstructured output',
          effect: 'affected findings keep their provisional tier; will exit degraded (2)',
        });
      }
    } else if (worthDebating) {
      // Budget gone before the defense wave launched, but there WAS something to debate — the
      // other cost-ceiling branch (spec §5.7). Over budget AND nothing to debate stays the latter.
      debateSummary.outcome = 'skipped-cost-ceiling';
      ctx.degrade.note({
        channel: 'debate-degraded',
        what: 'the debate round did not run',
        why: 'the --max-cost ceiling was reached before the defense wave could launch',
        effect: 'contested findings were not debated and keep their provisional tier; will exit degraded (2)',
        remedy: 'raise --max-cost to let the debate round run',
      });
    }
    runState.checkpoint(o.runDir, { debate: debateSummary });
  }

  return { debatedInput, debatedRecord, debateOutcomes, debateFindings, debateSummary };
}

module.exports = { runDebateStage };
