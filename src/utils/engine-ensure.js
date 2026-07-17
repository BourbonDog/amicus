/**
 * @module utils/engine-ensure
 * ensureEngine() — runtime engine self-heal at server start (report #2).
 *
 * The single-flight wrapper opencode-client.startServer calls when the engine
 * binary is missing: fast-path hasOpencodeBinary(); otherwise copy the engine
 * from a healthy sibling install via engine-repair, refresh PATH, and re-check.
 * A module-level promise stops concurrent fanout-leg server starts in one
 * process from re-copying. Only success is memoized; a failed attempt clears the
 * guard so a later call may retry. Mirrors src/sidecar/electron-ensure.js.
 */

'use strict';

const { hasOpencodeBinary: defaultHas } = require('./path-setup');

let _ensurePromise = null;

/** Test-only: clear the single-flight guard so each test starts clean. */
function _resetEnsureEngine() {
  _ensurePromise = null;
}

/**
 * Ensure the opencode engine is present, self-healing by copy if missing.
 * @param {object} [opts]
 * @param {object} [opts.deps] injected { hasOpencodeBinary, repairEngine, ensurePath, logProgress }
 * @param {object} [opts.repairOptions] forwarded to repairEngine (destPkgDir, etc.)
 * @returns {Promise<{ok:boolean, reason?:string, donor?:string}>}
 */
function ensureEngine({ deps = {}, repairOptions = {} } = {}) {
  const has = deps.hasOpencodeBinary || defaultHas;
  const repair = deps.repairEngine || ((o) => require('./engine-repair').repairEngine(o));
  const ensurePath = deps.ensurePath || require('./path-setup').ensureNodeModulesBinInPath;
  const logProgress = deps.logProgress
    || ((msg) => { try { process.stderr.write(`${msg}\n`); } catch { /* ignore */ } });

  // Fast path: already present. Cheap disk stat — safe every call.
  if (has()) { return Promise.resolve({ ok: true }); }

  // Single-flight: reuse an in-flight repair.
  if (_ensurePromise) { return _ensurePromise; }

  _ensurePromise = (async () => {
    logProgress('[amicus] OpenCode engine missing — self-healing by copying from a healthy install...');
    let result;
    try {
      result = await repair({ ...repairOptions });
    } catch (err) {
      return { ok: false, reason: `engine self-heal failed: ${err && err.message}` };
    }
    if (has()) {
      logProgress('[amicus] OpenCode engine restored.');
      return { ok: true, donor: result && result.donor };
    }
    return { ok: false, reason: (result && result.reason) || 'engine self-heal did not restore the binary' };
  })().then((r) => {
    if (r.ok) {
      try { ensurePath(); } catch { /* ignore */ } // refresh PATH so spawn('opencode') resolves
    } else {
      _ensurePromise = null; // failure is not memoized — a later call may retry
    }
    return r;
  }, (err) => {
    _ensurePromise = null;
    throw err;
  });

  return _ensurePromise;
}

module.exports = { ensureEngine, _resetEnsureEngine };
