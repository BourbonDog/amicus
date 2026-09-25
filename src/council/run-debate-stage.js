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

/**
 * #257 R-X46 — the clause that names WHOSE retry answered only in its reasoning
 * channel, and WHAT KIND of retry it was.
 *
 * `debate-degraded` is ONE note for the whole round, so the original wording
 * ("its repair") was unreadable the moment two defences were in it: the reader
 * could not tell which raiser's work the sentence was about — the same silence
 * R-X36 exists to remove (fix round 1). Fix round 3 then fixed the other half:
 * calling a RELAUNCH a "repair" is precisely the misnaming the council raised as
 * A3/C2, and which R-X45 removed from the runStats record — the prose must not
 * re-introduce it. The kind rides beside the alias on the `promotedRetry` MARKER
 * that `runDefenseSolo` / `repairRevoteLeg` set where the fact is known — off the
 * WAVE-1 leg's own promotion, at the retry site — so the sentence and the row can
 * never disagree because the sentence no longer reads the row at all (#257 R-X48).
 * It DID read the row until R-X48, off the row's `relaunch` transport mark, and
 * that is exactly why R-X46 case ii — a promoted relaunch that COMPLETES, so it
 * supersedes and leaves NO retry row — went unnamed for a whole round.
 *
 * A relaunch clause says "again" because that is what happened: a promoted
 * defence or re-vote was RE-ASKED with its original briefing (R-X33) and
 * answered in its reasoning channel a second time.
 *
 * Entries are grouped by kind, each group rendered with the singular or the
 * Oxford-free plural (`a, b and c`) form, and the groups concatenated — each
 * clause already opens with '; ', so the kinds join with '; ' by construction.
 * Group order is FIRST APPEARANCE in the round, not a fixed alphabet: the prose
 * then follows the round's own order rather than an arbitrary one.
 *
 * Returns '' for an empty/absent list, which is what keeps every other degraded
 * round's `why` byte-identical (named mutants "DEBATEPROMOTEDREPAIRSILENT",
 * "DEBATEPROMOTEDREPAIRUNNAMED", "RELAUNCHCALLEDREPAIR").
 * @param {Array<{alias: string, kind: string}>} [entries] the round's
 *   `promotedRetry` MARKERS — one per RETRY that came back promoted, whichever
 *   branch its leg took (a complete relaunch leaves no retry row), never one per
 *   row; `kind` is 'repair' or 'relaunch'
 * @returns {string} '' or one leading-'; ' clause per kind
 */
function promotedRepairClause(entries) {
  if (!Array.isArray(entries) || entries.length === 0) { return ''; }
  const byKind = new Map();
  for (const e of entries) {
    if (!e || !e.alias) { continue; }
    const kind = e.kind === 'relaunch' ? 'relaunch' : 'repair';
    if (!byKind.has(kind)) { byKind.set(kind, []); }
    byKind.get(kind).push(e.alias);
  }
  let out = '';
  for (const [kind, aliases] of byKind) {
    // 'relaunch' → 'relaunches'; 'repair' → 'repairs'.
    const plural = kind === 'relaunch' ? 'relaunches' : 'repairs';
    const again = kind === 'relaunch' ? ' again' : '';
    out += aliases.length === 1
      ? `; ${aliases[0]}'s ${kind} answered only in its reasoning channel${again}`
      : `; the ${plural} of ${aliases.slice(0, -1).join(', ')} and ${aliases[aliases.length - 1]}`
        + ` answered only in their reasoning channels${again}`;
  }
  return out;
}

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
          // #257 R-X46: R-X36's rule, applied to the debate — a `promoted: true`
          // row is never the only record of itself. When a defence's or re-vote's
          // RETRY came back promoted, the prose NAMES whose it was (fix round 1;
          // see promotedRepairClause above). R-X48: that is EVERY such retry,
          // whichever branch its leg took — run-debate.js builds `promotedRepairs`
          // from explicit markers, not from the rows, so the double-promoted
          // COMPLETE relaunch (R-X46 case ii, which supersedes and leaves no
          // repair row) is named too. The clause is '' for every other degraded
          // round, so every other `why` is byte-identical.
          why: 'one or more defense or re-vote legs died or returned unstructured output'
            + promotedRepairClause(dbg.promotedRepairs),
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
