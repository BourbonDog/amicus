# v4.8.0 Phase 2 (T2.1 + T2.2) — Producer-side seat identity

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the producer from silently discarding a second dead seat when two twins share an
alias — a **spend-affecting** defect — and make the run's record agree with what it paid for.

**Architecture:** Two PRs. T2.1 is a pure unification that makes one file spell the seat-key rule
once. T2.2 then changes what that rule *means* at the dedup site, applying ruling **R2** (hybrid),
and moves `recordFailure`, `pushDeadSeatRows` and `attemptedSeats` **in lockstep** — they are one
keyspace and cannot move apart.

**Tech Stack:** Node.js (CommonJS), Jest.

**Base:** `main` = `dbdf09e6` (Phases 0–1 merged). Branches `v48p2-seatkey-unify` (T2.1, already
created) and `v48p2-producer-identity` (T2.2, off `main` after T2.1 merges).

**Both PRs carry the `council-review` label** — owner ruling: only doc-only PRs skip it.

---

## The defect, measured at `dbdf09e6`

`recordFailure` (`src/council/run-retry-group.js:113`) does not merge two entries — it **discards**
the second before it is ever counted:

```js
const key = seatObj ? seatObj.id : seat;
if (unit.firstFailures.some(f => f.seatId === key)) { return; }   // ← both twins hit this
unit.firstFailures.push({ ...ff, seatId: key });
if (trackModel) { unit.models.push(seat); unit.seats.push(seatObj); }
```

Reproduced on `['deepseek','deepseek','gpt']` with two **unbound** dead twin legs:
`models=["deepseek"]`, `seats=[null]`, `firstFailures.seatId=["deepseek"]` — **one retry slot for
two dead seats.** Controls hold: both bound → two entries; unique alias → unaffected.

**The disagreement is worse than the memo states.** Measured end-to-end: the retry buys **1** leg
while `planStillDeadSources` already emits **2** notes and **2** `stillDeadLegs`. Spend and record
already disagree today.

`pushDeadSeatRows` (`src/council/run-stage1-rows.js`) collapses on **both** arms (leg 2→1, wave
2→1) **and they share one Map**, so they also collapse into each other.

## Ruling R2, and where each branch applies — measured

> **R2 (hybrid):** the producer mints a distinguisher (roster slot / leg id) where it has one; where
> it genuinely has nothing, mark explicitly, attribute nothing, announce on a channel.

| Arm | Distinguisher | R2 branch |
|---|---|---|
| **leg arms** (`recordFailure`, `pushDeadSeatRows`) | **`leg.taskId`** — minted `${waveId}-${n}` at `src/sidecar/leg-ids.js:15`, present on every leg including routing failures, survives the disk round-trip, distinct in 3 of the 4 orphan routes | **mint** |
| **wave arms** | **genuinely nothing.** No leg exists, and `(w.waveId, idx)` is measurably non-unique — `missingSeatDeadWave` emits several records per `waveId` each with `idx === 0`, and `run-retry.js:279` re-indexes | **mark / attribute nothing / announce** |

**The twin-vs-unique separation needs no new field at all.** The rule is already in the file, at
`run-retry-group.js:105`:

```js
const identityIsExact = !!bound || seatsPerAlias.get(alias) === 1;
```

Measured: applying exactly this rule at the dedup site yields
`TWIN bench, 2 unbound → models ["deepseek","deepseek"]` while both unique-alias benches stay at
one. It separates the cases; it does **not** name the two twins (both keys still read
`"deepseek"`) — naming needs `leg.taskId` or the announce branch.

---

## Global Constraints

- **Verification by EXECUTION.** Every numeric claim is produced by a command you ran. Quote it.
- ⚠️ **A `Module.prototype._compile` mutation hook is a SILENT NO-OP under jest.** The recon's first
  harness returned a false all-green 7476-pass run that way. **Use `moduleNameMapper`** for any
  mutant harness, and **assert the mutated bytes are actually loaded** before trusting RED or GREEN.
- **Preservation pins are green at HEAD by construction** — prove each with a **named mutant**,
  never RED-before-GREEN. **Commit before running mutants**; revert with a precise reverse-edit.
- **Never run `git checkout -- <path>`.**
- ⚠️ **Re-derive citations against the FINAL tree** (Phase 1's lesson): make every edit to a cited
  file first, then re-derive line numbers, then re-open each at its stated line and read it.
- ⚠️ **`grep` the distinctive phrase of any comment you edit, repo-wide** — a same-file sweep cannot
  find a twin. Phase 1 shipped one and its whole-branch review caught it.
- **Size gate risk — read before designing:** `run-retry.js` is **286/300 (14 lines)** and
  `run-stages.js` is **292/300 (8 lines, effectively zero)**. The two files T2.2 certainly touches
  are comfortable (`run-retry-group.js` 225/**75 free**, `run-stage1-rows.js` 116/**184 free**).
  **If your change does not fit in `run-retry.js`, STOP and report** — that is an extraction
  prerequisite, not something to shave comments for. The gate blocks the COMMIT, not the edit.
- `gh` requires `-R BourbonDog/amicus`. **No required status checks** — `gh pr merge --auto` merges
  immediately; watch `gh pr checks <n>` explicitly.
- Hooks live in `.husky`; `pre-push` runs the full suite unless `.test-passed` matches HEAD exactly.

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

Baseline at `dbdf09e6`: **531 suites / 7476 passed / 8 skipped / 0 failed.**

---

## Task 1: T2.1 — spell the seat-key rule once in `run-retry-group.js`

**PR: branch `v48p2-seatkey-unify` (already created off `dbdf09e6`).**

**Files:**
- Modify: `src/council/run-retry-group.js` (one line, plus a comment)
- Test: `tests/council/run-retry-group-seatkey.test.js` (new) — or add to an existing file if one
  already covers this module; check first and say which you chose.

**Why this is a hard prereq of T2.2:** T2.2 changes what the seat-key rule *means* at the dedup
site. With the rule spelled twice in one file, T2.2 must change both and can miss one. Worse, the
docblock above `seatKey` **already claims** the rule is centralised:

> *The one seat-key rule … Exported so `run-retry.js` consumes it rather than re-spelling it — two
> readers of one rule that drift apart is how the alias/seat-id keyspace splits in the first place.*

`:114` re-spells it 63 lines below that sentence. The comment is false today.

- [ ] **Step 1: Confirm the two spellings and that they are identical**

```bash
sed -n '46,52p;112,118p' src/council/run-retry-group.js
```

Expected: `:51` is `const seatKey = (s, alias) => (s ? s.id : alias);` and `:114` is
`const key = seatObj ? seatObj.id : seat;`.

Measured by the recon over 75 falsy/truthy input combinations: **0 differences**. **Argument order
is load-bearing** — 67 of 75 differ if swapped, so it must be `seatKey(seatObj, seat)`, never
`seatKey(seat, seatObj)`. Re-run that comparison yourself and paste the output.

⚠️ **`:108`'s `bound ? bound.id : null` is a DIFFERENT rule** — it falls back to `null`, not to the
alias. **Do not unify it.** Confirm you left it alone.

- [ ] **Step 2: Make the call**

Replace `:114`'s open-coded expression with `const key = seatKey(seatObj, seat);`. Nothing else in
the function changes.

- [ ] **Step 3: Make the docblock true**

The `seatKey` docblock says the rule exists so `run-retry.js` consumes it "rather than re-spelling
it". After Step 2 that is true of this file too. Add the in-file consumer to the sentence so the
claim matches what the file does — and **grep the phrase repo-wide** for other copies before you
edit it.

- [ ] **Step 4: Pin it**

Two tests. Neither may claim more than it executes (Phase 1's lesson — a title claiming a property
the module system guarantees cost two review rounds):

```js
test('P1 — recordFailure keys through the exported seatKey rule', () => {
  // Named mutant: swap the argument order to seatKey(seat, seatObj) and this goes RED.
  // Measured: 67 of 75 inputs differ under a swap, so the order is load-bearing.
  // <assert recordFailure's emitted seatId equals seatKey(seatObj, seat) for a bound
  //  seat AND for an unbound one — the two branches of the rule>
});

test('P2 — the rule is spelled once in this module', () => {
  // Named mutant: re-inline `seatObj ? seatObj.id : seat` at the call site and this goes RED.
  // Guards the docblock's own claim, which was false at dbdf09e6.
  const src = fs.readFileSync(path.join(__dirname, '../../src/council/run-retry-group.js'), 'utf8');
  // <assert exactly ONE occurrence of the `? <x>.id : <y>` seat-key shape, and that it is
  //  seatKey's definition — write the regex so `bound ? bound.id : null` at :108 does NOT
  //  match, since that is a different rule>
});
```

P2's regex is the delicate part: it must distinguish the seat-key rule (alias fallback) from
`:108`'s null fallback. **Verify both by running the mutants**, not by reading.

- [ ] **Step 5: Gates, then commit**

```bash
npm test
```
Expected: **531 suites / 7476 passed + your new tests / 8 skipped / 0 failed.** This is a
behaviour-preserving change; any pre-existing test that goes red is a finding — stop and report it.

```bash
git add src/council/run-retry-group.js tests/council/run-retry-group-seatkey.test.js && git commit -m "refactor: recordFailure keys through the exported seatKey rule (T2.1)"
```

- [ ] **Step 6: Run the named mutants — commit FIRST**

**MUTANT "SWAP"** — `seatKey(seat, seatObj)`. Expected: **P1 RED**.
**MUTANT "INLINE"** — restore the open-coded `seatObj ? seatObj.id : seat`. Expected: **P2 RED**.

Reverse-edit each, confirm GREEN, confirm `git status --short` is clean. Then re-run `npm test` so
`.test-passed` matches HEAD.

---

## Task 2: T2.2 — N orphans produce N retry slots and N rows, on both arms

**PR: branch `v48p2-producer-identity` off `main`, after T2.1 merges.**

**Files (measured headroom in parentheses):**
- Modify: `src/council/run-retry-group.js` (225, 75 free) — `recordFailure`'s dedup
- Modify: `src/council/run-stage1-rows.js` (116, 184 free) — `pushDeadSeatRows`, both arms
- Modify: `src/council/run-retry.js` (**286, 14 free**) — `attemptedSeats` lockstep. **Tightest file.**
- Modify: `tests/council/run-retry.test.js` — **replace** H4
- Modify: `tests/council/run-stages.test.js` — **re-fixture** T12

**Interfaces:** consumes T2.1's single `seatKey` spelling. If you find yourself editing two
expressions of the same rule, T2.1 did not land — stop and report.

### The three things that make this fail

**(a) `attemptedSeats` must move in LOCKSTEP.** Measured: for unbound twins,
`retry.attemptedSeats = Set(["deepseek"])` — one key for two seats, minted by the same rule at
`run-retry.js:151/162/182/224/256`. `run-stage1-rows.js:98` consumes it:

```js
finalLeg = retry.attemptedSeats.has(key)
  ? null                                             // retried; no leg at all for this seat
  : (deadLegs0.find(l => keyOf(l) === key) || null);  // never retried
```

If `recordFailure` mints N keys and `attemptedSeats` stays collapsed, this predicate flips for every
seat whose key changed and **re-attaches a first-attempt leg to a seat that WAS retried** — the exact
hazard the comment at `:92-97` documents. **Measured under a roster-shaped mutant with a collapsed
`attemptedSeats`: rows go 1 → 2 while both still resolve through the old alias key.**

**(b) T12 is green against its own mutant — re-fixture it FIRST.** `tests/council/run-stages.test.js:1212`
("T12: two ORPHANED twin seats collapse to ONE row that carries NO seat") calls
`pushDeadSeatRows({ o: {}, … })` at `:1198` — **no roster**. Measured:

```
T12 fixture spelling  o:{}          HEAD rows= 1   roster-fix rows= 1
PRODUCTION spelling   o:{seats:...} HEAD rows= 1   roster-fix rows= 2
```

Production passes the real `ctx.o` (`run-stages.js:279`, populated at `run.js:132`). **As written,
T12 reports success both for a change that does nothing and for a change that works.** Re-fixture it
to `o: { seats: SEATS }` **before** using it as a pin or a proof.

**(c) This cannot be written green.** Measured with the R2-shaped roster rule, exactly **one** test
goes red repo-wide: `tests/council/run-retry.test.js:632` — *"H4: two UNIDENTIFIED losses on one
alias still collapse — nothing distinguishes them"*. It **pins the collapse as correct by name** and
must be **REPLACED**, not repaired (the `tally.test.js` T1/T2 precedent). Its replacement asserts
two distinct retry slots on a **twin** bench while still asserting collapse on a **unique-alias**
bench.

⚠️ **Do not reach for the crude rule** ("unbound never dedups"). Measured: it reds **four** tests,
and three of them (`run-retry.test.js:284`, `:295`, and the correct half of H4's intent) pin
behaviour R2 requires **preserved** — those fixtures are unique-alias benches where two losses on
one alias really *are* one seat. A crude fix is wrong, and the suite says so.

- [ ] **Step 1: Reproduce the defect and the controls before changing anything**

Drive the real `recordFailure` on the twin bench with two unbound dead legs; run both controls.
Paste probe source and raw output. If the numbers differ from those at the top of this plan, **stop
and report** — the substrate moved.

- [ ] **Step 2: Re-fixture T12 (its own commit, before the fix)**

Change T12's `o: {}` to a real roster and confirm it **still passes at HEAD** (it pins the collapse,
which HEAD still does). This is the pin that will observe your change; strengthening it first is
what makes Step 5's RED meaningful.

- [ ] **Step 3: Apply the R2 rule at the dedup site**

Use the rule already in the file (`run-retry-group.js:105`):

```js
const identityIsExact = !!bound || seatsPerAlias.get(alias) === 1;
```

Dedup **only when identity is exact**. Where it is not, mint per R2: **leg arms use `leg.taskId`**;
**wave arms have nothing** — mark the record explicitly, attribute nothing, and announce on a
channel. Both arms of `pushDeadSeatRows` move in **this same commit** (they share one Map).

- [ ] **Step 4: Move `attemptedSeats` in the same commit**

See (a). Verify by asserting that a retried twin seat does **not** get a first-attempt leg
re-attached. ⚠️ `run-retry.js` has **14 lines** of headroom — if your change does not fit,
**STOP and report**; that is an extraction prerequisite.

- [ ] **Step 5: Replace H4, and pin the new behaviour**

Delete H4 and write its replacement: two distinct retry slots on a twin bench, collapse preserved on
a unique-alias bench. Pin the whole change with **named mutants**, not preservation cycles —
minimally one that reverts the roster rule and one that de-syncs `attemptedSeats`.

- [ ] **Step 6: Measure the `deriveSeatLoss` interaction and report it**

`verdict.js :: deriveSeatLoss` reads **`data.seat` only** (alias-valued), behind a `!critic` master
gate and `dead-leg`/`dead-wave` channel gates, and its `deadBenchSeats` is **un-deduped**. So N notes
where 1 was simply appends N−1 duplicate alias strings; `data.seatId` is invisible to it; the critic
path is N-insensitive. SI-02 is deferred to v4.9 — **you are not fixing this.** Measure what your
change actually does to it and report it. If it degrades a user-visible surface, stop and report
rather than absorbing it.

- [ ] **Step 7: All four gates, then commit**

The suite will not match baseline — H4 is gone and its replacement is new. Report the exact delta
and account for every changed count.

---

## Done criteria

**T2.1:** one seat-key spelling in `run-retry-group.js`; `:108`'s different rule untouched; MUTANT
"SWAP" and "INLINE" both observed RED; suite green with no pre-existing test red.

**T2.2:** N orphans → N retry slots **and** N rows on **both** arms; `attemptedSeats` in lockstep;
T12 re-fixtured and observing the change; H4 replaced; `deriveSeatLoss` interaction measured and
reported; `run-retry.js` still under 300 or an extraction prerequisite reported.

**Both:** four gates exit 0; `council-review` label applied; checks watched explicitly before merge.
