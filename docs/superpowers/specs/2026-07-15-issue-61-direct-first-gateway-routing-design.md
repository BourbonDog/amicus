# Direct-First Gateway Routing Design (Issue #61)

**Date:** 2026-07-15
**Status:** Proposed — pending review
**Issue:** [#61](https://github.com/BourbonDog/amicus/issues/61)
**Review:** 3-model design review (Gemini Pro, DeepSeek Pro, GPT-5.6-Terra) + code-verified maintainer eval. Consolidated findings folded in.

## Problem

Amicus is **OpenRouter-first**: a model runs through OpenRouter even when the user holds a direct provider key (OpenAI / Google / Anthropic / DeepSeek). The only direct path is `applyDirectApiFallback()` (alias-resolver.js:17), which strips an `openrouter/` prefix — but it bails the moment *any* OpenRouter key exists (env or persisted), runs only on alias-resolved models, and never sees full `openrouter/…` IDs (those return verbatim from `resolveModel()`). Net: a user who has both an OpenRouter key and a direct key pays the OpenRouter margin on every call and cannot easily prefer their direct provider.

Issue #61 asks for **direct-first routing with an explicit override**: if a direct key exists for a vendor, use it; reach for OpenRouter only when asked.

### Why this is not a small change

A code audit (verified against the repo, not the design's own claims) found the routing decision is spread across many load-bearing sites that the naive design under-scoped:

- **Three un-unified provider registries** plus a fourth credential source: `PROVIDER_ENV_MAP` (api-key-store.js:10, and it *wrongly includes* `openrouter`), `PROVIDER_KEY_MAP` (validators.js:22), `KNOWN_PROVIDERS` (auth-json.js:53), and `auth.json` as a credential source beyond env and the `.env` store.
- **The real launch gate** is `resolveModelFromArgs()` / `validateFallbackModel()` (start-helpers.js) + `detectFallback()` (config.js:262), which dispatch between `validateDirectModel` and `validateAgainstCatalog`. `--no-validate-model` opts out.
- **The engine wiring point** is `buildProviderModels()` (config.js:240), which synthesizes OpenCode's `provider.models` from alias values (consumed at opencode-client.js:477). `parseModelString` (opencode-client.js:73) routes bare `provider/model` direct; a single no-slash token defaults to OpenRouter.
- **The combined catalog** `getCatalog()` is `[]`-on-failure, 24h-cached, and treats an Anthropic-only refresh as failed (keeps stale). Anthropic rows are an always-present hardcoded floor; google/openai/deepseek rows appear only when their key is set.
- **Error paths differ**: the structured error shape exists only on the MCP input path (input-validators.js). The CLI path (start-helpers.js) reports via `console.error` + `process.exit(1)`.
- **Also in the blast radius**: cli.js:311 `isValidModelFormat`, quick-picks.js (setup), alias-audit.js, free-models.js, council-presets.js, and the fanout/continue/resume validation call sites.
- **Test contract locked**: config-fallback.test.js pins "a persisted OR key (not just env) blocks stripping" (:86) + the full matrix; must be rewritten once callers use the router.

## Core Insight

The naive design conflates three concerns and uses one stale, partial catalog as the oracle for all of them. This design **separates them**:

1. **Route intent** — what the user asked for (`--gateway`, an `openrouter/` literal, `routing.prefer`, or nothing).
2. **Route capability** — whether we actually hold the credential to execute that route.
3. **Catalog knowledge** — whether we *think* the model exists on that gateway, expressed as **tri-state** (`valid | invalid | unknown`), never as a boolean that turns a fetch failure into a hard block.

A resolved route object carrying all three drives every downstream path — launch validation, engine config, error surfaces, and the interactive picker.

## Design

### Decision 1 — Descriptor grammar

| Form | Meaning |
| --- | --- |
| named alias (`gpt`, `gemini`) | Resolve through alias-resolver to a concrete `provider/model`, then apply routing policy. |
| `provider/model` (bare, slash) | **Canonical**: policy-routed (direct-first by default). |
| `openrouter/provider/model` | **Explicit force-OpenRouter** literal. Honored indefinitely. |
| single no-slash token that is not a known alias | **Rejected** with a clear error (was: silent OpenRouter default). Removes a hidden second policy. |

### Decision 2 — Gateway modes (precise contracts)

Per-call `--gateway <mode>` (CLI) / `gateway` enum (MCP), and global `routing.prefer` (default `direct`):

- **`auto`** — apply direct-first policy; a vendor with no direct integration (x-ai, qwen, mistralai, z-ai, minimax, moonshotai, …) routes to OpenRouter.
- **`direct`** — require a supported direct integration **and** a direct credential **and** a compatible model; otherwise `model_route_error`. Never silently falls through to OpenRouter.
- **`openrouter`** — require an OpenRouter credential **and** an OpenRouter-compatible model; otherwise `model_route_error`.

**Explicit conflicts error, never silently resolve:**
- `--gateway direct` on a gateway-only vendor (e.g. `x-ai/grok`) → error ("no direct integration for x-ai").
- `--gateway direct` + an `openrouter/…` literal → conflict error (two opposing explicit intents).

Precedence for the *policy* (when no explicit conflict): explicit `openrouter/` literal → per-call `--gateway` → global `routing.prefer` → built-in default (`direct`).

### Decision 3 — Every selected route passes four checks

For *any* resolved route, in order:

1. **Intent** — resolved mode is coherent (no explicit conflict).
2. **Credential** — the gateway's key exists (direct env/`.env`/auth.json for the vendor, or the OpenRouter key). Missing → structured error with actionable suggestions. This closes the gap where `--gateway openrouter` with no OR key routed anyway and died with an opaque SDK auth error.
3. **Model compatibility** — tri-state catalog check (Decision 4).
4. **Provider-config synthesis** — the resolved route (not a re-derived alias) is the sole input to `buildProviderModels()`.

### Decision 4 — Tri-state catalog validation

`getCatalog()` results become `valid | invalid | unknown`:

- **`valid`** — model present in a *successful* authoritative source for the gateway → route.
- **`invalid`** — model *absent from a successful* authoritative source → may reject (prompt/error).
- **`unknown`** — fetch failed, cache stale past a threshold, or namespace empty-on-failure → **do not reject**. Honor a valid explicit route and let the provider API return the real 404 (with a notice). For `auto`, prefer a known-good route; if neither is confidently available, return structured suggestions rather than asserting absence. A route miss may trigger a bounded (5s) force-refresh; `--no-validate-model` bypasses only the *remote model-existence* check, never intent/credential checks.

Catalog entries carry `source`, `timestamp`, and `fetchStatus` so the resolver can tell `invalid` from `unknown`.

**Anthropic fix**: the always-present hardcoded floor makes Anthropic rows lie about availability (an expired-but-present key still passes, and the floor pollutes the picker's "available direct" list). Add the Anthropic live `GET /v1/models` fetcher and make Anthropic rows **key-conditional**, matching google/openai/deepseek. Keep the hardcoded list only as the offline fallback. *(Note: the no-Anthropic-key case is already gated by the `hasDirectKey` check ordering — this fix targets the expired-key and picker-listing cases.)*

### Decision 5 — Provider-capability registry (unify first)

A single `DIRECT_PROVIDERS` / provider-capability registry declares, per vendor: `id`, credential sources (env var, `.env`, auth.json key), `direct` support flag, `openrouterOnly` flag, live fetcher, display name, validation metadata. `PROVIDER_ENV_MAP`, `PROVIDER_KEY_MAP`, `KNOWN_PROVIDERS`, and the fetch/display maps are **derived from it** (or retained as compatibility exports generated from it). This removes the `openrouter`-in-direct-loop bug and gives the resolver one coherent `keys` view that includes auth.json.

### Decision 6 — `resolveRoute` API

```
resolveRoute(request) -> RouteResult

request = {
  requested,                 // raw descriptor as given
  source,                    // 'cli' | 'mcp' | 'alias' | 'quick-pick' | 'resume' | 'continue'
  gatewayMode,               // 'auto' | 'direct' | 'openrouter' (per-call or resolved from policy)
  allowSelection,            // interactive picker permitted?
  validateModel,             // false => skip remote existence check only
  policy, keys, catalog,     // provider registry-derived views
}

RouteResult =
  | { kind: 'resolved', model, gateway, executableId, provenance, notice? }
  | { kind: 'selection_required', requested, suggestions[] }
  | { kind: 'error', type: 'model_route_error', field, requested, reason, preferredGateway, suggestions[] }
```

Canonical IDs are treated as **user intent**, not guaranteed-executable IDs. When known, the result carries the direct executable ID / OpenRouter executable ID / compatibility confidence — no blind cross-namespace ID transformation.

### Decision 7 — Migration for existing users (product decision: **migrate + notice**)

Existing users who hold **both** an OpenRouter key and a direct key are switched to direct-first (the feature's intent), but the change is made **visible**:

- Emit a **one-time per-vendor notice** on the first redirect from OpenRouter to direct (interactive CLI text; structured `notice` field in JSON/MCP output).
- Persist a `routing.migration_notified.<vendor>` flag so subsequent routes are silent.
- Record the resolved gateway in session metadata so automation can audit the cost/routing change.
- Document `routing.prefer: "openrouter"` (and `--gateway openrouter`) as the durable one-line opt-out.
- Explicit `openrouter/…` literals are preserved indefinitely and never trigger a migration notice.

### Decision 8 — continue / resume provenance

`continue`/`resume` must not silently change an in-flight conversation's gateway. Persist **route provenance** in session metadata: requested descriptor, resolved gateway, executable model ID, route policy, resolution version. Existing sessions preserve their prior resolved route; only a *newly requested* model routes under the new policy.

### Decision 9 — Error surfaces (CLI and MCP)

The structured `model_route_error` is plumbed into **both** the MCP input-validator path **and** the CLI start-helpers path, gated on `!isTTY` (a piped CLI is non-interactive but is *not* MCP). Interactive TTY gets the picker; non-interactive gets the structured error/suggestions. The picker and the error path consume the **same** normalized suggestion shape.

### Decision 10 — Interactive picker

Evolve `promptModelSelection`. On a direct miss/failure, offer: same model via OpenRouter / a different same-provider model / a model from another keyed provider / cancel. Alternatives are **labeled** by route, provider, credential source, and material capability difference (context window, pricing, tool support); never auto-selected. Provider listing uses live endpoints (Anthropic added), each `[]`-on-failure with a 5s timeout; the keyless OpenRouter catalog is the always-available fallback list.

## Scope

**In scope (pre-flight):** resolving the correct gateway *before* launch, structured recovery for CLI + MCP, the interactive picker, migration notices, and provenance for new sessions.

**Out of scope (tracked follow-up):** runtime mid-session recovery (a 401/402 that surfaces *after* the session starts). The pre-flight resolver reduces its likelihood but does not handle it.

## Implementation Phases (drives the plan)

0. **Unify provider registries** into one capability registry; derive the legacy maps. *(Prerequisite — the resolver can't be pure over fragmented state.)*
1. **Contracts**: normalized descriptor grammar + `RouteResult`; explicit-conflict rules; four-check order; `--no-validate-model` semantics; CLI+MCP error contract.
2. **Catalog provenance + tri-state**: add `source`/`timestamp`/`fetchStatus`; `valid|invalid|unknown`; Anthropic live fetcher with key-conditional rows.
3. **Pure router** (`gateway-router.js`) + exhaustive matrix tests: alias sources, all gateway modes, missing keys, stale/unknown catalog, explicit conflicts, gateway-only vendors, malformed IDs.
4. **Wire the route result into all paths**: start-helpers, cli parser validation, MCP validators/errors, fanout, continue, resume, quick-picks, aliases, council-presets, free-models, alias-audit, and `buildProviderModels` (resolved route is the sole input). Retire `applyDirectApiFallback()`; rewrite config-fallback.test.js only after all callers migrate.
5. **Session persistence / provenance** for continue/resume + migration-notice flags.
6. **Interactive picker + non-interactive structured guidance** sharing one suggestion shape.
7. **Per-call override** (`--gateway` / MCP `gateway` enum) end-to-end.
8. **Guidance / docs / route-map defaults** — SKILL.md, amicus_guide, tool descriptions, README, docs. **Hard release-gate, co-shipped** (not cosmetic: today all guidance emits `openrouter/…`, which short-circuits the resolver). Add one early bare-canonical-ID e2e smoke test in Phase 3 so the engine path is proven before guidance lands — resolving the "ships inert" risk without documenting unbuilt behavior.

## Testing Strategy

- **Router matrix** (unit): the full cross-product of {alias source} × {gateway mode} × {key presence} × {catalog state valid/invalid/unknown} × {explicit conflict}.
- **Engine wiring** (integration): resolved route == what `buildProviderModels()` synthesizes, across each family schema (`fallback`), cardless (`routes`), and the two OpenRouter-only families.
- **Error parity**: CLI non-TTY and MCP both emit `model_route_error` with identical suggestion shape.
- **Migration**: both-keys user gets one notice per vendor, then silent; `routing.prefer: openrouter` restores prior behavior; explicit `openrouter/` never notifies.
- **Provenance**: resume/continue preserve the original session's gateway after a key/policy change.
- **Rewrite** config-fallback.test.js to the router's contract (Phase 4).

## Open Risks

- The catalog's cross-gateway ID divergence (dots vs dashes, `:free`) is handled by exact per-namespace string matching, **not** by inferring equivalence. Where a verified mapping doesn't exist, the router does not claim one — it routes by intent and lets the provider validate.
- Registry unification touches many call sites; it ships behind derived compatibility exports to keep the change reviewable phase-by-phase.
