'use strict';

const tiers = require('../../src/utils/model-tiers');

describe('model-tiers exports TIER_ORDER (deriveChain prerequisite)', () => {
  test('TIER_ORDER is exported as the cheapest->most-capable order', () => {
    expect(Array.isArray(tiers.TIER_ORDER)).toBe(true);
    expect(tiers.TIER_ORDER).toEqual(['economy', 'balanced', 'frontier']);
  });

  test('every TIER_ORDER entry is a key of each vendor tier table', () => {
    for (const vendor of Object.keys(tiers.TIERS)) {
      for (const tier of tiers.TIER_ORDER) {
        expect(Object.keys(tiers.TIERS[vendor])).toContain(tier);
      }
    }
  });

  test('the reversed order is most->least capable (what deriveChain walks)', () => {
    expect([...tiers.TIER_ORDER].reverse()).toEqual(['frontier', 'balanced', 'economy']);
  });
});
