'use strict';

const https = require('https');
jest.mock('https');   // M5: providersToFetch always adds openrouter+anthropic — never let it hit the network

// Port of tests/model-fetcher.test.js:38-49 — resolve every request with an empty model list.
// NOTE: the real call site (fetchViaConfig) invokes https.get(url, { headers }, callback) —
// three positional args — so the mock implementation must accept three params. A 2-param
// mock here would silently bind `cb` to the options object instead of the callback.
function mockHttpsGet(payload = { data: [] }) {
  https.get.mockImplementation((_url, _opts, cb) => {
    const res = { statusCode: 200, setEncoding() {}, on(ev, fn) {
      if (ev === 'data') { fn(JSON.stringify(payload)); }
      if (ev === 'end') { fn(); }
      return res;
    } };
    cb(res);
    return { on() { return this; }, destroy() {}, setTimeout() {} };
  });
}

describe('fetchAllModels: local rows', () => {
  const origToken = process.env.OLLAMA_API_KEY;
  afterEach(() => {
    jest.resetModules();
    if (origToken === undefined) { delete process.env.OLLAMA_API_KEY; }
    else { process.env.OLLAMA_API_KEY = origToken; }
  });

  test('appends local rows for each configured provider (bearer resolved from apiKeyEnv)', async () => {
    // NOTE: deliberately no jest.resetModules() here (unlike the sibling local-* test
    // files). `https` is captured via a top-level `const https = require('https')`
    // above (required for the hoisted jest.mock('https') to apply to it); resetModules()
    // mid-test would make src/utils/model-fetcher.js's OWN internal require('https')
    // resolve to a brand-new, unconfigured automock instance on its next require,
    // orphaning this mockHttpsGet()'s .mockImplementation and leaving https.get()
    // returning undefined (verified: reproduces as "Cannot read properties of
    // undefined (reading 'on')" at model-fetcher.js's req.on('error', ...)). This file
    // has exactly one test and nothing is required before this point, so no reset is
    // needed for the doMock calls below to apply to the first require of model-fetcher.
    mockHttpsGet();
    process.env.OLLAMA_API_KEY = 'test-token';
    jest.doMock('../src/utils/local-providers', () => ({
      getLocalProviders: () => ({
        ollama: { id: 'ollama', baseURL: 'http://127.0.0.1:11434/v1', flavor: 'ollama',
          apiKeyEnv: 'OLLAMA_API_KEY', pricing: { prompt: 0, completion: 0 } },
      }),
    }));
    const listLocalModels = jest.fn().mockResolvedValue([
      { id: 'ollama/llama3.3', name: 'llama3.3', contextLength: null, pricing: { prompt: 0, completion: 0 }, authoritative: true, local: true },
    ]);
    jest.doMock('../src/utils/local-probe', () => ({ listLocalModels }));
    const { fetchAllModels } = require('../src/utils/model-fetcher');
    const rows = await fetchAllModels({}); // no direct keys → openrouter/anthropic floors (mocked) + local
    const local = rows.filter((r) => r.local === true);
    expect(local).toHaveLength(1);
    expect(local[0].id).toBe('ollama/llama3.3');
    // M9: pin the security-sensitive bearer ternary — inverting or deleting it must fail here.
    expect(listLocalModels.mock.calls[0][1].bearer).toBe('test-token');
    expect(listLocalModels.mock.calls[0][1].timeoutMs).toBe(5000);
  });
});
