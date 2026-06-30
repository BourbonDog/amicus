/**
 * ensureElectron() — lazy first-GUI provisioning (#55).
 *
 * This is the ONLY entry point allowed to PROVISION (download/extract) electron,
 * and only on FIRST GUI use. getElectronPath()/checkElectronAvailable() stay
 * PURE PROBES: the doctor check (cli-handlers-doctor.js) and MCP amicus_setup
 * (mcp-server.js) depend on that purity — making a probe provision would silently
 * fetch ~170MB. Kept in its own module so src/sidecar/electron-install.js stays
 * under the 300-line size gate.
 */

'use strict';

const {
  isElectronUsable: defaultIsUsable,
  resolveElectronBinary: defaultResolve,
  repairElectron: defaultRepair,
} = require('./electron-install');

/**
 * Module-level single-flight guard. Holds the in-flight (or last SUCCESSFUL)
 * provision promise so repeated GUI launches in one process never re-download.
 * A FAILED provision is cleared so a later launch may retry.
 */
let _ensurePromise = null;

/** Test-only: clear the once-guard so each test starts single-flight-clean. */
function _resetEnsureElectron() {
  _ensurePromise = null;
}

/**
 * Lazily PROVISION electron on FIRST GUI use.
 *
 * Flow: if isElectronUsable() return the resolved path (NO repair). Otherwise
 * call repairElectron({cacheOnly:false}) — network ALLOWED here, this is an
 * explicit first-use provision — with progress messaging, then re-check.
 *
 * Single-flight: the in-flight / last-successful promise is memoized so
 * concurrent and repeated launches share ONE provision. A failed attempt is
 * NOT cached (the guard is cleared) so a later launch can retry.
 *
 * @param {object} opts
 * @param {object} [opts.deps] injected
 *   { isElectronUsable, resolveElectronBinary, repairElectron, logProgress }.
 * @param {object} [opts.repairOptions] forwarded to repairElectron (electronDir, etc.).
 * @returns {Promise<{ok:boolean, path?:string, reason?:string}>}
 */
function ensureElectron({ deps = {}, repairOptions = {} } = {}) {
  const usable = deps.isElectronUsable || defaultIsUsable;
  const resolve = deps.resolveElectronBinary || defaultResolve;
  const repair = deps.repairElectron || defaultRepair;
  const logProgress = deps.logProgress
    || ((msg) => { try { process.stderr.write(`${msg}\n`); } catch { /* ignore */ } });

  // Fast path: already provisioned. Cheap stat — safe to run every launch.
  if (usable()) {
    return Promise.resolve({ ok: true, path: resolve() });
  }

  // Single-flight: reuse an in-flight (or already-succeeded) provision.
  if (_ensurePromise) { return _ensurePromise; }

  _ensurePromise = (async () => {
    logProgress('[amicus] Provisioning the Electron GUI binary (first GUI use, ~170MB). This runs once...');
    let result;
    try {
      result = await repair({ cacheOnly: false, ...repairOptions });
    } catch (err) {
      return { ok: false, reason: `Electron provisioning failed: ${err && err.message}` };
    }
    if (usable()) {
      logProgress('[amicus] Electron GUI ready.');
      return { ok: true, path: resolve() };
    }
    const reason = (result && result.reason)
      || 'Electron could not be provisioned; the GUI is unavailable. Run `amicus doctor --fix` or use --no-ui.';
    return { ok: false, reason };
  })().then((r) => {
    // Only memoize SUCCESS; a failure clears the guard so a later launch retries.
    if (!r.ok) { _ensurePromise = null; }
    return r;
  }, (err) => {
    _ensurePromise = null;
    throw err;
  });

  return _ensurePromise;
}

module.exports = { ensureElectron, _resetEnsureElectron };
