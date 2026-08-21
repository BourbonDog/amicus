// tests/council/anonymize.test.js
'use strict';
const { assignLabels, toGlobalId, toGlobalFindings, rankingToOrder } =
  require('../../src/council/anonymize');

describe('assignLabels', () => {
  test('assigns Review A/B/C in model order and builds the label map', () => {
    const { entries, labelMap } = assignLabels(['deepseek', 'gemini', 'gpt']);
    expect(entries).toEqual([
      { label: 'Review A', letter: 'A', model: 'deepseek' },
      { label: 'Review B', letter: 'B', model: 'gemini' },
      { label: 'Review C', letter: 'C', model: 'gpt' },
    ]);
    expect(labelMap['Review B']).toBe('gemini');
  });

  test('throws on an empty bench', () => {
    expect(() => assignLabels([])).toThrow(/1-26/);
  });

  test('succeeds with exactly 26 models', () => {
    const { entries } = assignLabels(Array(26).fill().map((_, i) => `m${i}`));
    expect(entries).toHaveLength(26);
  });

  test('throws on 27 models', () => {
    expect(() => assignLabels(Array(27).fill().map((_, i) => `m${i}`))).toThrow(/1-26/);
  });
});

describe('id rewriting roundtrip', () => {
  test('toGlobalId prefixes the review letter', () => {
    expect(toGlobalId('A', 1)).toBe('A1');
    expect(toGlobalId('C', 12)).toBe('C12');
  });

  test('toGlobalFindings rewrites local ids and attaches the raiser', () => {
    const out = toGlobalFindings('B', 'gemini', [
      { id: 1, severity: 'major', claim: 'x', location: 'l', rationale: 'r' },
      { id: 2, severity: 'nit', claim: 'y', location: 'l', rationale: 'r' },
    ]);
    expect(out).toEqual([
      { id: 'B1', raiser: 'gemini', severity: 'major', claim: 'x', location: 'l' },
      { id: 'B2', raiser: 'gemini', severity: 'nit', claim: 'y', location: 'l' },
    ]);
  });
});

// v4.8 PR3 Task 5: toGlobalFindings gains a 4th, additive raiserSeat parameter
// — emitted ONLY when truthy AND different from the raiser alias (emit-when-
// DIFFERENT, not emit-when-set). On a unique-alias bench the seat id is
// byte-equal to the alias, so the naive "emit when set" form would stamp a
// redundant raiserSeat on every finding of every run.
describe('toGlobalFindings raiserSeat (v4.8 PR3 Task 5)', () => {
  const findings = [{ id: 1, severity: 'major', claim: 'x', location: 'l', rationale: 'r' }];

  test('a seat id that differs from the raiser alias (twin bench) is emitted as raiserSeat', () => {
    const out = toGlobalFindings('A', 'deepseek', findings, 'deepseek#1');
    expect(out[0].raiserSeat).toBe('deepseek#1');
  });

  test('a seat id byte-equal to the raiser alias (unique-alias bench) emits NO raiserSeat key', () => {
    const out = toGlobalFindings('A', 'deepseek', findings, 'deepseek');
    expect('raiserSeat' in out[0]).toBe(false);
  });

  test('a falsy 4th argument (e.g. the Claude review 3-arg call site) emits NO raiserSeat key', () => {
    const out = toGlobalFindings('A', 'claude', findings);
    expect('raiserSeat' in out[0]).toBe(false);
  });
});

describe('rankingToOrder (de-anonymization for tally rankings)', () => {
  const { labelMap } = assignLabels(['deepseek', 'gemini', 'gpt']);

  test('maps labels to model ids preserving order', () => {
    const { order, errors } = rankingToOrder(['Review C', 'Review A', 'Review B'], labelMap);
    expect(order).toEqual(['gpt', 'deepseek', 'gemini']);
    expect(errors).toEqual([]);
  });

  test('preserves tie groups as nested arrays', () => {
    const { order } = rankingToOrder([['Review A', 'Review B'], 'Review C'], labelMap);
    expect(order).toEqual([['deepseek', 'gemini'], 'gpt']);
  });

  test('unknown label lands in errors', () => {
    const { errors } = rankingToOrder(['Review Z'], labelMap);
    expect(errors).toEqual(["unknown label 'Review Z'"]);
  });
});

// v4.8 T3.2: assignLabels gains an ADDITIVE seat channel. `labelMap` (label ->
// alias) is UNCHANGED — a controller ruling (P-3): blind-mode.js's labelFor
// does an exact-string match against labelMap's VALUE, and it is persisted to
// run.json / schemas/council-run.schema.json:45 — seat-ifying its values
// breaks that live consumer (measured in the phase plan §0.6: `labelFor(
// "gemini", {'Review A':'gemini#1'})` -> `null`). `seatMap` (label -> seat id)
// is the separate channel: sparse, present only for a label whose seat is a
// real bound seat differing from its own alias — the shared emit-when-
// DIFFERENT predicate (run-stats-entry.js:64: `seat.id !== seat.alias`).
describe('assignLabels seat channel (v4.8 T3.2)', () => {
  const twinSeats = [
    { id: 'deepseek#1', alias: 'deepseek', role: 'seat', lens: null, position: 1 },
    { id: 'deepseek#2', alias: 'deepseek', role: 'seat', lens: null, position: 2 },
  ];
  const uniqueSeats = [
    { id: 'deepseek', alias: 'deepseek', role: 'seat', lens: null, position: 1 },
    { id: 'gemini', alias: 'gemini', role: 'seat', lens: null, position: 2 },
  ];

  test('no seats argument (every pre-T3.2 call site): seatMap is empty, labelMap unchanged', () => {
    const { labelMap, seatMap } = assignLabels(['deepseek', 'gemini']);
    expect(labelMap).toEqual({ 'Review A': 'deepseek', 'Review B': 'gemini' });
    expect(seatMap).toEqual({});
  });

  test('a unique-alias bench (seats given, none differ): seatMap stays empty', () => {
    const { labelMap, seatMap } = assignLabels(['deepseek', 'gemini'], uniqueSeats);
    expect(seatMap).toEqual({});
    expect(labelMap).toEqual({ 'Review A': 'deepseek', 'Review B': 'gemini' });   // untouched
  });

  test('a twin bench: seatMap carries label -> seat id; labelMap stays alias-valued', () => {
    const { labelMap, seatMap } = assignLabels(['deepseek', 'deepseek'], twinSeats);
    expect(seatMap).toEqual({ 'Review A': 'deepseek#1', 'Review B': 'deepseek#2' });
    // P-3 / §0.6: labelMap keeps label -> ALIAS, byte-identical — this is what
    // keeps blind-mode.js's labelFor() resolvable.
    expect(labelMap).toEqual({ 'Review A': 'deepseek', 'Review B': 'deepseek' });
  });

  test('a null seat (e.g. an orphaned leg) is skipped, not thrown', () => {
    const { seatMap } = assignLabels(['deepseek', 'gemini'], [null, uniqueSeats[1]]);
    expect(seatMap).toEqual({});
  });
});

// v4.8 T3.2: rankingToOrder gains the optional seatMap and returns the
// seat-valued `orderSeats` alongside the unchanged, alias-valued `order`.
describe('rankingToOrder orderSeats (v4.8 T3.2, additive seat channel)', () => {
  const twinSeats = [
    { id: 'deepseek#1', alias: 'deepseek', role: 'seat', lens: null, position: 1 },
    { id: 'deepseek#2', alias: 'deepseek', role: 'seat', lens: null, position: 2 },
  ];
  const { labelMap, seatMap } = assignLabels(['deepseek', 'deepseek'], twinSeats);

  test('resolves each slot to its seat id, disambiguating what order cannot on a twin bench', () => {
    const { order, orderSeats } = rankingToOrder(['Review A', 'Review B'], labelMap, seatMap);
    expect(order).toEqual(['deepseek', 'deepseek']);            // ambiguous today, UNCHANGED
    expect(orderSeats).toEqual(['deepseek#1', 'deepseek#2']);   // NEW: disambiguated
  });

  test('preserves tie groups as nested arrays, same shape as order', () => {
    const { order, orderSeats } = rankingToOrder([['Review A', 'Review B']], labelMap, seatMap);
    expect(order).toEqual([['deepseek', 'deepseek']]);
    expect(orderSeats).toEqual([['deepseek#1', 'deepseek#2']]);
  });

  test('no seatMap argument (every pre-T3.2 call site): orderSeats is an all-null parity shape; order/errors untouched', () => {
    const uniqueLabelMap = assignLabels(['deepseek', 'gemini', 'gpt']).labelMap;
    const { order, orderSeats, errors } = rankingToOrder(['Review C', 'Review A', 'Review B'], uniqueLabelMap);
    expect(order).toEqual(['gpt', 'deepseek', 'gemini']);
    expect(orderSeats).toEqual([null, null, null]);
    expect(errors).toEqual([]);
  });

  test('an unknown label still lands in errors exactly as before; orderSeats reports null for it too', () => {
    const { errors, orderSeats } = rankingToOrder(['Review Z'], labelMap, seatMap);
    expect(errors).toEqual(["unknown label 'Review Z'"]);
    expect(orderSeats).toEqual([null]);
  });
});
