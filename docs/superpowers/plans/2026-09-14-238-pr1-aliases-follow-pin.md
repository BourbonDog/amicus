# #238 PR 1 — Follow-or-Pin Aliases, Phase 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Phase 1 of the #238 design: a curated alias follows the shipped pin when absent from `config.aliases` and is pinned when present; the wizard stops seeding; a new `amicus aliases` command lists following/pinned state and walks review proposals in a picker; the drift report can no longer propose a downgrade; the copy-paste `--add-alias` hints point at the picker.

**Architecture:** One pure engine (`src/utils/alias-proposals.js`) turns `(config.aliases, DEFAULT_ALIASES, catalogInfo, dismissed)` into one proposal per alias. One CLI renderer (`src/sidecar/aliases.js` + `aliases-review.js`) reads the engine and writes through two sinks: `setup.js :: addAlias` (set) and a new `alias-store.js` (remove, dismiss). `saveConfig` normalizes: a key whose value equals the shipped default is dropped with a Notice, so "accept the shipped pin" and "unpin" are the same write. A lifted tier-safe sibling comparator (`src/utils/model-id-siblings.js`) serves the engine, the CI pin checker and, in Phase 2, `models --check`.

**Tech Stack:** Node 22 CommonJS, Jest (unit suite: `npm test`, single file: `npx jest tests/<file>`), readline for the picker, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-14-238-alias-follow-pin-design.md` — D1, D2, D4 (user half), D6, D7 (mechanical half + dismissal), §2, §4, §5, §6 groups 1–6 and 10 (hint rows), §7 Phase 1, §8 Q2/Q3/Q4/Q5 (dismissal half)/Q9.

## Global Constraints

- **300-line gate:** every file under `src/**/*.js` and `electron/**/*.js` stays ≤ 300 lines (`scripts/check-file-sizes.js`, blocks the commit). `src/utils/result-schema.js` and `src/utils/curated-models.js` are at exactly 300 — do not add a line to either. `src/sidecar/setup.js` (756) and `src/utils/config.js` (790) are grandfathered: net-zero or shrinking edits only.
- **New module shape:** `@module` docblock FIRST, then `'use strict'`, ≤ 5 exports, JSDoc on every export.
- **Docs sync:** the pre-commit hook regenerates and auto-stages `docs/architecture-map.md`; let it. Never hand-edit the AUTO sections. `CLAUDE.md` is not edited by this PR.
- **Test rails:** unit tests via `npx jest tests/<file>` during a task and `npm test` at integration. NEVER run jest with `--testMatch` and never run `npm run test:integration:live` (spends money). `npm run test:integration` (keyless) is allowed at integration time only.
- **Hermeticity:** every unit test that touches config runs under `tests/setup/hermetic-config-dir.js` (automatic via `jest.config.js`); tests that need a config file write it with `saveConfig` into that dir or mock `../src/utils/config` — never touch `~/.config/amicus`.
- **Prototype safety:** alias maps are read with bare indexing; every map built from user JSON is `{ __proto__: null }` / `Object.create(null)` and iterated with `Object.keys`/`Object.entries` (own keys). A key named `__proto__`, `toString` or `constructor` must never be treated as a curated alias.
- **stdout discipline:** `--json` output is byte-clean on stdout; every notice, error and prompt goes to stderr or is part of the interactive TTY dialogue.
- **Commit trailer:** every commit ends with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **Worktrees:** each parallel task runs in its own linked worktree beside the repo (`C:\Users\sendt\code\amicus-238-t<N>`) on branch `feat/238-pr1-task-<N>` cut from the integration branch, with `node_modules` junctioned from the main clone (`cmd /c mklink /J node_modules C:\Users\sendt\code\amicus\node_modules`). Never place a worktree inside the repo: jest ignores any path containing `worktrees`.

---

## File structure

| File | Status | Responsibility |
|---|---|---|
| `src/utils/model-id-siblings.js` | new (T1) | `parsePin`, `compareVersions`, `newestSibling` — the tier-safe sibling comparator, lifted verbatim from `scripts/check-ci-alias-pins.js` |
| `scripts/check-ci-alias-pins.js` | modify (T1) | consumes the lifted module; keeps its exports so its test is unchanged |
| `src/utils/quick-picks.js` | modify (T2, T5) | `pickCurrent` ignores non-authoritative rows (T2); `toLiveSeedAliases` retired (T5) |
| `src/sidecar/models.js` | modify (T2, T9) | `buildFallbackDriftReport(catalogInfo)` guards on `providerFailures` (T2); hint lines (T9) |
| `src/utils/alias-state.js` | new (T3) | `normalizeAliases`, `listAliasRows`, `isCurated` — following-vs-pinned state and the normalization that keeps config truthful |
| `src/utils/config.js` | modify (T3) | `saveConfig` calls the normalizer; `buildAliasTable` renders effective aliases |
| `src/utils/alias-store.js` | new (T4) | `removeAlias`, `readDismissals`, `recordDismissal` — the non-set write sinks |
| `src/sidecar/setup.js` | modify (T5) | `createDefaultConfig` stops seeding; readline flow writes only the chosen default's live pick when it differs from the shipped pin |
| `electron/ipc-setup.js` | modify (T5) | first-run config is `{ aliases: {} }` |
| `src/utils/alias-proposals.js` | new (T6) | `buildAliasProposals` — the pure engine, one proposal per alias |
| `src/sidecar/aliases.js` | new (T7) | `handleAliases` (dispatch, list, `--json`), `collectAliasView`, `buildAliasesDoc`, `renderAliasList` |
| `src/cli.js`, `bin/amicus.js` | modify (T7) | `aliases` command, `--review` boolean flag, usage block |
| `src/sidecar/aliases-review.js` | new (T8) | `runReview` — the readline picker and the Q2 non-TTY refusal |
| `src/utils/model-validator.js`, `src/utils/alias-resolver.js` | modify (T9) | hint lines |
| `docs/usage.md`, `docs/configuration.md`, `CHANGELOG.md` | modify (T9) | user docs |

## Parallel execution map

```
Wave 1 (4 parallel worktrees, disjoint files):   T1  T2  T3  T4
Wave 2 (2 parallel, after wave 1 merged):        T5 (needs T2's quick-picks.js)   T6 (needs T1, T3)
Wave 3 (1):                                       T7 (needs T3, T4, T6)
Wave 4 (2 parallel):                              T8 (needs T7)   T9 (needs T7 for the hint target; disjoint files from T8)
Wave 5 (1, integration worktree):                 T10 merge + full gates + whole-branch review
```

Merge rule: after each wave, `git merge --no-ff feat/238-pr1-task-<N>` into the integration branch in `C:\Users\sendt\code\amicus-238`. A conflict in `docs/architecture-map.md` is resolved by taking either side and running `node scripts/generate-docs.js`, then `git add docs/architecture-map.md`. Any other conflict is a plan defect — stop and report it.

---

### Task 1: Lift the sibling comparator into `src/utils/model-id-siblings.js`

**Files:**
- Create: `src/utils/model-id-siblings.js`
- Modify: `scripts/check-ci-alias-pins.js:22-85` (remove the three functions, require them)
- Test: `tests/utils/model-id-siblings.test.js` (new); `tests/scripts/check-ci-alias-pins.test.js` (unchanged, must still pass)

**Interfaces:**
- Consumes: nothing.
- Produces: `parsePin(id: string) → {vendor:string, prefix:string, version:number[], suffix:string} | null`; `compareVersions(a:number[], b:number[]) → number`; `newestSibling(pinned:string, catalogIds:string[]) → string|null` (strictly newer, same vendor/prefix/suffix, `~` floating ids skipped). T6 imports `newestSibling`.

- [ ] **Step 1: Write the failing test**

Create `tests/utils/model-id-siblings.test.js`:

```js
// tests/utils/model-id-siblings.test.js
'use strict';
const { parsePin, compareVersions, newestSibling } = require('../../src/utils/model-id-siblings');

const CATALOG = [
  'openrouter/z-ai/glm-5.1', 'openrouter/z-ai/glm-5.2', 'openrouter/z-ai/glm-5.2:free',
  'openrouter/z-ai/glm-5.3', 'openrouter/z-ai/glm-5-turbo', 'openrouter/~z-ai/glm-latest',
  'openrouter/openai/gpt-5.6-terra', 'openrouter/openai/gpt-5.6-sol', 'openrouter/openai/gpt-5.7-terra',
  'openrouter/moonshotai/kimi-k3', 'openrouter/moonshotai/kimi-k2.7-code',
];

describe('model-id-siblings (lifted from scripts/check-ci-alias-pins.js, #238 D7)', () => {
  test('parsePin splits vendor / prefix / version / suffix and rejects floating ids', () => {
    expect(parsePin('openrouter/z-ai/glm-5.3')).toEqual({ vendor: 'openrouter/z-ai', prefix: 'glm-', version: [5, 3], suffix: '' });
    expect(parsePin('openrouter/~z-ai/glm-latest')).toBeNull();
    expect(parsePin('no-slash')).toBeNull();
    expect(parsePin(42)).toBeNull();
  });
  test('compareVersions is numeric per segment, missing segments read as 0', () => {
    expect(compareVersions([5, 3], [5, 2])).toBeGreaterThan(0);
    expect(compareVersions([5], [5, 0])).toBe(0);
    expect(compareVersions([4, 9], [5])).toBeLessThan(0);
  });
  test('newestSibling never crosses a tier or variant suffix', () => {
    expect(newestSibling('openrouter/z-ai/glm-5.1', CATALOG)).toBe('openrouter/z-ai/glm-5.3');
    expect(newestSibling('openrouter/openai/gpt-5.6-terra', CATALOG)).toBe('openrouter/openai/gpt-5.7-terra');
    expect(newestSibling('openrouter/openai/gpt-5.6-sol', CATALOG)).toBeNull();     // sol never sees terra
    expect(newestSibling('openrouter/moonshotai/kimi-k3', CATALOG)).toBeNull();     // k2.7-code is a variant
    expect(newestSibling('openrouter/z-ai/glm-5.3', CATALOG)).toBeNull();           // already newest
  });
  test('the CI checker still exports the same three functions (its own test is the contract)', () => {
    const script = require('../../scripts/check-ci-alias-pins');
    expect(script.parsePin).toBe(parsePin);
    expect(script.newestSibling).toBe(newestSibling);
    expect(script.compareVersions).toBe(compareVersions);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest tests/utils/model-id-siblings.test.js`
Expected: FAIL — `Cannot find module '../../src/utils/model-id-siblings'`.

- [ ] **Step 3: Create the module**

Move lines 27–85 of `scripts/check-ci-alias-pins.js` (the `parsePin`, `compareVersions`, `newestSibling` functions and their docblocks) VERBATIM into `src/utils/model-id-siblings.js`, under this header:

```js
/**
 * @module utils/model-id-siblings
 * The tier-safe sibling comparator (#238 D7). A sibling shares a pin's vendor
 * path, its pre-version prefix and its post-version suffix, and differs only in
 * the version number — so `gpt-5.6-terra` is never compared against
 * `gpt-5.6-sol`, and `kimi-k3` never against `kimi-k2.7-code`. Lifted verbatim
 * from scripts/check-ci-alias-pins.js (which still consumes it) so the alias
 * review engine (alias-proposals.js) and `models --check` ask the same question
 * of the shipped pins that the CI drift gate asks of the CI alias map.
 */

'use strict';
```

End the file with `module.exports = { parsePin, compareVersions, newestSibling };`.

- [ ] **Step 4: Point the script at the module**

In `scripts/check-ci-alias-pins.js`, delete the three moved functions and add, after the `MAP_PATH` constant:

```js
const { parsePin, compareVersions, newestSibling } = require('../src/utils/model-id-siblings');
```

Keep `auditPins`, `main`, and `module.exports = { parsePin, compareVersions, newestSibling, auditPins };` exactly as they are. Update the script's header docblock: replace the sentence beginning "This script asks the other question" with "This script asks the other question — is there a NEWER sibling of each pin? — through `src/utils/model-id-siblings.js`, which also serves the alias review engine (#238)."

- [ ] **Step 5: Run both tests**

Run: `npx jest tests/utils/model-id-siblings.test.js tests/scripts/check-ci-alias-pins.test.js`
Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add src/utils/model-id-siblings.js scripts/check-ci-alias-pins.js tests/utils/model-id-siblings.test.js
git commit -m "refactor(aliases): lift the tier-safe sibling comparator into src/utils/model-id-siblings.js (#238 D7)

The CI pin checker keeps its exports and its test; the alias review engine
and models --check will consume the same comparator.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

(The pre-commit hook regenerates `docs/architecture-map.md` and stages it; that is expected.)

---

### Task 2: Safety gate — no proposal from a non-authoritative row or a rejected namespace (§5)

**Files:**
- Modify: `src/utils/quick-picks.js:37-45` (`pickCurrent`)
- Modify: `src/sidecar/models.js:129-140` (runCheck's call) and `:234-252` (`buildFallbackDriftReport`)
- Test: `tests/quick-picks.test.js` (add to the `pickCurrent` describe), `tests/models-drift.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `pickCurrent(catalog, nsPrefix, vendorPath, idPattern)` — unchanged signature, now skips rows with `authoritative === false`. `buildFallbackDriftReport(catalogOrInfo)` — accepts `{models, providerFailures}` OR a bare array (the `findDriftedStoredAliases` idiom); returns `[]` when `providerFailures` names `openrouter`.

- [ ] **Step 1: Write the failing tests**

Append inside `describe('pickCurrent', …)` in `tests/quick-picks.test.js`:

```js
  // #238 §5: the hardcoded Anthropic floor and any other non-authoritative row
  // must never be "the newest" — a partially-fetched catalog could otherwise
  // make the drift report propose an OLDER sibling than the live catalog has.
  // Named mutant "FLOORPICK" — drop the `authoritative !== false` filter.
  test('ignores non-authoritative rows even when they sort newest', () => {
    const withFloor = [
      { id: 'openrouter/google/gemini-9.9-flash', authoritative: false },
      row('openrouter/google/gemini-3.5-flash'),
    ];
    expect(pickCurrent(withFloor, 'openrouter/', 'google', flash)).toBe('openrouter/google/gemini-3.5-flash');
    expect(pickCurrent([{ id: 'openrouter/google/gemini-9.9-flash', authoritative: false }], 'openrouter/', 'google', flash)).toBeNull();
  });
```

Append to `describe('buildFallbackDriftReport', …)` in `tests/models-drift.test.js`:

```js
  // #238 §5: a REJECTED openrouter namespace leaves the catalog missing the
  // rows that would make a pin look current; reporting drift from that
  // catalog proposes a downgrade. Named mutant "FAILEDNS" — drop the
  // providerFailures guard.
  test('silent when the openrouter namespace was rejected (providerFailures)', () => {
    const info = {
      models: [row('openrouter/google/gemini-9.9-flash')],
      providerFailures: [{ provider: 'openrouter', reason: 'http-status', status: 403 }],
    };
    expect(buildFallbackDriftReport(info)).toEqual([]);
  });
  test('still reports from a catalogInfo whose failures name another provider', () => {
    const info = {
      models: [row('openrouter/google/gemini-9.9-flash')],
      providerFailures: [{ provider: 'google', reason: 'http-status', status: 401 }],
    };
    expect(buildFallbackDriftReport(info).some(l => l.includes('gemini'))).toBe(true);
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx jest tests/quick-picks.test.js tests/models-drift.test.js`
Expected: the FLOORPICK test fails (`gemini-9.9-flash` picked); the FAILEDNS test fails (a drift line is returned).

- [ ] **Step 3: Implement `pickCurrent`'s filter**

In `src/utils/quick-picks.js`, replace the body of `pickCurrent` with:

```js
function pickCurrent(catalog, nsPrefix, vendorPath, idPattern) {
  const prefix = `${nsPrefix}${vendorPath}/`;
  const ids = (Array.isArray(catalog) ? catalog : [])
    // #238 §5: a non-authoritative row (the hardcoded Anthropic floor, a
    // floor-fallback) is not evidence of what the provider serves — the same
    // guard gateway-route-audit.js :: isAuthoritative applies per gateway.
    .filter(m => m && m.authoritative !== false)
    .map(m => m.id)
    .filter(id => typeof id === 'string' && id.startsWith(prefix))
    .filter(id => idPattern.test(id.slice(prefix.length)));
  if (ids.length === 0) { return null; }
  return ids.sort(compareIdsDesc)[0];
}
```

- [ ] **Step 4: Implement the drift-report guard**

In `src/sidecar/models.js`, replace `buildFallbackDriftReport` with:

```js
/**
 * Non-blocking drift report: pinned family fallbacks vs live resolution.
 * Accepts a catalogInfo (`{models, providerFailures}`) or a bare models array
 * (older callers). Empty catalog → [] (cannot check). #238 §5: when the
 * openrouter namespace itself was REJECTED this run, the catalog is missing the
 * rows that make a pin look current, and a drift line computed from it would
 * propose a downgrade — so the report is empty for that catalog. Never affects
 * the exit code.
 * @param {{models: Array<{id:string}>, providerFailures?: Array<{provider:string}>}|Array<{id:string}>} catalogOrInfo
 * @returns {string[]} human-readable warning lines
 */
function buildFallbackDriftReport(catalogOrInfo) {
  const info = Array.isArray(catalogOrInfo) ? { models: catalogOrInfo } : (catalogOrInfo || { models: [] });
  const catalog = info.models || [];
  if (catalog.length === 0) { return []; }
  const failures = Array.isArray(info.providerFailures) ? info.providerFailures : [];
  if (failures.some(f => f && f.provider === 'openrouter')) { return []; }
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

In `runCheck`, change `const driftLines = buildFallbackDriftReport(catalog);` to `const driftLines = buildFallbackDriftReport(catalogInfo);`.

- [ ] **Step 5: Run the tests, then measure both mutants**

Run: `npx jest tests/quick-picks.test.js tests/models-drift.test.js tests/sidecar/models-command.test.js tests/alias-drift.test.js`
Expected: all PASS.

Then, for each named mutant: apply the mutation described in the test comment (delete the filter line / delete the `failures.some` line), run the same command, confirm the named test goes RED, and restore the line with `git checkout -- <file>` — commit BEFORE measuring so the restore is a clean checkout, or measure on a stash. Record the red test name in the mutant comment (`Named mutant "FLOORPICK" — … reddens 'ignores non-authoritative rows…'`).

- [ ] **Step 6: Commit**

```bash
git add src/utils/quick-picks.js src/sidecar/models.js tests/quick-picks.test.js tests/models-drift.test.js
git commit -m "fix(models): drift report cannot propose a downgrade — pickCurrent skips non-authoritative rows, buildFallbackDriftReport guards providerFailures (#238 §5)

Named mutants FLOORPICK and FAILEDNS measured red.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: `src/utils/alias-state.js` — following/pinned state and save-time normalization (D1, D6)

**Files:**
- Create: `src/utils/alias-state.js`
- Modify: `src/utils/config.js:58-86` (`saveConfig`), `:187-207` (`buildAliasTable`)
- Test: `tests/utils/alias-state.test.js` (new), `tests/config-hash.test.js` (buildAliasTable expectations), `tests/sidecar/config-change-flow.test.js` (run, adjust only if it asserts raw-map behaviour)

**Interfaces:**
- Consumes: `DEFAULT_ALIASES` (config.js module-level, null-prototype), passed in as `defaults`.
- Produces:
  - `normalizeAliases(aliases: object, defaults: object, notify?: (line:string)=>void) → { aliases: object, removed: Array<{alias:string, id:string}> }` — returns a NEW plain object with own keys in the input order minus every key whose string value `===` `defaults[key]`; calls `notify` once per removed key with `Notice: alias '<alias>' matches the shipped recommendation (<id>) — now following\n`. Never throws; a non-object input returns `{ aliases: {}, removed: [] }`.
  - `listAliasRows(userAliases: object, defaults: object) → Array<{alias:string, id:string, state:'following'|'pinned', curated:boolean, shipped:string|null}>` — every curated alias first in `defaults` key order, then every user-only key in config order. `pinned` ⇔ own key present in `userAliases` with a string value. Own keys only, on both maps.
  - `isCurated(alias: string, defaults: object) → boolean` — own-key test, so `toString`/`constructor`/`__proto__` are never curated.

- [ ] **Step 1: Write the failing test**

Create `tests/utils/alias-state.test.js`:

```js
// tests/utils/alias-state.test.js
'use strict';
const { normalizeAliases, listAliasRows, isCurated } = require('../../src/utils/alias-state');

const defaults = { __proto__: null, gemini: 'google/gemini-3.6-flash', glm: 'openrouter/z-ai/glm-5.3' };

describe('normalizeAliases (#238 D6 — a key equal to the shipped default follows)', () => {
  // Named mutant "KEEPEQUAL" — return the input map unchanged.
  test('drops keys whose value equals the shipped default, keeps the rest, in order', () => {
    const lines = [];
    const { aliases, removed } = normalizeAliases(
      { glm: 'openrouter/z-ai/glm-5.3', mine: 'openrouter/x/y-1', gemini: 'google/gemini-9.9-flash' },
      defaults, l => lines.push(l));
    expect(Object.keys(aliases)).toEqual(['mine', 'gemini']);
    expect(removed).toEqual([{ alias: 'glm', id: 'openrouter/z-ai/glm-5.3' }]);
    expect(lines).toEqual(["Notice: alias 'glm' matches the shipped recommendation (openrouter/z-ai/glm-5.3) — now following\n"]);
  });
  test('is idempotent and never notifies twice', () => {
    const lines = [];
    const once = normalizeAliases({ glm: 'openrouter/z-ai/glm-5.3' }, defaults, l => lines.push(l));
    const twice = normalizeAliases(once.aliases, defaults, l => lines.push(l));
    expect(twice.removed).toEqual([]);
    expect(lines).toHaveLength(1);
  });
  test('a non-curated alias is never dropped, whatever its value; prototype names are not curated', () => {
    const { aliases } = normalizeAliases({ toString: 'google/gemini-3.6-flash', custom: 'openrouter/a/b-1' }, defaults);
    expect(Object.keys(aliases)).toEqual(['toString', 'custom']);
  });
  test('tolerates garbage input', () => {
    expect(normalizeAliases(null, defaults)).toEqual({ aliases: {}, removed: [] });
    expect(normalizeAliases({ glm: 42 }, defaults).aliases).toEqual({ glm: 42 });
  });
});

describe('listAliasRows', () => {
  test('curated first in shipped order, state by presence, custom last', () => {
    const rows = listAliasRows({ glm: 'openrouter/z-ai/glm-5.4', zeta: 'openrouter/q/zeta-1' }, defaults);
    expect(rows).toEqual([
      { alias: 'gemini', id: 'google/gemini-3.6-flash', state: 'following', curated: true, shipped: 'google/gemini-3.6-flash' },
      { alias: 'glm', id: 'openrouter/z-ai/glm-5.4', state: 'pinned', curated: true, shipped: 'openrouter/z-ai/glm-5.3' },
      { alias: 'zeta', id: 'openrouter/q/zeta-1', state: 'pinned', curated: false, shipped: null },
    ]);
  });
  test('empty or absent user map: every curated alias follows', () => {
    expect(listAliasRows(null, defaults).every(r => r.state === 'following')).toBe(true);
    expect(listAliasRows({}, defaults)).toHaveLength(2);
  });
  test('a __proto__ key parsed from JSON is a plain custom row, never a prototype write', () => {
    const user = JSON.parse('{"__proto__": "openrouter/a/b-1"}');
    const rows = listAliasRows(user, defaults);
    expect(rows.find(r => r.alias === '__proto__')).toEqual({ alias: '__proto__', id: 'openrouter/a/b-1', state: 'pinned', curated: false, shipped: null });
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
  });
});

describe('isCurated', () => {
  test('own-key test', () => {
    expect(isCurated('gemini', defaults)).toBe(true);
    expect(isCurated('toString', defaults)).toBe(false);
    expect(isCurated('__proto__', defaults)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest tests/utils/alias-state.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the module**

```js
/**
 * @module utils/alias-state
 * Following-vs-pinned state for model aliases (#238 D1) and the normalization
 * that keeps config.json truthful (D6).
 *
 * A curated alias FOLLOWS the shipped pin when its name is ABSENT from
 * `config.aliases` — `config.js :: getEffectiveAliases` already merges
 * `{...DEFAULT_ALIASES, ...userAliases}`, so absence resolves to the shipped
 * id on every consumer. A present key is a PIN. There is no sentinel value:
 * an older amicus reading a normalized config sees fewer keys and fills from
 * its own defaults (downgrade-safe).
 *
 * Normalization drops any key whose value equals the shipped default, with one
 * Notice per key. It runs inside `saveConfig` (so every write converges) and on
 * entry to `amicus aliases`. It is idempotent and never a startup write.
 *
 * Own keys only, everywhere: a `__proto__`/`toString`/`constructor` name in a
 * user config is a plain custom alias, never a curated one.
 */

'use strict';

const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

/** @param {string} alias @param {object} defaults @returns {boolean} */
function isCurated(alias, defaults) {
  return !!defaults && typeof alias === 'string' && own(defaults, alias);
}

/**
 * @param {object} aliases user `config.aliases`
 * @param {object} defaults the shipped map (`DEFAULT_ALIASES`)
 * @param {(line: string) => void} [notify] one call per removed key
 * @returns {{aliases: object, removed: Array<{alias: string, id: string}>}}
 */
function normalizeAliases(aliases, defaults, notify) {
  const out = {};
  const removed = [];
  if (!aliases || typeof aliases !== 'object') { return { aliases: out, removed }; }
  for (const [alias, value] of Object.entries(aliases)) {
    if (typeof value === 'string' && isCurated(alias, defaults) && defaults[alias] === value) {
      removed.push({ alias, id: value });
      if (typeof notify === 'function') {
        notify(`Notice: alias '${alias}' matches the shipped recommendation (${value}) — now following\n`);
      }
      continue;
    }
    out[alias] = value;
  }
  return { aliases: out, removed };
}

/**
 * @param {object|null} userAliases
 * @param {object} defaults
 * @returns {Array<{alias:string,id:string,state:'following'|'pinned',curated:boolean,shipped:string|null}>}
 */
function listAliasRows(userAliases, defaults) {
  const user = (userAliases && typeof userAliases === 'object') ? userAliases : {};
  const rows = [];
  for (const alias of Object.keys(defaults || {})) {
    const pinned = own(user, alias) && typeof user[alias] === 'string';
    rows.push({ alias, id: pinned ? user[alias] : defaults[alias], state: pinned ? 'pinned' : 'following',
      curated: true, shipped: defaults[alias] });
  }
  for (const alias of Object.keys(user)) {
    if (isCurated(alias, defaults) || typeof user[alias] !== 'string') { continue; }
    rows.push({ alias, id: user[alias], state: 'pinned', curated: false, shipped: null });
  }
  return rows;
}

module.exports = { normalizeAliases, listAliasRows, isCurated };
```

Note `out` is a plain `{}`: `out['__proto__'] = value` on a plain object hits the inherited setter and is LOST. Use `Object.defineProperty`-free safety instead: declare `const out = { __proto__: null };` and, when returning, convert with `Object.assign({}, …)`? No — `Object.assign({}, src)` also routes `__proto__` through the setter. Keep `out` null-prototype and return it as-is; `JSON.stringify` serializes own keys of a null-prototype object correctly (measured in `saveConfig`'s existing stripper, which also builds a plain `cleaned` — the existing stripper REJECTS `__proto__` before this point, so the normalizer never sees it from `saveConfig`; `listAliasRows` must still be safe because the CLI hands it raw config). Write the test in Step 1 exactly as given; it pins this.

- [ ] **Step 4: Run the test**

Run: `npx jest tests/utils/alias-state.test.js`
Expected: PASS. (If the `__proto__` row test fails, `out` is not null-prototype — fix the literal.)

- [ ] **Step 5: Wire `saveConfig` and `buildAliasTable`**

In `src/utils/config.js`, inside `saveConfig`, replace `configData.aliases = cleaned;` with:

```js
    // #238 D6: a key equal to the shipped default is the same as absence —
    // drop it so the alias FOLLOWS the next pin bump (one Notice per key).
    const { normalizeAliases } = require('./alias-state');
    configData.aliases = normalizeAliases(cleaned, DEFAULT_ALIASES, (line) => process.stderr.write(line)).aliases;
```

Replace `buildAliasTable` with:

```js
/** @returns {string} Markdown alias table with (default) marker, or empty string */
function buildAliasTable() {
  const config = loadConfig();
  if (!config) { return ''; }
  // #238 D6: EFFECTIVE aliases — a following alias is absent from config.aliases
  // but is still an alias the project's CLAUDE.md block must list.
  const aliases = getEffectiveAliases();
  if (Object.keys(aliases).length === 0) { return ''; }

  const defaultAlias = config.default || null;
  const lines = [];

  lines.push('| Alias | Model |');
  lines.push('|-------|-------|');

  for (const [alias, model] of Object.entries(aliases)) {
    const marker = (alias === defaultAlias) ? ' (default)' : '';
    lines.push(`| ${alias}${marker} | ${model} |`);
  }

  return lines.join('\n');
}
```

(`getEffectiveAliases` is defined later in the same file; function declarations hoist. Net line change in config.js: +4 / −0 in `saveConfig`, +3 / −3 in `buildAliasTable` — the file is excluded from the gate, but keep it to this.)

- [ ] **Step 6: Write the wiring tests**

Append to `tests/utils/alias-state.test.js`:

```js
describe('saveConfig normalizes (#238 D6) — hermetic config dir', () => {
  const path = require('path');
  const fs = require('fs');
  let cfgMod;
  beforeEach(() => {
    jest.resetModules();
    process.env.AMICUS_CONFIG_DIR = path.join(require('os').tmpdir(), `amicus-alias-state-${process.pid}-${Date.now()}`);
    fs.rmSync(process.env.AMICUS_CONFIG_DIR, { recursive: true, force: true });
    cfgMod = require('../../src/utils/config');
  });
  afterEach(() => { fs.rmSync(process.env.AMICUS_CONFIG_DIR, { recursive: true, force: true }); });

  test('D6 no-op proof: every alias resolves to the identical id before and after normalization', () => {
    const shipped = cfgMod.getDefaultAliases();
    const seeded = { __proto__: null, ...shipped, custom: 'openrouter/a/b-1' };
    const before = {};
    for (const a of Object.keys(seeded)) { before[a] = seeded[a]; }
    const err = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    cfgMod.saveConfig({ default: 'gemini', aliases: { ...seeded } });
    const onDisk = JSON.parse(fs.readFileSync(cfgMod.getConfigPath(), 'utf-8'));
    expect(Object.keys(onDisk.aliases)).toEqual(['custom']);                    // 21 keys dropped
    expect(err.mock.calls.filter(c => String(c[0]).includes('now following'))).toHaveLength(Object.keys(shipped).length);
    const effective = cfgMod.getEffectiveAliases();
    for (const a of Object.keys(before)) { expect(effective[a]).toBe(before[a]); }
    expect(cfgMod.resolveModel('gemini')).toBe(shipped.gemini);
    err.mockRestore();
  });
  test('buildAliasTable lists following aliases', () => {
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    cfgMod.saveConfig({ default: 'gemini', aliases: { custom: 'openrouter/a/b-1' } });
    const table = cfgMod.buildAliasTable();
    expect(table).toContain('| gemini (default) | ');
    expect(table).toContain('| custom | openrouter/a/b-1 |');
    process.stderr.write.mockRestore();
  });
  test('buildAliasTable is empty with no config file', () => {
    expect(cfgMod.buildAliasTable()).toBe('');
  });
});
```

- [ ] **Step 7: Run the affected suites**

Run: `npx jest tests/utils/alias-state.test.js tests/config-hash.test.js tests/sidecar/config-change-flow.test.js tests/sidecar/start.test.js tests/config.test.js tests/sidecar/setup.test.js`
Expected: PASS. If `tests/config-hash.test.js` asserts that `buildAliasTable` lists ONLY the raw config map, update that assertion to the effective map and say so in the commit body. If `tests/sidecar/setup.test.js` fails because `createDefaultConfig`'s seeded map is now normalized away on save (it seeds every default), adjust ONLY the assertion on the saved file's alias count to `0`-plus-existing (Task 5 removes the seeding itself); note it in the commit body.

- [ ] **Step 8: Measure the mutant and commit**

Apply KEEPEQUAL (`return { aliases: { ...aliases }, removed: [] }` at the top of `normalizeAliases`), run `npx jest tests/utils/alias-state.test.js`, confirm red, restore.

```bash
git add src/utils/alias-state.js src/utils/config.js tests/utils/alias-state.test.js tests/config-hash.test.js
git commit -m "feat(aliases): absence is follow — saveConfig drops keys equal to the shipped pin, buildAliasTable lists effective aliases (#238 D1/D6)

Named mutant KEEPEQUAL measured red. D6's no-op proof pinned by test.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: `src/utils/alias-store.js` — remove-key and dismissal sinks

**Files:**
- Create: `src/utils/alias-store.js`
- Test: `tests/utils/alias-store.test.js` (new)

**Interfaces:**
- Consumes: `config.js :: loadConfig / saveConfig`.
- Produces:
  - `removeAlias(alias: string) → boolean` — deletes the own key from `config.aliases` and saves; `false` (no write) when absent or when there is no config; throws `Error('Invalid alias name: …')` for an empty/non-string/`'null'` name (same rule as `setup.js :: addAlias`).
  - `readDismissals() → Object<string,string>` — null-prototype copy of `config.aliasReview.dismissed` (own keys with string values only); `{}` when absent.
  - `recordDismissal(dismissKey: string, now?: Date) → void` — read-modify-write `config.aliasReview.dismissed[dismissKey] = now.toISOString()`; throws for a key that is not a non-empty string containing `@`. Preserves every other key of `config` and of `aliasReview` (Q8's `autoRefresh` and Q5's `lastNotified` will live beside it).

- [ ] **Step 1: Write the failing test**

Create `tests/utils/alias-store.test.js`:

```js
// tests/utils/alias-store.test.js
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');

describe('alias-store (#238 — the non-set write sinks)', () => {
  let cfg, store;
  beforeEach(() => {
    jest.resetModules();
    process.env.AMICUS_CONFIG_DIR = path.join(os.tmpdir(), `amicus-alias-store-${process.pid}-${Date.now()}`);
    fs.rmSync(process.env.AMICUS_CONFIG_DIR, { recursive: true, force: true });
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    cfg = require('../../src/utils/config');
    store = require('../../src/utils/alias-store');
  });
  afterEach(() => {
    process.stderr.write.mockRestore();
    fs.rmSync(process.env.AMICUS_CONFIG_DIR, { recursive: true, force: true });
  });
  const disk = () => JSON.parse(fs.readFileSync(cfg.getConfigPath(), 'utf-8'));

  test('removeAlias deletes the key, preserves everything else, returns true', () => {
    cfg.saveConfig({ default: 'gemini', aliases: { glm: 'openrouter/z-ai/glm-5.4', mine: 'openrouter/a/b-1' }, routing: { prefer: 'direct' } });
    expect(store.removeAlias('glm')).toBe(true);
    expect(disk()).toEqual({ default: 'gemini', aliases: { mine: 'openrouter/a/b-1' }, routing: { prefer: 'direct' } });
  });
  test('removeAlias is a no-write when the key is absent or there is no config', () => {
    expect(store.removeAlias('glm')).toBe(false);
    expect(fs.existsSync(cfg.getConfigPath())).toBe(false);
    cfg.saveConfig({ aliases: { mine: 'openrouter/a/b-1' } });
    const mtime = fs.statSync(cfg.getConfigPath()).mtimeMs;
    expect(store.removeAlias('glm')).toBe(false);
    expect(fs.statSync(cfg.getConfigPath()).mtimeMs).toBe(mtime);
  });
  test('removeAlias validates the name like addAlias', () => {
    expect(() => store.removeAlias('')).toThrow(/Invalid alias name/);
    expect(() => store.removeAlias('null')).toThrow(/Invalid alias name/);
    expect(() => store.removeAlias(42)).toThrow(/Invalid alias name/);
  });
  test('recordDismissal writes alias@id -> ISO date under aliasReview.dismissed and keeps siblings', () => {
    cfg.saveConfig({ aliases: {}, aliasReview: { autoRefresh: false } });
    store.recordDismissal('glm@openrouter/z-ai/glm-5.4', new Date('2026-09-14T00:00:00Z'));
    expect(disk().aliasReview).toEqual({ autoRefresh: false, dismissed: { 'glm@openrouter/z-ai/glm-5.4': '2026-09-14T00:00:00.000Z' } });
    expect(store.readDismissals()).toEqual({ 'glm@openrouter/z-ai/glm-5.4': '2026-09-14T00:00:00.000Z' });
  });
  test('readDismissals is {} with no config and is null-prototype', () => {
    const d = store.readDismissals();
    expect(d).toEqual({});
    expect(Object.getPrototypeOf(d)).toBeNull();
  });
  test('recordDismissal rejects a key without @', () => {
    expect(() => store.recordDismissal('glm')).toThrow(/dismissKey/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest tests/utils/alias-store.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the module**

```js
/**
 * @module utils/alias-store
 * The write sinks the alias review flow needs beyond `setup.js :: addAlias`
 * (#238 §2). Every write is read-modify-write through `saveConfig` (which
 * normalizes, D6) and preserves every other key — the no-clobber contract of
 * `provider-default-picker.js :: applyProviderDefault`.
 *
 * `removeAlias` is BOTH "unpin" (a curated name resurrects from the defaults)
 * and "delete" (a user-invented name is gone) — the meaning is decided by
 * whether the name is curated, not by this module (D1).
 *
 * Dismissals are keyed `alias@proposedId` (Q5): permanent for that pair, and a
 * newer proposed id for the same alias is a new key that asks again.
 */

'use strict';

const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

/**
 * @param {string} alias
 * @returns {boolean} true when a key was removed and the config saved
 */
function removeAlias(alias) {
  if (typeof alias === 'string') { alias = alias.trim(); }
  if (!alias || typeof alias !== 'string' || alias === 'null') {
    throw new Error(`Invalid alias name: '${alias}'. Alias name must be a non-empty string.`);
  }
  const { loadConfig, saveConfig } = require('./config');
  const config = loadConfig();
  if (!config || !config.aliases || typeof config.aliases !== 'object' || !own(config.aliases, alias)) { return false; }
  delete config.aliases[alias];
  saveConfig(config);
  return true;
}

/** @returns {Object<string,string>} null-prototype copy of aliasReview.dismissed */
function readDismissals() {
  const { loadConfig } = require('./config');
  const config = loadConfig();
  const out = { __proto__: null };
  const d = config && config.aliasReview && typeof config.aliasReview === 'object' ? config.aliasReview.dismissed : null;
  if (d && typeof d === 'object') {
    for (const [k, v] of Object.entries(d)) { if (typeof v === 'string') { out[k] = v; } }
  }
  return out;
}

/**
 * @param {string} dismissKey `alias@proposedId`
 * @param {Date} [now]
 */
function recordDismissal(dismissKey, now = new Date()) {
  if (typeof dismissKey !== 'string' || !dismissKey || !dismissKey.includes('@')) {
    throw new Error(`Invalid dismissKey '${dismissKey}': expected alias@proposedId`);
  }
  const { loadConfig, saveConfig } = require('./config');
  const config = loadConfig() || {};
  if (!config.aliasReview || typeof config.aliasReview !== 'object') { config.aliasReview = {}; }
  if (!config.aliasReview.dismissed || typeof config.aliasReview.dismissed !== 'object') { config.aliasReview.dismissed = {}; }
  config.aliasReview.dismissed[dismissKey] = now.toISOString();
  saveConfig(config);
}

module.exports = { removeAlias, readDismissals, recordDismissal };
```

- [ ] **Step 4: Run the test**

Run: `npx jest tests/utils/alias-store.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/alias-store.js tests/utils/alias-store.test.js
git commit -m "feat(aliases): alias-store — removeAlias (unpin/delete) and per-proposal dismissals (#238 §2, Q5)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: The wizard writes only what the user chose (Q9)

**Files:**
- Modify: `src/sidecar/setup.js:49-70` (`createDefaultConfig`), `:548` (fresh config literal), `:557-563` (the chosen-alias write), `:607-612` (`recommendedId`), `:629` (the "Config saved" line)
- Modify: `electron/ipc-setup.js:185-194` (first-run seed)
- Modify: `src/utils/quick-picks.js:103-124` (retire `toLiveSeedAliases` and its export; keep `toStorableRoute`)
- Test: `tests/sidecar/setup.test.js` (createDefaultConfig cases, lines ~149-185), `tests/setup-readline.test.js` (mock at line 10, assertions ~97-110), `tests/ipc-setup-save-config.test.js` (lines 15, 65-86), `tests/quick-picks.test.js` (lines 4, 112-141, 143-176), plus `tests/free-council-config.test.js`, `tests/setup-credit-warning.test.js`, `tests/quick-picks-storable-evidence.test.js`, `tests/council/preset-trim-mutants.js` — grep each for `toLiveSeedAliases`/`createDefaultConfig`/`aliasCount` and adjust.

**Interfaces:**
- Consumes: `quick-picks.js :: toStorableRoute(pick, catalogInfo)`, `curated-models.js :: stripGatewayPrefix`, `config.js :: getDefaultAliases`.
- Produces: `createDefaultConfig(defaultModel)` no longer copies defaults into `aliases`; a fresh readline or Electron config carries `aliases: {}` plus at most the chosen default's pin. `toLiveSeedAliases` no longer exists.

- [ ] **Step 1: Write the failing tests**

In `tests/sidecar/setup.test.js`, inside `describe('createDefaultConfig', …)`, replace the alias-count expectations with:

```js
    it('does not seed curated aliases — they follow the shipped pins by absence (#238 Q9)', () => {
      const { createDefaultConfig } = require('../../src/sidecar/setup');
      const cfg = createDefaultConfig('gemini');
      expect(cfg.default).toBe('gemini');
      expect(cfg.aliases).toEqual({});
      const { getEffectiveAliases } = require('../../src/utils/config');
      expect(getEffectiveAliases().gemini).toBeDefined();   // still resolves, via the defaults
    });
    it('preserves aliases an existing config already holds', () => {
      const { saveConfig } = require('../../src/utils/config');
      saveConfig({ aliases: { mine: 'openrouter/a/b-1' } });
      const { createDefaultConfig } = require('../../src/sidecar/setup');
      expect(createDefaultConfig('gemini').aliases).toEqual({ mine: 'openrouter/a/b-1' });
    });
```

In `tests/ipc-setup-save-config.test.js`, replace the two "first run" tests with:

```js
  test('first run (no config) writes an empty alias map — nothing is seeded (#238 Q9)', async () => {
    loadConfig.mockReturnValue(null);
    await invokeSaveConfig('gemini', {});
    expect(written.aliases).toEqual({});
    expect(written.default).toBe('gemini');
  });
```

and delete the `toLiveSeedAliases` line from the `quick-picks` mock at the top of the file (keep the rest of that mock).

In `tests/setup-readline.test.js`, delete `toLiveSeedAliases: jest.fn(…)` from the mock and add:

```js
  test('the chosen default is pinned only when its live pick differs from the shipped pin, and says so (#238 Q9)', async () => {
    // resolveQuickPicks (mocked at the top) resolves gemini live to gemini-9.9-flash,
    // which differs from the shipped pin -> written and announced.
    loadConfig.mockReturnValue(null);
    mockReadline('1');
    const logs = [];
    jest.spyOn(console, 'log').mockImplementation((s) => logs.push(String(s)));
    const { runReadlineSetup } = require('../src/sidecar/setup');
    await runReadlineSetup();
    const written = saveConfig.mock.calls.at(-1)[0];
    expect(Object.keys(written.aliases)).toEqual(['gemini']);
    expect(written.aliases.gemini).toBe('google/gemini-9.9-flash');
    expect(logs.some(l => l.includes('gemini') && l.includes('pinned') && l.includes('differs from the shipped'))).toBe(true);
    console.log.mockRestore();
  });
```

(Adapt the driver names — `loadConfig`, `saveConfig`, `mockReadline`, and the answer that selects gemini — to what the file already uses; read its existing tests first. If the mocked catalog makes `toStorableRoute` return the openrouter form, assert that form instead.)

In `tests/quick-picks.test.js`: remove `toLiveSeedAliases` from the require on line 4, delete the `describe('toLiveSeedAliases', …)` block, and rewrite the two tests in `describe('divergent-vendor routes are never derived by prefix-stripping', …)` that call it so they assert on `resolveQuickPicks(...)` + `toStorableRoute(...)` instead (the property under test is that anthropic's route is never prefix-stripped — `toStorableRoute` is where that guard lives).

- [ ] **Step 2: Run them to verify they fail**

Run: `npx jest tests/sidecar/setup.test.js tests/ipc-setup-save-config.test.js tests/setup-readline.test.js tests/quick-picks.test.js`
Expected: the new tests FAIL (aliases are still seeded; `toLiveSeedAliases` still exported).

- [ ] **Step 3: Change `createDefaultConfig`**

```js
function createDefaultConfig(defaultModel) {
  const existing = loadConfig() || {};
  const cfg = {
    ...existing,
    default: existing.default || defaultModel,
    // #238 Q9: no seeding. A curated alias FOLLOWS the shipped pin by being
    // ABSENT from config.aliases (D1); only what the user chose is written.
    aliases: { __proto__: null, ...(existing.aliases || {}) },
  };
  saveConfig(cfg);
  logger.info('Default config ensured', {
```

(keep the rest of the function; update the `aliasCount` log field if present.)

- [ ] **Step 4: Change the readline flow**

At `:548`: `const cfg = loadConfig() || { aliases: {} };` and remove `toLiveSeedAliases` from the file's imports if it was imported there (grep).

Replace `:557-563` with:

```js
      // #238 Q9: write the chosen default's LIVE pick only when it differs
      // from the shipped pin, and say so — a pin the user was told about.
      // Otherwise leave the key alone: absent = follows (D1).
      if (pick && !chosen.noUpgrade && !vendorAliasesWritten.has(chosen.alias)) {
        const live = toStorableRoute(pick, { models: catalog, providerFailures });
        const shipped = getDefaultAliases()[chosen.alias];
        if (live && stripGatewayPrefix(live) !== stripGatewayPrefix(shipped)) {
          cfg.aliases[chosen.alias] = live;
          console.log(`${chosen.alias} → ${live} (live flagship differs from the shipped ${shipped} — pinned)`);
        }
      }
```

Add `stripGatewayPrefix` to the `require('../utils/curated-models')` line at the top of setup.js (or add the require if none exists — check first).

At `:611`, `recommendedId: cfg.aliases[chosen.alias],` becomes `recommendedId: cfg.aliases[chosen.alias] || getDefaultAliases()[chosen.alias],`.

At `:629`, replace the "Config saved" line with:

```js
    const pinned = Object.keys(cfg.aliases).length;
    console.log(`Config saved (${pinned} pinned alias${pinned === 1 ? '' : 'es'}; the rest follow the shipped recommendations — amicus aliases).`);
```

- [ ] **Step 5: Change the Electron first-run seed**

In `electron/ipc-setup.js`, replace lines 185–194 (`if (!cfg) { … }`) with:

```js
      if (!cfg) {
        // #238 Q9: nothing is seeded — a curated alias follows the shipped pin
        // by being absent (D1). Only the renderer's explicit writes land.
        cfg = { aliases: {} };
      }
```

- [ ] **Step 6: Retire `toLiveSeedAliases`**

In `src/utils/quick-picks.js`, delete the `toLiveSeedAliases` function and its docblock, remove it from `module.exports`, and remove `toDefaultAliases` from the `require('./curated-models')` line if nothing else in the file uses it (grep). Update the `toStorableRoute` docblock sentence "toLiveSeedAliases seeds a fresh config with it" to "(the wizard writes it for the chosen default when it differs from the shipped pin, #238 Q9)".

- [ ] **Step 7: Sweep the remaining references**

`grep -rn "toLiveSeedAliases" src electron tests docs` must return nothing except this plan. Fix every hit (mocks that stub it can drop the key; `tests/council/preset-trim-mutants.js` — read the reference before touching it; it may only mention the name in prose).

- [ ] **Step 8: Run the suites**

Run: `npx jest tests/sidecar/setup.test.js tests/ipc-setup-save-config.test.js tests/setup-readline.test.js tests/quick-picks.test.js tests/free-council-config.test.js tests/setup-credit-warning.test.js tests/quick-picks-storable-evidence.test.js tests/setup-readline-model-drilldown.test.js tests/electron`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/sidecar/setup.js electron/ipc-setup.js src/utils/quick-picks.js tests/
git commit -m "feat(setup): the wizard writes only what the user chose — no curated seeding, the default's live pick pinned only when it differs from the shipped pin (#238 Q9)

toLiveSeedAliases retired. A fresh install carries at most one pin, announced.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: The pure engine — `src/utils/alias-proposals.js` (D7, §2, §5)

**Files:**
- Create: `src/utils/alias-proposals.js`
- Test: `tests/utils/alias-proposals.test.js` (new)

**Interfaces:**
- Consumes: `alias-state.js :: listAliasRows, isCurated`; `model-id-siblings.js :: newestSibling`; `alias-audit.js :: findStaleAliases, suggestReplacements`; `curated-models.js :: stripGatewayPrefix`.
- Produces: `buildAliasProposals({ userAliases, defaults, catalogInfo, retired = {}, notable = [], dismissed = {} }) → Proposal[]` where

```js
Proposal = {
  alias: string,
  state: 'pinned' | 'unmapped',
  current: string | null,          // the pinned id; null for 'unmapped'
  shipped: string | null,          // defaults[alias] for a curated name
  curated: boolean,
  reasons: Array<'stale' | 'newer-sibling' | 'differs-from-shipped' | 'notable-unmapped'>,
  candidates: Array<{ id: string, why: 'newer-sibling' | 'replacement' | 'follow' | 'notable', evidence: object }>,
  dismissKey: string               // alias + '@' + (candidates[0] ? candidates[0].id : current)
}
```

Rules (every one is a test below):
1. Only `pinned` rows produce proposals; a following alias never does (D1).
2. `catalogInfo.models` empty/absent → `[]`.
3. `candidateIds` = ids of rows with `authoritative !== false` whose first segment is not in `providerFailures[].provider` (§5 rules 1–2). Siblings and replacements come only from `candidateIds`.
4. If the pinned id's own provider (first segment) is in `providerFailures` → no proposal for that alias (its namespace cannot be judged).
5. `stale` ⇔ `findStaleAliases([{alias, model: current, source: 'user-config'}], models).length === 1`.
6. `newer-sibling` ⇔ `newestSibling(current, candidateIds)` is non-null (§5 rule 3 by construction).
7. `differs-from-shipped` ⇔ curated and `stripGatewayPrefix(shipped) !== stripGatewayPrefix(current)` (same model under another gateway form is NOT a difference — alias-shadow's rule).
8. Candidates in order: the sibling (`newer-sibling`); else if stale, up to 3 `suggestReplacements(current, candidateRows)` (`replacement`); then, if `differs-from-shipped`, the shipped pin (`follow`, exempt from rules 1–3).
9. A `retired` alias (own key) never proposes; a `dismissed` dismissKey (own key) is skipped.
10. Notable: for each `{id, suggestedAlias, note}`: skip unless `id ∈ candidateIds`; skip if any effective alias (user or default) already maps to the same model (`stripGatewayPrefix` compare); skip if `suggestedAlias` is retired; proposal `{ alias: suggestedAlias, state: 'unmapped', current: null, shipped: null, curated: false, reasons: ['notable-unmapped'], candidates: [{ id, why: 'notable', evidence: { note } }], dismissKey: suggestedAlias + '@' + id }`.
11. Order: curated pinned rows (defaults order), custom pinned rows (config order), notable (list order). Never throws on odd input.

- [ ] **Step 1: Write the failing test**

Create `tests/utils/alias-proposals.test.js`:

```js
// tests/utils/alias-proposals.test.js
'use strict';
const { buildAliasProposals } = require('../../src/utils/alias-proposals');

const defaults = {
  __proto__: null,
  gemini: 'google/gemini-3.6-flash',
  glm: 'openrouter/z-ai/glm-5.3',
  gpt: 'openai/gpt-5.6-terra',
};
const row = (id, extra = {}) => ({ id, ...extra });
const CATALOG = [
  row('openrouter/google/gemini-3.6-flash'), row('google/gemini-3.6-flash'),
  row('openrouter/z-ai/glm-5.3'), row('openrouter/z-ai/glm-5.4'), row('openrouter/z-ai/glm-5.4:free'),
  row('openrouter/openai/gpt-5.6-terra'), row('openrouter/openai/gpt-5.6-sol'), row('openai/gpt-5.6-terra'),
  row('openrouter/mistralai/mistral-medium-3-5'),
];
const info = (models = CATALOG, providerFailures = []) => ({ models, providerFailures });
const run = (userAliases, opts = {}) => buildAliasProposals({ userAliases, defaults, catalogInfo: info(), ...opts });

describe('alias-proposals — one proposal per alias, pinned only (#238 D1/D7/§2)', () => {
  test('a following alias never proposes; an empty catalog proposes nothing', () => {
    expect(run({})).toEqual([]);
    expect(buildAliasProposals({ userAliases: { glm: 'openrouter/z-ai/glm-5.2' }, defaults, catalogInfo: info([]) })).toEqual([]);
    expect(buildAliasProposals({ userAliases: { glm: 'x/y-1' }, defaults, catalogInfo: null })).toEqual([]);
  });
  test('pinned behind a newer sibling AND behind the shipped pin: ONE proposal, sibling first, follow second', () => {
    const [p, ...rest] = run({ glm: 'openrouter/z-ai/glm-5.2' }, { catalogInfo: info([...CATALOG, row('openrouter/z-ai/glm-5.2')]) });
    expect(rest).toEqual([]);
    expect(p.alias).toBe('glm');
    expect(p.state).toBe('pinned');
    expect(p.reasons).toEqual(['newer-sibling', 'differs-from-shipped']);
    expect(p.candidates.map(c => [c.id, c.why])).toEqual([
      ['openrouter/z-ai/glm-5.4', 'newer-sibling'],
      ['openrouter/z-ai/glm-5.3', 'follow'],
    ]);
    expect(p.dismissKey).toBe('glm@openrouter/z-ai/glm-5.4');
    expect(p.shipped).toBe('openrouter/z-ai/glm-5.3');
    expect(p.curated).toBe(true);
  });
  test('pinned AHEAD of the shipped pin with no newer sibling: follow is still offered (differs-from-shipped)', () => {
    const [p] = run({ glm: 'openrouter/z-ai/glm-5.4' });
    expect(p.reasons).toEqual(['differs-from-shipped']);
    expect(p.candidates).toEqual([{ id: 'openrouter/z-ai/glm-5.3', why: 'follow', evidence: {} }]);
    expect(p.dismissKey).toBe('glm@openrouter/z-ai/glm-5.3');
  });
  test('same model under another gateway form is not a difference (alias-shadow rule)', () => {
    expect(run({ gemini: 'openrouter/google/gemini-3.6-flash' })).toEqual([]);
  });
  test('tier crossing is never proposed: a sol pin never sees terra', () => {
    expect(run({ gpt: 'openrouter/openai/gpt-5.6-sol' }).map(p => p.candidates.map(c => c.why)))
      .toEqual([['follow']]);   // differs from shipped, no sibling
  });
  test('stale pinned custom alias: replacements from the same vendor, no follow (nothing shipped)', () => {
    const [p] = run({ mistral2: 'openrouter/mistralai/mistral-medium-3-4' });
    expect(p.reasons).toEqual(['stale']);
    expect(p.curated).toBe(false);
    expect(p.shipped).toBeNull();
    expect(p.candidates).toEqual([{ id: 'openrouter/mistralai/mistral-medium-3-5', why: 'replacement', evidence: {} }]);
    expect(p.dismissKey).toBe('mistral2@openrouter/mistralai/mistral-medium-3-5');
  });
  test('stale with no replacement still proposes, keyed on the stale id itself', () => {
    const [p] = run({ lonely: 'openrouter/nobody/thing-1' }, { catalogInfo: info([...CATALOG, row('openrouter/nobody/other-2')]) });
    expect(p.reasons).toEqual(['stale']);
    expect(p.candidates.map(c => c.why)).toEqual(['replacement']);
    const [q] = run({ lonely: 'openrouter/nobody/thing-1' }, { catalogInfo: info([...CATALOG, row('openrouter/nobodyelse/x-1')]) });
    expect(q.candidates).toEqual([]);
    expect(q.dismissKey).toBe('lonely@openrouter/nobody/thing-1');
  });
});

describe('alias-proposals — the §5 display gate', () => {
  // Named mutant "FLOORSIBLING" — drop the `authoritative !== false` filter from candidateIds.
  test('a non-authoritative row is never a candidate', () => {
    const models = [...CATALOG, row('openrouter/z-ai/glm-5.9', { authoritative: false })];
    const [p] = run({ glm: 'openrouter/z-ai/glm-5.4' }, { catalogInfo: info(models) });
    expect(p.candidates.map(c => c.id)).not.toContain('openrouter/z-ai/glm-5.9');
  });
  // Named mutant "FAILEDCANDIDATE" — drop the providerFailures filter from candidateIds.
  test('a row from a rejected namespace is never a candidate, and a pin in a rejected namespace is not judged', () => {
    const failures = [{ provider: 'openrouter', reason: 'http-status', status: 403 }];
    expect(run({ glm: 'openrouter/z-ai/glm-5.2' }, { catalogInfo: info([...CATALOG, row('openrouter/z-ai/glm-5.2')], failures) })).toEqual([]);
    const gFail = [{ provider: 'google', reason: 'http-status', status: 401 }];
    const out = run({ gemini: 'google/gemini-3.1-flash' }, { catalogInfo: info(CATALOG, gFail) });
    expect(out).toEqual([]);
  });
  // Named mutant "OLDERSIBLING" — compare with `>= 0` instead of `> 0` in the lifted comparator's caller (i.e. accept equal/older).
  test('an older sibling is never proposed', () => {
    const models = [row('openrouter/z-ai/glm-5.1'), row('openrouter/z-ai/glm-5.4')];
    expect(run({ glm: 'openrouter/z-ai/glm-5.4' }, { catalogInfo: info(models) })
      .flatMap(p => p.candidates).map(c => c.id)).not.toContain('openrouter/z-ai/glm-5.1');
  });
});

describe('alias-proposals — dismissal, retired, notable', () => {
  test('a dismissed key is skipped; a newer proposed id is a new key and asks again', () => {
    const dismissed = { 'glm@openrouter/z-ai/glm-5.4': '2026-09-14T00:00:00.000Z' };
    expect(run({ glm: 'openrouter/z-ai/glm-5.2' }, { dismissed, catalogInfo: info([...CATALOG, row('openrouter/z-ai/glm-5.2')]) })).toEqual([]);
    const withNewer = info([...CATALOG, row('openrouter/z-ai/glm-5.2'), row('openrouter/z-ai/glm-5.5')]);
    expect(run({ glm: 'openrouter/z-ai/glm-5.2' }, { dismissed, catalogInfo: withNewer })[0].dismissKey).toBe('glm@openrouter/z-ai/glm-5.5');
  });
  test('a retired alias never proposes, even when pinned and stale', () => {
    expect(run({ devstral: 'openrouter/mistralai/devstral-2' }, { retired: { devstral: { on: '2026-08-04' } } })).toEqual([]);
  });
  test('notable: unmapped + authoritative + not already aliased -> an unmapped proposal', () => {
    const notable = [{ id: 'openrouter/mistralai/mistral-medium-3-5', suggestedAlias: 'mistral', note: 'flagship' },
      { id: 'openrouter/z-ai/glm-5.4', suggestedAlias: 'glm-new', note: 'already aliased? no — glm pins 5.3 by default' },
      { id: 'openrouter/nowhere/x-1', suggestedAlias: 'ghost', note: 'not in catalog' }];
    const out = run({}, { notable });
    expect(out.map(p => [p.alias, p.state, p.reasons[0]])).toEqual([
      ['mistral', 'unmapped', 'notable-unmapped'], ['glm-new', 'unmapped', 'notable-unmapped']]);
    expect(out[0].candidates).toEqual([{ id: 'openrouter/mistralai/mistral-medium-3-5', why: 'notable', evidence: { note: 'flagship' } }]);
    expect(out[0].dismissKey).toBe('mistral@openrouter/mistralai/mistral-medium-3-5');
  });
  test('notable already mapped by a default or a user alias is skipped', () => {
    const notable = [{ id: 'openrouter/google/gemini-3.6-flash', suggestedAlias: 'flash', note: '' }];
    expect(run({}, { notable })).toEqual([]);
  });
  test('prototype-named aliases are ordinary custom rows', () => {
    const out = run({ toString: 'openrouter/z-ai/glm-5.2' }, { catalogInfo: info([...CATALOG, row('openrouter/z-ai/glm-5.2')]) });
    expect(out).toHaveLength(1);
    expect(out[0].curated).toBe(false);
    expect(out[0].candidates.map(c => c.why)).toEqual(['newer-sibling']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest tests/utils/alias-proposals.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the module**

```js
/**
 * @module utils/alias-proposals
 * The alias review ENGINE (#238 §2): pure, no I/O, no prompts. Turns
 * (config.aliases, DEFAULT_ALIASES, catalogInfo, dismissed, retired, notable)
 * into ONE proposal per alias (Q4), for the CLI picker and the Electron
 * "Needs review" section to render and for their sinks to write.
 *
 * Only PINNED aliases propose (D1): a following alias resolves to the shipped
 * pin and cannot drift. The §5 DISPLAY gate is applied here — a candidate id
 * must be an authoritative row from a namespace that was not rejected, and a
 * sibling must be strictly newer (model-id-siblings.js) — so nothing this
 * module returns can be a downgrade. The WRITE gate (a fresh catalog) is the
 * renderer's, at accept time.
 *
 * Own keys only: a `__proto__`/`toString` alias is a custom row here as it is
 * everywhere else in the alias tables.
 */

'use strict';

const { listAliasRows, isCurated } = require('./alias-state');
const { newestSibling } = require('./model-id-siblings');
const { findStaleAliases, suggestReplacements } = require('./alias-audit');
const { stripGatewayPrefix } = require('./curated-models');

const own = (obj, key) => !!obj && Object.prototype.hasOwnProperty.call(obj, key);
const providerOf = (id) => (typeof id === 'string' ? id.split('/')[0] : '');
const sameModel = (a, b) => typeof a === 'string' && typeof b === 'string' && stripGatewayPrefix(a) === stripGatewayPrefix(b);

/** §5 rules 1–2: rows a proposal may name. */
function candidateRows(models, failures) {
  return models.filter(m => m && typeof m.id === 'string' && m.authoritative !== false && !failures.has(providerOf(m.id)));
}

function proposeForRow(r, ctx) {
  if (r.state !== 'pinned' || own(ctx.retired, r.alias)) { return null; }
  if (ctx.failures.has(providerOf(r.id))) { return null; }             // its namespace cannot be judged
  const stale = findStaleAliases([{ alias: r.alias, model: r.id, source: 'user-config' }], ctx.models).length === 1;
  const sibling = newestSibling(r.id, ctx.candidateIds);
  const differs = r.curated && !sameModel(r.shipped, r.id);
  const reasons = [];
  if (stale) { reasons.push('stale'); }
  if (sibling) { reasons.push('newer-sibling'); }
  if (differs) { reasons.push('differs-from-shipped'); }
  if (reasons.length === 0) { return null; }
  const candidates = [];
  if (sibling) { candidates.push({ id: sibling, why: 'newer-sibling', evidence: {} }); }
  else if (stale) {
    for (const id of suggestReplacements(r.id, ctx.candidates)) { candidates.push({ id, why: 'replacement', evidence: {} }); }
  }
  if (differs) { candidates.push({ id: r.shipped, why: 'follow', evidence: {} }); }
  const dismissKey = `${r.alias}@${candidates.length ? candidates[0].id : r.id}`;
  if (own(ctx.dismissed, dismissKey)) { return null; }
  return { alias: r.alias, state: 'pinned', current: r.id, shipped: r.shipped, curated: r.curated, reasons, candidates, dismissKey };
}

function proposeNotable(entry, ctx) {
  if (!entry || typeof entry.id !== 'string' || typeof entry.suggestedAlias !== 'string') { return null; }
  if (own(ctx.retired, entry.suggestedAlias) || !ctx.candidateIds.includes(entry.id)) { return null; }
  if (ctx.mapped.some(id => sameModel(id, entry.id))) { return null; }
  const dismissKey = `${entry.suggestedAlias}@${entry.id}`;
  if (own(ctx.dismissed, dismissKey)) { return null; }
  return { alias: entry.suggestedAlias, state: 'unmapped', current: null, shipped: null, curated: false,
    reasons: ['notable-unmapped'], candidates: [{ id: entry.id, why: 'notable', evidence: { note: entry.note || '' } }], dismissKey };
}

/**
 * @param {{userAliases: object|null, defaults: object, catalogInfo: {models?: Array, providerFailures?: Array}|null,
 *   retired?: object, notable?: Array<{id:string, suggestedAlias:string, note?:string}>, dismissed?: object}} input
 * @returns {Array<object>} proposals — see the module docblock for the shape
 */
function buildAliasProposals({ userAliases, defaults, catalogInfo, retired = {}, notable = [], dismissed = {} }) {
  const models = (catalogInfo && Array.isArray(catalogInfo.models)) ? catalogInfo.models : [];
  if (models.length === 0 || !defaults) { return []; }
  const failures = new Set((catalogInfo.providerFailures || []).map(f => f && f.provider).filter(Boolean));
  const candidates = candidateRows(models, failures);
  const rows = listAliasRows(userAliases, defaults);
  const ctx = {
    models, failures, candidates, candidateIds: candidates.map(m => m.id),
    retired: retired || {}, dismissed: dismissed || {},
    mapped: rows.map(r => r.id),
  };
  const out = [];
  for (const r of rows) { const p = proposeForRow(r, ctx); if (p) { out.push(p); } }
  for (const n of (Array.isArray(notable) ? notable : [])) { const p = proposeNotable(n, ctx); if (p) { out.push(p); } }
  return out;
}

module.exports = { buildAliasProposals };
```

(`isCurated` is imported for symmetry with the docblock; if ESLint flags it unused, drop the import.)

- [ ] **Step 4: Run the test**

Run: `npx jest tests/utils/alias-proposals.test.js`
Expected: PASS. If `suggestReplacements` returns ids that are not in `candidateIds` (it takes rows and filters by vendor prefix — passing `ctx.candidates` bounds it), the replacement test still holds; if `findStaleAliases` reports the custom alias as not-stale because its provider has no rows, the "stale with no replacement" case must use a catalog that has at least one `openrouter/` row (it does).

- [ ] **Step 5: Measure the three named mutants, then commit**

FLOORSIBLING: remove `m.authoritative !== false &&` from `candidateRows` → the named test reddens. FAILEDCANDIDATE: remove `&& !failures.has(providerOf(m.id))` AND the `ctx.failures.has(providerOf(r.id))` early return → reddens. OLDERSIBLING: in the engine, replace `newestSibling(r.id, ctx.candidateIds)` with a variant that returns any sibling (e.g. `ctx.candidateIds.find(id => id !== r.id && id.startsWith(r.id.slice(0, r.id.lastIndexOf('-'))))`) → reddens. Restore each.

```bash
git add src/utils/alias-proposals.js tests/utils/alias-proposals.test.js
git commit -m "feat(aliases): pure review engine — one proposal per pinned alias, §5 display gate, dismissals, retired, notable (#238 D7/§2)

Named mutants FLOORSIBLING, FAILEDCANDIDATE, OLDERSIBLING measured red.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: `amicus aliases` — list, `--json`, CLI wiring (D4)

**Files:**
- Create: `src/sidecar/aliases.js`
- Modify: `src/cli.js` (BOOLEAN_FLAGS: add `'review'`; `USAGE_HEADER`: add the `aliases` line after `models`; `USAGE_COMMAND_BLOCKS`: add `aliases:` after `models:`)
- Modify: `bin/amicus.js` (add `case 'aliases'` after `case 'models'`)
- Test: `tests/sidecar/aliases-command.test.js` (new); run `tests/cli*.test.js` and `tests/utils/known-flags*.test.js` (usage-derived flag/command sets)

**Interfaces:**
- Consumes: `alias-state.js :: normalizeAliases, listAliasRows`; `alias-proposals.js :: buildAliasProposals`; `alias-store.js :: readDismissals`; `config.js :: loadConfig, saveConfig, getDefaultAliases`; `model-catalog.js :: getCatalogInfo`; `electron/setup-ui-alias-groups.js :: groupAliases` (pure Node; the SHARED-WITH-THE-BROWSER module); `result-schema-version.js :: SCHEMA_VERSION`.
- Produces:
  - `handleAliases(args) → Promise<number>` — dispatch: `--review` with `--json`/`--quiet` → stderr `Error: --review is interactive; use \`amicus aliases --json\` for machine output` and `1`; `--review` → `require('./aliases-review').runReview(args)` (Task 8 — until it exists, this branch is dispatched but the module is absent; Task 7's tests never take it); `--json` → the document; else the list. Returns 0.
  - `collectAliasView({ maxAgeMs } = {}) → Promise<{ rows, proposals, catalogInfo, catalogAvailable }>` — normalizes on entry (best-effort `saveConfig`; on a throw, one stderr `Notice: could not normalize aliases (<message>)`), reads the cache with `getCatalogInfo({ maxAgeMs })` — the LIST passes `Number.POSITIVE_INFINITY` (display gate: any age, no network); Task 8 passes the default (inline refresh when stale).
  - `renderAliasList(view) → string` — the §4 list; `buildAliasesDoc(view) → object` — `{ schemaVersion, type: 'aliases', catalogAvailable, catalogFetchedAt, aliasCount, aliases: rows, proposalCount, proposals }`.

- [ ] **Step 1: Write the failing test**

Create `tests/sidecar/aliases-command.test.js`:

```js
// tests/sidecar/aliases-command.test.js
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');

function captureStdout(fn) {
  const writes = [];
  const orig = process.stdout.write;
  process.stdout.write = (s) => { writes.push(String(s)); return true; };
  return Promise.resolve().then(fn).finally(() => { process.stdout.write = orig; })
    .then(code => ({ code, out: writes.join('') }));
}

describe('amicus aliases (#238 D4 — list and --json)', () => {
  let cfg, handleAliases;
  const CATALOG = {
    models: [{ id: 'openrouter/z-ai/glm-5.3' }, { id: 'openrouter/z-ai/glm-5.4' }, { id: 'google/gemini-3.6-flash' }, { id: 'openrouter/google/gemini-3.6-flash' }],
    fetchedAt: 1, lastRefreshAttempt: null, lastRefreshError: null, providerFailures: [], ceilingEnrichment: null,
  };
  let catalogCalls;
  beforeEach(() => {
    jest.resetModules();
    process.env.AMICUS_CONFIG_DIR = path.join(os.tmpdir(), `amicus-aliases-cmd-${process.pid}-${Date.now()}`);
    fs.rmSync(process.env.AMICUS_CONFIG_DIR, { recursive: true, force: true });
    catalogCalls = [];
    jest.doMock('../../src/utils/model-catalog', () => ({
      getCatalogInfo: jest.fn(async (opts) => { catalogCalls.push(opts); return CATALOG; }),
      DEFAULT_MAX_AGE_MS: 24 * 60 * 60 * 1000,
    }));
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    cfg = require('../../src/utils/config');
    ({ handleAliases } = require('../../src/sidecar/aliases'));
  });
  afterEach(() => {
    process.stderr.write.mockRestore();
    fs.rmSync(process.env.AMICUS_CONFIG_DIR, { recursive: true, force: true });
  });

  test('list: following vs pinned per row, grouped by vendor, a pinned alias behind a sibling is flagged, footer counts proposals', async () => {
    cfg.saveConfig({ default: 'gemini', aliases: { glm: 'openrouter/z-ai/glm-5.2', mine: 'openrouter/z-ai/glm-5.4' } });
    const { code, out } = await captureStdout(() => handleAliases({ _: ['aliases'] }));
    expect(code).toBe(0);
    expect(out).toMatch(/gemini\s+→\s+google\/gemini-3\.6-flash\s+following/);
    expect(out).toMatch(/glm\s+→\s+openrouter\/z-ai\/glm-5\.2\s+pinned\s+⚠ newer available/);
    expect(out).toMatch(/mine\s+→\s+openrouter\/z-ai\/glm-5\.4\s+pinned/);
    expect(out).toContain('1 update available — amicus aliases --review');
    expect(catalogCalls[0]).toEqual({ maxAgeMs: Number.POSITIVE_INFINITY });   // display gate: cache only
  });
  test('list with nothing pinned says so and does not network', async () => {
    const { code, out } = await captureStdout(() => handleAliases({ _: ['aliases'] }));
    expect(code).toBe(0);
    expect(out).toContain('following');
    expect(out).toContain('nothing to review');
  });
  test('normalizes on entry: a seeded key equal to the shipped pin is dropped with a Notice', async () => {
    const shipped = cfg.getDefaultAliases();
    fs.mkdirSync(process.env.AMICUS_CONFIG_DIR, { recursive: true });
    fs.writeFileSync(cfg.getConfigPath(), JSON.stringify({ aliases: { glm: shipped.glm, mine: 'openrouter/z-ai/glm-5.4' } }));
    await captureStdout(() => handleAliases({ _: ['aliases'] }));
    expect(JSON.parse(fs.readFileSync(cfg.getConfigPath(), 'utf-8')).aliases).toEqual({ mine: 'openrouter/z-ai/glm-5.4' });
    expect(process.stderr.write.mock.calls.some(c => String(c[0]).includes("alias 'glm' matches the shipped recommendation"))).toBe(true);
  });
  test('--json: versioned document, byte-clean stdout, rows + proposals', async () => {
    cfg.saveConfig({ aliases: { glm: 'openrouter/z-ai/glm-5.2' } });
    const { code, out } = await captureStdout(() => handleAliases({ _: ['aliases'], json: true }));
    expect(code).toBe(0);
    const doc = JSON.parse(out);
    expect(doc.type).toBe('aliases');
    expect(typeof doc.schemaVersion).toBe('string');
    expect(doc.catalogAvailable).toBe(true);
    expect(doc.aliases.find(r => r.alias === 'glm')).toEqual({ alias: 'glm', id: 'openrouter/z-ai/glm-5.2', state: 'pinned', curated: true, shipped: cfg.getDefaultAliases().glm });
    expect(doc.proposalCount).toBe(1);
    expect(doc.proposals[0].candidates[0].id).toBe('openrouter/z-ai/glm-5.4');
  });
  test('--review with --json or --quiet is an argument error', async () => {
    const a = await captureStdout(() => handleAliases({ _: ['aliases'], review: true, json: true }));
    expect(a.code).toBe(1);
    expect(a.out).toBe('');
    const b = await captureStdout(() => handleAliases({ _: ['aliases'], review: true, quiet: true }));
    expect(b.code).toBe(1);
    expect(process.stderr.write.mock.calls.some(c => String(c[0]).includes('--review is interactive'))).toBe(true);
  });
});

describe('aliases is a registered command with a --review flag', () => {
  test('usage names it, the flag registry knows --review, parseArgs treats --review as boolean', () => {
    const { getUsage, getCommandNames, parseArgs } = require('../../src/cli');
    expect(getCommandNames()).toContain('aliases');
    expect(getUsage('aliases')).toContain('--review');
    expect(getUsage()).toMatch(/\n  aliases\s+/);
    const { getKnownFlags } = require('../../src/utils/known-flags');
    expect(getKnownFlags().has('review')).toBe(true);
    const parsed = parseArgs(['aliases', '--review', 'stray']);
    expect(parsed.review).toBe(true);
    expect(parsed._).toEqual(['aliases', 'stray']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest tests/sidecar/aliases-command.test.js`
Expected: FAIL — module not found / command unknown.

- [ ] **Step 3: Create `src/sidecar/aliases.js`**

```js
/**
 * @module sidecar/aliases
 * `amicus aliases` (#238 D4) — the user's alias map as a standing command.
 *
 *   amicus aliases            list: following / pinned, grouped by vendor
 *   amicus aliases --review   picker over every proposal (aliases-review.js)
 *   amicus aliases --json     versioned document: rows + proposals
 *
 * The LIST reads the catalog CACHE at any age and never networks (§5 display
 * gate); the picker refreshes inline when the cache is stale (write gate).
 * Every form normalizes the config on entry (D6), best-effort.
 */

'use strict';

const { SCHEMA_VERSION } = require('../utils/result-schema-version');

function loadDeps() {
  const config = require('../utils/config');
  return {
    config,
    normalizeAliases: require('../utils/alias-state').normalizeAliases,
    listAliasRows: require('../utils/alias-state').listAliasRows,
    buildAliasProposals: require('../utils/alias-proposals').buildAliasProposals,
    readDismissals: require('../utils/alias-store').readDismissals,
    getCatalogInfo: require('../utils/model-catalog').getCatalogInfo,
    groupAliases: require('../../electron/setup-ui-alias-groups').groupAliases,
  };
}

/**
 * Normalize on entry (D6), best-effort: a read-only config dir never blocks a
 * listing — the in-memory normalized view is used and the failure announced.
 * @returns {object} the user alias map after normalization
 */
function normalizeOnEntry(d) {
  const cfg = d.config.loadConfig();
  const defaults = d.config.getDefaultAliases();
  if (!cfg || !cfg.aliases || typeof cfg.aliases !== 'object') { return {}; }
  const probe = d.normalizeAliases(cfg.aliases, defaults);
  if (probe.removed.length > 0) {
    try { d.config.saveConfig(cfg); }                              // saveConfig prints the Notices
    catch (err) { process.stderr.write(`Notice: could not normalize aliases (${err.message}) — continuing with the normalized view\n`); }
  }
  return probe.aliases;
}

/**
 * @param {{maxAgeMs?: number}} [opts] `Number.POSITIVE_INFINITY` = cache only
 * @returns {Promise<{rows: Array, proposals: Array, catalogInfo: object, catalogAvailable: boolean}>}
 */
async function collectAliasView(opts = {}, d = loadDeps()) {
  const userAliases = normalizeOnEntry(d);
  const defaults = d.config.getDefaultAliases();
  let catalogInfo = { models: [], fetchedAt: null, providerFailures: [] };
  try { catalogInfo = await d.getCatalogInfo(opts.maxAgeMs === undefined ? {} : { maxAgeMs: opts.maxAgeMs }); }
  catch (err) { process.stderr.write(`Notice: catalog unavailable (${err.message}) — no proposals\n`); }
  const rows = d.listAliasRows(userAliases, defaults);
  const proposals = d.buildAliasProposals({ userAliases, defaults, catalogInfo, dismissed: d.readDismissals() });
  return { rows, proposals, catalogInfo, catalogAvailable: (catalogInfo.models || []).length > 0 };
}

/** @param {{rows: Array, proposals: Array}} view @param {Function} groupAliases @returns {string} */
function renderAliasList(view, groupAliases) {
  const byAlias = new Map(view.rows.map(r => [r.alias, r]));
  const flagged = new Set(view.proposals.map(p => p.alias));
  const map = { __proto__: null };
  for (const r of view.rows) { map[r.alias] = r.id; }
  const width = Math.max(6, ...view.rows.map(r => r.alias.length));
  const lines = [];
  for (const g of groupAliases(map)) {
    lines.push(`  ${g.label}`);
    for (const key of g.keys) {
      const r = byAlias.get(key);
      const flag = flagged.has(key) ? '   ⚠ newer available' : '';
      lines.push(`    ${key.padEnd(width)}  → ${r.id.padEnd(44)} ${r.state}${flag}`);
    }
  }
  lines.push('');
  const n = view.proposals.length;
  lines.push(n === 0
    ? '  nothing to review — amicus aliases --review'
    : `  ${n} update${n === 1 ? '' : 's'} available — amicus aliases --review`);
  return lines.join('\n') + '\n';
}

/** @returns {object} the `--json` document (fields only ever ADDED within SCHEMA_VERSION) */
function buildAliasesDoc(view) {
  return {
    schemaVersion: SCHEMA_VERSION,
    type: 'aliases',
    catalogAvailable: view.catalogAvailable,
    catalogFetchedAt: view.catalogInfo.fetchedAt || null,
    aliasCount: view.rows.length,
    aliases: view.rows,
    proposalCount: view.proposals.length,
    proposals: view.proposals,
  };
}

/** @param {object} args parsed CLI args @returns {Promise<number>} exit code */
async function handleAliases(args) {
  if (args.review && (args.json || args.quiet)) {
    process.stderr.write('Error: --review is interactive; use `amicus aliases --json` for machine output\n');
    return 1;
  }
  if (args.review) { return require('./aliases-review').runReview(args); }
  const d = loadDeps();
  const view = await collectAliasView({ maxAgeMs: Number.POSITIVE_INFINITY }, d);
  if (args.json) {
    process.stdout.write(JSON.stringify(buildAliasesDoc(view), null, 2) + '\n');
    return 0;
  }
  process.stdout.write(renderAliasList(view, d.groupAliases));
  return 0;
}

module.exports = { handleAliases, collectAliasView, renderAliasList, buildAliasesDoc, loadDeps };
```

The "⚠ newer available" flag is rendered for ANY proposal on that alias (stale, sibling, or differs-from-shipped); the picker shows the specific reason. The proposal's `state`/`curated` fields are already in the row.

- [ ] **Step 4: Register the command and the flag**

In `src/cli.js`:
- `BOOLEAN_FLAGS`: add `'review',                // aliases: interactive picker over the review proposals (#238 D4)` after the `'live'` entry.
- `USAGE_HEADER`: after the `  models      List/search the model catalog, refresh it, audit aliases` line add `  aliases     Your model aliases — following / pinned (--review walks the proposals)`.
- `USAGE_COMMAND_BLOCKS`: after the `models:` block add:

```js
  aliases: `
Options for 'aliases':
  --review                     Interactive picker: accept, choose, skip or dismiss each
                               proposal (stale pin, newer sibling, differs from the
                               shipped pin). Needs a terminal.
  --json                       Machine-readable document (aliases + proposals)
`,
```

In `bin/amicus.js`, after the `case 'models': {…}` block:

```js
      case 'aliases': {
        const { handleAliases } = require('../src/sidecar/aliases');
        exitCode = await handleAliases(args);
        break;
      }
```

- [ ] **Step 5: Run the tests**

Run: `npx jest tests/sidecar/aliases-command.test.js tests/cli tests/utils/known-flags tests/bin 2>/dev/null; npx jest tests/sidecar/aliases-command.test.js`
Then: `npx jest -t "usage"` is NOT allowed (pattern runs); instead run the suites whose names contain `cli` or `usage`: `ls tests | grep -iE 'cli|usage|known-flags'` and run each. If a usage-snapshot test pins the full text, update the snapshot deliberately (`npx jest <file> -u` is acceptable ONLY for that file after reading the diff).
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/sidecar/aliases.js src/cli.js bin/amicus.js tests/sidecar/aliases-command.test.js tests/
git commit -m "feat(cli): amicus aliases — list following/pinned by vendor, --json document, --review dispatch (#238 D4)

The list reads the catalog cache at any age and never networks (§5 display
gate); every form normalizes the config on entry (D6).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: `--review` — the picker, and the non-TTY refusal (§4, Q2, Q4)

**Files:**
- Create: `src/sidecar/aliases-review.js`
- Test: `tests/sidecar/aliases-review.test.js` (new)

**Interfaces:**
- Consumes: `aliases.js :: collectAliasView, renderAliasList, loadDeps`; `setup.js :: addAlias, deriveFreeAlias`; `alias-store.js :: removeAlias, recordDismissal`; `doctor-alias-check.js :: isCatalogFresh` is NOT exported — reuse its rule inline: `fresh = typeof fetchedAt === 'number' && Date.now() - fetchedAt <= DEFAULT_MAX_AGE_MS` with `DEFAULT_MAX_AGE_MS` from `model-catalog.js`.
- Produces: `runReview(args, deps?) → Promise<number>`. `deps` (all optional, for tests): `isTTY: boolean`, `ask: (q:string)=>Promise<string>`, `write: (s:string)=>void` (stdout), `now: ()=>number`, plus every `loadDeps()` field and `addAlias`, `removeAlias`, `recordDismissal`, `deriveFreeAlias`.

Behaviour:
1. Not a TTY (`deps.isTTY ?? !!process.stdin.isTTY` false): `view = collectAliasView({ maxAgeMs: Infinity })`; write the list (stdout); write to stderr `aliases --review is interactive: run it in a terminal, or use \`amicus aliases --json\` for machine output\n`; return 1.
2. TTY: `view = collectAliasView({})` (default `maxAgeMs` → `getCatalog` refreshes when > 24 h; §5 write gate). `fresh` computed from `view.catalogInfo.fetchedAt`. If `!fresh`: write `  catalog is <age> old and could not be refreshed — proposals are shown, but accepting is disabled until \`amicus models --refresh\` succeeds\n` (age in whole days, or hours when < 1 day).
3. No proposals: write `  Nothing to review — <N> aliases, all following or up to date.\n`; return 0.
4. For proposal `i` of `n`, write the screen:

```
  [i/n] <alias>
    currently  <current>      (pinned by you)          ← or "    not mapped yet" for unmapped
    shipped    <shipped>                               ← only when curated
    proposed   <candidates[0].id>   <reason phrase>    ← reason phrase: 'newer sibling, same tier' | 'replacement (current id is gone from the catalog)' | 'the shipped recommendation' | '<note>'

    [1] accept <id>   [2] follow the shipped pin (<id>)   [3] choose another   [4] skip   [5] never ask again
```
   Menu numbering is dynamic: one entry per candidate (label `accept <id>` for `newer-sibling`/`replacement`, `follow the shipped pin (<id>)` for `follow`, `add <alias> → <id>` for `notable`), then `choose another`, `skip`, `never ask again`. Read with `ask('  > ')`; an invalid answer re-prompts with `  choose 1-<k>\n`.
5. Accept a candidate: if `!fresh` and `why !== 'follow'` → write `  cannot accept: the catalog is not fresh (see above)\n` and re-prompt. `follow` → `removeAlias(alias)`; write `  ✓ <alias> now follows the shipped recommendation (<id>)\n`. `notable` → target name = `alias` unless it is already an effective alias, then `deriveFreeAlias(id, new Set(effective names))`; `addAlias(name, id)`; write `  ✓ <name> → <id> (pinned)\n`. Otherwise `addAlias(alias, id)`; write `  ✓ <alias> → <id> (pinned)\n`.
6. Choose another: `ask('  model id (provider/model), blank to cancel: ')`; blank → back to the menu; must contain `/`; must be in `catalogInfo.models` ids (else write `  not in the catalog — try: amicus models --search <last segment>\n`, re-ask); `!fresh` → refuse as in 5; `addAlias(alias, id)`; write the ✓ line.
7. Skip: nothing. Never ask again: `recordDismissal(proposal.dismissKey)`; write `  dismissed <dismissKey>\n`.
8. After the loop: write `  Reviewed <n> proposal(s): <a> accepted, <s> skipped, <d> dismissed.\n`; return 0.
9. Readline: create `readline.createInterface({ input: process.stdin, output: process.stdout })` only when `deps.ask` is absent; close it in `finally`.

- [ ] **Step 1: Write the failing test**

Create `tests/sidecar/aliases-review.test.js`:

```js
// tests/sidecar/aliases-review.test.js
'use strict';

const DAY = 24 * 60 * 60 * 1000;

function makeDeps({ proposals, rows = [], fetchedAt = Date.now(), answers = [], models = [] }) {
  const out = [];
  const err = [];
  const writes = { addAlias: [], removeAlias: [], recordDismissal: [] };
  const queue = [...answers];
  return {
    deps: {
      isTTY: true,
      write: (s) => out.push(String(s)),
      ask: async () => { if (queue.length === 0) { throw new Error('no more scripted answers'); } return queue.shift(); },
      collectAliasView: async () => ({ rows, proposals, catalogInfo: { models, fetchedAt, providerFailures: [] }, catalogAvailable: models.length > 0 }),
      renderAliasList: () => 'LIST\n',
      addAlias: (a, id) => writes.addAlias.push([a, id]),
      removeAlias: (a) => { writes.removeAlias.push(a); return true; },
      recordDismissal: (k) => writes.recordDismissal.push(k),
      deriveFreeAlias: (id, taken) => `free-${id.split('/').pop()}`,
      effectiveAliasNames: () => new Set(rows.map(r => r.alias)),
      stderr: (s) => err.push(String(s)),
    },
    out: () => out.join(''), err: () => err.join(''), writes,
  };
}

const glm = {
  alias: 'glm', state: 'pinned', current: 'openrouter/z-ai/glm-5.2', shipped: 'openrouter/z-ai/glm-5.3', curated: true,
  reasons: ['newer-sibling', 'differs-from-shipped'],
  candidates: [{ id: 'openrouter/z-ai/glm-5.4', why: 'newer-sibling', evidence: {} }, { id: 'openrouter/z-ai/glm-5.3', why: 'follow', evidence: {} }],
  dismissKey: 'glm@openrouter/z-ai/glm-5.4',
};
const atlas = {
  alias: 'atlas', state: 'unmapped', current: null, shipped: null, curated: false, reasons: ['notable-unmapped'],
  candidates: [{ id: 'openrouter/newco/atlas-1', why: 'notable', evidence: { note: 'new frontier entrant' } }],
  dismissKey: 'atlas@openrouter/newco/atlas-1',
};

describe('aliases --review (#238 §4, Q2, Q4)', () => {
  let runReview;
  beforeEach(() => { jest.resetModules(); ({ runReview } = require('../../src/sidecar/aliases-review')); });

  test('Q2: without a TTY it prints the list, one reason line on stderr, exit 1, writes nothing', async () => {
    const t = makeDeps({ proposals: [glm], models: [{ id: 'x/y' }] });
    t.deps.isTTY = false;
    expect(await runReview({}, t.deps)).toBe(1);
    expect(t.out()).toBe('LIST\n');
    expect(t.err()).toContain('aliases --review is interactive');
    expect(t.writes.addAlias).toEqual([]);
  });
  test('nothing to review exits 0 with a sentence', async () => {
    const t = makeDeps({ proposals: [], rows: [{ alias: 'gemini' }], models: [{ id: 'x/y' }] });
    expect(await runReview({}, t.deps)).toBe(0);
    expect(t.out()).toContain('Nothing to review');
  });
  test('accept [1] pins the sibling; the screen shows current, shipped, proposed and a numbered menu', async () => {
    const t = makeDeps({ proposals: [glm], answers: ['1'], models: [{ id: 'openrouter/z-ai/glm-5.4' }] });
    expect(await runReview({}, t.deps)).toBe(0);
    expect(t.out()).toMatch(/\[1\/1\] glm/);
    expect(t.out()).toContain('currently  openrouter/z-ai/glm-5.2');
    expect(t.out()).toContain('shipped    openrouter/z-ai/glm-5.3');
    expect(t.out()).toContain('[1] accept openrouter/z-ai/glm-5.4');
    expect(t.out()).toContain('[2] follow the shipped pin (openrouter/z-ai/glm-5.3)');
    expect(t.out()).toContain('[3] choose another');
    expect(t.writes.addAlias).toEqual([['glm', 'openrouter/z-ai/glm-5.4']]);
    expect(t.out()).toContain('✓ glm → openrouter/z-ai/glm-5.4 (pinned)');
    expect(t.out()).toContain('Reviewed 1 proposal: 1 accepted, 0 skipped, 0 dismissed.');
  });
  test('follow [2] removes the key (Q4: the encoding decides the state)', async () => {
    const t = makeDeps({ proposals: [glm], answers: ['2'], models: [{ id: 'x/y' }] });
    await runReview({}, t.deps);
    expect(t.writes.removeAlias).toEqual(['glm']);
    expect(t.writes.addAlias).toEqual([]);
    expect(t.out()).toContain('✓ glm now follows the shipped recommendation (openrouter/z-ai/glm-5.3)');
  });
  test('choose another [3] validates against the catalog and pins; blank cancels back to the menu', async () => {
    const t = makeDeps({ proposals: [glm], answers: ['3', 'nope', 'openrouter/z-ai/glm-5.9', 'openrouter/z-ai/glm-5.4'], models: [{ id: 'openrouter/z-ai/glm-5.4' }] });
    await runReview({}, t.deps);
    expect(t.out()).toContain('not in the catalog');
    expect(t.writes.addAlias).toEqual([['glm', 'openrouter/z-ai/glm-5.4']]);
  });
  test('skip [4] writes nothing; never ask again [5] records the dismissKey', async () => {
    const t = makeDeps({ proposals: [glm, { ...glm, alias: 'glm2', dismissKey: 'glm2@openrouter/z-ai/glm-5.4' }], answers: ['4', '5'], models: [{ id: 'x/y' }] });
    expect(await runReview({}, t.deps)).toBe(0);
    expect(t.writes.addAlias).toEqual([]);
    expect(t.writes.recordDismissal).toEqual(['glm2@openrouter/z-ai/glm-5.4']);
    expect(t.out()).toContain('Reviewed 2 proposals: 0 accepted, 1 skipped, 1 dismissed.');
  });
  test('an invalid answer re-prompts', async () => {
    const t = makeDeps({ proposals: [glm], answers: ['9', 'x', '4'], models: [{ id: 'x/y' }] });
    expect(await runReview({}, t.deps)).toBe(0);
    expect((t.out().match(/choose 1-5/g) || []).length).toBe(2);
  });
  test('§5 write gate: a stale catalog shows proposals but refuses accept and choose; follow still works', async () => {
    const t = makeDeps({ proposals: [glm], answers: ['1', '2'], fetchedAt: Date.now() - 3 * DAY, models: [{ id: 'x/y' }] });
    expect(await runReview({}, t.deps)).toBe(0);
    expect(t.out()).toContain('catalog is 3 days old and could not be refreshed');
    expect(t.out()).toContain('cannot accept: the catalog is not fresh');
    expect(t.writes.addAlias).toEqual([]);
    expect(t.writes.removeAlias).toEqual(['glm']);
  });
  test('notable accept adds the alias, deriving a free name when the suggested one is taken', async () => {
    const t = makeDeps({ proposals: [atlas], rows: [{ alias: 'atlas', id: 'x/z' }], answers: ['1'], models: [{ id: 'openrouter/newco/atlas-1' }] });
    await runReview({}, t.deps);
    expect(t.writes.addAlias).toEqual([['free-atlas-1', 'openrouter/newco/atlas-1']]);
    expect(t.out()).toContain('[1] add atlas → openrouter/newco/atlas-1');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest tests/sidecar/aliases-review.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/sidecar/aliases-review.js`**

Implement the behaviour list above. Skeleton (fill every branch; keep the file ≤ 300 lines — split a `renderScreen(p, i, n)` helper and a `menuFor(p)` helper out if it grows):

```js
/**
 * @module sidecar/aliases-review
 * `amicus aliases --review` (#238 §4): a numbered readline picker over the
 * engine's proposals — no copy-paste anywhere. Accept writes the chosen id and
 * the encoding decides the state (Q4): the shipped pin → `removeAlias`
 * (follows); anything else → `addAlias` (pinned). Without a TTY it refuses
 * loudly (Q2): the list, one reason line, exit 1. The §5 WRITE gate lives
 * here: accepting a catalog-vouched id needs a fresh catalog (24 h); `follow`
 * is exempt because it removes a key.
 */

'use strict';

const { DEFAULT_MAX_AGE_MS } = require('../utils/model-catalog');

function defaultDeps() {
  const base = require('./aliases');
  const d = base.loadDeps();
  return {
    ...d,
    isTTY: !!process.stdin.isTTY,
    write: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
    collectAliasView: (opts) => base.collectAliasView(opts, d),
    renderAliasList: (view) => base.renderAliasList(view, d.groupAliases),
    addAlias: require('./setup').addAlias,
    deriveFreeAlias: require('./setup').deriveFreeAlias,
    removeAlias: require('../utils/alias-store').removeAlias,
    recordDismissal: require('../utils/alias-store').recordDismissal,
    effectiveAliasNames: () => new Set(Object.keys(d.config.getEffectiveAliases())),
    now: () => Date.now(),
  };
}

function ageLabel(fetchedAt, now) {
  const ms = now - fetchedAt;
  const days = Math.floor(ms / DEFAULT_MAX_AGE_MS);
  return days >= 1 ? `${days} day${days === 1 ? '' : 's'}` : `${Math.max(1, Math.floor(ms / 3600000))} hours`;
}

function reasonPhrase(c) {
  if (c.why === 'newer-sibling') { return 'newer sibling, same tier'; }
  if (c.why === 'replacement') { return 'replacement (current id is gone from the catalog)'; }
  if (c.why === 'follow') { return 'the shipped recommendation'; }
  return (c.evidence && c.evidence.note) || 'notable model';
}

function menuFor(p) {
  const items = p.candidates.map(c => ({
    label: c.why === 'follow' ? `follow the shipped pin (${c.id})` : (c.why === 'notable' ? `add ${p.alias} → ${c.id}` : `accept ${c.id}`),
    action: 'accept', candidate: c,
  }));
  items.push({ label: 'choose another', action: 'choose' });
  items.push({ label: 'skip', action: 'skip' });
  items.push({ label: 'never ask again', action: 'dismiss' });
  return items;
}

// … renderScreen(p, i, n, items) → string; acceptCandidate(p, c, ctx) → boolean (wrote?);
// chooseAnother(p, ctx) → boolean; the loop in runReview; the summary line.

async function runReview(args, deps) {
  const d = deps || defaultDeps();
  let rl = null;
  try {
    if (!d.isTTY) {
      const view = await d.collectAliasView({ maxAgeMs: Number.POSITIVE_INFINITY });
      d.write(d.renderAliasList(view));
      d.stderr('aliases --review is interactive: run it in a terminal, or use `amicus aliases --json` for machine output\n');
      return 1;
    }
    if (!d.ask) {
      const readline = require('readline');
      rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      d.ask = (q) => new Promise((resolve) => rl.question(q, (a) => resolve((a || '').trim())));
    }
    // … the rest per the behaviour list …
  } finally {
    if (rl) { rl.close(); }
  }
}

module.exports = { runReview };
```

- [ ] **Step 4: Run the test**

Run: `npx jest tests/sidecar/aliases-review.test.js tests/sidecar/aliases-command.test.js`
Expected: PASS.

- [ ] **Step 5: Smoke it for real, keylessly, in the worktree**

Run: `node bin/amicus.js aliases` and `echo | node bin/amicus.js aliases --review; echo "exit=$?"` (the piped stdin is non-TTY → list + reason + `exit=1`). Then `node bin/amicus.js aliases --review --json; echo "exit=$?"` → `exit=1` with the argument error. Paste the three outputs into the task report. Do NOT run the interactive picker against your real config in this step — the hermetic dir is not in effect outside jest; if you want a live picker run, set `AMICUS_CONFIG_DIR` to a scratch dir first.

- [ ] **Step 6: Commit**

```bash
git add src/sidecar/aliases-review.js tests/sidecar/aliases-review.test.js
git commit -m "feat(cli): aliases --review — numbered picker (accept / follow / choose / skip / never ask again), §5 write gate, non-TTY refusal (#238 §4, Q2, Q4)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Hint rewrites (D4) and user docs

**Files:**
- Modify: `src/sidecar/models.js:205` and `:213`; `src/utils/model-validator.js:162`; `src/utils/alias-resolver.js:42`
- Modify: `docs/usage.md` (lines 24, ~400, ~420, ~462 and a new `aliases` section beside the `models` one), `docs/configuration.md` (the `aliases` comment in "Config file format", ~lines 672-681), `CHANGELOG.md` (add an `## [Unreleased]` section above `## [4.9.8]`)
- Test: grep `tests/` for `setup --add-alias` assertions and update each to the new text; `tests/sidecar/models-command.test.js`, `tests/alias-drift.test.js`, `tests/models-drift.test.js`, `tests/model-validator*.test.js`, `tests/alias-resolver*.test.js`

**Interfaces:** none new. Text only.

The spec's D4 table says all four user-facing hints "become `amicus aliases --review`". Two of them can lead to an EMPTY review — a STALE `defaults`/`curated-route` row (the shipped pin is gone and the alias follows, so the engine has nothing to propose) and a null-valued alias with no shipped default (alias-resolver) — and a hint that dead-ends is the silent degrade the product principle forbids. So: the review is the primary hint wherever the alias is a USER-CONFIG row, and `setup --add-alias` stays as the explicit fallback everywhere. Record this as a spec deviation in the commit body and the PR body.

- [ ] **Step 1: Update the tests that pin the old strings**

`grep -rn "setup --add-alias" tests/` — for each assertion on `models --check` output for a `user-config` STALE row, expect `fix: amicus aliases --review`; for a `defaults`/`curated-route` STALE row keep `fix: amicus setup --add-alias <alias>=<candidate>`; for DRIFTED rows expect `review: amicus aliases --review`. Run those suites and confirm they FAIL against the current code before editing it.

- [ ] **Step 2: Rewrite the hints**

`src/sidecar/models.js` STALE block (lines ~201-208):

```js
      if (s.suggestions.length > 0) {
        process.stdout.write(`  candidates: ${s.suggestions.join(', ')}\n`);
        // #238 D4: a user-config row is reviewable in the picker; a shipped pin
        // that went stale can only be pinned OVER until the next release.
        process.stdout.write(s.source === 'user-config'
          ? '  fix: amicus aliases --review\n'
          : `  fix: amicus setup --add-alias ${s.alias}=${s.suggestions[0]}  (pins over the stale shipped default)\n`);
      } else {
```

DRIFTED line (~213):

```js
    process.stdout.write('  stored aliases don\'t follow catalog updates — review: amicus aliases --review\n');
```

`src/utils/model-validator.js:162`:

```js
    `Fix: amicus aliases --review  (or pin directly: amicus setup --add-alias ${alias || '<alias>'}=${relevant[0] ? relevant[0].id : 'openrouter/provider/model'})\n` +
```

`src/utils/alias-resolver.js:42`:

```js
    `Fix with: amicus aliases --review, or amicus setup --add-alias ${alias}=provider/model`
```

- [ ] **Step 3: Run the affected suites**

Run: `npx jest tests/sidecar/models-command.test.js tests/alias-drift.test.js tests/models-drift.test.js tests/alias-audit-drift-evidence.test.js tests/utils/alias-audit.test.js` plus every file from Step 1's grep.
Expected: PASS.

- [ ] **Step 4: Docs**

`docs/usage.md`:
- Line 24: keep the `--add-alias` example but add above it: `amicus aliases                      # your aliases: following (shipped pin) / pinned (yours)` and `amicus aliases --review             # walk the proposals — no copy-paste`.
- Add a subsection `### Aliases: following vs pinned` right before the `models --check` material (~line 395) — six to ten lines: absence = follows the shipped pin and moves with releases; a present key = pinned and reviewable; `amicus aliases` lists; `--review` picker (accept / follow / choose / skip / never ask again; needs a terminal; `--json` for scripts); accepting the shipped pin removes the key; the wizard pins only the default you chose when its live flagship differs from the shipped pin.
- Lines ~400 and ~420: replace "Each drift line prints the exact `amicus setup --add-alias <alias>=<current>` refresh command" with "Each drift line points at `amicus aliases --review`"; replace "`amicus setup` seeds a curated set of short aliases" with "the curated aliases (`gemini`, `gpt`, `opus`, …) are shipped and follow the package's pins unless you pin them".

`docs/configuration.md` (~672-681): replace the `aliases` comment with:

```jsonc
  // Short name -> full model id, for the aliases YOU pinned. A curated alias
  // (gemini, gpt, opus, …) that is ABSENT here FOLLOWS the pin amicus ships and
  // moves with each release; a present key is pinned and reviewable with
  // `amicus aliases --review`. A key equal to the shipped pin is dropped on save
  // (with a Notice) — it is the same as following.
  "aliases": {
    "glm": "openrouter/z-ai/glm-5.4",
    "fast": "google/gemini-3.6-flash-lite"
  },
```

and add, after the `routing` block, a short `aliasReview` block: `"aliasReview": { "dismissed": { "glm@openrouter/z-ai/glm-5.4": "2026-09-14T00:00:00.000Z" } }` with a one-line comment (written by `--review`'s "never ask again"; keyed alias@proposedId; hand-delete a key to be asked again).

`CHANGELOG.md`: add above `## [4.9.8]`:

```markdown
## [Unreleased]

### Added

- **`amicus aliases`** — your model aliases as a standing command: `following` (the shipped
  pin, moves with releases) vs `pinned` (yours), grouped by vendor; `--review` walks every
  proposal in a numbered picker (accept a newer same-tier sibling, follow the shipped pin,
  choose another catalog id, skip, or never ask again — no copy-paste); `--json` for scripts.
  Without a terminal `--review` prints the list, says it is interactive, and exits 1. (#238)

### Changed

- **A curated alias follows the shipped pin unless you pin it.** A name absent from
  `config.aliases` resolves to the pin amicus ships (this is how the merge always worked);
  a present key is a pin. On save, a key equal to the shipped pin is dropped with a Notice —
  every alias still resolves to the same id it did before. The setup wizard no longer seeds
  the 21 curated ids; it pins only the default you chose, and only when its live flagship
  differs from the shipped pin, and says so. (#238 D1/D6/Q9)
- **The drift report cannot propose a downgrade.** `models --check`'s family fallback-drift
  line ignores non-authoritative catalog rows and is silent when the OpenRouter namespace was
  rejected this run. (#238 §5)
- The `--add-alias` copy-paste hints in `models --check`, model validation and alias repair now
  point at `amicus aliases --review` where the alias is reviewable there. (#238 D4)
```

- [ ] **Step 5: Commit**

```bash
git add src/sidecar/models.js src/utils/model-validator.js src/utils/alias-resolver.js docs/usage.md docs/configuration.md CHANGELOG.md tests/
git commit -m "docs(aliases): hints point at aliases --review for reviewable rows; usage, configuration and CHANGELOG for follow-or-pin (#238 D4)

Spec deviation, recorded: a STALE shipped default and a null custom alias keep
the setup --add-alias hint — the picker has nothing to propose for them, and a
hint that dead-ends is the silent degrade the product principle forbids.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Integration — merge, full gates, whole-branch review

**Files:** none new. Runs in the integration worktree `C:\Users\sendt\code\amicus-238`.

- [ ] **Step 1: Merge the last wave** (`git merge --no-ff feat/238-pr1-task-8`, then `-task-9`); regenerate docs on any `architecture-map.md` conflict.

- [ ] **Step 2: Full gates**

```bash
npm run lint
npm test
node scripts/generate-docs.js --check
npm run test:integration
node scripts/check-file-sizes.js --all
```

Expected: lint clean; `npm test` all suites green (record the suite/test counts; `.test-passed` = HEAD); docs current; keyless integration tier green; no file over 300 lines. `grep -rn "toLiveSeedAliases" src electron tests docs` returns only this plan and the spec.

- [ ] **Step 3: Spec coverage sweep** — for each of §6 groups 1–6 name the test file that covers it; for §4 paste the three real outputs from Task 8 Step 5; confirm the five hint sites read as Task 9 says (`grep -n "aliases --review" src/`).

- [ ] **Step 4: Whole-branch review** — dispatch a reviewer subagent with the spec, this plan and `git diff main...HEAD`; fix findings; re-run Step 2.

- [ ] **Step 5: PR body draft** — write `.superpowers/sdd/2026-09-14-238-pr1/pr-body.md` (gitignored dir): summary, the D1/D6/Q9 behaviour change in plain words, the spec deviation from Task 9, the mutant list (FLOORPICK, FAILEDNS, KEEPEQUAL, FLOORSIBLING, FAILEDCANDIDATE, OLDERSIBLING), gate outputs, and the release-ritual note (Phase 1 changes what a fresh `amicus setup` writes — the ritual's live setup run must show the "pinned" announcement or `aliases: {}`). Stop before pushing: the push and `gh pr create --label council-review` are the owner's call.

---

## Self-review (run before dispatch)

**Spec coverage.** D1 → T3/T7 (state by presence, list shows it). D2 → unchanged merge; T3 test "no-op proof". D4 (user half) → T7/T8/T9 (hints; `--ui`/`--owner` are Phases 3/2 and deliberately absent from the usage block so the flag registry cannot silently accept them). D6 → T3 (normalization), T5 (wizard), T7 (normalize on entry), `buildAliasTable` → T3. D7 mechanical + dismissal → T1/T4/T6. §2 shape → T6. §4 list/review/non-TTY → T7/T8. §5 → T2 (report), T6 (display gate), T8 (write gate). §6.1–6.6 → T6, T2/T6, T3, T3, T5, T7/T8; §6.10 hint rows → T9. Q2 → T7 (arg error) + T8 (non-TTY). Q3 → T3. Q4 → T6 (one per alias, follow candidate) + T8 (accept semantics). Q5 dismissal half → T4/T6/T8 (the notice itself is Phase 4). Q9 → T5. Not in this PR, by §7: D5, D8, D9, Q1, Q6, Q7, Q8, `--ui`, `--owner`, the `models --check` sibling line.

**Placeholders.** Task 8 Step 3 shows a skeleton with the behaviour list beside it rather than the full 250-line file; every branch's observable behaviour and message text is specified in the list and pinned by the test in Step 1, so the implementer has no decision to make. No other step defers content.

**Type consistency.** `listAliasRows` row shape `{alias, id, state, curated, shipped}` is identical in T3, T6 (`ctx.mapped`, `proposeForRow`), T7 (`--json` `aliases`), T8 (`rows`). Proposal shape identical in T6, T7 (`proposals`), T8 (`glm`/`atlas` fixtures). `collectAliasView(opts, d)` signature identical in T7 and T8's `defaultDeps`. `normalizeAliases(aliases, defaults, notify)` identical in T3 (module, `saveConfig`) and T7 (`normalizeOnEntry`, which passes no notifier because `saveConfig` prints). `removeAlias`/`recordDismissal`/`readDismissals` identical in T4, T7, T8. `newestSibling(pinned, catalogIds)` identical in T1 and T6.
