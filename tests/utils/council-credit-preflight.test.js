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
 *    A per-request `max_tokens` RESERVATION is. So the decision takes a priced
 *    reservation — and, since council #264 r3, FOUR figures from it: below the
 *    CHEAPEST bench seat nothing can be dispatched (refuse); below the DEAREST
 *    those seat(s) will be refused while a cheaper quorum may still seat (warn);
 *    below the bench's SUM the wave cannot seat concurrently (warn); and the
 *    CHAIR is priced apart, reported as a clause, never a reason to refuse.
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
/**
 * A priced 4-seat bench. Uniform by default so a single figure drives the
 * simple cases; `priced({cheapest, dearest, wave})` makes it mixed.
 */
const priced = (over = {}) => ({
  priced: true, cheapestSeatUsd: 0.96, dearestSeatUsd: 0.96, waveUsd: 3.84,
  chairUsd: 0.64, unpriced: [], unpricedChair: [], reason: null, ...over });
const UNPRICED = { priced: false, cheapestSeatUsd: null, dearestSeatUsd: null,
  waveUsd: null, chairUsd: null, unpriced: ['openai/gpt-5.6-terra'], unpricedChair: [],
  reason: 'one or more bench rows have no completion price' };

/**
 * A bench priced so low that nothing but the MONEY can gate: used where the case
 * is about the cent arithmetic or the sub-cent rule, not about the reservation.
 */
const CHEAP_BENCH = { priced: true, cheapestSeatUsd: 0.0001, dearestSeatUsd: 0.0001,
  waveUsd: 0.0001, chairUsd: null, unpriced: [], unpricedChair: [], reason: null };

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
    /**
     * Council #264 r3 (B1 + C1) narrowed this gate. Round 2 refused whenever the
     * money could not fund the DEAREST seat — which turns a run that could have
     * seated its cheap seats, possibly to quorum, into zero reviews. That is the
     * harm this whole PR exists to avoid, reintroduced by its own remedy.
     */
    test('below the CHEAPEST bench seat refuses: nothing at all can be dispatched', () => {
      const d = decide({ credit: credit({ limitRemaining: 0.8 }), balance: balance(0.8) });
      expect(d.outcome).toBe('refuse');
      expect(d.message).toContain('$0.80');
      expect(d.message).toContain('$0.96');
      expect(d.message).toMatch(/cheapest/i);
      expect(d.message).toContain('no seat was dispatched');
    });

    test('between the cheapest and the dearest WARNS — a cheaper quorum may still seat', () => {
      // glm/qwen at $0.02, gpt at $0.96: $0.50 funds the cheap pair and not gpt.
      const mixed = priced({ cheapestSeatUsd: 0.02, dearestSeatUsd: 0.96, waveUsd: 1.0 });
      const d = decide({ reservation: mixed,
        credit: credit({ limitRemaining: 0.5 }), balance: balance(0.5) }, '10.00');
      expect(d.outcome).toBe('warn');
      expect(d.message).toContain('$0.96');
      expect(d.message).toContain('cheaper quorum');
      expect(d.message).not.toContain('no seat was dispatched');
    });

    test('a mixed bench refuses only below its CHEAPEST row', () => {
      const mixed = priced({ cheapestSeatUsd: 0.02, dearestSeatUsd: 0.96, waveUsd: 1.0 });
      expect(decide({ reservation: mixed, credit: credit({ limitRemaining: 0.019 }),
        balance: balance(0.019) }, '10.00').outcome).toBe('refuse');
      expect(decide({ reservation: mixed, credit: credit({ limitRemaining: 0.021 }),
        balance: balance(0.021) }, '10.00').outcome).toBe('warn');
    });

    test('below the WAVE (the SUM of the bench) warns about concurrency', () => {
      const d = decide({ credit: credit({ limitRemaining: 2 }), balance: balance(2) }, '10.00');
      expect(d.outcome).toBe('warn');
      expect(d.message).toContain('$3.84');
      expect(d.message).toContain('concurrently');
    });

    test('at or above the whole wave is ok', () => {
      const d = decide({ credit: credit({ limitRemaining: 3.84 }), balance: balance(3.84) }, '3.00');
      expect(d.outcome).toBe('ok');
    });

    /**
     * B1 verbatim: the chair runs sequentially AFTER the wave, so its price can
     * never be a reason to refuse the bench — only a reason to say the chair may
     * not make it.
     */
    test('the CHAIR is reported in its own clause and never refuses the bench', () => {
      const d = decide({ reservation: priced({ chairUsd: 50 }),
        credit: credit({ limitRemaining: 4 }), balance: balance(4) }, '3.00');
      expect(d.outcome).toBe('warn');
      expect(d.message).toContain('chair');
      expect(d.message).toContain('$50.00');
      expect(d.message).not.toContain('no seat was dispatched');
    });

    test('a dear chair rides ALONGSIDE a bench warning, never instead of it', () => {
      const d = decide({ reservation: priced({ chairUsd: 50 }),
        credit: credit({ limitRemaining: 2 }), balance: balance(2) }, '10.00');
      expect(d.outcome).toBe('warn');
      expect(d.message).toContain('concurrently');   // the bench clause
      expect(d.message).toContain('chair');           // and the chair clause
    });

    test('an affordable chair adds no clause at all', () => {
      const d = decide({ credit: credit({ limitRemaining: 3.84 }), balance: balance(3.84) }, '3.00');
      expect(d.message).not.toContain('chair');
    });

    test('an UNPRICED chair is silent — it cannot make the bench verdict worse', () => {
      const d = decide({ reservation: priced({ chairUsd: null, unpricedChair: ['x/y'] }),
        credit: credit({ limitRemaining: 3.84 }), balance: balance(3.84) }, '3.00');
      expect(d.outcome).toBe('ok');
    });

    test('a seat count that is not a positive integer falls back to one seat', () => {
      // `seats` only labels the ok message now (the wave figure comes from the
      // reservation), but a NaN would print "the NaN-seat first wave" — so the
      // fallback stays, and so does its pin.
      for (const seats of [0, -3, NaN, null, undefined, 'four', 2.5]) {
        const d = decide({ seats, credit: credit({ limitRemaining: 50 }),
          balance: balance(50) }, '3.00');
        expect(d.outcome).toBe('ok');
        expect(d.message).toContain('1-seat');
      }
    });

    test('the chair being UNPRICEABLE is said out loud on a warn, and never invents one', () => {
      // Council #264 r3 polish: `unpricedChair` was collected and never read.
      const withWarn = decide({ reservation: priced({ chairUsd: null, unpricedChair: ['x/y'] }),
        credit: credit({ limitRemaining: 1 }), balance: balance(1) }, '10.00');
      expect(withWarn.outcome).toBe('warn');
      expect(withWarn.message).toContain('the chair could not be priced');
      // On a clean run it stays silent — an unpriced chair is not a problem with
      // the bench, so it must not turn an `ok` into a warning.
      const clean = decide({ reservation: priced({ chairUsd: null, unpricedChair: ['x/y'] }),
        credit: credit({ limitRemaining: 50 }), balance: balance(50) }, '3.00');
      expect(clean.outcome).toBe('ok');
      expect(clean.message).not.toContain('could not be priced');
    });

    test('an UNPRICED bench warns and skips the rule — never ok', () => {
      const d = decide({ reservation: UNPRICED });
      expect(d.outcome).toBe('warn');
      expect(d.message).toContain('could not price the bench');
      expect(d.message).toContain('openai/gpt-5.6-terra');
    });

    test('an unpriced bench does NOT suppress a refusal the money already proves', () => {
      const d = decide({ reservation: UNPRICED, credit: credit({ limitRemaining: 0 }), balance: balance(0) });
      expect(d.outcome).toBe('refuse');
    });
  });

  describe('refuse — only when nothing can be dispatched', () => {
    test('a free-tier key, whatever else is true', () => {
      const d = decide({ credit: credit({ isFreeTier: true }) });
      expect(d.outcome).toBe('refuse');
      expect(d.message).toContain('free tier');
      expect(d.message).toContain('add credit');
      expect(d.message).not.toContain('monthly limit');
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

    /**
     * Council #264 r3 / C2: `usd()` only used four decimals below $0.005, so a
     * remainder of $0.007 rendered as "$0.01 ... below one cent" — the same
     * sentence asserting and denying the same fact.
     */
    test('a sub-cent figure never renders as $0.01 beside the words "below one cent"', () => {
      const d = decide({ credit: credit({ limitRemaining: 0.007 }), balance: balance(0.007),
        reservation: CHEAP_BENCH });
      expect(d.message).toContain('below one cent');
      expect(d.message).toContain('$0.0070');
      expect(d.message).not.toContain('$0.01 ');
    });

    test('a remainder below one cent refuses — a $0 ceiling is a bad CLI argument', () => {
      const d = decide({ credit: credit({ limitRemaining: 0.004 }), balance: balance(0.004),
        reservation: CHEAP_BENCH });
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

    /**
     * Council #264 r3 / A1. `Math.floor(0.29 * 100) / 100` is 0.28, because
     * `0.29 * 100` is 28.999999999999996 in IEEE 754 — so the clamp published a
     * ceiling a cent BELOW the money for every remainder whose second decimal is
     * a 9. A spend bound that does not match the money to the cent is not one.
     */
    test('the clamped ceiling is EXACT in cents, not one cent short', () => {
      const clamp = (r) => decide({ credit: credit({ limitRemaining: r }), balance: balance(r),
        reservation: priced({ cheapestSeatUsd: 0.0001, dearestSeatUsd: 0.0001, waveUsd: 0.0001,
          chairUsd: null }) }, '10.00').effectiveMaxCost;
      expect(clamp(0.29)).toBe(0.29);
      expect(clamp(1.15)).toBe(1.15);
      expect(clamp(0.59)).toBe(0.59);
      expect(clamp(2.675)).toBe(2.67);   // still floors a real third decimal
      expect(clamp(1.239)).toBe(1.23);
    });

    /**
     * Council #264 r3 polish. `usd()` ROUNDED while the clamp FLOORED, so the
     * same message could print a figure above the money it was describing:
     * $1.236 rendered "$1.24 ... capped at $1.23". Every money figure is floored
     * now — to the cent above one cent, to four decimals below it — so no
     * rendered figure can exceed the balance, and the sub-cent sentence cannot
     * contradict itself ($0.00999999 was printing "$0.0100 ... below one cent").
     */
    test('EVERY rendered figure is floored to the money, never rounded up', () => {
      const d = decide({ credit: credit({ limitRemaining: 1.236 }), balance: balance(1.236),
        reservation: CHEAP_BENCH }, '10.00');
      expect(d.effectiveMaxCost).toBe(1.23);
      expect(d.message).toContain('$1.23');
      expect(d.message).not.toContain('$1.24');
    });

    test('a sub-cent figure floors too, so it can never read as $0.0100', () => {
      const d = decide({ credit: credit({ limitRemaining: 0.00999999 }),
        balance: balance(0.00999999), reservation: CHEAP_BENCH });
      expect(d.outcome).toBe('refuse');
      expect(d.message).toContain('below one cent');
      expect(d.message).toContain('$0.0099');
      expect(d.message).not.toContain('$0.0100');
      expect(d.message).not.toContain('$0.01 ');
    });

    test('the cent arithmetic never rounds UP past the real money', () => {
      for (const r of [0.2899999, 0.999, 1.101, 3.339]) {
        const d = decide({ credit: credit({ limitRemaining: r }), balance: balance(r),
          reservation: priced({ cheapestSeatUsd: 0.0001, dearestSeatUsd: 0.0001, waveUsd: 0.0001,
            chairUsd: null }) }, '10.00');
        expect(d.effectiveMaxCost).toBeLessThanOrEqual(r);
      }
    });

    test('a remainder that floors to zero cents still refuses', () => {
      const d = decide({ credit: credit({ limitRemaining: 0.0099 }), balance: balance(0.0099),
        reservation: priced({ cheapestSeatUsd: 0.0001, dearestSeatUsd: 0.0001, waveUsd: 0.0001,
          chairUsd: null }) }, '10.00');
      expect(d.outcome).toBe('refuse');
      expect(d.message).toContain('below one cent');
    });

    test('the clamped ceiling rounds DOWN to cents and is never zero', () => {
      expect(decide({ credit: credit({ limitRemaining: 1.239 }), balance: balance(1.239),
        reservation: CHEAP_BENCH }, '10.00').effectiveMaxCost).toBe(1.23);
      // Every point is accounted for, not just the clamps: a sweep that only
      // checks the branch it expects cannot see a point falling silently into
      // another one.
      // 0.001 .. 0.200 in tenth-of-a-cent steps: the ONLY region where a
      // round-down could reach zero, and the only one where both branches are
      // genuinely reachable. (A sweep starting at $0.01 never enters the refuse
      // arm at all, which makes an `else` there look checked while testing
      // nothing.)
      const seen = new Set();
      for (let i = 1; i <= 200; i++) {
        const r = i * 0.001;
        const d = decide({ credit: credit({ limitRemaining: r }), balance: balance(r),
          reservation: CHEAP_BENCH }, '10.00');
        if (d.outcome === 'clamp') {
          expect(d.effectiveMaxCost).toBeGreaterThan(0);
          expect(r).toBeGreaterThanOrEqual(0.01);
        } else {
          // The only non-clamp point in this range is money below one cent,
          // which refuses by the stated rule.
          expect(d.outcome).toBe('refuse');
          expect(r).toBeLessThan(0.01);
        }
        seen.add(d.outcome);
      }
      // Both arms were actually taken — otherwise the `else` above is decoration.
      expect([...seen].sort()).toEqual(['clamp', 'refuse']);
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
