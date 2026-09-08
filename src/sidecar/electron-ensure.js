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
const HINTS = require('../utils/remediation-hints');

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
 * @returns {Promise<{ok:boolean, path?:string, reason?:string, unverified?:boolean}>}
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
      // A2/B3 (council, confirmed 4 of 4): `unverified` was WRITTEN on both
      // provision routes and read by nothing in src/ or scripts/, while the docs
      // said the outcome was "marked unverified". A flag no code and no human
      // ever sees establishes no property at all. This is the launch-time
      // reader; scripts/postinstall.js is the install-time one and
      // doctor-electron-mcp-check.js reports it from `--fix`.
      if (result && result.unverified) {
        logProgress('[amicus] NOTE: this Electron binary is UNVERIFIED — either no published sha256 covered');
        logProgress('[amicus]   the artifact it came from, so its bytes were vouched for only by the');
        logProgress('[amicus]   mirror that served them, or its sha256 CONTRADICTED the published one and');
        logProgress('[amicus]   AMICUS_ALLOW_UNVERIFIED_ELECTRON accepted it anyway.');
      }
      logProgress('[amicus] Electron GUI ready.');
      return { ok: true, path: resolve(), ...(result && result.unverified ? { unverified: true } : {}) };
    }
    // THE POINTER IS NOT OPTIONAL. This used to be `result.reason || <the
    // pointer>`, so the moment `repairElectron` started returning a reason for a
    // failed controlled download (v4.9.6, when the last-resort installer was
    // deleted and the failure became something to REPORT), the one line telling
    // the user what to do next silently disappeared. A more detailed message is
    // not a reason to stop giving advice.
    const detail = (result && result.reason) || 'Electron could not be provisioned; the GUI is unavailable.';
    // Matched on the COMMAND, not on the whole hint string: the AV-quarantine
    // reason already ends with a bare `amicus doctor --fix` and must not be
    // given a second, longer copy of the same advice.
    const reason = detail.includes('doctor --fix') ? detail : `${detail} ${HINTS.doctorFix} (or use --no-ui).`;
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
