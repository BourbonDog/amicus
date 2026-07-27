'use strict';

/**
 * The Electron E2E skip guard, extracted so it can be EXERCISED rather than asserted by
 * code-identity with a sibling suite (v4.4.1 TST-10c).
 *
 * ⚠️ Why this matters. `ci.yml`'s `integration` job runs `npm run test:integration` on
 * ubuntu-latest, where a display-less runner cannot open an Electron window: without the
 * guard every CDP test times out instead of skipping, and the job goes red for a reason
 * that has nothing to do with the change under test. The guard was previously an inline
 * expression inside `electron-workspace-e2e.integration.test.js`, defended only by a
 * comment saying it was copied verbatim from the toolbar suite — i.e. the ONE branch that
 * matters (`linux && !DISPLAY`) was never executed anywhere, on any platform, because the
 * suites that contain it are themselves skipped exactly when it is false.
 *
 * Keeping it here as two pure functions lets tests/electron/display-guard.test.js drive
 * both branches on any platform by passing the inputs in, with no environment mutation.
 */

/**
 * Can Electron open a window here?
 *
 * Only Linux needs an X display; macOS and Windows always can. On Linux the answer is
 * "yes" only when DISPLAY is set — either by the developer's own session or by the
 * `ensureDisplay()` Xvfb helper the E2E suites provision in beforeAll.
 * @param {string} [platform] defaults to the running platform
 * @param {object} [env] defaults to process.env
 * @returns {boolean}
 */
function hasDisplay(platform = process.platform, env = process.env) {
  return platform !== 'linux' || !!env.DISPLAY;
}

/**
 * The describe to register an Electron E2E suite with: the real one only when BOTH an
 * electron binary and a usable display are available, otherwise `describe.skip`.
 * @param {boolean} hasElectron truthiness of require('electron')'s resolved binary path
 * @param {boolean} displayOk hasDisplay()
 * @returns {Function} `describe` or `describe.skip`
 */
function chooseDescribe(hasElectron, displayOk) {
  return (hasElectron && displayOk) ? describe : describe.skip;
}

module.exports = { hasDisplay, chooseDescribe };
