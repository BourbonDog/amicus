// src/council/run-stages.js
'use strict';

/**
 * @module council/run-stages
 * Stage-1 (independent reviews) and Stage-2 (anonymized cross-review) loops
 * for the headless council engine — launch, materialize, validate, bounded
 * repair. Split from run.js for the 300-line gate. All model calls go through
 * ctx.launchers (DI); the whole-run cost ceiling is consulted via
 * ctx.overBudget() before every paid repair launch (spec §4).
 *
 * Headless adaptations (vs SKILL.md):
 *  - A review still malformed after 2 repair re-prompts is KEPT with
 *    conformance 'unstructured' and zero findings entries (the skill's Claude
 *    hand-parse fallback has no headless equivalent; the review still gets
 *    ranked in Stage 2).
 *  - A judge still malformed after 2 repairs is dropped from rankings and
 *    adjudications (ok:false) and recorded conformance 'unstructured' (spec §5).
 */

const fs = require('fs');
const path = require('path');
const { validateFindings } = require('./findings');
const briefings = require('./briefings');
const stage2 = require('./briefings-stage2');
const { parseJudgeOutput } = require('./parse-stage2');
const { materializeReviews, sanitizeName } = require('./run-launch');
const runState = require('./run-state');

function isAbortExit(code) { return code === 130 || code === 143; }

function slug(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Launch all Stage-1 legs (wave + critic/lens solos), collect run docs. */
async function launchStage1(ctx) {
  const { o, launchers } = ctx;
  const common = {
    project: o.runDir, timeout: o.timeout, gateway: o.gateway,
    noValidateModel: o.noValidateModel,
  };
  const launches = [];
  // Record every sub-wave BEFORE it launches: `amicus abort` cascades over
  // stages[].waveIds, so an id written after the launch leaves that leg
  // reachable only by the pid kill (no per-leg abort marker).
  const record = (waveId) => runState.appendStageWave(o.runDir, 'stage1', waveId);
  if (o.lenses) {
    o.models.forEach((m, i) => {
      const waveId = `${o.runId}-l${i + 1}`;
      record(waveId);
      launches.push(launchers.launchSolo({
        ...common, model: m, waveId,
        prompt: briefings.buildLensBriefing({ lens: o.lenses[i], briefing: o.briefing, date: o.date }),
      }));
    });
  } else {
    const seats = o.models.filter(m => m !== o.critic);
    if (seats.length > 0) {
      record(`${o.runId}-s1`);
      launches.push(launchers.launchWave({
        ...common, models: seats, waveId: `${o.runId}-s1`,
        prompt: briefings.buildSeatBriefing({ briefing: o.briefing, date: o.date }),
      }));
    }
    if (o.critic) {
      record(`${o.runId}-c1`);
      launches.push(launchers.launchSolo({
        ...common, model: o.critic, waveId: `${o.runId}-c1`,
        prompt: briefings.buildCriticBriefing({ briefing: o.briefing, date: o.date }),
      }));
    }
  }
  const results = await Promise.all(launches);
  let aborted = null;
  const legs = [];
  for (const r of results) {
    ctx.addWave(r.wave);
    if (isAbortExit(r.exitCode)) { aborted = r.exitCode; }
    if (r.wave && Array.isArray(r.wave.legs)) { legs.push(...r.wave.legs); }
  }
  return { aborted, legs };
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
 * @returns {Promise<{aborted: number|null, reviews: Array, deadLegs: Array}>}
 */
async function runStage1(ctx) {
  const { o } = ctx;
  const { aborted, legs } = await launchStage1(ctx);
  if (aborted) { return { aborted, reviews: [], deadLegs: [] }; }

  const materialized = materializeReviews(o.runDir, legs);
  const alive = new Set(materialized.map(m => m.leg));
  const deadLegs = legs.filter(l => !alive.has(l));

  const reviews = [];
  let repairSeq = 0;
  for (const m of materialized) {
    let conformance = 'clean';
    let res = validateFindings(m.text);
    let attempts = 0;
    while (!res.ok && attempts < 2 && !ctx.overBudget()) {
      attempts += 1;
      repairSeq += 1;
      const waveId = `${o.runId}-p${repairSeq}`;
      runState.appendStageWave(o.runDir, 'stage1', waveId);
      const solo = await ctx.launchers.launchSolo({
        model: m.modelInput, prompt: briefings.buildFindingsRepairPrompt({ errors: res.errors }),
        project: o.runDir, waveId, timeout: o.timeout,
        gateway: o.gateway, noValidateModel: o.noValidateModel,
      });
      ctx.addWave(solo.wave);
      if (isAbortExit(solo.exitCode)) { return { aborted: solo.exitCode, reviews, deadLegs }; }
      res = validateFindings((solo.leg && solo.leg.summary) || '');
      if (res.ok) { conformance = 'repaired'; }
    }
    if (!res.ok) { conformance = 'unstructured'; }
    reviews.push({
      model: m.modelInput, modelInput: m.modelInput, role: roleFor(o, m.modelInput),
      text: m.text, findings: res.ok ? res.findings : [], conformance, leg: m.leg,
    });
  }
  return { aborted: null, reviews, deadLegs };
}

/**
 * Stage 2: shared anonymized bundle → judge wave in _scratch → parse + repair.
 * @param {object} ctx
 * @param {{reviews: Array, labels: {entries, labelMap}, globalFindings: Array}} args
 * @returns {Promise<{aborted: number|null, judgeResults: Array}>}
 */
async function runStage2(ctx, { reviews, labels, globalFindings }) {
  const { o } = ctx;
  const { rankingToOrder } = require('./anonymize');
  fs.mkdirSync(ctx.scratchDir, { recursive: true, mode: 0o700 });

  const labeled = labels.entries.map((e, i) => ({ label: e.label, text: reviews[i].text }));
  const bundle = stage2.buildJudgeBundle({ reviews: labeled, findings: globalFindings, date: o.date });
  fs.writeFileSync(path.join(o.runDir, 'bundle-stage2.md'), bundle, { mode: 0o600 });

  const judges = reviews.map(r => r.modelInput);
  const parseCtx = {
    labels: labels.entries.map(e => e.label),
    findingIds: globalFindings.map(f => f.id),
  };
  runState.appendStageWave(o.runDir, 'stage2', `${o.runId}-s2`);
  const { wave, exitCode } = await ctx.launchers.launchWave({
    models: judges, prompt: bundle, project: ctx.scratchDir, waveId: `${o.runId}-s2`,
    timeout: o.timeout, gateway: o.gateway, noValidateModel: o.noValidateModel,
  });
  ctx.addWave(wave);
  if (isAbortExit(exitCode)) { return { aborted: exitCode, judgeResults: [] }; }

  const judgeResults = [];
  let repairSeq = 0;
  for (const leg of (wave && wave.legs) || []) {
    const judge = leg.modelInput || leg.model;
    if (leg.status === 'complete' && leg.summary) {
      fs.writeFileSync(path.join(o.runDir, `judge-${sanitizeName(judge)}.md`), leg.summary, { mode: 0o600 });
    }
    let conformance = 'clean';
    let parsed = (leg.status === 'complete' && leg.summary)
      ? parseJudgeOutput(leg.summary, parseCtx)
      : { ok: false, errors: [{ code: 'DEAD_LEG', detail: leg.error || leg.status }] };
    let attempts = 0;
    while (!parsed.ok && leg.status === 'complete' && leg.summary && attempts < 2 && !ctx.overBudget()) {
      attempts += 1;
      repairSeq += 1;
      const waveId = `${o.runId}-q${repairSeq}`;
      runState.appendStageWave(o.runDir, 'stage2', waveId);
      const solo = await ctx.launchers.launchSolo({
        model: judge, prompt: stage2.buildJudgeRepairPrompt({ errors: parsed.errors }),
        project: ctx.scratchDir, waveId, timeout: o.timeout,
        gateway: o.gateway, noValidateModel: o.noValidateModel,
      });
      ctx.addWave(solo.wave);
      if (isAbortExit(solo.exitCode)) { return { aborted: solo.exitCode, judgeResults }; }
      parsed = parseJudgeOutput((solo.leg && solo.leg.summary) || '', parseCtx);
      if (parsed.ok) { conformance = 'repaired'; }
    }
    if (!parsed.ok) {
      judgeResults.push({ judge, ok: false, order: null, adjudications: null,
        conformance: leg.status === 'complete' ? 'unstructured' : 'clean' });
      continue;
    }
    const { order } = rankingToOrder(parsed.ranking, labels.labelMap);
    judgeResults.push({ judge, ok: true, order, adjudications: parsed.adjudications, conformance });
  }
  return { aborted: null, judgeResults };
}

module.exports = { runStage1, runStage2, isAbortExit, slug };
