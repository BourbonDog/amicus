'use strict';

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'electron', 'workspace-shell.js'), 'utf-8');

describe('workspace-shell posture (source-level)', () => {
  test('full sandbox + workspace preload; no nodeIntegration', () => {
    expect(SRC).toContain('sandbox: true');
    expect(SRC).toContain('contextIsolation: true');
    expect(SRC).toContain('nodeIntegration: false');
    expect(SRC).toContain('preload-workspace.js');
  });

  test('static first-party page via loadFile with the runId query', () => {
    expect(SRC).toContain("loadFile(");
    expect(SRC).toContain("'workspace-ui', 'index.html'");
    expect(SRC).toContain('query: { runId');
  });

  // ⚠️ DE-ROT (F31): the workspace window is created `show: false`, so a failed or
  // stalled loadFile would leave an invisible window + silent hang (the documented
  // "Starting up... | 0 messages" bug, electron/load-failsafe.js:4-12). Pin the guard.
  test('hidden-window load failsafe is attached and disarmed on success', () => {
    expect(SRC).toContain('attachLoadFailsafe');
    expect(SRC).toContain('failsafe.cancel()');
  });

  test('navigation and window-open are always denied', () => {
    expect(SRC).toContain("on('will-navigate'");
    expect(SRC).toContain('event.preventDefault()');
    expect(SRC).toContain("setWindowOpenHandler(() => ({ action: 'deny' }))");
  });

  test('spec geometry: centered 1100x800 min 860x600, token background', () => {
    expect(SRC).toContain('width: 1100');
    expect(SRC).toContain('height: 800');
    expect(SRC).toContain('minWidth: 860');
    expect(SRC).toContain('minHeight: 600');
    expect(SRC).toContain('TOKENS.bg');
    expect(SRC).not.toMatch(/\bx:\s*\d/); // no explicit x/y → Electron centers
  });

  test('close latch: prevent only while a fold write is in flight — never auto-fold', () => {
    expect(SRC).toContain('gate.isWriting()');
    expect(SRC).toContain('gate.noteBlockedClose()');
    expect(SRC).not.toContain('triggerFold');
    expect(SRC).not.toContain('createCloseGuard');
  });
});

/**
 * Behavioral proofs — the source-string tests above only prove the right
 * WORDS are in the file; they cannot prove the guards actually run (this
 * exact gap was found and fixed in Tasks 7 and 8: see preload-workspace.test.js's
 * "behavioral" block and ipc-workspace.test.js's Gate 1/2 follow-ups). Here we
 * mock 'electron' with a minimal fake BrowserWindow, actually call
 * createWorkspaceWindow, and invoke the captured handlers/options directly so
 * a removed or inverted guard fails a test, not just a grep.
 */
describe('createWorkspaceWindow (behavioral)', () => {
  let createWorkspaceWindow;
  let lastOpts;
  let win;

  function fakeWebContents() {
    return {
      handlers: {},
      on(evt, fn) { (this.handlers[evt] = this.handlers[evt] || []).push(fn); },
      setWindowOpenHandler: jest.fn(),
    };
  }

  class FakeBrowserWindow {
    constructor(opts) {
      lastOpts = opts;
      this.webContents = fakeWebContents();
      this._closeHandlers = [];
      this._readyHandlers = [];
      this.shown = false;
      this.destroyed = false;
      win = this;
    }
    loadFile(...args) { this.loadFileArgs = args; return Promise.resolve(); }
    once(evt, fn) { if (evt === 'ready-to-show') { this._readyHandlers.push(fn); } }
    on(evt, fn) { if (evt === 'close') { this._closeHandlers.push(fn); } }
    show() { this.shown = true; }
    isDestroyed() { return this.destroyed; }
  }

  function makeGate(overrides = {}) {
    return { isWriting: () => false, noteBlockedClose: jest.fn(), ...overrides };
  }

  beforeEach(() => {
    jest.resetModules();
    // attachLoadFailsafe (real module, not mocked) arms a 15s setTimeout on every
    // createWorkspaceWindow call. Fake timers keep it from firing (and logging)
    // after each test ends, since none of these tests advance time.
    jest.useFakeTimers();
    lastOpts = undefined;
    win = undefined;
    jest.doMock('electron', () => ({ BrowserWindow: FakeBrowserWindow }), { virtual: true });
    ({ createWorkspaceWindow } = require('../../electron/workspace-shell'));
  });

  afterEach(() => {
    jest.dontMock('electron');
    jest.useRealTimers();
  });

  test('is constructed with full sandbox posture and the workspace preload', () => {
    createWorkspaceWindow({ runId: 'r1', gate: makeGate(), headless: true });
    expect(lastOpts.webPreferences.sandbox).toBe(true);
    expect(lastOpts.webPreferences.contextIsolation).toBe(true);
    expect(lastOpts.webPreferences.nodeIntegration).toBe(false);
    expect(lastOpts.webPreferences.preload).toMatch(/preload-workspace\.js$/);
  });

  test('geometry matches spec and Electron centers (no explicit x/y)', () => {
    createWorkspaceWindow({ runId: 'r1', gate: makeGate(), headless: true });
    expect(lastOpts.width).toBe(1100);
    expect(lastOpts.height).toBe(800);
    expect(lastOpts.minWidth).toBe(860);
    expect(lastOpts.minHeight).toBe(600);
    expect(lastOpts.x).toBeUndefined();
    expect(lastOpts.y).toBeUndefined();
  });

  test('loadFile targets workspace-ui/index.html with the runId query', () => {
    createWorkspaceWindow({ runId: 'run-42', gate: makeGate(), headless: true });
    const [filePath, opts] = win.loadFileArgs;
    expect(filePath).toBe(path.join(__dirname, '..', '..', 'electron', 'workspace-ui', 'index.html'));
    expect(opts).toEqual({ query: { runId: 'run-42' } });
  });

  test('will-navigate handler actually calls preventDefault — removing it would fail this', () => {
    createWorkspaceWindow({ runId: 'r1', gate: makeGate(), headless: true });
    const handlers = win.webContents.handlers['will-navigate'];
    expect(handlers && handlers.length).toBe(1);
    const event = { preventDefault: jest.fn() };
    handlers[0](event, 'https://evil.example.com/');
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  // Parity with the window-open test below, which exercises two URL schemes.
  // An allowlist inverted to only deny http(s) (letting file:// through) would
  // still pass the https-only assertion above; a file:// target closes that gap.
  test('will-navigate handler denies regardless of URL scheme, including file://', () => {
    createWorkspaceWindow({ runId: 'r1', gate: makeGate(), headless: true });
    const handlers = win.webContents.handlers['will-navigate'];
    const event = { preventDefault: jest.fn() };
    handlers[0](event, 'file:///etc/passwd');
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  test('window-open handler denies unconditionally for any url — removing/weakening it would fail this', () => {
    createWorkspaceWindow({ runId: 'r1', gate: makeGate(), headless: true });
    expect(win.webContents.setWindowOpenHandler).toHaveBeenCalledTimes(1);
    const registered = win.webContents.setWindowOpenHandler.mock.calls[0][0];
    expect(registered({ url: 'https://evil.example.com/' })).toEqual({ action: 'deny' });
    expect(registered({ url: 'file:///etc/passwd' })).toEqual({ action: 'deny' });
  });

  test('no auto-fold on close: closing with no fold in flight proceeds (preventDefault never called)', () => {
    const gate = makeGate({ isWriting: () => false });
    createWorkspaceWindow({ runId: 'r1', gate, headless: true });
    expect(win._closeHandlers.length).toBe(1);
    const event = { preventDefault: jest.fn() };
    win._closeHandlers[0](event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(gate.noteBlockedClose).not.toHaveBeenCalled();
  });

  test('in-flight latch: prevents close while a fold write is in progress and notes the blocked close', () => {
    const gate = makeGate({ isWriting: () => true });
    createWorkspaceWindow({ runId: 'r1', gate, headless: true });
    const event = { preventDefault: jest.fn() };
    win._closeHandlers[0](event);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(gate.noteBlockedClose).toHaveBeenCalledTimes(1);
  });

  test('close proceeds once the in-flight write settles (isWriting flips false)', () => {
    let writing = true;
    const gate = makeGate({ isWriting: () => writing });
    createWorkspaceWindow({ runId: 'r1', gate, headless: true });

    const blocked = { preventDefault: jest.fn() };
    win._closeHandlers[0](blocked);
    expect(blocked.preventDefault).toHaveBeenCalledTimes(1);

    writing = false; // the fold write settled
    const proceeds = { preventDefault: jest.fn() };
    win._closeHandlers[0](proceeds);
    expect(proceeds.preventDefault).not.toHaveBeenCalled();
  });

  test('show() stays gated off in headless test mode, even after ready-to-show', () => {
    createWorkspaceWindow({ runId: 'r1', gate: makeGate(), headless: true });
    win._readyHandlers.forEach((fn) => fn());
    expect(win.shown).toBe(false);
  });

  test('show() fires on ready-to-show when not headless', () => {
    createWorkspaceWindow({ runId: 'r1', gate: makeGate(), headless: false });
    win._readyHandlers.forEach((fn) => fn());
    expect(win.shown).toBe(true);
  });

  // H9: this window renders untrusted model prose. page-title-updated is what
  // stops that prose from spoofing the window chrome (e.g. a chair response
  // ending in text engineered to look like a native title-bar change). Before
  // this test, deleting the guard broke no test — mirror the will-navigate
  // proof so removing it fails here.
  test('page-title-updated handler actually calls preventDefault — untrusted model prose cannot spoof the title bar', () => {
    createWorkspaceWindow({ runId: 'r1', gate: makeGate(), headless: true });
    const handlers = win.webContents.handlers['page-title-updated'];
    expect(handlers && handlers.length).toBe(1);
    const event = { preventDefault: jest.fn() };
    handlers[0](event, 'Amicus — Verified by Anthropic');
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  // Code review follow-up: loadFile() returns a promise that REJECTS on load
  // failure. electron/workspace-ui/index.html does not exist until Task 11,
  // so today this rejects on every single launch — an unhandled rejection in
  // the main process. The failsafe (did-fail-load / timeout) already surfaces
  // this to the user and logs it, so the rejection itself must be swallowed,
  // not left dangling (precedent: main.js's own .loadURL(...).catch(() => {})).
  test('a rejecting loadFile() does not produce an unhandled promise rejection', async () => {
    class RejectingBrowserWindow extends FakeBrowserWindow {
      loadFile(...args) {
        this.loadFileArgs = args;
        return Promise.reject(new Error('ENOENT: workspace-ui/index.html not found'));
      }
    }
    jest.dontMock('electron');
    jest.resetModules();
    jest.doMock('electron', () => ({ BrowserWindow: RejectingBrowserWindow }), { virtual: true });
    ({ createWorkspaceWindow } = require('../../electron/workspace-shell'));

    const onUnhandledRejection = jest.fn();
    process.on('unhandledRejection', onUnhandledRejection);
    try {
      createWorkspaceWindow({ runId: 'r1', gate: makeGate(), headless: true });
      // Flush the microtask queue so a dangling (uncaught) rejection would
      // have surfaced by now.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(onUnhandledRejection).not.toHaveBeenCalled();
    } finally {
      process.removeListener('unhandledRejection', onUnhandledRejection);
    }
  });
});
