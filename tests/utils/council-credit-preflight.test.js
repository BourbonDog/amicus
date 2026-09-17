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
 * COUNCIL #264 r1 / B1 RESHAPED THIS. The first version refused the whole run
 * when `limitRemaining < MAX_COST`, which on the motivating run would have
 * dispatched ZERO seats — three of them succeeded there, because `--max-cost`
 * is a whole-run CEILING, not the expected spend. A key with $0.50 left can
 * still fund several cheap seats. So a remaining limit below the ceiling now
 * CLAMPS the run's ceiling to what the key has, and the run's own cost gate
 * (exit 2 + degrade notes, loud) bounds the spend. THREE states refuse — a
 * free-tier key, a limit that is actually exhausted (`<= 0`), and a limit below
 * one cent, which would floor to a `--max-cost 0` the CLI rejects outright
 * (council #264 r1 round 2).
 *
 * The workflow step is a shell heredoc and cannot be unit-tested; the ruling it
 * makes can be, so the ruling lives here as a pure function and the step only
 * prints its answer and writes `effective_max_cost`.
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
      // Number('') is 0 and Number('x') is NaN — both make the comparison
      // silently false. The comparison that cannot be made is announced instead.
      for (const bad of ['', '   ', 'x', null, undefined, NaN, 0, -1, Infinity]) {
        const d = decideCreditPreflight(checked({ limitRemaining: 0.42 }), bad);
        expect(d.outcome).toBe('warn');
        expect(d.message).toContain('run ceiling');
      }
    });

    /**
     * Council #264 r1 / A2. A malformed `limitRemaining` used to fall into the
     * same bucket as `null` and produce a confident `ok` — i.e. "this key has no
     * monthly limit" asserted from a value that says nothing at all. Only `null`
     * (and an absent key) mean "no monthly limit"; anything else unparseable is
     * UNKNOWN, and unknown warns.
     */
    test('a non-null, non-finite limitRemaining is UNKNOWN — warn, never ok', () => {
      for (const limitRemaining of [NaN, Infinity, -Infinity, 'lots', '12.34', {}, [], true]) {
        const d = decideCreditPreflight(checked({ limitRemaining }), 2);
        expect(d.outcome).toBe('warn');
        expect(d.message).toContain('could not be checked');
        expect(d.message).toContain('limit');
        expect(d.effectiveMaxCost).toBeNull();
      }
    });

    test('the unknown-limit message shows the value HONESTLY, never as "null"', () => {
      // JSON.stringify renders NaN and ±Infinity as the literal `null` — the one
      // value that legitimately means "no monthly limit". Printing that would
      // deny the very distinction this branch exists to draw.
      expect(decideCreditPreflight(checked({ limitRemaining: NaN }), 2).message)
        .toContain('monthly limit NaN is not a number');
      expect(decideCreditPreflight(checked({ limitRemaining: Infinity }), 2).message)
        .toContain('monthly limit Infinity is not a number');
      expect(decideCreditPreflight(checked({ limitRemaining: 'lots' }), 2).message)
        .toContain('monthly limit "lots" is not a number');
      for (const bad of [NaN, Infinity, -Infinity]) {
        expect(decideCreditPreflight(checked({ limitRemaining: bad }), 2).message)
          .not.toContain('limit null is');
      }
    });

    test('an unknown limit is still decided AFTER free tier, which is a hard fact', () => {
      const d = decideCreditPreflight(checked({ isFreeTier: true, limitRemaining: NaN }), 2);
      expect(d.outcome).toBe('refuse');
    });
  });

  describe('refuse — zero spend, loud, and only for the three states that cannot fund a run', () => {
    test('a free-tier key is refused whatever the limit says', () => {
      const d = decideCreditPreflight(checked({ isFreeTier: true }), 2);
      expect(d.outcome).toBe('refuse');
      expect(d.message).toContain('OpenRouter key cannot cover this run');
      expect(d.message).toContain('free tier');
      expect(d.message).toContain('no seat was dispatched');
      expect(d.effectiveMaxCost).toBeNull();
    });

    test('the free-tier remedy is ADD CREDIT only — raising a monthly limit cannot fix it', () => {
      const d = decideCreditPreflight(checked({ isFreeTier: true }), 2);
      expect(d.message).toContain('add credit');
      expect(d.message).not.toContain('monthly limit');
    });

    test('free tier is decided BEFORE the ceiling, so a bad ceiling cannot mask it', () => {
      expect(decideCreditPreflight(checked({ isFreeTier: true }), '').outcome).toBe('refuse');
    });

    test('an EXHAUSTED limit (<= 0) is refused — nothing can be funded', () => {
      for (const limitRemaining of [0, -0.5, -12]) {
        const d = decideCreditPreflight(checked({ limitRemaining }), 2);
        expect(d.outcome).toBe('refuse');
        expect(d.message).toContain('OpenRouter key cannot cover this run');
        expect(d.message).toContain('no seat was dispatched');
      }
    });

    test('an exhausted limit is refused even when the run ceiling is unreadable', () => {
      // Nothing to compare against, and nothing to salvage: $0 funds no seat.
      const d = decideCreditPreflight(checked({ limitRemaining: 0 }), '');
      expect(d.outcome).toBe('refuse');
    });

    /**
     * The THIRD refuse state (council #264 r1 round 2) — MEASURED, and it
     * reverses what the first clamp asserted. A sub-cent limit floors to `0`,
     * `finish` writes `effective_max_cost=0`, `'0'` is non-empty so the
     * `${VAR:-$MAX_COST}` fallback does not fire, and the paid step runs
     * `--max-cost "0"` — which `src/cli-handlers-council-run.js` rejects outright
     * (`--max-cost must be a positive number`, BAD_ARGS, exit 1) long before
     * `createBudget` is reached. The workflow then reports `::error::council run
     * failed`: zero reviews, the exact outcome the clamp exists to prevent.
     *
     * Filed here, not under `clamp`, because the outcome IS a refusal — the
     * clamp block carries the boundary invariant that keeps the two consistent.
     */
    test('a sub-cent remainder REFUSES — a $0 ceiling is rejected by the CLI, not bounded by it', () => {
      for (const limitRemaining of [0.004, 0.009, 0.0001]) {
        const d = decideCreditPreflight(checked({ limitRemaining }), 2);
        expect(d.outcome).toBe('refuse');
        expect(d.effectiveMaxCost).toBeNull();
        expect(d.message).toContain('below one cent');
        expect(d.message).toContain('no seat was dispatched');
      }
    });
  });

  /**
   * Council #264 r1 / B1 — the shape that replaced the abort.
   */
  describe('clamp — the key has money, just less than the ceiling', () => {
    test('0 < remaining < ceiling clamps the run ceiling and names both figures', () => {
      const d = decideCreditPreflight(checked({ limitRemaining: 0.42 }), '2.00');
      expect(d.outcome).toBe('clamp');
      expect(d.effectiveMaxCost).toBe(0.42);
      expect(d.message).toContain('$0.42');
      expect(d.message).toContain('$2.00');
      // It is NOT a refusal, and the message must not read like one.
      expect(d.message).not.toContain('no seat was dispatched');
      expect(d.message).not.toContain('cannot cover');
    });

    test('the clamped ceiling is rounded DOWN to cents, never up past the limit', () => {
      expect(decideCreditPreflight(checked({ limitRemaining: 1.239 }), 5).effectiveMaxCost).toBe(1.23);
      expect(decideCreditPreflight(checked({ limitRemaining: 0.999 }), 5).effectiveMaxCost).toBe(0.99);
      expect(decideCreditPreflight(checked({ limitRemaining: 2.675 }), 5).effectiveMaxCost).toBe(2.67);
      // Float noise must not round the clamp UP over the real limit.
      for (const r of [0.42, 1.1, 0.07, 3.33]) {
        expect(decideCreditPreflight(checked({ limitRemaining: r }), 99).effectiveMaxCost)
          .toBeLessThanOrEqual(r);
      }
    });

    // The sub-cent case is the lower BOUNDARY of this range, but its outcome is
    // `refuse`, so it is filed under the refuse block above — see
    // `a sub-cent remainder REFUSES …`. The invariant that keeps the two blocks
    // consistent is the sweep below.
    test('effectiveMaxCost is NEVER zero on a clamp — a zero ceiling would fail the job', () => {
      // The whole-range guard, not three examples: anything that survives as a
      // clamp must be a ceiling the CLI will accept.
      for (let i = 1; i <= 400; i++) {
        const limitRemaining = i / 400 * 1.5; // 0.00375 .. 1.5
        const d = decideCreditPreflight(checked({ limitRemaining }), 2);
        if (d.outcome === 'clamp') {
          expect(d.effectiveMaxCost).toBeGreaterThan(0);
        } else {
          expect(d.outcome).toBe('refuse');
          expect(limitRemaining).toBeLessThan(0.01);
        }
      }
    });

    test('exactly one cent still clamps — it is the smallest ceiling the CLI accepts', () => {
      const d = decideCreditPreflight(checked({ limitRemaining: 0.01 }), 2);
      expect(d.outcome).toBe('clamp');
      expect(d.effectiveMaxCost).toBe(0.01);
    });

    test('the clamp explains that the run continues on a smaller ceiling', () => {
      const d = decideCreditPreflight(checked({ limitRemaining: 0.42 }), '2.00');
      expect(d.message).toContain('clamped');
      expect(d.message).toContain('the run continues');
    });
  });

  describe('ok — the key limit can cover the whole ceiling', () => {
    test('a remaining limit at or above the ceiling passes, with no clamp', () => {
      for (const [limitRemaining, ceiling] of [[2, 2], [12.34, '2.00']]) {
        const d = decideCreditPreflight(checked({ limitRemaining }), ceiling);
        expect(d.outcome).toBe('ok');
        expect(d.effectiveMaxCost).toBeNull();
      }
    });

    test('limitRemaining null means the key has NO monthly limit — never a refusal', () => {
      const d = decideCreditPreflight(checked({ limitRemaining: null }), 2);
      expect(d.outcome).toBe('ok');
      expect(d.message).toBe('OpenRouter key limit ok (no monthly limit on the key; '
        + 'run ceiling $2.00; in-flight reservations and account balance are not checked)');
    });

    test('an absent limitRemaining key is the same as null', () => {
      const d = decideCreditPreflight({ checked: true, isFreeTier: false }, 2);
      expect(d.outcome).toBe('ok');
      expect(d.message).toContain('no monthly limit on the key');
    });

    test('the ok message names the remaining figure and the ceiling', () => {
      const d = decideCreditPreflight(checked({ limitRemaining: 12.34 }), '2.00');
      expect(d.message).toBe('OpenRouter key limit ok ($12.34 monthly limit remaining vs '
        + 'run ceiling $2.00; in-flight reservations and account balance are not checked)');
    });

    /**
     * Review fix round 1, Important #2. `GET /api/v1/key` reports the key's
     * MONTHLY LIMIT and nothing else — not the account balance, and not the
     * in-flight max_tokens reservations that refused three of the four legs in
     * run 35143585179 (#218).
     */
    test('EVERY ok message says what it did not measure, and never claims "credit ok"', () => {
      for (const limitRemaining of [null, 0.5, 12.34]) {
        const d = decideCreditPreflight(checked({ limitRemaining }), 0.25);
        expect(d.outcome).toBe('ok');
        expect(d.message).toContain('key limit ok');
        expect(d.message).not.toContain('credit ok');
        expect(d.message).toContain('in-flight reservations and account balance are not checked');
      }
    });
  });

  describe('the contract every caller depends on', () => {
    test('every outcome is one of the four, with a non-empty single-line message', () => {
      const cases = [UNCHECKED, checked({ isFreeTier: true }), checked({ limitRemaining: 0 }),
        checked({ limitRemaining: 0.1 }), checked({ limitRemaining: 9 }), checked(),
        checked({ limitRemaining: NaN })];
      for (const c of cases) {
        const d = decideCreditPreflight(c, 2);
        expect(['ok', 'warn', 'refuse', 'clamp']).toContain(d.outcome);
        expect(typeof d.message).toBe('string');
        expect(d.message.length).toBeGreaterThan(0);
        expect(d.message).not.toContain('\n');
      }
    });

    /**
     * The workflow writes `effective_max_cost` on EVERY path and the paid step
     * passes it as `--max-cost`. A non-null value on a non-clamp outcome would
     * silently move the run's ceiling with nothing announcing it.
     */
    test('effectiveMaxCost is a number ONLY for clamp, and null everywhere else', () => {
      const clamped = decideCreditPreflight(checked({ limitRemaining: 0.42 }), 2);
      expect(typeof clamped.effectiveMaxCost).toBe('number');
      for (const c of [UNCHECKED, checked({ isFreeTier: true }), checked({ limitRemaining: 0 }),
        checked({ limitRemaining: 9 }), checked(), checked({ limitRemaining: 'lots' })]) {
        expect(decideCreditPreflight(c, 2).effectiveMaxCost).toBeNull();
      }
    });
  });
});
