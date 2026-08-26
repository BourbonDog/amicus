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
    // suppression, live-dead-seats.js :: isReviewing) — both rows exist. The assertion below is specifically
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

  /**
   * Fix wave (whole-branch review, finding 2): the class write above was add-only —
   * renderSeats reuses rows keyed on `model:role` and never resets row.className itself, so a
   * guard-free `row.className += ' seat-retried'` both piles up duplicate tokens on repeat
   * repaints of the SAME retried seat and leaves a stale class on a row a LATER repaint reuses
   * for a seat that is not retried. Both consequences pinned below.
   */
  test('(7) repeated repaint of the SAME retried seat does not duplicate the seat-retried class token', () => {
    const costRows = [{ model: 'alpha', role: 'seat', status: 'error', costDisplay: '$0.01' }];
    const degrades = [{
      kind: 'degrade', channel: 'dead-leg', what: 'seat alpha did not review',
      why: "the leg ended 'error'; its once-only retry also ended 'error'", effect: '0 of 1 seats reviewed',
      data: { seat: 'alpha', status: 'error', reason: 'timed out', retryWaveId: 'r1-c1r1' },
    }];

    paint(costRows, degrades); // first repaint
    const tbody = paint(costRows, degrades); // second repaint of the same still-open run

    expect(tbody.children.length).toBe(1);
    const tokens = tbody.children[0].className.split(/\s+/).filter((c) => c === 'seat-retried');
    expect(tokens.length).toBe(1);
    expect(tbody.children[0].children[8].textContent).toBe('↻ retried once');
  });

  test('(8) a later repaint whose row is reused by a seat that is NOT retried clears both the class and cell 8', () => {
    const retriedCostRows = [{ model: 'alpha', role: 'seat', status: 'error', costDisplay: '$0.01' }];
    const retriedDegrades = [{
      kind: 'degrade', channel: 'dead-leg', what: 'seat alpha did not review',
      why: "the leg ended 'error'; its once-only retry also ended 'error'", effect: '0 of 1 seats reviewed',
      data: { seat: 'alpha', status: 'error', reason: 'timed out', retryWaveId: 'r1-c1r1' },
    }];
    paint(retriedCostRows, retriedDegrades); // run A: alpha/seat was retried

    const cleanCostRows = [{ model: 'alpha', role: 'seat', status: 'complete', costDisplay: '$0.01' }];
    const tbody = paint(cleanCostRows, []); // run B reuses the alpha/seat row key; NOT retried

    expect(tbody.children.length).toBe(1);
    expect(tbody.children[0].classList.contains('seat-retried')).toBe(false);
    expect(tbody.children[0].children[8].textContent).toBe('');
  });

  // ── v4.8 PR5b Task 2: twin benches ────────────────────────────────────────────────────
  // A bench that repeats an alias has DISTINCT seats (seats.js:67 mints `alias#N`). The
  // marker map was keyed on the alias, so one retried twin badged both rows. PR5a plumbed
  // the seat onto cost rows and PR5b Task 1 carries it onto seat rows as `seat`.
  //
  // ⚠️ The key is `firstFailure.seatId ?? data.seat` and the lookup is DUAL —
  // `retried[s.seat] || retried[s.model]`. Both arms are load-bearing and neither may be
  // dropped: seat-id records are precise, alias-only records (srcLegStillDeadNote,
  // dead-wave) can only be matched by alias. Pairing a dual key with a seat-id-only lookup
  // was the silent regression round 2 caught — it badged NOTHING for the alias-only
  // emitters, replacing a visible false positive with an invisible false negative.

  function badged(tbody) {
    return Array.prototype.slice.call(tbody.children)
      .filter((r) => r.children[8] && r.children[8].textContent === '↻ retried once').length;
  }

  const twinCostRows = [
    { model: 'deepseek', seat: 'deepseek#1', role: 'seat', status: 'complete', costDisplay: '$0.01' },
    { model: 'deepseek', seat: 'deepseek#2', role: 'seat', status: 'error', costDisplay: '$0.02' },
  ];

  test('(9) PR5b: a record naming ONE twin by seatId badges exactly that seat', () => {
    // retryLegStillDeadNote / missingLegStillDeadNote on their dead-leg branch: the only
    // emitter arm of five that names a seat (run-retry.test.js:628 pins the seatIds).
    const degrades = [{
      kind: 'degrade', channel: 'dead-leg', what: 'seat deepseek did not review',
      why: 'retried once', effect: '1 of 2 seats reviewed',
      data: {
        seat: 'deepseek', status: 'error', retryWaveId: 'r1-c1r1',
        firstFailure: { seat: 'deepseek', seatId: 'deepseek#2', class: 'leg', status: 'error' },
      },
    }];

    const tbody = paint(twinCostRows, degrades);

    expect(tbody.children.length).toBe(2);
    expect(badged(tbody)).toBe(1);
    // and it is the RIGHT one — seat two, not seat one
    expect(tbody.children[1].children[8].textContent).toBe('↻ retried once');
    expect(tbody.children[0].children[8].textContent).toBe('');
  });

  test('(10) PR5b: an ALIAS-only record on a twin bench badges both — disclosed imprecision, not a defect', () => {
    // srcLegStillDeadNote emits no firstFailure, so `data.seat` is all there is. The record
    // does not say WHICH seat failed, so no consumer can attribute it. Over-badging is the
    // deliberate failure direction: visible beats silent.
    const degrades = [{
      kind: 'degrade', channel: 'dead-leg', what: 'seat deepseek did not review',
      why: 'retry wave produced no legs', effect: '1 of 2 seats reviewed',
      data: { seat: 'deepseek', status: 'error', reason: null, retryWaveId: 'r1-c1r1' },
    }];

    expect(badged(paint(twinCostRows, degrades))).toBe(2);
  });

  test('(11) PR5b CONTROL: a distinct-alias bench is unaffected', () => {
    const degrades = [{
      kind: 'degrade', channel: 'dead-leg', what: 'seat alpha did not review',
      why: 'retried once', effect: '1 of 2 seats reviewed',
      data: { seat: 'alpha', status: 'error', retryWaveId: 'r1-c1r1' },
    }];
    const tbody = paint([
      { model: 'alpha', role: 'seat', status: 'error', costDisplay: '$0.01' },
      { model: 'beta', role: 'seat', status: 'complete', costDisplay: '$0.02' },
    ], degrades);

    expect(badged(tbody)).toBe(1);
    expect(tbody.children[0].children[8].textContent).toBe('↻ retried once');
  });

  test('(12) PR5b: the marker loop never sees `modelInput`, which is why the lookup may omit it', () => {
    // Council finding B1: the pre-PR lookup was `retried[s.modelInput || s.model]` and PR5b
    // dropped the modelInput arm. Safe ONLY because renderSeatsPanel (:101) drives this loop
    // exclusively from seatsFromRunStats output, which emits no modelInput — live payload seats,
    // which DO carry it (live-normalize.js seatOf), go to deadSeats (:217) and never reach here.
    // That was an undocumented, untested assumption; this pins it. If a future change adds
    // modelInput to the projection, or routes live seats through renderSeatsPanel, this goes red
    // and the `s.modelInput` arm must come back.
    const rows = window.AmicusLive.seatsFromRunStats([
      { model: 'deepseek', seat: 'deepseek#1', role: 'seat', status: 'ok', costDisplay: '$0.01' },
      { model: 'alpha', role: 'critic', status: 'error', costDisplay: '$0.02' },
    ]);
    expect(rows.length).toBe(2);
    rows.forEach((r) => {
      expect(Object.prototype.hasOwnProperty.call(r, 'modelInput')).toBe(false);
      expect(r.modelInput).toBeUndefined();
    });
  });

  test('(13) PR5b: a null seat id does not coerce into the string key "null"', () => {
    // Council finding A1: on a UNIQUE bench `s.seat` is null, and a bare `retried[s.seat]`
    // coerces null to the string key 'null' — so any seat with no seat id would match a degrade
    // record whose alias is literally `null`. Same class as the `toString` alias that crashed
    // the seats repaint (live-dead-seats.js :: deadSeats), which is why this family uses
    // Object.create(null). The `s.seat &&` guard in the lookup is what closes it.
    const degrades = [{
      kind: 'degrade', channel: 'dead-leg', what: 'seat null did not review',
      why: 'retried once', effect: '0 of 2 seats reviewed',
      data: { seat: 'null', status: 'error', retryWaveId: 'r1-c1r1' },
    }];
    // A unique bench: no `seat` on any cost row, so every seat row carries `seat: null`.
    const tbody = paint([
      { model: 'alpha', role: 'seat', status: 'complete', costDisplay: '$0.01' },
      { model: 'beta', role: 'seat', status: 'complete', costDisplay: '$0.02' },
    ], degrades);

    // THREE rows, not two: the two seat rows plus a dead-seat ghost for the alias `null`, which
    // has no cost row of its own and is therefore not suppressed. The ghost is expected and is
    // not what this pins — the discriminator is that NEITHER seat row carries the badge.
    // Without the `s.seat &&` guard both seat rows badge, because retried[null] reads
    // retried['null'].
    expect(tbody.children.length).toBe(3);
    expect(badged(tbody)).toBe(0);
  });

  /**
   * v4.8 PR5c Task 4 — restore the retriedSeats mirror.
   *
   * workspace-seats.js:49-54 said, verbatim, to "restore the full mirror rather than letting
   * the two drift silently" WHEN the deferred M3/M4 PR landed. This is that PR: Task 1 gave
   * srcLeg records `data.seatId` and dead-wave records `data.seats[]`, so the two comments
   * claiming "exactly one arm supplies it" and "dead-wave carries models[] — ALIASES, with no
   * seat and no firstFailure anywhere" both became false the moment it shipped.
   */
  describe('T4 — retriedSeats reads the new seat keys from Task 1', () => {
    const twinRows = [
      { model: 'd', seat: 'd#1', role: 'seat', status: 'ok', costDisplay: '$0.01' },
      { model: 'd', seat: 'd#2', role: 'seat', status: 'error', costDisplay: '$0.02' },
    ];
    const badged = (tbody) => tbody.children.filter(
      (r) => r.children[8] && r.children[8].textContent === '↻ retried once').length;

    test('a srcLeg record naming data.seatId badges ONLY that seat, not its live twin', () => {
      // Before Task 4 this keyed on data.seat (the alias) and badged BOTH twins — putting
      // "retried once" on a seat that was never retried.
      const tbody = paint(twinRows, [{
        kind: 'degrade', channel: 'dead-leg', what: 'seat d did not review',
        why: 'x', effect: 'y',
        data: { seat: 'd', seatId: 'd#2', status: 'error', reason: null, retryWaveId: 'w1' },
      }]);
      expect(badged(tbody)).toBe(1);
      expect(tbody.children[1].children[8].textContent).toBe('↻ retried once');
    });

    test('a dead-wave record naming data.seats[] badges exactly those seats', () => {
      const tbody = paint(twinRows, [{
        kind: 'degrade', channel: 'dead-wave', what: 'wave died', why: 'x', effect: 'y',
        data: { waveId: 'r1-s1', models: ['d'], seats: ['d#2'], reason: 'x', retryWaveId: 'w1' },
      }]);
      expect(badged(tbody)).toBe(1);
    });

    test('an UNIDENTIFIED dead-wave slot falls back to the alias and badges BOTH twins', () => {
      // Disclosed imprecision, and the LOUD direction on purpose: the record does not say
      // which seat it was, so over-badging is visible and self-correcting where a missing
      // badge would be silent.
      const tbody = paint(twinRows, [{
        kind: 'degrade', channel: 'dead-wave', what: 'wave died', why: 'x', effect: 'y',
        data: { waveId: 'r1-s1', models: ['d'], seats: [null], reason: 'x', retryWaveId: 'w1' },
      }]);
      expect(badged(tbody)).toBe(2);
    });

    // The deferred BACKLOG item: dead-wave on a TWIN bench had no test at all. Paired with
    // the distinct-alias case (test (4)) so the asymmetry is visible in one place.
    test('a LEGACY dead-wave (models[] only) on a twin bench badges both — the alias arm', () => {
      const tbody = paint(twinRows, [{
        kind: 'degrade', channel: 'dead-wave', what: 'wave died', why: 'x', effect: 'y',
        data: { waveId: 'r1-s1', models: ['d'], reason: 'x', retryWaveId: 'w1' },
      }]);
      expect(badged(tbody)).toBe(2);
    });

    // R6 — the sixth residual, absent from the plan's R1-R5 taxonomy until round 2 (D7).
    test('R6 (known-wrong): a LEGACY srcLeg with no seatId still badges both twins', () => {
      const tbody = paint(twinRows, [{
        kind: 'degrade', channel: 'dead-leg', what: 'seat d did not review',
        why: 'x', effect: 'y',
        data: { seat: 'd', status: 'error', reason: null, retryWaveId: 'w1' },
      }]);
      expect(badged(tbody)).toBe(2);
    });
  });
});

/**
 * Drift pin (v4.7 PR7 task-8 review finding, "Important"): retriedSeats() above is a
 * hand-mirrored copy of deadSeats' own kind/channel/data-shape filter (live-dead-seats.js :: deadSeats)
 * — the comment at this file's :47-56 says it "must keep mirroring it", but nothing enforced
 * that until now.
 *
 * ⚠️ v4.8 PR5b: the mirror is now PARTIAL and this pin's scope narrowed with it. The
 * kind/channel FILTER is still mirrored and still pinned here. The KEY is not: retriedSeats now
 * prefers `firstFailure.seatId` where a record supplies one, while deadSeats still dedups on
 * the alias (`seen[model]`) — that half is the deferred M3/M4 work in BACKLOG.md. These cases
 * all use distinct aliases, where seat id and alias coincide, so the two paths still agree;
 * a TWIN-bench case would legitimately diverge today. When M3/M4 lands, widen this pin.
 *
 * This is a BEHAVIOURAL pin, not a source-text one: it drives both consumers
 * with the SAME degrade-record fixtures and asserts they agree on which records count as
 * "retried" — the one axis the two consumers are required to agree on.
 *
 * Deliberately NOT a row-count/ghost-row comparison. deadSeats paints ghost rows for seats
 * with no live/cost row; the seats-panel marker only marks reviewing-role rows that DO have a
 * cost row — different jobs by design (D6's role-aware suppression), so a pin comparing total
 * rows would be false by construction (see test (5) above, which relies on exactly that
 * asymmetry). Comparing "does this degrade record count as retried" sidesteps it: each case
 * drives retriedSeats() (via ONE live reviewing-role row for the alias, so deadSeats' own
 * ghost candidate for that same alias is suppressed and the row painted is unambiguously the
 * marker path's) and deadSeats() (via NO live rows at all, so its ghost candidate's statusText
 * reflects the retried computation in isolation, uncoupled from suppression) against the
 * IDENTICAL degrade array, and asserts the two verdicts match.
 */
describe('retriedSeats (workspace-seats.js) vs deadSeats retried-set (live-dead-seats.js): drift pin', () => {
  let AmicusSeats;
  let AmicusLive;
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
    AmicusLive = global.window.AmicusLive;
  });

  afterEach(() => {
    delete global.window;
    delete global.document;
    delete global.NodeFilter;
  });

  /**
   * The marker path: paints ONE live reviewing-role ('seat') row for `alias` plus `degrades`
   * through the real renderSeatsPanel(). Its own degrade candidate is suppressed by the
   * matching live row (D6 role-aware suppression), so exactly one row exists and it is
   * unambiguously the marker path's — asserted here as a precondition, not the pin itself.
   */
  function markedBySeatsPanel(alias, degrades) {
    const tbody = document.getElementById('seats-body');
    global.window.AmicusApp = {
      $: (id) => document.getElementById(id),
      labelOf: () => null,
      state: {
        blind: false,
        detail: {
          derived: { cost: { rows: [{ model: alias, role: 'seat', status: 'error', costDisplay: '$0.01' }] } },
          run: { degrades, critic: null },
          verdict: null,
        },
      },
    };
    AmicusSeats.renderSeatsPanel();
    expect(tbody.children.length).toBe(1);
    return tbody.children[0].classList.contains('seat-retried');
  }

  /**
   * The ghost path: deadSeats() with NO live seats and no seatLoss/runMeta, so nothing
   * suppresses — isolates the retried computation from the suppression logic entirely.
   */
  function retriedByDeadSeats(alias, degrades) {
    const dead = AmicusLive.deadSeats(degrades, null, [], {});
    const entry = dead.find((s) => s.model === alias);
    return !!entry && entry.statusText === 'did not review — retried once';
  }

  const cases = [
    {
      name: 'dead-leg record WITH retryWaveId',
      alias: 'alpha',
      expected: true,
      degrades: [{
        kind: 'degrade', channel: 'dead-leg', what: 'seat alpha did not review',
        why: "the leg ended 'error'; its once-only retry also ended 'error'", effect: '0 of 1 seats reviewed',
        data: { seat: 'alpha', status: 'error', reason: 'timed out', retryWaveId: 'r1-c1r1' },
      }],
    },
    {
      name: 'dead-wave record with models[] and firstFailure',
      alias: 'bravo',
      expected: true,
      degrades: [{
        kind: 'degrade', channel: 'dead-wave', what: 'Stage-1 wave r1-s1 (bravo) produced NO legs',
        why: 'no reason recorded; the once-only retry wave also produced no legs', effect: '0 of 1 seats reviewed',
        data: {
          waveId: 'r1-s1', models: ['bravo'], reason: 'no reason recorded',
          firstFailure: { seat: 'bravo', class: 'wave', waveId: 'r1-s1', reason: 'no legs produced' },
        },
      }],
    },
    {
      // The exact defect the finding warns about: a "field-only" scan (retryWaveId/firstFailure
      // present, kind/channel unchecked) would tag this RECOVERED seat "retried once" too.
      name: 'kind:"heal"/channel:"stage1-retry" record carrying the SAME retry fields (a recovered seat) — must NOT be retried',
      alias: 'charlie',
      expected: false,
      degrades: [{
        kind: 'heal', channel: 'stage1-retry', what: 'seat charlie reviewed on retry',
        why: "its first leg ended 'error' with no usable output and was relaunched once",
        effect: 'The seat is in this council; nothing was lost',
        data: {
          seat: 'charlie', retryWaveId: 'r1-c1r1', retryOfWaveId: 'r1-c1',
          firstFailure: { seat: 'charlie', class: 'leg', status: 'error', reason: 'timed out' },
        },
      }],
    },
    {
      name: 'dead-leg record with NEITHER retryWaveId nor firstFailure',
      alias: 'delta',
      expected: false,
      degrades: [{
        kind: 'degrade', channel: 'dead-leg', what: 'seat delta did not review',
        why: "the leg ended 'error'; no retry was attempted", effect: '0 of 1 seats reviewed',
        data: { seat: 'delta', status: 'error', reason: 'timed out' },
      }],
    },
    // ---- v4.9 W9 (SI-02): the `seat-unbound` family joins the mirror. Measured mutant red
    // sets that land HERE: UNBOUNDBLIND-A (channel dropped from `live-dead-seats.js ::
    // isSeatLoss`) and UNBOUNDBLIND-B (dropped from `retriedSeats` instead) each red the two
    // `expected=true` cases below — and for B these two ARE the whole red set, so this pin is
    // the only thing holding the mirror. GATERAW-B (retry-family conjunct dropped from
    // `retriedSeats`) reds the ORPHAN-LEG case. Full table: dead-seat-twins.test.js's W9 header.
    {
      name: 'W9: seat-unbound PARTIAL-wave record (waveStillDeadNote, retryWaveId + seatId)',
      alias: 'echo',
      expected: true,
      degrades: [{
        kind: 'degrade', channel: 'seat-unbound', what: 'seat echo did not review',
        why: 'the wave returned 1 of 2 legs; the once-only retry wave also produced no legs',
        effect: '0 of 1 seats reviewed',
        data: { waveId: 'r1-s1', models: ['echo'], reason: 'x', retryWaveId: 'r1-s1r1',
          seat: 'echo', seatId: 'echo' },
      }],
    },
    {
      name: 'W9: seat-unbound MISSING-LEG record (missingLegStillDeadNote, firstFailure)',
      alias: 'foxtrot',
      expected: true,
      degrades: [{
        kind: 'degrade', channel: 'seat-unbound', what: 'seat foxtrot did not review',
        why: 'no leg returned; its once-only retry produced no leg for this seat',
        effect: '0 of 1 seats reviewed',
        data: { seat: 'foxtrot', status: null, reason: null, retryWaveId: 'r1-s1r1',
          firstFailure: { seat: 'foxtrot', seatId: 'foxtrot', class: 'missing',
            waveId: 'r1-s1', reason: 'x' } },
      }],
    },
    {
      // Mutant GATERAW's control on BOTH consumers: admitting the channel raw badges — and
      // renders a ghost for — a seat whose review actually LANDED and was paid for.
      name: 'W9: ORPHAN-LEG seat-unbound note (data.legId, no retry family) — must NOT be retried',
      alias: 'golf',
      expected: false,
      degrades: [{
        kind: 'degrade', channel: 'seat-unbound',
        what: 'leg leg-7 in wave r1-s1 matches no seat on that wave\'s roster',
        why: 'its id names no roster slot of r1-s1', effect: 'kept under its model name',
        data: { waveId: 'r1-s1', legId: 'leg-7', seat: 'golf' },
      }],
    },
    {
      name: 'W9: reVoteUnbound seat-unbound note (names a judge, not a lost seat) — must NOT be retried',
      alias: 'hotel',
      expected: false,
      degrades: [{
        kind: 'degrade', channel: 'seat-unbound',
        what: 're-vote leg leg-9 in wave r1-rv could not be attributed to a judge on that wave',
        why: "its join key 'hotel' names none of the judges this wave launched",
        effect: 'the re-vote was NOT applied; the provisional verdict stands',
        data: { waveId: 'r1-rv', legId: 'leg-9', judge: 'hotel', key: 'hotel' },
      }],
    },
  ];

  cases.forEach(({ name, alias, expected, degrades }) => {
    test(`${name} (expected retried=${expected}); marker path and ghost path agree`, () => {
      const marked = markedBySeatsPanel(alias, degrades);
      const retried = retriedByDeadSeats(alias, degrades);
      expect(marked).toBe(expected);
      expect(retried).toBe(expected);
      // The actual drift pin: the two mirrored predicates must land on the same verdict.
      expect(marked).toBe(retried);
    });
  });

});
