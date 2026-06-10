---
title: F5 — Dynamic OpenRouter Model Catalog — Design Spec
date: 2026-06-10
status: implemented (2026-06-10 — suite 1847 total / 1843 pass / 4 skip / 0 fail, lint clean, live CLI + sandboxed wizard CDP e2e passed; real-session smoke on picker default)
owner: BourbonDog
references:
  - docs/superpowers/specs/2026-06-07-amicus-product-design.md (§6 F5, §5 component 5)
  - docs/superpowers/specs/2026-06-09-f3-process-and-aliases-design.md (catalog cache + validation foundation)
  - docs/superpowers/specs/2026-06-09-f4-fanout-json-design.md (result-schema JSON conventions)
supersedes: none
---

# F5 — Dynamic OpenRouter Model Catalog

> **Implemented 2026-06-10** (branch f5-exec, subagent-driven: 10 tasks, two-stage review per task)
>
> Shipped surface:
> - curated-models single source ×3 consumers (config defaults, wizard cards, alias-audit)
> - keyless enriched fetcher (OpenRouter public endpoint; context + pricing in cache)
> - cache v2 atomic + floor-only guard (schemaVersion 2; v1 auto-migrates)
> - alias-audit dedup + numeric ranking (`amicus models --check`, 47 aliases clean)
> - `amicus models` command (table / --search / --check / --refresh / --json)
> - catalog IPC + preload allowlist + warm seed (Electron; `sidecar:get-catalog` / `sidecar:refresh-catalog`)
> - searchable wizard picker w/ round-trip (CDP-verified: grok search → select → config written; restore on relaunch confirmed)
> - setup seeding both flows (Electron + readline) + add-alias suggestions
> - continue/resume validation split (explicit `--model` validates like start; inherited models warn, never block)
>
> Follow-ups: (a) `openai/gpt-5.4` direct route unverified (no OPENAI key on dev machine; backstopped by `models --check` once a key exists); (b) worktree husky hooks don't fire — investigate repo-side (hooks gates run manually this branch); (c) wizard Step 3 alias editor still uses live fetch-models (migration to catalog deferred); (d) failed-refresh memo to avoid repeated 5s timeouts offline.

## 1. Summary

F5 makes the model list a living thing: synced from provider APIs (OpenRouter
first-class), cached locally, and consumed by every surface — CLI resolution
and validation, a new `amicus models` command, the setup wizard's model
picker, and a stale-alias audit — so **no manual alias-file editing is ever
required for new models**.

F3 pre-built the foundation: the TTL cache (`~/.config/amicus/model-catalog.json`,
24 h), graceful catalog validation on `start`/`fanout` (`--no-validate-model`
opt-out), and `scripts/refresh-model-capabilities.js` behind three npm scripts.
F5 is the product layer on top, organized around one principle — **the catalog
is the spine**: a single enriched cache feeds everything, and a single curated
module feeds every hardcoded default.

Approach chosen 2026-06-10 ("catalog as the spine") over a live-fetch-UI split
(permanent divergence between what the picker shows and what validation
checks) and a minimal-floor variant (would have left the drift disease and no
searchable picker).

## 2. Goals (acceptance criteria)

From the product spec §6 F5, plus decisions locked with the owner 2026-06-10:

1. `amicus models --refresh` updates the catalog from provider APIs.
2. New models appear in `--model` resolution (full-ID pass-through validated
   against a fresh catalog) and in the GUI picker.
3. First-run `setup` seeds the catalog automatically.
4. No manual alias-file editing required for new models.
5. **Searchable live picker** (owner upgraded scope 2026-06-10 after the GUI
   became verifiable in-session): wizard Step 2 gains search over the full
   catalog, grouped by provider, with context/pricing per row; curated cards
   remain as quick picks.
6. **Report + suggest** stale-alias handling: audit ALL alias sources, suggest
   same-vendor replacements from the catalog, emit ready-to-paste fix commands.
   No silent rewrites (reproducibility: an alias must not change meaning
   between council runs).
7. **Metadata enrichment**: cache stores `contextLength` and `pricing` where
   the provider reports them.
8. The two hand-maintained default lists (`DEFAULT_ALIASES` in
   `src/utils/config.js` vs `MODEL_CHOICES` in `electron/setup-ui-model.js`)
   are replaced by derivations of ONE curated module. (They have already
   drifted: `gpt` → `gpt-5.2-chat` in the wizard vs `gpt-5.4` in defaults;
   `gemini` → `gemini-3-flash-preview` vs `gemini-3.1-flash-lite-preview`.)

Non-goals (tracked follow-ups, not F5): MCP `amicus_models` tool (the council
skill can shell out to `models --json`); README/docs refresh (F7); MODEL-NOTES
stale-GUI claim removal (goes with the council-skill rewrite); auto-repair of
stale aliases.

## 3. Current state (audited 2026-06-09/10)

- `src/utils/model-catalog.js` — cache v1 `{fetchedAt, models:[{id,name}]}`,
  24 h TTL, stale-fallback, never blocks a launch.
- `src/utils/model-fetcher.js` — openrouter/google/openai fetchers + hardcoded
  Anthropic list; **only fetches providers that have keys** (OpenRouter's
  `/api/v1/models` is actually public); returns bare `{id, name}`.
- `src/utils/model-validator.js` — `validateAgainstCatalog` (openrouter/*) +
  `validateDirectModel`; wired into `start` + `fanout` only. MCP
  `amicus_start`/`amicus_continue` validate eagerly; **CLI `continue`/`resume`
  do not** (tracked F3 follow-up).
- `scripts/refresh-model-capabilities.js` — refresh/info/check over DEFAULT
  aliases only (not user config, not wizard routes); npm-script only, so
  installed users have no access.
- No `models` CLI command. `setup` never seeds the catalog. Wizard Step 2 is
  a static 5-card list. `scripts/list-models.js` is a legacy CDP scraper of
  the OpenCode GUI — superseded, delete in F5.

## 4. Design

### 4.1 `src/utils/curated-models.js` (new — single source of truth)

`CURATED_MODELS: [{alias, label, blurb, routes: {provider: modelId, ...}}]`
— the editorial list of recommended defaults (one entry per current
MODEL_CHOICES card, IDs corrected against the live catalog at implementation
time). Exports:

- `getCuratedModels()` — the list (used by the wizard for quick-pick cards).
- `toDefaultAliases()` — `{alias: preferredRoute}` map, openrouter route
  preferred (used by `config.js` to build `DEFAULT_ALIASES`).

`config.js` keeps exporting `getDefaultAliases()` with identical semantics
(derived now); `setup-ui-model.js` keeps its `MODEL_CHOICES` shape (derived
now). Aliases beyond the curated set (e.g. niche entries currently only in
DEFAULT_ALIASES) move into the curated module with `cardless: true` so the
wizard can skip them but alias derivation keeps them.

### 4.2 Fetcher: keyless OpenRouter + enrichment

- OpenRouter fetch runs **even with no key** (Authorization header attached
  only when a key exists). A fresh, key-less install gets a full catalog.
- Normalizers return `{id, name, contextLength, pricing}`:
  - openrouter: `context_length`, `pricing.prompt`/`pricing.completion`.
  - google: `inputTokenLimit` → contextLength when present; pricing null.
  - openai/anthropic: nulls (no trivial source).
- `fetchAllModels(keys)` always includes openrouter + anthropic; keyed
  providers add on.

### 4.3 Cache schema v2

`{schemaVersion: 2, fetchedAt, models: [enriched rows]}`. `readCache()`
treats a v1 cache (no `schemaVersion`) as stale → next `getCatalog()`
refreshes and rewrites v2; corrupt-file recovery unchanged. Public API
(`getCatalog`, `refreshCatalog`, `catalogPath`) unchanged.

### 4.4 `src/utils/alias-audit.js` (new — report + suggest)

- `collectAliasSources()` — `[{alias, model, source}]` from derived defaults,
  user `config.aliases`, and curated routes (every provider route, so a stale
  google route is caught too — not just openrouter).
- `findStaleAliases(sources, catalog)` — entries whose model id is absent
  from the catalog (openrouter/* checked against openrouter rows; direct
  provider ids checked only when that provider's rows are present in the
  catalog — no false stales for unkeyed providers).
- `suggestReplacements(staleModel, catalog, n=3)` — same-vendor candidates
  (`openrouter/x-ai/*` for a stale `openrouter/x-ai/grok-4.1-fast`), ranked
  by deterministic id-similarity (shared prefix length, then lexicographic
  descending so newer versions sort first). Pure functions, no I/O.
- Supersedes the `findStaleAliases` copy in `refresh-model-capabilities.js`
  (that script is deleted in 4.5; the audit logic's only home is this module).

### 4.5 CLI: `amicus models`

New route in `bin/amicus.js` → handler in `src/sidecar/models.js` (< 300
lines, size-gate compliant):

- `amicus models` — table: alias-marked curated rows first, then the catalog
  (id, name, context, $/Mtok where present). `--search <q>` filters by
  substring over id+name.
- `amicus models --refresh` — force refresh; prints count + cache path.
- `amicus models --check` — the audit: stale rows with suggestions and
  ready-to-paste `amicus setup --add-alias <alias>=<model>` lines. Exit code
  = stale count (capped at 100); 0 = clean. "Catalog unavailable" → exit 0
  with a warning (matches validator's never-block philosophy).
- `--json` on all three: documents via new `buildCatalogDoc`/`buildAuditDoc`
  in `src/utils/result-schema.js` (`schemaVersion: 1`, `kind:
  'model-catalog' | 'alias-audit'`), pure stdout including throw paths
  (F4 conventions).
- npm scripts `refresh-models`/`models:info`/`models:check` become wrappers
  of the CLI command (`node bin/amicus.js models --refresh` etc.);
  `scripts/refresh-model-capabilities.js` and `scripts/list-models.js` are
  deleted.

### 4.6 Wizard Step 2: searchable live picker

- **Quick picks**: today's cards, now built from `getCuratedModels()`
  (availability/route-pill behavior unchanged).
- **Search section** (rendered only when the catalog is non-empty): text
  input + provider-grouped result list (name, id, context, pricing).
  Filtering is client-side JS over a JSON payload injected at build time —
  no per-keystroke IPC. Selecting a row sets the default model to that full
  id (no alias invented); selecting a card keeps today's alias semantics.
- **IPC** (in `electron/ipc-setup.js`, existing `sidecar:` namespace):
  `sidecar:get-catalog` → `getCatalog()` rows + fetchedAt;
  `sidecar:refresh-catalog` → `refreshCatalog()`. The wizard refreshes after
  Step 1 saves keys (see 4.7) and behind an explicit refresh control in
  Step 2. The old `sidecar:fetch-models` live-fetch handler is removed once
  implementation confirms the picker is its only consumer (grep first); if
  another flow uses it, it stays and only the picker migrates to the cache.
- HTML builders stay pure functions in `setup-ui-model.js` (unit-testable);
  page-script behavior verified live via CDP.

### 4.7 Seeding

After API keys persist — Electron path (`ipc-setup.js` save handler) and
readline fallback (`src/sidecar/setup.js`) — setup awaits `refreshCatalog()`
(5 s fetch timeout already enforced by the fetcher; offline → empty result,
silent, stale/empty cache stands). `setup --add-alias name=model` warns (not
blocks) when `model` is absent from the catalog.

### 4.8 CLI `continue`/`resume` validation (owner-approved line item)

Both run the same graceful catalog validation as `start` before launching
(warn + proceed-blocking semantics identical to `start`'s current behavior,
`--no-validate-model` honored). Closes the F3 follow-up drift gap.

## 5. Data flow

- **Refresh**: keys → `fetchAllModels` (keyless OR + keyed providers) →
  enriched rows → cache v2 → all consumers.
- **Picker**: wizard → `sidecar:get-catalog` → cached rows + curated quick
  picks → selection → existing config save flow (`default` / aliases).
- **Audit**: `models --check` → catalog + all alias sources → stale rows +
  suggestions → human table or `--json` doc; exit code signals staleness.
- **Resolution** (unchanged): alias → config/curated-derived map; full ids
  pass through; validation consults the same cache.

## 6. Degradation & error handling

- **Offline / all fetches fail**: `refreshCatalog` returns `[]`, stale cache
  stands (existing). Empty catalog → picker hides search and shows cards
  only; validation no-ops; `--check` reports "cannot check" (exit 0).
- **v1 cache on disk**: read as stale, auto-migrated by next refresh.
- **Corrupt cache**: existing recover-by-refetch path unchanged.
- **No keys at all**: keyless OpenRouter still yields a full catalog (new);
  Anthropic hardcoded list still appended.

## 7. Testing & verification

- **Unit (TDD per task)**: curated derivations (every wizard card's routes
  and every derived default alias trace to the same curated entry — the
  anti-drift property; cardless entries appear in aliases only); keyless OR
  header logic;
  enrichment mapping per provider; v1→v2 migration + corrupt recovery;
  audit source collection / stale detection (unkeyed-provider no-false-stale)
  / suggestion ranking against a grok-delisting fixture; `models` output,
  exit codes, `--json` schema docs; wizard HTML builders (cards + search
  list + empty-catalog hiding); IPC handlers (mocked catalog).
- **Live on this machine** (GUI now verifiable in-session — CDP probes,
  screenshots, `Get-Process` window checks): launch `amicus setup`, drive
  the wizard search ("grok" → rows appear → select → config written);
  `amicus models --check` against the live catalog; real `start` using a
  picker-chosen default.
- **Gates**: full unit suite green (baseline 1780 tests / 1776 pass / 4 skip
  after PR #6) + `npm run lint` clean; pre-push suite gate.

## 8. Decisions log (owner, 2026-06-10)

1. GUI picker: upgraded to **searchable live picker** after the Electron
   investigation made GUI work verifiable in-session (initial pick was
   data-layer-only under the old untestable premise).
2. Stale aliases: **report + suggest**, never auto-repair.
3. Metadata: **yes** — context + pricing in cache v2.
4. Approach: **catalog as the spine** over live-fetch-UI split and minimal
   floor.
5. Line items approved: delete `scripts/list-models.js`; fold in CLI
   `continue`/`resume` validation.
