# MCP update notice — "the MCP-only user finally hears about new versions" — design

**Date:** 2026-08-03 · **Status:** approved in session (Christian) · **Provenance:** gap found
answering "will 3.x users be notified of 4.6?" — the CLI and GUI notify; `amicus mcp` is the
one entry point that deliberately skips the update check (`bin/amicus.js:72`), so a user whose
only touchpoint is Claude's MCP integration can sit on an old version indefinitely.

**One sentence:** the MCP server checks for updates at startup and, when one is known, appends
a single flavor-aware notice block to the first successful tool result of the session (and to
`amicus_guide` always), telling the agent-visible channel that a new version exists and the
one correct way to get it for *this* install.

---

## §1 Why (and why now)

- Every 3.x install already notifies CLI and GUI users (updater shipped in v0.3.0). The MCP
  path is the only silent one — and MCP-only users are exactly the population that never runs
  a CLI command to see the stderr banner.
- A silently stale install is the same family as a silent degrade: correct-but-silent fails
  the product bar. The fix is words in the channel the user actually inhabits.
- The npx-cache trap is documented history: an MCP registration that launches a cached npx
  copy is untouched by `npm i -g`, and the generic "reinstall" hint is a canned guess. The
  notice must say the *right* upgrade move per install flavor, or it joins the canned-guess
  hall of shame.
- Sibling precedent exists: #33 (`src/utils/version-info.js`) already warns when the on-disk
  copy is newer than the running process, as an appended text content block. This design is
  its complement — registry newer than installed — in the same voice, at one seam.

## §2 Rulings taken in the brainstorm (owner, 2026-08-03)

| # | Ruling |
|---|---|
| **D1** | **Cadence: once per server process** (explicit pick over status/wait-only and every-result). First successful tool result of the session carries one short notice block, then the session stays quiet. `amicus_guide` shows it always — that is the on-demand surface. Latch is per-process, so each new MCP session gives one reminder until upgraded. |
| **D2** | **Flavor-aware instruction ships in v1.** Generic "reinstall" wording is a canned guess; the machinery to do better (`engine-install-scan.js` kinds, `classifyLaunch`, `mcp-discovery.readAmicusMcpConfig`) already exists. |
| **D3** | **No `performUpdate` over MCP.** `mcp-notify.js`'s refusal to expose exec is the precedent: nothing reachable from MCP inputs mutates the system. The notice is words only. |
| **D4** | **Startup-only check; no periodic in-process re-check.** MCP servers restart with client sessions often enough. Revisit only with evidence of week-long server processes missing releases. |

## §3 Mechanism

**New module `src/utils/update-notice.js`** — pure helpers plus one in-process latch,
sibling of `version-info.js`, registry style of `mcp-notify.js`:

- `classifySelfInstall()` → `'global' | 'npx' | 'other'` from the realpath of this install's
  own `package.json` (`version-info.js` `PKG_PATH`); a `${sep}_npx${sep}` segment means npx
  cache, the npm global root means global — the same tests `engine-install-scan.js` applies
  to *other* installs, turned on ourselves. Certain, verified voice.
- `upgradeInstruction()` → one line, chosen by **config-first, self-path-fallback**
  precedence: what matters is what a *restart* will launch, and that is the registration
  config (`readAmicusMcpConfig()` + `classifyLaunch()`, best-effort, try/catch → null).
  When the config is unreadable, fall back to the running copy's own flavor in a softer
  voice. Wording table in §4.
- `buildUpdateNotice()` → `Update available: amicus v<current> → v<latest>. <instruction>
  Changelog: https://github.com/BourbonDog/amicus/blob/main/CHANGELOG.md`
- `maybeAppendUpdateNotice(result)` → the seam function. No-op when the latch is consumed,
  `result.isError` is set, or `getUpdateInfo()` returns null. Otherwise push one
  `{type:'text'}` content block (the `appendVersionWarning` pattern) and flip the latch.
  **The latch flips only on an actual append** — a first tool call that races the async
  `initUpdateCheck()` does not burn the once. Entire body wrapped so a failure returns the
  original result untouched: advisory, never load-bearing.

**Wiring (~6 lines in existing files):**

- `startMcpServer()` (`src/mcp-server.js`): fire-and-forget `initUpdateCheck()` at startup.
  Non-blocking; update-notifier reads the *previous* session's cached check and spawns a
  detached background check for the next one. The very first session ever therefore shows
  nothing — inherent update-notifier semantics, identical to the CLI. When the async init
  resolves with an update known (`.then()` on the fire-and-forget), write one
  `[amicus] update available …` line to stderr (client MCP logs; precedent: the existing
  startup line).
- The single registration wrapper (`src/mcp-server.js:1462-1478`, all 16 tools)
  unconditionally routes every handler result — success and caught-error alike — through
  `maybeAppendUpdateNotice(result)`; the seam's own `isError` check is the success gate.
  One seam, no per-tool edits, #33's per-site `appendVersionWarning` calls untouched.
- `getGuideText()` (`src/mcp-tools.js`): the existing #33 version line gains
  `— update available: v<latest> (<instruction>)` when known. Not latched.

## §4 Instruction wording table

| Restart-time launch (config-first) | Wording (voice) |
|---|---|
| npx pinning `amicus@latest` | "Restart your MCP client — it launches `amicus@latest` and will pick up the new version." (verified: that is what the config says) |
| npx pinning bare `amicus` **or** a versioned `amicus@<semver>` | "Your MCP config likely launches a cached/pinned npx copy; point it at `npx -y amicus@latest mcp` (or clear the npx cache), then restart your MCP client." (unverified-voiced — config read is best-effort, and for a semver pin the cache-clear clause is inert but the primary move is right) |
| path (direct command/args registration) | defer to install-flavor classification of the copy: **global** → "Run `npm install -g amicus`, then restart your MCP client." (after the install, #33's stale-version warning takes over and nags the restart — deliberate hand-off); **other** (dev clone etc.) → "Upgrade your amicus install, then restart your MCP client." |
| config unreadable or unrecognized (`none`/`unknown`) → self-path fallback | global self → the `npm i -g` line; npx self → the cached-copy hint (softer voice); other → the generic upgrade line |

## §5 Out of scope

- Auto-update or `performUpdate` over MCP (D3).
- Periodic re-check (D4).
- Any CLI/GUI behavior change; `bin/amicus.js` keeps skipping the *blocking* pre-command
  check for `mcp` (startup inside the server replaces it).
- PRIVACY.md change — its update-notifier disclosure ("checks the public npm registry…
  disable with `NO_UPDATE_NOTIFIER=1`") already covers the MCP process; the env opt-out and
  CI suppression flow through update-notifier for free.
- Backporting: this ships in the next release, so users stranded on 3.x today still need one
  out-of-band upgrade (README, plugin channel, CLI banner) before it protects them. It fixes
  the class going forward, not retroactively.

## §6 Testing (TDD)

- `tests/update-notice.test.js` — unit, no network, driven by `AMICUS_MOCK_UPDATE=available`
  and dependency seams: instruction table (all §4 rows), `classifySelfInstall` path fixtures,
  notice format, latch once-semantics (append → consumed; no-op paths leave it armed),
  `isError` skip, no-update no-op, never-throws (a throwing `getUpdateInfo` returns the
  original result). Latch reset seam exported for tests, matching house convention.
- Guide: `getGuideText()` shows the update line under mock mode, plain line without.
- Wrapper integration: follow the existing `mcp-server` handler-test pattern; the seam
  function carries the logic, so wrapper coverage is a smoke assertion.

## §7 Files touched

| File | Change |
|---|---|
| `src/utils/update-notice.js` | new (~80 lines) |
| `tests/update-notice.test.js` | new |
| `src/mcp-server.js` | ~6 lines (startup init + wrapper return + stderr line) |
| `src/mcp-tools.js` | ~3 lines (guide version line) |
| `CHANGELOG.md` | entry under next release |

No tight-ledger files touched (`cli-handlers-council-run.js` untouched).
