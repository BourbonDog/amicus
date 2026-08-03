'use strict';

/**
 * @module council/run-retry
 * SL-2 (spec: docs/superpowers/specs/2026-08-03-sl2-stage1-retry-design.md):
 * the Stage-1 once-only retry pass. A sub-wave that died before its legs
 * existed, or a leg that ended with no usable output, is relaunched exactly
 * once — serially, after every surviving launch settled — and the outcome is
 * announced in the one voice: a `stage1-retry` HEAL per recovered seat; the
 * ordinary dead-wave/dead-leg degrade, noted by the CALLER (run-stages.js),
 * when the retry also died. This module emits heals only — it never notes a
 * degrade and never touches `degraded.value`, so the sink invariant holds by
 * construction. No retry of a retry: the pass consumes first-attempt losses
 * only.
 */

const briefings = require('./briefings');
const { materializeReviews, isAbortExit } = require('./run-launch');
const runState = require('./run-state');

/** 1-based lens index for a loss, from the waveId convention or the model. */
function lensIndexOf(o, waveId, model) {
  const m = /-l(\d+)$/.exec(waveId || '');
  if (m) { return Number(m[1]); }
  const i = (o.models || []).indexOf(model);
  return i === -1 ? null : i + 1;
}

/**
 * Dedup helper (Task-4 review hardening): the same seat can arrive twice in
 * one grouping pass — two dead legs naming it, or a dead wave and a dead leg
 * both naming it. One seat must still mean ONE `firstFailures` entry — first
 * occurrence wins — while every SOURCE record is kept regardless (srcWaves/
 * srcLegs are the audit trail and are never deduped). The critic unit's
 * `.models` is fixed at creation (there is only ever one critic seat), so
 * only bench/lens units grow `.models` here — the critic call sites pass
 * `trackModel: false`.
 */
function recordFailure(unit, seat, ff, trackModel = true) {
  if (unit.firstFailures.some(f => f.seat === seat)) { return; }
  unit.firstFailures.push(ff);
  if (trackModel) { unit.models.push(seat); }
}

/**
 * Group Stage-1 losses into retry units. Pure — no I/O.
 * Bench losses (a dead bench wave's models + dead bench legs) collapse into
 * ONE retry wave; the critic and each lens retry as solos (their briefings
 * differ). Stable order: bench, critic, lenses ascending. The critic matches
 * on EITHER carrier — waveId convention or model — mirroring
 * verdict.js summarizeSeatLoss.
 */
function groupStage1Losses(o, deadWaves = [], deadLegs = []) {
  const isCriticWave = (w) =>
    w.waveId === `${o.runId}-c1` || (!!o.critic && (w.models || []).includes(o.critic));
  const bench = { unit: 'bench', waveId: `${o.runId}-s1r1`, retryOfWaveId: `${o.runId}-s1`,
    models: [], firstFailures: [], srcWaves: [], srcLegs: [] };
  const lensUnits = new Map(); // lensIndex (number, or null for unmappable) -> unit
  const criticUnit = { unit: 'critic', waveId: `${o.runId}-c1r1`, retryOfWaveId: `${o.runId}-c1`,
    models: o.critic ? [o.critic] : [], firstFailures: [], srcWaves: [], srcLegs: [] };

  const lensUnitFor = (i) => {
    if (!lensUnits.has(i)) {
      // Task-4 review hardening: an unmappable loss (lensIndexOf resolved
      // neither the waveId convention nor a model-roster membership) must
      // still be GROUPABLE — dropping it here would let it vanish before the
      // orchestrator ever sees it — but must not manufacture a fake
      // `-lnullr1` waveId. The orchestrator refuses to launch any unit with
      // `lensIndex === null` and routes its sources to skipped instead.
      lensUnits.set(i, i === null
        ? { unit: 'lens', lensIndex: null, waveId: null, retryOfWaveId: null,
          models: [], firstFailures: [], srcWaves: [], srcLegs: [] }
        : { unit: 'lens', lensIndex: i, waveId: `${o.runId}-l${i}r1`,
          retryOfWaveId: `${o.runId}-l${i}`, models: [], firstFailures: [], srcWaves: [], srcLegs: [] });
    }
    return lensUnits.get(i);
  };

  for (const w of deadWaves) {
    const models = w.models || [];
    if (o.lenses) {
      const u = lensUnitFor(lensIndexOf(o, w.waveId, models[0]));
      u.srcWaves.push(w);
      models.forEach(seat => recordFailure(u, seat, { seat, class: 'wave', waveId: w.waveId, reason: w.reason }));
    } else if (isCriticWave(w)) {
      criticUnit.srcWaves.push(w);
      recordFailure(criticUnit, o.critic,
        { seat: o.critic, class: 'wave', waveId: w.waveId, reason: w.reason }, false);
    } else {
      bench.srcWaves.push(w);
      models.forEach(seat => recordFailure(bench, seat, { seat, class: 'wave', waveId: w.waveId, reason: w.reason }));
    }
  }
  for (const leg of deadLegs) {
    const seat = leg.modelInput || leg.model;
    const ff = { seat, class: 'leg', status: leg.status, reason: leg.error || null };
    if (o.lenses) {
      const u = lensUnitFor(lensIndexOf(o, null, seat));
      u.srcLegs.push(leg);
      recordFailure(u, seat, ff);
    } else if (o.critic && seat === o.critic) {
      criticUnit.srcLegs.push(leg);
      recordFailure(criticUnit, seat, ff, false);
    } else {
      bench.srcLegs.push(leg);
      recordFailure(bench, seat, ff);
    }
  }

  const out = [];
  // Task-4 review hardening: gate on whether the unit received any SOURCE
  // record, not on firstFailures.length — a zero-model dead wave contributes
  // a srcWaves entry but nothing to firstFailures/models (nothing for the
  // `.forEach` above to iterate), and must still surface here so the
  // orchestrator can route it to skipped instead of it vanishing silently.
  if (bench.srcWaves.length > 0 || bench.srcLegs.length > 0) { out.push(bench); }
  if (criticUnit.srcWaves.length > 0 || criticUnit.srcLegs.length > 0) { out.push(criticUnit); }
  out.push(...[...lensUnits.values()].sort((a, b) => (a.lensIndex ?? 0) - (b.lensIndex ?? 0)));
  return out;
}

/** The briefing a retry unit re-issues — same builders Stage 1 used. */
function briefingFor(o, unit) {
  if (unit.unit === 'critic') { return briefings.buildCriticBriefing({ briefing: o.briefing, date: o.date }); }
  if (unit.unit === 'lens') {
    return briefings.buildLensBriefing({ lens: o.lenses[unit.lensIndex - 1], briefing: o.briefing, date: o.date });
  }
  return briefings.buildSeatBriefing({ briefing: o.briefing, date: o.date });
}

/** D-effect parity: still-dead leg notes reuse today's count phrasing, with the
 *  FIRST attempt's counts — the why carries the retry story (spec §5). */
const legEffect = (counts) =>
  `${counts.reviewed} of ${counts.total} seats reviewed; `
  + 'the run continues with the bench that did and will exit degraded (2)';

function waveStillDeadNote(w, unit) {
  return { channel: 'dead-wave',
    what: `Stage-1 wave ${w.waveId} (${(w.models || []).join(', ') || 'no models'}) produced NO legs`,
    why: `${w.reason}; the once-only retry wave also produced no legs`,
    effect: 'Those seats are NOT in this council. The run continues with the bench that did '
      + 'launch and will exit degraded (2)',
    data: { waveId: w.waveId, models: w.models, reason: w.reason, retryWaveId: unit.waveId } };
}

function srcLegStillDeadNote(leg, unit, counts) {
  const seat = leg.modelInput || leg.model;
  return { channel: 'dead-leg', what: `seat ${seat} did not review`,
    why: `the leg ended '${leg.status}'${leg.error ? `: ${leg.error}` : ''} with no usable output; `
      + 'its once-only retry wave produced no legs',
    effect: legEffect(counts),
    data: { seat, status: leg.status, reason: leg.error || null, retryWaveId: unit.waveId } };
}

function retryLegStillDeadNote(seat, ff, retryLeg, unit, counts) {
  const why = ff && ff.class === 'wave'
    ? `its first wave ${ff.waveId} produced no legs (${ff.reason}); `
      + `its once-only retry leg ended '${retryLeg.status}' with no usable output`
    : `the leg ended '${ff ? ff.status : 'unknown'}'${ff && ff.reason ? `: ${ff.reason}` : ''} `
      + `with no usable output; its once-only retry also ended '${retryLeg.status}'`;
  return { channel: 'dead-leg', what: `seat ${seat} did not review`, why,
    effect: legEffect(counts),
    data: { seat, status: retryLeg.status, reason: retryLeg.error || null,
      firstFailure: ff, retryWaveId: unit.waveId } };
}

/**
 * The retry pass. Serial by design (spec D-order: bench, critic, lenses) —
 * the per-wave-fallback path, where waves actually die, is exactly where
 * concurrent relaunches would race the same server start again.
 */
async function retryStage1Losses(ctx, { deadWaves = [], deadLegs = [], counts = { reviewed: 0, total: 0 } } = {}) {
  const { o, launchers } = ctx;
  const out = { aborted: null, recoveredLegs: [], stillDeadNotes: [],
    stillDeadWaves: [], stillDeadLegs: [], skippedDeadWaves: [], skippedDeadLegs: [] };

  for (const unit of groupStage1Losses(o, deadWaves, deadLegs)) {
    // Task-4 review hardening: a unit this pass cannot even ATTEMPT — an
    // unmappable lens loss (no carrier resolved an index) or a unit whose
    // sources named zero models — is never launched. Its sources fall back
    // to the ordinary skipped-loss path so the caller's normal degrade notes
    // still fire; being unmappable is not an exemption from the record.
    if (unit.lensIndex === null || unit.models.length === 0) {
      out.skippedDeadWaves.push(...unit.srcWaves);
      out.skippedDeadLegs.push(...unit.srcLegs);
      continue;
    }
    if (ctx.overBudget()) { // D7: skip silently — the loss is already announced by the caller
      out.skippedDeadWaves.push(...unit.srcWaves);
      out.skippedDeadLegs.push(...unit.srcLegs);
      continue;
    }
    runState.appendStageWave(o.runDir, 'stage1', unit.waveId); // BEFORE launch: abort cascade
    const common = { project: o.runDir, timeout: o.timeout, gateway: o.gateway,
      noValidateModel: o.noValidateModel, noCostGate: o.noCostGate,
      councilRunId: o.runId, councilName: o.councilName,
      fallback: o.fallback, catalog: o.catalog,
      waveId: unit.waveId, retryOfWaveId: unit.retryOfWaveId, prompt: briefingFor(o, unit) };
    // Dispatch by UNIT TYPE, not model count (spec §4: bench is always a wave —
    // even down to its last surviving seat — critic/lens are always solos).
    // A model-count proxy (`models.length === 1`) is wrong for a bench unit
    // that lost exactly one seat: it would route that retry through
    // launchSolo, which no bench caller wires up.
    const res = unit.unit === 'bench'
      ? await launchers.launchWave({ ...common, models: unit.models.slice() })
      : await launchers.launchSolo({ ...common, model: unit.models[0] });
    ctx.addWave(res.wave); // reservation released + measured legs counted (run-budget)
    if (isAbortExit(res.exitCode)) { out.aborted = res.exitCode; return out; }

    const legs = (res.wave && Array.isArray(res.wave.legs)) ? res.wave.legs : [];
    if (legs.length === 0) {
      // The retry wave itself died wholesale — final failure keeps each
      // source's granularity (D5): wave-origin stays a dead-wave, leg-origin
      // stays a dead-leg, both enriched with the retry fact.
      for (const w of unit.srcWaves) { out.stillDeadNotes.push(waveStillDeadNote(w, unit)); out.stillDeadWaves.push(w); }
      for (const l of unit.srcLegs) { out.stillDeadNotes.push(srcLegStillDeadNote(l, unit, counts)); out.stillDeadLegs.push(l); }
      continue;
    }
    const usable = new Set(materializeReviews(o.runDir, legs).map(m => m.leg));
    const lostWaveSeats = new Map(); // waveId -> seats still lost from a wave-origin
    for (const leg of legs) {
      const seat = leg.modelInput || leg.model;
      const ff = unit.firstFailures.find(f => f.seat === seat) || null;
      if (usable.has(leg)) {
        out.recoveredLegs.push(leg);
        ctx.degrade.note({ channel: 'stage1-retry', kind: 'heal',
          what: `seat ${seat} reviewed on retry`,
          why: ff && ff.class === 'wave'
            ? `its first wave ${ff.waveId} produced no legs (${ff.reason}) and was relaunched once`
            : `its first leg ended '${ff ? ff.status : 'unknown'}' with no usable output and was relaunched once`,
          effect: 'The seat is in this council; nothing was lost',
          data: { seat, retryWaveId: unit.waveId, retryOfWaveId: unit.retryOfWaveId, firstFailure: ff } });
      } else {
        out.stillDeadNotes.push(retryLegStillDeadNote(seat, ff, leg, unit, counts));
        if (ff && ff.class === 'wave') {
          if (!lostWaveSeats.has(ff.waveId)) { lostWaveSeats.set(ff.waveId, []); }
          lostWaveSeats.get(ff.waveId).push(seat);
        } else {
          const src = unit.srcLegs.find(l => (l.modelInput || l.model) === seat);
          if (src) { out.stillDeadLegs.push(src); }
        }
      }
    }
    // Wave-origin seats still lost: the return-contract wave entry carries only
    // the still-lost subset (a partially healed wave is not wholly dead).
    for (const w of unit.srcWaves) {
      const lost = lostWaveSeats.get(w.waveId) || [];
      if (lost.length > 0) { out.stillDeadWaves.push({ ...w, models: lost }); }
    }
  }
  return out;
}

module.exports = { groupStage1Losses, retryStage1Losses };
