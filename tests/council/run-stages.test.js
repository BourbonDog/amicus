// tests/council/run-stages.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { runStage1, slug } = require('../../src/council/run-stages');
// Stage 2 was split into its own module for the 300-line gate (v4.4.1 Task 2);
// its tests stay here, next to Stage 1's, because they share makeCtx.
const { runStage2 } = require('../../src/council/run-stage2');
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
      runId: 'abc123', runDir, timeout: 10, gateway: 'auto', noValidateModel: false, date: '2026-07-19',
      // v4.3 Task 3 (spec §7.2): non-null so every launch-site assertion below
      // can prove the id actually reached the launcher, not just a falsy default.
      councilName: 'nightly-council' },
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
    // v4.3 Task 3 (spec §7.2): the seat wave carries council attribution.
    expect(waves[0].councilRunId).toBe('abc123');
    expect(waves[0].councilName).toBe('nightly-council');
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
    // v4.3 Task 3 (spec §7.2): the findings-repair solo carries council attribution too.
    expect(solos[0].councilRunId).toBe('abc123');
    expect(solos[0].councilName).toBe('nightly-council');
    expect(reviews.find(r => r.model === 'gpt').conformance).toBe('repaired');
  });

  test('LC-6: the repair solo carries the review it is repairing', async () => {
    // The defect: the repair prompt shipped the validation ERRORS without the
    // REVIEW they were errors about, so three of five paid councils burned a
    // seat — two models refused ("I don't have a previous review to correct")
    // and one fabricated a finding to satisfy the schema.
    const solos = [];
    const badReview = 'Prose about the material, but no fenced block at all.';
    const ctx = makeCtx({
      onWave: (opts) => okWave(opts.models.map(m => mkLeg(m, m === 'gpt' ? badReview : review(m)))),
      onSolo: (opts) => { solos.push(opts); return okWave([mkLeg('gpt', review('gpt'))]); },
    });
    await runStage1(ctx);
    expect(solos).toHaveLength(1);
    expect(solos[0].prompt).toContain(badReview);
    expect(solos[0].prompt).toContain('YOUR PREVIOUS REVIEW');
  });

  test('LC-6: the SECOND repair carries the first repair output, which is what failed', async () => {
    // Errors and artifact must describe the same thing. On attempt 2 the errors
    // come from validating attempt 1's output, so attempt 1's output — not the
    // original review — is the text being repaired.
    const solos = [];
    const badReview = 'original prose, no json';
    const firstRepair = 'first repair attempt, still no json';
    const ctx = makeCtx({
      onWave: (opts) => okWave(opts.models.map(m => mkLeg(m, m === 'gpt' ? badReview : review(m)))),
      onSolo: (opts) => {
        solos.push(opts);
        return okWave([mkLeg('gpt', solos.length === 1 ? firstRepair : 'second repair, still no json')]);
      },
    });
    await runStage1(ctx);
    expect(solos).toHaveLength(2);
    expect(solos[0].prompt).toContain(badReview);
    expect(solos[1].prompt).toContain(firstRepair);
    expect(solos[1].prompt).not.toContain(badReview);
  });

  test('LC-6: a repair whose leg came back empty still names the text that failed', async () => {
    // A dead/empty repair leg validates as '' — there is no newer artifact, so
    // the next attempt must keep pointing at the last text we actually have
    // rather than opening an empty "previous review" block.
    const solos = [];
    const badReview = 'original prose, no json';
    const ctx = makeCtx({
      onWave: (opts) => okWave(opts.models.map(m => mkLeg(m, m === 'gpt' ? badReview : review(m)))),
      onSolo: (opts) => { solos.push(opts); return okWave([mkLeg('gpt', '')]); },
    });
    await runStage1(ctx);
    expect(solos).toHaveLength(2);
    expect(solos[1].prompt).toContain(badReview);
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

  test('cost ceiling blocks findings repair: no solo fires, review ends unstructured (KEPT)', async () => {
    let soloCalls = 0;
    const ctx = makeCtx({
      overBudget: () => true,
      onWave: (opts) => okWave(opts.models.map(m =>
        mkLeg(m, m === 'gpt' ? 'prose without json' : review(m)))),
      onSolo: () => { soloCalls += 1; throw new Error('no repair solos expected over budget'); },
    });
    const { reviews } = await runStage1(ctx);
    expect(soloCalls).toBe(0);
    const gpt = reviews.find(r => r.model === 'gpt');
    expect(gpt.conformance).toBe('unstructured');
    expect(gpt.findings).toEqual([]);
    expect(reviews).toHaveLength(3);                 // still KEPT, never dropped
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

  // ---- LC-11: a repaired review keeps its own prose, and the repair's contract
  // ("the same findings, fixed — do not add or remove findings") is enforced. ----
  async function runStage1WithFixture({ original, repaired }) {
    const ctx = makeCtx({
      models: ['gemini'],
      onWave: (opts) => okWave(opts.models.map(m => mkLeg(m, original))),
      onSolo: () => okWave([mkLeg('gemini', repaired)]),
    });
    return runStage1(ctx);
  }

  test('a repaired review always keeps its own prose — never the repair JSON', async () => {
    const original = 'Original prose naming the ordering bug.\n```json\n'
      + '{"overall":"o","findings":[{"id":1,"severity":"huge","claim":"c",'
      + '"location":"l","rationale":"r"}]}\n```';
    // A repair leg returns ONLY the corrected JSON — briefings.js:19-26 omits the
    // two-part prose framing on purpose. Substituting this as `text` would hand the
    // judges a review with no narrative and put a JSON dump in bundle-stage2.md.
    const repaired = '```json\n{"overall":"o","findings":[{"id":1,"severity":"major",'
      + '"claim":"c","location":"l","rationale":"r"}]}\n```';
    const { reviews } = await runStage1WithFixture({ original, repaired });
    expect(reviews[0].conformance).toBe('repaired');
    expect(reviews[0].text).toBe(original);
    expect(reviews[0].text).toContain('Original prose naming the ordering bug');
    expect(reviews[0].findings).toHaveLength(1);
    expect(reviews[0].findingsUnverified).toBeFalsy();   // count matched: contract honored
  });

  test('a repair that ADDS a finding is refused — the prose cannot support it', async () => {
    const original = 'Prose about exactly one problem.\n```json\n'
      + '{"overall":"o","findings":[{"id":1,"severity":"huge","claim":"c",'
      + '"location":"l","rationale":"r"}]}\n```';
    // Two findings out, one in. This is the costgate01 fabrication shape.
    const repaired = '```json\n{"overall":"o","findings":['
      + '{"id":1,"severity":"major","claim":"c","location":"l","rationale":"r"},'
      + '{"id":2,"severity":"major","claim":"invented","location":"l","rationale":"r"}]}\n```';
    const { reviews } = await runStage1WithFixture({ original, repaired });
    expect(reviews[0].conformance).toBe('unstructured');
    expect(reviews[0].findings).toEqual([]);
    expect(reviews[0].text).toBe(original);
  });

  test('a repair that DROPS a finding is refused too', async () => {
    const original = 'Prose about two problems.\n```json\n{"overall":"o","findings":['
      + '{"id":1,"severity":"huge","claim":"c","location":"l","rationale":"r"},'
      + '{"id":2,"severity":"major","claim":"c2","location":"l","rationale":"r"}]}\n```';
    const repaired = '```json\n{"overall":"o","findings":[{"id":1,"severity":"major",'
      + '"claim":"c","location":"l","rationale":"r"}]}\n```';
    const { reviews } = await runStage1WithFixture({ original, repaired });
    expect(reviews[0].conformance).toBe('unstructured');
    expect(reviews[0].findings).toEqual([]);
  });

  test('an unparseable original accepts the repair but marks it unverified', async () => {
    const original = 'Prose about three problems.\n```json\n{this is not json\n```';
    const repaired = '```json\n{"overall":"o","findings":[{"id":1,"severity":"major",'
      + '"claim":"c","location":"l","rationale":"r"}]}\n```';
    const { reviews } = await runStage1WithFixture({ original, repaired });
    expect(reviews[0].conformance).toBe('repaired');
    expect(reviews[0].findingsUnverified).toBe(true);
    expect(reviews[0].text).toBe(original);
  });

  test('an original with NO fenced block accepts the repair but marks it unverified', async () => {
    // The main legitimate use of the repair wave: nothing to compare against.
    const repaired = '```json\n{"overall":"o","findings":[{"id":1,"severity":"major",'
      + '"claim":"c","location":"l","rationale":"r"}]}\n```';
    const { reviews } = await runStage1WithFixture({ original: 'Prose, no block.', repaired });
    expect(reviews[0].conformance).toBe('repaired');
    expect(reviews[0].findingsUnverified).toBe(true);
  });

  test('a CLEAN review is never marked unverified and never count-checked', async () => {
    const ctx = makeCtx({
      models: ['gemini'],
      onWave: (opts) => okWave(opts.models.map(m => mkLeg(m, review(m)))),
      onSolo: () => { throw new Error('no repairs expected'); },
    });
    const { reviews } = await runStage1(ctx);
    expect(reviews[0].conformance).toBe('clean');
    expect(reviews[0].findingsUnverified).toBeUndefined();
    expect('findingsUnverified' in reviews[0]).toBe(false);
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
    // v4.3 Task 3 (spec §7.2): the judge wave carries council attribution.
    expect(waves[0].councilRunId).toBe('abc123');
    expect(waves[0].councilName).toBe('nightly-council');
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
    // v4.3 Task 3 (spec §7.2): the judge-repair solo carries council attribution too.
    expect(solos[0].councilRunId).toBe('abc123');
    expect(solos[0].councilName).toBe('nightly-council');
    const g = judgeResults.find(j => j.judge === 'gemini');
    expect(g.ok).toBe(true);
    expect(g.conformance).toBe('repaired');
  });

  test('LC-12: the judge repair solo carries the judgement it is repairing', async () => {
    // The defect: the repair prompt shipped the validation ERRORS without the
    // JUDGEMENT they were errors about. Stage 2 is the worse place for it — a
    // refused judge has no conformance column, so the tally silently shows fewer
    // votes and a finding's basis counts can flip its tier.
    const badJudge = 'Judged at length in prose, but the trailing JSON never appeared.';
    const solos = [];
    const ctx = makeCtx({
      models: ['gemini', 'gpt'],
      onWave: () => okWave([
        mkLeg('gemini', badJudge),
        mkLeg('gpt', judgeOut(['Review A', 'Review B'], [{ id: 'A1', verdict: 'agree' }])),
      ]),
      onSolo: (opts) => {
        solos.push(opts);
        return okWave([mkLeg('gemini', judgeOut(['Review B', 'Review A'], [{ id: 'B1', verdict: 'agree' }]))]);
      },
    });
    await runStage2(ctx, { reviews: stage1Reviews(), labels, globalFindings });
    expect(solos).toHaveLength(1);
    expect(solos[0].prompt).toContain(badJudge);
    expect(solos[0].prompt).toContain('YOUR PREVIOUS JUDGEMENT');
  });

  test('LC-12: the SECOND judge repair carries the first repair output, which is what failed', async () => {
    const solos = [];
    const badJudge = 'original judging prose, no json';
    const firstRepair = 'first judge repair, still no json';
    const ctx = makeCtx({
      models: ['gemini', 'gpt'],
      onWave: () => okWave([
        mkLeg('gemini', badJudge),
        mkLeg('gpt', judgeOut(['Review A', 'Review B'], [{ id: 'A1', verdict: 'agree' }])),
      ]),
      onSolo: (opts) => {
        solos.push(opts);
        return okWave([mkLeg('gemini', solos.length === 1 ? firstRepair : 'second repair, still no json')]);
      },
    });
    await runStage2(ctx, { reviews: stage1Reviews(), labels, globalFindings });
    expect(solos).toHaveLength(2);
    expect(solos[0].prompt).toContain(badJudge);
    expect(solos[1].prompt).toContain(firstRepair);
    expect(solos[1].prompt).not.toContain(badJudge);
  });

  test('LC-12: a judge repair whose leg came back empty still names the text that failed', async () => {
    const solos = [];
    const badJudge = 'original judging prose, no json';
    const ctx = makeCtx({
      models: ['gemini', 'gpt'],
      onWave: () => okWave([
        mkLeg('gemini', badJudge),
        mkLeg('gpt', judgeOut(['Review A', 'Review B'], [{ id: 'A1', verdict: 'agree' }])),
      ]),
      onSolo: (opts) => { solos.push(opts); return okWave([mkLeg('gemini', '')]); },
    });
    await runStage2(ctx, { reviews: stage1Reviews(), labels, globalFindings });
    expect(solos).toHaveLength(2);
    expect(solos[1].prompt).toContain(badJudge);
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

  test('cost ceiling blocks judge repair: no solo fires, judge ends unstructured', async () => {
    let soloCalls = 0;
    const ctx = makeCtx({
      models: ['gemini', 'gpt'],
      overBudget: () => true,
      onWave: () => okWave([
        mkLeg('gemini', 'no json'),
        mkLeg('gpt', judgeOut(['Review A', 'Review B'], [{ id: 'A1', verdict: 'agree' }])),
      ]),
      onSolo: () => { soloCalls += 1; throw new Error('no repair solos expected over budget'); },
    });
    const { judgeResults } = await runStage2(ctx, { reviews: stage1Reviews(), labels, globalFindings });
    expect(soloCalls).toBe(0);
    const g = judgeResults.find(j => j.judge === 'gemini');
    expect(g.ok).toBe(false);
    expect(g.conformance).toBe('unstructured');
  });

  test('judge leg complete but empty summary: no repair solo fires, ok false unstructured', async () => {
    // Regression: the repair while-loop used to guard only on leg.status === 'complete',
    // so a complete-but-empty-summary leg (nothing to repair FROM) still fired up to 2
    // paid repair solos — inconsistent with Stage-1, where materializeReviews filters
    // empty-summary legs out before repair ever starts.
    let soloCalls = 0;
    const ctx = makeCtx({
      models: ['gemini', 'gpt'],
      onWave: () => okWave([
        mkLeg('gemini', ''),   // status 'complete' (default), summary empty
        mkLeg('gpt', judgeOut(['Review A', 'Review B'], [{ id: 'A1', verdict: 'agree' }])),
      ]),
      onSolo: () => { soloCalls += 1; throw new Error('no repair solos expected for an empty-summary complete leg'); },
    });
    const { judgeResults } = await runStage2(ctx, { reviews: stage1Reviews(), labels, globalFindings });
    expect(soloCalls).toBe(0);
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

  test('date-stamps the judge bundle it writes to bundle-stage2.md (spec §4.3)', async () => {
    const s2 = require('../../src/council/briefings-stage2');
    const ctx = makeCtx({
      models: ['gemini', 'gpt'],
      onWave: () => okWave([
        mkLeg('gemini', judgeOut(['Review B', 'Review A'],
          [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'agree' }])),
        mkLeg('gpt', judgeOut(['Review A', 'Review B'],
          [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'agree' }])),
      ]),
      onSolo: () => { throw new Error('no repairs expected'); },
    });
    await runStage2(ctx, { reviews: stage1Reviews(), labels, globalFindings });
    const bundle = fs.readFileSync(path.join(ctx.o.runDir, 'bundle-stage2.md'), 'utf-8');
    expect(bundle).toContain("Today's date is 2026-07-19.");
    expect(bundle.split('\n')[0]).toBe(s2.JUDGE_NO_TOOLS_PREAMBLE);  // preamble is still line 1
  });
});
