# Amicus compatibility shims — v2.0.0 removal record

v2.0.0 removed every pre-rebrand `sidecar*` compatibility shim (#19). This
document is now a **removal record**, not a live shim inventory: it exists so
that (a) anyone still on a `sidecar*`-era install has a one-line migration
remedy per removed shim, and (b) the v2.0.0 CHANGELOG migration section can be
lifted from this table nearly verbatim.

Two of the rows below are **not** removals — one is re-scoped as a kept
healing tool, the other was never a compat shim to begin with — each explains
its own status inline in its own Status/Migration cells. A related but
separate guard, which is not itself a table row, is called out explicitly
below the table: see "Not a removal: the mcp-self-identity recursive-spawn
guard".

| Shim | Location (at removal) | Legacy form | Status | Migration |
| --- | --- | --- | --- | --- |
| Env var prefix | `src/utils/env-compat.js` (deleted) | `SIDECAR_*` env vars | REMOVED in v2.0.0 | Rename every `SIDECAR_*` var you set to its `AMICUS_*` equivalent (e.g. `SIDECAR_ENV_DIR` → `AMICUS_ENV_DIR`, `SIDECAR_IDLE_TIMEOUT*` → `AMICUS_IDLE_TIMEOUT*`, `SIDECAR_DEBUG_PORT` → `AMICUS_DEBUG_PORT`, `SIDECAR_MOCK_UPDATE` → `AMICUS_MOCK_UPDATE`). One additional rename landed in the same removal pass: `SIDECAR_MAX_SESSIONS` → `AMICUS_MAX_SESSIONS` (this was the last remaining legacy-prefixed env var read anywhere in the codebase). Unrenamed `SIDECAR_*` vars are now silently ignored — no warning, no fallback. |
| CLI bins | `package.json` `bin` | `sidecar`, `claude-sidecar` commands | REMOVED in v2.0.0 | Use `amicus` (or the `am` short alias). If `npm install -g amicus` now fails with `EEXIST` naming an old `claude-sidecar`/`sidecar` file, that's a *stale* global install of the old upstream package, not this shim — see [docs/troubleshooting.md](./troubleshooting.md#install-fails-with-eexist--claude-sidecar). |
| Config dir | `src/utils/config.js` `getConfigDir()` | `~/.config/sidecar` fallback + `migrateLegacyConfigDir()` | REMOVED in v2.0.0 | No action needed for most users: config data was auto-migrated forward on every v1.x run (each v1.x launch copied `~/.config/sidecar/` into `~/.config/amicus/` once, non-destructively, if the new dir didn't exist yet). If you skipped every v1.x release and jumped straight from a pre-rebrand install to v2.0.0, copy `~/.config/sidecar/` to `~/.config/amicus/` by hand — `getConfigDir()` no longer reads the old location at all. |
| Session dir | `src/session-manager.js` + call sites | `.claude/sidecar_sessions/` dual-read | REMOVED in v2.0.0 | Amicus only reads `.claude/amicus_sessions/` now. Old session directories are not auto-migrated (per-project, not worth a background sweep) — rename `.claude/sidecar_sessions/` to `.claude/amicus_sessions/` in any project whose history you want `amicus list`/`amicus read` to see again. |
| Config token | `skills/sidecar/SKILL.md` dual-token instruction + test-only regexes (**not** `config.js` — `config.js` only ever emitted the canonical form; see History below for `c3de5bf`) | `[SIDECAR_CONFIG_UPDATE]` stderr marker / `sidecar-config-hash` HTML-comment parse | REMOVED in v2.0.0 | The skill instructs the canonical forms only: `[AMICUS_CONFIG_UPDATE]` and `<!-- amicus-config-hash: ... -->`. Old CLAUDE.md files carrying a leftover `<!-- sidecar-config-hash: ... -->` comment are not auto-migrated — the comment is simply no longer recognized; the next `amicus setup` alias change will write a fresh `amicus-config-hash` comment and the stale one can be deleted by hand. |
| MCP tool names | `src/mcp-server.js` registration | `sidecar_*` tool aliases — opt-in via `AMICUS_LEGACY_ALIASES=1` since v1.8.0 | REMOVED in v2.0.0 | `AMICUS_LEGACY_ALIASES=1` is now a **no-op**: setting it changes nothing, and only the canonical `amicus_*` tools register (regression-pinned in `tests/mcp-server-legacy-aliases.test.js`). Update any MCP client config or tooling that still calls a `sidecar_*` tool name to use the `amicus_*` equivalent. |
| Public API | `src/index.js` | `startSidecar`/`listSidecars`/`resumeSidecar`/`continueSidecar`/`readSidecar` exports | REMOVED in v2.0.0 | These were exported as deprecated aliases from the package root through v1.9.1 (present on npm in every release). v2.0.0 deletes them from `module.exports`; only the canonical `startAmicus`/`listAmicus`/`resumeAmicus`/`continueAmicus`/`readAmicus` names remain exported. Rename any import of a `*Sidecar`-named export from `amicus`'s package root to its `*Amicus` equivalent. |
| MCP registration cleanup | `src/utils/legacy-mcp-migration.js`, invoked by `scripts/postinstall.js` and `amicus doctor --fix` | duplicate `'sidecar'` MCP server entry in `~/.claude.json` / `claude_desktop_config.json` | **KEPT** (re-scoped, #19) | Not a compat shim — a one-shot **healing** tool for pre-1.8.0 installs that registered the same server under both `'amicus'` and `'sidecar'`. It only removes a `'sidecar'` entry verified identical-in-effect to the `'amicus'` one (`isAmicusMcpConfig()`); a customized `'sidecar'` entry pointing elsewhere is left alone. Still runs on every `postinstall` and via `amicus doctor --fix`. Kept indefinitely — there is no removal date. |
| Fold-marker constant | `src/headless.js` `FOLD_MARKER`/`COMPLETE_MARKER` exports | bare `[SIDECAR_FOLD]` literal, export-only back-compat — as of v4.0 no code path writes OR matches the bare form (`extractSummary`/`formatFoldOutput` require the per-run nonce; the legacy matcher/writer fallbacks are retired). On the wire the bare literal survives only as the prefix inside the nonced `[SIDECAR_FOLD:<nonce>]` form — see [docs/architecture.md](./architecture.md) | **KEEP** — deliberate wire-token continuity, not a compat shim, not scheduled for removal (B38 keeps it) | No action needed. |

## Not a removal: the mcp-self-identity recursive-spawn guard

`src/utils/mcp-self-identity.js` still recognizes the old bin/server names
`'sidecar'`/`'claude-sidecar'` in its self-exclusion lists (`SELF_MCP_NAMES`,
`SELF_BIN_NAMES`), even though v2.0.0 no longer ships them. This is
**deliberate and out of scope for this removal** — it's a defense, not a
shim: a stale pre-rebrand global install can still have `sidecar`/
`claude-sidecar` linked on a user's `PATH`, and a stale `claude.json`/MCP
config can still reference the old `'sidecar'` server name. Recognizing them
here only ever prevents amicus from recursively spawning itself under an old
alias — it never restores old behavior or re-exposes removed surface, so
there's no cost to keeping the wider net. Not tracked for future removal.

## Verification

Removal is verified in the codebase, not just asserted here:

- `grep -r "SIDECAR_" src/` → every hit is the `[SIDECAR_FOLD:<nonce>]` fold-marker contract (`src/headless.js`, `src/prompt-builder.js`, `src/utils/fold-marker.js`), a comment referencing it (e.g. `src/sidecar/interactive-process.js`), or the bracket-less `SIDECAR_FOLD` prefix inside the nonced form. The bare `[SIDECAR_FOLD]` literal survives **in code** in exactly two inert spots: the export-only back-compat constant `FOLD_MARKER` (`src/headless.js` — assigned, aliased to `COMPLETE_MARKER`, exported, never used in live logic), and the fallback branch of `buildHeadlessModeSection` (`src/prompt-builder.js`: `nonce ? buildFoldMarker(nonce) : '[SIDECAR_FOLD]'`) — reachable ONLY via the deprecated, production-unused `buildSystemPrompt()`, which builds no prompt for any real run. No **live** run path writes or matches the bare form since v4.0: `buildPrompts` — the orchestration entry point every real headless run routes through (`start` / `continue` / `fanout` / `mcp-server`) — throws a `TypeError` rather than emit a nonce-less headless prompt, and the detector (`trailingFoldMarkerRegex` in `src/utils/fold-marker.js`) matches only the nonced form. No `SIDECAR_*` env var is read or written anywhere in `src/`.
- `tests/mcp-server-legacy-aliases.test.js` — regression-pins that `AMICUS_LEGACY_ALIASES=1` registers zero `sidecar_*` tools.
- `tests/where-things-live-docs.test.js`, `tests/shim-removal-docs.test.js` — pin that docs describe the removal, not a live shim.

## History

Removed across the following commits on `p18/shim-removal` (#19):

- `a33690c` — MCP tool alias shim
- `fc7f0db` — public API `*Sidecar` alias exports
- `3791a6e` — `SIDECAR_*` env-var fallback shim
- `e9dade0` — `~/.config/sidecar` dir-fallback + `migrateLegacyConfigDir`
- `887912a` — `sidecar_sessions` dual-read shim
- `4ebc84d` — `sidecar`/`claude-sidecar` CLI bin aliases
- `c3de5bf` — dead `sidecar-config-hash` comment-parse tolerance (test-only tolerance removal — `config.js` never had dual-parse code; the skill-text acceptance instruction is fixed by this docs sweep)
- `9273dd1` — `SIDECAR_MAX_SESSIONS` → `AMICUS_MAX_SESSIONS` rename (the last legacy-prefixed env var read anywhere in the codebase)

See the rebrand plan for the original shim rationale: `docs/superpowers/plans/2026-06-08-amicus-rebrand.md`.
