# Cost-Aware Per-Provider Model Defaults — Implementation Plan (Part 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an API key is added, offer a cost-aware per-provider default-model picker that pre-selects a *balanced* tier (not the flagship), shows live prices, and writes the pick as a vendor-named alias — so users stop defaulting to a "50lb hammer for a 5lb problem."

**Architecture:** A global `routing.tier` preference (`frontier|balanced|economy`, default `balanced`) + a curated per-vendor tier table drive the pre-selection. A transport-agnostic picker core builds a priced, gateway-deduped model list; three thin surfaces (CLI `amicus key`, readline setup, Electron key step) call it after a key saves. The pick is written as a vendor-named alias (`--model anthropic`), stored direct-first, and the launch bridge is generalized to resolve per-gateway ids **by model** so these aliases route correctly.

**Tech Stack:** Node.js (CommonJS), Jest 29, Electron 43 (renderer HTML + IPC). No new deps.

**Spec:** `docs/superpowers/specs/2026-07-16-cost-aware-provider-defaults-design.md`

## Global Constraints

- **Node ≥22.12**; CommonJS; files **≤300 lines** (`npm run check:sizes`, scans `src/**` + `electron/**`); `npm test` (excludes `*.integration.test.js`) green at 0 failures after every task; `npm run lint` clean; `npm run generate-docs:check` green.
- **Non-destructive config**: every config write is read-modify-write, no-clobber (match `ipc-setup.js:104-134` / `setup.js:313-328`). Never overwrite an existing `config.default` or existing aliases the user didn't just change.
- **Never block a launch**: the bridge generalization must fail OPEN — an unpaired/unknown model falls back to today's `executableFor` behavior, never an error.
- **Explicit tier aliases always win**: `opus`, `gpt-pro`, `haiku`, etc. resolve to their tier regardless of `routing.tier` or any saved pick.
- **Backward compatible**: existing configs, `config.default`, and the curated DEFAULT_ALIASES resolve exactly as before; `routing.tier` absent ⇒ treated as `balanced` with no behavior change to anything already saved.

## Current-state anchors (from the code map)

- Key-add seams: CLI `handleKey` save mode `src/cli-handlers.js:156` (after `saveApiKey`); Electron IPC `sidecar:save-key` `electron/ipc-setup.js:31-51`; readline setup key stage in `src/sidecar/setup.js`.
- Config: `src/utils/config.js` — `loadConfig`/`saveConfig` (`:41-76`), `getEffectiveAliases` (`:215-219`), `getDefaultAliases` (`:79-81`), `resolveModel` default fallback (`:127-153`); shape has `routing:{prefer, migration_notified}`.
- Catalog/pricing: `getCatalog()` (`model-catalog.js:117`); row `{id,name,contextLength,pricing:{prompt,completion}|null}` (`model-fetcher.js:33-98`); **only `openrouter/*` rows are priced**; OR is fetched keyless. `fmtPrice` at `electron/setup-ui.js:490-494` (`Number(prompt)*1e6` → `$/M in`). `pricing.lookupPricing` (`src/utils/pricing.js:39-50`).
- Part 1 helpers: `curated-models.toGatewayRoutes()` → `{alias:{direct?,openrouter}}`; `gateway-route-catalog.pairAcrossGateways(vendor, versionToken, catalogInfo)` → `{direct?,openrouter?}`; `curated-models.toCanonicalDefault(route)` (strip `openrouter/` for direct-capable).
- Bridge: `src/utils/route-launch.js resolveRouteForLaunch` currently sets `gatewayIds = toGatewayRoutes()[model]` ONLY when `aliases[model] === getDefaultAliases()[model]` (Part 1 Task 3 guard). This is what Task 3 generalizes.
- Quick-picks family resolution: `quick-picks.resolveQuickPicks(catalog)` + `pickCurrent`/`compareIdsDesc` (the live-flagship matcher to mirror for tiers).

---

## File Structure

- **Create** `src/utils/model-tiers.js` — the per-vendor tier table + `resolveTier` (Task 2).
- **Create** `src/utils/provider-default-picker.js` — transport-agnostic picker core: build choices + apply the pick (Tasks 4, 5).
- **Modify** `src/utils/config.js` — `routing.tier` read/write/default + validation (Task 1).
- **Modify** `src/utils/route-launch.js` — generalize gatewayIds resolution by-model (Task 3).
- **Modify** `src/cli-handlers.js` — CLI `amicus key` picker hook (Task 6).
- **Modify** `src/sidecar/setup.js` — readline setup key-stage picker (Task 7).
- **Modify** `electron/ipc-setup.js` + `electron/setup-ui-keys*.js` — Electron key-step picker (Task 8).
- **Modify** `src/utils/config.js` + one surface — existing-user one-time offer (Task 9).

---

### Task 1: `routing.tier` config field

**Files:** Modify `src/utils/config.js`; Test extend `tests/config.test.js`.

**Interfaces — Produces:** `getCostTier() -> 'frontier'|'balanced'|'economy'` (reads `config.routing.tier`, defaults `'balanced'`, coerces unknown → `'balanced'`); `setCostTier(tier)` (validates ∈ the 3 values, read-modify-write into `config.routing.tier`, throws on invalid).

- [ ] **Step 1: Write the failing test** — `getCostTier()` returns `'balanced'` when unset; returns the saved value when `config.routing.tier` is set; returns `'balanced'` for a garbage value. `setCostTier('economy')` persists under `routing.tier` and preserves other `routing` keys (`prefer`, `migration_notified`). `setCostTier('bogus')` throws.
- [ ] **Step 2: Run — expect FAIL** (functions undefined).
- [ ] **Step 3: Implement.** Add `const COST_TIERS = ['frontier','balanced','economy'];` `function getCostTier(){ const c = loadConfig(); const t = c.routing && c.routing.tier; return COST_TIERS.includes(t) ? t : 'balanced'; }` `function setCostTier(t){ if(!COST_TIERS.includes(t)) throw new Error(...); const c = loadConfig(); c.routing = { ...(c.routing||{}), tier: t }; saveConfig(c); }`. Export both + `COST_TIERS`.
- [ ] **Step 4: Run — expect PASS;** `npm test`.
- [ ] **Step 5: Commit** `feat(cost-defaults): routing.tier config field (default balanced)`.

---

### Task 2: Per-vendor tier table + resolution

**Files:** Create `src/utils/model-tiers.js`; Test `tests/model-tiers.test.js`.

**Interfaces — Consumes:** `getCatalog()` rows; `provider-registry` vendor list. **Produces:** `resolveTier(vendor, tier, catalog) -> string|null` — the current live-catalog id (full, e.g. `anthropic/claude-sonnet-5` or `openrouter/x-ai/grok-4.3`) for that vendor+tier, or `null` if the vendor is unknown/absent from the catalog. Falls back nearest tier (economy→balanced→frontier) when the requested tier's pattern matches nothing.

**Tier table** (a module const `TIERS`): per vendor, `{ economy: RegExp, balanced: RegExp, frontier: RegExp }` over the model segment, plus gateway-only vendors mapping all tiers to the curated family flagship. Use the spec's D1 table:
- anthropic: economy `/^claude-haiku-/`, balanced `/^claude-sonnet-/`, frontier `/^claude-opus-/`
- openai: economy `/^gpt-[\d.]+-mini$/`, balanced `/^gpt-[\d.]+$/`, frontier `/^gpt-[\d.]+-pro$/`
- google: economy `/^gemini-[\d.]+-flash-lite/`, balanced `/^gemini-[\d.]+-flash/`, frontier `/^gemini-[\d.]+-pro/`
- deepseek: economy `/^deepseek-v[\d.]+$/`, balanced `/^deepseek-v[\d.]+$/`, frontier `/^deepseek-v[\d.]+-pro$/`
- gateway-only (grok/qwen/…): no tier regexes — resolve to `quick-picks`/curated flagship for all tiers.

- [ ] **Step 1: Write the failing test** — with a fixture catalog containing `anthropic/claude-{haiku-4-5,sonnet-5,opus-4-8}`: `resolveTier('anthropic','economy',cat)==='anthropic/claude-haiku-4-5'`, `'balanced'→sonnet-5`, `'frontier'→opus-4-8`. `openai` base vs `-mini` vs `-pro`. Missing tier (e.g. deepseek economy when only `-pro` present) falls back to an available tier, never null-when-models-exist. Unknown vendor → `null`. Pick the NEWEST match per tier (reuse `compareIdsDesc` from quick-picks).
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement.** Mirror `quick-picks.pickCurrent`: filter catalog to the vendor namespace (direct `<vendor>/` AND `openrouter/<vendor>/`), match the tier regex on the model segment, sort desc, return the top id (prefer the direct-namespace id when both exist, so storage is direct-first). Gateway-only vendors delegate to the curated flagship. Keep ≤300 lines.
- [ ] **Step 4: Run — expect PASS;** `npm test`.
- [ ] **Step 5: Commit** `feat(cost-defaults): per-vendor tier table + resolveTier`.

---

### Task 3: Generalize the bridge's gatewayIds resolution by-model

**Files:** Modify `src/utils/route-launch.js`; Test extend `tests/route-launch.test.js`.

**Change (retires Part 1's curated-only limitation, spec D2):** replace the `aliases[model] === getDefaultAliases()[model]` gate with a **by-model** resolution that works for ANY alias (curated default, user override, or a Part-2 vendor alias):
1. Resolve the alias to its concrete `resolvedId` (existing behavior).
2. Look up gatewayIds for `resolvedId`: build a by-model index of `toGatewayRoutes()` (keyed by BOTH its `.direct` and `.openrouter` values → the pair); if `resolvedId` hits, use that pair.
3. Else, if the vendor is divergent and `catalogInfo` is available, `pairAcrossGateways(vendor, bareSegment(resolvedId), catalogInfo)` → use the pair if it has both/relevant forms.
4. Else no gatewayIds (fall back to `executableFor` — non-divergent ids are correct either way).
**Fail-open**: any lookup miss/throw ⇒ no gatewayIds, never an error.

- [ ] **Step 1: Write the failing test** — (a) a USER vendor alias `anthropic` → `anthropic/claude-opus-4-8` (a divergent model, NOT a curated default name) resolves to `anthropic/claude-opus-4-8` on a direct route and `openrouter/anthropic/claude-opus-4.8` on OR (by-model gatewayIds applied). (b) Back-compat: the curated `opus` default still resolves identically to Part 1. (c) A user override of `opus` → some non-divergent model resolves to that model with no wrong gatewayIds. (d) An unknown/uncatalogued model still launches (fail-open, no gatewayIds).
- [ ] **Step 2: Run — expect FAIL** (the user vendor alias currently gets no gatewayIds).
- [ ] **Step 3: Implement** the by-model resolution + `bareSegment` reuse (from `gateway-route-audit`/Task-5 helper — import or re-derive a tiny local). Keep the descriptor parsed from the direct form when a pair is found (as Part 1 did).
- [ ] **Step 4: Run — expect PASS;** `npm test` (all Part 1 route-launch/gateway tests must stay green).
- [ ] **Step 5: Commit** `feat(cost-defaults): resolve per-gateway ids by model for any alias`.

---

### Task 4: Picker core — build priced, tier-preselected choices

**Files:** Create `src/utils/provider-default-picker.js`; Test `tests/provider-default-picker.test.js`.

**Interfaces — Consumes:** `getCatalog()`, `resolveTier` (Task 2), `pairAcrossGateways`, `getCostTier` (Task 1). **Produces:** `buildProviderDefaultChoices(vendor, { catalog, tier }) -> { preselectedId, rows: Array<{ id, name, contextLength, pricePerMInput: number|null, isPreselected: boolean }> }`. The core computes `pricePerMInput` as a raw NUMBER (`Number(pricing.prompt) * 1e6`) — it MUST NOT import the renderer's `fmtPrice`; each surface formats the number itself (Electron via its existing `fmtPrice`, CLI with its own `$X.XX/M` formatter).
- `rows`: the vendor's models deduped across gateways (each logical model once; `id` is the direct-first form via `pairAcrossGateways`/`toCanonicalDefault`). Sorted: preselected first, then by price asc (nulls last).
- `pricePerMInput`: from the OpenRouter twin's `pricing.prompt * 1e6`, else `null`.
- `preselectedId`: `resolveTier(vendor, tier || getCostTier(), catalog)`; if null, the vendor's cheapest priced row, else the first row.

- [ ] **Step 1: Write the failing test** — fixture catalog with anthropic direct + OR twins: choices dedupe (opus appears once, `id` = dash direct form), `pricePerMInput` pulled from the OR twin, `preselectedId` = the `balanced`→sonnet id, `isPreselected` set on exactly that row. A vendor with an unpriced row → `pricePerMInput: null`, still listed.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** the pure builder (no I/O beyond the injected `catalog`). Keep ≤300 lines.
- [ ] **Step 4: Run — expect PASS;** `npm test`.
- [ ] **Step 5: Commit** `feat(cost-defaults): provider-default picker core (choices + pricing)`.

---

### Task 5: Apply the pick (write vendor alias + seed default)

**Files:** Modify `src/utils/provider-default-picker.js`; Test extend `tests/provider-default-picker.test.js`.

**Interfaces — Produces:** `applyProviderDefault(vendor, chosenId, { seedDefaultIfAbsent = true } = {}) -> { alias, setAsDefault }` — read-modify-write config: sets `config.aliases[vendor] = toCanonicalDefault(chosenId)` (direct-first); if `seedDefaultIfAbsent` and `config.default` is absent/empty, sets `config.default = vendor` (the alias name) and returns `setAsDefault:true`; never clobbers an existing default or other aliases; `saveConfig`.

- [ ] **Step 1: Write the failing test** — on an empty config, `applyProviderDefault('anthropic','anthropic/claude-sonnet-5')` sets `aliases.anthropic` to the bare id AND `config.default='anthropic'` (setAsDefault true). On a config that already has `default:'gpt'`, a second call sets only `aliases.anthropic`, leaves `default:'gpt'` (setAsDefault false). Existing unrelated aliases preserved. A dot-form OR-only `chosenId` (gateway-only vendor) is stored as-is (toCanonicalDefault no-ops).
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** with the no-clobber read-modify-write.
- [ ] **Step 4: Run — expect PASS;** `npm test`.
- [ ] **Step 5: Commit** `feat(cost-defaults): apply provider default (vendor alias + first-key default)`.

---

### Task 6: CLI `amicus key` picker

**Files:** Modify `src/cli-handlers.js` (the `handleKey` save mode, `:156`); Test extend `tests/cli-key.test.js`.

**Change:** after a successful `saveApiKey(provider, key)`, run the picker for `provider`:
- Interactive TTY: print the numbered choices (name · ctx · `$/M in` · a "recommended" marker on the preselected), read a selection (Enter = preselected; a number picks another), then `applyProviderDefault(provider, chosenId, {seedDefaultIfAbsent:true})` and print a one-line confirmation (`--model <vendor>` now → chosen; and, if seeded, "set as your default").
- **Non-interactive / not a TTY / a `--json`-style/quiet flag**: skip the prompt, apply the PRESELECTED id silently, print a one-line notice of what was chosen and how to change it (`amicus key <provider>` re-run or edit config). Never hang waiting for input.
- Reuse the readline helper style already in `setup.js` (`ask`/`rl`). Guard the catalog read: if `getCatalog()` is empty/offline, still write the tier-preselected default (may be a curated fallback) or skip gracefully with a notice — never crash key-add.

- [ ] Steps: failing test (mock stdin non-TTY → preselected applied silently, alias written; a TTY-simulated selection picks a specific row) → implement → `npm test` → commit `feat(cost-defaults): per-provider picker on 'amicus key'`.

---

### Task 7: Readline setup key-stage picker

**Files:** Modify `src/sidecar/setup.js`; Test extend `tests/*setup*` (match the existing setup test file).

**Change:** in `runReadlineSetup`, after keys are confirmed/detected, for each provider whose key is present, run the SAME picker (call the Task 6 shared helper — extract the interactive picker into a small reusable function so CLI and setup share it). Keep the existing mode prompt + standard model step intact (they remain for power-tuning per the placement decision). Ensure the picker runs once per keyed provider, seeds `config.default` from the first, and is skippable.

- [ ] Steps: failing test (readline setup with one keyed provider writes the vendor alias + default) → implement (share the helper) → `npm test` → commit `feat(cost-defaults): per-provider picker in readline setup`.

---

### Task 8: Electron key-step picker

**Files:** Modify `electron/ipc-setup.js` (`sidecar:save-key` `:31`), `electron/setup-ui-keys.js` / `electron/setup-ui-keys-script.js`; Test extend the electron setup-ui tests + an ipc-setup test.

**Change:** after `saveApiKey` in `sidecar:save-key` (and its catalog warm), return the provider's picker choices (`buildProviderDefaultChoices`) to the renderer; the key step renders an inline per-provider default selector (radio list: name · ctx · `$/M in`, preselected marked) beneath the just-saved key. On selection (or on advancing), the renderer sends the chosen id via a new IPC (or extends `sidecar:save-config`) that calls `applyProviderDefault`. Non-selection ⇒ the preselected id is applied. Mirror existing patterns: `buildModelStepHTML`/`fmtPrice` for the priced rows, the `pickRouteFor`/`toBareIfDirect` direct-first storage rule, and the read-modify-write save in `ipc-setup.js:104-134`.

- [ ] Steps: failing test (the new IPC path applies the chosen provider default via `applyProviderDefault`; `buildProviderDefaultChoices` wired into the save-key return) → implement → `npm test` (+ `check:sizes` for the electron files) → commit `feat(cost-defaults): per-provider picker in the Electron key step`.

**Note:** if any electron file would exceed 300 lines, split the new renderer fragment into its own `electron/setup-ui-provider-default.js` (consistent with the existing `setup-ui-*` split) rather than grandfathering.

---

### Task 9: Existing-user one-time offer

**Files:** Modify `src/utils/config.js` (a one-time flag helper) + the most natural surface (CLI `start`/`setup` entry, or a first-run hook); Test.

**Change:** a non-blocking, once-only offer to set per-provider defaults for already-configured keys. Add a flag in the `markMigrationNotified` style (`config.js:408`) — e.g. `config.routing.tier_onboarded = true`. On an interactive entry point, if keys exist AND the flag is unset AND no vendor aliases are set, print a one-line offer (`Run 'amicus key <provider>' to set a cost-aware default per provider`) and set the flag so it never repeats. Declining/ignoring is a no-op; nothing is auto-changed.

- [ ] Steps: failing test (flag fires once then is suppressed; no config mutation beyond the flag) → implement → `npm test` → commit `feat(cost-defaults): one-time per-provider-default onboarding notice`.

## Testing Strategy

- **Logic core** (Tasks 1–5): tier read/default/validation; tier resolution incl. nearest-fallback + gateway-only; by-model gatewayIds (divergent vendor alias → dash direct / dot OR, back-compat for curated defaults, fail-open); priced deduped choices; no-clobber write + first-key seeding.
- **Surfaces** (Tasks 6–8): non-interactive path applies the preselection silently and writes the alias; an interactive selection picks a specific row; Electron IPC applies via `applyProviderDefault`.
- **Existing users** (Task 9): one-time flag fires once, no auto-mutation.
- **Regression**: existing config/default/alias resolution + all Part 1 gateway tests stay green.

## Self-Review Notes

- **Spec coverage:** routing.tier (T1) + tier table (T2) + picker core (T4) + write/vendor-alias/default-seed (T5) + three surfaces (T6–T8) + existing-user offer (T9) + the D2 by-model bridge generalization (T3). D1 table in T2; D3 seeding in T5; D4 pricing in T4.
- **Type consistency:** `buildProviderDefaultChoices` return shape and `applyProviderDefault` signature identical across the picker core and all three surfaces; `getCostTier`/`resolveTier`/`COST_TIERS` names consistent.
- **Phasing:** Tasks 1–5 (logic) are shippable/reviewable independently of the surfaces; if scope needs trimming, Tasks 1–6 (logic + CLI) form a coherent first slice, with 7–9 (readline/Electron/onboarding) a follow-up — but the plan delivers all nine.
- **Risk containment:** the bridge change (T3) is the one sensitive edit — it's guarded fail-open and asserted back-compat against every Part 1 gateway test; `pairAcrossGateways` stays over already-fetched catalog data (no new network on the hot path).
