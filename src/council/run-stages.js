// src/council/run-stages.js
'use strict';

/**
 * @module council/run-stages
 * Stage-1 (independent reviews) loop for the headless council engine — launch,
 * materialize, validate, bounded repair. Split from run.js for the 300-line
 * gate; Stage 2 lives in ./run-stage2.js for the same reason (v4.4.1 Task 2) and
 * is RE-EXPORTED from here, so this module is the single import surface for both
 * stage loops. All model calls go through ctx.launchers (DI); the whole-run cost
 * ceiling is consulted via ctx.overBudget() before every paid repair launch
 * (spec §4).
 *
 * Headless adaptation (vs SKILL.md): a review still malformed after 2 repair
 * re-prompts is KEPT with conformance 'unstructured' and zero findings entries
 * (the skill's Claude hand-parse fallback has no headless equivalent; the
 * review still gets ranked in Stage 2).
 */

const { validateFindings, countAttemptedFindings } = require('./findings');
const briefings = require('./briefings');
const { materializeReviews, isAbortExit } = require('./run-launch');
const { retryStage1Losses } = require('./run-retry');
const runState = require('./run-state');
const { runStage2 } = require('./run-stage2');
const { launchStage1 } = require('./run-stage1-launch');
const { buildRunStatsEntry } = require('./run-assemble');
const { pushDeadSeatRows } = require('./run-stage1-rows');
const { bindStage1Waves, orphanLegNote, missingSeatDeadWave } = require('./stage1-bind');
// slug lives in ./seats (v4.8 PR1) so that module can stay require-free;
// re-exported below — run-stages.test.js imports it from here.
const { slug } = require('./seats');

/** Role of a seat by its input alias. */
function roleFor(o, alias) {
  if (o.lenses) {
    const i = o.models.indexOf(alias);
    return i === -1 ? 'seat' : `lens:${slug(o.lenses[i])}`;
  }
  return alias === o.critic ? 'critic' : 'seat';
}

/**
 * Stage 1: independent reviews + findings validation + bounded repair.
 * @returns {Promise<{aborted: number|null, reviews: Array, deadLegs: Array,
 *   deadWaves: Array, degraded: boolean, extraRows: Array}>} `extraRows` (v4.7
 *   D2/E4) is the row-per-launch channel for legs that never became — or
 *   stopped being — a seat's primary review: one `role:'repair'` row per
 *   findings-repair solo (error status when the repair itself failed), one
 *   `role:'superseded'` row per first leg a later attempt replaced (healed OR
 *   still-dead — either way the first leg stopped being primary), and one
 *   PRIMARY error row per seat with no surviving review at all.
 *   `degraded` covers BOTH ways a seat can go missing: a leg that ran and died
 *   (deadLegs) and a whole sub-wave that
 *   died before its legs existed (deadWaves). A pushed review carries
 *   `findingsUnverified: true` (LC-11) when its findings came from a repair whose
 *   contract could not be checked — the original block was absent or unparseable,
 *   so there was no finding count to compare against — and `repairRefused:
 *   {code, detail}` (review F1) when the contract WAS checked and broken, which is
 *   what separates a refused repair from a seat that never emitted JSON.
 */
async function runStage1(ctx) {
  const { o } = ctx;
  const { aborted, legs, deadWaves, waves } = await launchStage1(ctx);
  if (aborted) { return { aborted, reviews: [], deadLegs: [], deadWaves: [], degraded: false, extraRows: [] }; }

  // Per-wave binding, before anything reads a leg. Orphans are announced now —
  // they are not a loss, so the "never degrade for a seat the retry saves" rule
  // below does not apply to them.
  const { seatOf, missingSeats, orphanLegs } = bindStage1Waves(waves);
  for (const { waveId, leg } of orphanLegs) { ctx.degrade.note(orphanLegNote(waveId, leg)); }
  // R-B: a launched seat whose leg never came back is a LOSS — it lands in
  // neither deadLegs (no leg object) nor deadWaves (the wave DID produce legs).
  // It reaches the retry as a single-seat dead wave flagged `partial` so its
  // prose stays true, and is announced only if the retry cannot save it.
  const allDeadWaves = [...deadWaves, ...missingSeats.map(missingSeatDeadWave)];

  const firstPass = materializeReviews(o.runDir, legs, seatOf);
  const alive0 = new Set(firstPass.map(m => m.leg));
  const deadLegs0 = legs.filter(l => !alive0.has(l));

  // SL-2: one retry BEFORE anything is recorded lost — the sink never
  // un-flips, so a degrade for a seat the retry saves must never fire at all.
  // `total` counts SEATS: legs.length alone renders "1 of 1 seats reviewed"
  // beside a degrade when a seat's leg never returned.
  const retry = await retryStage1Losses(ctx, { deadWaves: allDeadWaves, deadLegs: deadLegs0, seatOf,
    counts: { reviewed: firstPass.length, total: legs.length + missingSeats.length } });
  if (retry.aborted) {
    // Final whole-branch review: same bug class as the post-retry-repair
    // abort fixed ~87 lines below ("Must be the post-retry set") — subtract
    // whatever retry.recoveredLegs already healed before this abort landed.
    // SEAT-keyed since v4.8 H4: twin seats now retry INDEPENDENTLY, so an alias
    // Set marks BOTH healed the moment one of them is — the still-dead twin
    // silently disappears from deadLegs AND deadWaves[].models, and run.js
    // persists that return into stage-1 state as if it had reviewed.
    const keyOf = (l, bind) => { const s = bind.get(l); return s ? s.id : (l.modelInput || l.model); };
    const healed = new Set(retry.recoveredLegs.map(l => keyOf(l, retry.seatOf)));
    // `seats` must be narrowed in LOCKSTEP with `models`: a bare `...w` carries
    // the FULL roster past a narrowed models list, and run.js persists this
    // record before the abort short-circuit — so index i of each would name a
    // different seat in run.json. Omitted entirely when the source had none.
    return { aborted: retry.aborted, reviews: [], degraded: false, extraRows: [],
      deadLegs: deadLegs0.filter(l => !healed.has(keyOf(l, seatOf))),
      deadWaves: allDeadWaves.map((w) => {
        const keep = (w.models || []).map((m, i) => [m, (w.seats || [])[i] || null])
          .filter(([m, s]) => !healed.has(s ? s.id : m));
        return { ...w, models: keep.map(x => x[0]), ...(w.seats ? { seats: keep.map(x => x[1]) } : {}) };
      }).filter(w => w.models.length > 0) };
  }

  for (const d of retry.skippedDeadWaves) {
    // A `partial` record is one seat of a wave that DID produce legs, so the
    // plain dead-wave sentence would be false. `seat` rides only on that shape:
    // adding it unconditionally breaks an exact toEqual on a real dead wave.
    ctx.degrade.note({
      channel: d.partial ? 'seat-unbound' : 'dead-wave',
      what: d.partial
        ? `seat ${(d.models || [])[0]} did not review`
        : `Stage-1 wave ${d.waveId} (${d.models.join(', ') || 'no models'}) produced NO legs`,
      why: d.reason,
      effect: 'Those seats are NOT in this council. The run continues with the bench that did '
        + 'launch and will exit degraded (2)',
      data: { waveId: d.waveId, models: d.models, reason: d.reason,
        ...(d.partial ? { seat: (d.models || [])[0] } : {}) },
    });
  }
  for (const leg of retry.skippedDeadLegs) {
    ctx.degrade.note({
      channel: 'dead-leg',
      what: `seat ${leg.modelInput || leg.model} did not review`,
      why: `the leg ended '${leg.status}'${leg.error ? `: ${leg.error}` : ''} with no usable output`,
      effect: `${firstPass.length} of ${legs.length + missingSeats.length} seats reviewed; `
        + 'the run continues with the bench that did and will exit degraded (2)',
      data: { seat: leg.modelInput || leg.model, status: leg.status, reason: leg.error || null },
    });
  }
  for (const rec of retry.stillDeadNotes) { ctx.degrade.note(rec); }
  // Same shape: the retry pass BUILDS its orphan records, the caller EMITS them
  // (that module emits heals only and never notes a degrade, by construction).
  for (const { waveId, leg } of retry.orphanLegs) { ctx.degrade.note(orphanLegNote(waveId, leg)); }

  // Invariant this merge relies on: retry.recoveredLegs only ever names seats
  // that actually lost their seat on the first pass (run-retry.js's recovery
  // loop drops any leg for a seat with no firstFailures entry) — so `legs`
  // and `recoveredLegs` can never both carry a leg for the same seat here.
  // A recovered leg is a RETRY-wave object, absent from Stage-1's object-keyed
  // seatOf, so this union is mandatory rather than tidiness: without it every
  // healed seat re-materializes with seat:null and its role falls back to
  // roleFor's alias shim. Re-writing an already-materialized recovered leg's review file
  // is only an idempotent no-op while the name is the seat's — under the alias
  // it is the twin clobber this PR removes (two healed twins, one file).
  const allSeatOf = new Map([...seatOf, ...retry.seatOf]);
  const materialized = materializeReviews(o.runDir, [...legs, ...retry.recoveredLegs], allSeatOf);
  const stillDeadLegs = [...retry.skippedDeadLegs, ...retry.stillDeadLegs];
  const stillDeadWaves = [...retry.skippedDeadWaves, ...retry.stillDeadWaves];

  const reviews = [];
  // v4.7 D2/E4: every repair launch is a billed leg of its own, distinct from
  // the seat's own review leg (m.leg) it is trying to fix — it gets its own
  // row so its cost is never folded into, or lost from, the review's row.
  const extraRows = [];
  let repairSeq = 0;
  for (const m of materialized) {
    let conformance = 'clean';
    let res = validateFindings(m.text);
    let attempts = 0;
    // ⚠️ LC-6: the text the repair prompt must carry. A repair solo is a FRESH
    // session — it has no memory of the review turn — so shipping only
    // res.errors asked the model to correct something it had never seen. Two
    // paid models refused ("I don't have a previous review to correct") and one
    // fabricated a finding, which reached tally.json and the chair's verdict.
    // Tracked rather than pinned to m.text so `repairing` and `res.errors`
    // always describe the SAME artifact: on attempt 2 the errors came from
    // validating attempt 1's output, so attempt 1's output is what is being
    // repaired. An empty/dead repair leg leaves it on the last real text
    // (there is no newer artifact to name).
    let repairing = m.text;
    // ⚠️ LC-11: the count the repair is contractually forbidden from changing.
    // Captured from the ORIGINAL block, because that is the generation m.text's
    // prose actually narrates. null = absent/unparseable, so unverifiable — see
    // the push below.
    const attemptedCount = countAttemptedFindings(m.text);
    // ⚠️ Review F2 (RESOLVED — deleted v4.5, owner-ruled 2026-07-27): a
    // repairCanHonorContract predicate used to sit here so a review declaring
    // ZERO findings never paid for a repair while EMPTY_FINDINGS rejected empty
    // sets — every outcome of that wave was predetermined. LC-10 (v4.4.1) made a
    // well-formed empty set VALID, which flipped the predicate constant-true by
    // its own design, so it was removed rather than left as a dead guard someone
    // deletes silently later. ⚠️ If you ever make validateFindings reject empty
    // sets again, you are re-arming the F2 deadlock: restore a repairability
    // check here first. tests/council/run-stages.test.js "never pays for a
    // repair" pins the observable behavior.
    while (!res.ok && attempts < 2 && !ctx.overBudget()) {
      attempts += 1;
      repairSeq += 1;
      const waveId = `${o.runId}-p${repairSeq}`;
      runState.appendStageWave(o.runDir, 'stage1', waveId);
      const solo = await ctx.launchers.launchSolo({
        model: m.modelInput,
        prompt: briefings.buildFindingsRepairPrompt({ errors: res.errors, review: repairing }),
        project: o.runDir, waveId, timeout: o.timeout,
        gateway: o.gateway, noValidateModel: o.noValidateModel, noCostGate: o.noCostGate,
        councilRunId: o.runId, councilName: o.councilName,
        tag: o.tag, // v4.7 F8 D16: rides the same forward as councilRunId/councilName.
        fallback: o.fallback, catalog: o.catalog,
      });
      ctx.addWave(solo.wave);
      if (isAbortExit(solo.exitCode)) {
        // SL-2 fix-wave: this used to read the pre-retry `deadWaves` binding —
        // run.js persists this return into stage-1 state before the abort
        // short-circuit, so a heal-then-abort run was recording seats as dead
        // that had actually reviewed on retry. Must be the post-retry set,
        // same as the normal-completion return below.
        // Abort paths add no rows (aborted runs never reach tally) — extraRows
        // is returned only for shape consistency, never read past this point.
        return { aborted: solo.exitCode, reviews, deadLegs: stillDeadLegs, deadWaves: stillDeadWaves,
          degraded: false, extraRows };
      }
      const repaired = (solo.leg && solo.leg.summary) || '';
      if (repaired.trim()) { repairing = repaired; }
      res = validateFindings(repaired);
      // Every -p<N> launch gets a row — INCLUDING a failed repair (null/'error' leg ⇒ never-invent
      // defaults); pushed AFTER re-validation to stamp the repair LEG's own measured outcome (PR 199 D1, v4.9 V18 refined).
      extraRows.push(buildRunStatsEntry({ leg: solo.leg, model: m.modelInput, role: 'repair',
        wasChair: false, conformance: res.ok ? 'clean' : 'unstructured' }));
      if (res.ok) { conformance = 'repaired'; }
    }
    if (!res.ok) { conformance = 'unstructured'; }
    // ⚠️ LC-11. `text` below is ALWAYS the seat's own prose — never the repair's
    // output, which is a bare JSON block by design (briefings.js:19-26
    // deliberately omits the two-part prose framing from repair prompts).
    // Substituting it would hand the judges a narrative-free review and render a
    // JSON dump into bundle-stage2.md as "what the judges saw".
    //
    // Instead the repair's CONTRACT is enforced: "the same findings, fixed — do
    // not add or remove findings". A repair that changed the count produced a
    // findings set this prose does not narrate, so it is refused rather than
    // adjudicated.
    //
    // ⚠️ Review F4 — what this check is and is NOT. It does NOT catch costgate01:
    // that leg emitted no fenced block at all, so attemptedCount is null, the
    // repair is ACCEPTED and merely marked findingsUnverified. LC-12 (handing the
    // repair prompt the artifact) is what addresses that incident. And the check
    // deliberately over-refuses one honest case: a repair that legitimately merges
    // a DUPLICATE_ID pair changes the count too, and is refused with it.
    //
    // ⚠️ Review F1: the refusal RIDES the review (repairRefused) and the runStats
    // row, because 'unstructured' alone is indistinguishable from a seat that never
    // emitted JSON at all — the weaker, unverifiable case would then be the only
    // one on the record.
    let unverified = false;
    let repairRefused = null;
    if (conformance === 'repaired') {
      if (attemptedCount === null) {
        unverified = true;               // nothing to compare; say so, don't imply a check
      } else if (res.findings.length !== attemptedCount) {
        conformance = 'unstructured';
        repairRefused = { code: 'REPAIR_CHANGED_FINDING_COUNT',
          detail: `repair returned ${res.findings.length} findings, original attempted ${attemptedCount}` };
        res = { ok: false, findings: [], errors: [repairRefused] };
      }
    }
    reviews.push({
      model: m.modelInput, modelInput: m.modelInput, seat: m.seat || null,
      // Seat-space role (spec §4.5), read off the SEAT — NOT roleAt(o.seats):
      // run-stage1-launch.js re-derives the table when o.seats is absent, so
      // m.seat is truthy while o.seats is not, and roleAt's unknown-id 'seat'
      // collapses every critic/lens role. Unbound legs keep the roleFor shim.
      role: m.seat ? m.seat.role : roleFor(o, m.modelInput),
      text: m.text, findings: res.ok ? res.findings : [], conformance, leg: m.leg,
      ...(unverified ? { findingsUnverified: true } : {}),
      ...(repairRefused ? { repairRefused } : {}),
    });
  }

  // Superseded + dead-seat rows live in ./run-stage1-rows (v4.8 PR0 size-gate split).
  // ⚠️ allSeatOf, never the Stage-1 `seatOf`: retry.recoveredLegs and
  // retry.stillDeadRetryLegs are retry-wave objects that map has never seen.
  // ⚠️ `retry.twins`, never a fresh `twinAliases(o.seats)`: the row keys asked for here must be
  // minted from the SAME collection the retry pass filled `attemptedSeats` with (v4.8 T-A6).
  pushDeadSeatRows({ o, retry, deadLegs0, stillDeadLegs, stillDeadWaves, extraRows,
    roleFor, seatOf: allSeatOf, degrade: ctx.degrade, twins: retry.twins });

  return { aborted: null, reviews, deadLegs: stillDeadLegs, deadWaves: stillDeadWaves,
    degraded: stillDeadLegs.length > 0 || stillDeadWaves.length > 0, extraRows };
}

// runStage2 lives in ./run-stage2.js (300-line gate) but is re-exported here so
// this module stays the single import surface for the stage loops. The cycle that
// once blocked that is gone: isAbortExit was hoisted into run-launch.js — the
// module that produces the exit codes — so the child no longer imports from its
// parent (v4.4.1 review F5). isAbortExit is still re-exported for run-chair.js
// and run-debate.js, which have always taken it from here.
module.exports = { runStage1, runStage2, isAbortExit, slug, roleFor };
