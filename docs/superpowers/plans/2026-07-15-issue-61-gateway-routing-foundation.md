# Direct-First Gateway Routing — Foundation Plan (Issue #61, Plan 1 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the routing foundation for #61 — a single provider-capability registry, a normalized descriptor + route-result grammar, tri-state catalog classification, and a pure `resolveRoute()` router — as new, fully-tested modules with **zero behavior change** to existing launch paths.

**Architecture:** All new code is additive and pure. Nothing in this plan wires the router into a real launch path (that is Plan 2 — Integration). The three existing provider registries become derived views of one source. The router is a pure function over injected `{policy, keys, catalogInfo, providers}`, so its entire decision matrix is unit-testable without spawning OpenCode or hitting the network.

**Tech Stack:** Node.js (CommonJS `require`), Jest 29, ESLint 8. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-15-issue-61-direct-first-gateway-routing-design.md`

## Global Constraints

- **Node ≥22.12** (package.json `engines`); CommonJS modules only.
- **File size ≤300 lines** — enforced by `npm run check:sizes`. Every new/modified file must stay under it.
- **Zero behavior change in this plan.** No existing launch path may route differently after Foundation merges. The router exists and is tested but is not yet called by `start`/`fanout`/`continue`/`resume`. Existing test suites must stay green.
- **Preserve the "empty catalog never blocks a launch" contract** (model-catalog.js degrades to stale/`[]`; callers treat empty as "cannot validate"). Tri-state classification must map empty/failed → `unknown`, never `invalid`.
- **One provider source of truth.** After Task 1, `PROVIDER_ENV_MAP`, `PROVIDER_KEY_MAP`, `KNOWN_PROVIDERS`, and `PROVIDER_FAMILY_NAMES` are all derived from `provider-registry.js`; the literal duplicates are removed.
- **Registry faithfulness:** the derived maps must deep-equal the current literals exactly (same keys, same envVar strings, same display names — note `PROVIDER_KEY_MAP.google.name` is `'Google Gemini'` while `PROVIDER_FAMILY_NAMES.google` is `'Google'`; both must be preserved).
- No secrets in code or tests (`npm run check:secrets`). Commit after each task.

---

## File Structure

- **Create** `src/utils/provider-registry.js` — the single provider-capability source + derived compat exports (Task 1).
- **Modify** `src/utils/api-key-store.js`, `src/utils/validators.js`, `src/utils/auth-json.js`, `src/utils/model-fetcher.js` — re-export the maps from the registry instead of defining literals (Task 1).
- **Create** `src/utils/model-descriptor.js` — descriptor grammar + `RouteResult` factories + gateway-mode constants (Task 2).
- **Modify** `src/utils/model-fetcher.js` — add the live Anthropic fetcher, hardcoded list as offline fallback (Task 3).
- **Create** `src/utils/model-classification.js` — pure tri-state `classifyModel()` (Task 4).
- **Create** `src/utils/gateway-router.js` — pure `resolveRoute()` (Task 5).
- **Create** test files alongside each under `tests/`.

---

### Task 1: Provider-capability registry (Phase 0)

**Files:**
- Create: `src/utils/provider-registry.js`
- Test: `tests/provider-registry.test.js`
- Modify: `src/utils/api-key-store.js` (re-export `PROVIDER_ENV_MAP` from registry)
- Modify: `src/utils/validators.js` (re-export `PROVIDER_KEY_MAP` from registry)
- Modify: `src/utils/auth-json.js` (re-export `KNOWN_PROVIDERS` from registry)
- Modify: `src/utils/model-fetcher.js` (re-export `PROVIDER_FAMILY_NAMES` from registry)

**Interfaces:**
- Produces:
  - `PROVIDERS` — array of `{ id, envVar, keyDisplayName, familyName, direct, gateway, hasLiveFetch, authJsonKey }`.
  - `getProvider(id) -> descriptor | undefined`
  - `isDirectProvider(id) -> boolean` (true for direct vendors; **false for `openrouter`**)
  - `listDirectProviders() -> string[]` (the correct "direct vendors" list, excludes the gateway)
  - Derived compat maps: `PROVIDER_ENV_MAP`, `PROVIDER_KEY_MAP`, `KNOWN_PROVIDERS`, `PROVIDER_FAMILY_NAMES`.
- Consumes: nothing (leaf module — avoids circular deps).

- [ ] **Step 1: Write the failing test**

`tests/provider-registry.test.js`:
```js
const reg = require('../src/utils/provider-registry');

describe('provider-registry', () => {
  test('PROVIDERS covers exactly the five known providers', () => {
    expect(reg.PROVIDERS.map(p => p.id).sort())
      .toEqual(['anthropic', 'deepseek', 'google', 'openai', 'openrouter']);
  });

  test('openrouter is the gateway, not a direct provider', () => {
    expect(reg.getProvider('openrouter').gateway).toBe(true);
    expect(reg.getProvider('openrouter').direct).toBe(false);
    expect(reg.isDirectProvider('openrouter')).toBe(false);
    expect(reg.listDirectProviders().sort())
      .toEqual(['anthropic', 'deepseek', 'google', 'openai']);
  });

  test('derived PROVIDER_ENV_MAP matches the historical literal exactly', () => {
    expect(reg.PROVIDER_ENV_MAP).toEqual({
      openrouter: 'OPENROUTER_API_KEY',
      google: 'GOOGLE_GENERATIVE_AI_API_KEY',
      openai: 'OPENAI_API_KEY',
      anthropic: 'ANTHROPIC_API_KEY',
      deepseek: 'DEEPSEEK_API_KEY',
    });
  });

  test('derived PROVIDER_KEY_MAP preserves the distinct key display names', () => {
    expect(reg.PROVIDER_KEY_MAP.google).toEqual({ key: 'GOOGLE_GENERATIVE_AI_API_KEY', name: 'Google Gemini' });
    expect(reg.PROVIDER_KEY_MAP.openrouter).toEqual({ key: 'OPENROUTER_API_KEY', name: 'OpenRouter' });
  });

  test('derived PROVIDER_FAMILY_NAMES preserves grouping names (Google, not Google Gemini)', () => {
    expect(reg.PROVIDER_FAMILY_NAMES).toEqual({
      openrouter: 'OpenRouter', google: 'Google', openai: 'OpenAI',
      anthropic: 'Anthropic', deepseek: 'DeepSeek',
    });
  });

  test('KNOWN_PROVIDERS is the id list', () => {
    expect(reg.KNOWN_PROVIDERS.sort())
      .toEqual(['anthropic', 'deepseek', 'google', 'openai', 'openrouter']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/provider-registry.test.js`
Expected: FAIL — `Cannot find module '../src/utils/provider-registry'`.

- [ ] **Step 3: Write the registry**

`src/utils/provider-registry.js`:
```js
/**
 * Provider-capability registry — the single source of truth for provider
 * identity, credentials, direct-vs-gateway role, and display names.
 * The historical maps (PROVIDER_ENV_MAP, PROVIDER_KEY_MAP, KNOWN_PROVIDERS,
 * PROVIDER_FAMILY_NAMES) are DERIVED from PROVIDERS below so they can never
 * drift apart again. Leaf module: requires nothing internal (no circular deps).
 */
'use strict';

/**
 * @typedef {Object} ProviderDescriptor
 * @property {string} id            provider id (namespace)
 * @property {string} envVar        env var holding the key
 * @property {string} keyDisplayName human name used in missing-key errors
 * @property {string} familyName    short name used for optgroup grouping
 * @property {boolean} direct        can be a DIRECT route target (false for the gateway)
 * @property {boolean} gateway       is the OpenRouter gateway itself
 * @property {boolean} hasLiveFetch  has a live GET /models endpoint
 * @property {string} authJsonKey    key used in OpenCode auth.json
 */

/** @type {ProviderDescriptor[]} */
const PROVIDERS = [
  { id: 'openrouter', envVar: 'OPENROUTER_API_KEY',            keyDisplayName: 'OpenRouter',    familyName: 'OpenRouter', direct: false, gateway: true,  hasLiveFetch: true,  authJsonKey: 'openrouter' },
  { id: 'google',     envVar: 'GOOGLE_GENERATIVE_AI_API_KEY', keyDisplayName: 'Google Gemini', familyName: 'Google',     direct: true,  gateway: false, hasLiveFetch: true,  authJsonKey: 'google' },
  { id: 'openai',     envVar: 'OPENAI_API_KEY',               keyDisplayName: 'OpenAI',        familyName: 'OpenAI',     direct: true,  gateway: false, hasLiveFetch: true,  authJsonKey: 'openai' },
  { id: 'anthropic',  envVar: 'ANTHROPIC_API_KEY',            keyDisplayName: 'Anthropic',     familyName: 'Anthropic',  direct: true,  gateway: false, hasLiveFetch: true,  authJsonKey: 'anthropic' },
  { id: 'deepseek',   envVar: 'DEEPSEEK_API_KEY',             keyDisplayName: 'DeepSeek',      familyName: 'DeepSeek',   direct: true,  gateway: false, hasLiveFetch: true,  authJsonKey: 'deepseek' },
];

const _byId = new Map(PROVIDERS.map(p => [p.id, p]));

/** @param {string} id @returns {ProviderDescriptor|undefined} */
function getProvider(id) { return _byId.get(id); }

/** @param {string} id @returns {boolean} true only for direct-route vendors (never the gateway) */
function isDirectProvider(id) { const p = _byId.get(id); return !!p && p.direct; }

/** @returns {string[]} ids of direct-route vendors (excludes openrouter) */
function listDirectProviders() { return PROVIDERS.filter(p => p.direct).map(p => p.id); }

// --- Derived compatibility maps (do not hand-edit; edit PROVIDERS above) ---
const PROVIDER_ENV_MAP = Object.fromEntries(PROVIDERS.map(p => [p.id, p.envVar]));
const PROVIDER_KEY_MAP = Object.fromEntries(PROVIDERS.map(p => [p.id, { key: p.envVar, name: p.keyDisplayName }]));
const KNOWN_PROVIDERS = PROVIDERS.map(p => p.id);
const PROVIDER_FAMILY_NAMES = Object.fromEntries(PROVIDERS.map(p => [p.id, p.familyName]));

module.exports = {
  PROVIDERS,
  getProvider,
  isDirectProvider,
  listDirectProviders,
  PROVIDER_ENV_MAP,
  PROVIDER_KEY_MAP,
  KNOWN_PROVIDERS,
  PROVIDER_FAMILY_NAMES,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/provider-registry.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Switch existing modules to the derived maps**

In `src/utils/api-key-store.js` — replace the literal `PROVIDER_ENV_MAP` (lines 9–16) with an import, keep the export name:
```js
const { PROVIDER_ENV_MAP } = require('./provider-registry');
```
(Delete the literal object; leave `LEGACY_KEY_NAMES` as-is; the `module.exports` block already re-exports `PROVIDER_ENV_MAP`.)

In `src/utils/validators.js` — replace the literal `PROVIDER_KEY_MAP` (lines 19–28) with:
```js
const { PROVIDER_KEY_MAP } = require('./provider-registry');
```

In `src/utils/auth-json.js` — replace the literal `KNOWN_PROVIDERS` (line 53) with:
```js
const { KNOWN_PROVIDERS } = require('./provider-registry');
```

In `src/utils/model-fetcher.js` — replace the literal `PROVIDER_FAMILY_NAMES` (lines 19–25) with:
```js
const { PROVIDER_FAMILY_NAMES } = require('./provider-registry');
```

- [ ] **Step 6: Run the full suite to confirm zero behavior change**

Run: `npx jest` and `npm run check:sizes`
Expected: all previously-green suites still pass; provider-registry.js under 300 lines. If any test that hardcoded these maps fails, it should be because it asserted the literal — update it to import from the registry (do not weaken the assertion).

- [ ] **Step 7: Commit**
```bash
git add src/utils/provider-registry.js tests/provider-registry.test.js \
  src/utils/api-key-store.js src/utils/validators.js src/utils/auth-json.js src/utils/model-fetcher.js
git commit -m "feat(#61): single provider-capability registry; derive the three provider maps"
```

---

### Task 2: Descriptor grammar + RouteResult contracts (Phase 1)

**Files:**
- Create: `src/utils/model-descriptor.js`
- Test: `tests/model-descriptor.test.js`

**Interfaces:**
- Consumes: `listDirectProviders` is NOT needed here (grammar is provider-agnostic).
- Produces:
  - `GATEWAY_MODES = ['auto', 'direct', 'openrouter']`
  - `parseDescriptor(raw, { aliases }) -> Descriptor`
    `Descriptor = { raw, kind: 'alias'|'canonical'|'openrouter-literal'|'invalid', vendor?, model?, isExplicitOpenRouter, error? }`
  - RouteResult factories:
    - `resolved({ model, gateway, executableId, provenance, notice }) -> { kind:'resolved', ... }`
    - `selectionRequired({ requested, suggestions }) -> { kind:'selection_required', ... }`
    - `routeError({ field, requested, reason, preferredGateway, suggestions }) -> { kind:'error', type:'model_route_error', ... }`

- [ ] **Step 1: Write the failing test**

`tests/model-descriptor.test.js`:
```js
const d = require('../src/utils/model-descriptor');
const aliases = { gpt: 'openrouter/openai/gpt-5.5', gemini: 'openrouter/google/gemini-3.5-flash' };

describe('parseDescriptor', () => {
  test('explicit openrouter/ literal', () => {
    expect(d.parseDescriptor('openrouter/openai/gpt-5.5', { aliases })).toMatchObject({
      kind: 'openrouter-literal', vendor: 'openai', model: 'gpt-5.5', isExplicitOpenRouter: true,
    });
  });
  test('bare canonical provider/model', () => {
    expect(d.parseDescriptor('openai/gpt-5.5', { aliases })).toMatchObject({
      kind: 'canonical', vendor: 'openai', model: 'gpt-5.5', isExplicitOpenRouter: false,
    });
  });
  test('multi-segment canonical keeps the full model tail', () => {
    expect(d.parseDescriptor('google/gemini-3.5-flash', { aliases })).toMatchObject({
      kind: 'canonical', vendor: 'google', model: 'gemini-3.5-flash',
    });
  });
  test('known no-slash alias', () => {
    expect(d.parseDescriptor('gpt', { aliases })).toMatchObject({ kind: 'alias', raw: 'gpt' });
  });
  test('unknown no-slash token is invalid (was a silent openrouter default)', () => {
    const r = d.parseDescriptor('grok4', { aliases });
    expect(r.kind).toBe('invalid');
    expect(r.error).toMatch(/unknown model/i);
  });
  test('empty / whitespace token is invalid', () => {
    expect(d.parseDescriptor('   ', { aliases }).kind).toBe('invalid');
  });
});

describe('RouteResult factories', () => {
  test('resolved', () => {
    expect(d.resolved({ model: 'openai/gpt-5.5', gateway: 'direct', executableId: 'openai/gpt-5.5', provenance: { source: 'cli' } }))
      .toMatchObject({ kind: 'resolved', gateway: 'direct', executableId: 'openai/gpt-5.5' });
  });
  test('routeError carries the machine-readable shape', () => {
    expect(d.routeError({ field: 'model', requested: 'x-ai/grok', reason: 'no_direct_integration', preferredGateway: 'direct', suggestions: [] }))
      .toEqual({ kind: 'error', type: 'model_route_error', field: 'model', requested: 'x-ai/grok', reason: 'no_direct_integration', preferredGateway: 'direct', suggestions: [] });
  });
  test('selectionRequired', () => {
    expect(d.selectionRequired({ requested: 'anthropic/claude-x', suggestions: [{ model: 'x', gateway: 'openrouter', note: 'via OR' }] }))
      .toMatchObject({ kind: 'selection_required', requested: 'anthropic/claude-x' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/model-descriptor.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the module**

`src/utils/model-descriptor.js`:
```js
/**
 * Model-descriptor grammar + RouteResult factories (#61).
 * Pure string classification — no I/O, no provider lookups. The resolver
 * (gateway-router.js) consumes Descriptors and returns RouteResults.
 */
'use strict';

const GATEWAY_MODES = ['auto', 'direct', 'openrouter'];
const OR_PREFIX = 'openrouter/';

/**
 * Classify a raw model string into a normalized descriptor.
 * Grammar:
 *   - `openrouter/<vendor>/<model>`  -> openrouter-literal (explicit force-OR)
 *   - `<vendor>/<model...>`          -> canonical (policy-routed)
 *   - known no-slash alias            -> alias (resolution deferred to caller)
 *   - anything else                   -> invalid (incl. unknown no-slash token)
 * @param {string} raw
 * @param {{aliases: Object<string,string>}} ctx
 * @returns {{raw:string, kind:string, vendor?:string, model?:string, isExplicitOpenRouter:boolean, error?:string}}
 */
function parseDescriptor(raw, ctx = {}) {
  const aliases = ctx.aliases || {};
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (!trimmed) {
    return { raw, kind: 'invalid', isExplicitOpenRouter: false, error: 'Empty model identifier' };
  }
  if (trimmed.startsWith(OR_PREFIX)) {
    const rest = trimmed.slice(OR_PREFIX.length);
    const parts = rest.split('/');
    if (parts.length < 2 || !parts[0] || !parts.slice(1).join('/')) {
      return { raw: trimmed, kind: 'invalid', isExplicitOpenRouter: true,
        error: `Malformed OpenRouter model id '${trimmed}' (expected openrouter/vendor/model)` };
    }
    return { raw: trimmed, kind: 'openrouter-literal', vendor: parts[0],
      model: parts.slice(1).join('/'), isExplicitOpenRouter: true };
  }
  if (trimmed.includes('/')) {
    const parts = trimmed.split('/');
    if (parts.length < 2 || !parts[0] || !parts.slice(1).join('/')) {
      return { raw: trimmed, kind: 'invalid', isExplicitOpenRouter: false,
        error: `Malformed model id '${trimmed}' (expected vendor/model)` };
    }
    return { raw: trimmed, kind: 'canonical', vendor: parts[0],
      model: parts.slice(1).join('/'), isExplicitOpenRouter: false };
  }
  if (Object.prototype.hasOwnProperty.call(aliases, trimmed)) {
    return { raw: trimmed, kind: 'alias', isExplicitOpenRouter: false };
  }
  return { raw: trimmed, kind: 'invalid', isExplicitOpenRouter: false,
    error: `Unknown model alias '${trimmed}'. Run 'amicus setup' to configure aliases, or use a vendor/model id.` };
}

/** @returns {{kind:'resolved', model:string, gateway:string, executableId:string, provenance:object, notice?:string}} */
function resolved({ model, gateway, executableId, provenance, notice }) {
  const out = { kind: 'resolved', model, gateway, executableId, provenance: provenance || {} };
  if (notice) { out.notice = notice; }
  return out;
}

/** @returns {{kind:'selection_required', requested:string, suggestions:Array}} */
function selectionRequired({ requested, suggestions }) {
  return { kind: 'selection_required', requested, suggestions: suggestions || [] };
}

/** @returns {{kind:'error', type:'model_route_error', ...}} */
function routeError({ field, requested, reason, preferredGateway, suggestions }) {
  return { kind: 'error', type: 'model_route_error', field: field || 'model',
    requested, reason, preferredGateway, suggestions: suggestions || [] };
}

module.exports = { GATEWAY_MODES, parseDescriptor, resolved, selectionRequired, routeError };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/model-descriptor.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/utils/model-descriptor.js tests/model-descriptor.test.js
git commit -m "feat(#61): normalized descriptor grammar + RouteResult factories"
```

---

### Task 3: Live Anthropic model fetcher (Phase 2a)

**Files:**
- Modify: `src/utils/model-fetcher.js` (add anthropic to `PROVIDER_FETCH_CONFIG`; live-with-fallback in `fetchModelsFromProvider`)
- Test: `tests/model-fetcher-anthropic.test.js`

**Interfaces:**
- `fetchModelsFromProvider('anthropic', key)` now: with a key, attempts `GET https://api.anthropic.com/v1/models` (headers `x-api-key`, `anthropic-version: 2023-06-01`), normalizes `data[].id -> anthropic/<id>`, and **falls back to `ANTHROPIC_MODELS`** on any failure/empty; with no key, returns `ANTHROPIC_MODELS` (floor preserved — the key-conditional *drop* is deferred to Plan 2, keeping Foundation zero-regression).

> Implementation note: verify the Anthropic `/v1/models` response shape (`{ data: [{ id, display_name }] }`) against current Anthropic API docs during implementation; the normalize function below targets that documented shape.

- [ ] **Step 1: Write the failing test**

`tests/model-fetcher-anthropic.test.js`:
```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/model-fetcher-anthropic.test.js`
Expected: FAIL — live path not implemented (first test gets the hardcoded floor, not the live row).

- [ ] **Step 3: Implement**

In `src/utils/model-fetcher.js`, add an `anthropic` entry to `PROVIDER_FETCH_CONFIG`:
```js
  anthropic: {
    url: 'https://api.anthropic.com/v1/models',
    authHeader: (key) => ({ 'x-api-key': key, 'anthropic-version': '2023-06-01' }),
    normalize: (body) => {
      const data = JSON.parse(body);
      return (data.data || []).map(m => ({
        id: `anthropic/${m.id}`,
        name: m.display_name || m.id,
        contextLength: null,
        pricing: null,
      }));
    },
  },
```

Replace the anthropic short-circuit at the top of `fetchModelsFromProvider` (lines 97–99):
```js
  if (provider === 'anthropic') {
    // No key -> hardcoded floor, no network. With a key -> try live, fall back to floor.
    if (!key) { return Promise.resolve(ANTHROPIC_MODELS); }
    return fetchViaConfig('anthropic', key).then(rows => (rows.length > 0 ? rows : ANTHROPIC_MODELS));
  }
```

Extract the existing Promise body (lines 101–137) into a helper `fetchViaConfig(provider, key)` that returns the `Promise<rows>` (returns `[]` on any non-200/timeout/parse error, exactly as today), and have the non-anthropic branch call it too. Keep `FETCH_TIMEOUT_MS` and all current error handling identical.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/model-fetcher-anthropic.test.js && npx jest tests/model-fetcher`
Expected: PASS, and any existing model-fetcher tests still green.

- [ ] **Step 5: Commit**
```bash
git add src/utils/model-fetcher.js tests/model-fetcher-anthropic.test.js
git commit -m "feat(#61): live Anthropic model fetcher with hardcoded-floor fallback"
```

---

### Task 4: Tri-state catalog classification (Phase 2b)

**Files:**
- Create: `src/utils/model-classification.js`
- Test: `tests/model-classification.test.js`

**Interfaces:**
- Consumes: a catalog-info object of the shape returned by `model-catalog.getCatalogInfo()` — `{ models: Array<{id}>, fetchedAt, lastRefreshError }` — passed in (pure; no I/O).
- Produces: `classifyModel(id, gateway, catalogInfo) -> 'valid' | 'invalid' | 'unknown'`
  - `gateway` is `'direct'` or `'openrouter'`; it selects which namespace the id is matched against (`openrouter/...` rows vs direct `<vendor>/...` rows).
  - **`unknown`** when: the whole catalog is empty, OR the relevant namespace has zero rows (proxy for "not successfully fetched"), OR `lastRefreshError` is set and the namespace is empty. Never blocks.
  - **`valid`** when the exact id string is present in the relevant namespace.
  - **`invalid`** only when the namespace was populated (≥1 row) and the exact id is absent.

- [ ] **Step 1: Write the failing test**

`tests/model-classification.test.js`:
```js
const { classifyModel } = require('../src/utils/model-classification');

const catalog = (models, extra = {}) => ({ models, fetchedAt: 1, lastRefreshError: null, ...extra });

describe('classifyModel', () => {
  test('empty catalog -> unknown (never blocks)', () => {
    expect(classifyModel('openai/gpt-5.5', 'direct', catalog([]))).toBe('unknown');
  });

  test('present in direct namespace -> valid', () => {
    const c = catalog([{ id: 'openai/gpt-5.5' }, { id: 'openrouter/openai/gpt-5.5' }]);
    expect(classifyModel('openai/gpt-5.5', 'direct', c)).toBe('valid');
  });

  test('present in openrouter namespace -> valid', () => {
    const c = catalog([{ id: 'openrouter/openai/gpt-5.5' }]);
    expect(classifyModel('openrouter/openai/gpt-5.5', 'openrouter', c)).toBe('valid');
  });

  test('absent but namespace populated -> invalid', () => {
    const c = catalog([{ id: 'openai/gpt-5.5' }, { id: 'openai/gpt-4.1' }]);
    expect(classifyModel('openai/gpt-9', 'direct', c)).toBe('invalid');
  });

  test('namespace empty though catalog non-empty -> unknown', () => {
    // catalog has openrouter rows but no direct openai rows (openai key absent)
    const c = catalog([{ id: 'openrouter/openai/gpt-5.5' }]);
    expect(classifyModel('openai/gpt-5.5', 'direct', c)).toBe('unknown');
  });

  test('refresh failed + namespace empty -> unknown', () => {
    const c = catalog([], { lastRefreshError: 'network-error: all providers unreachable' });
    expect(classifyModel('openai/gpt-5.5', 'direct', c)).toBe('unknown');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/model-classification.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/utils/model-classification.js`:
```js
/**
 * Tri-state catalog classification (#61).
 * Turns the combined catalog + refresh outcome into valid|invalid|unknown for a
 * (model, gateway) pair. `unknown` NEVER rejects a route — it preserves the
 * existing "empty catalog cannot validate, never block a launch" contract.
 * Pure: the caller passes catalogInfo (from model-catalog.getCatalogInfo()).
 */
'use strict';

/**
 * @param {string} id       exact model id as the user gave it
 * @param {'direct'|'openrouter'} gateway  which namespace to match against
 * @param {{models: Array<{id:string}>, lastRefreshError?: string|null}} catalogInfo
 * @returns {'valid'|'invalid'|'unknown'}
 */
function classifyModel(id, gateway, catalogInfo) {
  const models = (catalogInfo && Array.isArray(catalogInfo.models)) ? catalogInfo.models : [];
  if (models.length === 0) { return 'unknown'; }

  const inOpenRouterNs = (mid) => typeof mid === 'string' && mid.startsWith('openrouter/');
  const namespaceRows = models.filter(m => m && typeof m.id === 'string' &&
    (gateway === 'openrouter' ? inOpenRouterNs(m.id) : !inOpenRouterNs(m.id)));

  // No rows for this namespace -> we cannot assert absence (e.g. provider key
  // absent so its rows were never fetched, or a partial refresh). Unknown.
  if (namespaceRows.length === 0) { return 'unknown'; }

  const present = namespaceRows.some(m => m.id === id);
  return present ? 'valid' : 'invalid';
}

module.exports = { classifyModel };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/model-classification.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**
```bash
git add src/utils/model-classification.js tests/model-classification.test.js
git commit -m "feat(#61): tri-state catalog classification (valid|invalid|unknown)"
```

---

### Task 5: Pure gateway router (Phase 3)

**Files:**
- Create: `src/utils/gateway-router.js`
- Test: `tests/gateway-router.test.js`

**Interfaces:**
- Consumes: `parseDescriptor`, `resolved`, `routeError`, `selectionRequired`, `GATEWAY_MODES` (Task 2); `classifyModel` (Task 4); `isDirectProvider`, `getProvider` (Task 1).
- Produces: `resolveRoute(request) -> RouteResult`

```
request = {
  descriptor,     // a parsed Descriptor (Task 2) OR a resolved canonical id string
  source,         // 'cli'|'mcp'|'alias'|'quick-pick'|'resume'|'continue'
  gatewayMode,    // 'auto'|'direct'|'openrouter'  (already merged from --gateway ?? routing.prefer ?? 'direct')
  allowSelection, // bool
  validateModel,  // bool; false => skip the catalog existence check only
  keys,           // { openrouter:bool, google:bool, openai:bool, anthropic:bool, deepseek:bool }
  catalogInfo,    // { models, lastRefreshError }
}
```

**Decision logic (the spec's corrected tree):**
1. `descriptor.kind === 'invalid'` → `routeError(reason:'invalid_descriptor')`.
2. **Explicit conflict:** `descriptor.isExplicitOpenRouter && gatewayMode === 'direct'` → `routeError(reason:'gateway_conflict')`.
3. **Explicit OR literal** (`isExplicitOpenRouter`): require OR key (`keys.openrouter`) else `routeError(reason:'no_openrouter_key')`; then catalog check on `openrouter` namespace (unless `!validateModel`); `unknown|valid` → resolve OR, `invalid` → error/selection.
4. **Gateway-only vendor** (`!isDirectProvider(vendor)`): if `gatewayMode === 'direct'` → `routeError(reason:'no_direct_integration')`; else require OR key → resolve OR (same catalog check).
5. **`gatewayMode === 'openrouter'`:** require OR key → OR route (catalog check).
6. **`gatewayMode === 'direct'`:** require direct key for vendor (`keys[vendor]`) else `routeError(reason:'no_direct_key')`; catalog check on direct namespace → resolve direct.
7. **`gatewayMode === 'auto'` (direct-first):** if `keys[vendor]` → try direct (catalog `valid|unknown` → direct; `invalid` → selection/error); else if `keys.openrouter` → OR; else `routeError(reason:'no_key_for_vendor')`.
- Catalog check helper: when `validateModel === false`, treat as `unknown` (skip). `unknown` → allow the route with a `notice` that availability is unverified. `invalid` → if `allowSelection` return `selectionRequired`, else `routeError(reason:'model_not_found')`.

- [ ] **Step 1: Write the failing test (core matrix)**

`tests/gateway-router.test.js`:
```js
const { resolveRoute } = require('../src/utils/gateway-router');
const { parseDescriptor } = require('../src/utils/model-descriptor');

const NO_KEYS = { openrouter: false, google: false, openai: false, anthropic: false, deepseek: false };
const cat = (ids) => ({ models: ids.map(id => ({ id })), lastRefreshError: null });
const EMPTY = { models: [], lastRefreshError: null };

function req(raw, over = {}) {
  const aliases = {};
  return {
    descriptor: parseDescriptor(raw, { aliases }),
    source: 'cli', gatewayMode: 'auto', allowSelection: false, validateModel: true,
    keys: { ...NO_KEYS }, catalogInfo: EMPTY, ...over,
  };
}

describe('resolveRoute — explicit intents', () => {
  test('openrouter/ literal + --gateway direct => conflict error', () => {
    const r = resolveRoute(req('openrouter/openai/gpt-5.5', { gatewayMode: 'direct', keys: { ...NO_KEYS, openrouter: true, openai: true } }));
    expect(r).toMatchObject({ kind: 'error', reason: 'gateway_conflict' });
  });

  test('openrouter/ literal with no OR key => no_openrouter_key', () => {
    const r = resolveRoute(req('openrouter/openai/gpt-5.5'));
    expect(r).toMatchObject({ kind: 'error', reason: 'no_openrouter_key' });
  });

  test('openrouter/ literal with OR key => resolved via openrouter (unknown catalog allowed)', () => {
    const r = resolveRoute(req('openrouter/openai/gpt-5.5', { keys: { ...NO_KEYS, openrouter: true } }));
    expect(r).toMatchObject({ kind: 'resolved', gateway: 'openrouter', executableId: 'openrouter/openai/gpt-5.5' });
  });
});

describe('resolveRoute — gateway-only vendors', () => {
  test('x-ai under --gateway direct => no_direct_integration', () => {
    const r = resolveRoute(req('x-ai/grok-4.3', { gatewayMode: 'direct', keys: { ...NO_KEYS, openrouter: true } }));
    expect(r).toMatchObject({ kind: 'error', reason: 'no_direct_integration' });
  });
  test('x-ai under auto with OR key => openrouter', () => {
    const r = resolveRoute(req('x-ai/grok-4.3', { keys: { ...NO_KEYS, openrouter: true } }));
    expect(r).toMatchObject({ kind: 'resolved', gateway: 'openrouter' });
  });
});

describe('resolveRoute — direct-first (auto)', () => {
  test('direct key present + model valid => direct', () => {
    const r = resolveRoute(req('openai/gpt-5.5', { keys: { ...NO_KEYS, openai: true }, catalogInfo: cat(['openai/gpt-5.5']) }));
    expect(r).toMatchObject({ kind: 'resolved', gateway: 'direct', executableId: 'openai/gpt-5.5' });
  });
  test('direct key present + catalog unknown => direct with unverified notice', () => {
    const r = resolveRoute(req('openai/gpt-5.5', { keys: { ...NO_KEYS, openai: true }, catalogInfo: EMPTY }));
    expect(r).toMatchObject({ kind: 'resolved', gateway: 'direct' });
    expect(r.notice).toMatch(/unverified|not.*validate/i);
  });
  test('no direct key, OR key present => openrouter fallback', () => {
    const r = resolveRoute(req('openai/gpt-5.5', { keys: { ...NO_KEYS, openrouter: true } }));
    expect(r).toMatchObject({ kind: 'resolved', gateway: 'openrouter' });
  });
  test('no keys at all => no_key_for_vendor', () => {
    const r = resolveRoute(req('openai/gpt-5.5'));
    expect(r).toMatchObject({ kind: 'error', reason: 'no_key_for_vendor' });
  });
  test('direct key present + model invalid + allowSelection => selection_required', () => {
    const r = resolveRoute(req('openai/gpt-9', { allowSelection: true, keys: { ...NO_KEYS, openai: true }, catalogInfo: cat(['openai/gpt-5.5']) }));
    expect(r).toMatchObject({ kind: 'selection_required' });
  });
  test('direct key present + model invalid + no selection => model_not_found', () => {
    const r = resolveRoute(req('openai/gpt-9', { keys: { ...NO_KEYS, openai: true }, catalogInfo: cat(['openai/gpt-5.5']) }));
    expect(r).toMatchObject({ kind: 'error', reason: 'model_not_found' });
  });
});

describe('resolveRoute — explicit modes', () => {
  test('--gateway openrouter with no OR key => no_openrouter_key', () => {
    const r = resolveRoute(req('openai/gpt-5.5', { gatewayMode: 'openrouter', keys: { ...NO_KEYS, openai: true } }));
    expect(r).toMatchObject({ kind: 'error', reason: 'no_openrouter_key' });
  });
  test('--gateway direct with no direct key => no_direct_key', () => {
    const r = resolveRoute(req('openai/gpt-5.5', { gatewayMode: 'direct', keys: { ...NO_KEYS, openrouter: true } }));
    expect(r).toMatchObject({ kind: 'error', reason: 'no_direct_key' });
  });
  test('validateModel:false skips the catalog check (invalid model still routes)', () => {
    const r = resolveRoute(req('openai/gpt-9', { validateModel: false, keys: { ...NO_KEYS, openai: true }, catalogInfo: cat(['openai/gpt-5.5']) }));
    expect(r).toMatchObject({ kind: 'resolved', gateway: 'direct' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/gateway-router.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the router**

`src/utils/gateway-router.js`:
```js
/**
 * Pure gateway router (#61). Decides direct vs OpenRouter for a request using
 * only injected state (keys, catalogInfo, gatewayMode) — no I/O. Returns a
 * RouteResult (resolved | selection_required | error). Wiring into launch paths
 * is Plan 2; this module is behavior-neutral until then.
 */
'use strict';

const { resolved, routeError, selectionRequired } = require('./model-descriptor');
const { classifyModel } = require('./model-classification');
const { isDirectProvider } = require('./provider-registry');

/** Build the executable id for a gateway. */
function executableFor(gateway, vendor, model) {
  return gateway === 'openrouter' ? `openrouter/${vendor}/${model}` : `${vendor}/${model}`;
}

/**
 * Catalog gate: returns { ok:true, notice? } to proceed, or { ok:false, result }
 * carrying a selection_required/error to return to the caller.
 */
function catalogGate({ id, gateway, vendor, model, req }) {
  if (req.validateModel === false) {
    return { ok: true, notice: 'Model availability not validated (--no-validate-model).' };
  }
  const verdict = classifyModel(id, gateway, req.catalogInfo);
  if (verdict === 'valid') { return { ok: true }; }
  if (verdict === 'unknown') {
    return { ok: true, notice: `Model '${id}' could not be verified against the ${gateway} catalog; attempting anyway.` };
  }
  // invalid
  if (req.allowSelection) {
    return { ok: false, result: selectionRequired({ requested: req.descriptor.raw, suggestions: [] }) };
  }
  return { ok: false, result: routeError({ requested: req.descriptor.raw, reason: 'model_not_found',
    preferredGateway: gateway, suggestions: [] }) };
}

/** Resolve to a concrete gateway after the catalog gate passes. */
function finish(gateway, vendor, model, req, extraNotice) {
  const id = executableFor(gateway, vendor, model);
  const gate = catalogGate({ id, gateway, vendor, model, req });
  if (!gate.ok) { return gate.result; }
  const notice = [extraNotice, gate.notice].filter(Boolean).join(' ') || undefined;
  return resolved({ model: id, gateway, executableId: id,
    provenance: { source: req.source, requested: req.descriptor.raw, gatewayMode: req.gatewayMode }, notice });
}

/**
 * @param {object} req see Task 5 Interfaces
 * @returns RouteResult
 */
function resolveRoute(req) {
  const d = req.descriptor;
  if (!d || d.kind === 'invalid') {
    return routeError({ requested: d ? d.raw : String(req && req.descriptor),
      reason: 'invalid_descriptor', preferredGateway: req.gatewayMode, suggestions: [] });
  }
  const vendor = d.vendor;
  const model = d.model;

  // 2. Explicit conflict: force-OR literal vs --gateway direct
  if (d.isExplicitOpenRouter && req.gatewayMode === 'direct') {
    return routeError({ requested: d.raw, reason: 'gateway_conflict', preferredGateway: 'direct', suggestions: [] });
  }
  // 3. Explicit OR literal
  if (d.isExplicitOpenRouter) {
    if (!req.keys.openrouter) {
      return routeError({ requested: d.raw, reason: 'no_openrouter_key', preferredGateway: 'openrouter', suggestions: [] });
    }
    return finish('openrouter', vendor, model, req);
  }
  // 4. Gateway-only vendor (no direct integration)
  if (!isDirectProvider(vendor)) {
    if (req.gatewayMode === 'direct') {
      return routeError({ requested: d.raw, reason: 'no_direct_integration', preferredGateway: 'direct', suggestions: [] });
    }
    if (!req.keys.openrouter) {
      return routeError({ requested: d.raw, reason: 'no_openrouter_key', preferredGateway: 'openrouter', suggestions: [] });
    }
    return finish('openrouter', vendor, model, req);
  }
  // 5. Explicit --gateway openrouter
  if (req.gatewayMode === 'openrouter') {
    if (!req.keys.openrouter) {
      return routeError({ requested: d.raw, reason: 'no_openrouter_key', preferredGateway: 'openrouter', suggestions: [] });
    }
    return finish('openrouter', vendor, model, req);
  }
  // 6. Explicit --gateway direct
  if (req.gatewayMode === 'direct') {
    if (!req.keys[vendor]) {
      return routeError({ requested: d.raw, reason: 'no_direct_key', preferredGateway: 'direct', suggestions: [] });
    }
    return finish('direct', vendor, model, req);
  }
  // 7. auto (direct-first)
  if (req.keys[vendor]) {
    return finish('direct', vendor, model, req);
  }
  if (req.keys.openrouter) {
    return finish('openrouter', vendor, model, req);
  }
  return routeError({ requested: d.raw, reason: 'no_key_for_vendor', preferredGateway: 'direct', suggestions: [] });
}

module.exports = { resolveRoute };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/gateway-router.test.js`
Expected: PASS (all matrix cases).

- [ ] **Step 5: Run the full suite + size/secret gates**

Run: `npx jest && npm run check:sizes && npm run check:secrets`
Expected: green; every new file < 300 lines.

- [ ] **Step 6: Commit**
```bash
git add src/utils/gateway-router.js tests/gateway-router.test.js
git commit -m "feat(#61): pure gateway router resolveRoute() with tri-state + explicit-conflict handling"
```

---

## What Foundation deliberately does NOT do (handed to Plan 2 — Integration)

- Wire `resolveRoute` into `start-helpers.js`, `cli.js`, MCP `input-validators.js`, `fanout.js`, `continue.js`, `resume.js`, `quick-picks.js`, `alias-audit.js`, `free-models.js`, `council-presets.js`.
- Make `buildProviderModels()` consume the resolved route as its sole input.
- Flip Anthropic catalog rows to **key-conditional** (drop when no key) — deferred because it changes what the existing picker/validator see, and must be co-changed with their tests.
- Retire `applyDirectApiFallback()` and rewrite `config-fallback.test.js`.
- Migration notices, `routing.prefer` config, `--gateway` CLI flag / MCP enum, session provenance, the interactive picker, and guidance/docs.

Plan 2 is authored after Foundation merges, against the now-settled `resolveRoute` interface.

## Self-Review Notes

- **Spec coverage (this plan):** registry unification (Decision 5) → Task 1; descriptor grammar + RouteResult (Decisions 1, 6) → Task 2; Anthropic live fetch (Decision 4) → Task 3; tri-state catalog (Decision 4) → Task 4; corrected decision tree with explicit-conflict errors + credential pre-flight + four checks (Decisions 2, 3) → Task 5. Decisions 7–10 (migration, provenance, error surfaces, picker) are Plan 2 by design.
- **Type consistency:** `RouteResult.kind` ∈ {resolved, selection_required, error}; `reason` strings are the closed set used in tests (`gateway_conflict`, `no_openrouter_key`, `no_direct_integration`, `no_direct_key`, `no_key_for_vendor`, `model_not_found`, `invalid_descriptor`). Plan 2 must reuse these exact strings when mapping to CLI/MCP errors.
- **No placeholders:** every step carries runnable code or an exact command.
