/**
 * promptRouteSelection tests (#61 gateway routing integration, Task 6.3).
 *
 * The interactive alternatives picker for a direct-model miss. Mirrors
 * tests/model-validator.test.js's approach to stubbing readline/config for
 * promptModelSelection, adapted to the {model, gateway, note} suggestion
 * shape that route-launch.js's buildSuggestions produces.
 */

jest.mock('../src/utils/config');
jest.mock('../src/utils/model-fetcher');
jest.mock('../src/utils/api-key-store');
jest.mock('../src/utils/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { loadConfig, saveConfig, getConfigPath } = require('../src/utils/config');
const { promptRouteSelection } = require('../src/utils/model-validator');

const SUGGESTIONS = [
  { model: 'openrouter/openai/gpt-9', gateway: 'openrouter', note: 'same model via OpenRouter' },
  { model: 'openai/gpt-5.5', gateway: 'direct', note: 'openai model' },
];

/** Stub readline.createInterface to answer `answer` to the first question(). */
function mockReadline(answer) {
  const rl = { question: jest.fn((_prompt, cb) => cb(answer)), close: jest.fn() };
  jest.spyOn(require('readline'), 'createInterface').mockReturnValue(rl);
  return rl;
}

describe('promptRouteSelection', () => {
  let stderrSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    loadConfig.mockReturnValue({ aliases: {} });
    saveConfig.mockImplementation(() => {});
    getConfigPath.mockReturnValue('/tmp/amicus-test-config.json');
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    jest.restoreAllMocks();
  });

  test('valid pick returns the chosen model + gateway and persists the alias', async () => {
    mockReadline('2');

    const result = await promptRouteSelection({ requested: 'openai/gpt-9', suggestions: SUGGESTIONS }, 'gpt');

    expect(result).toEqual({ model: 'openai/gpt-5.5', gateway: 'direct' });
    expect(saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({ aliases: expect.objectContaining({ gpt: 'openai/gpt-5.5' }) })
    );
  });

  test('picking the OpenRouter alternative returns gateway:openrouter', async () => {
    mockReadline('1');

    const result = await promptRouteSelection({ requested: 'openai/gpt-9', suggestions: SUGGESTIONS }, 'gpt');

    expect(result).toEqual({ model: 'openrouter/openai/gpt-9', gateway: 'openrouter' });
  });

  test('a lone suggestion is never auto-selected — still requires an explicit pick', async () => {
    const rl = mockReadline('1');
    const lone = [{ model: 'openai/gpt-5.5', gateway: 'direct', note: 'openai model' }];

    const result = await promptRouteSelection({ requested: 'openai/gpt-9', suggestions: lone }, 'gpt');

    // The prompt was actually presented (not skipped) even though there's only one option.
    expect(rl.question).toHaveBeenCalled();
    expect(result).toEqual({ model: 'openai/gpt-5.5', gateway: 'direct' });
  });

  test('valid pick without an alias does not attempt to persist', async () => {
    mockReadline('2');

    const result = await promptRouteSelection({ requested: 'openai/gpt-9', suggestions: SUGGESTIONS }, undefined);

    expect(result).toEqual({ model: 'openai/gpt-5.5', gateway: 'direct' });
    expect(saveConfig).not.toHaveBeenCalled();
  });

  test('empty input cancels', async () => {
    mockReadline('');

    await expect(
      promptRouteSelection({ requested: 'openai/gpt-9', suggestions: SUGGESTIONS }, 'gpt')
    ).rejects.toThrow(/cancelled/i);
    expect(saveConfig).not.toHaveBeenCalled();
  });

  test('an out-of-range number cancels', async () => {
    mockReadline('99');

    await expect(
      promptRouteSelection({ requested: 'openai/gpt-9', suggestions: SUGGESTIONS }, 'gpt')
    ).rejects.toThrow(/cancelled/i);
  });

  test('empty suggestions cancels without prompting ("no alternatives available")', async () => {
    const rl = { question: jest.fn(), close: jest.fn() };
    jest.spyOn(require('readline'), 'createInterface').mockReturnValue(rl);

    await expect(
      promptRouteSelection({ requested: 'openai/gpt-9', suggestions: [] }, 'gpt')
    ).rejects.toThrow(/cancelled/i);
    expect(rl.question).not.toHaveBeenCalled();
    const written = stderrSpy.mock.calls.map((c) => c[0]).join('');
    expect(written).toMatch(/no alternatives available/i);
  });

  test('malformed on-disk config throws instead of silently overwriting', async () => {
    mockReadline('1');
    loadConfig.mockReturnValue(null);
    const fs = require('fs');
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);

    await expect(
      promptRouteSelection({ requested: 'openai/gpt-9', suggestions: SUGGESTIONS }, 'gpt')
    ).rejects.toThrow(/malformed/i);
    expect(saveConfig).not.toHaveBeenCalled();
  });
});
