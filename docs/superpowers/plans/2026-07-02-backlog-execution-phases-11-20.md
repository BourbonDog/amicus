# Amicus Backlog Execution — Phases 11–20 Sequencing Plan

> **Status: DRAFT — approved dispositions locked 2026-07-02, execution NOT started (paused at user direction).**
> Item IDs (B01–B53) refer to `.superpowers/sdd/backlog-picklist.md` (gitignored working doc; content summarized inline below so this plan is self-contained). The DeepSeek docs review that added B46–B53 is at `.superpowers/sdd/deepseek-docs-review.md`.
> **Process:** same as phases 1–10 — each phase gets its own brief/spec pass at execution time (this document is the sequencing contract, not the task-level spec). Subagent-driven development, per-task adversarial review, whole-phase review, gates at every merge. Worktree lanes; `src/mcp-server.js` remains the serialization hub.

## Release map

| Phase | Delivers | Release | Gate |
|---|---|---|---|
| 11 | Release-rail hardening + routing hotfix | — | — |
| 12 | Engine pull-forwards (data loss, context drop, fences) | — | — |
| 13 | Docs quick-sync (highest-friction QUICK fixes) | — | — |
| 14 | **Ship v1.9.0** (all pull-forwards; first MCP Registry publish; Action activation) | **v1.9.0** | USER |
| 15 | Engine correctness sweep | — | — |
| 16 | Council & catalog UX | — | — |
| 17 | Docs overhaul (the DeepSeek cluster) | — | — |
| 18 | Breaking core: shim removal (#18 → #19) | — | — |
| 19 | **Ship v2.0.0 — the next major** | **v2.0.0** | USER |
| 20 | Post-major small-item sweep | v2.0.1 (docs/patch) | USER |

Dropped (user-approved): **B32** (dead tool_use branch — functional fix already shipped), **B39** (async-ify buildContext — ripple risk, no payoff), **B40** (tiktoken removal — bundle opportunistically into any dep-touching PR, not scheduled).
Absorptions: **B41 → B48** (README discoverability rides the plugin-channel treatment). **B12 executes inside Phase 12** as B01's forced enabler (any edit to interactive.js at 299/300 lines requires the split first) — its disposition stays "post-release" on paper but the mechanics land early.

---

## Phase 11 — Release-rail hardening + routing hotfix
Everything here must land before ANY next `v*` tag; all S-size.
- **B04** npm-publish idempotency guard in publish.yml (re-run after a post-npm failure currently dead-ends on EPUBLISHCONFLICT).
- **B05** OIDC-login retry for the registry publish step (login has no retry; publish does).
- **B27** second-opinion SKILL.md frontmatter 1441→<1024 chars (live routing defect; fix pattern proven on sidecar in Phase 8).
Lane note: B04+B05 are one publish.yml PR; B27 is independent. Two small lanes, parallel-safe.

## Phase 12 — Engine pull-forwards
The three reviewer-flagged high-impact fixes deferred from the 2026-07-01 review.
- **B01** GUI close-without-fold loses the summary (silent data loss on the most common GUI path). Includes the **B12** interactive.js extraction as its enabler (file is at 299/300 lines).
- **B02** MCP spawn paths hardcode `--client cowork` → `includeContext:true` silently returns nothing under Claude Code. Touches mcp-server.js — serialize this lane.
- **B03** Untrusted-output fence completion: extend `<untrusted_sidecar_output>` from 1 of 4 channels to all (wave reads, conversation mode, CLI read/fold stdout). Pairs conceptually with B08 (Phase 15) — same hardening theme, but B03 is standalone-safe.
Lane order: B02 → B03 (both touch mcp-server.js) ∥ B01 (interactive/electron files, disjoint).

## Phase 13 — Docs quick-sync
The QUICK tier of the DeepSeek review — highest first-run friction per dollar.
- **B47** Explain the Fold handoff operationally (what artifact is written where, how Claude Code picks it up).
- **B49** README↔usage.md sync sweep: fanout `--council` missing from usage.md; `list --status` value lists disagree; `--session-id`-on-fanout documented or explicitly unsupported; `amicus status` human + `--json` output examples; `--setup`/`--prompt` interaction. Verify every claim against the binary (Phase-8 discipline).
- **B52** OpenRouter-402 recovery in the troubleshooting table (predicted #1 npm first-run failure).
One serial docs lane; every fix gets a locking jest docs test (Phase-8 pattern).

## Phase 14 — Ship v1.9.0 (USER gate)
- Release ritual per docs/publishing.md (now includes server.json both-fields bump; CHANGELOG carries the still-unreleased Phase 9/10 entries — incl. the mandated "slash commands are plugin-channel-only" note — plus phases 11–13).
- MINOR version: B01/B02/B03 are behavior fixes/features.
- **This tag fires the FIRST MCP Registry publish** (Phase-9 wiring) — treat as the live integration test; manual recovery path documented in DISTRIBUTION.md §3 if it fails.
- Pre-activation manual items (USER): dedicated low-limit `OPENROUTER_API_KEY` actions secret + dashboard monthly cap; create the `council-review` label; optional actionlint pass. Then the Council Review Action is live on labeled PRs — dogfood it on the first post-release PR.
- Post-release hygiene (7.2-style): global upgrade, doctor, marketplace status check.

## Phase 15 — Engine correctness sweep
- **B09** Remaining metadata writers → writeFileAtomic (retires the torn-read class Phase 5 only tolerated) + the unguarded-removeSession/.catch-misroute gap from the Phase-5 review. **B15** tmp-orphan sweep in doctor --fix rides along (same atomic-write family).
- **B07** Wave-metadata race: abort marker overwritable by 'running' in the init window.
- **B10** session-utils isProcessAlive EPERM parity with abort-coordinator (mechanical).
- **B06** POSIX Go-server SIGKILL exit races → orphaned `opencode serve` processes.
- **B53** Per-tool-call watchdog in headless legs (observed live 2026-07-02: one wedged tool call burned a full 15-minute timeout with zero output).
- **B08** Full per-run fold nonce (BL-7 residual; requires tests/e2e.test.js in-lane).
- **B17** `amicus_read` size cap + tail/offset/limit params.
- **B18** discoverCoworkMcps win32 path fix.
Lane note: B09/B07 adjacent files — serialize; rest parallel-safe.

## Phase 16 — Council & catalog UX
- **B22** `amicus council validate`/`verdict` CLI wrappers (deterministic skill transport).
- **B23** Council presets (save/list/show + built-in free/budget/frontier benches).
- **B24** Per-run cost ledger + `amicus spend` rollup.
- **B33** (#12) Wizard Step-3 alias editor consumes the catalog IPC.
- **B34** (#13) Stale-catalog memo when refresh fails and cache is served.
- **B35** (#27) Free-models picker UX (grouping, friendly labels, spacing).
Closes 3 of the 6 open GitHub issues.

## Phase 17 — Docs overhaul (the DeepSeek cluster)
- **B46** Council subcommands documented end-to-end (tally input schema, verdict.json provenance, worked example) — the hero feature's biggest gap.
- **B50** "Where things live": config tree, session storage, log location, config file format + uninstall instructions.
- **B48** Plugin-channel command treatment throughout README (npx translation banner/tabs; absorbs B41 `/amicus:council` discoverability).
- **B51** README restructure + de-dup vs usage.md (~30% overlap; audience separation). Do LAST in-phase — it re-homes what B46/B48/B50 add.
- **B28** Stage-2 dangling colon + **B29** report.md skeleton-vs-synthesis rewrite (B29 independently confirmed by DeepSeek).
One serial docs lane (same-file collisions); jest docs tests throughout.

## Phase 18 — Breaking core: legacy shim removal
- **B37** (#18) `AMICUS_HEADLESS_TEST` compat name via getCompatEnv + drop unused husky devDependency. **Must land first** (the issue's own ordering).
- **B38** (#19) Remove every `sidecar*` shim per docs/SHIMS.md: CLI bins, `SIDECAR_*` env, `~/.config/sidecar`, `sidecar_sessions` dual-read, config tokens, `sidecar_*` MCP aliases (+ the AMICUS_LEGACY_ALIASES escape hatch), `*Sidecar` exports. Keeps: `[SIDECAR_FOLD]` wire token, the `sidecar` chat-skill NAME (deliberate, per SHIMS.md). Phase 4 already shipped the deprecation posture, making this mechanical — but it is THE breaking change and defines v2.0.0.
- CLI usage strings referencing the `sidecar` binary (the B21 slice that must move with #19) get fixed here; the rest of B21 stays post-major.

## Phase 19 — Ship v2.0.0 — the next major (USER gate)
- MAJOR version: B38 is breaking (bins, env vars, config dir, tool aliases).
- CHANGELOG with an explicit **migration section** (old → new for every removed shim).
- Full release ritual + live smokes (Phase-7 pattern: status/wait/abort + a council run) + registry/marketplace listings re-verified at the new version.
- Post-release hygiene incl. checking that plugin-channel and npm users survive the shim removal (doctor checks).

## Phase 20 — Post-major small-item sweep (→ v2.0.1)
The S-size remainder, one bundled pass:
- **B14** doctor MCP-registration false-negative (npx-@latest shape) · **B16** amicus_wait harmonization into reminders + skill polling guidance · **B21** remaining CLI polish (--json on continue/resume/abort, did-you-mean) · **B30** sidecar --agent default wording + example alias verify · **B31** docs-test brittleness (null-guards, verbatim-pin loosening) · **B42** council.md tally wording · **B43** actionlint in CI · **B44** synthesis-briefing neutralization · **B45** CI leg token cap.

**Deliberately NOT scheduled in 11–20 (next planning round's pool):** **B36** Electron 28→42 (#17 — L, its own milestone, regression gate already exists), **B19** Council Review Action v2 (L — wants v1 production data first; v1 activates at Phase 14), **B26** site/onboarding overhaul (M — independent of engine cadence), **B25** vault export (S — anytime), **B11** mcp-server enrichWithProgress extraction (S — next refactor window after the file quiets down), **B13** :free council curation (S — pairs with future B35 follow-up).

## Standing constraints (carried from phases 1–10)
- One git operator per clone; every lane in a worktree (created from PowerShell); junction node_modules; never bare `npm install`.
- `src/mcp-server.js` serialization; interactive.js needs the B12 split before any touch.
- Releases (phases 14, 19, 20-tag) REQUIRE explicit user approval; pre-push full suite via the .test-passed cache; gh credential helper for pushes; `gh -R BourbonDog/amicus` always.
- Release ritual: package.json + package-lock + plugin.json + **server.json (both fields)** + CHANGELOG, one commit, annotated tag.
- Anti-delegation opener on all implementer dispatches; never pipe gates through `| tail`.
