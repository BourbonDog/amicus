/** F5: amicus models — list/search/refresh/check with --json and exit codes. */

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));

const CATALOG = [
  { id: 'openrouter/x-ai/grok-4.3', name: 'Grok 4.3', contextLength: 256000,
    pricing: { prompt: '0.000003', completion: '0.000015' } },
  { id: 'openrouter/google/gemini-3.1-flash-lite-preview', name: 'Gemini Flash Lite',
    contextLength: 1048576, pricing: null },
];

function loadHandler({ catalog = CATALOG, sources, stale, drifted, gatewayFindings, probeStoredAliases,
  ceilingEnrichment = null } = {}) {
  jest.resetModules();
  jest.doMock('../../src/utils/model-catalog', () => ({
    getCatalogInfo: jest.fn(async () => ({ models: catalog, fetchedAt: 1718000000000, ceilingEnrichment })),
    refreshCatalog: jest.fn(async () => catalog),
    catalogPath: () => 'C:/fake/model-catalog.json',
  }));
  if (sources || stale || drifted) {
    jest.doMock('../../src/utils/alias-audit', () => ({
      collectAliasSources: () => sources || [],
      findStaleAliases: () => stale || [],
      // Additive (v4.6.2 PR1, 2A): defaults to [] so pre-existing callers of
      // loadHandler() that never mention drift keep exercising a clean state.
      findDriftedStoredAliases: () => drifted || [],
      suggestReplacements: () => ['openrouter/x-ai/grok-4.3'],
    }));
  }
  if (gatewayFindings !== undefined) {
    jest.doMock('../../src/utils/gateway-route-audit', () => ({
      auditGatewayRoutes: () => gatewayFindings,
    }));
  }
  // v4.6.2 PR3: only mocked when a test passes a spy, so it can assert
  // whether the probe module was called (or not — the --live branch gate is
  // the whole point of the regression test). Tests that never touch --live
  // don't need it mocked; the real (side-effect-free at require time) module
  // loads instead.
  if (probeStoredAliases) {
    jest.doMock('../../src/sidecar/models-probe', () => ({
      probeStoredAliases,
      // Task 4: models.js's cap pre-check now imports this real predicate
      // from models-probe.js instead of inlining its own filter — mock it
      // with the same logic so the mocked module stays a faithful stand-in.
      selectStoredAliases: (sources) => sources.filter(s => s.source === 'user-config'),
      PROBE_WINDOW_MS: 30000,
      PROBE_PROMPT: 'Reply with exactly: OK',
    }));
  }
  return require('../../src/sidecar/models');
}

function captureStdout(fn) {
  const writes = [];
  const orig = process.stdout.write;
  process.stdout.write = (s) => { writes.push(String(s)); return true; };
  return Promise.resolve().then(fn).finally(() => { process.stdout.write = orig; })
    .then(code => ({ code, out: writes.join('') }));
}

describe('amicus models', () => {
  it('default lists the catalog with context and pricing columns', async () => {
    const { handleModels } = loadHandler();
    const { code, out } = await captureStdout(() => handleModels({ _: ['models'] }));
    expect(code).toBe(0);
    expect(out).toContain('openrouter/x-ai/grok-4.3');
    expect(out).toContain('256000');
    expect(out).toContain('3.00');
    expect(out).toContain('(2 models');
  });

  it('--search filters by substring over id+name', async () => {
    const { handleModels } = loadHandler();
    const { code, out } = await captureStdout(() => handleModels({ _: ['models'], search: 'grok' }));
    expect(code).toBe(0);
    expect(out).toContain('grok-4.3');
    expect(out).not.toContain('gemini-3.1');
  });

  it('--json list emits a parseable model-catalog document', async () => {
    const { handleModels } = loadHandler();
    const { code, out } = await captureStdout(() => handleModels({ _: ['models'], json: true }));
    expect(code).toBe(0);
    const doc = JSON.parse(out);
    expect(doc.schemaVersion).toBe(2);
    expect(doc.type).toBe('model-catalog');
    expect(doc.count).toBe(2);
    expect(doc.models[0].id).toBe('openrouter/x-ai/grok-4.3');
  });

  it('--refresh refreshes and reports the count', async () => {
    const { handleModels } = loadHandler();
    const { code, out } = await captureStdout(() => handleModels({ _: ['models'], refresh: true }));
    expect(code).toBe(0);
    expect(out).toContain('Refreshed catalog: 2 models');
  });

  it('--refresh prints the ceilings line when models.dev filled rows', async () => {
    const { handleModels } = loadHandler({ ceilingEnrichment: { source: 'models.dev', failure: null, filled: 12, alreadyKnown: 380, unknown: 5, skippedRouters: 6, skippedLocal: 0 } });
    const { code, out } = await captureStdout(() => handleModels({ _: ['models'], refresh: true }));
    expect(code).toBe(0);
    expect(out).toContain('Ceilings: 12 rows filled from models.dev (380 already known, 5 unknown to models.dev)');
  });

  it('--refresh says so when models.dev was unreachable', async () => {
    const { handleModels } = loadHandler({ ceilingEnrichment: { source: 'models.dev', failure: { reason: 'timeout', detail: 'no response within 10000ms' }, filled: 0 } });
    const { out } = await captureStdout(() => handleModels({ _: ['models'], refresh: true }));
    expect(out).toContain('Ceilings: models.dev unreachable (timeout: no response within 10000ms); rows without a ceiling keep the engine default and outputBudget cannot clamp them');
  });

  // Council #230 D4: 'unreachable' is a claim about models.dev. A parse-error means
  // it answered; an exception is a local bug. Neither may be worded as unreachable.
  it('--refresh words a parse-error as answered-but-unusable, not unreachable', async () => {
    const { handleModels } = loadHandler({ ceilingEnrichment: { source: 'models.dev', failure: { reason: 'parse-error', detail: 'Unexpected token <' }, filled: 0, alreadyKnown: 0, unknown: 0, skippedRouters: 0, skippedLocal: 0 } });
    const { out } = await captureStdout(() => handleModels({ _: ['models'], refresh: true }));
    expect(out).toContain('Ceilings: models.dev answered but could not be used (parse-error: Unexpected token <); rows without a ceiling keep the engine default and outputBudget cannot clamp them');
    expect(out).not.toContain('unreachable');
  });

  it('--refresh words an exception neutrally, blaming neither models.dev nor the network', async () => {
    const { handleModels } = loadHandler({ ceilingEnrichment: { source: 'models.dev', failure: { reason: 'exception', detail: 'kaboom' }, filled: 0, alreadyKnown: 0, unknown: 0, skippedRouters: 0, skippedLocal: 0 } });
    const { out } = await captureStdout(() => handleModels({ _: ['models'], refresh: true }));
    expect(out).toContain('Ceilings: ceiling enrichment failed (exception: kaboom); rows without a ceiling keep the engine default and outputBudget cannot clamp them');
    expect(out).not.toContain('unreachable');
  });

  it('--refresh prints zeros, not undefined, for a partial ceilingEnrichment object', async () => {
    const { handleModels } = loadHandler({ ceilingEnrichment: { source: 'models.dev', failure: null, filled: 3 } });
    const { out } = await captureStdout(() => handleModels({ _: ['models'], refresh: true }));
    expect(out).toContain('Ceilings: 3 rows filled from models.dev (0 already known, 0 unknown to models.dev)');
    expect(out).not.toContain('undefined');
  });

  it('--refresh --json carries ceilingEnrichment', async () => {
    const enrichment = { source: 'models.dev', failure: null, filled: 1, alreadyKnown: 0, unknown: 0, skippedRouters: 0, skippedLocal: 0 };
    const { handleModels } = loadHandler({ ceilingEnrichment: enrichment });
    const { out } = await captureStdout(() => handleModels({ _: ['models'], refresh: true, json: true }));
    expect(JSON.parse(out).ceilingEnrichment).toEqual(enrichment);
  });

  it('--check clean → exit 0', async () => {
    const { handleModels } = loadHandler({ sources: [], stale: [] });
    const { code, out } = await captureStdout(() => handleModels({ _: ['models'], check: true }));
    expect(code).toBe(0);
    expect(out).toContain('All aliases resolve');
  });

  it('--check stale → exit = stale count, prints suggestions + paste-ready fix', async () => {
    const stale = [{ alias: 'grok', model: 'openrouter/x-ai/grok-4.1-fast', source: 'defaults' }];
    const { handleModels } = loadHandler({ sources: stale, stale });
    const { code, out } = await captureStdout(() => handleModels({ _: ['models'], check: true }));
    expect(code).toBe(1);
    expect(out).toContain('STALE: grok -> openrouter/x-ai/grok-4.1-fast (defaults)');
    expect(out).toContain('openrouter/x-ai/grok-4.3');
    expect(out).toContain('amicus setup --add-alias grok=openrouter/x-ai/grok-4.3');
  });

  it('--check --json emits an alias-audit document', async () => {
    const stale = [{ alias: 'grok', model: 'openrouter/x-ai/grok-4.1-fast', source: 'defaults' }];
    const { handleModels } = loadHandler({ sources: stale, stale });
    const { code, out } = await captureStdout(() => handleModels({ _: ['models'], check: true, json: true }));
    expect(code).toBe(1);
    const doc = JSON.parse(out);
    expect(doc.type).toBe('alias-audit');
    expect(doc.staleCount).toBe(1);
    expect(doc.stale[0]).toEqual({
      alias: 'grok', model: 'openrouter/x-ai/grok-4.1-fast', source: 'defaults',
      suggestions: ['openrouter/x-ai/grok-4.3']
    });
    // v4.6.2 PR1 (2A): additive field, [] when nothing drifted.
    expect(doc.drifted).toEqual([]);
    expect(doc.driftedCount).toBe(0);
  });

  // v4.6.2 PR1 (2A): stored-alias drift warning — a stored alias whose target
  // is still catalog-live but behind the current quick-pick family
  // resolution. Distinct from `stale` (dead target) and never affects exitCode.
  describe('--check drift wiring (v4.6.2 PR1, 2A)', () => {
    const oneDrift = [{
      alias: 'gemini', stored: 'openrouter/google/gemini-3.1-flash-lite-preview',
      current: 'google/gemini-3.6-flash',
    }];

    it('prints DRIFTED lines with a paste-ready refresh fix and exit stays 0', async () => {
      const { handleModels } = loadHandler({ sources: [], stale: [], drifted: oneDrift });
      const { code, out } = await captureStdout(() => handleModels({ _: ['models'], check: true }));
      expect(code).toBe(0); // drift never affects the exit code
      expect(out).toContain(
        'DRIFTED: gemini -> openrouter/google/gemini-3.1-flash-lite-preview (stored; current resolution: google/gemini-3.6-flash)');
      expect(out).toContain('amicus setup --add-alias gemini=google/gemini-3.6-flash');
      expect(out).not.toContain('All aliases resolve'); // suppressed: drift alone is not "all clean"
    });

    it('--json carries the additive drifted array; exit code still unaffected', async () => {
      const { handleModels } = loadHandler({ sources: [], stale: [], drifted: oneDrift });
      const { code, out } = await captureStdout(() => handleModels({ _: ['models'], check: true, json: true }));
      expect(code).toBe(0);
      const doc = JSON.parse(out);
      expect(doc.type).toBe('alias-audit');
      expect(doc.drifted).toEqual(oneDrift);
      expect(doc.driftedCount).toBe(1);
    });

    it('both stale and drifted present: STALE lines, DRIFTED lines, and exit code from stale only', async () => {
      const stale = [{ alias: 'grok', model: 'openrouter/x-ai/grok-4.1-fast', source: 'defaults' }];
      const { handleModels } = loadHandler({ sources: stale, stale, drifted: oneDrift });
      const { code, out } = await captureStdout(() => handleModels({ _: ['models'], check: true }));
      expect(code).toBe(1); // unchanged: exit code is driven by stale.length only
      expect(out).toContain('STALE: grok -> openrouter/x-ai/grok-4.1-fast (defaults)');
      expect(out).toContain('DRIFTED: gemini -> openrouter/google/gemini-3.1-flash-lite-preview');
    });

    it('clean (no stale, no drift) still prints the all-clear line', async () => {
      const { handleModels } = loadHandler({ sources: [], stale: [], drifted: [] });
      const { code, out } = await captureStdout(() => handleModels({ _: ['models'], check: true }));
      expect(code).toBe(0);
      expect(out).toContain('All aliases resolve');
    });
  });

  it('--check with empty catalog → cannot check, exit 0', async () => {
    const { handleModels } = loadHandler({ catalog: [] });
    const { code, out } = await captureStdout(() => handleModels({ _: ['models'], check: true }));
    expect(code).toBe(0);
    expect(out).toContain('Catalog unavailable');
  });

  it('exit code caps at 100', async () => {
    const stale = Array.from({ length: 150 }, (_, i) =>
      ({ alias: `a${i}`, model: `openrouter/v/m${i}`, source: 'defaults' }));
    const { handleModels } = loadHandler({ sources: stale, stale });
    const { code } = await captureStdout(() => handleModels({ _: ['models'], check: true }));
    expect(code).toBe(100);
  });

  it('bin routes the models command and lifecycle counts it one-shot', () => {
    const fs = require('fs');
    const path = require('path');
    const binSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'bin', 'amicus.js'), 'utf-8');
    expect(binSrc).toMatch(/case 'models':/);
    const { isOneShotCommand } = require('../../src/utils/lifecycle');
    expect(isOneShotCommand('models')).toBe(true);
  });

  it('usage text documents the models command', () => {
    const { getUsage } = require('../../src/cli');
    const usage = getUsage();
    expect(usage).toContain('models');
    expect(usage).toContain('--refresh');
    expect(usage).toContain('--check');
  });

  it('marks rows using the user\'s effective aliases, not curated defaults', async () => {
    try {
      await jest.isolateModulesAsync(async () => {
        jest.doMock('../../src/utils/model-catalog', () => ({
        getCatalogInfo: jest.fn(async () => ({
          models: [
            { id: 'openrouter/x-ai/grok-4.3', name: 'Grok 4.3', contextLength: 256000, pricing: null },
          ],
            fetchedAt: 1718000000000,
          })),
          refreshCatalog: jest.fn(async () => []),
          catalogPath: () => 'C:/fake/model-catalog.json',
        }));
        jest.doMock('../../src/utils/config', () => ({
          getEffectiveAliases: () => ({ myalias: 'openrouter/x-ai/grok-4.3' }),
          getDefaultAliases: () => ({ gemini: 'openrouter/google/not-in-catalog' }),
        }));
        const { handleModels } = require('../../src/sidecar/models');
        const { code, out } = await captureStdout(() => handleModels({ _: ['models'] }));
        expect(code).toBe(0);
        expect(out).toContain('[myalias] openrouter/x-ai/grok-4.3');
      });
    } finally {
      // ⚠️ MOCK LEAK — RE-MEASURED at PR #207 council round 5 (A2), which
      // challenged the mechanism. Both halves hold, and both were measured on
      // this file:
      //   · The leak is REAL. Delete this line and the file fails 2 tests with
      //     21 copies of "could not check whether local aliases shadow the
      //     curated table (loadConfig is not a function)". `doMock` registers in
      //     the MOCK registry; `isolateModulesAsync` sandboxes only the MODULE
      //     registry, and `loadHandler`'s `jest.resetModules()` clears only that
      //     one too — so the stub above (exporting just getEffectiveAliases and
      //     getDefaultAliases) answers every later `require('utils/config')` in
      //     the file, with no `loadConfig` on it.
      //   · The FINALLY is what round 5 was right about, by a different route.
      //     Measured: force the assertion inside the block to fail and the undo
      //     is skipped entirely — one red test becomes three, and two of them
      //     point at an unrelated describe. A leak this wide must not depend on
      //     the body succeeding.
      // Undone here, at the leak, rather than defensively in each later describe.
      // (`doMock` is not hoisted, and this runs after the block, so no earlier
      // test in declaration order ever sees the stub removed.)
      jest.dontMock('../../src/utils/config');
    }
  });

  it('--search without a value errors instead of dumping the catalog', async () => {
    const { handleModels } = loadHandler();
    const writes = [];
    const orig = process.stderr.write;
    process.stderr.write = (s) => { writes.push(String(s)); return true; };
    let code;
    try { code = await handleModels({ _: ['models'], search: true }); }
    finally { process.stderr.write = orig; }
    expect(code).toBe(1);
    expect(writes.join('')).toContain('--search requires a value');
  });

  it('renders the -1 variable-pricing sentinel as — not a negative price', async () => {
    const catalog = [
      { id: 'openrouter/acme/variable', name: 'Variable', contextLength: 1000,
        pricing: { prompt: '-1', completion: '-1' } },
    ];
    const { handleModels } = loadHandler({ catalog });
    const { code, out } = await captureStdout(() => handleModels({ _: ['models'] }));
    expect(code).toBe(0);
    expect(out).toContain('$/Mtok in — out —');
    expect(out).not.toContain('-1000000');
  });

  it('npm model scripts point at a live CLI entry (dangling-script regression guard)', () => {
    const fs = require('fs');
    const path = require('path');
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf-8'));
    for (const name of ['refresh-models', 'models:info', 'models:check']) {
      expect(pkg.scripts[name]).toContain('bin/amicus.js models');
    }
    expect(fs.existsSync(path.join(__dirname, '..', '..', 'bin', 'amicus.js'))).toBe(true);
  });

  // #13: stale-catalog memo — surface when the last refresh attempt failed.
  describe('stale-catalog memo (#13)', () => {
    function loadHandlerWithOutcome({ catalog = CATALOG, fetchedAt = 1718000000000,
      lastRefreshAttempt = null, lastRefreshError = null, refreshResult } = {}) {
      jest.resetModules();
      jest.doMock('../../src/utils/model-catalog', () => ({
        getCatalogInfo: jest.fn(async () => ({ models: catalog, fetchedAt, lastRefreshAttempt, lastRefreshError })),
        refreshCatalog: jest.fn(async () => (refreshResult !== undefined ? refreshResult : catalog)),
        catalogPath: () => 'C:/fake/model-catalog.json',
      }));
      return require('../../src/sidecar/models');
    }

    it('default list appends a stale memo when the last attempt failed after the last success', async () => {
      const { handleModels } = loadHandlerWithOutcome({
        lastRefreshAttempt: 1718003600000, lastRefreshError: 'network-error: all providers unreachable'
      });
      const { code, out } = await captureStdout(() => handleModels({ _: ['models'] }));
      expect(code).toBe(0);
      expect(out).toContain('stale');
      expect(out).toContain('network-error: all providers unreachable');
      expect(out).toContain(new Date(1718003600000).toISOString());
      expect(out).toContain(new Date(1718000000000).toISOString());
    });

    it('default list has NO stale memo when there has been no failed attempt', async () => {
      const { handleModels } = loadHandlerWithOutcome();
      const { code, out } = await captureStdout(() => handleModels({ _: ['models'] }));
      expect(code).toBe(0);
      expect(out).not.toContain('stale');
    });

    it('--json list carries the outcome fields additively', async () => {
      const { handleModels } = loadHandlerWithOutcome({
        lastRefreshAttempt: 1718003600000, lastRefreshError: 'network-error: all providers unreachable'
      });
      const { code, out } = await captureStdout(() => handleModels({ _: ['models'], json: true }));
      expect(code).toBe(0);
      const doc = JSON.parse(out);
      expect(doc.lastRefreshAttempt).toBe(1718003600000);
      expect(doc.lastRefreshError).toBe('network-error: all providers unreachable');
      // existing fields still present (additive, not a replacement)
      expect(doc.schemaVersion).toBe(2);
      expect(doc.count).toBe(2);
    });

    it('--refresh reports an honest failure instead of "Refreshed catalog: 0 models"', async () => {
      const { handleModels } = loadHandlerWithOutcome({
        refreshResult: [],
        lastRefreshAttempt: 1718003600000, lastRefreshError: 'network-error: all providers unreachable',
      });
      const { code, out } = await captureStdout(() => handleModels({ _: ['models'], refresh: true }));
      expect(code).toBe(0); // stale-but-served: warning, not a command failure (cache exists)
      expect(out).not.toContain('Refreshed catalog: 0 models');
      expect(out).toContain('refresh failed');
      expect(out).toContain('network-error: all providers unreachable');
      expect(out).toContain('keeping catalog from');
      expect(out).toContain(new Date(1718000000000).toISOString());
    });

    it('--refresh failure with NO cache at all is a real failure (non-zero exit)', async () => {
      const { handleModels } = loadHandlerWithOutcome({
        catalog: [], fetchedAt: null, refreshResult: [],
        lastRefreshAttempt: 1718003600000, lastRefreshError: 'network-error: all providers unreachable',
      });
      const { code, out } = await captureStdout(() => handleModels({ _: ['models'], refresh: true }));
      expect(code).not.toBe(0);
      expect(out).toContain('refresh failed');
    });

    it('--refresh success still reports the count as before', async () => {
      const { handleModels } = loadHandlerWithOutcome({ refreshResult: CATALOG });
      const { code, out } = await captureStdout(() => handleModels({ _: ['models'], refresh: true }));
      expect(code).toBe(0);
      expect(out).toContain('Refreshed catalog: 2 models');
    });

    it('--refresh --json on success reports the persisted fetchedAt and null outcome fields', async () => {
      const { handleModels } = loadHandlerWithOutcome({ refreshResult: CATALOG, fetchedAt: 1718000000000 });
      const { code, out } = await captureStdout(() => handleModels({ _: ['models'], refresh: true, json: true }));
      expect(code).toBe(0);
      const doc = JSON.parse(out);
      expect(doc.fetchedAt).toBe(1718000000000);
      expect(doc.lastRefreshAttempt).toBeNull();
      expect(doc.lastRefreshError).toBeNull();
      expect(doc.count).toBe(2);
    });

    it('--refresh --json on failure reports the stale fetchedAt (not null) plus the outcome fields', async () => {
      const { handleModels } = loadHandlerWithOutcome({
        refreshResult: [], fetchedAt: 1718000000000,
        lastRefreshAttempt: 1718003600000, lastRefreshError: 'network-error: all providers unreachable',
      });
      const { code, out } = await captureStdout(() => handleModels({ _: ['models'], refresh: true, json: true }));
      expect(code).toBe(0); // stale-but-served
      const doc = JSON.parse(out);
      expect(doc.fetchedAt).toBe(1718000000000);
      expect(doc.lastRefreshAttempt).toBe(1718003600000);
      expect(doc.lastRefreshError).toBe('network-error: all providers unreachable');
    });
  });

  // Task 6 (#gwid): per-gateway-form audit (toGatewayRoutes() vs. the live
  // catalog) layered onto the existing flat alias audit above. Non-strict:
  // informational only (never changes the exit code). --strict: gates the
  // exit code on these findings so CI can fail the build on drift.
  describe('--check per-gateway audit + --strict (Task 6, #gwid)', () => {
    const oneFinding = [{ alias: 'opus', gateway: 'direct', kind: 'stale', model: 'anthropic/claude-opus-4-1' }];

    it('non-strict: gateway findings are reported but never affect the exit code', async () => {
      const { handleModels } = loadHandler({ sources: [], stale: [], gatewayFindings: oneFinding });
      const { code, out } = await captureStdout(() => handleModels({ _: ['models'], check: true }));
      expect(code).toBe(0);
      expect(out).toContain('opus');
      expect(out).toContain('anthropic/claude-opus-4-1');
    });

    it('--strict: exits non-zero when a curated default alias is stale/divergent per-gateway, even if the flat audit is clean', async () => {
      const { handleModels } = loadHandler({ sources: [], stale: [], gatewayFindings: oneFinding });
      const { code } = await captureStdout(() => handleModels({ _: ['models'], check: true, strict: true }));
      expect(code).toBeGreaterThan(0);
    });

    it('--strict: exits 0 when both audits are clean', async () => {
      const { handleModels } = loadHandler({ sources: [], stale: [], gatewayFindings: [] });
      const { code, out } = await captureStdout(() => handleModels({ _: ['models'], check: true, strict: true }));
      expect(code).toBe(0);
      expect(out).toContain('All aliases resolve');
    });

    it('--strict --json: includes gatewayFindings in the alias-audit document and exits non-zero', async () => {
      const { handleModels } = loadHandler({ sources: [], stale: [], gatewayFindings: oneFinding });
      const { code, out } = await captureStdout(() =>
        handleModels({ _: ['models'], check: true, strict: true, json: true }));
      expect(code).toBeGreaterThan(0);
      const doc = JSON.parse(out);
      expect(doc.type).toBe('alias-audit');
      expect(doc.gatewayFindingsCount).toBe(1);
      expect(doc.gatewayFindings).toEqual(oneFinding);
    });

    it('--json without --strict still carries gatewayFindings, but exit code is unaffected', async () => {
      const { handleModels } = loadHandler({ sources: [], stale: [], gatewayFindings: oneFinding });
      const { code, out } = await captureStdout(() =>
        handleModels({ _: ['models'], check: true, json: true }));
      expect(code).toBe(0);
      const doc = JSON.parse(out);
      expect(doc.gatewayFindingsCount).toBe(1);
    });

    it('reports divergent-missing and divergent-mismatch findings with distinct, readable text', async () => {
      const findings = [
        // HISTORICAL fixture: fable's direct route was authored 2026-08-05, so the
        // curated route table can no longer produce divergent-missing for it. Kept as a
        // pure rendering-path fixture — the renderer must handle the kind regardless.
        { alias: 'fable', gateway: 'direct', kind: 'divergent-missing', model: 'anthropic/claude-fable-5' },
        { alias: 'haiku', gateway: 'direct', kind: 'divergent-mismatch',
          model: 'anthropic/claude-haiku-4-5-old', expected: 'anthropic/claude-haiku-4-5-new' },
      ];
      const { handleModels } = loadHandler({ sources: [], stale: [], gatewayFindings: findings });
      const { out } = await captureStdout(() => handleModels({ _: ['models'], check: true }));
      expect(out).toContain('fable');
      expect(out).toContain('anthropic/claude-fable-5');
      expect(out).toContain('haiku');
      expect(out).toContain('anthropic/claude-haiku-4-5-old');
      expect(out).toContain('anthropic/claude-haiku-4-5-new');
    });

    it('empty catalog (cannot check) short-circuits before the gateway audit runs, still exit 0 with --strict', async () => {
      const { handleModels } = loadHandler({ catalog: [], gatewayFindings: oneFinding });
      const { code, out } = await captureStdout(() =>
        handleModels({ _: ['models'], check: true, strict: true }));
      expect(code).toBe(0);
      expect(out).toContain('Catalog unavailable');
    });

    it('usage text documents --strict for models --check', () => {
      const { getUsage } = require('../../src/cli');
      const usage = getUsage();
      expect(usage).toContain('--strict');
    });
  });

  // v4.6.2 PR3 (spec §6, D5): `--check --live` — probe every stored alias with
  // one real engine leg. probeStoredAliases (src/sidecar/models-probe.js) is
  // ALWAYS mocked via loadHandler's `probeStoredAliases` param here — these
  // tests exercise the CLI wiring only (branch gate, exit combine, human/
  // --json rendering, the cap pre-check), not the probe module's own
  // classification logic (see tests/sidecar/models-probe.test.js for that).
  describe('--check --live (v4.6.2 PR3)', () => {
    const threeOutcomes = [
      { alias: 'gemini', target: 'openrouter/google/gemini-3.6-flash', outcome: 'served', detail: null, cost: 0.0004 },
      {
        alias: 'probetest', target: 'anthropic/claude-opus-4-8', outcome: 'accepted-but-silent',
        detail: 'NO_OUTPUT_BACKSTOP: model produced no output, reasoning, or tool calls in 30s', cost: null,
      },
      { alias: 'gpt', target: 'openai/gpt-5.6-terra', outcome: 'error', detail: '402 Payment Required', cost: null },
    ];

    function captureStderr(fn) {
      const writes = [];
      const orig = process.stderr.write;
      process.stderr.write = (s) => { writes.push(String(s)); return true; };
      return Promise.resolve().then(fn).finally(() => { process.stderr.write = orig; })
        .then(code => ({ code, err: writes.join('') }));
    }

    it('without --live, runCheck never calls the probe module (regression — byte-identical output)', async () => {
      const probeStoredAliases = jest.fn();
      const { handleModels } = loadHandler({ sources: [], stale: [], probeStoredAliases });
      const { code, out } = await captureStdout(() => handleModels({ _: ['models'], check: true }));
      expect(code).toBe(0);
      expect(out).toContain('All aliases resolve');
      expect(out).not.toContain('Live probe');
      expect(probeStoredAliases).not.toHaveBeenCalled();
    });

    it('--live prints all three outcome classes in the documented format, after drift, before gateway findings', async () => {
      const probeStoredAliases = jest.fn(async () => ({ results: threeOutcomes, waveId: 'w9' }));
      const oneFinding = [{ alias: 'opus', gateway: 'direct', kind: 'stale', model: 'anthropic/claude-opus-4-1' }];
      const { handleModels } = loadHandler({
        sources: [], stale: [], probeStoredAliases, gatewayFindings: oneFinding,
      });
      const { code, out } = await captureStdout(() => handleModels({ _: ['models'], check: true, live: true }));
      expect(probeStoredAliases).toHaveBeenCalledTimes(1);
      expect(out).toContain('Live probe (3 stored aliases):');
      expect(out).toContain('  SERVED: gemini -> openrouter/google/gemini-3.6-flash ($0.0004)');
      expect(out).toContain('  SILENT: probetest -> anthropic/claude-opus-4-8 — NO_OUTPUT_BACKSTOP:');
      expect(out).toContain('(no output within the probe window)');
      expect(out).toContain('  ERROR:  gpt -> openai/gpt-5.6-terra — 402 Payment Required');
      expect(out.indexOf('Live probe')).toBeGreaterThan(out.indexOf('All aliases resolve'));
      expect(out.indexOf('Live probe')).toBeLessThan(out.indexOf('Per-gateway route audit'));
      expect(code).toBe(2); // 2 non-served, legacy exit was 0 -> max(0, min(2,100)) = 2
    });

    it('exit combine: probe dominates a lower legacy (stale) exit', async () => {
      const probeStoredAliases = jest.fn(async () => ({ results: threeOutcomes, waveId: 'w9' })); // nonServed = 2
      const stale = [{ alias: 'grok', model: 'openrouter/x-ai/grok-4.1-fast', source: 'defaults' }]; // legacy = 1
      const { handleModels } = loadHandler({ sources: stale, stale, probeStoredAliases });
      const { code } = await captureStdout(() => handleModels({ _: ['models'], check: true, live: true }));
      expect(code).toBe(2);
    });

    it('exit combine: a higher legacy (stale) exit is preserved over a smaller nonServed count', async () => {
      const probeStoredAliases = jest.fn(async () => ({
        results: [
          { alias: 'gemini', target: 'x', outcome: 'served', detail: null, cost: 0.0001 },
          { alias: 'grok', target: 'y', outcome: 'error', detail: 'boom', cost: null },
        ],
        waveId: 'w1',
      })); // nonServed = 1
      const stale = Array.from({ length: 5 }, (_, i) => ({ alias: `a${i}`, model: `openrouter/v/m${i}`, source: 'defaults' })); // legacy = 5
      const { handleModels } = loadHandler({ sources: stale, stale, probeStoredAliases });
      const { code } = await captureStdout(() => handleModels({ _: ['models'], check: true, live: true }));
      expect(code).toBe(5);
    });

    it('nonServed count caps at CHECK_EXIT_CAP (100)', async () => {
      const many = Array.from({ length: 150 }, (_, i) => ({ alias: `a${i}`, target: `m${i}`, outcome: 'error', detail: 'x', cost: null }));
      const probeStoredAliases = jest.fn(async () => ({ results: many, waveId: 'wbig' }));
      const { handleModels } = loadHandler({ sources: [], stale: [], probeStoredAliases });
      const { code } = await captureStdout(() => handleModels({ _: ['models'], check: true, live: true }));
      expect(code).toBe(100);
    });

    it('--json gains additive probe/probeCount fields', async () => {
      const probeStoredAliases = jest.fn(async () => ({ results: threeOutcomes, waveId: 'w9' }));
      const { handleModels } = loadHandler({ sources: [], stale: [], probeStoredAliases });
      const { code, out } = await captureStdout(() => handleModels({ _: ['models'], check: true, live: true, json: true }));
      expect(code).toBe(2);
      const doc = JSON.parse(out);
      expect(doc.type).toBe('alias-audit');
      expect(doc.probeCount).toBe(3);
      expect(doc.probe).toEqual(threeOutcomes);
      // additive: pre-existing fields still present
      expect(doc.staleCount).toBe(0);
      expect(doc.driftedCount).toBe(0);
    });

    it('--json without --live carries the additive default (probe: [], probeCount: 0, probeSkipped: null)', async () => {
      const { handleModels } = loadHandler({ sources: [], stale: [] });
      const { code, out } = await captureStdout(() => handleModels({ _: ['models'], check: true, json: true }));
      expect(code).toBe(0);
      const doc = JSON.parse(out);
      expect(doc.probe).toEqual([]);
      expect(doc.probeCount).toBe(0);
      expect(doc.probeSkipped).toBeNull();
    });

    it('--json WITH --live and the probe running: probeSkipped stays null (only set when the probe does NOT run)', async () => {
      const probeStoredAliases = jest.fn(async () => ({ results: threeOutcomes, waveId: 'w9' }));
      const { handleModels } = loadHandler({ sources: [], stale: [], probeStoredAliases });
      const { out } = await captureStdout(() =>
        handleModels({ _: ['models'], check: true, live: true, json: true }));
      const doc = JSON.parse(out);
      expect(doc.probeSkipped).toBeNull();
    });

    it('zero stored aliases: probe module returns empty results -> "no stored aliases to probe", exit unaffected', async () => {
      const probeStoredAliases = jest.fn(async () => ({ results: [], waveId: null }));
      const { handleModels } = loadHandler({ sources: [], stale: [], probeStoredAliases });
      const { code, out } = await captureStdout(() => handleModels({ _: ['models'], check: true, live: true }));
      expect(code).toBe(0);
      expect(out).toContain('no stored aliases to probe');
      expect(out).not.toContain('Live probe (');
    });

    it('--live without --check errors with a clear one-liner and never reaches the catalog/probe', async () => {
      const probeStoredAliases = jest.fn();
      const { handleModels } = loadHandler({ probeStoredAliases });
      const { code, err } = await captureStderr(() => handleModels({ _: ['models'], live: true }));
      expect(code).toBe(1);
      expect(err).toContain('--live requires --check');
      expect(probeStoredAliases).not.toHaveBeenCalled();
    });

    // Task 2 review carry-in: a stored-alias count above the fan-out leg cap
    // fails wave-creation pre-emptively inside runFanout, and models-probe.js
    // degrades every row to a generic error — losing the real reason. Pre-
    // check the cap here, in the CLI layer, before ever calling the probe.
    describe('the >max-legs edge', () => {
      const manyStored = Array.from({ length: 11 }, (_, i) => ({ alias: `s${i}`, model: `openrouter/v/m${i}`, source: 'user-config' }));

      afterEach(() => { delete process.env.AMICUS_FANOUT_MAX_LEGS; });

      it('stored count > default cap (10): errors, exits 1, never calls the probe (no spend on a doomed wave)', async () => {
        const probeStoredAliases = jest.fn();
        const { handleModels } = loadHandler({ sources: manyStored, stale: [], probeStoredAliases });
        const { code, err } = await captureStderr(() => handleModels({ _: ['models'], check: true, live: true }));
        expect(code).toBe(1);
        expect(err).toContain('11'); // count
        expect(err).toContain('10'); // cap
        expect(err).toContain('AMICUS_FANOUT_MAX_LEGS'); // env knob
        expect(probeStoredAliases).not.toHaveBeenCalled();
      });

      it('respects AMICUS_FANOUT_MAX_LEGS override when checking the cap', async () => {
        process.env.AMICUS_FANOUT_MAX_LEGS = '3';
        const fourStored = manyStored.slice(0, 4);
        const probeStoredAliases = jest.fn();
        const { handleModels } = loadHandler({ sources: fourStored, stale: [], probeStoredAliases });
        const { code, err } = await captureStderr(() => handleModels({ _: ['models'], check: true, live: true }));
        expect(code).toBe(1);
        expect(err).toContain('4');
        expect(err).toContain('3');
        expect(probeStoredAliases).not.toHaveBeenCalled();
      });

      it('stored count exactly AT the cap is allowed through (only > cap errors)', async () => {
        const tenStored = manyStored.slice(0, 10);
        // Task 4 review carry-in (Minor 5): the fixture used to claim 10
        // stored aliases while mocking an empty `results: []` — untruthful,
        // since a real probe returns one row per stored alias. Ten stored in,
        // ten SERVED rows out, keeping this test's own assertions unchanged.
        const tenResults = tenStored.map(s => (
          { alias: s.alias, target: s.model, outcome: 'served', detail: null, cost: 0.0001 }));
        const probeStoredAliases = jest.fn(async () => ({ results: tenResults, waveId: 'wcap' }));
        const { handleModels } = loadHandler({ sources: tenStored, stale: [], probeStoredAliases });
        const { code } = await captureStdout(() => handleModels({ _: ['models'], check: true, live: true }));
        expect(code).toBe(0);
        expect(probeStoredAliases).toHaveBeenCalledTimes(1);
      });
    });

    // Task 3 review (Important 1): this test used to pin --live as a SILENT
    // no-op here ("byte-identical to no --live") — updated, not extended,
    // to assert the new announcement instead (per the review's explicit
    // instruction not to merely add a sibling test alongside the old one).
    it('catalog unavailable + --live: announces the skip instead of silently doing nothing, probe never called', async () => {
      const probeStoredAliases = jest.fn();
      const { handleModels } = loadHandler({ catalog: [], probeStoredAliases });
      const { code, out } = await captureStdout(() => handleModels({ _: ['models'], check: true, live: true }));
      expect(code).toBe(0);
      expect(out).toContain('Catalog unavailable');
      expect(out).toContain('--live skipped: catalog-unavailable — nothing was probed');
      expect(out).not.toContain('Live probe');
      expect(probeStoredAliases).not.toHaveBeenCalled();
    });

    it('catalog unavailable WITHOUT --live: unchanged, no skip line (the announcement is --live-gated)', async () => {
      const { handleModels } = loadHandler({ catalog: [] });
      const { code, out } = await captureStdout(() => handleModels({ _: ['models'], check: true }));
      expect(code).toBe(0);
      expect(out).toContain('Catalog unavailable');
      expect(out).not.toContain('--live skipped');
    });

    it('catalog unavailable + --live + --json: doc gets probeSkipped "catalog-unavailable"', async () => {
      const probeStoredAliases = jest.fn();
      const { handleModels } = loadHandler({ catalog: [], probeStoredAliases });
      const { code, out } = await captureStdout(() =>
        handleModels({ _: ['models'], check: true, live: true, json: true }));
      expect(code).toBe(0);
      const doc = JSON.parse(out);
      expect(doc.catalogAvailable).toBe(false);
      expect(doc.probeSkipped).toBe('catalog-unavailable');
      expect(probeStoredAliases).not.toHaveBeenCalled();
    });

    it('catalog unavailable + --json (no --live): probeSkipped is null (additive default, drifted precedent)', async () => {
      const { handleModels } = loadHandler({ catalog: [] });
      const { code, out } = await captureStdout(() => handleModels({ _: ['models'], check: true, json: true }));
      expect(code).toBe(0);
      const doc = JSON.parse(out);
      expect(doc.catalogAvailable).toBe(false);
      expect(doc.probeSkipped).toBeNull();
    });

    // Task 3 review (Important 1 / Minor 4): --refresh short-circuits --check
    // in handleModels, so `--refresh --check --live` used to reach runRefresh
    // and silently never probe anything — the second silent-skip path named
    // by the review, distinct from the catalog-unavailable one above.
    describe('--refresh --check --live: the refresh short-circuit', () => {
      function captureBoth(fn) {
        const outWrites = []; const errWrites = [];
        const origOut = process.stdout.write; const origErr = process.stderr.write;
        process.stdout.write = (s) => { outWrites.push(String(s)); return true; };
        process.stderr.write = (s) => { errWrites.push(String(s)); return true; };
        return Promise.resolve().then(fn).finally(() => {
          process.stdout.write = origOut; process.stderr.write = origErr;
        }).then(code => ({ code, out: outWrites.join(''), err: errWrites.join('') }));
      }

      it('non-json: still refreshes, announces the skip, never calls the probe', async () => {
        const probeStoredAliases = jest.fn();
        const { handleModels } = loadHandler({ probeStoredAliases });
        const { code, out } = await captureStdout(() =>
          handleModels({ _: ['models'], refresh: true, check: true, live: true }));
        expect(code).toBe(0);
        expect(out).toContain('Refreshed catalog: 2 models.');
        expect(out).toContain('--live skipped: refresh-precedes-check — nothing was probed');
        expect(probeStoredAliases).not.toHaveBeenCalled();
      });

      it('--json: stdout stays valid JSON (model-catalog doc); the skip line goes to stderr instead', async () => {
        const probeStoredAliases = jest.fn();
        const { handleModels } = loadHandler({ probeStoredAliases });
        const { code, out, err } = await captureBoth(() =>
          handleModels({ _: ['models'], refresh: true, check: true, live: true, json: true }));
        expect(code).toBe(0);
        const doc = JSON.parse(out); // throws if stdout was corrupted by stray text
        expect(doc.type).toBe('model-catalog');
        expect(err).toContain('--live skipped: refresh-precedes-check — nothing was probed');
        expect(probeStoredAliases).not.toHaveBeenCalled();
      });

      it('--refresh --check WITHOUT --live: unchanged, no skip line (regression)', async () => {
        const { handleModels } = loadHandler();
        const { code, out } = await captureStdout(() =>
          handleModels({ _: ['models'], refresh: true, check: true }));
        expect(code).toBe(0);
        expect(out).toContain('Refreshed catalog: 2 models.');
        expect(out).not.toContain('--live skipped');
      });
    });

    it('usage text documents --live for models --check', () => {
      const { getUsage } = require('../../src/cli');
      const usage = getUsage();
      expect(usage).toContain('--live');
    });
  });

  /**
   * v4.9 W13 Task B (BACKLOG C5): `models --check` is the alias-audit surface,
   * so the alias-shadow notice fires here too — the second of its two measured
   * wiring sites (the first is `cli-council-run-bench.js :: resolveBench`; see
   * tests/alias-shadow.test.js's header for the site measurement and the full
   * SHADOWSILENT red set). It is stderr-only on purpose: `--check --json` writes
   * an audit document to stdout and must stay byte-clean.
   */
  describe('alias-shadow notice (v4.9 W13 Task B, C5)', () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const { toDefaultAliases } = require('../../src/utils/curated-models');
    const CURATED = toDefaultAliases();
    const STALE_KIMI = 'openrouter/moonshotai/kimi-k2.6';

    let tempDir;
    let originalEnv;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-models-shadow-'));
      originalEnv = { ...process.env };
      process.env.AMICUS_CONFIG_DIR = tempDir;
    });

    afterEach(() => {
      process.env = originalEnv;
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    function writeConfig(aliases) {
      fs.writeFileSync(path.join(tempDir, 'config.json'), JSON.stringify({ aliases }, null, 2));
    }

    function capture(fn) {
      const outWrites = []; const errWrites = [];
      const origOut = process.stdout.write; const origErr = process.stderr.write;
      process.stdout.write = (s) => { outWrites.push(String(s)); return true; };
      process.stderr.write = (s) => { errWrites.push(String(s)); return true; };
      return Promise.resolve().then(fn).finally(() => {
        process.stdout.write = origOut; process.stderr.write = origErr;
      }).then(code => ({ code, out: outWrites.join(''), err: errWrites.join('') }));
    }

    it('--check names a local alias that shadows a curated pin, on stderr', async () => {
      writeConfig({ kimi: STALE_KIMI });
      const { handleModels } = loadHandler();
      const { err } = await capture(() => handleModels({ _: ['models'], check: true }));
      expect(err).toContain(
        `Notice: alias 'kimi' resolves to ${STALE_KIMI} (curated ships ${CURATED.kimi})\n`);
    });

    it('--check --json: the notice never enters the audit document on stdout', async () => {
      writeConfig({ kimi: STALE_KIMI });
      const { handleModels } = loadHandler();
      const { out, err } = await capture(() =>
        handleModels({ _: ['models'], check: true, json: true }));
      const doc = JSON.parse(out); // throws if the notice corrupted stdout
      expect(doc.type).toBe('alias-audit');
      expect(err).toContain("alias 'kimi' resolves to");
    });

    it('ABSENCE CONTROL: a config whose aliases match the shipped ids says nothing', async () => {
      writeConfig({ kimi: CURATED.kimi, glm: CURATED.glm });
      const { handleModels } = loadHandler();
      const { err } = await capture(() => handleModels({ _: ['models'], check: true }));
      expect(err).not.toContain('curated ships');
    });

    it('ABSENCE CONTROL: plain `models` (no --check) is not an audit surface and stays quiet', async () => {
      writeConfig({ kimi: STALE_KIMI });
      const { handleModels } = loadHandler();
      const { err } = await capture(() => handleModels({ _: ['models'] }));
      expect(err).not.toContain('curated ships');
    });
  });
});
