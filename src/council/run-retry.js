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

const { materializeReviews, isAbortExit } = require('./run-launch');
const runState = require('./run-state');
const { resolveNoOutputBackstopMs } = require('../utils/no-output-backstop');
const { waveStillDeadNote, srcLegStillDeadNote, retryLegStillDeadNote, missingLegStillDeadNote }
  = require('./run-retry-notes');
// briefingFor + bindRetryWave live in ./run-retry-launch (v4.8 T-A2 split); the pad/bind core it wraps is stage1-bind.js :: bindPaddedWave (SI-27).
const { briefingFor, bindRetryWave } = require('./run-retry-launch');
// Loss grouping lives in ./run-retry-group (v4.8 PR0 size-gate split).
// groupStage1Losses is re-exported below — run-retry.test.js imports it
// from here.
const { groupStage1Losses, planStillDeadSources, seatKey, twinAliases, legLossKey,
  srcLegClaimer } = require('./run-retry-group');

/**
 * The retry pass. Serial by design (spec D-order: bench, critic, lenses) —
 * the per-wave-fallback path, where waves actually die, is exactly where
 * concurrent relaunches would race the same server start again.
 */
async function retryStage1Losses(ctx, { deadWaves = [], deadLegs = [],
  counts = { reviewed: 0, total: 0 }, seatOf = new Map() } = {}) {
  const { o, launchers } = ctx;
  // v4.8 T-A6 (SI-TWINS): THE run's one `twinAliases`. It was derived independently at four
  // sites across three files; now it is made here and threaded to all of them — the two
  // run-retry-group.js consumers below by argument, and run-stage1-rows.js through `out.twins`,
  // which run-stages.js hands straight to `pushDeadSeatRows`. Two collections that disagree is
  // the desync mutants DESYNCLEG and DESYNCPLAN pin: a retried twin re-acquires its own FIRST
  // leg, which already carries a `superseded` row, so that leg is billed twice.
  const twins = twinAliases(o.seats);   // the roster's repeated aliases (v4.8 T2.2)
  // `seatOf`/`orphanLegs` are part of the CONTRACT, not a debugging aid: a
  // recovered leg is a RETRY-wave object Stage-1's seatOf has never seen, so
  // without publishing these bindings every healed seat re-materializes
  // unattributed downstream (spec §4.4).
  // `attemptedSeats` (v4.8 PR2b Task 8): the seat-keyed "was this seat actually
  // retried?" gate. Structured data, never a scan of stillDeadNotes — the full
  // rationale sits at run-stage1-rows.js's fallback, its only consumer.
  // `twins` rides on the return for the same reason `seatOf` does: the consumer must ask with
  // the collection this pass minted with, not one it re-derives (v4.8 T-A6).
  const out = { aborted: null, recoveredLegs: [], stillDeadNotes: [], twins,
    stillDeadWaves: [], stillDeadLegs: [], skippedDeadWaves: [], skippedDeadLegs: [],
    stillDeadRetryLegs: [], seatOf: new Map(), orphanLegs: [], attemptedSeats: new Set() };
  // Task 5 (#129): SL-2 retries the SAME model under the SAME conditions, so a
  // latency failure is structurally unhealable. Double the window, clamped to
  // the leg timeout so the failure CLASS stays NO_OUTPUT_BACKSTOP rather than
  // silently becoming an ordinary timeout at a low --timeout. 2*0 === 0 keeps
  // the disable hatch. (o.timeout || 15) * 60 * 1000 mirrors fanout.js:254.
  // ⚠️ #135 C0 took this 240s -> 600s; deliberate, see CHANGELOG (council A1, PR #182).
  const legTimeoutMs = (o.timeout || 15) * 60 * 1000;
  const escalatedBackstopMs = Math.min(
    2 * (Number.isFinite(o.noOutputBackstopMs) ? o.noOutputBackstopMs : resolveNoOutputBackstopMs()),
    legTimeoutMs,
  );

  for (const unit of groupStage1Losses(o, deadWaves, deadLegs, seatOf, twins)) {
    // Task-4 review hardening: a unit this pass cannot even ATTEMPT — an
    // unmappable lens loss (no carrier resolved an index), a lens index
    // outside the run's actual lens roster (coordinator-review MINOR-7b: a
    // malformed waveId like "...-l99" must not become an out-of-range
    // `o.lenses[98]` access inside run-retry-launch.js's briefingFor), or a unit whose sources
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
    const { retrySeatOf, orphanLegs } = bindRetryWave(unit, legs);
    for (const [l, s] of retrySeatOf) { out.seatOf.set(l, s); }
    // A retry leg that matches no roster slot is the same attribution failure
    // Stage-1 announces — but this module emits heals ONLY and never notes a
    // degrade (see the @module docblock), so it is REPORTED here and emitted by
    // the caller, exactly as stillDeadNotes already are.
    for (const leg of orphanLegs) { out.orphanLegs.push({ waveId: unit.waveId, leg }); }
    // Every seat this unit LAUNCHED for, keyed exactly the way recordFailure
    // keyed it: the identified seat's id, else the alias.
    // ⚠️ v4.8 T-A4: a key is NOT one slot. Since T2.2 two UNATTRIBUTABLE twins on one alias
    // mint two slots that both key by that alias, and a first-wins entry collapsed them —
    // announcing ONE dead seat where two died (B1) while every note built from it read slot
    // 0's firstFailure (B2). So an entry carries a slot COUNT and its OWN per-slot
    // firstFailures. Only `unit.models` — the launch PLAN — mints: srcWaves/srcLegs are the
    // union safety net the reconcile below rests on, and must leave a key at >=1 without
    // inflating one that arrives through both. Inflating it manufactures a phantom dead seat.
    // ⚠️ v4.8 H4: an alias is no longer a seat identity. A `new Map(unit.models
    // .map(...))` lookup overwrites the duplicate key, so a twin bench resolves
    // BOTH still-lost seats to the LAST twin — an affirmative mis-attribution,
    // strictly worse than the `null` that says "unidentified". Every feeder
    // below must be seat-keyed for the same reason: a MIX (['x#1','x#2','x'])
    // can never match `seenSeats`, so a run where both twins healed would emit
    // a phantom dead-leg degrade and exit 2.
    const launched = new Map(); // key -> {alias, seat, slots, ffs}; alias is what notes render
    const addLaunched = (s, alias, ff, mint = false) => {
      const k = seatKey(s, alias);
      if (!launched.has(k)) { launched.set(k, { alias, seat: s || null, slots: 0, ffs: [] }); }
      if (mint) { const rec = launched.get(k); rec.slots += 1; rec.ffs.push(ff || null); }
    };
    // NOT lockstep by construction — recordFailure pushes `firstFailures` always but models/seats
    // only `if (trackModel)`. Slot i is one seat's whole record EMERGENTLY, on two measured facts:
    // no unit MIXES the flag (bench/lens sites pass true, both critic sites false), so a tracking
    // unit grows all three together; and the critic unit's `firstFailures` caps at 1 — its INEXACT
    // arm needs `twins.has(o.critic)` with a null `criticSeatObj`, and `twins` IS `twinAliases(o.seats)`,
    // so the first implies the second non-null. The one MEASURED break (a `-c1` wave, no `o.critic`:
    // ff 1 / models 0) the `models.length === 0` skip above ate. Pinned: run-retry-lockstep.test.js.
    unit.models.forEach((m, i) => addLaunched(unit.seats[i] || null, m, unit.firstFailures[i], true));
    for (const w of unit.srcWaves) {
      (w.models || []).forEach((m, i) => addLaunched((w.seats || [])[i] || null, m));
    }
    for (const l of unit.srcLegs) { addLaunched(seatOf.get(l) || null, l.modelInput || l.model); }
    // A Stage-1 source leg's key, from the binding Stage 1 published for it.
    const srcLegKey = l => seatKey(seatOf.get(l) || null, l.modelInput || l.model);
    // v4.8 T2.2: ONE source per still-dead outcome (srcLegs.find handed the first one
    // out twice, so the second orphaned twin left no record), and the ROW key that seat
    // will be looked up by downstream. Both move with recordFailure's dedup or a retried
    // twin re-acquires its own first leg — which already has a `superseded` row, so that
    // leg's cost lands in runStats twice while its retry leg lands nowhere.
    const claimSrc = srcLegClaimer(unit.srcLegs, srcLegKey);
    const srcRowKey = l => legLossKey(seatOf.get(l) || null, l.modelInput || l.model, l, twins);
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
      const plan = planStillDeadSources(unit, seatOf, o.seats, twins);
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
    // v4.8 T-A4: a COUNT, not a presence Set — two unattributable twins share one key, so
    // "was it seen at all?" cannot tell one returned leg from two. Filled by the loop below,
    // which visits every leg (including one skipped for having no slot, as `legs.map` did).
    const seenSeats = new Map(); // key -> legs this wave returned for it
    const lostWaveSeats = new Map(); // waveId -> [{alias, seat}] still lost from a wave-origin
    for (const leg of legs) {
      const seat = leg.modelInput || leg.model; // ALIAS — what every note renders
      const bound = retrySeatOf.get(leg) || null;
      const key = seatKey(bound, seat);
      // This leg answers the key's NEXT unanswered slot, and reads THAT slot's own
      // firstFailure (T-A4 B2). Counted BEFORE the `!ff` skip below, so the tally the
      // reconcile reads still means "legs this wave returned for the key".
      const slot = seenSeats.get(key) || 0;
      seenSeats.set(key, slot + 1);
      const ff = (launched.get(key) || { ffs: [] }).ffs[slot] || null;
      // SL-2 fix-wave: a retry response should only ever name seats THIS unit
      // launched for (`unit.models` is index-parallel to `firstFailures` EMERGENTLY,
      // for the two reasons the mint above states) — but if a leg turns up for a seat
      // with no firstFailures entry, or (v4.8 T-A4) beyond the LAST slot its key
      // minted, that seat never lost its seat in the first place. `slots` is an
      // upper bound as well as a lower one, and this is where the upper half is
      // spent. Skip it entirely: no heal (it would fabricate an "ended
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
          const src = claimSrc(key);
          if (src) { out.stillDeadLegs.push(src); out.attemptedSeats.add(srcRowKey(src)); }
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
    // grouping made unit.models an incomplete union — so every launched SLOT
    // lands in exactly one of recovered / still-dead / skipped. Slot-indexed:
    // there is no leg here to read a binding off, so the seat comes from the
    // roster slot itself, never from an alias lookup.
    for (const [key, rec] of launched) {
      // v4.8 T-A4: `max(slots, 1) - seen` notes, not a presence test. `max(…, 1)` is what
      // keeps the union net a net: feeders 2 and 3 mint no slot, so a key only THEY know
      // still reconciles exactly ONCE, and a seat that arrives through both the launch plan
      // and a srcLeg is counted by the plan alone. `rec.seat` is shared across a key's slots
      // and that is sound: two slots can only share a key when NEITHER was identified (an
      // identified slot keys by its own seat id), so every slot of such a key has seat null.
      for (let i = seenSeats.get(key) || 0; i < Math.max(rec.slots, 1); i++) {
        const ff = rec.ffs[i] || null;
        out.stillDeadNotes.push(missingLegStillDeadNote(rec.alias, ff, unit, counts));
        out.attemptedSeats.add(key);
        if (ff && ff.class !== 'leg') {   // wave-origin, incl. a 'missing' seat
          if (!lostWaveSeats.has(ff.waveId)) { lostWaveSeats.set(ff.waveId, []); }
          lostWaveSeats.get(ff.waveId).push({ alias: rec.alias, seat: rec.seat });
        } else {
          const src = claimSrc(key);
          if (src) { out.stillDeadLegs.push(src); out.attemptedSeats.add(srcRowKey(src)); }
        }
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
