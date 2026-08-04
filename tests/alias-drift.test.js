'use strict';

const { findDriftedStoredAliases } = require('../src/utils/alias-audit');
const { resolveQuickPicks, toStorableRoute } = require('../src/utils/quick-picks');

// Fixture ids must satisfy the real gemini family pattern in curated-models.js
// so resolveQuickPicks yields a live route. Adjust ids after reading that file
// — the SHAPE of these tests is the contract, the ids must be family-real.
const CATALOG = [
  { id: 'openrouter/google/gemini-3.6-flash' },
  { id: 'openrouter/google/gemini-3.1-flash-lite-preview' }, // listed but old
  { id: 'openrouter/deepseek/deepseek-chat-v3' },
];

describe('findDriftedStoredAliases', () => {
  test('sanity: the fixture resolves a live gemini family route', () => {
    const live = resolveQuickPicks(CATALOG).find(r => r.alias === 'gemini');
    expect(live && live.source).toBe('live');
    expect(toStorableRoute(live)).toBeTruthy();
  });

  test('stored alias behind the current resolution -> one drift row', () => {
    const sources = [
      { alias: 'gemini', model: 'openrouter/google/gemini-3.1-flash-lite-preview', source: 'user-config' },
    ];
    const rows = findDriftedStoredAliases(sources, CATALOG);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      alias: 'gemini',
      stored: 'openrouter/google/gemini-3.1-flash-lite-preview',
    });
    expect(rows[0].current).not.toBe(rows[0].stored);
  });

  test('stored alias matching the current resolution -> no row', () => {
    const live = resolveQuickPicks(CATALOG).find(r => r.alias === 'gemini');
    const sources = [{ alias: 'gemini', model: toStorableRoute(live), source: 'user-config' }];
    expect(findDriftedStoredAliases(sources, CATALOG)).toHaveLength(0);
  });

  // Review finding 1: toStorableRoute() canonicalizes a direct-capable vendor's
  // OpenRouter pick to the bare direct form ('google/gemini-3.6-flash'), but a
  // stored gateway-form value ('openrouter/google/gemini-3.6-flash' — the exact
  // route resolveQuickPicks/pickCurrent surfaces as the live openrouter route,
  // and what a STALE fix's own suggestion may point users to store) names the
  // SAME model. Raw-string-comparing only against the canonicalized display
  // value false-positives this as drift. Must be a no-op: same model, just a
  // different gateway form.
  test('stored alias in the gateway (openrouter) form of the current model -> no row (false-positive guard)', () => {
    const sources = [
      { alias: 'gemini', model: 'openrouter/google/gemini-3.6-flash', source: 'user-config' },
    ];
    expect(findDriftedStoredAliases(sources, CATALOG)).toHaveLength(0);
  });

  test('non-user-config sources are never checked', () => {
    const sources = [
      { alias: 'gemini', model: 'openrouter/google/gemini-3.1-flash-lite-preview', source: 'defaults' },
      { alias: 'gemini', model: 'openrouter/google/gemini-3.1-flash-lite-preview', source: 'curated-route (openrouter)' },
    ];
    expect(findDriftedStoredAliases(sources, CATALOG)).toHaveLength(0);
  });

  test('a stored model absent from the catalog is stale, not drifted', () => {
    const sources = [{ alias: 'gemini', model: 'openrouter/google/gemini-2-dead', source: 'user-config' }];
    expect(findDriftedStoredAliases(sources, CATALOG)).toHaveLength(0);
  });

  test('a custom alias with no quick-pick family has no "current" to drift from', () => {
    const sources = [{ alias: 'mymodel', model: 'openrouter/deepseek/deepseek-chat-v3', source: 'user-config' }];
    expect(findDriftedStoredAliases(sources, CATALOG)).toHaveLength(0);
  });

  test('empty catalog -> [] (cannot check)', () => {
    expect(findDriftedStoredAliases([{ alias: 'gemini', model: 'x/y', source: 'user-config' }], []))
      .toHaveLength(0);
  });
});

// Hermeticity guard (final-review Item 1): runDoctorChecks always computes
// the FULL check list, not just 'aliases' -- overriding only readCache/
// collectAliasSources (as this describe block used to) leaves every OTHER dep
// to fall through to realDeps() and run for real: engine-install subprocess
// scans, the OpenRouter credit network probe, local-provider probes against
// the real user config, etc. baseDeps mirrors the same full-deps shape as
// tests/cli-handlers-doctor.test.js's `allGood` fixture (see that file's M14
// comment for the original writeup of this exact hazard). Neither
// findDriftedStoredAliases nor resolveQuickPicks is stubbed here or in
// allGood -- the per-test readCache/collectAliasSources overrides below still
// drive the real audit wiring this describe block exists to test.
const baseDeps = {
  nodeVersion: 'v20.0.0',
  readApiKeys: () => ({ openrouter: true, google: false, openai: false, anthropic: false, deepseek: false }),
  readApiKeyValues: () => ({ openrouter: 'sk-or-good' }),
  checkOpenRouterCredit: () => Promise.resolve({ warning: null, isFreeTier: false, limitRemaining: 5, limit: 10, usage: 5 }),
  getCwd: () => 'C:\\Users\\me\\code\\amicus',
  readProjectMarkers: () => ({ hasGit: true, hasPackageJson: true, hasClaude: false }),
  getConfigDir: () => '/cfg',
  resolveModel: () => 'openrouter/google/gemini-3.5-flash',
  readCache: () => ({ fetchedAt: Date.now(), models: [{ id: 'openrouter/google/gemini-3.5-flash' }] }),
  collectAliasSources: () => [{ alias: 'gemini', model: 'openrouter/google/gemini-3.5-flash', source: 'defaults' }],
  findStaleAliases: () => [],
  hasOpencodeBinary: () => true,
  getElectronPath: () => '/path/to/electron',
  hasAmicusRegistration: () => true,
  discoverCoworkMcps: () => ({ amicus: {} }),
  inspectLegacyMcpEntries: () => [
    { target: 'Claude Code', status: 'absent' },
    { target: 'Claude Desktop', status: 'absent' },
  ],
  migrateLegacyMcpEntries: () => [],
  skillInstalled: () => true,
  listSessionIndexTmpFiles: () => [],
  scanEngineInstalls: () => ({ installs: [], mcpLaunch: 'none' }),
  repairEngine: async () => ({ repaired: false }),
  scanElectronInstalls: () => ({ installs: [], mcpLaunch: 'none' }),
  getLocalProviders: () => ({}),
  probeLocalProvider: jest.fn(),
  env: {},
};

describe('doctor aliases row — drift wiring', () => {
  test('drift-only state warns with "1 drifted"', async () => {
    const { runDoctorChecks } = require('../src/cli-handlers-doctor');
    const rows = await runDoctorChecks({
      ...baseDeps,
      readCache: () => ({ models: CATALOG, fetchedAt: Date.now() }),
      collectAliasSources: () => ([
        { alias: 'gemini', model: 'openrouter/google/gemini-3.1-flash-lite-preview', source: 'user-config' },
      ]),
    });
    const row = rows.find(r => r.id === 'aliases');
    expect(row.status).toBe('warn');
    expect(row.message).toMatch(/1 drifted: gemini/);
  });
});
