'use strict';

// electron is not installed in every dev/CI env — mock the module surface the
// unit under test touches (ipc is injected; shell/fs are injected via deps).
jest.mock('electron', () => ({ ipcMain: { handle: jest.fn() }, shell: { openExternal: jest.fn() } }), { virtual: true });

const { registerWorkspaceHandlers, createFoldGate } = require('../../electron/ipc-workspace');
// Captured HERE, at file-load time, before any jest.resetModules() call runs
// (those only fire inside later describe blocks' beforeEach/afterEach hooks).
// ipc-workspace.js's own `require('../src/utils/logger')` resolved to this same
// cached module instance in the very same require() statement above, so this
// `logger` reference is guaranteed to be the SAME object ipc-workspace.js logs
// through internally — spying on it here observes those calls. A `require(...)`
// done later, inside a test body (after the malformed-runId describe block's
// resetModules() calls have cleared the module registry), would resolve to a
// freshly-evaluated, DIFFERENT `logger` object and silently observe nothing.
const { logger } = require('../../src/utils/logger');

function fakeIpc() {
  const handlers = new Map();
  return {
    handle: (ch, fn) => handlers.set(ch, fn),
    invoke: (ch, event, ...args) => handlers.get(ch)(event, ...args),
    handlers,
  };
}

function fakeWindowPair() {
  const webContents = {};
  const win = { isDestroyed: () => false, webContents, close: jest.fn() };
  return { win, goodEvent: { sender: webContents }, badEvent: { sender: {} } };
}

const CHANNELS = ['workspace:list-runs', 'workspace:get-run', 'workspace:get-live',
  'workspace:read-artifact', 'workspace:abort-run', 'workspace:fold', 'workspace:open-report'];

function setup(depsOverride = {}) {
  const ipc = fakeIpc();
  const { win, goodEvent, badEvent } = fakeWindowPair();
  const gate = createFoldGate();
  const deps = {
    scanCouncilRuns: jest.fn(() => [{ runId: 'aaaa1111' }]),
    getRunDetail: jest.fn(() => ({ runId: 'aaaa1111', run: { runId: 'aaaa1111', chair: 'deepseek', status: 'complete', usage: { cost: { amount: 1, source: 'reported' } }, stages: [] }, tally: null, verdict: null, artifacts: {}, derived: {} })),
    // Inside the project on purpose (council fix C1): a real run dir always is
    // (mcp-council-run.js:109 rejects an outDir outside the project at
    // creation time), and the new containment fence in ipc-workspace.js now
    // enforces that same invariant again at read time — a runDir outside
    // 'C:\\proj' would (correctly) trip the fence and break the happy-path
    // open-report tests below if this fixture didn't reflect that.
    readPointer: jest.fn(() => ({ runId: 'aaaa1111', runDir: 'C:\\proj\\council-aaaa1111' })),
    readRunArtifact: jest.fn(() => ({ text: 'artifact text' })),
    buildFoldText: jest.fn(() => 'FOLD-TEXT'),
    normalizeLive: jest.fn((doc) => ({ ok: true, runId: doc.taskId })),
    handlers: () => ({
      amicus_status: jest.fn(async () => ({ isError: false, content: [{ text: JSON.stringify({ taskId: 'aaaa1111', view: 'live' }) }] })),
      amicus_abort: jest.fn(async () => ({ isError: false, content: [{ text: '{"ok":true}' }] })),
    }),
    stdoutWrite: jest.fn(async () => {}),
    openExternal: jest.fn(),
    existsSync: jest.fn(() => true),
    // Identity pass-through by default — the fake paths above aren't real disk
    // paths, so a real fs.realpathSync would ENOENT. Tests that need to prove
    // the containment fence override this explicitly (see the C1 describe
    // block below).
    realpathSync: jest.fn((p) => p),
    ...depsOverride,
  };
  registerWorkspaceHandlers(() => win, { project: 'C:\\proj', nonce: 'cafef00dcafef00d', ipc, gate, deps });
  return { ipc, win, goodEvent, badEvent, gate, deps };
}

describe('registerWorkspaceHandlers', () => {
  test('registers exactly the seven spec channels', () => {
    const { ipc } = setup();
    expect([...ipc.handlers.keys()].sort()).toEqual([...CHANNELS].sort());
  });

  test('every channel rejects a non-workspace sender (ipc-guard pinning)', async () => {
    const { ipc, badEvent } = setup();
    expect(await ipc.invoke('workspace:list-runs', badEvent)).toEqual([]);
    expect((await ipc.invoke('workspace:get-run', badEvent, 'aaaa1111')).error).toBe('unauthorized');
    expect((await ipc.invoke('workspace:get-live', badEvent, 'aaaa1111')).ok).toBe(false);
    expect((await ipc.invoke('workspace:read-artifact', badEvent, 'aaaa1111', 'chair-output.md')).error).toBe('unauthorized');
    expect((await ipc.invoke('workspace:abort-run', badEvent, 'aaaa1111')).ok).toBe(false);
    expect((await ipc.invoke('workspace:fold', badEvent, 'aaaa1111')).ok).toBe(false);
    expect((await ipc.invoke('workspace:open-report', badEvent, 'aaaa1111')).ok).toBe(false);
  });

  test('list-runs/get-run/read-artifact delegate with the ctx project', async () => {
    const { ipc, goodEvent, deps } = setup();
    expect(await ipc.invoke('workspace:list-runs', goodEvent)).toEqual([{ runId: 'aaaa1111' }]);
    await ipc.invoke('workspace:get-run', goodEvent, 'aaaa1111');
    expect(deps.getRunDetail).toHaveBeenCalledWith('C:\\proj', 'aaaa1111');
    const art = await ipc.invoke('workspace:read-artifact', goodEvent, 'aaaa1111', 'chair-output.md');
    expect(art.text).toBe('artifact text');
    expect(deps.readRunArtifact).toHaveBeenCalledWith('C:\\proj', 'aaaa1111', 'chair-output.md');
  });

  test('get-live parses the amicus_status text and normalizes it', async () => {
    const { ipc, goodEvent } = setup();
    const live = await ipc.invoke('workspace:get-live', goodEvent, 'aaaa1111');
    expect(live).toEqual({ ok: true, runId: 'aaaa1111' });
  });

  test('get-live surfaces isError and unparseable docs as {ok:false}', async () => {
    const err = setup({ handlers: () => ({ amicus_status: async () => ({ isError: true, content: [{ text: 'boom' }] }) }) });
    expect((await err.ipc.invoke('workspace:get-live', err.goodEvent, 'x')).ok).toBe(false);
    const bad = setup({ handlers: () => ({ amicus_status: async () => ({ isError: false, content: [{ text: '{nope' }] }) }) });
    expect((await bad.ipc.invoke('workspace:get-live', bad.goodEvent, 'x')).ok).toBe(false);
  });

  test('abort delegates to handlers.amicus_abort with {taskId} + project', async () => {
    const abortFn = jest.fn(async () => ({ isError: false, content: [{ text: 'ok' }] }));
    const { ipc, goodEvent } = setup({ handlers: () => ({ amicus_abort: abortFn }) });
    const res = await ipc.invoke('workspace:abort-run', goodEvent, 'aaaa1111');
    expect(res.ok).toBe(true);
    expect(abortFn).toHaveBeenCalledWith({ taskId: 'aaaa1111' }, 'C:\\proj');
  });

  test('fold writes the built text to stdout once; re-entry latched; already after success', async () => {
    const { ipc, goodEvent, deps } = setup();
    const first = await ipc.invoke('workspace:fold', goodEvent, 'aaaa1111');
    expect(first).toEqual({ ok: true });
    expect(deps.stdoutWrite).toHaveBeenCalledTimes(1);
    expect(deps.stdoutWrite).toHaveBeenCalledWith('FOLD-TEXT\n');
    expect(deps.buildFoldText).toHaveBeenCalledWith(expect.objectContaining({ nonce: 'cafef00dcafef00d', project: 'C:\\proj' }));
    const second = await ipc.invoke('workspace:fold', goodEvent, 'aaaa1111');
    expect(second).toEqual({ ok: true, already: true });
    expect(deps.stdoutWrite).toHaveBeenCalledTimes(1);
  });

  test('fold on an unreadable run fails without latching completion', async () => {
    const { ipc, goodEvent, gate } = setup({ getRunDetail: jest.fn(() => ({ runId: 'x', error: 'run.json missing' })) });
    const res = await ipc.invoke('workspace:fold', goodEvent, 'x');
    expect(res.ok).toBe(false);
    expect(gate.hasCompleted()).toBe(false);
  });

  test('open-report refuses a missing report.html and never opens it', async () => {
    const { ipc, goodEvent, deps } = setup({ existsSync: jest.fn(() => false) });
    const res = await ipc.invoke('workspace:open-report', goodEvent, 'aaaa1111');
    expect(res.ok).toBe(false);
    expect(deps.openExternal).not.toHaveBeenCalled();
  });

  // ⚠️ DE-ROT (F59): the shipped readPointer returns null (not {error}) for a
  // missing/corrupt pointer — tests/council/run-state.test.js:130-131. Prove the
  // handler answers {ok:false} instead of rejecting with a TypeError.
  test('open-report survives a null pointer (shipped readPointer contract)', async () => {
    const { ipc, goodEvent, deps } = setup({ readPointer: jest.fn(() => null) });
    const res = await ipc.invoke('workspace:open-report', goodEvent, 'nope99');
    expect(res.ok).toBe(false);
    expect(deps.openExternal).not.toHaveBeenCalled();
  });

  // Council review C1 (MAJOR, unanimous): workspace:open-report was the only
  // filesystem-reaching channel with no containment fence — ptr.runDir is
  // disk-derived and never validated beyond truthiness
  // (src/council/run-state.js:133-139). A tampered/stale pointer whose runDir
  // has drifted outside the project must fail closed rather than hand
  // openExternal (a shell verb) whatever it finds there.
  test('open-report refuses when the pointer\'s runDir resolves outside the project', async () => {
    const { ipc, goodEvent, deps } = setup({
      readPointer: jest.fn(() => ({ runId: 'aaaa1111', runDir: 'C:\\totally\\unrelated\\external-dir' })),
    });
    const res = await ipc.invoke('workspace:open-report', goodEvent, 'aaaa1111');
    expect(res.ok).toBe(false);
    expect(deps.openExternal).not.toHaveBeenCalled();
  });

  // Mirrors artifact-guard.js's fence 2 exactly (readRunArtifact's own realpath
  // containment test): a report.html that is itself a symlink resolving
  // outside the run dir must not be opened, even though runDir itself is
  // legitimate.
  test('open-report refuses when report.html is a symlink escaping the run dir', async () => {
    const { ipc, goodEvent, deps } = setup({
      realpathSync: jest.fn((p) => (String(p).endsWith('report.html') ? 'C:\\somewhere\\else\\report.html' : p)),
    });
    const res = await ipc.invoke('workspace:open-report', goodEvent, 'aaaa1111');
    expect(res.ok).toBe(false);
    expect(deps.openExternal).not.toHaveBeenCalled();
  });

  test('open-report opens the run-own report.html as a file URL', async () => {
    const { ipc, goodEvent, deps } = setup();
    const res = await ipc.invoke('workspace:open-report', goodEvent, 'aaaa1111');
    expect(res.ok).toBe(true);
    expect(deps.openExternal).toHaveBeenCalledWith(expect.stringMatching(/^file:\/\/.*report\.html$/));
  });
});

describe('registerWorkspaceHandlers — extra security-gate coverage', () => {
  test('workspace:live-update is never registered, even though it is a reserved seam name', () => {
    const { ipc } = setup();
    expect(ipc.handlers.has('workspace:live-update')).toBe(false);
    expect(ipc.handlers.size).toBe(7);
  });

  test('Gate 2: readRunArtifact is invoked with exactly three arguments from read-artifact AND from fold', async () => {
    const { ipc, goodEvent, deps } = setup();
    await ipc.invoke('workspace:read-artifact', goodEvent, 'aaaa1111', 'chair-output.md');
    expect(deps.readRunArtifact).toHaveBeenCalledTimes(1);
    expect(deps.readRunArtifact.mock.calls[0]).toHaveLength(3);
    expect(deps.readRunArtifact.mock.calls[0]).toEqual(['C:\\proj', 'aaaa1111', 'chair-output.md']);

    await ipc.invoke('workspace:fold', goodEvent, 'aaaa1111');
    expect(deps.readRunArtifact).toHaveBeenCalledTimes(2);
    expect(deps.readRunArtifact.mock.calls[1]).toHaveLength(3);
  });

  // Gate 1, proven against the REAL production modules (not the fakes `setup()`
  // injects) — a fake that always returns success proves nothing about whether
  // the actual filesystem fence rejects a traversal runId. Uses the same
  // `require('../src/mcp-server').handlers` + temp-project pattern already
  // established in tests/mcp-council-abort.test.js.
  //
  // Code-review correction: an earlier version of this block asserted only
  // `res.error`/`res.ok` truthiness/falsiness against an EMPTY temp project.
  // In an empty project *any* runId errors (there is nothing on disk to find),
  // so those assertions could not distinguish "the fence rejected this" from
  // "there's nothing here" — deleting RUN_ID_RE from run-scan.js would still
  // leave every one of those tests green (the error message just changes from
  // 'invalid runId' to 'pointer missing, unreadable, or invalid'). Pinning the
  // exact message each fence produces makes the assertion mechanism-specific:
  // it goes red if either fence (the RUN_ID_RE charset check in readPointer,
  // or safeSessionDir's resolved-path containment check) is removed.
  describe('malformed runId rejected on every channel, with REAL deps (no fakes)', () => {
    const os = require('os');
    const fs = require('fs');
    const path = require('path');
    const MALICIOUS_RUN_ID = '../../../../Users/sendt/.ssh/id';

    let tmp;
    beforeEach(() => {
      jest.resetModules();
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ipc-workspace-traversal-'));
    });
    afterEach(() => {
      fs.rmSync(tmp, { recursive: true, force: true });
      jest.resetModules();
    });

    function realSetup() {
      const { registerWorkspaceHandlers: register } = require('../../electron/ipc-workspace');
      const ipc = fakeIpc();
      const { win, goodEvent } = fakeWindowPair();
      // deps intentionally omitted: defaultDeps() lazy-requires the real,
      // merged Phase 1 modules (src/workspace/run-scan.js, run-detail.js,
      // artifact-guard.js) plus the real MCP handlers, exactly as production
      // wiring does.
      register(() => win, { project: tmp, nonce: 'cafef00dcafef00d', ipc });
      return { ipc, goodEvent };
    }

    test('get-run: readPointer\'s RUN_ID_RE rejects it before any fs access', async () => {
      const { ipc, goodEvent } = realSetup();
      const res = await ipc.invoke('workspace:get-run', goodEvent, MALICIOUS_RUN_ID);
      expect(res.error).toMatch(/invalid runId/);
    });

    test('read-artifact: readPointer rejects it before the artifact allowlist / realpath fences run', async () => {
      const { ipc, goodEvent } = realSetup();
      const res = await ipc.invoke('workspace:read-artifact', goodEvent, MALICIOUS_RUN_ID, 'chair-output.md');
      expect(res.error).toMatch(/invalid runId/);
    });

    test('open-report: readPointer rejects it before report.html is ever stat-ed', async () => {
      const { ipc, goodEvent } = realSetup();
      const res = await ipc.invoke('workspace:open-report', goodEvent, MALICIOUS_RUN_ID);
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/invalid runId/);
    });

    test('fold: getRunDetail\'s readPointer rejects it before any chair-output.md read or stdout write', async () => {
      const { ipc, goodEvent } = realSetup();
      const res = await ipc.invoke('workspace:fold', goodEvent, MALICIOUS_RUN_ID);
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/invalid runId/);
    });

    test('get-live: safeSessionDir\'s containment check rejects it (amicus_status throws, handler catches)', async () => {
      const { ipc, goodEvent } = realSetup();
      const res = await ipc.invoke('workspace:get-live', goodEvent, MALICIOUS_RUN_ID);
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/path traversal detected/);
    });

    test('abort-run: safeSessionDir\'s containment check rejects it (amicus_abort throws, handler catches)', async () => {
      const { ipc, goodEvent } = realSetup();
      const res = await ipc.invoke('workspace:abort-run', goodEvent, MALICIOUS_RUN_ID);
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/path traversal detected/);
    });
  });
});

describe('workspace:fold — code-review follow-ups', () => {
  // Fix #2: the default stdoutWrite dep must not swallow a write error. Node's
  // process.stdout.write(chunk, cb) invokes cb(err) — err is undefined on success
  // and an Error when the chunk fails to flush (e.g. a dead parent pipe / closed
  // stdout). The original defaultDeps() ignored that argument entirely:
  // `(text) => new Promise((resolve) => process.stdout.write(text, () => resolve()))`
  // resolved unconditionally, so a failed write still reported {ok:true} to the
  // renderer and permanently latched gate.hasCompleted() — an unrecoverable fold
  // for the life of the window, exactly the failure mode electron/fold.js:37-40
  // documents `completed` as guarding against.
  //
  // This exercises the REAL default stdoutWrite (not a fake) by omitting it from
  // the injected deps — `{ ...defaultDeps(), ...ctx.deps }` then falls through to
  // the production implementation — while faking only the run-detail/artifact/
  // fold-text deps so the test needs no real project directory on disk.
  test('a failed stdout write (dead pipe) reports fold failure, not success, and does not latch completion', async () => {
    const ipc = fakeIpc();
    const { win, goodEvent } = fakeWindowPair();
    const gate = createFoldGate();
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation((_chunk, cb) => {
      cb(new Error('EPIPE: write after end'));
      return true;
    });
    try {
      const deps = {
        getRunDetail: jest.fn(() => ({
          runId: 'aaaa1111',
          run: { runId: 'aaaa1111', chair: 'deepseek', status: 'complete', stages: [] },
          tally: null, verdict: null,
        })),
        readRunArtifact: jest.fn(() => ({ text: 'chair prose' })),
        buildFoldText: jest.fn(() => 'FOLD-TEXT'),
        // stdoutWrite intentionally OMITTED so the real defaultDeps() wrapper runs.
      };
      registerWorkspaceHandlers(() => win, { project: 'C:\\proj', nonce: 'cafef00dcafef00d', ipc, gate, deps });
      const res = await ipc.invoke('workspace:fold', goodEvent, 'aaaa1111');
      expect(res).toEqual({ ok: false, error: 'EPIPE: write after end' });
      expect(gate.hasCompleted()).toBe(false);
      expect(gate.begin()).toBe(true); // retry must still be possible after a failed write
    } finally {
      writeSpy.mockRestore();
    }
  });

  // Fix #3: readRunArtifact's realpath-escape fence firing (a symlinked
  // chair-output.md pointing outside the run dir) must be distinguishable, in
  // the logs, from the benign "not written yet" case — both previously fell
  // through to the same silent "(no chair output — tally summary above)" body
  // with no signal an operator could act on.
  test('fold logs a warning when chair-output.md is unreadable for ANY reason, including the realpath-escape fence', async () => {
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      const { ipc, goodEvent } = setup({
        readRunArtifact: jest.fn(() => ({ error: 'artifact escapes run directory' })),
      });
      const res = await ipc.invoke('workspace:fold', goodEvent, 'aaaa1111');
      expect(res.ok).toBe(true); // the safe fallback body still succeeds
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('chair-output.md'),
        expect.objectContaining({ reason: 'artifact escapes run directory' }),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  // Fix #4: prove 'fold-in-flight' is actually observed under real concurrency
  // at the HANDLER level (createFoldGate's own unit tests already cover the
  // gate object in isolation; this proves ipc-workspace.js actually wires a
  // second concurrent invoke through to that branch).
  test('a second workspace:fold call while the first is still writing gets fold-in-flight, then the first completes normally', async () => {
    let releaseWrite;
    const writeGate = new Promise((resolve) => { releaseWrite = resolve; });
    const { ipc, goodEvent } = setup({ stdoutWrite: jest.fn(() => writeGate) });

    // The handler is async but runs synchronously up to its first `await`
    // (deps.stdoutWrite(...)) before yielding — so by the time this call
    // returns, gate.begin() has already flipped to "writing".
    const firstPromise = ipc.invoke('workspace:fold', goodEvent, 'aaaa1111');
    const second = await ipc.invoke('workspace:fold', goodEvent, 'aaaa1111');
    expect(second).toEqual({ ok: false, error: 'fold-in-flight' });

    releaseWrite();
    const first = await firstPromise;
    expect(first).toEqual({ ok: true });
  });

  // Code review follow-up (task-9, post-approval): settle()'s pendingClose
  // signal was only read on the SUCCESS call site (:151). Task 9 wired
  // workspace-shell.js's close handler to call gate.noteBlockedClose() while
  // gate.isWriting() — which means a close blocked during a fold that then
  // FAILS is silently dropped: the window stays open and un-closable-again
  // until the user clicks X a second time. The two failure call sites
  // (the detail-error early return, and the outer catch) must close the
  // window too when settle() reports a close was pending, exactly like the
  // success path does.
  test('a close blocked during a fold that then FAILS (stdout write rejects) still closes once settle() reports the pending close', async () => {
    let rejectWrite;
    const writeGate = new Promise((_resolve, reject) => { rejectWrite = reject; });
    const { ipc, goodEvent, win, gate } = setup({ stdoutWrite: jest.fn(() => writeGate) });

    const foldPromise = ipc.invoke('workspace:fold', goodEvent, 'aaaa1111');
    // Fold is now in flight (gate.begin() already flipped writing=true — see
    // Fix #4's comment above on synchronous-until-first-await handler
    // behavior). Simulate a close attempt landing in that window, exactly as
    // workspace-shell.js's close handler does.
    gate.noteBlockedClose();

    rejectWrite(new Error('EPIPE: write after end'));
    const res = await foldPromise;

    expect(res.ok).toBe(false);
    expect(gate.hasCompleted()).toBe(false);
    expect(win.close).toHaveBeenCalledTimes(1);
  });

  test('a close blocked during a fold that then FAILS (unreadable run) still closes once settle() reports the pending close', async () => {
    const { ipc, goodEvent, win, gate } = setup({
      getRunDetail: jest.fn(() => ({ runId: 'x', error: 'run.json missing' })),
    });

    // gate.begin() runs synchronously before the run-detail check, so a close
    // blocked at this exact instant is a real (if narrow) race in production;
    // calling noteBlockedClose() directly reproduces it deterministically.
    gate.noteBlockedClose();
    const res = await ipc.invoke('workspace:fold', goodEvent, 'x');

    expect(res.ok).toBe(false);
    expect(win.close).toHaveBeenCalledTimes(1);
  });

  test('no pending close: a failed fold does NOT close the window (no regression on the ordinary failure path)', async () => {
    const { ipc, goodEvent, win } = setup({
      getRunDetail: jest.fn(() => ({ runId: 'x', error: 'run.json missing' })),
    });
    const res = await ipc.invoke('workspace:fold', goodEvent, 'x');
    expect(res.ok).toBe(false);
    expect(win.close).not.toHaveBeenCalled();
  });

  // Council review R2, finding A3: the renderer supports navigating to a DIFFERENT
  // run within the same open window (openRun with a dynamic runId — bare `--ui`
  // opens the whole project run list, spec §4.4/§4.3). Before this fix,
  // hasCompleted() was a single unkeyed latch: fold run A -> succeeds; switch to
  // run B -> workspace:fold silently returned {ok:true, already:true} WITHOUT
  // ever calling stdoutWrite for B. The UI read "Folded ✓" for B and nothing
  // reached the launching terminal — a silent wrong-result, not a cosmetic one.
  test('cross-run fold: folding run A does not block an honest fold of run B afterward', async () => {
    const runDetails = {
      aaaa1111: { runId: 'aaaa1111', run: { runId: 'aaaa1111', chair: 'deepseek', status: 'complete', stages: [] }, tally: null, verdict: null },
      bbbb2222: { runId: 'bbbb2222', run: { runId: 'bbbb2222', chair: 'gemini', status: 'complete', stages: [] }, tally: null, verdict: null },
    };
    const { ipc, goodEvent, deps } = setup({
      getRunDetail: jest.fn((_project, runId) => runDetails[runId]),
      buildFoldText: jest.fn(({ run }) => `FOLD-TEXT-${run.runId}`),
    });

    const first = await ipc.invoke('workspace:fold', goodEvent, 'aaaa1111');
    expect(first).toEqual({ ok: true });
    expect(deps.stdoutWrite).toHaveBeenNthCalledWith(1, 'FOLD-TEXT-aaaa1111\n');

    // Re-entry on the SAME run: still the documented "one fold write per launch,
    // per run" already:true (spec §7) — no regression on that contract.
    const sameRunAgain = await ipc.invoke('workspace:fold', goodEvent, 'aaaa1111');
    expect(sameRunAgain).toEqual({ ok: true, already: true });
    expect(deps.stdoutWrite).toHaveBeenCalledTimes(1);

    // A DIFFERENT run must actually fold — not silently report already:true
    // for a run that was never written.
    const second = await ipc.invoke('workspace:fold', goodEvent, 'bbbb2222');
    expect(second).toEqual({ ok: true });
    expect(deps.stdoutWrite).toHaveBeenCalledTimes(2);
    expect(deps.stdoutWrite).toHaveBeenNthCalledWith(2, 'FOLD-TEXT-bbbb2222\n');
  });
});

describe('createFoldGate', () => {
  test('begin/settle/isWriting/hasCompleted lifecycle + blocked-close signal', () => {
    const gate = createFoldGate();
    expect(gate.begin()).toBe(true);
    expect(gate.isWriting()).toBe(true);
    expect(gate.begin()).toBe(false);            // re-entry while writing
    gate.noteBlockedClose();
    expect(gate.settle({ ok: true })).toBe(true); // a close was blocked → caller should re-close
    expect(gate.isWriting()).toBe(false);
    expect(gate.hasCompleted()).toBe(true);
    expect(gate.begin()).toBe(false);            // completed → no second write
  });

  test('failed settle resets writing but not completed; no pending close → false', () => {
    const gate = createFoldGate();
    gate.begin();
    expect(gate.settle({ ok: false })).toBe(false);
    expect(gate.hasCompleted()).toBe(false);
    expect(gate.begin()).toBe(true);             // retry allowed after failure
  });

  // Council review R2, finding A3: hasCompleted() used to be a single UNKEYED
  // boolean — completing a fold for ANY run permanently latched the gate for
  // every OTHER run too, for the life of the window. Scoped per runId so a
  // second, DIFFERENT run gets its own honest begin()/hasCompleted() pair.
  test('hasCompleted/begin are scoped per runId — completing run A does not latch run B', () => {
    const gate = createFoldGate();
    expect(gate.begin('aaaa1111')).toBe(true);
    expect(gate.settle({ ok: true })).toBe(false); // no pending close
    expect(gate.hasCompleted('aaaa1111')).toBe(true);
    expect(gate.hasCompleted('bbbb2222')).toBe(false);
    expect(gate.begin('bbbb2222')).toBe(true);     // a DIFFERENT run still gets a real attempt
    expect(gate.settle({ ok: true })).toBe(false);
    expect(gate.hasCompleted('bbbb2222')).toBe(true);
    expect(gate.hasCompleted('aaaa1111')).toBe(true); // A's completion is unaffected by B's
  });
});
