// tests/council/budget-reservation.test.js
'use strict';

/**
 * v4.4 cost-council finding 1 — THE CONCURRENT BUDGET PREFLIGHT WAS NOT
 * CONCURRENCY-SAFE.
 *
 * `launchStage1()` builds the seat wave and the critic wave concurrently under
 * one `Promise.all`. Each launcher called `remainingBudget()` BEFORE either
 * wave's legs had been appended to `allLegs`, so both observed the full,
 * unreduced allowance and both could pass a soft gate that, taken together,
 * exceeded `--max-cost`. Only run.js's post-Stage-1 `overBudget()` noticed —
 * after the money was already committed. That is a hole in the code added in
 * 21eefa2 to CLOSE the ceiling.
 *
 * THE FIX is a reservation, not a quota split. `reserveBudget(waveId, estimate)`
 * is a SYNCHRONOUS read-and-claim against the allowance not already claimed by a
 * concurrently launching sibling. Because it is synchronous, the JS event loop
 * cannot interleave two callers inside it — the second caller necessarily
 * observes the first caller's claim. A quota split was rejected because it is
 * strictly more refusing than the ceiling requires (a cheap 3-seat wave plus an
 * expensive critic can fit a ceiling that neither proportional share admits),
 * and the owner's standing ruling is fail LOUD, not fail CLOSED.
 *
 * WHEN A WAVE IS REFUSED the run CONTINUES with a partial bench — never rolls
 * back paid work, never aborts — and the refusal is recorded on run.json,
 * announced on stderr, and degrades the run's exit code. See the partial-bench
 * describe block at the bottom.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { createBudget } = require('../../src/council/run-budget');
const { createLaunchers } = require('../../src/council/run-launch');
const { preflightBudget } = require('../../src/sidecar/fanout-budget');
const { runStage1 } = require('../../src/council/run-stages');

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'council-reserve-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const priced = (amount) => ({
  usage: { tokens: { input: 10, output: 5 }, cost: { amount, currency: 'USD', source: 'reported' } },
});

// ---------------------------------------------------------------------------
// 1. The primitive
// ---------------------------------------------------------------------------
describe('reserveBudget is an atomic claim on the UNCLAIMED allowance', () => {
  const mk = (maxCost, legs = []) => createBudget({ allLegs: legs, maxCost, write: () => {} });

  test('a reservation reduces what the next caller can see', () => {
    const b = mk(1.00);
    expect(b.remainingBudget()).toBeCloseTo(1.00, 8);
    expect(b.reserveBudget('w1', 0.60)).toBe(true);
    expect(b.remainingBudget()).toBeCloseTo(0.40, 8);
  });

  test('two claims that together exceed the ceiling: the second is refused', () => {
    const b = mk(1.00);
    expect(b.reserveBudget('w1', 0.60)).toBe(true);
    expect(b.reserveBudget('w2', 0.60)).toBe(false);
    // The refused claim consumed nothing — a later, smaller wave still fits.
    expect(b.remainingBudget()).toBeCloseTo(0.40, 8);
    expect(b.reserveBudget('w3', 0.40)).toBe(true);
  });

  test('claims that fit are all admitted (not stricter than the ceiling)', () => {
    const b = mk(1.00);
    expect(b.reserveBudget('w1', 0.30)).toBe(true);
    expect(b.reserveBudget('w2', 0.30)).toBe(true);
    expect(b.reserveBudget('w3', 0.30)).toBe(true);
    expect(b.remainingBudget()).toBeCloseTo(0.10, 8);
  });

  test('reservations stack on top of KNOWN spend already recorded', () => {
    const legs = [priced(0.50)];
    const b = mk(1.00, legs);
    expect(b.remainingBudget()).toBeCloseTo(0.50, 8);
    expect(b.reserveBudget('w1', 0.60)).toBe(false);
    expect(b.reserveBudget('w1', 0.50)).toBe(true);
  });

  test('a $0 claim is always admitted — an unpriced wave never blocks a run', () => {
    const b = mk(0.01);
    expect(b.reserveBudget('w1', 0.01)).toBe(true);
    expect(b.remainingBudget()).toBe(0);
    // Owner's ruling: unknown/unpriced cost must not stop real work.
    expect(b.reserveBudget('w2', 0)).toBe(true);
    expect(b.reserveBudget('w3', null)).toBe(true);
    expect(b.reserveBudget('w4', undefined)).toBe(true);
    expect(b.reserveBudget('w5', NaN)).toBe(true);
  });

  test('with NO ceiling every claim is admitted and nothing is tracked', () => {
    const b = mk(null);
    expect(b.reserveBudget('w1', 9999)).toBe(true);
    expect(b.remainingBudget()).toBeNull();
  });

  test('addWave converts a reservation into real spend (no double-count)', () => {
    const legs = [];
    const b = createBudget({ allLegs: legs, maxCost: 1.00, write: () => {} });
    b.reserveBudget('w1', 0.60);
    expect(b.remainingBudget()).toBeCloseTo(0.40, 8);
    b.addWave({ waveId: 'w1', legs: [priced(0.12)] });
    // The estimate is gone; the MEASURED $0.12 is what remains against the ceiling.
    expect(b.spent()).toBeCloseTo(0.12, 8);
    expect(b.remainingBudget()).toBeCloseTo(0.88, 8);
    expect(legs).toHaveLength(1);
  });

  test('addWave tolerates a null wave and a wave with no legs', () => {
    const b = mk(1.00);
    expect(() => b.addWave(null)).not.toThrow();
    expect(() => b.addWave({ waveId: 'w1' })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 2. The proof: two CONCURRENT launchers cannot both over-reserve
// ---------------------------------------------------------------------------
/**
 * The fake transport is a faithful stand-in for runFanout's §1b: it awaits (the
 * real transport resolves model routing asynchronously — that await is exactly
 * the window the defect lived in) and then runs the REAL preflightBudget over
 * the REAL createLaunchers wiring. Only the network is fake.
 */
function transport({ dollarsPerLeg, launchLog }) {
  return async (o) => {
    await new Promise((r) => setImmediate(r));   // routing/validation latency
    const models = o.models.split(',');
    const legs = models.map((m) => ({
      modelInput: m, model: m, ok: true,
      pricing: { prompt: 0, completion: dollarsPerLeg / 4000 },
    }));
    const pre = preflightBudget(legs, { ...o, maxCostPerMtok: 1000 });
    if (!pre.ok) {
      launchLog.push({ waveId: o.waveId, refused: true, estimate: models.length * dollarsPerLeg });
      return { wave: null, errorDoc: { code: 'BUDGET_EXCEEDED', message: pre.message }, exitCode: 1 };
    }
    launchLog.push({ waveId: o.waveId, refused: false, estimate: pre.estimate });
    return {
      wave: { waveId: o.waveId, status: 'complete', legs: models.map(() => priced(dollarsPerLeg)) },
      exitCode: 0,
    };
  };
}

describe('two concurrent launchers cannot both pass a gate only one fits', () => {
  test('the classic case: $0.06 + $0.06 against a $0.10 ceiling', async () => {
    const launchLog = [];
    const budget = createBudget({ allLegs: [], maxCost: 0.10, write: () => {} });
    const launchers = createLaunchers({
      fanoutFn: transport({ dollarsPerLeg: 0.06, launchLog }),
      remainingBudget: budget.remainingBudget,
      reserveBudget: budget.reserveBudget,
    });

    const results = await Promise.all([
      launchers.launchWave({ models: ['gpt'], prompt: 'p', project: tmp, waveId: 'r-s1' }),
      launchers.launchWave({ models: ['kimi'], prompt: 'p', project: tmp, waveId: 'r-c1' }),
    ]);

    const admitted = launchLog.filter((l) => !l.refused);
    expect(admitted).toHaveLength(1);
    expect(launchLog.filter((l) => l.refused)).toHaveLength(1);
    // THE INVARIANT: everything admitted fits under the ceiling, together.
    const claimed = admitted.reduce((s, l) => s + l.estimate, 0);
    expect(claimed).toBeLessThanOrEqual(0.10 + 1e-9);
    expect(results.filter((r) => r.exitCode === 1)).toHaveLength(1);
  });

  test('both launch when both genuinely fit (the gate is not made stricter)', async () => {
    const launchLog = [];
    const budget = createBudget({ allLegs: [], maxCost: 0.10, write: () => {} });
    const launchers = createLaunchers({
      fanoutFn: transport({ dollarsPerLeg: 0.04, launchLog }),
      remainingBudget: budget.remainingBudget,
      reserveBudget: budget.reserveBudget,
    });

    await Promise.all([
      launchers.launchWave({ models: ['gpt', 'gemini'], prompt: 'p', project: tmp, waveId: 'r-s1' }),
    ]);
    // A 2-leg $0.08 wave plus a 1-leg $0.04 critic would BOTH be refused by a
    // proportional quota split; the reservation admits the pair that fits.
    const b2 = createBudget({ allLegs: [], maxCost: 0.10, write: () => {} });
    const log2 = [];
    const l2 = createLaunchers({
      fanoutFn: transport({ dollarsPerLeg: 0.03, launchLog: log2 }),
      remainingBudget: b2.remainingBudget, reserveBudget: b2.reserveBudget,
    });
    await Promise.all([
      l2.launchWave({ models: ['a', 'b'], prompt: 'p', project: tmp, waveId: 'q-s1' }),
      l2.launchWave({ models: ['c'], prompt: 'p', project: tmp, waveId: 'q-c1' }),
    ]);
    expect(log2.filter((l) => l.refused)).toHaveLength(0);
  });

  test('property: for ANY set of concurrent waves, admitted spend never exceeds the ceiling', async () => {
    for (let trial = 0; trial < 40; trial++) {
      const ceiling = 0.05 + (trial % 7) * 0.05;
      const launchLog = [];
      const budget = createBudget({ allLegs: [], maxCost: ceiling, write: () => {} });
      const launchers = createLaunchers({
        fanoutFn: transport({ dollarsPerLeg: 0.02 + (trial % 5) * 0.01, launchLog }),
        remainingBudget: budget.remainingBudget,
        reserveBudget: budget.reserveBudget,
      });
      const waveSizes = [1, 2, 3, 1, 2].slice(0, 2 + (trial % 4));
      await Promise.all(waveSizes.map((n, i) => launchers.launchWave({
        models: Array.from({ length: n }, (_, k) => `m${i}${k}`),
        prompt: 'p', project: tmp, waveId: `t${trial}-w${i}`,
      })));
      const claimed = launchLog.filter((l) => !l.refused).reduce((s, l) => s + l.estimate, 0);
      expect(claimed).toBeLessThanOrEqual(ceiling + 1e-9);
    }
  });

  test('without a reserveBudget seam the pre-fix over-reservation is reproducible', async () => {
    // Same two waves, same ceiling, but wired the pre-fix way (a plain
    // remainingBudget READ and no claim). Both pass — this is the defect, kept
    // as an executable statement of what the reservation buys.
    const launchLog = [];
    const budget = createBudget({ allLegs: [], maxCost: 0.10, write: () => {} });
    const launchers = createLaunchers({
      fanoutFn: transport({ dollarsPerLeg: 0.06, launchLog }),
      remainingBudget: budget.remainingBudget,
    });
    await Promise.all([
      launchers.launchWave({ models: ['gpt'], prompt: 'p', project: tmp, waveId: 'r-s1' }),
      launchers.launchWave({ models: ['kimi'], prompt: 'p', project: tmp, waveId: 'r-c1' }),
    ]);
    expect(launchLog.filter((l) => !l.refused)).toHaveLength(2);
    expect(launchLog.reduce((s, l) => s + l.estimate, 0)).toBeCloseTo(0.12, 8); // 120% of $0.10
  });
});

// ---------------------------------------------------------------------------
// 3. The policy: a refused wave is a LOUD partial bench, never a silent one
// ---------------------------------------------------------------------------
describe('a budget-refused wave is never silently dropped', () => {
  test('the launcher reports the refusal to its onBudgetRefusal sink', async () => {
    const refusals = [];
    const launchers = createLaunchers({
      fanoutFn: async () => ({ wave: null, errorDoc: { code: 'BUDGET_EXCEEDED', message: 'nope' }, exitCode: 1 }),
      onBudgetRefusal: (r) => refusals.push(r),
    });
    const { wave, errorDoc } = await launchers.launchWave({
      models: ['kimi'], prompt: 'p', project: tmp, waveId: 'r-c1',
    });
    expect(wave).toBeNull();
    expect(errorDoc.code).toBe('BUDGET_EXCEEDED');
    expect(refusals).toEqual([expect.objectContaining({ waveId: 'r-c1', models: ['kimi'] })]);
  });

  test('a NON-budget failure is not misreported as a budget refusal', async () => {
    const refusals = [];
    const launchers = createLaunchers({
      fanoutFn: async () => ({ wave: null, errorDoc: { code: 'BAD_ARGS', message: 'x' }, exitCode: 1 }),
      onBudgetRefusal: (r) => refusals.push(r),
    });
    await launchers.launchWave({ models: ['kimi'], prompt: 'p', project: tmp, waveId: 'r-c1' });
    expect(refusals).toHaveLength(0);
  });

  test('noteBudgetRefusal shouts on stderr and keeps a durable record', () => {
    const out = [];
    const b = createBudget({ allLegs: [], maxCost: 0.10, write: (s) => out.push(s) });
    b.noteBudgetRefusal({ waveId: 'r-c1', models: ['kimi'] });
    const text = out.join('');
    expect(text).toContain('r-c1');
    expect(text).toContain('kimi');
    expect(text).toMatch(/max-cost|ceiling/i);
    expect(text).toMatch(/did not launch|never launched|refused/i);
    expect(b.budgetRefusals()).toEqual([expect.objectContaining({ waveId: 'r-c1', models: ['kimi'] })]);
  });

  test('every refusal is announced — the notice is not sticky', () => {
    const out = [];
    const b = createBudget({ allLegs: [], maxCost: 0.10, write: (s) => out.push(s) });
    b.noteBudgetRefusal({ waveId: 'r-c1', models: ['kimi'] });
    b.noteBudgetRefusal({ waveId: 'r-q1', models: ['grok'] });
    expect(out).toHaveLength(2);
    expect(b.budgetRefusals()).toHaveLength(2);
  });

  test('a refusal degrades the run — it can never exit 0 with a shrunken bench', () => {
    const degraded = { value: false };
    const b = createBudget({ allLegs: [], maxCost: 0.10, degraded, write: () => {} });
    expect(degraded.value).toBe(false);
    b.noteBudgetRefusal({ waveId: 'r-c1', models: ['kimi'] });
    expect(degraded.value).toBe(true);
  });

  test('refusals are persisted to run.json when a runDir is wired', () => {
    const runDir = path.join(tmp, 'council-abc');
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify({ runId: 'abc', status: 'running' }));
    const b = createBudget({ allLegs: [], maxCost: 0.10, runDir, write: () => {} });
    b.noteBudgetRefusal({ waveId: 'abc-c1', models: ['kimi'] });
    const run = JSON.parse(fs.readFileSync(path.join(runDir, 'run.json'), 'utf-8'));
    expect(run.budgetRefusals).toEqual([expect.objectContaining({ waveId: 'abc-c1', models: ['kimi'] })]);
  });

  test('Stage 1 continues with a partial bench when the critic wave is refused', async () => {
    const runDir = path.join(tmp, 'council-xyz');
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify({ runId: 'xyz', status: 'running', stages: [] }));
    const out = [];
    const budget = createBudget({ allLegs: [], maxCost: 0.10, runDir, write: (s) => out.push(s) });
    const review = (n) => `Review ${n}.\n\n\`\`\`json\n${JSON.stringify({
      overall: 'take',
      findings: [{ id: 1, severity: 'major', claim: `c-${n}`, location: 'l', rationale: 'r' }],
    })}\n\`\`\`\n`;
    const launchers = createLaunchers({
      fanoutFn: async (o) => {
        if (o.waveId.endsWith('-c1')) {
          return { wave: null, errorDoc: { code: 'BUDGET_EXCEEDED', message: 'no room' }, exitCode: 1 };
        }
        return {
          wave: { waveId: o.waveId, status: 'complete',
            legs: o.models.split(',').map((m) => ({ taskId: `${m}-leg`, model: m, modelInput: m,
              status: 'complete', summary: review(m), durationMs: 1, ...priced(0.01) })) },
          exitCode: 0,
        };
      },
      remainingBudget: budget.remainingBudget,
      reserveBudget: budget.reserveBudget,
      onBudgetRefusal: budget.noteBudgetRefusal,
    });
    const ctx = {
      o: { briefing: 'm', models: ['gpt', 'gemini', 'kimi'], critic: 'kimi', lenses: null,
        chair: 'deepseek', runId: 'xyz', runDir, date: '2026-07-26', councilName: null },
      launchers, addWave: budget.addWave, overBudget: budget.overBudget,
      scratchDir: path.join(runDir, '_scratch'),
    };

    const s1 = await runStage1(ctx);

    // CONTINUE, not abort and not roll back: the two paid seat reviews survive.
    expect(s1.aborted).toBeNull();
    expect(s1.reviews.map((r) => r.model)).toEqual(['gpt', 'gemini']);
    // ...and the missing critic is impossible to miss.
    expect(budget.budgetRefusals()).toHaveLength(1);
    expect(out.join('')).toContain('xyz-c1');
    const run = JSON.parse(fs.readFileSync(path.join(runDir, 'run.json'), 'utf-8'));
    expect(run.budgetRefusals[0].models).toEqual(['kimi']);
  });
});
