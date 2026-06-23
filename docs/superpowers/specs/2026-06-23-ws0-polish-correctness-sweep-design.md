# WS-0 — Polish & Correctness Sweep Design

**Date:** 2026-06-23
**Status:** Approved

## Context

This is the first of five workstreams in the Amicus post-v1.1.0 enhancement program
(WS-0 polish → WS-1 reliability foundation → WS-2 schema & cost spine → WS-3 council
trust spine → WS-4 surfaces & adoption). WS-0 is a sweep of small, independent
correctness, security, and brand fixes. It is deliberately scoped to land first because
the items are cheap, carry no cross-dependencies, and remove "half-finished" seams on a
product that competes on trust and craft.

Source: the 2026-06-23 multi-agent improvement audit (`output/amicus-enhancement-review`
in the SecondBrain vault). Each target below was re-verified against current `main`
(`deae6c1`) before this spec.

## Goals

- Fix three confirmed correctness defects in user-facing output and one onboarding error.
- Close a secret-scanning gap: the committed-secret guard knows only 2 of the 5 supported
  providers since v1.1.0 made Google/OpenAI/DeepSeek direct providers.
- Remove user-facing legacy "sidecar" brand leaks **without** touching the intentional
  back-compat shims.
- Clear the dev-only `ws@7` high-severity audit finding.

## Non-Goals / Out of Scope

- **Distribution & docs quick-wins** (npm/GitHub `homepage` links, README "prerequisites
  & cost" block) — moved to **WS-4 (surfaces & adoption)**, where onboarding/reach lives.
- **No behavior changes** beyond the six items below. No refactors of the touched files.
- **No removal of legacy `sidecar` back-compat** (MCP `sidecar_*` aliases, the `sidecar`
  chat skill, `getCompatEnv` env shims, the `src/sidecar/` module directory). Those are
  deliberate and tracked in `docs/SHIMS.md` for a future major — they are explicitly
  preserved here.

## Design

### Item 1 — `amicus models` marks the user's actual aliases

**Problem:** `aliasMarks()` (`src/sidecar/models.js:40-47`) reads `getDefaultAliases()`, so
`amicus models` annotates rows with the *curated default* alias map, not the user's
effective config. When a user overrides a default alias (e.g. points `gemini` at a
different id), the listing misreports their own configuration — and the orchestrator's
pre-flight model check trusts that output.

**Change:** swap `getDefaultAliases()` → `getEffectiveAliases()` (already defined and
exported from `src/utils/config.js:219`/`:287`). Update the now-inaccurate doc comments
(`models.js:4` "curated aliases marked", `:39` "defaults only — the curated view") to say
the marks reflect effective (user) aliases.

**Acceptance:** with a config that overrides a default alias, `amicus models` marks the
row matching the user's effective alias target, not the default. Regression test in
`tests/` (or the existing models test) using a stubbed effective-alias config.

### Item 2 — `-1` "variable pricing" sentinel renders as `—`

**Problem:** `perMtok()` (`src/sidecar/models.js:24-28`) maps `null`/`undefined`/`NaN` to
`—`, but a negative value — OpenRouter's `-1` "variable/unknown pricing" sentinel —
flows through `n * 1e6 → toFixed(2)` and renders as `-1000000.00` in the `$/Mtok` column
cost-conscious users scan.

**Change:** treat negative `n` as unknown. Extend the guard so `perMtok` returns `—` when
`n < 0` (in addition to the existing `null`/`NaN` handling).

**Acceptance:** `perMtok(-1)` → `—`; `perMtok(0)` → `0.00`; `perMtok(null)` → `—`;
`perMtok(0.000003)` → `3.00`. Unit test covering all four cases.

### Item 3 — Platform-correct, in-product missing-key error

**Problem:** the missing-key validation error (`src/utils/validators.js:261-271`) is
macOS/zsh-specific on a Windows-first product (references `~/.zshrc`, `~/.zshenv`), never
mentions the in-product fix `amicus key`, and tells the user to run **`sidecar setup`**
(a brand leak).

**Change:** rewrite the error string to:
1. Lead with the in-product fix: `amicus key <provider> <key>` (derive `<provider>` from
   the already-computed `provider` variable, line 254).
2. Be platform-aware via `process.platform`:
   - **win32:** persist with `setx <KEY> <value>` (note: opens new shells) or add to the
     PowerShell `$PROFILE`.
   - **darwin/linux:** add the `export` to `~/.zshenv` (or the user's shell rc), noting
     non-interactive shells (Claude Code, CI) don't source `~/.zshrc`.
3. Offer the cross-platform `auth.json` option (`~/.local/share/opencode/auth.json`).
4. Replace `sidecar setup` → `amicus setup`.

**Acceptance:** the message names `amicus key`; on `win32` it shows `setx`/`$PROFILE` and
does **not** mention `~/.zshrc`; on darwin/linux it shows the rc guidance; the string
contains no `sidecar` literal. Tests stub `process.platform` for both branches.

### Item 4 — Secret-scan coverage for the 3 direct providers

**Problem:** `scripts/check-secrets.js` has 5 patterns (OpenRouter `sk-or-`, Anthropic
`sk-ant-`, AWS, GitHub, private-key block). v1.1.0 added Google, OpenAI, and DeepSeek as
direct providers, but the pre-commit guard can't catch their keys — a leaked key in the
public repo is direct user harm.

**Change:** add three patterns to `CONFIG.patterns`. Provider key formats overlap on the
`sk-` prefix, so the patterns are designed to be **non-colliding** with the existing
`sk-or-`/`sk-ant-` patterns (both of which contain a hyphen within the first few chars
that breaks an all-alphanumeric run):

| Provider | Proposed pattern | Notes |
|----------|------------------|-------|
| Google AI | `AIza[0-9A-Za-z\-_]{35}` | distinct prefix, no collision |
| OpenAI (project) | `sk-proj-[A-Za-z0-9_-]{20,}` | modern project keys |
| OpenAI legacy / DeepSeek | `sk-[A-Za-z0-9]{32,}` | both use bare `sk-` + alnum; one shared pattern labeled "OpenAI/DeepSeek API key". Won't match `sk-or-`/`sk-ant-`/`sk-proj-` (hyphen breaks the `{32,}` alnum run) |

Exact character counts to be confirmed against current provider key formats during
implementation; the design constraint is *catch real keys, never false-trigger on
`sk-or-`/`sk-ant-`/`sk-proj-`*.

**Acceptance:** unit tests in `tests/scripts/check-secrets.test.js`:
- real-format samples for Google / OpenAI-project / OpenAI-legacy / DeepSeek are flagged;
- **negative cases:** `sk-or-v1-…` and `sk-ant-api03-…` do **not** match the new
  OpenAI/DeepSeek patterns (still caught by their own existing patterns);
- all five existing patterns still fire.

### Item 5 — User-facing brand sweep (surgical)

**Problem:** post-rename, ~7 user-facing strings still print "sidecar". (Item 3 fixes one
of them.) The remaining confirmed sites: `src/utils/config.js:127/134/156`,
`src/cli-handlers.js:100`, `src/utils/alias-resolver.js:70`, `src/sidecar/setup.js:171/184`,
and the usage hints in the resume/continue/read command paths.

**Change:** replace the user-facing "sidecar" literals in printed output / help / hints
with "amicus". During implementation, re-grep for user-facing literals to catch any the
audit missed; each candidate is judged by *"does a user see this string in output?"*

**Explicitly preserved (do NOT change):** the `src/sidecar/` module directory and import
paths; `getCompatEnv`/env shims; the dual-registered `sidecar_*` MCP tool aliases; the
`sidecar` chat skill name and `~/.claude/skills/sidecar/`. These are intentional
back-compat tracked in `docs/SHIMS.md`.

**Acceptance:** no user-facing command output / help / error prints "sidecar" (except
where back-compat intentionally requires it); the shim surfaces above are byte-unchanged;
suite green.

### Item 6 — Clear the dev-only `ws@7` audit high

**Problem:** an `npm audit` high originates from `ws@7` pulled transitively via
`chrome-remote-interface` (a dev/test dependency). Untracked.

**Change:** run `npm audit fix` (dev-dependency tree only); if it can't resolve without a
breaking major, document the residual under issue #17 rather than forcing a breaking
change. No runtime dependency changes.

**Acceptance:** `npm audit` high count drops (or the residual is documented under #17);
`package.json` runtime deps unchanged; full suite + lint green.

## Testing & Verification

- Each new/changed behavior gets a unit test (items 1–4), following the existing per-fix
  test convention. Item 5 is covered by the brand assertion; item 6 by the audit delta.
- Gate: full `npm test` green (current baseline ~1925 pass / 4 skip / 0 fail) and
  `npm run lint` clean.
- Manual smoke: `amicus models` marks an overridden alias correctly (item 1); the
  missing-key path prints the new platform-correct message (item 3).

## Risks

- **Item 4 regex collisions** — the highest-care item. Mitigated by mandatory negative
  tests proving `sk-or-`/`sk-ant-`/`sk-proj-` don't cross-match. Over-broad patterns risk
  false-positive commit blocks; counts tuned against real formats.
- **Item 5 over-reach** — a careless sweep could touch an intentional shim and break
  back-compat. Mitigated by the explicit preserve-list and the user-facing-output test.
- Everything else is low-risk, localized, and individually testable.

## Execution Notes

- Worktree: `C:\Users\sendt\dev\amicus-ws0`, branch `ws0/polish-correctness-sweep`
  (off `main` @ `deae6c1`). `node_modules` junctioned from the main clone; hooks fire
  (PR #9). Local-only — no push/PR until the owner OKs a milestone.
