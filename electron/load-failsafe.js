/**
 * Load Failsafe
 *
 * The Amicus window is created hidden and only shown after the OpenCode UI
 * finishes loading (main.js did-finish-load -> rebrand -> show). If that load
 * fails or stalls, nothing would ever show the window: the process sits as an
 * invisible, silent hang (the historical "Starting up... | 0 messages" bug).
 *
 * attachLoadFailsafe watches a webContents and fires onFail exactly once when
 * the main frame definitively fails to load, or when nothing has resolved
 * within timeoutMs. The caller decides how to surface it (show the window,
 * render an error page, log). cancel() disarms it on the success path.
 */

'use strict';

const { tokenCss } = require('../src/design/tokens');

const DEFAULT_TIMEOUT_MS = 15000;
const ERR_ABORTED = -3; // benign: fires on in-page redirects/navigation replacement

/**
 * Watch a webContents for startup load failure or stall.
 * @param {{ webContents: object, timeoutMs?: number, onFail: Function }} opts
 * @returns {{ cancel: Function }} call cancel() once the window is shown
 */
function attachLoadFailsafe({ webContents, timeoutMs = DEFAULT_TIMEOUT_MS, onFail }) {
  let settled = false;

  const fire = (detail) => {
    if (settled) { return; }
    settled = true;
    clearTimeout(timer);
    onFail(detail);
  };

  const timer = setTimeout(() => fire({ reason: 'timeout' }), timeoutMs);

  webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === ERR_ABORTED) { return; }
    fire({ reason: 'load-failed', errorCode, errorDescription, validatedURL });
  });

  return {
    cancel() {
      settled = true;
      clearTimeout(timer);
    }
  };
}

/** @param {*} value @returns {string} HTML-escaped text */
function escapeHTML(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Error page shown in the content area when the OpenCode UI fails to load.
 * @param {{ url: string, errorCode: number|string, errorDescription: string }} info
 * @returns {string} full HTML document
 */
function buildLoadErrorHTML({ url, errorCode, errorDescription }) {
  // This page renders after the OpenCode UI definitively failed to load, in a
  // data: URL context. Inline the design tokens with absolute font URLs so the
  // bundled webfonts resolve and var(--x) references work with no external CSS.
  return `<!DOCTYPE html>
<html><head><style>
${tokenCss({ absoluteFontUrls: true })}
  body { background: var(--bg); color: var(--text-2);
         font-family: var(--font-sans);
         display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
  .box { max-width: 440px; padding: 24px; }
  h1 { color: var(--accent); font-size: 16px; margin: 0 0 12px; }
  p { font-size: 13px; line-height: 1.5; color: var(--text-2); margin: 0 0 10px; }
  code { font-family: var(--font-mono); font-size: 11px; color: var(--text-1);
         word-break: break-all; }
</style></head><body>
  <div class="box">
    <h1>Amicus could not load the conversation UI</h1>
    <p><code>${escapeHTML(errorDescription)} (${escapeHTML(errorCode)})</code></p>
    <p>Failed URL: <code>${escapeHTML(url)}</code></p>
    <p>The OpenCode server may have stopped. Close this window and rerun the
       command, or use <code>--no-ui</code> for headless mode.</p>
  </div>
</body></html>`;
}

module.exports = { attachLoadFailsafe, buildLoadErrorHTML, DEFAULT_TIMEOUT_MS };
