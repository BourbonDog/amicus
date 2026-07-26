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
    expect(typeof V.doFold).toBe('function');
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
});
