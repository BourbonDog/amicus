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


/** 1-based lens index for a loss, from the waveId convention or the model. */
function lensIndexOf(o, waveId, model) {
  const m = /-l(\d+)$/.exec(waveId || '');
  if (m) { return Number(m[1]); }
  const i = (o.models || []).indexOf(model);
  return i === -1 ? null : i + 1;
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
  const lensUnits = new Map(); // lensIndex -> unit
  const criticUnit = { unit: 'critic', waveId: `${o.runId}-c1r1`, retryOfWaveId: `${o.runId}-c1`,
    models: o.critic ? [o.critic] : [], firstFailures: [], srcWaves: [], srcLegs: [] };

  const lensUnitFor = (i) => {
    if (!lensUnits.has(i)) {
      lensUnits.set(i, { unit: 'lens', lensIndex: i, waveId: `${o.runId}-l${i}r1`,
        retryOfWaveId: `${o.runId}-l${i}`, models: [], firstFailures: [], srcWaves: [], srcLegs: [] });
    }
    return lensUnits.get(i);
  };

  for (const w of deadWaves) {
    const models = w.models || [];
    if (o.lenses) {
      const u = lensUnitFor(lensIndexOf(o, w.waveId, models[0]));
      u.models.push(...models);
      u.srcWaves.push(w);
      u.firstFailures.push(...models.map(seat => ({ seat, class: 'wave', waveId: w.waveId, reason: w.reason })));
    } else if (isCriticWave(w)) {
      criticUnit.srcWaves.push(w);
      criticUnit.firstFailures.push({ seat: o.critic, class: 'wave', waveId: w.waveId, reason: w.reason });
    } else {
      bench.models.push(...models);
      bench.srcWaves.push(w);
      bench.firstFailures.push(...models.map(seat => ({ seat, class: 'wave', waveId: w.waveId, reason: w.reason })));
    }
  }
  for (const leg of deadLegs) {
    const seat = leg.modelInput || leg.model;
    const ff = { seat, class: 'leg', status: leg.status, reason: leg.error || null };
    if (o.lenses) {
      const u = lensUnitFor(lensIndexOf(o, null, seat));
      u.models.push(seat);
      u.srcLegs.push(leg);
      u.firstFailures.push(ff);
    } else if (o.critic && seat === o.critic) {
      criticUnit.srcLegs.push(leg);
      criticUnit.firstFailures.push(ff);
    } else {
      bench.models.push(seat);
      bench.srcLegs.push(leg);
      bench.firstFailures.push(ff);
    }
  }

  const out = [];
  if (bench.firstFailures.length > 0) { out.push(bench); }
  if (criticUnit.firstFailures.length > 0) { out.push(criticUnit); }
  out.push(...[...lensUnits.values()].sort((a, b) => a.lensIndex - b.lensIndex));
  return out;
}

module.exports = { groupStage1Losses };
