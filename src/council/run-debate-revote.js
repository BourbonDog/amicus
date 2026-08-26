// src/council/run-debate-revote.js
'use strict';

/**
 * @module council/run-debate-revote
 * v4.8 PR3 Task 1: `legOpts`, `legRow`, and `runRevoteWave` extracted verbatim
 * out of run-debate.js (283/300 — the 300-line-per-file gate) with NO
 * behaviour change. run-debate.js requires all three back; runDebate still
 * calls runRevoteWave for the re-vote mini-wave (spec §5.1).
 *
 * That "verbatim" claim held for all three only through Task 1. `legOpts` and
 * `legRow` are still byte-identical to the extraction. `runRevoteWave` is NOT:
 * PR3 Task 6 gave it real seat-binding behaviour — the padded roster + bind
 * (`stage1-bind.js :: bindPaddedWave` since v4.8 SI-27; an inline `bindSeats`
 * call before it), the seat-keyed `byJudge`, the `sanitizeName`'d per-seat
 * repair id, and the `seat` field on the pushed legs (see the function's own
 * docblock below). Do not treat `runRevoteWave` as a behaviour-neutral mirror
 * of the old run-debate.js code — only `legOpts`/`legRow` still are. Since
 * v4.9 W2 (SI-16) the one-bounded-repair block lives in the in-file
 * `repairRevoteLeg`, called from runRevoteWave's leg loop — a structural
 * split only, no behaviour change.
 *
 * `isAbortExit` comes from ./run-launch, NEVER from ./run-stages: run-stage2.js:12
 * records that taking it from run-launch.js "is what dissolved the old cycle
 * (v4.4.1 review F5)". Requiring ./run-stages from this new leaf would drag in
 * run-retry → run-retry-notes → briefings and re-open that cycle class.
 */

const fs = require('fs');
const path = require('path');
const dbrief = require('./briefings-debate');
const { parseRevote } = require('./parse-stage2');
const runState = require('./run-state');
const { emitStageStarted } = require('../observe/events');
const { isAbortExit } = require('./run-launch');
// v4.8 PR3 Task 6: seat binding. ./seats requires NOTHING, so taking
// sanitizeName straight from it (rather than run-launch's re-export) adds
// zero cycle risk to this leaf — the same call run-stage2.js:30 makes.
const { sanitizeName } = require('./seats');
// v4.8 SI-27: the shared roster-padding core. ./stage1-bind requires only
// ./seats, so this leaf stays cycle-free (see the module docblock's cycle-class
// paragraph above — named, not line-numbered, so it cannot rot).
const { bindPaddedWave } = require('./stage1-bind');
// v4.9 W3 (SI-DUP disposition b): the wave's join key for one leg — the bound
// seat's id, else the bare alias. Was a local `function seatKey` here; now the
// run-retry-keys.js export (same rule, one home). ./run-retry-keys is
// REQUIRE-FREE by design (its own docblock), so this leaf stays cycle-free.
const { seatKey } = require('./run-retry-keys');

/** Common launch options for every debate leg (judge-isolated `_scratch` cwd). */
function legOpts(ctx, waveId) {
  return { project: ctx.scratchDir, waveId, timeout: ctx.o.timeout, gateway: ctx.o.gateway,
    noValidateModel: ctx.o.noValidateModel, noCostGate: ctx.o.noCostGate,
    // v4.3 Task 3 (spec §7.2): attribution ids for every defense/re-vote leg.
    councilRunId: ctx.o.runId, councilName: ctx.o.councilName,
    tag: ctx.o.tag }; // v4.7 F8 D16: rides the same forward as councilRunId/councilName.
}

/**
 * v4.7 D2/E4: normalize a raw (possibly leg-absent) leg into the shape
 * debateRunStatsRows' superseded/repair lists expect. Same never-invent-a-waveId
 * discipline as buildRunStatsEntry (run-assemble.js) — only spread `waveId` when
 * the leg genuinely carries one — but keyed on an explicit `model` (the raiser or
 * judge identity), since a leg-absent attempt has no `.model` of its own to read.
 * Threads resolvedModel (the raw leg's .model, the executable id) emit-only-when-set — v4.7 GOA-7 D8.
 */
function legRow(model, leg, conformance) {
  return leg
    ? { model, status: leg.status, durationMs: typeof leg.durationMs === 'number' ? leg.durationMs : null,
        usage: leg.usage || null, conformance, summary: leg.summary || '',
        ...(leg.waveId ? { waveId: leg.waveId } : {}),
        ...(leg.model ? { resolvedModel: leg.model } : {}) }
    : { model, status: 'error', durationMs: null, usage: null, conformance, summary: '' };
}

/**
 * T5.1 (owner ruling R8), narrowed by T5.5: announce a re-vote leg whose key
 * this wave cannot account for — its key names none of the judges this wave
 * actually launched. ⚠️ This read "it NEITHER bound to any roster slot (a real
 * seat or a §3.4 placeholder) NOR names one of the judges…" until T5.5 deleted
 * the `boundLegs` arm of the guard below. Binding is no longer part of the
 * condition, and must not be re-added: seats.js :: bindSeats binds on
 * `leg.legId || leg.taskId` with NO alias check, so a leg bound that way can
 * still carry a name this wave never asked for — which is exactly the shape
 * that kept inventing a phantom adjudication row. The
 * leg itself is unaffected — it still gets its runStats row, its
 * revote-<name>.md and its conformance — only its parsed votes are
 * withheld, so `revoteByJudge` never carries this key at all and
 * applyDebate never has to decide whether it belongs to an existing row or
 * is new (that fail-open push in debate.js :: applyDebate is untouched for a
 * key this wave DOES account for).
 *
 * Field shape follows stage1-bind.js:53 :: orphanLegNote's
 * channel/what/why/effect/data — with ONE deliberate divergence: `data`
 * carries no `seat` field. orphanLegNote's `data.seat` (confusingly named —
 * it holds the ALIAS, not a seat object) is exactly what
 * seat-space.js :: orphanExonerations reads to attribute a note to an
 * alias. This note's `waveId` is always `<runId>-rv`, never `<runId>-s2`, so
 * if it carried that field too it would enter that function's alias map and
 * CLEAR — not extend — that alias's already-proven Stage-2 exonerations,
 * via the non-`-s2` branch of the intersection there: a re-vote-stage
 * anomaly wrongly invalidating a Stage-2 review-authorship proof. Do not add
 * `seat` here to "complete" the parity with orphanLegNote; it is withheld
 * on purpose.
 */
function reVoteUnboundNote(waveId, judge, key, leg) {
  const legId = (leg && (leg.legId || leg.taskId)) || 'unidentified';
  // `|| 'unknown'` mirrors stage1-bind.js:55's alias fallback, and for the same reason: the
  // caller derives `judge` as `leg.modelInput || leg.model`, so a leg carrying NEITHER makes the
  // record read "… 'undefined'" — a bug in the announcer rather than a fact about the leg.
  // ⚠️ BOTH need it. `key` is `seatKey(seat, judge)`, which RETURNS that same `judge` whenever the
  // leg bound to no real seat — i.e. in every refusal reachable through runDebate — so an undefined
  // `judge` takes `key` with it. T5.5 interpolated `key` raw for one commit and measurably rendered
  // "its join key 'undefined'" AND dropped `data.key` from the JSON. Pinned by
  // run-debate.test.js's "NEITHER modelInput NOR model" test; named mutant KEYRAW.
  const alias = judge || 'unknown';
  const joinKey = key || 'unknown';
  return {
    channel: 'seat-unbound',
    // ⚠️ All three strings below now say the ONE thing the guard tests: the key names no judge
    // this wave launched. Binding is irrelevant — this function's docblock says why.
    // ⚠️ `what` said "matches no seat on that wave's roster" for three rounds AFTER that stopped
    // being the condition: a leg taskId-bound to a §3.4 placeholder DOES match a roster slot and is
    // exactly the leg now refused, so `what` contradicted the `why` three lines under it. A paid
    // council caught it (round 2). ⚠️ stage1-bind.js :: orphanLegNote KEEPS that wording and MUST:
    // a Stage-1 orphan really does match no roster slot. Same sentence, true there, false here.
    // ⚠️ `effect` said "the JUDGE's provisional verdict stands" until round 2 — the very
    // presumption a refusal denies, since a refused key names no judge of this wave.
    // ⚠️ `why` carried "(judge alias '${alias}')" for one commit; dropped, measured — `key ===
    // judge` in every refusal runDebate can produce, so it printed the same string twice
    // (BACKLOG.md holds the measurement). `data` keeps orphanLegNote's field names, `judge`
    // included: it is the leg's own CLAIM, and renaming a machine-readable field is a compat break.
    what: `re-vote leg ${legId} in wave ${waveId} could not be attributed to a judge on that wave`,
    why: `its join key '${joinKey}' names none of the judges this wave launched`,
    effect: 'the re-vote was NOT applied; the provisional verdict stands',
    data: { waveId, legId, judge: alias, key: joinKey },
  };
}

/**
 * v4.9 W2 (SI-16): the one bounded repair for an ALIVE-but-unparseable re-vote
 * leg (spec §5.7 — only ONE repair is spent), split out of runRevoteWave's leg
 * loop. The CALLER owns the `alive && !parsed.ok` gate; this function always
 * launches exactly one repair solo. It returns the post-repair view the caller
 * records from there on — `parsed`, `conformance`, `outLeg` (the repaired leg
 * when the repair completed, else the original) — plus exactly one non-null
 * row: `supersededRow` (completed repair — the pre-repair leg's row) or
 * `repairRow` (dead repair — the failed attempt's own row), for the caller to
 * push. A user abort mid-repair returns `{ aborted: <exitCode> }` alone, which
 * the caller propagates as its own return.
 */
async function repairRevoteLeg(ctx, { waveId, key, judge, leg, parsed, expectedIds }) {
  // One repair, solo, to that judge. The id is built from the SEAT key so
  // two twins never share one repair id (and one never overwrites the
  // other's run-state entry). ⚠️ The trailing `r` is load-bearing: it is what
  // stops bindSeats' `/^(.*)-(\d+)$/` matching a repair id whose judge alias
  // is a bare number (`r1-rv-2r` does not match; `r1-rv-2` would). Dropping
  // it re-arms a collision. sanitizeName also fixes the pre-existing slash
  // bug (D4) — `r1-rv-openrouter/deepseek/deepseek-chatr` stops nesting
  // three directory levels — and is a no-op for every plain alias.
  const repairId = `${waveId}-${sanitizeName(key)}r`;
  runState.appendStageWave(ctx.o.runDir, 'debate-revote', repairId);
  const r2 = await ctx.launchers.launchSolo({ ...legOpts(ctx, repairId), model: judge,
    // ⚠️ LC-12: ditto — the re-vote output being repaired rides with its errors.
    prompt: dbrief.buildRevoteRepairPrompt({ errors: parsed.errors, revote: leg.summary }) });
  ctx.addWave(r2.wave);
  if (isAbortExit(r2.exitCode)) { return { aborted: r2.exitCode }; }
  const leg2 = r2.leg && r2.leg.status === 'complete' ? r2.leg : null;
  parsed = leg2 ? parseRevote(leg2.summary, expectedIds) : parsed;
  const conformance = parsed.ok ? 'repaired' : 'unstructured';
  // Symmetric with runDefenseSolo's `if (leg2) { leg = leg2; }` — otherwise
  // revote-<model>.md and the runStats row keep the PRE-repair output.
  return leg2
    ? { aborted: null, parsed, conformance, outLeg: leg2,
        supersededRow: legRow(judge, leg, 'unstructured'), repairRow: null }
    : { aborted: null, parsed, conformance, outLeg: leg,
        supersededRow: null, repairRow: legRow(judge, r2.leg, 'unstructured') };
}

/**
 * The re-vote mini-wave (spec §5.1).
 *
 * v4.8 PR3 Task 6 — the parallel-array discipline this function now runs on:
 * `judgeKeys` are SEAT ids (disputingJudges' output) and `judgeSeats` the
 * matching seat objects, both in launch order; `aliasOf` projects a key back to
 * the routable bench alias. On every iteration of the leg loop the seat key and
 * the alias are **two different values**: the key is what `byJudge` is keyed on
 * (so `applyDebate` can join it against `(a.seat || a.judge)`), while the alias
 * is what every launcher argument and every runStats `model` carries. That is
 * not an inconsistency — a seat id is not a routable model name.
 *
 * @param {object} ctx run.js's {o, launchers, addWave, overBudget, degrade, scratchDir}
 * @param {Array<string>} judgeKeys seat ids, in launch order
 * @param {Array<object>} bundleFindings defended/amended findings
 * @param {Array<?object>} judgeSeats seat objects positionally bound to judgeKeys
 * @param {function(string): string} aliasOf seat id → bench alias
 */
async function runRevoteWave(ctx, judgeKeys, bundleFindings, judgeSeats, aliasOf) {
  const bundle = dbrief.buildRevoteBundle({ findings: bundleFindings, date: ctx.o.date, intent: ctx.o.intent });
  // spec §5.1 names `revote-bundle.md` a run-dir artifact: the shared re-vote prompt goes to
  // disk exactly like Stage 2's bundle-stage2.md, so the round's model-facing input is
  // auditable alongside briefing-stage1.md and chair-packet.md.
  fs.writeFileSync(path.join(ctx.o.runDir, 'revote-bundle.md'), bundle, { mode: 0o600 });
  const waveId = `${ctx.o.runId}-rv`;
  const expectedIds = bundleFindings.map(f => f.id);
  // run-debate — not run.js — owns this stage's `running` checkpoint AND its abort-cascade
  // id: only this function knows whether the wave actually launched (it is skipped when
  // nothing was defended/amended, or the cost ceiling hit).
  runState.updateStage(ctx.o.runDir, 'debate-revote',
    { status: 'running', startedAt: new Date().toISOString(), project: ctx.scratchDir, waveId });
  emitStageStarted(ctx.o.runDir, ctx.o.runId, 'debate-revote', waveId, ctx.o.follow);
  runState.appendStageWave(ctx.o.runDir, 'debate-revote', waveId);
  // ⚠️ The launcher takes ALIASES. A seat id here is a non-routable model name
  // on a real paid wave, not a test failure.
  const res = await ctx.launchers.launchWave({
    ...legOpts(ctx, waveId), models: judgeKeys.map(aliasOf), prompt: bundle });
  ctx.addWave(res.wave);
  if (isAbortExit(res.exitCode)) { return { aborted: res.exitCode }; }
  const byJudge = {}, legs = [];
  // v4.7 D2/E4: mirrors runDefenseSolo's supersededLeg/repairLeg — one list each,
  // accumulated across every judge in this wave (most judges contribute neither).
  const supersededLegs = [], repairLegs = [];
  const rawLegs = (res.wave && res.wave.legs) || [];
  // §3.4's roster-padding pattern now lives in `stage1-bind.js ::
  // bindPaddedWave` (v4.8 SI-27) — why the roster is padded rather than
  // filtered, and why placeholders are tracked by IDENTITY rather than an
  // id-name prefix test, are in that function's docblock. This site has NO
  // tail: no orphan push, no degrade note, so it destructures `seatOf` alone.
  const { seatOf } = bindPaddedWave(waveId, judgeSeats || [], i => aliasOf(judgeKeys[i]), rawLegs);
  for (const leg of rawLegs) {
    // The council ALIAS, not the resolved executable id — runStats rows join
    // meta.models by exact string (run-assemble.js's buildRunStatsEntry).
    const judge = leg.modelInput || leg.model;
    const seat = seatOf.get(leg) || null;
    const key = seatKey(seat, judge);
    const alive = leg.status === 'complete' && leg.summary;
    let outLeg = leg;               // the leg actually recorded (post-repair when there is one)
    let parsed = alive ? parseRevote(leg.summary, expectedIds)
      : { ok: false, byId: {}, errors: [{ code: 'DEAD_LEG', detail: 'no summary' }] };
    let conformance = alive ? 'clean' : 'unstructured';
    if (alive && !parsed.ok) {
      const rep = await repairRevoteLeg(ctx, { waveId, key, judge, leg, parsed, expectedIds });
      if (rep.aborted) { return { aborted: rep.aborted }; }
      ({ parsed, conformance, outLeg } = rep);
      if (rep.supersededRow) { supersededLegs.push(rep.supersededRow); }
      if (rep.repairRow) { repairLegs.push(rep.repairRow); }
    }
    // ⚠️ Two DIFFERENT values on the same iteration: `byJudge`'s key is the SEAT
    // (applyDebate joins it against `(a.seat || a.judge)`), while the leg's
    // `model` is the ALIAS — this literal becomes a debateRunStatsRows row, and
    // R3-1 promises every runStats `model` is alias-valued on every bench.
    // `seat` rides along for materializeDebate's filename only; debateRunStatsRows'
    // `mk` copies an explicit field list and never picks it up.
    //
    // T5.1 (owner ruling R8), narrowed by T5.5: publish IFF the key names one of
    // the judges THIS WAVE actually launched. `judgeSeats` is positionally bound
    // to `judgeKeys` (this function's own docblock) and run-debate.js builds it
    // from an id-keyed table — `judgeKeys.map(k => seatById.get(k) || null)` — so
    // every REAL seat id that can reach `key` here is already a `judgeKeys`
    // entry. Two further shapes are deliberately admitted: a
    // unique-alias bench, where `seatKey(null, 'qwen') === 'qwen'` IS that seat's
    // own judgeKey; and a §3.4 roster hole (a Stage-2-orphaned judge, padded with
    // a placeholder here) whose -rv leg is ALSO unbindable — its bare-alias key is
    // still in `judgeKeys`, and the provisional row for that same orphaned judge
    // is ALSO keyed on the bare alias, so refusing it would discard a re-vote the
    // join already lands correctly (measured: 2 adjudications in, 2 out, the
    // seat-less row's verdict replaced, no phantom row). NOT `seat === null`
    // (§0.5) — a real-seat bind is unaffected either way, but that predicate
    // wrongly refuses both shapes just described. Only a leg whose key names no
    // judge this wave launched is the unnameable case R8 asks to refuse.
    //
    // ⚠️ T5.5 DELETED a second arm, `boundLegs.has(leg) ||`. Binding is not
    // enough: seats.js :: bindSeats matches `leg.legId || leg.taskId` to a roster
    // SLOT with NO alias check, so a leg stamped into a §3.4 placeholder's slot
    // while carrying a foreign alias BOUND (arm 1 true) and still keyed on that
    // foreign alias (arm 2 false) — the key was published, no note was emitted,
    // and applyDebate's fail-open push invented a phantom adjudication row while
    // the hole's own seat-less row kept its stale dispute. That is the SI-10 shape
    // this guard exists to close, surviving through that arm. Measured across the
    // deletion in run-debate.test.js's T5.5 block: 3 A1 rows out of 2 in and zero
    // notes before, 2 out and one `seat-unbound` note after. Do not re-add the arm
    // as "defensive redundancy" — named mutant BOUNDREADD in that block is exactly
    // that re-addition, and it reds.
    if (judgeKeys.includes(key)) {
      byJudge[key] = parsed.byId;
    } else {
      ctx.degrade.note(reVoteUnboundNote(waveId, judge, key, leg));
    }
    legs.push({ model: judge, status: outLeg.status, durationMs: outLeg.durationMs, usage: outLeg.usage,
      conformance, summary: outLeg.summary || '', waveId: outLeg.waveId, seat,
      ...(outLeg.model ? { resolvedModel: outLeg.model } : {}) });
  }
  return { byJudge, legs, supersededLegs, repairLegs };
}

module.exports = { legOpts, legRow, runRevoteWave };
