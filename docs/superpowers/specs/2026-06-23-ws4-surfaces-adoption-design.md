# WS-4 — Surfaces & Adoption — Design

_Status: drafted 2026-06-23 (brainstormed with user; 4 decisions locked via AskUserQuestion).
Post-launch enhancement program, workstream 4 of 5 (the final workstream). Source audit:
`SecondBrain/output/amicus-enhancement-review-2026-06-23.md` (enhancements #7, #11, #8 + the
deferred homepage / README-prereqs quick-wins). Base: local `main` `b691785` (WS-0/1/2/3
merged, local-only). Git policy: worktree-per-workstream, **LOCAL-ONLY** — no push / PR /
publish / server-side `gh` until the owner OKs a milestone._

## 1. Problem & intent

The engine and the council trust spine are now solid (WS-0..3). What is still weak is
**everything a user sees and touches first** — the default surface, onboarding, and the
distribution channel the entire audience actually lives in. Concrete gaps from the audit,
re-grounded against current `main`:

- **The default surface (interactive GUI) is invisible to every observability tool.**
  `runInteractive` (`src/sidecar/interactive.js:90`) persists **no** `conversation.jsonl` or
  `progress.json`. So the heartbeat reads `Starting up… | 0 messages` for a healthy session,
  `amicus read --conversation` says "No conversation recorded," `amicus status` is blind, and
  **closing the window without folding loses the session entirely**. Every headless run writes
  both files; interactive writes neither.
- **There is no first-run health check.** A new user with a missing key, a stale catalog, or an
  unregistered MCP has no single command that says what is wrong and the exact fix. The
  pieces to check each of those already exist as helpers — nothing composes them.
- **Amicus can't be found where its audience looks.** The entire audience is Claude Code /
  Cowork users and the plugin marketplace is the native discovery channel — but there is no
  `.claude-plugin/plugin.json`, so Amicus is npm-only. The polished live landing page
  (`bourbondog.github.io/amicus`) is also unlinked from npm metadata.

Intent: **make the default surface observable, make first-run diagnosable, and make Amicus
discoverable** — without re-architecting the engine and without weakening the WS-0..3 gains.

## 2. Locked decisions (from brainstorm)

1. **Scope — all four units.** #7 GUI persistence + #11 `amicus doctor` + #8 plugin manifest +
   the deferred quick-wins (npm `homepage`, README "Prerequisites & cost" block + parallel
   site block). This is the program's final workstream.
2. **Plugin packaging — thin manifest, npm stays the engine.** `.claude-plugin/plugin.json`
   declares the two skills + an MCP entry that runs `npx -y amicus@latest mcp`. The plugin is a
   discovery + skills layer; the engine/CLI still installs from npm. (Rejected: a self-contained
   bundled plugin — plugins don't run `npm install`, so deps/electron wouldn't resolve.)
3. **Marketplace — in-repo `marketplace.json` now, defer official.** Ship a repo-root
   `marketplace.json` so users can `/plugin marketplace add BourbonDog/amicus` then
   `/plugin install amicus`. Defer submitting to an official Anthropic marketplace.
4. **Docs/site under local-only policy — author locally, defer push + `gh`.** Write the
   `homepage` field, README block, and the parallel `site/index.html` block in the worktree
   now. The site only deploys on push, and `gh repo edit --homepage` is server-side — both wait
   for the owner's milestone-OK, like WS-0..3.

## 3. Architecture

Four units. Two touch engine code (A, B), one is config + a postinstall guard (C), one is docs
(D). No changes to the council trust spine or the headless completion logic.

| Unit | Enh | New / changed code | Interface |
|---|---|---|---|
| A. Interactive persistence | #7 | NEW `src/sidecar/conversation-mirror.js` (pure); refactor `src/headless.js` + `src/sidecar/interactive.js` | `mirrorMessages(messages, state) → {appendLines[], progress, nextState}` |
| B. `amicus doctor` | #11 | NEW `src/cli-handlers-doctor.js`; `buildDoctorDoc` in `src/utils/result-schema.js`; wiring in `bin/amicus.js`, `lifecycle.js`, `cli.js` | `handleDoctor(args) → exitCode`; `runDoctorChecks() → check[]` |
| C. Plugin manifest | #8 | **reorg `skill/`→`skills/sidecar/`**; NEW `.claude-plugin/plugin.json`, NEW `marketplace.json`; guard in `scripts/postinstall.js`; `package.json` `files` | both skills under `skills/<name>/`; manifest declares them + MCP; postinstall honors `AMICUS_SKIP_POSTINSTALL` |
| D. Quick-wins | — | `package.json` `homepage`; `README.md` block; `site/index.html` block | docs only |

### Unit A — Mirror the interactive GUI session to disk (#7)

**Root cause (corrects the audit's "helpers exist, just unwired").** The helpers do exist, but
the deeper reason interactive persists nothing is that its **parent process has no message
stream**: `runInteractive` spawns Electron as a child (`interactive.js:186`), and the Electron
child owns the OpenCode session. Headless persists because its poll loop
(`headless.js:328–574`) runs *in the parent* and calls `getMessages(client, sessionId)`
(`opencode-client.js:184`). Interactive's parent never polls messages — only
`getSessionStatus` via the WS-1 `createActivityPoller` (`src/utils/activity-poller.js`,
installed at `interactive.js:171`).

**Approach: extend the existing parent-side poller.** WS-1 already proved a parent-side poller
runs safely *concurrently* with the GUI renderer (both are clients of the same local OpenCode
HTTP server). So:

1. **Extract the persistence transform.** Today `headless.js` interleaves message parsing,
   `logMessage()` (`headless.js:736`), `writeProgress()` (`src/sidecar/progress.js:97`), and
   completion detection. Pull the *persistence* concern into a new **pure** module
   `src/sidecar/conversation-mirror.js`:
   ```
   mirrorMessages(messages, state) → { appendLines: object[], progress: object|null, nextState }
   ```
   - `messages` = the `getMessages` snapshot (array of `{info, parts}`).
   - `state` = opaque cursor (which text parts / tool calls / tool results already emitted,
     latest tool, message count) so the transform is idempotent across polls.
   - `appendLines` = JSONL objects in the **exact** existing shapes (text:
     `{role, content, timestamp}`; tool call: `{role:'assistant', type:'tool_use', toolCall, timestamp}`;
     tool result: `{role:'tool', type:'tool_result', toolUseId, isError, content, timestamp}`).
   - `progress` = the `{stage:'receiving', messagesReceived, latestTool}` payload for
     `writeProgress`, or `null` when nothing changed.
   - **`headless.js` refactors to call `mirrorMessages`** (its existing tests guard the JSONL /
     progress output — zero behavior change is the acceptance bar). Completion detection stays
     in `headless.js` (out of the transform).
2. **Wire the transform into the interactive poller.** Extend `createActivityPoller` (or the
   interactive call site) so each tick: `getMessages` → `mirrorMessages` → append lines to
   `conversation.jsonl` (`fs.appendFileSync`, mode `0o600`) + `writeProgress` when `progress`
   is non-null. The session dir is already created before `runInteractive`
   (`start.js:170`, `getSessionDir` `session-manager.js:39`).
3. **Activity signal upgrade.** Feed message growth into the watchdog touch, so an
   actively-responding-but-quiet GUI session no longer trips the 60-min idle kill (addresses
   the WS-1 follow-up #14 concern). `getSessionStatus` stays as a secondary idle signal.
4. **Terminal write.** On fold/close, write a final `getMessages` flush + `writeProgress(stage='complete')`;
   terminal `metadata.status` continues to flow through WS-1's `resolveTerminalState` /
   `session-finalize.js`. **A close-without-fold no longer loses the transcript** — it is
   already on disk from the live mirror.
5. **Usage (in-scope, low-risk).** Since the parent now reads the message stream, populate
   interactive `metadata.usage` from `msg.info.tokens` / `msg.info.cost` (the WS-2 capture
   shape) instead of the WS-2 `usage:null` placeholder. If a provider returns no usage, keep
   `usage:null` (honest), not zeros.

**Isolation contract.** `conversation-mirror.js` is pure (no fs, no clock injected — timestamps
passed in or via a tiny seam for testability), so it is unit-testable without a server. The
poller owns I/O. Headless and interactive share exactly one transform.

### Unit B — `amicus doctor` first-run health check (#11)

A one-screen diagnostic that **composes existing helpers** and never throws on a broken
environment (each check is independently guarded; a thrown check becomes a red line, not a
crash — the whole point is to run when things are broken).

- **NEW `src/cli-handlers-doctor.js`**: `runDoctorChecks() → check[]` where
  `check = {id, name, status:'ok'|'warn'|'error', message, hint}`, and
  `handleDoctor(args) → exitCode`. Checks and their existing sources:

  | id | source helper (file:line) | error vs warn |
  |---|---|---|
  | `node` | `process.version` vs `engines.node` | error if `<18` |
  | `config-dir` | `getConfigDir()` (`config.js:19`) | info |
  | `keys` | `readApiKeys()` / `readApiKeyHints()` (`api-key-store.js:118/131`) | **error if zero providers**; warn per missing |
  | `default-model` | `resolveModel()` (`config.js:104`) | error if it throws |
  | `catalog` | `readCache()` (`model-catalog.js:33`) — NO network, local 24h TTL | warn if missing / older than TTL |
  | `aliases` | `collectAliasSources()` + `findStaleAliases()` (`alias-audit.js:19/63`) | warn if any stale |
  | `opencode-bin` | `ensureNodeModulesBinInPath()` (`path-setup.js:10`) + resolvable check | error if not found |
  | `electron` | `getElectronPath()` (`interactive.js:18`) | **warn only** (headless works without it) |
  | `skills` | fs check `~/.claude/skills/{sidecar,second-opinion}/SKILL.md` | warn + hint |
  | `mcp` | `discoverClaudeCodeMcps()` / `discoverCoworkMcps()` (`mcp-discovery.js:46/151`) | warn + hint |

  Each red/yellow line carries the exact fix command (`amicus key <provider> <key>`,
  `amicus setup`, `npm i -g amicus`, etc.).
- **NEW `buildDoctorDoc({version, timestamp, checks})` in `result-schema.js`** —
  `{schemaVersion: SCHEMA_VERSION, type:'doctor', ok, version, timestamp, checks}` — matching
  the WS-2 `error-doc` / `result-schema` house style. `--json` → pretty JSON on **stdout**;
  human mode → ✓/⚠/✗ checklist with indented hints.
- **Wiring:** add `case 'doctor':` in `bin/amicus.js` (the same switch where `council` lives);
  add `'doctor'` to `ONE_SHOT_COMMANDS` (`lifecycle.js:15`) and arm the exit watchdog; add a
  one-line entry to `getUsage()` (`cli.js`). **Exit code:** `0` if no `error` checks, else `1`.
- **Determinism for tests:** `runDoctorChecks` takes an injectable deps object (the helpers) so
  unit tests drive each branch with fakes; a "fully broken env" test asserts it returns a
  populated `check[]` and never throws.

### Unit C — Ship Amicus as a Claude Code plugin (#8)

- **Reorg `skill/` → `skills/sidecar/` upfront (do this first).** The chat skill currently lives
  in a non-standard singular `skill/` dir (`skill/SKILL.md`, frontmatter `name: sidecar`), while
  the council lives at `skills/second-opinion/`. Move the chat skill to `skills/sidecar/SKILL.md`
  (via `git mv`, preserving history) so **both** skills sit under the standard `skills/<name>/`
  layout the plugin loader discovers by convention. The SKILL frontmatter `name: sidecar` is
  unchanged, and the install **destination** stays `~/.claude/skills/sidecar/` — only the repo
  **source** dir moves, so there is zero user-facing change. The reorg must sweep every reference
  to the old path: `scripts/postinstall.js` `SKILL_SOURCE` (`skill/SKILL.md` → `skills/sidecar/SKILL.md`),
  `package.json` `files` (drop `"skill/"`; `"skills/"` now covers both), and any test / docs /
  config reference (grep `skill/` repo-wide before finishing). This is the approach chosen over
  declaring arbitrary skill paths in the manifest, so the manifest stays convention-clean.
- **NEW `.claude-plugin/plugin.json`** (thin manifest):
  ```json
  {
    "name": "amicus",
    "version": "<synced to package.json>",
    "description": "<from package.json>",
    "author": { "name": "Christian Wagner" },
    "homepage": "https://bourbondog.github.io/amicus/",
    "repository": "https://github.com/BourbonDog/amicus",
    "license": "MIT",
    "keywords": ["claude-code","multi-model","llm","council","second-opinion","sidecar"],
    "skills": ["./skills/sidecar", "./skills/second-opinion"],
    "mcpServers": {
      "amicus": {
        "command": "npx",
        "args": ["-y", "amicus@latest", "mcp"],
        "env": { "AMICUS_SKIP_POSTINSTALL": "1" }
      }
    }
  }
  ```
  - After the reorg both skills sit under `skills/<name>/`, so the manifest's `skills` array
    points at the now-standard `./skills/sidecar` and `./skills/second-opinion`. The plan
    verifies the live loader (examples under `~/.claude/plugins/`) discovers them.
- **Double-registration fix (the real risk).** When a plugin user's MCP launches, `npx -y
  amicus@latest mcp` triggers an npm install of the published tarball whose **postinstall would
  re-register the MCP and re-copy skills** — duplicating what the plugin framework already
  provides (the framework discovers the bundled skills and registers the manifest MCP itself).
  Fix: the manifest sets `AMICUS_SKIP_POSTINSTALL=1` in the MCP `env`, and **`postinstall.js`
  honors that env by skipping the global mutation** (skill copy + `~/.claude.json` /
  `claude_desktop_config.json` registration). The normal `npm i -g amicus` path (no env) is
  **unchanged**, and the postinstall stays idempotent (`addMcpToConfigFile` already
  compare-then-writes; `MODEL-NOTES.md` stays `if-missing`).
- **NEW repo-root `marketplace.json`** listing one plugin (`source: "./"`) so
  `/plugin marketplace add BourbonDog/amicus` → `/plugin install amicus` works without an
  external index.
- **`package.json` `files`** gains `".claude-plugin/"` (and `marketplace.json` if not covered)
  so the manifest ships in the npm tarball too.
- **Version-sync test** asserting `plugin.json.version === package.json.version` (a cheap guard
  in the existing gate family) so the two can't drift silently.

### Unit D — Quick-wins (docs/adoption)

- **`package.json` `homepage`** `"https://github.com/BourbonDog/amicus#readme"` →
  `"https://bourbondog.github.io/amicus/"`. (`repository` already correct.)
- **README "Prerequisites & cost" block** inserted after the Install section (README.md ~L69,
  before Configure): Node ≥18 · an active Claude Code / Cowork subscription · ≥1 paid model API
  key; "a council run is ~5–8 paid model calls"; one line cross-referencing the WS-2 budget gate
  (`DEFAULT_MAX_COST_PER_MTOK = 60`, `src/sidecar/budget.js:22`) so the cost story is consistent
  with what shipped. No existing block duplicates this (only an inline `~7 model runs` example
  at README.md:139).
- **Parallel `site/index.html` block** (static HTML, maintained separately from README) — a new
  prerequisites/cost `<section>` after the hero (~L445), styled to match. **Authored now;
  deploys only on the deferred push.**
- **Deferred to milestone-OK (not done this WS):** `gh repo edit --homepage …`, the site
  deploy, and the push/publish.

## 4. Error handling & edge cases

- **A (mirror):** append-only, best-effort, **non-blocking** — a write or poll error must never
  crash the GUI session; log to stderr and continue (the GUI is the source of truth, the mirror
  is an observer). Idempotent cursor prevents duplicate lines across polls. If `getMessages`
  transiently fails, skip the tick. The transform never throws on malformed parts (skips them).
- **B (doctor):** every check guarded; a helper that throws → `status:'error'` line with the
  raw message, never a process crash. `--json` failures in *argument parsing* still route
  through `failJson`/`buildErrorDoc` (`error-doc.js`) for house consistency.
- **C (plugin):** if `AMICUS_SKIP_POSTINSTALL` is set, postinstall prints one line and exits 0.
  Manifest JSON must parse and validate; the version-sync test fails the suite on drift.
- **D (docs):** none beyond keeping README and site copy consistent with WS-2 numbers.

## 5. Testing

- **A:** unit tests for `mirrorMessages` (text growth, tool call, tool result, idempotency
  across repeated snapshots, malformed part skip, usage extraction); a headless regression run
  proving identical `conversation.jsonl` / `progress.json` output after the refactor; an
  interactive-path test (mocked client) proving the poller appends + writes progress and that a
  close-without-fold leaves a populated transcript.
- **B:** per-check unit tests with injected fakes (each ok/warn/error branch); a JSON-shape test
  (`type:'doctor'`, `schemaVersion`); a "broken env returns checks, never throws" test; exit-code
  test (any error → 1).
- **C:** a postinstall test proving the chat skill still installs to `~/.claude/skills/sidecar/`
  from the new `skills/sidecar/` source after the reorg; `plugin.json` parses + has required
  fields; version-sync test; a postinstall test that with `AMICUS_SKIP_POSTINSTALL=1` performs
  **no** global mutation and with it unset behaves as today.
- **D:** none (docs); a link/format lint at most.
- **Gates (every task):** `npm run lint`, `npm run check:secrets -- --all`,
  `npm run check:sizes -- --all`, full `npm test` green. New modules stay **<300 lines** (size
  gate). Per-task two-stage subagent review (spec-conformance then quality), final Opus
  whole-branch review before merge.
- **Real-LLM smoke (one, on this machine):** an interactive `amicus start` run that proves the
  live mirror — heartbeat shows `N messages`, `conversation.jsonl` + `progress.json` populate
  during the run, `amicus read --conversation` renders it, and closing without folding keeps the
  transcript — plus `amicus doctor` (human + `--json`) on the real config, and a manifest
  validation against the local plugin loader.

## 6. Out of scope

- Official-marketplace submission (in-repo `marketplace.json` only this WS).
- A self-contained bundled-engine plugin.
- Any push / PR / publish / `gh repo edit` / site deploy until the owner OKs the milestone.
- WS-2 / WS-3 deferred nits, unless one is trivially adjacent to a file already being changed.
- Re-architecting headless completion detection (the mirror only *reads* the stream).

## 7. Sequencing

Independent units; natural order is **D → C → B → A** (cheapest/lowest-risk first, the engine
refactor last), but A and B are parallelizable. Within C, the `skill/` → `skills/sidecar/`
**reorg lands first** (it's a pure move + reference sweep, gated green) before the manifest /
marketplace / postinstall-guard work builds on the new layout. Within A, the `headless.js`
refactor lands behind its existing tests **before** the interactive poller consumes the shared
transform, so a regression surfaces against the proven path first.

## 8. Risks

- **A — refactor regresses headless.** Mitigation: extract a pure transform, make
  byte-identical headless output the acceptance bar (existing tests), land it first.
- **A — concurrent parent polling disturbs the GUI.** Low: WS-1 already polls the same server
  concurrently; reads only. Keep the mirror non-blocking.
- **C — reorg misses a `skill/` reference.** Moving `skill/` → `skills/sidecar/` must catch
  every consumer (`postinstall.js` `SKILL_SOURCE`, `package.json` `files`, tests, docs, config).
  Mitigation: grep `skill/` repo-wide as the reorg's first and last step; a postinstall test
  proves the chat skill still installs to `~/.claude/skills/sidecar/` from the new source.
- **C — `AMICUS_SKIP_POSTINSTALL` not honored early enough.** The env is set in the manifest
  MCP `env`, which npx inherits before the install phase — verify the postinstall reads it at
  the top, before any mutation.
