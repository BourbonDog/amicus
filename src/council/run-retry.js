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
const { resolveNoOutputBackstopMs } = require('../utils/no-output-backstop');
const { waveStillDeadNote, srcLegStillDeadNote, retryLegStillDeadNote, missingLegStillDeadNote }
  = require('./run-retry-notes');
const { bindSeats } = require('./seats');
// Loss grouping lives in ./run-retry-group (v4.8 PR0 size-gate split).
// groupStage1Losses is re-exported below — run-retry.test.js imports it
// from here.
const { groupStage1Losses, planStillDeadSources, seatKey } = require('./run-retry-group');

/** The briefing a retry unit re-issues — same builders Stage 1 used. */
function briefingFor(o, unit) {
  if (unit.unit === 'critic') { return briefings.buildCriticBriefing({ briefing: o.briefing, date: o.date }); }
  if (unit.unit === 'lens') {
    return briefings.buildLensBriefing({ lens: o.lenses[unit.lensIndex - 1], briefing: o.briefing, date: o.date });
  }
  return briefings.buildSeatBriefing({ briefing: o.briefing, date: o.date });
}

/**
 * The retry pass. Serial by design (spec D-order: bench, critic, lenses) —
 * the per-wave-fallback path, where waves actually die, is exactly where
 * concurrent relaunches would race the same server start again.
 */
async function retryStage1Losses(ctx, { deadWaves = [], deadLegs = [],
  counts = { reviewed: 0, total: 0 }, seatOf = new Map() } = {}) {
  const { o, launchers } = ctx;
  // `seatOf`/`orphanLegs` are part of the CONTRACT, not a debugging aid: a
  // recovered leg is a RETRY-wave object Stage-1's seatOf has never seen, so
  // without publishing these bindings every healed seat re-materializes
  // unattributed downstream (spec §4.4).
  // `attemptedSeats` (v4.8 PR2b Task 8): the seat-keyed "was this seat actually
  // retried?" gate. Structured data, never a scan of stillDeadNotes — the full
  // rationale sits at run-stage1-rows.js's fallback, its only consumer.
  const out = { aborted: null, recoveredLegs: [], stillDeadNotes: [],
    stillDeadWaves: [], stillDeadLegs: [], skippedDeadWaves: [], skippedDeadLegs: [],
    stillDeadRetryLegs: [], seatOf: new Map(), orphanLegs: [], attemptedSeats: new Set() };
  // Task 5 (#129): SL-2 retries the SAME model under the SAME conditions, so a
  // latency failure is structurally unhealable. Double the window, clamped to
  // the leg timeout so the failure CLASS stays NO_OUTPUT_BACKSTOP rather than
  // silently becoming an ordinary timeout at a low --timeout. 2*0 === 0 keeps
  // the disable hatch. (o.timeout || 15) * 60 * 1000 mirrors fanout.js:254.
  const legTimeoutMs = (o.timeout || 15) * 60 * 1000;
  const escalatedBackstopMs = Math.min(
    2 * (Number.isFinite(o.noOutputBackstopMs) ? o.noOutputBackstopMs : resolveNoOutputBackstopMs()),
    legTimeoutMs,
  );

  for (const unit of groupStage1Losses(o, deadWaves, deadLegs, seatOf)) {
    // Task-4 review hardening: a unit this pass cannot even ATTEMPT — an
    // unmappable lens loss (no carrier resolved an index), a lens index
    // outside the run's actual lens roster (coordinator-review MINOR-7b: a
    // malformed waveId like "...-l99" must not become an out-of-range
    // `o.lenses[98]` access inside briefingFor), or a unit whose sources
    // named zero models — is never launched. Its sources fall back to the
    // ordinary skipped-loss path so the caller's normal degrade notes still
    // fire; being unmappable is not an exemption from the record.
    const lensOutOfRange = unit.unit === 'lens' && unit.lensIndex !== null
      && (unit.lensIndex < 1 || unit.lensIndex > (o.lenses || []).length);
    if (unit.lensIndex === null || lensOutOfRange || unit.models.length === 0) {
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
      tag: o.tag, // v4.7 F8 D16: rides the same forward as councilRunId/councilName.
      fallback: o.fallback, catalog: o.catalog,
      waveId: unit.waveId, retryOfWaveId: unit.retryOfWaveId, prompt: briefingFor(o, unit),
      noOutputBackstopMs: escalatedBackstopMs };
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
    // The retry wave's roster IS unit.seats — recordFailure pushes models and
    // seats in lockstep, and the legId `-N` suffix slot-indexes that same
    // launch plan. A null entry means "we could not identify this seat"; pad it
    // with a position-stable placeholder carrying a UNIQUE id so no slot
    // shifts, then drop the placeholder binds so nothing is guessed.
    // ⚠️ Never pass unit.seats raw and never use a null-id sentinel: seats.js
    // filters falsy roster entries internally (so raw === filtered, and both
    // slide every later slot into a hole), and two `{id: null}` sentinels
    // collide on the id-keyed dedup.
    // Placeholders are tracked by IDENTITY, never by an id-name prefix test: a
    // bench alias that literally began `__unbound-` would make a name test drop
    // a REAL seat's binding — a name-collision channel inside the one mechanism
    // whose whole contract is "never guess".
    const placeholders = new Set();
    const retryRoster = unit.seats.map((s, i) => {
      if (s) { return s; }
      const p = { id: `__unbound-${unit.waveId}-${i + 1}`, alias: unit.models[i], role: 'seat', lens: null, position: i + 1 };
      placeholders.add(p);
      return p;
    });
    const bindRes = bindSeats(unit.waveId, retryRoster, legs);
    const retrySeatOf = new Map(bindRes.bound
      .filter(b => !placeholders.has(b.seat))
      .map(b => [b.leg, b.seat]));
    for (const [l, s] of retrySeatOf) { out.seatOf.set(l, s); }
    // A retry leg that matches no roster slot is the same attribution failure
    // Stage-1 announces — but this module emits heals ONLY and never notes a
    // degrade (see the @module docblock), so it is REPORTED here and emitted by
    // the caller, exactly as stillDeadNotes already are.
    for (const leg of bindRes.orphanLegs) { out.orphanLegs.push({ waveId: unit.waveId, leg }); }
    // Every seat this unit LAUNCHED for, keyed exactly the way recordFailure
    // keyed it: the identified seat's id, else the alias. Keys are unique by
    // construction — recordFailure dedups on this same key, so two slots can
    // never share one.
    // ⚠️ v4.8 H4: an alias is no longer a seat identity. A `new Map(unit.models
    // .map(...))` lookup overwrites the duplicate key, so a twin bench resolves
    // BOTH still-lost seats to the LAST twin — an affirmative mis-attribution,
    // strictly worse than the `null` that says "unidentified". Every feeder
    // below must be seat-keyed for the same reason: a MIX (['x#1','x#2','x'])
    // can never match `seenSeats`, so a run where both twins healed would emit
    // a phantom dead-leg degrade and exit 2.
    const launched = new Map(); // key -> {alias, seat, ff}; alias is what notes render
    const addLaunched = (s, alias, ff) => {
      const k = seatKey(s, alias);
      if (!launched.has(k)) { launched.set(k, { alias, seat: s || null, ff: ff || null }); }
    };
    // firstFailures grows in LOCKSTEP with models/seats (recordFailure pushes
    // all three together), so slot i is one seat's whole record.
    unit.models.forEach((m, i) => addLaunched(unit.seats[i] || null, m, unit.firstFailures[i]));
    for (const w of unit.srcWaves) {
      (w.models || []).forEach((m, i) => addLaunched((w.seats || [])[i] || null, m));
    }
    for (const l of unit.srcLegs) { addLaunched(seatOf.get(l) || null, l.modelInput || l.model); }
    // A Stage-1 source leg's key, from the binding Stage 1 published for it.
    const srcLegKey = l => seatKey(seatOf.get(l) || null, l.modelInput || l.model);
    if (legs.length === 0) {
      // The retry wave itself died wholesale — final failure keeps each
      // source's granularity (D5): wave-origin stays a dead-wave, leg-origin
      // stays a dead-leg, both enriched with the retry fact. Coordinator-
      // review MINOR-4: emitted ONCE per SEAT — the grouping dedup (Task-4
      // hardening) keeps BOTH src records when a seat arrives via a srcWave
      // AND a srcLeg (or via two srcLegs), so without this a single lost
      // seat could be announced twice. Waves are processed first (mirrors
      // the "wave wins" precedent from the grouping-level dedup); a seat
      // already covered by its wave's note is skipped when its srcLeg is
      // reached.
      // v4.8 PR5c: the srcWave/srcLeg dedup lives in run-retry-group.planStillDeadSources —
      // an unidentified wave slot and a bound leg for the same seat key in DIFFERENT
      // spaces, so a naive test announces one seat twice. See that helper for the budget.
      const plan = planStillDeadSources(unit, seatOf, o.seats);
      for (const w of unit.srcWaves) {
        out.stillDeadNotes.push(waveStillDeadNote(w, unit));
        out.stillDeadWaves.push(w);
      }
      for (const k of plan.attempted) { out.attemptedSeats.add(k); }
      for (const { leg, seatId } of plan.legs) {
        out.stillDeadNotes.push(srcLegStillDeadNote(leg, unit, counts, seatId));
        out.stillDeadLegs.push(leg);
      }
      continue;
    }
    const usable = new Set(materializeReviews(o.runDir, legs, retrySeatOf).map(m => m.leg));
    // Seat-keyed off THIS wave's own bindings (an unbound leg keys by alias,
    // matching how its unidentified roster slot was keyed above).
    const seenSeats = new Set(legs.map(l => seatKey(retrySeatOf.get(l) || null, l.modelInput || l.model)));
    const lostWaveSeats = new Map(); // waveId -> [{alias, seat}] still lost from a wave-origin
    for (const leg of legs) {
      const seat = leg.modelInput || leg.model; // ALIAS — what every note renders
      const bound = retrySeatOf.get(leg) || null;
      const key = seatKey(bound, seat);
      const ff = (launched.get(key) || {}).ff || null;
      // SL-2 fix-wave: a retry response should only ever name seats THIS unit
      // launched for (unit.models is built in lockstep with firstFailures via
      // groupStage1Losses's recordFailure) — but if a leg turns up for a seat
      // with no firstFailures entry, that seat never lost its seat in the
      // first place. Skip it entirely: no heal (it would fabricate an "ended
      // 'unknown'" why for a seat that never failed) and no still-dead note —
      // the seat's first-attempt review stands untouched, rather than this
      // stray leg doubling it into a duplicate bench entry alongside the real one.
      if (!ff) { continue; }
      if (usable.has(leg)) {
        out.recoveredLegs.push(leg);
        ctx.degrade.note({ channel: 'stage1-retry', kind: 'heal',
          what: `seat ${seat} reviewed on retry`,
          // A 'missing' ff (a seat whose leg never came back) has a reason and a
          // waveId but NEVER a status — the leg arm would render "ended
          // 'undefined'" for a seat that never had a leg at all.
          why: ff.class === 'wave'
            ? `its first wave ${ff.waveId} produced no legs (${ff.reason}) and was relaunched once`
            : ff.class === 'missing'
              ? `${ff.reason} in wave ${ff.waveId}, and it was relaunched once`
              : `its first leg ended '${ff ? ff.status : 'unknown'}' with no usable output and was relaunched once`,
          effect: 'The seat is in this council; nothing was lost',
          data: { seat, retryWaveId: unit.waveId, retryOfWaveId: unit.retryOfWaveId, firstFailure: ff } });
      } else {
        out.stillDeadNotes.push(retryLegStillDeadNote(seat, ff, leg, unit, counts));
        out.attemptedSeats.add(key);
        out.stillDeadRetryLegs.push(leg);
        // Both WAVE-origin classes route here: a 'missing' loss carries a
        // waveId and no srcLeg, so the else branch would drop it from every
        // array. Task-6 carry: an UNBINDABLE retry leg leaves `bound` null
        // where the roster slot was known — fall back to the launched record
        // rather than publishing seats:[null]. Never a guess: this line is
        // reachable only when `key` is already in `launched`.
        if (ff.class !== 'leg') {
          if (!lostWaveSeats.has(ff.waveId)) { lostWaveSeats.set(ff.waveId, []); }
          lostWaveSeats.get(ff.waveId).push({ alias: seat, seat: bound || (launched.get(key) || {}).seat || null });
        } else {
          const src = unit.srcLegs.find(l => srcLegKey(l) === key);
          if (src) { out.stillDeadLegs.push(src); }
        }
      }
    }
    // CRITICAL fix (coordinator review): the loop above only visits seats
    // that came back WITH a leg record. A partial wave return (unit models
    // [a,b], the wave comes back with only a's leg) leaves 'b' invisible to
    // that loop entirely — no heal, no still-dead note, no skip: it would
    // vanish from every array. Reconcile against `launched` — the union of
    // unit.models, every srcWave's models and every srcLeg's seat, not
    // unit.models alone, so this holds even if some future change to the
    // grouping made unit.models an incomplete union — so every launched seat
    // lands in exactly one of recovered / still-dead / skipped. Slot-indexed:
    // there is no leg here to read a binding off, so the seat comes from the
    // roster slot itself, never from an alias lookup.
    for (const [key, rec] of launched) {
      if (seenSeats.has(key)) { continue; } // already handled above (healed or still-dead)
      const ff = rec.ff;
      out.stillDeadNotes.push(missingLegStillDeadNote(rec.alias, ff, unit, counts));
      out.attemptedSeats.add(key);
      if (ff && ff.class !== 'leg') {   // wave-origin, incl. a 'missing' seat
        if (!lostWaveSeats.has(ff.waveId)) { lostWaveSeats.set(ff.waveId, []); }
        lostWaveSeats.get(ff.waveId).push({ alias: rec.alias, seat: rec.seat });
      } else {
        const src = unit.srcLegs.find(l => srcLegKey(l) === key);
        if (src) { out.stillDeadLegs.push(src); }
      }
    }
    // Wave-origin seats still lost: the return-contract wave entry carries only
    // the still-lost subset (a partially healed wave is not wholly dead).
    // `seats` is narrowed in LOCKSTEP with `models`, or run-stage1-rows.js's
    // dead-seat loop index-zips a healed seat against a lost seat's alias.
    // Since v4.8 a wave can contribute SEVERAL srcWave records sharing one
    // waveId (one per missing seat, stage1-bind.js's missingSeatDeadWave), so
    // the lookup fires once per waveId — not once per record, which would push
    // every still-lost seat of that wave N times.
    const reconciled = new Set();
    for (const w of unit.srcWaves) {
      if (reconciled.has(w.waveId)) { continue; }
      reconciled.add(w.waveId);
      const lost = lostWaveSeats.get(w.waveId) || [];
      if (lost.length > 0) {
        out.stillDeadWaves.push({ ...w, models: lost.map(x => x.alias), seats: lost.map(x => x.seat) });
      }
    }
  }
  return out;
}

module.exports = { groupStage1Losses, retryStage1Losses };
