// tests/models-drift.test.js
'use strict';

const fs = require('fs');
const path = require('path');
const { buildFallbackDriftReport } = require('../src/sidecar/models');

const row = id => ({ id });

describe('buildFallbackDriftReport', () => {
  test('reports families whose pinned openrouter fallback is behind the live pick', () => {
    const catalog = [row('openrouter/google/gemini-9.9-flash')];
    const lines = buildFallbackDriftReport(catalog);
    expect(lines.some(l => l.includes('gemini') && l.includes('openrouter/google/gemini-9.9-flash'))).toBe(true);
  });
  test('silent when fallbacks match the live resolution or catalog is empty', () => {
    expect(buildFallbackDriftReport([])).toEqual([]);
    const { getFamilies } = require('../src/utils/curated-models');
    const current = getFamilies().map(f => row(f.fallback.openrouter));
    expect(buildFallbackDriftReport(current)).toEqual([]);
  });
  // #238 §5: a REJECTED openrouter namespace leaves the catalog missing the
  // rows that would make a pin look current; reporting drift from that
  // catalog proposes a downgrade. Named mutant "FAILEDNS" — drop the
  // providerFailures guard; measured red 2026-09-14, reddens
  // 'buildFallbackDriftReport › silent when the openrouter namespace was
  // rejected (providerFailures)'.
  test('silent when the openrouter namespace was rejected (providerFailures)', () => {
    const info = {
      models: [row('openrouter/google/gemini-9.9-flash')],
      providerFailures: [{ provider: 'openrouter', reason: 'http-status', status: 403 }],
    };
    expect(buildFallbackDriftReport(info)).toEqual([]);
  });
  test('still reports from a catalogInfo whose failures name another provider', () => {
    const info = {
      models: [row('openrouter/google/gemini-9.9-flash')],
      providerFailures: [{ provider: 'google', reason: 'http-status', status: 401 }],
    };
    expect(buildFallbackDriftReport(info).some(l => l.includes('gemini'))).toBe(true);
  });
});

describe('runCheck drift wiring', () => {
  // runCheck emits all output through process.stdout.write (never console.log).
  // We mock the three external dependencies so the test is hermetic:
  //   - getCatalogInfo returns a minimal catalog with a newer gemini id than
  //     the pinned fallback, which causes buildFallbackDriftReport to produce
  //     a drift line.
  //   - collectAliasSources / findStaleAliases return zero stale aliases so we
  //     exercise the "all clean + drift header" branch, not the stale branch.
  beforeEach(() => {
    jest.resetModules();

    // Catalog contains a newer gemini flash than the pinned fallback
    // (openrouter/google/gemini-3.5-flash in curated-models.js), guaranteeing
    // buildFallbackDriftReport produces at least one drift line.
    jest.mock('../src/utils/model-catalog', () => ({
      getCatalogInfo: async () => ({
        models: [{ id: 'openrouter/google/gemini-9.9-flash' }],
        fetchedAt: Date.now(),
      }),
      refreshCatalog: async () => [],
      catalogPath: () => '/mock/path/model-catalog.json',
    }));

    // Zero stale aliases → runCheck reaches the "all clean" + drift branch.
    jest.mock('../src/utils/alias-audit', () => ({
      collectAliasSources: () => [],
      findStaleAliases: () => [],
      // v4.6.2 PR1 (2A): additive export runCheck now destructures — must be
      // present on any full-replacement mock of this module or the require
      // throws "findDriftedStoredAliases is not a function".
      findDriftedStoredAliases: () => [],
      suggestReplacements: () => [],
    }));
  });

  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
  });

  test('console path prints the drift header; --json path does not', async () => {
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    // Re-require after mocks are in place so the mocked modules are used.
    const { handleModels } = require('../src/sidecar/models');

    // --- console (default) path ---
    await handleModels({ _: ['models'], check: true });
    const consoleOutput = writeSpy.mock.calls.map(c => c[0]).join('');
    expect(consoleOutput).toContain('Pinned fallback drift:');

    writeSpy.mockClear();

    // --- --json path ---
    await handleModels({ _: ['models'], check: true, json: true });
    const jsonOutput = writeSpy.mock.calls.map(c => c[0]).join('');
    expect(jsonOutput).not.toContain('Pinned fallback drift:');

    writeSpy.mockRestore();
  });
});

// Named mutant "SIBLINGGATE": replace `const gated = gatedCatalogIds(info);`
// in buildFallbackDriftReport with `const gated = catalog.map(m => m && m.id)
// .filter(Boolean);` (feeds the sibling scan every catalog id instead of the
// §5-gated set). Measured red 2026-09-14: reddens exactly one test — 'a
// sibling on a non-authoritative row, or in a rejected namespace, is never
// named (§5 rules 1–2; mutant SIBLINGGATE)' (its first assertion, the
// non-authoritative floor row; the second assertion, the rejected-namespace
// case, is caught earlier by the providerFailures guard and stays green under
// this mutant). Restored after measurement — see the commit history.
// #238 whole-branch review Important #1(a): pinned to the FROZEN
// tests/fixtures/curated-pins-b803a2a.json fixture (byte-identical to
// today's shipped file, never moves) instead of the live loadCuratedPins() —
// the literals below are literals of the fixture, so the D3 baseline session
// (the owner moving a pin, the very next step after this PR merges) cannot
// redden them.
describe('buildFallbackDriftReport — #238 Q7 newer-sibling lines for cardless pins', () => {
  let build, doc;
  beforeEach(() => {
    jest.resetModules();
    const real = jest.requireActual('../src/utils/curated-pins');
    doc = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixtures/curated-pins-b803a2a.json'), 'utf8'));
    jest.doMock('../src/utils/curated-pins', () => ({ ...real, loadCuratedPins: () => JSON.parse(JSON.stringify(doc)) }));
    build = require('../src/sidecar/models').buildFallbackDriftReport;
  });
  afterEach(() => { jest.dontMock('../src/utils/curated-pins'); });
  const current = () => Object.values(doc.pins).map(p => row(p.routes.openrouter));
  test('a strictly newer same-tier sibling of a cardless pin is named with the owner-mode hint; the exit-code-free family line points there too', () => {
    const lines = build({ models: [...current(), row('openrouter/z-ai/glm-5.4'), row('openrouter/google/gemini-9.9-flash')], providerFailures: [] });
    expect(lines).toContain('  newer sibling: glm → openrouter/z-ai/glm-5.3 (catalog: openrouter/z-ai/glm-5.4) — amicus aliases --review --owner');
    expect(lines.find(l => l.includes('pinned fallback drift: gemini'))).toContain('— amicus aliases --review --owner (a family match');
    expect(lines.some(l => l.includes('update curated-models.js'))).toBe(false);
  });
  // F5 (#238 council r1 A1/B4/D2): `live`/`newer` are CATALOG-derived
  // (third-party); the pinned/fallback id beside them is house bytes from
  // curated-pins.json and is printed as-is. The sibling comparator requires
  // vendor/prefix/suffix to match EXACTLY (only the version may differ), so a
  // hostile candidate can only ever match a pin that carries the identical
  // suffix -- mutating the (test-local, mocked) pin to also carry it is the
  // only way to exercise a genuine sibling match here, and it doubles as
  // proof the two sides are sanitized asymmetrically by provenance.
  test('a hostile catalog id in the sibling position is stripped in the "(catalog: …)" segment; the house-authored pinned id beside it is untouched', () => {
    const ESC = String.fromCharCode(0x1b);
    const hostileSuffix = `${ESC}[31m`;
    doc.pins.glm.routes.openrouter = `openrouter/z-ai/glm-5.3${hostileSuffix}`;
    const candidateHostile = `openrouter/z-ai/glm-5.4${hostileSuffix}`; // same vendor/prefix/suffix as the (mutated) pin, strictly newer version
    const lines = build({ models: [...current(), row(candidateHostile)], providerFailures: [] });
    const line = lines.find(l => l.startsWith('  newer sibling: glm'));
    expect(line).toBe(`  newer sibling: glm → openrouter/z-ai/glm-5.3${hostileSuffix} (catalog: openrouter/z-ai/glm-5.4) — amicus aliases --review --owner`);
  });
  test('silent for the current pins alone, and a family is never given a sibling line (its idPattern rule speaks for it)', () => {
    expect(build({ models: current(), providerFailures: [] })).toEqual([]);
    const lines = build({ models: [...current(), row('openrouter/openai/gpt-5.7-terra')], providerFailures: [] });
    expect(lines.filter(l => l.startsWith('  newer sibling:'))).toEqual([]);
    expect(lines.some(l => l.includes('pinned fallback drift: gpt'))).toBe(true);
  });
  test('a sibling on a non-authoritative row, or in a rejected namespace, is never named (§5 rules 1–2; mutant SIBLINGGATE)', () => {
    const floor = { id: 'openrouter/z-ai/glm-5.4', authoritative: false };
    expect(build({ models: [...current(), floor], providerFailures: [] }).filter(l => l.includes('glm'))).toEqual([]);
    expect(build({ models: [...current(), row('openrouter/z-ai/glm-5.4')], providerFailures: [{ provider: 'openrouter', reason: 'http-status', status: 403 }] })).toEqual([]);
  });
  test('a different tier or a glued size token is not a sibling (the comparator rules are inherited, not re-implemented)', () => {
    // gpt-5.7-luna-pro: suffix -luna-pro ≠ gpt-pro's -sol-pro; kimi-k30b: `30` glued to `b` is never a version — both measured null on 2026-09-14.
    // (gpt-5.7-sol-pro WOULD be gpt-pro's sibling — measured — so it is deliberately not used here.)
    const lines = build({ models: [...current(), row('openrouter/openai/gpt-5.7-luna-pro'), row('openrouter/moonshotai/kimi-k30b')], providerFailures: [] });
    expect(lines.filter(l => l.startsWith('  newer sibling:'))).toEqual([]);
  });
  test('a bare models array (older callers) still works', () => {
    expect(build([...current(), row('openrouter/x-ai/grok-4.4')])).toContain('  newer sibling: grok → openrouter/x-ai/grok-4.3 (catalog: openrouter/x-ai/grok-4.4) — amicus aliases --review --owner');
  });
});

// #238 whole-branch review Important #1(a): also pinned to the FROZEN
// tests/fixtures/curated-pins-b803a2a.json fixture now (see the sibling
// describe above) — both the mocked catalog's "current models" and
// buildFallbackDriftReport's own pins come from the same frozen `doc`, so
// this describe stays green after the D3 baseline session moves a pin.
describe('runCheck exit code — #238 Q7 sibling lines are informational only', () => {
  // handleModels-level invariant (no prior test covered this): the new
  // "newer sibling" lines are computed after runCheck's exit-code math and
  // must never move it, with or without --strict. Only model-catalog is
  // mocked — alias-audit, alias-shadow and gateway-route-audit run for real
  // against the hermetic empty config (tests/setup/hermetic-config-dir.js),
  // so this also proves the real pipeline stays quiet (no stale/drifted/
  // gateway findings) for the current pins plus one cardless newer sibling
  // (measured 2026-09-14: sources=32, stale=[], drifted=[], gatewayFindings=[]).
  // The explicit unmock matters: 'runCheck drift wiring' above calls
  // jest.mock('../src/utils/alias-audit', ...) inside ITS beforeEach, and a
  // jest.mock() registration outlives jest.resetModules()/restoreAllMocks()
  // for the rest of the file — without this line collectAliasSources() would
  // silently resolve to that earlier test's empty-array mock instead of the
  // real module (measured: sources.length 0 instead of 32).
  let handleModels, doc;
  beforeEach(() => {
    jest.unmock('../src/utils/alias-audit');
    jest.resetModules();
    const real = jest.requireActual('../src/utils/curated-pins');
    doc = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixtures/curated-pins-b803a2a.json'), 'utf8'));
    jest.doMock('../src/utils/curated-pins', () => ({ ...real, loadCuratedPins: () => JSON.parse(JSON.stringify(doc)) }));
    // jest.doMock, not jest.mock: babel-plugin-jest-hoist statically refuses a
    // hoisted jest.mock() factory that closes over an out-of-scope variable
    // not prefixed `mock` (guards against the classic hoisting footgun) —
    // doMock is not hoisted, so it is exempt, and this factory needs `doc`.
    jest.doMock('../src/utils/model-catalog', () => {
      const currentModels = () => Object.values(doc.pins).map(p => ({ id: p.routes.openrouter }));
      return {
        getCatalogInfo: async () => ({
          models: [...currentModels(), { id: 'openrouter/z-ai/glm-5.4' }],
          fetchedAt: Date.now(),
          providerFailures: [],
        }),
        refreshCatalog: async () => [],
        catalogPath: () => '/mock/path/model-catalog.json',
      };
    });
    handleModels = require('../src/sidecar/models').handleModels;
  });

  afterEach(() => {
    jest.dontMock('../src/utils/curated-pins');
    jest.dontMock('../src/utils/model-catalog');
    jest.dontMock('../src/utils/alias-audit');
    jest.resetModules();
    jest.restoreAllMocks();
  });

  test('exit code is 0 with the sibling line present, and stays 0 under --strict', async () => {
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const exitCode = await handleModels({ _: ['models'], check: true });
    const output = writeSpy.mock.calls.map(c => c[0]).join('');
    expect(exitCode).toBe(0);
    expect(output).toContain('  newer sibling: glm → openrouter/z-ai/glm-5.3 (catalog: openrouter/z-ai/glm-5.4) — amicus aliases --review --owner');

    writeSpy.mockClear();

    const strictExitCode = await handleModels({ _: ['models'], check: true, strict: true });
    expect(strictExitCode).toBe(0);

    writeSpy.mockRestore();
  });
});
