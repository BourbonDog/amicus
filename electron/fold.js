/**
 * Fold Logic
 *
 * Handles the fold action: showing overlay, requesting summary,
 * outputting fold data to stdout, and closing the window.
 */

const { logger } = require('../src/utils/logger');
const { requestSummaryFromModel } = require('./summary');
const { getSummaryTemplate } = require('../src/prompt-builder');
const { tokenCss } = require('../src/design/tokens');
const { buildFoldMarker, generateFoldNonce } = require('../src/utils/fold-marker');

/**
 * Create a fold handler bound to the window state
 * @param {object} state - Shared state object
 * @param {string} state.model - Model name
 * @param {string} state.client - Client type
 * @param {string} state.cwd - Working directory
 * @param {string} state.sessionId - OpenCode session ID
 * @param {string} state.taskId - Sidecar task ID
 * @param {number} state.port - OpenCode server port
 * @param {string} [state.nonce] - Per-run fold nonce (15b.3, #BL-7 residual). Set by
 *   main.js from AMICUS_FOLD_NONCE — the SAME value baked into the system prompt's
 *   fold instruction, so a completion this handler writes matches what the model was
 *   actually asked to emit. Falls back to a freshly generated nonce when absent (e.g.
 *   a caller/test that doesn't thread one through) — this is purely defensive: the
 *   GUI fold path is exit-code driven, not marker-detected, so an un-advertised
 *   fallback nonce here cannot be exploited the way headless.js's detector could.
 * @returns {{ triggerFold: Function, hasFolded: Function, isFolding: Function, hasCompleted: Function }}
 */
function createFoldHandler(state) {
  const nonce = state.nonce || generateFoldNonce();
  // `folded` is set synchronously at triggerFold ENTRY and covers both
  // "in flight" and "done" — this is `hasFolded()`'s existing external
  // contract (main.js wires it straight into createCloseGuard's `hasFolded`
  // dep) and must not change. `completed` is the finer-grained signal: it
  // only flips true AFTER the `[SIDECAR_FOLD]` stdout write actually
  // succeeds, so callers that need to distinguish "still running" from
  // "actually done" (close-guard.js) use isFolding()/hasCompleted() instead.
  let folded = false;
  let completed = false;

  async function triggerFold(mainWindow, opencodeView) {
    if (folded) { return; }
    folded = true;
    completed = false;

    // Show fold progress in toolbar and content overlay
    showFoldOverlay(mainWindow, opencodeView);

    try {
      // Ask the model to generate a structured summary
      let summary = '';
      try {
        summary = await requestSummaryFromModel(
          state.sessionId, state.port, getSummaryTemplate
        );
      } catch (err) {
        logger.warn('Failed to get model summary', { error: err.message });
      }

      const output = [
        buildFoldMarker(nonce),
        `Model: ${state.model}`,
        `Session: ${state.sessionId || state.taskId}`,
        `Client: ${state.client}`,
        `CWD: ${state.cwd}`,
        'Mode: interactive',
        '---',
        summary || 'Session ended without summary.'
      ].join('\n');

      process.stdout.write(output + '\n');
      completed = true;
      logger.info('Fold completed', { taskId: state.taskId });

      // Show nudge overlay before closing
      if (opencodeView) {
        await opencodeView.webContents.executeJavaScript(`
          (function() {
            var overlay = document.getElementById('amicus-fold-overlay');
            if (overlay) {
              while (overlay.firstChild) { overlay.removeChild(overlay.firstChild); }
              var msg = document.createElement('div');
              msg.style.cssText = 'color:var(--text-1);font-family:var(--font-sans),-apple-system,BlinkMacSystemFont,sans-serif;font-size:15px;font-weight:500;text-align:center;max-width:320px;';
              msg.textContent = 'Summary saved. Tell Claude you\\u2019re done with the Amicus session so it can read the results.';
              overlay.appendChild(msg);
            }
          })();
        `).catch(() => {});
      }

      // Wait 2.5s for user to read the nudge, then close
      await new Promise(resolve => setTimeout(resolve, 2500));
    } catch (err) {
      logger.error('Fold failed', { error: err.message });
      // Reset re-entrancy so a later close/shortcut/toolbar click can retry.
      // NOTE: this can fire AFTER the `[SIDECAR_FOLD]` stdout write already
      // succeeded (completed = true, set above) if the post-write nudge-overlay
      // executeJavaScript call throws SYNCHRONOUSLY on a destroyed webContents
      // (the trailing .catch() on that call only guards promise rejection, not
      // a synchronous throw) — the summary is safely on stdout in that case,
      // but the window was never closed by this run, so folded must still
      // reset to let a fallback close proceed. completed is left as-is:
      // close-guard.js checks it independently to decide whether a pending
      // close can simply proceed (summary already landed) or must fall back
      // to destroy (summary never made it out).
      folded = false;
      return;
    }

    // Close the window after fold
    const { app } = require('electron');
    if (mainWindow) {
      mainWindow.close();
    } else {
      app.quit();
    }
  }

  function hasFolded() {
    return folded;
  }

  // isFolding(): true only while a fold is IN FLIGHT (entered but not yet
  // completed) — the signal close-guard.js needs to keep a close blocked
  // regardless of who initiated the fold (close-initiated or
  // toolbar/shortcut-initiated), since hasFolded() alone can't distinguish
  // in-flight from done.
  function isFolding() {
    return folded && !completed;
  }

  // hasCompleted(): true once (and only once) the `[SIDECAR_FOLD]` stdout
  // write has actually succeeded — the signal close-guard.js needs to know
  // the summary is safely handed off and a close may proceed.
  function hasCompleted() {
    return completed;
  }

  return { triggerFold, hasFolded, isFolding, hasCompleted };
}

/**
 * Show fold progress overlay in both the toolbar and the content view.
 * Note: The JS strings below contain only hardcoded markup (no user input),
 * so there is no XSS risk from DOM manipulation.
 */
function showFoldOverlay(mainWindow, opencodeView) {
  if (mainWindow) {
    mainWindow.webContents.executeJavaScript(`
      (function() {
        var btn = document.getElementById('fold-btn');
        if (btn) {
          btn.textContent = '';
          var span = document.createElement('span');
          span.style.cssText = 'display:inline-flex;align-items:center;gap:6px;';
          var spinner = document.createElement('span');
          spinner.style.cssText = 'width:12px;height:12px;border:2px solid rgba(255,255,255,0.3);border-top-color:var(--on-accent);border-radius:50%;animation:spin 0.8s linear infinite;display:inline-block;';
          span.appendChild(spinner);
          span.appendChild(document.createTextNode('Generating summary\\u2026'));
          btn.appendChild(span);
          btn.disabled = true;
          btn.style.opacity = '0.85';
          btn.style.cursor = 'default';
        }
        if (!document.getElementById('fold-spin-style')) {
          var style = document.createElement('style');
          style.id = 'fold-spin-style';
          style.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
          document.head.appendChild(style);
        }
      })();
    `).catch(() => {});
  }
  if (opencodeView) {
    // Scope token vars to the overlay container so var(--x) resolves without
    // touching OpenCode's own :root (which would clobber its CSS variables).
    const rawCss = tokenCss({ absoluteFontUrls: true });
    // Replace only the :root selector (not occurrences inside comments) so the
    // custom properties are defined on #amicus-fold-overlay and inherited by
    // its descendants. @font-face blocks are left at global scope (no selector).
    const scopedCss = rawCss.replace(/:root\s*\{/, '#amicus-fold-overlay {');
    opencodeView.webContents.insertCSS(scopedCss).catch(() => {});

    opencodeView.webContents.executeJavaScript(`
      (function() {
        if (!document.getElementById('fold-spin-style')) {
          var style = document.createElement('style');
          style.id = 'fold-spin-style';
          style.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
          document.head.appendChild(style);
        }
        var overlay = document.createElement('div');
        overlay.id = 'amicus-fold-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:99999;';

        var spinDiv = document.createElement('div');
        spinDiv.style.cssText = 'width:32px;height:32px;border:3px solid var(--accent-line);border-top-color:var(--accent);border-radius:50%;animation:spin 0.8s linear infinite;margin-bottom:16px;';
        overlay.appendChild(spinDiv);

        var titleDiv = document.createElement('div');
        titleDiv.style.cssText = 'color:var(--text-1);font-family:var(--font-sans),-apple-system,BlinkMacSystemFont,sans-serif;font-size:15px;font-weight:500;';
        titleDiv.textContent = 'Generating summary\\u2026';
        overlay.appendChild(titleDiv);

        var subtitleDiv = document.createElement('div');
        subtitleDiv.style.cssText = 'color:var(--text-3);font-family:var(--font-sans),-apple-system,BlinkMacSystemFont,sans-serif;font-size:12px;margin-top:6px;';
        subtitleDiv.textContent = 'Folding session back to Claude Code';
        overlay.appendChild(subtitleDiv);

        document.body.appendChild(overlay);
      })();
    `).catch(() => {});
  }
}

module.exports = { createFoldHandler, showFoldOverlay };
