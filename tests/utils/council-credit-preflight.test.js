// tests/utils/council-credit-preflight.test.js
'use strict';

/**
 * #256: the CI credit preflight's DECISION, unit-tested away from the network.
 *
 * The incident (run 35143585179, 2026-09-16): the OpenRouter key's remaining
 * monthly limit was below the run's own `--max-cost` ceiling, so four of seven
 * legs were refused by the provider in 2–3 s, the once-only retries were
 * consumed by those refusals, and the round lost quorum for $0.003. Nothing in
 * `.github/workflows/council-review.yml` asked the key what it could afford.
 *
 * The workflow step is a shell heredoc and cannot be unit-tested; the ruling it
 * makes can be, so the ruling lives here as a pure function and the step only
 * prints its answer.
 */

const { decideCreditPreflight } = require('../../src/utils/council-credit-preflight');

/** The probe's `none` shape — every failure path of checkOpenRouterCredit. */
const UNCHECKED = {
  checked: false, warning: null, isFreeTier: false,
  limitRemaining: null, limit: null, usage: null,
};
const checked = (over = {}) => ({
  checked: true, warning: null, isFreeTier: false,
  limitRemaining: null, limit: null, usage: null, ...over,
});

describe('#256 decideCreditPreflight', () => {
  describe('warn — the probe could not answer, and a blip must never block a review', () => {
    test('checked:false warns and names a reason, never refuses', () => {
      const d = decideCreditPreflight(UNCHECKED, 2);
      expect(d.outcome).toBe('warn');
      expect(d.message).toMatch(/^OpenRouter credit could not be checked — .+; continuing$/);
    });

    test('a null/undefined/garbage result is the same warn, not a crash', () => {
      for (const r of [null, undefined, 'nope', 42, {}]) {
        const d = decideCreditPreflight(r, 2);
        expect(d.outcome).toBe('warn');
        expect(d.message).toContain('could not be checked');
      }
    });

    test('an unusable run ceiling warns rather than comparing against NaN', () => {
      // Number('') is 0 and Number('x') is NaN — both make `limitRemaining <
      // maxCost` FALSE, i.e. a silent pass. The comparison that cannot be made
      // is announced instead.
      for (const bad of ['', '   ', 'x', null, undefined, NaN, 0, -1, Infinity]) {
        const d = decideCreditPreflight(checked({ limitRemaining: 0.42 }), bad);
        expect(d.outcome).toBe('warn');
        expect(d.message).toContain('run ceiling');
      }
    });
  });

  describe('refuse — zero spend, loud', () => {
    test('a free-tier key is refused whatever the limit says', () => {
      const d = decideCreditPreflight(checked({ isFreeTier: true }), 2);
      expect(d.outcome).toBe('refuse');
      expect(d.message).toContain('OpenRouter key cannot cover this run');
      expect(d.message).toContain('free tier');
      expect(d.message).toContain('no seat was dispatched');
    });

    test('free tier is decided BEFORE the ceiling, so a bad ceiling cannot mask it', () => {
      const d = decideCreditPreflight(checked({ isFreeTier: true }), '');
      expect(d.outcome).toBe('refuse');
    });

    test('a remaining limit below the run ceiling is refused, naming both figures', () => {
      const d = decideCreditPreflight(checked({ limitRemaining: 0.42 }), '2.00');
      expect(d.outcome).toBe('refuse');
      expect(d.message).toContain('$0.42 remaining');
      expect(d.message).toContain('$2.00 run ceiling');
      expect(d.message).toContain('add credit or raise the key\'s monthly limit');
      expect(d.message).toContain('no seat was dispatched');
    });

    test('a sub-cent remainder keeps its precision instead of rounding to $0.00', () => {
      const d = decideCreditPreflight(checked({ limitRemaining: 0.003 }), 2);
      expect(d.outcome).toBe('refuse');
      expect(d.message).toContain('$0.0030 remaining');
    });

    test('exactly zero remaining is refused', () => {
      const d = decideCreditPreflight(checked({ limitRemaining: 0 }), 2);
      expect(d.outcome).toBe('refuse');
      expect(d.message).toContain('$0.00 remaining');
    });
  });

  describe('ok — the key can cover the run', () => {
    test('a remaining limit at or above the ceiling passes', () => {
      expect(decideCreditPreflight(checked({ limitRemaining: 2 }), 2).outcome).toBe('ok');
      expect(decideCreditPreflight(checked({ limitRemaining: 12.34 }), '2.00').outcome).toBe('ok');
    });

    test('limitRemaining null means the key has NO monthly limit — never a refusal', () => {
      const d = decideCreditPreflight(checked({ limitRemaining: null }), 2);
      expect(d.outcome).toBe('ok');
      expect(d.message).toBe('OpenRouter credit ok (no key limit; run ceiling $2.00)');
    });

    test('the ok message names the remaining figure and the ceiling', () => {
      const d = decideCreditPreflight(checked({ limitRemaining: 12.34 }), '2.00');
      expect(d.message).toBe('OpenRouter credit ok ($12.34 remaining; run ceiling $2.00)');
    });

    test('a non-numeric limitRemaining is treated as "no limit known", not as zero', () => {
      const d = decideCreditPreflight(checked({ limitRemaining: 'lots' }), 2);
      expect(d.outcome).toBe('ok');
      expect(d.message).toContain('no key limit');
    });
  });

  test('every outcome is one of the three, and the message is a non-empty single line', () => {
    const cases = [UNCHECKED, checked({ isFreeTier: true }),
      checked({ limitRemaining: 0.1 }), checked({ limitRemaining: 9 }), checked()];
    for (const c of cases) {
      const d = decideCreditPreflight(c, 2);
      expect(['ok', 'warn', 'refuse']).toContain(d.outcome);
      expect(typeof d.message).toBe('string');
      expect(d.message.length).toBeGreaterThan(0);
      expect(d.message).not.toContain('\n');
    }
  });
});
