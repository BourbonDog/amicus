# v4.8.0 Phase 2 — the `run-retry.js` extraction, then B1/B2 (2026-08-17)

**Base:** `main` = `30e17df9`, clean. Branch `v48p2-retry-extraction`.
**Baseline, measured at base (not carried over):** 532 suites / 7496 passed / 8 skipped / 0 failed;
`check-file-sizes --all`, `lint`, `validate-docs` all exit 0.

This is the hard prerequisite that gates T2.3 and T2.4. It is ONE PR, with the extraction landing as
its own commits before any defect fix, exactly as `BACKLOG.md`'s NEXT TASK entry prescribes.

---

## 0. Measured substrate — established by execution at `30e17df9`

Everything below was re-measured for this plan. Do not re-derive it; do not trust a number in
`BACKLOG.md` over one here, and do not replace one of these with an estimate.

### 0.1 The counting rule

⚠️ **`Get-Content | Measure-Object -Line` silently drops blank lines** and under-reports these files
by 7–12. It gave 288/287 where the gate gives 295/299. The ONLY authoritative rule is
`scripts/check-file-sizes.js`:

```js
const lineCount = content.split('\n').length;
const adjustedCount = content.endsWith('\n') ? lineCount - 1 : lineCount;
```

Any file measurement in this PR must use that rule and must self-check against a known value first.

### 0.2 Sizes at base, and after the planned extraction (measured, not projected)

| File | At base | After extraction | Free |
|---|---:|---:|---:|
| `src/council/run-retry.js` | **295**/300 | **259** | 41 |
| `src/council/run-retry-group.js` | **299**/300 | **236** | 64 |
| `src/council/run-stage1-rows.js` | 225 | 225 | 75 |
| `src/council/stage1-bind.js` | 86 | 86 | 214 |
| `src/council/run-retry-notes.js` | 126 | 126 | 174 |
| *new* `src/council/run-retry-keys.js` | — | ~72 | — |
| *new* `src/council/run-retry-launch.js` | — | ~52 | — |

The two fixes need **+9** (`run-retry-group.js`) and **+7** (`run-retry.js`). Both fit with margin.

### 0.3 The four defects, reproduced first-hand

Run against the real `retryStage1Losses` / `groupStage1Losses` on roster
`['deepseek','deepseek','gpt']`, two UNBOUND dead twin legs, taskIds `orphan-a`/`orphan-b`,
first-failure reasons `boom-A`/`boom-B`:

| Shape | At base | Required after fix |
|---|---|---|
| **B1** partial retry return, UNBOUND twins | **1** note, **1** stillDeadLeg | **2** and **2** |
| B1 control — partial return, BOUND twins | 2 notes, 2 stillDeadLegs | unmoved |
| **B2** full retry return, UNBOUND twins | 2 notes, reasons `["boom-A","boom-A"]` | `["boom-A","boom-B"]` |
| B2 control — full return, BOUND twins | reasons `["boom-A","boom-B"]` | unmoved |
| **Round-2 B1 shape A** — 3 unbound legs, 2-seat twin alias | **3** slots | **2** |
| **Round-2 B1 shape B** — null-seat dead wave ×2 + 2 unbound legs | **4** slots | **2** |
| control — 2 unbound legs, 2-seat twin alias | 2 slots | unmoved |
| control — unique alias, 2 losses | 1 slot | unmoved |
| control — NO `o.seats` roster, 2 losses on one alias | 1 slot | unmoved |

⚠️ The no-roster control is load-bearing: with no `o.seats`, `twins` is empty, identity is EXACT and
the bounded branch is unreachable. `twinAliases`' deliberate *"no proof, err toward collapsing"*
must survive this PR untouched.

### 0.4 Set⇒Map safety — verified, no counterexample

Every consumer of a `twins` collection uses `.has()` only — verified twice, independently. No
`.size`, no spread, no `instanceof Set`, no `for…of`, no `.get()`, no snapshot or `toEqual` against a
`twinAliases` result anywhere in `src/`, `tests/` or `electron/`. **A `Map` swap is safe.**

⚠️ Call sites are cited **at base `30e17df9`** and have since MOVED — T-A1 grew
`run-stage1-rows.js` by 2 lines and relocated the helpers into `run-retry-keys.js`. Anchor by symbol
and re-derive before use:
`run-retry-keys.js :: legLossKey`, `run-retry-group.js :: recordFailure`,
`run-retry.js :: retryStage1Losses`, and `run-stage1-rows.js :: pushDeadSeatRows` (which calls
`.has()` directly at **three** sites, not the two originally recorded here).

⚠️ **`legLossKey` must STAY on `.has()`.** `tests/council/run-stages.test.js` ::
*"T2.2 review A1/D3: the NUL-joined row key is CONTAINED — it reaches no emitted row"* constructs a
bare `new Set(['deepseek'])` *itself* and passes it in. (Read `:1357` at base; re-anchored by test
title at T-A6, per rule 5b, after T-A6's own comments moved it down. ⚠️ The enclosing test was
derived by opening the MOVED line and walking UP to its `test(` — reading `:1357` in the post-T-A6
tree instead names a different test entirely, which is the trap rule 5b exists to close.) That is a test-authored Set, not a `twinAliases`
return — so it is not a counterexample to the Map swap, but changing `legLossKey` to `.get()` would
break it. Keep the predicate `.has()`-shaped.

### 0.5 Citations re-derived against the live tree

Accurate at base: `run-retry.js:126` (unique placeholder id), `:132` (drop placeholder binds),
`:216` (`if (!ff) { continue; }`); `run-stage1-rows.js:174` (`finalLeg = exact ? ...`);
`run-stages.js:140` (orphan-leg emit); `stage1-bind.js:53` (`orphanLegNote`).

**Rot found and corrected here:** `BACKLOG.md` cites the stale `planStillDeadSources` docblock as
`run-retry-group.js:94-95`. The stale sentence actually spans **94–96**.

### 0.6 ⚠️ A claim in the record that does NOT hold — verify before relying on it

**`BACKLOG.md` :: SI-TWINS** — the sentence beginning *"Pinned today by the named mutants"*
(`:2219` as of `1988df54`) — states the desync risk is *"Pinned today by the named mutants
`DESYNCLEG` and `DESYNCPLAN`."* Measured across the whole repo:

- **`DESYNCPLAN` appears in exactly one place: that sentence.** No test, no comment, no pin.
- `DESYNCLEG` appears only in that sentence and as a *retrospective* mention in
  `tests/council/run-stages.test.js:1142`, inside the test at `:1132`.

So one half of that safety claim is real and the other is **unverified**. T-A6 must settle it by
execution, not restate it.

Related: of the twelve named mutants the record refers to, only **FIND** (`run-retry.test.js:946`),
**INLINE** (`run-retry-group-seatkey.test.js:39`), **NOBILL** and **BORROWALL**
(`run-stages.test.js` :: *"T2.2 review A1: a borrowed spare is BILLING ONLY — the row asserts no
execution it cannot own"*, read `:1409`/`:1410` at base) exist as literal tokens in tests. `GUESSPOS`, `PARTIALSKIP`,
`LEAK`, `NOTEMINT`, `FAKEBIND`, `NOPLACEHOLDERFILTER` and `DESYNCPLAN` live only in `BACKLOG.md`
prose. **The pins they name mostly DO exist** — `GUESSPOS` → `run-retry.test.js` ::
*"invariant 2: two UNBOUND leg-origin twins group into ONE unit — bench AND lens mode"*,
`PARTIALSKIP` → :: *"invariant 1: skipping is all-or-nothing — two unbound twins are BOTH skipped
or NEITHER"* (read `:987`/`:1019` at base) — the token simply is not written in the test. Treat
"mutant X is RED" as a claim to re-run, never as a fact to inherit.

⚠️ **UPDATE — T-A6 (2026-08-17) settled the `DESYNCLEG`/`DESYNCPLAN` half of this by execution and
CHANGED it.** Both were run against the full suite at `9f460526` and both are RED, so the record's
substance held; what was missing was the name, not the pin. Both tokens are now written into the
tests that red them, with their mutations and measured red sets, so the sentence above ("live only
in `BACKLOG.md` prose") no longer covers `DESYNCPLAN`. See `BACKLOG.md` :: SI-TWINS. Every line
number in this paragraph and the one above is a *base* reading, kept for provenance and re-anchored
by test title, because T-A6's own comments moved `run-retry.test.js:987/1007/1019` and
`run-stages.test.js:1357/1409/1410` down. No delta is stated on purpose: T-A6 grew both files in
more than one commit, so any number written here would be true only until the next one — which is
exactly why the anchors above are titles. Each was re-derived by opening the line, never by
arithmetic.

---

## Global Constraints

These bind every task. A reviewer should read them as the attention lens.

1. **Verification by EXECUTION, never by assertion.** Every numeric claim is measured; every citation
   is traced to the executing line. This series' recurring failure is exactly this.
2. **Preservation pins are green at HEAD by construction.** Prove each with a **named mutant**, never
   RED-before-GREEN. Commit before running a mutant; revert with a precise reverse-edit.
3. **NEVER `git checkout -- <path>`** — it deletes uncommitted work.
4. **Re-derive citations against the FINAL tree.** Make every edit to a cited file first, THEN
   re-derive, THEN re-open each citation at its stated line and read it. A citation corrected to a
   new wrong value is worse than the rot it replaced. This has shipped wrong three times this release.
5. **`grep` the distinctive PHRASE of any comment you edit, repo-wide.** A same-file sweep cannot find
   a twin — that was Phase 1's Critical.
5a. **Sweep citations of every file your commit TOUCHES, not just the files whose citations you are
   fixing.** A comment-only edit still moves line numbers, and a doc-only commit can falsify a source
   citation as easily as a refactor can. Measured in this PR: the round-3 commit fixed one file's
   citations and, by shifting that file +3 lines, falsified three *previously true* citations of it
   elsewhere — one of them inside a counted site list. Rounds 2 and 3 each missed exactly this step.
5b. **When you correct a cross-file citation, convert it to a SYMBOL anchor
   (`file.js :: functionName`) rather than to a new line number.** This is the only form that
   terminates the cascade: a corrected line number is true until the next edit and then silently
   false, whereas a symbol anchor survives every move. Measured: re-anchoring
   `electron/workspace-ui/workspace-seats.js:65` by symbol removed that file from the citation grep
   class entirely. A corrected line number is a deferral; a symbol anchor is a fix.
   ⚠️ **Never derive a corrected line by OFFSET ARITHMETIC.** Extractions do not shift a file
   uniformly — this PR measured offsets of 0 / −1 / −9 / −10 / −32 within a single commit, and
   0 / +10 / +15 *within a single file* in another. Applying one offset shipped fresh wrong values
   twice, once from the controller's own instruction. Open the line.
5c. **After a BEHAVIOUR change, sweep for prose describing the BEHAVIOUR — not only for the phrase
   of the comment you edited, and not only for citations.** Both of those sweeps can pass while
   prose elsewhere still describes the old behaviour. Measured in this PR: the commit that closed
   B1/B2 left two near-verbatim twins asserting the defect was still open — one of them in `src/`,
   in the very file the next task works in — and neither was a citation, so the citation sweep could
   not reach them. A behavioural sweep then found a **third** site in `docs/council.md`, which is
   user-facing and covered by **no gate at all** (outside the size gate, the lint gate, and
   `validate-docs`' marker checks). Grep the claims your change falsified, not the words you typed.
5d. **Read every NEW sentence you write against the code.** Rules 5–5c catch *stale* prose — true
   when written, falsified later. They cannot catch a sentence that was **born false**. This PR
   shipped one: a fresh parenthetical claiming the `usage: null` row identified *which* twin the
   retry answered, when the borrowed leg is handed out by `shift()` in row order and the same table
   cell already said the leg "cannot be attributed to either twin". Nothing sweeps for that — only
   reading the new claim against the executing code does.
6. **The 300-line gate blocks the COMMIT, not the edit. When it fires, EXTRACT — never shave
   comments.** Shaving is the documented failure tell.
7. **Do not write a test whose title claims more than its assertion executes.** That has cost this
   project four review rounds across two phases.
8. **A `Module.prototype._compile` mutation hook is a SILENT NO-OP under jest** — it returns a false
   all-green run. Use `moduleNameMapper` and assert the mutated bytes actually loaded.
9. **Never restore a `waveId` on a borrowed dead-seat row** to resolve a red in
   `run-cost-bijection.test.js` — that is the exact misattribution council A1 removed. The correct
   adaptation is `r => r.waveId || r.usage` (the filter lives in
   `tests/council/run-cost-bijection.test.js :: driveAndAssertBijection`; that file's leading module
   docblock already carries this warning). ⚠️ This constraint originally cited the filter as `:176`,
   which was true at base `30e17df9` and rotted +5 during this PR — an implementer copied the stale
   number straight out of this document. Anchored by symbol per rule 5b. **This PR should not need to touch that
   suite at all** — it adds no twin scenario there. If you find yourself editing it, stop and report.
10. **Findings ids are per-round and the council RENUMBERS between rounds.** Anchor by commit +
    mechanism, never by a bare id.
11. **Do not re-litigate C1** (the bound-retry-leg drop). It is filed as measured-UNREACHABLE
    (fuzz: 1200 runs / 697 bound legs / 0 violations) and its own stated mechanism is wrong — a
    keyspace bridge, not a one-line lookup. The ⚠️ guard comment immediately above
    `run-stage1-rows.js :: pushDeadSeatRows`' `let finalLeg = exact ? …` assignment names the
    cross-file invariant that keeps it unreachable. (Anchored BY SYMBOL at T-A5, per rule 5b: this
    read `:169-173`, which was accurate at base and rotted twice — T-A1 and T-A5 both grew the file.)

### Gates — all four must exit 0 before the PR is opened

```
npm test                                  # baseline 532 suites / 7496 passed / 8 skipped / 0 failed
node scripts/check-file-sizes.js --all
npm run lint
npm run validate-docs
```

⚠️ **`pre-push` blocks unless `.test-passed` matches HEAD exactly** — run `npm test` AFTER the final
commit, never before. `posttest` writes `.test-passed`.

---

## Tasks

### T-A1 — Extract the loss-keyspace helpers out of `run-retry-group.js`

**Commit alone. Pure move, zero behaviour change.**

Move these four whole top-level functions **byte-for-byte, docblocks included** — currently
`run-retry-group.js` lines **23–86** (64 lines, opening `/**`, closing `}`) — into a new
`src/council/run-retry-keys.js`:
`seatKey`, `twinAliases`, `legLossKey`, `srcLegClaimer`.

- `run-retry-group.js` requires them back and **re-exports all four**, so no caller changes.
  Its `module.exports` already lists all four; keep the list identical.
- The new module must be **require-free** (it is a leaf), preserving the property the tree depends on.
- **Measured target: `run-retry-group.js` 299 ⇒ 236.** New file ≈ 72.

**⚠️ This move falsifies two currently-TRUE comments. Both must be corrected in THIS commit:**
- `run-retry-group.js:4-5` — *"Pure — parameters and builtins only, no requires."*
- `run-stage1-rows.js:10-11` — *"run-retry-group.js is require-free, so this is a leaf import and
  cannot re-create the parent-child cycle the header above documents eliminating."*

Grep the distinctive phrases (`no requires`, `require-free`, `leaf import`, `zero requires`)
**repo-wide** before declaring this done — a same-file sweep cannot find a twin, and that was
Phase 1's Critical. ⚠️ **`zero requires` added 2026-08-23**: v4.8 SI-25 falsified
`2026-08-12-v48-pr0-extractions.md:325` (*"the new file has zero requires"*, of
`briefings-chair.js`) and a three-spelling sweep could not see it. A claim has as many spellings as
authors; add each new one here as it is found.

**Also on this commit's checklist:** correct `planStillDeadSources`' stale docblock at
`run-retry-group.js:94-96`. It reads *"HEAD hides this downstream because the Workspace's dead-row
dedup is alias-keyed too and both collapse into one row; seat-keying that consumer (PR5c Task 2)
turns it into a visible duplicate row."* That "HEAD" means **pre-PR5c** HEAD; T2.2 then abolished the
producer-side collapse it leans on. The size ceiling was the only reason it still reads as current —
that reason is gone as of this commit, so fix it here and nowhere else.

**Pin:** function **identity** across import paths, following the established idiom at
`tests/council/run-stats-entry.test.js:7-21` (`expect(asm.buildRunStatsEntry).toBe(rse.buildRunStatsEntry)`).
Pin all four names. A `typeof === 'function'` check is NOT this idiom and does not satisfy it.

**Done when:** all four gates exit 0; the four identity pins pass; both falsified comments corrected
and phrase-grepped repo-wide; the stale docblock corrected; `run-retry-group.js` measures 236.

---

### T-A2 — Extract the retry-wave launch/bind block out of `run-retry.js`

**Commit alone. Behaviour-preserving lift.**

Create `src/council/run-retry-launch.js` holding:
- `briefingFor` — **byte-for-byte move**, currently `run-retry.js` lines **30–37**.
- `bindRetryWave` — a **closure-to-function lift** of `run-retry.js` lines **110–139**: the
  `placeholders` Set, `retryRoster` padding, the `bindSeats` call, the `retrySeatOf` filter, and the
  `orphanLegs` collection.

**Signature constraint:** `bindRetryWave` must **not** take the orchestrator's `out` object and mutate
it. Return `{ retrySeatOf, orphanLegs }` and let the caller assign. A function that mutates a caller's
accumulator is not independently testable and will be flagged.

**Measured target: `run-retry.js` 295 ⇒ 259** (the real built file, not an estimate; allow ~262 once
the call site restores the two copy loops). New file ≈ 52.

⚠️ **Preserve both halves of the C1 conjunction verbatim** — unique placeholder ids
(`run-retry.js:126`) and dropping placeholder binds (`:132`). They are a CONJUNCTION: break one alone
and the loss lands elsewhere; break both and a bound still-dead retry leg's usage is lost silently.
`run-stage1-rows.js:169-173` cites both by line — **re-derive those two citations against the final
tree after the move** and update them to their new file and line numbers. This is Global Constraint 4
and it is the single most likely way this task ships a falsified record.

⚠️ **Do NOT route this into `stage1-bind.js`.** That file's `bindStage1Waves` is a different binding
contract (one call per Stage-1 wave, no padding, no placeholders). SI-27 is separately scheduled to
consolidate padding/bind/placeholder logic there, parameterised across **three** sites, after Phase 2
(ruling R14). Landing a one-site partial version now would leave SI-27's filing describing work that
is half-done — the falsified-record class this release keeps paying for.

> ⚠️ **Annotation added 2026-08-23 — the prohibition above is DISCHARGED, and the sentence
> that carried it is left standing.** SI-27 shipped that day (`80680c9f` + `ed827eaa` +
> `68bee03e` + `d29a3462`, ruling R14): the pad/bind/placeholder core now lives in
> `stage1-bind.js :: bindPaddedWave`, parameterised across all three sites, exactly as this
> paragraph anticipated. **"Do NOT route this into `stage1-bind.js`" was scoped to T-A2**, whose
> one-site partial version is what it forbade; it is not a standing rule about that file, and a
> reader arriving here today should not treat it as one. The `bindStage1Waves` warning is still
> live and correct: that function remains a DIFFERENT contract (many waves, a real roster, no
> padding, no placeholders) and is not what the three padding sites call — `bindPaddedWave` is.
> Kept rather than rewritten because this is a dated plan snapshot and `docs/CITATIONS.md`
> governs: *"annotate it with the ref it was true at … do not silently"* overwrite. The
> statement was true when written.

**Pin:** function identity for both exported names, same idiom as T-A1.

**Done when:** all four gates exit 0; identity pins pass; `run-retry.js` measures ≤262; the two C1
citations in `run-stage1-rows.js` re-derived and re-read at their stated lines.

---

### T-A3 — Round-2 B1: bound the mint by the roster

**The fix is WRITTEN AND MEASURED in `BACKLOG.md`. Apply it — do not re-derive it.**

1. `twinAliases` returns a **Map** (alias ⇒ roster count) instead of a Set:
   `new Map([...n].filter(([, c]) => c > 1))`. All four call sites use `.has()` only (§0.4), so
   nothing else changes — but the count is the thing the Set was throwing away, and without it
   `recordFailure` cannot state a bound at all.
2. `recordFailure`'s two guards merge:
   ```js
   identityIsExact
     ? unit.firstFailures.some(f => f.seatId === key)
     : unit.models.filter(m => m === seat).length >= twins.get(seat)
   ```
   BACKLOG argues this must be two lines because the merged ternary runs ~146 chars "against this
   repo's 119 maximum". ⚠️ **Measured: the 119 maximum is a CONVENTION, not a gate.** `.eslintrc.js`
   has no `max-len` rule, there is no prettier or editorconfig, **107 of 250** files under `src/`
   already exceed 119, and `run-retry.js:126` is 126 chars today. `run-retry-group.js`'s own maximum
   is exactly 119, which is a real per-file discipline worth keeping — so still write it as two
   lines, but know that nothing goes red either way, and do NOT let the old "+8 doesn't fit"
   arithmetic drive any decision: at 235/300 the file has ~65 free lines and the +9 lands at 244.

**Update `twinAliases`' docblock**: it currently says *"No roster means no proof, so the answer is
the empty set."* That becomes false under a Map. Correct it in this commit (Global Constraint 5:
grep the phrase repo-wide).

**Scope, stated because the code cannot:** this bounds SLOTS (`unit.models`), so a
`trackModel: false` unit — the critic, whose `models` is fixed at creation — is unaffected.

**Done criteria — measured, with a named mutant:**
- shape A (3 unbound legs, 2-seat twin alias): **3 ⇒ 2**
- shape B (null-seat dead wave naming the alias twice + 2 unbound legs): **4 ⇒ 2**
- controls unmoved: 2 legs ⇒ **2**; unique alias ⇒ **1**; **no roster ⇒ 1**
- a named mutant that **REMOVES the bound** goes RED

---

### T-A4 — Round-1 B1 + B2: the per-key slot count

**⚠️ BOTH HALVES IN ONE COMMIT. Closing B1 alone makes B2 strictly worse** — a partial return would
then emit two notes that both read slot 0's first-failure, and a duplicate that looks authoritative is
worse than one note.

`run-retry.js :: retryStage1Losses`'s `launched` is a first-wins Map keyed by `seatKey`
(`addLaunched` does `if (!launched.has(k))`), and `seenSeats` is a presence Set. The cure:

- `launched` entries gain a **slot count** and their own per-slot `firstFailure`s.
- `seenSeats` becomes a **count Map**.
- The reconcile emits **`max(slots,1) − seen`** notes instead of testing presence.
- **Each emitted note carries its OWN slot's `firstFailure`**, not slot 0's.

⚠️ **Subtlety the implementer must resolve by measurement, not by reading:** `addLaunched` has THREE
feeders — `unit.models`/`unit.firstFailures` (the launch plan, index-parallel, carries `ff`),
`unit.srcWaves`' models, and `unit.srcLegs`. Only the first is the launch plan. Counting slots across
all three would over-count a seat that appears in both `unit.models` and `srcLegs`; feeders 2 and 3
exist as a union safety net and must keep slots at **≥1** without inflating it. Verify the resulting
counts against every control in §0.3 before claiming this.

**Done criteria — measured against §0.3, both consequences named, not just the count:**
- partial return, UNBOUND twins: **2** notes and **2** stillDeadLegs (base: 1 and 1)
- full return, UNBOUND twins: reasons **`["boom-A","boom-B"]`** (base: `["boom-A","boom-A"]`)
- every BOUND control and the skipped-unit shape unmoved
- named mutants for each half, both observed RED

---

### T-A5 — Round-2 A2/C1: make `supersededKeys` enforce its own safety

> ⚠️ **Anchor updated after the fact (T-A6, `fb261dcc`), task text otherwise left as issued.**
> `supersededKeys` and its guard now live in **`src/council/run-stage1-superseded.js :: supersededRows`**,
> lifted out of `pushDeadSeatRows` so T-A6 could edit that function without breaching the 300-line
> gate. Read every `run-stage1-rows.js :: pushDeadSeatRows` reference below as that symbol.

`supersededKeys` (`run-stage1-rows.js :: pushDeadSeatRows`) is the ONE join left in the
alias-granular keyspace. The council does **not** dispute that it is safe today; the objection is that
its safety is **emergent, not enforced** — the function cannot verify either invariant it stands on,
so a change elsewhere can break it silently. Make the invariants checkable **by the code**.

The two invariants and their existing pins:
- **Invariant 1 — skipping is all-or-nothing per unit.** Pinned by `run-retry.test.js` ::
  *"invariant 1: skipping is all-or-nothing — two unbound twins are BOTH skipped or NEITHER"*.
  Mutant **PARTIALSKIP** (a skip branch pushing a subset of `unit.srcLegs`).
  ⚠️ **This read `:1019`, which is a BLANK line — the `test(` is `:1020`. Re-anchored by TITLE at
  T-A8, 2026-08-17. And PARTIALSKIP is BRANCH-SPECIFIC, measured at T-A8: on the over-budget branch
  it reds this pin alone; on the unmappable branch it reds NOTHING repo-wide (537 suites green).
  Filed in `BACKLOG.md` :: the T-A8 entry.**
- **Invariant 2 — two UNBOUND leg-origin twins always share ONE unit**, bench and lens. Pinned by
  `run-retry.test.js` (*"invariant 2: two UNBOUND leg-origin twins group into ONE unit — bench AND
  lens mode"*), with the scope control (*"invariant 2, scope: BOUND twins DO split across lens
  units — and that is safe"*) showing BOUND twins DO split across lens
  units safely. Mutant **GUESSPOS** (guess an unbound leg's seat by ordinal). (Read `:987`/`:1007`
  when this task was written; re-anchored by title at T-A6, which moved both down one line.)

**Do not weaken or remove those pins** — the refactor's job is to make the invariants checkable, not
to replace the tests carrying them. **Re-run both mutants and observe RED yourself**; neither token
exists in the test files (§0.6), so "it is pinned" is a claim to verify, not inherit.

Break either invariant and a skipped twin takes its own first leg as a primary row AND gets a
superseded row for it: **one billed leg counted twice** — the defect class this release exists to close.

---

### T-A6 — SI-TWINS: one `twinAliases` derivation, and settle the DESYNCPLAN claim

`twinAliases(o.seats)` is recomputed at **four sites across three files**:
- `run-retry-group.js :: groupStage1Losses` — handed to every `recordFailure` call
- `run-retry-group.js :: planStillDeadSources` — ⚠️ this function ALSO derives its own
  `seatsPerAlias` map with a **deliberately different** rule (`=== 1` vs `> 1`). A naive "pass one set
  in" merge would silently change which losses are announced. **Read that docblock before touching it.**
- `run-retry.js :: retryStage1Losses` — used for `srcRowKey` at both `claimSrc` sites
- `run-stage1-rows.js :: pushDeadSeatRows` — `rowKeyOf` and the `spareRetryLegs`/`exact` predicates

**The desync risk that makes this more than duplication:** `legLossKey`'s minted key must be added to
`attemptedSeats` at every producer site and asked for at every consumer site with the SAME `twins`
collection. If one site's differs, a retried twin re-acquires its own FIRST-attempt leg — which
already carries a `superseded` row — and that leg's cost lands in runStats **twice** while its retry
leg lands nowhere.

**⚠️ First, settle §0.6 by execution.** `BACKLOG.md` :: SI-TWINS claims this is *"Pinned today by the named
mutants `DESYNCLEG` and `DESYNCPLAN`"*. `DESYNCPLAN` exists nowhere but that line.
1. Apply a DESYNCPLAN-shaped mutation (desynchronise `planStillDeadSources`' `twins` from the
   producers') and determine whether **any** test goes RED.
2. If none does, **add the pin before consolidating**, and correct that SI-TWINS sentence — do not restate
   an unverified claim.
3. Same for `DESYNCLEG`: verify the pin at `run-stages.test.js:1132` actually reds under it.

Consolidation ships only once both mutants are demonstrably RED.

---

### T-A7 — Pin the C1 conjunction

`run-retry.js` was at 295/300, one small change away from opening the bound-retry-leg hole for real,
and **nothing in either file's test suite would go red if it did**. Now that the file has headroom,
add the pin the record asks for: a named mutant on the conjunction, or a direct pin that **a bound
still-dead retry leg always resolves `exact`**.

The conjunction is: placeholder ids stay unique (`run-retry-launch.js :: bindRetryWave`'s
`` `__unbound-${unit.waveId}-${i + 1}` ``) **and** placeholder binds are dropped (the same function's
`.filter(b => !placeholders.has(b.seat))`). ⚠️ Written as `run-retry.js:126`/`:132`; T-A2 moved
`bindRetryWave` into `run-retry-launch.js`, so the FILE was wrong, not just the numbers.
Break one alone and the loss lands elsewhere (mutant NOPLACEHOLDERFILTER measured
`stillDeadRetryLegs = 0`, a *different* loss that happens to total the same); break both — mutant
FAKEBIND — and the finding fires exactly, `GAP = 0.0700`.

Do **not** attempt to fix C1. It is measured-unreachable end-to-end and pre-existing at `main`
(Global Constraint 11). This task adds the guard rail only.

✅ **DONE 2026-08-17, commit `1d31d77e`** (test-only; C1 not fixed, not re-litigated). Both mutants
were RE-MEASURED against the final tree rather than inherited, and **both reproduce the numbers
above**: NOPLACEHOLDERFILTER ⇒ `stillDeadRetryLegs` 0, zero bound-and-lost legs, 0.1600 of 0.1600
billed reaching no row; FAKEBIND ⇒ 1 bound still-dead retry leg, no row carrying it, `GAP = 0.0700`.
The pin — `run-retry-launch.test.js` :: *"C1 — the conjunction END TO END: a BOUND still-dead retry
leg always resolves `exact`"* — drives the real `retryStage1Losses` + `pushDeadSeatRows` on both
roster shapes and **discriminates the two mutants by which assertion block reds**: FAKEBIND the
bound-and-lost block, NOPLACEHOLDERFILTER the non-vacuity block. The identified-roster shape is the
non-vacuity witness and FAKEBIND is inert there. The area's existing mutants were re-run **against
`run-retry-launch.test.js`** (that scope, not repo-wide) and each still reds its own pin: COLLIDEID
1 test, PREFIXID 1, RAWROSTER 2, COPYBRIEF 2 (P1+P2), NOPLACEHOLDERFILTER 3 pre-existing pins plus
the new one, FAKEBIND the same 3 plus the new one. **No pin was weakened** — Step A is test-only and
changed no source byte; the battery is the measurement that says so rather than the argument.
⚠️ COPYBIND was NOT re-run: it needs a ~25-line re-inline into a file at 295/300 with a hand revert
as the only exit, and the risk exceeds the information given that no source byte moved.

---

### T-A8 — Truth pass on the record

Doc-only, last commit. Re-derive every citation **against the final tree** (Global Constraint 4),
then re-open each at its stated line and read it before writing it down.

- Tick what shipped; move SI-22.3 from PARTIAL to its true post-PR verdict, stated with its scope.
- Correct the stale-docblock citation `94-95` ⇒ **94–96** (measured, §0.5).
- Record the new measured sizes in the size-gate table, including the two new files.
- Correct `BACKLOG.md` :: SI-TWINS's *"Pinned today by the named mutants"* sentence per T-A6's finding.
- Note that `BACKLOG.md` :: the SI-09 `buildVerdict` entry (`:2616` as of `1988df54`) is LIVE-WRONG about `buildVerdict` (called at
  `run-verdict-files.js:41`, not `run-assemble.js`) and now collides numerically with SI-25's correct
  `run-assemble.js:223`. Fix or explicitly re-file it.
- ⚠️ Do not restate the unqualified headline *"N orphans → N retry slots AND N rows"* in either
  wording unless this PR has actually made it true in every retry shape — and if it has, say so with
  the per-shape table, not the slogan.

✅ **DONE 2026-08-17** (doc-only, run against the FINAL tree). Every citation below was re-derived
and **re-opened at its stated location** before being written down, and every correction was
converted to a SYMBOL or TITLE anchor rather than to a new line number:
- **SI-22.3 moved from PARTIAL to CLOSED** at **six** sites — `BACKLOG.md` ×3 (the SI-22 roll-up
  trap, the verdict paragraph with both B1/B2 items struck, and the "Five seat shapes" sub-item),
  the `### The durable finding …` section heading, the ask-anything design spec, and the phasing
  plan (status-table row 22.3, its §3 heading, the "one sub-case remains" filing, and the T2.2 row).
  Each stated **per shape** — row/note half now four of four; slot half closed **and bounded** at
  `min(N, roster count)`; three by-design scope limits named. The unqualified headline is restated
  NOWHERE and the ban is re-affirmed at every site.
  ⚠️ **This line said "four sites (`BACKLOG.md` ×2, …)" until fix round 2.** It was wrong twice over,
  and both errors are worth keeping: the count was low because two more sites were found in later
  rounds, and the parenthetical it carried already **summed to six while the sentence said four** —
  a self-contradiction inside one sentence that neither the writer nor round 1 read. `03172595`'s
  commit message carries the same wrong count and is unamendable; it belongs in the PR body.
- **`BACKLOG.md:1820`'s "215/283" headroom is not rot** — measured against the tags, it is exactly
  `v4.7.0`'s reading, i.e. TRUE when planned and merely undated. Annotated, not overwritten; today's
  244 / 295 recorded beside it. (Same treatment for the PR3-era "292/290" size note.)
- **`run-retry.test.js`'s *"mutate ANY skip branch"* is FALSE and the gap is repo-wide** —
  PARTIALSKIP on the unmappable branch reds NOTHING (537 suites / 7531 passed). Sentence corrected
  at the test, gap filed in BACKLOG.
- **`run-retry-keys.js`'s "spelling this one `=== 1` reds `run-retry.test.js:284` and `:295`" is
  FALSE on the final tree** — measured, that spelling reds 25 tests across 6 suites and leaves both
  named tests GREEN, because with no roster BOTH spellings give an empty Map. The polarity lives in
  the consumer. False certification removed; the property restated with a real pin.
- Also corrected by re-opening: `workspace-seats.js:61` (docblock, not the filter) and
  `live-seats.js:188` (out of range — the file is 125 lines) at two BACKLOG sites;
  `workspace-seats.js:29-38` in `dead-seat-rows.test.js`; `BACKLOG.md:280` at its two live citers;
  `run-assemble.js:223` in the SI-09 `buildVerdict` entry (that file does not call `buildVerdict` at
  all); `run-retry-group.js:64`/`:72` in two counted seatKey site lists; and this plan's own
  `run-retry.test.js:1019`, which is a blank line.
- **Size table re-measured with the gate's own rule** and recorded prominently: `run-retry.js`
  **295/300** and `run-stages.js` **294/300** are both at the cliff — the next PR touching either
  needs an extraction first. Three new modules recorded (74 / 64 / 140).
- Every `minor (deferred)` line in the ledger was triaged: fixed, filed in BACKLOG's T-A8 entry, or
  dropped **with its reason stated**. None was dropped silently.

---

## PR hygiene

- `gh` needs `-R BourbonDog/amicus`. A bare `gh` defaults to upstream `jrenaldi79/sidecar`.
- **NO REQUIRED STATUS CHECKS.** `gh pr merge --auto` merges IMMEDIATELY — it is not a green-CI gate.
  Watch `gh pr checks <n> -R BourbonDog/amicus` explicitly and merge only when green.
- This PR touches source ⇒ it gets the **`council-review`** label. Read the council's actual verdict
  comment, not just whether the job passed — the job passes regardless.
- Council bench `glm,qwen,gpt,kimi`, chair `deepseek`, diff cap 240k. CI resolves aliases from
  `src/utils/curated-models.js` with no user config, so CI's `glm`/`kimi` are not local overrides.
