# Wizard Live Model Picker — Design (Step 2 + finish-path no-clobber)

**Date:** 2026-06-11 · **Status:** finalized (user-approved in-session)
**Branch:** `fix/wizard-live-model-picker` (collect-locally policy: no push, no PR, no version bump until the user's batch point)

## Problem

Found in the 2026-06-11 real-user setup-wizard run (dev main `c62529c`). Three defects, one screen:

**D1 — Quick picks are a stale hardcoded snapshot.** `src/utils/curated-models.js` CARDS pin Gemini 3.1 Flash Lite, Gemini 3.1 Pro, GPT-5.4, Claude Opus 4.6, DeepSeek v3.2 — generations behind the 394-model live catalog cached next to them. `amicus models --check` reports these "clean" because it audits *existence*, not *currency*: outdated-but-still-listed ids pass. A hand-pinned list re-drifts no matter how carefully it is refreshed; F5's single-source consolidation fixed *where* the ids live, not *when* they age.

**D2 — Step 2 doesn't let the user pick an arbitrary model (in practice).** Cards expose only a provider-route toggle (OpenRouter vs direct), never the model. The F5 search-over-catalog section technically sets any model as default, but failed in practice: hidden until the catalog IPC returns non-empty (`applyCatalog`, `electron/setup-ui.js:384` — `display:none` at 0 models), renders zero rows until a query is typed, unlabeled, and visually subordinate to the radio cards. Observed user outcome: "it isn't letting me pick the models for each of the choices."

**D3 — Finish silently rewrites card aliases with stale curated ids.** The finish handler (`electron/setup-ui.js:337-354`) unconditionally builds `routingOverrides[alias] = mc.routes[prov]` for ALL card aliases; route-pill clicks (`setup-ui.js:281`) write the stale curated id for that provider into `aliasEdits` even when the user's alias was customized; the save handler (`electron/ipc-setup.js:98-106`) rebuilds the table as curated `getDefaultAliases()` + overrides. User deviations survive only via the load-time diff (`setup-ui.js:131`) and only if no pill was clicked. Evidence: the 2026-06-11 run downgraded `gemini` from `google/gemini-3.5-flash` to `google/gemini-3.1-flash-lite-preview` without the user choosing it. The rebuild has a second defect: aliases the user deleted resurrect on every finish.

## User-locked decisions (2026-06-11, in-session)

1. **Step 2 becomes a live picker with smart shortcuts** — quick picks resolve against the live catalog; full-catalog search always visible. (Chosen over "keep cards + add model swap" and "minimal id refresh".)
2. **Selecting a quick pick = set default AND upgrade that one alias** to the resolved id via the chosen route, with the row stating exactly what it writes. **Never write an alias the user didn't touch.** Touch = selecting a quick-pick row (including its route choice) or an explicit Step-3 alias-editor edit. (Chosen over "never touch aliases from Step 2" and "show alias's current target".)

## Design

### 1. Screen (UX contract)

One unified "Choose Default Model" step:

- **Quick-pick rows (top, ~5):** family label + blurb ("Gemini Flash-class — fast, large context"), the live-resolved current model id, provider route pills when ≥2 configured keys cover the family, and an explicit write-preview line on the selected row: `will set gemini → google/<resolved-id>`.
- **Catalog search (below, always visible):** labeled "…or pick any model"; existing meta line (model count + fetched-when) and refresh button retained. Search rows selectable as default (full model id). Never `display:none`: with an empty catalog the section shows the refresh affordance and an offline note instead of disappearing.
- Selection semantics unchanged: quick picks and search rows share one selection (radio behavior; `customDefaultModel` for search picks).

### 2. curated-models v2 — family definitions, not pinned truths

`src/utils/curated-models.js` reshapes from pinned CARDS to **FAMILIES**:

```js
{ alias: 'gemini', label: 'Gemini Flash-class', blurb: 'fast, large context',
  match: { idPattern: /^google\/gemini-.*flash/ },          // over catalog ids
  directProviders: ['google'],
  fallback: { openrouter: 'openrouter/google/<pinned>', google: 'google/<pinned>' } }
```

- **Family set:** the five existing card aliases carry over as families — `gemini` (Gemini flash-class), `gemini-pro` (Gemini pro-class), `gpt` (OpenAI flagship), `opus` (Claude Opus-class), `deepseek` (DeepSeek flagship). Family pinned-fallback ids are refreshed to current as part of this change (same one-time refresh as CARDLESS below).
- **New `src/utils/quick-picks.js`** (keep <300 lines, repo gate): `resolveQuickPicks(catalog)` → per family the top catalog match by the F5 numeric ranking (reuse — extract if needed — the ranking inside `alias-audit.js` `suggestReplacements`). Returns `{ alias, label, blurb, source: 'live'|'fallback', routes }`.
- **Direct-route derivation per provider:** google/openai/openrouter-suffix identical → derive by prefix strip; anthropic → dot→dash transform (`claude-opus-4.6` → `claude-opus-4-6`); deepseek → NOT derivable (own naming scheme) → pinned direct id from `fallback`. Underivable → omit the direct route on live picks (manual via Step 3 remains).
- **CARDLESS list stays pinned** (seed-only aliases) and gets a one-time refresh to current ids in this change.
- **`DEFAULT_ALIASES` stays static** (built from pinned fallbacks). It is runtime-load-bearing — `resolveModel`/`getEffectiveAliases`/`autoRepairAlias` must never wait on the network.
- **`amicus models --check`** gains a non-blocking warning when a pinned fallback has fallen behind the live resolution, so the fallback can't rot silently either.

### 3. IPC + renderer plumbing

- New **`sidecar:get-quick-picks`** handler (main process) returning resolved rows + catalog meta; **must be added to the `electron/preload-setup.js` channel allowlist** (F5 review lesson: a missing allowlist entry leaves the feature dead at runtime).
- Step 2 HTML builders consume resolved rows instead of `getCuratedModels()`; search-section visibility gating removed per §1.

### 4. Finish payload + save semantics (the clobber fix)

- Renderer sends `{ default, aliasWrites }` where `aliasWrites` = `{ [selectedQuickPickAlias]: resolvedIdViaChosenRoute }` ∪ Step-3 `aliasEdits` (including `null` = delete). **No blanket card writes.** Route pills on unselected rows write nothing.
- `sidecar:save-config` becomes **read-modify-write**: `cfg = loadConfig() ?? { aliases: <seed per §5> }`; set `cfg.default`; apply `aliasWrites` (null deletes); `saveConfig(cfg)`. Unknown config keys survive; deleted aliases stay deleted (no defaults rebuild).
- Default value semantics: alias name when a quick pick is selected; full model id when a search row is (F5-verified: `resolveModel` passes `/`-containing ids through).

### 5. Seeding + readline parity

- **First-run seeding** (no existing config): seed aliases from live resolution when the catalog is available, pinned fallbacks otherwise — both the Electron wizard and the readline flow, so fresh installs get current models.
- **Readline fallback flow:** numbered live-resolved quick picks + a free-form "enter any model id" path validated against the catalog (warn, not block, when offline). Existing-config runs become read-modify-write too — the current `createDefaultConfig(chosen)` path is the same clobber class as D3.

### 6. Error handling

No new network paths: everything rides the existing `getCatalogInfo`/`refreshCatalog` (atomic cache writes, floor-only-refresh guard). Catalog empty/offline → quick picks render from pinned fallbacks with an "offline — showing last-known" note; search section stays visible with refresh affordance. Failed refresh is non-fatal (existing behavior; the stale-cache memo remains issue #13, out of scope).

### 7. Testing

- **Unit:** quick-picks resolver (ranking, family match, fallback path, direct-route derivation incl. the anthropic transform and the deepseek pinned case); finish write-set builder; save-config read-modify-write; Step-2 HTML builders.
- **Named regression:** "finish must not rewrite untouched aliases" — reproduces the `gemini` 3.5→3.1 downgrade and proves it cannot recur; companion case for deleted-alias resurrection.
- **CDP e2e** (existing F5 harness): search→select→finish round-trip; selecting a quick pick upgrades exactly that one alias; untouched aliases byte-identical before/after; a Step-3 deletion survives finish.
- Full suite green (baseline 1900 pass / 4 skip / 120 suites); lint clean.

### 8. Acceptance criteria

1. Any catalog model is selectable as default from Step 2; the search section is always visible.
2. Quick picks show current catalog flagships when online; pinned fallbacks with an offline note otherwise.
3. Finish writes only: the default, the selected quick-pick's alias, and explicit Step-3 edits — nothing else (regression-tested against the gemini downgrade).
4. Save is read-modify-write: unrelated aliases, unknown config keys, and deletions all survive.
5. Fresh-install seeding is current-when-online in both flows; the readline flow accepts any validated model id.
6. `sidecar:get-quick-picks` is allowlisted in preload and the feature works at runtime (CDP-verified).
7. Suite green, lint clean; `models --check` reports pinned-fallback drift.

### 9. Out of scope

Step-3 alias editor → catalog IPC (#12; `aliasEdits` passthrough unchanged), stale-cache refresh memo (#13), GUI logging/productName (separate test-run finding), shim removal (#19), any publish/version work (collect-locally).

### 10. Remediation (user config, not a code deliverable)

The 2026-06-11 run downgraded `gemini`; restore `gemini → google/gemini-3.5-flash` (last documented pre-clobber value) via `amicus setup --add-alias` immediately. `gemini-pro`/`gpt`/`opus` have no reliable pre-clobber evidence (config backup predates later intentional changes) and their current values are valid — the user re-points them in the new picker.

## Open questions

None — resolved in-session 2026-06-11 (see User-locked decisions).
