'use strict';

/**
 * v4.4.1 CA-1 — child-session spend is ATTRIBUTED to the parent leg.
 *
 * Before this, `subtreeUnknown` was the whole story: a leg that spawned a
 * subagent flagged its total as incomplete and the money ($0.492506 across the
 * four recorded runs) simply never appeared. With enumeration in place
 * (src/sidecar/child-sessions.js) the measured child spend rolls into the run
 * total, and `subtreeUnknown` narrows to what it should always have meant:
 * "there is a subtree here whose cost we could not determine".
 *
 * The rules pinned here:
 *   - the child amount is added to the WAVE total independently of whether the
 *     parent leg's OWN cost resolved. They are two different measurements, and
 *     discarding a known child amount because the parent is unknown would be a
 *     second under-report. `council-wsgate02/wsgate02-s1-3` is exactly that
 *     case: own cost unknown, child session $0.471046.
 *   - the leg's own `cost` block keeps its existing meaning (the leg's own
 *     session), so nothing downstream silently changes what it is reading.
 *   - a subtree we could not price is `unknown`, never zero.
 */

const { resolveUsage, sumWaveUsage, formatCost } = require('../../src/utils/pricing');
const { createBudget } = require('../../src/council/run-budget');

const tokens = (input, output) => ({ input, output, reasoning: 0, cacheRead: 0, cacheWrite: 0 });

describe('resolveUsage attaches the measured subtree to the parent leg', () => {
  test('a priced subtree rides alongside the leg\'s own cost, not inside it', () => {
    const u = resolveUsage({
      model: 'x/y',
      usageTotals: { tokens: tokens(1000, 100), costReported: 0.05 },
      subtree: { sessions: 1, tokens: tokens(900, 90), costReported: 0.021460 },
    });
    // The leg's OWN cost is untouched — every existing reader keeps its meaning.
    expect(u.cost).toEqual({ amount: 0.05, currency: 'USD', source: 'reported' });
    expect(u.subtree.sessions).toBe(1);
    expect(u.subtree.cost).toEqual({ amount: 0.021460, currency: 'USD', source: 'reported' });
    expect(u.subtree.tokens.input).toBe(900);
    expect(u.subtreeUnknown).toBeUndefined();
  });

  test('a leg with no children carries no subtree block at all (byte-identical usage)', () => {
    const plain = resolveUsage({ model: 'x/y', usageTotals: { tokens: tokens(10, 2), costReported: 0.01 } });
    const withEmpty = resolveUsage({
      model: 'x/y', usageTotals: { tokens: tokens(10, 2), costReported: 0.01 },
      subtree: { sessions: 0, tokens: tokens(0, 0), costReported: 0 },
    });
    expect(withEmpty).toEqual(plain);
    expect(plain.subtree).toBeUndefined();
  });

  test('children found but none priced: the subtree cost is UNKNOWN, never $0', () => {
    const u = resolveUsage({
      model: 'x/y', usageTotals: { tokens: tokens(10, 2), costReported: 0.01 },
      subtree: { sessions: 2, tokens: tokens(0, 0), costReported: 0 },
      subtreeUnknown: true,
    });
    expect(u.subtree.cost).toEqual({ amount: null, currency: 'USD', source: 'unknown' });
    expect(formatCost(u.subtree.cost)).toBe('?');
    expect(u.subtreeUnknown).toBe(true);
  });

  test('subtreeUnknown and a measured subtree can coexist — a partial walk', () => {
    // One child priced, another unreachable: bank what we measured, flag the rest.
    const u = resolveUsage({
      model: 'x/y', usageTotals: { tokens: tokens(10, 2), costReported: 0.01 },
      subtree: { sessions: 2, tokens: tokens(50, 5), costReported: 0.03 },
      subtreeUnknown: true,
    });
    expect(u.subtree.cost.amount).toBeCloseTo(0.03, 10);
    expect(u.subtreeUnknown).toBe(true);
  });
});

describe('sumWaveUsage rolls child spend into the run total', () => {
  const legWith = (own, subtreeCost, extra = {}) => ({
    usage: resolveUsage({
      model: 'x/y',
      usageTotals: { tokens: tokens(100, 10), costReported: own },
      subtree: subtreeCost === null ? undefined
        : { sessions: 1, tokens: tokens(50, 5), costReported: subtreeCost },
      ...extra,
    }),
  });

  test('THE HEADLINE: the wave total now includes the child session', () => {
    const w = sumWaveUsage([legWith(0.28211, null), legWith(0, 0.021460)]);
    // 0.28211 (leg 1, own) + 0 (leg 2 own is $0-reported -> estimated) + 0.02146 (child)
    expect(w.cost.subtreeCost).toBeCloseTo(0.021460, 10);
    expect(w.cost.subtreeSessions).toBe(1);
    expect(w.cost.amount).toBeCloseTo(0.28211 + 0.021460, 8);
  });

  test('a child amount survives a parent whose OWN cost is unknown (wsgate02-s1-3)', () => {
    // The leg observed no tokens at all, so its own cost is `unknown` (B2) —
    // but its child session was measured at $0.471046 and must not be lost.
    const orphan = {
      usage: resolveUsage({
        model: 'x/y',
        usageTotals: { tokens: tokens(0, 0), costReported: 0 },
        subtree: { sessions: 1, tokens: tokens(9000, 900), costReported: 0.471046 },
        subtreeUnknown: false,
      }),
    };
    expect(orphan.usage.cost.source).toBe('unknown');
    const w = sumWaveUsage([orphan]);
    expect(w.cost.unpricedLegs).toBe(1);              // the leg itself is still unknown
    expect(w.cost.amount).toBeCloseTo(0.471046, 10);  // …and the child is still banked
    expect(w.cost.subtreeCost).toBeCloseTo(0.471046, 10);
  });

  test('an unpriced subtree adds nothing and keeps counting as unknown', () => {
    const leg = {
      usage: resolveUsage({
        model: 'x/y', usageTotals: { tokens: tokens(100, 10), costReported: 0.02 },
        subtree: { sessions: 1, tokens: tokens(0, 0), costReported: 0 }, subtreeUnknown: true,
      }),
    };
    const w = sumWaveUsage([leg]);
    expect(w.cost.amount).toBeCloseTo(0.02, 10);
    expect(w.cost.subtreeCost).toBe(0);
    expect(w.cost.subtreeUnknownLegs).toBe(1);
  });

  test('legs with no subtree at all leave the counters at zero', () => {
    const w = sumWaveUsage([legWith(0.01, null), legWith(0.02, null)]);
    expect(w.cost.subtreeCost).toBe(0);
    expect(w.cost.subtreeSessions).toBe(0);
    expect(w.cost.subtreeUnknownLegs).toBe(0);
  });
});

describe('costExact can now be earned rather than only lost', () => {
  test('a leg whose subtree was fully enumerated does NOT spoil costExact', () => {
    const legs = [{
      usage: resolveUsage({
        model: 'x/y', usageTotals: { tokens: tokens(100, 10), costReported: 0.28211 },
        subtree: { sessions: 1, tokens: tokens(50, 5), costReported: 0.021460 },
      }),
    }];
    const b = createBudget({ allLegs: legs, maxCost: null, write: () => {} });
    const block = b.usageBlock();
    expect(block.costExact).toBe(true);
    expect(block.subtreeUnknownLegs).toBe(0);
    // wsgate01's real numbers: this is the run that reported costExact while
    // $0.0215 short. Both halves are now in the total.
    expect(block.cost.amount).toBeCloseTo(0.303570, 6);
  });

  test('an undeterminable subtree still spoils it, and still says so on stderr', () => {
    const out = [];
    const legs = [{
      usage: resolveUsage({
        model: 'x/y', usageTotals: { tokens: tokens(100, 10), costReported: 0.28211 },
        subtree: { sessions: 1, tokens: tokens(0, 0), costReported: 0 }, subtreeUnknown: true,
      }),
    }];
    const b = createBudget({ allLegs: legs, maxCost: null, write: (s) => out.push(s) });
    expect(b.usageBlock().costExact).toBe(false);
    b.noticeUnknownSpend();
    expect(out.join('')).toMatch(/CHILD session/i);
  });
});
