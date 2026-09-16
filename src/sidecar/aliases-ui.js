/**
 * @module sidecar/aliases-ui
 * `amicus aliases --ui` (#238 D4): the Electron setup window opened on the Routing step.
 * The same alias editor, plus the "Needs review" section
 * (electron/setup-ui-alias-review.js). Owns the form the way aliases-unpin.js
 * owns `--unpin`: aliases.js sits near the 300-line gate. Interactive-only,
 * so it combines with none of the machine or terminal forms (R-P3-12). Like
 * every `amicus aliases` form it normalizes the config on entry (D6) BEFORE
 * the window opens — the caller binds that step, because `normalizeOnEntry`
 * is aliases.js's private helper. A launch that REJECTS (no Electron, spawn
 * failure) takes the same exit-1 path as a refused one — the reason on
 * stderr with the terminal alternative — instead of escaping as an unhandled
 * rejection (council review of PR 253, B2; `setup --api-keys` catches too).
 */

'use strict';

/**
 * @param {object} args parsed CLI args
 * @param {() => void} normalizeOnEntry aliases.js's D6 on-entry normalization, bound by the caller
 * @param {{launchSetupWindow?: Function}} [deps] test injection; defaults to setup-window.js
 * @returns {Promise<number>} exit code: 0 on Finish, 1 otherwise
 */
async function handleAliasesUi(args, normalizeOnEntry, deps = {}) {
  if (args.json || args.review || args.owner || args.unpin !== undefined) {
    process.stderr.write('Error: --ui opens the setup window at the Routing step; it cannot be combined with --json, --review, --owner or --unpin\n');
    return 1;
  }
  normalizeOnEntry();
  const launch = deps.launchSetupWindow || require('./setup-window').launchSetupWindow;
  let res;
  try { res = await launch({ pane: 'aliases' }); }
  catch (err) { res = { success: false, error: 'Could not launch the setup window: ' + ((err && err.message) || err) }; }   // a rejected launch is the same exit-1 path as a refused one (R-P3-12 follows setup --api-keys, which catches too)
  if (!res || !res.success) {
    process.stderr.write(`${(res && res.error) || 'Setup window closed without completing'}\nTerminal alternative: amicus aliases --review\n`);
    return 1;
  }
  process.stdout.write('Aliases saved.\n');
  return 0;
}

module.exports = { handleAliasesUi };
