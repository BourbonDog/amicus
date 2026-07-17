// tests/utils/engine-lock.test.js
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  acquireRepairLock, isStaleLock, lockPathFor, STALE_MS,
} = require('../../src/utils/engine-lock');

describe('engine-lock (stale-aware single-flight)', () => {
  let pkgDir;
  let lockPath;

  beforeEach(() => {
    pkgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-engine-lock-test-'));
    lockPath = lockPathFor(pkgDir);
  });

  afterEach(() => {
    try { fs.rmSync(lockPath, { force: true }); } catch { /* ignore */ }
    try { fs.rmSync(pkgDir, { recursive: true, force: true }); } catch { /* ignore */ }
    jest.restoreAllMocks();
  });

  const writeLock = (obj) => fs.writeFileSync(lockPath, typeof obj === 'string' ? obj : JSON.stringify(obj));

  describe('isStaleLock', () => {
    it('an empty / corrupt lockfile is stale', () => {
      writeLock('');
      expect(isStaleLock(lockPath, fs)).toBe(true);
      writeLock('not json {{{');
      expect(isStaleLock(lockPath, fs)).toBe(true);
    });

    it('a too-old lock is stale even if its pid is alive', () => {
      writeLock({ pid: process.pid, at: Date.now() - STALE_MS - 1000 });
      expect(isStaleLock(lockPath, fs)).toBe(true);
    });

    it('a recent lock held by THIS live process is NOT stale', () => {
      writeLock({ pid: process.pid, at: Date.now() });
      expect(isStaleLock(lockPath, fs)).toBe(false);
    });

    it('a recent lock whose holder is GONE (ESRCH) is stale', () => {
      jest.spyOn(process, 'kill').mockImplementation(() => {
        const e = new Error('gone'); e.code = 'ESRCH'; throw e;
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

    it('an absent lockfile is not stale', () => {
      expect(isStaleLock(lockPath, fs)).toBe(false);
    });
  });

  describe('acquireRepairLock', () => {
    it('acquires when none exists (records pid+at) and releases cleanly', () => {
      const lock = acquireRepairLock({ pkgDir, fs });
      expect(fs.existsSync(lockPath)).toBe(true);
      const meta = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
      expect(meta.pid).toBe(process.pid);
      expect(typeof meta.at).toBe('number');
      lock.release();
      expect(fs.existsSync(lockPath)).toBe(false);
    });

    it('STEALS an orphaned empty lock and acquires', () => {
      writeLock('');
      const lock = acquireRepairLock({ pkgDir, fs });
      expect(JSON.parse(fs.readFileSync(lockPath, 'utf-8')).pid).toBe(process.pid);
      lock.release();
    });

    it('STEALS a lock whose holder process is dead (ESRCH)', () => {
      jest.spyOn(process, 'kill').mockImplementation((pid) => {
        if (pid === 424242) { const e = new Error('gone'); e.code = 'ESRCH'; throw e; }
        return true;
      });
      writeLock({ pid: 424242, at: Date.now() });
      const lock = acquireRepairLock({ pkgDir, fs });
      expect(fs.existsSync(lockPath)).toBe(true);
      lock.release();
    });

    it('THROWS EEXIST when a live, recent process holds the lock', () => {
      writeLock({ pid: process.pid, at: Date.now() });
      let err;
      try { acquireRepairLock({ pkgDir, fs }); } catch (e) { err = e; }
      expect(err).toBeDefined();
      expect(err.code).toBe('EEXIST');
      expect(fs.existsSync(lockPath)).toBe(true);
    });
  });
});
