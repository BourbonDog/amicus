'use strict';

/**
 * Raw-node probe for T19-m2 (v4.7 PR7, Task 5): proves that a REJECTED
 * `workspace:read-artifact` load terminates cleanly (no unhandled rejection) and that the
 * panel recovers on a later reopen, instead of being wedged behind a cached rejected promise.
 *
 * ⚠️ Plain node script, NOT a jest test. Jest converts every unhandled rejection into a failed
 * test, which makes `process.on('unhandledRejection')` read 0 inside jest regardless of
 * whether the production code actually leaves one — see the plan's Global Constraints /
 * testing rule 1. `tests/workspace/lazy-panel-rejection.test.js` runs this file out-of-process
 * via `execFileSync` and parses the single JSON line it prints.
 *
 * Drives all THREE call sites that hold a `window.AmicusLazy.loadPanel()` promise without an
 * `onRejected` of their own:
 *   (a) proseLoader's toggle listener (workspace-lazy.js)      -> reviews-panel
 *   (b) wireLazyPanels' sameRun arm (workspace-lazy.js)        -> bundle-panel
 *   (c) drillIntoJudge (workspace-panels.js)                   -> judges-panel
 * then flips the mocked channel back to resolving and reopens the judges-panel (site c's
 * panel) through its own toggle listener ONLY — no intervening wireLazyPanels() call, which
 * would clear the cache on its own and prove nothing about loadPanel's self-eviction.
 */

const unhandled = [];
process.on('unhandledRejection', (reason) => {
  unhandled.push(String((reason && reason.message) || reason));
});

let consoleErrorCount = 0;
console.error = () => { consoleErrorCount += 1; };

const { makeFakeDom } = require('./helpers/fake-workspace-page');
const { SCRIPT_LOAD_ORDER } = require('./helpers/script-load-order');

const UI = '../../electron/workspace-ui/';

const fake = makeFakeDom();
global.window = fake.window;
global.document = fake.document;
global.NodeFilter = fake.NodeFilter;
global.document.visibilityState = 'visible';
global.document.hasFocus = () => true;

let shouldReject = true;

function buildDetail(runId) {
  const bench = ['alpha'];
  return {
    runId,
    runDir: '/fake/run/' + runId,
    run: {
      status: 'complete', schemaVersion: 2, bench, chair: bench[0],
      stages: [{ name: 'stage1', status: 'complete', startedAt: 't0', completedAt: 't1' }],
      labelMap: {}, usage: null, options: { maxCost: 2 }, error: null, debate: null,
    },
    tally: {}, verdict: {},
    artifacts: {
      'review-alpha.md': { present: true, bytes: 10 },
      'bundle-stage2.md': { present: true, bytes: 10 },
      'judge-alpha.md': { present: true, bytes: 10 },
      'chair-output.md': { present: false, bytes: 0 },
      'report.html': { present: false, bytes: 0 },
    },
    derived: {
      schemaSupported: true,
      names: [{ model: 'alpha', label: 'Alpha' }],
      artifactsByModel: null,
      stageRail: [{ name: 'stage1', label: 'Stage 1 — independent review', status: 'complete', startedAt: 't0', completedAt: 't1' }],
      matrix: { judges: [], rows: [], tierCounts: {}, judged: false },
      cost: {
        rows: bench.map((m) => ({ model: m, role: 'seat', status: 'complete', durationMs: 1000, costDisplay: '$0.10' })),
        totalDisplay: '$0.10', costAmount: 0.10, maxCost: 2,
      },
      verdictPanel: { present: false, overallVerdict: null, tierCounts: null, streetCred: [], decisions: [], reason: null },
    },
  };
}

function invoke(channel, ...args) {
  if (channel === 'workspace:list-runs') { return Promise.resolve([]); }
  if (channel === 'workspace:get-run') { return Promise.resolve(buildDetail(args[0])); }
  if (channel === 'workspace:read-artifact') {
    return shouldReject
      ? Promise.reject(new Error('probe: simulated read-artifact failure'))
      : Promise.resolve({ text: 'prose' });
  }
  return Promise.resolve(null);
}
global.window.amicusWorkspace.invoke = invoke;

SCRIPT_LOAD_ORDER.forEach((f) => { require(UI + f); }); // eslint-disable-line global-require

/** Two macrotask turns — enough for a Promise.all/.then chain to settle AND for node to have
 *  raised (or not raised) 'unhandledRejection' for whatever it settled to. */
function flush() {
  return new Promise((resolve) => { setImmediate(() => setImmediate(resolve)); });
}

function fireToggle(panelId, open) {
  const panel = global.window.AmicusApp.$(panelId);
  panel.open = open;
  panel._listeners.toggle[0]();
}

async function main() {
  const A = global.window.AmicusApp;

  await A.openRun('runP');
  await flush();

  // (a) proseLoader's toggle listener -> reviews-panel. Fire-and-forget: proseLoader discards
  // loadPanel()'s returned promise entirely.
  fireToggle('reviews-panel', true);
  await flush();
  fireToggle('reviews-panel', false); // collapse again; no invoke call, keeps it out of step (b)'s sweep
  await flush();

  // (b) wireLazyPanels' sameRun arm -> bundle-panel. Open the panel directly (no toggle, so
  // proseLoader's own listener never fires) then re-run the sameRun rewire directly — same
  // code path renderDetail() drives on a blind flip or the live loop's terminal refresh.
  A.$('bundle-panel').open = true;
  global.window.AmicusLazy.wireLazyPanels();
  await flush();

  // (c) drillIntoJudge -> judges-panel. Called directly, mirroring the matrix cell's
  // onDrill click handler (workspace-matrix.js), which also discards the returned promise.
  global.window.AmicusPanels.drillIntoJudge({ model: 'alpha' }, 'f1');
  await flush();

  // Recovery: flip the channel back to resolving and reopen judges-panel through its OWN
  // toggle listener only — no wireLazyPanels() call in between, so any recovery here is proof
  // of loadPanel's own self-eviction (`if (loading[panelId] === pending) { delete ...; }`),
  // not of wireLazyPanels' unrelated unconditional cache drop.
  fireToggle('judges-panel', false);
  shouldReject = false;
  fireToggle('judges-panel', true);
  await flush();
  await flush();

  const sectionsAfterRecovery = A.$('judges-body').children.length;

  process.stdout.write(JSON.stringify({
    unhandled,
    sectionsAfterRecovery,
    consoleErrors: consoleErrorCount,
  }) + '\n');

  clearInterval(A.state.listTimer);
  A.state.listTimer = null;
}

main();
