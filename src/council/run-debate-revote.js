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
 * PR3 Task 6 gave it real seat-binding behaviour — the padded roster +
 * `bindSeats` call, the seat-keyed `byJudge`, the `sanitizeName`'d per-seat
 * repair id, and the `seat` field on the pushed legs (see the function's own
 * docblock below). Do not treat `runRevoteWave` as a behaviour-neutral mirror
 * of the old run-debate.js code — only `legOpts`/`legRow` still are.
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
// v4.8 PR3 Task 6: seat binding. ./seats requires NOTHING, so taking bindSeats
// and sanitizeName straight from it (rather than run-launch's re-export) adds
// zero cycle risk to this leaf — the same call run-stage2.js:30 makes.
const { bindSeats, sanitizeName } = require('./seats');

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

/** The wave's join key for one leg: the bound seat's id, else the bare alias. */
function seatKey(seat, alias) { return seat ? seat.id : alias; }

/**
 * T5.1 (owner ruling R8): announce a re-vote leg whose key this wave cannot
 * account for — it neither bound to any roster slot (a real seat or a §3.4
 * placeholder) nor names one of the judges this wave actually launched. The
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
  return {
    channel: 'seat-unbound',
    what: `re-vote leg ${legId} in wave ${waveId} matches no seat on that wave's roster`,
    why: `it bound to no roster slot, and its judge alias '${judge}' names no seat there either`,
    effect: "the re-vote was NOT applied; the judge's provisional verdict stands",
    data: { waveId, legId, judge, key },
  };
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
  const bundle = dbrief.buildRevoteBundle({ findings: bundleFindings, date: ctx.o.date });
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
  // §3.4's roster-padding pattern (run-retry-launch.js :: bindRetryWave): bindSeats filters
  // falsy roster entries internally, so a `null` hole would slide every later
  // slot, and two `{id:null}` sentinels would collide on its id-keyed dedup.
  // Placeholders are tracked by IDENTITY, never an id-name prefix test — a bench
  // alias literally beginning `__unbound-` must never drop a real bind.
  const placeholders = new Set();
  const roster = (judgeSeats || []).map((s, i) => {
    if (s) { return s; }
    const p = { id: `__unbound-${waveId}-${i + 1}`, alias: aliasOf(judgeKeys[i]),
      role: 'seat', lens: null, position: i + 1 };
    placeholders.add(p);
    return p;
  });
  const bindRes = bindSeats(waveId, roster, rawLegs);
  const seatOf = new Map(bindRes.bound
    .filter(b => !placeholders.has(b.seat))
    .map(b => [b.leg, b.seat]));
  // Every leg bindSeats placed on SOME roster slot — a real seat OR a §3.4
  // placeholder — belongs here too: a placeholder-holed judge bound cleanly,
  // it simply has no real seat to bind TO. When that hole traces back to a
  // Stage-2 orphan leg, it was already announced there (run-stage2.js:110
  // calls stage1-bind.js's orphanLegNote — that module only DEFINES the
  // note, it does not itself announce); a seat-less provisional row arriving
  // any other way (a resumed or hand-built tallyInput) produces the same
  // roster hole here with no note at all. Either way it is not this
  // function's hole to raise. A leg absent from this set failed for any of
  // seats.js :: bindSeats' own reasons, not only "no id/alias match": a
  // foreign waveId is filtered out (`mine`'s `!l.waveId || l.waveId ===
  // waveId`) before any matching is even attempted — such a leg reaches
  // neither `bound` nor `orphanLegs`, it is simply invisible to bindSeats —
  // while a leg that DID match a slot another leg already claimed lands in
  // bindRes.orphanLegs too, on a collision, not a miss.
  const boundLegs = new Set(bindRes.bound.map(b => b.leg));
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
      conformance = parsed.ok ? 'repaired' : 'unstructured';
      // Symmetric with runDefenseSolo's `if (leg2) { leg = leg2; }` — otherwise
      // revote-<model>.md and the runStats row keep the PRE-repair output.
      if (leg2) { supersededLegs.push(legRow(judge, leg, 'unstructured')); outLeg = leg2; }
      else { repairLegs.push(legRow(judge, r2.leg, 'unstructured')); }
    }
    // ⚠️ Two DIFFERENT values on the same iteration: `byJudge`'s key is the SEAT
    // (applyDebate joins it against `(a.seat || a.judge)`), while the leg's
    // `model` is the ALIAS — this literal becomes a debateRunStatsRows row, and
    // R3-1 promises every runStats `model` is alias-valued on every bench.
    // `seat` rides along for materializeDebate's filename only; debateRunStatsRows'
    // `mk` copies an explicit field list and never picks it up.
    //
    // T5.1 (owner ruling R8): publish IFF the leg bound to some roster slot
    // (a real seat, or a §3.4 placeholder — `boundLegs`), OR the key names
    // one of the judges THIS WAVE actually launched (`judgeKeys` — `judgeSeats`
    // is positionally bound to it, per this function's own docblock, so every
    // REAL seat id here is already a `judgeKeys` entry too). The second arm
    // covers two shapes: a unique-alias bench, where `seatKey(null, 'qwen')
    // === 'qwen'` IS that seat's own judgeKey; and a roster hole (a
    // Stage-2-orphaned judge, padded with a placeholder here) whose -rv leg
    // is ALSO unbindable — its bare-alias key is still in `judgeKeys`, and
    // BASE already joins it correctly (the provisional row for that same
    // orphaned judge is ALSO keyed on the bare alias), so refusing it would
    // be a regression, not a fix — measured: BASE takes 2 adjudications in
    // to 2 out, the seat-less row's verdict correctly replaced, no phantom
    // row. NOT `seat === null` (§0.5) — a real-seat bind is unaffected
    // either way, but that predicate wrongly refuses both cases just
    // described. Only a leg bound to nothing at all, whose key ALSO names no
    // judge this wave launched, is the unnameable case R8 asks to refuse.
    if (boundLegs.has(leg) || judgeKeys.includes(key)) {
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
