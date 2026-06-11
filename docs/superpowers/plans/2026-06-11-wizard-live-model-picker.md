# Wizard Live Model Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Step 2 of the setup wizard offers live-resolved quick picks plus an always-visible full-catalog search, and Finish writes only the default plus explicitly touched aliases (read-modify-write — never clobbering untouched user aliases).

**Architecture:** `curated-models.js` becomes family definitions with pinned fallbacks; a new `quick-picks.js` resolves each family against the catalog cache (numeric-desc ranking, marker-suffix loses only within the same version). `createSetupWindow` resolves picks in the main process at window build and injects them where static `MODEL_CHOICES` is injected today (no new IPC — spec §3 as amended). `sidecar:save-config` becomes read-modify-write over `{default, aliasWrites}`. The readline flow gets the same picks, a free-form model-id path, and the same no-clobber save.

**Tech Stack:** Node CJS, Electron 28 (renderer script is an injected template string — ES5-style, `var`), Jest (electron mocked `{virtual: true}` per the F2e pattern), CDP for e2e.

**Spec:** `docs/superpowers/specs/2026-06-11-wizard-live-model-picker-design.md` (incl. 2026-06-11 amendments)
**Branch:** `fix/wizard-live-model-picker` (collect-locally: NO push, NO PR, NO version bump)
**Baseline:** suite 1900 pass / 4 skip / 0 fail (120 suites), lint clean. Execute in a git worktree (superpowers:using-git-worktrees); hooks fire in worktrees since PR #9.

**Conventions that bite:**
- Run tests with `npx jest <file> -v` from the repo root; full gate is `npm test`.
- Pre-commit: lint-staged (eslint --fix on staged `src/**/*.js`), 300-line file-size gate (new files must stay <300 lines), CLAUDE.md marker regen (may auto-stage CLAUDE.md — that's normal).
- The wizard renderer (`electron/setup-ui.js` `buildWizardScript`) is a TEMPLATE STRING: code inside is ES5-style `var` JS with `\\u` escapes; backticks/`${}` inside it are interpolated by Node — keep new renderer code free of backticks.
- Catalog rows are `{id, name, contextLength, pricing}`; ids are namespaced: `openrouter/<vendor>/<model>` for OpenRouter rows AND bare `<provider>/<model>` for direct-provider rows (e.g. `google/gemini-3.5-flash`, `deepseek/deepseek-v4-pro`).

---

### Task 1: curated-models v2 — FAMILIES + refreshed pinned ids

**Files:**
- Modify: `src/utils/curated-models.js` (full rewrite, stays well under 300 lines)
- Create: `tests/curated-models.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/curated-models.test.js
'use strict';

const {
  getFamilies, toDefaultAliases, listCuratedRoutes
} = require('../src/utils/curated-models');

describe('curated-models v2 (families)', () => {
  test('getFamilies returns the five wizard families with required fields', () => {
    const fams = getFamilies();
    expect(fams.map(f => f.alias)).toEqual(['gemini', 'gemini-pro', 'gpt', 'opus', 'deepseek']);
    for (const f of fams) {
      expect(typeof f.label).toBe('string');
      expect(typeof f.blurb).toBe('string');
      expect(typeof f.vendorPath).toBe('string');
      expect(f.idPattern instanceof RegExp).toBe(true);
      expect(Array.isArray(f.directProviders)).toBe(true);
      expect(typeof f.fallback.openrouter).toBe('string');
    }
  });

  test('getFamilies returns fresh copies (no shared mutable state)', () => {
    const a = getFamilies();
    a[0].fallback.openrouter = 'mutated';
    expect(getFamilies()[0].fallback.openrouter).not.toBe('mutated');
  });

  test('toDefaultAliases stays static and covers families + cardless', () => {
    const defaults = toDefaultAliases();
    expect(defaults.gemini).toBe('openrouter/google/gemini-3.5-flash');
    expect(defaults.opus).toBe('openrouter/anthropic/claude-opus-4.8');
    expect(defaults.deepseek).toBe('openrouter/deepseek/deepseek-v4-pro');
    expect(defaults.qwen).toBe('openrouter/qwen/qwen3.7-max');
    expect(defaults.kimi).toBe('openrouter/moonshotai/kimi-k2.6');
  });

  test('listCuratedRoutes flattens family fallbacks and cardless routes', () => {
    const routes = listCuratedRoutes();
    expect(routes).toContainEqual(
      { alias: 'deepseek', provider: 'deepseek', model: 'deepseek/deepseek-chat' });
    expect(routes).toContainEqual(
      { alias: 'gemini', provider: 'openrouter', model: 'openrouter/google/gemini-3.5-flash' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/curated-models.test.js -v`
Expected: FAIL — `getFamilies is not a function` (module currently exports `getCuratedModels`).

- [ ] **Step 3: Rewrite the module**

Replace the whole body of `src/utils/curated-models.js`:

```js
/**
 * Curated Models — family definitions + pinned fallbacks (v2).
 *
 * Families are MATCH RULES over the live catalog, not pinned truths:
 * src/utils/quick-picks.js resolves each family to the current catalog
 * flagship at setup time. The pinned `fallback` ids are used only when
 * the catalog cannot resolve a route (offline / unkeyed provider) and to
 * derive the static DEFAULT_ALIASES (runtime alias resolution must never
 * wait on the network). `amicus models --check` audits every pinned route
 * here against the live catalog AND warns when a fallback falls behind
 * the live resolution.
 */

'use strict';

/**
 * Wizard quick-pick families. `idPattern` matches the model segment after
 * `<vendorPath>/` (openrouter ns) or `<provider>/` (direct ns).
 * Pinned ids verified against the live catalog 2026-06-11.
 */
const FAMILIES = [
  { alias: 'gemini', label: 'Gemini Flash-class', blurb: 'fast, large context',
    vendorPath: 'google',
    idPattern: /^gemini-[\d.]+-flash(-preview|-exp|-latest)?$/,
    directProviders: ['google'],
    fallback: { openrouter: 'openrouter/google/gemini-3.5-flash',
                google: 'google/gemini-3.5-flash' } },
  { alias: 'gemini-pro', label: 'Gemini Pro-class', blurb: 'advanced reasoning',
    vendorPath: 'google',
    idPattern: /^gemini-[\d.]+-pro(-preview|-exp|-latest)?$/,
    directProviders: ['google'],
    fallback: { openrouter: 'openrouter/google/gemini-3.1-pro-preview' } },
  { alias: 'gpt', label: 'GPT flagship', blurb: 'strong coding',
    vendorPath: 'openai',
    idPattern: /^gpt-[\d.]+$/,
    directProviders: ['openai'],
    fallback: { openrouter: 'openrouter/openai/gpt-5.5' } },
  { alias: 'opus', label: 'Claude Opus-class', blurb: 'deep analysis',
    vendorPath: 'anthropic',
    idPattern: /^claude-opus-[\d.-]+$/,
    directProviders: ['anthropic'],
    fallback: { openrouter: 'openrouter/anthropic/claude-opus-4.8',
                anthropic: 'anthropic/claude-opus-4-6' } },
  { alias: 'deepseek', label: 'DeepSeek flagship', blurb: 'open-source',
    vendorPath: 'deepseek',
    idPattern: /^deepseek-v[\d.]+(-pro)?$/,
    directProviders: ['deepseek'],
    fallback: { openrouter: 'openrouter/deepseek/deepseek-v4-pro',
                deepseek: 'deepseek/deepseek-chat' } },
];

/** Alias-only entries (no wizard quick pick); openrouter route only.
 *  Refreshed against the live catalog 2026-06-11. */
const CARDLESS = [
  { alias: 'gpt-pro', routes: { openrouter: 'openrouter/openai/gpt-5.5-pro' } },
  // codex: newest codex-specific model on OpenRouter (verified 2026-06-09).
  { alias: 'codex', routes: { openrouter: 'openrouter/openai/gpt-5.3-codex' } },
  { alias: 'claude', routes: { openrouter: 'openrouter/anthropic/claude-sonnet-4.6' } },
  { alias: 'sonnet', routes: { openrouter: 'openrouter/anthropic/claude-sonnet-4.6' } },
  { alias: 'haiku', routes: { openrouter: 'openrouter/anthropic/claude-haiku-4.5' } },
  { alias: 'qwen', routes: { openrouter: 'openrouter/qwen/qwen3.7-max' } },
  { alias: 'qwen-coder', routes: { openrouter: 'openrouter/qwen/qwen3-coder-next' } },
  { alias: 'qwen-flash', routes: { openrouter: 'openrouter/qwen/qwen3.6-flash' } },
  { alias: 'mistral', routes: { openrouter: 'openrouter/mistralai/mistral-medium-3-5' } },
  { alias: 'devstral', routes: { openrouter: 'openrouter/mistralai/devstral-2512' } },
  { alias: 'glm', routes: { openrouter: 'openrouter/z-ai/glm-5.1' } },
  { alias: 'minimax', routes: { openrouter: 'openrouter/minimax/minimax-m2.7' } },
  { alias: 'grok', routes: { openrouter: 'openrouter/x-ai/grok-4.3' } },
  { alias: 'kimi', routes: { openrouter: 'openrouter/moonshotai/kimi-k2.6' } },
  { alias: 'seed', routes: { openrouter: 'openrouter/bytedance-seed/seed-2.0-lite' } },
];

/** @returns {Array} deep-enough copies of the family definitions */
function getFamilies() {
  return FAMILIES.map(f => ({
    ...f,
    directProviders: [...f.directProviders],
    fallback: { ...f.fallback },
  }));
}

/** @returns {Object<string,string>} alias → pinned route (openrouter first). STATIC — runtime-safe. */
function toDefaultAliases() {
  const out = {};
  for (const f of FAMILIES) {
    out[f.alias] = f.fallback.openrouter || Object.values(f.fallback)[0];
  }
  for (const e of CARDLESS) {
    out[e.alias] = e.routes.openrouter || Object.values(e.routes)[0];
  }
  return out;
}

/** @returns {Array<{alias,provider,model}>} every pinned route, flattened (for the alias audit) */
function listCuratedRoutes() {
  const out = [];
  for (const f of FAMILIES) {
    for (const [provider, model] of Object.entries(f.fallback)) {
      out.push({ alias: f.alias, provider, model });
    }
  }
  for (const e of CARDLESS) {
    for (const [provider, model] of Object.entries(e.routes)) {
      out.push({ alias: e.alias, provider, model });
    }
  }
  return out;
}

module.exports = { getFamilies, toDefaultAliases, listCuratedRoutes };
```

NOTE: `getCuratedModels` is deliberately deleted. Its consumers are rewired in Tasks 4–6 (`electron/setup-ui-model.js`, `electron/setup-ui.js`, `src/sidecar/setup.js`) — expect their suites to fail until then; that is why Tasks 1–6 land as one branch.

- [ ] **Step 4: Verify pinned ids against the live catalog**

Run: `node bin/amicus.js models --search gpt-5.5` and `node bin/amicus.js models --search qwen3.7`
Expected: `openrouter/openai/gpt-5.5-pro` and `openrouter/qwen/qwen3.7-max` each appear. If `gpt-5.5-pro` is absent, keep `openrouter/openai/gpt-5.4-pro` for `gpt-pro` and adjust the Step-1 expectation accordingly.

- [ ] **Step 5: Run the new test**

Run: `npx jest tests/curated-models.test.js -v`
Expected: PASS (4 tests). `npx jest tests/setup-ui-model.test.js tests/setup-ui.test.js -v` will now FAIL on the missing `getCuratedModels` — expected until Tasks 5–6; do not fix here.

- [ ] **Step 6: Commit**

```bash
git add src/utils/curated-models.js tests/curated-models.test.js
git commit -m "feat(wizard): curated-models v2 — family match rules + refreshed pinned fallbacks"
```

---

### Task 2: quick-picks resolver

**Files:**
- Create: `src/utils/quick-picks.js`
- Create: `tests/quick-picks.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/quick-picks.test.js
'use strict';

const { compareIdsDesc, pickCurrent, resolveQuickPicks, toLiveSeedAliases } =
  require('../src/utils/quick-picks');

const row = id => ({ id, name: id, contextLength: 1, pricing: { prompt: '0' } });

describe('compareIdsDesc', () => {
  test('newer numeric version wins even when older is stable and newer is preview', () => {
    const ids = ['google/gemini-2.5-pro', 'google/gemini-3.1-pro-preview'];
    expect(ids.sort(compareIdsDesc)[0]).toBe('google/gemini-3.1-pro-preview');
  });
  test('within the same version the unmarked id beats its -preview variant', () => {
    const ids = ['google/gemini-3.5-flash-preview', 'google/gemini-3.5-flash'];
    expect(ids.sort(compareIdsDesc)[0]).toBe('google/gemini-3.5-flash');
  });
});

describe('pickCurrent', () => {
  const catalog = [
    row('openrouter/google/gemini-3.5-flash'),
    row('openrouter/google/gemini-3.5-flash-preview'),
    row('openrouter/google/gemini-3.1-flash-lite'),   // lite ≠ flash-class
    row('openrouter/google/gemini-3.1-flash-image'),  // image ≠ flash-class
    row('openrouter/google/gemini-2.5-flash'),
    row('google/gemini-3.5-flash'),
  ];
  const flash = /^gemini-[\d.]+-flash(-preview|-exp|-latest)?$/;

  test('resolves the newest matching id in the openrouter namespace', () => {
    expect(pickCurrent(catalog, 'openrouter/', 'google', flash))
      .toBe('openrouter/google/gemini-3.5-flash');
  });
  test('resolves the direct namespace independently', () => {
    expect(pickCurrent(catalog, '', 'google', flash)).toBe('google/gemini-3.5-flash');
  });
  test('returns null when nothing matches', () => {
    expect(pickCurrent(catalog, '', 'openai', /^gpt-[\d.]+$/)).toBeNull();
    expect(pickCurrent([], 'openrouter/', 'google', flash)).toBeNull();
    expect(pickCurrent(null, 'openrouter/', 'google', flash)).toBeNull();
  });
});

describe('resolveQuickPicks', () => {
  test('live rows carry source live and catalog-resolved routes', () => {
    const catalog = [
      row('openrouter/google/gemini-9.9-flash'),
      row('google/gemini-9.8-flash'),
    ];
    const gemini = resolveQuickPicks(catalog).find(r => r.alias === 'gemini');
    expect(gemini.source).toBe('live');
    expect(gemini.routes.openrouter).toBe('openrouter/google/gemini-9.9-flash');
    expect(gemini.routes.google).toBe('google/gemini-9.8-flash');
  });
  test('empty catalog falls back to pinned routes, source fallback', () => {
    const picks = resolveQuickPicks([]);
    expect(picks).toHaveLength(5);
    const deepseek = picks.find(r => r.alias === 'deepseek');
    expect(deepseek.source).toBe('fallback');
    expect(deepseek.routes.openrouter).toBe('openrouter/deepseek/deepseek-v4-pro');
    expect(deepseek.routes.deepseek).toBe('deepseek/deepseek-chat');
  });
  test('unresolvable direct namespace uses the pinned direct fallback', () => {
    const catalog = [row('openrouter/deepseek/deepseek-v9-pro')];
    const deepseek = resolveQuickPicks(catalog).find(r => r.alias === 'deepseek');
    expect(deepseek.source).toBe('live');
    expect(deepseek.routes.openrouter).toBe('openrouter/deepseek/deepseek-v9-pro');
    expect(deepseek.routes.deepseek).toBe('deepseek/deepseek-chat');
  });
});

describe('toLiveSeedAliases', () => {
  test('overlays live family openrouter routes on the static defaults', () => {
    const seeds = toLiveSeedAliases([row('openrouter/google/gemini-9.9-flash')]);
    expect(seeds.gemini).toBe('openrouter/google/gemini-9.9-flash');
    expect(seeds.qwen).toBe('openrouter/qwen/qwen3.7-max'); // cardless stays pinned
  });
  test('null/empty catalog returns the static defaults unchanged', () => {
    const { toDefaultAliases } = require('../src/utils/curated-models');
    expect(toLiveSeedAliases(null)).toEqual(toDefaultAliases());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/quick-picks.test.js -v`
Expected: FAIL — `Cannot find module '../src/utils/quick-picks'`.

- [ ] **Step 3: Implement the resolver**

```js
// src/utils/quick-picks.js
/**
 * Quick-pick resolution (wizard Step 2) — resolves each curated family to
 * the current catalog flagship. Setup-time only; runtime alias resolution
 * stays on the static DEFAULT_ALIASES (see curated-models.js).
 *
 * Ranking: numeric-descending over ids; a marker-suffixed variant
 * (-preview/-exp/-beta/-latest/:free) loses ONLY to its own unmarked base,
 * so gemini-3.1-pro-preview still beats the older stable gemini-2.5-pro.
 */

'use strict';

const { getFamilies, toDefaultAliases } = require('./curated-models');

const MARKER_RE = /(-preview|-exp|-beta|-latest|:free)$/;

/** Numeric-desc comparator; same-base marker variant sorts after its base. */
function compareIdsDesc(a, b) {
  const aBase = a.replace(MARKER_RE, '');
  const bBase = b.replace(MARKER_RE, '');
  if (aBase === bBase && a !== b) {
    if (a === aBase) { return -1; }
    if (b === bBase) { return 1; }
    return a.localeCompare(b, 'en', { numeric: true });
  }
  return b.localeCompare(a, 'en', { numeric: true });
}

/**
 * Newest catalog id under `<nsPrefix><vendorPath>/` whose model segment
 * matches idPattern. nsPrefix is 'openrouter/' or '' (direct rows).
 * @returns {string|null} full catalog id
 */
function pickCurrent(catalog, nsPrefix, vendorPath, idPattern) {
  const prefix = `${nsPrefix}${vendorPath}/`;
  const ids = (Array.isArray(catalog) ? catalog : [])
    .map(m => m && m.id)
    .filter(id => typeof id === 'string' && id.startsWith(prefix))
    .filter(id => idPattern.test(id.slice(prefix.length)));
  if (ids.length === 0) { return null; }
  return ids.sort(compareIdsDesc)[0];
}

/**
 * @param {Array<{id:string}>} catalog
 * @returns {Array<{alias,label,blurb,source:'live'|'fallback',routes:Object<string,string>}>}
 */
function resolveQuickPicks(catalog) {
  return getFamilies().map(f => {
    const routes = {};
    let live = false;
    const orPick = pickCurrent(catalog, 'openrouter/', f.vendorPath, f.idPattern);
    if (orPick) { routes.openrouter = orPick; live = true; }
    else if (f.fallback.openrouter) { routes.openrouter = f.fallback.openrouter; }
    for (const p of f.directProviders) {
      const direct = pickCurrent(catalog, '', p, f.idPattern);
      if (direct) { routes[p] = direct; live = true; }
      else if (f.fallback[p]) { routes[p] = f.fallback[p]; }
    }
    return { alias: f.alias, label: f.label, blurb: f.blurb, routes,
             source: live ? 'live' : 'fallback' };
  });
}

/**
 * Seed map for fresh configs: static defaults overlaid with live family
 * openrouter routes (cardless aliases stay pinned).
 * @returns {Object<string,string>}
 */
function toLiveSeedAliases(catalog) {
  const seeds = toDefaultAliases();
  for (const r of resolveQuickPicks(catalog || [])) {
    if (r.source === 'live' && r.routes.openrouter) { seeds[r.alias] = r.routes.openrouter; }
  }
  return seeds;
}

module.exports = { compareIdsDesc, pickCurrent, resolveQuickPicks, toLiveSeedAliases };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/quick-picks.test.js -v`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/quick-picks.js tests/quick-picks.test.js
git commit -m "feat(wizard): quick-picks resolver — live family resolution with pinned fallbacks"
```

---

### Task 3: save-config becomes read-modify-write (`aliasWrites`)

**Files:**
- Modify: `electron/ipc-setup.js:98-106` (the `sidecar:save-config` handler)
- Create: `tests/ipc-setup-save-config.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/ipc-setup-save-config.test.js
'use strict';

// Capture handlers registered on ipcMain (F2e virtual-mock pattern).
const handlers = {};
jest.mock('electron', () => ({
  ipcMain: { handle: (channel, fn) => { handlers[channel] = fn; } },
  BrowserWindow: { fromWebContents: jest.fn() },
}), { virtual: true });

jest.mock('../src/utils/config', () => ({
  loadConfig: jest.fn(),
  saveConfig: jest.fn(),
  getDefaultAliases: jest.fn(() => ({ gemini: 'pinned/gemini' })),
}));
jest.mock('../src/utils/quick-picks', () => ({
  toLiveSeedAliases: jest.fn(() => ({ gemini: 'live/gemini', qwen: 'live/qwen' })),
}));
jest.mock('../src/utils/model-catalog', () => ({
  getCatalog: jest.fn(async () => []),
}));

const { loadConfig, saveConfig } = require('../src/utils/config');
const { registerSetupHandlers } = require('../electron/ipc-setup');

beforeAll(() => { registerSetupHandlers(() => null); });
beforeEach(() => { jest.clearAllMocks(); });

const save = (...args) => handlers['sidecar:save-config']({}, ...args);

describe('sidecar:save-config (read-modify-write)', () => {
  test('REGRESSION (2026-06-11 gemini downgrade): untouched aliases are never rewritten', async () => {
    loadConfig.mockReturnValue({
      default: 'gemini',
      aliases: { gemini: 'google/gemini-3.5-flash', qwen: 'openrouter/qwen/qwen3.7-max' },
    });
    await save('deepseek', { deepseek: 'deepseek/deepseek-chat' });
    const written = saveConfig.mock.calls[0][0];
    expect(written.aliases.gemini).toBe('google/gemini-3.5-flash'); // untouched → byte-identical
    expect(written.aliases.qwen).toBe('openrouter/qwen/qwen3.7-max');
    expect(written.aliases.deepseek).toBe('deepseek/deepseek-chat');
    expect(written.default).toBe('deepseek');
  });

  test('null alias write deletes; deleted aliases do not resurrect', async () => {
    loadConfig.mockReturnValue({ default: 'gemini', aliases: { gemini: 'g', dead: 'x' } });
    await save('gemini', { dead: null });
    const written = saveConfig.mock.calls[0][0];
    expect(written.aliases).toEqual({ gemini: 'g' });
  });

  test('unknown config keys survive the round-trip', async () => {
    loadConfig.mockReturnValue({ default: 'gemini', aliases: {}, futureKey: { a: 1 } });
    await save('gemini', {});
    expect(saveConfig.mock.calls[0][0].futureKey).toEqual({ a: 1 });
  });

  test('null/missing default leaves the existing default alone', async () => {
    loadConfig.mockReturnValue({ default: 'gemini', aliases: {} });
    await save(null, {});
    expect(saveConfig.mock.calls[0][0].default).toBe('gemini');
  });

  test('first run (no config) seeds aliases live', async () => {
    loadConfig.mockReturnValue(null);
    await save('gemini', {});
    const written = saveConfig.mock.calls[0][0];
    expect(written.aliases).toEqual({ gemini: 'live/gemini', qwen: 'live/qwen' });
    expect(written.default).toBe('gemini');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/ipc-setup-save-config.test.js -v`
Expected: FAIL — first test gets `aliases.gemini === 'pinned/gemini'` (rebuild-from-defaults behavior) and the async seeding test fails.

- [ ] **Step 3: Replace the handler**

In `electron/ipc-setup.js`, replace the `sidecar:save-config` handler (currently lines 98-106) with:

```js
  // Read-modify-write: never rewrite an alias the renderer didn't send.
  // aliasWrites values: string = set, null = delete. First run seeds live.
  ipcMain.handle('sidecar:save-config', async (_event, defaultModel, aliasWrites) => {
    const { loadConfig, saveConfig } = require('../src/utils/config');
    let cfg = loadConfig();
    if (!cfg) {
      const { toLiveSeedAliases } = require('../src/utils/quick-picks');
      let catalog = [];
      try {
        catalog = await require('../src/utils/model-catalog').getCatalog();
      } catch (_err) { /* offline: pinned seeds */ }
      cfg = { aliases: toLiveSeedAliases(catalog) };
    }
    if (!cfg.aliases) { cfg.aliases = {}; }
    if (defaultModel) { cfg.default = defaultModel; }
    if (aliasWrites && typeof aliasWrites === 'object') {
      for (const [alias, model] of Object.entries(aliasWrites)) {
        if (model === null) { delete cfg.aliases[alias]; }
        else if (typeof model === 'string' && model) { cfg.aliases[alias] = model; }
      }
    }
    saveConfig(cfg);
    return { success: true };
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/ipc-setup-save-config.test.js -v`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/ipc-setup.js tests/ipc-setup-save-config.test.js
git commit -m "fix(wizard): save-config is read-modify-write — untouched aliases never rewritten"
```

---

### Task 4: Step-2 builders — resolved rows, write-preview, search always visible

**Files:**
- Modify: `electron/setup-ui-model.js`
- Modify: `tests/setup-ui-model.test.js` (update existing expectations + add new)

- [ ] **Step 1: Adjust/extend the tests**

In `tests/setup-ui-model.test.js`: replace any import/use of `MODEL_CHOICES` with a local fixture and add the new assertions. Keep existing structural tests (radio names, availability classes) — they operate on `buildModelStepHTML(choices, ...)` and still apply. Add:

```js
const PICKS = [
  { alias: 'gemini', label: 'Gemini Flash-class', blurb: 'fast, large context',
    source: 'live',
    routes: { openrouter: 'openrouter/google/gemini-3.5-flash', google: 'google/gemini-3.5-flash' } },
  { alias: 'deepseek', label: 'DeepSeek flagship', blurb: 'open-source',
    source: 'fallback',
    routes: { openrouter: 'openrouter/deepseek/deepseek-v4-pro' } },
];

describe('buildModelStepHTML (v2 rows)', () => {
  test('renders the resolved model id and a write-preview per row', () => {
    const html = buildModelStepHTML(PICKS, 'gemini', { openrouter: true, google: true });
    expect(html).toContain('openrouter/google/gemini-3.5-flash');
    expect(html).toContain('class="write-preview"');
    expect(html).toContain('data-alias="gemini"');
    expect(html).toContain('will set');
  });
  test('fallback rows carry the offline badge', () => {
    const html = buildModelStepHTML(PICKS, 'gemini', { openrouter: true });
    expect(html).toContain('class="pick-badge"');
    expect(html).toContain('offline list');
  });
  test('search section has no display:none gating and is labeled', () => {
    const html = buildModelSearchHTML();
    expect(html).not.toContain('display:none');
    expect(html).toContain('or pick any model');
  });
});
```

- [ ] **Step 2: Run to verify failures**

Run: `npx jest tests/setup-ui-model.test.js -v`
Expected: FAIL — new assertions unmet (and the module still requires the deleted `getCuratedModels`, which throws at import).

- [ ] **Step 3: Rewrite the builder module**

In `electron/setup-ui-model.js`:
1. Delete the `getCuratedModels` require and the `MODEL_CHOICES` constant (rows now arrive as the `choices` argument; Task 5 threads them from `buildSetupHTML`).
2. In `buildModelSearchHTML()` replace the wrapper line with a labeled, ungated section:

```js
function buildModelSearchHTML() {
  return `<div id="model-search-section">
      <div class="search-label">&hellip;or pick any model from the catalog</div>
      <div class="search-head">
        <input type="text" id="model-search-input" placeholder="Search all models (id or name)..." autocomplete="off">
        <button class="icon-btn" id="model-search-refresh" title="Refresh catalog">&#x21bb;</button>
      </div>
      <div id="model-search-meta" class="search-meta"></div>
      <div id="model-search-results" class="search-results"></div>
    </div>`;
}
```

3. In the card template inside `buildModelStepHTML`, after the `model-label` span, render the resolved id, the offline badge, and the write-preview (use the route for `bestProvider`):

```js
    const previewId = c.routes[bestProvider] || Object.values(c.routes)[0] || '';
    const badge = c.source === 'fallback'
      ? '<span class="pick-badge">offline list</span>' : '';
    return `<label class="${cardClass}">
        <input type="radio" name="default-model" value="${c.alias}" ${checked}${disabled}>
        <span class="model-alias">${c.alias}</span>
        <span class="model-label">${c.label} — ${c.blurb}</span>${badge}
        <span class="model-resolved">${previewId}</span>
        ${routeHtml}
        <span class="write-preview" data-alias="${c.alias}">will set <code>${c.alias}</code> → <code class="write-preview-id">${previewId}</code></span>
      </label>`;
```

(`c.label` no longer pre-joins the blurb — rows come straight from `resolveQuickPicks`. Update `module.exports` to `{ buildModelSearchHTML, buildModelStepHTML, PROVIDER_NAMES }`.)

4. The subtitle line in `buildModelStepHTML` gains the freshness hint: change `<p class="subtitle">Pick the model to use when no --model flag is given.</p>` to `<p class="subtitle">Current models resolved from the live catalog. Pick the default used when no --model flag is given.</p>`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest tests/setup-ui-model.test.js -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/setup-ui-model.js tests/setup-ui-model.test.js
git commit -m "feat(wizard): Step-2 rows render resolved ids + write-preview; search always visible"
```

---

### Task 5: window build-time resolution + renderer write-rules

**Files:**
- Modify: `electron/setup-ui.js` (buildSetupHTML signature; finish handler; Step-3 stamp removal; applyCatalog ungate; write-preview wiring; review text)
- Modify: `electron/main.js:273` area (`createSetupWindow` → async, resolve picks)
- Modify: `electron/setup-ui-styles.js` (new classes)
- Modify: `tests/setup-ui.test.js` (update + add)

- [ ] **Step 1: Adjust/extend tests**

`tests/setup-ui.test.js` builds HTML via `buildSetupHTML()`. Update calls to the new options shape and add:

```js
const PICKS = [
  { alias: 'gemini', label: 'Gemini Flash-class', blurb: 'fast, large context',
    source: 'live',
    routes: { openrouter: 'openrouter/google/gemini-9.9-flash' } },
];

describe('buildSetupHTML (resolved picks)', () => {
  test('injects quickPicks as modelChoicesData and seed aliases as defaultAliases', () => {
    const html = buildSetupHTML({ quickPicks: PICKS, seedAliases: { gemini: 'openrouter/google/gemini-9.9-flash' } });
    expect(html).toContain('openrouter/google/gemini-9.9-flash');
    expect(html).toContain('var modelChoicesData =');
    expect(html).not.toContain('routingOverrides'); // blanket card writes are gone
    expect(html).toContain('aliasWrites');
  });
  test('defaults to pinned fallbacks when no picks are provided', () => {
    const html = buildSetupHTML();
    expect(html).toContain('openrouter/google/gemini-3.5-flash'); // Task-1 pinned id
  });
  test('Step-3 visit no longer stamps card aliases into aliasEdits', () => {
    const html = buildSetupHTML({ quickPicks: PICKS });
    expect(html).not.toContain('aliasEdits[alias] = routedModels[alias]');
  });
});
```

- [ ] **Step 2: Run to verify failures**

Run: `npx jest tests/setup-ui.test.js -v`
Expected: FAIL (import error first; then assertion failures as you fix imports).

- [ ] **Step 3: Rewire `buildSetupHTML`**

In `electron/setup-ui.js`:

```js
const { buildModelStepHTML, PROVIDER_NAMES } = require('./setup-ui-model');
const { resolveQuickPicks } = require('../src/utils/quick-picks');
// getDefaultAliases stays imported for the seedAliases default.

function buildSetupHTML(options = {}) {
  const {
    client = 'code-local',
    quickPicks = resolveQuickPicks([]),          // pinned fallbacks when not provided
    seedAliases = getDefaultAliases(),
  } = options;
  const brandName = getBrandName(client);
  const keysHtml = buildKeysStepHTML(PROVIDERS);
  const modelHtml = buildModelStepHTML(quickPicks);
  const aliasHtml = buildAliasEditorHTML(seedAliases);
  const css = buildWizardCSS();
  const providersJson = JSON.stringify(PROVIDERS);
  const modelChoicesJson = JSON.stringify(quickPicks);
  const providerNamesJson = JSON.stringify(PROVIDER_NAMES);
  const defaultAliasesJson = JSON.stringify(seedAliases);
  // ... rest unchanged
```

- [ ] **Step 4: Renderer — finish handler writes only touched aliases**

Replace the finish listener body (currently `setup-ui.js:337-358`) inside `buildWizardScript`:

```js
  finishBtn.addEventListener('click', async function() {
    finishBtn.disabled = true; finishBtn.textContent = 'Saving...';
    try {
      var r = document.querySelector('input[name="default-model"]:checked');
      var dm = window.customDefaultModel || (r ? r.value : null);
      var aliasWrites = {};
      if (!window.customDefaultModel && r) {
        // Selecting a quick pick = explicit touch: upgrade that ONE alias
        // to the resolved id via the chosen route (user-locked decision #2).
        var mc = null;
        for (var i = 0; i < modelChoicesData.length; i++) {
          if (modelChoicesData[i].alias === r.value) { mc = modelChoicesData[i]; break; }
        }
        if (mc) {
          var provs = Object.keys(mc.routes);
          var prov = routingChoices[mc.alias];
          if (!prov || !mc.routes[prov]) {
            prov = null;
            for (var j = 0; j < provs.length; j++) {
              if (configuredKeys[provs[j]]) { prov = provs[j]; break; }
            }
            if (!prov) { prov = provs[0]; }
          }
          aliasWrites[mc.alias] = mc.routes[prov];
        }
      }
      Object.keys(aliasEdits).forEach(function(k) {
        aliasWrites[k] = aliasEdits[k];
      });
      await window.sidecarSetup.invoke('sidecar:save-config', dm, aliasWrites);
      var kc = Object.values(configuredKeys).filter(function(v) { return v; }).length;
      await window.sidecarSetup.invoke('sidecar:setup-done', dm, kc);
    } catch (_e) { finishBtn.disabled = false; finishBtn.textContent = 'Finish'; }
  });
```

(The old `routingOverrides` loop is deleted entirely. Note `dm` falls back to `null`, never `'gemini'` — combined with Task 3's `if (defaultModel)` guard, a no-selection finish can no longer clobber an existing default.)

- [ ] **Step 5: Renderer — delete the Step-3 auto-stamp**

In `updateAliasRoutes` (currently `setup-ui.js:272-296`), delete the card-alias branch:

```js
      // DELETE these lines:
      if (routedModels[alias]) {
        modelSpan.textContent = routedModels[alias];
        aliasEdits[alias] = routedModels[alias];
        row.classList.remove('alias-no-key');
        return;
      }
```

Keep the `routedModels` computation above it (the `example-model` box still uses `routedModels.gemini`) and keep the no-key check below — it now applies to card aliases too.

- [ ] **Step 6: Renderer — write-preview + search ungating**

Still inside `buildWizardScript`:

1. `applyCatalog` (currently `setup-ui.js:379-387`): replace the display gating:

```js
  function applyCatalog(info) {
    catalogRows = (info && info.models) || [];
    catalogFetchedAt = info && info.fetchedAt;
    renderSearchMeta();
    renderSearchResults();
    if (catalogRows.length === 0) {
      var meta = $('model-search-meta');
      if (meta) { meta.textContent = 'Catalog unavailable (offline?) \\u2014 use \\u21bb to retry.'; }
    }
  }
```

(Offline text intentionally applied AFTER `renderSearchMeta()` so it isn't overwritten; the section itself never hides anymore.)

2. Add a selection listener that toggles `.write-preview` visibility and refreshes its id when pills change. Append next to the existing `change` listener:

```js
  function updateWritePreviews() {
    var r = document.querySelector('input[name="default-model"]:checked');
    var sel = (!window.customDefaultModel && r) ? r.value : null;
    document.querySelectorAll('.write-preview').forEach(function(el) {
      var alias = el.getAttribute('data-alias');
      el.classList.toggle('write-preview-active', alias === sel);
      if (alias !== sel) { return; }
      var mc = null;
      for (var i = 0; i < modelChoicesData.length; i++) {
        if (modelChoicesData[i].alias === alias) { mc = modelChoicesData[i]; break; }
      }
      if (!mc) { return; }
      var provs = Object.keys(mc.routes);
      var prov = routingChoices[alias];
      if (!prov || !mc.routes[prov]) {
        prov = null;
        for (var j = 0; j < provs.length; j++) {
          if (configuredKeys[provs[j]]) { prov = provs[j]; break; }
        }
        if (!prov) { prov = provs[0]; }
      }
      var idEl = el.querySelector('.write-preview-id');
      if (idEl) { idEl.textContent = mc.routes[prov]; }
    });
  }
```

Call `updateWritePreviews()`: at the end of the existing `change` listener for `default-model`, at the end of the route-pill click handler, inside `selectCustomModel`, and at the end of `updateRoutingPills`.

3. CSS — in `electron/setup-ui-styles.js`, append to the template returned by `buildWizardCSS`:

```css
.search-label { margin: 14px 0 6px; font-size: 12px; opacity: 0.75; }
.pick-badge { font-size: 10px; padding: 1px 5px; border-radius: 3px; background: #5a4a35; margin-left: 6px; }
.model-resolved { display: block; font-size: 11px; opacity: 0.6; font-family: monospace; }
.write-preview { display: none; font-size: 11px; margin-top: 4px; }
.write-preview-active { display: block; }
```

4. Review step (`buildReview`, currently `setup-ui.js:298-320`): replace the all-cards `review-routing` block with the actual write set:

```js
    var writes = [];
    var r2 = document.querySelector('input[name="default-model"]:checked');
    if (!window.customDefaultModel && r2) {
      var mc2 = null;
      for (var i2 = 0; i2 < modelChoicesData.length; i2++) {
        if (modelChoicesData[i2].alias === r2.value) { mc2 = modelChoicesData[i2]; break; }
      }
      if (mc2) {
        var pr = routingChoices[mc2.alias];
        if (!pr || !mc2.routes[pr]) {
          var ps = Object.keys(mc2.routes);
          pr = null;
          for (var j2 = 0; j2 < ps.length; j2++) {
            if (configuredKeys[ps[j2]]) { pr = ps[j2]; break; }
          }
          if (!pr) { pr = Object.keys(mc2.routes)[0]; }
        }
        writes.push(mc2.alias + ' \\u2192 ' + mc2.routes[pr]);
      }
    }
    document.getElementById('review-routing').textContent =
      writes.length > 0 ? writes.join(', ') : 'No alias changes';
```

- [ ] **Step 7: `createSetupWindow` resolves picks at build time**

In `electron/main.js` (function at line 273), make it async and thread the data:

```js
async function createSetupWindow() {
  // Lazy-load setup UI to avoid loading it for sidecar mode
  const { buildSetupHTML } = require('./setup-ui');
  const { resolveQuickPicks, toLiveSeedAliases } = require('../src/utils/quick-picks');
  let quickPicks, seedAliases;
  try {
    const catalog = await require('../src/utils/model-catalog').getCatalog();
    quickPicks = resolveQuickPicks(catalog);
    seedAliases = toLiveSeedAliases(catalog);
  } catch (_err) {
    quickPicks = undefined;  // buildSetupHTML falls back to pinned
    seedAliases = undefined;
  }
  // ... existing BrowserWindow construction unchanged ...
  // where the HTML is built, pass the new options:
  //   buildSetupHTML({ client: CLIENT, quickPicks, seedAliases })
}
```

Find the call site of `createSetupWindow()` (the `AMICUS_MODE === 'setup'` branch in the same file) and confirm it tolerates a promise (it runs inside app-ready handling; add `await`/`.catch(() => {})` to match the surrounding style).

- [ ] **Step 8: Run the suite slices**

Run: `npx jest tests/setup-ui.test.js tests/setup-ui-model.test.js tests/setup-ui-aliases.test.js -v`
Expected: PASS. Then `npx jest tests/` — expect remaining failures ONLY in files not yet touched by Tasks 6–7 (if any import `getCuratedModels` or readline `MODEL_CHOICES`).

- [ ] **Step 9: Commit**

```bash
git add electron/setup-ui.js electron/main.js electron/setup-ui-styles.js tests/setup-ui.test.js
git commit -m "feat(wizard): build-time pick resolution; finish writes only touched aliases"
```

---

### Task 6: readline parity

**Files:**
- Modify: `src/sidecar/setup.js`
- Create: `tests/setup-readline.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/setup-readline.test.js
'use strict';

jest.mock('../src/utils/quick-picks', () => ({
  resolveQuickPicks: jest.fn(() => ([
    { alias: 'gemini', label: 'Gemini Flash-class', blurb: 'fast, large context',
      source: 'live', routes: { openrouter: 'openrouter/google/gemini-9.9-flash' } },
  ])),
  toLiveSeedAliases: jest.fn(() => ({ gemini: 'openrouter/google/gemini-9.9-flash' })),
}));
jest.mock('../src/utils/model-catalog', () => ({
  getCatalog: jest.fn(async () => [{ id: 'openrouter/google/gemini-9.9-flash' }]),
  refreshCatalog: jest.fn(async () => []),
}));
jest.mock('../src/utils/config', () => {
  const real = jest.requireActual('../src/utils/config');
  return { ...real, loadConfig: jest.fn(), saveConfig: jest.fn(), getConfigDir: jest.fn(() => 'X:/cfg') };
});
jest.mock('../src/utils/api-key-store', () => ({
  readApiKeys: jest.fn(() => ({ openrouter: true, google: false, openai: false, anthropic: false, deepseek: false })),
}));

const { loadConfig, saveConfig } = require('../src/utils/config');

function mockReadline(answer) {
  jest.doMock('readline', () => ({
    createInterface: () => ({
      question: (_q, cb) => cb(answer),
      close: jest.fn(),
    }),
  }));
}

describe('runReadlineSetup (live picks, no clobber)', () => {
  beforeEach(() => { jest.resetModules(); jest.clearAllMocks(); });

  test('numbered pick on an existing config: sets default AND upgrades only that alias', async () => {
    mockReadline('1');
    loadConfig.mockReturnValue({ default: 'qwen', aliases: { qwen: 'user/qwen', gemini: 'user/old-gemini' } });
    const { runReadlineSetup } = require('../src/sidecar/setup');
    await runReadlineSetup();
    const written = saveConfig.mock.calls[0][0];
    expect(written.default).toBe('gemini');
    expect(written.aliases.gemini).toBe('openrouter/google/gemini-9.9-flash'); // touched: upgraded
    expect(written.aliases.qwen).toBe('user/qwen');                            // untouched: preserved
  });

  test('free-form model id (contains /) becomes the default without touching aliases', async () => {
    mockReadline('openrouter/x-ai/grok-4.3');
    loadConfig.mockReturnValue({ default: 'qwen', aliases: { qwen: 'user/qwen' } });
    const { runReadlineSetup } = require('../src/sidecar/setup');
    await runReadlineSetup();
    const written = saveConfig.mock.calls[0][0];
    expect(written.default).toBe('openrouter/x-ai/grok-4.3');
    expect(written.aliases).toEqual({ qwen: 'user/qwen' });
  });

  test('first run (no config) seeds live aliases', async () => {
    mockReadline('1');
    loadConfig.mockReturnValue(null);
    const { runReadlineSetup } = require('../src/sidecar/setup');
    await runReadlineSetup();
    const written = saveConfig.mock.calls[0][0];
    expect(written.aliases.gemini).toBe('openrouter/google/gemini-9.9-flash');
    expect(written.default).toBe('gemini');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/setup-readline.test.js -v`
Expected: FAIL — current flow calls `createDefaultConfig` (clobber) and offers static `MODEL_CHOICES` (also `getCuratedModels` no longer exists, so the import itself fails).

- [ ] **Step 3: Rewrite the readline flow**

In `src/sidecar/setup.js`:

1. Delete the `getCuratedModels` require and the static `MODEL_CHOICES` (drop it from `module.exports` too; Task 7 confirms no other consumers).
2. Replace `resolveChoice` and the selection part of `runReadlineSetup`:

```js
/**
 * Resolve readline input against the live picks.
 * @returns {{alias?: string, modelId?: string}|null}
 *   alias  → numbered/named quick pick (upgrades that alias)
 *   modelId → free-form full model id (default only, no alias writes)
 */
function resolveChoice(input, picks, catalog) {
  const num = parseInt(input, 10);
  if (num >= 1 && num <= picks.length) {
    return { alias: picks[num - 1].alias };
  }
  if (input.includes('/')) {
    const known = (catalog || []).some(m => m && m.id === input);
    if (!known) {
      console.log(`Warning: '${input}' not found in the model catalog (offline or new model) — using it anyway.`);
    }
    return { modelId: input };
  }
  const { getDefaultAliases, loadConfig } = require('../utils/config');
  const cfg = loadConfig();
  const aliases = { ...getDefaultAliases(), ...((cfg && cfg.aliases) || {}) };
  if (aliases[input] !== undefined) {
    return { alias: input, noUpgrade: true };
  }
  return null;
}
```

3. Replace the body of `runReadlineSetup` from the model-choice section down (keep the key-detection prelude):

```js
    const { getCatalog } = require('../utils/model-catalog');
    const { resolveQuickPicks, toLiveSeedAliases } = require('../utils/quick-picks');
    let catalog = [];
    try { catalog = await getCatalog(); } catch (_err) { /* offline: pinned */ }
    const picks = resolveQuickPicks(catalog);

    console.log('Choose your default model:');
    console.log('');
    picks.forEach((p, i) => {
      const badge = p.source === 'fallback' ? ' [offline list]' : '';
      console.log(`  ${i + 1}) ${p.alias} - ${p.label} (${p.blurb}) → ${p.routes.openrouter}${badge}`);
    });
    console.log('');

    const answer = await askQuestion(rl,
      `Pick a default (1-${picks.length}, alias name, or any full model id): `);
    const chosen = resolveChoice(answer, picks, catalog);

    if (!chosen) {
      console.log(`Invalid choice: "${answer}". Keeping configuration unchanged.`);
      return;
    }

    // Read-modify-write — never rebuild the alias table (no-clobber rule).
    const cfg = loadConfig() || { aliases: toLiveSeedAliases(catalog) };
    if (!cfg.aliases) { cfg.aliases = {}; }
    if (chosen.alias) {
      cfg.default = chosen.alias;
      const pick = picks.find(p => p.alias === chosen.alias);
      if (pick && !chosen.noUpgrade) {
        cfg.aliases[chosen.alias] = pick.routes.openrouter || Object.values(pick.routes)[0];
      } else if (cfg.aliases[chosen.alias] === undefined) {
        cfg.aliases[chosen.alias] = getDefaultAliases()[chosen.alias];
      }
    } else {
      cfg.default = chosen.modelId;
    }
    saveConfig(cfg);
    await seedCatalog();

    console.log('');
    console.log(`Default model set to: ${cfg.default}`);
    console.log(`Config saved (${Object.keys(cfg.aliases).length} aliases).`);
    console.log(`Config path: ${path.join(getConfigDir(), 'config.json')}`);
```

(The invalid-choice branch no longer force-creates a gemini config — on an existing install that was a clobber; on a fresh install the user can rerun. `createDefaultConfig` stays exported for `runInteractiveSetup`'s ensure-exists fallback, unchanged.)

- [ ] **Step 4: Run tests**

Run: `npx jest tests/setup-readline.test.js -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/sidecar/setup.js tests/setup-readline.test.js
git commit -m "feat(wizard): readline parity — live picks, free-form model id, no-clobber save"
```

---

### Task 7: `models --check` pinned-fallback drift warning + repo-wide consistency

**Files:**
- Modify: `src/sidecar/models.js` (after the stale report in the `--check` path, around line 100)
- Create: `tests/models-drift.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/models-drift.test.js
'use strict';

const { buildFallbackDriftReport } = require('../src/sidecar/models');

const row = id => ({ id });

describe('buildFallbackDriftReport', () => {
  test('reports families whose pinned openrouter fallback is behind the live pick', () => {
    const catalog = [row('openrouter/google/gemini-9.9-flash')];
    const lines = buildFallbackDriftReport(catalog);
    expect(lines.some(l => l.includes('gemini') && l.includes('openrouter/google/gemini-9.9-flash'))).toBe(true);
  });
  test('silent when fallbacks match the live resolution or catalog is empty', () => {
    expect(buildFallbackDriftReport([])).toEqual([]);
    const { getFamilies } = require('../src/utils/curated-models');
    const current = getFamilies().map(f => row(f.fallback.openrouter));
    expect(buildFallbackDriftReport(current)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/models-drift.test.js -v`
Expected: FAIL — `buildFallbackDriftReport is not a function`.

- [ ] **Step 3: Implement the report**

In `src/sidecar/models.js`, add and export:

```js
const { getFamilies } = require('../utils/curated-models');
const { pickCurrent } = require('../utils/quick-picks');

/**
 * Non-blocking drift report: pinned family fallbacks vs live resolution.
 * Empty catalog → [] (cannot check). Never affects the exit code.
 * @returns {string[]} human-readable warning lines
 */
function buildFallbackDriftReport(catalog) {
  if (!catalog || catalog.length === 0) { return []; }
  const lines = [];
  for (const f of getFamilies()) {
    const live = pickCurrent(catalog, 'openrouter/', f.vendorPath, f.idPattern);
    if (live && f.fallback.openrouter && live !== f.fallback.openrouter) {
      lines.push(
        `  pinned fallback drift: ${f.alias} → ${f.fallback.openrouter} (live: ${live}) — update curated-models.js`);
    }
  }
  return lines;
}
```

Wire it into the `--check` path right after the stale-alias output: print a `Pinned fallback drift:` header plus the lines when non-empty (plain `console.log`, NOT counted in the stale exit code). Add `buildFallbackDriftReport` to `module.exports`.

- [ ] **Step 4: Repo-wide consistency sweep**

Run: `npx jest tests/ 2>&1 | tail -40` and `grep -rn "getCuratedModels\|MODEL_CHOICES" src/ electron/ tests/ evals/`
Expected: zero remaining references to the deleted exports; full unit suite GREEN. Fix any straggler the grep finds (rewire to `getFamilies`/`resolveQuickPicks` following the patterns above).

- [ ] **Step 5: Run + commit**

Run: `npx jest tests/models-drift.test.js -v` → PASS, then `npm test` → 0 failures.

```bash
git add src/sidecar/models.js tests/models-drift.test.js
git commit -m "feat(models): --check warns when pinned family fallbacks drift behind the catalog"
```

---

### Task 8: live e2e verification (CDP)

**Files:** none modified — verification gate. Requires the dev clone's electron and the real `~/.config/sidecar/config.json` (back it up first).

- [ ] **Step 1: Back up the user config**

Run: `Copy-Item $HOME/.config/sidecar/config.json $HOME/.config/sidecar/config.json.e2e-bak`

- [ ] **Step 2: Launch the wizard with CDP**

Run (PowerShell): `$env:AMICUS_DEBUG_PORT='9222'; node bin/amicus.js setup` (background it; window titled "Amicus Setup" must appear).

- [ ] **Step 3: Verify Step 2 via CDP**

Attach to `http://127.0.0.1:9222/json/list` and `Runtime.evaluate` `document.body.innerText` after navigating to Step 2. Expected:
- quick-pick rows show CURRENT catalog ids (not `gemini-3.1-flash-lite-preview` era),
- the search section is visible WITHOUT typing (label "…or pick any model" present),
- selecting a row shows `will set <alias> → <id>`.

- [ ] **Step 4: The no-clobber proof**

In the GUI: select the `deepseek` quick pick, click through to Finish WITHOUT touching anything else. Then:

Run: `node -e "const c=require(process.env.USERPROFILE+'/.config/sidecar/config.json'); console.log(c.default, c.aliases.gemini, c.aliases.qwen)"`
Expected: `deepseek` + `gemini`/`qwen` values byte-identical to the backup (`git diff`-style compare against `config.json.e2e-bak` — only `default` and `aliases.deepseek` may differ).

- [ ] **Step 5: Search-pick round-trip**

Re-run setup, type `grok` in the search box, select `openrouter/x-ai/grok-4.3`, Finish. Expected: `config.default === 'openrouter/x-ai/grok-4.3'`, zero alias changes. Then restore: `Copy-Item $HOME/.config/sidecar/config.json.e2e-bak $HOME/.config/sidecar/config.json -Force` and re-verify `node bin/amicus.js models --check` exits 0.

---

### Task 9: gates + spec banner

- [ ] **Step 1: Full gates**

Run: `npm test` (expect ≥1900 pass + new tests, 0 fail), `npm run lint` (clean), `npm run generate-docs:check` and `npm run validate-docs --if-present` (green; the doc-system markers are AUTO:tree/AUTO:modules — regenerate if the new file changes the tree).

- [ ] **Step 2: Mark the spec implemented**

Edit `docs/superpowers/specs/2026-06-11-wizard-live-model-picker-design.md` status line to `**Status:** implemented (plan executed YYYY-MM-DD)` with the execution date.

- [ ] **Step 3: Final commit (branch stays local, unmerged)**

```bash
git add -A
git commit -m "docs(wizard): mark live-model-picker spec implemented"
```

Leave `fix/wizard-live-model-picker` UNMERGED per the collect-locally policy — the user batches merges/push/version-bump himself.
