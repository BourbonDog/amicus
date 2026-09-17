/**
 * Issue 212 — refuse a write to the REAL user's amicus key store from inside a
 * test run.
 *
 * A fixture-shaped key reached a real ~/.config/amicus/.env. The entry point
 * that could do it was the unvalidated sidecar:save-key IPC (fixed in
 * electron/ipc-keys.js); this is the other half of the ask — "a test suite
 * should never be ABLE to write a real key store", whatever the vector.
 *
 * It started on saveApiKey alone, which left removeApiKey, saveRawEnv,
 * removeRawEnv and migrateEnvFileKey writing the same file unguarded (council
 * review of PR 262, A2/D4). It now sits at the chokepoint: env-raw-store.js's
 * upsertEnvLine/deleteEnvLine call assertNotTestWriteToRealKeyStore, and
 * migrateEnvFileKey — which writes with fs.writeFileSync and does NOT come
 * through that funnel (measured) — calls it directly.
 *
 * Its own module rather than more lines in env-raw-store.js: that file would
 * have gone to 309 of the 300-line gate. Requires nothing but fs/os/path, so it
 * introduces no cycle.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * The REAL user's home, immune to a redirected HOME/USERPROFILE.
 *
 * ⚠️ NOT os.homedir(): libuv reads HOME (POSIX) / USERPROFILE (Windows) before
 * it asks the OS, so os.homedir() follows exactly the redirect a test performs
 * — measured on both code paths. os.userInfo() reads the account record instead
 * (getpwuid_r / GetUserProfileDirectoryW) and does not move.
 *
 * Returns null when there is no account record to read (containers without a
 * passwd entry); the caller then declines to guard rather than guessing, since
 * this is a backstop and a false refusal would break honest writes.
 * @returns {string|null}
 */
function realHomedir() {
  try {
    const home = os.userInfo().homedir;
    return typeof home === 'string' && home.length > 0 ? home : null;
  } catch (_err) {
    return null;
  }
}

/**
 * Resolve symlinks in `p`, falling back to the deepest ancestor that exists.
 *
 * fs.realpathSync throws ENOENT for a path that is not there yet, and the path
 * being guarded is usually a `.env` that has not been created — but its PARENT
 * may still be a symlink (or, on Windows, a junction) into the real config dir,
 * which is the C2 attack. So walk up to the deepest existing ancestor, resolve
 * that, and re-attach the remainder lexically.
 * @param {string} p an absolute path
 * @returns {string}
 */
function realpathOrSelf(p) {
  try {
    return fs.realpathSync(p);
  } catch (_err) {
    const parent = path.dirname(p);
    if (parent === p) { return p; }          // reached the root: nothing left to walk
    return path.join(realpathOrSelf(parent), path.basename(p));
  }
}

/** Absolute path → its non-empty path segments (no `.`/`..` survive path.resolve). */
function segmentsOf(p) {
  return path.resolve(p).split(/[\\/]+/).filter(Boolean);
}

/**
 * Is `child` the same path as `parent`, or inside it?
 *
 * Both sides go through realpathOrSelf first, so a symlink or a junction cannot
 * disguise one as the other (C2).
 *
 * Compared SEGMENT BY SEGMENT rather than via path.relative. Two reasons, both
 * from the council review of PR 262:
 *   - the old `!rel.startsWith('..')` test read a child literally named
 *     `..secret` as an escape (D3). Segments have no such ambiguity — after
 *     path.resolve there are no `..` components left to misread.
 *   - path.relative case-folds according to the RUNNING platform (win32 folds,
 *     posix does not), so it cannot honour an injected `platform`. Measured: the
 *     `platform: 'linux'` arm still compared case-insensitively on a Windows
 *     host. Folding explicitly here makes the parameter mean something, which is
 *     what lets both arms of A3/B1 run on every CI host.
 *
 * Case is folded on win32 and darwin, whose DEFAULT filesystems are
 * case-insensitive. That is a comparison aid, not a filesystem truth: a
 * case-SENSITIVE volume mounted on macOS could see two distinct paths called
 * equal. The consequence is refusing a write inside a test run that could have
 * been allowed — the harmless direction.
 *
 * @param {string} child
 * @param {string} parent
 * @param {string} [platform] process.platform, injectable for tests
 * @returns {boolean}
 */
function isWithin(child, parent, platform = process.platform) {
  const fold = platform === 'win32' || platform === 'darwin';
  const norm = (s) => (fold ? s.toLowerCase() : s);
  const c = segmentsOf(realpathOrSelf(path.resolve(child))).map(norm);
  const p = segmentsOf(realpathOrSelf(path.resolve(parent))).map(norm);
  if (c.length < p.length) { return false; }
  return p.every((seg, i) => c[i] === seg);
}

/**
 * Would this write land in the REAL user's amicus key store from inside a test
 * run? Deliberately narrow — it must never refuse an honest write.
 *
 * Three conditions, all required:
 *   1. inside jest (JEST_WORKER_ID);
 *   2. AMICUS_ENV_DIR unset. This is ALSO the documented opt-out (council review
 *      of PR 262, B2/D2/D4): the var is an explicit redirect, so a caller that
 *      sets it — even at the real config dir — has asked for that write and the
 *      guard stands down. tests/setup/hermetic-config-dir.js sets it for every
 *      unit file, so the guard only has work where a test DELETED it (several in
 *      tests/api-key-store.test.js do, to exercise getEnvPath()'s HOME fallback);
 *   3. the resolved path is the real home's `.config/amicus` directory, or inside it.
 *
 * ⚠️ Condition 3 is the amicus CONFIG DIR, not the home dir. On Windows
 * os.tmpdir() is C:\Users\<user>\AppData\Local\Temp — inside the real home — so
 * "is it under the home dir" would refuse every legitimately HOME-redirected
 * test on that platform. Measured, not assumed.
 *
 * @param {string} envPath the .env path the write would target
 * @param {object} [deps] injected for tests — never touch the real home in one
 * @param {object} [deps.env] environment to read (default process.env)
 * @param {function(): (string|null)} [deps.homedir] the real home (default realHomedir)
 * @param {string} [deps.platform] process.platform
 * @returns {boolean}
 */
function isTestWriteToRealKeyStore(
  envPath, { env = process.env, homedir = realHomedir, platform = process.platform } = {}
) {
  if (!env.JEST_WORKER_ID) { return false; }
  if (env.AMICUS_ENV_DIR) { return false; }
  const home = homedir();
  if (!home) { return false; }
  return isWithin(envPath, path.join(home, '.config', 'amicus'), platform);
}

/**
 * Throw before any write isTestWriteToRealKeyStore refuses.
 *
 * THROWS rather than returning a result on purpose — the failure this replaces
 * was a silent overwrite of a user credential that masqueraded as a missing
 * product feature for an unknown period.
 * @param {string} envPath
 * @param {object} [deps] see isTestWriteToRealKeyStore
 */
function assertNotTestWriteToRealKeyStore(envPath, deps) {
  if (!isTestWriteToRealKeyStore(envPath, deps)) { return; }
  const err = new Error(
    `Refusing to write the real API key store from a test run: ${envPath}. `
    + 'Set AMICUS_ENV_DIR to a temp dir (tests/setup/hermetic-config-dir.js does '
    + 'this for every unit file) before writing. See issue 212.'
  );
  err.code = 'TEST_ENV_WRITE_REFUSED';
  throw err;
}

module.exports = {
  isWithin,
  realHomedir,
  realpathOrSelf,
  isTestWriteToRealKeyStore,
  assertNotTestWriteToRealKeyStore,
};
