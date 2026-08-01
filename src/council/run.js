// src/council/run.js
'use strict';

/**
 * @module council/run
 * Headless council driver (spec §5): stage state machine over the DI launch wrappers —
 * Stage-1 reviews → anonymized Stage-2 cross-review → optional Stage-2.5 debate
 * (run-debate) → tally → chair synthesis → verdict/report — checkpointing run.json after
 * every stage (run-state) and consuming the existing pure primitives unchanged
 * (tally, buildVerdict via run-assemble, report renderers, ledger).
 *
 * Tally sequencing: a provisional tally feeds the chair packet (and, under --debate, the
 * debate round + tally-provisional.json); the on-disk tally-input.json/tally.json are
 * FINAL (chair runStats row included, actual chair in meta) and only the final record is
 * ledgered — the skill's debate-mode provisional/final precedent.
 *
 * Never rejects for run errors: always resolves {exitCode, run}.
 */

const fs = require('fs');
const path = require('path');
const { tally } = require('./tally');
const { assignLabels, toGlobalFindings } = require('./anonymize');
const briefings = require('./briefings');
const runState = require('./run-state');
const { createLaunchers } = require('./run-launch');
const { runStage1, runStage2 } = require('./run-stages');   // stage 2 lives in ./run-stage2 (300-line gate), re-exported there
const { runChair, pickFallbackChair } = require('./run-chair');
const { runDebateStage } = require('./run-debate-stage');   // debate orchestration lives there (300-line gate), extracted from here (v4.6 Plan 1 Task 1)
const { decorateRecord } = require('./debate');
const asm = require('./run-assemble');
const { createBudget } = require('./run-budget');
const { emitRunStarted, emitStageStarted, emitStageTerminal } = require('../observe/events');
// v4.4.1 CA-6: the whole exit-code vocabulary (SIGNAL_EXIT, statusForExit and the
// degradation in resolveTerminalExit) lives in ./run-finalize — see its docblock.
const { writeRunTerminal, resolveTerminalExit, SIGNAL_EXIT } = require('./run-finalize');

/**
 * @param {object} options {briefing, models, chair, critic?, lenses?, project, runId,
 *   runDir, timeout?, maxCost?, gateway?, noValidateModel?, date, debate?, noCostGate?,
 *   councilName?, fallback?, catalog?} councilName (v4.3 Task 3) = preset name when
 *   launched via `--council <preset>`, else null — threaded via ctx.o into every
 *   launchWave/launchSolo for leg ledger attribution. fallback/catalog (v4.3 Task 18
 *   §6.2): ctx.o carries both, but only run-stages.js's stage launches read them —
 *   the chair/debate legs never substitute via chains.
 * @param {object} [deps] {launchers?, appendRunFn?, statsFn?, installSignalAbortFn?,
 *   startOpenCodeServerFn? (v4.4.1 Task 0.5 test seam, see ./run-server)}
 * @returns {Promise<{exitCode: number, run: object}>}
 */
async function runCouncil(options, deps = {}) {
  const o = { critic: null, lenses: null, maxCost: null, debate: false, claudeReviewFile: null,
    noCostGate: false, councilName: null, template: null, pack: null, ...options };
  o.follow = o.follow ? require('../observe/follow').createFollowPrinter({ json: o.json }) : null; // Task 13: stderr mirror
  const appendRunFn = deps.appendRunFn || require('./ledger').appendRun;
  const statsFn = deps.statsFn || require('./ledger').deriveReliability;
  const installSignals = deps.installSignalAbortFn
    || require('../utils/session-abort').installSignalAbort;
  const now = () => new Date().toISOString();

  // v4.4: the whole budget position lives in ./run-budget — its docblock carries the "fail LOUD,
  // not CLOSED" ruling, why reserveBudget (not merely remainingBudget) is what holds the ceiling
  // across Stage-1's CONCURRENT launches, why addWave must release-and-account atomically, and
  // why a refused wave sets `degraded` (a shrunken bench never exits 0) rather than aborting.
  const degraded = { value: false };
  const degrade = require('./run-degrade').createDegradeSink({ runDir: o.runDir, degraded });
  const { addWave, overBudget, remainingBudget, noticeUnknownSpend, usageBlock, reserveBudget,
    noteBudgetRefusal, inexactUnderCeiling } = createBudget({ maxCost: o.maxCost, runDir: o.runDir, degraded });
  // v4.4.1 Task 0.5: ONE OpenCode server for the whole run — ./run-server carries
  // the why and the evidence that `_scratch` judge isolation survives it. Acquired
  // below (a getter, because the launchers are built first); null = as before.
  let sharedServer = null;
  const launchers = deps.launchers
    || createLaunchers({ remainingBudget, reserveBudget, onBudgetRefusal: noteBudgetRefusal, sharedServer: () => sharedServer });

  runState.initCouncilRun(o); // run.json seed + sessions-dir pointer (run-state.js)
  emitRunStarted(o.runDir, o.runId, { bench: o.models, chair: o.chair }, o.follow);

  let signalled = null;
  const uninstall = installSignals({
    onAbort: (signal) => {
      signalled = SIGNAL_EXIT[signal] || 143;
      runState.checkpoint(o.runDir, { status: 'aborted', exitCode: signalled, completedAt: now() });
    },
  });

  const finalize = async (exitCode, error) => {
    uninstall();
    // ONE close site: finalize is the single path every terminal outcome takes.
    // ⚠️ …and it CLAIMS the handle before releasing it, so no re-entry (present
    // or future) can close the same server twice. A double close is worse than a
    // duplicate start: it tears the server out from under anything still in
    // flight. Everything downstream of here is guarded in ./run-finalize —
    // bookkeeping must never sink a run that already finished.
    const claimed = sharedServer;
    sharedServer = null;
    await require('./run-server').releaseRunServer(claimed);
    const code = resolveTerminalExit({ signalled, exitCode, degraded, inexactUnderCeiling });
    const run = await writeRunTerminal({ o, code, error, noticeUnknownSpend, usageBlock });
    return { exitCode: code, run };
  };

  // Injected launchers bring their own transport. Never throws — degrades to null.
  if (!deps.launchers) { sharedServer = await require('./run-server').acquireRunServer(o, deps); }

  const ctx = { o, launchers, addWave, overBudget, degrade, scratchDir: path.join(o.runDir, '_scratch') };

  try {
    // v4.1 §4.4: Claude-in-council is a FILE input — validated after initRun (so the
    // error doc lands in a run dir that exists) and before any launch (zero spend).
    const pre = asm.preflightClaudeReview(o);
    if (pre.error) { return finalize(1, pre.error); }
    const claudeReview = pre.claudeReview;

    // Composed Stage-1 seat briefing persisted for auditability (spec §4 layout).
    fs.writeFileSync(path.join(o.runDir, 'briefing-stage1.md'),
      briefings.buildSeatBriefing({ briefing: o.briefing, date: o.date }), { mode: 0o600 });

    // ---- Stage 1: independent reviews ----
    // Lens mode launches one solo per seat instead of a `-s1` seat wave, so it
    // has no primary wave to name — run-stages records each real sub-wave into
    // waveIds at launch. Advertising a `-s1` that never exists made both the
    // abort cascade and the status leg rollup chase a phantom.
    runState.updateStage(o.runDir, 'stage1', {
      status: 'running', startedAt: now(), project: o.runDir,
      ...(o.lenses ? {} : { waveId: `${o.runId}-s1` }),
    });
    emitStageStarted(o.runDir, o.runId, 'stage1', o.lenses ? null : `${o.runId}-s1`, o.follow);
    const s1 = await runStage1(ctx);
    // Step 10's other half: a Stage 1 that lost seats is NOT 'complete'. It was
    // checkpointed 'complete' unconditionally, so run v441plan01 recorded a clean
    // stage with four dead seats — and in lens mode (one solo per seat) the run
    // could exit 0 outright, since only the non-lens seat wave meets the quorum
    // gate. Never aborts: it reports and degrades (standing ruling).
    const s1Status = s1.degraded ? 'partial' : 'complete';
    const deadWaves = s1.deadWaves || [];
    runState.updateStage(o.runDir, 'stage1', {
      status: s1Status, completedAt: now(),
      taskIds: s1.reviews.map(r => (r.leg && r.leg.taskId)).filter(Boolean),
      ...(deadWaves.length ? { deadWaves } : {}),
    });
    emitStageTerminal(o.runDir, o.runId, 'stage1', s1Status, o.lenses ? null : `${o.runId}-s1`, o.follow);
    if (signalled || s1.aborted) { return finalize(s1.aborted || signalled); }
    if (s1.degraded) { degraded.value = true; } // bench shrank → never a "full run"
    if (s1.reviews.length < 2) {
      return finalize(1, {
        code: 'COUNCIL_QUORUM',
        message: `Only ${s1.reviews.length} Stage-1 review(s) survived; a council needs at least 2`,
      });
    }

    // ---- Cost gate: Stage 2 is a paid launch; no tally exists yet (spec §4) ----
    noticeUnknownSpend(); // v4.4: warn EARLY on a long run, not only at finalize
    if (overBudget()) {
      return finalize(1, {
        code: 'COST_EXCEEDED',
        message: `Cost ceiling $${o.maxCost} reached before cross-review; no tally exists`,
      });
    }

    // ---- Stage 2: anonymized cross-review ----
    // A file-sourced Claude review is ALWAYS the last label — review N+1 (§4.4).
    const labels = assignLabels(s1.reviews.map(r => r.model).concat(claudeReview ? ['claude'] : []));
    runState.checkpoint(o.runDir, { labelMap: labels.labelMap });
    // Attach each review's run-global findings (buildTallyInput reads
    // r.globalFindings per review, not a bare parallel array).
    s1.reviews.forEach((r, i) => {
      r.globalFindings = toGlobalFindings(labels.entries[i].letter, r.model, r.findings);
    });
    const globalFindings = s1.reviews.flatMap(r => r.globalFindings)
      .concat(claudeReview ? asm.labelClaudeReview(claudeReview, labels) : []);
    runState.updateStage(o.runDir, 'stage2',
      { status: 'running', startedAt: now(), waveId: `${o.runId}-s2`, project: ctx.scratchDir });
    emitStageStarted(o.runDir, o.runId, 'stage2', `${o.runId}-s2`, o.follow);
    const s2 = await runStage2(ctx, { reviews: s1.reviews, labels, globalFindings,
      extraLabeled: claudeReview ? [{ label: claudeReview.label, text: claudeReview.text }] : [] });
    runState.updateStage(o.runDir, 'stage2', { status: 'complete', completedAt: now() });
    emitStageTerminal(o.runDir, o.runId, 'stage2', 'complete', `${o.runId}-s2`, o.follow);
    if (signalled || s2.aborted) { return finalize(s2.aborted || signalled); }
    const usableJudges = s2.judgeResults.filter(j => j.ok).length;
    if (usableJudges < 2) {
      degrade.note({
        channel: 'thin-cross-review',
        what: `only ${usableJudges} of ${s2.judgeResults.length} judges returned a usable cross-review`,
        why: 'the other judges produced no parseable Stage-2 block',
        effect: 'findings were tiered on a thinner cross-review than the bench size implies; exits degraded (2)',
      });
    }

    // Merge Stage-2 judging conformance into each seat's row (worst wins).
    const byJudge = new Map(s2.judgeResults.map(j => [j.judge, j]));
    for (const r of s1.reviews) {
      const j = byJudge.get(r.model);
      if (j) { r.conformance = asm.worseConformance(r.conformance, j.conformance); }
    }

    // ---- Chair synthesis (provisional tally feeds the packet) ----
    const mkInput = (chairStats, chairModel) => asm.buildTallyInput({
      runId: o.runId, date: o.date, bench: o.models.slice(), chair: chairModel,
      reviews: s1.reviews, judgeResults: s2.judgeResults, chairStats, claudeReview,
    });
    const provisionalInput = mkInput(null, o.chair);
    const provisional = tally(provisionalInput);

    // ---- Stage 2.5: debate (optional, spec §5.1) ----
    const { debatedInput, debatedRecord, debateOutcomes, debateFindings, aborted: debateAborted } =
      await runDebateStage(ctx, { provisional, provisionalInput, overBudget, degraded });
    // Mirrors the `if (signalled || s1.aborted)` / `if (signalled || s2.aborted)` guards
    // above: run-debate-stage.js can't reach this closure's `finalize`, so it hands the
    // signal back here instead (see its docblock) and we finalize on its behalf.
    if (debateAborted) { return finalize(debateAborted); }

    const packet = asm.buildChairPacketFile({
      runDir: o.runDir, reviews: s1.reviews, claudeReview, date: o.date,
      tallyInput: debatedInput, record: debatedRecord, debateOutcomes,
    });

    const chairRes = await runChair(ctx, {
      packet, degrade, statsFn, isSignalled: () => signalled,
    });
    if (chairRes.aborted !== null) { return finalize(chairRes.aborted); }
    const { chairLeg, actualChair, chairText, chairConformance, overallVerdict } = chairRes;

    // ---- Final tally (chair row included) + ledger + artifacts ----
    const chairStats = chairLeg ? asm.buildRunStatsEntry({
      leg: chairLeg, model: actualChair, role: 'chair', wasChair: true,
      conformance: chairConformance,
    }) : null;
    // Built on the (possibly debated) input so the debate's amended claims, replaced
    // adjudications and rebuttal/revote runStats rows all reach the final record.
    const finalInput = { ...debatedInput, meta: { ...debatedInput.meta, chair: actualChair || o.chair } };
    if (chairStats) { finalInput.runStats = [...(finalInput.runStats || []), chairStats]; }
    const record = tally(finalInput);
    if (debateFindings) { decorateRecord(record, debateFindings); }
    if (!o.lenses) {
      // Lens runs never feed cross-run reliability stats (spec §4 / skill rule).
      try { appendRunFn(record); }
      catch (e) { process.stderr.write(`Notice: council ledger append failed: ${e.message}\n`); }
    }
    asm.writeTallyFiles({ runDir: o.runDir, tallyInput: finalInput, record });
    const tallyStage = o.debate ? 'tally-final' : 'tally';
    runState.updateStage(o.runDir, tallyStage, { status: 'complete', completedAt: now() });
    emitStageStarted(o.runDir, o.runId, tallyStage, null, o.follow);
    emitStageTerminal(o.runDir, o.runId, tallyStage, 'complete', null, o.follow);
    asm.writeVerdictFiles({ runDir: o.runDir, record, overallVerdict, chairText,
      critic: o.critic, deadWaves });
    runState.updateStage(o.runDir, 'verdict', { status: 'complete', completedAt: now() });
    emitStageStarted(o.runDir, o.runId, 'verdict', null, o.follow);
    emitStageTerminal(o.runDir, o.runId, 'verdict', 'complete', null, o.follow);

    return finalize(degraded.value ? 2 : 0);
  } catch (err) {
    return finalize(1, { code: 'INTERNAL', message: err.message });
  }
}

module.exports = { runCouncil, pickFallbackChair, SIGNAL_EXIT };
