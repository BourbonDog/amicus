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
  };
}

/**
 * Two-flag fold latch (fold.js folded/completed pattern WITHOUT the
 * close-guard fallback-destroy machinery — a workspace fold does no async
 * model work, so that failure surface does not apply; spec §7).
 */
function createFoldGate() {
  let writing = false;
  let completed = false;
  let pendingClose = false;
  return {
    /** @returns {boolean} true when a write may start */
    begin() {
      if (writing || completed) { return false; }
      writing = true;
      return true;
    },
    /** @returns {boolean} true when a close was blocked during the write */
    settle({ ok }) {
      writing = false;
      if (ok) { completed = true; }
      const p = pendingClose;
      pendingClose = false;
      return p;
    },
    isWriting() { return writing; },
    hasCompleted() { return completed; },
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
    if (gate.hasCompleted()) { return { ok: true, already: true }; }
    if (!gate.begin()) { return { ok: false, error: 'fold-in-flight' }; }
    try {
      const detail = deps.getRunDetail(project, String(runId));
      if (detail.error || !detail.run || detail.run.parseError) {
        gate.settle({ ok: false });
        return { ok: false, error: detail.error || 'run.json unavailable' };
      }
      const chairRead = deps.readRunArtifact(project, String(runId), 'chair-output.md');
      // Distinguish a security fence firing (e.g. the realpath-escape check)
      // from a benign absence (not written yet) — both fall through to the
      // same safe fallback body below, but only one of them is worth an
      // operator's attention (code review fix).
      if (chairRead && chairRead.error) {
        logger.warn('Workspace fold: chair-output.md unavailable', { runId: String(runId), reason: chairRead.error });
      }
      const chairText = chairRead && chairRead.text ? chairRead.text : null;
      const text = deps.buildFoldText({
        nonce, project, run: detail.run, tally: detail.tally, verdict: detail.verdict, chairText,
      });
      await deps.stdoutWrite(text + '\n');
      logger.info('Workspace fold completed', { runId: String(runId) });
      const shouldClose = gate.settle({ ok: true });
      if (shouldClose) {
        const win = getWindow();
        if (win && !win.isDestroyed()) { win.close(); }
      }
      return { ok: true };
    } catch (err) {
      gate.settle({ ok: false });
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
      deps.openExternal(pathToFileURL(report).href);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  return { gate };
}

module.exports = { registerWorkspaceHandlers, createFoldGate };
