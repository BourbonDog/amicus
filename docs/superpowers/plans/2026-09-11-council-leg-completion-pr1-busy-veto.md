# Council Leg Completion — PR 1: the stable-idle heuristic defers to `session.status` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A headless leg whose engine session reports `busy` with no tool call live is never declared complete by the stable-idle heuristic; it waits for its message to finalize (or dies by an existing named exit).

**Architecture:** One poll loop in `src/headless.js` already reads `session.status` on every poll where output is non-zero (:1207) and runs a 30-poll flat-output heuristic (:1271). Record the status on each read; on the `!assistantFinished` branch, treat `busy` as activity (reset the flat-poll counter) — but only when `liveTools.length === 0`, so the v4.4 B4 bounded tool-settle ceiling (which fires *through* this gate while busy, then aborts the session) is untouched. Four tests that pinned the defect are updated to the realistic shape; three new tests pin the veto, the fallback, and the ceiling interplay.

**Tech Stack:** Node 18+, Jest (`npx jest <file>` for single files; `npm test` is the pre-push gate and the only command that writes `.test-passed`).

**Spec:** `docs/superpowers/specs/2026-09-11-council-leg-completion-design.md` — §3 (this PR), §1 (evidence), §7 (rollout).

## Global Constraints

- Branch off `design/council-leg-completion` (holds the spec, `db48ffbc`); PR targets `main`; PR carries the `council-review` label and merges only after its council run **completes** (owner's hard gate — check `verdict.json` `overallVerdict` + `seatsReviewed`, not the green check).
- `docs/superpowers/` is gitignored; add plan/spec files with `git add -f` (46 files there are tracked that way).
- No new runStats / ledger / verdict field in this PR (`tally.js`'s allowlist strips unknown keys — §3 "Not in scope").
- Never `python -c` on this machine; never `git checkout --` a file with other uncommitted edits.
- `npm run test:integration` (keyless) after `npm test`; the live replay (§3) is release-ritual only and spends money — not part of this PR's gate.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Measured before writing (2026-09-11, probe on the design branch, reverted): a veto without the `liveTools.length === 0` guard fails **16** tests (13 of them the B4 ceiling/abort suite); with the guard, exactly **4** fail — the four in Task 2 — and 136 pass.

---

### Task 1: The busy veto, test-first

**Files:**
- Modify: `src/headless.js:884` (declaration block), `:1214–1222` (status read), `:1271–1291` (stable-idle gate)
- Test: `tests/headless-idle-completion.test.js`

**Interfaces:**
- Consumes: `getSessionStatus(client, sessionId, ...dirArgs)` (mocked as `mockGetSessionStatus` in every headless suite); `liveTools` (assigned each poll at :999 from `getLiveToolCalls(mirror)`); `assistantFinished` (`mr.assistantFinished`, :992); `stablePolls`, `currentAssistantMsgId`, `mirror.output`.
- Produces: a poll-loop-scoped `let lastSdkStatus` with values `'unread' | 'busy' | 'idle' | <other engine type string> | 'other' | 'unavailable'`; one debug line `Idle heuristic reset: SDK busy, no live tools` `{ taskId, stablePolls }` emitted only when a non-zero count is reset. Nothing new on the return value.

- [ ] **Step 1: Write the failing test — the D0 shape**

Append inside the existing `describe('idle-detection exits classify as completed', …)` block of `tests/headless-idle-completion.test.js`, after the `'stable-poll heuristic (status endpoint unavailable)'` case:

```js
  it('does NOT complete via the idle heuristic while the SDK says busy and no tool is live — waits for the message to finalize (spec 2026-09-11 §3, run D0)', async () => {
    // D0 shape: a completed narration text part arms the gate (output > 0),
    // the final answer is invisible in flight (no growth), the engine is busy.
    const narration = 'Rawlings guidance captured. Now let me get the Wilson method.';
    const answer = '# Breaking in a glove\n\nFull deliverable text.\n```json\n{"overall":"x","findings":[]}\n```';
    let poll = 0;
    mockGetMessages.mockImplementation(() => {
      poll += 1;
      if (poll < 12) {
        return Promise.resolve([{
          info: { role: 'assistant', id: 'm1', time: {} },          // NOT finalized
          parts: [{ id: 'm1:t', type: 'text', text: narration }],
        }]);
      }
      return Promise.resolve([{
        info: { role: 'assistant', id: 'm1', time: { completed: 1 }, finish: 'stop' },
        parts: [{ id: 'm1:t', type: 'text', text: narration + '\n\n' + answer }],
      }]);
    });
    mockGetSessionStatus.mockResolvedValue({ type: 'busy' });

    const result = await runHeadless(
      'openrouter/a/b', 'sys', 'user', 'task1234', '/proj',
      60000, 'build',
      { pollIntervalMs: 5, stableFinishedPolls: 2, stableIdlePolls: 3 }
    );
    // Named mutant "BUSYIGNORED": drop the `lastSdkStatus === 'busy'` veto —
    // the leg exits at poll 4 with only the narration and `poll` never reaches 12.
    expect(poll).toBeGreaterThanOrEqual(12);
    expect(result.completed).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.summary).toContain('Full deliverable text.');
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd C:\Users\sendt\code\amicus && npx jest tests/headless-idle-completion.test.js -t "does NOT complete via the idle heuristic"`
Expected: FAIL — `expect(poll).toBeGreaterThanOrEqual(12)` receives 4 (the heuristic fires at `stablePolls: 3`) and `summary` is the narration only.

- [ ] **Step 3: Implement — record the status**

In `src/headless.js`, after line 884 `let lastSettledToolCount = 0; // B4: tool calls observed reaching a terminal status`, add:

```js
    // 2026-09-11 spec §3: what session.status said on the most recent read this
    // poll. The stable-idle heuristic below defers to it — a busy engine with no
    // live tool is a model still answering, not a dead leg (study run D0: three
    // deliverables discarded 39–107 s before they finished while this said busy).
    let lastSdkStatus = 'unread';
```

In the status block (:1214–1222), after
`const s = (statusData && statusData.type) ? statusData : (statusData && statusData[sessionId]);`
add:

```js
            lastSdkStatus = (s && typeof s.type === 'string') ? s.type : 'other';
```

and in its `catch (statusErr)`, after the existing `logger.debug('session.status unavailable; using activity heuristic', …)` line, add:

```js
            lastSdkStatus = 'unavailable';
```

- [ ] **Step 4: Implement — the veto on the gate**

Replace the head of the stable-idle block (:1271–1276), which currently reads

```js
        if (!progressed) {
          // Require real output before counting toward completion — the SDK creates an
          // empty assistant-message placeholder on promptAsync that is NOT a finished response.
          if (currentAssistantMsgId !== null && mirror.output.length > 0) {
            stablePolls++;
            const threshold = assistantFinished ? stableFinishedPolls : stableIdlePolls;
```

with

```js
        if (!progressed) {
          // Require real output before counting toward completion — the SDK creates an
          // empty assistant-message placeholder on promptAsync that is NOT a finished response.
          //
          // 2026-09-11 spec §3: the heuristic is the FALLBACK for when session.status is
          // unavailable, not a second opinion on it. While the engine says `busy` and
          // no tool call is live, the model is generating — in-flight parts are invisible
          // to this poller (measured: outputLength stays 0 until the message finalizes),
          // so flat output here is not silence. `liveTools.length === 0` keeps the v4.4 B4
          // bounded tool-settle ceiling (below) in charge whenever a tool IS live: that path
          // fires through this gate while busy, then aborts the session (LC-2).
          // Named mutants: "BUSYIGNORED" (drop the busy check) and "VETOOVERCEILING"
          // (drop the liveTools guard — reddens the 13 B4 tests in premature-completion).
          if (currentAssistantMsgId !== null && mirror.output.length > 0
              && !assistantFinished && lastSdkStatus === 'busy' && liveTools.length === 0) {
            if (stablePolls > 0) {
              logger.debug('Idle heuristic reset: SDK busy, no live tools', { taskId, stablePolls });
            }
            stablePolls = 0;
          } else if (currentAssistantMsgId !== null && mirror.output.length > 0) {
            stablePolls++;
            const threshold = assistantFinished ? stableFinishedPolls : stableIdlePolls;
```

Everything from `const threshold …` to the end of the block (the B4 comment, the `if (stablePolls >= threshold && …)` exit, the `else { logger.debug('Waiting for model to produce output', …) }` branch, and the outer `else { stablePolls = 0; }`) is unchanged.

Also update the stale comment at :1204–1206 from

```js
        // Authoritative idle signal from the OpenCode SDK (preferred over the heuristic).
        // Gate on real output so a pre-processing 'idle' cannot end the run early.
        // Best-effort: on any error, fall back to the activity heuristic below.
```

to

```js
        // Authoritative signal from the OpenCode SDK: `idle` ends the leg here; `busy`
        // vetoes the activity heuristic below (2026-09-11 spec §3) unless a tool call is
        // live, in which case the B4 ceiling governs. Gate on real output so a
        // pre-processing 'idle' cannot end the run early. On any error the heuristic
        // runs as the fallback it was always meant to be.
```

- [ ] **Step 5: Run the new test to verify it passes**

Run: `npx jest tests/headless-idle-completion.test.js`
Expected: PASS, all cases in the file (the three existing ones are unaffected: `idle` still exits via the SDK path; the `unavailable` case uses a finalized message and exits via `stableFinishedPolls`).

- [ ] **Step 6: Run the four suites that pinned the defect — see exactly four fail**

Run: `npx jest tests/headless.test.js tests/headless-tool-stall.test.js tests/observe/premature-completion.test.js tests/headless-idle-completion.test.js`
Expected: 3 suites FAIL with exactly these four tests (measured in the probe), everything else green — in particular every B4 ceiling/abort test in `premature-completion` passes:
1. `headless.test.js › Polling Behavior › completes via the idle fallback after stableIdlePolls without assistantFinished`
2. `headless.test.js › Polling Behavior › does NOT fold on a standalone [SIDECAR_FOLD] that is followed by more content (#BL-7)`
3. `headless-tool-stall.test.js › (f) B53 CANNOT fire for a REAL-SHAPE leg whose tool COMPLETED (v4.4 B4 regression)`
4. `premature-completion.test.js › a leg whose tools are ALREADY terminal completes with no added latency (wsgate01-s1-2 / wsgate03-s1-1 shape)`
If anything else fails, stop: the guard is wrong, not the tests.

- [ ] **Step 7: Commit the implementation and the new test**

```bash
git add src/headless.js tests/headless-idle-completion.test.js
git commit -m "fix(headless): stable-idle heuristic defers to session.status busy when no tool is live

A busy engine with no live tool call is a model still answering; in-flight
parts are invisible to the poller, so flat output is not silence. Study run
D0 (2026-09-11) lost three complete deliverables to this gate 39-107 s before
they finished; D1 reversed it. The B4 tool-settle ceiling keeps the gate
whenever a tool IS live. Spec: docs/superpowers/specs/2026-09-11-council-leg-completion-design.md §3

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Update the four tests that pinned the defect

**Files:**
- Modify: `tests/headless.test.js` (two cases in `Polling Behavior`), `tests/headless-tool-stall.test.js` (case `(f)`), `tests/observe/premature-completion.test.js` (case "ALREADY terminal")

**Interfaces:**
- Consumes: `mockGetSessionStatus` (suite-level default `{ type: 'busy' }` in all three files), the `msg(id, parts, { completed })` helper in `premature-completion.test.js` (:101).
- Produces: nothing new; each case now pins the behavior the spec names.

Each of the four relied on the heuristic ending an **unfinalized** message while the SDK said `busy` — the defect itself. Two become the *fallback* pin (status unavailable → heuristic fires); two take the realistic shape (the recorded legs they model finalized their messages).

- [ ] **Step 1: `headless.test.js` — the idle-fallback case becomes the fallback pin**

Replace the case body:

```js
    it('completes via the idle fallback after stableIdlePolls when session.status is unavailable and the message never finalizes (spec 2026-09-11 §3 — the heuristic is the fallback)', async () => {
      const stableMessage = [{
        info: { role: 'assistant', id: 'msg-1', time: {} },
        parts: [{ id: 'p1', type: 'text', text: 'Final output' }]
      }];
      mockGetMessages.mockResolvedValue(stableMessage);
      // Pre-spec this ran with the suite's `busy` default and pinned the defect
      // (a busy engine cut at stableIdlePolls). Named mutant "UNAVAILABLEVETO":
      // treat 'unavailable' as busy — this hangs to the 30 s timeout.
      mockGetSessionStatus.mockRejectedValue(new Error('session.status unsupported'));
      const result = await runHeadless(
        testModel, testSystemPrompt, testUserMessage, testTaskId, testProject,
        30000, 'build', { pollIntervalMs: 5, stableIdlePolls: 4 }
      );
      expect(result.completed).toBe(true);
      expect(result.summary).toBe('Final output');
    });
```

- [ ] **Step 2: `headless.test.js` — the BL-7 case finalizes its message**

The property under test is "a bare marker mid-content is never a fold delimiter"; the completion path was incidental. Change `time: {}` to `time: { completed: Date.now() }` and the comment:

```js
    it('does NOT fold on a standalone [SIDECAR_FOLD] that is followed by more content (#BL-7)', async () => {
      const echoed = 'To finish I would emit:\n[SIDECAR_FOLD]\n...but I am not done yet, continuing analysis';
      mockGetMessages.mockResolvedValue([{
        info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
        parts: [{ id: 'p1', type: 'text', text: echoed }]
      }]);

      const result = await runHeadless(
        testModel, testSystemPrompt, testUserMessage, testTaskId, testProject,
        30000, 'build', { pollIntervalMs: 5, stableIdlePolls: 3 }
      );
      // Ended via the stable-finished path (the message finalized), NOT the fold
      // marker: the echoed marker is preserved as content, never treated as a
      // delimiter. (Pre-spec 2026-09-11 §3 this exited via the idle heuristic on
      // an unfinalized message while the SDK said busy — the defect shape.)
      expect(result.completed).toBe(true);
      expect(result.summary).toContain('[SIDECAR_FOLD]');
      expect(result.summary).toContain('continuing analysis');
    }, 20000);
```

- [ ] **Step 3: `headless-tool-stall.test.js` — case `(f)` becomes a fallback pin**

Inside the test body, immediately before `const started = Date.now();`, add:

```js
    // Spec 2026-09-11 §3: with the suite's `busy` default this leg would now wait for
    // its message to finalize (which this fixture never does) instead of exiting at
    // 40 stable polls. The property under test — B53 must NOT fire once the tool
    // COMPLETED — is independent of the exit path, so pin it on the fallback path.
    mockGetSessionStatus.mockRejectedValue(new Error('session.status unsupported'));
```

Every assertion in the case stays as is (`elapsed > 20`, no `Tool call stalled`, no abort).

- [ ] **Step 4: `premature-completion.test.js` — the "ALREADY terminal" case finalizes**

Both recorded legs it models completed (their messages finalized 62.3 s and 14.8 s after the last tool). Change

```js
    mockGetMessages.mockResolvedValue([msg('m1', parts)]);
```

to

```js
    // The recorded legs FINALIZED their message after the last tool settled; the
    // gate must be a no-op on the stable-finished path. (Pre-spec 2026-09-11 §3
    // this fixture was unfinalized and exited via the idle heuristic while busy.)
    mockGetMessages.mockResolvedValue([msg('m1', parts, { completed: true })]);
```

and the comment two lines above it from "so the gate must be a no-op." to "so the gate must be a no-op on the finished path." The three assertions stay.

- [ ] **Step 5: Run the four suites — all green**

Run: `npx jest tests/headless.test.js tests/headless-tool-stall.test.js tests/observe/premature-completion.test.js tests/headless-idle-completion.test.js`
Expected: 4 suites PASS, 0 failures.

- [ ] **Step 6: Prove the two remaining named mutants**

Temporarily edit `src/headless.js`: remove `&& liveTools.length === 0` from the veto condition. Run `npx jest tests/observe/premature-completion.test.js`. Expected: **13 FAIL** (the ceiling/abort suite — measured in the probe as exactly this set). Restore the line (`git diff src/headless.js` must show only Task 1's change afterwards). Then temporarily remove `&& lastSdkStatus === 'busy'` → run `npx jest tests/headless-idle-completion.test.js -t "does NOT complete"`. Expected: FAIL. Restore.

- [ ] **Step 7: Commit**

```bash
git add tests/headless.test.js tests/headless-tool-stall.test.js tests/observe/premature-completion.test.js
git commit -m "test(headless): the four cases that pinned the idle-gate defect now pin the fallback and the finished path

Each relied on the stable-idle heuristic ending an UNFINALIZED message while
session.status said busy — the defect fixed in the previous commit. Two become
the fallback pin (status unavailable), two take the recorded legs' real shape
(message finalized). Named mutants UNAVAILABLEVETO and VETOOVERCEILING documented
inline; VETOOVERCEILING measured to redden the 13 B4 ceiling tests.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: CHANGELOG and the one doc paragraph

**Files:**
- Modify: `CHANGELOG.md` (top, above `## [4.9.7] - 2026-09-09`), `docs/council.md` (append a subsection)

**Interfaces:** none.

- [ ] **Step 1: CHANGELOG `[Unreleased]`**

Insert immediately above `## [4.9.7] - 2026-09-09`:

```markdown
## [Unreleased]

### Fixed

- **Headless legs are no longer declared complete while the engine is still answering.** The
  stable-idle heuristic (`headless.js`, the v4.4 B4 "measured defect site") now defers to
  `session.status`: while the engine reports `busy` and no tool call is live, flat output is
  treated as activity rather than silence, and the leg waits for its message to finalize.
  In-flight reasoning and text are invisible to the poller, so a seat that narrated between
  tool calls and then answered for longer than 60 s was harvested mid-answer — three complete
  council deliverables were discarded 39–107 s before they finished in the 2026-09-11 study
  (run D0), and the run reported `complete` with no degrades. The B4 bounded tool-settle
  ceiling is unchanged and still governs whenever a tool call is live. When `session.status`
  is unavailable the heuristic runs as the fallback it was always meant to be.
  (`docs/superpowers/specs/2026-09-11-council-leg-completion-design.md` §3; PR 1 of 3.)
```

- [ ] **Step 2: `docs/council.md` — append**

Append at the end of the file:

```markdown
## Leg completion and `session.status`

A headless leg ends on the first of: the engine reporting `idle`; its last message
finalizing (two stable polls); the no-output backstop; the tool-stall detector; the
tool-settle ceiling (when a tool call never settles); or the leg `--timeout`. The
flat-output heuristic that used to end a leg after 30 stable polls now runs only when
`session.status` is unavailable **or** when a tool call is live (where the bounded ceiling
governs). A busy engine with no live tool is a model still answering — the poller cannot
see its text until the message finalizes — so the leg waits. A busy-but-wedged session
therefore ends by `--timeout`, and is named that.
```

- [ ] **Step 3: Regenerate doc markers if the pre-commit hook asks, then commit**

```bash
git add CHANGELOG.md docs/council.md
git commit -m "docs: changelog + council.md note for the session.status veto (PR 1 of 3)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

(The pre-commit hook regenerates `docs/architecture-map.md` markers; if it leaves that file modified, `git add docs/architecture-map.md && git commit --amend --no-edit` is the repo's pattern — check `git status` after the commit.)

---

### Task 4: Full gates and the PR

**Files:** none modified.

- [ ] **Step 1: The unit gate**

Run: `cd C:\Users\sendt\code\amicus && npm test`
Expected: all suites green (9,851 tests at v4.9.7 plus the one added). `npm test` — not `npx jest` — is what writes `.test-passed` for the current HEAD.

- [ ] **Step 2: The keyless integration tier**

Run: `npm run test:integration`
Expected: green (credentials scrubbed; ~25 s). This PR adds no engine-config change, so the engine-flag canary is unaffected; it is run because `headless.js` changed.

- [ ] **Step 3: Confirm with the owner, then open the PR with the council-review label**

Do not run this step without the owner's go-ahead in chat (opening a PR is outward-facing).

```bash
git push -u origin design/council-leg-completion
gh pr create -R BourbonDog/amicus --base main --head design/council-leg-completion \
  --label council-review \
  --title "fix(headless): stable-idle heuristic defers to session.status busy when no tool is live (leg completion PR 1/3)" \
  --body-file <(cat <<'EOF'
## What

The stable-idle heuristic in `src/headless.js` (the v4.4 B4 "measured defect site") now defers to `session.status`: while the engine reports `busy` and no tool call is live, flat output is treated as activity and the leg waits for its message to finalize. When status is unavailable the heuristic runs as the fallback it was meant to be. The B4 bounded tool-settle ceiling is unchanged and governs whenever a tool call is live.

## Why (measured)

In-flight reasoning/text are invisible to the poller (`outputLength` stays 0 until the message finalizes). A seat that narrates between tool calls arms the gate, and an answer longer than 60 s reads as 30 flat polls. Study run D0 (2026-09-11, `SecondBrain/output/council-leg-study-2026-09-11`): three complete deliverables discarded 39–107 s before they finished while `session.status` said busy on every cut poll (0 idle reports in the trace); the run reported `complete`, exit 0, no degrades. D1 reversed it 3/3 with one variable. Spec: `docs/superpowers/specs/2026-09-11-council-leg-completion-design.md` §3.

## Tests

- New: the D0 shape (busy + narration + unfinalized → waits, then completes with the full text). Mutant BUSYIGNORED reddens it.
- Updated: four cases that pinned the defect (unfinalized message + busy + heuristic exit) — two now pin the fallback (status unavailable), two take the recorded legs' real finalized shape.
- Guard: dropping `liveTools.length === 0` (mutant VETOOVERCEILING) reddens the 13 B4 ceiling/abort tests in `premature-completion` — measured.

PR 1 of 3 (2: council seat agents + `--tools`; 3: `findingsUnverified` surfacing). Release: v4.9.8.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)
```

- [ ] **Step 4: Watch the council run to completion, then read the verdict — not the check**

Read `verdict.json` from the run's artifact: `overallVerdict` and `seatsReviewed`. A degraded run is not a review. Merge only on a completed run with the owner's say-so.

---

## Self-review

**Spec coverage (§3 only — this is PR 1):** record status → Task 1 Step 3; veto on the `!assistantFinished` branch only → Task 1 Step 4 (`!assistantFinished` in the condition); one debug line per deferral → emitted only when a non-zero count is reset (once per flat stretch — deliberate, stated in the code comment); `assistantFinished` branch and the `output > 0` guard unchanged → yes; unavailable permits the heuristic → `lastSdkStatus = 'unavailable'` never equals `'busy'`; no new runStats/ledger field → none; tests (a)(b)(c) → (a) Task 1 Step 1, (b) Task 2 Step 1 (moved from the idle-completion file to the case that already existed in `headless.test.js`, to avoid a duplicate), (c) the existing `'SDK idle status with output'` case, untouched; BUSYIGNORED → Task 1 Step 1 / Task 2 Step 6; the two neighbouring suites → Task 2 covers what actually broke (measured), plus `headless-tool-stall` which the spec did not list; the B4 ceiling interplay (not in the spec's test list, found by the probe) → Task 2 Step 6 mutant VETOOVERCEILING. Live replay → §7 release ritual, out of this PR's gate.

**Placeholder scan:** none.

**Type/name consistency:** `lastSdkStatus` (Task 1 Steps 3–4), `liveTools` (:884/:999, read in Step 4), `assistantFinished` (:992), `mockGetSessionStatus` (all four suites), `msg(id, parts, { completed })` (premature-completion :101) — all as they exist in the tree at `db48ffbc`.
