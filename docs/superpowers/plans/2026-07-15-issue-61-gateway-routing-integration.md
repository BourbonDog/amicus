# Direct-First Gateway Routing — Integration Plan (Issue #61, Plan 2 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the Foundation router (`resolveRoute`) into every launch path so Amicus routes **direct-first with an explicit OpenRouter escape**, with a visible one-time migration for existing both-key users, a structured route error on both CLI and MCP, an evolved interactive picker, a `--gateway` control surface, and guidance that teaches bare canonical IDs.

**Architecture:** A single bridge module `route-launch.js` assembles the router's request (alias→descriptor, keys view incl. auth.json, catalog info, gateway mode) and returns a `RouteResult`. Every entry point (`start`, `fanout`, `continue`, `resume`, MCP) consumes that one result — for both launch validation and OpenCode provider-model synthesis — so the executed route can never diverge from the resolved one. This is the behavior-changing half; it depends on the settled Foundation interface merged in PR #62.

**Tech Stack:** Node.js (CommonJS), Jest 29, ESLint 8. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-15-issue-61-direct-first-gateway-routing-design.md`
**Foundation (merged, PR #62):** `provider-registry.js`, `model-descriptor.js`, `model-classification.js`, `gateway-router.js`.

## Foundation interface this plan consumes (verbatim, do not change)

- `resolveRoute(request) -> RouteResult` where
  `request = { descriptor, source, gatewayMode, allowSelection, validateModel, keys, catalogInfo }`.
  `descriptor` = a parsed Descriptor (from `parseDescriptor`) OR a resolved canonical id string; a `kind` other than `canonical`/`openrouter-literal` returns `invalid_descriptor`.
- `RouteResult` = `{kind:'resolved', model, gateway, executableId, provenance, notice?}` | `{kind:'selection_required', requested, suggestions}` | `{kind:'error', type:'model_route_error', field, requested, reason, preferredGateway, suggestions}`.
- Closed `reason` set: `gateway_conflict`, `no_openrouter_key`, `no_direct_integration`, `no_direct_key`, `no_key_for_vendor`, `model_not_found`, `invalid_descriptor`.
- `keys` shape: `{openrouter, google, openai, anthropic, deepseek}` booleans.
- `catalogInfo` shape: `{models:[{id}], lastRefreshError}` (from `model-catalog.getCatalogInfo()`).
- `provider-registry`: `isDirectProvider(id)`, `listDirectProviders()`, `getProvider(id)`, `PROVIDERS`.
- `model-descriptor`: `parseDescriptor(raw,{aliases})`, `GATEWAY_MODES`.

## Global Constraints

- **Node ≥22.12**; CommonJS; files **≤300 lines** (`npm run check:sizes`); no secrets (`npm run check:secrets`); commit per task.
- **The router's `RouteResult` is the SOLE source of the executed route.** `buildProviderModels()` and every launch path must consume the resolver output, never independently re-resolve an alias (Foundation whole-branch finding).
- **Never block a launch on an unverifiable catalog.** `unknown` verdicts route with a notice (Foundation contract). `--no-validate-model` skips only the catalog existence check, never intent/credential checks.
- **Migration is visible, never silent.** Existing users holding BOTH an OpenRouter key and a direct key are switched to direct-first, but get a one-time per-vendor notice; `routing.prefer:"openrouter"` is the documented durable opt-out. Explicit `openrouter/…` literals are honored indefinitely and never trigger a notice.
- **Structured `model_route_error` on BOTH non-interactive paths** — MCP (`input-validators`) AND piped CLI (`!process.stdin.isTTY`), sharing one suggestion shape. Interactive TTY gets the picker.
- **Guidance co-ships (Phase 8) — hard release gate.** The calling agent emits `openrouter/…` today; the feature is inert until guidance teaches bare canonical IDs. An early bare-ID e2e smoke (Task in Phase 4) proves the engine path before guidance lands.
- **Carry-forwards from Foundation (must be honored):** mark Anthropic floor-FALLBACK rows non-authoritative so a floor miss returns `unknown` not `invalid` (Task 4.3); populate `selection_required.suggestions`; stamp `provenance.resolutionVersion`; assemble the auth.json-inclusive keys view in the caller (Task 4.2), not the router.

---

## File Structure

- **Create** `src/utils/route-launch.js` — the bridge: assemble request → `resolveRoute` → `RouteResult`; plus the keys-view and gateway-mode helpers (Phase 4).
- **Create** `src/utils/route-error.js` — render a `RouteResult` error/selection into (a) a CLI stderr string and (b) an MCP structured object, from one source (Phase 6).
- **Modify** `src/utils/config.js` — `routing` config accessors; `buildProviderModels(resolvedRoutes)` consumes resolved routes; retire the `detectFallback` dispatch (Phase 4, 6).
- **Modify** `src/utils/start-helpers.js` — route via `route-launch` (Phase 4).
- **Modify** `src/utils/model-catalog.js` / `src/utils/model-fetcher.js` — tag Anthropic floor-fallback rows non-authoritative (Phase 4.3 carry-forward).
- **Modify** `src/utils/alias-resolver.js` — delete `applyDirectApiFallback`; `config.js:resolveModel` stops calling it (Phase 4).
- **Modify** `src/utils/model-validator.js` — evolve `promptModelSelection` into the alternatives picker; `warnIfNotInCatalog` becomes route-aware (Phase 6, 5).
- **Modify** `src/utils/input-validators.js` — emit `model_route_error` via `route-error.js` (Phase 6).
- **Modify** `bin/amicus.js` / `src/cli.js` — `--gateway` flag; thread to `route-launch` (Phase 7).
- **Modify** `src/utils/mcp-tools.js` (or the MCP schema module) — `gateway` enum on start/fanout/continue (Phase 7).
- **Modify** `src/fanout.js`, `src/continue.js`, `src/resume.js` — consume `route-launch`; provenance for continue/resume (Phase 5, 7).
- **Modify** guidance/docs: `skills/second-opinion/SKILL.md`, `skill/` (chat), `amicus_guide` text, MCP tool descriptions, `README.md`, `docs/usage.md` (Phase 8).
- **Rewrite** `tests/config-fallback.test.js` to the router contract (Phase 4).

> Implementer note: exact paths for `src/cli.js`/`src/fanout.js`/`src/continue.js`/`src/resume.js`/MCP-schema module must be confirmed by grep at task start (`grep -rn "resolveModelFromArgs\|validateFallbackModel\|tryResolveModel\|--no-validate-model" src bin`); the plan names the function-level touch points, which are stable.

---

## Phase 4 — Core wiring (the behavior change)

### Task 4.1: `routing` config accessors + gateway-mode resolution

**Files:** Modify `src/utils/config.js`; Test `tests/routing-config.test.js`.

**Interfaces — Produces:**
- `getRoutingConfig() -> { prefer: 'direct'|'openrouter', migration_notified: Object<string,boolean> }` (defaults `prefer:'direct'`, `migration_notified:{}`; reads `config.routing`).
- `resolveGatewayMode(perCall) -> 'auto'|'direct'|'openrouter'` — `perCall` (from `--gateway`, may be undefined/`'auto'`) wins unless undefined/`'auto'`, else `config.routing.prefer` (default `'direct'`). Maps `prefer:'direct'` → the router's `'auto'` mode (direct-first) unless the user passed an explicit per-call mode; `prefer:'openrouter'` → `'openrouter'`.

- [ ] **Step 1: Write the failing test**
```js
// tests/routing-config.test.js
const os = require('os'); const path = require('path'); const fs = require('fs');
const CFG = path.join(os.tmpdir(), `amicus-routing-${process.pid}`);
beforeEach(() => { process.env.AMICUS_CONFIG_DIR = CFG; fs.mkdirSync(CFG, { recursive: true }); });
afterEach(() => { delete process.env.AMICUS_CONFIG_DIR; fs.rmSync(CFG, { recursive: true, force: true }); });
const write = (o) => fs.writeFileSync(path.join(CFG, 'config.json'), JSON.stringify(o));

test('defaults: prefer direct, no notifications', () => {
  const { getRoutingConfig } = require('../src/utils/config');
  expect(getRoutingConfig()).toEqual({ prefer: 'direct', migration_notified: {} });
});
test('resolveGatewayMode: per-call explicit wins', () => {
  const { resolveGatewayMode } = require('../src/utils/config');
  write({ routing: { prefer: 'openrouter' } });
  expect(resolveGatewayMode('direct')).toBe('direct');
});
test('resolveGatewayMode: prefer direct -> auto (direct-first) when no per-call', () => {
  const { resolveGatewayMode } = require('../src/utils/config');
  write({ routing: { prefer: 'direct' } });
  expect(resolveGatewayMode(undefined)).toBe('auto');
});
test('resolveGatewayMode: prefer openrouter -> openrouter when no per-call', () => {
  const { resolveGatewayMode } = require('../src/utils/config');
  write({ routing: { prefer: 'openrouter' } });
  expect(resolveGatewayMode('auto')).toBe('openrouter');
});
```

- [ ] **Step 2: Run — expect FAIL** (`getRoutingConfig` not exported).

- [ ] **Step 3: Implement in `config.js`** (add near the other accessors; export both):
```js
/** @returns {{prefer:'direct'|'openrouter', migration_notified:Object}} routing config with defaults */
function getRoutingConfig() {
  const config = loadConfig() || {};
  const r = (config.routing && typeof config.routing === 'object') ? config.routing : {};
  const prefer = r.prefer === 'openrouter' ? 'openrouter' : 'direct';
  const migration_notified = (r.migration_notified && typeof r.migration_notified === 'object') ? r.migration_notified : {};
  return { prefer, migration_notified };
}

/** Merge --gateway (perCall) with routing.prefer into a router gatewayMode.
 * @param {string|undefined} perCall 'auto'|'direct'|'openrouter'|undefined
 * @returns {'auto'|'direct'|'openrouter'} */
function resolveGatewayMode(perCall) {
  if (perCall && perCall !== 'auto') { return perCall; }
  const { prefer } = getRoutingConfig();
  return prefer === 'openrouter' ? 'openrouter' : 'auto';
}
```

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** `feat(#61): routing.prefer config + gateway-mode resolution`.

### Task 4.2: Launch keys view (incl. auth.json) + catalog info assembler

**Files:** Create `src/utils/route-launch.js`; Test `tests/route-launch-keys.test.js`.

**Interfaces — Produces (this task adds the first two; Task 4.4 adds `resolveRouteForLaunch`):**
- `buildLaunchKeys() -> {openrouter,google,openai,anthropic,deepseek}` booleans — true if a key exists in ANY source: `readApiKeys()` (env + `.env`) OR `readAuthJsonKeys()` (auth.json). Closes Foundation carry-forward (Decision 5).
- `getRouteCatalogInfo() -> Promise<{models, lastRefreshError}>` — thin wrapper over `model-catalog.getCatalogInfo()`.

- [ ] **Step 1: Write the failing test** — stub `api-key-store.readApiKeys` and `auth-json.readAuthJsonKeys`, assert the union (a vendor present only in auth.json → true; none anywhere → false). (Use `jest.doMock` + `jest.resetModules`, matching the model-fetcher test pattern.)
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement**
```js
'use strict';
const { readApiKeys } = require('./api-key-store');
const { readAuthJsonKeys } = require('./auth-json');
const { KNOWN_PROVIDERS } = require('./provider-registry');

/** @returns {Object<string,boolean>} per-provider key presence across env/.env AND auth.json */
function buildLaunchKeys() {
  const env = readApiKeys();                 // {openrouter:bool,...}
  const authKeys = readAuthJsonKeys();       // {provider:string,...} (only providers with keys)
  const out = {};
  for (const p of KNOWN_PROVIDERS) { out[p] = !!env[p] || !!authKeys[p]; }
  return out;
}

/** @returns {Promise<{models:Array, lastRefreshError:string|null}>} */
async function getRouteCatalogInfo() {
  const { getCatalogInfo } = require('./model-catalog');
  try { const info = await getCatalogInfo(); return { models: info.models || [], lastRefreshError: info.lastRefreshError || null }; }
  catch { return { models: [], lastRefreshError: 'catalog-unavailable' }; }
}
module.exports = { buildLaunchKeys, getRouteCatalogInfo };
```
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** `feat(#61): launch keys view (env/.env/auth.json union) + catalog info`.

### Task 4.3: Mark Anthropic floor-fallback rows non-authoritative (carry-forward)

**Files:** Modify `src/utils/model-fetcher.js` (flag floor rows) + `src/utils/model-classification.js` (honor the flag); Test extend `tests/model-classification.test.js`.

**Rationale:** Foundation left a narrow window where a keyed Anthropic user whose live fetch failed (fell back to the floor) gets a false `invalid`. Tag floor-fallback rows so classification returns `unknown` for an Anthropic miss when the rows are non-authoritative.

**Interfaces:**
- `model-fetcher.fetchModelsFromProvider('anthropic', key)`: when the result is the hardcoded floor fallback (no key, OR live fetch failed), each row carries `authoritative:false`; live-fetched rows omit it (authoritative by default).
- `model-classification.classifyModel(id, gateway, catalogInfo)`: if the matched namespace rows are ALL `authoritative:false` and the exact id is absent → `unknown` (not `invalid`).

- [ ] **Step 1: Write the failing test** — floor-only anthropic rows (`authoritative:false`) + query a newer anthropic id → `unknown`; a live anthropic row (no flag) + miss → `invalid`.
- [ ] **Step 2: Run — expect FAIL** (current pins `invalid`; update that pinned case to the new contract, keeping the composition test from Foundation).
- [ ] **Step 3: Implement** — in `model-fetcher.js`, map `ANTHROPIC_MODELS` fallback returns through `rows.map(r => ({...r, authoritative:false}))` at the two fallback sites; in `classifyModel`, after computing `namespaceRows`, if none are authoritative and no exact match → return `unknown`.
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** `fix(#61): floor-fallback rows non-authoritative -> unknown on miss`.

### Task 4.4: `resolveRouteForLaunch` bridge

**Files:** Modify `src/utils/route-launch.js`; Test `tests/route-launch.test.js`.

**Interfaces — Produces:**
- `async resolveRouteForLaunch({ model, gatewayMode, source, allowSelection, validateModel }) -> RouteResult`
  - Resolve the raw `model` to a descriptor: if it is a known alias (in `getEffectiveAliases()`), resolve to its concrete id first, then `parseDescriptor` that id; else `parseDescriptor(model, {aliases})` directly. This preserves alias support while feeding the router a `canonical`/`openrouter-literal` descriptor.
  - Assemble `keys = buildLaunchKeys()`, `catalogInfo = await getRouteCatalogInfo()`.
  - Call `resolveRoute({ descriptor, source, gatewayMode, allowSelection, validateModel, keys, catalogInfo })`.
  - Stamp `provenance.resolutionVersion = ROUTE_VERSION` (a module const, e.g. `1`) onto a `resolved` result before returning (carry-forward).

- [ ] **Step 1: Write the failing test** — table over {alias→openrouter literal value, bare canonical, gateway-only vendor} × {keys} × {gatewayMode} asserting `kind`/`gateway`/`executableId`; assert `resolved.provenance.resolutionVersion === 1`. Inject config/keys/catalog via `jest.doMock`.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** (append to `route-launch.js`):
```js
const ROUTE_VERSION = 1;
async function resolveRouteForLaunch({ model, gatewayMode, source, allowSelection, validateModel }) {
  const { getEffectiveAliases } = require('./config');
  const { parseDescriptor } = require('./model-descriptor');
  const { resolveRoute } = require('./gateway-router');
  const aliases = getEffectiveAliases();
  const concrete = (typeof model === 'string' && !model.includes('/') && aliases[model]) ? aliases[model] : model;
  const descriptor = parseDescriptor(concrete, { aliases });
  const keys = buildLaunchKeys();
  const catalogInfo = await getRouteCatalogInfo();
  const result = resolveRoute({ descriptor, source, gatewayMode, allowSelection, validateModel, keys, catalogInfo });
  if (result.kind === 'resolved') { result.provenance = { ...result.provenance, resolutionVersion: ROUTE_VERSION }; }
  return result;
}
module.exports = { buildLaunchKeys, getRouteCatalogInfo, resolveRouteForLaunch, ROUTE_VERSION };
```
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** `feat(#61): resolveRouteForLaunch bridge (alias->descriptor->router)`.

### Task 4.5: Wire `start-helpers` through the router

**Files:** Modify `src/utils/start-helpers.js`; Test `tests/start-helpers-routing.test.js` (+ update existing start-helpers tests).

**Change:** replace the `resolveModel` + `detectFallback` + `validateDirectModel`/`validateAgainstCatalog` logic with a single `resolveRouteForLaunch` call. `resolveModelFromArgs`/`validateFallbackModel` collapse into one async `resolveLaunchModel(args)` that:
- computes `gatewayMode = resolveGatewayMode(args.gateway)`, `validateModel = !args['no-validate-model']`, `allowSelection = !args['no-ui'] && process.stdin.isTTY`, `source = 'cli'`;
- calls `resolveRouteForLaunch({ model: args.model, gatewayMode, source, allowSelection, validateModel })`;
- `resolved` → return `{ model: result.executableId, gateway: result.gateway, notice: result.notice, provenance: result.provenance }` (print `notice` to stderr if present);
- `selection_required` → hand to the picker (Task 6.1) when interactive; otherwise render the structured error (Task 6.2) and `process.exit(1)`;
- `error` → render structured error (Task 6.2) to stderr and `process.exit(1)`.

- [ ] Steps: write failing test asserting each RouteResult branch maps to the right outcome (mock `resolveRouteForLaunch`); implement; keep `bin/amicus.js` call site working (it now awaits one function); run full suite; commit `feat(#61): route start launches through resolveRouteForLaunch`.

### Task 4.6: `buildProviderModels` consumes resolved routes

**Files:** Modify `src/utils/config.js` (+ the `opencode-client.js:~477` consumer if its call signature changes); Test update `tests` covering `buildProviderModels`.

**Change:** `buildProviderModels(resolvedRoutes)` accepts the list of executable ids actually resolved for this launch/wave (from the router) and synthesizes `provider.models` from THOSE, not from `getEffectiveAliases()`. Preserve a zero-arg fallback (current alias-derived behavior) only for callers not yet migrated, but the launch path must pass resolved ids. Add a test: a launch that resolves `openai/gpt-5.5` direct produces `{ openai: { models: { 'gpt-5.5': {} } } }`, NOT an `openrouter` entry.

- [ ] Steps: failing test → implement (accept optional `resolvedRoutes` arg; when provided, iterate it; else current behavior) → update the `opencode-client.js` caller to pass the launch's resolved id(s) → full suite → commit `feat(#61): buildProviderModels consumes resolved routes (sole input)`.

### Task 4.7: Retire `applyDirectApiFallback` + rewrite `config-fallback.test.js`

**Files:** Modify `src/utils/alias-resolver.js` (delete `applyDirectApiFallback`; keep `autoRepairAlias`, dropping its `applyDirectApiFallback` call — return the repaired model verbatim), `src/utils/config.js` (`resolveModel` stops calling it — returns the alias's concrete id verbatim; routing now owns gateway policy), `src/utils/model-validator.js` (`detectFallback` dispatch removed if unused); Rewrite `tests/config-fallback.test.js`.

**Change:** the old "strip `openrouter/` when a direct key exists but no OR key" heuristic is superseded by the router. `resolveModel` returns the alias's stored id unchanged; the router decides direct vs OpenRouter. Rewrite `config-fallback.test.js` to assert the NEW contract: `resolveModel` no longer mutates the id; routing decisions are covered by `gateway-router`/`route-launch` tests. Remove the locked ":86 persisted OR key blocks stripping" assertion (obsolete).

- [ ] Steps: rewrite the test to the new contract first (it will fail against old code that still strips) → delete `applyDirectApiFallback` + its call sites → run full suite → `grep -rn "applyDirectApiFallback\|detectFallback" src` returns only intended removals → commit `refactor(#61): retire applyDirectApiFallback; router owns gateway policy`.

### Task 4.8: Early bare-canonical-ID e2e smoke (prove the engine before guidance)

**Files:** Test `tests/gateway-routing-e2e.integration.test.js` (integration; excluded from default gate, run via `test:integration`).

**Change:** a child-process test that runs `bin/amicus.js` with a bare canonical id and `--no-ui --no-validate-model` against a stubbed/echo model path (or asserts the resolved provider wiring via a dry-run flag if one exists), proving a bare `openai/…` id routes direct end-to-end without guidance. If a real key isn't present, gate the live leg behind a key check and assert the pre-flight routing decision instead (no network).

- [ ] Steps: write the integration test → run `npm run test:integration` → commit `test(#61): bare-canonical-id routing e2e smoke`.

---

## Phase 5 — Migration notice + session provenance

### Task 5.1: One-time per-vendor migration notice

**Files:** Modify `src/utils/route-launch.js` (or a small `src/utils/routing-notice.js`) + `src/utils/config.js` (persist `routing.migration_notified.<vendor>`); Test `tests/routing-notice.test.js`.

**Change:** when a `resolved` result routes a bare-canonical (non-explicit-literal) model to `direct` for a vendor, AND the user also holds an OpenRouter key (`keys.openrouter`), AND `routing.migration_notified[vendor]` is falsy → attach a one-time `notice` ("Routing <vendor> via direct (was OpenRouter). Set routing.prefer:\"openrouter\" to restore.") and persist `migration_notified[vendor]=true`. Explicit `openrouter/…` literals and `--gateway`-forced routes never notify. Record the resolved gateway in provenance (already present).

- [ ] Steps: failing test (both-keys user, first direct route → notice + flag persisted; second route → silent; explicit literal → never) → implement → full suite → commit `feat(#61): one-time per-vendor direct-migration notice`.

### Task 5.2: continue/resume route provenance

**Files:** Modify `src/continue.js`, `src/resume.js`, and the session metadata writer; `src/utils/model-validator.js` `warnIfNotInCatalog` → route-aware; Test the continue/resume paths.

**Change:** persist `{requested, gateway, executableId, gatewayMode, resolutionVersion}` in session metadata at launch. On `continue`/`resume`, prefer the persisted resolved route for the SAME model rather than re-resolving under current policy; only a newly-requested model routes fresh. Replace the advisory `warnIfNotInCatalog` with a route-aware advisory that uses `resolveRouteForLaunch({validateModel:true, allowSelection:false})` and warns (never throws) on `error`/`selection_required`.

- [ ] Steps: failing tests (resume preserves prior gateway after a key/policy change; new model routes fresh) → implement → full suite → commit `feat(#61): persist + preserve route provenance for continue/resume`.

---

## Phase 6 — Structured error + interactive picker (shared shape)

### Task 6.1: `route-error.js` — one renderer, two surfaces

**Files:** Create `src/utils/route-error.js`; Test `tests/route-error.test.js`.

**Interfaces — Produces:**
- `toStructuredError(result) -> {type:'model_route_error', field, requested, reason, preferredGateway, suggestions}` (pass-through/normalize of the router's error; also derive from `selection_required`).
- `toCliMessage(result) -> string` — human stderr text: the reason mapped to a clear sentence + suggestions + the relevant fix hint (e.g. `no_direct_key` → "No <vendor> key; add one with `amicus key <vendor> <key>` or use `--gateway openrouter`.").
- A `REASON_TEXT` map covering all 7 reasons.

- [ ] Steps: failing test (each reason → stable structured shape + non-empty CLI text) → implement → commit `feat(#61): shared route-error renderer (CLI + MCP)`.

### Task 6.2: CLI non-TTY structured error + wire MCP

**Files:** Modify `src/utils/start-helpers.js` (non-TTY → print `JSON.stringify(toStructuredError(result))` when `--json`, else `toCliMessage`, then exit 1); Modify `src/utils/input-validators.js` `validateStartInputs` (return `{valid:false, error: toStructuredError(routeResult)}` when routing fails) — but route resolution there must call `resolveRouteForLaunch({source:'mcp', allowSelection:false, validateModel:true})`; Tests update.

- [ ] Steps: failing tests (piped CLI with `--json` emits `model_route_error` JSON; MCP start with an unroutable model returns the structured error) → implement → full suite → commit `feat(#61): model_route_error on both CLI(!isTTY) and MCP`.

### Task 6.3: Evolve `promptModelSelection` into the alternatives picker

**Files:** Modify `src/utils/model-validator.js`; Test `tests/model-picker.test.js`.

**Change:** on `selection_required` (interactive), present labeled alternatives derived from `result.suggestions` + the catalog: (1) same model via OpenRouter (if OR key), (2) a different same-provider model, (3) a model from another keyed provider, (4) cancel. Each labeled by route/provider/material difference; never auto-select. Selecting persists the alias as today. Populate `suggestions` upstream (Foundation carry-forward) — extend `resolveRoute`'s `selection_required` construction OR build suggestions in `route-launch` before invoking the picker.

- [ ] Steps: failing test (stub stdin; a selection_required with suggestions → labeled menu → selection persists + returns the chosen executable id; empty input cancels) → implement → full suite → commit `feat(#61): alternatives picker for direct misses`.

---

## Phase 7 — Control surface (`--gateway`)

### Task 7.1: CLI `--gateway auto|direct|openrouter`

**Files:** Modify `bin/amicus.js` / the arg parser + `src/cli.js` help; Test the parser.

**Change:** accept `--gateway <mode>` (validate against `GATEWAY_MODES`), pass `args.gateway` into `resolveGatewayMode`. Reject an invalid value with a clear pre-flight error. Document in `--help`.

- [ ] Steps: failing test → implement → commit `feat(#61): --gateway CLI flag`.

### Task 7.2: MCP `gateway` enum on start/fanout/continue

**Files:** Modify the MCP tool schema module (Zod schemas) + handlers to thread `gateway` into `resolveRouteForLaunch`; Test the MCP handlers.

- [ ] Steps: failing test → implement → commit `feat(#61): MCP gateway enum on start/fanout/continue`.

### Task 7.3: Wire `fanout`/`continue`/`resume` through `route-launch`

**Files:** Modify `src/fanout.js`, `src/continue.js`, `src/resume.js`; Tests update.

**Change:** each leg/entry resolves via `resolveRouteForLaunch` with its `gatewayMode`, feeding `buildProviderModels` the resolved ids. Fanout resolves per leg (each model independently); a leg that returns `error`/`selection_required` (non-interactive) fails that leg with the structured error, not the whole wave.

- [ ] Steps: failing tests → implement → full suite → commit `feat(#61): route fanout/continue/resume through the router`.

---

## Phase 8 — Guidance + docs (hard release gate)

### Task 8.1: Teach bare canonical IDs across all guidance

**Files:** Modify `skills/second-opinion/SKILL.md`, the chat skill (`skill/…`), the `amicus_guide` MCP text, MCP tool descriptions, `README.md`, `docs/usage.md`, and the curated route-map defaults if they encode `openrouter/…` where a bare id is now canonical.

**Change:** update every place that models `openrouter/openai/…` as the normal form to teach bare `provider/model` (canonical, policy-routed) + document `openrouter/…` as the explicit force-OR escape, `routing.prefer`, `--gateway`, and the migration notice. This is the load-bearing enabler — the calling agent emits `openrouter/…` today; the feature only activates once guidance changes.

- [ ] Steps: edit docs; run `npm run generate-docs:check` / `npm run validate-docs` if present; grep for residual `openrouter/openai` normal-form examples; commit `docs(#61): teach bare canonical IDs + gateway routing`.

### Task 8.2: Changelog + version + drift-pinned examples

**Files:** `CHANGELOG.md`, `package.json` version (minor bump — new feature, no breaking removal for end-users beyond the visible migration), any `status --json` version-pinned doc examples (the release-checklist gotcha).

- [ ] Steps: update → run the full suite + `npm run validate-docs` → commit `chore(#61): changelog + version bump for gateway routing`.

---

## Testing Strategy

- **Bridge matrix** (`route-launch.test.js`): alias / bare / literal / gateway-only × key combos × gatewayMode → correct RouteResult (mirrors the Foundation router matrix at the launch layer, incl. the auth.json-only key case).
- **Engine wiring** (integration): resolved route == `buildProviderModels` output, across family (`fallback`), cardless (`routes`), and OpenRouter-only families.
- **Error parity**: piped CLI `--json` and MCP both emit identical `model_route_error` shapes for the same input.
- **Migration**: both-keys user → one notice per vendor then silent; `routing.prefer:openrouter` restores; explicit literal never notifies.
- **Provenance**: resume/continue preserve the original gateway after a key/policy change.
- **Guidance**: grep guards that no shipped guidance models `openrouter/openai/…` as the normal form post-Phase-8.
- Rewrite `config-fallback.test.js` to the router contract (Task 4.7).

## Global Self-Review Notes

- **Spec coverage:** Decision 2/3 (modes, four checks) already in Foundation router; this plan wires them (4.5) + control surface (7). Decision 4 tri-state consumed via catalog gate + 4.3 floor-authority fix. Decision 5 registry/auth.json keys → 4.2. Decision 6 API → consumed by the bridge (4.4). Decision 7 migration → 5.1. Decision 8 provenance → 4.4/5.2. Decision 9 error surfaces → 6.1/6.2. Decision 10 picker → 6.3. Guidance load-bearing → 8.
- **Type consistency:** `RouteResult.kind`/`reason` strings match Foundation verbatim; `resolveGatewayMode` output ∈ `GATEWAY_MODES`; `buildLaunchKeys` shape matches the router's `keys`.
- **Sole-input invariant** enforced at 4.6 + 7.3 (buildProviderModels fed resolved ids everywhere).
- **Non-negotiable co-ship:** Phase 8 guidance ships in the SAME release as Phase 4 (feature is inert otherwise); Task 4.8 smoke proves the engine before guidance.
