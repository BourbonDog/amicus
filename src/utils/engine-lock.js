/**
 * @module utils/engine-lock
 * Stale-aware single-flight lock for the engine self-heal (report #2).
 *
 * Only one process may copy the opencode engine into a given install at a time:
 * the report saw multiple live MCP processes, so two could self-heal the SAME
 * npx-cache copy at once and a leg could spawn a half-written opencode.exe. The
 * lock is a file in the OS temp dir keyed by the destination pkgDir, recording
 * the holder PID + timestamp so a LATER caller can detect and STEAL a lock
 * orphaned by a killed/crashed repair rather than wedging every future repair.
 * Mirrors src/sidecar/electron-lock.js (kept separate so the shipped GUI heal is
 * never touched).
 */

'use strict';

const fsDefault = require('fs');
const path = require('path');
const os = require('os');

/** A real engine copy (a few tens of MB) finishes well within this. */
const STALE_MS = 15 * 60 * 1000;

/** Temp-dir lockfile path, keyed by the destination install dir. */
function lockPathFor(pkgDir) {
  const key = require('crypto').createHash('sha1').update(pkgDir).digest('hex').slice(0, 16);
  return path.join(os.tmpdir(), `amicus-engine-repair-${key}.lock`);
}

/**
 * Is an existing lockfile orphaned? Stale when it predates STALE_MS, its holder
 * process is gone (ESRCH), or it is empty / corrupt. A lock held by a live,
 * recent process is NOT stale (real contention).
 * @returns {boolean}
 */
function isStaleLock(lockPath, fs = fsDefault, now = Date.now()) {
  let raw;
  try {
    raw = fs.readFileSync(lockPath, 'utf-8');
  } catch {
    return false; // already gone — absent, not stale
  }
  let meta;
  try {
    meta = JSON.parse(raw);
  } catch {
    return true; // empty / corrupt -> orphaned
  }
  if (typeof meta.at === 'number' && now - meta.at > STALE_MS) {
    return true;
  }
  if (typeof meta.pid === 'number') {
    try {
      process.kill(meta.pid, 0); // throws if the process is gone
      return false; // holder alive
    } catch (err) {
      return !!(err && err.code === 'ESRCH'); // ESRCH => dead; EPERM => alive
    }
  }
  return true;
}

/**
 * Acquire the single-flight repair lock. Throws an EEXIST-coded error ONLY when
 * a live, recent process genuinely holds it; otherwise steals an orphaned lock.
 * @param {{pkgDir:string, fs?:object}} opts
 * @returns {{ release: () => void }}
 */
function acquireRepairLock({ pkgDir, fs = fsDefault }) {
  const lockPath = lockPathFor(pkgDir);

  function create() {
    // Atomic exclusive create WITH content: never observable empty. 'wx' throws
    // EEXIST if held.
    fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, at: Date.now() }), { flag: 'wx' });
  }

  try {
    create();
  } catch (e) {
    if (!e || e.code !== 'EEXIST') { throw e; }
    if (!isStaleLock(lockPath, fs)) { throw e; } // live holder -> honest contention
    try { fs.rmSync(lockPath, { force: true }); } catch { /* ignore */ }
    create();
  }

  return {
    release() {
      try { fs.rmSync(lockPath, { force: true }); } catch { /* ignore */ }
    },
  };
}

module.exports = { acquireRepairLock, isStaleLock, lockPathFor, STALE_MS };
