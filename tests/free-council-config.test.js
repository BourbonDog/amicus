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

describe('council helpers', () => {
  let tempDir, originalEnv;
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'free-council-helpers-'));
    originalEnv = { ...process.env };
    process.env.AMICUS_CONFIG_DIR = tempDir;
    delete process.env.OPENROUTER_API_KEY;
    jest.resetModules();
  });
  afterEach(() => { process.env = originalEnv; fs.rmSync(tempDir, { recursive: true, force: true }); });

  const CATALOG = [
    { id: 'openrouter/deepseek/deepseek-r1:free' },
    { id: 'openrouter/google/gemini-2.0-flash-exp:free' },
    { id: 'openrouter/qwen/qwen3-coder:free' },
  ];

  function seed(councils, aliases = {}) {
    const { saveConfig } = require('../src/utils/config');
    saveConfig({ aliases, councils });
  }

  it('getCouncil returns members or null', () => {
    seed({ free: ['free-a', 'free-b'] });
    const { getCouncil } = require('../src/utils/config');
    expect(getCouncil('free')).toEqual(['free-a', 'free-b']);
    expect(getCouncil('nope')).toBeNull();
  });

  it('resolveCouncilMembers errors on unknown / empty council', () => {
    seed({ free: [] });
    const { resolveCouncilMembers } = require('../src/utils/config');
    expect(resolveCouncilMembers('free', CATALOG).error).toMatch(/empty/i);
    expect(resolveCouncilMembers('ghost', CATALOG).error).toMatch(/unknown/i);
  });

  it('drops delisted members and keeps the rest when ≥2 survive', () => {
    seed(
      { free: ['free-r1', 'free-flash', 'free-gone'] },
      {
        'free-r1': 'openrouter/deepseek/deepseek-r1:free',
        'free-flash': 'openrouter/google/gemini-2.0-flash-exp:free',
        'free-gone': 'openrouter/dead/model-x:free', // not in catalog
      }
    );
    const { resolveCouncilMembers } = require('../src/utils/config');
    const r = resolveCouncilMembers('free', CATALOG);
    expect(r.models).toEqual(['free-r1', 'free-flash']);
    expect(r.dropped).toEqual(['free-gone']);
  });

  it('errors when fewer than 2 members survive', () => {
    seed(
      { free: ['free-r1', 'free-gone'] },
      { 'free-r1': 'openrouter/deepseek/deepseek-r1:free', 'free-gone': 'openrouter/dead/x:free' }
    );
    const { resolveCouncilMembers } = require('../src/utils/config');
    expect(resolveCouncilMembers('free', CATALOG).error).toMatch(/fewer than 2/i);
  });

  it('does not drop members when the catalog is empty (offline)', () => {
    seed(
      { free: ['free-r1', 'free-flash'] },
      { 'free-r1': 'openrouter/deepseek/deepseek-r1:free', 'free-flash': 'openrouter/google/gemini-2.0-flash-exp:free' }
    );
    const { resolveCouncilMembers } = require('../src/utils/config');
    const r = resolveCouncilMembers('free', []);
    expect(r.models).toEqual(['free-r1', 'free-flash']);
    expect(r.dropped).toEqual([]);
  });
});
