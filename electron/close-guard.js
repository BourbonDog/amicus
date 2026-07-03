/**
 * Close Guard — auto-fold on window close (backlog B01)
 *
 * `mainWindow.on('close', ...)` used to destroy the window immediately
 * whenever no fold had run yet, silently discarding the session summary on
 * the most common "I'm done, close the window" path (red X / Cmd|Ctrl+Q /
 * window-all-closed). createCloseGuard() centralizes the decision so it can
 * be unit-tested without booting Electron:
 *
 *  - No fold attempted yet: prevent the destroy, invoke the SAME triggerFold
 *    closure (fold.js's own `folded` flag guards re-entrancy — this module
 *    never constructs a second fold handler). triggerFold's existing success
 *    path already closes the window itself; its failure path resets
 *    folded=false.
 *  - Fold already IN FLIGHT: prevent the destroy and let the in-flight fold
 *    finish and close the window on its own — regardless of who started it
 *    (a second user close during an auto-fold, or a close during a
 *    toolbar/shortcut-initiated fold, must both be blocked; a single
 *    `hasFolded()`-style flag that goes true at triggerFold ENTRY cannot
 *    distinguish in-flight from done, so this relies on fold.js's finer
 *    `isFolding()`/`hasCompleted()` split instead).
 *  - Fold already COMPLETED (the `[SIDECAR_FOLD]` stdout write actually
 *    succeeded): proceed exactly like the pre-existing behavior (no
 *    interception).
 *  - A close-initiated fold SETTLES WITHOUT COMPLETION — whether triggerFold
 *    rejects, or its outer catch swallows the error and resolves (e.g. the
 *    nudge-overlay executeJavaScript call throws synchronously on a
 *    destroyed webContents; fold.js's trailing `.catch()` there only guards
 *    promise rejection, not a sync throw) — fall back to the pre-existing
 *    destroy path so the user is never trapped with a window that can no
 *    longer be closed. A latch ensures the fallback destroy is not
 *    re-intercepted by this same guard, and a second rapid close click while
 *    a fold is in flight does not spawn another fold.
 *
 * This module is intentionally ignorant of external abort — `amicus abort` /
 * MCP amicus_abort SIGTERMs the Electron child process directly
 * (src/sidecar/interactive-abort.js killElectron), which is an OS-level kill
 * of the whole process, not a call into any renderer 'close' handler. Node
 * terminates immediately on SIGTERM unless the process itself installs a
 * 'SIGTERM' listener; main.js installs none, so that teardown can never route
 * through this guard.
 */

/**
 * @param {object} deps
 * @param {() => boolean} deps.hasFolded - fold.js's original entry-to-settle
 *   flag (kept for API-compatibility with other hasFolded() consumers; not
 *   used to gate the close decision here since it can't distinguish
 *   in-flight from done).
 * @param {() => boolean} [deps.isFolding] - Whether a fold is currently IN
 *   FLIGHT (entered but not yet completed). Falls back to `hasFolded()` when
 *   omitted, preserving the pre-fix (buggy) behavior for any caller that
 *   hasn't upgraded — but main.js always passes fold.js's real isFolding().
 * @param {() => boolean} [deps.hasCompleted] - Whether the fold's
 *   `[SIDECAR_FOLD]` stdout write has actually succeeded. Falls back to
 *   `hasFolded()` when omitted.
 * @param {(mainWindow: object, contentView: object) => Promise<void>} deps.triggerFold
 *   - The SAME fold.js closure used by the shortcut/toolbar/IPC paths.
 * @returns {{ handleClose: (event: object, mainWindow: object, contentView: object) => void }}
 */
function createCloseGuard({ hasFolded, isFolding, hasCompleted, triggerFold }) {
  const checkIsFolding = isFolding || hasFolded;
  const checkHasCompleted = hasCompleted || hasFolded;

  // Tracks whether THIS guard has already kicked off a close-initiated fold
  // attempt (in flight or settled-but-not-yet-fallen-back). Separate from
  // fold.js's own `folded` re-entrancy flag: this latch additionally prevents
  // a second fold attempt or a preventDefault loop around the fallback
  // destroy once the close-initiated fold has failed.
  let closeFoldAttempted = false;
  let fallbackFired = false;

  function destroyIfPossible(mainWindow) {
    if (fallbackFired) { return; }
    fallbackFired = true;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.destroy();
    }
  }

  function handleClose(event, mainWindow, contentView) {
    if (checkHasCompleted()) {
      // Fold already completed — proceed exactly like the pre-existing
      // behavior (no interception, no destroy call from the guard itself;
      // Electron's default close-then-'closed' sequence runs normally).
      return;
    }

    if (fallbackFired) {
      // The close-initiated fold already failed/timed out and the fallback
      // destroy has already fired (or is in flight). Do not re-intercept —
      // let this close event proceed so an already-invoked destroy()
      // re-entering 'close', or a straggling user click, cannot loop.
      return;
    }

    // Not completed yet — either no fold has been attempted, or one is
    // in flight (close-initiated or toolbar/shortcut-initiated). Either way
    // the destroy must be prevented so an in-flight summary is never
    // discarded out from under it.
    event.preventDefault();

    if (checkIsFolding() || closeFoldAttempted) {
      // A fold is already in flight (from this guard's own close-initiated
      // attempt, or from the toolbar/shortcut path) — do not spawn a second
      // one. Let it finish; its own success path closes the window, and if
      // it settles without completing, the .then() below falls back to
      // destroy so the window never gets permanently stuck open.
      return;
    }
    closeFoldAttempted = true;

    Promise.resolve(triggerFold(mainWindow, contentView)).then(() => {
      // triggerFold can RESOLVE without ever calling mainWindow.close() —
      // its outer catch swallows failures (including a synchronous throw
      // from the post-write nudge-overlay executeJavaScript call, which can
      // land AFTER the stdout write already flipped completed=true) and
      // returns normally instead of rejecting. fold.js's catch always resets
      // its `folded` flag back to false in that path, and only in that path
      // — the success path that actually reaches mainWindow.close() leaves
      // `folded` true. So hasFolded() being false here is the reliable
      // "settled without the window actually closing" signal, independent
      // of hasCompleted() (the summary can be safely on stdout while the
      // window itself never got closed). Skipping this check and trusting
      // completion alone would leave the window with no further close
      // handler able to fire — permanently open.
      if (!hasFolded()) {
        destroyIfPossible(mainWindow);
      }
    }, () => {
      // Close-initiated fold rejected outright. Never trap the user: fall
      // back to the original destroy path.
      destroyIfPossible(mainWindow);
    });
  }

  return { handleClose };
}

module.exports = { createCloseGuard };
