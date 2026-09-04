/**
 * Tests for per-provider fetch failure reporting (issue #209).
 *
 * `fetchAllModels` returns a flat row array, so a provider whose fetch was
 * REJECTED (401) is indistinguishable from one that legitimately served zero
 * models. `fetchAllModelsDetailed` adds the missing channel.
 */

const https = require('https');

jest.mock('https');

// Same sandbox as tests/model-fetcher.test.js: fetchAllModels* reads the
// machine's real local-provider config, which would otherwise add rows on a
// dev box that happens to run one.
jest.mock('../src/utils/local-providers', () => ({
  ...jest.requireActual('../src/utils/local-providers'),
  getLocalProviders: () => ({})
}));

const { fetchAllModelsDetailed } = require('../src/utils/model-fetcher');

describe('model-fetcher: per-provider failure reporting', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  function mockHttpsGet(statusCode, body) {
    const mockResponse = {
      statusCode,
      setEncoding: jest.fn(),
      on: jest.fn((event, cb) => {
        if (event === 'data') { cb(typeof body === 'string' ? body : JSON.stringify(body)); }
        if (event === 'end') { cb(); }
        return mockResponse;
      })
    };
    https.get.mockImplementation((_url, _opts, cb) => {
      cb(mockResponse);
      return { on: jest.fn(), destroy: jest.fn() };
    });
  }

  it('reports a keyed provider whose fetch was rejected, with its status code', async () => {
    mockHttpsGet(401, {});

    const { failures } = await fetchAllModelsDetailed({ deepseek: 'sk-bad' });

    const deepseek = failures.find(f => f.provider === 'deepseek');
    expect(deepseek).toBeDefined();
    expect(deepseek.reason).toBe('http-status');
    expect(deepseek.status).toBe(401);
  });

  it('reports a network error as a failure, with the error detail', async () => {
    https.get.mockImplementation(() => {
      const req = {
        on: jest.fn((event, cb) => {
          if (event === 'error') { setImmediate(() => cb(new Error('ECONNREFUSED'))); }
          return req;
        }),
        destroy: jest.fn()
      };
      return req;
    });

    const { failures } = await fetchAllModelsDetailed({ deepseek: 'sk-x' });

    const deepseek = failures.find(f => f.provider === 'deepseek');
    expect(deepseek).toBeDefined();
    expect(deepseek.reason).toBe('network-error');
    expect(deepseek.detail).toContain('ECONNREFUSED');
  });

  it('reports no failure for a provider that served rows', async () => {
    mockHttpsGet(200, { data: [{ id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' }] });

    const { rows, failures } = await fetchAllModelsDetailed({ deepseek: 'sk-good' });

    expect(failures.find(f => f.provider === 'deepseek')).toBeUndefined();
    expect(rows.some(m => m.id.startsWith('deepseek/'))).toBe(true);
  });

  it('does not report anthropic as failed when it falls back to the keyless floor', async () => {
    mockHttpsGet(200, { data: [] });

    const { failures } = await fetchAllModelsDetailed({});

    expect(failures.find(f => f.provider === 'anthropic')).toBeUndefined();
  });
});
