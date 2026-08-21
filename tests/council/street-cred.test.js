// tests/council/street-cred.test.js
'use strict';

/**
 * v4.8 T3.3 — seat-keyed street cred (SI-06, SI-19, SI-20; the phasing doc's
 * unfiled `| 24 |` perJudgeRank site).
 *
 * Every number asserted here was MEASURED, at BASE `b341b273` for the
 * "before" values and against this tree for the "after" ones. The mutants that
 * guard each behaviour, and their measured red sets, are recorded in
 * tests/council/street-cred-mutants.js — re-run them, never renumber them.
 */

const { computeStreetCred, rankPositions, credSeats } = require('../../src/council/street-cred');
const { computeStreetCred: viaTally } = require('../../src/council/tally');

// The forcing bench for all three collapse sites: alias `a` fills two seats,
// `b` fills one. Both twins JUDGE as well as being judged, which is what makes
// the peer split and perJudgeRank observable at the same time.
const SEATS = [
  { id: 'a#1', alias: 'a', role: 'seat', lens: null, position: 1 },
  { id: 'a#2', alias: 'a', role: 'seat', lens: null, position: 2 },
  { id: 'b', alias: 'b', role: 'seat', lens: null, position: 3 },
];
const SEATED_RANKINGS = [
  { judge: 'a', seat: 'a#1', order: ['a', 'a', 'b'], orderSeats: ['a#1', 'a#2', null] },
  { judge: 'a', seat: 'a#2', order: ['b', 'a', 'a'], orderSeats: [null, 'a#1', 'a#2'] },
  { judge: 'b', order: ['a', 'b', 'a'], orderSeats: ['a#1', null, 'a#2'] },
];
/** The SAME three judges with the seat channel stripped — the pre-T3.2 shape. */
const aliasOnly = () => SEATED_RANKINGS.map(r => ({ judge: r.judge, order: r.order }));

describe('rankPositions — SI-20 site 1, the alias collapse', () => {
  test('no orderSeats: keys stay alias-valued and the twin slot still collapses (BASE parity)', () => {
    const pos = rankPositions(['a', 'a', 'b']);
    expect([...pos.entries()]).toEqual([['a', 2], ['b', 3]]);   // 'a' overwritten 1 -> 2
  });

  test('with orderSeats: each twin slot gets its OWN entry at its OWN position', () => {
    const pos = rankPositions(['a', 'a', 'b'], ['a#1', 'a#2', null]);
    expect([...pos.entries()]).toEqual([['a#1', 1], ['a#2', 2], ['b', 3]]);
  });

  test('a tie group nests in BOTH arrays and both twins share the fractional position', () => {
    const pos = rankPositions([['a', 'a'], 'b'], [['a#1', 'a#2'], null]);
    expect([...pos.entries()]).toEqual([['a#1', 1.5], ['a#2', 1.5], ['b', 3]]);
  });

  test('a SHORTER orderSeats falls back to the alias for the slots it does not cover', () => {
    // Defence in depth for hand-assembled input: anonymize.js :: rankingToOrder
    // always returns a parity-shaped array, so the engine never produces this.
    const pos = rankPositions(['a', 'a', 'b'], ['a#1']);
    expect([...pos.entries()]).toEqual([['a#1', 1], ['a', 2], ['b', 3]]);
  });

  test('a NON-array orderSeats slot beside an array order slot falls back per element', () => {
    const pos = rankPositions([['a', 'a']], ['a#1']);
    expect([...pos.entries()]).toEqual([['a#1', 1.5], ['a', 1.5]]);
  });
});

describe('credSeats — the driver, joined BY VALUE', () => {
  test('a seated alias expands ONCE into its seats, in table order', () => {
    expect(credSeats(['a', 'a', 'b'], SEATS)).toEqual([
      { model: 'a', key: 'a#1', seat: 'a#1' },
      { model: 'a', key: 'a#2', seat: 'a#2' },
      { model: 'b', key: 'b', seat: null },          // id === alias -> emit nothing
    ]);
  });

  test("the `claude` tail gets an alias entry — seats[] never names it", () => {
    expect(credSeats(['a', 'a', 'claude'], SEATS)).toEqual([
      { model: 'a', key: 'a#1', seat: 'a#1' },
      { model: 'a', key: 'a#2', seat: 'a#2' },
      { model: 'claude', key: 'claude', seat: null },
    ]);
  });

  test('NO seat table: one entry per occurrence, duplicates included (BASE parity)', () => {
    expect(credSeats(['a', 'a', 'b'])).toEqual([
      { model: 'a', key: 'a', seat: null },
      { model: 'a', key: 'a', seat: null },
      { model: 'b', key: 'b', seat: null },
    ]);
  });

  test('a malformed seat entry is skipped, not guessed at', () => {
    const junk = [null, { id: 'a#1' }, { alias: 'a' }, { id: 7, alias: 'a' }];
    expect(credSeats(['a'], junk)).toEqual([{ model: 'a', key: 'a', seat: null }]);
  });
});

describe('computeStreetCred — one row per SEAT (SI-20 sites 2+3)', () => {
  const seated = computeStreetCred(SEATED_RANKINGS, ['a', 'a', 'b'], SEATS);

  test('a twin bench emits one row per seat, and the two rows DIVERGE', () => {
    // ⚠️ At BASE the same bench emitted two BYTE-IDENTICAL rows — measured,
    // `JSON.stringify(row0) === JSON.stringify(row1)` was `true`, which is
    // exactly why ledger.js's alias-keyed Map join was a harmless no-op there
    // and stops being one here.
    expect(seated.map(s => s.seat)).toEqual(['a#1', 'a#2', undefined]);
    expect(JSON.stringify(seated[0])).not.toEqual(JSON.stringify(seated[1]));
    expect(seated[0].withSelf).toBeCloseTo(4 / 3);      // ranks 1, 2, 1
    expect(seated[1].withSelf).toBeCloseTo(8 / 3);      // ranks 2, 3, 3
    expect(seated[2].withSelf).toBe(2);                 // ranks 3, 1, 2
  });

  test('SI-06 / ruling C-2: only the judge that IS this seat is excluded; the TWIN counts', () => {
    // a#1 is ranked 1 by itself, 2 by a#2 and 1 by b. Excluding only a#1
    // leaves [2, 1] -> 1.5. Excluding BOTH twins by ALIAS — the pre-T3.3
    // comparison — would leave [1] -> 1.0, so this number is the ruling.
    expect(seated[0].peersOnly).toBe(1.5);
    expect(seated[1].peersOnly).toBe(2.5);              // [2 from a#1, 3 from b]
    expect(seated[2].peersOnly).toBe(2);                // [3 from a#1, 1 from a#2]
  });

  test('the seat field is emit-when-DIFFERENT: the unique alias on a twin bench carries none', () => {
    expect('seat' in seated[2]).toBe(false);
  });

  test('`| 24 |`: perJudgeRank now has one entry per JUDGE, and agrees with withSelf', () => {
    // MEASURED at BASE on this bench: `{"a":3,"b":3}` — two entries for three
    // judges, implying mean 3 while withSelf reported 2.667 on the same row.
    expect(seated[0].perJudgeRank).toEqual({ 'a#1': 1, 'a#2': 2, b: 1 });
    expect(seated[1].perJudgeRank).toEqual({ 'a#1': 2, 'a#2': 3, b: 3 });
    for (const row of seated) {
      const vals = Object.values(row.perJudgeRank);
      expect(vals).toHaveLength(3);
      expect(vals.reduce((s, x) => s + x, 0) / vals.length).toBeCloseTo(row.withSelf);
    }
  });
});

describe('computeStreetCred — byte-identity where no seat channel exists', () => {
  test('a unique-alias bench is unchanged, values and key set alike', () => {
    const rankings = [
      { judge: 'X', order: ['X', 'Y', 'Z'] },
      { judge: 'Y', order: ['Y', 'Z', 'X'] },
      { judge: 'Z', order: ['Z', 'Y', 'X'] },
    ];
    expect(computeStreetCred(rankings, ['X', 'Y', 'Z'])).toEqual([
      { model: 'X', withSelf: 7 / 3, peersOnly: 3, perJudgeRank: { X: 1, Y: 3, Z: 3 } },
      { model: 'Y', withSelf: 5 / 3, peersOnly: 2, perJudgeRank: { X: 2, Y: 1, Z: 2 } },
      { model: 'Z', withSelf: 2, peersOnly: 2.5, perJudgeRank: { X: 3, Y: 2, Z: 1 } },
    ]);
  });

  test('a twin bench with NEITHER meta.seats NOR orderSeats reproduces BASE exactly', () => {
    // The whole hand-assembled `appendRun` shape. Values transcribed from the
    // BASE measurement, not from this implementation.
    expect(computeStreetCred(aliasOnly(), ['a', 'a', 'b'])).toEqual([
      { model: 'a', withSelf: 8 / 3, peersOnly: 3, perJudgeRank: { a: 3, b: 3 } },
      { model: 'a', withSelf: 8 / 3, peersOnly: 3, perJudgeRank: { a: 3, b: 3 } },
      { model: 'b', withSelf: 2, peersOnly: 2, perJudgeRank: { a: 1, b: 2 } },
    ]);
  });
});

describe('computeStreetCred — the two channels are INDEPENDENT', () => {
  // meta.seats and rankings[].orderSeats arrive from different producers, and a
  // document can carry one without the other. These two pin what happens then.
  const mixed = computeStreetCred(aliasOnly(), ['a', 'a', 'b'], SEATS);

  test('seat table but alias-only rankings: rows are seated, NUMBERS stay at BASE', () => {
    // Without the alias fallback in the position lookup both seat rows would
    // find nothing in an alias-keyed map and report null street cred — worse
    // than the collapse this task fixes. `null` here would be that regression.
    expect(mixed.map(s => s.seat)).toEqual(['a#1', 'a#2', undefined]);
    expect(mixed[0].withSelf).toBeCloseTo(8 / 3);
    expect(mixed[0].peersOnly).toBe(3);
    expect(mixed[1].withSelf).toBeCloseTo(8 / 3);
    expect(mixed[1].peersOnly).toBe(3);
  });

  test('⚠️ RESIDUAL, pinned deliberately: alias-only judges still collapse perJudgeRank', () => {
    // Two judges spell themselves `a` and nothing in the document tells them
    // apart, so the map keeps 2 entries for 3 judges and DISAGREES with
    // withSelf — mean 3 against 2.667. Ruling R2: attribute nothing where
    // there is nothing to attribute. Engine-produced twin benches never reach
    // this branch (run-assemble.js emits `rankings[].seat` for both twins).
    expect(mixed[0].perJudgeRank).toEqual({ a: 3, b: 3 });
    const vals = Object.values(mixed[0].perJudgeRank);
    expect(vals.reduce((s, x) => s + x, 0) / vals.length).toBe(3);
    expect(mixed[0].withSelf).not.toBe(3);
  });

  test('orderSeats but NO seat table: rows stay alias-driven and find nothing in the seated map', () => {
    // rankPositions keys on `a#1`/`a#2`, credSeats has no table so the rows are
    // keyed `a`; the fallback misses and both alias rows report null rather
    // than silently adopting one twin's numbers.
    const rows = computeStreetCred(SEATED_RANKINGS, ['a', 'a', 'b']);
    expect(rows.map(r => r.model)).toEqual(['a', 'a', 'b']);
    expect(rows[0].withSelf).toBeNull();
    expect(rows[0].perJudgeRank).toEqual({});
    expect(rows[2].withSelf).toBe(2);      // `b` has no seat id either way
  });
});

describe('the ./tally re-export is the same function', () => {
  test('tally.js :: computeStreetCred IS street-cred.js :: computeStreetCred', () => {
    // The T3.3 size-gate split promises no import path moved; this is that
    // promise as a pin rather than as a sentence in a docblock.
    expect(viaTally).toBe(computeStreetCred);
  });
});
