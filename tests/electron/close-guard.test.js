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
    const hasFolded = jest.fn(() => false);
    let resolveFold;
    const triggerFold = jest.fn(() => new Promise((resolve) => { resolveFold = resolve; }));
    const guard = createCloseGuard({ hasFolded, triggerFold });
    const win = makeWindow();
    const event = { preventDefault: jest.fn() };

    guard.handleClose(event, win, null);
    resolveFold(undefined); // triggerFold's own success path calls mainWindow.close()
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
