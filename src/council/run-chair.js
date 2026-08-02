// src/council/run-chair.js
'use strict';

/**
 * @module council/run-chair
 * Chair synthesis + VERDICT-line repair for the headless council driver,
 * lifted VERBATIM out of run.js for the 300-line gate (v4.1 Task 0.5). Pure
 * refactor: same launches, same waveIds, same run.json checkpoints, same
 * degradation rules. Launchers come in through `ctx` exactly as run-stages.js
 * takes them; run.js keeps the chair-packet build, the tally sequencing, the
 * signal bookkeeping and finalize().
 *
 * `isSignalled` is a GETTER, not a snapshot: run.js's signal handler mutates
 * its `signalled` local between awaits and the v4.0 code re-read it after every
 * chair launch. Passing the value instead would silently drop those aborts.
 */

const stage2 = require('./briefings-stage2');
const { parseChairVerdict } = require('./parse-stage2');
const runState = require('./run-state');
const { isAbortExit } = require('./run-stages');
const { emitStageStarted, emitStageTerminal } = require('../observe/events');

/**
 * Chair fallback promotion (spec §4): the highest peers-only street-cred
 * model from `council stats` that is not a bench seat and not the failed
 * chair. "Highest street-cred" = BEST = numerically LOWEST mean rank
 * (deriveReliability's avgStreetCredPeersOnly; lower is better).
 *
 * The reserved seat name 'claude' is never eligible (v4.1 §4.4 "never chairs"):
 * a --claude-review run puts a real 'claude' row in the ledger, so without this
 * filter a LATER run could promote it and walk straight past the pre-flight
 * --chair claude guard — with no Claude leg to launch.
 * @returns {string|null}
 */
function pickFallbackChair(statsRows, bench, failedChair) {
  const benchSet = new Set(bench);
  const candidates = (statsRows || [])
    .filter(r => r.model !== 'claude' && !benchSet.has(r.model) && r.model !== failedChair
      && typeof r.avgStreetCredPeersOnly === 'number')
    .sort((a, b) => a.avgStreetCredPeersOnly - b.avgStreetCredPeersOnly);
  return candidates.length ? candidates[0].model : null;
}

/**
 * Chair chain (attempt → retry → ledger-promoted fallback → give up) plus the
 * single VERDICT-line repair re-prompt.
 * @param {object} ctx run.js's {o, launchers, addWave, overBudget, scratchDir}
 * @param {{packet: string, degrade: {note: Function}, statsFn: Function,
 *   isSignalled: function(): (number|null)}} args
 * @returns {Promise<{aborted: number|null, chairLeg: object|null,
 *   actualChair: string|null, chairText: string|null,
 *   chairConformance: string, overallVerdict: string|null}>}
 */
async function runChair(ctx, { packet, degrade, statsFn, isSignalled }) {
  const { o, launchers, addWave, overBudget } = ctx;
  const now = () => new Date().toISOString();
  const bail = (code) => ({
    aborted: code, chairLeg: null, actualChair: null, chairText: null,
    chairConformance: 'clean', overallVerdict: null,
  });

  const attemptChair = async (model, waveId) => {
    runState.appendStageWave(o.runDir, 'chair', waveId);
    const solo = await launchers.launchSolo({
      model, prompt: packet, project: o.runDir, waveId,
      timeout: o.timeout, gateway: o.gateway, noValidateModel: o.noValidateModel,
      // v4.1 §4.5d: the chair chain (ch1/ch2/ch3) and the ch4 VERDICT repair
      // below are the launches a re-armed price gate would refuse LAST, after
      // the whole bench has already been paid for.
      noCostGate: o.noCostGate,
      // v4.3 Task 3 (spec §7.2 named defect): without this, chair spend is
      // ledgered with councilRunId:null and is unattributable.
      councilRunId: o.runId, councilName: o.councilName,
    });
    addWave(solo.wave);
    const ok = solo.leg && solo.leg.status === 'complete'
      && solo.leg.summary && solo.leg.summary.trim();
    return { leg: ok ? solo.leg : null, exitCode: solo.exitCode };
  };

  let chairLeg = null;
  let actualChair = null;
  let skippedForCost = false;
  if (overBudget()) {
    // Ceiling hit after the tally is computable: skip the chair, write the
    // verdict with overallVerdict null, exit 2 (spec §4 degradation table).
    // Never abort in-flight legs for cost — this only stops NEW launches.
    skippedForCost = true;
    degrade.note({
      channel: 'chair-skipped-cost-ceiling',
      what: 'the chair did not run',
      why: 'the --max-cost ceiling was reached before the chair could launch',
      effect: 'the verdict is written with no chair synthesis and overallVerdict null; will exit degraded (2)',
      remedy: 'raise --max-cost, or re-run the chair alone against the existing tally',
    });
    runState.updateStage(o.runDir, 'chair', { status: 'skipped', completedAt: now() });
    emitStageTerminal(o.runDir, o.runId, 'chair', 'skipped', null, o.follow);
  } else {
    runState.updateStage(o.runDir, 'chair', { status: 'running', startedAt: now(), project: o.runDir });
    emitStageStarted(o.runDir, o.runId, 'chair', null, o.follow);
    // Fallback chain (spec §4): retry same chair once → promote best
    // non-bench model from the ledger → give up (no Claude fallback headless).
    let attempt = await attemptChair(o.chair, `${o.runId}-ch1`);
    if (isAbortExit(attempt.exitCode) || isSignalled()) { return bail(attempt.exitCode || isSignalled()); }
    if (!attempt.leg && !overBudget()) {
      attempt = await attemptChair(o.chair, `${o.runId}-ch2`);
      if (isAbortExit(attempt.exitCode) || isSignalled()) { return bail(attempt.exitCode || isSignalled()); }
    }
    if (attempt.leg) { actualChair = o.chair; }
    else if (!overBudget()) {
      let statsRows = [];
      try { statsRows = statsFn(); } catch { /* no ledger yet */ }
      const fallback = pickFallbackChair(statsRows, o.models, o.chair);
      if (fallback) {
        attempt = await attemptChair(fallback, `${o.runId}-ch3`);
        if (isAbortExit(attempt.exitCode) || isSignalled()) { return bail(attempt.exitCode || isSignalled()); }
        if (attempt.leg) { actualChair = fallback; }
      }
    }
    chairLeg = attempt.leg;
    const chairStatus = chairLeg ? 'complete' : 'error';
    runState.updateStage(o.runDir, 'chair', { status: chairStatus, completedAt: now() });
    emitStageTerminal(o.runDir, o.runId, 'chair', chairStatus, null, o.follow);
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
      // ⚠️ LC-12: the synthesis rides along. The chair leg SUCCEEDED — only the
      // VERDICT line is missing — so a fresh repair session that cannot see the
      // synthesis is picking a verdict on an artifact it has never read.
      model: actualChair, prompt: stage2.buildChairRepairPrompt({ synthesis: chairText }),
      project: o.runDir, waveId: `${o.runId}-ch4`,
      timeout: o.timeout, gateway: o.gateway, noValidateModel: o.noValidateModel,
      noCostGate: o.noCostGate,
      councilRunId: o.runId, councilName: o.councilName,
    });
    addWave(repair.wave);
    if (isAbortExit(repair.exitCode) || isSignalled()) { return bail(repair.exitCode || isSignalled()); }
    overallVerdict = parseChairVerdict((repair.leg && repair.leg.summary) || '');
    chairConformance = overallVerdict ? 'repaired' : 'unstructured';
  }
  // A completed chair whose verdict never parsed is 'unstructured' even when
  // the repair was skipped (e.g. the chair leg itself tripped --max-cost).
  if (chairText && !overallVerdict) { chairConformance = 'unstructured'; }
  if (!skippedForCost && (!chairLeg || !overallVerdict)) {
    degrade.note({
      channel: 'chair-failed',
      what: 'the council has no chair synthesis',
      why: chairLeg
        ? 'the chair ran but its output carried no parseable VERDICT: line'
        : 'no chair leg completed, including after the fallback chain',
      effect: 'the verdict is written with overallVerdict null; will exit degraded (2)',
    });
  }

  return {
    aborted: null, chairLeg, actualChair, chairText, chairConformance, overallVerdict,
  };
}

module.exports = { runChair, pickFallbackChair };
