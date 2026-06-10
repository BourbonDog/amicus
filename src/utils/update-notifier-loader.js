/**
 * update-notifier Loader
 *
 * update-notifier v6+ is ESM-only: require() throws ERR_REQUIRE_ESM, so the
 * package must be loaded with a dynamic import(). The import lives in this
 * CJS seam so unit tests can mock it — jest's CJS test VM cannot execute a
 * native import() without --experimental-vm-modules.
 */

/**
 * Dynamically import the update-notifier module.
 * @returns {Promise<object>} Module namespace; the constructor is `.default`
 */
function loadUpdateNotifier() {
  return import('update-notifier');
}

module.exports = { loadUpdateNotifier };
