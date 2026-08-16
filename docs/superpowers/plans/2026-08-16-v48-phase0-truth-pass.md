# v4.8.0 Phase 0 — Truth Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the stale and measurably-wrong records in `BACKLOG.md`'s v4.8.0 seat-identity
area — and the three false source/test comments they endorse — so that no later phase implements a
fix the recon already disproved.

**Architecture:** Doc-only, one PR, six commits. Five tasks edit `BACKLOG.md` only; one task
(Task 3) additionally edits two comment blocks in `src/council/run-assemble.js` and
`tests/council/run-assemble.test.js` with **zero behaviour change**. Nothing here changes an
executing line.

**Tech Stack:** Node.js, Jest, `scripts/check-file-sizes.js`, `scripts/validate-docs.js`, ESLint.

**Governing record:** `docs/superpowers/plans/2026-08-16-v48-phasing-and-rulings.md` (on `main`).
That memo is the verified substrate — every verdict in it was established by execution and then
adversarially re-measured. **Do not re-derive it, and do not contradict it without measuring.**

**Base:** `main` = `17b6b6f2`. Branch `v48p0-truth-pass`.

---

## Global Constraints

- **Verification by EXECUTION, never by assertion.** Every numeric claim you write into
  `BACKLOG.md` must be produced by a command you ran in this task. Every citation must be traced
  to the executing line. Quote the command and its output in your report. This series' documented
  recurring failure is exactly this — a property asserted by reasoning about code structure and
  broken by measurement.
- **Citation rot is PER-CITATION, not per-item.** Re-derive an anchor by its symbol or its quoted
  title text; never discard an item's other anchors because one number moved. Worked example,
  measured: `BACKLOG.md:2574` at `53cd689c` is the `seatKey` filing; on `main` = `17b6b6f2` the
  same filing is at `:2656` — the SCOPE RULED banner shifted it **+82** lines. The citation was
  correct and rotted; the item is intact.
- **Line numbers inside `BACKLOG.md` rot WITHIN this PR.** Each task edits the file, so every task
  after Task 1 must locate its target by the **quoted title text** given in the task, not by the
  line number. The line numbers in this plan are as-of `17b6b6f2` and are navigation hints only.
- **`src/council/run-assemble.js` must remain at most 297 lines.** It is 297/300 today and Task 1.1
  of Phase 1 extracts it to 247. Task 3's comment correction must have a **net line delta of ≤ 0**
  in that file. The 300-line gate blocks the COMMIT, not the edit — and when it fires the answer is
  to EXTRACT, never to shave comments.
- **Never run `git checkout -- <path>`.** It destroys uncommitted work.
- **Do not touch any executing line.** Task 3's source edits are comment-only. If a correction
  seems to require a code change, stop and report it — that is a Phase 2+ finding, not Phase 0.
- **The SCOPE RULED banner's "Traps" list stays.** Trap #1 at `BACKLOG.md:1857` quotes SI-04's
  wrong expression *as a warning*. Task 2 deletes the **prescription** inside SI-04's own entry; it
  does **not** delete the banner's warning.
- **Commit per task**, message prefix `docs:` (Task 3: `docs:` — it is comment-only).
- `gh` requires `-R BourbonDog/amicus`. A bare `gh` defaults to upstream `jrenaldi79/sidecar`.
- Hooks live in `.husky` (core.hooksPath). `pre-push` runs the full unit suite and blocks; run
  `npm test` first so `posttest` writes `.test-passed` and the hook skips.

### Gates — all four must exit 0 before every commit

```bash
npm test
```
```bash
node scripts/check-file-sizes.js --all
```
```bash
npm run lint
```
```bash
npm run validate-docs
```

Baseline at `17b6b6f2`: **529 suites / 7472 passed / 8 skipped / 0 failed.** A doc-only task may
report the suite unchanged; Task 3 must run it because it edits a test file.

---

## The SI-number → `BACKLOG.md` map (measured at `17b6b6f2`)

The memo indexes the 27 items as SI-01…SI-27. They are the 27 `- [ ]` entries between
`BACKLOG.md:1980` and `:2383`. The ones this plan touches:

| SI | Line @`17b6b6f2` | Unique title text to search for |
|----|------------------|----------------------------------|
| SI-01 | 1980 | `[SHIPPED v4.8.0 PR5a — see the note below] Hard prerequisite for PR5` |
| SI-04 | 2083 | ``peer filter is now UNBLOCKED — both sides carry a seat`` |
| SI-07 | 2103 | ``the R8 `sameModelCorroboration` stamp`` |
| SI-08 | 2109 | ``` `meta.seats` is still absent from the tally input ``` |
| SI-09 | 2115 | ``` but NOT `findings[].raiserSeat` ``` |
| SI-11 | 2151 | `performs the identical` (in the `matrix-model.js` entry) |
| SI-15 | 2222 | `A maintainability note (from the auto-review).` |
| SI-21 | 2305 | ``` `lens` and `position` are unrecoverable from the tally artifacts ``` |
| SI-22 | 2316 | `Five seat shapes the #137 peer fix does not close.` |
| SI-27 | 2383 | `The roster-padding block is duplicated three times` |

Outside that range, in the PR5c section:

| Filing | Line @`17b6b6f2` | Unique title text |
|--------|------------------|-------------------|
| PR5c-R4 | 2613 | `The dead-seat CRITIC path is still alias-keyed` |
| PR5c-SEATKEY | 2656 | ``` `seatKey` is spelled three times in `src/` ``` |

---

## Task 1: Tick the six DONE items, strike SI-15, re-file PR5c-R4

**Files:**
- Modify: `BACKLOG.md` (SI-01, SI-04, SI-07, SI-08, SI-09, SI-11, SI-15, PR5c-R4)

**Interfaces:**
- Produces: the anchor name **`SI-DUP`**, used by Task 1's SI-15 strike as a forward reference and
  created by Task 4. Spell it exactly `SI-DUP` in both places.
- Produces: the `- [x] **DONE (v4.8 — verified by execution 2026-08-16) · …` marker shape, reused
  by no other task but matched against the file's existing `- [x] **DONE (v4.8 PR5c) · …` style.

### Part A — the six ticks

Each of these six items is DONE and was never ticked. **Verify each one by execution before you
tick it.** For each, the memo's anchor is given by symbol; confirm the named symbol exists and
implements the behaviour the item asked for.

| SI | Anchor to verify (by symbol) | What must be true |
|----|------------------------------|-------------------|
| SI-01 | `src/workspace/artifact-names.js :: artifactAllowlist` | the allowlist derives from `o.seats` |
| SI-04 | `src/council/tally.js :: tally` | the peer filter compares seats, not aliases |
| SI-07 | `src/council/tally.js :: tally` | a `sameModelCorroboration` stamp is emitted |
| SI-08 | `src/council/run-assemble.js :: buildTallyInput` | the tally input's `meta` carries `seats` |
| SI-09 | `src/council/verdict.js :: buildVerdict` | `findings[]` carries `raiserSeat` |
| SI-11 | `src/workspace/matrix-model.js :: buildMatrixModel` | the join is seat-aware, not alias-only |

- [ ] **Step 1: Verify all six anchors by execution**

For each row, run a grep or a node probe that lands on the executing line, and capture the output.
Example shape (do this for each of the six, adapting the symbol):

```bash
grep -n "raiserSeat" src/council/verdict.js
```

Do **not** tick an item whose anchor you could not land on. If an anchor has rotted, re-derive it
by symbol (per Global Constraints) and record both the memo's citation and the re-derived one. If
after re-deriving you cannot confirm the behaviour, **do not tick it** — report it as a finding
instead. A false DONE silently drops real work; that is the failure this whole task exists to undo.

- [ ] **Step 2: Tick the six items**

For each verified item, change `- [ ]` to `- [x]` and insert the DONE marker immediately after the
opening `**`, so the title reads:

```markdown
- [x] **DONE (v4.8 — verified by execution 2026-08-16) · PR4 · `meta.seats` is still absent from the tally input.** …
```

SI-01's title already carries a `[SHIPPED v4.8.0 PR5a — see the note below]` prefix — tick it and
insert the same DONE marker after that prefix rather than duplicating the claim.

Then append one sub-bullet to each ticked item, at the item's existing sub-bullet indentation,
recording the anchor **by symbol** and the line you landed on:

```markdown
  - **Verified by execution (2026-08-16):** `src/council/verdict.js :: buildVerdict` — `findings[].raiserSeat` is emitted at `verdict.js:<line you measured>`.
```

Use the line you actually measured. Do not copy a line number from this plan.

### Part B — strike SI-15

SI-15 is SUPERSEDED. Its two halves live in **SI-27** (the roster-padding half) and
**PR5c-SEATKEY** (the `seatKey` half). Striking SI-15 without those two intact would delete both
halves of a real filing.

- [ ] **Step 3: Confirm both halves survive before striking**

```bash
grep -n "The roster-padding block is duplicated three times" BACKLOG.md
```
```bash
grep -n 'seatKey` is spelled three times' BACKLOG.md
```

Both must return a hit. Record both line numbers in your report. **If either is missing, STOP and
report BLOCKED** — do not strike SI-15.

- [ ] **Step 4: Strike SI-15**

Tick it and mark it superseded, wrapping only the original claim in strikethrough:

```markdown
- [x] **SUPERSEDED by SI-DUP** — ~~A maintainability note (from the auto-review).~~ …
```

Append a sub-bullet naming the successor and the reason:

```markdown
  - **Superseded 2026-08-16** by **SI-DUP**, the consolidated duplication filing that merges this note, SI-27, and the PR5c `seatKey` filing under one stated counting rule. Both of this note's halves survive there; neither was dropped.
```

`SI-DUP` does not exist yet — Task 4 creates it in this same PR. Spell it exactly `SI-DUP`.

### Part C — re-file PR5c-R4

- [ ] **Step 5: Strike the false claim**

At the PR5c-R4 filing, the sub-bullet ending `…which is producer-side vocabulary — the same class
of change as PR5c Task 1.` (line 2621 @`17b6b6f2`) asserts a producer emission would close R4.
**Measured, it does not.** Strike that clause:

```markdown
    which is producer-side vocabulary — ~~the same class of change as PR5c Task 1~~ **(false — struck 2026-08-16; see below)**.
```

- [ ] **Step 6: Re-file R4 as a hand-edit-only latent hazard**

Append these sub-bullets to the PR5c-R4 filing, at its existing sub-bullet indentation. These
facts come from the memo §3 and were measured in both directions; you do **not** need to re-measure
them, but you must not restate them more strongly than written here:

```markdown
  - ⚠️ **RE-FILED 2026-08-16 — hand-edit-only latent hazard, → v4.9 (ruling R5).** No producer
    emission closes this. Measured in both directions: with a keyed dead `deepseek#2` on the critic
    alias and a live critic-role leg for `deepseek#1`, `deadSeats` returns `[]` **both with and
    without** a `seat` field on the live row — the critic arm never reads `s.seat`.
  - **Nothing in v4.8 can cure it.** Its bench has no seat-identity critic answer: `criticSeat` is
    null there and `roleAt` calls both twins `'critic'`. The shape is unreachable by any run v4.8
    creates; reaching it needs a hand-edited artifact.
  - **R4 and R5 are NOT one job.** R5's payload change neither fixes nor worsens R4, and R4's fix
    touches no file R5 touches. R5 ships in v4.8 (ruling R7); R4 does not.
```

- [ ] **Step 7: Run the gates**

```bash
npm run validate-docs
```
```bash
node scripts/check-file-sizes.js --all
```
```bash
npm run lint
```

`npm test` is unaffected by this task (no `src/` or `tests/` change) — run it once anyway to
confirm the branch is green and to let `posttest` write `.test-passed`.

- [ ] **Step 8: Commit**

```bash
git add BACKLOG.md && git commit -m "docs: tick six verified-DONE seat-identity items, strike SI-15, re-file PR5c-R4"
```

---

## Task 2: Delete SI-04's prescribed expression

**Files:**
- Modify: `BACKLOG.md` (SI-04's entry only)

**Interfaces:**
- Consumes: SI-04 is already ticked DONE by Task 1. Locate it by its title text, not by line
  number — Task 1 shifted the file.

SI-04's entry ends with a prescription that is **measurably wrong**. At `17b6b6f2` it reads:

> …so the fix is `(v.seat || v.judge) !== (f.raiserSeat || f.raiser)` with **no new inputs
> threaded**. ⚠️ Both fields are absent on a unique-alias bench by design, so the `||` fallbacks
> are load-bearing — do not "simplify" them away.

Measured in both orphan directions, that expression **re-arms #137**: it admits the raiser's own
vote as its own peer. The shipped code took a different, correct form.

- [ ] **Step 1: Read the shipped peer filter**

```bash
grep -n "peers" src/council/tally.js
```

Read enough of `src/council/tally.js :: tally` to quote the **actual executing peer filter**
verbatim, and note its line number. You will paste this into the backlog in Step 2.

- [ ] **Step 2: Replace the prescription with what shipped**

Delete the prescription sentence and its ⚠️ rider (quoted above), and in their place write:

```markdown
  **What shipped is NOT what this item prescribed.** The prescribed form
  `(v.seat || v.judge) !== (f.raiserSeat || f.raiser)` was measured in both orphan directions and
  **re-arms #137** — it admits the raiser's own vote as its own peer. It was deleted from this
  filing on 2026-08-16. The executing filter is `tally.js:<line>`:

  ```js
  <the verbatim shipped expression you read in Step 1>
  ```
```

**Do not** leave the wrong expression anywhere in this entry as a recommendation. It survives in
exactly two places, both of which are warnings and both of which stay untouched: the SCOPE RULED
banner's trap #1 (`BACKLOG.md:1857` @`17b6b6f2`) and the sentence you just wrote.

- [ ] **Step 3: Run the gates**

```bash
npm run validate-docs
```
```bash
npm run lint
```

- [ ] **Step 4: Commit**

```bash
git add BACKLOG.md && git commit -m "docs: delete SI-04's prescribed peer filter, record the shipped form"
```

---

## Task 3: Correct the lens/position prose in three places

**Files:**
- Modify: `src/council/run-assemble.js` around `:190` (comment only, **net line delta ≤ 0**)
- Modify: `tests/council/run-assemble.test.js` around `:102` (comment only)
- Modify: `BACKLOG.md` — SI-21 and SI-08

**Interfaces:**
- Consumes: SI-08 is ticked DONE by Task 1; append to it, do not re-title it.
- Consumes: SI-21 is a **HOLD** — it is not work and must not be re-scoped. You are correcting its
  prose, not adopting it.

Three comments claim `position` (and `lens`) are unrecoverable on every bench. **All three are
false**, and SI-08's DONE endorses them.

- [ ] **Step 1: Re-measure the claim yourself**

Execute `buildSeats` + `buildTallyInput` and observe what `meta.seats` actually carries. Two benches:

1. `['deepseek','deepseek','gpt']` — a bench that **repeats** an alias.
2. a lensed twin bench — the same repeated alias, with a `lens` set.

Write a throwaway node probe (do not commit it; put it under the scratchpad or use `node -e`).
Capture the real output. Expected from the memo, to be confirmed, not assumed:
- on the repeated-alias bench, **every** `meta.seats` element carries `position`;
- on the lensed twin bench, `lens` survives **verbatim**.

Also measure the **negative** control, because it is what makes the corrected sentence precise: a
bench with **no** repeated alias. Both facts are recoverable **exactly when the bench repeats an
alias**, so the unique-alias bench is where they are genuinely absent.

Quote the probe source and its output in your report. If your measurement disagrees with the memo,
**stop and report it** — write the prose to what you measured, and flag the disagreement.

- [ ] **Step 2: Read the three false comments**

```bash
sed -n '183,196p' src/council/run-assemble.js
```
```bash
sed -n '96,110p' tests/council/run-assemble.test.js
```

Locate the exact false sentence in each. Re-derive by content if the line has moved.

- [ ] **Step 3: Correct `src/council/run-assemble.js`**

Rewrite the false claim to the measured fact. The replacement must be **no longer in lines** than
what it replaces — the file is 297/300 and Phase 1 Task 1.1 depends on that headroom. Verify:

```bash
awk 'END{print NR}' src/council/run-assemble.js
```

Must print **297 or less**. If your correction does not fit, shorten the prose — do **not** shave
an unrelated comment to make room, and do **not** extract anything here (that is Phase 1's job).

The corrected fact, in your own concise wording, must convey: `position` and `lens` are recoverable
from `meta.seats` **exactly when the bench repeats an alias**; they are absent on a unique-alias
bench by design, not by defect.

- [ ] **Step 4: Correct `tests/council/run-assemble.test.js`**

Same correction, same fact. This file is not size-gated, but keep the comment tight.

- [ ] **Step 5: Correct SI-21 in `BACKLOG.md`**

SI-21 stays a **HOLD**. Strike its false claim and append the measured correction, plus the fact
that **SI-21's own proposed correction is also wrong — do not adopt it**:

```markdown
  - ⚠️ **This item's prose is FALSE, and so is its own proposed correction (measured 2026-08-16).**
    `position` and `lens` ARE recoverable from `meta.seats` — exactly when the bench repeats an
    alias. Measured by executing `buildSeats` + `buildTallyInput`: on `['deepseek','deepseek','gpt']`
    every `meta.seats` element carries `position`, and on a lensed twin bench `lens` survives
    verbatim. They are absent on a unique-alias bench by design. **Remains a HOLD — not work, do
    not re-scope.**
```

- [ ] **Step 6: Append the corrective note to SI-08**

SI-08's DONE endorsed the false comments. Append one sub-bullet making clear the DONE does not
carry that claim:

```markdown
  - **Note (2026-08-16):** this item's DONE does **not** endorse the "`position` is unrecoverable
    on every bench" claim that `run-assemble.js` and `run-assemble.test.js` carried. That claim was
    measured false and corrected in the same PR. See SI-21.
```

- [ ] **Step 7: Run all four gates**

This task edits a test file and a source file, so the full suite is required.

```bash
npm test
```
Expected: **529 suites / 7472 passed / 8 skipped / 0 failed** — unchanged. A comment-only edit that
changes a test count means you edited an executing line; revert that part and report it.
```bash
node scripts/check-file-sizes.js --all
```
```bash
npm run lint
```
```bash
npm run validate-docs
```

- [ ] **Step 8: Commit**

```bash
git add BACKLOG.md src/council/run-assemble.js tests/council/run-assemble.test.js && git commit -m "docs: correct the false lens/position prose in all three places"
```

---

## Task 4: Create SI-DUP — one duplication filing with its counting rule stated

**Files:**
- Modify: `BACKLOG.md` — SI-27's entry becomes SI-DUP; PR5c-SEATKEY becomes a pointer

**Interfaces:**
- Consumes: the anchor name `SI-DUP`, forward-referenced by Task 1's SI-15 strike. It must resolve
  after this task.
- Consumes: SI-15 is already struck by Task 1 and points here.

Three filings describe the same duplication and give **three different counts, all wrong**: SI-15
says 3; SI-27 enumerates 4 and misses 5; PR5c-SEATKEY says 3 + "a fourth". Worse, SI-15 and
PR5c-SEATKEY both say "nine" about **disjoint sets**. That is why the merged filing must state its
**counting rule beside every number**.

- [ ] **Step 1: Re-measure both counts yourself**

Two distinct populations. Measure each and state its rule:

1. **Object-form `seatKey` spellings** — the rule `seat ? seat.id : alias` written as an
   expression over a seat *object*. Expected: **9, all in `src/`, zero in `electron/`**.
2. **String-form post-emit reads** — the same rule spelled over an already-emitted row, e.g.
   `r.seat || r.model`. Expected: **9 total — 5 in `src/`, 4 in `electron/`**.

```bash
grep -rn "seat ? seat.id\|s ? s.id\|seatKey" src/ electron/
```
```bash
grep -rn "\.seat || \|seat || model\|r.seat ||" src/ electron/
```

Refine the patterns until you can defend each count. **Report the actual numbers you measured, and
write those into the filing — not the expected ones.** If your count differs from the expected,
say so explicitly in your report and in the filing; the whole point of this task is that three
prior filings each asserted a number nobody re-measured.

- [ ] **Step 2: Replace SI-27's entry with SI-DUP**

SI-DUP lives at SI-27's position so that the phase list's "Post-Phase-2 · SI-27" reference and
ruling R14 still land on it. Title it so the merge is explicit and keep **both dispositions
distinct** — they have different releases:

```markdown
- [ ] **SI-DUP · the duplication filing (merges SI-15 + SI-27 + PR5c-SEATKEY, 2026-08-16).**
  Three filings described this and gave three different counts, all wrong; two of them said "nine"
  about **disjoint sets**. Every number below states its counting rule.
  - **Count 1 — object-form `seatKey` spellings** (the rule written as an expression over a seat
    *object*): **<N> spellings, all in `src/`, <M> in `electron/`**. Measured 2026-08-16 at
    `<commit>`. Sites: `<list them>`.
  - **Count 2 — string-form post-emit reads** (the same rule spelled over an already-emitted row,
    e.g. `r.seat || r.model`): **<N> total — <a> in `src/`, <b> in `electron/`**. Measured
    2026-08-16. Sites: `<list them>`.
  - ⚠️ **Counts 1 and 2 are DISJOINT sets.** Any number quoted about this duplication is
    meaningless without saying which population it counts. Renderer modules cannot `require()` from
    `src/`, so the string-form reads in `electron/` are structural, not sloppiness.
  - **Disposition (a) — roster-padding core → v4.8, ruling R14.** Home is `stage1-bind.js`,
    parameterised on `(waveId, rosterSource, aliasAt, legs)`, returning both the filtered `seatOf`
    Map and the raw `bindRes`. **The orphan tail differs at all three sites (push /
    degrade.note / nothing) and stays at the call site.** Own PR, **after Phase 2** —
    consolidation must not ride a defect PR.
  - **Disposition (b) — `seatKey` cross-file consolidation → v4.9, ruling R14.** Do not add a
    fourth `src/` spelling in the meantime.
```

Preserve every still-true fact from SI-27's original entry (in particular the note that the prior
refusal was INVERTED, and the `net-flat` measurement) — fold them into SI-DUP rather than dropping
them. Read the original entry in full before you replace it.

- [ ] **Step 3: Turn PR5c-SEATKEY into a pointer**

Replace the PR5c-SEATKEY entry's body with a pointer, keeping any fact SI-DUP does not carry:

```markdown
- [x] **MERGED into SI-DUP (2026-08-16)** — ~~`seatKey` is spelled three times in `src/`.~~ The
  count was wrong; see **SI-DUP** in the v4.8.0 seat-identity section for both populations with
  their counting rules stated. The "unify when next touched, do not add a fourth" guidance carries
  there as disposition (b).
```

- [ ] **Step 4: Confirm the SI-15 forward reference now resolves**

```bash
grep -n "SI-DUP" BACKLOG.md
```

Expected: at least three hits — Task 1's SI-15 strike, SI-DUP's own title, and the PR5c pointer.
If SI-15's pointer does not resolve to SI-DUP's title, fix the spelling.

- [ ] **Step 5: Run the gates**

```bash
npm run validate-docs
```
```bash
npm run lint
```

- [ ] **Step 6: Commit**

```bash
git add BACKLOG.md && git commit -m "docs: merge SI-15 + SI-27 + PR5c-SEATKEY into SI-DUP with stated counting rules"
```

---

## Task 5: SI-22.1 and SI-22.2 must REPLACE `tally.test.js` T1/T2

**Files:**
- Modify: `BACKLOG.md` — SI-22's entry, sub-items **.1** and **.2**

Both sub-items' fixes are currently pinned *against* by two green tests that assert the wrong
behaviour **as disclosed**. Writing the peer-split fix "keeping the suite green" is impossible, and
a plan that does not say so will produce a fix written to pass its own bug.

- [ ] **Step 1: Verify T1 and T2 still are what the memo says**

```bash
sed -n '325,350p' tests/council/tally.test.js
```

Confirm: the test at `:329` (T1) and the test at `:341` (T2) pin exactly SI-22.1's and SI-22.2's
outcomes — `basis {a:0,d:0,n:0}` and `Singleton`. **Record their test names**, not just their line
numbers, so the note survives citation rot. If the line numbers have moved, re-derive by test name
and report both the memo's citation and yours.

- [ ] **Step 2: Add the replacement requirement to SI-22.1 and SI-22.2**

Append to **each** of the two sub-items (adapting the test name to the one it pins):

```markdown
    ⚠️ **The fix must REPLACE `tests/council/tally.test.js` T1 (`<name>`, `:329`) and T2
    (`<name>`, `:341`) — not pass them.** Both currently pin the WRONG behaviour *as disclosed*
    (`basis {a:0,d:0,n:0}`, `Singleton`). This fix **cannot** be written "keeping the suite green".
    Pin the replacement with a **named mutant**, not a preservation test.
```

Use the line numbers and names you measured in Step 1.

- [ ] **Step 3: Run the gates**

```bash
npm run validate-docs
```
```bash
npm run lint
```

- [ ] **Step 4: Commit**

```bash
git add BACKLOG.md && git commit -m "docs: SI-22.1/22.2 must replace tally.test.js T1/T2, not pass them"
```

---

## Task 6: Commit the re-measured size-gate table

**Files:**
- Modify: `BACKLOG.md` — new subsection inside the v4.8.0 SCOPE RULED banner region

**Interfaces:**
- Consumes: Task 3 edited `src/council/run-assemble.js`. Measure **after** that edit; the table
  must reflect the tree you are committing.

- [ ] **Step 1: Measure with the gate's own logic**

```bash
node -e "const g=require('./scripts/check-file-sizes.js'),fs=require('fs');const t=g.listTrackedFiles().filter(f=>g.matchesPattern(f,g.CONFIG.include)&&!g.matchesPattern(f,g.CONFIG.exclude));const r=t.map(f=>{const c=fs.readFileSync(f,'utf8');const n=c.split('\n').length;return{f,n:c.endsWith('\n')?n-1:n}}).sort((a,b)=>b.n-a.n);console.log('GATED',t.length,'| >=291',r.filter(x=>x.n>=291).length,'| ==300',r.filter(x=>x.n===300).length,'| >300',r.filter(x=>x.n>300).length);r.filter(x=>x.n>=291).forEach(x=>console.log(x.n,x.f))"
```

⚠️ **Measured trap:** `matchesPattern(filePath, patterns)` takes an **array** of patterns. Passing a
single pattern string makes `for (const pattern of str)` iterate **characters**, which silently
matches everything and reports 19 "gated" root-level files including `package-lock.json`. If your
gated count is not in the hundreds, you hit this. Use the command above verbatim.

Expected at `17b6b6f2` — confirm, do not assume: **277 gated files · 14 at ≥291 · exactly 2 at
300/300** (`src/pack/pack-resolve.js`, `src/sidecar/electron-install.js`) · **0 over 300**.

- [ ] **Step 2: Write the table into the banner region**

Insert a new `###` subsection into the `## v4.8.0 — SCOPE RULED (2026-08-16)` banner region, after
the "The durable finding is CONFIRMED…" subsection and before `### Deferred to v4.9.0`:

```markdown
### Size gate — re-measured 2026-08-16

Measured with `scripts/check-file-sizes.js`'s own `listTrackedFiles` + `matchesPattern` +
`CONFIG`, so the population is exactly what the gate scans: **<N> gated files** (`src/**/*.js` +
`electron/**/*.js`, minus `CONFIG.exclude`'s grandfathered list). **<K> at ≥291 · exactly <J> at
300/300 · 0 over the limit** — the gate passes today and the first added line to either 300-line
file blocks the commit.

| Lines | File | Note |
|-------|------|------|
| … | … | … |

⚠️ **`src/council/report.js` (298) and `src/council/run-assemble.js` (297) appear in NO prior size
note in this file** and both gate Phase 1: T1.1 extracts `buildRunStatsEntry` out of
`run-assemble.js` (297 → 247), and T1.2 extracts from `report.js`, which has **two lines of
headroom**. The 300-line gate blocks the COMMIT, not the edit — when it fires, EXTRACT. Shaving
comments to fit is the documented tell.
```

Fill every `<…>` with a measured value and every table row from your Step 1 output (all 14 rows at
≥291). Mark the two 300/300 files and the two Phase-1 files in the Note column.

- [ ] **Step 3: Run all four gates**

```bash
npm test
```
```bash
node scripts/check-file-sizes.js --all
```
```bash
npm run lint
```
```bash
npm run validate-docs
```

- [ ] **Step 4: Commit**

```bash
git add BACKLOG.md && git commit -m "docs: commit the re-measured size-gate table"
```

---

## Done criteria for the PR

- All six tasks committed; four gates exit 0 on the final tree.
- `git diff main --stat` touches **exactly three files**: `BACKLOG.md`,
  `src/council/run-assemble.js`, `tests/council/run-assemble.test.js` — plus this plan file.
- `src/council/run-assemble.js` is **≤ 297 lines**.
- Suite unchanged from baseline: 529 suites / 7472 passed / 8 skipped / 0 failed.
- No `council-review` label — Phase 0 is doc-only (labelling starts at Phase 2).
