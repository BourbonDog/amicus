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
