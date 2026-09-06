'use strict';

/**
 * @module council/run-retry-notes
 * Pure note-builders for the SL-2 Stage-1 retry pass (split out of
 * run-retry.js for the 300-line gate — same rationale as run-stage2.js
 * splitting off run-stages.js, v4.4.1 Task 2). No I/O, no ctx: each function
 * takes plain data and returns a still-dead note ready for
 * `ctx.degrade.note(...)` (D5 final-failure granularity, spec §5). The heal
 * note is built inline in run-retry.js's orchestrator (it is the one place
 * that decides recovery, and stays small).
 */

/** D-effect parity: still-dead leg notes reuse today's count phrasing, with the
 *  FIRST attempt's counts — the why carries the retry story (spec §5). */
const legEffect = (counts) =>
  `${counts.reviewed} of ${counts.total} seats reviewed; `
  + 'the run continues with the bench that did and will exit degraded (2)';

/**
 * Wave-origin, retry wave died wholesale (D5 wave granularity).
 *
 * v4.8 PR2b Task 7: a `partial` record (stage1-bind.js's missingSeatDeadWave) is
 * ONE seat of a wave that DID return legs, so the dead-wave sentence would be a
 * false statement in a user-facing degrade — it names the seat instead, on the
 * `seat-unbound` channel the other half of that join failure already uses.
 */
function waveStillDeadNote(w, unit) {
  const partial = !!w.partial;
  return { channel: partial ? 'seat-unbound' : 'dead-wave',
    what: partial
      ? `seat ${(w.models || [])[0]} did not review`
      : `Stage-1 wave ${w.waveId} (${(w.models || []).join(', ') || 'no models'}) produced NO legs`,
    // Coordinator-review MINOR-7c: a falsy w.reason must not render as the
    // literal string "undefined" in the why text.
    why: `${w.reason || 'no reason recorded'}; the once-only retry wave also produced no legs`,
    effect: 'Those seats are NOT in this council. The run continues with the bench that did '
      + 'launch and will exit degraded (2)',
    // `seat`/`seatId` ride ONLY on the partial shape: adding either unconditionally breaks
    // degrade-channels.test.js's exact toEqual on a real dead wave. `seat` stays the
    // ALIAS because verdict-seat-loss.js :: deriveSeatLoss compares data.seat against o.critic,
    // an alias, and because it is the same key the dead-leg shape uses — one vocabulary
    // for one field. ⚠️ It IS read by the Workspace as of v4.9 W9: all three consumers
    // (live-dead-seats.js :: deadSeats, workspace-seats.js :: retriedSeats,
    // verdict-seat-loss.js :: deriveSeatLoss) now admit `seat-unbound` — GATED on the retry-family
    // fields below, because orphan-leg and re-vote notes share this channel and are not
    // seat losses. Cited by SYMBOL, not line: these three references rotted twice during
    // v4.8 PR5c alone.
    data: { waveId: w.waveId, models: w.models, reason: w.reason, retryWaveId: unit.waveId,
      // v4.8 PR5c: seat identity, index-parallel with `models`, on the dead-wave arm only
      // (the partial arm names ONE seat, so it carries the SCALAR `seatId` below instead —
      // the reason given here for emitting nothing at all, that `seat-unbound` had no
      // consumer, stopped being true in v4.9 W9, which gave it three).
      // ⚠️ An unidentified slot emits `null`, NEVER the alias. Collapsing it onto the alias
      // makes it indistinguishable from a second reference to that alias, and no consumer
      // can recover the difference — deadSeats has no per-alias seat count. That collapse
      // is what made two distinct dead twins render as a single row.
      // v4.9 W9 P1: the fifth arm's seat identity. A SCALAR `seatId`, matching the two leg
      // arms' vocabulary — this arm names exactly ONE seat, so the dead-wave arm's parallel
      // ARRAY would be a second spelling of the same fact. Same null discipline as that
      // array: an unidentified slot emits `null`, never the alias.
      ...(partial ? { seat: (w.models || [])[0],
        seatId: ((w.seats || [])[0] && (w.seats || [])[0].id) || null } : {
        seats: (w.models || []).map((m, i) => {
          const so = (w.seats || [])[i];
          return so ? so.id : null;
        }),
      }) } };
}

/**
 * The retry pass never ATTEMPTED this wave (run-retry.js's two `skipped` arms: an unmappable
 * or zero-model unit, or `ctx.overBudget()`). Lifted out of run-stages.js's emit loop in the
 * v4.9 W9 fix round so it sits beside `waveStillDeadNote`, whose partial arm it mirrors: two
 * spellings of ONE record shape in two files is what let them drift apart in the first place.
 *
 * ⚠️ Carries NO `retryWaveId`, and must not: no retry wave was ever launched, so naming one
 * would be a false statement about spend, and the two Workspace renderers read exactly that
 * field to decide the 'retried once' phrasing.
 *
 * v4.9 W9 fix round 1 (council A1/C1). The partial arm previously carried `{waveId, models,
 * reason, seat}` and no retry-family field at all, so all three W9 consumers
 * (`live-dead-seats.js :: isSeatLoss`, `workspace-seats.js :: retriedSeats`,
 * `verdict-seat-loss.js :: deriveSeatLoss`) dropped a genuinely dead seat — residual R-W9a,
 * pinned known-wrong and escalated. It now emits the two facts it has ALREADY:
 *   `seatId`  — from the record's own `seats[0]` (stage1-bind.js :: missingSeatDeadWave carries
 *               it), same null discipline as the arms above: an unidentified slot emits `null`,
 *               NEVER the alias.
 *   `firstFailure` — the canonical `run-retry-group.js :: recordFailure` shape for a partial
 *               wave (`class: 'missing'`, the record's own waveId/reason). It restates this
 *               record's first-pass loss and claims nothing about a retry, which is what opens
 *               the consumers' retry-family gate WITHOUT loosening it: orphan-leg, re-vote and
 *               Stage-2 judge notes still carry neither field and stay excluded.
 */
function skippedWaveNote(d) {
  const partial = !!d.partial;
  const alias = (d.models || [])[0];
  return {
    channel: partial ? 'seat-unbound' : 'dead-wave',
    // A `partial` record is one seat of a wave that DID produce legs, so the plain dead-wave
    // sentence would be false. Everything below `models` rides on that shape ONLY: adding any
    // of it unconditionally breaks an exact toEqual on a real dead wave.
    what: partial
      ? `seat ${alias} did not review`
      : `Stage-1 wave ${d.waveId} (${d.models.join(', ') || 'no models'}) produced NO legs`,
    why: d.reason,
    effect: 'Those seats are NOT in this council. The run continues with the bench that did '
      + 'launch and will exit degraded (2)',
    data: { waveId: d.waveId, models: d.models, reason: d.reason,
      ...(partial ? { seat: alias,
        seatId: ((d.seats || [])[0] && (d.seats || [])[0].id) || null,
        firstFailure: { seat: alias, class: 'missing', waveId: d.waveId, reason: d.reason },
      } : {}) },
  };
}

/**
 * Leg-origin, retry wave died wholesale (bench-batch case).
 *
 * v4.8 PR5c: `seatId` is the caller's Stage-1 leg->seat binding, or null when the leg was
 * never bound. It is a SEPARATE key from `seat`, which stays the ALIAS —
 * `verdict-seat-loss.js :: deriveSeatLoss`'s `criticLeg` lookup compares `data.seat` against
 * `o.critic`, an alias, so re-pointing it breaks critic-loss detection. Cited by SYMBOL, not
 * line: the old `verdict.js:72` had already slid one line off that comparison, and the
 * function has since left verdict.js entirely. Add a key; never repurpose that one.
 */
function srcLegStillDeadNote(leg, unit, counts, seatId = null) {
  const seat = leg.modelInput || leg.model;
  return { channel: 'dead-leg', what: `seat ${seat} did not review`,
    why: `the leg ended '${leg.status}'${leg.error ? `: ${leg.error}` : ''} with no usable output; `
      + 'its once-only retry wave produced no legs',
    effect: legEffect(counts),
    data: { seat, seatId: seatId || null, status: leg.status, reason: leg.error || null,
      retryWaveId: unit.waveId } };
}

/**
 * Either origin, the retry produced legs but THIS seat's retry leg died.
 *
 * A 'missing' first failure has a `reason` and a `waveId` but NEVER a `status` —
 * the leg arm would report that its first leg "ended 'undefined'" for a seat
 * that never had a first leg at all.
 */
function retryLegStillDeadNote(seat, ff, retryLeg, unit, counts) {
  const missing = !!(ff && ff.class === 'missing');
  const why = ff && ff.class === 'wave'
    ? `its first wave ${ff.waveId} produced no legs (${ff.reason}); `
      + `its once-only retry leg ended '${retryLeg.status}' with no usable output`
    : missing
      ? `${ff.reason} in wave ${ff.waveId}; its once-only retry leg ended `
        + `'${retryLeg.status}' with no usable output`
      : `the leg ended '${ff ? ff.status : 'unknown'}'${ff && ff.reason ? `: ${ff.reason}` : ''} `
        + `with no usable output; its once-only retry also ended '${retryLeg.status}'`;
  return { channel: missing ? 'seat-unbound' : 'dead-leg', what: `seat ${seat} did not review`, why,
    effect: legEffect(counts),
    data: { seat, status: retryLeg.status, reason: retryLeg.error || null,
      firstFailure: ff, retryWaveId: unit.waveId } };
}

/**
 * CRITICAL fix (coordinator review): a launched seat can be missing a leg
 * record ENTIRELY from the retry response — a partial wave return (unit
 * models [a,b], the wave comes back with only a's leg). This is distinct
 * from `retryLegStillDeadNote` (the seat's retry leg came back but was
 * unusable) — here there is no retry-attempt status/error to report at all,
 * only the ORIGINAL first-failure fact plus the fact that nothing came back
 * this time.
 */
function missingLegStillDeadNote(seat, ff, unit, counts) {
  const missing = !!(ff && ff.class === 'missing');
  const fact = ff && ff.class === 'wave'
    ? `its first wave ${ff.waveId} produced no legs (${ff.reason})`
    : missing
      ? `${ff.reason} in wave ${ff.waveId}`
      : `the leg ended '${ff ? ff.status : 'unknown'}'${ff && ff.reason ? `: ${ff.reason}` : ''} with no usable output`;
  return { channel: missing ? 'seat-unbound' : 'dead-leg', what: `seat ${seat} did not review`,
    why: `${fact}; its once-only retry produced no leg for this seat`,
    effect: legEffect(counts),
    data: { seat, status: null, reason: null, firstFailure: ff, retryWaveId: unit.waveId } };
}

/**
 * #218 PR 3: a review that reached the packet but was cut at the reservation.
 * `kind: 'info'` -- announced, never a loss (utils/degrade.js on the channel).
 * The counts are the engine's own token record for the leg; the remedy names
 * the one lever that exists today.
 * @param {string} seat the alias every note renders — `materializeReviews` has
 *   already resolved it (`leg.modelInput || leg.model`), so the caller passes
 *   `m.modelInput` as-is
 * @param {object} leg the leg run document (finish === 'length')
 */
function truncatedReviewNote(seat, leg) {
  const t = (leg.usage && leg.usage.tokens) || {};
  return { kind: 'info', channel: 'output-truncated',
    what: `seat ${seat}'s review was cut at its output reservation`,
    why: `the provider stopped for length (finish 'length') after ${t.reasoning || 0} reasoning / ${t.output || 0} output tokens; the review ends where the reservation ended`,
    effect: 'The review is in the packet as far as it got, and its header in the chair packet says it was cut; nothing else changes',
    remedy: 'raise outputBudget in config.json (docs/configuration.md, Output budget)',
    data: { seat, finish: 'length', reasoningTokens: t.reasoning || 0, outputTokens: t.output || 0 } };
}

module.exports = { waveStillDeadNote, skippedWaveNote, srcLegStillDeadNote,
  retryLegStillDeadNote, missingLegStillDeadNote, truncatedReviewNote };
