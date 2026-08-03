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

function slug(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

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
 *   deadWaves: Array, degraded: boolean}>} `degraded` covers BOTH ways a seat
 *   can go missing: a leg that ran and died (deadLegs) and a whole sub-wave that
 *   died before its legs existed (deadWaves). A pushed review carries
 *   `findingsUnverified: true` (LC-11) when its findings came from a repair whose
 *   contract could not be checked — the original block was absent or unparseable,
 *   so there was no finding count to compare against — and `repairRefused:
 *   {code, detail}` (review F1) when the contract WAS checked and broken, which is
 *   what separates a refused repair from a seat that never emitted JSON.
 */
async function runStage1(ctx) {
  const { o } = ctx;
  const { aborted, legs, deadWaves } = await launchStage1(ctx);
  if (aborted) { return { aborted, reviews: [], deadLegs: [], deadWaves: [], degraded: false }; }

  const firstPass = materializeReviews(o.runDir, legs);
  const alive0 = new Set(firstPass.map(m => m.leg));
  const deadLegs0 = legs.filter(l => !alive0.has(l));

  // SL-2: one retry BEFORE anything is recorded lost — the sink never
  // un-flips, so a degrade for a seat the retry saves must never fire at all.
  const retry = await retryStage1Losses(ctx, { deadWaves, deadLegs: deadLegs0,
    counts: { reviewed: firstPass.length, total: legs.length } });
  if (retry.aborted) {
    return { aborted: retry.aborted, reviews: [], deadLegs: deadLegs0, deadWaves, degraded: false };
  }

  for (const d of retry.skippedDeadWaves) {
    ctx.degrade.note({
      channel: 'dead-wave',
      what: `Stage-1 wave ${d.waveId} (${d.models.join(', ') || 'no models'}) produced NO legs`,
      why: d.reason,
      effect: 'Those seats are NOT in this council. The run continues with the bench that did '
        + 'launch and will exit degraded (2)',
      data: { waveId: d.waveId, models: d.models, reason: d.reason },
    });
  }
  for (const leg of retry.skippedDeadLegs) {
    ctx.degrade.note({
      channel: 'dead-leg',
      what: `seat ${leg.modelInput || leg.model} did not review`,
      why: `the leg ended '${leg.status}'${leg.error ? `: ${leg.error}` : ''} with no usable output`,
      effect: `${firstPass.length} of ${legs.length} seats reviewed; `
        + 'the run continues with the bench that did and will exit degraded (2)',
      data: { seat: leg.modelInput || leg.model, status: leg.status, reason: leg.error || null },
    });
  }
  for (const rec of retry.stillDeadNotes) { ctx.degrade.note(rec); }

  // Invariant this merge relies on: retry.recoveredLegs only ever names seats
  // that actually lost their seat on the first pass (run-retry.js's recovery
  // loop drops any leg for a seat with no firstFailures entry) — so `legs`
  // and `recoveredLegs` can never both carry a leg for the same seat here.
  // materializeReviews re-writing an already-materialized recovered leg's
  // review-*.md a second time is accepted as an idempotent no-op, not a bug.
  const materialized = materializeReviews(o.runDir, [...legs, ...retry.recoveredLegs]);
  const stillDeadLegs = [...retry.skippedDeadLegs, ...retry.stillDeadLegs];
  const stillDeadWaves = [...retry.skippedDeadWaves, ...retry.stillDeadWaves];

  const reviews = [];
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
        fallback: o.fallback, catalog: o.catalog,
      });
      ctx.addWave(solo.wave);
      if (isAbortExit(solo.exitCode)) {
        // SL-2 fix-wave: this used to read the pre-retry `deadWaves` binding —
        // run.js persists this return into stage-1 state before the abort
        // short-circuit, so a heal-then-abort run was recording seats as dead
        // that had actually reviewed on retry. Must be the post-retry set,
        // same as the normal-completion return below.
        return { aborted: solo.exitCode, reviews, deadLegs: stillDeadLegs, deadWaves: stillDeadWaves, degraded: false };
      }
      const repaired = (solo.leg && solo.leg.summary) || '';
      if (repaired.trim()) { repairing = repaired; }
      res = validateFindings(repaired);
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
      model: m.modelInput, modelInput: m.modelInput, role: roleFor(o, m.modelInput),
      text: m.text, findings: res.ok ? res.findings : [], conformance, leg: m.leg,
      ...(unverified ? { findingsUnverified: true } : {}),
      ...(repairRefused ? { repairRefused } : {}),
    });
  }
  return { aborted: null, reviews, deadLegs: stillDeadLegs, deadWaves: stillDeadWaves,
    degraded: stillDeadLegs.length > 0 || stillDeadWaves.length > 0 };
}

// runStage2 lives in ./run-stage2.js (300-line gate) but is re-exported here so
// this module stays the single import surface for the stage loops. The cycle that
// once blocked that is gone: isAbortExit was hoisted into run-launch.js — the
// module that produces the exit codes — so the child no longer imports from its
// parent (v4.4.1 review F5). isAbortExit is still re-exported for run-chair.js
// and run-debate.js, which have always taken it from here.
module.exports = { runStage1, runStage2, isAbortExit, slug, roleFor };
