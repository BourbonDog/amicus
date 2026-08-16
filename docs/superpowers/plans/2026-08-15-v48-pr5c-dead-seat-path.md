# v4.8 PR5c — the dead seat path (M3/M4 + the dead-row key)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Merge base:** `cd02e451` (main, after [#163]). **Branch:** `v48-pr5c-dead-seat-path`.
**Suite baseline `[MEASURED]`:** `527 suites / 7425 passed / 8 skipped / 7433 total / 0 failed`,
`npm test` exit 0 (208 s). Size gate exit 0. `npm run lint` exit 0. See §0.9.

**Revision 2.** One refutation round: an **adjudicated 4-model council** (glm, qwen, gpt, kimi;
chair deepseek), run `pr5c-plan-r1`, $2.74, 0 degrades. **22 findings, all Confirmed. Chair verdict:
`Fix these first`.** Artifacts in `output/pr5c-plan-council/`.

> **The chair's summary, which is the honest one:** *"The plan is a good fix with a bad jacket. The
> mechanics verify… But the three things the author advertised as its distinguishing rigor —
> honest residual disclosure, exhaustive per-case design, and named-mutant certification — each
> have a hole in exactly the spot the brief told reviewers to attack."*

⚠️ **22/22 Confirmed with zero disputes is the documented agreement-inflation signature of this
judging contract, NOT independent corroboration.** What makes these actionable is that the five
most severe were **verified against source by the orchestrator** after the round (evidence recorded
inline below), and one — the critic path — was found by an orchestrator probe *before* the seats
saw it and then independently raised by two of them.

Corrections are recorded **in place** (⛔ **REV-1 WAS WRONG**), per house convention.

| # | sev | what rev 1 got wrong |
|---|---|---|
| D1 | **BLOCKER** | Seat-keying `seen` **splits the keyspace against `seatLoss.deadBenchSeats`** → 3 rows for 2 dead seats. §0.7.1 |
| D2/B1 | MAJOR | Named mutant **M2c cannot kill** — a verification-site error in the flagship discipline. Task 3 Step 5 |
| D2b/B5 | MAJOR | The seat-id arm's **source field does not exist on the live path**; the fix is terminal-path only. §0.7.2 |
| A1/C2 | MAJOR | The residual was **falsely scoped to "legacy"** — refuted by rev 1's own §0.1. §0.7.3 |
| C1/D5 | MAJOR | The **critic path (`byRole`) is left alias-keyed**; §0.7's case table was presented as exhaustive and was not. §0.7.4 |
| D3/B2/A4 | MAJOR | The **`retriedSeats` mirror obligation**, which the repo comment delegates to *this* PR, was dropped. Task 4 |
| B3/D4 | MAJOR | The **M3-shaped residual** (legacy both-twins-dead) is neither named nor pinned. §0.7.3 |
| D7 | MINOR | The **`seats[]` element shape** was never specified (objects vs id strings). Task 1 |
| A2/B6 | MINOR | §0.7's key expression **omitted the dead-wave arm**; a `seats[]`-only loop drops legacy rows. §0.7 |
| B4 | MINOR | §0.2 **misattributed** where `w.seats ∥ w.models` is maintained. §0.2 |
| B8 | NIT | Mutant M1b named a variable **not in scope** at that call site. Task 1 |
| A3/D8 | MINOR | **In-repo comments are still rotted** in the files being edited, and Task 3 re-rots them. §0.10 |
| B7/D6 | NIT | Task 3's `git checkout <commit>^` was the **wrong ref** — accepted *modified*: the step is removed, not repaired. Task 5 |

**Survived refutation, re-measured and confirmed by the bench:** every §0.0 citation correction; the
§0.1 dual-space producer; the §0.2 five-arm reachability table; the §0.5 M3/M4 reproductions and
controls A/B/C; the §0.6 `seatKey` invariant; the §0.4 DOM-key defect; and the §0.9 lint-gate
correction.

---

## 0. What the BACKLOG entry gets wrong

### 0.0 Every line citation in it has rotted `[MEASURED]`

PR5b (#162) added 27 lines to `live-seats.js` and 70 to `workspace-seats.js` after the entry was
written (`git diff --stat ccb0551d..44880f40`).

| the entry says | actually at `cd02e451` |
|---|---|
| `deadSeats`' `add()` at `live-seats.js:177-185` | **`:192-200`** |
| its suppression at `:234-243` | **`:249-254`** (build) + **`:255-258`** (filter) |
| consumer channel filter `live-seats.js:188` | **`:203`** |
| consumer channel filter `workspace-seats.js:61` | **`:69`** |
| `retriedSeats` at `:57`, lookup at `:117` | **`:65`** and **`:172-173`** |

### 0.1 `firstFailure.seatId` is NOT always a seat id `[READ]`

```js
// src/council/run-retry-group.js:47
const key = seatObj ? seatObj.id : seat;   // seat id when identified, ALIAS otherwise
unit.firstFailures.push({ ...ff, seatId: key });
```

`seatId` holds an **alias** whenever the seat could not be identified. This is load-bearing twice
over: it is why seat-id-only keying fails, **and** it is why the residual cannot be scoped to
legacy runs (§0.7.3).

### 0.2 The dead-wave arm's seat ids ARE reachable `[READ]`

⛔ **REV-1 MISATTRIBUTED THE MAINTENANCE SITE (B4).** Rev 1 said the `w.seats ∥ w.models` invariant
"is maintained at `run-retry-group.js:50`". `:50` maintains the **unit** arrays
(`unit.models`/`unit.seats`), not the **wave** arrays. The wave-level parallelism is asserted by the
docblock at `:64` and consumed at `run-retry.js:179-182` — so the `[READ]` tag was leaning on a
comment, which is precisely the habit this series is trying to break. The *consumption* site is the
real evidence:

```js
// run-retry.js:179-182 — already iterates both together
(w.models || []).forEach((m, i) => {
  const k = seatKey((w.seats || [])[i] || null, m);
  notedSeats.add(k); out.attemptedSeats.add(k);
});
```

The seat key is reachable at **all five arms**, already computed at four:

| arm | call site | key in scope? |
|---|---|---|
| `waveStillDeadNote` | `run-retry.js:177` | ✅ `seatKey((w.seats||[])[i], m)` at `:180` |
| `srcLegStillDeadNote` | `:188` | ✅ `srcLegKey(l)` → `key` at `:185` |
| `retryLegStillDeadNote` | `:227` | ✅ `key` at `:201`, `bound` at `:200` |
| `missingLegStillDeadNote` | `:259` | ✅ `key` is the `launched` loop key at `:256` |
| `waveStillDeadNote` partial arm | `:177` | ✅ same as dead-wave |

### 0.3 The fixture blast radius is ONE test `[MEASURED]`

Spiked the producer change and ran `tests/council/ tests/workspace/ tests/observe/
tests/mcp-verdict-chair-carry.test.js`:

```
Test Suites: 1 failed, 109 passed, 110 total
Tests:       1 failed, 1822 passed, 1823 total
```

One failure: `tests/council/degrade-channels.test.js:273` (the dead-wave `toEqual`). Adding `seatId`
to `srcLegStillDeadNote` broke **zero** tests. Spike reverted; `git diff` empty, verified.

⚠️ The spike did not wire the srcLeg call site, so it measured the blast radius of *adding a key*,
not of adding the correct value. The real change should break the same one fixture — an inference,
not a measurement.

### 0.4 A third defect the entry does not name `[READ]`

```js
// electron/workspace-ui/workspace-seats.js:219
{ className: 'seat-dead', dataset: { key: 'dead:' + seat.model } }
```

Alias space. Once M3 is fixed and two dead twins render, both rows carry `dead:deepseek`.

⛔ **REV-1 AND REV-2 BOTH CLAIMED THIS RE-CREATES THE FROZEN-ROW CLASS. MEASURED: IT DOES NOT.**
The claim was reasoned from the live path and never run. Two probes at implementation time:

| pin | result |
|---|---|
| two dead twins, painted twice — do rows accumulate? | **no, 2 rows** — passes at HEAD |
| two dead twins — distinct `dataset.key`? | **no, 1 key for 2 rows** — the only real failure |

`renderSeats` removes leavers **per ROW** (`workspace-render.js:231` tests each child's own key),
so colliding rows are both removed rather than one leaking; and dead rows are always appended
fresh, so the reuse path at `:197` — where last-wins froze a live row in PR5b — is never reached.

**The collision is a latent hazard, not a live defect**, and the plan must not claim otherwise.
It is still fixed: `:188` builds a last-wins `existing` map that any future reuse would hit, and
two rows for different seats sharing one key is a landmine. But **Task 3 is a cheap hardening, not
the required companion this plan called it** — the "one shippable unit" framing was wrong.

## 0.5 The defects, re-measured at `cd02e451` `[MEASURED]`

Probe: `scratchpad/probe-m3m4.js`, calling `deadSeats` directly.

| # | scenario | rows | wanted |
|---|---|---|---|
| **M3** | two `dead-leg` notes, one alias, seatIds `#1`/`#2` | **1** | 2 |
| **M4** | one twin alive, its twin dead | **0** | 1 |

| control | scenario | rows at HEAD |
|---|---|---|
| **A** | unique bench, seat alive, stale degrade | **0** ✅ |
| **B** | unique bench, seat dead | **1** ✅ |
| **C** | **both** twins alive, alias-only degrade | **0** ✅ |

## 0.6 The key rule `[MEASURED]`

`seatKey(seatObj, alias) = seatObj ? seatObj.id : alias`, spelled three times in `src/`
(`run-debate-revote.js:64`, `run-retry.js:149`, `run.js:228`) and once as `r.seat || r.model` in the
renderer. They agree because `seats.js:67` mints `alias#N` only when `counts.get(alias) > 1` (so a
unique seat's id **equals** its alias, stated as an invariant at `seats.js:5`) and
`run-assemble.js:89` emits `seat` only when `id !== alias`.

⚠️ Three spellings is failure mode #7 waiting to happen. **This PR does not unify them** — that is a
refactor with its own blast radius. File it.

---

## 0.7 The design — corrected

### 0.7.1 ⛔ REV-1'S KEYING SPLIT THE KEYSPACE (D1, BLOCKER) `[MEASURED]`

Rev 1 seat-keyed `seen` and stopped there. **`seen` is the designed dedup for the overlap between
two sources**, and the second source cannot be seat-keyed:

```js
// src/council/verdict.js:86 — deadBenchSeats is built from the SAME dead legs that emit degrades[]
deadBenchSeats: [...base.deadBenchSeats,
  ...legs.filter(l => l.data.seat !== critic).map(l => l.data.seat)],
```

`l.data.seat` is an **alias** (`run-retry-notes.js` keeps it so deliberately). So on a modern twin
bench with both twins dead, rev 1 produces candidates `{deepseek#1, deepseek#2, deepseek}` →
**3 rows for 2 dead seats**. HEAD renders 1; correct is 2.

⚠️ kimi rated this "blocker **if** reachable" and named the unprobed precondition. **I probed it:
`verdict.js:86` is not legacy — it runs on every modern run with a dead bench leg. It is reachable.**

⛔ **REV-2'S ABSORB RULE WAS BROKEN IN THREE MEASURED WAYS (round 2: B1 blocker, A2/C1 major,
D4 minor).** Rev 2 wrote a *source-blind* rule — `covered[alias]` set by any seat-keyed candidate,
absorbing any later alias-only candidate. Measured against the real patched `deadSeats`:

| attack | scenario | result | wanted |
|---|---|---|---|
| **B1/A2** | dead-wave `seats: ['d#1', null→'d']` — two genuinely distinct dead seats | **1 row** | 2 |
| **C1** | an alias-only record ordered BEFORE the seat-keyed ones | **3 rows** | 2 |
| **D4** | the absorber is itself later suppressed | **0 rows** | 1 |

⚠️ Rev 2 tagged this rule `[MEASURED]` on a 15-case pass. **The 15 cases were the ones the rule was
designed for** — a case-selection artifact, not a measurement of the rule. This is failure mode #8
wearing a `[MEASURED]` badge, and it is the sharpest lesson of round 2.

**Root cause is THE WRONG LEVER (#7), and it is in the PRODUCER.** The chair's question exposes it:
*"where is the per-alias seat count available to the consumer?"* — **nowhere.**
`deadSeats(degrades, seatLoss, liveSeats, runMeta)` cannot know how many seats an alias holds (dead
seats are by definition absent from `liveSeats`). So no consumer rule can distinguish "one dead
twin, identified" from "two dead twins, one identified". Rev 2's own Task 1 destroyed that
information with `so ? so.id : m`, collapsing an unidentified slot onto the alias.

**Corrected design, two parts:**

**(a) Producer preserves the distinction.** The dead-wave arm emits `null` for an unidentified slot,
never the alias — the array stays index-parallel with `models`, so *each index is one dead seat*
and `null` means "this seat exists, unidentified", which is not the same statement as the alias:

```js
seats: (w.models || []).map((m, i) => {
  const so = (w.seats || [])[i];
  return so ? so.id : null;        // NEVER `: m` — that is what created B1
}),
```

**(b) Absorption becomes SOURCE-AWARE.** `seatLoss.deadBenchSeats` is not an independent source:
`verdict.js:86` builds it *from the same dead legs* that emit `degrades[]`, so on a modern run it is
**always** derivative. Absorb only that source, never a degrade record:

- degrade records: dedup on the seat key only. **No absorption.** (kills C1 — order within the
  degrades loop stops mattering; kills B1 — a genuine unidentified twin is never absorbed)
- `deadBenchSeats` / `criticRequested`: skip when the alias is already covered by *any* candidate.
  Safe even when the absorber is later suppressed, because a derivative entry is exactly as stale as
  the record it derives from (kills D4, whose scenario required absorbing an *independent* record).

⚠️ This design is **`[UNVERIFIED]` as written** — Task 2 Step 2 must measure it against all three
attacks above plus the original fifteen. Do not carry rev 2's `[MEASURED]` tag forward.

**`[MEASURED]` against every case** (simulation of the rule above, all 7 pass):

| case | rows | note |
|---|---|---|
| M3, two seat-keyed twins | **2** | ✅ the fix |
| **D1, two seat-keyed + a `deadBenchSeats` alias** | **2** | ✅ absorbed |
| **D4d fixture** (alias-only dead-leg + dup `deadBenchSeats`) | **1** | ✅ existing pin preserved |
| unique bench (`id === alias`) | 1 | ✅ byte-identical |
| unique bench + `deadBenchSeats` same seat | 1 | ✅ |
| legacy twin, both dead, alias-only | 1 | ⚠️ residual — see §0.7.3 |
| one seat-keyed twin + a different alias | 2 | ✅ |

### 0.7.2 ⛔ THE FIX IS TERMINAL-PATH ONLY (D2b/B5, MAJOR) `[MEASURED]`

Rev 1's pseudocode wrote `reviewing[seatId] = true` without naming the source field. There are
**two** `liveSeats` callers and only one has a seat id:

| caller | liveSeats source | seat id? |
|---|---|---|
| `renderSeatsPanel` (terminal) | `seatsFromRunStats(derived.cost.rows)` | ✅ `s.seat` (`live-seats.js:98`) |
| `appendDeadRows` (live tick) | `live.seats` (`workspace-seats.js:248`) | ❌ **none** |

`seatOf` (`src/workspace/live-normalize.js:38-63`) emits
`{id: leg.taskId, model, modelInput, role, status, stage, …}`. **`id` is a per-LEG taskId, not a
seat identity** — PR5b's §0.5 established exactly this distinction — and there is no `seat` field.

Two consequences the plan must state, not discover:

1. **M3/M4 remain unfixed during a live run.** The fix is terminal-path only. This is a
   **disclosed residual**, not a defect in the fix: the live payload carries no seat identity, so no
   consumer can key on one. Closing it needs a producer change to the live leg rows.
2. **The insert MUST be falsy-guarded.** `reviewing[undefined] = true` coerces to the string key
   `'undefined'`, which would then suppress any candidate whose key stringifies the same way. This
   is the null-coercion trap PR5b's council round 2 already fixed once at `workspace-seats.js:159`.
   Write `if (s.seat) { reviewing[s.seat] = true; }` — never a bare insert.

### 0.7.3 ⛔ THE RESIDUAL WAS FALSELY SCOPED (A1/C2 + B3/D4, MAJOR)

Rev 1 said the producer change "removes it for every run written after this ships; runs already on
disk keep it forever." **That is refuted by rev 1's own §0.1**: `seatId` falls back to the alias for
any *unidentified* seat, on new runs too. There is no structural marker separating such a record
from a pre-fix one.

**All FIVE residual shapes, named. Task 6 pins each.**

| # | shape | behaviour after this PR |
|---|---|---|
| R1 | legacy alias-only record, **one twin alive** | dead twin suppressed (M4 persists) |
| R2 | legacy alias-only records, **both twins dead** | collapse to 1 row (M3 persists) |
| R3 | **new run, unidentified seat** → alias-valued `seatId` | behaves as R1/R2 — *not legacy-bounded* |
| R4 | **critic path** (§0.7.4) | M4 persists regardless of run age |
| R5 | **live tick** (§0.7.2) | M3+M4 persist during the run; correct after terminal refresh |

**CHANGELOG must state all five**, not just R1. Rev 1's sentence named only R1.

### 0.7.4 ⛔ THE CRITIC PATH IS NOT COVERED (C1/D5, MAJOR) `[MEASURED]`

Found by orchestrator probe (`scratchpad/probe-critic-twin.js`) before the council, then raised
independently by gpt and kimi. Full writeup:
`output/pr5c-plan-council/orchestrator-finding-critic-path.md`.

`deadSeats` infers role from **alias equality**, then suppresses critics through a *different* map:

```js
// :209  role comes from the ALIAS, not the seat
add(data.seat, retried, critic && data.seat === critic ? 'critic' : null);
// :253, :256
byRole[alias + '|' + s.role] = true;
if (s.role === 'critic') { return !byRole[s.model + '|critic']; }
```

| probe | scenario | rows |
|---|---|---|
| 1 | critic twin dead, bench twin alive | 1 ✅ |
| **2** | **bench twin dead, critic twin alive** | **0** ⛔ silent erasure |
| 3 | both twins dead | 1, and **both labelled `critic`** |
| 4, 5 | controls, distinct aliases | 1, 0 ✅ |

A candidate tagged `'critic'` **returns at the `byRole` branch and never consults `reviewing`**, so
§0.7.1's fix does not reach it. Probe 3 shows the M3 fix makes it *worse*: two rows both labelled
`critic` on a bench with one critic seat.

**Decision, stated rather than deferred by silence:** `byRole` stays alias-keyed in this PR.
Seat-keying it is **insufficient** — the `'critic'` tag is attached to the wrong candidate at `:209`
before any lookup, so closing R4 requires role to derive from seat identity, which is producer-side
vocabulary. **R4 is disclosed in §0.7.3, pinned in Task 6, and filed to BACKLOG.**

⚠️ Negative result, honestly recorded: probes 6–7 tested the `alias + '|' + role` concatenation for
an injectivity collision. **Neither fires** on the reachable paths. Latent hazard, not a live
defect — **do not report it as one.**

## 0.8 Why the producer change is in scope

Per-item benefit test: without it, every arm but one stays alias-only and M4 closes for one of five
emitters — which the owner ruling already rejected as "appearing to close the class." Measured at
**one fixture line** (§0.3).

## 0.9 Baseline `[MEASURED]` at `cd02e451`, 2026-08-15

`527 suites / 7425 passed / 8 skipped / 7433 total / 0 failed`, `npm test` exit 0 (208 s). Suite
count from `npx jest --listTests | wc -l`. Size gate exit 0.

⛔ **The PR5b plan told you to run `npx eslint .`. WRONG GATE — it exits 1 with 263 errors** across
`tests/` (48 files), `scripts/`, `evals/`, `bin/`. CI runs `npm run lint`
(`.github/workflows/ci.yml:67`) = `eslint src/ electron/ tests/helpers/`, which exits **0**.

⚠️ Two consequences: do not "fix" the 263 (out of scope, always were); and **`tests/` is not linted**
except `tests/helpers/`, so lint will not cover the new test files here.

⚠️ `npx eslint . | tail -3` reports `EXIT=0` because `$?` captures `tail`. **Never read an exit code
through a pipe.**

## 0.10 In-repo comment rot (A3/D8) `[READ]`

§0.0 corrected the BACKLOG's citations but left rotted ones **inside the files this PR edits**.
Each task below owns the comments in its own file:

| site | says | actual at `cd02e451` |
|---|---|---|
| `run-retry-notes.js:43-44` | `live-seats.js:188`, `workspace-seats.js:61` | `:203`, `:69` |
| `workspace-seats.js:51` | `live-seats.js:186-200` holds the kind/channel filter | it is at `:203` |
| `workspace-seats.js:91` | "Mirrors `isReviewing` at `live-seats.js:220-223`" | `isReviewing` is at **`:235-238`** — already stale at HEAD |
| `workspace-seats.js:155-156` | "reach `deadSeats` at `:217`" | `:217` is `cells[6] = ''` |

⚠️ **Task 2 will re-rot every range that points into `deadSeats`' internals**, because `add()` grows.
Task 2 Step 6 owns re-checking them.

---

## File Structure

| file | change | task |
|---|---|---|
| `src/council/run-retry-notes.js` | dead-wave `seats[]`; `srcLegStillDeadNote` `seatId`; fix `:43-44` | 1 |
| `src/council/run-retry.js` | pass `key` into `srcLegStillDeadNote` (`:188`) | 1 |
| `tests/council/degrade-channels.test.js` | the one `toEqual` at `:273` | 1 |
| `electron/workspace-ui/live-seats.js` | `deadSeats`: absorb-rule `seen`, guarded dual-space `reviewing`, carry `seat` on the row | 2 |
| `electron/workspace-ui/workspace-seats.js` | `renderDeadSeatRows:219` DOM key | 3 |
| `electron/workspace-ui/workspace-seats.js` | `retriedSeats`: read `data.seatId` + `data.seats[]`; fix `:49-54`, `:83-84`, `:91`, `:155-156` | 4 |
| `tests/workspace/dead-seat-rows.test.js` | existing suite — six at-risk tests | 2,3 |
| `tests/workspace/dead-seat-twins.test.js` | **new** — M3/M4, controls, D1, the five residuals | 2,3,6 |
| `tests/workspace/workspace-seats.test.js` | dead-wave twin-bench badge test | 5 |
| `CHANGELOG.md` | all five residuals (§0.7.3) | 5 |

### The existing pin surface `[MEASURED]`

`tests/workspace/dead-seat-rows.test.js` is **673 lines / 28 tests**. Six are at direct risk:

| test | what it pins | risk |
|---|---|---|
| `(D4d)` `:347` | deadBenchSeats dups + a dead-leg **collapse to ONE row** | **This is D1's fixture.** §0.7.1's absorb rule keeps it green — `[MEASURED]`. |
| `(c1)` `:307` | null-role bench dead-leg **IS** suppressed by a live `seat` row | Control C. The alias arm keeps it green. |
| `(a2)` `:119` | a `dead-wave` naming two models renders **two** rows | Task 1 changes the dead-wave shape. |
| `(b2)` `:171` | dead seat with its own ERROR row → **one** row | Suppression path. |
| `:559` | dead-leg naming the ALIAS of a seat keyed by its **resolved id** → 0 rows | `reviewing` is built from `s.modelInput \|\| s.model` (`:251`); the new arm must not drop it. |
| `:418`, `:514` | repaint twice → no duplicate dead rows | Task 3's DOM key. |

⚠️ If `(D4d)` or `(c1)` needs its **expected value** changed, stop and get a ruling — that is a
behaviour change, not a fixture update.

---

## Task 1: Emit the seat key on every dead arm (producer)

- [ ] **Step 1** — Probe that `key`/`srcLegKey` are in scope at `run-retry.js:188` and `w.seats` is
      parallel at `:177`, by printing them on a twin bench. Do not re-read the docblock (B4).
- [ ] **Step 2** — Failing test: a twin bench where a dead wave and a src leg both die, asserting
      `data.seats` / `data.seatId` carry `deepseek#1`/`deepseek#2`. Run it, watch it FAIL.
- [ ] **Step 3** — Implement.
      **`seats[]` element shape is id STRINGS or `null`, never seat objects (D7), and never the
      alias (round-2 B1):**
      ```js
      seats: (w.models || []).map((m, i) => {
        const so = (w.seats || [])[i];
        return so ? so.id : null;       // null = "this seat exists, unidentified"
      }),
      ```
      ⛔ **REV-2 WROTE `: m` HERE AND IT CAUSED THE ROUND-2 BLOCKER.** Collapsing an unidentified
      slot onto the alias makes it indistinguishable from a second reference to that alias, and no
      consumer can recover the difference (§0.7.1).
      Embedding raw seat objects would leak `role`/`lens`/`position` into `run.json` and bloat the
      `:273` fixture. Add `seatId` to `srcLegStillDeadNote` (new param) and pass `key` at `:188`.
      **Dead-wave arm only — not the partial arm**, which emits on `seat-unbound` and is read by no
      consumer (§0.0).
      Fix the rotted citation at `:43-44` while here (§0.10).
- [ ] **Step 4** — Update `degrade-channels.test.js:273`. **Exactly one fixture** `[MEASURED]`. A
      second failure is a finding — record it, do not silently edit it.
- [ ] **Step 5** — Named mutants. **M1a:** drop `seats` from the dead-wave arm → Step-2 test RED
      *by name*. **M1b:** at `run-retry.js:188` pass **`l.modelInput || l.model`** (the alias) instead
      of `key` → the srcLeg assertion RED.
      ⛔ **REV-1 WROTE "pass `seat` instead of `key`" — `seat` is not in scope at that call site
      (B8).** It is a local inside `srcLegStillDeadNote`. Restore byte-identically; `git diff` empty.
- [ ] **Step 6** — Commit.

## Task 2: Fix `deadSeats` (M3 + M4 + D1)

- [ ] **Step 1** — Work through the six at-risk tests above, in order. `(D4d)` and `(c1)` encode the
      old keying as correct — if either needs its expected value changed, **stop and get a ruling**.
- [ ] **Step 2** — Failing pins: M3 → 2, M4 → 1, controls A/B/C, **and D1 → 2** (two seat-keyed
      twins plus a `deadBenchSeats` alias for the same alias). Run: M3/M4/D1 FAIL, A/B/C PASS.
- [ ] **Step 3** — Implement in `deadSeats`:
      - `add()` takes `(key, alias, model, retried, role)`; apply the **absorb rule** of §0.7.1
        verbatim — `seen[key]`, then `key === alias && covered[alias]`, then set both.
      - candidate key: `(d.data.firstFailure && d.data.firstFailure.seatId) || d.data.seatId ||
        d.data.seat`; **dead-wave iterates `data.seats[]` when present, falling back to
        `data.models[]` index-wise** — a `seats[]`-only loop silently drops every legacy dead-wave
        row, which is worse than HEAD (B6/A2).
      - `reviewing`: insert the alias **always**, the seat id **only when truthy** (§0.7.2 — the
        `'undefined'` coercion trap).
      - ⛔ **THE FILTER, STATED BYTE-FOR-BYTE. REV-2 LEFT THIS TO INFERENCE AND IT IS THE WHOLE FIX
        (round-2 A1 blocker + D1 major; chair hard-question 1).** Populating `reviewing` changes
        nothing on its own — `:257` still reads `reviewing[s.model]`, which the *alias* arm sets, so
        the dead twin stays suppressed and **M4 is unfixed**. Change `:255-258` to:
        ```js
        return order.filter(function (s) {
          if (s.role === 'critic') { return !byRole[s.model + '|critic']; }
          return !reviewing[s.seat || s.model];     // <- seat first, alias fallback
        });
        ```
        ⚠️ `s.model` stays the **alias** on the emitted row (display and blind-mode `labelOf` both
        key on it). Do **not** "simplify" by assigning the seat id to `model` — that passes every
        pin in this task while shipping a display and blind-mode regression, which is precisely the
        realization the chair warned the pin net would not catch.
      - carry `seat` on the emitted row for Task 3.
      ⚠️ Do **not** touch `byRole` (§0.7.4 — decided, disclosed, filed).
      ⚠️ 30-line budget on `live-seats.js` (§Global Constraints).
- [ ] **Step 4** — Run; M3/M4/D1/A/B/C all PASS.
- [ ] **Step 5** — Named mutants:
      - **M2a:** revert the candidate key to `data.seat` → **M3** RED.
      - **M2b:** drop the alias arm from `reviewing` → **Control C** RED.
      - **M2c (RE-AIMED):** ⛔ **REV-1'S M2C WAS A DEAD MUTANT (D2/B1).** "Drop the seat-id arm →
        M4 RED" cannot kill: M4 has exactly one candidate and the seat-id arm only *adds*
        suppressions, so removing it leaves 1 row either way. The arm's real function is
        *suppressing a seat-keyed record that names a LIVE seat*, which no rev-1 case covered.
        **Add that control first** — a degrade whose `firstFailure.seatId` is `deepseek#1` with
        `deepseek#1` alive must render **0** rows — then drop the seat-id arm and confirm **that**
        control goes RED.
      - **M2d:** remove the absorb clause → **D1** RED (3 rows).
- [ ] **Step 6** — Re-check the comment ranges in §0.10 that point into `deadSeats`; `add()` has
      grown and they will have moved again.
- [ ] **Step 7** — Commit.

## Task 3: Seat-key the dead row's DOM key — ⚠️ MUST SHIP WITH TASK 2

- [ ] **Step 1** — Multi-tick DOM pin (**two ticks minimum**): two dead twins produce two rows that
      both survive a repaint.
- [ ] **Step 2** — Confirm it fails before the fix. ⛔ **REV-1 PRESCRIBED
      `git checkout <task2-commit>^ -- <file>`, WHICH IS THE WRONG REF (B7/D6)** — that is the
      parent of Task 2, i.e. pre-Task-2 content; it only appears to work because Task 2 does not
      touch this file. **Accepted as modified: the step is removed, not repaired.** At this point
      Task 3 is unimplemented and uncommitted, so simply run the pin and watch it fail. No git
      surgery is needed or wanted.
- [ ] **Step 3** — Implement: key on the seat. Use the JSON-array spelling PR5b established —
      concatenation is not injective over aliases containing `:`.
- [ ] **Step 4** — Named mutant: revert to `'dead:' + seat.model` → Step-1 pin RED.
- [ ] **Step 5** — Commit.

## Task 4: Restore the `retriedSeats` mirror (D3/B2/A4) — NEW

⛔ **REV-1 DROPPED AN OBLIGATION THE REPO EXPLICITLY DELEGATES TO THIS PR.**
`workspace-seats.js:49-54` says verbatim: *"deadSeats still dedups on the alias (`seen[model]`),
which is the deferred M3/M4 work in BACKLOG.md — when that PR lands, re-read this note and restore
the full mirror rather than letting the two drift silently."* **This is that PR.** Rev 1
demonstrably read this region (§0.0 corrects citations inside it) and still did not act.

- [ ] **Step 1** — Failing test: a twin bench with a **srcLeg** dead record carrying Task 1's new
      `data.seatId`. At HEAD-plus-Tasks-1-3 the badge lands on the wrong seat — `retriedSeats`'
      dead-leg branch reads `(data.firstFailure && data.firstFailure.seatId) || data.seat` and
      **ignores `data.seatId`**, so it keys by alias and badges the live twin while the actually-
      retried dead seat shows nothing. Measure and record the number before fixing.
- [ ] **Step 2** — Implement: read `data.seatId` in the dead-leg branch; iterate `data.seats[]` in
      the dead-wave branch with the same `models[]` fallback as Task 2.
- [ ] **Step 3** — Fix the comments Task 1 falsified: `:83-84` ("dead-wave carries `models[]` —
      ALIASES, with no seat and no `firstFailure` anywhere") is **false the moment Task 1 ships**.
      Also `:49-54` (the mirror is now restored — say so), `:91` (`isReviewing` is at `:235-238`,
      already stale at HEAD), `:155-156` (§0.10).
- [ ] **Step 4** — Named mutant: revert the `data.seatId` read → Step-1 test RED.
- [ ] **Step 5** — Commit.

## Task 5: The deferred dead-wave twin-bench badge test + CHANGELOG

- [ ] Reuse `paint(costRows, degrades, blindOn, labelOf, critic)` —
      `tests/workspace/workspace-seats.test.js:84` `[MEASURED]`. Two cost rows with
      `seat: 'deepseek#1'`/`'#2'`, one `dead-wave` degrade, expect **2** badged. Pair it with the
      existing distinct-alias case (test (4)).
- [ ] CHANGELOG: the M3/M4/D1 fix **and all five residuals of §0.7.3** — R1 legacy one-twin-alive,
      R2 legacy both-dead, **R3 new runs with an unidentified seat**, **R4 the critic path**,
      **R5 the live tick**. Rev 1's sentence named only R1.

## Task 6: Pin every residual

The owner ruling conditions acceptance on naming **and pinning** each residual. Rev 1 pinned one of
five.

- [ ] R1 — legacy alias-only, one twin alive → **0** rows.
- [ ] R2 — legacy alias-only, both twins dead → **1** row (not 2).
- [ ] R3 — a **new-run** record whose `seatId` is alias-valued (unidentified seat) behaves as R1/R2.
      This is the pin that proves the residual is not legacy-bounded.
- [ ] R4 — critic path: bench twin dead, critic twin alive → **0** rows (probe 2 of §0.7.4).
- [ ] R5 — live tick: `appendDeadRows` with `live.seats` (no seat id) still collapses twins.
- [ ] Each pin comments the shape as **known-wrong**, cites §0.7.3, and names the BACKLOG item.
- [ ] Full gates: `npm test` (no path arg, never piped through `tail`),
      `node scripts/check-file-sizes.js --all`, **`npm run lint`** (not `npx eslint .`).

## Task 7: File what this PR does not close

- [ ] BACKLOG entries for **R4** (critic path — role derives from alias equality at `:209`; needs
      producer-side role vocabulary) and **R5** (live payload carries no seat identity;
      `seatOf` emits a per-leg `taskId`). Attach the probe results.
- [ ] BACKLOG entry for the three spellings of `seatKey` (§0.6, failure mode #7).
- [ ] Correct the BACKLOG's rotted citations (§0.0) and its five-arm table caveat (§0.1).

---

## Global Constraints

- **300-line gate.** `adjustedCount = content.endsWith('\n') ? lineCount - 1 : lineCount`
  (`scripts/check-file-sizes.js:53-54`) — for files ending in a newline that is exactly `wc -l`.
  `Measure-Object -Line` is still wrong (skips blanks).

  | file | gate count | free |
  |---|---|---|
  | `electron/workspace-ui/live-seats.js` | 270 | **30** ← binding |
  | `electron/workspace-ui/workspace-seats.js` | 256 | 44 |
  | `src/council/run-retry-notes.js` | 105 | 195 |

  **`include` is `['src/**/*.js', 'electron/**/*.js']` — test files are NOT gated.**
  ⚠️ Task 2's absorb rule plus Task 4's changes must fit 30 lines on `live-seats.js`. If they do not,
  **stop and re-scope — do not shave comments.**
- **Renderer modules cannot `require()` from `src/`.** Re-spell `seatKey`; never import it.
- **`electron-token-drift` scans `live-seats.js`.** Write "PR 102", never the hash-number form.
- **Preservation pins need a NAMED MUTANT** verified to redden the RIGHT test *by name*. After
  tightening any expression, re-run its pins and confirm each still fails its mutant.
- **`data.seat` stays the ALIAS** (`run-retry-notes.js:39-45`; `verdict.js:72` compares it against
  `o.critic`). Add a key; never repurpose that one.

---

## Self-Review

**Spec coverage.** M3 → Task 2. M4 → Tasks 1+2 (bench path, new runs) + Task 6 (R1–R5 pinned).
D1 → Task 2's absorb rule. Dead-row key → Task 3. `retriedSeats` mirror → Task 4. Deferred
dead-wave test → Task 5. Out-of-scope items filed → Task 7.

**Task ordering.** 1 → 2 → 3 → 4 → 5 → 6 → 7. **2+3 are one shippable unit** (§0.4); **1+4 are
coupled** — Task 1 falsifies `workspace-seats.js:83-84` and adds a field Task 4 must read, so
shipping 1 without 4 leaves a documented-false comment and a mis-badged seat.

**Known gaps in THIS revision:**
- The absorb rule is `[MEASURED]` by *simulation* of the keying logic, not by running the patched
  `deadSeats`. Task 2 Step 2 closes that.
- Which of the six at-risk tests actually break is still an inference.
- R5's pin asserts current live-path behaviour; I have not run `appendDeadRows` end-to-end with a
  fake page. Task 6 must, or the pin is decoration.
- One refutation round. Rev 1's council found a blocker rev 1 had no idea existed; a second round on
  *this* revision has not happened.
