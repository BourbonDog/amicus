# Amicus — reprioritized roadmap

**Reprioritization guidance (Christian, 2026-07-18):** engine-first is locked; the near-term work
ships as an incremental **4.x point-release line**, each rev delivering a **behavioral / feature
benefit users feel**; **enterprise-readiness is a venture unto itself** — the deliberate **5.0**
major jump, gated on funding/cofounder. The observability arc is split so the **data layer ships
first (v4.3)** and the **Electron "Council Workspace" (v4.4)** rides on top of it. `--dry-run` cost
preview dropped to the backlog.

Amicus is at **v4.3.0** (tagged 2026-07-24). Each 4.x rev below leads with the benefit, not the plumbing.

**Status:** v4.0 through v4.3 have **shipped** — everything down to the v4.4 heading is a record of
what landed, not a plan. **v4.4 (Council Workspace) is the next rev**; its implementation plan is
written and de-rotted against shipped v4.3 (see that section). v4.5 and v5.0 remain forward-looking.

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

## v4.4 — "The Council Workspace" *(desktop GUI on the v4.3 data layer)* — ⏭️ NEXT, plan ready
**Benefit:** the same live data as a rich desktop app — watch a council *think*, not just tail a log.
- **★ Electron "Council Workspace" GUI** — live reviewer progress, anonymized peer packets, adjudication tiers, dissent, cost-by-seat, one-click fold into Claude Code — **B9** *(L)*
- **README + docs update** — Council Workspace walkthrough + screenshots in `README.md` and `docs/` *(S)*
> Why here: a GUI layer on top of v4.3's data layer. Split into its own point release because it's the one **L-effort** build in the observability arc — keeping v4.3 small and shippable.
>
> **Plan status (2026-07-25):** `docs/superpowers/plans/2026-07-19-v4.4-council-workspace.md` is
> written and **de-rotted against shipped v4.3** (68 verified findings applied inline; ledger at
> `.superpowers/sdd/v44/preflight-v44-findings.md`). One scope note the de-rot surfaced: the
> composed council live doc emits **no per-leg rows**, so the plan now opens with a **Task 0.5** that
> adds them to the v4.3 data layer. v4.4 is therefore *almost* pure front-end — one additive,
> tested change to `src/mcp-council-awareness.js`, then pixels over existing data.

## v4.5 — "Save, share, and compose your councils"
**Benefit:** complex councils become one-command, repeatable, and chainable.
- **Council policy packs + full run-profiles** (bench + lenses + options + briefing template, invoke by name) — B7/F5 *(M)*
- **Composable/chained waves** (`--input-from <waveId>` / pipe) for generate→critique→refine — F6 *(M)*
- **Briefing templates + library** (F9), **session/wave tagging + `--search` + grouped history** (F8), **GUI power ergonomics** (F10) *(S–M)*
- **README + docs update** — policy packs, chained waves, and the briefing-template library in `README.md` and `docs/` *(S)*
> Why here: velocity multipliers that only pay off once councils are a command (v4.0) and observable (v4.3/v4.4).

## v5.0 — Enterprise-readiness *(the deliberate major jump — a venture unto itself, gated on funding / cofounder)*
**Benefit:** team/org deployment — but a distinct product + go-to-market motion (SOC2, SLAs, sales, support), not a feature drop. Parked as the 5.0 major per the chair's hard-question #5: a solo dev can't credibly ship or support this alone.
- Secret-store backends + env-var-only mode (A3); org allowlists/blocklists, per-team cost ceilings, read-only enforcement (A6); RBAC
- Audit & compliance: reproducibility manifests + replay (B11), seed/temp/version pinning (A7), spend export to SIEM/warehouse (A10), `/health` + metrics + structured logging (A8)
- Team config `.amicusrc` (A9); spend **governance** (per-team caps/enforcement) — the governance half of A4
- Learning loops that need scale anyway: reliability-aware seat selection (B4), calibration benchmarks (B5), decision-outcome feedback (B10), adaptive strategy planner (B8), evidence provenance (B6)
- README + docs update: deployment/admin documentation for the above, in `README.md` and `docs/`
> These cluster because they share one prerequisite you don't have yet: an org buyer + the org to support. Revisit as a funded track.

---

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
