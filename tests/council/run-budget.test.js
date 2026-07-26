// tests/council/run-budget.test.js
'use strict';

/**
 * Direct unit coverage for src/council/run-budget.js — the v4.4 budget position
 * extracted out of src/council/run.js (which sits on the 300-line size gate).
 * tests/council/run-cost-unknown.test.js drives the same behaviour end-to-end
 * through runCouncil; this file pins the primitives in isolation, including the
 * cases a scripted driver test cannot easily reach (no ceiling at all, a ceiling
 * of exactly 0, a leg with no usage block).
 */

const { createBudget } = require('../../src/council/run-budget');

const priced = (amount) => ({ usage: { tokens: { input: 10, output: 5 }, cost: { amount, currency: 'USD', source: 'reported' } } });
const unknown = () => ({ usage: { tokens: { input: 0, output: 0 }, cost: { amount: null, currency: 'USD', source: 'unknown' } } });

function mk(legs, maxCost) {
  const out = [];
  const b = createBudget({ allLegs: legs, maxCost, write: (s) => out.push(s) });
  return { ...b, written: () => out.join('') };
}

describe('spendState', () => {
  test('known is the sum of resolved amounts; unknown legs are counted, not guessed', () => {
    const b = mk([priced(0.02), priced(0.03), unknown()], null);
    expect(b.spendState().known).toBeCloseTo(0.05, 8);
    expect(b.spendState().unknownLegs).toBe(1);
    expect(b.spendState().cost.source).toBe('mixed');
  });

  test('an all-unknown run reports known 0 — never a negative or invented figure', () => {
    const b = mk([unknown(), unknown()], null);
    expect(b.spendState().known).toBe(0);
    expect(b.spendState().unknownLegs).toBe(2);
    expect(b.spendState().cost.amount).toBeNull();
  });

  test('a leg with no usage block at all counts as unknown', () => {
    const b = mk([{}, priced(0.01)], null);
    expect(b.spendState().unknownLegs).toBe(1);
  });

  test('reads the live array — legs pushed after construction are included', () => {
    const legs = [];
    const b = mk(legs, null);
    expect(b.spent()).toBe(0);
    legs.push(priced(0.25));
    expect(b.spent()).toBeCloseTo(0.25, 8);
  });
});

describe('overBudget trips on KNOWN spend only (the owner\'s ruling)', () => {
  test('no ceiling → never over budget, whatever was spent', () => {
    expect(mk([priced(99)], null).overBudget()).toBe(false);
    expect(mk([priced(99)], undefined).overBudget()).toBe(false);
  });

  test('known spend at or above the ceiling trips', () => {
    expect(mk([priced(0.75)], 0.75).overBudget()).toBe(true);
    expect(mk([priced(0.76)], 0.75).overBudget()).toBe(true);
    expect(mk([priced(0.74)], 0.75).overBudget()).toBe(false);
  });

  test('unknown legs cannot trip it — the run keeps going, loudly', () => {
    const b = mk([unknown(), unknown(), unknown()], 0.01);
    expect(b.overBudget()).toBe(false);
    b.noticeUnknownSpend();
    expect(b.written()).toMatch(/UNKNOWN/);
  });
});

describe('remainingBudget feeds the fanout pre-flight estimate', () => {
  test('ceiling minus known spend', () => {
    expect(mk([priced(0.25)], 1).remainingBudget()).toBeCloseTo(0.75, 8);
  });
  test('floored at 0, never negative', () => {
    expect(mk([priced(2)], 1).remainingBudget()).toBe(0);
  });
  test('null when no ceiling is set (run-launch omits maxCost entirely)', () => {
    expect(mk([priced(2)], null).remainingBudget()).toBeNull();
    expect(mk([priced(2)], undefined).remainingBudget()).toBeNull();
  });
  test('unknown legs do not consume the allowance (they contribute no known spend)', () => {
    expect(mk([unknown(), unknown()], 1).remainingBudget()).toBeCloseTo(1, 8);
  });
});

describe('noticeUnknownSpend', () => {
  test('silent when every leg is priced', () => {
    const b = mk([priced(0.01)], 1);
    b.noticeUnknownSpend();
    expect(b.written()).toBe('');
  });

  test('names the count, the known total, the ceiling, and says spend is HIGHER', () => {
    const b = mk([priced(0.372), unknown(), unknown(), unknown()], 0.75);
    b.noticeUnknownSpend();
    const t = b.written();
    expect(t).toMatch(/3 council leg\(s\)/);
    expect(t).toMatch(/\$0\.3720/);
    expect(t).toMatch(/\$0\.75 --max-cost/);
    expect(t).toMatch(/HIGHER/);
  });

  test('omits the ceiling clause when no ceiling is set', () => {
    const b = mk([unknown()], null);
    b.noticeUnknownSpend();
    expect(b.written()).toMatch(/UNKNOWN/);
    expect(b.written()).not.toMatch(/--max-cost/);
  });

  test('fires at most once per run', () => {
    const b = mk([unknown()], 1);
    b.noticeUnknownSpend();
    b.noticeUnknownSpend();
    b.noticeUnknownSpend();
    expect((b.written().match(/UNKNOWN/g) || [])).toHaveLength(1);
  });
});

describe('usageBlock is what run.json publishes', () => {
  test('costExact false + unknownLegs when anything is unpriced', () => {
    const u = mk([priced(0.372), unknown()], 0.75).usageBlock();
    expect(u.costExact).toBe(false);
    expect(u.unknownLegs).toBe(1);
    expect(u.cost.amount).toBeCloseTo(0.372, 8);
    // The underlying rollup counters are preserved for readers that want them.
    expect(u.cost.unpricedLegs).toBe(1);
  });

  test('costExact true for a fully priced run', () => {
    const u = mk([priced(0.372), priced(0.1)], null).usageBlock();
    expect(u.costExact).toBe(true);
    expect(u.unknownLegs).toBe(0);
  });

  test('a run with no legs at all is exact (nothing unknown because nothing ran)', () => {
    const u = mk([], null).usageBlock();
    expect(u.costExact).toBe(true);
    expect(u.unknownLegs).toBe(0);
    expect(u.cost.amount).toBeNull();
  });
});
