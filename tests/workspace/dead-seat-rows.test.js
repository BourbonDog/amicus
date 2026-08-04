'use strict';

const { makeFakeDom } = require('./helpers/fake-workspace-page');

/**
 * v4.6.2 PR4 Task 2 ("dead-seat rows"): a seat the run announced dead — via
 * run.json's `degrades[]` (dead-leg/dead-wave) or verdict.json's derived
 * `seatLoss` (the critic backstop) — must render a row on the seats panel.
 * Record shapes below are verified against src/council/run-retry-notes.js
 * (retryLegStillDeadNote/missingLegStillDeadNote: a still-dead-after-retry
 * record carries `data.retryWaveId` + `data.firstFailure`; the run-stages.js
 * skipped-path notes carry neither) and src/council/verdict.js
 * (summarizeSeatLoss/deriveSeatLoss's `criticRequested`/`criticSeated`
 * shape). Test (a)'s fixture models the real run `2039b2d1` shape the task
 * brief cites: one dead critic carrying firstFailure+retryWaveId, five live
 * bench legs.
 *
 * Exercises the real derivation (window.AmicusLive.deadSeats) and the real
 * paint (window.AmicusSeats.renderDeadSeatRows) directly against the
 * fake-DOM harness — same level sibling suites test at (workspace-matrix.
 * test.js calls AmicusMatrix.renderMatrix directly; workspace-render.test.js
 * calls AmicusRender.renderSeats directly) rather than through the thin
 * window.AmicusApp-reading renderSeatsPanel() wrapper, which
 * workspace-app-boundary.test.js already exercises end to end (and whose
 * fixture — no `degrades`, empty `verdict: {}` — is itself a live regression
 * guard for case (d) through the real entry point).
 */
describe('dead-seat rows (D6: announced-dead seats render on the seats panel)', () => {
  let AmicusLive;
  let AmicusRender;
  let AmicusSeats;
  let document;

  beforeEach(() => {
    jest.resetModules(); // force every IIFE to re-run against THIS test's fresh globals below
    const fake = makeFakeDom();
    document = fake.document;
    global.window = fake.window;
    global.document = document;
    global.NodeFilter = fake.NodeFilter;
    // Canonical load order (script-load-order.js): live-model -> workspace-render -> workspace-seats.
    require('../../electron/workspace-ui/live-model'); // eslint-disable-line global-require
    require('../../electron/workspace-ui/workspace-render'); // eslint-disable-line global-require
    require('../../electron/workspace-ui/workspace-seats'); // eslint-disable-line global-require
    AmicusLive = global.window.AmicusLive;
    AmicusRender = global.window.AmicusRender;
    AmicusSeats = global.window.AmicusSeats;
  });

  afterEach(() => {
    delete global.window;
    delete global.document;
    delete global.NodeFilter;
  });

  /** Live rows then dead rows into a fresh tbody — mirrors renderSeatsPanel()'s own call order. */
  function paint(costRows, degrades, seatLoss, blindOn, labelOf) {
    const tbody = document.createElement('tbody');
    const liveSeats = AmicusLive.seatsFromRunStats(costRows);
    AmicusRender.renderSeats(tbody, liveSeats, blindOn, labelOf);
    const dead = AmicusLive.deadSeats(degrades, seatLoss, liveSeats);
    AmicusSeats.renderDeadSeatRows(tbody, dead, blindOn, labelOf);
    return tbody;
  }

  test('(a) a dead critic with firstFailure+retryWaveId renders exactly one seat-dead row, "did not review — retried once", after five live rows', () => {
    const bench = ['alpha', 'bravo', 'charlie', 'delta', 'echo'];
    const costRows = bench.map((m) => (
      { model: m, role: 'seat', status: 'complete', durationMs: 1000, costDisplay: '$0.10' }
    ));
    const firstFailure = { seat: 'foxtrot', class: 'wave', waveId: 'r1-c1', reason: 'no legs produced' };
    const degrades = [{
      kind: 'degrade', channel: 'dead-leg', what: 'seat foxtrot did not review',
      why: "the leg ended 'error'; its once-only retry also ended 'error'", effect: '5 of 5 seats reviewed',
      data: { seat: 'foxtrot', status: 'error', reason: 'timed out', firstFailure, retryWaveId: 'r1-c1r1' },
    }];
    const seatLoss = { criticRequested: 'foxtrot', criticSeated: false, reason: 'timed out', deadBenchSeats: [] };

    const tbody = paint(costRows, degrades, seatLoss, false, () => null);

    expect(tbody.children.length).toBe(6);
    const deadRows = tbody.children.filter((r) => r.classList.contains('seat-dead'));
    expect(deadRows.length).toBe(1);
    expect(tbody.children[5]).toBe(deadRows[0]); // appended AFTER the five live rows
    expect(deadRows[0].children[0].textContent).toBe('foxtrot');
    expect(deadRows[0].children[2].textContent).toBe('did not review — retried once');
    expect(deadRows[0].children[6].textContent).toBe(''); // no cost cell
  });

  test('(b) a seat that died then recovered via retry (has a usable leg) renders NO dead row', () => {
    const costRows = [
      { model: 'alpha', role: 'seat', status: 'complete', durationMs: 1000, costDisplay: '$0.10' },
      { model: 'delta', role: 'seat', status: 'complete', durationMs: 1000, costDisplay: '$0.08' }, // recovered
    ];
    // D6's own safety net: even if a dead-wave record still names a seat that
    // went on to produce a usable leg (materialize into the cost rows above —
    // exactly what an SL-2 heal means), the seats panel must not show BOTH a
    // live row and a ghost dead row for it.
    const degrades = [{
      kind: 'degrade', channel: 'dead-wave', what: 'Stage-1 wave r1-s1 (delta) produced NO legs',
      why: 'no reason recorded; the once-only retry wave also produced no legs', effect: 'seats reviewed',
      data: { waveId: 'r1-s1', models: ['delta'], reason: 'no reason recorded', retryWaveId: 'r1-s1r1' },
    }];

    const tbody = paint(costRows, degrades, null, false, () => null);

    expect(tbody.children.length).toBe(2);
    expect(tbody.children.filter((r) => r.classList.contains('seat-dead')).length).toBe(0);
  });

  test('(c) blind mode masks the dead row name exactly as live rows', () => {
    const costRows = [{ model: 'alpha', role: 'seat', status: 'complete', durationMs: 1000, costDisplay: '$0.10' }];
    const degrades = [{
      kind: 'degrade', channel: 'dead-leg', what: 'seat bravo did not review',
      why: "the leg ended 'error' with no usable output", effect: '1 of 2 seats reviewed',
      data: { seat: 'bravo', status: 'error', reason: 'timed out' },
    }];
    const labelMap = { alpha: 'Review A', bravo: 'Review B' };
    const labelOf = (m) => labelMap[m] || null;

    const blindTbody = paint(costRows, degrades, null, true, labelOf);
    expect(blindTbody.children[0].children[0].textContent).toBe('Review A'); // live row, blind ON
    expect(blindTbody.children[1].children[0].textContent).toBe('Review B'); // dead row, blind ON — same mask

    const openTbody = paint(costRows, degrades, null, false, labelOf);
    expect(openTbody.children[0].children[0].textContent).toBe('alpha'); // live row, blind OFF
    expect(openTbody.children[1].children[0].textContent).toBe('bravo'); // dead row, blind OFF — same mask
  });

  test('(d) a run with no degrades renders zero dead rows (no regression on the happy path)', () => {
    const costRows = [
      { model: 'alpha', role: 'seat', status: 'complete', durationMs: 1000, costDisplay: '$0.10' },
      { model: 'bravo', role: 'seat', status: 'complete', durationMs: 1000, costDisplay: '$0.09' },
    ];

    const tbody = paint(costRows, [], null, false, () => null);
    expect(tbody.children.length).toBe(2);
    expect(tbody.children.filter((r) => r.classList.contains('seat-dead')).length).toBe(0);

    // Also the fully-absent shape (an older run.json with no degrades key at all, no verdict).
    const tbody2 = paint(costRows, undefined, undefined, false, () => null);
    expect(tbody2.children.length).toBe(2);
    expect(tbody2.children.filter((r) => r.classList.contains('seat-dead')).length).toBe(0);
  });

  // Supplementary (not one of the brief's four required cases): renderSeatsPanel() repaints
  // #seats-body on every live-poll tick and every blind toggle, always into the SAME tbody —
  // renderDeadSeatRows() is a full rebuild every call, not a keyed diff, so this is the property
  // that stops dead rows from silently accumulating (2, 4, 6, ...) across repeated renders in the
  // real app. It holds because renderSeats(tbody, liveSeats, ...) always runs FIRST and its own
  // leaver-removal treats any 'dead:'-prefixed row from a PRIOR call as an unrecognized orphan
  // (its key is never in the live `seats` it was just given) and removes it before the dead rows
  // are freshly re-appended.
  test('(supplementary) repainting the same tbody twice does not accumulate duplicate dead rows', () => {
    const costRows = [{ model: 'alpha', role: 'seat', status: 'complete', durationMs: 1000, costDisplay: '$0.10' }];
    const degrades = [{
      kind: 'degrade', channel: 'dead-leg', what: 'seat bravo did not review',
      why: "the leg ended 'error' with no usable output", effect: '1 of 2 seats reviewed',
      data: { seat: 'bravo', status: 'error', reason: 'timed out' },
    }];

    const tbody = document.createElement('tbody');
    const liveSeats = AmicusLive.seatsFromRunStats(costRows);
    for (let i = 0; i < 2; i += 1) {
      AmicusRender.renderSeats(tbody, liveSeats, false, () => null);
      const dead = AmicusLive.deadSeats(degrades, null, liveSeats);
      AmicusSeats.renderDeadSeatRows(tbody, dead, false, () => null);
    }

    expect(tbody.children.length).toBe(2);
    expect(tbody.children.filter((r) => r.classList.contains('seat-dead')).length).toBe(1);
  });
});
