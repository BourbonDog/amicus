# Free OpenRouter Council Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a setup option that stands up a zero-cost council of free OpenRouter models, saved as a `councils` config primitive and runnable from the second-opinion skill and from `amicus fanout --council <name>` (CLI + MCP).

**Architecture:** A new pure leaf module detects free models from the live catalog. A `councils` map is added to config with read/resolve helpers (graceful member-drop) plus a `seedFreeCouncil` writer with collision-safe alias derivation. Both wizards (readline + Electron) gain a free-council picker; the CLI and MCP fanout paths gain a `--council`/`council` preset that expands a saved council into its models list. The free-council setup never modifies `config.default`.

**Tech Stack:** Node.js (CommonJS), Jest (`testMatch: **/tests/**/*.test.js`, `testEnvironment: node`), zod (MCP schemas), Electron (setup wizard, virtual-mocked in tests).

## Global Constraints

- Source of truth for design: `docs/superpowers/specs/2026-06-28-free-openrouter-council-design.md`.
- Base branch: `feat/free-openrouter-council` (already created; spec committed at `5cc2516`).
- A free model = an `openrouter/…` catalog id ending in `:free` (the `:free` suffix is authoritative; no zero-price heuristic).
- Council members are stored as **alias names**; `config.default` is **never** modified by the free-council flow.
- No-clobber rule: never rewrite an alias the caller didn't explicitly set (mirror `setup.js:211`, `ipc-setup.js:98`).
- Config writers are read-modify-write; `saveConfig` already preserves unknown top-level keys (verified by `tests/ipc-setup-save-config.test.js` "unknown config keys survive").
- File-size limit is enforced by `npm run check:sizes` (keep files focused; `config.js` is near the 300-line cap — see Task 3).
- Quality gates after each task: `npm test` (relevant file) and at plan end `npm test && npm run lint && npm run check:secrets && npm run check:sizes && npm run generate-docs:check`.
- Tests set a temp config dir via `process.env.AMICUS_CONFIG_DIR` + `jest.resetModules()` (see `tests/config.test.js`).

---

### Task 1: Free-model detection module (Unit A)

**Files:**
- Create: `src/utils/free-models.js`
- Test: `tests/free-models.test.js`

**Interfaces:**
- Consumes: nothing (pure; operates on catalog rows `{ id, name, contextLength, pricing }`).
- Produces:
  - `isFreeModel(row) -> boolean`
  - `listFreeModels(catalog) -> Array<row>` (sorted by vendor then id)
  - `suggestFreeCouncil(catalog, n=3) -> Array<row>` (≤ n rows, one per distinct vendor)
  - `PINNED_FREE_MODELS -> string[]` (offline last-resort ids)

- [ ] **Step 1: Write the failing test**

```javascript
// tests/free-models.test.js
'use strict';
const { isFreeModel, listFreeModels, suggestFreeCouncil, PINNED_FREE_MODELS } =
  require('../src/utils/free-models');

const CATALOG = [
  { id: 'openrouter/deepseek/deepseek-r1:free', name: 'DeepSeek R1 (free)', pricing: { prompt: '0', completion: '0' } },
  { id: 'openrouter/deepseek/deepseek-chat-v3:free', name: 'DeepSeek Chat (free)', pricing: { prompt: '0', completion: '0' } },
  { id: 'openrouter/google/gemini-2.0-flash-exp:free', name: 'Gemini Flash (free)', pricing: { prompt: '0', completion: '0' } },
  { id: 'openrouter/qwen/qwen3-coder:free', name: 'Qwen Coder (free)', pricing: null },
  { id: 'openrouter/anthropic/claude-opus-4.8', name: 'Claude Opus', pricing: { prompt: '0.000015', completion: '0.000075' } },
  { id: 'openrouter/some/zero-but-paid', name: 'Per-request charged', pricing: { prompt: '0', completion: '0' } }, // NOT :free
  { id: 'google/gemini-3.5-flash', name: 'Direct Gemini', pricing: null }, // not openrouter ns
];

describe('isFreeModel', () => {
  it('is true only for openrouter ids ending in :free', () => {
    expect(isFreeModel({ id: 'openrouter/deepseek/deepseek-r1:free' })).toBe(true);
    expect(isFreeModel({ id: 'google/gemini-3.5-flash:free' })).toBe(false); // wrong namespace
    expect(isFreeModel({ id: 'openrouter/anthropic/claude-opus-4.8' })).toBe(false);
  });
  it('does NOT treat a zero-price non-:free row as free (avoids per-request mislabel)', () => {
    expect(isFreeModel({ id: 'openrouter/some/zero-but-paid', pricing: { prompt: '0', completion: '0' } })).toBe(false);
  });
  it('tolerates missing/odd rows', () => {
    expect(isFreeModel(null)).toBe(false);
    expect(isFreeModel({})).toBe(false);
  });
});

describe('listFreeModels', () => {
  it('returns only free rows, sorted by vendor then id', () => {
    const out = listFreeModels(CATALOG).map(r => r.id);
    expect(out).toEqual([
      'openrouter/deepseek/deepseek-chat-v3:free',
      'openrouter/deepseek/deepseek-r1:free',
      'openrouter/google/gemini-2.0-flash-exp:free',
      'openrouter/qwen/qwen3-coder:free',
    ]);
  });
  it('returns [] for an empty/garbage catalog', () => {
    expect(listFreeModels([])).toEqual([]);
    expect(listFreeModels(null)).toEqual([]);
  });
});

describe('suggestFreeCouncil', () => {
  it('picks at most n, one per distinct vendor', () => {
    const out = suggestFreeCouncil(CATALOG, 3).map(r => r.id);
    expect(out).toHaveLength(3);
    const vendors = out.map(id => id.split('/')[1]);
    expect(new Set(vendors).size).toBe(3); // deepseek, google, qwen — no two from one vendor
  });
  it('caps at the number of distinct vendors when fewer than n', () => {
    const small = [CATALOG[0], CATALOG[1]]; // both deepseek
    expect(suggestFreeCouncil(small, 3)).toHaveLength(1);
  });
});

describe('PINNED_FREE_MODELS', () => {
  it('is a non-empty list of openrouter :free ids (offline fallback)', () => {
    expect(PINNED_FREE_MODELS.length).toBeGreaterThan(0);
    PINNED_FREE_MODELS.forEach(id => {
      expect(id.startsWith('openrouter/')).toBe(true);
      expect(id.endsWith(':free')).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/free-models.test.js`
Expected: FAIL — `Cannot find module '../src/utils/free-models'`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// src/utils/free-models.js
/**
 * Free OpenRouter model detection (Unit A).
 *
 * A free model is an openrouter/* catalog id whose slug ends in ':free'.
 * The ':free' suffix is OpenRouter's authoritative free-tier marker. A
 * zero prompt/completion price is deliberately NOT used: the catalog
 * normalizer keeps only {prompt, completion} and discards request/image
 * pricing, so a per-request-charged model with prompt:'0' would be
 * mislabeled. Pure + network-free.
 */
'use strict';

/** Offline last-resort free ids (used only when the live catalog is empty). */
const PINNED_FREE_MODELS = [
  'openrouter/deepseek/deepseek-r1:free',
  'openrouter/google/gemini-2.0-flash-exp:free',
  'openrouter/qwen/qwen3-coder:free',
];

/** @param {{id?:string}} row @returns {boolean} */
function isFreeModel(row) {
  const id = row && typeof row.id === 'string' ? row.id : '';
  return id.startsWith('openrouter/') && id.endsWith(':free');
}

/** @param {Array} catalog @returns {Array} free rows, sorted by vendor then id */
function listFreeModels(catalog) {
  const rows = (Array.isArray(catalog) ? catalog : []).filter(isFreeModel);
  return rows.sort((a, b) => {
    const va = a.id.split('/')[1] || '';
    const vb = b.id.split('/')[1] || '';
    return va === vb ? a.id.localeCompare(b.id) : va.localeCompare(vb);
  });
}

/** @param {Array} catalog @param {number} n @returns {Array} ≤n free rows, one per vendor */
function suggestFreeCouncil(catalog, n = 3) {
  const out = [];
  const seenVendors = new Set();
  for (const row of listFreeModels(catalog)) {
    const vendor = row.id.split('/')[1] || '';
    if (seenVendors.has(vendor)) { continue; }
    seenVendors.add(vendor);
    out.push(row);
    if (out.length >= n) { break; }
  }
  return out;
}

module.exports = { isFreeModel, listFreeModels, suggestFreeCouncil, PINNED_FREE_MODELS };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/free-models.test.js`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/utils/free-models.js tests/free-models.test.js
git commit -m "feat(free-council): free-model detection (Unit A)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `createDefaultConfig` read-modify-write fix (Unit B robustness)

**Files:**
- Modify: `src/sidecar/setup.js:47-58` (`createDefaultConfig`)
- Test: `tests/free-council-config.test.js` (new; also used by Task 3/4)

**Interfaces:**
- Consumes: `loadConfig`, `saveConfig`, `getDefaultAliases` (already imported in `setup.js`).
- Produces: `createDefaultConfig(defaultModel)` now preserves all pre-existing top-level keys (incl. `councils`).

- [ ] **Step 1: Write the failing test**

```javascript
// tests/free-council-config.test.js
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');

describe('createDefaultConfig (read-modify-write)', () => {
  let tempDir, originalEnv;
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'free-council-cfg-'));
    originalEnv = { ...process.env };
    process.env.AMICUS_CONFIG_DIR = tempDir;
    jest.resetModules();
  });
  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('preserves a pre-existing councils map (regression for full-file clobber)', () => {
    const { saveConfig, loadConfig } = require('../src/utils/config');
    const { createDefaultConfig } = require('../src/sidecar/setup');
    saveConfig({ aliases: { gemini: 'g' }, councils: { free: ['free-deepseek-r1'] } });
    createDefaultConfig('gemini');
    const cfg = loadConfig();
    expect(cfg.default).toBe('gemini');
    expect(cfg.councils).toEqual({ free: ['free-deepseek-r1'] });
  });

  it('still seeds a full default-alias table on a fresh install', () => {
    const { createDefaultConfig } = require('../src/sidecar/setup');
    const { getDefaultAliases } = require('../src/utils/config');
    const cfg = createDefaultConfig('gemini');
    expect(cfg.default).toBe('gemini');
    expect(Object.keys(cfg.aliases).length).toBe(Object.keys(getDefaultAliases()).length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/free-council-config.test.js -t createDefaultConfig`
Expected: FAIL — the councils-preservation case fails (current code clobbers).

- [ ] **Step 3: Write minimal implementation**

Replace `src/sidecar/setup.js:47-58` body:

```javascript
/**
 * Ensure a config exists with the chosen default model. Read-modify-write:
 * preserves every pre-existing top-level key (aliases, councils, …) and only
 * fills in the default + any missing default aliases. Never clobbers.
 * @param {string} defaultModel - Default model alias or full model string
 * @returns {object} The resulting config object
 */
function createDefaultConfig(defaultModel) {
  const existing = loadConfig() || {};
  const cfg = {
    ...existing,
    default: existing.default || defaultModel,
    aliases: { ...getDefaultAliases(), ...(existing.aliases || {}) },
  };
  saveConfig(cfg);
  logger.info('Default config ensured', {
    default: cfg.default,
    aliasCount: Object.keys(cfg.aliases).length,
  });
  return cfg;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/free-council-config.test.js -t createDefaultConfig && npx jest tests/sidecar/setup.test.js`
Expected: PASS (new cases + existing setup tests unaffected).

- [ ] **Step 5: Commit**

```bash
git add src/sidecar/setup.js tests/free-council-config.test.js
git commit -m "fix(config): createDefaultConfig is read-modify-write (no clobber)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Council read/resolve helpers in config (Unit B core)

**Files:**
- Modify: `src/utils/config.js` (add `getCouncils`, `getCouncil`, `resolveCouncilMembers`; export them)
- Test: `tests/free-council-config.test.js` (append a `describe`)

**Note on file size:** `config.js` is ~292 lines; adding ~35 lines risks the 300-line `check:sizes` cap. If `npm run check:sizes` fails after this task, extract the three new functions into `src/utils/councils.js` (taking the same params, importing `getEffectiveAliases` from `config.js`) and re-export from `config.js`. Prefer the in-file version first; split only if the gate fails.

**Interfaces:**
- Consumes: `loadConfig`, `getEffectiveAliases` (in `config.js`). Catalog rows passed in by callers.
- Produces:
  - `getCouncils() -> Object<string,string[]>`
  - `getCouncil(name) -> string[] | null`
  - `resolveCouncilMembers(name, catalog=[]) -> { models: string[], dropped: string[] } | { error: string }`

- [ ] **Step 1: Write the failing test**

```javascript
// append to tests/free-council-config.test.js
describe('council helpers', () => {
  let tempDir, originalEnv;
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'free-council-helpers-'));
    originalEnv = { ...process.env };
    process.env.AMICUS_CONFIG_DIR = tempDir;
    delete process.env.OPENROUTER_API_KEY;
    jest.resetModules();
  });
  afterEach(() => { process.env = originalEnv; fs.rmSync(tempDir, { recursive: true, force: true }); });

  const CATALOG = [
    { id: 'openrouter/deepseek/deepseek-r1:free' },
    { id: 'openrouter/google/gemini-2.0-flash-exp:free' },
    { id: 'openrouter/qwen/qwen3-coder:free' },
  ];

  function seed(councils, aliases = {}) {
    const { saveConfig } = require('../src/utils/config');
    saveConfig({ aliases, councils });
  }

  it('getCouncil returns members or null', () => {
    seed({ free: ['free-a', 'free-b'] });
    const { getCouncil } = require('../src/utils/config');
    expect(getCouncil('free')).toEqual(['free-a', 'free-b']);
    expect(getCouncil('nope')).toBeNull();
  });

  it('resolveCouncilMembers errors on unknown / empty council', () => {
    seed({ free: [] });
    const { resolveCouncilMembers } = require('../src/utils/config');
    expect(resolveCouncilMembers('free', CATALOG).error).toMatch(/empty/i);
    expect(resolveCouncilMembers('ghost', CATALOG).error).toMatch(/unknown/i);
  });

  it('drops delisted members and keeps the rest when ≥2 survive', () => {
    seed(
      { free: ['free-r1', 'free-flash', 'free-gone'] },
      {
        'free-r1': 'openrouter/deepseek/deepseek-r1:free',
        'free-flash': 'openrouter/google/gemini-2.0-flash-exp:free',
        'free-gone': 'openrouter/dead/model-x:free', // not in catalog
      }
    );
    const { resolveCouncilMembers } = require('../src/utils/config');
    const r = resolveCouncilMembers('free', CATALOG);
    expect(r.models).toEqual(['free-r1', 'free-flash']);
    expect(r.dropped).toEqual(['free-gone']);
  });

  it('errors when fewer than 2 members survive', () => {
    seed(
      { free: ['free-r1', 'free-gone'] },
      { 'free-r1': 'openrouter/deepseek/deepseek-r1:free', 'free-gone': 'openrouter/dead/x:free' }
    );
    const { resolveCouncilMembers } = require('../src/utils/config');
    expect(resolveCouncilMembers('free', CATALOG).error).toMatch(/fewer than 2/i);
  });

  it('does not drop members when the catalog is empty (offline)', () => {
    seed(
      { free: ['free-r1', 'free-flash'] },
      { 'free-r1': 'openrouter/deepseek/deepseek-r1:free', 'free-flash': 'openrouter/google/gemini-2.0-flash-exp:free' }
    );
    const { resolveCouncilMembers } = require('../src/utils/config');
    const r = resolveCouncilMembers('free', []);
    expect(r.models).toEqual(['free-r1', 'free-flash']);
    expect(r.dropped).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/free-council-config.test.js -t "council helpers"`
Expected: FAIL — `resolveCouncilMembers is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to `src/utils/config.js` (before `module.exports`):

```javascript
/** @returns {Object<string,string[]>} the councils map (empty if none) */
function getCouncils() {
  const config = loadConfig();
  return (config && config.councils) || {};
}

/** @param {string} name @returns {string[]|null} council members, or null if absent */
function getCouncil(name) {
  return getCouncils()[name] || null;
}

/**
 * Expand a saved council into a runnable members list, degrading gracefully.
 * Each member is resolved to its full model id (alias → id via effective
 * aliases; a member containing '/' is taken as-is) and that id checked against
 * the cached catalog. Unresolvable aliases and delisted ids are dropped with a
 * warning rather than fail-fast-aborting the whole wave. The catalog check is
 * skipped when the catalog is empty (offline). Returns members RAW (alias or
 * id) — leg-time validation resolves them again.
 * @param {string} name
 * @param {Array<{id:string}>} [catalog]
 * @returns {{models:string[], dropped:string[]} | {error:string}}
 */
function resolveCouncilMembers(name, catalog = []) {
  const members = getCouncil(name);
  if (!members) {
    return { error: `Unknown council '${name}'. Run 'amicus setup' to create one.` };
  }
  if (!Array.isArray(members) || members.length === 0) {
    return { error: `Council '${name}' is empty. Run 'amicus setup' to populate it.` };
  }
  const aliases = getEffectiveAliases();
  const known = new Set((Array.isArray(catalog) ? catalog : []).map(m => m && m.id).filter(Boolean));
  const models = [];
  const dropped = [];
  for (const member of members) {
    const id = member.includes('/') ? member : aliases[member];
    if (!id) { dropped.push(member); continue; }                 // alias no longer resolves
    if (known.size > 0 && !known.has(id)) { dropped.push(member); continue; } // delisted model
    models.push(member);
  }
  if (models.length < 2) {
    return {
      error: `Council '${name}' has fewer than 2 usable members` +
        (dropped.length ? ` (dropped: ${dropped.join(', ')})` : '') +
        `. Run 'amicus setup' to refresh it.`,
    };
  }
  return { models, dropped };
}
```

Add `getCouncils, getCouncil, resolveCouncilMembers` to the `module.exports` object.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/free-council-config.test.js -t "council helpers" && npm run check:sizes`
Expected: PASS. If `check:sizes` flags `config.js`, apply the split noted above, re-run.

- [ ] **Step 5: Commit**

```bash
git add src/utils/config.js tests/free-council-config.test.js
git commit -m "feat(config): council read + graceful-degrade resolve helpers (Unit B)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: `seedFreeCouncil` writer with collision-safe aliases (Unit B)

**Files:**
- Modify: `src/sidecar/setup.js` (add `deriveFreeAlias`, `seedFreeCouncil`; export both)
- Test: `tests/free-council-seed.test.js` (new)

**Interfaces:**
- Consumes: `loadConfig`, `saveConfig` (already imported in `setup.js`).
- Produces:
  - `deriveFreeAlias(id, taken: Set<string>) -> string`
  - `seedFreeCouncil(pickIds: string[]) -> { added: Array<{alias,model}>, council: string[] }` — single atomic read-modify-write; writes `aliases` + `councils.free`; never touches `config.default`.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/free-council-seed.test.js
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');

describe('seedFreeCouncil', () => {
  let tempDir, originalEnv;
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'free-council-seed-'));
    originalEnv = { ...process.env };
    process.env.AMICUS_CONFIG_DIR = tempDir;
    jest.resetModules();
  });
  afterEach(() => { process.env = originalEnv; fs.rmSync(tempDir, { recursive: true, force: true }); });

  it('two same-vendor picks yield two distinct aliases and two distinct council members', () => {
    const { seedFreeCouncil } = require('../src/sidecar/setup');
    const { loadConfig } = require('../src/utils/config');
    const res = seedFreeCouncil([
      'openrouter/deepseek/deepseek-r1:free',
      'openrouter/deepseek/deepseek-chat-v3:free',
    ]);
    const cfg = loadConfig();
    expect(res.council).toHaveLength(2);
    expect(new Set(res.council).size).toBe(2);
    const ids = res.council.map(a => cfg.aliases[a]);
    expect(new Set(ids).size).toBe(2);
    expect(cfg.councils.free).toEqual(res.council);
  });

  it('does not touch config.default', () => {
    const { saveConfig } = require('../src/utils/config');
    saveConfig({ default: 'gemini', aliases: { gemini: 'g' } });
    const { seedFreeCouncil } = require('../src/sidecar/setup');
    const { loadConfig } = require('../src/utils/config');
    seedFreeCouncil(['openrouter/qwen/qwen3-coder:free']);
    // single pick → council has 1 member here; default must remain untouched
    expect(loadConfig().default).toBe('gemini');
  });

  it('does not clobber a pre-existing alias of the same derived name', () => {
    const { saveConfig, loadConfig } = require('../src/utils/config');
    saveConfig({ aliases: { 'free-deepseek-r1': 'openrouter/deepseek/deepseek-r1:free' } });
    const { seedFreeCouncil } = require('../src/sidecar/setup');
    seedFreeCouncil(['openrouter/deepseek/deepseek-r1:free']); // same id → reuse existing alias
    const cfg = loadConfig();
    expect(cfg.aliases['free-deepseek-r1']).toBe('openrouter/deepseek/deepseek-r1:free');
    expect(cfg.councils.free).toContain('free-deepseek-r1');
  });

  it('writes config exactly once (atomic)', () => {
    jest.doMock('../src/utils/config', () => {
      const actual = jest.requireActual('../src/utils/config');
      return { ...actual, saveConfig: jest.fn(actual.saveConfig) };
    });
    const { saveConfig } = require('../src/utils/config');
    const { seedFreeCouncil } = require('../src/sidecar/setup');
    seedFreeCouncil(['openrouter/a/m1:free', 'openrouter/b/m2:free']);
    expect(saveConfig).toHaveBeenCalledTimes(1);
    jest.dontMock('../src/utils/config');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/free-council-seed.test.js`
Expected: FAIL — `seedFreeCouncil is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to `src/sidecar/setup.js`:

```javascript
/**
 * Collision-safe alias name from a free model id. Strips the openrouter/
 * prefix and trailing :free, sanitizes '/'/':' to '-', prefixes 'free-',
 * and disambiguates against `taken` with a numeric suffix.
 * @param {string} id e.g. openrouter/deepseek/deepseek-r1:free
 * @param {Set<string>} taken alias names already in use
 * @returns {string} e.g. free-deepseek-deepseek-r1
 */
function deriveFreeAlias(id, taken) {
  const base = 'free-' + id
    .replace(/^openrouter\//, '')
    .replace(/:free$/, '')
    .replace(/[/:]/g, '-')
    .replace(/-+/g, '-');
  let name = base;
  let n = 2;
  while (taken.has(name)) { name = `${base}-${n++}`; }
  taken.add(name);
  return name;
}

/**
 * Seed free-model aliases + councils.free from chosen catalog ids.
 * Single atomic read-modify-write. Reuses an existing alias that already
 * maps to the same id (idempotent re-runs); never touches config.default.
 * @param {string[]} pickIds full openrouter/.../...:free ids
 * @returns {{added: Array<{alias:string, model:string}>, council: string[]}}
 */
function seedFreeCouncil(pickIds) {
  const cfg = loadConfig() || { aliases: {} };
  if (!cfg.aliases) { cfg.aliases = {}; }
  const taken = new Set(Object.keys(cfg.aliases));
  const council = [];
  const added = [];
  for (const id of pickIds) {
    const existing = Object.entries(cfg.aliases).find(([, m]) => m === id);
    if (existing) { if (!council.includes(existing[0])) { council.push(existing[0]); } continue; }
    const alias = deriveFreeAlias(id, taken);
    cfg.aliases[alias] = id;
    added.push({ alias, model: id });
    council.push(alias);
  }
  if (!cfg.councils) { cfg.councils = {}; }
  cfg.councils.free = Array.from(new Set(council));
  saveConfig(cfg);
  logger.info('Free council seeded', { count: cfg.councils.free.length });
  return { added, council: cfg.councils.free };
}
```

Add `deriveFreeAlias, seedFreeCouncil` to `module.exports`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/free-council-seed.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sidecar/setup.js tests/free-council-seed.test.js
git commit -m "feat(free-council): seedFreeCouncil with collision-safe aliases (Unit B)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: CLI `--council` preset (Unit E)

**Files:**
- Modify: `src/cli-handlers-run.js` (`handleFanout`, ~lines 103-133)
- Modify: `src/cli.js` (fanout help block ~357)
- Test: `tests/fanout-council-cli.test.js` (new)

**Interfaces:**
- Consumes: `resolveCouncilMembers` (Task 3), `readCache` (`model-catalog`), `parseModelsList` (`fanout`).
- Produces: `handleFanout` accepts `args.council`; sets `args.models` from the expanded survivors; mutual-exclusion + bad-value errors via `failJson`.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/fanout-council-cli.test.js
'use strict';
const fs = require('fs');
const path = require('path');

describe('fanout --council (CLI surface + wiring)', () => {
  it('cli.js usage documents --council', () => {
    const { getUsage } = require('../src/cli');
    expect(getUsage()).toContain('--council');
  });

  it('handleFanout source enforces mutual exclusion and string-value guard', () => {
    const src = fs.readFileSync(path.join(__dirname, '../src/cli-handlers-run.js'), 'utf-8');
    expect(src).toContain('resolveCouncilMembers');
    expect(src).toContain('exactly one of --models / --council'); // error text
    expect(src).toContain("typeof args.council"); // boolean-true guard
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/fanout-council-cli.test.js`
Expected: FAIL — usage lacks `--council`; source lacks `resolveCouncilMembers`.

- [ ] **Step 3: Write minimal implementation**

In `src/cli-handlers-run.js`, replace the `--models is required` block (lines 111-113) and the empty-list guard (lines 130-133) region with council handling. Insert after the prompt resolution (after line 110):

```javascript
  // Council preset: expand a saved council into args.models (mutually exclusive with --models).
  const hasModels = typeof args.models === 'string' && args.models.trim();
  const hasCouncil = args.council !== undefined && args.council !== false;
  if (hasModels && hasCouncil) {
    process.exit(failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: 'Error: pass exactly one of --models / --council, not both' }));
  }
  if (!hasModels && !hasCouncil) {
    process.exit(failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: 'Error: --models is required (comma-separated aliases or provider/model IDs), or use --council <name>' }));
  }
  if (hasCouncil) {
    if (typeof args.council !== 'string' || !args.council.trim()) {
      process.exit(failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: 'Error: --council requires a council name (e.g. --council free)' }));
    }
    const { resolveCouncilMembers } = require('./utils/config');
    const { readCache } = require('./utils/model-catalog');
    const catalog = (readCache() || {}).models || [];
    const expanded = resolveCouncilMembers(args.council.trim(), catalog);
    if (expanded.error) {
      process.exit(failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: `Error: ${expanded.error}` }));
    }
    if (expanded.dropped && expanded.dropped.length && !useJson) {
      process.stderr.write(`Notice: dropped unavailable council member(s): ${expanded.dropped.join(', ')}\n`);
    }
    args.models = expanded.models.join(',');
  }
```

Then DELETE the now-redundant `if (typeof args.models !== 'string' || !args.models.trim())` block at 111-113. Keep the `parseModelsList` empty-list guard (130-133) as a defensive backstop.

In `src/cli.js` fanout help block (after the `--models` line at ~358), add:

```
  --council <name>             Run a saved council instead of --models (e.g. free). Mutually exclusive with --models
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/fanout-council-cli.test.js && npx jest tests/fanout-cli.test.js`
Expected: PASS (new + existing fanout CLI tests).

- [ ] **Step 5: Commit**

```bash
git add src/cli-handlers-run.js src/cli.js tests/fanout-council-cli.test.js
git commit -m "feat(fanout): --council preset expands a saved council (Unit E)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: MCP `amicus_fanout` schema — optional models + council (Unit F)

**Files:**
- Modify: `src/mcp-tools.js:257-260` (the `amicus_fanout` `inputSchema`)
- Test: `tests/free-council-mcp-schema.test.js` (new)

**Interfaces:**
- Consumes: nothing new.
- Produces: `amicus_fanout` schema where `models` is `.optional()` and a new `council` string is optional. (Cross-field "exactly one" is enforced in the handler, Task 7, because the schema is a raw shape, not a `z.object` that supports `.refine`.)

- [ ] **Step 1: Write the failing test**

```javascript
// tests/free-council-mcp-schema.test.js
'use strict';
const { TOOL_DEFINITIONS } = require('../src/mcp-tools');

describe('amicus_fanout schema (council)', () => {
  const tool = TOOL_DEFINITIONS.find(t => t.name === 'amicus_fanout');

  it('models is optional and council is accepted', () => {
    expect(tool).toBeDefined();
    // council-only input parses
    expect(() => tool.inputSchema.council.parse('free')).not.toThrow();
    // models omitted is allowed (optional)
    expect(tool.inputSchema.models.isOptional()).toBe(true);
  });
});
```

(If `TOOL_DEFINITIONS` is not the exported name, adapt to the actual export — check `src/mcp-tools.js` `module.exports`. The test must reference the real export.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/free-council-mcp-schema.test.js`
Expected: FAIL — `council` undefined / `models.isOptional()` false.

- [ ] **Step 3: Write minimal implementation**

In `src/mcp-tools.js`, change the `amicus_fanout` `models` field to optional and add `council`:

```javascript
      models: z.array(safeModel).min(1).max(10).optional().describe(
        `1-10 models (2+ for genuine fan-out). Short aliases (${aliasNames}) or full provider/model IDs. Duplicates allowed. Omit when using 'council'.`
      ),
      council: z.string().optional().describe(
        "Run a saved council by name (e.g. 'free') instead of 'models'. Expands to the council's members. Mutually exclusive with 'models'."
      ),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/free-council-mcp-schema.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mcp-tools.js tests/free-council-mcp-schema.test.js
git commit -m "feat(mcp): amicus_fanout optional models + council param (Unit F)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: MCP `amicus_fanout` handler — expand + cap before write (Unit F, blocker fix)

**Files:**
- Modify: `src/mcp-server.js:531-558` (`amicus_fanout` handler)
- Test: `tests/free-council-mcp-handler.test.js` (new)

**Interfaces:**
- Consumes: `resolveCouncilMembers` (Task 3), `DEFAULT_MAX_LEGS` (`fanout`), `readCache` (`model-catalog`).
- Produces: handler resolves a single `effectiveModels` array, caps it, and on unknown/empty/over-cap/under-2 council returns `textResult(msg, true)` **before** any `mkdir`/`metadata` write; all three pre-spawn sites (`deriveLegIds`, metadata `models:`, `--models` argv) use `effectiveModels`.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/free-council-mcp-handler.test.js
'use strict';
const fs = require('fs');
const path = require('path');

describe('amicus_fanout handler (council expansion)', () => {
  it('source routes all three pre-spawn sites through effectiveModels and validates before write', () => {
    const src = fs.readFileSync(path.join(__dirname, '../src/mcp-server.js'), 'utf-8');
    // No bare input.models.length / input.models.join survive
    expect(src).not.toContain('input.models.length');
    expect(src).not.toContain('input.models.join');
    // Single resolved array name is used
    expect(src).toContain('effectiveModels');
    expect(src).toContain('resolveCouncilMembers');
    // Cap re-applied
    expect(src).toContain('DEFAULT_MAX_LEGS');
    // Error returned before the metadata write (expansion block precedes mkdirSync)
    const idxExpand = src.indexOf('resolveCouncilMembers');
    const idxMkdir = src.indexOf('mkdirSync', src.indexOf('async amicus_fanout'));
    expect(idxExpand).toBeGreaterThan(-1);
    expect(idxExpand).toBeLessThan(idxMkdir);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/free-council-mcp-handler.test.js`
Expected: FAIL — `input.models.length` still present; no `effectiveModels`.

- [ ] **Step 3: Write minimal implementation**

Replace the top of the `amicus_fanout` handler (`src/mcp-server.js:531-549`) up to and including the metadata write:

```javascript
  async amicus_fanout(input, project) {
    const cwd = project || getProjectDir(input.project);
    const { generateTaskId } = require('./sidecar/start');
    const { deriveLegIds, DEFAULT_MAX_LEGS } = require('./sidecar/fanout');

    // Resolve a single effective models list (council OR models), validated
    // BEFORE any wave dir / metadata is written so a bad request never strands
    // a pid-less 'running' orphan wave.
    const hasModels = Array.isArray(input.models) && input.models.length > 0;
    const hasCouncil = typeof input.council === 'string' && input.council.trim();
    if (hasModels && hasCouncil) {
      return textResult("Pass exactly one of 'models' / 'council', not both.", true);
    }
    let effectiveModels;
    if (hasCouncil) {
      const { resolveCouncilMembers } = require('./utils/config');
      const { readCache } = require('./utils/model-catalog');
      const catalog = (readCache() || {}).models || [];
      const expanded = resolveCouncilMembers(input.council.trim(), catalog);
      if (expanded.error) { return textResult(expanded.error, true); }
      effectiveModels = expanded.models;
    } else if (hasModels) {
      effectiveModels = input.models;
    } else {
      return textResult("Provide 'models' or 'council'.", true);
    }
    const envCap = Number(process.env.AMICUS_FANOUT_MAX_LEGS);
    const maxLegs = (Number.isInteger(envCap) && envCap > 0) ? envCap : DEFAULT_MAX_LEGS;
    if (effectiveModels.length > maxLegs) {
      return textResult(`Council/model list exceeds the fan-out cap of ${maxLegs} legs.`, true);
    }

    const waveId = generateTaskId();
    const legIds = deriveLegIds(waveId, effectiveModels.length);
    const waveDir = getSessionDir(cwd, waveId);

    let briefingPath;
    try {
      fs.mkdirSync(waveDir, { recursive: true, mode: 0o700 });
      briefingPath = path.join(waveDir, 'briefing.md');
      fs.writeFileSync(briefingPath, input.prompt, { mode: 0o600 });
      fs.writeFileSync(path.join(waveDir, 'metadata.json'), JSON.stringify({
        taskId: waveId, type: 'wave', status: 'running', legs: legIds,
        models: effectiveModels, headless: true, createdAt: new Date().toISOString(),
      }, null, 2), { mode: 0o600 });
    } catch (err) {
      return textResult(`Failed to prepare fan-out wave: ${err.message}`, true);
    }

    const args = [
      'fanout', '--models', effectiveModels.join(','),
      '--prompt-file', briefingPath, '--wave-id', waveId,
      '--json', '--client', 'cowork', '--cwd', cwd,
    ];
```

(The remainder of the handler — `agent`, knobs, `spawnSidecarProcess`, return — is unchanged.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/free-council-mcp-handler.test.js && npx jest tests/mcp-discovery.test.js`
Expected: PASS (new + MCP discovery unaffected).

- [ ] **Step 5: Commit**

```bash
git add src/mcp-server.js tests/free-council-mcp-handler.test.js
git commit -m "fix(mcp): amicus_fanout expands+caps council before any wave write (Unit F)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Readline wizard free-council branch (Unit C)

**Files:**
- Modify: `src/sidecar/setup.js` (`runReadlineSetup` — add mode prompt + `runFreeCouncilBranch(rl)`)
- Test: `tests/free-council-readline.test.js` (new)

**Interfaces:**
- Consumes: `detectApiKeys`, `getCatalog`, `listFreeModels`/`suggestFreeCouncil`/`PINNED_FREE_MODELS` (Task 1), `seedFreeCouncil` (Task 4), `askQuestion`.
- Produces: a `runFreeCouncilBranch(rl)` async function; `runReadlineSetup` gates on a mode answer of `2`.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/free-council-readline.test.js
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');

describe('runFreeCouncilBranch', () => {
  let tempDir, originalEnv;
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'free-council-rl-'));
    originalEnv = { ...process.env };
    process.env.AMICUS_CONFIG_DIR = tempDir;
    jest.resetModules();
    jest.doMock('../src/utils/model-catalog', () => ({
      getCatalog: jest.fn(async () => ([
        { id: 'openrouter/deepseek/deepseek-r1:free' },
        { id: 'openrouter/google/gemini-2.0-flash-exp:free' },
        { id: 'openrouter/qwen/qwen3-coder:free' },
      ])),
      refreshCatalog: jest.fn(async () => []),
    }));
  });
  afterEach(() => { process.env = originalEnv; fs.rmSync(tempDir, { recursive: true, force: true }); jest.dontMock('../src/utils/model-catalog'); });

  function fakeRl(answers) {
    let i = 0;
    return { question: (_q, cb) => cb(answers[i++]), close: () => {} };
  }

  it('with OPENROUTER_API_KEY, default selection seeds councils.free and leaves default untouched', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-test';
    const { runFreeCouncilBranch } = require('../src/sidecar/setup');
    const { loadConfig } = require('../src/utils/config');
    await runFreeCouncilBranch(fakeRl([''])); // Enter = accept diverse default
    const cfg = loadConfig();
    expect(cfg.councils.free.length).toBeGreaterThanOrEqual(2);
    expect(cfg.default).toBeUndefined();
  });

  it('aborts with no writes when OPENROUTER_API_KEY is missing', async () => {
    delete process.env.OPENROUTER_API_KEY;
    const { runFreeCouncilBranch } = require('../src/sidecar/setup');
    const { loadConfig } = require('../src/utils/config');
    await runFreeCouncilBranch(fakeRl(['']));
    expect(loadConfig()).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/free-council-readline.test.js`
Expected: FAIL — `runFreeCouncilBranch is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to `src/sidecar/setup.js`:

```javascript
/* eslint-disable no-console -- CLI wizard requires direct console output */
/**
 * Free OpenRouter council branch of the readline wizard. Requires
 * OPENROUTER_API_KEY; lists free catalog models, lets the user multi-pick
 * (Enter = the vendor-diverse default), seeds aliases + councils.free, and
 * never touches config.default.
 * @param {readline.Interface} rl
 */
async function runFreeCouncilBranch(rl) {
  const keys = detectApiKeys();
  if (!keys.openrouter) {
    console.log('');
    console.log('A free council needs OPENROUTER_API_KEY (free models route only through OpenRouter).');
    console.log('Set OPENROUTER_API_KEY and re-run: amicus setup. No changes made.');
    return;
  }
  const { getCatalog } = require('../utils/model-catalog');
  const { listFreeModels, suggestFreeCouncil, PINNED_FREE_MODELS } = require('../utils/free-models');
  let catalog = [];
  try { catalog = await getCatalog(); } catch (_e) { /* offline */ }
  let free = listFreeModels(catalog);
  if (free.length === 0) {
    console.log('Live free-model list unavailable (offline?) — using a small pinned set.');
    free = PINNED_FREE_MODELS.map(id => ({ id }));
  }
  const defaults = new Set(suggestFreeCouncil(free, 3).map(r => r.id));
  console.log('');
  console.log('Free OpenRouter models (★ = default council):');
  free.forEach((r, i) => {
    const star = defaults.has(r.id) ? '★' : ' ';
    console.log(`  ${star} ${i + 1}) ${r.id}`);
  });
  console.log('');
  const answer = await askQuestion(rl,
    `Pick members (comma-separated numbers, or Enter for the ★ default): `);
  let pickIds;
  if (!answer) {
    pickIds = free.filter(r => defaults.has(r.id)).map(r => r.id);
  } else {
    pickIds = answer.split(',').map(s => parseInt(s.trim(), 10))
      .filter(n => n >= 1 && n <= free.length).map(n => free[n - 1].id);
  }
  if (pickIds.length < 2) {
    console.log('A council needs at least 2 models. No changes made.');
    return;
  }
  const { council } = seedFreeCouncil(pickIds);
  await seedCatalog();
  console.log('');
  console.log(`Free council saved: councils.free = [${council.join(', ')}]`);
  console.log('Run it:   amicus fanout --council free --prompt "..."');
  console.log('config.default left unchanged.');
  console.log('');
  console.log('Heads up (free tier): rate-limited & quality-variable; some models 404');
  console.log('unless you enable data-sharing at openrouter.ai/settings/privacy.');
}
/* eslint-enable no-console */
```

Wire the mode prompt into `runReadlineSetup` (after the API-key detection block, before the "Choose your default model" picker). Insert:

```javascript
    const mode = await askQuestion(rl,
      'Setup mode — 1) Standard (pick a default model)  2) Free OpenRouter council: ');
    if (mode === '2') {
      await runFreeCouncilBranch(rl);
      return;
    }
```

Add `runFreeCouncilBranch` to `module.exports`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/free-council-readline.test.js && npx jest tests/sidecar/setup.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sidecar/setup.js tests/free-council-readline.test.js
git commit -m "feat(setup): readline free-council branch (Unit C)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: Electron free-council section builder (Unit D, part 1)

**Files:**
- Create: `electron/setup-ui-council.js`
- Test: `tests/electron/setup-ui-council.test.js` (new)

**Interfaces:**
- Consumes: nothing (pure HTML/JS string builders).
- Produces:
  - `buildCouncilSectionHTML() -> string` (the collapsible section markup; rows rendered client-side)
  - `buildCouncilScript() -> string` (client JS: fetch free models via `sidecar:fetch-free-models`, render checkboxes, gate on `configuredKeys.openrouter`, expose `window.collectCouncilPicks()`)

- [ ] **Step 1: Write the failing test**

```javascript
// tests/electron/setup-ui-council.test.js
'use strict';
const { buildCouncilSectionHTML, buildCouncilScript } = require('../../electron/setup-ui-council');

describe('buildCouncilSectionHTML', () => {
  it('renders the council container, toggle, and results box', () => {
    const html = buildCouncilSectionHTML();
    expect(html).toContain('id="free-council-section"');
    expect(html).toContain('id="free-council-toggle"');
    expect(html).toContain('id="free-council-results"');
  });
});

describe('buildCouncilScript', () => {
  it('fetches free models, gates on the openrouter key, and exposes collectCouncilPicks', () => {
    const js = buildCouncilScript();
    expect(js).toContain("sidecar:fetch-free-models");
    expect(js).toContain('configuredKeys');
    expect(js).toContain('window.collectCouncilPicks');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/electron/setup-ui-council.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```javascript
// electron/setup-ui-council.js
/**
 * Setup UI — Free OpenRouter council picker (mounted on the Models step).
 * Collapsible section: a checkbox list of free models fetched via IPC. Gated
 * on the OpenRouter key (recomputed on Step-2 entry by the orchestrator).
 * window.collectCouncilPicks() returns the checked ids for the save payload.
 */
'use strict';

function buildCouncilSectionHTML() {
  return `<div id="free-council-section" class="council-section">
      <label class="council-toggle"><input type="checkbox" id="free-council-toggle">
        <span>Set up a free OpenRouter council (zero-cost)</span></label>
      <div id="free-council-body" style="display:none">
        <div id="free-council-meta" class="search-meta"></div>
        <div id="free-council-results" class="council-results"></div>
        <div class="council-note">Free tier: rate-limited &amp; quality-variable; some models need
          data-sharing enabled at openrouter.ai/settings/privacy.</div>
      </div>
    </div>`;
}

function buildCouncilScript() {
  return `
  (function() {
    var toggle = document.getElementById('free-council-toggle');
    var body = document.getElementById('free-council-body');
    var results = document.getElementById('free-council-results');
    var meta = document.getElementById('free-council-meta');
    var loaded = false;

    function hasOpenRouterKey() { return !!(window.configuredKeys && window.configuredKeys.openrouter); }

    window.refreshCouncilGating = function() {
      if (!toggle) { return; }
      var ok = hasOpenRouterKey();
      toggle.disabled = !ok;
      if (meta && !ok) { meta.textContent = 'Add an OpenRouter API key (step 1) to enable a free council.'; }
      else if (meta && !loaded) { meta.textContent = ''; }
    };

    async function loadFree() {
      if (loaded) { return; }
      try {
        var rows = await window.sidecarSetup.invoke('sidecar:fetch-free-models');
        loaded = true;
        results.innerHTML = '';
        (rows || []).forEach(function(r, i) {
          var id = 'fc-' + i;
          var row = document.createElement('label');
          row.className = 'council-row';
          var cb = document.createElement('input');
          cb.type = 'checkbox'; cb.value = r.id; cb.id = id; cb.checked = !!r.suggested;
          var span = document.createElement('span'); span.textContent = r.id;
          row.appendChild(cb); row.appendChild(span);
          results.appendChild(row);
        });
        if (meta) { meta.textContent = (rows || []).length + ' free models'; }
      } catch (_e) { if (meta) { meta.textContent = 'Could not load free models.'; } }
    }

    if (toggle) {
      toggle.addEventListener('change', function() {
        body.style.display = toggle.checked ? '' : 'none';
        if (toggle.checked) { loadFree(); }
      });
    }

    window.collectCouncilPicks = function() {
      if (!toggle || !toggle.checked) { return []; }
      return Array.prototype.slice.call(results.querySelectorAll('input[type=checkbox]:checked'))
        .map(function(cb) { return cb.value; });
    };
  })();
  `;
}

module.exports = { buildCouncilSectionHTML, buildCouncilScript };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/electron/setup-ui-council.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/setup-ui-council.js tests/electron/setup-ui-council.test.js
git commit -m "feat(setup-ui): free-council section builder (Unit D)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 10: Electron wiring — mount section + IPC (Unit D, part 2)

**Files:**
- Modify: `electron/setup-ui.js` (mount section in Step 2; include picks in Finish payload; expose `configuredKeys` + call `refreshCouncilGating` on Step-2 entry; embed `buildCouncilScript()`)
- Modify: `electron/ipc-setup.js` (`sidecar:fetch-free-models`; extend `sidecar:save-config` with optional `councilPicks`)
- Test: append to `tests/ipc-setup-save-config.test.js`

**Interfaces:**
- Consumes: `buildCouncilSectionHTML`/`buildCouncilScript` (Task 9), `listFreeModels`/`suggestFreeCouncil` (Task 1), `seedFreeCouncil` (Task 4), `getCatalog` (`model-catalog`).
- Produces: IPC `sidecar:fetch-free-models -> Array<{id, suggested}>`; `sidecar:save-config(_e, defaultModel, aliasWrites, councilPicks)` seeds the council when `councilPicks` is non-empty.

- [ ] **Step 1: Write the failing test**

```javascript
// append to tests/ipc-setup-save-config.test.js
describe('sidecar:save-config (council picks)', () => {
  test('councilPicks seeds councils.free and free-* aliases', async () => {
    loadConfig.mockReturnValue({ default: 'gemini', aliases: { gemini: 'g' } });
    const written = [];
    saveConfig.mockImplementation(c => written.push(JSON.parse(JSON.stringify(c))));
    await save('gemini', {}, ['openrouter/deepseek/deepseek-r1:free', 'openrouter/qwen/qwen3-coder:free']);
    const final = written[written.length - 1];
    expect(final.councils.free).toHaveLength(2);
    const ids = final.councils.free.map(a => final.aliases[a]);
    expect(ids).toEqual(expect.arrayContaining([
      'openrouter/deepseek/deepseek-r1:free', 'openrouter/qwen/qwen3-coder:free',
    ]));
    expect(final.default).toBe('gemini'); // council never overrides default
  });

  test('no councilPicks → behaves exactly as before (no councils key added)', async () => {
    loadConfig.mockReturnValue({ default: 'gemini', aliases: { gemini: 'g' } });
    const written = [];
    saveConfig.mockImplementation(c => written.push(JSON.parse(JSON.stringify(c))));
    await save('gemini', {});
    expect(written[written.length - 1].councils).toBeUndefined();
  });
});
```

Note: the existing top-of-file `jest.mock('../src/utils/config', …)` mocks only `loadConfig`/`saveConfig`. `seedFreeCouncil` (in `setup.js`) calls the REAL `loadConfig`/`saveConfig`. To keep the test hermetic, have the handler call `seedFreeCouncil` which uses the mocked module — so add `loadConfig`/`saveConfig` passthrough already present. Because `setup.js` requires `../utils/config` (the mocked one), `seedFreeCouncil` will use the mocks. Verify the mock returns a mutable object across calls; if not, switch this test to the real config module with a temp `AMICUS_CONFIG_DIR` (as in Task 4) instead of the virtual mock.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/ipc-setup-save-config.test.js -t "council picks"`
Expected: FAIL — councils not written (handler ignores the 3rd arg).

- [ ] **Step 3: Write minimal implementation**

In `electron/ipc-setup.js`, extend the `sidecar:save-config` handler signature and append council seeding after the existing `saveConfig(cfg)` (line 121):

```javascript
  ipcMain.handle('sidecar:save-config', async (_event, defaultModel, aliasWrites, councilPicks) => {
    try {
      // ... existing body unchanged through saveConfig(cfg) ...
      saveConfig(cfg);
      if (Array.isArray(councilPicks) && councilPicks.length >= 2) {
        require('../src/sidecar/setup').seedFreeCouncil(councilPicks);
      }
      return { success: true };
    } catch (err) {
      logger.error('save-config handler error', { error: err.message });
      throw err;
    }
  });
```

Add the new IPC handler (near the other handlers):

```javascript
  ipcMain.handle('sidecar:fetch-free-models', async () => {
    try {
      const { getCatalog } = require('../src/utils/model-catalog');
      const { listFreeModels, suggestFreeCouncil } = require('../src/utils/free-models');
      const catalog = await getCatalog();
      const free = listFreeModels(catalog);
      const suggested = new Set(suggestFreeCouncil(free, 3).map(r => r.id));
      return free.map(r => ({ id: r.id, suggested: suggested.has(r.id) }));
    } catch (_err) { return []; }
  });
```

In `electron/setup-ui.js`:
1. `require('./setup-ui-council')` at top and embed `buildCouncilSectionHTML()` inside `wizard-step-2` (append after `${modelHtml}`).
2. In `buildWizardScript`, expose keys to the council script: after `configuredKeys` is populated (in the get-api-keys init block), set `window.configuredKeys = configuredKeys;` and call `window.refreshCouncilGating && window.refreshCouncilGating();`. Also call `window.refreshCouncilGating()` inside `showStep(2)` (alongside `updateRoutingPills()`).
3. In the Finish handler, pass picks: change `invoke('sidecar:save-config', dm, aliasWrites)` to `invoke('sidecar:save-config', dm, aliasWrites, (window.collectCouncilPicks && window.collectCouncilPicks()) || [])`.
4. Append `buildCouncilScript()` to the returned `<script>` (next to `aliasJs`/`keysJs`).
5. (Review surface) In `buildReview`, add a council line if `window.collectCouncilPicks()` is non-empty (optional, low-risk display only).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/ipc-setup-save-config.test.js && npx jest tests/electron/`
Expected: PASS (council picks + existing electron tests).

- [ ] **Step 5: Commit**

```bash
git add electron/setup-ui.js electron/ipc-setup.js tests/ipc-setup-save-config.test.js
git commit -m "feat(setup-ui): wire free-council picker + IPC (Unit D)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 11: Skill consumption + free-tier notes (Unit F, docs)

**Files:**
- Modify: `skills/second-opinion/SKILL.md` (free-council recognition + handling)
- Modify: `skills/second-opinion/MODEL-NOTES.md` (free-tier section)
- Test: `tests/free-council-skill-docs.test.js` (new; content assertions)

**Interfaces:**
- Consumes: nothing (documentation).
- Produces: skill guidance for `councils.free`.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/free-council-skill-docs.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf-8');

describe('second-opinion free-council docs', () => {
  it('SKILL.md documents the free council path', () => {
    const s = read('skills/second-opinion/SKILL.md');
    expect(s).toContain('--council free');
    expect(s).toMatch(/free council|free-tier|councils\.free/i);
    expect(s).toMatch(/privacy|data-sharing/i);
  });
  it('MODEL-NOTES.md has a free-tier section', () => {
    const s = read('skills/second-opinion/MODEL-NOTES.md');
    expect(s).toMatch(/free[- ]tier/i);
    expect(s).toMatch(/rate.?limit/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/free-council-skill-docs.test.js`
Expected: FAIL — strings absent.

- [ ] **Step 3: Write minimal implementation**

Add to `skills/second-opinion/SKILL.md` (in the "Pick the council" area near line 57), a subsection:

```markdown
**Free council (zero-cost).** If the user asks for a "free council" / "zero-cost council",
read `councils.free` from `~/.config/amicus/config.json` and run
`amicus fanout --council free --prompt-file <briefing>`. Free-tier handling:
- Cost ≈ $0 — skip the paid-run cost framing (the budget gate is a no-op at zero price).
- No reliability history: free models have no `amicus council stats` / `MODEL-NOTES` record,
  so don't rank on street-cred. Pick the most capable free model as chair and state lower confidence.
- Weak structured output: small free models are less reliable at the strict findings JSON; expect
  more `validateFindings` repair-loop hits.
- Throttled/truncated legs: a mid-stream 429 can yield a leg marked `complete` with a truncated,
  unparseable review. When a free-council leg is `complete` but `validateFindings` returns
  `NO_FENCED_BLOCK`/`NOT_PARSEABLE`, treat it as suspect/throttled — don't burn the repair loop on the
  same throttled model; disclose it and apply the ≥2-reviews-survive wave-degrade rule.
- Prerequisite: free models require enabling data-sharing in OpenRouter privacy settings
  (openrouter.ai/settings/privacy) or legs 404 at run time — catalog validation cannot catch this.
  State this up front.
```

Add to `skills/second-opinion/MODEL-NOTES.md`:

```markdown
## Free-tier models (OpenRouter `:free`)
- Heavily rate-limited (shared daily pool); a 3-leg parallel wave + cross-review can 429 mid-run.
- Quality-variable; weaker at strict structured (findings JSON) output.
- Some `:free` models 404 unless the account enables data-sharing at openrouter.ai/settings/privacy.
- No reliability history — chair selection can't use `council stats`; pick the strongest free model and disclose lower confidence.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/free-council-skill-docs.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add skills/second-opinion/SKILL.md skills/second-opinion/MODEL-NOTES.md tests/free-council-skill-docs.test.js
git commit -m "docs(skill): free-council consumption + free-tier notes (Unit F)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 12: Full-suite gates + integration smoke

**Files:**
- Modify: `CHANGELOG.md` (add an Unreleased entry)
- (No new code; verification + changelog.)

- [ ] **Step 1: Run the full gate suite**

Run: `npm test && npm run lint && npm run check:secrets && npm run check:sizes && npm run generate-docs:check`
Expected: all green. Fix any failures in the owning task's files before proceeding.

- [ ] **Step 2: Real-LLM free smoke (requires `OPENROUTER_API_KEY` + data-sharing enabled)**

Run:
```bash
node bin/amicus.js setup           # choose 2) Free OpenRouter council, accept the default picks
node bin/amicus.js fanout --council free --prompt "In one sentence, what is a council review?" --json
```
Expected: a wave JSON with ≥2 legs reaching terminal status; per-leg `usage.cost` ≈ 0. Note in the PR if a member 404'd (privacy gate) so the guidance copy is validated against reality.

- [ ] **Step 3: Update CHANGELOG**

Add under an `## [Unreleased]` heading:
```markdown
### Added
- Free OpenRouter council: `amicus setup` option (readline + Electron) that seeds a zero-cost
  council of free `:free` models; runnable via `amicus fanout --council free` and the
  `amicus_fanout` MCP `council` param. Saved as a `councils` config primitive.
```

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): free OpenRouter council

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review (completed during authoring)

- **Spec coverage:** Unit A→Task 1; Unit B→Tasks 2–4; Unit C→Task 8; Unit D→Tasks 9–10; Unit E→Task 5; Unit F→Tasks 6,7,11. All §7 review fixes mapped (MCP crash→T7; cap/orphan→T7; clobber→T2; alias collision→T4; dropped auto-default→T4/T8; graceful drop→T3; isFreeModel→T1; arg parsing→T5; atomicity→T4; async GUI gating→T10; skill guards→T11).
- **Placeholder scan:** none — every code/test step carries real content.
- **Type consistency:** `isFreeModel/listFreeModels/suggestFreeCouncil/PINNED_FREE_MODELS` (T1) ↔ used in T8/T10; `resolveCouncilMembers(name, catalog) → {models,dropped}|{error}` (T3) ↔ consumed in T5/T7; `seedFreeCouncil(pickIds) → {added,council}` (T4) ↔ consumed in T8/T10; `effectiveModels` (T7) replaces all `input.models` reads. `councils.free` member shape (alias names) consistent across T3/T4/T5/T7.
