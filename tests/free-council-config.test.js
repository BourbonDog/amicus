'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');

describe('createDefaultConfig (read-modify-write)', () => {
  let tempDir, originalEnv;
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'free-council-cfg-'));
    originalEnv = { ...process.env };
    process.env.AMICUS_CONFIG_DIR = tempDir;
    jest.resetModules();
  });
  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('preserves a pre-existing councils map (regression for full-file clobber)', () => {
    const { saveConfig, loadConfig } = require('../src/utils/config');
    const { createDefaultConfig } = require('../src/sidecar/setup');
    saveConfig({ aliases: { gemini: 'g' }, councils: { free: ['free-deepseek-r1'] } });
    createDefaultConfig('gemini');
    const cfg = loadConfig();
    expect(cfg.default).toBe('gemini');
    expect(cfg.councils).toEqual({ free: ['free-deepseek-r1'] });
  });

  it('still seeds a full default-alias table on a fresh install', () => {
    const { createDefaultConfig } = require('../src/sidecar/setup');
    const { getDefaultAliases } = require('../src/utils/config');
    const cfg = createDefaultConfig('gemini');
    expect(cfg.default).toBe('gemini');
    expect(Object.keys(cfg.aliases).length).toBe(Object.keys(getDefaultAliases()).length);
  });
});
