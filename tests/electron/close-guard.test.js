/**
 * Backlog B01 — GUI close-without-fold loses the summary.
 *
 * `mainWindow.on('close', ...)` used to destroy the window immediately
 * whenever no fold had run, discarding the session summary on the most
 * common "I'm done, close the window" path. createCloseGuard() centralizes
 * the decision (auto-fold on close vs. let the existing close-during-fold /
 * already-folded paths proceed) behind a small, pure, unit-testable seam.
 */

describe('createCloseGuard', () => {
  let createCloseGuard;

  beforeEach(() => {
    jest.resetModules();
    ({ createCloseGuard } = require('../../electron/close-guard'));
  });

  function makeWindow() {
    return { destroy: jest.fn(), isDestroyed: () => false };
  }

  test('(a) close with no fold: prevents the default destroy and triggers exactly one fold', () => {
    const hasFolded = jest.fn(() => false);
    const triggerFold = jest.fn().mockResolvedValue(undefined);
    const guard = createCloseGuard({ hasFolded, triggerFold });
    const win = makeWindow();
    const event = { preventDefault: jest.fn() };

    guard.handleClose(event, win, 'contentView');

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(win.destroy).not.toHaveBeenCalled();
    expect(triggerFold).toHaveBeenCalledTimes(1);
    expect(triggerFold).toHaveBeenCalledWith(win, 'contentView');
  });

  test('(a) fold success on a close-initiated fold lets triggerFold\'s own success path close the window (no extra destroy from the guard)', async () => {
    // hasFolded flips true once the fold resolves — mirrors real fold.js,
    // where `folded` (and, post-fix, `completed`) is true after a
    // successful triggerFold settles. This test omits isFolding/hasCompleted
    // to also pin the documented fallback-to-hasFolded() behavior for a
    // caller still on the old two-arg contract.
    let folded = false;
    const hasFolded = jest.fn(() => folded);
    let resolveFold;
    const triggerFold = jest.fn(() => new Promise((resolve) => {
      resolveFold = () => { folded = true; resolve(); };
    }));
    const guard = createCloseGuard({ hasFolded, triggerFold });
    const win = makeWindow();
    const event = { preventDefault: jest.fn() };

    guard.handleClose(event, win, null);
    resolveFold(); // triggerFold's own success path calls mainWindow.close()
    await Promise.resolve();
    await Promise.resolve();

    expect(win.destroy).not.toHaveBeenCalled();
  });

  test('(b) close mid-fold: prevents destroy and does NOT call triggerFold again', () => {
    const hasFolded = jest.fn(() => false);
    const triggerFold = jest.fn().mockReturnValue(new Promise(() => {})); // never resolves in this test
    const guard = createCloseGuard({ hasFolded, triggerFold });
    const win = makeWindow();

    // First close: kicks off the fold.
    guard.handleClose({ preventDefault: jest.fn() }, win, null);
    expect(triggerFold).toHaveBeenCalledTimes(1);

    // Second close while the fold is still in flight.
    const event2 = { preventDefault: jest.fn() };
    guard.handleClose(event2, win, null);

    expect(event2.preventDefault).toHaveBeenCalledTimes(1);
    expect(win.destroy).not.toHaveBeenCalled();
    expect(triggerFold).toHaveBeenCalledTimes(1); // still just once
  });

  test('(c) close-initiated fold failure: falls back to destroy, and does not get re-intercepted (no preventDefault loop)', async () => {
    const hasFolded = jest.fn(() => false);
    const triggerFold = jest.fn().mockRejectedValue(new Error('summary timed out'));
    const guard = createCloseGuard({ hasFolded, triggerFold });
    const win = makeWindow();
    const event = { preventDefault: jest.fn() };

    guard.handleClose(event, win, null);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);

    // Let the rejected triggerFold promise settle.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(win.destroy).toHaveBeenCalledTimes(1);

    // A subsequent close event (e.g. destroy() re-entering 'close' on some
    // platforms, or a user double-click racing the fallback) must not be
    // trapped again — the latch has already fired its fallback.
    const event2 = { preventDefault: jest.fn() };
    guard.handleClose(event2, win, null);
    expect(event2.preventDefault).not.toHaveBeenCalled();
  });

  test('(d) fold already completed (hasFolded true): close proceeds as today — no preventDefault, no triggerFold, no destroy call from the guard', () => {
    const hasFolded = jest.fn(() => true);
    const triggerFold = jest.fn();
    const guard = createCloseGuard({ hasFolded, triggerFold });
    const win = makeWindow();
    const event = { preventDefault: jest.fn() };

    guard.handleClose(event, win, null);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(triggerFold).not.toHaveBeenCalled();
    expect(win.destroy).not.toHaveBeenCalled();
  });

  test('(e) re-entrancy latch: two rapid close events before the fold settles produce exactly one triggerFold call and eventually one close (via fallback)', async () => {
    const hasFolded = jest.fn(() => false);
    let rejectFold;
    const triggerFold = jest.fn(() => new Promise((_resolve, reject) => { rejectFold = reject; }));
    const guard = createCloseGuard({ hasFolded, triggerFold });
    const win = makeWindow();

    const event1 = { preventDefault: jest.fn() };
    const event2 = { preventDefault: jest.fn() };
    guard.handleClose(event1, win, null);
    guard.handleClose(event2, win, null); // rapid second close, still in flight

    expect(triggerFold).toHaveBeenCalledTimes(1);
    expect(event1.preventDefault).toHaveBeenCalledTimes(1);
    expect(event2.preventDefault).toHaveBeenCalledTimes(1);
    expect(win.destroy).not.toHaveBeenCalled();

    rejectFold(new Error('boom'));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(win.destroy).toHaveBeenCalledTimes(1); // exactly one eventual close
  });

  test('a destroyed window is not force-destroyed again by the fallback', async () => {
    const hasFolded = jest.fn(() => false);
    const triggerFold = jest.fn().mockRejectedValue(new Error('fail'));
    const guard = createCloseGuard({ hasFolded, triggerFold });
    const win = makeWindow();
    win.isDestroyed = () => true;

    guard.handleClose({ preventDefault: jest.fn() }, win, null);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(win.destroy).not.toHaveBeenCalled();
  });
});

describe('main.js wires the close event through createCloseGuard', () => {
  test('mainWindow.on(\'close\', ...) delegates to closeGuard.handleClose instead of destroying inline', () => {
    const fs = require('fs');
    const path = require('path');
    const mainSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'electron', 'main.js'), 'utf-8');

    expect(mainSrc).toContain("require('./close-guard')");
    const idx = mainSrc.indexOf("mainWindow.on('close'");
    expect(idx).toBeGreaterThan(-1);
    const body = mainSrc.slice(idx, idx + 200);
    expect(body).toMatch(/closeGuard\.handleClose\(/);
    // The old inline "destroy whenever !hasFolded()" one-liner must be gone —
    // that was the B01 data-loss bug (destroy with no fold attempt at all).
    expect(body).not.toMatch(/mainWindow\.destroy\(\)/);
  });
});

describe('createCloseGuard does not intervene in the abort/SIGTERM path (requirement 4)', () => {
  test('the guard exposes no API that interactive-abort.js\'s killElectron could route through', () => {
    // interactive-abort.js kills the Electron CHILD PROCESS via killIfAlive
    // (child.kill('SIGTERM')) — an OS-level signal to the Node process running
    // electron/main.js, not a call into any renderer 'close' handler. Node's
    // default SIGTERM behavior terminates the process immediately unless the
    // process itself installs a 'SIGTERM' listener. Pin that main.js installs
    // no such listener, so the abort path cannot be routed through the new
    // close-interception logic even in principle.
    const fs = require('fs');
    const path = require('path');
    const mainSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'electron', 'main.js'), 'utf-8');
    expect(mainSrc).not.toMatch(/process\.on\(\s*['"]SIGTERM['"]/);
  });
});

/**
 * Whole-phase review (Critical + Important, same root cause): fold.js's
 * `folded` flag goes true SYNCHRONOUSLY at triggerFold ENTRY, so a
 * hasFolded()-only close-guard cannot distinguish "fold in flight" from
 * "fold done" — a second close during an in-flight fold (auto-fold OR
 * toolbar/shortcut-initiated) fell through and destroyed the window,
 * discarding the pending summary. Separately, fold.js's outer catch can
 * RESOLVE (never reject) after a real production failure (a synchronous
 * throw from the nudge-overlay executeJavaScript call on a destroyed
 * webContents), so the close-guard's old .catch-only fallback never fired
 * and the window was left permanently un-closable.
 *
 * These tests bind the REAL electron/fold.js to the REAL
 * electron/close-guard.js — no mocked hasFolded contract — so a regression
 * in either module's actual behavior, not just the mocked test contract,
 * would be caught.
 */
describe('createCloseGuard + real fold.js: in-flight close protection (whole-phase review)', () => {
  let createFoldHandler;
  let createCloseGuard;
  let requestSummaryFromModel;
  let stdoutSpy;

  beforeEach(() => {
    jest.resetModules();
    jest.mock('../../electron/summary', () => ({
      requestSummaryFromModel: jest.fn(),
    }));
    jest.mock('../../src/prompt-builder', () => ({
      getSummaryTemplate: jest.fn().mockReturnValue('template'),
    }));
    // virtual: true lets this mock register even when electron is not
    // installed locally (matches tests/fold-nudge.test.js's approach).
    jest.mock('electron', () => ({
      app: { quit: jest.fn() },
    }), { virtual: true });

    ({ createFoldHandler } = require('../../electron/fold'));
    ({ createCloseGuard } = require('../../electron/close-guard'));
    ({ requestSummaryFromModel } = require('../../electron/summary'));

    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  function makeWindow() {
    return {
      destroy: jest.fn(),
      isDestroyed: () => false,
      close: jest.fn(),
      webContents: { executeJavaScript: jest.fn().mockResolvedValue(undefined) },
    };
  }

  function makeContentView({ executeJavaScript } = {}) {
    return {
      webContents: {
        executeJavaScript: executeJavaScript || jest.fn().mockResolvedValue(undefined),
        insertCSS: jest.fn().mockResolvedValue(undefined),
      },
    };
  }

  function wire(state) {
    const foldHandler = createFoldHandler(state);
    const closeGuard = createCloseGuard({
      hasFolded: foldHandler.hasFolded,
      isFolding: foldHandler.isFolding,
      hasCompleted: foldHandler.hasCompleted,
      triggerFold: foldHandler.triggerFold,
    });
    return { foldHandler, closeGuard };
  }

  test('(i) close #2 mid-auto-fold does not destroy and does not double-fold; summary write still lands', async () => {
    let resolveSummary;
    requestSummaryFromModel.mockReturnValue(new Promise((resolve) => { resolveSummary = resolve; }));

    const { closeGuard } = wire({
      model: 'm', client: 'code-local', cwd: '/x', sessionId: 's', taskId: 't', port: 1,
    });
    const win = makeWindow();
    const view = makeContentView();

    // Close #1: no fold yet — guard auto-triggers the fold (B01 behavior).
    const event1 = { preventDefault: jest.fn() };
    closeGuard.handleClose(event1, win, view);
    expect(event1.preventDefault).toHaveBeenCalledTimes(1);

    // Let the fold actually get into "in flight" (past the sync entry, into
    // the awaited requestSummaryFromModel call).
    await Promise.resolve();
    await Promise.resolve();

    // Close #2: fold is IN FLIGHT (not yet completed) — must be blocked, not
    // fall through to a destroy that would discard the pending summary.
    const event2 = { preventDefault: jest.fn() };
    closeGuard.handleClose(event2, win, view);
    expect(event2.preventDefault).toHaveBeenCalledTimes(1);
    expect(win.destroy).not.toHaveBeenCalled();
    // Only one requestSummaryFromModel call — the second close must not
    // have spawned a second fold attempt.
    expect(requestSummaryFromModel).toHaveBeenCalledTimes(1);

    // Now let the in-flight fold actually finish: resolving the summary
    // carries triggerFold past the `process.stdout.write` line (the write
    // happens before the 2.5s pre-close nudge delay, so a handful of
    // microtask flushes is enough to observe it without waiting out the
    // real timer).
    resolveSummary('the summary');
    for (let i = 0; i < 6; i++) { await Promise.resolve(); }

    // The stdout summary write landed regardless of the second close.
    const written = stdoutSpy.mock.calls.map((c) => c[0]).join('');
    expect(written).toContain('[SIDECAR_FOLD]');
    expect(written).toContain('the summary');
  });

  test('(ii) close during toolbar-initiated in-flight fold does not destroy', async () => {
    let resolveSummary;
    requestSummaryFromModel.mockReturnValue(new Promise((resolve) => { resolveSummary = resolve; }));

    const { foldHandler, closeGuard } = wire({
      model: 'm', client: 'cowork', cwd: '/x', sessionId: 's', taskId: 't', port: 1,
    });
    const win = makeWindow();
    const view = makeContentView();

    // Toolbar/shortcut path: triggerFold called directly, NOT via the guard.
    foldHandler.triggerFold(win, view);
    await Promise.resolve();
    await Promise.resolve();
    expect(foldHandler.isFolding()).toBe(true);

    // User closes the window while that toolbar-initiated fold is in flight.
    const event = { preventDefault: jest.fn() };
    closeGuard.handleClose(event, win, view);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(win.destroy).not.toHaveBeenCalled();
    // The guard must not spawn a second fold on top of the toolbar one.
    expect(requestSummaryFromModel).toHaveBeenCalledTimes(1);

    resolveSummary('done');
  });

  test('(iii) fold that settles without completion (outer-catch resolve path) leaves the window closable — no permanent trap', async () => {
    requestSummaryFromModel.mockResolvedValue('a summary');
    // Simulate the real production failure mode: the POST-WRITE nudge-overlay
    // executeJavaScript call throws SYNCHRONOUSLY (not a rejected promise) on
    // a destroyed webContents. fold.js's trailing .catch() only guards
    // promise rejection, so this reaches the outer catch, which historically
    // RESOLVED (never rejected) — the exact case the old close-guard's
    // .catch-only fallback could never observe. The FIRST executeJavaScript
    // call (showFoldOverlay's initial spinner, made before the stdout write)
    // must still succeed, or `completed` would never get set at all — the
    // sync throw under test is specifically the nudge update that runs
    // after the `[SIDECAR_FOLD]` write, identifiable by its "Tell Claude" text.
    const throwingExecuteJavaScript = jest.fn((script) => {
      if (typeof script === 'string' && script.includes('Tell Claude')) {
        throw new Error('Object has been destroyed');
      }
      return Promise.resolve();
    });

    const { foldHandler, closeGuard } = wire({
      model: 'm', client: 'code-local', cwd: '/x', sessionId: 's', taskId: 't', port: 1,
    });
    const win = makeWindow();
    const view = makeContentView({ executeJavaScript: throwingExecuteJavaScript });

    const event = { preventDefault: jest.fn() };
    closeGuard.handleClose(event, win, view);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);

    // Drain microtasks until triggerFold's promise settles.
    for (let i = 0; i < 10; i++) { await Promise.resolve(); }

    // The stdout write happened (completed=true internally) but the overlay
    // update threw before the window could close itself — fold.js resets
    // folded=false and returns normally (resolves, does not reject).
    expect(foldHandler.hasCompleted()).toBe(true);
    expect(foldHandler.isFolding()).toBe(false);

    // The close-guard must recognize "settled without the window actually
    // closing" and fall back to destroy so the window is never permanently
    // stuck open and un-closable.
    expect(win.destroy).toHaveBeenCalledTimes(1);

    // A follow-up close event must not be re-trapped (fallback already fired).
    const event2 = { preventDefault: jest.fn() };
    closeGuard.handleClose(event2, win, view);
    expect(event2.preventDefault).not.toHaveBeenCalled();
  });

  test('(iv) completed fold: close passes through with no interception', async () => {
    requestSummaryFromModel.mockResolvedValue('a summary');

    const { foldHandler, closeGuard } = wire({
      model: 'm', client: 'code-local', cwd: '/x', sessionId: 's', taskId: 't', port: 1,
    });
    const win = makeWindow();
    const view = makeContentView();

    await foldHandler.triggerFold(win, view);
    expect(foldHandler.hasCompleted()).toBe(true);

    const event = { preventDefault: jest.fn() };
    closeGuard.handleClose(event, win, view);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(win.destroy).not.toHaveBeenCalled();
  });
});
