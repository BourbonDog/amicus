// tests/council/run-stages.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { runStage1, runStage2, slug } = require('../../src/council/run-stages');
const { assignLabels, toGlobalFindings } = require('../../src/council/anonymize');

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'council-stages-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const review = (n) => `Prose review ${n}.\n\n\`\`\`json\n${JSON.stringify({
  overall: 'take',
  findings: [{ id: 1, severity: 'major', claim: `claim-${n}`, location: 'loc', rationale: 'why' }],
})}\n\`\`\`\n`;
const judgeOut = (ranking, adjudications) =>
  `Judged.\n\n\`\`\`json\n${JSON.stringify({ ranking, adjudications })}\n\`\`\`\n`;
const mkLeg = (model, summary, status = 'complete') => ({
  taskId: `${model}-leg`, model, modelInput: model, status, summary,
  durationMs: 1000, usage: { cost: { amount: 0.01, source: 'reported' } },
});
const okWave = (legs) => ({ wave: { status: 'complete', legs }, exitCode: 0 });

function makeCtx({ onWave, onSolo, models = ['gemini', 'gpt', 'qwen'], critic = null, lenses = null, overBudget = () => false }) {
  const runDir = path.join(tmp, 'council-abc123');
  fs.mkdirSync(runDir, { recursive: true });
  const added = [];
  return {
    o: { briefing: 'material', models, chair: 'deepseek', critic, lenses,
      runId: 'abc123', runDir, timeout: 10, gateway: 'auto', noValidateModel: false, date: '2026-07-19' },
    launchers: {
      launchWave: async (opts) => onWave(opts),
      launchSolo: async (opts) => {
        const r = await onSolo(opts);
        return { ...r, leg: (r.wave && r.wave.legs && r.wave.legs[0]) || null };
      },
    },
    addWave: (w) => added.push(w),
    overBudget,
    scratchDir: path.join(runDir, '_scratch'),
    _added: added,
  };
}

describe('runStage1', () => {
  test('happy path: one wave for standard seats, reviews materialized + validated', async () => {
    const waves = [];
    const ctx = makeCtx({
      onWave: (opts) => { waves.push(opts); return okWave(opts.models.map(m => mkLeg(m, review(m)))); },
      onSolo: () => { throw new Error('no solos expected'); },
    });
    const { aborted, reviews, deadLegs } = await runStage1(ctx);
    expect(aborted).toBeNull();
    expect(waves).toHaveLength(1);
    expect(waves[0].waveId).toBe('abc123-s1');
    expect(waves[0].project).toBe(ctx.o.runDir);
    expect(reviews.map(r => r.model)).toEqual(['gemini', 'gpt', 'qwen']);
    expect(reviews.every(r => r.conformance === 'clean' && r.findings.length === 1)).toBe(true);
    expect(deadLegs).toHaveLength(0);
    expect(fs.existsSync(path.join(ctx.o.runDir, 'review-gemini.md'))).toBe(true);
  });

  test('critic seat launches as a concurrent solo with role critic', async () => {
    const solos = [];
    const ctx = makeCtx({
      critic: 'qwen',
      onWave: (opts) => okWave(opts.models.map(m => mkLeg(m, review(m)))),
      onSolo: (opts) => { solos.push(opts); return okWave([mkLeg(opts.model, review(opts.model))]); },
    });
    const { reviews } = await runStage1(ctx);
    expect(solos.map(s => s.waveId)).toEqual(['abc123-c1']);
    expect(solos[0].prompt).toContain('designated critic');
    expect(reviews.find(r => r.model === 'qwen').role).toBe('critic');
    expect(reviews.find(r => r.model === 'gemini').role).toBe('seat');
  });

  test('lenses: NO shared wave, one solo per seat, positional lens assignment', async () => {
    const solos = [];
    const ctx = makeCtx({
      lenses: ['growth-stage VC', 'security architect', 'skeptical buyer'],
      onWave: () => { throw new Error('no wave expected under lenses'); },
      onSolo: (opts) => { solos.push(opts); return okWave([mkLeg(opts.model, review(opts.model))]); },
    });
    const { reviews } = await runStage1(ctx);
    expect(solos.map(s => s.waveId)).toEqual(['abc123-l1', 'abc123-l2', 'abc123-l3']);
    expect(solos[0].prompt).toContain('growth-stage VC');
    expect(reviews.find(r => r.model === 'gpt').role).toBe(`lens:${slug('security architect')}`);
  });

  test('malformed findings → repair solo → conformance repaired', async () => {
    const solos = [];
    const ctx = makeCtx({
      onWave: (opts) => okWave(opts.models.map(m =>
        mkLeg(m, m === 'gpt' ? 'prose without json' : review(m)))),
      onSolo: (opts) => { solos.push(opts); return okWave([mkLeg('gpt', review('gpt'))]); },
    });
    const { reviews } = await runStage1(ctx);
    expect(solos).toHaveLength(1);
    expect(solos[0].model).toBe('gpt');
    expect(solos[0].waveId).toBe('abc123-p1');
    expect(reviews.find(r => r.model === 'gpt').conformance).toBe('repaired');
  });

  test('still malformed after 2 repairs → unstructured, findings [], review KEPT', async () => {
    let soloCount = 0;
    const ctx = makeCtx({
      onWave: (opts) => okWave(opts.models.map(m =>
        mkLeg(m, m === 'gpt' ? 'no json at all' : review(m)))),
      onSolo: () => { soloCount += 1; return okWave([mkLeg('gpt', 'still no json')]); },
    });
    const { reviews } = await runStage1(ctx);
    expect(soloCount).toBe(2);                       // cap = 2 re-prompts
    const gpt = reviews.find(r => r.model === 'gpt');
    expect(gpt.conformance).toBe('unstructured');
    expect(gpt.findings).toEqual([]);
    expect(reviews).toHaveLength(3);                 // never dropped for a formatting miss
  });

  test('dead leg is reported in deadLegs and its review absent', async () => {
    const ctx = makeCtx({
      onWave: (opts) => okWave(opts.models.map(m =>
        m === 'qwen' ? mkLeg(m, '', 'error') : mkLeg(m, review(m)))),
      onSolo: () => { throw new Error('no solos'); },
    });
    const { reviews, deadLegs } = await runStage1(ctx);
    expect(reviews.map(r => r.model)).toEqual(['gemini', 'gpt']);
    expect(deadLegs).toHaveLength(1);
    expect(deadLegs[0].model).toBe('qwen');
  });

  test('signal-aborted wave short-circuits with the abort exit code', async () => {
    const ctx = makeCtx({
      onWave: () => ({ wave: { status: 'aborted', legs: [] }, exitCode: 130 }),
      onSolo: () => { throw new Error('no solos'); },
    });
    const { aborted } = await runStage1(ctx);
    expect(aborted).toBe(130);
  });
});

describe('runStage2', () => {
  function stage1Reviews() {
    return [
      { model: 'gemini', modelInput: 'gemini', role: 'seat', text: review('gemini'),
        findings: [{ id: 1, severity: 'major', claim: 'c', location: 'l', rationale: 'r' }],
        conformance: 'clean', leg: mkLeg('gemini', review('gemini')) },
      { model: 'gpt', modelInput: 'gpt', role: 'seat', text: review('gpt'),
        findings: [{ id: 1, severity: 'nit', claim: 'c', location: 'l', rationale: 'r' }],
        conformance: 'clean', leg: mkLeg('gpt', review('gpt')) },
    ];
  }
  const labels = assignLabels(['gemini', 'gpt']);
  const globalFindings = [
    ...toGlobalFindings('A', 'gemini', [{ id: 1, severity: 'major', claim: 'c' }]),
    ...toGlobalFindings('B', 'gpt', [{ id: 1, severity: 'nit', claim: 'c' }]),
  ];

  test('happy path: shared bundle wave in _scratch, judge files written, order de-anonymized', async () => {
    const waves = [];
    const ctx = makeCtx({
      models: ['gemini', 'gpt'],
      onWave: (opts) => {
        waves.push(opts);
        return okWave([
          mkLeg('gemini', judgeOut(['Review B', 'Review A'],
            [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'neutral' }])),
          mkLeg('gpt', judgeOut(['Review A', 'Review B'],
            [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'dispute' }])),
        ]);
      },
      onSolo: () => { throw new Error('no repairs expected'); },
    });
    const { aborted, judgeResults } = await runStage2(ctx, { reviews: stage1Reviews(), labels, globalFindings });
    expect(aborted).toBeNull();
    expect(waves[0].waveId).toBe('abc123-s2');
    expect(waves[0].project).toBe(ctx.scratchDir);           // judge isolation (spec §6)
    expect(waves[0].prompt.split('\n')[0]).toContain('Do NOT use any tools');
    expect(fs.existsSync(path.join(ctx.o.runDir, 'bundle-stage2.md'))).toBe(true);
    expect(fs.existsSync(path.join(ctx.o.runDir, 'judge-gemini.md'))).toBe(true);
    const g = judgeResults.find(j => j.judge === 'gemini');
    expect(g.ok).toBe(true);
    expect(g.order).toEqual(['gpt', 'gemini']);              // labels → models
    expect(g.adjudications).toEqual([{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'neutral' }]);
  });

  test('malformed judge → repair solo in _scratch → ok with conformance repaired', async () => {
    const solos = [];
    const ctx = makeCtx({
      models: ['gemini', 'gpt'],
      onWave: () => okWave([
        mkLeg('gemini', 'no json'),
        mkLeg('gpt', judgeOut(['Review A', 'Review B'], [{ id: 'A1', verdict: 'agree' }])),
      ]),
      onSolo: (opts) => {
        solos.push(opts);
        return okWave([mkLeg('gemini', judgeOut(['Review B', 'Review A'], [{ id: 'B1', verdict: 'agree' }]))]);
      },
    });
    const { judgeResults } = await runStage2(ctx, { reviews: stage1Reviews(), labels, globalFindings });
    expect(solos[0].waveId).toBe('abc123-q1');
    expect(solos[0].project).toBe(ctx.scratchDir);
    const g = judgeResults.find(j => j.judge === 'gemini');
    expect(g.ok).toBe(true);
    expect(g.conformance).toBe('repaired');
  });

  test('judge still bad after 2 repairs → ok false, conformance unstructured', async () => {
    let soloCount = 0;
    const ctx = makeCtx({
      models: ['gemini', 'gpt'],
      onWave: () => okWave([
        mkLeg('gemini', 'never json'),
        mkLeg('gpt', judgeOut(['Review A', 'Review B'], [{ id: 'A1', verdict: 'agree' }])),
      ]),
      onSolo: () => { soloCount += 1; return okWave([mkLeg('gemini', 'still bad')]); },
    });
    const { judgeResults } = await runStage2(ctx, { reviews: stage1Reviews(), labels, globalFindings });
    expect(soloCount).toBe(2);
    const g = judgeResults.find(j => j.judge === 'gemini');
    expect(g.ok).toBe(false);
    expect(g.conformance).toBe('unstructured');
  });

  test('dead judge leg → ok false (tally over survivors; tiers unchanged)', async () => {
    const ctx = makeCtx({
      models: ['gemini', 'gpt'],
      onWave: () => okWave([
        mkLeg('gemini', '', 'timeout'),
        mkLeg('gpt', judgeOut(['Review A', 'Review B'], [{ id: 'A1', verdict: 'agree' }])),
      ]),
      onSolo: () => { throw new Error('dead legs are not repaired'); },
    });
    const { judgeResults } = await runStage2(ctx, { reviews: stage1Reviews(), labels, globalFindings });
    expect(judgeResults.find(j => j.judge === 'gemini').ok).toBe(false);
    expect(judgeResults.find(j => j.judge === 'gpt').ok).toBe(true);
  });
});
