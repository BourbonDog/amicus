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
 * @param {object} ctx run.js's {o, launchers, addWave, scratchDir}
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
  // §3.4's roster-padding pattern (run-retry.js:117-132): bindSeats filters
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
    byJudge[key] = parsed.byId;
    legs.push({ model: judge, status: outLeg.status, durationMs: outLeg.durationMs, usage: outLeg.usage,
      conformance, summary: outLeg.summary || '', waveId: outLeg.waveId, seat,
      ...(outLeg.model ? { resolvedModel: outLeg.model } : {}) });
  }
  return { byJudge, legs, supersededLegs, repairLegs };
}

module.exports = { legOpts, legRow, runRevoteWave };
