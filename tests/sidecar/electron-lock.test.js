/**
 * Stale-aware single-flight lock for the electron self-heal (src/sidecar/electron-lock.js).
 *
 * The field bug: a bare wx lockfile with no staleness recovery wedged EVERY
 * future repair forever with "another electron repair is already in progress"
 * once a holder died without releasing (a killed/hung download) — and a
 * pre-v1.7.3 build wrote an EMPTY lockfile. These tests prove the lock now
 * STEALS an orphaned lock (dead holder, too-old, or empty/corrupt) and only
 * reports contention for a live, recent holder.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  acquireRepairLock, isStaleLock, lockPathFor, STALE_MS,
} = require('../../src/sidecar/electron-lock');

describe('electron-lock (stale-aware single-flight)', () => {
  let electronDir;
  let lockPath;

  beforeEach(() => {
    // A unique electronDir => a unique lockfile in the real tmpdir, so tests
    // never collide with each other or real usage.
    electronDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-lock-test-'));
    lockPath = lockPathFor(electronDir);
  });

  afterEach(() => {
    try { fs.rmSync(lockPath, { force: true }); } catch { /* ignore */ }
    try { fs.rmSync(electronDir, { recursive: true, force: true }); } catch { /* ignore */ }
    jest.restoreAllMocks();
  });

  const writeLock = (obj) => fs.writeFileSync(lockPath, typeof obj === 'string' ? obj : JSON.stringify(obj));

  describe('isStaleLock', () => {
    it('an EMPTY / pre-v1.7.3 lockfile is stale (the field case)', () => {
      writeLock('');
      expect(isStaleLock(lockPath, fs)).toBe(true);
    });

    it('a corrupt (non-JSON) lockfile is stale', () => {
      writeLock('not json {{{');
      expect(isStaleLock(lockPath, fs)).toBe(true);
    });

    it('a too-old lock (older than STALE_MS) is stale even if its pid is alive', () => {
      writeLock({ pid: process.pid, at: Date.now() - STALE_MS - 1000 });
      expect(isStaleLock(lockPath, fs)).toBe(true);
    });

    it('a recent lock held by THIS (live) process is NOT stale', () => {
      writeLock({ pid: process.pid, at: Date.now() });
      expect(isStaleLock(lockPath, fs)).toBe(false);
    });

    it('a recent lock whose holder process is GONE (ESRCH) is stale', () => {
      jest.spyOn(process, 'kill').mockImplementation(() => {
        const e = new Error('no such process'); e.code = 'ESRCH'; throw e;
      });
      writeLock({ pid: 424242, at: Date.now() });
      expect(isStaleLock(lockPath, fs)).toBe(true);
    });

    it('a recent lock whose holder is alive-but-unsignalable (EPERM) is NOT stale', () => {
      jest.spyOn(process, 'kill').mockImplementation(() => {
        const e = new Error('operation not permitted'); e.code = 'EPERM'; throw e;
      });
      writeLock({ pid: 424242, at: Date.now() });
      expect(isStaleLock(lockPath, fs)).toBe(false);
    });

    it('an absent lockfile is not "stale" (it is simply gone)', () => {
      expect(isStaleLock(lockPath, fs)).toBe(false);
    });
  });

  describe('acquireRepairLock', () => {
    it('acquires when no lock exists, recording pid + timestamp, and releases cleanly', () => {
      const lock = acquireRepairLock({ electronDir, fs });
      expect(fs.existsSync(lockPath)).toBe(true);
      const meta = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
      expect(meta.pid).toBe(process.pid);
      expect(typeof meta.at).toBe('number');
      lock.release();
      expect(fs.existsSync(lockPath)).toBe(false);
    });

    it('STEALS an orphaned empty (pre-v1.7.3) lock and acquires', () => {
      writeLock(''); // the wedged-in-the-field state
      const lock = acquireRepairLock({ electronDir, fs });
      const meta = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
      expect(meta.pid).toBe(process.pid); // re-created by us
      lock.release();
      expect(fs.existsSync(lockPath)).toBe(false);
    });

    it('STEALS a lock whose holder process is dead (ESRCH)', () => {
      jest.spyOn(process, 'kill').mockImplementation((pid) => {
        if (pid === 424242) { const e = new Error('gone'); e.code = 'ESRCH'; throw e; }
        return true;
      });
      writeLock({ pid: 424242, at: Date.now() });
      const lock = acquireRepairLock({ electronDir, fs });
      expect(fs.existsSync(lockPath)).toBe(true);
      lock.release();
    });

    it('THROWS EEXIST (real contention) when a live, recent process holds the lock', () => {
      writeLock({ pid: process.pid, at: Date.now() }); // a live holder
      let err;
      try { acquireRepairLock({ electronDir, fs }); } catch (e) { err = e; }
      expect(err).toBeDefined();
      expect(err.code).toBe('EEXIST');
      // the live holder's lock is left intact
      expect(fs.existsSync(lockPath)).toBe(true);
    });
  });
});
