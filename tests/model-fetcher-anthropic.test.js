const path = require('path');

// Load a fresh copy so we can stub the https layer per-test.
function loadFetcher(httpsStub) {
  jest.resetModules();
  jest.doMock('https', () => httpsStub);
  return require('../src/utils/model-fetcher');
}

function fakeHttps({ statusCode, body }) {
  return {
    get(_url, _opts, cb) {
      const res = { statusCode, on(evt, h) { if (evt === 'data' && body) h(body); if (evt === 'end') h(); } };
      cb(res);
      return { on() {}, destroy() {} };
    },
  };
}

afterEach(() => { jest.dontMock('https'); jest.resetModules(); });

test('anthropic with a key returns live rows namespaced anthropic/', async () => {
  const body = JSON.stringify({ data: [{ id: 'claude-opus-4-8', display_name: 'Claude Opus 4.8' }] });
  const f = loadFetcher(fakeHttps({ statusCode: 200, body }));
  const rows = await f.fetchModelsFromProvider('anthropic', 'sk-ant-test');
  expect(rows).toEqual([{ id: 'anthropic/claude-opus-4-8', name: 'Claude Opus 4.8', contextLength: null, pricing: null }]);
});

test('anthropic falls back to the hardcoded floor when the live fetch fails', async () => {
  const f = loadFetcher(fakeHttps({ statusCode: 500, body: '' }));
  const rows = await f.fetchModelsFromProvider('anthropic', 'sk-ant-test');
  expect(rows).toBe(f.ANTHROPIC_MODELS);
});

test('anthropic with no key returns the floor without a network call', async () => {
  let called = false;
  const f = loadFetcher({ get() { called = true; return { on() {}, destroy() {} }; } });
  const rows = await f.fetchModelsFromProvider('anthropic', '');
  expect(rows).toBe(f.ANTHROPIC_MODELS);
  expect(called).toBe(false);
});
