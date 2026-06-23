# WS-1 — Reliability Foundation Design

**Date:** 2026-06-23
**Status:** Approved

## Context

Second of five workstreams in the Amicus post-v1.1.0 enhancement program
(WS-0 polish ✅ → **WS-1 reliability foundation** → WS-2 schema & cost spine →
WS-3 council trust spine → WS-4 surfaces & adoption). WS-1 makes the engine's
terminal state trustworthy and enforces the quality gates that today are
bypassable local hooks. It is sequenced early because every later workstream —
the council, fanout cost telemetry, the CLI — trusts exit code + `metadata.status`
as the single source of truth, and because real CI makes all subsequent work
enforceable.

Source: the 2026-06-23 improvement audit (#3 finalize, #13 teardown tests,
#14 active watchdog, #4 CI) plus a fresh code map of `main` @ `e569521`. All
file:line refs below were verified against current code; verify again before
implementing — line numbers shift.

## Goals

1. Make every headless termination write a **correct, definitive** `metadata.status`
   and a matching exit code before the process ends.
2. Replace the two source-grep "watchdog" tests with **behavioral** tests that
   exercise the real teardown callsites.
3. Stop the interactive watchdog from killing an **actively-used** GUI session,
   and close its startup-window teardown race.
4. Stand up **CI** that runs the unit suite + quality gates on push/PR and gates
   `publish.yml`, so a red suite can never reach npm.

## Non-Goals

- **Integration/e2e tests stay out of the blocking gate.** They are already
  excluded from `npm test` (`jest.config.js` `testPathIgnorePatterns`) and noted
  broken until a separate fix lands. CI runs `npm test` (the stable ~1934-test
  unit suite), not `test:all`. Root-causing the jest-worker flake (which lives in
  the excluded `*.integration.test.js` electron-CDP / real-LLM suites) is NOT in
  scope.
- No branch-protection rules (a repo-admin toggle, left to the owner).
- No rewrite of the `runHeadless` poll loop or the OpenCode client.

## Design

### Unit 1 — Terminal-state correctness (#3)

**Problem (three confirmed bugs):**
1. **Idle backstop** (`src/headless.js` ~189–197): the idle-watchdog `onTimeout`
   calls `server.close()` then `process.exit(0)` while `metadata.status` is still
   `'running'` and no `summary.md` is written. Exit code 0 = a false success any
   exit-code-trusting consumer believes; the orphan is only reclassified if
   someone later runs `amicus_status`.
2. **Timed-out → complete** (`src/sidecar/start.js` ~221–229): `start.js` branches
   only on `result.error`. A timed-out run (`result.timedOut === true`, no error)
   flows to `finalizeSession()` (`session-utils.js:91,94`), which unconditionally
   writes `status: 'complete'`.
3. **Externally-aborted → complete** (same `start.js` branch): an externally
   aborted run (`result.aborted === true`, no error) likewise gets rewritten to
   `'complete'`, overwriting the `'aborted'` an external actor set.

**Design — single source of truth for terminal state.** A new focused module
`src/sidecar/session-finalize.js` exporting two functions:

- `resolveTerminalState(result) → { status, exitCode }` — pure mapping from a
  `runHeadless` result (`{ completed, timedOut, aborted, error }`) to the canonical
  status + exit code. Taxonomy (aligned with the existing fanout convention):

  | Outcome | status | exitCode |
  |--------|--------|----------|
  | completed | `complete` | 0 |
  | error (poll-failure bail, exceptions, create/start failures) | `error` | 1 |
  | timed-out (explicit deadline OR idle backstop) | `timed-out` | 2 |
  | aborted (external metadata abort) | `aborted` | 2 |
  | aborted by signal | `aborted` | 130 (SIGINT) / 143 (SIGTERM/SIGBREAK) |

  `start.js` calls this instead of its `result.error`-only branch, so timed-out and
  aborted runs are classified correctly and `finalizeSession()` is no longer called
  on them.

- `markTerminal(sessionDir, status, detail) → void` — synchronous metadata write
  for the **hard-exit** paths that bypass `start.js` (the idle backstop). A
  generalization of the existing `markAborted` (`src/sidecar/session-abort.js:21-31`);
  `markAborted` becomes a thin wrapper (`markTerminal(dir, 'aborted', signal)`) to
  preserve the signal path unchanged.

  The idle-backstop callback stops calling `process.exit(0)`-with-`running`; it
  instead `markTerminal(dir, 'timed-out', 'idle backstop')`, writes a stub
  `summary.md` ("session timed out — idle backstop"), then `process.exit(2)`.

*Approaches considered:* (A) the helper pair above — **chosen**; (B) fix only the
idle-backstop exit-0 bug — rejected (leaves bugs 2 & 3); (C) move all `process.exit`
ownership into `runHeadless` — rejected (inverts the deliberate `start.js`-owns-the-
process-lifecycle boundary; high regression risk). Extracting these helpers also
*shrinks* the grandfathered 742-line `headless.js`.

**Coupling risk:** existing tests may assert the buggy behavior (a timed-out or
aborted run reported `complete`, or the idle backstop exiting 0). Those are updated
in the same task that changes the source (the WS-0 pattern).

### Unit 2 — Behavioral teardown tests (#13)

Replace the two pure source-grep tests (`tests/headless-watchdog.test.js` and
`tests/interactive-watchdog.test.js`, confirmed to be `readFileSync(...).toContain(...)`)
with fake-timer behavioral tests that drive the **real** callsites. Mocking
discipline (the audit's warning — fake-timer teardown tests are flaky if they touch
real exit/spawn):

- `process.exit` → spy (never actually exits).
- `electronProcess` → a fake `EventEmitter` with a `kill` spy.
- `server.close` → spy; `markTerminal`/fs writes → asserted via a temp session dir or spy.
- `jest.useFakeTimers()` drives the `IdleWatchdog` (confirmed fake-timer-compatible;
  `tests/idle-watchdog.test.js` already uses this).

Assertions:
- Idle backstop fires → `markTerminal` wrote `timed-out` and `process.exit(2)` was
  called (never 0, never leaving `running`).
- `resolveTerminalState` pinned for every outcome (complete/error/timed-out/aborted/signal).
- Interactive watchdog fires → `electronProcess.kill('SIGTERM')` called.
- (with Unit 3) an actively-used session → watchdog `touch`ed → **not** killed.

Existing good behavioral coverage (`idle-watchdog.test.js`, `headless-poll-failures.test.js`,
`headless.test.js`) stays; this fills the teardown-callsite gap they don't cover.

### Unit 3 — Active-session watchdog (#14)

**Problem (`src/sidecar/interactive.js`):** (a) `watchdog.touch()` is called ONLY in
`electronProcess.stdout.on('data')` (~187–189), so a quiet-but-active GUI session
(user typing, model streaming over HTTP) isn't kept alive and gets SIGTERM'd at the
60-min idle mark; (b) the real Electron-killing `onTimeout` is assigned (~192) AFTER
`watchdog.start()` (~161), a startup-window race where an early fire hits only the
no-op handler.

**Design:**
- Install the real `onTimeout` (the one that kills Electron) **before** `start()` —
  restructure so the killing handler exists at watchdog creation.
- Drive `touch()` off **OpenCode session activity**: a lightweight interval poll of
  `getSessionStatus` / `getMessages` (the `ocClient` and `sessionId` are already in
  scope in `interactive.js` ~105–128, just unwired) that `touch()`es on busy status
  or new messages. Keep the Electron-stdout `touch()` too (belt-and-suspenders).
  *Poll over SSE* — simpler and not dependent on OpenCode event availability.
- Keep a total wall-clock cap so a **genuinely** idle session still terminates
  (activity resets idle; the cap bounds the absolute lifetime).

Mechanism is a small, testable helper (e.g. an activity poller that takes
`{ getStatus, onActivity, intervalMs }`) so Unit 2 can drive it with fake timers.

### Unit 4 — CI (#4)

**Problem:** no workflow runs `npm test`/lint on push or PR; `publish.yml`
(`actions/checkout@v6`, `setup-node@v6`, Node 22) goes `npm ci → npm publish` with
**no test step**. All gates (lint, secret-scan, size-gate) are bypassable local hooks.

**Design:**
- **`.github/workflows/ci.yml`** on `push` + `pull_request`:
  - `test` job: matrix `os: [windows-latest, ubuntu-latest, macos-latest] ×
    node: [18, 20, 22]` → `npm ci && npm test` (unit suite). **macOS legs start as
    `continue-on-error: true`** (visible but non-blocking — macOS is currently
    untested; promote to blocking once green, tracked as a follow-up). Windows + Linux
    legs are blocking.
  - `quality` job (runs **once**, ubuntu-latest / Node 22 — these checks are
    platform-independent): `npm run lint`, secret-scan, size-gate.
- **Whole-tree gate entrypoints (new):** `scripts/check-secrets.js` and
  `scripts/check-file-sizes.js` today scan git-*staged* files (pre-commit). CI has no
  staging area, so add a whole-tree / tracked-files mode reusing the already-exported
  `scanForSecrets` and the size-check function (e.g. `npm run check:secrets` and
  `npm run check:sizes` that scan `git ls-files`). Small addition; no change to the
  pre-commit behavior.
- **`publish.yml`:** add an `npm ci && npm test` step **before** `npm publish`, so a
  tagged release with a red suite cannot ship.
- `.test-passed` cache and the local pre-push hook are unchanged (a local
  optimization); CI always runs fresh.

## Testing & Verification

- Every behavior change gets a unit test (Units 1–3), following the per-fix
  convention. Coupled existing tests asserting old terminal-state behavior are
  updated in the same task.
- Gate: `npm test` green (baseline 125 suites / 1934 pass / 4 skip) + `npm run lint`
  clean locally; CI green on Windows + Linux × Node 18/20/22.
- CI is self-verifying: the first PR/push exercising `ci.yml` is the proof it runs.
  `publish.yml`'s new test step is verified by inspection + a dry-run reasoning (it
  is not exercised until the next tagged release).

## Risks

- **Terminal-state coupling** — tests/consumers may encode the buggy
  `complete`/exit-0 behavior; mitigated by updating them with their source (WS-0
  pattern) and by `resolveTerminalState` being a single, fully-unit-tested mapping.
- **Idle-backstop exit-code change (0 → 2)** — anything trusting exit 0 from a hung
  idle session was already wrong; the change makes failure visible. Confirm no test
  asserts the old exit 0.
- **macOS unknowns** — handled by `continue-on-error` initially so WS-1 isn't held
  hostage to pre-existing macOS failures.
- **Watchdog poll load** — the activity poller adds a recurring `getSessionStatus`
  call; keep the interval coarse (~30 s) and the helper cancelable on teardown.
- **`headless.js` size gate** — extraction reduces its line count; the new
  `session-finalize.js` must stay under the 300-line gate (it will — two small
  functions).

## Execution Notes

- Worktree: `C:\Users\sendt\dev\amicus-ws1`, branch `ws1/reliability-foundation`
  (off `main` @ `e569521`). `node_modules` junctioned; hooks fire (PR #9). Local-only
  — no push/PR until the owner OKs the WS-1 milestone.
- Task shape (~4): (1) `session-finalize.js` + idle-backstop & `start.js` fixes +
  behavioral tests; (2) active watchdog + tests; (3) whole-tree gate entrypoints;
  (4) `ci.yml` matrix + `publish.yml` test gate.
