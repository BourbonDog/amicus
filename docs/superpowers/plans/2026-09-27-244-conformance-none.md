# A row with no checked output says `conformance: none` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `runStats` row says `conformance: clean` only when a check said so; a row whose leg never returned or whose output was never used says `none`.

**Architecture:** One default changes in the ONE row builder (`buildRunStatsEntry`: `'clean'` → `'none'`), the one success on that default path passes `'clean'` explicitly, one explicit false `'clean'` (a dead Stage-2 judge) becomes `'none'`, and `none` gets rank −1 in both `CONFORMANCE_RANK` tables so it never wins a worst-wins merge. Docs and the CHANGELOG follow; no schema changes.

**Tech Stack:** Node.js CommonJS, Jest (the repo's own `jest.config.js`), the 300-line size gate, the citation gate.

**Spec:** `docs/superpowers/specs/2026-09-27-244-conformance-none-design.md` (commit `8e6746cf`). Read it first; this plan argues from it.

**Validated before writing:** every test block below was run at HEAD (`8e6746cf`) and against the change on this machine (2026-09-27). At HEAD exactly the tests marked RED fail (8 tests in 6 files) and every GREEN-at-HEAD test passes; with the change all six files pass; and each named mutant in Task 2 Step 9 is killed by the tests listed beside it. A full-suite run with the change applied failed exactly the three tests that Task 2 Step 6 updates (11,190 tests, 3 failed). The validated diff is at `C:/Users/sendt/code/amicus-244-scratch/validated-reference.patch`. Consult it only if a step is ambiguous, and prefer the plan text.

## Global Constraints

- **Where:** the worktree `C:/Users/sendt/code/amicus-244-conformance`, branch `fix/244-conformance-none`. Never touch the main clone `C:/Users/sendt/code/amicus`. Bash is Git Bash on Windows: forward slashes, and `git -C <worktree>` or `cd <worktree> && …` inside one command.
- **Never** run `npm install` (nothing needs installing), the `amicus` CLI (it spends real money), or any integration test. Never read `.env`.
- **One-file test runs (the only sanctioned way):**
  ```bash
  cd /c/Users/sendt/code/amicus-244-conformance && ONE_TEST=tests/council/<file>.test.js npx jest --config /c/Users/sendt/code/amicus-244-scratch/jest-one.config.js --listTests
  ```
  It must print exactly ONE path. Then run the same command without `--listTests`. That config extends the repo's `jest.config.js` (hermetic config dir, ignore patterns) and narrows only `testMatch`. **Never** put `-t`, `--testPathPattern`, `--testPathIgnorePatterns` or `--testMatch` on a jest command line.
- **Full gate** (Task 3's last step, and before any claim of "done"): `npm test` from the worktree (0 failures; report the totals it prints, do not predict them), `npm run lint`, `npm run check:sizes`, `npm run check:citations`, each exiting 0. Never pipe a gate through `| tail` when its exit code is the evidence.
- **Size gate:** `src/council/run-assemble.js` is at 298/300. Every edit there is same-line (a trailing comment at most), so its line count stays 298. The other touched src files have headroom (run-stats-entry.js 138, ledger.js 249, run-stage2-judge.js 283).
- **`src/council/run-stats-entry.js` is REQUIRE-FREE**, pinned by `tests/council/run-stats-entry.test.js` P3. That pin scans the raw text for `require` immediately followed by `(`, comments included, so never write that sequence in this file, not even in prose.
- **Do not edit `BACKLOG.md`** (spec §2 R6: the backlog consolidation records this work).
- **Commits:** write the message to a file (e.g. `C:/Users/sendt/code/amicus-244-scratch/msg.txt`) and run `git commit -F <file>`; never a heredoc or `-m` with multi-line text. Never write `close`/`closes`/`closed`, `fix`/`fixes`/`fixed` or `resolve`/`resolves`/`resolved` directly before `#<number>` anywhere in a message. Every message ends with the trailer line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never `--no-verify`. Never push.
- **Citations in new comments:** prefer symbol anchors (`file.js :: symbol`). If you write `file.js:NNN`, re-open that file at that line in the final tree and confirm it is the line you mean.
- **Stop and report** (NEEDS_CONTEXT) instead of improvising if any expected RED does not fail at HEAD, any expected GREEN fails, a `replace` target is not found exactly once, or a gate fails for a reason you cannot explain from your own diff.
- **Evidence:** every RED/GREEN claim in your report quotes the runner's own `Tests:` line and the failing test titles, from a run you actually made.

## File map

| File | Change | Task |
|---|---|---|
| `src/council/run-assemble.js` | `CONFORMANCE_RANK` gains `none: -1` (same line); `claudeRunStatsRow` passes `conformance: 'clean'` (same line) | 1, 2 |
| `src/council/ledger.js` | the documented local copy of `CONFORMANCE_RANK` gains `none: -1`, plus one comment line | 1 |
| `src/council/run-stats-entry.js` | the default becomes `'none'`; the docblock states the rule | 2 |
| `src/council/run-stage2-judge.js` | the unusable-judge row: `'clean'` → `'none'` for a leg that did not complete, plus one comment line | 2 |
| `tests/council/ledger.test.js` | new T13d | 1 |
| `tests/council/run-stats-entry.test.js` | new describe (3 tests) | 2 |
| `tests/council/conformance-none.test.js` | NEW, end to end through `runCouncil` (3 tests) | 2 |
| `tests/council/run-chair.test.js` | two assertions in the give-up test | 2 |
| `tests/council/runstats-byte-order.test.js`, `tests/council/run-stages.test.js` | the three pins that encoded the old default | 2 |
| `CHANGELOG.md`, `docs/council.md`, `skills/second-opinion/SKILL.md`, `skills/second-opinion/MANUAL-ORCHESTRATION.md`, `docs/superpowers/specs/2026-06-23-ws3-council-trust-spine-design.md` | the vocabulary and the default | 3 |

---

### Task 1: `none` ranks below `clean` in both rank tables

**Files:**
- Modify: `src/council/run-assemble.js` (the `const CONFORMANCE_RANK = …` line)
- Modify: `src/council/ledger.js` (its local `const CONFORMANCE_RANK = …` line, after the "v4.8 PR4b (R4b-4)" comment)
- Test: `tests/council/ledger.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `CONFORMANCE_RANK.none === -1` in both tables, so `worseConformance` (run-assemble.js) and `mergeConformance` (ledger.js) return the non-`none` argument whenever one side is `none`, in either position. Task 2 relies on this, because the ledger fold must keep a twin's real value.

- [ ] **Step 1: Write the failing test.** In `tests/council/ledger.test.js`, insert this test immediately after the test titled `'T13b — the conformance fold is seeded from the group FIRST row, so an unknown value survives'` (after its closing `});`, inside the same `describe`, where `rec` and `rsRow` are in scope):

```js
  test('T13d — none (#244: no checked output) ranks BELOW clean in both tables, so a real value wins from either position', () => {
    // An unknown value ranks 0 and survives in position 0 (T13c), so without its own rank a
    // dead twin listed first would fold a model's ledger row to none although its other twin
    // reviewed cleanly. Named mutants: NONERANKLEDGER (delete `none: -1` from ledger.js) and
    // NONERANKASM (delete it from run-assemble.js) each red this test, and T13a's table
    // equality, on their own.
    expect([CONFORMANCE_RANK.none, ASM_CONFORMANCE_RANK.none]).toEqual([-1, -1]);
    for (const merge of [mergeConformance, worseConformance]) {
      expect([merge('none', 'clean'), merge('clean', 'none')]).toEqual(['clean', 'clean']);
      expect([merge('none', 'repaired'), merge('unstructured', 'none')]).toEqual(['repaired', 'unstructured']);
      expect(merge('none', 'none')).toBe('none');
    }
    const row = (conformance) => rsRow({ model: 'alpha', conformance, resolvedModel: 'v/a',
      status: conformance === 'none' ? 'error' : 'complete' });
    const fold = (a, b) => buildLedgerRows(rec({ models: ['alpha'], runStats: [row(a), row(b)] }))[0].conformance;
    expect([fold('none', 'clean'), fold('clean', 'none')]).toEqual(['clean', 'clean']);
    expect(fold('none', 'none')).toBe('none');
  });
```

- [ ] **Step 2: Run it and confirm it fails.** Use the one-file recipe with `ONE_TEST=tests/council/ledger.test.js`. Expected: `Tests: 1 failed, 74 passed, 75 total`, and the failing title is T13d (at HEAD `CONFORMANCE_RANK.none` is `undefined`).

- [ ] **Step 3: Implement.** In `src/council/run-assemble.js`, replace the line
  `const CONFORMANCE_RANK = { clean: 0, repaired: 1, unstructured: 2 };`
  with (ONE line, so the file stays at 298):
  `const CONFORMANCE_RANK = { none: -1, clean: 0, repaired: 1, unstructured: 2 }; // #244: none = no ask was checked; ranks BELOW clean so it never wins a merge (ledger.test.js T13d)`
  In `src/council/ledger.js`, replace its local line
  `const CONFORMANCE_RANK = { clean: 0, repaired: 1, unstructured: 2 };`
  with these two lines:
  ```js
  // #244 residue: `none` (no ask was checked) ranks BELOW `clean`, so a twin's real value always wins the fold (T13d).
  const CONFORMANCE_RANK = { none: -1, clean: 0, repaired: 1, unstructured: 2 };
  ```

- [ ] **Step 4: Run it and confirm it passes.** Run `ONE_TEST=tests/council/ledger.test.js` (one-file recipe). Expected: `Tests: 75 passed, 75 total`. T13a passes too: its sweep derives its values from both tables' keys, so `none` enters it automatically. Then run `npm run check:sizes` and confirm it exits 0, with run-assemble.js still at 298 lines (`wc -l src/council/run-assemble.js`).

- [ ] **Step 5: Commit.** Write the message below to `C:/Users/sendt/code/amicus-244-scratch/msg.txt` with the editing tool, then run:
  ```bash
  cd /c/Users/sendt/code/amicus-244-conformance && git add src/council/run-assemble.js src/council/ledger.js tests/council/ledger.test.js && git commit -F /c/Users/sendt/code/amicus-244-scratch/msg.txt
  ```
  Message:
  ```
  fix(council): conformance none ranks below clean in both rank tables (#244 residue)

  A row with no checked output is about to say 'none'. An unknown value ranks 0 and
  wins a tie from position 0, so a dead twin listed first would fold a model's ledger
  row to 'none' although its other twin reviewed cleanly. Rank -1 in run-assemble.js
  and in ledger.js's documented local copy makes every merge prefer the real value in
  either order. T13d pins it; T13a's table equality covers the copy.

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

---

### Task 2: a row says `clean` only when a check said so

**Files:**
- Modify: `src/council/run-stats-entry.js` (the `conformance:` line in `buildRunStatsEntry`, plus its docblock)
- Modify: `src/council/run-assemble.js` (`claudeRunStatsRow`, same line)
- Modify: `src/council/run-stage2-judge.js` (`adjudicateJudgeLeg`'s unusable-judge `judgeResults.push`)
- Create: `tests/council/conformance-none.test.js`
- Modify tests: `tests/council/run-stats-entry.test.js`, `tests/council/run-chair.test.js`, `tests/council/runstats-byte-order.test.js`, `tests/council/run-stages.test.js`

**Interfaces:**
- Consumes: Task 1's rank (`none` never wins a merge).
- Produces: `buildRunStatsEntry({...})` with no `conformance` returns a row whose `conformance === 'none'`. An explicit `conformance` is returned verbatim. `claudeRunStatsRow().conformance === 'clean'`. An unusable judge whose leg did not complete has `judgeResults[].conformance === 'none'`, and its runStats row carries it (run-assemble.js's judge row copies `j.conformance`).

- [ ] **Step 1: Write the builder tests.** Append at the END of `tests/council/run-stats-entry.test.js` (after the last `});`):

```js

/**
 * #244 residue — a row says `clean` only when a check said so
 * (docs/superpowers/specs/2026-09-27-244-conformance-none-design.md). Every production
 * caller that relies on the default describes a leg nobody checked: a dead seat, a
 * superseded first attempt, a failed chair attempt, the chair give-up row. So the default
 * is `none`, and the one success on the default path — the Claude seat's validated file
 * review — passes `clean` itself.
 */
describe('run-stats-entry — conformance defaults to none (#244 residue)', () => {
  test('no conformance passed: none, whatever the leg (absent, dead, timed out, complete, promoted)', () => {
    const legs = [null, { status: 'error' }, { status: 'timeout' }, { status: 'complete' },
      { status: 'complete', promoted: true }];
    // one pair per leg shape, so a failure names the shape
    expect(legs.map(leg => [leg, rse.buildRunStatsEntry({ leg, model: 'alpha', role: 'seat' }).conformance]))
      .toEqual(legs.map(leg => [leg, 'none']));
  });

  test('an explicit conformance always wins, clean included (named mutant EXPLICITIGNORED)', () => {
    // EXPLICITIGNORED: replace `conformance || 'none'` with the constant `'none'`.
    for (const conformance of ['clean', 'repaired', 'unstructured', 'none']) {
      expect(rse.buildRunStatsEntry({ leg: { status: 'complete' }, model: 'alpha', role: 'seat', conformance })
        .conformance).toBe(conformance);
    }
  });

  test("the Claude seat's validated file review passes clean itself (named mutant CLAUDENOTCLEAN)", () => {
    // CLAUDENOTCLEAN: delete `conformance: 'clean'` from run-assemble.js :: claudeRunStatsRow.
    // The row then takes the builder's default and reads none: a valid review called unchecked.
    expect(asm.claudeRunStatsRow().conformance).toBe('clean');
  });
});
```

- [ ] **Step 2: Write the end-to-end tests.** Create `tests/council/conformance-none.test.js` with exactly:

```js
// tests/council/conformance-none.test.js
'use strict';

/**
 * #244 residue — a runStats row says `clean` only when a check said so
 * (docs/superpowers/specs/2026-09-27-244-conformance-none-design.md).
 *
 * Driven end to end through runCouncil with the scripted launchers, so the value is
 * read where a user meets it — verdict.json — and not at the builder, which
 * run-stats-entry.test.js pins separately. One run carries both producers the fix
 * touches: gpt's Stage-1 leg dies (a dead-seat row built on the builder's default),
 * and qwen's Stage-2 judge leg dies (run-stage2-judge.js :: adjudicateJudgeLeg's
 * unusable-judge row). The living seat and judge are the controls: their rows keep
 * the value their own check produced. Three tests, one fact each, so each can be
 * seen failing on its own.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { runCouncil } = require('../../src/council/run');
const { scriptedLaunchers, baseOptions, review, judgeOut, mkLeg, okWave } =
  require('./helpers/fake-launchers');

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'conformance-none-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const deps = (launchers) => ({ launchers, appendRunFn: jest.fn(), statsFn: () => [],
  installSignalAbortFn: () => () => {} });

/** Runs the one council the three tests read; returns a (model, role) → rows lookup. */
async function runWithDeadSeatAndDeadJudge() {
  const spy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  try {
    const script = {
      // gpt's leg times out and its once-only retry returns no legs, so the seat is lost.
      'abc123-s1': () => okWave([
        mkLeg('gemini', review('gemini')),
        mkLeg('gpt', '', 'timeout'),
        mkLeg('qwen', review('qwen')),
      ], 2, 'partial'),
      'abc123-s1r1': () => okWave([]),
      // The survivors judge; qwen's judge leg dies. A dead judge never enters the repair
      // loop (it requires a completed leg with a summary), so no -q wave is launched.
      'abc123-s2': (o) => okWave(o.models.map(m => (m === 'qwen'
        ? mkLeg(m, '', 'error')
        : mkLeg(m, judgeOut(['Review A', 'Review B'], []))))),
      'abc123-ch1': (o) => okWave([mkLeg(o.model, 'Synthesis.\n\nVERDICT: Ship it')]),
    };
    const opts = baseOptions(tmp);
    await runCouncil(opts, deps(scriptedLaunchers(script)));
    const verdict = JSON.parse(fs.readFileSync(path.join(opts.runDir, 'verdict.json'), 'utf-8'));
    return (model, role) => verdict.runStats.filter(r => r.model === model && r.role === role);
  } finally { spy.mockRestore(); }
}

test('a dead Stage-1 seat reads conformance none in verdict.json, not clean', async () => {
  const rows = await runWithDeadSeatAndDeadJudge();
  expect(rows('gpt', 'seat').length).toBeGreaterThan(0);          // non-vacuity: the row exists
  expect(rows('gpt', 'seat').map(r => r.conformance)).toEqual(rows('gpt', 'seat').map(() => 'none'));
});

test('a dead Stage-2 judge reads conformance none in verdict.json, not clean', async () => {
  const rows = await runWithDeadSeatAndDeadJudge();
  expect(rows('qwen', 'judge').map(r => [r.status, r.conformance])).toEqual([['error', 'none']]);
});

test('controls: the completed seat and the completed judge keep the value their check found', async () => {
  const rows = await runWithDeadSeatAndDeadJudge();
  expect(rows('gemini', 'seat').map(r => r.conformance)).toEqual(['clean']);
  expect(rows('gemini', 'judge').map(r => r.conformance)).toEqual(['clean']);
});
```

  ⚠️ The `'Synthesis.\n\nVERDICT: Ship it'` literal must reach the file as a backslash-n escape inside a JS string (two characters), not as a raw newline. Write the file with the editing tool as shown (measured 2026-09-27: it writes `\n` as the two characters), then confirm with `node --check tests/council/conformance-none.test.js`, which must exit 0. A raw newline inside that single-quoted string is a SyntaxError, so `--check` exits 1 (measured on a known-bad file). Do NOT use a grep for this. This harness collapses doubled backslashes in a command, so a backslash grep pattern does not reach grep as written.

- [ ] **Step 3: Add the chair give-up assertions.** In `tests/council/run-chair.test.js`, in the test titled `'give-up after a walk: chairRows carry every failed attempt; no row has wasChair true'`:
  - Directly after the line `expect(attemptRows.map(r => r.waveId)).toEqual(['abc123-ch1', 'abc123-ch2']);`, add:
    ```js
        // #244 residue: a failed attempt was never checked, so it is not `clean`.
        expect(attemptRows.map(r => r.conformance)).toEqual(['none', 'none']);
    ```
  - Directly after that test's `expect('waveId' in giveUpRows[0]).toBe(false);` line, still inside the test, add:
    ```js
        // #244 residue: the give-up row has no leg at all, so nothing was checked.
        expect(giveUpRows[0].conformance).toBe('none');
    ```
  (`tests/council/run-chair-seam.test.js` has a similar give-up block. Do NOT edit it; this task pins the value once.)

- [ ] **Step 4: Run the new and changed files and confirm the designed RED set** (one-file recipe each):
  - `run-stats-entry.test.js` → `1 failed, 22 passed, 23 total`, the failing test being `no conformance passed: none, whatever the leg …`. (EXPLICITIGNORED and CLAUDENOTCLEAN pass at HEAD. They are preservation pins, proven in Step 9.)
  - `conformance-none.test.js` → `2 failed, 1 passed, 3 total`: the dead-seat and dead-judge tests fail; the controls pass.
  - `run-chair.test.js` → `1 failed, 51 passed, 52 total`: the give-up test.
  If any count differs, stop and report NEEDS_CONTEXT.

- [ ] **Step 5: Implement.**
  1. `src/council/run-stats-entry.js`: in `buildRunStatsEntry`'s returned object, replace
     `conformance: conformance || 'clean',`
     with
     `conformance: conformance || 'none', // #244: a row says clean only when a check said so (docblock)`
     Then add this paragraph to the function's docblock (the `/** … */` directly above `function buildRunStatsEntry`), before its closing ` */`. Remember the require-free constraint in this file:
     ```
      *
      * `conformance` (#244 residue, 2026-09-27) is the asks-to-parse axis: `clean` (the
      * first ask parsed), `repaired` (a later ask parsed), `unstructured` (no ask parsed),
      * and its DEFAULT is `none`, meaning no ask was checked. Every production caller that
      * passes no conformance describes a leg nobody checked (a dead seat, a superseded
      * first attempt, a failed chair attempt, the chair give-up row), so a row says `clean`
      * only when a check said so. The one success on the default path,
      * run-assemble.js :: claudeRunStatsRow (the orchestrator's validated review file),
      * passes `clean` itself. `none` ranks BELOW `clean` in both CONFORMANCE_RANK tables,
      * so it never wins a worst-wins merge.
     ```
  2. `src/council/run-assemble.js`, in `claudeRunStatsRow`, replace (ONE line, so the file stays at 298)
     `  return buildRunStatsEntry({ leg: { status: 'complete' }, model: CLAUDE_SEAT, role: CLAUDE_SEAT });`
     with
     `  return buildRunStatsEntry({ leg: { status: 'complete' }, model: CLAUDE_SEAT, role: CLAUDE_SEAT, conformance: 'clean' }); // #244: the one default-path success — its file was validated (named mutant CLAUDENOTCLEAN)`
  3. `src/council/run-stage2-judge.js`, in `adjudicateJudgeLeg`'s unusable-judge `judgeResults.push({...})`, replace
     `      conformance: leg.status === 'complete' ? 'unstructured' : 'clean',`
     with
     ```js
           // #244 residue: a judge that never returned had no ask checked — 'none', never 'clean' (named mutant DEADJUDGECLEAN).
           conformance: leg.status === 'complete' ? 'unstructured' : 'none',
     ```

- [ ] **Step 6: Update the three pins that encoded the old default.** Each asserted `clean` on a row whose leg nobody checked. Change only the value, and leave the titles and everything else alone:
  - `tests/council/runstats-byte-order.test.js`, test `'G4a — a leg-absent entry emits SEVEN keys and nothing else'`: in the golden string, `"conformance":"clean",` → `"conformance":"none",`.
  - `tests/council/run-stages.test.js`, test `'T2.2 control: a UNIQUE-alias bench with two orphaned legs is byte-unchanged'`: in its `row` helper, `conformance: 'clean',` → `conformance: 'none',` (the four rows are two superseded first attempts and two still-dead seats).
  - `tests/council/run-stages.test.js`, test `'T2.2 review A1: a borrowed spare is BILLING ONLY — the row asserts no execution it cannot own'`: in the final `expect(uniq).toEqual({ … conformance: 'clean', …` → `conformance: 'none',` (a timed-out dead seat).

- [ ] **Step 7: Run all six files and confirm green** (one-file recipe each): `run-stats-entry` 23/23, `ledger` 75/75, `run-chair` 52/52, `runstats-byte-order` 30/30, `run-stages` 150/150, `conformance-none` 3/3. Then run `npm test` (full suite) and confirm 0 failures, reporting the totals it prints. If any test OTHER than the three in Step 6 now fails, stop and report NEEDS_CONTEXT with its title and assertion. Do not edit it. Run `npm run check:sizes`, and confirm `wc -l src/council/run-assemble.js` prints 298.

- [ ] **Step 8: Commit.** Write the message below to `C:/Users/sendt/code/amicus-244-scratch/msg.txt` (editing tool), stage the 4 changed test files, the new test file and the 3 src files by name, and run `git commit -F /c/Users/sendt/code/amicus-244-scratch/msg.txt`. Message:
  ```
  fix(council): a runStats row says clean only when a check said so (#244 residue)

  buildRunStatsEntry defaulted conformance to 'clean', and every production caller
  that relies on the default describes a leg nobody checked: a dead seat, a
  superseded first attempt, a failed chair attempt, the chair give-up row. The
  default is now 'none'. claudeRunStatsRow, the one success on that path, passes
  'clean' itself, and an unusable Stage-2 judge whose leg never returned is 'none'
  instead of an explicit 'clean'. Three pins that asserted 'clean' on such rows now
  assert 'none'. A new end-to-end file reads the dead seat's and the dead judge's
  rows in verdict.json.

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

- [ ] **Step 9: Prove the preservation pins and the ranks with the named mutants.** This step runs only after the commit, on a clean tree:
  ```bash
  cd /c/Users/sendt/code/amicus-244-conformance && git status --porcelain && node /c/Users/sendt/code/amicus-244-scratch/mutants.js; echo "exit=$?"; git status --porcelain
  ```
  Both `git status --porcelain` runs must print nothing. The harness first runs a HARNESS-IS-LIVE mutant that must be KILLED, then restores every file byte-identically. Expected:
  - every mutant KILLED;
  - NONERANKLEDGER and NONERANKASM each by T13a + T13d;
  - CLAUDENOTCLEAN only by the Claude-seat test;
  - EXPLICITIGNORED by the explicit-wins test (and two others);
  - DEADJUDGECLEAN only by the dead-judge test;
  - DEFAULTCLEAN by the builder default test, the dead-seat test, the give-up test, G4a and both run-stages pins.

  Paste the harness output into your report. A SURVIVED mutant is a finding: report it and do not add tests to kill it.

---

### Task 3: docs and CHANGELOG say `none`

**Files:**
- Modify: `CHANGELOG.md` (`## [Unreleased]`)
- Modify: `docs/council.md` (the stats table's `conformance` row; the `judge-reasoning-only` paragraph)
- Modify: `skills/second-opinion/SKILL.md`, `skills/second-opinion/MANUAL-ORCHESTRATION.md` (2 lines)
- Modify: `docs/superpowers/specs/2026-06-23-ws3-council-trust-spine-design.md` (one note)

**Interfaces:** consumes the behaviour Tasks 1–2 shipped; produces no code.

- [ ] **Step 1: CHANGELOG.** In `## [Unreleased]`, insert a `### Changed` section between the existing `### Added` block and `### Fixed` (Keep a Changelog order), containing exactly:

```markdown
### Changed

- **A `runStats` row whose leg produced nothing that was checked now says `conformance: none`,
  not `clean`.** `conformance` records which ask parsed: `clean` the first, `repaired` a later
  one, `unstructured` none. A leg that never returned, or whose output was never used, had no ask
  checked at all, and 4.14.0 documented such a row as carrying `clean` by default. It now carries
  `none`. That covers a dead or promoted Stage-1 seat, a first attempt its retry superseded, a
  failed chair attempt, the chair give-up row, and a Stage-2 judge that never returned. The same
  rows reach the reliability ledger, so `amicus council stats` counts them under `none` instead of
  adding a model's dead legs to its `clean` count. `none` ranks below `clean` wherever rows merge,
  so a model whose twin reviewed still records `clean`. Ledger rows written by earlier releases
  are unchanged, so a model's history mixes their `clean`-for-dead rows with new `none` rows. (#244)
```

- [ ] **Step 2: `docs/council.md`, the stats table row.** Replace the row
  ``| `conformance` | Tally of `{clean, repaired, unstructured}` counts — how often this model's Stage-1 findings JSON needed a repair re-prompt. |``
  with
  ``| `conformance` | Tally of `{clean, repaired, unstructured, none}` counts — how often this model's Stage-1 findings JSON needed a repair re-prompt. `none` counts the runs in which none of its bench legs produced anything to check (each died, timed out, was superseded or answered only in its reasoning channel); ledger rows written by earlier releases recorded those runs as `clean`. |``

- [ ] **Step 3: `docs/council.md`, the `judge-reasoning-only` paragraph.** It contains the sentence beginning ```conformance` is the`` followed by `ASKS-TO-PARSE axis and nothing else:`. Replace the exact text from `ASKS-TO-PARSE axis and nothing else:` through `whose three values are` + newline + `unchanged.` with:
  ```
  ASKS-TO-PARSE axis and nothing else: `clean` = the first ask parsed, `repaired` = a later ask
  parsed, `unstructured` = no ask parsed, `none` = no ask was checked at all (#244: a leg that
  never returned or whose output was never used — a dead seat or judge, a superseded first
  attempt, a failed chair attempt, the chair give-up row; earlier releases stamped such a row
  `clean` by default). So a relaunch-rescued judge is `repaired` because a later
  ask parsed, and a stood-down promoted judge is `unstructured` because none did; the CAUSE lives
  on the row's `role`/`promoted` and in the note, never on `conformance`.
  ```
  Keep the next sentence (`The record therefore tells a relaunch from a repair on its own — …`) starting right after `conformance`. on the same line, as the original did.

- [ ] **Step 4: The skill docs.**
  - `skills/second-opinion/SKILL.md`: replace ``per-model `conformance` (`clean` | `repaired` | `unstructured`) is in`` with ``per-model `conformance` (`clean` | `repaired` | `unstructured`, or `none` for a leg that produced nothing to check) is in``.
  - `skills/second-opinion/MANUAL-ORCHESTRATION.md`:
    - replace ``Record per-model **conformance** (`clean` | `repaired` | `unstructured`) for inclusion`` with ``Record per-model **conformance** (`clean` | `repaired` | `unstructured`, or `none` for a leg that produced nothing to check) for inclusion``;
    - replace ``and `conformance` (`clean` | `repaired` | `unstructured`) as council-domain labels.`` with ``and `conformance` (`clean` | `repaired` | `unstructured` | `none` — `none` for a leg with no run doc or nothing to check) as council-domain labels.``.

- [ ] **Step 5: The old spec** (specs are permanent, so a reader can still copy from them). In `docs/superpowers/specs/2026-06-23-ws3-council-trust-spine-design.md`, directly after the sentence that begins ``Per-model **conformance** (`clean` | `repaired` | `unstructured`) is recorded`` and ends `in the ledger.`, append on the same paragraph:
  `` (2026-09-27: a fourth value, `none` — no ask was checked — marks a leg that never returned or whose output was never used; see `2026-09-27-244-conformance-none-design.md`.)``

- [ ] **Step 6: Sweep in both directions and report the results uncapped.**
  - Phrase: `git grep -n -E "three values|carries \`clean\`|\{clean, repaired, unstructured\}|\`clean\` \| \`repaired\` \| \`unstructured\`\)" -- docs README.md skills CHANGELOG.md` (measured at `8e6746cf`, before this plan was committed: 13 hits; `git grep` searches tracked files only, so once this plan is committed its own lines match too). After Steps 1–5 the ONLY hits allowed are:
    - `CHANGELOG.md` in the released `[4.14.0]` section ("`conformance` keeps its three values", which was history and true then);
    - `docs/superpowers/plans/2026-07-19-v4.1-skill-on-engine.md` (a pruned-at-release plan);
    - the ws3 spec line that Step 5 annotated;
    - lines of the #244 spec and of this plan.

    Any other hit is a sentence you missed. Fix it and name it in your report.
  - Target: `git grep -n "conformance" -- docs/*.md README.md skills`. Read each hit and confirm none states the old default or a three-value vocabulary as current. List the hits you judged and why.

- [ ] **Step 7: Full gate.** From the worktree: `npm test` (0 failures, report the printed totals), `npm run lint`, `npm run check:sizes`, `npm run check:citations`, each exit 0. The docs-driven parameterized suites can move the test count: report it, never predict it.

- [ ] **Step 8: Commit.** Write the message below to `C:/Users/sendt/code/amicus-244-scratch/msg.txt` (editing tool), stage the five doc files by name, and run `git commit -F /c/Users/sendt/code/amicus-244-scratch/msg.txt`. Message:
  ```
  docs: conformance none — the fourth value and the new default (#244 residue)

  CHANGELOG ### Changed: a row whose leg produced nothing checked says none, the
  ledger and council stats count it, and old ledger rows are unchanged.
  docs/council.md's stats row and judge-reasoning-only paragraph (which documented
  the clean default in 4.14.0), the second-opinion skill's two conformance lists,
  and a dated note in the ws3 spec.

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

---

## After the tasks

- A whole-branch review (the most capable model) over `git diff 8e08a63d..HEAD`, briefed with the spec, this plan and failure-mode catalog entries #10–#14 (twins, fences, the docs promise), #19 (every terminal write), #42 (a sentence true on every document it can render on, including an old `verdict.json` that still says `clean` for a dead row).
- Nothing is pushed or opened as a PR until the owner says so. Then comes a `council-review`-labelled round, which the owner labels.
