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

- [ ] **MODEL-NOTES fold-back still deferred** — now carried through 4.0.0, 4.0.1, 4.1.0, 4.1.1 and
  4.1.2. The machine-local copy is staler than the shipped one in places, so a bulk port would
  regress the repo; it needs a per-section diff, not a copy. [S]

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
