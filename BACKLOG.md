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
- **BL-7 full nonce** — **DONE (v4.0.0)**: the per-run nonce shipped with the engine milestone; the
  Phase 15 resume-nonce entry below records BL-7 as done-done.
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
- **H9 tally/verdict fencing** — **DONE (v4.0.0)**: prompt-injection fencing on the JSON MCP tools
  shipped with the engine milestone (A5/C6/D5).
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
- [x] **Official MCP Registry** (registry.modelcontextprotocol.io) — **DONE (v1.9.0)**: `server.json`
  + the publish.yml registry step; "✓ Server io.github.BourbonDog/amicus" verified at every release
  since (ninth consecutive at v4.6.1).
- [ ] **(Optional, Windows) Chocolatey** — `chocolateyInstall.ps1` runs `npm i -g amicus` with `<dependency id="nodejs-lts">`;
  no embedded binary ⇒ no VERIFICATION.txt. Medium effort (moderation latency). Preferred over Scoop (whose contained buckets reject the npm-wrapper form).
- [ ] **(Optional) Third-party MCP directories** — Glama (auto-indexes; just claim), PulseMCP + mcp.so (Submit form),
  Smithery (`smithery mcp publish`), + a PR to `punkpeye/awesome-mcp-servers`. Pure discovery; most ingest the official registry.

**Skip:** winget (needs a built artifact), Homebrew-core (notability gate ≥30 forks/watchers or ≥75 stars + postinstall-mutation
friction; a personal tap is possible but low-payoff), Scoop official buckets, and AUR/Nix/Snap/Flatpak/Docker/mise
(sandboxed/relocatable assumptions fight amicus's host-config mutation + native binary).

---

## Future goals (from the 2026-07-01 review-execution plan)

- [x] **Council Review GitHub Action v2 — adjudicated verdicts in CI.** **DONE (v4.0.0)** — shipped
  with the headless engine milestone via enabler (a) (B2); `.github/workflows/council-review.yml`
  runs the real adjudicated verdict. Entry kept for the design history: Phase 10 of the review-execution plan ships
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

- [x] **Test-hygiene bundle — publish-workflow + package-manifest half.** **DONE (v4.6.3 #110):**
  the file-wide `::notice::`/`::error::` `toContain` pins in `tests/scripts/publish-workflow.test.js`
  are now step-scoped (not whole-file) and mutant-proofed, and `tests/scripts/package-manifest.test.js`'s
  `yml.indexOf('npm publish')` ordering pin was retargeted off the stale B04-comment match onto the
  actual command.
- [x] **Test-hygiene bundle — skill-docs remainder.** Still open (explicitly filed as unopened in
  #110's own riders). Null-guard the `.match(...)[1]` frontmatter parses in
  `tests/skill-second-opinion-docs.test.js` and its reference twin `tests/skill-sidecar-docs.test.js`
  (a non-matching frontmatter regex currently throws on `[1]` of `null` instead of failing with a
  readable assertion). Tighten the `/multi-model/i` pin to the quoted "multi-model review" trigger
  string so it can't false-match unrelated prose.
  — done v4.7 PR4; pin tightened, null-guard half already resolved by 7cf3f18 (mustMatch), filed
  sight-unseen. Also tracked in "v4.6.3 sweep riders" (:1207).
- [x] **`docs/DISTRIBUTION.md` internal API-path inconsistency** — **DONE**: no `/v0.1` reference
  remains in the file (synced in the Phase 13 docs lane; re-verified 2026-08-03).
- [x] **Post-v1.9.0 hardening: registry pre-check trusts a bare HTTP 200.** **DONE (v4.6.3 #110):**
  the skip now fires only on three ANDed conditions — HTTP 200, the body names the exact
  `$VERSION`, and the body reports status `active` — with every failure path (transport failure,
  empty body, schema churn, deleted status, missing `_meta`) routing toward publishing, proven by
  mutant testing and an independent live-body harness.

## Phase 12 whole-phase review triage (2026-07-02)

- [ ] **Wire a client tag into shared-server metadata.json for `amicus_status`/`amicus_read` parity.**
  B02 threads the detected `--client` (`code-local`/`code-web`/`cowork`) through every spawn path and the
  in-process shared-server path, but the shared-server `metadata.json` writes (`src/mcp-server.js`) don't
  currently persist that client tag alongside the other session fields, so `amicus_status`/`amicus_read`
  can't surface it the way they do for spawned sessions. Pairs with the B11 `enrichWithProgress` extraction
  window (`src/mcp-server.js`, next refactor pass after the file quiets down) — do both in the same pass.
- [x] **`electron/main.js` has 3 pre-existing eslint errors outside lint-staged's `src/**` scope.**
  **DONE (v4.4.1, ENV-5)** — `electron/` is under the lint gate (`npm run lint` + lint-staged);
  the three sites resolved via the documented permanent `no-console` exemptions.
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

- [x] **Per-session `metadata.json` `writeFileAtomic` tmp orphans in session dirs.** **DONE
  (v4.6.3 #109):** `src/utils/session-metadata-tmp-sweep.js` ports the sibling's age-gated
  list/sweep pattern (cwd-scoped enumeration across taskId + `subagents/<id>` dirs), wired into
  `amicus doctor --fix` as the `session-metadata-tmp` check.
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

- [x] **`docs/usage.md` lacks detail sections for `spend`/`doctor`/`key`** — **DONE (v4.2.0, C10)**:
  usage.md now carries the "Keys, Health & Spend" section with `### amicus key`/`doctor`/`spend`
  detail (re-verified 2026-08-03).
- [x] **Consider a repo-wide `*.md text eol=lf` `.gitattributes` rule** — **DONE (v4.4.1, ENV-4)**:
  a repo-wide `.gitattributes` now normalizes every text file to LF, object database and working
  tree both.

## Phase 16 review roll-up (2026-07-03)

- **`council show` cannot report catalog-delisted saved-council members** — the run path (`resolveCouncilMembers`, config.js) drops delisted raw ids via its catalog `known`-set check; `show`'s resolved/dropped loop (presets-cli.js) pushes any `/`-containing id straight to `resolved`. Mirror the membership check so `show` matches run-time resolution. [S — proven by the 16a.3 review with a live fixture] **DONE (v4.5.0, post-HOLD wave 2 `19c3768`)** — `show` now classifies via the same extracted `classifyCouncilMembers` the run path uses.
- **`continue`/`resume` never compute per-run usage** (no `resolveUsage` call on those finalize paths — pre-existing, predates the spend ledger) — so their runs contribute zero spend-ledger rows. Add usage resolution + ledger appends to both. [S] **DONE (v4.3.0)** — the spend-visibility line item fixed the continue/resume zero-spend rows (A4-basic).
- **Benign double network fetch on the no-cache-failure refresh path** — `runRefresh` and the `refresh-catalog` IPC both call `refreshCatalog()` then `getCatalogInfo({maxAgeMs: Infinity})`, which re-enters `refreshCatalog` when NO cache doc exists (readCache returns null for a metadata-only failure doc). Idempotent, rare path; dedupe when convenient. [S]
- **Size-gate cliffs:** `src/utils/result-schema.js` is now at exactly 300/300 (Phase 20 pushed it from 294 to the ceiling via the `abort-result.js`/`result-schema-version.js` split-out re-exports) — the cliff is HERE now, not just approaching; the next touch to this file forces a split first (buildSpendDoc already carries a fold-back note for result-schema). `src/cli-handlers-doctor.js` is resolved — see the Phase 17 entry above (now 260/300 after the 20.1 extraction). [note]
  ⚠️ **BOTH FIGURES ARE STALE. Re-measured 2026-08-01 at `af3e8f1`:** `result-schema.js` is **243/300**
  and no longer a cliff; `cli-handlers-doctor.js` has regressed to **295/300** and is one again. Use
  the re-measured table under "v4.6 hard gates" as the source of truth.
- **Free-picker missing-`name` fallback** (`r.name || r.id`) covered by inspection, not a test pin — one-liner test someday. [nit]
- **`mode: 'interactive'` spend rows untested directly** — the interactive finalize path shares its ledger-append call site with the tested headless path, but has no dedicated test exercising it through an interactive harness. [nit]
- **Surface `waveId` (and optionally the council name) in spend rows/rollup** so wave-level cost questions ("what did this council run cost in total?") are answerable directly from `amicus spend` instead of cross-referencing run docs. [S] **DONE (v4.3.0)** — waveId/council/project attributed on every spend row + queryable `spend query` (E3/E4/E9).
- **`council save` silently shadows a built-in on first save.** **DONE (v4.6.3 #109, D7):** the
  save doc gains an always-present `shadowsBuiltin` field (from `listBuiltinCouncilNames()`), and
  human mode prints the shadow notice beside the existing `(overwritten)` marker. [nit]
- **`-o` with no following value writes a file literally named `true`.** **DONE (v4.6.3 #109,
  R1) — mechanics corrected on investigation:** it never actually wrote a file named `true`;
  `writeVerdictAtomic` string-coerces the boolean, writes `true.tmp-<pid>`, then `renameSync`
  throws a TypeError, orphaning that tmp file. Now validated: a valueless `-o`/`--out` errors
  `BAD_ARGS` with the flag named, exit 1, `--json` enveloped. [nit]

## Phase 19 smoke note (2026-07-03)

- **`<untrusted_sidecar_output>` fence tag still carries the "sidecar" name** (`src/utils/untrusted-fence.js` `fenceSidecarOutput()`) — user-visible in every `amicus read` output. Deliberately NOT renamed at v2.0.0 (wire-token-continuity argument, same as `[SIDECAR_FOLD]`: the skills' hardening instructions reference the literal tag). If renamed later, skills + tests + docs move in lockstep. [S]

## Phase 20 whole-phase review triage (2026-07-04)

- **Model-resolution failures bypass the `--json` envelope.** **VERIFIED ALREADY FIXED** (found
  during the 2026-08-05 v4.6.3 triage, no code change needed): `resolveModelFromArgs`/
  `validateFallbackModel` were retired (#61 Task 4.7) in favor of `resolveLaunchModel`
  (`src/utils/start-helpers.js`), which routes every exit site — the no-default miss (`:69-78`),
  the interactive-picker cancel, and the router `error` result — through `failJson(BAD_MODEL)`
  under `--json`. [S]

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

- [x] **FR-1 · `runHeadless`'s three early `return`s carry A3's stale-progress defect** — [S]
  **DONE (v4.5.0 ride-along):** all three early returns now stamp a terminal stage derived from
  `resolveTerminalState` with prior usage re-attached (`src/headless.js`, derivation comment block
  around `:1095`). Evidence below kept for history.
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

- [x] **FR-2 · `repairCanHonorContract` is now INERT — a deletion hazard, not a live guard** — [S]
  **DONE (v4.5.0 — "decide, don't drift" option (b) taken):** the predicate was removed
  deliberately, with the F2 reasoning preserved as a comment in `src/council/run-stages.js`
  (now `:210`). Original hazard write-up kept below for history.
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

- [x] **errorWave pack-inherit** (`src/sidecar/fanout.js`). The `errorWave` helper (defined `:88`,
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
  — superseded: shipped in #123 (fix/v47-pr3-riders)
- [x] **T19-m5 — stale-reply guard missing on `openRun`'s `workspace:get-run` reply.** **DONE
  (v4.6.3 #108, D5):** `openRun`'s `get-run` reply now captures `runId` and bails on movement
  before writing `state.detail` or repainting — the third and final F09-class hole in this family
  (after the debate fetch and `workspace-panels.js:110`).
- [x] **T15-m5 — export the three MCP paramMaps.** `tests/mcp-pack-params.test.js`'s
  `TEST_COUNCIL_PARAM_MAP` is a hand-copied mirror of production and has already diverged once (it
  omits `template`). Export the real council/fanout/start paramMaps from their source modules and
  import them in the tests instead of re-typing them.
  — done v4.7 PR4
- [x] **T15-m2 — MCP council path drops template provenance (now council-only).**
  `mcp-council-run.js`'s template path (`:117-123`) discards `promptMeta` — `run.json` records pack
  provenance but no template `{name,hash}`, unlike the CLI path's `run.template`. Wave 1's D1
  (forward maxCost+template on MCP fanout/start) closed this for fanout/start; the council MCP path
  is the only one left. Trivial when wanted: pre-seed it in `mcp-council-run.js`'s `initRun` — the
  handler already holds `t.promptMeta` at that point.
  — done v4.7 PR5
- [x] **droppedMembers reason strings are a closed two-value set.** The additive
  `droppedMembers: [{ref, reason}]` on `run.json` (Post-HOLD wave 2) currently only ever produces two
  `reason` values. Fine as long as nothing branches on the string; revisit whether `reason` should
  become a coded enum instead of free text if a third reason is ever added.
  — standing note: moved to src/utils/config.js docblock (v4.7 PR5)

### Minor findings riding forward (one line each; full reasoning is in the ledger)

*(Filed at the v4.5.0 ship, addressed to the then-planned composition "v4.6". The
degrade-invariant milestone that actually shipped as v4.6.0 was not a sweep of this list —
unchecked items ride to the next rev.)*

- [x] **T2-m1** — `findings.test.js`'s "stays null and NEVER 0" test lost its load-bearing rationale
  comment in a sibling edit; restore a reworded version.
  — done v4.7 PR4
- [x] **T3-m1** — `{{var.}}` empty-key template error message has a cosmetic hole
  (`--var =<value>`); fails safe.
  — done v4.7 PR5
- [x] **T5-m1** — `preflight-json-envelope.test.js` engine mocks return `undefined`, swallowed by
  `captureStdout`; add `mockResolvedValue({exitCode:0})` in `beforeEach` before any success-path test
  lands.
  — done v4.7 PR4
- [x] **T5-m2** — run-state absent-case test should pass `template: null` (real production shape),
  not omit the key.
  — done v4.7 PR4
- [ ] **T5-m3** — template block + `BAD_ARGS` string verbatim-triplicated across the three CLI
  handlers; a shared `applyTemplateForArgs` would collapse the drift risk.
- [x] **T5-m4** — `{{project}}` isn't path-normalized (unlike `artifact_path`); `TEMPLATE_RENDER`
  errors carry `hint: null`.
  — done v4.7 PR5
- [x] **T5-m5** — guard-matrix gaps: fanout×`--artifact`, fanout×`--var`, council×`--var`, positive
  council `{{prompt}}`-slot case, all untested.
  — done v4.7 PR4
- [x] **T5-m6** — fanout help-text wraps at column 31 vs. neighbors' 32; cosmetic.
  — done v4.7 PR5
- [ ] **T11-a** — `PACK_NOT_FOUND` catches four distinct `readPack` failure modes; `PACK_INVALID` is
  reserved for structural failures only.
- [x] **T11-b** — `packRecord` tests don't round-trip hash against `canonicalHash`/`readPack`;
  `source:'path'` (`--pack ./x.json`) branch unexercised.
  — done v4.7 PR4
- [x] **T11-c** — string bench tested only on council kind; fanout by-name bench → `args.council`
  consumption unverified; typing both `--models`+`--council` produces a notice naming only
  `--models`.
  — done v4.7 PR4
- [x] **T11-d** — a council pack with both `critic`+`lenses` and a by-name bench survives run-mode
  validation; the handler's mutual-exclusion error can name a flag the user never typed — narrow
  sibling of the closed XOR case.
  — done v4.7 PR5
- [x] **T13-m1** — `pack-cli.js:33-34` iterates `pr.notices` on an unreachable-in-prod error branch;
  add else/early-return before a future test stub `TypeError`s there.
  — done v4.7 PR5
- [x] **T13-m2** — kind-mismatch test assertion is non-discriminating (fixture name happens to
  contain `'fanout'`); assert the full phrase against a neutral fixture.
  — done v4.7 PR4
- [x] **T13-m3** — `--retry-failed` + `--pack` silently ignores the pack (deliberate, file-wide
  precedent); add a code comment at `cli-handlers-run.js:146` recording it.
  — done v4.7 PR4 (site moved: cli-handlers-fanout.js:30-36)
- [x] **T13-m4** — the pack-cli helper's notice branch (fanout bench-override) is untested through
  the newer code path; Task 12 only covered council's copy.
  — done v4.7 PR4
- [x] **T14-m1** — `pack list` warnings print to stdout, `pack save` warnings to stderr (both say
  "Warning:"); `pack list | grep` mixes diagnostics into data. `--json` unaffected.
  — done v4.7 PR5
- [x] **T14-m2** — `cli-pack-cmd.test.js`'s `---- --json doc shapes ----` banner sits two lines above
  where a fix-wave insertion should have moved it.
  — done v4.7 PR4
- [x] **T14-m3** — `renderPackList`'s `(unknown)` kind / `0.0.0` version fallbacks are unasserted
  (only `(unnamed)` covered); neither can throw.
  — done v4.7 PR4
- [x] **T14-m5** — 7 usage-block flags
  (`--template/--timeout/--max-cost/--gateway/--agent/--thinking/--summary-length`) lack positive
  mapping tests; one table-driven test closes it.
  — done v4.7 PR4
- [x] **T14-m6** — the `pack` usage block in `cli.js` (~:672) is 30 lines vs. siblings' 4-11;
  compress to match.
  — done v4.7 PR5
- [x] **T14-m7** — duplicate lazy `fs`/`path`/`session-manager` requires in `cli-handlers-pack.js`
  (:77-79, :123-125); hoist to module top.
  — done v4.7 PR5
- [x] **T16-m1** — workspace-auto-open helper throws if `env` is undefined on a Linux call, though
  the contract documents `env` as always an object; optional hardening.
  — done v4.7 PR5
- [x] **T18-m1** — fake-DOM debate tests sequence the fire-and-forget `debate.json` fetch by
  counting microtask hops (2×`await Promise.resolve()`); sturdier fix is to expose/await the real
  fetch promise.
  — done v4.7 PR4
- [ ] **T19-m1** — a sub-round-trip double blind-toggle can leave a panel on stale masking
  (`loadPanel`'s completion guard fences on run id only); self-heals on next toggle. Fix: capture
  `A.state.blind` at issue time, bail on mismatch, beside `workspace-panels.js:111`.
  — recon 2026-08-07: the proposed "capture blind and bail" fix is **regressive**: in the
  panel-closed-mid-flight window it leaves a settled-bailed promise cached, giving a *permanently
  blank* panel (worse than today's wrong titles). There is also a deterministic, race-free path the
  item misses (open → close → flip blind → reopen returns the cached settled promise). Correct
  shape: unconditional `delete loading[id]` in `wireLazyPanels`' sameRun arm, plus re-calling
  `files()` in the completion handler and remapping titles by `name` (blind-independent). Deferred
  to PR6.
- [ ] **T19-m2** — RN-5's fix wave added a second uncaught `loadPanel()` call site; a rejected invoke
  leaves `loading[id]` cached and the panel broken until the run changes (pre-existing at `:127`, now
  hit more often).
  — recon 2026-08-07: the genuinely unterminated path is `drillIntoJudge`'s derived promise, whose
  production caller (`workspace-matrix.js:79`) discards it; terminate **there**. Once `p.catch(...)`
  is attached inside `loadPanel`, the two fire-and-forget sites can no longer produce unhandled
  rejections, so the wrapper the item proposes is not the fix. Deferred to PR6.
- [x] **T19-m3** — the terminal-refresh test drives `openRun(sameId)` directly rather than the
  live-tick seam (`workspace-verbs.js:95`).
  — done v4.7 PR4
- [x] **T19-m4** — a blind-flip test reads titles via `children[0]` instead of the house pattern
  `querySelectorAll('h3')` (boundary test `:444`).
  — done v4.7 PR4
- [ ] **T20-m2** — the seat-reorder pass is O(n²) (`find()` per seat); immaterial at real council
  seat counts.
- [x] **T20-m3** — reorder runs before the departed-row removal pass; the combined reorder+removal
  render is untested (hand-traced correct).
  — done v4.7 PR4
- [x] **T21-m1** — a new test's comment says the F09/unreadable-run tests sit "above" in the file;
  they sit below (right facts, wrong direction).
  — done v4.7 PR4
- [x] **T21-m2** — the new abort e2e test uses a 600ms post-confirm wait vs. the file's 400ms
  convention elsewhere; unexplained magic number.
  — done v4.7 PR4
- [x] **T22-m1** — the docs' worked `run.json` excerpt elides `version` from the pack record while
  the prose states a 4-key shape (dodges the docs-quick-sync version-regex).
  — done v4.7 PR4
- [x] **T22-m2** — v4.6 is named "`--input-from`" in `render.js`'s docblock vs. "composable waves"
  in the docs; same feature, two names.
  — done v4.7 PR4
- [ ] **W1-M4** — the wave-1 pack pre-seed's briefing is raw, not rendered, until the child
  re-renders it; eventually consistent.
  — recon 2026-08-07: "eventually consistent" is **conditional**: `sidecar/fanout.js`'s leg-routing
  pass and budget preflight both return **before** the wave-record write, so a child that exits
  there leaves `briefing.md` permanently raw — and `list-search.js:56` reads that file as the
  `--search` corpus, making it a permanently-wrong *search surface*, not a cosmetic window. There is
  also a repo ruling in the opposite direction (`tests/mcp-start-metadata.test.js:96-105` pins
  `briefing: renderedPrompt` for parity with the CLI's on-disk file). Deferred to PR6.
- [ ] **W1-M5** — the budget-ceiling hint text is CLI-flavored even when the run came in over MCP;
  pre-existing class.
  — recon 2026-08-07: the proposed MCP trailer names `maxCost`/`noCostGate`, which **do not exist
  on `amicus_start`** (they belong to `amicus_council_run`), and `noCostGate` is unreachable by any
  route on that path. The ceiling can only have arrived from a pack, so the honest MCP text is
  pack-flavored; and the refusal has **two** branches (`overCeiling` vs the per-$/Mtok threshold)
  whose remedies differ — the second has *no* override over MCP at all. Also `budget.js:74`'s
  ceiling line is a second CLI-flavored string on the same path. Deferred to PR6.
- [ ] **W1-M6 / W1-M7** — forward-notice plumbing for orphaned pack knobs is dead code on the
  `start` spawn-fallback path today; wouldn't surface a notice if that path went live.
- [ ] **resolveBench/resolveBenchInput parallel evolution** (`cli-handlers-council-run.js` /
  `mcp-council-run.js`) — CLI and MCP each hand-roll their own XOR-validation wrapper around the
  shared `resolveCouncilMembers`. Wave 2 unified the *dropped-members* signal between them via that
  shared core, but the two outer wrappers still evolve independently — same drift shape as T15-m5's
  paramMap divergence. Nothing wrong today; watch if one's validation rules change without the other
  following.
- [x] **PR5F-1** — `amicus pack save <n> --version 2.0.0` exits 0 having written NOTHING. `version`
  is a boolean flag (`src/cli.js` `BOOLEAN_FLAGS`, `:143`), so `parseArgs` sets `version: true` and
  `bin/amicus.js:90` intercepts it as the version banner before dispatch — `cli-handlers-pack.js:26`
  (and `:123`) read `args.version || '1.0.0'` expecting a value they can never receive. Both old and
  new `pack:` help document `--version <semver>`. Confirmed live, pre-existing; the
  "accepted-and-silently-ignored" class the product principle rejects. Found during the v4.7 PR5
  final-review consolidated wave, 2026-08-07.
  — superseded: fixed in [#125](https://github.com/BourbonDog/amicus/pull/125) (`fix/pack-save-version`),
  which renamed the pack's own flag to `--pack-version` and added a preflight guard. Filed and closed
  the same day; PR5's `pack:` help block carries the new spelling via the merge of `origin/main`.
- [ ] **PR5F-2** — a bare `--out-dir` (no value) yields a directory literally named `true`.
  `cli-handlers-council-run.js:178-179` does `path.resolve(project, String(args['out-dir']))`
  with no dash-leading/non-string guard — the same R1/R5 class fixed for `-o/--out`, one flag over.
  Found during the v4.7 PR5 final-review consolidated wave, 2026-08-07.
- [ ] **PR5F-3** — SR-3's metadata tmp-sweep behavior delta is untested: a symlink named like a tmp
  file now moves from *swept* (unlink removed the link, a safe success) to *silently ignored* (the
  new `lstatSync`-based directory exclusion also excludes symlinks). Sanctioned by the brief and
  consistent with the module's never-follow policy, but a real, untested behavior delta. Needs one
  test or one docblock line. Found during the v4.7 PR5 final-review consolidated wave, 2026-08-07.
- [ ] **PR5F-4** — `session-index-tmp-sweep.js:37`'s comment cross-references
  `session-metadata-tmp-sweep.js:27-31` by line number; currently exact, but a rot risk the same
  class as T6-m2 above — a future edit to either file can silently invalidate the other's citation.
  Found during the v4.7 PR5 final-review consolidated wave, 2026-08-07.

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
  `errorWave` pack-inherit entry above, closed: shipped in #123, ticked v4.7 PR4.)
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

---

## GoA paper review (2026-08-05) — query-aware selection, relevance weighting, exploration

**Provenance.** Review of "Graph-of-Agents" (arXiv:2604.17148, ICLR 2026 — the MoA successor,
3 selected agents beat 6-agent flat pipelines at ~1/3 tokens) against the council/fanout engine,
session 2026-08-05 on `claude/amicus-paper-review-61714k`. Every code claim below was verified
against source at `0385ae1`. ⚠️ **Read
`docs/superpowers/plans/2026-08-05-goa-paper-review-adoption-notes.md` before implementing any
GOA item** — it carries the paper's numbers/ablations, the full exploration-policy rationale,
the do-not-overclaim limits (paper evidence is short-answer QA, NOT long-form code review — the
constants k=3/τ=0.05/0.7-0.4 label cuts must be re-validated via `evals/`, never copied), and
three **considered-but-not-backlogged** items (max-pool chair-skip, cascade refinement stage,
self-ensemble seats) recorded so they aren't re-derived. Dependency shape: GOA-5/6/8 presuppose
GOA-1; GOA-2/3/4 and GOA-7's prerequisite are independent of it.

- [ ] **GOA-1 · Feature · Auto-bench: query-aware seat selection (node sampling)** — [L]
  `--bench auto[:k]` (CLI + `mcp-council-bench.js` `resolveBenchInput`): one cheap meta-LLM call
  picks k seats from candidate model cards before Stage 1. Enabling change: the catalog cache
  DROPS OpenRouter's `description` at fetch time (`src/utils/model-fetcher.js:42-48` keeps only
  id/name/contextLength/pricing) — retain it (same response, zero extra network), then summarize
  cards (domain/task/size/features) à la the paper's Appendix B, cached alongside the catalog.
  The amicus-only upgrade the stateless paper can't do: blend `deriveReliability()` rows
  (`src/council/ledger.js`) into the picker prompt — earned evidence beats README summaries.
  Composes with the `--max-cost` preflight (best k seats THAT FIT the budget). Degrade path,
  never a failure: ledger unreadable → cards-only (the paper's exact proven config) → static
  bench (`src/utils/council-presets.js`), announced via the existing sink.
- [ ] **GOA-2 · Feature · Relevance-weighted chair packet + labeled influence (edge weighting)** — [S]
  The score matrix already exists — Stage-2 judge rankings → `computeStreetCred()`
  (`src/council/tally.js:49`) — but is descriptive only: tiers are unweighted counts
  (`tally.js:84-107`) and the chair packet (`council/briefings-stage2.js`) presents seats
  symmetrically. Annotate each review in the chair packet with peer-derived credibility using the
  paper's label scheme (high/moderate/low; their A_ij=1 ablation costs −1.9/−2.6 points) plus
  per-seat "be critical" calibration extending `ANTI_SYCOPHANCY_CLAUSE`. Optional second step,
  schema-versioned: a weighted tally variant (top-ranked judge's dispute counts more).
  ⚠️ **Never τ-prune findings** — a minority-raised blocker is what the tier cascade + debate
  protect. Weight the chair's attention, don't delete evidence.
- [ ] **GOA-3 · Feature · Per-finding confidence field in the findings contract** — [S–M]
  Additive `confidence` (0.0–1.0) per finding in `FINDINGS_CONTRACT`/`FINDINGS_JSON_SHAPE`
  (`council/briefings.js`, validated in `council/findings.js`, parsed in `parse-stage2.js`).
  Feeds the tally's `thin/solid` flag and the chair packet; the higher-value wiring is seat-level
  substitution (the paper's confidence backstop): chronic low-confidence + `unstructured`
  conformance → swap the seat via `sidecar/fallback-chains.js` instead of paying repair solos to
  a model that can't honor the contract. Tolerant parse: absent field ⇒ null, never a
  conformance failure (old benches must not degrade).
- [ ] **GOA-4 · Feature · Output/report impact: relevance + efficiency surfaces** — [M]
  Make the run's selection/weighting story visible. Report + workspace: seat rail ordered by
  street-cred with high/moderate/low badges (`council/report.js`, `council/report-html.js`,
  `workspace/matrix-model.js` + seat painters); an efficiency panel — calls/tokens/cost vs what
  the full static bench would have cost (paper Table 2 as a per-run artifact) — from data already
  in tally `runStats`/spend ledger. When GOA-1 lands, the report also names WHY each seat was
  picked (card match vs ledger evidence vs scout), reusing the picker's own output.
- [ ] **GOA-5 · Feature · Scout seat (exploration for auto-bench)** — [M, needs GOA-1]
  k−1 seats on merit + one rotating seat for an under-sampled model matching the query domain
  (`lowN` models first, then never-benched catalog entries). Config knob for the rate
  (scout every Nth run); `--bench auto:frozen` disables it for reproducible/spend-sensitive runs.
  Rationale (see adoption notes §5): a council is a self-grading trial — the rookie's review is
  peer-ranked and tier-contained, so exploration costs one leg's tokens, not verdict quality, and
  every candidate reaches the 3-run `lowN` graduation in bounded time. Cheap tier: scout only on
  free/budget benches (`utils/free-models.js` — auditioning free models is literally free).
- [ ] **GOA-6 · Feature · Treat `lowN` as "prior vs. evidence," not "unproven → avoid"** — [S, needs GOA-1]
  `deriveReliability()`'s `lowN` (`src/council/ledger.js:78`, runs < 3) must gate how the ledger
  is USED, not whether a model is eligible: below 3 runs the ledger term is silent/advisory and
  selection rests on model cards; optionally shrink toward the vendor-family/tier prior
  (`utils/curated-models.js` / `utils/model-tiers.js`) so new models start at "presumed as good
  as their siblings." ⚠️ The picker prompt must state that `runs: 0 — untested` is
  neutral-to-positive (a scout-seat candidate) — an uninstructed LLM picker reads missing data as
  risk, which recreates the entrenchment loop GOA-5 exists to break.
- [ ] **GOA-7 · Defect+Feature · Segment ledger history by RESOLVED model (prerequisite), then recency decay** — [M; prerequisite S–M, independent]
  **Prerequisite is a live defect today, worth doing even if no other GOA item ships:** ledger
  rows key by council ALIAS (`buildLedgerRows` joins `meta.models` by exact string; the comment at
  `src/council/run-debate.js:135-137` states it verbatim), and aliases silently retarget —
  `council-presets.js` documents `gpt-pro` → `gpt-5.6-sol-pro` and the `opus` re-pin, both
  2026-08-04 — so `council stats` conflates different underlying models under one name. Fix:
  record the resolved executable id on each ledger row and aggregate per resolved id.
  ⚠️ Schema discipline: the append-only ledger was deliberately NOT extended by review F3 (see
  `src/council/tally.js:117-124`) — this is THE sanctioned shape change, so bump
  `LEDGER_SCHEMA_VERSION`, keep old rows readable (absent id ⇒ legacy row), no drive-by fields.
  Then: recency decay (or last-K window) in `deriveReliability` so stale evidence fades, improved
  models get a path back in, and a retarget naturally resets an alias to `lowN` ⇒ scout treatment.
  Bonus: resolved-id keying is the natural moment to introduce seat-id ≠ model-id, the blocker
  recorded against self-ensemble seats (adoption notes §4.3).
- [ ] **GOA-8 · Feature · Shadow seat: zero-risk audition variant** — [M, needs GOA-1; alternative/complement to GOA-5]
  For benches where even one merit seat is too precious: the rookie's review IS included in the
  anonymized Stage-2 judge bundle (blind labels — judges can't tell), so it earns rankings,
  street-cred, and ledger rows at full fidelity, but its adjudication votes are EXCLUDED from
  tier bases and its findings are marked advisory in tally/report (never counted, never silently
  dropped — the announcement invariant applies). Costs one leg + marginally larger judge bundles;
  zero influence on the verdict. Design care: the tally already excludes a raiser's own votes
  (`tally.js:91-107`) — shadow exclusion is the same shape, one filter earlier, and `runStats`
  needs a distinguishing role so `ledger.js`'s role-keyed joins don't misfile it (same join
  hazard the judge rows hit — `ledger.js:21-25`).
- 2026-08-05 release-gate finding (v4.6.2 cut): models --check flags curated gpt-pro STALE by deriving a DIRECT form (openai/gpt-5.6-sol-pro) from its openrouter-only route; the openrouter route SERVES (live probe d28cab32, $0.35, 'SMOKE OK', 8s). Exit 0. Audit gap: a gateway-only route with no direct sibling is a routing choice, not staleness — teach the auditor. Same family: 'fable has no direct form' divergence line.
  [2026-08-05 re-verification: HALF-WRONG — fable's line was a TRUE report (live
  /v1/models lists claude-fable-5; direct smoke served, wave 47278069, $0.72 — do not
  re-probe). Resolved by authoring the direct route (ruling R2); the gpt-pro half
  fixed by audit provenance. Both in v4.6.3 PR1.]
  Disposition: backlog rider, no code change mid-cut (#101's sol-pro choice stands).

---

## v4.6.3 sweep riders (transcribed at the release cut, 2026-08-05)

Transcribed from the "Riders / follow-ups" sections of the four v4.6.3 sweep PR bodies
(#107–#110) per the spec's §9 rule — a deferral that exists only in a closed PR's text is the
same lost-deferral class this file exists to prevent. One PR109 rider (the realDeps/baseDeps
duplication debt) is excluded here: it was resolved within the same sweep by #110's
`makeBaseDeps()` consolidation, so it never went stale.

- [x] `tests/sidecar/models-command.test.js:~419`'s fable divergent-missing rendering fixture is
  now historical (the real fable entry can't reproduce it post-#107; still valid as a rendering
  test for the fixture case). — #107
  — done v4.7 PR4
- [x] Comment-only fixture staleness trio: `provider-default-picker.test.js:132`,
  `gateway-router.test.js:103`, `gateway-route-catalog.test.js:43` — each comment claims fable
  "mirrors" an OpenRouter-only entry, now a historical example rather than current fact. — #107
  — done v4.7 PR4
- [x] `model-fetcher-anthropic`'s floor-containment test is redundant against the newer exact-list
  pin (the deleted guard's mandated replacement) — documents the inversion, not a live gap. — #107
  — done v4.7 PR4
- [x] `gateway-route-audit.test.js`'s "non-annotated alias" comment wording is defensible as-is
  (an explicit `gatewayOnly:false` provenance value is what a non-annotated entry produces) but
  flagged for a future wording pass. — #107
  — done v4.7 PR4
- [ ] Bare-object candidate/suppression maps (`seen`/`reviewing`/`byRole` in the seats-panel dead
  logic) inherit `Object.prototype` keys — a model literally named `toString` would be silently
  suppressed. Pre-existing pattern, effectively unreachable; fix as one `Object.create(null)`
  family sweep, not piecemeal. — #108
- [ ] Role `'claude'` is absent from `isReviewing`'s allowlist — unreachable today (claude is
  rejected as bench/chair/critic), but `isReviewing` is the single place to extend if that
  reservation ever loosens. — #108
- [ ] Hidden dependency, documented in `deadSeats`'s docblock: recovered-critic suppression relies
  on `roleFor`'s critic branch, which the `--critic`/`--lenses` mutual exclusion keeps reachable —
  revisit if that exclusion ever loosens. — #108
- [x] `--out -x` parser asymmetry: `--out -x` consumes `-x` as a value while `-o -x` yields boolean
  `true` — out of R1's scope (the valueless-flag fix); the parser itself is untouched. — #109
  — done v4.7 PR5
- [ ] The metadata-tmp sweep reads `process.cwd()` directly instead of doctor's injected `getCwd`
  — revisit if a `doctor --cwd` mode ever lands. — #109
- [x] A directory named like an orphan tmp file lands in the sweep's "unremovable" bucket via
  EISDIR (inherited from the session-index-tmp-sweep sibling; the throwing-unlink test pins
  never-crash, not a fix). — #109
  — done v4.7 PR5
- [ ] Two `doctor` rows share message prose, disambiguated only by row name (deliberate
  byte-parallel with the sibling sweep; `fixDetail` strings differ). — #109
- [x] No combined `overwritten`+`shadowsBuiltin` human-render test for `council save` (hand-traced
  correct; the `--json` compose case is covered). — #109
  — done v4.7 PR4
- [ ] The registry pre-check's two body greps (version, status) scan independently — sound for a
  single-version endpoint, revisit if the registry ever returns collections. — #110
- [x] The version grep's BRE dots are unescaped (false-match direction is fail-toward-skip, not
  real-world exploitable, but worth tightening). — #110
  — done v4.7 PR5
- [x] `run-chair.js`'s `ch4` still carries the same duplicated-literal pair (`:186`/`:192`) that
  `ch1`–`ch3` were converged out of — out of PR4's scope, filed. — #110
  — done v4.7 PR5
- [x] The 3-file second-layer `base` duplicate in the doctor suites (optional further
  `makeBaseDeps()` consolidation beyond this sweep's pass). — #110
  — done v4.7 PR4
- [ ] `doctor-local-providers`'s preserved `env` omission is comment-marked as deliberate — revisit
  if it ever drifts unnoticed. — #110
- [x] `makeBaseDeps()`'s new test helper sits outside the `src/`/`electron/` lint gates (manually
  linted clean today; no automated enforcement). — #110
  — done v4.7 PR4
- [x] Phase-11 test-hygiene bundle's skill-docs remainder (frontmatter null-guards on
  `tests/skill-second-opinion-docs.test.js`/`tests/skill-sidecar-docs.test.js`, the `/multi-model/i`
  pin tighten) — files not opened during this sweep; also tracked in this file's Phase 11 section
  above. — #110
  — done v4.7 PR4: pin tightened; the null-guard half was already resolved by 7cf3f18
  (mustMatch), filed sight-unseen. Canonical entry: Phase 11 (:204).
- [x] The README's "sixteen tools" count is unpinned prose — owner call on whether to pin it to a
  generated count or leave it deliberately count-neutral. — #110
  — done v4.7 PR4 (R6 count-neutral)

## v4.7 PR1 findings (2026-08-06)

- [ ] **Duplicated aliases in `--models`/council presets can yield two primary rows for one
  seat** — [S, needs a product decision] `parseModelsList` (`src/sidecar/fanout-validate.js:22`)
  allows duplicate aliases by design (its own docstring: "duplicates allowed"), and council
  callers pass the parsed list through unchecked. Both `lensIndexOf`
  (`src/council/run-retry.js:24`, via `o.models.indexOf(model)`) and `roleFor`
  (`src/council/run-stages.js:34`, via `o.models.indexOf(alias)`) resolve a duplicated alias by
  first occurrence only. A duplicated alias whose second occurrence dies could therefore produce
  both a review-based primary row (attributed to the first, surviving occurrence) and a dead-seat
  primary row (from `roleFor`'s first-occurrence resolution) for the same model — two primary
  rows where the row-per-launch bijection expects one per requested seat. Pre-existing; not
  touched by PR1's row-per-launch work. Found during PR1 Task-4 review, 2026-08-06. Needs a
  product decision: reject duplicate aliases outright (parse-time error) vs. dedupe silently
  before use.
  — recon 2026-08-07: filed as PR1F-1 for v4.7 PR5. The guard belongs in the two bench
  **resolvers** (`cli-council-run-bench.js` `resolveBench`, `mcp-council-bench.js`
  `resolveBenchInput`), not the CLI handler: the MCP path creates the run dir, writes
  `briefing.md`, seeds `run.json` as `running`, and writes the pointer **before** spawning, so a
  handler-only guard leaves an orphaned `running` run. Rider: `amicus council save` accepts
  duplicate members too. Deferred to its own TDD pass, as originally filed (needs a design ruling
  recorded first).

- [ ] **`legRow` (`src/council/run-debate.js:39`) is the THIRD hand-rolled runStats-row
  builder** — [S, defer-with-record] alongside `buildRunStatsEntry` (`src/council/run-assemble.js:54`,
  the general one every non-debate producer uses) and `claudeRunStatsRow` (the synthesized
  claude-review row). `legRow` independently reimplements the same "verbatim leg fields +
  emit-`waveId`-only-when-set" shape `buildRunStatsEntry` already owns, just keyed on an explicit
  `model` param instead of `leg.model` (debate needs this because a leg-absent attempt has no
  `.model` of its own). Three builders for one row shape is a drift risk — a future field added to
  one (e.g. `findingsUnverified`/`repairRefused`, which `buildRunStatsEntry` already carries and
  `legRow` does not) silently fails to reach debate-born rows. Unify `legRow` into
  `buildRunStatsEntry` (it would need an optional explicit-`model` override for the leg-absent
  case) in its own dedicated TDD pass — out of scope for the final-review consolidated wave, which
  only fixed comment/test-armor items, not a producer-unification refactor. Found during the v4.7
  PR1 final-review consolidated wave, 2026-08-06.
  — recon 2026-08-07: filed as PR1F-2 for v4.7 PR5. There is a **fourth** builder the item never
  names (`mk` in `debate.js:102-109`), and the real hazard is **key order** (not
  `findingsUnverified`): `JSON.stringify` preserves insertion order, so unification changes
  `run.json` bytes for every debate row carrying a `waveId`, and the existing `toEqual`/
  `toMatchObject` pins are order-insensitive and would not catch it. Also `mk`'s
  `l.status || 'unknown'` vs `buildRunStatsEntry`'s `leg ? leg.status : 'error'` diverge. Correct
  shape needs `buildRunStatsEntry` extracted to a **pure** module (`debate.js` is declared DI-free
  with zero requires). Stays deferred to its own TDD pass, as originally filed.

- [ ] **Conformance drift between producers of the same non-primary role** — [S, defer-with-record]
  `buildRunStatsEntry` (`src/council/run-assemble.js:60`) defaults `conformance` to `'clean'` when
  the caller doesn't pass one explicitly — every engine-born `chair-attempt` row (`run-chair.js`'s
  `recordAttempt`) takes that default. `legRow` (`src/council/run-debate.js:39`, see above) has no
  default at all; every debate-born `repair`/`superseded` row is called with an explicit
  `'unstructured'` literal (`run-debate.js:85-86,141-142`). The net effect: a `repair`-role row's
  `conformance` value depends on which producer built it, not on anything about the row itself —
  an engine-born `repair` row (chair ch4) can read `'clean'`, a debate-born `repair` row
  (`-d<N>r`/`-rv-…r`) never can. Nothing consumes `conformance` on a non-primary row today (the
  ledger join excludes all of them — see `ledger.js`'s `LEDGER_JOIN_ROLES`), so this is silent
  drift, not a live defect; record it before something starts reading it. Found during the v4.7
  PR1 final-review consolidated wave, 2026-08-06.
  — recon 2026-08-07: filed as PR1F-3 for v4.7 PR5. **Five** engine-born sites take the `'clean'`
  default, not two (add `run-stage2.js:122` and `run-stages.js:244`), and the item's proposed
  `solo.leg && res.ok ? 'repaired' : 'unstructured'` expression is a **constant**: the push at
  `run-stages.js:181` precedes `res = validateFindings(...)` and sits inside a `while (!res.ok ...)`
  loop, so `res.ok` is always false there. Use a flat literal, or move the pushes below validation —
  an explicit design call. Do **not** flip the `|| 'clean'` default (primary error rows depend on
  it). Deferred to its own TDD pass, as originally filed.

- [ ] **The dead-seat retry-reason text ("did not review — retried once") has no terminal-path
  home since the v4.7 CA-4 dead-seat convergence** — [S, defer-with-record, owner-accepted] Before
  v4.7, a dead seat that had been retried and still failed rendered `deadSeats()`'s
  `statusText: 'did not review — retried once'` (vs. the plain `'did not review'` — the
  `retryWaveId`/`firstFailure` branch in `electron/workspace-ui/live-model.js`'s `deadSeats`). Now
  that same seat carries its own row-per-launch primary ERROR row (v4.7 CA-4), and D6's "already
  present in liveSeats" suppression (see the updated comment at `live-model.js`'s `deadSeats`
  docblock, and `tests/workspace/dead-seat-rows.test.js`'s `(b2)` pin) drops the ghost dead row
  entirely — which means the retried-once phrasing is dropped with it; the errored cost row
  carries no distinct "this was retried" text today, just its raw `status`. This was an
  owner-accepted consequence of the dead-seat convergence ruling (one row, not two), not an
  oversight, but the information itself is still useful and worth restoring on the surviving row:
  render the retry-reason text into the errored cost row's own status cell (the seat-row
  equivalent of what the now-suppressed dead row used to say), sourced from the same
  `retryWaveId`/`firstFailure` degrade-record fields `deadSeats` already reads. Found during the
  v4.7 PR1 final-review consolidated wave, 2026-08-06.
  — recon 2026-08-07: filed as PR1F-4 for v4.7 PR5. The proposed `r.status === 'error'` gate is
  **too narrow**: the leg-status vocabulary includes `'timed-out'`, a primary retry trigger, so the
  gate would never fire for the very case the retry text exists for. Also there is exactly **one**
  production call site (`workspace-seats.js:47`), not two, and the live-tick path never goes
  through `seatsFromRunStats` at all — so the fix is terminal-path-only. Line budget:
  `live-model.js` is 284/300 and the honest implementation is +20-30, so it needs the helper to
  land in `workspace-seats.js` (132) instead. Deferred to PR6.
