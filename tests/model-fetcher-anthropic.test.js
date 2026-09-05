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
      const res = { statusCode, setEncoding() {}, on(evt, h) { if (evt === 'data' && body) h(body); if (evt === 'end') h(); } };
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
  // Floor-fallback rows are tagged authoritative:false (#61 4.3) so a classification
  // miss returns 'unknown', not 'invalid'; mapped to new objects, not the same
  // reference, so the shared ANTHROPIC_MODELS array is never mutated in place.
  expect(rows).toEqual(f.ANTHROPIC_MODELS.map(r => ({ ...r, authoritative: false })));
  expect(rows).not.toBe(f.ANTHROPIC_MODELS);
});

test('anthropic with no key returns the floor without a network call', async () => {
  let called = false;
  const f = loadFetcher({ get() { called = true; return { on() {}, destroy() {} }; } });
  const rows = await f.fetchModelsFromProvider('anthropic', '');
  expect(rows).toEqual(f.ANTHROPIC_MODELS.map(r => ({ ...r, authoritative: false })));
  expect(rows).not.toBe(f.ANTHROPIC_MODELS);
  expect(called).toBe(false);
});

// Task 4 (#gwid): the hardcoded floor is a point-in-time snapshot, not a
// confirmed roster (see #61 Task 4.3 authoritative:false tagging above) --
// but a stale floor still misleads offline/keyless users, so pin the exact
// current-family ids here rather than letting this suite pass tautologically
// against whatever ANTHROPIC_MODELS happens to contain.
// (Subsumes the old fable floor-containment check, deleted in the v4.7 PR4 sweep:
// an exact toEqual IS containment. The 2026-08-05 route-inversion history lives in git.)
test('ANTHROPIC_MODELS floor is the current Anthropic family, not a stale snapshot', async () => {
  const f = loadFetcher(fakeHttps({ statusCode: 200, body: '{}' }));
  expect(f.ANTHROPIC_MODELS.map(m => m.id)).toEqual([
    'anthropic/claude-opus-5',
    'anthropic/claude-opus-4-8',
    'anthropic/claude-sonnet-5',
    'anthropic/claude-fable-5',
    'anthropic/claude-haiku-4-5',
    // The dated snapshot Anthropic's /v1/models actually lists, and the id
    // curated-models.js authors as `haiku`'s direct route. Without it the
    // floor reports the shipped `haiku` default stale for every keyless or
    // OpenRouter-only user (see tests/utils/alias-audit-shipped-defaults).
    'anthropic/claude-haiku-4-5-20251001',
    'anthropic/claude-sonnet-4-6',
  ]);
  // Stale flagships from the prior family must be gone.
  const ids = f.ANTHROPIC_MODELS.map(m => m.id);
  expect(ids).not.toContain('anthropic/claude-opus-4-6');
  expect(ids).not.toContain('anthropic/claude-sonnet-4-5');
  expect(ids).not.toContain('anthropic/claude-3-5-haiku');
});
