/**
 * Config Model Resolution — No-Strip Contract (#61 Task 4.7)
 *
 * `applyDirectApiFallback` (the old "strip openrouter/ when a direct
 * provider key exists but no OR key does" heuristic) has been retired.
 * The gateway router (route-launch.js / gateway-router.js) now owns the
 * direct-vs-OpenRouter decision on every launch path — `resolveModel` just
 * returns an alias's stored id verbatim, regardless of which API keys are
 * present in the environment or the persisted key store.
 *
 * Routing behavior itself (when the router picks direct vs. openrouter) is
 * covered by tests/gateway-router.test.js and tests/route-launch.test.js.
 */

jest.mock('../src/utils/api-key-store', () => ({
  PROVIDER_ENV_MAP: {
    openrouter: 'OPENROUTER_API_KEY',
    google: 'GOOGLE_GENERATIVE_AI_API_KEY',
    openai: 'OPENAI_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
    deepseek: 'DEEPSEEK_API_KEY',
  },
  readApiKeyValues: jest.fn(),
}));
jest.mock('../src/utils/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const path = require('path');
const fs = require('fs');
const os = require('os');

describe('resolveModel does not mutate the resolved id (no-strip contract)', () => {
  let tempDir;
  let originalEnv;
  let resolveModel;
  let readApiKeyValues;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-fallback-test-'));
    originalEnv = { ...process.env };
    process.env.AMICUS_CONFIG_DIR = tempDir;

    // Clear all relevant env vars
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;

    // Write a config with aliases
    const configPath = path.join(tempDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      default: 'gemini',
      aliases: { gemini: 'openrouter/google/gemini-3-flash' },
    }));

    const store = require('../src/utils/api-key-store');
    readApiKeyValues = store.readApiKeyValues;
    readApiKeyValues.mockReturnValue({});

    jest.resetModules();
    jest.mock('../src/utils/api-key-store', () => ({
      PROVIDER_ENV_MAP: {
        openrouter: 'OPENROUTER_API_KEY',
        google: 'GOOGLE_GENERATIVE_AI_API_KEY',
        openai: 'OPENAI_API_KEY',
        anthropic: 'ANTHROPIC_API_KEY',
        deepseek: 'DEEPSEEK_API_KEY',
      },
      readApiKeyValues: jest.fn(),
    }));
    jest.mock('../src/utils/logger', () => ({
      logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    }));

    const config = require('../src/utils/config');
    resolveModel = config.resolveModel;
    readApiKeyValues = require('../src/utils/api-key-store').readApiKeyValues;
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns the stored openrouter/ id unchanged when no keys exist anywhere', () => {
    readApiKeyValues.mockReturnValue({});
    const result = resolveModel('gemini');
    expect(result).toBe('openrouter/google/gemini-3-flash');
  });

  it('returns the stored openrouter/ id unchanged even when a persisted OpenRouter key exists', () => {
    readApiKeyValues.mockReturnValue({ openrouter: 'sk-or-persisted-key' });
    const result = resolveModel('gemini');
    expect(result).toBe('openrouter/google/gemini-3-flash');
  });

  it('returns the stored openrouter/ id unchanged when only a persisted direct-provider key exists', () => {
    // No openrouter key anywhere, but a google key in the persisted store —
    // the old heuristic used to strip openrouter/ here; the router decides
    // this now, so resolveModel must not.
    readApiKeyValues.mockReturnValue({ google: 'google-persisted-key' });
    const result = resolveModel('gemini');
    expect(result).toBe('openrouter/google/gemini-3-flash');
  });

  it('returns the stored openrouter/ id unchanged when OPENROUTER_API_KEY is set via process.env', () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-env-key';
    readApiKeyValues.mockReturnValue({});
    const result = resolveModel('gemini');
    expect(result).toBe('openrouter/google/gemini-3-flash');
  });

  it('returns the stored openrouter/ id unchanged when only a direct-provider env key is set', () => {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'google-env-key';
    readApiKeyValues.mockReturnValue({});
    const result = resolveModel('gemini');
    expect(result).toBe('openrouter/google/gemini-3-flash');
  });
});

describe('resolveModel no-strip contract — un-mocked integration', () => {
  let tempDir;
  let tempEnvDir;
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-fallback-int-'));
    tempEnvDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-env-int-'));

    // Clear all relevant env vars
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;

    process.env.AMICUS_CONFIG_DIR = tempDir;
    process.env.AMICUS_ENV_DIR = tempEnvDir;

    // Write a config with aliases
    fs.writeFileSync(
      path.join(tempDir, 'config.json'),
      JSON.stringify({
        default: 'gemini',
        aliases: { gemini: 'openrouter/google/gemini-3-flash' },
      })
    );
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(tempEnvDir, { recursive: true, force: true });
  });

  it('returns the stored openrouter/ id unchanged with a real .env file holding a direct-provider key', () => {
    // Write a real .env file with a Google API key (no openrouter key) — the
    // pre-#61 code used to strip the openrouter/ prefix here via the real
    // loadEnvEntries()/resolveKeyValue() chain; resolveModel must not anymore.
    fs.writeFileSync(
      path.join(tempEnvDir, '.env'),
      'GOOGLE_GENERATIVE_AI_API_KEY=real-google-key-from-env-file\n'
    );

    jest.resetModules();
    jest.unmock('../src/utils/api-key-store');
    jest.mock('../src/utils/logger', () => ({
      logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    }));
    const config = require('../src/utils/config');

    const result = config.resolveModel('gemini');

    expect(result).toBe('openrouter/google/gemini-3-flash');
  });
});
