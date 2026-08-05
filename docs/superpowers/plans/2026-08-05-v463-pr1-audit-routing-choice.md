# v4.6.3 PR1 — "the audit learns routing choice" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `models --check` stops false-flagging deliberate gateway-only routes as STALE (and stops suggesting a harmful retarget), and fable gains its verified authored direct route — spec §4 of `docs/superpowers/specs/2026-08-05-v463-post-train-sweep-design.md` (approved; rulings R1/R2 taken 2026-08-05).

**Architecture:** All changes live in three utils (`curated-models.js` data + a new provenance accessor; `gateway-route-audit.js` and `alias-audit.js` consume it) plus the `ANTHROPIC_MODELS` floor. `src/sidecar/models.js` (292/300, extract-first rider) is a pure consumer of the findings arrays and is **deliberately byte-untouched** — recon proved no counter line, no header, and no exit-code code depends on finding counts in a way that needs edits.

**Tech Stack:** Node.js (CommonJS), jest. No new dependencies. No new src file → `scripts/generate-docs.js` marker regen NOT needed.

## Global Constraints

- 300-line size gate over `src/**` — measured today: `curated-models.js` 239, `alias-audit.js` 162, `gateway-route-audit.js` 103, `models.js` 292 (**do not edit models.js at all**; "while we're in here" is how the rider fires).
- Test branch code with `node bin/amicus.js`, never the PATH `amicus`.
- NEVER bare `npm install` (worktree node_modules is a junction into the main clone — already provisioned).
- Any test that fully mocks `curated-models` or `alias-audit` MUST export every symbol its consumers require — a missing export throws at require time (the `models-drift.test.js` lesson, v4.6.2).
- `git push` needs a ≥5-minute timeout (pre-push hook runs the full suite).
- Worktree: `C:\Users\sendt\code\amicus-wt-v463-pr1`, branch `feat/v4.6.3-pr1-audit-routing-choice`.
- Run any single suite: `npx jest tests/<file>`. Full unit suite: `npm test`. Baseline at branch: 492 suites / 6468 passed / 0 fail.
- Exit-code DERIVATION code must stay byte-identical (`models.js:187-190,212`); the check's exit VALUE changes 1→0 on the real config (data-driven, intended).

**Measured reality this plan is built on (recon 2026-08-05, wf_52b6a2ac-c7d; re-verify only if the branch base moves):**
- fable entry: `curated-models.js:89` (openrouter-only). gpt-pro entry + ruling comment: `:74-80`. `directFormFor` `:184-189`, `gatewayRoutesFor` `:196-201`, `toGatewayRoutes` `:210-215`, `toDefaultAliases` `:229-235`, exports `:237-239`.
- Flat STALE classifier: `alias-audit.js:68-85`; `covered` suppression (curated-route rows ONLY) at `:82`; `'defaults'` source rows come from `config.getDefaultAliases()` ← `toDefaultAliases()` (`config.js:15-16,80-82`). `suggestReplacements` `:96-109`. Exports `:162`.
- Gateway audit: `gateway-route-audit.js:71-101`; per-form stale loop `:75-82` has no sibling awareness; divergent branches `:84-97` guarded by `isAuthoritative`.
- Rendering (NO edits): STALE/candidates/fix at `models.js:224-233`, GATEWAY lines at `:134-142`, header only when findings exist `:251-254`, exit `:187-190`.
- Doctor `aliases` row: `cli-handlers-doctor.js:151-164` — injects `findStaleAliases`, inherits the fix automatically.
- Floor: `model-fetcher.js:18-30` (6 rows, no fable), keyless branch `:117-126`, docblock to rewrite `:10-17`. `classifyModel`: presence → `'valid'` BEFORE the authoritative check (`model-classification.js:34-63`).
- fable direct path verified live 2026-08-05: `/v1/models` lists `claude-fable-5` (authoritative fetch) AND a direct smoke leg served (wave `47278069`, $0.7239 — do NOT re-probe).

---

### Task 1: fable's authored direct route + the ANTHROPIC_MODELS floor row (the coupled data change)

**Files:**
- Modify: `src/utils/curated-models.js:89` (fable entry), `:70-73` (CARDLESS docblock), `:159-166` (DIVERGENT_VENDORS docblock), `:225-226` (toDefaultAliases docblock, light touch)
- Modify: `src/utils/model-fetcher.js:10-30` (docblock rewrite + floor row)
- Test (value-pin updates): `tests/curated-models.test.js:61-63`, `tests/curated-models-gateway-routes.test.js:16-19`, `tests/config.test.js:196-201`, `tests/utils/alias-audit-shipped-defaults.test.js:68-70`, `tests/model-fetcher-anthropic.test.js:53-77`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `toGatewayRoutes().fable` = `{ direct: 'anthropic/claude-fable-5', openrouter: 'openrouter/anthropic/claude-fable-5' }`; `toDefaultAliases().fable` = `'anthropic/claude-fable-5'`; floor contains `anthropic/claude-fable-5`. Tasks 2-4 rely on these values.

- [ ] **Step 1: Flip the five value-pin suites to the NEW expected values (this is the failing-test step — the pins are the tests)**

`tests/curated-models-gateway-routes.test.js` — replace the fable shape assertion (recon: lines 16-19, incl. the `r.fable.direct` `toBeUndefined()`):
```js
  test('fable carries BOTH gateway forms (direct route authored 2026-08-05, ruling R2)', () => {
    expect(r.fable).toEqual({
      direct: 'anthropic/claude-fable-5',
      openrouter: 'openrouter/anthropic/claude-fable-5',
    });
  });
```

`tests/curated-models.test.js:63` — replace the fable default pin (and its "OpenRouter-only today" comment):
```js
    // fable: direct route authored 2026-08-05 (ruling R2) — /v1/models lists
    // claude-fable-5 and a live direct leg served. Pinned direct-first.
    expect(defaults.fable).toBe('anthropic/claude-fable-5');
```

`tests/config.test.js:200` — same value flip:
```js
    expect(aliases.fable).toBe('anthropic/claude-fable-5');
```

`tests/utils/alias-audit-shipped-defaults.test.js:70` — same value flip:
```js
    expect(defaults.fable).toBe('anthropic/claude-fable-5');
```

`tests/model-fetcher-anthropic.test.js` — (a) add the fable row to the exact-list pin (recon: lines 55-66); (b) DELETE the `expect(ids).not.toContain('anthropic/claude-fable-5')` guard and its rationale comment (recon: lines 72-76) — the guard's premise inverted: the direct API now genuinely serves the id, so a floor listing is truth, not a mislabel. Replace the deleted guard with:
```js
  test('fable IS on the floor (direct route authored 2026-08-05 — the old never-list guard inverted)', () => {
    const ids = ANTHROPIC_MODELS.map(m => m.id);
    expect(ids).toContain('anthropic/claude-fable-5');
  });
```

- [ ] **Step 2: Run the five suites — verify RED, and that every failure is one of the flipped pins**

Run: `npx jest tests/curated-models.test.js tests/curated-models-gateway-routes.test.js tests/config.test.js tests/utils/alias-audit-shipped-defaults.test.js tests/model-fetcher-anthropic.test.js`
Expected: FAIL — exactly the assertions edited in Step 1 (old data). Any OTHER failure means a mis-edit: stop and fix.

- [ ] **Step 3: Author the route + floor row + de-stale the comments**

`src/utils/curated-models.js:89` — replace the fable line:
```js
  // fable: direct route authored 2026-08-05 (owner ruling R2, v4.6.3 spec §3).
  // Anthropic's /v1/models lists claude-fable-5 AND the direct route serves
  // (live smoke wave 47278069) — the entry was OpenRouter-only at authoring.
  { alias: 'fable', routes: { openrouter: 'openrouter/anthropic/claude-fable-5',
                              anthropic: 'anthropic/claude-fable-5' } },
```

`src/utils/curated-models.js:70-73` — CARDLESS docblock, replace "openrouter route only." :
```js
/**
 * Alias-only entries (no wizard quick pick). Every entry authors an
 * openrouter route; entries whose vendor's direct API genuinely serves the
 * model also author a direct route (claude/sonnet/haiku/fable).
 * Refreshed against the live catalog 2026-08-04.
 */
```

`src/utils/curated-models.js:163` — DIVERGENT_VENDORS docblock, replace the stale example line ("for a model that is OpenRouter-only today (e.g. fable)."):
```js
 * these — derivation would emit the wrong (dot) id, or invent a direct id
 * for a model the direct API does not serve (fable was that case until its
 * direct route was verified and authored, 2026-08-05).
```

`src/utils/curated-models.js:225-226` — toDefaultAliases docblock: the claim is historical and stays; change only `OpenRouter-only models (\`fable\`)` → `then-OpenRouter-only models (\`fable\`, direct-authored 2026-08-05)`.

`src/utils/model-fetcher.js:10-17` — replace the docblock (its premise — "Fable is OpenRouter-only … must never appear here" — is now false):
```js
/**
 * Hardcoded Anthropic floor: the anthropic/ rows a KEYLESS user (or a
 * failed live fetch) gets. Every id here must be one the direct API
 * GENUINELY serves — classifyModel() returns 'valid' on a floor HIT before
 * it ever checks `authoritative`, so a speculative row would mislabel a
 * dead direct-API request as valid. (fable joined 2026-08-05 after live
 * verification — /v1/models lists claude-fable-5 and a direct smoke leg
 * served; v4.6.3 spec §3.)
 */
```

`src/utils/model-fetcher.js` — add the floor row after the `claude-sonnet-5` row:
```js
  { id: 'anthropic/claude-fable-5', name: 'Claude Fable 5', contextLength: null, pricing: null },
```

- [ ] **Step 4: Run the Task-1 dependent set — verify GREEN**

Run:
```
npx jest tests/curated-models.test.js tests/curated-models-gateway-routes.test.js tests/config.test.js tests/quick-picks.test.js tests/model-tiers.test.js tests/council-presets.test.js tests/utils/alias-audit.test.js tests/utils/alias-audit-shipped-defaults.test.js tests/utils/gateway-route-audit.test.js tests/alias-drift.test.js tests/models-drift.test.js tests/sidecar/models-command.test.js tests/model-fetcher.test.js tests/model-fetcher-anthropic.test.js tests/model-fetcher-local.test.js tests/utils/model-fetcher-enrichment.test.js tests/model-classification.test.js tests/route-launch.test.js tests/gateway-route-catalog.test.js tests/gateway-router.test.js tests/setup-ui-aliases.test.js tests/provider-default-picker.test.js
```
Expected: ALL PASS. Notes for triage if not: `alias-audit-shipped-defaults`'s floor-clean test (`:53-58`) passes ONLY because Step 3 added the floor row (the 3-way coupling); `quick-picks.test.js:126-133` (`toLiveSeedAliases(null)` equals `toDefaultAliases()`) auto-holds; `council-presets.test.js` — fable is not a BUDGET/FRONTIER member (verify by reading the preset arrays if it fails; a bare-direct member value breaks its `split('/')[1]` vendor derivation).

- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "feat(curated-models): author fable's verified direct route + floor row (R2)"
```

### Task 2: `directFormProvenance()` accessor + the gpt-pro `gatewayOnly` annotation

**Files:**
- Modify: `src/utils/curated-models.js` (gpt-pro entry `:74-80`; new function beside `gatewayRoutesFor`; exports line)
- Test: `tests/curated-models.test.js` (new describe)

**Interfaces:**
- Consumes: Task 1's fable route (the `authored` pin below asserts it).
- Produces: `directFormProvenance(): Object<alias, { directForm: 'authored'|'derived'|'none', gatewayOnly: boolean }>` — exported from `curated-models.js`; Tasks 3 and 4 import exactly this name/shape.

- [ ] **Step 1: Write the failing tests** — new describe at the end of `tests/curated-models.test.js`:
```js
describe('directFormProvenance (v4.6.3 PR1 — provenance for the auditors)', () => {
  const { directFormProvenance, toGatewayRoutes } = require('../src/utils/curated-models');
  const prov = directFormProvenance();

  test('authored: explicit direct routes (fable joined 2026-08-05)', () => {
    for (const a of ['fable', 'opus', 'haiku', 'claude', 'sonnet']) {
      expect(prov[a]).toEqual({ directForm: 'authored', gatewayOnly: false });
    }
  });

  test('derived: non-divergent vendors with no explicit direct route', () => {
    expect(prov.gpt).toEqual({ directForm: 'derived', gatewayOnly: false });
    expect(prov.codex).toEqual({ directForm: 'derived', gatewayOnly: false });
  });

  test('gpt-pro is derived AND gatewayOnly — the 2026-08-05 owner ruling in data', () => {
    expect(prov['gpt-pro']).toEqual({ directForm: 'derived', gatewayOnly: true });
  });

  test('none: gateway-only vendors derive nothing', () => {
    expect(prov.grok).toEqual({ directForm: 'none', gatewayOnly: false });
  });

  test('covers every toGatewayRoutes() alias — the two can never disagree on the key set', () => {
    expect(Object.keys(prov).sort()).toEqual(Object.keys(toGatewayRoutes()).sort());
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/curated-models.test.js`
Expected: FAIL with `directFormProvenance is not a function`.

- [ ] **Step 3: Implement** — in `src/utils/curated-models.js`:

(a) gpt-pro entry gains the annotation (append to the existing `:74-80` comment block, keep every existing line):
```js
  // gatewayOnly (owner ruling 2026-08-05, recorded in the v4.6.3 spec): the
  // openrouter-only route is a deliberate routing choice — OpenAI's direct
  // namespace does not serve gpt-5.6-sol-pro, so the DERIVED direct form
  // must never be audited as stale and no direct pairing may be suggested.
  { alias: 'gpt-pro', gatewayOnly: true,
    routes: { openrouter: 'openrouter/openai/gpt-5.6-sol-pro' } },
```

(b) New function directly after `gatewayRoutesFor` (single-sources the taxonomy through `directFormFor` — never re-derive its branches):
```js
/**
 * Per-alias provenance of the `direct` form in toGatewayRoutes(), for the
 * auditors (alias-audit.js / gateway-route-audit.js): an AUTHORED direct
 * form absent from its namespace is stale; a DERIVED one is a computed
 * convenience whose absence is a routing fact, not staleness, while the
 * authoring openrouter route is live. `gatewayOnly` mirrors an entry's
 * explicit routing-choice annotation (owner-ruled): suppress derived-form
 * findings unconditionally and never suggest a direct pairing.
 * @returns {Object<string, {directForm: 'authored'|'derived'|'none', gatewayOnly: boolean}>}
 */
function directFormProvenance() {
  const out = {};
  const entryProv = (vendorPath, obj, gatewayOnly) => {
    const direct = directFormFor(vendorPath, obj);
    const directForm = !direct ? 'none' : (obj[vendorPath] ? 'authored' : 'derived');
    return { directForm, gatewayOnly: gatewayOnly === true };
  };
  for (const f of FAMILIES) { out[f.alias] = entryProv(f.vendorPath, f.fallback, f.gatewayOnly); }
  for (const e of CARDLESS) { out[e.alias] = entryProv(vendorOf(e.routes.openrouter), e.routes, e.gatewayOnly); }
  return out;
}
```

(c) Exports line grows:
```js
module.exports = {
  getFamilies, toDefaultAliases, toCanonicalDefault, listCuratedRoutes, toGatewayRoutes,
  directFormProvenance, DIVERGENT_VENDORS
};
```

- [ ] **Step 4: Run to verify it passes** — `npx jest tests/curated-models.test.js` → PASS. Then `npm run check:sizes` → curated-models.js must still be ≤300 (239 + ~25 lines lands ~264).

- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "feat(curated-models): directFormProvenance accessor + gpt-pro gatewayOnly annotation (D1)"
```

### Task 3: gateway-audit suppression (derived-direct misses + gatewayOnly)

**Files:**
- Modify: `src/utils/gateway-route-audit.js:33` (import), `:71-101` (auditGatewayRoutes)
- Test: `tests/utils/gateway-route-audit.test.js` (mock factory + new cases)

**Interfaces:**
- Consumes: `directFormProvenance()` from Task 2 (exact shape above).
- Produces: unchanged finding rows `{alias, gateway, kind, model, expected?}` — only WHICH findings are emitted changes.

- [ ] **Step 1: Write the failing tests** — in `tests/utils/gateway-route-audit.test.js`. FIRST update the module mock factory: everywhere the suite mocks `../../src/utils/curated-models` (recon: `:14`), the factory must now also export `directFormProvenance` (returning a per-case map) or the require throws. Then add cases (adapt each to the file's existing fixture helpers — catalog rows are `{id, authoritative?}` objects):
```js
  describe('derived-direct suppression + gatewayOnly (v4.6.3 PR1, spec D2)', () => {
    test('DERIVED direct miss with a catalog-valid openrouter sibling is NOT stale', () => {
      setRoutes({ 'gpt-pro': { direct: 'openai/gpt-5.6-sol-pro', openrouter: 'openrouter/openai/gpt-5.6-sol-pro' } });
      setProvenance({ 'gpt-pro': { directForm: 'derived', gatewayOnly: false } });
      const catalog = catalogOf(['openai/gpt-5.6-sol', 'openrouter/openai/gpt-5.6-sol-pro']);
      expect(auditGatewayRoutes(catalog).filter(f => f.kind === 'stale')).toEqual([]);
    });

    test('DERIVED direct miss with the openrouter sibling ALSO dead still reports BOTH', () => {
      setRoutes({ 'gpt-pro': { direct: 'openai/gpt-5.6-sol-pro', openrouter: 'openrouter/openai/gpt-5.6-sol-pro' } });
      setProvenance({ 'gpt-pro': { directForm: 'derived', gatewayOnly: false } });
      const catalog = catalogOf(['openai/gpt-5.6-sol', 'openrouter/openai/gpt-5.6-sol']);
      const stale = auditGatewayRoutes(catalog).filter(f => f.kind === 'stale');
      expect(stale.map(f => f.gateway).sort()).toEqual(['direct', 'openrouter']);
    });

    test('AUTHORED direct miss still reports — suppression never blankets authored routes', () => {
      setRoutes({ haiku: { direct: 'anthropic/claude-haiku-4-5-20251001', openrouter: 'openrouter/anthropic/claude-haiku-4.5' } });
      setProvenance({ haiku: { directForm: 'authored', gatewayOnly: false } });
      const catalog = catalogOf(['anthropic/claude-sonnet-5', 'openrouter/anthropic/claude-haiku-4.5']);
      expect(auditGatewayRoutes(catalog).filter(f => f.kind === 'stale')).toEqual([
        { alias: 'haiku', gateway: 'direct', kind: 'stale', model: 'anthropic/claude-haiku-4-5-20251001' },
      ]);
    });

    test('gatewayOnly suppresses the derived-direct stale even when the openrouter form is absent from the catalog', () => {
      setRoutes({ 'gpt-pro': { direct: 'openai/gpt-5.6-sol-pro', openrouter: 'openrouter/openai/gpt-5.6-sol-pro' } });
      setProvenance({ 'gpt-pro': { directForm: 'derived', gatewayOnly: true } });
      const catalog = catalogOf(['openai/gpt-5.6-sol']); // openrouter ns EMPTY -> 'unknown', not 'valid'
      expect(auditGatewayRoutes(catalog).filter(f => f.gateway === 'direct')).toEqual([]);
    });

    test('gatewayOnly suppresses divergent-missing — a declared routing choice never gets a pairing suggestion', () => {
      setRoutes({ shadow: { openrouter: 'openrouter/openai/some-model' } });
      setProvenance({ shadow: { directForm: 'none', gatewayOnly: true } });
      const catalog = catalogOf(['openai/some-model', 'openrouter/openai/some-model']);
      expect(auditGatewayRoutes(catalog).filter(f => f.kind === 'divergent-missing')).toEqual([]);
    });
  });
```
(`setRoutes`/`setProvenance`/`catalogOf` = whatever fixture idiom the file already uses for mocking `toGatewayRoutes` and building `catalogInfo` — reuse it, do not invent a parallel helper. The last case's suppression-free twin already exists as the old fable divergent-missing test at `:91-102`: REWRITE that test's fixture to `gatewayOnly: false` provenance so it keeps pinning the positive direction.)

- [ ] **Step 2: Run to verify the new cases fail** — `npx jest tests/utils/gateway-route-audit.test.js` — the three suppression cases FAIL against current code (findings ARE emitted); the authored/both-dead cases may already pass (they pin no-regression).

- [ ] **Step 3: Implement** — `src/utils/gateway-route-audit.js`:

Import (line 33 area): `const { toGatewayRoutes, directFormProvenance } = require('./curated-models');`

Rework `auditGatewayRoutes` (`:71-101`) — full replacement body:
```js
function auditGatewayRoutes(catalogInfo) {
  const routes = toGatewayRoutes();
  const provenance = directFormProvenance();
  const findings = [];

  for (const [alias, forms] of Object.entries(routes)) {
    const prov = provenance[alias] || { directForm: 'none', gatewayOnly: false };
    for (const gateway of ['direct', 'openrouter']) {
      const id = forms[gateway];
      if (!id) { continue; }
      if (classifyModel(id, gateway, catalogInfo) !== 'invalid') { continue; }
      // v4.6.3 PR1 (spec D2): a DERIVED direct form is a computed convenience,
      // not an authored claim. Its absence from the direct namespace is a
      // routing fact — not staleness — while the authoring openrouter route
      // is live, or when the entry declares gatewayOnly (an owner-ruled
      // routing choice). An AUTHORED direct form absent from its namespace
      // reports exactly as before.
      if (gateway === 'direct' && prov.directForm === 'derived' &&
          (prov.gatewayOnly ||
           classifyModel(forms.openrouter, 'openrouter', catalogInfo) === 'valid')) {
        continue;
      }
      findings.push({ alias, gateway, kind: 'stale', model: id });
    }

    const vendor = vendorOf(forms.openrouter);
    if (!vendor || !isDirectProvider(vendor)) { continue; } // gateway-only vendor: no direct route ever possible
    if (prov.gatewayOnly) { continue; } // declared routing choice: never suggest a direct pairing
    const token = bareSegment(forms.openrouter, vendor);
    if (!token) { continue; }
    const paired = pairAcrossGateways(vendor, token, catalogInfo); // Task-5 contract: bare segment only
    if (!paired.direct || !isAuthoritative(catalogInfo, paired.direct)) { continue; } // unconfirmed -- never guess

    if (!forms.direct) {
      findings.push({ alias, gateway: 'direct', kind: 'divergent-missing', model: paired.direct });
    } else if (forms.direct !== paired.direct) {
      findings.push({
        alias, gateway: 'direct', kind: 'divergent-mismatch', model: forms.direct, expected: paired.direct
      });
    }
  }

  return findings;
}
```
(The stale loop's `push` moves behind two `continue` guards — behavior for every non-derived case is byte-equivalent. Do NOT touch the `isAuthoritative` asymmetry: the stale branch keeps trusting `classifyModel`'s `'unknown'` handling for keyless namespaces.)

- [ ] **Step 4: Run to verify green** — `npx jest tests/utils/gateway-route-audit.test.js tests/sidecar/models-command.test.js tests/curated-models.test.js` → PASS (models-command mocks the audit module — its fable divergent-missing RENDERING fixture at `:419-432` stays valid by design).

- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "feat(gateway-route-audit): derived-direct + gatewayOnly suppression (D2)"
```

### Task 4: flat-audit suppression — the `'defaults'` row + the harmful-suggestion regression pin

**Files:**
- Modify: `src/utils/alias-audit.js:68-85` (findStaleAliases)
- Test: `tests/utils/alias-audit.test.js` (mocked-unit cases), `tests/utils/alias-audit-shipped-defaults.test.js` (the real-module harmful-suggestion pin)

**Interfaces:**
- Consumes: `directFormProvenance()` (Task 2).
- Produces: `findStaleAliases(sources, catalog)` — signature unchanged; `'defaults'`-source rows can now be suppressed.

- [ ] **Step 1: Write the failing tests**

(a) `tests/utils/alias-audit.test.js` — the suite `jest.doMock`s `curated-models` (recon `:111,128`); every such factory must now also stub `directFormProvenance` (default `() => ({})` where the case doesn't care). Add a describe (adapt to the file's existing doMock/require idiom):
```js
  describe("defaults-row suppression via provenance (v4.6.3 PR1, spec D2)", () => {
    const catalog = [
      { id: 'openai/gpt-5.6-sol' },                    // direct ns exists, sol-pro absent
      { id: 'openrouter/openai/gpt-5.6-sol-pro' },     // authored openrouter route LIVE
    ];
    const rows = [
      { alias: 'gpt-pro', model: 'openai/gpt-5.6-sol-pro', source: 'defaults' },
      { alias: 'gpt-pro', model: 'openrouter/openai/gpt-5.6-sol-pro', source: 'curated-route (openrouter)' },
    ];

    test('a defaults row that is the DERIVED direct form is suppressed when the alias is covered live', () => {
      withProvenance({ 'gpt-pro': { directForm: 'derived', gatewayOnly: false } }, () => {
        expect(findStaleAliases(rows, catalog)).toEqual([]);
      });
    });

    test('an AUTHORED defaults row still reports stale — no blanket suppression', () => {
      withProvenance({ 'gpt-pro': { directForm: 'authored', gatewayOnly: false } }, () => {
        expect(findStaleAliases(rows, catalog).map(r => r.source)).toEqual(['defaults']);
      });
    });

    test('derived + NOT covered + NOT gatewayOnly still reports (both routes dead = real staleness)', () => {
      const deadCatalog = [{ id: 'openai/gpt-5.6-sol' }, { id: 'openrouter/openai/gpt-5.6-sol' }];
      withProvenance({ 'gpt-pro': { directForm: 'derived', gatewayOnly: false } }, () => {
        expect(findStaleAliases(rows, deadCatalog).length).toBeGreaterThan(0);
      });
    });

    test('gatewayOnly suppresses the defaults row even with no live coverage', () => {
      const deadCatalog = [{ id: 'openai/gpt-5.6-sol' }, { id: 'openrouter/openai/gpt-5.6-sol' }];
      withProvenance({ 'gpt-pro': { directForm: 'derived', gatewayOnly: true } }, () => {
        expect(findStaleAliases(rows, deadCatalog).filter(r => r.source === 'defaults')).toEqual([]);
      });
    });

    test('user-config rows are NEVER provenance-suppressed (setup --add-alias single-row path)', () => {
      const userRow = [{ alias: 'gpt-pro', model: 'openai/gpt-5.6-sol-pro', source: 'user-config' }];
      withProvenance({ 'gpt-pro': { directForm: 'derived', gatewayOnly: true } }, () => {
        expect(findStaleAliases(userRow, catalog).length).toBe(1);
      });
    });
  });
```
(`withProvenance` = whatever re-mock+re-require shape the file already uses to vary the curated-models stub per case.)

(b) `tests/utils/alias-audit-shipped-defaults.test.js` — the REAL-module harmful-suggestion regression pin (the spec §4 acceptance line). Add:
```js
  test('the shipped gpt-pro default NEVER reports stale (and thus never yields a retarget fix:) while its authored openrouter route is live — the 2026-08-05 release-gate false positive', () => {
    // Direct openai namespace serves the 5.6 base tiers but NOT sol-pro
    // (today's real catalog shape); the authored openrouter route is live.
    const catalog = [
      { id: 'openai/gpt-5.6-sol' }, { id: 'openai/gpt-5.6-terra' }, { id: 'openai/gpt-5.6-luna' },
      { id: 'openrouter/openai/gpt-5.6-sol-pro' },
    ];
    const stale = findStaleAliases(collectAliasSources(), catalog);
    expect(stale.filter(r => r.alias === 'gpt-pro')).toEqual([]);
  });
```

- [ ] **Step 2: Run to verify RED** — `npx jest tests/utils/alias-audit.test.js tests/utils/alias-audit-shipped-defaults.test.js` — the suppression cases and the shipped-defaults pin FAIL (current code reports the defaults row stale); the authored/user-config/both-dead pins may already pass.

- [ ] **Step 3: Implement** — `src/utils/alias-audit.js`, replace `findStaleAliases` (`:68-85`):
```js
function findStaleAliases(sources, catalog) {
  if (!catalog || catalog.length === 0) { return []; }
  const byProvider = idsByProvider(catalog);
  const isLive = model => {
    const ids = byProvider.get(model.split('/')[0]);
    return ids ? ids.has(model) : null;
  };
  const covered = new Set(
    sources.filter(({ model }) => isLive(model) === true).map(({ alias }) => alias)
  );
  // v4.6.3 PR1 (spec D2). Lazy-required so suites that doMock curated-models
  // for other cases keep working; a stub without the accessor simply gets no
  // suppression (fail-open toward reporting).
  const cm = require('./curated-models');
  const provenance = typeof cm.directFormProvenance === 'function' ? cm.directFormProvenance() : {};
  return sources.filter(({ alias, model, source }) => {
    const ids = byProvider.get(model.split('/')[0]);
    if (!ids) { return false; } // provider unverifiable
    if (ids.has(model)) { return false; } // live
    if (source.startsWith('curated-route') && covered.has(alias)) { return false; }
    // A 'defaults' pin that is the alias's DERIVED direct form: its absence
    // from the direct namespace is a routing fact, not staleness, while the
    // alias has live coverage (or declares gatewayOnly). The fix: suggestion
    // this row would otherwise print is a retarget nobody should run — the
    // 2026-08-05 release-gate false positive (v4.6.3 spec §3).
    const prov = provenance[alias];
    if (source === 'defaults' && prov && prov.directForm === 'derived' &&
        (prov.gatewayOnly || covered.has(alias))) { return false; }
    return true;
  });
}
```

- [ ] **Step 4: Run to verify green + the dependent set**

Run: `npx jest tests/utils/alias-audit.test.js tests/utils/alias-audit-shipped-defaults.test.js tests/alias-drift.test.js tests/models-drift.test.js tests/sidecar/models-command.test.js tests/sidecar/setup-seeding.test.js tests/models-local-rows.test.js tests/schemas.test.js`
Expected: ALL PASS (doctor's aliases row and `setup --add-alias` inherit through injection; `--json` doc shape is count-derived, schema-clean per recon).

- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "feat(alias-audit): provenance-aware defaults-row suppression + harmful-fix regression pin (D2)"
```

### Task 5: docs, CHANGELOG, BACKLOG amendment, live validation, full gates

**Files:**
- Modify: `docs/usage.md` (models --check section), `CHANGELOG.md` (`[Unreleased]`), `BACKLOG.md` (the 2026-08-05 release-gate rider's closing clause)

**Interfaces:** consumes everything; produces the PR-ready branch.

- [ ] **Step 1: Docs.** `docs/usage.md` models `--check` section — add (adapt placement to the section's existing voice):
```markdown
A curated alias whose direct form is *derived* from its OpenRouter route (rather than
authored) is not reported STALE when that direct form is missing from the vendor's
direct namespace while the OpenRouter route still serves — a gateway-only route with
no direct sibling is a routing choice, not staleness. Deliberately gateway-only
entries (e.g. `gpt-pro`) are annotated as such and are never offered a retarget.
```
`CHANGELOG.md` `[Unreleased]`:
```markdown
### Added

- **`fable` now carries an authored direct-Anthropic route** (`anthropic/claude-fable-5`,
  verified live: Anthropic's `/v1/models` lists it and a direct leg serves). With an
  Anthropic key present, `fable` routes direct-first like the other Anthropic aliases;
  the `ANTHROPIC_MODELS` floor gains a matching row so keyless installs validate it.

### Fixed

- **`models --check` no longer false-flags deliberate gateway-only routes.** A curated
  alias whose direct form is derived (not authored) from its OpenRouter route is no
  longer reported STALE — flat row, `GATEWAY STALE` row, candidates, and the
  `fix: --add-alias` retarget suggestion all suppressed together — when the OpenRouter
  route still serves. Deliberately gateway-only entries (`gpt-pro`) are annotated in
  the curated data and never audited for a direct sibling. Kills the v4.6.2
  release-gate false positive whose suggested "fix" was a silent tier downgrade.
```
`BACKLOG.md` — amend the final 2026-08-05 release-gate rider: append after "Same family: 'fable has no direct form' divergence line.":
```markdown
  [2026-08-05 re-verification: HALF-WRONG — fable's line was a TRUE report (live
  /v1/models lists claude-fable-5; direct smoke served, wave 47278069, $0.72 — do not
  re-probe). Resolved by authoring the direct route (ruling R2); the gpt-pro half
  fixed by audit provenance. Both in v4.6.3 PR1.]
```

- [ ] **Step 2: Live validation on the REAL config (free — no probes, no --live).**
Run: `node bin/amicus.js models --check; echo "exit=$?"` (NOT piped — a pipe eats the exit code; today's baseline is exit **1**).
Expected: NO `STALE: gpt-pro` block, NO `fix:` line, NO `GATEWAY STALE (direct): gpt-pro`, NO `fable has no direct form` line; `exit=0`. (`DRIFTED:` rows for this machine's stored aliases may print — unrelated, fine.) Then `node bin/amicus.js models --check --strict; echo "exit=$?"` → also 0. ⚠️ Do NOT run `--check --live` and do NOT probe fable/gpt-pro — evidence is already banked (waves `47278069`, `d28cab32`).

- [ ] **Step 3: Full gates.**
Run: `npm test` (expect 492+ suites, 0 failures — new-test delta attributed to Tasks 1-4), `npm run lint`, `npm run check:sizes`, `npm run validate-docs`.

- [ ] **Step 4: Commit + push (≥5-min timeout).**
```bash
git add -A && git commit -m "docs: usage/CHANGELOG/BACKLOG for the audit routing-choice fix (v4.6.3 PR1)"
git push -u origin feat/v4.6.3-pr1-audit-routing-choice
```

- [ ] **Step 5: Open the PR** (`gh pr create -R BourbonDog/amicus`) with the house body shape: what ships (R2 fable route + D1/D2 provenance suppression), verification (suite counts, live --check before/after exits 1→0), deviations, riders.

## Execution notes (read before Task 1)

- **Order is load-bearing:** Task 1 before 2 (the `authored` pin asserts fable), 2 before 3/4 (they import the accessor). 3 and 4 are independent of each other.
- **Mock-factory sweep** is part of Tasks 3/4, not optional: any factory fully replacing `curated-models` in a suite whose code path now calls `directFormProvenance` must export it (`tests/utils/gateway-route-audit.test.js` certainly; `tests/utils/alias-audit.test.js` per its doMock shape; `tests/build-provider-models-local.test.js` does NOT need it — config.js never imports the accessor).
- **Do not "improve" the `covered`-set semantics** for curated-route rows (`alias-audit.js:82`) — that suppression is load-bearing and documented (`:61-64`); Task 4 only ADDS a sibling clause for `'defaults'` rows.
- **Comment-only fixture staleness** (provider-default-picker `:132`, gateway-router `:103`, gateway-route-catalog `:43` — "mirrors the real fable entry"): NOT updated in this PR; they keep passing and become historical examples. Rider for the PR body, not scope creep.
- Expected new-test delta: ~13-15 tests (5 provenance + 5 gateway + 5-6 flat-audit/shipped-defaults), minus 1 deleted (the floor not-contain guard). Attribute exactly in the PR body.
