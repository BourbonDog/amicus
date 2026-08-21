# v4.8.0 · seat resolution — `credSeats` and `credFor` under partial seat information

**Branch** `v48-seat-resolution` · **BASE** `15cba4cf` (merge of PR #176) · written 2026-08-21.

The follow-up the owner ruled out of Phase 3. Three confirmed council findings from PR #176, one
subject: **how seat resolution behaves when a document's seat information is partial, inconsistent,
or mixed.** All three are unreachable on the engine path and reachable on the two hand-assembled
`appendRun` paths, whose rows reach a file that is never migrated.

Written just-in-time per the standing ruling on plan rot. Every number below was measured at BASE
by execution and must be re-measured by the task that depends on it.

---

## 0. Measured substrate — 2026-08-21 at `15cba4cf`

### 0.1 Gates

All green at BASE, each run separately with its own real exit code: `lint`, `check:secrets`,
`check:sizes`, `check:citations`, `validate-docs`. Suite baseline: **542 suites / 7782 passed /
8 skipped / 4 snapshots / 0 failed.**

### 0.2 Sizes (authoritative rule: `content.split('\n').length`, −1 if it ends with `\n`)

Self-checked against `run-retry.js` = 299 ✓.

| File | Lines | Free | |
|---|---:|---:|---|
| `src/council/ledger-join.js` | 178 | 122 | `credFor` lands here |
| `src/council/street-cred.js` | 175 | 125 | `credSeats` lands here |
| `src/council/ledger.js` | 235 | 65 | the `sc` index |
| `src/council/run-assemble.js` | 271 | **29** | ⚠️ tight — this PR should not touch it |
| `src/council/tally.js` | 166 | 134 | |

Both target files have ample room. **If any file approaches 300, EXTRACT — never shave comments.**

### 0.3 The three defects, reproduced at BASE

**Defects 1 and 2 — `street-cred.js :: credSeats`.** The row count follows `seats` rather than
`models` wherever the two disagree:

```
case              models  HEAD rows              count == models.length?
consistent          3     ["a#1","a#2","b"]        YES
partial             3     ["a#1","b"]              NO  -> a row is DROPPED
over-specified      2     ["a#1","a#2","b"]        NO  -> a row is INVENTED
alien alias         2     ["a","b"]                YES
no seats            2     ["x","y"]                YES
claude tail         3     ["a#1","a#2","claude"]   YES
```

Mechanism: `expanded.has(m) → continue`. The first occurrence of an alias expands to one row per
registered seat id, and every later occurrence is skipped.

⚠️ **The claude-tail case is currently CORRECT and must stay so** — `meta.models` carries `claude`
and `meta.seats` never does (`seats.js :: buildSeats` is bench-only by design).

**Defect 3 — `ledger-join.js :: credFor`.** With `a#1` at 1 and `a#2` at 5:

```
group                HEAD
fully seated (both)  {withSelf:3, peersOnly:3}
fully seated (one)   {withSelf:1, peersOnly:1}
MIXED                {withSelf:1, peersOnly:1}   <- reads ONE seat
none seated          {withSelf:3, peersOnly:3}   <- reads BOTH
seat unresolvable    {withSelf:3, peersOnly:3}
```

⚠️ **The inconsistency is the finding, not the drop.** A group that identifies ZERO seats reads
MORE seats than one that identifies ONE. **Partial seat information produces a narrower read than
no seat information.** It is the mirror of the Important-1 defect the T3.3 task review caught.

### 0.4 The two rules, PROTOTYPED and measured — not proposed

Both were run at BASE against the live modules. **Neither changes any shape the engine produces.**

**Rule A — `credSeats`: exactly one row per `models` entry.** The k-th occurrence of alias `m`
takes the k-th registered seat id for `m`, else no seat. `seats` NAMES rows; it never changes how
many there are.

```
case              HEAD                     PROTOTYPE                count==models  delta
consistent        ["a#1","a#2","b"]        ["a#1","a#2","b"]        YES            unchanged
partial           ["a#1","b"]              ["a#1","a","b"]          YES            CHANGED
over-specified    ["a#1","a#2","b"]        ["a#1","b"]              YES            CHANGED
alien alias       ["a","b"]                ["a","b"]                YES            unchanged
no seats          ["x","y"]                ["x","y"]                YES            unchanged
claude tail       ["a#1","a#2","claude"]   ["a#1","a#2","claude"]   YES            unchanged
```

**The invariant to pin: `rows.length === models.length`, always.**

**Rule B — `credFor`: all-or-nothing.** A group is either FULLY identified (every row carries a
seat that resolves in `sc`) → use those seats; or it is not → the alias mean. Partial information
is treated as no information.

```
group                HEAD                  PROTOTYPE             delta
fully seated (both)  {3,3}                 {3,3}                 unchanged
fully seated (one)   {1,1}                 {1,1}                 unchanged
MIXED                {1,1}                 {3,3}                 CHANGED
none seated          {3,3}                 {3,3}                 unchanged
seat unresolvable    {3,3}                 {3,3}                 unchanged
empty group          {3,3}                 {3,3}                 unchanged
```

**The invariant to pin: MIXED reads the same as none-seated.** Monotonicity — partial information
must never read narrower than none.

### 0.5 ⚠️ The two rules COMPOSE, and that is unproven

Rule A can now emit an alias-keyed row (`seat: null`) for an unnamed bench position — e.g. the
`partial` case emits `a#1` **and** `a`. `ledger.js` indexes street cred as
`new Map(streetCred.map(s => [s.seat || s.model, s]))`, so that row lands under key `a`, and
`credFor`'s alias fallback filters `s.model === model`, so it picks up both.

**That composition is reasoned, not measured. The task must measure it end to end** through
`tally()` → `buildLedgerRows()`, not unit-test the two functions in isolation.

### 0.6 Eleven existing named mutants, and four sit on the code being changed

`tests/council/street-cred-mutants.js` carries LEDGERALIAS, CREDALIAS, ALIASLASTWINS, CHAIRWINS,
RANKALIAS, ALIASSELF, JUDGEALIAS, SEATALWAYS, ALIASDRIVER, NOFALLBACK, EMITSET.

**On `credSeats`:** `ALIASDRIVER`. **On `credFor`:** `CREDALIAS`, `ALIASLASTWINS`, and
`LEDGERALIAS` (its `sc` key). ⚠️ **Their measured red sets may MOVE.**

⚠️ **A red set that SHRINKS is the signature of an unpinned property, not a tidy result.** Phase 3
had two shrink and the cause turned out to be benign — but only because it was chased, and it
needed a new eleventh mutant to stay pinned. **Re-run all eleven. Any that moves gets its record
re-measured and the reason stated. If a shape stops being pinned by anything, add the mutant that
pins it.**

---

## 1. Scope

Closes the three PR #176 council findings (`A1`, and `B1` = `C1`). Filed in `BACKLOG.md` with their
measurements under the Phase 3 entry.

**Not in scope, and nothing may claim otherwise:**
- **SI-18** — its findings half (`findings.filter(f => f.raiser === model)`) stays open.
- **SI-22.1 / SI-22.2 / SI-12 / SI-25.**
- **Council finding C2** — measured FALSE in Phase 3 and recorded as such: `judge`/`repair`/
  `superseded` never reach `benchLegs` because `joinsLedger`'s allowlist is fail-closed. **Do not
  "fix" it.** If a future producer is added to `LEDGER_JOIN_ROLES`, that reopens it — not this PR.
- **Council finding C3** — SI-17's conformance time-inconsistency. Disclosed, filed, awaiting an
  owner ruling. Repairing it means giving the chair its own ledger identity, which changes the row
  set. Out of scope.
- **`seatKey` consolidation** (R14 → v4.9).

---

## 2. Global Constraints

**Inherited verbatim from `docs/superpowers/plans/2026-08-17-v48-t2x-run-retry-extraction.md`
§Global Constraints** — 1–11 and 5a–5d bind every task here. Not re-derived, not softened. The ones
this PR collides with:

- **1 · Verification by EXECUTION, never assertion.**
- **2 · Preservation pins are green at HEAD by construction — prove each with a NAMED MUTANT.**
  The behaviour changes here DO get RED-before-GREEN.
- **3 · NEVER run any command that overwrites the working tree from the index or a commit** —
  `git checkout -- <path>`, `git checkout-index`, `git restore`, `git stash`. **The rule is by
  EFFECT, not by spelling.** Commit before mutants; restore from your own file copy.
- **5 / 5a / 5b · Grep the distinctive PHRASE repo-wide, CASE-INSENSITIVELY.** Sweep citations of
  every file the commit TOUCHES. Symbol anchors, never new line numbers, never offset arithmetic —
  **open the line.** Whole `file.js :: symbol` on ONE physical line.
- **5c / 5d · Sweep for prose the behaviour change falsified, and read every NEW sentence against
  the code.** `docs/council.md` is covered by no gate.
- **6 · The 300-line gate blocks the COMMIT. EXTRACT, never shave.**
- **7 · Do not write a test whose title claims more than its assertion executes.**
- **10 · The council RENUMBERS findings between rounds.** Anchor by commit + mechanism.

**Additional, specific to this PR:**

- **S-1 · Neither rule may change any shape the engine produces.** §0.4 measured that at BASE;
  prove it again on the FINAL tree, by executing the producers, not by re-reading the table.
- **S-2 · Every existing mutant is re-run and any moved red set is re-measured with its reason**
  (§0.6). An EMPTY red set means UNPINNED, not safe.
- **S-3 · The composition of the two rules is measured end to end**, through `tally()` →
  `buildLedgerRows()` (§0.5).
- **S-4 · Nothing claims SI-18, SI-22.1, SI-22.2, SI-12 or SI-25 closed**, and nothing "fixes"
  council finding C2 or C3.

### Gates — all must exit 0 before the PR is opened

```
npm test          # baseline 542 suites / 7782 passed / 8 skipped / 4 snapshots / 0 failed
npm run lint
npm run check:secrets
npm run check:sizes
npm run check:citations
npm run check:tarball
npm run validate-docs
```

⚠️ `pre-push` blocks unless `.test-passed` matches HEAD exactly — run `npm test` AFTER the final
commit. Run it SYNCHRONOUSLY; a background monitor cost an hour on the last branch.

---

## 3. Tasks

### T4.1 — the two rules, as one commit

They are one subject and they compose (§0.5); splitting them would put a tree on the branch where
`credSeats` emits an alias row that `credFor` has not yet been taught to read consistently.

1. **`street-cred.js :: credSeats`** — Rule A (§0.4). Pin `rows.length === models.length` as an
   invariant over a case list, not as four separate example tests.
2. **`ledger-join.js :: credFor`** — Rule B (§0.4). Pin that MIXED reads the same as none-seated.
3. Measure the composition end to end (S-3).
4. Re-run all eleven mutants; re-record any that moved, with the reason (S-2).

**RED-before-GREEN** for both rules. **Named mutants** for the new invariants — at minimum one that
reverts `credSeats` to the `expanded.has(m) → continue` form, and one that reverts `credFor` to
`seated.length ?`. Record measured red sets **in the tree**, in
`tests/council/street-cred-mutants.js`, never in a gitignored report path.

⚠️ **Do not change the row DRIVER.** `meta.models` stays the ledger's row driver — `ledger.js`'s
docblock explains why (two of three `appendRun` call sites feed hand-assembled input where
`runStats` may be empty). Rule A makes `credSeats` agree with that doctrine; it does not replace it.

### T4.2 — the record

- `BACKLOG.md`: tick the three findings under the Phase 3 entry, naming the mechanism and the
  commit. Leave C2 recorded as measured-FALSE and C3 as awaiting a ruling.
- `CHANGELOG.md`: the `[Unreleased]` section documents the seat-keyed street cred. State what this
  PR corrects. ⚠️ **Check whether any existing sentence there is falsified by these two rules** —
  a born-false CHANGELOG claim was the Critical the Phase 3 whole-branch review caught.
- `docs/council.md` — covered by no gate. Check the `streetCred[]` description against Rule A.
- Re-derive every citation in files this PR touched, against the FINAL tree, and convert to symbol
  anchors. **Open every line.**

---

## 4. Definition of done

- All gates green, `npm test` run AFTER the final commit.
- `rows.length === models.length` holds for every case in §0.4's table, proved by execution.
- MIXED reads the same as none-seated, proved by execution.
- Every engine-produced shape byte-identical — proved by executing the producers, not asserted.
- All eleven existing mutants re-run; every moved red set re-measured with its reason recorded.
- Nothing claims SI-18, SI-22.1, SI-22.2, SI-12 or SI-25 closed; C2 stays measured-FALSE; C3 stays
  open.
- PR labelled `council-review`. ⚠️ **Read the council's VERDICT COMMENT, not the job status** — and
  check the DURATION first: a ~26–36s run is OpenRouter credit exhaustion, and a ~337s one can be a
  partial whose chair errored. Only a multi-minute run with `chair:complete` and real street-cred
  numbers is a real verdict.
- `gh` needs `-R BourbonDog/amicus`. **NO REQUIRED STATUS CHECKS** — `gh pr merge --auto` merges
  immediately.
