---
title: F1 — Headless Reliability Core (Design)
date: 2026-06-08
status: implemented (branch f1/headless-reliability, 2026-06-08)
owner: BourbonDog
parent: 2026-06-07-amicus-product-design.md (§6 F1)
---

# F1 — Headless Reliability Core

## 1. Summary

Make headless (`--no-ui`) runs reliable by fixing the completion-detection poller in
`src/headless.js`. Three issues, all in the headless run path:

- **#16 — premature exit:** runs are killed mid-task during quiet tool-call gaps.
- **#19 — timeout not authoritative:** a hung SDK call can let a run exceed the caller's `--timeout`.
- **#17 — context isolation:** `--no-context` already works; lock it in with a regression test.

**Payoff:** the `second-opinion` (council) and `sidecar` (chat) skills can delete their
single-read / no-glob / no-narration workarounds and the "Polling loop exited" false-alarm checks.

## 2. Root-cause analysis (from the current code)

### #16 — premature exit *(the core bug)*
`runHeadless` polls every 2000ms (`headless.js:259-458`). Completion when idle is decided by
`stablePolls` (lines 431-451), which increments only when the **text** `output` string stops
growing and the assistant message id is unchanged:

```js
const outputGrew = output.length > lastOutputLength;          // TEXT only
if (!outputGrew && currentAssistantMsgId === lastAssistantMsgId) {
  if (currentAssistantMsgId !== null && output.length > 0) {
    stablePolls++;
    const threshold = assistantFinished ? 2 : 4;              // 4 polls ≈ 8s
    if (stablePolls >= threshold) { break; }                 // ← premature
  }
}
```

Tool calls are recorded in a separate `toolCalls[]` array (line 341) and **never touch
`output`**. So while a tool runs (e.g. Gemini narrates "I'll read the file…", then a glob/read
executes with no new *text*), `output` is flat and the message id is unchanged → `stablePolls`
climbs to 4 (~8s) and the loop **breaks mid-task** with `completed:false`. This is the dominant
failure mode the skills currently work around.

### #19 — timeout not authoritative
The loop bound is `(Date.now() - startTime) < timeoutMs`, but it is only re-evaluated between
`await getMessages(...)` calls (line 287). If an SDK call hangs, the loop is stuck on that await
and never re-checks the bound. The `IdleWatchdog` backstop is ineffective for the caller's
deadline because:
- it is constructed with **no `timeout`** (`headless.js:166`), so it uses the 15-min *mode default*
  (or `SIDECAR_IDLE_TIMEOUT*` env), **not** the caller's `timeoutMs`; and
- `watchdog.touch()` runs every poll iteration and resets the idle timer, so during normal polling
  it never fires.

Net: a hung run honors the watchdog's 15-min default rather than the user's `--timeout` (and if the
idle timeout is disabled via env, it can hang indefinitely).

### #17 — context isolation *(already implemented)*
`start.js:163-165` sets `context = '[Context excluded by caller - briefing is self-contained]'`
when `includeContext === false` (CLI `--no-context`, MCP `includeContext:false`), and the
shared-server headless path (`mcp-server.js:142`) skips `buildContext` entirely. Parent
conversation history is therefore not assembled into the prompt. This needs a **verification
test**, not a rebuild.

## 3. Design

### F1a — Activity-aware completion detection *(#16)* — chosen approach
Replace the text-only `outputGrew` signal with a broad **`progressed`** signal computed each poll:

```
progressed = textOutputGrew
          || newToolUseSeen          // a tool_use part not seen before
          || newToolResultSeen       // a tool_result part not seen before
          || messageCountIncreased   // messages.length grew
          || newAssistantMessageId   // a new assistant message started
```

- `stablePolls` resets to 0 whenever `progressed` is true.
- **Primary "done" signals (unchanged priority):** (1) `[SIDECAR_FOLD]` on its own line → complete;
  (2) `sessionError && !output && assistantFinished` → error-exit.
- **Idle completion:**
  - If `assistantFinished` (last assistant `time.completed` set): complete after
    `STABLE_FINISHED` (= 2) polls with no progress. (Trust the explicit finish.)
  - If `!assistantFinished` (model never signalled completion): complete only after genuine idle —
    `STABLE_IDLE` polls with no progress *of any kind* and `output.length > 0`. `STABLE_IDLE`
    corresponds to a much longer window than today's 8s (target ≈ **60s**, i.e. ~30 polls), so a
    tool gap or a reasoning pause cannot trip it. Named, tunable constants.
- **SDK-status enhancement (investigate first, per approval):** check whether the OpenCode SDK
  exposes a per-session "running/idle" status (a session-state field on `getMessages`, a
  session-status endpoint, or stream events) via `src/opencode-client.js`. If it exists, use it as
  the authoritative idle signal (run reports idle → done) and demote the heuristic above to a
  fallback. If it does not, ship the heuristic. Document the finding in the implementation.

### F1b — Authoritative hard timeout *(#19)*
- Add a **hard absolute deadline** in `runHeadless`: a single timer set for `startTime + timeoutMs +
  GRACE` (GRACE ≈ 30s) that is **not** reset by polling. On fire it aborts the OpenCode session and
  force-terminates the run, guaranteeing the caller's `--timeout` is the real ceiling regardless of
  SDK state. (Implement as a standalone deadline in `runHeadless`, or extend `IdleWatchdog` with an
  absolute "max lifetime" separate from its resettable idle timer — prefer the standalone deadline
  so the watchdog's idle semantics stay unchanged.)
- Wrap each SDK poll call (`getMessages`, and defensively `sendPromptAsync`/`abortSession`) in a
  **per-call timeout** (`Promise.race` with a bounded timer, ≈ 30s). A per-call timeout logs and
  continues the loop (so the overall-deadline check runs again) rather than hanging.

### F1c — Context-isolation verification *(#17)*
- Add a regression test asserting that an `includeContext:false` run produces prompts containing the
  `[Context excluded…]` placeholder and **none** of a seeded parent-conversation marker — covering
  both the CLI path (`start.js` → `buildPrompts`) and the shared-server headless path
  (`mcp-server.js` skips `buildContext`).
- Only if the test surfaces a bleed channel (e.g. inherited MCP context, reused session) do we
  harden it; otherwise the test simply locks in current behavior.

## 4. Components / files touched

| File | Change |
| --- | --- |
| `src/headless.js` | Activity-aware `progressed` signal + `STABLE_FINISHED`/`STABLE_IDLE` constants; hard absolute deadline; per-call SDK timeouts. |
| `src/opencode-client.js` | Investigate/expose a session running/idle status; add per-call timeout wrappers. |
| `src/utils/idle-watchdog.js` | Only if we choose to host the absolute deadline here (optional). |
| `tests/headless*.test.js` (new/updated) | Regression tests for #16, #19, #17 with a mocked SDK message stream. |

The shared-server headless path (`src/utils/shared-server.js` → `runHeadless`) inherits all fixes
automatically since it calls `runHeadless`.

## 5. Testing strategy

Mock `src/opencode-client` so tests script the polled message stream deterministically (no real
model calls).

- **#16 regression (must fail before the fix):** a stream that emits an assistant message + some
  text, then a `tool_use` part, then several polls with **no new parts** (tool "running"), then more
  text and a standalone `[SIDECAR_FOLD]`. Assert: the run does **not** complete during the quiet
  tool gap, and completes exactly on the fold marker with `completed:true`. A second case: a long
  quiet gap with `assistantFinished:false` must not complete until the ≈60s idle window.
- **#19 regression:** mock `getMessages` to hang (never resolve) — assert the run is force-terminated
  at ≈ `timeoutMs + GRACE` (not 15m, not infinite) and the session is aborted. A second case: a
  stream that never emits the fold marker nor `time.completed` is killed at the deadline.
- **#17:** `includeContext:false` prompts contain the exclusion placeholder and zero seeded parent
  content; `includeContext:true` includes it. Both CLI and shared-server paths.
- The existing suite must hold at its baseline (the 8 known pre-existing electron/Windows failures);
  add no new failures.

## 6. Acceptance criteria

- A headless run that pauses > 8s mid-tool-call **completes with full output** (the Gemini
  narrate-then-glob pattern works **without** the single-read workaround).
- A genuinely stuck run (hung SDK call, or no completion signal) is killed at the caller's
  `--timeout` (+ grace), and the OpenCode session is aborted — never the 15-min default, never
  indefinite.
- A `--no-context` run cannot reference any parent-conversation content (regression-tested).
- After F1 lands, the `second-opinion`/`sidecar` skills' single-read / no-glob / no-narration
  workarounds and "Polling loop exited" false-alarm checks are removed (follow-on skill edit;
  tracked, not a blocker for F1 merge).

## 7. Risks & open questions

- **Heuristic tuning (`STABLE_IDLE`).** Too short reintroduces #16; too long delays completion for
  models that never set `time.completed`. Mitigation: prefer the SDK-status signal if it exists;
  otherwise pick ≈60s and make it a named, env-overridable constant.
- **SDK status availability unknown.** The OpenCode SDK may not expose a clean running/idle signal;
  the design degrades gracefully to the heuristic. Resolve during the first implementation step.
- **Force-exit on hard deadline.** `process.exit` in the shared-server path could affect sibling
  sessions. Mitigation: in shared-server mode, abort just this session and reject its promise rather
  than `process.exit`; reserve `process.exit` for the per-process path.

## 8. Out of scope

- F2 (GUI hang, Windows path bugs — the 8 pre-existing test failures), F3 (process lifecycle), F4
  (fan-out/JSON), F5 (model catalog). Each is its own spec.
- Rewriting the council/chat skills to drop their workarounds is a follow-on once F1 is verified in
  real use (the spec change is small; the engine fix is the prerequisite).
