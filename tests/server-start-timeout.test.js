/**
 * Server-start timeout threading (v4.5.2).
 *
 * FIELD BUG. `@opencode-ai/sdk` defaults `createOpencodeServer`'s start timeout
 * to 5000ms and lets the caller override it. amicus never passed one, so every
 * server start on every platform was pinned to the SDK's 5s — undocumented,
 * untunable, and invisible to `amicus doctor`. On a Windows box with the project
 * on a sync-backed volume and an AV scanner attached, a cold OpenCode/SQLite
 * start exceeded it: a council run degraded to per-wave servers and then lost
 * its whole Stage-1 bench (`COUNCIL_QUORUM: Only 0 … survived`).
 *
 * A slow start costs latency. A failed start costs a review seat. These pin the
 * resolver so the default cannot silently drift back down to the SDK's.
 */

jest.mock('../src/utils/logger', () => ({
  logger: {
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn()
  }
}));

const {
  buildServerOptions,
  resolveServerStartTimeoutMs,
  SERVER_START_TIMEOUT_MS
} = require('../src/opencode-client');

const SDK_DEFAULT = 5000;

describe('resolveServerStartTimeoutMs', () => {
  it('never returns the SDK default — that is the bug being fixed', () => {
    expect(resolveServerStartTimeoutMs({}, {}, 'win32')).toBeGreaterThan(SDK_DEFAULT);
    expect(resolveServerStartTimeoutMs({}, {}, 'linux')).toBeGreaterThan(SDK_DEFAULT);
    expect(resolveServerStartTimeoutMs({}, {}, 'darwin')).toBeGreaterThan(SDK_DEFAULT);
  });

  it('is most generous on win32, where the field failure was reported', () => {
    expect(resolveServerStartTimeoutMs({}, {}, 'win32'))
      .toBeGreaterThan(resolveServerStartTimeoutMs({}, {}, 'linux'));
  });

  it('exposes both platform defaults as a frozen constant', () => {
    expect(SERVER_START_TIMEOUT_MS.win32).toBeGreaterThan(SDK_DEFAULT);
    expect(SERVER_START_TIMEOUT_MS.default).toBeGreaterThan(SDK_DEFAULT);
    expect(Object.isFrozen(SERVER_START_TIMEOUT_MS)).toBe(true);
  });

  it('AMICUS_SERVER_START_TIMEOUT_MS overrides the platform default', () => {
    expect(resolveServerStartTimeoutMs(
      {}, { AMICUS_SERVER_START_TIMEOUT_MS: '45000' }, 'win32')).toBe(45000);
  });

  it('an explicit options.timeout beats the env var', () => {
    expect(resolveServerStartTimeoutMs(
      { timeout: 9000 }, { AMICUS_SERVER_START_TIMEOUT_MS: '45000' }, 'win32')).toBe(9000);
  });

  /**
   * `0` and negatives would make EVERY start fail instantly — an own-goal, not
   * an escape hatch, so they fall back to the default rather than being honored
   * (this knob is deliberately NOT a src/utils/env-num.js candidate).
   */
  it.each([['0', 'zero'], ['-1', 'negative'], ['abc', 'non-numeric'],
    ['', 'blank'], ['   ', 'whitespace'], ['Infinity', 'non-finite']])(
    'ignores a %s AMICUS_SERVER_START_TIMEOUT_MS (%s) and keeps the default', (raw) => {
      expect(resolveServerStartTimeoutMs({}, { AMICUS_SERVER_START_TIMEOUT_MS: raw }, 'win32'))
        .toBe(SERVER_START_TIMEOUT_MS.win32);
    });

  it('ignores a zero or negative explicit options.timeout for the same reason', () => {
    expect(resolveServerStartTimeoutMs({ timeout: 0 }, {}, 'linux'))
      .toBe(SERVER_START_TIMEOUT_MS.default);
    expect(resolveServerStartTimeoutMs({ timeout: -5 }, {}, 'linux'))
      .toBe(SERVER_START_TIMEOUT_MS.default);
  });
});

describe('buildServerOptions threads the start timeout', () => {
  it('always sets a timeout, so the SDK default is never what runs', () => {
    const opts = buildServerOptions({});
    expect(opts.timeout).toBeDefined();
    expect(opts.timeout).toBeGreaterThan(SDK_DEFAULT);
  });

  it('passes an explicit timeout straight through', () => {
    expect(buildServerOptions({ timeout: 25000 }).timeout).toBe(25000);
  });

  it('still sets hostname and omits unset port/signal (no regression)', () => {
    const opts = buildServerOptions({});
    expect(opts.hostname).toBe('127.0.0.1');
    expect('port' in opts).toBe(false);
    expect('signal' in opts).toBe(false);
  });
});
