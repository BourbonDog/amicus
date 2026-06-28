# Free OpenRouter Council — Design

_Status: drafted 2026-06-28 (brainstormed with user; 4 decisions locked via AskUserQuestion).
Hardened by a 6-dimension adversarial multi-agent review against the codebase (21 findings
confirmed + folded in; see §7). Base: local `main` `b9a3b06` (v1.3.0). This is the
"council presets / saved bench" follow-up explicitly deferred by the 2026-06-24 Council/Fan-out UX
MVP. Git policy: author + commit to local `main`; push deferred to owner (local-first cadence)._

## 1. Problem & intent

A "council" in Amicus is not a stored object — it is an `amicus fanout --models <a,b,c>` wave
(`src/cli-handlers-run.js:103` `handleFanout`; `src/sidecar/fanout.js:109` `runFanout`) or the
`second-opinion` skill assembling that models list at call time. Setup (`src/sidecar/setup.js`)
configures API keys, one **default** model, and the **alias table**
(`~/.config/amicus/config.json` = `{ default, aliases }`).

The barrier to trying a multi-model council is **cost + decision friction**: a new user must pick
several paid models and accept per-run spend before they see any value. OpenRouter publishes a
roster of **free** models (`:free`-suffixed ids) reachable with nothing but an
`OPENROUTER_API_KEY`. There is currently no path that turns those into a ready-to-run council.

Intent: **add a setup option that stands up a zero-cost council of free OpenRouter models**, saved
as a first-class config primitive, runnable from the skill and from raw `fanout` (CLI + MCP). The
user still needs an OpenRouter key but incurs no model spend. The feature must degrade honestly:
free models churn, rate-limit, and are quality-variable, so the design surfaces those realities at
setup time and at run time rather than presenting a fragile council as solid.

## 2. Locked decisions (from brainstorm)

1. **Council shape = aliases + a saved council group.** Setup seeds `free-*` aliases AND writes a
   new `councils` map to config (`councils.free = [alias, …]`). Members are stored as **alias
   names** (DRY — they resolve through existing alias logic; users edit the route in one place).
2. **Model source = live catalog, user picks.** Setup scans the live model catalog for free
   OpenRouter models, presents them, and lets the user choose which to include (with a diverse
   default pre-selection across vendors). A pinned curated list is the offline fallback only.
3. **Surfaces = both CLI (readline) wizard and the Electron GUI wizard** — full parity.
4. **Consumption = skill + CLI/MCP preset flag.** The `second-opinion` skill learns to read
   `councils.free`; `amicus fanout --council <name>` and the `amicus_fanout` MCP tool expand a saved
   council into its models list.

**Revised after review:** the free-council setup **does not modify `config.default`** on either
surface (see §7-E). The deliverable is the council; the global default is left untouched.

Out of scope (YAGNI): a non-interactive `amicus setup --free-council` flag (decision 3 chose GUI
parity over the flag); auto-syncing the separate non-git `~/.claude/skills/second-opinion` copy
(flagged for manual sync); retry-subset / durable run lineage; an Electron council dashboard; an
active per-model reachability probe at setup (documented as a follow-up in §6); the headless
mid-stream-429 producer fix (pre-existing, documented in §6).

## 3. Architecture

Six units. New leaf modules are pure and unit-testable; the wizards and consumers are thin wiring
over them. The council trust spine (`src/council/*`) and `runFanout`'s wave logic are unchanged —
only the models list reaching them changes, plus one robustness fix to `createDefaultConfig`.

| Unit | New / changed code | Interface |
|---|---|---|
| A. Free-model detection | NEW `src/utils/free-models.js` | `isFreeModel(row)`, `listFreeModels(catalog)`, `suggestFreeCouncil(catalog, n)` |
| B. Council config primitive | `src/utils/config.js` (council read/validate + `createDefaultConfig` RMW fix); `src/sidecar/setup.js` (`seedFreeCouncil`) | `getCouncils()`, `getCouncil(name)`, `resolveCouncilMembers(name, catalog)`; `seedFreeCouncil(picks)` |
| C. Readline wizard option | `src/sidecar/setup.js` (`runReadlineSetup` branch) | mode prompt → free-model multi-pick → seed aliases + `councils.free` |
| D. Electron wizard section | NEW `electron/setup-ui-council.js` (+ client script); `electron/setup-ui.js` (Step-2 mount + Review); `electron/ipc-setup.js` (`fetch-free-models`, extend `save-config`) | collapsible "Free OpenRouter council" picker on the Models step |
| E. Fanout preset (CLI) | `src/cli-handlers-run.js` (`handleFanout`); `src/cli.js` (help + arg) | `amicus fanout --council <name>` (mutually exclusive with `--models`) |
| F. Fanout preset (MCP) + skill | `src/mcp-tools.js` (schema), `src/mcp-server.js` (`amicus_fanout` handler); `skills/second-opinion/*` | `amicus_fanout` optional `council` param; skill reads `councils.free` |

### Unit A — Free-model detection (`src/utils/free-models.js`)

Catalog rows are `{ id, name, contextLength, pricing }` where OpenRouter ids are
`openrouter/<vendor>/<model>` and the `:free` suffix is preserved end-to-end
(`src/utils/model-fetcher.js:33-44`).

- `isFreeModel(row)` → `true` when `row.id` starts with `openrouter/` **and** ends with `:free`.
  **The `:free` suffix is authoritative** — it is OpenRouter's explicit free-tier convention.
  A zero-`prompt`/`completion`-price heuristic is **deliberately NOT used**: the normalizer keeps
  only `{ prompt, completion }` and discards `request`/`image`/`web_search` pricing
  (`model-fetcher.js:40-42`), so a model with `prompt:'0'` that charges per request would be
  mislabeled free (review finding #17). Using `:free` alone avoids that class of error. If
  price-based detection is ever wanted, the normalizer must first be extended to carry the full
  pricing object and all fields checked — tracked as a follow-up, not in this change.
- `listFreeModels(catalog)` → `isFreeModel`-filtered rows, sorted by vendor then id.
- `suggestFreeCouncil(catalog, n = 3)` → up to `n` free models across **distinct vendors** (one per
  vendor segment) for the wizard's default pre-selection; diversity beats raw count for a council.

Pure, network-free, fully unit-testable over fixture rows.

### Unit B — Council config primitive (`src/utils/config.js`, `src/sidecar/setup.js`)

Config schema gains an optional `councils: { [name]: string[] }`. `saveConfig` already deep-writes
arbitrary top-level keys (`config.js:65`; its cleaning pass only walks `aliases`).

**`createDefaultConfig` RMW fix (review finding #2).** Today `createDefaultConfig`
(`setup.js:47-58`) builds a brand-new `{ default, aliases }` and `saveConfig`s it **unconditionally**
— a full-file clobber and the codebase's only non-read-modify-write writer. It runs in the Electron
completion path (`runInteractiveSetup`, `setup.js:250-253`) and would drop a `councils` map the
wizard just wrote. Fix it to read-modify-write so it can never drop unknown top-level keys:
`const existing = loadConfig() || {}; const cfg = { ...existing, default: existing.default ||
defaultModel, aliases: { ...getDefaultAliases(), ...(existing.aliases || {}) } }; saveConfig(cfg)`.
This preserves the fresh-install behavior (existing tests pass) and removes the lone clobber
primitive rather than relying on call-order luck.

New helpers:
- `getCouncils()` → `loadConfig()?.councils || {}`; `getCouncil(name)` → `getCouncils()[name] || null`.
- `resolveCouncilMembers(name, catalog)` → `{ models: string[], dropped: string[] }` or `{ error }`.
  Errors: **unknown council**, **empty council**. Otherwise it expands the member list and
  **gracefully degrades** (review findings #12/#15): each member is first **resolved to its full
  model id** (alias → id via the effective aliases; a member already containing `/` is taken as-is)
  and that **id** checked against the **cached** catalog (sync, no network). Members that no longer
  resolve (a deleted alias) or whose id isn't listed (a delisted `:free` model) are **dropped into
  `dropped[]` with a warning** instead of fail-fast-aborting the whole wave.
  If **fewer than 2** members survive (a council needs ≥2 for cross-review) it returns an `error`
  pointing at `amicus setup`. Members that survive are returned raw (alias or id); leg-time
  resolution via `validateFanoutModels` is unchanged.

**`seedFreeCouncil(picks)`** (in `setup.js`, the shared seam for C and D's IPC): given chosen
catalog ids, it is a **single atomic read-modify-write** (one `loadConfig` → mutate → one
`saveConfig`; review finding #21):
- **Collision-safe alias derivation (review findings #6/#9).** Derive each alias from the full
  model slug, not the vendor: strip `openrouter/` and the trailing `:free`, replace `/` and `:`
  with `-`, prefix `free-` → e.g. `openrouter/deepseek/deepseek-r1:free` → `free-deepseek-r1`. Track
  derived names in a Set; on a within-batch collision append a numeric suffix (`-2`). N picks always
  yield **N distinct aliases and N distinct `councils.free` members**. Keep the existing
  no-clobber-of-pre-existing-aliases rule on top.
- Write `councils.free = [those aliases]` (deduped) and the new aliases. **Do not touch
  `config.default`** (review findings #7/#8/#19 — see §7-E).

**Free routing safety:** `resolveModel` runs `applyDirectApiFallback` (`alias-resolver.js:17`),
which strips `openrouter/` only when `OPENROUTER_API_KEY` is **absent** AND a direct provider key
exists — which would route a `:free` id to a paid direct API that rejects the `:free` suffix. The
free council requires the OpenRouter key (enforced in C/D), so this is avoided; it is also why we no
longer set `config.default` to a `:free` alias (a later OR-key removal would otherwise silently
break solo runs). Documented in §6.

### Unit C — Readline wizard option (`src/sidecar/setup.js`)

At the top of `runReadlineSetup` (after key detection, `setup.js:174`), present a mode prompt:

```
How do you want to set up?
  1) Standard — pick a default model
  2) Free OpenRouter council — a zero-cost council of free models
```

Default branch = existing flow verbatim. (Note: `runReadlineSetup` is the headless fallback;
`runInteractiveSetup` is Electron-first — the mode prompt appears only when the GUI isn't used.)
Free branch:
1. Require `OPENROUTER_API_KEY` (from `detectApiKeys`); if missing, explain it is required and
   return to the standard prompt with **no writes**.
2. `getCatalog()` → `listFreeModels`. If empty (offline / none), fall back to a small pinned free
   list and say so.
3. Print a numbered list (id · ctx · "free"), with `suggestFreeCouncil` pre-marked as the default.
   Accept comma-separated numbers, or Enter to take the default selection. An invalid/empty
   selection returns without writes (matching the existing invalid-choice early return).
4. `seedFreeCouncil(chosenIds)` (single atomic write); `seedCatalog()`; print the resulting
   `councils.free`, the seeded aliases, runnable usage (`amicus fanout --council free --prompt …`),
   and the **free-tier prerequisite + caveats** (§6): OpenRouter privacy/data-sharing setting,
   rate limits, variable quality. `config.default` is explicitly left unchanged (say so).

### Unit D — Electron wizard section (`electron/`)

A collapsible **"Set up a free OpenRouter council"** section on the existing **Models** step
(`wizard-step-2`), reusing the catalog already loaded there (`ensureCatalogLoaded`,
`setup-ui.js:403`). No step renumbering; the user still picks a normal default model on this step
(the council is additive and does not alter the default — review finding #7).

- NEW `electron/setup-ui-council.js`: `buildCouncilSectionHTML()` + `buildCouncilScript()` (a
  checkbox list filtered to free models via `listFreeModels`, diverse default pre-checked).
- **Key-gating (review finding #20):** disable the section unless `configuredKeys.openrouter` is
  truthy, and **recompute that state on Step-2 entry** (inside the `showStep(2)` path, alongside
  `updateRoutingPills`) — not once at render — because `configuredKeys` loads asynchronously and
  starts `{}`.
- `electron/setup-ui.js`: mount the section in Step 2; the Review step (Step 4) shows the chosen
  council; the Finish handler includes the council seed in the save payload. The default-model radio
  is unaffected.
- `electron/ipc-setup.js`: NEW `sidecar:fetch-free-models` (catalog → `listFreeModels`); extend
  `sidecar:save-config` (`ipc-setup.js:100`) with an **optional third arg** (the council seed) that
  calls `seedFreeCouncil`. Back-compat: omitting it preserves today's behavior exactly. Because
  `createDefaultConfig` is now RMW (Unit B), the council survives the `runInteractiveSetup`
  completion path even though the GUI still writes a default model.

### Unit E — Fanout preset, CLI (`src/cli-handlers-run.js`, `src/cli.js`)

`handleFanout` gains `--council <name>`:
- **Validate the value is a non-empty string** (review finding #16): the custom parser yields
  boolean `true` for a bare/value-less `--council` (`cli.js:85-86`); reject that with a clear error.
- Exactly one of `--models` / `--council` (error if both, error if neither — replacing the current
  "`--models` is required" check at `cli-handlers-run.js:111`).
- `--council` → `resolveCouncilMembers(name, catalog)`; on error, `failJson(BAD_ARGS, …)` pointing
  at `amicus setup`; surface any `dropped[]` members as a warning. On success, set `args.models` to
  the joined survivor list and fall through to the unchanged validation + `runFanout` path
  (`runFanout` already enforces the leg cap in-process). `src/cli.js:357` ("Options for 'fanout'")
  documents the flag.

### Unit F — Fanout preset, MCP + skill

**MCP handler (review findings #1/#3/#4/#5 — the blocker).** The `amicus_fanout` MCP handler does
**not** run `runFanout` in-process — it builds a `fanout` argv and spawns the CLI subprocess
(`mcp-server.js:554-566`), and it reads `input.models` at **three** pre-spawn sites:
`deriveLegIds(waveId, input.models.length)` (:536), the `models:` field in the pre-written
`metadata.json` (:548), and `'--models', input.models.join(',')` (:555). Required changes:
1. `src/mcp-tools.js`: `amicus_fanout` gains optional `council: z.string()`; `models` becomes
   `.optional()`; a refine enforces "exactly one of models/council".
2. `src/mcp-server.js`: at the **top** of the handler, resolve a single `effectiveModels` array —
   `input.council ? resolveCouncilMembers(input.council, catalog).models : input.models` — and
   **re-apply the leg cap** (`AMICUS_FANOUT_MAX_LEGS` → `DEFAULT_MAX_LEGS=10`, reusing the
   `fanout.js` logic) **before** any `mkdir`/`metadata` write. On unknown/empty/over-cap council or
   `<2` survivors, return the standard MCP error shape (`textResult(msg, true)`, matching :551/:574)
   **before** the wave dir exists — preventing an orphaned `status:'running'`, pid-less wave that the
   crash-detection branch (gated on a pid, :281) can never reconcile. Then route **all three**
   pre-spawn sites through `effectiveModels` (:536 `.length`, :548 `models:`, :555 `.join(',')`).
   The subprocess receives **only** `--models <expanded>`, never `--council`.
3. `skills/second-opinion/SKILL.md` + `MODEL-NOTES.md`: see below.

**Skill consumption (review findings #11/#13/#14).** When the user asks for a "free council" /
"zero-cost council", the skill reads `councils.free` and runs `amicus fanout --council free`. It
must also handle the free-tier realities the bench machinery assumes away:
- **Cost gate:** at ~$0 the budget gate is a no-op; skip the paid-run cost framing.
- **No reliability history (#13):** free models have no `amicus council stats` / `MODEL-NOTES`
  record, so Stage-0 bench recommendation and Stage-3 **chair** selection can't rank on street-cred.
  Guidance: pick the most capable free model as chair, state that confidence is lower, and don't
  present stats-based rankings that don't exist.
- **Weak structured output (#14):** small free models are less reliable at the strict sequential-id
  findings JSON `validateFindings` requires (`findings.js:34-43`); expect more repair-loop hits.
- **Rate-limit / truncation guard (#11):** a mid-stream 429 can yield a leg marked `complete` with a
  truncated, unparseable review. When a free-council leg is `complete` but `validateFindings` returns
  `NO_FENCED_BLOCK`/`NOT_PARSEABLE`, treat it as a **suspect/throttled** leg — don't burn the 2-retry
  repair loop on the same throttled model; disclose it and apply the existing
  ≥2-reviews-survive wave-degrade rule.
- **Prerequisite, not footnote (#10/#18):** state up front that free models require enabling
  data-sharing in OpenRouter privacy settings or legs 404 at run time (catalog-membership validation
  cannot catch this). Add a short free-tier section to `MODEL-NOTES.md`.

## 4. Testing

TDD per unit (house pattern; gates: `npm test`, `lint`, `check:secrets`, `check:sizes`,
`generate-docs:check`).

- **A** `free-models.test.js`: `:free` suffix true; non-`:free` (incl. `prompt:'0'`) false;
  non-openrouter excluded; `listFreeModels` sort; `suggestFreeCouncil` vendor-diversity + `n` cap +
  empty-catalog.
- **B** config round-trip preserves `councils`; `getCouncil`/`resolveCouncilMembers` for present /
  unknown / empty / member-delisted-drops-with-warning / `<2`-survivors-errors; `seedFreeCouncil`
  **two same-vendor picks → two distinct aliases + two distinct `councils.free` members**,
  no-clobber of pre-existing aliases, single-write atomicity, **does not set `config.default`**;
  **`createDefaultConfig` RMW preserves an existing `councils` map** (regression for #2).
- **C** readline free branch over mocked catalog + stdin: writes expected aliases + `councils.free`,
  leaves default unchanged; missing-key aborts with no writes; invalid selection no writes; offline
  pinned-fallback path.
- **D** `buildCouncilSectionHTML` asserts (free rows only, default pre-check, disabled without
  openrouter key); extended `sidecar:save-config` IPC persists council writes and is back-compat
  without the third arg; council survives the `runInteractiveSetup` completion path.
- **E** `handleFanout`: `--council free` expands to survivors; both-args / neither-arg / unknown-name
  / bare-`--council`(boolean) / `<2`-survivors errors via `failJson`; `dropped[]` warned.
- **F** `amicus_fanout` schema accepts council-only, rejects both/neither; handler expands, re-applies
  the cap, and on unknown/empty/over-cap council returns an error **without** creating a wave dir
  (regression for the orphan-wave finding); all three pre-spawn sites use `effectiveModels`. Skill
  change is doc-only (covered by the acceptance smoke).
- **Integration smoke:** with a real `OPENROUTER_API_KEY`, run `amicus fanout --council free
  --prompt …` (a 2–3 leg free wave) and confirm legs complete at ~$0; if feasible, also exercise the
  privacy-gate error path against an account **without** data-sharing enabled (else assert the
  wizard/skill surfaces the guidance) — the author's configured account will not hit it (#10).

## 5. Acceptance criteria

1. `amicus setup` (readline) offers the free-council option; choosing it writes collision-safe
   `free-*` aliases + `councils.free`, leaves `config.default` unchanged, and prints runnable usage
   + the free-tier prerequisite.
2. The Electron Models step offers an equivalent free-council picker (gated on the OpenRouter key);
   Finish persists `councils.free` (surviving the completion path) without altering the chosen
   default model.
3. `amicus fanout --council free` runs the saved council; `--models`/`--council` are mutually
   exclusive; bad/over-cap/under-2 councils fail cleanly with guidance.
4. `amicus_fanout` accepts a `council` param over MCP (no Bash), expands + caps it **before** writing
   any wave record, and never strands a `running` orphan wave.
5. The `second-opinion` skill recognizes a free-council request, uses `councils.free`, handles
   missing reliability data + truncated/throttled legs, and discloses the privacy-gate prerequisite.
6. Full suite + lint + secrets + sizes + docs gates green; real-LLM free smoke passes at ~$0.

## 6. Risks & follow-ups

- **Free roster churn / delisting.** A delisted `:free` member would otherwise fail-fast-abort the
  whole wave; `resolveCouncilMembers` now drops it with a warning and errors only if `<2` survive.
  Re-running setup re-picks from a fresh catalog; `amicus models --check` audits routes.
- **Rate limits.** Free models share a heavily throttled daily pool; a 3-leg parallel wave +
  cross-review can hit limits. Disclosed in the wizard + skill; the skill's truncation guard (#11)
  keeps a throttled, truncated leg from masquerading as a clean review.
- **OpenRouter privacy gate.** Some free models 404 unless the account enables prompt-training /
  data-sharing. This is a **run-time per-leg failure that catalog-membership validation cannot
  catch** — surfaced as a prerequisite in the wizard, `MODEL-NOTES.md`, and the skill, not a footnote.
- **No OpenRouter key = no free council.** Enforced in the wizard (C/D) and noted for the skill.
- **`config.default` deliberately untouched.** Avoids silently rewiring solo runs to a rate-limited
  model and the direct-API-fallback breakage when the OR key is later removed (#8/#19). Users wanting
  free solo runs select a free model as their default via the standard step.
- **Follow-ups (not this change):** an active per-model reachability probe at setup (turns
  privacy-gate 404s into a setup-time error); the headless mid-stream-429 producer fix (a leg with
  partial output + captured `sessionError` is currently classed `complete` — pre-existing,
  `headless.js:520-542`); a non-interactive `--free-council` flag; named councils beyond `free`
  (the primitive already supports them); an Electron council-management UI.

## 7. Adversarial review summary (folded in)

A 6-dimension review (config-schema, fanout-cli-mcp, free-detection, electron-wizard, readline-setup,
skill-consumption), each finding independently verified by skeptics, confirmed 21 issues. Resolutions:

- **A (MCP crash, blocker #1/#3/#5):** single `effectiveModels`, expand in-process, error-before-write,
  all three pre-spawn sites routed through it; subprocess gets `--models` only. → Unit F.
- **B (leg-cap bypass / orphan wave #4):** re-apply the cap pre-flight before any wave write. → Unit F.
- **C (config clobber #2):** `createDefaultConfig` → read-modify-write. → Unit B.
- **D (alias collisions #6/#9):** full-slug, deduped alias derivation. → Unit B.
- **E (auto-default harm #7/#8/#19):** drop default-setting entirely. → §2 / Unit B.
- **F (free-tier runtime failures #10/#11/#12/#18):** graceful member-drop, skill truncation guard,
  load-bearing privacy-gate guidance. → Units B/F, §6.
- **G (skill reliability gaps #13/#14):** chair-without-stats + weak-structured-output guidance. → Unit F.
- **H (`isFreeModel` mislabel #17):** `:free` suffix authoritative; no zero-price heuristic. → Unit A.
- **I (arg parsing #16, atomicity #21, async GUI gating #20, broken-member taxonomy #15):** folded
  into Units E, B, D, B respectively.
