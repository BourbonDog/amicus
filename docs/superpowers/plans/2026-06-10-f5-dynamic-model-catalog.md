# F5 — Dynamic Model Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the model list live: one enriched OpenRouter-first catalog cache feeding CLI validation, a new `amicus models` command, the setup wizard's searchable picker, and a report+suggest stale-alias audit — with one curated module replacing the three hand-maintained default lists.

**Architecture:** "Catalog as the spine" (spec `docs/superpowers/specs/2026-06-10-f5-dynamic-model-catalog-design.md`). New `curated-models.js` is the single source for defaults; `model-catalog.js` cache goes schema v2 (context+pricing); everything reads the cache. The wizard's Step 2 gains a client-side-filtered search list over a `sidecar:get-catalog` IPC; `sidecar:fetch-models` STAYS (Step 3's alias editor consumes it — verified).

**Tech Stack:** Plain CommonJS Node (no TS), jest, Electron 28 (installed in the dev clone). No new dependencies.

**Baseline (main @ `80f060d`):** 104 suites / 1783 tests — 1779 pass, 4 skip, 0 fail. `npm run lint` clean.

**Execution constraints:**
- Work in a **git worktree** off main (`git worktree add ..\amicus-f5 -b f5-exec main`), node_modules junctioned: `New-Item -ItemType Junction -Path ..\amicus-f5\node_modules -Target C:\Users\sendt\dev\amicus\node_modules` (remove later with `Remove-Item -Force` **without** `-Recurse`). User-started chips share the main clone — do not git-operate it.
- Pre-commit gate: 300-line limit on `src/**/*.js` (bin/, electron/, tests/ exempt). `src/utils/config.js` is at 314 lines and NOT grandfathered — Task 1 must shrink it below 300 (it does, by replacing the inline alias map). `src/sidecar/models.js` (new) must stay < 300.
- Never run bare `npm install` (repo postinstall mutates global Claude config).
- Run `npm test` (full default suite) before every commit; lint runs via lint-staged on staged src files.

---

### Task 1: `curated-models.js` — single source for the three drifted default lists

**Files:**
- Create: `src/utils/curated-models.js`
- Create: `tests/utils/curated-models.test.js`
- Modify: `src/utils/config.js:14-38` (replace inline DEFAULT_ALIASES) — file must end ≤ 300 lines
- Modify: `src/sidecar/setup.js:16-26` (derive readline MODEL_CHOICES)
- Modify: `electron/setup-ui-model.js:9-25` (derive wizard MODEL_CHOICES)

The three lists that have drifted: `config.js` DEFAULT_ALIASES (20 aliases, IDs current as of 2026-06-09 `models:check`), `electron/setup-ui-model.js` MODEL_CHOICES (5 cards, stale IDs like `gpt-5.2-chat`), `src/sidecar/setup.js` MODEL_CHOICES (5 readline rows, labels drifted).

- [ ] **Step 1: Write the failing test**

`tests/utils/curated-models.test.js`:

```js
/**
 * Curated Models Tests — the anti-drift property.
 * All three consumer lists (config DEFAULT_ALIASES, wizard cards, readline
 * choices) must derive from this one module.
 */
const {
  getCuratedModels, toDefaultAliases, listCuratedRoutes
} = require('../../src/utils/curated-models');

// Pinned expectation: the exact alias map shipped before F5 (config.js@80f060d).
// If a model is deliberately re-pointed, update HERE and only here.
const EXPECTED_ALIASES = {
  'gemini': 'openrouter/google/gemini-3.1-flash-lite-preview',
  'gemini-pro': 'openrouter/google/gemini-3.1-pro-preview',
  'gpt': 'openrouter/openai/gpt-5.4',
  'gpt-pro': 'openrouter/openai/gpt-5.4-pro',
  'codex': 'openrouter/openai/gpt-5.3-codex',
  'claude': 'openrouter/anthropic/claude-sonnet-4.6',
  'sonnet': 'openrouter/anthropic/claude-sonnet-4.6',
  'opus': 'openrouter/anthropic/claude-opus-4.6',
  'haiku': 'openrouter/anthropic/claude-haiku-4.5',
  'deepseek': 'openrouter/deepseek/deepseek-v3.2',
  'qwen': 'openrouter/qwen/qwen3.5-397b-a17b',
  'qwen-coder': 'openrouter/qwen/qwen3-coder-next',
  'qwen-flash': 'openrouter/qwen/qwen3.5-flash-02-23',
  'mistral': 'openrouter/mistralai/mistral-large-2512',
  'devstral': 'openrouter/mistralai/devstral-2512',
  'glm': 'openrouter/z-ai/glm-5',
  'minimax': 'openrouter/minimax/minimax-m2.5',
  'grok': 'openrouter/x-ai/grok-4.3',
  'kimi': 'openrouter/moonshotai/kimi-k2.5',
  'seed': 'openrouter/bytedance-seed/seed-2.0-mini',
};

describe('curated-models', () => {
  it('toDefaultAliases reproduces the shipped alias map exactly', () => {
    expect(toDefaultAliases()).toEqual(EXPECTED_ALIASES);
  });

  it('getCuratedModels returns only card entries, each with label, blurb and routes', () => {
    const cards = getCuratedModels();
    expect(cards.map(c => c.alias)).toEqual(['gemini', 'gemini-pro', 'gpt', 'opus', 'deepseek']);
    for (const c of cards) {
      expect(typeof c.label).toBe('string');
      expect(typeof c.blurb).toBe('string');
      expect(c.routes.openrouter).toBe(EXPECTED_ALIASES[c.alias]);
    }
  });

  it('every card route id carries its provider prefix', () => {
    for (const c of getCuratedModels()) {
      for (const [provider, id] of Object.entries(c.routes)) {
        const expectedPrefix = provider === 'openrouter' ? 'openrouter/' : `${provider}/`;
        expect(id.startsWith(expectedPrefix)).toBe(true);
      }
    }
  });

  it('listCuratedRoutes flattens every route of every entry (cards + cardless)', () => {
    const routes = listCuratedRoutes();
    // 15 cardless openrouter routes + the card routes (>= 5 openrouter + direct routes)
    const aliases = new Set(routes.map(r => r.alias));
    expect(aliases.size).toBe(20);
    expect(routes).toContainEqual(
      { alias: 'grok', provider: 'openrouter', model: 'openrouter/x-ai/grok-4.3' }
    );
    for (const r of routes) {
      expect(typeof r.provider).toBe('string');
      expect(typeof r.model).toBe('string');
    }
  });

  it('config.getDefaultAliases() derives from this module (anti-drift)', () => {
    const { getDefaultAliases } = require('../../src/utils/config');
    expect(getDefaultAliases()).toEqual(toDefaultAliases());
  });

  it('wizard MODEL_CHOICES derive from this module (anti-drift)', () => {
    const { MODEL_CHOICES } = require('../../electron/setup-ui-model');
    expect(MODEL_CHOICES.map(m => m.alias)).toEqual(getCuratedModels().map(c => c.alias));
    for (const mc of MODEL_CHOICES) {
      const curated = getCuratedModels().find(c => c.alias === mc.alias);
      expect(mc.routes).toEqual(curated.routes);
      expect(mc.label).toBe(`${curated.label} — ${curated.blurb}`);
    }
  });

  it('readline MODEL_CHOICES derive from this module (anti-drift)', () => {
    const { MODEL_CHOICES } = require('../../src/sidecar/setup');
    expect(MODEL_CHOICES.map(m => m.alias)).toEqual(getCuratedModels().map(c => c.alias));
    MODEL_CHOICES.forEach((mc, i) => {
      expect(mc.number).toBe(i + 1);
      const curated = getCuratedModels()[i];
      expect(mc.label).toBe(`${curated.label} (${curated.blurb})`);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/utils/curated-models.test.js`
Expected: FAIL — `Cannot find module '../../src/utils/curated-models'`

- [ ] **Step 3: Write `src/utils/curated-models.js`**

```js
/**
 * Curated Models — THE single source of truth for default model lists.
 *
 * Three consumers derive from this module (F5 anti-drift):
 *   - src/utils/config.js DEFAULT_ALIASES   (toDefaultAliases)
 *   - electron/setup-ui-model.js MODEL_CHOICES (getCuratedModels)
 *   - src/sidecar/setup.js MODEL_CHOICES      (getCuratedModels)
 * Never hand-edit a model id anywhere else. `amicus models --check`
 * audits every route here against the live catalog.
 */

'use strict';

/**
 * Card entries (shown as wizard quick picks). `routes` maps provider →
 * full model id; the openrouter route doubles as the default alias target.
 * Direct (non-openrouter) route ids MUST be verified against the provider
 * (see Task 1 Step 6) whenever they change.
 */
const CARDS = [
  { alias: 'gemini', label: 'Gemini 3.1 Flash Lite', blurb: 'fast, large context',
    routes: { openrouter: 'openrouter/google/gemini-3.1-flash-lite-preview',
              google: 'google/gemini-3.1-flash-lite-preview' } },
  { alias: 'gemini-pro', label: 'Gemini 3.1 Pro', blurb: 'advanced reasoning',
    routes: { openrouter: 'openrouter/google/gemini-3.1-pro-preview',
              google: 'google/gemini-3.1-pro-preview' } },
  { alias: 'gpt', label: 'GPT-5.4', blurb: 'strong coding',
    routes: { openrouter: 'openrouter/openai/gpt-5.4',
              openai: 'openai/gpt-5.4' } },
  { alias: 'opus', label: 'Claude Opus 4.6', blurb: 'deep analysis',
    routes: { openrouter: 'openrouter/anthropic/claude-opus-4.6',
              anthropic: 'anthropic/claude-opus-4-6' } },
  { alias: 'deepseek', label: 'DeepSeek v3.2', blurb: 'open-source',
    routes: { openrouter: 'openrouter/deepseek/deepseek-v3.2' } },
];

/** Alias-only entries (no wizard card); openrouter route only. */
const CARDLESS = [
  { alias: 'gpt-pro', routes: { openrouter: 'openrouter/openai/gpt-5.4-pro' } },
  // codex: newest codex-specific model on OpenRouter (verified 2026-06-09).
  { alias: 'codex', routes: { openrouter: 'openrouter/openai/gpt-5.3-codex' } },
  { alias: 'claude', routes: { openrouter: 'openrouter/anthropic/claude-sonnet-4.6' } },
  { alias: 'sonnet', routes: { openrouter: 'openrouter/anthropic/claude-sonnet-4.6' } },
  { alias: 'haiku', routes: { openrouter: 'openrouter/anthropic/claude-haiku-4.5' } },
  { alias: 'qwen', routes: { openrouter: 'openrouter/qwen/qwen3.5-397b-a17b' } },
  { alias: 'qwen-coder', routes: { openrouter: 'openrouter/qwen/qwen3-coder-next' } },
  { alias: 'qwen-flash', routes: { openrouter: 'openrouter/qwen/qwen3.5-flash-02-23' } },
  { alias: 'mistral', routes: { openrouter: 'openrouter/mistralai/mistral-large-2512' } },
  { alias: 'devstral', routes: { openrouter: 'openrouter/mistralai/devstral-2512' } },
  { alias: 'glm', routes: { openrouter: 'openrouter/z-ai/glm-5' } },
  { alias: 'minimax', routes: { openrouter: 'openrouter/minimax/minimax-m2.5' } },
  { alias: 'grok', routes: { openrouter: 'openrouter/x-ai/grok-4.3' } },
  { alias: 'kimi', routes: { openrouter: 'openrouter/moonshotai/kimi-k2.5' } },
  { alias: 'seed', routes: { openrouter: 'openrouter/bytedance-seed/seed-2.0-mini' } },
];

/** @returns {Array<{alias,label,blurb,routes}>} card entries (wizard quick picks) */
function getCuratedModels() {
  return CARDS.map(c => ({ ...c, routes: { ...c.routes } }));
}

/** @returns {Object<string,string>} alias → preferred route (openrouter first) */
function toDefaultAliases() {
  const out = {};
  for (const e of [...CARDS, ...CARDLESS]) {
    out[e.alias] = e.routes.openrouter || Object.values(e.routes)[0];
  }
  return out;
}

/** @returns {Array<{alias,provider,model}>} every route of every entry, flattened */
function listCuratedRoutes() {
  const out = [];
  for (const e of [...CARDS, ...CARDLESS]) {
    for (const [provider, model] of Object.entries(e.routes)) {
      out.push({ alias: e.alias, provider, model });
    }
  }
  return out;
}

module.exports = { getCuratedModels, toDefaultAliases, listCuratedRoutes };
```

- [ ] **Step 4: Derive the three consumers**

`src/utils/config.js` — replace lines 14-38 (the whole `const DEFAULT_ALIASES = {...};` literal including its JSDoc line) with:

```js
/** Default model alias map — derived from the curated-models single source (F5) */
const { toDefaultAliases } = require('./curated-models');
const DEFAULT_ALIASES = toDefaultAliases();
```

Everything else in config.js keeps using `DEFAULT_ALIASES` unchanged. Verify the file is now ≤ 300 lines: `(Get-Content src\utils\config.js | Measure-Object -Line).Lines` → expect ~292.

`src/sidecar/setup.js` — replace lines 16-26 (`const MODEL_CHOICES = [...]` and its JSDoc) with:

```js
/**
 * Model choices presented during readline setup — derived from curated-models (F5).
 * @type {Array<{number: number, alias: string, label: string}>}
 */
const { getCuratedModels } = require('../utils/curated-models');
const MODEL_CHOICES = getCuratedModels().map((c, i) => ({
  number: i + 1, alias: c.alias, label: `${c.label} (${c.blurb})`
}));
```

`electron/setup-ui-model.js` — replace lines 9-25 (`const MODEL_CHOICES = [...]` and its JSDoc) with:

```js
/**
 * Wizard quick-pick cards — derived from curated-models (F5).
 * @type {Array<{alias: string, label: string, routes: Object<string,string>}>}
 */
const { getCuratedModels } = require('../src/utils/curated-models');
const MODEL_CHOICES = getCuratedModels().map(c => ({
  alias: c.alias, label: `${c.label} — ${c.blurb}`, routes: c.routes
}));
```

- [ ] **Step 5: Run tests to verify they pass, then the full suite**

Run: `npx jest tests/utils/curated-models.test.js` → PASS (7 tests).
Run: `npm test` → expect 1790 tests, 1786 pass, 4 skip, 0 fail. Existing config/alias tests (`config-hash`, alias-resolver, setup tests) must stay green — they consume `getDefaultAliases()`/`MODEL_CHOICES` whose VALUES are unchanged for the openrouter aliases. The wizard cards' direct-route IDs changed (e.g. `google/gemini-3-flash-preview` → `google/gemini-3.1-flash-lite-preview`); if any existing test pins an OLD stale id (grep `gemini-3-flash-preview`, `gpt-5.2-chat`, `deepseek-v3.2` in `tests/`), update that test's fixture to the curated value — the old ids were the drift bug.

- [ ] **Step 6: Live-verify the direct-route ids**

The direct (google/openai/anthropic) route ids in CARDS are best-effort updates of the wizard's stale list. Verify each against the live provider list:

Run: `node -e "require('./src/utils/model-fetcher').fetchModelsFromProvider('google', process.env.GOOGLE_GENERATIVE_AI_API_KEY).then(m => console.log(m.map(x=>x.id).filter(id=>id.includes('gemini-3')).join('\n')))"`
(keys load from `~/.config/amicus`/sidecar .env via `node -e "require('./src/utils/env-loader').loadCredentials()" ` prefix if needed — or simply run `node bin/amicus.js models --search gemini` after Task 5 and check both route forms appear.)

If a direct id does not exist on the provider, correct it in CARDS to the closest current id (same family) and note the correction in the commit message. The anthropic direct id uses DASHES (`anthropic/claude-opus-4-6`) per `ANTHROPIC_MODELS` in model-fetcher.js — do not "fix" it to dots.

- [ ] **Step 7: Commit**

```bash
git add src/utils/curated-models.js tests/utils/curated-models.test.js src/utils/config.js src/sidecar/setup.js electron/setup-ui-model.js
git commit -m "feat(f5): curated-models single source replaces three drifted default lists"
```

---

### Task 2: Fetcher — keyless OpenRouter + metadata enrichment

**Files:**
- Modify: `src/utils/model-fetcher.js`
- Create: `tests/utils/model-fetcher-enrichment.test.js`

- [ ] **Step 1: Write the failing test**

`tests/utils/model-fetcher-enrichment.test.js`:

```js
/**
 * F5: OpenRouter fetch works keyless (public endpoint) and normalizers
 * return enriched rows {id, name, contextLength, pricing}.
 */
const {
  PROVIDER_FETCH_CONFIG, fetchAllModels, ANTHROPIC_MODELS
} = require('../../src/utils/model-fetcher');

describe('keyless OpenRouter', () => {
  it('openrouter authHeader omits Authorization when no key is given', () => {
    expect(PROVIDER_FETCH_CONFIG.openrouter.authHeader('')).toEqual({});
    expect(PROVIDER_FETCH_CONFIG.openrouter.authHeader(null)).toEqual({});
  });

  it('openrouter authHeader includes bearer when a key is given', () => {
    expect(PROVIDER_FETCH_CONFIG.openrouter.authHeader('sk-x'))
      .toEqual({ 'Authorization': 'Bearer sk-x' });
  });

  it('fetchAllModels always includes openrouter even with no keys', () => {
    // Spy on the per-provider fetch by checking which providers are attempted:
    // with empty keys, the provider set must be {openrouter, anthropic}.
    const { providersToFetch } = require('../../src/utils/model-fetcher');
    expect(providersToFetch({}).sort()).toEqual(['anthropic', 'openrouter']);
    expect(providersToFetch({ google: 'g-key' }).sort())
      .toEqual(['anthropic', 'google', 'openrouter']);
  });
});

describe('enriched normalizers', () => {
  it('openrouter normalize maps context_length and pricing, nulls when absent', () => {
    const body = JSON.stringify({ data: [
      { id: 'x-ai/grok-4.3', name: 'Grok 4.3', context_length: 256000,
        pricing: { prompt: '0.000003', completion: '0.000015' } },
      { id: 'tiny/no-meta' }
    ] });
    const rows = PROVIDER_FETCH_CONFIG.openrouter.normalize(body);
    expect(rows[0]).toEqual({
      id: 'openrouter/x-ai/grok-4.3', name: 'Grok 4.3', contextLength: 256000,
      pricing: { prompt: '0.000003', completion: '0.000015' }
    });
    expect(rows[1]).toEqual({
      id: 'openrouter/tiny/no-meta', name: 'tiny/no-meta',
      contextLength: null, pricing: null
    });
  });

  it('google normalize maps inputTokenLimit to contextLength, pricing null', () => {
    const body = JSON.stringify({ models: [
      { name: 'models/gemini-3.1-pro-preview', displayName: 'Gemini 3.1 Pro', inputTokenLimit: 2000000 }
    ] });
    const rows = PROVIDER_FETCH_CONFIG.google.normalize(body);
    expect(rows[0]).toEqual({
      id: 'google/gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro',
      contextLength: 2000000, pricing: null
    });
  });

  it('openai normalize and anthropic hardcoded rows carry null metadata', () => {
    const rows = PROVIDER_FETCH_CONFIG.openai.normalize(JSON.stringify({ data: [{ id: 'gpt-5.4' }] }));
    expect(rows[0]).toEqual({ id: 'openai/gpt-5.4', name: 'gpt-5.4', contextLength: null, pricing: null });
    for (const m of ANTHROPIC_MODELS) {
      expect(m.contextLength).toBeNull();
      expect(m.pricing).toBeNull();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/utils/model-fetcher-enrichment.test.js`
Expected: FAIL — `PROVIDER_FETCH_CONFIG`/`providersToFetch` not exported, normalizers lack metadata fields.

- [ ] **Step 3: Implement in `src/utils/model-fetcher.js`**

1. ANTHROPIC_MODELS entries gain `contextLength: null, pricing: null` (all 5 rows).
2. openrouter config:

```js
  openrouter: {
    url: 'https://openrouter.ai/api/v1/models',
    // Public endpoint: works keyless; attach auth only when a key exists (F5).
    authHeader: (key) => (key ? { 'Authorization': `Bearer ${key}` } : {}),
    normalize: (body) => {
      const data = JSON.parse(body);
      return (data.data || []).map(m => ({
        id: `openrouter/${m.id}`,
        name: m.name || m.id,
        contextLength: m.context_length != null ? m.context_length : null,
        pricing: m.pricing
          ? { prompt: m.pricing.prompt != null ? m.pricing.prompt : null,
              completion: m.pricing.completion != null ? m.pricing.completion : null }
          : null
      }));
    }
  },
```

3. google normalize adds `contextLength: m.inputTokenLimit != null ? m.inputTokenLimit : null, pricing: null`; openai normalize adds `contextLength: null, pricing: null`.
4. Extract the provider-set logic so it is testable, and make openrouter always-on:

```js
/** Providers to fetch: every keyed provider + openrouter (keyless-capable) + anthropic. */
function providersToFetch(keys) {
  const set = new Set(Object.keys(keys).filter(p => keys[p]));
  set.add('openrouter');
  set.add('anthropic');
  return Array.from(set);
}

async function fetchAllModels(keys) {
  const providers = providersToFetch(keys);
  const results = await Promise.all(providers.map(p => fetchModelsFromProvider(p, keys[p] || '')));
  return results.flat();
}
```

5. Export additionally: `PROVIDER_FETCH_CONFIG`, `providersToFetch`.

- [ ] **Step 4: Run tests to verify pass + full suite**

Run: `npx jest tests/utils/model-fetcher-enrichment.test.js` → PASS.
Run: `npm test` → 0 fail. The GUI `sidecar:fetch-models` path and `validateDirectModel` consume `{id, name}` — extra fields are additive and must not break them; any test pinning exact row shapes (grep `fetchAllModels`/`fetchModelsFromProvider` in `tests/`) gets its fixtures extended with `contextLength: null, pricing: null`.

- [ ] **Step 5: Commit**

```bash
git add src/utils/model-fetcher.js tests/utils/model-fetcher-enrichment.test.js
git commit -m "feat(f5): keyless OpenRouter fetch + context/pricing enrichment"
```

---

### Task 3: Catalog cache schema v2 + `getCatalogInfo`

**Files:**
- Modify: `src/utils/model-catalog.js`
- Create: `tests/utils/model-catalog-v2.test.js`

- [ ] **Step 1: Write the failing test**

`tests/utils/model-catalog-v2.test.js`:

```js
/** F5: cache schema v2 ({schemaVersion:2, fetchedAt, models[enriched]}); v1 reads as stale. */
const fs = require('fs');
const os = require('os');
const path = require('path');

describe('model-catalog schema v2', () => {
  let tmpDir;
  const ROWS = [{ id: 'openrouter/x-ai/grok-4.3', name: 'Grok 4.3', contextLength: 256000,
    pricing: { prompt: '0.000003', completion: '0.000015' } }];

  beforeEach(() => {
    jest.resetModules();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-cat-'));
    process.env.AMICUS_CONFIG_DIR = tmpDir;
  });
  afterEach(() => {
    delete process.env.AMICUS_CONFIG_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function mockFetch(rows) {
    jest.doMock('../../src/utils/model-fetcher', () => ({ fetchAllModels: jest.fn(async () => rows) }));
    jest.doMock('../../src/utils/api-key-store', () => ({ readApiKeyValues: () => ({}) }));
  }

  it('refreshCatalog writes a v2 cache with enriched rows', async () => {
    mockFetch(ROWS);
    const { refreshCatalog, catalogPath } = require('../../src/utils/model-catalog');
    await refreshCatalog();
    const cache = JSON.parse(fs.readFileSync(catalogPath(), 'utf-8'));
    expect(cache.schemaVersion).toBe(2);
    expect(cache.models).toEqual(ROWS);
    expect(typeof cache.fetchedAt).toBe('number');
  });

  it('a v1 cache (no schemaVersion) reads as stale and is refreshed to v2', async () => {
    mockFetch(ROWS);
    const { getCatalog, catalogPath } = require('../../src/utils/model-catalog');
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(catalogPath(), JSON.stringify({
      fetchedAt: Date.now(), models: [{ id: 'openrouter/old', name: 'old' }]
    }));
    const models = await getCatalog();
    expect(models).toEqual(ROWS); // refreshed, not the v1 content
    const cache = JSON.parse(fs.readFileSync(catalogPath(), 'utf-8'));
    expect(cache.schemaVersion).toBe(2);
  });

  it('a fresh v2 cache is served without refetching', async () => {
    mockFetch([{ id: 'openrouter/should-not-appear', name: 'x', contextLength: null, pricing: null }]);
    const { getCatalog, catalogPath } = require('../../src/utils/model-catalog');
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(catalogPath(), JSON.stringify({ schemaVersion: 2, fetchedAt: Date.now(), models: ROWS }));
    expect(await getCatalog()).toEqual(ROWS);
  });

  it('v1 cache still serves as stale fallback when the refresh comes back empty', async () => {
    mockFetch([]);
    const { getCatalog, catalogPath } = require('../../src/utils/model-catalog');
    fs.mkdirSync(tmpDir, { recursive: true });
    const v1rows = [{ id: 'openrouter/old', name: 'old' }];
    fs.writeFileSync(catalogPath(), JSON.stringify({ fetchedAt: Date.now(), models: v1rows }));
    expect(await getCatalog()).toEqual(v1rows); // offline: stale v1 beats nothing
  });

  it('getCatalogInfo returns rows plus fetchedAt', async () => {
    mockFetch(ROWS);
    const { getCatalogInfo } = require('../../src/utils/model-catalog');
    const info = await getCatalogInfo();
    expect(info.models).toEqual(ROWS);
    expect(typeof info.fetchedAt).toBe('number');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/utils/model-catalog-v2.test.js`
Expected: FAIL — no `schemaVersion` written, v1 served as fresh, `getCatalogInfo` undefined.

- [ ] **Step 3: Implement in `src/utils/model-catalog.js`**

```js
const SCHEMA_VERSION = 2;
```

`writeCache`: write `JSON.stringify({ schemaVersion: SCHEMA_VERSION, fetchedAt: Date.now(), models }, null, 2)`.

`getCatalog` freshness check becomes:

```js
  const fresh = cache && cache.schemaVersion === SCHEMA_VERSION &&
    (Date.now() - cache.fetchedAt) <= maxAgeMs;
```

(`readCache` keeps accepting any `{models: Array}` shape — a v1 cache remains usable as the stale fallback, it just never counts as fresh.)

Add:

```js
/**
 * Catalog rows plus cache timestamp (for UI display).
 * @returns {Promise<{models: Array, fetchedAt: number|null}>}
 */
async function getCatalogInfo(opts = {}) {
  const models = await getCatalog(opts);
  const cache = readCache();
  return { models, fetchedAt: cache ? cache.fetchedAt : null };
}
```

Export `getCatalogInfo` and `SCHEMA_VERSION` alongside the existing exports. Update the file header comment to mention v2.

- [ ] **Step 4: Run tests + full suite**

Run: `npx jest tests/utils/model-catalog-v2.test.js tests/model-catalog.test.js` → both PASS (the existing v1 tests assert `{fetchedAt, models}` reads — they keep passing because readCache is shape-tolerant; if `tests/model-catalog.test.js` pins the WRITTEN file shape, extend its expectation with `schemaVersion: 2`).
Run: `npm test` → 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/utils/model-catalog.js tests/utils/model-catalog-v2.test.js tests/model-catalog.test.js
git commit -m "feat(f5): catalog cache schema v2 (enriched rows) + getCatalogInfo"
```

---

### Task 4: `alias-audit.js` — report + suggest

**Files:**
- Create: `src/utils/alias-audit.js`
- Create: `tests/utils/alias-audit.test.js`

- [ ] **Step 1: Write the failing test**

`tests/utils/alias-audit.test.js`:

```js
/** F5: stale-alias audit across defaults + user config + curated routes, with suggestions. */
const {
  collectAliasSources, findStaleAliases, suggestReplacements
} = require('../../src/utils/alias-audit');

const CATALOG = [
  { id: 'openrouter/x-ai/grok-4.3', name: 'Grok 4.3' },
  { id: 'openrouter/x-ai/grok-4', name: 'Grok 4' },
  { id: 'openrouter/x-ai/grok-3-mini', name: 'Grok 3 Mini' },
  { id: 'openrouter/google/gemini-3.1-flash-lite-preview', name: 'Gemini Flash Lite' },
  { id: 'google/gemini-3.1-flash-lite-preview', name: 'Gemini direct' },
];

describe('findStaleAliases', () => {
  it('flags openrouter routes absent from the catalog', () => {
    const sources = [
      { alias: 'grok', model: 'openrouter/x-ai/grok-4.1-fast', source: 'defaults' },
      { alias: 'gemini', model: 'openrouter/google/gemini-3.1-flash-lite-preview', source: 'defaults' },
    ];
    const stale = findStaleAliases(sources, CATALOG);
    expect(stale).toEqual([
      { alias: 'grok', model: 'openrouter/x-ai/grok-4.1-fast', source: 'defaults' }
    ]);
  });

  it('checks direct-provider routes only when that provider has rows (no false stales)', () => {
    const sources = [
      { alias: 'gemini', model: 'google/gemini-old-model', source: 'curated' },   // google rows present → checkable → stale
      { alias: 'gpt', model: 'openai/gpt-5.4', source: 'curated' },               // no openai rows → unverifiable → NOT stale
    ];
    const stale = findStaleAliases(sources, CATALOG);
    expect(stale.map(s => s.alias)).toEqual(['gemini']);
  });

  it('returns [] when the catalog is empty (cannot check)', () => {
    expect(findStaleAliases([{ alias: 'x', model: 'openrouter/a/b', source: 'defaults' }], [])).toEqual([]);
  });
});

describe('suggestReplacements', () => {
  it('suggests same-vendor candidates, newest-looking first, max 3', () => {
    const s = suggestReplacements('openrouter/x-ai/grok-4.1-fast', CATALOG);
    expect(s).toEqual(['openrouter/x-ai/grok-4.3', 'openrouter/x-ai/grok-4', 'openrouter/x-ai/grok-3-mini']);
  });

  it('is deterministic and returns [] when no same-vendor rows exist', () => {
    expect(suggestReplacements('openrouter/unknown-vendor/m1', CATALOG)).toEqual([]);
  });
});

describe('collectAliasSources', () => {
  it('includes defaults, user config aliases, and curated routes with source tags', () => {
    jest.resetModules();
    jest.doMock('../../src/utils/config', () => ({
      getDefaultAliases: () => ({ grok: 'openrouter/x-ai/grok-4.3' }),
      loadConfig: () => ({ aliases: { mine: 'openrouter/foo/bar' } }),
    }));
    jest.doMock('../../src/utils/curated-models', () => ({
      listCuratedRoutes: () => [{ alias: 'gemini', provider: 'google', model: 'google/g-1' }],
    }));
    const { collectAliasSources: collect } = require('../../src/utils/alias-audit');
    expect(collect()).toEqual([
      { alias: 'grok', model: 'openrouter/x-ai/grok-4.3', source: 'defaults' },
      { alias: 'mine', model: 'openrouter/foo/bar', source: 'user-config' },
      { alias: 'gemini', model: 'google/g-1', source: 'curated-route (google)' },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/utils/alias-audit.test.js`
Expected: FAIL — module missing.

- [ ] **Step 3: Write `src/utils/alias-audit.js`**

```js
/**
 * Alias Audit (F5) — report + suggest, never auto-repair.
 *
 * Finds aliases/routes pointing at models absent from the catalog and
 * suggests current same-vendor replacements. Pure functions over inputs;
 * collectAliasSources() does the gathering. Consumed by `amicus models
 * --check` and the npm wrapper scripts.
 */

'use strict';

/** @returns {Array<{alias,model,source}>} every alias mapping we ship or the user set */
function collectAliasSources() {
  const { getDefaultAliases, loadConfig } = require('./config');
  const { listCuratedRoutes } = require('./curated-models');
  const out = [];
  for (const [alias, model] of Object.entries(getDefaultAliases())) {
    out.push({ alias, model, source: 'defaults' });
  }
  const cfg = loadConfig();
  for (const [alias, model] of Object.entries((cfg && cfg.aliases) || {})) {
    if (typeof model === 'string' && model) {
      out.push({ alias, model, source: 'user-config' });
    }
  }
  for (const r of listCuratedRoutes()) {
    out.push({ alias: r.alias, model: r.model, source: `curated-route (${r.provider})` });
  }
  return out;
}

/** Catalog ids grouped by leading provider segment, e.g. 'openrouter', 'google'. */
function idsByProvider(catalog) {
  const map = new Map();
  for (const m of catalog) {
    const provider = m.id.split('/')[0];
    if (!map.has(provider)) { map.set(provider, new Set()); }
    map.get(provider).add(m.id);
  }
  return map;
}

/**
 * Entries whose model is absent from the catalog. A model is only checkable
 * when its provider has rows in the catalog (unkeyed providers never produce
 * false stales). Empty catalog → [] (cannot check).
 * @param {Array<{alias,model,source}>} sources
 * @param {Array<{id:string}>} catalog
 */
function findStaleAliases(sources, catalog) {
  if (!catalog || catalog.length === 0) { return []; }
  const byProvider = idsByProvider(catalog);
  return sources.filter(({ model }) => {
    const provider = model.split('/')[0];
    const ids = byProvider.get(provider);
    if (!ids) { return false; } // provider unverifiable
    return !ids.has(model);
  });
}

/**
 * Same-vendor replacement candidates for a stale model id, ranked by
 * shared-prefix length with the stale id (desc), then id descending so
 * higher version numbers sort first. Deterministic; max n.
 * @param {string} staleModel - e.g. 'openrouter/x-ai/grok-4.1-fast'
 * @param {Array<{id:string}>} catalog
 * @param {number} [n=3]
 * @returns {string[]} candidate ids
 */
function suggestReplacements(staleModel, catalog, n = 3) {
  const vendorPrefix = staleModel.split('/').slice(0, -1).join('/') + '/';
  const sharedLen = (a, b) => {
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) { i++; }
    return i;
  };
  return catalog
    .map(m => m.id)
    .filter(id => id.startsWith(vendorPrefix) && id !== staleModel)
    .sort((a, b) =>
      (sharedLen(b, staleModel) - sharedLen(a, staleModel)) || b.localeCompare(a))
    .slice(0, n);
}

module.exports = { collectAliasSources, findStaleAliases, suggestReplacements };
```

- [ ] **Step 4: Run tests + full suite**

Run: `npx jest tests/utils/alias-audit.test.js` → PASS.
Run: `npm test` → 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/utils/alias-audit.js tests/utils/alias-audit.test.js
git commit -m "feat(f5): alias-audit module — stale detection + same-vendor suggestions"
```

---

### Task 5: `amicus models` command (+ JSON docs, script deletions, npm rewire)

**Files:**
- Create: `src/sidecar/models.js` (must stay < 300 lines)
- Create: `tests/sidecar/models-command.test.js`
- Modify: `src/utils/result-schema.js` (append doc builders; 217 → ~270 lines)
- Modify: `bin/amicus.js:90` area (add `models` case)
- Modify: `src/utils/lifecycle.js:15` (add `'models'` to ONE_SHOT_COMMANDS)
- Modify: `src/cli.js:295` area (usage text) and `:340` area (options block)
- Modify: `src/utils/model-validator.js:185` (fix-hint message)
- Modify: `package.json` (scripts)
- Delete: `scripts/refresh-model-capabilities.js`, `scripts/list-models.js`, `tests/scripts/refresh-model-capabilities.test.js`

- [ ] **Step 1: Write the failing test**

`tests/sidecar/models-command.test.js`:

```js
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

function loadHandler({ catalog = CATALOG, sources, stale } = {}) {
  jest.resetModules();
  jest.doMock('../../src/utils/model-catalog', () => ({
    getCatalogInfo: jest.fn(async () => ({ models: catalog, fetchedAt: 1718000000000 })),
    refreshCatalog: jest.fn(async () => catalog),
    catalogPath: () => 'C:/fake/model-catalog.json',
  }));
  if (sources || stale) {
    jest.doMock('../../src/utils/alias-audit', () => ({
      collectAliasSources: () => sources || [],
      findStaleAliases: () => stale || [],
      suggestReplacements: () => ['openrouter/x-ai/grok-4.3'],
    }));
  }
  return require('../../src/sidecar/models');
}

function captureStdout(fn) {
  const writes = [];
  const orig = process.stdout.write;
  process.stdout.write = (s) => { writes.push(String(s)); return true; };
  return Promise.resolve(fn()).finally(() => { process.stdout.write = orig; })
    .then(code => ({ code, out: writes.join('') }));
}

describe('amicus models', () => {
  it('default lists the catalog with context and pricing columns', async () => {
    const { handleModels } = loadHandler();
    const { code, out } = await captureStdout(() => handleModels({ _: ['models'] }));
    expect(code).toBe(0);
    expect(out).toContain('openrouter/x-ai/grok-4.3');
    expect(out).toContain('256000');
    expect(out).toContain('3.00');   // $/Mtok prompt = 0.000003 * 1e6
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
    expect(doc.schemaVersion).toBe(1);
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/sidecar/models-command.test.js`
Expected: FAIL — `src/sidecar/models.js` missing.

- [ ] **Step 3: Append doc builders to `src/utils/result-schema.js`**

Add before `module.exports` (note: F4 uses `type`, not `kind` — the spec's "kind" is implemented as `type` for schema consistency):

```js
/**
 * Build a model-catalog document (`models [--search] [--refresh] --json`).
 * @param {{models: Array, fetchedAt: number|null, refreshed?: boolean, search?: string|null}} opts
 */
function buildCatalogDoc({ models, fetchedAt, refreshed = false, search = null }) {
  return {
    schemaVersion: SCHEMA_VERSION,
    type: 'model-catalog',
    fetchedAt: fetchedAt || null,
    refreshed,
    search,
    count: models.length,
    models,
  };
}

/**
 * Build an alias-audit document (`models --check --json`).
 * @param {{stale: Array<{alias,model,source,suggestions}>, catalogAvailable: boolean}} opts
 */
function buildAuditDoc({ stale, catalogAvailable }) {
  return {
    schemaVersion: SCHEMA_VERSION,
    type: 'alias-audit',
    catalogAvailable,
    staleCount: stale.length,
    stale,
  };
}
```

Add `buildCatalogDoc, buildAuditDoc` to the module.exports object.

- [ ] **Step 4: Write `src/sidecar/models.js`**

```js
/**
 * `amicus models` (F5) — list/search the catalog, refresh it, audit aliases.
 *
 *   amicus models                  list (curated aliases marked)
 *   amicus models --search <q>     substring filter over id+name
 *   amicus models --refresh        force-refresh the cache
 *   amicus models --check          stale-alias audit (exit = stale count, max 100)
 *   --json on all of the above     versioned documents (result-schema)
 *
 * Returns an exit code; bin/amicus.js plumbs it like fanout's.
 */

'use strict';

const { getCatalogInfo, refreshCatalog, catalogPath } = require('../utils/model-catalog');
const { collectAliasSources, findStaleAliases, suggestReplacements } = require('../utils/alias-audit');
const { buildCatalogDoc, buildAuditDoc } = require('../utils/result-schema');

const CHECK_EXIT_CAP = 100;

/** '0.000003' per token → '3.00' per Mtok; '—' when unknown */
function perMtok(perToken) {
  if (perToken == null) { return '—'; }
  const n = Number(perToken);
  return Number.isNaN(n) ? '—' : (n * 1e6).toFixed(2);
}

function fmtRow(m, aliasesById) {
  const alias = aliasesById.get(m.id);
  const aliasCol = alias ? `[${alias}] ` : '';
  const ctx = m.contextLength != null ? String(m.contextLength) : '—';
  const pIn = perMtok(m.pricing && m.pricing.prompt);
  const pOut = perMtok(m.pricing && m.pricing.completion);
  return `${aliasCol}${m.id}\n    ${m.name}  ctx ${ctx}  $/Mtok in ${pIn} out ${pOut}`;
}

/** alias marks: id → comma-joined alias names (defaults only — the curated view) */
function aliasMarks() {
  const { getDefaultAliases } = require('../utils/config');
  const map = new Map();
  for (const [alias, model] of Object.entries(getDefaultAliases())) {
    map.set(model, map.has(model) ? `${map.get(model)},${alias}` : alias);
  }
  return map;
}

async function runList(args) {
  const { models, fetchedAt } = await getCatalogInfo();
  const q = typeof args.search === 'string' ? args.search.toLowerCase() : null;
  const filtered = q
    ? models.filter(m => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q))
    : models;
  if (args.json) {
    process.stdout.write(JSON.stringify(buildCatalogDoc({
      models: filtered, fetchedAt, search: q
    }), null, 2) + '\n');
    return 0;
  }
  const marks = aliasMarks();
  // Curated (alias-marked) rows first, then the rest.
  const curated = filtered.filter(m => marks.has(m.id));
  const rest = filtered.filter(m => !marks.has(m.id));
  for (const m of [...curated, ...rest]) {
    process.stdout.write(fmtRow(m, marks) + '\n');
  }
  const when = fetchedAt ? new Date(fetchedAt).toISOString() : 'never';
  process.stdout.write(`(${filtered.length} models, catalog fetched ${when})\n`);
  if (filtered.length === 0 && models.length === 0) {
    process.stdout.write('Catalog unavailable (offline or first run) — try: amicus models --refresh\n');
  }
  return 0;
}

async function runRefresh(args) {
  const models = await refreshCatalog();
  if (args.json) {
    process.stdout.write(JSON.stringify(buildCatalogDoc({
      models, fetchedAt: Date.now(), refreshed: true
    }), null, 2) + '\n');
    return 0;
  }
  process.stdout.write(`Refreshed catalog: ${models.length} models.\n`);
  process.stdout.write(`Cache: ${catalogPath()}\n`);
  return 0;
}

async function runCheck(args) {
  const { models: catalog } = await getCatalogInfo();
  if (!catalog || catalog.length === 0) {
    if (args.json) {
      process.stdout.write(JSON.stringify(buildAuditDoc({
        stale: [], catalogAvailable: false
      }), null, 2) + '\n');
    } else {
      process.stdout.write('Catalog unavailable (offline or no providers reachable); cannot check.\n');
    }
    return 0;
  }
  const sources = collectAliasSources();
  const stale = findStaleAliases(sources, catalog)
    .map(s => ({ ...s, suggestions: suggestReplacements(s.model, catalog) }));
  if (args.json) {
    process.stdout.write(JSON.stringify(buildAuditDoc({
      stale, catalogAvailable: true
    }), null, 2) + '\n');
    return Math.min(stale.length, CHECK_EXIT_CAP);
  }
  if (stale.length === 0) {
    process.stdout.write(`All aliases resolve to catalog models (${sources.length} checked).\n`);
    return 0;
  }
  for (const s of stale) {
    process.stdout.write(`STALE: ${s.alias} -> ${s.model} (${s.source})\n`);
    if (s.suggestions.length > 0) {
      process.stdout.write(`  candidates: ${s.suggestions.join(', ')}\n`);
      process.stdout.write(`  fix: amicus setup --add-alias ${s.alias}=${s.suggestions[0]}\n`);
    } else {
      process.stdout.write('  no same-vendor candidates in catalog\n');
    }
  }
  return Math.min(stale.length, CHECK_EXIT_CAP);
}

/** @param {object} args parsed CLI args @returns {Promise<number>} exit code */
async function handleModels(args) {
  if (args.refresh) { return runRefresh(args); }
  if (args.check) { return runCheck(args); }
  return runList(args);
}

module.exports = { handleModels };
```

- [ ] **Step 5: Wire the command surface**

`bin/amicus.js` — add a case after `read` (line ~92):

```js
      case 'models': {
        const { handleModels } = require('../src/sidecar/models');
        exitCode = await handleModels(args);
        break;
      }
```

`src/utils/lifecycle.js:15` — add `'models'`:

```js
const ONE_SHOT_COMMANDS = new Set(['start', 'continue', 'resume', 'list', 'read', 'abort', 'fanout', 'models']);
```

`src/cli.js` — in the Commands block (line ~295, after the `read` line), add:

```
  models      List/search the model catalog, refresh it, audit aliases
```

and after the `Options for 'fanout':` block (line ~339 area) add:

```
Options for 'models':
  --search <q>                 Filter by substring over model id and name
  --refresh                    Force-refresh the catalog from provider APIs
  --check                      Audit aliases against the catalog (exit = stale count)
  --json                       Machine-readable output
```

(Match the exact indentation of the neighbouring usage lines; `parseArgs` already passes through `--search/--refresh/--check/--json` as generic flags — verify by running `node bin/amicus.js models --search grok` in Step 7; if parseArgs has an allowlist that drops them, add the three flags where `--json` is declared.)

`src/utils/model-validator.js:185` — replace the fix-hint line:

```js
    'Run \'amicus models --refresh\' to update the catalog, or pass --no-validate-model to skip.'
```

`package.json` scripts — replace the three entries:

```json
    "refresh-models": "node bin/amicus.js models --refresh",
    "models:info": "node bin/amicus.js models",
    "models:check": "node bin/amicus.js models --check",
```

Delete files: `scripts/refresh-model-capabilities.js`, `scripts/list-models.js`, `tests/scripts/refresh-model-capabilities.test.js` (its findStaleAliases coverage now lives in tests/utils/alias-audit.test.js).

- [ ] **Step 6: Run tests + full suite**

Run: `npx jest tests/sidecar/models-command.test.js` → PASS.
Run: `npm test` → 0 fail (the deleted script test no longer counts; net test count rises).

- [ ] **Step 7: Live smoke (this machine has keys + network)**

Run: `node bin/amicus.js models --refresh` → `Refreshed catalog: <several hundred> models.`
Run: `node bin/amicus.js models --search grok` → grok rows with ctx/pricing columns.
Run: `node bin/amicus.js models --check; echo $LASTEXITCODE` → `All aliases resolve...` + `0` (or real stales with suggestions — if a default alias is genuinely stale, fix it in `curated-models.js` CARDS/CARDLESS as part of this task).
Run: `npm run models:check` → same output via the wrapper.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(f5): amicus models command (list/search/refresh/check, --json); retire scripts"
```

---

### Task 6: IPC — `sidecar:get-catalog` / `sidecar:refresh-catalog` + warm seeding on key save

**Files:**
- Modify: `electron/ipc-setup.js` (add two handlers; extend save-key)
- Create: `tests/electron/ipc-catalog.test.js`

`registerSetupHandlers(ipcMain, getMainWindow)` takes ipcMain as a parameter — testable with a fake `{ handle(name, fn) }`. `sidecar:fetch-models` STAYS (Step 3 alias editor uses it).

- [ ] **Step 1: Write the failing test**

`tests/electron/ipc-catalog.test.js`:

```js
/** F5: catalog IPC for the wizard picker + warm refresh after key save. */

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));

function registerWithFakes({ catalogInfo, refreshImpl, saveImpl } = {}) {
  jest.resetModules();
  jest.doMock('../../src/utils/model-catalog', () => ({
    getCatalogInfo: jest.fn(async () => catalogInfo || { models: [], fetchedAt: null }),
    refreshCatalog: refreshImpl || jest.fn(async () => []),
  }));
  jest.doMock('../../src/utils/api-key-store', () => ({
    saveApiKey: saveImpl || jest.fn(() => ({ success: true })),
    validateApiKey: jest.fn(),
    removeApiKey: jest.fn(),
    readApiKeys: jest.fn(() => ({})),
    readApiKeyHints: jest.fn(() => ({})),
    readApiKeyValues: jest.fn(() => ({})),
  }));
  const handlers = {};
  const fakeIpc = { handle: (name, fn) => { handlers[name] = fn; } };
  const { registerSetupHandlers } = require('../../electron/ipc-setup');
  registerSetupHandlers(fakeIpc, () => null);
  return handlers;
}

describe('catalog IPC', () => {
  it('sidecar:get-catalog returns models + fetchedAt from the cache layer', async () => {
    const rows = [{ id: 'openrouter/a/b', name: 'B', contextLength: 1, pricing: null }];
    const handlers = registerWithFakes({ catalogInfo: { models: rows, fetchedAt: 42 } });
    expect(await handlers['sidecar:get-catalog']({})).toEqual({ models: rows, fetchedAt: 42 });
  });

  it('sidecar:get-catalog degrades to empty on error', async () => {
    jest.resetModules();
    jest.doMock('../../src/utils/model-catalog', () => ({
      getCatalogInfo: jest.fn(async () => { throw new Error('boom'); }),
      refreshCatalog: jest.fn(),
    }));
    const handlers = {};
    const { registerSetupHandlers } = require('../../electron/ipc-setup');
    registerSetupHandlers({ handle: (n, f) => { handlers[n] = f; } }, () => null);
    expect(await handlers['sidecar:get-catalog']({})).toEqual({ models: [], fetchedAt: null });
  });

  it('sidecar:refresh-catalog forces a refresh and returns the fresh info', async () => {
    const rows = [{ id: 'openrouter/a/b', name: 'B', contextLength: null, pricing: null }];
    const refresh = jest.fn(async () => rows);
    const handlers = registerWithFakes({
      catalogInfo: { models: rows, fetchedAt: 99 }, refreshImpl: refresh
    });
    const res = await handlers['sidecar:refresh-catalog']({});
    expect(refresh).toHaveBeenCalled();
    expect(res).toEqual({ models: rows, fetchedAt: 99 });
  });

  it('sidecar:save-key fires a warm catalog refresh after a successful save', async () => {
    const refresh = jest.fn(async () => []);
    const handlers = registerWithFakes({ refreshImpl: refresh });
    await handlers['sidecar:save-key']({}, 'openrouter', 'sk-x');
    // fire-and-forget via setImmediate — flush it
    await new Promise(r => setImmediate(r));
    expect(refresh).toHaveBeenCalled();
  });

  it('sidecar:save-key does NOT refresh when the save failed', async () => {
    const refresh = jest.fn(async () => []);
    const handlers = registerWithFakes({
      refreshImpl: refresh, saveImpl: jest.fn(() => ({ success: false, error: 'nope' }))
    });
    await handlers['sidecar:save-key']({}, 'openrouter', 'bad');
    await new Promise(r => setImmediate(r));
    expect(refresh).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/electron/ipc-catalog.test.js`
Expected: FAIL — handlers `sidecar:get-catalog`/`sidecar:refresh-catalog` undefined; save-key never refreshes.

- [ ] **Step 3: Implement in `electron/ipc-setup.js`**

Replace the `sidecar:save-key` handler body (lines 28-36) with:

```js
  ipcMain.handle('sidecar:save-key', async (_event, provider, key) => {
    try {
      const { saveApiKey } = require('../src/utils/api-key-store');
      const result = saveApiKey(provider, key);
      // F5: warm the model catalog as soon as a key lands so the Step 2
      // picker renders instantly. Fire-and-forget; failures are silent
      // (Step 2's get-catalog will retry via its own getCatalogInfo()).
      if (result && result.success !== false) {
        setImmediate(() => {
          try {
            require('../src/utils/model-catalog').refreshCatalog().catch(() => {});
          } catch { /* best-effort */ }
        });
      }
      return result;
    } catch (err) {
      logger.error('save-key handler error', { error: err.message });
      return { success: false, error: err.message };
    }
  });
```

Add after the `sidecar:fetch-models` handler (line ~137):

```js
  // F5: wizard Step 2 reads the catalog CACHE (self-refreshing when stale).
  ipcMain.handle('sidecar:get-catalog', async () => {
    try {
      const { getCatalogInfo } = require('../src/utils/model-catalog');
      return await getCatalogInfo();
    } catch (err) {
      logger.error('get-catalog handler error', { error: err.message });
      return { models: [], fetchedAt: null };
    }
  });

  ipcMain.handle('sidecar:refresh-catalog', async () => {
    try {
      const { refreshCatalog, getCatalogInfo } = require('../src/utils/model-catalog');
      await refreshCatalog();
      return await getCatalogInfo();
    } catch (err) {
      logger.error('refresh-catalog handler error', { error: err.message });
      return { models: [], fetchedAt: null };
    }
  });
```

Update the file's header comment to list the new handlers.

- [ ] **Step 4: Run tests + full suite**

Run: `npx jest tests/electron/ipc-catalog.test.js` → PASS.
Run: `npm test` → 0 fail.

- [ ] **Step 5: Commit**

```bash
git add electron/ipc-setup.js tests/electron/ipc-catalog.test.js
git commit -m "feat(f5): catalog IPC (get/refresh) + warm seed on key save"
```

---

### Task 7: Wizard Step 2 — searchable live picker

**Files:**
- Modify: `electron/setup-ui-model.js` (add `buildModelSearchHTML`)
- Modify: `electron/setup-ui.js` (render search section; page JS: load catalog on step entry, filter, select, refresh; finish honors custom selection)
- Create: `tests/electron/setup-ui-model-search.test.js`

The page JS runs in the wizard's data: URL document — all dynamic behavior goes through string-built JS (existing pattern). HTML builders stay pure and unit-tested; page behavior is verified live via CDP in Task 10.

- [ ] **Step 1: Write the failing test**

`tests/electron/setup-ui-model-search.test.js`:

```js
/** F5: search-section HTML builder + step HTML embeds it when the catalog may exist. */
const { buildModelSearchHTML, buildModelStepHTML, MODEL_CHOICES } =
  require('../../electron/setup-ui-model');

describe('buildModelSearchHTML', () => {
  it('renders the search input, results container and refresh control', () => {
    const html = buildModelSearchHTML();
    expect(html).toContain('id="model-search-input"');
    expect(html).toContain('id="model-search-results"');
    expect(html).toContain('id="model-search-refresh"');
    expect(html).toContain('id="model-search-section"');
    // hidden until the page JS confirms a non-empty catalog
    expect(html).toContain('style="display:none"');
  });
});

describe('buildModelStepHTML embeds the search section', () => {
  it('includes the search section after the quick-pick cards', () => {
    const html = buildModelStepHTML(MODEL_CHOICES);
    const cards = html.indexOf('model-list');
    const search = html.indexOf('model-search-section');
    expect(cards).toBeGreaterThan(-1);
    expect(search).toBeGreaterThan(cards);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/electron/setup-ui-model-search.test.js`
Expected: FAIL — `buildModelSearchHTML` not exported.

- [ ] **Step 3: Implement `buildModelSearchHTML` in `electron/setup-ui-model.js`**

Add before `buildModelStepHTML`:

```js
/**
 * Search-over-catalog section (F5). Hidden until the wizard script confirms
 * a non-empty catalog; rows are rendered client-side from the get-catalog IPC.
 * @returns {string} HTML fragment
 */
function buildModelSearchHTML() {
  return `<div id="model-search-section" style="display:none">
      <div class="search-head">
        <input type="text" id="model-search-input" placeholder="Search all models (id or name)..." autocomplete="off">
        <button class="icon-btn" id="model-search-refresh" title="Refresh catalog">&#x21bb;</button>
      </div>
      <div id="model-search-meta" class="search-meta"></div>
      <div id="model-search-results" class="search-results"></div>
    </div>`;
}
```

In `buildModelStepHTML`, change the return to include it after the card list:

```js
  return `<div class="step-content">
    <h1>Choose Default Model</h1>
    <p class="subtitle">Pick the model to use when no --model flag is given.</p>

    <div class="model-list" id="model-list">
      ${cards}
    </div>
    ${buildModelSearchHTML()}
  </div>`;
```

Export `buildModelSearchHTML` in module.exports.

- [ ] **Step 4: Run the new test → PASS**

Run: `npx jest tests/electron/setup-ui-model-search.test.js` → PASS.

- [ ] **Step 5: Wire the page behavior in `electron/setup-ui.js`**

(a) In `showStep` (line ~143), extend the step-2 branch:

```js
    if (step === 2) { updateRoutingPills(); ensureCatalogLoaded(); }
```

(b) Add to the wizard script (inside `buildWizardScript`'s template, after the `fetchAvailableModels` function around line 360):

```js
  // ===== F5: searchable catalog picker (Step 2) =====
  var catalogRows = null, catalogFetchedAt = null;
  window.customDefaultModel = null;

  async function ensureCatalogLoaded() {
    if (catalogRows) { return; }
    try {
      var info = await window.sidecarSetup.invoke('sidecar:get-catalog');
      applyCatalog(info);
    } catch (_e) {}
  }

  function applyCatalog(info) {
    catalogRows = (info && info.models) || [];
    catalogFetchedAt = info && info.fetchedAt;
    var section = $('model-search-section');
    if (!section) { return; }
    section.style.display = catalogRows.length > 0 ? '' : 'none';
    renderSearchMeta();
    renderSearchResults();
  }

  function renderSearchMeta() {
    var meta = $('model-search-meta');
    if (!meta) { return; }
    var when = catalogFetchedAt ? new Date(catalogFetchedAt).toLocaleString() : 'never';
    meta.textContent = catalogRows.length + ' models \\u00b7 catalog fetched ' + when;
  }

  function fmtCtx(n) { return n == null ? '' : ' \\u00b7 ctx ' + n; }
  function fmtPrice(p) {
    if (!p || p.prompt == null) { return ''; }
    var x = Number(p.prompt) * 1e6;
    return isNaN(x) ? '' : ' \\u00b7 $' + x.toFixed(2) + '/M in';
  }

  function renderSearchResults() {
    var box = $('model-search-results');
    if (!box) { return; }
    var q = ($('model-search-input').value || '').toLowerCase();
    var rows = !q ? [] : catalogRows.filter(function(m) {
      return m.id.toLowerCase().indexOf(q) !== -1 || (m.name || '').toLowerCase().indexOf(q) !== -1;
    }).slice(0, 50);
    box.innerHTML = '';
    rows.forEach(function(m) {
      var div = document.createElement('div');
      div.className = 'search-row' + (window.customDefaultModel === m.id ? ' selected' : '');
      div.setAttribute('data-model-id', m.id);
      var title = document.createElement('div');
      title.className = 'search-row-id';
      title.textContent = m.id;
      var sub = document.createElement('div');
      sub.className = 'search-row-sub';
      sub.textContent = (m.name || '') + fmtCtx(m.contextLength) + fmtPrice(m.pricing);
      div.appendChild(title); div.appendChild(sub);
      div.addEventListener('click', function() { selectCustomModel(m.id); });
      box.appendChild(div);
    });
    if (q && rows.length === 0) {
      box.textContent = 'No models match "' + q + '"';
    }
  }

  function selectCustomModel(id) {
    window.customDefaultModel = id;
    document.querySelectorAll('input[name="default-model"]').forEach(function(r) { r.checked = false; });
    renderSearchResults();
  }

  document.addEventListener('input', function(e) {
    if (e.target && e.target.id === 'model-search-input') { renderSearchResults(); }
  });
  document.addEventListener('change', function(e) {
    if (e.target && e.target.name === 'default-model' && e.target.checked) {
      window.customDefaultModel = null; // a quick-pick card wins back
      renderSearchResults();
    }
  });
  document.addEventListener('click', async function(e) {
    if (e.target && e.target.id === 'model-search-refresh') {
      e.target.disabled = true;
      try {
        var info = await window.sidecarSetup.invoke('sidecar:refresh-catalog');
        applyCatalog(info);
      } catch (_e2) {}
      e.target.disabled = false;
    }
  });
```

(c) In the finish handler (line ~335), the default-model line becomes:

```js
      var r = document.querySelector('input[name="default-model"]:checked');
      var dm = window.customDefaultModel || (r ? r.value : 'gemini');
```

(d) In `buildReview` (line ~297), the model line becomes:

```js
    var r = document.querySelector('input[name="default-model"]:checked');
    document.getElementById('review-model').textContent =
      window.customDefaultModel || (r ? r.value : 'Not selected');
```

(e) Styles — append to the CSS in `electron/setup-ui-styles.js` (inside the existing style string; match its formatting):

```css
  .search-head { display: flex; gap: 8px; margin: 18px 0 8px; }
  #model-search-input { flex: 1; background: #1F1D1C; color: #D4D0CC; border: 1px solid #3D3A38; border-radius: 6px; padding: 8px 10px; font-size: 13px; }
  .search-meta { color: #7A756F; font-size: 11px; margin-bottom: 6px; }
  .search-results { max-height: 220px; overflow-y: auto; border: 1px solid #3D3A38; border-radius: 6px; }
  .search-results:empty { border: none; }
  .search-row { padding: 8px 10px; cursor: pointer; border-bottom: 1px solid #2D2B2A; }
  .search-row:hover { background: #34312F; }
  .search-row.selected { background: #4A3328; outline: 1px solid #D97757; }
  .search-row-id { color: #D4D0CC; font-size: 12px; font-family: 'SF Mono', Menlo, Consolas, monospace; }
  .search-row-sub { color: #A09B96; font-size: 11px; margin-top: 2px; }
```

Note: a full-id default (e.g. `openrouter/x-ai/grok-4.3`) needs NO backend change — `sidecar:save-config` stores it in `config.default`, and `resolveModel` passes ids containing `/` straight through (config.js:134).

- [ ] **Step 6: Run the wizard-related suites + full suite**

Run: `npx jest tests/electron tests/sidecar/setup-window.test.js` → PASS (existing setup-ui tests must not break: `buildSetupHTML` still composes; if a test snapshot pins the Step 2 HTML, update it for the appended search section).
Run: `npm test` → 0 fail.

- [ ] **Step 7: Commit**

```bash
git add electron/setup-ui-model.js electron/setup-ui.js electron/setup-ui-styles.js tests/electron/setup-ui-model-search.test.js
git commit -m "feat(f5): searchable live picker in wizard Step 2 (catalog-fed, client-side filter)"
```

---

### Task 8: Seeding in readline + interactive setup; `--add-alias` catalog warning

**Files:**
- Modify: `src/sidecar/setup.js` (seed in both flows)
- Modify: `src/cli-handlers.js:31-47` (--add-alias warn)
- Create: `tests/sidecar/setup-seeding.test.js`

- [ ] **Step 1: Write the failing test**

`tests/sidecar/setup-seeding.test.js`:

```js
/** F5: setup seeds the catalog; --add-alias warns (never blocks) on unknown models. */

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));

describe('seedCatalog', () => {
  it('refreshes and reports the count', async () => {
    jest.resetModules();
    const refresh = jest.fn(async () => [{ id: 'openrouter/a/b', name: 'B' }]);
    jest.doMock('../../src/utils/model-catalog', () => ({ refreshCatalog: refresh }));
    const { seedCatalog } = require('../../src/sidecar/setup');
    const lines = [];
    await seedCatalog((s) => lines.push(s));
    expect(refresh).toHaveBeenCalled();
    expect(lines.join('\n')).toContain('Model catalog seeded (1 models)');
  });

  it('reports offline gracefully and never throws', async () => {
    jest.resetModules();
    jest.doMock('../../src/utils/model-catalog', () => ({
      refreshCatalog: jest.fn(async () => { throw new Error('net down'); })
    }));
    const { seedCatalog } = require('../../src/sidecar/setup');
    const lines = [];
    await expect(seedCatalog((s) => lines.push(s))).resolves.toBeUndefined();
    expect(lines.join('\n')).toContain('Model catalog unavailable');
  });
});

describe('--add-alias catalog warning', () => {
  function runAddAlias({ catalog }) {
    jest.resetModules();
    jest.doMock('../../src/sidecar/setup', () => ({
      addAlias: jest.fn(), runInteractiveSetup: jest.fn(), runApiKeySetup: jest.fn(),
    }));
    jest.doMock('../../src/utils/model-catalog', () => ({
      getCatalog: jest.fn(async () => catalog),
    }));
    const { handleSetup } = require('../../src/cli-handlers');
    const warnings = [];
    const orig = console.warn;
    console.warn = (s) => warnings.push(String(s));
    return handleSetup({ 'add-alias': 'grok=openrouter/x-ai/grok-9.9' })
      .finally(() => { console.warn = orig; })
      .then(() => warnings.join('\n'));
  }

  it('warns when the model is absent from a populated openrouter catalog', async () => {
    const out = await runAddAlias({ catalog: [{ id: 'openrouter/x-ai/grok-4.3', name: 'G' }] });
    expect(out).toContain('not found in the model catalog');
    expect(out).toContain('amicus models --search');
  });

  it('stays silent when the catalog is empty (cannot check)', async () => {
    const out = await runAddAlias({ catalog: [] });
    expect(out).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/sidecar/setup-seeding.test.js`
Expected: FAIL — `seedCatalog` not exported; no warning emitted.

- [ ] **Step 3: Implement**

`src/sidecar/setup.js` — add (above `runReadlineSetup`):

```js
/**
 * Seed/refresh the model catalog (F5). Never throws — setup must complete offline.
 * @param {(line: string) => void} [print] - defaults to console.log
 */
async function seedCatalog(print) {
  const log = print || console.log;
  try {
    const { refreshCatalog } = require('../utils/model-catalog');
    const models = await refreshCatalog();
    if (models.length > 0) {
      log(`Model catalog seeded (${models.length} models).`);
      return;
    }
  } catch (err) {
    logger.debug('Catalog seed failed', { error: err.message });
  }
  log('Model catalog unavailable (offline?) — it will refresh on first start.');
}
```

Call it in `runReadlineSetup` right after each `createDefaultConfig(...)` call (both the invalid-choice branch line ~184 and the chosen branch line ~192): `await seedCatalog();`

Call it in `runInteractiveSetup` inside the `if (result.success) {` block (after the config-ensure logic, before the console summary): `await seedCatalog();` — by wizard-close the save-key warm refresh has usually landed; this is the deterministic guarantee.

Export `seedCatalog` from module.exports.

`src/cli-handlers.js` — in `handleSetup`, after `addAlias(name, model); console.log(...)` (line ~45), add:

```js
    // F5: warn (never block) when the model is absent from a checkable catalog.
    try {
      const { getCatalog } = require('./utils/model-catalog');
      const catalog = await getCatalog();
      const provider = model.split('/')[0];
      const checkable = catalog.some(m => m.id.startsWith(provider + '/'));
      if (checkable && !catalog.some(m => m.id === model)) {
        console.warn(
          `Warning: '${model}' not found in the model catalog. ` +
          `Double-check with: amicus models --search ${model.split('/').pop()}`
        );
      }
    } catch { /* warn-only path */ }
```

- [ ] **Step 4: Run tests + full suite**

Run: `npx jest tests/sidecar/setup-seeding.test.js` → PASS.
Run: `npm test` → 0 fail (existing setup tests stay green — `seedCatalog` failures are swallowed; tests that run `runReadlineSetup` with mocked readline will hit the catalog module: if any do, add the same `jest.doMock('../../src/utils/model-catalog', ...)` stub to them).

- [ ] **Step 5: Commit**

```bash
git add src/sidecar/setup.js src/cli-handlers.js tests/sidecar/setup-seeding.test.js
git commit -m "feat(f5): setup seeds the catalog (both flows); --add-alias warns on unknown models"
```

---

### Task 9: CLI `continue`/`resume` validation

**Files:**
- Modify: `src/utils/model-validator.js` (add `warnIfNotInCatalog`)
- Modify: `bin/amicus.js` `handleContinue` (explicit `--model` → blocking pipeline)
- Modify: `src/sidecar/continue.js:133` area (inherited model → warn-only)
- Modify: `src/sidecar/resume.js` (~line 144 area, after metadata load → warn-only)
- Create: `tests/sidecar/continue-resume-validation.test.js`

Policy (spec 4.8, refined): an **explicitly passed** `--model` gets the exact `start` pipeline (resolve alias → validate → exit-with-fix-text on stale; `--no-validate-model` honored). An **inherited** model (continue without `--model`; resume always) gets a non-blocking warning — the session already ran with it, and blocking a reopen on a stale cache would be hostile.

- [ ] **Step 1: Write the failing test**

`tests/sidecar/continue-resume-validation.test.js`:

```js
/** F5: continue --model validates like start; inherited models warn, never block. */

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));

describe('warnIfNotInCatalog', () => {
  function load({ catalog }) {
    jest.resetModules();
    jest.doMock('../../src/utils/model-catalog', () => ({
      getCatalog: jest.fn(async () => catalog),
    }));
    return require('../../src/utils/model-validator');
  }

  it('writes a warning to stderr for a stale openrouter model', async () => {
    const { warnIfNotInCatalog } = load({
      catalog: [{ id: 'openrouter/x-ai/grok-4.3', name: 'G' }]
    });
    const writes = [];
    const orig = process.stderr.write;
    process.stderr.write = (s) => { writes.push(String(s)); return true; };
    try {
      await warnIfNotInCatalog('openrouter/x-ai/grok-4.1-fast');
    } finally { process.stderr.write = orig; }
    const out = writes.join('');
    expect(out).toContain('grok-4.1-fast');
    expect(out).toContain('amicus models --check');
  });

  it('is silent for a valid model, an empty catalog, and non-openrouter models', async () => {
    const cases = [
      { catalog: [{ id: 'openrouter/x-ai/grok-4.3', name: 'G' }], model: 'openrouter/x-ai/grok-4.3' },
      { catalog: [], model: 'openrouter/x-ai/grok-4.1-fast' },
      { catalog: [{ id: 'openrouter/x-ai/grok-4.3', name: 'G' }], model: 'google/gemini-3.1-pro-preview' },
    ];
    for (const c of cases) {
      const { warnIfNotInCatalog } = load({ catalog: c.catalog });
      const writes = [];
      const orig = process.stderr.write;
      process.stderr.write = (s) => { writes.push(String(s)); return true; };
      try { await warnIfNotInCatalog(c.model); } finally { process.stderr.write = orig; }
      expect(writes.join('')).toBe('');
    }
  });

  it('never throws even if the catalog read explodes', async () => {
    jest.resetModules();
    jest.doMock('../../src/utils/model-catalog', () => ({
      getCatalog: jest.fn(async () => { throw new Error('disk'); }),
    }));
    const { warnIfNotInCatalog } = require('../../src/utils/model-validator');
    await expect(warnIfNotInCatalog('openrouter/a/b')).resolves.toBeUndefined();
  });
});

describe('wiring (source guards)', () => {
  const fs = require('fs');
  const path = require('path');

  it('handleContinue resolves+validates an explicit --model like start', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'bin', 'amicus.js'), 'utf-8');
    const handler = src.slice(src.indexOf('async function handleContinue'), src.indexOf('async function handleRead'));
    expect(handler).toMatch(/resolveModelFromArgs/);
    expect(handler).toMatch(/validateFallbackModel/);
  });

  it('continueSidecar and resumeSidecar warn on inherited models', () => {
    const cont = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'sidecar', 'continue.js'), 'utf-8');
    const res = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'sidecar', 'resume.js'), 'utf-8');
    expect(cont).toMatch(/warnIfNotInCatalog/);
    expect(res).toMatch(/warnIfNotInCatalog/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/sidecar/continue-resume-validation.test.js`
Expected: FAIL — `warnIfNotInCatalog` undefined; source guards unmatched.

- [ ] **Step 3: Implement**

`src/utils/model-validator.js` — add before module.exports, and export it:

```js
/**
 * Non-blocking advisory check for inherited models (F5: continue/resume).
 * Same catalog logic as validateAgainstCatalog, but warns on stderr instead
 * of throwing — a session that already ran with this model must stay openable.
 * @param {string} model
 */
async function warnIfNotInCatalog(model) {
  try {
    await validateAgainstCatalog(model);
  } catch (err) {
    process.stderr.write(
      `Warning: ${String(err.message).split('\n')[0]} ` +
      '(continuing anyway — run \'amicus models --check\' to review aliases)\n'
    );
  }
}
```

`bin/amicus.js` `handleContinue` — after the `--prompt` requirement check (line ~319), add:

```js
  // F5: an explicitly passed --model gets the same resolution+validation as start.
  if (args.model !== undefined) {
    const { model, alias } = resolveModelFromArgs(args);
    args.model = model;
    args.model = await validateFallbackModel(args, alias);
  }
```

(`resolveModelFromArgs`/`validateFallbackModel` are already imported at bin/amicus.js:16.)

`src/sidecar/continue.js` — after `const model = options.model || oldMetadata.model;` (line 133), add:

```js
  if (!options.model) {
    // Inherited model: advisory only (F5) — never block reopening a session.
    const { warnIfNotInCatalog } = require('../utils/model-validator');
    await warnIfNotInCatalog(model);
  }
```

`src/sidecar/resume.js` — right after the `logger.info('Resuming session', ...)` line (~144), add:

```js
    // Inherited model: advisory only (F5) — never block reopening a session.
    const { warnIfNotInCatalog } = require('../utils/model-validator');
    await warnIfNotInCatalog(metadata.model);
```

- [ ] **Step 4: Run tests + full suite**

Run: `npx jest tests/sidecar/continue-resume-validation.test.js` → PASS.
Run: `npm test` → 0 fail (continue/resume unit suites mock at module boundaries; if any existing continue/resume test now hits the real model-catalog (network), stub it with `jest.doMock('../../src/utils/model-catalog', () => ({ getCatalog: async () => [] }))` — empty catalog = silent no-op path).

- [ ] **Step 5: Commit**

```bash
git add src/utils/model-validator.js bin/amicus.js src/sidecar/continue.js src/sidecar/resume.js tests/sidecar/continue-resume-validation.test.js
git commit -m "feat(f5): continue/resume catalog validation — blocking for explicit --model, advisory for inherited"
```

---

### Task 10: Full verification, live e2e, spec banner

**Files:**
- Modify: `docs/superpowers/specs/2026-06-10-f5-dynamic-model-catalog-design.md` (status banner)

- [ ] **Step 1: Full suite + lint**

Run: `npm test` → expect ~1830+ tests, 0 fail, 4 skip (record exact numbers).
Run: `npm run lint` → clean.

- [ ] **Step 2: Live CLI e2e (network + keys present on this machine)**

```powershell
node bin/amicus.js models --refresh          # several hundred models
node bin/amicus.js models --search grok      # rows with ctx + $/Mtok
node bin/amicus.js models --check; "EXIT: $LASTEXITCODE"   # expect clean exit 0 (fix curated ids if not)
node bin/amicus.js models --json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const d=JSON.parse(s);console.log(d.type,d.count)})"
```

Expected: `model-catalog <count>`.

- [ ] **Step 3: Live wizard e2e via CDP (GUI verified working on this machine — PR #6 era recipe)**

```powershell
$env:LOG_LEVEL='debug'
node bin/amicus.js setup 2> $env:TEMP\f5-wizard-stderr.log
```

(run backgrounded). Then, against the DevTools port (setup window spawns with remote debugging — check `src/sidecar/setup-window.js` spawn args; if it lacks `--remote-debugging-port`, relaunch with `$env:AMICUS_DEBUG_PORT='9224'` or drive visually via screenshot tools):

1. Confirm the window appears (`Get-Process electron | Select MainWindowTitle` → "… Setup").
2. CDP `Runtime.evaluate`: enter a key… (skip if keys exist — wizard imports them), navigate to Step 2, evaluate `document.getElementById('model-search-section').style.display` → not `'none'`.
3. Evaluate: `document.getElementById('model-search-input').value='grok'; document.getElementById('model-search-input').dispatchEvent(new Event('input',{bubbles:true})); document.querySelectorAll('.search-row').length` → > 0.
4. Click the first row via `document.querySelector('.search-row').click()`; evaluate `window.customDefaultModel` → `openrouter/x-ai/grok-4.3` (or similar).
5. Finish the wizard; verify `~/.config/amicus/config.json` has `"default": "<that full id>"` and `model-catalog.json` exists with `schemaVersion: 2`.
6. Screenshot the Step 2 search state (`Page.captureScreenshot`) for the record.

- [ ] **Step 4: Real session with a picker-chosen default**

```powershell
node bin/amicus.js start --no-ui --prompt "Reply with exactly: F5 e2e OK" --timeout 3
```

Expected: completes with the summary containing `F5 e2e OK`, using the config default set in Step 3 (restore the user's previous default afterwards: `amicus setup --add-alias` is not needed — just re-write `config.default` to its prior value if it was changed by the test).

- [ ] **Step 5: Update the spec status banner**

In `docs/superpowers/specs/2026-06-10-f5-dynamic-model-catalog-design.md`, change frontmatter `status:` to `implemented (2026-06-XX — suite <counts>, lint clean, live CLI+wizard e2e passed)` and add a `> **Implemented …**` banner block after the H1 summarizing what shipped (follow the F4 spec's banner format).

- [ ] **Step 6: Final commit**

```bash
git add docs/superpowers/specs/2026-06-10-f5-dynamic-model-catalog-design.md
git commit -m "docs(f5): mark dynamic-model-catalog spec implemented"
```

---

## Out of scope (tracked follow-ups — do NOT implement)

- MCP `amicus_models` tool (council skill shells out to `models --json`).
- Migrating Step 3's alias editor off `sidecar:fetch-models` onto the catalog.
- README/docs refresh (F7); MODEL-NOTES stale-GUI claim (council-skill rewrite follow-up).
- Auto-repair of stale aliases (explicitly rejected — report+suggest only).
- The F2f-skipped provider-sync test (`it.skip` TODO(F4/F5) — config/env-dependent; revisit when the council skill consumes the catalog).
