'use strict';
const fs = require('fs');
const path = require('path');

describe('refresh-model-capabilities script', () => {
  const scriptPath = path.join(__dirname, '../../scripts/refresh-model-capabilities.js');

  test('the script file exists (npm scripts reference it)', () => {
    expect(fs.existsSync(scriptPath)).toBe(true);
  });

  test('exports runnable helpers: refresh, info, check', () => {
    const mod = require(scriptPath);
    expect(typeof mod.runRefresh).toBe('function');
    expect(typeof mod.runCheck).toBe('function');
  });

  test('runCheck flags an alias missing from the catalog', async () => {
    const mod = require(scriptPath);
    const catalog = [{ id: 'openrouter/openai/gpt-5.4', name: 'gpt' }];
    const aliases = { gpt: 'openrouter/openai/gpt-5.4', ghost: 'openrouter/openai/does-not-exist' };
    const stale = mod.findStaleAliases(aliases, catalog);
    expect(stale).toEqual([{ alias: 'ghost', model: 'openrouter/openai/does-not-exist' }]);
  });
});
