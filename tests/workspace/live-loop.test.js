'use strict';

const { makeFakeDom } = require('./helpers/fake-workspace-page');
const { SCRIPT_LOAD_ORDER } = require('./helpers/script-load-order');

const UI = '../../electron/workspace-ui/';
const LOAD_ORDER = SCRIPT_LOAD_ORDER;

/**
 * Task 15: renderer live poll loop (startLiveLoop/stopLiveLoop/applyLive, all in
 * workspace-verbs.js per the F05 split). Exercises the loop end-to-end against the same
 * headless fake DOM the F05 boundary test uses, with jest.useFakeTimers() driving cadence
 * and terminal-stop assertions per spec §4.3.
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

function liveDoc(overrides) {
  return Object.assign({
    ok: true, view: 'live', runId: 'cccc3333', status: 'running', stageName: 'stage1',
    stages: null, seats: [], legsTotal: null, legsComplete: null,
    costDisplay: null, costAmount: null,
    flags: { crashed: false, stalled: false, stalledForSeconds: null },
    terminal: false,
  }, overrides);
}

describe('renderer live loop (Task 15: startLiveLoop/stopLiveLoop/applyLive)', () => {
  let invokeMock;
  let getLiveImpl;

  function defaultInvoke(channel, ...args) {
    if (channel === 'workspace:list-runs') { return Promise.resolve([]); }
    if (channel === 'workspace:get-run') { return Promise.resolve(buildFixtureDetail(args[0])); }
    if (channel === 'workspace:get-live') { return getLiveImpl(args[0]); }
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
    getLiveImpl = () => Promise.resolve(liveDoc());
    invokeMock = jest.fn(defaultInvoke);
    global.window.amicusWorkspace.invoke = invokeMock;
    loadOrderedScripts();
    // The app boot sequence unconditionally starts a 5s run-list refresh setInterval
    // (workspace-app.js's startListLoop()) — irrelevant to this file's live-loop timer-count
    // assertions but otherwise a permanent +1 confound under jest fake timers. Clear it.
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

  // ---- cadence ------------------------------------------------------------
  test('visible+focused schedules the next tick at 1.5s', async () => {
    await global.window.AmicusApp.openRun('aaaa1111');
    invokeMock.mockClear();
    jest.advanceTimersByTime(0); // fire the immediate first tick
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(invokeMock).toHaveBeenCalledWith('workspace:get-live', 'aaaa1111');
    expect(jest.getTimerCount()).toBe(1);
    // Only a timer scheduled at exactly 1500ms is pending; advancing by 1499ms must not fire it.
    invokeMock.mockClear();
    jest.advanceTimersByTime(1499);
    await Promise.resolve();
    expect(invokeMock).not.toHaveBeenCalledWith('workspace:get-live', expect.anything());
    jest.advanceTimersByTime(1);
    await Promise.resolve(); await Promise.resolve();
    expect(invokeMock).toHaveBeenCalledWith('workspace:get-live', 'aaaa1111');
  });

  test('blurred (not focused) schedules the next tick at 5s, not 1.5s', async () => {
    global.document.hasFocus = () => false;
    await global.window.AmicusApp.openRun('aaaa1111');
    invokeMock.mockClear();
    jest.advanceTimersByTime(0);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    invokeMock.mockClear();
    jest.advanceTimersByTime(1500);
    await Promise.resolve();
    expect(invokeMock).not.toHaveBeenCalledWith('workspace:get-live', expect.anything());
    jest.advanceTimersByTime(3500);
    await Promise.resolve(); await Promise.resolve();
    expect(invokeMock).toHaveBeenCalledWith('workspace:get-live', 'aaaa1111');
  });

  test('hidden (visibilityState !== visible) also schedules at 5s', async () => {
    global.document.visibilityState = 'hidden';
    await global.window.AmicusApp.openRun('aaaa1111');
    invokeMock.mockClear();
    jest.advanceTimersByTime(0);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    invokeMock.mockClear();
    jest.advanceTimersByTime(4999);
    await Promise.resolve();
    expect(invokeMock).not.toHaveBeenCalledWith('workspace:get-live', expect.anything());
    jest.advanceTimersByTime(1);
    await Promise.resolve(); await Promise.resolve();
    expect(invokeMock).toHaveBeenCalledWith('workspace:get-live', 'aaaa1111');
  });

  // ---- terminal stop --------------------------------------------------------
  test('a terminal live status stops polling and triggers exactly one final workspace:get-run', async () => {
    await global.window.AmicusApp.openRun('aaaa1111'); // one get-run call already spent here
    invokeMock.mockClear();
    getLiveImpl = () => Promise.resolve(liveDoc({ status: 'complete', terminal: true }));
    // Simulate run.json having caught up to 'complete' by the time the final refresh reads it —
    // otherwise the refetched (still-'running') snapshot would legitimately restart polling,
    // which is correct behavior but not what this test is pinning.
    invokeMock.mockImplementation((channel, ...args) => {
      if (channel === 'workspace:get-run') { return Promise.resolve(buildFixtureDetail(args[0], 'complete')); }
      return defaultInvoke(channel, ...args);
    });
    jest.advanceTimersByTime(0);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    const getRunCalls = invokeMock.mock.calls.filter((c) => c[0] === 'workspace:get-run');
    expect(getRunCalls.length).toBe(1);
    expect(getRunCalls[0][1]).toBe('aaaa1111');
    const getLiveCalls = invokeMock.mock.calls.filter((c) => c[0] === 'workspace:get-live');
    expect(getLiveCalls.length).toBe(1); // no further polling after terminal
    expect(jest.getTimerCount()).toBe(0); // no orphaned scheduled tick
  });

  test('does not start a loop at all when the run is already terminal on open', async () => {
    invokeMock.mockImplementation((channel, ...args) => {
      if (channel === 'workspace:get-run') { return Promise.resolve(buildFixtureDetail(args[0], 'complete')); }
      return defaultInvoke(channel, ...args);
    });
    await global.window.AmicusApp.openRun('aaaa1111');
    expect(jest.getTimerCount()).toBe(0);
  });

  // ---- no timer stacking ----------------------------------------------------
  test('repeated startLiveLoop() calls never stack timers', async () => {
    await global.window.AmicusApp.openRun('aaaa1111');
    expect(jest.getTimerCount()).toBe(1);
    global.window.AmicusVerbs.startLiveLoop();
    global.window.AmicusVerbs.startLiveLoop();
    global.window.AmicusVerbs.startLiveLoop();
    expect(jest.getTimerCount()).toBe(1);
  });

  test('a blind-toggle re-render (which calls renderDetail -> startLiveLoop again) does not stack timers either', async () => {
    await global.window.AmicusApp.openRun('aaaa1111');
    expect(jest.getTimerCount()).toBe(1);
    global.window.AmicusApp.renderDetail();
    expect(jest.getTimerCount()).toBe(1);
  });

  // ---- stale-chain / epoch guard --------------------------------------------
  test('switching runs mid-flight drops the stale chain\'s result instead of painting it into the new run', async () => {
    let resolveStale;
    const stalePromise = new Promise((resolve) => { resolveStale = resolve; });
    invokeMock.mockImplementation((channel, ...args) => {
      if (channel === 'workspace:get-run') { return Promise.resolve(buildFixtureDetail(args[0])); }
      if (channel === 'workspace:get-live' && args[0] === 'aaaa1111') { return stalePromise; }
      if (channel === 'workspace:get-live') { return Promise.resolve(liveDoc({ runId: args[0] })); }
      return defaultInvoke(channel, ...args);
    });
    await global.window.AmicusApp.openRun('aaaa1111');
    jest.advanceTimersByTime(0); // fires run A's first tick, which hangs on stalePromise
    await Promise.resolve();
    expect(jest.getTimerCount()).toBe(0); // nothing scheduled yet — awaiting the in-flight invoke

    await global.window.AmicusApp.openRun('bbbb2222'); // switches state.runId + bumps liveEpoch
    invokeMock.mockClear();
    jest.advanceTimersByTime(0); // fires run B's first tick
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(invokeMock).toHaveBeenCalledWith('workspace:get-live', 'bbbb2222');
    const timerCountAfterB = jest.getTimerCount();
    expect(timerCountAfterB).toBe(1); // run B's own reschedule only

    // Now resolve run A's long-hanging promise — it must be dropped, not scheduling yet another timer.
    resolveStale(liveDoc({ runId: 'aaaa1111', seats: [{ id: 's1', model: 'stale', modelInput: null, role: null, status: 'running', stage: null, messages: null, tokensIn: null, tokensOut: null, costDisplay: null, lastActivity: null, latestPreview: null, stalled: false }] }));
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(jest.getTimerCount()).toBe(timerCountAfterB); // stale resolution scheduled nothing new
    expect(global.document.getElementById('seats-body').children.length).toBe(0); // stale seat never painted
  });

  test('a rejected get-live invoke does not kill the loop — it reschedules unless superseded', async () => {
    let rejectOnce;
    let calls = 0;
    invokeMock.mockImplementation((channel, ...args) => {
      if (channel === 'workspace:get-run') { return Promise.resolve(buildFixtureDetail(args[0])); }
      if (channel === 'workspace:get-live') {
        calls += 1;
        if (calls === 1) { return new Promise((_resolve, reject) => { rejectOnce = reject; }); }
        return Promise.resolve(liveDoc());
      }
      return defaultInvoke(channel, ...args);
    });
    await global.window.AmicusApp.openRun('aaaa1111');
    jest.advanceTimersByTime(0);
    await Promise.resolve();
    rejectOnce(new Error('IPC channel closed'));
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(jest.getTimerCount()).toBe(1); // rescheduled despite the rejection
  });

  // ---- applyLive: seats/gauge/stage-rail/banner -----------------------------
  test('applyLive paints a seat with entirely absent live fields as em-dashes', async () => {
    await global.window.AmicusApp.openRun('aaaa1111');
    global.window.AmicusApp.state.blind = false; // isolate the em-dash behavior from blind-mode's own flip
    global.window.AmicusVerbs.applyLive(liveDoc({
      seats: [{ id: 's1', model: 'gpt', modelInput: null, role: null, status: 'unknown', stage: null,
        messages: null, tokensIn: null, tokensOut: null, costDisplay: null, lastActivity: null,
        latestPreview: null, stalled: false }],
    }));
    const row = global.document.getElementById('seats-body').children[0];
    const cellText = row.children.map((td) => td.textContent);
    expect(cellText).toEqual(['gpt', '—', 'unknown', '—', '—', '—', '—', '—', '']);
  });

  test('applyLive tops up the gauge from live cost, labelled "(this stage)", never the durable total', async () => {
    await global.window.AmicusApp.openRun('aaaa1111');
    global.window.AmicusVerbs.applyLive(liveDoc({ costAmount: 0.07, costDisplay: '~$0.0700' }));
    expect(global.document.getElementById('cost-gauge-text').textContent).toBe('~$0.0700 (this stage) / $2.00');
  });

  test('applyLive does not touch the gauge when costAmount is null (A2 degradation, not "?"/"—" overwrite)', async () => {
    await global.window.AmicusApp.openRun('aaaa1111');
    const before = global.document.getElementById('cost-gauge-text').textContent;
    global.window.AmicusVerbs.applyLive(liveDoc({ costAmount: null, costDisplay: '?' }));
    expect(global.document.getElementById('cost-gauge-text').textContent).toBe(before);
  });

  test('applyLive merges live stages onto the run-open snapshot: known stage keeps its startedAt, a post-open stage gets none yet', async () => {
    await global.window.AmicusApp.openRun('aaaa1111');
    global.window.AmicusVerbs.applyLive(liveDoc({
      stages: [{ name: 'stage1', status: 'complete' }, { name: 'tally-final', status: 'running' }],
    }));
    const rail = global.document.getElementById('stage-rail');
    const spans = rail.children;
    expect(spans.length).toBe(2);
    expect(spans[0].attributes.title).toBe('t0'); // startedAt merged from derived.stageRail
    expect(spans[0].attributes['aria-label']).toBe('Stage 1 — independent review: complete');
    expect(spans[1].attributes['aria-label']).toBe('Tally (final): running'); // STAGE_LABELS mirror
    expect(spans[1].attributes.title).toBe(''); // no prior snapshot entry — no invented timestamp
  });

  // ---- banner: crashed / stalled / unavailable ------------------------------
  test('flags.crashed renders honest copy with no "no leg activity"/abort claim (a clean zero-leg validation failure is also status:error)', async () => {
    await global.window.AmicusApp.openRun('aaaa1111');
    global.window.AmicusVerbs.applyLive(liveDoc({ status: 'error', terminal: true, flags: { crashed: true, stalled: false, stalledForSeconds: null } }));
    const banner = global.document.getElementById('banner');
    expect(banner.hidden).toBe(false);
    expect(banner.textContent).not.toMatch(/no leg activity/i);
    expect(banner.textContent).not.toMatch(/abort/i);
  });

  test('flags.stalled (not crashed) renders the "may be dead, abort" copy and reveals the abort button', async () => {
    await global.window.AmicusApp.openRun('aaaa1111');
    global.window.AmicusVerbs.applyLive(liveDoc({ flags: { crashed: false, stalled: true, stalledForSeconds: 125 } }));
    const banner = global.document.getElementById('banner');
    expect(banner.hidden).toBe(false);
    expect(banner.textContent).toContain('No leg activity for 2m');
    expect(banner.textContent).toMatch(/abort/i);
    expect(global.document.getElementById('abort-btn').hidden).toBe(false);
  });

  test('live.ok === false renders an info banner naming the error, without touching seats/gauge', async () => {
    await global.window.AmicusApp.openRun('aaaa1111');
    global.window.AmicusVerbs.applyLive({ ok: false, error: 'boom' });
    const banner = global.document.getElementById('banner');
    expect(banner.hidden).toBe(false);
    expect(banner.textContent).toBe('live data unavailable — boom');
  });

  test('the info banner clears once live data resumes with no crashed/stalled flags', async () => {
    await global.window.AmicusApp.openRun('aaaa1111');
    global.window.AmicusVerbs.applyLive({ ok: false, error: 'boom' });
    expect(global.document.getElementById('banner').hidden).toBe(false);
    global.window.AmicusVerbs.applyLive(liveDoc());
    expect(global.document.getElementById('banner').hidden).toBe(true);
  });

  // ---- renderDetail wiring: abort-btn + startLiveLoop -----------------------
  test('renderDetail hides the abort button for a terminal run and never starts a loop', async () => {
    invokeMock.mockImplementation((channel, ...args) => {
      if (channel === 'workspace:get-run') { return Promise.resolve(buildFixtureDetail(args[0], 'complete')); }
      return defaultInvoke(channel, ...args);
    });
    await global.window.AmicusApp.openRun('aaaa1111');
    expect(global.document.getElementById('abort-btn').hidden).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });

  test('renderDetail shows the abort button for a non-terminal (running) run', async () => {
    await global.window.AmicusApp.openRun('aaaa1111');
    expect(global.document.getElementById('abort-btn').hidden).toBe(false);
  });
});
