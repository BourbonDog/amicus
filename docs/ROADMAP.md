# Amicus — reprioritized roadmap

**Reprioritization guidance (Christian, 2026-07-18):** engine-first is locked; the near-term work
ships as an incremental **4.x point-release line**, each rev delivering a **behavioral / feature
benefit users feel**; **enterprise-readiness is a venture unto itself** — the deliberate **5.0**
major jump, gated on funding/cofounder. The observability arc is split so the **data layer ships
first (v4.3)** and the **Electron "Council Workspace" (v4.4)** rides on top of it. `--dry-run` cost
preview dropped to the backlog.

Amicus is at **v4.5.0** (tagged 2026-07-28). Each 4.x rev below leads with the benefit, not the
plumbing.

**Status:** v4.0 through **v4.5.0** have **shipped** — everything down to the v4.6 heading is a
record of what landed, not a plan. **v4.6 (composition + tagging + GUI ergonomics) is the next
rev.** v5.0 remains forward-looking.

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
  chaining variable and the `critique`/`refine` built-ins arrive with v4.6
- **Ride-along fixes** — FR-1 (a failed council seat can render perpetually live), the FR-2 ruling,
  RN-1/RN-5/RN-11 Workspace renderer fixes, TST-3 real-CDP abort pass *(S each; dispositions for
  all 17 open items are tabled in the design doc's §8)*
- **README + docs update** — policy packs, the template library, and auto-open in `README.md` and `docs/` *(S)*
> Why here: save/share velocity multipliers that only pay off once councils are a command (v4.0)
> and observable (v4.3/v4.4); auto-open makes the v4.4 surface discoverable on its best client.

## v4.6 — "Compose your councils" *(specced after v4.5 ships — anti-rot rule)*
**Benefit:** councils chain — generate → critique → refine with no manual copy-paste — and history
becomes navigable.
- **Composable/chained waves** (`--input-from <id>` / `--prompt-file -` pipe + per-source digests) —
  F6 *(M)* — brings the `{{input}}` template variable + the `critique`/`refine` built-ins
- **Session/wave tagging + `--search` + grouped history** (F8) *(S–M)*
- **GUI power ergonomics** (F10: focus-follows fold hotkey, distinguishable window titles, tiling
  presets) *(S each)*
- Deferred-item candidates per the v4.5 design doc's §8: RN-2, TST-1/TST-2, REL-2, CA-4, LC-5,
  remainder of TST-7
- **README + docs update** *(S)*
> The 2026-07-19 combined spec (`2026-07-19-v4.5-policy-packs-composition-design.md`) holds the
> approved chaining/tagging/F10 design detail and is the primary input to the v4.6 brainstorm; it
> is NOT executed as-written — v4.6 gets its own spec + fresh plan once v4.5 ships.

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
| **LC-5** | A chair fallback leaves no trace in `run.json` (`wsgate02`'s haiku failed twice; only `"chair":"minimax"` was recorded) | `M` — a run-record schema addition |
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

## v5.0 — Enterprise-readiness *(the deliberate major jump — a venture unto itself, gated on funding / cofounder)*
**Benefit:** team/org deployment — but a distinct product + go-to-market motion (SOC2, SLAs, sales, support), not a feature drop. Parked as the 5.0 major per the chair's hard-question #5: a solo dev can't credibly ship or support this alone.
- Secret-store backends + env-var-only mode (A3); org allowlists/blocklists, per-team cost ceilings, read-only enforcement (A6); RBAC
- Audit & compliance: reproducibility manifests + replay (B11), seed/temp/version pinning (A7), spend export to SIEM/warehouse (A10), `/health` + metrics + structured logging (A8)
- Team config `.amicusrc` (A9); spend **governance** (per-team caps/enforcement) — the governance half of A4
- Learning loops that need scale anyway: reliability-aware seat selection (B4), calibration benchmarks (B5), decision-outcome feedback (B10), adaptive strategy planner (B8), evidence provenance (B6)
- README + docs update: deployment/admin documentation for the above, in `README.md` and `docs/`
> These cluster because they share one prerequisite you don't have yet: an org buyer + the org to support. Revisit as a funded track.

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

## Backlog (tracked, not scheduled)
- **`--dry-run` / cost & route preview** across start/fanout/council — E2/C7/F4 *(M)* — "know the cost/route before you commit"; useful, not essential to the near-term line.
- **F7** — Parallel council panels + super-chair (opt-in `--panels N` high-assurance; niche).
- **E7** — Prompt dedup cache (exact-dup, opt-in, excludes council/fanout) — minor cost optimization.
- **E6** — Cost-per-quality metric (withdrawn in debate; revisit if street-cred stabilizes).
- **`amicus key --local` picker** *(S)* — a default local-provider picker so `amicus key` sets/clears a bearer without naming the provider id: auto-select (and announce) when exactly one local provider is configured, a numbered prompt when several, and a hard error under `--json`/non-interactive rather than guessing a secret's destination. Register `--local` as a boolean flag. Deferred out of v4.2.1 as feature material (a new CLI surface, not a patch fix).
- **Headless no-output fast-fail backstop** *(M)* — fail a headless run fast (env-tunable `AMICUS_NO_OUTPUT_BACKSTOP_MS`, ~120s default) when a misconfigured local model produces zero output, reasoning, and tool-calls, instead of polling to the request/overall timeout. Disarms permanently on the first token/reasoning/tool_use, so a legit slow cold-prefill local model (30–90s is normal) is never affected. Deferred out of v4.2.1 as new runtime behavior.

## What changed vs. the council's flat top-10
- Split the flat list into a **benefit-themed 4.x point-release line** (v4.0 → v4.2 → v4.3 → v4.4 → v4.5).
- **v4.1 inserted post-design (2026-07-19):** skill-on-engine fast path + headless debate mode,
  between the engine (v4.0) and local providers (v4.2). Spec: `docs/superpowers/specs/2026-07-19-v4.0-headless-council-engine-design.md`.
- **Local providers stays near-term** (v4.2) — a broad cost/privacy benefit, not enterprise.
- **Observability arc split:** v4.3 = the data layer + terminal surface + resilience + spend (ships first); **v4.4 = the Electron Council Workspace (B9)** as a GUI on that data.
- **`--dry-run` cost preview → backlog** (was in the observability rev).
- **Enterprise/governance/audit/compliance/learning-loops → v5.0**, reframed as the deliberate *major-version venture* gated on funding.
- The **cheap trust fixes** (envelope, injection fencing, fold nonce) pulled into **v4.0** because the engine needs them to be trustworthy in automation.
- **Docs are part of the rev (2026-07-20):** every rev from v4.1 onward closes with a **README + docs update** line item, so each release ships its own documentation rather than deferring it.
