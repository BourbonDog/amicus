'use strict';

const { makeFakeDom } = require('./helpers/fake-workspace-page');
const { SCRIPT_LOAD_ORDER } = require('./helpers/script-load-order');

const UI = '../../electron/workspace-ui/';

/**
 * Task 2 (v4.7 PR7): pin the RN-1 collision titles BEFORE any of the T19 staleness fixes land.
 *
 * ⚠️ THIS TEST IS GREEN AT BASELINE AND MUST STAY GREEN. It is a non-regression pin, not a
 * RED-first test — do not read a failure here as "go fix production code". If it ever fails,
 * either the harness above it is wrong, or a change re-introduced the exact bug this file
 * exists to catch (see below). Proven to have teeth by temporarily editing
 * electron/workspace-ui/workspace-lazy.js's wireLazyPanels so the reviews-panel title is
 * `f.name`-derived instead of routed through window.AmicusRender.display(...) — that mutation
 * makes this file fail; reverting restores green. That proof is not committed here (see the
 * task's own report for the transcript).
 *
 * WHY THIS EXISTS: two separate proposed fixes for the underlying T19 stale-paint bug were
 * killed in recon because they re-derived panel titles from the model's raw `name` instead of
 * going through resolveArtifactName()/AmicusRender.display(). For a bench containing two models
 * that sanitize to the SAME filename (workspace-panels.js's sanitizeName strips everything
 * outside [a-zA-Z0-9._-] to '-' — 'vendor/a' and 'vendor:a' both become 'vendor-a'), re-deriving
 * from `name` collapses both sections onto one indistinguishable title. This test is the
 * tripwire that kills that shape if anyone proposes it again.
 *
 * SCOPE CONDITION (load-bearing): the collapse only occurs on the LEGACY-fallback path in
 * resolveArtifactName() (workspace-panels.js) — i.e. with
 * state.detail.derived.artifactsByModel === null/absent. With a disambiguating map present,
 * resolveArtifactName returns the already-unique per-model name and the titles are unaffected
 * either way. The fixture below sets derived.artifactsByModel to `null` EXPLICITLY so this test
 * can never silently drift into asserting nothing.
 *
 * Both assertions below are on the rendered section TITLES (the <h3> text), never on the
 * data-artifact attribute — both sections carry the SAME data-artifact="review-vendor-a.md" at
 * baseline (that's the whole point: one shared filename, two distinct titles), so the attribute
 * is not evidence of anything here.
 *
 * Harness: requires the renderer scripts through the shared SCRIPT_LOAD_ORDER list (never a
 * hand-written file list — see that helper's own header for why) against the shared
 * fake-workspace-page DOM, and drives a REAL render path — window.AmicusApp.openRun() through a
 * mocked IPC invoke, then the real reviews-panel `toggle` listener (registered once at
 * workspace-app.js boot, exactly like the production `<details>` element) — rather than calling
 * window.AmicusLazy.loadPanel() directly. Modeled on tests/workspace/blind-flip.test.js's
 * full-app-boot harness (same fixture shape, same flipBlind idiom), not
 * tests/workspace/dead-seat-rows.test.js's narrower direct-call paint() helper, because the
 * bug this pins is specifically in the wiring between wireLazyPanels()/loadPanel()
 * (workspace-lazy.js) and resolveArtifactName()/display() (workspace-panels.js /
 * workspace-render.js) — a direct call to loadPanel() would skip exactly the seam under test.
 */
function loadOrderedScripts() {
  jest.resetModules(); // force every IIFE to re-run against THIS test's fresh globals below
  SCRIPT_LOAD_ORDER.forEach((f) => {
    require(UI + f); // eslint-disable-line global-require
  });
}

/** Two distinct models that sanitizeName collapses to the SAME 'vendor-a' base name. */
const BENCH = ['vendor/a', 'vendor:a'];

function buildFixtureDetail(runId) {
  return {
    runId,
    runDir: '/fake/run/' + runId,
    run: {
      status: 'complete', schemaVersion: 2, bench: BENCH, chair: BENCH[0],
      stages: [{ name: 'stage1', status: 'complete', startedAt: 't0', completedAt: 't1' }],
      labelMap: {}, usage: null, options: { maxCost: 2 }, error: null, debate: null,
    },
    tally: {}, verdict: {},
    // Both bench entries legacy-resolve to the SAME filename (sanitizeName collapses '/' and
    // ':' to '-'), so one manifest entry covers the presence check for both files() candidates.
    artifacts: {
      'review-vendor-a.md': { present: true, bytes: 100 },
      'chair-output.md': { present: false, bytes: 0 },
      'report.html': { present: false, bytes: 0 },
    },
    derived: {
      schemaSupported: true,
      names: [
        { model: 'vendor/a', label: 'Review A' },
        { model: 'vendor:a', label: 'Review B' },
      ],
      // THE scope condition (see file header): the legacy-fallback path. Explicit, not merely
      // absent, so a future default change can't quietly turn this test vacuous.
      artifactsByModel: null,
      stageRail: [{ name: 'stage1', label: 'Stage 1 — independent review', status: 'complete', startedAt: 't0', completedAt: 't1' }],
      matrix: { judges: [], rows: [], tierCounts: {}, judged: false },
      cost: {
        rows: BENCH.map((m) => ({ model: m, role: 'seat', status: 'complete', durationMs: 1000, costDisplay: '$0.10' })),
        totalDisplay: '$0.20', costAmount: 0.20, maxCost: 2,
      },
      verdictPanel: { present: false, overallVerdict: null, tierCounts: null, streetCred: [], decisions: [], reason: null },
    },
  };
}

describe('lazy-panel staleness pin (Task 2, v4.7 PR7): RN-1 collision titles', () => {
  function defaultInvoke(channel, ...args) {
    if (channel === 'workspace:list-runs') { return Promise.resolve([]); }
    if (channel === 'workspace:get-run') { return Promise.resolve(buildFixtureDetail(args[0])); }
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
    global.window.amicusWorkspace.invoke = jest.fn(defaultInvoke);
    loadOrderedScripts();
    // Same confound as blind-flip.test.js/live-loop.test.js: the boot sequence's 5s run-list
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
  function flipBlind(checked) { blindToggle()._listeners.change[0]({ target: { checked } }); }

  /** Section titles as rendered (the <h3> text of each .prose-section), in DOM order. */
  function reviewsSectionTitles() {
    return global.document.getElementById('reviews-body').children.map((el) => el.children[0].textContent);
  }

  /** Opens reviews-panel via its real registered `toggle` listener (proseLoader, boot-time),
   *  exactly as the production <details onToggle> would, then flushes the loadPanel() promise
   *  chain (Promise.all of two IPC reads, then a .then that paints). */
  async function openReviewsPanel() {
    const panel = reviewsPanel();
    panel.open = true;
    panel._listeners.toggle[0]();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    return panel;
  }

  test('blind OFF: two distinct section titles render for the two colliding-filename models, not one collapsed title', async () => {
    await global.window.AmicusApp.openRun('runA');
    expect(global.window.AmicusApp.state.blind).toBe(false); // terminal fixture -> defaultBlind false

    const panel = await openReviewsPanel();
    expect(panel.dataset.loaded).toBe('1');

    expect(reviewsSectionTitles()).toEqual(['vendor/a', 'vendor:a']);
  });

  test('blind ON: two distinct labeled titles render for the two colliding-filename models, not one collapsed title', async () => {
    await global.window.AmicusApp.openRun('runA');
    await openReviewsPanel();

    // Same-run blind flip (workspace-app.js's change listener -> renderDetail_preserveBlind) —
    // wireLazyPanels() refreshes the already-open panel in place under the new blind state.
    flipBlind(true);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

    expect(global.window.AmicusApp.state.blind).toBe(true);
    expect(reviewsSectionTitles()).toEqual(['Review A', 'Review B']);
  });
});
