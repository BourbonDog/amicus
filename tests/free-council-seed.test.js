// tests/free-council-seed.test.js
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');

describe('seedFreeCouncil', () => {
  let tempDir, originalEnv;
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'free-council-seed-'));
    originalEnv = { ...process.env };
    process.env.AMICUS_CONFIG_DIR = tempDir;
    jest.resetModules();
  });
  afterEach(() => { process.env = originalEnv; fs.rmSync(tempDir, { recursive: true, force: true }); });

  it('two same-vendor picks yield two distinct aliases and two distinct council members', () => {
    const { seedFreeCouncil } = require('../src/sidecar/setup');
    const { loadConfig } = require('../src/utils/config');
    const res = seedFreeCouncil([
      'openrouter/deepseek/deepseek-r1:free',
      'openrouter/deepseek/deepseek-chat-v3:free',
    ]);
    const cfg = loadConfig();
    expect(res.council).toHaveLength(2);
    expect(new Set(res.council).size).toBe(2);
    const ids = res.council.map(a => cfg.aliases[a]);
    expect(new Set(ids).size).toBe(2);
    expect(cfg.councils.free).toEqual(res.council);
  });

  it('does not touch config.default', () => {
    const { saveConfig } = require('../src/utils/config');
    saveConfig({ default: 'gemini', aliases: { gemini: 'g' } });
    const { seedFreeCouncil } = require('../src/sidecar/setup');
    const { loadConfig } = require('../src/utils/config');
    seedFreeCouncil(['openrouter/qwen/qwen3-coder:free']);
    // single pick → council has 1 member here; default must remain untouched
    expect(loadConfig().default).toBe('gemini');
  });

  it('does not clobber a pre-existing alias of the same derived name', () => {
    const { saveConfig, loadConfig } = require('../src/utils/config');
    saveConfig({ aliases: { 'free-deepseek-r1': 'openrouter/deepseek/deepseek-r1:free' } });
    const { seedFreeCouncil } = require('../src/sidecar/setup');
    seedFreeCouncil(['openrouter/deepseek/deepseek-r1:free']); // same id → reuse existing alias
    const cfg = loadConfig();
    expect(cfg.aliases['free-deepseek-r1']).toBe('openrouter/deepseek/deepseek-r1:free');
    expect(cfg.councils.free).toContain('free-deepseek-r1');
  });

  it('writes config exactly once (atomic)', () => {
    jest.doMock('../src/utils/config', () => {
      const actual = jest.requireActual('../src/utils/config');
      return { ...actual, saveConfig: jest.fn(actual.saveConfig) };
    });
    const { saveConfig } = require('../src/utils/config');
    const { seedFreeCouncil } = require('../src/sidecar/setup');
    seedFreeCouncil(['openrouter/a/m1:free', 'openrouter/b/m2:free']);
    expect(saveConfig).toHaveBeenCalledTimes(1);
    jest.dontMock('../src/utils/config');
  });
});
