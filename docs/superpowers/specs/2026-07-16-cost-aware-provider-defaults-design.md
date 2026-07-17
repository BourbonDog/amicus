# Cost-Aware Per-Provider Model Defaults — Design (Part 2)

**Date:** 2026-07-16
**Status:** Proposed — pending review
**Part:** 2 of 2. Part 1 (gateway-correct model ids) shipped as v3.1.1.

## Problem

Amicus never asks which model a provider should default to. The default target is whatever the curated family flagship resolves to — often the most capable/expensive tier (Opus, GPT-pro-class, Gemini Pro). The user's framing: a flagship default is "a 50lb hammer for a 5lb problem." There is no per-provider notion of "my default model" and no cost-conscious prompt when a key is added.

Two key-add seams exist today and **neither seeds a per-provider default**:
- Electron: IPC `sidecar:save-key` (`electron/ipc-setup.js:31`) — writes `.env`, warms the catalog, returns.
- CLI: `amicus key <provider> <key>` (`src/cli-handlers.js:104-162`) — validates + writes `.env`, touches neither `config.default` nor aliases.

`config.default` (used when `--model` is omitted) is a **single global** value; aliases are a flat `{name: "provider/model"}` map merged as `{...DEFAULT_ALIASES, ...config.aliases}` (`config.getEffectiveAliases`).

## Goal

When an API key is added, offer a **cost-aware per-provider default picker** that pre-selects a *balanced* tier (not the flagship), shows live prices, and lets the user confirm or pick cheaper/frontier in one step. Bias defaults away from expensive flagships globally via a `routing.tier` preference, while keeping explicit tier aliases (`opus`, `gpt-pro`) always honored.

## Design

### A. Global cost preference — `routing.tier`

New config field `routing.tier` ∈ `frontier | balanced | economy`, **default `balanced`**. Stored under the existing `routing` object (beside `routing.prefer`). It only biases the **pre-selected** tier in the key-add picker (and any future generic default resolution); it never overrides an explicit alias or a user's saved pick.

### B. Per-vendor tier table

A curated map (new `src/utils/model-tiers.js`) from `(vendor, tier)` → an id-pattern, resolved against the **live catalog** the same way `quick-picks.resolveQuickPicks` resolves families. Initial table (reviewable — **Decision D1**):

| vendor | economy | balanced | frontier |
| --- | --- | --- | --- |
| anthropic | `claude-haiku-*` | `claude-sonnet-*` | `claude-opus-*` |
| openai | `gpt-*-mini` | `gpt-<n>` (base, excl. -mini/-pro/-codex) | `gpt-*-pro` |
| google | `gemini-*-flash-lite` → `-flash` | `gemini-*-flash` | `gemini-*-pro` |
| deepseek | `deepseek-v<n>` (base) | `deepseek-v<n>` | `deepseek-v<n>-pro` |
| gateway-only (grok/qwen/…) | — | the curated family flagship (`quick-picks`) | — |

The table drives ONLY the picker's pre-selection cursor. The user always sees the full vendor list and can pick anything. Where a tier can't resolve (vendor has no such class), fall back to the nearest available tier (economy→balanced→frontier).

### C. The key-add picker (three surfaces)

Fires **immediately after a key is successfully saved**, for the vendor just added:

1. **Standalone CLI** `amicus key <provider> <key>` — after `saveApiKey` (`cli-handlers.js:156`), run a readline picker.
2. **Electron key step** — after `sidecar:save-key` (`ipc-setup.js:39`), surface an inline per-provider picker in the renderer (the key step already awaits a catalog warm).
3. **Readline setup fallback** — same picker inside `runReadlineSetup`'s key stage.

Picker behavior (all surfaces):
- Build the vendor's model list from `getCatalog()`: the vendor's rows, **deduped across gateways** via Part 1's `pairAcrossGateways` so each logical model appears once with its direct id (direct-first storage) and its OpenRouter twin for pricing.
- **Pre-select** the `routing.tier` tier for that vendor (from the tier table).
- Show, per row: model name, context, and **price** (`$/M in`) via `fmtPrice` (`setup-ui.js:490`) read from the OpenRouter-namespaced twin (OR rows are the only priced rows; the OR catalog is fetched keyless, so prices show even for a direct-only key — **Decision D4**). Rows with no priced twin show "price n/a".
- The user confirms the pre-selection (Enter / default button) or picks another. Skipping keeps the pre-selection. Non-interactive/`--json`/`--no-ui` invocations skip the prompt and take the pre-selected tier silently (with a one-line notice of what was chosen and how to change it).

### D. Writing the pick

Read-modify-write on config (reuse the existing no-clobber savers — `ipc-setup.js:104-134`, `setup.js:313-328`):
- **Vendor-named alias:** `config.aliases[<vendor>] = <chosen id>`, stored **direct-first** via `toCanonicalDefault` (so `anthropic` → `anthropic/claude-sonnet-5`). This makes `--model anthropic` resolve to that provider's default.
- **`config.default` seeding (Decision D3):** if `config.default` is absent (first key ever), set it to the just-chosen id. On subsequent key-adds, do NOT hijack an existing `config.default`; instead print "Your overall default is still `<x>`; use `--model <vendor>` for this one" (and, interactively only, offer to make it the overall default).
- **Per-gateway correctness for the vendor alias (Decision D2):** a user/vendor alias is NOT a curated DEFAULT, so Part 1's bridge (gated on `aliases[model] === getDefaultAliases()[model]`) would not give it per-gateway ids — reintroducing the dot/dash bug if the user picks a *divergent* model (opus/haiku). Fix: **generalize the bridge's gatewayIds resolution to be by-MODEL, not by-curated-alias-name.** When resolving any alias, if the resolved model matches a curated route (`toGatewayRoutes` keyed by model) OR can be paired via `pairAcrossGateways` against the already-fetched `catalogInfo` (no extra network — the bridge already holds it), thread those gateway ids. Non-divergent picks (Sonnet 5, all OpenAI/Google/DeepSeek) need nothing — `executableFor` already yields the right id both ways. This also retires Part 1's deferred "user-config aliases" limitation.

### E. Existing users

Non-destructive. On the first run after upgrade (or `amicus setup` re-run), a **non-blocking** offer to set per-provider defaults for already-configured keys, gated by a one-time flag in the style of `markMigrationNotified` (`config.js:408`). Declining leaves everything as-is; `routing.tier` defaults to `balanced` but changes nothing already saved.

### What stays the same

- Explicit tier aliases (`opus`, `gpt-pro`, `haiku`, `codex`, …) always resolve to their tier — the preference/picker only affects the default/generic selection.
- The existing wizard Model step + Alias editor remain for power-tuning.
- `config.default` remains a single global value; the vendor aliases provide the per-provider layer.
- Part 1's routing, `--gateway`, `models --check`, migration notice — unchanged.

## Testing strategy

- **Tier resolution** (unit): `(vendor, tier)` resolves to the expected live-catalog id; missing-tier falls back nearest; gateway-only vendors resolve to the family flagship.
- **Picker logic** (unit, transport-agnostic core): pre-selects the `routing.tier` tier; lists the vendor's deduped models with prices from the OR twin; non-interactive path takes the pre-selection silently.
- **Write path** (unit): writes the vendor alias direct-first; seeds `config.default` only when absent; never clobbers an existing default; existing aliases/config preserved (read-modify-write).
- **Per-gateway correctness** (unit): a vendor alias pointing at a divergent model (opus) resolves to the dash id on a direct route and the dot id on OR (the generalized by-model gatewayIds path).
- **CLI e2e** (hermetic): `amicus key anthropic <stub>` with a seeded catalog pre-selects Sonnet, writes `aliases.anthropic`, and (first key) `config.default`; `--json`/non-interactive takes the pre-selection without prompting.
- **Existing-user** (unit): the one-time offer flag fires once; declining is a no-op.

## Out of scope

- Changing how `config.default` is a single value (no multi-default resolution beyond vendor aliases).
- Reshaping the multi-step wizard (placement Decision chose "fire at key-add"; the wizard steps stay).
- Per-request cost gating (already exists: `maxCost`/`maxCostPerMtok`).
- Pricing for direct namespaces from provider APIs (they return none; we use the keyless OR twin).

## Open decisions (resolve in review)

- **D1** — the per-vendor tier table contents (above). Reasonable starting point; easy to tune.
- **D2** — generalize gatewayIds resolution by-model (recommended) vs storing per-gateway forms in config (schema change). Recommend by-model.
- **D3** — `config.default` seeded only on the first key; subsequent keys set only the vendor alias. Recommend as written.
- **D4** — price shown from the keyless OpenRouter twin; "n/a" when absent. Recommend as written.

## Open risks

- **Gateway-only vendors** have no direct/tier structure — the picker still offers a per-provider default (their OpenRouter flagship), but "tiers" are degenerate; make sure the pre-selection is sensible (family flagship) and the copy doesn't imply cost tiers that don't exist.
- **Pricing staleness/absence:** a fresh install with no cached catalog, offline, shows "price n/a" — the picker must still function (pre-select by tier, let the user pick) without prices.
- **`pairAcrossGateways` on the launch path (D2):** Part 1 deliberately kept it off the hot path. Using it in the bridge adds a bounded, conservative, no-network pairing over already-fetched catalog rows — acceptable, but must stay fail-open (unpaired → fall back to `executableFor`, never block a launch).
