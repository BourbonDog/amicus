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
const { buildRunStatsEntry } = require('./run-assemble');

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
 *
 * v4.7 GOA-7 D11: exclusions test the group key AND aliases[]; the promoted
 * name is aliases[0] (most-recent alias) so the launch string stays routable
 * through the same alias policy both call sites (run.js mid-walk, run-server.js
 * pre-seed) already resolve.
 * @returns {string|null}
 */
function pickFallbackChair(statsRows, bench, failedChair) {
  const benchSet = new Set(bench);
  // v4.7 GOA-7 D11: an aggregate's identity is its key PLUS every alias it was
  // observed under — post-D10 keys may be executable ids while bench/o.chair
  // stay alias-space, so every exclusion tests the whole name set (a bench
  // seat's resolved-keyed group must never be promoted as its own chair).
  // The LAUNCHED name is aliases[0] (most-recent alias): alias-space names
  // re-enter the router's alias bridge and current key/gateway policy; a raw
  // executable id would dodge them (divergent-vendor forms, openrouter-
  // literals under --gateway direct, dropped aliases). aliases[] is non-empty
  // for every ledger-derived group; the bare-model fallback covers pre-D10
  // aggregate shapes only.
  const names = (r) => [r.model, ...(Array.isArray(r.aliases) ? r.aliases : [])];
  const excluded = (r) => names(r).some(n => n === 'claude' || benchSet.has(n) || n === failedChair);
  // v4.8 PR4a: every sort term is read off the row, so CANDIDATE SELECTION is
  // independent of the order `statsRows` arrives in — previously that order
  // (deriveReliability's Map insertion order = council-ledger.jsonl row order)
  // silently decided every exact street-cred tie, and such ties are an ordinary
  // arithmetic outcome. Terms: street cred (lower mean rank = better), then
  // council appearances, then model id for a guaranteed total order. ⚠️ `runs`
  // is TOTAL ledger rows (ledger.js:137) including `judged:false` ones that
  // contributed no street cred — a tie-break, never a ranking signal. It is
  // always present on deriveReliability output; the default serves fixtures.
  // Full rationale + the tie arithmetic: tests/council/run-chair.test.js.
  const runsOf = (r) => (typeof r.runs === 'number' ? r.runs : 0);
  const candidates = (statsRows || [])
    .filter(r => !excluded(r) && typeof r.avgStreetCredPeersOnly === 'number')
    .sort((a, b) => (a.avgStreetCredPeersOnly - b.avgStreetCredPeersOnly)
      || (runsOf(b) - runsOf(a))
      || (a.model < b.model ? -1 : a.model > b.model ? 1 : 0));
  if (!candidates.length) { return null; }
  const top = candidates[0];
  return (Array.isArray(top.aliases) && top.aliases.length) ? top.aliases[0] : top.model;
}

/**
 * Outcome taxonomy for one fallback-walk attempt (spec §8, LC-5). The ch4
 * VERDICT repair is deliberately NOT an attempt: its chair leg already
 * completed — only the verdict line is being re-prompted — and the outcome
 * enum has no honest value for it.
 * @param {object|null} rawLeg the UNFILTERED leg (attemptChair nulls `leg` on
 *   failure; this is the one before that narrowing, so a failed leg document
 *   is still visible here)
 * @param {object|null} [errorDoc] set when the launch never produced a wave
 *   at all (pre-flight refusal) — the only source of a reason in that case
 * @returns {{outcome: 'completed'|'error'|'timeout'|'no-output', reason: string|null}}
 */
function classifyChairAttempt(rawLeg, errorDoc) {
  if (!rawLeg) {
    const reason = (errorDoc && (errorDoc.message || errorDoc.reason)) || 'no leg document';
    return { outcome: 'error', reason };
  }
  if (rawLeg.status === 'timeout') { return { outcome: 'timeout', reason: rawLeg.reason || null }; }
  if (rawLeg.status === 'complete') {
    const hasOutput = rawLeg.summary && String(rawLeg.summary).trim();
    return hasOutput ? { outcome: 'completed', reason: null }
      : { outcome: 'no-output', reason: rawLeg.reason || null };
  }
  return { outcome: 'error', reason: rawLeg.reason || rawLeg.error || String(rawLeg.status) };
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
      tag: o.tag, // v4.7 F8 D16: rides the same forward as councilRunId/councilName.
    });
    addWave(solo.wave);
    const ok = solo.leg && solo.leg.status === 'complete'
      && solo.leg.summary && solo.leg.summary.trim();
    // rawLeg is the UN-nulled leg — the classifier needs to see a failed leg
    // document, not just the ok/null collapse the rest of the walk consumes.
    return { leg: ok ? solo.leg : null, exitCode: solo.exitCode, errorDoc: solo.errorDoc, rawLeg: solo.leg };
  };

  let chairLeg = null;
  let actualChair = null;
  let skippedForCost = false;
  // Additive on run.json (LC-5): one entry per resolved attempt (ch1/ch2/ch3;
  // ch4 is a repair, not an attempt — see classifyChairAttempt). Declared here
  // (not inside the else branch below) so it stays in scope for the
  // chair-failed why enrichment after the branch closes, and so a
  // cost-skipped chair (the `if` branch) simply never calls recordAttempt —
  // chairAttempts is never checkpointed and the key stays absent on run.json.
  const chairAttempts = [];
  // v4.7 D2 (spec "the count is the count"): a non-primary row per launch so
  // spend is fully attributable — one 'chair-attempt' row per FAILED attempt
  // that produced a rawLeg (null rawLeg = no wave = no money = no row), plus
  // one 'repair' row for a launched ch4 (pushed below, after the ch4 block).
  // The eventual SUCCESSFUL attempt's leg is never pushed here — it becomes
  // the primary 'chair' row (wasChair:true) via run.js's own chairStats.
  const chairRows = [];
  const recordAttempt = (attempt, waveId, model) => {
    const cls = classifyChairAttempt(attempt.rawLeg, attempt.errorDoc);
    chairAttempts.push({ waveId, model, outcome: cls.outcome, reason: cls.reason });
    // Checkpointed HERE, before the caller's own isAbortExit bail — a mid-walk
    // kill must not lose the attempts already resolved (spec §8 kill-mid-walk).
    runState.checkpoint(o.runDir, { chairAttempts });
    if (!attempt.leg && attempt.rawLeg) {
      chairRows.push(buildRunStatsEntry({
        leg: attempt.rawLeg, model, role: 'chair-attempt', wasChair: false,
      }));
    }
  };
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
    const waveId1 = `${o.runId}-ch1`;
    let attempt = await attemptChair(o.chair, waveId1);
    recordAttempt(attempt, waveId1, o.chair);
    if (isAbortExit(attempt.exitCode) || isSignalled()) { return bail(attempt.exitCode || isSignalled()); }
    if (!attempt.leg && !overBudget()) {
      const waveId2 = `${o.runId}-ch2`;
      attempt = await attemptChair(o.chair, waveId2);
      recordAttempt(attempt, waveId2, o.chair);
      if (isAbortExit(attempt.exitCode) || isSignalled()) { return bail(attempt.exitCode || isSignalled()); }
    }
    if (attempt.leg) { actualChair = o.chair; }
    else if (!overBudget()) {
      let statsRows = [];
      try { statsRows = statsFn(); } catch { /* no ledger yet */ }
      const fallback = pickFallbackChair(statsRows, o.models, o.chair);
      if (fallback) {
        const waveId3 = `${o.runId}-ch3`;
        attempt = await attemptChair(fallback, waveId3);
        recordAttempt(attempt, waveId3, fallback);
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
    const waveId4 = `${o.runId}-ch4`;
    runState.appendStageWave(o.runDir, 'chair', waveId4);
    const repair = await launchers.launchSolo({
      // ⚠️ LC-12: the synthesis rides along. The chair leg SUCCEEDED — only the
      // VERDICT line is missing — so a fresh repair session that cannot see the
      // synthesis is picking a verdict on an artifact it has never read.
      model: actualChair, prompt: stage2.buildChairRepairPrompt({ synthesis: chairText }),
      project: o.runDir, waveId: waveId4,
      timeout: o.timeout, gateway: o.gateway, noValidateModel: o.noValidateModel,
      noCostGate: o.noCostGate,
      councilRunId: o.runId, councilName: o.councilName,
      tag: o.tag, // v4.7 F8 D16: rides the same forward as councilRunId/councilName.
    });
    addWave(repair.wave);
    if (isAbortExit(repair.exitCode) || isSignalled()) { return bail(repair.exitCode || isSignalled()); }
    // repair.leg is the raw leg document — launchSolo DOES null it, but only
    // on a wave-less failure (a pre-flight refusal with no wave launched at
    // all: run-launch.js's launchSolo derives `leg` from `wave.legs[0]`, so
    // no wave means no leg, no waveId, no money spent — the errata E3 "no
    // leg = no wave = no money = no row" case). A wave that DID launch
    // always yields a leg document, whatever its status. The `if
    // (repair.leg)` guard below is therefore load-bearing on that exact
    // distinction: a launched ch4 (a leg document exists, whatever its
    // status) gets its own row so the repair's spend is attributed even when
    // it never supplies a VERDICT; a ch4 that never even launched gets no
    // row at all, because there is nothing billed to attribute.
    if (repair.leg) {
      chairRows.push(buildRunStatsEntry({
        leg: repair.leg, model: actualChair, role: 'repair', wasChair: false,
      }));
    }
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
        : `no chair leg completed after the fallback walk — ${chairAttempts.map(a =>
          `${a.waveId.split('-').pop()} ${a.model}: ${a.reason || a.outcome}`).join(' · ')}`,
      effect: 'the verdict is written with overallVerdict null; will exit degraded (2)',
    });
  }

  return {
    aborted: null, chairLeg, actualChair, chairText, chairConformance, overallVerdict,
    // Additive (v4.7 D2): chairRows holds the non-primary rows (attempts +
    // repair); chairAttempts is handed back too so run.js can key the
    // give-up row on "the walk actually happened" without re-reading disk —
    // NOT on chairRows, since attempts that die pre-wave record an outcome
    // but produce no row (errata E3: no wave = no money = no row).
    chairRows, chairAttempts,
  };
}

module.exports = { runChair, pickFallbackChair, classifyChairAttempt };
