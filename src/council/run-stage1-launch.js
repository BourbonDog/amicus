/**
 * Stage-1 launch pass for the council engine.
 *
 * launchStage1 moved verbatim from run-stages.js (v4.7 PR1 Task 1) to free
 * gate headroom before the row-per-launch edits land there.
 */
'use strict';

const briefings = require('./briefings');
const runState = require('./run-state');
const { isAbortExit } = require('./run-launch');

/** Launch all Stage-1 legs (wave + critic/lens solos), collect run docs. */
async function launchStage1(ctx) {
  const { o, launchers } = ctx;
  // `noCostGate` rides EVERY launch object in this file (here, the findings
  // repair, the judge wave, the judge repair) — see run-launch.js's fanout call.
  const common = {
    project: o.runDir, timeout: o.timeout, gateway: o.gateway,
    noValidateModel: o.noValidateModel, noCostGate: o.noCostGate,
    // v4.3 Task 3 (spec §7.2): attribution ids, forwarded verbatim to runFanout
    // via run-launch.js so every Stage-1 leg's ledger row carries them.
    councilRunId: o.runId, councilName: o.councilName,
    tag: o.tag, // v4.7 F8 D16: rides the same forward as councilRunId/councilName.
    // v4.3 Task 18 (spec §6.2): fallback chains apply to STAGE legs only —
    // the chair (run-chair.js) and debate legs (run-debate.js) never receive
    // this, so they never substitute via chains.
    fallback: o.fallback, catalog: o.catalog,
  };
  const launches = [];
  const seated = []; // parallel to `launches`: what each one was SUPPOSED to seat
  // Record every sub-wave BEFORE it launches: `amicus abort` cascades over
  // stages[].waveIds, so an id written after the launch leaves that leg
  // reachable only by the pid kill (no per-leg abort marker).
  const record = (waveId) => runState.appendStageWave(o.runDir, 'stage1', waveId);
  if (o.lenses) {
    o.models.forEach((m, i) => {
      const waveId = `${o.runId}-l${i + 1}`;
      record(waveId);
      seated.push({ waveId, models: [m] });
      launches.push(launchers.launchSolo({
        ...common, model: m, waveId,
        prompt: briefings.buildLensBriefing({ lens: o.lenses[i], briefing: o.briefing, date: o.date }),
      }));
    });
  } else {
    const seats = o.models.filter(m => m !== o.critic);
    if (seats.length > 0) {
      record(`${o.runId}-s1`);
      seated.push({ waveId: `${o.runId}-s1`, models: seats.slice() });
      launches.push(launchers.launchWave({
        ...common, models: seats, waveId: `${o.runId}-s1`,
        prompt: briefings.buildSeatBriefing({ briefing: o.briefing, date: o.date }),
      }));
    }
    if (o.critic) {
      record(`${o.runId}-c1`);
      seated.push({ waveId: `${o.runId}-c1`, models: [o.critic] });
      launches.push(launchers.launchSolo({
        ...common, model: o.critic, waveId: `${o.runId}-c1`,
        prompt: briefings.buildCriticBriefing({ briefing: o.briefing, date: o.date }),
      }));
    }
  }
  const results = await Promise.all(launches);
  let aborted = null;
  const legs = [];
  const deadWaves = [];
  results.forEach((r, i) => {
    ctx.addWave(r.wave);
    const abort = isAbortExit(r.exitCode);
    if (abort) { aborted = r.exitCode; }
    const got = (r.wave && Array.isArray(r.wave.legs)) ? r.wave.legs : [];
    legs.push(...got);
    // ⚠️ Step 10's uncovered half. A wave that died BEFORE its legs (the server
    // never started; `database is locked`) contributes NOTHING to `legs`, so
    // deadLegs cannot see it either — which is how run v441plan01 recorded
    // stage1 'complete' with four seats missing and no trace of them. In lens
    // mode every seat is its own wave, so a run could lose seats and still exit
    // 0; the quorum gate only catches the non-lens seat wave. A budget refusal
    // has its own louder channel already (run-budget.noteBudgetRefusal) and
    // must not be double-counted here.
    if (got.length > 0 || abort) { return; }
    if (r.errorDoc && r.errorDoc.code === 'BUDGET_EXCEEDED') { return; }
    deadWaves.push({
      waveId: seated[i].waveId, models: seated[i].models,
      reason: (r.wave && (r.wave.reason || r.wave.error))
        || (r.errorDoc && r.errorDoc.message) || 'the wave produced no legs',
    });
  });
  return { aborted, legs, deadWaves };
}

module.exports = { launchStage1 };
