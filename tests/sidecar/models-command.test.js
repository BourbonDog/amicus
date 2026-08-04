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

function loadHandler({ catalog = CATALOG, sources, stale, drifted, gatewayFindings } = {}) {
  jest.resetModules();
  jest.doMock('../../src/utils/model-catalog', () => ({
    getCatalogInfo: jest.fn(async () => ({ models: catalog, fetchedAt: 1718000000000 })),
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
});
