'use strict';

describe('process lifecycle helpers', () => {
  let isProcessAlive, checkSessionLiveness;

  beforeAll(() => {
    ({ isProcessAlive, checkSessionLiveness } = require('../src/sidecar/session-utils'));
  });

  describe('isProcessAlive', () => {
    test('returns true for current process PID', () => {
      expect(isProcessAlive(process.pid)).toBe(true);
    });

    test('returns false for very high PID (almost certainly dead)', () => {
      expect(isProcessAlive(999999999)).toBe(false);
    });

    test('returns false for null PID', () => {
      expect(isProcessAlive(null)).toBe(false);
    });

    test('returns false for 0', () => {
      expect(isProcessAlive(0)).toBe(false);
    });

    test('returns true on EPERM (process exists, caller lacks permission to signal it)', () => {
      const kill = jest.spyOn(process, 'kill').mockImplementation(() => {
        const e = new Error('kill EPERM'); e.code = 'EPERM'; throw e;
      });
      try {
        expect(isProcessAlive(123)).toBe(true);
      } finally {
        kill.mockRestore();
      }
    });
  });

  describe('checkSessionLiveness', () => {
    test('returns alive when both PIDs are current process', () => {
      const result = checkSessionLiveness({ pid: process.pid, goPid: process.pid });
      expect(result).toBe('alive');
    });

    test('returns dead when both PIDs are dead', () => {
      const result = checkSessionLiveness({ pid: 999999999, goPid: 999999998 });
      expect(result).toBe('dead');
    });

    test('returns server-dead when Node alive but Go dead', () => {
      const result = checkSessionLiveness({ pid: process.pid, goPid: 999999999 });
      expect(result).toBe('server-dead');
    });

    test('returns dead when PIDs are null', () => {
      const result = checkSessionLiveness({ pid: null, goPid: null });
      expect(result).toBe('dead');
    });
  });
});

describe('crash handler lock cleanup', () => {
  test('crash-handler.js deletes session.lock on crash', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '../src/sidecar/crash-handler.js'), 'utf-8'
    );
    expect(src).toContain('session.lock');
    expect(src).toContain('unlinkSync');
  });
});
