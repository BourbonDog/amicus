// tests/sidecar/fanout-budget.test.js
'use strict';

/**
 * src/sidecar/fanout-budget.js — the wave pre-flight spend gate, lifted out of
 * runFanout §1b so the v4.4 reservation seam had somewhere to live (fanout.js
 * sits 3 lines under the 300-line size gate) and so the gate is testable
 * without standing up model routing.
 *
 * The seam itself is v4.4 cost-council finding 1: `checkBudget` compares the
 * wave's estimate against a maxCost NUMBER that the caller read at some earlier
 * moment. When two waves launch concurrently they both read the same number, so
 * both can pass a ceiling that only one of them fits under. `options.reserveBudget`
 * turns the comparison into an atomic claim against the allowance still unclaimed.
 */

const { preflightBudget } = require('../../src/sidecar/fanout-budget');

// estCost per leg = pricing.prompt * ceil(promptChars/4) + pricing.completion * 4000.
// prompt:0 + completion:$/4000 makes each leg cost exactly `dollars`, and keeps
// perMtok (= dollars/4000 * 1e6 = 250 * dollars) far under the hard $60/Mtok cap.
const leg = (modelInput, dollars) => ({
  modelInput, model: modelInput, ok: true,
  pricing: { prompt: 0, completion: dollars / 4000 },
});

const opts = (over = {}) => ({
  prompt: 'x'.repeat(40), maxCostPerMtok: 1000, ...over,
});

describe('preflightBudget', () => {
  test('passes a wave that fits the ceiling and reports the estimate it used', () => {
    const res = preflightBudget([leg('gpt', 0.02), leg('gemini', 0.03)], opts({ maxCost: 0.10 }));
    expect(res.ok).toBe(true);
    expect(res.estimate).toBeCloseTo(0.05, 8);
  });

  test('refuses a wave whose estimate exceeds the ceiling', () => {
    const res = preflightBudget([leg('gpt', 0.09)], opts({ maxCost: 0.05 }));
    expect(res.ok).toBe(false);
    expect(res.hint).toContain('--max-cost');
  });

  test('noCostGate bypasses the gate AND the reservation (whole-run opt-out)', () => {
    const reserveBudget = jest.fn(() => false);
    const res = preflightBudget([leg('o3', 900)], opts({ maxCost: 0.01, noCostGate: true, reserveBudget }));
    expect(res.ok).toBe(true);
    expect(reserveBudget).not.toHaveBeenCalled();
  });

  test('claims the computed estimate through reserveBudget when one is wired', () => {
    const reserveBudget = jest.fn(() => true);
    const res = preflightBudget([leg('gpt', 0.02), leg('gemini', 0.03)], opts({ maxCost: 1, reserveBudget }));
    expect(res.ok).toBe(true);
    expect(reserveBudget).toHaveBeenCalledTimes(1);
    expect(reserveBudget.mock.calls[0][0]).toBeCloseTo(0.05, 8);
  });

  test('a denied reservation refuses the wave even though the ceiling read passed', () => {
    // This is the concurrency case in miniature: `maxCost` (read before a
    // sibling wave claimed) still says yes; the atomic claim says no.
    const reserveBudget = jest.fn(() => false);
    const res = preflightBudget([leg('gpt', 0.02)], opts({ maxCost: 10, reserveBudget }));
    expect(res.ok).toBe(false);
    expect(res.hint).toMatch(/concurrent|unclaimed/i);
  });

  test('the per-$/Mtok hard threshold is checked BEFORE anything is reserved', () => {
    const reserveBudget = jest.fn(() => true);
    const res = preflightBudget(
      [{ modelInput: 'o3-pro', model: 'o3-pro', ok: true, pricing: { prompt: 0, completion: 80 / 1e6 } }],
      opts({ maxCost: 100, maxCostPerMtok: 60, reserveBudget }),
    );
    expect(res.ok).toBe(false);
    expect(reserveBudget).not.toHaveBeenCalled();
  });

  test('an unpriced wave estimates $0 and never consumes allowance', () => {
    const reserveBudget = jest.fn(() => true);
    const res = preflightBudget(
      [{ modelInput: 'direct', model: 'direct', ok: true, pricing: null }],
      opts({ maxCost: 0.01, reserveBudget }),
    );
    expect(res.ok).toBe(true);
    expect(reserveBudget.mock.calls[0][0]).toBe(0);
  });
});
