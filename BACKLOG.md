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
- [ ] **Resume nonce-echo hazard.** `buildResumeUserMessage` (`src/sidecar/resume.js`) replays the prior
  conversation verbatim, including the previous turn's valid nonced `[SIDECAR_FOLD:<nonce>]` marker — since
  each run mints a fresh nonce, the echoed old marker can't itself trigger a premature fold today, but the
  replay is still carrying a stale wire-format token into the new prompt. Strip trailing fold-marker lines
  from the replayed conversation before it's embedded. Narrow: inherent to prompt-verbatim resume, not a new
  regression.
- [ ] **`waitThenKill`'s `exited` array overstates under escalation.** Where `waitThenKill` is used
  (`src/cli-handlers.js`, `src/mcp-server.js`, `src/opencode-client.js`, `src/utils/abort-coordinator.js`),
  a pid that only died after being escalated to SIGKILL still lands in the `exited` array alongside pids
  that exited gracefully — the array doesn't distinguish "exited on its own" from "had to be force-killed".
  Harmless today since no caller branches on that distinction, but rename or re-derive the field if one
  ever does.
- [ ] **`src/cli-handlers-doctor.js` is at exactly 300/300 lines** (the file-size gate ceiling) — the next
  edit to this file trips `npm run check:sizes` and forces a split/extraction before the actual change can
  land. Flagging now so the split is planned rather than done under gate pressure.
- [ ] **Release-checklist item: manual POSIX teardown smoke test.** No orphaned `opencode serve` process
  after a normal exit, a Ctrl-C, or an external `kill` of the parent — B06's target platform (POSIX) has
  never had this executed by hand. Add it to the pre-v2.0.0 release ritual (no `RELEASE-CHECKLIST.md` exists
  yet in this repo — create one, or fold it into whatever pre-release doc/process is adopted first).

## Phase 16 review roll-up (2026-07-03)

- **`council show` cannot report catalog-delisted saved-council members** — the run path (`resolveCouncilMembers`, config.js) drops delisted raw ids via its catalog `known`-set check; `show`'s resolved/dropped loop (presets-cli.js) pushes any `/`-containing id straight to `resolved`. Mirror the membership check so `show` matches run-time resolution. [S — proven by the 16a.3 review with a live fixture]
- **`continue`/`resume` never compute per-run usage** (no `resolveUsage` call on those finalize paths — pre-existing, predates the spend ledger) — so their runs contribute zero spend-ledger rows. Add usage resolution + ledger appends to both. [S]
- **Benign double network fetch on the no-cache-failure refresh path** — `runRefresh` and the `refresh-catalog` IPC both call `refreshCatalog()` then `getCatalogInfo({maxAgeMs: Infinity})`, which re-enters `refreshCatalog` when NO cache doc exists (readCache returns null for a metadata-only failure doc). Idempotent, rare path; dedupe when convenient. [S]
- **Size-gate cliffs:** `src/utils/result-schema.js` at 294/300 and `src/cli-handlers-doctor.js` at 300/300 — the next edit to either forces an extraction first (buildSpendDoc already carries a fold-back note for result-schema). [note]
- **Free-picker missing-`name` fallback** (`r.name || r.id`) covered by inspection, not a test pin — one-liner test someday. [nit]
- **`mode: 'interactive'` spend rows untested directly** — the interactive finalize path shares its ledger-append call site with the tested headless path, but has no dedicated test exercising it through an interactive harness. [nit]
- **Surface `waveId` (and optionally the council name) in spend rows/rollup** so wave-level cost questions ("what did this council run cost in total?") are answerable directly from `amicus spend` instead of cross-referencing run docs. [S]
- **`council save` silently shadows a built-in on first save** — the overwrite-notice check only looks at user config, not the built-in bench names, so saving a user council named e.g. `budget` gives no "this now shadows a built-in" notice even though `council list`/`show` later report it as shadowed. Add the notice at save time. [nit]
- **`-o` with no following value writes a file literally named `true`** (`runVerdict`'s `args.out || './verdict.json'` — when `-o` is the last token, the parser sets `result.out = true`, which is truthy and gets used as the output path). Validate that `--out`/`-o` resolves to a string before using it. [nit]
