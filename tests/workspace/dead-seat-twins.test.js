'use strict';
// v4.8 PR5c Task 2 — deadSeats on a bench that repeats an alias.
//
// M3: two dead twins collapsed to one row.  M4: a live twin erased its dead twin entirely
// (silent data loss).  D1 (round-1 council blocker): seat-keying the dedup split the keyspace
// against seatLoss.deadBenchSeats, which `verdict-seat-loss.js :: deriveSeatLoss` derives from the SAME dead legs that
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

// v4.9 W9 — the `seat-unbound` shapes. SEVEN emit sites ride this channel (three arms of
// run-retry-notes.js plus one each in stage1-bind.js, run-debate-revote.js, run-stage2.js and
// run-stages.js) and they do not mean the same thing, which is why the consumers gate rather
// than admitting it raw. The five fixtures below cover every family: the first two are
// retried-and-still-dead seat losses; the rest are not losses this surface owns.
const unboundPartial = (seat, seatId) => ({          // run-retry-notes.js :: waveStillDeadNote
  kind: 'degrade', channel: 'seat-unbound',
  data: { waveId: 'r1-s1', models: [seat], reason: 'x', retryWaveId: 'w1',
    seat, seatId: seatId || null },
});
const unboundMissingLeg = (seat, seatId) => ({       // :: missingLegStillDeadNote, 'missing' arm
  kind: 'degrade', channel: 'seat-unbound',
  data: { seat, status: null, reason: null, retryWaveId: 'w1',
    firstFailure: { seat, seatId: seatId || null, class: 'missing', waveId: 'r1-s1', reason: 'x' } },
});
const orphanLeg = (seat) => ({                       // stage1-bind.js :: orphanLegNote
  kind: 'degrade', channel: 'seat-unbound',
  data: { waveId: 'r1-s1', legId: 'leg-7', seat },
});
const reVoteUnbound = () => ({                       // run-debate-revote.js :: reVoteUnboundNote
  kind: 'degrade', channel: 'seat-unbound',
  data: { waveId: 'r1-rv', legId: 'leg-9', judge: 'd', key: 'd' },
});
const skippedPartial = (seat) => ({                  // run-stages.js, skipped-retry path
  kind: 'degrade', channel: 'seat-unbound',
  data: { waveId: 'r1-s1', models: [seat], reason: 'x', seat },
});
const stage2Unbound = (seat) => ({                   // run-stage2.js, judge leg never returned
  kind: 'degrade', channel: 'seat-unbound',
  data: { waveId: 'r1-s2', seat },
});

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

/**
 * v4.9 W9 (SI-02) — `seat-unbound` stops being invisible.
 *
 * NAMED MUTANTS, all measured against `tests/workspace/` (533 tests at HEAD) and
 * `tests/council/verdict-degrades.test.js` (26). Every red set below was OBSERVED, not
 * predicted; each mutation was applied, run, and reverted one at a time.
 *
 * UNBOUNDBLIND-A — `live-dead-seats.js :: isSeatLoss`, seat-unbound arm disabled.
 *   9 red: the five W9-deadSeats cases, "a mixed array admits ONLY the gated record",
 *   "a seat-unbound critic record is seat-keyed on the same rule", "the gated seat-unbound
 *   family reaches the live path too", and BOTH drift-pin W9 cases in workspace-seats.test.js.
 * UNBOUNDBLIND-B — the `workspace-seats.js :: retriedSeats` twin disabled instead.
 *   2 red: the two drift-pin W9 cases. That pin is the ONLY thing holding the mirror, which
 *   is why it is the one that must never be deleted "because deadSeats already covers it".
 * GATERAW-A — `isSeatLoss` drops the retry-family conjunct.
 *   6 red: both ORPHAN-LEG controls, the Stage-2 judge control, "a mixed array…", R-W9a, and
 *   the live-path case. (Re-measured after the Stage-2 control was added; it was 5 before.)
 * GATERAW-B — `retriedSeats` drops it. 1 red: the drift pin's ORPHAN-LEG case.
 * GATERAW-C — `verdict-seat-loss.js :: deriveSeatLoss`'s `gatedUnbound` drops it.
 *   4 red in verdict-degrades: both orphan controls, the Stage-2 judge control, R-W9a.
 * ALIASROLE — `roleOf` loses its seat-identity branch (R4 reverted).
 *   2 red: "R4 FIXED…" and "a seat-unbound critic record is seat-keyed…".
 * BYROLEALIAS — the critic filter looks up `s.model` instead of `s.seat || s.model`.
 *   2 red: "byRole is seat-keyed too…" and the R-W9b fallback.
 * BYROLEUNSEATED — the seat-keyed `byRole` WRITE is removed but the lookup kept.
 *   1 red: "the dead CRITIC seat itself is still tagged critic, and still suppressed…".
 *   Both halves of that pair are therefore load-bearing in opposite directions.
 *
 * ⚠️ The seat-presence conjunct (`data.seatId || data.seat`) is NOT pinnable here: dropping it
 * from either renderer reds nothing, because `add()` and `retriedSeats`' `if (key)` already
 * refuse a nameless candidate. It IS load-bearing in the verdict twin and is pinned there.
 */
describe('W9 — deadSeats admits the GATED seat-unbound family', () => {
  test('a partial-wave seat-unbound record renders a dead row', () => {
    const out = rows([unboundPartial('d', 'd#2')]);
    expect(out).toHaveLength(1);
    expect(out[0].model).toBe('d');            // display stays the ALIAS
    expect(out[0].seat).toBe('d#2');           // …keyed on the seat id P1 now emits
    expect(out[0].statusText).toBe('did not review — retried once');
  });

  test('the partial arm is seat-keyed: a dead twin beside a LIVE twin still renders', () => {
    // The whole point of P1. Before it, this record carried only the alias and the live
    // twin erased it — M4's silent erasure, on the one arm PR5c did not reach.
    const out = rows([unboundPartial('d', 'd#2')], null, [{ model: 'd', seat: 'd#1', role: 'seat' }]);
    expect(out).toHaveLength(1);
    expect(out[0].seat).toBe('d#2');
  });

  test('a missing-leg seat-unbound record renders, keyed by firstFailure.seatId', () => {
    const out = rows([unboundMissingLeg('d', 'd#2')], null, [{ model: 'd', seat: 'd#1', role: 'seat' }]);
    expect(out).toHaveLength(1);
    expect(out[0].seat).toBe('d#2');
  });

  test('an identified seat-unbound record naming a LIVE seat is still suppressed', () => {
    // Both directions: admitting the channel must not disable D6 suppression for it.
    expect(rows([unboundPartial('d', 'd#1')], null, [{ model: 'd', seat: 'd#1', role: 'seat' }]))
      .toHaveLength(0);
  });

  test('an alias-only seat-unbound record still renders when nothing is live', () => {
    expect(rows([unboundPartial('alpha', null)])).toHaveLength(1);
  });
});

describe('W9 — controls: the OTHER seat-unbound shapes stay out (mutant GATERAW)', () => {
  test('an ORPHAN-LEG note renders NOTHING — a review LANDED, it is not a lost seat', () => {
    expect(rows([orphanLeg('d')])).toHaveLength(0);
  });

  test('an orphan-leg note cannot be rescued by a live bench either', () => {
    expect(rows([orphanLeg('d')], null, [{ model: 'other', seat: null, role: 'seat' }]))
      .toHaveLength(0);
  });

  test('a reVoteUnbound note renders NOTHING — it names a judge, not a lost reviewer', () => {
    expect(rows([reVoteUnbound()])).toHaveLength(0);
  });

  test('a Stage-2 judge-side note renders NOTHING — that seat DID review', () => {
    // The sharpest reason the gate is retry-family and not `data.legId`: this note carries no
    // legId, so a legId-only rule would admit it and paint "did not review" on a seat whose
    // review is on disk. It merely failed to JUDGE.
    expect(rows([stage2Unbound('d')])).toHaveLength(0);
  });

  test('a mixed array admits ONLY the gated record', () => {
    const out = rows([orphanLeg('d'), unboundPartial('e', 'e#1'), reVoteUnbound(),
      stage2Unbound('f'), skippedPartial('g')]);
    expect(out.map(r => r.model)).toEqual(['e']);
  });

  /**
   * ⚠️ DISCLOSED RESIDUAL (v4.9 W9, measured — reported to the wave lead, not ruled on here).
   * `run-stages.js`'s skipped-retry path emits a PARTIAL `seat-unbound` note carrying
   * `{waveId, models, reason, seat}` and no retry-family field at all, because that seat was
   * never retried. It is a genuine loss, and the retry-family gate this plan specifies
   * excludes it. Widening the gate to admit it (e.g. on `models` presence) would also have to
   * keep out `run-stage2.js`'s judge-side `seat-unbound` note — `{waveId, seat}` for a seat
   * that DID review and merely failed to judge — which the retry-family gate excludes for
   * free. Pinned here so the exclusion is deliberate rather than accidental.
   */
  test('R-W9a (known-wrong): the SKIPPED-path partial note is excluded — it has no retry family', () => {
    expect(rows([skippedPartial('d')])).toHaveLength(0);
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

  test('B2: the SAME dead-wave record twice renders TWO rows, not four', () => {
    // `unid` candidates skip the alias-keyed `seen` map, so before this they had no defence
    // against a repeated record. Deduped on (waveId, slot) in their own namespace.
    const w = deadWave(['d', 'd'], [null, null]);
    expect(rows([w, w])).toHaveLength(2);
  });

  test('B2 control: two DIFFERENT waves with unnamed slots stay distinct', () => {
    const w1 = deadWave(['d', 'd'], [null, null]);
    const w2 = { kind: 'degrade', channel: 'dead-wave',
      data: { waveId: 'r1-s2', models: ['d', 'd'], seats: [null, null],
        reason: 'x', retryWaveId: 'w1' } };
    expect(rows([w1, w2])).toHaveLength(4);
  });

  test('B1: an UNIDENTIFIED dead seat is NOT hidden by a live twin on its alias', () => {
    // ⛔ Shipped as disclosed residual R7 and rejected by the code council as a BLOCKER. It was
    // the PR's own thesis applied on the producer side but not here: emitting `null` instead of
    // the alias says "unidentified" and "the alias" are DIFFERENT statements — and then the
    // filter fell back to the alias, re-asserting the equivalence it had just removed.
    // A live d#1 does not prove the dead one was d#1; it could be d#2. Suppressing is unjustified,
    // and silent. A degrade record means the seat stayed dead after its retry, so a live seat on
    // the same alias is a DIFFERENT seat by definition.
    expect(rows([deadWave(['d'], [null])], null,
      [{ model: 'd', seat: 'd#1', role: 'seat' }])).toHaveLength(1);
  });

  test('B1 control: an identified dead seat that IS the live one stays suppressed', () => {
    expect(rows([deadWave(['d'], ['d#1'])], null,
      [{ model: 'd', seat: 'd#1', role: 'seat' }])).toHaveLength(0);
  });

  test('B1 control: a LEGACY alias-only record is still suppressed (R1 unchanged)', () => {
    expect(rows([deadLeg('d', null)], null,
      [{ model: 'd', seat: 'd#1', role: 'seat' }])).toHaveLength(0);
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
    // run-retry-group.js :: recordFailure keys firstFailures through seatKey(seatObj, seat)
    // (T2.1, 2026-08-16, `511cf43e` — was hand-inlined as `seatObj ? seatObj.id : seat` before
    // that refactor; same rule, behaviour-preserving), so a seat the
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

  // R4 moved OUT of this block in v4.9 W9 — it is fixed, and its pin now asserts the fixed
  // behaviour under "W9 — R4". See that block for what still falls back to alias equality.
});

/**
 * v4.9 W9 (R4) — the critic path keys on seat identity.
 *
 * The defect: `deadSeats` tagged a candidate `role:'critic'` by ALIAS equality with
 * `run.critic`, so on a bench where one alias holds both a critic seat and a bench seat the
 * tag landed on the wrong candidate, and critic candidates then suppress through `byRole` —
 * a different map from `reviewing`, which PR5c's seat-keying never reached. Measured: 0 rows.
 *
 * The fix threads `run.criticSeat` (real run.json state, seeded at `run-state.js ::
 * initCouncilRun`, set at `run.js` from `seats.js :: preflightSeats`) into `runMeta`. When the
 * record names a seat AND the run names a critic SEAT, role derives from seat identity;
 * otherwise alias equality stays the fallback, so every legacy document behaves as before.
 */
describe('W9 — R4: the critic path is seat-keyed', () => {
  const criticMeta = { critic: 'd', criticSeat: 'd#1' };

  test('R4 FIXED: a dead BENCH twin beside a live CRITIC twin renders ONE row, correctly labelled', () => {
    const out = rows([deadLeg('d', 'd#2')], null,
      [{ model: 'd', seat: 'd#1', role: 'critic' }], criticMeta);
    expect(out).toHaveLength(1);
    expect(out[0].seat).toBe('d#2');
    expect(out[0].role).toBeNull();          // it is the BENCH twin — not the critic
  });

  test('the dead CRITIC seat itself is still tagged critic, and still suppressed by a live critic leg', () => {
    expect(rows([deadLeg('d', 'd#1')], null,
      [{ model: 'd', seat: 'd#1', role: 'critic' }], criticMeta)).toHaveLength(0);
    const out = rows([deadLeg('d', 'd#1')], null, [], criticMeta);
    expect(out).toHaveLength(1);
    expect(out[0].role).toBe('critic');
  });

  test('byRole is seat-keyed too: a live critic leg for a DIFFERENT seat does not clear it', () => {
    // The contradictory shape (two critic-role seats on one alias) is loud, not silent.
    const out = rows([deadLeg('d', 'd#1')], null,
      [{ model: 'd', seat: 'd#2', role: 'critic' }], criticMeta);
    expect(out).toHaveLength(1);
    expect(out[0].role).toBe('critic');
  });

  test('a seat-unbound critic record is seat-keyed on the same rule', () => {
    const out = rows([unboundPartial('d', 'd#1')], null, [], criticMeta);
    expect(out[0].role).toBe('critic');
    expect(rows([unboundPartial('d', 'd#2')], null, [], criticMeta)[0].role).toBeNull();
  });

  test('FALLBACK (R-W9b): with no criticSeat the ROLE is still alias-inferred, but the row survives', () => {
    // Pre-`criticSeat` run.json, or a run that resolved none. The role tag falls back to alias
    // equality and is WRONG here (this is the bench twin) — the residual the fix deliberately
    // does not invent its way out of. But the seat-keyed `byRole` lookup still saves the ROW,
    // so the silent erasure is gone even on the fallback path. Over-labelling is visible;
    // a missing row is not — the same direction this module takes everywhere else.
    const out = rows([deadLeg('d', 'd#2')], null,
      [{ model: 'd', seat: 'd#1', role: 'critic' }], { critic: 'd' });
    expect(out).toHaveLength(1);
    expect(out[0].seat).toBe('d#2');
    expect(out[0].role).toBe('critic');     // known-wrong label, pinned so it cannot rot
  });

  test('FALLBACK: an alias-only record on a criticSeat run still uses alias equality', () => {
    // The record names no seat, so seat identity cannot decide; the legacy rule applies.
    const out = rows([deadLeg('d', null)], null, [], criticMeta);
    expect(out[0].role).toBe('critic');
  });

  test('CONTROL: a unique-alias critic is unchanged, both keyed and alias-only', () => {
    const meta = { critic: 'alpha', criticSeat: 'alpha' };
    expect(rows([deadLeg('alpha', 'alpha')], null, [], meta)[0].role).toBe('critic');
    expect(rows([deadLeg('alpha', null)], null, [], meta)[0].role).toBe('critic');
    expect(rows([deadLeg('alpha', 'alpha')], null,
      [{ model: 'alpha', seat: null, role: 'critic' }], meta)).toHaveLength(0);
  });

  test('CONTROL: the seatLoss-derived critic candidate is untouched by the seat key', () => {
    const out = rows([], { criticRequested: 'd', criticSeated: false }, [], criticMeta);
    expect(out).toHaveLength(1);
    expect(out[0].role).toBe('critic');
    expect(out[0].seat).toBeNull();
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
   * T6 — the live tick. RE-DERIVED v4.9 W9, and the header this replaced was FALSE.
   *
   * It said `live-normalize.js :: seatOf` emits `{id: leg.taskId, model, modelInput, role, ...}`
   * with "no `seat` field at all", so the seat-id arm of `reviewing` was inert on this path.
   * That stopped being true when v4.8 R5 shipped `seat: leg.seat || null` on that projection —
   * measured at `src/workspace/live-normalize.js :: seatOf`, whose own comment names
   * `live-dead-seats.js`'s `if (s.seat)` arm as the reason it exists. The R5 BACKLOG entry
   * ("closing it needs a seat id on the live leg rows") was therefore describing work already
   * done, and the pin below was reading as a LIVE DEFECT when it is a LEGACY-PAYLOAD one.
   *
   * What is actually pinned: `livePayloadSeat` below is deliberately a PRE-R5 payload — no
   * `seat` key — because a payload from an older engine, or a leg whose row never carried a
   * seat, still reaches this renderer. On that shape the seat-id arm genuinely cannot match
   * and the dead row renders until the terminal refresh. The modern payload is the control
   * directly beneath it, and it suppresses. The pin stays because the legacy path is real;
   * it no longer claims the live path has no seat identity.
   */
  describe('T6 — the live tick: seat identity is present, legacy payloads excepted', () => {
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
    // Post-R5 shape: the same projection PLUS the seat id `seatOf` has emitted since v4.8 R5.
    const modernPayloadSeat = (model, seat) => ({ ...livePayloadSeat(model), seat });
    const deadRowsIn = (tbody) => tbody.children.filter(r => r.classList.contains('seat-dead'));

    test('dead twins DO separate on the live path — M3 does not persist', () => {
      const tbody = document.getElementById('seats-body');
      const seats = [livePayloadSeat('other')];
      AmicusRender.renderSeats(tbody, seats, false, () => null);
      AmicusSeats.appendDeadRows({ ok: true, seats, degrades: twinDegrades });
      expect(deadRowsIn(tbody)).toHaveLength(2);
    });

    test('LEGACY payload (pre-R5, no seat key): a stale seat-keyed record still renders a dead row', () => {
      const tbody = document.getElementById('seats-body');
      const seats = [livePayloadSeat('d')];
      AmicusRender.renderSeats(tbody, seats, false, () => null);
      AmicusSeats.appendDeadRows({ ok: true, seats, degrades: [deadLeg('d', 'd#1')] });
      expect(deadRowsIn(tbody)).toHaveLength(1);
    });

    test('MODERN payload (post-R5): the same stale record IS suppressed live', () => {
      // The re-derivation's evidence. Same degrade, same renderer, one field's difference.
      const tbody = document.getElementById('seats-body');
      const seats = [modernPayloadSeat('d', 'd#1')];
      AmicusRender.renderSeats(tbody, seats, false, () => null);
      AmicusSeats.appendDeadRows({ ok: true, seats, degrades: [deadLeg('d', 'd#1')] });
      expect(deadRowsIn(tbody)).toHaveLength(0);
    });

    test('MODERN payload: a genuinely dead twin beside a live one still renders live', () => {
      const tbody = document.getElementById('seats-body');
      const seats = [modernPayloadSeat('d', 'd#1')];
      AmicusRender.renderSeats(tbody, seats, false, () => null);
      AmicusSeats.appendDeadRows({ ok: true, seats, degrades: [deadLeg('d', 'd#2')] });
      expect(deadRowsIn(tbody)).toHaveLength(1);
    });

    test('the gated seat-unbound family reaches the live path too', () => {
      const tbody = document.getElementById('seats-body');
      const seats = [modernPayloadSeat('d', 'd#1')];
      AmicusRender.renderSeats(tbody, seats, false, () => null);
      AmicusSeats.appendDeadRows({ ok: true, seats,
        degrades: [unboundPartial('d', 'd#2'), orphanLeg('e')] });
      expect(deadRowsIn(tbody)).toHaveLength(1);
    });
  });

});
