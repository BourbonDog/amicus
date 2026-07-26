/**
 * Council Workspace IPC (v4.4 §4.5) — all seven workspace: channels.
 *
 * ipc-setup.js registration pattern + DI for tests. Every handler validates
 * the sender against the workspace window via isPrivilegedSender (M9
 * belt-and-suspenders, even though this window has one webContents). All
 * reads are main-process-side; the renderer never sees a filesystem path
 * except for display. Read-only against runDir (spec §6.2): fold writes to
 * OUR stdout; abort delegates to the engine's own council-aware path.
 *
 * The in-process v4.3/v4.0 seam: require('../src/mcp-server').handlers —
 * requiring mcp-server does NOT start the server (cli-handlers-status.js:3).
 */
'use strict';

const path = require('path');
const { pathToFileURL } = require('url');
const { logger } = require('../src/utils/logger');
const { isPrivilegedSender } = require('./ipc-guard');
const { isRealpathContained } = require('../src/workspace/artifact-guard');

function defaultDeps() {
  return {
    scanCouncilRuns: (...a) => require('../src/workspace/run-scan').scanCouncilRuns(...a),
    getRunDetail: (...a) => require('../src/workspace/run-detail').getRunDetail(...a),
    readPointer: (...a) => require('../src/workspace/run-scan').readPointer(...a),
    readRunArtifact: (...a) => require('../src/workspace/artifact-guard').readRunArtifact(...a),
    buildFoldText: (...a) => require('../src/workspace/fold-format').buildFoldText(...a),
    normalizeLive: (...a) => require('../src/workspace/live-normalize').normalizeLive(...a),
    handlers: () => require('../src/mcp-server').handlers,
    // Node passes an Error to this callback when the chunk fails to flush
    // (e.g. a dead parent pipe / closed stdout) — reject on it rather than
    // resolving unconditionally, or a failed write reports {ok:true} to the
    // renderer and permanently latches gate.hasCompleted() (code review fix).
    stdoutWrite: (text) => new Promise((resolve, reject) => {
      process.stdout.write(text, (err) => (err ? reject(err) : resolve()));
    }),
    openExternal: (url) => require('electron').shell.openExternal(url),
    existsSync: (p) => require('fs').existsSync(p),
    realpathSync: (p) => require('fs').realpathSync(p),
  };
}

/**
 * Two-flag fold latch (fold.js folded/completed pattern WITHOUT the
 * close-guard fallback-destroy machinery — a workspace fold does no async
 * model work, so that failure surface does not apply; spec §7).
 *
 * ⚠️ COUNCIL REVIEW R2 (A3): `completed` used to be a single unkeyed boolean —
 * one successful fold latched the gate for the ENTIRE life of the window, for
 * every run, not just the one that was actually folded. The renderer supports
 * navigating to a different run within one open window (openRun with a
 * dynamic runId; a bare `--ui` launch opens the whole project run list, spec
 * §4.3/§4.4), so: open run A, Fold (succeeds) -> switch to run B, Fold ->
 * the old code returned {ok:true, already:true} WITHOUT ever writing
 * anything for B. Silent wrong-result, not cosmetic: the UI reads "Folded ✓"
 * for a run that was never written to the launching terminal.
 *
 * Completion is now keyed per runId (a Set of runIds that have been
 * successfully folded), so each DISTINCT run gets its own honest
 * begin()/hasCompleted() pair. `writing` (in flight) stays a single GLOBAL
 * flag on purpose: at most one fold write can be in progress at any instant
 * regardless of which run it is for (there is exactly one stdout stream to
 * write to), so a second concurrent call — for the SAME run or a different
 * one — still correctly gets 'fold-in-flight' rather than interleaving two
 * writes.
 *
 * Why per-run, not "reset the whole gate when the active run changes" or
 * "keep one global one-shot latch and just report it more honestly": the
 * plan's spec §7 line ("the fold nonce is per-window-launch... one fold
 * write per launch... a second fold of the SAME run legitimately returns
 * already:true") was written before multi-run navigation existed and reads
 * naturally as "don't spam-refold what you already folded" rather than "the
 * whole window may only ever fold one run, period." Concretely, allowing one
 * successful fold per DISTINCT run within a single launch is safe: the
 * workspace's fold-write path (src/sidecar/workspace-window.js) just relays
 * accumulated stdout live and returns the exit code once the window closes —
 * it does no first/last-marker disambiguation the way the OLDER headless
 * model-session flow's findTrailingFoldMarker does (src/headless.js) — and
 * every fold block is self-identifying (`Session: <runId>`,
 * src/workspace/fold-format.js), so two distinct runs folded into the same
 * launch's stdout are unambiguous to whatever reads it. A global
 * one-shot-per-window latch would instead be a real product regression: it
 * would make "browse several runs and fold the ones you care about" — the
 * whole point of the window NOT auto-closing after a fold — impossible
 * without reopening the workspace for every run after the first.
 */
function createFoldGate() {
  let writing = false;
  let writingRunId = null;
  const completedRuns = new Set();
  let pendingClose = false;
  return {
    /** @returns {boolean} true when a write may start for runId */
    begin(runId) {
      if (writing || completedRuns.has(runId)) { return false; }
      writing = true;
      writingRunId = runId;
      return true;
    },
    /** @returns {boolean} true when a close was blocked during the write */
    settle({ ok }) {
      writing = false;
      if (ok) { completedRuns.add(writingRunId); }
      writingRunId = null;
      const p = pendingClose;
      pendingClose = false;
      return p;
    },
    isWriting() { return writing; },
    hasCompleted(runId) { return completedRuns.has(runId); },
    noteBlockedClose() { pendingClose = true; },
  };
}

/**
 * @param {() => object|null} getWindow returns the workspace BrowserWindow
 * @param {{project: string, nonce: string, ipc?: object, gate?: object, deps?: object}} ctx
 * @returns {{gate: object}}
 */
function registerWorkspaceHandlers(getWindow, ctx) {
  const { project, nonce } = ctx;
  const deps = { ...defaultDeps(), ...(ctx.deps || {}) };
  const ipc = ctx.ipc || require('electron').ipcMain;
  const gate = ctx.gate || createFoldGate();
  const fromWorkspace = (event) => isPrivilegedSender(event, getWindow);
  // ⚠️ CODE REVIEW (task-9 post-approval): settle()'s pendingClose signal used to be
  // read only on the success path below, so a close blocked while a fold was writing
  // silently dropped on the two failure paths (settle({ok:false}) at the detail-error
  // early return and in the outer catch) — the window stayed open with no further
  // close handler poised to retry until the user clicked X again. All three settle()
  // call sites must honor a pending close identically.
  const closeIfPending = (shouldClose) => {
    if (!shouldClose) { return; }
    const win = getWindow();
    if (win && !win.isDestroyed()) { win.close(); }
  };

  ipc.handle('workspace:list-runs', (event) => {
    if (!fromWorkspace(event)) { return []; }
    try { return deps.scanCouncilRuns(project); }
    catch (err) { logger.error('workspace list-runs failed', { error: err.message }); return []; }
  });

  ipc.handle('workspace:get-run', (event, runId) => {
    if (!fromWorkspace(event)) { return { error: 'unauthorized' }; }
    try { return deps.getRunDetail(project, String(runId)); }
    catch (err) { return { runId: String(runId), error: err.message }; }
  });

  ipc.handle('workspace:get-live', async (event, runId) => {
    if (!fromWorkspace(event)) { return { ok: false, error: 'unauthorized' }; }
    try {
      const result = await deps.handlers().amicus_status({ taskId: String(runId) }, project);
      const text = result && result.content && result.content[0] ? result.content[0].text : '';
      if (result && result.isError) { return { ok: false, error: String(text).slice(0, 500) }; }
      let doc;
      try { doc = JSON.parse(text); } catch { return { ok: false, error: 'unparseable status doc' }; }
      return deps.normalizeLive(doc);
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipc.handle('workspace:read-artifact', (event, runId, name) => {
    if (!fromWorkspace(event)) { return { error: 'unauthorized' }; }
    try { return deps.readRunArtifact(project, String(runId), String(name)); }
    catch (err) { return { error: err.message }; }
  });

  ipc.handle('workspace:abort-run', async (event, runId) => {
    if (!fromWorkspace(event)) { return { ok: false, error: 'unauthorized' }; }
    try {
      const result = await deps.handlers().amicus_abort({ taskId: String(runId) }, project);
      const text = result && result.content && result.content[0] ? result.content[0].text : '';
      return { ok: !(result && result.isError), detail: String(text).slice(0, 2000) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipc.handle('workspace:fold', async (event, runId) => {
    if (!fromWorkspace(event)) { return { ok: false, error: 'unauthorized' }; }
    const runKey = String(runId);
    // Gate keyed on runKey (council review R2, A3 — see createFoldGate's
    // docblock): completing run A must not latch a DIFFERENT run B.
    if (gate.hasCompleted(runKey)) { return { ok: true, already: true }; }
    if (!gate.begin(runKey)) { return { ok: false, error: 'fold-in-flight' }; }
    try {
      const detail = deps.getRunDetail(project, runKey);
      if (detail.error || !detail.run || detail.run.parseError) {
        closeIfPending(gate.settle({ ok: false }));
        return { ok: false, error: detail.error || 'run.json unavailable' };
      }
      const chairRead = deps.readRunArtifact(project, runKey, 'chair-output.md');
      // Distinguish a security fence firing (e.g. the realpath-escape check)
      // from a benign absence (not written yet) — both fall through to the
      // same safe fallback body below, but only one of them is worth an
      // operator's attention (code review fix).
      if (chairRead && chairRead.error) {
        logger.warn('Workspace fold: chair-output.md unavailable', { runId: runKey, reason: chairRead.error });
      }
      const chairText = chairRead && chairRead.text ? chairRead.text : null;
      const text = deps.buildFoldText({
        nonce, project, run: detail.run, tally: detail.tally, verdict: detail.verdict, chairText,
      });
      await deps.stdoutWrite(text + '\n');
      logger.info('Workspace fold completed', { runId: runKey });
      closeIfPending(gate.settle({ ok: true }));
      return { ok: true };
    } catch (err) {
      closeIfPending(gate.settle({ ok: false }));
      logger.error('Workspace fold failed', { error: err.message });
      return { ok: false, error: err.message };
    }
  });

  ipc.handle('workspace:open-report', (event, runId) => {
    if (!fromWorkspace(event)) { return { ok: false, error: 'unauthorized' }; }
    // ⚠️ DE-ROT (F59): the SHIPPED readPointer (src/council/run-state.js:133-139,
    // which Task 2's dedupe makes this deps entry resolve to) returns **null** for a
    // missing/corrupt pointer — it never returns {error}. A bare `ptr.error` throws a
    // TypeError straight out of the handler, and this was the only one of the seven
    // with no try/catch. Guard for null AND wrap, like the other six.
    try {
      const ptr = deps.readPointer(project, String(runId));
      if (!ptr || ptr.error) { return { ok: false, error: (ptr && ptr.error) || 'run pointer not found' }; }
      const report = path.join(ptr.runDir, 'report.html');
      if (!deps.existsSync(report)) { return { ok: false, error: 'report.html not written' }; }

      // Containment fence (council review C1, MAJOR, unanimous): this handler was
      // the only filesystem-reaching workspace: channel with no containment check,
      // and the only one that hands a disk-derived path to a shell verb
      // (openExternal) — ptr.runDir is charset-blind and never validated beyond
      // truthiness (src/council/run-state.js:133-139). Mirror artifact-guard's
      // fence 2 (readRunArtifact) in BOTH directions: runDir itself must resolve
      // inside the project (a stale/tampered pointer can't redirect us anywhere
      // on disk — legitimate runDirs already satisfy this at creation time via
      // isPathInside, src/mcp-council-run.js:109), and report.html must resolve
      // inside runDir (a symlinked report.html can't escape the run dir either).
      // Fail closed on any realpath error (missing dir, permission, dangling
      // symlink) rather than let it fall through to openExternal.
      let realProject, realRunDir, realReport;
      try {
        realProject = deps.realpathSync(project);
        realRunDir = deps.realpathSync(ptr.runDir);
        realReport = deps.realpathSync(report);
      } catch (err) {
        return { ok: false, error: `report path unreadable: ${err.message}` };
      }
      if (!isRealpathContained(realProject, realRunDir)) {
        return { ok: false, error: 'run directory escapes project' };
      }
      if (!isRealpathContained(realRunDir, realReport)) {
        return { ok: false, error: 'report escapes run directory' };
      }

      deps.openExternal(pathToFileURL(realReport).href);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  return { gate };
}

module.exports = { registerWorkspaceHandlers, createFoldGate };
