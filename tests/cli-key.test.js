'use strict';

jest.mock('../src/utils/api-key-store', () => ({
  readApiKeys: jest.fn(),
  readApiKeyHints: jest.fn(),
  saveApiKey: jest.fn(),
  removeApiKey: jest.fn(),
  PROVIDER_ENV_MAP: {
    openrouter: 'OPENROUTER_API_KEY',
    google: 'GOOGLE_GENERATIVE_AI_API_KEY',
    openai: 'OPENAI_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
    deepseek: 'DEEPSEEK_API_KEY',
  },
}));
jest.mock('../src/utils/api-key-validation', () => ({
  validateApiKey: jest.fn(),
}));

const { readApiKeys, readApiKeyHints, saveApiKey, removeApiKey } = require('../src/utils/api-key-store');
const { validateApiKey } = require('../src/utils/api-key-validation');
const { handleKey } = require('../src/cli-handlers');

let consoleSpy;
let consoleErrSpy;

beforeEach(() => {
  jest.clearAllMocks();
  consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  consoleErrSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  consoleSpy.mockRestore();
  consoleErrSpy.mockRestore();
});

describe('handleKey — list (no provider)', () => {
  test('prints configured providers', async () => {
    readApiKeys.mockReturnValue({ openrouter: true, google: false, openai: false, anthropic: false, deepseek: true });
    readApiKeyHints.mockReturnValue({ openrouter: 'sk-or-v1-', google: false, openai: false, anthropic: false, deepseek: 'sk-abc1' });

    await handleKey({ _: ['key'] });

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('openrouter'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('deepseek'));
  });
});

describe('handleKey — save', () => {
  test('validates and saves a valid deepseek key', async () => {
    validateApiKey.mockResolvedValue({ valid: true });
    saveApiKey.mockReturnValue({ success: true });

    await handleKey({ _: ['key', 'deepseek', 'sk-test123'] });

    expect(validateApiKey).toHaveBeenCalledWith('deepseek', 'sk-test123');
    expect(saveApiKey).toHaveBeenCalledWith('deepseek', 'sk-test123');
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('saved'));
  });

  test('prints error and exits for invalid key', async () => {
    validateApiKey.mockResolvedValue({ valid: false, error: 'Invalid API key (401)' });

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(handleKey({ _: ['key', 'deepseek', 'bad-key'] })).rejects.toThrow('exit');
    expect(consoleErrSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid API key'));
    exitSpy.mockRestore();
  });

  test('prints error and exits for unknown provider', async () => {
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(handleKey({ _: ['key', 'fakeai', 'sk-abc'] })).rejects.toThrow('exit');
    expect(consoleErrSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown provider'));
    exitSpy.mockRestore();
  });

  test('prints error and exits when provider given but no key and no --remove', async () => {
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(handleKey({ _: ['key', 'deepseek'] })).rejects.toThrow('exit');
    expect(consoleErrSpy).toHaveBeenCalledWith(expect.stringContaining('API key is required'));
    exitSpy.mockRestore();
  });

  test('prints error and exits when saveApiKey fails after valid key', async () => {
    validateApiKey.mockResolvedValue({ valid: true });
    saveApiKey.mockReturnValue({ success: false, error: 'File permission denied' });

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(handleKey({ _: ['key', 'deepseek', 'sk-test'] })).rejects.toThrow('exit');
    expect(consoleErrSpy).toHaveBeenCalledWith(expect.stringContaining('File permission denied'));
    exitSpy.mockRestore();
  });
});

describe('handleKey — remove', () => {
  test('removes deepseek key', async () => {
    removeApiKey.mockReturnValue({ success: true });

    await handleKey({ _: ['key', 'deepseek'], remove: true });

    expect(removeApiKey).toHaveBeenCalledWith('deepseek');
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('removed'));
  });
});
