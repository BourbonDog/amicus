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
  sight-unseen. Originally double-filed as a #110 sweep rider; that duplicate collapsed here in
  v4.7 PR6 per spec D18.
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
  `quick-picks.js:83` (`toLiveSeedAliases`) and the readline wizard's default-model
  canonicalization call (`setup.js:389` at the time of this fix -- that line no longer shows
  this code; the call has since moved and become `toStorableRoute(pick)` at
  `src/sidecar/setup.js:542`, a fixed, different form, not a bare `toCanonicalDefault()`, so
  neither historical line number should be expected to still demonstrate the bug below) both
  ran `toCanonicalDefault()` on a divergent vendor's OpenRouter route, storing
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

  ⚠️ **SUPERSEDED 2026-08-16 — this table is now STALE. Use *"Size gate — re-measured 2026-08-16"*
  in the v4.8.0 section below** (re-measured today: `fanout.js` **294**, not 300; `continue.js`
  **282**, not 297; `run.js` **281**, not 295 — so the "three files at exactly 300/300" warning
  below is wrong; it is **two**).

  **Gated files at ≥291/300 — RE-MEASURED 2026-08-09 against `main` @ `caf4d7e` (v4.7.0).**
  This replaces the 2026-08-02 v4.6 table, which had gone stale exactly as this section warns.
  Counted with the gate's own arithmetic (`check-file-sizes.js:53-54`: `split('\n').length`, minus
  one when the file ends in a newline — a naive line count reads one high and will look like a
  false violation).

  | Lines | File | Δ vs the v4.6 table |
  |---|---|---|
  | **300** | `src/pack/pack-resolve.js` | **UP 3 — AT CEILING, zero headroom** |
  | **300** | `src/sidecar/electron-install.js` | unchanged — AT CEILING |
  | **300** | `src/sidecar/fanout.js` | **UP 2 in v4.7 — AT CEILING, zero headroom** |
  | 297 | `src/sidecar/context-builder.js` | unchanged |
  | 297 | `src/sidecar/continue.js` | unchanged |
  | 297 | `electron/workspace-ui/workspace-render.js` | **was missing from the table entirely** |
  | 296 | `src/sidecar/session-utils.js` | unchanged |
  | 295 | `src/council/run.js` | **crept back +24** — the v4.6 Plan-1 extraction to 271 has been eaten |
  | 294 | `electron/workspace-ui/live-model.js` | was missing |
  | 294 | `electron/workspace-ui/workspace-verbs.js` | UP 1 |
  | 292 | `src/cli-handlers-doctor.js` | DOWN 3 |
  | 292 | `src/sidecar/models.js` | was missing |
  | 291 | `src/council/run-stages.js` | was missing |
  | 291 | `src/mcp-council-run.js` | UP 10 |

  **Dropped out of the danger band since v4.6** (no longer cliffs): `src/cli-handlers-run.js`,
  `src/cli-handlers-council-run.js`, `src/council/run-debate.js`, `src/sidecar/start.js`,
  `electron/workspace-ui/workspace-panels.js`.

  **Three files now sit at exactly 300/300.** Any edit touching `pack-resolve.js`,
  `electron-install.js` or `fanout.js` must extract FIRST — there is no headroom at all.
  Note for the v4.8.0 plan: `run.js` at 295 is where #130's ledger-skip lands, and
  `sidecar/continue.js` at 297 is where v4.7.1's tag-inherit lands. Both need an extraction or a
  surgical diff.

  **Two corrections to entries elsewhere in this file** *(both re-measured 2026-08-09)*:
  - The Phase 17 entry claims `src/cli-handlers-doctor.js` was resolved to 260/300 by the Phase 20.1
    `doctor-mcp-checks.js` extraction. It crept back to 295, and is now **292/300** — still in the
    danger band, and `doctor-mcp-checks.js` (**91** lines) is still the natural receiving module.
  - The Phase 16 roll-up claims `src/utils/result-schema.js` is "now at exactly 300/300". It is
    **279/300** and is no longer a cliff.

  Receiving modules with room, for the extractions the three at-ceiling files will need:
  `src/pack/pack-forward.js` (**104**) for pack-domain spillover, `src/utils/doctor-mcp-checks.js`
  (**91**) for doctor checks, `cli-council-run-render.js` (51) for council-run rendering.

  `src/pack/pack-forward.js` (96 lines) remains the natural receiving module for pack-domain
  spillover. **Any next-rev task, or any hotfix, touching a file in the table above must extract
  from it FIRST**, before adding anything.
- [x] **KNOWN_VARIABLES single-source (T3-m2).** — **DONE, v4.9 W1 (2026-08-25).** The gate is
  satisfied ahead of `{{input}}`: `render.js` now derives BOTH the inline validation array and
  the replacement chain from `KNOWN_VARIABLES` (the replacement chain was a THIRD hand-kept
  enumeration this filing never counted), pinned by a drift test that extends the live exported
  array and asserts a new entry validates AND renders. The `:45` citation had rotted to `:49`
  before the fix; anchors are now by symbol. Original filing: `src/template/render.js:45`
  hand-maintained two
  copies of the known-template-variable set — `KNOWN_VARIABLES` and a separate inline validation
  array — and an edit updating one copy but not the other failed silently.

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
- [x] **T5-m3** — template block + `BAD_ARGS` string verbatim-triplicated across the three CLI
  handlers; a shared `applyTemplateForArgs` would collapse the drift risk.
  — done v4.7 PR6 (src/cli-template-args.js)
- [x] **T5-m4** — `{{project}}` isn't path-normalized (unlike `artifact_path`); `TEMPLATE_RENDER`
  errors carry `hint: null`.
  — done v4.7 PR5
- [x] **T5-m5** — guard-matrix gaps: fanout×`--artifact`, fanout×`--var`, council×`--var`, positive
  council `{{prompt}}`-slot case, all untested.
  — done v4.7 PR4
- [x] **T5-m6** — fanout help-text wraps at column 31 vs. neighbors' 32; cosmetic.
  — done v4.7 PR5
- [x] **T11-a** — `PACK_NOT_FOUND` catches four distinct `readPack` failure modes; `PACK_INVALID` is
  reserved for structural failures only.
  — done v4.7 PR6 (docblock now truthful; the underlying non-object-body crash was fixed in the
  same PR)
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
- [x] **T19-m1** — a sub-round-trip double blind-toggle can leave a panel on stale masking
  (`loadPanel`'s completion guard fences on run id only); self-heals on next toggle. Fix: capture
  `A.state.blind` at issue time, bail on mismatch, beside `workspace-panels.js:111`.
  — recon 2026-08-07: the proposed "capture blind and bail" fix is **regressive**: in the
  panel-closed-mid-flight window it leaves a settled-bailed promise cached, giving a *permanently
  blank* panel (worse than today's wrong titles). There is also a deterministic, race-free path the
  item misses (open → close → flip blind → reopen returns the cached settled promise). Correct
  shape: unconditional `delete loading[id]` in `wireLazyPanels`' sameRun arm, plus re-calling
  `files()` in the completion handler and remapping titles by `name` (blind-independent). Deferred
  to PR6.
  — recon 2026-08-08: the 2026-08-07 corrected shape is itself refuted — remapping titles by
  `name` reintroduces cross-model misattribution (the RN-1 class) when `artifactsByModel` is
  absent (measured: `["vendor/a","vendor:a"]` → `["vendor:a","vendor:a"]`), and a third path — the
  artifact manifest changing between issue and completion — survives both halves. T19-m1 and
  T19-m2 must be ONE task behind a mandatory `workspace-panels.js` extraction (294/300 as of PR6,
  gate-adjusted; T19-m1 alone lands it at exactly 300/300 with zero comments — adding T19-m2 too
  → 302/300). Needs a real design pass, not a sweep slot. Deferred to PR7.
  — done v4.7 PR7 (Tasks 1-6): shipped as ONE cluster behind the `workspace-lazy.js` extraction
  (Task 1, no-behaviour-change) — an unconditional cache drop, a monotonic per-panel issue token,
  two-argument `.then(ok, fail)` termination with announced eviction and a self-checked cache
  evict, and a sync-safe matrix-drill wrap (see T19-m2 below). Closes stale paths **A**
  (close/flip/reopen), **B** (two waves in flight) and **G** (same-run manifest growth) — the
  three the 2026-08-07 recon named — plus **D** (the artifact manifest changing between issue and
  completion), which the Task 3 cache-drop alone *converted into a race* (an orphaned in-flight
  promise, fenced only on unchanged runId, repainting silently) rather than closing, and which
  Task 4's token then genuinely closed — reviewer-reproduced through real collapse/rewire/reopen
  wiring with four reads in flight, not a simulation. Both refuted shapes stay refuted (see the
  2026-08-07 and 2026-08-08 recon notes above for why); neither was re-proposed.
- [x] **T19-m2** — RN-5's fix wave added a second uncaught `loadPanel()` call site; a rejected invoke
  leaves `loading[id]` cached and the panel broken until the run changes (pre-existing at `:127`, now
  hit more often).
  — recon 2026-08-07: the genuinely unterminated path is `drillIntoJudge`'s derived promise, whose
  production caller (`workspace-matrix.js:79`) discards it; terminate **there**. Once `p.catch(...)`
  is attached inside `loadPanel`, the two fire-and-forget sites can no longer produce unhandled
  rejections, so the wrapper the item proposes is not the fix. Deferred to PR6.
  — recon 2026-08-08: must be the SAME task as T19-m1, behind the same mandatory
  `workspace-panels.js` extraction — see T19-m1's 2026-08-08 note for the refuted shape and the
  294/300→302/300 line-budget math. Deferred to PR7.
  — done v4.7 PR7 (Tasks 1-6): same cluster as T19-m1 — see its done note above. The genuinely
  unterminated path was `drillIntoJudge`'s derived promise, whose production caller
  (`workspace-matrix.js:79`) discarded it; terminated there via the two-argument `.then(ok, fail)`
  now inside `loadPanel`, itself wrapped in a sync-safe `Promise.resolve().then(() => onDrill(...))`
  so a synchronous throw from `onDrill` still surfaces instead of escaping uncaught (mutation-proved
  both ways — a bare `Promise.resolve(onDrill(...))` fails the sync-throw case). Verified by
  execution with negative controls, including a raw-node harness (jest swallows unhandled
  rejections): reverting the fix reproduces exactly 3 unhandled rejections.
- [x] **T19-m3** — the terminal-refresh test drives `openRun(sameId)` directly rather than the
  live-tick seam (`workspace-verbs.js:95`).
  — done v4.7 PR4
- [x] **T19-m4** — a blind-flip test reads titles via `children[0]` instead of the house pattern
  `querySelectorAll('h3')` (boundary test `:444`).
  — done v4.7 PR4
- [x] **T20-m2** — the seat-reorder pass is O(n²) (`find()` per seat); immaterial at real council
  seat counts.
  — standing note v4.7 PR6: folded into the RN-11 comment at
  electron/workspace-ui/workspace-render.js renderSeats
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
- [x] **W1-M4** — the wave-1 pack pre-seed's briefing is raw, not rendered, until the child
  re-renders it; eventually consistent.
  — recon 2026-08-07: "eventually consistent" is **conditional**: `sidecar/fanout.js`'s leg-routing
  pass and budget preflight both return **before** the wave-record write, so a child that exits
  there leaves `briefing.md` permanently raw — and `list-search.js:56` reads that file as the
  `--search` corpus, making it a permanently-wrong *search surface*, not a cosmetic window. There is
  also a repo ruling in the opposite direction (`tests/mcp-start-metadata.test.js:96-105` pins
  `briefing: renderedPrompt` for parity with the CLI's on-disk file). Deferred to PR6.
  — recon 2026-08-08: option (B) (the only shape on file) throws `ReferenceError` on every wave
  (hoists a `legs` read into its TDZ), breaks the pinned `fanout.test.js:738` (asserts no wave dir
  on validation failure), and closes only 2 of ~17 pre-launch abort paths. `src/sidecar/fanout.js`
  is at 300/300 by the size gate — zero headroom for a fix in this file. Deferred to PR7.
  — done v4.7 PR7 (Task 7): fixed entirely inside `src/mcp-server.js`'s `amicus_fanout` handler,
  NOT `sidecar/fanout.js` (still exactly 300/300, zero lines added). `briefing.md` now holds the
  RENDERED prompt — parity with the `amicus_start` in-process path — written before the wave
  dir/metadata, so a child that aborts before its own render leaves a findable `--search` corpus.
  The raw `input.prompt` moves to a new sibling file, `briefing-input.md`, handed to the spawned
  child via `--prompt-file` so the child's own later render remains the `promptMeta.template`
  provenance source; that file is new on-disk residue in every wave dir launched from a pack that
  forwards a `template` (`fwd.renderedPrompt !== undefined` — a template-free wave still writes
  only `briefing.md`, unchanged in shape). Consequence found in review, not originally scoped:
  `src/sidecar/fanout-retry.js:136` reads the ORIGINAL wave's `briefing.md` back verbatim as the
  retry wave's `prompt` — since that file is now
  the rendered text, retrying a template-launched wave replays the already-rendered text rather than
  re-rendering the template a second time. `amicus_start`'s own identical divergence
  (`mcp-server.js:669`) is explicitly NOT covered by this fix — filed separately below, not folded
  in, because nobody has executed that half end to end.
- [x] **W1-M5** — the budget-ceiling hint text is CLI-flavored even when the run came in over MCP;
  pre-existing class.
  — recon 2026-08-07: the proposed MCP trailer names `maxCost`/`noCostGate`, which **do not exist
  on `amicus_start`** (they belong to `amicus_council_run`), and `noCostGate` is unreachable by any
  route on that path. The ceiling can only have arrived from a pack, so the honest MCP text is
  pack-flavored; and the refusal has **two** branches (`overCeiling` vs the per-$/Mtok threshold)
  whose remedies differ — the second has *no* override over MCP at all. Also `budget.js:74`'s
  ceiling line is a second CLI-flavored string on the same path. Deferred to PR6.
  — partially done v4.7 PR6: the parity half (the gate no longer hangs off packForward.maxCost) and
  the surface-aware text shipped for the ONE refusal site that passes `{kind:'mcp'}` —
  `mcp-server.js`'s shared-server `amicus_start`. Remainder re-filed as PR6F-1 below; this box is
  ticked only because the shipped half is done, not because the class is closed.
- [x] **PR6F-1** — CLI-flavoured budget text survives on two paths W1-M5's original framing missed
  (it assumed a single site). Only `mcp-server.js:463` passes `{kind:'mcp'}`; verified 2026-08-08 that
  it is the sole surface-aware call site of three.
  (a) **FIXED v4.7 PR7 (Task 11) — Option N, surface-neutral.** Retargeted
  `src/council/run-budget.js:156/158` (the run/wave-doc `budget-refusal` degrade record read by
  BOTH surfaces, not `fanout-budget.js`) to prose naming no flag at all: `why` now reads "the $N
  cost ceiling for this run refused it…" and `remedy` reads "Raise this run's cost ceiling, or turn
  the cost gate off, to seat them" — replacing the CLI-flavoured `--max-cost`/`--no-cost-gate`
  wording. Net 0 lines (`run-budget.js` held at 283/300, the plan's originally-estimated "71→67"
  companion line in `fanout-budget.js` corrected in review to 71→70). The separate, structurally
  unreachable CLI-flavoured reservation trailer at `fanout-budget.js:62-65` (`errorDoc` never
  carries `hint` on this path; `quiet:true` unconditional at `run-launch.js:134`) had its
  `Override: --max-cost / --no-cost-gate` sentence deleted rather than reworded, since nothing
  renders it. Note the retained hint at `:62` still says "does not fit the `--max-cost` allowance"
  — correct, because that string's only real reader is a direct CLI `amicus fanout`. Both strings pinned in both directions
  in `8b3b90d`, mutation-proved; Step-1 grep found **zero** existing tests asserting either literal
  in either direction before this — MCP-facing, money-related text with no prior coverage.
  (b) **STRUCK — verified NOT a defect, v4.7 PR7 (Task 11/12).** The `amicus_start` spawn-fallback
  child's CLI-flavoured text (`cli-handlers-run.js:92`) is written to the child's **stderr**;
  `spawnSidecarProcess` (`src/mcp-server.js:250-256`) wires that stderr to a `debug.log` file
  descriptor (`fs.openSync(..., 'w')`), and nothing under `src/` ever reads `debug.log` back into a
  doc, a tool response, or any other MCP-visible surface (confirmed by grep). The text is written
  but never seen by any caller. Closed as verified-unreachable, not filed as open debt.
  Found by the v4.7 PR6 whole-branch review, 2026-08-08.
- [x] **W1-M6 / W1-M7** — forward-notice plumbing for orphaned pack knobs, originally filed as dead
  code on the `start` spawn-fallback path that "wouldn't surface a notice if that path went live."
  — resolved v4.7 PR7 (Task 10): **NO DEFECT — the original claim was wrong twice over.** First,
  "the path is dead": spawn-fallback is the **default** for interactive `amicus_start`, not a dead
  branch (recon 2026-08-08). Second, once re-framed as live, the notice claim itself still doesn't
  hold — the source shape was already correct and verified green; an orphaned knob DOES surface a
  notice on this path today. What was actually missing was test coverage proving it, not a source
  fix. Shipped a real-execution guard in `tests/pack/mcp-pack-params.test.js` (the
  `KIND_OPTIONS.solo` round-trip test, mutation-proven against a synthetic orphaned knob — chosen
  over a structural presence check because the export it would need,
  `pack-resolve.js`'s `FORWARDABLE_ARG_KEYS`, would push that file past 300/300, and the
  real-execution guard also catches argKey spelling mismatches a presence check would miss), plus a
  declaring comment at the `mcp-server.js` loop naming the test so it is never deleted as
  unreachable.
- [x] **resolveBench/resolveBenchInput parallel evolution** (`cli-handlers-council-run.js` /
  `mcp-council-run.js`) — CLI and MCP each hand-roll their own XOR-validation wrapper around the
  shared `resolveCouncilMembers`. Wave 2 unified the *dropped-members* signal between them via that
  shared core, but the two outer wrappers still evolve independently — same drift shape as T15-m5's
  paramMap divergence. Nothing wrong today; watch if one's validation rules change without the other
  following.
  — standing note v4.7 PR6: mirrored docblocks at src/cli-council-run-bench.js resolveBench and
  src/mcp-council-bench.js resolveBenchInput (the entry's file paths were stale — both were
  extracted in v4.6 Task 4b / v4.7 PR0)
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
- [x] **PR5F-2** — a bare `--out-dir` (no value) yields a directory literally named `true`.
  `cli-handlers-council-run.js:178-179` does `path.resolve(project, String(args['out-dir']))`
  with no dash-leading/non-string guard — the same R1/R5 class fixed for `-o/--out`, one flag over.
  Found during the v4.7 PR5 final-review consolidated wave, 2026-08-07.
  — done v4.7 PR6, but SPLIT: `--cwd` is guarded once at `bin/amicus.js` (16 consumer sites);
  council run's own valueless flags (`--out-dir`, `--claude-review`, `--run-id`, `--timeout`)
  guarded in-handler. The filed shape (B) was rejected — it would have turned
  `amicus models --check` into exit 1. Same valueless-value class also covers `df9c3e5`: a council
  PACK could set `options.timeout` to a boolean or a non-numeric string and reach `runCouncil`,
  because `pack-validate.js` checks option KEY names and never value types, and the old post-merge
  check was `args.timeout <= 0` (which `true` coerces to `1` and passes). Fixed alongside the CLI
  valueless-flag guards in the same PR.
- [x] **PR5F-3** — SR-3's metadata tmp-sweep behavior delta is untested: a symlink named like a tmp
  file now moves from *swept* (unlink removed the link, a safe success) to *silently ignored* (the
  new `lstatSync`-based directory exclusion also excludes symlinks). Sanctioned by the brief and
  consistent with the module's never-follow policy, but a real, untested behavior delta. Needs one
  test or one docblock line. Found during the v4.7 PR5 final-review consolidated wave, 2026-08-07.
  — done v4.7 PR6
- [x] **PR5F-4** — `session-index-tmp-sweep.js:37`'s comment cross-references
  `session-metadata-tmp-sweep.js:27-31` by line number; currently exact, but a rot risk the same
  class as T6-m2 above — a future edit to either file can silently invalidate the other's citation.
  Found during the v4.7 PR5 final-review consolidated wave, 2026-08-07.
  — done v4.7 PR6

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
  (`src/council/tally.js :: computeStreetCred`) — but is descriptive only: tiers are unweighted
  counts (`tally.js :: tally`'s basis loop, feeding `tally.js :: assignTier`; **was
  `tally.js:84-107`**) and the chair packet (`council/briefings-stage2.js`) presents seats
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
  street-cred with high/moderate/low badges — **four** surfaces now, not three: `council/report.js`
  (the neutral model), `council/report-md.js` (**new** — v4.8 Phase 1 T1.2 moved `renderMd` out of
  `report.js`; the Markdown street-cred table lives here), `council/report-html.js`, and
  `workspace/matrix-model.js` + seat painters; an efficiency panel — calls/tokens/cost vs what
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
- [ ] **GOA-7 · Feature · Recency decay in `deriveReliability`** — [M, independent]
  **The resolved-model prerequisite is DONE — v4.7 GOA-7 (D9/D10) and v4.8 PR4b.** Ledger rows now
  carry `resolvedModel` at `LEDGER_SCHEMA_VERSION` 2, `deriveReliability` groups by
  `row.resolvedModel || row.model` (`src/council/ledger.js`) and `buildLedgerRows` emits one row per
  distinct (model, resolvedModel) pair, so `council stats` no longer conflates different underlying
  models under one alias — the defect this item opened on (aliases silently retarget;
  `council-presets.js` documents `gpt-pro` → `gpt-5.6-sol-pro` and the `opus` re-pin, both
  2026-08-04). ⚠️ The old citation for the alias-join, `src/council/run-debate.js:135-137`, was
  wrong and is struck: those lines are the debate round's whole-round cost-ceiling prose and say
  nothing about the ledger join. The join lived in `buildLedgerRows` and nowhere else.
  **What remains is the decay half:** recency decay (or a last-K window) in `deriveReliability` so
  stale evidence fades, improved models get a path back in, and a retarget naturally resets an
  alias to `lowN` ⇒ scout treatment. ⚠️ `lowN` now follows `runs` = distinct runIds (v4.8 PR4b
  R4b-1), so a window must be defined over RUNS, not rows, or it will re-introduce the twin
  over-count the PR4b change removed. Note the seat-id ≠ model-id blocker recorded against
  self-ensemble seats (adoption notes §4.3) is also addressed — v4.8 PR1 minted seat identity.
- [ ] **GOA-8 · Feature · Shadow seat: zero-risk audition variant** — [M, needs GOA-1; alternative/complement to GOA-5]
  For benches where even one merit seat is too precious: the rookie's review IS included in the
  anonymized Stage-2 judge bundle (blind labels — judges can't tell), so it earns rankings,
  street-cred, and ledger rows at full fidelity, but its adjudication votes are EXCLUDED from
  tier bases and its findings are marked advisory in tally/report (never counted, never silently
  dropped — the announcement invariant applies). Costs one leg + marginally larger judge bundles;
  zero influence on the verdict. Design care: the tally already excludes a raiser's own votes
  (`peer-split.js :: peersOf`, called from `tally.js :: tally`; **was `tally.js:91-107`**, before
  v4.8 T-B1 lifted the predicate out) — shadow exclusion is the same shape, one filter earlier,
  and `runStats`
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
- [x] Bare-object candidate/suppression maps (`seen`/`reviewing`/`byRole` in the seats-panel dead
  logic) inherit `Object.prototype` keys — a model literally named `toString` would be silently
  suppressed. Pre-existing pattern, effectively unreachable; fix as one `Object.create(null)`
  family sweep, not piecemeal. — #108
  — done v4.7 PR6
- [x] Role `'claude'` is absent from `isReviewing`'s allowlist — unreachable today (claude is
  rejected as bench/chair/critic), but `isReviewing` is the single place to extend if that
  reservation ever loosens. — #108
  — standing note v4.7 PR6: extended the role-awareness comment above isReviewing
  (electron/workspace-ui/live-model.js)
- [x] Hidden dependency, documented in `deadSeats`'s docblock: recovered-critic suppression relies
  on `roleFor`'s critic branch, which the `--critic`/`--lenses` mutual exclusion keeps reachable —
  revisit if that exclusion ever loosens. — #108
  — standing note v4.7 PR6: already at the deadSeats docblock; stale citation corrected in the
  same commit
- [x] `--out -x` parser asymmetry: `--out -x` consumes `-x` as a value while `-o -x` yields boolean
  `true` — out of R1's scope (the valueless-flag fix); the parser itself is untouched. — #109
  — done v4.7 PR5
- [x] The metadata-tmp sweep reads `process.cwd()` directly instead of doctor's injected `getCwd`
  — revisit if a `doctor --cwd` mode ever lands. — #109
  — standing note v4.7 PR6: sessionsRoot() docblock in src/utils/session-metadata-tmp-sweep.js
- [x] A directory named like an orphan tmp file lands in the sweep's "unremovable" bucket via
  EISDIR (inherited from the session-index-tmp-sweep sibling; the throwing-unlink test pins
  never-crash, not a fix). — #109
  — done v4.7 PR5
- [x] Two `doctor` rows share message prose, disambiguated only by row name (deliberate
  byte-parallel with the sibling sweep; `fixDetail` strings differ). — #109
  — standing note v4.7 PR6: mirrored comments in src/utils/session-index-tmp-sweep.js
  (evaluateSessionIndexTmpSweep) and src/utils/session-metadata-tmp-sweep.js
  (evaluateSessionMetadataTmpSweep)
- [x] No combined `overwritten`+`shadowsBuiltin` human-render test for `council save` (hand-traced
  correct; the `--json` compose case is covered). — #109
  — done v4.7 PR4
- [x] The registry pre-check's two body greps (version, status) scan independently — sound for a
  single-version endpoint, revisit if the registry ever returns collections. — #110
  — standing note v4.7 PR6: comment block in .github/workflows/publish.yml, above VERSION_RE
- [x] The version grep's BRE dots are unescaped (false-match direction is fail-toward-skip, not
  real-world exploitable, but worth tightening). — #110
  — done v4.7 PR5
- [x] `run-chair.js`'s `ch4` still carries the same duplicated-literal pair (`:186`/`:192`) that
  `ch1`–`ch3` were converged out of — out of PR4's scope, filed. — #110
  — done v4.7 PR5
- [x] The 3-file second-layer `base` duplicate in the doctor suites (optional further
  `makeBaseDeps()` consolidation beyond this sweep's pass). — #110
  — done v4.7 PR4
- [x] `doctor-local-providers`'s preserved `env` omission is comment-marked as deliberate — revisit
  if it ever drifts unnoticed. — #110
  — standing note v4.7 PR6: tests/helpers/doctor-base-deps.js:34-38, alongside the pre-existing
  getLocalProviders/probeLocalProvider omission note
- [x] `makeBaseDeps()`'s new test helper sits outside the `src/`/`electron/` lint gates (manually
  linted clean today; no automated enforcement). — #110
  — done v4.7 PR4
- [x] The README's "sixteen tools" count is unpinned prose — owner call on whether to pin it to a
  generated count or leave it deliberately count-neutral. — #110
  — done v4.7 PR4 (R6 count-neutral)

## v4.7 PR1 findings (2026-08-06)

- [ ] **Duplicated aliases in `--models`/council presets can yield two primary rows for one
  seat** — [S, needs a product decision] `parseModelsList` (`src/sidecar/fanout-validate.js:22`)
  allows duplicate aliases by design (its own docstring: "duplicates allowed"), and council
  callers pass the parsed list through unchecked. Both `lensIndexOf`
  (`src/council/run-retry-group.js:16` — this entry said `run-retry.js:24`; the function left that
  file at PR0, re-measured 2026-08-17 — via `o.models.indexOf(model)`) and `roleFor`
  (`src/council/run-stages.js:35`, via `o.models.indexOf(alias)`) resolve a duplicated alias by
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
  names (`debate.js :: mk`, **was `debate.js:102-109`**), and the real hazard is **key order** (not
  `findingsUnverified`): `JSON.stringify` preserves insertion order, so unification changes
  `run.json` bytes for every debate row carrying a `waveId`, and the existing `toEqual`/
  `toMatchObject` pins are order-insensitive and would not catch it. Also `mk`'s
  `l.status || 'unknown'` vs `buildRunStatsEntry`'s `leg ? leg.status : 'error'` diverge. Correct
  shape needs `buildRunStatsEntry` extracted to a **pure** module (`debate.js` is declared DI-free
  with zero requires). Stays deferred to its own TDD pass, as originally filed.

- [x] **Conformance drift between producers of the same non-primary role** — **DONE, v4.9 W1
  (2026-08-25, ruling V18):** both repair-loop pushes (`run-stages.js :: runStage1`,
  `run-stage2.js :: runStage2`) passed an explicit `conformance: 'unstructured'` — the flat
  literal this entry's design call named, chosen because `res.ok`/`parsed.ok` are provably false
  at each push. The `|| 'clean'` default was NOT flipped (the two primary error-row sites,
  `run-finish.js :: finishRun` and `run-stage1-rows.js :: pushDeadSeatRows`, depend on it), and
  the rows are pinned by behavior tests including two every-row pins.
  — refined 2026-08-25 (council D1 on PR 199): the flat literal misdescribed SUCCESSFUL repair
  legs — at the push, the false `res.ok`/`parsed.ok` was the PRE-repair validation, not the
  repair's own outcome. Per this filing's other alternative, all three `buildRunStatsEntry`
  repair pushes (the
  two loops plus `run-chair.js`'s ch4 push, which had been taking the `'clean'` default —
  debate's `mk('repair')` rows are a fourth, separate producer, already correct: debate emits
  repair rows only for failed repairs, stamped `'unstructured'` at the call sites) now push
  AFTER the re-validation/re-parse and stamp the measured value: `'clean'` when the repair leg's
  own output parsed, `'unstructured'` when it did not. Failed-repair rows still read
  `'unstructured'`; the primary rows' `'repaired'` state is unchanged. Original filing:
  [S, defer-with-record]
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

- [x] **The dead-seat retry-reason text ("did not review — retried once") has no terminal-path
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
  production call site (`workspace-seats.js:127`, `var retried = retriedSeats(deg);` — **was
  cited `:47`, which is a docblock line; the function itself is `:73`**), not two, and the
  live-tick path never goes
  through `seatsFromRunStats` at all — so the fix is terminal-path-only. Line budget:
  `live-model.js` is 284/300 and the honest implementation is +20-30, so it needs the helper to
  land in `workspace-seats.js` (132) instead. Deferred to PR6.
  — recon 2026-08-08: dropping the `=== 'error'` gate is confirmed right. Still needs an owner
  ruling on the rendering surface (status-cell suffix vs. a separate marker), and the helper must
  land in `workspace-seats.js` (132/300 by the gate's own arithmetic), not `live-model.js`.
  Deferred to PR7.
  — done v4.7 PR7 (Task 8). **Owner ruling: the seats table's existing unlabeled trailing flag
  column** (`index.html:51`'s final empty `<th></th>`, which carries `⏳ stalled` on the live path
  and is always empty on this terminal path since `seatsFromRunStats` hardcodes `stalled: false`)
  — not a status-cell suffix. Motivating case: a dead seat's primary row can legitimately carry
  `status: 'complete'` (proven end to end by driving the real `runStage1` with a leg returning
  `status:'complete', summary:'   '`); a suffix would render "complete — retried once", which reads
  as "it finished, twice". The column instead gets `↻ retried once` plus a `seat-retried` row
  class. The predicate (`retriedAliases` in `workspace-seats.js`) deliberately mirrors
  `window.AmicusLive.deadSeats`' own filter verbatim: the `kind`/`channel` gate is load-bearing
  (a `kind:'heal'`/`channel:'stage1-retry'` degrade carries the SAME `retryWaveId`/`firstFailure`
  fields for a seat that RECOVERED, so a field-only scan would mislabel it "retried once"), and
  `firstFailure` is read for truthiness only, never `.status` (its wave-class shape has no
  `status` key). `workspace-seats.js` 132 → 188/300.

## v4.7 PR7 dispositions filed, not fixed (2026-08-08)

- [ ] **W1-M4's raw-vs-rendered briefing divergence also applies to `amicus_start`, not just
  `amicus_fanout`** — [S] `src/mcp-server.js:669` writes the shared-server spawn-fallback child's
  `briefing.md` from `input.prompt` directly — the identical divergence Task 7 fixed for
  `amicus_fanout` (raw, not rendered, until the child's own later render, so a child that dies
  before that point leaves a permanently-wrong `--search` corpus). Deliberately excluded from PR7:
  nobody has executed the `amicus_start` spawn-fallback half of W1-M4 end to end, so there is no
  verified reproduction to fix against, unlike the fanout path Task 7 closed. The fix shape should
  be the same one Task 7 shipped (write `fwd.renderedPrompt` to `briefing.md`, the raw prompt to a
  sibling `briefing-input.md` for the child) once someone has actually driven this path. Found
  during the v4.7 PR7 final-review consolidated wave, 2026-08-08.

- [ ] **A seat that recovered via retry has no marker of its own — only the seat that stayed dead
  does** — [S] PR1F-4 (v4.7 PR7) marks a seat `↻ retried once` when its degrade record carries
  `kind:'degrade'` / `channel: 'dead-leg'|'dead-wave'` with a `retryWaveId`/`firstFailure` — and
  deliberately excludes `kind:'heal'` / `channel:'stage1-retry'` records, because those mean the
  seat recovered and PR1F-4's marker is not meant for it. That exclusion is correct for PR1F-4's
  own scope, but it leaves the recovered case with no marker at all: a seat that failed once, was
  retried, and came back clean today renders identically to a seat that never failed. Whether a
  healed seat should carry its own distinct marker (e.g. `✓ healed`) is a new design question, not
  a re-opening of PR1F-4 — a different predicate, a different column or cell, a different owner
  ruling. Found during the v4.7 PR7 final-review consolidated wave, 2026-08-08.

- [ ] **The retry marker (PR1F-4) only renders on the terminal path — the live-tick path never
  gets it** — [S] `retriedAliases`/`isReviewingRole` live in `workspace-seats.js`'s
  `renderSeatsPanel`, which reads `seatsFromRunStats`' terminal-composed rows. The live-tick path
  (mid-run polling) never goes through `seatsFromRunStats` at all, so a seat retried while its run
  is still in progress shows no marker until the run finishes and the panel re-renders from the
  terminal doc. Accepted as terminal-path-only for PR7 (recon 2026-08-07/08 already established
  there is exactly one production call site, `workspace-seats.js:127` — **was `:47`**); threading the retry set
  through the composed live doc so the live path can see it too is a data-layer change, not a
  render-layer one — a different task. Found during the v4.7 PR7 final-review consolidated wave,
  2026-08-08.

- [ ] **`session-index-tmp-sweep.js` follows symlinks (`statSync`) where its sibling
  `session-metadata-tmp-sweep.js` deliberately does not (`lstatSync`)** — [S] Confirmed via grep:
  this divergence has **zero** prior BACKLOG entries under `statSync` (PR5F-3 filed the
  `lstatSync`-side consequence — a symlink is excluded by the metadata sweep's `isFile()` gate, not
  swept — but never the index sweep's opposite choice). Two deltas, both now recorded in the source
  comment at `session-index-tmp-sweep.js:37-41` (2026-08-08 owner ruling, Option B: keep `statSync`,
  state the policy instead of calling it "unreviewed"):
  - **The inclusion delta** — a symlink named like an orphaned tmp file (e.g.
    `.sessions-index.json.<pid>.<hex>.tmp`) IS still swept on this side, because `statSync` follows
    the link to the target's stat, and the target passes `isFile()`. On the metadata sweep the
    identical case is excluded entirely (SR-3's `isFile()` gate over `lstatSync` sees the link
    itself, never a file).
  - **The unfiled delta** — `AGE_THRESHOLD_MS` is evaluated against the **target's** mtime (because
    `statSync` follows), not the link's own mtime: a freshly-created link pointing at an old file is
    swept immediately, with no 60-second grace window, unlike a genuine same-age orphan tmp file.
    Not harmful: `unlinkSessionIndexTmp` calls `fs.unlinkSync`, which removes only the link, never
    the target, and a dangling symlink (target gone) is already excluded upstream by the same
    `isFile()` gate the sweep shares with its sibling. Cannot be exercised on this machine —
    `fs.symlinkSync` raises `EPERM` here (verified 2026-08-08) — so any future test of this path
    must fake `fs.statSync`/`fs.lstatSync` rather than create a real symlink.
  Found during the v4.7 PR7 final-review consolidated wave, 2026-08-08.

## v4.7 PR3 rider follow-ups (2026-08-07)

- [x] **`sessions-index.json` has no maintenance step — it only ever grows** — **DONE — v4.8 Wave
  2.5 (2026-08-22, ruling R16/T-R16.1, `0a6a8032`).** ⚠️ **That hash is a dangling pre-squash
  branch commit (v4.9 kickoff refute pass, 2026-08-25: `merge-base --is-ancestor` exits 1; no
  branch or tag contains it). The commit on `main` is `dda1b8cf`, the squash of PR #187.** This
  repo mixes true merges and squashes — verify ancestry per hash, never inherit one from a DONE
  record. [M, needs a design
  decision] `recordSession` (`src/utils/session-index.js:64`) appends a `taskId -> project` entry on
  every session start and **nothing ever removes one**. Entries outlive their subject: a project that
  is deleted, renamed, or moved leaves its rows behind forever, and the index has no TTL, cap, or
  prune. Measured on the dev machine 2026-08-07 before the manual cleanup: **18,874 entries, 0.69 MB,
  of which 5,933 (31.4%) pointed at project paths that no longer existed.**

  Two live costs, both measured:
  - **Every session start pays for the whole file.** `recordSession` does a full
    read → `JSON.parse` → mutate → `JSON.stringify` → atomic write of the ENTIRE index. At 18,874
    entries that is ~5.7 ms of pure parse/serialize plus a **0.69 MB write, on every single start**.
    It is `O(total sessions ever)` per launch, not `O(1)`.
  - **`--all` walks all of it.** `enumerateAllProjects` (`src/sidecar/read.js:94`) reads every
    distinct project in the index. The dead 31.4% cost a `readdirSync` probe each and contribute
    nothing. `amicus list --all` measured 21,145 rows in 8,275 ms; after a manual prune to 187
    entries, 132 rows in 53 ms.

  **Note on provenance, so this is not mis-scoped:** the *bulk* of that particular index was test
  residue from the `/tmp` hermeticity leak, and PR #123 sealed that generator — a fresh index will
  not balloon the same way. This item is the **remaining structural gap**: even with zero test
  residue, a real user's index accrues dead entries as projects come and go, and pays the growing
  per-start write cost forever. The leak made it visible; it is not the whole of it.

  **Design options** (pick at plan time, not here):
  1. **A `doctor` check + `--fix`** — the natural home, and there is an exact precedent:
     `src/utils/session-index-tmp-sweep.js` is already a doctor check with `--fix` operating on this
     very file (orphaned tmp files rather than stale entries). A sibling "N stale index entries — run
     with `--fix`" check would reuse the whole warn/fix/hint shape, and keeps pruning **explicit and
     announced** rather than silent, per the degrade-announcement invariant.
  2. **Prune on write** — drop dead entries during `recordSession`. Cheapest to reach, but it would
     add a `statSync` per entry to the hot start path (worse than the problem at 18k entries) and
     deletes user-visible state with no announcement. Would need a sampling/amortization scheme.
  3. **Cap + LRU eviction** — bound the file outright. Simplest cost story, but the index is an
     advisory *lookup* aid (`safeSessionDir`'s cross-project fallback, #40), so evicting a live
     entry silently degrades `amicus read <id>` from another project into a not-found.

  Recommend option 1: it is announced, it is user-triggered, it reuses an existing surface, and it
  cannot silently lose a lookup. Note that a prune must be **liveness-based, not age-based** — a
  five-year-old session in a project that still exists is still a valid lookup target, while a
  one-day-old entry for a deleted project is not. Found while measuring the `--all` output-cap rider
  during the v4.7 PR3 rider follow-ups, 2026-08-07.

  ✅ **Shipped — option 1 (a `doctor` check + `--fix`), exactly as recommended above.** New module
  `src/utils/session-index-prune.js` (221/300 lines), mirroring `session-index-tmp-sweep.js`'s
  warn/fix/hint shape, wired into `src/cli-handlers-doctor.js` beside that sibling — which this
  change takes to 299/300 (see the dedicated entry below). Tests in
  `tests/doctor-index-prune.test.js`, 21 tests. Named mutant `STALEKEEP` (`projectExists` forced to
  unconditionally report every project live): red set **5 tests, all in that one file**, nothing
  else in the 545-suite tree — reproduced independently at full `npx jest --no-coverage` scope by
  both the implementer and, separately, review.

  ⚠️ **Test count corrected 2026-08-22 (council R16 fix round 2, A1) — the `21 tests` above was
  accurate when written, then falsified by the first fix round.** At the shipping commit
  (`a6e8f4b3`) the file had 18 `it`/`test` declarations, which jest expands to 21 — true at the
  time. The first council fix round (A1/A4 + A2/A3 there, commit `cf35bd9a`) added tests and took
  the file to 26 declarations (25 single `test()` calls plus one `test.each` of 3), which jest
  expands to **28** — verified directly with `npx jest tests/doctor-index-prune.test.js
  --no-coverage` (`Tests: 28 passed, 28 total`), not just by counting declarations. Stated as the
  jest **runtime** count beside the **declaration** count on purpose, so the next `test.each`
  addition cannot make this line ambiguous again. A paid council's own figure of **33** for this
  same count, raised in the second fix round, is wrong — do not adopt it.

  Two judgment calls, both matching rulings R16-2/R16-3:
  - **Liveness only, never age.** No TTL, no mtime sort — zero hits grepping the new module for
    mtime/TTL/age. Its `sessions-index-tmp` sibling carries an `AGE_THRESHOLD_MS` (60 s, so a live
    writer's ms-lived tmp file is never swept) for a reason that does **not** apply here and was
    deliberately not copied: age-gating a *lookup* entry the way the sibling age-gates a *tmp file*
    would delete valid targets, not just clutter.
  - **Only `ENOENT`/`ENOTDIR` mean "confirmed gone."** `EACCES`/`EPERM`/`EIO`/`EBUSY`/`ETIMEDOUT`/an
    unknown or missing error code/a raw non-Error throw all mean "cannot confirm," so the entry is
    treated as **live** — verified by injecting each, zero crashes. Mirrors the ENOENT-only split
    `workspace/artifact-guard.js :: readRunArtifact` already uses for the identical ambiguity (its
    RN-10 fix, `:106-121`). Getting this backwards deletes a real entry on a permissions blip.
  - **Probes distinct projects, not entries (R16-3).** Measured: a 2000-entry index sharing 7
    distinct projects makes exactly **7** `statSync` calls, not 2000 — `O(distinct projects)`,
    confirmed by execution, not argued.

  ⚠️ **Scope the claim honestly — do not quote 18,874 as an expected steady state.** What shipped
  closes the **structural** gap, not the headline numbers measured above: the bulk of that
  18,874-entry / 31.4%-dead index was test residue from the `/tmp` hermeticity leak PR #123 already
  sealed, so a fresh index will not balloon the same way. A real user's index still accrues dead
  entries as projects come and go, each one paying into the per-start write cost forever; this
  check makes that accrual visible and removable via `--fix`, announced rather than silent, but
  running it is still on the user — nothing prunes automatically.

  **R16-4 reconfirmed during implementation, not just inherited:** the owner-rulings table's *"pin
  all 13 unpinned rails"* phrase was re-grepped against the tree at T-R16.1 and still appears
  nowhere but that one table row and the docs already annotating it as unsourced. Scope was always
  this entry, never that wording — recorded again here so a future reader does not go looking for
  an enumerated set of 13 that was never written down.

  Filed, not fixed here:
  - `cli-handlers-doctor.js` reached 299/300 by this change, added inline rather than extracted,
    breaking that file's own established precedent — full detail in the dedicated entry below.
  - The plan's "relative path" half of its `EACCES` warning (*"a relative or unreadable path is
    not the same as a deleted one"*) is **reasoned closed, not measured closed**. Every explicit or
    client-supplied path into `mcp-server.js :: getProjectDir`/`resolveProjectDir` is gated through
    `project-root-allowlist.js :: isAllowedProjectRoot`, which requires a prefix match against an
    absolute root (`homedir`/`cwd`/`tmpdir`/env) — `canonicalProjectPath` never resolves a relative
    string to absolute, so a bare relative path structurally cannot satisfy that gate. But
    `session-manager.js:127`'s `metadata.project || projectDir` — the actual write path into
    `sessions-index.json` — was not traced to its own origin. Open, not exhaustively verified.

- [ ] **Council runs are invisible to CLI `amicus list` — MCP-only, by omission** — [S] The MCP
  `amicus_list` merges council runs as first-class rows (`src/mcp-server.js:1003`,
  `.concat(councilRows)` with `type: 'council-run'`); the CLI `listSidecars`
  (`src/sidecar/read.js:133`) never calls `listCouncilRuns` at all. So `amicus council run …`
  produces a run that `amicus list` cannot see — the launching surface and the listing surface
  disagree about what exists. Documented as a deliberate divergence under errata E-PR3-3 (D14
  unified the *enumeration*, not the council merge), so this is a scope note, not a regression.

  Cheap to close: `listCouncilRuns` (`src/mcp-council-awareness.js:205`) has **no MCP-specific
  coupling** — it is pure pointer enumeration + `runState.readRun`, already fenced with
  `containsOnDisk` per pointer. Two real decisions, not just a wiring job:
  - It bakes in `sanitizePreview(briefing, 80)`, an MCP-side decoration. E-PR3-3 ruled enrichment
    stays MCP-side, and the CLI truncates to 30 chars in its own table — so either the preview width
    moves to a parameter, or the CLI re-truncates a value already truncated to 80 (lossy but
    harmless at 30).
  - Council rows carry `model: null` and a `stage` field the CLI table has no column for. The MODEL
    cell would render empty today (`read.js`'s `s.type === 'wave' ? … : (s.model || '')`); it wants a
    `council(<stage>)` cell mirroring the existing `wave(N legs)` treatment.

  Found during the v4.7 PR3 rider transcription, 2026-08-07.

- [ ] **`continue`/`resume` sessions always group under `(unattributed)` in `spend --group-by tag`**
  — [S] `src/cli-handlers-resume-continue.js` has **zero** `tag` references: a follow-up session
  never carries one, so its spend rows land at `rowKey`'s null fallback
  (`src/spend-query.js:58`, `case 'tag': return row.tag || '(unattributed)'`). The practical effect
  is that tag-based cost attribution silently under-reports: tag a session, continue it three times,
  and only the first launch's cost is attributed to the tag while the follow-ups — the same work,
  the same intent — scatter into `(unattributed)`.

  The parent's tag **is already on disk**: D13 stores it absent-not-null on the session's
  `metadata.json`, and both handlers already resolve a validated parent `taskId` (`:24` resume,
  `:54` continue), so the inherit is a metadata read away. The open question is policy, not
  plumbing: does a follow-up **inherit** the parent's tag silently, or should `continue`/`resume`
  accept their own `--tag` (and if so, does an explicit tag override, or is the combination rejected
  the way `--tag` + `--retry-failed` is)? Inheriting silently is the behavior that makes the grouping
  honest; accepting an explicit tag is the behavior that matches every other launch surface. Decide
  before implementing. Found during the v4.7 PR3 rider transcription, 2026-08-07.

- [ ] **`--tag` + `--retry-failed` is rejected rather than inherited** — [S] `handleFanout`
  (`src/cli-handlers-fanout.js:26`) fails the combination with `BAD_ARGS`
  (`--tag cannot be combined with --retry-failed`). That was the right call for D13 — a retry is not
  a new labelling opportunity, and silently accepting a tag that then applied to only some legs would
  be worse. But the consequence is that **a retry of a tagged wave produces untagged rows**: the
  retry's legs drop out of the tag's cost rollup even though they are that tagged wave's own work —
  the same under-reporting shape as the `continue`/`resume` item above.

  The fix is nearly free and strictly better than the current rejection: `buildRetryPlan`
  (`src/sidecar/fanout-retry.js:46-52`) **already reads the original wave's `metadata.json`** into
  `waveMeta` for its type/status guards — the tag is sitting right there under D13's absent-not-null
  storage. Inheriting `waveMeta.tag` onto the retry wave keeps the flag rejection exactly as-is (you
  still cannot *set* a tag on a retry) while making the retry inherit the one it belongs to. Worth
  pairing with the `continue`/`resume` decision above, so the whole "derived launches inherit their
  parent's tag" question is settled once, in one policy, rather than three times. Found during the
  v4.7 PR3 rider transcription, 2026-08-07.

## v4.7 docs PR — filed, not shipped (2026-08-08)

**Provenance.** Entry text below is carried over from `.superpowers/sdd/v47-docs-recon-report.md`
§ 5 (F-1 … F-6, "FILE, do not ship") and § 7 (UNVERIFIED), which lives in the main clone, not this
worktree. Every item was **deliberately excluded from the v4.7 docs PR** — none of them is a
documentation gap, so none belongs in a docs-only change. Recorded here so the reasoning travels
with the repo and nobody re-derives (or re-argues) the exclusion next rev.

- [ ] **F-1 · Gate hardening: pin MCP tool parameters** — Add an `it` to
  `tests/docs-command-coverage.test.js` that `require()`s `getTools()`, collects every top-level
  `inputSchema` key per tool, and asserts each appears in `docs/usage.md`'s MCP section. Today only
  tool *names* are derived from `src/mcp-tools.js` (`docs-command-coverage.test.js:11`); parameters
  are pinned nowhere, which is how v4.7's `tag`/`search` params and the widened
  `amicus_list.status` could have shipped undocumented with a green suite. They happen to be
  documented already — this makes it self-gating for future revs. Expect some red on landing.
  **Excluded because:** it is test infrastructure, not documentation — refuted as a doc gap
  (GATE-3) once verified that the current params are, in fact, documented.

- [ ] **F-2 · Gate hardening: derive the README command list from `bin/amicus.js`** —
  `tests/docs-command-coverage.test.js:13` and `:27–30` pin 5 and 4 *literal* command names against
  21 real `case '<cmd>'` labels in `bin/amicus.js` (lines 134–212). Replace both `it.each` arrays
  with a list scraped from those labels — the same trick already used one line below for MCP tool
  names. All 21 commands are currently documented (verified at `b365e03`), so this should land
  green. **Excluded because:** refuted as a doc gap (GATE-4) — every one of the 16 ungated commands
  already has README/usage.md coverage; this is test-code hardening against future drift, not a
  fix for a present gap.

- [ ] **F-3 · Gate hardening: run `generate-docs --check` in CI or jest** — No CI job and no jest
  test runs `scripts/generate-docs.js --check` against the real `CLAUDE.md`; marker freshness rests
  entirely on the self-healing `.husky/pre-commit` hook, so a `--no-verify` commit can land stale
  AUTO blocks or a broken cross-link. Add ~15 lines of jest calling
  `buildDirectoryTree`/`buildModuleIndex` against the repo root plus `checkMarkersAreCurrent` and
  `validateCrossLinks` over the real `CLAUDE.md`. It passes today
  (`node scripts/validate-docs.js --full` → "All markers are current."), so it lands green.
  **Excluded because:** refuted as a doc gap (GATE-5) — no doc anywhere claims CI enforces marker
  freshness, so nothing is factually wrong today; the residual exposure is a `--no-verify` commit,
  and closing it is a test-hardening task, not a docs fix.

- [ ] **F-4 · Dead code: `validate-docs.js`'s drift-comparison helpers** — `extractSection`,
  `findFilesInSection` and `checkDrift` in `scripts/validate-docs.js` (defined at `:35`, `:68`,
  `:84`) are exported and unit-tested but called by **no** execution path — `--full` only
  `execFileSync`s `generate-docs.js --check`. Either wire the comparison up or delete the three
  functions and their `CONFIG.mappings`. **Excluded because:** code hygiene, not docs (refuted as
  GATE-2) — the file's own JSDoc at `:113–116` already accurately describes the delegation, so
  there is no doc to correct.

- [ ] **F-5 · Document the `routing.tier` cost-tier config surface** — [M] `routing.tier` and
  `routing.tier_onboarded` (`src/utils/config.js :: hasTierOnboarded` · `:: markTierOnboarded` ·
  `:: getCostTier` · `:: setCostTier` — re-anchored BY SYMBOL 2026-08-23, NOT renumbered: the old
  `:543–599` was exact when taken and rotted when v4.8 SI-22.4 added net **+37** lines above it in
  the same file, moving `hasTierOnboarded` 543→580 and `setCostTier` 592→629. Counting rule: file
  length 629→666 lines, BASE `ecf90f19` → HEAD, and the `function` def lines re-read in both trees.
  ⚠️ Nothing caught this — `check:citations` does not scan the doc tree at all) are read by the cost-aware default
  picker and appear in no user doc; `tests/where-things-live-docs.test.js:65–74` does not pin them.
  Shipped in **v3.2.0** (`git log -S setCostTier` → `8aa5d6f`), so this is a four-rev-old hole.
  **Excluded because:** closing it means documenting the whole cost-tier feature end to end — an
  M-sized doc-writing task, not the one- to five-line corrections that make up the v4.7 docs PR's
  "S" line. (Not comparable to that PR's new **Cost gate** section: `maxCostPerMtok`/`maxCost` are
  two standalone thresholds with a default and an override order, describable in a short
  subsection. `routing.tier`/`tier_onboarded` are *state* belonging to the cost-aware default
  picker, and are meaningless to a reader who has not first been told what that picker is, when it
  runs, and what the tiers mean.)

- [ ] **F-6 · Generalise the council TOC/link gates to the rest of `docs/`** — Relative cross-links
  and in-page anchors are validated only inside `CLAUDE.md` (by `generate-docs --check`, itself
  un-run in CI — see F-3) and inside `docs/council.md` (by `tests/docs-council-toc-anchors.test.js`).
  README and the other 14 `docs/*.md` files are ungated. Both were manually swept clean at
  `b365e03`, so this is latent, not live. Generalising the council TOC test to all of `docs/` is
  ~20 lines. **Excluded because:** it is a test-hardening task against a currently-clean tree, not
  a fix for a present broken link or anchor.

**Rider — two recon items verified by reading, not by observation** (from
`v47-docs-recon-report.md` § 7, UNVERIFIED). Neither blocks the PR; both are noted so any future
doc wording that hardens these claims into absolutes has a cheap verification path to follow first.

- [ ] **`fanout --quiet` end-to-end output suppression was verified by reading, not by launching a
  real wave.** The flag's plumbing was confirmed by reading
  `src/cli-handlers-fanout.js:157–159` → `src/sidecar/fanout.js:75/103/173/248/261/270`, and its
  absence from `amicus fanout --help` was confirmed by execution. Nobody launched a real wave to
  watch the banner and per-leg progress lines not print, because that spends money. **To close:**
  one `fanout --quiet` run against a local/free provider leg, or a unit test asserting
  `runFanout({quiet:true})` writes nothing to stdout. Do this before wording any doc row as an
  absolute ("suppresses the launch banner **and** per-leg progress lines") — until then, prefer the
  softer "suppresses the launch banner and per-leg progress output."

- [ ] **The `(unattributed)` consequence of tag non-inheritance was traced through code, not
  observed in a real ledger.** The path `continue.js:274–277` → `spend-ledger.js:94` →
  `spend-query.js:58` was read, not exercised. **To close:** `amicus start --tag x`, then `amicus
  continue`, then `amicus spend --group-by tag`, and confirm the continue row lands under
  `(unattributed)`. ~2 minutes and one cheap leg — worth doing since this is the v4.7 docs PR's
  headline sentence (MUST-1).

## v4.7.1 + v4.8.0 — release split (ruled 2026-08-09)

**Shape ruled by Christian, 2026-08-09:** ship **v4.7.1** small and soon (fixes and test hardening
only, zero new surface), and take everything else as **v4.8.0** rather than a second patch. An
intermediate "v4.7.2" was scoped and dropped: several of its items add user-visible surface — a new
doctor check, a new degrade kind, new `runStats`/`run.json` fields, new `amicus list` rows — which
is minor-bump material wearing a patch number.

**Provenance.** Filed after a validation pass over all 8 open issues (#129, #130, #133, #134–#138)
plus a sweep of this file's v4.7 sections, 2026-08-08/09. Every file:line citation below was
verified against `main` @ `caf4d7e` (v4.7.0), suite green at 507 suites / 6883 passed / 8 skipped.

**Stale entries retired by that sweep — do not re-file:**
- `backlog-picklist.md` PULL-FORWARDs **B02, B03, B27 are all already resolved.** B27's
  second-opinion frontmatter measures **1016/1024** (was 1441); B03's untrusted-output fence now
  spans 8 files (was "1 of 4+ channels"); B02's hardcoded `--client cowork` is gone from the spawn
  paths. That picklist is historical — it also still lists B22/B24 (council presets, spend
  tracking), both shipped.
- The `session-index-tmp-sweep.js` `statSync`/`lstatSync` divergence is **closed** by the
  2026-08-08 Option B owner ruling, already recorded in that file's own source comment.

### The seven rulings, with rationale

| # | Decision | Ruling | Rationale |
|---|---|---|---|
| 1 | `opencode-ai` constraint | **Pin exact `1.18.15`** | `^1.2.20` spans 1.2.20 → <2.0.0 — that width is *how* npx cached 1.17.3 against a global 1.18.15 (#133). An exact pin means a stale cached copy no longer satisfies the range, forcing re-resolution. Cost: opencode patches need a deliberate bump; the release recipe already has a version-pin step. |
| 2 | Derived-launch tags | **Inherit, no new flags** | Makes `spend --group-by tag` honest without adding CLI surface, so it stays patch-legal. `--tag` stays rejected on `--retry-failed` exactly as D13 ruled; continue/resume gain no flag. |
| 3 | Doc gates | **F-2, F-3, F-6 only** | All three are documented as landing green. F-1 explicitly expects red, so it would import doc-writing of unknown volume into a patch → deferred to v4.8.0. |
| 4 | Duplicate aliases (PR1F-1) | ~~Reject at the resolvers~~ **SUPERSEDED** | Ruled "reject" before #137 was read. Rejection was only ever a stopgap for the window before seat identity existed; with #137 in the same release there is no window. See v4.8.0 § Seat identity. |
| 5 | Council rows in `amicus list` | **`council(<stage>)` in MODEL** | Mirrors the existing `wave(N legs)` treatment — that column is already "what kind of thing is this", not strictly a model id. No new column, so nothing changes for non-council rows. |
| 6 | Briefing preview width | **Re-truncate 80 → 30** | Proven a no-op, not merely "harmless": `sanitizePreview` appends `…` only past the cap, so at a 30-char cut the ellipsis is never in range and `sanitizePreview(t,80).slice(0,30) === collapsed.slice(0,30)` in both branches. MCP path stays byte-identical; honours E-PR3-3. |
| 7 | #130 scope | ~~Detect + degrade + ledger skip~~ **SUPERSEDED** | Was a patch-boundary call. #134 requires the TASK MODE declaration regardless, so v4.8.0 takes the full treatment rather than the detection half. |

## v4.7.1 — the diagnostics stop lying — ✅ SHIPPED v4.7.1, 2026-08-09

Every item is a fix or test hardening. No new flags, no new checks, no new output.

- [x] **Version-aware `doctor` engine check** (#133). `engine-install-scan.js:135` sets
  `engineOk: !!hasOpencodeBinary({pkgDir})` — a **presence boolean**, and the install record
  (`{kind,pkgDir,engineOk,roots}`) carries **no version field to compare**. So
  `doctor-engine-check.js:53` emits "engine present in N npx-cache copy" and reports **ok** through
  a total outage. Add a version to the scan record and fail loudly on skew across copies.
  Receivers have room: `doctor-engine-check.js` 115/300, `engine-install-scan.js` 142/300.
  ⚠️ The check was built for bug report #1 (binary missing / AV quarantine) — a *presence* failure.
  Version skew is a different class it was never designed to see.
- [x] **Pin `opencode-ai` to `1.18.15`** (#133, ruling 1). `package.json` only.
- [x] **Escalate the backstop 2× on retry** (#129). `run-retry.js`'s `common` object (`:169`) lists
  12 fields with **no `noOutputBackstopMs` and no `agent`**, so the once-only SL-2 retry re-runs
  under identical conditions and is *structurally unable* to heal a latency failure.
  ⚠️ Honest scope, two files not one: `run-launch.js`'s `launchWave`/`launchSolo` build an
  **explicit field allowlist** (no `...opts` spread), so the field must be added there too,
  spread-guarded — exactly the shape `tag: opts.tag` shipped in v4.7 F8 D16. Council never sets the
  value today, so the retry resolves it itself. `fanout.js` needs **no edit**: it already forwards
  `noOutputBackstopMs` at `:272`. Headroom: `run-launch.js` 215/300, `run-retry.js` 283/300.
  ⚠️ **Those two numbers are a `v4.7.0` reading — measured at T-A8 against the tag, they are exactly
  `v4.7.0`'s 215 and 283, so they were TRUE when this item was planned and were simply undated.**
  Today (2026-08-17): `run-launch.js` **244**, `run-retry.js` **295/300 — five free lines**.
- [x] **Reword the backstop message** (#129 + #133, both flag the same string). `headless.js:485`
  asserts "— likely a listed-but-not-serving model or a dead endpoint": a canned guess with no
  evidence gate, fired identically from both firing sites. All the mechanism knows is "zero
  substantive activity by the deadline". Report that neutrally and **name
  `AMICUS_NO_OUTPUT_BACKSTOP_MS` in the message itself**. Highest value-per-line in the release —
  this string is what sent 30 minutes of #133's debugging at model ids and API keys.
- [x] **`continue`/`resume` inherit the parent's tag** (ruling 2). Parent tag is already on disk
  (D13, absent-not-null on `metadata.json`) and both handlers already resolve a validated parent
  `taskId` (`:24` resume, `:54` continue). ⚠️ **Gate risk:** `src/sidecar/continue.js` is at
  **297/300** and is where the spend row is written, so the tag has to reach it. Three lines will
  not hold a metadata read plus pass-through — extract first or keep the diff surgical.
- [x] **`--retry-failed` inherits the wave's tag** (ruling 2). `buildRetryPlan`
  (`fanout-retry.js:46-52`, 208/300) **already reads** the original wave's `metadata.json` into
  `waveMeta`. Keeps the `--tag` + `--retry-failed` rejection exactly as-is — you still cannot *set*
  a tag on a retry, it just inherits the one it belongs to. `fanout.js` needs no edit: the
  `tag: options.tag || metaTag` inherit machinery is already at all three `buildWaveResult` sites.
- [x] **F-4 — delete dead code.** `extractSection`, `findFilesInSection`, `checkDrift` in
  `scripts/validate-docs.js` (`:35`, `:68`, `:84`) are exported and unit-tested but on **no**
  execution path. Delete them and `CONFIG.mappings`. Ungated file.
- [x] **F-2 / F-3 / F-6 — doc gates** (ruling 3). Derive the README command list from
  `bin/amicus.js`'s 21 `case` labels; run `generate-docs --check` in jest; extend the council
  TOC/anchor gate to all of `docs/`. All test-only, all verified passing today.
- [x] **Two verification riders** (~5 min). Assert `runFanout({quiet:true})` writes nothing to
  stdout; and actually observe a `continue` row landing under `(unattributed)` before item 5 fixes
  it — that path is the v4.7 docs PR's headline sentence and was traced by reading, never exercised.

## v4.8.0 — SCOPE RULED (2026-08-16) — read this before the sections below

⛔ **The checkboxes in the v4.8.0 sections below are STALE and partly WRONG.** A full recon at
`main` = `53cd689c` verified all 27 "open" seat-identity items by execution, then re-measured every
verdict adversarially. Result: **6 are DONE and still unticked, 3 PARTIAL, 1 SUPERSEDED, 1 HOLD,
16 OPEN** — and SI-22 is a roll-up of five independent shapes, so the true open count is **20**.

**Full record, with every citation re-anchored BY SYMBOL:**
`docs/superpowers/plans/2026-08-16-v48-phasing-and-rulings.md`. Read it before planning any item
here. Line numbers in the sections below predate PR5a/PR5b/PR5c and many have rotted — but rot is
**per-citation, not per-item**, so re-derive rather than discard.

### The ruling

**Task mode (#134 / #130) moves to v4.9.0, with #146 folded in.** v4.8.0 ships the seat-identity
remainder plus the cheap repairs. Eleven PRs went into one of three workstreams; the other two are
sized and deferred rather than carried half-done.

### Traps — do not implement these as written

1. **SI-04's prescribed fix is measurably wrong.** `(v.seat || v.judge) !== (f.raiserSeat || f.raiser)`
   **re-arms #137** on both orphan directions — it admits the raiser's own vote as its own peer.
2. **T1 and T2 pinned the WRONG behaviour as disclosed** — `tally.test.js:331` (T1, **was
   `:329`**) and `tally.test.js:357` (T2, **was `:341`**). The peer-split fix had to **replace**
   them, not pass them; it could not be written "keeping the suite green", and the replacement had
   to be pinned with a **named mutant**.
   ✅ **EXECUTED 2026-08-19 — v4.8 Phase 2 T-B2, `e23e56cd`.** Both replaced; both titles now end
   `⇒ excluded AND announced`; pinned by the named mutant `NAIVESPLIT` (17 suites / 97 tests red),
   not by a preservation test.
   ⚠️ **SUPERSEDED COUNT** — `97` was true at T-B2 (`e23e56cd`) and is left as written; T-B4's two
   re-runs make it **17 suites / 109 tests**, which is also the value at HEAD — T-B5's round-1 volume
   pin briefly inflated it to 110 and round 3 removed that coupling. Single source:
   `peer-split-mutants.js :: NAIVESPLIT`. ⚠️ **This did NOT close SI-22.1 or SI-22.2.** Owner ruling R2 is *mark
   explicitly, attribute nothing*: the ambiguous vote is STILL dropped, `basis` still reads
   `{a:0,d:0,n:0}`, the tier is still `Singleton`, and the undercount these two shapes
   describe SURVIVES, deliberately. ⚠️ **"Undercount" here names a POSSIBILITY** (T-B5 fix round 3,
   council C1): such a vote is either a real twin's signal or the raiser's own, and the engine
   cannot tell — which is why it is announced. The user-facing text says so; this dated sentence is
   annotated rather than rewritten. The one thing that changed is that the drop is now
   **ANNOUNCED** — `findings[].unattributedPeerDrops`, emitted only when > 0.
3. **`position`/`lens` ARE recoverable on twin benches** — measured by executing `buildSeats` +
   `buildTallyInput` (re-measured 2026-08-16: on `['deepseek','deepseek','gpt']` every `meta.seats`
   element carries `position` `[1,2,3]`, and the lensed twin keeps `lens` verbatim). ✅ **CORRECTED
   2026-08-16** in `run-assemble.js`, `run-assemble.test.js` and SI-21 — all three carried the false
   universal *"`position` is unrecoverable on every bench"*. **Those two source comments now read
   TRUE; do not "re-fix" them.** Recorded so the false universal is not re-introduced.
4. **The three duplication filings give three different counts, all wrong.** Measured: **9
   object-form `seatKey` spellings, all in `src/`, zero in `electron/`**, plus 9 string-form
   post-emit reads. ⚠️ **No filing ever said "nine"** (measured: `git show 17b6b6f2:BACKLOG.md |
   grep -n nine` returns no hit inside any of them — SI-15 said **3**, SI-27 enumerated **4** and
   missed 5, PR5c-SEATKEY said **3 "+ a fourth"**). It is the two **TRUE** counts that both come to
   nine, over **disjoint sets** — which is why a bare "9" is ambiguous and every number needs its
   counting rule stated beside it. Merged 2026-08-16 into **SI-DUP**, which states both rules; plan
   from that entry, not from this summary.
5. **PR5c's commit title (`16fbad16`) misleads.** It fixed the dead-seat **consumer**; the runStats
   **producer** still collapsed two orphaned twins to one row on both arms. ✅ **The producer half
   SHIPPED 2026-08-16 — T2.2, `33e2ecf7`.** `pushDeadSeatRows` now emits one row per orphaned twin
   on **both** arms *for every still-dead twin it is handed*, and `recordFailure` buys one retry
   slot per twin. ⚠️ **Read that scope literally** — the producer cannot emit a row for a seat that
   never reaches it. ✅ **The reconcile half CLOSED 2026-08-17 (v4.8 Phase 2 T-A4, `1e385895`):**
   `launched` carries a per-key SLOT COUNT and per-slot `firstFailure`s, so a partial return now
   yields **2** notes and **2** `stillDeadLegs` where it yielded 1 and 1 — output IDENTICAL to the
   BOUND control in both the partial-return and full-return shapes. The trap is kept, not deleted,
   because its *reason* still holds: a reader arriving from `16fbad16`'s title will mis-date what
   closed when. ⚠️ Closed does NOT license the unqualified headline — see SI-22.3 below for the
   per-shape statement and the three bounds that remain.

### Owner rulings (2026-08-16)

| # | Ruling |
|---|---|
| R1 | Task mode → **v4.9.0**, #146 folded in |
| R2 | Unidentified seat: **hybrid** — producer mints a distinguisher where it has one; where it has nothing, mark, attribute nothing, announce |
| R3 | Orphaned Stage-2 judge vote: **render as unattributed, keep in basis** |
| R4 | Chair-on-bench: **normalise before the ledger join**, inside the street-cred PR |
| R5 | SI-02 + the R4 critic path: **defer to v4.9** — ✅ **DONE in v4.9 W9 Task A (2026-08-25)**: all three consumers admit the gated `seat-unbound` family and the critic path is seat-keyed |
| R6 | PR5b-1 two-document split: **defer** — Phase 2 closes the reachable half for free |
| R7 | R5 live payload: **ship in v4.8**, measured independent |
| R8 | `-rv` join: **refuse** an unknown-seat re-vote → SI-13 becomes a JSDoc edit |
| R9 | Stage-2 judge roster: **per-SEAT is intent** — close the double-pay half |
| R10 | MCP tally schema: **fix the closed z.object properly**, own PR |
| R11 | Function lengths: **defer the splits**; SI-27 takes the useful slice |
| R12 | #135 TTFT: **probe first**, then scope C2 |
| R13 | #133: **Piece 1 only** (`opencodeSessionId`) |
| R14 | **SI-27 in v4.8** after Phase 2, home `stage1-bind.js`; seatKey consolidation → v4.9 |
| R15 | SI-25 chair packet: **sites (1)+(2) now**, site (3) rides the street-cred PR — ⚠️ **SUPERSEDED 2026-08-23 by ruling R25-1: ALL THREE sites shipped in one PR, and that is NOT scope creep.** Site (3) is the **rankings** site (the middle one in the file, not the last); the street-cred PR = Phase 3, which UNBLOCKED it and deliberately did not do it, so this deferral had no remaining referent. See the ticked *"chair packet is assembled entirely in alias space"* entry below for the full record |
| R16 | `sessions-index` leak: **pin all 13 unpinned rails** |

### The durable finding was the release's centre — ✅ FIXED: slots (T2.2) and rows in ALL FOUR retry shapes (T2.2 for three, T-A4 `1e385895` for the partial return, 2026-08-17)

✅ **FIXED 2026-08-16 — T2.2, `33e2ecf7`** (branch `v48p2-producer-identity`). Both halves shipped in
one commit, as R2 required: `recordFailure` now dedups only where identity is EXACT, so N orphaned
twins buy N retry slots, and `pushDeadSeatRows` emits N rows on **both** arms **for every still-dead
twin it is handed**. Re-measured on the same bench through the real `groupStage1Losses`:
`models=["deepseek","deepseek"]`, `seats=[null,null]` — neither guessed — and two dead-seat rows,
each carrying **no** seat. Controls unmoved: both bound → two; unique alias → one.

⚠️ **The unqualified claim "N orphans → N retry slots AND N rows" is NOT true. Do not restate it in
either wording.** The RETRY-SLOT half **is** closed in every shape — that is `recordFailure`, which
runs before any retry outcome exists. The ROW/NOTE half WAS partial — ⚠️ **CLOSED by T-A4 (`1e385895`); the marked cells below are STALE, superseded by the ✅ CLOSED verdict later in this section.** Measured 2026-08-16
against the branch tip through the **real `runStage1`**, two UNATTRIBUTABLE dead legs on a twin
alias (`orphan-a` / `orphan-b`, first-failure reasons `boom-A` / `boom-B`):

| retry outcome | retry slots | dead-seat notes | primary rows | superseded rows | status |
|---|---:|---:|---:|---:|---|
| retry wave dies **wholesale** | 2 | 2 | 2 | 2 | ✅ closed |
| retry returns a leg **per slot** (FULL) | 2 | 2 | 2 | 2 | ⚠️ **STALE CELL — B2 CLOSED by T-A4 (`1e385895`).** Read on 2026-08-16: "✅ count closed — but both notes read `firstFailure.reason: "boom-A"`, slot 0's (B2)" |
| retry returns **FEWER** legs than launched (PARTIAL) | 2 | ⚠️ **1** | ⚠️ **1** | 2 | ⚠️ **STALE CELLS — B1 CLOSED by T-A4 (`1e385895`).** The 1s and the "❌ open (B1)" they carried are the 2026-08-16 measurement, not HEAD |
| unit **skipped** (over budget / unmappable) | 2 minted, 0 launched | 2 | 2 | 0 | ✅ unchanged; skipping is all-or-nothing per unit, so no twin splits — pinned by test |

**The PARTIAL row does not lose spend** — 2 superseded + 1 primary = 3 rows for the 3 legs actually
billed (2 first-attempt + 1 retry). What it loses is the second dead **seat**: it gets no note and
no row, so a reader is told one seat died where two did.

⚠️ **Two ACCEPTED costs of R2 that T2.2 knowingly bought. Both are visible, neither is a defect to
"fix" later without re-opening the ruling.** Recorded here because until now they lived only in
source comments and an untracked task report.

1. **A duplicate row across arms.** On a twin alias, an unattributable WAVE slot and an
   unattributable LEG for the *same* seat now produce **two** rows where HEAD produced one. That
   mirrors the duplicate-note cost `planStillDeadSources`' docblock already discloses and follows
   the same ruling: a duplicate a reader can see beats a loss they cannot.
2. **`spareRetryLegs` pairs legs to rows arbitrarily, in BOTH directions** (code council on PR #170,
   round-1 finding **D1**). A still-dead RETRY leg that bound to no seat on a twin alias is handed to
   the next `!exact` row on that alias by `shift()`, in arrival order. The candidate rows come from
   **both** arms, so a LEG-origin retry leg can land on a WAVE-origin `Symbol('unattributed-seat')`
   row, and two leg-origin rows can swap legs with each other. **The pairing is still arbitrary and
   that is still accepted** — every candidate row on the alias is equally dead, the row asserts no
   seat at all, and the alternative (key rows by the mint alone) drops a billed leg from runStats
   entirely, which is the spend hole T2.2 exists to close.

   ⚠️ **The rest of this item was FALSIFIED and is corrected here — round 2 escalated D1 to A1
   [major] and it is FIXED (this commit).** The sentence that stood here — *"the row therefore
   carries a real leg's `waveId` / `status` / `usage` / `durationMs` that may belong to a different
   seat of that alias"* — described the defect, not an accepted cost, and round 2 said so: borrowing
   the leg for billing exactness is one thing, stamping its **per-seat execution metadata** onto a
   row is a false statement about that seat. Measured at `42738592` in the sharpest (cross-arm)
   shape — a WAVE-origin seat that produced **no leg at all** — the row read
   `{"waveId":"r1-s1r1","resolvedModel":"deepseek-r1-turbo","status":"timed-out","durationMs":4242}`.
   **A borrowed spare is now BILLING ONLY:** its `usage` rides the row and nothing else does, so the
   row is byte-identical to the leg-less dead-seat row plus that one field. `resolvedModel` goes too
   — it is stamped off the leg and is equally per-seat — and the brief flagged it for exactly that
   reason. What remains, disclosed: the **split** of a known alias total across its anonymous rows is
   still arbitrary (row order, not identity); the SET, COUNT and SUM of billed legs are exact.
   Measured consequence at the LEDGER, not reasoned: two such rows whose borrowed legs resolved
   DIFFERENTLY gave 2 ledger rows before and give 1 now; two that resolved the SAME gave 1 either
   way; and no spend moves, because a ledger row carries no cost field at all — the run total is
   summed from runStats, which still holds both legs' `usage`.

   ⚠️ **Round-1 Minor 8 is CLOSED: `spareRetryLegs` now HAS named mutants.** The record here said
   *"delete the branch and no test names it"*, ruled do-not-fix in round 1. Both halves are now
   pinned by `run-stages.test.js` :: *"T2.2 review A1: a borrowed spare is BILLING ONLY"* —
   **BORROWALL** (restore the whole leg as the row's own, HEAD's shape) reds the misattribution
   half, **NOBILL** (drop the `row.usage` assignment) reds the spend half. The pin is whole-object
   equality against the no-spare control, so a future field stamped off a borrowed leg fails it
   without anyone remembering to extend the test.

   ⚠️ **One consequence to hand forward — `waveId` is no longer a safe filter for "rows carrying
   billed usage".** `tests/council/run-cost-bijection.test.js` cross-foots the run total against
   `runStats.filter(r => r.waveId)`. A borrowed row now carries `usage` and no `waveId`, so it is
   dropped by that filter — measured on the two real row shapes: BEFORE the fix the row was in
   `legged` (amount 0.07), AFTER it is not (0 rows, amount null). **Nothing is red today** because
   that suite deliberately does not model twin aliases (its `${waveId}::${model}` key cannot
   separate two seats of one alias, and its own docblock says so). Whoever first adds a twin
   scenario there must change the filter to `r => r.waveId || r.usage` **first** — measured a no-op
   on every other row class, since the leg-less and `claude` rows carry `usage: null` — and rework
   the key. **Do not resolve that red by restoring a `waveId` on the row**: that is the exact
   misattribution A1 removed. The suite's docblock now carries this warning too, and `docs/council.md`
   (shipped) has been corrected on both the `waveId` presence rule and the new row shape.

**Three properties this design rests on are now PINNED BY TEST, not by comment** (council review
A1/D3, A2, C1/D4 — all added in the review round, no behaviour change). Named here so a future
reader can find them and so nobody re-argues them in prose:

- `run-stages.test.js` :: *"T2.2 review A1/D3: the NUL-joined row key is CONTAINED"* and
  `run-retry.test.js` :: *"attemptedSeats carries the minted key; no emitted still-dead note does"*
  — `legLossKey`'s `\u0000` separator rests on an assumption about producers this code cannot
  enforce, so what is guarded is CONTAINMENT: the key reaches no emitted row and no emitted note.
  Both pins feed a leg whose `taskId` already contains a NUL — the assumption violated on purpose —
  and both assert the RAW byte and the six-character JSON escape, because `JSON.stringify` never
  emits the raw one. Mutants: **LEAK** (`model: join` instead of `model: alias`) and **NOTEMINT**
  (`seatId: legLossKey(...)` in `planStillDeadSources`) both observed RED, and LEAK is caught by the
  escaped-form assertion alone, which is why both spellings are checked.
- `run-retry.test.js` :: *"v4.8 T2.2 review A2: srcLegClaimer's single-use-per-leg contract"* — the
  helper is stateful and exported; three pins cover at-most-once, cross-key consumption, and
  one-claimer-per-unit. Mutant **FIND** (drop `pool.delete(l)`) observed RED on the first two.
- `run-retry.test.js` :: *"v4.8 T2.2 review C1/D4: the two invariants supersededKeys rests on"* —
  `supersededKeys` is the ONE join still in the alias-granular keyspace, and when these pins landed
  its safety argument existed only as a comment (T-A5 later added the CHECK — see that entry).
  Invariant 2 (two UNBOUND leg-origin twins share ONE unit,
  bench AND lens) and invariant 1 (skipping is all-or-nothing, so the pair is BOTH skipped or
  NEITHER) each have a pin, plus a scope control showing BOUND twins DO split across lens units and
  why that is safe. Mutants **GUESSPOS** (guess an unbound leg's seat by ordinal) and
  **PARTIALSKIP** (a skip branch pushing a subset of `unit.srcLegs`) observed RED — and
  **re-observed RED at `2abbeefa`** by T-A5, which measured the claim rather than inheriting it.

**What the finding said, kept for the record.** `run-retry-group.js :: recordFailure` keyed through
`seatKey(seatObj, seat)` (T2.1, 2026-08-16, `511cf43e` — hand-inlined as
`const key = seatObj ? seatObj.id : seat` before that refactor). Measured at `cc56f678` on
`['deepseek','deepseek','gpt']` with two **unbound** dead twin legs: `models=["deepseek"],
seats=[null], firstFailures.seatId=["deepseek"]` — **one retry slot for two dead seats**, while
`planStillDeadSources` already emitted 2 notes and 2 `stillDeadLegs`. It paired with SI-22.3, where
`pushDeadSeatRows` collapsed the same twins to one row on **both** arms; fixing either alone would
have left the run's spend and its record disagreeing.

✅ **CLOSED 2026-08-17 — v4.8 Phase 2 T-A4 (`1e385895`). SI-22.3 is no longer PARTIAL.** The
extraction it was blocked on landed first (T-A1 `955bd7c9`, T-A2 `2517a947`), exactly as R14
required, and then `launched` stopped being a first-wins presence Map: an entry now carries a slot
COUNT and its OWN per-slot `firstFailure`s, and the reconcile emits `max(slots, 1) − seen` notes
instead of testing presence. **Measured on the final tree, and STRONGER than the fix required — in
BOTH the partial-return and the full-return shapes the UNBOUND case now produces output IDENTICAL
to the BOUND control.** Pinned by `run-retry.test.js` :: *"B1: a PARTIAL return announces both dead
twins and returns both source legs"*, *"B2: on a FULL return each note carries its OWN slot's
first-failure, not slot 0's"* and their shared control *"B1 + B2 control: BOUND twins are UNMOVED"*;
named mutants **SLOTCOLLAPSE** (reds B1 alone) and **SLOTZERO** (reds B2 alone), a clean separation.

⚠️ **PER-SHAPE, NOT THE SLOGAN.** The unqualified *"N orphans → N retry slots AND N rows"* must
still not be restated in either wording, and closing B1/B2 did not make it true. What IS true, each
half measured:
- **ROW/NOTE half — closed in all FOUR retry shapes.** Wholesale retry death, FULL return and a
  skipped unit were closed by T2.2; the PARTIAL return closed here. (The phasing plan's *"three
  retry shapes of four"* is therefore superseded.)
- **SLOT half — closed, and now BOUNDED.** T-A3 (`4413eb25`) capped the mint at the alias's roster
  count per unit, so N orphans buy `min(N, roster count)` slots, not N: shape A 3 ⇒ **2**, shape B
  4 ⇒ **2**, controls 2 / 1 / 1 unmoved. That bound is the fix, not a residual.
- **Three bounds survive, by design.** (1) `pushDeadSeatRows` emits one row per still-dead input it
  is HANDED — it cannot invent a seat that never arrives. (2) R2's honest floor: twins with **no
  `taskId` at all** still share one row key (`run-retry-keys.js :: legLossKey`), because inventing
  a distinguisher is the guess that keyspace exists to reject. (3) With **no roster** `twinAliases`
  is empty, so identity is EXACT and two losses on one alias collapse — the deliberate "no proof,
  err toward collapsing" default.

**What the two findings said, kept for the record.** `launched` was a first-wins Map keyed by
`seatKey`, and no first-attempt distinguisher can enter that keyspace (a retry leg's `taskId`
belongs to the retry wave), so two unattributable twins shared ONE entry. Two consequences, both
re-measured 2026-08-16 through the real `runStage1` at `33e2ecf7` and **re-confirmed against the
branch tip** in the review-fix round. They are the code council's **B1** and **B2** on PR #170
**round 1**, and the owner ruled them out of that PR's scope — they were the already-disclosed
residual, they were not regressions, and closing them needed an extraction first (bundling that
refactor into a defect PR would have violated R14):

1. ~~**B1 — a partial retry return under-counts.**~~ **FIXED T-A4.** 2 slots launched, 1 leg back ⇒ 1 still-dead note
   and 1 dead-seat row where two are owed. Control, the same shape with BOUND twins ⇒ **2 notes /
   2 rows**. No spend is lost (the second slot returned no leg to record); the second dead **seat**
   is what disappears.
2. ~~**B2 — both still-dead notes read slot 0's `firstFailure`.**~~ **FIXED T-A4.** On a FULL return (2 legs back,
   2 notes) `data.reason` correctly differs per retry leg while BOTH notes carry the FIRST twin's
   `firstFailure` — re-measured at the tip with first-failure reasons `boom-A` / `boom-B`, both
   notes read `"boom-A"`. The second twin's first-failure reason reaches no announcement at all.
   Control with BOUND twins ⇒ correctly distinct, so it is the first-wins key and nothing else.

Neither is a regression: `cc56f678` emitted one note for shape 1, and shape 2's twin note did not
exist there at all. No billed leg is lost in either.

⚠️ **FINDING IDS ARE PER-ROUND, AND PR #170 HAS HAD TWO COUNCIL ROUNDS. Do not read a bare id.**
Round 2 ("Fix these first", 15 confirmed / 6 major) **renumbered** them, so the same two letters mean
different defects in the two rounds:

| id | round 1 (as filed above) | round 2 |
|---|---|---|
| **B1** | partial retry return under-counts | **slots are not roster-bounded** (fixed shape measured, does not fit — see the extraction task) |
| **B2** | both notes read slot 0's `firstFailure` | round 1's **B1** (partial-return under-count) |
| **B3** | — | round 1's **B2** (slot 0's `firstFailure`) |
| **A1** | the NUL separator's unenforced assumption (minor, pinned) | **a row carries another seat's execution metadata** (major, FIXED this commit) |
| **A2** | `srcLegClaimer`'s single-use contract (minor, pinned) | **`supersededKeys`' cross-keyspace join** (major, filed below) |
| **C1** | `supersededKeys`' invariants argued in a comment (minor, pinned) | same subject as round-2 **A2** |
| **A3** | — | `twinAliases` at four sites ⇒ **already filed as SI-TWINS**, do not file twice |

Every reference below is tagged with its round. The two round-1 items above keep their round-1 names
because that is what the text already shipped with; the extraction task carries both spellings.

⚠️ **A THIRD collision, found while filing a later measurement.** A council pass reviewing HEAD
(`1677095f` — i.e. *after* round 2's A1 fix above had already shipped) raised its own finding also
labeled **C1** [major, a3/d0/n0]. It is a DIFFERENT mechanism from both C1 rows above (one subject,
`supersededKeys`) — council letters restart every round, and this collision is coincidental, not a
re-opening. Filed at the end of this section, just before *Size gate*: "bound retry legs on unbound
twin aliases are dropped from their rows." Anchored there by commit and mechanism rather than an
asserted round number — this task could not verify against a transcript whether the originating
process calls it round 2 or round 3, and guessing wrong would repeat the exact citation-rot class
this table exists to prevent.

- [x] **NEXT TASK — extract `run-retry.js`, then close B1 and B2 in the same PR.** Blocked on the
  extraction and on nothing else; sized, not estimated.
  ✅ **SHIPPED as PR #171, v4.8 Phase 2 T-A1…T-A8, 2026-08-17 (re-confirmed 2026-08-19, v4.8
  T-B3). This whole entry — Steps 0-2, both ROUND-2 items, and everything below through
  "Tracker state" — is now HISTORICAL RECORD, kept for provenance. It is not a live resume
  point; the checkbox above was never flipped when the work shipped, even though the content
  already carries its own ✅ SHIPPED / DISCHARGED / CLOSED annotations throughout. The actual
  current NEXT TASK is below.**
  - **Step 1 — the extraction (its own commit, byte-for-byte move, re-exported).** `run-retry.js` is
    **295/300** and the fix needs **+7**, so 5 free is not enough. `run-retry-group.js` (**299/300**)
    cannot host the helper either. Use the PR5b shape: move, re-export so no caller changes, pin by
    function **identity** (`toBe`) across import paths. **Also on this step's checklist:** correct
    `planStillDeadSources`' stale docblock (below) — the size ceiling is the only reason it still
    reads as current.
  - **Step 2 — the fix.** `run-retry.js :: retryStage1Losses`'s `launched` is a first-wins Map keyed
    by `seatKey` (`addLaunched` does `if (!launched.has(k))`), and `seenSeats` is a presence Set. The
    cure is a per-key **slot count**: `launched` entries gain `slots`, `seenSeats` becomes a count
    Map, and the reconcile emits `max(slots,1) − seen` notes instead of testing presence. Each
    emitted note must carry **its own** slot's `firstFailure`, not slot 0's.
  - **Both consequences must be named in the done criteria, not just the count.** Closing B1 alone
    leaves B2 standing — a partial return would then emit two notes that both read slot 0's
    first-failure, which is worse than one note, because the duplicate looks authoritative.
  - **Do not shave comments to make room** for the fix in place; that is what produced the stale
    docblock this entry already tracks.
  - Provenance: code council on PR #170 **round 1**, findings **B1** (major) and **B2** (major)
    — **round 2 renumbers these to B2 and B3**; owner scope ruling 2026-08-16 (fix the minors,
    narrow the claims, ship; they ride the extraction).
  - **⚠️ Step 0 — this extraction must now also unblock `run-retry-group.js`, not only
    `run-retry.js`.** Round 2 rated the unbounded mint **major** (a spend risk inside a spend fix),
    and its fix does not fit at 299/300. Both files need headroom before either fix can be written;
    size them together. The two items below are the round-2 additions.
  - ✅ **SHIPPED 2026-08-17 — v4.8 Phase 2 T-A3, commit `4413eb25`. EVERY NUMBER IN THIS SUB-ENTRY
    IS A 2026-08-16 READING, kept for provenance; none of it is live guidance.** The extraction it
    was blocked on landed first (T-A1/T-A2), so the "did not fit / 299 ⇒ 308 / 8 over / 119 maximum"
    arithmetic below was already superseded when the fix was applied: `run-retry-group.js` was
    **235** and landed at **250**, and the 119 maximum is a per-file convention with **no gate**
    (`.eslintrc.js` has no `max-len`). The measured effects and controls below DID hold — the
    controller re-ran the probe independently (shape A 3 ⇒ 2, shape B 4 ⇒ 2, controls 2 / 1 / 1
    unmoved) and the named mutant NOBOUND was observed RED. ⚠️ A second mutant, **OFFBYONE**
    (`>=` ⇒ `>` on the guard), was measured at T-A8 on the final tree: it reds shapes A and B and
    **NOT** the boundary control — see `run-retry-roster-bound.test.js`.
  - **ROUND-2 B1 [major] — bound the mint by the roster. The fix is WRITTEN AND MEASURED; it did not
    fit, and nothing else blocks it.** Applied to the working tree on 2026-08-16, measured, then
    reverse-edited byte-exactly (`git diff` empty). Do not re-derive it — apply it:
    - `twinAliases` returns a **Map** (alias ⇒ roster count) instead of a Set. `new Map([...n]
      .filter(([, c]) => c > 1))` is a one-line in-place swap and all four call sites use `.has()`
      only, so nothing else changes — but the count is the thing the Set was throwing away, and
      without it `recordFailure` cannot state a bound at all.
    - `recordFailure`'s two guards merge: `identityIsExact ? unit.firstFailures.some(f => f.seatId
      === key) : unit.models.filter(m => m === seat).length >= twins.get(seat)`.
    - **Measured effect** (real `groupStage1Losses`, `['deepseek','deepseek','gpt']`): shape A
      3 unbound legs ⇒ **3 slots before, 2 after**; shape B null-seat dead wave + 2 legs ⇒ **4
      before, 2 after**. Controls all hold unmoved: 2 legs/2 seats ⇒ 2, unique alias ⇒ 1, **no
      roster ⇒ 1** (with no `o.seats`, `twins` is empty, identity is EXACT, and the bounded branch
      is unreachable — `twinAliases`' deliberate "no proof, err toward collapsing" is untouched).
      `run-retry.test.js` + `run-stages.test.js` were **159/159 green** under the patch.
    - **Scope, stated because the code cannot:** it bounds SLOTS (`unit.models`), so a
      `trackModel: false` unit — the critic, whose `models` is fixed at creation — is unaffected.
    - **Line arithmetic, why it did not ride the defect PR.** `run-retry-group.js` **299/300**, one
      free line. The patch measured **299 ⇒ 308**: +1 on `twinAliases`' docblock (the return shape
      changed and must say so) and +8 on the guard (7 comment lines + a 1 ⇒ 2-line expression; one
      line is impossible — the merged ternary is ~146 chars against this repo's 119 maximum).
      **8 over.** Shaving a comment to reach it is the documented failure tell and was refused;
      even a comment-free version left `twinAliases`' docblock saying *"the answer is the empty
      set"* about a function returning a Map, which is precisely the falsified-record class this
      release keeps paying for.
    - **Done criteria:** a named mutant that REMOVES the bound goes RED, plus controls proving the
      two unbounded shapes above now cap at 2 and that the no-roster and unique-alias benches did
      not move.
  - **ROUND-2 A2 / C1 [major] — make `supersededKeys`' cross-keyspace join enforce its own safety.**
    `supersededKeys` (`run-stage1-superseded.js :: supersededRows` since the v4.8 T-A6 split;
    it was `run-stage1-rows.js :: pushDeadSeatRows` when this was filed) is the ONE join left in the
    alias-granular keyspace after rows and `attemptedSeats` moved to minted keys. The council does
    **not** dispute that it is safe today; the objection is that its safety is **emergent, not
    enforced** — the function cannot verify either invariant it stands on, so a change elsewhere can
    break it silently. Structural enforcement is a refactor, so per **R14** it does not ride a defect
    PR; it rides this one. The two invariants, and the pins that stand under them **today**:
    - **Invariant 1 — skipping is all-or-nothing per unit.** Every skip branch pushes
      `...unit.srcWaves` / `...unit.srcLegs` wholesale and `continue`s, so two unbound twins are
      BOTH skipped or NEITHER. Pinned by `run-retry.test.js` :: *"invariant 1: skipping is
      all-or-nothing"*, mutant **PARTIALSKIP** (a skip branch pushing `unit.srcLegs[0]`) ⇒ RED.
    - **Invariant 2 — two UNBOUND LEG-origin twins always share ONE unit**, bench and lens (the
      `deadLegs` loop calls `lensIndexOf(o, null, alias, null)`, which falls through to
      `o.models.indexOf(alias)`, first-match). Pinned by *"invariant 2: two UNBOUND leg-origin twins
      group into ONE unit"* plus a scope control showing BOUND twins DO split across lens units
      safely; mutant **GUESSPOS** (guess an unbound leg's seat by ordinal) ⇒ RED.
    - **Do not weaken or remove those pins** — the refactor's job is to make the invariants
      checkable by the code, not to replace the tests that currently carry them. Both mutants must
      still be RED afterwards.
    - Break either invariant and a skipped twin takes its own first leg as a primary row AND gets a
      superseded row for it: **one billed leg counted twice**, the defect class this release exists
      to close.
    - Provenance: code council on PR #170 **round 2**, findings **A2** (major) and **C1** (major).
    - ⚠️ **PAST TENSE as of v4.8 Phase 2 T-A5** — this entry is left standing for T-A8's truth pass,
      but two of its sentences are no longer true of the code. `pushDeadSeatRows` CAN now verify the
      statement both invariants exist to make ("no first leg is SKIPPED while its alias key is
      superseded"): it tests `retry.skippedDeadLegs` by leg-object identity where the alias key is
      relied on, and where refusing the row actually repairs the count it REFUSES it and announces
      on channel `internal` instead of throwing. Both mutants were re-run and re-observed RED at
      `2abbeefa`; neither pin was weakened.
    - **The refusal's two conjuncts, both MEASURED (T-A5 rounds 2-3), both mutant-pinned.** A
      refusal only repairs the count for a leg the dead-seat loop's `deadLegs0.find` would hand
      back, and `find` returns ONE leg per row key — so the guard fires only when `attemptedSeats`
      does not hold the leg's row key AND that `find` returns THIS leg. Round 2 shipped the first
      conjunct alone and MEASURED it a regression: on 3 taskId-less unbound twins in one lens with
      invariant 2 broken (mutant GUESSPOS, wired exactly as `run-stages.js` wires it), billed 0.60
      recorded **0.20**, losing two billed legs. Round 3 added `=== dead` per owner ruling and
      re-measured the same fixtures: keys COLLIDING ⇒ **0.70** both with the guard and with no
      guard at all — nothing lost, the residual 0.10 being the R2 collapse floor (INSTRUMENTED in
      round 4: the twins share one `deadSeats` entry, `attemptedSeats` is empty, so the
      `deadLegs0.find` fallback hands that one row the HEALED twin's first leg, which already has a
      superseded row — one leg on two rows. `finalLeg` is that leg, NOT null, and `borrowed` is
      null; a borrow is impossible here, it needs `attemptedSeats.has(join)` TRUE. Two earlier
      versions of this sentence named the borrow path, which cannot execute on this shape);
      keys DISTINCT ⇒ **1.10** without the guard against **0.60** with
      it, the whole 0.50 double count removed and nothing lost; and both controls with no invariant
      break stay at 0.60 = billed. The reachability that made this matter is measured, not argued:
      `supersededKeys` also draws from `retry.recoveredLegs`, and NO `attemptedSeats` writer sits on
      run-retry.js's HEAL branch, so a healed twin supersedes the alias with `attemptedSeats`
      observed EMPTY — breaking invariant 2 alone reaches it. Dropping either conjunct is a named
      mutant: **WIDEGUARD** and **KEYNOTLEG**, each RED on a pin that measures SPEND, not row count.

✅ **CLOSED by v4.8 Phase 2 T-A1** (commit `955bd7c9`) — the extraction commit this note asked for
corrected the docblock in place, net zero lines, scoping the masking to pre-PR5c HEAD and stating
that T2.2 removed it. The record below is past-tensed to match: nothing in it describes the tree as
it stands.

⚠️ **A second, already-incurred cost of shipping at 299/300: `run-retry-group.js` CARRIED a STALE
docblock that could not be corrected until the file was extracted.** `planStillDeadSources`'
docblock — anchored **by symbol**, because T-A1 moved it: `run-retry-group.js:94-96` at base
`3d8f9d38`, `:30-32` after (`:94-96` in the post-T-A1 tree is `recordFailure`'s dedup-helper
docblock, an unrelated function) — read *"HEAD hides this downstream because the Workspace's
dead-row dedup is alias-keyed too and both collapse into one row"*. That "HEAD" meant
**pre-PR5c** HEAD, and the sentence had been stale framing since PR5c; T2.2 then abolished the
producer-side collapse it leaned on. It was **not** wrong about PR5c's own history, so it misled
rather than lied — but a reader arriving at that function would have read it as current. Any repair
was constrained to be **net zero lines or shorter** — the gate blocked the commit on a single added
line — which is a needle no one should thread under time pressure for a comment. **Corrected in the
same change that extracted the file**, where that constraint was gone, on the extraction's
checklist rather than in a separate task: T-A1 left the file at **235/300**, 65 free, and the repair
landed net zero anyway. Recorded because "the size ceiling deferred a documentation repair" is a
real cost that is otherwise invisible.

✅ **BOTH PARAGRAPHS BELOW ARE HISTORY — CLOSED 2026-08-17 by v4.8 Phase 2.** The extraction they
address for (T-A1, `955bd7c9`) landed, and T-A3 (`4413eb25`) then made the code state AND check the
bound, so *"the safety rests entirely on those two facts, which the code never states or checks"* and
the *"299 ⇒ 308, 8 over"* costing are both superseded. Measured on the final tree: shape A 3 ⇒ **2**,
shape B 4 ⇒ **2**, controls 2 / 1 / 1 unmoved; `run-retry-group.js` **266**/300. Kept verbatim
because the two facts the old safety rested on are still the reason the over-count was never
reachable, which is worth reading before anyone loosens the bound.

⚠️ **A stated invariant for whoever extracts `run-retry-group.js`.** The rule T2.2 shipped is *"never
dedup on a proven twin alias"* — it is **NOT** *"at most N slots for N roster seats"*, and no code
says so. Measured 2026-08-16 through the real `groupStage1Losses` on `['deepseek','deepseek','gpt']`:
**3** unbound legs on that 2-seat twin alias ⇒ **3** slots; a null-seat dead wave naming the alias
twice **plus** 2 unbound legs ⇒ **4** slots for 2 seats. Controls: 2 legs ⇒ 2 slots, unique alias ⇒
1 slot. Neither over-count is reachable today — a first-pass dead wave always carries real seats,
and a wave cannot return more legs than it launched — but the safety rests entirely on those two
facts, which the code never states or checks.

⚠️ **"Assert them, or state them" is SUPERSEDED — round 2 ruled this a defect, not a note.** The
code council on PR #170 round 2 rated it **major**: a spend risk inside a spend fix, whose safety
rests on an invariant the code never states. It is now tracked as **ROUND-2 B1** on the
`run-retry.js` extraction task above, where the fix is written out, measured (3 ⇒ 2 and 4 ⇒ 2 slots,
every control unmoved) and costed (299 ⇒ 308, **8 over** the 300-line gate). The paragraph above is
still the correct description of what HEAD does; what changed is that the remedy is a bound in
`recordFailure`, not a sentence in this file.

- [x] **SI-TWINS · `twinAliases(o.seats)` WAS recomputed at FOUR sites across THREE files, and the
  `legLossKey` / `twinAliases` / `attemptedSeats` trio could desynchronise silently.**
  **CLOSED by v4.8 T-A6 (2026-08-17)** — one derivation, threaded. It was filed, not fixed, because
  consolidating is a refactor and **R14 says consolidation must not ride a defect PR**; it rides
  the extraction PR instead, as this entry's last paragraph asked. Code
  council on PR #170 **round 1**, findings **C3** (nit) and **D2** (minor); **RE-RAISED in round 2
  as A3** (a1/d0/n1 — thin, and the same subject). ⚠️ **A3 is THIS entry — do not file it a second
  time.** Round 2 added no site and no new mechanism; it re-raised the four-site duplication that
  the list below already names by symbol. Every site anchored **by symbol** —
  line numbers into these two files have rotted three times in this release alone:
  - `src/council/run-retry.js :: retryStage1Losses` — **now the ONE derivation.** It made its own
    for `srcRowKey` at both `claimSrc` sites; it now makes the run's only one, passes it to both
    `run-retry-group.js` consumers as an argument, and publishes it on the return as `out.twins`.
  - `src/council/run-retry-group.js :: groupStage1Losses` — was `const twins = twinAliases(o.seats)`,
    handed to every `recordFailure` call in the wave and leg loops. Now a threaded parameter, with a
    default for the suites that drive it directly with four arguments.
  - `src/council/run-retry-group.js :: planStillDeadSources` — was `twinAliases(roster)`, where
    `roster` is the caller's `o.seats`. Now a threaded parameter with the same kind of default.
    ⚠️ **Its own `seatsPerAlias` map is UNTOUCHED and stays a deliberately different rule
    (`=== 1` vs `> 1`)** — a naive "just pass one collection in" merge would silently change which
    losses are announced, because the two rules disagree on an alias the roster does not mention at
    all (count 0): `!twins.has(alias)` is true there and `=== 1` is false. That gap is now pinned —
    `run-retry-twins-threading.test.js` :: *"the `=== 1` announce rule is NOT the `> 1` twins rule
    — an off-roster alias still announces"*, mutant **MERGERULE**.
  - `src/council/run-stage1-rows.js :: pushDeadSeatRows` — was `const twins = twinAliases(o.seats)`,
    used for `rowKeyOf` and for the `spareRetryLegs` / `exact` predicates on both arms. Now a
    threaded parameter: `run-stages.js` passes `retry.twins`. The default is for the several suites
    that hand this function a fixture `retry` with no `twins` at all.
  - **What is pinned, and what is not.** Three consumer pins hand each site a `twins` that
    DISAGREES with `o.seats` and assert the site follows the argument (mutants **THREADDROP**,
    **THREADDROP-GROUP**, **THREADDROP-PLAN**). The last hop — `run-stages.js` passing
    `retry.twins` rather than a fresh derivation — is a SOURCE pin, disclosed as such: a
    re-derivation from the same roster is *equal* to `retry.twins`, so no fixture can separate
    them from outside.
  - **The desync risk that makes this more than duplication.** `legLossKey`'s minted key must be
    added to `attemptedSeats` at every producer site and asked for at every consumer site with the
    SAME `twins` collection — a **Map** (alias ⇒ roster count) since T-A3, not the Set this entry
    originally said. If one site's `twins` ever differs (a different roster argument, a cached one,
    a re-derived one), a retried twin re-acquires its own FIRST-attempt leg — which already carries
    a `superseded` row — and that leg's cost lands in runStats **twice** while its retry leg lands
    nowhere. **SETTLED BY EXECUTION at v4.8 T-A6 (2026-08-17).** This sentence used to read
    *"Pinned today by the named mutants `DESYNCLEG` and `DESYNCPLAN`"*, and half of it was
    unverified when it was written: `DESYNCPLAN` appeared in this line and **nowhere else in the
    repo** — no test, no comment — while `DESYNCLEG` appeared here plus one *retrospective*
    mention in a test comment. Both were then run against the FULL suite at `9f460526`, and both
    are RED, so the substance held; what was missing was the **name**, not the pin:
    - **DESYNCLEG** — desynchronise `run-retry.js :: retryStage1Losses`' `twins` from the rest of
      the run's, so `srcRowKey` files the UNMINTED key at both `claimSrc` sites. RED on ONE test,
      `run-stages.test.js` :: *"T2.2: two ORPHANED twins get TWO dead-seat rows, and neither
      borrows its own first leg"*; 534 of 535 suites green.
    - **DESYNCPLAN** — same, for `run-retry-group.js :: planStillDeadSources`' `twins`. RED on
      TWO, `run-stages.test.js` :: *"T2.2 control: two orphaned twins whose retry wave dies
      wholesale get TWO leg-less rows"* and `run-retry.test.js` :: *"attemptedSeats carries the
      minted key; no emitted still-dead note does"*; 533 of 535 suites green.

    Both names are now written into those tests **with their mutations and their measured red
    sets**, so the next reader inherits a measurement instead of a claim. The consolidation was
    sequenced after the extraction above, as this entry asked, and both mutants were **re-run
    against the consolidated tree over the FULL suite** and are still RED. ⚠️ The consolidation
    MOVED where each mutation has to be made — emptying the one threaded `twins` now gives every
    site the same wrong answer instead of desynchronising two, which is the safety it buys — so
    the recipes and red sets are recorded at the tests, not here: one place to read rather than
    two that can disagree.

⚠️ **R4 and R5 are NOT one job** — measured independent in both directions; the critic arm never
reads `s.seat`. And **nothing in v4.8 can cure R4**: its bench has no seat-identity critic answer.

⚠️ **Measured, not an open defect — PR #170 round-2 C1 [major, a3/d0/n0]: "bound retry legs on
unbound twin aliases are dropped from their rows … losing the retry leg's billed usage."** Raised in
review of HEAD (`1677095f`, i.e. after round 2's A1 fix above had already shipped) — a DIFFERENT
mechanism from this section's other two C1s (see the map above and its "THIRD collision" note).
**Verdict: reachable at the function boundary, unreachable end-to-end, pre-existing at `main`. Not
fixed, correctly** — the brief's gate ("reachable AND loses billed usage") is not met.

- **The mechanism.** `run-retry-launch.js :: bindRetryWave` (called by `run-retry.js ::
  retryStage1Losses`; lifted out of it verbatim by T-A2, 2026-08-17) pads an unidentified
  retry-roster slot with a placeholder carrying a unique synthetic id
  (`stage1-bind.js :: bindPaddedWave`),
  then builds `retrySeatOf` by dropping every placeholder bind:
  `.filter(b => !placeholders.has(b.seat))` (`stage1-bind.js :: bindPaddedWave`).
  ⚠️ **Both pointers re-anchored 2026-08-23 (v4.8 SI-27).** They read
  `run-retry-launch.js@2517a947:53` and `run-retry-launch.js@2517a947:59` when this was written; SI-27 moved the
  pad/bind/drop CORE
  into `stage1-bind.js :: bindPaddedWave`, which `bindRetryWave` now calls. **The measurement
  below is unchanged and stays true of the tree it was taken on** — only the pointer rotted.
  ⚠️ **And it had rotted ONCE ALREADY, silently:** `:53`/`:59` were exact at `2517a947`
  (T-A2’s lift) and became `:56`/`:62` at `6709ac78` (2026-08-17), a comment-only fix three
  lines above them — six days before SI-27 put them out of range altogether. A comment-only
  edit rots citations too, and nothing in the gate could see either move (see the SI-27 rider
  on the unscanned doc tree).
  So `retrySeatOf.get(leg)` is always either `undefined` or a REAL `unit.seats` entry, with a
  backstop at `run-retry.js :: retryStage1Losses` (`if (!ff) { continue; }`) dropping anything that
  can't find its `launched` entry — or, since T-A4, any leg past its key's LAST minted slot. The same real seat object that survives both gates is exactly what
  `run-stage1-rows.js :: pushDeadSeatRows` finds via `seatOf` when computing `exact`
  (the `exact` expression itself in EACH of `pushDeadSeatRows`' two `deadSeats` feeders — ⚠️ the two
  arms SPELL it differently, `!!seat || !twins.has(alias)` on the legs arm and `!!s ||
  !twins.has(alias)` on the waves arm, so grep both; not the `alias`/comment lines this entry cited
  before 2026-08-17. Re-anchored BY SYMBOL at T-A5, having read `:148`/`:165`, before that `:146`/`:163`)
  — which is the condition (`pushDeadSeatRows`' `let finalLeg = exact ? retryLegBySeat.get(join) :
  undefined;`) that hands a bound retry leg its row. A BOUND still-dead retry
  leg can therefore never reach the `!exact` branch below it — the one branch that does NOT consult
  `retryLegBySeat` — because nothing on the path to `stillDeadRetryLegs` can produce a bound leg
  without also producing the seat that makes its row `exact`.
- ✅ **RE-MEASURED AND PINNED 2026-08-17 — v4.8 Phase 2 T-A7 (`1d31d77e`).** Three tasks had edited
  this call graph since the numbers below were taken, so both mutants were re-run against the final
  tree rather than inherited. **Both reproduce the record exactly**: NOPLACEHOLDERFILTER ⇒
  `stillDeadRetryLegs` **0**, 0 C1 violations, 0.1600 of 0.1600 billed reaching no row; FAKEBIND ⇒
  **1** bound still-dead retry leg, no row carrying it, **GAP 0.0700**. The conjunction now has an
  END-TO-END pin — `run-retry-launch.test.js` :: *"C1 — the conjunction END TO END: a BOUND
  still-dead retry leg always resolves `exact`"* — which drives the real `retryStage1Losses` +
  `pushDeadSeatRows` on both roster shapes and **discriminates the two mutants by assertion**:
  FAKEBIND reds the bound-and-lost block, NOPLACEHOLDERFILTER leaves it green and reds the
  non-vacuity block. The identified-roster shape (2 bound still-dead retry legs, each row stamped
  with its own leg's `resolvedModel`) is the non-vacuity witness, and FAKEBIND is inert there — a
  real roster mints no placeholder. **C1 itself is NOT fixed and was not re-litigated**; this is a
  guard rail, per Global Constraint 11.
- **Earned, not asserted.** Two mutants, scratchpad-applied and reverse-edited byte-exactly (never
  `git checkout --`): **NOPLACEHOLDERFILTER** (drop the placeholder-bind filter alone) does NOT
  reach
  this shape — the leg's `launched` lookup resolves differently and the backstop drops it instead,
  `stillDeadRetryLegs = 0`, a DIFFERENT loss that happens to total the same 0.1600. **FAKEBIND**
  (drop that same filter AND give the placeholder the alias as its own id — a two-line
  change; both lines were `run-retry.js:132`/`:126` at `3b8cf781`, when the mutants were run,
  and both live in `stage1-bind.js :: bindPaddedWave` since v4.8 SI-27) reaches it
  exactly: 1 bound still-dead retry leg, `GAP = 0.0700`, precisely that leg's own `usage` sitting
  unconsumed in `retryLegBySeat`. The invariant is a CONJUNCTION — placeholder ids stay unique, and
  placeholder binds get dropped — break one alone and the loss lands somewhere else; break both and
  this finding fires.
- **Fuzz, at HEAD:** 1200 seeded runs (2–4 seat rosters, twins/triplets, partial returns, lens
  units, three leg-id shapes, heal/dead mixes) — 966 twin-roster runs, 697 BOUND still-dead retry
  legs observed, **0 violations** of "a bound still-dead retry leg always has an exact row."
- **Fed directly (bypassing the retry path, the shape built by hand), the loss is real and it is
  `usage`, not metadata.** `pushDeadSeatRows` loses 0.1600 of 0.1900 billed; both primary rows come
  out `{"status":"error","durationMs":null,"usage":null}`, the leg-less shape — confirming the
  council's structural read is right, IF the input could ever arrive.
- **Pre-existing, not introduced by this phase.** The identical fixture through `pushDeadSeatRows`
  loses the same 0.1600 at `42738592` (pre-A1) and at `main` (`cc56f678`) — `42738592`'s own
  `run-stage1-rows.js` already has the same `finalLeg = exact ? retryLegBySeat.get(join) : undefined`
  structure and the same `!exact` fallback. Nothing T2.2 shipped opened or closed this path.
- **The finding's own wording understates the fix.** Even if the `!exact` branch DID consult
  `retryLegBySeat`, a plain `.get(join)` would still miss: the row asks with the MINTED key
  (`legLossKey`'s alias-plus-taskId form, e.g. `"deepseek orphan-a"`) while the leg is filed under
  its bound seat id (e.g. `"deepseek#1"`) — different keyspaces. Closing this defensively would need
  a keyspace BRIDGE between the two, not a one-line lookup.
- **No test covers the LOSS, and none legitimately could — but the INVARIANT is now pinned (T-A7,
  above).** No fixture can hand the real retry path a bound still-dead retry leg with a `!exact`
  row, because nothing on that path produces one; what T-A7's pin asserts is exactly that — the
  pairing never occurs — which is why it goes red only when the conjunction is broken.
  `stillDeadRetryLegs` appears three times in
  `tests/council/run-stages.test.js`'s T2.2/T12/T14 block — empty in the `noRetry` fixture, unbound
  in *"T2.2 review A1: a borrowed spare is BILLING ONLY"*, and bound-but-incidental in *"T14: a
  superseded row carries NO seat, even on a twin bench"* (there `stillDeadRetryLegs` and
  `stillDeadLegs` are deliberately the SAME bound legs, so those rows are already `exact`). No
  fixture anywhere pairs a BOUND still-dead retry leg with a `!exact` row, and per the fuzz above, no
  real input the retry path can produce does either.
- **The comment this measurement earned.** The ⚠️ block immediately above `pushDeadSeatRows`'
  `let finalLeg = exact ? …` assignment (anchored BY SYMBOL at T-A5, having read
  `run-stage1-rows.js:171-175` at `5df88e26`; T-A6's split then took that file 295 ⇒ 212 and the
  block was `:156-161` at that reading and is `:158-168` today, v4.8 SI-27 having rewritten it
  — which is why the anchor is the symbol) now names
  `stage1-bind.js :: bindPaddedWave` as the reason its `exact`
  gate is safe — the cross-file half of the invariant nothing previously enforced or documented.
- **~~Concern for whoever extracts `run-retry.js` next~~ — DISCHARGED by T-A2 (2026-08-17).** The
  concern was that `run-retry.js` sat at 295/300, one FAKEBIND-sized change away from opening this
  hole for real, with nothing in either file's test suite going red if it did. The extraction landed
  (`run-retry.js` 295 ⇒ 263 **at T-A2**; the conjunction now lives in `run-retry-launch.js ::
  bindRetryWave`. ⚠️ **That headroom is SPENT — T-A4 and T-A6 took the file back to 295/300 by the
  end of this PR**, so the *pin* discharges the concern but the *size* margin does not; see the
  size table below)
  and it carried the asked-for pins: `tests/council/run-retry-launch.test.js` pins both halves
  directly — unique placeholder ids (named mutant **COLLIDEID**) and placeholder binds never
  reaching `retrySeatOf` (named mutant **NOPLACEHOLDERFILTER**) — plus identity-by-object pins on
  the move itself. The B1–B3 fixes remain owed; only this rider is closed.

⚠️ **A second, unrelated gap the same fuzz run surfaced (98/1200 runs) — recorded because it was
found in passing, not because it belongs to this PR.** The mirror image of the finding above: on a
bench whose seats WERE identified (real seat objects, not placeholders), a retry leg that binds to
NOTHING (matches no roster slot at all, a true stray — not merely unbound) is dropped by the `:216`
backstop before it ever reaches `stillDeadRetryLegs`: `launched` there is keyed by real seat id for
an identified bench, and the stray's own alias-based key misses. The SAME leg IS announced — on the
`seat-unbound` degrade channel (`orphanLegNote`, `stage1-bind.js:53`, called from
`run-stages.js:140`) — so this is a disclosed orphan-leg class, not a silent one, but its `usage`
reaches no runStats row at all. Measured instance: `BOUGHT 0.1000` vs `ON ROWS 0.0600`, the 0.0400
gap being the stray's own usage. **All three deciding lines — the placeholder-bind filter (then
`run-retry.js:132`, now `stage1-bind.js :: bindPaddedWave` since v4.8 SI-27), the `!ff` backstop
(then `:216`, now
`run-retry.js :: retryStage1Losses`), and `run-stages.js:140` — are byte-identical at `main` (`cc56f678`)**, so this
predates T2.2 and predates this PR. It is still not fixed here (out of this PR's scope). ⚠️ **The
size argument for deferring it is BACK.** T-A2 took `run-retry.js` from 295/300 to 263, but T-A4 and
T-A6 spent all of it: re-measured at the end of this PR the file is **295/300** again, five free
lines. Whoever takes this on needs an extraction first, not an edit.

- [x] **✅ SI-22.5 — a vote the matrix could not place had no column to land in, so it rendered
  nowhere. CLOSED 2026-08-20 by v4.8 T2.4 / PR C**, per owner ruling **R3** (render it) and **R18**
  (fold into ONE column). `774dcdc2` + `d82e2127` (council report) and `09212e97` + `fa0c5ae7`
  (Workspace matrix).
  ⚠️ **THIS WORK IS NOT SI-12, and an earlier draft of this entry said it was.** Owner ruling
  **R19** (2026-08-20): fold it into SI-22.5, do not mint a new identifier. **SI-12 is a different,
  still-OPEN defect** — *double-orphan conformance collapse* at `run.js :: runCouncil`, filed below
  as *"PR4 · a double-orphan collapses onto ONE conformance row in `run.js`'s Stage-2 merge"* and
  row `| 12 | OPEN |` of the live status table in
  `docs/superpowers/plans/2026-08-16-v48-phasing-and-rulings.md`. **Nothing in T2.4 touches it and
  nothing here closes it.**
  ⚠️ **How the mislabel happened, because the mechanism matters more than the slip.** The live
  status table writes its identifiers as a bare `| 12 |` column and never spells the string
  `SI-12`, so `git grep SI-12` returns two hits and misses the actual definition entirely. That is
  the same false-assurance class this file records as citation-gate Mechanisms A–D: **a search
  that cannot express its target reports nothing wrong.** The mislabel **predates this PR** — the
  phasing doc's T2.4 line has read *"SI-12 refuses to join on an unidentifying key"* since
  `4ee46696` (2026-08-16), and this PR inherited it rather than inventing it.
  - **What the defect was, by mechanism.** Both consumers keyed a vote's column on
    `(seatSpace && adj.seat) || adj.judge` and wrote `votes[thatKey]` with **no check that the key
    names a column** — so `''`, `undefined`, a non-string, or an orphaned seat id produced a junk
    entry that no column ever read. The vote was silently dropped from the render while remaining
    counted in `basis`, i.e. the artifact and the score disagreed. The Stage-2 orphaned-judge shape
    SI-22.5 was originally filed for is one case of that rule; the refusal closes the whole class.
  - **It is the consumer-side sibling of the defect PR B removed from
    `src/council/peer-split.js :: peersOf`** — there an unnamed raiser matched an unnamed judge and
    the vote self-corroborated; here an unidentifying key matched a column that did not exist.
    Same root: treating a non-identity as an identity.
  - **How it is closed.** Both consumers now CLASSIFY the key instead of trusting it, in a
    deliberately separate implementation per **R17** (no shared module, and the pre-existing
    `report.js`/`matrix-model.js` strictness asymmetry is explicitly out of scope):
    `src/council/report.js :: toModel` and `src/workspace/matrix-model.js :: buildMatrixModel`.
    A key that is not a non-empty string present in the column set folds to `UNATTRIBUTED`
    (ruling **R18** — one column, one concept) and the vote **stays in `basis`**.
    See shape 5 of "Five seat shapes the #137 peer fix does not close" below for the measured
    before/after.
  - **What T2.4 did, precisely.** Closed the unplaceable-vote class in both consumers by refusing a
    key that names no column; rendered it per R3 in a **conditional** `UNATTRIBUTED` column — it
    appears only when a vote actually folds, so a clean document is unchanged — with the vote still
    counted in `basis`; proved the two consumers agree by an **exhaustive** cross-product fuzz,
    **407 disagreements / 504 cases at `32a63e92`** (the tree with `report.js` fixed and
    `matrix-model.js` not yet) **→ 0 / 504** at `e5376399`, recorded at
    `tests/council/seat-matrix.test.js :: fuzzCases`; and **replaced** T22 shape 1's pin
    deliberately, rather than keeping it green.
  - ⚠️ **What T2.4 did NOT do. Do not tick these.** It did **not** close **SI-12** (above — a
    different defect entirely), and it did **not** close **SI-22.1** or **SI-22.2**. Per owner
    ruling **R2** the ambiguous *peer* drop still stays: `basis` does not move for it, the
    undercount deliberately remains, and the drop is announced
    (`findings[].unattributedPeerDrops`) rather than repaired. SI-22.5 is a **rendering** closure on
    the vote→column join; it says nothing about the peer filter, and nothing here makes the peer
    undercount fixed.
  - ⚠️ **One shape is deliberately NOT closed and is measured, not assumed — ruling R20.** A
    `judge: 'claude'` vote on a `claudeInCouncil: true` document is placed in **different columns**
    by the two consumers. See "R20 · the claude vote" under the NEXT LEVER entry below.

- [ ] **NEXT TASK — Phase 3: seat-keyed street cred + ledger.** Filed 2026-08-20 (v4.8 T2.4 / PR C)
  as the correct resume point, replacing the T2.4 / PR C entry that stood here. Phase 2's four PRs
  are all closed: **T2.1** `511cf43e` (2026-08-16 — `run-retry-group.js`'s `recordFailure` stopped
  open-coding `seatObj ? seatObj.id : seat` and now calls the `seatKey` rule **exported a few lines
  above it in that same file**; the docblock was updated to name it as an in-file consumer.
  ⚠️ **An earlier draft of this line said `511cf43e` made the file import `seatKey` from
  `run-retry-keys.js`. That is false and the commit disproves it**: no import is added, and
  `run-retry-keys.js` did not exist at that ref — it was created a day later by **T-A1**
  `955bd7c9`, and the file's own header at `511cf43e` reads *"Pure — parameters and builtins only,
  no requires."*), **T2.2** `33e2ecf7` + T-A3 `4413eb25` + T-A4 `1e385895`,
  **T2.3** `0fd630b6` + `e23e56cd`, **T2.4** this PR. ⚠️ The phasing doc marks T2.2, T2.3 and T2.4
  completed but has **never ticked T2.1** — it is closed in fact, un-ticked in that record.
  Scope is **T3.1–T3.3** — see the phasing doc's own **Phase 3** section
  (`docs/superpowers/plans/2026-08-16-v48-phasing-and-rulings.md`, named rather than lined: this
  entry's predecessor cited the phasing doc by line and the citation was stale before the commit
  finished, because a hunk written earlier in the SAME edit had already moved it). In short:
  SI-26 (`letterByModel` delete) lands first or folds in; seat onto `rankings[]` plus a seat-ified
  `assignLabels`/`rankingToOrder` (a schema change); then the fixed internal order
  `rankPositions` → peer split → `perJudgeRank` → `computeStreetCred` → ledger, including SI-17's
  **normalise** per ruling **R4**. ⚠️ **`src/council/ledger.js :: buildLedgerRows`' street-cred Map
  join must ship in the SAME PR** — the two twin street-cred rows are byte-identical today, which
  makes that join a no-op; seat-key `rankPositions` alone and they diverge, at which point the Map
  silently drops one and the fix is strictly worse than the bug. Closes SI-06, SI-18, SI-19,
  SI-20, SI-17; unblocks SI-25 site (3).
  ⚠️ **THAT CLAIM IS WRONG ABOUT SI-18 — measured, not merely disputed. Do not tick SI-18 off this
  entry.** SI-18 ("findings attributed by alias", anchored at the same `ledger.js :: buildLedgerRows`
  this PR also touches) is a DIFFERENT half of that function from the one this PR closes.
  `findings.filter(f => f.raiser === model)` — SI-18's own body — is byte-unchanged across every
  commit of this entire PR, measured with a zero-context diff against the state at Phase 3's own
  start (`f207538c`). What this PR closes at the same `buildLedgerRows` anchor is the STREET-CRED
  join (SI-20's third site), a neighbour, not SI-18 itself. See SI-18's own entry **below** —
  *"Findings are attributed by ALIAS, not by seat"* — for the
  un-narrowed scope. (⚠️ This read "above" until 2026-08-21, T5.4; that entry is below, not above.)
  ✅ **COMPLETED 2026-08-21 — v4.8 Phase 3: T3.1 (`13ae8cf6`+`a46e90cb`) + T3.2 (`b17a6329`+
  `b341b273`) + T3.3 (`fb3fa09d`+`1c5d36b9`+`05cfa5ac`+`46719a7f`+`8027391b`+`d766bc71`) + T3.4 (the
  citation/tracker sweep — no behaviour change).** SI-06, SI-17, SI-19 and SI-20 are closed — see
  each item's own ✅ block above for the mechanism and the measurement that proves it. SI-18 is
  explicitly NOT among them, per the correction immediately above. SI-25 site (3) is UNBLOCKED, not
  done: `briefings-chair.js :: buildChairPacket`'s `rankingLines` still renders `${r.judge}`
  alias-keyed and was not touched by this PR. T3.3's fix-round-1 baseline: 542 suites / 7782 passed
  / 8 skipped / 4 snapshots / 0 failed.
  ⚠️ **Both sentences above stay true OF PHASE 3 — do not read them as current state.** `rankingLines`
  has been seat-keyed since **2026-08-23, v4.8 SI-25 (`f7fe180d`)**: it now renders
  `` `${r.seat || r.judge}` `` with a per-slot `seatKeyedOrder` zip for the values. This entry's
  "UNBLOCKED, not done" is what made site (3) **homeless** — R15 had sent it to *this* PR — which is
  the whole reason ruling **R25-1** did all three sites at once. See the ticked *"chair packet is
  assembled entirely in alias space"* entry below.
  - **Council review of PR #177 (2026-08-21) — the first FULLY CLEAN run of this release.**
    `run complete · stage1 → stage2 → chair → tally → verdict all complete`, 390s, all four bench
    models produced street cred, **chair verdict "Ship it"**. Three Confirmed, all minor/nit, filed
    here rather than fixed in that PR because the chair cleared it and none is a correctness defect.
    - [ ] **A1 [minor] (glm, a3/d0/n0) — the `ids.length > 0` guard in `ledger-join.js :: credFor`
      is DESCRIBED as load-bearing but no dedicated test or mutant catches its removal in
      isolation.** ⚠️ The guard IS load-bearing — verified during T4.1's review by executing the
      guard-less variant, which returns `{}` on an empty group instead of the alias mean. The
      finding is about the PIN, not the guard: nothing would go red if a future edit dropped it.
      This is the same class the release calls "an empty red set means UNPINNED, not safe".
    - [ ] **B1 [minor] (qwen, a2/d1/n0 — note the ONE dispute, the only non-unanimous finding in
      this run) — duplicated-but-resolved seat ids within one pair group are unmeasured under the
      new all-or-nothing gate.** `credFor` dedupes with `[...new Set(ids)]`, so a group whose rows
      repeat a seat id contributes that seat once; the two branches' statistical behaviour differs
      more than T4.1's brief acknowledged. Measure before deciding — it may be correct as-is.
    - [ ] **B2 [nit] (qwen, a3/d0/n0) — `docs/council.md`'s `meta.models` table cell is now a dense
      paragraph** that renders poorly and is hostile to future editors. T4.2 added the row-count and
      order invariant there because it was the existing "street-cred universe" anchor; the content
      is right, the placement is cramped. Consider lifting it to prose beneath the table.
  - **Council review of PR #176 (2026-08-21) — the run was PARTIAL; two findings, both raised by
    one model and neither peer-adjudicated.** ⚠️ **The job passed and the review is still not
    clean** — read the verdict comment, not the status. Recorded state:
    `stage1:partial -> stage2:complete -> chair:error -> tally:complete`, **chair verdict
    unavailable** (no parseable VERDICT line, `overallVerdict: null`), and street-cred `n/a` for
    all four bench models, i.e. no usable rankings. Both findings scored `a0/d0/n0 - thin`
    (Singleton: no peer corroborated OR disputed either). Run duration 337s, so this is NOT the
    ~26s all-legs-dead OpenRouter key-limit signature — the legs ran, the chair failed.
    - **B1 [major] — "chair-synthesis conformance is discarded from reliability history whenever
      the chair shares a pair group with a bench leg." ALREADY OURS, not a new finding.** This is
      the exact consequence T3.3 measured, disclosed and filed: `ledger-join.js :: benchLegs`'
      docblock carries it with the end-to-end measurement (`{unstructured:1}` -> `{clean:1}`
      through `appendRun` -> `ledger-stats.js :: deriveReliability`), and `CHANGELOG.md` states it
      in the merged-rows entry. The council rediscovering it independently is corroboration that
      disclosing it was right. **Still awaiting an owner ruling**; repairing it means giving the
      chair its own ledger identity, which changes the row SET.
    - [x] **B2 [major] — an inconsistent `meta.seats` silently drops or invents street-cred rows
      relative to `meta.models`. CONFIRMED BY MEASUREMENT, filed not fixed.** Measured 2026-08-21
      against the shipped `street-cred.js :: credSeats`:

      ```
      models ['a','a','b'] + seats [a#1,a#2,b]  -> 3 rows   delta  0   (engine path, consistent)
      models ['a','a','b'] + seats [a#1,b]      -> 2 rows   delta -1   (a row is DROPPED)
      models ['a','b']     + seats [a#1,a#2,b]  -> 3 rows   delta +1   (a row is INVENTED)
      models ['a','b']     + seats [z#1,z#2]    -> 2 rows   delta  0   (alien alias ignored)
      ```

      The mechanism is `credSeats`' `expanded.has(m) -> continue`: the first occurrence of an
      alias expands to ONE ROW PER SEAT ID, and every later occurrence is skipped, so the row
      count follows `seats` rather than `models` wherever the two disagree.
      ⚠️ **This IS a surface v4.8 Phase 3 created.** At base `006bdec5` the signature was
      `computeStreetCred(rankings, models)` — `meta.seats` could not influence street cred at all,
      so a malformed seat table was simply ignored. Verified by opening the base file.
      ⚠️ **Unreachable on the engine path**, where `seats.js :: buildSeats` derives `meta.seats`
      from the same bench that becomes `meta.models`, so they agree by construction. Reachable on
      the two hand-assembled `appendRun` paths: `mcp-tools.js` declares `meta.seats` on
      `amicus_council_tally`, and `cli-handlers-council.js` passes user JSON verbatim. Those rows
      reach the append-only ledger.
      **Ruling (2026-08-21): FILE with the measurement, do not fix in PR #176.** Malformed-input
      only, and ruling **R2** governs — attribute nothing where there is nothing to attribute.
      This follows the T2.4 precedent exactly: the phantom `UNATTRIBUTED` column was likewise
      malformed-input-only, filed with its measurement, and fixed in a later task rather than late
      in a reviewed green PR. A fix belongs with its own tests and named mutant. Cost if wrong: a
      hand-assembled document with a bad seat table writes a wrong row count to the ledger until
      that fix lands.
      ✅ **CLOSED 2026-08-21 — v4.8 seat-resolution follow-up (`884e8e15`), Rule A.** `credSeats` no
      longer expands the first occurrence of an alias into every id the table registered for it
      while skipping every later occurrence: the k-th occurrence of alias `m` in `models` now takes
      the k-th id `byAlias.get(m)` registered for it, and once that list is exhausted (or the table
      never named `m` at all) the occurrence gets an alias-keyed row (`seat: null`) instead of being
      dropped. MEASURED against this item's own table, on the shipped `credSeats`: `partial` now
      returns `["a#1","a","b"]` (3 rows, was 2 — the DROP is closed) and `over-specified` now
      returns `["a#1","b"]` (2 rows, was 3 — the INVENT is closed).
      `rows.length === models.length` holds always, pinned as one invariant over a case list
      (consistent / partial / over-specified / alien-alias / no-seats / claude-tail) and killed by
      the named mutant `EXPANDONCE`, which reverts `credSeats` to this exact pre-fix algorithm.
      ⚠️ **Fix round 1 (`e21a660c`) found and disclosed one more consequence — not a defect this
      item ever claimed, and not part of what it closes.** On a NON-ADJACENT repeat — an ordinary
      engine bench, e.g. `--models a,b,a` — row ORDER also moves (`["a#1","b","a#2"]`, was
      `["a#1","a#2","b"]`); content is identical either way, only order changed. Fuzzed over 2178
      engine-shaped cases: 1368 order-only divergences, zero content divergences, zero
      length-invariant violations. Accepted by owner ruling — see `CHANGELOG.md`'s `[Unreleased]`
      street-cred entries (Fixed and Changed) for the full measurement and reasoning.
  - **⚠️ SUPERSEDED BY A REAL RUN — the council was RE-RUN on `4b2b5416` after the owner added
    OpenRouter credits, and this time it produced a verdict.** Run `32481536014`, **17m44s**
    (vs 36s credit-death and 337s degraded), `chair:complete`. **Chair verdict: "Fix these
    first" — 5 Confirmed, 0 Contested, 0 Disputed, 0 Singleton**, every one `a2/d0/n0 solid`.
    Still `stage1:partial`: kimi's leg died, so its street cred reads `n/a`. The block above is
    kept as the record of the two FAILED attempts — do not read it as this PR's review.
    ⚠️ **Collapsed to MECHANISMS per the standing rule that a repeated finding is not a stronger
    one: FIVE findings became THREE mechanisms, one of them new and one of them FALSE.**
    - **B1 (gpt) + C1 (glm) are the SAME mechanism** — the inconsistent-`meta.seats` defect filed
      immediately above, found INDEPENDENTLY by two models. Double-discovery is corroboration that
      the filing was right, not two problems.
    - **C3 (glm)** — SI-17's conformance time-inconsistency. Already disclosed in
      `ledger-join.js :: benchLegs`, in `CHANGELOG.md`, and in this entry.
    - **C2 (glm) — MEASURED FALSE. Recorded so nobody re-raises it.** Claim: `benchLegs` treats
      `judge`, `repair`, `superseded` and give-up roles as bench legs for the role/conformance
      decision. Measured end to end through `buildLedgerRows` on a group carrying `seat` + `judge`
      + `repair` + `superseded` rows: `conformance` came out **`clean`**, not `unstructured`.
      Those roles never reach `benchLegs`, because `ledger.js :: joinsLedger`'s fail-closed
      allowlist (`seat/critic/chair/claude/council/redteam` + `lens:*` + absent) drops them
      upstream. Direct control: `benchLegs([{role:'judge'},{role:'chair'},{role:'seat'}])` DOES
      return `judge`. **So the finding is true about the FUNCTION in isolation and false about the
      SYSTEM** — the function is permissive, its only caller is fail-closed. If a future producer
      is ever added to `LEDGER_JOIN_ROLES`, re-open this.
    - [x] **A1 (qwen) [minor] — REAL, NEW, and the only unfiled one. `credFor` reads only the
      IDENTIFIABLE seats of a pair group that mixes seated and seatless runStats rows.** Measured
      2026-08-21 against the shipped `ledger-join.js :: credFor`, with `a#1` at 1 and `a#2` at 5:

      ```
      both seated -> {withSelf:3, peersOnly:3}   mean of both seats
      MIXED       -> {withSelf:1, peersOnly:1}   a#1 only; the seatless row contributes nothing
      none seated -> {withSelf:3, peersOnly:3}   alias fallback reads BOTH
      ```

      ⚠️ **The inconsistency is the finding, not the drop:** a group that identifies ZERO seats
      reads MORE seats than one that identifies ONE. **Partial seat information produces a
      NARROWER read than no seat information.** It is the mirror of the Important-1 defect the
      T3.3 task review caught (seated streetCred + unseated runStats), and it is defensible under
      ruling **R2** — a seatless row has no identifiable street-cred row to contribute — but it is
      SILENT, and it lands in the append-only ledger.
      **⚠️ THESE THREE ARE ONE FOLLOW-UP PR, not three.** A1 above, plus the
      inconsistent-`meta.seats` mechanism filed immediately before it (council B1 = C1), are the
      same subject: how `ledger-join.js :: credFor` and `street-cred.js :: credSeats` resolve
      seats when the document's seat information is partial, inconsistent, or mixed. All three
      are unreachable on the engine path — `seats.js :: buildSeats` derives `meta.seats` from the
      same bench that becomes `meta.models`, and the engine always emits `runStats[].seat` for
      both twins — and all three are reachable on the two hand-assembled `appendRun` paths, whose
      rows reach a file that is never migrated.
      **Owner ruling 2026-08-21: MERGE Phase 3, fix this cluster in its own PR.** The chair said
      *"Fix these first"*, and that was weighed: the counter is that a focused PR reviews better
      than a late behaviour change bolted onto a 17-commit branch that is already green and
      four-times reviewed, and nothing here is reachable from the engine. The fix needs its own
      RED-before-GREEN tests and named mutants — treat it as a task, not a patch.
      ✅ **CLOSED 2026-08-21 — v4.8 seat-resolution follow-up (`884e8e15`), Rule B.** `credFor`'s
      seat lookup now wins only when EVERY row in the group resolves through `sc`
      (`ids.length > 0 && ids.every(id => id && sc.has(id))`); anything short of that — including
      the MIXED group this item measured — falls through to the same alias-mean fallback a
      fully-unseated group already used. MEASURED against this item's own scenario (`a#1` at 1,
      `a#2` at 5, `a#2` unresolvable through `sc`): `MIXED` now returns `{withSelf:3, peersOnly:3}`,
      identical to `none seated`, where it previously returned `{withSelf:1, peersOnly:1}` — `a#1`
      alone. Killed by the named mutant `ANYSEATED`, which reverts the gate to this exact pre-fix
      `seated.length ?` form. `ids.length > 0` is load-bearing on its own: `[].every(...)` is
      vacuously `true` in JavaScript, so without it an empty group would wrongly read as "fully
      identified" instead of falling through to the alias mean.
  ⚠️ **BUDGET AN EXTRACTION BEFORE TOUCHING `report.js`.** Measured at `0cb2d4d9` with the gate's
  own `checkFileSize`: **277/300, 23 free** (197 at the branch point; T2.4 added ~80 lines carrying
  roughly 10 of executable code — this file's comment style inflates fast). The next
  comment-worthy change hits the gate. Release constraint 6 is **extract, never shave**, and the
  clean leaf is the unattributed block (`columnFor` + `folded`/`judges` + its comment run).
  `matrix-model.js` at **212/300** is comfortable.
  - **Also waiting here: the four `src/`-side corrections T2.4 derived but could not
    apply.** T2.4 was a documentation task, forbidden from touching `src/` and `electron/`, so both
    are recorded rather than fixed — see "Citations T2.4 measured but could not apply" below.
  - ✅ **CLOSED 2026-08-21 by v4.8 Phase 5 — `report.js`'s citation rot, pre-existing.**
    ⚠️ **This bullet said "Also waiting here" and listed three live sites. It was NOT waiting any
    more when Phase 5 shipped, and it kept saying so — corrected in that branch's fix wave.** All
    three were repaired on that branch: `src/council/debate.js :: applyDebate`'s fail-open comment
    (T5.3, which also split the retier claim per join), `src/council/run-debate.js :: runDebate`'s
    `aliasOf` warning at its `applyDebate` call site, and `tests/council/debate.test.js`'s comment
    above the test named *"a genuinely new row carries the ALIAS in `judge` and the seat in
    `seat`"* (both T5.4). Each now names `report.js :: columnFor`'s vote→column join instead of the
    dead expression. **Measured 2026-08-21 by grepping the literal across `src/`, `electron/`,
    `tests/`, `scripts/` and `bin/`: exactly ONE occurrence survives**, and it is
    `tests/council/seat-matrix.test.js:75` — see the correction at the end of this bullet.
    ⚠️ The old anchor `src/council/debate.js:89` now resolves to a bare `}`. The other two still
    land inside the repaired comment blocks — re-opened, both are now the `columnFor` line — but
    only because T5.4's repairs were line-count-neutral, which is not a property to rely on. Read
    the symbols.
    Three comments cited
    `byJudge[adj.judge]` verbatim; the real expression has not been that since the seat-space fix,
    so all three were already stale when written. ⚠️ **Re-derived 2026-08-20 (T2.4) and the
    correction itself has moved on**: this entry used to say the real expression was
    `byJudge[(seatSpace && adj.seat) || adj.judge]` at `report.js:98`. Both halves are now false —
    T2.4 replaced it with `byJudge[columnFor(adj)]`, and `columnFor` is where
    `(seatSpace && adj.seat) || adj.judge` is now computed **and then classified**, so a key that
    names no column folds to `UNATTRIBUTED` instead of being written raw. Anchored by symbol so it
    stops rotting: `src/council/report.js :: toModel`. Re-derived current sites 2026-08-19 (v4.8 T-B3):
    `src/council/debate.js:89`, `src/council/run-debate.js:202`,
    `tests/council/debate.test.js:155`. NOT a fourth site:
    `tests/council/seat-matrix.test.js:75` uses the same bare string DELIBERATELY, to name the
    pre-fix behaviour the T17/T18 fixture exists to disprove — read in context, it is not a live
    claim about `report.js` today.
    ⚠️ **THAT LAST CHARACTERIZATION IS FALSE — measured and corrected 2026-08-21 (v4.8 Phase 5 fix
    wave), and it is now the ONLY live carrier of the literal in the whole tree.** Opened: `:75`
    reads *"Under **the shipped** alias last-wins (`byJudge[adj.judge]`) the two twins overwrite
    each other…"* — **present tense**, and "the shipped" describes behaviour v4.8 T-C1 (SI-22.5)
    replaced with `byJudge[columnFor(adj)]`. It is not framed as history and carries no date or
    annotation; the file's other T-C1 references are properly historical, this one is not. Its
    surrounding sentence is explaining why the FIXTURE is shaped as it is, which is the strongest
    reading available for it — but "not a live claim" over-states that, and the earlier reading was
    reached without opening the line. **Deliberately left unfixed on the Phase 5 branch by owner
    ruling** (it is a test comment, out of that branch's scope, and parking it was preferred to a
    late edit); filed here so the next reader inherits the measurement rather than the mistake.
  - **Citations T2.4 measured but could not apply — all four live under `src/`.** T2.4 was a
    documentation and bookkeeping task, explicitly forbidden from editing `src/` and `electron/`.
    Each correction below was **derived by opening the cited line**, never by offset arithmetic.
    Whoever next edits these files should apply them; none is urgent and none affects behaviour.
    1. `src/council/ledger.js:41` cites **`docs/council.md:562`** for the quoted phrase *"the legacy
       default `council` (pre-#83 rows, or hand-assembled tally input that never set a role)"*.
       Opened: `docs/council.md:562` is `` (`src/council/tally.js`). `` — unrelated. The phrase is at
       **`docs/council.md:589`**, in the tally-input schema table. ⚠️ Prefer naming the row over
       renumbering: Mechanism D means nothing can check either form. `tests/council/ledger.test.js`
       carried the **verbatim twin** of this citation and T2.4 did fix that one, so the two now
       differ — deliberately, not by oversight.
    2. `src/council/report.js:100` cites **`docs/council.md:326`** for *"this is the street-cred
       universe"*. Opened: `:326` is re-vote-leg prose — unrelated, and it was already wrong before
       this release. The phrase is at **`docs/council.md:574`**, the `meta.models` row of the
       `### Tally-input schema` table. Its verbatim twin in
       `tests/council/report-claude-column.test.js` was fixed by T2.4.
    3. `src/workspace/seat-space.js:22` cites **`src/workspace/matrix-model.js:25`**, which is
       **still TRUE at `e5376399`** — line 25 is
       `const { SYMBOL, isSeatSpace } = require('../council/report');`. It is filed anyway because
       it survived T-C2 only by luck: every insertion that task made was routed below it, and it
       points at a bare `require` line with **no symbol to anchor to**. One docblock edit above it
       and it rots silently. The durable fix is to name what it means (`matrix-model.js` imports
       `isSeatSpace` from `report.js`) rather than to cite the import's line.
    4. **RR-1 is WITHDRAWN — the sentence it attacked was TRUE, and `src/council/report.js` needs no
       edit.** Recorded here because three parties in a row got it wrong and the next reader will
       otherwise re-open it. ⚠️ **The real defect is that the phrase "the three schema-free
       `JSON.parse` entry points" has TWO conflicting enumerations in this repo**, and every
       disagreement about it is really a disagreement about which one is meant:

       | Enumeration | Set | Where |
       |---|---|---|
       | **A** | `council report <verdict.json>`, `council verdict <tally.json> --render`, `amicus_verdict` (`record: z.record(z.any())`) | `src/council/report.js :: isSeatSpace`'s docblock; `docs/superpowers/plans/2026-08-14-v48-pr4c-seat-spine.md:694` |
       | **B** | `cli-handlers-council.js`'s `runTally`, `runReport`, `runVerdict` — with `amicus_verdict` listed **separately** as *"plus R4c-5's permissive zod"* | `docs/superpowers/plans/2026-08-14-v48-pr4c-seat-spine.md:751` |

       **The `adjOf` docblock names its own referent** — *"`isSeatSpace` **above** … for the same
       reason"* — so it means **A**. And the test comment it pairs with named its referent too:
       *"the same three … **as a malformed seats table**"*. Under A the two sets coincide, so both
       sentences were **correct as written**.
       **Measured** by enumerating every `buildReport` caller in live code: `runReport`
       (`cli-handlers-council.js:97`), `runVerdict` on `--render` (`:212`, via `buildVerdict`, which
       copies `adjudications` straight through at `verdict.js:134`), `run-verdict-files.js:44`
       (engine-internal, not schema-free), and `mcp-server.js :: amicus_verdict` (`:1466`/`:1476`).
       `runTally` never calls `buildReport` at all. So a non-array `adjudications` reaches exactly
       **A** — the same three a malformed seats table reaches.
       ⚠️ **The error chain, recorded so it is not repeated:** a re-reviewer flagged the sentence
       reading it as **B**; the controller carried the flag; T2.4 rewrote the test comment to say
       *"NOT through the same three … the real reach is three DIFFERENT things"* — which is **A**
       relabelled, i.e. it declared a true sentence false while restating its content. **T2.4 fix
       round 1 reverted that rewrite**, dropping the count entirely rather than picking a side.
       No `src/` edit is required and none was made.
  - **NEXT LEVER after Phase 3's own scope: the roster SOURCES, which nothing has ever proven.**
    Filed 2026-08-20 (v4.8 T2.4 / PR C) as the largest remaining drift surface between the two
    consumers. `report.js :: toModel` builds its roster from **`verdict.seats` / `verdict.council`**;
    `matrix-model.js :: buildMatrixModel` builds its roster from **`tally.meta.seats` /
    `tally.meta.models`** — plus a `claudeTail` **on the seat-space branch only**, and with **no
    claude filter on the alias branch at all** (see R20 below, where that asymmetry is measured). T2.4's fuzz proved the two agree about how they
    **READ** a roster, but it is **exclusion 2** of that fuzz — both documents are built from ONE
    roster literal by construction — so the two *sources* agreeing is unproven by anything.
    ⚠️ **Deliberately ruled out of PR C, and the reason is not effort**: it is a different property.
    It is a claim about how `run-assemble`/`verdict` **BUILD** the two documents, not about how the
    consumers read them, and it is ruling **R17**'s residual cost. **The rig already exists** —
    T2.4's harness generalises cheaply, one `disagreement()` function over a case list
    (`tests/council/seat-matrix.test.js :: disagreement`), so the next taker inherits a working
    fuzz rather than starting one.
    - ⚠️ **R20 · the claude vote — the FIRST measured instance of this lever costing something.**
      Owner ruling **R20** (2026-08-20): **disclose, pin and file. Do not align the rosters** — that
      stays out of PR C per **R17**. On a `claudeInCouncil: true` document a `judge: 'claude'`
      adjudication lands in **different columns** in the two consumers.
      ⚠️ **THE CAUSE IS AN ABSENT FILTER, NOT `claudeTail`** — an earlier draft of this filing,
      and of R20's own ruling text, said `matrix-model.js` "re-appends it as `claudeTail`". That is
      **inverted**, and measurably false on the pinned fixture. What actually happens:
      `report.js :: toModel` **FILTERS** the reserved `claude` seat OUT of its own roster when the
      flag is on (`claudeInCouncil === true ? council.filter(j => j !== 'claude') : council`), so
      `columns.has('claude')` is false and the vote **folds to `UNATTRIBUTED`**;
      `matrix-model.js :: buildMatrixModel` has **no counterpart filter at all** — its alias branch
      is a bare `aliasJudges.map(...)` over `meta.models`, which carries `claude`, so the vote lands
      in the **`claude` column**. That file's own comment already said so: *"report.js filters the
      reserved claude seat out of ITS roster; this one never has."*
      ⚠️ **`claudeTail` does the OPPOSITE job, on the OTHER branch.** It is concatenated only on
      the **seat-space** arm, where it RE-ADDS claude because `meta.seats` is bench-only. The pinned
      fixture is **alias space**, so that arm is never taken — measured control: rebuilding the
      module with `claudeTail = []` leaves the divergence **unchanged**.
      ⚠️ **The flag flips `report.js` ONLY.** Measured in alias space at both values: at `false`
      both consumers give `["deepseek","gpt","claude"]` and AGREE; at `true` only `report.js` moves.
      **This is what the roster-SOURCES work needs to aim at: the missing alias-side filter, not
      `claudeTail`.** Measured at `0cb2d4d9` on one document carrying
      `{judge:'claude',verdict:'dispute'}` + `{judge:'gpt',verdict:'agree'}`:

      ```
      report  judges  ["deepseek","gpt","UNATTRIBUTED"]  byJudge {"deepseek":null,"gpt":"agree","UNATTRIBUTED":"dispute"}
      matrix  columns ["deepseek","gpt","claude"]        cells   [null,"agree","dispute"]
      basis   {a:1,d:1,n:0} on BOTH — unmoved, as everywhere else in this release
      ```

  - **Council review of PR #175 (2026-08-20, chair verdict "Ship it") — four items filed, not fixed.**
    Thirteen findings collapsed to five mechanisms; three were already disclosed in the PR body and
    one did not hold. ⚠️ **The null-`adjudications`-element finding was raised FOUR times (A1/C2/B1/D2)
    and was NOT a regression** — measured on both trees, `ed5c0c02` and the branch tip threw the
    identical `Cannot read properties of null (reading 'judge')`. The new pre-pass was a second crash
    SITE in the code, with the observable behaviour unchanged. ✅ **CLOSED 2026-08-20 by v4.8 T-C4**,
    which was aimed at the falsy-element divergence below and closed this with the same expression:
    `adjOf`'s `.filter(Boolean)` drops `null` before either phase can dereference it, so the
    strictness asymmetry with `matrix-model.js` — real when this was filed — is gone.
    - [ ] **`UNATTRIBUTED` is not exported from either consumer.** Measured 2026-08-20: absent from
      `src/council/report.js`'s and `src/workspace/matrix-model.js`'s `module.exports`, and **39**
      occurrences of the bare string across `tests/` (the council said "~50"; 39 is the measured
      count under `grep -rc "'UNATTRIBUTED'|"UNATTRIBUTED"" tests/`). A rename in one file would
      not be caught by that file's own tests. ⚠️ Exporting a CONSTANT for test use does not breach
      **R17**, which forbids sharing the RULE; do not let the fix drift into a shared `columnFor`.
    - [ ] **`columnFor` is computed twice per adjudication** — `report.js:166` (the `folded`
      pre-pass) and `:178` (the build loop); `matrix-model.js:152` and `:167`. Inherent to the
      two-phase build, worst in the common no-fold case. Measure before optimising.
    - [ ] **Two folded votes on one finding collapse to ONE cell, last-wins** (council A4). Measured
      and pinned as measured during T-C1; it is disclosed in code but not in the PR body. Not a
      defect of this PR — the same last-wins applies to any two votes sharing a column — but the
      `UNATTRIBUTED` column is the one guaranteed to collect multiple votes.
    - [x] **✅ CLOSED 2026-08-20 by v4.8 T-C4 — a FALSY adjudication element grew a PHANTOM EMPTY
      column, and the two consumers diverged on it** (council run 2, A2 — the only NEW finding in
      that run, and the finding that flipped run 3's chair verdict to "Fix these first"). Measured
      2026-08-20 against `ed5c0c02` for elements `0`, `false` and `''`:

      ```
      BASE md header: | Finding | Sev | Raiser | deepseek | Tier | Decision |
      HEAD md header: | Finding | Sev | Raiser | deepseek | UNATTRIBUTED | Tier | Decision |
      matrix columns: [deepseek]   (skipped by the `!adj` guard — no column)
      ```

      `columnFor` classified the element as unattributable (its `.seat`/`.judge` are `undefined`),
      so `folded` was true and the column was added — but the cell value is `adj.verdict`, also
      `undefined`, so the column rendered **blank**. It advertised an unattributable vote and showed
      nothing. `matrix-model.js` skipped the element entirely via its `!adj` guard, so the two
      consumers rendered one document differently — the exact class T2.4 exists to close. It was a
      behaviour change introduced by T2.4, not a pre-existing shape.

      **THE FIX** (`a515400c` → T-C4): `src/council/report.js :: adjOf` gained `.filter(Boolean)` —
      `matrix-model.js`'s `!adj` predicate spelled a SECOND time, never shared, per **R17**.
      ⚠️ **The prototype circulated with the task was `a && typeof a === 'object'`, and measurement
      rejected it**: over ten element types against the live `matrix-model.js`, `filter(Boolean)`
      disagrees on **0 of 10** and that expression on **3 of 10** — it drops TRUTHY non-objects
      (`42`, `'x'`, `true`) which the other consumer keeps, closing one divergence by opening three.
      ⚠️ **`null` and `undefined` moved from THROW to render**, deliberately and pinned: the same
      widening already taken for the adjudications CONTAINER at T-C1 fix round 1. This also closes
      the null-element crash noted at the head of this block, in `report.js`'s BOTH phases — that
      note's "the strictness asymmetry with `matrix-model.js` is real" no longer holds.

      **THE AXIS THAT MISSED IT IS FIXED TOO.** The agreement fuzz varied `seatSpace` × `adj.seat` ×
      `adj.judge` × roster shape over well-formed OBJECTS; the element TYPE was never on it. T-C4
      added it — **504 → 564 cases** — and measured, all against the 564-case axis:

      | comparison | disagreements |
      |---|---|
      | `a515400c:report.js` × shipped `matrix-model.js` | **60 / 564** (24 column · 12 placement · 24 throw) |
      | shipped `report.js` × `32a63e92:matrix-model.js` | **408 / 564** (284 column · 124 placement) |
      | shipped × shipped | **0 / 564** |

      All 60 of T-C4's are on the new element axis (12 per element, 20 per roster shape); the 504
      object cases scored 0 at that BASE, which is precisely why the old axis could not see this.

      ⚠️ **STILL OPEN, AND SPLIT OUT BELOW RATHER THAN CLOSED HERE:** a TRUTHY non-object element.
    - [ ] **A TRUTHY NON-OBJECT adjudication element still grows a blank `UNATTRIBUTED` column — on
      BOTH consumers, identically.** Split out of the item above by v4.8 T-C4, which found it while
      measuring that fix rather than being told about it. Measured 2026-08-20 on the shipped tree:

      ```
      element   report.js columns                    matrix-model.js columns
      42        [deepseek#1, UNATTRIBUTED]           [deepseek#1, UNATTRIBUTED]
      'x'       [deepseek#1, UNATTRIBUTED]           [deepseek#1, UNATTRIBUTED]
      true      [deepseek#1, UNATTRIBUTED]           [deepseek#1, UNATTRIBUTED]
      []  {}    [deepseek#1, UNATTRIBUTED]           [deepseek#1, UNATTRIBUTED]
      ```

      It is the SAME phantom-blank-column defect — a primitive has no `.verdict`, so the cell is
      empty — but it is **not a desync**: both consumers do the identical thing, so SI-22.5's
      agreement property holds. That is why T-C4 pinned it as agreement rather than fixing it
      one-sidedly: `report.js`-only strictness is exactly the prototype T-C4 measured and rejected.
      ⚠️ **Closing it requires editing BOTH consumers** (each spelling the predicate separately, per
      **R17**) — a scope call, not an implementer's, which is why it is filed instead of taken.
      Pinned meanwhile in `tests/council/seat-matrix.test.js` (the T-C4 block's preservation pins),
      so it cannot become a desync without a test failing.
    - [ ] **The synthetic `UNATTRIBUTED` matrix cell may silently no-op on click** (council/codex 6).
      `electron/workspace-ui/workspace-panels.js :: drillIntoJudge` builds its file list from the real
      bench roster, which has no `UNATTRIBUTED` entry. ⚠️ **REPORTED, NOT VERIFIED** — confirming the
      no-op needs the UI driven, which this filing did not do. No test simulates the click.

      **It is carved out of the agreement fuzz BY CONSTRUCTION** (exclusion 3: `claudeInCouncil` is
      always false and no roster carries `claude`, so `claudeTail` never fires) — which is a
      statement about the fixtures, not about the world. The exclusion was honestly named; **its
      cost was nowhere measured until now.** Both behaviours are now PINNED in
      `tests/council/seat-matrix.test.js` so neither can drift silently.
      ⚠️ **Reachability is the same class as every other shape this PR pins**:
      `run-stage2.js:61-62` guarantees no engine run emits such a vote, but `council report
      <verdict.json>`, `council verdict --render` and `amicus_verdict` are all schema-free — which
      is exactly why `''`, a non-string `judge` and an orphan seat id are in scope.
      ⚠️ **This shape also forced a correction to the column's DOCUMENTED MEANING.** The prose
      glossed `UNATTRIBUTED` as *"nobody could attribute these"*; here the document names the voter
      explicitly (`judge: "claude"`), so that gloss would make the artifact assert something false.
      The code's rule is *"no **column** for this key on this document's bench"*, which is not the
      same rule as *"no **identity** for this vote*". `docs/council.md` and `CHANGELOG.md` were
      corrected to the code's rule.
  - **The four named mutants this release's peer-split safety net stands on are all in the tree
    now, not behind a report path.** `NAIVESPLIT`, `ZEROEMIT` and `SCHEMADROP` already were;
    `SPLITDROP` joined them this round (measured 2026-08-19, v4.8 T-B3: 2 suites / 9 tests, out of
    541 / 7655). Point at any of them by symbol, never by report path. ⚠️ **v4.8 T-B5 (council C4)
    MOVED the five that mutate `peer-split.js` out of it, byte-for-byte, into
    `tests/council/peer-split-mutants.js`**, because that file had reached 289/300: point at
    `peer-split-mutants.js :: SPLITDROP` and `peer-split-mutants.js :: ZEROEMIT`. `SCHEMADROP` did
    not move — it mutates the schema, not that module — and is still in its own comment block at
    `tests/council/run-schema-debate.test.js:199`.
    ⚠️ **SIX as of v4.8 T-B4, all re-measured against the tree that ships, by re-running rather
    than renumbering — twice, because T-B4 took two rounds and the second changed behaviour again.**
    `SELFCORROB` and `SEATBLIND` joined them. T-B4's final measured red sets, all out of 541 / 7665
    — superseded twice at T-B5, see the block below for the values at HEAD:
    `SPLITDROP` 2/9 → 2/6 → 1/4; `NAIVESPLIT` 17/97 → 17/98 → 17/109;
    `ZEROEMIT` 4/5 → 4/6 → **4 / 8**; `SCHEMADROP` **1 / 1** throughout; `SELFCORROB` 3/15;
    `SEATBLIND` 2/5.
    ⚠️ **RE-RUN TWICE MORE AT v4.8 T-B5, AND THE SECOND RE-RUN UNDID THE FIRST.** Fix round 1 added
    a volume pin to `tests/council/peer-split.test.js` asserting `peer-split.js`'s executable LINE
    COUNT; every mutant that respells the ternary silently gained one red test that caught a reformat
    rather than a behaviour change, so round 2 re-ran all six and recorded the inflated sets
    (`SPLITDROP` 1/5, `NAIVESPLIT` 17/110, `SELFCORROB` 3/16, `SEATBLIND` 2/6). Round 3 then removed
    the coupling on council finding C2 — the anti-vacuity guard now pins `executableText()` directly
    instead of the file it reads — and all six were re-run a THIRD time.
    **FINAL, measured at `a3372721`, all out of 541 / 7674:** `SPLITDROP` **1 suite / 4 tests**;
    `NAIVESPLIT` **17 suites / 109 tests**; `SELFCORROB` **3 suites / 15 tests**; `SEATBLIND`
    **2 suites / 5 tests**; `ZEROEMIT` **4 / 8**; `SCHEMADROP` **1 / 1**. The four inflated sets each
    shrank by exactly the one test, back to their pre-pin values; the two that never touch
    `peer-split.js` never moved. The denominator went 7665 → 7674 because round 3 added nine
    extractor tests. ⚠️ Two structural lessons, both paid for: **a red set recorded before a pin
    existed is stale BY CONSTRUCTION** — re-run every mutant after adding, removing or reshaping ANY
    pin in that file — and **a pin that names a property of the file under test will fire on every
    honest change to it**, so guard the tool, not the text it reads.
    ⚠️ `SELFCORROB`'s total is the same in both rounds while its COMPOSITION is not
    (peer-split 8 → 10, tally 3 → 1) — two matching totals are not evidence of a matching red set,
    which is why every one of these was re-run. The counts are not here: since v4.8 T-B5 they live
    in `tests/council/peer-split-mutants.js`, and `peer-split.js :: peersOf` and
    `peer-split.js :: unattributedPeerDrops` each carry a one-line anchor to it.
  - **Council round 2 on PR #174 (run `32331788257`) returned 6 findings on near-identical code
    after round 1 returned 1 — this council's documented non-convergence — so every one was
    adjudicated BY MEASUREMENT, not on vote weight. Two were DECLINED, and the reasons are here so
    the next round does not re-raise them as new:**
    - **C2 [major] "the MCP tool schema still accepts empty strings for `raiser` and `judge`" —
      DECLINED as ALREADY FILED, not as wrong.** It is true and it is the OPEN item further down
      this file (`raiser` and `judge` should be `z.string().min(1)`), raised by T-B4 itself and
      re-verified present at T-B5. It is pre-existing; it does **not** subsume the T-B4 fix, because
      `cli-handlers-council.js` reaches `tally()` through a raw `JSON.parse` with no schema at all;
      and tightening the boundary has its own blast radius. `docs/council.md:580` already documents
      the shape for callers. **No schema changed.**
    - **C1 [major, CONTESTED a1/d1] "`basis` deliberately does not count it, leaving tier and
      confidence knowingly incorrect" — DECLINED: it is a disagreement with owner ruling R2, not a
      defect.** R2 is *mark explicitly, attribute nothing*, and the behaviour is disclosed at
      `docs/council.md:658` and in `CHANGELOG.md`. Counting that vote reproduces `NAIVESPLIT`'s
      outcome and re-arms #137 — the measured reason the ruling exists. ⚠️ **The R2 disclosure is
      not to be weakened, hedged or re-litigated while editing nearby prose**; T-B5 edited the
      sentence immediately after it and left it byte-identical.

- [ ] **NEXT TASK — Phase 4: R5, seat id on the live leg row.** Filed 2026-08-21 (v4.8 Phase 3 T3.4)
  as the correct resume point, replacing the Phase 3 entry above (now ✅ COMPLETED). Per the phasing
  doc's own task list (`docs/superpowers/plans/2026-08-16-v48-phasing-and-rulings.md`, Phase 4):
  extend `writeLegPatch` (`src/sidecar/fanout-leg.js :: runSingleAttempt`) so `src/observe/council-legs.js ::
  buildLegRow` reads the seat off `metadata.json`, threading from `run-stage1-launch.js`'s
  `seated[].roster`; then through `live-normalize.js :: seatOf`. Makes
  `electron/workspace-ui/live-dead-seats.js:209`'s `if (s.seat)` arm — re-verified 2026-08-21 at
  BASE (`1832b9c7`), dead on the live path at every measurement before this phase, since neither
  `buildLegRow` nor any live-tick payload emitted `.seat` there — actually live.
  ⚠️ **Ordering is PREFERENCE ONLY, not a hard gate.** The phasing doc's own §6 lists "Phase 3 vs
  Phase 4 order" among preference-only orderings, so nothing in Phase 3's closure forces Phase 4
  next over Phase 5 (SI-10/SI-13, the debate join) or Phase 6's independents — this entry follows
  the phasing doc's own §5 listing order, not a discovered dependency. Re-derive before starting.
  ⚠️ **Citation correction (v4.8 T4.6):** the symbol above read `:: runLeg` until this pass —
  measured, `runLeg` is a 6-line dispatcher with no `writeLegPatch` call; the write sites are both
  inside `runSingleAttempt`. Corrected here and in the phasing doc's own Phase 4 line, case-
  insensitive repo sweep confirmed clean. The line number in the sentence above was also stale
  (`:207` → `:209`, the arm moved when T4.5's comment rewrite grew the file above it) and is
  corrected the same way. The mechanism this line describes was, and remains, correct — a
  citation repair, not a truth repair. ⚠️ **Fix round (reviewer finding):** this annotation
  previously said the sentence's CLAIM "was, and remains, accurate" — that overclaimed. Only the
  citation was repaired; the "still dead" claim is now explicitly scoped to BASE, immediately
  above, because it stopped being true the moment T4.1–T4.5 shipped — three lines below it, in
  this same paragraph.
  ✅ **COMPLETED 2026-08-21 — v4.8 Phase 4: T4.1 (`e42b6aaa`) + T4.2 (`49c2313d`+`41d6f793`) + T4.3
  (`3c95bd18`+`94fdb76b`+`2294ce8a`+`c009c7eb`+`3e5ad689`) + T4.4 (`40b26dde`+`2d69a987`) + T4.5
  (`b9c760a5`+`6a944404`) + T4.6 (this bookkeeping pass, no behaviour change).** The Stage-1 roster
  now threads through the fanout transport (`fanout-wave-io.js :: stampLegAttribution`, stamping
  `leg.seat` emit-when-DIFFERENT against the seat's own alias — the same predicate
  `run-stats-entry.js :: buildRunStatsEntry` and the three `run-assemble.js` sites already share) to
  `metadata.json` (`fanout-leg.js :: runSingleAttempt`), and back out through
  `council-legs.js :: buildLegRow` / `live-normalize.js :: seatOf`.
  `electron/workspace-ui/live-dead-seats.js:209`'s `if (s.seat)` arm — dead on the live path at
  every measurement before this phase — **now executes there**, pinned end to end by the named
  mutant `LIVESEATBLIND` (red set 2). A unique-alias bench writes nothing new to `metadata.json`
  (byte-identical to pre-R5); the composed live doc is **not** byte-identical regardless — every
  leg row gains an explicit `seat: null` (T4.4's annotation). Four named mutants recorded and
  hand-reverted end to end: `SEATALIAS` 2 · `SEATSLOPPY` (the surgical form) 1 · `SEATDROP` 2 ·
  `LIVESEATBLIND` 2. Threaded only from Stage 1's initial launch, per scope — chair, debate,
  repair, and the Stage-1 retry wave (`run-retry.js :: retryStage1Losses`, a separate Stage-1
  launch site) all launch without a roster and are unchanged; a retried twin's live row still
  reports `seat: null` (filed below, not fixed here). T4.6 also re-anchored two rotted citations by
  symbol: `:: runLeg` (this
  entry, above) and `run-assemble.js:89` (`electron/workspace-ui/live-seats.js`,
  `workspace-seats.js`, `tests/workspace/seat-panel-twins.test.js` — that line is
  `labelClaudeReview`'s docblock, unrelated to seats; the real producer is
  `run-stats-entry.js :: buildRunStatsEntry`). Final measured state (`npm test`, this task, not
  T4.3's mid-phase baseline): 544 suites / 7810 passed / 8 skipped / 0 failed.

- [ ] **Filed, not fixed (v4.8 Phase 4 final whole-branch review, 2026-08-21) — the Stage-1 retry
  wave still launches without a seat roster.** R5 (above) threads the seat roster from
  `run-stage1-launch.js`'s `seated[].roster` through to the live leg row — spec-compliant, since
  the spec named only that launch site. But `run-retry.js :: retryStage1Losses` is ALSO a Stage-1
  launch, and its own launch `common` object (`run-retry.js:90-96`) forwards `councilRunId`,
  `councilName`, `tag`, `fallback`, `catalog` and `retryOfWaveId` — and no `seats`. User-visible
  consequence: on a twin bench where `a#1` dies and is retried, the retried leg's live row still
  reports `seat: null`, so `live-dead-seats.js:209`'s `if (s.seat)` suppression arm stays dark for
  exactly the seat that most needed it. Forwarding `unit.seats` (index-parallel with `unit.models`)
  is NOT the one-liner it looks like: `run-retry.js:138`'s own comment already warns the two are
  "NOT lockstep by construction" — only emergently so, on invariants that comment states but this
  task never measured. That index-parallelism must be MEASURED with its own probe before any
  `seats` key rides this launch, plus RED-before-GREEN and a named mutant of its own — a task, not
  a fix-wave line.

- [ ] **Filed, not fixed (v4.8 Phase 4 council review, PR #178, 2026-08-21) —
  `stampLegAttribution`'s index-parallel contract is unenforced at the function boundary and has no
  MISALIGNMENT test.** Council findings **A1** [major, glm] and **B1** [minor, qwen] are one
  mechanism, both unanimous (a3/d0/n0). `src/sidecar/fanout-wave-io.js :: stampLegAttribution`
  stamps `legs[i].seat` from `options.seats[i]`, so the two arrays being index-parallel is
  load-bearing: a misaligned roster silently attributes a leg to the **wrong** seat, which is worse
  than no seat at all — a wrong `alias#N` on a live row would make `live-dead-seats.js:209`'s
  suppression arm hide the wrong dead candidate.
  ⚠️ **Correct A1's own wording before acting on it: the property is NOT "asserted only by
  comment".** It was measured twice — v4.8 T4.1 ran a probe against the real `launchStage1` across
  five bench shapes (including a non-adjacent repeated alias and a critic that is also a bench
  alias), and the whole-branch reviewer independently traced all three Stage-1 launch shapes
  (seat wave, lens, critic solo) plus `fanout-validate.js`'s one-leg-per-model loop. The accurate
  statement is B1's narrower one: **the contract is unenforced at the boundary, and no committed
  test ever feeds `stampLegAttribution` a misaligned roster.** Every committed fixture is aligned,
  so the mutants pin the predicate and the bounds guard but not the ordering.
  Cheapest useful fix is a test that passes a deliberately permuted `seats` and pins what happens,
  plus a decision on whether the function should detect it at all (it currently cannot — seat
  objects carry `alias`, so `s.alias !== leg.modelInput` IS a detectable misalignment signal, but
  reading `modelInput` there would couple this function to leg shape; that trade-off is the
  task's real question, not a foregone conclusion).

- [ ] **NEXT TASK — Phase 6: Independents.** Filed 2026-08-21 (v4.8 Phase 5 T5.4) as the correct
  resume point, replacing the Phase 5 entry that stood here (now ✅ COMPLETED — SI-10 closed by T5.1+T5.2, SI-13 by
  T5.3; both ticked in this file and both moved OPEN → DONE in the phasing doc's §1 status table).
  ⚠️ **T5.5 landed on the same branch on 2026-08-22, after this entry was written** (`f19624c4` +
  `8d40f4f5`), closing the two mechanisms a paid council confirmed against PR #179: the guard's
  `boundLegs` arm is deleted, and the refusal's exit-2 consequence is pinned end to end. It does
  **not** move the resume point — Phase 6 is still next — but the Phase 5 commit list above is
  T5.1–T5.3 only, and this is the rest of it.
  Per the phasing doc's own task list
  (`docs/superpowers/plans/2026-08-16-v48-phasing-and-rulings.md`, Phase 6): **~6 PRs, each ships
  alone** —
  - ~~**SI-22.4 trim.** ⚠️ Carries a knock-on the item itself does not name: trimming turns a
    whitespace-padded preset member into a **REAL twin bench**, so artifact filenames change and
    `meta.seats` starts emitting. Budget for that, it is not a pure input-hygiene fix.~~
    **DONE — v4.8 SI-22.4 (2026-08-23, `1c7a9087` + `4c49becc` + `f771f59b`).** The knock-on
    warning was RIGHT and is proved from the artifacts. ⚠️ **It was also incomplete**: the knock-on
    is not the only thing the item failed to name — measured over six shapes, ALL SIX change
    behaviour and four of the six gain a **paid leg** that was not launched before. Budget for the
    spend as well as the filenames. Full record: the ticked SI-22 item 4 below.
  - ~~**SI-23** — `location` stripped on the MCP tally path. Own PR, ruling **R10**: fix the closed
    `z.object` properly, so `evidence`/`file`/`line` stop dropping too.~~ **DONE — v4.8 Wave 2
    (2026-08-22, `d5378684`, PR #183).** ⚠️ **R10's own list was wrong on three of four names** —
    `evidence`/`file`/`line` have no producer and no consumer anywhere in this codebase's finding
    shape; only `location` was real (see R10's annotation, phasing doc §4, and the dedicated entry
    below). `mcp-tools.js`'s closed `z.object` now declares `location`, and `tally.js ::
    tally`'s `outFindings` map — independently dropping it regardless of validation, CLI path too
    — now forwards it emit-when-present. A same-PR fix round (council A1/B1) found and closed the
    identical gap for `claim` one line below. Named mutants: `SCHEMASTRIP` (remove the schema
    declaration) RED 2 tests / 1 suite — reproduced directly by this record via hand-mutation and
    a full `npx jest --no-coverage` run, not merely read off the commit, since the commit itself
    never states this count; `CLAIMDROP` (delete the `claim` forward) RED 2 suites / 2 tests, per
    the commit. See the dedicated entry below for the `verdict.json` scope this does NOT close.
  - ~~**SI-24** — both sites, **including the unfiled `computeStreetCred` data-loss site**. Row 24 of
    the status table records that T3.3 closed only the `perJudgeRank` half.~~ **DONE — v4.8 Phase 6
    PR1 (2026-08-22).** Four carriers closed at the table, not two sites; see status-table row
    `| 24 |` and the dedicated entry below (`VERDICTS[v.verdict]` resolves INHERITED keys).
  - ~~**SI-14** — the twin pin ("nothing pins that the launcher must NOT de-duplicate
    `models`").~~ **DONE — v4.8 Wave 1 (2026-08-22, `424cb63d`).** Named test pin in
    `tests/sidecar/fanout.test.js` plus an invariant comment; `parseModelsList` itself is
    byte-unchanged (W1-2: a pin, not a code change). Named mutant `MODELSUNIQ`, red set 3 tests /
    1 suite. See the dedicated entry below (§ "A hardening note — nothing pins...").
  - ~~**T6.5** — repair-row seat.~~ **DROPPED 2026-08-22 (v4.8 release inventory, owner
    ruling) — it was never specified.** A repo-wide grep for `T6.5` returned exactly two
    hits: this line and its twin in the phasing doc's Phase 6 list. No filed defect, no
    anchor, no description of what "repair-row seat" meant. Struck rather than carried —
    if it named something real it will resurface with an actual defect behind it.
  - ~~**T6.6** — the `skills/` doc-fact gate.~~ **DONE — v4.8 Wave 1 (2026-08-22, `c0a7c728`).**
    See the dedicated warning block below, now annotated.
  - **SI-25 sites (1)+(2)**, ruling **R15**; site (3) rode Phase 3 and is unblocked.
    ⚠️ **"rode Phase 3" is FALSE and was false when written** — Phase 3 UNBLOCKED site (3) and
    deliberately did not do it (its own plan, verbatim, twice). This is the sentence the later
    resume points inherited the error from. **All three sites shipped together on 2026-08-23**
    (v4.8 SI-25, ruling **R25-1**) — see the ticked *"chair packet is assembled entirely in alias
    space"* entry below. Note also that the same wrong reading is baked into the
    *"`Phase 3 → SI-25 site (3)` is shipped"* clause a few lines below: what shipped there is
    **Phase 3**, the prerequisite — not site (3).

  ⚠️ **Phase 6 is now down to TWO independents: SI-22.4, SI-25 sites (1)+(2).** (⚠️ **ONE since
  2026-08-23** — SI-25 shipped, all three sites; only `SI-22.4` remains.) (⚠️ **ZERO since later
  the same day, 2026-08-23** — `SI-22.4` shipped too; **Phase 6 is CLOSED and v4.8.0 is
  feature-complete.** Live resume point: *"NEXT TASK — Wave 3 remainder"* below.) SI-24
  shipped at PR1, T6.5 was dropped, T6.6 + SI-14 shipped together in v4.8 Wave 1
  (T-W1.1/T-W1.2, 2026-08-22) alongside #135 C0 (Phase 7), and SI-23 shipped in v4.8 Wave 2
  (2026-08-22, `d5378684`). ⚠️ **The resume point past this point is
  no longer "Phase 6 then Phase 7" — see "NEXT TASK — Wave 2.5" below**, which supersedes the
  Phase-6-then-Phase-7 sequencing (and Wave 2's own 3-wide slot, now done) with the owner's
  wave-structure ruling.
  ⚠️ **Ordering is PREFERENCE ONLY — re-derived at Phase 5's own BASE and carried forward here so
  the next controller need not derive it a third time.** Nothing in the phasing doc §6 "genuinely
  gating (mechanical)" list forces any particular order **among Phase 6's independents**, and
  nothing gates Phase 6 as a whole any more: its Phase-5-adjacent entry (`R5 → any seat-keyed
  suppression on the live tick`) discharged when Phase 4 merged, `T1.1`/`T1.2` and `R2 → T2.2/T2.3/
  T2.4` are all shipped, `Phase 3 → SI-25 site (3)` is shipped, and `SI-22.4 → SI-17's refuse
  branch` is doubly moot (R4 ruled for normalise, and row 17 is DONE). §6's own "preference only"
  line already reads *"everything within Phases 5, 6, 7"*. **Phase 5 was named ahead of Phase 6
  only because the phasing doc's §5 lists it first — and it is now done**, so Phase 6's members may
  be taken in any order. Re-derive before starting, exactly as this paragraph asked of Phases 4
  and 5 — this file is not re-derived as later work lands.
  ⚠️ **T6.6 is a LIVE defect, not scaffolding, and all four of its anchors were re-derived
  2026-08-21 (T5.4) rather than copied.** `tally.js :: assignTier` (`:28`) returns **Confirmed**
  (`confidence: thin`) for `(a=1, d=0)` — measured by execution, not read off the source — while
  `skills/second-opinion/SKILL.md:299` and `skills/second-opinion/COUNCIL-DESIGN.md:158` **both**
  define Singleton as *"`d = 0` and `a < 2`"*, which would make that same cell Singleton.
  `docs/council.md` is the one that is correct: its cascade table (`:662-673`) gives Confirmed for
  `a === 1 && d === 0` at `:667`, and `:671` states it in prose. ⚠️ **The phasing doc's own quote
  of this cites `COUNCIL-DESIGN.md:155`, which is the *Disputed* row — corrected there and here in
  the same pass; and its `docs/council.md:662` is the cascade heading, not the deciding row.**

  ✅ **DONE — v4.8 Wave 1, T-W1.1 (2026-08-22, `c0a7c728`).** Re-verified `assignTier` by
  execution (not by reading source) across ten boundary `(a,d)` pairs before writing the fix.
  Both files now read Confirmed as "`a ≥ 2` and `a > d`, or `a = 1` and `d = 0`" and Singleton as
  "else (`a = 0` and `d = 0`)", matching `docs/council.md`'s cascade table, which was already
  correct and is unchanged. **A second, uncited twin surfaced while fixing this**: `SKILL.md` also
  carried a prose paraphrase two paragraphs from the cited line — "at most one endorsement, no
  pushback" — asserting the same false claim in different words; fixed in the same commit.
  `COUNCIL-DESIGN.md`'s Confirmed row was independently incomplete (it never listed the `a=1,d=0`
  case at all) and was corrected alongside its Singleton row, in the same commit. A repo-wide grep
  for the old definition and the "at most one endorsement" phrase, across live (non-dated-snapshot)
  `.md` files, found no further occurrence.
  ⚠️ **"Never tick SI-18" is HISTORY, not current — SI-18 shipped 2026-08-22 (`78ed7a40`, v4.8
  Wave 2) and its own entry below is now ticked `[x]`.** This warned not to tick it because an
  earlier phase (T3.3) closed only its street-cred half; see SI-18's own entry
  **below**, titled *"Findings are attributed by ALIAS, not by seat"*, for the fix and its
  verification (searched for by title, not
  cited by line — a line number here would rot on the next insertion above it). ⚠️ **That
  back-reference read "above" until 2026-08-21 (T5.4); the entry is below this line, not above it.** ⚠️ **Do not tick SI-12 either** (ruling **R19**) — it is row `| 12 |`, *double-orphan
  conformance collapse*, and is not what T2.4 closed.

- [ ] **NEXT TASK — Wave 2.** Filed 2026-08-22 (v4.8 Wave 1 T-W1.2) as the correct resume point,
  superseding the Phase-6-then-Phase-7 sequencing above (that entry is now ✅ PARTIALLY COMPLETED —
  T6.6 + SI-14 + `#135 C0` closed by Wave 1; `SI-22.4`, `SI-23`, `SI-25` sites (1)+(2), `SI-18`,
  `#133 Piece 1` and `#138` remain, redistributed into the wave structure below).

  ✅ **The 3-wide slot is DONE — 2026-08-22.** All three landed as separate PRs in isolated
  worktrees, none touching this record (deliberate, so they could not conflict here): `SI-18`
  (`78ed7a40`, PR #184), `SI-23` (`d5378684`, PR #183), `#133 Piece 1` (`86a069a6`, PR #185, also
  `main`'s current HEAD). Merged `main`: 544 suites / 7861 passed / 8 skipped, all gates 0. ⚠️ **The
  "then" half of this ruling — `SI-25` sites (1)+(2) and `#138` Pieces 1+2 — did NOT ship as part
  of this** and stays open; do not read "Wave 2 done" as covering it. See **"NEXT TASK — Wave
  2.5"** below for the live resume point — R16 next, then Wave 3.
  ⚠️ **Of that "then" half, `SI-25` has since shipped** — 2026-08-23, its own PR, **all three** sites
  (ruling R25-1), never inside a wave. ⚠️ **`#138` Pieces 1+2 are now DONE** — branch
  `fix/138-model-level-default` (2026-08-24), not yet merged to `main`; see the ✅ entry at
  `:6023` for the full record.

  **Owner ruling (2026-08-22) — the wave structure for the remainder of v4.8.0:**
  - **Wave 1** — batched, one PR. **DONE** (this PR: `T6.6`, `SI-14`, `#135 C0`).
  - **Wave 2** — run **3-wide in isolated worktrees**: `SI-23` (own PR, ruling R10) · `#133 Piece 1`
    (ruling R13, `opencodeSessionId`) · `SI-18` (`ledger.js :: buildLedgerRows`'s
    `findings.filter(f => f.raiser === model)` alias-collapse, newly promoted into v4.8.0 scope by
    the release inventory below) — **then** `SI-25` sites (1)+(2) (ruling R15) · `#138` Pieces 1+2.
    The "then" is a real ordering, not a fourth parallel slot — re-derive why before starting; this
    line does not carry the reason.
  - **Wave 2.5** — `R16` (`sessions-index.json` leak). Scope it from the growth entry under
    *"Carried from the dropped v4.7.2 scope"* (below), **not** from the owner-rulings table's own
    "pin all 13 unpinned rails" wording — see **W1-4** in the v4.8 release inventory section below;
    the number 13 is unsourced.
  - **Wave 3** — **strictly serial**: `SI-27` **first** (consolidates the padding/bind/placeholder
    core into `stage1-bind.js`, the useful slice of rulings R11/R14), `SI-22.4` **LAST**.
    ⚠️ **SI-22.4 is ordered last on purpose**: its trim knock-on turns a whitespace-padded preset
    member into a **real twin bench**, which changes artifact filenames and starts `meta.seats`
    emission — sequencing it before `SI-27` would make `SI-27`'s consolidation absorb that shape
    change instead of the other way around.
    ✅ **BOTH SHIPPED 2026-08-23, in this order** — `SI-27` first, then `SI-22.4`. Wave 3 is DONE
    and the ordering rationale held. Nothing on this bullet is outstanding.
  Not in any wave, **deferred to v4.9** per **W1-4**: `#135 C5`, the `#135 C2` probe. **Dropped**
  per **W1-3**: the `mcp-server.js:684` one-liner, the `listCouncilRuns` "dedupe" claim (6 rows / 5
  ids) — ⚠️ **not** the same as the live *"Council runs are invisible to CLI `amicus list`"* entry
  (`mcp-council-awareness.js:205`, filed under v4.7 PR3 rider findings), which stays filed.

- [ ] **NEXT TASK — Wave 2.5.** Filed 2026-08-22 (v4.8 Wave 2 record) as the correct resume point,
  superseding "NEXT TASK — Wave 2" above (now ✅ its 3-wide slot DONE — `SI-18`/`SI-23`/`#133 Piece
  1`, commits above; its "then" half — `SI-25` sites (1)+(2), `#138` Pieces 1+2 — did NOT ship and
  is not scheduled into any wave below; see the note at the end of this entry).

  ✅ **DONE — 2026-08-22.** `R16` shipped as `T-R16.1` (`0a6a8032` — ⚠️ a dangling pre-squash
  hash; the on-`main` commit is `dda1b8cf`, PR #187's squash — corrected at the v4.9 kickoff,
  2026-08-25) — see the ticked
  `sessions-index.json` growth entry above for the full record. Suite after merge: 545 suites /
  7882 passed / 8 skipped, all six gates exit 0. See **"NEXT TASK — Wave 3"** below for the live
  resume point.

  **Wave 1 — DONE.** **Wave 2 (3-wide slot) — DONE.** **Wave 2.5 (`R16`) — DONE.** Next:
  - **Wave 3 — strictly serial: `SI-27` first, `SI-22.4` LAST.** `SI-27` consolidates the
    padding/bind/placeholder core into `stage1-bind.js` (the useful slice of rulings R11/R14).
    ⚠️ **`SI-22.4` is ordered last on purpose**: its trim knock-on turns a whitespace-padded preset
    member into a **real twin bench**, which changes artifact filenames and starts `meta.seats`
    emission — sequencing it before `SI-27` would make `SI-27`'s consolidation absorb that shape
    change instead of the other way around.

  ⚠️ **Remaining Phase 6 members after Wave 2: `SI-22.4`** (now Wave 3's last item, above) **and
  `SI-25` sites (1)+(2)** (ruling R15 — small PR, sites in `briefings-chair.js`/`run-assemble.js`;
  not yet placed in a wave below — schedule it, do not assume it rides Wave 3). ⚠️ **`SI-25` was
  scheduled and SHIPPED on 2026-08-23** — its own PR, outside every wave, and **all three** sites
  rather than the two named here (ruling R25-1). ⚠️ **`SI-22.4` also SHIPPED 2026-08-23** — Wave 3's
  last item, as ordered; **neither member named on this line is outstanding.** ⚠️ **`#138`
  Pieces 1+2 are now DONE** — branch `fix/138-model-level-default` (2026-08-24), not yet merged
  to `main`; see the ✅ entry at `:6023` for the full record.

  ⚠️ **Carry forward: `src/council/run-retry.js` is at 300/300, ZERO headroom** (see the dedicated
  warning immediately below — unchanged by `R16`, which does not touch that file).
  ⚠️ **CORRECTED 2026-08-23: this said `SI-27` extracts from that very file. It does NOT** — see
  the corrected paragraph at the end of this entry, and row 27's anchor in the phasing doc.
  `run-retry.js` holds no roster-padding site, so nothing in the rest of v4.8.0 relieves it; the
  next change there must extract first, per Release Constraint 6.

- [ ] **NEXT TASK — Wave 3.** Filed 2026-08-22 (v4.8 Wave 2.5 record, `T-R16.2`) as the correct
  resume point, superseding "NEXT TASK — Wave 2.5" above (now ✅ DONE — `R16`/`T-R16.1`, commit
  above).

  ✅ **SI-27 — DONE 2026-08-23.** The roster pad / bind / drop-placeholder core is consolidated
  into `stage1-bind.js :: bindPaddedWave(waveId, rosterSource, aliasAt, legs)`, which returns
  `{seatOf, bindRes, placeholders}` and now serves all three sites —
  `run-retry-launch.js :: bindRetryWave`, `run-stage2.js :: runStage2` and
  `run-debate-revote.js :: runRevoteWave`. **Each site keeps its own orphan/missing tail**
  (push / degrade.note / nothing), exactly as ruling **R14** and SI-DUP disposition (a) specified.
  **The whole branch, in order** — cited as four commits until 2026-08-23, which was the CODE
  half only. `9b059842` + `8e1c8e24` (the anchor correction and the four carriers it missed —
  both PRE-BASE, and the reason this item's site list is trustworthy at all) · `8b06c5e5` (plan) ·
  `80680c9f` (extraction) · `ed827eaa` + `68bee03e` (the measured red sets, the second retracting
  a blast-radius claim the plan asserted and measurement disproved) · `d29a3462` (fix round 1) ·
  `943a047b` (this record) · `9b712414` (rider (2)'s counting rule) · `747c3a3e` + the final-review
  fixes. BASE for the code half is `8b06c5e5`; for the branch, `dda1b8cf`.

  **Sizes, BASE → HEAD:** `stage1-bind.js` 86 → 142 · `run-retry-launch.js` 67 → 55 ·
  `run-stage2.js` 213 → 207 · `run-debate-revote.js` 274 → 268 · `run-stage1-rows.js` 214 → 220.
  Suite at HEAD: **545/545 suites, 7891 passed, 8 skipped, 0 failed**; `check:sizes`,
  `check:citations` and `lint` all exit 0.

  ⚠️ **The blast-radius property — state it in these terms and not stronger.** One
  `NOPLACEHOLDERFILTER` edit in `bindPaddedWave` now reds **19 tests across four suites**:
  `run-retry-launch.test.js` (4), `run-retry.test.js` (9), `run-stages.test.js` (2),
  `run-debate.test.js` (4). ⚠️ **The plan claimed that before SI-27 the same mutation "could only
  red the first". That was FALSE and was measured false:** reconstructing the pre-SI-27 topology
  at the retry site gave **14 tests across THREE suites** — `run-retry.test.js` and
  `run-stages.test.js`’s T2.2 already reached `bindRetryWave` through
  `run-retry.js :: retryStage1Losses`. **The measured gain is +5 tests and exactly ONE new suite**
  (`run-debate.test.js`). **Never write "one file became four."** The plan asserted a blast radius
  from where the code SAT instead of measuring which suites DRIVE it — plan-authoring failure
  mode #8, the asserted property.

  **Other measured red sets, none empty:** `PREFIXID` 2 tests / 2 suites (subsumes Finding 3) ·
  `COLLIDEID` 1 / 1 · `RAWROSTER` 5 / 3 · `PLACEHOLDERLEAK` (ex-`M3`, still a call-site
  mutation) 1 / 1 · `ROSTERLEN` (new pin) 1 / 1.

  ⚠️ **`run-retry.js` IS in this diff, by exactly one comment line — ruling P5.** R27-1 and the
  plan’s §0.2/§0.6 said the file "is not touched at all" / "DO NOT TOUCH"; P5 overrode that for
  one line. `run-retry.js:22`’s comment said *"briefingFor + the retry roster pad/bind step live
  in ./run-retry-launch"*, which SI-27 made half false. **The fence existed to prevent GROWTH in a
  300/300 file, not to preserve a false sentence**; the reword was one line → one line and the
  file is still exactly **300/300**, `check:sizes` exit 0. **Any sentence saying SI-27 left that
  file untouched is false** — say instead that SI-27 changed one comment line in it and it
  remains at 300/300 with zero headroom. ⚠️ And do not let the anchor correction rot back: SI-27’s
  **sites** never included `run-retry.js`, and it gains no headroom from the consolidation.

  **Wave 1 — DONE. Wave 2 (3-wide slot) — DONE. Wave 2.5 (`R16`) — DONE.** Next (as filed
  2026-08-22; `SI-27` has since shipped — see the record above and "NEXT TASK — Wave 3
  remainder" below):
  - **Wave 3 — strictly serial: `SI-27` first, `SI-22.4` LAST.** Same scope and ordering as stated
    in "NEXT TASK — Wave 2.5" above — not restated a second time here.

  ⚠️ **Remaining Phase 6 members: `SI-22.4`** (Wave 3's last item) **and `SI-25` sites (1)+(2)**
  (ruling R15 — not yet placed in a wave; schedule it, do not assume it rides Wave 3).
  ⚠️ **`SI-25` SHIPPED 2026-08-23** — own PR, outside every wave, **all three** sites (R25-1). The
  only remaining Phase 6 member is `SI-22.4`. ⚠️ **`SI-22.4` SHIPPED later the same day — Phase 6
  has NO remaining members.**

  ⚠️ **Carry forward: `src/council/run-retry.js` is at 300/300, ZERO headroom**, unchanged by `R16`
  — see the dedicated warning immediately below. ⚠️ **CORRECTED 2026-08-23: this said `SI-27`
  extracts from that very file. It does NOT** — no wave in the rest of v4.8.0 EXTRACTS from it,
  and nothing relieves its 300/300. ⚠️ **Precise since 2026-08-23: `SI-27` did change one comment
  line in it (ruling P5, one line → one line, still exactly 300/300).** "Not a site" and "not
  touched at all" are different claims; only the first is true.

  ⚠️ **New since Wave 2.5: the file-size gate is at saturation more broadly, and
  `cli-handlers-doctor.js` is now 299/300.** Re-measured against the final tree — see the two
  dedicated entries below (*"The file-size gate is at saturation"* and *"`cli-handlers-doctor.js`
  is at 299/300"*). Neither blocks Wave 3. ⚠️ **CORRECTED 2026-08-22: this sentence said
  `SI-27`'s own target is `run-retry.js`. It is NOT.** SI-27's three roster-padding sites are
  `run-retry-launch.js :: bindRetryWave` (67/300 then; **55/300 since SI-27**), `run-stage2.js`
  (213/300 then; **207/300**) and
  `run-debate-revote.js` (274/300 then; **268/300**) — `run-retry.js` holds no padding site at
  all. **So SI-27
  does not relieve its 300/300**; that file stays saturated after Wave 3 and remains a standing
  hazard for whoever next touches it. See row 27's corrected anchor for why the wrong file was
  carried: SI-27 once covered `seatKey` duplication in `run-retry.js`, PR5c/T-A1 moved that
  definition out to `run-retry-keys.js`, the item narrowed to roster-padding, and the anchor
  column never followed. A fossil, not a typo.

- [ ] **NEXT TASK — Wave 3 remainder.** Filed 2026-08-23 (the SI-27 record) as the correct resume
  point, superseding "NEXT TASK — Wave 3" above (now ✅ its `SI-27` slot DONE — commits in that
  entry).

  **Wave 1 — DONE. Wave 2 (3-wide slot) — DONE. Wave 2.5 (`R16`) — DONE. Wave 3: `SI-27` —
  DONE. `SI-25` — DONE (2026-08-23). `SI-22.4` — DONE (2026-08-23).**
  ⚠️ **v4.8.0 IS FEATURE-COMPLETE. Only the release run remains.** In order:
  1. ~~**`SI-25` sites (1)+(2)** — ruling **R15**, anchor `briefings-chair.js :: buildChairPacket`
     (three sites; site (3) already shipped in Phase 3). ⚠️ **Not yet placed in a wave — schedule
     it, do not assume it rides Wave 3.**~~ **DONE — 2026-08-23**, own PR on branch
     `v48-si25-chair-packet-seats` (`f7fe180d` + `0c06bca9` + `95ee5520`). ⚠️ **Two corrections to
     the struck line.** (a) **It shipped ALL THREE sites, not (1)+(2)** — ruling **R25-1**, and that
     is not scope creep; R15's home for site (3) evaporated when Phase 3 unblocked-but-did-not-do it.
     (b) **"site (3) already shipped in Phase 3" was FALSE when written.** Phase 3's own plan says
     the opposite verbatim, twice — *"Phase 3 UNBLOCKS it; Phase 3 does not do it"* — and measured at
     this branch's BASE `c0745013`, the rankings line was still `` `${r.judge}:
     ${JSON.stringify(r.order)}` ``. Full record, mutants and sizes: the ticked *"chair packet is
     assembled entirely in alias space"* entry below.
  2. ~~**`SI-22.4`** — anchor `utils/config.js :: classifyCouncilMembers`. **LAST**, because its
     trim turns a whitespace-padded preset member into a REAL twin bench: artifact filenames
     change and `meta.seats` starts emitting. That is exactly why it could not precede `SI-27`.
     It is now the **only** remaining item before the release.~~ ✅ **DONE — 2026-08-23**, branch
     `v48-si22.4-preset-trim`, BASE `ecf90f19` (`1c7a9087` + `4c49becc` + `f771f59b`; plan
     `276d5a18`). **The ordering rationale held exactly**: the trim does turn a padded preset into a
     REAL twin bench, proved from the artifacts rather than from `buildSeats`.
     ⚠️ **And the filing UNDERSTATED it** — all six measured shapes change behaviour, and the
     dominant effect is **RESURRECTION, not de-duplication**: a member dropped today starts running,
     a new paid leg on four of the six. Full record: the ticked SI-22 item 4 below (mutants, gates,
     suite counts); the six-row table has one home, in `CHANGELOG.md`.
  3. **Release — THIS IS NOW THE NEXT TASK.** Version pin across 6 files → CHANGELOG → tag →
     `publish.yml`.

  ⚠️ **Carry forward, unchanged: `src/council/run-retry.js` is at 300/300, ZERO headroom.**
  `SI-27` changed one comment line in it (ruling P5) and it remains at exactly 300/300.
  **Nothing in the remainder of v4.8.0 relieves it** — it is the one saturated file with no
  scheduled extraction, and the next change to it must extract first (Release Constraint 6:
  EXTRACT, never shave a comment). See the dedicated 300/300 entry below.
  ⚠️ **Carry forward, NEW 2026-08-23: `src/council/run-assemble.js` is now 278/300** (was 271 before
  SI-25 added the seat forward to its reviews projection), and `src/council/briefings-chair.js` is
  **243/300** (was 182). Both are still clear, but neither has the headroom the Phase 1 size note
  further down this file records for them — read the sizes here, not there.

- [ ] **SI-22.4 rider (1) — four `src/` comments name "a padded `--council` member" as a live
  cause. STALE EXAMPLES, NOT MOVED FENCES — filed so a later sweep does not re-litigate this.**
  `src/council/run-assemble.js:168`, `src/council/run-stats-entry.js:62`, `src/council/run.js:198`
  and `src/sidecar/fanout-wave-io.js:103` each justify the emit-when-DIFFERENT seat predicate with
  a **disjunction**: *a leg that reports no `modelInput`* (which falls back to the RESOLVED id)
  **or** *a padded `--council` member*. SI-22.4 killed the producer of the second disjunct only.
  The first is still live, so the predicate, the reasoning and **the reader's action are unchanged**
  — these comments name an example that moved, not a fence that moved. All four re-read at their
  stated lines against the final tree, 2026-08-23.
  ⚠️ **Do not "fix" these by deleting the predicate.** The **first** disjunct — a leg with no
  `modelInput` — is live and is what the predicate is for.
  ⚠️ **But do NOT restate the padded half as "still reachable via the MCP `models` array" either.**
  Fix round 1 traced it to the end and that is FALSE: `mcp-council-bench.js :: resolveBenchInput`
  returns `input.models` untrimmed, but its **single** consumer (`mcp-council-run.js:107`) always
  spawns the CLI child with `--models bench.join(',')` (`:177`), the child re-parses through
  `cli-council-run-bench.js :: parseList`, which trims, and `runCouncil` is **not exported from
  `src/index.js`**. No padded value reaches a bench alias by any in-tree route.
  ⚠️ **The tests keep their padded-bench cases anyway, and their "do not retire this case" note
  STANDS — the REASON was wrong, not the coverage.** The shape is constructible at the unit
  boundary those tests call, and it is the only shape that SEPARATES the two operands
  (`seat.id !== r.model` vs `seat.id !== seat.alias`), which is the property they exist to pin.
  Reword opportunistically, when one of those four files is open for another reason.

- [x] **SI-22.4 fix round 2 (council B1) — the alias table inherited `Object.prototype`, and the
  preset trim WIDENED it into a regression.** Closed 2026-08-23 in the SI-22.4 branch.
  `config.js :: getEffectiveAliases` returned `{ ...DEFAULT_ALIASES, ...userAliases }` — a normal
  object — so `aliases['toString']` resolved off the prototype to a truthy `Function`. Measured on
  the real function, BASE `ecf90f19` vs fixed:

  | member | BASE | fixed |
  |---|---|---|
  | `'toString'` | **accepted** | dropped |
  | `'toString '` | dropped | dropped |
  | `'gpt '` | dropped | **accepted** (SI-22.4's intended effect, preserved) |
  | `'nope '` | dropped | dropped |

  Row 2 is the regression this PR introduced: at BASE the padded spelling missed the prototype and
  was correctly dropped; trimming before the lookup landed it on the inherited property.
  ⚠️ **Fixed at the producer, not the call site** — `__proto__: null`, one line, closing **five**
  bare-indexing gates: `config.js :: resolveModel` (`:111`/`:142`), `classifyCouncilMembers`,
  `council/presets-cli.js:41`, `pack/pack-validate.js:71`, `utils/route-launch.js:205`.
  ⚠️ **`directFormProvenance` keeps its bare `{}` deliberately — and the reason first recorded for
  that was FALSE.** It said "its only indexed read ... never user input"; there are **two** readers
  (`gateway-route-audit.js :: auditGatewayRoutes`, curated-keyed, and `alias-audit.js ::
  findStaleAliases`, keyed from `collectAliasSources()` which pushes the user's own `cfg.aliases`
  entries and a raw CLI arg). The decision survives on two independent grounds — the guard needs
  BOTH `source === 'defaults'` (false for a user alias) and `prov.directForm === 'derived'` (false
  for an inherited Function, which has no such property) — so it fails open, as documented. Full
  reasoning in `tests/council/preset-trim-mutants.js`. **Same shape as this branch's other false
  absolutes: right conclusion, premise from a sweep that found one of two.**

  ⚠️ **The reviewer's call-site list needed one correction, measured:** `config.js ::
  buildProviderModels` is **not** affected — its only use of the table is an `Object.entries(aliases)`
  loop, own-enumerable and therefore immune. (Anchored BY SYMBOL: this sentence originally read
  `config.js:292` and `:318`, which were the BASE `6bf41071` lines and had ALREADY rotted inside the
  very commit that wrote them — the same commit's +38 lines moved them, and at HEAD `:292`/`:318`
  are docblock prose. **Fifth line-citation rot on this branch**, and `check:citations` gives no
  cover: its scan set excludes `.md`, so `BACKLOG.md` and `CHANGELOG.md` are never scanned. The rule
  that would have caught it: re-measure any line number you keep **after** your last edit to that
  file, not before it.) The fifth affected gate is `resolveModel`, which
  the list did not name and which is the **worst** of the five: it returns the inherited `Function`
  itself where every caller expects a model-id string, instead of throwing "Unknown model alias".
  ⚠️ **Same defect class this release already closed elsewhere**, enumerated rather than counted
  (the counts drift): `tally.js :: VERDICTS`, `report.js :: SYMBOL`, `debate.js :: PAST_TENSE` use
  `__proto__: null`; `street-cred.js :: perJudgeRank` and `report.js :: ROLE_SUFFIX` use
  `Object.create(null)`, the same guarantee in the other spelling. **The alias table was not among
  them** — stated as the observable fact rather than as a claim about what SI-24 did or did not
  sweep for.
  ⚠️ **Scope ruling (owner, fix round 2):** the unpadded half is pre-existing and not strictly
  SI-22.4's, but this PR widened it and cannot ship doing so. Restoring only the padded case would
  take more code and deliberately preserve a known hole. Both halves fixed.
  Named mutant **`PROTOALIASES`** (drop `__proto__: null`), **RED 2 suites / 6 tests** —
  `classify-members-trim.test.js` 5 of 15, `config.test.js` 1 of 64; denominator 549 suites / 7943
  tests. ⚠️ **CORRECTED IN ROUND 3 (council G-4):** this said *"a third suite (`check-citations`)
  reds under the mutation and without it"*. **False at HEAD** — re-measured with the real gate,
  `check:citations` exits 0 and its suite passes 62/62 **with** the mutation applied. The exclusion
  was right; the premise and the control were not. The transient red was real only while the mutant
  record did not yet exist (the pins cite it BY SYMBOL), and the LINE-NEUTRAL control could never
  settle it: both variants delete `__proto__: null`, so their agreeing rules out a *line-shift*
  artifact and says nothing about whether the mutation is the cause. **The decisive control is a run
  at the FINAL tree with the record in place** — which the mutant file's own counting rule already
  demanded. Applied that way for `BUILDERPROTO` in round 3, which reproduced the same transient red
  and then measured clean. Only **two** of the five gates are pinned — recorded so the fix's reach is not mistaken for
  the pin's. ⚠️ The reach itself is **measured, not inferred**: each of the other three gate
  expressions was evaluated directly with `'toString'` against both table shapes —
  `presets-cli.js:41` unresolved `false→true`, `pack-validate.js:71` `seatOk true→false`,
  `route-launch.js:205` `isAlias true→false`.

- [x] **SI-22.4 fix round 3 (council G-1/G-2/G-5) — the prototype hole survived round 2 via
  `DEFAULT_ALIASES`, and the fix belongs at the BUILDERS.** Closed 2026-08-23.
  Round 2 fixed `getEffectiveAliases` and that was correct but **incomplete**: `resolveModel:114`
  and `:145` hand `DEFAULT_ALIASES` **itself** to `alias-resolver.js :: autoRepairAlias`, whose gate
  is `defaultAliases[alias]`. `curated-models.js :: toDefaultAliases` and `:: toGatewayRoutes` both
  seeded `const out = {}`, so that path never saw the round-2 fix. Measured with a null-valued alias
  named `toString` on disk:
  `resolveModel('toString')` returned **`[Function: toString]`** and announced
  *"Auto-repaired null alias 'toString' -> 'function toString() { [native code] }'"*. It now throws
  *"Alias 'toString' is configured but has no model value"*.
  ⚠️ **THREE seeds, not two.** `config.js :: getDefaultAliases` returns `{ ...DEFAULT_ALIASES }`,
  and **a spread into a bare `{}` re-materialises `Object.prototype`** — measured, not assumed — so
  fixing the two builders alone does NOT reach it. That is also why **G-2's `sidecar/setup.js`
  literals had to be fixed at the literal**: `{ ...getDefaultAliases(), ...cfg.aliases }` is a plain
  object however clean its inputs are. Its gate is `aliases[input] !== undefined` on **free-form
  readline text**, and `toString`/`valueOf`/`constructor`/`hasOwnProperty` all measured TRUE,
  returning `{alias: input, noUpgrade: true}`.
  ⚠️ **G-5, and it is an ANNOUNCEMENT fix, not a security one** — stated that way deliberately.
  `saveConfig`'s `cleaned[key] = value` hit `Object.prototype`'s inherited `__proto__` setter, which
  ignores a string, so a `__proto__` alias vanished with **none** of the *"Removing invalid alias"*
  notices every other removal prints — the only silent removal in that loop. It is now rejected on
  the same branch as the `'null'` key, with the same message. No pollution was ever possible: only
  strings reach that line and the setter ignores them.
  ⚠️ **`directFormProvenance` in the same file still seeds `const out = {}` and is deliberately
  NOT changed.** ⚠️ **CORRECTED 2026-08-23 — this paragraph said "its ONE indexed read
  (`gateway-route-audit.js:77`) ... never user input". FALSE, and it is the TWIN of the same claim
  corrected further up this file.** There are **two** readers:
  `gateway-route-audit.js :: auditGatewayRoutes` (curated-keyed, as claimed) and
  `alias-audit.js :: findStaleAliases`, whose `alias` comes from `collectAliasSources()` — which
  pushes the user's own `cfg.aliases` entries **and** a raw CLI arg. The DECISION stands, on two
  independent grounds rather than the one claimed: that read is guarded by `source === 'defaults'`
  (false for a user alias) **and** `prov.directForm === 'derived'` (false for an inherited Function,
  which carries no such property), so it fails open exactly as documented.
  ⚠️ **How this twin survived, and it is the reusable part:** the fix above swept for
  *"only indexed read"*. This paragraph says *"**one** indexed read"*. A different word for the same
  claim — the third sweep on this branch defeated by SPELLING rather than by scope
  (`councils[` vs `councils.` was the first, three vs four spellings of "no requires" the second).
  It was caught by the PR council, not by any sweep. Recorded so a later reader does not treat the
  untouched `{}` as an oversight — and so the next "the only X" claim gets grepped for its synonyms.
  Named mutant **`BUILDERPROTO`** (drop the seed from all three producers), **RED 1 suite / 3 tests**
  — `config-null-alias.test.js` 3 of 26, measured at the FINAL tree with the record in place.
  Denominator 549 suites / 7948 tests.
  ⚠️ **PIN GAP, filed not hidden:** `sidecar/setup.js`'s two literals are **not pinned by anything**.
  The readline gate lives in `:: resolveChoice`, which the module does not export, so it cannot be
  driven without mocking readline end to end. The FIX is measured at the exact gate expression (all
  four inherited keys `!== undefined` true→false); the PIN is absent. **OWNER: Christian. GATE:
  export `resolveChoice` (or extract the alias-resolution step) so it can be unit-driven** — that
  export is the work, and it is why this is filed rather than bolted on. Not an adjacency.

- [ ] **The repo has NO mutant-name registry, and names have now collided TWICE in one release.
  OWNER: Christian. GATE: a single enumerated list of named mutants — file, path and red set —
  that a new pin must be checked against.** Collision 1: `SEATALWAYS` → renamed `HDRSEATFWD`
  (v4.8 SI-25). Collision 2: `CREDALIAS`, minted for SI-22.4's renderer rider in
  `tests/council/preset-trim-mutants.js` (red 2 suites / 3 tests) while
  `tests/council/street-cred-mutants.js` had carried that name since Phase 3 for a **different**
  mutant on `ledger-join.js :: credFor` (red 2 suites / 1 test) — renamed `ROWSEATDROP` in fix
  round 1. **Why this is not a nit:** a named mutant is cited BY NAME across `src/` comments, test
  headers, `BACKLOG.md` and the phasing table, and its red set is quoted as a number. Two mutants
  sharing a name means a reader comparing `2/1` against `2/3` reads a real regression that does not
  exist — and neither collision was caught by any gate, because nothing enumerates the names.
  Both were caught by a human reviewer, twice, which is the definition of an unpinned property.
  ⚠️ Filed with an owner and a gate, deliberately NOT as an adjacency to whichever mutant work
  comes next. The gate is the registry, not "the next PR that touches mutants".

- [x] **SI-22.4 rider (2) → v4.9 — the THIRD street-cred renderer is still alias-labelled.
  OWNER: Christian. GATE: `opts.labelOf` must accept a seat id before this can be written.**
  — **DONE, v4.9 W9 Task B (2026-08-25).** `workspace-matrix.js :: renderVerdict`'s street-cred
  loop now reads `opts.isBlind() ? (label || s.model) : (s.seat || s.model)`, joining
  `report-md.js :: renderMd` and `report-html.js :: renderHtml`; a twin bench reads
  `gemini#1`/`gemini#2` in all three; a unique-alias bench is unchanged (seat is
  emit-when-DIFFERENT). Named mutant `RIDERALIAS`, RED 1 suite / 1 test.
  ⚠️ **THE STATED GATE WAS FALSE — STRUCK, not satisfied:** `opts.labelOf` never needed to
  accept a seat id. Blind mode must render the anonymised LABEL, so the alias stays the lookup
  key and the signature is untouched; the blind fallback is the ALIAS, never the seat id — a
  second mutant `BLINDSEATLEAK` pins that the literal spelling `&& label ? label :
  (s.seat || s.model)` leaks a seat id (which contains its alias) into a blind render, RED
  1 suite / 1 test. Second time this cycle a rider was scheduled behind a gate measurement
  dissolved. ⚠️ The `:147-149` anchor below rotted (+21, W8's chip fork) — the site is the
  street-cred loop in `workspace-matrix.js :: renderVerdict`; kept as the dated record.
  Original filing:
  `electron/workspace-ui/workspace-matrix.js:147-149` builds each street-cred row as
  `var label = opts.labelOf(s.model);` → `var name = opts.isBlind() && label ? label : s.model;`
  — the same defect class the v4.8 R22.4-6 rider fixed in `report-md.js` and `report-html.js`,
  which now label `s.seat || s.model`. **Measured consequence:** on a bench that repeats an alias
  the report's street-cred table reads `gemini#1`/`gemini#2` while the Workspace's reads `gemini`
  twice, with different numbers under one identical name. Recorded for users in `docs/council.md`,
  beside the matrix's own report/Workspace difference note. ⚠️ `docs/council.md`'s *"behaves
  identically, with one deliberate difference"* is **matrix-scoped and therefore NOT falsified** —
  do not strike it; the street-cred divergence is a second, separately documented one.
  ⚠️ **NOT a one-liner, and must not be scheduled as one.** Swapping in `s.seat || s.model` fixes
  sighted mode and breaks blind mode: the blind label is resolved by `opts.labelOf(s.model)`, so a
  seat-first fallback requires `labelOf` to accept a **seat id** and still return the anonymised
  letter. **That signature change IS the work, and it is the gate** — which is why this is v4.9 and
  not a follow-up commit. Blind mode must keep showing no seat id (a seat id contains its alias).
  ⚠️ **Filed with a named owner and a stated gate ON PURPOSE.** Three items this session were
  deferred as *"adjacent to X"* and every one had to be re-discovered from scratch — SI-25 site
  (3), the `report-md` rider, and this. **An association is not a schedule.** This moves when
  Christian schedules it against the `labelOf` gate, not because something near it ships.

- [ ] **SI-27 rider (1) — `COLLIDEID` is single-pinned repo-wide.** Measured 2026-08-23: the
  mutant that gives a placeholder the alias as its own id — colliding on the id-keyed dedup —
  reds **exactly one test, in one suite**, and it now guards a function serving **three** call
  sites. The `-s2` and `-rv` benches have single roster holes, so **neither can observe an id
  collision at all**; the pin cannot come from either without a new fixture shape. **Pre-existing,
  honestly disclosed by the implementer, and NOT addressed by SI-27** — recorded so the single
  pin is a known state rather than a later discovery. The conjunction’s other half
  (`NOPLACEHOLDERFILTER`) is pinned 19-wide across four suites, and that asymmetry is the point:
  consolidation widened one half’s blast radius and left the other exactly where it was.

- [ ] **SI-27 rider (2) — `check-citations.js` cannot see a bare-paren line ref.** Its `CITATION`
  regex requires a `.js` path immediately before the `:NNN`
  (`scripts/check-citations.js :: CITATION`), so a bare `(:59)` is invisible to the gate.
  Measured: `check:citations --all` exited **0** for the entire time `run-stage1-rows.js` carried
  an out-of-range bare `(:59)`/`(:53)` pointing into `run-retry-launch.js` — a file SI-27 had
  just taken 67→55. `d29a3462` fixed that instance and wrote the rule into the comment
  (*"Symbol anchors, never bare line numbers"*), but the gate still cannot catch the next one.
  ⚠️ **Re-measured 2026-08-23, and STATE THE COUNTING RULE — the numbers differ by a factor
  of the rule alone.** Over all 909 tracked `.js` files at `943a047b`:
  • **Rule A, single-line refs only** (`(:NNN)`): **24 matches on 22 lines across 17 files**.
  • **Rule B, single-line refs OR bare RANGES** (`(:NNN)` or `(:NNN-MMM)`): **29 matches across
  22 files** — the five extra are bare ranges in `seat-space.js`, `council-pointer-fence.test.js`,
  `run-debate.test.js`, `electron-workspace-e2e.integration.test.js` and `pack-validate.test.js`.
  **Rule B is the right one to file on**: a bare `(:105-107)` is exactly as invisible to the gate
  as a bare `(:59)`. Under Rule B, 2 matches are the deliberately-quoted examples on
  `run-stage1-rows.js:165`, leaving **27 live bare-paren refs across 21 files**.
  ⚠️ **CORRECTED same day:** this entry first read *"the SI-27 brief said '22 refs'; 22 is the
  FILE count, not the ref count"* — itself wrong. Under Rule A the brief's 22 was the matching-**LINE**
  count; the file count is 17 and the ref count 24. A correction stated in the wrong units is worse
  than the rot it replaced — which is the whole reason SI-DUP exists.
  The dangerous subset is the CROSS-FILE ones — this PR’s was the only one pointing into a file
  it moved. ⚠️ **A green citation gate proves nothing about that form.**

- [ ] **SI-27 rider (3) — the doc tree is unscanned, and SI-27 measured what that costs.**
  `scripts/check-citations.js` scans only `src/`, `electron/` and `tests/`; `BACKLOG.md` and
  `docs/` hold **3639 of the repo’s 4128 citations** and are **out of scope by design**, stated
  as such in `docs/CITATIONS.md`. ⚠️ **File this as a cost measurement, not as an unnoticed gap**
  — the exclusion is deliberate and documented, and a naive "just scan docs too" would fail
  against thousands of citations that are correctly historical. The justification CITATIONS.md
  gives is that doc-tree citations are *"overwhelmingly dated historical record"*, and for
  `docs/superpowers/plans/*` and `specs/*` that holds. **It does not hold for SI-DUP’s
  dispositions or SI-15’s §3.4 clause**: those are LIVE work orders whose whole job is to point
  a future implementer at a file and a line, and **nine** such citations here were false after
  SI-27, with not one catchable. ⚠️ **SI-27 falsified SEVEN of them; the other TWO had already
  rotted six days earlier and SI-27 only took them out of range:**
  `run-retry-launch.js@2517a947:53`/`run-retry-launch.js@2517a947:59` were exact at T-A2’s lift and became
  `:56`/`:62`
  at `6709ac78` (2026-08-17), a **comment-only** fix three lines above them, with nothing to
  notice — so the cost is not only "extractions rot doc citations", it is "any edit does".
  If this is ever addressed, the cheap version is not a full doc scan but a scan of the LIVE
  subset — the unticked `- [ ]` entries — which is a small fraction of the 3639.

- [ ] **SI-25 rider (1) — `buildChairPacketFile`'s "lifted verbatim" docblock was ALREADY stale
  before SI-25.** `src/council/run-assemble.js :: buildChairPacketFile`'s docblock claims the
  function was *"Lifted verbatim out of run.js for the 300-line gate (v4.4.1 Task 0.5) — same
  composition, same debate addendum, same file write"* (HEAD `:233-235`; anchor by symbol, the
  docblock opens at `:232`). **The composition is no longer the same**: v4.8 PR5a T7 added
  `findings: record.findings` to the `buildChairPacket` call, before SI-25 existed. ⚠️ **Filed, not
  fixed, and recorded here specifically so a later sweep does not attribute it to SI-25** — SI-25
  added `seat` to the same call's reviews projection, which makes it look like the culprit and it is
  not. Counting rule for "already stale": the `findings:` line is present in
  `git show c0745013:src/council/run-assemble.js`, this branch's BASE.

- [ ] **SI-25 rider (0) — the `[Unreleased]` "Known limitations" bullet is a rot magnet; audit it at
  every release cut.** `CHANGELOG.md`'s *"Known limitations after this release"* bullet is written
  early in a release and then quietly outlived by the release's own later entries. Measured
  2026-08-23: **two** of its clauses had become false against entries in the SAME `[Unreleased]`
  section, and both would have shipped to users verbatim.
  1. *"The chair packet is still assembled entirely in alias space…"* — falsified by SI-25 itself.
  2. *"Findings remain attributed by **alias**, not by seat, in the ledger"* — falsified by SI-18
     (v4.8 Wave 2, `78ed7a40`), whose own entry *"Findings in the reliability ledger are now
     attributed to the seat that actually raised them"* sits ~420 lines above it in the same section.
  Both are now struck in place with a pointer to the superseding entry. ⚠️ **The general defect is
  structural, not a one-off**: a "known limitations" list is the only part of a changelog that a
  LATER entry in the same release can invalidate, and nothing checks it. **At the release cut, read
  that bullet clause by clause against the shipped `### Fixed` entries above it.** Counting rule for
  "two": clauses in that bullet asserting a present-tense limitation which a `[Unreleased]` entry
  above it contradicts, read 2026-08-23 — 2 of 4.
  ⚠️ Recorded here rather than in `CHANGELOG.md` **because it is maintainer prose**: the changelog
  is user-facing and an earlier draft of this note ("must be reconciled at the release cut", "is
  flagged, not rewritten") would have shipped verbatim to readers who have no use for it.

- [ ] **SI-25 rider (2) — the R25-2 byte-identity pin runs on one small bench.** The invariant is
  *"byte-identical output on every unique-alias bench"* and the pin proves it by equality (not
  `toContain`), which is the right shape — but it proves it over a single fixture. A richer bench
  (more reviews, a tie in the rankings, an adjudication per finding) costs about **3 lines** and
  would widen what the equality covers. **Not blocking**: the mutant `SEATONLY`, which drops the
  `|| alias` fallback at all three sites, reds **4 suites / 12 tests** against the current pin set,
  so the invariant is not resting on that one fixture alone. Filed as a cheap improvement, not a gap.
  ⚠️ **Do not merge this with "SI-27 rider (1) — `COLLIDEID` is single-pinned"**, above. That one is
  about a mutant with a single red test; this one is about the breadth of a fixture. Different
  items, different files, different remedies.

### ⚠️ `src/council/run-retry.js` is at 300/300 — ZERO headroom (2026-08-22, Wave 1)

Measured while adding a **one-line** comment for council A1: the file was at **299**, a
3-line note took it to 302 and failed `check:sizes`, and the surviving one-liner leaves it
at exactly **300/300**. **The next line added to that file breaks the gate.**

Release Constraint 6 is *EXTRACT, never shave a comment* — so the next change there must
extract first, and no comment already in the file may be trimmed to buy room.
⚠️ **CORRECTED 2026-08-23 — this paragraph said SI-27 "lands directly on" this file, and that
"that work IS the extraction this file needs". BOTH ARE FALSE.** SI-27 consolidates the
padding/bindSeats/placeholder core out of `run-retry-launch.js :: bindRetryWave`,
`run-stage2.js` and `run-debate-revote.js` into `stage1-bind.js`. **`run-retry.js` is not one
of its sites and gains not one line of headroom from it.** No wave in the remainder of v4.8.0
EXTRACTS from this file: it is the one saturated file with NO scheduled extraction, and the next
change to it must extract first. ⚠️ **One precision, 2026-08-23: SI-27 is not a no-op on this
file either — ruling P5 let it reword ONE comment line (`run-retry.js:22`, whose sentence SI-27
made half false), one line → one line, leaving it at exactly 300/300 with `check:sizes` at 0.
The fence was against GROWTH, not against correcting a false sentence.** Do not write that
SI-27 left this file untouched.
See row 27's corrected anchor in the phasing doc for how the
wrong file was carried — SI-27 once covered `seatKey` duplication here, PR5c/T-A1 moved that
definition out to `run-retry-keys.js`, the item narrowed to roster-padding, and the anchor
column never followed. A fossil, not a typo.

### ⚠️ The file-size gate is at saturation — re-measured 2026-08-22 (v4.8 Wave 2.5, `T-R16.2`)

Measured directly against `scripts/check-file-sizes.js`'s own `matchesPattern`/`CONFIG` — **not**
a raw `git ls-files 'src/**/*.js'` pathspec, which silently drops every top-level `src/*.js` file
(216 files found that way vs. **287** the gate's own matcher finds; its docstring says `'**/'
matches zero or more directories … covers top-level src files too'`, exactly the historical "`**`
glob bug" the exclude list's own comments describe as already fixed). Against those 287
non-grandfathered files:

- **Three are at exactly 300/300**: `src/council/run-retry.js`, `src/pack/pack-resolve.js`,
  `src/sidecar/electron-install.js` (the first has its own dedicated entry above).
- **Twelve sit at or within 6 lines of the cap (294–300 inclusive)** — the three above, plus
  `src/cli-handlers-doctor.js` (299, taken there by `R16`/`T-R16.1` — see its own entry below),
  `electron/workspace-ui/workspace-render.js` (297), `src/sidecar/context-builder.js` (297),
  `src/council/report.js` (296), `src/sidecar/session-utils.js` (296),
  `electron/workspace-ui/workspace-verbs.js` (294), `src/council/run-chair.js` (294),
  `src/council/run-stages.js` (294), `src/sidecar/fanout.js` (294).
- **Twelve files are explicitly grandfathered** in `CONFIG.exclude` (`src/utils/config.js`,
  `src/cli.js`, `src/headless.js` [1510 lines], `src/mcp-server.js` [1569 lines],
  `src/mcp-tools.js`, `src/opencode-client.js`, `src/session-manager.js`, `src/prompt-builder.js`,
  `src/sidecar/setup.js`, `electron/setup-ui.js`, `electron/main.js`,
  `electron/setup-ui-styles.js`) — most annotated "shrink below 300, then remove from this list"
  or equivalent wording; `prompt-builder.js`'s comment gives a grandfather rationale but no shrink
  instruction, and `config.js` (first in the list) carries no comment at all — the gate is real for
  everything else.

**Consequence:** any change touching a saturated file must EXTRACT before it can add even a
comment line. ⚠️ **CORRECTED 2026-08-22 — this paragraph said SI-27 extracts from
`run-retry.js`. It does not.** SI-27's sites are `run-retry-launch.js :: bindRetryWave`,
`run-stage2.js` and `run-debate-revote.js`; `run-retry.js` has no padding site. **Nothing in
the remaining v4.8.0 plan relieves `run-retry.js`'s 300/300** — it is the one saturated file
with no scheduled extraction, and the next change to it must extract first.

### ⚠️ `src/cli-handlers-doctor.js` is at 299/300 — one line of headroom (2026-08-22, `R16`/`T-R16.1`)

`R16` wired its check inline — two `realDeps()` mappings, a `require`, one `checks.push`, 7 lines
— taking this file to **299/300**. ⚠️ **This breaks the file's own established precedent, only
partially.** Five sibling check-bodies already live outside this file specifically so it stays
under the 300-line gate, and this file's own `require`-line comments (and each sibling's own
header) say so — but only **four of the five**, re-verified by opening each file, not assumed from
a prior pass's count: `doctor-mcp-checks.js`, `doctor-engine-check.js`,
`doctor-electron-mcp-check.js` and `doctor-local-providers-check.js` each read some form of "split
out to keep this file under the [300-line] gate." **The fifth, `doctor-base-url-check.js`, does
not** — its own header and this file's own require-comment both cite only "v4.6.2 PR1 (spec §4)";
grepped for "gate"/"300"/"cli-handlers-doctor" inside it, zero hits. A prior review pass's claim
that all five carry "that exact comment" does not survive opening the fifth file.

**Controller ruling: filed, not fixed here.** Nothing remaining in v4.8.0 touches this file, so it
does not block the release, and extracting inside `R16`'s own check PR would be the same
*"consolidation must not ride a defect PR"* inversion SI-27's own ruling forbids (see the
`run-retry.js` entry above). The next change to `cli-handlers-doctor.js` — of any kind, including
a comment — must extract first.

### v4.8 release inventory — what remains for 4.8.0, MEASURED (2026-08-22)

Ordered before starting Phase 7, on the owner's instruction to inventory first. **Every item below
was measured against the tree, not read off its row** — and that was the right call: one row was
already stale and one task turned out never to have been specified.

**Working scope for v4.8.0, after the owner's rulings on this inventory:**
Phase 6 remainder (**5**, T6.5 dropped) · Phase 7 (~7) · SI-27 (1) · **SI-18 (1, newly promoted)**.

⚠️ **Superseded 2026-08-22 by v4.8 Wave 1 (T-W1.1/T-W1.2) and the owner's wave-structure ruling —
read as history, not current scope.** T6.6 and SI-14 shipped (Phase 6 remainder is now 3: SI-22.4,
SI-23, SI-25 sites (1)+(2)); `#135 C0` shipped (Phase 7); `#135 C5` and the `#135 C2` probe are
deferred to v4.9 (**W1-4**); the `mcp-server.js:684` one-liner and the `listCouncilRuns` dedupe are
dropped as never-specified (**W1-3**); R16 is retained but rescoped (**W1-4**). The remaining work
is no longer phrased as "Phase 6 remainder then Phase 7" — see the owner's wave-structure ruling in
the Phase 6 resume point above. ⚠️ **This pointer itself is now history**: at Wave 1's writing
"NEXT TASK — Wave 2" was the live resume point; `SI-23` shipped alongside `SI-18` and `#133 Piece
1` in Wave 2 (2026-08-22) and the live resume point is now **"NEXT TASK — Wave 2.5"**, below.

#### The four items that were OPEN in neither a phase list nor §7's deferred list

They sat in limbo: not scheduled, not deferred. The owner ruled **fix SI-18 only**. What the
measurements found, and why that ruling is the right shape:

- **SI-18 — ✅ DONE 2026-08-22 (`78ed7a40`, v4.8 Wave 2).** Was: LIVE, real, and now IN SCOPE for
  v4.8.0. `ledger.js :: buildLedgerRows` filtered
  `findings.filter(f => f.raiser === model)` (`:142` pre-fix, `:143` today — one comment line
  shifted it) while iterating a **de-duplicated** alias
  list, so on any twin bench both seats' findings collapsed into a single alias row. Reachable on
  ordinary engine output — no hand-assembly needed. This was the half T3.3 did **not** close;
  T3.3 closed the street-cred join (row 20) at the same anchor. **The standing "never tick SI-18"
  warning no longer applies — it shipped.** See SI-18's own entry below (*"Findings are attributed
  by ALIAS, not by seat"*) for the fix and its verification.
- **SI-12 — LATENT, unreachable in production. NOT fixed in v4.8, deliberately.** Verified by
  reading all three write paths: `sidecar/leg-ids.js :: deriveLegIds` stamps every leg
  `${waveId}-${i+1}`, and `sidecar/fanout-leg.js` writes `taskId: legId` on the routing-failure
  path (`:61`), the error path (`:127`) **and** the normal path (`:191`). A real `-s2` wave cannot
  produce even ONE unbindable leg, let alone the two the collapse needs. The state is constructible
  only by deleting ids in a fixture. A guard here would be **defense-in-depth, not a bug fix** —
  the same character as v4.8 Phase 6 PR1's `PAST_TENSE` change, which shipped honestly labelled as
  such. Ruling **R19** stands: leave SI-12 open, do not mint a new identifier.
- **SI-22.1 / SI-22.2 — NOT FIXABLE WHERE THEY ARE FILED. Staying open under R2.** These are one
  defect wearing two numbers, and it is **information-theoretic, not a coding error**: when exactly
  one side of the comparison carries a seat id, the vote is genuinely ambiguous — a twin's real
  signal or the raiser's own — and *nothing in the document distinguishes them*. `peer-split.js ::
  peersOf`'s own comment says so. R2 already governs (*mark explicitly, attribute nothing*) and the
  drop is announced via `findings[].unattributedPeerDrops`.
  ⚠️ **Their only real cure is upstream: stop orphaning the leg, so both sides always carry a
  seat.** That is **SI-27**'s consolidation of the padding/bind/placeholder core into
  `stage1-bind.js`. Anyone tempted to "fix SI-22.1" locally is choosing between guessing (which R2
  rejected) and doing SI-27. **Point them at SI-27, not at `tally.js`.**

#### Corrections this inventory made

- **SI-05's status row was STALE and is now DONE.** It read *PARTIAL — `debate.js` second copy of
  the filter*. There is no second copy: `debate.js :: debateTargets` calls `peer-split.js ::
  peersOf` at `debate.js:254`, and that function's docblock states it was *"the last hand-rolled
  peer filter left in this file"*. Closed by Phase 2 T-B2 (`e23e56cd`); the row was simply never
  moved. Found by opening the file rather than trusting the row — which is the whole reason this
  inventory was ordered.
- **T6.5 was DROPPED** — never specified anywhere. See the struck line in the Phase 6 resume point
  above.

#### Measured-real, unchanged, and still to do

~~`SI-23` (the tally `findings` z.object declares only `id`/`raiser`/`severity`/`claim`/`raiserSeat`,
so zod strips `location`/`evidence`/`file`/`line` — confirmed)~~ **DONE — v4.8 Wave 2
(2026-08-22, `d5378684`).** ⚠️ Only `location` was ever real to strip — `evidence`/`file`/`line`
have no producer or consumer anywhere in this codebase's finding shape; see the dedicated entry
below. · ~~`T6.6` (confirmed live:
`skills/second-opinion/SKILL.md:299` defines Singleton as `d = 0` and `a < 2` while
`tally.js :: assignTier` returns **Confirmed** for `(a=1, d=0)`)~~ **DONE — v4.8 Wave 1
(`c0a7c728`)** · ~~`SI-25` sites (1)+(2) (confirmed
alias-keyed at `briefings-chair.js:88` and `:93`)~~ **DONE — v4.8 SI-25 (2026-08-23, `f7fe180d` +
`0c06bca9` + `95ee5520`).** ⚠️ **All THREE sites shipped, not two** (ruling R25-1) — the third is
the rankings render, which was alias-keyed at `:90` and which this measurement never listed. The
`:88`/`:93` numbers were exact when taken and have since moved with the fix; anchor by symbol,
`briefings-chair.js :: buildChairPacket` · ~~`SI-14` (confirmed: **no** such pin exists —
pure test addition)~~ **DONE — v4.8 Wave 1 (`424cb63d`)** · ~~`SI-22.4` (real, with the twin-bench
knock-on as filed)~~ **DONE — v4.8 SI-22.4 (2026-08-23, `1c7a9087` + `4c49becc` + `f771f59b`).**
⚠️ **"as filed" undersold it**: the knock-on is real, and so is a second effect the filing never
named — four of six measured shapes gain a paid leg. · ~~`#135 C0`
(confirmed trivial: `utils/no-output-backstop.js:23` is `120000`, `.github/workflows/
council-review.yml:242` overrides to `300000`; change the default, delete the override)~~ **DONE —
v4.8 Wave 1 (`4391f0b4` + ripple fix `b0d8e232`).**

⚠️ **Still to do after v4.8 Wave 2 (2026-08-22):** `SI-25` sites (1)+(2) · `SI-22.4` — the
two remaining Phase 6 independents (`SI-23` shipped in Wave 2; measurements above for the other two
unchanged). See "NEXT TASK — Wave 2.5" in the Phase 6 resume point above — `SI-22.4` rides Wave 3
(last); `SI-25` sites (1)+(2) is not yet placed in a wave.
⚠️ **SUPERSEDED 2026-08-23 — `SI-25` shipped** (own PR, all three sites, ruling R25-1). **`SI-22.4`
is the last remaining Phase 6 independent**, and it is Wave 3's final item. The live resume point is
"NEXT TASK — Wave 3 remainder" in the Phase 6 resume point above, not this paragraph.
⚠️ **SUPERSEDED AGAIN, later on 2026-08-23 — `SI-22.4` shipped** (`1c7a9087` + `4c49becc` +
`f771f59b`). **NOTHING on this line is still to do**, Phase 6 is closed, and v4.8.0 is
feature-complete: only the release run remains. Still read the resume point, not this paragraph.

**W1-4 — v4.8 Wave 1 ruling (2026-08-22): `#135 C5` and the `#135 C2` probe are DEFERRED to
v4.9.** #135 self-describes as *"a placeholder for a reminder for a brainstorming session"* and
neither item has a measured target. ⚠️ **R16 is NOT deferred** — its `sessions-index.json` growth
defect is measured and real (see *"Carried from the dropped v4.7.2 scope"*, below: a full
read→parse→mutate→write of the whole index on every session start). But R16's own phrase *"pin all
13 unpinned rails"* (`docs/superpowers/plans/2026-08-16-v48-phasing-and-rulings.md`, owner-rulings
table, row R16) appears nowhere else in the tree — **the number 13 is unsourced.** Scope R16 at
Wave 2.5 from the growth entry, not from the ruling's wording.

**W1-3 — v4.8 Wave 1 ruling (2026-08-22): the other two "carried" Phase 7 items are DROPPED as
never-specified, on the T6.5 precedent.** `mcp-server.js:684` one-liner and the `listCouncilRuns`
dedupe (6 rows / 5 ids on real data) each appeared **only** in the phasing doc's `Carried:` line
(`:551`–`:552`) and in this inventory quoting it — no filed defect, no anchor, no description; the
"6 rows / 5 ids" measurement exists nowhere else in the tree. The owner dropped T6.5 on exactly
this reasoning (§ "Corrections this inventory made", above) and that precedent is applied here
rather than re-asked.
⚠️ **This is NOT the same as the live entry "Council runs are invisible to CLI `amicus list`"**
(`mcp-council-awareness.js:205`, filed under v4.7 PR3 rider findings) — that entry is properly
filed, carries two open design decisions (the `sanitizePreview` width parameter and the MODEL
column's rendering), and **stays**. Both the dropped "dedupe" claim and the live CLI-invisibility
entry cite the same function, `listCouncilRuns`, but they are different claims about it — only one
of them was ever filed with a defect behind it.

⚠️ **`#138` Pieces 1+2 are now DONE** — branch `fix/138-model-level-default` (2026-08-24), not
yet merged to `main`; see the ✅ entry at `:6023` for the full record. This line was correct
when written; the section's "measure before you plan" point stands for every other still-open
row here.


### v4.8 Phase 2 T-A8 — truth pass, and what it filed (2026-08-17)

The `run-retry.js` extraction PR (T-A1…T-A8) closed with a doc-only pass over the record. Verdicts
above were updated in place; these are the items it could not close, filed rather than dropped.

- ⚠️ **MEASURED COVERAGE GAP — `run-retry.js` has TWO wholesale-skip branches and only ONE is
  pinned.** `retryStage1Losses`' unmappable/lens-out-of-range/zero-model branch and its
  `ctx.overBudget()` branch both push `...unit.srcLegs` wholesale. Mutant **PARTIALSKIP**
  (`...unit.srcLegs.slice(0, 1)`), applied to each branch separately and reverse-edited byte-exactly:
  on the **over-budget** branch it reds exactly one test (`run-retry.test.js` :: *"invariant 1:
  skipping is all-or-nothing…"*); on the **unmappable** branch it reds **NOTHING — 537 suites /
  7531 passed, the whole repo green**. That pin's three shapes are over-budget, wholesale death and
  both-healed, and none of them constructs an unmappable unit. The gap is in the PIN, not the guard —
  `supersededRows`' invariant 1 rests on both branches. Sentence corrected at the test.
- ⚠️ **DURABLE LESSON, earned three times in this task — A FIX MARKS A SITE, NOT A SENTENCE.**
  Every miss across T-A8's three rounds had the same shape: a site whose **symbol** anchor had
  already been corrected, so it read as done while the prose beside it was never re-read.
  Reconstructed: `e38ae801`, `47dbb52a` and `9169c00b` each touched the `workspace-seats.js`
  sentence — three consecutive fix rounds — and none dropped the five line numbers riding in it,
  which were still TRUE at 235 and were falsified afterwards by T-A3 (+15) and T-A6 (+16). The same
  held for the two SI-22.3 misses, where the column is literally headed *"Current anchor (by
  symbol)"* and the **verdict prose beside it** was never re-read.
  **Operational form, which is what to actually enforce: a ledger row saying "re-verified" MUST
  name WHAT was verified.** The row that carried this forward said *"re-anchored by symbol;
  re-verified"* — true about the symbol, and silently silent about the five numbers. That silence
  is the carrier, not the staleness.
  ⚠️ **And this is NOT the only live class.** Fix round 2's own findings were the FALSIFIED-RECORD
  class — a correct edit turning someone else's true sentence false (a status-table flip 81 lines
  away falsified *"the table above reads PARTIAL"*, and an affirmative *"one change since"*
  enumeration became incomplete). Stating the symbol lesson as *the* durable finding would
  under-cover exactly what recurred. ⚠️ A HISTORY guard that ENUMERATES what it supersedes does not
  cover a cross-reference to a live artifact; write such guards to cover the whole paragraph.
- ⚠️ **STILL DEFERRED, but now MARKED IN PLACE — the per-shape table under "The durable finding" (this
  file, the `| retry outcome | retry slots | …` table) carried TWO stale cells**: the PARTIAL row read
  `2 | **1** | **1** | 2 | ❌ open (B1)` and the FULL row's status said both notes read
  `firstFailure.reason` from slot 0. Both are superseded ~110 lines later in the same section, by
  the ✅ CLOSED verdict and its per-shape statement. **T-A8 fix round 3 added a ⚠️ STALE marker to both
  cells and to the sentence above the table, line-count neutral** — no cell was re-derived. The
  RE-DERIVATION is still deferred: the table is the release's most-cited measurement artifact and all
  four rows deserve a fresh probe. **Read the verdict prose, not these cells, until that pass happens.**
- ⚠️ **DEFERRED, recorded not fixed — pre-existing `seedSession` rot** at
  `docs/superpowers/plans/2026-08-09-v471-diagnostics.md:72` and `:1267`: both cite
  `tests/continue-resume-spend.test.js:34-43`; opened at T-A8, the helper is `:36-46`. A dated
  release-plan snapshot, and it predates this PR.
- **Filed: a lint gate for cross-file line-number citations.** Every extraction in this release
  falsified a citation class, and the class was only ever closed by opening each line. A gate that
  flags `file.js:<N>` citations whose target line no longer matches a recorded token would have
  caught all of them. (T-A2's durable lesson; still unbuilt.)
- [ ] **Filed: `check-citations.js` has two distinct blind spots on the SYMBOL anchor form, and
  both produce the same false assurance — nothing parses, so the gate reports nothing wrong.**
  Measured 2026-08-19 (v4.8 T-B3), re-deriving a set the controller measured earlier that same day;
  T-B1/T-B2 had edited every carrier file since, so the old line numbers no longer applied. **State
  the lever honestly**: both mechanisms below are arguably in the gate, not in the authors who wrote
  a wrapped or quoted anchor in good faith — if people keep writing the same shape, the consumer is
  what's wrong (failure mode #7). Filed here, **not fixed** — a gate change is its own concern.
  - **Mechanism A — no cross-line joining.** `parseCitations` (`scripts/check-citations.js :: parseCitations`)
    splits file content on `\n` and runs its regex **per line**; a `file.js ::` / `symbol` token
    that wraps onto the next physical comment line never appears as one match on either line, so it
    parses to nothing. Candidate fix, **not implemented here**: join wrapped comment lines before
    matching. Re-derived current set: **4 sites, all in the doc-tree**, named by entry rather
    than by line — this same filing carried three self-citations gone stale from its own
    commit's later hunks (fix round 1 caught it; a named reference cannot rot the same way):
    three in `BACKLOG.md` itself — the **"The mechanism."** bullet under the PR #170 round-2 C1
    discussion, the **"Concern for whoever extracts `run-retry.js` next"** bullet (now
    DISCHARGED), and `BACKLOG.md :: SI-DUP`; and one in the phasing doc's own **"#146 names a
    third hard-frame"** bullet (`docs/superpowers/plans/2026-08-16-v48-phasing-and-rulings.md`,
    under "Why task mode moved").
    `check-citations.js --all` never scans `BACKLOG.md`/`docs/` for an unrelated, deliberate reason
    (outside `CONFIG.include`), so these 4 don't produce a false gate PASS; they produce a false
    negative for the informal `parseCitations` spot-check this PR has leaned on repeatedly against
    `BACKLOG.md` itself — the same false-assurance shape, one level up from automation. Three more
    wrapped sites were in gate scope (`tests/**`) when the controller measured "eight" earlier
    2026-08-19; T-B3 rewrapped all three (see its commit) — two are now genuinely visible, and the
    third turned out to belong to Mechanism B below, not this one (rewrapping did not restore its
    visibility). ⚠️ The controller's "eight" does not itself add up against the sites it names (3
    gate-scope + 3 `BACKLOG.md` + 1 phasing doc = 7); treat **4, doc-tree only, current** as the
    re-measured fact, not "eight" carried forward.
  - **Mechanism B — the SYMBOL grammar has no quoted-string form, on ANY line.** The regex's symbol
    capture (`scripts/check-citations.js :: CITATION`, `[A-Za-z0-9_$]+(?:\.[A-Za-z0-9_$]+)*`) admits only
    identifier characters. `file.js :: "quoted test title"` and `file.js :: *"quoted test title"*`
    are an established convention in this codebase for citing one specific test by its description
    rather than a symbol — and neither form can EVER match that grammar, wrapped or not. Confirmed
    by control: 7 of 8 live sites are already on one physical line and are still invisible; the 8th
    (`run-stages.test.js`'s `attemptedSeats` anchor, this PR's own §1) was rewrapped this round
    specifically to test the hypothesis and REMAINED invisible after. Unlike Mechanism A, all 8
    sites sit inside `CONFIG.include` (2 in `src/`, 6 in `tests/`), so `check-citations.js --all`
    genuinely runs over every one of them today and still finds nothing to check — a live,
    present-tense false assurance, not a doc-tree exclusion.
    Current sites: `src/council/run-retry-keys.js:28`, `src/workspace/seat-space.js:85`,
    `tests/council/run-retry-lockstep.test.js:35`,
    `tests/council/run-retry-twins-threading.test.js:124`, `tests/council/run-retry.test.js:1084`,
    `tests/council/run-stages.test.js:1204`, `:1212`, `:1501` (⚠️ re-derived 2026-08-25 — v4.9
    W1's pin insertions in that file shifted all three; the bare-line forms are invisible to
    `check-citations`, so they rot silently — re-open on read). Candidate fix, **not implemented
    here**: either give SYMBOL a quoted-string alternative, or define quoted-title as its own
    citation form with its own check (does the quoted text occur as a test title in the resolved
    target — a STRONGER claim than a symbol anchor makes today, which is checked by substring, not
    exact match). ⚠️ **Not asked for by name** — found while re-deriving Mechanism A's set, using
    the same tool the way the controller's own instructions asked it to be used. Filed here rather
    than silently narrowed away, because it is the identical false-assurance shape and, at 8 live
    gate-scope sites against Mechanism A's 4 doc-tree ones, the larger of the two.
  - **Mechanism C — a bare `:NNN` continuation is invisible.** Added 2026-08-20 (v4.8 T2.4 / PR C).
    ⚠️ **This mechanism was being *referred to* as already filed and was not** — it existed only in
    T2.4's own brief and handoff, never in this file. Measured here with the real exported
    `parseCitations`, not asserted: the line
    `the four seat-space-gated reads report.js:98/:104 and matrix-model.js:84/:88, which are`
    yields exactly **two** citations (`report.js:98`, `matrix-model.js:84`) — the `/:104` and
    `/:88` continuations produce nothing at all. Same result for `matrix-model.js:84 and :88` (one
    citation) and `workspace-render.js:195/:225` (one). The regex requires a `<path>.js` prefix on
    every match, so the abbreviated second-reference form this codebase uses constantly is
    structurally unparseable. It is a **false negative on a checkable target**, the same class as
    Mechanisms A and B. Candidate fix, **not implemented here**: carry the last matched path
    forward across a bare `:NNN` on the same line.
  - **Mechanism D — the gate structurally cannot express a non-`.js` target at all.** Added
    2026-08-20 (v4.8 T2.4 / PR C); measured first by the controller on an earlier tree and
    **re-derived here against `e5376399`**. The regex at `scripts/check-citations.js :: CITATION`
    requires the path to end in `.js`, so `docs/council.md:562` returns `[]` while the control
    `src/council/report.js:98` parses normally. **Distinct in kind from A, B and C**: those are
    parse failures on a target the gate *could* check; this is a whole target class it cannot
    express, so every `.md:NNN` citation in the codebase is unverified and always has been.
    - **Measured exposure — every number below carries BOTH its path scope and its REF.** Counted
      over the gate's scanned trees (`src/**`, `electron/**`, `tests/**`):

      | Scope | `ed5c0c02` | `e5376399` | `0cb2d4d9` | `1c2f462c` | this commit |
      |---|---:|---:|---:|---:|---:|
      | `docs/*.md:NNN` | **7** (6 stale) | **7** (6 stale) | **3** (2 stale) | **3** | **3** (2 stale) |
      | every `*.md:NNN` | **18** | **18** | **14** | **15** | **14** |

      ⚠️ **The fall from 7→3 and 18→14 is T2.4's own four `tests/` fixes, not a change in the
      blind spot.** An earlier draft stated 7 and 18 in the present tense in the very commit that
      changed them — the release's own rot class, committed inside the entry filing it.
      ⚠️ **AND THE ENTRY THEN DID IT AGAIN, TO ITSELF.** The `1c2f462c` column reads **15**, not the
      **14** that commit recorded: its own C3 disclosure added a fresh unpinned `.md:NNN` citation to
      live code — **inside the blind spot this very entry files**, and against the rule that a
      correction must never introduce a new line number. Fix round 2 converted it to
      `pr4c-seat-spine.md@ed5c0c02:751-752`, which is provenance rather than a live line reference,
      and the count returns to **14**. The lesson is the entry's own: a count stated about the tree
      is falsified by the commit that states it, so **quote the ref with the number, every time**. The 6-stale
      set is four distinct stale `docs/council.md` targets across six citing sites, plus
      `docs/usage.md:406`, which is **CORRECT — do not "fix" it** (`grep -n` puts the phrase *"not
      tunable"* on 406 exactly). The two `docs/council.md` sites surviving at `0cb2d4d9` are the two
      in `src/` T2.4 was forbidden to touch — recorded under "Citations T2.4 measured but could not
      apply" below.
    - ⚠️ **6-of-7 is NOT the size of the blind spot**, and a bare "7" invites reading it as such.
      Widening by one character — every `*.md:NNN` rather than `docs/*.md:NNN` — adds **eleven more
      citing sites across SEVEN distinct targets**, none of which has been opened and all of which
      are of unknown freshness: `SKILL.md:448` (×2), `COUNCIL-DESIGN.md:268` (×2),
      `MANUAL-ORCHESTRATION.md:147` (×2), `BACKLOG.md:280` (×2),
      `usage.md:642-648`, `superpowers/sdd/task-10-report.md:127-148`, and — the one an earlier
      draft omitted — `tests/gateway-router-local.test.js:176`'s `...-design.md:145-149`, whose
      path is itself elided in the source comment. Any count quoted from this entry must carry its
      scope **and its ref** in the same sentence.
    - **State the lever honestly**: like A and B, the defect is arguably in the gate — it cannot
      express a `.md` target — not in the authors, who wrote an ordinary line citation in good
      faith (failure mode #7). Filed here, **not fixed**: a gate change is its own concern with its
      own blast radius, and widening the path grammar would immediately put `BACKLOG.md`'s and
      `docs/`'s deliberately-unscanned doc-tree citations one `CONFIG.include` edit away from the
      gate. ⚠️ **The figure "3639" is quoted in this repo without a counting rule and does not
      reproduce** — it appears at `scripts/check-citations.js:35` and `docs/CITATIONS.md:82`, and
      an earlier draft of this entry repeated it as fact. Re-measured with the real exported
      `parseCitations` over tracked `.md` files it comes to ~3.8k under the obvious scoping and
      nothing produces 3639 exactly. Treat it as an undated order-of-magnitude marker, not a count;
      whoever needs a real number must state the rule that produced it.
- **Filed: a rare, unexplained single-test red in the full suite.** One `npm test` run during T-A4
  reported 1 failed / 7516 with the identity lost to filtered output; seven further runs were green.
  A one-sentence docs change cannot cause it, so it is treated as a **pre-existing flake**, not
  something this PR introduced. It matters because `pre-push` runs the full suite and BLOCKS, so a
  rare flake fails pushes at random. ⚠️ Capture the full `●` block before re-running.
  ⚠️ **IDENTITY NOW KNOWN, cause still not.** Sighted again 2026-08-19, v4.8 T-B1 fix round 3
  (`8e97faaf`), this time with the full block captured:
  ```
  Test Suites: 1 failed, 540 passed, 541 total
  Tests:       1 failed, 8 skipped, 7624 passed, 7633 total
    ... at Object.readFileSync (tests/docs-plan-refs.test.js:27:23)
  ```
  It is **`tests/docs-plan-refs.test.js`**. Ruled out as caused by that round's commit: the test's
  own `SCANNED` constant (`tests/docs-plan-refs.test.js:10`) walks only `src`, `docs`, `skills` —
  never `BACKLOG.md`, the only file that commit touched. Re-ran the test in isolation: clean.
  Re-ran the full suite twice more: both green, 541/541 suites, 7625/7625 passed. **This
  identifies the 2026-08-19 sighting; the original T-A4 sighting's identity is still genuinely
  unrecoverable** (its own trace was the thing filtered) — the two are being treated as the same
  recurring flake by symptom (a single spurious full-suite red, clean on every retry), not by
  matched trace. **The cause remains unknown. Do not read this as fixed**, and do not re-derive the
  identity from scratch in a future task — this note is the record of it.
- **Filed (test hardening, needs code):** `run-retry-keys.test.js`' require-scan uses `/require\(/`,
  which misses `require (` and dynamic `import()`; `run-stage1-rows.js` imports `twinAliases` /
  `legLossKey` through `run-retry-group.js` rather than the `run-retry-keys.js` leaf, so the
  leaf-closure comment there is defended by prose rather than by the import; and T-A6's last-hop
  `twins` pin is a SOURCE pin where a `jest.mock` of `run-retry` would give a real fixture (an idiom
  already used on sibling council modules).
- **Dropped, with reason:** `CLAUDE.md`'s attribution of `seatKey()` to `run-retry-group.js` is
  GENERATED output (the marker regenerator reads only the first line of `module.exports`) and is
  true by re-export, so editing it would be overwritten and would not be more correct.
- **Unamendable:** commit `b97a55bd`'s MESSAGE carries a garbled citation
  (`":1409 => :1410 => :1429/:1430"`). The tests and the plan it describes are correct; fixing the
  message needs a history rewrite. Recorded here instead.

### Size gate — re-measured 2026-08-17 (v4.8 Phase 2 T-A8)

⚠️ **RE-MEASURED AT THE END OF THE `run-retry.js` EXTRACTION PR (v4.8 Phase 2, T-A1…T-A8), with the
gate's own rule** (`content.split('\n').length`, minus 1 when the file ends in a newline; PowerShell
`Get-Content | Measure-Object -Line` is WRONG here — it drops blank lines and under-reports these
files by 7–12). **282 gated files · 13 at ≥291 · exactly 2 at 300/300 · 0 over the limit.** The
population grew by the three modules this PR created.

| File | At base `30e17df9` | Today | Free | Note |
|---|---:|---:|---:|---|
| `src/council/run-retry.js` | 295 | **295** | **5** | ⚠️ **AT THE CLIFF.** T-A2 took it to 263; T-A4 (+24) and T-A6 (+8) spent every line of that. **The next PR touching this file needs an EXTRACTION first, not an edit.** |
| `src/council/run-stages.js` | 292 | **294** | **6** | ⚠️ **AT THE CLIFF**, same rule. |
| `src/council/run-retry-group.js` | 299 | **266** | 34 | T-A1 −64, T-A3 +15, T-A6 +16 |
| `src/council/run-stage1-rows.js` | 225 | **212** | 88 | T-A1 +2, T-A5 +68 to 295, then T-A6 split 83 out. (T-A4 touched it +N/−N, contributing zero — measured per commit, not attributed by eye) |
| *new* `src/council/run-retry-keys.js` | — | **74** | 226 | T-A1 |
| *new* `src/council/run-retry-launch.js` | — | **64** | 236 | T-A2 |
| *new* `src/council/run-stage1-superseded.js` | — | **140** | 160 | T-A6 |
| `electron/workspace-ui/workspace-seats.js` | 279 | **282** | 18 | comment-only, +3 across T-A2's citation rounds |
| `src/council/run-debate-revote.js` | 176 | **176** | 124 | comment-only, net zero |
| `src/council/run-stage2.js` | 209 | **209** | 91 | comment-only, net zero |
| `src/workspace/seat-space.js` | 113 | **113** | 187 | comment-only, net zero |

Every number above was measured with the gate's rule against the FINAL tree; the "At base" column
was measured against `30e17df9` in the same pass, not carried from a plan. T-A8's own doc-only
commit is **line-count neutral in every source file it touches** (`run-retry-group.js`,
`run-retry-keys.js`, `run-stage1-superseded.js`, `reopen-spend.js` — N in / N out), which is what
keeps every citation of those files true across it.

Reference points measured in the same pass, for anyone reading a stale number elsewhere in this
file: `src/council/run-launch.js` **244**, `electron/workspace-ui/live-seats.js` **125**,
`electron/workspace-ui/live-dead-seats.js` **226**, `src/council/stage1-bind.js` **86**,
`src/council/run-retry-notes.js` **126**.
⚠️ Three of those five moved in v4.9 W9 and its round-1 council fix wave (2026-08-26), which is
exactly the "stale number elsewhere" this paragraph warns about, so: `live-dead-seats.js` **300**
(at the gate's ceiling), `run-retry-notes.js` **183** (it absorbed `skippedWaveNote` from
run-stages.js), `run-stages.js` **282** (it gave that builder up). ⚠️ `live-dead-seats.js` and
`workspace-seats.js` both sit at **300/300** — the next line either file gains needs an extraction
first, not a comment trim.

### Size gate — re-measured 2026-08-16 (kept: the Phase 0/Phase 1 before-and-after)

Measured with `scripts/check-file-sizes.js`'s own `listTrackedFiles` + `matchesPattern` +
`CONFIG`, so the population is exactly what the gate scans. **First measured 2026-08-16 (Phase 0):
277 gated files · 14 at ≥291 · exactly 2 at 300/300 · 0 over the limit. Re-measured 2026-08-16
after Phase 1: 279 gated files · 12 at ≥291 · exactly 2 at 300/300 · 0 over the limit.**
(`src/**/*.js` + `electron/**/*.js`, minus `CONFIG.exclude`'s 12-file grandfathered list. The
population grew by the two files Phase 1 created; the ≥291 band shrank by the two Phase 1 emptied.)
The gate passes today and the first added line to either 300-line file blocks the commit. The two
struck rows below are kept — not deleted — so the Phase 1 before/after stays legible.

⚠️ **This replaces the 2026-08-09 v4.7 table under *Next-rev hard gates*** (~1,080 lines earlier in
this file — a Phase 1 implementer grepping for a size table hits that one first). Its **"three
files now sit at exactly 300/300"** warning is measurably wrong today: re-measured 2026-08-16,
`src/sidecar/fanout.js` is **294**, `src/sidecar/continue.js` **282** and `src/council/run.js`
**281**. Only `pack-resolve.js` and `electron-install.js` are still at the ceiling.

| Lines | File | Note |
|-------|------|------|
| **300** | `src/pack/pack-resolve.js` | AT CEILING — zero headroom |
| **300** | `src/sidecar/electron-install.js` | AT CEILING — zero headroom |
| ~~298~~ **197** | `src/council/report.js` | ✅ **T1.2 SHIPPED** — `renderMd` moved to `report-md.js` (130), leaving 188; the record-correction commit then added 9 comment lines. 103 lines of headroom |
| 297 | `electron/workspace-ui/workspace-render.js` | — |
| ~~297~~ **252** | `src/council/run-assemble.js` | ✅ **T1.1 SHIPPED** — `buildRunStatsEntry` moved to `run-stats-entry.js` (71). Landed at 252, not the projected 247. 48 lines of headroom |
| 297 | `src/sidecar/context-builder.js` | — |
| 296 | `src/sidecar/session-utils.js` | — |
| 294 | `electron/workspace-ui/workspace-verbs.js` | — |
| 294 | `src/council/run-chair.js` | — |
| 294 | `src/sidecar/fanout.js` | — |
| 292 | `src/cli-handlers-doctor.js` | — |
| 292 | `src/council/run-stages.js` | — |
| 292 | `src/sidecar/models.js` | — |
| 291 | `src/mcp-council-run.js` | — |

⚠️ **`src/council/report.js` and `src/council/run-assemble.js` appeared in NO prior size note in
this file** and both gated Phase 1. **Both have now shipped — re-measured 2026-08-16 after
Phase 1:** T1.1 extracted `buildRunStatsEntry` out of `run-assemble.js` into
`src/council/run-stats-entry.js` (71), leaving it at **252** (the plan projected 247); T1.2
extracted `renderMd` out of `report.js` into `src/council/report-md.js` (130), leaving it at 188 —
and the follow-up record-correction commit added 9 comment lines, so `report.js` stands at
**197/300** today. Neither is a size-gate concern any more, and **a T2.4 or SI-25 implementer does
not need to extract anything before editing them.** The 300-line gate blocks the COMMIT, not the edit —
when it fires, EXTRACT. Shaving comments to fit is the documented tell.
⚠️ **The `run-assemble.js` number above is a 2026-08-16 reading and the fence it sets has MOVED.**
Both T2.4 and SI-25 have since shipped, and `run-assemble.js` is **278/300** at 2026-08-23 — not
252 — because SI-25 added the seat forward and its comment to `buildChairPacketFile`'s reviews
projection. `briefings-chair.js`, SI-25's other file, went **182 → 243/300** in the same PR. The
conclusion ("still clear of the gate, edit without extracting first") holds for both files today,
but the **next** editor of either must re-measure rather than read 252 here. The authoritative
table is *Size gate — re-measured*, below.

### Deferred to v4.9.0

Task mode + #146 · ~~the Workspace dead-seat surface (SI-02, R4, PR5b-1)~~ — **SI-02 and R4
DONE in v4.9 W9 Task A (2026-08-25); PR5b-1 rides W9 Task B** · SI-16 splits · seatKey
cross-file consolidation · #133 Pieces 2–3 · #138 Piece 3 · #135 C4 · PR1F-2 *unification*, PR1F-3,
the prune check, F-1, F-5, the CLI `list` merge, KNOWN_VARIABLES · **SI-22.4 rider (2) — the
Workspace street-cred renderer (owner Christian; gated on `opts.labelOf` accepting a seat id)**.
**Holds — not work, do not re-scope:** SI-21, PR5a-1, PR5c-DOMKEY, PR5c-STANDING.

> ⚠️ **Triaged at the v4.9 kickoff (2026-08-25) — the list above is the dated 2026-08-16
> record; three of its tokens do not survive re-measurement.** (1) **`#135 C4` DROPPED as
> never-specified** (T6.5/W1-3 precedent): born in the phasing doc's own deferral line
> (`4ee46696`), defined nowhere in any tree, and issue #135's body carries no C-taxonomy. The
> real #135 remainder is **C5 + the C2 probe**, per ruling W1-4. (C0 shipped on `main` via
> squash `919cb202`, PR #182 — its previously-recorded hashes `4391f0b4`/`b0d8e232` are
> dangling pre-squash commits.) (2) **`#138 Piece 3` DROPPED as never-specified** — see the
> struck entry at *Setup polish — #138*. (3) **"the prune check" ALREADY SHIPPED** in v4.8
> Wave 2.5 (`dda1b8cf`, PR #187) — see the ticked `sessions-index.json` growth entries. The
> live v4.9 scope, rulings V1–V18, and the wave train are in
> `docs/superpowers/plans/2026-08-25-v49-phasing-and-rulings.md` (a plan doc — pruned at the
> release cut; git history is the audit trail).

### Tracker state

**Ten open issues, not eight** — #146 and #161 postdate this section and appear nowhere in it.
**Zero open PRs.** No issue has a comment. #133 is majority-discharged, #129 ~40%, and #137's
literal ask was satisfiable at v4.7.1.

---

## v4.8.0 — the council does new work

The three largest issues attack the same two assumptions baked into the pipeline: **every seat
reviews an artifact**, and **one seat = one alias**. v4.8.0 breaks both.

### Task mode — closes #134, finishes #130

#134 (open-ended asks) and #130 (byzantine divergence) are the **same problem from two directions**:
#130 is the bug report of what happens when a generative brief meets a review-shaped pipeline, and
#134 is the request to support generative briefs properly. The TASK MODE declaration serves both;
design them together, not separately.

- Mechanical root cause confirmed: `briefings.js:114` hard-frames every seat — *"You are one
  reviewer on an independent multi-model review bench. Review the material…"* — composed onto the
  user's brief regardless of what that brief asks for. No task-mode or divergence concept exists
  anywhere in `src/` (grep hits only unrelated `DIVERGENT_VENDORS` routing).
- Stamp `TASK MODE: review-artifact | produce-analysis` from an explicit parameter; Stage-1 composes
  per mode; Stage-2 judges score conformance to the declared mode as a first-class criterion.
- Emit divergence into `degrades[]` so it reaches `report.html`/`report.md` the way seat loss does.
  ⚠️ Word it as an **observation** ("seats' findings cite disjoint location populations"), never a
  diagnosis — repeating #129's sin of asserting an unestablished cause would be the same bug.
- ⚠️ **The location heuristic needs calibration.** In a *normal* review run the material under
  review **is** delivered inside the briefing, so "cites the briefing" does not separate the cases
  on its own. The engine can still do it — it composes the brief and knows where its instruction
  scaffold ends and the user body begins — but models write `location` as free text.
- Skip the ledger row on divergence. Exact precedent: `run-finish.js:51`'s `if (!o.lenses)` —
  *"Lens runs never feed cross-run reliability stats."* ⚠️ Both halves of the previous note were
  stale and are corrected here (re-measured 2026-08-13 at `c1c3a5ee`): the gate moved out of
  `run.js` into `run-finish.js` (v4.8 PR0's size-gate split), and `run.js` is **272/300**, not
  295 — there is headroom, so "extract first" no longer applies to this item.
- Per-population tiers, and split the two Singleton causes ("no peer engaged" vs "no peer was in
  scope to engage"). NB: v4.7 already redefined Singleton as the no-signal case `a=0,d=0`
  (`tally.js:24`, docs match) — the #130 report quotes the older v4.6.2 wording, but the
  conflation it describes survives intact and is arguably sharper now.

**Empirical evidence, still on disk** (`~/.config/amicus/council-ledger.jsonl`, 157 rows). Run
`westpac-jv-02` ranked gpt **worst** (peersOnly 3.0) on a **perfect** confirm rate (1.00), while
deepseek ranked better (2.0) on 0.42. That is the ranking inversion in two rows, and those rows
permanently feed `council stats` — which is the authoritative input to bench selection.

### Seat identity — closes #137, and PR1F-1 properly

- PR1F-1's real defect is not that duplicates exist, it is that `lensIndexOf`
  (`run-retry-group.js:16`; was cited `run-retry.js:24` — it left that file at PR0) and `roleFor`
  (`run-stages.js:35`) resolve a seat via `indexOf(alias)` —
  **first occurrence wins** — so a duplicated alias whose second occurrence dies yields two primary
  rows where the row-per-launch bijection expects one.
- Give seats distinct identities so alias is no longer the resolution key. That fixes the bug **and**
  delivers #137's ask: the same model in multiple seats, one per expert lens persona.
- Supersedes ruling 4. Note duplicates mostly *work* today — the corruption only fires when a
  duplicated seat dies — so rejecting them would have broken a working workflow that this release
  then un-breaks. Rider: `amicus council save` accepts duplicate members too.

#### Seat identity — PR2b handoff (2026-08-13)

PR2b shipped seat identity through Stage-1 launch and the retry path: `launchStage1` returns a
per-wave seat roster, `bindSeats` runs once per wave, review files and roles are keyed on the
seat rather than the alias, H4's retry-grouping collapse is undone so two dead twin seats retry
as two, and an unbound seat (a launched leg that never returns) is retried and, failing that,
announced on a new `seat-unbound` degrade channel. Three items surfaced by that work belong to
the PRs still ahead in this stack; recorded here so they do not have to be re-derived.

- [x] **[SHIPPED v4.8.0 PR5a — see the note below] DONE (v4.8 — verified by execution 2026-08-16) · Hard prerequisite for PR5 · `artifact-guard.js:87`'s `uniqueModels` must build from
  `o.seats`, not a de-duplicated bench, before PR5's workspace flip.** `const uniqueModels =
  [...new Set(bench)]` still allowlists one `review-<alias>.md` per distinct alias, but a bench
  that repeats an alias now writes `review-<seat>-1.md` / `review-<seat>-2.md` (PR2b Task 3), so
  the Workspace lists only one of the two — see the CHANGELOG's known-limitation entry for this
  release. **The file's own `:82-86` comment also needs correcting**, not just the code: it
  currently frames collapsing a repeated-alias bench to one set of rows as the harmless case
  (spec §4.5's original intent). Post-seat-identity that framing is inverted — a repeated alias is
  now exactly the case where collapsing loses a listing, not the case where collapsing is safe.
  **Coverage gap:** verified zero twin-bench (repeated-alias) cases in either `tests/workspace/`
  or `tests/electron/` today — `artifact-guard.test.js` and `dead-seat-rows.test.js` both use
  "twin" only as a test-naming convention for a paired/counterpart test, not a duplicated-alias
  bench. Nothing currently pins this gap or would catch a fix.
  **The same allowlist rebuild also closes a second, sharper case: a DISCARDED retry leg can be
  the only review file the Workspace shows.** `run-retry.js :: retryStage1Losses` (was cited
  `:193`, then `:166`; T-A4 moved it again, so it is anchored by SYMBOL and not re-numbered) calls
  `materializeReviews` purely
  to compute `usable`, but that helper WRITES a file for every complete leg — including legs the
  loop below then discards (`if (!ff) { continue; }`) and legs that bound to nothing. Concretely,
  on a twin `['deepseek','deepseek']` bench whose retry wave returns one bindable leg plus one
  unattributable one, the run dir ends up with BOTH `review-deepseek-1.md` (the real healed
  review, seat-named) and `review-deepseek.md` (the stray, alias-named because it never bound) —
  and `artifact-guard.js:87` allowlists exactly `review-deepseek.md`, so the only file the
  Workspace surfaces is the one the engine threw away. Do NOT fix this by restructuring the retry
  write path; an allowlist built from `o.seats` stops listing the alias-named stray and starts
  listing both seat-named files, which resolves it.

  > **v4.8.0 PR5a — discharged in substance, NOT in letter.** Both seat-named files are now
  > listed, so the healed review is reachable and it is the one the panels render. The stray is
  > **still listed**, because `run.json` cannot tell a discarded retry leg from a legitimately
  > orphaned one — both emit the same `seat-unbound` degrade note, and PR5a refuses to guess
  > between them. What it does instead is refuse to *attribute* it: an orphan-written name belongs
  > to no seat, so no panel renders it under a model, which is the user-visible half this entry
  > was really about. A surface for genuinely unattributed artifacts is filed, not built.
  - **Verified by execution (2026-08-16):** `src/workspace/artifact-names.js :: artifactAllowlist` —
    the allowlist's entity list derives from `run.seats`, not a de-duplicated bench, at
    `artifact-names.js:73-75`: `isSeatTable(run && run.seats) ? [...new Set(run.seats.map(s =>
    s.id))] : [...new Set(bench)]`. The memo's `artifact-guard.js:87` `uniqueModels` citation has
    rotted onto this symbol: `uniqueModels` no longer exists anywhere in `src/` (confirmed by
    `grep -rn uniqueModels src/` — no hits); `artifact-guard.js:101` now gates every artifact read
    through this same `artifactAllowlist`, imported at `artifact-guard.js:25`.

- [x] **DONE (v4.9 W9 Task A, 2026-08-25) · PR4 · `verdict-seat-loss.js :: deriveSeatLoss`
  (extracted out of `verdict.js` by PR #200's round-3 fix; the old `:68`/`:71` line citations
  went with it) and both Workspace dead-seat
  renderers — `electron/workspace-ui/live-dead-seats.js :: deadSeats` and
  `workspace-ui/workspace-seats.js :: retriedSeats` — gate on
  `dead-leg`/`dead-wave` and are blind to `seat-unbound`.**
  ✅ All three now admit `seat-unbound` GATED on the retry-family fields
  (`data.retryWaveId || data.firstFailure`, plus a `seatId`/`seat` presence conjunct), spelled
  identically in `live-dead-seats.js :: isSeatLoss`, `retriedSeats` and `deriveSeatLoss`'s
  `gatedUnbound`; the two renderer filters moved in ONE commit per the mirror constraint, and
  the behavioural drift pin in `workspace-seats.test.js` gained four cases so a one-sided
  revert reds — six as of the fix round. The producer half shipped too: `waveStillDeadNote`'s
  partial arm emits a scalar `data.seatId` (v4.9 W9 P1), closing the fifth of five emitter arms.
  `deriveSeatLoss` also moved to the POSITIVE `kind === 'degrade'`, aligning the three consumers.
  ⚠️ **Two of those sentences were CORRECTED by the round-1 council fix wave (2026-08-26)**, and
  are kept above as the dated 2026-08-25 record:
  - the kind predicate is no longer the positive test alone. Council **C4** (Confirmed): its
    safety rested on an asserted caller inventory, which is convention, not structure — so all
    three consumers now spell it `kind === undefined || kind === 'degrade'`, citing `report.js`'s
    LEGACYDROP lesson by name. `report.js` still excludes a different KIND LIST, deliberately;
    what the four now agree on is that an ABSENT kind is a loss.
  - there are **SIX** emitter arms, not five: `run-retry-notes.js :: skippedWaveNote` joined the
    module in the fix round, lifted out of `run-stages.js`'s emit loop so it sits beside the
    `waveStillDeadNote` partial arm it mirrors. It emits `data.seatId` on the same null
    discipline, so the "five of five" property holds as six of six.
  ⚠️ **The `data.legId` discriminator this entry prescribed was NOT added as a separate rule:
  measured, both `legId`-carrying shapes (`orphanLegNote`, `reVoteUnboundNote`) carry no
  retry-family field, so the one gate subsumes it — and the retry-family gate additionally
  excludes `run-stage2.js`'s judge-side `seat-unbound` note, which a `legId`-only rule would
  have admitted as a false "did not review" row.
  ✅ **Residual R-W9a — CLOSED 2026-08-26 by the round-1 council fix wave (findings A1 + C1,
  both Confirmed).** The residual as filed: the SKIPPED-retry partial note (`{waveId, models,
  reason, seat}` on `seat-unbound`, emitted when the once-only retry never attempted the seat)
  is a genuine loss carrying no retry-family field, so all three consumers dropped it; the
  entry called closing it "a design call, deliberately not taken inside W9". The council
  refused that deferral and it did not survive contact: the choice was between a producer
  field and an extra gate arm, and only ONE of those is honest.
  Closed at the **producer**, with the gate untouched. `run-retry-notes.js :: skippedWaveNote`
  now emits the `firstFailure` fact the record has always carried implicitly — the canonical
  `run-retry-group.js :: recordFailure` shape for a partial wave (`class: 'missing'`, the
  record's own waveId/reason) — plus the `data.seatId` its `seats[0]` supplies. The gate is
  byte-unchanged, so the three exclusion controls (orphan-leg, re-vote, Stage-2 judge) stay
  green; their mutants were re-measured and two of the three red sets moved.
  ⚠️ It emits **NO `retryWaveId`, and must not**: nothing was retried, and naming a wave that
  never launched is a false statement about spend. That field is also what the two renderers
  read to decide the "retried once" phrasing — which the W9 gate spelled as
  `retryWaveId || firstFailure`, the SAME expression, so admitting the record would have
  labelled a never-retried seat retried. Both renderers' `retried` READ is therefore narrowed
  to `retryWaveId` alone (mutant SKIPRETRIED-A/B). Measured and safe: every builder describing
  a seat that WAS retried emits `retryWaveId` — `skippedWaveNote` itself is the sole shipped
  `firstFailure`-without-`retryWaveId` producer, and its seat was never retried, which is
  exactly why the narrowed read must not badge it.
  ⚠️ **Gap this exposed, now closed:** every W9 consumer pin was fixture-based, so mutant SKIPFF
  (drop `firstFailure` at the producer) red exactly ONE test in the entire suite. An end-to-end
  case in `run-stages.test.js` now feeds the note the engine actually emits to both production
  readers.
  **Residual R-W9b:** with no `run.criticSeat` on the document the critic ROLE is
  still alias-inferred (the row now survives regardless — see R4 below).
  ✅ **Round-1 council C2/C3 (both Confirmed, minor) — also closed in that wave**, both in
  `live-dead-seats.js :: deadSeats`. **C2:** seat-keying the `byRole` READ dropped the
  alias-side suppression the pre-W9 read had, so a live critic leg carrying no seat id (a
  terminal cost row, or any document written before v4.8 R5) left a seat-KEYED critic candidate
  matching nothing — a ghost "critic did not review" row. The read now consults both keyspaces,
  with the alias arm fed ONLY by unseated live legs so R4's fix cannot re-open. **C3:** `roleOf`
  trusted a truthy key to be seat-space, but `firstFailure.seatId` is ALIAS-valued on the
  inexact-twin branch (residual R3) — so the critic's OWN record came back role null while
  `deriveSeatLoss`, comparing `data.seat` to the alias, called it a critic loss. The critic tag
  now also compares the key against the critic alias, and the cross-surface agreement the
  finding named is pinned as a test that drives both surfaces with one record.
  (⚠️ **Both citations were re-derived and
  re-opened at T-A8, 2026-08-17.** They read `live-seats.js:188` and `workspace-seats.js:61`: the
  first was OUT OF RANGE — `live-seats.js` is **125** lines, and the filter moved to
  `live-dead-seats.js` in the PR5c split, where it is `:144` today; the second landed on **docblock
  prose**, the filter itself being `:77`. Anchored by symbol per the anti-rot rule, which takes both
  out of the line-citation class for good. ⚠️ The two "today" numbers in this parenthetical are the
  dated 2026-08-17 reading and BOTH moved again in v4.9 W9 — the rules are now
  `live-dead-seats.js :: isSeatLoss` and the channel test inside `retriedSeats`, by SYMBOL. Do not
  re-number them; the entry's own point is that these two citations rot every single pass.) (`deriveSeatLoss`, not
  `summarizeSeatLoss` — `writeVerdictFiles` at `run-assemble.js:217-219` takes the
  `deriveSeatLoss` branch whenever `degrades` is present, which it always is for a run that lost a
  seat; `summarizeSeatLoss` is a fallback reached only when a direct caller supplies `deadWaves`
  with no `degrades` at all. This item closes the CHANGELOG's known-limitation entry for this
  release: `verdict.json`'s `seatLoss` not yet naming a partial-return loss.) This is **not** a
  plain channel-list edit: two different note shapes ride the `seat-unbound` channel and mean
  opposite things about spend. An **orphan** note (`data.legId` present) means a review DID
  land, just unattributable — counting it as a lost seat would over-report losses and
  double-count a review that was already paid for and rendered. A **missing-seat** note
  (`data.legId` absent) means the seat is genuinely absent. Discriminate on `data.legId`, never
  on channel membership alone.

- [ ] **PR4 · `run-stage2.js:57` builds its judge roster from `reviews[].modelInput`, so a twin
  bench pays for two judge legs and clobbers one `judge-<alias>.md`.**
  (⚠️ **2026-08-25, v4.9 W2: the roster line moved — `run-stage2.js :: runStage2`'s
  `const judges = reviews.map(r => r.modelInput)` is `:119` today; `:57` now sits inside the
  extracted `bindStage2Seats`.**) Pre-existing, not
  introduced by PR2b, and PR2b did not change how many reviews reach Stage 2: `materializeReviews`
  already returned one in-memory entry per complete leg, so a twin bench already handed Stage 2
  two reviews — only the FILE on disk was clobbered. What PR2b changed is that those two reviews
  now land in two distinct seat-named files (Task 3) instead of one clobbered alias-named file.
  The Stage-2 judge-roster defect is unchanged by that and still real.

**Deferred minors, from PR2b's per-task reviews** — none blocked PR2b, each triaged as safe to
carry forward rather than fix in-flight:
- ~~The `o.seats`-absent fallback in `run-stage1-launch.js` has no test.~~ **CLOSED in PR2b's
  final fix wave** — and it was not merely untested. Writing the test showed the fallback was
  BROKEN: `run-stage1-launch.js:20-22` re-derives the table with `buildSeats`, so a leg's `m.seat`
  is truthy while `o.seats` is undefined, and `roleAt(undefined, id)` answers `'seat'` without
  throwing — collapsing every critic and lens role on exactly the path the fallback exists to
  serve. Both flip sites now read the seat's own `role` instead of looking it up
  (`run-stages.js`'s review push, `run-stage1-rows.js`'s dead-seat push); `roleAt` stays exported
  from `seats.js` for later PRs. Pinned by `run-stages.test.js` "o.seats absent".
- `counts.total` excludes the seats of a wholly dead wave (they never reach `legs`), so a run
  that loses both a whole wave and a leg under-counts. Consider making `total` the launch roster
  size — now derivable from the per-wave roster PR2b added — rather than a count built up from
  survivors.
- `schemas/council-run.schema.json` could declare `deadWaves`/`seats`/`partial` under
  `stages[].items.properties` so these additive fields are documented rather than merely
  tolerated (the schema has no `additionalProperties:false`, so nothing breaks either way).
  Same treatment for one more undisclosed additive field on the OTHER persisted surface:
  `run-retry-group.js :: recordFailure` stamps `seatId` onto every `firstFailure` (anchored BY
  SYMBOL — this read `:49`, which is a BLANK line and was already blank at `42738592`, so it was
  rot found in passing, not moved by the A1 fix; the real site is the `unit.firstFailures.push`
  call), which rides `data.firstFailure`
  into `run.json`'s `degrades[]`. Like `deadWaves[].seats` it equals the alias on any unique-alias
  bench, so no shipped run's shape changes — but unlike that field it got no disclosure anywhere.
- The twin-bench "one seat bound, one not" case is only half pinned. The RETRY-loop half HAS a
  test — `run-stages.test.js`'s "CARRY (Task 6 minor): a twin bench retry with ONE seat bound and
  one not heals exactly one twin". The `run-stages.js` ABORT-branch half is the one still verified
  by hand-probe only, with no pinned test.
- ~~A hypothetical `seats`-less dead-wave record would collapse twins to one row. Unreachable today
  — all four dead-wave producers carry `seats` — and consistent with the existing "two
  unidentifiable losses collapse to one" rule elsewhere, but worth a note if that ever changes.~~
  ⚠️ **BOTH clauses are FALSE since T2.2 (`33e2ecf7`, 2026-08-16); corrected in `27febfb8`.** The
  *unreachable today* half still holds — all four dead-wave producers carry `seats` — but the
  consequence and the justification do not. Measured through the real `pushDeadSeatRows` with the
  `seats` key entirely **absent** on a twin alias: **2 rows**, not one. `s` is `null` either way, so
  `exact = !!s || !twins.has(alias)` is **false** on a repeated alias and the slot keys by a unique
  `Symbol` — the R2 MARK branch. And the *"two unidentifiable losses collapse to one" rule
  elsewhere* is precisely the rule T2.2 abolished (see SI-22.3 and "The durable finding" above), so
  it can no longer be cited as consistency for anything.
  **What actually governs the collapse now is the ROSTER, not `w.seats`.** Measured on the same
  probe: a `seats`-less wave with **no `o.seats` at all** still gives **1 row** — `twinAliases`
  returns an empty Map with no roster, which is its deliberate "no proof, err toward collapsing"
  design. Controls held: `seats:[null,null]` on a twin alias → 2 rows; `seats`-less on unique
  aliases → 2 rows, one per model; identified seats → 2 rows that carry their seat ids.

**Size note:** `src/council/run-stages.js` is at 292/300 lines and `src/council/run-retry.js` at
290/300 — the next task touching either file must extract before adding, not squeeze in more.
(Re-measured at the PR3 cut: both unchanged. `run-debate.js` 260/300 and the new
`run-debate-revote.js` 168/300 after Task 1's extraction.)
⚠️ **STALE — a PR3-era reading, kept for provenance. Re-measured 2026-08-17 (T-A8) with the gate's
own rule: `run-stages.js` **294**, `run-retry.js` **295**, `run-debate-revote.js` **176**. The
warning still holds and is now sharper; the authoritative table is *Size gate — re-measured
2026-08-17* above.**

#### Seat identity — PR3 handoff (2026-08-13)

PR3 carried the seat through Stage 2 and the debate round: `judge-<seat>.md`
(`run-stage2.js:145`), `judgeResults[].seat`, a seat-keyed Stage-2 conformance merge
(`run.js:224-228`), additive **emit-when-different** `adjudications[].seat`
(`run-assemble.js:166`) and `findings[].raiserSeat` (`anonymize.js:60`), and a debate round that
joins on the seat at every hop — `debate.js :: debateTargets` (**was `:201`**),
`debate.js :: disputingJudges` (**was `:175`**), `debate.js :: applyDebate` (**was `:81`**),
the re-vote repair id
(`run-debate-revote.js :: repairId`, **was `:139`; re-anchored BY SYMBOL 2026-08-21 after v4.8
Phase 5 grew that file 176→282 (T5.1 took it to 249; the two fix waves added the rest), and T5.5
took it to **274** on 2026-08-22 (−33 deleting the `boundLegs` arm and its comment block, +25
across the in-file comment repairs those corrections forced over THREE review rounds — including
the announced `why` string, which still said the refused leg "bound to no roster slot", and the
`what` string, which said it "matches no seat on that wave's roster" for three rounds longer). The
repair id is `:211` today, re-opened against the FINAL tree. ⚠️ Headroom: that file was 176/300 at
BASE and is **274/300** now — extract before adding. ⚠️ The "`:139` now holds the `isAbortExit`
return" clause that stood here was true at T5.4 and rotted at the round-2 fix wave, which added
five lines above it — dropped rather than re-guessed**) and all four launcher call sites, each projecting seat → alias
through the single `aliasOf` built at `run-debate.js :: aliasOf` (**was `:116-117`, which is now
the comment ABOVE it; the build is `:129` — re-opened in the same pass**). `runRevoteWave` moved to
`src/council/run-debate-revote.js` (Task 1, byte-identical). What that unblocks, and what it
deliberately left alone:

- [x] **DONE (v4.8 — verified by execution 2026-08-16) · PR4 · `tally.js:96`'s peer filter is now UNBLOCKED — both sides carry a seat.**
  `const peers = f.raiser ? votes.filter(v => v.judge !== f.raiser) : votes;` still compares
  aliases, so on a bench that repeats an alias a twin's legitimate peer vote on its twin's finding
  is dropped and the finding can tier `Singleton` on a full basis — #137's tally half. Before PR3
  the seat-exact form was not expressible inside `tally()`; it is now: every vote carries
  `v.seat` (`tally.js:89`, from `adjudications[].seat`) and every finding carries `f.raiserSeat`
  (**produced** at `src/council/anonymize.js:68`; **read** in `tally.js` at `:111`, `:139` and
  `:141`), both emit-when-different. ⚠️ **Citation corrected 2026-08-16:** this sentence cited
  `tally.js:106` for `f.raiserSeat` — that line is a **comment**, not an executing line. Re-measured
  with `grep -n raiserSeat src/council/tally.js`: `:101`/`:103` are comment, `:111`/`:139`/`:141`
  are code.

  **What shipped is NOT what this item prescribed.** The prescribed form
  `(v.seat || v.judge) !== (f.raiserSeat || f.raiser)` was measured in both orphan directions and
  **re-arms #137** — it admits the raiser's own vote as its own peer. It was deleted from this
  filing on 2026-08-16. The executing filter is `tally.js:111`:

  ```js
  votes.filter(v => (v.seat && f.raiserSeat) ? v.seat !== f.raiserSeat : v.judge !== f.raiser)
  ```
  - **Verified by execution (2026-08-16):** `src/council/tally.js :: tally` — the peer filter
    compares seats when both sides carry one, aliases otherwise, at `tally.js:111`:
    `votes.filter(v => (v.seat && f.raiserSeat) ? v.seat !== f.raiserSeat : v.judge !== f.raiser)`.
- [x] **DONE (v4.8 Phase 2 T-B2, 2026-08-19) · PR4 · `debate.js :: debateTargets` was a SECOND
  copy of that same filter and has moved with it.** ~~`peerVerdicts = (f.adjudications ||
  []).filter(a => a.judge !== f.raiser)` builds the peer split a raiser sees in its defense
  briefing. Fixing the tally alone would make the brief the models read disagree with the tally the
  chair reads. Deliberately left alias-space in PR3 for exactly that reason.~~ There is no second
  copy now: `peerVerdicts` **calls** `peer-split.js :: peersOf`, the same function
  `src/council/tally.js :: tally` calls, so the two documents agree by construction. Note the
  quoted expression above was already PR3-era: by PR4c this site spelled a TWO-branch seat/alias
  filter, and `peersOf` has THREE — the missing outer `f.raiser ? … : votes` is precisely what
  made the brief and the tally disagree on any finding with a falsy raiser (`''` via the MCP path,
  `undefined` via the CLI path). Measured at `8e97faaf` and pinned by `debate.test.js` T5a/T5b/T5c.
  ⚠️ **ANNOTATION, not a rewrite (docs/CITATIONS.md): the `: votes` spelling above was true through
  `64b835b8` and is no longer.** v4.8 T-B4 changed that outer arm to keep only NAMED judges, so a
  falsy raiser can no longer corroborate itself. The count of branches and the divergence this
  paragraph records are both unaffected; only the arm's body moved. T5a/T5b/T5c still pin the
  agreement, at re-measured values — see `peer-split.js :: peersOf` for the shipped form.
- [x] **CLOSED (v4.8 T-B4 round 2, 2026-08-19) · the SEAT-space half of the same class.**
  ~~Filed the same day as OPEN: T-B4 round 1 stopped an unnamed raiser (`raiser: ''` or missing)
  from counting an equally-unnamed judge's vote as peer signal, but not the seat-space twin — when
  the raiser is falsy while the finding carries a `raiserSeat` and a vote carries the SAME `seat`
  with a NAMED `judge`, that vote is provably the raiser's own and was still counted. MEASURED at
  **36 cases** over the 1875-case truthiness cross-product of (raiser, raiserSeat, judge, seat,
  verdict) — 5 values for each of the four identity fields times the 3 verdicts, `5^4 x 3` — unchanged
  from `64b835b8`.~~ **Closed hours later by the owner ruling
  that produced it.** The round-1 filing rested on a specification whose property 2 said "a NAMED
  judge counts beside a falsy raiser" while justifying it as "provably not the raiser" — and those
  diverge in exactly those 36 cases, because a vote carrying the raiser's own seat id IS the
  raiser's own vote. The corrected rule makes the SEAT comparison decide FIRST for any raiser (P0):
  equal seats ⇒ the raiser's own vote, excluded and NOT announced; different seats ⇒ a real peer,
  counted. Announcing a seat-decided exclusion is explicitly wrong — the mark is for genuine
  ambiguity only, and counting attributed drops there would make one number mean two things.
  Four spellings were enumerated against the corrected properties: `64b835b8` violates P0 in 90
  cases and P1 in 567; round 1's form violates P0's peer rule in 90 and its no-mark rule in 108; a
  "named judge AND not the raiser's own seat" variant violates them in 54 and 108; **the shipped
  form violates none, and the 36-case residual measures ZERO.** Pinned by
  `tests/council/peer-split.test.js`'s P0 block (the round-1 fixture is P0a, inverted) and by
  `tally.test.js` T7b/T7d. ⚠️ **Still not SI-22.1 or SI-22.2** — those are NAMED-raiser shapes,
  untouched by either round.
- [x] **DONE (filed v4.8 T-B4, TAKEN v4.8 T-B5 2026-08-19) · SIZE CEILING · `src/council/peer-split.js`
  reached 289/300; the extraction landed and the file now measures 192.** Read this BEFORE planning any change
  to the peer-split predicate. Measured at each commit with `git show <rev>:src/council/peer-split.js
  | wc -l`, the file went **67 → 165 → 218 → 244 → 266 → 282 → 289** across `0fd630b6` (the
  extraction), `64b835b8` (PR B base), and T-B4's four commits plus its second fix round — and every
  one of those lines is a measured record, not prose that can be trimmed. **11 free is not enough for
  the next behaviour change**: T-B4's round 2 cost 16 and was a three-token edit to one expression,
  the rest being the rationale, the re-scored property table and the mutant records the change
  obliged; its documentation-only fix round then cost 7 more. ⚠️ **This filing's own number went
  stale inside the commit that wrote it** — it read 282 until the fix round it belongs to pushed the
  file to 289 — which is the same class of defect as the twin sentence in F1 and the reason the
  number here is a measurement rather than a recollection. ⚠️ **Do not discover this mid-task the way #171 discovered `run-retry.js`.**
  **THE EXTRACTION CANDIDATE WAS THE MUTANT RECORDS, and they are what T-B5 moved.** FIVE named
  mutants lived in this file — `SPLITDROP`, `NAIVESPLIT`, `SELFCORROB`, `SEATBLIND` (all on
  `peer-split.js :: peersOf`) and `ZEROEMIT` (on `peer-split.js :: unattributedPeerDrops`).
  ⚠️ An earlier draft of this line said **six** lived here and over-counted by one: the release's
  sixth named mutant, `SCHEMADROP`, mutates the schema rather than this module and was never in this
  file. **108 lines** of self-contained provenance that **no code reads and no gate reaches** moved;
  the per-conjunct flip counts on `unattributedPeerDrops` deliberately did NOT, because they are
  measurements OF that expression rather than mutant records, and they belong beside it. Each is a
  mutation definition plus a measured red set plus the history of how that red set moved. They are
  the single largest block, they are pure documentation, and they are the block most likely to grow
  again. ⚠️ **Extracting them has a real cost that must be planned for, not discovered:** a number
  that lives beside its predicate is re-read by anyone editing that predicate, and one that lives in
  a separate file is not — which is exactly the failure mode that produced T-B3's Critical and T-B4's
  F1. Whatever holds them must be reachable from the predicate by a **symbol anchor**, and the
  re-measure obligation has to travel with them.
  **NOT taken in T-B4, by owner ruling:** the gate has not fired, an extraction is a structural change
  with its own review surface at the end of an otherwise-verified PR, and it insures a future change
  rather than this one.
  **TAKEN in v4.8 T-B5** as council finding C4 — as its own commit and before any other edit,
  precisely so no later fix could hit the ceiling mid-flight the way `run-retry.js` did in PR #171.
  Destination `tests/council/peer-split-mutants.js`, chosen for four properties: it is tracked; it is
  a `.js` file, so `check-citations` blocks any commit that deletes or renames it while the anchors
  stand — measured, not argued: drop the path from the tracked set and all three anchors report
  "no tracked file matches", and `scopeForCommit` really does pull `peer-split.js` in. That is not
  true of the doc tree, which the gate deliberately does not scan. ⚠️ **It is the ONLY citation
  property at stake.** A first draft of this entry also claimed the gate enforces the citations
  *inside* the records; measured with the real exported `parseCitations`, **the 108 moved lines
  contain ZERO parseable citations** — `peer-split.js` held exactly three at `7aa71d1e`
  (`tally.js@115bc861:93-112`, `debate.js :: debateTargets`, `mcp-tools.js:416`), all OUTSIDE the
  moved regions and all still in the file. The records name files only in passing, never with a line
  or a symbol. It is not a jest suite
  (`jest.config.js :: testMatch` collects `*.test.js` only), so the suite count did not move; and
  both predicates carry a one-line symbol anchor to it, which is how the re-measure obligation
  travels. Proven inert: the executable text of `peer-split.js` is byte-identical to `7aa71d1e`, and
  the suite totals are unchanged at 541 / 7657 passed / 8 skipped / 0 failed.
- [ ] **OPEN (filed v4.8 T-B4, 2026-08-19) · `raiser` and `judge` should be `z.string().min(1)` in
  the MCP tool schema.** `src/mcp-tools.js:416` declares a bare `z.string()` for `findings[].raiser`
  and `:420` the same for `adjudications[].judge`, so `''` validates and reaches the tally — and
  from there the append-only ledger. That is what made every shape council C1 raised reachable in
  production. `.min(1)` on both would make the empty string unrepresentable at the boundary instead
  of merely handled downstream, which is the better lever for the CLASS. **Deliberately not taken in
  T-B4**, by owner ruling: it has its own blast radius — a caller currently sending `''` would start
  getting a validation rejection where it previously got a silently mis-scored document — and it
  deserves its own pins rather than riding a behaviour fix. ⚠️ **It does NOT subsume the T-B4 fix**:
  `cli-handlers-council.js` reaches `tally()` through a raw `JSON.parse` with no schema at all, so
  the predicate still has to be right on its own. Do both, in that order, not one instead of the
  other.
  ⚠️ **RE-RAISED as council C2 [major] in round 2 of PR #174 and DECLINED AGAIN at v4.8 T-B5** — as
  already-filed, not as wrong. Both line citations above were re-opened and verified at T-B5:
  `src/mcp-tools.js:416` is `raiser: z.string()` inside the `findings` object and `:420` is
  `judge: z.string()` inside `adjudications`. **No schema was changed.** A future round raising it
  a third time should tick this box rather than open a new item.
- [x] **PR4 · `street-cred.js :: computeStreetCred`'s peer split (`if (judge !== m)`) is the third
  alias comparison** — `peersOnly` excludes every twin's rank of its twin. ⚠️ Do **not** fix this
  before the anonymize twin collapse: `assignLabels` (`anonymize.js@5ef5048e:20-33`) gives two twin
  seats one `letterByModel` key (last wins) and `rankPositions` (`street-cred.js :: rankPositions`)
  collapses them, so `rankings[].order` is already meaningless on a twin bench and street-cred
  computed from it cannot be made correct by editing the peer split alone. Seat-ify
  `assignLabels`/`rankingToOrder` first.
  ✅ **CLOSED 2026-08-21 — v4.8 Phase 3 (SI-06), in the order this item required.** T3.2
  (`b17a6329`) seat-ified `assignLabels`/`rankingToOrder` first (an additive `seatMap`/`orderSeats`;
  `labelMap`/`order` stay byte-identical); T3.3 (`fb3fa09d`) then closed the peer split itself —
  `street-cred.js :: computeStreetCred` now compares SEATS when both sides carry one and ALIASES
  otherwise (controller ruling ledger C-2), reusing `peer-split.js :: peersOf`'s two-branch shape
  rather than re-deriving it. `computeStreetCred` and `rankPositions` both moved out of `tally.js`
  into the new `street-cred.js` in the same commit (`tally.js` re-exports `computeStreetCred` only);
  the two citations above are updated to follow, per this task's own citation-anchoring rule.
  ⚠️ **The `letterByModel` deletion this item also names (T3.1, `13ae8cf6`) was never a functional
  prerequisite here** — measured, `letterByModel` had no production consumer anywhere in `src/`
  (SI-26), so seat-ifying or deleting it changes nothing `computeStreetCred` reads. The actual
  prerequisite this item asked for — a seat channel on `assignLabels`/`rankingToOrder` — is T3.2's
  contribution, not T3.1's; the two are easy to conflate because both touch `anonymize.js`.
- [x] **DONE (v4.8 — verified by execution 2026-08-16) · PR4 · the R8 `sameModelCorroboration` stamp (spec §4.6; R8 itself is in the §1 Owner
  rulings table) is still unwritten.** Spec
  §4.5 pairs it with the `tally.js:96` fix: once same-model seats count as each other's peers, the
  corroboration has to be *labelled* on the finding rather than silently folded into the basis.
  Listed in the spec's artifact table (`tally.json`, per finding, optional in schema) and in no
  shipped code.
  - **Verified by execution (2026-08-16):** `src/council/tally.js :: tally` — the
    `sameModelCorroboration` stamp is emitted at `tally.js:140-142`: `...(f.raiser &&
    peers.some(v => v.seat && f.raiserSeat && VERDICTS[v.verdict] === 'a' && v.judge ===
    f.raiser) ? { sameModelCorroboration: true } : {})`.
- [x] **DONE (v4.8 — verified by execution 2026-08-16) · PR4 · `meta.seats` is still absent from the tally input.** `buildTallyInput`'s meta
  (`run-assemble.js:154-159`) carries `models` and nothing that names a seat, so a consumer
  holding only `tally.json`/`verdict.json` cannot map `adjudications[].seat` back to a bench
  position — `run.json`'s `seats[]` (seeded `null` at `run-state.js:99`, filled by
  `preflightSeats`) is the only place the table exists. Every seat-aware renderer therefore has to
  read two documents.
  - **Verified by execution (2026-08-16):** `src/council/run-assemble.js :: buildTallyInput` —
    `meta` carries `seats` (emitted only when the bench repeats an alias) at `run-assemble.js:203`:
    `...(Array.isArray(seats) && seats.some(s => s.id !== s.alias) ? { seats: seats.slice() } : {})`.
  - **Note (2026-08-16):** this item's DONE does **not** endorse the "`position` is unrecoverable
    on every bench" claim that `run-assemble.js` and `run-assemble.test.js` carried. That claim was
    measured false and corrected in the same PR. See SI-21.
- [x] **DONE (v4.8 — verified by execution 2026-08-16) · PR4 · `verdict.json` carries `adjudications[].seat` but NOT `findings[].raiserSeat`, so a
  verdict-only consumer cannot tell which twin raised a finding.** `buildVerdict`
  (`src/council/verdict.js:113-127`) rebuilds every finding from an explicit field list — `id`,
  `raiser`, `severity`, `tier`, `basis`, `confidence`, `tierOverride`, `duplicateOf`,
  `adjudications`, `decision`, `applied`, plus `debate` when present. `adjudications` is passed by
  reference (`:121`), so PR3's per-vote `seat` survives; `raiserSeat` has no slot and is dropped.
  Measured on a twin bench: the tally finding carries `"raiserSeat":"deepseek#1"`, the verdict
  finding does not, while both carry `adjudications[0].seat === "deepseek#2"`. Every caller writes
  through `buildVerdict` (`run-verdict-files.js:41`, `cli-handlers-council.js:200`,
  `mcp-server.js:1456`), so there is no second path that could add it.
  ⚠️ **CORRECTED at T-A8, 2026-08-17, by re-opening all three.** This entry cited
  `run-assemble.js:223` for the first caller; `run-assemble.js` **does not call `buildVerdict` at
  all** (`grep -n 'buildVerdict(' src/council/run-assemble.js` — no hits) and `:223` there is
  `buildChairPacketFile`'s signature, so the number also COLLIDED with SI-25's correct
  `run-assemble.js:223`. ⚠️ **That collision is now historical: `:223` names neither function.**
  Counting rule — the line of `function buildChairPacketFile(` in `src/council/run-assemble.js`,
  measured 2026-08-23 at both v4.8 SI-25's BASE `c0745013` and its HEAD: **`:242` at both**, so the
  drift is PRE-EXISTING and nothing in SI-25 moved it. Read
  `run-assemble.js :: buildChairPacketFile` by symbol; the point this paragraph makes — that a bare
  number can collide across two unrelated items — survives its own example rotting.
  The real site is `run-verdict-files.js:41`. Re-opened in the same pass:
  the field list is `src/council/verdict.js :: buildVerdict` (`:101`), whose `adjudications:
  f.adjudications` is `:128`, **not** the `:113-127`/`:121` this entry cited — read those two by
  symbol. **Not fixed in PR3** — the
  CHANGELOG describes what shipped, and threading it through is a code change PR3 did not make.
  Fix alongside `meta.seats` above: both are the same "the seat table stops before the summary
  document" gap.
  - **Verified by execution (2026-08-16):** `src/council/verdict.js :: buildVerdict` —
    `findings[].raiserSeat` is emitted at `verdict.js:147`: `...(f.raiserSeat ? { raiserSeat:
    f.raiserSeat } : {})`.
- [x] **DONE (v4.8 Phase 5 T5.1 + T5.2, 2026-08-21) · PR4 · an `-rv` leg that binds to NO seat makes
  `applyDebate` invent an adjudication row —
  fix the JOIN, not the announcement.** `runRevoteWave` (`src/council/run-debate-revote.js :: seatKey`,
  **was `:124`; re-anchored BY SYMBOL 2026-08-21 after v4.8 Phase 5 grew that file 176→282, then
  T5.5 took it to 274 on 2026-08-22. Re-opened against the FINAL tree: `:124` is
  `reVoteUnboundNote`'s `why` line itself, the signature `async function runRevoteWave(` is `:148`,
  the `revote-bundle.md` `writeFileSync` is `:153`, the `seatKey`
  definition is `:64` (unmoved through all of THAT) and its one call site is `:196` — **was `:188`**.
  ⚠️ The T5.4 reading "`:124` now holds the `writeFileSync`" was true when written and rotted at
  the round-2 fix wave, before T5.5 touched anything**
  ⚠️ **Every line number in this parenthetical moved again on 2026-08-23, when v4.8 SI-27 took
  the file 274→268: the signature is `:153`, the `writeFileSync` `:158`, `seatKey` `:69`,
  its call site `:190`. The
  2026-08-22 reading is left standing as the dated measurement it is; the ANCHOR was already a
  symbol, which is why this entry needed an annotation and not a re-derivation.**
  ⚠️ **2026-08-25 (v4.9 W3, SI-DUP b): `seatKey` has since LEFT this file entirely — the one
  definition is `run-retry-keys.js :: seatKey` and `run-debate-revote.js` now imports it; the
  symbol anchor above names where it lived when measured.**)
  falls back to `seatKey(null, alias)` for a leg `bindSeats` could not attribute, so `byJudge` is
  keyed on the bare alias. On a bench that repeats an alias every provisional adjudication is
  seat-attributed, so `applyDebate`'s `(a.seat || a.judge) === key` (`debate.js:99`, **was `:81`,
  then `:83`; re-opened 2026-08-21 after T5.3 grew that file 256→274**) matches nothing, and the
  fail-open push at `debate.js:111` (**was `:90`, then `:93`; re-opened in the same pass**) appends a
  NEW row instead of replacing one. **Measured**
  on `--models deepseek,deepseek,gpt` with one `-rv` leg left unattributable: 4 adjudications in,
  **7 out**; `B1` ends with **four votes on a three-seat bench** — `gpt` agree, `deepseek#2` agree,
  a seat-less `deepseek` agree that corresponds to no bench position, and `deepseek#1`'s **stale
  `dispute` still standing**, because the row the re-vote was meant to replace was never found.
  Exit 0, `degraded === false`, no degrade note. Merge-base never invented a row: it matched on the
  alias, which always hit. **The remedy is the join** — key the wave's fallback on something the
  adjudications actually carry, or refuse to apply a re-vote whose seat is unknown. A degrade note
  is not the fix: it announces an invented voter without removing it, and the invented row is what
  reaches `tally.js`'s basis counts and `report.js`'s `byJudge`. ⚠️ Currently **unreachable from
  the production launcher** — `src/sidecar/fanout-leg.js` stamps `taskId: legId` on every leg it
  returns, on both the error path (`:61`) and the normal one (`:191`), so a real fanout leg always
  binds by roster slot. That is what makes this a latent PR4 item rather than a live regression;
  it is not a reason to leave the join alias-shaped. *(The Task-6 deferred-minor ledger entry filed
  this as "an observability gap, not a regression" and proposed adding the missing
  `orphanLegNote`/`seat-unbound` notes. That classification was wrong — corrected by the final
  whole-branch review, F3. That ledger is a local working note and is not committed to this repo,
  so the measured evidence is restated above rather than cited.)*
  - ✅ **CLOSED 2026-08-21 — v4.8 Phase 5 T5.1 (`9868be06` + fix round `6b452c99`) + T5.2
    (`4eee59fa` + `c9b9c541`); NARROWED 2026-08-22 by T5.5 (`f19624c4`) (SI-10).** The remedy is the
    one **owner ruling R8** picked, taken at the join: `runRevoteWave` publishes `byJudge[key]` only
    when the key names a judge this wave actually launched — the `judgeKeys.includes(key)` guard in
    `run-debate-revote.js :: runRevoteWave` (`:262`). ⚠️ **It shipped with a SECOND arm,
    `boundLegs.has(leg) ||`, which T5.5 deleted** — that arm admitted the very SI-10 shape this
    entry closes everywhere else; see the T5.5 sub-entry below for the mechanism and the
    measurement. Otherwise the parsed votes are **withheld** and the
    refusal is announced on the **`seat-unbound`** channel
    (`run-debate-revote.js :: reVoteUnboundNote`). The leg itself is untouched: it still gets its
    `runStats` row, its `revote-<name>.md` and its `conformance` — only the votes are withheld.
    ⚠️ **The refusal DEGRADES the run — exit 2**, exactly as a Stage-1 orphan already does. The note
    carries no `kind`; `src/utils/degrade.js:34` defaults it to `'degrade'` (`KINDS` is only
    `degrade`/`heal`), `run-degrade.js :: createDegradeSink`'s `note()` sets `degraded.value = true`
    for that kind, and `run-finalize.js :: resolveTerminalExit` turns that into **2** on an
    otherwise-clean run. That chain was measured by probe on 2026-08-21 and is **pinned end to end
    since T5.5** — see the closed exit-2 follow-up below. Measured end to end through the real
    `runDebate`, twin
    bench, one unbindable `-rv` leg: **3 adjudications → 2**, the seat-less phantom row gone, `C1`
    `Confirmed {a:2,d:1}` → `Contested {a:1,d:1}`, exactly one `seat-unbound` note — and the **bound**
    twin's re-vote still applies, so the refusal is **surgical**, not a blanket revert. Pinned by
    named mutants recorded in `tests/council/run-debate.test.js`. ⚠️ **All five older counts were RE-MEASURED at T5.5 (2026-08-22)** across six suites
    (`run-debate.test.js` + `debate.test.js` + `run-stages.test.js` + `seat-space.test.js` +
    `degrade-sink.test.js` + `run-finalize.test.js`, 243 tests), because T5.5 added three tests
    to the guard's path and Global Constraint 3 says a red set that GROWS is the proof they
    entered it. **Three moved.**
    Deleting the guard — recorded as `JOINBLIND` (1) at T5.1 and, for the identical deletion once
    T5.2's end-to-end pin existed, `E2EBLIND` (2) — reds **6**; `LEGDROP` was 1 and is **2**;
    `REFUSEALL` is **3**, unchanged. T5.5's own five: `BOUNDREADD` **2**, `WHYSTALE` **2**,
    `WHATSTALE` **3**, `NOTEHEAL` **1** and `KEYRAW` **1**. ⚠️ Re-measured a SECOND time after review round 1 added
    the note-fallback test: guard-deletion 5 → **6** and `WHYSTALE` 1 → **2**, since that test
    loses its note when the guard goes. The earlier numbers are kept above as DATED readings, not
    live values. ⚠️ Deleting "the guard" is also a smaller edit than it was: T5.5 removed its
    first arm.
    ⚠️ **What this did NOT do:** *resolving* an ambiguous bare-alias key to a seat (the other remedy
    this entry names — R8 ruled for refusal over resolution), and `debate.json` still gets no
    `applied: false` row for a refused leg, so `revoteJudges` and `revoteApplied` will visibly
    disagree and the degrade note is what explains why.
  - [x] ✅ **CLOSED 2026-08-22 — v4.8 Phase 5 T5.5 (`f19624c4`, assertion order `8d40f4f5`).
    Filed 2026-08-21 (v4.8 Phase 5 whole-branch review): the exit-2 consequence of a `seat-unbound`
    re-vote refusal was NOT pinned end-to-end by any single test.** Both halves of the chain were
    pinned independently; the composition was not.
    **Half 1** — a default-kind note flips the flag:
    `tests/council/degrade-sink.test.js` :: *"note() writes stderr, appends run.json, and flips
    degraded"*, which asserts `degraded.value === true`.
    **Half 2** — the flag turns a clean 0 into 2: `tests/council/run-finalize.test.js` ::
    *"the degrade flag turns 0 into 2 (a shrunken bench, a thin cross-review, …)"*.
    **The gap was:** every Phase 5 `-rv` fixture drives `runRevoteWave` with `ctxFor`'s `degrade`,
    which is a RECORDING DOUBLE (`{ note: (rec) => notes.push(rec), all: () => notes }`), not
    `run-degrade.js :: createDegradeSink` — so no committed test carried a refusal all the way to
    an exit code. The composition WAS measured by probe during T5.4, but a probe is not a pin.
    **The pin:** `tests/council/run-debate.test.js` :: *"runRevoteWave — T5.5: a seat-unbound
    refusal reaches terminal exit 2"*. It is T5.1's twin-bench refusal fixture with exactly ONE
    substitution — `ctx.degrade` swapped from the double to the production `createDegradeSink`,
    wired to the same `{value:false}` flag `run.js:64-65` gives it — and the record under test is
    **derived from the real `runRevoteWave`**, never hand-built (plan Global Constraint 5). It
    asserts `degraded.value === true` and
    `resolveTerminalExit({signalled: null, exitCode: 0, degraded, …}) === 2` (arguments mirroring
    the sole production call, `run.js:111`), with an unflipped-flag control returning 0.
    ⚠️ **Named mutant `NOTEHEAL`** — add `kind: 'heal'` to the record `reVoteUnboundNote` returns.
    A deliberately QUIET edit: `makeDegrade` accepts 'heal', every channel/what/why/effect/data
    assertion in that file still passes, and only `createDegradeSink`'s
    `if (record.kind === 'degrade' && degraded)` stops firing. Red set (**1**): that test and
    nothing else, across `run-debate.test.js` + `debate.test.js` + `run-stages.test.js` +
    `seat-space.test.js` + `degrade-sink.test.js` + `run-finalize.test.js`.
    ⚠️ **Assertion ORDER inside that test is load-bearing, and was measured rather than assumed.**
    Both `records[0].kind` and the emitted `"Notice:"` lead READ the kind (`formatDegrade` leads
    with `"Recovered"` for a heal), so with either asserted BEFORE the composition, NOTEHEAL red on
    a **proxy** and left the composition itself unproven — measured in both of those orders, and
    both did exactly that. Composition first, kind-sensitive detail last: NOTEHEAL now reds on
    `expect(degraded.value).toBe(true)`, and with that line also disabled it reds on the
    `resolveTerminalExit` assertion (0 returned where 2 is wanted). Both conjuncts pinned.
  - [x] ✅ **CLOSED 2026-08-22 — v4.8 Phase 5 T5.5 (`f19624c4`), on owner ruling. Filed 2026-08-21
    (v4.8 Phase 5 whole-branch fix wave, round 2) as a disclosed, pinned, deliberately-unfixed
    defect: SI-10 was not fully closed for one shape — a `taskId`-bound leg carrying a FOREIGN
    alias still invented a phantom adjudication row.**
    `src/council/seats.js:139-141` binds a leg to a roster slot from `leg.legId || leg.taskId`
    alone — `roster[Number(m[2]) - 1]`, **no alias check** — and the alias fallback under it only
    runs `if (!seat && …)` (`seats.js:142`). So a `-rv` leg stamped into a §3.4 **placeholder's**
    slot while carrying an alias that is in no roster and no `judgeKeys` **bound**, satisfying
    `run-debate-revote.js :: runRevoteWave`'s first guard arm, while its key satisfied neither.
    **Measured end to end through the real `runDebate`** (the §3.4 roster-hole fixture with the
    hole leg's alias `'deepseek'` → `'zzz'`): the key was published, **zero** degrade notes, and
    `applyDebate` failed open and pushed a phantom `{judge: 'zzz'}` row while the hole's own
    seat-less row kept its stale `dispute` — finding A1 went **2 adjudication rows in, 3 out**.
    That is exactly the SI-10 shape T5.1 closed everywhere else, surviving through the `boundLegs`
    arm.
    ⚠️ **CORROBORATION, not a new finding.** A paid multi-model council reviewing PR #179 raised
    this same mechanism from **three independent seats** (kimi's C1 filed it a **blocker**) and
    **independently reproduced this branch's own measured out-count of 3** — a phantom row *plus*
    the roster hole's own row stranded on its stale `dispute`. It is recorded because the
    reproduction is what moved the owner from "disclosed" to "fix it", not because it added a fact.
    ⚠️ **Half of this entry's own figure was wrong and is corrected here.** It read
    *"1 adjudication in, 3 out"*, and the control sentence beside it read *"1 in to 2 out"*. The
    **out**-counts are exact and were re-measured. The "1 in" is not the A1 row count: the fixture
    puts **2** A1 adjudications in (gpt's `dispute` plus the hole's seat-less `deepseek`
    `dispute`) — which `run-debate.test.js`'s §3.4 control block already stated correctly as
    "2 rows in, 2 rows out". A mixed-unit slip, not a wrong measurement.
    **The fix:** the arm is **deleted**. The predicate is `judgeKeys.includes(key)` alone, and the
    `boundLegs` Set and the comment block justifying it are gone. Before ordering it the owner
    measured that removing arm 1 red **exactly 2 tests across all 544 suites** (7814 pass) and that
    both were this entry's own `BOUNDDROP` pin — nothing else depended on it.
    Because this is a **behaviour** change it got RED-before-GREEN, not a preservation mutant: the
    `BOUNDDROP` block's assertions were **inverted** first (the foreign key is refused · exactly one
    `seat-unbound` note · A1 **2 rows in → 2 out**, the roster hole's own row intact, no phantom
    `zzz`), confirmed **RED at `269badf1`** — 0 notes where 1 is wanted, 3 rows where 2 are wanted —
    and green after.
    ⚠️ **The deletion falsified FIVE sentences elsewhere, all repaired within T5.5 — (a)–(c) in
    the original work, (d) in review round 1, (e) only in round 3 and only because a paid council
    read the code — the branch's own failure mode #10, and not one of them caught by a gate.** (a) `reVoteUnboundNote`'s
    docblock still described the note as firing when a leg "neither bound to any roster slot NOR
    names one of the judges". (b) The **announced `why` string** still told the user "it bound to no
    roster slot", which is false in precisely the case that motivated the deletion — a leg that DID
    bind to a placeholder slot while carrying a foreign alias; it now reads "its join key '…' (judge
    alias '…') names none of the judges this wave launched", pinned by two assertions in the T5.5
    refusal test and measured RED against the old text — named mutant **`WHYSTALE`**, red set 2.
    ⚠️ **That rewrite was itself defective, and was fixed in review round 1.** It interpolated `key`
    RAW, and `key` is `seatKey(seat, judge)` — which returns `judge` whenever `seat` is null, i.e. in
    every refusal `runDebate` can produce. Measured against the real `runRevoteWave` with a leg
    carrying neither `modelInput` nor `model`: it rendered "its join key 'undefined' …" and dropped
    `data.key` out of the JSON entirely, re-introducing the exact "reads like a bug in the announcer"
    shape the alias fallback two lines above it exists to prevent. `joinKey = key || 'unknown'` now
    feeds both the sentence and `data.key` (named mutant **`KEYRAW`**, red set 1), and the
    "(judge alias '…')" parenthetical is **dropped** — measured redundant, because `key === judge` in
    every reachable refusal. The live string is
    "its join key '…' names none of the judges this wave launched".
    (c) `src/workspace/seat-space.js`'s
    `orphanExonerations` docblock quoted the two-arm predicate verbatim in a DIFFERENT file; its
    conclusion survives (a roster hole's own alias is still a `judgeKey`, so both silent shapes it
    names still land) but the predicate it quoted did not.
    ⚠️ **(d) A FOURTH twin, in the file T5.5 had just edited:** `run-debate.test.js`'s T5.1 describe
    header carried (a)'s sentence verbatim, contradicted by that same file's T5.5 block below it.
    Repaired in review round 1 after a repo-wide, case-insensitive grep of the distinctive phrase
    confirmed no fifth copy. A same-file sweep cannot find twins, and finding one in a different
    file is not proof there is only one — and (c) is exactly how that goes wrong: the first sweep
    found the DIFFERENT-file twin and stopped there.
    ⚠️ **(e) A FIFTH, and the worst-sited of them: the note's own `what` field, three lines above
    the corrected `why`, in the SAME object literal.** It said the leg "matches no seat on that
    wave's roster" — the exact claim `why` was rewritten twice to drop, and false for the same
    reason: a leg `taskId`-bound to a §3.4 placeholder DOES match a roster slot and is precisely the
    leg the narrowed guard refuses. Survived three rounds of correcting its neighbour; caught by a
    fresh paid council (gpt, a3/d0). All three strings now state the one condition the guard tests.
    `effect` was checked in the same pass and carried the same class — "the JUDGE's provisional
    verdict stands" presumes the leg belongs to a judge of this wave, which is what a refusal
    denies — and is now "the provisional verdict stands". `data` was checked and deliberately NOT
    changed: `judge` holds the leg's own CLAIM under `orphanLegNote`'s field names, and renaming a
    machine-readable field for a naming quibble is a compat break. Named mutant **`WHATSTALE`**,
    red set **3**.
    ⚠️ **`stage1-bind.js :: orphanLegNote` keeps that exact wording, and must** — a Stage-1 orphan
    really does match no roster slot. The same sentence is TRUE there and FALSE here, which is why
    the T5.5 refusal test also asserts `not.toMatch(/matches no seat/)`: the failure mode to guard
    against is someone restoring it by copy from the correct one. `src/utils/degrade.js`'s
    `seat-unbound` channel comment was widened in the same pass (it enumerated TWO shapes; T5.5 made
    it three), net zero lines so `degrade.js:34` above does not move.
    ⚠️ **Fresh council on the shipped code, 2026-08-22 (11m23s, all stages `:complete`, $0.4219,
    4 models + chair): chair verdict "Ship it", 3 Confirmed, all minor — and every one of the
    previous run's five findings, including kimi's blocker, is gone.** Of the three: (e) above is
    the one real defect and is fixed. **D1** (glm, a2/d1) — *"`ctx.degrade.note()` called without an
    existence guard"* — **REJECTED, measured**: every `ctx.degrade.note(` call site in
    `src/council/` is unguarded. `grep -rn "ctx\.degrade\.note(" src/council/*.js` returns 12
    matches, of which 11 are call sites and one (`run-retry-notes.js:9`) is prose in a docblock:
    `run-debate-stage.js:90`/`:101`, `run-stage2.js:110`/`:122`,
    `run-stages.js:71`/`:115`/`:128`/`:137`/`:140`, `run-retry.js:216` and this one. Guarding this
    one alone would make it the odd one out. (`run-stage1-superseded.js:61`'s guard is a different
    case — it takes `degrade` as an OPTIONAL PARAMETER, not off `ctx`.) **A1** (qwen) — the
    file-size headroom — was already filed above. Recorded so neither is re-adjudicated.
    **The §3.4 roster hole is NOT regressed.** A hole's own alias IS one of `judgeKeys`
    (`run-debate.js` builds `judgeSeats` as `judgeKeys.map(k => seatById.get(k) || null)`, so a hole
    keeps its `judgeKeys` slot and loses only its seat), so it still publishes and still emits no
    note. `run-debate.test.js`'s *"roster hole whose leg is ALSO unbindable"* test and its
    *"§3.4 placeholder contract"* block both cover it; both are untouched and green.
    ⚠️ **The named mutant INVERTS with the fix.** `BOUNDDROP` meant "drop the bound arm", which is
    now the shipped behaviour, so it is replaced by **`BOUNDREADD`**: restore the Set
    (`const boundLegs = new Set(bindRes.bound.map(b => b.leg));`) and widen the predicate back to
    `boundLegs.has(leg) || judgeKeys.includes(key)`. Red set (**2**) — both tests in
    `run-debate.test.js`'s T5.5 refusal block and nothing else, measured across that file +
    `debate.test.js` + `run-stages.test.js` + `seat-space.test.js` + `degrade-sink.test.js` +
    `run-finalize.test.js`. Hand-applied to the committed file, run, then restored from a `cp`
    backup and byte-verified with `git diff --quiet`.
    ⚠️ **Was never reachable from the production launcher, and still is not:** `runRevoteWave`
    launches `models: judgeKeys.map(aliasOf)` and `src/sidecar/fanout-leg.js` carries
    `leg.modelInput` straight from that request (`:62`, `:101`), so a real `-rv` leg's alias is
    always one the wave asked for. Same latency class as SI-10 itself — which was never a reason
    to leave the join alias-shaped, exactly as this file already says of SI-10.
- [x] **DONE (v4.8 — verified by execution 2026-08-16) · PR4/PR5 · `src/workspace/matrix-model.js:47`, `:55`, `:74-81` performs the identical
  `meta.models × adjudications[].judge` join `report.js:38-40` does — and unlike `report.js` it
  was on no deferral list.** `judges` comes from `tally.meta.models` (`:47`), which on a twin
  bench holds the same alias twice; `votes[adj.judge] = adj.verdict` (`:55`) is last-wins, so both
  twin columns paint the same verdict; and `isRaiser: j === f.raiser` (`:80`) flags both twin
  columns as the raiser. The Workspace adjudication matrix is therefore wrong in the same three
  ways `report.html` is. Fix them together, keyed on `(adj.seat || adj.judge)` against a
  seat-valued column list — the data is already on the document as of PR3.
  - **Verified by execution (2026-08-16):** `src/workspace/matrix-model.js :: buildMatrixModel` —
    the join is seat-aware, not alias-only: `seatSpace` is computed at
    `matrix-model.js@ed5c0c02:58`, columns key on the seat id at `matrix-model.js@ed5c0c02:74`
    (`meta.seats.map(s => ({key: s.id, ...`), votes key on `adj.seat` in seat space at
    `matrix-model.js@ed5c0c02:84` (`votes[(seatSpace && adj.seat) || adj.judge] = adj.verdict;`),
    and the raiser key uses `f.raiserSeat` in seat space at `matrix-model.js@ed5c0c02:88`
    (`seatSpace ? (f.raiserSeat || f.raiser) : f.raiser`).
    ⚠️ **Pinned to `@ed5c0c02` on 2026-08-20 (v4.8 T2.4), because T2.4 moved every one of them.**
    Each was re-opened at its stated line at that ref and confirmed to carry what is claimed; each
    was also re-opened at `e5376399`, where all four are false. The finding itself still holds —
    the join is still seat-aware — but two of the four claims changed in kind, not just in line:
    the vote-key expression above **no longer exists verbatim**, because T2.4 moved it inside
    `columnFor`, which computes `(seatSpace && adj.seat) || adj.judge` and then refuses a key that
    names no column; and the roster now grows a conditional `UNATTRIBUTED` entry. The current
    locations are all inside `matrix-model.js :: buildMatrixModel` — anchor there, not at a line.
- Minor, noticed while re-deriving citations — ✅ **FIXED at T-A8, by SYMBOL**: `src/council/seats.js`'s
  `bindSeats` docblock cited `run-retry.js:93` for "a retry wave is the loss subset". Both the
  `groupStage1Losses(` call and the `launchWave({ ...common, models: unit.models.slice() })` that
  actually makes a retry wave the loss subset live in `run-retry.js :: retryStage1Losses`; `seats.js`
  now names that symbol, and every number still written below is HISTORICAL, none of it a live anchor.
  ⚠️ EVERY correction this entry made to a `run-retry.js` number was falsified within a day: `:67`→`:60`
  and `:93`→`:95` were re-measured 2026-08-17, and T-A6's +8 lines rotted BOTH the same day.

#### PR3 post-review adjudication (2026-08-13)

PR3's auto-review and the paid council raised nine findings against the shipped diff. Eight are
filed here rather than fixed on this branch — each is either already disclosed above or latent and
unreachable from production. (The ninth was a real defect: `run-debate-revote.js`'s module docblock
had gone stale — Task 1's "verbatim, no behaviour change" claim stopped being true for
`runRevoteWave` at Task 6, which gave it seat binding. Fixed in place, comment-only.)

- [ ] **PR4 · a double-orphan collapses onto ONE conformance row in `run.js`'s Stage-2 merge.**
  `run.js :: seatKey`'s `const seatKey = (s, alias) => (s ? s.id : alias);` feeds
  `new Map(s2.judgeResults.map(j => [seatKey(j.seat, j.judge), j]))` (`run.js:233`). If BOTH twins'
  Stage-2 legs fail seat binding (`j.seat === null` for both), `seatKey(null, alias)` returns the
  same bare alias for both, the `Map` keeps whichever twin's entry was inserted second, and both
  `s1.reviews` rows fall through their `byJudge.get(r.seat ? r.seat.id : r.model) || byJudge.get(r.model)`
  lookup (`run.js:235`) onto that one surviving judge's conformance.
  ⚠️ **The three `run.js` numbers in this paragraph were `:224`/`:225`/`:227` until 2026-08-21
  (v4.8 Phase 5 T5.4), when all three were re-opened and found stale** — that file grew above them
  after they were written. Today the spelling is `:232` (now anchored by symbol), the `Map` build
  `:233` and the two-key lookup `:235`. The mechanism this paragraph describes is unchanged; only
  the numbers were wrong.
  ⚠️ **2026-08-25 (v4.9 W3, SI-DUP b): the `run.js` spelling itself is GONE — `:232` now holds
  `const { seatKey } = require('./run-retry-keys')` and the definition lives at
  `run-retry-keys.js:15`; the `Map` build (`:233`) and two-key lookup (`:235`) still stand.** **Latent, not reachable from
  production**: `src/sidecar/leg-ids.js:16` stamps every fanout leg's `taskId` as `${waveId}-${i+1}`,
  and `fanout-leg.js` writes that `taskId` into `buildRunResult` on both the normal completion path
  (`:191`) and the routing-failure path (`:61`) — so a real `-s2` wave cannot produce even one
  unbindable leg, let alone two. The state is only constructible by deleting ids in a fixture.
  ⚠️ **The auto-review's framing — "reintroduces the D7-class bug" — is WRONG.** On identical input
  PR3 is never worse than merge-base (merge-base has no seat concept, so it always joins on the bare
  alias — exactly PR3's degraded fallback path). And on the reachable case, a healthy twin bench,
  PR3 is strictly better: merge-base's alias-only join collapsed the twins' conformance
  unconditionally and silently (the in-code comment at `run.js:219-224` names this D7), while PR3
  only collapses in the unreachable double-orphan case, and does so at exit 0 exactly like
  merge-base always did — no regression, no new silent failure mode. Supersedes nothing already
  filed: the existing PR4 entry above (*"an `-rv` leg that binds to NO seat makes `applyDebate`
  invent an adjudication row"*) is a different file (`run-debate-revote.js`, not `run.js`), a
  different mechanism (the debate round's fail-open push inventing a row, not the Stage-2 merge's
  `Map` losing one), and a different failure shape (an extra row vs. a collapsed one) — checked for
  overlap, there isn't any.
- [x] **DONE (v4.8 Phase 5 T5.3, 2026-08-21 — JSDoc, per ruling R8) · PR4 · `applyDebate`'s
  fail-open push writes a seat id into the alias-space `judge` field
  when `aliasOf` is absent.** `debate.js`'s fail-open branch (`const alias = aliasOf ? aliasOf(key) : key;`)
  falls back to the raw seat key when no `aliasOf` is supplied. Measured: without `aliasOf` the
  pushed row is `{judge: 'deepseek#1', ...}` and the tier moves Singleton → Confirmed — that retier
  is `peer-split.js :: peersOf`'s `v.judge !== f.raiser` doing it (required into `tally.js`
  since v4.8 Phase 2 T-B1); the same seat id also reaches `report.js :: columnFor`'s vote→column
  join as an out-of-contract `judge`.
  ⚠️ **Citation repaired 2026-08-21 (v4.8 Phase 5 T5.4): this sentence named `report.js`'s
  `byJudge[adj.judge]` and called both joins "alias-space".** That expression no longer exists —
  v4.8 T-C1 (SI-22.5) replaced it with `byJudge[columnFor(adj)]` (`report.js:196`; `columnFor` at
  `:159`, both re-opened) — and `columnFor` is seat-space-**gated**, not alias-space, and folds a
  key naming no column into `UNATTRIBUTED` rather than inventing one. Only the `peersOf` half
  carries the retier, which is the same per-join split T5.3's re-review made in `debate.js`'s own
  comment. With `aliasOf` supplied, the row is `{judge: 'deepseek', seat: 'deepseek#1'}`
  and the tier is correct. **Not reachable**: `grep -rn applyDebate src/` (excluding tests) finds
  exactly one non-test caller — `run-debate.js :: applyDebate` (a line-range citation here would
  rot on the next comment edit; **was `:202-203`**) — and it DOES pass `aliasOf` (the call site even
  carries a warning comment at `run-debate.js:198-202`, **was `:198-201`** — no symbol can carry a
  claim about a comment's own span). The package's `exports` map
  (`package.json:34-36`) publishes only `./opencode-client`, which blocks a deep
  `require('amicus/src/council/debate')` from outside the package, closing off the obvious
  alternate call path. Two conditions must BOTH hold for this to fire — a caller omitting `aliasOf`
  AND a repeated alias in the same wave — and no such caller exists today. File as a hardening note:
  consider making `aliasOf` a required parameter (throw if absent) rather than an optional one with
  a silently-wrong fallback.
  - ✅ **CLOSED 2026-08-21 — v4.8 Phase 5 T5.3 (`f885c1ea` + fix round `7c46d282`) (SI-13).**
    Documentation only, exactly as **owner ruling R8** predicted it would collapse once SI-10
    landed: the `aliasOf` contract is now stated inside `debate.js :: applyDebate`'s own docblock —
    what an omitted `aliasOf` writes into `judge`, which two joins that value then reaches, and that
    building the projection stays the caller's obligation. **No behaviour change and no thrown
    error** — the hardening this entry proposes (make `aliasOf` required) was considered and NOT
    taken. What was re-derived at writing time rather than copied from the plan: the sole non-test
    caller is `run-debate.js :: applyDebate` and it does pass `aliasOf`, and `package.json:34-36` is
    exactly the `exports` block publishing only `./opencode-client`.
- [x] **A hardening note — nothing pins that the launcher must NOT de-duplicate `models`.** Owner
  ruling R3-2 (one re-vote leg per seat) depends on `['gpt', 'deepseek', 'deepseek']` producing
  THREE legs, not two. Verified end-to-end through the real `runFanout`: three legs actually spawn,
  and `fanout-validate.js:18`'s `parseModelsList` docblock says "duplicates allowed" (line 18, not
  20 — re-checked against the current file rather than assumed). Nothing enforces that contract
  going forward: a future `uniq()`/`new Set(...)` anywhere on the `--models` → leg-construction path
  would silently drop a twin's leg and break R3-2 with no error, no test failure outside this one
  area, and a plausible-looking diff. `tests/council/run-debate.test.js`'s
  `describe('runDebate — twin bench: joins on the seat, launches on the alias', ...)` (from
  `TWIN_BENCH = ['deepseek', 'deepseek', 'gpt']`, line **67**, not 55 — a twin of the same stale
  citation this task's own plan carried, both corrected 2026-08-22) already pins the twin `-rv`
  shape at the `runDebate` level, so the invariant is exercised — just not named. Worth an explicit
  comment (or a dedicated unit test on `parseModelsList`) stating the invariant in one place:
  "duplicates must survive to leg construction."
  ✅ **DONE — SI-14, v4.8 Wave 1 (2026-08-22, `424cb63d`).** Shipped exactly as scoped here: a
  named test in `tests/sidecar/fanout.test.js` plus an invariant comment; `parseModelsList` itself
  is byte-unchanged (confirmed by diffing against this task's own start point). Named mutant
  `MODELSUNIQ` (wraps the return in `[...new Set(...)]`): red set **3 tests / 1 suite**, non-empty
  at full `npx jest --no-coverage` scope.
- [x] **SI-15 · SUPERSEDED by SI-DUP** — ~~A maintainability note (from the auto-review).~~ `seatKey(seat, alias) => seat ? seat.id : alias`
  (or the arrow-function equivalent) is independently redefined in **three files**:
  `run-debate-revote.js:64`, `run.js :: seatKey` (**was `:228`; `:232` today, re-opened
  2026-08-21**) and — at the time this was written — `run-retry.js:149`;
  note `run-stage2.js` does NOT redefine it (it takes seats a different way).
  ⚠️ **Re-measured 2026-08-17: it is now redefined in TWO files, not three.** `run-retry.js` stopped
  redefining `seatKey` when PR5c/T-A1 moved the definition out; it is `run-retry-keys.js:15` and
  `run-retry.js` imports it. The old citations (`:56`/`:149`/`:224`) were all stale, in a clause
  that said "re-derived directly, not assumed" — the same self-certifying phrasing corrected in the
  SI-DUP entry below. Entry left SUPERSEDED, but no longer carrying three wrong numbers and a count
  that is off by one.
  ⚠️ **2026-08-25 (v4.9 W3, SI-DUP b): now ZERO files redefine it — `run.js` and
  `run-debate-revote.js` both import `run-retry-keys.js :: seatKey`, the sole definition.** Separately, §3.4's
  roster-placeholder-padding block (`const placeholders = new Set(); ... __unbound-${waveId}-${i+1} ...`)
  WAS duplicated near-verbatim in a **different** set of three files:
  `run-retry-launch.js@2517a947:50-60`
  (was `run-retry.js:123-133` at T-A2's base `3b8cf781` — this entry first said `:118-130`, which
  was T-A2's own arithmetic slip; measured 2026-08-17 — lifted verbatim by T-A2),
  `run-stage2.js@9ef275e5:91-107`, `run-debate-revote.js :: runRevoteWave` (**was `:106-117`;
  re-anchored BY
  SYMBOL 2026-08-21 after v4.8 Phase 5 grew that file 176→282 (T5.1 took it to 249; the two fix
  waves added the rest), and T5.5 took it to 274 on 2026-08-22. Re-opened against the FINAL tree:
  the block was `:179-186` — T5.5's deletion sat entirely BELOW it, but its comment repairs pushed it
  down twenty-four lines from `:155-162` — while `:106-117` now sits wholly INSIDE
  `reVoteUnboundNote` (from its `alias` fallback line to the comment above `effect`), and the
  `@param` lines are `:142-146`.
  ⚠️ The T5.4 reading that put the `@param` lines at `:106-117` was true when written and rotted at
  the round-2 fix wave**)
  — this
  time `run.js` is the one that does
  NOT carry it (it consumes `s2.judgeResults`, which already went through Stage-2's own padding).
  Both patterns are the safety-critical logic implicated in the double-orphan and fail-open findings
  above. ~~Suggest consolidating into `src/council/seats.js`, which already owns `bindSeats`,
  `sanitizeName`, and `roleAt` — a natural home for both the join-key helper and the padding helper.~~
  ⚠️ **CLOSED 2026-08-23 by v4.8 SI-27 — the duplication is gone, so the §3.4 half of this
  clause is now a record of where the block STOOD, not of where it is.** All three ranges above
  (`run-retry-launch.js@6709ac78:50-60`, `run-stage2.js@9ef275e5:89-106`,
  `run-debate-revote.js@ee7da0db:179-186` — `@ref` form, per `docs/CITATIONS.md`) were
  true when written and are historical from here on. The pad/bind/drop core lives ONCE, in
  `stage1-bind.js :: bindPaddedWave`; each site keeps only its own orphan/missing tail. The
  `seatKey` half of this clause is **not** closed by SI-27 — that is SI-DUP disposition (b),
  still v4.9. (⚠️ **2026-08-25: and v4.9 W3 Task D has now DELIVERED disposition (b), closing the
  `seatKey` half too — see SI-DUP's shipped note.**) See the ticked SI-27 record under "NEXT TASK —
  Wave 3" for sizes, red sets and
  commits.
  - **Superseded 2026-08-16** by **SI-DUP**, the consolidated duplication filing that merges this
    note, SI-27, and the PR5c `seatKey` filing under one stated counting rule. Both of this note's
    halves survive there; neither was dropped.
  - ⚠️ **The struck `seats.js` home is SUPERSEDED — do not send the work there.** SI-DUP
    **disposition (a)** and ruling **R14** both put the padding consolidation in **`stage1-bind.js`**
    (parameterised on `(waveId, rosterSource, aliasAt, legs)`, own PR, **after Phase 2**), and
    disposition (b) defers the `seatKey` half to **v4.9**. Read those, not this clause.
- [ ] **Function lengths** (auto-review minor): `runStage2` (`run-stage2.js :: runStage2`,
  `:47-211` = **165 lines**), `runDebate` (`run-debate.js :: runDebate`, `:106-271` = **166 lines**),
  and `runRevoteWave` (`run-debate-revote.js :: runRevoteWave`, `:148-272` = **125 lines**) all
  exceed CLAUDE.md's 50-line-per-function guideline
  (`CLAUDE.md:821`; the limit is also named at `CLAUDE.md:733`). Nothing in CI enforces it —
  `scripts/check-file-sizes.js` is file-level only (300 lines/file; no per-function check exists
  anywhere in the gate). File as a follow-up, noting the seat/placeholder-roster logic inside all
  three is the same safety-critical logic named above, which is what makes them worth splitting
  rather than just noting.
  ⚠️ **Two of the three numbers above moved on 2026-08-23 (v4.8 SI-27)**, re-brace-matched
  against the final tree: `runStage2` `:47-211` = 165 ⇒ `:47-205` = **159**; `runRevoteWave`
  `:148-272` = 125 ⇒ `:153-266` = **114**. `runDebate` `:106-271` = **166** is untouched — SI-27
  has no site in that file. **The 2026-08-21 numbers above are left standing as the dated
  measurement they are: this is an annotation, not a renumbering** (`docs/CITATIONS.md`). All
  three still exceed the 50-line guideline, so nothing about this item’s disposition changes.
  ⚠️ **Every number in this entry was re-measured 2026-08-21 (v4.8 Phase 5 T5.4). Counting rule,
  stated because a bare number without one is exactly what SI-DUP below exists to record: by
  ANCHOR — three function anchors (each a span plus its own line count, wrong or right together)
  and two `CLAUDE.md` line citations, FIVE in all, of which FOUR were wrong.** Counted by
  individual VALUE instead it is **six of eight** — two spans, two line counts and both `CLAUDE.md`
  lines — and the "what changed" list below enumerates exactly those six. ⚠️ **An earlier draft of
  this sentence said "FOUR of the six", which resolves under neither rule; corrected in T5.4 fix
  round 1.** The three spans were re-derived by brace-matching each function in the current
  tree, and the two `CLAUDE.md` anchors by opening the only two lines in that file that name the
  50-line rule. What changed and why: `runStage2` was `:47-207`/161 — the close brace is `:211`, so
  it is **165**, and that value was stale before this branch (`run-stage2.js` is untouched by it);
  `runRevoteWave` was `:76-166`/91 — v4.8 Phase 5 grew it to `:124-280`/**157**, and T5.5 cut it
  back to `:148-272`/**125** (re-brace-matched 2026-08-22 against the final tree);
  `CLAUDE.md:793`/`:705` are now `:821` (*"No function >50 lines"*) and `:733` (*"File size limits
  (300 lines/file, 50 lines/function)"*), that file having gained 28 lines above them.
  `runDebate`'s `:106-271`/166 was re-opened and is **unchanged**. Spans are now anchored BY SYMBOL
  as well, so only the counts can rot next time.

#### Filed by PR4b — ledger grouping (2026-08-13)

Three items PR4b deliberately did NOT fix. All three citations were re-derived from the source at
`c1c3a5ee`, not inherited from the plan.

- [x] **Chair-on-bench has no engine-side guard, and PR4b made its consequence observable.** The
  guard exists in three places and `src/council/` is not one of them:
  `src/cli-handlers-council-run.js:140`, `src/mcp-council-run.js:114`, and
  `src/pack/pack-validate.js:93` (packs only, `pack.kind === 'council'`). `preflightSeats` — the
  engine's own pre-spend seat validator — refuses **five** ways (`src/council/seats.js:186-209`)
  and chair-on-bench is not among them. Worse, the guard *cannot* cover the two hand-assembled
  `appendRun` paths (`cli-handlers-council.js`, `mcp-server.js`), where `meta` is copied verbatim
  from user JSON: the documented `amicus council tally` shape puts the chair ON the bench
  (`docs/council.md`'s worked example; the golden fixture's `models: JUDGES, chair: 'deepseek'`),
  so this is the normal case there, not an edge. Since PR4b, such a chair's seat and chair rows
  merge into one ledger row whose `conformance` is worst-wins and whose `wasChair` is any-wins —
  a persisted scalar that now reads differently. Decide whether the engine should refuse it,
  normalise it, or keep accepting it with the merge documented (today's answer, T14).
  ✅ **CLOSED 2026-08-21 — v4.8 Phase 3 T3.3 (`fb3fa09d`), per owner ruling R4 (SI-17).** The engine
  NORMALISES rather than refuses or keeps the merge: a `role: 'chair'` runStats row no longer
  decides a bench seat's `role` or `conformance` when the group also holds a bench leg
  (`ledger-join.js :: benchLegs`); `wasChair` stays any-wins over the whole group, and a group of
  only chair rows is unchanged. Both hand-assembled `appendRun` paths are covered, as R4 required.
  ⚠️ **"today's answer, T14" above is now WRONG, and it is the pin itself that moved.**
  `tests/council/ledger.test.js`'s `T14` describe block is REWRITTEN, not kept — it is now titled
  *"chair ON the bench: the chair leg no longer decides the bench seat (SI-17)"* and asserts the
  NORMALISE behaviour this item argued for, not the merge it originally recorded. One consequence
  of the normalise is disclosed, not repaired, and filed separately below for the owner.
- [ ] **NEW, owner decision needed — SI-17's normalise loses a mixed-group chair leg's OWN
  conformance to the lifetime histogram (v4.8 Phase 3 T3.4, 2026-08-21).** Filed for a ruling, not
  decided here; behaviour is unchanged from what T3.3 shipped. On a group that mixes a bench leg
  with a chair-synthesis leg for the same seat, the chair leg's `conformance` no longer reaches
  `ledger.js` at all — only the bench leg's `conformance` does, and `wasChair: true` is the only
  trace that the model also chaired. MEASURED end to end through `appendRun` →
  `ledger-stats.js :: deriveReliability`, on `--models ds,gpt --chair ds` with a CLEAN bench leg and
  an UNSTRUCTURED chair leg, both resolving to `v/ds`:
  ```
  before (b341b273) : conformance { unstructured: 1 }
  after  (fb3fa09d)  : conformance { clean: 1 }
  ```
  A chair that hallucinates or drops its verdict-parse contract while its bench review stays clean
  is now invisible to the lifetime `conformance` histogram — a REAL loss of signal, not a
  relabelling, and disclosed rather than repaired because recording a chair leg's own conformance
  would mean giving the chair its own ledger identity, which changes the row SET (out of scope for
  a normalise). Already disclosed in `ledger-join.js :: benchLegs`'s docblock; this is the tracker
  copy so it is not buried in a source comment. Options for the owner: (a) accept the loss as the
  cost of a truthful bench-seat identity, (b) give the chair-synthesis leg its own ledger row/key,
  (c) something narrower — e.g. a `chairConformance` side-field on the bench row. Not decided here.
- [x] **Findings are attributed by ALIAS, not by seat.** ⚠️ **This item was filed "→ PR4c" and PR4c
  did NOT take it (ruling R4c-3); the forecast expired unfulfilled and `ledger.js`'s in-source
  comment has been corrected to say so.** `buildLedgerRows` filters
  `findings.filter(f => f.raiser === model)`, which is alias-exact, so on a bench where one alias
  fills two seats each row would claim BOTH seats' findings. PR4b works around this by
  concentrating the statistics on one row per alias (R4b-2) rather than dividing them, because
  dividing them fabricates a per-executable `confirmRate` (measured 0.5/0.5 where the truth is
  1.0/0.0 and 0.0/1.0). That concentration still stands. Two corrections to this item's own
  estimate, both measured during PR4c: the missing half — `runStats[].seat` — **is now shipped**
  (`src/council/run-assemble.js`'s `buildRunStatsEntry`, through `tally.js`'s allowlist into
  `tally.json` and `verdict.json`), so the *data* prerequisite is met; but "roughly three lines" was
  wrong — it took three files, because `buildRunStatsEntry` destructures a fixed param list that
  silently drops an extra argument and `tally()`'s runStats projection is an explicit allowlist that
  builds a fresh object literal. What remains is the actual attribution change: `findings[].raiser`
  is still the ALIAS, so the join has nothing to split on. Seat-attributing it means keying the
  filter on `raiserSeat` and deciding what a seat-less finding joins to.
  ⚠️ **STATUS AS OF 2026-08-21 (SI-18) — history, kept for the record; see the ✅ DONE paragraph
  immediately below for 2026-08-22, current.** v4.8 Phase 3 T3.3 (`fb3fa09d`)
  also touched `buildLedgerRows`, and its own commit message names SI-18 at the same anchor, but
  what it closed there is the STREET-CRED join (SI-20's third site, `findings.filter(f => f.raiser
  === model)`'s NEIGHBOUR, not itself). **Through T3.3, this item's own filter was byte-unchanged**:
  measured, `findings.filter(f => f.raiser === model)` was identical before and after that PR. The
  findings half stayed exactly as described above at that date — filed, not scheduled.
  ✅ **DONE — 2026-08-22, v4.8 Wave 2 (`78ed7a40`, PR #184).** The filter line above is a claim
  about T3.3 specifically and is **still true today** — `const raised = findings.filter(f =>
  f.raiser === model)` remains byte-identical at `ledger.js:143` (shifted from `:142` pre-fix by
  one added comment line; this fix never touches it). What changed is what CONSUMES `raised`:
  `ledger-join.js :: splitFindingsBySeat` now credits each finding to the ONE pair group whose own
  `runStats` rows carry a matching `raiserSeat`, replacing the unconditional `i === 0 ? raised :
  []`. R4b-2's concentration is now the FALLBACK for whatever cannot resolve — `raiserSeat` absent
  (every pre-seat document, every hand-assembled one), or present but matching no group's own seat
  (the asymmetric quadrant `tally.js`'s own comment names) — not the rule for every finding. The
  row SET does not move: PR4b's `(alias, resolvedModel)` pairing is unchanged, only which existing
  row a finding's numbers land on. Reuses the existing seat-or-alias shape (`ledger-join.js ::
  credFor`) rather than a third spelling, per ruling **R14**.
  Verified by the `avInput` golden fixture (unique-alias bench: `raiserSeat` is never emitted on
  one, so every finding stays unresolved and concentrates exactly as before — byte-identical) plus
  7 new example-based tests and 3 direct unit tests of `splitFindingsBySeat`
  (`tests/council/ledger.test.js`). Named mutant `FINDINGALIAS` (revert to `i === 0 ? raised :
  []`): RED 2 tests / 1 suite, full `npx jest --no-coverage` scope. `LEDGERALIAS` re-run:
  unchanged at 2/1 — this change never reads or writes the street-cred `sc` map. Gates: lint,
  check:sizes, check:citations, validate-docs all exit 0; full suite at the commit's own baseline
  544 suites / 7849 passed / 8 skipped (merged main, three PRs later, is 544/7861/8).
  ⚠️ **Not verified by a fuzz or a spec-derived oracle.** Neither a 500-trial fuzz nor a
  1000-trial spec-derived oracle exists anywhere in commit `78ed7a40` or the current tree —
  checked by reading the full commit diff and grepping the repo for `fuzz`/`oracle`/`trial` near
  this change. The mutant plus the example tests named above are the actual, and sufficient,
  verification.
- [ ] **SI-23 closed the gap into `tally.json`; `verdict.json` still drops `location`/`claim` —
  filed, not fixed (found while writing the v4.8 Wave 2 record, 2026-08-22).** `verdict.js ::
  buildVerdict`'s `findings.map` builds a deliberately CLOSED `out` object literal (names every
  key, copies nothing else off `f`) with two emit-when-set tails — `raiserSeat` and
  `sameModelCorroboration` — and its own comment explains why both are emit-when-set rather than
  `|| null`: `JSON.stringify({raiserSeat: null})` still writes the key, which "changes the shape
  of every unique-alias `verdict.json` and fails `seat-parity-ondisk`'s needles." `location` and
  `claim` are not in the literal and have no tail, so neither reaches `verdict.json` even though
  SI-23 now carries both into `tally.json`. **Measured cost today: none.** The only two readers of
  `f.location` in the tree are `briefings-debate.js:65` (`const loc = f.location ? ...`) and
  `debate.js :: debateTargets` (`src.location`, `debate.js:260`) — both read from `tallyInput`,
  not `verdict.json`. No renderer under `src/council/report*.js` or `src/workspace/` reads
  `.location` or `.claim` (grepped both trees, zero hits). Adding tails here is a `verdict.json`
  shape change and deserves its own decision, the same reasoning row 09 in the phasing doc's
  status table already applied when `raiserSeat` was added — do not add them as a drive-by.
- [x] **A never-ran aggregate stays chair-promotable, and PR4b makes it a standalone one.** Street
  cred is alias-level and PR4b deliberately did NOT concentrate it (concentration was measured to
  flip the launched name from the short alias to the raw executable id, the exact failure
  `src/council/run-chair.js:48-52` argues against — citation true when written; since 2026-08-25 (v4.9 W4 size-gate split) that argument lives verbatim in `chair-fallback.js :: pickFallbackChair`, old range = `run-chair.js@eb0ff79c:48-52`). So on a mixed live/dead twin, the leg-less
  group keeps a numeric street cred borrowed from its live twin while carrying zero findings, and
  `pickFallbackChair` can rank it above the executable it routes to. The borrowed cred is
  **pre-existing** — today it is merged into one group — but PR4b splits it out as its own
  promotable aggregate with its own permanent `legacy` line in `council stats`. Do not invent a
  rule here: the real fix is seat-attributed street cred, which belongs with the item above.
  ✅ **CLOSED 2026-08-21 — v4.8 Phase 3 T3.3 (`fb3fa09d`) (SI-19).** Street cred is now seat-attributed
  (the item above's own prescription), which removes the borrowing mechanism rather than patching
  its symptom. MEASURED end to end through the real `tally()` → `buildLedgerRows()` on a synthetic
  mixed live/dead twin (`deepseek#1` reviewed and ranked, `deepseek#2` bound but leg-less, one judge
  `gpt`): the dead seat gets its OWN `computeStreetCred` row, keyed on `deepseek#2`, and since no
  judge ranked that seat id `withSelf`/`peersOnly` are both `null` — not a number copied from
  `deepseek#1`. The ledger row `credFor` builds for that pair group reads `null`/`null` the same
  way: `sc.get('deepseek#2')` returns an object (so the alias-mean fallback never fires), and
  `meanCred` filters non-numeric values out, leaving nothing to average. A null row is invisible to
  `ledger-stats.js :: deriveReliability`'s `avg()` (`typeof v === 'number'` only), so the dead twin
  can no longer inflate `avgStreetCredPeersOnly` and cannot be promoted by
  `run-chair.js :: pickFallbackChair`.

#### Filed by PR4c — the seat spine (2026-08-14)

Everything PR4c deliberately did NOT fix, with the measurement that establishes it. Every citation
below was re-derived from the source at the end of PR4c, not inherited from the plan — the plan's
own numbers for two of these were stale (`ledger.js:104` had moved to `:106`, and
`classifyCouncilMembers` is in `src/utils/config.js`, not `src/config.js`).

- [x] **Street cred collapses twins, three ways, and PR4c left all three (ruling R4c-2).** Measured
  on bench `['a','a','b']`: (1) `rankPositions` (`street-cred.js :: rankPositions`) keys its map by
  MODEL — `pos.set(m, meanPos)` — so on `order ["a","a","b"]` the first twin's position 1
  is **overwritten**, not averaged, yielding `{a:2, b:3}`. (2) `computeStreetCred`
  (`street-cred.js :: computeStreetCred`) maps over `meta.models`, which is still `['a','a','b']`, so the
  record carries **two byte-identical `streetCred` rows**, and both reach the user — the Markdown
  street-cred table at `src/council/report-md.js :: renderMd` and the HTML one at
  `src/council/report-html.js :: renderHtml`. ⚠️ **Re-anchored BY SYMBOL 2026-08-16** (v4.8 Phase 1
  T1.2): the Markdown table used to be cited as `report.js:181`, but `renderMd` has moved out of
  `report.js` entirely into `report-md.js` — the **file** was falsified by T1.2, and the line
  number was already stale before it. The HTML citation `report-html.js:49` was **also** already
  wrong (pre-existing, not T1.2's doing): re-measured, `:49` is a `<td>` in the findings-table row
  builder; the street-cred rows are built two lines later. Both now anchor to the enclosing
  function, per this release's re-anchoring rule. (3) The ledger's
  join `new Map(streetCred.map(s => [s.model, s]))` (`ledger.js@b341b273:110` — the citation's own
  `:106` had already drifted before T3.3 touched it) is **last-wins**
  into an append-only file. R4c-2 re-confirmed R4-3 on this evidence: fixing (3) alone was measured
  to flip the launched chair name from the short alias to the raw executable id, so this needs to be
  taken as one seat-keyed change, in its own PR, not piecemeal.
  ✅ **CLOSED 2026-08-21 — v4.8 Phase 3 T3.3 (`fb3fa09d`, fix round 1 `8027391b`) (SI-20), taken as
  ONE seat-keyed change exactly as this item required.** ⚠️ Not T3.2: diffed by commit to be sure —
  T3.2 (`b17a6329`) put `seat` (the judge's own identity) onto `rankings[]`, consumed by the peer
  split (SI-06); `rankings[].orderSeats` — the parallel array `rankPositions` actually keys on — is
  T3.3's own addition, in the same commit as the three sites below. All three sites: (1)
  `rankPositions` now keys by SEAT where `orderSeats` names one, alias
  otherwise, so a twin bench's two positions no longer collapse. (2) `computeStreetCred`'s driver is
  `credSeats(models, seats)`, one row per SEAT rather than one row per alias — the two twin rows are
  no longer byte-identical. (3) the ledger join (`ledger-join.js :: credFor`, extracted out of
  `ledger.js` in the same PR) is seat-keyed with an alias-MEAN fallback (fix round 1: the mean, not
  a last-wins alias key, because a seated alias with no runStats seat must not resolve to `{}`),
  replacing the old alias-keyed last-wins `Map`. ~~`report-md.js:70` and `report-html.js:51-52`
  needed zero changes — they still render `s.model`, so on a twin bench they now show two
  DIFFERENT numbers under the same alias rather than two identical ones (the rendered table is more
  truthful, but ambiguous about which seat is which). Flagged as an SI-25-adjacent follow-up, not
  fixed here — `report.js` and `matrix-model.js` are explicitly out of scope for this PR (§1).
  ⚠️ **SI-25 has since shipped (2026-08-23) and did NOT take this** — its scope was the chair packet
  (`briefings-chair.js` / `run-assemble.js`) and `report-md.js`/`report-html.js` were out of scope
  there too. So this follow-up is now **homeless**, the same way SI-25's own site (3) was: it is
  filed here and scheduled nowhere. Do not read "SI-25-adjacent" as "SI-25 will cover it".~~
  ✅ **CLOSED 2026-08-23 — v4.8 SI-22.4's rider R22.4-6 (`1c7a9087`).** The struck paragraph is now
  measurably FALSE: both renderers label the street-cred row `s.seat || s.model`
  (`report-md.js :: renderMd`, `report-html.js :: renderHtml` — re-anchored BY SYMBOL; the struck
  `:70` and `:51-52` were exact when taken and are now `:80` and `:56-57`, deliberately not
  renumbered). A twin bench's two rows read `gemini#1` / `gemini#2`, so they are no longer ambiguous
  about which seat is which; a unique-alias bench is byte-identical, measured against BASE's own
  renderers loaded from `276d5a18` (`renderMd` 733/733, `renderHtml` 9667/9667). Named mutant
  `ROWSEATDROP`, RED 2 suites / 3 tests (renamed in fix round 1 — it was `CREDALIAS`, which
  already names a DIFFERENT mutant in `tests/council/street-cred-mutants.js`).
  ⚠️ **THIS ENTRY IS THE THIRD RE-DISCOVERY OF THE SAME DEFERRAL SHAPE, and it is why the
  successor is filed differently.** *"SI-25-adjacent"* named an association, never a schedule; the
  work sat here unowned until an unrelated PR happened to touch the same renderers. The follow-up it
  spawned — the THIRD street-cred renderer, `electron/workspace-ui/workspace-matrix.js:147-149`
  (anchor rotted; the site is `workspace-matrix.js :: renderVerdict`'s street-cred loop),
  still alias-labelled — is ~~filed~~ **now DONE, v4.9 W9** under *"SI-22.4 rider (2)"* above with a **named owner
  (Christian)** and a **stated gate** (`opts.labelOf` must accept a seat id), explicitly NOT as an
  adjacency. Do not re-file it as "adjacent to" anything.
- [x] **A `__proto__: null` fix does NOT survive a JSON round-trip — the Electron setup wizard
  re-materialised the prototype.** — **FIXED, v4.9 W1 (2026-08-25)** by seeding on the far side
  of the parse at the single embed site (`electron/setup-ui.js :: buildWizardScript`,
  `Object.assign(Object.create(null), …)`), pinned by a vm-eval test that was RED at HEAD —
  see the ticked release-cut pointer entry for the record. The generalizable rule this entry
  states below stands. Found by the SI-22.4 round-3 re-review, 2026-08-23, while
  sweeping uncapped for every spelling of the alias-table hazard. `getDefaultAliases()` is
  null-prototype at HEAD, but `electron/setup-ui.js` and `electron/setup-ui-alias-script.js`
  `JSON.stringify` it and re-embed it as a `<script>` literal (`var defaultAliases = {…}`), which
  the JS parser always materialises as a plain `Object.prototype` object. The seed is stripped by
  serialization. Those files then bare-index `defaultAliases[alias]` against names the user can
  free-type in the wizard's inline rename UI, with no reserved-word validation.
  **Traced, and it is NOT a security bypass:** a Function value can reach `aliasEdits`, but
  `JSON.stringify` drops Function-valued keys before the write reaches `ipc-setup.js`, and
  `saveConfig` now rejects `__proto__` outright (SI-22.4 G-5). The worst case is a **silent,
  self-directed no-op** — wrong revert-vs-delete bookkeeping for a user who names their own alias
  `toString`. Filed, not fixed: it is Electron-only, behaviourally inert, and outside SI-22.4.
  ⚠️ **The generalizable fact is the one to keep: a null-prototype table cannot be handed across a
  serialization boundary and stay null-prototype.** Any fix of this class must be re-applied on the
  far side, or the boundary must carry a `Map` instead.
  **OWNER: Christian. GATE: the wizard's alias rename input gains reserved-word validation, or the
  embedded literal is seeded on the far side of the `JSON.parse`.** Not an adjacency to anything.

- [ ] **SI-21 · `lens` and `position` are unrecoverable from the tally artifacts on any bench that
  does not repeat an alias (R4c-7).** `meta.seats` is emitted only when the bench repeats an alias,
  which is a **different question** from "does anything else in the document carry the seat's lens".
  Measured on `bench=['a','b'] lenses=['Security Review','perf']`: `meta.seats` is **absent**,
  `runStats[].role` carries only the slug `lens:security-review`, and the raw lens text
  `"Security Review"` appears **nowhere** in the tally input. ~~`position` is unrecoverable on every
  bench.~~ R4c-1's original justification for the table was *"`role`, `lens` and `position` appear
  nowhere else"*; that reason is **withdrawn** — ~~the honest claim is "seat ids are resolvable on
  twin benches, and only there"~~. The owner chose byte-identity on lens/critic benches (measured
  identical across eight configurations) over a table PR5 can ask for when it needs one. Revisit
  when a consumer actually needs `lens`/`position`, and widen the predicate then.
  - ⚠️ **This item's prose is FALSE, and so is its own proposed correction (measured 2026-08-16).**
    `position` and `lens` ARE recoverable from `meta.seats` — exactly when the bench repeats an
    alias. Measured by executing `buildSeats` + `buildTallyInput`: on `['deepseek','deepseek','gpt']`
    every `meta.seats` element carries `position` (`[1,2,3]`), and on the lensed twin bench `lens`
    survives verbatim (`"Security Review"`, while `role` keeps only the slug `lens:security-review`).
    The struck "on every bench" is the false universal. The struck replacement is wrong too: when
    the table ships it carries the WHOLE seat row — `id`, `alias`, `role`, `lens`, `position` — so
    it is not "seat ids, and only there"; `role`/`lens`/`position` are resolvable on a twin bench
    as well. ⚠️ **Even the title overclaims** — read it as the `position`/`lens` **FIELDS** being
    **ABSENT**, not as the facts being unrecoverable. Both fields are absent on a unique-alias bench
    (confirmed on `['deepseek','gpt','gemini']` and on a unique-alias lensed bench, where
    `meta.seats` is absent entirely) — **by design, not by defect** — but the seat **ordinal** is
    still derivable there from `meta.models` order: measured 2026-08-16 by executing `buildSeats` +
    `buildTallyInput`, `meta.models.indexOf(s.alias) + 1` reproduces `position` exactly on all four
    unique-alias shapes tried (plain, lensed, and with a real `claudeReview`, whose `CLAUDE_SEAT` is
    pushed **last** at `run-assemble.js:226` and so shifts no bench index). Only `lens`'s raw text
    is genuinely lost (`runStats[].role` keeps only the slug). The same false universal was
    corrected in `run-assemble.js` and `run-assemble.test.js` in the same PR.
    **Remains a HOLD — not work, do not re-scope.**
- [ ] **Five seat shapes the #137 peer fix does not close.** All measured, all disclosed in the
  CHANGELOG rather than hidden:
  1. **The raiser's own Stage-1 leg orphans** — `findings[].raiserSeat` and that seat's vote-seat
     vanish *together*, the filter falls back to the alias compare, and the undercount survives.

     ✅ **THE TEST REPLACEMENT IS EXECUTED — 2026-08-19, v4.8 Phase 2 T-B2, `e23e56cd`.** The
     instruction was to REPLACE `tests/council/tally.test.js` T1 and T2 rather than pass them,
     because both pinned the WRONG behaviour *as disclosed* (`basis {a:0,d:0,n:0}`, `Singleton`),
     so the fix could not be written "keeping the suite green". Both were replaced and the
     replacement is pinned by the named mutant `NAIVESPLIT` (17 suites / 97 tests red), not by a
     preservation test. Both titles gained `AND announced`; current values, read from the tree
     after the last edit to that file:
     ⚠️ **SUPERSEDED COUNT** — `97` was true at T-B2 (`e23e56cd`) and stands as written; T-B4's two
     re-runs make it **17 suites / 109 tests**, which is also the value at HEAD — T-B5's round-1 volume
     pin briefly inflated it to 110 and round 3 removed that coupling. Single source:
     `peer-split-mutants.js :: NAIVESPLIT`.
     - T1 — `tally.test.js:331` (**was `:329`**)
       `T1: direction A — finding HAS raiserSeat, the twin vote has NO seat ⇒ excluded AND announced`
     - T2 — `tally.test.js:357` (**was `:341`**)
       `T2: direction B — finding has NO raiserSeat, the twin vote HAS a seat ⇒ excluded AND announced`

     ⚠️ **This did NOT close SI-22.1 or SI-22.2.** Owner ruling R2 is *mark
     explicitly, attribute nothing*: the ambiguous vote is STILL dropped, `basis` still reads
     `{a:0,d:0,n:0}`, the tier is still `Singleton`, and the undercount these two shapes
     describe SURVIVES, deliberately. ⚠️ **"Undercount" here names a POSSIBILITY** (T-B5 fix round 3,
     council C1): such a vote is either a real twin's signal or the raiser's own, and the engine
     cannot tell — which is why it is announced. Annotated, not rewritten. The one thing that changed is that the drop is now
     **ANNOUNCED** — `findings[].unattributedPeerDrops`, emitted only when > 0.

     **THIS shape's own fixture is T2 (`tally.test.js:357`, **was `:341`**) — the mapping is the REVERSE of the ordinal guess.**
     Measured 2026-08-16 by reading the fixtures: T2's finding carries **no** `raiserSeat` while the
     adjudication carries `seat: 'deepseek#2'`, i.e. the **raiser's own** leg is the orphaned one
     (its in-test comment: *"only ONE unbound Stage-1 twin review"*). T1 is **SI-22.2's** shape
     (below), not this one. Pair them backwards and the replacement pins the wrong direction.

     ⚠️ ~~**T1 and T2 are the ONLY tests separating GUARDED from NAIVE**~~ — **RETIRED BY
     MEASUREMENT 2026-08-19 (T-B2).** The named mutant `NAIVESPLIT` (the inner ternary of
     `peer-split.js :: peersOf` replaced by the unguarded `v.seat !== f.raiserSeat`) was run
     against the FULL suite: **17 suites / 97 tests red**, of which 10 are in `tally.test.js` and
     only 2 of those are T1/T2.
     ⚠️ **SUPERSEDED COUNT, not a superseded retirement** — true at T-B2 (`e23e56cd`); T-B4's re-runs
     make it **17 / 109**, which is also the value at HEAD (T-B5's round-1 pin briefly read 110;
     round 3 removed the coupling), 13 in `tally.test.js`. The retirement above holds a fortiori.
     Single
     source: `peer-split-mutants.js :: NAIVESPLIT`. NAIVE also breaks the ordinary unique-alias bench, reading
     `undefined !== undefined` and dropping a real peer, which most of the council suite
     exercises. The narrower TRUE statement, which is what mattered here: T1 and T2 are the only
     tests pinning the **one-side-seated twin** directions. Both were REPLACED (not deleted) by
     T-B2 — same `basis`/`Singleton` assertions plus `unattributedPeerDrops: 1` — so that
     separation is carried forward, and NAIVE is now pinned by a named mutant recorded beside the
     predicate itself. NAIVE remains the unguarded `v.seat !== f.raiserSeat`, spelled out in
     `tests/council/tally.test.js`'s GUARDED/NAIVE preamble — structurally the same
     admit-your-own-vote hazard trap #1 and SI-04 say **re-arms #137**. T3 separates GUARDED from
     HEAD only.
  2. **A peer twin's leg orphans** — the fallback drops that twin's legitimate agree, and the
     `sameModelCorroboration` stamp does not fire either, so the corroboration is silently absent
     rather than merely unlabelled. This one is a **deliberate safe-drop**: a seat-less `deepseek`
     vote cannot be told apart from the raiser's own.

     ✅ **THE TEST REPLACEMENT IS EXECUTED — 2026-08-19, v4.8 Phase 2 T-B2, `e23e56cd`.** Identical
     to the note under SI-22.1 above, and it applies to this shape for the same reason: T1 and T2
     were REPLACED rather than passed, `basis {a:0,d:0,n:0}` / `Singleton` stand, and the
     replacement is pinned by the named mutant `NAIVESPLIT` (17 suites / 97 tests red). Both titles
     gained `AND announced`; T1 is now `tally.test.js:331` (**was `:329`**) and T2
     `tally.test.js:357` (**was `:341`**).
     ⚠️ **SUPERSEDED COUNT** — `97` was true at T-B2 (`e23e56cd`) and stands as written; T-B4's two
     re-runs make it **17 suites / 109 tests**, which is also the value at HEAD — T-B5's round-1 volume
     pin briefly inflated it to 110 and round 3 removed that coupling. Single source:
     `peer-split-mutants.js :: NAIVESPLIT`.

     ⚠️ **This did NOT close SI-22.1 or SI-22.2.** Owner ruling R2 is *mark
     explicitly, attribute nothing*: the ambiguous vote is STILL dropped, `basis` still reads
     `{a:0,d:0,n:0}`, the tier is still `Singleton`, and the undercount these two shapes
     describe SURVIVES, deliberately. ⚠️ **"Undercount" here names a POSSIBILITY** (T-B5 fix round 3,
     council C1): such a vote is either a real twin's signal or the raiser's own, and the engine
     cannot tell — which is why it is announced. Annotated, not rewritten. The one thing that changed is that the drop is now
     **ANNOUNCED** — `findings[].unattributedPeerDrops`, emitted only when > 0. In particular, the "deliberate safe-drop" above is still a DROP: a seat-less
     `deepseek` vote still cannot be told apart from the raiser's own, and `sameModelCorroboration`
     still does not fire on it. It is now counted, not recovered.

     **THIS shape's own fixture is T1 (`tally.test.js:331`, **was `:329`**) — the mapping is the REVERSE of the ordinal guess.**
     Measured 2026-08-16 by reading the fixtures: T1's finding **has** `raiserSeat: 'deepseek#1'`
     and it is the twin **judge's** vote that carries no seat, i.e. the **peer's** leg is the
     orphaned one (its in-test comment: *"the twin judge's Stage-2 seat orphaned"*). T2 is
     **SI-22.1's** shape (above), not this one. Pair them backwards and the replacement pins the
     wrong direction.

     ⚠️ ~~**T1 and T2 are the ONLY tests separating GUARDED from NAIVE**~~ — **RETIRED BY
     MEASUREMENT 2026-08-19 (T-B2).** See the identical note under SI-22.1 above: `NAIVESPLIT`
     turns **17 suites / 97 tests** red, not 2. The narrower true statement is that T1 and T2 are
     the only tests pinning the one-side-seated twin directions, and T-B2 REPLACED both rather
     than deleting them, so that separation is carried forward.
     ⚠️ **SUPERSEDED COUNT, not a superseded retirement** — true at T-B2 (`e23e56cd`); T-B4's re-runs
     make it **17 / 109**, which is also the value at HEAD (T-B5's round-1 pin briefly read 110;
     round 3 removed the coupling). "Not 2" holds a fortiori. Single source:
     `peer-split-mutants.js :: NAIVESPLIT`.
  3. ✅ **DONE — producer half SHIPPED 2026-08-16 (T2.2, `33e2ecf7`); reconcile half 2026-08-17 (T-A4, `1e385895`).**
     ~~Two orphaned twin seats collapse to ONE dead-seat row carrying no seat.~~ `deadSeats`
     (`src/council/run-stage1-rows.js :: pushDeadSeatRows` — anchored BY SYMBOL; the old `:76-89`
     has moved and now points at unrelated lines) was a **Map** whose key fell back to the alias
     when `seatOf.get(l)` was null, so two dead twins produced one entry. Measured through the real
     `pushDeadSeatRows` + real `bindSeats`: two orphaned twin legs ⇒ `[{"model":"deepseek",
     "role":"seat"}]` — one row, no seat, for two paid seats. It now keys through `legLossKey`,
     which mints from the leg's own `taskId` on a proven twin alias, so N orphaned twin legs that
     REACH this producer give N rows; the wave arm marks each unidentified slot with a `Symbol`.
     Every row still carries **no** seat — the count moved, the attribution deliberately did not.
     ✅ **THE RECONCILE HALF IS CLOSED (T-A4, `1e385895`, 2026-08-17).** The filing is kept below,
     struck, because its scope clause is still the reason the count is what it is.
     ~~Why this is PARTIAL and not DONE: a retry wave that returns FEWER legs than it launched still
     yields **1** note and **1** row for two unattributable twins; `run-retry.js`'s `launched` Map is
     `seatKey`-first-wins, and it needs an extraction (+7 lines wanted, 5 free) before the fix can be
     written. A second consequence of the same key: both still-dead notes read slot 0's
     `firstFailure`.~~ **Every clause of that is now false.** The extraction landed first
     (T-A1 `955bd7c9`, T-A2 `2517a947`), `launched` is no longer a first-wins presence Map — an entry
     carries a slot COUNT and its OWN per-slot `firstFailure`s — and a partial return yields **2**
     notes and **2** `stillDeadLegs`, output IDENTICAL to the BOUND control in both the partial- and
     full-return shapes. These were the code council's **B1** and **B2** on PR #170; both are fixed,
     and the per-retry-outcome table lives under "The durable finding" above.
     ⚠️ **The scope clause SURVIVES the fix**: the producer still cannot emit a row for a seat that
     never reaches it — `pushDeadSeatRows` emits one row per still-dead input it is HANDED.
     ⚠️ **Never restate this as the unqualified "N orphans → N retry slots and N rows, both arms".**
     The ROW/NOTE half is now closed in **all four** retry shapes — wholesale retry death, FULL
     return, skipped unit, and (since T-A4) PARTIAL return. The retry-SLOT half is closed in every
     shape **and BOUNDED by the roster since T-A3 (`4413eb25`)**: N orphans buy
     `min(N, roster count)` slots, not N — shape A 3 ⇒ **2**, shape B 4 ⇒ **2**, controls 2 / 1 / 1
     unmoved. That bound is the fix, not a residual, and it is precisely why the headline stays
     banned even now that B1/B2 are closed.
     ⚠️ **The R2 floor is deliberate, not a gap.** A leg with NO `taskId` has genuinely nothing to
     mint from and still collapses to one row — inventing an id there is the guess that keyspace
     exists to reject. Pinned by name: `run-stages.test.js` :: *"T12: two orphaned twins the
     producer cannot tell apart still collapse (R2 floor)"*.
  4. ✅ **DONE — v4.8 SI-22.4, 2026-08-23** (`1c7a9087` trim + rider + pins · `4c49becc` the four
     named mutant red sets · `f771f59b` fix round 1; branch `v48-si22.4-preset-trim`, BASE
     `ecf90f19`, plan `276d5a18`).
     ~~**A `--council` preset with a whitespace-padded member is functionally a twin bench that
     `buildSeats` treats as two distinct aliases.** `classifyCouncilMembers`
     (`src/utils/config.js:438-460`) pushes `member` **raw** where `parseModelsList` would trim, and
     `buildSeats` (`src/council/seats.js:67`) mints `alias#N` only when `counts.get(alias) > 1` — so
     `['openai/gpt-5 ','openai/gpt-5']` is two aliases, not one. Measured with both seats agreeing on
     both findings: `basis {a:0,d:0,n:0} Singleton` — **the undercount survives in full, silently.**
     The fix is upstream (trim at classification), not in the peer filter.~~
     **Fixed exactly there.** `src/utils/config.js :: classifyCouncilMembers` — anchored BY SYMBOL.
     Counting rule: brace-matched from the `function classifyCouncilMembers` line to its balancing
     `}`, inclusive. By that rule it was **`:438-462`** both at BASE `ecf90f19` and at the commit
     that wrote the struck citation (`c2313416`) — so the struck `:438-460` was **never exact**: it
     stopped at the loop's closing brace two lines early. Neither half is renumbered; the symbol is
     the anchor.
     ⚠️ **This sentence also carried `:461-496` "at HEAD", and that was wrong — measured
     2026-08-23.** `:461-496` is `11b3cd40`'s span; the very next commit (`7d33a3c4`, the fix round
     that corrected the `:438-460` half) added **+8 lines of JSDoc immediately above the function**,
     moving it to `:469-504`. The author brace-matched, then edited above the function, then never
     re-measured — **inside one commit**. No "at HEAD" number is given now, deliberately: a
     self-referential line citation is stale the moment anything above it moves, which is the entire
     reason this entry is anchored by symbol in the first place. Re-derive it if you need it. The function now trims each member **before gate
     1**, so a padded
     alias reaches the alias table clean and a padded full id reaches the catalog lookup clean.
     `buildSeats` (`src/council/seats.js:67`, re-derived against the final tree and unmoved) then
     sees ONE alias twice and mints `alias#N` for both, which the seat-aware peer filter already
     handles.
     ⚠️ **The filed framing above was INCOMPLETE — this is the durable lesson.** It describes input
     hygiene whose one knock-on is a twin bench. Measured over six shapes, **all six change
     behaviour and the dominant change is RESURRECTION, not de-duplication**: a member dropped today
     starts RUNNING — a new paid leg on four of the six, and on two of those the bench goes from
     empty to non-empty. Only ONE of the six is the twin-merge this item describes. The six-row
     table has **one home**, deliberately, so the two records cannot drift: `CHANGELOG.md`'s entry
     *"A `--council` preset member with stray whitespace now runs"*.
     ⚠️ **The justification this item never led with:** the padded member produced a **degraded exit
     (2)** — `run.js :: runCouncil`'s `dropped-members` note says so verbatim (*"the bench is smaller
     than the preset requested; the run will exit degraded (2)"*) — while `--models` already trimmed
     on BOTH spellings: `sidecar/fanout-validate.js :: parseModelsList` and
     `cli-council-run-bench.js :: parseList`. The second is on the **council** surface, the plan
     missed it, and the implementer found it. Same whitespace, benign on one flag, fatal on the other.
     **R22.4-2:** `models` carries the trimmed value; `dropped`/`droppedMembers` keep the member RAW
     so a user can still find it in their own config. **R22.4-3:** an all-whitespace member trims to
     `''` and is dropped by gate 1 — a preservation property, measured identical either side, pinned
     with a named mutant rather than RED-before-GREEN. **R22.4-4:** exactly TWO `reason` strings
     still exist, so the docblock's free-text-vs-enum tripwire is NOT tripped.
     **Rider R22.4-6 — `report-md.js` and `report-html.js` now label street-cred rows
     `s.seat || s.model`.** ⚠️ **Record that it was HOMELESS**: deferred twice as
     *"SI-25-adjacent"*. **An association is not a schedule** — the same shape that left SI-25 site
     (3) unowned for two days. Byte-identity on a unique-alias bench, measured against BASE's own
     renderers loaded from `276d5a18`: `renderMd` 733/733 bytes, `renderHtml` 9667/9667, identical.
     On a twin bench `| gemini |` twice at BASE becomes `gemini#1`/`gemini#2`.
     **The knock-on, proved from artifacts rather than reasoned from `buildSeats`:** `meta.seats` is
     `['gemini#1','gemini#2']`, with `review-gemini-1.md`/`review-gemini-2.md` and
     `judge-gemini-1.md`/`judge-gemini-2.md` on disk and `review-gemini.md` **absent** — against a
     control with the same padding and no collision, which asserts `'seats' in meta === false`.
     **Named mutants, none empty** (`tests/council/preset-trim-mutants.js`): `NOTRIM` 2 suites/9
     tests · `TRIMDROPPED` 1/2 · `KEEPEMPTY` 1/1 · `ROWSEATDROP` 2/3 — all four independently
     reproduced by a reviewer that compiled `config.js` in memory at its real path rather than
     touching the tree. Suite **549 suites / 7929 passed / 8 skipped / 0 failed** (BASE 546 / 7909
     passed — +3 suites, +20 tests). All five gates clean.
  5. ✅ **CLOSED 2026-08-20 — v4.8 T2.4 / PR C, in BOTH consumers.** This is the shape **SI-22.5**
     names, and ruling **R3** governs it: the vote now renders in a conditional `UNATTRIBUTED`
     column and stays in `basis`. Measured through the real `report.js :: toModel` on a twin bench
     whose judge emitted no `adjudications[].seat` — at `ed5c0c02` the roster was
     `["deepseek#1","deepseek#2","gpt#1"]` and `byJudge` carried a junk `"deepseek": "dispute"`
     entry no column read; at `e5376399` the roster is
     `["deepseek#1","deepseek#2","gpt#1","UNATTRIBUTED"]`, the vote lands in
     `byJudge.UNATTRIBUTED`, **zero junk keys survive**, and `basis` is `{a:1,d:0,n:0}` on both
     trees. See **SI-22.5's filing** ABOVE for the join rule that closed it — this is SI-22.5,
     not SI-12, which is a different and still-OPEN defect (owner ruling **R19**, 2026-08-20).
     ~~**A judge whose Stage-2 seat orphaned has its vote counted in `basis` but rendered NOWHERE**
     in the seat-keyed matrix — it keys to a bare alias no column reads. HEAD at least rendered it
     via alias last-wins.~~ NEW with PR4c's matrix re-key, pinned as disclosed behaviour in
     `tests/council/seat-matrix.test.js` rather than left to be discovered.
     ⚠️ **The sixth shape below is NOT closed** — re-measured 2026-08-20 at `ed5c0c02` and at
     `e5376399`, byte-identical output on both: it grows no `UNATTRIBUTED` column, because the
     raiser cell is not a vote and PR C changed only the vote→column join. A sixth, related shape
     is pinned beside it: when the **raiser's** Stage-1 seat orphans on a twin bench the star
     disappears and the Raiser cell names no column, because `meta.seats`' guard runs over the whole
     seat table and is independent of binding while `raiserSeat` needs a bound `r.seat`.
- [ ] **`location` is stripped on the MCP tally path.** `amicus_council_tally`'s findings schema
  (`src/mcp-tools.js:408`) declares only `id`, `raiser`, `severity`, `claim?` (plus the `raiserSeat?`
  PR4c added), so zod drops `location` — while `src/council/anonymize.js` emits it and its own
  comment records that Action v2 joins on `claim` + `location`. `src/mcp-server.js` hands the
  SDK-**parsed** input straight to `tally()`, so nothing downstream can recover it. The CLI path
  (`src/cli-handlers-council.js`, a raw `JSON.parse` with no schema) keeps it — so this is a live
  CLI/MCP fork. PR4c widened the same schema for the three seat keys (R4c-5) and deliberately did
  not widen it further; the fix is one more optional field, but it wants its own test.
- [x] **`VERDICTS[v.verdict]` resolves INHERITED keys.** `tally.js :: tally`'s comment — anchored BY
  SYMBOL, not by line: the numeric citation rotted repeatedly across this item's history (`:141` →
  `:122-124` → `:129-131` → `:103-104`, each already wrong by the time the next was written, per
  this item's own prior text) and is deleted outright here rather than corrected a further time —
  claimed unknown verdict strings are skipped so a stray value cannot corrupt the basis, but
  `VERDICTS` (`tally.js :: VERDICTS`, likewise de-numbered — its own `:72`/`:71` citations were the
  same class of rot) was a plain object literal, so `verdict: 'toString'` resolved through the
  prototype chain and `basis["function toString() { [native code] }"] = NaN`, serialized as `null`
  in both `tally.json` and `verdict.json`. Reachable on the schema-free CLI path only — the MCP
  path's `adjudications[].verdict` is `z.enum(['agree','dispute','neutral'])`
  (`src/mcp-tools.js:426`), which rejects every `Object.prototype` key before `tally()` ever runs.
  PR4c's `sameModelCorroboration` stamp (`tally.js :: sameModelCorroboration`) reads the same
  `VERDICTS[v.verdict]` expression — measured harmless: it resolves the same `undefined`, so
  nothing downstream corrupts.
  ✅ **CLOSED 2026-08-22 — v4.8 Phase 6 PR1 Task 1 (`36297e18` fix + tests, `41733c58` mutant
  record; SI-24).** Fixed at the table, not at either read site:
  `VERDICTS = { __proto__: null, agree: 'a', dispute: 'd', neutral: 'n' }`. Named mutant
  `PROTOVERDICT` (delete `__proto__: null,`) reds **5 tests / 1 suite** in
  `tests/council/tally.test.js` (the 4 Object.prototype-key cases, plus one equality pin — `bogus`
  no longer equal to `toString`), measured over `npx jest tests/council/ --no-coverage` (75 suites
  / 1418 tests at that scope). The `hasOwnProperty` guard this entry once proposed was not the fix
  taken. Three more carriers of the identical shape closed in the same PR — `street-cred.js ::
  perJudgeRank`, `report.js :: SYMBOL`, `debate.js :: PAST_TENSE` — see status-table row `| 24 |`.
- [ ] **Filed, not fixed — the three vote-symbol renderers disagree on how they display an
  unrecognized verdict, and this PR's `report.js :: SYMBOL` fix does not touch it.** MEASURED
  2026-08-22 against the final tree with a plain unknown string, `bogus` (no `Object.prototype`
  collision involved, so this is unaffected by `SYMBOL`'s `__proto__: null` either before or after):
  `report-md.js:50` and `report-html.js:42` both render the literal text `undefined` into the cell
  (`v ? SYMBOL[v] : ''`/`' '` takes the truthy branch, and `SYMBOL['bogus']` is `undefined`);
  `matrix-model.js:201`'s `SYMBOL[vote] || '?'` renders `?`. ⚠️ **This PR's own task brief claimed a
  three-way split (`''` / `"undefined"` / `'?'`) — measured wrong.** `report-md.js` and
  `report-html.js` agree with each other (both `undefined`); only `matrix-model.js` differs. The
  `''` value the brief expected belongs to a *different* scenario it conflated with this one — a
  judge who cast no vote at all (`byJudge[j]` seeded `null`), where `report-html.js` renders empty
  and `report-md.js`/`matrix-model.js` render a literal space instead. **Not caused here**: `bogus`
  produced the identical `undefined`/`undefined`/`?` split at the commit before this PR started
  (`d0e03fb0`) — a non-`Object.prototype` string was never affected by the missing null prototype,
  and none of `report-md.js`/`report-html.js`/`matrix-model.js` were touched by this PR. Reconciling
  the three is a rendering-contract decision (what SHOULD an unrecognized verdict show — blank, a
  placeholder glyph, or the raw string?), not a bug fix.
- [ ] **Filed, not fixed — the wider module-level lookup-table family, and the discriminator that
  makes a sweep of it tractable.** `grep -rn "^const [A-Z_0-9]* = {" src/` returns **34** hits
  (re-measured 2026-08-22 against the final tree, independently confirmed with two different tools;
  re-run it, this number will move as the codebase does — the plan that scoped this PR said 35).
  Three of this PR's four carriers are module-level tables and appear in that count (`tally.js ::
  VERDICTS`, `report.js :: SYMBOL`, `debate.js :: PAST_TENSE`); the fourth, `street-cred.js ::
  perJudgeRank`, is a **write-site accumulator local to a single function call**, not a module-level
  `const`, so it never appears in this grep at all — a different shape, same as the ad-hoc
  in-function maps filed below.
  The discriminator that matters before spending a task on any of the other ~31 tables: **is the
  table keyed by a string a council DOCUMENT carries from a model's own response** (a verdict, an
  action, a raiser id — the SI-24 shape, where an unlucky or adversarial model response can supply
  the literal string `"toString"`) **or by an internal enum the engine itself assigns** (a tier, a
  run stage, a conformance class, an exit signal, a CLI/MCP param-map key) **that no external input
  can ever widen?** Skimming the 34, the large majority are the latter. Each still wants its own
  measurement, not an assumption, before it earns an edit.
  Precedent this generalizes: `electron/workspace-ui/live-seats.js :: SEATS_PANEL_EXCLUDED_ROLES`
  already shipped as `Object.create(null)` (v4.7, D6/E1) — that fix covered the seats-panel's
  role-exclusion table only, not this wider family.
- [ ] **Filed, not fixed — ad-hoc in-function object-literal maps are a third shape, distinct from
  both the module-level table family above and `perJudgeRank`'s accumulator.** `debate.js ::
  applyDebate`'s local `byId = {}` (flattens the per-raiser defense map to a per-finding-id lookup)
  and `debate.js :: allNoResponse`'s own separate `byId = {}` are both plain object literals keyed
  by finding id, not by a verdict/action/vote string — a different reachability argument (finding
  ids are assigned by the orchestrator, "already A1/B2/C3-prefixed," not raw model text) that this
  PR did not evaluate and did not fix. Anchor by symbol, not by line — the same rot class as SI-24's
  own citations, above.
- [x] **The chair packet is assembled entirely in alias space, so on a twin bench it is internally
  unreconcilable.** `src/council/run-assemble.js :: buildChairPacketFile` (re-anchored BY SYMBOL
  2026-08-16 — it was cited as `run-assemble.js:263-277`, but v4.8 Phase 1 T1.1 lifted
  `buildRunStatsEntry` out of the lines above it and the function now opens at `:223`) passes the
  chair only `reviews`, `rankings`, `adjudications` and `record.tierCounts`;
  `src/council/briefings-chair.js:88`
  renders `--- Review by ${r.model} ---` and `:93` renders `${a.findingId} — ${a.judge}:
  ${a.verdict}` — every one of them alias-keyed. The chair is therefore handed *"Deterministic tier
  counts: {Confirmed: 1}"* beside two `A1 — deepseek:` lines, with **nothing in the packet able to
  reconcile them**. PR4c seat-keyed the report and the Workspace matrix but not this packet, so the
  human-facing artifact and the model-facing one now disagree. ⚠️ Note the constraint before
  fixing: `tests/council/run-debate.test.js`'s parity pin exists because a seat id in a
  model-carrying **launch** argument is a non-routable model name and a real paid failure — the
  packet is prose, not a launch argument, so it is safe to seat-key, but the boundary must be kept
  explicit.
  ✅ **CLOSED 2026-08-23 — v4.8 SI-25**, branch `v48-si25-chair-packet-seats`, BASE `c0745013`.
  Code commits: `f7fe180d` (code + 15 pins) · `0c06bca9` (the five named mutants) · `95ee5520` (fix
  round 1, comment-only). The record rides separately; the plan commit `efb9c4ad` shipped nothing. Plan: `docs/superpowers/plans/2026-08-23-v48-si25-chair-packet-seat-space.md`.
  ⚠️ **ALL THREE rendering sites shipped, not the (1)+(2) this entry names — ruling R25-1, and it
  is NOT scope creep.** R15 (see the owner-rulings table above, row R15) sent site (3) — the
  **rankings** site, the MIDDLE one in the file, not the last — to "the street-cred PR". Phase 3
  shipped and did **not** do it; its own plan says so verbatim, twice: *"Phase 3 UNBLOCKS it;
  Phase 3 does not do it."* The deferral therefore had no remaining referent. All three sites showed
  the same collapse, and a two-of-three fix would have left the rankings block alias-keyed while
  this entry claimed SI-25 closed — worse than either extreme, because a packet seat-keyed in two
  blocks and alias-keyed in a third is *still* unreconcilable and no longer looks it. **Anyone
  reading R15 later must not conclude the third site was scope creep.**
  Shipped, at `src/council/briefings-chair.js :: buildChairPacket` (symbol anchors are the durable
  form; HEAD line numbers given once, for orientation only):
  - **(1)** review-block headers, `:149` — `` `--- Review by ${displayName(r.seat) || r.model} ---` ``
  - **(3)** peer rankings, `:151` — key `` `${r.seat || r.judge}` ``, values a per-slot, tie-aware,
    null-safe zip through the new `briefings-chair.js :: seatKeyedOrder` (`orderSeats` legitimately
    carries `null`s and may be short or absent, so it is **not** a drop-in for `order`)
  - **(2)** adjudications, `:154` — `` `${a.findingId} — ${a.seat || a.judge}: ${a.verdict}` ``
  Plus `run-assemble.js :: buildChairPacketFile` now forwards `seat` through its reviews projection:
  that projection drops `r.seat` before the packet ever sees it, so **site (1) was not fixable
  inside `briefings-chair.js` alone** — which is why this entry names `buildChairPacketFile` too.
  ⚠️ **The plan's own prescription for site (1) was WRONG, and the guard that replaced it is
  load-bearing.** The plan said `displayName(r.seat) || r.model` with an **unconditional** seat
  forward. Measured: `run-launch.js :: materializeReviews` sets `modelInput = leg.modelInput ||
  leg.model`, so `reviews[].model` falls back to the **resolved** id (`google/gemini-3.5-pro`) when
  a leg reports no `modelInput`, while `seat.id === seat.alias === 'gemini'`. An unconditional
  forward therefore rewrites that header **on a bench with no twin at all**, breaking spec §4.2's
  byte-identity promise. The fix applies the **emit-when-DIFFERENT** predicate at the projection —
  the same spelling as the `rankings[]`/`runStats` sites in the same file — so byte identity holds
  by construction rather than by argument.
  ⚠️ **`src/council/seats.js :: displayName` had ZERO production consumers until now.** Its docblock
  has read *"How a seat is named to a human — chair packet review headers today"* since the day it
  was written, and the only caller anywhere was `tests/council/seats.test.js`. It was built for this
  item and never wired. Recorded so the next reader trusts a docblock's "today" a little less: at
  HEAD its one production caller is `briefings-chair.js:149`.
  **Invariant (R25-2): byte-identical output on every unique-alias bench**, proven by an equality
  assertion, not asserted in prose. It is free — `seat` is absent from `rankings[]`/`adjudications[]`
  exactly when it would equal the alias, and `displayName(seat) === seat.id === alias` for a unique
  seat — which is why every site uses a fallback and never an unconditional seat read.
  **Named mutants** (`tests/council/chair-packet-seat-mutants.js`), each applied by hand and run at
  full `npx jest --no-coverage` scope, **denominator 546 suites / 7914 tests** (7914 = 7906 passed +
  8 skipped): `ALIASBACK` 1 suite / 3 tests · `SEATONLY` 4 / 12 · `NULLLEAK` 1 / 4 · `FLATTIE` 1 / 1
  · `HDRSEATFWD` 1 / 1. An independent reviewer re-measured all five via scratch copies and jest's
  `moduleNameMapper`, and reproduced **every red set and the denominator exactly**.
  ⚠️ **`HDRSEATFWD` is the one to remember**: it is a named mutant of *the plan's own prescribed
  implementation*, it reds 1 test — and **before this item it would have red ZERO**. The naive form
  would have shipped GREEN. A guard added to fix a defect must carry a mutant that reds on the
  defect's original shape; the plan did not ask for one and should have.
  **Suite at HEAD: 546 suites / 7906 passed / 8 skipped / 0 failed.** Gates: `check:sizes` 0 ·
  `check:citations` 0 · `check:secrets` 0 · `lint` 0 · `validate-docs` 0. **Sizes** (the gate's own
  rule — `content.split('\n').length`, minus 1 if the file ends in a newline):
  `briefings-chair.js` 182 → **243** · `run-assemble.js` 271 → **278** · `street-cred.js` **258** ·
  `anonymize.js` **145**, all under the 300 gate.
  ⚠️ **This entry's own `:223` for `buildChairPacketFile` had ALREADY rotted before this PR** — not
  caused by SI-25. Counting rule: the line of `function buildChairPacketFile(` in
  `src/council/run-assemble.js`, measured on both branch BASE `c0745013` **and** HEAD — it is
  `:242` at both, so nothing in this PR moved it. Read the symbol, never the number.
- [x] **`letterByModel` is dead code that looks live, and it collapses twins.**
  `src/council/anonymize.js@5ef5048e` declares it in `assignLabels`' JSDoc (`:18`), builds it
  (`:28`), populates it keyed by MODEL (`:31`) and returns it (`:33`) — and it has **no production
  consumer anywhere in `src/`**; the only reader is `tests/council/anonymize.test.js`. On a twin bench
  `letterByModel` keeps one letter per alias, so anyone who reaches for it gets a silent collapse.
  ⚠️ **`labelMap` is NOT the collapsing map** — a prior review claimed it was; measured,
  `assignLabels(['a','a','b'])` yields `{"Review A":"a","Review B":"a","Review C":"b"}`, whose keys
  are labels and are unique by construction. Delete `letterByModel`, or give it a seat key before
  something starts using it.
  ✅ **CLOSED 2026-08-20 — v4.8 Phase 3 T3.1 (`13ae8cf6`) (SI-26).** Deleted — the first option this
  item offered. The JSDoc `@returns` clause, the `const`, the populate line and the return-literal
  key are all gone; `labelMap`/`entries` are untouched. Confirmed by a repo-wide, case-insensitive
  grep for `letterByModel` across `src/`, `electron/`, `tests/`, `scripts/`, `bin/`: zero hits.
  ⚠️ **SI-26 has no standalone checkbox anywhere in this document** — this item predates that label
  and was never renamed to carry it; its only OTHER mention is prose inside the Phase 3 NEXT TASK
  entry, and the phasing doc's own status-table row 26 is the other place this closure is recorded.
- [ ] **SI-DUP · the duplication filing (merges SI-15 + SI-27 + PR5c-SEATKEY, 2026-08-16).** Three
  filings described this one duplication and gave three different counts, **all wrong** — SI-15 said
  3, SI-27 enumerated 4 and missed 5, PR5c-SEATKEY said 3 "+ a fourth". Both true counts come to
  **nine**, but over **disjoint sets**, and PR5c-SEATKEY's "fourth" was a member of the *other* set
  — which is why nobody noticed. Every number below states the rule by which it was counted.
  Re-measured 2026-08-16 at `0080e372` over `src/` and `electron/` only (tests excluded), by
  execution — no number here is inherited from a prior filing.
  ⚠️ **Count 1 corrected 2026-08-16, T2.1 (`511cf43e`):** the "both counts come to nine" coincidence
  above held only at the `0080e372` measurement. T2.1 routed `recordFailure`'s spelling — hand-
  inlined at what was `:114` — through the exported `seatKey`; that code became a call site at
  `:115` (**now `:185`** — T2.2 moved it, see the next note), excluded by Count 1's own counting
  rule, not a spelling. **Count 1 is eight, Count 2 is
  still nine; they are no longer both nine.** Detail and re-derived sites are under Count 1 below.
  ⚠️ **Citations re-derived against the FINAL tree, 2026-08-16 (T2.2's review-fix commit):** T2.2
  (`33e2ecf7`) rewrote `run-retry-group.js` (226→**299** lines) and `run-stage1-rows.js`
  (116→**160**); the records commit `27febfb8` then added a 16-line comment to `run-stage1-rows.js`
  (160→**176**); the council-review commit added 14 more there (176→**190**) and rewrote a docblock
  in `run-retry-group.js` **in place**, net zero lines, all above `:80` — so that file stayed at
  **299** and **none** of its citations moved again. So **every** citation
  into those two files moved. **Neither COUNT changed** — Count 1 is still eight and Count 2 still
  nine; T2.2 added no spelling of the rule, only a ninth and tenth *call site* of the exported one.
  Moved: `run-retry-group.js` `:52`→**`:29`** (the definition), `:93`→**`:128`**, `:101`→**`:136`**,
  `:115`→**`:185`**, `:109`→**`:151`** (excluded, null-fallback — all four final at `33e2ecf7`,
  since neither records commit moved a line in this file); `run-stage1-rows.js`
  `:42`→**`:45`**, `:85`→**`:138`** (that one via `:113` at `33e2ecf7`, then +16 from the first
  comment and +9 from the second — `:124` was never this spelling, it was the `deadSeats.set(...)`
  line, and the intermediate `:129` is now stale too);
  `run-retry.js` `:151`→**`:153`**, `:162`→**`:164`**,
  `:192`→**`:201`**, `:197`→**`:206`**. New: `run-retry-group.js:66` (`legLossKey`'s call).
  Unmoved and re-confirmed at their stated lines: `run-debate-revote.js:64`/`:132`,
  `run-stages.js:96`/`:106`, `run.js:228`/`:229`/`:231`, `run-retry-notes.js:58`,
  `seats.js:165`/`:179`. Each value was produced by grep against the working tree and re-opened at
  its stated line, not adjusted by arithmetic from the old one.
  ⚠️ **That was true when written and is a DATED SNAPSHOT, not a live index.** Superseded
  2026-08-17 by T-A1 (−64 in `run-retry-group.js`) and T-A2 (−32 in `run-retry.js` below its moved
  block): `run-retry-group.js:66` is now `run-retry-keys.js:52`, and `run-retry.js`
  `:153`/`:164`/`:201`/`:206` are `:121`/`:132`/`:169`/`:174`. The "unmoved and re-confirmed" list
  above was re-opened again on 2026-08-17 and all of it still held **then**. Live values live in
  SI-DUP.
  ⚠️ **It does NOT still hold, and the sentence above said so for four entries it should not
  have.** All nine were re-opened on 2026-08-21 (v4.8 Phase 5 T5.4), one line at a time. **Five are
  still unmoved and were re-confirmed:** `run-debate-revote.js:64` (`function seatKey`),
  `run-stages.js:96` (`keyOf`) / `:106`, `run-retry-notes.js:58` (`return so ? so.id : null;`),
  `seats.js:165` (`artifactName`) / `:179` (`displayName`). **Four moved.**
  `run-debate-revote.js:132` — the `seatKey(seat, judge)` CALL — became **`:188`** when v4.8
  Phase 5 grew that file 176→282, and is **`:196`** since T5.5 took it to 274 (re-opened
  2026-08-22). ⚠️ The "`:132` now holds `emitStageStarted(...)`" clause was true at T5.4 and
  rotted at the round-2 fix wave two commits later: `:132` is inside `runRevoteWave`'s docblock
  today and `emitStageStarted(...)` is `:161`. And `run.js`
  `:228`/`:229`/`:231` — the spelling, its one caller and the hand-inlined third copy — are
  **`:232`/`:233`/`:235`**; `:228`–`:231` are now the comment block above them. That `run.js` shift
  is **not** this branch's doing and was already stale on 2026-08-17's pass; it is corrected here
  and at every other site in this filing that carried it.
  ⚠️ **`report.js` citations re-derived against the FINAL tree, total shift +7** (2026-08-16,
  measured at the shipped commit, not at an intermediate one): `:152`→**`:159`** (three places
  here) and `:91`/`:97`→**`:98`**/**`:104`**. Two edits stacked, and the first pass published the
  arithmetic of only one of them: T1.2 dropped two requires and expanded `isSeatSpace`'s docblock
  by three (**+1**), then the record-correction commit added a six-line clause to the *module*
  docblock at the top of the same file (**+6**). Citations were measured between the two, so the
  published `:153`/`:92`/`:98` were each 6 short. Each value above was re-opened at its stated line
  in the final working tree and confirmed to carry what the citation claims. **The counts
  themselves are unchanged** — T1.2 was a pure move of `renderMd`, which holds no Count-1 or
  Count-2 site. `matrix-model.js@ed5c0c02:84`/`@ed5c0c02:88` re-checked, unaffected, still land
  **at that ref** — ⚠️ pinned to `@ed5c0c02` on 2026-08-20 (v4.8 T2.4), which moved both: at
  `e5376399` neither lands, and the `:84` expression no longer exists verbatim (it is now inside
  `matrix-model.js :: buildMatrixModel`'s `columnFor`). The former
  `report.js:24-40` range is retired in favour of a symbol anchor: line ranges in this file have now
  rotted twice in one day, and `isSeatSpace`'s docblock does not move when the file above it grows.
  - **Count 1 — object-form `seatKey` spellings. Counting rule:** the expression
    `<seatObj> ? <seatObj>.id : <alias>` **written out** over a seat *object*, whose else-branch is
    an alias string. Definitions and hand-inlined re-spellings count; **call sites of a definition
    do not**. → **8 spellings, all in `src/council/`, 0 in `electron/`.** (Was 9 at the `0080e372`
    measurement — see the correction note above.)
    ✅ **FIVE since 2026-08-25 (v4.9 W3 Task D — disposition (b) shipped, see its note below):**
    the `run.js :: seatKey` definition, the `run-debate-revote.js :: seatKey` definition and
    `run-stage1-rows.js :: pushDeadSeatRows`' `const join = s ? s.id : alias` all became CALL SITES
    of the exported `run-retry-keys.js:15` copy — excluded by this bullet's own counting rule.
    The five that remain, each re-opened 2026-08-25: `run-retry-keys.js:15` (the exported
    definition), `run-stage1-rows.js :: pushDeadSeatRows`' `keyOf` and `run-stages.js:96 :: keyOf`
    (both left on purpose — their else branch is a LEG read, `l.modelInput || l.model`, a sibling
    form, not this rule over a bare alias), `run-stages.js:106` (the healed-filter's inline form —
    outside the W3 replace list; `run-stages.js` was not touched **by W3's seatKey replaces** —
    ⚠️ read PR-wide that clause was FALSE the day it merged: the same PR's V18 conformance hunk
    edited `run-stages.js`' repair push; scoped here per round-3 council B4, 2026-08-25), and
    `run.js:235` (hand-inlined,
    stays: its `|| byJudge.get(r.model)` fallback is load-bearing, per disposition (b)).
    Sites, **re-derived by opening each line, 2026-08-17** (T-A2 fix round 3; the list previously
    read "all re-derived by execution against the final tree" as of 2026-08-16 and **three of the
    eight were stale by then or became so** — `run-retry-group.js:29`, `run-stage1-rows.js:55` and
    `:153` — all three falsified by T-A1 moving `seatKey`/`legLossKey` into `run-retry-keys.js` and
    by `run-stage1-rows.js` growing. A rigour claim is only as current as its date, so this one
    carries the date and the method: each site below was opened at its stated line and read.
    ⚠️ T-A5 grew `run-stage1-rows.js` again (227→**295**, 5 free) and moved BOTH of its spellings a FIFTH
    time; rather than restate two numbers that rot on the next edit, they are now anchored BY
    SYMBOL — which is why those two entries alone carry no line)
    — T2.2 (`33e2ecf7`) rewrote `run-retry-group.js` (226→**299**) and
    `run-stage1-rows.js` (116→**160**); `27febfb8` added a 16-line comment to the latter
    (160→**176**); the review-fix commit added 14 more (176→**190**), which moved **one** of the
    spellings below AGAIN (`run-stage1-rows.js` `:129`→**`:138`**); the council round-2 A1 fix added
    30 more (190→**220**) and moved **both** of that file's spellings a fourth time
    (`:45`→**`:55`** and `:138`→**`:153`**). Between them those commits moved
    **four** citations into these two files — **three** of the eight spellings below
    (`run-retry-group.js:52`, `run-stage1-rows.js:42` and `:85`) plus **one** excluded site
    (`run-retry-group.js:109`) — and added a tenth call site:
    `run-debate-revote.js:64` (named `function seatKey`, one caller `:196` — **was `:132`, then
    `:188`; v4.8 Phase 5 grew that file 176→282 (T5.1 took it to 249; the two fix waves added the
    rest) and T5.5 took it to 274, and `:64` itself was unmoved through all of THAT, re-opened
    2026-08-22; ⚠️ **v4.8 SI-27 then took the file 274→268 and moved both — the definition is
    `:69` and its one caller `:190` as of 2026-08-23, re-read at both lines**;
    ✅ **consolidated 2026-08-25, v4.9 W3: the definition is GONE — a header require at `:48`,
    the caller at `:235` — no longer a Count-1 member**),
    `run-retry-keys.js:15`
    (the exported one, PR5c; **was `run-retry-group.js:52`, then `:29`, moved again by T-A1**),
    `run-stage1-rows.js :: pushDeadSeatRows`' `keyOf` (**was `:42`/`:45`/`:55`/`:57`**),
    `run-stage1-rows.js :: pushDeadSeatRows`' `const join = s ? s.id : alias;`
    (**was `:85`/`:129`/`:138`/`:153`/`:155`**; ✅ **consolidated 2026-08-25, v4.9 W3: now
    `const join = seatKey(s, alias)` at `:145` — a call site, not a spelling**),
    `run-stages.js:96 :: keyOf`, `run-stages.js:106`, `run.js :: seatKey` (**was `:228`; `:232`
    today**, one caller `:233`, **was `:229`**; ✅ **consolidated 2026-08-25, v4.9 W3: `:232`
    holds an in-place `require('./run-retry-keys')` now, caller still `:233`**),
    `run.js:235` (hand-inlined; **was `:231`**).
    **The count is still EIGHT** — T2.2 added no spelling, only call sites. ✅ **FIVE since
    2026-08-25 (v4.9 W3) — see the count line above.**
    **Excluded, and why:** `run-retry-group.js:87` (`legs.push({ leg: l, seatId: bound ? bound.id :
    null })`, **was `:109`, then `:151`; −64 from T-A1, the same shift as `:128`→`:64` below**) and
    `run-retry-notes.js:58` fall back to
    ⚠️ **T-A8, 2026-08-17: `run-retry-group.js:64`/`:72` below were re-opened and are BOTH FALSE —
    `:64` is a `@returns` docblock line and `:72` is `const attempted = new Set();`. T-A6 grew the
    file above them. The two `planStillDeadSources` sites are `:75` and `:83` today; anchored by
    symbol here and in Count 3 below, which takes them out of the class.**
    `null`, not an alias — "seat id or nothing" is a different value space; `run.js:198` and
    `run-assemble.js:89`/`:215` are the emit-when-**different** stamp, which `run.js:190` explicitly
    contrasts with *"the naive `r.seat ? r.seat.id : null` form"*; `seats.js:165`/`:179` carry no
    alias fallback; and the **nine** `seatKey(...)` call sites (`run-debate-revote.js :: runRevoteWave`
    (**was `:132`; `:188` today, re-opened 2026-08-21 after T5.1 grew that file**),
    `run-retry-keys.js:52 :: legLossKey`, **two** inside
    `run-retry-group.js :: planStillDeadSources` and one in `:: recordFailure`, **three** inside `run-retry.js ::
    retryStage1Losses` (was four; T-A4), `run.js:233 :: runCouncil` (**was `:229`**)) are consumers, not spellings —
    `run-retry-group.js :: recordFailure` (T2.1, **was `:115`, `:185`, `:121`**) is
    `recordFailure`'s former hand-inlined spelling, now a call site, and
    `run-retry-keys.js:52` (**was `run-retry-group.js:66`**, moved by T-A1) is **new with T2.2**:
    `legLossKey` computes the plain seat key first and
    only then decides whether to mint onto it.
  - **Count 2 — string-form post-emit reads. Counting rule:** a bare two-term `||` resolving an
    **already-emitted row** to one identity string — the row's emitted `seat` field, else its alias
    field (`model`/`judge`); live code only, prose excluded. → **9 sites / 10 occurrences — `src/`
    5 sites (6 occurrences), `electron/` 4 sites.**
    ✅ **Re-censused 2026-08-25 (v4.9 W3 Task D), by grepping `\.seat \|\|` and
    `\|\| X.(model|judge)` over `src/` + `electron/` and opening every hit: 14 sites /
    15 occurrences — `src/` 10 sites (11 occurrences), `electron/` 4 sites** (same rule as above,
    restated: a bare two-term `||` resolving an already-emitted row to one identity string, the
    row's emitted `seat` field else its alias field, live code only). **Five members are NEW since
    the 2026-08-21 pass**, with inclusion rulings: `briefings-chair.js:180` (`r.seat || r.judge`,
    ranking lines) and `:183` (`a.seat || a.judge`, adjudication lines), both inside
    `buildChairPacket` — SI-25-born, unambiguous members (post-emit rankings/adjudications rows,
    `seat` emitted-when-different); `street-cred.js:242 :: computeStreetCred`
    (`perJudgeRank[j.seat || j.judge]`) — **INCLUDED**: `j` is the `judgePos` projection a dozen
    lines up, which copies the emitted ranking row's `judge`/`seat` fields verbatim, so this read
    resolves the emitted row's own field pair (excluding it on the projection technicality would
    let a one-line refactor move a member out of the census); `report-md.js:86 :: renderMd` and
    `report-html.js:57 :: renderHtml` (`s.seat || s.model` over `m.streetCred`) — both
    **INCLUDED**: streetCred rows carry `seat` emit-when-set (`computeStreetCred`'s tail spread)
    and each renderer resolves the emitted row to one label. **Adjacent, NOT members:**
    `briefings-chair.js:178`'s `displayName(r.seat) || r.model` — its first term is a function of
    the seat OBJECT, the pre-emit population (the conflation trap below, in reverse); and the
    `|| null` family (`street-cred.js:227`, `run-retry.js:241`, `run-stages.js:264`,
    `observe/council-legs.js:135`, `workspace/live-normalize.js:56`, `live-seats.js:99`) —
    "seat or nothing" is a different value space, per the standing exclusions. **The nine
    2026-08-21 members were each re-opened and re-anchored:** `debate.js :: applyDebate` `:107`
    (was `:99`), `debate.js :: disputingJudges` `:207` (was `:199`), `report.js :: costRows` ×2
    `:258` (was `:239`; the `const costRows` line is `:257`), `run-debate.js:276`/`:282` (were
    `:259`/`:265`; both inside `runDebate`, moved by v4.9 W2 Task B); `electron/`:
    `live-dead-seats.js:221` (was `:219`), `live-seats.js:96` (was `:95`),
    `workspace-panels.js:122` (unmoved), `workspace-seats.js:247 :: renderDeadSeatRows` (was
    `:245`). Excluded forms re-opened the same day: `debate.js :: raiserKey`
    (`f.raiserSeat || f.raiser`) is `:258` now (was `:250`); `workspace-seats.js`' dual lookup is
    `:189-190` now (was `:188`) and reads `(s.seat && retried[s.seat]) || retried[s.model]` — a
    seat-GATED form today, further outside the bare-two-term rule than when it was excluded;
    `workspace-seats.js:88`'s seatId chain and `workspace-render.js:195`/`:225` re-confirmed at
    their stated lines. The four `electron/` members remain STRUCTURAL, per the standing paragraph
    below — renderer modules cannot `require()` from `src/`, so none were consolidation
    candidates and none become one via disposition (b).
    ⚠️ The 2026-08-21 enumeration below is retained as the dated record its correction notes
    already make it. Site and occurrence counts differ because
    `src/council/report.js :: costRows` spells the rule **twice on one line**, once per ternary
    branch: a bare "9" is
    ambiguous even inside this population. Sites — `src/`: `council/debate.js :: applyDebate`'s
    `(a.seat || a.judge) === key` (**was `:81`, then `:83`; `:99` today — re-anchored BY SYMBOL
    2026-08-21, v4.8 Phase 5 T5.3 having grown that file 256→274**),
    `council/debate.js :: disputingJudges`'s `adj.seat || adj.judge` (**was `:178`, then `:181`;
    `:199` today — same pass, and the two sites were told apart by opening BOTH at the pre-T5.3
    tree, since `:181` there was this one and is `nothingToDebate` now**),
    `council/report.js :: costRows` (×2) (**was `:159`; re-anchored
    BY SYMBOL 2026-08-20, v4.8 T2.4, which moved it to `:239`**), `council/run-debate.js:259` (**was
    `:258`**), `council/run-debate.js:265` (**was `:264`**); `electron/workspace-ui/`: `live-dead-seats.js:219`,
    `live-seats.js:95`, `workspace-panels.js:122`, `workspace-seats.js:245 :: renderDeadSeatRows` (**was `:242`**). **Adjacent forms
    deliberately outside Count 2:** `debate.js :: raiserKey`'s `f.raiserSeat || f.raiser`
    (**was `:211`, then `:224`; re-anchored BY SYMBOL 2026-08-21. ⚠️ `:224` was ALREADY wrong
    before v4.8 Phase 5 — at that phase's BASE `9ef275e5` it was a comment line and the expression
    was `:232`; it is `:250` today**;
    same shape, a
    *different* emitted field pair); the four seat-space-**gated** reads — the vote key and the
    raiser key in each consumer, re-anchored BY SYMBOL 2026-08-20 (v4.8 T2.4, which moved all four;
    they were `report.js:98`/`:104` and `workspace/matrix-model.js:84`/`:88`, each true at
    `@ed5c0c02`): `src/council/report.js :: columnFor` and the `raiser:` field of
    `src/council/report.js :: toModel`'s findings map, `src/workspace/matrix-model.js :: columnFor`
    and `src/workspace/matrix-model.js :: raiserKey` — which are all-or-nothing **by document** and **must not**
    be folded into the bare form — `report.js :: isSeatSpace`'s docblock records that independent
    fallbacks would blank every vote cell on twin verdicts already on disk; `workspace-seats.js:188`'s dual lookup (**was `:185`**; it
    queries *both* keys, so it is not a key derivation); `workspace-seats.js:88`'s `seatId` chain
    (**was `:85`**);
    and `workspace-render.js:195`/`:225`'s `seat.id || seat.model` over `seatsFromRunStats`'
    synthesised `model:role` id.
  - ⚠️ **Counts 1 and 2 are DISJOINT sets** — no `file:line` appears in both. (They totalled nine
    apiece at the `0080e372` measurement; T2.1 dropped Count 1 to **eight** — see the note above —
    so the coincidence no longer holds, but disjointness never depended on it.) Any number quoted
    about this duplication is meaningless without saying which
    population it counts: PR5c-SEATKEY's *"the renderer spells the same rule a fourth time as
    `r.seat || r.model`"* counted a **Count-2** site as the fourth member of **Count 1**, which is
    the conflation in its purest form. The trap: `r.seat` is a seat **object** before the emit
    boundary and a **string** after it, so one property name reads as two different rules
    (`run.js:235` — **was `:231`** — vs `src/council/report.js :: costRows`).
  - ⚠️ **The `electron/` re-spellings are structural, not sloppiness.** The Workspace renderer loads
    every module as a plain `<script src>` (`electron/workspace-ui/index.html:101-124`) under
    `contextIsolation: true, nodeIntegration: false, sandbox: true` (`electron/main.js:137`) and a
    `default-src 'none'` CSP — there is no module system in the renderer at all, so it cannot
    `require()` from `src/`. (The only two `require()` calls under `electron/workspace-ui/` —
    `live-model.js:58`, `live-seats.js:113` — are same-directory and guarded by
    `typeof module !== 'undefined'`, i.e. jest-only.)
  - **Disposition (a) — roster-padding core → v4.8, ruling R14. ✅ SHIPPED 2026-08-23 as
    SI-27.** The core now lives once, in `stage1-bind.js :: bindPaddedWave`, on exactly the
    signature this disposition specified. **Everything below is the pre-consolidation record:
    the three anchors are where the block STOOD.**
    `src/council/run-retry-launch.js :: bindRetryWave` (**was `:50-60`; re-anchored BY SYMBOL
    2026-08-23, SI-27 having moved the block and taken the file 67→55** — T-A2, 2026-08-17,
    lifted
    it out of `run-retry.js` unchanged; **at the time of this filing still ONE of the three
    sites, not a consolidation**),
    `src/council/run-stage2.js :: runStage2` (**was `:91-107`; re-anchored BY SYMBOL
    2026-08-23, 213→207**) and `src/council/run-debate-revote.js :: runRevoteWave`
    (**was `:115-126`, then `:155-162`, then `:179-186` at the 2026-08-22 re-opening; the block
    itself is gone since 2026-08-23, 274→268 — previously re-anchored
    BY SYMBOL 2026-08-21 as `placeholders`, v4.8 Phase 5 T5.1 having grown that file 176→282;
    T5.5 then took it to
    274 — its deletion sat entirely BELOW this block, but its comment repairs pushed the block
    down twenty-four lines**) each built the
    same `__unbound-<waveId>-<n>` placeholder roster before `bindSeats` and then filtered the
    placeholders back out — ~11 lines apiece, and all three already `require('./seats')` (as does
    the proposed home), so the consolidation costs no new dependency. All three citations re-derived
    2026-08-16; the first re-derived again 2026-08-17 after the lift. ⚠️ These are a **different set
    of three files** from Count 1's —
    overlapping, not disjoint: `run-debate-revote.js` carried both (padding at `:179-186`, a
    `seatKey` spelling at `:64`, **`:69` since SI-27 shortened the file**), while `run.js`
    carries no padding (it consumes `s2.judgeResults`,
    already padded by Stage 2) and `run-stage2.js` spells no `seatKey`. Read "three files" in either
    filing as naming a set, never a count of the whole. Home is `stage1-bind.js`, parameterised on
    `(waveId, rosterSource, aliasAt, legs)`, returning both the filtered `seatOf` Map and the raw
    `bindRes`. **The orphan tail differs at all three sites (push / degrade.note / nothing) and stays
    at the call site.** Own PR, **after Phase 2** — consolidation must not ride a defect PR.
    ✅ **Shipped exactly that way** on 2026-08-23: own PR, after Phase 2, home
    `stage1-bind.js :: bindPaddedWave` on the stated `(waveId, rosterSource, aliasAt, legs)`
    signature, returning `{seatOf, bindRes, placeholders}`, and every site kept its own tail.
    ⚠️ **Disposition (b) below is NOT closed by this** — the `seatKey` half is still v4.9.
    (✅ And v4.9 W3 delivered it, 2026-08-25 — see (b)'s shipped note.)
  - **Disposition (b) — `seatKey` cross-file consolidation → v4.9, ruling R14. ✅ SHIPPED
    2026-08-25 (v4.9 W3 Task D) — the shipped note at the foot of this bullet says what moved;
    everything between here and there is the pre-consolidation record (line numbers are where
    things STOOD).** ⚠️ The v4.8 PR4
    draft refused the padding consolidation as *"a near-copy, not a win"* while **endorsing** this
    `seatKey` one; measured, that is exactly **INVERTED**. `seatKey` is **net-flat**:
    `run.js :: seatKey` (**was `:228`; `:232` today**)
    and `run-retry-keys.js:15` (**was `run-retry-group.js:29`; T-A1 moved it, 2026-08-17**) are
    byte-identical modulo indentation — re-measured 2026-08-17, both trim to the same 49 chars,
    `const seatKey = (s, alias) => (s ? s.id : alias);` — but `run.js`'s copy has exactly **one**
    caller (`:233`, **was `:229`**); `run-debate-revote.js:64` is a
    *different* form — a named `function seatKey(seat, alias)` with different parameter names — and
    also has one caller (`:196`, **was `:132`, then `:188`; v4.8 Phase 5 grew that file 176→282
    (T5.1 took it to 249; the two fix waves added the rest) and T5.5 took it to 274. `:132` is
    inside `runRevoteWave`'s docblock today and `emitStageStarted(...)` is
    `:161`**); and `run.js:235`
    (**was `:231`**) is a **third,
    hand-inlined** copy that must stay,
    because its `|| byJudge.get(r.model)` fallback is load-bearing (an orphaned Stage-2 leg's
    conformance becomes unreachable without it). Only the **exported** copy earns its keep, with
    **seven** callers — `run-retry-keys.js:52 :: legLossKey`, **two** in
    `run-retry-group.js :: planStillDeadSources` (⚠️ cited `:64`/`:72` until T-A8 re-opened them,
    2026-08-17: both false, T-A6 having grown the file; `:75`/`:83` today) and one in
    `:: recordFailure`, and **three**
    inside `run-retry.js :: retryStage1Losses` (anchored by symbol — T-A4 moved them again).
    (Was six before T2.1, 2026-08-16, `511cf43e`, which
    made `recordFailure`'s hand-inlined spelling a seventh caller — the same change that dropped
    Count 1 above from nine to eight. T2.2, `33e2ecf7`, added the eighth, inside `legLossKey`; T-A4, 2026-08-17, removed one — `seenSeats` became a count Map filled inside the leg loop, so its own `seatKey(...)` call went away — leaving **seven**.)
    ⚠️ **This paragraph previously ended "all re-derived by execution against the final tree, not
    adjusted by arithmetic" while listing `run-retry-group.js:66`/`:128`/`:136`/`:185` and
    `run-retry.js:153`/`:164`/`:201`/`:206` — every one of those eight stale.** T-A1 moved
    `seatKey`'s definition and `legLossKey` into `run-retry-keys.js`; T-A2 (`2517a947`) shifted
    `run-retry.js` by −32 below its moved block. The eight above were re-derived on 2026-08-17 by
    grepping `seatKey(` across `src/` and resolving each hit's enclosing function — hence the
    `:: symbol` anchors, which survive the next move. A sentence asserting its own rigour is worth
    exactly nothing without a date and a method; both are now stated.
    ⚠️ **Citation rot corrected:** SI-27 credited *"`run-retry.js`'s copy … five call sites (`:152`,
    `:163`, `:180`, `:196`, `:201`)"*; PR5c moved the definition into `run-retry-group.js` (`:52`,
    then `:29` after T2.2 grew the file's header, 2026-08-16, `33e2ecf7`; **T-A1 then moved it
    again — it is `run-retry-keys.js:15` today**, `const seatKey = (s, alias) => (s ? s.id : alias);`)
    and made
    it the exported one so `run-retry.js` consumes it rather than keeping a fourth copy — every one
    of those five line numbers is now wrong, and the count was four in that file. Recorded so the
    wrong endorsement is not re-inherited. **Do not add another `src/` spelling in the meantime**
    (PR5c-SEATKEY's "do not add a fourth"): a rule needing another spelling is the plan-authoring
    failure mode **"THE WRONG LEVER"** — the defect is in a *consumer*. PR5c deliberately did not
    unify them; that is a refactor with its own blast radius, and mixing it into a defect PR is what
    made PR5a's review expensive. Still **not** urgent; it is a tidy-up, not a defect.
    ✅ **SHIPPED 2026-08-25 (v4.9 W3 Task D), own commit, zero behavior change.** What moved:
    `run.js`'s local spelling became an **in-place** `const { seatKey } = require('./run-retry-keys');`
    on the very line the spelling held (`:232`, caller still `:233`) — in-place ON PURPOSE, so the
    many live `run.js:NNN` citations across src/tests/electron did not move; `run-debate-revote.js`'s
    `function seatKey` is deleted, replaced by a header require (`:48`; its one caller is `:235`
    now); and `run-stage1-rows.js`'s `const join = s ? s.id : alias` is `const join =
    seatKey(s, alias)` (`:145`), routed through that file's EXISTING `./run-retry-group`
    destructure (`:14`) — evaluated per the plan's cycle check: `run-retry-group` requires only the
    require-free `run-retry-keys` (its `:5` header + the P2 pin in
    `tests/council/run-retry-keys.test.js`), so no exclusion was needed. The exported copy now has
    **ten** callers (the seven above + these three). `run.js:235`'s hand-inlined third copy stays,
    exactly as ruled above. Preservation: named mutant **SEATKEYSKEW** (flip the export's rule to
    `s.alias`) reds **7 suites / 34 tests** of the 12-suite focused set — including
    `run-degrade.test.js` (the run.js twin-merge pins) and `run-debate.test.js` (the revote-join
    pins), two suites NO export flip could red before this consolidation, because their sites had
    local copies: the export now measurably guards all three new sites. Count 1 above is **5** as
    of this ship; Count 2 was re-censused the same day (see its ✅ block).

### Bench adaptation — closes #135, finishes #129

#135 is #129's generalization, and names the same case (*"if Kimi sometimes takes two or three
minutes to get started"*).

- Record **time-to-first-token** in `runStats` (additive, emit-only-when-set idiom as with
  `waveId`/`tag`). This is the data foundation #135 needs — it makes slow seats visible *before*
  they cross the line rather than after.
- Derive per-model thresholds **from observed TTFT** rather than a hand-configured knob. This is the
  version that satisfies the product principle (self-heal or self-diagnose); a config knob is
  neither. It likely means `--no-output-backstop-ms` and per-model backstop config never need to
  exist — revisit only if adaptation proves insufficient.
- Capture OpenRouter-vs-direct variance in the model notes log.
- [x] ⚠️ Related, from #129's own side observation: `curated-models.js:112` ships
  `kimi → openrouter/moonshotai/kimi-k2.6` while a local config override repoints it to `kimi-k3`.
  Per-model operating notes keyed on an alias can therefore describe a different model than the
  alias now resolves to. Surface the resolved target in run artifacts, or warn when a local override
  shadows a curated alias.
  ✅ **DONE, v4.9 W13 (2026-08-26): the C5 alias-shadow warning + the pin refresh.**
  `src/utils/alias-shadow.js` warns once per run when a user alias shadows a curated alias
  with a DIFFERENT id (canonical-form compare, so a gateway-spelling of the same id stays
  silent — mutant `GATEWAYFORM`), at the shared `resolveBench` seam both transports EXECUTE,
  plus `models --check`. PR #203 round 1 widened it to the chair (explicit or default) and the
  critic, and made the once-per-run dedup re-openable so a host process running two councils
  audits both. AND the anchors above are re-derived: the curated pins themselves were a
  generation behind and moved — kimi → `kimi-k3`, qwen → `qwen3.8-max`,
  glm → `glm-5.3` (the review reproduced a standing glm-5.1-vs-5.3 shadow line CI would have
  printed every run) — so the kimi id and the `:112` line cited above are the dated 2026-08
  reading, not the tree. TTFT capture (the other half of this section) shipped the same wave
  as the probe (`ttftMs`, emit-when-set, R12: no derivation).
- ✅ **DONE, PR #207 council round 2 (finding A1): the alias-shadow notice reaches MCP callers.**
  Round 1 (finding A4) MEASURED that it did not: `mcp-server.js :: spawnSidecarProcess` spawns
  the council child with `stdio: ['ignore', 'ignore', <fd>]`, the fd being an open handle on
  `<runDir>/debug.log` (or `'ignore'` when that dir cannot be created), and then `unref`s it —
  so the child's stderr is a FILE, never a pipe the server reads and never anything the client
  sees. Both transports ran the check; only the CLI surfaced it. Round 1's disposition was
  measure-and-document; the council re-raised it, so a second notice site now writes to the MCP
  surface: `mcp-council-bench.js :: auditBenchAliases`, called from
  `mcp-council-run.js :: handleCouncilRunTool` right after bench/chair/critic resolution, pushes
  the lines into that handler's per-call `notices` array, which was already assembled into the
  tool result as extra content blocks. **Lever measured, two candidates:** the
  `utils/update-notice.js :: maybeAppendUpdateNotice` wrapper was REJECTED — its `_noticeShown`
  is a per-PROCESS latch that fires once per server lifetime on whichever tool result is first,
  which would re-introduce finding A5's silence on a new surface and has no access to the bench.
  CLI output is unchanged and byte-identical (the parent writes into an array, never a stream);
  the child still writes its own copy to `debug.log`, so the two surfaces never double-print.
  Named mutant `MCPMUTE` (3 tests / 1 suite); three absence controls stay green both ways.
  ⚠️ The underlying `debug.log` limitation still applies to every OTHER stderr notice the
  council child writes — only the alias-shadow line has a real MCP channel.

### Quote the real engine error — #133 root fix

v4.7.1 only softens the wording; this replaces the guess with the truth. When a leg dies, read the
session's line from the engine's own log and surface it. In the #133 outage the
actual cause — `SQLiteError: no such column: replacement_seq` — sat in that log the entire 30
minutes, appearing at the exact timestamp of every failed MCP session and never for the CLI sessions
succeeding in the same window. Needs log-path resolution, session correlation, and a clean fallback
when no line exists.

⚠️ **This item's original log path was stale and is corrected here** (measured 2026-08-25, v4.9 W10
Task A): it read `~/.local/share/opencode/log/opencode.log`, but current engine builds write ONE
TIMESTAMPED FILE PER PROCESS in that directory (`2026-08-25T185532.log`), and both schemes are live
across machines — the reference machine keeps a 2.4 MB legacy `opencode.log`, this one holds 12
timestamped files and no `opencode.log` at all. A resolver written to the original single-file
premise would have returned nothing, silently, on a current install. See `src/utils/engine-log.js`.

### The startup schema check — #133 fix 4, DISPOSITION (v4.9 W10 Task B, 2026-08-25)

Issue #133's fourth suggested fix asks for *"a startup schema check — if the engine's expected
schema doesn't match the on-disk DB, fail fast with that message instead of hanging for 120s."*

**Disposition: the runtime version handshake shipped as W10 piece 3 IS that check's honest core,
and no separate schema validation was built.** What actually diverged in #133 was not a schema
amicus can inspect — it was the ENGINE: 1.17.3 serving MCP against a `~/.local/share/opencode`
database written by 1.18.15. `SQLiteError: no such column: replacement_seq` is that divergence's
symptom, not its identity. `src/utils/engine-skew.js` now takes the engine's own `Session.version`
off every `createSession` response (the SDK returned it all along and `opencode-client.js` threw
it away) and compares it against the `opencode-ai` version in the RUNNING install's
`node_modules` — announced on stderr once per standing skew per server, and appended to the
`NO_OUTPUT_BACKSTOP` death report of any leg whose OWN server has a skew standing at the time it
dies, as ` (engine skew: server <a> ≠ installed <b>)`. (Round-1 review of the PR made the record
per-server and refreshed on every create: the first cut kept one process-wide slot, written once,
which stamped a skew onto unrelated servers' failures and kept reporting one that had been fixed
mid-run.)

A full engine-response / DB schema validation **was considered and not built** because the schema
is the engine's private contract with its own SQLite file: amicus neither owns those migrations
nor can enumerate the expected columns without vendoring opencode internals that move every
release, so such a check would be a guess that rots on each engine bump — while the version pair
is already published by both sides and is exactly the fact that was missing.

⚠️ Measured 2026-08-25 while building this, and the reason piece 3 uses **no global baseline**:
`doctor`'s existing skew check (`doctor-engine-check.js`, v4.7.1) compares npx-cache copies
against the GLOBAL install and is structurally blind to the copy the running process loaded. On
this machine it reports clean — global `1.18.15` vs npx `1.18.15` — while the running checkout
loads engine **`1.2.20`**: a live instance of #133's own class, invisible to the check written
for it. (Also measured against a real locally spawned engine, not read off the SDK types:
`session.create` returns `data.version`, and it was byte-identical to the running install's
`opencode-ai` version — so the two sides really are comparable.)

### Setup polish — #138

**Original problem statement, kept for the record -- resolved by the ✅ block below, not a
claim about current code:** smaller than it reads: a two-level-picker gap, not a missing
feature. The main `setup` path (the `'Choose your default model:'` readline prompt --
`setup.js:444` was already the wrong pointer even when this was written; the prompt now lives
at `src/sidecar/setup.js:513`) offered quick-picks keyed by **family alias**
(`deepseek → routes.openrouter`) with no model-level choice -- but a per-provider picker with
priced, context-annotated rows **already existed** (`provider-default-prompt.js` /
`provider-default-picker.js`); it only ran after `amicus key <provider>` saved a key. And
`resolveChoice` already accepted *"any full model id"*, so the capability was there but
undiscoverable from the list. The ask: add the family → model second level, reusing the
existing priced picker -- done, see below.

✅ **Pieces 1+2 DONE — branch `fix/138-model-level-default` (2026-08-24; not yet merged).** Piece 1 (the priced picker unreachable except via
`amicus key <provider>`): a new pure module, `src/utils/model-shortlist.js`, wraps
`buildProviderDefaultChoices` (`provider-default-picker.js`) — the same priced core this entry
names — and turns each vendor's rows into `{recommendedId, suggested, rest, total}`. Both setup
surfaces now reach it directly, no separate `amicus key` pass required: the GUI
(`electron/setup-ui-model.js`) adds a per-card `<select>` grouped `Suggested` / `All N models`,
and readline (`src/sidecar/setup.js`) adds a sub-prompt after the family pick (8 rows, `a` for
all, or paste any id). Piece 2 (the GUI Finish handler lacked readline's clobber guard):
`electron/setup-ui.js`'s Finish handler now writes every alias that got an explicit drill-down
pick, not only the checked default, and a Step-3 route edit on a non-selected alias still beats a
stale dropdown touch. Shipped in the same branch, not separately tracked pieces: the stale
`.model-resolved` label refreshes live on route/model change, `provider-default-picker.js`'s
docstrings no longer claim row ids are never fabricated, and the Settings window's Step 2 now
builds from the live on-disk catalog instead of a stale one. Verification: 554 suites / 8 skipped,
full pass (exact passed-test count omitted here -- it rotted twice already under later commits on
this same branch, same reasoning as `9278f7c0`'s drop of this paragraph's commit count; see
`npm test` for the current number) (up from the 551/7978/8 baseline at `2c2d20a0`);
`check-file-sizes.js --all`, `npm run lint`, and `check-citations.js --all` all clean. ⚠️ The real `<select>`-to-Finish path
has no Jest coverage (no jsdom in this repo, and `pickRouteFor` is an in-page closure) — it is
covered by CDP smoke only.
~~**Piece 3 remains OPEN, deferred to v4.9.0**
(`docs/superpowers/plans/2026-08-16-v48-phasing-and-rulings.md:769`). Its content is not defined
anywhere in the tracked tree beyond that deferral tag — searched this file and the phasing doc for
"Piece 3" and found only the bare name, no description to re-derive against. This branch does not
touch it.~~ **DROPPED as never-specified at the v4.9 kickoff (2026-08-25), on the T6.5/W1-3
precedent.** Exhaustive history check: `git log --all -S '#138 Piece'` returns exactly three
commits — `4ee46696` (the phasing doc, which defines Pieces 1+2 and names Piece 3 only in its
deferral line), `2ca728c1` (the #138 plan, which mentions Piece 3 only to ask whether it is
open), and `102302d4` (the v4.8.1 cut, which DELETED both docs — the `:769` citation above now
dangles; recover via `git show v4.8.0:docs/superpowers/plans/2026-08-16-v48-phasing-and-rulings.md`).
No commit in any branch or tag ever gave it content. If #138 has a real third ask it must be
re-filed fresh — there is nothing to inherit. (Pieces 1+2 shipped via PR #196, merge `3e3e29a0`;
issue #138 is closed.)

### Carried from the dropped v4.7.2 scope

- [x] **`sessions-index.json` growth.** — **SHIPPED v4.8 Wave 2.5 as `dda1b8cf` (PR #187,
  T-R16.1): doctor check `sessions-index-prune` + `--fix`, liveness-based per R16-2.** This
  carried checkbox was left unticked while the entry's own DONE records ticked — caught at the
  v4.9 kickoff (2026-08-25). Struck from the v4.9 carried list. Original filing: design already
  recommended in this file (doctor check +
  `--fix`, **liveness-based not age-based**). Impact measured, not theorized: 5.7 ms parse plus a
  0.69 MB write on **every session start** (`O(total sessions ever)` per launch), and
  `amicus list --all` at 8,275 ms → 53 ms after a prune.
- [ ] **W1-M4 — `amicus_start` spawn-fallback writes a raw briefing** (`mcp-server.js:669`). Fix
  shape known and proven (Task 7 shipped it for `amicus_fanout`); the work is driving the path end
  to end for a verified repro. Leaves a permanently-wrong `--search` corpus for a child that dies early.
- [ ] **Council runs in CLI `amicus list`** (ruling 5 + 6). `listCouncilRuns`
  (`mcp-council-awareness.js:205`) has no MCP-specific coupling.
- [ ] **The tight-file extraction pass** — see the refreshed table under *Next-rev hard gates*.
- [ ] **F-1** (MCP tool-parameter pinning; expects red) and **F-5** (`routing.tier` /
  `tier_onboarded`, a four-rev-old hole shipped in v3.2.0).
- [ ] **PR1F-2 / PR1F-3** — both explicitly silent drift with no live defect. PR1F-2 needs
  `buildRunStatsEntry` extracted to a **pure** module (`debate.js` is declared DI-free) and its real
  hazard is **key order** changing `run.json` bytes, which the order-insensitive pins would not
  catch. PR1F-3's proposed expression was found to be a **constant** (`res.ok` is always false at
  `run-stages.js:181`), so it needs a design call.
- [x] **KNOWN_VARIABLES single-source (T3-m2)** — ~~hard gate, but only bites when `{{input}}`
  lands~~ **DONE, v4.9 W1 (2026-08-25)** — see the ticked T3-m2 entry under *Next-rev hard gates*.

### Explicitly NOT in v4.8.0

- **#136 (easy bug reporting)** — explicitly a brainstorming placeholder. Its "three or more times"
  trigger implies recurring-error tracking that does not exist yet; it needs a design session before
  it can be scoped at all.

## v4.8 PR5a council fix-waves — owner rulings (2026-08-15)

Three adjudicated council rounds on [PR #159] (7 → 9 → 11 Confirmed). The findings are
answered on the PR; these are the ones the owner ruled OUT of PR5a, with why.

- [x] **Extract the seat-space pair out of `src/workspace/artifact-names.js`** — **its own PR,
  before PR5b** (ruling). The file is at **300/300** with zero headroom, and it was itself split
  out of `artifact-guard.js` for this same gate earlier in PR5a. Comment prose has now been
  shaved three times to land defect fixes, which is the tell. **Named seam:** `isSeatTable` +
  `orphanExonerations` move out (both are predicates over `run.seats` / `run.degrades` with no
  dependency on the name-derivation body); `artifactAllowlist` stays. Council-3's B4/B5 both
  landed inside `artifactAllowlist`, so no work is duplicated by doing this after them.
  ⚠️ Do NOT fold this into a defect PR — it is a restructure no council has reviewed.
  — done, [PR #160] (merge `ccb0551d`), shipped as `src/workspace/seat-space.js`. Exactly the
  named seam, moved byte-for-byte and re-exported, so no caller changed: `artifact-names.js`
  **300 → 222**, `seat-space.js` 113. Pinned by `tests/workspace/seat-space.test.js`, which
  asserts function **identity** (`toBe`) across all three import paths — a behavioural test
  cannot catch the re-implementation drift that produced council-1's B1, so identity is the
  property under test. ⚠️ **This is the pre-PR5b extraction, NOT PR5b itself** — the branch was
  named `v48-pr5b-seat-space-split`, which mis-labels it. PR5b (the live/DOM path) is still
  unstarted; see the plan's §0.3 split table.
  ⚠️ Its council verdict — "Ship it", 0/0/0/0 — was `stage1:PARTIAL` (3 seats, `inkling` n/a)
  **and** was the first run under the raised `diff_cap_bytes`, so it is not clean evidence that
  the cap fix worked. The next substantive PR reviewed at 240k is the real test.
- [ ] **Gate `review-claude.md` on a real producer marker** (council-2 B3 / council-3 A3, minor,
  rated *thin* both rounds; owner ruled HOLD + file). It is unconditional in `FIXED_ARTIFACTS`
  because `run.json` carries **no claude marker at all**: `claudeInCouncil` is set only on
  tally/verdict meta (`run-assemble.js:178`) and `claudeReviewFile` never leaves the in-memory
  options object (`run-state.js:129` writes a fixed four-key `options` projection). Gating it
  therefore needs a **producer** change — stamp a marker into `run.json` — which is why it is not
  a Workspace fix. Do it whenever Claude-in-council is next touched. Until then the entry is
  honest: the presence manifest already reports four fixed names absent on a normal run.

## v4.8 PR5b — owner ruling (2026-08-15)

- [x] **DONE (v4.8 PR5c) · ⚠️ SILENT DATA LOSS · The Workspace's dead-seat rows collapse, and
  can erase a dead seat entirely, on a bench that repeats an alias.**
  ✅ Closed on the bench path for records that name a seat. Six residuals remain, each pinned
  by a known-wrong test and listed in the CHANGELOG; two are filed separately below (R4 the
  critic path, R5 the live tick). ⚠️ Every line citation in the analysis below had ROTTED by
  the time the work started — `add()` was at `:192`, not `:177`; the suppression at `:249`,
  not `:234` — and `deadSeats` has since moved to `live-dead-seats.js` entirely. Read the
  entry for its reasoning, not its line numbers. Deferred out of PR5b by owner ruling so that PR
  stays renderer-only; **deferred on blast radius, NOT on severity**. Both measured at `ccb0551d`,
  not reasoned — probes and expected values are in
  `docs/superpowers/plans/2026-08-15-v48-pr5b-live-seat-path.md` §0.2, §0.3, §0.7.
  - **M3** — `deadSeats`' `add()` (`live-seats.js:177-185`) returns early on `seen[model]`, keyed
    on the alias. Measured: two `dead-leg` notes for one alias → **1** row out.
  - **M4** — its suppression (`live-seats.js:234-243`) builds `reviewing[alias]` from the live
    seats. Measured: one seat alive, its twin genuinely dead → **0** dead rows rendered. The dead
    seat produces no output anywhere in the panel. Per the product principle this rates as
    severely as a crash.
  - **Why it is not a pure renderer fix.** ⛔ **The table first filed here was WRONG on every row
    but one** — corrected 2026-08-15 by the PR5b round-2 council (finding C1, Confirmed) after
    tracing `run-retry-notes.js` against the two consumers instead of reading the emitters alone.
    A seat id is available on **exactly one of five emitter arms**:

    | emitter | channel | key the consumer sees |
    |---|---|---|
    | `retryLegStillDeadNote` (`run-retry-notes.js:67`) | `missing ? 'seat-unbound' : 'dead-leg'` | ✅ `data.firstFailure.seatId` — **`dead-leg` branch only** |
    | `missingLegStillDeadNote` (`:92`) | `missing ? 'seat-unbound' : 'dead-leg'` | ✅ same, same caveat |
    | `srcLegStillDeadNote` (`:51`) | `dead-leg` | ❌ no `firstFailure` → `data.seat`, an ALIAS |
    | `waveStillDeadNote` (`:28`) dead-wave arm | `dead-wave` | ❌ `data.models[]`, ALIASES |
    | `waveStillDeadNote` (`:28`) partial arm | `seat-unbound` | ❌ alias only |

    ⚠️ **THIS TABLE ROTTED AND ITS HEADLINE IS NOW FALSE — re-measured 2026-08-25 (v4.9
    kickoff), table rows left standing as the dated 2026-08-15 record.** PR5c shipped producer
    identity on two of the three ❌ rows: `srcLegStillDeadNote` (now
    `run-retry-notes.js :: srcLegStillDeadNote`) gained a `seatId` parameter emitted on
    `data.seatId`, and the dead-wave arm of `waveStillDeadNote` now emits `data.seats[]`
    index-parallel with `models` (`so ? so.id : null` — an unidentified slot emits null, never
    the alias). A seat id is therefore available on **four of five arms**; the only id-less arm
    left is the **seat-unbound partial arm**, whose omission is deliberate and commented
    (*"seat-unbound has no consumer"*) — and the seat OBJECT is already on the record it is
    built from (`stage1-bind.js :: missingSeatDeadWave` carries `seats: [m.seat]`), so the
    producer half of the v4.9 work is ~one line.
    ⚠️ **The ARM COUNT moved again 2026-08-26** (v4.9 W9 round-1 council fix wave, A1/C1): the
    skipped-retry note that lived inline in `run-stages.js`'s emit loop was lifted into this same
    module as `skippedWaveNote`, beside the partial arm it mirrors — so the table is **SIX of
    six**, and the new arm keeps the same scalar-`seatId` null discipline. Read "five of five"
    below as the dated 2026-08-25 record.
    ✅ **CLOSED 2026-08-25 (v4.9 W9 P1) — FIVE of five.** That partial arm now emits a SCALAR
    `data.seatId` (`((w.seats || [])[0] && (w.seats || [])[0].id) || null`; an unidentified slot
    emits `null`, never the alias — the dead-wave array's discipline, scalar because this arm
    names exactly one seat). `data.seat` stayed the ALIAS. The "no consumer" rationale is
    retired: it has three. Neither exact `toEqual` in `degrade-channels.test.js` moved, exactly
    as the recon predicted. The line numbers in the rows above have also
    all moved — anchor by symbol. ⚠️ Two caveats that SURVIVE for any consumer change:
    `firstFailure.seatId` can be ALIAS-valued on the inexact twin branch
    (`run-retry-group.js :: recordFailure`), and `seat-unbound` is a SHARED channel (orphan-leg
    notes carrying `data.legId`, and `reVoteUnboundNote`, ride it too) — never admit the
    channel raw; gate on the retry-family fields (`retryWaveId || firstFailure`).

    Both consumers filter to `dead-leg`/`dead-wave` (`live-dead-seats.js :: deadSeats`,
    `workspace-seats.js :: retriedSeats` — re-anchored BY SYMBOL at T-A8, 2026-08-17, having read
    the stale `live-seats.js:188` (out of range: that file is 125 lines) and `workspace-seats.js:61`
    (docblock prose; the filter is `:77`)), so **every `seat-unbound` record is invisible to this
    surface**. ⚠️ **NO LONGER TRUE as of v4.9 W9 (2026-08-25)**: both filters — plus
    `deriveSeatLoss` — now admit the channel GATED on the retry-family fields. Read this
    paragraph as the dated 2026-08-15/08-17 record of what was measured then.
    The `dead-leg` seatId evidence is real — `run-retry.test.js:628` shows
    `['deepseek#1','deepseek#2']` on a twin bench and `degrade-channels.test.js:126` shows a
    shipped degrade carrying `seatId` — but it covers one arm, not the family.
    `srcLegStillDeadNote`'s call site does have `unit`, carrying `unit.seats` (index-parallel with
    `unit.models`, pushed in lockstep at `run-retry-group.js :: recordFailure` —
    `if (trackModel) { unit.models.push(seat); unit.seats.push(seatObj); }`; this entry said
    `:33`, a docblock line, before the 2026-08-17 re-derivation) and
    `unit.firstFailures[].seatId`, so the id is
    reachable there — just not emitted. **Design the producer change against all five arms.**
  - ⚠️ **`data.seat` must stay the ALIAS.** `run-retry-notes.js:39-45` explains why
    (`verdict.js:72` compares it against `o.critic`). Add a key; never repurpose that one.
  - ⚠️ Note shapes are pinned by exact `toEqual` in `tests/council/degrade-channels.test.js`;
    `run-retry-notes.js:39-41` warns that adding a key unconditionally breaks them. Budget for
    fixture updates.
  - ⚠️ `workspace-seats.js:47`'s docblock claimed `retriedSeats` (then `retriedAliases`) mirrors
    `deadSeats`' predicate "EXACTLY, and must keep mirroring it". **PR5b shipped and changed one
    side**: the kind/channel filter still mirrors, the KEY no longer does. The docblock now says
    so. **Re-read it before changing the other side** — a mirror that stops mirroring is
    council-1 B1's defect class. When this item lands, restore the full mirror.
  - A **partial** fix (seat-key only where `firstFailure.seatId` exists) was considered and
    rejected: it leaves a silent erasure in place on one emitter while appearing to close the
    class. Either close it on every emitter or disclose the residual case explicitly.

- [x] **DONE (v4.8 PR5c Task 4) · The `dead-wave` arm of `retriedSeats` has no twin-bench
  test.** Covered at the intersection, paired with the distinct-alias case. The arm also now
  reads `data.seats[]`, so it badges precisely where the producer names the seats. Raised by the adjudicated
  council on [PR #162] as finding A2 (minor, glm, Confirmed a3/d0, solid) against a `Ship it`
  verdict, and filed rather than fixed in that PR — it is a coverage gap, not a defect.
  - **What exists:** `tests/workspace/workspace-seats.test.js` test (4) covers dead-wave on
    **distinct aliases**, and tests (9)–(11) cover twin benches on the **dead-leg** arm. Nothing
    sits at the intersection.
  - **Why it matters:** dead-wave is one of the four alias-only emitter arms the dual lookup
    (`retried[s.seat] || retried[s.model]`, `workspace-seats.js:188` — **was `:117`, long stale;
    this is the SAME expression cited in SI-DUP's Count-2 exclusions, and the two now agree**) exists to serve — it emits
    `data.models[]` with no `seat` and no `firstFailure` (`run-retry-notes.js:28-47`). On a twin
    bench it should badge **both** seats sharing the alias, which is the disclosed imprecision in
    the plan's §0.8 and in the CHANGELOG, and nothing currently pins that it does.
  - **Not unexercised, just unpinned at the intersection:** mutant M2 (dropping the `s.model` arm)
    reddened test (4) along with eight others, so the arm is load-bearing and guarded — but only
    on a distinct-alias bench.
  - **Shape of the test:** reuse the `paint(costRows, degrades, …)` helper in that file; two cost
    rows carrying `seat: 'deepseek#1'` / `'deepseek#2'`, one `dead-wave` degrade with
    `data: { models: ['deepseek'], retryWaveId: … }`, expect **2** badged. Pair it with the
    existing distinct-alias case so the asymmetry is visible in one place.
  - ⚠️ Do this **with** the dead-seat work above if that lands first — both touch the same
    keyspace, and a twin-bench dead-wave fixture is exactly what the M3/M4 fix needs anyway.

- [ ] **The seats panel and the artifact panels can disagree about which SPACE they are in,
  because they read the decision from two different documents.** Found while investigating PR5b's
  scope boundary (2026-08-15); reported at the time and, in an oversight, never filed until now.
  - `renderSeatsPanel` (`workspace-seats.js:113`; **was `:101`, stale before 2026-08-17**) keys its rows on `r.seat`, which arrives from
    **`tally.json`** via `derived.cost.rows` (`run-detail.js:73` reads `tally.runStats`).
  - `workspace-lazy.js:189` gates the three artifact panels on `derived.seatSpace`, which is
    `isSeatTable(run.seats)` — from **`run.json`** (`run-detail.js`, via `seat-space.js`).
  - Those are different documents and can disagree. A run whose `run.seats` is malformed
    (`seatTableRejected`) but whose `runStats[].seat` is intact renders the **seats panel in seat
    space and the artifact panels in alias space, simultaneously**. Nothing reconciles them.
  - **This is council-1 B1's defect class** — the one PR5a fixed by making `roster()` consume the
    same predicate as `artifactAllowlist` instead of spelling the question a second time. Here the
    two surfaces do not spell the question differently; they ask **different documents**, which is
    the same failure one level up.
  - **Reachability is low and should be stated honestly:** `run.seats` is producer-written, so a
    malformed table needs a hand-edited `run.json`. But that is exactly the case PR5a added the
    `seatTableRejected` banner for — the project already decided this shape is worth surfacing.
  - **Likely resolution is one line, not a redesign:** have the seats panel respect
    `derived.seatSpace` too, so a rejected seat table forces every surface into alias space
    together. Verify against the banner's own semantics before assuming that is right — the
    banner says the table was rejected, which may or may not mean the cost rows' seats are
    untrustworthy. **Measure which document is authoritative before choosing.**

## v4.8 PR5c — filed, not fixed (2026-08-15)

- [ ] **The dead-seat surface reconciles identity in the CONSUMER, which it structurally cannot
  do.** The durable finding from three code-council rounds, recorded because the instances are
  symptoms of it. `deadSeats` has no roster, so every attempt to decide "are these two records
  the same seat?" downstream has been inference: an alias-keyed dedup (the original defect), a
  per-alias budget (round-2 blocker), a roster pigeonhole (round-3 blocker). Each was rated a
  blocker, and each failed the same way — SILENTLY, by hiding a real dead seat.
  - PR5c's ruling was to stop inferring: dedup only on exact identity, announce otherwise, accept
    a visible duplicate. That is correct but it is containment, not a cure.
  - The cure is producer-side: emit unambiguous seat identity on every dead record, so no
    consumer ever has to guess. The two items below (R4's role vocabulary, R5's live payload) are
    the remaining places it is missing — they are not two odd jobs, they are the same job.
  - ⚠️ Blocker counts across the code rounds went 1 → 1 → 2. They did not converge, which is the
    documented "wrong lever" signature: the instances were being fixed, not the cause.

- [x] **DONE (v4.9 W9 Task A, 2026-08-25) · R4 · The dead-seat CRITIC path is still alias-keyed, and its role is inferred from the
  ALIAS.**
  ✅ Closed in `live-dead-seats.js :: deadSeats`, in the same commit as SI-02. Two halves, each
  with its own measured mutant: (a) a `roleOf(key, alias)` helper decides `'critic'` by SEAT
  identity — `key === runMeta.criticSeat` — whenever the record names a seat AND the run names
  a critic seat, keeping alias equality as the fallback (mutant ALIASROLE, red set 2); (b)
  `byRole` is written in BOTH keyspaces and read as `byRole[(s.seat || s.model) + '|critic']`,
  mirroring `reviewing` exactly (mutants BYROLEALIAS red 2, BYROLEUNSEATED red 1 — the write
  and the read are load-bearing in opposite directions). The filed shape — a dead bench twin
  beside a live critic twin — now renders ONE row labelled bench, where it rendered ZERO.
  ⚠️ The entry's "no producer emission closes this" holds: nothing new was emitted. What
  changed is that `run.criticSeat` — already on run.json since v4.8 (`run-state.js ::
  initCouncilRun` seeds it, `seats.js :: preflightSeats` supplies it) — is now THREADED into
  `runMeta` at both `workspace-seats.js` call sites. That was the missing wire, not a field.
  ⚠️ **Residual R-W9b:** on a document with no `criticSeat` the ROLE tag is still alias-inferred
  and can be wrong; the seat-keyed `byRole` lookup nonetheless keeps the row visible, so the
  silent-erasure half is gone on both paths. Pinned known-wrong in `dead-seat-twins.test.js`.
  ⚠️ **The verdict side was measured and deliberately NOT seat-keyed** (decision recorded in
  `verdict-seat-loss.js :: deriveSeatLoss`): `seats.js :: preflightSeats` REFUSES a critic alias
  occupying more than one bench seat, zero-spend, before any leg launches, so on every run
  `deriveSeatLoss` can see, `data.seat === critic` names exactly one seat and alias equality IS
  seat equality. Its only production caller is fed in-process records from that same run. The
  renderers differ because they read documents off DISK, where that refusal is not in force.
  Original analysis, retained: measured (`scratchpad/probe-critic-twin.js`, and independently raised by two council
  seats): on a bench where one alias holds both a critic seat and a bench seat, a dead BENCH twin
  beside a live CRITIC twin renders **0 rows** — the same silent erasure M4 was.
  - `deadSeats` tags a candidate `role: 'critic'` by **alias equality** with `run.critic`, so the
    tag lands on the wrong candidate *before* any lookup happens. Critic candidates then suppress
    through `byRole`, a different map from `reviewing`, which PR5c's fix never reaches.
  - **Seat-keying `byRole` is therefore NOT sufficient.** The role must derive from seat identity,
    which is producer-side vocabulary — ~~the same class of change as PR5c Task 1~~ **(false —
    struck 2026-08-16; see below)**.
  - Also measured: with both twins dead, two rows render and **both are labelled `critic`** on a
    bench with one critic seat.
  - Pinned as known-wrong in `tests/workspace/dead-seat-twins.test.js` (R4).
  - ⚠️ Negative result, recorded so it is not re-reported: the `alias + '|' + role` concatenation
    was probed for an injectivity collision on both reachable paths. **Neither fires.** Latent
    hazard, not a live defect.
  - ⚠️ **RE-FILED 2026-08-16 — hand-edit-only latent hazard, → v4.9 (ruling R5).** No producer
    emission closes this. Measured in both directions: with a keyed dead `deepseek#2` on the critic
    alias and a live critic-role leg for `deepseek#1`, `deadSeats` returns `[]` **both with and
    without** a `seat` field on the live row — the critic arm never reads `s.seat`.
  - **Nothing in v4.8 can cure it.** Its bench has no seat-identity critic answer: `criticSeat` is
    null there and `roleAt` calls both twins `'critic'`. The shape is unreachable by any run v4.8
    creates; reaching it needs a hand-edited artifact.
  - **R4 and R5 are NOT one job.** R5's payload change neither fixes nor worsens R4, and R4's fix
    touches no file R5 touches. R5 ships in v4.8 (ruling R7); R4 does not.

- [x] **DONE — and it was ALREADY DONE when this was re-read (v4.9 W9 Task A, 2026-08-25) ·
  R5 · The live tick cannot suppress a seat-keyed dead record, because the live payload
  carries no seat identity.**
  ⚠️ **The headline sentence was FALSE at the time of ticking, and had been since v4.8 R5.**
  `src/workspace/live-normalize.js :: seatOf` emits `seat: leg.seat || null` — its own comment
  names `live-dead-seats.js`'s `if (s.seat)` arm as the reason that line exists. This entry
  (and the T6 header in `dead-seat-twins.test.js` that quoted it) was describing work that had
  already shipped, and both read as a LIVE defect for a release. Re-derived and re-worded in
  W9; nothing in `deadSeats` or `appendDeadRows` had to change.
  - **Measured, by test, both directions:** a MODERN payload (`{..., seat: 'd#1'}`) DOES
    suppress a stale seat-keyed record live, and a genuinely dead twin beside a live one still
    renders. Both are new pins in `dead-seat-twins.test.js`'s T6 block.
  - **What survives as a residual:** a PRE-R5 payload — no `seat` key — still cannot be matched,
    so the stale record renders until the terminal refresh. That pin is kept, re-framed as the
    LEGACY-payload case it actually is rather than as the live path's behaviour.
  - The original analysis, retained for the record: `seatOf` emitted `{id: leg.taskId, model,
    modelInput, role, ...}` where `id` is a per-LEG task id; dead twins DO separate correctly on
    the live path (the candidates carry seat ids from PR5c Task 1); an earlier draft claimed
    "M3 and M4 persist live", which the council corrected (gpt C3, kimi D5); and closing it was
    thought to need a producer change to `council-legs.js` / `live-normalize.js` — which is
    exactly the change v4.8 R5 had already made.

- [ ] **Unidentified dead rows share a DOM `dataset.key`.** ⚠️ Note the *suppression* half of this
  shape was fixed in PR5c (an unnamed dead seat is no longer hidden by a live same-alias twin);
  only the DOM-key collision remains, and it has no measured symptom. Raised by the code council on
  [PR #164] as A1 (major). ⚠️ **Its stated consequence is wrong and was measured so**: A1 says the
  collision "causes the same row-accumulation class T3 fixes", but two unidentified dead twins
  painted across two ticks render `2 rows, keys ["dead:d","dead:d"]` — colliding keys, **no
  accumulation**. `renderSeats` removes leavers per ROW (`workspace-render.js:231`), and dead rows
  are appended fresh so the reuse path is never reached. This is the same wrong inference PR5c's
  own plan made about keyed twins.
  - Left unfixed deliberately: a row with no seat id has no natural distinct key, and every
    attempt to synthesise one in this PR (the NUL sentinel, the alias-keyed budget) became a
    defect. A positional key would work but changes the DOM key of every alias-only dead row —
    too wide for a latent hazard with no measured symptom.
  - Do it if the reuse path at `workspace-render.js:188` ever gains a consumer, which is the only
    thing that would turn this into a real defect.

- [x] **MERGED into SI-DUP (2026-08-16)** — ~~`seatKey` is spelled three times in `src/`.~~ The
  count was wrong: re-measured, the object-form rule was spelled **nine** times at merge, **now
  eight** (T2.1, 2026-08-16, `511cf43e` — see SI-DUP's Count 1), all in
  `src/council/` — and this entry's *"the renderer spells the same rule a fourth time as
  `r.seat || r.model`"* counted a member of a **disjoint** population as the fourth. See **SI-DUP**
  in the v4.8.0 seat-identity section for both populations with their counting rules stated. Still
  true and carried there: PR5c made the shared `seatKey` (`run-retry-group.js:52`, then `:29` after
  T2.2; **`run-retry-keys.js:15` since T-A1, 2026-08-17**) the exported copy so
  `run-retry.js` consumes it rather than keeping a fourth; the renderer must spell the rule again
  (`r.seat || r.model`) because renderer modules cannot `require()` from `src/`; and the "THE WRONG
  LEVER" reading — a rule needing another spelling means the defect is in a consumer. The "unify
  when next touched, **do not add a fourth**" guidance carries there as **disposition (b)** (→ v4.9,
  ruling R14).

### Standing note for the next reviewer of this area

Council-3's **C1** (waveId coupling) was disputed and, per owner ruling, **not** pinned: a change
to run-stage2.js's `${runId}-s2` wave-id format will silently stop `orphanExonerations` from
exonerating anything. That direction is **fail-safe** — it contests more, never less, so it
cannot cause misattribution — but it is a silent behaviour change with no test standing under it.

## v4.8.0 release cut — filed from the CHANGELOG audit (2026-08-23)

Four items surfaced while cutting `[Unreleased]` → `[4.8.0]`. None was in the cut's scope
(`CHANGELOG.md`, `src/headless.js`, `tests/no-output-backstop-wiring.test.js`, this file).
Each is a live statement in a **shipped** file — `package.json`'s `files` ships `src/`, `skills/`
and top-level `docs/*.md`.

- [x] **`src/sidecar/models.js :: fmtProbeLine` printed `(accepted but not serving)`.** —
  **FIXED, v4.9 W1 (2026-08-25):** the SILENT parenthetical now reads
  `(no output within the probe window)` — a classification statement, not an acceptance
  assertion — with the standalone pin updated and `docs/usage.md:406`'s verbatim example line
  co-edited in the same commit (it quotes the runtime string). Class-name uses of
  "accepted-but-silent" (`docs/configuration.md`, `no-output-backstop.js`'s comment) stand —
  they name the classification, which is unchanged. Original filing:
  Owner-ruled 2026-08-23 as a product nit, **not** a release blocker: `docs/usage.md:406` quotes the
  runtime string and adds the honest caveat beside it, and nothing in the changelog claims the CLI
  line was corrected. What is left is that the terminal line asserts endpoint acceptance while the
  doc row rebuts it, so the product and its own documentation disagree at the one surface a user
  actually reads.
  - **Owner:** whoever next touches `amicus models --check` output.
  - **Gate:** `tests/sidecar/models-command.test.js:497` pins the current string; changing it is a
    one-line edit plus that assertion. Do NOT change it inside a release cut.
  - **Measured 2026-08-23:** uncapped sweep of all 22 `accepted-but-silent` occurrences —
    `models.js:160` is the only remaining unqualified acceptance assertion in `src/`.

- [x] **`docs/ROADMAP.md:414` stated `AMICUS_NO_OUTPUT_BACKSTOP_MS`'s default as "~120s" in the
  present tense, under the live `### Other tracked items` heading — and listed as still-deferred a
  feature the same file records as SHIPPED (#99).** The default became `300000` this release
  (`src/utils/no-output-backstop.js :: DEFAULT_NO_OUTPUT_BACKSTOP_MS`), 600 s on a Stage-1 retry.
  `docs/*.md` ships in the npm tarball, so it reached every installed reader.
  ✅ **FIXED 2026-08-23** in the same PR (v4.8.0 release prep) — struck as shipped, with the live
  numbers. Found by the PR #191 council (A1, solid) after the release-prep implementer had already
  reported it and I ruled it out of scope; a false statement of a live default in a file that SHIPS
  should have widened the scope the moment it was reported.
  ⚠️ **This entry was itself FALSE for one commit, and that is the durable lesson.** It was filed in
  the present tense (*"still states"*) in the very commit that fixed the line it describes — caught
  by the next council as A1/C1, raised independently by two models. **A filing written in the
  present tense is falsified by fixing the thing it files.** Either file it BEFORE the fix and leave
  it unticked, or write it in the past tense and tick it in the same breath. See the same class
  already recorded at this file's *"An earlier draft stated 7 and 18 in the present tense in the
  very commit that…"* entry — twice now.
  - This is why v4.8.0's changelog no longer claims *"every place that stated the old value as a
    live fact was swept"* — that universal was false at HEAD for exactly this line. Fix the line,
    and the stronger sentence becomes available again.
  - **Gate:** none today. The sweep that produced this finding was
    `git grep -nE "240s|120s|240000|120000"`, uncapped, over the whole tree.

- [x] **The second-opinion skill's Stage-4 consensus headings glossed Confirmed as "(≥ 2 peer
  agreements, agrees dominate)"**, omitting the `a = 1, d = 0` case — **FIXED, v4.9 W1
  (2026-08-25):** both headings now read *"(≥ 2 peer agreements with agrees dominating — or a
  lone corroborating peer with zero disputes)"*; the entry's own gate was run — both phrasings
  re-grepped repo-wide, survivors are only the historical/frozen classes (this filing, the
  released CHANGELOG entry, the 2026-06-23 frozen spec, MODEL-NOTES incident narrations).
  ⚠️ The non-git runtime copy at `~/.claude/skills/second-opinion` carries the same two lines
  and still needs the same edit (machine-local; handled outside this repo). Original filing —
  anchors `skills/second-opinion/SKILL.md:285`
  and `skills/second-opinion/COUNCIL-DESIGN.md:113`. The formal cascade rows in both files were
  corrected in v4.8.0 (`c0a7c728`); that commit touched only the cascade table and two other
  bullets, so the *presentation* headings — the ones a Claude running the skill actually follows —
  still carry the old rule. A lone-corroborating-peer Confirmed finding will therefore still be
  presented outside the bulk-accept block.
  - **Gate:** `docs/council.md` carries no such gloss (grep: zero hits), so the correct anchor has
    no twin. Fix both headings together and re-grep the phrase repo-wide before claiming closure.

- [x] **`electron/setup-ui.js`'s `defaultAliasesJson` line re-materialised `Object.prototype` on the alias table.** — **FIXED, v4.9 W1 (2026-08-25):** the single embed site now seeds on the far side of the parse — `Object.assign(Object.create(null), ${defaultAliasesJson})` — so inherited names (`toString`, `constructor`) are unreachable through every bare-index reader of the page-level `var defaultAliases`. Pinned RED-before-GREEN by a vm-eval test (`tests/electron/setup-ui-proto.test.js`) named after the rule: *a null-prototype table cannot cross a serialization boundary and stay null-prototype*. Original filing — anchor on the variable name, not a line number (it was `:37` at v4.8.0 and drifted twice before the fix):
  `JSON.stringify(getDefaultAliases())` is re-embedded as a page literal, and the parser always
  gives the result a normal prototype, so the null-prototype seed this release added does not reach
  the Electron wizard. Traced and inert (`JSON.stringify` drops function values before the write,
  and `saveConfig` rejects `__proto__`) — see also `BACKLOG.md:5295`. v4.8.0's changelog scopes the
  "all are now seeded" claim to the config and resolution path because of this.

## v4.9 records — dispositions and rulings made in-cycle (2026-08-25)

Filed past-tense in the same commit as each fix, per the falsified-record rule.

- [ ] **`src/utils/engine-skew.js` sits at 300/300 lines after PR 201 round 3 (2026-08-26)** — the
  known `run-retry.js` hazard shape: the gate passes, so nothing warns, and the NEXT editor pays
  for a one-line change with an unplanned extraction under time pressure. Extract first, then
  edit. The seam already exists as precedent: `./engine-skew-records.js` (identity + record store)
  was split off in round 2, and round 3 split the sanitizer out to `./text-sanitize.js` — the
  remaining file is comparison, announcement and remedy text, of which the remedy/announcement
  strings are the natural next cut. (`engine-log-parse.js` was the other 300/300 file in that
  round and is back to 260 after the sanitizer move; it needs nothing.)

- [ ] **`auth-json.js` resolves with the same "first existing candidate wins" rule that
  PR 201's ROUND-1 A2 condemned in engine-log** (round 2 has an A2 of its own — the logfmt
  extractor firing on columnar lines — so the round is load-bearing in that reference)
  (filed 2026-08-26, W10 fix round — the round-1 fix
  commit's message claimed this filing one commit early; the edit's anchor missed on this
  branch and it lands here, miss disclosed). `src/utils/auth-json.js :: resolveAuthJsonPath`
  takes the first EXISTING candidate, so a stale `$XDG_DATA_HOME/opencode/auth.json` shadows
  the live `~/.local/share/opencode/auth.json` exactly the way a stale XDG log dir shadowed
  the live log tree — and engine-log's candidate list was explicitly modeled on this file.
  The A2 fix shape (union across dirs) may not transfer directly (auth is one document, not
  a newest-file search) — needs its own ruling on which candidate is authoritative when
  several exist.

- [ ] **`scripts/generate-docs-helpers.js` mis-renders the Key Modules registry repo-wide —
  three separate defects, MEASURED 2026-08-26** (filed in the PR 201 round-2 fix wave, where
  finding B8 hit all three on the two new modules; fixed AT THE SOURCE there for
  `engine-log`, `engine-log-parse`, `engine-skew` and `engine-skew-records`, and left
  unfixed everywhere else because the generator change is a whole-table regeneration).
  (1) `extractJSDocDescription` only matches a JSDoc block that is the FIRST thing in the
  file, so any module whose docblock sits below `'use strict';` gets an EMPTY Purpose cell —
  **127 of them**. (2) `collectModules` renders every export as `` `name()` ``, so a
  constant reads as a function — **124 occurrences**, e.g. `utils/degrade.js ::
  DEGRADE_CHANNELS`, `utils/engine-lock.js :: STALE_MS`, `utils/error-doc.js ::
  ERROR_CODES`. (3) `extractExports` caps at 5 with no marker, so **62 rows** silently omit
  real exports (`council/briefings-stage2.js` shows 5 of 15). The per-module workaround used
  in PR 201 — hoist the docblock above `'use strict'`, order `module.exports` so the five
  that matter come first, stop exporting internal constants — is not a fix for the other
  ~120 files. Needs a generator ruling: skip a directive prologue when locating the
  docblock, render constants without `()`, and either raise the cap or mark truncation.
  **The workaround has a floor, found 2026-08-26 (PR 201 round 3):** `utils/text-sanitize.js`
  exports exactly two names, so defect (2) renders `MAX_EXCERPT_CHARS()` with no way to hide
  it — ordering only helps a module with more than five exports, where the cap does the
  concealing. That row is a known-defect instance, not a fresh bug; it goes away with the
  generator ruling above, and inventing exports to pad past the cap is not a fix.

- **W5 ruling — a spec self-contradiction resolved: `intent` is emit-when-`'task'`
  EVERYWHERE.** The v4.8 design spec's §5.3 declares verdict-`intent` "mandatory" while its
  §7.5 promises byte-identical review-run `verdict.json`; both cannot hold. v4.9 W5 shipped
  the §7.5 side — `intent` appears on `run.json`, tally `meta`, and `verdict.json` only when
  `'task'`; absence means review and `'review'` is never materialized (the engine rejects an
  explicit `intent:'review'` option pre-spend, pinned). §5.3's rationale — renderers need a
  fork key on the verdict — is fully served by emit-when-task. Byte identity for review runs
  is pinned at the key level AND the byte level (`tests/council/run-intent.test.js`).
- **W5 size note: `src/council/run.js` hit exactly 300/300** with the intent validation +
  V12 block. Any W6+ edit to it needs an extraction or a same-line-count swap first — the W6
  briefing-write fork is designed as a dispatch-helper swap for exactly this reason.

- **The `tests/mcp-headless-e2e.integration.test.js` double failure — DECIDED: live-LLM flake,
  not a session leak; the standing "Jest did not exit" warning was a REAL, separate defect.**
  Measured (keyless rail + `--detectOpenHandles`): the failures cannot be a leak — fresh
  `mkdtempSync` dir and fresh server per run, `afterAll` closes on all paths — but the copied
  `createMcpClient` helper leaked timers deterministically in THREE suites (`request()`'s 10 s
  timeout never cleared on resolve; `close()`'s 3 s SIGKILL fallback never cleared), six open
  handles measured. Fixed in all three (`mcp-headless-e2e`, `mcp-protocol`,
  `shared-server-e2e`), re-measured at zero; `afterAll` now also aborts a still-running task on
  failure paths (bounded real-money leak), and the stale `--forceExit` comment was corrected —
  the live rail never had it. The gate is trustworthy; a live-tier failure is re-run variance
  on a real LLM unless a NEW mechanism is measured.
- **Council B2 (bare id offered under an empty vendor namespace goes gate-invalid when the key
  arrives later) — ruling V16: self-diagnose at the failure site.** `catalogGate`'s
  `model_not_found` on a `direct`-gateway bare id whose `openrouter/` twin classifies valid now
  carries the `repairFabricatedAlias` hint (`doctor --fix` is the remediation layer), mirroring
  the `localHint` precedent. Offer-under-`unknown` stays deliberate; revalidate-on-key-add is
  the filed follow-up, not built.
- **Council A4 (`directFormIfProven` TOCTOU via the two setup IPC fetches) — ruling V17: closed
  structurally.** The wizard's apply handler now consumes the SAME catalog snapshot the offer
  was built from (per-provider snapshot minted at the save-key build site), so the
  check-vs-use window is gone *within an offer session*; `directFormIfProven` and its A4 pin
  (`tests/model-canonicalization.test.js`) are byte-untouched, exactly as that pin's reasoning
  requires. ⚠️ Snapshot LIFETIME was re-ruled twice on PR 199 and the final shape is
  **offer-session** (2026-08-25): the council's B1/D2 (unbounded lifetime) was first answered
  with delete-on-first-read, which the fix-wave review's F1 showed re-opens the A4 race for
  every human pick (the wizard auto-applies on render, so the pick is always a later apply).
  Final semantics: applies read WITHOUT consuming; a re-offer overwrites the entry; setup-done
  clears the map. All four states pinned in
  `tests/electron/ipc-setup-catalog-snapshot.test.js`.
- **A task run with a missing/corrupt `verdict.json` labelled its fold and Workspace panels
  review-scale — FIXED** (filed as W8 wave review finding 3 2026-08-25; re-raised as PR 200
  council B2 and fixed the same day). `fold-format.js` and `run-detail.js`'s verdict panel read
  only `verdict.intent`; on the narrow leg where a task run exits 1 BEFORE the verdict write
  (the normal degraded ladder writes verdict.json WITH intent and is honest), the fold printed
  `VERDICT: none` and the panel defaulted review. Both now source it as `verdict.intent ||
  run.intent` — `run.json` checkpoints `intent: 'task'` (`run.js :: runCouncil`'s start
  checkpoint), and the run doc was already in scope at both sites (`verdictPanel`'s first
  parameter; `o.run` in `buildFoldText`, which `electron/ipc-workspace.js` fills from
  `detail.run`). Pinned in `tests/workspace/run-detail.test.js` (missing AND corrupt
  verdict.json → `intent:'task'`), `tests/workspace/fold-format.test.js` (`ANSWER: none` on both,
  plus a review absence control) and `tests/workspace/workspace-matrix.test.js` (the chip reads
  `no chair answer`). ⚠️ `src/council/report.js :: toModel` still reads `verdict.intent` alone and
  is deliberately UNCHANGED: it takes no run doc, and it cannot be wrong — it only ever runs on a
  verdict that exists, and both producers of one now carry intent (the engine via `meta.intent`,
  the Stage-5 rebuild via `opts.intent`).
- [ ] **Offer-session snapshots leak for a window destroyed without `setup-done`** (PR 199
  round-3 council B3, nit, filed as latent 2026-08-25). `electron/offer-session.js`'s map is
  reclaimed only by `endSession` (setup-done) or a same-key re-offer; a Settings window closed
  by the OS/user without finishing leaks one entry per provider it offered (bounded, tiny).
  The sender-less `endSession` wipe-all path is harness-only — real windows carry sender ids.
  Clean fix when wanted: a window-closed hook calling `endSession` for that sender.
- **`MAX_CATALOG_AGE_MS` mirror (doctor-alias-check vs cli-handlers-doctor)** — retired to one
  source: `model-catalog.js :: DEFAULT_MAX_AGE_MS` is now exported and both doctor files import
  it (the documented require-cycle was doctor↔alias-check; both-import-model-catalog is
  acyclic, measured). Three copies → one; no drift test needed.
- **Spec §10.6 REFUTED BY MEASUREMENT — `council tally` / `council verdict` on a task run work
  end to end; no `COUNCIL_INTENT_MISMATCH` guard was built (v4.9 W8 T-B).** The v4.8 design
  spec's §10.6 claimed both commands "have no valid input path and must fail with a named
  `COUNCIL_INTENT_MISMATCH`, not an ENOENT". Measured against the real CLI (`node
  bin/amicus.js`, `AMICUS_CONFIG_DIR` redirected to a scratch dir) on a task tally-input built
  from `tests/council/fixtures/av-receiver-input.js` with `meta.intent:'task'`: `council tally
  <input> --json` exited **0**, returned the full record with `meta.intent:"task"` and
  `tierCounts {Confirmed:29, Contested:2, Singleton:1, Disputed:3}`, and wrote **no**
  `council-ledger.jsonl` at all (the W5.4 gate-2 intent gate in `cli-handlers-council.js ::
  runTally`); `council verdict <tally.json> -o verdict.json --json` then exited **0** and
  emitted `intent:"task"` with `overallVerdict:"Converged"` — a CHAIR_ANSWERS phrase recovered
  from `chair-output.md` by `verdict.js :: readOverallVerdict`. ⚠️ The MECHANISM named here was
  corrected by PR 200's fix round (council B1/C2): this said "the both-scale fallback (the W7
  fix-round F2 change)", which no longer exists — `readOverallVerdict` now takes the run's
  `intent` and dispatches ONE parser through `parseChairTerminal`. The measurement's OUTCOME is
  unchanged and was re-verified: that fixture's tally carried `meta.intent:'task'`, which is the
  first of the three carriers the caller reads (round 3's council C3 added the prior
  verdict.json's own `intent` as the third), so the ANSWER scale is still selected and
  `"Converged"` is still recovered. The spec predates W5–W7 giving these paths an intent axis: the shipped
  design **carries** intent rather than refusing it, and a mismatch error would now break the
  exact flow this wave's renderers exist to serve. **Nothing built.** §10.6's `council validate`
  clause is unaffected — it stays mode-free by design, as written.
