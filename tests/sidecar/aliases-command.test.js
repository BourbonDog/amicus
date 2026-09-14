// tests/sidecar/aliases-command.test.js
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');

function captureStdout(fn) {
  const writes = [];
  const orig = process.stdout.write;
  process.stdout.write = (s) => { writes.push(String(s)); return true; };
  return Promise.resolve().then(fn).finally(() => { process.stdout.write = orig; })
    .then(code => ({ code, out: writes.join('') }));
}

describe('amicus aliases (#238 D4 — list and --json)', () => {
  let cfg, handleAliases;
  const CATALOG = {
    models: [{ id: 'openrouter/z-ai/glm-5.3' }, { id: 'openrouter/z-ai/glm-5.4' }, { id: 'google/gemini-3.6-flash' }, { id: 'openrouter/google/gemini-3.6-flash' }],
    fetchedAt: 1, lastRefreshAttempt: null, lastRefreshError: null, providerFailures: [], ceilingEnrichment: null,
  };
  let catalogCalls;
  let catalogCache;
  beforeEach(() => {
    jest.resetModules();
    process.env.AMICUS_CONFIG_DIR = path.join(os.tmpdir(), `amicus-aliases-cmd-${process.pid}-${Date.now()}`);
    fs.rmSync(process.env.AMICUS_CONFIG_DIR, { recursive: true, force: true });
    catalogCalls = [];
    catalogCache = CATALOG;
    jest.doMock('../../src/utils/model-catalog', () => ({
      getCatalogInfo: jest.fn(async (opts) => { catalogCalls.push(opts); return CATALOG; }),
      readCache: jest.fn(() => catalogCache),
      DEFAULT_MAX_AGE_MS: 24 * 60 * 60 * 1000,
    }));
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    cfg = require('../../src/utils/config');
    ({ handleAliases } = require('../../src/sidecar/aliases'));
  });
  afterEach(() => {
    process.stderr.write.mockRestore();
    fs.rmSync(process.env.AMICUS_CONFIG_DIR, { recursive: true, force: true });
  });

  test('list: following vs pinned per row, grouped by vendor, a pinned alias behind a sibling is flagged, footer counts proposals', async () => {
    cfg.saveConfig({ default: 'gemini', aliases: { glm: 'openrouter/z-ai/glm-5.2', mine: 'openrouter/z-ai/glm-5.4' } });
    const { code, out } = await captureStdout(() => handleAliases({ _: ['aliases'] }));
    expect(code).toBe(0);
    expect(out).toMatch(/gemini\s+→\s+google\/gemini-3\.6-flash\s+following/);
    expect(out).toMatch(/glm\s+→\s+openrouter\/z-ai\/glm-5\.2\s+pinned\s+⚠ newer available/);
    expect(out).toMatch(/mine\s+→\s+openrouter\/z-ai\/glm-5\.4\s+pinned/);
    expect(out).toContain('1 update available — amicus aliases --review');
    expect(catalogCalls).toEqual([]);   // display gate: reads the cache directly, never calls getCatalogInfo
  });
  test('list with nothing pinned says so and does not network', async () => {
    const { code, out } = await captureStdout(() => handleAliases({ _: ['aliases'] }));
    expect(code).toBe(0);
    expect(out).toContain('following');
    expect(out).toContain('nothing to review');
  });
  test('virgin machine (readCache returns null): list still renders every curated alias as following, no network', async () => {
    catalogCache = null;
    const { code, out } = await captureStdout(() => handleAliases({ _: ['aliases'] }));
    expect(code).toBe(0);
    expect(out).toContain('following');
    expect(out).toContain('nothing to review');
    expect(catalogCalls).toEqual([]);
  });
  test('normalizes on entry: a seeded key equal to the shipped pin is dropped with a Notice', async () => {
    const shipped = cfg.getDefaultAliases();
    fs.mkdirSync(process.env.AMICUS_CONFIG_DIR, { recursive: true });
    fs.writeFileSync(cfg.getConfigPath(), JSON.stringify({ aliases: { glm: shipped.glm, mine: 'openrouter/z-ai/glm-5.4' } }));
    await captureStdout(() => handleAliases({ _: ['aliases'] }));
    expect(JSON.parse(fs.readFileSync(cfg.getConfigPath(), 'utf-8')).aliases).toEqual({ mine: 'openrouter/z-ai/glm-5.4' });
    expect(process.stderr.write.mock.calls.filter(c => String(c[0]).includes("alias 'glm' matches the shipped recommendation")).length).toBe(1);
  });
  test('--json: versioned document, byte-clean stdout, rows + proposals (normalisation fires and does not leak onto stdout)', async () => {
    const shipped = cfg.getDefaultAliases();
    // glm is seeded AT the shipped value so normalizeOnEntry actually removes
    // it (and saveConfig fires a real stderr Notice) during this very call —
    // proving the Notice never leaks onto stdout, not just that none occurs.
    // `mine` carries the stale-pin/proposal assertions glm used to.
    cfg.saveConfig({ aliases: { glm: shipped.glm, mine: 'openrouter/z-ai/glm-5.2' } });
    const { code, out } = await captureStdout(() => handleAliases({ _: ['aliases'], json: true }));
    expect(code).toBe(0);
    const doc = JSON.parse(out);
    expect(doc.type).toBe('aliases');
    expect(typeof doc.schemaVersion).toBe('number');
    expect(doc.catalogAvailable).toBe(true);
    expect(doc.aliases.find(r => r.alias === 'glm')).toEqual({ alias: 'glm', id: shipped.glm, state: 'following', curated: true, shipped: shipped.glm });
    expect(doc.aliases.find(r => r.alias === 'mine')).toEqual({ alias: 'mine', id: 'openrouter/z-ai/glm-5.2', state: 'pinned', curated: false, shipped: null });
    expect(doc.proposalCount).toBe(1);
    expect(doc.proposals[0].candidates[0].id).toBe('openrouter/z-ai/glm-5.4');
  });
  test('--review with --json or --quiet is an argument error', async () => {
    const a = await captureStdout(() => handleAliases({ _: ['aliases'], review: true, json: true }));
    expect(a.code).toBe(1);
    expect(a.out).toBe('');
    const b = await captureStdout(() => handleAliases({ _: ['aliases'], review: true, quiet: true }));
    expect(b.code).toBe(1);
    expect(process.stderr.write.mock.calls.some(c => String(c[0]).includes('--review is interactive'))).toBe(true);
  });
});

describe('aliases is a registered command with a --review flag', () => {
  test('usage names it, the flag registry knows --review, parseArgs treats --review as boolean', () => {
    const { getUsage, getCommandNames, parseArgs } = require('../../src/cli');
    expect(getCommandNames()).toContain('aliases');
    expect(getUsage('aliases')).toContain('--review');
    expect(getUsage()).toMatch(/\n  aliases\s+/);
    const { getKnownFlags } = require('../../src/utils/known-flags');
    expect(getKnownFlags().has('review')).toBe(true);
    const parsed = parseArgs(['aliases', '--review', 'stray']);
    expect(parsed.review).toBe(true);
    expect(parsed._).toEqual(['aliases', 'stray']);
  });
});
