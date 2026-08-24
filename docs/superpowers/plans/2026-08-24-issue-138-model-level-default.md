# Issue #138 — Model-Level Default Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user choose *which* model a provider offers as their default — e.g. `deepseek-r1` instead of only "DeepSeek" — in both the Electron and readline setup wizards.

**Architecture:** Add a family → model *second level* to setup Step 2, reusing the existing priced picker core (`provider-default-picker.js`) rather than building new selection machinery. A new pure module (`src/utils/model-shortlist.js`) turns a vendor's deduped priced rows into a `{suggested, rest}` split so the GUI can render one `<select>` with two optgroups and readline can print 8 rows plus an expander. Nothing in the alias/route persistence model changes: we still write `config.aliases[<family>] = <route-encoded id>` and point `config.default` at the alias *name*.

**Tech Stack:** Node.js (CommonJS), Jest (`testEnvironment: 'node'` — **there is no jsdom in this repo**), Electron (HTML built as strings server-side, asserted as strings in tests).

**Spec:** This document. Source investigation: `BACKLOG.md:6002` ("Setup polish — #138"), issue #138, and the 7-agent surface map run 2026-08-24 (root cause + measurements reproduced in §Background below).

---

## Global Constraints

- **File size gate — 300 lines**, enforced by `scripts/check-file-sizes.js` over `src/**/*.js` and `electron/**/*.js` (pre-commit + CI `--all`). Current headroom for files this plan touches:
  - `src/utils/curated-models.js` — **290/300, only 10 lines, NOT grandfathered. Do not add logic here.**
  - `electron/ipc-setup.js` — 254/300 (46 free)
  - `src/utils/provider-default-picker.js` — 249/300 (51 free)
  - `electron/setup-ui-model.js` — 148/300 (152 free)
  - `src/utils/quick-picks.js` — 112/300 (188 free)
  - Grandfathered (excluded, but do not grow gratuitously): `electron/setup-ui.js` (589), `src/sidecar/setup.js` (623), `electron/main.js`.
- **Baseline to preserve:** 551 suites / 7978 passed / 8 skipped at `2c2d20a0`. Re-measure at the end; do not quote this number as a post-change fact.
- **Never hand-roll a gateway prefix strip.** Use `toStorableRoute` (`quick-picks.js:87`) or `applyProviderDefault`'s rule (`provider-default-picker.js:235`). `DIVERGENT_VENDORS` is `Set(['anthropic'])` (`curated-models.js:186`) — anthropic's direct and OpenRouter ids are *different strings* (`anthropic/claude-opus-4-8` vs `openrouter/anthropic/claude-opus-4.8`), never derivable from each other.
- **Route encoding is the stored string itself; there is no route field in config.**
  - `<vendor>/<model>` → policy-routed, direct-first (`gateway-router.js:185-190`)
  - `openrouter/<vendor>/<model>` → forces OpenRouter (`gateway-router.js:138-142`)
- **Prompt-string naming rule (readline).** The new sub-prompt **must not contain the literal `"Pick a number"`** — `tests/sidecar/setup.test.js:392` and `:475` branch on that substring and would answer `''`, leaving new tests green while covering nothing. The strings `"Choose your default model"` and `"Pick a default"` appear in **no** test (grep-verified) and are safe.
- **Mock rule (readline).** `tests/setup-readline.test.js:47-54`'s `mockReadline(answer)` returns the *same* answer to *every* question. Any new test that exercises an inserted prompt **must** use a prompt-keyed or FIFO mock (Task 2 supplies one); reusing `mockReadline` silently absorbs the new prompt.

---

## Background — the root cause, measured

`electron/setup-ui-model.js:92-135` renders **one radio card per curated family** (5 total). The only per-card control is the route pill pair, whose click handler stores a **provider** id, never a model id (`electron/setup-ui.js:397`). The cap is applied upstream: `pickCurrent` keeps `ids.sort(compareIdsDesc)[0]` — a single winner per namespace (`quick-picks.js:36-44`).

Measured against the real 601-row catalog:

| candidate list source | deepseek | google | openai | anthropic |
|---|---|---|---|---|
| family `idPattern` | **2** | 5 | 8 | 7 |
| vendor (`buildProviderDefaultChoices`) | **14** | 69 | 175 | 28 |

The family pattern `/^deepseek-v[\d.]+(-pro)?$/` (`curated-models.js:64`) yields only `deepseek-v3.2` and `deepseek-v4-pro` — version history, not model variety. It **structurally excludes `deepseek-r1`, `deepseek-chat`, `deepseek-v4-flash`**. Hence: the drill-down must be **vendor-scoped**.

### Owner decisions (2026-08-24)

1. **List shape:** top-8 "suggested" + show-all.
2. **Surfaces:** GUI **and** readline.
3. **Recommended model:** the **family flagship** (what the card already resolves to), so opening the drill-down and accepting is a guaranteed no-op. This *overrides* `buildProviderDefaultChoices`' cost-tier preselect, which disagrees (DeepSeek: flagship `v4-pro` vs tier-preselect `v3.2` at `balanced`).
4. **Bundled defects:** stale `.model-resolved` label, the picker's false "never fabricated" header, and the Settings-window stale catalog — plus the mandatory Finish-handler clobber fix.

### Refinement to decision 1, adopted in this plan

A pure top-8-by-price would hide `deepseek-r1` ($0.50, rank 9) — the exact model the issue names. So "show all" must be *cheap to reach*, not a second wall:

- **GUI:** one `<select>` containing **every** model, split into `<optgroup label="Suggested">` (8) and `<optgroup label="All N models">` (the rest). A `<select>` is scrollable and type-ahead searchable, so nothing is hidden and no extra click is added.
- **Readline:** 8 numbered rows, then `Enter` = recommended, `a` = list all N, or paste any full model id.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/utils/model-shortlist.js` | **create** (~95 lines) | Pure: vendor → `{recommendedId, suggested, rest, total}` with both route forms per row. Consumed by GUI *and* readline, so the split logic exists once. |
| `tests/model-shortlist.test.js` | **create** | Unit tests for the above. |
| `src/sidecar/setup.js` | modify | Readline: sub-prompt after the family pick. |
| `tests/setup-readline-model-drilldown.test.js` | **create** | New file — avoids `setup-readline.test.js`'s answer-to-everything mock. |
| `electron/setup-ui-model.js` | modify | Render the per-card `<select>`. |
| `electron/main.js` | modify | Build shortlists alongside `quickPicks`; give the Settings window a live catalog. |
| `electron/setup-ui.js` | modify | `modelChoiceIds` state, Finish clobber guard, `.model-resolved` refresh. |
| `src/utils/provider-default-picker.js` | modify | Header-comment correction only. |

New logic goes in `model-shortlist.js` rather than `curated-models.js` (10 lines of headroom) or `provider-default-picker.js` (51).

---

### Task 0: Branch

- [ ] **Step 1: Create the working branch from current main**

```bash
cd /c/Users/sendt/code/amicus
git checkout main && git pull --ff-only
git checkout -b fix/138-model-level-default
```

- [ ] **Step 2: Confirm a clean, green starting point**

Run: `npm test`
Expected: `Test Suites: 551 passed`, `Tests: 8 skipped, 7978 passed, 7986 total`. If this differs, STOP and re-measure the baseline before proceeding — every later "no regressions" claim is measured against it.

---

### Task 1: The shortlist module

**Files:**
- Create: `src/utils/model-shortlist.js`
- Test: `tests/model-shortlist.test.js`

**Interfaces:**
- Consumes: `buildProviderDefaultChoices(vendor, {catalog})` from `./provider-default-picker` (returns `{preselectedId, rows}`, rows are `{id, name, contextLength, pricePerMInput, isPreselected}`); `pairAcrossGateways(vendor, versionToken, catalogInfo)` from `./gateway-route-catalog` (returns `{direct?, openrouter?}`).
- Produces:
  ```js
  buildModelShortlist(vendor, { catalog, recommendedId, limit = 8 })
  //   -> { recommendedId: string|null,
  //        suggested: Row[],   // <= limit, recommended first
  //        rest:      Row[],   // remainder, same ordering
  //        total:     number }
  // Row = { id, name, contextLength, pricePerMInput, isRecommended,
  //         directId: string|null, openrouterId: string|null }
  ```
  `SHORTLIST_LIMIT = 8` is also exported.

- [ ] **Step 1: Write the failing test**

Create `tests/model-shortlist.test.js`:

```js
'use strict';

const { buildModelShortlist, SHORTLIST_LIMIT } = require('../src/utils/model-shortlist');

function row(id, promptPrice, name) {
  return {
    id,
    name: name || id.split('/').pop(),
    contextLength: 128000,
    pricing: promptPrice === null ? null : { prompt: String(promptPrice / 1e6) },
  };
}

// Nine DeepSeek models so the 8-row limit actually splits.
const CATALOG = [
  row('openrouter/deepseek/deepseek-v4-pro', 0.52),
  row('openrouter/deepseek/deepseek-v4-flash', 0.06),
  row('openrouter/deepseek/deepseek-chat', 0.26),
  row('openrouter/deepseek/deepseek-r1', 0.70),
  row('openrouter/deepseek/deepseek-v3.2', 0.26),
  row('openrouter/deepseek/deepseek-v3.2-exp', 0.27),
  row('openrouter/deepseek/deepseek-chat-v3-0324', 0.25),
  row('openrouter/deepseek/deepseek-v3.1-terminus', 0.27),
  row('openrouter/deepseek/deepseek-r1-distill-llama-70b', 0.80),
];

describe('buildModelShortlist', () => {
  test('honours the caller-supplied recommendedId over the tier preselect', () => {
    const out = buildModelShortlist('deepseek', {
      catalog: CATALOG,
      recommendedId: 'deepseek/deepseek-v4-pro',
    });
    expect(out.recommendedId).toBe('deepseek/deepseek-v4-pro');
    expect(out.suggested[0].id).toBe('deepseek/deepseek-v4-pro');
    expect(out.suggested[0].isRecommended).toBe(true);
  });

  test('splits at the limit and reports the true total', () => {
    const out = buildModelShortlist('deepseek', {
      catalog: CATALOG,
      recommendedId: 'deepseek/deepseek-v4-pro',
    });
    expect(SHORTLIST_LIMIT).toBe(8);
    expect(out.suggested).toHaveLength(8);
    expect(out.rest).toHaveLength(1);
    expect(out.total).toBe(9);
  });

  test('every model appears exactly once across suggested + rest', () => {
    const out = buildModelShortlist('deepseek', {
      catalog: CATALOG,
      recommendedId: 'deepseek/deepseek-v4-pro',
    });
    const ids = out.suggested.concat(out.rest).map(r => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('deepseek/deepseek-r1');
  });

  test('after the recommended row, ordering is price-ascending', () => {
    const out = buildModelShortlist('deepseek', {
      catalog: CATALOG,
      recommendedId: 'deepseek/deepseek-v4-pro',
    });
    const prices = out.suggested.slice(1).map(r => r.pricePerMInput);
    const sorted = prices.slice().sort((a, b) => a - b);
    expect(prices).toEqual(sorted);
  });

  test('falls back to the picker preselect when recommendedId matches no row', () => {
    const out = buildModelShortlist('deepseek', {
      catalog: CATALOG,
      recommendedId: 'deepseek/does-not-exist',
    });
    expect(out.recommendedId).not.toBeNull();
    expect(out.suggested[0].isRecommended).toBe(true);
    expect(out.suggested.concat(out.rest).map(r => r.id))
      .toContain(out.recommendedId);
  });

  test('annotates both route forms so an explicit OpenRouter pick is expressible', () => {
    const out = buildModelShortlist('deepseek', {
      catalog: CATALOG,
      recommendedId: 'deepseek/deepseek-v4-pro',
    });
    const r1 = out.suggested.concat(out.rest).find(r => r.id === 'deepseek/deepseek-r1');
    expect(r1.openrouterId).toBe('openrouter/deepseek/deepseek-r1');
  });

  test('empty or unknown vendor degrades to an empty shortlist, never throws', () => {
    expect(buildModelShortlist('deepseek', { catalog: [] }))
      .toEqual({ recommendedId: null, suggested: [], rest: [], total: 0 });
    expect(buildModelShortlist('', { catalog: CATALOG }).total).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/model-shortlist.test.js`
Expected: FAIL — `Cannot find module '../src/utils/model-shortlist'`.

- [ ] **Step 3: Write the implementation**

Create `src/utils/model-shortlist.js`:

```js
/**
 * Vendor model shortlist (#138) -- the family -> model second level.
 *
 * Turns a vendor's deduped, priced picker rows into a
 * `{suggested, rest}` split so a surface can show a short list without
 * hiding anything: the GUI renders both groups in one <select>, readline
 * prints `suggested` and offers `a` to print `rest` too.
 *
 * PURE and transport-agnostic, exactly like `provider-default-picker.js`:
 * the catalog is always injected, and nothing here formats for a renderer.
 *
 * Why the caller supplies `recommendedId`: the picker's own preselect is
 * COST-TIER driven (`computePreselectedId`), which disagrees with the
 * wizard card's family flagship -- for DeepSeek, `v3.2` vs `v4-pro`.
 * Owner ruling (#138, 2026-08-24) is that the flagship wins, so that
 * opening the drill-down and accepting is a guaranteed no-op. The tier
 * preselect remains the fallback when the flagship matches no row.
 */

'use strict';

const { buildProviderDefaultChoices } = require('./provider-default-picker');
const { pairAcrossGateways } = require('./gateway-route-catalog');

/** Rows shown before the "all models" group. */
const SHORTLIST_LIMIT = 8;

/**
 * Both gateway spellings of a row id, so a surface can honour an explicit
 * "via OpenRouter" choice for a drilled-down model. NEVER derives one form
 * from the other -- `pairAcrossGateways` reads real catalog rows, which is
 * the only safe move for DIVERGENT_VENDORS (anthropic's direct and
 * OpenRouter ids are different strings, not differently prefixed).
 * @param {string} vendor
 * @param {string} id verbatim picker row id
 * @param {Array<{id:string}>} catalog
 * @returns {{directId: (string|null), openrouterId: (string|null)}}
 */
function routeFormsFor(vendor, id, catalog) {
  const token = id.replace(/^openrouter\//, '').replace(`${vendor}/`, '');
  const paired = pairAcrossGateways(vendor, token, { models: catalog });
  return {
    directId: paired.direct || null,
    openrouterId: paired.openrouter || null,
  };
}

/**
 * Recommended-first, then price-ascending, nulls last -- the same order
 * `provider-default-picker.js`'s `compareRows` already establishes, so the
 * drill-down reads like the picker the user may already have seen.
 */
function compareShortlistRows(a, b) {
  if (a.isRecommended !== b.isRecommended) { return a.isRecommended ? -1 : 1; }
  if (a.pricePerMInput === null && b.pricePerMInput === null) { return 0; }
  if (a.pricePerMInput === null) { return 1; }
  if (b.pricePerMInput === null) { return -1; }
  return a.pricePerMInput - b.pricePerMInput;
}

/**
 * @param {string} vendor e.g. 'deepseek'
 * @param {{catalog?: Array<object>, recommendedId?: string, limit?: number}} [options]
 * @returns {{recommendedId: (string|null), suggested: Array<object>,
 *   rest: Array<object>, total: number}}
 */
function buildModelShortlist(vendor, options = {}) {
  const catalog = Array.isArray(options.catalog) ? options.catalog : [];
  const limit = Number.isInteger(options.limit) && options.limit > 0
    ? options.limit : SHORTLIST_LIMIT;

  const { preselectedId, rows } = buildProviderDefaultChoices(vendor, { catalog });
  if (!rows || rows.length === 0) {
    return { recommendedId: null, suggested: [], rest: [], total: 0 };
  }

  // Owner ruling: the family flagship wins when it names a real row;
  // otherwise keep the picker's tier preselect rather than inventing one.
  const wanted = options.recommendedId;
  const recommendedId = (wanted && rows.some(r => r.id === wanted)) ? wanted : preselectedId;

  const annotated = rows.map(r => Object.assign({
    id: r.id,
    name: r.name,
    contextLength: r.contextLength,
    pricePerMInput: r.pricePerMInput,
    isRecommended: r.id === recommendedId,
  }, routeFormsFor(vendor, r.id, catalog)));

  annotated.sort(compareShortlistRows);

  return {
    recommendedId,
    suggested: annotated.slice(0, limit),
    rest: annotated.slice(limit),
    total: annotated.length,
  };
}

module.exports = { buildModelShortlist, compareShortlistRows, SHORTLIST_LIMIT };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest tests/model-shortlist.test.js`
Expected: PASS, 7 tests.

- [ ] **Step 5: Verify the size gate and run the neighbours**

Run: `node scripts/check-file-sizes.js --all && npx jest tests/provider-default-picker.test.js tests/quick-picks.test.js`
Expected: size gate clean; both existing suites pass unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/utils/model-shortlist.js tests/model-shortlist.test.js
git commit -m "feat(#138): add vendor model shortlist core

Pure module splitting a vendor's priced picker rows into suggested/rest so
setup can offer a family -> model second level. Caller supplies the
recommended id (the family flagship) because the picker's own preselect is
cost-tier driven and disagrees."
```

---

### Task 2: Readline drill-down

**Files:**
- Modify: `src/sidecar/setup.js` (after the family pick at `:465`)
- Test: `tests/setup-readline-model-drilldown.test.js` (new file — **do not** add to `setup-readline.test.js`, whose mock answers every prompt identically)

**Interfaces:**
- Consumes: `buildModelShortlist` (Task 1); `askQuestion(rl, q)` (`src/sidecar/setup.js`); `getFamilies()` (`./curated-models`) for the family → `vendorPath` mapping.
- Produces: `promptForVendorModel(ask, print, shortlist, vendorPath)` → `Promise<string|null>` — the chosen model id, or `null` to keep the family default.

- [ ] **Step 1: Write the failing test**

Create `tests/setup-readline-model-drilldown.test.js`:

```js
'use strict';

const { promptForVendorModel } = require('../src/sidecar/setup');

function shortlist() {
  const mk = (id, price, rec) => ({
    id, name: id.split('/').pop(), contextLength: 128000,
    pricePerMInput: price, isRecommended: !!rec,
    directId: id, openrouterId: 'openrouter/' + id,
  });
  return {
    recommendedId: 'deepseek/deepseek-v4-pro',
    suggested: [
      mk('deepseek/deepseek-v4-pro', 0.52, true),
      mk('deepseek/deepseek-v4-flash', 0.06),
    ],
    rest: [mk('deepseek/deepseek-r1', 0.70)],
    total: 3,
  };
}

// FIFO mock: each call consumes the next scripted answer. Required — the
// shared mockReadline in setup-readline.test.js returns ONE answer to every
// prompt, which would silently absorb this new sub-prompt.
function fifoAsk(answers) {
  const queue = answers.slice();
  const asked = [];
  const ask = (q) => { asked.push(q); return Promise.resolve(queue.shift()); };
  return { ask, asked };
}

describe('promptForVendorModel', () => {
  test('bare Enter keeps the family default (returns null)', async () => {
    const { ask } = fifoAsk(['']);
    await expect(promptForVendorModel(ask, () => {}, shortlist(), 'deepseek'))
      .resolves.toBeNull();
  });

  test('a number selects that suggested row', async () => {
    const { ask } = fifoAsk(['2']);
    await expect(promptForVendorModel(ask, () => {}, shortlist(), 'deepseek'))
      .resolves.toBe('deepseek/deepseek-v4-flash');
  });

  test('"a" prints the full list and then accepts a number spanning it', async () => {
    const lines = [];
    const { ask } = fifoAsk(['a', '3']);
    const chosen = await promptForVendorModel(ask, l => lines.push(l), shortlist(), 'deepseek');
    expect(chosen).toBe('deepseek/deepseek-r1');
    expect(lines.join('\n')).toContain('deepseek/deepseek-r1');
  });

  test('a pasted full model id is accepted verbatim', async () => {
    const { ask } = fifoAsk(['deepseek/deepseek-chat']);
    await expect(promptForVendorModel(ask, () => {}, shortlist(), 'deepseek'))
      .resolves.toBe('deepseek/deepseek-chat');
  });

  test('an invalid entry re-prompts once, then keeps the family default', async () => {
    const { ask, asked } = fifoAsk(['zzz', 'zzz']);
    await expect(promptForVendorModel(ask, () => {}, shortlist(), 'deepseek'))
      .resolves.toBeNull();
    expect(asked).toHaveLength(2);
  });

  test('the prompt does NOT contain "Pick a number"', async () => {
    // Guard rail: tests/sidecar/setup.test.js:392,475 branch on that literal
    // and would answer '' here, making any new coverage fake-green.
    const { ask, asked } = fifoAsk(['']);
    await promptForVendorModel(ask, () => {}, shortlist(), 'deepseek');
    expect(asked.join(' ')).not.toContain('Pick a number');
  });

  test('an empty shortlist is a silent no-op — never prompts', async () => {
    const { ask, asked } = fifoAsk([]);
    const empty = { recommendedId: null, suggested: [], rest: [], total: 0 };
    await expect(promptForVendorModel(ask, () => {}, empty, 'deepseek'))
      .resolves.toBeNull();
    expect(asked).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/setup-readline-model-drilldown.test.js`
Expected: FAIL — `promptForVendorModel is not a function`.

- [ ] **Step 3: Implement `promptForVendorModel` in `src/sidecar/setup.js`**

Add above `runReadlineSetup`, and add `promptForVendorModel` to the existing `module.exports`:

```js
/**
 * #138 second level: after a family pick, let the user name a SPECIFIC model
 * from that vendor. Returns the chosen catalog id, or null to keep the
 * family default (bare Enter, an empty shortlist, or two invalid entries).
 *
 * The prompt deliberately avoids the substring "Pick a number":
 * tests/sidecar/setup.test.js:392,475 branch on that literal and would
 * answer '' here, leaving new coverage green but vacuous.
 * @param {(q: string) => Promise<string>} ask
 * @param {(line: string) => void} print
 * @param {{suggested: Array<object>, rest: Array<object>, total: number}} shortlist
 * @param {string} vendorPath
 * @returns {Promise<string|null>}
 */
async function promptForVendorModel(ask, print, shortlist, vendorPath) {
  if (!shortlist || shortlist.total === 0) { return null; }

  let visible = shortlist.suggested;
  const fmt = (r, i) => {
    const price = r.pricePerMInput === null ? 'n/a' : `$${r.pricePerMInput.toFixed(2)}/M in`;
    const ctx = r.contextLength == null ? '' : ` · ctx ${r.contextLength}`;
    return `  ${i + 1}) ${r.id}${ctx} · ${price}${r.isRecommended ? '  (recommended)' : ''}`;
  };

  const render = () => {
    print('');
    print(`Which ${vendorPath} model?`);
    visible.forEach((r, i) => print(fmt(r, i)));
    if (visible.length < shortlist.total) {
      print(`  … ${shortlist.total - visible.length} more`);
    }
    print('');
  };
  render();

  for (let attempt = 0; attempt < 2; attempt++) {
    const hint = visible.length < shortlist.total ? ", 'a' for all" : '';
    const answer = (await ask(
      `Choose 1-${visible.length}${hint}, a full model id, or Enter to keep the default: `
    ) || '').trim();

    if (answer === '') { return null; }
    if (answer.toLowerCase() === 'a' && visible.length < shortlist.total) {
      visible = shortlist.suggested.concat(shortlist.rest);
      render();
      attempt--; // expanding the list is not a failed attempt
      continue;
    }
    if (/^\d+$/.test(answer)) {
      const n = Number.parseInt(answer, 10);
      if (n >= 1 && n <= visible.length) { return visible[n - 1].id; }
    }
    if (answer.includes('/')) { return answer; }
    if (attempt === 0) { print(`Invalid choice: "${answer}".`); }
  }
  return null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest tests/setup-readline-model-drilldown.test.js`
Expected: PASS, 7 tests.

- [ ] **Step 5: Wire it into the wizard's family-pick branch**

In `src/sidecar/setup.js`, inside `runReadlineSetup`, in the `if (chosen.alias)` branch, immediately after the existing `cfg.aliases[chosen.alias] = toStorableRoute(pick);` line, insert:

```js
      // #138: offer the family -> model second level. `pick.vendorPath` is
      // the vendor whose catalog rows we drill into; a chosen id REPLACES
      // the flagship route for this alias only. Guarded — a picker failure
      // must never abort a setup run that has already collected keys.
      if (pick) {
        try {
          const { buildModelShortlist } = require('../utils/model-shortlist');
          const shortlist = buildModelShortlist(pick.vendorPath, {
            catalog,
            recommendedId: cfg.aliases[chosen.alias],
          });
          const specific = await promptForVendorModel(
            askQuestion.bind(null, rl), console.log, shortlist, pick.vendorPath
          );
          if (specific) { cfg.aliases[chosen.alias] = specific; }
        } catch (err) {
          console.log(`Note: couldn't list ${pick.vendorPath} models (${err.message}).`);
        }
      }
```

- [ ] **Step 6: Run the readline suites to prove nothing regressed**

Run: `npx jest tests/setup-readline.test.js tests/setup-readline-local.test.js tests/sidecar/setup.test.js tests/setup-readline-model-drilldown.test.js`
Expected: all pass. **If `setup-readline.test.js` passes without modification, confirm by reading its mock that it is genuinely unaffected** (its single-answer mock will answer the new prompt with the same string — verify the resulting assertion is still meaningful, and if the string happens to be a digit that now selects a model, fix that test explicitly rather than letting it pass by luck.)

- [ ] **Step 7: Commit**

```bash
git add src/sidecar/setup.js tests/setup-readline-model-drilldown.test.js
git commit -m "feat(#138): readline family -> model second level

After a family pick, offer that vendor's models (8 suggested, 'a' for all,
or paste any id). Enter keeps today's behaviour exactly."
```

---

### Task 3: GUI — build shortlists and render the per-card `<select>`

**Files:**
- Modify: `electron/main.js` (near `:327-337`, where `getCatalog` + `resolveQuickPicks` already run)
- Modify: `electron/setup-ui-model.js` (`buildModelStepHTML`)
- Test: `tests/setup-ui-model.test.js` (extend), `tests/electron/setup-ui-model-search.test.js` (verify unaffected)

**Interfaces:**
- Consumes: `buildModelShortlist` (Task 1).
- Produces: `buildModelStepHTML(choices, selectedAlias, configuredKeys, shortlists)` — a **new fourth parameter**, `Object<aliasName, Shortlist>`, defaulting to `{}` so every existing call site and test keeps working unchanged.
  Each card gains `<select class="model-pick" data-alias="<alias>">` with two optgroups.

- [ ] **Step 1: Write the failing test**

Append to `tests/setup-ui-model.test.js`:

```js
describe('#138 per-card model drill-down', () => {
  const choices = [{
    alias: 'deepseek', label: 'DeepSeek flagship', blurb: 'open-source',
    source: 'live',
    routes: { openrouter: 'openrouter/deepseek/deepseek-v4-pro',
              deepseek: 'deepseek/deepseek-v4-pro' },
  }];
  const mk = (id, price, rec) => ({
    id, name: id.split('/').pop(), contextLength: 128000,
    pricePerMInput: price, isRecommended: !!rec,
    directId: id, openrouterId: 'openrouter/' + id,
  });
  const shortlists = {
    deepseek: {
      recommendedId: 'deepseek/deepseek-v4-pro',
      suggested: [mk('deepseek/deepseek-v4-pro', 0.52, true),
                  mk('deepseek/deepseek-v4-flash', 0.06)],
      rest: [mk('deepseek/deepseek-r1', 0.70)],
      total: 3,
    },
  };

  test('renders a model <select> for the card', () => {
    const html = buildModelStepHTML(choices, 'deepseek', { deepseek: true }, shortlists);
    expect(html).toContain('class="model-pick" data-alias="deepseek"');
  });

  test('the recommended model is the selected option', () => {
    const html = buildModelStepHTML(choices, 'deepseek', { deepseek: true }, shortlists);
    expect(html).toMatch(/<option value="deepseek\/deepseek-v4-pro" selected>/);
  });

  test('every model is reachable — including one only in `rest`', () => {
    const html = buildModelStepHTML(choices, 'deepseek', { deepseek: true }, shortlists);
    expect(html).toContain('value="deepseek/deepseek-r1"');
    expect(html).toContain('Suggested');
    expect(html).toContain('All 3 models');
  });

  test('omitting the shortlists argument renders exactly today\'s card', () => {
    const withArg = buildModelStepHTML(choices, 'deepseek', { deepseek: true }, {});
    const without = buildModelStepHTML(choices, 'deepseek', { deepseek: true });
    expect(withArg).toBe(without);
    expect(without).not.toContain('model-pick');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/setup-ui-model.test.js -t "#138"`
Expected: FAIL — no `model-pick` in the output.

- [ ] **Step 3: Implement in `electron/setup-ui-model.js`**

Add this helper above `buildModelStepHTML`:

```js
/**
 * #138: the family -> model second level for one card. Renders EVERY model
 * in one <select> (scrollable and type-ahead searchable, so nothing is
 * hidden), grouped "Suggested" / "All N models". Returns '' when no
 * shortlist was supplied, so callers that pass nothing get today's card
 * byte-for-byte.
 * @param {string} alias
 * @param {{recommendedId:string, suggested:Array<object>, rest:Array<object>, total:number}} [shortlist]
 * @returns {string} HTML fragment
 */
function buildModelPickHTML(alias, shortlist) {
  if (!shortlist || !shortlist.total) { return ''; }
  const opt = (r) => {
    const price = r.pricePerMInput === null ? '' : ` · $${r.pricePerMInput.toFixed(2)}/M`;
    const sel = r.isRecommended ? ' selected' : '';
    return `<option value="${r.id}"${sel}>${r.id}${price}</option>`;
  };
  let html = `<select class="model-pick" data-alias="${alias}">`;
  html += `<optgroup label="Suggested">${shortlist.suggested.map(opt).join('')}</optgroup>`;
  if (shortlist.rest.length > 0) {
    html += `<optgroup label="All ${shortlist.total} models">${shortlist.rest.map(opt).join('')}</optgroup>`;
  }
  return html + '</select>';
}
```

Change the signature and the card template:

```js
function buildModelStepHTML(choices, selectedAlias, configuredKeys = {}, shortlists = {}) {
```

and inside the `choices.map(c => {…})` body, after the `routeHtml` block, add:

```js
    const modelPickHtml = buildModelPickHTML(c.alias, shortlists[c.alias]);
```

then insert `${modelPickHtml}` into the returned template immediately after `${routeHtml}`:

```js
        ${routeHtml}
        ${modelPickHtml}
```

Export it: `module.exports = { buildModelSearchHTML, buildModelStepHTML, buildModelPickHTML, PROVIDER_NAMES };`

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest tests/setup-ui-model.test.js`
Expected: PASS — the new `#138` block plus every pre-existing test in the file.

- [ ] **Step 5: Build the shortlists in `electron/main.js`**

At the site where `quickPicks` is resolved (`~:327-337`), after `resolveQuickPicks`, add:

```js
  // #138: one vendor shortlist per family card, resolved server-side from
  // the same catalog the quick picks came from (no extra IPC round-trip).
  const { buildModelShortlist } = require('../src/utils/model-shortlist');
  const shortlists = {};
  for (const p of quickPicks) {
    try {
      shortlists[p.alias] = buildModelShortlist(p.vendorPath, {
        catalog: catalogModels,
        recommendedId: p.routes && (p.routes[p.vendorPath] || p.routes.openrouter),
      });
    } catch (_e) { /* a shortlist failure must never block the wizard */ }
  }
```

Use whatever local name the surrounding code already binds the catalog rows to instead of `catalogModels` — **read the surrounding lines and match them; do not introduce a new variable name.** Then pass `shortlists` through `buildSetupHTML` to `buildModelStepHTML` as the fourth argument.

- [ ] **Step 6: Verify the wiring and run the electron suites**

Run: `npx jest tests/setup-ui-model.test.js tests/setup-ui.test.js tests/electron/ && node scripts/check-file-sizes.js --all`
Expected: all pass, size gate clean.

- [ ] **Step 7: Commit**

```bash
git add electron/setup-ui-model.js electron/main.js tests/setup-ui-model.test.js
git commit -m "feat(#138): per-card model <select> in setup Step 2

Each family card gains a model dropdown grouped Suggested / All N. Omitting
the new shortlists argument renders the previous card byte-for-byte."
```

---

### Task 4: GUI — honour the pick on Finish (the mandatory clobber fix)

**Files:**
- Modify: `electron/setup-ui.js` (`:404-429` Finish handler, `:538-554` `updateWritePreviews`)
- Test: `tests/setup-ui.test.js`

**Interfaces:**
- Consumes: `buildModelPickHTML`'s `.model-pick[data-alias]` element (Task 3).
- Produces: in-page state `modelChoiceIds = {}` (alias → chosen model id), consulted by `pickRouteFor` before `routingChoices`.

**Why this task is not optional:** `electron/setup-ui.js:422` today does `aliasWrites[mc.alias] = routeId` **unconditionally**, so a Task-3 pick would be silently overwritten by the flagship on Finish. This is backlog "#138 Piece 2".

- [ ] **Step 1: Write the failing test**

Add to `tests/setup-ui.test.js`, following the file's existing pattern for extracting an in-page function with `new Function(...)` (read the surrounding examples at `:270-290` and match their extraction style exactly — that harness is brittle to reindentation):

```js
describe('#138 Finish honours a drilled-down model', () => {
  test('a chosen model id wins over the family flagship route', () => {
    const modelChoiceIds = { deepseek: 'deepseek/deepseek-r1' };
    const mc = { alias: 'deepseek',
                 routes: { openrouter: 'openrouter/deepseek/deepseek-v4-pro',
                           deepseek: 'deepseek/deepseek-v4-pro' } };
    // pickRouteFor must consult modelChoiceIds FIRST.
    const routeId = modelChoiceIds[mc.alias] || mc.routes[mc.vendorPath];
    expect(routeId).toBe('deepseek/deepseek-r1');
  });

  test('an explicit OpenRouter pill keeps the openrouter/ prefix on the chosen model', () => {
    const modelChoiceIds = { deepseek: 'deepseek/deepseek-r1' };
    const explicit = { deepseek: 'openrouter' };
    const openrouterIds = { 'deepseek/deepseek-r1': 'openrouter/deepseek/deepseek-r1' };
    const chosen = modelChoiceIds.deepseek;
    const out = explicit.deepseek === 'openrouter' ? openrouterIds[chosen] : chosen;
    expect(out).toBe('openrouter/deepseek/deepseek-r1');
  });
});
```

> **Note for the implementer:** the two assertions above encode the *required behaviour* but compute it locally, because this repo has no jsdom and `pickRouteFor` is an in-page closure. Prefer extracting the real `pickRouteFor` via the file's existing `new Function` harness if you can do so without reindenting it; if you cannot, keep these as contract tests **and** add the DOM-free unit coverage to `tests/model-shortlist.test.js` instead. State in the commit message which route you took.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/setup-ui.test.js -t "#138"`
Expected: FAIL before the implementation exists (or, if written as pure contract tests, they pass trivially — in that case rely on Step 6's manual CDP verification as the real gate and say so).

- [ ] **Step 3: Add the state and the change handler**

In `electron/setup-ui.js`, beside the existing `routingChoices` / `explicitRouteChoices` declarations, add:

```js
  // #138: alias -> a SPECIFIC model id the user drilled down to. Empty
  // means "use the family flagship", i.e. today's behaviour.
  var modelChoiceIds = {};
  var modelOpenrouterIds = {};
```

Add a change handler near the existing route-pill click handler:

```js
  document.addEventListener('change', function(e) {
    var sel = e.target && e.target.closest ? e.target.closest('.model-pick') : null;
    if (!sel) { return; }
    var alias = sel.getAttribute('data-alias');
    if (!alias) { return; }
    modelChoiceIds[alias] = sel.value;
    var opt = sel.options[sel.selectedIndex];
    modelOpenrouterIds[alias] = (opt && opt.getAttribute('data-or')) || null;
    updateWritePreviews();
  });
```

For `data-or` to exist, add it in `buildModelPickHTML` (Task 3) — amend that `opt` function to emit `data-or="${r.openrouterId || ''}"` on each `<option>`, and extend the Task-3 test to assert it.

- [ ] **Step 4: Make `pickRouteFor` consult the choice**

In `pickRouteFor`, immediately after the `if (!mc) { return null; }` guard:

```js
    // #138: an explicit per-model choice overrides the family flagship.
    var picked = modelChoiceIds[mc.alias];
    if (picked) {
      if (routingChoices[mc.alias] === 'openrouter' && explicitRouteChoices[mc.alias]) {
        return modelOpenrouterIds[mc.alias] || picked;
      }
      return picked;
    }
```

This is the whole clobber fix: `pickRouteFor` is what the Finish handler calls at `:421`, and `updateWritePreviews` calls at `:551`, so both now show and write the same thing.

- [ ] **Step 5: Run the GUI suites**

Run: `npx jest tests/setup-ui.test.js tests/setup-ui-model.test.js tests/electron/`
Expected: all pass.

- [ ] **Step 6: Verify against the real window over CDP**

The unit suites cannot exercise a real `<select>`. Stage a run and drive the actual Workspace/setup window with `AMICUS_DEBUG_PORT` (see the "Amicus Electron GUI smoke" procedure — beware the run-switch race and the `file://` cache trap that both produce false readings). Confirm by reading the written config that choosing `deepseek-r1` in the dropdown and clicking Finish yields `aliases.deepseek === 'deepseek/deepseek-r1'`.

- [ ] **Step 7: Commit**

```bash
git add electron/setup-ui.js electron/setup-ui-model.js tests/setup-ui.test.js
git commit -m "fix(#138): Finish must not clobber a drilled-down model

setup-ui.js:422 wrote the family flagship unconditionally, erasing any
per-model pick. pickRouteFor now consults modelChoiceIds first, so the
write preview and the saved config agree."
```

---

### Task 5: Refresh the stale `.model-resolved` label

**Files:**
- Modify: `electron/setup-ui-model.js:131` (add `data-alias`), `electron/setup-ui.js` (`updateWritePreviews`)
- Test: `tests/setup-ui-model.test.js`

**Interfaces:** Consumes `pickRouteFor` (Task 4). Produces no new exports.

**Why:** `.model-resolved` is written once at build time and referenced by no script (grep over `electron/` returns only that line and its CSS at `setup-ui-styles.js:353`), so it keeps showing the OpenRouter id after a direct-pill click. Cosmetic today; actively misleading once per-model choice lands.

- [ ] **Step 1: Write the failing test**

```js
test('#138 the resolved-id span carries its alias so it can be refreshed', () => {
  const html = buildModelStepHTML(choices, 'deepseek', { deepseek: true }, shortlists);
  expect(html).toContain('class="model-resolved" data-alias="deepseek"');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest tests/setup-ui-model.test.js -t "resolved-id span"`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `electron/setup-ui-model.js`, change line 131 from
`<span class="model-resolved">${previewId}</span>` to
`<span class="model-resolved" data-alias="${c.alias}">${previewId}</span>`.

In `electron/setup-ui.js`'s `updateWritePreviews`, after the existing `.write-preview` loop, add:

```js
    // #138: keep the resolved-id line in step with the route/model choice.
    document.querySelectorAll('.model-resolved').forEach(function(el) {
      var alias = el.getAttribute('data-alias');
      var mc = null;
      for (var i = 0; i < modelChoicesData.length; i++) {
        if (modelChoicesData[i].alias === alias) { mc = modelChoicesData[i]; break; }
      }
      if (!mc) { return; }
      var id = pickRouteFor(mc);
      if (id) { el.textContent = id; }
    });
```

- [ ] **Step 4: Run tests**

Run: `npx jest tests/setup-ui-model.test.js tests/setup-ui.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/setup-ui-model.js electron/setup-ui.js tests/setup-ui-model.test.js
git commit -m "fix(#138): refresh the resolved-model line on route/model change

It was written once at build time and never updated, so it kept showing the
OpenRouter id after a direct-pill click."
```

---

### Task 6: Correct the picker's false header claim

**Files:** Modify `src/utils/provider-default-picker.js:88-90`. No test — this is a documentation correction of a statement the code disproves.

**Why:** the header says *"Every row id is verbatim from the catalog … never fabricated."* **Measured false:** all 14 rows `buildProviderDefaultChoices('deepseek')` returns carry bare `deepseek/…` ids synthesised by `chooseRowId` → `toCanonicalDefault` from `openrouter/deepseek/…` rows, because the catalog holds **zero** `deepseek/*` rows.

- [ ] **Step 1: Replace the false sentence**

In the `buildRows` JSDoc, replace the "never fabricated" claim with:

```
 * Row ids are verbatim catalog ids whenever a real row carries them: a
 * direct row keeps its own id, and an OpenRouter row collapses onto a
 * direct twin only when `pairAcrossGateways` found exactly one. For a
 * NON-divergent vendor with no direct twin at all, `chooseRowId` derives
 * the bare form via `toCanonicalDefault` -- that id is SYNTHESISED, not
 * verbatim. Measured 2026-08-24: all 14 `deepseek` rows are derived this
 * way, because the catalog carries no `deepseek/*` rows. This is safe for
 * routing (a bare id is policy-routed direct-first and falls back to
 * OpenRouter) but it is not a catalog-confirmed direct id, and callers
 * that need that distinction should consult
 * `curated-models.js`'s `directFormProvenance()`.
```

- [ ] **Step 2: Verify nothing depended on the old wording**

Run: `grep -rn "never fabricated" src/ tests/ docs/ electron/`
Expected: no remaining hits. If any test or doc quotes the phrase, update it in the same commit — an edited comment whose twin survives elsewhere is exactly the falsified-record failure mode.

- [ ] **Step 3: Run the suites and the size gate**

Run: `npx jest tests/provider-default-picker.test.js tests/provider-default-picker-local.test.js && node scripts/check-file-sizes.js --all`
Expected: PASS; `provider-default-picker.js` still under 300.

- [ ] **Step 4: Commit**

```bash
git add src/utils/provider-default-picker.js
git commit -m "docs(#138): the picker DOES synthesise direct ids — say so

All 14 deepseek rows are derived via toCanonicalDefault because the catalog
has no deepseek/* rows, which the 'never fabricated' claim denied."
```

---

### Task 7: Give the Settings window a live catalog

**Files:** Modify `electron/main.js:~515`. Test: `tests/electron/main-security-wiring.test.js` or the nearest existing main-wiring suite — read which file already asserts on `createSetupWindow`'s arguments and extend that one.

**Why:** the Settings path builds the wizard with **no** `quickPicks`, so `setup-ui.js:27` falls back to `resolveQuickPicks([])` and every Step-2 card shows a pinned id badged `[offline list]` even with a fresh catalog on disk. A live per-model dropdown (Task 3) sitting under a stale badged flagship would be incoherent.

- [ ] **Step 1: Read both construction sites and diff them**

Run: `grep -n "buildSetupHTML\|resolveQuickPicks\|getCatalog" electron/main.js`
Identify the setup-window site (`~:327-351`, which passes `quickPicks`) and the settings site (`~:515`, which does not).

- [ ] **Step 2: Write the failing test**

Assert that the settings construction path passes a non-empty `quickPicks` when the catalog cache is populated, mirroring however the existing suite stubs `getCatalog`.

- [ ] **Step 3: Run it to verify it fails**

Expected: FAIL — settings passes no quick picks.

- [ ] **Step 4: Mirror the setup-window resolution into the settings site**

Apply the same `getCatalog()` → `resolveQuickPicks()` → `buildModelShortlist()` sequence used at `:327-337`, and pass both `quickPicks` and `shortlists` through. Keep it inside the same guard style the surrounding code uses.

- [ ] **Step 5: Run the electron suites**

Run: `npx jest tests/electron/ tests/setup-ui.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add electron/main.js tests/electron/
git commit -m "fix(#138): Settings window builds Step 2 from the live catalog

It passed no quickPicks, so every card showed a pinned id badged 'offline
list' even with a fresh catalog on disk."
```

---

### Task 8: Full verification and PR

- [ ] **Step 1: Full suite**

Run: `npm test`
Expected: ≥ 551 suites, 0 failures. Record the **actual** numbers — do not restate the baseline as if it were the result.

- [ ] **Step 2: Gates**

Run: `node scripts/check-file-sizes.js --all && npx eslint . && node scripts/check-citations.js --all`
Expected: all clean. Note: `check-citations.js` is blind to bare `(:59)`-style refs and does not scan the doc tree, so **manually re-open every `file:line` this plan's comments cite against the final tree** — a citation corrected to a new wrong value is worse than the original rot.

- [ ] **Step 3: Phrase sweep, both directions**

Run a sweep for any comment or doc sentence this work falsified:

```bash
grep -rn "one per family\|one row per family\|no model-level\|never fabricated" src/ electron/ tests/ docs/ BACKLOG.md
```

Then a **target** sweep by the symbols that moved — `buildModelStepHTML`, `pickRouteFor`, `model-resolved` — because a phrase sweep structurally cannot find a true sentence, in words you never wrote, that this change turned false.

- [ ] **Step 4: Update BACKLOG.md**

Mark the "Setup polish — #138" entry (`BACKLOG.md:6002`) done, naming what shipped and what did not. State explicitly whether Piece 3 (deferred to v4.9.0 at `docs/superpowers/plans/2026-08-16-v48-phasing-and-rulings.md:769`) is now closed or still open.

- [ ] **Step 5: Real-run smoke**

Run `amicus setup` from a scratch `AMICUS_CONFIG_DIR` and walk the readline path end to end; confirm the written `config.json` has `aliases.deepseek` pointing at the drilled-down model and `default` at the alias **name**, not a raw id.

- [ ] **Step 6: Push and open the PR**

```bash
git push -u origin fix/138-model-level-default
gh pr create -R BourbonDog/amicus --fill
```

The PR body must state the measured suite numbers, the CDP verification result from Task 4 Step 6, and which of the two routes Task 4 Step 1 took.

---

## Self-Review

**Spec coverage.** Decision 1 (top-8 + show-all) → Tasks 1, 2, 3. Decision 2 (GUI + readline) → Task 2 (readline), Tasks 3–5, 7 (GUI). Decision 3 (family flagship recommended) → Task 1's `recommendedId` override, tested. Decision 4 (bundled defects) → Task 4 (clobber, mandatory), Task 5 (stale label), Task 6 (false header), Task 7 (settings catalog). Issue #138's literal complaint → Tasks 2 + 3.

**Known gaps, stated rather than hidden:**
- **Task 4's tests are weaker than the rest.** No jsdom exists in this repo and `pickRouteFor` is an in-page closure, so the real `<select>` → Finish path is covered by CDP smoke (Task 4 Step 6), not by Jest. This is called out in the task and must be reported in the PR.
- **The suggested-8 for DeepSeek omits `deepseek-r1`** (it ranks 9th by price). It is reachable in the GUI `<select>`'s second optgroup with no extra click and in readline via `a`. If that proves annoying in use, the fix is a diversity-aware ranking in `model-shortlist.js` — deliberately not attempted here.
- **`gemini` and `gemini-pro` are two families over one vendor**, so both cards will show the same Google model list with different recommended entries. Correct, but worth a look during the smoke test.

**Type consistency.** `buildModelShortlist` returns `{recommendedId, suggested, rest, total}` in Task 1 and is consumed with exactly those keys in Tasks 2, 3, 7. Row fields `{id, name, contextLength, pricePerMInput, isRecommended, directId, openrouterId}` are produced in Task 1 and read in Tasks 2 (`id`, `pricePerMInput`, `contextLength`, `isRecommended`), 3 (`id`, `pricePerMInput`, `isRecommended`, `openrouterId`), and 4 (`openrouterId` via `data-or`). `buildModelStepHTML`'s fourth parameter is `shortlists` in both Task 3 and Task 7.
