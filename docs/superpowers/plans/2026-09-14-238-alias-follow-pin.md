# #238 — Follow-or-Pin Aliases, and One Review Engine Behind Two Surfaces — Design Spec

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans when this spec is turned into an implementation plan. This document is the SPEC, not the plan — it settles the design forks and records why. Task decomposition comes after.

> **Status (2026-09-14):** Design settled, nothing built. The nine decisions in §1 were adjudicated one at a time with the owner in a working session; each records the alternatives rejected and why. Code facts cited below (`file.js :: symbol`, line counts) were measured against `origin/main` @ `b803a2a` on 2026-09-14. Everything in §8 is still open.

**Goal:** An Amicus user — who cannot edit this repo — can see, maintain and repair their model alias map from a picker, on both the CLI and the Electron setup surface, with no copy-paste; becomes aware of drift and of genuinely new models without running an audit; and by default carries no maintenance burden at all, because an alias FOLLOWS the shipped recommendation until the user deliberately pins it. The owner's curated-pin update loop (the original #238 ask) becomes the same review flow pointed at a different sink.

**The reframe:** #238 as filed is two problems wearing one name. The OWNER's problem is the shipped pins in `src/utils/curated-models.js` — repo commits, GitHub, `.github/workflows/model-drift.yml`. The USER's problem is their own `config.aliases` — writable, no repo access needed, every user, continuously. The second is the larger problem and it is solvable entirely in user-writable config. Any solution shaped around GitHub (a bot PR, a scheduled workflow opening a diff) serves the owner alone and does not survive contact with a second user. That ruling is why §1 D4/D8 look the way they do.

---

## 1. Decisions

### D1 — An alias FOLLOWS by default; pinning is deliberate

`config.aliases` may hold either the sentinel `follow` or a concrete model id. `follow` means "track the shipped recommendation"; a concrete id means the user chose it on purpose.

- Fresh installs need zero maintenance and stay current silently.
- ONLY deliberately-pinned aliases can ever generate a review item. A following alias cannot drift.
- The alias-shadow notice (`src/utils/alias-shadow.js`) stops being a scold about a contract the user never knowingly entered, and becomes a report on a choice they actually made.

*Rejected:* everything-pinned (today's shape) — correct and reproducible, but every user carries maximum review burden forever. *Rejected:* split-by-origin (curated names always follow, user names always pin) — fewest concepts, but a user could not override `gemini` without renaming it.

### D2 — `follow` resolves to the SHIPPED PIN, not the live catalog

`curated-models.js:6-7` requires that runtime alias resolution never wait on the network. `follow` therefore resolves exactly as `toDefaultAliases()` does today: static, offline-safe, identical on every machine, no catalog read at resolve time.

Consequence: a following alias picks up a new model when the package is upgraded, not before. New-model awareness is handled by the review queue (D7), NOT by silent re-resolution.

*Rejected:* resolving through the family `idPattern` against the cached catalog. It only works for the 5 `FAMILIES` entries — the 16 `CARDLESS` entries have no pattern — and it reintroduces precisely the "pins as a cache of catalog state" property the file's own docstring forbids. It is also unsafe as written: see §5. *Rejected:* pin-as-floor-with-catalog-upgrade — safe if fully gated, but the most machinery, and still only covers 5 aliases.

### D3 — The baseline reset is deferred and dogfooded

The owner wants to review and reset what the shipped defaults actually are. That is NOT done by hand first. The review engine ships, and the baseline reset becomes its first real job, run by the owner on a machine with real provider keys. Whatever the owner accepts in that session becomes the new curated pin set.

This makes an owner-mode sink a REQUIREMENT, not a nice-to-have (see D8).

*Note:* a live catalog is unreachable from a sandboxed agent session — the egress proxy denies `openrouter.ai:443` and `models.dev:443`, so `models --refresh` returns floor-only and `--check` reports `Catalog unavailable … cannot check` with exit 0 (observed 2026-09-14). Any baseline work must run on the owner's machine or on a GitHub runner.

### D4 — `amicus aliases` is a new, standing command

```
amicus aliases              list — following / pinned, grouped by vendor
amicus aliases --review     picker: walk every proposal
amicus aliases --ui         open JUST the alias pane in Electron
amicus aliases --json       versioned machine-readable document
```

`amicus models --check` stays a pure auditor; its scope does not change. The four existing copy-paste remediation hints are rewritten to point here:

| Site | Today | Becomes |
|---|---|---|
| `src/sidecar/models.js:205` | `amicus setup --add-alias <a>=<id>` | `amicus aliases --review` |
| `src/sidecar/models.js:213` | `amicus setup --add-alias <a>=<id>` | `amicus aliases --review` |
| `src/utils/model-validator.js:162` | `amicus setup --add-alias <a>=<id>` | `amicus aliases --review` |
| `src/utils/alias-resolver.js:42` | `amicus setup --add-alias <a>=provider/model` | `amicus aliases --review` |

*Rejected:* growing `models --check --fix`. It mirrors the `doctor --fix` idiom already in the repo and costs no new command, but `models` is about the CATALOG while aliases are the USER's map, and it leaves no home for "just show me my aliases". *Rejected:* a jump-to step of `setup` — maximum reuse, but "setup" reads as a one-time ceremony, which is exactly why nobody revisits it.

### D5 — A quiet notice, backed by an opportunistic background refresh

One dismissible line on the `update-notifier` rail already running at `bin/amicus.js:101`:

```
  2 alias updates available — amicus aliases --review
```

- The notice is computed from the CACHE only. It never networks inline.
- After a SUCCESSFUL run, if the cache is older than N days (§8), a DETACHED refresh is spawned — same fire-and-forget shape as the post-commit graphify hook, so it can never block or fail a run.
- Suppressed under `--json`, `--quiet`, and non-TTY.
- Per-item dismissal persisted under a `config.aliasReview` namespace (`config.routing` is the precedent for a nested namespace).

*Accepted cost:* this performs network work the user did not explicitly request. It is detached and silent; it must be documented and must be disable-able.

*Rejected:* cache-only with no automatic refresh — honest about cost, but awareness decays silently and the user gets no signal that the signal is missing. *Rejected:* pull-only — zero nag risk, but it puts the whole burden of remembering on the user, which is the status quo that produced this issue.

### D6 — Migration: seeded → follow, divergent → pinned

Existing users hold concrete ids seeded by the setup wizard, not deliberately chosen. On first run after upgrade:

```
for each alias in config.aliases:
  stored === DEFAULT_ALIASES[alias]  →  "follow"    (seeded)
  stored !== DEFAULT_ALIASES[alias]  →  unchanged   (deliberately chosen)
```

**No-op proof:** when `stored === DEFAULT_ALIASES[alias]`, `follow` resolves via D2 to `DEFAULT_ALIASES[alias]` — the same string. Every alias therefore resolves to the identical id it resolved to before migration. Migration day has zero behavioral change; divergence begins only at the next pin bump, which is what following means. This property must be pinned by a test.

*Rejected:* treating all existing aliases as deliberate pins — no migration code and no surprise, but existing users wake up fully pinned, inherit maximum review burden, and reach the low-maintenance path only by hand. *Rejected:* asking once on first run — most respectful, but it interrupts an unrelated run and still needs a silent default for non-TTY/CI, which re-poses the same question.

### D7 — Discovery: mechanical siblings + an owner-curated notable list

Two mechanisms, each doing what it is good at.

**Mechanical (no taste, no noise):** a strictly newer sibling of something the user already pins — same vendor, same family prefix, same tier/variant suffix, higher version. `scripts/check-ci-alias-pins.js :: parsePin` already implements exactly this comparator, tier-safe by construction (`gpt-5.6-terra` is never compared against `gpt-5.6-sol`). It is currently pointed only at `.github/amicus-ci-aliases.json`; it gets lifted into a shared module.

**Editorial (shipped data, owner-curated):** a small `notable` list flagging genuinely new entrants worth an alias, with a suggested alias name. This is the only mechanism that can surface a model the user has no sibling for.

*Accepted cost:* the notable list is ongoing owner work.

*Rejected:* siblings alone — deterministic and zero-maintenance, but structurally cannot surface a new entrant, leaving half the brief unserved. *Rejected:* vendor-scoped (anything new from a vendor you use) — no curation burden, but vendors ship variants constantly (tiers, dated snapshots, `-mini`/`-pro`/`-codex`), so it needs a variant-suppression heuristic, which is the same taste problem hidden in a regex.

### D8 — Pins and the notable list move to a shipped data file; owner mode writes it

`src/utils/curated-models.js` is **exactly 300 lines** and is **not** on the `scripts/check-file-sizes.js` exclude list — it is at a hard wall with zero headroom. The notable list needs a data file regardless. Both move:

```jsonc
// src/utils/curated-pins.json
{
  "pins": {
    "gemini": { "openrouter": "openrouter/google/gemini-3.6-flash",
                "google": "google/gemini-3.6-flash",
                "verifiedOn": "2026-09-14",
                "ruling": "tracks flash-class, not lite" }
  },
  "notable": [
    { "id": "openrouter/newco/atlas-1", "suggestedAlias": "atlas", "note": "new frontier entrant" }
  ]
}
```

`curated-models.js` keeps the MATCH RULES (`idPattern`, `directProviders`, `DIVERGENT_VENDORS`) and the prose, and reads the data file — recovering well under 300 lines in the process. Owner mode writes the JSON directly, gated on repo-detection + TTY + clean working tree; `git diff` is the review surface and nothing ships until the owner commits.

**The safety property is preserved by the picker plus the commit, not by the file format.** A pin still reaches users only after a human accepted it in a review session and committed it. "No pinned guess is better than a wrong one" survives intact.

*Accepted cost:* the owner-ruling comments in `curated-models.js` are load-bearing content — dated verifications, tier-semantics rulings, the `devstral` no-retarget ruling, the `gpt-pro` gatewayOnly ruling. Moving them into `ruling` fields without losing meaning is real, careful work and must not be mechanized. See §8.

*Rejected:* pins stay in source, owner mode emits a patch — no migration risk to the prose, but it means regex-rewriting a commented source file forever, and the 300-line wall still bites on the next comment. *Rejected:* data file but propose-only — reintroduces copy-paste, the exact thing this issue exists to remove, merely relocated to the owner.

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

**Owner requirement (R1):** pins must be easy to SEE, EDIT and REMOVE on both surfaces — "remove" covers both *unpin* (revert to following) and *delete the alias*. The list below therefore shows following-vs-pinned state per row with `[unpin]` and `[×]` controls, and the CLI list must render the same distinction.

*Rejected:* badges in place plus a banner that expands the right groups — one list and the smallest diff, but accepting several means hunting through groups, and a new-model proposal has no row to badge because it is not an alias yet. *Rejected:* a dedicated modal walking proposals one at a time — best CLI parity and room for evidence, but it is a mode you enter and leave, the same trap as the wizard.

---

## 2. Architecture — one engine, two renderers

```
        ┌──────────────────────────────────┐
        │ src/utils/alias-proposals.js     │  PURE. No I/O, no prompts.
        │ (catalog + config + pins) → []   │  Returns proposals.
        └───────────────┬──────────────────┘
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
              user  → setup.js :: addAlias  → config.aliases
              owner → curated-pins.json     (gated, D8)
```

The pure/writer split mirrors the established pattern: detection lives in `src/utils/alias-audit.js`, the write lives in `src/utils/doctor-alias-check.js :: repairAlias`. The engine must stay renderer-agnostic so CLI and Electron cannot drift apart.

**Proposal shape (draft):**

```js
{ alias, kind, current, proposed, candidates: [], evidence: {}, dismissKey }
// kind ∈ 'stale' | 'newer-sibling' | 'notable-unmapped' | 'recommendation-moved'
```

A following alias never produces a proposal (D1/D2). `recommendation-moved` applies only to a PINNED alias whose shipped recommendation has since moved — the "you could go back to following" case.

**Reuse, measured:**

| Existing | Role |
|---|---|
| `src/utils/alias-audit.js :: findStaleAliases` | `kind: 'stale'` |
| `src/utils/alias-audit.js :: suggestReplacements` | ranked `candidates` |
| `scripts/check-ci-alias-pins.js :: parsePin` | tier-safe sibling comparator (lift to shared) |
| `src/sidecar/setup.js :: askQuestion` | readline prompt — no new dependency |
| `src/cli-handlers.js:225` | interactive gate `!!process.stdin.isTTY && !args.json && !args.quiet` |
| `src/sidecar/setup.js :: addAlias` | the user write |
| `src/sidecar/setup.js :: deriveFreeAlias` | suggested alias name for a notable model |
| `electron/setup-ui-alias-script.js :: buildModelSelect` | the grouped `<select>` picker (already exists) |
| `electron/setup-ui-alias-groups.js :: groupAliases` | vendor grouping |
| `src/utils/result-schema.js :: buildAuditDoc` | versioned-document precedent for `--json` |
| `src/utils/atomic-write.js` | owner-mode JSON write |

---

## 3. Size budget (measured 2026-09-14, `wc -l`)

The 300-line gate (`scripts/check-file-sizes.js`, `include: ['src/**/*.js', 'electron/**/*.js']`) applies. Grandfathered exclusions are marked.

| File | Now | Note |
|---|---|---|
| `src/utils/curated-models.js` | **300** | **At the wall, NOT excluded.** D8 must reduce it before anything is added. |
| `src/utils/alias-audit.js` | 266 | 34 free |
| `src/sidecar/models.js` | 268 | 32 free; only hint-line edits planned |
| `src/utils/quick-picks.js` | 150 | safety fix lands here (§5) |
| `src/cli-handlers.js` | 254 | 46 free; `aliases` dispatch |
| `electron/setup-ui-alias-script.js` | 284 | **16 free** — review UI needs a NEW module |
| `electron/setup-ui-aliases.js` | 89 | room |
| `electron/setup-ui-alias-groups.js` | 161 | room |
| `electron/setup-ui.js` | 808 | grandfathered — do not grow |
| `src/sidecar/setup.js` | 756 | grandfathered — do not grow |
| `src/utils/config.js` | 790 | excluded — but keep new state out of it |

New modules must put the `@module` docblock FIRST, then `'use strict'`, keep exports ≤ 5, and be accompanied by a `node scripts/generate-docs.js` run with `docs/architecture-map.md` staged in the same commit. Any commit adding/removing/renaming a file under `src/`, `bin/` or `scripts/` MUST update `CLAUDE.md` in the same commit.

---

## 4. Surfaces

**CLI list** — following/pinned state visible per row, grouped by vendor, pins removable (R1):

```
$ amicus aliases
  Google
    gemini      → google/gemini-3.6-flash        following
    gemini-pro  → openrouter/google/…-3.1-pro    following
  Z.AI
    glm         → openrouter/z-ai/glm-5.3        pinned    ⚠ newer available

  1 update available — amicus aliases --review
```

**CLI review** — a numbered picker, no copy-paste anywhere:

```
$ amicus aliases --review
  [1/2] glm
    currently  openrouter/z-ai/glm-5.3      (pinned by you)
    proposed   openrouter/z-ai/glm-5.4      newer sibling, same tier
               ctx 200k · $0.40/$1.60 per Mtok

    [1] accept   [2] choose another   [3] skip   [4] never ask again
```

**Electron** — D9.

---

## 5. Safety — the gate every proposal must pass

A latent hazard exists TODAY and must be fixed before anything proposes a replacement id:

- `src/utils/quick-picks.js :: pickCurrent` does not filter on `authoritative`.
- `src/sidecar/models.js :: buildFallbackDriftReport` receives a bare catalog array with no `providerFailures` guard.

`src/utils/gateway-route-audit.js :: isAuthoritative` is the hardened pattern that already exists for the per-gateway audit and was never applied here. Consequently a partially-fetched or rejected namespace can make the drift report propose an OLDER sibling — a downgrade. Observed adjacent case, 2026-09-14: OpenRouter returned HTTP 403, `models --check` printed `PROVIDER FETCH FAILED: openrouter (HTTP 403)` then `Catalog unavailable … cannot check`, exit 0.

**Rule:** no proposal may be emitted unless
1. the catalog is FRESH — reuse `doctor-alias-check.js :: isCatalogFresh` and its 24h `MAX_CATALOG_AGE_MS`, the same window `doctor` calls stale;
2. the proposed id's row is AUTHORITATIVE (`authoritative !== false`);
3. the relevant provider is ABSENT from `providerFailures`;
4. the proposed id is a strictly-newer sibling per `parsePin`, never merely "different".

Failing any of these, the engine emits nothing for that alias and says why — it never degrades to a guess. This is the direct descendant of the `doctor --fix` gate: explicit action, narrow unambiguous class, fresh catalog, announce both ids.

---

## 6. Test plan (TDD order)

1. **Engine, pure** — proposal generation per `kind`; a following alias yields nothing; tier-crossing never proposed (`gpt-5.6-terra` ↛ `gpt-5.6-sol`); empty catalog yields nothing.
2. **Safety gate** — stale catalog → no proposals; `authoritative: false` row → no proposal; provider in `providerFailures` → no proposal; older sibling → never proposed. One named mutant per guard.
3. **Migration no-op** — for a config where every alias equals its shipped default, resolution before and after migration is byte-identical across all 21 aliases (D6's proof).
4. **Resolution** — `follow` resolves offline with no catalog read; `DEFAULT_ALIASES` stays static; `__proto__`/`toString`/`constructor` alias names stay safe (the existing `BUILDERPROTO` seed must survive the data-file move).
5. **CLI** — list renders following/pinned; `--review` writes only accepted items; `--json` is byte-clean on stdout; non-TTY path per §8.
6. **Electron** — proposals render in the Needs-review section; accept writes through the same sink; unpin and delete work from the list.
7. **Owner mode** — refuses outside a repo, refuses a dirty tree, refuses non-TTY; writes valid JSON; round-trip through `curated-models.js` yields the expected `toGatewayRoutes()`.
8. **Data-file migration** — every pin and every ruling present in `curated-models.js` @ `b803a2a` is present in `curated-pins.json` after the move; `toDefaultAliases()` and `toGatewayRoutes()` are unchanged, asserted byte-for-byte.

No real network; no real config dir (`tests/setup/hermetic-config-dir.js`).

---

## 7. Sequencing

**Phase 1** — safety gate (§5) · pure engine · `amicus aliases` list + `--review` · migration D6 · hint rewrites D4.
**Phase 2** — `curated-pins.json` move (D8) · owner mode · the baseline reset session (D3).
**Phase 3** — Electron Needs-review section (D9) · `--ui`.
**Phase 4** — passive notice + opportunistic refresh (D5) · notable list (D7 editorial half).

Phase 1 delivers the copy-paste fix on the CLI and is independently shippable. Phase 3 delivers it on Electron. Phase 4 is the awareness layer and should land last, because a notice pointing at an immature picker is worse than no notice.

---

## 8. Open questions

1. **Refresh threshold** — how cold is cold? `MAX_CATALOG_AGE_MS` is 24h for freshness; the background-refresh trigger is a different number and probably measured in days.
2. **`--review` under non-TTY / CI / `--json`** — refuse outright, or list proposals and exit non-zero without prompting? `doctor --fix` declines silently; that may be the wrong precedent for an interactive picker.
3. **`follow` encoding** — bare sentinel string `"follow"` vs `{ mode: "follow" }`. A bare string is simpler and `saveConfig`'s existing invalid-alias stripper already understands string values, but it collides with a user who literally names a model `follow`. Needs a decision before any config is written.
4. **Does accepting a proposal PIN it, or keep it following?** Accepting a sibling upgrade on a pinned alias presumably re-pins to the new id. Accepting `recommendation-moved` should probably convert it back to `follow`. Not settled.
5. **Notice copy, rate limit, dismissal expiry** — does "never ask again" expire when a NEWER model appears, or is it permanent for that alias?
6. **Ruling migration (D8)** — the owner-ruling comments carry dated verifications and explicit no-retarget decisions (`devstral`, `gpt-pro` gatewayOnly, the `gpt` terra/sol tier split). Which become `ruling` fields, which stay as prose in `curated-models.js`, and who verifies nothing was lost. This must not be mechanized.
7. **Does `models --check` keep reporting curated-pin drift** once owner mode exists, or does that reporting move to `aliases --review --owner`? `.github/workflows/model-drift.yml` depends on the current behavior.
8. **Disabling the background refresh** — env var, config key, or both.

---

## 9. Provenance

Issue: [#238](https://github.com/BourbonDog/amicus/issues/238). Decisions D1–D9 adjudicated with the owner on 2026-09-14, one fork at a time; each decision above records the alternatives that were put and declined. Code facts measured against `origin/main` @ `b803a2a`. An earlier round of this design (three options framed around emitting a patch, a CI bot PR, or a pin ledger) was discarded when the owner ruled that anything GitHub-shaped serves only the repo owner and does not survive a second user.
