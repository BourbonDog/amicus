/**
 * Tests for src/utils/auth-json.js
 *
 * Read-only interface to OpenCode's auth.json.
 * Replaces the old bidirectional auth-sync.js module.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('fs');
jest.mock('../src/utils/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));

const AUTH_JSON_PATH = path.join(os.homedir(), '.local', 'share', 'opencode', 'auth.json');

function mockAuthJson(content) {
  fs.existsSync.mockImplementation((p) => p === AUTH_JSON_PATH);
  fs.readFileSync.mockImplementation((p) => {
    if (p === AUTH_JSON_PATH) { return JSON.stringify(content); }
    throw new Error(`ENOENT: ${p}`);
  });
}

function mockAuthJsonMissing() {
  fs.existsSync.mockReturnValue(false);
}

const {
  readAuthJsonKeys, importFromAuthJson, checkAuthJson, removeFromAuthJson,
  resolveAuthJsonPath, authJsonCandidates
} = require('../src/utils/auth-json');

describe('readAuthJsonKeys', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fs.existsSync = jest.fn().mockReturnValue(false);
    fs.readFileSync = jest.fn();
  });

  test('returns empty object when auth.json does not exist', () => {
    mockAuthJsonMissing();
    expect(readAuthJsonKeys()).toEqual({});
  });

  test('reads openrouter key from .key field', () => {
    mockAuthJson({ openrouter: { type: 'api', key: 'sk-or-v1-abc' } });
    const result = readAuthJsonKeys();
    expect(result.openrouter).toBe('sk-or-v1-abc');
  });

  test('reads openrouter key from .apiKey field (SKILL.md format)', () => {
    mockAuthJson({ openrouter: { apiKey: 'sk-or-v1-alt' } });
    const result = readAuthJsonKeys();
    expect(result.openrouter).toBe('sk-or-v1-alt');
  });

  test('prefers .key over .apiKey for openrouter', () => {
    mockAuthJson({ openrouter: { key: 'from-key', apiKey: 'from-apiKey' } });
    const result = readAuthJsonKeys();
    expect(result.openrouter).toBe('from-key');
  });

  test('reads google key from .apiKey field', () => {
    mockAuthJson({ google: { apiKey: 'AIza-test' } });
    const result = readAuthJsonKeys();
    expect(result.google).toBe('AIza-test');
  });

  test('reads google key from .key field as fallback', () => {
    mockAuthJson({ google: { key: 'AIza-fallback' } });
    const result = readAuthJsonKeys();
    expect(result.google).toBe('AIza-fallback');
  });

  test('reads multiple providers', () => {
    mockAuthJson({
      openrouter: { key: 'sk-or-v1-abc' },
      google: { apiKey: 'AIza-test' },
      anthropic: { key: 'sk-ant-test' }
    });
    const result = readAuthJsonKeys();
    expect(result.openrouter).toBe('sk-or-v1-abc');
    expect(result.google).toBe('AIza-test');
    expect(result.anthropic).toBe('sk-ant-test');
    expect(result.openai).toBeUndefined();
  });

  test('ignores providers not in KNOWN_PROVIDERS', () => {
    mockAuthJson({ unknown_provider: { key: 'secret' } });
    const result = readAuthJsonKeys();
    expect(result.unknown_provider).toBeUndefined();
  });

  test('returns empty object for malformed auth.json', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('not valid json {{');
    expect(readAuthJsonKeys()).toEqual({});
  });

  test('skips entries with empty key values', () => {
    mockAuthJson({ openrouter: { key: '' } });
    expect(readAuthJsonKeys()).toEqual({});
  });
});

describe('importFromAuthJson', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fs.existsSync = jest.fn().mockReturnValue(false);
    fs.readFileSync = jest.fn();
  });

  test('returns imported keys not in existingKeys', () => {
    mockAuthJson({
      openrouter: { key: 'sk-or-v1-abc' },
      google: { apiKey: 'AIza-test' }
    });
    const existing = { google: true };
    const result = importFromAuthJson(existing);
    expect(result.imported).toEqual([
      { provider: 'openrouter', key: 'sk-or-v1-abc' }
    ]);
  });

  test('returns empty imported when all keys already exist', () => {
    mockAuthJson({ openrouter: { key: 'sk-or-v1-abc' } });
    const existing = { openrouter: true };
    const result = importFromAuthJson(existing);
    expect(result.imported).toEqual([]);
  });

  test('returns empty imported when auth.json missing', () => {
    mockAuthJsonMissing();
    const result = importFromAuthJson({});
    expect(result.imported).toEqual([]);
  });

  test('imports multiple new keys at once', () => {
    mockAuthJson({
      openrouter: { key: 'sk-or-v1-abc' },
      google: { apiKey: 'AIza-test' },
      anthropic: { key: 'sk-ant-test' }
    });
    const result = importFromAuthJson({});
    expect(result.imported).toHaveLength(3);
    expect(result.imported.map(i => i.provider)).toEqual(
      expect.arrayContaining(['openrouter', 'google', 'anthropic'])
    );
  });

  test('handles empty existingKeys', () => {
    mockAuthJson({ deepseek: { key: 'sk-ds-abc' } });
    const result = importFromAuthJson({});
    expect(result.imported).toEqual([
      { provider: 'deepseek', key: 'sk-ds-abc' }
    ]);
  });
});

describe('checkAuthJson', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fs.existsSync = jest.fn().mockReturnValue(false);
    fs.readFileSync = jest.fn();
  });

  test('returns true when provider has key in auth.json', () => {
    mockAuthJson({ openrouter: { key: 'sk-or-v1-abc' } });
    expect(checkAuthJson('openrouter')).toBe(true);
  });

  test('returns false when provider not in auth.json', () => {
    mockAuthJson({ google: { apiKey: 'AIza-test' } });
    expect(checkAuthJson('openrouter')).toBe(false);
  });

  test('returns false when auth.json missing', () => {
    mockAuthJsonMissing();
    expect(checkAuthJson('openrouter')).toBe(false);
  });

  test('returns false for unknown provider', () => {
    mockAuthJson({ unknown: { key: 'test' } });
    expect(checkAuthJson('unknown')).toBe(false);
  });
});

describe('removeFromAuthJson', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fs.existsSync = jest.fn().mockReturnValue(false);
    fs.readFileSync = jest.fn();
    fs.writeFileSync = jest.fn();
  });

  test('removes openrouter entry from auth.json', () => {
    mockAuthJson({
      openrouter: { key: 'sk-or-v1-abc' },
      google: { apiKey: 'AIza-keep' }
    });
    removeFromAuthJson('openrouter');
    const written = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
    expect(written.openrouter).toBeUndefined();
    expect(written.google.apiKey).toBe('AIza-keep');
  });

  test('removes google entry from auth.json', () => {
    mockAuthJson({ google: { apiKey: 'AIza-remove' } });
    removeFromAuthJson('google');
    const written = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
    expect(written.google).toBeUndefined();
  });

  test('removes anthropic entry from auth.json', () => {
    mockAuthJson({ anthropic: { key: 'sk-ant-remove' } });
    removeFromAuthJson('anthropic');
    const written = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
    expect(written.anthropic).toBeUndefined();
  });

  test('no-op when auth.json missing', () => {
    mockAuthJsonMissing();
    removeFromAuthJson('openrouter');
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  test('no-op when provider not in auth.json', () => {
    mockAuthJson({ google: { apiKey: 'AIza-keep' } });
    removeFromAuthJson('openrouter');
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  test('does not throw on malformed auth.json', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('invalid json');
    expect(() => removeFromAuthJson('openrouter')).not.toThrow();
  });
});

describe('resolveAuthJsonPath / candidate lookup', () => {
  const HOME = os.homedir();
  const XDG_PATH = path.join('/xdg', 'opencode', 'auth.json');
  const LOCAL_SHARE_PATH = path.join(HOME, '.local', 'share', 'opencode', 'auth.json');
  const APPDATA_PATH = path.join('/appdata', 'opencode', 'auth.json');

  let originalPlatform;

  beforeEach(() => {
    jest.clearAllMocks();
    fs.existsSync = jest.fn().mockReturnValue(false);
    originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  });

  afterEach(() => {
    if (originalPlatform) { Object.defineProperty(process, 'platform', originalPlatform); }
  });

  function stubPlatform(value) {
    Object.defineProperty(process, 'platform', { value, configurable: true });
  }

  test('honors XDG_DATA_HOME first when that file exists', () => {
    fs.existsSync.mockImplementation((p) => p === XDG_PATH);
    const env = { XDG_DATA_HOME: '/xdg' };
    expect(resolveAuthJsonPath(env)).toBe(XDG_PATH);
  });

  test('falls back to ~/.local/share when XDG unset and that file exists', () => {
    fs.existsSync.mockImplementation((p) => p === LOCAL_SHARE_PATH);
    const result = resolveAuthJsonPath({});
    expect(result).toBe(LOCAL_SHARE_PATH);
  });

  test('resolves win32 %APPDATA% candidate when only it exists', () => {
    stubPlatform('win32');
    fs.existsSync.mockImplementation((p) => p === APPDATA_PATH);
    const env = { APPDATA: '/appdata' };
    expect(resolveAuthJsonPath(env)).toBe(APPDATA_PATH);
  });

  test('returns the ~/.local/share fallback path when none exist', () => {
    fs.existsSync.mockReturnValue(false);
    expect(resolveAuthJsonPath({})).toBe(LOCAL_SHARE_PATH);
    // and readAuthJsonKeys still tolerates a missing file
    expect(readAuthJsonKeys()).toEqual({});
  });

  test('authJsonCandidates orders XDG, ~/.local/share, then win32 %APPDATA%', () => {
    stubPlatform('win32');
    const env = { XDG_DATA_HOME: '/xdg', APPDATA: '/appdata' };
    expect(authJsonCandidates(env)).toEqual([XDG_PATH, LOCAL_SHARE_PATH, APPDATA_PATH]);
  });

  test('authJsonCandidates omits win32 %APPDATA% on non-win32', () => {
    stubPlatform('linux');
    const env = { XDG_DATA_HOME: '/xdg' };
    expect(authJsonCandidates(env)).toEqual([XDG_PATH, LOCAL_SHARE_PATH]);
  });

  test('authJsonCandidates de-dupes when candidates collide', () => {
    stubPlatform('win32');
    // XDG_DATA_HOME pointed at the same base as the ~/.local/share path collapses to one entry
    const env = { XDG_DATA_HOME: path.join(HOME, '.local', 'share'), APPDATA: '/appdata' };
    const candidates = authJsonCandidates(env);
    expect(candidates).toEqual([LOCAL_SHARE_PATH, APPDATA_PATH]);
  });
});
