# Gateway-Correct Model IDs — Implementation Plan (Part 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make model aliases carry per-gateway executable IDs so `--model opus` / `haiku` / `claude` / `sonnet` / `fable` route correctly for **direct-Anthropic-key users** (dashes/dates on the direct API, dots on OpenRouter), fixing a live bug in v3.1.0.

**Architecture:** An alias resolves to a **GatewayRoutes** object `{ direct?, openrouter }` (concrete executable IDs per gateway, absence = not available there). The bridge threads these into the router; the router emits the chosen gateway's ID and won't pick a gateway a model isn't on. IDs are curated + `amicus models --check`-audited against the live catalog (Part 2 fills user aliases at key-add). No dot↔dash transforms — each namespace's native IDs are used verbatim.

**Tech Stack:** Node.js (CommonJS), Jest 29, ESLint 8. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-16-gateway-correct-model-ids-design.md`

## Global Constraints

- **Node ≥22.12**; CommonJS; files **≤300 lines** (`npm run check:sizes`); no secrets; `npm test` (the canonical gate, excludes `*.integration.test.js`) green at 0 failures after every task.
- **Zero behavior change for non-divergent inputs:** OpenAI/Google/DeepSeek aliases and full-ID inputs (`--model anthropic/claude-opus-4-8`, `--model openrouter/anthropic/claude-opus-4.8`) resolve exactly as today. The `{direct, openrouter}` pair for a non-divergent model is just the same id with/without the `openrouter/` prefix.
- **Preserve every #61 router contract:** tri-state catalog (`unknown` never blocks), `--gateway`/`routing.prefer`, migration notice, the closed `reason` set (extend, don't repurpose), `resolveRoute` stays a pure function.
- **Never invent an ID.** If a gateway form is unknown/unpaired, omit it and route to the gateway that has one — do not synthesize.
- **Catalog is the source; no format transforms.** IDs come from the catalog namespaces or the curated map verbatim; never programmatically convert `4.8`↔`4-8`.

## Current-state anchors (verified)

- `gateway-router.js`: `finish(gateway, vendor, model, req)` builds `executableId` via `executableFor(gateway,vendor,model)` (`openrouter/${vendor}/${model}` or `${vendor}/${model}`); `catalogGate({id,gateway,req})` classifies `id` against `req.catalogInfo`; branch 7 `auto` = `keys[vendor]→direct; keys.openrouter→OR; else no_key_for_vendor`.
- `curated-models.js`: `FAMILIES` (opus has `fallback:{ openrouter:'openrouter/anthropic/claude-opus-4.8', anthropic:'anthropic/claude-opus-4-6' }` — the direct form exists but is **stale** and ignored); `CARDLESS` (claude/sonnet/haiku→`openrouter/…` dots only; `fable`→`openrouter/anthropic/claude-fable-5`); `toCanonicalDefault(route)` strips `openrouter/` for direct-capable vendors; `toDefaultAliases()` runs the OR route through `toCanonicalDefault` → the **dot** bare id (the bug).
- `route-launch.js`: `resolveRouteForLaunch({model,…})` resolves a no-slash alias via `getEffectiveAliases()`, `parseDescriptor`s it, assembles `keys`/`catalogInfo`, calls `resolveRoute`, stamps `resolutionVersion`, runs `maybeMigrationNotice`/`buildSuggestions`.
- Live catalog (2026-07-16): direct `anthropic/claude-opus-4-8`, `anthropic/claude-sonnet-5`, `anthropic/claude-haiku-4-5-20251001`; OR `openrouter/anthropic/claude-opus-4.8`, `openrouter/anthropic/claude-sonnet-5`, `openrouter/anthropic/claude-haiku-4.5`, `openrouter/anthropic/claude-fable-5` (fable **not** in the direct list).

---

## File Structure

- **Modify** `src/utils/curated-models.js` — add `toGatewayRoutes()` returning `{alias: {direct?, openrouter}}`; refresh the Anthropic ids to current (Task 1).
- **Modify** `src/utils/gateway-router.js` — `finish`/branches honor `req.gatewayIds` + availability (Task 2).
- **Modify** `src/utils/route-error.js` — add the two availability reasons (Task 2).
- **Modify** `src/utils/route-launch.js` — build `gatewayIds` for aliases and thread them into `resolveRoute` (Task 3).
- **Modify** `src/utils/model-fetcher.js` — refresh the `ANTHROPIC_MODELS` offline floor (Task 4).
- **Create** `src/utils/gateway-route-catalog.js` — pure helper pairing a model across catalog namespaces, used by `--check` (Task 5).
- **Modify** the `models --check` audit path + add a CI step (Task 6).
- **Create** `tests/gateway-correct-ids.integration.test.js` — hermetic e2e (Task 7).

---

### Task 1: Per-gateway route map in curated-models

**Files:** Modify `src/utils/curated-models.js`; Test `tests/curated-models-gateway-routes.test.js`.

**Interfaces — Produces:** `toGatewayRoutes() -> { [alias]: { direct?: string, openrouter: string } }`.
- For a direct-capable vendor whose direct & OR ids are identical (openai/google/deepseek): `direct = '<vendor>/<model>'`, `openrouter = 'openrouter/<vendor>/<model>'` (derive both from the OR route via `toCanonicalDefault` for direct, keep the raw OR route).
- For Anthropic (divergent): both forms come from an explicit `directRoute` on the entry (authored, current); `openrouter` = the OR route.
- For gateway-only vendors (grok/qwen/…): only `openrouter`.
- When an entry has no direct availability (fable today): omit `direct`.

- [ ] **Step 1: Write the failing test**
```js
// tests/curated-models-gateway-routes.test.js
const { toGatewayRoutes } = require('../src/utils/curated-models');
const r = toGatewayRoutes();

test('Anthropic divergent aliases carry BOTH gateway-native ids', () => {
  expect(r.opus).toEqual({ direct: 'anthropic/claude-opus-4-8', openrouter: 'openrouter/anthropic/claude-opus-4.8' });
  expect(r.haiku).toEqual({ direct: 'anthropic/claude-haiku-4-5-20251001', openrouter: 'openrouter/anthropic/claude-haiku-4.5' });
});
test('non-divergent Anthropic (sonnet-5) has matching forms', () => {
  expect(r.sonnet).toEqual({ direct: 'anthropic/claude-sonnet-5', openrouter: 'openrouter/anthropic/claude-sonnet-5' });
});
test('fable is OpenRouter-only today (no direct form)', () => {
  expect(r.fable).toEqual({ openrouter: 'openrouter/anthropic/claude-fable-5' });
  expect(r.fable.direct).toBeUndefined();
});
test('direct-capable non-divergent vendor derives both forms', () => {
  expect(r.gpt).toEqual({ direct: 'openai/gpt-5.5', openrouter: 'openrouter/openai/gpt-5.5' });
});
test('gateway-only vendor is openrouter-only', () => {
  expect(r.grok).toEqual({ openrouter: 'openrouter/x-ai/grok-4.3' });
});
```

- [ ] **Step 2: Run — expect FAIL** (`toGatewayRoutes` undefined).

- [ ] **Step 3: Implement.** Reuse the existing **vendor-keyed direct-form convention** (`fallback.anthropic`, `routes.anthropic`, etc. — the same key `listCuratedRoutes` already flattens). Refresh the stale values and add the missing Anthropic direct forms; do NOT invent a new `directRoute` field:
```js
// FAMILIES.opus.fallback : openrouter 'openrouter/anthropic/claude-opus-4.8' (current),
//                          anthropic  'anthropic/claude-opus-4-8'  (was claude-opus-4-6 — REFRESH)
// CARDLESS claude/sonnet  : openrouter 'openrouter/anthropic/claude-sonnet-5' (was …-sonnet-4.6 — REFRESH),
//                          ADD anthropic 'anthropic/claude-sonnet-5'
// CARDLESS haiku          : openrouter 'openrouter/anthropic/claude-haiku-4.5' (current),
//                          ADD anthropic 'anthropic/claude-haiku-4-5-20251001'
// CARDLESS fable          : openrouter 'openrouter/anthropic/claude-fable-5' (current); NO anthropic key — OR-only today

// Vendors whose direct-API ids differ from OpenRouter's; NEVER derive a direct form for these —
// derivation would emit the dot-id (wrong) or invent a direct id for an OR-only model (fable).
const DIVERGENT_VENDORS = new Set(['anthropic']);

function directFormFor(vendorPath, obj) {          // obj = a family.fallback or cardless.routes map
  if (obj[vendorPath]) { return obj[vendorPath]; }          // explicit, authored, current direct id
  if (DIVERGENT_VENDORS.has(vendorPath)) { return undefined; } // no explicit form + divergent → omit (e.g. fable)
  const bare = toCanonicalDefault(obj.openrouter);          // safe only when ids are identical across gateways
  return bare !== obj.openrouter ? bare : undefined;        // gateway-only vendor → undefined
}
function gatewayRoutesFor(vendorPath, obj) {
  const routes = { openrouter: obj.openrouter };
  const direct = directFormFor(vendorPath, obj);
  if (direct) { routes.direct = direct; }
  return routes;
}
function toGatewayRoutes() {
  const out = {};
  for (const f of FAMILIES) { out[f.alias] = gatewayRoutesFor(f.vendorPath, f.fallback); }
  for (const e of CARDLESS) { out[e.alias] = gatewayRoutesFor(vendorOf(e.routes.openrouter), e.routes); }
  return out;
}
// vendorOf('openrouter/anthropic/claude-…') -> 'anthropic' (the segment after 'openrouter/')
```
Leave `toDefaultAliases()` and `toCanonicalDefault()` **logic unchanged** — the single-string defaults still drive display/`config.default`; the gatewayIds (Task 3) drive routing. Only the sonnet/claude default *values* shift (4.6→5) as a consequence of the OR-pin refresh. Add `toGatewayRoutes` to `module.exports`.

- [ ] **Step 4: Run — expect PASS.** Then `npm test`; update ONLY the sonnet/claude assertions in `tests/curated-models.test.js` (`defaults.claude`/`defaults.sonnet` → `anthropic/claude-sonnet-5`) — opus/haiku/others are unchanged there. Do NOT weaken; pin the new correct values.

- [ ] **Step 5: Commit** `feat(#gwid): curated per-gateway route map + refreshed Anthropic ids`.

---

### Task 2: Router honors per-gateway ids + availability

**Files:** Modify `src/utils/gateway-router.js`, `src/utils/route-error.js`; Test extend `tests/gateway-router.test.js`, `tests/route-error.test.js`.

**Interfaces — the request gains an optional field:** `req.gatewayIds?: { direct?: string, openrouter?: string }` (full executable ids). When absent, behavior is exactly today's (back-compat).

- [ ] **Step 1: Write the failing test** (add to `tests/gateway-router.test.js`):
```js
const GW = { direct: 'anthropic/claude-opus-4-8', openrouter: 'openrouter/anthropic/claude-opus-4.8' };
function req(raw, over={}) { /* reuse the file's existing helper; add gatewayIds via over */ }

test('direct route emits the direct-native id (dashes), not the descriptor dots', () => {
  const r = resolveRoute(req('anthropic/claude-opus-4.8', {
    gatewayIds: GW, keys: { ...NO_KEYS, anthropic: true }, catalogInfo: cat(['anthropic/claude-opus-4-8']) }));
  expect(r).toMatchObject({ kind: 'resolved', gateway: 'direct', executableId: 'anthropic/claude-opus-4-8' });
});
test('OR fallback emits the OR-native id (dots)', () => {
  const r = resolveRoute(req('anthropic/claude-opus-4.8', {
    gatewayIds: GW, keys: { ...NO_KEYS, openrouter: true }, catalogInfo: cat(['openrouter/anthropic/claude-opus-4.8']) }));
  expect(r).toMatchObject({ kind: 'resolved', gateway: 'openrouter', executableId: 'openrouter/anthropic/claude-opus-4.8' });
});
test('auto + direct key but model NOT on direct (fable) falls back to OR', () => {
  const r = resolveRoute(req('anthropic/claude-fable-5', {
    gatewayIds: { openrouter: 'openrouter/anthropic/claude-fable-5' }, // no direct form
    keys: { ...NO_KEYS, anthropic: true, openrouter: true },
    catalogInfo: cat(['openrouter/anthropic/claude-fable-5']) }));
  expect(r).toMatchObject({ kind: 'resolved', gateway: 'openrouter', executableId: 'openrouter/anthropic/claude-fable-5' });
});
test('--gateway direct for a direct-unavailable model errors', () => {
  const r = resolveRoute(req('anthropic/claude-fable-5', { gatewayMode: 'direct',
    gatewayIds: { openrouter: 'openrouter/anthropic/claude-fable-5' }, keys: { ...NO_KEYS, anthropic: true } }));
  expect(r).toMatchObject({ kind: 'error', reason: 'direct_unavailable' });
});
test('no gatewayIds → unchanged behavior (executableFor construction)', () => {
  const r = resolveRoute(req('openai/gpt-5.5', { keys: { ...NO_KEYS, openai: true }, catalogInfo: cat(['openai/gpt-5.5']) }));
  expect(r).toMatchObject({ kind: 'resolved', gateway: 'direct', executableId: 'openai/gpt-5.5' });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement.** In `gateway-router.js`:
```js
function hasForm(req, gateway) { return !req.gatewayIds || req.gatewayIds[gateway] !== undefined; }

function finish(gateway, vendor, model, req) {
  const id = (req.gatewayIds && req.gatewayIds[gateway]) || executableFor(gateway, vendor, model);
  const gate = catalogGate({ id, gateway, req });
  if (!gate.ok) { return gate.result; }
  return resolved({ model: id, gateway, executableId: id,
    provenance: { source: req.source, requested: req.descriptor.raw, gatewayMode: req.gatewayMode }, notice: gate.notice });
}
```
Add availability guards to the divergent branches (branches 5/6/7 for direct-capable vendors):
- Branch 5 (`--gateway openrouter`): after the OR-key check, `if (!hasForm(rq,'openrouter')) return routeError({ requested:d.raw, reason:'openrouter_unavailable', preferredGateway:'openrouter', suggestions:[] });`
- Branch 6 (`--gateway direct`): after the direct-key check, `if (!hasForm(rq,'direct')) return routeError({ requested:d.raw, reason:'direct_unavailable', preferredGateway:'direct', suggestions:[] });`
- Branch 7 (`auto`): 
```js
if (rq.keys[vendor] && hasForm(rq,'direct')) { return finish('direct', vendor, model, rq); }
if (rq.keys.openrouter && hasForm(rq,'openrouter')) { return finish('openrouter', vendor, model, rq); }
return routeError({ requested: d.raw, reason: 'no_key_for_vendor', preferredGateway: 'direct', suggestions: [] });
```
(Branches 1–4 unchanged: explicit OR literal + gateway-only vendors don't use gatewayIds.)

In `route-error.js` `REASON_TEXT` + `FIX_HINTS`, add `direct_unavailable` ("This model isn't available on the vendor's direct API; use OpenRouter or a different model.") and `openrouter_unavailable` ("This model isn't on OpenRouter; use --gateway direct or a different model.").

- [ ] **Step 4: Run — expect PASS.** Then `npm test`.
- [ ] **Step 5: Commit** `feat(#gwid): router emits per-gateway ids + availability-aware routing`.

---

### Task 3: Bridge threads gatewayIds for aliases

**Files:** Modify `src/utils/route-launch.js`; Test extend `tests/route-launch.test.js`.

**Change:** In `resolveRouteForLaunch`, when the input `model` is a known alias, look up its `toGatewayRoutes()[alias]` and pass `gatewayIds` into `resolveRoute`. Parse the descriptor from the **direct** form when present (else the OR form) so the routing decision (vendor) is correct. A full-ID or non-alias input passes no `gatewayIds` (unchanged).

- [ ] **Step 1: Write the failing test** — `resolveRouteForLaunch({ model:'opus', gatewayMode:'auto', validateModel:true, … })` with an anthropic key + a catalog containing `anthropic/claude-opus-4-8` resolves `{ kind:'resolved', gateway:'direct', executableId:'anthropic/claude-opus-4-8' }`; the OR-only-key variant → `openrouter/anthropic/claude-opus-4.8`. (Mock config/keys/catalog via the file's existing doMock pattern.)
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement:**
```js
const { getEffectiveAliases, ... } = require('./config');
const { toGatewayRoutes } = require('./curated-models');
// inside resolveRouteForLaunch, after computing `concrete`/`descriptor`:
let gatewayIds;
if (typeof model === 'string' && !model.includes('/') && aliases[model]) {
  const routes = toGatewayRoutes()[model];         // curated defaults; user-config aliases handled in Part 2
  if (routes) { gatewayIds = routes; }
}
const result = resolveRoute({ descriptor, source, gatewayMode, allowSelection, validateModel, keys, catalogInfo, gatewayIds });
```
Parse the descriptor from `routes.direct || routes.openrouter` (falls back to the alias's `concrete` value) so `vendor` is right. Everything else (resolutionVersion, migration notice, suggestions) is unchanged.

- [ ] **Step 4: Run — expect PASS;** `npm test`.
- [ ] **Step 5: Commit** `feat(#gwid): bridge threads per-gateway ids for aliases`.

---

### Task 4: Refresh the Anthropic offline floor

**Files:** Modify `src/utils/model-fetcher.js`; Test update `tests/model-fetcher-anthropic.test.js`.

**Change:** Update the hardcoded `ANTHROPIC_MODELS` floor (offline/keyless fallback) to the current family so offline users see current models: `anthropic/claude-opus-4-8`, `anthropic/claude-sonnet-5`, `anthropic/claude-haiku-4-5`, `anthropic/claude-fable-5` (+ keep a couple of recent snapshots). Rows stay `authoritative:false` per #61 Task 4.3 (do not change that tagging). Update the floor-content assertions in the test to the new list (don't weaken).

- [ ] Steps: update the array + tests → `npm test` → commit `chore(#gwid): refresh Anthropic offline floor to current family`.

---

### Task 5: Catalog pairing helper (for the audit)

**Files:** Create `src/utils/gateway-route-catalog.js`; Test `tests/gateway-route-catalog.test.js`.

**Interface — Produces:** `pairAcrossGateways(vendor, versionToken, catalogInfo) -> { direct?, openrouter? }` — finds, in `catalogInfo.models`, the direct row (`<vendor>/…` not `openrouter/`) and the OR row (`openrouter/<vendor>/…`) that both correspond to the same model, matched **conservatively** by a shared normalized version token (strip `openrouter/`, strip the `<vendor>/` prefix, normalize `.`/`-` and drop date suffixes for comparison **only** — the returned ids are the catalog's verbatim ids). If it cannot confidently pair, return only the side it is sure of. **Never returns an id not present verbatim in the catalog.**

- [ ] Steps: failing test (opus rows in both namespaces → `{direct:'anthropic/claude-opus-4-8', openrouter:'openrouter/anthropic/claude-opus-4.8'}`; fable OR-only → `{openrouter:'openrouter/anthropic/claude-fable-5'}`; ambiguous/absent → partial or empty, never invented) → implement (pure; normalization for MATCH only) → commit `feat(#gwid): conservative cross-gateway catalog pairing helper`.

---

### Task 6: `models --check` audits both forms + CI gate

**Files:** Modify the `models --check` path (grep `models --check`/`--check`; likely `src/sidecar/models.js` + `src/utils/alias-audit.js`); Modify a CI workflow (`.github/workflows/ci.yml`); Tests update the audit test.

**Change:** `amicus models --check` audits each default alias's `toGatewayRoutes()` entry against the live catalog via `pairAcrossGateways`: flag STALE when a stored form isn't in its namespace, and flag a divergent alias whose `direct` form is missing/mismatched. Add a CI step `node bin/amicus.js models --check --strict` (or a script) that exits non-zero on any stale default alias, so drift fails the build. (Gate only the CURATED defaults, which need no keys for the OpenRouter namespace — the OR catalog is keyless; direct namespaces without a CI key are skipped, not failed.)

- [ ] Steps: failing test (a fixture catalog + a deliberately-divergent alias → `--check` reports it; the refreshed defaults pass) → implement → wire CI → commit `feat(#gwid): models --check audits per-gateway ids; CI gate on drift`.

---

### Task 7: Hermetic e2e — opus routes direct with dashes

**Files:** Create `tests/gateway-correct-ids.integration.test.js`.

**Change:** Child-process `amicus start --model opus --no-ui --prompt hi` with an isolated config, a seeded catalog cache containing `anthropic/claude-opus-4-8`, and a stub `ANTHROPIC_API_KEY` (+ `--no-validate-model` off) — assert the pre-flight does NOT reject with `model_not_found` and the resolved `--model` handed onward is `anthropic/claude-opus-4-8` (the dash form). Mirror the hermetic env setup in `tests/gateway-routing-e2e.integration.test.js` (override HOME/XDG, scrub keys, pre-seed the catalog). Do NOT assert a live model response.

- [ ] Steps: write the integration test → `npm run test:integration` (accept the known pre-existing real-LLM failures) + `npm test` → commit `test(#gwid): opus-direct resolves to the dash id (regression guard)`.

## Testing Strategy

- **Router matrix** (Task 2): direct→dashes, OR→dots, availability fallback (fable), explicit-gateway-to-unavailable errors, no-gatewayIds unchanged.
- **Regression**: OpenAI/Google/DeepSeek aliases + full-id inputs byte-identical (a pinned test).
- **Pairing helper** (Task 5): conservative — partial/empty on ambiguity, never invents.
- **Audit** (Task 6): refreshed defaults pass; a divergent alias fails; CI gate exits non-zero on drift.
- **e2e** (Task 7): opus-direct not rejected pre-flight; emits the dash id.

## Self-Review Notes

- **Spec coverage:** per-gateway route object (Task 1,3), router emits gateway-native id + availability (Task 2), catalog-sourced/audited (Task 5,6), floor refresh (Task 4), e2e (Task 7). Part 2 (cost tier, key-add picker, user-alias fill) explicitly deferred.
- **Type consistency:** `gatewayIds` shape `{direct?,openrouter?}` identical in curated-models output, the bridge, and the router; reason strings `direct_unavailable`/`openrouter_unavailable` added to the closed set + `route-error`.
- **Risk containment:** the fragile cross-namespace match lives only in the audit helper (Task 5), never in the launch hot path (which uses curated/stored forms). Router changes are guarded by `!req.gatewayIds` back-compat so every existing #61 test stays green.
