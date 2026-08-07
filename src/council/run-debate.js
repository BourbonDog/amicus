// src/council/run-debate.js
'use strict';

/**
 * @module council/run-debate
 * Impure Stage-2.5 orchestration for headless debate mode (spec §5.1). Launches the
 * defense mini-wave (one solo per raiser) and the re-vote mini-wave (one fanout to
 * disputing judges), parses each with one bounded repair, then hands off to the pure
 * reassembly in ./debate.js. Launchers are injected via ctx (repo DI pattern).
 */

const fs = require('fs');
const path = require('path');
const dbrief = require('./briefings-debate');
const { parseDebateDefense, parseRevote } = require('./parse-stage2');
const { applyDebate, debateRunStatsRows, PAST_TENSE,
  allNoResponse, nothingToDebate, disputingJudges, debateTargets, bundleFor } = require('./debate');
const { materializeDebate } = require('./run-launch');
const { tally } = require('./tally');
const { isAbortExit } = require('./run-stages');
const runState = require('./run-state');
const { emitStageStarted } = require('../observe/events');

/** Common launch options for every debate leg (judge-isolated `_scratch` cwd). */
function legOpts(ctx, waveId) {
  return { project: ctx.scratchDir, waveId, timeout: ctx.o.timeout, gateway: ctx.o.gateway,
    noValidateModel: ctx.o.noValidateModel, noCostGate: ctx.o.noCostGate,
    // v4.3 Task 3 (spec §7.2): attribution ids for every defense/re-vote leg.
    councilRunId: ctx.o.runId, councilName: ctx.o.councilName };
}

/**
 * v4.7 D2/E4: normalize a raw (possibly leg-absent) leg into the shape
 * debateRunStatsRows' superseded/repair lists expect. Same never-invent-a-waveId
 * discipline as buildRunStatsEntry (run-assemble.js) — only spread `waveId` when
 * the leg genuinely carries one — but keyed on an explicit `model` (the raiser or
 * judge identity), since a leg-absent attempt has no `.model` of its own to read.
 */
function legRow(model, leg, conformance) {
  return leg
    ? { model, status: leg.status, durationMs: typeof leg.durationMs === 'number' ? leg.durationMs : null,
        usage: leg.usage || null, conformance, summary: leg.summary || '',
        ...(leg.waveId ? { waveId: leg.waveId } : {}) }
    : { model, status: 'error', durationMs: null, usage: null, conformance, summary: '' };
}

async function runDefenseSolo(ctx, raiser, findings, idx) {
  const brief = dbrief.buildDefenseBrief({ findings, date: ctx.o.date });
  const waveId = `${ctx.o.runId}-d${idx + 1}`;
  const expectedIds = findings.map(f => f.id);
  // Record the sub-wave BEFORE launching: `amicus abort` cascades over stages[].waveIds
  // (run-stages.js's record(), run-chair.js's chair chain), so an id written after the
  // launch leaves an in-flight leg reachable only by the pid kill. The v4.0.1
  // abort-cascade fix must hold for debate stages too.
  runState.appendStageWave(ctx.o.runDir, 'debate-defense', waveId);
  const res = await ctx.launchers.launchSolo({ ...legOpts(ctx, waveId), model: raiser, prompt: brief });
  ctx.addWave(res.wave);
  if (isAbortExit(res.exitCode)) { return { raiser, aborted: res.exitCode }; }
  let leg = res.leg && res.leg.status === 'complete' ? res.leg : null;
  // A dead leg gets the SAME spec §5.7 fallback the parser applies to a block-level
  // failure — every expected id 'no-response', never an empty map, so the
  // originals-stand outcome still reaches debate.json and the record decoration.
  let parsed = leg ? parseDebateDefense(leg.summary, expectedIds)
    : { ok: false, byId: allNoResponse(expectedIds), errors: [{ code: 'DEAD_LEG', detail: 'no summary' }] };
  let conformance = leg ? 'clean' : 'unstructured';
  // v4.7 D2/E4: the repair's loser leg — the ORIGINAL when the repair produced a
  // usable (complete) leg (today's leg-swap below is unchanged), or the failed
  // repair attempt itself when it did not — retained so runDebate can turn it
  // into an extra debate-defense runStats row. Both stay null when no repair is
  // attempted at all (today's single-row shape, byte-identical).
  let supersededLeg = null, repairLeg = null;
  if (leg && !parsed.ok) {
    const repairId = `${waveId}r`;
    runState.appendStageWave(ctx.o.runDir, 'debate-defense', repairId);
    const res2 = await ctx.launchers.launchSolo({
      ...legOpts(ctx, repairId), model: raiser,
      // ⚠️ LC-12: a repair solo is a fresh session — the defense that failed rides along.
      prompt: dbrief.buildDefenseRepairPrompt({ errors: parsed.errors, defense: leg.summary }),
    });
    ctx.addWave(res2.wave);
    if (isAbortExit(res2.exitCode)) { return { raiser, aborted: res2.exitCode }; }
    const leg2 = res2.leg && res2.leg.status === 'complete' ? res2.leg : null;
    parsed = leg2 ? parseDebateDefense(leg2.summary, expectedIds) : parsed;
    conformance = parsed.ok ? 'repaired' : 'unstructured';
    if (leg2) { supersededLeg = legRow(raiser, leg, 'unstructured'); leg = leg2; }
    else { repairLeg = legRow(raiser, res2.leg, 'unstructured'); }
  }
  // A dead leg (no complete summary) OR an 'unstructured' conformance after the one
  // repair is a debate degradation (spec §5.7) — surfaced via the returned leg.
  const stub = { model: raiser, status: 'error', durationMs: null, usage: null, conformance: 'unstructured', summary: '' };
  return { raiser, byId: parsed.byId,
    leg: leg ? { model: raiser, status: leg.status, durationMs: leg.durationMs, usage: leg.usage, conformance, summary: leg.summary, waveId: leg.waveId } : stub,
    supersededLeg, repairLeg };
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
    legs.push({ model: judge, status: outLeg.status, durationMs: outLeg.durationMs, usage: outLeg.usage, conformance, summary: outLeg.summary || '', waveId: outLeg.waveId });
  }
  return { byJudge, legs, supersededLegs, repairLegs };
}

/**
 * Full Stage-2.5 sequence (spec §5.1). Returns everything run.js needs. Cost gate: run.js
 * checks overBudget before invoking; this checks again before the re-vote wave (spec §5.7).
 * @param {object} ctx run.js's {o, launchers, addWave, overBudget, scratchDir}
 * @param {{provisionalRecord: object, tallyInput: object}} args
 */
async function runDebate(ctx, { provisionalRecord, tallyInput }) {
  const { byRaiser, previousTier } = debateTargets(provisionalRecord, tallyInput);
  const contested = provisionalRecord.findings.filter(f => f.tier === 'Contested').length;
  const disputed = provisionalRecord.findings.filter(f => f.tier === 'Disputed').length;

  // ---- Defense mini-wave: ONE CONCURRENT solo per raiser (spec §5.1) ----
  // Concurrent, not sequential: every raiser gets its OWN briefing, so this is N independent
  // solos rather than one fanout wave. No per-leg budget check interleaves between them — the
  // cost ceiling is a WHOLE-ROUND gate run.js applies BEFORE calling runDebate
  // ('skipped-cost-ceiling' is a round-level outcome in spec §5.1's enum, not a per-leg one).
  // `appendStageWave` is sync fs and each solo registers its waveId before its first await,
  // so concurrency cannot interleave a read-modify-write of run.json.
  // v4.1 §4.4: the reserved seat 'claude' is a FILE-sourced review with no leg to
  // launch, so it is never asked to defend — its contested findings simply stand
  // (the same "originals stand" outcome as a no-response).
  const raisers = Object.keys(byRaiser).filter(m => m !== 'claude');
  const defenseResults = await Promise.all(
    raisers.map((raiser, i) => runDefenseSolo(ctx, raiser, byRaiser[raiser], i)));
  // A signal during the defense wave aborts the whole finalization (spec §5.7):
  // return the abort code so run.js finalizes 'aborted' with NO tally-final / NO ledger.
  const abortedDefense = defenseResults.find(d => d.aborted);
  if (abortedDefense) { return { aborted: abortedDefense.aborted, contested, disputed }; }
  materializeDebate(ctx.o.runDir, defenseResults.map(d => ({ model: d.raiser, summary: d.leg.summary })), 'rebuttal');

  const defenseByRaiser = {};
  for (const dr of defenseResults) { defenseByRaiser[dr.raiser] = { ...dr.byId }; }
  // v4.1 §4.4: claude never gets a defense leg (raisers filter above), but its
  // contested/disputed findings still need an audit trail — the SAME spec §5.7
  // "originals stand" fallback a dead/unrepaired defense leg gets. Seeded into
  // defenseByRaiser ONLY (never defenseResults, which feeds the `bad(l)`
  // degraded check below — a claude entry there would wrongly flip a clean run
  // to degraded/exit 2).
  if (byRaiser.claude) { defenseByRaiser.claude = allNoResponse(byRaiser.claude.map(f => f.id)); }
  // Stamp previousTier onto the tally input: applyDebate reads it off tallyInput.findings[]
  // (it ignores the provisional record), so without this every row's previousTier is null.
  const stampedInput = { ...tallyInput, findings: tallyInput.findings.map(f => ({ ...f, previousTier: previousTier[f.id] })) };

  // ---- Re-vote mini-wave (disputing judges only) ----
  let revoteByJudge = {}, revoteLegs = [], revoteSuperseded = [], revoteRepairs = [];
  const defendedOrAmended = bundleFor(defenseResults, tallyInput);
  const judges = disputingJudges(provisionalRecord, defendedOrAmended.map(f => f.id));
  // A re-vote is warranted only when something was defended/amended AND ≥1 judge disputed it.
  // Skipping THAT case because the whole-run budget is spent is the 'skipped-cost-ceiling'
  // degradation branch (spec §5.7); skipping because there is simply nothing to re-vote is NOT.
  const wouldRevote = defendedOrAmended.length > 0 && judges.length > 0;
  const costCeiling = ctx.overBudget() && wouldRevote;
  // run.js needs to know whether the wave actually launched so it can
  // checkpoint debate-revote 'skipped' (not a false 'complete') when nothing
  // was defended/amended, or the cost ceiling skipped it (spec §5.7).
  const revoteLaunched = wouldRevote && !costCeiling;
  if (revoteLaunched) {
    const rv = await runRevoteWave(ctx, judges, defendedOrAmended);
    if (rv.aborted) { return { aborted: rv.aborted, contested, disputed }; }
    revoteByJudge = rv.byJudge;
    revoteLegs = rv.legs;
    revoteSuperseded = rv.supersededLegs;
    revoteRepairs = rv.repairLegs;
    // revote-<model>.md per surviving judge leg, mirroring rebuttal-<model>.md
    // (spec §5.1 'raw outputs revote-<model>.md').
    materializeDebate(ctx.o.runDir, revoteLegs, 'revote');
  }

  // ---- Pure reassembly ----
  const { input: debatedInput, debateFindings } = applyDebate({
    tallyInput: stampedInput, provisionalRecord, defenseByRaiser, revoteByJudge });
  debatedInput.runStats = [...(debatedInput.runStats || []),
    ...debateRunStatsRows({ defenseLegs: defenseResults.map(d => d.leg), revoteLegs,
      // v4.7 D2/E4: the retained loser legs from every raiser's defense repair
      // plus every judge's re-vote repair — same append, no new channel into
      // buildTallyInput.
      supersededLegs: [...defenseResults.map(d => d.supersededLeg).filter(Boolean), ...revoteSuperseded],
      repairLegs: [...defenseResults.map(d => d.repairLeg).filter(Boolean), ...revoteRepairs] })];

  // verdictChanges: findings whose tier moved from provisional to debated.
  const provTierById = new Map(provisionalRecord.findings.map(f => [f.id, f.tier]));
  const debatedRec = tally(debatedInput);
  let verdictChanges = 0;
  for (const f of debatedRec.findings) { if (provTierById.get(f.id) !== f.tier) { verdictChanges += 1; } }

  // ---- Artifacts + summary ----
  const revotesJson = [];
  for (const [judge, perId] of Object.entries(revoteByJudge)) {
    for (const [id, rv] of Object.entries(perId)) { revotesJson.push({ judge, id, verdict: rv.verdict, reason: rv.reason || null, applied: true }); }
  }
  fs.writeFileSync(path.join(ctx.o.runDir, 'debate.json'),
    JSON.stringify({ findings: debateFindings, revotes: revotesJson }, null, 2), { mode: 0o600 });

  const counts = { defended: 0, amended: 0, withdrawn: 0, noResponse: 0 };
  const COUNT_KEY = { defend: 'defended', amend: 'amended', withdraw: 'withdrawn' };
  for (const df of debateFindings) { counts[COUNT_KEY[df.action] || 'noResponse'] += 1; }
  const debateSummary = {
    enabled: true, outcome: costCeiling ? 'skipped-cost-ceiling' : 'ran',
    contested, disputed, ...counts,
    revoteJudges: revoteLegs.length, revoteApplied: revotesJson.length, verdictChanges,
  };

  // ---- Degradation (spec §5.7) → run.js maps this to exit code 2 ----
  // A dead/unstructured-after-repair defense solo, a partial or fully-dead re-vote wave, or a
  // cost-ceiling skip of a warranted re-vote each degrade the run. (Abort short-circuits above;
  // nothing-to-debate and a clean run are NOT degradations.)
  const bad = (l) => l.status !== 'complete' || l.conformance === 'unstructured';
  const degraded = defenseResults.some(d => bad(d.leg)) || revoteLegs.some(bad) || costCeiling;

  // Chair-addendum outcomes (spec §5.3c). `action` is the PAST_TENSE form
  // buildDebateAddendum renders verbatim — only the four valid values ever reach it.
  const priorById = new Map(provisionalRecord.findings.map(
    f => [f.id, Object.fromEntries((f.adjudications || []).map(a => [a.judge, a.verdict]))]));
  const addendumOutcomes = debateFindings.map(df => ({
    id: df.id, originalClaim: (tallyInput.findings.find(f => f.id === df.id) || {}).claim,
    action: PAST_TENSE[df.action] || PAST_TENSE['no-response'],
    amendedClaim: df.action === 'amend' ? df.claim : null,
    priorVerdicts: priorById.get(df.id) || {},
    revotes: Object.fromEntries(revotesJson.filter(r => r.id === df.id).map(r => [r.judge, r.verdict])),
  }));

  return { debatedInput, debateFindings, debateSummary, addendumOutcomes,
    defenseLegs: defenseResults.map(d => d.leg), revoteLegs, verdictChanges,
    degraded, aborted: null, revoteLaunched };
}

module.exports = { runDebate, nothingToDebate, disputingJudges, debateTargets };
