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
// run-launch.js (its exports stop at sanitizeName/isAbortExit), so it comes
// straight from ./seats — that module requires nothing, zero cycle risk.
const { artifactName } = require('./seats');
const { orphanLegNote, bindPaddedWave } = require('./stage1-bind');
// #257: the judge-death record moved to run-stage2-notes.js for the headroom the
// third judge arm needed; `promoted` has ONE vocabulary, ./promoted (a leaf).
const { judgeDeadNote, promotedJudgeNote } = require('./run-stage2-notes');
const { isPromotedLeg } = require('./promoted');

/**
 * Bind the -s2 wave's legs to the seats `reviews[]` holds and note the two
 * unbindable shapes (orphan legs, unbound seats) on ctx.degrade. Lifted
 * verbatim out of `runStage2` below (v4.9 W2, the SI-16 function-length
 * split); the caller reads back only `judgeSeatOf` — `s2WaveId` rides along
 * in the return for the seam's shape, nothing downstream consumes it.
 * @param {object} ctx
 * @param {{reviews: Array, judges: Array<string>, s2Legs: Array<object>,
 *   runId: string}} args — `s2Legs` arrives pre-guarded
 *   (`(wave && wave.legs) || []`): the wave-null guard stays at the call
 *   site, beside the leg loop that shares it.
 * @returns {{s2WaveId: string, judgeSeatOf: Map<object, object>}}
 */
function bindStage2Seats(ctx, { reviews, judges, s2Legs, runId }) {
  // v4.8 PR3 Task 4: bind the -s2 wave's legs to the SAME seats reviews[] holds,
  // in `reviews` order — judges is built from that same array by the same
  // `.map`, and real fanout stamps `${waveId}-${i+1}` off that same index
  // (sidecar/leg-ids.js), so this holds even after an SL-2 heal (recovered legs
  // are appended, run-stages.js:141, so `reviews` order is no longer seat order
  // — both arrays still derive from the same `reviews`).
  // §3.4's padding pattern now lives in `stage1-bind.js :: bindPaddedWave`
  // (v4.8 SI-27) — why the roster is padded rather than filtered, and why
  // placeholders are tracked by IDENTITY rather than an id-name prefix test,
  // are in that function's docblock. Only this site's TAIL stays here.
  const s2WaveId = `${runId}-s2`;
  const { seatOf: judgeSeatOf, bindRes, placeholders } =
    bindPaddedWave(s2WaveId, reviews.map(r => r.seat), i => judges[i], s2Legs);
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
        // R27-5: `reviews.length` IS the padded roster's length — bindPaddedWave
        // maps 1:1 over the source array, and `Array.prototype.map` preserves
        // length. Pinned (`ROSTERLEN`) in run-stages.test.js, because a
        // substitution into unpinned prose is how a true sentence goes quietly false.
        why: `the wave returned fewer judge legs than its roster of ${reviews.length}`,
        effect: 'That seat did not judge; nothing was guessed and nothing was dropped',
        data: { waveId: s2WaveId, seat: seat.alias },
      });
    }
  }
  return { s2WaveId, judgeSeatOf };
}

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
  // v4.9 W7: one dispatch, both intents (briefings-stage2.js :: judgeBundleFor —
  // 'task' | absent, fail-closed). `briefing` is the EXTRA argument the task
  // bundle needs and the review bundle ignores: task judges rank "which response
  // best does the work the briefing asked for", which is unanswerable without the
  // ask (spec §5.4). It rides `o.briefing` — the same field the Stage-1
  // dispatchers compose from — so the text is never re-read off disk.
  const bundle = stage2.judgeBundleFor(o.intent,
    { reviews: labeled, findings: globalFindings, date: o.date, briefing: o.briefing });
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

  // Seat binding (v4.8 PR3 Task 4) lives in bindStage2Seats above (v4.9 W2).
  // review F(critical): `wave` is legitimately null — a budget/args refusal
  // (run-budget.js failPre) returns `{wave: null, exitCode: 1}`, which
  // isAbortExit does NOT catch (only 130/143), so execution reaches here.
  // Guarded exactly like the leg loop below (`(wave && wave.legs) || []`) —
  // this is the only OTHER dereference of wave.legs in the file.
  const s2Legs = (wave && wave.legs) || [];
  const { judgeSeatOf } = bindStage2Seats(ctx, { reviews, judges, s2Legs, runId: o.runId });

  const judgeResults = [];
  // v4.7 D2: every judge-repair launch is a billed leg of its own, distinct from
  // the judge's original Stage-2 wave leg it is trying to fix — it gets its own
  // row so its cost is never folded into, or lost from, the judge's row (mirrors
  // runStage1's -p<N> extraRows, run-stages.js :: runStage1). ⚠️ Cited by LINE until the v4.9 W9
  // fix round re-opened it: run-stages.js@5830ece3:117-120 was the skipped-wave note's `what`
  // arm, not extraRows at all, and it has since moved to run-retry-notes.js :: skippedWaveNote.
  // Anchored by symbol now, per the anti-rot rule.
  const extraRows = [];
  let repairSeq = 0;
  for (const leg of (wave && wave.legs) || []) {
    const judge = leg.modelInput || leg.model;
    const seat = judgeSeatOf.get(leg) || null;
    if (leg.status === 'complete' && leg.summary) {
      // Mirrors the shape run-launch.js :: materializeReviews ships exactly:
      // seat filename when bound, alias filename (today's behaviour) otherwise.
      const name = seat ? artifactName(seat, 'judge') : `judge-${sanitizeName(judge)}.md`;
      fs.writeFileSync(path.join(o.runDir, name), leg.summary, { mode: 0o600 });
    }
    let conformance = 'clean';
    // #202: ONE predicate for "this judge never answered at all", shared by the
    // DEAD_LEG classification below and by the degrade it now raises. Spelling it
    // twice is how the two would drift into disagreeing about which judges died —
    // and note it is NOT `leg.status !== 'complete'`: a leg that completes with an
    // EMPTY summary produced nothing either, and the DEAD_LEG arm has always
    // treated it that way.
    const legDied = !(leg.status === 'complete' && leg.summary);
    // Council #263 r1 (D3): `legDied` is TRUE for two legs with different fixes —
    // one whose process never came back, one that ran to 'complete' and answered
    // with an EMPTY summary. Split HERE, beside the predicate, so the
    // distinction is never re-derived elsewhere (why `legDied` exists at all).
    const legAnsweredEmpty = legDied && leg.status === 'complete';
    let parsed = legDied
      ? { ok: false, errors: [{ code: 'DEAD_LEG', detail: leg.error || leg.status }] }
      : parseJudgeOutput(leg.summary, parseCtx);
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
        // v4.9 W7 fix round (F1): the SAME intent channel the bundle dispatch
        // above rides. A judge briefed on the task contract must be repaired
        // against the task contract — a repair solo is a fresh session, so the
        // contract embedded here is the only output shape it ever sees.
        prompt: stage2.judgeRepairPromptFor(o.intent,
          { errors: parsed.errors, judgement: judging }),
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
      const out = (solo.leg && !isPromotedLeg(solo.leg) && solo.leg.summary) || ''; // #257 R-X21: a promoted repair supplies no block (named mutant "JUDGEREPAIRPROMOTEDUSED")
      if (out.trim()) { judging = out; }
      parsed = parseJudgeOutput(out, parseCtx);
      // Every -q<N> launch gets a row — INCLUDING a failed repair (null/'error' leg ⇒ never-invent
      // defaults); pushed AFTER the re-parse to stamp the repair LEG's own measured outcome (PR 199 D1, v4.9 V18 refined).
      extraRows.push(buildRunStatsEntry({ leg: solo.leg, model: judge, role: 'repair',
        wasChair: false, conformance: parsed.ok ? 'clean' : 'unstructured' }));
      if (parsed.ok) { conformance = 'repaired'; }
    }
    if (!parsed.ok) {
      // #202: THE MISSING THIRD CASE. A dead judge leg still comes back as a leg
      // object, so bindPaddedWave binds it — it is neither `orphan` nor
      // `unbound`, and stage 2 had no case for it. It fell through into
      // judgeResults with `ok:false` and vanished: MEASURED on CI run
      // 32956900910 (wave 9d8029c8-s2), where glm and qwen judges died at +300s
      // with zero tokens and run.json recorded no degrade at all, while the
      // verdict shipped a four-column adjudication matrix two of them never
      // voted in. The one net that might have caught it, `thin-cross-review`,
      // fires only at `usableJudges < 2`; that run had exactly 2 of 4.
      //
      // ⚠️ Emitted with the default kind ('degrade'), so run-degrade.js's sink
      // sets `degraded.value` and the run exits 2. That is a deliberate
      // behaviour change (owner's call): before it, a half-adjudicated verdict
      // could exit 0, and W11 only exited 2 because of an unrelated
      // cost-accounting degrade. An unparseable-but-ANSWERED judge is a
      // different fact and is deliberately excluded — it already darkens the
      // seat's row via `conformance: 'unstructured'`, and it is repairable.
      if (legDied) { ctx.degrade.note(judgeDeadNote({ judge, seat, leg, judgesCount: judges.length, runId: o.runId })); }
      judgeResults.push({ judge, seat, ok: false, order: null, orderSeats: null, adjudications: null,
        // #251 item 3: the ONE `legDied` predicate above, carried forward rather
        // than re-derived downstream. run.js's thin-cross-review note needs to
        // tell a judge that never answered from one that answered unusably —
        // two different fixes — and this is the only place that fact is known.
        died: legDied,
        emptyAnswer: legAnsweredEmpty,
        // #257 (spec R4): it answered only in its reasoning channel AND did not
        // parse. Carried, not re-derived: the thin-cross-review reason names the
        // reasoning channel rather than the output contract — a different fix.
        fromReasoning: !legDied && isPromotedLeg(leg),
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
    // #257 (spec R4/R11): a parseable adjudication COUNTS — a judge has no retry,
    // and rejecting a paid-for verdict would thin the cross-review for a reason
    // that is not about what the judge decided. Kind 'info'; the exit code holds.
    // `attempts` rides along: TWO paths reach here (R-X13), and the note must not claim the
    // leg's own block parsed when the repair loop above supplied it. Since R-X21 gated that
    // read, the repair arm describes ONE shape — a promoted ORIGINAL rescued by a NON-promoted
    // repair — because a promoted repair can never supply the block.
    if (isPromotedLeg(leg)) { ctx.degrade.note(promotedJudgeNote(judge, seat, leg, attempts)); }
    // v4.8 T3.2: labels.seatMap (anonymize.js :: assignLabels) threads through
    // so orderSeats can disambiguate a twin bench's `order`, which stays
    // alias-only. T3.3 wired it into street-cred.js :: rankPositions, via
    // rankings[] in run-assemble.js :: buildTallyInput; `order` never moved.
    const { order, orderSeats } = rankingToOrder(parsed.ranking, labels.labelMap, labels.seatMap);
    // `died: false` by construction: a dead leg's `parsed` is the DEAD_LEG arm,
    // which never becomes ok. Stamped anyway so every entry has the same shape.
    judgeResults.push({ judge, seat, ok: true, order, orderSeats, adjudications: parsed.adjudications,
      died: false, emptyAnswer: false, fromReasoning: isPromotedLeg(leg), conformance, leg: leg || null });
  }
  return { aborted: null, judgeResults, extraRows };
}

module.exports = { runStage2 };
