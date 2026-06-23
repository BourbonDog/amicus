// tests/council/tally.test.js
'use strict';
const { assignTier } = require('../../src/council/tally');
const { computeStreetCred } = require('../../src/council/tally');

describe('assignTier (peers-only cascade)', () => {
  const cases = [
    [2, 0, 'Confirmed', 'solid'],
    [3, 1, 'Confirmed', 'solid'],
    [0, 2, 'Disputed', 'solid'],
    [1, 2, 'Disputed', 'solid'],
    [1, 1, 'Contested', 'solid'],
    [0, 1, 'Contested', 'thin'],
    [1, 0, 'Singleton', 'thin'],
    [0, 0, 'Singleton', 'thin'],
    [2, 2, 'Contested', 'solid'], // large-bench tie → Contested
  ];
  test.each(cases)('a=%i d=%i → %s/%s', (a, d, tier, confidence) => {
    expect(assignTier(a, d)).toEqual({ tier, confidence });
  });
});

describe('computeStreetCred', () => {
  test('withSelf differs from peersOnly when self-rank differs', () => {
    // X ranks itself #1 but peers rank it #3; Y and Z rank X last.
    const rankings = [
      { judge: 'X', order: ['X', 'Y', 'Z'] },
      { judge: 'Y', order: ['Y', 'Z', 'X'] },
      { judge: 'Z', order: ['Z', 'Y', 'X'] },
    ];
    const sc = computeStreetCred(rankings, ['X', 'Y', 'Z']);
    const x = sc.find(s => s.model === 'X');
    expect(x.withSelf).toBeCloseTo((1 + 3 + 3) / 3); // 2.333
    expect(x.peersOnly).toBeCloseTo((3 + 3) / 2);    // 3.0
    expect(x.withSelf).not.toBeCloseTo(x.peersOnly);
  });

  test('fractional ranking for a tie group', () => {
    const rankings = [{ judge: 'X', order: [['A', 'B'], 'C'] }];
    const sc = computeStreetCred(rankings, ['A', 'B', 'C']);
    expect(sc.find(s => s.model === 'A').withSelf).toBeCloseTo(1.5);
    expect(sc.find(s => s.model === 'B').withSelf).toBeCloseTo(1.5);
    expect(sc.find(s => s.model === 'C').withSelf).toBeCloseTo(3);
  });

  test('peersOnly is null when there are no peers (single judge ranks only self)', () => {
    const rankings = [{ judge: 'A', order: ['A'] }];
    const sc = computeStreetCred(rankings, ['A']);
    expect(sc[0].withSelf).toBe(1);
    expect(sc[0].peersOnly).toBeNull();
  });

  test('a model that casts no ranking has withSelf === peersOnly', () => {
    // Claude is reviewed (in models + others rank it) but never judges.
    const rankings = [
      { judge: 'X', order: ['X', 'claude'] },
      { judge: 'Y', order: ['claude', 'Y'] },
    ];
    const sc = computeStreetCred(rankings, ['X', 'Y', 'claude']);
    const c = sc.find(s => s.model === 'claude');
    expect(c.withSelf).toBeCloseTo((2 + 1) / 2);
    expect(c.peersOnly).toBeCloseTo(c.withSelf);
  });
});
