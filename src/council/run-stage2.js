// src/council/run-stage2.js
'use strict';

/**
 * @module council/run-stage2
 * Stage-2 (anonymized cross-review) loop for the headless council engine —
 * shared bundle, judge wave in _scratch, parse + bounded repair. Lifted
 * verbatim out of ./run-stages.js for the 300-line gate (v4.4.1 Task 2),
 * mirroring the briefings.js → briefings-stage2.js split. Stage 1 and the
 * shared helpers (slug, roleFor) stay in ./run-stages.js, which re-exports
 * runStage2 so callers keep one import surface. This module imports NOTHING
 * from its parent: isAbortExit comes from run-launch.js, where the exit codes
 * are produced, which is what dissolved the old cycle (v4.4.1 review F5).
 *
 * Headless adaptation (vs SKILL.md): a judge still malformed after 2 repairs is
 * dropped from rankings and adjudications (ok:false) and recorded conformance
 * 'unstructured' (spec §5).
 */

const fs = require('fs');
const path = require('path');
const stage2 = require('./briefings-stage2');
const { parseJudgeOutput } = require('./parse-stage2');
const { sanitizeName, isAbortExit } = require('./run-launch');
const runState = require('./run-state');
const { buildRunStatsEntry } = require('./run-assemble');
// v4.8 PR3 Task 4: seat binding. artifactName is NOT re-exported from
// run-launch.js (its exports stop at sanitizeName/isAbortExit), so both come
// straight from ./seats — that module requires nothing, zero cycle risk.
const { artifactName, bindSeats } = require('./seats');
const { orphanLegNote } = require('./stage1-bind');

/**
 * Stage 2: shared anonymized bundle → judge wave in _scratch → parse + repair.
 * @param {object} ctx
 * @param {{reviews: Array, labels: {entries, labelMap}, globalFindings: Array,
 *   extraLabeled?: Array<{label: string, text: string}>}} args
 *   `extraLabeled` (v4.1 §4.4) are labeled reviews sourced from a FILE rather than
 *   a leg (the Claude review): they join the judged BUNDLE, never the judge ROSTER.
 * @returns {Promise<{aborted: number|null, judgeResults: Array, extraRows: Array}>}
 *   `extraRows` (v4.7 D2, mirroring runStage1's channel) is one `role:'repair'`
 *   row per `-q<N>` judge-repair solo (error status when the repair itself
 *   failed) — the judge's own judgeResults entry keeps attributing its ORIGINAL
 *   Stage-2 wave leg throughout (the #83 comment below), so a repair never
 *   overwrites the primary judge row; it only adds this separate one.
 */
async function runStage2(ctx, { reviews, labels, globalFindings, extraLabeled = [] }) {
  const { o } = ctx;
  const { rankingToOrder } = require('./anonymize');
  fs.mkdirSync(ctx.scratchDir, { recursive: true, mode: 0o700 });

  // Zip off `reviews` (never off `labels.entries`, which may be one longer than
  // reviews when a file-sourced review is present) and append the extras.
  const labeled = reviews
    .map((r, i) => ({ label: labels.entries[i].label, text: r.text }))
    .concat(extraLabeled);
  const bundle = stage2.buildJudgeBundle({ reviews: labeled, findings: globalFindings, date: o.date });
  fs.writeFileSync(path.join(o.runDir, 'bundle-stage2.md'), bundle, { mode: 0o600 });

  // ROSTER, not bundle: derived ONLY from legs that actually ran, so a file-sourced
  // review is judged but never judges (v4.1 §4.4). Do not widen with extraLabeled.
  const judges = reviews.map(r => r.modelInput);
  const parseCtx = {
    labels: labels.entries.map(e => e.label),
    findingIds: globalFindings.map(f => f.id),
  };
  runState.appendStageWave(o.runDir, 'stage2', `${o.runId}-s2`);
  const { wave, exitCode } = await ctx.launchers.launchWave({
    models: judges, prompt: bundle, project: ctx.scratchDir, waveId: `${o.runId}-s2`,
    timeout: o.timeout, gateway: o.gateway, noValidateModel: o.noValidateModel,
    noCostGate: o.noCostGate,
    councilRunId: o.runId, councilName: o.councilName,
    tag: o.tag, // v4.7 F8 D16: rides the same forward as councilRunId/councilName.
    fallback: o.fallback, catalog: o.catalog,
  });
  ctx.addWave(wave);
  if (isAbortExit(exitCode)) { return { aborted: exitCode, judgeResults: [], extraRows: [] }; }

  // v4.8 PR3 Task 4: bind the -s2 wave's legs to the SAME seats reviews[] holds,
  // in `reviews` order — judges is built from that same array by the same
  // `.map`, and real fanout stamps `${waveId}-${i+1}` off that same index
  // (sidecar/leg-ids.js), so this holds even after an SL-2 heal (recovered legs
  // are appended, run-stages.js:153, so `reviews` order is no longer seat order
  // — both arrays still derive from the same `reviews`).
  // §3.4's padding pattern (run-retry.js:121-127): bindSeats filters falsy
  // roster entries internally, so a `null` hole would slide every later slot,
  // and two `{id:null}` sentinels would collide on its id-keyed dedup.
  // Placeholders are tracked by IDENTITY, never an id-name prefix test — a
  // bench alias literally beginning `__unbound-` must never drop a real bind.
  const s2WaveId = `${o.runId}-s2`;
  const placeholders = new Set();
  const roster = reviews.map((r, i) => {
    if (r.seat) { return r.seat; }
    const p = { id: `__unbound-${s2WaveId}-${i + 1}`, alias: judges[i], role: 'seat', lens: null, position: i + 1 };
    placeholders.add(p);
    return p;
  });
  // review F(critical): `wave` is legitimately null — a budget/args refusal
  // (run-budget.js failPre) returns `{wave: null, exitCode: 1}`, which
  // isAbortExit does NOT catch (only 130/143), so execution reaches here.
  // Guarded exactly like the leg loop below (`(wave && wave.legs) || []`) —
  // this is the only OTHER dereference of wave.legs in the file.
  const s2Legs = (wave && wave.legs) || [];
  const bindRes = bindSeats(s2WaveId, roster, s2Legs);
  const judgeSeatOf = new Map(bindRes.bound
    .filter(b => !placeholders.has(b.seat))
    .map(b => [b.leg, b.seat]));
  // An orphan leg (a judge DID land, but no roster slot claims it) gets the
  // same shape as Stage 1's orphanLegNote — `data.legId` present.
  for (const leg of bindRes.orphanLegs) { ctx.degrade.note(orphanLegNote(s2WaveId, leg)); }
  // review F(important): mirrors stage1-bind.js:40's suppression rule
  // verbatim. A wave that returned ZERO legs is already announced on a louder
  // channel (thin-cross-review, or this refusal itself) — there is no
  // "missing seat" fact this adds. An orphan leg means a judge DID land for
  // SOME seat we could not name — reporting the roster's other unbound seats
  // as "missing" would double-count that one failure as two, on a channel
  // whose whole contract is "nothing was guessed": the stray leg might BE the
  // seat this loop would otherwise call missing.
  if (s2Legs.length > 0 && bindRes.orphanLegs.length === 0) {
    for (const seat of bindRes.unbound) {
      if (placeholders.has(seat)) { continue; }
      ctx.degrade.note({
        channel: 'seat-unbound',
        what: `leg for seat ${seat.alias} in wave ${s2WaveId} never returned`,
        why: `the wave returned fewer judge legs than its roster of ${roster.length}`,
        effect: 'That seat did not judge; nothing was guessed and nothing was dropped',
        data: { waveId: s2WaveId, seat: seat.alias },
      });
    }
  }

  const judgeResults = [];
  // v4.7 D2: every judge-repair launch is a billed leg of its own, distinct from
  // the judge's original Stage-2 wave leg it is trying to fix — it gets its own
  // row so its cost is never folded into, or lost from, the judge's row (mirrors
  // runStage1's -p<N> extraRows, ./run-stages.js:117-120).
  const extraRows = [];
  let repairSeq = 0;
  for (const leg of (wave && wave.legs) || []) {
    const judge = leg.modelInput || leg.model;
    const seat = judgeSeatOf.get(leg) || null;
    if (leg.status === 'complete' && leg.summary) {
      // Mirrors materializeReviews' shipped shape (run-launch.js:207) exactly:
      // seat filename when bound, alias filename (today's behaviour) otherwise.
      const name = seat ? artifactName(seat, 'judge') : `judge-${sanitizeName(judge)}.md`;
      fs.writeFileSync(path.join(o.runDir, name), leg.summary, { mode: 0o600 });
    }
    let conformance = 'clean';
    let parsed = (leg.status === 'complete' && leg.summary)
      ? parseJudgeOutput(leg.summary, parseCtx)
      : { ok: false, errors: [{ code: 'DEAD_LEG', detail: leg.error || leg.status }] };
    let attempts = 0;
    // ⚠️ LC-12: the judging text the repair prompt must carry, tracked exactly like
    // Stage-1's `repairing` so `judging` and `parsed.errors` always describe the SAME
    // generation — on attempt 2 the errors came from validating attempt 1's output.
    // An empty/dead repair leg leaves it on the last real text (there is no newer
    // artifact to name). Stage 2 is the worse place for this omission than Stage 1:
    // a judge that refuses has no `conformance` column, so the tally silently shows
    // fewer votes and a finding's basis counts can flip its tier.
    let judging = leg.summary || '';
    while (!parsed.ok && leg.status === 'complete' && leg.summary && attempts < 2 && !ctx.overBudget()) {
      attempts += 1;
      repairSeq += 1;
      const waveId = `${o.runId}-q${repairSeq}`;
      runState.appendStageWave(o.runDir, 'stage2', waveId);
      const solo = await ctx.launchers.launchSolo({
        model: judge,
        prompt: stage2.buildJudgeRepairPrompt({ errors: parsed.errors, judgement: judging }),
        project: ctx.scratchDir, waveId, timeout: o.timeout,
        gateway: o.gateway, noValidateModel: o.noValidateModel, noCostGate: o.noCostGate,
        councilRunId: o.runId, councilName: o.councilName,
        tag: o.tag, // v4.7 F8 D16: rides the same forward as councilRunId/councilName.
        fallback: o.fallback, catalog: o.catalog,
      });
      ctx.addWave(solo.wave);
      if (isAbortExit(solo.exitCode)) {
        // Abort paths add no rows (aborted runs never reach tally) — extraRows
        // is returned only for shape consistency, never read past this point.
        return { aborted: solo.exitCode, judgeResults, extraRows };
      }
      // Every -q<N> launch gets a row — INCLUDING a repair that failed: the
      // error status rides naturally off solo.leg (null/'error'-status leg ⇒
      // buildRunStatsEntry's own never-invent defaults), no special-casing needed.
      extraRows.push(buildRunStatsEntry({ leg: solo.leg, model: judge, role: 'repair', wasChair: false }));
      const out = (solo.leg && solo.leg.summary) || '';
      if (out.trim()) { judging = out; }
      parsed = parseJudgeOutput(out, parseCtx);
      if (parsed.ok) { conformance = 'repaired'; }
    }
    if (!parsed.ok) {
      judgeResults.push({ judge, seat, ok: false, order: null, adjudications: null,
        conformance: leg.status === 'complete' ? 'unstructured' : 'clean',
        // #83 (v4.6 Plan 2): the judge's ORIGINAL Stage-2 wave leg, mirroring
        // Stage-1's convention (reviews carry the original wave leg even when a
        // repair ran — repairs are separately recorded via appendStageWave).
        // A repair solo's leg is NOT preferred here: attributing it instead
        // would leave every non-repaired (the common case) judge with a false
        // `status: 'error'` row — worse than the missing row #83 complained about.
        leg: leg || null });
      continue;
    }
    const { order } = rankingToOrder(parsed.ranking, labels.labelMap);
    judgeResults.push({ judge, seat, ok: true, order, adjudications: parsed.adjudications, conformance,
      leg: leg || null });
  }
  return { aborted: null, judgeResults, extraRows };
}

module.exports = { runStage2 };
