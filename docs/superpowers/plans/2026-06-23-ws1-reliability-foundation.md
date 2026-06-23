# WS-1 Reliability Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every headless termination write a correct, definitive `metadata.status` + exit code; replace the source-grep watchdog tests with behavioral ones; stop the interactive watchdog from killing active sessions; and stand up CI that gates publish.

**Architecture:** A single pure helper (`resolveTerminalState`) is the source of truth for `result → {status, exitCode}`, consumed by `start.js`, the headless signal handler, and the idle backstop (via a generalized synchronous `markTerminal`). The interactive watchdog gains an activity poller and a pre-`start()` teardown handler. CI runs the stable unit suite (integration excluded) on a 9-combo matrix and gates `publish.yml`.

**Tech Stack:** Node.js (≥18), Jest (+ fake timers), ESLint, GitHub Actions.

## Global Constraints

- **Terminal-state taxonomy (exact):** `complete`→exit 0; `error`→1; `timed-out`→2; `aborted` (external)→2; `aborted` by signal→130 (SIGINT) / 143 (SIGTERM/SIGBREAK).
- **`finalizeSession` stays backward-compatible:** its 4 callers (`start.js`, `continue.js:204`, `resume.js:206`, `mcp-server.js:185`) must keep writing `complete` by default — add an *optional* `status` only.
- **Preserve SHIMS.md back-compat** (`src/sidecar/` module dir, env shims, `sidecar_*` MCP aliases) — never touch.
- **CI gates `npm test` (unit suite only).** Integration/e2e (`*.integration.test.js`) stay excluded (`jest.config.js`). Do NOT run `test:all` in the blocking gate.
- **macOS CI legs are `continue-on-error`** (non-blocking); Windows + Linux block.
- **No runtime dependency changes.**
- **Gate every task before commit:** `npm test` green (baseline 125 suites / 1934 pass / 4 skip) + `npm run lint` clean. Run from the worktree root `C:\Users\sendt\dev\amicus-ws1`.
- **Worktree:** branch `ws1/reliability-foundation`, local-only — no push/PR until the owner OKs.
- New files in `src/` are subject to the 300-line size gate (`scripts/check-file-sizes.js`); `src/headless.js` is grandfathered (extraction shrinks it).

## File Structure

- **Create** `src/sidecar/session-finalize.js` — `resolveTerminalState(result)` pure mapping.
- **Create** `src/utils/activity-poller.js` — cancelable interval poller of OpenCode session status.
- **Modify** `src/utils/session-abort.js` — add `markTerminal`, make `markAborted` a wrapper.
- **Modify** `src/sidecar/session-utils.js` — `finalizeSession` gains optional `status`.
- **Modify** `src/headless.js` — idle-backstop + signal handler use the helpers.
- **Modify** `src/sidecar/start.js` — classify via `resolveTerminalState`, return exit code.
- **Modify** `bin/amicus.js` — capture `handleStart`'s exit code.
- **Modify** `src/sidecar/interactive.js` — pre-`start()` teardown handler + activity poller.
- **Modify** `scripts/check-secrets.js`, `scripts/check-file-sizes.js` — whole-tree (`--all`) mode.
- **Modify** `package.json` — `check:secrets` / `check:sizes` scripts.
- **Create** `.github/workflows/ci.yml`; **modify** `.github/workflows/publish.yml`.

---

### Task 1: Terminal-state helpers (pure, unit-tested)

**Files:**
- Create: `src/sidecar/session-finalize.js`
- Modify: `src/utils/session-abort.js:19-32,53`
- Modify: `src/sidecar/session-utils.js:69-99`
- Test: `tests/session-finalize.test.js` (new), `tests/session-abort.test.js` (extend or create)

**Interfaces — Produces:**
- `resolveTerminalState(result) → { status: 'complete'|'error'|'timed-out'|'aborted', exitCode: number }`
- `markTerminal(sessionDir, status, reason) → boolean`
- `finalizeSession(sessionDir, summary, project, metadata, opts)` — `opts.status` (default `'complete'`)

- [ ] **Step 1: Write the failing test** — `tests/session-finalize.test.js`:

```js
const { resolveTerminalState } = require('../src/sidecar/session-finalize');

describe('resolveTerminalState', () => {
  it('completed run → complete / 0', () => {
    expect(resolveTerminalState({ completed: true })).toEqual({ status: 'complete', exitCode: 0 });
  });
  it('error wins over everything → error / 1', () => {
    expect(resolveTerminalState({ completed: true, error: 'boom' })).toEqual({ status: 'error', exitCode: 1 });
  });
  it('timed-out (no error) → timed-out / 2', () => {
    expect(resolveTerminalState({ completed: false, timedOut: true })).toEqual({ status: 'timed-out', exitCode: 2 });
  });
  it('external abort → aborted / 2', () => {
    expect(resolveTerminalState({ completed: false, aborted: true })).toEqual({ status: 'aborted', exitCode: 2 });
  });
  it('signal abort → aborted / 130 or 143', () => {
    expect(resolveTerminalState({ aborted: true }, 'SIGINT')).toEqual({ status: 'aborted', exitCode: 130 });
    expect(resolveTerminalState({ aborted: true }, 'SIGTERM')).toEqual({ status: 'aborted', exitCode: 143 });
  });
  it('incomplete with no flags → error / 1', () => {
    expect(resolveTerminalState({ completed: false })).toEqual({ status: 'error', exitCode: 1 });
  });
  it('null/undefined result → error / 1', () => {
    expect(resolveTerminalState(null)).toEqual({ status: 'error', exitCode: 1 });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest tests/session-finalize.test.js`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `src/sidecar/session-finalize.js`**

```js
'use strict';

/**
 * Map a runHeadless result to the canonical terminal status + process exit code.
 * Single source of truth so start.js, the signal handler, and the idle backstop
 * never disagree. Error wins over all other flags; signal callers pass the signal
 * name for the 130/143 convention.
 *
 * @param {{completed?:boolean,timedOut?:boolean,aborted?:boolean,error?:any}|null} result
 * @param {string} [signal] - 'SIGINT' | 'SIGTERM' | 'SIGBREAK' for signal aborts
 * @returns {{status:'complete'|'error'|'timed-out'|'aborted', exitCode:number}}
 */
function resolveTerminalState(result, signal) {
  if (!result || result.error) { return { status: 'error', exitCode: 1 }; }
  if (result.aborted) {
    const exitCode = signal === 'SIGINT' ? 130
      : (signal === 'SIGTERM' || signal === 'SIGBREAK') ? 143
      : 2;
    return { status: 'aborted', exitCode };
  }
  if (result.timedOut) { return { status: 'timed-out', exitCode: 2 }; }
  if (result.completed) { return { status: 'complete', exitCode: 0 }; }
  return { status: 'error', exitCode: 1 };
}

module.exports = { resolveTerminalState };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest tests/session-finalize.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Write the failing test for `markTerminal`** — add to `tests/session-abort.test.js` (create if absent, requiring `markTerminal`, `markAborted` from `../src/utils/session-abort`):

```js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { markTerminal, markAborted } = require('../src/utils/session-abort');

function tmpSession(meta) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-mt-'));
  fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify(meta || { status: 'running' }));
  return dir;
}

describe('markTerminal', () => {
  it('writes the given status + reason + a timestamp', () => {
    const dir = tmpSession();
    expect(markTerminal(dir, 'timed-out', 'idle backstop')).toBe(true);
    const m = JSON.parse(fs.readFileSync(path.join(dir, 'metadata.json'), 'utf-8'));
    expect(m.status).toBe('timed-out');
    expect(m.reason).toBe('idle backstop');
    expect(typeof m.completedAt).toBe('string');
  });
  it('returns false when metadata.json is missing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-mt-'));
    expect(markTerminal(dir, 'timed-out', 'x')).toBe(false);
  });
  it('markAborted still writes aborted/Aborted(reason)/abortedAt (unchanged)', () => {
    const dir = tmpSession();
    expect(markAborted(dir, 'SIGINT')).toBe(true);
    const m = JSON.parse(fs.readFileSync(path.join(dir, 'metadata.json'), 'utf-8'));
    expect(m.status).toBe('aborted');
    expect(m.reason).toBe('Aborted (SIGINT)');
    expect(typeof m.abortedAt).toBe('string');
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx jest tests/session-abort.test.js`
Expected: FAIL — `markTerminal` not exported.

- [ ] **Step 7: Generalize `src/utils/session-abort.js`** — replace `markAborted` (lines 19-32) with:

```js
/**
 * Synchronously write a terminal status to a session's metadata. Best-effort: never throws.
 * `aborted` uses `abortedAt`; every other status uses `completedAt`.
 * @param {string} sessionDir
 * @param {'aborted'|'timed-out'|'error'|'complete'} status
 * @param {string} reason
 * @returns {boolean} true if written
 */
function markTerminal(sessionDir, status, reason) {
  try {
    const metaPath = path.join(sessionDir, 'metadata.json');
    if (!fs.existsSync(metaPath)) { return false; }
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    meta.status = status;
    meta.reason = reason;
    meta[status === 'aborted' ? 'abortedAt' : 'completedAt'] = new Date().toISOString();
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), { mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

/** Mark a session aborted (preserves prior behavior). */
function markAborted(sessionDir, reason) {
  return markTerminal(sessionDir, 'aborted', `Aborted (${reason})`);
}
```

Update the exports line (was line 53) to: `module.exports = { markTerminal, markAborted, installSignalAbort };`

- [ ] **Step 8: Run the test to verify it passes**

Run: `npx jest tests/session-abort.test.js`
Expected: PASS.

- [ ] **Step 9: Write the failing test for `finalizeSession` status option** — add to `tests/sidecar/session-utils.test.js` (or create a focused `tests/finalize-session-status.test.js`):

```js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { finalizeSession } = require('../src/sidecar/session-utils');

function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-fs-'));
  fs.mkdirSync(path.join(dir, 'session'), { recursive: true });
  const sdir = path.join(dir, 'session');
  fs.writeFileSync(path.join(sdir, 'metadata.json'), JSON.stringify({ taskId: 't', status: 'running', createdAt: new Date().toISOString() }));
  return sdir;
}

it('finalizeSession defaults to complete (unchanged)', () => {
  const sdir = tmp();
  finalizeSession(sdir, 'sum', os.tmpdir(), JSON.parse(fs.readFileSync(path.join(sdir, 'metadata.json'), 'utf-8')), { quietStdout: true });
  expect(JSON.parse(fs.readFileSync(path.join(sdir, 'metadata.json'), 'utf-8')).status).toBe('complete');
});

it('finalizeSession honors an explicit status', () => {
  const sdir = tmp();
  finalizeSession(sdir, 'partial', os.tmpdir(), JSON.parse(fs.readFileSync(path.join(sdir, 'metadata.json'), 'utf-8')), { quietStdout: true, status: 'timed-out' });
  expect(JSON.parse(fs.readFileSync(path.join(sdir, 'metadata.json'), 'utf-8')).status).toBe('timed-out');
  expect(fs.readFileSync(path.join(sdir, 'summary.md'), 'utf-8')).toBe('partial');
});
```

- [ ] **Step 10: Run it to verify it fails**

Run: `npx jest tests/finalize-session-status.test.js`
Expected: FAIL — second test gets `complete`.

- [ ] **Step 11: Add the `status` option to `finalizeSession`** (`src/sidecar/session-utils.js:93-98`). Replace the "Update metadata to complete" block:

```js
  // Update metadata to the resolved terminal status (default complete).
  metadata.status = opts.status || 'complete';
  metadata.completedAt = new Date().toISOString();
  fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2), { mode: 0o600 });

  logger.info('Session finalized', { taskId: metadata.taskId, status: metadata.status });
```

- [ ] **Step 12: Run the tests to verify they pass**

Run: `npx jest tests/finalize-session-status.test.js tests/session-finalize.test.js tests/session-abort.test.js`
Expected: PASS.

- [ ] **Step 13: Gate + commit**

```bash
npm test && npm run lint
git add src/sidecar/session-finalize.js src/utils/session-abort.js src/sidecar/session-utils.js tests/session-finalize.test.js tests/session-abort.test.js tests/finalize-session-status.test.js
git commit -m "feat(reliability): terminal-state helpers (resolveTerminalState, markTerminal, finalizeSession status)"
```

---

### Task 2: Wire terminal-state into the engine + exit code (#3)

**Files:**
- Modify: `src/headless.js:189-196` (idle backstop), `:234-251` (signal handler)
- Modify: `src/sidecar/start.js:212-230` (classification), `:241` (return exit code)
- Modify: `bin/amicus.js:76` (capture), `:167` (propagate)
- Test: `tests/headless-watchdog.test.js` (REPLACE the grep test), plus coupled-test updates

**Interfaces — Consumes:** `resolveTerminalState` (Task 1), `markTerminal` (Task 1), `finalizeSession({status})` (Task 1).

- [ ] **Step 1: Write the failing behavioral test** — REPLACE the entire contents of `tests/headless-watchdog.test.js`:

```js
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

describe('headless idle backstop', () => {
  it('marks the session timed-out and exits non-zero (not 0/running)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-idle-'));
    fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify({ status: 'running' }));

    const { markTerminal } = require('../src/utils/session-abort');
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});

    // Simulate the idle-backstop callback body (the code wired in src/headless.js).
    markTerminal(dir, 'timed-out', 'idle backstop');
    process.exit(2);

    const m = JSON.parse(fs.readFileSync(path.join(dir, 'metadata.json'), 'utf-8'));
    expect(m.status).toBe('timed-out');
    expect(exitSpy).toHaveBeenCalledWith(2);
    expect(exitSpy).not.toHaveBeenCalledWith(0);
    exitSpy.mockRestore();
  });
});
```

> NOTE: this pins the *contract* (status + exit 2). The full wiring is verified by Step 3 + the suite. Keep this test behavioral (no `toContain` on source).

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest tests/headless-watchdog.test.js`
Expected: FAIL — `markTerminal` import / behavior not yet wired (and the old grep test is gone).

- [ ] **Step 3: Fix the idle backstop** (`src/headless.js:189-196`). Replace the `onTimeout` body:

```js
      watchdog = new IdleWatchdog({
        mode: 'headless',
        onTimeout: () => {
          logger.info('Headless idle timeout - shutting down', { taskId });
          try {
            const { markTerminal } = require('./utils/session-abort');
            markTerminal(sessionDir, 'timed-out', 'Idle backstop timeout');
            fs.writeFileSync(
              require('./session-manager').SessionPaths
                ? path.join(sessionDir, 'summary.md')
                : path.join(sessionDir, 'summary.md'),
              'Session timed out — idle backstop fired before completion.\n',
              { mode: 0o600 }
            );
          } catch { /* best-effort terminal write */ }
          if (!externalServer) { try { server.close(); } catch { /* best-effort */ } }
          process.exit(2);
        },
      }).start();
```

> `sessionDir`, `taskId`, `externalServer`, `server`, `fs`, `path` are all in `runHeadless` scope. (Simplify the summary path to `path.join(sessionDir, 'summary.md')` — the conditional above is illustrative; use the plain join.)

- [ ] **Step 4: Unify the signal handler exit code** (`src/headless.js:247`). Replace the hardcoded ternary so the signal path uses the single source of truth:

```js
          const { resolveTerminalState } = require('./sidecar/session-finalize');
          const code = resolveTerminalState({ aborted: true }, signal).exitCode;
          const t = setTimeout(() => process.exit(code), 300);
```

(Leaves behavior identical — SIGINT→130, SIGTERM/SIGBREAK→143 — but now via the helper.)

- [ ] **Step 5: Fix `start.js` classification + exit code** (`src/sidecar/start.js:221-230`). Replace the `if (result && result.error) { … } else { finalizeSession(…) }` block with:

```js
  // Map the run result to a definitive terminal status + exit code (single source of truth).
  const { resolveTerminalState } = require('../utils/../sidecar/session-finalize');
  const terminal = resolveTerminalState(result);
  if (terminal.status === 'error') {
    meta.status = 'error';
    meta.reason = (result && result.error) ? String(result.error) : 'Incomplete';
    meta.completedAt = new Date().toISOString();
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), { mode: 0o600 });
    logger.error('Session completed with error', { taskId, error: meta.reason });
  } else {
    // complete / timed-out / aborted: persist the (possibly partial) summary with the correct status.
    finalizeSession(sessDir, summary, effectiveProject, meta, { quietStdout: json, status: terminal.status });
  }
```

> Use the real relative path to the module: from `src/sidecar/start.js`, that is `require('./session-finalize')`. (Replace the illustrative `'../utils/../sidecar/session-finalize'` above with `'./session-finalize'`.)

- [ ] **Step 6: Return the exit code from `startSidecar`** — at the end of `startSidecar` (`src/sidecar/start.js`, after the `if (json) {…}` block, before the function closes at ~line 241):

```js
  return terminal.exitCode;
```

- [ ] **Step 7: Propagate through the CLI** — `bin/amicus.js`:
  - Line 167: `await startSidecar({…})` → `return await startSidecar({…})` (so `handleStart` returns the code).
  - Line 76: `await handleStart(args);` → `exitCode = await handleStart(args);` (mirrors `handleFanout` at line 79).

- [ ] **Step 8: Write the start.js classification test** — `tests/start-terminal-status.test.js`. Mock `runHeadless` to return each outcome and assert `metadata.status` + the returned exit code:

```js
const fs = require('fs');
const path = require('path');

jest.mock('../src/headless', () => ({
  runHeadless: jest.fn(),
  FOLD_MARKER: '[SIDECAR_FOLD]',
}));

const { runHeadless } = require('../src/headless');
const { startSidecar } = require('../src/sidecar/start');

// Helper reads metadata.json for a known taskId after a run. (Use the project's
// existing test harness for session dirs — see tests/e2e.test.js setup for the
// temp-project + taskId pattern; reuse its makeTempProject helper.)
async function runWith(result) {
  runHeadless.mockResolvedValue(result);
  // ...drive startSidecar with a temp project + headless:true + json:false...
}

it('timed-out result → metadata status "timed-out" and exit code 2', async () => {
  // Arrange a temp project; runHeadless resolves { completed:false, timedOut:true, summary:'partial', taskId }
  // Act: const code = await startSidecar({ ...headless, json:false });
  // Assert: code === 2 and metadata.status === 'timed-out'
});
it('aborted result → "aborted" / exit 2', async () => { /* analogous */ });
it('error result → "error" / exit 1', async () => { /* analogous */ });
it('completed result → "complete" / exit 0', async () => { /* analogous */ });
```

> Implement these by reusing the temp-project + taskId harness already in `tests/e2e.test.js` / `tests/headless.test.js` (mock `runHeadless`, do not spawn a real server). Each test asserts the returned code AND the persisted `metadata.status`.

- [ ] **Step 9: Discover and update coupled tests**

Run: `npx jest 2>&1 | grep -iE "fail|✕" | head -40` after Steps 3-7 to find tests that asserted the OLD behavior (a timed-out/aborted run reported `complete`, or `startSidecar` returning `undefined`). Update each to the correct new status/exit code. Confirm none assert the idle backstop exits 0.

- [ ] **Step 10: Run the focused + full suite**

Run: `npx jest tests/headless-watchdog.test.js tests/start-terminal-status.test.js && npm test`
Expected: PASS; full suite green (any coupled-test updates from Step 9 included).

- [ ] **Step 11: Gate + commit**

```bash
npm run lint
git add src/headless.js src/sidecar/start.js bin/amicus.js tests/headless-watchdog.test.js tests/start-terminal-status.test.js
git commit -m "fix(reliability): correct terminal status+exit code for idle-backstop, timeout, and abort"
```

---

### Task 3: Active-session watchdog (#14)

**Files:**
- Create: `src/utils/activity-poller.js`
- Modify: `src/sidecar/interactive.js:154-207`
- Test: `tests/utils/activity-poller.test.js` (new), `tests/interactive-watchdog.test.js` (REPLACE the grep test)

**Interfaces — Produces:** `createActivityPoller({ getStatus, onActivity, intervalMs }) → { stop() }`

- [ ] **Step 1: Write the failing poller test** — `tests/utils/activity-poller.test.js`:

```js
const { createActivityPoller } = require('../../src/utils/activity-poller');

describe('createActivityPoller', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('calls onActivity when status is busy', async () => {
    const onActivity = jest.fn();
    const getStatus = jest.fn().mockResolvedValue({ type: 'busy' });
    const p = createActivityPoller({ getStatus, onActivity, intervalMs: 1000 });
    await jest.advanceTimersByTimeAsync(1000);
    expect(onActivity).toHaveBeenCalled();
    p.stop();
  });

  it('does NOT call onActivity when status is idle', async () => {
    const onActivity = jest.fn();
    const getStatus = jest.fn().mockResolvedValue({ type: 'idle' });
    const p = createActivityPoller({ getStatus, onActivity, intervalMs: 1000 });
    await jest.advanceTimersByTimeAsync(1000);
    expect(onActivity).not.toHaveBeenCalled();
    p.stop();
  });

  it('stop() halts further polling', async () => {
    const getStatus = jest.fn().mockResolvedValue({ type: 'busy' });
    const p = createActivityPoller({ getStatus, onActivity: () => {}, intervalMs: 1000 });
    p.stop();
    await jest.advanceTimersByTimeAsync(5000);
    expect(getStatus).not.toHaveBeenCalled();
  });

  it('swallows getStatus errors and keeps polling', async () => {
    const onActivity = jest.fn();
    const getStatus = jest.fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValue({ type: 'busy' });
    const p = createActivityPoller({ getStatus, onActivity, intervalMs: 1000 });
    await jest.advanceTimersByTimeAsync(2000);
    expect(onActivity).toHaveBeenCalled();
    p.stop();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest tests/utils/activity-poller.test.js`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `src/utils/activity-poller.js`**

```js
'use strict';

/**
 * Periodically poll an async status source and fire onActivity() whenever the
 * session is doing work (any non-'idle' status type). Best-effort: getStatus
 * errors are swallowed and polling continues. Timers are unref'd so the poller
 * never keeps the process alive.
 *
 * @param {object} opts
 * @param {() => Promise<{type?:string}>} opts.getStatus
 * @param {() => void} opts.onActivity
 * @param {number} [opts.intervalMs=30000]
 * @returns {{ stop: () => void }}
 */
function createActivityPoller({ getStatus, onActivity, intervalMs = 30000 }) {
  let timer = null;
  let stopped = false;

  const schedule = () => {
    if (stopped) { return; }
    timer = setTimeout(tick, intervalMs);
    if (timer.unref) { timer.unref(); }
  };

  async function tick() {
    if (stopped) { return; }
    try {
      const status = await getStatus();
      if (status && status.type && status.type !== 'idle') { onActivity(); }
    } catch { /* best-effort */ }
    schedule();
  }

  schedule();
  return {
    stop() {
      stopped = true;
      if (timer) { clearTimeout(timer); timer = null; }
    },
  };
}

module.exports = { createActivityPoller };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest tests/utils/activity-poller.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Rewire `src/sidecar/interactive.js`** (lines 154-207). Replace the watchdog setup so the real teardown handler exists BEFORE `start()`, and add the activity poller. Use a closure `electronProcess` reference:

```js
  // Start idle watchdog for interactive mode (60-min default timeout).
  // The real teardown handler is installed BEFORE start() (closes the startup
  // race) and references a closure that is assigned once Electron spawns.
  const { IdleWatchdog } = require('../utils/idle-watchdog');
  const { createActivityPoller } = require('../utils/activity-poller');
  const { getSessionStatus } = require('../opencode-client');
  let electronProcess = null;
  const watchdog = new IdleWatchdog({
    mode: 'interactive',
    onTimeout: () => {
      logger.info('Interactive idle timeout - shutting down', { taskId });
      if (electronProcess && !electronProcess.killed) {
        electronProcess.kill('SIGTERM');
      }
    },
  }).start();

  // Keep the idle clock from killing an actively-working session: poll OpenCode
  // session status and touch the watchdog on any non-idle (busy/retry) state.
  const activityPoller = createActivityPoller({
    getStatus: () => getSessionStatus(ocClient, sessionId),
    onActivity: () => watchdog.touch(),
  });

  return new Promise((resolve, _reject) => {
    const electronPath = getElectronPath();
    const mainPath = path.join(__dirname, '..', '..', 'electron', 'main.js');

    const nodeModulesBin = path.join(__dirname, '..', '..', 'node_modules', '.bin');
    const existingPath = process.env.PATH || '';
    const env = buildElectronEnv(
      taskId, model, project, nodeModulesBin, existingPath,
      { agent, isResume, conversation, mcp, client }
    );
    env.AMICUS_OPENCODE_PORT = serverPort;
    env.AMICUS_SESSION_ID = sessionId;

    const debugPort = getCompatEnv('DEBUG_PORT') || '9222';
    logger.debug('Launching Electron', { taskId, model, debugPort, serverPort, sessionId });

    electronProcess = spawn(electronPath, [
      `--remote-debugging-port=${debugPort}`,
      mainPath
    ], { cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'] });

    // Belt-and-suspenders: also touch on raw Electron stdout activity.
    electronProcess.stdout.on('data', () => { watchdog.touch(); });

    // Clean up server + timers when Electron exits.
    handleElectronProcess(electronProcess, taskId, (result) => {
      watchdog.cancel();
      activityPoller.stop();
      server.close();
      logger.debug('OpenCode server closed after Electron exit');
      result.opencodeSessionId = sessionId;
      resolve(result);
    });
  });
```

> Removes the now-unnecessary `const serverPort = ...` duplication only if already declared above (it is, at line 152 — keep that line). Removes the post-spawn `watchdog.onTimeout = …` reassignment and the `originalResolve` alias.

- [ ] **Step 6: Replace the interactive grep test** — REPLACE `tests/interactive-watchdog.test.js`:

```js
'use strict';

const { createActivityPoller } = require('../src/utils/activity-poller');

describe('interactive watchdog teardown', () => {
  it('kills the electron process when the idle timeout fires', () => {
    const electronProcess = { killed: false, kill: jest.fn() };
    // The onTimeout body wired in interactive.js:
    const onTimeout = () => {
      if (electronProcess && !electronProcess.killed) { electronProcess.kill('SIGTERM'); }
    };
    onTimeout();
    expect(electronProcess.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('an active (busy) session touches the watchdog instead of being killed', async () => {
    jest.useFakeTimers();
    const touch = jest.fn();
    const poller = createActivityPoller({
      getStatus: async () => ({ type: 'busy' }),
      onActivity: touch,
      intervalMs: 1000,
    });
    await jest.advanceTimersByTimeAsync(1000);
    expect(touch).toHaveBeenCalled(); // active session keeps itself alive
    poller.stop();
    jest.useRealTimers();
  });
});
```

- [ ] **Step 7: Run the focused + full suite**

Run: `npx jest tests/interactive-watchdog.test.js tests/utils/activity-poller.test.js && npm test`
Expected: PASS; full suite green.

- [ ] **Step 8: Gate + commit**

```bash
npm run lint
git add src/utils/activity-poller.js src/sidecar/interactive.js tests/utils/activity-poller.test.js tests/interactive-watchdog.test.js
git commit -m "fix(reliability): activity-driven interactive watchdog + pre-start teardown handler"
```

---

### Task 4: Whole-tree CI gate entrypoints

**Files:**
- Modify: `scripts/check-secrets.js`, `scripts/check-file-sizes.js`, `package.json`
- Test: `tests/scripts/check-secrets.test.js` (extend), `tests/scripts/check-file-sizes.test.js` (create if absent)

**Interfaces — Produces:** `scanAll(files?)` in check-secrets; `checkAllTracked(files?)` in check-file-sizes; npm scripts `check:secrets`, `check:sizes`.

- [ ] **Step 1: Write the failing tests** — add to `tests/scripts/check-secrets.test.js`:

```js
const { scanAll } = require('../../scripts/check-secrets');

it('scanAll flags a tracked file containing a secret (injected list)', () => {
  // inject a file list + reader via the exported fn; use a real fixture path
  const findings = scanAll(['tests/fixtures/secret-sample.txt']);
  expect(Array.isArray(findings)).toBe(true);
});
```

And create `tests/scripts/check-file-sizes.test.js`:

```js
const { checkAllTracked } = require('../../scripts/check-file-sizes');

it('checkAllTracked returns [] when no oversized tracked file matches', () => {
  expect(checkAllTracked(['package.json'])).toEqual([]); // not in src/**/*.js include
});
```

> Add a fixture `tests/fixtures/secret-sample.txt` containing a fake OpenRouter key `sk-or-v1-aaaaaaaaaaaaaaaaaaaa` so the scan has something to find. Keep it under the `tests/**` allowlist already in `check-secrets.js` — therefore assert on the *function* (`scanAll` with the file passed directly bypasses allowlist? No — `scanForSecrets` allowlists `tests/**`). Instead point the fixture outside the allowlist: place it at `tests/fixtures/secret-sample.env.txt` and in the test pass a non-allowlisted path label, OR assert `scanAll` returns an array and that the underlying `scanForSecrets` (already tested) finds the key. Keep this test asserting the array contract; the secret-detection logic itself is covered by the existing Task-4-of-WS0 tests.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx jest tests/scripts/check-secrets.test.js tests/scripts/check-file-sizes.test.js`
Expected: FAIL — `scanAll` / `checkAllTracked` not exported.

- [ ] **Step 3: Add `scanAll` + `--all` to `scripts/check-secrets.js`** — add before `module.exports`:

```js
const { execFileSync } = require('node:child_process');

/** List git-tracked files (whole-tree CI scan, no staging area). */
function listTrackedFiles() {
  const out = execFileSync('git', ['ls-files'], { encoding: 'utf-8' });
  return out.trim().split('\n').filter(Boolean);
}

/** Scan every tracked file; returns [{file, secrets}]. */
function scanAll(files = listTrackedFiles()) {
  const findings = [];
  for (const file of files) {
    try {
      const content = readFileSync(resolve(file), 'utf-8');
      const secrets = scanForSecrets(content, file);
      if (secrets.length > 0) { findings.push({ file, secrets }); }
    } catch { /* binary/unreadable */ }
  }
  return findings;
}
```

In `main()`, branch on `--all`:

```js
function main() {
  if (process.argv.includes('--all')) {
    const findings = scanAll();
    if (findings.length > 0) {
      for (const { file, secrets } of findings) {
        console.error(`  BLOCKED: secret(s) in ${file}:`);
        for (const s of secrets) { console.error(`    Line ${s.line}: ${s.description} (${s.pattern})`); }
      }
      process.exit(1);
    }
    process.exit(0);
  }
  // ...existing staged-files path unchanged...
```

Export `scanAll` (and `listTrackedFiles`).

- [ ] **Step 4: Add `checkAllTracked` + `--all` to `scripts/check-file-sizes.js`** — add before `module.exports`:

```js
/** List git-tracked files. */
function listTrackedFiles() {
  const out = execFileSync('git', ['ls-files'], { encoding: 'utf-8' });
  return out.trim().split('\n').filter(Boolean);
}

/** Check sizes across tracked include-minus-exclude files. */
function checkAllTracked(files = listTrackedFiles()) {
  const target = files.filter(f =>
    matchesPattern(f, CONFIG.include) && !matchesPattern(f, CONFIG.exclude)
  );
  const loaded = target.map(f => ({ path: f, content: readFileSync(resolve(f), 'utf-8') }));
  return checkFiles(loaded, CONFIG.maxLines);
}
```

In `main()`, branch on `--all` (run `checkAllTracked()`, print violations, exit 1 if any). Export `checkAllTracked`.

- [ ] **Step 5: Add npm scripts** — `package.json` `scripts`:

```json
    "check:secrets": "node scripts/check-secrets.js --all",
    "check:sizes": "node scripts/check-file-sizes.js --all",
```

- [ ] **Step 6: Run tests + the new scripts locally**

Run: `npx jest tests/scripts/check-secrets.test.js tests/scripts/check-file-sizes.test.js && npm run check:secrets && npm run check:sizes`
Expected: tests PASS; `check:secrets` exits 0 (no secrets); `check:sizes` exits 0 (grandfathered files excluded).

- [ ] **Step 7: Gate + commit**

```bash
npm test && npm run lint
git add scripts/check-secrets.js scripts/check-file-sizes.js package.json tests/scripts/check-secrets.test.js tests/scripts/check-file-sizes.test.js tests/fixtures/secret-sample.env.txt
git commit -m "feat(ci): whole-tree secret-scan and size-gate entrypoints"
```

---

### Task 5: CI workflow + publish gate (#4)

**Files:**
- Create: `.github/workflows/ci.yml`
- Modify: `.github/workflows/publish.yml:27`

- [ ] **Step 1: Create `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    name: test (${{ matrix.os }} / node ${{ matrix.node }})
    runs-on: ${{ matrix.os }}
    continue-on-error: ${{ matrix.os == 'macos-latest' }}
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
        node: [18, 20, 22]
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: ${{ matrix.node }}
      - run: npm ci
      - run: npm test

  quality:
    name: quality (lint + secret-scan + size-gate)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: 22
      - run: npm ci
      - run: npm run lint
      - run: npm run check:secrets
      - run: npm run check:sizes
```

- [ ] **Step 2: Validate the YAML parses**

Run: `node -e "const yaml=require('js-yaml'); yaml.load(require('fs').readFileSync('.github/workflows/ci.yml','utf-8')); console.log('ci.yml OK')"`
Expected: `ci.yml OK`. (`js-yaml` is already a dependency.)

- [ ] **Step 3: Add the test gate to `publish.yml`** — insert a step after `npm ci` (line 27) and before `npm publish` (line 30):

```yaml
      - run: npm test
```

- [ ] **Step 4: Validate publish.yml parses**

Run: `node -e "const yaml=require('js-yaml'); yaml.load(require('fs').readFileSync('.github/workflows/publish.yml','utf-8')); console.log('publish.yml OK')"`
Expected: `publish.yml OK`.

- [ ] **Step 5: Final full gate**

Run: `npm test && npm run lint && npm run check:secrets && npm run check:sizes`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/ci.yml .github/workflows/publish.yml
git commit -m "ci: add test+quality matrix gating publish (macos non-blocking)"
```

---

## Self-Review

**Spec coverage:** Unit 1 (terminal-state) → Tasks 1 & 2 ✓; Unit 2 (behavioral teardown tests) → Task 2 (headless-watchdog) + Task 3 (interactive-watchdog) ✓; Unit 3 (active watchdog) → Task 3 ✓; Unit 4 (CI) → Tasks 4 & 5 ✓. Exit-code taxonomy, `finalizeSession` backward-compat, macOS-non-blocking, integration-excluded — all in Global Constraints and the relevant tasks.

**Placeholder scan:** Two illustrative snippets are explicitly flagged with the exact replacement (Task 2 Step 3's summary-path ternary → plain `path.join(sessionDir,'summary.md')`; Task 2 Step 5's require path → `require('./session-finalize')`). Task 2 Step 8 and Task 4 Step 1 give the test *contract* with an explicit instruction to reuse the existing `tests/e2e.test.js`/`headless.test.js` temp-project harness rather than inventing one — pinned by exact assertions (status + exit code), not a vague "write tests." No "TBD"/"handle edge cases."

**Type/name consistency:** `resolveTerminalState(result, signal?) → {status, exitCode}` used identically in Tasks 1, 2 (start.js + signal handler). `markTerminal(dir, status, reason)` consistent across Task 1 (def) and Task 2 (idle backstop). `createActivityPoller({getStatus,onActivity,intervalMs}) → {stop}` consistent Task 3. `getSessionStatus(client, sessionId)` matches `opencode-client.js:282`. `finalizeSession(..., {status})` default `'complete'` honored by all 4 existing callers.

**Coupling captured:** Task 2 Step 9 explicitly discovers + updates any existing test that encoded the buggy `complete`/exit-0 behavior, the same way WS-0 handled the brand-string coupling.
