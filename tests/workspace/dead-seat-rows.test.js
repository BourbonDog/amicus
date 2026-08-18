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
 * window.AmicusApp-reading renderSeatsPanel() wrapper.
 *
 * Fix wave (task review): every case here reaches the derivation/paint
 * functions directly via the local paint() helper below, bypassing
 * renderSeatsPanel() itself (workspace-seats.js :: renderSeatsPanel — ⚠️ cited `:29-38` until T-A8 re-opened it 2026-08-17: that span is the PR4b HISTORY docblock; the function is `:113-199`) — a typo in its
 * field-access chain (e.g. `d.run.degrade`, a swapped deadSeats() argument
 * order, `d.verdict.seatloss`) would have shipped a feature that never
 * renders while every test here stayed green. The positive-path coverage for
 * renderSeatsPanel() itself — reached through the real production
 * window.AmicusApp.openRun() — now lives in workspace-app-boundary.test.js's
 * "renderSeatsPanel (fix wave)" describe block, added alongside this fix
 * (that file already owns the full-app-boot fixture/IPC-mock harness this
 * needs; duplicating it here would be a second, driftable copy).
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

  /**
   * Live rows then dead rows into a fresh tbody — mirrors renderSeatsPanel()'s own call order.
   * `runMeta` (v4.6.3 PR2, D3) is the new optional 6th arg threaded straight to
   * AmicusLive.deadSeats — omitted callers get `undefined`, which deadSeats treats as "no
   * critic" (unchanged pre-PR2 behavior).
   */
  function paint(costRows, degrades, seatLoss, blindOn, labelOf, runMeta) {
    const tbody = document.createElement('tbody');
    const liveSeats = AmicusLive.seatsFromRunStats(costRows);
    AmicusRender.renderSeats(tbody, liveSeats, blindOn, labelOf);
    const dead = AmicusLive.deadSeats(degrades, seatLoss, liveSeats, runMeta);
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

    // runMeta: { critic: 'foxtrot' } (task-3 review carry #3) — the real run 2039b2d1 this
    // fixture models DID request a critic; without it, the degrade-sourced add() (which runs
    // FIRST and wins the seen-map dedup) tagged 'foxtrot' role: null, and the seatLoss backstop's
    // own unconditional 'critic' tag never got a chance to apply (already seen) — so the role
    // assertion below was untestable before this fix. Passing the real critic restores fixture
    // truthfulness. NOTE (task-4 review, minor #3): the children[1] role assertion does NOT by
    // itself pin degrade-vs-backstop precedence — the role AGREES under either ordering here
    // (both would say 'critic'). It is the children[2] statusText assertion below ("did not
    // review — retried once", the degrade record's retry phrasing, not the backstop's plain one)
    // that proves the degrade-sourced candidate is the one that actually won the seen-map dedup.
    const tbody = paint(costRows, degrades, seatLoss, false, () => null, { critic: 'foxtrot' });

    expect(tbody.children.length).toBe(6);
    const deadRows = tbody.children.filter((r) => r.classList.contains('seat-dead'));
    expect(deadRows.length).toBe(1);
    expect(tbody.children[5]).toBe(deadRows[0]); // appended AFTER the five live rows
    expect(deadRows[0].children[0].textContent).toBe('foxtrot');
    expect(deadRows[0].children[1].textContent).toBe('critic'); // the role cell (task-3 review carry #3)
    expect(deadRows[0].children[2].textContent).toBe('did not review — retried once');
    expect(deadRows[0].children[6].textContent).toBe(''); // no cost cell
  });

  // Fix wave (task review, minor rider): test (b) below uses a dead-wave record but asserts
  // ZERO rows, so an implementation that ignored `data.models` entirely would also pass it.
  // This is the positive direction: a dead-wave naming TWO models, neither present in the
  // live cost rows, must produce exactly two dead rows.
  test('(a2) a dead-wave record naming two models absent from the cost rows renders exactly two dead rows', () => {
    const costRows = [{ model: 'alpha', role: 'seat', status: 'complete', durationMs: 1000, costDisplay: '$0.10' }];
    const degrades = [{
      kind: 'degrade', channel: 'dead-wave', what: 'Stage-1 wave r1-s1 (bravo, charlie) produced NO legs',
      why: 'no reason recorded', effect: '1 of 3 seats reviewed',
      data: { waveId: 'r1-s1', models: ['bravo', 'charlie'], reason: 'no reason recorded' },
    }];

    const tbody = paint(costRows, degrades, null, false, () => null);

    expect(tbody.children.length).toBe(3);
    const deadRows = tbody.children.filter((r) => r.classList.contains('seat-dead'));
    expect(deadRows.length).toBe(2);
    expect(deadRows.map((r) => r.children[0].textContent).sort()).toEqual(['bravo', 'charlie']);
    // No retryWaveId/firstFailure on this record → the plain phrasing, both seats.
    deadRows.forEach((r) => expect(r.children[2].textContent).toBe('did not review'));
  });

  test('(b) a seat that died then recovered via retry (has a usable leg) renders NO dead row', () => {
    // role: 'seat' here is the truthful live shape v4.6.3 PR2 requires — the role FIELD is
    // always present, but its VALUE is legitimately nullable (legRole returns null on an
    // unknown modelInput or a mismatched lens pairing — live-normalize.js:52,
    // council-legs.js:56,79-88; the null-role branch is live code, not dead) — already present
    // here; the reviewing-role allowlist keeps this suppression case unchanged.
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

  // v4.7 CA-4 dead-seat convergence (owner-ruled, final-review consolidated wave): D6's
  // "already present in liveSeats" suppression predates row-per-launch and was written when
  // the only way a dead seat could have a live cost row was a healed retry (see (b) above).
  // v4.7 changed that premise — a dead seat that NEVER recovers still gets its own honest
  // primary ERROR row (role 'seat'/'critic', status 'error') from the row-per-launch
  // machinery, so "has a live row" no longer implies "healed". This is the terminal-path
  // proof that the SAME suppression still fires correctly on that new case: one row total
  // (the seat's own errored cost row), never a second "did not review" ghost row beside it.
  test('(b2) a dead seat whose OWN reviewing-role ERROR row is present (v4.7 primary error row, not a healed retry) renders exactly ONE row — no dead-row duplicate', () => {
    const costRows = [
      { model: 'alpha', role: 'seat', status: 'complete', durationMs: 1000, costDisplay: '$0.10' },
      { model: 'bravo', role: 'seat', status: 'error', durationMs: 1000, costDisplay: '$0.05' }, // v4.7 primary error row — never healed
    ];
    const degrades = [{
      kind: 'degrade', channel: 'dead-leg', what: 'seat bravo did not review',
      why: "the leg ended 'error' with no usable output", effect: '1 of 2 seats reviewed',
      data: { seat: 'bravo', status: 'error', reason: 'timed out' },
    }];

    const tbody = paint(costRows, degrades, null, false, () => null);

    expect(tbody.children.length).toBe(2); // alpha (complete) + bravo (its OWN error row) — no ghost third row
    expect(tbody.children.filter((r) => r.classList.contains('seat-dead')).length).toBe(0);
    expect(tbody.children[1].children[2].textContent).toBe('error'); // bravo's honest status renders
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

  // Fix wave 2 (smoke-caught): the live GUI smoke on a real degraded run (12c96b6b) found blind
  // mode leaking the dead seat's RAW model name. Root cause: case (c) above always gave the dead
  // seat a labelMap entry, so seatCells' `blindOn && label ? label : alias` always took the label
  // branch — it never exercised the branch a REAL run actually hits. `state.labelByModel` is
  // built from the run's names derivation (models that DID produce a review); a dead seat never
  // reviews, so it is never in that map, `labelOf(alias)` is null, and seatCells' raw-alias
  // fallback (load-bearing for LIVE rows, RN-9/F36 — left untouched) then shows the real name
  // under blind. This is the case (c) missed: NO labelMap entry for the dead seat at all.
  test('(c2) blind mode with NO label for the dead seat renders the "(masked)" placeholder, never the raw alias', () => {
    const costRows = [{ model: 'alpha', role: 'seat', status: 'complete', durationMs: 1000, costDisplay: '$0.10' }];
    const degrades = [{
      kind: 'degrade', channel: 'dead-leg', what: 'seat bravo did not review',
      why: "the leg ended 'error' with no usable output", effect: '1 of 2 seats reviewed',
      data: { seat: 'bravo', status: 'error', reason: 'timed out' },
    }];
    // Only 'alpha' (the live seat) has a label — 'bravo' (the dead seat) deliberately does not,
    // matching a real run's labelByModel shape.
    const labelMap = { alpha: 'Review A' };
    const labelOf = (m) => labelMap[m] || null;

    const blindTbody = paint(costRows, degrades, null, true, labelOf);
    expect(blindTbody.children[0].children[0].textContent).toBe('Review A'); // live row, blind ON, has a label
    expect(blindTbody.children[1].children[0].textContent).toBe('(masked)'); // dead row, blind ON, NO label
    expect(blindTbody.children[1].children[0].textContent).not.toBe('bravo');

    const openTbody = paint(costRows, degrades, null, false, labelOf);
    expect(openTbody.children[1].children[0].textContent).toBe('bravo'); // blind OFF: raw alias is correct, no placeholder
  });

  // v4.7 PR6: labelByModel render pin. workspace-app.js builds `state.labelByModel` as
  // `d.derived.names.forEach(function (p) { state.labelByModel[p.model] = p.label; })` —
  // reproduced here verbatim over a bare object, matching derived.names carrying
  // { model: 'toString', label: 'Model A' }. Pre-fix note: NOT a genuine RED — a bracket
  // assignment to an inherited-but-writable key (Object.prototype.toString is
  // writable/configurable) creates its own shadowing property, so this construction already
  // returns 'Model A' correctly even off a bare `{}`; the family's real garbage-output risk
  // is a 'toString'-named model that is LIVE but has no derived.names entry yet (the lookup
  // then falls through to the inherited function unassigned), not this happy path. Kept as a
  // pin per the brief's Step 4 (labelByModel is the one site in this family whose failure
  // mode is garbage text, not a silent drop) and swept to Object.create(null) for uniformity.
  test('a live seat literally named "toString" renders its labelByModel-derived label, not a function\'s source text', () => {
    const costRows = [{ model: 'toString', role: 'seat', status: 'complete', durationMs: 1000, costDisplay: '$0.10' }];
    const names = [{ model: 'toString', label: 'Model A' }]; // derived.names shape
    const labelByModel = {};
    names.forEach((p) => { labelByModel[p.model] = p.label; }); // workspace-app.js's exact construction
    const labelOf = (m) => labelByModel[m] || null;

    const tbody = paint(costRows, [], null, true, labelOf);

    expect(tbody.children.length).toBe(1);
    expect(tbody.children[0].children[0].textContent).toBe('Model A');
    expect(tbody.children[0].children[0].textContent).not.toMatch(/function/);
  });

  /**
   * v4.6.3 PR2 (spec D3): role-aware suppression. Pre-PR2, `deadSeats`'s live-suppression map
   * was role-BLIND — any live cost row for a candidate's alias suppressed it, so a model that
   * died as critic but whose chair-fallback walk landed on the SAME alias (and succeeded,
   * producing a live `role: 'chair'` cost row) silently erased the dead-critic row it was never
   * a replacement for. `runMeta: {critic}` lets `deadSeats` tag degrade-sourced candidates with
   * `role: 'critic'` via alias equality (mirroring deriveSeatLoss, verdict.js) and restrict
   * suppression to REVIEWING-role live legs (`seat`/`critic`/`lens:*`) only.
   */
  describe('role-aware suppression (v4.6.3 PR2, D3 — the #102 rider)', () => {
    test('(a) dead-as-critic + alive-as-chair renders the dead row (role-aware D6, v4.6.3 PR2)', () => {
      // model 'foxtrot' died as critic; the chair fallback walk landed on the
      // SAME model and it succeeded as chair — its chair cost row must not
      // suppress the dead-critic row.
      const degrades = [{ kind: 'degrade', channel: 'dead-leg', what: 'seat foxtrot did not review',
        why: "the leg ended 'error'", effect: '2 of 3 seats reviewed',
        data: { seat: 'foxtrot', status: 'error', reason: 'timed out' } }];
      const costRows = [
        { model: 'alpha', role: 'seat', status: 'complete', costDisplay: '$0.01' },
        { model: 'bravo', role: 'seat', status: 'complete', costDisplay: '$0.01' },
        { model: 'foxtrot', role: 'chair', status: 'complete', costDisplay: '$0.02' },
      ];
      const tbody = paint(costRows, degrades, null, false, null, { critic: 'foxtrot' });
      const deadRows = tbody.children.filter((r) => r.classList.contains('seat-dead'));
      expect(deadRows.length).toBe(1);
      expect(deadRows[0].children[0].textContent).toBe('foxtrot');
      expect(deadRows[0].children[1].textContent).toBe('critic'); // the role cell
    });

    test('(b) suppression-precision twin: a live CRITIC row for the same alias suppresses the dead-critic candidate', () => {
      // Same fixture as (a), except foxtrot's live row is role: 'critic' (the recovered-critic
      // case, e.g. a retry that actually seated the critic) — this DOES suppress.
      const degrades = [{ kind: 'degrade', channel: 'dead-leg', what: 'seat foxtrot did not review',
        why: "the leg ended 'error'", effect: '2 of 3 seats reviewed',
        data: { seat: 'foxtrot', status: 'error', reason: 'timed out' } }];
      const costRows = [
        { model: 'alpha', role: 'seat', status: 'complete', costDisplay: '$0.01' },
        { model: 'bravo', role: 'seat', status: 'complete', costDisplay: '$0.01' },
        { model: 'foxtrot', role: 'critic', status: 'complete', costDisplay: '$0.02' },
      ];
      const tbody = paint(costRows, degrades, null, false, null, { critic: 'foxtrot' });
      const deadRows = tbody.children.filter((r) => r.classList.contains('seat-dead'));
      expect(deadRows.length).toBe(0);
    });

    test('(c1) a null-role (bench) dead-leg IS suppressed by a live seat-role row for the same alias', () => {
      const degrades = [{ kind: 'degrade', channel: 'dead-leg', what: 'seat echo did not review',
        why: "the leg ended 'error'", effect: '2 of 3 seats reviewed',
        data: { seat: 'echo', status: 'error', reason: 'timed out' } }];
      const costRows = [
        { model: 'echo', role: 'seat', status: 'complete', costDisplay: '$0.01' }, // recovered
      ];
      // Not foxtrot — echo is a plain bench candidate, never tagged 'critic'.
      const tbody = paint(costRows, degrades, null, false, null, { critic: 'foxtrot' });
      const deadRows = tbody.children.filter((r) => r.classList.contains('seat-dead'));
      expect(deadRows.length).toBe(0);
    });

    test('(c2) a null-role (bench) dead-leg is NOT suppressed by a chair-ONLY live row for the same alias', () => {
      const degrades = [{ kind: 'degrade', channel: 'dead-leg', what: 'seat echo did not review',
        why: "the leg ended 'error'", effect: '2 of 3 seats reviewed',
        data: { seat: 'echo', status: 'error', reason: 'timed out' } }];
      const costRows = [
        { model: 'echo', role: 'chair', status: 'complete', costDisplay: '$0.02' }, // chair only
      ];
      const tbody = paint(costRows, degrades, null, false, null, { critic: 'foxtrot' });
      const deadRows = tbody.children.filter((r) => r.classList.contains('seat-dead'));
      expect(deadRows.length).toBe(1);
      expect(deadRows[0].children[0].textContent).toBe('echo');
      expect(deadRows[0].children[1].textContent).toBe('—'); // null role -> em-dash
    });
  });

  /**
   * v4.6.3 PR2 (spec D4, "old-run resilience"): pre-`degrades[]` era (v4.5.2) runs carry the
   * bench half of a seat loss ONLY in `verdict.seatLoss.deadBenchSeats` (string[] of aliases,
   * deriveSeatLoss/verdict.js:41-47) — `degrades[]` is absent from both docs entirely.
   * `deadSeats` itself only gains the deadBenchSeats consumption (the `add()` calls below, folded
   * in after the critic backstop, before the live-map/suppression section); the verdict.degrades
   * FALLBACK (task brief cases (b)/(c)) is a source-selection concern that lives in the two call
   * sites (workspace-seats.js), not in `deadSeats` — those cases are exercised via the real
   * production selection ternary in the `appendDeadRows` describe block further down and in
   * workspace-app-boundary.test.js's `renderSeatsPanel` describe block (production path).
   */
  describe('old-run resilience: deadBenchSeats candidates (v4.6.3 PR2, D4)', () => {
    test('(D4d) deadBenchSeats duplicate entries AND a dead-leg degrade naming the same seat collapse to exactly ONE row — the seen map absorbs both sources (the deriveSeatLoss no-dedup quirk)', () => {
      // Pre-fix note: deadBenchSeats is unconsumed pre-fix, so this scenario already rendered
      // exactly 1 row pre-fix too (from the degrade alone) — NOT a genuine RED, since the
      // degrade-sourced 'alpha' row masks deadBenchSeats' non-consumption. Documented per the
      // brief's Step 2 allowance; the meaningful assertion is POST-fix: both sources funnel
      // through the same `seen` map without producing 2 or 3 rows.
      //
      // retryWaveId on the degrade record (task-4 review, minor #2): pins ORDERING, not just
      // count. deadBenchSeats candidates are always added with retried: false (plain "did not
      // review"); the degrade-sourced candidate here carries retryWaveId, so its statusText is
      // "did not review — retried once". Only if the degrade loop runs BEFORE the deadBenchSeats
      // block (the brief's prescribed placement) does the degrade-sourced add() win the
      // seen-map dedup and the retried phrasing survive — hoisting deadBenchSeats above the
      // degrade loop would keep the row COUNT green (still 1) while silently downgrading the
      // statusText to the plain phrasing, which the count-only assertions above could never catch.
      const costRows = [];
      const degrades = [{
        kind: 'degrade', channel: 'dead-leg', what: 'seat alpha did not review',
        why: "the leg ended 'error'; its once-only retry also ended 'error'", effect: '0 of 1 seats reviewed',
        data: { seat: 'alpha', status: 'error', reason: 'timed out', retryWaveId: 'r1-c1r1' },
      }];
      const seatLoss = { criticRequested: null, criticSeated: false, reason: 'no legs', deadBenchSeats: ['alpha', 'alpha'] };

      const tbody = paint(costRows, degrades, seatLoss, false, () => null);

      const deadRows = tbody.children.filter((r) => r.classList.contains('seat-dead'));
      expect(deadRows.length).toBe(1);
      expect(deadRows[0].children[0].textContent).toBe('alpha');
      expect(deadRows[0].children[1].textContent).toBe('—'); // null role — degrade-sourced, no critic in this fixture
      expect(deadRows[0].children[2].textContent).toBe('did not review — retried once'); // degrades-before-deadBenchSeats ordering
    });

    test('(D4e) deadBenchSeats suppression still applies: a live role:"seat" row for the alias suppresses the bench candidate', () => {
      // Pre-fix note: also NOT a genuine RED — deadBenchSeats is unconsumed pre-fix, so this
      // already rendered zero rows (for the wrong reason: nothing was ever a candidate). The
      // meaningful assertion is POST-fix: deadBenchSeats candidates flow through the SAME
      // reviewing-role suppression map as degrade-sourced ones, not a separate unfiltered path.
      const costRows = [{ model: 'alpha', role: 'seat', status: 'complete', costDisplay: '$0.01' }];
      const seatLoss = { criticRequested: null, criticSeated: false, reason: 'no legs', deadBenchSeats: ['alpha'] };

      const tbody = paint(costRows, [], seatLoss, false, () => null);

      const deadRows = tbody.children.filter((r) => r.classList.contains('seat-dead'));
      expect(deadRows.length).toBe(0);
    });
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

  /**
   * PR4b Task 2 (mid-poll re-append, Christian's ruling on PR #102): appendDeadRows() is the
   * live-tick twin of renderSeatsPanel's dead block above — applyLive's renderSeats repaint on
   * every tick wipes any `dead:`-keyed row (leaver-removal, workspace-render.js:220-222, whose
   * seen-set only knows the live seats it was just given), so every tick calls this function to
   * re-append dead rows from the TICK's OWN payload. It reads window.AmicusApp exactly like
   * renderSeatsPanel() does (state.detail for seatLoss, state.blind/labelOf for masking) rather
   * than taking them as arguments, so it is exercised here with a minimal AmicusApp stub — same
   * "call the real function directly" level this whole file already tests at (see the file
   * docstring). Full production-wiring coverage of the real verbs.js call site, reached through
   * a real tick, lives in live-loop.test.js; the renderSeatsPanel gate-removal twin lives in
   * workspace-app-boundary.test.js.
   */
  describe('appendDeadRows (PR4b Task 2: live-tick twin of renderSeatsPanel\'s dead block)', () => {
    beforeEach(() => {
      global.window.AmicusApp = {
        $: function (id) { return document.getElementById(id); },
        labelOf: function () { return null; },
        state: { detail: null, blind: false },
      };
    });

    // role: 'seat' added v4.6.3 PR2 — the role FIELD is always present, but its VALUE is
    // legitimately nullable (legRole returns null on an unknown modelInput or a mismatched lens
    // pairing — live-normalize.js:52, council-legs.js:56,79-88; the null-role branch is live
    // code, not dead) — already present here, so the reviewing-role allowlist leaves every D6
    // case below that uses this helper unchanged.
    function liveSeat(model) {
      return {
        id: model, model: model, modelInput: null, role: 'seat', status: 'complete', stage: null,
        messages: null, tokensIn: null, tokensOut: null, costDisplay: '$0.10', lastActivity: null,
        latestPreview: null, stalled: false,
      };
    }

    test('renders exactly one seat-dead row for a degrade naming a model not in seats', () => {
      const tbody = document.getElementById('seats-body');
      const seats = [liveSeat('alpha')];
      AmicusRender.renderSeats(tbody, seats, false, () => null);
      const degrades = [{
        kind: 'degrade', channel: 'dead-leg', what: 'seat bravo did not review',
        why: "the leg ended 'error' with no usable output", effect: '1 of 2 seats reviewed',
        data: { seat: 'bravo', status: 'error', reason: 'timed out' },
      }];

      AmicusSeats.appendDeadRows({ ok: true, seats, degrades });

      const deadRows = tbody.children.filter((r) => r.classList.contains('seat-dead'));
      expect(tbody.children.length).toBe(2);
      expect(deadRows.length).toBe(1);
      expect(deadRows[0].children[0].textContent).toBe('bravo');
    });

    // PR4b Task 3 rider (controller ruling): every test in this block leaves
    // global.window.AmicusApp.state.detail at the beforeEach default (null), so
    // appendDeadRows()'s `var seatLoss = d && d.verdict ? d.verdict.seatLoss : null;` read
    // always takes the `null` branch — the `d.verdict.seatLoss` chain itself has zero
    // coverage here. This is the seatLoss counterpart of the test just above: degrades[] is
    // empty, so the dead row can only come from state.detail's seatLoss read. A
    // `d.verdict.seatloss` typo (or any break in the chain) would render zero rows here while
    // every other test in this file stayed green.
    test('state.detail.verdict.seatLoss naming a critic not in seats renders exactly one dead row (degrades[] empty)', () => {
      const tbody = document.getElementById('seats-body');
      const seats = [liveSeat('alpha')];
      global.window.AmicusApp.state.detail = {
        verdict: { seatLoss: { criticRequested: 'some-model-not-in-seats', criticSeated: false } },
      };
      AmicusRender.renderSeats(tbody, seats, false, () => null);

      AmicusSeats.appendDeadRows({ ok: true, seats, degrades: [] });

      const deadRows = tbody.children.filter((r) => r.classList.contains('seat-dead'));
      expect(deadRows.length).toBe(1);
      expect(deadRows[0].children[0].textContent).toBe('some-model-not-in-seats');
    });

    test('appendDeadRows called after each of two renderSeats repaints in a row still renders exactly one dead row (wipe+re-append idempotency)', () => {
      const tbody = document.getElementById('seats-body');
      const seats = [liveSeat('alpha')];
      const degrades = [{
        kind: 'degrade', channel: 'dead-leg', what: 'seat bravo did not review',
        why: "the leg ended 'error' with no usable output", effect: '1 of 2 seats reviewed',
        data: { seat: 'bravo', status: 'error', reason: 'timed out' },
      }];
      const live = { ok: true, seats, degrades };

      for (let i = 0; i < 2; i += 1) {
        AmicusRender.renderSeats(tbody, seats, false, () => null); // mirrors applyLive's tick repaint
        AmicusSeats.appendDeadRows(live);
      }

      expect(tbody.children.length).toBe(2);
      expect(tbody.children.filter((r) => r.classList.contains('seat-dead')).length).toBe(1);
    });

    test('D6: a degrade naming a model that IS in seats renders zero dead rows', () => {
      const tbody = document.getElementById('seats-body');
      const seats = [liveSeat('alpha'), liveSeat('bravo')]; // bravo recovered — has a live row
      AmicusRender.renderSeats(tbody, seats, false, () => null);
      const degrades = [{
        kind: 'degrade', channel: 'dead-wave', what: 'Stage-1 wave r1-s1 (bravo) produced NO legs',
        why: 'no reason recorded; the once-only retry wave also produced no legs', effect: 'seats reviewed',
        data: { waveId: 'r1-s1', models: ['bravo'], reason: 'no reason recorded', retryWaveId: 'r1-s1r1' },
      }];

      AmicusSeats.appendDeadRows({ ok: true, seats, degrades });

      expect(tbody.children.length).toBe(2);
      expect(tbody.children.filter((r) => r.classList.contains('seat-dead')).length).toBe(0);
    });

    // Fable review (PR4b fix wave): the D6 test above uses this file's `liveSeat()` helper,
    // whose `model` IS the alias (`modelInput: null` always) — it can never expose an
    // alias/resolved-id split. A REAL live payload seat (src/workspace/live-normalize.js's
    // `seatOf`, F34/F36) carries `model` as the RESOLVED EXECUTABLE id and the alias in
    // `modelInput` separately; a degrade record's `data.seat`/`data.models` are always
    // alias-keyed (run-retry-notes.js stamps the council alias, never the resolved id). D6's
    // live-path suppression filter must key its "already has a live row" map on the SAME alias
    // seatCells already uses (`seat.modelInput || seat.model`, live-model.js:58), or a dead-leg
    // seat whose errored roster row is still in the active stage's `live.seats` would render
    // BOTH its errored live row AND a duplicate dead row until the stage boundary drops it.
    test('D6 (live-path, production shape): a dead-leg degrade naming the ALIAS of a seat whose live row is keyed by its RESOLVED id renders zero dead rows', () => {
      const tbody = document.getElementById('seats-body');
      // role: 'seat' added v4.6.3 PR2 — the role FIELD is always present, but its VALUE is
      // legitimately nullable (legRole returns null on an unknown modelInput or a mismatched
      // lens pairing — live-normalize.js:52, council-legs.js:56,79-88; the null-role branch is
      // live code, not dead) — already present here, so this alias/resolved-id suppression case
      // is unchanged
      // under the reviewing-role allowlist.
      const seats = [{
        id: 'task-1', model: 'google/gemini-2.5-pro', modelInput: 'gemini', role: 'seat',
        status: 'running', stage: 'stage1', messages: 3, tokensIn: 500, tokensOut: 200,
        costDisplay: '$0.05', lastActivity: null, latestPreview: null, stalled: false,
      }];
      AmicusRender.renderSeats(tbody, seats, false, () => null);
      const degrades = [{
        kind: 'degrade', channel: 'dead-leg', what: 'seat gemini did not review',
        why: "the leg ended 'error' with no usable output", effect: '1 of 2 seats reviewed',
        data: { seat: 'gemini', status: 'error', reason: 'timed out' },
      }];

      AmicusSeats.appendDeadRows({ ok: true, seats, degrades });

      expect(tbody.children.length).toBe(1); // the one live row only — no duplicate dead row
      expect(tbody.children.filter((r) => r.classList.contains('seat-dead')).length).toBe(0);
    });

    // Supplementary: blind/(masked) parity through the AmicusApp-STATE read path specifically —
    // unlike the renderDeadSeatRows tests above (which pass blindOn/labelOf as direct args), this
    // is the path where a wiring typo (A.blind instead of A.state.blind, A.state.labelOf instead
    // of A.labelOf) would slip past every other test in this describe block.
    test('blind mode with no label for the dead seat renders "(masked)" via AmicusApp.state.blind/labelOf', () => {
      const tbody = document.getElementById('seats-body');
      const seats = [liveSeat('alpha')];
      const labelMap = { alpha: 'Review A' }; // deliberately no entry for bravo (the dead seat)
      global.window.AmicusApp.state.blind = true;
      global.window.AmicusApp.labelOf = (m) => labelMap[m] || null;
      AmicusRender.renderSeats(tbody, seats, true, global.window.AmicusApp.labelOf);
      const degrades = [{
        kind: 'degrade', channel: 'dead-leg', what: 'seat bravo did not review',
        why: "the leg ended 'error' with no usable output", effect: '1 of 2 seats reviewed',
        data: { seat: 'bravo', status: 'error', reason: 'timed out' },
      }];

      AmicusSeats.appendDeadRows({ ok: true, seats, degrades });

      const deadRows = tbody.children.filter((r) => r.classList.contains('seat-dead'));
      expect(deadRows.length).toBe(1);
      expect(deadRows[0].children[0].textContent).toBe('(masked)');
      expect(deadRows[0].children[0].textContent).not.toBe('bravo');
    });

    /**
     * v4.6.3 PR2 (spec D4, "old-run resilience"): the live-tick source-selection contract —
     * `live.degrades` when non-empty, else `state.detail.verdict.degrades` ("usually absent
     * mid-run — fine", but real for the checkpoint-swallow shape below). This is the "paint
     * layer" the task brief names for case (b): the REAL appendDeadRows() selection ternary,
     * called directly via the AmicusApp stub — no full openRun()/IPC boot needed, unlike
     * workspace-app-boundary.test.js's renderSeatsPanel coverage of the SAME contract on the
     * other call site.
     */
    describe('old-run resilience: verdict.degrades fallback (v4.6.3 PR2, D4)', () => {
      test('(D4b) checkpoint-loss shape: live.degrades empty, state.detail.verdict.degrades carries a dead-leg record — the row renders from the verdict fallback', () => {
        // Pre-fix RED: appendDeadRows always used `live.degrades` alone with no fallback, so
        // an empty live.degrades rendered nothing regardless of state.detail.verdict.degrades.
        const tbody = document.getElementById('seats-body');
        const seats = [liveSeat('alpha')];
        global.window.AmicusApp.state.detail = {
          verdict: { degrades: [{
            kind: 'degrade', channel: 'dead-leg', what: 'seat bravo did not review',
            why: "the leg ended 'error' with no usable output", effect: '1 of 2 seats reviewed',
            data: { seat: 'bravo', status: 'error', reason: 'timed out' },
          }] },
        };
        AmicusRender.renderSeats(tbody, seats, false, () => null);

        AmicusSeats.appendDeadRows({ ok: true, seats, degrades: [] });

        const deadRows = tbody.children.filter((r) => r.classList.contains('seat-dead'));
        expect(deadRows.length).toBe(1);
        expect(deadRows[0].children[0].textContent).toBe('bravo');
      });

      // Supplementary (closes the "both call sites" precedence gap noted in self-review):
      // workspace-app-boundary.test.js pins the SAME precedence contract for renderSeatsPanel
      // (d.run.degrades vs d.verdict.degrades); this is the appendDeadRows twin.
      test('(supplementary) precedence: non-empty live.degrades wins over state.detail.verdict.degrades — no union of the two', () => {
        // Pre-fix: already passes for the RIGHT reason — pre-fix code reads ONLY live.degrades,
        // so a non-empty live.degrades already "won" trivially (verdict.degrades was never read
        // at all). Post-fix it wins because the ternary explicitly prefers it, not because the
        // fallback is unreachable — the D4b case above proves the fallback IS reachable.
        const tbody = document.getElementById('seats-body');
        const seats = [];
        global.window.AmicusApp.state.detail = {
          verdict: { degrades: [{
            kind: 'degrade', channel: 'dead-leg', what: 'seat sierra did not review',
            why: "the leg ended 'error'", effect: '0 of 1 seats reviewed',
            data: { seat: 'sierra', status: 'error', reason: 'timed out' },
          }] },
        };
        const liveDegrades = [{
          kind: 'degrade', channel: 'dead-leg', what: 'seat romeo did not review',
          why: "the leg ended 'error'", effect: '0 of 1 seats reviewed',
          data: { seat: 'romeo', status: 'error', reason: 'timed out' },
        }];
        AmicusRender.renderSeats(tbody, seats, false, () => null);

        AmicusSeats.appendDeadRows({ ok: true, seats, degrades: liveDegrades });

        const deadRows = tbody.children.filter((r) => r.classList.contains('seat-dead'));
        expect(deadRows.length).toBe(1);
        expect(deadRows[0].children[0].textContent).toBe('romeo');
      });
    });
  });
});
