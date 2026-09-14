// tests/utils/alias-state.test.js
'use strict';
const { normalizeAliases, listAliasRows, isCurated } = require('../../src/utils/alias-state');

const defaults = { __proto__: null, gemini: 'google/gemini-3.6-flash', glm: 'openrouter/z-ai/glm-5.3' };

describe('normalizeAliases (#238 D6 — a key equal to the shipped default follows)', () => {
  // Named mutant "KEEPEQUAL" — return the input map unchanged.
  test('drops keys whose value equals the shipped default, keeps the rest, in order', () => {
    const lines = [];
    const { aliases, removed } = normalizeAliases(
      { glm: 'openrouter/z-ai/glm-5.3', mine: 'openrouter/x/y-1', gemini: 'google/gemini-9.9-flash' },
      defaults, l => lines.push(l));
    expect(Object.keys(aliases)).toEqual(['mine', 'gemini']);
    expect(removed).toEqual([{ alias: 'glm', id: 'openrouter/z-ai/glm-5.3' }]);
    expect(lines).toEqual(["Notice: alias 'glm' matches the shipped recommendation (openrouter/z-ai/glm-5.3) — now following\n"]);
  });
  test('is idempotent and never notifies twice', () => {
    const lines = [];
    const once = normalizeAliases({ glm: 'openrouter/z-ai/glm-5.3' }, defaults, l => lines.push(l));
    const twice = normalizeAliases(once.aliases, defaults, l => lines.push(l));
    expect(twice.removed).toEqual([]);
    expect(lines).toHaveLength(1);
  });
  test('a non-curated alias is never dropped, whatever its value; prototype names are not curated', () => {
    const { aliases } = normalizeAliases({ toString: 'google/gemini-3.6-flash', custom: 'openrouter/a/b-1' }, defaults);
    expect(Object.keys(aliases)).toEqual(['toString', 'custom']);
  });
  test('tolerates garbage input', () => {
    expect(normalizeAliases(null, defaults)).toEqual({ aliases: {}, removed: [] });
    expect(normalizeAliases({ glm: 42 }, defaults).aliases).toEqual({ glm: 42 });
  });
  // Not reachable from saveConfig today (its stripper rejects '__proto__'
  // before this function ever sees it) but pinned directly here per Step 3's
  // note: `out` must be null-prototype, or this key is silently lost to the
  // inherited accessor setter instead of kept as a plain custom alias.
  test('a __proto__ key in the input is kept as a plain own key, never a prototype write', () => {
    const user = JSON.parse('{"__proto__": "openrouter/a/b-1"}');
    const { aliases } = normalizeAliases(user, defaults);
    expect(Object.getPrototypeOf(aliases)).toBeNull();
    expect(Object.keys(aliases)).toEqual(['__proto__']);
    expect(aliases['__proto__']).toBe('openrouter/a/b-1');
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
  });
});

describe('listAliasRows', () => {
  test('curated first in shipped order, state by presence, custom last', () => {
    const rows = listAliasRows({ glm: 'openrouter/z-ai/glm-5.4', zeta: 'openrouter/q/zeta-1' }, defaults);
    expect(rows).toEqual([
      { alias: 'gemini', id: 'google/gemini-3.6-flash', state: 'following', curated: true, shipped: 'google/gemini-3.6-flash' },
      { alias: 'glm', id: 'openrouter/z-ai/glm-5.4', state: 'pinned', curated: true, shipped: 'openrouter/z-ai/glm-5.3' },
      { alias: 'zeta', id: 'openrouter/q/zeta-1', state: 'pinned', curated: false, shipped: null },
    ]);
  });
  test('empty or absent user map: every curated alias follows', () => {
    expect(listAliasRows(null, defaults).every(r => r.state === 'following')).toBe(true);
    expect(listAliasRows({}, defaults)).toHaveLength(2);
  });
  test('a __proto__ key parsed from JSON is a plain custom row, never a prototype write', () => {
    const user = JSON.parse('{"__proto__": "openrouter/a/b-1"}');
    const rows = listAliasRows(user, defaults);
    expect(rows.find(r => r.alias === '__proto__')).toEqual({ alias: '__proto__', id: 'openrouter/a/b-1', state: 'pinned', curated: false, shipped: null });
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
  });
});

describe('isCurated', () => {
  test('own-key test', () => {
    expect(isCurated('gemini', defaults)).toBe(true);
    expect(isCurated('toString', defaults)).toBe(false);
    expect(isCurated('__proto__', defaults)).toBe(false);
  });
});

describe('saveConfig normalizes (#238 D6) — hermetic config dir', () => {
  const path = require('path');
  const fs = require('fs');
  let cfgMod;
  beforeEach(() => {
    jest.resetModules();
    process.env.AMICUS_CONFIG_DIR = path.join(require('os').tmpdir(), `amicus-alias-state-${process.pid}-${Date.now()}`);
    fs.rmSync(process.env.AMICUS_CONFIG_DIR, { recursive: true, force: true });
    cfgMod = require('../../src/utils/config');
  });
  afterEach(() => { fs.rmSync(process.env.AMICUS_CONFIG_DIR, { recursive: true, force: true }); });

  test('D6 no-op proof: every alias resolves to the identical id before and after normalization', () => {
    const shipped = cfgMod.getDefaultAliases();
    const seeded = { __proto__: null, ...shipped, custom: 'openrouter/a/b-1' };
    const before = {};
    for (const a of Object.keys(seeded)) { before[a] = seeded[a]; }
    const err = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    cfgMod.saveConfig({ default: 'gemini', aliases: { ...seeded } });
    const onDisk = JSON.parse(fs.readFileSync(cfgMod.getConfigPath(), 'utf-8'));
    expect(Object.keys(onDisk.aliases)).toEqual(['custom']);                    // 21 keys dropped
    expect(err.mock.calls.filter(c => String(c[0]).includes('now following'))).toHaveLength(Object.keys(shipped).length);
    const effective = cfgMod.getEffectiveAliases();
    for (const a of Object.keys(before)) { expect(effective[a]).toBe(before[a]); }
    expect(cfgMod.resolveModel('gemini')).toBe(shipped.gemini);
    err.mockRestore();
  });
  test('buildAliasTable lists following aliases', () => {
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    cfgMod.saveConfig({ default: 'gemini', aliases: { custom: 'openrouter/a/b-1' } });
    const table = cfgMod.buildAliasTable();
    expect(table).toContain('| gemini (default) | ');
    expect(table).toContain('| custom | openrouter/a/b-1 |');
    process.stderr.write.mockRestore();
  });
  test('buildAliasTable is empty with no config file', () => {
    expect(cfgMod.buildAliasTable()).toBe('');
  });
});
