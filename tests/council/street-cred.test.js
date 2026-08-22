// tests/council/street-cred.test.js
'use strict';

/**
 * v4.8 T3.3 — seat-keyed street cred (SI-06, SI-19, SI-20; the phasing doc's
 * `| 24 |` perJudgeRank site — the alias-collapse half; the write-site/
 * prototype half T3.3 left unfiled is closed below, v4.8 Phase 6 PR1 Task 2).
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
  // ⚠️ RETITLED at this task's review round 1 (fix round 1) — "expands ONCE
  // into its seats" named the pre-Rule-A mechanism (first occurrence expands
  // into every registered id at once). Rule A replaced it with a per-occurrence
  // lookup; this fixture (adjacent repeats, table fully registered) still
  // passes because the two mechanisms AGREE there, not because either title
  // is still accurate. See "credSeats — Rule A" below for the mechanism and
  // for the non-adjacent case where they diverge.
  test('a seated alias: each occurrence takes its OWN seat, in table order', () => {
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

/**
 * v4.8 follow-up (2026-08-21) — council findings 1+2 on PR #176. Row count
 * followed `seats` wherever it disagreed with `models`: a row DROPPED when the
 * table registered FEWER ids for a repeated alias than `models` repeats it
 * ("partial"), and a row INVENTED when the table registered MORE ids for an
 * alias than `models` repeats it ("over-specified"). Both are reachable only
 * on the two hand-assembled `appendRun` paths — `mcp-tools.js ::
 * amicus_council_tally` declares `meta.seats` independently of `meta.models`
 * and `cli-handlers-council.js` passes user JSON through verbatim, so nothing
 * stops the two from disagreeing on that input — never on the engine's own
 * output. ⚠️ NOT because `seats[]` and `models` always agree: they differ in
 * LENGTH on a `claudeInCouncil` run (the `claude` tail `seats[]` never names —
 * pinned as the "claude tail" case below). What holds instead: `seats.js ::
 * buildSeats` is one-to-one with the BENCH `models` is built from, so it can
 * never over- or under-register a bench alias (fix round 1 of this task's
 * review caught the earlier draft's overclaim here).
 *
 * Rule A: `seats` NAMES rows, it never changes how many there are. The k-th
 * occurrence of alias `m` takes the k-th registered seat id for `m`, else no
 * seat (an alias-keyed row, `seat: null` — NOT a dropped row).
 * `rows.length === models.length`, always — pinned below as ONE invariant
 * over a case list, not as N near-duplicate example tests.
 *
 * ⚠️ ROW ORDER, SEPARATELY — fix round 1 of this task's review, Important 1.
 * The pre-fix loop also happened to GROUP an alias's rows at its FIRST
 * occurrence (`expanded.has(m) -> continue` skipped every later one, so
 * nothing from a later occurrence could ever land between two earlier rows).
 * Rule A's per-occurrence loop has no such grouping: each occurrence pushes
 * exactly where its OWN index in `models` puts it. On every ADJACENT-repeat
 * case in the table below the two orders coincide, which is why nothing
 * caught the divergence until a NON-ADJACENT repeat (`['a','b','a']`, an
 * ordinary bench — `buildSeats(['a','b','a'])` assigns it real positions, no
 * rejection) was tried. MEASURED: BASE gives `['a#1','a#2','b']` (both `a`
 * rows adjacent, grouped by the accident above); Rule A gives
 * `['a#1','b','a#2']` (bench order). Contents are identical either way, only
 * ORDER moves — and `streetCred[]` is serialised array-order into
 * verdict.json (verdict.js) and rendered array-order into both report
 * renderers (report-md.js, report-html.js), so this is observable, not
 * cosmetic. RULING (owner): the NEW order is correct — it follows
 * `meta.models`, which ledger.js's own docblock names as the row driver, and
 * it aligns with `meta.seats`/`position` ordering, which are already in
 * models order; BASE's grouping was never a stated doctrine, just what the
 * buggy loop happened to do. Pinned below as an explicit shape/order
 * assertion, not folded into the length-only table — a length check alone
 * cannot tell the two orders apart.
 */
describe('credSeats — Rule A: exactly one row per `models` entry (v4.8 follow-up)', () => {
  const PARTIAL_SEATS = [{ id: 'a#1', alias: 'a', role: 'seat', lens: null, position: 1 }];
  const OVER_SEATS = [
    { id: 'a#1', alias: 'a', role: 'seat', lens: null, position: 1 },
    { id: 'a#2', alias: 'a', role: 'seat', lens: null, position: 2 },
  ];
  // An alias the table names that never appears in `models` at all — it has no
  // occurrence to attach to, so it can only ever be inert.
  const ALIEN_SEATS = [{ id: 'z#1', alias: 'z', role: 'seat', lens: null, position: 1 }];

  const CASES = [
    ['consistent — table registers exactly as many ids as models repeats', ['a', 'a', 'b'], SEATS],
    ['partial — table under-registers a repeated alias (was: DROPPED a row)', ['a', 'a', 'b'], PARTIAL_SEATS],
    ['over-specified — table over-registers a non-repeated alias (was: INVENTED a row)', ['a', 'b'], OVER_SEATS],
    ['alien alias — table names an alias absent from models', ['a', 'b'], ALIEN_SEATS],
    ['no seats table at all', ['x', 'y'], undefined],
    ['claude tail — meta.seats never names claude', ['a', 'a', 'claude'], SEATS],
    ['non-adjacent repeat — a bench interrupted by another alias', ['a', 'b', 'a'], SEATS],
  ];

  test.each(CASES)('%s: rows.length === models.length', (_label, models, seats) => {
    expect(credSeats(models, seats)).toHaveLength(models.length);
  });

  test('partial: the SECOND occurrence is no longer dropped — it gets an alias-keyed row', () => {
    // MEASURED at BASE: credSeats(['a','a','b'], PARTIAL_SEATS) was only 2 rows
    // — the second 'a' vanished once `expanded.has('a')` was already true.
    expect(credSeats(['a', 'a', 'b'], PARTIAL_SEATS)).toEqual([
      { model: 'a', key: 'a#1', seat: 'a#1' },
      { model: 'a', key: 'a', seat: null },      // table exhausted -> alias-keyed, not dropped
      { model: 'b', key: 'b', seat: null },
    ]);
  });

  test('over-specified: the surplus registered seat no longer invents an extra row', () => {
    // MEASURED at BASE: credSeats(['a','b'], OVER_SEATS) was 3 rows — the
    // single 'a' occurrence expanded into BOTH of its table's registered ids.
    expect(credSeats(['a', 'b'], OVER_SEATS)).toEqual([
      { model: 'a', key: 'a#1', seat: 'a#1' },   // only the FIRST occurrence's own seat
      { model: 'b', key: 'b', seat: null },
    ]);
  });

  test('alien alias: an unused table entry is inert either way', () => {
    expect(credSeats(['a', 'b'], ALIEN_SEATS)).toEqual([
      { model: 'a', key: 'a', seat: null },
      { model: 'b', key: 'b', seat: null },
    ]);
  });

  test('non-adjacent repeat: row ORDER follows `models`, not alias grouping', () => {
    // Review round 1 finding (Important 1) — reproduced independently, not
    // taken on claim: the length invariant above is silent on ORDER, and
    // every other case in this file keeps a repeated alias's occurrences
    // ADJACENT, where the pre-fix grouping and Rule A's per-occurrence order
    // happen to coincide. This is the case that tells them apart.
    // MEASURED — same seats table (SEATS: a#1, a#2, b), bench interrupted by
    // 'b' between the two 'a' occurrences:
    //   BASE  (expand-once-then-skip): ['a#1','a#2','b']  -- grouped at the
    //     FIRST 'a', because the buggy loop's `expanded.has('a') -> continue`
    //     is what kept an alias's rows together; no doctrine ever specified
    //     that order, it fell out of the bug.
    //   Rule A (per-occurrence lookup): ['a#1','b','a#2'] -- bench order,
    //     because each occurrence pushes exactly where its own index in
    //     `models` puts it.
    // RULING (owner, review round 1): the bench-order form is correct — it
    // follows `meta.models` (ledger.js's own row driver) and already agrees
    // with `meta.seats`/`position` ordering. Content is identical either way;
    // only order moves. `streetCred[]` is serialised in this array order into
    // verdict.json and both report renderers, so the order is observable.
    expect(credSeats(['a', 'b', 'a'], SEATS)).toEqual([
      { model: 'a', key: 'a#1', seat: 'a#1' },
      { model: 'b', key: 'b', seat: null },
      { model: 'a', key: 'a#2', seat: 'a#2' },
    ]);
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

describe('computeStreetCred — perJudgeRank is prototype-safe (SI-24)', () => {
  // v4.8 Phase 6 PR1, Task 2 — the WRITE-site half of SI-24. Distinct from
  // tally.js's `VERDICTS`, a READ site Task 1 closed there: all four
  // `Object.prototype` keys (toString/__proto__/constructor/valueOf) read a
  // live inherited value back on a plain lookup. Here the write
  // `perJudgeRank[j.seat || j.judge] = rank` is an ASSIGNMENT, and only
  // `__proto__` is destructive — it is the one Object.prototype key that is
  // an ACCESSOR (a getter/setter pair), and its setter silently discards a
  // non-object value instead of creating an own property. `toString` /
  // `constructor` / `valueOf` are ordinary inherited DATA properties, so
  // assigning to them shadows harmlessly and DOES create an own key either
  // way — the third test below pins that this is still true on the fixed map.
  const TWO_JUDGES_ORDER = ['a', 'b'];

  test('a __proto__ JUDGE alias keeps its rank as an OWN key, not lost to the setter', () => {
    // ⚠️ A bare `expect(row.perJudgeRank.__proto__).toBe(1)` can PASS FOR THE
    // WRONG REASON on a plain object — it reads the live prototype chain back
    // regardless of whether an own key was ever created. hasOwnProperty is
    // what actually distinguishes fixed from broken.
    const rankings = [
      { judge: '__proto__', order: TWO_JUDGES_ORDER },
      { judge: 'j2', order: TWO_JUDGES_ORDER },
    ];
    const rows = computeStreetCred(rankings, ['a', 'b']);
    const a = rows.find(r => r.model === 'a');
    expect(Object.prototype.hasOwnProperty.call(a.perJudgeRank, '__proto__')).toBe(true);
    expect(Object.keys(a.perJudgeRank)).toEqual(['__proto__', 'j2']);
    expect(a.perJudgeRank['__proto__']).toBe(1);
    for (const row of rows) {
      const vals = Object.values(row.perJudgeRank);
      expect(vals).toHaveLength(2);
      expect(vals.reduce((s, x) => s + x, 0) / vals.length).toBeCloseTo(row.withSelf);
    }
  });

  test('a __proto__ SEAT id keeps its rank the same way — both channels feed one assignment', () => {
    // `[j.seat || j.judge]` means a __proto__ SEAT id is exactly as
    // destructive as a __proto__ judge alias — the previous test covers the
    // judge channel, this one covers the seat channel.
    const rankings = [
      { judge: 'j1', seat: '__proto__', order: TWO_JUDGES_ORDER },
      { judge: 'j2', order: TWO_JUDGES_ORDER },
    ];
    const rows = computeStreetCred(rankings, ['a', 'b']);
    const a = rows.find(r => r.model === 'a');
    expect(Object.prototype.hasOwnProperty.call(a.perJudgeRank, '__proto__')).toBe(true);
    expect(a.perJudgeRank['__proto__']).toBe(1);
    for (const row of rows) {
      const vals = Object.values(row.perJudgeRank);
      expect(vals).toHaveLength(2);
      expect(vals.reduce((s, x) => s + x, 0) / vals.length).toBeCloseTo(row.withSelf);
    }
  });

  test('toString and constructor still land as own keys with their ranks — unaffected by the fix', () => {
    const rankings = [
      { judge: 'toString', order: TWO_JUDGES_ORDER },
      { judge: 'constructor', order: TWO_JUDGES_ORDER },
    ];
    const rows = computeStreetCred(rankings, ['a', 'b']);
    const a = rows.find(r => r.model === 'a');
    expect(Object.keys(a.perJudgeRank)).toEqual(['toString', 'constructor']);
    expect(a.perJudgeRank.toString).toBe(1);
    expect(a.perJudgeRank.constructor).toBe(1);
  });

  test('JSON round-trip: the __proto__ entry survives serialisation — this is what tally.json actually writes', () => {
    // The pin that matters most: computeStreetCred's return value is written
    // to tally.json via JSON.stringify, so in-memory correctness alone would
    // not close the defect if serialisation dropped the key some other way.
    const rankings = [
      { judge: '__proto__', order: TWO_JUDGES_ORDER },
      { judge: 'j2', order: TWO_JUDGES_ORDER },
    ];
    const rows = computeStreetCred(rankings, ['a', 'b']);
    const a = rows.find(r => r.model === 'a');
    const roundTripped = JSON.parse(JSON.stringify(a));
    expect(Object.prototype.hasOwnProperty.call(roundTripped.perJudgeRank, '__proto__')).toBe(true);
    expect(roundTripped.perJudgeRank['__proto__']).toBe(1);
    // JSON.parse always returns an ordinary Object.prototype object — the
    // round-tripped map is no longer null-prototype, which is expected and
    // fine; only the IN-MEMORY accumulator needs to be prototype-free.
    expect(Object.getPrototypeOf(roundTripped.perJudgeRank)).toBe(Object.prototype);
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
