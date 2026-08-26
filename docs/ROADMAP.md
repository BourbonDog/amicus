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

Amicus is at **v4.7.0** (tagged 2026-08-08). Each 4.x rev below leads with the benefit, not the
plumbing.

**Status:** v4.0 through **v4.7.0** have **shipped** — everything on this page is a record of what
landed, not a plan. Composition — the scope that
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
