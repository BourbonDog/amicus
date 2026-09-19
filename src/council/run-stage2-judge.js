/**
 * @module council/run-stage2-judge
 * ONE judge leg, adjudicated: the body of `run-stage2.js :: runStage2`'s leg
 * loop, moved here VERBATIM under #257 R-X37 because that file stood at 298 of
 * the 300-line gate and the next edit had nowhere to go (BACKLOG:9161, council
 * round 2 M6). The comment blocks came with it — they are this code's history,
 * not the shell's. `runStage2` keeps `bindStage2Seats`, the bundle build, the
 * wave launch and the loop SHELL, and re-exports nothing of this module.
 *
 * TWO behaviours were then added here, and only here (round 3):
 *   · C4 — the stand-down cause is ONE explicit state, `standDown`, set where
 *     the cause is known, instead of the old `{ attempts, relaunch }` pair the
 *     note had to re-derive it from.
 *   · R-X36 (B1) — a NON-promoted judge whose ordinary `-q<N>` repair comes
 *     back promoted, and which then ends unusable, is announced on the existing
 *     `judge-reasoning-only` channel instead of ending silently.
 *
 * ⚠️ The JSDoc leads this file, ahead of `'use strict'` and with no `// <path>`
 * line above it, matching `promoted.js:1-10`: `scripts/generate-docs.js` reads
 * only a block comment that starts at byte zero, so a path comment there would
 * leave this module's `docs/architecture-map.md` row blank.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const stage2 = require('./briefings-stage2');
const { parseJudgeOutput } = require('./parse-stage2');
// Lifted from `runStage2`'s own lazy `require('./anonymize')` (run-stage2.js@7de27d45:110),
// which served this body alone. ./anonymize is a LEAF — it requires nothing —
// so it rides at the top here rather than inside the function.
const { rankingToOrder } = require('./anonymize');
const { sanitizeName, isAbortExit } = require('./run-launch');
const runState = require('./run-state');
const { buildRunStatsEntry } = require('./run-assemble');
// v4.8 PR3 Task 4: seat binding. artifactName is NOT re-exported from
// run-launch.js (its exports stop at sanitizeName/isAbortExit), so it comes
// straight from ./seats — that module requires nothing, zero cycle risk.
const { artifactName } = require('./seats');
// #257: the judge-death record moved to run-stage2-notes.js for the headroom the
// third judge arm needed; `promoted` has ONE vocabulary, ./promoted (a leaf).
const { judgeDeadNote, promotedJudgeNote } = require('./run-stage2-notes');
const { isPromotedLeg } = require('./promoted');

/**
 * Adjudicate ONE judge leg: artifact, parse, bounded repair/relaunch, note, and
 * the `judgeResults` entry. Writes into `env` (the arrays and the `-q<N>`
 * counter) exactly as the inline loop wrote into `runStage2`'s scope.
 * @param {object} ctx the run context (launchers, degrade, scratchDir, overBudget)
 * @param {object} o the run options (`runDir`, `runId`, `intent`, timeouts, gateway…)
 * @param {object} leg one leg of the `-s2` wave
 * @param {{bundle: string, judges: Array<string>, labels: object, parseCtx: object,
 *   judgeSeatOf: Map<object, object>, judgeResults: Array, extraRows: Array,
 *   repairSeq: number}} env everything the body used to read from `runStage2`'s
 *   scope. `repairSeq` is MUTATED here: the `-q<N>` ids are sequential across
 *   the whole wave, not per judge, exactly as they were inline.
 * @returns {Promise<{aborted: number, judgeResults: Array, extraRows: Array}|null>}
 *   the caller's abort return, ready to be returned as-is, or null to continue.
 */
async function adjudicateJudgeLeg(ctx, o, leg, env) {
  const { bundle, judges, labels, parseCtx, judgeSeatOf, judgeResults, extraRows } = env;
  const judge = leg.modelInput || leg.model;
  const seat = judgeSeatOf.get(leg) || null;
  // Mirrors the shape run-launch.js :: materializeReviews ships exactly:
  // seat filename when bound, alias filename (today's behaviour) otherwise.
  const name = seat ? artifactName(seat, 'judge') : `judge-${sanitizeName(judge)}.md`;
  // #257 R-X32: a promoted leg's deliberation is not an artifact — its relaunch's real text is (below; named mutants "JUDGEARTIFACTPROMOTED", "RELAUNCHARTIFACTDROPPED").
  if (leg.status === 'complete' && leg.summary && !isPromotedLeg(leg)) { fs.writeFileSync(path.join(o.runDir, name), leg.summary, { mode: 0o600 }); }
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
    : isPromotedLeg(leg) ? { ok: false, errors: [{ code: 'REASONING_ONLY', detail: 'answered only in its reasoning channel' }] } // #257 R-X32: never parsed, relaunched (named mutant "JUDGEOWNBLOCKUSED")
      : parseJudgeOutput(leg.summary, parseCtx);
  let attempts = 0;
  // ⚠️ LC-12: the judging text the repair prompt must carry, tracked exactly like
  // Stage-1's `repairing` so `judging` and `parsed.errors` always describe the SAME
  // generation — on attempt 2 the errors came from validating attempt 1's output.
  // An empty/dead repair leg leaves it on the last real text (there is no newer
  // artifact to name). Stage 2 is the worse place for this omission than Stage 1:
  // a judge that refuses has no `conformance` column, so the tally silently shows
  // fewer votes and a finding's basis counts can flip its tier.
  // #257 R-X32: a promoted summary is deliberation — it never becomes `judging` and never rides a repair prompt (named mutant "JUDGEREPAIRCARRIESREASONING").
  let judging = isPromotedLeg(leg) ? '' : (leg.summary || '');
  // #257 C4 (council round 3): ONE explicit state for "the loop ended without a
  // usable adjudication, and THIS is why" — replacing the old encoding, which
  // spread the same fact over a `relaunch` enum, `attempts`, and a three-conjunct
  // `while` guard that `promotedJudgeNote` then had to guess the cause back out
  // of. It is set at each point the cause becomes KNOWN and read in exactly two
  // places: the loop condition below, and the note. Its six values and their
  // sentences are documented on `run-stage2-notes.js :: promotedJudgeNote`.
  let standDown = null;
  // #257 R-X36: the attempt number of a `-q<N>` repair that came back promoted,
  // remembered rather than acted on — a LATER attempt may still rescue the judge
  // (attempt 2 carries the ORIGINAL's real text), and then it is merely a failed
  // repair whose row already says `promoted: true`. Only an unusable ending turns
  // it into a stand-down. The FIRST such attempt is the one named: it is the one
  // whose block the reader would otherwise wonder about.
  let repairPromoted = null;
  while (!parsed.ok && leg.status === 'complete' && leg.summary && attempts < 2 && !ctx.overBudget() && !standDown) { // #257 R-X32/C4: a relaunch that produced no real text stands the judge down (named mutant "STANDDOWNDROPPED")
    attempts += 1;
    env.repairSeq += 1;
    const waveId = `${o.runId}-q${env.repairSeq}`;
    runState.appendStageWave(o.runDir, 'stage2', waveId);
    const solo = await ctx.launchers.launchSolo({
      model: judge,
      // v4.9 W7 fix round (F1): the SAME intent channel the bundle dispatch
      // above rides. A judge briefed on the task contract must be repaired
      // against the task contract — a repair solo is a fresh session, so the
      // contract embedded here is the only output shape it ever sees.
      // #257 R-X32: attempt 1 of a promoted judge is a RELAUNCH with the original bundle (named mutant "RELAUNCHISREPAIR");
      // attempt 2, if any, is the LC-12 repair of the relaunch's real text — the verbatim arm.
      prompt: isPromotedLeg(leg) && attempts === 1 ? bundle
        : stage2.judgeRepairPromptFor(o.intent, { errors: parsed.errors, judgement: judging }),
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
    if (isPromotedLeg(leg) && attempts === 1) { // #257 R-X32: the relaunch's outcome IS the stand-down cause when it produced nothing real; its real text becomes the judge artifact
      if (out.trim()) { fs.writeFileSync(path.join(o.runDir, name), out, { mode: 0o600 }); }
      else { standDown = isPromotedLeg(solo.leg) ? 'relaunch-promoted' : 'relaunch-died'; }
    }
    // #257 R-X36: an ORDINARY repair — of a judge whose own answer was real —
    // came back promoted. Not a stand-down yet; see the declaration above.
    // Both conjuncts are the DISCRIMINATOR, and each is pinned (round-3 review I1):
    // named mutant "REPAIRGUARDDROPPED" drops `isPromotedLeg(solo.leg) &&` — every
    // ordinary judge whose two ordinary repairs fail would then be announced as
    // having answered in a reasoning channel no leg of that run ever used;
    // named mutant "FIRSTPROMOTEDREPAIRLOST" drops `&& repairPromoted === null`,
    // naming the LAST promoted repair instead of the first.
    if (!isPromotedLeg(leg) && isPromotedLeg(solo.leg) && repairPromoted === null) { repairPromoted = attempts; }
    parsed = parseJudgeOutput(out, parseCtx);
    // Every -q<N> launch gets a row — INCLUDING a failed repair (null/'error' leg ⇒ never-invent
    // defaults); pushed AFTER the re-parse to stamp the repair LEG's own measured outcome (PR 199 D1, v4.9 V18 refined).
    extraRows.push(buildRunStatsEntry({ leg: solo.leg, model: judge, role: 'repair',
      wasChair: false, conformance: parsed.ok ? 'clean' : 'unstructured' }));
    if (parsed.ok) { conformance = 'repaired'; }
  }
  if (!parsed.ok) {
    // #257 C4: the loop is over and nothing usable came of it. Any cause the
    // loop itself observed is already set; what is left are the endings only the
    // attempt count separates — and, for a judge whose OWN answer was real, a
    // repair that came back promoted (R-X36). A dead leg never entered the loop
    // and has its own louder channel below, so it is excluded rather than
    // labelled 'not-relaunched' with nothing to say it.
    if (!legDied && !standDown) {
      standDown = isPromotedLeg(leg)
        ? (attempts === 0 ? 'not-relaunched'
          : attempts === 2 ? 'relaunch-unparseable' : 'relaunch-unrepaired')
        : (repairPromoted === null ? null : 'repair-promoted');
    }
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
    // #257 R-X32: a stood-down promoted judge is announced too (named mutant "STANDDOWNSILENT") — the rescued arm is below.
    // #257 R-X36: …and so is a judge whose own answer was real but whose repair answered in ITS reasoning channel (named mutant "REPAIRPROMOTEDSILENT").
    if (legDied) { ctx.degrade.note(judgeDeadNote({ judge, seat, leg, judgesCount: judges.length, runId: o.runId })); } else if (isPromotedLeg(leg)) { ctx.degrade.note(promotedJudgeNote(judge, seat, leg, { attempts, rescued: false, standDown })); } else if (standDown === 'repair-promoted') { ctx.degrade.note(promotedJudgeNote(judge, seat, leg, { attempts, rescued: false, standDown, repairPromotedAttempt: repairPromoted })); }
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
    return null;
  }
  // #257 R-X32: a promoted judge reaches here only through its relaunch (attempt 1) or the relaunch's one repair (attempt 2) — never through its own block. Kind 'info'; the exit code holds.
  if (isPromotedLeg(leg)) { ctx.degrade.note(promotedJudgeNote(judge, seat, leg, { attempts, rescued: true })); }
  // v4.8 T3.2: labels.seatMap (anonymize.js :: assignLabels) threads through
  // so orderSeats can disambiguate a twin bench's `order`, which stays
  // alias-only. T3.3 wired it into street-cred.js :: rankPositions, via
  // rankings[] in run-assemble.js :: buildTallyInput; `order` never moved.
  const { order, orderSeats } = rankingToOrder(parsed.ranking, labels.labelMap, labels.seatMap);
  // `died: false` by construction: a dead leg's `parsed` is the DEAD_LEG arm,
  // which never becomes ok. Stamped anyway so every entry has the same shape.
  judgeResults.push({ judge, seat, ok: true, order, orderSeats, adjudications: parsed.adjudications,
    died: false, emptyAnswer: false, fromReasoning: isPromotedLeg(leg), conformance, leg: leg || null });
  return null;
}

module.exports = { adjudicateJudgeLeg };
