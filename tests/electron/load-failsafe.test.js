/**
 * Load Failsafe Tests
 *
 * The GUI shell only shows the window after the OpenCode UI finishes loading.
 * Without a failsafe, a failed or stalled load leaves an invisible window and
 * a silently hung process (the historical "Starting up... | 0 messages" hang).
 * attachLoadFailsafe must surface those failures exactly once.
 */

const { attachLoadFailsafe, buildLoadErrorHTML } = require('../../electron/load-failsafe');
const { tokenCss } = require('../../src/design/tokens');

/** Minimal stand-in for Electron's webContents event emitter */
function fakeWebContents() {
  const handlers = {};
  return {
    on(event, fn) { (handlers[event] = handlers[event] || []).push(fn); },
    emitFailLoad({ errorCode = -102, errorDescription = 'ERR_CONNECTION_REFUSED',
      validatedURL = 'http://localhost:4096/x', isMainFrame = true } = {}) {
      (handlers['did-fail-load'] || []).forEach(fn =>
        fn({}, errorCode, errorDescription, validatedURL, isMainFrame));
    }
  };
}

describe('attachLoadFailsafe', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  it('fires onFail with load details when the main frame fails to load', () => {
    const wc = fakeWebContents();
    const onFail = jest.fn();
    attachLoadFailsafe({ webContents: wc, timeoutMs: 15000, onFail });

    wc.emitFailLoad({ errorCode: -102, errorDescription: 'ERR_CONNECTION_REFUSED' });

    expect(onFail).toHaveBeenCalledTimes(1);
    expect(onFail).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'load-failed',
      errorCode: -102,
      errorDescription: 'ERR_CONNECTION_REFUSED',
      validatedURL: 'http://localhost:4096/x'
    }));
  });

  it('ignores subframe load failures', () => {
    const wc = fakeWebContents();
    const onFail = jest.fn();
    attachLoadFailsafe({ webContents: wc, timeoutMs: 15000, onFail });

    wc.emitFailLoad({ isMainFrame: false });

    expect(onFail).not.toHaveBeenCalled();
  });

  it('ignores ERR_ABORTED (-3), which fires on benign in-page redirects', () => {
    const wc = fakeWebContents();
    const onFail = jest.fn();
    attachLoadFailsafe({ webContents: wc, timeoutMs: 15000, onFail });

    wc.emitFailLoad({ errorCode: -3, errorDescription: 'ERR_ABORTED' });

    expect(onFail).not.toHaveBeenCalled();
  });

  it('fires onFail with reason timeout when nothing resolves in time', () => {
    const wc = fakeWebContents();
    const onFail = jest.fn();
    attachLoadFailsafe({ webContents: wc, timeoutMs: 15000, onFail });

    jest.advanceTimersByTime(14999);
    expect(onFail).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(onFail).toHaveBeenCalledTimes(1);
    expect(onFail).toHaveBeenCalledWith(expect.objectContaining({ reason: 'timeout' }));
  });

  it('defaults the timeout to 15s when not specified', () => {
    const wc = fakeWebContents();
    const onFail = jest.fn();
    attachLoadFailsafe({ webContents: wc, onFail });

    jest.advanceTimersByTime(15000);
    expect(onFail).toHaveBeenCalledWith(expect.objectContaining({ reason: 'timeout' }));
  });

  it('cancel() disarms both the timer and later load failures', () => {
    const wc = fakeWebContents();
    const onFail = jest.fn();
    const failsafe = attachLoadFailsafe({ webContents: wc, timeoutMs: 15000, onFail });

    failsafe.cancel();
    jest.advanceTimersByTime(15000);
    wc.emitFailLoad();

    expect(onFail).not.toHaveBeenCalled();
  });

  it('fires at most once: a load failure disarms the timeout', () => {
    const wc = fakeWebContents();
    const onFail = jest.fn();
    attachLoadFailsafe({ webContents: wc, timeoutMs: 15000, onFail });

    wc.emitFailLoad();
    jest.advanceTimersByTime(15000);
    wc.emitFailLoad();

    expect(onFail).toHaveBeenCalledTimes(1);
  });
});

describe('buildLoadErrorHTML', () => {
  it('includes the failed URL and error description', () => {
    const html = buildLoadErrorHTML({
      url: 'http://localhost:4096/abc/session/ses_1',
      errorCode: -102,
      errorDescription: 'ERR_CONNECTION_REFUSED'
    });
    expect(html).toContain('http://localhost:4096/abc/session/ses_1');
    expect(html).toContain('ERR_CONNECTION_REFUSED');
    expect(html).toContain('-102');
  });

  it('HTML-escapes interpolated values', () => {
    const html = buildLoadErrorHTML({
      url: 'http://x/<script>alert(1)</script>',
      errorCode: 0,
      errorDescription: '<b>'
    });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('inlines the design-token CSS with absolute font URLs (renders in a data: URL after everything failed)', () => {
    const html = buildLoadErrorHTML({
      url: 'http://localhost:4096/x', errorCode: -102, errorDescription: 'ERR'
    });
    // The whole token :root{} + @font-face block is prepended inline.
    expect(html).toContain(tokenCss({ absoluteFontUrls: true }));
    // Absolute font URLs are required: relative ./fonts/*.ttf would never resolve
    // in a data: URL context.
    expect(html).toMatch(/url\('file:\/\/.*\/fonts\//);
    expect(html).not.toMatch(/url\('\.\/fonts\//);
  });

  it('drives colors and fonts off token vars, not hardcoded hex/system fonts', () => {
    const html = buildLoadErrorHTML({
      url: 'http://localhost:4096/x', errorCode: -102, errorDescription: 'ERR'
    });
    expect(html).toContain('var(--bg)');
    expect(html).toContain('var(--text-1)');
    expect(html).toContain('var(--text-2)');
    expect(html).toContain('var(--accent)');
    expect(html).toContain('var(--font-sans)');
    expect(html).toContain('var(--font-mono)');
    // No leftover hardcoded page-rule palette from the pre-token version. (The
    // inlined token :root{} block legitimately defines the accent hex, so we
    // only assert the page's own rules no longer hardcode the old palette.)
    expect(html).not.toMatch(/background:\s*#2D2B2A/i);
    expect(html).not.toMatch(/#D4D0CC|#A09B96/i);
  });
});
