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
  let consoleErrorSpy;

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

  // ---- TST-5: the three cadence listeners ------------------------------------
  // workspace-verbs.js registers `visibilitychange` on document and `blur`/`focus` on
  // window (F42), and until now NOTHING dispatched any of them: the harness's
  // `window.addEventListener` was a bare no-op, so the two window listeners were not
  // even reachable from a test. (Task 16 had extended only `document.addEventListener`
  // to capture; `window` was still the stub. Both now record their callbacks.)
  //
  // What these pin is the F42 contract: each flip RE-ENTERS startLiveLoop, which is only
  // safe because startLiveLoop calls stopLiveLoop first — so the cadence is re-derived
  // from the new visibility/focus state without ever forking a second poll chain. And
  // the `if (A.state.liveTimer)` guard means a flip on a TERMINAL run starts nothing.
  describe('cadence listeners re-enter the loop without forking it', () => {
    const fireDocument = (type) => global.document._listeners[type].forEach((fn) => fn());
    const fireWindow = (type) => global.window._listeners[type].forEach((fn) => fn());

    test('all three are registered on the surface that actually emits them', () => {
      expect(global.document._listeners.visibilitychange).toHaveLength(1);
      expect(global.window._listeners.blur).toHaveLength(1);
      // Two on focus: the cadence re-enter here plus workspace-app.js's run-list refresh.
      expect(global.window._listeners.focus).toHaveLength(2);
    });

    test.each([
      ['visibilitychange', () => fireDocument('visibilitychange')],
      ['blur', () => fireWindow('blur')],
      ['focus', () => fireWindow('focus')],
    ])('%s restarts the live loop in place — one timer, one epoch bump', async (_name, fire) => {
      await global.window.AmicusApp.openRun('aaaa1111');
      expect(jest.getTimerCount()).toBe(1);
      const epochBefore = global.window.AmicusApp.state.liveEpoch;

      fire();

      expect(jest.getTimerCount()).toBe(1); // restarted, never stacked
      expect(global.window.AmicusApp.state.liveEpoch).toBe(epochBefore + 1);
    });

    test.each([
      ['visibilitychange', () => fireDocument('visibilitychange')],
      ['blur', () => fireWindow('blur')],
      ['focus', () => fireWindow('focus')],
    ])('%s starts nothing when no loop is running (terminal run)', async (_name, fire) => {
      invokeMock.mockImplementation((channel, ...args) => {
        if (channel === 'workspace:get-run') { return Promise.resolve(buildFixtureDetail(args[0], 'complete')); }
        return defaultInvoke(channel, ...args);
      });
      await global.window.AmicusApp.openRun('aaaa1111');
      expect(jest.getTimerCount()).toBe(0);
      invokeMock.mockClear();

      fire();

      // The `if (A.state.liveTimer)` guard: a flip must never resurrect a finished run's poll.
      expect(jest.getTimerCount()).toBe(0);
      expect(invokeMock).not.toHaveBeenCalledWith('workspace:get-live', expect.anything());
    });

    test('the restart re-derives the cadence from the NEW state (1.5s focused -> 5s blurred)', async () => {
      await global.window.AmicusApp.openRun('aaaa1111');
      jest.advanceTimersByTime(0); // first tick at the visible+focused cadence
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      expect(jest.getTimerCount()).toBe(1);

      global.document.hasFocus = () => false; // the window really did lose focus…
      fireWindow('blur');                     // …and the listener is what tells the loop
      jest.advanceTimersByTime(0);            // the restarted immediate tick
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

      invokeMock.mockClear();
      jest.advanceTimersByTime(1500); // the OLD cadence — must no longer fire anything
      await Promise.resolve();
      expect(invokeMock).not.toHaveBeenCalledWith('workspace:get-live', expect.anything());
      jest.advanceTimersByTime(3500); // …the blurred 5s cadence does
      await Promise.resolve(); await Promise.resolve();
      expect(invokeMock).toHaveBeenCalledWith('workspace:get-live', 'aaaa1111');
    });

    test('F42: a tick in flight across a flip is DROPPED, not forked into a second chain', async () => {
      let resolveHung;
      let calls = 0;
      invokeMock.mockImplementation((channel, ...args) => {
        if (channel === 'workspace:get-run') { return Promise.resolve(buildFixtureDetail(args[0])); }
        if (channel === 'workspace:get-live') {
          calls += 1;
          if (calls === 1) { return new Promise((resolve) => { resolveHung = resolve; }); }
          return Promise.resolve(liveDoc());
        }
        return defaultInvoke(channel, ...args);
      });
      await global.window.AmicusApp.openRun('aaaa1111');
      jest.advanceTimersByTime(0); // tick 1 fires and hangs on the pending invoke
      await Promise.resolve();
      expect(jest.getTimerCount()).toBe(0); // nothing scheduled while it is in flight

      fireWindow('focus');         // the flip bumps liveEpoch and schedules a fresh chain
      jest.advanceTimersByTime(0);
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      expect(jest.getTimerCount()).toBe(1); // exactly the new chain's reschedule

      resolveHung(liveDoc());      // the pre-flip tick finally answers
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      // Without the epoch bump this would be 2 — the orphaned chain rescheduling itself
      // forever alongside the live one, with no stop able to reach it.
      expect(jest.getTimerCount()).toBe(1);
    });
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
    // ⚠️ Code review round 2, finding 3 (cheap half): a genuinely rejected invoke() must not be
    // silently absorbed — it's now logged, not just quietly retried.
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  test('applyLive throws synchronously on a live payload missing `.flags` — it does not defensively swallow malformed input (code review round 2, finding 3)', async () => {
    await global.window.AmicusApp.openRun('aaaa1111');
    expect(() => global.window.AmicusVerbs.applyLive({ ok: true, terminal: false, seats: [] })).toThrow();
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

  // ⚠️ Code review round 2, finding 1: renderBanner(el, text, '') sets className = 'banner ' —
  // once the stalled branch (kind '') paints, classList.contains('info') is permanently false,
  // so the OLD clear arm could never reach it even after activity resumed on the very next tick.
  // This is the actual regression test for that bug: it fails pre-fix (banner stays visible
  // forever) and passes once the live banners are tagged and cleared via `A.renderBanners()`.
  test('a stalled banner is not permanently pinned — it clears once live data resumes with neither flag set', async () => {
    await global.window.AmicusApp.openRun('aaaa1111');
    global.window.AmicusVerbs.applyLive(liveDoc({ flags: { crashed: false, stalled: true, stalledForSeconds: 60 } }));
    expect(global.document.getElementById('banner').hidden).toBe(false);
    global.window.AmicusVerbs.applyLive(liveDoc()); // activity resumes; both flags now false
    expect(global.document.getElementById('banner').hidden).toBe(true);
  });

  // ⚠️ Code review round 2, finding 1 (second half): the same stuck-forever bug would also
  // permanently destroy a genuine `warn`-kind durable banner (e.g. a schemaVersion mismatch)
  // painted by renderBanners() before the live layer ever ran a tick over it — the OLD clear arm
  // unconditionally blanked to null instead of restoring the durable state.
  test('clearing the live layer\'s stalled banner restores the durable banner underneath (e.g. a schemaVersion-mismatch warning), not a blank one', async () => {
    invokeMock.mockImplementation((channel, ...args) => {
      if (channel === 'workspace:get-run') {
        const d = buildFixtureDetail(args[0]);
        d.derived.schemaSupported = false;
        d.run.schemaVersion = 3;
        return Promise.resolve(d);
      }
      return defaultInvoke(channel, ...args);
    });
    await global.window.AmicusApp.openRun('aaaa1111');
    const banner = global.document.getElementById('banner');
    expect(banner.textContent).toContain('schemaVersion');
    global.window.AmicusVerbs.applyLive(liveDoc({ flags: { crashed: false, stalled: true, stalledForSeconds: 30 } }));
    expect(banner.textContent).toContain('No leg activity');
    global.window.AmicusVerbs.applyLive(liveDoc());
    expect(banner.textContent).toContain('schemaVersion'); // restored, not blanked
  });

  // ⚠️ Code review round 2, finding 2: workspace-app.js's renderBanners() used to pass the raw
  // `run.error` OBJECT ({code, message}) straight into renderBanner, which sets
  // `textContent = text` — coercing an object to the string "[object Object]". Claim 1's entire
  // "refreshing with the final result…" mitigation depends on that handoff actually landing a
  // readable string once the terminal openRun() refresh repaints the durable banner.
  test('the durable run.error banner (what the crashed handoff repaints into) is a formatted string, never "[object Object]"', async () => {
    invokeMock.mockImplementation((channel, ...args) => {
      if (channel === 'workspace:get-run') {
        const d = buildFixtureDetail(args[0], 'error');
        d.run.error = { code: 'INTERNAL', message: 'Council engine process exited unexpectedly' };
        d.derived.verdictPanel.reason = 'INTERNAL: Council engine process exited unexpectedly';
        return Promise.resolve(d);
      }
      return defaultInvoke(channel, ...args);
    });
    await global.window.AmicusApp.openRun('aaaa1111');
    const banner = global.document.getElementById('banner');
    expect(banner.textContent).toBe('INTERNAL: Council engine process exited unexpectedly');
    expect(banner.textContent).not.toContain('[object Object]');
  });

  // ---- applyLive: leaver removal + final-refresh failure --------------------
  test('applyLive repaints seats with an empty array too — a leg roster that shrinks to zero between stages must clear stale rows (code review round 2, minor)', async () => {
    await global.window.AmicusApp.openRun('aaaa1111');
    global.window.AmicusApp.state.blind = false;
    global.window.AmicusVerbs.applyLive(liveDoc({
      seats: [{ id: 's1', model: 'gpt', modelInput: null, role: null, status: 'running', stage: null,
        messages: null, tokensIn: null, tokensOut: null, costDisplay: null, lastActivity: null,
        latestPreview: null, stalled: false }],
    }));
    expect(global.document.getElementById('seats-body').children.length).toBe(1);
    global.window.AmicusVerbs.applyLive(liveDoc({ seats: [] }));
    expect(global.document.getElementById('seats-body').children.length).toBe(0);
  });

  test('a rejected final get-run refresh (after terminal) does not strand the "refreshing…" banner — it is replaced by an honest failure message and logged', async () => {
    await global.window.AmicusApp.openRun('aaaa1111');
    invokeMock.mockImplementation((channel, ...args) => {
      if (channel === 'workspace:get-run') { return Promise.reject(new Error('disk unmounted')); }
      return defaultInvoke(channel, ...args);
    });
    getLiveImpl = () => Promise.resolve(liveDoc({ status: 'error', terminal: true, flags: { crashed: true, stalled: false, stalledForSeconds: null } }));
    jest.advanceTimersByTime(0);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    const banner = global.document.getElementById('banner');
    expect(banner.hidden).toBe(false);
    expect(banner.textContent).not.toContain('refreshing with the final result'); // no longer a stale promise
    expect(consoleErrorSpy).toHaveBeenCalled();
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

  // ⚠️ v4.4.1 RN-6 — ARBITRATED, and this test is the arbitration made executable.
  //
  // RN-6 asked for a `hidden = true` in applyLive's banner-clearing arm, on the premise that the
  // stalled branch's `hidden = false` is what puts the Abort button on screen and therefore
  // latches it there once a momentary stall clears. The test directly above disproves the
  // premise: renderDetail already does `$('abort-btn').hidden = isTerminal` on every run-open
  // (workspace-app.js:128), so the button is visible for the WHOLE life of any non-terminal run,
  // by design — and startLiveLoop only ever runs on a non-terminal run, so applyLive's assignment
  // is a no-op on every path that can reach it. Adding the proposed clearing-arm assignment would
  // hide the Abort button the moment a stall recovered, leaving a live, healthy, still-running
  // council with no way to abort it for the rest of the session: the inverse defect, and worse.
  //
  // This test fails the moment anyone implements RN-6 as originally written.
  test('RN-6: the Abort button survives a stall -> recover cycle — a live run must stay abortable', async () => {
    await global.window.AmicusApp.openRun('aaaa1111');
    const abortBtn = global.document.getElementById('abort-btn');
    expect(abortBtn.hidden).toBe(false); // renderDetail: visible for the whole non-terminal run

    global.window.AmicusVerbs.applyLive(liveDoc({ flags: { crashed: false, stalled: true, stalledForSeconds: 180 } }));
    expect(abortBtn.hidden).toBe(false);

    global.window.AmicusVerbs.applyLive(liveDoc()); // activity resumes; the live banner clears
    expect(global.document.getElementById('banner').hidden).toBe(true); // the diagnosis DID clear
    expect(abortBtn.hidden).toBe(false);            // …and the remedy is still reachable
  });
});
