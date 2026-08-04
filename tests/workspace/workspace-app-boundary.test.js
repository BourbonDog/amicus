'use strict';

const { makeFakeDom } = require('./helpers/fake-workspace-page');
const { SCRIPT_LOAD_ORDER } = require('./helpers/script-load-order');

const UI = '../../electron/workspace-ui/';
const LOAD_ORDER = SCRIPT_LOAD_ORDER;

/**
 * Cross-file namespace boundary proof for Task 13's mandatory F05 three-file split
 * (workspace-app.js / workspace-panels.js / workspace-verbs.js). Per the task brief:
 * "A test that loads the three IIFEs in the documented order and calls renderDetail()
 * — asserting no ReferenceError and that each namespace exposes every name in the
 * table above — is worth more than any individual painter assertion, because a
 * missing export is exactly the failure this split invites." This file is that test,
 * plus the specific bugs the split/P4/F09/F38 notes warn about: stale-run listener
 * leak, the awaitable prose loader, and the debate re-vote drill-in target.
 */
function loadOrderedScripts() {
  jest.resetModules(); // force every IIFE to re-run against the fresh globals set beforehand
  LOAD_ORDER.forEach((f) => {
    require(UI + f); // eslint-disable-line global-require
  });
}

/** Minimal RunDetail-shaped fixture — enough for every painter this task wires. */
function buildFixtureDetail(runId) {
  const bench = runId === 'bbbb2222' ? ['claude'] : ['gemini', 'gpt'];
  const labelMap = runId === 'bbbb2222' ? { 'Review A': 'claude' } : { 'Review A': 'gemini', 'Review B': 'gpt' };
  return {
    runId,
    runDir: '/fake/run/' + runId,
    run: {
      status: 'complete', schemaVersion: 2, bench, chair: bench[bench.length - 1],
      stages: [{ name: 'stage1', status: 'complete', startedAt: 't0', completedAt: 't1' }],
      labelMap, usage: { cost: { amount: 0.43 } }, options: { maxCost: 2 }, error: null, debate: null,
    },
    tally: {}, verdict: {},
    // review-/judge- files present by default (a realistic terminal-run manifest) — tests
    // for the code-review finding-2 presence filter override specific entries to false.
    artifacts: Object.assign(
      { 'chair-output.md': { present: false, bytes: 0 }, 'report.html': { present: true, bytes: 512 } },
      ...bench.map((m) => ({
        ['review-' + m + '.md']: { present: true, bytes: 100 },
        ['judge-' + m + '.md']: { present: true, bytes: 100 },
      })),
    ),
    derived: {
      schemaSupported: true,
      names: Object.entries(labelMap).map(([label, model]) => ({ label, model })),
      stageRail: [{ name: 'stage1', label: 'Stage 1 — independent review', status: 'complete', startedAt: 't0', completedAt: 't1' }],
      matrix: {
        judges: bench.map((m) => ({ model: m, label: null })),
        rows: [{
          id: 'A1', severity: 'high', tier: 'Confirmed', thin: false, tierOverride: null, debate: null,
          raiser: { model: bench[0], label: null }, basis: { a: 1, d: 0, n: 0 },
          cells: bench.map((m, i) => ({
            judge: { model: m, label: null }, verdict: i === bench.length - 1 ? 'dispute' : 'agree',
            sym: i === bench.length - 1 ? '✗' : '✓', isRaiser: i === 0,
          })),
        }],
        tierCounts: { Confirmed: 1 }, judged: true,
      },
      cost: {
        rows: bench.map((m) => ({ model: m, role: 'seat', status: 'complete', durationMs: 1000, costDisplay: '$0.20' })),
        totalDisplay: '$0.43', costAmount: 0.43, maxCost: 2,
      },
      verdictPanel: { present: true, overallVerdict: 'Fix these first', tierCounts: { Confirmed: 1 }, streetCred: [], decisions: [], reason: null },
      artifactCollisions: [],
    },
  };
}

function defaultInvoke(channel, ...args) {
  if (channel === 'workspace:list-runs') { return Promise.resolve([]); }
  if (channel === 'workspace:get-run') { return Promise.resolve(buildFixtureDetail(args[0])); }
  if (channel === 'workspace:read-artifact') { return Promise.resolve({ text: 'Prose about A1 for ' + args[1] + '.' }); }
  if (channel === 'workspace:fold') { return Promise.resolve({ ok: true }); }
  if (channel === 'workspace:open-report') { return Promise.resolve({ ok: true }); }
  return Promise.resolve(null);
}

describe('workspace-ui namespace boundary (Task 13 F05 split: app / panels / verbs)', () => {
  let invokeMock;

  beforeEach(() => {
    const fake = makeFakeDom();
    global.window = fake.window;
    global.document = fake.document;
    global.NodeFilter = fake.NodeFilter;
    invokeMock = jest.fn(defaultInvoke);
    global.window.amicusWorkspace.invoke = invokeMock;
    loadOrderedScripts();
  });

  afterEach(() => {
    if (global.window.AmicusApp && global.window.AmicusApp.state.listTimer) {
      clearInterval(global.window.AmicusApp.state.listTimer);
    }
    delete global.window;
    delete global.document;
    delete global.NodeFilter;
  });

  test('loading the seven scripts in documented order raises no ReferenceError, and each namespace exposes the full P2 contract surface', () => {
    const A = global.window.AmicusApp;
    const P = global.window.AmicusPanels;
    const V = global.window.AmicusVerbs;
    expect(A).toBeTruthy();
    expect(P).toBeTruthy();
    expect(V).toBeTruthy();
    expect(typeof A.state).toBe('object');
    ['invoke', '$', 'labelOf', 'isBlind', 'openRun', 'renderDetail', 'renderBanners'].forEach((k) => {
      expect(typeof A[k]).toBe('function');
    });
    ['renderSeatsPanel', 'renderMatrixPanel', 'renderVerdictPanel', 'wireLazyPanels', 'proseLoader', 'drillIntoJudge', 'sanitizeName'].forEach((k) => {
      expect(typeof P[k]).toBe('function');
    });
    // ⚠️ Task 15/16: startLiveLoop/stopLiveLoop/applyLive/openAbortDialog land in
    // workspace-verbs.js (F05), not workspace-app.js — this contract is what catches a
    // misplaced or missing export before the browser does.
    ['doFold', 'startLiveLoop', 'stopLiveLoop', 'applyLive', 'openAbortDialog'].forEach((k) => {
      expect(typeof V[k]).toBe('function');
    });
  });

  test('openRun() -> renderDetail() drives seats/matrix/verdict/cost panels (all cross-file calls) with no throw', async () => {
    await global.window.AmicusApp.openRun('aaaa1111');
    expect(global.document.getElementById('run-title').textContent).toBe('aaaa1111');
    expect(global.document.getElementById('matrix-body').querySelectorAll('tr').length).toBeGreaterThan(0);
    expect(global.document.getElementById('verdict-body').textContent).toContain('VERDICT: Fix these first');
    expect(global.document.getElementById('seats-body').children.length).toBe(2);
    expect(global.document.getElementById('cost-body').textContent).toContain('$0.43');
  });

  test('the Open-report button wired by panels.js calls A.invoke(\'workspace:open-report\', runId) — LIVE from this task on, same as Fold', async () => {
    await global.window.AmicusApp.openRun('aaaa1111');
    const reportBtn = global.document.getElementById('verdict-body').querySelector('#open-report-btn');
    expect(reportBtn).toBeTruthy();
    reportBtn._listeners.click[0]();
    const reportCalls = invokeMock.mock.calls.filter((c) => c[0] === 'workspace:open-report');
    expect(reportCalls.length).toBe(1);
    expect(reportCalls[0][1]).toBe('aaaa1111');
  });

  test('the Fold button wired by panels.js (renderVerdictPanel) calls verbs.js doFold via window.AmicusVerbs at call time', async () => {
    await global.window.AmicusApp.openRun('aaaa1111');
    const foldBtn = global.document.getElementById('verdict-body').querySelector('#fold-btn');
    expect(foldBtn).toBeTruthy();
    foldBtn._listeners.click[0]();
    await Promise.resolve();
    await Promise.resolve();
    const foldCalls = invokeMock.mock.calls.filter((c) => c[0] === 'workspace:fold');
    expect(foldCalls.length).toBe(1);
    expect(foldCalls[0][1]).toBe('aaaa1111');
    expect(foldBtn.textContent).toBe('Folded ✓');
    expect(foldBtn.disabled).toBe(true);
  });

  // ⚠️ v4.4.1 LC-8: doFold's invoke chain had no rejection handler. workspace:fold's IPC handler
  // catches its own errors and answers {ok:false, error}, so a REJECTION means the channel itself
  // failed — and the button simply sat in its pre-click state with no explanation while the
  // renderer logged an unhandled rejection (which jest-circus fails the running test on).
  test('LC-8: a rejected workspace:fold explains itself on the button instead of failing silently', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    invokeMock.mockImplementation((channel, ...args) => {
      if (channel === 'workspace:fold') { return Promise.reject(new Error('channel closed')); }
      return defaultInvoke(channel, ...args);
    });
    await global.window.AmicusApp.openRun('aaaa1111');
    const foldBtn = global.document.getElementById('verdict-body').querySelector('#fold-btn');
    foldBtn._listeners.click[0]();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

    expect(foldBtn.textContent).toBe('Fold to Claude Code'); // not falsely marked folded
    expect(foldBtn.disabled).toBeFalsy();                    // still retryable
    expect(foldBtn.title).toContain('channel is unavailable');
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  test('switching runs does not leak a stale toggle listener: the panel requests the NEW run\'s own artifact names, and the listener is registered exactly once (⚠️ DE-ROT F09)', async () => {
    await global.window.AmicusApp.openRun('aaaa1111'); // bench ['gemini', 'gpt']
    await global.window.AmicusApp.openRun('bbbb2222'); // bench ['claude']
    const panel = global.document.getElementById('reviews-panel');
    expect(panel._listeners.toggle.length).toBe(1); // registered once at boot, never stacked
    panel.open = true;
    panel._listeners.toggle[0]();
    await Promise.resolve();
    await Promise.resolve();
    const reviewCalls = invokeMock.mock.calls.filter((c) => c[0] === 'workspace:read-artifact' && String(c[2]).indexOf('review-') === 0);
    expect(reviewCalls.length).toBeGreaterThan(0);
    expect(reviewCalls.every((c) => c[1] === 'bbbb2222')).toBe(true);
    expect(reviewCalls.some((c) => c[2] === 'review-claude.md')).toBe(true);
    expect(reviewCalls.some((c) => c[2] === 'review-gemini.md')).toBe(false);
  });

  test('drillIntoJudge awaits the load then highlights the finding id — no fixed setTimeout guess (⚠️ PRE-FLIGHT P4)', async () => {
    await global.window.AmicusApp.openRun('aaaa1111');
    await global.window.AmicusPanels.drillIntoJudge({ model: 'gpt', label: null }, 'A1');
    const judgesBody = global.document.getElementById('judges-body');
    expect(judgesBody.querySelector('mark')).toBeTruthy();
    expect(global.document.getElementById('judges-panel').dataset.loaded).toBe('1');
  });

  test('drillIntoJudge prefers revote-<model>.md and renders the structured reason when debate.json has a matching (judge,id) entry (⚠️ DE-ROT F38)', async () => {
    invokeMock.mockImplementation((channel, ...args) => {
      if (channel === 'workspace:list-runs') { return Promise.resolve([]); }
      if (channel === 'workspace:get-run') {
        const d = buildFixtureDetail(args[0]);
        d.run.debate = { outcome: 'ran' };
        d.artifacts['revote-gpt.md'] = { present: true, bytes: 50 };
        return Promise.resolve(d);
      }
      if (channel === 'workspace:read-artifact' && args[1] === 'debate.json') {
        return Promise.resolve({ text: JSON.stringify({ revotes: [{ judge: 'gpt', id: 'A1', verdict: 'agree', reason: 'Reconsidered after rebuttal.', applied: true }] }) });
      }
      if (channel === 'workspace:read-artifact') { return Promise.resolve({ text: 'Prose about A1 for ' + args[2] + '.' }); }
      return Promise.resolve(null);
    });
    await global.window.AmicusApp.openRun('aaaa1111');
    await Promise.resolve();
    await Promise.resolve(); // let the fire-and-forget debate.json fetch land before the drill-in
    await global.window.AmicusPanels.drillIntoJudge({ model: 'gpt', label: null }, 'A1');
    const revoteCalls = invokeMock.mock.calls.filter((c) => c[0] === 'workspace:read-artifact' && c[2] === 'revote-gpt.md');
    expect(revoteCalls.length).toBeGreaterThan(0);
    expect(global.document.getElementById('judges-body').textContent).toContain('Reconsidered after rebuttal.');
  });

  test('a dispute cell not covered by any revote still falls back to judge-<model>.md (no debate.json match)', async () => {
    invokeMock.mockImplementation((channel, ...args) => {
      if (channel === 'workspace:list-runs') { return Promise.resolve([]); }
      if (channel === 'workspace:get-run') {
        const d = buildFixtureDetail(args[0]);
        d.run.debate = { outcome: 'ran' };
        return Promise.resolve(d);
      }
      if (channel === 'workspace:read-artifact' && args[1] === 'debate.json') {
        return Promise.resolve({ text: JSON.stringify({ revotes: [] }) });
      }
      if (channel === 'workspace:read-artifact') { return Promise.resolve({ text: 'Prose about A1 for ' + args[2] + '.' }); }
      return Promise.resolve(null);
    });
    await global.window.AmicusApp.openRun('aaaa1111');
    await Promise.resolve();
    await Promise.resolve();
    await global.window.AmicusPanels.drillIntoJudge({ model: 'gpt', label: null }, 'A1');
    const judgeCalls = invokeMock.mock.calls.filter((c) => c[0] === 'workspace:read-artifact' && c[2] === 'judge-gpt.md');
    expect(judgeCalls.length).toBeGreaterThan(0);
  });

  // ⚠️ R4 COUNCIL REVIEW (fourth live paid council, major, unanimous): loadPanel() guards
  // re-ENTRY per panel id (`if (loading[panelId]) return loading[panelId];`) and
  // wireLazyPanels() clears that cache on every run switch so a NEW request can be issued —
  // but the completion handler never checked which run was open when ITS OWN request was
  // issued. Open reviews-panel on run A, switch to run B (which clears the cache and, once
  // its own panel toggle fires, issues its OWN request), then let A's held request resolve
  // AFTER B's has already rendered: A's prose must not land in B's panel. Same class of bug
  // as F09 (stale listener) and the debate.json race below — the fix mirrors both: capture
  // the runId at request time, pass it through, and guard as the first statement of the
  // completion handler.
  test('a stale reviews-panel response from a run navigated away from never overwrites the panel now showing a different run (loadPanel race)', async () => {
    let resolveStaleReview;
    const staleReview = new Promise((resolve) => { resolveStaleReview = resolve; });
    invokeMock.mockImplementation((channel, ...args) => {
      if (channel === 'workspace:list-runs') { return Promise.resolve([]); }
      if (channel === 'workspace:get-run') { return Promise.resolve(buildFixtureDetail(args[0])); }
      if (channel === 'workspace:read-artifact' && args[1] === 'review-gemini.md') {
        return staleReview; // run A's own artifact request — held open past the run switch
      }
      if (channel === 'workspace:read-artifact') { return Promise.resolve({ text: 'Prose about A1 for ' + args[1] + '.' }); }
      return Promise.resolve(null);
    });

    await global.window.AmicusApp.openRun('aaaa1111'); // bench ['gemini', 'gpt']
    const panel = global.document.getElementById('reviews-panel');
    panel.open = true;
    panel._listeners.toggle[0](); // issues run A's reviews-panel request; review-gemini.md is held
    await Promise.resolve();

    await global.window.AmicusApp.openRun('bbbb2222'); // switch runs; bench ['claude']
    panel.open = true;
    panel._listeners.toggle[0](); // issues run B's OWN request (loading cache was cleared)
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(global.document.getElementById('reviews-body').textContent).toContain('Prose about A1 for review-claude.md.');

    // Now let run A's held request resolve, well after B has rendered.
    resolveStaleReview({ text: 'STALE RUN A PROSE' });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const bodyText = global.document.getElementById('reviews-body').textContent;
    expect(bodyText).not.toContain('STALE RUN A PROSE');
    expect(bodyText).toContain('Prose about A1 for review-claude.md.');
  });

  // ⚠️ CODE REVIEW (round 2, finding 1): openRun() nulls state.debate synchronously, but the
  // debate.json fetch it kicks off is fire-and-forget with no runId guard on the resolution —
  // this is the exact F09 class of bug (a stale async response landing after the user has
  // navigated away), reintroduced by the new F38 code.
  test('a stale debate.json fetch from a run navigated away from never overwrites state.debate for the run now open', async () => {
    let resolveStaleDebate;
    const staleDebate = new Promise((resolve) => { resolveStaleDebate = resolve; });
    invokeMock.mockImplementation((channel, ...args) => {
      if (channel === 'workspace:list-runs') { return Promise.resolve([]); }
      if (channel === 'workspace:get-run') {
        const d = buildFixtureDetail(args[0]);
        d.run.debate = { outcome: 'ran' };
        return Promise.resolve(d);
      }
      if (channel === 'workspace:read-artifact' && args[1] === 'debate.json') {
        if (args[0] === 'aaaa1111') { return staleDebate; } // held open until we resolve it below
        return Promise.resolve({ text: JSON.stringify({ revotes: [{ judge: 'claude', id: 'A1', reason: 'RUN B REASON' }] }) });
      }
      return Promise.resolve({ text: 'prose' });
    });
    await global.window.AmicusApp.openRun('aaaa1111'); // kicks off A's debate.json fetch, left pending
    await global.window.AmicusApp.openRun('bbbb2222'); // fully resolves, including B's OWN debate.json
    expect(global.window.AmicusApp.state.debate).toEqual({ revotes: [{ judge: 'claude', id: 'A1', reason: 'RUN B REASON' }] });
    resolveStaleDebate({ text: JSON.stringify({ revotes: [{ judge: 'gpt', id: 'A1', reason: 'STALE FROM RUN A' }] }) });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    // Run A's now-resolved, stale response must not have clobbered run B's state.
    expect(global.window.AmicusApp.state.runId).toBe('bbbb2222');
    expect(global.window.AmicusApp.state.debate).toEqual({ revotes: [{ judge: 'claude', id: 'A1', reason: 'RUN B REASON' }] });
  });

  test('a rejecting debate.json fetch does not throw and leaves state.debate null, not an unhandled rejection', async () => {
    invokeMock.mockImplementation((channel, ...args) => {
      if (channel === 'workspace:list-runs') { return Promise.resolve([]); }
      if (channel === 'workspace:get-run') {
        const d = buildFixtureDetail(args[0]);
        d.run.debate = { outcome: 'ran' };
        return Promise.resolve(d);
      }
      if (channel === 'workspace:read-artifact' && args[1] === 'debate.json') { return Promise.reject(new Error('IPC channel closed')); }
      return Promise.resolve({ text: 'prose' });
    });
    await expect(global.window.AmicusApp.openRun('aaaa1111')).resolves.toBeUndefined();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(global.window.AmicusApp.state.debate).toBeNull();
  });

  // ⚠️ CODE REVIEW (round 2, finding 2): wireLazyPanels() speculatively requested EVERY
  // revote-<model>.md whenever run.debate was truthy — which is seeded on the FIRST run.json
  // write, so it's truthy even when the re-vote wave never ran (no contested findings, cost
  // ceiling, abort). readRunArtifact's error message for a genuinely-missing artifact was
  // rendered verbatim into the panel. run-detail.js already computes a presence manifest
  // (state.detail.artifacts) for exactly these allowlisted names — filter on it instead of
  // requesting files known ahead of time to be absent.
  test('wireLazyPanels excludes review-/judge-/revote- files the artifacts manifest already reports absent — no round trip for a debate run where the re-vote wave never ran', async () => {
    invokeMock.mockImplementation((channel, ...args) => {
      if (channel === 'workspace:list-runs') { return Promise.resolve([]); }
      if (channel === 'workspace:get-run') {
        const d = buildFixtureDetail(args[0]); // bench ['gemini', 'gpt']
        d.run.debate = { outcome: 'ran' }; // debate ran, but nothing was contested
        d.artifacts['revote-gemini.md'] = { present: false, bytes: 0 };
        d.artifacts['revote-gpt.md'] = { present: false, bytes: 0 };
        d.artifacts['judge-gemini.md'] = { present: true, bytes: 10 };
        d.artifacts['judge-gpt.md'] = { present: true, bytes: 10 };
        return Promise.resolve(d);
      }
      if (channel === 'workspace:read-artifact' && args[1] === 'debate.json') { return Promise.resolve({ text: JSON.stringify({ revotes: [] }) }); }
      return Promise.resolve({ text: 'prose' });
    });
    await global.window.AmicusApp.openRun('aaaa1111');
    const panel = global.document.getElementById('judges-panel');
    panel.open = true;
    panel._listeners.toggle[0]();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    const revoteCalls = invokeMock.mock.calls.filter((c) => c[0] === 'workspace:read-artifact' && String(c[2]).indexOf('revote-') === 0);
    expect(revoteCalls.length).toBe(0);
    const judgeCalls = invokeMock.mock.calls.filter((c) => c[0] === 'workspace:read-artifact' && String(c[2]).indexOf('judge-') === 0);
    expect(judgeCalls.length).toBe(2);
  });

  // ⚠️ v4.4.1 RN-4: reviews-panel and judges-panel have always `.filter(present)`-ed against the
  // artifact manifest before requesting files; bundle-panel was the odd one out. On a run whose
  // Stage 2 never produced a bundle (a one-seat bench, an abort before the cross-review, a cost
  // ceiling), opening the Bundle panel requested a file the manifest already knew was absent and
  // painted readRunArtifact's raw error string — "absolute host path and all", per this file's
  // sibling note. The default fixture manifest carries no 'bundle-stage2.md' entry at all, which
  // is exactly the absent case.
  test('bundle-panel does not request bundle-stage2.md when the manifest reports it absent (RN-4)', async () => {
    await global.window.AmicusApp.openRun('aaaa1111');
    const panel = global.document.getElementById('bundle-panel');
    panel.open = true;
    panel._listeners.toggle[0]();
    await Promise.resolve();
    await Promise.resolve();
    const bundleCalls = invokeMock.mock.calls.filter((c) => c[0] === 'workspace:read-artifact' && c[2] === 'bundle-stage2.md');
    expect(bundleCalls.length).toBe(0);
    // …and the panel shows nothing rather than a host path — no raw error text made it in.
    expect(global.document.getElementById('bundle-body').textContent).toBe('');
  });

  test('bundle-panel still requests bundle-stage2.md when the manifest reports it present (RN-4 does not break the normal run)', async () => {
    invokeMock.mockImplementation((channel, ...args) => {
      if (channel === 'workspace:get-run') {
        const d = buildFixtureDetail(args[0]);
        d.artifacts['bundle-stage2.md'] = { present: true, bytes: 4096 };
        return Promise.resolve(d);
      }
      return defaultInvoke(channel, ...args);
    });
    await global.window.AmicusApp.openRun('aaaa1111');
    const panel = global.document.getElementById('bundle-panel');
    panel.open = true;
    panel._listeners.toggle[0]();
    await Promise.resolve();
    await Promise.resolve();
    const bundleCalls = invokeMock.mock.calls.filter((c) => c[0] === 'workspace:read-artifact' && c[2] === 'bundle-stage2.md');
    expect(bundleCalls.length).toBe(1);
  });

  // ⚠️ v4.4.1 RN-9: the review/judge panel TITLES used to hand-roll `A.state.blind && label ?
  // label : m` inline — two of the three surviving copies of the blind flip in files that
  // already had AmicusRender.display() available. Routed through display() so the next blind
  // ruling lands once. This proves the routing preserved the behaviour in both directions.
  describe('panel titles mask through the shared display() (RN-9)', () => {
    async function openBlind(blind) {
      await global.window.AmicusApp.openRun('aaaa1111'); // bench ['gemini','gpt'], labels Review A/B
      global.window.AmicusApp.state.blind = blind;
      global.window.AmicusPanels.wireLazyPanels(); // re-evaluate the loaders under this blind state
      ['reviews-panel', 'judges-panel'].forEach((id) => {
        const p = global.document.getElementById(id);
        p.open = true;
        p._listeners.toggle[0]();
      });
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    }

    // Titles only — the fixture's PROSE body deliberately echoes the raw filename, which is a
    // read of the artifact's contents, not an identity surface.
    const titles = (id) => global.document.getElementById(id)
      .querySelectorAll('h3').map((h) => h.textContent);

    test('blind ON titles the sections by label, never by model id', async () => {
      await openBlind(true);
      expect(titles('reviews-body')).toEqual(['Review A', 'Review B']);
      expect(titles('judges-body')).toEqual(['Judge Review A', 'Judge Review B']);
    });

    test('blind OFF titles the sections by model id, exactly as before', async () => {
      await openBlind(false);
      expect(titles('reviews-body')).toEqual(['gemini', 'gpt']);
      expect(titles('judges-body')).toEqual(['Judge gemini', 'Judge gpt']);
    });
  });

  test('a review-<model>.md the manifest reports absent is never requested by the reviews panel either', async () => {
    invokeMock.mockImplementation((channel, ...args) => {
      if (channel === 'workspace:list-runs') { return Promise.resolve([]); }
      if (channel === 'workspace:get-run') {
        const d = buildFixtureDetail(args[0]);
        d.artifacts['review-gemini.md'] = { present: false, bytes: 0 };
        d.artifacts['review-gpt.md'] = { present: true, bytes: 10 };
        return Promise.resolve(d);
      }
      return Promise.resolve({ text: 'prose' });
    });
    await global.window.AmicusApp.openRun('aaaa1111');
    const panel = global.document.getElementById('reviews-panel');
    panel.open = true;
    panel._listeners.toggle[0]();
    await Promise.resolve();
    await Promise.resolve();
    const reviewCalls = invokeMock.mock.calls.filter((c) => c[0] === 'workspace:read-artifact' && String(c[2]).indexOf('review-') === 0);
    expect(reviewCalls).toEqual([['workspace:read-artifact', 'aaaa1111', 'review-gpt.md']]);
  });

  // ⚠️ CODE REVIEW (round 2, finding 4): loadPanel is cached per panel id, but the drill-in's
  // DOM mutation (insert reason paragraph, wrap the finding id in <mark>) was not idempotent —
  // a second drill into the same (judge, id) duplicated the reason paragraph and nested a
  // second <mark> inside the first.
  test('drilling into the same finding twice does not duplicate the revote-reason paragraph or nest a second <mark>', async () => {
    invokeMock.mockImplementation((channel, ...args) => {
      if (channel === 'workspace:list-runs') { return Promise.resolve([]); }
      if (channel === 'workspace:get-run') {
        const d = buildFixtureDetail(args[0]);
        d.run.debate = { outcome: 'ran' };
        d.artifacts['revote-gpt.md'] = { present: true, bytes: 50 };
        return Promise.resolve(d);
      }
      if (channel === 'workspace:read-artifact' && args[1] === 'debate.json') {
        return Promise.resolve({ text: JSON.stringify({ revotes: [{ judge: 'gpt', id: 'A1', reason: 'Reconsidered after rebuttal.' }] }) });
      }
      if (channel === 'workspace:read-artifact') { return Promise.resolve({ text: 'Prose about A1 for ' + args[2] + '.' }); }
      return Promise.resolve(null);
    });
    await global.window.AmicusApp.openRun('aaaa1111');
    await Promise.resolve();
    await Promise.resolve();
    await global.window.AmicusPanels.drillIntoJudge({ model: 'gpt', label: null }, 'A1');
    await global.window.AmicusPanels.drillIntoJudge({ model: 'gpt', label: null }, 'A1');
    const judgesBody = global.document.getElementById('judges-body');
    expect(judgesBody.querySelectorAll('.revote-reason').length).toBe(1);
    expect(judgesBody.querySelectorAll('mark').length).toBe(1);
  });

  test('drilling into a plain (non-revote) dispute finding twice also does not nest a second <mark>', async () => {
    await global.window.AmicusApp.openRun('aaaa1111');
    await global.window.AmicusPanels.drillIntoJudge({ model: 'gpt', label: null }, 'A1');
    await global.window.AmicusPanels.drillIntoJudge({ model: 'gpt', label: null }, 'A1');
    const judgesBody = global.document.getElementById('judges-body');
    expect(judgesBody.querySelectorAll('mark').length).toBe(1);
  });

  // ⚠️ R4 COUNCIL REVIEW (fourth live paid council, major, unanimous): the idempotency guard
  // above (round 2, finding 4) checks for an existing <mark>/.revote-reason ANYWHERE in the
  // section — but loadPanel's promise cache means the section is built once and never
  // rebuilt, so once ANY finding has been drilled into for a judge, the guard is permanently
  // tripped: a later drill into a DIFFERENT finding for the SAME judge silently does nothing.
  // The fix must satisfy both: a repeat drill on the SAME finding stays a no-op (covered by
  // the two tests above), and a drill into a DIFFERENT finding on the same judge must still
  // highlight — by clearing the previous finding's mark/reason first.
  test('drilling into a different finding for the same judge highlights the new finding, clearing the previous one (drill-down was single-use per judge)', async () => {
    invokeMock.mockImplementation((channel, ...args) => {
      if (channel === 'workspace:list-runs') { return Promise.resolve([]); }
      if (channel === 'workspace:get-run') { return Promise.resolve(buildFixtureDetail(args[0])); }
      if (channel === 'workspace:read-artifact') {
        return Promise.resolve({ text: 'Judge notes: A1 raised here. A2 raised here too.' });
      }
      return Promise.resolve(null);
    });
    await global.window.AmicusApp.openRun('aaaa1111'); // bench ['gemini', 'gpt']
    await global.window.AmicusPanels.drillIntoJudge({ model: 'gpt', label: null }, 'A1');
    const judgesBody = global.document.getElementById('judges-body');
    const section = judgesBody.querySelector('[data-artifact="judge-gpt.md"]');
    expect(section.querySelectorAll('mark').length).toBe(1);
    expect(section.querySelector('mark').textContent).toBe('A1');

    await global.window.AmicusPanels.drillIntoJudge({ model: 'gpt', label: null }, 'A2');
    expect(section.querySelectorAll('mark').length).toBe(1); // old A1 mark cleared, not stacked
    expect(section.querySelector('mark').textContent).toBe('A2');

    // Drilling back into A1 must still work (and stay idempotent on a further repeat).
    await global.window.AmicusPanels.drillIntoJudge({ model: 'gpt', label: null }, 'A1');
    expect(section.querySelectorAll('mark').length).toBe(1);
    expect(section.querySelector('mark').textContent).toBe('A1');
    await global.window.AmicusPanels.drillIntoJudge({ model: 'gpt', label: null }, 'A1');
    expect(section.querySelectorAll('mark').length).toBe(1);
    expect(section.querySelector('mark').textContent).toBe('A1');
  });

  // ⚠️ R4 COUNCIL REVIEW (fourth live paid council, major, unanimous): a sanitizeName
  // collision between two distinct bench entries is a run-integrity defect (the run
  // directory cannot hold both models' artifacts under distinct names) — run-detail.js
  // surfaces it as `derived.artifactCollisions`; the renderer must warn loudly rather than
  // silently letting drillIntoJudge misattribute prose to the wrong model.
  test('a run with artifactCollisions renders a run-integrity banner naming the colliding models', async () => {
    invokeMock.mockImplementation((channel, ...args) => {
      if (channel === 'workspace:list-runs') { return Promise.resolve([]); }
      if (channel === 'workspace:get-run') {
        const d = buildFixtureDetail(args[0]);
        d.derived.artifactCollisions = [{ sanitized: 'vendor-a', models: ['vendor/a', 'vendor?a'] }];
        return Promise.resolve(d);
      }
      return Promise.resolve({ text: 'prose' });
    });
    await global.window.AmicusApp.openRun('aaaa1111');
    const bannerText = global.document.getElementById('banner').textContent;
    expect(bannerText).toContain('vendor/a');
    expect(bannerText).toContain('vendor?a');
    expect(bannerText).toContain('vendor-a');
  });

  // ⚠️ R4 COUNCIL REVIEW (fourth live paid council, major, unanimous): renderHeaderChips now
  // masks bench/critic/chair chips via display(blind, labelOf) — but renderDetail_preserveBlind
  // (the blind-toggle change handler's wrapper) re-renders seats/matrix/verdict/cost with the
  // user's chosen blind value restored, and used to never re-render the header chips at all.
  // renderDetail() itself resets state.blind to the run's DEFAULT mid-call (only restored to
  // `keep` afterward), so a naive threading of blind through renderHeaderChips would leave the
  // header chips painted with the wrong (default, not user-chosen) blind value after a toggle.
  test('toggling blind mode also refreshes the header chips, not just seats/matrix/verdict/cost', async () => {
    await global.window.AmicusApp.openRun('aaaa1111'); // bench ['gemini', 'gpt']; status complete -> default blind OFF
    const chips = global.document.getElementById('run-chips');
    expect(chips.textContent).toContain('gemini');
    const toggle = global.document.getElementById('blind-toggle');
    toggle._listeners.change[0]({ target: { checked: true } });
    expect(chips.textContent).toContain('Review A');
    expect(chips.textContent).not.toContain('gemini');
    toggle._listeners.change[0]({ target: { checked: false } });
    expect(chips.textContent).toContain('gemini');
  });

  // ⚠️ Fix-wave item 1: renderDetail()'s early return for an unreadable run (`!d || d.error ||
  // !d.derived`) leaves `state.detail.derived` undefined, but the blind-toggle 'change'
  // listener always calls renderDetail_preserveBlind(), which — unlike renderDetail() itself —
  // used to unconditionally dereference `state.detail.derived.cost` via P.renderSeatsPanel()
  // and again at its own last line. Reachable from a typo on `amicus watch <badId> --ui`.
  test('toggling blind on an unreadable run does not throw (renderDetail_preserveBlind guard)', async () => {
    invokeMock.mockImplementation((channel, ...args) => {
      if (channel === 'workspace:list-runs') { return Promise.resolve([]); }
      if (channel === 'workspace:get-run') { return Promise.resolve({ runId: args[0], error: 'invalid runId' }); }
      return Promise.resolve(null);
    });
    await global.window.AmicusApp.openRun('badid');
    expect(global.document.getElementById('banner').textContent).toContain('Run unreadable');
    const toggle = global.document.getElementById('blind-toggle');
    expect(() => { toggle._listeners.change[0]({ target: { checked: true } }); }).not.toThrow();
    expect(() => { toggle._listeners.change[0]({ target: { checked: false } }); }).not.toThrow();
  });

  // ⚠️ Fix-wave item 1 (second half): the same early-return branch never reset `abort-btn.hidden`
  // — opening an unreadable run right after a LIVE (non-terminal) one left an enabled Abort
  // button pointed at a run whose detail can't back an abort action.
  test('opening an unreadable run after a live one hides the abort button', async () => {
    const liveDetail = buildFixtureDetail('live1');
    liveDetail.run.status = 'running';
    invokeMock.mockImplementation((channel, ...args) => {
      if (channel === 'workspace:list-runs') { return Promise.resolve([]); }
      if (channel === 'workspace:get-run') {
        if (args[0] === 'live1') { return Promise.resolve(liveDetail); }
        return Promise.resolve({ runId: args[0], error: 'invalid runId' });
      }
      return Promise.resolve({ text: 'prose' });
    });
    await global.window.AmicusApp.openRun('live1');
    expect(global.document.getElementById('abort-btn').hidden).toBe(false);
    // live1 is non-terminal, so openRun -> renderDetail started the real live poll loop
    // (workspace-verbs.js startLiveLoop). Stop it before moving on — this test only cares
    // about the abort-btn reset, not live polling, and an unstopped real setTimeout can
    // otherwise fire after this test (and its fake DOM globals) have been torn down.
    global.window.AmicusVerbs.stopLiveLoop();
    await global.window.AmicusApp.openRun('badid');
    expect(global.document.getElementById('abort-btn').hidden).toBe(true);
  });

  // ⚠️ Task 18 (RN-1): a colliding sanitized name is a real run-integrity defect (the run
  // directory physically holds ONE file for two models) that no renderer can undo — but a
  // renderer showing model A's prose under model B's name is a separate, fixable defect.
  // run-detail.js's `derived.artifactsByModel` (built in artifact-guard.js's
  // artifactAllowlist) gives the SECOND (sorted) colliding model a `~2`-suffixed name that
  // deliberately does not exist on disk, so its manifest entry is absent and its panel/drill
  // renders the honest empty state instead of cross-matching the first model's real file.
  // ⚠️ Task 18 fix-wave (RN-1, review finding 1): `debated` (default falsy) extends this same
  // fixture with the debate/re-vote shape instead of forking a sibling builder — the non-debate
  // shape (run.debate: null, no revote-* artifacts) is byte-identical to what Task 18 shipped,
  // so the two pre-existing tests below (which call this with no argument) keep exercising
  // exactly what they always did. `artifactsByModel` is always the FULL {review,judge,rebuttal,
  // revote} shape regardless of `debated` — that mirrors real getRunDetail output, where the map
  // itself is unconditional and only the underlying files' existence (tracked in `artifacts`)
  // depends on whether the run actually debated.
  function buildCollisionFixtureDetail(debated) {
    const bench = ['vendor/a', 'vendor?a'];
    const labelMap = { 'Review A': 'vendor/a', 'Review B': 'vendor?a' };
    // Only 'vendor/a' (the first, sorted) has real files — the collision means the run
    // directory never held a second set for 'vendor?a' under a distinct name. The ~2 names
    // are the disambiguated names Task 18 assigns; they are absent here on purpose.
    const artifacts = {
      'chair-output.md': { present: false, bytes: 0 },
      'report.html': { present: true, bytes: 512 },
      'review-vendor-a.md': { present: true, bytes: 100 },
      'judge-vendor-a.md': { present: true, bytes: 100 },
      'review-vendor-a~2.md': { present: false, bytes: 0 },
      'judge-vendor-a~2.md': { present: false, bytes: 0 },
    };
    if (debated) {
      // Same rationale as the review-/judge- pair above: only the first (sorted) colliding
      // model's re-vote was ever actually written under a distinct name; the ~2 name is
      // disambiguated but absent on purpose.
      artifacts['revote-vendor-a.md'] = { present: true, bytes: 80 };
      artifacts['revote-vendor-a~2.md'] = { present: false, bytes: 0 };
    }
    return {
      runId: 'cccc3333',
      runDir: '/fake/run/cccc3333',
      run: {
        status: 'complete', schemaVersion: 2, bench, chair: bench[bench.length - 1],
        stages: [{ name: 'stage1', status: 'complete', startedAt: 't0', completedAt: 't1' }],
        labelMap, usage: { cost: { amount: 0.43 } }, options: { maxCost: 2 }, error: null,
        debate: debated ? { outcome: 'ran' } : null,
      },
      tally: {}, verdict: {},
      artifacts,
      derived: {
        schemaSupported: true,
        names: Object.entries(labelMap).map(([label, model]) => ({ label, model })),
        stageRail: [{ name: 'stage1', label: 'Stage 1 — independent review', status: 'complete', startedAt: 't0', completedAt: 't1' }],
        matrix: {
          judges: bench.map((m) => ({ model: m, label: null })),
          rows: [{
            id: 'A1', severity: 'high', tier: 'Confirmed', thin: false, tierOverride: null, debate: null,
            raiser: { model: bench[0], label: null }, basis: { a: 1, d: 0, n: 0 },
            cells: bench.map((m, i) => ({
              judge: { model: m, label: null }, verdict: i === bench.length - 1 ? 'dispute' : 'agree',
              sym: i === bench.length - 1 ? '✗' : '✓', isRaiser: i === 0,
            })),
          }],
          tierCounts: { Confirmed: 1 }, judged: true,
        },
        cost: {
          rows: bench.map((m) => ({ model: m, role: 'seat', status: 'complete', durationMs: 1000, costDisplay: '$0.20' })),
          totalDisplay: '$0.43', costAmount: 0.43, maxCost: 2,
        },
        verdictPanel: { present: true, overallVerdict: 'Fix these first', tierCounts: { Confirmed: 1 }, streetCred: [], decisions: [], reason: null },
        artifactCollisions: [{ sanitized: 'vendor-a', models: ['vendor/a', 'vendor?a'] }],
        artifactsByModel: {
          'vendor/a': {
            review: 'review-vendor-a.md', judge: 'judge-vendor-a.md',
            rebuttal: 'rebuttal-vendor-a.md', revote: 'revote-vendor-a.md',
          },
          'vendor?a': {
            review: 'review-vendor-a~2.md', judge: 'judge-vendor-a~2.md',
            rebuttal: 'rebuttal-vendor-a~2.md', revote: 'revote-vendor-a~2.md',
          },
        },
      },
    };
  }

  function collisionInvoke(channel, ...args) {
    if (channel === 'workspace:list-runs') { return Promise.resolve([]); }
    if (channel === 'workspace:get-run') { return Promise.resolve(buildCollisionFixtureDetail()); }
    if (channel === 'workspace:read-artifact') {
      const name = args[1];
      if (name === 'review-vendor-a.md' || name === 'judge-vendor-a.md') {
        return Promise.resolve({ text: 'Prose about A1 for ' + name + '.' });
      }
      // The ~2 names are absent per the manifest above; wireLazyPanels' presence filter must
      // keep this task from ever being reached in a correct implementation (asserted below).
      return Promise.resolve({ error: 'not written yet: ' + name });
    }
    return Promise.resolve(null);
  }

  describe('collided artifact names (RN-1): drillIntoJudge never cross-matches a suffixed name', () => {
    test("the second (colliding) model's drill targets the ~2 name, finds no section, and does NOT highlight the first model's real section", async () => {
      const invokeMock2 = jest.fn(collisionInvoke);
      global.window.amicusWorkspace.invoke = invokeMock2;
      await global.window.AmicusApp.openRun('cccc3333');

      await global.window.AmicusPanels.drillIntoJudge({ model: 'vendor?a', label: null }, 'A1');

      // No misattribution: the ~2 artifact was never requested (presence-filtered out of the
      // judges-panel file list), so no section exists for it and drillIntoJudge early-returns.
      const collidedCalls = invokeMock2.mock.calls.filter((c) => c[0] === 'workspace:read-artifact' && c[2] === 'judge-vendor-a~2.md');
      expect(collidedCalls).toHaveLength(0);
      const judgesBody = global.document.getElementById('judges-body');
      expect(judgesBody.querySelector('[data-artifact="judge-vendor-a~2.md"]')).toBeNull();
      // The critical assertion: the FIRST model's real section must stay untouched — a legacy
      // sanitizeName(model) computation (ignoring the collision) would have resolved BOTH
      // models to 'judge-vendor-a.md' and incorrectly highlighted this section instead.
      const realSection = judgesBody.querySelector('[data-artifact="judge-vendor-a.md"]');
      expect(realSection).toBeTruthy();
      expect(realSection.querySelectorAll('mark')).toHaveLength(0);
      expect(realSection.dataset.drilledFinding).toBeUndefined();
    });

    test("the first model's drill still resolves and highlights its own section normally", async () => {
      const invokeMock2 = jest.fn(collisionInvoke);
      global.window.amicusWorkspace.invoke = invokeMock2;
      await global.window.AmicusApp.openRun('cccc3333');

      await global.window.AmicusPanels.drillIntoJudge({ model: 'vendor/a', label: null }, 'A1');

      const judgesBody = global.document.getElementById('judges-body');
      const section = judgesBody.querySelector('[data-artifact="judge-vendor-a.md"]');
      expect(section).toBeTruthy();
      expect(section.querySelectorAll('mark')).toHaveLength(1);
      expect(section.querySelector('mark').textContent).toBe('A1');
    });
  });

  function collisionRevoteInvoke(channel, ...args) {
    if (channel === 'workspace:list-runs') { return Promise.resolve([]); }
    if (channel === 'workspace:get-run') { return Promise.resolve(buildCollisionFixtureDetail(true)); }
    if (channel === 'workspace:read-artifact') {
      const name = args[1];
      if (name === 'debate.json') {
        return Promise.resolve({
          text: JSON.stringify({
            revotes: [
              { judge: 'vendor/a', id: 'A1', reason: 'First model reconsidered.' },
              { judge: 'vendor?a', id: 'A1', reason: 'Second model reconsidered.' },
            ],
          }),
        });
      }
      if (name === 'review-vendor-a.md' || name === 'judge-vendor-a.md' || name === 'revote-vendor-a.md') {
        return Promise.resolve({ text: 'Prose about A1 for ' + name + '.' });
      }
      // The ~2 names are absent per the manifest above; wireLazyPanels' presence filter must
      // keep a correct implementation from ever reaching this branch (asserted below).
      return Promise.resolve({ error: 'not written yet: ' + name });
    }
    return Promise.resolve(null);
  }

  // ⚠️ Task 18 fix-wave (RN-1, review finding 1): the collision tests above cover the
  // review-/judge- lookups (already routed through resolveArtifactName by Task 18 itself) — the
  // revote- lookups (judges-panel's debate branch + drillIntoJudge's revote branch) were left on
  // the legacy bare sanitizeName(model) computation, so a --debate run with a colliding bench
  // reintroduces, for re-votes, the exact cross-match bug Task 18 fixed for reviews/judges.
  describe('collided artifact names on a --debate run (RN-1 fix-wave): revote drills never cross-match either', () => {
    test("the second (colliding) model's revote drill targets the ~2 name, finds no section, and does NOT highlight the first model's real revote section", async () => {
      const invokeMock2 = jest.fn(collisionRevoteInvoke);
      global.window.amicusWorkspace.invoke = invokeMock2;
      await global.window.AmicusApp.openRun('cccc3333');
      await Promise.resolve();
      await Promise.resolve(); // let the fire-and-forget debate.json fetch land before the drill-in

      await global.window.AmicusPanels.drillIntoJudge({ model: 'vendor?a', label: null }, 'A1');

      // No misattribution: the ~2 revote artifact was never requested (presence-filtered out of
      // the judges-panel file list), so no section exists for it and drillIntoJudge early-returns.
      const collidedCalls = invokeMock2.mock.calls.filter((c) => c[0] === 'workspace:read-artifact' && c[2] === 'revote-vendor-a~2.md');
      expect(collidedCalls).toHaveLength(0);
      const judgesBody = global.document.getElementById('judges-body');
      expect(judgesBody.querySelector('[data-artifact="revote-vendor-a~2.md"]')).toBeNull();
      // The critical assertion: the FIRST model's real revote section must stay untouched — the
      // legacy sanitizeName(model) computation (ignoring the collision) resolves BOTH models to
      // 'revote-vendor-a.md', so the buggy code finds and highlights this section instead.
      const realSection = judgesBody.querySelector('[data-artifact="revote-vendor-a.md"]');
      expect(realSection).toBeTruthy();
      expect(realSection.querySelectorAll('mark')).toHaveLength(0);
      expect(realSection.dataset.drilledFinding).toBeUndefined();
    });

    test("the first model's revote drill still resolves and highlights its own section normally", async () => {
      const invokeMock2 = jest.fn(collisionRevoteInvoke);
      global.window.amicusWorkspace.invoke = invokeMock2;
      await global.window.AmicusApp.openRun('cccc3333');
      await Promise.resolve();
      await Promise.resolve();

      await global.window.AmicusPanels.drillIntoJudge({ model: 'vendor/a', label: null }, 'A1');

      const judgesBody = global.document.getElementById('judges-body');
      const section = judgesBody.querySelector('[data-artifact="revote-vendor-a.md"]');
      expect(section).toBeTruthy();
      expect(section.querySelectorAll('mark')).toHaveLength(1);
      expect(section.querySelector('mark').textContent).toBe('A1');
    });
  });
});

/**
 * v4.6.2 PR4 Task 2 fix wave (task review): the seats-panel dead-row feature
 * (electron/workspace-ui/workspace-seats.js, electron/workspace-ui/live-model.js)
 * had no test reaching its actual production entry point — every
 * dead-seat-rows.test.js case called window.AmicusLive.deadSeats /
 * window.AmicusSeats.renderDeadSeatRows directly, and this file's own
 * pre-fix-wave fixture carried no `degrades` and an empty `verdict: {}`, so
 * renderSeatsPanel()'s field-access chain (state.detail.run.degrades,
 * state.detail.verdict.seatLoss, the argument order into deadSeats()) was
 * never actually exercised end to end. A typo there (`d.run.degrade`, a
 * swapped argument, `d.verdict.seatloss`) would have shipped a feature that
 * never renders while every existing test — including this file's own —
 * stayed green.
 *
 * Also pins the controller ruling from the same review: renderSeatsPanel
 * must append dead rows ONLY on a terminal run. Diagnosis: renderDetail()
 * unconditionally calls V.startLiveLoop() at its own end (workspace-app.js
 * :151); on a still-running run that schedules a tick via
 * `setTimeout(tick, 0)` (workspace-verbs.js:111) whose FIRST resolution
 * repaints #seats-body via a direct `R.renderSeats(...)` call
 * (workspace-verbs.js:129-131) — bypassing renderSeatsPanel() and its dead
 * rows entirely. renderSeats' own leaver-removal (workspace-render.js
 * :220-222) then deletes any `dead:`-keyed row the just-prior renderSeatsPanel
 * call had appended, since that row's key is not among the live seats the
 * tick just painted. Net effect pre-fix: dead rows flash in at open and
 * vanish one tick later on any run still in progress — a glitch, not a
 * feature. The fix gates on the SAME predicate startLiveLoop() itself already
 * uses to decide whether a run is even worth polling
 * (window.AmicusLive.TERMINAL_STATUSES.indexOf(status) !== -1,
 * workspace-verbs.js:69) — reused verbatim, not a second parallel check.
 *
 * Reuses buildFixtureDetail()/defaultInvoke()/loadOrderedScripts()/
 * makeFakeDom() defined above (this file's own proven-safe full-boot
 * fixture) rather than inventing a second boot harness in
 * dead-seat-rows.test.js.
 */
describe('renderSeatsPanel (fix wave): the real read path, reached via the production openRun()', () => {
  // Deliberately NOT 'gemini'/'gpt' (buildFixtureDetail('aaaa1111')'s own bench) — the point of
  // D6 is that a dead seat has ZERO usable legs, i.e. it must be absent from the live cost rows.
  const DEAD_MODEL = 'foxtrot';
  const degradesNamingFoxtrot = [{
    kind: 'degrade', channel: 'dead-leg', what: 'seat foxtrot did not review',
    why: "the leg ended 'error' with no usable output", effect: '2 of 3 seats reviewed',
    data: { seat: DEAD_MODEL, status: 'error', reason: 'timed out' },
  }];

  /** buildFixtureDetail()'s own proven-good shape, with only status/degrades/seatLoss swapped. */
  function deadSeatFixture(runId, status, degrades, seatLoss) {
    const base = buildFixtureDetail(runId);
    return {
      ...base,
      run: { ...base.run, status, degrades },
      verdict: seatLoss ? { seatLoss } : base.verdict,
    };
  }

  function invokeReturning(fixture) {
    return jest.fn((channel, ...args) => (
      channel === 'workspace:get-run' ? Promise.resolve(fixture) : defaultInvoke(channel, ...args)
    ));
  }

  beforeEach(() => {
    // Matches live-loop.test.js's convention: renderDetail() unconditionally calls
    // V.startLiveLoop() (workspace-app.js:151), which — for the non-terminal fixture below —
    // really does schedule a setTimeout(tick, 0). Fake timers keep that tick from ever firing
    // during these tests (none of them advance timers), and jest.clearAllTimers() in afterEach
    // discards it instead of leaking a real pending timer across tests.
    jest.useFakeTimers();
    const fake = makeFakeDom();
    global.window = fake.window;
    global.document = fake.document;
    global.NodeFilter = fake.NodeFilter;
    // Must be set BEFORE loadOrderedScripts(): workspace-app.js's own boot (its IIFE's last
    // lines) fires an immediate refreshList() -> invoke('workspace:list-runs') synchronously as
    // it loads — same ordering the top describe block's beforeEach uses. Each test below swaps
    // in its own fixture-specific mock afterward, before calling openRun().
    global.window.amicusWorkspace.invoke = jest.fn(defaultInvoke);
    loadOrderedScripts();
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

  test('a terminal run doc carrying degrades[] renders exactly one .seat-dead row in #seats-body after the real openRun()', async () => {
    const fixture = deadSeatFixture('aaaa1111', 'complete', degradesNamingFoxtrot, null);
    global.window.amicusWorkspace.invoke = invokeReturning(fixture);

    await global.window.AmicusApp.openRun('aaaa1111');

    const deadRows = global.document.getElementById('seats-body').children.filter((r) => r.classList.contains('seat-dead'));
    expect(deadRows).toHaveLength(1);
    expect(deadRows[0].children[0].textContent).toBe(DEAD_MODEL);
    expect(deadRows[0].children[2].textContent).toBe('did not review');
  });

  test('a terminal run doc whose verdict.seatLoss (not degrades[]) names the dead critic still renders the row', async () => {
    const seatLoss = { criticRequested: DEAD_MODEL, criticSeated: false, reason: 'timed out', deadBenchSeats: [] };
    const fixture = deadSeatFixture('aaaa1111', 'complete', [], seatLoss);
    global.window.amicusWorkspace.invoke = invokeReturning(fixture);

    await global.window.AmicusApp.openRun('aaaa1111');

    const deadRows = global.document.getElementById('seats-body').children.filter((r) => r.classList.contains('seat-dead'));
    expect(deadRows).toHaveLength(1);
    expect(deadRows[0].children[0].textContent).toBe(DEAD_MODEL);
  });

  test('a non-terminal (running) run doc carrying the SAME degrades[] renders NO dead rows (controller ruling: no flash-then-vanish)', async () => {
    const fixture = deadSeatFixture('aaaa1111', 'running', degradesNamingFoxtrot, null);
    global.window.amicusWorkspace.invoke = invokeReturning(fixture);

    await global.window.AmicusApp.openRun('aaaa1111');

    const deadRows = global.document.getElementById('seats-body').children.filter((r) => r.classList.contains('seat-dead'));
    expect(deadRows).toHaveLength(0);
  });

  // Final-review fix wave (finding 4, rider): dead-seat-rows.test.js's case (c) proves mask
  // parity at the paint() level (deadSeats/renderDeadSeatRows called directly with blindOn
  // flipped) and its "(supplementary)" case proves repaint idempotency (the same painters called
  // twice, no duplicate rows) — but neither drives the REAL #blind-toggle 'change' listener
  // (workspace-app.js:197-200) end to end, so a regression anywhere on
  // renderDetail_preserveBlind()'s path to renderSeatsPanel() specifically could still slip
  // through with every existing test green. This closes that last inference gap: open a terminal
  // run through the real openRun(), confirm the dead row, flip blind through the actual DOM
  // listener (not a direct paint call), and confirm the row survives the repaint with the masked
  // label.
  test('flipping blind mode through the real #blind-toggle listener repaints the dead row masked, still exactly one row', async () => {
    const DEAD_LABEL = 'Review C';
    const fixture = deadSeatFixture('aaaa1111', 'complete', degradesNamingFoxtrot, null);
    // buildFixtureDetail()'s labelMap/derived.names only cover the live bench (gemini, gpt) — add
    // a label for the dead critic too, or blind masking would have nothing to swap to and this
    // test could pass even if masking were broken.
    fixture.derived = { ...fixture.derived, names: [...fixture.derived.names, { label: DEAD_LABEL, model: DEAD_MODEL }] };
    global.window.amicusWorkspace.invoke = invokeReturning(fixture);

    await global.window.AmicusApp.openRun('aaaa1111');

    const deadRowsBefore = global.document.getElementById('seats-body').children.filter((r) => r.classList.contains('seat-dead'));
    expect(deadRowsBefore).toHaveLength(1);
    expect(deadRowsBefore[0].children[0].textContent).toBe(DEAD_MODEL);

    // The real toggle path: the 'change' listener workspace-app.js registers on #blind-toggle at
    // boot (workspace-app.js:197-200) -> renderDetail_preserveBlind() -> renderDetail() ->
    // P.renderSeatsPanel() -> workspace-seats.js's renderSeatsPanel(). NOT a direct
    // renderDeadSeatRows()/renderSeatsPanel() call — see helpers/fake-workspace-page's
    // addEventListener for how `_listeners` records this.
    const toggle = global.document.getElementById('blind-toggle');
    toggle._listeners.change[0]({ target: { checked: true } });

    const deadRowsAfter = global.document.getElementById('seats-body').children.filter((r) => r.classList.contains('seat-dead'));
    expect(deadRowsAfter).toHaveLength(1);
    expect(deadRowsAfter[0].children[0].textContent).toBe(DEAD_LABEL);
    expect(deadRowsAfter[0].children[0].textContent).not.toBe(DEAD_MODEL);
  });

  // Fix wave 2 (smoke-caught): the live GUI smoke on a real degraded run (12c96b6b) found that
  // blind mode leaves the dead seat's RAW model name visible. The test above added a label for
  // the dead model into derived.names specifically so masking would have something to show — but
  // that is exactly why it missed the gap: a REAL run's derived.names only carries models that
  // produced a review, and a dead seat by definition never did, so state.labelByModel never has
  // it. This is the real-world variant: buildFixtureDetail()'s STOCK shape, no names entry for
  // the dead model added.
  test('flipping blind mode with NO label for the dead seat (the real-run shape) renders "(masked)", not the raw model', async () => {
    const fixture = deadSeatFixture('aaaa1111', 'complete', degradesNamingFoxtrot, null);
    // Deliberately NOT extending derived.names here — buildFixtureDetail()'s stock names only
    // cover the live bench (gemini, gpt), matching what run 12c96b6b actually carried.
    global.window.amicusWorkspace.invoke = invokeReturning(fixture);

    await global.window.AmicusApp.openRun('aaaa1111');

    const deadRowsBefore = global.document.getElementById('seats-body').children.filter((r) => r.classList.contains('seat-dead'));
    expect(deadRowsBefore).toHaveLength(1);
    expect(deadRowsBefore[0].children[0].textContent).toBe(DEAD_MODEL); // blind OFF: raw alias is correct

    const toggle = global.document.getElementById('blind-toggle');
    toggle._listeners.change[0]({ target: { checked: true } });

    const deadRowsAfter = global.document.getElementById('seats-body').children.filter((r) => r.classList.contains('seat-dead'));
    expect(deadRowsAfter).toHaveLength(1);
    expect(deadRowsAfter[0].children[0].textContent).toBe('(masked)');
    expect(deadRowsAfter[0].children[0].textContent).not.toBe(DEAD_MODEL);
  });
});
