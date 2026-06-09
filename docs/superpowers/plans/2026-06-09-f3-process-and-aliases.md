# F3 — Process Lifecycle & Alias Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close upstream issues #15 (zombie parent process), #20 (orphaned session on parent kill), and #18 (broken `codex` alias) so the parallel-headless workflow exits cleanly, never orphans sessions, and validates models against a live OpenRouter catalog.

**Architecture:** Three engine fixes. (A) Capture the OpenCode Go-server PID once at startup as `server.goPid` and use it for a **cross-platform** force-kill (replacing the Unix-only `lsof`), plus a one-shot force-exit watchdog and SIGTERM/SIGINT/SIGBREAK handlers that abort the session. (B) A TTL'd OpenRouter catalog cache feeding default-on model validation. The council stays a skill; all changes are in the engine/CLI.

**Tech Stack:** Node.js (CommonJS), Jest, `@opencode-ai/sdk`, OpenRouter `/api/v1/models`. Windows-first (PowerShell host) + macOS.

**Conventions (read before starting):**
- Every new `src/**` file must stay **under 300 lines** (pre-commit hook `scripts/check-file-sizes.js`) and lint-clean (lint-staged runs `eslint --fix` on staged `src/**/*.js`).
- Tests live flat in `tests/` (e.g. `tests/model-fetcher.test.js`) except util-only modules which may go in `tests/utils/` and script tests in `tests/scripts/`. Match the nearest existing neighbor.
- Run the **full** suite when checking (`npm test` covers `tests/` **and** `evals/tests/`). Baseline is GREEN: 0 failed / 1625 passed / 5 skipped. Do not regress it.
- `docs/superpowers/**` is gitignored — commit plan/spec edits with `git add -f`. `src/`, `tests/`, `scripts/` are normal.
- Branch: `f3/process-and-aliases` (already created off `main`).

---

## File Structure

| File | Status | Responsibility |
| --- | --- | --- |
| `src/utils/port-pid.js` | Create | `findListenerPid(port)` — cross-platform PID of the process LISTENING on a TCP port |
| `src/opencode-client.js` | Modify | Capture `server.goPid` at start; cross-platform force-kill in `close()` (drop `lsof`) |
| `src/utils/lifecycle.js` | Create | `isOneShotCommand(cmd)` + `armExitWatchdog()` — force-exit safety net |
| `bin/amicus.js` | Modify | Arm the watchdog after one-shot commands complete |
| `src/utils/session-abort.js` | Create | `markAborted(sessionDir, reason)` + `installSignalAbort({onAbort})` |
| `src/headless.js` | Modify | Install signal-abort during the run; record `goPid`; uninstall on exit |
| `src/cli-handlers.js` | Modify | `handleAbort` uses `markAborted`; add `--all` |
| `src/sidecar/read.js` | Modify | Extract `enumerateSessions(project, {status})` (returnable); `listSidecars` reuses it |
| `src/cli.js` | Modify | Add `no-validate-model` boolean flag; usage text for `abort --all` + `--no-validate-model` |
| `src/utils/model-catalog.js` | Create | TTL'd OpenRouter catalog cache: `getCatalog()`, `refreshCatalog()`, `catalogPath()` |
| `src/utils/model-validator.js` | Modify | Add `validateAgainstCatalog(resolvedModel, alias, {headless})` |
| `src/utils/start-helpers.js` | Modify | Default-on validation; `--no-validate-model` opt-out; `--validate-model` no-op |
| `src/utils/config.js` | Modify | Pin/annotate the `codex` alias (verified valid 2026-06-09) |
| `scripts/refresh-model-capabilities.js` | Create | Back the dangling `refresh-models`/`models:info`/`models:check` npm scripts; seed cache |

---

# PART A — Process Lifecycle (#15, #20)

## Task A1: Cross-platform server reap via captured `goPid`

**Files:**
- Create: `src/utils/port-pid.js`
- Test: `tests/utils/port-pid.test.js`
- Modify: `src/opencode-client.js:450-489` (`startServer`)
- Test: `tests/opencode-client.test.js` (extend)

- [ ] **Step 1: Write the failing test for `findListenerPid`**

Create `tests/utils/port-pid.test.js`:

```js
'use strict';

jest.mock('child_process', () => ({ execFileSync: jest.fn() }));
const { execFileSync } = require('child_process');
const { findListenerPid } = require('../../src/utils/port-pid');

const realPlatform = process.platform;
function setPlatform(p) {
  Object.defineProperty(process, 'platform', { value: p, configurable: true });
}
afterEach(() => { setPlatform(realPlatform); jest.clearAllMocks(); });

describe('findListenerPid', () => {
  test('parses the LISTENING pid from netstat on win32', () => {
    setPlatform('win32');
    execFileSync.mockReturnValue(
      '\r\n  Proto  Local Address      Foreign Address    State        PID\r\n' +
      '  TCP    127.0.0.1:4096     0.0.0.0:0          LISTENING    4321\r\n' +
      '  TCP    127.0.0.1:5000     0.0.0.0:0          LISTENING    9999\r\n'
    );
    expect(findListenerPid(4096)).toBe(4321);
  });

  test('parses the pid from lsof on unix', () => {
    setPlatform('linux');
    execFileSync.mockReturnValue('5678\n');
    expect(findListenerPid(4096)).toBe(5678);
  });

  test('returns null when no listener is found', () => {
    setPlatform('linux');
    execFileSync.mockImplementation(() => { throw new Error('no process'); });
    expect(findListenerPid(4096)).toBe(null);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest tests/utils/port-pid.test.js`
Expected: FAIL — `Cannot find module '../../src/utils/port-pid'`.

- [ ] **Step 3: Implement `src/utils/port-pid.js`**

```js
/**
 * Cross-platform listener-PID lookup.
 *
 * Finds the PID of the process LISTENING on a local TCP port. Replaces the
 * Unix-only `lsof` call so the OpenCode Go server can be force-killed on
 * Windows too (F3 #15).
 */

const { execFileSync } = require('child_process');

/**
 * @param {number} port - TCP port to inspect
 * @returns {number|null} PID of the LISTENING process, or null if none/none found
 */
function findListenerPid(port) {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('netstat', ['-ano', '-p', 'TCP'], {
        encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
      });
      for (const line of out.split(/\r?\n/)) {
        // Columns: Proto  Local  Foreign  State  PID
        const m = line.trim().match(/^TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)$/i);
        if (m && Number(m[1]) === port) { return Number(m[2]); }
      }
      return null;
    }
    const out = execFileSync('lsof', ['-ti', `:${port}`, '-sTCP:LISTEN'], {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    const pid = parseInt(out.split(/\s+/)[0], 10);
    return Number.isInteger(pid) ? pid : null;
  } catch {
    return null;
  }
}

module.exports = { findListenerPid };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest tests/utils/port-pid.test.js`
Expected: PASS (3 passed).

- [ ] **Step 5: Wire `goPid` capture + cross-platform kill into `startServer`**

In `src/opencode-client.js`, add the require near the top (after the existing requires):

```js
const { findListenerPid } = require('./utils/port-pid');
```

Replace the `close()` wrapper block (currently `src/opencode-client.js:457-486`, the `const serverPort = ...` through `return { client, server };`) with:

```js
  // Capture the Go server PID once so close() can force-kill it cross-platform
  // (F3 #15). Prefer a PID the SDK exposes; fall back to the port listener.
  const serverPort = parseInt(new URL(sdkServer.url).port, 10);
  const goPid = sdkServer.pid || (sdkServer.process && sdkServer.process.pid) || findListenerPid(serverPort);

  const server = {
    url: sdkServer.url,
    goPid,
    close() {
      sdkServer.close(); // sends SIGTERM via proc.kill()
      // Force-kill fallback if the Go server ignores SIGTERM (it can when MCP
      // servers are active, keeping Node's loop alive). .unref() so this timer
      // never holds the process open by itself.
      const fallback = setTimeout(() => {
        const pid = server.goPid;
        if (pid && pid !== process.pid) {
          try { process.kill(pid, 'SIGKILL'); } catch { /* already dead */ }
          require('./utils/logger').logger.debug('Force-killed OpenCode server', { port: serverPort, pid });
        }
      }, 2000);
      fallback.unref();
    }
  };

  return { client, server };
```

- [ ] **Step 6: Add a regression test that `startServer` exposes `goPid` and kills it**

Append to `tests/opencode-client.test.js` (inside the top-level describe; adjust the SDK mock to match the file's existing `getSDK`/`getCreateOpencodeServer` mocking style if different):

```js
describe('startServer goPid (F3 #15)', () => {
  test('exposes server.goPid and SIGKILLs it when close() force-kills', async () => {
    jest.resetModules();
    jest.useFakeTimers();
    const sdkClose = jest.fn();
    jest.doMock('../src/utils/port-pid', () => ({ findListenerPid: () => 24680 }));
    jest.doMock('../src/opencode-sdk-loader', () => ({}), { virtual: true });
    const oc = require('../src/opencode-client');
    jest.spyOn(oc, 'getCreateOpencodeServer').mockResolvedValue(
      async () => ({ url: 'http://127.0.0.1:4096', close: sdkClose })
    );
    const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => true);

    const { server } = await oc.startServer({ port: 0 });
    expect(server.goPid).toBe(24680);
    server.close();
    expect(sdkClose).toHaveBeenCalled();
    jest.advanceTimersByTime(2000);
    expect(killSpy).toHaveBeenCalledWith(24680, 'SIGKILL');

    killSpy.mockRestore();
    jest.useRealTimers();
  });
});
```

> NOTE: `tests/opencode-client.test.js` already mocks the SDK. Reuse its existing mock setup rather than the `doMock` above if it conflicts — the assertions (`server.goPid` set, `process.kill(goPid,'SIGKILL')` after 2s) are what matter.

- [ ] **Step 7: Run both test files**

Run: `npx jest tests/utils/port-pid.test.js tests/opencode-client.test.js`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/utils/port-pid.js tests/utils/port-pid.test.js src/opencode-client.js tests/opencode-client.test.js
git commit -m "fix(f3): cross-platform OpenCode server reap via captured goPid (#15)"
```

---

## Task A2: One-shot force-exit watchdog

**Files:**
- Create: `src/utils/lifecycle.js`
- Test: `tests/utils/lifecycle.test.js`
- Modify: `bin/amicus.js` (`main`, after the command switch)

- [ ] **Step 1: Write the failing test**

Create `tests/utils/lifecycle.test.js`:

```js
'use strict';
const { isOneShotCommand, armExitWatchdog } = require('../../src/utils/lifecycle');

describe('isOneShotCommand', () => {
  test('start/continue/resume/list/read/abort are one-shot', () => {
    for (const c of ['start', 'continue', 'resume', 'list', 'read', 'abort']) {
      expect(isOneShotCommand(c)).toBe(true);
    }
  });
  test('mcp is NOT one-shot (long-lived server)', () => {
    expect(isOneShotCommand('mcp')).toBe(false);
  });
});

describe('armExitWatchdog', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('calls exit(code) after ms and logs', () => {
    const exit = jest.fn();
    const log = jest.fn();
    armExitWatchdog(0, 1500, { exit, log });
    expect(exit).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1500);
    expect(exit).toHaveBeenCalledWith(0);
    expect(log).toHaveBeenCalled();
  });

  test('returns an unref-able timer that does not hold the loop', () => {
    const exit = jest.fn();
    const t = armExitWatchdog(0, 1500, { exit });
    expect(typeof t.unref).toBe('function');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest tests/utils/lifecycle.test.js`
Expected: FAIL — `Cannot find module '../../src/utils/lifecycle'`.

- [ ] **Step 3: Implement `src/utils/lifecycle.js`**

```js
/**
 * Process-lifecycle helpers for the one-shot CLI commands (F3 #15).
 *
 * One-shot commands must return control to the shell when their work is done.
 * If a stray handle (e.g. the OpenCode Go server) keeps Node's event loop
 * alive, the force-exit watchdog guarantees the process still exits.
 */

const ONE_SHOT_COMMANDS = new Set(['start', 'continue', 'resume', 'list', 'read', 'abort']);

/** @param {string} command @returns {boolean} */
function isOneShotCommand(command) {
  return ONE_SHOT_COMMANDS.has(command);
}

/**
 * Arm an unref'd timer that force-exits if the loop has not drained by `ms`.
 * Natural drain still wins: an unref'd timer never holds the process open, so
 * a clean exit happens before this fires. Injectable exit/log for tests.
 *
 * @param {number} [code=0]
 * @param {number} [ms=1500]
 * @param {{exit?: Function, log?: Function}} [deps]
 * @returns {NodeJS.Timeout}
 */
function armExitWatchdog(code = 0, ms = 1500, deps = {}) {
  const exit = deps.exit || process.exit;
  const log = deps.log;
  const t = setTimeout(() => {
    if (log) { log('force-exit watchdog fired — a handle kept the event loop alive', { code, ms }); }
    exit(code);
  }, ms);
  if (t.unref) { t.unref(); }
  return t;
}

module.exports = { isOneShotCommand, armExitWatchdog, ONE_SHOT_COMMANDS };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest tests/utils/lifecycle.test.js`
Expected: PASS (4 passed).

- [ ] **Step 5: Wire the watchdog into `bin/amicus.js`**

Add to the requires near the top of `bin/amicus.js` (after line 17):

```js
const { isOneShotCommand, armExitWatchdog } = require('../src/utils/lifecycle');
const { logger } = require('../src/utils/logger');
```

In `main()`, immediately AFTER the `try { switch (command) { ... } } catch (err) { ... }` block (i.e. after the catch closes, around current line 107) and before `main()` returns, add:

```js
  // F3 #15: one-shot commands must not hang on a lingering handle. The work is
  // done here; give natural drain a brief grace, then force-exit as a net.
  // (mcp is long-lived and never reaches this point.)
  if (isOneShotCommand(command)) {
    armExitWatchdog(0, 1500, { log: (m, meta) => logger.debug(m, meta) });
  }
```

- [ ] **Step 6: Verify the existing process integration test still passes**

Run: `npx jest tests/cli-process.integration.test.js`
Expected: PASS (or SKIP if it gates on an API key). If it spawns a real `start`, it now exits within ~1.5s instead of hanging.

- [ ] **Step 7: Commit**

```bash
git add src/utils/lifecycle.js tests/utils/lifecycle.test.js bin/amicus.js
git commit -m "fix(f3): force-exit watchdog so one-shot commands never zombie (#15)"
```

---

## Task A3: Signal-based session abort + `goPid` recording

**Files:**
- Create: `src/utils/session-abort.js`
- Test: `tests/utils/session-abort.test.js`
- Modify: `src/headless.js` (install/uninstall handlers; record `goPid`)
- Modify: `src/cli-handlers.js` (`handleAbort` reuses `markAborted`)

- [ ] **Step 1: Write the failing test**

Create `tests/utils/session-abort.test.js`:

```js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { markAborted, installSignalAbort } = require('../../src/utils/session-abort');

describe('markAborted', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-abort-'));
    fs.writeFileSync(path.join(dir, 'metadata.json'),
      JSON.stringify({ taskId: 'abc', status: 'running' }));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('sets status=aborted and records reason + timestamp', () => {
    markAborted(dir, 'SIGTERM');
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'metadata.json'), 'utf-8'));
    expect(meta.status).toBe('aborted');
    expect(meta.reason).toContain('SIGTERM');
    expect(meta.abortedAt).toBeTruthy();
  });

  test('is a no-op (no throw) when metadata is missing', () => {
    fs.rmSync(path.join(dir, 'metadata.json'));
    expect(() => markAborted(dir, 'SIGINT')).not.toThrow();
  });
});

describe('installSignalAbort', () => {
  test('invokes onAbort with the signal and uninstall removes the listener', () => {
    const onAbort = jest.fn();
    const uninstall = installSignalAbort({ onAbort, signals: ['SIGUSR2'] });
    process.emit('SIGUSR2');
    expect(onAbort).toHaveBeenCalledWith('SIGUSR2');
    uninstall();
    process.emit('SIGUSR2');
    expect(onAbort).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest tests/utils/session-abort.test.js`
Expected: FAIL — `Cannot find module '../../src/utils/session-abort'`.

- [ ] **Step 3: Implement `src/utils/session-abort.js`**

```js
/**
 * Session abort on process signals (F3 #20).
 *
 * When the parent process is killed (SIGTERM/SIGINT/SIGBREAK), the running
 * headless session must be aborted so no orphaned OpenCode session keeps
 * burning API credits. `markAborted` is the synchronous metadata write that
 * guarantees `amicus list` won't show an orphan afterward.
 */

const fs = require('fs');
const path = require('path');

/**
 * Synchronously mark a session's metadata as aborted. Best-effort: never throws.
 * @param {string} sessionDir
 * @param {string} reason - e.g. a signal name
 */
function markAborted(sessionDir, reason) {
  try {
    const metaPath = path.join(sessionDir, 'metadata.json');
    if (!fs.existsSync(metaPath)) { return; }
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    meta.status = 'aborted';
    meta.reason = `Aborted (${reason})`;
    meta.abortedAt = new Date().toISOString();
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), { mode: 0o600 });
  } catch {
    // best-effort
  }
}

/**
 * Register signal handlers that call onAbort(signal). Returns an uninstall fn.
 * @param {{onAbort: (signal: string) => void, signals?: string[]}} opts
 * @returns {() => void} uninstall
 */
function installSignalAbort({ onAbort, signals = ['SIGINT', 'SIGTERM', 'SIGBREAK'] }) {
  const handler = (signal) => { try { onAbort(signal); } catch { /* best-effort */ } };
  const registered = [];
  for (const sig of signals) {
    try { process.on(sig, handler); registered.push(sig); } catch { /* unsupported signal */ }
  }
  return function uninstall() {
    for (const sig of registered) { process.removeListener(sig, handler); }
  };
}

module.exports = { markAborted, installSignalAbort };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest tests/utils/session-abort.test.js`
Expected: PASS (4 passed).

- [ ] **Step 5: Install the handlers inside `runHeadless`**

In `src/headless.js`, inside `runHeadless`, AFTER `sessionId` is obtained and progress is written `session_created` (current line 218) and BEFORE the user message is logged (line 220), insert:

```js
    // F3 #20: abort this session if the parent process is signalled. Record the
    // Go server PID so `amicus list` liveness checks can see it. Only for the
    // owned (non-shared) server — shared servers are torn down by their owner.
    let uninstallSignals;
    if (!externalServer) {
      if (server && server.goPid) {
        try {
          const metaPath = path.join(sessionDir, 'metadata.json');
          const m = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
          m.goPid = server.goPid;
          fs.writeFileSync(metaPath, JSON.stringify(m, null, 2), { mode: 0o600 });
        } catch { /* metadata optional */ }
      }
      const { installSignalAbort, markAborted } = require('./utils/session-abort');
      uninstallSignals = installSignalAbort({
        onAbort: (signal) => {
          logger.warn('Signal received — aborting headless session', { taskId, signal });
          markAborted(sessionDir, signal);
          try { const { abortSession } = require('./opencode-client'); abortSession(client, sessionId); } catch { /* best-effort */ }
          try { server.close(); } catch { /* best-effort */ }
          const code = signal === 'SIGINT' ? 130 : 143;
          const t = setTimeout(() => process.exit(code), 300);
          if (t.unref) { t.unref(); }
        },
      });
    }
```

Then ensure `uninstallSignals` is removed on every exit path. The function has three returns after this point (the timeout/normal `return` near line 578, the `sessionError && !output` return near 566, and the `catch` return near 605) plus the watchdog cleanup. Add `if (uninstallSignals) { uninstallSignals(); }` immediately after each `watchdog.cancel();` call (there are cleanup sites near lines 550 and 603) and right before the `sessionError && !output` early return. The simplest robust placement: add a helper-free guard right after `watchdog.cancel();` on the normal path (line ~550) and in the `catch` block (line ~603):

```js
    if (uninstallSignals) { uninstallSignals(); }
```

> Declare `let uninstallSignals;` at the same scope as `let watchdog;` (near line 159) so it is visible in the `catch`.

- [ ] **Step 6: Refactor `handleAbort` to reuse `markAborted` (DRY)**

In `src/cli-handlers.js`, replace the manual metadata write in `handleAbort` (current lines 87-90):

```js
  meta.status = 'aborted';
  meta.abortedAt = new Date().toISOString();
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), { mode: 0o600 });
  console.log(`Session ${taskId} marked as aborted.`);
```

with:

```js
  const { markAborted } = require('./utils/session-abort');
  markAborted(sessionDir, 'manual abort');
  console.log(`Session ${taskId} marked as aborted.`);
```

(The earlier `meta` read at lines 80-86 still guards the "not found / malformed" cases, so keep it.)

- [ ] **Step 7: Run the affected suites**

Run: `npx jest tests/utils/session-abort.test.js tests/headless.test.js tests/process-lifecycle.test.js`
Expected: PASS. (If `tests/headless.test.js` mocks `startServer`, ensure the mock server object includes `goPid` or is undefined — the new block tolerates a missing `goPid`.)

- [ ] **Step 8: Commit**

```bash
git add src/utils/session-abort.js tests/utils/session-abort.test.js src/headless.js src/cli-handlers.js
git commit -m "fix(f3): abort headless session on SIGTERM/SIGINT/SIGBREAK; record goPid (#20)"
```

---

## Task A4: `abort --all`

**Files:**
- Modify: `src/sidecar/read.js` (extract `enumerateSessions`)
- Modify: `src/cli-handlers.js` (`handleAbort` `--all` branch)
- Modify: `src/cli.js` (`getUsage` — document `abort` options)
- Test: `tests/abort-all.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/abort-all.test.js`:

```js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { enumerateSessions } = require('../src/sidecar/read');

function seed(project, id, status) {
  const dir = path.join(project, '.claude', 'amicus_sessions', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'metadata.json'),
    JSON.stringify({ taskId: id, status, model: 'm', createdAt: new Date().toISOString() }));
}

describe('enumerateSessions', () => {
  let project;
  beforeEach(() => { project = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-enum-')); });
  afterEach(() => fs.rmSync(project, { recursive: true, force: true }));

  test('returns only running sessions when filtered', () => {
    seed(project, 'aaaaaaaa', 'running');
    seed(project, 'bbbbbbbb', 'complete');
    seed(project, 'cccccccc', 'running');
    const running = enumerateSessions(project, { status: 'running' });
    expect(running.map(s => s.id).sort()).toEqual(['aaaaaaaa', 'cccccccc']);
  });

  test('returns [] when no sessions dir exists', () => {
    expect(enumerateSessions(project, { status: 'running' })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest tests/abort-all.test.js`
Expected: FAIL — `enumerateSessions is not a function`.

- [ ] **Step 3: Extract `enumerateSessions` in `src/sidecar/read.js`**

Add this function above `listSidecars` and export it. It is the returnable form of the dedup/scan loop currently inline in `listSidecars` (lines 44-80):

```js
/**
 * Enumerate sessions across canonical + legacy roots (dedup, amicus wins).
 * @param {string} project
 * @param {{status?: string}} [opts] - status filter ('running', etc.); omit/`'all'` for all
 * @returns {Array<{id, model, status, agent, briefing, createdAt}>}
 */
function enumerateSessions(project, opts = {}) {
  const roots = [SESSIONS_DIR, LEGACY_SESSIONS_DIR]
    .map(d => path.join(project, '.claude', d))
    .filter(fs.existsSync);

  const byId = new Map();
  for (const root of roots) {
    for (const d of fs.readdirSync(root)) {
      if (!TASK_ID_PATTERN.test(d)) { continue; }
      if (byId.has(d)) { continue; }
      const metaPath = path.join(root, d, 'metadata.json');
      if (!fs.existsSync(metaPath)) { continue; }
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        byId.set(d, {
          id: d, model: meta.model, status: meta.status, agent: meta.agent,
          briefing: meta.briefing, createdAt: meta.createdAt,
        });
      } catch { /* skip unreadable */ }
    }
  }

  let sessions = Array.from(byId.values())
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  if (opts.status && opts.status !== 'all') {
    sessions = sessions.filter(s => s.status === opts.status);
  }
  return sessions;
}
```

Then refactor `listSidecars` to reuse it: replace its inline scan (lines 44-80, from `const roots = ...` through the `status` filter) with:

```js
  const sessions = enumerateSessions(project, { status });
  if (sessions.length === 0) {
    console.log('No amicus sessions found.');
    return;
  }
```

Add `enumerateSessions` to `module.exports` at the bottom of the file.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest tests/abort-all.test.js tests/sidecar/`
Expected: PASS (the list tests still pass via the refactor).

- [ ] **Step 5: Add the `--all` branch to `handleAbort`**

In `src/cli-handlers.js handleAbort`, at the very top of the function (before the `const taskId = args._[1]` block), insert:

```js
  if (args.all) {
    const project = args.cwd || process.cwd();
    const { enumerateSessions } = require('./sidecar/read');
    const { markAborted } = require('./utils/session-abort');
    const { getSessionDir } = require('./session-manager');
    const running = enumerateSessions(project, { status: 'running' });
    if (running.length === 0) {
      console.log('No running sessions to abort.');
      return;
    }
    for (const s of running) {
      markAborted(getSessionDir(project, s.id), 'abort --all');
      console.log(`Aborted ${s.id}`);
    }
    console.log(`Aborted ${running.length} running session(s).`);
    return;
  }
```

- [ ] **Step 6: Document the new options in `getUsage`**

In `src/cli.js getUsage()`, after the `Options for 'list':` block (current lines 334-337), add:

```js

Options for 'abort':
  --all                        Abort all running sessions in this project
```

And change the `Commands:` line for abort (line ~298) to: `  abort       Abort a running session (or --all)`.

- [ ] **Step 7: Add a handler test**

Append to `tests/abort-all.test.js`:

```js
describe('handleAbort --all', () => {
  let project, logSpy;
  beforeEach(() => {
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-abortall-'));
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => { logSpy.mockRestore(); fs.rmSync(project, { recursive: true, force: true }); });

  test('marks every running session aborted', async () => {
    seed(project, 'aaaaaaaa', 'running');
    seed(project, 'bbbbbbbb', 'running');
    seed(project, 'cccccccc', 'complete');
    const { handleAbort } = require('../src/cli-handlers');
    await handleAbort({ _: ['abort'], all: true, cwd: project });
    const read = id => JSON.parse(fs.readFileSync(
      path.join(project, '.claude', 'amicus_sessions', id, 'metadata.json'), 'utf-8')).status;
    expect(read('aaaaaaaa')).toBe('aborted');
    expect(read('bbbbbbbb')).toBe('aborted');
    expect(read('cccccccc')).toBe('complete');
  });
});
```

- [ ] **Step 8: Run + commit**

Run: `npx jest tests/abort-all.test.js tests/cli.test.js`
Expected: PASS.

```bash
git add src/sidecar/read.js src/cli-handlers.js src/cli.js tests/abort-all.test.js
git commit -m "feat(f3): amicus abort --all to clear orphaned running sessions (#20)"
```

---

# PART B — Alias Correctness via Live Catalog (#18)

## Task B1: OpenRouter catalog cache

**Files:**
- Create: `src/utils/model-catalog.js`
- Test: `tests/model-catalog.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/model-catalog.test.js`:

```js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

describe('model-catalog', () => {
  let dir;
  beforeEach(() => {
    jest.resetModules();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-cat-'));
    jest.doMock('../src/utils/config', () => ({ getConfigDir: () => dir }));
    jest.doMock('../src/utils/api-key-store', () => ({ readApiKeyValues: () => ({ openrouter: 'k' }) }));
  });
  afterEach(() => { jest.dontMock('../src/utils/config'); fs.rmSync(dir, { recursive: true, force: true }); });

  test('fetches and writes the cache on a cold miss', async () => {
    jest.doMock('../src/utils/model-fetcher', () => ({
      fetchAllModels: jest.fn().mockResolvedValue([{ id: 'openrouter/openai/gpt-5.4', name: 'GPT-5.4' }]),
    }));
    const { getCatalog, catalogPath } = require('../src/utils/model-catalog');
    const models = await getCatalog();
    expect(models.some(m => m.id === 'openrouter/openai/gpt-5.4')).toBe(true);
    expect(fs.existsSync(catalogPath())).toBe(true);
  });

  test('serves fresh cache without re-fetching', async () => {
    const fetchAllModels = jest.fn().mockResolvedValue([{ id: 'openrouter/x', name: 'x' }]);
    jest.doMock('../src/utils/model-fetcher', () => ({ fetchAllModels }));
    const { getCatalog } = require('../src/utils/model-catalog');
    await getCatalog();
    await getCatalog();
    expect(fetchAllModels).toHaveBeenCalledTimes(1);
  });

  test('falls back to stale cache when a refresh returns nothing', async () => {
    const { catalogPath } = require('../src/utils/model-catalog');
    fs.writeFileSync(catalogPath(),
      JSON.stringify({ fetchedAt: 0, models: [{ id: 'openrouter/stale', name: 'stale' }] }));
    jest.doMock('../src/utils/model-fetcher', () => ({ fetchAllModels: jest.fn().mockResolvedValue([]) }));
    const { getCatalog } = require('../src/utils/model-catalog');
    const models = await getCatalog({ maxAgeMs: -1 }); // force-expire → refresh → empty → stale
    expect(models.some(m => m.id === 'openrouter/stale')).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest tests/model-catalog.test.js`
Expected: FAIL — `Cannot find module '../src/utils/model-catalog'`.

- [ ] **Step 3: Implement `src/utils/model-catalog.js`**

```js
/**
 * OpenRouter model catalog cache (F3 #18 / F5 foundation).
 *
 * Caches the combined provider model list to ~/.config/amicus/model-catalog.json
 * with a TTL so model validation doesn't hit the network on every launch.
 * Degrades gracefully: a failed/empty refresh falls back to stale cache, and
 * callers treat an empty catalog as "cannot validate" (never block a launch).
 */

const fs = require('fs');
const path = require('path');
const { getConfigDir } = require('./config');
const { readApiKeyValues } = require('./api-key-store');
const { fetchAllModels } = require('./model-fetcher');

const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h

/** @returns {string} Absolute path to the catalog cache file */
function catalogPath() {
  return path.join(getConfigDir(), 'model-catalog.json');
}

/** @returns {{fetchedAt: number, models: Array}|null} */
function readCache() {
  try {
    const raw = fs.readFileSync(catalogPath(), 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.models)) { return parsed; }
  } catch { /* missing/corrupt */ }
  return null;
}

/** Write the cache. Best-effort; never throws. @param {Array} models */
function writeCache(models) {
  try {
    fs.mkdirSync(getConfigDir(), { recursive: true, mode: 0o700 });
    // Date.now() is fine here: this is runtime, not a workflow script.
    fs.writeFileSync(catalogPath(), JSON.stringify({ fetchedAt: Date.now(), models }, null, 2), { mode: 0o600 });
  } catch { /* best-effort */ }
}

/**
 * Force a refresh from the provider APIs and update the cache.
 * @returns {Promise<Array<{id,name}>>} the fetched models (may be [] offline)
 */
async function refreshCatalog() {
  const keys = readApiKeyValues();
  const models = await fetchAllModels(keys);
  if (models && models.length > 0) { writeCache(models); }
  return models || [];
}

/**
 * Get the catalog, refreshing if the cache is missing or older than maxAgeMs.
 * Graceful: on an empty refresh, returns stale cache if present, else [].
 * @param {{maxAgeMs?: number}} [opts]
 * @returns {Promise<Array<{id,name}>>}
 */
async function getCatalog(opts = {}) {
  const maxAgeMs = opts.maxAgeMs === undefined ? DEFAULT_MAX_AGE_MS : opts.maxAgeMs;
  const cache = readCache();
  const fresh = cache && (Date.now() - cache.fetchedAt) <= maxAgeMs;
  if (fresh) { return cache.models; }

  const refreshed = await refreshCatalog();
  if (refreshed.length > 0) { return refreshed; }
  return cache ? cache.models : []; // stale fallback / empty
}

module.exports = { getCatalog, refreshCatalog, catalogPath };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest tests/model-catalog.test.js`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add src/utils/model-catalog.js tests/model-catalog.test.js
git commit -m "feat(f3): TTL'd OpenRouter model catalog cache (#18)"
```

---

## Task B2: Default-on catalog validation

**Files:**
- Modify: `src/utils/model-validator.js` (add `validateAgainstCatalog`)
- Modify: `src/utils/start-helpers.js` (`validateFallbackModel` default-on)
- Modify: `src/cli.js` (`isBooleanFlag` + usage)
- Test: `tests/model-validator.test.js` (extend), `tests/start-helpers.test.js` (create)

- [ ] **Step 1: Write the failing test for `validateAgainstCatalog`**

Create `tests/start-helpers.test.js`:

```js
'use strict';

describe('validateAgainstCatalog', () => {
  beforeEach(() => jest.resetModules());

  function mockCatalog(models) {
    jest.doMock('../src/utils/model-catalog', () => ({ getCatalog: jest.fn().mockResolvedValue(models) }));
  }

  test('passes a model present in the catalog', async () => {
    mockCatalog([{ id: 'openrouter/openai/gpt-5.3-codex', name: 'codex' }]);
    const { validateAgainstCatalog } = require('../src/utils/model-validator');
    const out = await validateAgainstCatalog('openrouter/openai/gpt-5.3-codex', 'codex', { headless: true });
    expect(out).toBe('openrouter/openai/gpt-5.3-codex');
  });

  test('throws with suggestions when an openrouter model is absent (headless)', async () => {
    mockCatalog([{ id: 'openrouter/openai/gpt-5.4', name: 'gpt' }]);
    const { validateAgainstCatalog } = require('../src/utils/model-validator');
    await expect(
      validateAgainstCatalog('openrouter/openai/ghost-model', 'gpt', { headless: true })
    ).rejects.toThrow(/not found in the OpenRouter catalog/);
  });

  test('is graceful (returns model) when the catalog is empty', async () => {
    mockCatalog([]);
    const { validateAgainstCatalog } = require('../src/utils/model-validator');
    const out = await validateAgainstCatalog('openrouter/openai/anything', 'gpt', { headless: true });
    expect(out).toBe('openrouter/openai/anything');
  });

  test('is graceful when the catalog has no openrouter entries (fetch unavailable)', async () => {
    mockCatalog([{ id: 'anthropic/claude-sonnet-4-6', name: 'Sonnet' }]);
    const { validateAgainstCatalog } = require('../src/utils/model-validator');
    const out = await validateAgainstCatalog('openrouter/openai/anything', 'gpt', { headless: true });
    expect(out).toBe('openrouter/openai/anything');
  });

  test('ignores non-openrouter models (handled by direct-API path)', async () => {
    mockCatalog([{ id: 'openrouter/openai/gpt-5.4', name: 'gpt' }]);
    const { validateAgainstCatalog } = require('../src/utils/model-validator');
    const out = await validateAgainstCatalog('openai/gpt-5.4', 'gpt', { headless: true });
    expect(out).toBe('openai/gpt-5.4');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest tests/start-helpers.test.js`
Expected: FAIL — `validateAgainstCatalog is not a function`.

- [ ] **Step 3: Implement `validateAgainstCatalog` in `src/utils/model-validator.js`**

Add this function (it reuses the existing `filterRelevantModels` in the same file) and export it:

```js
/**
 * Validate an OpenRouter-resolved model against the cached catalog (F3 #18).
 * Only enforces for `openrouter/`-prefixed models (the catalog is authoritative
 * there). Graceful when the catalog is empty/unavailable. Fails fast with
 * suggestions when the model is genuinely absent.
 *
 * @param {string} resolvedModel
 * @param {string} [alias]
 * @param {{headless?: boolean}} [options]
 * @returns {Promise<string>} the model (unchanged) when valid/unverifiable
 */
async function validateAgainstCatalog(resolvedModel, alias, options = {}) {
  if (!resolvedModel.startsWith('openrouter/')) { return resolvedModel; }

  const { getCatalog } = require('./model-catalog');
  let catalog;
  try { catalog = await getCatalog(); } catch { return resolvedModel; }
  if (!catalog || catalog.length === 0) { return resolvedModel; }

  // Only enforce when the OpenRouter catalog is actually present. If the fetch
  // was unavailable (e.g. no key reached the fetcher) the catalog won't contain
  // any openrouter/* ids — degrade gracefully instead of false-rejecting.
  if (!catalog.some(m => m.id.startsWith('openrouter/'))) { return resolvedModel; }

  if (catalog.some(m => m.id === resolvedModel)) { return resolvedModel; }

  const relevant = filterRelevantModels(catalog, alias || resolvedModel.split('/').pop());
  const list = relevant.slice(0, 10).map(m => `  ${m.id}`).join('\n');
  throw new Error(
    `Model '${resolvedModel}' not found in the OpenRouter catalog.\n` +
    (list ? `Did you mean:\n${list}\n` : '') +
    `Fix: amicus setup --add-alias ${alias || '<alias>'}=${relevant[0] ? relevant[0].id : 'openrouter/provider/model'}\n` +
    'Run \'amicus refresh-models\' to update the catalog, or pass --no-validate-model to skip.'
  );
}
```

Update the `module.exports` line to add `validateAgainstCatalog`:

```js
module.exports = { validateDirectModel, validateAgainstCatalog, filterRelevantModels, normalizeModelId };
```

- [ ] **Step 4: Run the validator test to verify it passes**

Run: `npx jest tests/start-helpers.test.js`
Expected: PASS (4 passed).

- [ ] **Step 5: Make validation default-on in `src/utils/start-helpers.js`**

Replace the entire `validateFallbackModel` function (lines 43-57) with:

```js
async function validateFallbackModel(args, alias) {
  // F3 #18: validation is default-on. --no-validate-model opts out; the old
  // opt-in --validate-model is now a no-op kept for back-compat.
  if (args['no-validate-model']) { return args.model; }

  const headless = args['no-ui'] || !process.stdin.isTTY;
  const { detectFallback } = require('./config');

  // Direct-API fallback path: keep the provider-API existence check.
  if (alias && detectFallback(alias, args.model)) {
    const { validateDirectModel } = require('./model-validator');
    try {
      return await validateDirectModel(args.model, alias, { headless });
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
  }

  // OpenRouter (and any) resolved model: validate against the live catalog.
  const { validateAgainstCatalog } = require('./model-validator');
  try {
    return await validateAgainstCatalog(args.model, alias, { headless });
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
```

- [ ] **Step 6: Register `--no-validate-model` as a boolean flag + usage**

In `src/cli.js isBooleanFlag` (the `booleanFlags` array, lines 100-113), add `'no-validate-model'`:

```js
     'validate-model',
     'no-validate-model'
```

In `getUsage()`, change the `--validate-model` line (current line 331) to:

```js
  --validate-model             (Deprecated: validation is on by default)
  --no-validate-model          Skip model-catalog validation before launch
```

- [ ] **Step 7: Add a default-on integration test for `validateFallbackModel`**

Append to `tests/start-helpers.test.js`:

```js
describe('validateFallbackModel default-on', () => {
  beforeEach(() => jest.resetModules());

  test('--no-validate-model short-circuits (no catalog call)', async () => {
    const getCatalog = jest.fn();
    jest.doMock('../src/utils/model-catalog', () => ({ getCatalog }));
    const { validateFallbackModel } = require('../src/utils/start-helpers');
    const out = await validateFallbackModel(
      { model: 'openrouter/openai/whatever', 'no-validate-model': true, 'no-ui': true }, 'gpt');
    expect(out).toBe('openrouter/openai/whatever');
    expect(getCatalog).not.toHaveBeenCalled();
  });

  test('validates against the catalog by default', async () => {
    jest.doMock('../src/utils/model-catalog', () => ({
      getCatalog: jest.fn().mockResolvedValue([{ id: 'openrouter/openai/gpt-5.4', name: 'gpt' }]),
    }));
    const { validateFallbackModel } = require('../src/utils/start-helpers');
    const out = await validateFallbackModel(
      { model: 'openrouter/openai/gpt-5.4', 'no-ui': true }, 'gpt');
    expect(out).toBe('openrouter/openai/gpt-5.4');
  });
});
```

- [ ] **Step 8: Run + commit**

Run: `npx jest tests/start-helpers.test.js tests/model-validator.test.js tests/cli.test.js`
Expected: PASS.

```bash
git add src/utils/model-validator.js src/utils/start-helpers.js src/cli.js tests/start-helpers.test.js
git commit -m "feat(f3): default-on model-catalog validation with --no-validate-model opt-out (#18)"
```

---

## Task B3: Verify-and-pin the `codex` alias

**Files:**
- Modify: `src/utils/config.js:20` (annotate; value verified valid)
- Test: `tests/codex-alias.test.js`

> Context: a live OpenRouter fetch on 2026-06-09 confirmed `openai/gpt-5.3-codex` exists and is the newest codex-specific model (no 5.4/5.5-codex). So the mapping is already valid; the durable fix is the validation from B2. This task pins that with a regression test and a dated comment.

- [ ] **Step 1: Write the failing test**

Create `tests/codex-alias.test.js`:

```js
'use strict';
const { getDefaultAliases } = require('../src/utils/config');

describe('codex alias (#18)', () => {
  test('resolves to a concrete openrouter codex model id', () => {
    const codex = getDefaultAliases().codex;
    expect(codex).toBe('openrouter/openai/gpt-5.3-codex');
  });

  test('every default alias is a fully-qualified provider/model string', () => {
    for (const [name, model] of Object.entries(getDefaultAliases())) {
      expect(typeof model).toBe('string');
      expect(model.split('/').length).toBeGreaterThanOrEqual(2);
      expect(model.endsWith('/')).toBe(false);
      expect(name).toBeTruthy();
    }
  });
});
```

- [ ] **Step 2: Run it to verify it passes or fails**

Run: `npx jest tests/codex-alias.test.js`
Expected: PASS (the value already matches). If the team later bumps `codex`, update this assertion to the new id.

- [ ] **Step 3: Annotate the alias**

In `src/utils/config.js`, change line 20 to add a dated note (value unchanged):

```js
  // codex: newest codex-specific model on OpenRouter (verified 2026-06-09).
  // Drift is caught by default-on catalog validation — see model-validator.js.
  'codex': 'openrouter/openai/gpt-5.3-codex',
```

- [ ] **Step 4: Re-run + commit**

Run: `npx jest tests/codex-alias.test.js`
Expected: PASS.

```bash
git add src/utils/config.js tests/codex-alias.test.js
git commit -m "fix(f3): pin + regression-test codex alias; validation guards drift (#18)"
```

---

## Task B4: Real `refresh-model-capabilities.js` script

**Files:**
- Create: `scripts/refresh-model-capabilities.js`
- Test: `tests/scripts/refresh-model-capabilities.test.js`

> Context: `package.json` `refresh-models`, `models:info`, `models:check` all point at this currently-missing file.

- [ ] **Step 1: Write the failing test**

Create `tests/scripts/refresh-model-capabilities.test.js`:

```js
'use strict';
const fs = require('fs');
const path = require('path');

describe('refresh-model-capabilities script', () => {
  const scriptPath = path.join(__dirname, '../../scripts/refresh-model-capabilities.js');

  test('the script file exists (npm scripts reference it)', () => {
    expect(fs.existsSync(scriptPath)).toBe(true);
  });

  test('exports runnable helpers: refresh, info, check', () => {
    const mod = require(scriptPath);
    expect(typeof mod.runRefresh).toBe('function');
    expect(typeof mod.runCheck).toBe('function');
  });

  test('runCheck flags an alias missing from the catalog', async () => {
    const mod = require(scriptPath);
    const catalog = [{ id: 'openrouter/openai/gpt-5.4', name: 'gpt' }];
    const aliases = { gpt: 'openrouter/openai/gpt-5.4', ghost: 'openrouter/openai/does-not-exist' };
    const stale = mod.findStaleAliases(aliases, catalog);
    expect(stale).toEqual([{ alias: 'ghost', model: 'openrouter/openai/does-not-exist' }]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest tests/scripts/refresh-model-capabilities.test.js`
Expected: FAIL — `Cannot find module '.../scripts/refresh-model-capabilities.js'`.

- [ ] **Step 3: Implement `scripts/refresh-model-capabilities.js`**

```js
#!/usr/bin/env node
/**
 * Refresh / inspect the OpenRouter model catalog (F3 #18, backs the
 * `refresh-models`, `models:info`, `models:check` npm scripts).
 *
 *   node scripts/refresh-model-capabilities.js          # refresh the cache
 *   node scripts/refresh-model-capabilities.js --info    # print cached models
 *   node scripts/refresh-model-capabilities.js --check    # report stale aliases
 */

const { refreshCatalog, getCatalog } = require('../src/utils/model-catalog');
const { getDefaultAliases } = require('../src/utils/config');

/** @returns {Promise<number>} count of models refreshed */
async function runRefresh() {
  const models = await refreshCatalog();
  process.stdout.write(`Refreshed catalog: ${models.length} models.\n`);
  return models.length;
}

/** Print the cached catalog. */
async function runInfo() {
  const models = await getCatalog();
  for (const m of models) { process.stdout.write(`${m.id}\n`); }
  process.stdout.write(`(${models.length} models)\n`);
}

/**
 * Find aliases whose model is absent from the catalog.
 * @param {Object<string,string>} aliases
 * @param {Array<{id:string}>} catalog
 * @returns {Array<{alias:string, model:string}>}
 */
function findStaleAliases(aliases, catalog) {
  const ids = new Set(catalog.map(m => m.id));
  const stale = [];
  for (const [alias, model] of Object.entries(aliases)) {
    if (model.startsWith('openrouter/') && !ids.has(model)) { stale.push({ alias, model }); }
  }
  return stale;
}

/** @returns {Promise<number>} number of stale aliases (process exit code) */
async function runCheck() {
  const catalog = await getCatalog();
  if (catalog.length === 0) {
    process.stdout.write('Catalog unavailable (no API key or offline); cannot check.\n');
    return 0;
  }
  const stale = findStaleAliases(getDefaultAliases(), catalog);
  if (stale.length === 0) {
    process.stdout.write('All default aliases resolve to catalog models.\n');
    return 0;
  }
  for (const s of stale) { process.stdout.write(`STALE: ${s.alias} -> ${s.model}\n`); }
  return stale.length;
}

async function main() {
  const arg = process.argv[2];
  if (arg === '--info') { await runInfo(); return 0; }
  if (arg === '--check') { return runCheck(); }
  await runRefresh();
  return 0;
}

if (require.main === module) {
  main().then((code) => process.exit(code || 0)).catch((err) => {
    process.stderr.write(`refresh-model-capabilities failed: ${err.message}\n`);
    process.exit(1);
  });
}

module.exports = { runRefresh, runInfo, runCheck, findStaleAliases };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest tests/scripts/refresh-model-capabilities.test.js`
Expected: PASS (3 passed).

- [ ] **Step 5: Smoke-test the npm script wiring**

Run: `npm run models:check`
Expected: prints either "All default aliases resolve…", "Catalog unavailable…", or a `STALE:` list — and exits without the old `MODULE_NOT_FOUND`.

- [ ] **Step 6: Commit**

```bash
git add scripts/refresh-model-capabilities.js tests/scripts/refresh-model-capabilities.test.js
git commit -m "feat(f3): real refresh-model-capabilities script backing models npm tasks (#18)"
```

---

## Final verification

- [ ] **Step 1: Run the full suite**

Run: `npm test`
Expected: GREEN — 0 failed; passed count ≥ 1625 + new tests; 5 pre-existing skips unchanged. Investigate any new failure before proceeding.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: no NEW errors beyond the known `opencode-client.js` `_t/_a/_c` baseline (≤3).

- [ ] **Step 3: Mark the spec implemented**

In `docs/superpowers/specs/2026-06-09-f3-process-and-aliases-design.md`, change the status line to `status: implemented (2026-06-09)` and add a one-line note per section. Commit with `git add -f`.

```bash
git add -f docs/superpowers/specs/2026-06-09-f3-process-and-aliases-design.md
git add docs/superpowers/plans/2026-06-09-f3-process-and-aliases.md
git commit -m "docs(f3): mark process-and-aliases spec implemented"
```

- [ ] **Step 4: Merge to main + push**

```bash
git checkout main && git merge --ff-only f3/process-and-aliases && git push origin main
git branch -d f3/process-and-aliases
```

---

## Self-Review notes (for the planner)

- **Spec coverage:** #15 → A1 (cross-platform reap) + A2 (force-exit net). #20 → A3 (signal abort) + A4 (`abort --all`). #18 → B1 (cache) + B2 (default-on validation) + B3 (codex) + B4 (refresh script). Cross-platform server kill (spec §4.1/§5) → A1. Windows-kill risk (spec §7) → validated by `tests/cli-process.integration.test.js` at execution.
- **Open risk carried into execution:** confirm how Claude Code's background-task kill terminates on Windows (SIGTERM vs taskkill tree). If it sends an untrappable kill, A3's handlers won't fire and the `goPid`-in-metadata + `checkSessionLiveness` path (A3 Step 5) is the fallback for `list` orphan visibility; note it in the spec if confirmed.
- **Type consistency:** `server.goPid` (A1) is read by A3 Step 5 and `checkSessionLiveness`. `markAborted(sessionDir, reason)` (A3) is reused by A4 and `handleAbort`. `enumerateSessions(project, {status})` (A4) returns `{id,...}` consumed by the `--all` loop. `getCatalog()` (B1) → `validateAgainstCatalog` (B2) → `validateFallbackModel` (B2) and the refresh script (B4). All consistent.
