# #238 PR 4 — The Passive Alias Notice, the Weekly Background Catalog Refresh, the `aliases` Footer, the Notable List (Phase 4) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Phase 4 of the #238 design — the awareness layer: after any command run in a terminal, one stderr line (`2 alias updates available — amicus aliases --review`) at most once a day when the cached catalog shows updates waiting (D5, Q5); after a command that exits 0 with a cached catalog older than seven days, the same keyed refresh `amicus models --refresh` performs, spawned detached so it can neither block nor fail the run (D5, Q1); ONE predicate gating both — a terminal on stdin, not `--json`/`--quiet`, not `mcp`, not CI, `AMICUS_NO_NETWORK_PROBES` unset, `aliasReview.autoRefresh` not `false` — with no new environment variable (Q8); the `amicus aliases` footer naming that state (`background catalog refresh: on (weekly) — catalog is 3 days old`, spec §4) and `--json` carrying it; and the editorial half of D7 — the `notable` list's content and its curation rule.

**Architecture:** Two new modules, one slot. `src/utils/alias-refresh-state.js` is PURE: the Q8 predicate in two layers (`refreshState` = the standing half a user can turn off — config, env, CI; `exitHookAllowed` = plus the per-invocation half — TTY, `--json`, `--quiet`, `mcp`), the footer line, and the cache-only `catalogInfo` read the list and the notice share. `src/utils/alias-notice.js` is the side-effect orchestrator with every collaborator injectable: `runExitHook({ code, command, args, stdinIsTTY })` loads config, asks the predicate, counts proposals from the CACHE through the same engine the list and pickers use (`alias-proposals.js :: buildAliasProposals` over the in-memory normalized aliases), prints the one line, stamps `aliasReview.lastNotified` best-effort (`config.js :: markMigrationNotified`'s load-set-save-swallow shape), and — at exit 0 with a week-old cache and no failed attempt in the last day — spawns `node bin/amicus.js models --refresh` detached (`workspace-window.js :: openCouncilWorkspace`'s shape, plus `windowsHide`). `bin/amicus.js` registers ONE `process.on('exit', code => runExitHook(…))` in the update-notice slot (inside the existing `command !== 'mcp' && !args.version && !args.help` guard), reading `process.stdin.isTTY` at registration, never in the listener. Everything on the exit path is synchronous (an `'exit'` listener has no event loop) and swallows every throw. `sidecar/aliases.js` adds `refreshState` to the view, renders the footer line from it, and carries it in `--json` as `backgroundRefresh`.

**Tech Stack:** Node 22 CommonJS, Jest (`npm test`; single file `npx jest tests/<file>`), no new dependencies (the CI signal is `is-in-ci`'s three-line predicate re-stated — that package is ESM-only and `ci-info` reaches this tree only through jest, a devDependency an installed copy does not have).

**Spec:** `docs/superpowers/specs/2026-09-14-238-alias-follow-pin-design.md` — D5 (lines 70–88: the notice, the cadence, the detached refresh, the predicate), D7 (the notable list's editorial half), §3 (file rules), §4 "CLI list" (the footer example), §6 row 7 (the test row: one test per predicate term; refresh only at exit 0 with a cache older than 7 days, never on a failed run), §7 Phase 4, §8 Q1 (7 days), Q5 (once per 24 h, `lastNotified`), Q8 (disable two ways, no new env var; `amicus aliases` prints the state). Phases 1–3 shipped (PR #249 → v4.10.0; PR #250, #252, the D3 baseline, PR #253 — unreleased on `main`). This plan was written against `main` @ `bd1cb2ba` on 2026-09-16 and every code fact below was measured there.

## Global Constraints

- **300-line gate:** every file under `src/**/*.js` and `electron/**/*.js` stays ≤ 300 lines (`scripts/check-file-sizes.js`, blocks the commit). Measured on `bd1cb2ba`: `src/sidecar/aliases.js` **284** (T4 nets ≈ −3: one import swapped, a 5-line cache read folded into one call, a 5-line footer block replaced by 3, one `--json` field — it must END ≤ 290), `src/utils/model-catalog.js` 205 (untouched — it already has 7 exports; nothing is added to it), `src/utils/alias-proposals.js` 151 (untouched), `src/utils/alias-store.js` 86 (untouched). **Excluded from the gate but not from the spec:** `src/utils/config.js` 795 — grandfathered, "do not grow" (spec §3): the stamp lives in the new module, NOT beside `markMigrationNotified`. `bin/amicus.js` (274) is not gated; it takes ≤ 12 lines, all wiring — the decision lives in the module.
- **New module shape:** `@module` docblock FIRST, then `'use strict'`, ≤ 5 exports, JSDoc on every export. Two new files under `src/utils/` → each commit that adds one runs `node scripts/generate-docs.js` and stages `CLAUDE.md` and `docs/architecture-map.md` with it (CLAUDE.md HARD RULE: any commit adding a file under `src/`, `bin/` or `scripts/` updates CLAUDE.md in the same commit).
- **The exit path is synchronous and silent.** Nothing in `runExitHook` awaits, returns a promise, or prints anything but the notice line; every collaborator call sits under a try/catch that swallows. `child_process.spawn` is synchronous in creating the child (`uv_spawn`); its `'error'` event is asynchronous and never fires at exit — listen to it anyway (an unlistened ChildProcess `'error'` is an uncaught exception; `workspace-window.js`'s note). Never `process.stdin` inside the listener — its TTY-ness is read at registration.
- **The exit hook writes NOTHING but `aliasReview.lastNotified` (the notice) and `aliasReview.lastRefreshSpawned` (the refresh start, R-P4-11).** Pin the observable (failure mode #44): the test spies on `saveConfig` and deep-equals the saved object to the loaded one plus the stamp. Normalization on the count path is IN MEMORY (`normalizeAliases(raw, defaults).aliases`, the `sidecar/aliases.js :: normalizeOnEntry(d, false)` probe) — never `saveConfig` from the count. Known and accepted: `saveConfig` itself normalizes (D6, `config.js :: saveConfig`) and prints one Notice per seeded key it drops — the first stamp on a still-seeded config therefore performs D6's migration, visibly, once (ruling R-P4-5).
- **One predicate, tested one term at a time** (spec §6 row 7): TTY, `--json`, `--quiet`, `mcp`, CI (`CI` set to anything but `0`/`false`, `CONTINUOUS_INTEGRATION` set, any `CI_*` variable — `is-in-ci@1.0.0`'s predicate verbatim, MIT), `AMICUS_NO_NETWORK_PROBES === '1'` (the literal `live-probes.js :: liveProbesAllowed` reads — `'0'`/`'true'` do not disable), `aliasReview.autoRefresh === false` (a literal `false`; the string `'false'` does not disable). No new environment variable (Q8) — a test-only `-r` preload shim is a test seam, not an env var, and no production code reads anything it sets.
- **No test welds to the LIVE shipped pins (failure mode #53):** unit tests inject `getDefaultAliases` as a synthetic map; the e2e fixture uses a CUSTOM alias (`mine`) so its proposal exists whatever the shipped pins say; the only permitted live read is `getDefaultAliases()` at test time to DERIVE an expectation.
- **Hermeticity:** unit tests that touch config run under `tests/setup/hermetic-config-dir.js` (automatic via `jest.config.js`, per-worker scratch dir); the e2e spawns `bin/amicus.js` with an explicit scratch `AMICUS_CONFIG_DIR`/`AMICUS_ENV_DIR`, `AMICUS_MOCK_UPDATE=success` (no real update-notifier, no network — its fake update notice prints too, which is why the assertion is "ends with"), and `CI=0` (the runner's own `CI=true` would veto the predicate — `CI=0` is is-in-ci's override and neutralizes `CI_*` too). No real network anywhere: no e2e case may leave a week-old catalog in front of a REAL `spawn` — the spawn is proven at the module level with an injected `spawn`, and live on this machine in T7.
- **Test rails:** `npx jest tests/<file>` during a task, `npm test` at integration. NEVER run jest with `--testMatch`; never run `npm run test:integration:live` (spends money); `npm run test:integration` (keyless) only at integration time. `posttest` writes `.test-passed` keyed to HEAD; the pre-push hook re-runs the suite if it mismatches.
- **Citations:** `scripts/check-citations.js` runs in the pre-commit hook over staged files and everything citing them; prefer `file.js :: symbol` anchors; a `file.js:NNN` line citation must be in range at commit time.
- **Docs sync:** the pre-commit hook regenerates and auto-stages `docs/architecture-map.md`; let it. T5 owns every prose surface (usage.md, configuration.md ×3 places, README row, CHANGELOG) — failure mode #49: docs-coverage gates nobody owns.
- **stdout discipline:** the notice is stderr only; `--json` on any command sees neither the line nor the spawn; `amicus aliases --json` stays byte-clean JSON with the new field ADDED within `SCHEMA_VERSION`.
- **Commit trailer:** every commit ends with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **Worktrees (the Phase 3 layout):** an integration worktree `C:\Users\sendt\code\amicus-238-pr4` on branch `feat/238-pr4-notice-refresh` cut from `main` @ `bd1cb2ba`; each task runs in its own linked worktree beside it, `C:\Users\sendt\code\amicus-238-pr4-t<N>` on branch `feat/238-pr4-task-<N>` cut from the integration branch at the start of its wave, `node_modules` junctioned from the main clone (PowerShell `New-Item -ItemType Junction -Path <wt>\node_modules -Target C:\Users\sendt\code\amicus\node_modules`). Never place a worktree inside the repo (jest ignores any path containing `worktrees`). Task branches merge into the integration branch (`--no-ff`) after their task review; the generated `docs/architecture-map.md`/`CLAUDE.md` are re-run, never hand-merged, on a conflict. **Cleanup:** remove each junction FIRST with PowerShell `(Get-Item <wt>\node_modules -Force).Delete()` after checking `LinkType -eq 'Junction'`, then `git worktree remove`, `git worktree prune`, `git branch -d` — never recursive-delete through the junction. The plan file lives under gitignored `docs/superpowers/` — T1 force-adds it (`git add -f`); a wave-1 sibling gets a copy by hand.

---

## Rulings made in this plan (recorded so the spec stays the authority)

Each is a decision the spec did not settle; each names its cost if wrong. They belong in the PR body's "design decisions" section.

- **R-P4-1 — The CI signal is `is-in-ci`'s predicate, re-stated; no dependency added.** The spec names "the is-ci signal update-notifier already honours"; measured: `update-notifier@7.3.1` depends on `is-in-ci@1.0.0` (ESM-only — unusable synchronously from CommonJS without `require(esm)`, which this repo avoids by design in `update-notifier-loader.js`), and `ci-info@3.9.0` is in the tree ONLY through `jest` — a devDependency; a production `require('ci-info')` would crash every `npm install -g amicus` user. `is-in-ci` is three lines (`CI` not `0`/`false` and (`CI` in env or `CONTINUOUS_INTEGRATION` in env or any `CI_*` key)); it is restated with attribution in `alias-refresh-state.js :: isInCi`. *Cost if wrong:* a CI vendor a future `is-in-ci` detects and this copy does not gets an UN-suppressed notice — still behind the TTY term, which is the real CI backstop (Jenkins/Azure runners present no TTY).
- **R-P4-2 — `amicus aliases` gets no notice.** The list already prints `N to review — amicus aliases --review` and the picker walks the proposals; an identical stderr line behind either is an echo, not a notice. The refresh is still considered after `aliases` (a stale list is exactly when the background refresh should start). *Cost if wrong:* a user whose only amicus command is `aliases` never sees the notice — and never needs it.
- **R-P4-3 — No cache is NOT "older than 7 days": no cache → no background refresh.** There is nothing to age; `setup`, `doctor` and `models` create the cache; and a keyless or offline machine with no cache would otherwise spawn a child on every command (each failing, each writing a doc `readCache()` still rejects for lack of `models`). *Cost if wrong:* a user who never ran setup gets no background catalog — the notice cannot fire for them either, so nothing is silently degraded: the `aliases` footer says `catalog unavailable — cannot check for updates (amicus models --refresh)`.
- **R-P4-4 — A failed background attempt backs off for a day.** `refreshDue` also requires no `lastRefreshAttempt` within 24 h (`model-catalog.js :: writeRefreshFailure` stamps it onto the existing doc without touching `fetchedAt`; a SUCCESS clears it). Without this, an offline machine with a week-old cache spawns one failing child per command. Spec D5 says "older than 7 days"; this adds a floor, never removes a refresh that would succeed (a success resets `fetchedAt`). *Cost if wrong:* a refresh that failed at 09:00 on a flaky network is not retried until 09:00 the next day — the picker's inline refresh is one `--review` away.
- **R-P4-5 — The first stamp on a still-seeded config performs D6's normalization, with its Notices.** `stampNotified` writes through `saveConfig`, the ONLY config write path, and `saveConfig` normalizes (D6) with one `Notice: alias 'x' matches the shipped recommendation … — now following` per dropped key. A user who has only ever run `start` since v4.10.0 sees those lines once, after the command that first fires the notice — the visible-migration guarantee (#61) applied to D6, at the moment the config is first written for any reason. The stamp is written BEFORE the notice line so the notice is the last thing on stderr. *Cost if wrong:* up to 21 Notice lines once, on a config the migration was always going to rewrite at its next save.
- **R-P4-6 — The notice does not depend on the exit code; the refresh does.** Spec §6 row 7 gates only the refresh on exit 0; the update notice (the same slot) prints at every exit code. Kept literal. *Cost if wrong:* a notice under an error message — the same shape the update notice already has.
- **R-P4-7 — The refresh child is `node bin/amicus.js models --refresh` of THIS install, `{ detached: true, stdio: 'ignore', windowsHide: true, env: process.env }`, `unref()`'d.** The same command, the same keys (`env-loader` runs in the child's `bin/amicus.js`), the same `refreshCatalog` (spec D5: "the SAME refresh models --refresh performs"); no hidden entry point, no second code path. `windowsHide` is the documented way to keep a detached console child from opening a window on Windows (Node: "The child will have its own console window"). `detached` is what keeps the child OUT of libuv's kill-on-close job object, so `armExitWatchdog`'s force-exit cannot take it down. The child's stdin is `'ignore'` → not a TTY → its own exit hook is silent by the predicate's first term: no recursion. *Cost if wrong:* the child does the update check `bin/amicus.js` does for every command (mock-able, cached by update-notifier for a day) — ≈ 200 ms of wasted CPU, weekly.
- **R-P4-8 — The `amicus models --refresh` hint stays on the footer, but rides only when nothing else will refresh.** Phase 1's F1 line (`(catalog is N days old — amicus models --refresh)`, past 24 h) is folded into the new state line. With the refresh ON, a 3-day-old catalog is the weekly cadence working — no hint; past 7 days it is evidently not keeping up — hint. With the refresh OFF, past 24 h — hint, as F1 had it. *Cost if wrong:* a user with the refresh on and a 5-day-old catalog is not told to refresh by hand — the picker refreshes inline the moment they act.
- **R-P4-9 — `--json` carries the state as `backgroundRefresh: { enabled, disabledBy }`** (`disabledBy` ∈ `null | 'config' | 'env' | 'ci'`), a field ADDED within `SCHEMA_VERSION`. Q8 says `amicus aliases` prints the state; a machine reader of the same document should not have to parse the footer. `lastNotified` is not carried (nothing reads it). *Cost if wrong:* one unused field.
- **R-P4-11 (added at execution, from Task 2's review) — At most one background refresh START per day, stamped in config before the spawn.** `model-catalog.js :: refreshCatalog` writes the cache only at its END (`writeCache` on success, `writeRefreshFailure` on failure), so `fetchedAt`/`lastRefreshAttempt` alone cannot tell a running refresh from a missing one: every exit-0 command inside the first child's network window (seconds online, a provider-timeout window offline) would spawn another child — a storm the spec's own cost statement ("once a week at most") does not allow. `runExitHook` stamps `config.aliasReview.lastRefreshSpawned` (epoch ms, the `lastNotified` shape) BEFORE spawning and spawns ONLY when that save landed — "no receipt, no spawn" (corrected at the whole-branch review: on a read-only config DIRECTORY neither this stamp nor the catalog's own `lastRefreshAttempt` can land, so the back-off is no belt-and-braces there; a refresh that would have run unrecorded is not started). `refreshDue` refuses within 24 h of the stamp; R-P4-4's `lastRefreshAttempt` back-off covers a refresh that ran and failed. A future-dated stamp (`lastNotified`, `lastRefreshSpawned`, `lastRefreshAttempt`) reads as "never", so a wrong clock self-heals on the next fire; `fetchedAt` keeps `getCatalog`'s future-is-fresh rule. The exit hook therefore writes nothing but the two `aliasReview` stamps. *Cost if wrong:* a refresh killed mid-flight (the machine slept) is not restarted for a day — the picker's inline refresh is one `--review` away.
- **R-P4-12 (added at execution, from Task 3's review) — A usage banner is not a run: the predicate requires a command.** Bare `amicus` (no command) passes bin's shared guard (`command !== 'mcp' && !args.version && !args.help`), prints usage and exits 0 — the hook would print the notice behind a usage banner and could start a refresh from it. Spec D5 says "after a run that exits 0" and the docs say "after any command", so `alias-refresh-state.js :: exitHookAllowed` refuses a missing or empty `command`; bare `amicus` behaves like `amicus --help` for the hook. The shared guard is untouched (it also governs the update check, which has always fired on the usage print). Extended at the whole-branch review: an UNKNOWN command (`amicus lst`) prints the same usage and exits 1 — bin passes `''` as the hook's command when `getCommandNames()` does not include it; and `update` is excluded like `mcp` — its exit runs after `npm install -g` has replaced the install directory, so `loadDeps()` at exit would resolve a mixed-version module graph. Pinned by unit tests and e2e cases (bare `amicus`, `amicus bogus`). *Cost if wrong:* a user who only ever types `amicus` (or mistypes commands) never sees the notice.
- **R-P4-13 — RETIRED at council round 2 (R-P4-20): with no config write left in the hook, a missing or unparseable config simply reads as `{}`.** Original text: The exit hook writes only the config it already loaded, and does nothing without one.** `stampAliasReview(cfg, key, now, d)` mutates the config `runExitHook` loaded and saves it — it never re-reads: `config.js :: saveConfig` is a plain truncate-and-write (not atomic), so a second `loadConfig()` that came back null (a transient read failure, another amicus process mid-write — exactly the "two exits at once" case) used to be saved as `{ aliasReview: {…} }`, wiping `default`, `aliases`, `routing`, `providers` and the councils. When `loadConfig()` returns null (missing or unparseable) the hook does nothing at all — no notice, no stamp, no spawn: a user without a config has nothing to be told about and nowhere to record a stamp, and a transient null becomes a skipped exit, never a loss. Follow-up (not this PR): `saveConfig` → `atomic-write.js :: writeFileAtomic`. *Cost if wrong:* a machine with keys in env, a catalog and no `config.json` gets no notice and no background refresh — and has no aliases to review.
- **R-P4-14 (council #254 round 1, A2/D5 + hard questions 1–2 — a SPEC DEVIATION from Q5's placement, flagged to the owner) — The exit hook never writes `config.json`.** Stamping `lastNotified`/`lastRefreshSpawned` into `config.aliasReview` meant a whole-file truncate-and-write of the USER's config at the exit of routine commands: a lost-update window against any concurrent `amicus` write (`saveConfig` is not atomic), a SIGKILL-mid-write hazard, and D6's normalization as a side effect of every first stamp. The two timestamps now live in a machine-owned `alias-notice-state.json` in the config dir (new `src/utils/alias-notice-state.js`: `readNoticeState` never throws, `writeNoticeState` merges a patch and writes via `atomic-write.js :: writeFileAtomic`, returning a receipt; safe to delete). `autoRefresh` and `dismissed` — the user's own setting and decisions — stay in config, which the hook only READS. Retires R-P4-5 and R-P4-13's "never re-read" clause ("no config → nothing" stays). *Cost if wrong:* one more file in the config dir; deleting it re-fires one notice and one refresh start.
- **R-P4-15 (A1/D3) — No receipt, no notice.** The line prints only when its stamp landed, mirroring the refresh's rule: an unwritable directory means silence, not a per-command nag in exactly the environment where the user could not save the opt-out either. The spec's best-effort shape is kept — the failure is swallowed; the line is withheld. *Cost if wrong:* a read-only config dir never sees the notice (the `aliases` list still works).
- **R-P4-16 (D4 / qwen C1) — A spawn that fails synchronously clears the start stamp** (`writeNoticeState({ lastRefreshSpawned: null })`), so a systemic failure is retried at the next exit instead of masked for a day. An asynchronous spawn error never fires at exit and `process.execPath` is the running node, so ENOENT is not a case. *Cost if wrong:* none observable.
- **R-P4-17 (A4 / hard question 4) — The per-invocation and environment terms run before any file is read.** `exitHookAllowed({ …, config: null })` first (TTY, command, `--json`, `--quiet`, `mcp`/`update`, env, CI), then `loadConfig()`, then the config term via `refreshState`. A vetoed exit — non-TTY, `--json`, a pipeline, CI — reads nothing. *Cost if wrong:* none.
- Council round-1 refutations, with lines: **B2/D1** (footer without a catalog) — `renderAliasList` returns early on `!view.catalogAvailable` before the state line; **D2** (`isInCi`) — `is-in-ci@1.0.0` verbatim; **B1** (leading newline) — the update notice's own shape in the same slot; **D7 / hard question 3** (orphaned child) — `model-fetcher.js :: FETCH_TIMEOUT_MS` 5 s per provider, local 5 s, `model-ceilings-modelsdev.js :: MODELS_DEV_TIMEOUT_MS` 10 s, and `models` is one-shot under `armExitWatchdog`. Parked: **D6** (the line is the spec's text; the notable list is empty — revisit the wording when entrants ship). Accepted: **A3** (same-millisecond double start — idempotent, atomic cache writes), **C3** (the list's second `loadConfig()`), **C4** (a future `fetchedAt` reads "1 hour old", the Electron banner's arithmetic).
- **R-P4-18 (council #254 round 2, A1/C1/D4/qwen #3) — One file per stamp.** The merged `alias-notice-state.json` had a read-merge-write that could drop the OTHER stamp when two exits raced. `alias-notice-state/` now holds `last-notified.json` and `last-refresh-spawned.json` (each `{ "at": <ms> }`, atomic temp+rename; `null` removes the file) plus `last-refresh.log`. No merge step exists, so nothing can cross keys; concurrent writers of the same stamp write the same value milliseconds apart. What no file layout removes is the same-instant check-then-act race (two TTY exits within the same few milliseconds) — one duplicate line or one duplicate idempotent refresh, stated in the docblock and the docs. *Cost if wrong:* two small files instead of one.
- **R-P4-19 (A2/D1/qwen #1) — The child's output is logged.** `spawnDetachedRefresh` opens `alias-notice-state/last-refresh.log` ('w', 0o600), hands the descriptor to the child as stdout+stderr, and closes its own copy after the spawn (`'ignore'` only when the open fails — the child still runs). `models --refresh`'s own lines are the trace; the catalog doc stays the structured outcome. D1's asynchronous-ENOENT theory is refuted: `process.execPath` is the running binary and `bin/amicus.js` the running script; Node's asynchronous `'error'` path carries only EAGAIN/EMFILE/ENFILE/ENOENT — the last impossible here, the first three resource exhaustion retried the next day by design. The hang theory is refuted again by `model-fetcher.js :: FETCH_TIMEOUT_MS` (5 s), `model-ceilings-modelsdev.js :: MODELS_DEV_TIMEOUT_MS` (10 s), local 5 s, and the one-shot watchdog. *Cost if wrong:* one log file, rewritten weekly.
- **R-P4-20 (A3/D9) — A missing or unparseable config reads as `{}`.** No pins → nothing to notify; the refresh still runs on an aging catalog — which is exactly what the `aliases` footer's `on (weekly)` says, so the footer became true rather than changing. Retires R-P4-13. *Cost if wrong:* an unparseable config's aliases are not reviewed until it parses again.
- **R-P4-21 (D3/qwen #2) — "Verbatim" pinned by measurement.** A unit test evaluates the INSTALLED `is-in-ci` source (1.0.0 — the version `update-notifier@7.3.1` resolves; 2.0.0 dropped the `CI_*` scan and is not what the updater honours) over an environment matrix and asserts `refreshState` agrees case for case; the docblock names the version. *Cost if wrong:* none — the test fails loudly the day the installed predicate changes.
- **Live coverage of the detached spawn (D7/qwen #1):** `tests/bin/alias-notice-refresh.integration.test.js` (skipped without `OPENROUTER_API_KEY`; spends nothing) builds a real catalog, ages it, runs `list` under the TTY shim and waits for the child's refresh and log line. It passed live on the owner's Windows machine 2026-09-16 (3.4 s / 4.8 s). Run it only through the keyless rail or a one-file jest config verified with `--listTests` — never a command-line pattern override.
- Council round-2 refutations/parkings, with lines: **D2/HQ4** (default-on network I/O — spec D5's accepted cost; Q8's two opt-outs; now logged), **D5** (5–7 ms measured; Q5 stamps when the notice fires), **D6** (spec Q8), **D8** (stamp-first stops the nag; a TTY with a closed stderr is not a case), **D10** (the map renders every export `name()` — `generate-docs-helpers.js :: extractExports` and the 5-name cap), **A4** (`loadCuratedPins()` calls `validateCuratedPins` on the shipped file), **qwen #4** (byte-identity is load-bearing — `saveConfig` pretty-prints, the fixture is compact), **qwen #5/#6/#8/#9/#10** (nits, consistent with the Electron banner / the catalog TTL / the spec's slot / the ≤5-exports rule / is-in-ci's own scan).
- **R-P4-22 (council #254 round 3 — the only seat that survived a quorum failure, deepseek D2) — With the background refresh ON, the footer never hints `amicus models --refresh`.** R-P4-8's "on and older than a week" branch fired exactly when the exit hook was about to start that refresh itself. Off → hint past 24 h, unchanged. A refresh that keeps failing is visible in `alias-notice-state/last-refresh.log` and `amicus models`' stale memo. Amends R-P4-8. Round 3 otherwise: D1 (future stamp fails open) refuted — the stamp-first chain rewrites it with `now` before the spawn; D3 (notable overcount) refuted — `proposeNotable` skips an existing alias name; D4 (exit 0 a weak proxy) is the spec's gate; D5/D6/D7 already ruled; D8 → a `CI=0` footnote in configuration.md. Round 3 itself failed `COUNCIL_QUORUM`: two no-output backstops and an OpenRouter credit refusal on gpt — an account signal for the owner. *Cost if wrong:* a user with the refresh on and a persistently failing refresh reads the age, not a hint.
- **R-P4-10 — The notable list ships whatever entrants the owner names at execution time, and the curation rule regardless.** Every shipped entrant is a standing `add <alias> → <id>` proposal for EVERY user — it counts in the list, the pickers and the once-a-day notice until accepted or dismissed — so an entrant is a nag by design. The rule (T6) says what qualifies, and a content gate (`tests/utils/curated-pins-notable.test.js`) enforces its mechanical half: a `note` on every entry, no `:free`/`-latest`/`preview` id, no id that any shipped pin already names. An empty list is a valid outcome. *Cost if wrong:* an entrant nobody wants is one `× dismiss` per user.

---

## File Structure

| File | Role | Status |
|---|---|---|
| `src/utils/alias-refresh-state.js` | PURE: `refreshState` (standing half), `exitHookAllowed` (whole predicate), `refreshStateLine` (footer), `catalogInfoFromCache` (cache-only engine input), `REFRESH_MAX_AGE_MS` | new (T1), ≈ 95 lines |
| `src/utils/alias-notice.js` | side effects, injectable: `countProposals`, `refreshDue`, `spawnDetachedRefresh`, `runExitHook` (+ internal `stampNotified`, `loadDeps`) | new (T2), ≈ 120 lines |
| `bin/amicus.js` | registers the `'exit'` listener in the update-notice slot | modify (T3), +≈ 10 |
| `tests/helpers/tty-stdin-shim.js` | `node -r` preload: `process.stdin.isTTY = true` for a spawned child | new (T3) |
| `src/sidecar/aliases.js` | `refreshState` on the view, the footer line, `backgroundRefresh` in `--json` | modify (T4), net ≈ −3 |
| `docs/usage.md`, `docs/configuration.md`, `README.md`, `CHANGELOG.md` | the prose | modify (T5) |
| `src/utils/curated-pins.json`, `docs/usage.md` (owner paragraph), `tests/utils/curated-pins-notable.test.js` | notable entrants + curation rule + content gate | modify/new (T6) |
| `tests/utils/alias-refresh-state.test.js`, `tests/utils/alias-notice.test.js`, `tests/bin/alias-notice-hook.test.js`, `tests/sidecar/aliases-command.test.js` | tests | new/modify |

Path matrix the hook must be checked against (failure mode #41 — a gate below an early return never runs): `--version` and `--help` exit through `process.exit(0)` ABOVE the dispatch and the listener is registered inside the guard that excludes them, so they never fire it; bare `amicus` (no command) PASSES that guard and exits 0 from the usage print — CORRECTED at execution (Task 3's review): the predicate refuses a missing command (R-P4-12), so a usage banner is silent too; `mcp` is excluded by the same guard AND by the predicate; the `default:` unknown-command branch and the `catch` exit 1 → the notice may fire, the refresh may not; every handler's own exit code reaches the listener as `code` (`process.exitCode = exitCode` then natural drain or `armExitWatchdog`'s `process.exit(code)`); an MCP-spawned `start`/`continue` (`--task-id`) has a piped stdin → silent.

## Waves (what runs in parallel, and why it can)

| Wave | Tasks | Cut from | Why parallel is safe |
|---|---|---|---|
| W1 | **T1** ∥ **T5 + T6** (one worktree, one implementer, T5 then T6) | integration @ `bd1cb2ba` | T1 touches `src/utils/alias-refresh-state.js`, its test, and the regenerated `CLAUDE.md`/`architecture-map.md`; T5/T6 touch only prose, `curated-pins.json` (unchanged — entrants: none), and a new test — disjoint. T5 and T6 share `docs/usage.md`'s Aliases section and adjacent CHANGELOG bullets, so they are NOT parallel with each other. |
| W2 | **T2** ∥ **T4** | integration after T1 (+ T5/T6) merged | Both consume only T1. T2: `src/utils/alias-notice.js` + test (+ regenerated docs); T4: `src/sidecar/aliases.js` + its test. Disjoint, except that BOTH commits may regenerate `docs/architecture-map.md` (T2 adds a module; T4's docblock line changes an entry) — on a merge conflict the file is regenerated, never hand-merged. |
| W3 | **T3** | integration after T2 merged (T4 need not have landed) | Consumes only T2's `runExitHook`; touches `bin/amicus.js`, `tests/helpers/`, `tests/bin/` — disjoint from T4. |
| — | whole-branch review → **T7** (controller) | integration, all merged | — |

---

### Task 1: `alias-refresh-state.js` — the predicate, the footer line, the cache-only read

**Files:**
- Create: `src/utils/alias-refresh-state.js`
- Test: `tests/utils/alias-refresh-state.test.js`
- Modify (regenerated): `CLAUDE.md`, `docs/architecture-map.md`
- Add (force): `docs/superpowers/plans/2026-09-16-238-pr4-notice-refresh.md`

**Interfaces:**
- Consumes: `model-catalog.js :: DEFAULT_MAX_AGE_MS` (24 h, the footer's "off and stale" threshold).
- Produces (T2 and T4 rely on these exact names):
  - `refreshState({ config = null, env = process.env } = {}) → { enabled: boolean, disabledBy: null|'config'|'env'|'ci' }`
  - `exitHookAllowed({ command, args, stdinIsTTY, config = null, env = process.env }) → boolean`
  - `refreshStateLine(state, fetchedAt, now = Date.now()) → string` (no trailing newline; two-space indent)
  - `catalogInfoFromCache(doc) → { models: Array, fetchedAt: number|null, providerFailures: Array }`
  - `REFRESH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000`

- [ ] **Step 1: Write the failing tests**

`tests/utils/alias-refresh-state.test.js`:

```js
// tests/utils/alias-refresh-state.test.js
'use strict';
/**
 * #238 D5/Q8 — the ONE predicate behind the alias notice and the background
 * refresh (one test per term, spec §6 row 7), the `amicus aliases` footer
 * line (spec §4), and the cache-only catalogInfo read. Pure: env and config
 * are arguments, never process state.
 */
const {
  refreshState, exitHookAllowed, refreshStateLine, catalogInfoFromCache, REFRESH_MAX_AGE_MS,
} = require('../../src/utils/alias-refresh-state');

const H = 60 * 60 * 1000;
const D = 24 * H;
const NOW = 1_800_000_000_000;
const clean = () => ({ PATH: 'x' });   // an env carrying none of the signals

describe('refreshState — the standing half (config, env, CI)', () => {
  test('nothing set: enabled', () => {
    expect(refreshState({ config: null, env: clean() })).toEqual({ enabled: true, disabledBy: null });
    expect(refreshState({ config: { aliasReview: { dismissed: {} } }, env: clean() })).toEqual({ enabled: true, disabledBy: null });
  });
  test('config: only a literal autoRefresh false disables (mutant CONFIGSTRING: "false" or 0 would)', () => {
    expect(refreshState({ config: { aliasReview: { autoRefresh: false } }, env: clean() })).toEqual({ enabled: false, disabledBy: 'config' });
    expect(refreshState({ config: { aliasReview: { autoRefresh: 'false' } }, env: clean() }).enabled).toBe(true);
    expect(refreshState({ config: { aliasReview: { autoRefresh: 0 } }, env: clean() }).enabled).toBe(true);
    expect(refreshState({ config: { aliasReview: null }, env: clean() }).enabled).toBe(true);
  });
  test('env: only AMICUS_NO_NETWORK_PROBES=1 disables — the live-probes literal (mutant ENVANY: "0"/"true" would)', () => {
    expect(refreshState({ env: { ...clean(), AMICUS_NO_NETWORK_PROBES: '1' } })).toEqual({ enabled: false, disabledBy: 'env' });
    expect(refreshState({ env: { ...clean(), AMICUS_NO_NETWORK_PROBES: '0' } }).enabled).toBe(true);
    expect(refreshState({ env: { ...clean(), AMICUS_NO_NETWORK_PROBES: 'true' } }).enabled).toBe(true);
  });
  test("CI: is-in-ci's signal — CI set, CONTINUOUS_INTEGRATION set, any CI_* variable; CI=0 / CI=false are NOT CI (mutant CIFALSE)", () => {
    expect(refreshState({ env: { ...clean(), CI: 'true' } })).toEqual({ enabled: false, disabledBy: 'ci' });
    expect(refreshState({ env: { ...clean(), CI: '' } }).disabledBy).toBe('ci');              // presence, not truthiness
    expect(refreshState({ env: { ...clean(), CONTINUOUS_INTEGRATION: '1' } }).disabledBy).toBe('ci');
    expect(refreshState({ env: { ...clean(), CI_NAME: 'x' } }).disabledBy).toBe('ci');
    expect(refreshState({ env: { ...clean(), CI: '0' } }).enabled).toBe(true);
    expect(refreshState({ env: { ...clean(), CI: 'false' } }).enabled).toBe(true);
    expect(refreshState({ env: { ...clean(), CI: '0', CI_NAME: 'x' } }).enabled).toBe(true);  // CI=0 overrides the prefix signal, as in is-in-ci
    expect(refreshState({ env: { ...clean(), CIRCLE: '1' } }).enabled).toBe(true);            // no underscore: not the CI_ prefix
  });
  test('reason precedence: config, then env, then CI', () => {
    const env = { ...clean(), AMICUS_NO_NETWORK_PROBES: '1', CI: 'true' };
    expect(refreshState({ config: { aliasReview: { autoRefresh: false } }, env }).disabledBy).toBe('config');
    expect(refreshState({ env }).disabledBy).toBe('env');
  });
});

describe('exitHookAllowed — the per-invocation half, one term each', () => {
  const ok = { command: 'list', args: {}, stdinIsTTY: true, config: null, env: clean() };
  test('all clear: allowed', () => { expect(exitHookAllowed(ok)).toBe(true); });
  test('no terminal on stdin (mutant TTYOFF)', () => { expect(exitHookAllowed({ ...ok, stdinIsTTY: false })).toBe(false); });
  test('--json (mutant JSONON)', () => { expect(exitHookAllowed({ ...ok, args: { json: true } })).toBe(false); });
  test('--quiet, boolean or valued — quiet is not a BOOLEAN_FLAG, so `--quiet x` parses as "x" (mutant QUIETON)', () => {
    expect(exitHookAllowed({ ...ok, args: { quiet: true } })).toBe(false);
    expect(exitHookAllowed({ ...ok, args: { quiet: 'x' } })).toBe(false);
  });
  test('the mcp command (mutant MCPON)', () => { expect(exitHookAllowed({ ...ok, command: 'mcp' })).toBe(false); });
  test('the standing half is consulted: CI, env, config each veto', () => {
    expect(exitHookAllowed({ ...ok, env: { ...clean(), CI: 'true' } })).toBe(false);
    expect(exitHookAllowed({ ...ok, env: { ...clean(), AMICUS_NO_NETWORK_PROBES: '1' } })).toBe(false);
    expect(exitHookAllowed({ ...ok, config: { aliasReview: { autoRefresh: false } } })).toBe(false);
  });
  test('a missing args object is not a crash', () => { expect(exitHookAllowed({ ...ok, args: undefined })).toBe(true); });
});

describe('refreshStateLine — the amicus aliases footer (spec §4)', () => {
  const on = { enabled: true, disabledBy: null };
  test("on, three days old: the spec's example line, no hint", () => {
    expect(refreshStateLine(on, NOW - 3 * D, NOW)).toBe('  background catalog refresh: on (weekly) — catalog is 3 days old');
  });
  test('ages read as the Electron banner does: hours below a day, never "0 hours", singulars (mutant AGEWORD)', () => {
    expect(refreshStateLine(on, NOW - 5 * H, NOW)).toContain('catalog is 5 hours old');
    expect(refreshStateLine(on, NOW - 30 * 60 * 1000, NOW)).toContain('catalog is 1 hour old');
    expect(refreshStateLine(on, NOW - 25 * H, NOW)).toContain('catalog is 1 day old');
    expect(refreshStateLine(on, NOW + H, NOW)).toContain('catalog is 1 hour old');   // a future stamp never reads negative
    expect(refreshStateLine(on, null, NOW)).toBe('  background catalog refresh: on (weekly) — no catalog');
  });
  test('off: names the reason in the words the user can act on', () => {
    expect(refreshStateLine({ enabled: false, disabledBy: 'config' }, NOW - H, NOW))
      .toBe('  background catalog refresh: off (aliasReview.autoRefresh: false) — catalog is 1 hour old');
    expect(refreshStateLine({ enabled: false, disabledBy: 'env' }, NOW - H, NOW)).toContain('off (AMICUS_NO_NETWORK_PROBES=1)');
    expect(refreshStateLine({ enabled: false, disabledBy: 'ci' }, NOW - H, NOW)).toContain('off (CI)');
  });
  test('the models --refresh hint rides exactly when nothing else will refresh: off past 24 h, on past a week (mutant HINTALWAYS)', () => {
    const off = { enabled: false, disabledBy: 'config' };
    expect(refreshStateLine(off, NOW - 25 * H, NOW)).toMatch(/ — amicus models --refresh$/);
    expect(refreshStateLine(off, NOW - 23 * H, NOW)).not.toContain('models --refresh');
    expect(refreshStateLine(on, NOW - 3 * D, NOW)).not.toContain('models --refresh');
    expect(refreshStateLine(on, NOW - REFRESH_MAX_AGE_MS - 1, NOW)).toMatch(/catalog is 7 days old — amicus models --refresh$/);
    expect(refreshStateLine(on, NOW - REFRESH_MAX_AGE_MS, NOW)).not.toContain('models --refresh');
  });
});

describe('catalogInfoFromCache — the §5 display-gate read', () => {
  test('no cache: the empty shape the engine treats as "nothing"', () => {
    expect(catalogInfoFromCache(null)).toEqual({ models: [], fetchedAt: null, providerFailures: [] });
  });
  test('a cache doc: models and providerFailures verbatim, fetchedAt only when a number', () => {
    const models = [{ id: 'a/b' }];
    expect(catalogInfoFromCache({ models, fetchedAt: 5, providerFailures: [{ provider: 'x' }] }))
      .toEqual({ models, fetchedAt: 5, providerFailures: [{ provider: 'x' }] });
    expect(catalogInfoFromCache({ models, fetchedAt: '5', providerFailures: {} }))
      .toEqual({ models, fetchedAt: null, providerFailures: [] });
  });
  test('REFRESH_MAX_AGE_MS is a week', () => { expect(REFRESH_MAX_AGE_MS).toBe(7 * D); });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`Cannot find module '../../src/utils/alias-refresh-state'`)

Run: `npx jest tests/utils/alias-refresh-state.test.js`

- [ ] **Step 3: Write the module**

`src/utils/alias-refresh-state.js`:

```js
/**
 * @module utils/alias-refresh-state
 * #238 D5/Q8 — the ONE predicate behind the passive alias notice and the
 * opportunistic background catalog refresh, and the `amicus aliases` footer
 * line that names its standing half.
 *
 * Two layers, one truth. `refreshState` is the STANDING half — what a user
 * can turn off and keep off: `config.aliasReview.autoRefresh: false` (only a
 * literal false), `AMICUS_NO_NETWORK_PROBES=1` (the live-probes escape hatch,
 * utils/live-probes.js :: liveProbesAllowed — the same literal '1'), or a CI
 * environment. `exitHookAllowed` adds the per-invocation half — a terminal on
 * stdin, not `--json`, not `--quiet`, not the `mcp` command — and is what
 * bin/amicus.js's exit hook asks through utils/alias-notice.js. No new
 * environment variable (Q8).
 *
 * The CI signal is `is-in-ci`'s — the check update-notifier honours (MIT,
 * sindresorhus/is-in-ci@1.0.0): `CI` set to anything but `0`/`false`,
 * `CONTINUOUS_INTEGRATION` set, or any `CI_*` variable. Re-stated here
 * because that package is ESM-only and `ci-info` reaches this tree only
 * through jest — a devDependency an installed copy does not have.
 *
 * `catalogInfoFromCache` is the cache-only (§5 display gate) read the list
 * (sidecar/aliases.js :: collectAliasView) and the notice share: whatever is
 * on disk, verbatim, no freshness check.
 */

'use strict';

const { DEFAULT_MAX_AGE_MS } = require('./model-catalog');

const REFRESH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;   // Q1: a week

const DISABLED_REASON = { config: 'aliasReview.autoRefresh: false', env: 'AMICUS_NO_NETWORK_PROBES=1', ci: 'CI' };

/** @param {object} env @returns {boolean} is-in-ci's predicate, verbatim */
function isInCi(env) {
  return env.CI !== '0' && env.CI !== 'false'
    && ('CI' in env || 'CONTINUOUS_INTEGRATION' in env || Object.keys(env).some(k => k.startsWith('CI_')));
}

/**
 * The standing half of the Q8 predicate.
 * @param {{config?: object|null, env?: object}} [input] the loaded config (null = none) and the environment
 * @returns {{enabled: boolean, disabledBy: null|'config'|'env'|'ci'}} the first reason that applies, in that order
 */
function refreshState({ config = null, env = process.env } = {}) {
  const ar = config && config.aliasReview && typeof config.aliasReview === 'object' ? config.aliasReview : null;
  if (ar && ar.autoRefresh === false) { return { enabled: false, disabledBy: 'config' }; }
  if (env.AMICUS_NO_NETWORK_PROBES === '1') { return { enabled: false, disabledBy: 'env' }; }
  if (isInCi(env)) { return { enabled: false, disabledBy: 'ci' }; }
  return { enabled: true, disabledBy: null };
}

/**
 * The whole predicate — the notice and the refresh both hang on it (D5).
 * @param {{command: string, args: object, stdinIsTTY: boolean, config?: object|null, env?: object}} input
 * @returns {boolean}
 */
function exitHookAllowed({ command, args, stdinIsTTY, config = null, env = process.env }) {
  if (!stdinIsTTY || command === 'mcp') { return false; }
  if (args && (args.json || args.quiet)) { return false; }
  return refreshState({ config, env }).enabled;
}

/**
 * `catalog is 3 days old` / `catalog is 1 hour old` — the Electron banner's
 * arithmetic (electron/setup-ui-alias-review-text.js :: reviewBanner), so the
 * two surfaces never disagree on an age.
 * @param {number|null} fetchedAt
 * @param {number} [now]
 * @returns {string}
 */
function catalogAgeText(fetchedAt, now = Date.now()) {
  if (typeof fetchedAt !== 'number') { return 'no catalog'; }
  const ms = Math.max(0, now - fetchedAt);
  const days = Math.floor(ms / 86400000);
  const hours = Math.max(1, Math.floor(ms / 3600000));
  const age = days >= 1 ? `${days} day${days === 1 ? '' : 's'}` : `${hours} hour${hours === 1 ? '' : 's'}`;
  return `catalog is ${age} old`;
}

/**
 * The `amicus aliases` footer line (spec §4). The `amicus models --refresh`
 * hint (Phase 1's F1) rides along exactly when nothing else will refresh the
 * catalog for the user: past 24 h when the background refresh is off, past
 * the weekly threshold when it is on and evidently not keeping up.
 * @param {{enabled: boolean, disabledBy: null|string}} state from `refreshState`
 * @param {number|null} fetchedAt
 * @param {number} [now]
 * @returns {string} two-space indented, no trailing newline
 */
function refreshStateLine(state, fetchedAt, now = Date.now()) {
  const head = state.enabled ? 'on (weekly)' : `off (${DISABLED_REASON[state.disabledBy] || state.disabledBy})`;
  const age = typeof fetchedAt === 'number' ? now - fetchedAt : 0;
  const hint = age > (state.enabled ? REFRESH_MAX_AGE_MS : DEFAULT_MAX_AGE_MS) ? ' — amicus models --refresh' : '';
  return `  background catalog refresh: ${head} — ${catalogAgeText(fetchedAt, now)}${hint}`;
}

/**
 * @param {{models?: Array, fetchedAt?: number, providerFailures?: Array}|null} doc `model-catalog.js :: readCache`'s document
 * @returns {{models: Array, fetchedAt: number|null, providerFailures: Array}} the engine's `catalogInfo` shape
 */
function catalogInfoFromCache(doc) {
  return {
    models: (doc && Array.isArray(doc.models)) ? doc.models : [],
    fetchedAt: doc && typeof doc.fetchedAt === 'number' ? doc.fetchedAt : null,
    providerFailures: (doc && Array.isArray(doc.providerFailures)) ? doc.providerFailures : [],
  };
}

module.exports = { refreshState, exitHookAllowed, refreshStateLine, catalogInfoFromCache, REFRESH_MAX_AGE_MS };
```

- [ ] **Step 4: Run it — expect PASS** (every test)

Run: `npx jest tests/utils/alias-refresh-state.test.js`

- [ ] **Step 5: Prove the mutants RED** (each one: apply, run the file, see the named test fail, revert — the tree is committed first, so `git checkout -- src/utils/alias-refresh-state.js` is safe ONLY after Step 6's commit; before it, revert by hand)

Do Step 6 first, then: CONFIGSTRING (`ar.autoRefresh === false` → `!ar.autoRefresh`… no: `String(ar.autoRefresh) === 'false'`), ENVANY (`=== '1'` → truthy check), CIFALSE (drop the `env.CI !== 'false'` clause), TTYOFF (drop `!stdinIsTTY ||`), JSONON / QUIETON (drop the term), MCPON (drop `command === 'mcp'`), AGEWORD (`Math.max(1, …)` → `Math.floor(…)`), HINTALWAYS (`hint` always on). Record each in the report as `MUTANT <name>: <test that went red>`.

- [ ] **Step 6: Regenerate docs, commit (with the plan file force-added)**

```bash
node scripts/generate-docs.js
git add -f docs/superpowers/plans/2026-09-16-238-pr4-notice-refresh.md
git add src/utils/alias-refresh-state.js tests/utils/alias-refresh-state.test.js CLAUDE.md docs/architecture-map.md
git commit -m "feat(aliases): the Q8 predicate, the refresh-state footer line and the cache-only catalog read (issue 238 D5/Q8, Phase 4 T1)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

(`node scripts/check-file-sizes.js --all` must be green; the pre-commit hook runs lint-staged, secrets, sizes, citations, the architecture-map regen and validate-docs.)

---

### Task 2: `alias-notice.js` — count, decide, print, stamp, spawn

**Files:**
- Create: `src/utils/alias-notice.js`
- Test: `tests/utils/alias-notice.test.js`
- Modify (regenerated): `CLAUDE.md`, `docs/architecture-map.md`

**Interfaces:**
- Consumes (T1): `exitHookAllowed`, `catalogInfoFromCache`, `REFRESH_MAX_AGE_MS` from `./alias-refresh-state`. Existing: `config.js :: loadConfig/saveConfig/getDefaultAliases`, `alias-state.js :: normalizeAliases(aliases, defaults) → { aliases, removed }`, `alias-proposals.js :: buildAliasProposals({ userAliases, defaults, catalogInfo, retired, notable, dismissed })`, `alias-store.js :: readDismissals()`, `curated-pins.js :: loadCuratedPins() → { …, retired, notable }`, `model-catalog.js :: readCache()` (sync; the doc carries `lastRefreshAttempt` after a failed attempt — `writeRefreshFailure` merges onto it), `child_process.spawn`.
- Produces (T3 relies on this exact name): `runExitHook({ code, command, args, stdinIsTTY }, d = loadDeps()) → { notice: boolean, refresh: boolean }`, never throws. Also `countProposals(d, cfg)`, `refreshDue(doc, now)`, `spawnDetachedRefresh(d)`.

- [ ] **Step 1: Write the failing tests**

`tests/utils/alias-notice.test.js`:

```js
// tests/utils/alias-notice.test.js
'use strict';
/**
 * #238 D5 — the exit hook's decision, count, stamp and spawn, with every
 * collaborator injected (no config dir, no catalog file, no child process).
 * Spec §6 row 7: fires on stderr; not within 24 h of lastNotified (Q5); the
 * detached refresh only at exit 0 with a cache older than 7 days (Q1), never
 * on a failed run. `exitHookAllowed`'s terms are tested one by one in
 * tests/utils/alias-refresh-state.test.js; here the predicate is one gate.
 * The engines (normalizeAliases, buildAliasProposals) are the real ones —
 * pure — over a synthetic `defaults` map (never the live shipped pins).
 */
const { runExitHook, countProposals, refreshDue, spawnDetachedRefresh } = require('../../src/utils/alias-notice');
const { REFRESH_MAX_AGE_MS } = require('../../src/utils/alias-refresh-state');

const H = 60 * 60 * 1000;
const D = 24 * H;
const NOW = 1_800_000_000_000;
const DEFAULTS = { __proto__: null, glm: 'openrouter/z-ai/glm-5.3' };
const CATALOG = {
  schemaVersion: 2, fetchedAt: NOW - H,
  models: [{ id: 'openrouter/z-ai/glm-5.2' }, { id: 'openrouter/z-ai/glm-5.3' }, { id: 'openrouter/z-ai/glm-5.4' }],
};

/** A collaborator set over a "disk" of one config object and one catalog doc; every write, spawn and stderr byte is recorded. */
function deps(over = {}) {
  const disk = {
    config: over.config === undefined ? { aliases: { mine: 'openrouter/z-ai/glm-5.2' } } : over.config,
    catalog: over.catalog === undefined ? CATALOG : over.catalog,
  };
  const rec = { saves: [], spawns: [], stderr: '', unrefs: 0, errorListeners: 0 };
  const d = {
    loadConfig: () => (disk.config === null ? null : JSON.parse(JSON.stringify(disk.config))),
    saveConfig: (c) => { rec.saves.push(JSON.parse(JSON.stringify(c))); disk.config = c; },
    getDefaultAliases: () => DEFAULTS,
    normalizeAliases: require('../../src/utils/alias-state').normalizeAliases,
    buildAliasProposals: require('../../src/utils/alias-proposals').buildAliasProposals,
    readDismissals: () => (disk.config && disk.config.aliasReview && disk.config.aliasReview.dismissed) || {},
    loadCuratedPins: () => ({ retired: {}, notable: [] }),
    readCache: () => disk.catalog,
    spawn: (file, args, opts) => {
      rec.spawns.push({ file, args, opts });
      return { on: () => { rec.errorListeners += 1; }, unref: () => { rec.unrefs += 1; } };
    },
    execPath: '/usr/bin/node',
    binPath: '/repo/bin/amicus.js',
    env: { PATH: 'x', CI: '0' },
    stderr: { write: (s) => { rec.stderr += s; return true; } },
    now: () => NOW,
    ...over.deps,
  };
  return { d, rec, disk };
}
const RUN = { code: 0, command: 'list', args: {}, stdinIsTTY: true };
const STALE = { ...CATALOG, fetchedAt: NOW - 8 * D };

describe('countProposals — cache only, through the engine', () => {
  test('a custom pin behind a newer sibling counts one; a following alias counts nothing', () => {
    expect(countProposals(deps().d)).toBe(1);
    expect(countProposals(deps({ config: { aliases: {} } }).d)).toBe(0);
  });
  test('a dismissed pairing does not count (Q5)', () => {
    const config = { aliases: { mine: 'openrouter/z-ai/glm-5.2' }, aliasReview: { dismissed: { 'mine@openrouter/z-ai/glm-5.4': '2026-09-16T00:00:00.000Z' } } };
    expect(countProposals(deps({ config }).d)).toBe(0);
  });
  test('no cache, or no config at all: zero, never a throw', () => {
    expect(countProposals(deps({ catalog: null }).d)).toBe(0);
    expect(countProposals(deps({ config: null }).d)).toBe(0);
  });
  test('a seeded key equal to the shipped pin is normalized IN MEMORY (no write) and counts nothing', () => {
    const { d, rec } = deps({ config: { aliases: { glm: 'openrouter/z-ai/glm-5.3' } } });
    expect(countProposals(d)).toBe(0);
    expect(rec.saves).toEqual([]);
  });
  test('a throwing collaborator yields zero and prints nothing (mutant THROWLEAK)', () => {
    const { d, rec } = deps({ deps: { readCache: () => { throw new Error('EACCES'); } } });
    expect(countProposals(d)).toBe(0);
    expect(rec.stderr).toBe('');
  });
});

describe('refreshDue — Q1 with the daily back-off', () => {
  test('older than a week: due; exactly a week or fresher: not (mutant BOUNDARY)', () => {
    expect(refreshDue({ fetchedAt: NOW - REFRESH_MAX_AGE_MS - 1 }, NOW)).toBe(true);
    expect(refreshDue({ fetchedAt: NOW - REFRESH_MAX_AGE_MS }, NOW)).toBe(false);
    expect(refreshDue({ fetchedAt: NOW - H }, NOW)).toBe(false);
  });
  test('no cache, or a doc without fetchedAt (a first attempt that failed): not due — nothing to age (mutant NOCACHESPAWN)', () => {
    expect(refreshDue(null, NOW)).toBe(false);
    expect(refreshDue({ lastRefreshAttempt: NOW - 2 * D, lastRefreshError: 'network-error' }, NOW)).toBe(false);
  });
  test("a future fetchedAt reads as fresh, as getCatalog's rule", () => { expect(refreshDue({ fetchedAt: NOW + D }, NOW)).toBe(false); });
  test('a failed attempt within the last day backs off; an older one does not (mutant BACKOFF)', () => {
    const old = NOW - 10 * D;
    expect(refreshDue({ fetchedAt: old, lastRefreshAttempt: NOW - 2 * H }, NOW)).toBe(false);
    expect(refreshDue({ fetchedAt: old, lastRefreshAttempt: NOW - 25 * H }, NOW)).toBe(true);
    expect(refreshDue({ fetchedAt: old, lastRefreshAttempt: null }, NOW)).toBe(true);
  });
});

describe('spawnDetachedRefresh — the workspace-window.js shape', () => {
  test("this binary, models --refresh, detached, silent, hidden, unref'd, error-listened", () => {
    const { d, rec } = deps();
    expect(spawnDetachedRefresh(d)).toBe(true);
    expect(rec.spawns).toEqual([{
      file: '/usr/bin/node',
      args: ['/repo/bin/amicus.js', 'models', '--refresh'],
      opts: { detached: true, stdio: 'ignore', windowsHide: true, env: d.env },
    }]);
    expect(rec.unrefs).toBe(1);
    expect(rec.errorListeners).toBe(1);
  });
  test('a throwing spawn is false, not a throw', () => {
    const { d } = deps({ deps: { spawn: () => { throw new Error('ENOENT'); } } });
    expect(spawnDetachedRefresh(d)).toBe(false);
  });
});

describe('runExitHook — the notice', () => {
  test('fires once: the stamp, then the singular line on stderr (mutant PLURAL: "1 alias updates")', () => {
    const { d, rec } = deps();
    expect(runExitHook(RUN, d)).toEqual({ notice: true, refresh: false });
    expect(rec.stderr).toBe('\n  1 alias update available — amicus aliases --review\n');
    expect(rec.saves).toHaveLength(1);
    expect(rec.saves[0].aliasReview.lastNotified).toBe(NOW);
  });
  test('plural for two', () => {
    const { d, rec } = deps({ config: { aliases: { mine: 'openrouter/z-ai/glm-5.2', other: 'openrouter/z-ai/glm-5.3' } } });
    runExitHook(RUN, d);
    expect(rec.stderr).toContain('2 alias updates available');
  });
  test('the stamp is the ONLY write: the saved config is the loaded one plus lastNotified (mutant STAMPMORE)', () => {
    const cfg = {
      default: 'gemini', aliases: { mine: 'openrouter/z-ai/glm-5.2' },
      aliasReview: { dismissed: { 'x@y/z': '2026-01-01T00:00:00.000Z' } }, routing: { prefer: 'direct' },
    };
    const { d, rec } = deps({ config: cfg });
    runExitHook(RUN, d);
    expect(rec.saves[0]).toEqual({ ...cfg, aliasReview: { ...cfg.aliasReview, lastNotified: NOW } });
  });
  test('Q5: silent within 24 h of lastNotified; fires again at 24 h while proposals remain', () => {
    const within = deps({ config: { aliases: { mine: 'openrouter/z-ai/glm-5.2' }, aliasReview: { lastNotified: NOW - D + 1 } } });
    expect(runExitHook(RUN, within.d).notice).toBe(false);
    expect(within.rec.stderr).toBe('');
    expect(within.rec.saves).toEqual([]);
    const at = deps({ config: { aliases: { mine: 'openrouter/z-ai/glm-5.2' }, aliasReview: { lastNotified: NOW - D } } });
    expect(runExitHook(RUN, at.d).notice).toBe(true);
  });
  test('nothing to review: no line, no stamp', () => {
    const { d, rec } = deps({ config: { aliases: {} } });
    expect(runExitHook(RUN, d)).toEqual({ notice: false, refresh: false });
    expect(rec.stderr).toBe('');
    expect(rec.saves).toEqual([]);
  });
  test('the predicate is one gate: a --json run does nothing and reads no catalog', () => {
    let reads = 0;
    const { d, rec } = deps({ deps: { readCache: () => { reads += 1; return CATALOG; } } });
    expect(runExitHook({ ...RUN, args: { json: true } }, d)).toEqual({ notice: false, refresh: false });
    expect(rec.stderr).toBe('');
    expect(reads).toBe(0);
  });
  test('`amicus aliases` gets no echo of its own footer, but its refresh is still considered (mutant ALIASESECHO)', () => {
    const { d, rec } = deps({ catalog: STALE });
    expect(runExitHook({ ...RUN, command: 'aliases' }, d)).toEqual({ notice: false, refresh: true });
    expect(rec.stderr).toBe('');
  });
  test('a failing stamp still lets the line print (best-effort, the markMigrationNotified shape)', () => {
    const { d, rec } = deps({ deps: { saveConfig: () => { throw new Error('EROFS'); } } });
    expect(runExitHook(RUN, d).notice).toBe(true);
    expect(rec.stderr).toContain('1 alias update available');
  });
  test("the notice does not depend on the exit code (the update notice's precedent); the refresh does", () => {
    const { d, rec } = deps({ catalog: STALE });
    expect(runExitHook({ ...RUN, code: 1 }, d)).toEqual({ notice: true, refresh: false });
    expect(rec.spawns).toEqual([]);
  });
});

describe('runExitHook — the refresh', () => {
  test('exit 0 with a cache older than a week spawns the detached refresh (mutant FAILEDRUN: code 1 would too)', () => {
    const { d, rec } = deps({ config: { aliases: {} }, catalog: STALE });
    expect(runExitHook(RUN, d)).toEqual({ notice: false, refresh: true });
    expect(rec.spawns).toHaveLength(1);
    expect(rec.spawns[0].args).toEqual(['/repo/bin/amicus.js', 'models', '--refresh']);
    expect(runExitHook({ ...RUN, code: 1 }, deps({ config: { aliases: {} }, catalog: STALE }).d).refresh).toBe(false);
  });
  test('a fresh cache, no cache, or a day-old failed attempt: no spawn', () => {
    expect(runExitHook(RUN, deps({ config: { aliases: {} } }).d).refresh).toBe(false);
    expect(runExitHook(RUN, deps({ config: { aliases: {} }, catalog: null }).d).refresh).toBe(false);
    expect(runExitHook(RUN, deps({ config: { aliases: {} }, catalog: { ...STALE, lastRefreshAttempt: NOW - H } }).d).refresh).toBe(false);
  });
  test('the standing half vetoes the refresh too: autoRefresh false, the env literal, CI', () => {
    expect(runExitHook(RUN, deps({ config: { aliases: {}, aliasReview: { autoRefresh: false } }, catalog: STALE }).d).refresh).toBe(false);
    expect(runExitHook(RUN, deps({ config: { aliases: {} }, catalog: STALE, deps: { env: { AMICUS_NO_NETWORK_PROBES: '1' } } }).d).refresh).toBe(false);
    expect(runExitHook(RUN, deps({ config: { aliases: {} }, catalog: STALE, deps: { env: { CI: 'true' } } }).d).refresh).toBe(false);
  });
  test('a throw anywhere is swallowed: both false, nothing printed (mutant THROWLEAK)', () => {
    const { d, rec } = deps({ deps: { loadConfig: () => { throw new Error('boom'); } } });
    expect(runExitHook(RUN, d)).toEqual({ notice: false, refresh: false });
    expect(rec.stderr).toBe('');
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`Cannot find module '../../src/utils/alias-notice'`)

Run: `npx jest tests/utils/alias-notice.test.js`

- [ ] **Step 3: Write the module**

`src/utils/alias-notice.js`:

```js
/**
 * @module utils/alias-notice
 * #238 D5 — the passive alias notice and the opportunistic background catalog
 * refresh, both run from bin/amicus.js's `'exit'` listener through
 * `runExitHook` (the slot the update notice uses, so the line lands AFTER the
 * command's own output and stdout stays byte-clean under every command).
 *
 * Everything here is SYNCHRONOUS — an `'exit'` listener has no event loop —
 * and best-effort: a throw anywhere is swallowed, and nothing but the notice
 * line is ever printed, because an awareness feature must never turn a
 * finished command into a failed or noisier one. The count comes from the
 * catalog CACHE at any age (§5 display gate) through the same engine the list
 * and the pickers use (alias-proposals.js :: buildAliasProposals) over the
 * in-memory normalized aliases — the no-write probe sidecar/aliases.js ::
 * normalizeOnEntry takes with `write: false`. The notice path never networks
 * and writes nothing but `config.aliasReview.lastNotified` (`stampNotified`,
 * the config.js :: markMigrationNotified shape: load, set, save, swallow —
 * and saveConfig's own D6 normalization rides that write, once, visibly).
 *
 * The refresh is `amicus models --refresh` in a detached child of this very
 * binary — keys included, the SAME model-catalog.js :: refreshCatalog (a
 * keyless refresh would overwrite the direct-provider rows setup and doctor
 * rely on) — spawned the way sidecar/workspace-window.js spawns the
 * workspace, so it can neither block nor fail the run: `detached` keeps it
 * out of libuv's kill-on-close job, `windowsHide` keeps a console window from
 * opening on Windows. Its stdin is not a terminal, so the child's own exit
 * hook is silent by `exitHookAllowed`'s first term: no recursion.
 * `refreshDue` also backs off a day after a failed attempt
 * (`lastRefreshAttempt`, model-catalog.js :: writeRefreshFailure) — an
 * offline machine gets one child a day, not one per command.
 */

'use strict';

const path = require('path');
const { exitHookAllowed, catalogInfoFromCache, REFRESH_MAX_AGE_MS } = require('./alias-refresh-state');

const NOTICE_INTERVAL_MS = 24 * 60 * 60 * 1000;   // Q5: at most once a day
const ATTEMPT_BACKOFF_MS = 24 * 60 * 60 * 1000;   // a failed refresh is retried daily, never per command
const BIN_PATH = path.join(__dirname, '..', '..', 'bin', 'amicus.js');

/** @returns {object} this module's collaborators, gathered so a caller can override them in tests */
function loadDeps() {
  const config = require('./config');
  return {
    loadConfig: config.loadConfig,
    saveConfig: config.saveConfig,
    getDefaultAliases: config.getDefaultAliases,
    normalizeAliases: require('./alias-state').normalizeAliases,
    buildAliasProposals: require('./alias-proposals').buildAliasProposals,
    readDismissals: require('./alias-store').readDismissals,
    loadCuratedPins: require('./curated-pins').loadCuratedPins,
    readCache: require('./model-catalog').readCache,
    spawn: require('child_process').spawn,
    execPath: process.execPath,
    binPath: BIN_PATH,
    env: process.env,
    stderr: process.stderr,
    now: Date.now,
  };
}

/**
 * Cache-only proposal count (§5 display gate) over the normalized-in-memory aliases.
 * @param {object} [d] collaborators
 * @param {object|null} [cfg] the loaded config, when the caller already holds it
 * @returns {number} 0 on any failure — a count nobody can verify is not printed
 */
function countProposals(d = loadDeps(), cfg = d.loadConfig()) {
  try {
    const defaults = d.getDefaultAliases();
    const raw = cfg && cfg.aliases && typeof cfg.aliases === 'object' ? cfg.aliases : {};
    const userAliases = d.normalizeAliases(raw, defaults).aliases;
    const { retired, notable } = d.loadCuratedPins();
    const catalogInfo = catalogInfoFromCache(d.readCache());
    return d.buildAliasProposals({ userAliases, defaults, catalogInfo, retired, notable, dismissed: d.readDismissals() }).length;
  } catch { return 0; }
}

/**
 * Q1: a cache exists, is older than a week, and no refresh was attempted in the last day.
 * No cache at all is NOT due: there is nothing to age, and setup/doctor/models create it.
 * @param {{fetchedAt?: number, lastRefreshAttempt?: number|null}|null} doc `readCache()`'s document
 * @param {number} [now]
 * @returns {boolean}
 */
function refreshDue(doc, now = Date.now()) {
  if (!doc || typeof doc.fetchedAt !== 'number') { return false; }
  if (now - doc.fetchedAt <= REFRESH_MAX_AGE_MS) { return false; }   // a future fetchedAt reads as fresh, as getCatalog's rule
  if (typeof doc.lastRefreshAttempt === 'number' && now - doc.lastRefreshAttempt < ATTEMPT_BACKOFF_MS) { return false; }
  return true;
}

/**
 * `amicus models --refresh`, detached, silent, unref'd — the workspace-window.js shape.
 * @param {object} [d] collaborators
 * @returns {boolean} true when the child was spawned (never that it succeeded)
 */
function spawnDetachedRefresh(d = loadDeps()) {
  try {
    const child = d.spawn(d.execPath, [d.binPath, 'models', '--refresh'],
      { detached: true, stdio: 'ignore', windowsHide: true, env: d.env });
    // An unlistened ChildProcess 'error' is an uncaught exception (workspace-window.js's note).
    if (child && typeof child.on === 'function') { child.on('error', () => {}); }
    if (child && typeof child.unref === 'function') { child.unref(); }
    return true;
  } catch { return false; }
}

/** Best-effort `config.aliasReview.lastNotified = now` — the markMigrationNotified shape. */
function stampNotified(now, d) {
  try {
    const cfg = d.loadConfig() || {};
    if (!cfg.aliasReview || typeof cfg.aliasReview !== 'object') { cfg.aliasReview = {}; }
    cfg.aliasReview.lastNotified = now;
    d.saveConfig(cfg);
  } catch { /* a persistence hiccup never touches the command that just finished */ }
}

/**
 * The exit hook. Decides, stamps, prints at most one line, spawns — or does nothing.
 * @param {{code: number, command: string, args: object, stdinIsTTY: boolean}} run the finished command
 * @param {object} [d] collaborators
 * @returns {{notice: boolean, refresh: boolean}} what fired — never throws
 */
function runExitHook({ code, command, args, stdinIsTTY }, d = loadDeps()) {
  const out = { notice: false, refresh: false };
  try {
    const cfg = d.loadConfig();
    if (!exitHookAllowed({ command, args, stdinIsTTY, config: cfg, env: d.env })) { return out; }
    const now = d.now();
    // `amicus aliases` IS the notice's destination and already prints the count — no echo behind it.
    if (command !== 'aliases') {
      const last = cfg && cfg.aliasReview && typeof cfg.aliasReview.lastNotified === 'number' ? cfg.aliasReview.lastNotified : null;
      if (last === null || now - last >= NOTICE_INTERVAL_MS) {
        const n = countProposals(d, cfg);
        if (n > 0) {
          stampNotified(now, d);   // first, so the notice is the last line on stderr (saveConfig may print D6 Notices)
          d.stderr.write(`\n  ${n} alias update${n === 1 ? '' : 's'} available — amicus aliases --review\n`);
          out.notice = true;
        }
      }
    }
    if (code === 0 && refreshDue(d.readCache(), now)) { out.refresh = spawnDetachedRefresh(d); }
  } catch { /* best-effort: an awareness feature never fails a finished command */ }
  return out;
}

module.exports = { runExitHook, countProposals, refreshDue, spawnDetachedRefresh };
```

- [ ] **Step 4: Run it — expect PASS**

Run: `npx jest tests/utils/alias-notice.test.js`

- [ ] **Step 5: Commit, then prove the mutants RED** (apply, run, revert with `git checkout -- src/utils/alias-notice.js` — the tree is committed): THROWLEAK (remove `countProposals`'s try/catch), BOUNDARY (`<=` → `<`), NOCACHESPAWN (drop the `!doc ||` clause… the `fetchedAt` check still catches null → instead return `true` for `!doc`), BACKOFF (drop the `lastRefreshAttempt` clause), PLURAL (`n === 1` → `n === 0`), STAMPMORE (stamp also sets `cfg.aliasReview.autoRefresh = true`), ALIASESECHO (drop `command !== 'aliases'`), FAILEDRUN (drop `code === 0 &&`). Record each.

```bash
node scripts/generate-docs.js
git add src/utils/alias-notice.js tests/utils/alias-notice.test.js CLAUDE.md docs/architecture-map.md
git commit -m "feat(aliases): the exit hook's decision — cache-only count, once-a-day notice, best-effort stamp, detached weekly refresh (issue 238 D5, Phase 4 T2)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Wire `bin/amicus.js` — the `'exit'` listener, proven end-to-end

**Files:**
- Modify: `bin/amicus.js` (the update-notice block, `bin/amicus.js :: main`, currently lines 94–110)
- Create: `tests/helpers/tty-stdin-shim.js`
- Test: `tests/bin/alias-notice-hook.test.js`

**Interfaces:**
- Consumes (T2): `runExitHook({ code, command, args, stdinIsTTY })`.
- Produces: nothing new — this task is wiring and its proof.

- [ ] **Step 1: Write the shim and the failing e2e tests**

`tests/helpers/tty-stdin-shim.js`:

```js
'use strict';
/**
 * Preloaded with `node -r` by tests/bin/alias-notice-hook.test.js so a spawned
 * bin/amicus.js sees a terminal on stdin (`process.stdin.isTTY`), which a
 * child's piped stdin never is. Test-side only: no production code reads
 * anything this file sets — it is how the #238 D5 exit hook's TTY term is
 * satisfied without a new environment variable (Q8).
 */
Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
```

`tests/bin/alias-notice-hook.test.js`:

```js
'use strict';
/**
 * #238 D5 — bin/amicus.js's exit hook is WIRED: a finished command in a
 * terminal prints the alias notice on stderr after its own output and stamps
 * `aliasReview.lastNotified`; without a terminal on stdin, under --json, or
 * for --help, nothing happens. The predicate and the decision are unit-tested
 * in tests/utils/alias-refresh-state.test.js / alias-notice.test.js; this
 * file proves only the wiring, through a real child process (the
 * tests/bin/cwd-guard.test.js spawn idiom). A spawned child's stdin is a pipe,
 * so the positive cases preload tests/helpers/tty-stdin-shim.js with `node -r`
 * — a test-side seam, no production hook. AMICUS_MOCK_UPDATE keeps the real
 * update-notifier (network) out of the child; its fake update notice prints
 * too, which is why the positive assertion is "ends with": it proves the
 * order as well. CI=0 is is-in-ci's override — the runner's own CI=true would
 * veto the predicate. The fixture catalog is FRESH: no case may put a
 * week-old cache in front of a real spawn (the refresh is proven at the
 * module level and live, never here).
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BIN = path.join(__dirname, '..', '..', 'bin', 'amicus.js');
const SHIM = path.join(__dirname, '..', 'helpers', 'tty-stdin-shim.js');
const LINE = '1 alias update available — amicus aliases --review';

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-notice-hook-'));
  // A CUSTOM alias behind a newer sibling: one proposal whatever the shipped pins say (failure mode #53).
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ aliases: { mine: 'openrouter/z-ai/glm-5.2' } }));
  fs.writeFileSync(path.join(dir, 'model-catalog.json'), JSON.stringify({
    schemaVersion: 2, fetchedAt: Date.now() - 60 * 60 * 1000,
    models: [{ id: 'openrouter/z-ai/glm-5.2' }, { id: 'openrouter/z-ai/glm-5.4' }],
  }));
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

function run(args, { tty }) {
  const env = { ...process.env, AMICUS_CONFIG_DIR: dir, AMICUS_ENV_DIR: dir, AMICUS_MOCK_UPDATE: 'success', CI: '0' };
  delete env.AMICUS_NO_NETWORK_PROBES;
  const r = spawnSync(process.execPath, [...(tty ? ['-r', SHIM] : []), BIN, ...args, '--cwd', dir], { encoding: 'utf-8', env });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}
const config = () => JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf-8'));

describe('the exit hook, wired (#238 D5)', () => {
  test('a terminal, a finished command: the notice is the LAST thing on stderr and lastNotified is stamped (mutant UNWIRED)', () => {
    const before = Date.now();
    const r = run(['list'], { tty: true });
    expect(r.code).toBe(0);
    expect(r.stderr.trimEnd().endsWith(LINE)).toBe(true);
    expect(r.stderr).toContain('Update available');            // the slot's other tenant printed first
    expect(config().aliasReview.lastNotified).toBeGreaterThanOrEqual(before);
  });
  test('a second run within the day is silent and does not re-stamp (Q5)', () => {
    run(['list'], { tty: true });
    const stamp = config().aliasReview.lastNotified;
    const r = run(['list'], { tty: true });
    expect(r.stderr).not.toContain('alias update');
    expect(config().aliasReview.lastNotified).toBe(stamp);
  });
  test('no terminal on stdin: nothing printed, nothing written', () => {
    const r = run(['list'], { tty: false });
    expect(r.code).toBe(0);
    expect(r.stderr).not.toContain('alias update');
    expect(config().aliasReview).toBeUndefined();
  });
  test('--json reaches the hook as args (mutant ARGSDROP: bin passing {} would print here)', () => {
    const r = run(['list', '--json'], { tty: true });
    expect(r.stderr).not.toContain('alias update');
    expect(config().aliasReview).toBeUndefined();
  });
  test('--help exits above the slot: registered inside the guard, never fires (mutant HELPHOOK)', () => {
    const r = run(['list', '--help'], { tty: true });
    expect(r.code).toBe(0);
    expect(r.stderr).not.toContain('alias update');
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (the first, positive test: `endsWith` false; the others pass vacuously — that is fine, they pin the negative space)

Run: `npx jest tests/bin/alias-notice-hook.test.js`

- [ ] **Step 3: Wire the slot**

In `bin/amicus.js :: main`, the block that starts `// Non-interactive update check (skip for mcp, --version, --help)` — append INSIDE its `if`, after the `if (cliUpdateInfo) { … }` statement:

```js
    // #238 D5: the passive alias notice + the weekly background catalog
    // refresh, from the same slot (utils/alias-notice.js decides; the Q8
    // predicate lives in utils/alias-refresh-state.js). stdin's TTY-ness is
    // read HERE, not in the listener — an 'exit' listener must not
    // materialise a stream — and a non-TTY stdin (an MCP-spawned start, a
    // pipe, the refresh child itself) is silent by the predicate's first term.
    // Registered after the update listener so the notice is the last line.
    const { runExitHook } = require('../src/utils/alias-notice');
    const stdinIsTTY = !!process.stdin.isTTY;
    process.on('exit', (code) => { runExitHook({ code, command, args, stdinIsTTY }); });
```

- [ ] **Step 4: Run it — expect PASS**

Run: `npx jest tests/bin/alias-notice-hook.test.js` — then `npx jest tests/update-notice.test.js tests/mcp-server-update-notice.test.js tests/bin` (the slot's neighbours).

- [ ] **Step 5: Measure the exit-hook cost** (report it; no assertion): with the fixture config dir from the test, `node -e` is BANNED — write `scratch/measure-hook.js` outside the repo or run `AMICUS_CONFIG_DIR=<fixture> node bin/amicus.js list --cwd <fixture>` five times with the shim and without, `time`d; the difference is the hook (expected < 30 ms: three sync JSON reads + the engine over a handful of rows). Record the numbers in the report.

- [ ] **Step 6: Commit, then prove the mutants RED** (UNWIRED: comment out the `process.on('exit', …)` line; ARGSDROP: pass `args: {}`; HELPHOOK: move the three lines below the guard's closing brace — the `--help` test goes red; revert with `git checkout -- bin/amicus.js`).

```bash
git add bin/amicus.js tests/helpers/tty-stdin-shim.js tests/bin/alias-notice-hook.test.js
git commit -m "feat(cli): register the alias notice / background refresh exit hook in the update-notice slot (issue 238 D5, Phase 4 T3)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: `amicus aliases` — the refresh-state footer and `--json`'s `backgroundRefresh`

**Files:**
- Modify: `src/sidecar/aliases.js` (`collectAliasView`, `renderAliasList`'s footer, `buildAliasesDoc`, the imports, the module docblock)
- Test: `tests/sidecar/aliases-command.test.js`

**Interfaces:**
- Consumes (T1): `refreshState`, `refreshStateLine`, `catalogInfoFromCache`.
- Produces: `collectAliasView(...)` resolves with a new field `refreshState: { enabled, disabledBy }`; the `--json` document gains `backgroundRefresh: { enabled, disabledBy }` (`null` on a view built without it); the text footer's last line is `refreshStateLine`'s.

- [ ] **Step 1: Write the failing tests** — in `tests/sidecar/aliases-command.test.js`, inside the first `describe('amicus aliases (#238 D4 — list and --json)')`:

  1. In its `beforeEach`, after `jest.resetModules();` add `process.env.CI = '0';` (the runner's `CI=true` would read as "off (CI)"); in `afterEach` add `delete process.env.CI;`. (The whole file: `const savedCI = process.env.CI;` at the top and restore it in an `afterAll`.)
  2. REPLACE the existing test `'F1: a catalog older than 24h gets a second footer line naming its age'` (it asserts `(catalog is 3 days old — amicus models --refresh)`, the line this task folds away) with:

```js
  test("Q8 footer (F1 folded in): the standing refresh state and the catalog's age, in the spec's words", async () => {
    catalogCache = { ...CATALOG, fetchedAt: Date.now() - 3 * 24 * 60 * 60 * 1000 };
    const { code, out } = await captureStdout(() => handleAliases({ _: ['aliases'] }));
    expect(code).toBe(0);
    expect(out).toContain('\n  background catalog refresh: on (weekly) — catalog is 3 days old\n');
    expect(out).not.toContain('(catalog is 3 days old — amicus models --refresh)');
    expect(out).not.toContain('models --refresh');   // on + 3 days is the weekly cadence working
  });
  test('Q8 footer: off by config names the key and the hint rides when stale; off by CI names CI (mutant STATELIE: "on" regardless)', async () => {
    cfg.saveConfig({ aliases: {}, aliasReview: { autoRefresh: false } });
    catalogCache = { ...CATALOG, fetchedAt: Date.now() - 3 * 24 * 60 * 60 * 1000 };
    let r = await captureStdout(() => handleAliases({ _: ['aliases'] }));
    expect(r.out).toContain('\n  background catalog refresh: off (aliasReview.autoRefresh: false) — catalog is 3 days old — amicus models --refresh\n');
    cfg.saveConfig({ aliases: {} });
    process.env.CI = 'true';
    r = await captureStdout(() => handleAliases({ _: ['aliases'] }));
    expect(r.out).toContain('  background catalog refresh: off (CI) — catalog is 3 days old');
  });
  test('Q8 footer: no catalog at all — no state line (nothing refreshes until a first fetch creates the cache; the unavailable line already names models --refresh)', async () => {
    catalogCache = null;
    const { out } = await captureStdout(() => handleAliases({ _: ['aliases'] }));
    expect(out).toContain('catalog unavailable — cannot check for updates (amicus models --refresh)');
    expect(out).not.toContain('background catalog refresh');
  });
  test('--json carries the state as backgroundRefresh (mutant JSONMISSING)', async () => {
    cfg.saveConfig({ aliases: {}, aliasReview: { autoRefresh: false } });
    const { out } = await captureStdout(() => handleAliases({ _: ['aliases'], json: true }));
    expect(JSON.parse(out).backgroundRefresh).toEqual({ enabled: false, disabledBy: 'config' });
    cfg.saveConfig({ aliases: {} });
    const on = await captureStdout(() => handleAliases({ _: ['aliases'], json: true }));
    expect(JSON.parse(on.out).backgroundRefresh).toEqual({ enabled: true, disabledBy: null });
  });
```

  3. The hand-built-view tests later in the file (`renderAliasList(view)` with no `refreshState`) stay as they are — a view without the field prints no state line.

- [ ] **Step 2: Run it — expect FAIL** (the four new tests)

Run: `npx jest tests/sidecar/aliases-command.test.js`

- [ ] **Step 3: Edit `src/sidecar/aliases.js`**

  a. Imports: replace `const { DEFAULT_MAX_AGE_MS } = require('../utils/model-catalog');` with `const { refreshState, refreshStateLine, catalogInfoFromCache } = require('../utils/alias-refresh-state');` (that constant's only use was the footer block this task replaces).

  b. Module docblock: after the paragraph ending `Every form normalizes the config on entry (D6), best-effort.` add one line: ` * The footer names the background refresh's standing state (Q8, utils/alias-refresh-state.js).`

  c. `collectAliasView`: replace the five lines
```js
      const c = d.readCache();
      catalogInfo = {
        models: (c && Array.isArray(c.models)) ? c.models : [],
        fetchedAt: c && typeof c.fetchedAt === 'number' ? c.fetchedAt : null,
        providerFailures: (c && Array.isArray(c.providerFailures)) ? c.providerFailures : [],
      };
```
   with
```js
      catalogInfo = catalogInfoFromCache(d.readCache());
```
   (keep the comment above it), and change the return to
```js
  const state = refreshState({ config: d.config.loadConfig(), env: process.env });   // Q8: the standing half, for the footer and --json
  return { rows, proposals, catalogInfo, catalogAvailable: (catalogInfo.models || []).length > 0, retired, refreshState: state };
```

  d. `renderAliasList`: replace the footer block
```js
  // F1: the catalog is available but stale -- name its age so a user who
  // never runs --review still learns the background refresh isn't keeping up.
  const fetchedAt = view.catalogInfo && view.catalogInfo.fetchedAt;
  if (typeof fetchedAt === 'number' && (Date.now() - fetchedAt) > DEFAULT_MAX_AGE_MS) {
    const days = Math.floor((Date.now() - fetchedAt) / DEFAULT_MAX_AGE_MS);
    lines.push(`  (catalog is ${days} day${days === 1 ? '' : 's'} old — amicus models --refresh)`);
  }
```
   with
```js
  // Q8 (issue 238 D5): the background refresh's standing state with the catalog's
  // age -- Phase 1's F1 line folded in; refreshStateLine says when the hint rides.
  if (view.refreshState) { lines.push(refreshStateLine(view.refreshState, view.catalogInfo && view.catalogInfo.fetchedAt)); }
```

  e. `buildAliasesDoc`: add `backgroundRefresh: view.refreshState || null,` after `retired: view.retired || {},`.

- [ ] **Step 4: Run — expect PASS**; then the neighbours: `npx jest tests/sidecar tests/electron/ipc-aliases.test.js tests/electron/setup-ui-alias-review.test.js` (the Electron IPC view consumes `collectAliasView`; the extra field must be inert there).

- [ ] **Step 5: Sizes** — `node scripts/check-file-sizes.js --all`; `aliases.js` must be ≤ 290 (expected ≈ 281). Commit, then mutants: STATELIE (`refreshState(...)` → `{ enabled: true, disabledBy: null }`), JSONMISSING (drop the field), HINT (the folded F1 line reinstated would duplicate — not a mutant, a regression the first new test pins).

```bash
git add src/sidecar/aliases.js tests/sidecar/aliases-command.test.js
git commit -m "feat(aliases): the list footer names the background refresh's state; --json carries backgroundRefresh (issue 238 Q8, Phase 4 T4)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Docs — every prose surface, one owner

**Files:**
- Modify: `docs/usage.md` (the "Aliases: following vs pinned" section), `docs/configuration.md` (the Behavior env table; the Model Aliases section; the config-file-format `aliasReview` block), `README.md` (the `amicus aliases` command row), `CHANGELOG.md` (`[Unreleased]` → `### Added`)

**Interfaces:** none — prose. The tests that gate docs (`tests/docs-command-coverage.test.js`, `tests/docs-quick-sync.test.js`, `scripts/validate-docs.js` in the hook) must stay green; `node scripts/generate-docs.js --check` clean.

- [ ] **Step 1: `docs/usage.md`** — in "Aliases: following vs pinned", after the paragraph that begins `Accepting a catalog-vouched id needs a catalog fresher than 24 hours`, insert:

```markdown
**Staying current without running anything.** After any command that ran in a terminal, Amicus prints one line on stderr when updates are waiting — `2 alias updates available — amicus aliases --review` — at most once a day, computed from the cached catalog and never from the network; a proposal you *never ask again* stops counting. Once a week at most — after a command that exits 0 and finds the cached catalog older than seven days — it starts the same keyed refresh `amicus models --refresh` performs, detached in the background, so it can neither slow nor fail the command (an authenticated model-list call to each provider you hold a key for — the same cost as the picker's inline refresh; a failed attempt is retried a day later, not on every command). Both stay silent when stdin is not a terminal, under `--json` or `--quiet`, in `amicus mcp`, in CI (`CI`, `CONTINUOUS_INTEGRATION` or any `CI_*` variable, unless `CI=0`/`false`), with `AMICUS_NO_NETWORK_PROBES=1`, or with `"aliasReview": { "autoRefresh": false }` in `config.json` — no new environment variable. `amicus aliases` shows the standing state in its footer — `background catalog refresh: on (weekly) — catalog is 3 days old`, or `off (aliasReview.autoRefresh: false)` / `off (AMICUS_NO_NETWORK_PROBES=1)` / `off (CI)` — with the `amicus models --refresh` hint only when nothing else will refresh it (off and older than a day; on and older than a week), and `--json` carries it as `backgroundRefresh: { enabled, disabledBy }`. The first time the notice writes its once-a-day stamp into a config that still holds keys equal to the shipped pins, those keys are dropped with one `Notice:` line each — the same normalization every other save performs.
```

- [ ] **Step 2: `docs/configuration.md`**

  a. Behavior table — add a row after `AMICUS_BASE_URL_NORMALIZE`:

```markdown
| `AMICUS_NO_NETWORK_PROBES` | Set `1` to turn off the live provider probes `amicus doctor` runs AND the weekly background catalog refresh + the once-a-day alias notice (#238 D5). Only the literal `1` counts. | *(unset)* |
```

  b. Model Aliases section — after `See \`amicus aliases\` for what resolves on your machine.` add: `Amicus tells you once a day, after any command, when the cached catalog shows updates waiting, and refreshes that catalog in the background once a week — see [usage.md § Aliases](./usage.md#aliases-following-vs-pinned) for the notice, the refresh and the two ways to turn them off.`

  c. Config-file-format block — replace the `aliasReview` comment + object with:

```jsonc
  // `dismissed` is written by `amicus aliases --review`'s "never ask again" —
  // keyed `alias@proposedId`; hand-delete a key here to be asked again.
  // `autoRefresh: false` turns off the weekly background catalog refresh AND
  // the once-a-day "N alias updates available" notice (#238 D5) — only a
  // literal false does; `AMICUS_NO_NETWORK_PROBES=1` or a CI environment
  // turns both off without a config file. `lastNotified` (epoch ms) is
  // written automatically when the notice fires — don't hand-edit it.
  "aliasReview": {
    "autoRefresh": true,
    "lastNotified": 1757980800000,
    "dismissed": { "glm@openrouter/z-ai/glm-5.4": "2026-09-14T00:00:00.000Z" }
  },
```

- [ ] **Step 3: `README.md`** — the `amicus aliases` row: append to its description `; after any command, a once-a-day notice when updates are waiting, and a weekly background catalog refresh (\`aliasReview.autoRefresh: false\` turns both off).`

- [ ] **Step 4: `CHANGELOG.md`** — under `## [Unreleased]` → `### Added`, after the `amicus doctor` bullet:

```markdown
- **A once-a-day alias notice and a weekly background catalog refresh** (#238 D5, Q1/Q5/Q8). After
  any command run in a terminal, one stderr line — `2 alias updates available — amicus aliases
  --review` — when the cached catalog shows updates waiting (at most once per 24 h, stamped in
  `aliasReview.lastNotified`; never computed from the network). After a command that exits 0 with a
  cached catalog older than seven days, the same keyed refresh `amicus models --refresh` performs
  runs detached in the background (a failed attempt is retried a day later, not per command; no
  cache at all is not refreshed — `setup`/`doctor`/`models` create it). One predicate gates both: a
  terminal on stdin, not `--json`/`--quiet`, not `amicus mcp`, not CI, `AMICUS_NO_NETWORK_PROBES`
  unset, `aliasReview.autoRefresh` not `false` — no new environment variable. `amicus aliases`'
  footer names the state (`background catalog refresh: on (weekly) — catalog is 3 days old`); the
  `amicus models --refresh` hint that line replaces now rides only when nothing else will refresh
  (off and older than a day, on and older than a week); `--json` carries
  `backgroundRefresh: { enabled, disabledBy }`.
```

- [ ] **Step 5: Gates** — `node scripts/generate-docs.js --check`, `npx jest tests/docs-command-coverage.test.js tests/docs-quick-sync.test.js tests/shim-removal-docs.test.js`, then commit:

```bash
git add docs/usage.md docs/configuration.md README.md CHANGELOG.md
git commit -m "docs(aliases): the once-a-day notice, the weekly background refresh, the two ways off, the footer and --json field (issue 238 D5/Q8, Phase 4 T5)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: The notable list — curation rule, content gate, entrants

**Files:**
- Modify: `src/utils/curated-pins.json` (`notable`), `docs/usage.md` (the "Owner mode" paragraph), `CHANGELOG.md` (one bullet)
- Test: `tests/utils/curated-pins-notable.test.js`

**Interfaces:**
- Consumes: `curated-pins.js :: loadCuratedPins() → { pins, retired, notable }` (validator `validateNotable`: `id` with a `/`, `suggestedAlias` a valid name that is not a pin or retired, optional string `note`), `curated-models.js :: stripGatewayPrefix(id)`.
- Produces: the shipped `notable` entries the engine (`alias-proposals.js :: proposeNotable`) turns into `unmapped` proposals for every user who has not accepted or dismissed them.

**Entrants: NONE** (Christian's decision, 2026-09-16 — "none for now"). `notable` stays `[]`; Steps 1–3 ship the rule and its gate, which are the deliverable either way (R-P4-10); Step 4 does not apply. `src/utils/curated-pins.json` is NOT modified by this task.

- [ ] **Step 1: Write the content gate** — `tests/utils/curated-pins-notable.test.js`:

```js
// tests/utils/curated-pins-notable.test.js
'use strict';
/**
 * #238 D7 (editorial half) — the SHIPPED notable list obeys the curation rule
 * docs/usage.md states (Owner mode → "The notable list"): every entrant is a
 * standing `add <alias> → <id>` proposal for every user, so the mechanical
 * half of the rule is enforced here — a note on every entry, a concrete
 * release (no :free / -latest / preview id), and no id a shipped pin already
 * names in any route form. The shape itself is validateCuratedPins's job
 * (tests/utils/curated-pins.test.js).
 */
const { loadCuratedPins } = require('../../src/utils/curated-pins');
const { stripGatewayPrefix } = require('../../src/utils/curated-models');

const { pins, notable } = loadCuratedPins();
const pinnedIds = new Set(Object.values(pins).flatMap(p => Object.values(p.routes || {})).map(stripGatewayPrefix));

describe('the shipped notable list follows its curation rule', () => {
  test('is an array (possibly empty) whose entries each carry a one-line note', () => {
    expect(Array.isArray(notable)).toBe(true);
    for (const n of notable) {
      expect(typeof n.note).toBe('string');
      expect(n.note.trim().length).toBeGreaterThan(0);
      expect(n.note).not.toMatch(/\n/);
    }
  });
  test('names concrete releases: no :free, -latest or preview id', () => {
    for (const n of notable) { expect(n.id).not.toMatch(/:free$|-latest$|preview/i); }
  });
  test('names nothing a shipped pin already covers, in any route form', () => {
    for (const n of notable) { expect(pinnedIds.has(stripGatewayPrefix(n.id))).toBe(false); }
  });
  test('suggests distinct aliases', () => {
    const names = notable.map(n => n.suggestedAlias);
    expect(new Set(names).size).toBe(names.length);
  });
});
```

Run: `npx jest tests/utils/curated-pins-notable.test.js` — PASS on the empty list (the gate is for the entrants; with entrants that break it, it goes red — that is the proof).

- [ ] **Step 2: The rule — `docs/usage.md`**, at the end of the "Owner mode" paragraph (after `the match rules (\`idPattern\`, divergent vendors) stay in \`src/utils/curated-models.js\`.`), add a new paragraph:

```markdown
**The notable list.** `curated-pins.json`'s `notable` array is the editorial half of discovery: a model no sibling rule can reach — a new vendor or a new family, not a new version of something already pinned. An entry qualifies when it is (1) a concrete release the catalog lists as served (not a `-preview`, `-latest` or `:free` variant), (2) from a vendor or family no shipped pin covers, (3) worth a standing alias — you would seat it in a council today — and (4) carries a one-line `note` saying why. It is hand-edited (`{ "id": "provider/model", "suggestedAlias": "name", "note": "…" }`; `npm test` validates the shape and the rule's mechanical half — the id needs a `/`, the alias must not be a pin or a retired name, the note is required, no `:free`/`-latest`/preview id, no id a pin already names); owner mode has no verb for it. Every user sees each entry as an `add <alias> → <id>` proposal — in the list count, both pickers and the once-a-day notice — until they accept or dismiss it, so an entry is a nag by design: keep the list short, and delete an entry once a shipped pin covers the family or the model is superseded.
```

- [ ] **Step 3: `CHANGELOG.md`** — under `[Unreleased]` → `### Added`, after the T5 bullet:

```markdown
- **The notable list** (#238 D7, editorial half) — `curated-pins.json`'s `notable` entries are shipped
  `add <alias> → <id>` proposals for models no sibling rule can reach (a new vendor or family, never
  a new version of a pinned model); the curation rule and the content gate that enforces its
  mechanical half live in docs/usage.md (Owner mode) and `tests/utils/curated-pins-notable.test.js`.
```

  If entrants ship, add a sentence naming them: `First entrants: \`<alias>\` → \`<id>\` (…)`.

- [ ] **Step 4: Entrants** — does not apply (none named). For the record, when the owner later adds one by hand: write it into `src/utils/curated-pins.json`'s `notable` array in the file's canonical format (2-space JSON, key order `id`, `suggestedAlias`, `note`) and run `npx jest tests/utils/curated-pins.test.js tests/utils/curated-pins-notable.test.js tests/utils/alias-proposals.test.js tests/sidecar/aliases-command.test.js` — the validator, the gate and the engine must all be green; an entrant the gate rejects is not edited into compliance.

- [ ] **Step 5: Commit**

```bash
git add docs/usage.md CHANGELOG.md tests/utils/curated-pins-notable.test.js
git commit -m "feat(curated-pins): the notable list's curation rule and content gate (issue 238 D7, Phase 4 T6)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7 (controller-run): Live smoke on Windows — the notice, the stamp, the detached refresh surviving the parent

Not dispatched; the controller runs it on this machine after T1–T6 and records the transcript in the ledger and the PR body. It spends nothing (model-LIST endpoints; no legs).

- [ ] **Step 1: Stage a scratch config dir** `scratchpad/smoke-238-p4/`: copy the real `%APPDATA%`-independent `~/.config/amicus/model-catalog.json` into it with `fetchedAt` rewritten to `Date.now() − 8 days` (a script file, never `node -e`), a `config.json` with `{ "aliases": { "mine": "openrouter/z-ai/glm-5.2" } }`, and NO `.env` — point `AMICUS_ENV_DIR` at the real config dir so the refresh is keyed.
- [ ] **Step 2: Run in a real console** — a spawned test child has no TTY, so use PowerShell `Start-Process -FilePath node -ArgumentList 'bin/amicus.js','list','--cwd','<scratch>' -WindowStyle Hidden -RedirectStandardError '<scratch>/err.txt' -RedirectStandardOutput '<scratch>/out.txt' -Wait` with `AMICUS_CONFIG_DIR=<scratch>` and `AMICUS_ENV_DIR=<real config dir>` in the process env (`$env:…` before the call). A hidden new console is still a console: stdin is a TTY. If `err.txt` shows no notice, fall back to `-WindowStyle Normal` and read the window.
- [ ] **Step 3: Verify** — `err.txt` ends with `1 alias update available — amicus aliases --review`; `<scratch>/config.json` gained `aliasReview.lastNotified`; then poll `<scratch>/model-catalog.json` every 2 s for ≤ 90 s until `fetchedAt` is newer than the run — the detached child completed a KEYED refresh after its parent exited (`lastRefreshError` null; `models.length` > 0). No console window flashed (Christian confirms on his own terminal in the release ritual — the smoke's `-WindowStyle Hidden` cannot see one).
- [ ] **Step 4: Negative space** — a second run within the day: no notice, no re-stamp, no second refresh (`fetchedAt` fresh now); `list --json`: nothing on stderr; `AMICUS_NO_NETWORK_PROBES=1`: nothing; `aliases`: the footer reads `background catalog refresh: on (weekly) — catalog is N hours old` and no notice echoes behind it.
- [ ] **Step 5: Record** the exit-hook timing from T3 Step 5 and this transcript in the ledger; they go into the PR body's "Live" section.

---

## PR body (assembled at the end)

Title: `#238 Phase 4: the once-a-day alias notice, the weekly background catalog refresh, the aliases footer, the notable list`. Sections: What (D5/Q1/Q5/Q8/D7 in three sentences) · Design decisions (R-P4-1 … R-P4-10 verbatim) · Path matrix (from the File Structure section) · Tests (files + the mutant table) · Gates (`npm test` counts, sizes, citations, `generate-docs --check`) · Live (T7 transcript + the hook timing) · Docs (the five surfaces) · Not in this PR (Electron shows no refresh state — spec §4 names only the CLI footer; `lastNotified` not in `--json`; a per-alias mute — spec §9). Footer: `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Label `council-review` on creation (the push auto-runs the council; every later push with the label on spends ≈ $1.2 — remove it first for a push that must not).

---

## Self-review (run after writing)

**1. Spec coverage.** D5 line (exact text, singular) → T2 `runExitHook` + T3 e2e · cache only, any age → T1 `catalogInfoFromCache` + T2 `countProposals` (never `getCatalogInfo`) · once per 24 h, `lastNotified`, best-effort, fires again → T2 (Q5 test, stamp test, failing-stamp test) · detached keyed refresh at exit 0 past 7 days, the `models --refresh` refresh, the `workspace-window` spawn shape → T2 `refreshDue`/`spawnDetachedRefresh` + T7 live · the ONE predicate, every term, no new env var → T1 (one test per term) + T2 (one gate) + T3 (TTY/json/help e2e) · Q8 footer + `amicus aliases` prints the state → T4 · §6 row 7 in full → T1/T2/T3 · D7 editorial half (content + rule) → T6 · §3 file rules → Global Constraints + T1/T2 commits · docs → T5. Gaps: none found; Electron's review section does not show the refresh state (spec §4 names only the CLI footer — listed under "Not in this PR").

**2. Placeholder scan.** No TBD/TODO. T6's entrants are a conditional with both branches specified (empty list = the rule + gate ship; entrants = Step 4), not a placeholder.

**3. Type consistency.** `refreshState → { enabled, disabledBy }` is consumed by `exitHookAllowed` (T1), `collectAliasView`/`buildAliasesDoc` (T4) and `refreshStateLine(state, fetchedAt, now)` (T1/T4) with the same shape; `runExitHook({ code, command, args, stdinIsTTY })` is called with exactly those keys in T3; `catalogInfoFromCache(doc)` takes `readCache()`'s doc in T2 and T4; `countProposals(d, cfg)` — `cfg` optional, defaulting to `d.loadConfig()`; `spawn(file, args, opts)` recorded with `{ detached, stdio, windowsHide, env }` in the T2 test matches the T2 implementation's option object key-for-key.
