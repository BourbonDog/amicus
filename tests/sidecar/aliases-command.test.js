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
    expect(out).toContain('1 to review — amicus aliases --review');
    expect(catalogCalls).toEqual([]);   // display gate: reads the cache directly, never calls getCatalogInfo
  });
  // F2: the per-row flag names the SPECIFIC reason instead of a blanket
  // "newer available" — an ahead-of-shipped pin with no sibling differs only
  // from the shipped pin, and a stale custom pin (no catalog match at all,
  // no same-vendor replacement) is gone from the catalog outright.
  test('F2: row flags reflect the specific reason — AHEAD pin reads "differs from shipped", a stale custom pin reads "gone from catalog"', async () => {
    cfg.saveConfig({ aliases: { glm: 'openrouter/z-ai/glm-5.4', ghost: 'openrouter/nobody/thing-1' } });
    const { code, out } = await captureStdout(() => handleAliases({ _: ['aliases'] }));
    expect(code).toBe(0);
    expect(out).toMatch(/glm\s+→\s+openrouter\/z-ai\/glm-5\.4\s+pinned\s+differs from shipped/);
    expect(out).toMatch(/ghost\s+→\s+openrouter\/nobody\/thing-1\s+pinned\s+⚠ gone from catalog/);
  });
  test('list with nothing pinned says so and does not network', async () => {
    const { code, out } = await captureStdout(() => handleAliases({ _: ['aliases'] }));
    expect(code).toBe(0);
    expect(out).toContain('following');
    expect(out).toContain('nothing to review');
    expect(catalogCalls).toEqual([]);
  });
  test('virgin machine (readCache returns null): list still renders every curated alias as following, no network', async () => {
    catalogCache = null;
    const { code, out } = await captureStdout(() => handleAliases({ _: ['aliases'] }));
    expect(code).toBe(0);
    expect(out).toContain('following');
    expect(catalogCalls).toEqual([]);
  });
  // F1: an unavailable catalog cannot be checked for updates -- that is a
  // different fact from "checked, nothing found" and must say so instead of
  // the reassuring "nothing to review" line.
  test('F1: no cache at all -> footer says catalog unavailable, never "nothing to review", exit 0', async () => {
    catalogCache = null;
    const { code, out } = await captureStdout(() => handleAliases({ _: ['aliases'] }));
    expect(code).toBe(0);
    expect(out).toContain('catalog unavailable — cannot check for updates (amicus models --refresh)');
    expect(out).not.toContain('nothing to review');
  });
  test('F1: a catalog older than 24h gets a second footer line naming its age', async () => {
    catalogCache = { ...CATALOG, fetchedAt: Date.now() - 3 * 24 * 60 * 60 * 1000 };
    const { code, out } = await captureStdout(() => handleAliases({ _: ['aliases'] }));
    expect(code).toBe(0);
    expect(out).toContain('(catalog is 3 days old — amicus models --refresh)');
  });
  test('normalizes on entry: a seeded key equal to the shipped pin is dropped with a Notice', async () => {
    const shipped = cfg.getDefaultAliases();
    fs.mkdirSync(process.env.AMICUS_CONFIG_DIR, { recursive: true });
    fs.writeFileSync(cfg.getConfigPath(), JSON.stringify({ aliases: { glm: shipped.glm, mine: 'openrouter/z-ai/glm-5.4' } }));
    await captureStdout(() => handleAliases({ _: ['aliases'] }));
    expect(JSON.parse(fs.readFileSync(cfg.getConfigPath(), 'utf-8')).aliases).toEqual({ mine: 'openrouter/z-ai/glm-5.4' });
    expect(process.stderr.write.mock.calls.filter(c => String(c[0]).includes("alias 'glm' matches the shipped recommendation")).length).toBe(1);
  });
  // F4a: normalize-on-entry is best-effort (module docblock) -- a read-only
  // config dir must not block the listing. `cfg` here is the SAME module
  // instance `loadDeps()` requires (neither this file nor aliases.js mocks
  // '../../src/utils/config'), so spying on it directly intercepts the call
  // aliases.js makes.
  test('F4a: a write failure during normalize-on-entry does not block the list — reports on stderr, serves the in-memory normalized view', async () => {
    const shipped = cfg.getDefaultAliases();
    fs.mkdirSync(process.env.AMICUS_CONFIG_DIR, { recursive: true });
    fs.writeFileSync(cfg.getConfigPath(), JSON.stringify({ aliases: { glm: shipped.glm } }));
    jest.spyOn(cfg, 'saveConfig').mockImplementation(() => { throw new Error('disk full'); });
    const { code, out } = await captureStdout(() => handleAliases({ _: ['aliases'] }));
    expect(code).toBe(0);
    expect(out).toMatch(/glm\s+→[^\n]*\sfollowing/);
    expect(process.stderr.write.mock.calls.some(c => String(c[0]).includes('could not normalize aliases'))).toBe(true);
    cfg.saveConfig.mockRestore();
  });
  test('--json: versioned document, byte-clean stdout, rows + proposals (normalisation fires inside the captured call and does not leak onto stdout)', async () => {
    const shipped = cfg.getDefaultAliases();
    // Written RAW (not through cfg.saveConfig, which self-normalizes at
    // seed time and would strip `glm` — and fire its Notice — before
    // captureStdout even starts). Writing the file directly, exactly like
    // the sibling normalize-on-entry test above, means `glm` is still on
    // disk at the shipped value when handleAliases runs, so normalizeOnEntry
    // is what strips it and fires the Notice, INSIDE the captured call —
    // which is the scenario this test needs to prove stays byte-clean.
    // `mine` carries the stale-pin/proposal assertions glm used to.
    fs.mkdirSync(process.env.AMICUS_CONFIG_DIR, { recursive: true });
    fs.writeFileSync(cfg.getConfigPath(), JSON.stringify({ aliases: { glm: shipped.glm, mine: 'openrouter/z-ai/glm-5.2' } }));
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
    expect(process.stderr.write.mock.calls.filter(c => String(c[0]).includes("alias 'glm' matches")).length).toBe(1);
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
