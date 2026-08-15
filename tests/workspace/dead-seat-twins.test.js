'use strict';
// v4.8 PR5c Task 2 — deadSeats on a bench that repeats an alias.
//
// M3: two dead twins collapsed to one row.  M4: a live twin erased its dead twin entirely
// (silent data loss).  D1 (round-1 council blocker): seat-keying the dedup split the keyspace
// against seatLoss.deadBenchSeats, which verdict.js:86 derives from the SAME dead legs that
// emit degrades[] — so a naive fix rendered 3 rows for 2 dead seats.
//
// The residual pins at the bottom assert KNOWN-WRONG behaviour on purpose. The owner ruling
// conditions acceptance on naming and pinning each one, so they cannot rot into a surprise.
const LS = require('../../electron/workspace-ui/live-seats');

const deadLeg = (seat, seatId) => ({
  kind: 'degrade', channel: 'dead-leg',
  data: { seat, retryWaveId: 'w1',
    ...(seatId ? { firstFailure: { seat, seatId, class: 'leg' } } : {}) },
});
const deadWave = (models, seats) => ({
  kind: 'degrade', channel: 'dead-wave',
  data: { waveId: 'r1-s1', models, reason: 'x', retryWaveId: 'w1', ...(seats ? { seats } : {}) },
});
const rows = (degrades, seatLoss, live, runMeta) =>
  LS.deadSeats(degrades, seatLoss || null, live || [], runMeta || null);

describe('T2 — the fix', () => {
  test('M3: two dead twins render TWO rows', () => {
    expect(rows([deadLeg('d', 'd#1'), deadLeg('d', 'd#2')])).toHaveLength(2);
  });

  test('M4: a dead twin beside a LIVE twin still renders — no silent erasure', () => {
    const out = rows([deadLeg('d', 'd#2')], null, [{ model: 'd', seat: 'd#1', role: 'seat' }]);
    expect(out).toHaveLength(1);
    expect(out[0].seat).toBe('d#2');
    expect(out[0].model).toBe('d');          // display stays the ALIAS
  });

  test('D1: a deadBenchSeats alias does not add a third row beside two seat-keyed twins', () => {
    expect(rows([deadLeg('d', 'd#1'), deadLeg('d', 'd#2')], { deadBenchSeats: ['d'] }))
      .toHaveLength(2);
  });

  test('B1: a dead wave with one identified and one UNIDENTIFIED slot renders TWO rows', () => {
    // Task 1 emits `null` for the unidentified slot. Two distinct dead seats, one nameable.
    const out = rows([deadWave(['d', 'd'], ['d#1', null])]);
    expect(out).toHaveLength(2);
    expect(out.map(r => r.seat)).toEqual(['d#1', null]);
  });

  test('two UNIDENTIFIED slots in one wave are still two seats', () => {
    expect(rows([deadWave(['d', 'd'], [null, null])])).toHaveLength(2);
  });
});

describe('T2 — controls that must not move', () => {
  test('A: unique bench, seat alive, stale degrade -> suppressed', () => {
    expect(rows([deadLeg('alpha', null)], null, [{ model: 'alpha', seat: null, role: 'seat' }]))
      .toHaveLength(0);
  });

  test('B: unique bench, seat dead -> rendered', () => {
    expect(rows([deadLeg('alpha', null)])).toHaveLength(1);
  });

  test('C: BOTH twins alive, alias-only degrade -> suppressed, no false positive', () => {
    expect(rows([deadLeg('d', null)], null,
      [{ model: 'd', seat: 'd#1', role: 'seat' }, { model: 'd', seat: 'd#2', role: 'seat' }]))
      .toHaveLength(0);
  });

  test('D4d: alias-only dead-leg + duplicate deadBenchSeats collapse to ONE row', () => {
    // The existing pin at dead-seat-rows.test.js:347. `seen` absorbs both sources.
    expect(rows([deadLeg('d', null)], { deadBenchSeats: ['d', 'd'] })).toHaveLength(1);
  });

  test('F36: an alias degrade vs a live row keyed by its RESOLVED id -> suppressed', () => {
    // dead-seat-rows.test.js:559. `reviewing` is built from modelInput || model.
    expect(rows([deadLeg('alpha', null)], null,
      [{ model: 'google/alpha-2.5', modelInput: 'alpha', seat: null, role: 'seat' }]))
      .toHaveLength(0);
  });

  test('a LEGACY dead wave (no seats[]) still renders one row per model', () => {
    expect(rows([deadWave(['a', 'b'])])).toHaveLength(2);
  });

  test('deadBenchSeats alone, with no degrade, still renders', () => {
    expect(rows([], { deadBenchSeats: ['solo'] })).toHaveLength(1);
  });

  // The pin the round-1 council's dead mutant M2c should have had. The seat-id arm of
  // `reviewing` exists to suppress a seat-keyed record naming a seat that is ALIVE;
  // no other case exercises it, so without this the arm ships unpinned.
  test('a seat-keyed record naming a LIVE seat is suppressed', () => {
    expect(rows([deadLeg('d', 'd#1')], null, [{ model: 'd', seat: 'd#1', role: 'seat' }]))
      .toHaveLength(0);
  });
});

describe('T2 — disclosed residuals (known-wrong, pinned so they cannot rot)', () => {
  test('R1: legacy alias-only record, one twin alive -> the dead twin stays hidden', () => {
    // The record does not say WHICH seat died, so it is indistinguishable from a stale
    // degrade naming the live one. Disclosed in the plan's §0.7.3 and the CHANGELOG.
    expect(rows([deadLeg('d', null)], null, [{ model: 'd', seat: 'd#1', role: 'seat' }]))
      .toHaveLength(0);
  });

  test('R2: legacy alias-only records, both twins dead -> collapse to ONE row', () => {
    expect(rows([deadLeg('d', null), deadLeg('d', null)])).toHaveLength(1);
  });

  test('R4: the CRITIC path is not seat-keyed — a dead bench twin beside a live critic twin', () => {
    // role is inferred from ALIAS equality (live-seats.js:209) and critics suppress through
    // byRole, a different map. Filed to BACKLOG; not fixed here.
    expect(rows([deadLeg('d', 'd#2')], null,
      [{ model: 'd', seat: 'd#1', role: 'critic' }], { critic: 'd' })).toHaveLength(0);
  });
});
