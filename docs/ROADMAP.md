# Amicus — reprioritized roadmap

**Reprioritization guidance (Christian, 2026-07-18):** engine-first is locked; the near-term work
ships as an incremental **4.x point-release line**, each rev delivering a **behavioral / feature
benefit users feel**. The observability arc is split so the **data layer ships first (v4.3)** and
the **Electron "Council Workspace" (v4.4)** rides on top of it. `--dry-run` cost preview dropped to
the backlog.

**Amendment (Christian, 2026-08-05): enterprise-readiness leaves the rev pipeline.** It was carried
here as a numbered **v5.0** heading, which made it read as *scheduled work with a version reserved
for it* — a commitment the product cannot make while it is gated on funding and a cofounder. It now
lives under **Backlog (tracked, not scheduled)** with everything else that is real but unscheduled.
Nothing about the content changed and no judgment about its value is implied; only its status. When
an org buyer and the org to support them exist, it earns a number then.

Amicus is at **v4.13.0** (2026-09-18). Each 4.x rev below leads with the benefit, not the
plumbing; the v4.9.x patch releases carry no section of their own, because each corrected a
defect rather than adding scope — where one added a surface (v4.9.4's `--thinking` refusals and
`output-budget` doctor row, v4.9.5's Electron digest gate, v4.9.6's artifact custody, v4.9.7's dual name-table rescue boundary, v4.9.8's per-run seat tool allowlist and its unverified/refused seat census) it did so to
make an existing promise true, not to widen it. v4.10.0 added a surface (`amicus aliases`) and
v4.11.0 finished it (owner mode, the setup window's Needs-review section, the once-a-day notice),
v4.12.0 added one of its own (the CI council's credit preflight), and v4.13.0 changed what a
shipped one does (the no-output backstop asks the engine before it kills), so each gets a
section. See `CHANGELOG.md` for what each one contained.

**Status:** v4.0 through **v4.13.0** have **shipped**, plus the v4.9.1–v4.9.8 patch releases —
everything on this page is a record of what landed, not a plan. Composition — the scope that
carried the number v4.6 here until the degrade-announcement-invariant milestone took the v4.6.0
release (2026-08-02) — is now an unscheduled candidate for the next rev, tabled in its own section
below (dropped from v4.7, 2026-08-05); its contents are decided at kickoff per the anti-rot rule,
not assumed in advance. There is **no numbered major** on this roadmap.

> 📁 **Reading this from an npm install?** Some references below point at working documents that
> live in the git repository and are deliberately **not** in the published package — anything under
> `.superpowers/` (the SDD working area, gitignored) and the root `BACKLOG.md`. The npm tarball
> ships `docs/*.md` only. Read those files at
> [github.com/BourbonDog/amicus](https://github.com/BourbonDog/amicus); the `.superpowers/` ones are
> local-only working notes and are not published anywhere. Every claim this roadmap makes is
> summarized here — the pointers are provenance, not prerequisites.

---

## v4.0 — "Councils become a command you can trust" *(foundation — engine-first)* — ✅ SHIPPED v4.0.0, 2026-07-20
**Benefit:** the flagship council stops being a manual 6-stage ritual — run a real adjudicated
council headlessly and in CI, and trust the output enough to gate on it.
- **Headless council orchestration engine** + `council run --headless` + `amicus_council_run` MCP — B1/A2/D2/F1 *(L)*
- **Council Review GitHub Action v2** (real adjudicated verdict on PRs) — B2 *(M)*
- **Versioned JSON envelope + published schema**, all failures routed through it — D3/C3 *(M)* — the engine's trustable contract
- **Prompt-injection fencing on JSON MCP tools** (H9) — A5/C6/D5 *(S)* — required before councils chew on untrusted CI content
- **Per-run fold nonce** (BL-7) — C5/D4 *(S)* — correctness/safety
> Why here: the engine is the moat and everything downstream (CI, automation, dashboards) needs it. The 3 cheap trust fixes ride along because a council you can't trust in automation isn't automatable.

## v4.1 — "The skill sheds the ritual" *(skill-on-engine fast path)* — ✅ SHIPPED v4.1.0, 2026-07-21
**Benefit:** the daily interactive council stops being a manual 6-stage ritual too — the
second-opinion skill delegates Stages 1–3+5 to `council run` and keeps only the human stages
(0 intake, 4 decisions, 6 lessons).
- **Skill fast path** — SKILL.md orchestration rewired onto `amicus council run` *(M)*
- **Debate mode headless** (Stage 2.5 rebuttal round in the engine; here or v4.2 at the latest) *(M)*
- **README + docs update** — skill fast path and headless debate mode reflected in `README.md` and `docs/council.md` *(S)*
> Why here: locked during the v4.0 design (2026-07-19) — the engine proves itself in CI first
> (v4.0), then the flagship interactive UX adopts it before any new feature front opens.

## v4.2 — "Bring your own models — $0, private, offline" — ✅ SHIPPED v4.2.0, 2026-07-23
**Benefit:** run sidecars and councils on local / OpenAI-compatible models (Ollama, LM Studio, vLLM)
— free marginal cost, private, air-gapped. The single biggest adoption + cost unlock (5 of 6 lenses' #1).
- **Local / OpenAI-compatible provider support** — `baseURL`/`type` discriminator, `$0`/offline pricing tier, setup-wizard support — A1/B3/C1/D1/E1 *(L)*
- **Adoption polish** (rides the "easy to start" story): `amicus init --claude` (C2), `doctor` at end of setup wizard (C8), docs for `spend`/`doctor`/`key` (C10) *(S)*
- **README + docs update** — local / OpenAI-compatible provider setup + `$0` pricing tier in `README.md` and `docs/configuration.md` *(S)*
> Why here (not enterprise): local models are a broad user benefit — cost, privacy, offline — not an enterprise-only feature. Comes right after the engine so councils can run on free/local seats.

## v4.3 — "See runs live in the terminal — and never waste one" *(observability data layer, first)* — ✅ SHIPPED v4.3.0, 2026-07-24
**Benefit:** watch runs in real time in the terminal, recover from dead legs, and see where every dollar went.
- **Live wave observability data layer** + CLI/TUI `amicus watch <waveId>` + `--follow` streaming + `--on-complete <exec|mcp-notify>` hook — F3/D6 *(M)* — the shared data layer v4.4 builds on
- **Failed-leg retry** `fanout --retry-failed <waveId>` + **cheaper-model fallback chains** + failed-leg partial-spend tracking — F2/E10/E8 *(M)*
- **Spend visibility & attribution (basic):** fix continue/resume zero-spend rows, attribute waveId/council/project on every row, queryable `spend query` — A4(basic)/E3/E4/E9/D7/C9 *(M)*
- **README + docs update** — `watch`/`--follow`, failed-leg retry, and `spend query` documented in `README.md` and `docs/usage.md` *(S)*
> Why here / why first: this is the observability data layer + terminal surface. It ships **before** the GUI (v4.4) because the desktop workspace is a front-end on exactly this data. All M-effort, so it lands fast.

## v4.4 — "The Council Workspace" *(desktop GUI on the v4.3 data layer)* — ✅ SHIPPED v4.4.0, 2026-07-26
**Benefit:** the same live data as a rich desktop app — watch a council *think*, not just tail a log.
- **★ Electron "Council Workspace" GUI** — live reviewer progress, anonymized peer packets, adjudication tiers, dissent, cost-by-seat, one-click fold into Claude Code — **B9** *(L)*
- **README + docs update** — Council Workspace walkthrough + screenshots in `README.md` and `docs/` *(S)*
> Why here: a GUI layer on top of v4.3's data layer. Split into its own point release because it's the one **L-effort** build in the observability arc — keeping v4.3 small and shippable.
>
> The five paid gate councils run against it (`wsgate01`–`wsgate04`, `costgate01`) are also what
> produced the 4.4.1 backlog below: the GUI shipped, and running real money through it is what
> surfaced the cost-attribution and repair-path defects that patch closes.

## v4.4.1 — "What the gate councils found" *(fast-follow patch on 4.4.0)* — ✅ SHIPPED v4.4.1, 2026-07-27
**Benefit:** the product stops mis-stating its own spend, a repair leg stops fabricating findings,
and a review that honestly finds nothing stops being an error.
- **Cost truthfulness** — subtree-unknown spend carried into the ledger, the sticky unknown-spend notice unstuck, a cache-only leg reported `unknown` rather than falsely free, and `--max-cost` degraded to exit `2` when the total is inexact rather than claiming a percentage it cannot know — CA-2/CA-3/CA-6/CA-7 *(M)*
- **The repair path, whole** — all four remaining repair-prompt builders now carry the artifact they are repairing, and a repaired review no longer splices two generations together — LC-12/LC-11 *(M)*
- **A clean review is a valid review** — `EMPTY_FINDINGS` accepts a well-formed empty set, and the tally, street-cred and chair degrade gracefully on an all-clean bench — LC-10 *(M)*
- **One OpenCode server per council run** — concurrent waves no longer race each other's SQLite open, which was making `--critic` a coin flip *(M)*
- Renderer, progress and leg-row robustness; `electron/` under the lint gate; the read-only-workspace invariant test; live rails green as documented *(S each)*
> Why a patch and not a rev: every item is a correction to something already shipped, all of it
> measured against real paid runs. Two behaviour changes ride along (LC-2's session abort at the
> tool-settle ceiling, LC-10's acceptance of an empty finding set) — both owner-ruled, both
> corrections rather than new capability. Scope, rulings and the full 61-item inventory live in the
> repo's working notes (`.superpowers/sdd/v441/backlog-and-proposal.md`, local-only) and in the
> repo's root `BACKLOG.md` — neither ships in the npm package; see the note at the top.

## v4.5 — "Save and share your councils" *(scope split 2026-07-27 — composition moved to v4.6)* — ✅ SHIPPED v4.5.0, 2026-07-28
**Benefit:** complex councils become one-command, repeatable, and shareable — and the flagship GUI
stops hiding. Design: `docs/superpowers/specs/2026-07-27-v4.5-save-and-share-design.md`.
- **★ Auto-open the Council Workspace on a council run (Christian, 2026-07-26)** — when a council is
  invoked from Claude Code (local) and Electron is already present, the Workspace window opens by
  default instead of requiring a separate `amicus watch <runId> --ui`. Today the GUI is opt-in and
  discoverable only from `watch --help`, so the flagship v4.4 surface goes unseen on the very
  client best able to show it. *(S–M; the pieces exist — see the design notes below.)*
- **Council policy packs + full run-profiles** (bench + lenses + options + briefing template, invoke by name) — B7/F5 *(M)*
- **Briefing templates + library** (F9) *(S–M)* — the foundation packs reference; the `{{input}}`
  chaining variable and the `critique`/`refine` built-ins arrive with the composition rev (now v4.7)
- **Ride-along fixes** — FR-1 (a failed council seat can render perpetually live), the FR-2 ruling,
  RN-1/RN-5/RN-11 Workspace renderer fixes, TST-3 real-CDP abort pass *(S each; dispositions for
  all 17 open items are tabled in the design doc's §8)*
- **README + docs update** — policy packs, the template library, and auto-open in `README.md` and `docs/` *(S)*
> Why here: save/share velocity multipliers that only pay off once councils are a command (v4.0)
> and observable (v4.3/v4.4); auto-open makes the v4.4 surface discoverable on its best client.

## v4.6 — "A loss announces itself" *(the degrade announcement invariant)* — ✅ SHIPPED v4.6.0, 2026-08-02
**Benefit:** a council run can no longer degrade quietly — every loss states what was lost, why,
and what it does to the run, in one voice, on every surface (stderr, `run.json`, `verdict.json`,
the report, `doctor`). The north star made mechanical: a correct-but-silent degrade fails the bar
as hard as a crash.
- **The ten-channel degrade announcement contract** — every loss routes through one sink
  (`src/council/run-degrade.js`, the only code allowed to flip `degraded.value`, enforced by a
  source-scan invariant test) and lands with mandatory what/why/effect on every surface, including
  the report's new **"What was lost"** section — #85 *(L)*
- **`verdict.seatLoss` derived from the degrade records** (#84 — a dead critic *leg* finally flips
  `criticSeated`; the v4.5.2 seatLoss suites passed byte-unedited) + **Stage-2 judge legs get
  `runStats` cost rows** (#83 — per-leg attribution for ~38% of a run's spend that had none) *(M)*
- **`doctor` speaks the vocabulary** — `doctor --json` gains additive `degrades[]`, `--fix` prints
  `Recovered:` lines in the one voice, and the engine hints state causes as **unverified** instead
  of asserting an antivirus guess *(M)*
- **Workspace discoverability from the CLI** — `watch` usage names `--ui` (#80), a CLI council run
  with Electron present prints how to open the live Workspace (#81), `watch --ui` against an
  `--out-dir` run names its cause (#82), and the Stage-5 verdict rebuild preserves
  `seatLoss`/`degrades[]` (#87) *(S each)*
- **Deliberate behavior changes** — dropped preset members and shared-server acquisition failures
  now exit degraded (2) on every transport; judge rows raise reported cost totals vs v4.5.x
  (`runStats` consumers keying by model must exclude `role: 'judge'`).
- **Docs** — the full record is `CHANGELOG.md` §4.6.0; spec
  `docs/superpowers/specs/2026-08-01-degrade-announcement-invariant-design.md`; plans 1–4 under
  the v4.6 degrade-invariant plans (pruned at the release cut; see git history for the branch).
> Why it jumped the queue (2026-08-01): the v4.5.x field reports showed the engine was not losing
> legs (11 four-seat council runs on v4.5.4, 10 clean) — but when a seat *was* lost, nothing told
> the user which one. That silent-degrade class was ruled a north-star violation and took the rev
> number; the composition scope below moved to v4.7.

**v4.6.1 (shipped 2026-08-03):** the follow-on point release — **SL-2** ("a lost seat gets one
more chance": the once-only Stage-1 retry with `Recovered:` heals, ruled heal-first off SL-3),
the **MCP update notice**, the `rebuildElectron` hint deletion, and the **fold-back-corrected
MODEL-NOTES seed** (PR #93). Ninth consecutive first-attempt publish.

### v4.6.1 / v4.6.2 — the field-report five *(patch train)* — ✅ SHIPPED v4.6.2, 2026-08-05
Field-report-driven hardening in five sequential PRs plus one ruling follow-up: the
`ANTHROPIC_BASE_URL` diagnosis pair (doctor row + host-form normalization) and stored-alias
drift warning (#95); doctor-suite hermeticity (#96); the no-output backstop —
`AMICUS_NO_OUTPUT_BACKSTOP_MS`, legs that produce nothing fail fast with a real reason (#99);
`models --check --live` — one quiet paid wave proves stored aliases actually SERVE (#100);
Workspace dead-seat rows — an announced-dead seat renders on the seats panel, live mid-poll
after the owner's ruling, blind-masked (#102, #103); chair-attempt records — the fallback walk
is diagnosable from `run.json` (`chairAttempts[]`, #105). The v4.6 announcement invariant now
reaches the surface users watch and the artifact they keep.

### v4.6.3 — the post-train sweep *(patch)* — ✅ SHIPPED v4.6.3, 2026-08-05
A four-PR correction patch: the models audit stops crying wolf, the seats panel stops being
fooled, and a handful of proven small defects land with tests.
- **Audit routing-choice + fable direct route** — `models --check` stops flagging deliberate
  gateway-only routes like `gpt-pro` STALE (no more harmful downgrade suggestion); fable gains an
  authored `anthropic/claude-fable-5` route and routes direct-first with an Anthropic key — #107
- **Role-aware, old-run-resilient dead-seat rows + openRun guard** — a model dead as critic but
  alive as chair now renders its dead row; pre-v4.6 runs render dead rows from
  `verdict.degrades`/`seatLoss.deadBenchSeats`; the third F09-class stale-reply hole
  (`openRun`'s `get-run` reply) closes — #108
- **Valueless `-o` + save-shadow notice + metadata tmp sweep** — a trailing bare `-o`/`--out`
  now errors instead of orphaning a tmp file; `council save` announces when it shadows a
  built-in bench; `doctor --fix` sweeps orphaned `metadata.json` tmp files — #109
- **Registry body assert + Node-floor truth sweep + `makeBaseDeps()`** — the MCP-Registry
  skip-check verifies the version *and* status it trusts, fail-toward-publish on every other
  path; the README/install scripts/doctor all agree on the real Node ≥22.12 floor; eleven
  duplicated doctor test fixtures consolidate into one factory — #110

## v4.7 — "The count is the count" — ✅ SHIPPED v4.7.0, 2026-08-08
**Benefit:** every number amicus shows you is the number — what a council cost, which legs ran, and
which model earned the credit.

**Shipped across ten `v4.7-*` PRs** — PR0 (extractions) through PR7, plus the PR3 riders and a
closing documentation pass: the `runStats` completeness half of CA-4, the GOA-7 ledger
prerequisite, F8 session/wave tagging with `--search`, and four correction sweeps (PR4–PR7).

**Why this scope, and why it replaced composition.** Rescoped after a roadmap review on 2026-08-05
(the number was carried here as v4.6 until the degrade-announcement-invariant milestone took the
v4.6.0 release) that started from *how the tool is actually used* rather than from the deferral
list. Two findings drove it:

1. **The Workspace is an instrument panel, not a workspace** (owner, 2026-08-05): it is used for
   **live status while a council runs** and for **quantitative stats** — *never* to read council
   output, which is read in the terminal or through the orchestrating agent. That retires the F10
   ergonomics line wholesale (all three items are reading/working affordances) and promotes anything
   that makes the numbers right.
2. **`runStats` is a cost source, not just a record.** Verified at `8d0584a`:
   `cli-handlers-council.js:56` computes `amicus council stats` cost as
   `sumWaveUsage(r.runStats).cost` with **no fallback**; `council/report.js@8d0584a:79` falls back to
   `sumWaveUsage(runStats).cost` when wave usage is absent; `council/ledger.js@8d0584a:24` joins street-cred
   off the same array. ⚠️ **Two of the three pinned to `@8d0584a` on 2026-08-20 (v4.8 T2.4); the
   first deliberately NOT pinned, because it never rotted.** Opened at all three refs,
   `cli-handlers-council.js:56` is byte-identical — `const cost = sumWaveUsage(r.runStats || []).cost;`
   at `8d0584a`, at `ed5c0c02` and at the current tree — so it is a **live-true** citation and
   pinning it to a historical ref would have made a correct present-tense claim read as history.
   An earlier draft of this note said *"all three had already rotted"*; that universal is false and
   is corrected here. The other two HAD already rotted before T2.4 began (`report.js:79` and
   `ledger.js:24` are comments at `ed5c0c02`), so their drift is pre-existing, not this release's.
   The report fallback is now at `src/council/report-cost.js :: buildCostModel`'s `total` (it was
   `report.js :: toModel`'s until v4.9 W8 extracted the cost table); all three claims
   themselves still hold. So CA-4's omissions are not a schema nicety — they under-report spend on the
   surface the owner relies on, which collides with the cost-truth principle (*reported > estimated
   > unknown; never fabricate $0*). An omitted leg is not "unknown" — it renders as money never
   spent on legs that spent money.

> **Tense note.** The bullets below were written as pre-work problem statements and are kept for
> the record of *why* the rev was scoped this way. Each now leads with what shipped; the
> problem-statement text that follows it is history, not a live defect.

- **CA-4 (remaining half) — `runStats` completeness** *(M)*: **shipped.** Stage-2 judges and repair
  solos *were* absent from `tally.json`'s `runStats` (observed: 5 rows for 11 real legs in
  `wsgate04`); `runStats` now carries one row per paid launch — one `judge` row per judge
  (`run-assemble.js:180-184`) and one `repair` row per `-q<N>` solo, failed ones included
  (`run-stage2.js:122`).
  ⚠️ **Scope correction:** the failed-chair third of the original CA-4 is **closed** — v4.6.2's
  `chairAttempts[]` records every attempt on `run.json` (`run-chair.js:71` cites LC-5 by name), and
  failed-chair cost already reaches `runStats` too: a failed ch1–ch3 attempt gets its own
  `chair-attempt` row there carrying that leg's real `usage` (`run-chair.js:91-95`), so no third
  row class was needed.
- **GOA-7 prerequisite — segment the ledger by RESOLVED model, not alias** *(S–M)*: **shipped.**
  `ledger.js:124` now keys on `row.resolvedModel || row.model` and `LEDGER_SCHEMA_VERSION` is 2.
  It *was* a live defect: ledger rows keyed by council alias and aliases silently retarget (`gpt-pro` →
  `gpt-5.6-sol-pro`, the `opus` re-pin — both 2026-08-04), so `council stats` conflates distinct
  models under one name. The ledger is append-only, so every run adds rows that will later have to
  be distrusted, and both GOA-1 and GOA-2 plan to build on this data. Bump `LEDGER_SCHEMA_VERSION`;
  old rows stay readable (absent id ⇒ legacy). Full write-up and schema discipline: `BACKLOG.md`
  GOA-7. *(Recency decay — GOA-7's second half — is NOT in this rev.)*
- **Session/wave tagging + `--search` + grouped history** (F8) *(S–M)* — **shipped**
  (`--tag`, `amicus list --search`, `--limit`, `spend --group-by tag`). The one element carried
  over from the composition scope, and the one with a visible paper trail: this repo's own
  `BACKLOG.md` hand-maintained an index of run identifiers (`wave 47278069`, `run dfb6a692`,
  `runs 0084d48c + 2039b2d1`, `wsgate02`/`wsgate04`) **because there was no search**. It is also the
  rev's only daily-felt user surface — three schema fixes alone are a thin story.
- **README + docs update** *(S)* — the last scope line; **closed by PR #132**, which corrected the
  sentences v4.7 had made false rather than adding coverage the feature PRs had already shipped.

> **Why these belong in one rev.** CA-4 and GOA-7's prerequisite are the same defect class — the run
> record under-reporting what actually happened — and both are schema-shaped. Each was individually
> deferred with the same reason (*"M, a schema question, not a fix"*), which is exactly why neither
> has ever been done: too big for a patch, too small to carry a rev alone. One schema pass is
> materially cheaper than two.
>
> **Lineage.** v4.6 made a loss announce itself; v4.7 makes the accounting match reality. Same
> invariant family, applied to numbers instead of degradation.
>
> ⚠️ **Two hard gates apply before any task touches council internals** — see `BACKLOG.md`
> *Next-rev hard gates*: the tight-file extraction pass (`cli-handlers-council-run.js` is at
> **299/300 exactly**, `run-debate.js` at 299, two files **at 300**), and KNOWN_VARIABLES
> single-sourcing **only if** `{{input}}` is ever scoped — it is not in this rev, so that gate
> travels with composition rather than blocking here. *(Update 2026-08-25: the KNOWN_VARIABLES
> gate is now satisfied — landed in v4.9 W1 ahead of any composition work. The tight-file
> numbers in this note are a dated snapshot; re-measure with `npm run check:sizes`.)*

### Deferred out of v4.4.1 into v4.5 (2026-07-27)

Each is `M`+, or needs data or a design decision — the bar a patch on a published release cannot
carry. The table below is self-contained; the full write-ups (what, where, what breaks if it stays)
live in the repo's local-only working notes — `.superpowers/sdd/v44/v4.4.1-backlog.md`, with the
disposition that put them here in `.superpowers/sdd/v441/backlog-and-proposal.md`. **If you have
those notes, read that backlog's Appendix A (settled decisions) and Appendix B (known false
positives) before re-filing anything from this list.**

**Disposition update (2026-07-27):** every item below (plus FR-1/2/3 from `BACKLOG.md`) now carries
a proposed disposition — v4.5 ride-along / v4.6 / backlog — tabled for ruling in §8 of
`docs/superpowers/specs/2026-07-27-v4.5-save-and-share-design.md`.

| ID | What | Why not 4.4.1 |
|---|---|---|
| **CA-4** | `tally.json`'s `runStats` omits Stage-2 judges, repair solos and failed chair attempts (5 rows for 11 real legs in `wsgate04`) | `M` — a schema question, not a fix |
| **CA-5** | `isSubagentToolCall` is still a `name === 'task'` string proxy | `M`, and **reduced** by v4.4.0: it is now only the fallback when the real subtree walk finds nothing |
| **LC-1** | B53's stall kill is skipped while a tool-settle deferral is active | `S–M` — shipped deliberately; the author wants a second opinion, which needs data from real runs |
| ~~**LC-5**~~ | ~~A chair fallback leaves no trace in `run.json`~~ — ✅ **CLOSED by v4.6.2**: `chairAttempts[]` records every attempt (`{waveId, model, outcome, reason}`), checkpointed after each; `run-chair.js@v4.6.2:113` cites LC-5 by name. **Do not re-file.** | — |
| **RN-1** | `sanitizeName` collisions surface as a banner rather than a refusal | `S` + a product decision that was already argued once |
| **RN-2** | `renderRunList` blind masking is best-effort — only the open run resolves labels | `M` |
| **RN-5** | A blind-mode flip closes every open prose panel and repaints twice | `S–M` |
| **RN-11** | `renderSeats` never reorders existing rows | `S`, cosmetic, no consequence yet |
| **REL-2** | `mcp-repomix-e2e` skips, so plugin-chain MCP discovery is exercised nowhere | `M` — needs `AMICUS_REPOMIX_E2E_PROJECT` pointed at a real project *and* `repomix` on PATH |
| **TST-1 / TST-2** | No real `--debate` fixture; the `lens:<slug>` role branch has zero coverage | `M` each, and they want doing together |
| **TST-3** | Abort confirm→status-flip is proven only against the fake DOM | `M` — needs a real CDP pass |
| **TST-7** | Six render functions have no unit coverage | `M` |
| *(new)* | **Residual integration-suite handle leaks** — a NAMED leak with evidence, filed 2026-07-27 after 4.4.1 fixed ENV-6 and the live rail still warned from *different* suites | `S–M`. Full evidence, including why `--detectOpenHandles` cannot diagnose this class, is in the repo's root `BACKLOG.md` (not in the npm package — read it on GitHub) — start there rather than re-deriving it |

**ENV-6 is NOT on this list** — it was pulled into 4.4.1 by owner ruling and fixed at the source
(the CDP e2e suite's SIGKILL escalation timer). **ENV-1** is not on it either: it is a decision
record ("eleven `Number(env) || default` sites"), not a task — a blanket migration would introduce
six new defects to fix one, and `src/utils/env-num.js`'s docblock records which knobs deliberately
keep the old form.

---

### Design notes — auto-open the Council Workspace

Recorded 2026-07-26 from a read of the shipped code, so the v4.5 implementer starts from facts
rather than re-deriving them.

**The pieces already exist.**

| Need | Where it lives today |
|---|---|
| Launch the window | `src/sidecar/workspace-window.js` `launchWorkspaceWindow({project, runId})` |
| Detect the client | `src/utils/client-detect.js` `detectClient(mcpServer)` → `code-local` \| `code-web` \| `cowork` |
| Is Electron usable | `src/sidecar/electron-install.js` `isElectronUsable` / `resolveElectronBinary` |
| Current entry point | `amicus watch <runId> --ui` (`src/cli-handlers-watch.js:87`) |

**"Claude Code (local)" maps to `code-local`.** ⚠️ But `detectClient` reads the MCP client's
`getClientVersion().name`, so it **only works on the MCP path** — `amicus_council_run`, which is
exactly the Claude Code (local) case. A `council run` typed into a terminal has no MCP server, so
detection there falls through to the env override or the `cowork` status-quo default. Do not build
this on the CLI path expecting detection to work; either gate it on the MCP entry point or thread
an explicit client tag through. (Related: the Phase 12 backlog item about persisting the client tag
into shared-server `metadata.json` is the same seam.)

**Four guards, all load-bearing:**

1. **Never under `--json`.** `--ui` already rejects `--json` (interactive-only); an implicit default
   must not create the combination the explicit flag refuses.
2. **Never in CI or headless.** `council run` is the engine behind the Council Review GitHub Action
   and every headless fanout. A popped window on a runner is a hang, not a feature. Gate on the same
   display check the e2e suite uses (`HAS_DISPLAY`).
3. **Never trigger an install.** Requirement is *"where Electron is installed"* — check
   `isElectronUsable`, and if it is absent, do nothing silently. An implicit ~100 MB Electron
   download on someone's first council run is a hostile surprise.
4. **Must be opt-out.** A `--no-ui` (or config key) that suppresses it, because this changes default
   behaviour for an existing command.

**Why not v4.4.1.** It is a new default behaviour — a feature — and 4.4.1 is a patch on a shipped
release whose scope was explicitly locked. The patch already carries two behaviour changes (LC-2,
LC-10) that stretch the definition; a third that pops a GUI window would not be defensible as a
patch. Sits naturally beside v4.5's existing **GUI power ergonomics (F10)** line.

### v4.7.1 — the diagnostics stop lying *(patch)* — ✅ SHIPPED v4.7.1, 2026-08-09
Nine fix/test-hardening items and one mandatory extraction. No new commands; three declared
behaviour changes.
- **`doctor` stops grading the engine on presence** — the install record gains a version and skew
  is reported as a WARN. Underneath it, `npm root -g` could never resolve on Windows, so amicus had
  never been able to see a global install at all — which also blinded `doctor --fix`'s donor
  selection — #133
- **The NO_OUTPUT_BACKSTOP message stops guessing** — it asserted a cause it had no evidence for,
  which misdirected 30 minutes of a real incident. It now states only what the deadline
  observed — #129, #133
- **Retries can heal a slow model** — the once-only Stage-1 retry doubles its window, clamped to the
  leg timeout so a low `--timeout` cannot silently reclassify the failure class — #129
- **Tags stop being dropped** — `continue`, `resume` and `--retry-failed` inherit the parent tag, so
  `spend --group-by tag` stops mis-bucketing continued work under `(unattributed)`. `--tag` is now
  rejected on continue/resume rather than silently ignored *(behaviour change)*
- **The engine is pinned exactly** — `opencode-ai` and `@opencode-ai/sdk` at 1.18.15, moving dev and
  CI off 1.2.20. First release whose suite ran against the engine users actually get
- Plus a `sidecar/reopen-spend.js` extraction, a dead-code deletion, and three documentation gates

## v4.8 — "Every seat counts as itself" *(seat identity)* — ✅ SHIPPED v4.8.0, 2026-08-23
**Benefit:** seat a model twice and the council finally treats the two seats as two reviewers —
each with its own vote, its own row, its own file and its own dead-seat badge. Before this rev a
repeated alias was a bench that quietly disagreed with itself about how many reviewers were in the
room.

**Scope note.** The design spec behind this number
(`docs/superpowers/specs/2026-08-10-v4.8-ask-anything-count-everyone-design.md`) carried two halves,
*ask anything* and *count everyone*. v4.8.0 shipped **count everyone** — the seat-identity spine —
across the `v48-*` PR train; **ask anything** (task mode, #134/#130, with #146 folded in) was sized
and moved whole to v4.9 rather than carried half-done. That is the ruling, not a slip.

- **Seats are first-class.** A seat id *is* its alias on every bench with no repeated `--models`
  entry; where an alias occupies more than one position the seats are `<alias>#1`, `<alias>#2`, and
  the artifacts follow (`review-<alias>-1.md`, and the same rule for `judge-`/`rebuttal-`/`revote-`).
  `meta.seats` rides the tally/verdict documents index-parallel with `meta.models` *(L)*
- **⚠️ The peers-only filter excludes the raiser by SEAT, and findings on a repeated-alias bench
  change tier in BOTH directions** — a genuine twin's corroboration is no longer discarded, and a
  twin's *dispute* now demotes. Deliberate, measured case-by-case, and disclosed with its permanent
  cost: `Disputed` feeds the append-only ledger's `factErrorRate`, which is never migrated.
  Distinct-alias benches are byte-for-byte unaffected *(M)*
- **Two new honesty marks on `tally.json`/`verdict.json`** — `findings[].sameModelCorroboration`
  (corroboration that came from another seat of the same model, so it is not independent) and
  `findings[].unattributedPeerDrops` (a count of votes excluded from `basis` that the engine could
  not attribute to anyone). Both emit-when-set; both shipped with their own wrong-in-two-directions
  disclosures rather than as clean wins *(M)*
- **Prototype pollution closed across the alias tables** — a member literally named `toString`,
  `constructor`, `valueOf` or `hasOwnProperty` is no longer a valid alias at any of five gates, and
  `resolveModel('toString')` throws instead of returning the function itself. One table was not
  enough: a spread into a plain `{}` re-creates the inherited prototype, so all three builders are
  seeded *(M)*
- **A finding with no named raiser stops corroborating itself**, on one principle applied in order —
  *attribute when you can, mark only when you cannot* — with seat ids deciding first *(M)*
- **The Workspace stops collapsing dead seats**, and a live seat no longer erases its dead twin;
  dead rows, retry badges and DOM keys are keyed on the seat, with the producer emitting `null`
  rather than the alias for a seat it could not identify. Residuals pinned by tests asserting the
  known-wrong behaviour so they cannot rot silently *(M)*
- **`streetCred[]` stops dropping or inventing rows** when a hand-assembled `meta.seats` disagrees
  with `meta.models`, and a mixed reliability-ledger pair group stops reading narrower than one with
  no seat information at all *(S–M)*
> Why here: seat identity is a prerequisite, not a feature. Every surface that says *which model
> said what* — the peer split, street-cred, the ledger join, the Workspace panels, the artifact
> filenames — was keyed on the alias, so all of them told the same lie on the same bench shape.
> Fixing them one at a time would have been six half-fixes; the spine makes all six the same fix.
>
> **Lineage.** v4.6 made a loss announce itself, v4.7 made the accounting match reality, v4.8 makes
> the *attribution* match reality. Same invariant family, applied to identity.

**v4.8.1 (shipped 2026-08-25):** the fast-follow patch — setup Step 2 offered one card per curated
model *family* with no way to choose within it, and the route pill it wrote stored a **provider** id
rather than a model id, so nothing downstream could tell two models of one family apart either
(#138). Both wizard surfaces now offer a vendor-scoped drill-down on a new pure `model-shortlist.js`.

## v4.9 — "The council does new work" *(task mode)* — ✅ SHIPPED v4.9.0, 2026-08-26
**Benefit:** the council stops being able only to critique. Point it at open-ended work with
`--intent task` and every seat *produces* the deliverable, the judges rank which response best does
the work, and the chair synthesizes an **answer** — `Converged | Split | Insufficient` — instead of
a verdict about a review that never happened.

- **★ Task mode** — the *ask anything* half deferred out of v4.8, shipped whole: intent plumbing,
  Stage-1 task frames at every dispatch site, task judging and the task chair, honest renderers on
  every surface, and zero reliability rows written by a task run. **Closes #134, #130 and #146** —
  `--intent task` on the CLI, `intent: 'task'` over MCP, and a review run that is byte-identical
  everywhere *(L)*
- **The engine speaks for itself** — a `NO_OUTPUT_BACKSTOP` death report now quotes the engine's own
  newest ERROR line for that session, and names a server-vs-install engine skew when there is one,
  with a remedy that says why `doctor` cannot see this class. **Closes #133** *(M)*
- **Bench signals** — the `ttftMs` probe (measured off the backstop's own substantive-activity
  predicate, never derived), and a one-per-run warning when a local alias shadows a curated one with
  a different id, surfaced on the CLI, over MCP and in `models --check` *(M)*
- **The dead-seat surface finishes the v4.8 job** — an unbound seat stops being invisible in the
  Workspace, and the critic path keys on seat identity, closing the dead-bench-twin-beside-live-critic
  erasure v4.8 disclosed as a residual *(M)*
- **`amicus list` shows council runs on the CLI**, as `amicus_list` has over MCP since v4.0, with
  the current-project-only scope stated out loud rather than left silent *(S–M)*
- **Docs update** — task mode in `README.md`, `docs/council.md` and `docs/usage.md`; the `runStats`
  builder unification, the SI-16 splits and the `seatKey` consolidation carry the internal half *(S)*
> Why here: #130 and #134 are the same problem from two directions — #130 is the bug report of what
> happens when a generative brief meets a review-shaped pipeline, #134 is the request to support
> generative briefs properly — and both trace to one hard-coded frame telling every seat it was a
> reviewer. One declaration serves both, which is why they were designed together and shipped
> together rather than as a detector and a feature.
>
> **Lineage.** v4.6 through v4.8 each made the council *more honest about a run it already knew how
> to do* — announcing losses, counting money, attributing seats. v4.9 changes what a council can be
> asked for in the first place, which is a different kind of rev and is scoped as one.

## v4.10 — "Your aliases follow the pins" *(follow-or-pin aliases — #238 Phase 1)* — ✅ SHIPPED v4.10.0, 2026-09-14
**Benefit:** a curated alias tracks the pin amicus ships until you deliberately pin it, and
`amicus aliases` shows which is which and walks every worthwhile change in a numbered picker —
no more copy-pasting `--add-alias` lines out of `models --check`.

- **★ `amicus aliases`** — every alias as `following` (the shipped pin, moves with releases) or
  `pinned` (yours), grouped by vendor; `--review` proposes one change per pinned alias (a strictly
  newer same-tier sibling, the shipped pin, a same-vendor replacement for an id gone from the
  catalog) and accepts, skips or dismisses it in place; `--json` for scripts; `--unpin <name>`
  removes a pin (a curated name goes back to following, a custom name is deleted, the alias your
  default points at is refused). **Closes the user half of #238** *(L)*
- **Absence is follow** — a name absent from `config.aliases` resolves to the shipped pin, a
  present key is a pin, and a key equal to the shipped pin is dropped on save with a Notice; the
  setup wizard stops seeding the 21 curated ids and pins only the default you chose, and only when
  its live flagship differs from the shipped one *(M)*
- **The drift report cannot propose a downgrade** — `models --check`'s fallback-drift line ignores
  non-authoritative catalog rows and is silent when the OpenRouter namespace was rejected *(S)*
- **The sibling comparator is tier-safe** — lifted out of the CI alias-pin drift gate and shared
  with it; a size or variant token glued to a number (`20b`, `8x22b`, `4o`) is never read as a
  version, so a differently-sized model is never offered as a "newer" sibling *(S)*
> Why here: the two council rounds on #249 (16 + 13 findings) shaped the release — the typed
> shipped id follows without a catalog, the comparator's size rule, the `--unpin` default guard
> and the terminal-escape sanitizer on every alias surface all came out of them. Phases 2–4 of
> the #238 design shipped as v4.11.0 (next section); the spec that scopes all four phases ships in
> the repo under `docs/superpowers/specs/`.

## v4.11 — "The pins keep themselves current" *(#238 Phases 2–4 — owner mode, the setup window's Needs-review section, the once-a-day notice)* — ✅ SHIPPED v4.11.0, 2026-09-16
**Benefit:** the shipped pins are data the maintainer re-baselines with the same picker users get,
the setup window shows the same review the CLI walks and writes it in one Finish, and a user who
never runs `amicus aliases` still hears — once a day, after any command — that updates are waiting,
against a catalog that refreshes itself in the background once a week.

- **★ Owner mode — `amicus aliases --review --owner`** — the shipped pins live in
  `src/utils/curated-pins.json` (routes, `verifiedOn`, rulings; the retired and notable lists) and
  the maintainer re-baselines them through the same picker, one pass per gateway namespace, with
  a compare-and-swap write, gated on the source checkout, a clean tree and a terminal; `models
  --check` names a newer same-tier sibling of each cardless pin and `doctor` shows the pins' state
  and the reset command. The first baseline (2026-09-15) moved six routes. **Closes the owner
  half of #238** *(L)*
- **★ Setup window "Needs review"** — every alias row shows `following` or `pinned` with the
  right remove control; a Needs-review section above the Routing list renders the picker's
  proposals as buttons (accept, follow, use, add, choose…, dismiss), everything staged and written
  by Finish in one write; `amicus aliases --ui` lands there; the Models step announces
  `follows the shipped recommendation` or `live flagship differs — pinned`, never re-writes a
  merely restored default, and yields to the Routing step's stage for the same alias *(L)*
- **★ The once-a-day notice and the weekly background refresh** — one stderr line after any
  terminal command when the cached catalog shows updates waiting (never computed from the
  network), and a detached keyed `models --refresh` after an exit-0 run once the cache is a week
  old; one predicate gates both (a terminal, not `--json`/`--quiet`, not `mcp`/`update`, not CI,
  `AMICUS_NO_NETWORK_PROBES` unset, `aliasReview.autoRefresh` not `false`); the hook never writes
  `config.json` — its stamps and the refresh's log live in `alias-notice-state/` beside the
  catalog cache; the `aliases` footer names the state and `--json` carries it *(M)*
- **The notable list** — the editorial half of the comparator: shipped `add <alias> → <id>`
  proposals for models no sibling rule can reach, with a curation rule and a content gate; ships
  empty *(S)*
> Why here: seven council rounds across the three PRs (#250, #253, #254) shaped the release — the
> compare-and-swap on the owner sink, the one-write Finish and the truthful Step 2 card, and the
> move of the notice's timestamps out of `config.json` into a machine-owned state directory all
> came out of them. The council's own leg failures during those rounds (the 480 s no-output
> backstop, an OpenRouter credit refusal) were the material for the next rev: both are answered in
> v4.12.0 below — the refusal by the credit preflight, the silent backstop kills by the session
> clause on the death report.

## v4.12 — "No round is lost to an unnamed cause" *(the CI credit preflight, the session clause on a death report, the key-store refusals)* — ✅ SHIPPED v4.12.0, 2026-09-17
**Benefit:** a CI council no longer dispatches a bench the money on the key cannot fund — it says
so and refuses before a seat burns its once-only retry on a provider refusal — and when a leg does
die at the no-output backstop, the artifact says what the engine thought the session was doing
instead of going silent. Around those two: a key store that refuses a blank write rather than
wiping the credential already there, and a `config.json` a mid-write crash can no longer truncate.

- **★ The CI credit preflight** — before any seat is dispatched, `council-review.yml` prices what
  OpenRouter actually refuses on (each bench row's per-request `max_tokens` reservation, from a
  keyless catalog read) against the smaller of the key's monthly cap and the account's balance. It
  **refuses** (exit 1, nothing dispatched) only when even the CHEAPEST bench seat cannot be funded,
  **warns** when a refusal is merely likely or when anything could not be read, and clamps
  `--max-cost` to the money as a spend bound; the chair is priced but never gates the bench, cent
  arithmetic is exact, and nothing but a genuine refusal can fail the step. Every decision message
  states what the check does and does not guarantee, and the key never appears in any output.
  Motivated by run 35143585179, where four of seven legs were refused in 2–3 s for $0.003. (#256)
  *(L)*
- **★ A death report names the session probe's answer** — the engine's `session.status` is a map
  keyed by session id, and the death-report formatter required a top-level string `type`, so every
  real answer was dropped: across 27 CI artifact sets, 240 of 240 `NO_OUTPUT_BACKSTOP` reasons
  carry no session clause at all. The keyed answer is now unwrapped exactly as the poll loop
  unwraps it, and the probe's own outcomes (skipped, failed, no-status) render as `unknown` with
  the detail, so "the engine reported X" is finally distinguishable from "nobody asked". The
  `thin-cross-review` note and the still-dead retry note name their own causes on the same
  principle, and provider key-management URLs are redacted before any of it reaches `run.json`.
  (#251 item 3, #202, #256) *(M)*
- **The key store refuses a blank key** — a whitespace-only `amicus key` silently WIPED a working
  credential and reported success; it is refused at the store boundary now, so the CLI, the setup
  window and `provider add`'s bearer are all covered by one check. The setup window's
  `sidecar:save-key` validates in the MAIN process before it persists (the renderer's order was
  advisory, and a CDP session on `AMICUS_DEBUG_PORT` could bypass it), and the `.env` writers
  refuse to write the real user's key store from inside a test run. The key IPC handlers moved to
  `electron/ipc-keys.js` for the size gate; channels and behaviour are unchanged. (#212) *(M)*
- **`config.json` is written atomically** — temp plus rename, so a process crash mid-write can no
  longer truncate it (crash atomicity only; power-loss durability is not claimed). An existing
  symlinked config is followed rather than replaced, and the alias-conversion Notices print only
  after the write lands, so a failed write no longer reports conversions that did not happen.
  (#258) *(S)*
- **The provider-routing wire probe** — a keyless probe (`scripts/probe-provider-routing.js`, repo
  only, not in the tarball) that captures what an OpenRouter provider-routing preference does on
  the wire through the engine, with its digest tracked. Evidence for #202 Lever 2, not a user
  surface *(S)*
> Why here: three council rounds on #264 alone rewrote the preflight's rule — a clamp became a
> rethink became a cheapest-seat gate — and the #263 round is why the session clause is gated on a
> module-private Symbol rather than a forgeable wire field. Two of these reach CI only through a
> release: the workflow installs `amicus@latest`, so the preflight and the death-report fix were
> inert on main. The judge-death investigation (#202) is downstream of this cut for exactly that
> reason.

## v4.13 — "The backstop asks before it kills" *(the busy-aware no-output backstop — #251 item 1; the CI provider-routing pin, shipped blank — #202 Lever 2)* — ✅ SHIPPED v4.13.0, 2026-09-18
**Benefit:** a leg that is still thinking at the no-output deadline is no longer killed for being
slow to speak. The backstop reads the engine's `session.status` before it kills and gives a `busy`
or `retry` session exactly one more window, so a council loses fewer seats to the wall — and every
kill, and every leg the extension saved, leaves a record the next corpus can count. Beside it, the
CI council gains a switch to pin a seat's OpenRouter upstream, shipped off because the one live pin
measured did not remove the tail.

- **★ The busy-aware no-output backstop** — at its deadline a leg that has produced nothing reads
  `session.status` once: `busy`, or `retry` with the engine's next attempt inside reach, extends the
  window exactly once — doubled and clamped strictly below the leg `--timeout`, the Stage-1 retry's
  own formula, 480 s → 912 s in CI — while `idle`, an arm this code does not know, or a probe that
  could not answer kills byte for byte as 4.12.0 did. The death report says which (`… (session:
  busy) — window extended once from 480s to 912s at 481s on session busy`, or why it was not
  extended), its head names both windows so the doubled figure is never read as the value of
  `AMICUS_NO_OUTPUT_BACKSTOP_MS`, and every leg the backstop fired for carries a `backstop` record
  (`windowMs`, `firedAtMs`, `status`, `extended`, and `extendedToMs` or `why`) on its
  `metadata.json` and its `wave.json` entry — including the legs the extension SAVED. The status
  read is bounded by the leg time remaining, so a slow engine cannot push a kill past the leg cap,
  and CI's job worst case is unchanged. Motive: on 4.12.0 every one of 6 backstop kills across two
  CI rounds reported `(session: busy)`. (#251 item 1) *(M)*
- **The CI provider-routing pin, shipped blank** — `council-review.yml` can write an
  `opencode.json` carrying only `provider.openrouter.models.<id>.options.provider` into the run
  directory from `COUNCIL_PROVIDER_ROUTING`, so a pinned bench model is served by the upstream(s)
  named and, with a single-slug `only`, its outcomes are attributable by construction. The document
  is validated before it is written (structure, documented routing keys, every pinned id seated by
  this run's alias map), a keyless pre-run check against OpenRouter's public endpoints route skips
  the pin when a named upstream is not listed and serving, a keyless canary pins the engine's
  forwarding of the file, a post-run step warns when a pinned model's leg died, and the file ships
  inside the `council-run` evidence artifact. **No pin is in force:** two live rounds with qwen
  pinned to `reka` did not remove the tail. (#202 Lever 2) *(M)*
- **The Waves 2–3.0 probe scripts** — six keyless probes (`scripts/probe-shared-server.js`,
  `probe-wire-64k.js`, `probe-agent-wire.js`, `probe-sandbox.js`, `probe-session-obs.js`,
  `probe-council-agents-canon.js`; repo only, not in the tarball) with their digests: the
  zero-spend reads that eliminated both v4.9.8 candidates for the judge-death regime at the code
  level and measured the shared server, the 64000 reservation and the council agents on the wire.
  Evidence for #202, not a user surface *(S)*
> Why here: the workflow installs `amicus@latest`, so the extension was inert on main — every
> council round after this cut is the first live sample of what the lever buys, and the spec's
> revert criterion (kills carrying `extended once … on session busy` versus survivors carrying
> `backstop.extended: true`; if the saved count stays near zero while the delayed count matches
> the old kill count, the extension is only cost) can only be read from released artifacts. Two
> council rounds on #269 shaped the record: the pre-send catch needs no decision, a decision failure
> kills under its own name, a retry scheduled past the extended window is refused, an elapsed
> extension is refused and recorded, and the status read is bounded by the leg time. The
> judge-death regime since v4.9.8 stays open and weekday-collinear; nothing here claims to explain
> it.

## Backlog (tracked, not scheduled)

### Enterprise-readiness *(unscheduled — gated on funding / cofounder)*
*Moved here from a numbered `v5.0` heading, 2026-08-05. Content unchanged; only its status. It was
never a rev — it is a distinct product and go-to-market motion (SOC2, SLAs, sales, support), and per
the chair's hard-question #5 a solo dev can't credibly ship or support it alone. These items cluster
because they share one prerequisite that does not exist yet: **an org buyer, and the org to support
them.** Revisit as a funded track; it earns a version number when that track is real.*
- Secret-store backends + env-var-only mode (A3); org allowlists/blocklists, per-team cost ceilings, read-only enforcement (A6); RBAC
- Audit & compliance: reproducibility manifests + replay (B11), seed/temp/version pinning (A7), spend export to SIEM/warehouse (A10), `/health` + metrics + structured logging (A8)
- Team config `.amicusrc` (A9); spend **governance** (per-team caps/enforcement) — the governance half of A4
- Learning loops that need scale anyway: reliability-aware seat selection (B4), calibration benchmarks (B5), decision-outcome feedback (B10), adaptive strategy planner (B8), evidence provenance (B6)
- README + docs update: deployment/admin documentation for the above, in `README.md` and `docs/`
> ⚠️ **B4 (reliability-aware seat selection) now overlaps live backlog work.** `GOA-1` (auto-bench
> query-aware seat selection, filed 2026-08-05 in `BACKLOG.md`) blends the street-cred ledger into
> seat choice — that is B4's core idea arriving as a single-user feature rather than an enterprise
> learning loop. Reconcile before either is scoped; do not build both.

### Composition / chained waves (F6) *(unscheduled — dropped from v4.7, 2026-08-05)*
`--input-from <id>` / `--prompt-file -` pipe + per-source digests *(M)*, bringing the `{{input}}`
template variable and the `critique`/`refine` built-ins.

*Not cancelled — waiting on a use case that asks for it.* The reasoning, recorded so it is not
re-argued from scratch: **the chaining already happens, performed by the orchestrating agent.** When
a council needs to critique a previous council's output, Claude reads run A's verdict and composes
run B's prompt — adapting the handoff, dropping what is irrelevant, reframing what matters. A fixed
`--input-from` digest is *less* flexible than that for interactive use. The feature's real
beneficiary is **headless/CI chaining, where no orchestrator is in the loop** — and the one headless
consumer today (the Council Review GitHub Action) runs a single review per PR, not a chain.

**Revisit when:** a headless or scheduled workflow genuinely needs to chain councils without an
agent driving it, or the `critique`/`refine` built-ins are wanted on their own — those are a much
smaller slice than the chaining machinery and could ship independently of F6.

⚠️ **Its hard gate is already satisfied:** KNOWN_VARIABLES single-sourcing landed in v4.9 W1
(2026-08-25) — `src/template/render.js` now derives both validation and rendering from
`KNOWN_VARIABLES`, drift-tested, so `{{input}}` no longer waits on it. See `BACKLOG.md`
*Next-rev hard gates* (ticked).

### GUI power ergonomics (F10) *(unscheduled — dropped from v4.7, 2026-08-05)*
Focus-follows-fold hotkey, distinguishable window titles, tiling presets *(S each)*.

Dropped on an owner usage finding, recorded here because it should inform every future GUI decision:
**the Council Workspace is used as an instrument panel — live status while a council runs, plus
quantitative stats — and never to read council output.** All three F10 items are reading/working
ergonomics for a surface that is not used that way; "distinguishable window titles" and "tiling
presets" both presuppose multi-window reading sessions that do not happen.

**Consequence beyond F10:** GUI work should be judged on *live-status fidelity* and *stat accuracy*
first. The prose-panel and blind-masking nits (RN-2, RN-5, the `T19-*`/`T20-*` family in
`BACKLOG.md`) sit on the unused half of the surface and should rank accordingly.

### Other tracked items
- **`--dry-run` / cost & route preview** across start/fanout/council — E2/C7/F4 *(M)* — "know the cost/route before you commit"; useful, not essential to the near-term line.
- **F7** — Parallel council panels + super-chair (opt-in `--panels N` high-assurance; niche).
- **E7** — Prompt dedup cache (exact-dup, opt-in, excludes council/fanout) — minor cost optimization.
- **E6** — Cost-per-quality metric (withdrawn in debate; revisit if street-cred stabilizes).
- **`amicus key --local` picker** *(S)* — a default local-provider picker so `amicus key` sets/clears a bearer without naming the provider id: auto-select (and announce) when exactly one local provider is configured, a numbered prompt when several, and a hard error under `--json`/non-interactive rather than guessing a secret's destination. Register `--local` as a boolean flag. Deferred out of v4.2.1 as feature material (a new CLI surface, not a patch fix).
- ~~**Headless no-output fast-fail backstop** *(M)*~~ — **SHIPPED** (#99; the live default is **300 s**, not the ~120 s proposed here, and a Stage-1 retry doubles it to 600 s). Fail a headless run fast (env-tunable `AMICUS_NO_OUTPUT_BACKSTOP_MS`) when a misconfigured local model produces zero output, reasoning, and tool-calls, instead of polling to the request/overall timeout. Disarms permanently on the first token/reasoning/tool_use, so a legit slow cold-prefill local model (30–90s is normal) is never affected. (Was deferred out of v4.2.1 as new runtime behavior; it landed later.)

## What changed vs. the council's flat top-10
- Split the flat list into a **benefit-themed 4.x point-release line** (v4.0 → v4.2 → v4.3 → v4.4 → v4.5).
- **v4.1 inserted post-design (2026-07-19):** skill-on-engine fast path + headless debate mode,
  between the engine (v4.0) and local providers (v4.2). Spec: `docs/superpowers/specs/2026-07-19-v4.0-headless-council-engine-design.md`.
- **Local providers stays near-term** (v4.2) — a broad cost/privacy benefit, not enterprise.
- **Observability arc split:** v4.3 = the data layer + terminal surface + resilience + spend (ships first); **v4.4 = the Electron Council Workspace (B9)** as a GUI on that data.
- **`--dry-run` cost preview → backlog** (was in the observability rev).
- **Enterprise/governance/audit/compliance/learning-loops → v5.0**, reframed as the deliberate *major-version venture* gated on funding. **Superseded 2026-08-05:** moved out of the rev pipeline entirely, into *Backlog (tracked, not scheduled)*. A reserved version number read as a commitment; it isn't one.
- The **cheap trust fixes** (envelope, injection fencing, fold nonce) pulled into **v4.0** because the engine needs them to be trustworthy in automation.
- **Docs are part of the rev (2026-07-20):** every rev from v4.1 onward closes with a **README + docs update** line item, so each release ships its own documentation rather than deferring it.
