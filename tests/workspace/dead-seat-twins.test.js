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

  test('R3: a NEW-run record whose seatId is ALIAS-valued behaves exactly as a legacy one', () => {
    // run-retry-group.js:47 keys firstFailures as `seatObj ? seatObj.id : seat`, so a seat the
    // producer could not identify yields an ALIAS-valued seatId on a brand-new run. Nothing
    // structurally distinguishes it from a pre-PR5c record — which is why the residual can NOT
    // be scoped to "legacy runs", the claim round 2 refuted (A1/C2).
    const aliasValued = { kind: 'degrade', channel: 'dead-leg',
      data: { seat: 'd', retryWaveId: 'w1',
        firstFailure: { seat: 'd', seatId: 'd', class: 'leg' } } };
    expect(rows([aliasValued, aliasValued])).toHaveLength(1);              // collapses, like R2
    expect(rows([aliasValued], null, [{ model: 'd', seat: 'd#1', role: 'seat' }]))
      .toHaveLength(0);                                                     // suppressed, like R1
  });

  test('R4: the CRITIC path is not seat-keyed — a dead bench twin beside a live critic twin', () => {
    // role is inferred from ALIAS equality (live-seats.js:209) and critics suppress through
    // byRole, a different map. Filed to BACKLOG; not fixed here.
    expect(rows([deadLeg('d', 'd#2')], null,
      [{ model: 'd', seat: 'd#1', role: 'critic' }], { critic: 'd' })).toHaveLength(0);
  });
});

/**
 * T3 — the dead row's DOM key.
 *
 * Task 2 makes two dead twins render as TWO rows. `renderDeadSeatRows` keys each row
 * `'dead:' + seat.model` — the ALIAS — so on a twin bench both rows carry ONE key.
 * `renderSeats`' leaver-removal (workspace-render.js) snapshots `existing` by dataset.key
 * before its loop, so two rows sharing a key collapse to the last one: only one is removed
 * per repaint and the other LEAKS, accumulating a stale ghost every tick. That is the same
 * frozen-row/leaver-removal class PR5b fixed on the live path, re-created on the dead path.
 *
 * A single render cannot see it. Every case here paints at least twice.
 */
describe('T3 — two dead twins survive repaints without accumulating', () => {
  const { makeFakeDom } = require('./helpers/fake-workspace-page');
  let AmicusLive; let AmicusRender; let AmicusSeats; let document;

  beforeEach(() => {
    jest.resetModules();
    const fake = makeFakeDom();
    document = fake.document;
    global.window = fake.window;
    global.document = document;
    global.NodeFilter = fake.NodeFilter;
    require('../../electron/workspace-ui/live-model');
    require('../../electron/workspace-ui/workspace-render');
    require('../../electron/workspace-ui/workspace-seats');
    AmicusLive = global.window.AmicusLive;
    AmicusRender = global.window.AmicusRender;
    AmicusSeats = global.window.AmicusSeats;
  });
  afterEach(() => {
    delete global.window; delete global.document; delete global.NodeFilter;
  });

  const twinDegrades = [deadLeg('d', 'd#1'), deadLeg('d', 'd#2')];

  function paintTwice(costRows, degrades) {
    const tbody = document.createElement('tbody');
    const liveSeats = AmicusLive.seatsFromRunStats(costRows);
    for (let i = 0; i < 2; i += 1) {
      AmicusRender.renderSeats(tbody, liveSeats, false, () => null);
      AmicusSeats.renderDeadSeatRows(
        tbody, AmicusLive.deadSeats(degrades, null, liveSeats, null), false, () => null);
    }
    return tbody.children.filter(r => r.classList.contains('seat-dead'));
  }

  test('two dead twins render TWO rows and do not accumulate across two ticks', () => {
    expect(paintTwice([], twinDegrades)).toHaveLength(2);
  });

  test('each dead twin row carries a DISTINCT dataset.key', () => {
    const rowsOut = paintTwice([], twinDegrades);
    const keys = rowsOut.map(r => r.dataset.key);
    expect(new Set(keys).size).toBe(2);
  });

  test('CONTROL — a unique bench dead row keeps its alias-shaped key and does not accumulate', () => {
    const rowsOut = paintTwice(
      [{ model: 'alpha', role: 'seat', status: 'complete', costDisplay: '$0.10' }],
      [deadLeg('bravo', null)]);
    expect(rowsOut).toHaveLength(1);
    expect(rowsOut[0].dataset.key).toBe('dead:bravo');
  });

  /**
   * R5 — the live tick. `appendDeadRows` passes `live.seats`, whose entries come from
   * live-normalize.js's seatOf: `{id: leg.taskId, model, modelInput, role, ...}`. `id` is a
   * per-LEG task id, NOT a seat identity, and there is no `seat` field at all — so the seat-id
   * arm of `reviewing` is inert on this path.
   *
   * ⚠️ Round 2 (gpt C3, kimi D5) corrected what this residual IS. It is NOT "M3 and M4 persist
   * live": the CANDIDATES carry seat ids from Task 1, so dead twins do separate correctly. The
   * residual is on the SUPPRESSION side — a seat-keyed dead record cannot be matched against a
   * live payload that has no seat identity, so a stale record naming a seat that is ALIVE
   * renders a dead row for it until the terminal refresh.
   */
  describe('T6 — R5: the live tick, suppression-side only', () => {
    beforeEach(() => {
      global.window.AmicusApp = {
        $: (id) => document.getElementById(id),
        labelOf: () => null,
        state: { detail: null, blind: false },
      };
    });
    const livePayloadSeat = (model) => ({
      id: 'task-' + model, model, modelInput: model, role: 'seat', status: 'complete',
      stage: null, messages: null, tokensIn: null, tokensOut: null,
      costDisplay: '$0.10', lastActivity: null, latestPreview: null, stalled: false,
    });
    const deadRowsIn = (tbody) => tbody.children.filter(r => r.classList.contains('seat-dead'));

    test('dead twins DO separate on the live path — M3 does not persist', () => {
      const tbody = document.getElementById('seats-body');
      const seats = [livePayloadSeat('other')];
      AmicusRender.renderSeats(tbody, seats, false, () => null);
      AmicusSeats.appendDeadRows({ ok: true, seats, degrades: twinDegrades });
      expect(deadRowsIn(tbody)).toHaveLength(2);
    });

    test('KNOWN-WRONG: a stale seat-keyed record naming a LIVE seat still renders a dead row', () => {
      // Terminally this is suppressed (see "a seat-keyed record naming a LIVE seat is
      // suppressed" above). Live it is not, because the payload carries no seat identity to
      // match against. Clears on the terminal refresh. Filed to BACKLOG.
      const tbody = document.getElementById('seats-body');
      const seats = [livePayloadSeat('d')];
      AmicusRender.renderSeats(tbody, seats, false, () => null);
      AmicusSeats.appendDeadRows({ ok: true, seats, degrades: [deadLeg('d', 'd#1')] });
      expect(deadRowsIn(tbody)).toHaveLength(1);
    });
  });

});
