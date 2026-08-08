'use strict';

const { makeFakeDom } = require('./helpers/fake-workspace-page');

/**
 * D8 extraction pin (Task 1, v4.6.2 PR4): renderSeatsPanel moved out of
 * workspace-panels.js into its own window.AmicusSeats module (workspace-seats.js);
 * panels.js keeps a thin delegate so window.AmicusPanels.renderSeatsPanel — the P2
 * contract surface workspace-app-boundary.test.js already pins — keeps working. That
 * existing boundary test only proves END-TO-END behavior (seats-body gets painted via a
 * full openRun()); it can't tell a genuine extraction apart from a copy-paste duplicate
 * left behind in panels.js. This is the one thin delegate pin the brief calls for: prove
 * panels.js's renderSeatsPanel actually ROUTES THROUGH window.AmicusSeats.renderSeatsPanel
 * at call time, not a second, silently-diverging copy of the logic.
 */
describe('workspace-seats.js extraction: panels.renderSeatsPanel delegates to AmicusSeats', () => {
  beforeEach(() => {
    jest.resetModules(); // force both IIFEs to re-run against THIS test's fresh globals below
    const fake = makeFakeDom();
    global.window = fake.window;
    global.document = fake.document;
    global.NodeFilter = fake.NodeFilter;
    // workspace-seats.js must load before workspace-panels.js (its delegate target),
    // same order as index.html and the canonical SCRIPT_LOAD_ORDER.
    // eslint-disable-next-line global-require
    require('../../electron/workspace-ui/workspace-seats');
    // eslint-disable-next-line global-require
    require('../../electron/workspace-ui/workspace-panels');
  });

  afterEach(() => {
    delete global.window;
    delete global.document;
    delete global.NodeFilter;
  });

  test('window.AmicusPanels.renderSeatsPanel still exists and delegates to window.AmicusSeats.renderSeatsPanel at call time', () => {
    expect(typeof global.window.AmicusPanels.renderSeatsPanel).toBe('function');
    const spy = jest.spyOn(global.window.AmicusSeats, 'renderSeatsPanel').mockImplementation(() => {});
    global.window.AmicusPanels.renderSeatsPanel();
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

/**
 * PR1F-4 (v4.7 PR7): retry marker on the surviving errored seat row. Owner ruling
 * (2026-08-08): a trailing FLAG COLUMN (cell index 8, the table's unlabeled 9th <th> —
 * index.html:51), not a status-cell suffix — a dead seat's own primary row can legitimately
 * carry status:'complete' (proven end to end elsewhere), and a suffix would render
 * "complete — retried once", reading as "it finished, twice".
 *
 * Drives the real read path: window.AmicusSeats.renderSeatsPanel(), reached via a minimal
 * window.AmicusApp stub (state.detail.derived.cost.rows / .run / .verdict, state.blind,
 * labelOf, $) — same level of directness dead-seat-rows.test.js's appendDeadRows describe
 * block already uses for the live-tick twin. #seats-body already exists in the shared fake
 * DOM's page skeleton (fake-workspace-page.js), so no ad hoc tbody is needed.
 */
describe('workspace-seats.js: PR1F-4 retry marker (cell 8, .seat-retried)', () => {
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
    AmicusSeats = global.window.AmicusSeats;
  });

  afterEach(() => {
    delete global.window;
    delete global.document;
    delete global.NodeFilter;
  });

  /** Drives the real renderSeatsPanel() via a minimal window.AmicusApp stub. */
  function paint(costRows, degrades, blindOn, labelOf, critic) {
    const tbody = document.getElementById('seats-body');
    global.window.AmicusApp = {
      $: (id) => document.getElementById(id),
      labelOf: labelOf || (() => null),
      state: {
        blind: !!blindOn,
        detail: {
          derived: { cost: { rows: costRows } },
          run: { degrades, critic: critic || null },
          verdict: null,
        },
      },
    };
    AmicusSeats.renderSeatsPanel();
    return tbody;
  }

  test('(1) a seat with a dead-leg degrade carrying retryWaveId gets cell 8 "↻ retried once" and class seat-retried', () => {
    const costRows = [{ model: 'alpha', role: 'seat', status: 'error', costDisplay: '$0.01' }];
    const degrades = [{
      kind: 'degrade', channel: 'dead-leg', what: 'seat alpha did not review',
      why: "the leg ended 'error'; its once-only retry also ended 'error'", effect: '0 of 1 seats reviewed',
      data: { seat: 'alpha', status: 'error', reason: 'timed out', retryWaveId: 'r1-c1r1' },
    }];

    const tbody = paint(costRows, degrades);

    expect(tbody.children.length).toBe(1);
    expect(tbody.children[0].classList.contains('seat-retried')).toBe(true);
    expect(tbody.children[0].children[8].textContent).toBe('↻ retried once');
  });

  test('(2) the same seat with status:"complete" still gets cell 8 marked, and the status cell still reads exactly "complete" (the honesty property)', () => {
    const costRows = [{ model: 'alpha', role: 'seat', status: 'complete', costDisplay: '$0.01' }];
    const degrades = [{
      kind: 'degrade', channel: 'dead-leg', what: 'seat alpha did not review',
      why: "the leg ended 'error'; its once-only retry also ended 'error'", effect: '0 of 1 seats reviewed',
      data: { seat: 'alpha', status: 'error', reason: 'timed out', retryWaveId: 'r1-c1r1' },
    }];

    const tbody = paint(costRows, degrades);

    expect(tbody.children[0].children[2].textContent).toBe('complete'); // NOT "complete — retried once"
    expect(tbody.children[0].children[8].textContent).toBe('↻ retried once');
    expect(tbody.children[0].classList.contains('seat-retried')).toBe(true);
  });

  test('(3) a seat whose only degrade is kind:"heal"/channel:"stage1-retry" (a RECOVERED seat) leaves cell 8 empty', () => {
    const costRows = [{ model: 'alpha', role: 'seat', status: 'complete', costDisplay: '$0.01' }];
    const firstFailure = { seat: 'alpha', class: 'leg', status: 'error', reason: 'timed out' };
    const degrades = [{
      kind: 'heal', channel: 'stage1-retry', what: 'seat alpha reviewed on retry',
      why: "its first leg ended 'error' with no usable output and was relaunched once",
      effect: 'The seat is in this council; nothing was lost',
      data: { seat: 'alpha', retryWaveId: 'r1-c1r1', retryOfWaveId: 'r1-c1', firstFailure },
    }];

    const tbody = paint(costRows, degrades);

    expect(tbody.children.length).toBe(1);
    expect(tbody.children[0].children[8].textContent).toBe('');
    expect(tbody.children[0].classList.contains('seat-retried')).toBe(false);
  });

  test('(4) a dead-wave degrade listing two models marks both their rows', () => {
    const costRows = [
      { model: 'bravo', role: 'seat', status: 'error', costDisplay: '$0.01' },
      { model: 'charlie', role: 'seat', status: 'error', costDisplay: '$0.01' },
    ];
    const degrades = [{
      kind: 'degrade', channel: 'dead-wave', what: 'Stage-1 wave r1-s1 (bravo, charlie) produced NO legs',
      why: 'no reason recorded; the once-only retry wave also produced no legs', effect: '0 of 2 seats reviewed',
      data: { waveId: 'r1-s1', models: ['bravo', 'charlie'], reason: 'no reason recorded', retryWaveId: 'r1-s1r1' },
    }];

    const tbody = paint(costRows, degrades);

    expect(tbody.children.length).toBe(2);
    tbody.children.forEach((row) => {
      expect(row.classList.contains('seat-retried')).toBe(true);
      expect(row.children[8].textContent).toBe('↻ retried once');
    });
  });

  test('(5) a non-reviewing role (chair) with a matching degrade is NOT marked', () => {
    const costRows = [{ model: 'alpha', role: 'chair', status: 'error', costDisplay: '$0.01' }];
    const degrades = [{
      kind: 'degrade', channel: 'dead-leg', what: 'seat alpha did not review',
      why: "the leg ended 'error'; its once-only retry also ended 'error'", effect: '0 of 1 seats reviewed',
      data: { seat: 'alpha', status: 'error', reason: 'timed out', retryWaveId: 'r1-c1r1' },
    }];

    const tbody = paint(costRows, degrades);

    // 'chair' is not a REVIEWING role (isReviewing/isReviewingRole both exclude it), so it also
    // does not suppress deadSeats' own unrelated ghost row for the same alias (D6 role-aware
    // suppression, live-model.js:275-284) — both rows exist. The assertion below is specifically
    // about the chair's OWN live row never picking up the PR1F-4 retry marker.
    expect(tbody.children.length).toBe(2);
    const liveRow = tbody.children.find((r) => !r.classList.contains('seat-dead'));
    expect(liveRow.classList.contains('seat-retried')).toBe(false);
    expect(liveRow.children[8].textContent).toBe('');
  });

  test('(6) a firstFailure of the WAVE shape (no status key) still marks the row and does not throw', () => {
    const costRows = [{ model: 'alpha', role: 'seat', status: 'error', costDisplay: '$0.01' }];
    const firstFailure = { seat: 'alpha', class: 'wave', waveId: 'r1-s1', reason: 'no legs produced' }; // no `status` key
    const degrades = [{
      kind: 'degrade', channel: 'dead-leg', what: 'seat alpha did not review',
      why: "its first wave r1-s1 produced no legs (no legs produced); its once-only retry leg ended 'error'",
      effect: '0 of 1 seats reviewed',
      data: { seat: 'alpha', status: 'error', reason: 'timed out', firstFailure, retryWaveId: 'r1-s1r1' },
    }];

    const tbody = paint(costRows, degrades);

    expect(tbody.children.length).toBe(1);
    expect(tbody.children[0].classList.contains('seat-retried')).toBe(true);
    expect(tbody.children[0].children[8].textContent).toBe('↻ retried once');
  });
});
