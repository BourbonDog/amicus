// src/council/run.js
'use strict';

/**
 * @module council/run
 * Headless council driver (spec §5): stage state machine over the DI launch
 * wrappers — Stage-1 reviews → anonymized Stage-2 cross-review → tally →
 * chair synthesis → verdict/report — checkpointing run.json after every
 * stage (run-state) and consuming the existing pure primitives unchanged
 * (tally, buildVerdict via run-assemble, report renderers, ledger).
 *
 * Tally sequencing: an in-memory provisional tally feeds the chair packet;
 * the on-disk tally-input.json/tally.json are FINAL (chair runStats row
 * included, actual chair in meta) and only the final record is ledgered —
 * the skill's debate-mode provisional/final precedent.
 *
 * Never rejects for run errors: always resolves {exitCode, run}.
 */

const fs = require('fs');
const path = require('path');
const { tally } = require('./tally');
const { assignLabels, toGlobalFindings } = require('./anonymize');
const briefings = require('./briefings');
const stage2 = require('./briefings-stage2');
const { parseChairVerdict } = require('./parse-stage2');
const runState = require('./run-state');
const { createLaunchers } = require('./run-launch');
const { runStage1, runStage2, isAbortExit } = require('./run-stages');
const asm = require('./run-assemble');
const { sumWaveUsage } = require('../utils/pricing');

const SIGNAL_EXIT = { SIGINT: 130, SIGTERM: 143, SIGBREAK: 143 };

/**
 * Chair fallback promotion (spec §4): the highest peers-only street-cred
 * model from `council stats` that is not a bench seat and not the failed
 * chair. "Highest street-cred" = BEST = numerically LOWEST mean rank
 * (deriveReliability's avgStreetCredPeersOnly; lower is better).
 * @returns {string|null}
 */
function pickFallbackChair(statsRows, bench, failedChair) {
  const benchSet = new Set(bench);
  const candidates = (statsRows || [])
    .filter(r => !benchSet.has(r.model) && r.model !== failedChair
      && typeof r.avgStreetCredPeersOnly === 'number')
    .sort((a, b) => a.avgStreetCredPeersOnly - b.avgStreetCredPeersOnly);
  return candidates.length ? candidates[0].model : null;
}

/**
 * @param {object} options {briefing, models, chair, critic?, lenses?, project,
 *   runId, runDir, timeout?, maxCost?, gateway?, noValidateModel?, date}
 * @param {object} [deps] {launchers?, appendRunFn?, statsFn?, installSignalAbortFn?}
 * @returns {Promise<{exitCode: number, run: object}>}
 */
async function runCouncil(options, deps = {}) {
  const o = { critic: null, lenses: null, maxCost: null, ...options };
  const launchers = deps.launchers || createLaunchers();
  const appendRunFn = deps.appendRunFn || require('./ledger').appendRun;
  const statsFn = deps.statsFn || require('./ledger').deriveReliability;
  const installSignals = deps.installSignalAbortFn
    || require('../utils/session-abort').installSignalAbort;
  const now = () => new Date().toISOString();

  const allLegs = [];
  const addWave = (wave) => { if (wave && Array.isArray(wave.legs)) { allLegs.push(...wave.legs); } };
  const spent = () => {
    const c = sumWaveUsage(allLegs).cost;
    return typeof c.amount === 'number' ? c.amount : 0;
  };
  const overBudget = () => o.maxCost !== null && o.maxCost !== undefined && spent() >= o.maxCost;

  runState.initRun(o.runDir, {
    schemaVersion: 2, type: 'council-run', runId: o.runId, status: 'running', stages: [],
    bench: o.models.slice(), chair: o.chair, critic: o.critic, lenses: o.lenses,
    labelMap: null,
    options: { timeout: o.timeout || null, maxCost: o.maxCost, gateway: o.gateway || 'auto', outDir: o.runDir },
    usage: null, pid: process.pid, createdAt: now(),
  });
  runState.writePointer(o.project, o.runId, o.runDir);

  let signalled = null;
  const uninstall = installSignals({
    onAbort: (signal) => {
      signalled = SIGNAL_EXIT[signal] || 143;
      runState.checkpoint(o.runDir, { status: 'aborted', exitCode: signalled, completedAt: now() });
    },
  });

  const degraded = { value: false };
  const finalize = (exitCode, error) => {
    uninstall();
    const code = signalled || exitCode;
    const status = (code === 130 || code === 143) ? 'aborted'
      : code === 0 ? 'complete' : code === 1 ? 'error' : 'partial';
    const run = runState.checkpoint(o.runDir, {
      status, exitCode: code, error: error || null,
      usage: { cost: sumWaveUsage(allLegs).cost },
      completedAt: now(),
    });
    return { exitCode: code, run };
  };

  const ctx = { o, launchers, addWave, overBudget, scratchDir: path.join(o.runDir, '_scratch') };

  try {
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
    const s1 = await runStage1(ctx);
    runState.updateStage(o.runDir, 'stage1', {
      status: 'complete', completedAt: now(),
      taskIds: s1.reviews.map(r => (r.leg && r.leg.taskId)).filter(Boolean),
    });
    if (signalled || s1.aborted) { return finalize(s1.aborted || signalled); }
    if (s1.deadLegs.length > 0) { degraded.value = true; } // bench shrank → never a "full run"
    if (s1.reviews.length < 2) {
      return finalize(1, {
        code: 'COUNCIL_QUORUM',
        message: `Only ${s1.reviews.length} Stage-1 review(s) survived; a council needs at least 2`,
      });
    }

    // ---- Cost gate: Stage 2 is a paid launch; no tally exists yet (spec §4) ----
    if (overBudget()) {
      return finalize(1, {
        code: 'COST_EXCEEDED',
        message: `Cost ceiling $${o.maxCost} reached before cross-review; no tally exists`,
      });
    }

    // ---- Stage 2: anonymized cross-review ----
    const labels = assignLabels(s1.reviews.map(r => r.model));
    runState.checkpoint(o.runDir, { labelMap: labels.labelMap });
    // Attach each review's run-global findings (buildTallyInput reads
    // r.globalFindings per review, not a bare parallel array).
    s1.reviews.forEach((r, i) => {
      r.globalFindings = toGlobalFindings(labels.entries[i].letter, r.model, r.findings);
    });
    const globalFindings = s1.reviews.flatMap(r => r.globalFindings);
    runState.updateStage(o.runDir, 'stage2',
      { status: 'running', startedAt: now(), waveId: `${o.runId}-s2`, project: ctx.scratchDir });
    const s2 = await runStage2(ctx, { reviews: s1.reviews, labels, globalFindings });
    runState.updateStage(o.runDir, 'stage2', { status: 'complete', completedAt: now() });
    if (signalled || s2.aborted) { return finalize(s2.aborted || signalled); }
    if (s2.judgeResults.filter(j => j.ok).length < 2) { degraded.value = true; } // thin cross-review

    // Merge Stage-2 judging conformance into each seat's row (worst wins).
    const byJudge = new Map(s2.judgeResults.map(j => [j.judge, j]));
    for (const r of s1.reviews) {
      const j = byJudge.get(r.model);
      if (j) { r.conformance = asm.worseConformance(r.conformance, j.conformance); }
    }

    // ---- Chair synthesis (provisional tally feeds the packet) ----
    const mkInput = (chairStats, chairModel) => asm.buildTallyInput({
      runId: o.runId, date: o.date, bench: o.models.slice(), chair: chairModel,
      reviews: s1.reviews, judgeResults: s2.judgeResults, chairStats,
    });
    const provisionalInput = mkInput(null, o.chair);
    const provisional = tally(provisionalInput);

    const packet = stage2.buildChairPacket({
      reviews: s1.reviews.map(r => ({ model: r.model, text: r.text })),
      rankings: provisionalInput.rankings,
      adjudications: provisionalInput.adjudications,
      tierCounts: provisional.tierCounts,
    });
    fs.writeFileSync(path.join(o.runDir, 'chair-packet.md'), packet, { mode: 0o600 });
    const attemptChair = async (model, waveId) => {
      runState.appendStageWave(o.runDir, 'chair', waveId);
      const solo = await launchers.launchSolo({
        model, prompt: packet, project: o.runDir, waveId,
        timeout: o.timeout, gateway: o.gateway, noValidateModel: o.noValidateModel,
      });
      addWave(solo.wave);
      const ok = solo.leg && solo.leg.status === 'complete'
        && solo.leg.summary && solo.leg.summary.trim();
      return { leg: ok ? solo.leg : null, exitCode: solo.exitCode };
    };

    let chairLeg = null;
    let actualChair = null;
    if (overBudget()) {
      // Ceiling hit after the tally is computable: skip the chair, write the
      // verdict with overallVerdict null, exit 2 (spec §4 degradation table).
      // Never abort in-flight legs for cost — this only stops NEW launches.
      degraded.value = true;
      runState.updateStage(o.runDir, 'chair', { status: 'skipped', completedAt: now() });
    } else {
      runState.updateStage(o.runDir, 'chair', { status: 'running', startedAt: now(), project: o.runDir });
      // Fallback chain (spec §4): retry same chair once → promote best
      // non-bench model from the ledger → give up (no Claude fallback headless).
      let attempt = await attemptChair(o.chair, `${o.runId}-ch1`);
      if (isAbortExit(attempt.exitCode) || signalled) { return finalize(attempt.exitCode || signalled); }
      if (!attempt.leg && !overBudget()) {
        attempt = await attemptChair(o.chair, `${o.runId}-ch2`);
        if (isAbortExit(attempt.exitCode) || signalled) { return finalize(attempt.exitCode || signalled); }
      }
      if (attempt.leg) { actualChair = o.chair; }
      else if (!overBudget()) {
        let statsRows = [];
        try { statsRows = statsFn(); } catch { /* no ledger yet */ }
        const fallback = pickFallbackChair(statsRows, o.models, o.chair);
        if (fallback) {
          attempt = await attemptChair(fallback, `${o.runId}-ch3`);
          if (isAbortExit(attempt.exitCode) || signalled) { return finalize(attempt.exitCode || signalled); }
          if (attempt.leg) { actualChair = fallback; }
        }
      }
      chairLeg = attempt.leg;
      runState.updateStage(o.runDir, 'chair',
        { status: chairLeg ? 'complete' : 'error', completedAt: now() });
      // The chair chain may have promoted a fallback (or given up) — checkpoint
      // the ACTUAL chair into run.json now so status/`--json`/the human summary
      // never report the originally-requested chair after a promotion. Mirrors
      // mkInput's actualChair || o.chair (a give-up with no actual chair keeps
      // the requested chair).
      runState.checkpoint(o.runDir, { chair: actualChair || o.chair });
    }
    const chairText = chairLeg ? chairLeg.summary : null;
    let chairConformance = 'clean';

    // ---- Chair VERDICT line (one repair re-prompt, spec §5) ----
    let overallVerdict = chairText ? parseChairVerdict(chairText) : null;
    if (chairText && !overallVerdict && !overBudget()) {
      runState.appendStageWave(o.runDir, 'chair', `${o.runId}-ch4`);
      const repair = await launchers.launchSolo({
        model: actualChair, prompt: stage2.buildChairRepairPrompt(),
        project: o.runDir, waveId: `${o.runId}-ch4`,
        timeout: o.timeout, gateway: o.gateway, noValidateModel: o.noValidateModel,
      });
      addWave(repair.wave);
      if (isAbortExit(repair.exitCode) || signalled) { return finalize(repair.exitCode || signalled); }
      overallVerdict = parseChairVerdict((repair.leg && repair.leg.summary) || '');
      chairConformance = overallVerdict ? 'repaired' : 'unstructured';
    }
    // A completed chair whose verdict never parsed is 'unstructured' even when
    // the repair was skipped (e.g. the chair leg itself tripped --max-cost).
    if (chairText && !overallVerdict) { chairConformance = 'unstructured'; }
    if (!chairLeg || !overallVerdict) { degraded.value = true; } // spec table: exit 2 rows

    // ---- Final tally (chair row included) + ledger + artifacts ----
    const chairStats = chairLeg ? asm.buildRunStatsEntry({
      leg: chairLeg, model: actualChair, role: 'chair', wasChair: true,
      conformance: chairConformance,
    }) : null;
    const finalInput = mkInput(chairStats, actualChair || o.chair);
    const record = tally(finalInput);
    if (!o.lenses) {
      // Lens runs never feed cross-run reliability stats (spec §4 / skill rule).
      try { appendRunFn(record); }
      catch (e) { process.stderr.write(`Notice: council ledger append failed: ${e.message}\n`); }
    }
    asm.writeTallyFiles({ runDir: o.runDir, tallyInput: finalInput, record });
    runState.updateStage(o.runDir, 'tally', { status: 'complete', completedAt: now() });
    asm.writeVerdictFiles({ runDir: o.runDir, record, overallVerdict, chairText });
    runState.updateStage(o.runDir, 'verdict', { status: 'complete', completedAt: now() });

    return finalize(degraded.value ? 2 : 0);
  } catch (err) {
    return finalize(1, { code: 'INTERNAL', message: err.message });
  }
}

module.exports = { runCouncil, pickFallbackChair, SIGNAL_EXIT };
