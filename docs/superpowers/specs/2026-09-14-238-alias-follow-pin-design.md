# #238 — Follow-or-Pin Aliases, and One Review Engine Behind Two Surfaces — Design Spec

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans when this spec is turned into an implementation plan. This document is the SPEC, not the plan — it settles the design forks and records why. Task decomposition comes after.

> **Status (2026-09-14):** Design settled, nothing built. The nine decisions in §1 were adjudicated one at a time with the owner in a first working session (cloud, UTC). The eight questions that session left open in §8, plus one fork the second session discovered (Q9), were adjudicated one at a time with the owner in a second session on 2026-09-14 UTC (evening of 2026-09-13 in Chicago); each records the alternatives rejected and why. Code facts cited below (`file.js :: symbol`, line counts) were measured against `origin/main` @ `b803a2a` on 2026-09-14 and re-measured in the second session — every count, line number and symbol matched. Nothing in this document is open.

**Goal:** An Amicus user — who cannot edit this repo — can see, maintain and repair their model alias map from a picker, on both the CLI and the Electron setup surface, with no copy-paste; becomes aware of drift and of genuinely new models without running an audit; and by default carries no maintenance burden at all, because an alias FOLLOWS the shipped recommendation until the user deliberately pins it. The owner's curated-pin update loop (the original #238 ask) becomes the same review flow pointed at a different sink.

**The reframe:** #238 as filed is two problems wearing one name. The OWNER's problem is the shipped pins in `src/utils/curated-models.js` — repo commits, GitHub, `.github/workflows/model-drift.yml`. The USER's problem is their own `config.aliases` — writable, no repo access needed, every user, continuously. The second is the larger problem and it is solvable entirely in user-writable config. Any solution shaped around GitHub (a bot PR, a scheduled workflow opening a diff) serves the owner alone and does not survive contact with a second user. That ruling is why §1 D4/D8 look the way they do.

---

## 1. Decisions

### D1 — An alias FOLLOWS by default; pinning is deliberate

A curated alias FOLLOWS when its name is ABSENT from `config.aliases`; it is PINNED when its name is present with a concrete model id. There is no sentinel value (Q3). This is not a new mechanism: `config.js :: getEffectiveAliases` already returns `{ __proto__: null, ...DEFAULT_ALIASES, ...userAliases }`, so an absent name resolves to the shipped pin on every consumer today. The only reason every existing config carries all 21 names as concrete ids is that the wizard seeds them (D6, Q9).

- Fresh installs need zero maintenance and stay current silently.
- ONLY pinned aliases can ever generate a review item. A following alias cannot drift.
- The alias-shadow notice (`src/utils/alias-shadow.js :: findAliasShadows`) already reports only names PRESENT in the user's config whose value differs from the shipped one — under this encoding that is exactly "pinned and divergent", so it stops being a scold about a contract the user never knowingly entered and becomes a report on a choice they actually made. No change to that module.
- "Unpin" and "delete" are ONE operation — remove the key — whose meaning is decided by whether the name is curated: a curated name resurrects from the defaults (unpin), a user-invented name is gone (delete). Electron's save handler (`electron/ipc-setup.js:199`, `model === null → delete cfg.aliases[alias]`) already does this; it was unpin without the name.
- A user-invented alias (no shipped recommendation) is pinned by construction.

*Rejected:* everything-pinned (today's shape) — correct and reproducible, but every user carries maximum review burden forever. *Rejected:* split-by-origin (curated names always follow, user names always pin) — fewest concepts, but a user could not override `gemini` without renaming it. *Rejected (Q3):* the sentinel encodings — see §8 Q3.

### D2 — Following resolves to the SHIPPED PIN, not the live catalog

`curated-models.js:6-7` requires that runtime alias resolution never wait on the network. A following alias therefore resolves exactly as `toDefaultAliases()` does today, through the existing merge: static, offline-safe, identical on every machine, no catalog read at resolve time.

Consequence: a following alias picks up a new model when the package is upgraded, not before. New-model awareness is handled by the review queue (D7), NOT by silent re-resolution.

*Rejected:* resolving through the family `idPattern` against the cached catalog. It only works for the 5 `FAMILIES` entries — the 16 `CARDLESS` entries have no pattern — and it reintroduces precisely the "pins as a cache of catalog state" property the file's own docstring forbids. It is also unsafe as written: see §5. *Rejected:* pin-as-floor-with-catalog-upgrade — safe if fully gated, but the most machinery, and still only covers 5 aliases.

### D3 — The baseline reset is deferred and dogfooded

The owner wants to review and reset what the shipped defaults actually are. That is NOT done by hand first. The review engine ships, and the baseline reset becomes its first real job, run by the owner on a machine with real provider keys. Whatever the owner accepts in that session becomes the new curated pin set.

This makes an owner-mode sink a REQUIREMENT, not a nice-to-have (see D8).

*Note:* a live catalog is unreachable from a sandboxed agent session — the egress proxy denies `openrouter.ai:443` and `models.dev:443`, so `models --refresh` returns floor-only and `--check` reports `Catalog unavailable … cannot check` with exit 0 (observed 2026-09-14). Any baseline work must run on the owner's machine or on a GitHub runner.

### D4 — `amicus aliases` is a new, standing command

```
amicus aliases                    list — following / pinned, grouped by vendor
amicus aliases --review           picker: walk every proposal (user sink)
amicus aliases --review --owner   same picker, curated-pins.json sink (D8; repo + TTY + clean tree)
amicus aliases --ui               open JUST the alias pane in Electron
amicus aliases --json             versioned machine-readable document (includes proposals)
```

`amicus models --check` stays a pure auditor; its scope does not change, and it gains one informational line class (Q7). The existing copy-paste remediation hints are rewritten to point here:

| Site | Today | Becomes |
|---|---|---|
| `src/sidecar/models.js:205` | `amicus setup --add-alias <a>=<id>` | `amicus aliases --review` |
| `src/sidecar/models.js:213` | `amicus setup --add-alias <a>=<id>` | `amicus aliases --review` |
| `src/sidecar/models.js:247` (fallback-drift line) | `— update curated-models.js` | `— amicus aliases --review --owner` |
| `src/utils/model-validator.js:162` | `amicus setup --add-alias <a>=<id>` | `amicus aliases --review` |
| `src/utils/alias-resolver.js:42` | `amicus setup --add-alias <a>=provider/model` | `amicus aliases --review` |

`setup --add-alias` itself stays: it is the scriptable write path and the only one a non-TTY caller has (Q2).

Non-TTY / `--json` / `--quiet` behaviour of `--review` is fixed by Q2: refuse loudly, show the list, exit 1.

*Rejected:* growing `models --check --fix`. It mirrors the `doctor --fix` idiom already in the repo and costs no new command, but `models` is about the CATALOG while aliases are the USER's map, and it leaves no home for "just show me my aliases". *Rejected:* a jump-to step of `setup` — maximum reuse, but "setup" reads as a one-time ceremony, which is exactly why nobody revisits it.

### D5 — A quiet notice, backed by an opportunistic background refresh

One line on stderr, written from the CLI's exit handler — the same slot the update notice uses at `bin/amicus.js:105-110` — so it lands AFTER the command's own output and stdout stays byte-clean under every command:

```
  2 alias updates available — amicus aliases --review
```

(Singular for one. No alias names or ids on the line; the list is one command away.)

- The notice is computed from the CACHE only, at any age (§5 display gate). It never networks inline.
- It is written at most once per 24 hours (Q5): `config.aliasReview.lastNotified` (epoch ms) is set best-effort when it fires, mirroring `config.js :: markMigrationNotified`'s swallow-the-save-failure shape. While undismissed proposals exist and 24 h have passed, it fires again.
- After a run that exits 0, if the cache is older than 7 days (Q1), a DETACHED full catalog refresh is spawned from the same exit handler — `spawn(..., { detached: true, stdio: 'ignore' }).unref()`, the shape `src/sidecar/workspace-window.js:90-98` already uses — so it can never block or fail a run. It is the SAME refresh `models --refresh` performs (`model-catalog.js :: refreshCatalog`), keys included: a keyless variant would overwrite the direct-provider rows setup and doctor rely on, so it is not an option.
- ONE predicate gates both the notice and the refresh: `process.stdin.isTTY && !args.json && !args.quiet`, not the `mcp` command, not CI (the is-ci signal update-notifier already honours), `process.env.AMICUS_NO_NETWORK_PROBES !== '1'`, and `config.aliasReview.autoRefresh !== false` (Q8). No new environment variable.
- Per-proposal dismissal persisted under `config.aliasReview.dismissed` (D7, Q5). `config.routing` is the precedent for a nested namespace.

*Accepted cost:* this performs authenticated network work the user did not explicitly request — the model-LIST endpoints of every provider the user holds a key for, once a week at most. It is detached and silent; it is documented, and it is disable-able two ways.

*Rejected:* cache-only with no automatic refresh — honest about cost, but awareness decays silently and the user gets no signal that the signal is missing. *Rejected:* pull-only — zero nag risk, but it puts the whole burden of remembering on the user, which is the status quo that produced this issue. *Rejected (Q1, Q5, Q8):* see §8.

### D6 — Migration: seeded → follow, divergent → pinned; the wizard stops seeding

Existing users hold concrete ids for all 21 curated names, written by the setup wizard: `sidecar/setup.js :: createDefaultConfig` copies every default in, and `quick-picks.js :: toLiveSeedAliases` overlays the LIVE catalog flagship for the five families. The migration:

```
for each alias in config.aliases:
  stored === DEFAULT_ALIASES[alias]  →  remove the key    (now follows)
  stored !== DEFAULT_ALIASES[alias]  →  unchanged         (pinned)
```

It runs as a NORMALIZATION, not a one-shot: inside `saveConfig` (beside the invalid-alias stripper it already has, one Notice per removed key: `Notice: alias 'glm' matched the shipped recommendation — now following`) and on entry to every `amicus aliases` form (best-effort there: a failed write is announced on stderr and the command proceeds on the in-memory normalized view, so a read-only config dir never blocks a listing). There is no startup write, no version flag, and the pass is idempotent. A config that is never written after the upgrade keeps its seeded keys; every one of them still resolves to the identical id, and `amicus aliases` converts them the first time the user looks.

**No-op proof:** when `stored === DEFAULT_ALIASES[alias]`, removing the key makes `getEffectiveAliases` fall through to `DEFAULT_ALIASES[alias]` — the same string. Every alias therefore resolves to the identical id it resolved to before migration. Migration day has zero behavioral change; divergence begins only at the next pin bump, which is what following means. This property must be pinned by a test.

**The divergent case, corrected.** The first session's reasoning — "differs from the default, therefore deliberately chosen" — is wrong for the five families: `toLiveSeedAliases` wrote whatever the catalog resolved at setup time, and a value that has since fallen behind the shipped pin was never chosen by anyone. (The nine "drifted" aliases in the issue are this case.) The OUTCOME stands — they stay pinned, because the migration cannot tell a live seed from a deliberate pin — and the review flow is what clears them: each surfaces once as a pinned alias whose value differs from the shipped one, with "follow the shipped recommendation" offered on the same screen (D7, Q4), so one `aliases --review` session returns a seeded-divergent config to zero maintenance.

**The wizard stops seeding (Q9).** `createDefaultConfig` no longer copies the defaults in; `toLiveSeedAliases` is retired (both callers — `setup.js:548` and `electron/ipc-setup.js:193` — seed `{ aliases: {} }`). The wizard writes ONLY what the user actively chose: the alias picked as the overall default keeps its live flagship WHEN that differs from the shipped pin (`setup.js:559`), announced on screen as a pin — `gemini → google/gemini-3.7-flash (live flagship, newer than the shipped 3.6 — pinned)` — and a #138 drill-down pick pins as today (`setup.js:616`). Everything else is not written and follows. A fresh install carries at most one pin, and the user was told about it. The lifecycle then runs itself: when a release moves the shipped pin to the same id, save-time normalization drops the key; when the shipped pin passes it, the review proposes following.

One consumer must change: `config.js :: buildAliasTable` (the alias table written into a project's CLAUDE.md/AGENTS.md block) reads RAW `config.aliases` today and would omit every following alias — it switches to effective aliases. `electron/setup-ui.js:254-255` compares raw values against the defaults to build its override display and needs no change: only pinned keys are present.

*Rejected:* treating all existing aliases as deliberate pins — no migration code and no surprise, but existing users wake up fully pinned, inherit maximum review burden, and reach the low-maintenance path only by hand. *Rejected:* asking once on first run — most respectful, but it interrupts an unrelated run and still needs a silent default for non-TTY/CI, which re-poses the same question. *Rejected:* a one-shot startup migration that writes config from `bin/amicus.js` — it would run inside MCP-spawned children and under `--json`, and it buys nothing the normalization does not. *Rejected (Q9):* see §8.

### D7 — Discovery: mechanical siblings + an owner-curated notable list; one proposal per alias

Two mechanisms, each doing what it is good at.

**Mechanical (no taste, no noise):** a strictly newer sibling of something the user already pins — same vendor, same family prefix, same tier/variant suffix, higher version. `scripts/check-ci-alias-pins.js :: parsePin` already implements exactly this comparator, tier-safe by construction (`gpt-5.6-terra` is never compared against `gpt-5.6-sol`). It is currently pointed only at `.github/amicus-ci-aliases.json`; it gets lifted into a shared module, which the CI script, the engine and `models --check` (Q7) all consume.

**Editorial (shipped data, owner-curated):** a small `notable` list flagging genuinely new entrants worth an alias, with a suggested alias name. This is the only mechanism that can surface a model the user has no sibling for.

**One proposal per alias (Q4).** A pinned alias can satisfy several findings at once (its value differs from the shipped pin AND the catalog holds a newer sibling). The engine emits ONE proposal per alias carrying a ranked candidate list — the newest sibling first, the shipped pin labelled *follow* when the alias is curated and its current value differs from it, then "choose another" — so the user answers each alias once and answers cannot conflict.

**Dismissal (Q5).** *Skip* stores nothing and asks again next time. *Never ask again* is keyed to the PROPOSAL, not the alias: `dismissKey = alias + '@' + proposedId`, stored as `config.aliasReview.dismissed[dismissKey] = <ISO date>`, permanent for that pair. A newer proposed id for the same alias is a new key and asks once more. There is no per-alias mute in this round (§9).

*Accepted cost:* the notable list is ongoing owner work.

*Rejected:* siblings alone — deterministic and zero-maintenance, but structurally cannot surface a new entrant, leaving half the brief unserved. *Rejected:* vendor-scoped (anything new from a vendor you use) — no curation burden, but vendors ship variants constantly (tiers, dated snapshots, `-mini`/`-pro`/`-codex`), so it needs a variant-suppression heuristic, which is the same taste problem hidden in a regex. *Rejected (Q4, Q5):* see §8.

### D8 — Pins and the notable list move to a shipped data file; owner mode writes it

`src/utils/curated-models.js` is **exactly 300 lines** and is **not** on the `scripts/check-file-sizes.js` exclude list — it is at a hard wall with zero headroom. The notable list needs a data file regardless. Both move:

```jsonc
// src/utils/curated-pins.json  (real JSON: no comments; the prose lives in the fields)
{
  "version": 1,
  "pins": {
    "gemini":  { "routes": { "openrouter": "openrouter/google/gemini-3.6-flash",
                             "google": "google/gemini-3.6-flash" },
                 "verifiedOn": "2026-08-04" },
    "gpt-pro": { "routes": { "openrouter": "openrouter/openai/gpt-5.6-sol-pro" },
                 "gatewayOnly": true,
                 "verifiedOn": "2026-08-05",
                 "ruling": "tracks the SOL (premium) tier's pro sibling; retargeted off gpt-5.5-pro 2026-08-04. gatewayOnly: OpenAI's direct namespace does not serve it — never audit the derived direct form, never suggest a direct pairing (v4.6.3 spec, 2026-08-05)." }
  },
  "retired": {
    "devstral": { "on": "2026-08-04",
                  "ruling": "OpenRouter delisted the whole devstral family and the alias had no other route. No retarget — no served model is a devstral successor. `mistral` remains the vendor's alias." }
  },
  "notable": [
    { "id": "openrouter/newco/atlas-1", "suggestedAlias": "atlas", "note": "new frontier entrant" }
  ]
}
```

Field rules (Q6): `routes` is the per-gateway map (a family's former `fallback`, a cardless entry's former `routes`); `verifiedOn` (ISO date) is REQUIRED on every pin — a test refuses a pin without one; `ruling` is optional free text; `gatewayOnly` keeps its code-read meaning (`directFormProvenance`). `retired` names aliases deliberately dropped, so neither the sibling scan nor the notable list can resurrect them and `amicus aliases` can tell a user who still pins one what happened.

`curated-models.js` keeps the MATCH RULES and their prose — `FAMILIES` minus their `fallback` maps (`alias`, `label`, `blurb`, `vendorPath`, `idPattern`, `directProviders`), `DIVERGENT_VENDORS`, the gpt tier-semantics comment beside the pattern it explains, the fallback-floor role — and reads the data file: `getFamilies()` attaches `fallback = pins[alias].routes`; the cardless set is every pin whose alias is not a family alias. It recovers well under 300 lines in the process. Owner mode writes the JSON directly (`utils/atomic-write.js`), stamps `verifiedOn` with today's date on every accepted pin and prompts for an optional ruling; it is gated on repo-detection + TTY + clean working tree; `git diff` is the review surface and nothing ships until the owner commits.

**The safety property is preserved by the picker plus the commit, not by the file format.** A pin still reaches users only after a human accepted it in a review session and committed it. "No pinned guess is better than a wrong one" survives intact.

**Ruling migration (Q6):** the seventeen comment blocks in `curated-models.js` @ `b803a2a` each have a named destination in Appendix A. Pin-value content (why this id, when verified, routing flags, deliberate absences) becomes data fields; match-rule and role prose stays beside the code. The migration is done by hand, reviewed by the owner in the PR diff and by the council; the executable half is proven by a byte-identical builder test (§6.8). It is not mechanized.

*Rejected:* pins stay in source, owner mode emits a patch — no migration risk to the prose, but it means regex-rewriting a commented source file forever, and the 300-line wall still bites on the next comment. *Rejected:* data file but propose-only — reintroduces copy-paste, the exact thing this issue exists to remove, merely relocated to the owner. *Rejected (Q6):* see §8.

### D9 — Electron: a "Needs review" section above the full list

Step 3's editor renders ~21 aliases in collapsible per-vendor groups, so a proposal buried in a collapsed group is invisible. Proposals therefore get their own auto-expanded section ABOVE the list:

```
┌─ Model Routing ───────────────────────────┐
│ NEEDS REVIEW (2)                          │
│  glm    → glm-5.3    newer: glm-5.4       │
│         [✓ accept] [⌄ choose] [× dismiss] │
│  atlas    new frontier entrant — map it?  │
│         [✓ add]    [⌄ choose] [× dismiss] │
├───────────────────────────────────────────┤
│ 🔍 search…                                │
│ ▾ Google (2)                              │
│    gemini → gemini-3.6-flash   following  │
│ ▾ Z.AI (1)                                │
│    glm    → glm-5.3   pinned [unpin] [×]  │
└───────────────────────────────────────────┘
```

**Owner requirement (R1):** pins must be easy to SEE, EDIT and REMOVE on both surfaces — "remove" covers both *unpin* (revert to following) and *delete the alias*. Under D1 both are "remove the key" and the label is decided by whether the name is curated: a curated row shows `[unpin]`, a user-invented row shows `[×]`. The list shows following-vs-pinned state per row, and the CLI list must render the same distinction. The `[⌄ choose]` control on a curated proposal includes the *follow* option (Q4).

*Rejected:* badges in place plus a banner that expands the right groups — one list and the smallest diff, but accepting several means hunting through groups, and a new-model proposal has no row to badge because it is not an alias yet. *Rejected:* a dedicated modal walking proposals one at a time — best CLI parity and room for evidence, but it is a mode you enter and leave, the same trap as the wizard.

---

## 2. Architecture — one engine, two renderers

```
        ┌──────────────────────────────────────────┐
        │ src/utils/alias-proposals.js             │  PURE. No I/O, no prompts.
        │ (catalog, config.aliases, pins, retired, │  Returns one proposal per alias.
        │  notable, dismissed) → proposals[]       │
        └───────────────────┬──────────────────────┘
                            │
            ┌───────────────┴───────────────┐
            ▼                               ▼
      CLI renderer                    Electron renderer
      src/sidecar/aliases.js          electron/setup-ui-alias-review.js
      readline picker                 "Needs review" section
            │                               │
            └───────────────┬───────────────┘
                            ▼
                  WRITE SINKS (never in the engine)
                  user  → set key / remove key → saveConfig (normalizes, D6)
                  owner → curated-pins.json  (gated, D8; stamps verifiedOn)
```

The pure/writer split mirrors the established pattern: detection lives in `src/utils/alias-audit.js`, the write lives in `src/utils/doctor-alias-check.js :: repairAlias`. The engine must stay renderer-agnostic so CLI and Electron cannot drift apart.

**Proposal shape (draft):**

```js
{
  alias,                 // the name
  state: 'pinned' | 'unmapped',     // a following alias never appears (D1)
  current,               // the pinned id, or null for 'unmapped'
  shipped,               // DEFAULT_ALIASES[alias] or null for a non-curated name
  candidates: [          // ranked; the picker renders them in this order
    { id, why: 'newer-sibling' | 'follow' | 'notable', evidence: {} }
  ],
  reasons: ['stale' | 'newer-sibling' | 'differs-from-shipped' | 'notable-unmapped'],
  dismissKey,            // alias + '@' + candidates[0].id
}
```

Accepting writes `candidates[i].id` for the alias; when that equals `shipped`, `saveConfig`'s normalization removes the key and the alias follows (Q4). A `notable-unmapped` accept adds a new key. Every candidate has already passed §5.

**Reuse, measured:**

| Existing | Role |
|---|---|
| `src/utils/alias-audit.js :: findStaleAliases` | reason `stale` |
| `src/utils/alias-audit.js :: suggestReplacements` | ranked candidates for a stale pin |
| `scripts/check-ci-alias-pins.js :: parsePin` / `newestSibling` | tier-safe sibling comparator (lift to shared) |
| `src/sidecar/setup.js :: askQuestion` | readline prompt — no new dependency |
| `src/cli-handlers.js:225` | interactive gate `!!process.stdin.isTTY && !args.json && !args.quiet` |
| `src/sidecar/setup.js :: addAlias` / `saveConfig` | the user write (set); remove = delete key + `saveConfig` |
| `src/sidecar/setup.js :: deriveFreeAlias` | suggested alias name for a notable model |
| `electron/setup-ui-alias-script.js :: buildModelSelect` | the grouped `<select>` picker (already exists) |
| `electron/setup-ui-alias-groups.js :: groupAliases` | vendor grouping |
| `electron/ipc-setup.js:199` | the Electron remove-key path (already exists) |
| `src/utils/result-schema.js :: buildAuditDoc` | versioned-document precedent for `--json` |
| `src/utils/atomic-write.js` | owner-mode JSON write |
| `src/utils/config.js :: markMigrationNotified` | best-effort nested-namespace flag write (for `lastNotified`) |
| `src/sidecar/workspace-window.js:90-98` | detached `spawn` + `unref` shape (for the background refresh) |
| `src/utils/live-probes.js` | `AMICUS_NO_NETWORK_PROBES` policy (Q8) |

---

## 3. Size budget (measured 2026-09-14, `wc -l`)

The 300-line gate (`scripts/check-file-sizes.js`, `include: ['src/**/*.js', 'electron/**/*.js']`) applies. Grandfathered exclusions are marked.

| File | Now | Note |
|---|---|---|
| `src/utils/curated-models.js` | **300** | **At the wall, NOT excluded.** D8 must reduce it before anything is added. |
| `src/utils/alias-audit.js` | 266 | 34 free |
| `src/sidecar/models.js` | 268 | 32 free; hint-line edits + the Q7 sibling line — may need a split |
| `src/utils/quick-picks.js` | 150 | safety fix lands here (§5); `toLiveSeedAliases` retired (D6) |
| `src/cli-handlers.js` | 254 | 46 free; `aliases` dispatch |
| `electron/setup-ui-alias-script.js` | 284 | **16 free** — review UI needs a NEW module |
| `electron/setup-ui-aliases.js` | 89 | room |
| `electron/setup-ui-alias-groups.js` | 161 | room |
| `electron/setup-ui.js` | 808 | grandfathered — do not grow |
| `src/sidecar/setup.js` | 756 | grandfathered — do not grow; D6 REMOVES seeding lines |
| `src/utils/config.js` | 790 | excluded — but keep new state out of it: `saveConfig` gains ONE call to the normalizer, which lives in a new module |

New modules must put the `@module` docblock FIRST, then `'use strict'`, keep exports ≤ 5, and be accompanied by a `node scripts/generate-docs.js` run with `docs/architecture-map.md` staged in the same commit. Any commit adding/removing/renaming a file under `src/`, `bin/` or `scripts/` MUST update `CLAUDE.md` in the same commit.

---

## 4. Surfaces

**CLI list** — following/pinned state visible per row, grouped by vendor, pins removable (R1). The footer names the auto-refresh state so the Q8 setting is discoverable:

```
$ amicus aliases
  Google
    gemini      → google/gemini-3.6-flash        following
    gemini-pro  → openrouter/google/…-3.1-pro    following
  Z.AI
    glm         → openrouter/z-ai/glm-5.3        pinned    ⚠ newer available

  1 update available — amicus aliases --review
  background catalog refresh: on (weekly) — catalog is 3 days old
```

**CLI review** — a numbered picker, no copy-paste anywhere. When the cache is older than 24 h the picker refreshes inline first (`refreshing catalog (3 days old)…`) and refuses to write if that refresh fails, saying why (§5):

```
$ amicus aliases --review
  [1/2] glm
    currently  openrouter/z-ai/glm-5.3      (pinned by you)
    shipped    openrouter/z-ai/glm-5.3
    proposed   openrouter/z-ai/glm-5.4      newer sibling, same tier
               ctx 200k · $0.40/$1.60 per Mtok

    [1] accept glm-5.4   [2] follow the shipped pin   [3] choose another   [4] skip   [5] never ask again
```

(`[2]` appears only for a curated alias whose current value differs from the shipped pin.)

**CLI review, no terminal (Q2)** — the proposals print exactly as the list renders them, then:

```
  aliases --review is interactive: run it in a terminal, or use `amicus aliases --json` for machine output.
```

exit 1. `--review` together with `--json` or `--quiet` is an argument error (exit 1), the same shape as `--live requires --check`.

**Electron** — D9.

---

## 5. Safety — the gate every proposal must pass

A latent hazard exists TODAY and must be fixed before anything proposes a replacement id:

- `src/utils/quick-picks.js :: pickCurrent` does not filter on `authoritative`.
- `src/sidecar/models.js :: buildFallbackDriftReport` receives a bare catalog array with no `providerFailures` guard.

`src/utils/gateway-route-audit.js :: isAuthoritative` is the hardened pattern that already exists for the per-gateway audit and was never applied here. Consequently a partially-fetched or rejected namespace can make the drift report propose an OLDER sibling — a downgrade. Observed adjacent case, 2026-09-14: OpenRouter returned HTTP 403, `models --check` printed `PROVIDER FETCH FAILED: openrouter (HTTP 403)` then `Catalog unavailable … cannot check`, exit 0.

**Rules for DISPLAY** (the notice, the list, the picker's proposal screens — nothing is written):
1. the proposed id's row is AUTHORITATIVE (`authoritative !== false`);
2. the relevant provider is ABSENT from the cache's `providerFailures`;
3. the proposed id is a strictly-newer sibling per `parsePin`, never merely "different" (a *follow* candidate is exempt: it is the shipped pin);
4. the alias is not in `retired` and the proposal is not dismissed.

The cache may be ANY age for display (Q1). A stale basis can only under-report — miss a sibling that appeared since, or a pin that vanished since — it cannot manufacture a downgrade, because rules 1–3 are about the fetch's completeness, not its age.

**Rule for WRITE** (accepting in the picker, either sink):
5. the catalog is FRESH — `doctor-alias-check.js :: isCatalogFresh`, the 24 h `MAX_CATALOG_AGE_MS` window `doctor` calls stale. The picker refreshes inline when the cache is older; if the refresh fails or comes back floor-only, it refuses the write for that session and says why. A *follow* accept is exempt (it writes nothing the catalog vouches for — it removes a key).

Failing any rule, the engine emits nothing for that alias and says why — it never degrades to a guess. This is the direct descendant of the `doctor --fix` gate: explicit action, narrow unambiguous class, fresh catalog, announce both ids.

*Why the split (Q1):* with a single 24 h gate on both, a user who runs amicus less than daily always computes the notice against a stale cache, gets zero proposals, and never sees it; the detached refresh lands after the run and is stale again by the next one. The first draft of this section had that defect.

---

## 6. Test plan (TDD order)

1. **Engine, pure** — one proposal per alias; a following (absent) alias yields nothing; tier-crossing never proposed (`gpt-5.6-terra` ↛ `gpt-5.6-sol`); empty catalog yields nothing; the *follow* candidate appears only for a curated alias whose value differs from the shipped pin; a `retired` alias yields nothing; a dismissed key yields nothing and a new proposed id for the same alias yields a proposal again.
2. **Safety gate** — `authoritative: false` row → no proposal; provider in `providerFailures` → no proposal; older sibling → never proposed; stale cache → proposals still DISPLAYED (Q1) but accept triggers a refresh and a failed refresh REFUSES the write with a reason. One named mutant per guard.
3. **Migration / normalization** — for a config where every alias equals its shipped default, resolution before and after `saveConfig` is byte-identical across all 21 aliases (D6's proof) and the keys are gone with one Notice each; a divergent value survives; `amicus aliases` normalizes on entry, best-effort (a failed write is announced on stderr and the command proceeds on the in-memory normalized view); a `__proto__` key is still removed by the existing stripper, never by the normalizer, and `toString`/`constructor` names stay safe through the null-prototype merge.
4. **Resolution** — an absent alias resolves offline with no catalog read; `DEFAULT_ALIASES` stays static; `__proto__`/`toString`/`constructor` alias names stay safe (the existing `BUILDERPROTO` seed must survive the data-file move).
5. **Wizard (Q9)** — a fresh readline setup and a fresh Electron save write `aliases: {}` plus at most the chosen default; the chosen default is written only when the live pick differs from the shipped pin, and the announcement names both ids; a drill-down pick still pins; `toLiveSeedAliases` has no remaining caller.
6. **CLI** — list renders following/pinned and the refresh-state footer; `--review` writes only accepted items; accepting the shipped pin leaves no key; `--json` is byte-clean on stdout; non-TTY `--review` prints the list, the one-line reason, exits 1 (Q2); `--review --json` and `--review --quiet` exit 1 as argument errors; `buildAliasTable` lists following aliases.
7. **Notice + refresh (D5)** — fires from the exit handler on stderr; not within 24 h of `lastNotified` (Q5); suppressed under `--json`, `--quiet`, non-TTY, `mcp`, CI, `AMICUS_NO_NETWORK_PROBES=1`, `aliasReview.autoRefresh: false` (Q8) — one test per predicate term; the detached refresh spawns only at exit 0 with a cache older than 7 days (Q1) and never on a failed run.
8. **Data-file migration** — every pin and every ruling present in `curated-models.js` @ `b803a2a` is present in `curated-pins.json` after the move (Appendix A, row by row); `toDefaultAliases()`, `toGatewayRoutes()` and `directFormProvenance()` are unchanged, asserted byte-for-byte against a fixture snapshotted from `b803a2a`; every pin carries an ISO `verifiedOn`; `retired.devstral` is present.
9. **Owner mode** — refuses outside a repo, refuses a dirty tree, refuses non-TTY; writes valid JSON; stamps `verifiedOn` with today's date on an accepted pin; round-trip through `curated-models.js` yields the expected `toGatewayRoutes()`.
10. **`models --check` (Q7)** — the three hints read as D4's table says; the fallback-drift report emits an informational newer-sibling line for a cardless pin and the exit code is unchanged by it; `--strict` is unaffected.
11. **Electron** — proposals render in the Needs-review section; accept writes through the same sink; a curated row shows `[unpin]`, a user-invented row `[×]`; both remove the key.

No real network; no real config dir (`tests/setup/hermetic-config-dir.js`).

---

## 7. Sequencing

**Phase 1** — safety gate (§5) · pure engine · `amicus aliases` list + `--review` (+ Q2 non-TTY) · normalization + migration (D6) · wizard stops seeding (Q9) · `buildAliasTable` on effective aliases · hint rewrites (D4).
**Phase 2** — `curated-pins.json` move (D8, Appendix A) · owner mode (`--review --owner`) · `models --check` sibling line (Q7) · the baseline reset session (D3).
**Phase 3** — Electron Needs-review section (D9) · `--ui`.
**Phase 4** — passive notice + opportunistic refresh (D5; Q1/Q5/Q8) · notable list (D7 editorial half).

Phase 1 delivers the copy-paste fix on the CLI and is independently shippable. Phase 3 delivers it on Electron. Phase 4 is the awareness layer and should land last, because a notice pointing at an immature picker is worse than no notice.

---

## 8. Decisions on the formerly open questions (2026-09-14, second session)

Taken in dependency order, not §8's original order: the encoding first, then the Phase 1 behaviours, then Phase 2, then the Phase 4 notice trio.

**Q3 — encoding of a following alias: ABSENCE.** A curated name absent from `config.aliases` follows; present means pinned. Grounds: `getEffectiveAliases`'s merge already does this; downgrade-safe (an older amicus sees fewer keys and fills from its own defaults); unpin and delete collapse into "remove the key", which Electron already implements. Accepted loss: a user cannot pin to the value that currently equals the shipped pin — D6 already accepted exactly that loss at migration time. *Rejected:* the bare string `"follow"` — self-documenting, survives the stripper, but needs a resolve step in the merge, an invalid-on-non-curated rule, an audit of ~12 raw `config.aliases` readers (several would misreport it as a stale or shadowing model), and an older amicus would hand the literal word to the router and fail at launch. *Rejected:* `{ mode: "follow" }` — `saveConfig`'s stripper removes every non-string value with a Notice, in every shipped version.

**Q4 — accept semantics: accept writes the chosen id; the encoding decides the state; ONE proposal per alias.** If the written id equals the shipped pin, normalization removes the key and the alias follows; otherwise it stays pinned. Every picker screen for a curated alias offers *follow* when the current value differs from the shipped pin. A `notable-unmapped` accept adds a pinned alias. *Rejected:* one proposal per finding — the user answers the same alias twice and later answers can undo earlier ones. *Rejected:* accept always pins, follow only via the list's unpin — two visits for every seeded-divergent alias.

**Q2 — `--review` without a TTY: refuse loudly, show the list, exit 1.** `--review` with `--json`/`--quiet` is an argument error. Grounds: the product principle forbids the correct-but-silent degrade; `doctor --fix` is not a precedent because it never prompts. *Rejected:* decline silently, exit 0 — a script author never learns the picker did not run. *Rejected:* `--review --yes` — the auto-apply the issue rules out.

**Q7 — curated-pin drift reporting stays in `models --check`; owner mode is the fix flow; one informational line added.** The `doctor` / `doctor --fix` split. `model-drift.yml` is untouched; three hints redirect (D4 table). The fallback-drift report gains a newer-sibling line for the cardless pins, using the lifted comparator, informational only — closing the "two releases behind while every gate stays green" failure the CI checker's docstring names, on the weekly cadence. *Rejected:* reporting without the sibling extension — the owner learns of a newer cardless sibling only by running owner mode by hand. *Rejected:* moving the audit into `aliases --review --owner --check` — a second audit surface and a re-implemented strict exit contract.

**Q6 — ruling migration: split by kind, hand-migrated, checklist-verified.** Pin-value content becomes `verifiedOn` (required), `ruling` (optional), `gatewayOnly`, and a top-level `retired` map; match-rule and role prose stays in `curated-models.js`. Appendix A names a destination for each of the seventeen blocks; the owner reads the diff, the council reads it again; §6.8 proves the executable half byte-for-byte. Owner mode stamps `verifiedOn` and prompts for a ruling. *Rejected:* every comment → `ruling` verbatim — idPattern semantics land in a file the pattern does not live in. *Rejected:* prose stays in JS, data file is ids/dates/flags — rulings live apart from the pins they justify and owner mode has nowhere to record why.

**Q1 — refresh threshold: 7 days, with the §5 display/write split.** Grounds: the refresh is the full keyed refresh (a keyless one would overwrite direct-provider rows); every `setup`/`doctor`/`models` run already refreshes past 24 h, so this job serves users who only run `start`/`council`; model releases arrive on a cadence of weeks. *Rejected:* 24 h — one constant, but seven times the traffic and keyed calls for an awareness gain nobody would notice. *Rejected:* 30 days — a retired pin can sit a month unreported.

**Q8 — disabling: the existing `AMICUS_NO_NETWORK_PROBES=1` and CI signal, plus `config.aliasReview.autoRefresh: false`. No new environment variable.** `amicus aliases` prints the state. *Rejected:* env only — a Windows user manages environment variables to keep it off. *Rejected:* config only — a CI runner or container has no config file.

**Q5 — notice: one stderr line from the exit handler, at most once per 24 h (`aliasReview.lastNotified`), dismissal per proposal.** *Skip* stores nothing; *never ask again* is `alias@proposedId`, permanent for the pair, re-asked for a newer id. *Rejected:* every eligible run with no timestamp state — the owner chose the quieter cadence for users who run amicus many times a day. *Rejected:* per-alias mute — it would also hide the day a pinned model is retired, the one proposal nobody should be able to mute.

**Q9 (discovered) — the wizard writes only what the user actively chose.** The chosen default keeps its live flagship when that differs from the shipped pin, announced as a pin; drill-down picks pin; everything else follows; `toLiveSeedAliases` is retired. *Rejected:* nothing live — the wizard's "current flagship at setup" promise is gone and every new user starts on a lagging pin set. *Rejected:* keep the five live family pins — five aging pins per fresh install, D1 in name only.

---

## 9. Residuals and out of scope

- **Per-alias mute** — deferred. A user who deliberately pins `gpt` to the sol tier will dismiss a "follow terra" proposal each time the terra pin moves, a few times a year. Add a mute only if that proves irritating; the retired-pin case argues against making it easy.
- **The CI bench alias map** (`.github/amicus-ci-aliases.json`) is a third pin set with its own weekly checker. It consumes the lifted comparator and is otherwise untouched by this issue.
- **Pinning to the current shipped value** is not expressible under Q3. Recorded as accepted, not forgotten.
- **Deleting a curated alias** is not possible on either surface (it resurrects from the defaults) — same as today; the control is labelled *unpin* to say so.

---

## 10. Provenance

Issue: [#238](https://github.com/BourbonDog/amicus/issues/238). Decisions D1–D9 adjudicated with the owner on 2026-09-14 (UTC), one fork at a time, in a sandboxed Claude Opus 5 cloud session; each records the alternatives that were put and declined. An earlier round of this design (three options framed around emitting a patch, a CI bot PR, or a pin ledger) was discarded when the owner ruled that anything GitHub-shaped serves only the repo owner and does not survive a second user. Q1–Q9 adjudicated with the owner on 2026-09-14 (UTC; evening of 2026-09-13 in Chicago) in a local Claude Code session that re-measured every code fact against `b803a2a` first. The spec moved from `docs/superpowers/plans/` to `docs/superpowers/specs/` in that session, per repo convention.

---

## Appendix A — Ruling-migration checklist (Q6)

Every comment block in `src/utils/curated-models.js` @ `b803a2a`, with its destination. "Stays" means the prose remains in `curated-models.js`, edited only where a fact changed. A row is done when the owner has read the diff for it.

| # | Block | Kind | Destination |
|---|---|---|---|
| 1 | File header (lines 1–11): families are match rules; fallbacks serve offline + `DEFAULT_ALIASES`; runtime never networks; `models --check` audits | role | Stays. The last sentence gains the Q7 sibling line. |
| 2 | `FAMILIES` docblock: `idPattern`/`directProviders` semantics; fallback OPTIONAL — "no pinned guess is better than a wrong one"; `gpt` pattern intent | match rule + principle | Stays. |
| 3 | `FAMILIES` docblock: "Pinned ids verified against the live catalog 2026-08-04" | pin | `verifiedOn: "2026-08-04"` on `gemini`, `gemini-pro`, `gpt`, `deepseek`. |
| 4 | `gpt` entry: tier-semantics ruling (tracks TERRA; sol/luna/pro/codex excluded; bare numeric fallback if terra naming disappears) | match rule + pin | Prose stays beside `idPattern`. `gpt` pin gains `ruling: "tracks the terra (mid) tier — owner ruling; see the idPattern comment in curated-models.js"`. |
| 5 | `opus` entry: no dotted version so forms coincide; anthropic route AUTHORED (DIVERGENT_VENDORS), never derived; direct id verified against Anthropic docs 2026-08-04 | pin | `verifiedOn: "2026-08-04"`, `ruling: "anthropic route authored (divergent vendor), never derived; direct id verified against Anthropic docs"`. |
| 6 | `CARDLESS` docblock: openrouter route always; direct route when the vendor's direct API serves it (claude/sonnet/haiku/fable); "Refreshed against the live catalog 2026-08-04" | role + pin | Prose stays. `verifiedOn: "2026-08-04"` on `claude`, `sonnet`, `haiku`, `qwen-coder`, `qwen-flash`, `mistral`, `glm`, `minimax`, `grok`, `seed`. |
| 7 | `gpt-pro` entry: retargeted off `gpt-5.5-pro` 2026-08-04 ($30/$180, expected to sunset); tracks SOL while `gpt` tracks terra; `gatewayOnly` ruling 2026-08-05 (v4.6.3 spec) — direct namespace does not serve it, derived direct form never audited, no direct pairing suggested | pin + flag | `gatewayOnly: true`, `verifiedOn: "2026-08-05"`, `ruling` carrying both sentences (as in the D8 example). |
| 8 | `codex` entry: newest codex-specific model on OpenRouter (verified 2026-06-09) | pin | `verifiedOn: "2026-06-09"`. |
| 9 | `fable` entry: direct route authored 2026-08-05 (owner ruling R2, v4.6.3 spec §3); Anthropic `/v1/models` lists it; live smoke wave 47278069 | pin | `verifiedOn: "2026-08-05"`, `ruling: "direct route authored 2026-08-05 (v4.6.3 spec §3, R2): Anthropic /v1/models lists claude-fable-5 and the direct route served in live smoke wave 47278069"`. |
| 10 | `qwen`/`kimi` note: refreshed 2026-08-26 (v4.9 W13); `qwen` again 2026-09-05 when OpenRouter and models.dev dropped the un-dated `qwen3.8-max` for `-0902` (the #218 PR 2 probe caught it) | pin | `qwen`: `verifiedOn: "2026-09-05"`, `ruling: "dated id: OpenRouter and models.dev dropped the un-dated qwen3.8-max on 2026-09-05 (#218 PR 2 probe)"`. `kimi`: `verifiedOn: "2026-08-26"`. |
| 11 | Same block: FALLBACK FLOOR role — a fork with no CI alias map resolves its bench here; the owner's machine and `.github/amicus-ci-aliases.json` run newer ids | role | Stays as module prose. |
| 12 | Same block: "Cardless entries have no `idPattern`, so `models --check` only asks whether the OLD id still EXISTS (check-ci-alias-pins.js asks the other question)" | role | REWRITTEN: `models --check` now also reports a newer sibling for cardless pins (Q7); the CI script still gates the CI map. |
| 13 | `devstral` comment: dropped 2026-08-04 (owner ruling); OpenRouter delisted the whole family; no retarget — no served successor; `mistral` remains the vendor's alias | retired | `retired.devstral = { on: "2026-08-04", ruling: … }` (as in the D8 example). |
| 14 | `inkling` entry: added 2026-08-14; the council-review workflow's default bench names it; this table is the floor for forks; pinned to the full model, not `inkling-small`; `:batch` not pinned | pin | `verifiedOn: "2026-08-14"`, `ruling: "council-review bench default and the fallback floor for forks; the full model, not inkling-small (the bench seat wants the flagship's judgment); :batch deliberately not pinned (wrong for an interactive leg)"`. |
| 15 | `DIVERGENT_VENDORS` docblock: anthropic; never derive a direct form; frozen Set | match rule | Stays. |
| 16 | `kimi` one-liner "see the qwen refresh note above" | pin | Folded into row 10. |
| 17 | Function docblocks: `getFamilies`, `stripGatewayPrefix`, `listCuratedRoutes`, `directFormFor`, `gatewayRoutesFor`, `directFormProvenance`, `toGatewayRoutes` (incl. the BUILDERPROTO note), `toDefaultAliases` | code | Stay; `getFamilies` gains one sentence on attaching `fallback` from the data file. |
