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

/**
 * `opts` (Task 4, v4.7 PR7) is an additive, default-preserving extension: every existing caller
 * passes no second argument and gets byte-identical output to the pre-Task-4 fixture. Case (G)
 * below needs a bench where "how many files does files() return" tracks presence directly —
 * BENCH's two entries collide onto ONE filename by design (that's the whole point of the RN-1
 * pin), so it cannot express "1 file present, then 2" — hence the override hooks.
 */
function buildFixtureDetail(runId, opts) {
  const o = opts || {};
  const bench = o.bench || BENCH;
  const artifacts = o.artifacts || {
    // Both bench entries legacy-resolve to the SAME filename (sanitizeName collapses '/' and
    // ':' to '-'), so one manifest entry covers the presence check for both files() candidates.
    'review-vendor-a.md': { present: true, bytes: 100 },
    'chair-output.md': { present: false, bytes: 0 },
    'report.html': { present: false, bytes: 0 },
  };
  const names = o.names || [
    { model: 'vendor/a', label: 'Review A' },
    { model: 'vendor:a', label: 'Review B' },
  ];
  return {
    runId,
    runDir: '/fake/run/' + runId,
    run: {
      status: 'complete', schemaVersion: 2, bench, chair: bench[0],
      stages: [{ name: 'stage1', status: 'complete', startedAt: 't0', completedAt: 't1' }],
      labelMap: {}, usage: null, options: { maxCost: 2 }, error: null, debate: null,
    },
    tally: {}, verdict: {},
    artifacts,
    derived: {
      schemaSupported: true,
      names,
      // THE scope condition (see file header): the legacy-fallback path. Explicit, not merely
      // absent, so a future default change can't quietly turn this test vacuous.
      artifactsByModel: null,
      stageRail: [{ name: 'stage1', label: 'Stage 1 — independent review', status: 'complete', startedAt: 't0', completedAt: 't1' }],
      matrix: { judges: [], rows: [], tierCounts: {}, judged: false },
      cost: {
        rows: bench.map((m) => ({ model: m, role: 'seat', status: 'complete', durationMs: 1000, costDisplay: '$0.10' })),
        totalDisplay: '$0.20', costAmount: 0.20, maxCost: 2,
      },
      verdictPanel: { present: false, overallVerdict: null, tierCounts: null, streetCred: [], decisions: [], reason: null },
    },
  };
}

/** Case (G)'s bench: two DISTINCT (non-colliding) models, so file count tracks presence 1:1. */
const GROWTH_BENCH = ['alpha', 'beta'];

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

  /**
   * Section titles as rendered (the <h3> text of each .prose-section), in DOM order.
   *
   * ⚠️ `querySelectorAll('h3')`, NOT `children[0]`. Reading the title positionally is the exact
   * defect filed and closed as T19-m4 in v4.7 PR4 — it silently reads the wrong node the day
   * renderProseSections prepends anything before the heading, so the pin would keep passing while
   * guarding nothing. Match the house pattern (blind-flip.test.js).
   */
  function reviewsSectionTitles() {
    return global.document.getElementById('reviews-body').children
      .map((el) => el.querySelectorAll('h3')[0].textContent);
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

  /** The reviews-panel section host elements themselves (parent of Task 4's body-text reader
   *  below and of reviewsSectionTitles()'s h3 reader). */
  function reviewsBody() { return global.document.getElementById('reviews-body'); }

  /**
   * Section BODY text (Task 4, v4.7 PR7) — as opposed to reviewsSectionTitles()'s <h3> TITLE
   * text. Cases (B) and (D) below distinguish waves by the artifact TEXT the (mocked)
   * `workspace:read-artifact` reply carries, not by title — the title is captured from the
   * per-run `loaders` spec at loadPanel()-issue time, not from the read reply, so two waves for
   * the SAME open (same blind state) would render identical titles regardless of which wave's
   * reply wins. renderProseSections (workspace-render.js) appends [h3, body-div] per section —
   * children[1] is the body div fed by AmicusMd.renderMdLite(body, s.text, ...).
   */
  function reviewsSectionBodyTexts() {
    return reviewsBody().children.map((el) => el.children[1].textContent);
  }

  /** Count of 'workspace:read-artifact' invoke calls made so far, read fresh off whichever
   *  invoke mock is currently installed — stays correct for the controllable mock cases (B),
   *  (G), (D) below swap in via makeControllableInvoke(), not just the describe-level default. */
  function readArtifactCalls() {
    return global.window.amicusWorkspace.invoke.mock.calls.filter((c) => c[0] === 'workspace:read-artifact').length;
  }

  /**
   * Task 4 (v4.7 PR7, T19-m1 step 2): Task 3's harness (defaultInvoke, above) resolves every
   * 'workspace:read-artifact' call immediately, which cannot express any of cases (B), (G), (D)
   * — each needs two waves in flight for the SAME panel at once, settled in a chosen order. This
   * extends the mock with a deferred-promise mechanism rather than changing defaultInvoke's
   * existing (immediate-resolution) behaviour, which the Task 2/3 cases still rely on unmodified.
   *
   * While armed, each 'workspace:read-artifact' call is held open (never auto-resolved) and
   * recorded into `held`, in issue order — index 0 is the first call, etc. `settle(i, payload)`
   * resolves held[i] with `payload` (or `{text: 'prose'}` if omitted, matching defaultInvoke's
   * own reply shape). Every other channel — and read-artifact calls made before arm() — behave
   * exactly like defaultInvoke.
   */
  function makeControllableInvoke() {
    const held = [];
    let armed = false;
    function invoke(channel, ...args) {
      if (armed && channel === 'workspace:read-artifact') {
        return new Promise((resolve) => { held.push({ name: args[1], resolve }); });
      }
      return defaultInvoke(channel, ...args);
    }
    return {
      invoke,
      arm() { armed = true; },
      heldCount() { return held.length; },
      settle(index, payload) { held[index].resolve(payload || { text: 'prose' }); },
    };
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

  /**
   * Task 3 (v4.7 PR7, T19-m1): a panel the user has COLLAPSED must not keep painting a stale
   * blind state when reopened after a blind flip. Recon paths A (collapsed-then-reopened after
   * a flip) and D (collapsed mid-flight) both trace to the same root cause: the cache drop in
   * wireLazyPanels' `sameRun` arm used to sit INSIDE the `p.open` guard, so a panel that was
   * closed at flip time never had its settled `loading[panelId]` promise dropped — reopening it
   * returned that already-resolved promise (whose `.then` had already fired) instead of issuing
   * a new read.
   *
   * Sequence: open at blind OFF -> collapse -> flip blind ON (panel still closed) -> reopen.
   *
   * Asserts BOTH halves, per the brief:
   * 1. the rendered titles are the blind LABELS ('Review A'/'Review B'), not the raw model ids;
   * 2. a NEW 'workspace:read-artifact' invoke was actually issued on reopen — count is the
   *    load-bearing assertion. Without it, a build that paints correct titles from a stale cache
   *    (impossible today, but not something (1) alone rules out in general) would still pass.
   */
  test('a panel collapsed before a blind flip re-fetches and repaints on reopen, not a stale cached promise (T19-m1, path A)', async () => {
    await global.window.AmicusApp.openRun('runA');
    expect(global.window.AmicusApp.state.blind).toBe(false);

    const panel = await openReviewsPanel();
    expect(reviewsSectionTitles()).toEqual(['vendor/a', 'vendor:a']);

    // Collapse the panel — mirrors the real <details> firing 'toggle' on every open-state
    // change, same convention as openReviewsPanel() firing it on open.
    panel.open = false;
    panel._listeners.toggle[0]();

    const readArtifactCountBeforeFlip = readArtifactCalls();

    // Flip blind ON while the panel is still collapsed — this drives wireLazyPanels' `sameRun`
    // arm with p.open === false for reviews-panel.
    flipBlind(true);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(global.window.AmicusApp.state.blind).toBe(true);

    // Reopen — the real registered toggle listener, exactly like openReviewsPanel().
    panel.open = true;
    panel._listeners.toggle[0]();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

    // (1) titles are the blind labels, not the raw model ids left over from the blind-OFF paint.
    expect(reviewsSectionTitles()).toEqual(['Review A', 'Review B']);
    // (2) load-bearing: a genuinely NEW read-artifact request was issued on reopen, not a
    // repaint from the promise cached before the flip.
    expect(readArtifactCalls()).toBeGreaterThan(readArtifactCountBeforeFlip);
  });

  /**
   * Task 4 (v4.7 PR7, T19-m1 step 2): the monotonic per-panel issue token. Task 3's unconditional
   * `delete loading[id]` (above) closed path A but, by itself, only fences on `runId` — which
   * cannot distinguish two requests issued for the SAME run. Cases (B), (G), (D) below all drive
   * two concurrent waves for one panel and settle the OLDER one last, proving the fence is
   * `issue[panelId] !== token`, not merely `runId !== <captured runId>`.
   *
   * (B): two waves in flight for reviews-panel, panel never collapsed in between — the sameRun
   * rewire's unconditional cache drop reissues a second concurrent fetch for a panel that stays
   * open throughout. Settling the newer wave first, then letting the orphaned older wave settle
   * last, must leave the newer wave's content painted.
   */
  test('(B) two waves in flight for one panel, panel stays open throughout: the older wave settling last must not overwrite the newer paint (T19-m1)', async () => {
    const ctl = makeControllableInvoke();
    global.window.amicusWorkspace.invoke = jest.fn(ctl.invoke);
    ctl.arm();

    await global.window.AmicusApp.openRun('runB');
    await openReviewsPanel(); // issues the OLDER wave: 2 held reads (indices 0-1), panel stays open
    expect(ctl.heldCount()).toBe(2);

    // Same-run rewire while the panel is still OPEN — wireLazyPanels' sameRun arm unconditionally
    // drops loading[id] (Task 3) and, because p.open is true, immediately reissues: a SECOND
    // concurrent fetch for the same panel, no collapse involved.
    flipBlind(true);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(ctl.heldCount()).toBe(4); // older pair (still pending) + newer pair (indices 2-3)

    // Settle the NEWER wave first.
    ctl.settle(2, { text: 'NEW body' });
    ctl.settle(3, { text: 'NEW body' });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(reviewsSectionBodyTexts()).toEqual(['NEW body', 'NEW body']);

    // Then let the orphaned OLDER wave settle last — pre-token, this had no fence but `runId`
    // (unchanged for a same-run rewire), so it repainted unconditionally over the newer content.
    ctl.settle(0, { text: 'OLD body' });
    ctl.settle(1, { text: 'OLD body' });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(reviewsSectionBodyTexts()).toEqual(['NEW body', 'NEW body']);
  });

  /**
   * (G): same-run manifest growth, reachable on the live loop's terminal refresh ALONE — no
   * blind toggle. Drives `window.AmicusApp.renderDetail()` directly (exactly what the live loop's
   * terminal-refresh openRun() ultimately calls) after mutating `state.detail.artifacts` in place
   * to make a second bench file present, simulating "a newly written artifact has appeared"
   * without a second IPC round trip. Uses GROWTH_BENCH (two DISTINCT, non-colliding models)
   * because BENCH's collision-by-design bench cannot express "1 file present, then 2".
   */
  test('(G) same-run manifest growth: settling the older (1-file) reply last must not shrink the panel back down (T19-m1)', async () => {
    const held = [];
    const detail = buildFixtureDetail('runG', {
      bench: GROWTH_BENCH,
      artifacts: {
        'review-alpha.md': { present: true, bytes: 50 },
        'review-beta.md': { present: false, bytes: 0 },
        'chair-output.md': { present: false, bytes: 0 },
        'report.html': { present: false, bytes: 0 },
      },
      names: [{ model: 'alpha', label: 'Alpha' }, { model: 'beta', label: 'Beta' }],
    });
    global.window.amicusWorkspace.invoke = jest.fn((channel, ...args) => {
      if (channel === 'workspace:list-runs') { return Promise.resolve([]); }
      if (channel === 'workspace:get-run') { return Promise.resolve(detail); }
      if (channel === 'workspace:read-artifact') {
        return new Promise((resolve) => { held.push({ name: args[1], resolve }); });
      }
      return Promise.resolve(null);
    });

    await global.window.AmicusApp.openRun('runG');
    await openReviewsPanel(); // issues the OLDER wave: only 'alpha' is present -> 1 held read
    expect(held.length).toBe(1);

    // "a newly written artifact has appeared" — mutate the SAME object state.detail already
    // points at (openRun() assigns the IPC reply by reference; a same-run refresh never re-fetches
    // it, so this is exactly what a real manifest write between polls would produce).
    detail.artifacts['review-beta.md'].present = true;

    // No blind toggle: the live loop's terminal refresh calls renderDetail() directly
    // (workspace-verbs.js's startLiveLoop tick -> A.openRun() -> renderDetail()). Same-run (run id
    // and status both unchanged), so this drives wireLazyPanels' sameRun arm exactly like a blind
    // flip would, just without one.
    global.window.AmicusApp.renderDetail();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(held.length).toBe(3); // older (still pending, 1) + newer (2: alpha again + beta)

    // Settle the NEWER (2-file) wave first.
    held[1].resolve({ text: 'alpha prose' });
    held[2].resolve({ text: 'beta prose' });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(reviewsBody().children.length).toBe(2);

    // Settle the orphaned OLDER (1-file) reply last — must not repaint the panel back down to 1.
    held[0].resolve({ text: 'alpha prose (stale)' });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(reviewsBody().children.length).toBe(2);
  });

  /**
   * (D): collapse mid-flight, rewire, reopen, stale reply settles last. Found by the Task 3
   * review, which built a working reproduction — this is why Task 3 could not close path D on
   * its own. `loadPanel`'s `if (loading[panelId]) return loading[panelId];` guard used to make
   * two concurrent reads for one panel impossible within a run; Task 3's unconditional
   * `delete loading[id]` removes that protection the moment a collapsed panel's fetch is still
   * outstanding. The orphaned promise has no fence but `runId` (unchanged), so pre-token it
   * repainted unconditionally — silently, no error, no visual tell.
   */
  test('(D) collapse mid-flight, rewire, reopen: the orphaned pre-collapse reply settling last must not overwrite the new open (T19-m1, path D)', async () => {
    const ctl = makeControllableInvoke();
    global.window.amicusWorkspace.invoke = jest.fn(ctl.invoke);
    ctl.arm();

    await global.window.AmicusApp.openRun('runD');
    const panel = await openReviewsPanel(); // pre-collapse wave: 2 held reads (indices 0-1)
    expect(ctl.heldCount()).toBe(2);

    // Collapse while still in flight — mirrors the real <details> firing 'toggle' on every
    // open-state change; proseLoader's listener no-ops on close, same as production.
    panel.open = false;
    panel._listeners.toggle[0]();

    // Same-run rewire while the panel is CLOSED. Task 3's unconditional `delete loading[id]`
    // drops the cache entry even though the pre-collapse fetch is still outstanding; since
    // p.open is false here, wireLazyPanels' sameRun arm does NOT reissue on the rewire itself.
    flipBlind(true);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(ctl.heldCount()).toBe(2); // unchanged: closed, so no reissue from the rewire alone

    // Reopen — loading[panelId] was dropped above, so loadPanel's guard no longer blocks: this
    // issues a SECOND concurrent fetch while the pre-collapse pair is still pending.
    panel.open = true;
    panel._listeners.toggle[0]();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(ctl.heldCount()).toBe(4); // pre-collapse pair (still pending) + the new pair from reopen

    // Resolve the NEW pair first.
    ctl.settle(2, { text: 'NEW body' });
    ctl.settle(3, { text: 'NEW body' });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(reviewsSectionBodyTexts()).toEqual(['NEW body', 'NEW body']);

    // Then let the orphaned pre-collapse pair settle. Assert the panel still shows the new
    // content — the load-bearing proof that the issue token, not `runId` alone, fences this.
    ctl.settle(0, { text: 'STALE body' });
    ctl.settle(1, { text: 'STALE body' });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(reviewsSectionBodyTexts()).toEqual(['NEW body', 'NEW body']);
  });
});
