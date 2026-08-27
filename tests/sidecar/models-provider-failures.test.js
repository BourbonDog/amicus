/**
 * Issue #209 surfacing: a provider whose catalog fetch was REJECTED must be
 * reported to the user. Recording the failure without showing it still leaves
 * the product silently degraded -- the whole point of the issue.
 */
jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));

const CATALOG = [
  { id: 'openrouter/x-ai/grok-4.3', name: 'Grok 4.3', contextLength: 256000, pricing: null },
];
const FAILURES = [{ provider: 'deepseek', reason: 'http-status', status: 401 }];

function loadHandler(providerFailures) {
  jest.resetModules();
  jest.doMock('../../src/utils/model-catalog', () => ({
    getCatalogInfo: jest.fn(async () => ({
      models: CATALOG, fetchedAt: 1718000000000, providerFailures,
    })),
    refreshCatalog: jest.fn(async () => CATALOG),
    catalogPath: () => 'C:/fake/model-catalog.json',
  }));
  jest.doMock('../../src/utils/alias-audit', () => ({
    collectAliasSources: () => [],
    findStaleAliases: () => [],
    findDriftedStoredAliases: () => [],
    suggestReplacements: () => [],
  }));
  jest.doMock('../../src/utils/gateway-route-audit', () => ({ auditGatewayRoutes: () => [] }));
  return require('../../src/sidecar/models');
}

function captureStdout(fn) {
  const writes = [];
  const orig = process.stdout.write;
  process.stdout.write = (s) => { writes.push(String(s)); return true; };
  return Promise.resolve().then(fn).finally(() => { process.stdout.write = orig; })
    .then(code => ({ code, out: writes.join('') }));
}

describe('amicus models: provider fetch failures (#209)', () => {
  it('--check names the provider whose fetch was rejected, and its status', async () => {
    const { handleModels } = loadHandler(FAILURES);
    const { out } = await captureStdout(() => handleModels({ _: ['models'], check: true }));
    expect(out).toContain('deepseek');
    expect(out).toContain('401');
  });

  it('--check says nothing about failures when every provider served', async () => {
    const { handleModels } = loadHandler([]);
    const { out } = await captureStdout(() => handleModels({ _: ['models'], check: true }));
    expect(out).not.toMatch(/could not be fetched|fetch failed/i);
  });

  it('--check --json carries the failures in the document', async () => {
    const { handleModels } = loadHandler(FAILURES);
    const { out } = await captureStdout(() => handleModels({ _: ['models'], check: true, json: true }));
    expect(JSON.parse(out).providerFailures).toEqual(FAILURES);
  });
});
