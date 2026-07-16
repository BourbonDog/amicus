# Gateway-Correct Model IDs Design

**Date:** 2026-07-16
**Status:** Proposed — pending review
**Part:** 1 of 2 (bug fix). Part 2 = cost-aware per-provider defaults (separate spec).

## Problem

#61's direct-first canonicalization (Task 8.1a, `toCanonicalDefault`) made each alias resolve to a **single bare id** derived by stripping `openrouter/` off the OpenRouter route. That id is in **OpenRouter's format**, which is wrong for the *direct* provider API whenever the two gateways use different ids for the same model.

Verified against the live catalog (2026-07-16):

| Tier | Direct Anthropic API | OpenRouter | Diverges on |
| --- | --- | --- | --- |
| Opus 4.8 | `claude-opus-4-8` (dashes) | `claude-opus-4.8` (dots) | format |
| Haiku 4.5 | `claude-haiku-4-5-20251001` (dashes + date) | `claude-haiku-4.5` (dots) | format + date suffix |
| Sonnet 5 | `claude-sonnet-5` | `claude-sonnet-5` | — (no dotted version) |
| Fable 5 | *(not served by the direct API today)* | `claude-fable-5` | **availability** |

Consequences on `main` (v3.1.0):
- `--model opus` / `haiku` / `claude` / `sonnet` resolve to `anthropic/claude-opus-4.8` (dots). For a user **with a direct Anthropic key**, the router checks the direct catalog namespace (dashes) → the dot-id is absent → `model_not_found`. **These aliases are broken for direct-Anthropic-key users.** (OpenRouter-only users are unaffected — the dot-id matches OR.)
- `fable` → bare `anthropic/claude-fable-5`; if the direct Anthropic API doesn't serve Fable, direct-key users get `model_not_found` for that too.

Root cause: **a single canonical string cannot be correct across gateways** when the same model has a different id (format) or a different availability per gateway. OpenAI/Google/DeepSeek happen to share ids across both gateways, so only Anthropic is affected *today* — but the fix must be general (any future provider whose gateways diverge).

This is the exact "canonical ids = intent, executable ids differ per gateway / route-specific model resolution" limitation the #61 council review (GPT-5.6-Terra, Major-6) flagged and we explicitly deferred. It has now materialized.

## Design

**Aliases/routes carry per-gateway executable ids, sourced from the live catalog.** A model no longer resolves to one string; it resolves to a small **route object**:

```
{ direct?: 'anthropic/claude-opus-4-8',        // omitted when the model isn't on the direct API
  openrouter: 'openrouter/anthropic/claude-opus-4.8' }
```

- **The catalog is the source of truth.** Each gateway namespace already carries its own native ids (dashes/dates for `anthropic/…`, dots for `openrouter/anthropic/…`). We do **not** hand-type or transform dots↔dashes. Forms are filled from the live catalog and refreshed by `amicus models --refresh` / `--check` (and, in Part 2, at key-add). This satisfies the "catalog-driven" intent without a network hit on every launch — concrete ids are stored, catalog-refreshed.
- **The router emits the chosen gateway's id.** After `resolveRoute` picks a gateway, the executable id is that gateway's form from the route object. Absence of a form means "not available on that gateway."
- **Availability-aware routing.** If the model has no form for the gateway the policy would pick (e.g. Fable direct-unavailable under `auto`/`direct`), route to the gateway that *does* have it, emitting the migration/notice already built in #61. An explicit `--gateway direct` for a direct-unavailable model errors (consistent with the existing `no_direct_integration` shape) rather than silently switching.
- **`amicus models --check` audits both forms** against the live catalog and is wired into CI so drift fails a check (closing the "hand-maintained pins silently rot" gap the audit itself surfaced).

### Interaction with the existing router

`gateway-router.resolveRoute` stays a pure function. The change is: the request carries the per-gateway forms (a `gatewayIds: { direct?, openrouter }` field), and `finish(gateway, …)` builds `executableId` from `gatewayIds[gateway]` when present (falling back to the current `vendor/model` construction for models with no divergence, so OpenAI/Google/DeepSeek and full-id inputs are unchanged). The catalog gate for a gateway checks *that gateway's* id.

### Components

- **`src/utils/curated-models.js`** — route-map entries carry per-gateway forms. FAMILIES already have `fallback: { openrouter, <direct> }`; make that the canonical shape and extend the Anthropic CARDLESS entries (`claude`, `sonnet`, `haiku`, `fable`) with their direct forms (or mark direct-absent). Refresh the stale Anthropic ids to current (Opus 4.8, Sonnet 5, Haiku 4.5 dated, Fable) using the live-catalog values.
- **`src/utils/route-launch.js`** — when resolving an alias, produce the route object (both forms) and thread `gatewayIds` into the router request; on a `resolved` result, `executableId` is already the gateway-correct id.
- **`src/utils/gateway-router.js`** — `finish()` / `catalogGate()` use `req.gatewayIds[gateway]` when provided; unchanged for single-form/full-id inputs.
- **`src/utils/model-fetcher.js`** — refresh the hardcoded `ANTHROPIC_MODELS` offline floor to the current family (Opus 4.8, Sonnet 5, Haiku 4.5, Fable) so offline/keyless users see current models. (Floor rows stay `authoritative:false` per #61 Task 4.3.)
- **`scripts/check-file-sizes.js`/CI** — add `amicus models --check` as a CI gate (fail on stale/divergent default aliases).
- **A catalog helper** — resolve a logical model (a catalog row / family flagship) to its ids in each namespace, matching by the row's normalized name/version across namespaces (used to fill the per-gateway forms at refresh time).

### What stays the same

- OpenAI/Google/DeepSeek aliases (ids identical across gateways) — unchanged behavior; the route object's two forms are just the same id with/without the `openrouter/` prefix.
- Full-id inputs (`--model anthropic/claude-opus-4-8`, `--model openrouter/anthropic/claude-opus-4.8`) — routed as typed (the router already honors explicit literals); no transformation.
- The #61 tri-state catalog / never-block contract, `--gateway`, `routing.prefer`, migration notice — all unchanged.

## Testing strategy

- **Divergence matrix** (unit): opus/haiku (dotted) resolve to `anthropic/claude-opus-4-8` on a direct route and `openrouter/anthropic/claude-opus-4.8` on an OR route; sonnet/fable (non-dotted) resolve correctly; a direct-unavailable model (fable, if direct-absent) routes to OpenRouter under `auto`.
- **Regression**: OpenAI/Google/DeepSeek aliases and full-id inputs are byte-identical to today.
- **Catalog-fill helper**: given a catalog with both namespaces, produces the correct `{direct, openrouter}` pair by name-match; handles a model present in only one namespace.
- **`models --check`**: the refreshed default aliases pass the audit against a fixture catalog; a deliberately-divergent alias fails it.
- **End-to-end (integration, hermetic)**: `--model opus` with a (stubbed) direct Anthropic key routes to the dash-id and is NOT rejected pre-flight.

## Out of scope (Part 2)

Cost preference (`routing.tier`), the per-provider default picker at key-add, vendor-named default aliases, and the existing-user migration prompt. Part 1 only makes the ids gateway-correct + current.

## Open risks

- **Cross-namespace identity match**: filling both forms relies on matching the same model across the `anthropic/…` and `openrouter/anthropic/…` catalog rows (OpenRouter prefixes the display name with "Anthropic:"). The match must be robust (normalize the name, or match on the shared version token) and conservative — if it can't confidently pair a direct id with an OR id, store only the form it's sure of and let the router route to that gateway. Never invent an id.
