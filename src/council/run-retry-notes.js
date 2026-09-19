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
 *
 * #257: `./promoted` is a LEAF require. `reasoningOnlyClause` is appended after "with no
 * usable output" at every site below, and returns the EMPTY STRING for a leg
 * that is not promoted — so every announcement for every other leg stays
 * byte-identical. Both are re-exported so run-retry.js and run-stages.js, which
 * already destructure this module, take the clause from one place.
 *
 * #257 R-X38: the second require is the house sanitizer, itself a leaf. Every `why` below
 * quotes a PROVIDER-controlled error into prose that reaches stderr, run.json and report.md,
 * so each is bounded to one sanitized line as `run-stage2-notes.js :: judgeDeadNote` already
 * bounds its own (#219). The `data` fields keep RAW bytes — machine surface, not a sentence.
 */
const { promotedFacts, reasoningOnlyClause } = require('./promoted');
const { collapseExcerpt } = require('../utils/text-sanitize');

/**
 * #257 R-X38 fix round 1 — the cap on a leg error QUOTED INTO PROSE.
 *
 * THE RULING (owner, round 3): this cap bounds PROVIDER noise — control characters, ANSI,
 * bidi, whitespace runs, unbounded length — and must be wide enough that every reason AMICUS
 * ITSELF mints passes through WHOLE. A minted reason is the product's own self-diagnosis:
 * `utils/output-length.js :: formatOutputLengthReason` ends in "raise outputBudget in
 * config.json (docs/configuration.md, Output budget)", and a cap that eats that remedy turns
 * a self-diagnosing failure into a silent one.
 *
 * MEASURED 2026-09-19, real formatters, the pin's exact inputs, longest FIRST (400 REFUTED):
 *   518  headless.js :: formatNoOutputBackstopReason — caller-set, extended, every clause
 *   517  formatOutputLengthReason — budget unset, a non-plain ambient flag
 *   438  formatOutputLengthReason — budget unset, a plain ambient flag
 *   398  formatNoOutputBackstopReason — engine log + skew + session, NOT extended
 * 800 clears the longest by 282 — more than the 200-char engine-log excerpt that same
 * backstop format already embeds, so one further excerpt-sized clause still passes whole.
 * Pinned against the REAL formatters, never a copied literal, in
 * tests/council/run-retry-notes.test.js. Named mutant "MINTEDREASONTRUNCATED".
 *
 * ⚠️ `formatOutputLengthReason` interpolates the ambient OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX
 * verbatim, so its length is OPERATOR-controlled: no finite cap is a proof, and the pin (which
 * measures the realistic forms) is a tripwire on drift, not a bound.
 *
 * Shared with run-stages.js through this module's exports: it already destructures this one,
 * so a single definition costs no new require edge and no cycle. Deliberately NOT in
 * `utils/text-sanitize.js` — "leg error" is council vocabulary, and that module's own header
 * keeps each caller's cap with the caller (alias-shadow.js holds its own 64-char cap).
 */
const MAX_LEG_ERROR_CHARS = 800;

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
 *
 * #257 R-X14: the reasoning-channel facts ride `data.promoted` as well as the prose. This
 * is the ONE record class where the fact is otherwise unrecoverable — a promoted leg has no
 * `error`, so `data.reason` is null and `data.status` is 'complete', and this arm carries no
 * `firstFailure` for a consumer to read it off. `deriveSeatLoss` renders `data` and nothing
 * else, so without this key a promoted CRITIC reaches verdict.json as the bare, true and
 * uninformative "ended 'complete' with no usable output". Emit-when-promoted, so every
 * non-promoted record is byte-identical. Named mutant "DATAPROMOTEDDROPPED"
 * (tests/council/run-retry-notes.test.js).
 */
function srcLegStillDeadNote(leg, unit, counts, seatId = null) {
  const seat = leg.modelInput || leg.model;
  const pf = promotedFacts(leg); // named in the `why` AND carried in `data` — one read
  return { channel: 'dead-leg', what: `seat ${seat} did not review`,
    // #257 R-X38: the prose is bounded, `data.reason` below is not. Named mutant "RETRYPROSERAW".
    why: `the leg ended '${leg.status}'${leg.error ? `: ${collapseExcerpt(leg.error, MAX_LEG_ERROR_CHARS)}` : ''} with no usable output${reasoningOnlyClause(pf)}; `
      + 'its once-only retry wave produced no legs',
    effect: legEffect(counts),
    data: { seat, seatId: seatId || null, status: leg.status, reason: leg.error || null,
      retryWaveId: unit.waveId, ...(pf ? { promoted: pf } : {}) } };
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
  // #256: the RETRY's own cause, when it is not the first failure's. MEASURED
  // (run 35143585179, 2026-09-16): glm and qwen died NO_OUTPUT_BACKSTOP at 480 s
  // and their once-only retries were REFUSED by OpenRouter two seconds later for
  // want of credit — two different deaths that this sentence rendered as one,
  // because the retry's reason reached run.json only inside `data.reason`. Named
  // in the same `'<status>': <reason>` shape the first attempt already uses.
  // An identical, empty or absent retry error keeps the text BYTE-IDENTICAL to
  // the pre-#256 wording: repeating one reason twice is noise, and several
  // suites pin that exact string.
  // Council #264 r1 (C2 + D2): BOTH sides are trimmed FOR THE COMPARISON.
  // Trimming only the retry made the same reason with different whitespace
  // compare unequal, so the note printed one reason twice — the byte-identity
  // guarantee broken by the very comparison meant to uphold it.
  // Council #264 r2 (A4 + C1 + D2, three seats independently): the RENDERED text uses each
  // side's OWN bytes, not the other side's and not the comparison's scratch value. It used to
  // render the TRIMMED retry string while `data.reason` carried the raw one, so the note's
  // prose and its machine-readable field disagreed about the same error.
  // #257 R-X38 SUPERSEDES the "original bytes, padding and all" half of that: the rendered
  // cause is each side's own bytes through the house sanitizer at MAX_LEG_ERROR_CHARS.
  // `data.reason` still carries the RAW string, and the prose still names the SAME error the
  // data does — a bounded quotation of it, never a different one. The COMPARISON is untouched.
  const retryRaw = typeof retryLeg.error === 'string' ? retryLeg.error : '';
  const retryErr = retryRaw.trim();
  const firstReason = (ff && typeof ff.reason === 'string') ? ff.reason.trim() : '';
  const retryCause = (retryErr && retryErr !== firstReason) ? `: ${collapseExcerpt(retryRaw, MAX_LEG_ERROR_CHARS)}` : '';
  // #257: each half names its OWN leg's reasoning channel — the first failure's facts ride
  // `ff.promoted` (minted in run-retry-group.js), the retry leg's are read off the leg here.
  // R-X14: `data.status`/`data.reason` describe the RETRY leg, so `data.promoted` does too —
  // the first leg's facts are already on `data.firstFailure.promoted`. One read, both uses.
  const retryPf = promotedFacts(retryLeg);
  const why = ff && ff.class === 'wave'
    ? `its first wave ${ff.waveId} produced no legs (${ff.reason}); `
      + `its once-only retry leg ended '${retryLeg.status}'${retryCause} with no usable output${reasoningOnlyClause(retryPf)}`
    : missing
      ? `${ff.reason} in wave ${ff.waveId}; its once-only retry leg ended `
        + `'${retryLeg.status}'${retryCause} with no usable output${reasoningOnlyClause(retryPf)}`
      // #257 R-X38: `ff.reason` on the LEG arm is minted from the first leg's own `leg.error`
      // (`run-retry-group.js :: recordFailure`), so it is provider text too and is bounded here.
      : `the leg ended '${ff ? ff.status : 'unknown'}'${ff && ff.reason ? `: ${collapseExcerpt(ff.reason, MAX_LEG_ERROR_CHARS)}` : ''} `
        + `with no usable output${reasoningOnlyClause(ff && ff.promoted)}; its once-only retry also ended '${retryLeg.status}'${retryCause}${reasoningOnlyClause(retryPf)}`;
  return { channel: missing ? 'seat-unbound' : 'dead-leg', what: `seat ${seat} did not review`, why,
    effect: legEffect(counts),
    data: { seat, status: retryLeg.status, reason: retryLeg.error || null,
      firstFailure: ff, retryWaveId: unit.waveId, ...(retryPf ? { promoted: retryPf } : {}) } };
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
      // #257 R-X38: same bound, same reason — `ff.reason` here is the first leg's `leg.error`.
      : `the leg ended '${ff ? ff.status : 'unknown'}'${ff && ff.reason ? `: ${collapseExcerpt(ff.reason, MAX_LEG_ERROR_CHARS)}` : ''} with no usable output${reasoningOnlyClause(ff && ff.promoted)}`;
  return { channel: missing ? 'seat-unbound' : 'dead-leg', what: `seat ${seat} did not review`,
    why: `${fact}; its once-only retry produced no leg for this seat`,
    effect: legEffect(counts),
    // #257 R-X14: there IS no retry leg here, so `data.promoted` restates the FIRST failure's
    // facts — the same ones `data.status`/`data.reason` describe (both null on this arm).
    data: { seat, status: null, reason: null, firstFailure: ff, retryWaveId: unit.waveId,
      ...(ff && ff.promoted ? { promoted: ff.promoted } : {}) } };
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
  retryLegStillDeadNote, missingLegStillDeadNote, truncatedReviewNote,
  // #257 (+ R-X38 fix 1 for the cap): re-exported so the two files that already destructure
  // this module — run-retry.js (the heal note) and run-stages.js (the skipped-leg note) —
  // take the clause and the prose cap from ONE place rather than each keeping a copy.
  reasoningOnlyClause, promotedFacts, MAX_LEG_ERROR_CHARS };
