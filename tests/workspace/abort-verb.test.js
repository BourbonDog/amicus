'use strict';

const { makeFakeDom } = require('./helpers/fake-workspace-page');
const { SCRIPT_LOAD_ORDER } = require('./helpers/script-load-order');

const UI = '../../electron/workspace-ui/';
const LOAD_ORDER = SCRIPT_LOAD_ORDER;

/**
 * Task 16: confirm-gated Abort verb (openAbortDialog, workspace-verbs.js per the F05
 * split). Per the task-16 brief's own DE-ROT note, this task's only *documented* gate is
 * script-order/no-innerHTML — that is false confidence on the product's only destructive
 * verb, so this file proves the actual behaviour end to end against the same headless
 * fake DOM the other workspace-ui tests use: cancel truly never invokes the channel,
 * confirm invokes it exactly once with the open run's id, the dialog is hidden after
 * both paths, a second rapid confirm does not double-fire, and (closing the brief's
 * named gap) the Escape-dismiss path is dispatched and proven, not left unproven.
 */
function loadOrderedScripts() {
  jest.resetModules();
  LOAD_ORDER.forEach((f) => {
    require(UI + f); // eslint-disable-line global-require
  });
}

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
    artifacts: { 'chair-output.md': { present: false, bytes: 0 }, 'report.html': { present: false, bytes: 0 } },
    derived: {
      schemaSupported: true,
      names: Object.entries(labelMap).map(([label, model]) => ({ label, model })),
      stageRail: [{ name: 'stage1', label: 'Stage 1 — independent review', status: 'running', startedAt: 't0', completedAt: null }],
      matrix: { judges: [], rows: [], tierCounts: {}, judged: false },
      cost: { rows: [], totalDisplay: '—', costAmount: null, maxCost: 2 },
      verdictPanel: { present: false, overallVerdict: null, tierCounts: null, streetCred: [], decisions: [], reason: null },
    },
  };
}

describe('Abort verb (Task 16: confirm dialog -> workspace:abort-run)', () => {
  let invokeMock;
  let consoleErrorSpy;

  function defaultInvoke(channel, ...args) {
    if (channel === 'workspace:list-runs') { return Promise.resolve([]); }
    if (channel === 'workspace:get-run') { return Promise.resolve(buildFixtureDetail(args[0])); }
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
    // Same confound as live-loop.test.js: the boot sequence's 5s run-list refresh
    // setInterval is irrelevant to these timer-count assertions. Clear it.
    clearInterval(global.window.AmicusApp.state.listTimer);
    global.window.AmicusApp.state.listTimer = null;
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    if (global.window.AmicusApp && global.window.AmicusApp.state.listTimer) {
      clearInterval(global.window.AmicusApp.state.listTimer);
    }
    jest.clearAllTimers();
    jest.useRealTimers();
    consoleErrorSpy.mockRestore();
    delete global.window;
    delete global.document;
    delete global.NodeFilter;
  });

  function abortBtn() { return global.document.getElementById('abort-btn'); }
  function dialog() { return global.document.getElementById('dialog-abort'); }
  function cancelBtn() { return global.document.getElementById('dialog-abort-cancel'); }
  function confirmBtn() { return global.document.getElementById('dialog-abort-confirm'); }
  function clickAbort() { abortBtn()._listeners.click[0](); }
  function clickCancel() { cancelBtn()._listeners.click[0](); }
  function clickConfirm() { confirmBtn()._listeners.click[0](); }

  test('clicking Abort opens the dialog and focuses Cancel (so Esc/Enter both behave)', async () => {
    await global.window.AmicusApp.openRun('aaaa1111');
    // index.html ships `dialog-abort` with the `hidden` attribute; the fake page's mount()
    // doesn't replicate per-id initial attributes, so pin the pre-interaction baseline
    // explicitly rather than assume it.
    dialog().hidden = true;
    clickAbort();
    expect(dialog().hidden).toBe(false);
    expect(cancelBtn()._focused).toBe(true);
  });

  test('clicking Cancel hides the dialog and does NOT invoke workspace:abort-run', async () => {
    await global.window.AmicusApp.openRun('aaaa1111');
    clickAbort();
    invokeMock.mockClear();
    clickCancel();
    expect(dialog().hidden).toBe(true);
    const abortCalls = invokeMock.mock.calls.filter((c) => c[0] === 'workspace:abort-run');
    expect(abortCalls.length).toBe(0);
  });

  test('confirming invokes workspace:abort-run exactly once with the open run id, hides the dialog, stops the live loop, and re-reads the run', async () => {
    let getRunCallCount = 0;
    invokeMock.mockImplementation((channel, ...args) => {
      if (channel === 'workspace:get-run') {
        getRunCallCount += 1;
        // Realistic sequence: the initial open sees 'running'; the abort re-read sees the
        // now-terminal 'aborted' status, per the spec comment ("no live poll" afterward).
        return Promise.resolve(buildFixtureDetail(args[0], getRunCallCount === 1 ? 'running' : 'aborted'));
      }
      if (channel === 'workspace:abort-run') { return Promise.resolve({ ok: true }); }
      return defaultInvoke(channel, ...args);
    });
    await global.window.AmicusApp.openRun('aaaa1111');
    expect(jest.getTimerCount()).toBe(1); // live loop scheduled its first tick

    clickAbort();
    clickConfirm();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

    const abortCalls = invokeMock.mock.calls.filter((c) => c[0] === 'workspace:abort-run');
    expect(abortCalls.length).toBe(1);
    expect(abortCalls[0][1]).toBe('aaaa1111');
    expect(dialog().hidden).toBe(true);
    expect(getRunCallCount).toBe(2); // the original open + the post-abort re-read
    expect(jest.getTimerCount()).toBe(0); // re-read landed on a terminal status: no poll restarted
    expect(abortBtn().hidden).toBe(true); // renderDetail's terminal-status hide, via the re-read
  });

  test('a failed abort shows an honest banner, hides the dialog, and does NOT stop the loop or re-read the run', async () => {
    invokeMock.mockImplementation((channel, ...args) => {
      if (channel === 'workspace:abort-run') { return Promise.resolve({ ok: false, error: 'engine unreachable' }); }
      return defaultInvoke(channel, ...args);
    });
    await global.window.AmicusApp.openRun('aaaa1111');
    invokeMock.mockClear();
    clickAbort();
    clickConfirm();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

    expect(dialog().hidden).toBe(true); // hidden on BOTH paths
    const banner = global.document.getElementById('banner');
    expect(banner.textContent).toContain('Abort failed: engine unreachable');
    const getRunCalls = invokeMock.mock.calls.filter((c) => c[0] === 'workspace:get-run');
    expect(getRunCalls.length).toBe(0); // no re-read on failure
    expect(jest.getTimerCount()).toBe(1); // the live loop's tick is untouched
  });

  test('a second rapid confirm click does not double-fire workspace:abort-run', async () => {
    let resolveAbort;
    const pending = new Promise((resolve) => { resolveAbort = resolve; });
    invokeMock.mockImplementation((channel, ...args) => {
      if (channel === 'workspace:abort-run') { return pending; }
      return defaultInvoke(channel, ...args);
    });
    await global.window.AmicusApp.openRun('aaaa1111');
    clickAbort();
    clickConfirm();
    clickConfirm(); // rapid second click while the first is still in flight
    await Promise.resolve();

    let abortCalls = invokeMock.mock.calls.filter((c) => c[0] === 'workspace:abort-run');
    expect(abortCalls.length).toBe(1);

    resolveAbort({ ok: true });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    abortCalls = invokeMock.mock.calls.filter((c) => c[0] === 'workspace:abort-run');
    expect(abortCalls.length).toBe(1); // still exactly one, after settling
  });

  test('Escape dismisses the open dialog without invoking workspace:abort-run (Task 13 handler, proven live here)', async () => {
    await global.window.AmicusApp.openRun('aaaa1111');
    clickAbort();
    expect(dialog().hidden).toBe(false);
    invokeMock.mockClear();
    const keydownListeners = global.document._listeners.keydown;
    expect(keydownListeners && keydownListeners.length).toBeGreaterThan(0);
    keydownListeners[0]({ key: 'Escape' });
    expect(dialog().hidden).toBe(true);
    const abortCalls = invokeMock.mock.calls.filter((c) => c[0] === 'workspace:abort-run');
    expect(abortCalls.length).toBe(0);
  });
});
