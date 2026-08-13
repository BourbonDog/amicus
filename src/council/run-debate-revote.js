// src/council/run-debate-revote.js
'use strict';

/**
 * @module council/run-debate-revote
 * v4.8 PR3 Task 1: `legOpts`, `legRow`, and `runRevoteWave` extracted verbatim
 * out of run-debate.js (283/300 — the 300-line-per-file gate) with NO
 * behaviour change. run-debate.js requires all three back; runDebate still
 * calls runRevoteWave for the re-vote mini-wave (spec §5.1).
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

async function runRevoteWave(ctx, judges, bundleFindings) {
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
  const res = await ctx.launchers.launchWave({ ...legOpts(ctx, waveId), models: judges, prompt: bundle });
  ctx.addWave(res.wave);
  if (isAbortExit(res.exitCode)) { return { aborted: res.exitCode }; }
  const byJudge = {}, legs = [];
  // v4.7 D2/E4: mirrors runDefenseSolo's supersededLeg/repairLeg — one list each,
  // accumulated across every judge in this wave (most judges contribute neither).
  const supersededLegs = [], repairLegs = [];
  for (const leg of ((res.wave && res.wave.legs) || [])) {
    // The council ALIAS, not the resolved executable id — runStats rows join
    // meta.models by exact string (run-assemble.js's buildRunStatsEntry).
    const judge = leg.modelInput || leg.model;
    const alive = leg.status === 'complete' && leg.summary;
    let outLeg = leg;               // the leg actually recorded (post-repair when there is one)
    let parsed = alive ? parseRevote(leg.summary, expectedIds)
      : { ok: false, byId: {}, errors: [{ code: 'DEAD_LEG', detail: 'no summary' }] };
    let conformance = alive ? 'clean' : 'unstructured';
    if (alive && !parsed.ok) {
      // One repair, solo, to that judge.
      const repairId = `${waveId}-${judge}r`;
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
    byJudge[judge] = parsed.byId;
    legs.push({ model: judge, status: outLeg.status, durationMs: outLeg.durationMs, usage: outLeg.usage,
      conformance, summary: outLeg.summary || '', waveId: outLeg.waveId,
      ...(outLeg.model ? { resolvedModel: outLeg.model } : {}) });
  }
  return { byJudge, legs, supersededLegs, repairLegs };
}

module.exports = { legOpts, legRow, runRevoteWave };
