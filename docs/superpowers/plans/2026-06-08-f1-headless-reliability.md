# F1 — Headless Reliability Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make headless (`--no-ui`) runs reliable — stop the poller killing runs during quiet tool-call gaps (#16), make the caller's `--timeout` authoritative even when an SDK call hangs (#19), and lock in `--no-context` isolation (#17).

**Architecture:** All changes are in the headless run path, centered on the polling loop in `src/headless.js`. Completion detection becomes *activity-aware* (tool calls/results/messages count as progress, not just text) with `time.completed`/the fold marker as primary signals and a hardened, tunable idle fallback. Poll interval + thresholds become injectable so the ~60s idle behavior is testable in milliseconds. SDK polls are wrapped in a per-call timeout bounded by an absolute deadline.

**Tech Stack:** Node.js (CommonJS), Jest. Tests mock `src/opencode-client` and `fs` (see existing `tests/headless.test.js` pattern) — no real model calls.

---

## Context the implementer needs

- The poll loop lives in `src/headless.js` `runHeadless()` (currently ~lines 259-458). It polls `getMessages(client, sessionId)` every 2000ms, accumulates assistant **text** into `output`, records tool calls in `toolCalls[]`, and decides completion via: (1) `[SIDECAR_FOLD]` on its own line; (2) `sessionError && !output && assistantFinished`; (3) the `stablePolls` heuristic (lines 431-451).
- **Root bug (#16):** `stablePolls` only watches `output` (text) growth. Tool calls/results never touch `output`, so a quiet tool gap reads as "no progress" and trips the `!assistantFinished` threshold of **4** (≈8s) → run killed mid-task with `completed:false`.
- **Root bug (#19):** the loop's `(Date.now()-startTime) < timeoutMs` bound is only re-checked between `await getMessages` calls; a hung call freezes the loop. The `IdleWatchdog` is built with no `timeout` (uses the 15-min mode default) and is reset by `touch()` every poll, so it doesn't enforce the caller's `--timeout`.
- **#17 is already implemented:** `start.js:163` uses `'[Context excluded by caller - briefing is self-contained]'` when `includeContext===false`, and never calls `buildContext`. `tests/sidecar/start.test.js` already asserts "skips buildContext when includeContext is false". This task only strengthens that test.
- **Tests use REAL timers** (hence the 15-35s jest timeouts). New behavior thresholds must be injectable so tests run in ms.
- `getSessionStatus(client, sessionId)` exists (`opencode-client.js:282` → `client.session.status(...)`) but is unused by the loop. Its return shape is unknown — Task 3 investigates it.
- The SDK message shape (from the code + existing tests): `messages[i].info.{role,id,error,time:{completed}}` and `messages[i].parts[]` with `part.type` ∈ {`text`,`tool_use`/`tool`,`tool_result`}.

## File structure

| File | Responsibility / change |
| --- | --- |
| `src/headless.js` | The fix surface: injectable interval+thresholds, activity-aware completion, per-call/deadline timeout, optional SDK-status signal. |
| `src/opencode-client.js` | Task 3 only, if the SDK status is usable: nothing required (the wrapper already exists); the loop calls `getSessionStatus`. |
| `tests/headless.test.js` | New regression tests (#16, #19, SDK-status) + update the one test that asserts the old 4-poll threshold. |
| `tests/sidecar/start.test.js` | Strengthen the existing `--no-context` isolation test (#17). |

---

## Task 1: Injectable poll interval + thresholds *(foundation for testability + the spec's tunable constants)*

**Files:**
- Modify: `src/headless.js` (add constants after `DEFAULT_TIMEOUT` ~line 26; read overrides in `runHeadless`; use them in the loop at ~line 261 and ~line 437)
- Test: `tests/headless.test.js`

- [ ] **Step 1: Write the failing test** — add inside `describe('Polling Behavior', ...)`:

```javascript
    it('honors an injected poll interval (fast path)', async () => {
      mockGetMessages.mockResolvedValue([{
        info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
        parts: [{ id: 'p1', type: 'text', text: `Quick\n${COMPLETE_MARKER}` }]
      }]);
      const start = Date.now();
      const result = await runHeadless(
        testModel, testSystemPrompt, testUserMessage, testTaskId, testProject,
        30000, 'build', { pollIntervalMs: 5 }
      );
      expect(result.completed).toBe(true);
      expect(Date.now() - start).toBeLessThan(1000); // 5ms polls, not 2000ms
    });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest tests/headless.test.js -t "honors an injected poll interval"`
Expected: FAIL — the run takes ~2000ms (hardcoded interval), exceeding the `< 1000` assertion.

- [ ] **Step 3: Implement injectable constants**

After `const DEFAULT_TIMEOUT = 15 * 60 * 1000;` (~line 26) add:

```javascript
/** Poll cadence + completion thresholds (env-overridable; injectable via options for tests). */
const POLL_INTERVAL_MS = Number(process.env.AMICUS_POLL_INTERVAL_MS) || 2000;
const STABLE_FINISHED_POLLS = Number(process.env.AMICUS_STABLE_FINISHED_POLLS) || 2;   // when time.completed is set
const STABLE_IDLE_POLLS = Number(process.env.AMICUS_STABLE_IDLE_POLLS) || 30;          // ~60s at 2s — no completion signal
const POLL_CALL_TIMEOUT_MS = Number(process.env.AMICUS_POLL_CALL_TIMEOUT_MS) || 30000; // per getMessages call (Task 4)
```

Inside `runHeadless`, just before the polling loop (after `let pollCount = 0;` ~line 251), resolve effective values from `options`:

```javascript
    const pollIntervalMs = options.pollIntervalMs || POLL_INTERVAL_MS;
    const stableFinishedPolls = options.stableFinishedPolls || STABLE_FINISHED_POLLS;
    const stableIdlePolls = options.stableIdlePolls || STABLE_IDLE_POLLS;
    const pollCallTimeoutMs = options.pollCallTimeoutMs || POLL_CALL_TIMEOUT_MS;
```

Replace the poll sleep (`await new Promise(resolve => setTimeout(resolve, 2000));`, ~line 261) with:

```javascript
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
```

Replace the threshold line (`const threshold = assistantFinished ? 2 : 4;`, ~line 437) with:

```javascript
            const threshold = assistantFinished ? stableFinishedPolls : stableIdlePolls;
```

Export the constants (append to `module.exports`):

```javascript
  POLL_INTERVAL_MS,
  STABLE_FINISHED_POLLS,
  STABLE_IDLE_POLLS,
  POLL_CALL_TIMEOUT_MS,
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx jest tests/headless.test.js -t "honors an injected poll interval"`
Expected: PASS (run completes in well under 1s).

- [ ] **Step 5: Update the existing 4-poll test to the new threshold name** — in `tests/headless.test.js`, the test `'should complete via stablePolls fallback after 4 stable polls without assistantFinished'` (~line 930) hardcodes the old behavior. Update it to inject a small idle threshold and assert against it:

```javascript
    it('completes via the idle fallback after stableIdlePolls without assistantFinished', async () => {
      const stableMessage = [{
        info: { role: 'assistant', id: 'msg-1', time: {} },
        parts: [{ id: 'p1', type: 'text', text: 'Final output' }]
      }];
      mockGetMessages.mockResolvedValue(stableMessage);
      const result = await runHeadless(
        testModel, testSystemPrompt, testUserMessage, testTaskId, testProject,
        30000, 'build', { pollIntervalMs: 5, stableIdlePolls: 4 }
      );
      expect(result.summary).toBe('Final output');
    });
```

- [ ] **Step 6: Run the full headless test file**

Run: `npx jest tests/headless.test.js`
Expected: PASS (existing tests still green via defaults; the updated test green).

- [ ] **Step 7: Commit**

```bash
git add src/headless.js tests/headless.test.js
git commit -m "feat(f1): injectable poll interval + completion thresholds"
```

---

## Task 2: Activity-aware completion detection *(#16)*

**Files:**
- Modify: `src/headless.js` — add activity counters before the loop; count tool_results; replace the `stablePolls` block (~lines 431-451)
- Test: `tests/headless.test.js`

- [ ] **Step 1: Write the failing test** — add inside `describe('Polling Behavior', ...)`:

```javascript
    it('does NOT exit during a quiet tool-call gap longer than the old 4-poll threshold', async () => {
      // poll 1: assistant + text + a tool_use (tool starts).
      // polls 2-7: SAME content (tool "running", no new text/parts) — 6 stable polls,
      //            which would trip the OLD threshold of 4 and kill the run.
      // poll 8: text grows + standalone fold marker.
      const running = {
        info: { role: 'assistant', id: 'msg-1', time: {} },
        parts: [
          { id: 't1', type: 'tool_use', name: 'Read', input: { path: '/big' } },
          { id: 'p1', type: 'text', text: 'Reading the file' }
        ]
      };
      const done = {
        info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
        parts: [
          { id: 't1', type: 'tool_use', name: 'Read', input: { path: '/big' } },
          { id: 'p1', type: 'text', text: `Reading the file... done\n${COMPLETE_MARKER}` }
        ]
      };
      let n = 0;
      mockGetMessages.mockImplementation(() => {
        n++;
        return Promise.resolve(n >= 8 ? [done] : [running]);
      });

      const result = await runHeadless(
        testModel, testSystemPrompt, testUserMessage, testTaskId, testProject,
        30000, 'build', { pollIntervalMs: 5, stableIdlePolls: 20 }
      );

      // Completed via the fold marker, not killed during the 6-poll gap.
      expect(result.completed).toBe(true);
      expect(result.summary).toContain('done');
      expect(n).toBeGreaterThanOrEqual(8);
    });

    it('treats new tool calls/results as activity (resets the idle counter)', async () => {
      // Alternating new tool activity each poll keeps the run alive past stableIdlePolls,
      // then a fold marker ends it. With text-only detection this would have completed early.
      const seq = [
        [{ info: { role: 'assistant', id: 'm1', time: {} }, parts: [
          { id: 'x', type: 'text', text: 'go' }, { id: 't1', type: 'tool_use', name: 'A', input: {} }] }],
        [{ info: { role: 'assistant', id: 'm1', time: {} }, parts: [
          { id: 'x', type: 'text', text: 'go' }, { id: 't1', type: 'tool_use', name: 'A', input: {} },
          { id: 'r1', type: 'tool_result', tool_use_id: 't1', content: 'ok' }] }],
        [{ info: { role: 'assistant', id: 'm1', time: {} }, parts: [
          { id: 'x', type: 'text', text: 'go' }, { id: 't1', type: 'tool_use', name: 'A', input: {} },
          { id: 'r1', type: 'tool_result', tool_use_id: 't1', content: 'ok' },
          { id: 't2', type: 'tool_use', name: 'B', input: {} }] }],
        [{ info: { role: 'assistant', id: 'm1', time: { completed: Date.now() } }, parts: [
          { id: 'x', type: 'text', text: `go done\n${COMPLETE_MARKER}` }] }],
      ];
      let n = 0;
      mockGetMessages.mockImplementation(() => Promise.resolve(seq[Math.min(n++, seq.length - 1)]));

      const result = await runHeadless(
        testModel, testSystemPrompt, testUserMessage, testTaskId, testProject,
        30000, 'build', { pollIntervalMs: 5, stableIdlePolls: 2 }
      );
      expect(result.completed).toBe(true);
    });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest tests/headless.test.js -t "quiet tool-call gap"`
Expected: FAIL — current code breaks at `stablePolls >= 4` during the gap, returning `completed:false` before poll 8.

- [ ] **Step 3: Implement activity-aware detection**

Add counters with the other loop state (near `let stablePolls = 0;` ~line 254):

```javascript
    let lastToolCallCount = 0;
    let lastToolResultCount = 0;
    let toolResultCount = 0;     // incremented when a tool_result part is seen
    let lastMessageCount = 0;
```

In the `tool_result` branch (~line 371, where it logs the tool result), add the counter increment as the first line inside the `else if (part.type === 'tool_result')` block:

```javascript
              } else if (part.type === 'tool_result') {
                toolResultCount++;
```

Replace the entire `stablePolls` block (currently ~lines 431-451, from `const outputGrew = ...` through `lastAssistantMsgId = currentAssistantMsgId;`) with:

```javascript
        // Activity-aware idle detection: ANY of text growth, a new tool call, a new
        // tool result, a new message, or a new assistant message id counts as progress.
        // Only count toward completion when NOTHING changed (genuine idle).
        const outputGrew = output.length > lastOutputLength;
        lastOutputLength = output.length;
        const toolActivity = toolCalls.length > lastToolCallCount;
        lastToolCallCount = toolCalls.length;
        const resultActivity = toolResultCount > lastToolResultCount;
        lastToolResultCount = toolResultCount;
        const messageActivity = messageCount > lastMessageCount;
        lastMessageCount = messageCount;
        const newAssistant = currentAssistantMsgId !== lastAssistantMsgId;

        const progressed = outputGrew || toolActivity || resultActivity || messageActivity || newAssistant;

        if (!progressed) {
          // Require real output before counting toward completion — the SDK creates an
          // empty assistant-message placeholder on promptAsync that is NOT a finished response.
          if (currentAssistantMsgId !== null && output.length > 0) {
            stablePolls++;
            const threshold = assistantFinished ? stableFinishedPolls : stableIdlePolls;
            if (stablePolls >= threshold) {
              logger.debug('Session appears complete (idle)', { stablePolls, assistantFinished });
              break;
            }
          } else {
            logger.debug('Waiting for model to produce output', {
              pollCount, hasAssistantMsg: currentAssistantMsgId !== null, outputLength: output.length
            });
          }
        } else {
          stablePolls = 0;
        }
        lastAssistantMsgId = currentAssistantMsgId;
```

- [ ] **Step 4: Run the new + full file**

Run: `npx jest tests/headless.test.js`
Expected: PASS — both new tests pass; the pre-existing tests (placeholder guard, streaming, "only finish when LAST assistant complete", inline-fold) still pass.

- [ ] **Step 5: Commit**

```bash
git add src/headless.js tests/headless.test.js
git commit -m "fix(f1): activity-aware headless completion (no premature exit on tool gaps) (#16)"
```

---

## Task 3: SDK session-status as the authoritative idle signal *(investigate, then wire if usable)*

**Files:**
- Modify: `src/headless.js` (only if usable)
- Test: `tests/headless.test.js` (only if wired)

- [ ] **Step 1: Investigate the status shape**

Read the SDK's type for `client.session.status`:

Run: `node -e "const fs=require('fs'); const p=require.resolve('@opencode-ai/sdk'); console.log(p);"`
Then inspect the `.d.ts` for `session.status` (e.g. `npx tsc --noEmit` is not needed — just open the types dir printed above and search for `status`). Determine whether the response `data` contains a boolean/string indicating the run is processing vs idle (likely fields: `running`, `busy`, `idle`, `state`, or a `time`/`pending` shape).

- [ ] **Step 2: Decide and record**

- **If a clear running/idle indicator exists:** proceed to Step 3.
- **If not** (or the shape is ambiguous/unstable): STOP this task. Add a one-line comment in `runHeadless` near the completion logic: `// NOTE: OpenCode session.status does not expose a usable idle flag (checked 2026-06); completion relies on the activity-aware heuristic above.` Commit just that comment with message `docs(f1): note SDK session-status not usable for idle detection`. Skip Steps 3-5.

- [ ] **Step 3: Write the failing test (only if wiring)** — mock `getSessionStatus` so the session reports idle while output exists and `time.completed` is NOT set, and assert the run completes promptly (faster than `stableIdlePolls`):

```javascript
    it('completes when the SDK reports the session idle (with output present)', async () => {
      mockGetSessionStatus.mockResolvedValue({ /* the idle-indicating shape found in Step 1 */ });
      mockGetMessages.mockResolvedValue([{
        info: { role: 'assistant', id: 'm1', time: {} }, // note: NOT time.completed
        parts: [{ id: 'p1', type: 'text', text: 'All done, no fold marker' }]
      }]);
      const result = await runHeadless(
        testModel, testSystemPrompt, testUserMessage, testTaskId, testProject,
        30000, 'build', { pollIntervalMs: 5, stableIdlePolls: 1000 } // huge, so only status can end it
      );
      expect(result.summary).toContain('All done');
    });
```
(Add `const mockGetSessionStatus = jest.fn();` and `getSessionStatus: mockGetSessionStatus` to the `jest.mock('../src/opencode-client', ...)` block, and `mockGetSessionStatus.mockResolvedValue({})` in `beforeEach`.)

- [ ] **Step 4: Wire it in (only if wiring)** — import `getSessionStatus` in `runHeadless`'s destructure from `./opencode-client`, call it once per poll wrapped in the per-call timeout (Task 4's `withTimeout`), and treat a reported-idle status with `output.length > 0` as an immediate completion (it is more authoritative than the heuristic; the heuristic remains the fallback for SDKs/sessions that don't report cleanly). Keep the fold marker as the highest-priority signal.

- [ ] **Step 5: Run + commit (only if wiring)**

Run: `npx jest tests/headless.test.js`
Expected: PASS.
```bash
git add src/headless.js tests/headless.test.js
git commit -m "feat(f1): use OpenCode session-status as authoritative idle signal"
```

---

## Task 4: Authoritative timeout — per-call SDK timeout bounded by the deadline *(#19)*

**Files:**
- Modify: `src/headless.js` (add `withTimeout` helper; compute `deadline`; wrap `getMessages`)
- Test: `tests/headless.test.js`

- [ ] **Step 1: Write the failing test** — add inside `describe('Session Abort', ...)`:

```javascript
    it('does not hang when getMessages never resolves — dies at --timeout', async () => {
      // getMessages hangs forever. Without a per-call timeout the loop freezes
      // on the await and never re-checks the deadline.
      mockGetMessages.mockImplementation(() => new Promise(() => {}));

      const start = Date.now();
      const result = await runHeadless(
        testModel, testSystemPrompt, testUserMessage, testTaskId, testProject,
        300, // 300ms --timeout
        'build', { pollIntervalMs: 5, pollCallTimeoutMs: 50 }
      );
      expect(result.timedOut).toBe(true);
      expect(mockAbortSession).toHaveBeenCalled();
      expect(Date.now() - start).toBeLessThan(3000); // bounded, not infinite
    }, 6000); // jest cap so a regression fails as a bounded timeout, not a forever-hang
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/headless.test.js -t "never resolves"`
Expected: FAIL — current code hangs on `await getMessages` and the test hits its 6000ms jest cap.

- [ ] **Step 3: Implement `withTimeout` + deadline-bounded polling**

Add a helper near the top of `src/headless.js` (after the constants):

```javascript
/**
 * Race a promise against a timeout. Returns the promise's result, or rejects with
 * a timeout error after `ms`. A non-positive `ms` means "no extra timer" (return as-is).
 */
function withTimeout(promise, ms, label) {
  if (!(ms > 0)) { return promise; }
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      if (t.unref) { t.unref(); }
    }),
  ]);
}
```

Compute the absolute deadline just before the loop (next to the effective-options block from Task 1):

```javascript
    const deadline = startTime + timeoutMs;
```

Replace the poll fetch (`const messages = await getMessages(client, sessionId);`, ~line 287) with a deadline-bounded, timed call:

```javascript
        const remaining = deadline - Date.now();
        const messages = await withTimeout(
          getMessages(client, sessionId),
          Math.min(pollCallTimeoutMs, remaining),
          'getMessages'
        );
```

The existing `catch (pollError)` (~line 454) already logs and continues; a timed-out call lands there, the loop re-evaluates `(Date.now() - startTime) < timeoutMs`, and exits at the deadline → the existing timeout-abort block (`~line 475`) sets `timedOut` and calls `abortSession`. As `remaining` shrinks near the deadline, the per-call timeout shrinks with it, so the loop exits within ~`pollIntervalMs` of the deadline. No `process.exit` is involved — the function returns its `timedOut` result normally (safe for shared-server mode and for tests).

Export the helper for unit testing (append to `module.exports`): `withTimeout,`.

- [ ] **Step 4: Run + full file**

Run: `npx jest tests/headless.test.js`
Expected: PASS — the hang test now returns `timedOut:true` quickly; the existing "should set timedOut flag when timeout is reached" test still passes (its mock resolves each poll).

- [ ] **Step 5: Commit**

```bash
git add src/headless.js tests/headless.test.js
git commit -m "fix(f1): per-call SDK timeout bounded by deadline — --timeout is authoritative (#19)"
```

---

## Task 5: Confirm + strengthen `--no-context` isolation *(#17)*

**Files:**
- Modify: `tests/sidecar/start.test.js` (strengthen the existing isolation test)

- [ ] **Step 1: Read the existing test** — `tests/sidecar/start.test.js` has `describe('startSidecar includeContext option', ...)` with a test `'skips buildContext when includeContext is false'` that mocks `buildContext` to return `'mocked context'` and asserts it is NOT called when `includeContext:false`, and that the context arg passed to `buildPrompts` contains `'Context excluded'`.

- [ ] **Step 2: Strengthen it** — make the mock return a recognizable PARENT marker and assert it never reaches `buildPrompts` when isolation is on. Replace the body of `'skips buildContext when includeContext is false'` with:

```javascript
    const PARENT_MARKER = '<<<PARENT_CONVERSATION_LEAK>>>';
    // buildContext (mocked) would return parent content IF it were called.
    require('../../src/sidecar/context-builder').buildContext.mockReturnValue(PARENT_MARKER);

    const { startSidecar } = require('../../src/sidecar/start');
    const { buildPrompts } = require('../../src/prompt-builder');
    await startSidecar({ model: 'gemini', prompt: 'test', noUi: true, includeContext: false });

    expect(buildContextMock).not.toHaveBeenCalled();
    const contextArg = buildPrompts.mock.calls[0][1];
    expect(contextArg).toContain('Context excluded');
    expect(contextArg).not.toContain(PARENT_MARKER); // zero parent-conversation bleed
```

Add a companion positive case asserting that with `includeContext:true` (default), the parent marker DOES flow through, so the test proves the switch actually gates context:

```javascript
    it('passes parent context to buildPrompts when includeContext is true', async () => {
      const PARENT_MARKER = '<<<PARENT_CONVERSATION_LEAK>>>';
      require('../../src/sidecar/context-builder').buildContext.mockReturnValue(PARENT_MARKER);
      const { startSidecar } = require('../../src/sidecar/start');
      const { buildPrompts } = require('../../src/prompt-builder');
      await startSidecar({ model: 'gemini', prompt: 'test', noUi: true, includeContext: true });
      expect(buildPrompts.mock.calls[0][1]).toContain(PARENT_MARKER);
    });
```

- [ ] **Step 3: Run**

Run: `npx jest tests/sidecar/start.test.js`
Expected: PASS (isolation proven both ways).

- [ ] **Step 4: Commit**

```bash
git add tests/sidecar/start.test.js
git commit -m "test(f1): prove --no-context carries zero parent-conversation content (#17)"
```

---

## Task 6: Full verification + follow-on note

**Files:**
- Verify: full suite
- Modify: `docs/superpowers/specs/2026-06-08-f1-headless-reliability-design.md` (mark status; note the skill-workaround follow-on)

- [ ] **Step 1: Full suite (no new failures vs baseline)**

Run: `npm test 2>&1 | tail -15`
Expected: ONLY the 8 known pre-existing failures (interactive, opencode-client-cowork, evaluator, api-key-store, fold-nudge, mcp-server safeSessionDir, e2e×3). Zero new. (None of those are in the headless path.)

- [ ] **Step 2: Lint**

Run: `npm run lint 2>&1 | tail -3`
Expected: no NEW errors beyond the 3 known (`opencode-client.js` `no-unused-vars`). `src/headless.js` must stay clean (use `logger`, not `console`).

- [ ] **Step 3: Record outcome in the design spec** — set the spec frontmatter `status:` to `implemented (branch <branch>)`, and under §6 add a line: "Follow-on (separate change): delete the `single-read` / `no-glob` / `no-narration` workarounds and the `Polling loop exited` false-alarm handling from `skills/second-opinion/` and `skill/SKILL.md` now that the engine is reliable."

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-06-08-f1-headless-reliability-design.md
git commit -m "docs(f1): mark headless-reliability implemented + note skill-workaround follow-on"
```

Then use **superpowers:finishing-a-development-branch**.

---

## Self-review (completed by plan author)

- **Spec coverage:** #16 → Tasks 1+2 (injectable thresholds + activity-aware detection). #19 → Task 4 (per-call timeout bounded by deadline; no `process.exit`, matching the spec's shared-server safety note). #17 → Task 5 (strengthen the existing isolation test, both directions). SDK-status enhancement → Task 3 (investigate-then-wire conditional, per the approved approach). Testing strategy (mock the SDK stream; quiet-gap and hung-call cases) → Tasks 2 & 4. Acceptance criteria → covered; the skill-workaround removal is explicitly the Task 6 follow-on (not a blocker), matching the spec's "out of scope / follow-on".
- **No placeholders:** behavioral changes and tests are shown in full. Task 3 is genuinely conditional (the SDK shape is unknown) but has defined branches and a concrete investigation method + a "stop and document" path — not a TBD.
- **Type/name consistency:** `pollIntervalMs`/`stableFinishedPolls`/`stableIdlePolls`/`pollCallTimeoutMs` (Task 1 options) are reused verbatim in Tasks 2-4; `withTimeout` (Task 4) is the helper Task 3 reuses; the new counters `lastToolCallCount`/`lastToolResultCount`/`toolResultCount`/`lastMessageCount` (Task 2) are defined before the loop and used once. `messageCount` already exists in the loop (line 288).
- **Testability:** every new behavior is exercised with injected ms-scale intervals/thresholds, so no test depends on real 60s/15m waits; the hung-call test has a jest cap so a regression surfaces as a bounded failure, not a forever-hang.
