/**
 * Stale-aware single-flight lock for the electron self-heal (#53).
 *
 * Only one process may extract/install electron at a time (concurrent extracts
 * trip Windows EBUSY). The lock is a file in the OS temp dir keyed by the
 * electron dir. It records the holder PID + a timestamp so a LATER caller can
 * detect — and STEAL — a lock orphaned by a killed/crashed/rebooted repair (or
 * left by a pre-v1.7.3 build, which wrote an empty lockfile). A bare wx lock
 * with no staleness recovery wedges EVERY future repair forever with "another
 * electron repair is already in progress" once the holder dies without
 * releasing — which is exactly what it did in the field.
 */

'use strict';

const fsDefault = require('fs');
const path = require('path');
const os = require('os');

/** A real repair (even a ~170MB download) finishes well within this. */
const STALE_MS = 15 * 60 * 1000;

/** Temp-dir lockfile path, keyed by the electron install dir. */
function lockPathFor(electronDir) {
  // Hash the FULL path: a truncated hex prefix collapsed distinct installs that
  // share a leading path segment (C:\Users…, /home/us…) onto one lockfile,
  // defeating per-install isolation. Mirrors src/utils/engine-lock.js.
  const key = require('crypto').createHash('sha1').update(electronDir).digest('hex').slice(0, 16);
  return path.join(os.tmpdir(), `amicus-electron-repair-${key}.lock`);
}

/**
 * Is an existing lockfile orphaned? Stale when it predates STALE_MS, its holder
 * process is gone (ESRCH), or it is empty / corrupt / pre-v1.7.3 format. A lock
 * held by a LIVE, recent process is NOT stale (real contention).
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
    return true; // empty / corrupt / pre-v1.7.3 empty lockfile -> orphaned
  }
  if (typeof meta.at === 'number' && now - meta.at > STALE_MS) {
    return true; // older than any real repair
  }
  if (typeof meta.pid === 'number') {
    try {
      process.kill(meta.pid, 0); // throws if the process is gone
      return false; // holder alive
    } catch (err) {
      return !!(err && err.code === 'ESRCH'); // ESRCH => dead/stale; EPERM => alive (not ours)
    }
  }
  return true; // no usable pid/timestamp -> treat as orphaned
}

/**
 * Acquire the single-flight repair lock. Throws an EEXIST-coded error ONLY when
 * a live, recent process genuinely holds it; otherwise steals an orphaned lock.
 * @returns {{ release: () => void }}
 */
function acquireRepairLock({ electronDir, fs = fsDefault }) {
  const lockPath = lockPathFor(electronDir);

  function create() {
    // Atomic exclusive create WITH content in a single call: the file is never
    // observable empty (no open-then-write gap a concurrent reader could
    // misjudge as a corrupt orphan and steal). 'wx' throws EEXIST if held.
    fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, at: Date.now() }), { flag: 'wx' });
  }

  try {
    create();
  } catch (e) {
    if (!e || e.code !== 'EEXIST') { throw e; }
    if (!isStaleLock(lockPath, fs)) { throw e; } // genuinely held by a live process
    // Steal the orphan, then re-create. If a real process races us into the
    // gap, the second create() throws EEXIST and we surface honest contention.
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
