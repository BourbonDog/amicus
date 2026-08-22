# v4.8 Phase 5 — the debate join (SI-10 + SI-13)

**Plan written 2026-08-21, just-in-time, immediately before its development.**
**BASE: `9ef275e5`** (`main`, v4.8 Phase 4 — R5: seat id on the live leg row, PR #178).
**Branch: `v48-debate-join`.**

Owner ruling **R8** (`docs/superpowers/plans/2026-08-16-v48-phasing-and-rulings.md :: 4. Owner
rulings`): *"**Refuse** a re-vote whose seat is unknown → SI-13 collapses to a JSDoc edit at
`debate.js:44`"*.

---

## 0. Measured substrate — 2026-08-21 at `9ef275e5`

Everything in this section was produced by **executing** code at BASE. Nothing here is carried
forward from an earlier plan, and nothing here is derived by reasoning about code shape.

### 0.1 Gates — all seven measured at BASE, each with its own exit code

Each was run as its own command and its own `$?` was read directly (never through a pipe, which
would report the last stage's status instead):

| gate | exit |
|---|---|
| `npm run lint` | 0 |
| `npm run check:secrets` | 0 |
| `npm run check:sizes` | 0 |
| `npm run check:citations` | 0 |
| `npm run check:tarball` | 0 |
| `npm run validate-docs` | 0 |
| `npm test` | 0 |

`npm test`: **544 suites / 7810 passed / 8 skipped / 4 snapshots / 0 failed**, 208.311 s. The output
file contains **exactly ONE** `Test Suites:` block (`grep -c` = 1) and **zero** `●` failure markers,
so the summary above is the final one and not a first-run block above a retry.

### 0.2 Sizes — by the gate's OWN rule, which is the ADJUSTED count (equivalently `wc -l`)

`scripts/check-file-sizes.js:19` sets `maxLines: 300`. ⚠️ **THIS SECTION STATED THE RULE WRONG, and
so did Global Constraint 10 and the definition of done — corrected in the whole-branch fix wave.**
The heading read *"by the gate's OWN rule (`content.split('\n').length`), not `wc -l`"* and this
line cited `:54` alone. `:54` is only half the computation: `:54-55` is

```js
  const lineCount = content.split('\n').length;
  const adjustedCount = content.endsWith('\n') ? lineCount - 1 : lineCount;
```

and `:57` compares the **adjusted** count. Every file here ends with a newline, so the gate's number
is `wc -l` — **exactly what this heading said it was NOT.** ⚠️ Note the shape of the error, because
it is this branch's own documented failure mode wearing a different hat: **the citation POINTED at
`:54` correctly and did not SAY what `:54-55` says.** A green `check:citations` cannot see that,
and neither did three reviews.

| file | gate-count (adjusted, at BASE) | headroom |
|---|---|---|
| `src/council/run-debate-revote.js` | 176 | **124** |
| `src/council/debate.js` | 256 | 44 |
| `src/council/run-debate.js` | 273 | **27** |

⚠️ **`run-debate.js` has 27 lines of headroom** (this said 26). That is the binding design
constraint of this phase and it is why §0.6 rules the way it does. If a task finds itself needing to
add more than a few lines there, **extract — do not shave comments** (house rule). Every figure in
this table was one too high while the wrong rule stood; each was re-measured against
`checkFileSize`'s own expression, not adjusted by arithmetic.

### 0.3 The defect, reproduced by execution — three probes

`runRevoteWave` computes its join key as `seatKey(seat, judge)` where
`seatKey(seat, alias) => seat ? seat.id : alias` (`run-debate-revote.js:64`, called at `:132`), and
publishes it as `byJudge[key]` (`:168`). `applyDebate` joins that key against
`(a.seat || a.judge)` (`debate.js:83`) and, on no match, **pushes a new adjudication row**
(`debate.js:93`).

**Probe 1 — `runRevoteWave` really does emit a bare-alias key, and says nothing.** Driven through
the real `runRevoteWave` with a twin bench `['deepseek','deepseek','gpt']` and one `-rv` leg that
`bindSeats` cannot attribute:

```
byJudge KEYS: ["gpt","deepseek"]
legs seat field: gpt->seat=gpt | deepseek->seat=null
degrade notes emitted: 0 []
```

The unbound twin leg publishes the **bare alias `"deepseek"`**, and **nothing is announced**.

**Probe 2 — that key makes `applyDebate` invent a row.** 4 adjudications in → **5 out**; the extra
row is `{ findingId: 'A1', judge: 'deepseek', verdict: 'agree' }` — **no `seat` key**, a voter that
corresponds to no bench position.

**Probe 3 — the decisive one: what it costs.** Bench `deepseek#1 / deepseek#2 / gpt`; finding `C1`
**raised by `gpt`**, so both twins are legitimate judges and both disputed provisionally. One twin
re-votes `agree`:

| case | adjudications | tier | basis |
|---|---|---|---|
| provisional, no re-vote | 2 | Disputed | `{a:0, d:2}` |
| **BOUND** — the re-vote attributes correctly | 2 | **Contested** | `{a:1, d:1}` |
| **UNBOUND** — today's bug | **3** | Disputed | **`{a:1, d:2}`** |

**Three votes on a two-judge finding, and `d:2` where the bench can only supply `d:1`.** The judge's
paid re-vote is silently discarded (its old `dispute` still stands) *and* a phantom voter is added
alongside it. This is a correctness defect in the basis counts that reach `tally.js`, not a
rendering blemish.

⚠️ **A narrower claim than the BACKLOG entry's headline, and it must not be over-stated.** Probes
run first on a finding raised by the twin alias itself showed **no tier change at all** — there,
`peer-split.js :: peersOf`'s `v.judge !== f.raiser` filters the phantom row as a self-vote and the
basis is untouched. **The damage is real only when the finding is raised by a DIFFERENT alias**, as
in probe 3. Any test written for this must use probe 3's shape; probe 1's shape is green either way.

⚠️ **Probe 3's numbers are for an ISOLATED `applyDebate` call in which the unbound twin is the ONLY
re-voter. They are NOT the end-to-end expectation.** Task 2's fixture has **both** twins re-voting
with only one unbindable, and its measured BASE and post-fix numbers differ. **Task 2's own measured
block is the authority for that test** — do not carry these three rows into it.

### 0.4 Why the refusal belongs in `runRevoteWave`, and NOT in `applyDebate`

`applyDebate` **cannot** distinguish the two reasons its lookup misses:

1. the wave could not name the seat (this defect), and
2. **a stateless leg re-voting an id it never adjudicated** — a legitimate, deliberately supported
   case, pinned today by `tests/council/debate.test.js:65` :: *"a re-vote on an id the judge never
   disputed is still applied (stateless legs)"*, and described in `debate.js:86-88`'s own comment.

Only `runRevoteWave` holds the fact that separates them: `seat === null` for that leg. So the
refusal lives there, and **`applyDebate`'s behaviour does not change at all** — which is exactly
why R8 predicts SI-13 collapses to a JSDoc edit. That coherence is the confirmation that this is
the intended shape.

⚠️ **Case 2 must keep working. A test that refuses on "no matching adjudication" is wrong** and
will red `debate.test.js:65`.

⚠️ **CORRECTED 2026-08-21 (T5.4) — a FALSE CLAIM, not a stale number, and it appears three times in
this document: §0.4's numbered item 2, §0.4's "Case 2 must keep working" warning, and §4's
definition of done.** ⚠️ **This sentence cited those first two as `:107` and `:116` until the
whole-branch fix wave, when §0.2's own repair pushed them down and falsified it — the third
self-inflicted line-number rot on this branch, and the reason all three are now named
structurally.** `tests/council/debate.test.js:65`
does **not** pin the fail-open push. Measured by executing `applyDebate` against that test's exact
fixture: `baseInput()` already carries `{ findingId: 'A2', judge: 'gpt', verdict: 'dispute' }`
(`debate.test.js:20`), so re-voting `gpt` on `A2` takes the **found-entry** branch and updates in
place — **4 adjudications in, 4 out; the array never grows.** The test is *named* "a re-vote on an
id the judge never disputed"; its fixture is not that shape. The two tests that really do exercise
the push, re-derived by test NAME rather than by number and re-opened at this head, are
`debate.test.js:156` :: *"a genuinely new row carries the ALIAS in `judge` and the seat in `seat`"*
(1 in → 2 out) and `debate.test.js:169` :: *"a unique bench pushes the byte-identical {findingId,
judge, verdict} row"* (4 in → 5 out). The test file's own comment above `:156` has said so verbatim
since PR3.
⚠️ **This exact trap was already filed in this repo** —
`docs/superpowers/plans/2026-08-13-v48-pr3-stage2-debate-binding.md:577` records it — **and this
plan walked into it anyway.** The durable lesson, recorded where the next reader will hit it:
**re-deriving that a citation POINTS somewhere is not re-deriving that it SAYS what you claim.**
`:65` resolves, is green, and is untouched; it simply never described the branch this section
attached it to. What §0.4's *argument* needs is only that case 2 exists and is supported — which it
is, in `debate.js :: applyDebate`'s own fail-open comment — not that `:65` pins it.

### 0.5 The refusal predicate — measured on BOTH bench shapes, not reasoned

`seat === null` is **NOT** the predicate. On a unique-alias bench `seat.id` **is** the alias string
(`seats.js:67` mints `alias#N` only for a repeat), so `seatKey(null, 'qwen')` returns `'qwen'`,
which *is* that seat's id and joins correctly today. Refusing on `!seat` would discard perfectly
joinable re-votes — a regression.

**The predicate is: the key names no seat on this wave's roster.** Measured through the real
`runRevoteWave`, with an unbindable leg on each bench shape:

```
UNIQUE bench, leg unbindable   seat ids: gemini, gpt, qwen
  byJudge key "qwen"      names a seat? true   -> ALLOW   (today's behaviour, preserved exactly)
TWIN bench, twin leg unbindable  seat ids: deepseek#1, deepseek#2, gpt
  byJudge key "deepseek"  names a seat? false  -> REFUSE  (the defect)
```

⚠️ **REFINED DURING T5.1 — the shipped predicate is broader than the line above, and the line above
alone would have caused a REGRESSION.** Recorded rather than silently fixed. The implementer raised
it; the controller verified it against a pre-existing fixture and ruled for the refinement. Shipped:

```js
    if (boundLegs.has(leg) || rosterIds.has(key)) { /* publish */ } else { /* refuse + announce */ }
```

`rosterIds` is the set of **real** (non-placeholder) seat ids; `boundLegs` is every leg `bindSeats`
placed on **any** roster slot, placeholder included. The extra `boundLegs` arm exists because of
the **§3.4 roster-hole** case, pinned today by `run-debate.test.js`'s *"§3.4 placeholder contract at
the -rv call site (a ROSTER HOLE)"*: a judge orphaned at **Stage 2** leaves a provisional
adjudication row carrying **no `seat`**, so `disputingJudges` yields a bare alias, a placeholder
seat is minted for it — and that bare-alias key **joins correctly** against `(a.seat || a.judge)`,
because the row it must replace has no seat either. **The two facts are coupled by construction.**
Refusing it would discard a re-vote that would have joined perfectly, and reds that fixture's `M1`
assertion. Measured: the `REFUSEALL` mutant reds **both** that pre-existing test and the new
unique-alias one.

⚠️ **THE "Shipped:" BLOCK ABOVE IS NOT WHAT SHIPPED — corrected 2026-08-21 (T5.4), in place, per
this document's own convention.** It was written by the note that landed at `9a525af1`, one commit
*before* T5.1's own review round `6b452c99` collapsed the guard again — and it was never brought
forward. The predicate in the tree today is:

```js
    if (boundLegs.has(leg) || judgeKeys.includes(key)) { /* publish */ } else { /* refuse + announce */ }
```

`rosterIds` **no longer exists**; `6b452c99` deleted it. Its second arm was *broader* than
`rosterIds.has(key)`, not narrower, and the collapse was itself a defect fix: a roster hole whose
own `-rv` leg is ALSO unbindable is covered by neither `boundLegs` (it binds to nothing, not even
the placeholder) nor `rosterIds` (its bare alias names no REAL seat) — and BASE joined that case
**correctly** (measured: 2 adjudications in, 2 out, the seat-less row's verdict replaced, no phantom
row), so refusing it was a regression. `judgeKeys` is a superset of the real seat ids, because
`judgeSeats` is positionally bound to it, and it additionally contains the bare alias a roster hole
keys on. Everything the paragraph above says about `boundLegs` and the §3.4 roster-hole case stays
true; only the name and reach of the second arm changed. `REFUSEALL`'s red set grew from 2 to 3 in
that same round, which is what proved the added roster-hole test entered the path.

⚠️ **One deliberate, measured over-refusal, stated so nobody re-derives it.** If a wave's roster
happens to carry only ONE seat of a twinned alias (the other twin raised the finding, so it is not
a judge), an unbindable leg still keys on the bare alias and is still refused, even though the
alias is locally unambiguous. **This is not a regression**: at BASE that key also fails to match —
the provisional row carries `seat: 'deepseek#1'` — so it invents a row there too. Refusing is
strictly better than BASE in every case measured. **Resolving** such a key to its seat is the other
remedy the BACKLOG names, and **R8 ruled for refusal over resolution.** Do not implement resolution
here.

### 0.6 The announcement — and what this plan deliberately does NOT do

**`ctx.degrade` is present.** Measured, not assumed: `run.js:119` builds
`const ctx = { o, launchers, addWave, overBudget, degrade, scratchDir: ... }`, and that same object
is passed to `runDebateStage` → `runDebate` → `runRevoteWave`. The test fixture supplies it too —
`tests/council/run-debate.test.js :: ctxFor` sets `degrade: { note: (rec) => notes.push(rec), all:
() => notes }` (a **recording** sink, retrievable via `ctx.degrade.all()`).

⚠️ `run-debate-revote.js`'s own docblock says `@param {object} ctx run.js's {o, launchers, addWave,
scratchDir}` — it omits both `degrade` and `overBudget`. That is an **under-specification of a
contract that already holds**, not a contradiction. Widening that `@param` is part of Task 1.

⚠️ **A DRAFT OF THIS SECTION WAS WRONG — announcing DOES flip the run to exit 2.** Recorded rather
than silently fixed, per this repo's plan-annotation convention. **The T5.1 implementer pushed back
on the draft claim and was right; the controller re-measured and overruled itself.**

The draft said *"a degrade note does NOT flip the exit code"*, reasoning from
`run-finalize.js :: resolveTerminalExit`, whose terminal expression
(`return (exitCode === 0 && degraded && degraded.value) ? 2 : exitCode;`) keys on `degraded.value`
and not on whether a note was emitted. **That is true and it is not the whole path.** The half never
measured is the sink itself — `src/council/run-degrade.js :: createDegradeSink`'s `note()` ends:

```js
    if (record.kind === 'degrade' && degraded) { degraded.value = true; }
```

and `src/utils/degrade.js:34` defaults `kind` to `'degrade'` (`KINDS` is only `degrade`/`heal`).
**So any default-kind note sets `degraded.value = true`, and a clean run exits 2.**

**This is correct behaviour and is what ships.** `stage1-bind.js:53 :: orphanLegNote` passes no
`kind` either, so an unattributable **Stage-1** leg already degrades the run today — the
`seat-unbound` channel's established meaning. A discarded paid re-vote is a real degradation, and
`heal` (the only alternative kind) would be a lie: nothing recovered.

⚠️ **Do not repeat the draft's claim.** Task 4's CHANGELOG entry must say the refusal **degrades the
run (exit 2)** on the `seat-unbound` channel, exactly as a Stage-1 orphan does.

⚠️ Note the separate, still-true fact this does NOT change: a refused leg is `status: 'complete'`
with `conformance: 'clean'`, so `run-debate.js :: runDebate`'s
`bad = (l) => l.status !== 'complete' || l.conformance === 'unstructured'` (`:250`, feeding
`degraded` at `:251`) stays false for it. The exit-2 comes from the **note**, not from `dbg.degraded`
— two different routes to the same flag.

**Ruling — `debate.json` gets NO `applied: false` rows.** Considered and rejected:

- `revotes[].applied` is written as an unconditional literal `true` at `run-debate.js:231` and,
  measured across `src/` and `electron/`, has **no runtime consumer**. (`workspace-matrix.js:172`'s
  `d.applied` was checked directly and is `vp.decisions` — **chair decisions**, a different
  document.)
- Adding refused rows would drag **three** knock-on edits into the file with **27 lines** of
  headroom (this said 26 under the misstated size rule — see §0.2): `debateSummary.revoteApplied = revotesJson.length` (`:243`) would start counting
  refusals as applied; `addendumOutcomes`' `revotes:` projection (`:265`) would show the chair a
  vote that was refused; and the exact-key-set pin in `run-debate.test.js` — the test named *"a
  unique-alias bench writes revotes[] rows with NO seat key at all"*, cited as `:1020` here and
  re-anchored by NAME in §0.7 after it moved twice — guards that row
  shape.
- The record is **not** lost without it: the leg, its cost and its `conformance` still land in
  `runStats`, its raw output still lands in `revote-<name>.md`, and the refusal itself is announced
  on the `seat-unbound` channel. `revoteJudges` vs `revoteApplied` will visibly disagree, and the
  note explains why.

**Cost if wrong:** `debate.json` does not itself name the refused re-vote; a reader must read the
degrade note. Cheap to add later as its own change.

### 0.7 Citations re-derived — one is STALE, two are still TRUE

Every anchor this phase inherits was re-opened at BASE. `check:citations` is green, but that gate
only checks a number is **in range** — it cannot catch a number that now points at the wrong line.

| carried citation | verdict at BASE |
|---|---|
| `BACKLOG.md:3784` — `runRevoteWave` fallback at `run-debate-revote.js:124` | ⚠️ **STALE.** `seatKey` is *defined* at `:64` and *called* at `:132`. `:124` is inside the roster-padding block. |
| `BACKLOG.md:3787` — `(a.seat \|\| a.judge) === key` at `debate.js:83` | ✅ TRUE at `:83`. |
| `BACKLOG.md:3787` — fail-open push at `debate.js:93` | ✅ TRUE at `:93`. |
| phasing doc R8 — *"a JSDoc edit at `debate.js:44`"* | ⚠️ **IMPRECISE, and it is a LINE not a symbol.** `:44` is real and is inside `applyDebate`'s docblock, but it is the **`defenseByRaiser`** `@param` line. The `aliasOf` param — what SI-13 is actually about — is at **`:46`**. Anchor by symbol: `debate.js :: applyDebate`. |

Task 4 corrects the stale one **by symbol**. ⚠️ It corrects the *number*; the surrounding prose is
true and must not be "corrected" with it.

⚠️ **THIS TABLE BECAME SELF-FALSIFYING WHILE THE PHASE RAN — corrected in place 2026-08-21 (T5.4),
not silently rewritten.** Its two ✅ rows were true when written at BASE `9ef275e5` and are **FALSE
now**, because T5.3 grew `debate.js` 256→274. `BACKLOG.md`'s `(a.seat || a.judge) === key` is
`debate.js:99`, and the fail-open push is `debate.js:111` — both re-opened, both repaired in
`BACKLOG.md` by T5.4, and both now carry their `was`-chain there. (The third row's own row numbers
also drifted: the two `BACKLOG.md` citations it calls `:3787` are `:3787` and `:3788`, and the
whole file has since moved anyway — which is why T5.4 anchored the repairs by symbol.)

⚠️ **Every OTHER anchor in this document that points into a file this branch grew, re-opened in the
same pass.** `§0` is dated at BASE and its narrative is unchanged; these are the current values, so
nobody re-derives them:

| this plan says | current, measured at T5.4 |
|---|---|
| §0.3 `run-debate-revote.js:64`, "called at `:132`", publish at `:168` | `:64` unmoved · call `:188` · publish `:271` |
| §0.3 `(a.seat \|\| a.judge)` at `debate.js:83`, push at `debate.js:93` | `debate.js:99` · `debate.js:111` |
| §0.4 "described in `debate.js:86-88`'s own comment" | the fail-open comment is `debate.js:102-109` |
| §0.6 the exact-key-set pin at `run-debate.test.js:1020` | ⚠️ **anchored by TEST NAME, no number** — `run-debate.test.js`'s *"a unique-alias bench writes revotes[] rows with NO seat key at all"*. It was `:1020` at BASE, `:1357` after T5.1/T5.2, and `:1457` after the BOUNDDROP block; three values in one branch is the argument against writing a fourth |
| §3 Task 1's harness list — `ctxFor` `:126`, `TWIN_BENCH` `:55`, `twinInput` `:38`, `leg`/`wave` `:104`/`:108`, `revoteOut` `:110` | `:133` · `:62` · `:45` · `:111`/`:115` · `:117` |
| §3 Tasks 1–2's `stampFanout` at `run-debate.test.js:64` | `run-debate.test.js:72` |

⚠️ **`§0.6`'s `run-debate.js` anchors were re-opened too and are ALL still true** — `:231`
(`applied: true`), `:243` (`revoteApplied`), `:250`/`:251` (`bad`/`degraded`), `:265` (the
`addendumOutcomes` projection): this branch never edited that file's line count.

### 0.8 Ordering — re-derived at THIS base, not carried

The phasing doc's §6 splits orderings into "genuinely gating (mechanical)" and "preference only".
Re-read at BASE:

- The only Phase-5-adjacent entry in the **gating** list is `R5 → any seat-keyed suppression on the
  live tick`. **R5 is Phase 4, and Phase 4 is merged** (PR #178). Nothing in that list gates
  Phase 5.
- The **preference-only** list names `Phase 3 vs Phase 4 order` — both merged, so it is moot.
- Nothing forces Phase 5 ahead of Phase 6's independents, or the reverse.

**Conclusion: Phase 5 is unblocked and is the resume point `BACKLOG.md:3084` itself names.**
⚠️ **True when written; superseded 2026-08-21 by T5.4.** That slot now names **Phase 6:
Independents** — the entry was replaced, not appended, and this section's finding was carried into
it verbatim so the next controller does not derive it a third time. ⚠️ **The line number no longer
lands on that entry, and no replacement number is given here on purpose.** An earlier draft of this
very sentence claimed it did still land — false: T5.4's own `BACKLOG.md` edits *above* the entry had
already pushed it down, and `:3084` is a blank line. **Find it by its TITLE,
`NEXT TASK — Phase 6: Independents`, and by nothing else** — every number written here has been
falsified by the next insertion above it, twice, inside one task.
Proceeding with it is a preference exercised on a measured tie, exactly as Phase 4's §0.9 recorded
for itself — not a discovered dependency. Stated plainly so the next controller need not re-derive
it.

### 0.9 ⚠️ Open items that are NOT prerequisites — do not let a reviewer turn these into scope

Both filed in `BACKLOG.md` by Phase 4, both independently corroborated, **both out of scope here**:

- The **Stage-1 RETRY wave** still launches without a seat roster (`run-retry.js:90-96`). Different
  wave, different file, different phase.
- **`stampLegAttribution`'s index-parallel contract** is unenforced at the function boundary.

Also open and out of scope: SI-18's findings half (⚠️ **never tick SI-18**), SI-22.1/22.2 (ruling
R2 — ⚠️ the R2 disclosure is not to be weakened or re-litigated while editing nearby prose),
SI-12 (ruling R19 — ⚠️ **not** what T2.4 closed), SI-17's C3.

---

## 1. Scope

**In:** the refusal in `runRevoteWave`; its announcement on the `seat-unbound` channel; the
`@param` widening of that function's `ctx`; the SI-13 JSDoc edit in `debate.js :: applyDebate`; the
tests that pin all of it; the record (BACKLOG verdicts, the stale citation, CHANGELOG).

**Out:** `applyDebate`'s behaviour (§0.4); resolving an ambiguous alias to a seat (§0.5, R8 ruled
against); `applied: false` rows in `debate.json` (§0.6); everything in §0.9.

## 2. Global Constraints

1. **Verification by EXECUTION, never assertion.** Every claim in a report or a comment is backed
   by a command that was run and whose output is pasted.
2. **Behaviour changes get RED-before-GREEN.** Preservation pins are green at HEAD by construction
   — prove each with a **NAMED MUTANT** instead, and **record every mutant's red set in a COMMITTED
   file** (test comment and/or commit message). `.superpowers/` is deleted at branch end; a red set
   recorded only there evaporates.
3. **An empty mutant red set means the property is UNPINNED. A SHRINKING red set is the same
   signature.** A red set that **grows** when a test is added is proof that test entered the path.
4. ⚠️ **NEVER run any command that overwrites the working tree from the index or a commit** —
   `git checkout -- <path>`, `git checkout-index`, `git restore`, `git stash`, by any spelling. The
   rule is by **EFFECT**. Commit before mutants; hand-revert or restore from a file copy you made
   yourself; byte-verify with `git show HEAD:<path>`.
5. ⚠️ **An end-to-end test must NOT hand-build the intermediate value the change produces.** The
   `byJudge` key must come out of the real `runRevoteWave`, never a literal.
6. **Never derive a corrected citation by offset arithmetic — open the line.** Anchor by symbol,
   whole `file.js :: symbol` token on ONE physical line. ⚠️ A green `check:citations` is not
   evidence: it only checks the number is in range.
7. **Grep the distinctive PHRASE of any sentence you edit repo-wide, case-insensitively, and for
   its TWINS.** A same-file sweep cannot find twins.
8. **Read every NEW sentence against the code.** A comment born false is this project's most
   expensive recurring defect.
9. ⚠️ **NEVER sweep `output/`** (~45 council run artifacts — editing them falsifies history) or
   dated plan snapshots `docs/superpowers/plans/2026-08-15-*`. Scope every sweep with explicit
   exclusions, and state the rationale as *"deliberate quotation"* or *"dated snapshot / run
   artifact"* — **never "gitignored"**; `docs/superpowers/plans/*.md` is tracked.
10. **Size gate is 300 by `checkFileSize`'s ADJUSTED count** — `content.split('\n').length`, minus
    one when the file ends with a newline, i.e. `wc -l` for every file here
    (`scripts/check-file-sizes.js:54-57`). ⚠️ **This constraint stated the UNADJUSTED rule until the
    whole-branch fix wave, so every figure derived from it was one too high** — see §0.2.
    `run-debate.js` has **27** lines of headroom (this said 26). If a file approaches 300,
    **EXTRACT — never shave comments.**
11. **No subagent dispatches subagents**, and no implementer runs a reviewer.

### Gates — all seven must exit 0 before the PR is opened

`npm run lint` · `check:secrets` · `check:sizes` · `check:citations` · `check:tarball` ·
`validate-docs` · `npm test`. ⚠️ `npm test` runs **after the final commit**, **synchronously in the
foreground** — `.husky/pre-push` blocks unless `.test-passed` matches HEAD exactly.

---

## 3. Tasks

### Task 1 — T5.1: refuse the unnameable re-vote, and announce it

**File:** `src/council/run-debate-revote.js` (headroom 124 — this said 123 under the misstated size rule; see §0.2).

**Change.** At the `byJudge[key] = parsed.byId;` site (`:168`), gate the publish on whether `key`
names a seat on this wave's roster. When it does not: **do not publish the votes**, and emit
`ctx.degrade.note(...)` on channel **`seat-unbound`**, following `stage1-bind.js:53 ::
orphanLegNote`'s field shape (`channel` / `what` / `why` / `effect` / `data`). The `effect` text
must say the re-vote was **not applied** and that the judge's provisional verdict stands.

The leg itself is still pushed to `legs` exactly as today — it ran, it cost money, and its
`runStats` row, its `revote-<name>.md` and its `conformance` are all unchanged. **Only the parsed
votes are withheld.**

Also widen this function's `@param {object} ctx` to name `degrade` and `overBudget` (§0.6).

**Predicate:** §0.5 — *the key names no seat on this wave's roster*. ⚠️ **Not `!seat`.**

**Tests** (`tests/council/run-debate.test.js`, harness verified present: `ctxFor` at `:126`,
`TWIN_BENCH` at `:55`, `twinInput` at `:38`, `leg`/`wave` at `:104`/`:108`, `revoteOut` at `:110`):

- **RED-before-GREEN**, twin bench, one `-rv` leg unbindable: `byJudge` has **no** bare-alias key,
  and `ctx.degrade.all()` contains exactly one `seat-unbound` record naming that leg.
- **Preservation, unique-alias bench, leg equally unbindable:** the key IS published and the
  re-vote still applies. Prove with named mutant **`REFUSEALL`** (weaken the predicate to `!seat`)
  — record its red set.
- Prove the new guard with named mutant **`JOINBLIND`** (delete the guard, restoring BASE) — record
  its red set.

⚠️ **How to make a leg unbindable, measured:** omit BOTH `waveId` and `taskId`. `bindSeats` then
skips the roster-slot match (no id to match) *and* the alias fallback (which requires
`leg.waveId === waveId`). The `leg()` helper omits both when its `waveId` argument is `undefined`.

⚠️ **But the leg must NOT pass through `fakeLaunchers`** — its `stampFanout`
(`run-debate.test.js:64`) re-stamps `taskId` and `waveId` on every leg, so anything routed through
it always binds and the test is **green at HEAD**. Supply the `-rv` legs from a bespoke
`launchWave` that returns them untouched. See Task 2's note.

---

### Task 2 — T5.2: the end-to-end pin that the basis stops being corrupted

**File:** `tests/council/run-debate.test.js`.

Driven through **`runDebate`** — never a hand-built `revoteByJudge` (Global Constraint 5). Twin
bench; finding `C1` **raised by `gpt`**, so **both** twins are legitimate judges and both disputed
provisionally; **both** re-vote `agree`, and **only `deepseek#1`'s `-rv` leg is unbindable**.

⚠️ **`fakeLaunchers` CANNOT produce this fixture.** Measured: its `stampFanout` helper
(`run-debate.test.js:64`) overwrites `taskId` and `waveId` on **every** leg — including the `k < 0`
arm, which still stamps `i + 1`. Any leg routed through `fakeLaunchers` therefore always binds by
roster slot, and a fixture built on it **is green at HEAD**. This test needs a bespoke `launchWave`
that returns its `-rv` legs **unstamped**. (This is the same property that makes SI-10 unreachable
from the production launcher: `fanout-leg.js` stamps `taskId` on every real leg.)

**The controller BUILT AND RAN this fixture at BASE before dispatch. Measured output at BASE:**

```
-rv roster launched   : ["deepseek","deepseek"]
adjudications OUT     : 3 (provisional was 2)
  rows: deepseek#1:dispute | deepseek#2:agree | deepseek:agree
  seat-less deepseek? : true
C1 tier / basis       : Confirmed {"a":2,"d":1,"n":0}
degrade notes         : 0 []
```

**Three votes on a two-judge finding, and the tier is `Confirmed`.**

**Assert, post-fix:** adjudications back to **2**; **no** seat-less `deepseek` row; rows exactly
`deepseek#1:dispute | deepseek#2:agree`; basis **`{a:1, d:1}`**, tier **`Contested`**; and exactly
one `seat-unbound` degrade note.

⚠️ **`Contested {a:1,d:1}` is the correct post-fix answer for THIS fixture — and an earlier draft of
this plan said `Disputed {a:0,d:2}`, which is wrong.** That draft number came from a smaller probe
in which the unbound twin was the *only* re-voter. Here `deepseek#2` binds and **its** re-vote must
still apply. That is the stronger property: the refusal is **surgical**, not a blanket revert. The
number was corrected by running the fixture, not by reasoning — do not "restore" the draft value.

---

### Task 3 — T5.3: SI-13 — the JSDoc edit

**File:** `src/council/debate.js`, inside **`debate.js :: applyDebate`'s own docblock** (headroom
44 — this said 43 under the misstated size rule; see §0.2). ⚠️ The phasing doc's `debate.js:44` is a **line**, and it is the `defenseByRaiser` param;
`aliasOf` is at **`:46`** (§0.7).

Document the `aliasOf` contract: when it is omitted, the fail-open push at `:93` writes the raw key
into the alias-space `judge` field, and a seat-valued key there reaches `peer-split.js :: peersOf`'s
`v.judge !== f.raiser` and `report.js`'s `byJudge[adj.judge]`, both alias-space joins.

**Doc only — no behaviour change, no thrown error.** The measured facts to state, and their bounds:
the sole non-test caller is `run-debate.js :: applyDebate` and it **does** pass `aliasOf`;
`package.json`'s `exports` map publishes only `./opencode-client`, closing the deep-require path.
⚠️ **Re-derive both of those at BASE before writing them down** — do not copy them from this plan.

---

### Task 4 — T5.4: the record

1. **The stale citation** of §0.7 — `BACKLOG.md:3784`'s `run-debate-revote.js:124` → re-anchor **by
   symbol**. ⚠️ Correct the *number*; the prose around it is TRUE — do not "correct" it too.
   ⚠️ A ledger row saying "re-verified" **must name WHAT was verified** (this file's own T-A8
   lesson).
2. **BACKLOG verdicts:** tick the SI-10 entry (`:3783`) and the SI-13 entry (`:3869`). ⚠️ **Never
   tick SI-18.** ⚠️ Do not tick SI-12 (`:3873` region) — ruling R19.
3. **Phasing-doc §1 status table:** rows **10** and **13** move OPEN → DONE. ⚠️ That table's
   preamble carries an **affirmative, enumerative** "changes since" list which the doc's own ⚠️
   says must be extended whenever a verdict moves. **Re-count by bucketing every Verdict cell
   directly off the table — never by arithmetic on the previous line.**
4. **`BACKLOG.md:3084`'s `NEXT TASK` entry** → replace with the Phase 6 resume point, carrying
   §0.8's ordering finding forward so the next controller need not re-derive it.
5. **CHANGELOG.**
6. ⚠️ **After any file grows, grep for citations INTO it.** Phase 4 shipped eight falsified
   citations past a green `check:citations` because `run-launch.js` grew 244→253.

---

## 4. Definition of done

- All seven gates exit 0, each read from its own `$?`; `npm test` run **last**, in the foreground,
  after the final commit.
- The test count has **grown** from 7810 and no suite regressed.
- Named mutants **`JOINBLIND`** and **`REFUSEALL`** each have a **non-empty** red set, recorded in a
  **committed** file. ⚠️ An empty or shrinking red set means the property is unpinned.
- `tests/council/debate.test.js:65` is **still green and untouched** — §0.4. ⚠️ **The parenthetical
  here read "(stateless fail-open)" and was FALSE; corrected 2026-08-21 (T5.4).** That test takes
  `applyDebate`'s **found-entry** branch, not its fail-open push — measured, 4 adjudications in and
  4 out. See §0.4's own correction block for the two tests that do reach the push.
- Probe 3's shape is pinned end-to-end through `runDebate`, and the fixture was executed by the
  controller before dispatch.
- No file in scope crosses 300 by the gate's ADJUSTED count (`scripts/check-file-sizes.js:54-57`
  — `content.split('\n').length` minus one when the file ends with a newline). ⚠️ This line said
  `content.split('\n').length` unqualified until the whole-branch fix wave; that is the pre-adjust
  value the gate never compares.
- `output/` and `docs/superpowers/plans/2026-08-15-*` are untouched.
