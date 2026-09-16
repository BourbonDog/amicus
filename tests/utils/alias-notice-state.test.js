// tests/utils/alias-notice-state.test.js
'use strict';
/**
 * #238 D5 — alias-notice-state.js's on-disk contract (council #254 round 2,
 * R-P4-18/R-P4-19): one file per stamp in the `alias-notice-state/`
 * directory — `last-notified.json`, `last-refresh-spawned.json` — plus the
 * detached refresh child's own `last-refresh.log`. No merge step: writing
 * one stamp never rewrites the other's bytes (round 1's single merged file
 * meant a read-merge-write that could drop a concurrent exit's stamp). A
 * missing or corrupt file, or an unwritable path, degrades to null / false —
 * never a throw. The hermetic setup file (tests/setup/hermetic-config-dir.js)
 * pins AMICUS_CONFIG_DIR to a per-worker scratch dir, reset at the start of
 * this file, so `getConfigDir()` finds it directly with no fixture of its own.
 */
const fs = require('fs');
const path = require('path');
const { noticeStatePath, refreshLogPath, readNoticeState, writeNoticeState } = require('../../src/utils/alias-notice-state');

beforeEach(() => {
  // recursive+force: the unwritable-path test below leaves a FILE at this directory's path.
  fs.rmSync(noticeStatePath(), { recursive: true, force: true });
});

describe('readNoticeState', () => {
  test('missing directory: both stamps null', () => {
    expect(readNoticeState()).toEqual({ lastNotified: null, lastRefreshSpawned: null });
  });

  test('a corrupt last-notified.json reads as null, and a write over it succeeds', () => {
    fs.mkdirSync(noticeStatePath(), { recursive: true });
    fs.writeFileSync(path.join(noticeStatePath(), 'last-notified.json'), 'not json');
    expect(readNoticeState()).toEqual({ lastNotified: null, lastRefreshSpawned: null });
    expect(writeNoticeState({ lastNotified: 9 })).toBe(true);
    expect(readNoticeState()).toEqual({ lastNotified: 9, lastRefreshSpawned: null });
  });

  test('a non-numeric `at` reads as null', () => {
    fs.mkdirSync(noticeStatePath(), { recursive: true });
    fs.writeFileSync(path.join(noticeStatePath(), 'last-notified.json'), JSON.stringify({ at: 'x' }));
    expect(readNoticeState()).toEqual({ lastNotified: null, lastRefreshSpawned: null });
  });
});

describe('writeNoticeState — one file per stamp, no merge step', () => {
  test('writes ONLY the named file, and reads it back; the other stamp stays null', () => {
    expect(writeNoticeState({ lastNotified: 5 })).toBe(true);
    expect(fs.readdirSync(noticeStatePath())).toEqual(['last-notified.json']);
    expect(readNoticeState()).toEqual({ lastNotified: 5, lastRefreshSpawned: null });
  });

  test("writing the OTHER stamp never rewrites last-notified.json's bytes (mutant MERGEWRITE: a rewrite of the other file)", () => {
    expect(writeNoticeState({ lastNotified: 5 })).toBe(true);
    const before = fs.readFileSync(path.join(noticeStatePath(), 'last-notified.json'));
    expect(writeNoticeState({ lastRefreshSpawned: 7 })).toBe(true);
    const after = fs.readFileSync(path.join(noticeStatePath(), 'last-notified.json'));
    expect(after).toEqual(before);   // byte-identical: no read-merge-write touched it
    expect(readNoticeState()).toEqual({ lastNotified: 5, lastRefreshSpawned: 7 });
  });

  test('a null value removes ONLY that stamp\'s file', () => {
    expect(writeNoticeState({ lastNotified: 5, lastRefreshSpawned: 7 })).toBe(true);
    expect(writeNoticeState({ lastRefreshSpawned: null })).toBe(true);
    expect(fs.readdirSync(noticeStatePath())).toEqual(['last-notified.json']);
    expect(readNoticeState()).toEqual({ lastNotified: 5, lastRefreshSpawned: null });
  });

  test('no leftover temp file after writes', () => {
    writeNoticeState({ lastNotified: 1 });
    writeNoticeState({ lastRefreshSpawned: 2 });
    expect(fs.readdirSync(noticeStatePath()).sort()).toEqual(['last-notified.json', 'last-refresh-spawned.json']);
  });

  test('an unwritable path (a FILE sits where the directory should be) returns false, never throws', () => {
    fs.mkdirSync(path.dirname(noticeStatePath()), { recursive: true });
    fs.writeFileSync(noticeStatePath(), 'not a directory');
    expect(() => writeNoticeState({ lastNotified: 1 })).not.toThrow();
    expect(writeNoticeState({ lastNotified: 1 })).toBe(false);
  });
});

describe('refreshLogPath', () => {
  test('is inside the state directory, named last-refresh.log', () => {
    expect(path.dirname(refreshLogPath())).toBe(noticeStatePath());
    expect(path.basename(refreshLogPath())).toBe('last-refresh.log');
  });
});

test('exactly 4 exports', () => {
  expect(Object.keys(require('../../src/utils/alias-notice-state'))).toHaveLength(4);
});
