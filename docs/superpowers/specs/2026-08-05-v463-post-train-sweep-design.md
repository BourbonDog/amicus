# v4.6.3 — "the post-train sweep" — design

**Date:** 2026-08-05 · **Status:** **approved** — scope AND rulings R1–R2 taken (Christian,
2026-08-05); design decisions D1–D10 are mine (veto by editing this doc) ·
**Provenance:** the 2026-08-05 backlog re-triage after the v4.6.2 cut — the release-gate
audit-noise rider (BACKLOG.md's last line), the follow-up riders filed in the v4.6.2 PR bodies
(#95/#96/#100/#102/#105 — several exist ONLY there today), and four verified carries from the
Phase-15/16 and T19 triage sections. Every claim in §3 was re-verified against `main` @
`8d4914f` on 2026-08-05, not carried from the backlog text.

**One sentence:** a correction patch on the v4.6.x line — the models audit stops crying wolf
about deliberate gateway-only routes (and stops suggesting a harmful "fix"), the seats panel's
dead-row logic stops being fooled by roles and pre-v4.6 runs, a stale `get-run` reply can no
longer repaint the wrong run, and a handful of proven small defects and dedups land with tests.

---

## §1 Why (and why now)

v4.6.2's release gate spent real adjudication time on a false positive: `models --check` flags
the curated `gpt-pro` STALE by deriving a direct form (`openai/gpt-5.6-sol-pro`) from a route
that is deliberately openrouter-only — and its `fix:` line suggests retargeting to
`gpt-5.6-sol`, which would silently *downgrade* the alias off its -pro tier. That class of
noise recurs at every future cut until the auditor learns the difference between a routing
choice and staleness (R-line in the release merge; BACKLOG.md final entry).

Meanwhile the dead-seat rows that v4.6.2 shipped (#102/#103) carry two known correctness gaps
their own PR bodies filed: the D6 "zero usable legs" suppression is keyed on model alone, so a
model that is dead *as critic* but alive *as chair* never gets its dead row (the exact loss
v4.6 exists to announce); and a pre-`degrades[]` run renders no dead rows at all even when its
`verdict.json` carries the evidence. Plus a third instance of the F09 stale-reply class
(`openRun`'s own `get-run` fetch — flagged twice independently, T19-m5 and the #102 review),
sighted-but-unfixed since v4.5.

None of this is feature work. All of it is "something already shipped states something wrong or
misses something it promised" — the v4.4.1 patch bar.

## §2 Rulings needed (owner) + design decisions (mine)

| # | Ruling — TAKEN (Christian, 2026-08-05) |
|---|---|
| **R1** | **RULED: error.** `-o`/`--out` with no following value (`council verdict -o` as the last token previously wrote a file literally named `true`) → `BAD_ARGS`, the flag named in the message, exit 1, `--json` enveloped — the unknown-flag precedent. A (tiny) behavior change on a shipped CLI; recorded for the CHANGELOG. |
| **R2** | **RULED: author the direct route.** The fable CARDLESS entry gains `anthropic: 'anthropic/claude-fable-5'` (the sonnet/haiku shape). Basis, re-verified 2026-08-05 (§3): the `GATEWAY DIVERGENT: fable has no direct form; catalog confirms anthropic/claude-fable-5` line was a **TRUE report, not noise** — the v4.6.2 release-gate "same family as gpt-pro" adjudication was wrong for fable; Anthropic's live `/v1/models` lists it AND the direct route serves (smoke wave `47278069`). The audit line resolves by becoming true — no annotation needed for fable. **CHANGELOG ripple:** fable now routes **direct-first** when an Anthropic key is present (was openrouter-always), and its pinned display/default route follows the authored direct form via `toDefaultAliases`. PR1 also de-stales the three "fable is OpenRouter-only" comments (§3). |

Design-level decisions:

| # | Decision |
|---|---|
| **D1** | **Audit fix = provenance, not derivation removal.** `directFormFor()`'s derived direct form stays available to the router (direct-first routing is load-bearing; catalog tri-state already guards execution). What changes: `toGatewayRoutes()` (or a sibling accessor) exposes whether each `direct` form was **authored or derived**, and deliberately-gateway-only curated entries carry an explicit annotation in `curated-models.js`. **The annotation list is exactly `gpt-pro` today** — re-verified 2026-08-05: `codex` needs nothing (its derived `openai/gpt-5.3-codex` validates against the openai namespace — no STALE fired on today's real catalog), and `fable` is R2's subject (verified direct path — author or annotate, not assume). The auditors consume the provenance. |
| **D2** | **A derived direct form absent from its namespace, while the authoring openrouter route is catalog-valid, is NOT stale** — no STALE row (flat audit or gateway audit), no `fix:` suggestion, no candidates list. An **authored** direct form absent from its namespace remains STALE exactly as today. The flat audit's pinned-route line (`toDefaultAliases` → `routes.direct \|\| routes.openrouter`) follows the same rule. |
| **D3** | **The D6 dead-row suppression becomes role-aware.** `deadSeats()` suppresses a dead candidate only when the live map has a usable leg for that model **in a reviewing role** (`seat`/`critic`/`lens:*`) — a chair or judge cost row no longer masks a dead reviewer. Rides the same seam: dead candidates gain a `role` (from the degrade record's channel/data; `criticRequested` ⇒ `'critic'`), which also closes the #102 rider "thread role:'critic' into the dead row's role cell". |
| **D4** | **Old-run resilience is a fallback union, not a rewrite.** `deadSeats()`'s inputs widen: when `run.degrades` is absent/empty, consult `verdict.degrades` (run-degrade.js swallows checkpoint write failures, so verdict.json can carry records run.json lost); and `seatLoss.deadBenchSeats` (the pre-`degrades[]` v4.5.2 shape) feeds candidates the same way `criticRequested` does. Same de-dup, same D6 filter. No schema change anywhere. |
| **D5** | **The openRun guard copies the house pattern verbatim** — capture `runId` at issue, first line of the `.then`: bail if `state.runId` moved on (the F09 fix shape already used twice in `workspace-app.js`'s own debate sub-fetch and `workspace-panels.js:110`). |
| **D6** | **The registry pre-check asserts the body, fails toward publishing.** The skip fires only when HTTP 200 **and** the response body's version field equals `$VERSION`; any curl/parse failure keeps today's `\|\| true` routing and proceeds to publish (fail-safe direction unchanged — the check exists to skip, never to block). |
| **D7** | **The save-time shadow notice is additive.** `council save` gains `shadowsBuiltin` on its result doc when the name matches a built-in bench (`free`/`budget`/`frontier` — sourced from `council-presets.js`, not hardcoded), rendered as a one-line notice beside the existing `(overwritten)` marker. `--json` carries the field; exit codes unchanged. |
| **D8** | **The metadata tmp sweep extends the existing pattern, not a new one.** Same age-gate (60s), same list-then-unlink shape as `session-index-tmp-sweep.js`, applied to `.metadata.json.*.tmp` orphans in per-session dirs; registered as a `doctor --fix` heal through the existing collector vocabulary (confident voice — an atomic-write tmp orphan has no other producer; the sweepSessionIndexTmp ruling, 2026-08-03, applies verbatim). |
| **D9** | **Extraction-first honored where it binds.** `src/sidecar/models.js` is **292/300** and carries PR #100's own "next edit extracts first" rider — if the audit rendering needs any edit there, the extraction (receiver: a `models-render.js` sibling, or fold into the existing probe/format helpers) lands as its own commit first. `workspace-verbs.js` (294/300) is touched only by line-**negative** edits (indexOf → helper); if any edit there turns line-positive, extract first per the house rule. |
| **D10** | **Dedup batch ships only where a consumer exists this PR** — `isTerminal(status)` on `AmicusLive` (3 verified literal `TERMINAL_STATUSES.indexOf` sites converge), `seatCellClass(i)` in `workspace-render.js` (3 copies of the td-class ternary converge), a per-site `waveId` const in `run-chair.js` (3 sites × 2 literals), and one shared `makeBaseDeps()` test helper consumed by the doctor-family suites (56 `baseDeps` occurrences across 11 files today; consolidate the doctor-family definitions, don't chase all 11 in one pass). |

## §3 Measured reality (verified against `main` @ `8d4914f`, 2026-08-05)

**The audit false positive, mechanism confirmed live:**
- `curated-models.js:184-189` (`directFormFor`) derives a direct id for any non-divergent
  vendor by prefix-stripping the openrouter route; `gpt-pro` is CARDLESS with an authored
  **openrouter-only** route (`:80`), so its "direct" form is pure derivation.
- `gateway-route-audit.js:71-82` audits BOTH forms from `toGatewayRoutes()` with no
  authored-vs-derived distinction → `GATEWAY STALE (direct): gpt-pro -> openai/gpt-5.6-sol-pro`.
- The flat audit's pinned route (`toDefaultAliases`, `curated-models.js:229-235`) is
  `routes.direct || routes.openrouter` — i.e. the derived form — → the top-level
  `STALE: gpt-pro …` row **with the harmful `fix: … gpt-pro=openai/gpt-5.6-sol` suggestion**
  (a tier downgrade off sol-pro). Reproduced today: `node bin/amicus.js models --check` prints
  both rows + the fable divergent-missing line; exit 0.
- The openrouter route itself SERVES — live probe `d28cab32` ("SMOKE OK", 8s, $0.35) at the
  v4.6.2 gate. ⚠️ Do not re-probe sol-pro casually; that one leg costs ~$0.35.

**fable re-verification (2026-08-05, this draft session) — the divergent-missing line is TRUE,
not noise:**
- The hardcoded floor (`model-fetcher.js:18-29`) has **no fable row** — its docblock even says
  fable "must never appear here" — and floor rows are tagged `authoritative: false`
  (`:123-125`). The cache's 11 anthropic-namespace rows carry `authoritative: undefined`
  (= live-fetched; `ANTHROPIC_API_KEY` is configured) and **include
  `anthropic/claude-fable-5`** — so Anthropic's own `/v1/models` lists it. The listing
  includes dated snapshot ids the floor doesn't have, confirming a real fetch.
- **Serve-proven, not just listed** (the gemini lesson): `fanout --models
  anthropic/claude-fable-5 --gateway direct` with `ANTHROPIC_BASE_URL` unset → "SMOKE OK",
  complete, 10s, wave `47278069`. ⚠️ **$0.7239 for the one tiny leg** — fable direct is the
  priciest probe on record (~2× sol-pro); do NOT re-probe casually, and do not re-run this —
  the evidence is banked here.
- Stale comments PR1 corrects regardless of R2's ruling: `curated-models.js:161-163` (the
  DIVERGENT_VENDORS docblock's "OpenRouter-only today (e.g. fable)" example) and `:224-227`
  (the toDefaultAliases docblock's "OpenRouter-only models (`fable`)" example), plus
  `model-fetcher.js:11-15` (the floor docblock's justification clause — the floor **exclusion
  itself stays correct**: the floor exists for keyless validation, and a keyless user cannot
  route direct-anthropic regardless; whether fable joins the floor is a plan-time detail,
  not a requirement).
- The v4.6.2 release-merge BACKLOG rider's closing clause ("Same family: 'fable has no direct
  form' divergence line") is **half-wrong** — §9's transcription pass amends it to record this
  re-verification.

**The seats-panel gaps, in shipped code:**
- `live-model.js:139-175` (`deadSeats`): the D6 filter keys `live[s.modelInput || s.model]`
  on **model alone** (`:164-174`) — any cost row (chair, judge) marks the model live.
  `seatsFromRunStats` (`:90-98`) already composes role into row ids (the F37 note is at
  `:93-97`); the dead-candidate side carries no role at all (`:142-148` — statusText only).
- `seatLoss` consumption is `criticRequested`/`criticSeated` only (`:161-163`);
  **`deadBenchSeats` is unconsumed**. `renderSeatsPanel` passes `d.run.degrades` only
  (`workspace-seats.js:51`); **`verdict.degrades` is unconsumed**.
- Mid-poll rendering is DONE — #103 removed the terminal gate (history header,
  `workspace-seats.js:25-39`). This spec builds on that, it does not revisit it.
- The td-class ternary has 3 copies: `workspace-seats.js:91`, `workspace-render.js:200`,
  `workspace-render.js:208`. `TERMINAL_STATUSES.indexOf` literal sites: `live-model.js:42`,
  `workspace-verbs.js:69`, `workspace-app.js:149`.

**The stale-reply hole:** `workspace-app.js:66-93` — `openRun`'s `workspace:get-run` `.then`
writes `state.detail = detail` and repaints with **no** `state.runId === runId` check
(`:69-70`), while its own debate sub-fetch four lines down IS guarded (`:83`, `:86`) and the
review comment at `:76-80` names the class. Two opens racing = one run's files under another
run's identity.

**The CLI nits:** `cli-handlers-council.js:165` — `args.out || './verdict.json'` in the
verdict rebuild; the parser records a valueless trailing `-o` as boolean `true` (truthy →
literal filename `true`). `presets-cli.js:47-61` — `overwritten = !!getCouncil(name)` and
`renderSave` know nothing about built-in bench names; built-ins live in
`utils/council-presets.js`.

**The pipeline check:** `.github/workflows/publish.yml:119-125` — the MCP-Registry skip keys
on `STATUS = "200"` alone; the body (which carries the version) is discarded
(`curl -s -o /dev/null`).

**The sweep target:** `utils/session-index-tmp-sweep.js` (81 lines) is the pattern;
`writeFileAtomic`'s per-session `metadata.json` writes (~30 sites across `mcp-server.js`,
`session-manager.js`, `utils/session-abort.js`, fanout/wave paths — Phase-15 entry) orphan
`.metadata.json.<pid>.<hex>.tmp` on a kill between tmp-write and rename; nothing sweeps them.

**Verified stale-done during this triage (tick, don't build):** the Phase-20 "model-resolution
failures bypass the `--json` envelope" item — `start-helpers.js:69-78` (and its two sibling
exit sites) already route through `failJson(BAD_MODEL)` under `--json`. Likewise the earlier
chips for devstral removal, the opus fallback pin, and the TIERS.openai 5.6 regexes are all
already in current source. These get checkboxes/strikethroughs in BACKLOG.md, no code.

**File sizes measured today (the gate is 300):** `models.js` **292** (#100's extract-first
rider ACTIVE) · `workspace-verbs.js` **294** · `workspace-panels.js` **294** ·
`workspace-render.js` ~287 · `workspace-app.js` 262 · `workspace-seats.js` 117 ·
`live-model.js` 183 · `run-chair.js` 219 · `alias-audit.js` 162 · `curated-models.js` 239 ·
`cli-handlers-council.js` 228 · `session-index-tmp-sweep.js` 81. (`cli-handlers-run.js` is
300/300 but nothing in this scope touches it.)

**Plan-time pins** (each PR's plan re-measures per the anti-rot rule): the exact
`toGatewayRoutes()` consumer list (router included) before adding provenance; the parser's
valueless-flag behavior for `-o` (and whether any other `--out`-family flag shares the hole);
`getCouncil`'s built-in fallback semantics; the registry response body's actual JSON shape;
the degrade record fields available to carry `role`; all file sizes.

## §4 PR1 — the audit learns "routing choice" (Tier-1 #1)

`curated-models.js`: gateway-only entries gain an explicit annotation (shape at plan time —
either a `gatewayOnly: true` field on the CARDLESS/FAMILIES entry or an authored-forms
accessor); `toGatewayRoutes()` (or a sibling) exposes authored-vs-derived per form. The
comment on each annotated entry states the owner ruling it encodes (the 2026-08-05 release
merge rider).

`gateway-route-audit.js` + `alias-audit.js`: per D2, a derived-direct miss with a
catalog-valid openrouter sibling produces **no STALE finding on any surface** — flat row,
gateway row, and `fix:`/candidates all suppressed together. Authored-direct misses unchanged.
Per R2 (ruled): fable gains the authored `anthropic: 'anthropic/claude-fable-5'` route, and
the three stale "OpenRouter-only" comments (§3) are corrected. If `models.js`'s rendering
needs a new line kind, D9's extraction lands first.

Acceptance: `models --check` on today's real catalog prints **zero** STALE lines for
`gpt-pro` and no retarget suggestion; a test pins the harmful-suggestion regression
specifically (derived-direct miss must never emit a `fix:` line); an authored-stale fixture
still reports STALE; **the fable divergent-missing line is gone by truth — the authored route
matches the catalog — never by blanket suppression of the divergent-missing class** (a
fixture pins that an unauthored genuine miss still reports); exit codes byte-identical.

## §5 PR2 — the seats panel stops being fooled (Tier-1 #2, #4 + Tier-2 pair + dedup)

All in `electron/workspace-ui/` + `live-model.js` — one lane, one PR, so the near-cap files
see exactly one coordinated edit pass.

- **Role-aware D6 (D3).** Dead candidates carry `role`; the live map keys become
  role-qualified; suppression requires a usable leg in a reviewing role. The dead critic's
  role cell renders `critic`. Fake-DOM tests: dead-as-critic + alive-as-chair renders the dead
  row (the exact #102-rider scenario, RED against today's code); recovered-seat suppression
  still holds (the existing D6 pin must not regress); the F36 alias-vs-resolved-id matching
  keeps its test.
- **Old-run fallback union (D4).** `verdict.degrades` consulted when `run.degrades` is empty;
  `seatLoss.deadBenchSeats` feeds candidates. Fixtures: a v4.5.2-shaped run doc (no
  `degrades[]`, populated `seatLoss.deadBenchSeats`) renders its dead bench rows; a
  checkpoint-loss shape (verdict has records, run doesn't) renders from the verdict.
- **openRun stale-guard (D5).** Capture-and-bail, plus a test racing two opens (the T19-m1
  pattern in the same suite family).
- **Dedup (D10):** `AmicusLive.isTerminal(status)` + the 3 call-site conversions
  (line-negative in `workspace-verbs.js`); `seatCellClass(i)` in `workspace-render.js` + the
  3 conversions (`workspace-seats.js` imports it — its copy was the third).

## §6 PR3 — CLI + doctor odds-and-ends (R1 + Tier-2)

- **`-o` valueless (R1: error).** `runVerdict` (and any sibling the plan finds sharing the
  hole) validates `args.out` is a string when present; `-o` as a trailing bare flag →
  `BAD_ARGS` with the exact flag named, `--json` enveloped. Test: `-o` last token errors;
  `-o path` and default-path behavior unchanged; no file named `true` can be created.
- **Save-time shadow notice (D7).** `presets-cli.js` save path computes `shadowsBuiltin`
  against the built-in bench names; render adds the notice line; `--json` gains the field.
  Tests: saving `budget` notices; saving a novel name doesn't; overwrite + shadow compose.
- **Metadata tmp sweep (D8).** New `utils/session-metadata-tmp-sweep.js` (the 81-line sibling
  as the template), wired as a `doctor --fix` heal through the collector (`doctor-fix`
  channel, confident voice per the 2026-08-03 ruling). Tests: age-gated (fresh tmp survives),
  orphan swept, heal announced in the one voice, `--fix`-only (plain doctor reports, never
  deletes — matching the sibling's contract).

## §7 PR4 — pipeline + test hygiene (Tier-1 #3 + Tier-2 dedup)

- **Registry pre-check body assert (D6).** `publish.yml`: capture the body, extract the
  version field, skip only on 200-with-matching-version; every failure path keeps the
  fail-toward-publish routing. `tests/scripts/publish-workflow.test.js` extends its existing
  step-scoped pins to the new assertion (and this is the natural moment to land the Phase-11
  step-scoping cleanup items *for that file only* if the diff is already open there — optional,
  plan's call).
- **`run-chair.js` waveId const** — 3 sites, 2 literals each → one const per site. Zero
  behavior; the #105 lockstep suite already pins the record shape.
- **`makeBaseDeps()` shared helper** for the doctor-family suites (the ~8-file cluster #96
  named; `engine-*.test.js`'s local variants stay if their shapes genuinely differ). The
  helper must preserve #96's semantics exactly: full allGood-shape pins + the `env: {}`
  forward-pin. Suites' assertions stay byte-unchanged — this is fixture plumbing only.
- **README accuracy review** *(owner scope addition, Christian, 2026-08-05)* — a
  claim-by-claim pass over `README.md` against shipped behavior, the same
  verify-the-premise discipline that caught the v4.5.4 "Electron window is npm-only"
  falsehood. Sweep for: v4.6.x-era drift (degrade announcements, dead-seat rows,
  `models --check --live`, the fable/gpt-pro routing story where the README mentions
  models), install/quick-start claims, and command output examples that no longer match.
  Corrections land in PR4; anything bigger than a correction (restructuring, new
  sections) is reported as a finding for an owner call, not built. The docs gates
  (`validate-docs`, docs-driven suites) bound the blast radius.

## §8 Testing

TDD throughout (superpowers flow; RED proven against today's code for every behavior claim —
the role-suppression scenario, the stale-reply race, the valueless `-o`, the derived-STALE
suppression). Full suite + lint + sizes green per PR; the pre-push hook re-runs the suite
(≥5-min push timeout, per the standing ops note). Live money: **none required** — every item
is provable with fixtures; the one probe-adjacent surface (PR1) is validated against the real
catalog with `models --check` (free, no `--live`). Do not re-probe `gpt-pro` (~$0.35/leg) or
`fable` direct (~$0.72/leg) to prove what `d28cab32` and wave `47278069` already proved.

## §9 Docs (each PR carries its own)

Per-PR `CHANGELOG.md [Unreleased]` entries (sequential PRs — union on conflict per the #91/#92
lesson). PR1 updates `docs/usage.md`'s models --check section (the routing-choice suppression
is user-visible) and CHANGELOG-notes the fable routing change (direct-first with an Anthropic
key — R2's ripple). PR3 documents the `-o` error (R1). Release-cut docs pass additionally: tick the verified stale-dones in BACKLOG.md (§3's list, incl. Phase-20
`--json` envelope); correct `docs/ROADMAP.md`'s v4.7 candidate line (LC-5 shipped in #105;
CA-4 = "failed-chair half closed, repair solos remain"); and **transcribe the still-open
riders from the #95/#100/#102/#105 PR bodies into BACKLOG.md** — a deferral that exists only
in a closed PR's text is the same lost-deferral class the backlog itself warns about.

## §10 Out of scope (stated so nobody re-litigates)

The tight-file extraction pass and KNOWN_VARIABLES single-sourcing (v4.7 kickoff hard gates —
unless Christian pulls the extraction pass forward as its own zero-behavior PR, which this
spec neither needs nor blocks); SL-1 (measure first), SL-3 (open by ruling, awaiting field
data), SL-4 (layout change); GOA-1..8 (feature work, own spec); the `--live`-when-catalog-
unavailable flip (open owner decision on #100 — flipping it is one line once ruled); walkCut
ceiling voice + the remaining #105 comment riders (transcribed to BACKLOG by §9, not built);
the workspace-ui no-var rewrite; `--dry-run` cost preview; probing curated defaults.

## §11 Release

v4.6.3 cut after PR4 lands (or earlier partial on owner call): CHANGELOG roll-up, standard
recipe (docs/publishing.md), full gates + keyless + live rails green. Expected user-visible
deltas: `models --check` stops flagging deliberate gateway-only routes (and stops suggesting
the sol downgrade); **fable gains an authored direct route and routes direct-first with an
Anthropic key (R2)**; dead-seat rows correct across roles and on pre-v4.6 runs; a save that
shadows a built-in says so; valueless `-o` errors (R1); `doctor --fix` sweeps metadata
tmp orphans; the registry skip-check verifies the version it trusts.
