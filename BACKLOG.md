# Amicus Backlog

Tracked engineering items. Provenance: independent code review by **DeepSeek V4 Pro** (2026-06-30),
each item **verified by Claude against the v1.7.4 source** before landing here. Severity is Claude's
re-rating after verification (not DeepSeek's original label).

Status legend: `[ ]` todo · `[~]` partial · `[x]` done · `[-]` won't do / not actionable

> **Session update (2026-07-01):** planned + implemented via multi-agent workflows on a clean `main`
> working tree. **8 fixed** (BL-1, 3, 4, 5, 8, 9, 10, 11), **1 partially hardened** (BL-7), **1 deferred**
> (BL-2), **1 refuted** (BL-6). Full suite **2606 passed / 0 failed**, eslint + size gates green, adversarial
> review `clean`. Changes are **uncommitted** (one reviewable `git diff`, 22 files, +564/−36) — not pushed.

---

## Review findings (DeepSeek, verified)

- [x] **BL-1 · High · `amicus_start`/`amicus_continue` passed the prompt as a CLI arg → Windows 32 KB cap** — **DONE.**
  Both spawn paths now write the prompt to `<sessionDir>/briefing.md` (mode 0o600, created before spawn) and pass
  `--prompt-file` instead of inline `--prompt`, mirroring the fanout pattern. CLI `continue` gained `--prompt-file`
  support in `bin/amicus.js`. Shared-server in-process path untouched. Tested with a 40 KB prompt + a real-process
  integration test. Files: `src/mcp-server.js`, `bin/amicus.js`.

- [ ] **BL-2 · Low · Synchronous `fs`/`buildContext` in async MCP handlers** — **DEFERRED (intentional).**
  The trivially-convertible writes are inside `.then/.catch`/eviction callbacks tightly paired with sync
  `JSON.parse(readFileSync)` + error handling that tests assert on; `buildContext` is a sync export with many
  callers. Converting ripples with zero correctness gain. Left alone per "don't destabilize for a low-value win."

- [x] **BL-3 · Medium (narrow) · `auth.json` path hardcoded to the Unix XDG location** — **DONE (premise corrected).**
  Investigation found DeepSeek's "dead on Windows" claim is **false** — OpenCode writes `~/.local/share/opencode/auth.json`
  on Windows too. Real defect was narrower (ignores `XDG_DATA_HOME`, single guess). Shipped a safe, additive
  multi-candidate lookup: `$XDG_DATA_HOME` → `~/.local/share` → `%APPDATA%` (win32), first existing wins. File: `src/utils/auth-json.js`.

- [x] **BL-4 · Low · In-memory conversation mirror grows unbounded** — **DONE.**
  `toolCalls` capped at `MAX_TOOL_CALLS=2000` (drop-oldest) with a separate `seenToolCallIds` Set so dedup identity
  survives the cap (no re-append / no idle-detector flicker). File: `src/sidecar/conversation-mirror.js`.

- [x] **BL-5 · Low · `--prompt-file` validation depended on resolution order** — **DONE.**
  `validateStartArgs` is now self-contained (resolves the prompt itself when unresolved); `handleStart` deletes
  `args['prompt-file']` after resolving so nothing double-fires. Error codes preserved. Files: `src/cli.js`, `src/cli-handlers-run.js`.

- [-] **BL-6 · Not actionable · Council `assignTier` cascade "undocumented"** — **WON'T DO (refuted).**
  `src/council/tally.js:4-11` already has a JSDoc block; logic correct/exhaustive.

- [~] **BL-7 · Medium · Static `[SIDECAR_FOLD]` marker = premature-fold / injection surface** — **PARTIALLY HARDENED.**
  Shipped the **final-non-empty-line** hardening: a bare `[SIDECAR_FOLD]` echoed *mid-output* (reproduced instructions,
  a prior sidecar summary, scraped content) no longer force-folds; only a *trailing* marker completes. Safe fallbacks
  (SDK idle / activity / timeout) guarantee no hang. The stronger **per-run nonce was deferred** because it broke an
  out-of-lane `e2e.test.js` (mocks a bare marker) the agent couldn't edit. **Residual:** a model whose output genuinely
  *ends* with a bare marker would still fold — the nonce would close that. File: `src/headless.js`.

- [x] **BL-8 · Low · `parseArgs` swallows the next token for unknown `--no-*` flags** — **DONE.**
  Unknown `--no-*` tokens are now recorded as boolean `true` (never swallow the following positional); `--no-x=val`
  still records the inline value; allowlisted flags unchanged. File: `src/cli.js`.

- [x] **BL-9 · Low · `getSessionDir` had no path-traversal guard** — **DONE.**
  Inlined a `path.resolve` containment check (same message/style as `session-path.js::safeSessionDirUnder`); returns the
  identical `path.join` value for valid ids, throws on escape. File: `src/session-manager.js`.

- [x] **BL-10 · Low · `length/4` heuristic + unused `tiktoken` + inaccurate docs** — **DONE (docs/comments).**
  Corrected the `docs/configuration.md` tiktoken row (now says "currently unused — length/4 heuristic"); added caveat
  comments at both estimators (noting the deliberate floor-vs-ceil difference). **Follow-up:** remove the unused
  `tiktoken` dependency in a dedicated PR (needs lockfile regen — out of scope here). Files: `src/context.js`, `src/context-compression.js`, `docs/configuration.md`.

- [x] **BL-11 · Low · `getMessages` returned `result.data || []`, masking SDK error responses** — **DONE.**
  Now distinguishes a genuine `data: []` (no log) from a missing/error-shaped response (`logger.warn` with
  `{ sessionId, status, error }`, still returns `[]`). File: `src/opencode-client.js`.

---

_Result: 8 fixed · 1 partially hardened (BL-7) · 1 deferred (BL-2) · 1 refuted (BL-6). Uncommitted; suite green._

### Open follow-ups
- **BL-2**: async-ify `buildContext` + MCP metadata writes (needs broader refactor).
- **BL-7 full nonce**: land it once `tests/e2e.test.js` can be adjusted to emit the nonced marker (or lower its poll interval).
- **BL-10 dep removal**: drop `tiktoken` from `package.json` + regenerate the lockfile.

---

## Second review (GLM 5.2, verified 2026-07-01)

Independent review by **GLM 5.2** (of the v1.7.5 source), each finding **adversarially verified by Claude
against source** (13 parallel lanes). GLM's original IDs kept for traceability. Of ~42 raised: 25 confirmed,
14 partial, 3 refuted (C3/H4/M10 — misreads, not tracked). Severity is Claude's post-verification rating.

> **Status (2026-07-01):** fixed via an 11-lane workflow. **20 of 22 fully fixed · 2 partial (H9, L2).**
> Full suite **2662 passed / 0 failed**, eslint + size gates green, adversarial review `clean`. 36 files
> +732/−141 plus 5 new helpers (`project-root-allowlist.js`, `utils/atomic-write.js`, `utils/format-duration.js`,
> `electron/preload-content.js`, `electron/ipc-guard.js`). **Uncommitted.**

### Recommended (10) — confirmed real, worth fixing

- [x] **H10 · High · `project`/`cwd` MCP input is unsandboxed** — **DONE.** New `src/project-root-allowlist.js`;
  `resolveProjectDir` now **throws before any mkdir/spawn** on an out-of-bounds explicit project. Allows paths under
  `$HOME`, `cwd`, `AMICUS_PROJECT_DIR`/`AMICUS_PROJECT_ROOTS`, or the MCP client root; rejects `C:/Windows`, `/etc`.
  Legit `--cwd` under home still passes (verified). Files: `src/mcp-server.js` (+ new helper).
- [x] **H7 · High · `_onServerCrash` dead code** — **DONE.** Emitter-aware `_wireCrashListener` in `ensureServer`
  attaches `exit`/`close` → `_onServerCrash` → restart machinery, idempotent + stale-handle-guarded. *Note: today's
  server handle exposes no `.process`/exit event, so this activates once the handle emits lifecycle events; the live
  SDK exit signal wasn't verifiable in unit tests.* Files: `src/utils/shared-server.js`.
- [x] **H3 · Medium · Non-atomic metadata writes** — **DONE.** New `src/utils/atomic-write.js` (`writeFileAtomic`,
  tmp+rename, mode preserved); the three live metadata writes routed through it. Files: `src/session-manager.js`, `src/utils/session-abort.js`.
- [~] **H9 · Medium · No prompt-injection fence on fold-back** — **PARTIAL.** `amicus_read`'s summary (the genuine
  untrusted-prose path) is now wrapped in an `<untrusted_sidecar_output>` read-only fence. `amicus_council_tally`/
  `amicus_verdict` **deferred**: they return JSON records callers `JSON.parse`, so a prose fence would break the data
  contract + tests. Follow-up: fence a free-text field only, or a separate presentation wrapper. Files: `src/mcp-server.js`.
- [x] **H8 · Medium · `server-setup.js` hardcodes `lsof`** — **DONE.** `getPortPid` delegates to `port-pid.js`
  `findListenerPid` (netstat on win32). Files: `src/utils/server-setup.js`.
- [x] **M9 · Medium · Electron content view shares the privileged preload** — **DONE.** New minimal
  `electron/preload-content.js` for the BrowserView + `electron/ipc-guard.js` sender validation + navigation guard;
  toolbar keeps its bridge. *Not runtime-verified (GUI); unit suite green.* Files: `electron/main.js` (+ 2 new).
- [x] **M8 · Medium · `loadMcpConfig` uses `process.cwd()`** — **DONE.** `projectDir` threaded through
  `buildMcpConfig`→`loadMcpConfig`; project `opencode.json` resolves against the target. Files: `src/opencode-client.js`, `src/sidecar/start.js`.
- [x] **M1 · Medium · `assignTier(1,0)→Singleton`** — **DONE.** `(a=1,d=0)` now `Confirmed/thin` (broadened `Confirmed`
  rather than a new tier, to keep `ledger.js`/consumers stable). Files: `src/council/tally.js`.
- [x] **C1 · Medium · Fanout pre-`try` throw skips `wave.json`** — **DONE.** Pre-try setup moved inside the try → an
  error run doc, so the wave still writes. Files: `src/sidecar/fanout-leg.js`.
- [x] **H5 · Medium · `setup-window.js` no `proc.on('error')`** — **DONE.** Added the error handler (resolves instead
  of hanging) + best-effort parent-side kill of the Electron child. Files: `src/sidecar/setup-window.js`, `src/sidecar/interactive.js`.

### Low / cosmetic (12) — confirmed, tracked for cleanup

- [~] **L2** — **PARTIAL.** `extractContent` now summarizes non-text blocks (`[tool_use: name]`) instead of dropping
  them; the dead top-level `tool_use` branch removal was **deferred** (an out-of-lane `tests/context.test.js:312`
  asserts the old format). Files: `src/jsonl-parser.js`.
- [x] **L3** — DONE. Dead `decodeProjectPath` + its test deleted. `src/session.js`.
- [x] **L4** — DONE. Quote-aware `tokenizeCommand` in `parseMcpSpec`. `src/opencode-client.js`.
- [x] **L5** — DONE. `parseModelString` validates `{providerID, modelID}` and throws a clear error. `src/opencode-client.js`.
- [x] **L6** — DONE. Dead `runLeg`/`writeWaveMetadata` re-exports dropped. `src/sidecar/fanout.js`.
- [x] **L7** — DONE. Consolidated into `src/utils/format-duration.js`; all three call sites use it.
- [x] **L8** — DONE. Hardened in `tally.js` (skip self-vote only when `raiser` truthy) — the correct layer.
- [x] **L9** — DONE. Unknown verdict guarded (no `basis['undefined']=NaN`). `src/council/tally.js`.
- [x] **L10** — DONE. `uncaughtException` now `app.quit()`s on non-EPIPE errors. `electron/main.js`.
- [x] **L11** — DONE. `stop()` races the final `pollOnce()` against a timeout. `src/sidecar/interactive-mirror.js`.
- [x] **L12** — DONE. Continuation session dir now locked (acquire/release). `src/sidecar/continue.js`.
- [x] **L13** — DONE. `buildSessionRoute` canonicalizes separators before base64url. `electron/session-route.js`.

_Excluded: L1 (token estimators) — already covered by BL-10. C3/H4/M10 — refuted misreads._

### Second-review follow-ups
- **H9 tally/verdict fencing** — needs a JSON-safe mechanism (fence a free-text field or a presentation wrapper) + coordinated council/test update.
- **L2 dead-branch removal** — needs a lane that also owns `tests/context.test.js:312`.

---

## Distribution & docs

From a verified distribution-channels research pass (2026-07-01). **Every recommended channel WRAPS `npm i -g amicus` —
none need a built artifact** (unlike winget, abandoned). Ranked by leverage:

- [x] **README + Pages: feature the Claude Code plugin install as a headline method, equal to `npm i -g amicus`.**
  amicus already ships `.claude-plugin/marketplace.json` (marketplace `bourbondog-amicus`); the plugin path also sidesteps
  the mutating postinstall (`plugin.json` sets `AMICUS_SKIP_POSTINSTALL=1`). Add an equally-prominent block:
  `/plugin marketplace add BourbonDog/amicus` → `/plugin install amicus@bourbondog-amicus` → `/reload-plugins`.
  (Verified against code.claude.com docs. Caveats: first MCP launch cold-downloads the ~165 MB opencode binary; the GUI stays npm-only.)
- [x] **Universal install script** — `install.sh` + `install.ps1` (check Node ≥18 → `npm i -g amicus` → `amicus setup`).
  Trivial, all 3 OSes, no gatekeeper, preserves the `~/.claude` integration. Highest-leverage non-npm move.
- [ ] **Submit to Anthropic's COMMUNITY plugin marketplace** via the web form at clau.de/plugin-directory-submission
  (NOT a PR — PRs auto-close; the *official* marketplace is invite-only). Needs the repo public + passing safety screening.
- [ ] **Official MCP Registry** (registry.modelcontextprotocol.io) — add `"mcpName": "io.github.BourbonDog/amicus"` to
  package.json + a `server.json` (`mcp-publisher init`) pointing at the npm package's `mcp` subcommand + GitHub-OAuth publish.
  Metadata-only, wraps npm, cascades to third-party directories. ⚠️ Registry is in PREVIEW (schema churn) — re-verify first.
- [ ] **(Optional, Windows) Chocolatey** — `chocolateyInstall.ps1` runs `npm i -g amicus` with `<dependency id="nodejs-lts">`;
  no embedded binary ⇒ no VERIFICATION.txt. Medium effort (moderation latency). Preferred over Scoop (whose contained buckets reject the npm-wrapper form).
- [ ] **(Optional) Third-party MCP directories** — Glama (auto-indexes; just claim), PulseMCP + mcp.so (Submit form),
  Smithery (`smithery mcp publish`), + a PR to `punkpeye/awesome-mcp-servers`. Pure discovery; most ingest the official registry.

**Skip:** winget (needs a built artifact), Homebrew-core (notability gate ≥30 forks/watchers or ≥75 stars + postinstall-mutation
friction; a personal tap is possible but low-payoff), Scoop official buckets, and AUR/Nix/Snap/Flatpak/Docker/mise
(sandboxed/relocatable assumptions fight amicus's host-config mutation + native binary).

---

## Future goals (from the 2026-07-01 review-execution plan)

- [ ] **Council Review GitHub Action v2 — adjudicated verdicts in CI.** Phase 10 of the review-execution plan ships
  v1 as *fanout-only*: a `council-review`-labeled PR gets N independent model reviews (`amicus fanout --json`,
  headless) synthesized into one sticky comment. v1 deliberately does NOT claim a "council verdict" because a
  code-only pipeline cannot produce one — `amicus council tally` requires `adjudications[]`/`rankings[]`, which
  only exist after the skill-orchestrated Stage-2 anonymous cross-review (models judging each other's reviews)
  and chair synthesis (`src/cli-handlers-council.js`, `src/council/verdict.js`). **v2 = the real adjudicated
  council verdict on a PR**, which needs one of two enablers: (a) a **headless Stage-2 orchestration mode** in the
  engine (the orchestration moves from the skill into code: distribute anonymized reviews to judge legs, collect
  adjudications/rankings, run tally + chair synthesis without a driving Claude), or (b) **claude-code-action
  driving the actual second-opinion skill** on the runner (Claude orchestrates Stage 0–6 in CI; costs more, ships
  sooner). Prerequisites: Phase 10 v1 in production (proves the plumbing + cost profile), and the OpenRouter CI
  key's dashboard spend cap (the only hard cost ceiling on fresh runners — `--max-cost` is advisory with no cached
  catalog). Full v1 design lives in `docs/superpowers/plans/2026-07-01-review-execution-10-phases.md` (Phase 10);
  this item is also tracked as backlog entry 24 in that plan's "Backlog for review" section.

---

## Phase 11 whole-phase review triage (2026-07-02)

- [ ] **Test-hygiene bundle** — land as one commit next time these test files are open. Null-guard the
  `.match(...)[1]` frontmatter parses in `tests/skill-second-opinion-docs.test.js` and its reference twin
  `tests/skill-sidecar-docs.test.js` (a non-matching frontmatter regex currently throws on `[1]` of `null`
  instead of failing with a readable assertion). Tighten the `/multi-model/i` pin to the quoted "multi-model
  review" trigger string so it can't false-match unrelated prose. Step-scope the file-wide `::notice::`/
  `::error::` `toContain` pins in `tests/scripts/publish-workflow.test.js` (currently whole-file, should be
  scoped to the step they claim to pin). Tighten `tests/scripts/package-manifest.test.js`'s
  `yml.indexOf('npm publish')` ordering pin, which now matches a B04 comment rather than the actual command
  — coverage is currently held by the new suite's ordering test (`tests/scripts/publish-workflow.test.js`),
  so this is cleanup, not a live gap.
- [ ] **`docs/DISTRIBUTION.md` internal API-path inconsistency** — the new §3 correctly cites
  `/v0/servers/.../versions/<v>`, but the untouched namespace-check paragraph still cites
  `/v0.1/servers?search=`. Sync both to the same registry API version in the Phase 13 docs lane.
- [ ] **Post-v1.9.0 hardening: registry pre-check trusts a bare HTTP 200.** The pre-check that skips
  re-publishing to the MCP Registry (`.github/workflows/publish.yml`, "Publish to MCP Registry" step) keys
  entirely on `STATUS = "200"`. Assert the response body actually carries the expected version (not just a
  200 status code) to close a fail-unsafe drift if the registry's not-found contract ever changes shape
  (e.g. a 200 with an empty/error body during the registry's PREVIEW-API schema churn).

## Phase 12 whole-phase review triage (2026-07-02)

- [ ] **Wire a client tag into shared-server metadata.json for `amicus_status`/`amicus_read` parity.**
  B02 threads the detected `--client` (`code-local`/`code-web`/`cowork`) through every spawn path and the
  in-process shared-server path, but the shared-server `metadata.json` writes (`src/mcp-server.js`) don't
  currently persist that client tag alongside the other session fields, so `amicus_status`/`amicus_read`
  can't surface it the way they do for spawned sessions. Pairs with the B11 `enrichWithProgress` extraction
  window (`src/mcp-server.js`, next refactor pass after the file quiets down) — do both in the same pass.
- [ ] **`electron/main.js` has 3 pre-existing eslint errors outside lint-staged's `src/**` scope.**
  `package.json`'s `lint-staged` config only globs `src/**/*.js`, so `electron/*.js` never gets auto-fixed or
  gated on commit. `npx eslint electron/main.js` currently reports 2 `no-console` (lines 42, 54) and 1
  `no-empty` (line 133) — pre-existing, not introduced by Phase 12. Fix when widening lint scope to cover
  `electron/**` or on the next electron/main.js touch, whichever comes first.

## v1.9.0 release-cut triage (2026-07-03)

- [ ] **`docs/architecture.md:25` flow arrow overstates the fold handoff as a push.** "Summary output to
  stdout → Claude Code receives in context" reads as an automatic push, in tension with the documented
  pull-based fold handoff (the orchestrator reads the summary back via `amicus read`/`amicus_read`, fenced —
  see README/usage.md's Fold-handoff paragraphs added in Phase 13). Touch up at the next `architecture.md`
  revision.

## Phase 15 whole-phase review triage (2026-07-03)

- [ ] **Per-session `metadata.json` `writeFileAtomic` tmp orphans in session dirs.** B09 introduced roughly
  30 potential orphan sites (every `writeFileAtomic(path.join(sessionDir, 'metadata.json'), ...)` call
  across `src/mcp-server.js`, `src/session-manager.js`, `src/utils/session-abort.js`, and the fanout/wave
  paths) — a kill between the tmp-write and rename leaves a stray `.metadata.json.<pid>.<hex>.tmp` file
  behind, same failure mode B15's `src/utils/session-index-tmp-sweep.js` already sweeps for
  `sessions-index.json.*.tmp`. Extend that same age-gated list/sweep pattern to per-session dirs and wire
  it into `amicus doctor --fix`.
- [x] **Resume nonce-echo hazard.** `buildResumeUserMessage` (`src/sidecar/resume.js`) replays the prior
  conversation verbatim, including the previous turn's valid nonced `[SIDECAR_FOLD:<nonce>]` marker — since
  each run mints a fresh nonce, the echoed old marker can't itself trigger a premature fold today, but the
  replay is still carrying a stale wire-format token into the new prompt. Strip trailing fold-marker lines
  from the replayed conversation before it's embedded. Narrow: inherent to prompt-verbatim resume, not a new
  regression. **DONE (v4.0 Plan A, Task 2):** `buildResumeUserMessage` now runs the replayed conversation
  through `stripFoldMarkers` (`src/utils/fold-marker.js`) — bare and nonced marker lines are removed before
  embedding. BL-7 is done-done (see also the legacy bare-marker path retirement in `src/headless.js`).
- [ ] **`waitThenKill`'s `exited` array overstates under escalation.** Where `waitThenKill` is used
  (`src/cli-handlers-abort.js`, `src/mcp-server.js`, `src/opencode-client.js`, `src/utils/abort-coordinator.js`),
  a pid that only died after being escalated to SIGKILL still lands in the `exited` array alongside pids
  that exited gracefully — the array doesn't distinguish "exited on its own" from "had to be force-killed".
  Harmless today since no caller branches on that distinction, but rename or re-derive the field if one
  ever does.
- [x] **`src/cli-handlers-doctor.js` was at exactly 300/300 lines** (the file-size gate ceiling) — the next
  edit to this file would have tripped `npm run check:sizes` and forced a split/extraction before the actual
  change could land. **DONE (Phase 20, 20.1 extraction of `doctor-mcp-checks.js`):** the file is now
  260/300 — headroom restored, no longer at the cliff.
  ⚠️ **REGRESSED. Re-measured 2026-08-01 at `af3e8f1`: back to 295/300.** The headroom the 20.1
  extraction bought has been spent. Treat this as a live cliff again — see the re-measured table
  under "v4.6 hard gates".
- [ ] **Release-checklist item: manual POSIX teardown smoke test.** No orphaned `opencode serve` process
  after a normal exit, a Ctrl-C, or an external `kill` of the parent — B06's target platform (POSIX) has
  never had this executed by hand. Add it to the pre-v2.0.0 release ritual (no `RELEASE-CHECKLIST.md` exists
  yet in this repo — create one, or fold it into whatever pre-release doc/process is adopted first).

## Phase 17 whole-phase review triage (2026-07-03)

- [ ] **`docs/usage.md` lacks detail sections for `spend`/`doctor`/`key`** — the README's compact
  command table currently has more detail on these three than the "canonical CLI reference" does,
  which inverts the intended README-summary / usage.md-detail split the Phase 17 restructure was
  going for. [S]
- [ ] **Consider a repo-wide `*.md text eol=lf` `.gitattributes` rule** (or a normalize-read helper
  used everywhere) — two separate CRLF-checkout seams (`council-reference-docs.test.js`,
  `docs-quick-sync.test.js`) have now bitten docs test suites in this phase alone. [S — weigh
  renormalization churn against the recurring cost of one-off `.replace(/\r\n/g,'\n')` fixes]

## Phase 16 review roll-up (2026-07-03)

- **`council show` cannot report catalog-delisted saved-council members** — the run path (`resolveCouncilMembers`, config.js) drops delisted raw ids via its catalog `known`-set check; `show`'s resolved/dropped loop (presets-cli.js) pushes any `/`-containing id straight to `resolved`. Mirror the membership check so `show` matches run-time resolution. [S — proven by the 16a.3 review with a live fixture]
- **`continue`/`resume` never compute per-run usage** (no `resolveUsage` call on those finalize paths — pre-existing, predates the spend ledger) — so their runs contribute zero spend-ledger rows. Add usage resolution + ledger appends to both. [S]
- **Benign double network fetch on the no-cache-failure refresh path** — `runRefresh` and the `refresh-catalog` IPC both call `refreshCatalog()` then `getCatalogInfo({maxAgeMs: Infinity})`, which re-enters `refreshCatalog` when NO cache doc exists (readCache returns null for a metadata-only failure doc). Idempotent, rare path; dedupe when convenient. [S]
- **Size-gate cliffs:** `src/utils/result-schema.js` is now at exactly 300/300 (Phase 20 pushed it from 294 to the ceiling via the `abort-result.js`/`result-schema-version.js` split-out re-exports) — the cliff is HERE now, not just approaching; the next touch to this file forces a split first (buildSpendDoc already carries a fold-back note for result-schema). `src/cli-handlers-doctor.js` is resolved — see the Phase 17 entry above (now 260/300 after the 20.1 extraction). [note]
  ⚠️ **BOTH FIGURES ARE STALE. Re-measured 2026-08-01 at `af3e8f1`:** `result-schema.js` is **243/300**
  and no longer a cliff; `cli-handlers-doctor.js` has regressed to **295/300** and is one again. Use
  the re-measured table under "v4.6 hard gates" as the source of truth.
- **Free-picker missing-`name` fallback** (`r.name || r.id`) covered by inspection, not a test pin — one-liner test someday. [nit]
- **`mode: 'interactive'` spend rows untested directly** — the interactive finalize path shares its ledger-append call site with the tested headless path, but has no dedicated test exercising it through an interactive harness. [nit]
- **Surface `waveId` (and optionally the council name) in spend rows/rollup** so wave-level cost questions ("what did this council run cost in total?") are answerable directly from `amicus spend` instead of cross-referencing run docs. [S]
- **`council save` silently shadows a built-in on first save** — the overwrite-notice check only looks at user config, not the built-in bench names, so saving a user council named e.g. `budget` gives no "this now shadows a built-in" notice even though `council list`/`show` later report it as shadowed. Add the notice at save time. [nit]
- **`-o` with no following value writes a file literally named `true`** (`runVerdict`'s `args.out || './verdict.json'` — when `-o` is the last token, the parser sets `result.out = true`, which is truthy and gets used as the output path). Validate that `--out`/`-o` resolves to a string before using it. [nit]

## Phase 19 smoke note (2026-07-03)

- **`<untrusted_sidecar_output>` fence tag still carries the "sidecar" name** (`src/utils/untrusted-fence.js` `fenceSidecarOutput()`) — user-visible in every `amicus read` output. Deliberately NOT renamed at v2.0.0 (wire-token-continuity argument, same as `[SIDECAR_FOLD]`: the skills' hardening instructions reference the literal tag). If renamed later, skills + tests + docs move in lockstep. [S]

## Phase 20 whole-phase review triage (2026-07-04)

- **Model-resolution failures (`resolveModelFromArgs`/`validateFallbackModel`, `src/utils/start-helpers.js`) `console.error`+`exit(1)` and bypass the `--json` envelope** across the whole surface incl. `start` — route through `failJson(BAD_MODEL)` in a future pass. (Pre-existing class, deliberately not fixed in Phase 20.) [S]

## v4.1.2 divergent-vendor sweep (2026-07-22)

Provenance: a multi-agent shape-consumer sweep run immediately after 4.1.1 shipped, every finding
re-verified by hand against the source before landing here.

**The class.** `toCanonicalDefault()` strips an `openrouter/` prefix for any direct-capable vendor
and performs **no divergence check of its own**, so every caller must guard. For
`DIVERGENT_VENDORS` (currently just `anthropic`) the direct and gateway ids are different
strings, not differently prefixed: OpenRouter serves `anthropic/claude-opus-4.8`, the direct API
`anthropic/claude-opus-4-8`. Four of six call sites guarded; two did not.

- [x] **M-5 · Medium · `config.js` derived the OpenRouter mirror by string-prepending** — **DONE (4.1.2).**
  Deferred out of 4.1.1 toward 4.2 and recorded nowhere but a session transcript — which is exactly
  why it is written down here now. `buildProviderModels()` built its mirror as
  `\`openrouter/${alias}\``; once 4.1.1 made `toDefaultAliases()` return the DIRECT form, that
  registered `openrouter/anthropic/claude-opus-4-8`, an id OpenRouter does not serve, and dropped
  the real one. Now read from `toGatewayRoutes()`, guarded so a user override never inherits a
  curated route. `opus`/`haiku` only. Fix: `59c8eb3`.

- [x] **BL-412-1 · Medium · a fresh `amicus setup` seeded an alias its own `doctor` calls stale** — **DONE (4.1.2).**
  `quick-picks.js:83` (`toLiveSeedAliases`) and `setup.js:389` (readline wizard) both ran
  `toCanonicalDefault()` on a divergent vendor's OpenRouter route, storing
  `anthropic/claude-opus-4.8` under the direct `anthropic` vendor. `alias-audit.js:82` suppresses
  only `curated-route` sources, so the row is unsuppressable and `amicus doctor` reports
  `1 stale: opus` — the very warning 4.1.1 shipped to remove. Reproduced against a **direct-only**
  catalog as well, so it was never OpenRouter-specific: an Anthropic-only user was hit. Both sites
  now route through one guarded helper, `toStorableRoute()`. `opus` only — `haiku`/`claude`/
  `sonnet`/`fable` are CARDLESS and never overlaid.
  **Not a 4.1.1 code regression:** `git diff v4.1.0 HEAD` is empty for both files. They agreed with
  the shipped default before 4.1.1 and contradicted it after — survivors of an incomplete fix.

- [ ] **Remove the footgun instead of policing it: fold the divergence check into `toCanonicalDefault()`** — [S]
  Six call sites, two of which drifted, and the failure is silent — a plausible-looking id that
  only surfaces as a `doctor` warning or a missing fallback route. Either take the vendor as a
  parameter and guard internally, or rename it to something that states the precondition
  (`stripGatewayPrefixWhenIdentical`). A lint rule or an "every call site is guarded" unit test is
  the cheap interim.

- [x] **MODEL-NOTES fold-back still deferred** — now carried through 4.0.0, 4.0.1, 4.1.0, 4.1.1 and
  4.1.2. The machine-local copy is staler than the shipped one in places, so a bulk port would
  regress the repo; it needs a per-section diff, not a copy. [S]
  **DONE (Christian's ruling, 2026-08-03, branch docs/model-notes-foldback):** per-section fold
  executed both directions (shipped corrected — the haiku wrong-cause and pre-degrade-era claims —
  and enriched with three model sections + the peer-consensus≠evidence rule; local de-staled).
  Standing practice replaces the debt: shipped = curated seed, local = lab notebook, releases
  cherry-pick per-section (docs/publishing.md line).

## v4.4.1 fast-follow (2026-07-26 → 2026-07-27)

**Provenance.** The five paid gate councils run against the shipped v4.4.0 Council Workspace
(`wsgate01`–`wsgate04`, `costgate01`) produced a 61-item verified inventory,
`.superpowers/sdd/v44/v4.4.1-backlog.md`. That inventory was re-verified against the release commit
and dispositioned in **`.superpowers/sdd/v441/backlog-and-proposal.md`**, which is the authoritative
scope record for this release — task decomposition, rulings, and the reason each item was taken or
left. Neither file is duplicated here: a duplicate that drifts is worse than a pointer.

> ⚠️ **Before filing anything new against this release, read the v44 backlog's Appendix A
> ("settled, do not re-litigate") and Appendix B ("known false positives").** Both exist because
> these specific findings get re-raised on reputation, and re-arguing one costs more than the
> finding is worth. Appendix C lists items already fixed — do not carry those forward either.

### The three owner rulings (Christian, 2026-07-26)

Three product calls were taken on the spot, and each **pulled an item into the patch that the
"no behaviour changes in a patch" bar would otherwise have excluded**. Recorded here because a
ruling that lives only in a session transcript gets re-argued.

| # | Item | Ruling | What it changed |
|---|---|---|---|
| **D5a** | **CA-6** — a fully-unpriced council could never trip `--max-cost`, so a ceiling silently bounded nothing | **Degrade the exit code.** When a ceiling is set *and* the total is inexact, the run exits `2` — mirroring what `budgetRefusals[]` already does for a shrunken bench. Docs tightened to "`--max-cost` bounds **known** spend." | **It never blocks a run.** The standing ruling — unknown cost must not halt a run, a ceiling must not stop us solving real problems — holds unchanged. |
| **D5b** | **LC-2** — the tool-settle grace ceiling completed the leg but left its OpenCode session billing for output nobody would read | **Abort the session at the ceiling.** Leg completion and partial output are unchanged; only the child session is stopped, and whether the abort landed is recorded as `toolSettleAborted`. | Sequenced **after** v4.4.0's child-session walk, or subtree cost attribution would have been lost. |
| **D5c** | **LC-10** — `EMPTY_FINDINGS` was a hard error, which structurally pressured a model to invent a finding, directly contradicting the shipped anti-sycophancy clause | **Accept a well-formed empty set.** `findings: []` is VALID when the block parsed cleanly and `overall` is a non-empty string — that distinguishes "I read it and found nothing" from "my output broke," which `NO_FENCED_BLOCK`/`NOT_PARSEABLE` already separate. | The larger half of the work was making the tally, street-cred and chair **degrade gracefully on an all-clean bench** rather than render headings over nothing. This one changes what a council *means* when every seat comes back clean. |

Two smaller rulings on the same release: **D1** — delete RN-8's unwired `legsTotal`/`legsComplete`
promise rather than implement it (a documented feature that does not exist is worse than neither).
**D3** — ENV-5 stops at **config + errors only** (see the deferral below). Both are written up in
`backlog-and-proposal.md` §4b.

### Closed by v4.4.0 itself — do not carry these forward

Five of the inventory's own top-of-theme entries were closed by commits that landed between the
inventory's compile point and the v4.4.0 tag: **CA-1** (child-session spend unattributed — the
`$0.492506` item) and **LC-7** by `b848e6f`; **SEC-1** (unfenced pointer-derived `runDir`, including
a *write* primitive) and **SEC-2** by `1b9ea9e`; **LC-6** (a repair wave carrying no review to
repair) by `f2f554b`.

### Closed by v4.4.1

Recorded by theme; per-item detail is in the inventory and per-task detail in
`.superpowers/sdd/task-*-report.md`.

- **Cost truthfulness** — CA-2 (`subtreeUnknown` now reaches the spend ledger, so `amicus spend`
  stops contradicting `council run`), CA-3 (the unknown-spend notice is no longer sticky), CA-6,
  CA-7 (a cache-only leg reports `unknown`, not a falsely free `$0`), CA-8 (the free-local `$0`
  path verified end to end against a live LM Studio leg).
- **The repair path, whole** — LC-12★ (all four remaining repair-prompt builders now carry the
  artifact they are repairing; one took no arguments at all) and LC-11 (a repaired review no longer
  keeps the original prose while taking the repair's findings).
- **Correctness** — LC-2, LC-3 (a failed leg no longer renders in the GUI with a green check),
  LC-4, LC-8, LC-9, LC-10.
- **Renderer** — RN-3 (+DOC-6), RN-4, RN-7, RN-8, RN-9, RN-10 (a permission failure is no longer
  reported as "not written yet", which had been producing a silent chairless fold reporting
  `{ok: true}`), RN-12.
- **Environment / release** — ENV-2 and ENV-3 (both diagnosed as **environmental, not code** — the
  `haiku` 404 is a `/v1`-less `ANTHROPIC_BASE_URL`, so the inventory's "fix or remove the alias"
  framing would have broken a working alias), ENV-4 (line endings settled repo-wide), ENV-5,
  ENV-6, REL-1.
- **Security / tests** — SEC-3, SEC-4 (the uncertified `md-lite.js` finally reviewed by a real
  council, which also surfaced two live council-engine parser bugs), TST-4 (the read-only-workspace
  invariant test), TST-5, TST-6, TST-8, TST-9, TST-10.
- **Docs** — DOC-1 through DOC-5 and DOC-7, plus `docs/ROADMAP.md` (which still said v4.4 was
  "NEXT") and this section.
- **Not on the inventory, found during execution** — NEW-1 (a council run started one OpenCode
  server per wave and concurrent waves raced each other's SQLite open, making `--critic` a coin
  flip) and NEW-2 (a wave that died before its legs wrote no `wave.json`).

### Deferred out of v4.4.1 into v4.5

The `M`+ items and the ones needing data or a design decision — **CA-4, CA-5, LC-1, LC-5, RN-1,
RN-2, RN-5, RN-11, REL-2, TST-1/2/3/7** — are tabulated with their reasons in `docs/ROADMAP.md`
under "Deferred out of v4.4.1 into v4.5". **ENV-1** is not among them: it is a decision record
("eleven `Number(env) || default` sites"), not a task, and a blanket migration would introduce six
new defects to fix one. The two items below are deferrals *created* by this release rather than
carried by it, so they are written out in full.

### Refuted findings — do NOT re-file (v4.4.1)

- [-] **RN-6 · "the Abort button never re-hides"** — **WONTFIX, refuted with evidence.**
  **OWNER RULING 2026-07-27: closed as refuted, not deferred.** Both halves of the premise are
  false, verified against source: `renderDetail` already runs `abort-btn.hidden = isTerminal` on
  every run-open (pinned by an existing test), and `startLiveLoop` returns early for a terminal
  run — so the stalled branch's `hidden = false` is a **no-op on every path that can reach it**.
  Implementing the prescribed fix would **hide Abort on the tick a momentary stall recovers**,
  leaving a live, healthy council with no way to abort it until the next run-open.
  Shipped instead: behaviour unchanged, the reasoning documented in place, and a regression test
  asserting the real invariant — *a live run must stay abortable* — which fails the moment anyone
  implements RN-6 as written. Detail: `.superpowers/sdd/task-8-report.md` §2.
  ⚠️ **Provenance, and why this recurs:** raised independently by `wsgate01` C7 and `wsgate02` A7,
  both of which were briefed on `workspace-verbs.js` **without** `workspace-app.js` — the same
  incomplete-briefing failure recorded as **Appendix B-1** in
  `.superpowers/sdd/v44/v4.4.1-backlog.md`. A bench cannot certify what it has not seen, and it
  cannot refute what it has not seen either. **When re-briefing a council on the workspace verbs,
  include `workspace-app.js`.**

### Closed at the v4.4.1 release cut (2026-07-27)

- [x] **ENV-7 · Unexplained test-count drift** — **CLOSED. Did not recur; the one deviation seen
  this release was fully explained.**
  ENV-7 was filed during the v4.4 cycle after Task 19 measured a **+1** test count that no commit
  in the range accounted for. It was carried into v4.4.1 as a standing warning, not a task: the
  failure mode it exists to catch is *someone bisecting a phantom*, so the standing instruction was
  to bisect a genuinely unexplained drift and to close the item if none appeared.
  - The only deviation observed during v4.4.1 was the **+2** at Task 0, and it was **not** drift:
    it came from comparing against the v4.4.0 release-prep figure (5,317 / 5,324, measured at
    `eaf441b`), while this branch's merge-base `ce8216a` had since added a two-case `test.each`.
    Against the correct merge-base baseline the delta was **0**. A stale baseline, not a ghost.
  - At the release cut the full suite measured **446 suites / 5,711 passed / 5,718 total**, which
    matches the last measured state of the branch exactly. **Every test added on this branch is
    attributable to the commit that added it.** No unexplained delta at any point in the release.
  - ⚠️ **The durable lesson is the one worth keeping, and it is not about a flaky test.** Both
    incidents — the original +1 and this release's +2 — are consistent with *a baseline compared
    against the wrong commit*, which is the cheaper explanation and the one that fits the evidence.
    **Always re-measure the baseline at the branch's own merge-base before calling a delta drift.**
    A figure carried forward from a previous release's report is stale by construction the moment
    anything lands after it.

### v4.4.1 lint-gate deferrals (ENV-5, 2026-07-27)

v4.4.1 put `electron/` under the lint gate (`npm run lint` is now `eslint src/ electron/`, and
`lint-staged` globs `electron/**/*.js`). Owner ruling for that task was **config + errors only** —
265 errors were resolved, and the one style class below was deliberately left alone rather than
turned into a large untested rewrite inside a patch release. It is written down here so the
deferral is a decision with a number attached rather than a silent config line.

- [ ] **Integration-suite handle leaks beyond ENV-6 — a NAMED leak, not vague flakiness** — [S–M]
  **Filed 2026-07-27 by owner ruling**, after v4.4.1's Task 12.5 fixed ENV-6 and found the live
  rail still warns from *different* suites. Start from this evidence rather than re-deriving it:
  - `tests/mcp-protocol.integration.test.js:68` — `request()` arms a 10 s response timer and never
    `clearTimeout`s it on the resolve path (`:47`). **11 leaked `Timeout`s in one run.** The
    identical helper is at `mcp-headless-e2e:73`. `electron-toolbar-e2e` also warns.
  - ⚠️ **Fixing that obvious timer in all three suites produced NO measurable improvement**, and the
    change was deliberately reverted rather than shipped unverifiable. So the response timer is real
    but is **not the whole story** — expect a second holder.
  - ⚠️ **`--detectOpenHandles` CANNOT diagnose this class**, verified against jest v29.7.0:
    `jest-cli/build/run.js:219` gates the "did not exit" warning behind
    `!globalConfig.detectOpenHandles`, so the flag *suppresses the very message it is meant to
    explain*; and `collectHandles`'s `stackIsFromUser()` only recognises synchronous circus frames,
    so a timer armed after an `await` is invisible to it. **This is almost certainly why ENV-6 sat
    in triage for a full release as unexplained "flakiness."** Use a timer-stack probe instead.
  - **Impact is bounded, contrary to how ENV-6 was framed**: jest's warning timer is `.unref()`d and
    jest issues no force-exit on that path, so a leaked timer costs only its own duration. The live
    rail finished in 166 s, exit 0. A 45-minute hang needs a handle that *never* clears.
  - **Verifiable for $0** — `mcp-protocol` is keyless.

- [ ] **`no-var` is OFF for `electron/workspace-ui/**` — 159 declarations to modernise** — [M]
  **OWNER RULING (Christian, 2026-07-27): do the rewrite, as its OWN task immediately AFTER
  Task 14 (the v4.4.1 release cut) — not deferred to v4.5, and not folded into the patch.**
  So 4.4.1 ships with the exemption in place; the rewrite is a separate reviewed change on a
  green tree, where a 159-site diff can be judged on its own merits instead of competing with
  a release.
  The renderer is served raw to a sandboxed page under a strict CSP with **no build step and no
  transpiler**, and is written in ES5 IIFE style throughout. Per file:
  `workspace-matrix.js` 35 · `workspace-panels.js` 30 · `md-lite.js` 26 · `workspace-render.js` 26 ·
  `workspace-verbs.js` 20 · `workspace-app.js` 15 · `live-model.js` 7.
  Electron 43 ships Chromium, so `let`/`const` are safe at runtime — this is style, not
  compatibility. But it is a 159-site diff across a GUI with no lint history and thin renderer
  test coverage, so it wants its own task with a real smoke pass, not a `--fix` run.
  ⚠️ **Do not "fix" this by setting the rule to `warn`.** `lint-staged` runs `eslint --fix`, which
  auto-fixes warnings as well as errors, so `warn` would perform the whole rewrite silently at
  commit time, spread across whatever unrelated files someone happened to stage. Either do the
  conversion deliberately in one reviewed commit, or leave the rule off.

  Not backlog, recorded so the next reader does not re-litigate them: `no-console` is **off** for
  `electron/workspace-ui/**` (5 sites in `workspace-verbs.js` — the renderer cannot reach
  `src/utils/logger.js`; console goes to DevTools) and for `electron/main.js` + `electron/ipc-guard.js`
  (3 sites — last-resort crash reporting inside the stdout-error and `uncaughtException` handlers,
  i.e. exactly where routing through a logger that writes to the failed stream is unsafe). Both are
  permanent, justified exemptions, not deferrals.

### Filed at the v4.4.1 final whole-branch review (2026-07-27)

Three items the v4.4.1 session ledgers recorded but this file did not. A deferral that exists only
in session scratch is not deferred, it is lost — so they are written out here in full, with the
evidence needed to act on them without re-deriving it. None blocks the v4.4.1 tag.

- [ ] **FR-1 · `runHeadless`'s three early `return`s carry A3's stale-progress defect** — [S]
  **OVERDUE: a reviewer asked for this ticket two tasks ago (task-8 report §5 "Known remaining hole,
  NOT in A3's scope", repeated as open item 9.4) and it was never filed.**
  A3 fixed `runHeadless`'s outer `catch` so a failed run stamps a terminal stage into
  `progress.json` instead of leaving the last non-terminal one. Three `return`s bypass that fix, in
  `src/headless.js`:
  - `:290-298` — the server-start failure. It returns from the server-start `catch`, which sits
    **before** the outer `try` at `:307` entirely, so A3's handler was never in scope for it.
    Leaves `'initializing'` (`:247`) on disk.
  - `:315-323` — the `!serverReady` bail. Returns from **inside** the outer `try`, so the outer
    `catch` never sees it. Leaves `'server_ready'` (`:313`) on disk.
  - `:351-360` — the `createSession` failure. Same shape. Leaves `'server_ready'` (`:326`) on disk.
  - ⚠️ **`:351-360` is the reachable one on a council run.** Under T0.5's shared server
    (`externalServer` truthy) the `if (!externalServer)` guards at `:275` and `:308` skip the other
    two paths outright, so the createSession return is the only one a council leg can hit — and when
    it does, the Workspace reads a non-terminal `'server_ready'` and shows that seat **perpetually
    live** while `metadata.json` says `'error'`. That is the same progress/metadata disagreement A3
    and LC-3 were filed to end.
  - **Do it the way A3 did**: derive the stage from `resolveTerminalState({ error })` (the single
    source of truth LC-3 established), and **read the prior `usage` back and re-attach it** —
    `writeProgress` *rebuilds* `progress.json` rather than merging, so a bare terminal write silently
    deletes whatever spend the last flush recorded, trading a stale stage for a cost under-report on
    exactly the legs that failed. Wrap it in its own `try`/swallow so it can never mask the original
    error. Model the tests on `tests/observe/premature-completion.test.js`.
  - Compounds with **FR-3**: a `createSession` lock race is one way to *reach* `:351-360`.

- [ ] **FR-2 · `repairCanHonorContract` is now INERT — a deletion hazard, not a live guard** — [S]
  **Self-inversion was the design; the consequence still needs recording.** The predicate asks the
  validator rather than hard-coding an answer precisely so that LC-10 would switch it off on its own
  the day it landed. LC-10 has landed, so `validateFindings(EMPTY_SET_REPAIR_PROBE).ok` is now
  `true` and the function **returns `true` for every input** (verified: `null`, `0`, `1`, `7`,
  `undefined`, `-1` all → `true`). Therefore `run-stages.js:189`'s `repairable &&` can no longer
  short-circuit anything, and the paid-leg protection it represents has **no live path**.
  - ⚠️ **`tests/council/run-stages.test.js:315` — "an original declaring ZERO findings never pays
    for a repair" — now passes for a DIFFERENT REASON THAN ITS NAME.** The original it feeds in
    simply *validates* post-LC-10, so `!res.ok` is false and the loop is never entered; `repairable`
    is never consulted. The test's own comment predicted this ("Task-3-proof on purpose … which is
    why it is not asserted here"), which is why it is not a bug — but it does mean **nothing in the
    suite currently fails if `repairCanHonorContract` is deleted**.
  - **The hazard is deletion, not the inertness.** A future reader running a coverage or dead-code
    pass will find a predicate that is constant-`true` with no failing test behind it and remove it —
    silently re-arming the deadlock F2 was filed for, the moment anyone tightens the validator on
    empty sets again.
  - **Decide, don't drift.** Either (a) keep it and add a test that pins the *linkage* by
    constructing a validator state where an empty set is rejected, so the predicate is exercised in
    both positions; or (b) remove it deliberately, with the F2 reasoning moved into a comment at
    `run-stages.js:189` so the next person to tighten `validateFindings` reads it.

- [ ] **FR-3 · T0.5 moved the lock contention and `retryOnLockRace` did not follow** — [S–M]
  ⚠️ **HYPOTHESIS, NOT AN OBSERVED FAILURE. Say so in any commit that touches it.** The T0.5
  acceptance run `v441plan04` launched **5 legs clean** (2026-07-26), and nothing since has
  reproduced this. It is filed because the *reasoning* that justified the retry now points at an
  unprotected call, not because a run has died.
  - `retryOnLockRace` (`src/utils/server-setup.js:136`) wraps **server start only**: two call sites,
    `src/headless.js:285` and `src/sidecar/session-utils.js:263`.
  - `createSession` has none — `src/headless.js:350` → `src/opencode-client.js:143`.
  - T0.5 made a council run share **one** OpenCode server, which removed the concurrent-*start*
    race that cost `v441plan01` four of five seats in 736 ms to `database is locked`. But Stage 1
    still launches the seat wave and the critic solo under a single `Promise.all`
    (`src/council/run-stages.js:81`), so **N near-simultaneous `session.create` calls now land on
    one OpenCode SQLite** — the same lock class, one layer down, unretried.
  - **Before writing any retry, get evidence**: instrument `createSession` and launch a wide council
    (≥6 seats + critic) against a cold server; a lock-class rejection there confirms it, and its
    absence over several runs is worth recording as a negative result. Keep any fix to the same
    bounded policy the existing retry uses (5 attempts, lock-class messages only, final failure
    rethrown unchanged).
  - Compounds with **FR-1**: today a `createSession` failure returns via `src/headless.js:351-360`,
    which is exactly the path that leaves a seat showing as perpetually live in the Workspace. Fixing
    FR-1 makes any occurrence of FR-3 *visible* instead of silent, which is the cheaper order to do
    them in.
  - **v4.5.2 note:** the retry classifier this entry wants to reuse is now `isRetryableStartFailure`
    (lock-class OR timeout-class) in `src/utils/server-setup.js`. FR-3 is unchanged in substance —
    it is about `createSession`, not server start — but any retry written for it should reuse that
    predicate rather than adding a third classifier.

## v4.5.2 deferred — field-report items NOT taken (2026-07-31)

**Provenance.** v4.5.2 fixed three defects from a v4.5.1 field report (server-start timeout untunable
and unretried; `extract-zip` phantom dependency killing the Electron self-heal in every published
install; a lost critic invisible outside `run.json`). The reporter proposed several further changes
that are **design decisions, not defects**. The report itself notes that fixing the timeout "largely
makes this interaction disappear," so none of these are urgent — but each is a real call to make.

- [ ] **SL-1 · Stagger the Stage-1 launches when the shared server is unavailable** — [S]
  `src/council/run-stages.js:81` fires the bench wave and the critic solo under one `Promise.all`,
  ~20ms apart. Under the per-wave fallback both race the same OpenCode SQLite start. A few hundred
  ms of jitter costs nothing against a multi-minute run. ⚠️ Only reachable when shared-server
  acquisition already failed — with v4.5.2's retry that is now rare, so **measure before building**.
- [x] **SL-2 · Retry a dead wave once after the survivors release their servers** — [M]
  Today a wave that dies at start is recorded permanently dead. The critic is fail-soft, so a
  serialized second attempt is nearly free. Interacts with the budget reservation path — a retried
  wave must not double-reserve.
  **PULLED FORWARD (Christian, 2026-08-03 — the SL-3 ruling below): implement now, ahead of the
  composition rev.** Design inputs recorded at ruling time: this is the natural first live use of
  the v4.6 `kind:'heal'` vocabulary on the council path (D7 anticipated a council heal emitter);
  and the sink never un-flips `degraded.value`, so the retry must run BEFORE the `dead-wave`
  degrade is noted — heal on recovery, degrade only if the retry also dies.
  **DONE (2026-08-03, branch `feat/sl2-stage1-retry`):** shipped per the spec
  (`docs/superpowers/specs/2026-08-03-sl2-stage1-retry-design.md`) — waves AND legs (D1),
  unconditional (D2), `run-retry.js` module (D3). SL-3's re-decision now waits on
  post-retry field data. `run-stages.js` measured 292/300 at Task-6 close-out and **298/300
  after the final-review fix — 2 lines headroom, the next edit to this seam extracts first**;
  `run-retry.js` sits at 280/300 on day one. Both join the tight-file watch list.
- [ ] **SL-3 · Decide whether an explicit `--critic` may degrade silently at all** — [S, decision]
  A user who typed `--critic` asked for adversarial review; returning a verdict without it inverts
  the feature. v4.5.2 made the loss *visible* (`seatLoss` on verdict.json) but kept the standing
  never-fail-closed ruling. The open question is whether an explicitly-requested critic deserves an
  exception, or a flag. **Christian's call — do not implement unilaterally.**
  **RULED heal-first (Christian, 2026-08-03): SL-2 is pulled forward and implemented first; SL-3
  stays OPEN and is re-decided with post-retry frequency data.** Context frozen for that
  re-decision: v4.6 already killed the "silently" half — a dead critic announces on every surface
  (stderr one-voice, `run.json`/`verdict.json` `degrades[]`, derived `seatLoss`, the report's
  "What was lost") and exits degraded (2) by construction (`dead-leg`/`dead-wave` → the sink).
  What remains is fail-soft (status quo) vs fail-closed vs an opt-in strictness flag. Baseline at
  ruling time: 11 four-seat runs on v4.5.4, 10 clean; the one loss was a free model that never
  produced a first token.
- [ ] **SL-4 · `run-<runId>.json` instead of overwriting `run.json`** — [M]
  Two runs sharing an `--out` directory silently destroy the first one's run record, including its
  `sharedServerUnavailable` degrade entry — only the per-wave manifests survive. Given how much of
  `src/council/run-server.js`'s design rationale rests on making a degrade *durable on the run
  record*, this is a real hole. ⚠️ Changes an on-disk layout the MCP tools and `amicus watch` read;
  needs a compatibility pass (or a symlink/copy to `run.json`), which is why v4.5.2 left it alone.

## SL-2 live-smoke findings (2026-08-03, runs 0084d48c + 2039b2d1)

- [ ] **Doctor check (+ consider normalizing): `ANTHROPIC_BASE_URL` without `/v1` kills every
  direct-Anthropic leg with a bare "Not Found"** — [S]
  Field-diagnosed on run 0084d48c's fallback chair (`opus`, wave `ch3`). The convention split:
  Anthropic SDKs (including Claude Code itself) treat the var as HOST and append `/v1`
  themselves; OpenCode's provider layer treats it as the full prefix. A host-form value —
  correct for Claude Code — 404s every direct anthropic leg. Control pair proven: the identical
  `fanout --models opus` call fails "Not Found" on the host form and completes with `/v1`
  appended. Add a doctor check (VERIFIABLE — string-inspect or probe; the unverified voice is
  not needed here) with the exact hint, and decide whether the provider-config boundary should
  instead normalize (append `/v1` when absent) — decide, don't drift. ⚠️ For the doctor text: the
  var can live ONLY in a parent process env (here, the Claude Code app process — absent from
  every persisted scope, shell profile, and settings file) — the check should print the value it
  SEES, because "where it is set" may be unfindable on disk.
- **LC-5 evidence (ROADMAP deferral table) — observed live.** Run 0084d48c walked the entire
  chair fallback chain (`ch1`/`ch2` minimax — OpenRouter key spend limit; `ch3` opus — the `/v1`
  issue above) and `run.json` recorded only the chairless outcome; the per-attempt causes were
  recoverable ONLY by hand-digging each `ch*` wave doc. Exactly the gap LC-5 names; scheduling
  evidence.
- **SL-2 verified in production** (both runs): the forced dead critic retried once (`-c1r1`
  present in `stages.stage1.waveIds`), ONE enriched dead-leg record naming both attempts, exit 2,
  `seatLoss.criticSeated: false` derived with the real reason, `firstFailure` + `retryWaveId` on
  the record — spec §5/§8 shapes byte-live. Run 2039b2d1 (post credit fix) was otherwise CLEAN:
  both judges parsed, the chair synthesized (`overallVerdict` non-null), degrades = the one
  dead-leg only. Ledger note: a 404 leg produces no usage → no spend row → `retryOfWaveId` rows
  appear only when a retry actually bills (mechanism unit-pinned).
- [ ] **Workspace Seats panel: a seat with zero usable legs never gets a row** — [S]
  The spec-§10 GUI close-out (run 2039b2d1, retried dead critic, full-res capture): `renderSeats`
  shows only the five completed legs (bench ×2, judges ×2, chair — all statuses/costs correct);
  the dead critic — first attempt AND its `-c1r1` retry — has **no row at all**. The good news:
  no ghost, no duplicate, no perpetually-live row (the RN-11/FR-1 failure modes are absent —
  **SL-2 introduces no GUI regression; the §10 check is CLOSED**). The gap: the loss is invisible
  on the seats surface (header chips, street-cred dash, verdict prose and report.html all carry
  it). Pre-existing class — session-less dead legs never got rows — not SL-2-caused. Candidate
  fix: render announced dead seats as rows ("did not review — retried once") derived from
  `degrades[]`/`seatLoss`, honoring the announcement invariant on this surface too.
- [ ] **Alias audit is blind to listed-but-not-serving stored aliases** — [S–M]
  v4.6.1 release-gate find (2026-08-03): the stored `gemini` alias pointed at
  `google/gemini-3.1-flash-lite-preview` — still LISTED in the catalog (so `doctor`'s alias
  audit passed it) but no longer SERVING (requests accepted, zero tokens, sessions run to
  timeout). Three live e2e suites failed on it; root-caused by a single-leg control pair
  (lite-preview hangs; `gemini-3.6-flash` completes) and fixed machine-side via
  `setup --add-alias`. Candidate checks: (a) warn when a STORED alias drifts from the current
  family resolution (the fallback-drift warning exists; the stored-alias variant does not);
  (b) an opt-in `models --check --live` probe tier — one tiny leg per stored alias, because
  presence in the catalog is not proof of service. Related: the backlogged "headless no-output
  fast-fail backstop" would have turned these 130s timeouts into ~120s named failures.

## v4.5.0 post-ship dispositions (2026-07-28)

**Provenance.** v4.5.0 ("Save and share your councils") shipped 2026-07-28 — branch
`feat/v4.5-save-and-share`, worktree `C:\Users\sendt\code\amicus-v45`, merged to `main` at `3a33c54`.
Full task-by-task history, the final whole-branch review, and both post-HOLD waves live in that
worktree's `.superpowers/sdd/progress.md` (local-only, not published). Every entry below is
self-contained — read the ledger only for the reasoning behind a line, not to find out what's open.

### v4.6 SHIPPED 2026-08-02 — the degrade announcement invariant (execution record)

**Shipped:** tag `v4.6.0`, `main` `5f07f0e` (Plan 4 merged via PR #90). Plans 1–4 all executed;
every milestone issue was closed at ship (#80–#85, #87). The per-plan entries below are the
execution record, kept as written during the milestone.

**Theme:** the north star — *installing and running amicus should be simple and error-free;
when an error occurs it either self-heals or self-diagnoses, transparently, keeping the user
informed.* A **correct-but-silent degrade fails that bar as hard as a crash**, which is what
this work fixes.

- **Spec:** `docs/superpowers/specs/2026-08-01-degrade-announcement-invariant-design.md`
- **Plan 1 of 4:** `docs/superpowers/plans/2026-08-01-v4.6-degrade-invariant-plan-1-contract-and-sink.md`
  — **EXECUTED 2026-08-01** (subagent-driven-development, 9 tasks + final whole-branch review):
  14 code commits `0005e79..7cd2a8b` on this branch. Suite **477 suites / 6185 tests / 0 failures**
  (measured merge-base baseline 472/6150 — delta is the branch's own additions), lint + sizes green.
  Final review verdict after its 3-fix hardening wave: **Ready to merge.** #85 closed with a
  regression pin. Ledger: `.superpowers/sdd/progress.md` (local-only).
  - ⚠️ **Scoping note for the owner:** the plan's headline says "all ten channels wired"; **nine**
    in-council channels shipped. `dropped-members` is in the vocabulary (`DEGRADE_CHANNELS`) but its
    announce site is the CLI/MCP entry layer (outside Plan 1's files) and it never flips
    `degraded.value` — its sink migration needs an owner call on which later plan owns it.
    **RESOLVED by Plan 4:** dropped members now announce per-member through the sink and the run
    exits degraded (2) on every transport — the tenth channel is wired.
  - ⚠️ **Behavior change for the v4.6 CHANGELOG:** a shared-server acquisition failure now exits
    **degraded (2)** (was: stderr + run.json only, exit 0). Spec-intended; run-single-server suite
    aligned.
- **Plan 2 of 4:** `docs/superpowers/plans/2026-08-01-v4.6-degrade-invariant-plan-2-verdict-surface.md`
  — **EXECUTED 2026-08-02** on the stacked branch `feat/v4.6-plan-2-verdict-surface` (13 commits
  atop `e360c3d`, HEAD `4a46b9d`). Suite **479 suites / 6,210 tests / 0 failures** (delta vs the
  measured Plan-1 baseline hand-accounted). Final review verdict after its fix wave: **Ready to
  merge.** Closes **#84** (`seatLoss` derived from `degrades[]` — a dead critic LEG finally flips
  `criticSeated`) and **#83** (Stage-2 judge `runStats` rows, judge-tagged in the report's cost
  table). `verdict.json` gains additive `degrades[]`; the report gains "What was lost" (one voice,
  heals filtered); in-run effect texts hedged ("will exit degraded (2)", 7 sites). The v4.5.2
  seatLoss suites passed **byte-unedited** (the D3 derivation proof).
  - ⚠️ **CHANGELOG note for v4.6:** report/tally cost totals now include judge legs and read
    HIGHER than v4.5.x for identical runs; `runStats` consumers keying by model must exclude
    `role: 'judge'` (ledger.js does).
  - **#87 filed** (final-review find): the Stage-5 verdict rebuild drops `seatLoss`/`degrades[]`
    from a decided verdict — pre-existing v4.5.2 class widened; slotted to **Plan 4**.
- **Plan 3 of 4:** `docs/superpowers/plans/2026-08-02-v4.6-degrade-invariant-plan-3-truthful-doctor.md`
  — **EXECUTED 2026-08-02** on the stacked branch `feat/v4.6-plan-3-truthful-doctor` (8 commits
  atop Plan 2, HEAD `be54d48`). Suite **480 suites / 6,241 tests / 0 failures**. Final review:
  **Ready to merge** (recommended hint-voice pin applied). What shipped: the doctor collector
  (`doctor-check-failed`/`doctor-fix` channels; error rows + structural `fixed`/`fixDetail` flags
  at all five `--fix` sites → shared-vocabulary records, zero prose parsing); `doctor --json` gains
  additive `degrades[]`; `--fix` prints `Recovered:` lines in the one voice; exit codes and ✗/⚠
  rows byte-unchanged; `engineMissing`/`reinstallEngineAv` now state causes as **unverified**
  (commands byte-identical); `cli-handlers-doctor.js` extracted 295→263. The plan's measured-reality
  block records that the v4.5.x engine-copy checks already satisfied criterion 4's first half.
  - **Owner interpretation recorded in the plan header** (veto by editing it): human output renders
    heals only; degrade records are the `--json` surface; warns map to no record.
  - **Owner ruling queued:** does the unverified voice extend to `sweepSessionIndexTmp` (cause
    near-definitional) and `rebuildElectron` (no live call site)? Final review says post-merge.
    **RESOLVED (Christian, 2026-08-03):** the voice applies only where the cause is genuinely a
    guess. `sweepSessionIndexTmp` keeps its confident voice — the cause is definitional (an
    atomic-write tmp orphan has no other producer; the 60s age gate excludes live writers) —
    ruling recorded in its docblock and pinned in `tests/remediation-hints.test.js`.
    `rebuildElectron` was decided on existence, not voice: **deleted** as superseded by
    `doctorFix` (no live call site), absence-pinned in the same suite; a reintroduction must
    adopt the unverified-cause voice.
- **Plan 4 of 4:** `docs/superpowers/plans/2026-08-02-v4.6-degrade-invariant-plan-4-cli-parity.md`
  — **EXECUTED 2026-08-02** on `feat/v4.6-plan-4-cli-parity`, merged to `main` via PR #90 and
  tagged `v4.6.0`. Closed **#80/#81** (Workspace discoverability: `watch` usage names `--ui`; a
  CLI council run with Electron present prints how to open the live Workspace), **#82**
  (`watch --ui` against an `--out-dir` run now names the launch-directory pointer and the working
  invocation), and **#87** (the Stage-5 verdict rebuild preserves `seatLoss`/`degrades[]`, CLI and
  MCP both). Took the **dropped-members ruling**: announce per-member through the sink; a dropped
  preset member now exits degraded (2) on every transport (recorded as a v4.6 CHANGELOG behavior
  change). Landed the ledger polish batch — the three-way `degrades` schema-copy lockstep test
  (run/verdict/doctor), the doctor `data` description, the channel-domain grouping comment
  (`1dcf11a`) — and the closing docs pass (`66a5533`).
  - ⚠️ **Size cliff created:** `src/cli-handlers-council-run.js` landed at **299/300 exactly** —
    the next edit to it extracts first (`cli-council-run-render.js`, 51 lines, is the receiver).
    See the tight-file table below.

**Issues closed by the milestone (all closed at the 2026-08-02 ship):** #85 (plan 1) · #84, #83
(plan 2) · #80, #81, #82, #87 (plan 4).

**Measured baseline, so nobody re-derives it:** 11 four-seat council runs on v4.5.4 `af3e8f1`,
**10 clean**. The single loss was a free model that never returned a first token. **The engine is
not losing legs** — the defect is that when a seat *is* lost, nothing tells the user which one.

---

### Next-rev hard gates — resolve before/at kickoff *(carried past v4.6.0; the tight-file table was re-measured at the v4.6 ship and is current)*

- [ ] **Tight-file extraction pass.** ⚠️ **RE-MEASURED 2026-08-01 against `main` @ `af3e8f1`
  (v4.5.4). The previous five-file list was written at the v4.5.0 tip and is STALE — it named five
  files and missed nine, including one AT the ceiling.** Re-measure before trusting any list here;
  the numbers move every release.

  Scope reminder, because it is what makes the list readable: the gate
  (`scripts/check-file-sizes.js`) is 300 lines over `src/**/*.js` + `electron/**/*.js`, minus a
  **12-file grandfathered `exclude` list** (`config.js`, `cli.js`, `headless.js`, `mcp-server.js`,
  `mcp-tools.js`, `opencode-client.js`, `session-manager.js`, `prompt-builder.js`,
  `sidecar/setup.js`, `electron/setup-ui.js`, `electron/main.js`, `electron/setup-ui-styles.js`).
  Those are already far over and are NOT cliffs — `mcp-server.js` is 1490 lines. Only **gated**
  files can trip the gate.

  **Gated files at ≥293/300** (★ = was on the old list; re-measured 2026-08-02 at the v4.6
  Plan-4 tip — the four v4.6-touched rows moved, three DOWN via extractions, one UP to the edge):

  | Lines | File | |
  |---|---|---|
  | **300** | `src/sidecar/electron-install.js` | AT CEILING, was missing |
  | **300** | `src/cli-handlers-run.js` | ★ |
  | **299** | `src/cli-handlers-council-run.js` | ★ **v4.6 Plan 4 landed it here EXACTLY — zero headroom; next edit extracts first (`cli-council-run-render.js`, 51 lines, is the receiver)** |
  | 299 | `src/council/run-debate.js` | was missing |
  | 298 | `src/sidecar/start.js` | was missing |
  | 298 | `src/sidecar/fanout.js` | was missing |
  | 297 | `src/sidecar/continue.js` | was missing |
  | 297 | `src/sidecar/context-builder.js` | was missing |
  | 297 | `src/pack/pack-resolve.js` | ★ |
  | 296 | `src/sidecar/session-utils.js` | was missing |
  | 295 | `electron/workspace-ui/workspace-panels.js` | ★ |
  | 293 | `electron/workspace-ui/workspace-verbs.js` | was missing |

  De-cliffed by v4.6 extractions (out of the ≥293 band): `src/council/run.js` 299→**271**
  (Plan 1), `src/mcp-council-run.js` 298→**281** (Plan 4), `src/cli-handlers-doctor.js`
  295→**274** (Plan 3).

  **Two corrections to entries elsewhere in this file:**
  - The Phase 17 entry claims `src/cli-handlers-doctor.js` was resolved to 260/300 by the Phase 20.1
    `doctor-mcp-checks.js` extraction. It has since crept back to **295/300** — the cliff is live
    again, and `doctor-mcp-checks.js` (84 lines) is still the natural receiving module.
  - The Phase 16 roll-up claims `src/utils/result-schema.js` is "now at exactly 300/300". It is
    **243/300** and is no longer a cliff.

  `src/pack/pack-forward.js` (96 lines) remains the natural receiving module for pack-domain
  spillover. **Any next-rev task, or any hotfix, touching a file in the table above must extract
  from it FIRST**, before adding anything.
- [ ] **KNOWN_VARIABLES single-source (T3-m2).** `src/template/render.js:45` hand-maintains two
  copies of the known-template-variable set — `KNOWN_VARIABLES` and a separate inline validation
  array. Consistent today; the composition rev's `{{input}}` chaining variable (F6, now slotted
  v4.7) adds a third
  variable to both, and an edit that updates one copy but not the other fails silently. Single-source
  them **before** `{{input}}` lands — hard gate, not a nice-to-have.

### Fix-sized carries

- [ ] **errorWave pack-inherit** (`src/sidecar/fanout.js`). The `errorWave` helper (defined `:88`,
  sole call site `:228`, the server-start-failure path) builds its error wave doc with
  `pack: options.pack` — unlike this file's other two `buildWaveResult` call sites (`:174`, `:285`),
  it doesn't fall back to `metaPack` (the pack pre-seeded onto an MCP-spawned child's
  `metadata.json` when `options.pack` itself is absent). One-line fix:
  `pack: options.pack || metaPack`, matching the other two sites. **TDZ caveat:** `metaPack` is
  declared (`const`, `:163`) after `errorWave` is defined (`:88`) but before its only current call
  (`:228`), so today's ordering is safe — but a future caller that invokes `errorWave` before `:163`
  executes (an early-validation "pre-creation" path) would hit the `const` temporal dead zone and
  throw `ReferenceError` on a naive reference to `metaPack` inside the closure. Guard for that if
  `errorWave` ever grows an earlier call site.
- [ ] **T19-m5 — stale-reply guard missing on `openRun`'s `workspace:get-run` reply.** The debate
  fetch in `workspace-app.js` already guards against a stale reply; `openRun`'s `get-run` reply
  doesn't — same F09/unreadable-run class this release closed twice elsewhere. Consequence:
  `loadPanel` can pair one run's file names with a different run's identity if two opens race.
  Pre-existing, out of scope for v4.5 — carried as-is.
- [ ] **T15-m5 — export the three MCP paramMaps.** `tests/mcp-pack-params.test.js`'s
  `TEST_COUNCIL_PARAM_MAP` is a hand-copied mirror of production and has already diverged once (it
  omits `template`). Export the real council/fanout/start paramMaps from their source modules and
  import them in the tests instead of re-typing them.
- [ ] **T15-m2 — MCP council path drops template provenance (now council-only).**
  `mcp-council-run.js`'s template path (`:117-123`) discards `promptMeta` — `run.json` records pack
  provenance but no template `{name,hash}`, unlike the CLI path's `run.template`. Wave 1's D1
  (forward maxCost+template on MCP fanout/start) closed this for fanout/start; the council MCP path
  is the only one left. Trivial when wanted: pre-seed it in `mcp-council-run.js`'s `initRun` — the
  handler already holds `t.promptMeta` at that point.
- [ ] **droppedMembers reason strings are a closed two-value set.** The additive
  `droppedMembers: [{ref, reason}]` on `run.json` (Post-HOLD wave 2) currently only ever produces two
  `reason` values. Fine as long as nothing branches on the string; revisit whether `reason` should
  become a coded enum instead of free text if a third reason is ever added.

### Minor findings riding forward (one line each; full reasoning is in the ledger)

*(Filed at the v4.5.0 ship, addressed to the then-planned composition "v4.6". The
degrade-invariant milestone that actually shipped as v4.6.0 was not a sweep of this list —
unchecked items ride to the next rev.)*

- [ ] **T2-m1** — `findings.test.js`'s "stays null and NEVER 0" test lost its load-bearing rationale
  comment in a sibling edit; restore a reworded version.
- [ ] **T3-m1** — `{{var.}}` empty-key template error message has a cosmetic hole
  (`--var =<value>`); fails safe.
- [ ] **T5-m1** — `preflight-json-envelope.test.js` engine mocks return `undefined`, swallowed by
  `captureStdout`; add `mockResolvedValue({exitCode:0})` in `beforeEach` before any success-path test
  lands.
- [ ] **T5-m2** — run-state absent-case test should pass `template: null` (real production shape),
  not omit the key.
- [ ] **T5-m3** — template block + `BAD_ARGS` string verbatim-triplicated across the three CLI
  handlers; a shared `applyTemplateForArgs` would collapse the drift risk.
- [ ] **T5-m4** — `{{project}}` isn't path-normalized (unlike `artifact_path`); `TEMPLATE_RENDER`
  errors carry `hint: null`.
- [ ] **T5-m5** — guard-matrix gaps: fanout×`--artifact`, fanout×`--var`, council×`--var`, positive
  council `{{prompt}}`-slot case, all untested.
- [ ] **T5-m6** — fanout help-text wraps at column 31 vs. neighbors' 32; cosmetic.
- [ ] **T11-a** — `PACK_NOT_FOUND` catches four distinct `readPack` failure modes; `PACK_INVALID` is
  reserved for structural failures only.
- [ ] **T11-b** — `packRecord` tests don't round-trip hash against `canonicalHash`/`readPack`;
  `source:'path'` (`--pack ./x.json`) branch unexercised.
- [ ] **T11-c** — string bench tested only on council kind; fanout by-name bench → `args.council`
  consumption unverified; typing both `--models`+`--council` produces a notice naming only
  `--models`.
- [ ] **T11-d** — a council pack with both `critic`+`lenses` and a by-name bench survives run-mode
  validation; the handler's mutual-exclusion error can name a flag the user never typed — narrow
  sibling of the closed XOR case.
- [ ] **T13-m1** — `pack-cli.js:33-34` iterates `pr.notices` on an unreachable-in-prod error branch;
  add else/early-return before a future test stub `TypeError`s there.
- [ ] **T13-m2** — kind-mismatch test assertion is non-discriminating (fixture name happens to
  contain `'fanout'`); assert the full phrase against a neutral fixture.
- [ ] **T13-m3** — `--retry-failed` + `--pack` silently ignores the pack (deliberate, file-wide
  precedent); add a code comment at `cli-handlers-run.js:146` recording it.
- [ ] **T13-m4** — the pack-cli helper's notice branch (fanout bench-override) is untested through
  the newer code path; Task 12 only covered council's copy.
- [ ] **T14-m1** — `pack list` warnings print to stdout, `pack save` warnings to stderr (both say
  "Warning:"); `pack list | grep` mixes diagnostics into data. `--json` unaffected.
- [ ] **T14-m2** — `cli-pack-cmd.test.js`'s `---- --json doc shapes ----` banner sits two lines above
  where a fix-wave insertion should have moved it.
- [ ] **T14-m3** — `renderPackList`'s `(unknown)` kind / `0.0.0` version fallbacks are unasserted
  (only `(unnamed)` covered); neither can throw.
- [ ] **T14-m5** — 7 usage-block flags
  (`--template/--timeout/--max-cost/--gateway/--agent/--thinking/--summary-length`) lack positive
  mapping tests; one table-driven test closes it.
- [ ] **T14-m6** — the `pack` usage block in `cli.js` (~:672) is 30 lines vs. siblings' 4-11;
  compress to match.
- [ ] **T14-m7** — duplicate lazy `fs`/`path`/`session-manager` requires in `cli-handlers-pack.js`
  (:77-79, :123-125); hoist to module top.
- [ ] **T16-m1** — workspace-auto-open helper throws if `env` is undefined on a Linux call, though
  the contract documents `env` as always an object; optional hardening.
- [ ] **T18-m1** — fake-DOM debate tests sequence the fire-and-forget `debate.json` fetch by
  counting microtask hops (2×`await Promise.resolve()`); sturdier fix is to expose/await the real
  fetch promise.
- [ ] **T19-m1** — a sub-round-trip double blind-toggle can leave a panel on stale masking
  (`loadPanel`'s completion guard fences on run id only); self-heals on next toggle. Fix: capture
  `A.state.blind` at issue time, bail on mismatch, beside `workspace-panels.js:111`.
- [ ] **T19-m2** — RN-5's fix wave added a second uncaught `loadPanel()` call site; a rejected invoke
  leaves `loading[id]` cached and the panel broken until the run changes (pre-existing at `:127`, now
  hit more often).
- [ ] **T19-m3** — the terminal-refresh test drives `openRun(sameId)` directly rather than the
  live-tick seam (`workspace-verbs.js:95`).
- [ ] **T19-m4** — a blind-flip test reads titles via `children[0]` instead of the house pattern
  `querySelectorAll('h3')` (boundary test `:444`).
- [ ] **T20-m2** — the seat-reorder pass is O(n²) (`find()` per seat); immaterial at real council
  seat counts.
- [ ] **T20-m3** — reorder runs before the departed-row removal pass; the combined reorder+removal
  render is untested (hand-traced correct).
- [ ] **T21-m1** — a new test's comment says the F09/unreadable-run tests sit "above" in the file;
  they sit below (right facts, wrong direction).
- [ ] **T21-m2** — the new abort e2e test uses a 600ms post-confirm wait vs. the file's 400ms
  convention elsewhere; unexplained magic number.
- [ ] **T22-m1** — the docs' worked `run.json` excerpt elides `version` from the pack record while
  the prose states a 4-key shape (dodges the docs-quick-sync version-regex).
- [ ] **T22-m2** — v4.6 is named "`--input-from`" in `render.js`'s docblock vs. "composable waves"
  in the docs; same feature, two names.
- [ ] **W1-M4** — the wave-1 pack pre-seed's briefing is raw, not rendered, until the child
  re-renders it; eventually consistent.
- [ ] **W1-M5** — the budget-ceiling hint text is CLI-flavored even when the run came in over MCP;
  pre-existing class.
- [ ] **W1-M6 / W1-M7** — forward-notice plumbing for orphaned pack knobs is dead code on the
  `start` spawn-fallback path today; wouldn't surface a notice if that path went live.
- [ ] **resolveBench/resolveBenchInput parallel evolution** (`cli-handlers-council-run.js` /
  `mcp-council-run.js`) — CLI and MCP each hand-roll their own XOR-validation wrapper around the
  shared `resolveCouncilMembers`. Wave 2 unified the *dropped-members* signal between them via that
  shared core, but the two outer wrappers still evolve independently — same drift shape as T15-m5's
  paramMap divergence. Nothing wrong today; watch if one's validation rules change without the other
  following.

### Closed at ship — do not re-file

- [x] **T20-m1** — the shared `insertBefore` bug in `tests/workspace/helpers/fake-workspace-page.js`
  (a same-parent move duplicated the node instead of moving it) is fixed; ported into the shared
  helper at `4991e7a`.
- [x] **T14-m8** — `pack rm <missing>` now returns `PACK_NOT_FOUND`, unified with `pack show`'s
  existing code (owner ruling — one-way door, taken pre-release).
- [x] **T15-m10** — orphan pack-knob notices now name the pack's own camelCase option keys (e.g.
  `maxCost`), not the CLI arg-key spelling (`max-cost`).
- [x] **F1** — council pack `options.agent`/`thinking`/`summaryLength` were inert on every surface;
  resolved by Decision 2 (Christian, post-HOLD wave 1) — council packs now reject those three keys at
  save time (`PACK_INVALID`) instead of silently dead-filling.
- [x] **F2** — an MCP-launched fanout's `wave.json` didn't inherit pack provenance (the child has no
  `--pack` by the single-resolution rule; only `metadata.json` was pre-seeded); `runFanout` now
  inherits from `metadata.json` when `options.pack` is absent, at its two `buildWaveResult` call
  sites. (The separate `errorWave` call site was deliberately left out of this fix — see the
  still-open errorWave carry above.)
- [x] **F3** — CHANGELOG's RN-1 line claimed a "not written yet" empty state that doesn't exist;
  clause fixed, with a surviving test comment recording why the idealized phrasing existed at all.
- [x] **F4** — a typed `--mode` lost to a pack-filled `agent` (flag>pack violation); fixed (`--mode`
  now counts as agent-explicitness). Its **"council agent" carry-note is RETIRED** — Decision 2
  (council packs can no longer carry `agent` at all) mooted the "becomes load-bearing if council
  agent is ever wired" concern.
- [x] **F5** — `wave.schema.json`'s `pack` field was typed `["object","null"]` against object-only
  siblings; tightened to `object`.
- [x] **council-show anomaly** — `council show` reported catalog-delisted saved-council members as
  healthy while the real run path silently dropped them (Task 23 smoke discovery). Fixed in
  Post-HOLD wave 2 (`19c3768`): `show` now reuses the same extracted `classifyCouncilMembers` the
  run path uses.
