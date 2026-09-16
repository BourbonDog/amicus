// tests/sidecar/aliases-command.test.js
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');

// R3 (#249 r2 C4) hostile-fragment fixtures. Built with String.fromCharCode
// so this SOURCE FILE never carries a raw control/bidi byte itself (the same
// class of footgun the fix guards terminal output against) -- only the
// runtime string value carries the ESC/RLO codepoint.
const HOSTILE_ESC = String.fromCharCode(0x1b);
const HOSTILE_RLO = String.fromCharCode(0x202e); // right-to-left override
const HOSTILE_ALIAS = `${HOSTILE_ESC}[31mred${HOSTILE_ESC}[0m`;
const HOSTILE_ID = `openrouter/x/${HOSTILE_RLO}evil\nNotice: forged`;
// F1 (#249 r2 review): a hostile VENDOR segment -- the id's own second path
// segment, which an unmapped vendor's group label is titleCased from.
const HOSTILE_VENDOR_ID = `openrouter/${HOSTILE_ESC}[31mevil${HOSTILE_RLO}\nNotice: forged/model-1`;

function captureStdout(fn) {
  const writes = [];
  const orig = process.stdout.write;
  process.stdout.write = (s) => { writes.push(String(s)); return true; };
  return Promise.resolve().then(fn).finally(() => { process.stdout.write = orig; })
    .then(code => ({ code, out: writes.join('') }));
}

/** Mock the shipped pin file with extra `retired`/`notable` entries; must run BEFORE `require('../../src/sidecar/aliases')` in a test. */
function mockPins({ retired = {}, notable = [] } = {}) {
  const real = jest.requireActual('../../src/utils/curated-pins');
  jest.doMock('../../src/utils/curated-pins', () => ({
    ...real,
    loadCuratedPins: () => { const d = real.loadCuratedPins(); return { ...d, retired: { ...d.retired, ...retired }, notable: [...d.notable, ...notable] }; },
  }));
}

// Q8: the first describe below reads footer/--json text that depends on the
// CI signal (utils/alias-refresh-state.js :: isInCi) -- saved once here and
// restored after the whole file finishes, since a CI runner's own real CI
// env would otherwise leak into (and out of) every test in this file.
const savedCI = process.env.CI;
// I2: collectAliasView reads process.env.AMICUS_NO_NETWORK_PROBES directly (Q8's env
// escape hatch) -- an air-gapped machine's ambient AMICUS_NO_NETWORK_PROBES=1 would
// otherwise read as "off (...)" and break the same footer/--json assertions a leaked
// real CI env would.
const savedNoNetworkProbes = process.env.AMICUS_NO_NETWORK_PROBES;
afterAll(() => {
  if (savedCI === undefined) { delete process.env.CI; } else { process.env.CI = savedCI; }
  if (savedNoNetworkProbes === undefined) { delete process.env.AMICUS_NO_NETWORK_PROBES; } else { process.env.AMICUS_NO_NETWORK_PROBES = savedNoNetworkProbes; }
});

describe('amicus aliases (#238 D4 — list and --json)', () => {
  let cfg, handleAliases;
  const CATALOG = {
    models: [{ id: 'openrouter/z-ai/glm-5.3' }, { id: 'openrouter/z-ai/glm-5.4' }, { id: 'google/gemini-3.8-flash' }, { id: 'openrouter/google/gemini-3.8-flash' }],
    fetchedAt: 1, lastRefreshAttempt: null, lastRefreshError: null, providerFailures: [], ceilingEnrichment: null,
  };
  let catalogCalls;
  let catalogCache;
  beforeEach(() => {
    jest.resetModules();
    process.env.CI = '0';   // Q8: a bare CI=true here would read as "off (CI)" and break the "on (weekly)" assertions
    delete process.env.AMICUS_NO_NETWORK_PROBES;   // I2: hermetic against an ambient AMICUS_NO_NETWORK_PROBES=1
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
    delete process.env.CI;
    process.stderr.write.mockRestore();
    fs.rmSync(process.env.AMICUS_CONFIG_DIR, { recursive: true, force: true });
    jest.dontMock('../../src/utils/curated-pins');
  });

  test('list: following vs pinned per row, grouped by vendor, a pinned alias behind a sibling is flagged, footer counts proposals', async () => {
    cfg.saveConfig({ default: 'gemini', aliases: { glm: 'openrouter/z-ai/glm-5.2', mine: 'openrouter/z-ai/glm-5.4' } });
    const { code, out } = await captureStdout(() => handleAliases({ _: ['aliases'] }));
    expect(code).toBe(0);
    expect(out).toMatch(/gemini\s+→\s+google\/gemini-3\.8-flash\s+following/);
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
  // R4 (#249 r1 C1): a pin that names the shipped model under another
  // gateway form gets no proposal (it is not stale and does not "differ" --
  // alias-proposals.js's own sameModel already treats it as identical), so
  // without a note it renders exactly like an arbitrary custom pin. This
  // is a truthful-transparency note, not a warning: no ⚠, and the footer
  // still says "nothing to review" since there genuinely is nothing to fix.
  test('R4: a pin that is the shipped model under another gateway form gets a truthful note, not a bare "pinned"', async () => {
    cfg.saveConfig({ aliases: { gemini: 'openrouter/google/gemini-3.8-flash' } });
    const { code, out } = await captureStdout(() => handleAliases({ _: ['aliases'] }));
    expect(code).toBe(0);
    expect(out).toMatch(/gemini\s+→\s+openrouter\/google\/gemini-3\.8-flash\s+pinned\s+same model as shipped, other gateway/);
    expect(out).not.toContain('⚠');
    expect(out).toContain('nothing to review');
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
  test("Q8 footer (F1 folded in): the standing refresh state and the catalog's age, in the spec's words", async () => {
    catalogCache = { ...CATALOG, fetchedAt: Date.now() - 3 * 24 * 60 * 60 * 1000 };
    const { code, out } = await captureStdout(() => handleAliases({ _: ['aliases'] }));
    expect(code).toBe(0);
    expect(out).toContain('\n  background catalog refresh: on (weekly) — catalog is 3 days old\n');
    expect(out).not.toContain('(catalog is 3 days old — amicus models --refresh)');
    expect(out).not.toContain('models --refresh');   // on + 3 days is the weekly cadence working
  });
  test('Q8 footer: off by config names the key and the hint rides when stale; off by CI names CI (mutant STATELIE: "on" regardless)', async () => {
    cfg.saveConfig({ aliases: {}, aliasReview: { autoRefresh: false } });
    catalogCache = { ...CATALOG, fetchedAt: Date.now() - 3 * 24 * 60 * 60 * 1000 };
    let r = await captureStdout(() => handleAliases({ _: ['aliases'] }));
    expect(r.out).toContain('\n  background catalog refresh: off (aliasReview.autoRefresh: false) — catalog is 3 days old — amicus models --refresh\n');
    cfg.saveConfig({ aliases: {} });
    process.env.CI = 'true';
    r = await captureStdout(() => handleAliases({ _: ['aliases'] }));
    expect(r.out).toContain('  background catalog refresh: off (CI) — catalog is 3 days old');
  });
  test('Q8 footer: no catalog at all — no state line (nothing refreshes until a first fetch creates the cache; the unavailable line already names models --refresh)', async () => {
    catalogCache = null;
    const { out } = await captureStdout(() => handleAliases({ _: ['aliases'] }));
    expect(out).toContain('catalog unavailable — cannot check for updates (amicus models --refresh)');
    expect(out).not.toContain('background catalog refresh');
  });
  test('--json carries the state as backgroundRefresh (mutant JSONMISSING)', async () => {
    cfg.saveConfig({ aliases: {}, aliasReview: { autoRefresh: false } });
    const { out } = await captureStdout(() => handleAliases({ _: ['aliases'], json: true }));
    expect(JSON.parse(out).backgroundRefresh).toEqual({ enabled: false, disabledBy: 'config' });
    cfg.saveConfig({ aliases: {} });
    const on = await captureStdout(() => handleAliases({ _: ['aliases'], json: true }));
    expect(JSON.parse(on.out).backgroundRefresh).toEqual({ enabled: true, disabledBy: null });
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
    // Minor: exact wording -- "keys left on disk; every alias still resolves
    // to the same id" (not the old "continuing with the normalized view",
    // which undersold what actually happened on disk).
    expect(process.stderr.write.mock.calls.some(c =>
      String(c[0]).includes('Notice: could not normalize aliases (disk full) — keys left on disk; every alias still resolves to the same id'))).toBe(true);
    cfg.saveConfig.mockRestore();
  });
  // F4 (#249 r2 review): this Notice line interpolated a caught err.message
  // RAW, contradicting the module docblock's claim that a caught message
  // rides collapseExcerpt. Same injection pattern as the test above, with a
  // hostile message instead of a plain one.
  test('F4: a hostile normalize-on-entry write-failure message is sanitized on stderr (no ESC)', async () => {
    const shipped = cfg.getDefaultAliases();
    fs.mkdirSync(process.env.AMICUS_CONFIG_DIR, { recursive: true });
    fs.writeFileSync(cfg.getConfigPath(), JSON.stringify({ aliases: { glm: shipped.glm } }));
    jest.spyOn(cfg, 'saveConfig').mockImplementation(() => { throw new Error(`disk full${HOSTILE_ESC}[31m!`); });
    await captureStdout(() => handleAliases({ _: ['aliases'] }));
    const stderrText = process.stderr.write.mock.calls.map(c => String(c[0])).join('');
    expect(stderrText).toContain('Notice: could not normalize aliases (disk full');
    expect(stderrText).not.toContain(HOSTILE_ESC);
    cfg.saveConfig.mockRestore();
  });
  // R8a (#249 r1 A3/D4): normalizeAliases only drops a value equal to the
  // shipped default -- a garbage (non-string) value sat on disk forever,
  // since probe.removed stayed empty and saveConfig was never triggered.
  // saveConfig already has its own stripper (D6, "Removing invalid alias");
  // this only needs to make sure it actually gets CALLED for this case.
  test("R8a: a non-string alias value converges via saveConfig's own stripper; the row still reads following", async () => {
    fs.mkdirSync(process.env.AMICUS_CONFIG_DIR, { recursive: true });
    fs.writeFileSync(cfg.getConfigPath(), JSON.stringify({ aliases: { gemini: 42 } }));
    const { code, out } = await captureStdout(() => handleAliases({ _: ['aliases'] }));
    expect(code).toBe(0);
    expect(out).toMatch(/gemini\s+→[^\n]*\sfollowing/);
    const onDisk = JSON.parse(fs.readFileSync(cfg.getConfigPath(), 'utf-8'));
    expect(onDisk.aliases).not.toHaveProperty('gemini');
    expect(process.stderr.write.mock.calls.some(c => String(c[0]).includes("Removing invalid alias 'gemini'"))).toBe(true);
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

  // R3 (#249 r2 C4): a hostile alias name/id must never reach the terminal
  // raw -- ANSI and bidi controls dropped, and the smuggled '\n' must never
  // forge a second, independent line (the attack `alias-shadow.js` names).
  // Mutant RAWFRAG (drop the `safeFragment` calls here) turns this red.
  test('R3: renderAliasList sanitizes a hostile alias name and id in a row', () => {
    const { renderAliasList } = require('../../src/sidecar/aliases');
    const alias = HOSTILE_ALIAS;
    const id = HOSTILE_ID;
    const view = {
      rows: [{ alias, id, state: 'pinned', curated: false, shipped: null }],
      proposals: [],
      catalogInfo: { fetchedAt: Date.now(), models: [{ id }] },
      catalogAvailable: true,
    };
    const out = renderAliasList(view);
    expect(out).not.toContain(HOSTILE_ESC);
    expect(out).not.toContain(HOSTILE_RLO);
    expect(out).not.toMatch(/^Notice: forged/m);
    expect(out).toContain('red');
    expect(out).toContain('evil');
  });

  // F1 (#249 r2 review, C4 residual): for a vendor NOT in ALIAS_VENDOR_LABELS,
  // the group label is `titleCaseVendor(vendorOf(<config value>))` -- still
  // third-party text, since title-casing strips nothing. Mutant: drop the
  // `safeFragment(g.label)` wrap at the push -> red.
  test('F1: renderAliasList sanitizes a hostile vendor-group label (unmapped vendor)', () => {
    const { renderAliasList } = require('../../src/sidecar/aliases');
    const view = {
      rows: [{ alias: 'mine', id: HOSTILE_VENDOR_ID, state: 'pinned', curated: false, shipped: null }],
      proposals: [],
      catalogInfo: { fetchedAt: Date.now(), models: [{ id: HOSTILE_VENDOR_ID }] },
      catalogAvailable: true,
    };
    const out = renderAliasList(view);
    expect(out).not.toContain(HOSTILE_ESC);
    expect(out).not.toContain(HOSTILE_RLO);
    expect(out).not.toMatch(/^notice: forged/im);
    expect(out).toContain('evil');
  });

  describe('--unpin (#238 PR1 fix wave F6)', () => {
    test('unpinning a curated name reverts it to following and says so', async () => {
      cfg.saveConfig({ aliases: { glm: 'openrouter/z-ai/glm-5.4' } });
      const shipped = cfg.getDefaultAliases();
      const { code, out } = await captureStdout(() => handleAliases({ _: ['aliases'], unpin: 'glm' }));
      expect(code).toBe(0);
      expect(out).toBe(`✓ glm now follows the shipped recommendation (${shipped.glm})\n`);
      const onDisk = JSON.parse(fs.readFileSync(cfg.getConfigPath(), 'utf-8'));
      expect(onDisk.aliases).not.toHaveProperty('glm');
    });
    test('unpinning a custom (non-curated) name deletes it', async () => {
      cfg.saveConfig({ aliases: { mycustom: 'openrouter/z-ai/glm-5.4' } });
      const { code, out } = await captureStdout(() => handleAliases({ _: ['aliases'], unpin: 'mycustom' }));
      expect(code).toBe(0);
      expect(out).toBe('✓ mycustom removed\n');
      const onDisk = JSON.parse(fs.readFileSync(cfg.getConfigPath(), 'utf-8'));
      expect(onDisk.aliases).not.toHaveProperty('mycustom');
    });
    test('unpinning a name that is not pinned is an error', async () => {
      const { code, out } = await captureStdout(() => handleAliases({ _: ['aliases'], unpin: 'nope' }));
      expect(code).toBe(1);
      expect(out).toBe('');
      expect(process.stderr.write.mock.calls.some(c => String(c[0]).includes("Error: 'nope' is not pinned (see: amicus aliases)"))).toBe(true);
    });
    // R3 (#249 r2 C4): a padded hostile name is refused as "not pinned" (it
    // was never in this empty config) and the ECHOED name in that message is
    // clean -- ANSI dropped, and trimmed same as every other --unpin path.
    test('R3: --unpin echoes a padded hostile name cleanly when refusing "not pinned"', async () => {
      const { code, out } = await captureStdout(() => handleAliases({ _: ['aliases'], unpin: `  ${HOSTILE_ALIAS}  ` }));
      expect(code).toBe(1);
      expect(out).toBe('');
      const stderrText = process.stderr.write.mock.calls.map(c => String(c[0])).join('');
      expect(stderrText).toContain('is not pinned (see: amicus aliases)');
      expect(stderrText).not.toContain(HOSTILE_ESC);
      expect(stderrText).toContain('red');
    });
    test('--unpin combined with --review or --json is an argument error', async () => {
      const a = await captureStdout(() => handleAliases({ _: ['aliases'], unpin: 'glm', review: true }));
      expect(a.code).toBe(1);
      expect(a.out).toBe('');
      const b = await captureStdout(() => handleAliases({ _: ['aliases'], unpin: 'glm', json: true }));
      expect(b.code).toBe(1);
      expect(b.out).toBe('');
      expect(process.stderr.write.mock.calls.filter(c => String(c[0]).includes('--unpin cannot be combined')).length).toBe(2);
    });
    test('--unpin with no value (parsed as true) is an argument error', async () => {
      const { code, out } = await captureStdout(() => handleAliases({ _: ['aliases'], unpin: true }));
      expect(code).toBe(1);
      expect(out).toBe('');
      expect(process.stderr.write.mock.calls.some(c => String(c[0]).includes('Error: --unpin requires an alias name'))).toBe(true);
    });
    test('a non-string --unpin value is the same argument error', async () => {
      const { code } = await captureStdout(() => handleAliases({ _: ['aliases'], unpin: 42 }));
      expect(code).toBe(1);
      expect(process.stderr.write.mock.calls.some(c => String(c[0]).includes('Error: --unpin requires an alias name'))).toBe(true);
    });

    // R1 (#249 r1 A5/C4/D1): empty/whitespace/literal-'null' names must be the
    // same clean argument error, never an uncaught throw from alias-store.js's
    // own name guard.
    test.each([[''], ['   '], ['null']])('--unpin %j is the argument error, never a throw', async (value) => {
      const { code, out } = await captureStdout(() => handleAliases({ _: ['aliases'], unpin: value }));
      expect(code).toBe(1);
      expect(out).toBe('');
      expect(process.stderr.write.mock.calls.some(c => String(c[0]).includes('Error: --unpin requires an alias name'))).toBe(true);
    });

    // R1: a padded name must use the TRIMMED name throughout -- for the
    // removeAlias lookup, the isCurated check, and the success message --
    // instead of mis-reporting a curated unpin as a bare "removed".
    test('a padded name unpinning a curated alias still reports "now follows", named without the padding', async () => {
      cfg.saveConfig({ aliases: { glm: 'openrouter/z-ai/glm-5.4' } });
      const shipped = cfg.getDefaultAliases();
      const { code, out } = await captureStdout(() => handleAliases({ _: ['aliases'], unpin: ' glm' }));
      expect(code).toBe(0);
      expect(out).toBe(`✓ glm now follows the shipped recommendation (${shipped.glm})\n`);
      const onDisk = JSON.parse(fs.readFileSync(cfg.getConfigPath(), 'utf-8'));
      expect(onDisk.aliases).not.toHaveProperty('glm');
    });
    test('a padded name unpinning a custom alias reports "removed", named without the padding', async () => {
      cfg.saveConfig({ aliases: { mine: 'openrouter/z-ai/glm-5.4' } });
      const { code, out } = await captureStdout(() => handleAliases({ _: ['aliases'], unpin: ' mine ' }));
      expect(code).toBe(0);
      expect(out).toBe('✓ mine removed\n');
      const onDisk = JSON.parse(fs.readFileSync(cfg.getConfigPath(), 'utf-8'));
      expect(onDisk.aliases).not.toHaveProperty('mine');
    });

    // R4 (#249 r2 D2): unpinning a non-curated name that is ALSO
    // config.default would leave the default dangling on a key that no
    // longer resolves -- refused before any write, never a silent dangle.
    test('R4(a): --unpin refuses a non-curated name that is also config.default; no write', async () => {
      cfg.saveConfig({ default: 'mine', aliases: { mine: 'openrouter/x/y' } });
      const { code, out } = await captureStdout(() => handleAliases({ _: ['aliases'], unpin: 'mine' }));
      expect(code).toBe(1);
      expect(out).toBe('');
      expect(process.stderr.write.mock.calls.some(c => String(c[0]).includes(
        "Error: 'mine' is your default model (config.default) — pick another default first (amicus setup)"))).toBe(true);
      const onDisk = JSON.parse(fs.readFileSync(cfg.getConfigPath(), 'utf-8'));
      expect(onDisk.aliases).toHaveProperty('mine', 'openrouter/x/y');
      expect(onDisk.default).toBe('mine');
    });

    // A CURATED default is unaffected -- it keeps resolving from the shipped
    // table after the unpin, same as any other curated unpin.
    test('R4(b): --unpin still unpins a CURATED name even when it is config.default', async () => {
      cfg.saveConfig({ default: 'glm', aliases: { glm: 'openrouter/z-ai/glm-5.2' } });
      const shipped = cfg.getDefaultAliases();
      const { code, out } = await captureStdout(() => handleAliases({ _: ['aliases'], unpin: 'glm' }));
      expect(code).toBe(0);
      expect(out).toBe(`✓ glm now follows the shipped recommendation (${shipped.glm})\n`);
      const onDisk = JSON.parse(fs.readFileSync(cfg.getConfigPath(), 'utf-8'));
      expect(onDisk.aliases).not.toHaveProperty('glm');
    });

    // config.default can also be a bare model id (not an alias name at all,
    // per start-helpers.js) -- the guard compares against the literal `name`
    // argument, so a default that merely resolves to the SAME id is not a match.
    test('R4(c): config.default is a full model id, not the alias name -- --unpin is unaffected', async () => {
      cfg.saveConfig({ default: 'openrouter/x/y', aliases: { mine: 'openrouter/x/y' } });
      const { code, out } = await captureStdout(() => handleAliases({ _: ['aliases'], unpin: 'mine' }));
      expect(code).toBe(0);
      expect(out).toBe('✓ mine removed\n');
      const onDisk = JSON.parse(fs.readFileSync(cfg.getConfigPath(), 'utf-8'));
      expect(onDisk.aliases).not.toHaveProperty('mine');
    });
  });

  // MEASURED 2026-09-14 (`npx jest tests/sidecar/aliases-command.test.js
  // tests/sidecar/aliases-review.test.js`; mutant: `retiredNote` in
  // src/sidecar/aliases.js body replaced with `return { flag: '', ruling:
  // null };` unconditionally; restored via `git checkout --
  // src/sidecar/aliases.js`, confirmed clean `git status --porcelain`):
  // RED (1) — this test only; the other 71 tests across both files stay green.
  test('a pin naming a RETIRED alias is flagged with the date and the ruling on a continuation line, and gets no proposal (#238 D8; mutant RETIREDFLAG)', async () => {
    mockPins({ retired: { devstral: { on: '2026-08-04', ruling: 'OpenRouter delisted the whole devstral family.' } } });
    ({ handleAliases } = require('../../src/sidecar/aliases'));
    cfg.saveConfig({ default: 'gemini', aliases: { devstral: 'openrouter/mistralai/devstral-medium' } });
    const { code, out } = await captureStdout(() => handleAliases({ _: ['aliases'] }));
    expect(code).toBe(0);
    expect(out).toMatch(/devstral\s+→\s+openrouter\/mistralai\/devstral-medium\s+pinned\s+⚠ retired 2026-08-04\n\s+↳ OpenRouter delisted the whole devstral family\./);
    // whole-branch review Minor #5: the footer names the retired-flagged
    // count instead of the bare (misleading-by-omission) "nothing to review".
    expect(out).toContain('nothing to review (1 retired pin flagged above) — amicus aliases --review');
  });
  test('--json carries `retired` and a retired pin still appears as a plain pinned row', async () => {
    mockPins({ retired: { devstral: { on: '2026-08-04', ruling: 'delisted' } } });
    ({ handleAliases } = require('../../src/sidecar/aliases'));
    cfg.saveConfig({ default: 'gemini', aliases: { devstral: 'openrouter/mistralai/devstral-medium' } });
    const { out } = await captureStdout(() => handleAliases({ _: ['aliases'], json: true }));
    const doc = JSON.parse(out);
    expect(doc.retired.devstral).toEqual({ on: '2026-08-04', ruling: 'delisted' });
    expect(doc.aliases.find(r => r.alias === 'devstral').state).toBe('pinned');
    expect(doc.proposals.find(p => p.alias === 'devstral')).toBeUndefined();
  });
  test('a notable entry in the shipped file surfaces as an unmapped proposal end-to-end (R-P2-8)', async () => {
    mockPins({ notable: [{ id: 'openrouter/z-ai/glm-5.4', suggestedAlias: 'glm-next', note: 'next glm' }] });
    ({ handleAliases } = require('../../src/sidecar/aliases'));
    cfg.saveConfig({ default: 'gemini', aliases: {} });
    const { out } = await captureStdout(() => handleAliases({ _: ['aliases'], json: true }));
    const doc = JSON.parse(out);
    const p = doc.proposals.find(x => x.alias === 'glm-next');
    expect(p).toEqual(expect.objectContaining({ state: 'unmapped', reasons: ['notable-unmapped'] }));
    expect(p.candidates[0]).toEqual({ id: 'openrouter/z-ai/glm-5.4', why: 'notable', evidence: { note: 'next glm' } });
  });
  test('the shipped file today has no notable entry and only devstral retired, so nothing above changes the default listing', async () => {
    ({ handleAliases } = require('../../src/sidecar/aliases'));
    cfg.saveConfig({ default: 'gemini', aliases: {} });
    const { out } = await captureStdout(() => handleAliases({ _: ['aliases'], json: true }));
    const doc = JSON.parse(out);
    expect(Object.keys(doc.retired)).toEqual(['devstral']);
    expect(doc.proposals).toEqual([]);
  });
  test('--unpin still works after the move to aliases-unpin.js (the whole existing --unpin block below is the regression net)', async () => {
    ({ handleAliases } = require('../../src/sidecar/aliases'));
    cfg.saveConfig({ default: 'gemini', aliases: { glm: 'openrouter/z-ai/glm-5.2' } });
    const { code, out } = await captureStdout(() => handleAliases({ _: ['aliases'], unpin: 'glm' }));
    expect(code).toBe(0);
    expect(out).toContain('glm now follows the shipped recommendation');
  });
  it('collectAliasView({ write: false }) normalizes in memory only — the seeded key stays on disk (mutant WIZARDWRITE: ignore the option)', async () => {
    const shipped = cfg.getDefaultAliases();
    const [alias] = Object.keys(shipped);
    // A seeded key equal to the shipped id, written WITHOUT saveConfig (whose normalizer would drop it).
    const file = path.join(process.env.AMICUS_CONFIG_DIR, 'config.json');
    fs.mkdirSync(process.env.AMICUS_CONFIG_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ default: alias, aliases: { [alias]: shipped[alias] } }, null, 2));
    const aliases = require('../../src/sidecar/aliases');
    const view = await aliases.collectAliasView({ maxAgeMs: Number.POSITIVE_INFINITY, write: false }, aliases.loadDeps());
    expect(view.rows.find(r => r.alias === alias).state).toBe('following');   // the in-memory view IS normalized…
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).aliases[alias]).toBe(shipped[alias]);   // …and disk is untouched
    await aliases.collectAliasView({ maxAgeMs: Number.POSITIVE_INFINITY }, aliases.loadDeps());
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).aliases[alias]).toBeUndefined();        // the default path still normalizes on entry (D6)
  });
});

describe('aliases is a registered command with a --review flag', () => {
  test('usage names it, the flag registry knows --review, parseArgs treats --review as boolean', () => {
    const { getUsage, getCommandNames, parseArgs } = require('../../src/cli');
    expect(getCommandNames()).toContain('aliases');
    expect(getUsage('aliases')).toContain('--review');
    expect(getUsage()).toMatch(/\n {2}aliases\s+/);
    const { getKnownFlags } = require('../../src/utils/known-flags');
    expect(getKnownFlags().has('review')).toBe(true);
    const parsed = parseArgs(['aliases', '--review', 'stray']);
    expect(parsed.review).toBe(true);
    expect(parsed._).toEqual(['aliases', 'stray']);
  });

  // F6: --unpin is a VALUE flag, not boolean -- it must consume the
  // following token rather than swallowing it as a stray positional.
  test('usage names --unpin, getKnownFlags knows it, parseArgs treats it as a value flag (#238 F6)', () => {
    const { getUsage, parseArgs } = require('../../src/cli');
    expect(getUsage('aliases')).toContain('--unpin');
    const { getKnownFlags } = require('../../src/utils/known-flags');
    expect(getKnownFlags().has('unpin')).toBe(true);
    const parsed = parseArgs(['aliases', '--unpin', 'glm']);
    expect(parsed.unpin).toBe('glm');
    expect(parsed._).toEqual(['aliases']);
  });
});

describe('amicus aliases --ui (#238 D4, Phase 3)', () => {
  let launch, cfg, handleAliases;
  beforeEach(() => {
    jest.resetModules();
    process.env.AMICUS_CONFIG_DIR = path.join(os.tmpdir(), `amicus-aliases-ui-${process.pid}-${Date.now()}`);
    fs.rmSync(process.env.AMICUS_CONFIG_DIR, { recursive: true, force: true });
    launch = jest.fn(async () => ({ success: true }));
    jest.doMock('../../src/sidecar/setup-window', () => ({ launchSetupWindow: launch }));
    jest.doMock('../../src/utils/model-catalog', () => ({
      getCatalogInfo: jest.fn(async () => ({ models: [], fetchedAt: null, providerFailures: [] })),
      readCache: jest.fn(() => null),
      DEFAULT_MAX_AGE_MS: 24 * 60 * 60 * 1000,
    }));
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    cfg = require('../../src/utils/config');
    ({ handleAliases } = require('../../src/sidecar/aliases'));
  });
  afterEach(() => {
    process.stderr.write.mockRestore();
    fs.rmSync(process.env.AMICUS_CONFIG_DIR, { recursive: true, force: true });
    jest.dontMock('../../src/sidecar/setup-window');
  });

  test('opens the setup window on the Routing step and reports the save', async () => {
    const { code, out } = await captureStdout(() => handleAliases({ _: ['aliases'], ui: true }));
    expect(launch).toHaveBeenCalledWith({ pane: 'aliases' });
    expect(code).toBe(0);
    expect(out).toBe('Aliases saved.\n');
  });

  test('closed without Finish / launch failure: the reason on stderr, exit 1 (R-P3-12)', async () => {
    launch.mockResolvedValueOnce({ success: false, error: 'Setup window closed without completing' });
    const { code, out } = await captureStdout(() => handleAliases({ _: ['aliases'], ui: true }));
    expect(code).toBe(1);
    expect(out).toBe('');
    expect(process.stderr.write).toHaveBeenCalledWith('Setup window closed without completing\nTerminal alternative: amicus aliases --review\n');
  });

  test('B2 (council review of PR 253): a launch that REJECTS is the same exit-1 path — reason on stderr once, with the terminal alternative; nothing on stdout (mutant ESCAPE: no try/catch, the promise rejects instead of resolving 1)', async () => {
    launch.mockRejectedValueOnce(new Error('spawn ENOENT'));
    const { code, out } = await captureStdout(() => handleAliases({ _: ['aliases'], ui: true }));   // ESCAPE dies here: the await rejects
    expect(code).toBe(1);
    expect(out).toBe('');
    expect(process.stderr.write).toHaveBeenCalledTimes(1);
    expect(process.stderr.write).toHaveBeenCalledWith('Could not launch the setup window: spawn ENOENT\nTerminal alternative: amicus aliases --review\n');
  });

  test.each([
    [{ ui: true, json: true }], [{ ui: true, review: true }], [{ ui: true, owner: true }], [{ ui: true, review: true, owner: true }], [{ ui: true, unpin: 'glm' }],
  ])('%o is an argument error: nothing launched, exit 1', async (flags) => {
    const { code, out } = await captureStdout(() => handleAliases({ _: ['aliases'], ...flags }));
    expect(code).toBe(1);
    expect(out).toBe('');
    expect(launch).not.toHaveBeenCalled();
    expect(process.stderr.write).toHaveBeenCalledWith('Error: --ui opens the setup window at the Routing step; it cannot be combined with --json, --review, --owner or --unpin\n');
  });

  test('normalizes the config on entry like every aliases form (D6) BEFORE the window opens (mutant UINORMALIZE)', async () => {
    const shipped = cfg.getDefaultAliases();
    const [alias] = Object.keys(shipped);
    const file = path.join(process.env.AMICUS_CONFIG_DIR, 'config.json');
    fs.mkdirSync(process.env.AMICUS_CONFIG_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ default: alias, aliases: { [alias]: shipped[alias] } }, null, 2));
    launch.mockImplementationOnce(async () => {
      expect(JSON.parse(fs.readFileSync(file, 'utf8')).aliases[alias]).toBeUndefined();   // already gone when the window opens
      return { success: true };
    });
    const { code } = await captureStdout(() => handleAliases({ _: ['aliases'], ui: true }));
    expect(code).toBe(0);
    expect(launch).toHaveBeenCalledTimes(1);
  });
});
