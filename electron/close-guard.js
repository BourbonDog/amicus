/**
 * Close Guard — auto-fold on window close (backlog B01)
 *
 * `mainWindow.on('close', ...)` used to destroy the window immediately
 * whenever no fold had run yet, silently discarding the session summary on
 * the most common "I'm done, close the window" path (red X / Cmd|Ctrl+Q /
 * window-all-closed). createCloseGuard() centralizes the decision so it can
 * be unit-tested without booting Electron:
 *
 *  - No fold yet: prevent the destroy, invoke the SAME triggerFold closure
 *    (fold.js's own `folded` flag guards re-entrancy — this module never
 *    constructs a second fold handler). triggerFold's existing success path
 *    already closes the window itself; its failure path resets folded=false.
 *  - Fold already in flight: prevent the destroy and let the in-flight fold
 *    finish and close the window on its own.
 *  - Fold already completed: proceed exactly like the pre-existing behavior
 *    (no interception).
 *  - Close-initiated fold fails or times out: fall back to the pre-existing
 *    destroy path so the user is never trapped. A latch ensures the fallback
 *    destroy is not re-intercepted by this same guard, and a second rapid
 *    close click while a fold is in flight does not spawn another fold.
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
 * @param {() => boolean} deps.hasFolded - Whether triggerFold has already
 *   succeeded (fold.js's `folded` flag reflects both "in flight" and "done";
 *   this guard only needs to know "should I attempt a NEW fold").
 * @param {(mainWindow: object, contentView: object) => Promise<void>} deps.triggerFold
 *   - The SAME fold.js closure used by the shortcut/toolbar/IPC paths.
 * @returns {{ handleClose: (event: object, mainWindow: object, contentView: object) => void }}
 */
function createCloseGuard({ hasFolded, triggerFold }) {
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
    if (hasFolded()) {
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

    // No fold yet, or one already in flight from an earlier close event on
    // this same guard: prevent the immediate destroy either way.
    event.preventDefault();

    if (closeFoldAttempted) {
      // A fold from a previous close event is already in flight — do not
      // spawn a second one. Let it finish and close the window itself.
      return;
    }
    closeFoldAttempted = true;

    Promise.resolve(triggerFold(mainWindow, contentView)).catch(() => {
      // Close-initiated fold failed or timed out (fold.js already logged the
      // reason and reset its own `folded` flag to false). Never trap the
      // user: fall back to the original destroy path.
      destroyIfPossible(mainWindow);
    });
  }

  return { handleClose };
}

module.exports = { createCloseGuard };
