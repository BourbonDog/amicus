---
title: F2 — Windows Green Suite (Design)
date: 2026-06-09
status: implemented (branch f2/windows-green-suite, 2026-06-09)
owner: BourbonDog
parent: 2026-06-07-amicus-product-design.md (§6 F2)
---

# F2 — Windows Green Suite

## 1. Summary

Make the test suite green on Windows by fixing the genuine cross-platform bugs and
quarantining the environment-specific test artifacts. Eight pre-existing failures, grouped by
root cause:

- **Two genuine Windows product bugs** (not just test noise):
  - the project-path encoder drops the drive-letter colon (`C:\…` → `C:-…` instead of `C--…`),
    so on Windows Amicus looks for Claude Code conversation history in an **illegal/wrong**
    directory — context lookup is silently broken;
  - the session-dir containment check compares a driveless `path.join` root against a
    drive-prefixed `path.resolve` result, so **valid task IDs are falsely rejected** as path
    traversal on Windows.
- **One Windows test-only assumption:** the key-store test asserts POSIX `0o600`, which NTFS
  ignores.
- **Two Electron-omitted artifacts:** two tests fail only because `electron` is intentionally
  omitted from the local dev install (`--omit=optional`); they pass where electron is present.
- **One off-theme failure (deferred):** a provider/model-alias sync test unrelated to Windows.

**Scope (decided):** "Green Windows suite" (Approach A — five minimal targeted fixes). The
Electron **GUI startup-hang** — the user-facing bug that forces `--no-ui` on Windows — is **out
of scope**: no test exercises it and it cannot be verified in an electron-omitted environment.
It is deferred to its own effort. The off-theme provider-sync failure is **skipped with a
documented `TODO(F4/F5)`**, so F2 ends with a genuinely green bar and the deferral is explicit
and tracked, not a silent hide.

**Baseline:** `8 failed → 0 failed` (5 fixed, 1 documented-skip, 2 electron artifacts neutralized).

## 2. Root-cause analysis (from the current code)

### 2.1 Drive-letter colon in the path encoder — *genuine bug* (e2e ×3)
`encodeProjectPath` (`src/session.js:23-26`) and the parallel encoder in `src/environment.js:64`
both use:

```js
return projectPath.replace(/[/\\_]/g, '-');   // replaces / \ _ — but NOT ':'
```

Real Claude Code encodes `C:\Users\sendt\OneDrive\SecondBrain` as
`C--Users-sendt-OneDrive-SecondBrain` (the drive colon **and** the separator both become `-`,
yielding `C--`). The current regex leaves the colon, producing `C:-Users-…`, which (a) is an
**illegal Windows directory name** and (b) never matches the real Claude Code session directory,
so conversation-history lookup fails on Windows. The e2e test helper (`tests/e2e.test.js:100`)
has the *same* defect with an even narrower class (`/[/\\]/g`, no `_`), so its `mkdirSync` of
`…\projects\C:-Users-…` throws `ENOENT` three times.

### 2.2 Session-dir containment check — *genuine bug* (mcp-server)
`safeSessionDirUnder` (`src/utils/validators.js:51-58`):

```js
const sessionsDir = path.join(project, '.claude', root);   // driveless on Windows: \tmp\project\…
const resolved   = path.resolve(sessionsDir, taskId);      // drive-prefixed: C:\tmp\project\…\taskId
if (!resolved.startsWith(sessionsDir + path.sep)) { throw … }   // C:\… never startsWith \… → false
```

`path.join` preserves the input's (driveless) form, but `path.resolve` makes it absolute and
**prepends the current drive**. On Windows the two strings therefore diverge at the very first
character, so the guard throws "path traversal detected" for the perfectly valid id
`abc-123_task` (test `safeSessionDir › allows valid task IDs`). On POSIX both are already
absolute, so the bug is invisible.

### 2.3 POSIX file-mode assertion — *Windows test-only* (api-key-store)
`tests/api-key-store.test.js:196-203` asserts `(stats.mode & 0o777) === 0o600` after `saveApiKey`.
The source writes `{ mode: 0o600 }` (`src/utils/api-key-store.js:189` and ~30 other call sites),
but NTFS does not honor POSIX permission bits — Node reports `0o666` (438). The *source* behavior
is correct/harmless on Windows; only the *assertion* is platform-specific. Real Windows ACL
hardening of the key file is a separate security concern, not part of this milestone.

### 2.4 Electron-omitted artifacts — *environment* (interactive, fold-nudge)
The local dev install omits `electron` (`npm install --omit=optional`; GUI is untestable here).

- `getElectronPath` (`src/sidecar/interactive.js:17`) `require('electron')`s and returns its path,
  or `null` when absent. The test `getElectronPath › returns the path from require("electron")…`
  (`tests/sidecar/interactive.test.js:43-53`) asserts a non-null path containing `Electron` — only
  satisfiable when electron is installed. (Its sibling, `returns null when electron is not
  installed`, already passes.)
- `tests/fold-nudge.test.js:10` calls `jest.mock('electron', factory)`. Jest must **resolve** the
  module name to register the mock; with electron absent the whole suite fails to load
  (`Cannot find module 'electron'`) before any `describe` runs. The test itself only needs a
  stub `{ app: { quit } }` — which it supplies — so once `electron` is *resolvable*, the test
  runs and passes on its own merits.

### 2.5 Provider/model-alias sync — *off-theme, deferred* (opencode-client-cowork)
`tests/opencode-client-cowork.test.js:146-157` expects
`buildServerOptions({}).config.provider.openrouter.models` to contain `x-ai/grok-4.1-fast` and
`anthropic/claude-opus-4.6`. `buildProviderModels` (`src/utils/config.js:268-287`) looks correct
in isolation — with the default aliases it produces exactly those keys — so the failure is a
subtle test-environment interaction (likely a config mock in the cowork test file), **not** a
quick fix, and it lives in the model-alias/catalog domain (F4/F5). It is unrelated to Windows or
Electron and is therefore deferred.

## 3. Design (Approach A — five minimal targeted fixes)

### F2a — Include the drive colon in the encoder *(§2.1)*
- Change both encoders to `replace(/[/\\:_]/g, '-')` (`src/session.js`, `src/environment.js`).
  This yields `C--Users-…`, matching real Claude Code. Unix paths (no colon) are unaffected, so
  POSIX behavior and existing assertions are unchanged. Fuller Claude-Code-encoding parity (other
  special characters) is **not** pursued — only the colon is broken/tested (YAGNI).

### F2b — Reuse the source encoder in the e2e helper *(§2.1)*
- Replace the hand-rolled `projectPath.replace(/[/\\]/g, '-')` in `tests/e2e.test.js:100` with a
  call to the exported `encodeProjectPath` from `src/session.js`, so the test exercises real
  behavior and the two encoders can never drift again.

### F2c — Resolve the root before the containment check *(§2.2)*
- In `safeSessionDirUnder`, resolve the root to an absolute path before comparing:
  `const sessionsDir = path.resolve(path.join(project, '.claude', root));`. Now both operands of
  `startsWith` share the same drive prefix and separator form. The traversal-rejection tests
  (`../../../etc`, `task/../../../etc`) still throw (the resolved escape path does not sit under
  the resolved root); the valid-id test passes on both platforms.

### F2d — Platform-guard the file-mode assertion *(§2.3)*
- Gate the `0o600` assertion in `tests/api-key-store.test.js` so it runs on POSIX and is skipped
  on `win32` (e.g. `const itPosix = process.platform === 'win32' ? it.skip : it;`). Leave all
  source `{ mode: 0o600 }` writes untouched (correct on POSIX, no-op on Windows). Add a one-line
  comment noting real Windows ACL hardening is a deferred security backlog item.

### F2e — Neutralize the Electron-omitted artifacts *(§2.4)*
- **fold-nudge:** make `electron` resolvable without installing it, so the test's own
  `jest.mock('electron', …)` registers and the suite runs/passes everywhere. Preferred mechanism:
  a minimal `tests/__mocks__/electron.js` (or a jest `moduleNameMapper` entry scoped to when the
  real package is absent). The exact jest wiring is settled in the plan; the constraint is: passes
  with electron omitted **and** does not shadow a real electron install in CI.
- **interactive/getElectronPath:** gate the "returns the real electron binary path" assertion
  behind electron availability (skip when `require.resolve('electron')` fails), keeping the
  already-passing "returns null when not installed" case. The behavior under test only exists when
  electron is present, so skipping-when-absent is correct, not a workaround.

### F2f — Defer the provider-sync failure *(§2.5)*
- Mark the failing cowork test `it.skip` with an inline `TODO(F4/F5): provider/alias sync …`
  comment referencing this spec. No source change. Tracked in §7.

## 4. Components / files touched

| File | Change |
| --- | --- |
| `src/session.js` | F2a: add `:` to the `encodeProjectPath` char class. |
| `src/environment.js` | F2a: add `:` to the parallel encoder. |
| `src/utils/validators.js` | F2c: `path.resolve` the sessions root before the containment check. |
| `tests/e2e.test.js` | F2b: use the exported `encodeProjectPath` in the mock-session helper. |
| `tests/api-key-store.test.js` | F2d: POSIX-only guard on the `0o600` assertion. |
| `tests/fold-nudge.test.js` + jest config / `tests/__mocks__/electron.js` | F2e: make `electron` resolvable so the mock registers. |
| `tests/sidecar/interactive.test.js` | F2e: skip the real-path assertion when electron is absent. |
| `tests/opencode-client-cowork.test.js` | F2f: `it.skip` + `TODO(F4/F5)` on the provider-sync case. |

No production behavior changes except F2a (a genuine Windows correctness fix) and F2c (a genuine
Windows correctness fix). Everything else is test-only.

## 5. Testing strategy

- **F2a/F2b (encoder):** the three `e2e` cases that currently `ENOENT` on `mkdir` must pass; add a
  focused unit assertion that `encodeProjectPath('C:\\Users\\x\\proj')` === `'C--Users-x-proj'`
  (regression for the colon). Confirm no existing test that asserts encoder output on Unix paths
  changes.
- **F2c (validator):** `safeSessionDir › allows valid task IDs` passes; the two traversal-rejection
  tests still throw. (Cross-platform — the resolve fix is correct on POSIX too.)
- **F2d (perms):** assertion runs on POSIX (CI Linux/macOS), skips on Windows; the rest of
  `api-key-store` is unchanged.
- **F2e (electron):** with electron omitted, `fold-nudge` loads and passes, and
  `interactive`'s real-path case skips; verify nothing shadows a real electron install (the mock
  applies only when the package is absent).
- **Whole-suite gate:** `npx jest` on Windows reports **0 failed** (1 documented skip). No new
  failures introduced anywhere. Re-run the previously-green suites to confirm the encoder/validator
  changes caused no collateral regressions.

## 6. Acceptance criteria

- `npx jest` on Windows is green: the 5 targeted failures pass, the 2 electron artifacts are
  neutralized, the 1 off-theme failure is an explicit documented skip.
- The encoder produces `C--Users-…` on Windows (verified by unit test), so Amicus resolves the
  correct Claude Code session directory and conversation-context lookup works on Windows.
- `safeSessionDir` accepts valid task IDs on Windows while still rejecting traversal on both
  platforms.
- The suite remains green where electron **is** installed (CI), i.e. the electron fixes don't
  regress the present-electron path.
- The provider-sync skip carries a `TODO(F4/F5)` pointer; no real cross-platform bug is hidden
  without a tracked follow-up.

## 7. Risks & open questions

- **Encoder collateral.** Adding `:` is safe for POSIX paths but could surprise any test asserting
  exact encoded output for a Windows-style input. Mitigation: grep for encoder-output assertions
  during implementation; the colon unit test pins the intended behavior.
- **Electron jest wiring.** A global `moduleNameMapper` for `electron` would shadow a real install
  in CI; the chosen mechanism must apply the stub **only when the real package is absent**
  (resolve-and-fallback, or a `__mocks__` shim that the test opts into). Resolve in the plan's
  first electron step.
- **Skip vs. hide (provider-sync).** Skipping a cross-platform failure to get a green bar is
  acceptable **only** because it is documented, off-theme, and explicitly owned by F4/F5. If F4/F5
  slips, the skip should be revisited rather than left indefinitely.
- **Windows key-store security (deferred).** Guarding the test does not secure the key file on
  Windows; real ACL hardening is a separate backlog item, noted at the call site.

## 8. Out of scope

- **The Electron GUI startup-hang on Windows** — the user-facing "always use `--no-ui`" bug. No
  test covers it and it cannot be verified in this electron-omitted environment; deferred to its
  own brainstorm → plan → execution.
- **F2.5/provider-sync fix**, **F3** (process lifecycle / alias correctness), **F4** (fan-out /
  JSON), **F5** (dynamic model catalog; audit `scripts/list-models.js` / `refresh-model-capabilities.js`).
  Each is its own spec.
- Real Windows ACL hardening of the API-key file; centralizing path logic into a shared
  cross-platform module (Approach B — overlaps F3).

## 9. Implementation notes (2026-06-09)

Executed subagent-driven (implementer + spec + code-quality review per task). Outcome: the
project's default test gate (`npm test` = unit suite; jest config excludes `*.integration.test.js`)
is **green on Windows — 0 failed**, 1616 passed, 5 skipped (the 3 intentional F2 skips + 2
pre-existing). Two deviations from the plan as written:

1. **Regression caught by the full run, then fixed (completes F2a).** `tests/environment.test.js`
   (`getSessionRoot › …code-local`) recomputed its expected path with the *old* encoder regex
   inline, so the F2a fix flipped it red. The brainstorming-time grep missed it because the test
   calls `getSessionRoot`, not `encodePath`, directly. Fixed by aligning the inline regex to
   `/[/\\:_]/g` (commit on branch). Lesson: run the **full** suite (not just `tests/`) when scoping.

2. **F2g folded in (user-approved).** A 9th pre-existing failure, `evals/tests/evaluator.test.js`
   `file_created`, surfaced only in the full run (it lives in `evals/tests/`, outside `tests/`).
   It is the same class of Windows path-separator bug: `findFilesRecursive` returned backslash
   paths so `file_created`'s forward-slash patterns never matched. Fixed by normalizing the leaf
   push to `/` (`rel.split(path.sep).join('/')`, a no-op on POSIX). On-theme, so folded into F2.

**Integration suite (out of scope, pre-existing — NOT F2 regressions).** Running the excluded
`*.integration.test.js` suite shows 3 failures, none caused by F2: `cli-handler` and
`cli-headless-e2e` reference `bin/sidecar.js`, which the **F6 rebrand renamed to `bin/amicus.js`**
(the helpers were never updated; the default gate excludes integration, so it went unnoticed);
`mcp-headless-e2e` is a **real-LLM e2e** that needs live API/server credentials unavailable here.
Tracked as a follow-up (integration-test maintenance / rebrand cleanup), not part of F2's
Windows-unit-suite scope.
