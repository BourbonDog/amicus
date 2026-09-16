// tests/utils/alias-notice-state.test.js
'use strict';
/**
 * #238 D5 — alias-notice-state.js's on-disk contract (council #254 round 1,
 * A2/D5, A1/D3): the two notice stamps live in `alias-notice-state.json`,
 * beside the catalog cache, written atomically and merged rather than
 * clobbered; a missing or corrupt file, or an unwritable path, degrades to
 * null / false — never a throw. The hermetic setup file
 * (tests/setup/hermetic-config-dir.js) pins AMICUS_CONFIG_DIR to a per-worker
 * scratch dir, reset at the start of this file, so `getConfigDir()` finds it
 * directly with no fixture of its own.
 */
const fs = require('fs');
const path = require('path');
const { noticeStatePath, readNoticeState, writeNoticeState } = require('../../src/utils/alias-notice-state');
const { getConfigDir } = require('../../src/utils/config');

beforeEach(() => {
  // recursive+force: the NORECEIPTSTATE test below leaves a DIRECTORY at this path.
  fs.rmSync(noticeStatePath(), { recursive: true, force: true });
});

describe('readNoticeState', () => {
  test('missing file: both stamps null', () => {
    expect(readNoticeState()).toEqual({ lastNotified: null, lastRefreshSpawned: null });
  });

  test('a corrupt file reads as nulls, and a write over it succeeds', () => {
    fs.mkdirSync(path.dirname(noticeStatePath()), { recursive: true });
    fs.writeFileSync(noticeStatePath(), 'not json');
    expect(readNoticeState()).toEqual({ lastNotified: null, lastRefreshSpawned: null });
    expect(writeNoticeState({ lastNotified: 9 })).toBe(true);
    expect(readNoticeState()).toEqual({ lastNotified: 9, lastRefreshSpawned: null });
  });

  test('a non-numeric field reads as null', () => {
    fs.mkdirSync(path.dirname(noticeStatePath()), { recursive: true });
    fs.writeFileSync(noticeStatePath(), JSON.stringify({ lastNotified: 'yesterday' }));
    expect(readNoticeState()).toEqual({ lastNotified: null, lastRefreshSpawned: null });
  });
});

describe('writeNoticeState', () => {
  test('writes, merges onto the existing stamps, and clears with null — no leftover temp file', () => {
    expect(writeNoticeState({ lastNotified: 5 })).toBe(true);
    expect(fs.existsSync(noticeStatePath())).toBe(true);
    expect(readNoticeState()).toEqual({ lastNotified: 5, lastRefreshSpawned: null });

    expect(writeNoticeState({ lastRefreshSpawned: 7 })).toBe(true);
    expect(readNoticeState()).toEqual({ lastNotified: 5, lastRefreshSpawned: 7 });   // merge: lastNotified survives

    expect(writeNoticeState({ lastRefreshSpawned: null })).toBe(true);
    expect(readNoticeState()).toEqual({ lastNotified: 5, lastRefreshSpawned: null });   // explicit null clears

    // Only the state file in the config dir — the atomic temp file was renamed away, not left behind.
    expect(fs.readdirSync(getConfigDir())).toEqual(['alias-notice-state.json']);
  });

  test('an unwritable path (a directory sits where the file should be) returns false, never throws (mutant NORECEIPTSTATE: return true on failure)', () => {
    fs.mkdirSync(noticeStatePath(), { recursive: true });
    expect(() => writeNoticeState({ lastNotified: 1 })).not.toThrow();
    expect(writeNoticeState({ lastNotified: 1 })).toBe(false);
  });
});

test('exactly 3 exports', () => {
  expect(Object.keys(require('../../src/utils/alias-notice-state'))).toHaveLength(3);
});
