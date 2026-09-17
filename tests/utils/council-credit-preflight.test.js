// tests/utils/council-credit-preflight.test.js
'use strict';

/**
 * #256: the CI credit preflight's DECISION, unit-tested away from the network.
 *
 * The incident (run 35143585179, 2026-09-16): four of seven legs were refused by
 * OpenRouter in 2–3 s, the once-only retries were consumed by those refusals,
 * and the round lost quorum for $0.003. gpt's retry said why, verbatim:
 * `You requested up to 64000 tokens, but can only afford 56097`.
 *
 * COUNCIL #264 r2 RESHAPED THIS AGAIN, and the bench was right twice:
 *
 *  - HQ1 — the AGGREGATE `--max-cost` is not the quantity OpenRouter refuses on.
 *    A per-request `max_tokens` RESERVATION is. So the decision now takes a
 *    priced reservation: below one seat's reservation nothing can be dispatched
 *    (refuse); below `seats x` it the first wave will see refusals (warn).
 *  - HQ2 — `/api/v1/key` reports the key's monthly CAP only. A key with no cap
 *    (`limitRemaining: null`) on a depleted ACCOUNT passed as `ok`. The decision
 *    now takes a second probe and uses the MINIMUM of the two.
 *
 * `clamp` survives as a SPEND BOUND and nothing more — it is not, and never
 * was, a defence against a per-request refusal.
 */

const { decideCreditPreflight } = require('../../src/utils/council-credit-preflight');

const credit = (over = {}) => ({
  checked: true, warning: null, isFreeTier: false,
  limitRemaining: null, limit: null, usage: null, ...over,
});
const UNCHECKED_CREDIT = { checked: false, warning: null, isFreeTier: false,
  limitRemaining: null, limit: null, usage: null };
const balance = (balanceRemaining) => ({ checked: true, balanceRemaining,
  totalCredits: null, totalUsage: null });
const UNCHECKED_BALANCE = { checked: false, balanceRemaining: null,
  totalCredits: null, totalUsage: null };
/** A priced bench: 4 seats, $0.96 reserved per seat (64000 x $0.000015). */
const priced = (oneSeatUsd = 0.96) => ({ priced: true, oneSeatUsd,
  maxCompletionPrice: 0.000015, unpriced: [], reason: null });
const UNPRICED = { priced: false, oneSeatUsd: null, maxCompletionPrice: null,
  unpriced: ['openai/gpt-5.6-terra'], reason: 'one or more bench rows have no completion price' };

/** Healthy everything unless a case says otherwise. */
const decide = (over = {}, maxCost = '2.00') => decideCreditPreflight({
  credit: credit({ limitRemaining: 50 }),
  balance: balance(50),
  reservation: priced(),
  seats: 4,
  ...over,
}, maxCost);

describe('#256 decideCreditPreflight', () => {
  describe('ok — every check answered and the key can fund the whole first wave', () => {
    test('a comfortable key passes, with no clamp', () => {
      const d = decide();
      expect(d.outcome).toBe('ok');
      expect(d.effectiveMaxCost).toBeNull();
    });

    test('every message states what the preflight does and does not guarantee', () => {
      // Council #264 r2: the bench read the old copy as a promise the probe
      // cannot keep. Every outcome now carries the boundary.
      for (const over of [{}, { balance: UNCHECKED_BALANCE }, { reservation: UNPRICED },
        { credit: credit({ isFreeTier: true }) }, { credit: credit({ limitRemaining: 1 }), balance: balance(1) }]) {
        const d = decide(over);
        expect(d.message).toContain('cannot prevent a per-request refusal once seats are dispatched');
      }
    });
  });

  describe('HQ2 — the ACCOUNT BALANCE, not just the key cap', () => {
    test('a key with NO monthly cap but a depleted balance is refused, not ok', () => {
      // The blind spot verbatim: limit_remaining null used to mean "healthy".
      const d = decide({ credit: credit({ limitRemaining: null }), balance: balance(0) });
      expect(d.outcome).toBe('refuse');
      expect(d.message).toContain('balance');
    });

    test('the SMALLER of cap and balance governs, in both directions', () => {
      // cap 50, balance 0.5 -> 0.5 governs: below one seat's $0.96 reservation.
      expect(decide({ credit: credit({ limitRemaining: 50 }), balance: balance(0.5) }).outcome).toBe('refuse');
      // cap 0.5, balance 50 -> 0.5 governs the same way.
      expect(decide({ credit: credit({ limitRemaining: 0.5 }), balance: balance(50) }).outcome).toBe('refuse');
    });

    test('an UNCHECKED balance can never be ok, whatever the key cap says', () => {
      const d = decide({ balance: UNCHECKED_BALANCE });
      expect(d.outcome).toBe('warn');
      expect(d.message).toContain('account balance');
    });

    test('an unchecked balance still lets a certain refusal refuse', () => {
      // Unknown is not permission: a cap that already cannot fund a seat refuses
      // on its own evidence.
      const d = decide({ credit: credit({ limitRemaining: 0.1 }), balance: UNCHECKED_BALANCE });
      expect(d.outcome).toBe('refuse');
    });

    test('no cap and no balance answer is warn — the honest "we do not know"', () => {
      const d = decide({ credit: credit({ limitRemaining: null }), balance: UNCHECKED_BALANCE });
      expect(d.outcome).toBe('warn');
    });

    test('a non-finite balance is UNKNOWN, never a number', () => {
      for (const b of [NaN, Infinity, 'lots', {}]) {
        const d = decide({ credit: credit({ limitRemaining: null }), balance: { checked: true, balanceRemaining: b } });
        expect(d.outcome).toBe('warn');
      }
    });
  });

  describe('HQ1 — the per-request RESERVATION is what gets refused', () => {
    test('below ONE seat\'s reservation refuses: nothing can be dispatched', () => {
      // run 35143585179's shape: 56 097 tokens affordable against a 64 000-token
      // reservation. Aggregate ceilings never saw it.
      const d = decide({ credit: credit({ limitRemaining: 0.8 }), balance: balance(0.8) });
      expect(d.outcome).toBe('refuse');
      expect(d.message).toContain('$0.80');
      expect(d.message).toContain('$0.96');
      expect(d.message).toContain('reserv');
      expect(d.message).toContain('no seat was dispatched');
    });

    test('between one seat and the whole wave WARNS, naming both figures and the seat count', () => {
      // 4 seats x $0.96 = $3.84; $2.00 funds two seats, so the wave will see
      // refusals but the run is not hopeless.
      const d = decide({ credit: credit({ limitRemaining: 2 }), balance: balance(2) }, '10.00');
      expect(d.outcome).toBe('warn');
      expect(d.message).toContain('$2.00');
      expect(d.message).toContain('$3.84');
      expect(d.message).toContain('4 seats');
    });

    test('at or above the whole wave is ok', () => {
      // Ceiling at or below the money, so no spend bound competes with the verdict.
      const d = decide({ credit: credit({ limitRemaining: 3.84 }), balance: balance(3.84) }, '3.00');
      expect(d.outcome).toBe('ok');
      expect(d.message).toContain('4-seat');
    });

    test('an UNPRICED bench warns and skips the rule — never ok', () => {
      const d = decide({ reservation: UNPRICED });
      expect(d.outcome).toBe('warn');
      expect(d.message).toContain('could not price the bench');
      // It names what it could not price, so the reader can fix the map.
      expect(d.message).toContain('openai/gpt-5.6-terra');
    });

    test('an unpriced bench does NOT suppress a refusal the money already proves', () => {
      const d = decide({ reservation: UNPRICED, credit: credit({ limitRemaining: 0 }), balance: balance(0) });
      expect(d.outcome).toBe('refuse');
    });

    test('a seat count that is not a positive integer falls back to one seat', () => {
      for (const seats of [0, -3, NaN, null, undefined, 'four', 2.5]) {
        const d = decide({ seats, credit: credit({ limitRemaining: 2 }), balance: balance(2) }, '2.00');
        expect(d.outcome).toBe('ok'); // $2.00 covers 1 x $0.96
      }
    });
  });

  describe('refuse — only when nothing can be dispatched', () => {
    test('a free-tier key, whatever else is true', () => {
      const d = decide({ credit: credit({ isFreeTier: true }) });
      expect(d.outcome).toBe('refuse');
      expect(d.message).toContain('free tier');
      expect(d.message).toContain('add credit');
      expect(d.message).not.toContain('monthly limit —');
    });

    test('an exhausted cap or balance (<= 0)', () => {
      for (const over of [{ credit: credit({ limitRemaining: 0 }), balance: balance(9) },
        { credit: credit({ limitRemaining: 9 }), balance: balance(-3) }]) {
        expect(decide(over).outcome).toBe('refuse');
      }
    });

    test('a negative figure reads as -$3.00, never $-3.00', () => {
      // Council #264 r2 / D5.
      const d = decide({ credit: credit({ limitRemaining: -3 }), balance: balance(-3) });
      expect(d.message).toContain('-$3.00');
      expect(d.message).not.toContain('$-3.00');
    });

    test('a remainder below one cent refuses — a $0 ceiling is a bad CLI argument', () => {
      const d = decide({ credit: credit({ limitRemaining: 0.004 }), balance: balance(0.004),
        reservation: priced(0.0001) });
      expect(d.outcome).toBe('refuse');
      expect(d.message).toContain('below one cent');
    });

    test('every refusal reports no effective ceiling', () => {
      for (const over of [{ credit: credit({ isFreeTier: true }) },
        { credit: credit({ limitRemaining: 0 }), balance: balance(0) },
        { credit: credit({ limitRemaining: 0.5 }), balance: balance(0.5) }]) {
        expect(decide(over).effectiveMaxCost).toBeNull();
      }
    });
  });

  describe('warn — the probe could not answer', () => {
    test('the key probe itself did not complete', () => {
      const d = decide({ credit: UNCHECKED_CREDIT });
      expect(d.outcome).toBe('warn');
      expect(d.message).toMatch(/^OpenRouter credit could not be checked — /);
    });

    test('a garbage probe result is the same warn, not a crash', () => {
      for (const c of [null, undefined, 'nope', 42, {}]) {
        expect(decide({ credit: c }).outcome).toBe('warn');
      }
      expect(decideCreditPreflight(null, 2).outcome).toBe('warn');
      expect(decideCreditPreflight(undefined, 2).outcome).toBe('warn');
    });

    test('a non-finite key cap is UNKNOWN, and shown honestly (never as "null")', () => {
      for (const limitRemaining of [NaN, Infinity, -Infinity, 'lots', {}, true]) {
        const d = decide({ credit: credit({ limitRemaining }) });
        expect(d.outcome).toBe('warn');
      }
      expect(decide({ credit: credit({ limitRemaining: NaN }) }).message).toContain('NaN');
      expect(decide({ credit: credit({ limitRemaining: NaN }) }).message).not.toContain('limit null is');
    });

    test('an unusable run ceiling warns rather than comparing against NaN', () => {
      // Called directly, not through the `decide` helper: its default parameter
      // would swallow the `undefined` case and quietly test '2.00' instead.
      const inputs = { credit: credit({ limitRemaining: 50 }), balance: balance(50),
        reservation: priced(), seats: 4 };
      for (const bad of ['', '   ', 'x', null, undefined, NaN, 0, -1, Infinity]) {
        const d = decideCreditPreflight(inputs, bad);
        expect(d.outcome).toBe('warn');
        expect(d.message).toContain('run ceiling');
      }
    });
  });

  describe('clamp — a SPEND BOUND, and the message says only that', () => {
    test('remaining below the run ceiling clamps it, naming both figures', () => {
      const d = decide({ credit: credit({ limitRemaining: 4 }), balance: balance(4) }, '10.00');
      expect(d.outcome).toBe('clamp');
      expect(d.effectiveMaxCost).toBe(4);
      expect(d.message).toContain('$4.00');
      expect(d.message).toContain('$10.00');
      // It must NOT read as protection against a refusal.
      expect(d.message).toContain('spend');
      expect(d.message).toContain('cannot prevent a per-request refusal');
    });

    test('the clamped ceiling rounds DOWN to cents and is never zero', () => {
      expect(decide({ credit: credit({ limitRemaining: 1.239 }), balance: balance(1.239),
        reservation: priced(0.0001) }, '10.00').effectiveMaxCost).toBe(1.23);
      for (let i = 1; i <= 200; i++) {
        const r = i / 200 * 2;
        const d = decide({ credit: credit({ limitRemaining: r }), balance: balance(r),
          reservation: priced(0.0001) }, '10.00');
        if (d.outcome === 'clamp') { expect(d.effectiveMaxCost).toBeGreaterThan(0); }
      }
    });

    test('a warn outranks a clamp, and still carries the clamped ceiling', () => {
      // Both apply: the balance is unknown AND the remaining cap is under the
      // ceiling. The louder state is reported; the spend bound still travels.
      const d = decide({ credit: credit({ limitRemaining: 4 }), balance: UNCHECKED_BALANCE }, '10.00');
      expect(d.outcome).toBe('warn');
      expect(d.effectiveMaxCost).toBe(4);
    });
  });

  describe('the contract every caller depends on', () => {
    test('every outcome is one of the four, with a non-empty single-line message', () => {
      const cases = [{}, { credit: UNCHECKED_CREDIT }, { credit: credit({ isFreeTier: true }) },
        { credit: credit({ limitRemaining: 0 }), balance: balance(0) },
        { credit: credit({ limitRemaining: 2 }), balance: balance(2) },
        { balance: UNCHECKED_BALANCE }, { reservation: UNPRICED }];
      for (const c of cases) {
        const d = decide(c, '10.00');
        expect(['ok', 'warn', 'refuse', 'clamp']).toContain(d.outcome);
        expect(typeof d.message).toBe('string');
        expect(d.message.length).toBeGreaterThan(0);
        expect(d.message).not.toContain('\n');
      }
    });

    test('effectiveMaxCost is a number only when a smaller ceiling is in force', () => {
      expect(decide({ credit: credit({ limitRemaining: 4 }), balance: balance(4) }, '10.00').effectiveMaxCost).toBe(4);
      expect(decide().effectiveMaxCost).toBeNull();
      expect(decide({ credit: UNCHECKED_CREDIT }).effectiveMaxCost).toBeNull();
    });
  });
});
