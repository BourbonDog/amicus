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

describe('doctor aliases row — drift wiring', () => {
  test('drift-only state warns with "1 drifted"', async () => {
    const { runDoctorChecks } = require('../src/cli-handlers-doctor');
    const rows = await runDoctorChecks({
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
