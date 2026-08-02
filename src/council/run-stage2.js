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

/**
 * Stage 2: shared anonymized bundle → judge wave in _scratch → parse + repair.
 * @param {object} ctx
 * @param {{reviews: Array, labels: {entries, labelMap}, globalFindings: Array,
 *   extraLabeled?: Array<{label: string, text: string}>}} args
 *   `extraLabeled` (v4.1 §4.4) are labeled reviews sourced from a FILE rather than
 *   a leg (the Claude review): they join the judged BUNDLE, never the judge ROSTER.
 * @returns {Promise<{aborted: number|null, judgeResults: Array}>}
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
    fallback: o.fallback, catalog: o.catalog,
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
        fallback: o.fallback, catalog: o.catalog,
      });
      ctx.addWave(solo.wave);
      if (isAbortExit(solo.exitCode)) { return { aborted: solo.exitCode, judgeResults }; }
      const out = (solo.leg && solo.leg.summary) || '';
      if (out.trim()) { judging = out; }
      parsed = parseJudgeOutput(out, parseCtx);
      if (parsed.ok) { conformance = 'repaired'; }
    }
    if (!parsed.ok) {
      judgeResults.push({ judge, ok: false, order: null, adjudications: null,
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
    judgeResults.push({ judge, ok: true, order, adjudications: parsed.adjudications, conformance,
      leg: leg || null });
  }
  return { aborted: null, judgeResults };
}

module.exports = { runStage2 };
