// tests/council/helpers/fake-launchers.js — shared fakes for driver tests.
'use strict';

const review = (n, findings) => `Prose ${n}.\n\n\`\`\`json\n${JSON.stringify({
  overall: 'take',
  findings: findings || [{ id: 1, severity: 'major', claim: `claim-${n}`, location: 'loc', rationale: 'why' }],
})}\n\`\`\`\n`;

const judgeOut = (ranking, adjudications) =>
  `Judged.\n\n\`\`\`json\n${JSON.stringify({ ranking, adjudications })}\n\`\`\`\n`;

const mkLeg = (model, summary, status = 'complete', cost = 0.01) => ({
  taskId: `${model}-leg`, model, modelInput: model, status, summary,
  durationMs: 1000, usage: { cost: { amount: cost, source: 'reported' } },
});

const okWave = (legs, exitCode = 0, status = 'complete') =>
  ({ wave: { status, legs }, exitCode });

/**
 * Scripted launchers: script[waveId] = (opts) => {wave, exitCode}.
 * Records every launch's opts in .calls. Throws on an unscripted waveId so a
 * test can prove a launch did NOT happen.
 */
function scriptedLaunchers(script) {
  const calls = [];
  async function launchWave(opts) {
    calls.push(opts);
    const fn = script[opts.waveId];
    if (!fn) { throw new Error(`no script for waveId ${opts.waveId}`); }
    return fn(opts);
  }
  async function launchSolo(opts) {
    const r = await launchWave({ ...opts, models: [opts.model] });
    return { ...r, leg: (r.wave && r.wave.legs && r.wave.legs[0]) || null };
  }
  return { launchWave, launchSolo, calls };
}

/** 3-bench happy-path script: gemini/gpt/qwen review; all judge; deepseek chairs. */
function happyScript() {
  return {
    'abc123-s1': (opts) => okWave(opts.models.map(m => mkLeg(m, review(m)))),
    'abc123-s2': () => okWave([
      mkLeg('gemini', judgeOut(['Review B', 'Review C', 'Review A'],
        [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'agree' }, { id: 'C1', verdict: 'neutral' }])),
      mkLeg('gpt', judgeOut(['Review A', 'Review C', 'Review B'],
        [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'agree' }, { id: 'C1', verdict: 'dispute' }])),
      mkLeg('qwen', judgeOut(['Review A', 'Review B', 'Review C'],
        [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'neutral' }, { id: 'C1', verdict: 'agree' }])),
    ]),
    'abc123-ch1': () => okWave([
      mkLeg('deepseek', 'Synthesis of the bench.\n\nHARD QUESTIONS\n1. Q?\n\nVERDICT: Ship it', 'complete', 0.03),
    ]),
  };
}

/** Standard options for runCouncil in driver tests. */
function baseOptions(tmp, overrides = {}) {
  const path = require('path');
  return {
    briefing: 'Review this material.', models: ['gemini', 'gpt', 'qwen'], chair: 'deepseek',
    critic: null, lenses: null, project: tmp, runId: 'abc123',
    runDir: path.join(tmp, 'council-abc123'), timeout: 5, maxCost: null,
    gateway: 'auto', noValidateModel: false, date: '2026-07-19', ...overrides,
  };
}

module.exports = { review, judgeOut, mkLeg, okWave, scriptedLaunchers, happyScript, baseOptions };
