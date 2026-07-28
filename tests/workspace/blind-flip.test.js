'use strict';

const { makeFakeDom } = require('./helpers/fake-workspace-page');
const { SCRIPT_LOAD_ORDER } = require('./helpers/script-load-order');

const UI = '../../electron/workspace-ui/';
const LOAD_ORDER = SCRIPT_LOAD_ORDER;

/**
 * Task 19: RN-5 — the blind toggle's renderDetail_preserveBlind used to call renderDetail()
 * (which unconditionally recomputed state.blind back to the run's status default AND reset
 * every lazy panel via wireLazyPanels()), restore the user's chosen blind value over the top,
 * and then repaint seats/matrix/verdict/cost/header-chips a SECOND time to compensate for the
 * first call's wrong-blind paint — a double paint that also collapsed any prose panel
 * (reviews/bundle/judges) the user had open, since wireLazyPanels() unconditionally reset
 * every panel's open/loaded state on every renderDetail() call, blind toggle included.
 *
 * Fixed at the root instead of compensated for: renderDetail() now recomputes the blind
 * default only on a run CHANGE (state.detailRunId tracking), and wireLazyPanels() only resets
 * panel open/loaded state on a run CHANGE (module-level lastWiredRunId) — a same-run call (the
 * blind toggle re-renders the SAME run) leaves both alone, so a single renderDetail() call
 * paints correctly the first time.
 */
function loadOrderedScripts() {
  jest.resetModules();
  LOAD_ORDER.forEach((f) => {
    require(UI + f); // eslint-disable-line global-require
  });
}

/** bench/labelMap held CONSTANT across both runIds so the only thing that varies between
 *  aaaa1111 and bbbb2222 is `status` — isolating the blind-default recompute (resolution 9)
 *  from any bench-driven panel-content difference. */
function buildFixtureDetail(runId, status) {
  const bench = ['gemini', 'gpt'];
  const labelMap = { 'Review A': 'gemini', 'Review B': 'gpt' };
  return {
    runId,
    runDir: '/fake/run/' + runId,
    run: {
      status: status || 'running', schemaVersion: 2, bench, chair: 'gpt',
      stages: [{ name: 'stage1', status: 'running', startedAt: 't0', completedAt: null }],
      labelMap, usage: null, options: { maxCost: 2 }, error: null, debate: null,
    },
    tally: {}, verdict: {},
    // review-/judge- files present for both bench models, so reviews-panel actually has
    // something to load (dataset.loaded flips to '1' once loadPanel's promise settles).
    artifacts: Object.assign(
      { 'chair-output.md': { present: false, bytes: 0 }, 'report.html': { present: false, bytes: 0 } },
      ...bench.map((m) => ({
        ['review-' + m + '.md']: { present: true, bytes: 100 },
        ['judge-' + m + '.md']: { present: true, bytes: 100 },
      })),
    ),
    derived: {
      schemaSupported: true,
      names: Object.entries(labelMap).map(([label, model]) => ({ label, model })),
      stageRail: [{ name: 'stage1', label: 'Stage 1 — independent review', status: 'running', startedAt: 't0', completedAt: null }],
      matrix: { judges: [], rows: [], tierCounts: {}, judged: false },
      cost: {
        rows: bench.map((m) => ({ model: m, role: 'seat', status: 'running', durationMs: 1000, costDisplay: '$0.10' })),
        totalDisplay: '$0.20', costAmount: 0.20, maxCost: 2,
      },
      verdictPanel: { present: false, overallVerdict: null, tierCounts: null, streetCred: [], decisions: [], reason: null },
    },
  };
}

describe('Blind flip preserves open panels and paints once (Task 19: RN-5)', () => {
  let invokeMock;

  function defaultInvoke(channel, ...args) {
    if (channel === 'workspace:list-runs') { return Promise.resolve([]); }
    if (channel === 'workspace:get-run') {
      // bbbb2222 is a TERMINAL fixture (status 'complete') on purpose: its defaultBlind (per
      // resolution 9) is false, the opposite of aaaa1111's running-fixture true — so the
      // regression pin below can tell "recomputed" apart from "coincidentally unchanged".
      const status = args[0] === 'bbbb2222' ? 'complete' : 'running';
      return Promise.resolve(buildFixtureDetail(args[0], status));
    }
    if (channel === 'workspace:get-live') { return Promise.resolve(null); }
    if (channel === 'workspace:read-artifact') { return Promise.resolve({ text: 'prose' }); }
    return Promise.resolve(null);
  }

  beforeEach(() => {
    jest.useFakeTimers();
    const fake = makeFakeDom();
    global.window = fake.window;
    global.document = fake.document;
    global.document.visibilityState = 'visible';
    global.document.hasFocus = () => true;
    global.NodeFilter = fake.NodeFilter;
    invokeMock = jest.fn(defaultInvoke);
    global.window.amicusWorkspace.invoke = invokeMock;
    loadOrderedScripts();
    // Same confound as live-loop.test.js/abort-verb.test.js: the boot sequence's 5s run-list
    // refresh setInterval is irrelevant to this file's assertions. Clear it.
    clearInterval(global.window.AmicusApp.state.listTimer);
    global.window.AmicusApp.state.listTimer = null;
  });

  afterEach(() => {
    if (global.window.AmicusApp && global.window.AmicusApp.state.listTimer) {
      clearInterval(global.window.AmicusApp.state.listTimer);
    }
    jest.clearAllTimers();
    jest.useRealTimers();
    delete global.window;
    delete global.document;
    delete global.NodeFilter;
  });

  function reviewsPanel() { return global.document.getElementById('reviews-panel'); }
  function blindToggle() { return global.document.getElementById('blind-toggle'); }
  function flipBlind(checked) { blindToggle()._listeners.change[0]({ target: { checked: checked } }); }

  test('a same-run blind flip keeps an open panel open and loaded, updates state.blind, and paints seats exactly once; a NEW run still recomputes the blind default and resets panels', async () => {
    await global.window.AmicusApp.openRun('aaaa1111'); // running fixture -> blind default ON
    expect(global.window.AmicusApp.state.blind).toBe(true);

    // User overrides the default: blind OFF.
    flipBlind(false);
    expect(global.window.AmicusApp.state.blind).toBe(false);

    // Expand reviews-panel and let its lazy load land.
    const panel = reviewsPanel();
    panel.open = true;
    panel._listeners.toggle[0]();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(panel.open).toBe(true);
    expect(panel.dataset.loaded).toBe('1');

    // The flip under test: blind back ON, on the SAME run.
    const renderSeatsSpy = jest.spyOn(global.window.AmicusRender, 'renderSeats');
    flipBlind(true);

    expect(global.window.AmicusApp.state.blind).toBe(true);
    expect(blindToggle().checked).toBe(true);
    // The panel the user had open must survive the flip untouched — this is the bug: the old
    // renderDetail_preserveBlind called renderDetail() (which reset every lazy panel via
    // wireLazyPanels()) before restoring the user's blind choice.
    expect(panel.open).toBe(true);
    expect(panel.dataset.loaded).toBe('1');
    // One paint, not two — the old code painted seats once inside the inner renderDetail()
    // call (with the momentarily-wrong default blind) and again as a compensating repaint.
    expect(renderSeatsSpy).toHaveBeenCalledTimes(1);
    renderSeatsSpy.mockRestore();

    // Regression pins: opening a genuinely NEW run must still (a) recompute the blind default
    // from ITS OWN status (resolution 9) — bbbb2222 is terminal, so defaultBlind is false,
    // proving a real recompute happened rather than state.blind coincidentally staying true —
    // and (b) reset the lazy panels (F09's stale-run protection).
    await global.window.AmicusApp.openRun('bbbb2222');
    expect(global.window.AmicusApp.state.blind).toBe(false);
    expect(panel.open).toBe(false);
    expect(panel.dataset.loaded).toBe('0');
  });

  // ---- Fix-wave (Task 19 review) Fix 1: open panels re-mask on a blind change ------------
  //
  // The deleted reset in wireLazyPanels() used to be the ONLY path that re-rendered an open
  // reviews/judges panel when blind changed — loadPanel() early-returns on its cached promise
  // (workspace-panels.js:94), and only fires again via the panel's own `toggle` listener, which
  // does not fire just because state.blind changed underneath an already-open panel. Left as
  // Task 19 shipped it, flipping Blind ON leaves an open panel showing raw model ids while
  // everything else masks — violating RN-9 (blind ON titles every section by label, never by
  // model id).
  test('an open reviews-panel re-masks (and stays open, with no duplicate sections) when blind flips on a same-run call', async () => {
    // bbbb2222 is the shared TERMINAL fixture (status 'complete', defaultBlind false per
    // resolution 9) — start blind OFF here, the opposite of the running-fixture flip test above.
    await global.window.AmicusApp.openRun('bbbb2222');
    expect(global.window.AmicusApp.state.blind).toBe(false);

    const panel = reviewsPanel();
    panel.open = true;
    panel._listeners.toggle[0]();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(panel.dataset.loaded).toBe('1');

    function sectionTitles() {
      return global.document.getElementById('reviews-body').children.map((s) => s.children[0].textContent);
    }
    // Blind OFF: sections are titled by raw model id.
    expect(sectionTitles()).toEqual(['gemini', 'gpt']);

    flipBlind(true);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

    // Never collapsed — the panel the user had open must survive the flip.
    expect(panel.open).toBe(true);
    expect(panel.dataset.loaded).toBe('1');
    // Re-masked — RN-9 requires blind ON to title every section by label, never by model id.
    // Pre-fix this stays ['gemini', 'gpt'] (RED): nothing re-renders an already-loaded panel.
    expect(sectionTitles()).toEqual(['Review A', 'Review B']);
    // Refreshed in place, not appended to — one section per bench model, never duplicated.
    expect(global.document.getElementById('reviews-body').children.length).toBe(2);
  });

  // ---- Fix-wave Fix 2: a running -> terminal refresh on the SAME run id auto-reveals ------
  //
  // The gate keyed on run id alone, so the live loop's terminal refresh (workspace-verbs.js's
  // startLiveLoop tick calling A.openRun(sameRunId) once the run finishes) skipped the
  // recompute and left a just-completed run blinded — pre-existing auto-reveal behavior Task 19
  // never intended to remove. Amending the gate to key on run id AND status recomputes on that
  // transition while still preserving a same-run/same-status call (the blind toggle, covered by
  // the flip test above, which continues to pass unchanged after this amendment).
  test('a running -> terminal refresh on the SAME run id auto-reveals the blind default (fix-wave, Fix 2)', async () => {
    await global.window.AmicusApp.openRun('aaaa1111'); // running fixture -> blind default ON
    expect(global.window.AmicusApp.state.blind).toBe(true);

    // Simulate the live loop's terminal refresh: workspace-verbs.js's startLiveLoop tick calls
    // A.openRun(runId) with the SAME run id once workspace:get-live reports terminal — the
    // refetched workspace:get-run reply is the only thing that changes, from 'running' to a
    // terminal status.
    invokeMock.mockImplementation((channel, ...args) => {
      if (channel === 'workspace:get-run') { return Promise.resolve(buildFixtureDetail(args[0], 'complete')); }
      return defaultInvoke(channel, ...args);
    });
    await global.window.AmicusApp.openRun('aaaa1111'); // SAME run id, CHANGED status

    // Pre-fix (gate keyed on run id alone) this stays `true` (RED): d.runId === state.detailRunId
    // so the recompute never runs, and a completed run is stranded blinded.
    expect(global.window.AmicusApp.state.blind).toBe(false);
  });
});
