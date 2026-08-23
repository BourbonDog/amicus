# v4.8 Wave 3 — SI-27: consolidate the roster-padding core into `stage1-bind.js`

**Branch:** `v48-wave3-si27` · **BASE:** `8e1c8e24` · Item **SI-27**, ruling **R14**. Ships alone.
**Written:** 2026-08-23, just-in-time, measured at BASE.

**Spec authority** — the phasing doc's *Post-Phase-2 · SI-27* section, verbatim:

> Padding/bindSeats/placeholder-filter core → `stage1-bind.js`, parameterised on
> `(waveId, rosterSource, aliasAt, legs)`, returning both the filtered `seatOf` Map and the raw
> `bindRes`. **The orphan tail differs at all three sites (push / degrade.note / nothing) and stays
> at the call site.** Own PR — consolidation must not ride a defect PR.

---

## §0. Measured substrate

### §0.1 ⚠️ The anchor was a fossil — read this before trusting any older record

Status row 27's anchor column named `src/council/run-retry.js` as SI-27's first site. **It is not a
site at all** — that file holds no roster-padding block. SI-27 once covered `seatKey` duplication
there; PR5c/T-A1 moved that definition out to `run-retry-keys.js`, the item narrowed to
roster-padding, and the anchor column never followed.

Corrected in `9b059842` (row 27 + two BACKLOG paragraphs) and `8e1c8e24` (the four carriers
`9b059842` missed). **Consequence that survives the correction: nothing in the remainder of v4.8.0
relieves `run-retry.js`'s 300/300.** One dated snapshot still carries the false claim on purpose —
`docs/superpowers/plans/2026-08-22-v48-wave25-r16-index-prune.md:127-128`, a record of what was
believed when that plan ran. Do not "fix" it.

### §0.2 The three real sites, measured at BASE

| | file | size | `waveId` | `rosterSource` | seat at | `aliasAt(i)` | `legs` | **orphan tail** |
|---|---|---|---|---|---|---|---|---|
| 1 | `run-retry-launch.js :: bindRetryWave` | 67/300 | `unit.waveId` | `unit.seats` | `s` | `unit.models[i]` | `legs` | **returned** to caller |
| 2 | `run-stage2.js :: runStage2` | 213/300 | `${o.runId}-s2` | `reviews` | **`r.seat`** | `judges[i]` | `(wave && wave.legs) \|\| []` | **`degrade.note` ×2 loops** |
| 3 | `run-debate-revote.js :: runRevoteWave` | 274/300 | `${ctx.o.runId}-rv` | `judgeSeats \|\| []` | `s` | `aliasOf(judgeKeys[i])` | `rawLegs` | **nothing** |

The extractable core is **byte-identical at all three** once `waveId`/`alias` are parameterised —
the placeholder literal (`{id, alias, role:'seat', lens:null, position}`), the `bindSeats` call, and
the `.filter(b => !placeholders.has(b.seat))` Map build. Verified by reading all three, not inferred
from the filing.

**`run-retry.js` is NOT a site and MUST NOT be touched** (§0.6).

### §0.3 What the tail actually needs — the spec's two return members are NOT enough

The spec says return "the filtered `seatOf` Map and the raw `bindRes`". Measured against site 2,
that is one member short:

- `run-stage2.js:121` — `if (placeholders.has(seat)) { continue; }` inside the missing-seat loop.
  `bindSeats` returns `unbound: roster.filter(s => !takenBy.has(s.id))` (`seats.js :: bindSeats`),
  and `roster` **includes** the placeholders — so an unlanded placeholder IS in `bindRes.unbound`,
  and without this guard it would be announced as a missing seat. The guard is load-bearing and
  already pinned as named mutant **M3** (`run-debate.test.js:1403`).
- `run-stage2.js:125` — "…its roster of `${roster.length}`" reads the PADDED roster's length.

### §0.4 Existing pins that move, and the citation gate's actual reach

`scripts/check-citations.js` checks a `file.js:NNN` citation **only for in-range-ness**, not for
what that line says. It cannot catch semantic rot from an insertion — and it does not scan
`BACKLOG.md`/`docs/` at all. Its own docstring states the preference: *"Prefer the SYMBOL
ANCHOR … a corrected line number is true until the next edit and then silently false."*

Every live line citation into `stage1-bind.js` is at **29, 35, 40, 53, 55, 63** — all ≤ 63, 17
instances across `run-stage2.js`, `run-debate-revote.js`, `workspace/artifact-names.js`,
`run-stages.test.js` and the doc tree. See **R27-4**.

Named mutants whose stated LOCATION is inside the moving code:

| mutant | recorded at | says |
|---|---|---|
| `COLLIDEID` | `run-retry-launch.test.js:79` | "in run-retry-launch.js make the placeholder id `__unbound-${unit.waveId}`" |
| `RAWROSTER` | `run-retry-launch.test.js:98` | "pass `unit.seats` straight to bindSeats" |
| `NOPLACEHOLDERFILTER` | `run-retry-launch.test.js:115` | "delete the `.filter(…)` line in run-retry-launch.js" |
| `PREFIXID` | `run-retry-launch.test.js:136` | "swap the filter for `.startsWith('__unbound-')`" |
| `M1` | `run-debate.test.js:1401` | "drop the filter in run-debate-revote.js" |
| `M2` | `run-debate.test.js:1402` | "drop the same filter in run-stage2.js" |
| `M3` | `run-debate.test.js:1403` | "neuter `if (placeholders.has(seat)) { continue; }` in run-stage2.js" |
| Finding 3 | `run-stages.test.js:2102` | "mutating the check to `!b.seat.id.startsWith('__unbound-')`" |

⚠️ **After this PR, `M1`, `M2`, `NOPLACEHOLDERFILTER` and Finding 3 are THE SAME MUTATION** — one
edit in one function. That is the consolidation's headline property and §T-SI27.1 requires it
**measured**, not argued. `M3` alone stays a call-site mutation.

### §0.5 Prose in `src/` that this PR falsifies

- `run-retry-launch.js:8-10` — *"⚠️ Not `stage1-bind.js` … Consolidating the three padding sites is
  separately scheduled (BACKLOG.md's SI-27, ruling R14)."* **This file will now require
  `stage1-bind.js`.** The sentence becomes false the moment the import lands.
- `run-stage2.js:85` — *"§3.4's padding pattern (run-retry-launch.js :: bindRetryWave)"*
- `run-debate-revote.js:174` — *"§3.4's roster-padding pattern (run-retry-launch.js ::
  bindRetryWave)"* — both cite a precedent site that will no longer hold the pattern.
- `run-retry-launch.js:5` — *"the roster pad/bind block as a PURE function"* (still true of the
  wrapper; re-read it rather than assuming).

### §0.6 Sizes at BASE, and the projection

```
 86/300  src/council/stage1-bind.js        <- destination, +~40
 67/300  src/council/run-retry-launch.js   <- site 1, -~6 net
213/300  src/council/run-stage2.js         <- site 2, -~10
274/300  src/council/run-debate-revote.js  <- site 3, -~10  (gains real headroom)
300/300  src/council/run-retry.js          <- NOT A SITE. DO NOT TOUCH.
```

---

## §1. Rulings

**R27-1 — `bindRetryWave` STAYS, as a thin wrapper; `run-retry.js` is not touched at all.**
`run-retry.js:110` destructures `{ retrySeatOf, orphanLegs }` and five tests in
`run-retry-launch.test.js` call `launch.bindRetryWave(...)` directly. Keeping the wrapper preserves
every one of those pins with zero churn AND keeps the 300/300 file out of the diff entirely.
*Cost if wrong:* one extra 4-line function that does nothing but adapt argument shape — cheap, and
the alternative touches a file with zero headroom on a consolidation PR, which is the exact
inversion R14 forbids.

**R27-2 — return `{ seatOf, bindRes, placeholders }`.** The spec's two members plus the one site 2
provably requires (§0.3). Not a `realUnbound` convenience field: that would reinterpret site 2's
loop instead of moving it, and the loop is what the spec says stays at the call site.
*Cost if wrong:* the placeholder Set is exposed to callers that don't need it. Bounded — it is an
internal marker in an internal module, and two of three callers simply won't destructure it.

**R27-3 — the helper adds NO argument guards; each call site keeps the guard it has today.**
Site 3 keeps `judgeSeats || []`; sites 1 and 2 keep passing raw. `bindStage1Waves` in the same file
DOES guard, so a guard would be idiomatic — but idiom is not a reason to change behaviour in a
consolidation, and adding one silently makes sites 1 and 2 more tolerant than they are today.
*Cost if wrong:* `|| []` stays visible at one call site instead of being centralised.

**R27-4 — APPEND the new function after `missingSeatDeadWave`, never insert.** Every live line
citation into `stage1-bind.js` targets lines ≤ 63 (§0.4). Appending leaves lines 1-84 byte-identical
and **all 17 citations true**; inserting anywhere above would silently rot every one of them, and
the citation gate would not catch it. This is not style — it is the cheapest available defence
against the failure mode that produced ~30 non-findings on PR #171.

**R27-5 — site 2's `roster.length` becomes `reviews.length`, and gets a PIN.** `Array.prototype.map`
preserves length, so `roster.length === reviews.length` is a language guarantee, not a claim about
this code. But **no test asserts that note's `why` string today** — measured: the only greps for
*"returned fewer judge legs"* are the source line itself. A substitution into unpinned text is
exactly how a true sentence goes quietly false, so T-SI27.1 adds the pin.
*Cost if wrong:* one extra assertion on a string that was already correct.

**R27-6 — name it `bindPaddedWave`.** Contrasts with the file's existing `bindStage1Waves`
(real roster, no padding) in the one dimension that differs. The existing exports keep their names.

---

## Global constraints

1. **No file over 300 lines** (`content.split('\n').length`, minus 1 if it ends in a newline).
   **EXTRACT — never shave a comment.** ⚠️ `src/council/run-retry.js` is at **300/300** — this PR
   does not touch it (R27-1), and it gains nothing from this work.
2. **ZERO behaviour change.** This is a consolidation. Every existing test must pass **unmodified in
   its assertions**; only comments that state a mutant's LOCATION may change, and only to re-point
   them. If a test needs its assertion changed to stay green, STOP — that is a behaviour change and
   this PR is the wrong vehicle for it.
3. **Every behaviour claim measured, never argued** — admissible only with the command that
   produced it. ⚠️ A consolidation's preservation pins are **green at HEAD by construction**, so
   RED-before-GREEN does not apply to them. They need **named mutants** instead (§T-SI27.1).
4. **Commit before running any mutant.** ⚠️ **Never** `git checkout -- <path>`, `git restore`,
   `git stash`, or `git checkout-index` — the rule is by **effect**, not spelling. Hand-revert and
   byte-verify with `git diff` (⚠️ **not** `diff <(git show HEAD:file) file`, and ⚠️ **not** `cat -A`
   or `sed` to inspect line endings — measured 2026-08-23, MSYS `sed`/`cat` on this worktree
   silently strip `\r` and will tell you a CRLF file is LF. Read bytes with Python).
5. **Grep the distinctive PHRASE of every comment you correct, repo-wide.** Not the item name. A
   same-file sweep cannot find a twin in another file — that is how `9b059842` shipped four
   surviving carriers of the sentence it existed to correct (§0.1).

---

## Tasks

### T-SI27.1 — the extraction

**Add** to `src/council/stage1-bind.js`, appended after `missingSeatDeadWave` and before
`module.exports` (R27-4):

```js
function bindPaddedWave(waveId, rosterSource, aliasAt, legs) { … }
```

returning `{ seatOf, bindRes, placeholders }` (R27-2). Its body is the block that is byte-identical
at all three sites (§0.2). Export it.

Its docblock must carry, in this order: (a) how it differs from `bindStage1Waves` — padding,
placeholders, one wave not many; (b) **why the roster is padded rather than filtered** — `bindSeats`
filters falsy roster entries internally, so a `null` hole slides every later slot, and two
`{id:null}` sentinels collide on its id-keyed dedup; (c) **why placeholders are tracked by IDENTITY,
never an id-name prefix test** — a bench alias literally beginning `__unbound-` would otherwise drop
a REAL seat's binding, a name-collision channel inside the one mechanism whose contract is "never
guess"; (d) that `bindRes` and `placeholders` are returned because the **tail differs at every call
site and stays there**. These rationales exist verbatim at the three sites today — move them, do not
re-derive them, and do not leave a copy behind.

**Rewire the three call sites.** Each keeps its own tail, exactly as it is today:

- `run-retry-launch.js :: bindRetryWave` → `bindPaddedWave(unit.waveId, unit.seats, i => unit.models[i], legs)`;
  still returns `{ retrySeatOf: seatOf, orphanLegs: bindRes.orphanLegs }` (R27-1). Drop the now-unused
  `bindSeats` import.
- `run-stage2.js` → `bindPaddedWave(s2WaveId, reviews.map(r => r.seat), i => judges[i], s2Legs)`.
  Keep BOTH tail loops at the call site, including `if (placeholders.has(seat)) { continue; }`.
  `roster.length` → `reviews.length` (R27-5). Add `bindPaddedWave` to the existing `./stage1-bind`
  destructure; drop `bindSeats` from the `./seats` one (keep `artifactName`).
- `run-debate-revote.js` → `bindPaddedWave(waveId, judgeSeats || [], i => aliasOf(judgeKeys[i]), rawLegs)`.
  No tail. Drop `bindSeats` from the `./seats` import (keep `sanitizeName`); add a `./stage1-bind`
  require **with a one-line note that it requires only `./seats`, so the leaf stays cycle-free** —
  this file's header (`:19-23`) is explicit about which requires re-open the old cycle class.

**Fix the prose this PR falsifies** (§0.5). `run-retry-launch.js:8-10` must stop saying "Not
`stage1-bind.js`" and instead record that SI-27 landed; the two `§3.4 … (run-retry-launch.js ::
bindRetryWave)` precedent citations must point at `stage1-bind.js :: bindPaddedWave`. Prefer
**symbol anchors** over line numbers everywhere you touch a citation — the citation gate's own
docstring asks for it.

**Re-point every named mutant's stated location** (§0.4 table) — in `run-retry-launch.test.js`,
`run-debate.test.js` and `run-stages.test.js`. ⚠️ Their **assertions do not change** (constraint 2);
only the sentence saying where to apply the mutation.

**Measure and record, at FULL `npx jest --no-coverage` scope:**

1. **The consolidation property.** Apply `NOPLACEHOLDERFILTER` **once**, in
   `stage1-bind.js :: bindPaddedWave`, and record the red set. It must now include tests from
   `run-retry-launch.test.js` **and** `run-stages.test.js` **and** `run-debate.test.js` — before this
   PR the same mutation in `run-retry-launch.js` could only red the first. Record the actual suite
   and test names. ⚠️ If the red set does **not** span all three, that is a FINDING: it means a call
   site did not actually adopt the shared function. Report it; do not adjust the claim to fit.
2. `PREFIXID` in `bindPaddedWave` — red set (subsumes Finding 3).
3. `COLLIDEID` in `bindPaddedWave` — red set.
4. `RAWROSTER` in `bindPaddedWave` (skip the pad, pass `rosterSource` straight through) — red set.
5. `M3` / new name **`PLACEHOLDERLEAK`** — delete `if (placeholders.has(seat)) { continue; }` in
   `run-stage2.js`. Still a call-site mutation. Red set.

**New pin required (R27-5):** assert the stage-2 missing-seat note's `why` string on a bench with a
roster hole, so `reviews.length` is covered. Name its mutant (`ROSTERLEN`: use
`bindRes.unbound.length`) and record its red set.

⚠️ **An empty red set is a finding, not a result.**

### T-SI27.2 — the record

`BACKLOG.md`, the phasing doc (status row 27 → DONE, and the Wave 3 bullet), `CHANGELOG.md`.

State the property this bought in the terms §T-SI27.1 measured it in — *"one mutation now reds three
suites"* — with the suite names, not as an argument from structure. Record R27-2 (why the spec's
two-member return was one short) and R27-4 (append-not-insert, and that the citation gate would not
have caught the alternative) so neither has to be re-derived.

⚠️ Update the resume point to **Wave 3 remainder: SI-25 sites (1)+(2) not yet scheduled; SI-22.4
LAST**, then the release run (version pin ×6 → CHANGELOG → tag → publish.yml). ⚠️ **Carry forward
that `run-retry.js` stays at 300/300 with no scheduled extraction** — and do not let the correction
in §0.1 rot back: it survives this PR unchanged.

Re-derive every citation against the FINAL tree, re-opening each at its stated line. ⚠️
`output/` and dated plan snapshots are out of scope — dated records, never "gitignored".
