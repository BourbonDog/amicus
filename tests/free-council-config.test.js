'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');

describe('createDefaultConfig (read-modify-write)', () => {
  let tempDir, originalEnv, stderrSpy;
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'free-council-cfg-'));
    originalEnv = { ...process.env };
    process.env.AMICUS_CONFIG_DIR = tempDir;
    jest.resetModules();
    // #238 Q9: createDefaultConfig no longer seeds curated aliases (it never
    // writes anything equal to a shipped default). The spy is LOAD-BEARING
    // (#238 T5 fix round 1, Finding 1) -- see the assertion below for why.
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });
  afterEach(() => {
    process.env = originalEnv;
    stderrSpy.mockRestore();
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

  it('still resolves a full default-alias table on a fresh install (#238 Q9: nothing is seeded, so the raw map starts empty)', () => {
    const { createDefaultConfig } = require('../src/sidecar/setup');
    const { getDefaultAliases, getEffectiveAliases } = require('../src/utils/config');
    const cfg = createDefaultConfig('gemini');
    expect(cfg.default).toBe('gemini');
    // createDefaultConfig no longer seeds curated aliases at all -- the raw
    // map is empty but the effective (merged) view still has them all, via
    // the shipped defaults (absence follows, #238 D1).
    expect(Object.keys(cfg.aliases).length).toBe(0);
    expect(Object.keys(getEffectiveAliases()).length).toBe(Object.keys(getDefaultAliases()).length);
    // #238 T5 fix round 1 (Finding 1): the actual regression guard -- Task
    // 3's normalization would strip a re-seeded `cfg.aliases` back to `{}`
    // either way, so the two assertions above cannot tell a re-seed from no
    // seed. Mirrors setup.test.js's 'does not seed curated aliases — they
    // follow the shipped pins by absence (#238 Q9)' assertion -- both go RED
    // if createDefaultConfig re-seeds (verified: restoring
    // `...getDefaultAliases(),` reddens 'still resolves a full default-alias
    // table on a fresh install' here and the setup.test.js test there).
    expect(stderrSpy).not.toHaveBeenCalled();
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

describe('resolveCouncilMembers built-in benches (B23)', () => {
  let tempDir, originalEnv;
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-builtin-'));
    originalEnv = { ...process.env };
    process.env.AMICUS_CONFIG_DIR = tempDir;
    delete process.env.OPENROUTER_API_KEY;
    jest.resetModules();
  });
  afterEach(() => { process.env = originalEnv; fs.rmSync(tempDir, { recursive: true, force: true }); });

  function seed(councils, aliases = {}) {
    const { saveConfig } = require('../src/utils/config');
    saveConfig({ aliases, councils });
  }

  const FREE_CATALOG = [
    { id: 'openrouter/deepseek/deepseek-r1:free' },
    { id: 'openrouter/google/gemini-2.0-flash-exp:free' },
    { id: 'openrouter/qwen/qwen3-coder:free' },
  ];

  it('resolves "budget" from the built-in table when absent from user config', () => {
    seed({}); // no councils saved at all
    const { resolveCouncilMembers } = require('../src/utils/config');
    const { BUDGET_ALIASES } = require('../src/utils/council-presets');
    const r = resolveCouncilMembers('budget', []);
    expect(r.error).toBeUndefined();
    expect(r.models).toEqual(BUDGET_ALIASES);
  });

  it('resolves "frontier" from the built-in table when absent from user config', () => {
    seed({});
    const { resolveCouncilMembers } = require('../src/utils/config');
    const { FRONTIER_ALIASES } = require('../src/utils/council-presets');
    const r = resolveCouncilMembers('frontier', []);
    expect(r.error).toBeUndefined();
    expect(r.models).toEqual(FRONTIER_ALIASES);
  });

  it('resolves "free" dynamically from the catalog when absent from user config', () => {
    seed({});
    const { resolveCouncilMembers } = require('../src/utils/config');
    const r = resolveCouncilMembers('free', FREE_CATALOG);
    expect(r.error).toBeUndefined();
    expect(r.models).toEqual([
      'openrouter/deepseek/deepseek-r1:free',
      'openrouter/google/gemini-2.0-flash-exp:free',
      'openrouter/qwen/qwen3-coder:free',
    ]);
  });

  it('resolves "free" via PINNED_FREE_MODELS fallback when the catalog has no free rows and config lacks councils.free', () => {
    seed({});
    const { resolveCouncilMembers } = require('../src/utils/config');
    const { PINNED_FREE_MODELS } = require('../src/utils/free-models');
    const r = resolveCouncilMembers('free', []);
    expect(r.error).toBeUndefined();
    expect(r.models).toEqual(PINNED_FREE_MODELS);
  });

  it('user config SHADOWS a same-named built-in (existing free-seeding behavior preserved exactly)', () => {
    seed(
      { free: ['free-r1', 'free-flash'] },
      { 'free-r1': 'openrouter/deepseek/deepseek-r1:free', 'free-flash': 'openrouter/google/gemini-2.0-flash-exp:free' }
    );
    const { resolveCouncilMembers } = require('../src/utils/config');
    const r = resolveCouncilMembers('free', FREE_CATALOG);
    // The user's saved aliases win, not the built-in raw catalog ids.
    expect(r.models).toEqual(['free-r1', 'free-flash']);
  });

  it('user config can shadow "budget"/"frontier" too (last-write-wins posture)', () => {
    seed(
      { budget: ['custom-a', 'custom-b'] },
      { 'custom-a': 'openrouter/deepseek/deepseek-r1:free', 'custom-b': 'openrouter/qwen/qwen3-coder:free' }
    );
    const { resolveCouncilMembers } = require('../src/utils/config');
    const r = resolveCouncilMembers('budget', FREE_CATALOG);
    expect(r.models).toEqual(['custom-a', 'custom-b']);
  });

  it('a name that is neither built-in nor user-saved is still "Unknown council" (regression guard)', () => {
    seed({});
    const { resolveCouncilMembers } = require('../src/utils/config');
    expect(resolveCouncilMembers('ghost', []).error).toMatch(/unknown/i);
  });

  it('built-in resolution still applies the delisted-member drop + <2-survivor error path', () => {
    seed({}); // budget/frontier are alias-based; simulate all aliases delisted via an empty-id catalog
    const { resolveCouncilMembers } = require('../src/utils/config');
    // Catalog with unrelated ids only → every budget alias's resolved id is "delisted".
    const r = resolveCouncilMembers('budget', [{ id: 'openrouter/nobody/nothing' }]);
    expect(r.error).toMatch(/fewer than 2/i);
  });
});
