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
const asm = require('./run-assemble');
const { createBudget } = require('./run-budget');
const { emitRunStarted, emitStageStarted, emitStageTerminal } = require('../observe/events');
// v4.4.1 CA-6: the whole exit-code vocabulary (SIGNAL_EXIT, statusForExit and the
// degradation in resolveTerminalExit) lives in ./run-finalize — see its docblock.
const { writeRunTerminal, resolveTerminalExit, SIGNAL_EXIT } = require('./run-finalize');
const { finishRun } = require('./run-finish');

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
    noteBudgetRefusal, inexactUnderCeiling } = createBudget({ maxCost: o.maxCost, runDir: o.runDir, degrade });
  // v4.4.1 Task 0.5: ONE OpenCode server for the whole run — ./run-server carries
  // the why and the evidence that `_scratch` judge isolation survives it. Acquired
  // below (a getter, because the launchers are built first); null = as before.
  let sharedServer = null;
  const launchers = deps.launchers
    || createLaunchers({ remainingBudget, reserveBudget, onBudgetRefusal: noteBudgetRefusal, sharedServer: () => sharedServer });

  runState.initCouncilRun(o); // run.json seed + sessions-dir pointer (run-state.js)

  // dropped-members (spec §5, Plan 4): a seat the user's preset requested that
  // never resolved is a lost seat — announced like every other loss. Fires
  // once per member, before any launch (zero spend), for BOTH transports.
  for (const dm of o.droppedMembers || []) {
    degrade.note({
      channel: 'dropped-members',
      what: `seat ${dm.member} was not seated`,
      why: dm.reason,
      effect: 'the bench is smaller than the preset requested; the run will exit degraded (2)',
      data: { member: dm.member, reason: dm.reason },
    });
  }

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
    const code = resolveTerminalExit({ signalled, exitCode, degraded, degrade, inexactUnderCeiling });
    const run = await writeRunTerminal({ o, code, error, noticeUnknownSpend, usageBlock });
    return { exitCode: code, run };
  };

  // Injected launchers bring their own transport. Never throws — degrades to null.
  if (!deps.launchers) { sharedServer = await require('./run-server').acquireRunServer({ ...o, degrade }, deps); }

  const ctx = { o, launchers, addWave, overBudget, degrade, scratchDir: path.join(o.runDir, '_scratch') };

  try {
    // v4.9 W5.3: o.intent is 'task' or ABSENT. ⚠️ PR #200 A3 (round-3 ruling): 'review' — the default spelled out loud, which both transports already strip (cli-handlers-council-run.js, mcp-council-run.js) — NORMALIZES to absent here rather than being refused, because runCouncil is a public door too and one input must not mean two things at two doors. `delete`, never `= undefined` (a present-but-undefined key still changes JSON output paths — the T10 lesson). Only a genuinely unknown value is BAD_ARGS. Pinned: tests/council/run-intent.test.js. ⚠️ Round-4 C2 (that this normalization runs AFTER the seed and so materializes intent:'review' on run.json) is REFUTED BY MEASUREMENT, not by argument: the ordering is real — `runState.initCouncilRun` runs ~50 lines above — but that seed literal (`run-state.js :: initCouncilRun`) has no `intent` key to copy, and BOTH run.json writers of it (the checkpoint below, and `cli-handlers-council-run.js`'s) are `=== 'task'` spreads that 'review' cannot pass. Mutant SEEDCOPY (a `...(o.intent ? {intent:o.intent} : {})` added to that seed) reddens exactly the pin, so no reordering is needed here.
    if (o.intent === 'review') { delete o.intent; } else if (o.intent !== undefined && o.intent !== 'task') {
      return finalize(1, { code: 'BAD_ARGS',
        message: `Error: intent must be 'task' or 'review' (omitted means review); got '${o.intent}'` });
    }
    if (o.intent === 'task' && o.claudeReviewFile) {   // V12: a file review is REVIEW machinery
      return finalize(1, { code: 'BAD_ARGS', message:
        '--claude-review enters a REVIEW as review N+1 and has no task-mode meaning; drop it for a task run' });
    }
    // v4.1 §4.4: Claude-in-council is a FILE input — validated after initRun (so the
    // error doc lands in a run dir that exists) and before any launch (zero spend).
    const pre = asm.preflightClaudeReview(o);
    if (pre.error) { return finalize(1, pre.error); }
    const claudeReview = pre.claudeReview;

    // v4.8 §4.3: seats are derived pre-spend from data run.json already holds,
    // then checkpointed — initCouncilRun ran ~50 lines earlier, so they cannot
    // ride the seed.
    const seatPre = asm.preflightSeats(o);
    if (seatPre.error) { return finalize(1, seatPre.error); }
    o.seats = seatPre.seats;
    o.criticSeat = seatPre.criticSeat;
    runState.checkpoint(o.runDir, { seats: o.seats, criticSeat: o.criticSeat,
      ...(o.intent === 'task' ? { intent: 'task' } : {}) });   // v4.9 W5.3: emit-when-'task', never 'review'

    // Composed Stage-1 seat briefing persisted for auditability (spec §4 layout).
    fs.writeFileSync(path.join(o.runDir, 'briefing-stage1.md'),
      briefings.stage1SeatBriefing(o.intent, { briefing: o.briefing, date: o.date }), { mode: 0o600 });

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
    // v4.8 T3.2: seats travel in lockstep with models — both are s1.reviews in
    // the same pass, not the positional join anonymize.js :: assignLabels's
    // own docblock explains is forbidden elsewhere.
    const labels = assignLabels(s1.reviews.map(r => r.model).concat(claudeReview ? ['claude'] : []),
      s1.reviews.map(r => r.seat).concat(claudeReview ? [null] : []));
    runState.checkpoint(o.runDir, { labelMap: labels.labelMap });
    // Attach each review's run-global findings (buildTallyInput reads
    // r.globalFindings per review, not a bare parallel array).
    s1.reviews.forEach((r, i) => {
      // v4.8 PR3 Task 5, re-based by PR4c R4c-9: pass the seat id ONLY when it
      // differs from the seat's OWN alias — the naive `r.seat ? r.seat.id :
      // null` form would emit raiserSeat on every finding of every run, a
      // universal artifact-shape change. The operand was `r.model`, the leg's
      // modelInput — not the alias when a leg reports none (it falls back to
      // the RESOLVED id) or when a --council preset carries a padded member.
      // There it emitted a seat id byte-equal to its own alias, on a bench with
      // no twin, with no seat table able to resolve it.
      r.globalFindings = toGlobalFindings(labels.entries[i].letter, r.model, r.findings,
        r.seat && r.seat.id !== r.seat.alias ? r.seat.id : null);
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
        effect: 'findings were tiered on a thinner cross-review than the bench size implies; will exit degraded (2)',
      });
    }

    // Merge Stage-2 judging conformance into each seat's row (worst wins).
    // Seat-keyed (v4.8 PR3 Task 4): an alias-only key collapses a twin bench
    // onto ONE Map entry, so the last-wins judge silently overwrote every
    // twin's row (D7). j.seat can still be null (an orphaned -s2 leg,
    // seats.js:130-146) even when r.seat is a real bound seat, so the lookup
    // falls back to r.model on a miss rather than assuming the two arrays stay
    // symmetric — a naive seatKey on both sides would make that orphan's
    // conformance unreachable instead of merged, a silent total loss.
    const { seatKey } = require('./run-retry-keys');   // v4.9 W3 (SI-DUP b): the one rule, one home
    const byJudge = new Map(s2.judgeResults.map(j => [seatKey(j.seat, j.judge), j]));
    for (const r of s1.reviews) {
      const j = byJudge.get(r.seat ? r.seat.id : r.model) || byJudge.get(r.model);
      if (j) { r.conformance = asm.worseConformance(r.conformance, j.conformance); }
    }

    // ---- Chair synthesis (provisional tally feeds the packet) ----
    // v4.7 D2: two independent extraRows channels — Stage 1's findings-repair
    // rows and Stage 2's judge-repair rows — concatenate into the ONE array
    // buildTallyInput appends after the primary review rows (run-assemble.js
    // docblock). Neither stage invents a second mechanism for the other's kind
    // of row.
    const mkInput = (chairStats, chairModel) => {
      const input = asm.buildTallyInput({
        runId: o.runId, date: o.date, bench: o.models.slice(), chair: chairModel,
        reviews: s1.reviews, judgeResults: s2.judgeResults, chairStats, claudeReview,
        extraRows: [...s1.extraRows, ...s2.extraRows],
        // v4.8 PR4c §3.2: the ONLY production caller of buildTallyInput, so this is
        // the single seam meta.seats enters through. The final input is derived by
        // SPREAD (run-finish.js:36), not rebuilt, so both the provisional and the
        // debated input inherit it from here.
        seats: o.seats,
      });
      // v4.9 W5.3: emit-when-'task' as a pure meta TAIL; review meta stays untouched.
      if (o.intent === 'task') { input.meta = { ...input.meta, intent: 'task' }; }
      return input;
    };
    const provisionalInput = mkInput(null, o.chair);
    const provisional = tally(provisionalInput);

    // ---- Stage 2.5: debate (optional, spec §5.1) ----
    const { debatedInput, debatedRecord, debateOutcomes, debateFindings, aborted: debateAborted } =
      await runDebateStage(ctx, { provisional, provisionalInput, overBudget });
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

    // Final tally + ledger + artifacts live in ./run-finish (v4.8 PR0 size-gate split).
    finishRun({ o, chairRes, debatedInput, debateFindings, appendRunFn, degrade, deadWaves, now });

    return finalize(degraded.value ? 2 : 0);
  } catch (err) {
    return finalize(1, { code: 'INTERNAL', message: err.message });
  }
}

module.exports = { runCouncil, pickFallbackChair, SIGNAL_EXIT };
