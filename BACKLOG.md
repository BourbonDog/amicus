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
  production call site (`workspace-seats.js:47`), not two, and the live-tick path never goes
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
  there is exactly one production call site, `workspace-seats.js:47`); threading the retry set
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

- [ ] **`sessions-index.json` has no maintenance step — it only ever grows** — [M, needs a design
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
  `routing.tier_onboarded` (`src/utils/config.js:543–599`) are read by the cost-aware default
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
  (`run-retry.js:24`) and `roleFor` (`run-stages.js:34`) resolve a seat via `indexOf(alias)` —
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

- [ ] **[SHIPPED v4.8.0 PR5a — see the note below] Hard prerequisite for PR5 · `artifact-guard.js:87`'s `uniqueModels` must build from
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
  the only review file the Workspace shows.** `run-retry.js:193` calls `materializeReviews` purely
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

- [ ] **PR4 · `verdict.js`'s `deriveSeatLoss` (`:68`/`:71`) and both Workspace dead-seat
  renderers — `electron/workspace-ui/live-seats.js:188` and `workspace-seats.js:61` — gate on
  `dead-leg`/`dead-wave` and are blind to `seat-unbound`.** (`deriveSeatLoss`, not
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
  bench pays for two judge legs and clobbers one `judge-<alias>.md`.** Pre-existing, not
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
  `run-retry-group.js:49` stamps `seatId` onto every `firstFailure`, which rides `data.firstFailure`
  into `run.json`'s `degrades[]`. Like `deadWaves[].seats` it equals the alias on any unique-alias
  bench, so no shipped run's shape changes — but unlike that field it got no disclosure anywhere.
- The twin-bench "one seat bound, one not" case is only half pinned. The RETRY-loop half HAS a
  test — `run-stages.test.js`'s "CARRY (Task 6 minor): a twin bench retry with ONE seat bound and
  one not heals exactly one twin". The `run-stages.js` ABORT-branch half is the one still verified
  by hand-probe only, with no pinned test.
- A hypothetical `seats`-less dead-wave record would collapse twins to one row. Unreachable today
  — all four dead-wave producers carry `seats` — and consistent with the existing "two
  unidentifiable losses collapse to one" rule elsewhere, but worth a note if that ever changes.

**Size note:** `src/council/run-stages.js` is at 292/300 lines and `src/council/run-retry.js` at
290/300 — the next task touching either file must extract before adding, not squeeze in more.
(Re-measured at the PR3 cut: both unchanged. `run-debate.js` 260/300 and the new
`run-debate-revote.js` 168/300 after Task 1's extraction.)

#### Seat identity — PR3 handoff (2026-08-13)

PR3 carried the seat through Stage 2 and the debate round: `judge-<seat>.md`
(`run-stage2.js:145`), `judgeResults[].seat`, a seat-keyed Stage-2 conformance merge
(`run.js:224-228`), additive **emit-when-different** `adjudications[].seat`
(`run-assemble.js:166`) and `findings[].raiserSeat` (`anonymize.js:60`), and a debate round that
joins on the seat at every hop — `debateTargets` (`debate.js:201`), `disputingJudges`
(`debate.js:175`), `applyDebate` (`debate.js:81`), the re-vote repair id
(`run-debate-revote.js:139`) and all four launcher call sites, each projecting seat → alias
through the single `aliasOf` built at `run-debate.js:116-117`. `runRevoteWave` moved to
`src/council/run-debate-revote.js` (Task 1, byte-identical). What that unblocks, and what it
deliberately left alone:

- [ ] **PR4 · `tally.js:96`'s peer filter is now UNBLOCKED — both sides carry a seat.**
  `const peers = f.raiser ? votes.filter(v => v.judge !== f.raiser) : votes;` still compares
  aliases, so on a bench that repeats an alias a twin's legitimate peer vote on its twin's finding
  is dropped and the finding can tier `Singleton` on a full basis — #137's tally half. Before PR3
  the seat-exact form was not expressible inside `tally()`; it is now: every vote carries
  `v.seat` (`tally.js:89`, from `adjudications[].seat`) and every finding carries `f.raiserSeat`
  (`tally.js:106`), both emit-when-different, so the fix is `(v.seat || v.judge) !== (f.raiserSeat
  || f.raiser)` with **no new inputs threaded**. ⚠️ Both fields are absent on a unique-alias
  bench by design, so the `||` fallbacks are load-bearing — do not "simplify" them away.
- [ ] **PR4 · `src/council/debate.js:200` is a SECOND copy of that same filter and must move with
  it.** `peerVerdicts = (f.adjudications || []).filter(a => a.judge !== f.raiser)` builds the peer
  split a raiser sees in its defense briefing. Fixing `tally.js:96` alone would make the brief the
  models read disagree with the tally the chair reads. Deliberately left alias-space in PR3 for
  exactly that reason (the in-file comment at `debate.js:186-190` says so).
- [ ] **PR4 · `tally.js:58`'s `computeStreetCred` peer split (`if (judge !== m)`) is the third
  alias comparison** — `peersOnly` excludes every twin's rank of its twin. ⚠️ Do **not** fix this
  before the anonymize twin collapse: `assignLabels` (`anonymize.js:20-33`) gives two twin seats
  one `letterByModel` key (last wins) and `rankPositions` (`tally.js:32-42`) collapses them, so
  `rankings[].order` is already meaningless on a twin bench and street-cred computed from it
  cannot be made correct by editing `:58`. Seat-ify `assignLabels`/`rankingToOrder` first.
- [ ] **PR4 · the R8 `sameModelCorroboration` stamp (spec §4.6; R8 itself is in the §1 Owner
  rulings table) is still unwritten.** Spec
  §4.5 pairs it with the `tally.js:96` fix: once same-model seats count as each other's peers, the
  corroboration has to be *labelled* on the finding rather than silently folded into the basis.
  Listed in the spec's artifact table (`tally.json`, per finding, optional in schema) and in no
  shipped code.
- [ ] **PR4 · `meta.seats` is still absent from the tally input.** `buildTallyInput`'s meta
  (`run-assemble.js:154-159`) carries `models` and nothing that names a seat, so a consumer
  holding only `tally.json`/`verdict.json` cannot map `adjudications[].seat` back to a bench
  position — `run.json`'s `seats[]` (seeded `null` at `run-state.js:99`, filled by
  `preflightSeats`) is the only place the table exists. Every seat-aware renderer therefore has to
  read two documents.
- [ ] **PR4 · `verdict.json` carries `adjudications[].seat` but NOT `findings[].raiserSeat`, so a
  verdict-only consumer cannot tell which twin raised a finding.** `buildVerdict`
  (`src/council/verdict.js:113-127`) rebuilds every finding from an explicit field list — `id`,
  `raiser`, `severity`, `tier`, `basis`, `confidence`, `tierOverride`, `duplicateOf`,
  `adjudications`, `decision`, `applied`, plus `debate` when present. `adjudications` is passed by
  reference (`:121`), so PR3's per-vote `seat` survives; `raiserSeat` has no slot and is dropped.
  Measured on a twin bench: the tally finding carries `"raiserSeat":"deepseek#1"`, the verdict
  finding does not, while both carry `adjudications[0].seat === "deepseek#2"`. Every caller writes
  through `buildVerdict` (`run-assemble.js:223`, `cli-handlers-council.js:198`,
  `mcp-server.js:1452`), so there is no second path that could add it. **Not fixed in PR3** — the
  CHANGELOG describes what shipped, and threading it through is a code change PR3 did not make.
  Fix alongside `meta.seats` above: both are the same "the seat table stops before the summary
  document" gap.
- [ ] **PR4 · an `-rv` leg that binds to NO seat makes `applyDebate` invent an adjudication row —
  fix the JOIN, not the announcement.** `runRevoteWave` (`src/council/run-debate-revote.js:124`)
  falls back to `seatKey(null, alias)` for a leg `bindSeats` could not attribute, so `byJudge` is
  keyed on the bare alias. On a bench that repeats an alias every provisional adjudication is
  seat-attributed, so `applyDebate`'s `(a.seat || a.judge) === key` (`debate.js:81`) matches
  nothing, and the fail-open push at `:90` appends a NEW row instead of replacing one. **Measured**
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
- [ ] **PR4/PR5 · `src/workspace/matrix-model.js:47`, `:55`, `:74-81` performs the identical
  `meta.models × adjudications[].judge` join `report.js:38-40` does — and unlike `report.js` it
  was on no deferral list.** `judges` comes from `tally.meta.models` (`:47`), which on a twin
  bench holds the same alias twice; `votes[adj.judge] = adj.verdict` (`:55`) is last-wins, so both
  twin columns paint the same verdict; and `isRaiser: j === f.raiser` (`:80`) flags both twin
  columns as the raiser. The Workspace adjudication matrix is therefore wrong in the same three
  ways `report.html` is. Fix them together, keyed on `(adj.seat || adj.judge)` against a
  seat-valued column list — the data is already on the document as of PR3.
- Minor, noticed while re-deriving citations and **not** fixed: `src/council/seats.js:97` cites
  `run-retry.js:93` for "a retry wave is the loss subset"; the current anchor is `run-retry.js:67`
  (`groupStage1Losses`). Left alone rather than guessed at mid-PR.

#### PR3 post-review adjudication (2026-08-13)

PR3's auto-review and the paid council raised nine findings against the shipped diff. Eight are
filed here rather than fixed on this branch — each is either already disclosed above or latent and
unreachable from production. (The ninth was a real defect: `run-debate-revote.js`'s module docblock
had gone stale — Task 1's "verbatim, no behaviour change" claim stopped being true for
`runRevoteWave` at Task 6, which gave it seat binding. Fixed in place, comment-only.)

- [ ] **PR4 · a double-orphan collapses onto ONE conformance row in `run.js`'s Stage-2 merge.**
  `run.js:224`'s `const seatKey = (s, alias) => (s ? s.id : alias);` feeds
  `new Map(s2.judgeResults.map(j => [seatKey(j.seat, j.judge), j]))` (`run.js:225`). If BOTH twins'
  Stage-2 legs fail seat binding (`j.seat === null` for both), `seatKey(null, alias)` returns the
  same bare alias for both, the `Map` keeps whichever twin's entry was inserted second, and both
  `s1.reviews` rows fall through their `byJudge.get(r.seat ? r.seat.id : r.model) || byJudge.get(r.model)`
  lookup (`run.js:227`) onto that one surviving judge's conformance. **Latent, not reachable from
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
- [ ] **PR4 · `applyDebate`'s fail-open push writes a seat id into the alias-space `judge` field
  when `aliasOf` is absent.** `debate.js`'s fail-open branch (`const alias = aliasOf ? aliasOf(key) : key;`)
  falls back to the raw seat key when no `aliasOf` is supplied. Measured: without `aliasOf` the
  pushed row is `{judge: 'deepseek#1', ...}` and the tier moves Singleton → Confirmed (a seat id in
  `judge` reaches `tally.js`'s `v.judge !== f.raiser` and `report.js`'s `byJudge[adj.judge]`, both
  alias-space joins); with `aliasOf` supplied, the row is `{judge: 'deepseek', seat: 'deepseek#1'}`
  and the tier is correct. **Not reachable**: `grep -rn applyDebate src/` (excluding tests) finds
  exactly one non-test caller — `run-debate.js:202-203` — and it DOES pass `aliasOf` (the call site
  even carries a warning comment at `:198-201` explaining why). The package's `exports` map
  (`package.json:34-36`) publishes only `./opencode-client`, which blocks a deep
  `require('amicus/src/council/debate')` from outside the package, closing off the obvious
  alternate call path. Two conditions must BOTH hold for this to fire — a caller omitting `aliasOf`
  AND a repeated alias in the same wave — and no such caller exists today. File as a hardening note:
  consider making `aliasOf` a required parameter (throw if absent) rather than an optional one with
  a silently-wrong fallback.
- [ ] **A hardening note — nothing pins that the launcher must NOT de-duplicate `models`.** Owner
  ruling R3-2 (one re-vote leg per seat) depends on `['gpt', 'deepseek', 'deepseek']` producing
  THREE legs, not two. Verified end-to-end through the real `runFanout`: three legs actually spawn,
  and `fanout-validate.js:18`'s `parseModelsList` docblock says "duplicates allowed" (line 18, not
  20 — re-checked against the current file rather than assumed). Nothing enforces that contract
  going forward: a future `uniq()`/`new Set(...)` anywhere on the `--models` → leg-construction path
  would silently drop a twin's leg and break R3-2 with no error, no test failure outside this one
  area, and a plausible-looking diff. `tests/council/run-debate.test.js`'s
  `describe('runDebate — twin bench: joins on the seat, launches on the alias', ...)` (from
  `TWIN_BENCH = ['deepseek', 'deepseek', 'gpt']`, line 55) already pins the twin `-rv` shape at the
  `runDebate` level, so the invariant is exercised — just not named. Worth an explicit comment (or a
  dedicated unit test on `parseModelsList`) stating the invariant in one place: "duplicates must
  survive to leg construction."
- [ ] **A maintainability note (from the auto-review).** `seatKey(seat, alias) => seat ? seat.id : alias`
  (or the arrow-function equivalent) is independently redefined in **three files**:
  `run-debate-revote.js:56`, `run-retry.js:149`, `run.js:224` — re-derived directly, not assumed;
  note `run-stage2.js` does NOT redefine it (it takes seats a different way). Separately, §3.4's
  roster-placeholder-padding block (`const placeholders = new Set(); ... __unbound-${waveId}-${i+1} ...`)
  is duplicated near-verbatim in a **different** set of three files: `run-retry.js:118-130`,
  `run-stage2.js:89-106`, `run-debate-revote.js:106-117` — this time `run.js` is the one that does
  NOT carry it (it consumes `s2.judgeResults`, which already went through Stage-2's own padding).
  Both patterns are the safety-critical logic implicated in the double-orphan and fail-open findings
  above. Suggest consolidating into `src/council/seats.js`, which already owns `bindSeats`,
  `sanitizeName`, and `roleAt` — a natural home for both the join-key helper and the padding helper.
- [ ] **Function lengths** (auto-review minor): `runStage2` (`run-stage2.js:47-207`, 161 lines),
  `runDebate` (`run-debate.js:106-270`, 165 lines), and `runRevoteWave`
  (`run-debate-revote.js:76-166`, 91 lines) all exceed CLAUDE.md's 50-line-per-function guideline
  (`CLAUDE.md:793`; the limit is also named at `CLAUDE.md:705`). Nothing in CI enforces it —
  `scripts/check-file-sizes.js` is file-level only (300 lines/file; no per-function check exists
  anywhere in the gate). File as a follow-up, noting the seat/placeholder-roster logic inside all
  three is the same safety-critical logic named above, which is what makes them worth splitting
  rather than just noting.

#### Filed by PR4b — ledger grouping (2026-08-13)

Three items PR4b deliberately did NOT fix. All three citations were re-derived from the source at
`c1c3a5ee`, not inherited from the plan.

- [ ] **Chair-on-bench has no engine-side guard, and PR4b made its consequence observable.** The
  guard exists in three places and `src/council/` is not one of them:
  `src/cli-handlers-council-run.js:137`, `src/mcp-council-run.js:114`, and
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
- [ ] **Findings are attributed by ALIAS, not by seat.** ⚠️ **This item was filed "→ PR4c" and PR4c
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
- [ ] **A never-ran aggregate stays chair-promotable, and PR4b makes it a standalone one.** Street
  cred is alias-level and PR4b deliberately did NOT concentrate it (concentration was measured to
  flip the launched name from the short alias to the raw executable id, the exact failure
  `src/council/run-chair.js:48-52` argues against). So on a mixed live/dead twin, the leg-less
  group keeps a numeric street cred borrowed from its live twin while carrying zero findings, and
  `pickFallbackChair` can rank it above the executable it routes to. The borrowed cred is
  **pre-existing** — today it is merged into one group — but PR4b splits it out as its own
  promotable aggregate with its own permanent `legacy` line in `council stats`. Do not invent a
  rule here: the real fix is seat-attributed street cred, which belongs with the item above.

#### Filed by PR4c — the seat spine (2026-08-14)

Everything PR4c deliberately did NOT fix, with the measurement that establishes it. Every citation
below was re-derived from the source at the end of PR4c, not inherited from the plan — the plan's
own numbers for two of these were stale (`ledger.js:104` had moved to `:106`, and
`classifyCouncilMembers` is in `src/utils/config.js`, not `src/config.js`).

- [ ] **Street cred collapses twins, three ways, and PR4c left all three (ruling R4c-2).** Measured
  on bench `['a','a','b']`: (1) `rankPositions` (`src/council/tally.js:32-42`) keys its map by
  MODEL — `pos.set(m, meanPos)` at `:38` — so on `order ["a","a","b"]` the first twin's position 1
  is **overwritten**, not averaged, yielding `{a:2, b:3}`. (2) `computeStreetCred`
  (`src/council/tally.js:49-67`) maps over `meta.models` at `:51`, which is still `['a','a','b']`, so the
  record carries **two byte-identical `streetCred` rows**, and both reach the user — the Markdown
  street-cred table at `src/council/report.js:181` and the HTML one at
  `src/council/report-html.js:49`. (3) The ledger's
  join `new Map(streetCred.map(s => [s.model, s]))` (`src/council/ledger.js:106`) is **last-wins**
  into an append-only file. R4c-2 re-confirmed R4-3 on this evidence: fixing (3) alone was measured
  to flip the launched chair name from the short alias to the raw executable id, so this needs to be
  taken as one seat-keyed change, in its own PR, not piecemeal.
- [ ] **`lens` and `position` are unrecoverable from the tally artifacts on any bench that does not
  repeat an alias (R4c-7).** `meta.seats` is emitted only when the bench repeats an alias, which is
  a **different question** from "does anything else in the document carry the seat's lens". Measured
  on `bench=['a','b'] lenses=['Security Review','perf']`: `meta.seats` is **absent**,
  `runStats[].role` carries only the slug `lens:security-review`, and the raw lens text
  `"Security Review"` appears **nowhere** in the tally input. `position` is unrecoverable on every
  bench. R4c-1's original justification for the table was *"`role`, `lens` and `position` appear
  nowhere else"*; that reason is **withdrawn** — the honest claim is "seat ids are resolvable on
  twin benches, and only there". The owner chose byte-identity on lens/critic benches (measured
  identical across eight configurations) over a table PR5 can ask for when it needs one. Revisit
  when a consumer actually needs `lens`/`position`, and widen the predicate then.
- [ ] **Five seat shapes the #137 peer fix does not close.** All measured, all disclosed in the
  CHANGELOG rather than hidden:
  1. **The raiser's own Stage-1 leg orphans** — `findings[].raiserSeat` and that seat's vote-seat
     vanish *together*, the filter falls back to the alias compare, and the undercount survives.
  2. **A peer twin's leg orphans** — the fallback drops that twin's legitimate agree, and the
     `sameModelCorroboration` stamp does not fire either, so the corroboration is silently absent
     rather than merely unlabelled. This one is a **deliberate safe-drop**: a seat-less `deepseek`
     vote cannot be told apart from the raiser's own.
  3. **Two orphaned twin seats collapse to ONE dead-seat row carrying no seat.** `deadSeats`
     (`src/council/run-stage1-rows.js:76-89`) is a **Map** whose key falls back to the alias when
     `seatOf.get(l)` is null, so two dead twins produce one entry. Measured through the real
     `pushDeadSeatRows` + real `bindSeats`: two orphaned twin legs ⇒ `[{"model":"deepseek",
     "role":"seat"}]` — one row, no seat, for two paid seats. Pre-existing; PR4c's stamp is simply
     inert there.
  4. **A `--council` preset with a whitespace-padded member is functionally a twin bench that
     `buildSeats` treats as two distinct aliases.** `classifyCouncilMembers`
     (`src/utils/config.js:438-460`) pushes `member` **raw** where `parseModelsList` would trim, and
     `buildSeats` (`src/council/seats.js:67`) mints `alias#N` only when `counts.get(alias) > 1` — so
     `['openai/gpt-5 ','openai/gpt-5']` is two aliases, not one. Measured with both seats agreeing on
     both findings: `basis {a:0,d:0,n:0} Singleton` — **the undercount survives in full, silently.**
     The fix is upstream (trim at classification), not in the peer filter.
  5. **A judge whose Stage-2 seat orphaned has its vote counted in `basis` but rendered NOWHERE**
     in the seat-keyed matrix — it keys to a bare alias no column reads. HEAD at least rendered it
     via alias last-wins. NEW with PR4c's matrix re-key, pinned as disclosed behaviour in
     `tests/council/seat-matrix.test.js` rather than left to be discovered. A sixth, related shape
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
- [ ] **`VERDICTS[v.verdict]` resolves INHERITED keys.** `src/council/tally.js:114-115` claims
  unknown verdict strings are skipped so a stray value cannot corrupt the basis — but `VERDICTS`
  (`:71`) is a plain object literal, so `verdict: 'toString'` resolves through the prototype chain
  and `basis["function toString() { [native code] }"] = NaN`, serialized as `null` in both
  `tally.json` and `verdict.json`. Reachable on the schema-free CLI path. Pre-existing, and PR4c's
  `sameModelCorroboration` stamp (`:141`) reads the **same expression**, so it inherits the hole. The
  fix is an `Object.prototype.hasOwnProperty.call(VERDICTS, v.verdict)` guard at both sites — cheap,
  but it changes `basis` on a document that currently produces a `null`, so it needs a decision
  about whether that is a fix or a shape change.
- [ ] **The chair packet is assembled entirely in alias space, so on a twin bench it is internally
  unreconcilable.** `buildChairPacketFile` (`src/council/run-assemble.js:263-277`) passes the chair
  only `reviews`, `rankings`, `adjudications` and `record.tierCounts` (`:266-273`);
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
- [ ] **`letterByModel` is dead code that looks live, and it collapses twins.**
  `src/council/anonymize.js` declares it in `assignLabels`' JSDoc (`:18`), builds it (`:28`),
  populates it keyed by MODEL (`:31`) and returns it (`:33`) — and it has **no production consumer
  anywhere in `src/`**; the only reader is `tests/council/anonymize.test.js`. On a twin bench
  `letterByModel` keeps one letter per alias, so anyone who reaches for it gets a silent collapse.
  ⚠️ **`labelMap` is NOT the collapsing map** — a prior review claimed it was; measured,
  `assignLabels(['a','a','b'])` yields `{"Review A":"a","Review B":"a","Review C":"b"}`, whose keys
  are labels and are unique by construction. Delete `letterByModel`, or give it a seat key before
  something starts using it.
- [ ] **The roster-padding block is duplicated three times, and the prior refusal was INVERTED.**
  `src/council/run-retry.js:121-131`, `src/council/run-stage2.js:91-107` and
  `src/council/run-debate-revote.js:115-126` each build the same `__unbound-<waveId>-<n>` placeholder
  roster before `bindSeats` and then filter the placeholders back out — ~11 lines apiece, and all
  three already `require('./seats')`, so the consolidation costs no new dependency. ⚠️ The v4.8 PR4
  draft refused this as *"a near-copy, not a win"* while **endorsing** a `seatKey` consolidation;
  measured, that is exactly backwards. `seatKey` is net-flat: `run.js:228` and `run-retry.js:149` are
  byte-identical (54 B) but `run.js`'s copy has exactly **one** caller (`:229`);
  `run-debate-revote.js:64` is a *different* form — a named `function seatKey(seat, alias)` with
  different parameter names — and also has one caller (`:132`); and `run.js:231` is a **third,
  hand-inlined** copy that must stay, because its `|| byJudge.get(r.model)` fallback is load-bearing
  (an orphaned Stage-2 leg's conformance becomes unreachable without it). Only `run-retry.js`'s copy
  earns its keep, with five call sites (`:152`, `:163`, `:180`, `:196`, `:201`). Recorded so the
  wrong endorsement is not re-inherited. Still
  **not** urgent; it is a tidy-up, not a defect.

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
- ⚠️ Related, from #129's own side observation: `curated-models.js:112` ships
  `kimi → openrouter/moonshotai/kimi-k2.6` while a local config override repoints it to `kimi-k3`.
  Per-model operating notes keyed on an alias can therefore describe a different model than the
  alias now resolves to. Surface the resolved target in run artifacts, or warn when a local override
  shadows a curated alias.

### Quote the real engine error — #133 root fix

v4.7.1 only softens the wording; this replaces the guess with the truth. When a leg dies, read the
session's line from `~/.local/share/opencode/log/opencode.log` and surface it. In the #133 outage the
actual cause — `SQLiteError: no such column: replacement_seq` — sat in that file the entire 30
minutes, appearing at the exact timestamp of every failed MCP session and never for the CLI sessions
succeeding in the same window. Needs log-path resolution, session correlation, and a clean fallback
when no line exists.

### Setup polish — #138

Smaller than it reads: a two-level-picker gap, not a missing feature. The main `setup` path
(`setup.js:444`) offers quick-picks keyed by **family alias** (`deepseek → routes.openrouter`) with
no model-level choice — but a per-provider picker with priced, context-annotated rows **already
exists** (`provider-default-prompt.js` / `provider-default-picker.js`); it only runs after
`amicus key <provider>` saves a key. And `resolveChoice` already accepts *"any full model id"*, so
the capability is there but undiscoverable from the list. Add the family → model second level,
reusing the existing priced picker.

### Carried from the dropped v4.7.2 scope

- [ ] **`sessions-index.json` growth.** Design already recommended in this file (doctor check +
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
- [ ] **KNOWN_VARIABLES single-source (T3-m2)** — hard gate, but only bites when `{{input}}` lands.

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

- [ ] **⚠️ SILENT DATA LOSS · The Workspace's dead-seat rows collapse, and can erase a dead seat
  entirely, on a bench that repeats an alias.** Deferred out of PR5b by owner ruling so that PR
  stays renderer-only; **deferred on blast radius, NOT on severity**. Both measured at `ccb0551d`,
  not reasoned — probes and expected values are in
  `docs/superpowers/plans/2026-08-15-v48-pr5b-live-seat-path.md` §0.2, §0.3, §0.7.
  - **M3** — `deadSeats`' `add()` (`live-seats.js:177-185`) returns early on `seen[model]`, keyed
    on the alias. Measured: two `dead-leg` notes for one alias → **1** row out.
  - **M4** — its suppression (`live-seats.js:234-243`) builds `reviewing[alias]` from the live
    seats. Measured: one seat alive, its twin genuinely dead → **0** dead rows rendered. The dead
    seat produces no output anywhere in the panel. Per the product principle this rates as
    severely as a crash.
  - **Why it is not a pure renderer fix:** the seat id reaches the renderer as
    `data.firstFailure.seatId` for `retryLegStillDeadNote` (`run-retry-notes.js:67`) and
    `missingLegStillDeadNote` (`:92`) — evidenced by `run-retry.test.js:628`
    (`['deepseek#1','deepseek#2']` on a twin bench) and `degrade-channels.test.js:126` (a shipped
    degrade carrying `seatId`). But **`srcLegStillDeadNote` (`:51`) emits no `firstFailure` at
    all**, so it needs a producer change. Its call site does have `unit`, which carries
    `unit.seats` (index-parallel with `unit.models`, `run-retry-group.js:33`) and
    `unit.firstFailures[].seatId` — the id is reachable, just not emitted.
  - ⚠️ **`data.seat` must stay the ALIAS.** `run-retry-notes.js:39-45` explains why
    (`verdict.js:72` compares it against `o.critic`). Add a key; never repurpose that one.
  - ⚠️ Note shapes are pinned by exact `toEqual` in `tests/council/degrade-channels.test.js`;
    `run-retry-notes.js:39-41` warns that adding a key unconditionally breaks them. Budget for
    fixture updates.
  - ⚠️ `workspace-seats.js:47`'s docblock claims `retriedAliases` mirrors `deadSeats`' predicate
    "EXACTLY, and must keep mirroring it". PR5b Task 3 changes one side. **Re-read that comment
    before changing the other** — a mirror that stops mirroring is council-1 B1's defect class.
  - A **partial** fix (seat-key only where `firstFailure.seatId` exists) was considered and
    rejected: it leaves a silent erasure in place on one emitter while appearing to close the
    class. Either close it on every emitter or disclose the residual case explicitly.

### Standing note for the next reviewer of this area

Council-3's **C1** (waveId coupling) was disputed and, per owner ruling, **not** pinned: a change
to run-stage2.js's `${runId}-s2` wave-id format will silently stop `orphanExonerations` from
exonerating anything. That direction is **fail-safe** — it contests more, never less, so it
cannot cause misattribution — but it is a silent behaviour change with no test standing under it.
