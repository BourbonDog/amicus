# v4.8 PR5b — the terminal seat path

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Merge base:** `ccb0551d` (PR5b extraction, [#160]). **Branch:** `v48-pr5b-seat-path`.
**Suite baseline at merge base:** `526 suites / 7414 passed / 8 skipped / 0 failed`, exit 0.
Size gate exit 0. Lint exit 0. Main CI green (run `31888547400`, after one macOS/node-24
jest-worker SIGSEGV re-ran clean — environmental, not a code fact).

**Revision 3.** Two refutation rounds. Round 2 was an **adjudicated 4-model council** (gpt, glm,
kimi, minimax; chair deepseek) aimed at revision 2's corrections:
**14 findings, ALL Confirmed** (peers-only `a=3, d=0`, solid). **Chair verdict: `Fix these first`.**
Eleventh consecutive revision with the same signature — every finding against the plan, none
against the code.

> **The chair named the pattern, and it is the most important output of the round:**
> *"Not fourteen slips — one weakness: **verification by assertion instead of verification by
> execution**."* Line counts stated rather than measured; citations pointing at comments and
> docblocks rather than the code path that runs; the degrade-channel model inferred rather than
> traced; the test harness sketched without confirming which globals the module dereferences.
>
> Secondary: **point-wise correction.** Revision 2 fixed the two things round 1 named and only
> those — which is why C5 found a citation "corrected" to a still-wrong location and A6 found
> line counts never re-measured. The lesson was applied to symptoms, not to the method.

⚠️ **Round 2 returned 56 adjudications with ZERO disputes.** That is the documented
agreement-inflation signature of this judging contract (`agree` is defined by worked example;
`dispute` never is). It is **not** independent corroboration. What makes these findings actionable
is that 11 of the 14 were separately verified against source by the orchestrator before the judges
saw them, and the chair was explicitly asked to name findings it would have disputed — it named
three (A5, C3, C4), and two of those were downgraded in `decisions-r2b.json`.

Round 1 was **self-run by this plan's author and found none of the 14.** That is the measured cost
of self-review, recorded here so it is not repeated.

Corrections are recorded **in place** (⛔ **REV-N WAS WRONG**) rather than silently patched.

| # | sev | what rev 1 got wrong |
|---|---|---|
| F1 | MAJOR | Propagated a **rotted citation** (`debate.js:88-96`) by copying a source comment instead of checking it. §3.1 |
| F2 | MAJOR | Cited the wrong line for the retry join, **and mis-described M5's actual defect**. §0.4 |
| F3 | MAJOR | **Task 1 makes M5 visibly worse** — so Task 3 was not separable, and rev 1 said it was. §0.4.1 |
| F4 | MEDIUM | The `JSON.stringify` blast radius, left unmeasured by rev 1, is **exactly 2 sites** — now named. Task 1 Step 6 |
| F5 | MEDIUM | Rev 1's new F37 test **duplicated two existing guards** it never mentioned. Task 1 Step 1 |
| F6 | MEDIUM | Rev 1's preservation pins had **no named mutant**, violating its own Global Constraint. Task 1 Step 5 |
| F7 | MINOR | The fake-DOM harness was copied in the task that does not need it. Task 1 Step 1 |
| F8 | MAJOR | Task 3's test **could not be written at all** — it called an IIFE-internal that no export exposes. Task 2 |
| F9 | MEDIUM | The File Structure table listed **two files this PR does not touch** and claimed a `deadSeats` change that its own Task 4 deferral forbids. §File Structure |

**Survived refutation, re-measured and confirmed:** §0.5's scope exclusion (`payload.legs` comes
only from `buildLegRows` at `mcp-council-awareness.js:196`, which stamps `taskId: legId`
unconditionally at `council-legs.js:128`, and `allLegIds` collects distinct task ids across waves —
so a live row genuinely cannot collide); §0.6's emit-when-set claim (`seats.js:67` mints
`alias#N` **exactly** when `counts.get(alias) > 1`); the `verdict.js:72` and `run-finish.js:43-48`
citations; and all four measurements in §0.1–§0.3.

**Goal:** Make the Workspace's terminal seats panel tell the truth on a bench that repeats an
alias — one row per seat, no frozen rows, no silently erased dead seats.

**Architecture:** PR5a already plumbed the seat through to `derived.cost.rows`
(`run-detail.js:82`, emit-when-set) and left a written handoff naming PR5b as its consumer. So
the row-identity half of this PR is a **pure renderer change** — no `src/` change at all. The
dead-seat half needs the seat id in the degrade record; two of the three emitters already carry
it as `data.firstFailure.seatId`, and the third needs a small, bounded producer change.

**Tech Stack:** ES5 IIFE browser modules under `electron/workspace-ui/` (`window.Amicus*`, no
`require` from `src/`), CommonJS under `src/`, Jest with `testEnvironment: 'node'` plus the
hand-rolled fake DOM in `tests/workspace/workspace-render.test.js`.

---

## Global Constraints

- **300-line hard file-size gate**, `node scripts/check-file-sizes.js --all`. Current headroom
  on every file this PR touches, measured at `ccb0551d`:

  ⛔ **REV-1 AND REV-2 BOTH GOT THIS TABLE WRONG (round-2 A6 + D1).** The counts were produced
  with PowerShell `Measure-Object -Line`, **which silently skips blank lines**. The gate counts
  `content.split('\n').length` (`scripts/check-file-sizes.js`), i.e. blanks included. Corrected,
  measured the gate's way:

  | file | lines | free | rev-2 claimed |
  |---|---|---|---|
  | `electron/workspace-ui/live-seats.js` | **255** | 45 | 249 / 51 |
  | `electron/workspace-ui/workspace-seats.js` | **200** | 100 | 194 / 106 |
  | `electron/workspace-ui/workspace-render.js` | **297** | **3** ← and NOT grandfathered | 282 / 18 |

  `workspace-render.js` has **three** lines of headroom, not eighteen. It is still not modified by
  this PR, but the margin that made that comfortable was five times smaller than stated. **Never
  use `Measure-Object -Line` for a gate-relevant count** — use `(Get-Content f).Count` or `wc -l`.

  `workspace-render.js` has 18 lines of headroom. **No task below adds a line to it.** If one
  turns out to need to, that is a signal to stop and re-scope, not to shave comments — comment
  prose was shaved three times in PR5a and that was the tell that preceded the extraction.
- **Renderer modules cannot `require()` from `src/`.** They are plain `<script src>` IIFEs under
  a strict CSP. Cross-module calls resolve `window.Amicus*` at CALL time, never at load time.
- **`electron-token-drift` scans `live-seats.js`.** Comments must write "PR 102", never the
  hash-number form — `HEX_RE` trips on it.
- **Distinct-alias benches must stay byte-identical.** Every task carries a control assertion
  proving it. This is the whole reason `seat` is emit-when-set upstream.
- **Preservation pins need a NAMED MUTANT, not RED-before-GREEN.** A pin that is green at HEAD by
  construction proves nothing until you apply the mutant it is supposed to kill, to the real
  file, and measure RED. After tightening any expression, re-run its pins and confirm each still
  FAILS its mutant — in PR5a a hardening silently disarmed the fixture that guarded it.

---

## 0. The defects, as measured

All four were measured at `ccb0551d`, not reasoned about. The probes are reproduced in the tasks
that kill them. **Every one of them is silent** — no crash, no banner, no console warning.

### 0.1 M1/M2 — the terminal seats panel freezes a row

`seatsFromRunStats` (`live-seats.js:83`) ids a row `r.model + ':' + (r.role || 'seat')` — **alias
space**. Since PR1 a bench that repeats an alias has distinct *seats*, so two rows collide.

`renderSeats` (`workspace-render.js:179-233`) snapshots `existing` from `tbody.children` **once**,
before its loop. Measured across two ticks with the fake DOM, two seats sharing a key:

| tick | row 1 | row 2 |
|---|---|---|
| 1 | `ok / $0.01` | `error / $0.02` |
| 2 | **`ok / $0.01`** ← frozen | `DONE-2 / $0.22` |
| control, distinct keys | `DONE-A / $0.11` | `DONE-B / $0.22` ✅ |

Row 1 is **never updated again** (`existing[key]` resolves to the *last* row, so both seats write
into row 2, last-writer-wins) and **never removed** (`seen[key]` is true). The panel shows one
stale ghost beside one row that flickers between two seats' data.

> ⚠️ The obvious summary — "the second row overwrites the first" — is **wrong**, and was my first
> reading. Tick 1 appends *both* rows correctly. The defect only appears from tick 2. A test that
> renders once cannot see it. **Every pin below renders at least twice.**

### 0.2 M3 — two dead twins collapse to one row

`deadSeats`'s `add()` (`live-seats.js:177-185`) returns early on `seen[model]`, keyed on the
alias. Measured: two `dead-leg` notes for the same alias → **1** row out.

### 0.3 M4 — a live twin silently erases its dead twin

`deadSeats`'s suppression (`live-seats.js:234-243`) builds `reviewing[alias]` from the live seats.
Measured: one seat alive, its twin genuinely dead → **0** dead rows rendered. The dead seat
produces no output anywhere in the panel.

> This is the sharpest of the four and the one that most clearly fails the product principle: a
> correct-but-silent degrade fails the bar as hard as a crash.

### 0.4 M5 — a seat that was never retried is labelled "retried once"

⛔ **REV-1 WAS WRONG ABOUT THIS DEFECT, AND CITED THE WRONG LINE (F2).** Rev 1 said the marker
"can land on the wrong row" via last-wins in `rowsByKey`, and put the join at
`workspace-seats.js:103-104`. Measured: `:104` is the *row lookup*; the retry test is at **`:117`**:

```js
var isRetried = isReviewingRole(s.role) && !!retried[s.modelInput || s.model];
```

`seatsFromRunStats` emits **no `modelInput`** (`live-seats.js:84-88` — the key list is
`model, role, status, stage, messages, tokensIn, tokensOut, costDisplay, lastActivity,
latestPreview, stalled`), so `s.modelInput || s.model` is always the alias on this path. The
defect is therefore not misattribution between rows — it is that `retriedAliases`
(`workspace-seats.js:57-71`) is alias-keyed, so on a twin bench where **one** seat was retried,
`retried['deepseek']` is true for **both**. A seat that was never retried renders `↻ retried once`.

Rev 1 flagged M5 as its one unmeasured claim and was right to; the measurement changed what the
defect *is*. **Task 2 still measures before fixing** — that discipline is what caught this.

### 0.4.1 ⚠️ Task 1 makes M5 WORSE — the tasks are not separable (F3)

⛔ **REV-1 PRESENTED TASK 3 AS INDEPENDENTLY REJECTABLE. IT IS NOT.**

At HEAD the twins collapse to one rendered row (§0.1), so the alias-keyed badge paints **one** row.
After Task 1 there are **two** rows, and the still-alias-keyed lookup at `:117` badges **both** —
so a seat that was never retried visibly gains a `↻ retried once` badge it did not have before.

Task 1 alone is a **visible regression** on exactly the bench it exists to fix. The retry fix is
therefore a required companion, not a neighbour a reviewer could reject. This plan reorders
accordingly: **Task 1 + Task 2 are one shippable unit**, and the DOM proof (now Task 3) covers
their combined result.

### 0.5 What is NOT broken — the scope boundary

**The live path during a run is safe.** `live-normalize.js:41` sets `id: leg.taskId || null`, and
`council-legs.js:128` stamps `taskId: legId` unconditionally on every leg row, so live rows have
unique ids and never collide. This PR does **not** touch `live-normalize.js` or `live-model.js`.

⚠️ Do not "simplify" `id: leg.taskId || null` into a shared helper with the terminal path. They
are different identities on purpose: one is per-*leg*, the other per-*seat*, and a seat can have
several legs.

### 0.6 The upstream handoff this PR consumes

`run-detail.js:76-82`, shipped in PR5a, verbatim:

> *"v4.8 PR5a T3: carry the seat. … ⚠️ Its consumer (renderCost) lands in PR5b, so this is
> honestly a payload-shape change here, not a visible one — shipping it now keeps PR5b from
> needing a src/ change of its own. Emit-when-set: a unique bench has no seat on any row, so the
> payload is byte-identical there."*

Verified against the producer, not just the comment: `run-assemble.js:89` stamps
`...(seat && seat.id !== seat.alias ? { seat: seat.id } : {})`. **`seat` is present only when it
differs from the alias.** Therefore `r.seat || r.model` is load-bearing in every consumer below,
and is exactly what keeps distinct-alias benches byte-identical.

### 0.7 Where the seat id lives for dead seats

⛔ **REV-2'S TABLE WAS WRONG ON EVERY ROW BUT ONE (round-2 C1, MAJOR, raised by kimi).** It
recorded two emitters as unconditionally `dead-leg` when both branch on the failure class, and it
omitted the dead-**wave** row entirely — which is where round-2 A3 landed. Corrected by tracing
`run-retry-notes.js` against the two consumers rather than reading the emitters alone:

| emitter | channel | key available to the consumer |
|---|---|---|
| `retryLegStillDeadNote` (`:67`) | `missing ? 'seat-unbound' : 'dead-leg'` | ✅ `data.firstFailure.seatId` — **but only on the `dead-leg` branch** |
| `missingLegStillDeadNote` (`:92`) | `missing ? 'seat-unbound' : 'dead-leg'` | ✅ same, same caveat |
| `srcLegStillDeadNote` (`:51`) | `dead-leg` | ❌ no `firstFailure` → **`data.seat`, an ALIAS** |
| `waveStillDeadNote` (`:28`) — dead-wave arm | `dead-wave` | ❌ **`data.models[]`, ALIASES**, no `seat`, no `firstFailure` |
| `waveStillDeadNote` (`:28`) — partial arm | `seat-unbound` | ❌ alias only |

Both consumers filter to `dead-leg`/`dead-wave` only (`live-seats.js:188`,
`workspace-seats.js:61`), so **every `seat-unbound` record is invisible to this surface.**

⚠️ Round 2's C1 was framed as *"the seat id Task 2 depends on rides a channel nobody reads."*
That overstates it, and glm said so in adjudication: the **non-missing `dead-leg` branch does
carry `seatId` and is read.** The accurate statement is narrower and still serious: **a seat id is
available on exactly one of five emitter arms.** The other four give an alias or nothing.

⚠️ This table is also the reference material filed in `BACKLOG.md` for the deferred M3/M4 PR, so
the rev-2 error would have propagated into work this plan does not even do. **Update the BACKLOG
entry with this corrected table when revision 3 lands.**

Evidence, measured not assumed: `run-retry.test.js:628` asserts
`units[0].firstFailures.map(f => f.seatId)` → `['deepseek#1','deepseek#2']` on a twin bench, and
`degrade-channels.test.js:126` shows `firstFailure: {…, seatId: 'beta'}` inside a **shipped**
degrade record.

⚠️ `data.seat` itself stays the **alias**, deliberately — `run-retry-notes.js:39-45` explains
that `verdict.js:72` compares it against `o.critic`, which is an alias. **Do not re-point
`data.seat` at the seat id.** Add a key; never repurpose that one.

### 0.8 The key strategy — stated, because no round proposed one

The chair's sharpest observation was that **every finding proves the rev-2 key flip wrong and none
says what right looks like.** Rev 2 had no §0.8; this is it, and it is the decision the rest of
Task 2 follows from.

**Rejected: seat-id-only keying** (rev 2's). Four of five emitter arms carry no seat id, so the
map is keyed by alias for those records while the lookup asks for a seat id → **zero badges**
(round-2 B1, A3). Silent under-badging, strictly worse than the over-badging at HEAD.

**Rejected: emit the seat id on every channel.** It is a producer change across
`run-retry-notes.js` and `run-retry-group.js` with exact-`toEqual` fixtures pinning every shape —
the same blast radius the owner already deferred as Task 4. Re-importing it here reverses that
ruling by the back door.

**Chosen: dual lookup, seat-id first, alias fallback.**

```js
// key: seat id when the record names one, alias otherwise (unchanged from rev 2)
var key = (d.data.firstFailure && d.data.firstFailure.seatId) || d.data.seat;
// dead-wave arm keeps its existing models[] fan-out, keyed by alias
// lookup: try the precise key, then the imprecise one
var isRetried = isReviewingRole(s.role) && !!(retried[s.seat] || retried[s.model]);
```

**What this buys, stated per arm rather than claimed in aggregate:**

| record | key | twin-bench result |
|---|---|---|
| `dead-leg` + `firstFailure.seatId` | `deepseek#2` | **exact** — badges only the retried seat ✅ |
| `dead-leg`, no `firstFailure` (`srcLeg`) | `deepseek` | badges **both** twins — imprecise, but visible |
| `dead-wave` (`models[]`) | `deepseek` | badges **both** twins — imprecise, but visible |
| `seat-unbound` | — | never read (unchanged, pre-existing) |

⚠️ **This does not fully fix M5, and the plan must not claim it does.** For alias-only records a
twin bench still over-badges. That is **not a defect in the fix — it is the limit of the data**:
those records do not record which seat failed, so no consumer can attribute them. The honest
design is precision where the producer supplies it and disclosed imprecision where it does not.

**Why over-badging is the right failure direction:** a badge that appears on one seat too many is
visible and self-correcting under inspection; a badge that vanishes is silent. The product
principle rates a silent degrade as severely as a crash, so when the data cannot decide, fail
loud. Rev 2 chose the silent direction by accident; this chooses the loud one on purpose.

**CHANGELOG must state the residual**: on a bench that repeats an alias, a retry recorded without
a seat id marks every seat sharing that alias.

---

## File Structure

⛔ **REV-1'S TABLE LISTED TWO FILES THIS PR DOES NOT TOUCH.** `src/council/run-retry-notes.js` and
`tests/council/degrade-channels.test.js` belong to the deferred Task 4 and are gone from the table
below. **This PR changes no file under `src/`.**

| file | change | task |
|---|---|---|
| `electron/workspace-ui/live-seats.js` | `seatsFromRunStats`: seat-keyed injective id + carry `seat`; correct the rotted `debate.js` citation in the F37 comment | 1 |
| `electron/workspace-ui/workspace-seats.js` | `retriedAliases` → `retriedSeats`, seat-keyed; the `:117` lookup; the `:47` mirror docblock | 2 |
| `tests/workspace/seat-panel-twins.test.js` | **new** — the twin-bench pins; T2 via `makeFakeDom`, T3 via `makeFakeDoc`, all multi-tick | 1,2,3 |
| `tests/workspace/live-model.test.js` | F37 guard `:105` → JSON key spelling; fix the rotted `:95` citation | 1 |
| `tests/workspace/workspace-render.test.js` | F37 guard `:363` → JSON key spelling | 1 |

`deadSeats` is **not** modified — rev 1's table said it was, which contradicted its own Task 4
deferral. `workspace-render.js` is **read but not modified**: its `String(seat.id || seat.model)`
keying is already correct once `seat.id` is correct. That is the whole reason this PR is small.

---

## Task 1: Seat-keyed row identity in the terminal seats panel

Kills M1/M2 (§0.1).

**Files:**
- Modify: `electron/workspace-ui/live-seats.js:73-90` (`seatsFromRunStats`)
- Test: `tests/workspace/seat-panel-twins.test.js` (create)

**Interfaces:**
- Consumes: `derived.cost.rows[]` — `{model, seat?, role, status, durationMs, costDisplay}`,
  where `seat` is present **only** when it differs from the alias (§0.6).
- Produces: seat rows `{id, seat, model, role, …}` where `id` is injective over
  `(seat-or-alias, role)`. `workspace-render.js:195` and `workspace-seats.js:104` both key on
  `String(seat.id || seat.model)` and must keep working unchanged.

- [ ] **Step 1: Write the failing test**

Create `tests/workspace/seat-panel-twins.test.js`.

⛔ **REV-1 SAID TO COPY THE `makeFakeDoc()` HARNESS HERE (F7). Do not** — nothing in this task
touches the DOM; it calls `seatsFromRunStats` directly. The harness is copied in Task 3, the only
task that needs it.

⛔ **REV-1 ADDED AN F37 TEST WITHOUT MENTIONING THE TWO THAT ALREADY EXIST (F5).** The
debate-role guard is already covered twice — `tests/workspace/live-model.test.js:99` and
`tests/workspace/workspace-render.test.js:354`. **Do not write a third.** It is listed below only
as a *reference* so you recognise both when Step 6 makes them fail; both are updated there, not
duplicated here.

```js
'use strict';
const LS = require('../../electron/workspace-ui/live-seats');

describe('T1 — twin-bench row identity', () => {
  const twinRows = [
    { model: 'deepseek', seat: 'deepseek#1', role: 'seat', status: 'ok', costDisplay: '$0.01' },
    { model: 'deepseek', seat: 'deepseek#2', role: 'seat', status: 'error', costDisplay: '$0.02' },
  ];

  test('two seats of one alias get DISTINCT ids', () => {
    const ids = LS.seatsFromRunStats(twinRows).map(r => r.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids[0]).not.toBe(ids[1]);
  });

  test('the seat rides through for downstream consumers', () => {
    expect(LS.seatsFromRunStats(twinRows).map(r => r.seat)).toEqual(['deepseek#1', 'deepseek#2']);
  });

  // CONTROL — the byte-identity clause from §0.6. A distinct-alias bench has NO `seat` on
  // any row, so this is the shape that must not move.
  test('a distinct-alias bench is unchanged, ids still alias:role', () => {
    const rows = LS.seatsFromRunStats([
      { model: 'a', role: 'seat', costDisplay: '$0.01' },
      { model: 'b', role: 'seat', costDisplay: '$0.02' },
    ]);
    expect(rows.map(r => r.id)).toEqual(['a:seat', 'b:seat']);
    expect(rows.map(r => r.seat)).toEqual([null, null]);
  });

  // REFERENCE ONLY — do NOT add this test (F5). The identical guard already exists at
  // live-model.test.js:99 and workspace-render.test.js:354. Shown so you recognise the shape
  // when Step 6 turns both of them red.
  //
  //   test('F37 preserved: debate roles do not collide with the seat row', () => {
  //     const ids = LS.seatsFromRunStats([
  //       { model: 'a', role: 'seat' }, { model: 'a', role: 'rebuttal' }, { model: 'a', role: 'revote' },
  //     ]).map(r => r.id);
  //     expect(new Set(ids).size).toBe(3);
  //   });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx jest tests/workspace/seat-panel-twins.test.js
```

Expected: the first two tests FAIL (`new Set(ids).size` is `1`, not `2`; `r.seat` is `undefined`,
not the seat id). The control PASSES — it is a preservation pin, green at HEAD by construction.
**Do not treat its passing as progress**; Step 5 gives it a named mutant, which is the only thing
that makes it a pin rather than decoration (F6).

- [ ] **Step 3: Implement**

In `electron/workspace-ui/live-seats.js`, replace the `id:` line and add `seat:`:

```js
      // ⚠️ DE-ROT (F37) + v4.8 PR5b: the composite id is over the SEAT, not the alias. A
      // --debate run emits extra runStats rows for the same alias (role 'rebuttal'/'revote',
      // src/council/debate.js:134 `debateRunStatsRows`, merged at run-finish.js:43-48) — that is
      // what the role half kills. PR1 then made a bench
      // that repeats an alias produce distinct SEATS, and two of them collided on the alias
      // half: renderSeats appended both on tick 1, then froze the first forever (it is never
      // re-matched, and `seen[key]` keeps it from being removed). `r.seat` is emit-when-set
      // upstream (run-assemble.js:89 stamps it only when seat.id !== seat.alias), so
      // `|| r.model` is load-bearing and is what keeps a distinct-alias bench byte-identical.
      // JSON.stringify, not string concat: an alias may contain ':' (e.g. a provider-prefixed
      // id) and roles include 'lens:*', so a concatenated key is NOT injective —
      // ('a','lens:x') and ('a:lens','x') both spell 'a:lens:x'. This key is never displayed;
      // it is only ever a `dataset.key`, and workspace-render.js:186 deliberately uses a plain
      // object lookup so quotes and backslashes in a key are already safe there.
      id: JSON.stringify([r.seat || r.model, r.role || 'seat']),
      // Carried for workspace-seats.js's retry-marker join (Task 3). Null on a distinct-alias
      // bench, exactly like the upstream payload.
      seat: r.seat || null,
```

⚠️ The control test above asserts `['a:seat','b:seat']`. `JSON.stringify` changes that spelling to
`["a","seat"]`. **Update the control's expected values to the JSON form in the same commit** —
and read the change carefully: the control's job is to prove distinct-alias *behaviour* is
unchanged, not that the key's spelling never moves. Assert `new Set(ids).size === 2` and the
absence of `seat`, plus the exact new spelling.

- [ ] **Step 4: Run the test**

```bash
npx jest tests/workspace/seat-panel-twins.test.js
```

Expected: PASS.

- [ ] **Step 5: Apply BOTH named mutants and measure RED**

Two mutants, because the task makes two claims (F6):

**Mutant 1 — the fix.** Revert the id expression to `(r.model) + ':' + (r.role || 'seat')`.
Expected: the two twin tests go RED.

**Mutant 2 — the control.** Keep the fix, but drop the `|| r.model` fallback:
`id: JSON.stringify([r.seat, r.role || 'seat'])`. Expected: the **control** goes RED, because a
distinct-alias bench has no `r.seat` and every id becomes `[null,"seat"]`. This is the mutant that
makes the control a pin rather than decoration — without it, the control is green against every
implementation that happens to work on twins.

Restore byte-identically after each (`git diff` empty for the mutant line). A pin that does not go
red is not pinning anything.

- [ ] **Step 6: Update the two F37 guards — they are EXPECTED to fail**

⛔ **REV-1 LEFT THIS TO DISCOVERY AND GUESSED THE BLAST RADIUS (F4). Measured: exactly two sites**,
both asserting the `alias:role` spelling of an id they did **not** construct — so both legitimately
break, and both are the same F37 guard:

| site | assertion at HEAD |
|---|---|
| `tests/workspace/live-model.test.js:105` | `rows.map(r => r.id)` → `['gemini:seat','gemini:rebuttal','gemini:revote']` |
| `tests/workspace/workspace-render.test.js:363` | `children.map(r => r.dataset.key)` → the same three |

Update both to the JSON spelling — `'["gemini","seat"]'` etc. **Keep them asserting three
DISTINCT values**; that, not the spelling, is what F37 pins.

Six other grep hits (`workspace-render.test.js:335,345,346,351,389-438`) construct their ids by
hand and never call `seatsFromRunStats` — they are **unaffected**. Do not touch them.

⚠️ While in `live-model.test.js`, note its comment at `:95` carries the same rotted
`debate.js:88-96` citation this plan corrects (F1). Fix it there too — see Task 1 Step 3.

```bash
npx jest tests/workspace/
```

Expected after the two updates: PASS. **If any suite beyond those two fails, that is a finding —
record it, do not silently edit it.**

- [ ] **Step 7: Commit**

```bash
git add electron/workspace-ui/live-seats.js tests/workspace/seat-panel-twins.test.js \
        tests/workspace/live-model.test.js tests/workspace/workspace-render.test.js
git commit -m "v4.8 PR5b T1: key terminal seat rows on the seat, not the alias"
```

---

## Task 2: Seat-keyed retry markers — ⚠️ MUST SHIP WITH TASK 1

Kills M5 (§0.4). ⛔ **REV-1 ORDERED THIS LAST AND CALLED IT INDEPENDENTLY REJECTABLE (F3).**
Per §0.4.1, Task 1 alone turns one wrongly-badged row into **two**, so shipping Task 1 without this
is a visible regression. Do not commit Task 1 to a shared branch without this task on top.

**Files:**
- Modify: `electron/workspace-ui/workspace-seats.js:57-71` (`retriedAliases`), `:117` (the lookup)
- Test: `tests/workspace/seat-panel-twins.test.js`

**Interfaces:**
- Consumes: `run.degrades[]`; Task 1's `seat` field on each seat row.
- Produces: `retriedSeats(degrades)` → a null-prototype object keyed by **seat id when the record
  names one, alias otherwise**. Renamed from `retriedAliases`. **Two** call sites, not three:
  the definition (`:57`), the invocation (`:94`), and the lookup (`:117`). `:104` is the *row*
  lookup and is Task 1's concern, not this one.

⛔ **REV-1'S TEST FOR THIS TASK COULD NOT BE WRITTEN AT ALL (F8).** It called
`WS.retriedSeats(degrades)` directly. Measured: `workspace-seats.js` has **no `module.exports`**,
and `window.AmicusSeats` (`:195-199`) exposes only
`{renderSeatsPanel, renderDeadSeatRows, appendDeadRows}` — `retriedAliases` is an IIFE-internal
closure and is unreachable from any test.

That constraint is a gift, not an obstacle: testing **through** `renderSeatsPanel` pins the
user-visible defect (which rows carry the badge) instead of a helper's return value.

⛔ **REV-2'S REPLACEMENT COULD NOT RUN EITHER — AND IT CITED THE WRONG PATTERN
(round-2 A2 + B2 + C2 + C3, three independent raisers).** Rev 2's `beforeEach` loaded **only**
`workspace-seats`, but `renderSeatsPanel` dereferences `window.AmicusLive.seatsFromRunStats`
(`:83`), `window.AmicusRender.renderSeats` (`:85`) and `window.AmicusLive.deadSeats` (`:126`).
`makeFakeDom()` supplies **none** of them, and supplies no `window.AmicusApp` either — so
rev 2's `window.AmicusApp.state.detail = {…}` throws a TypeError before any assertion runs.

Two further corrections from the same cluster:

- **The module that provides `window.AmicusLive` is `live-model.js`, not `live-seats.js`** (C3).
  `live-seats.js` sets `window.AmicusLiveSeats`; live-model re-exports it. Loading live-seats
  alone never populates the global the panel reads.
- **Rev 2 cited `workspace-seats.test.js:17-28` as "the established pattern". Wrong block** — that
  is the delegation-spy test, which never drives `renderSeatsPanel` with real data. The block that
  does is **`:63-98`**, and it loads **three** modules then installs the App stub.

**Required bootstrap** — `jest.resetModules()`, install `makeFakeDom()`'s `window`/`document`/
`NodeFilter` as globals, then `require()` **live-model → workspace-render → workspace-seats** in
that order (matching `index.html` and `SCRIPT_LOAD_ORDER`), then install the `window.AmicusApp`
stub with `state`, `$`, and `labelOf`. **Read `:63-98` and copy it; do not re-derive it.**

- [ ] **Step 1: Measure the current behaviour**

§0.4 was rewritten from measurement in revision 2, but it was measured by *reading*, not by
running. Confirm it end-to-end before changing anything: drive `renderSeatsPanel` through the fake
page with a twin bench where **only `deepseek#2`** was retried, and record how many rows carry
`↻ retried once`. Expected at HEAD-plus-Task-1: **2** (the bug). Put the measured number in the
commit message. If it is 1, **stop — this task is not needed** and §0.4 is wrong again.

- [ ] **Step 2: Write the failing test**

```js
const { makeFakeDom } = require('./helpers/fake-workspace-page');

describe('T2 — the retry badge marks only the seat that was retried', () => {
  beforeEach(() => {
    jest.resetModules();
    const fake = makeFakeDom();
    global.window = fake.window;
    global.document = fake.document;
    global.NodeFilter = fake.NodeFilter;
    // Load order matches index.html and SCRIPT_LOAD_ORDER.
    require('../../electron/workspace-ui/workspace-seats');
  });

  function badgedRows() {
    window.AmicusSeats.renderSeatsPanel();
    return Array.prototype.slice.call(window.AmicusApp.$('seats-body').children)
      .filter(r => r.children[8] && r.children[8].textContent === '↻ retried once').length;
  }

  test('one retried twin badges ONE row, not both', () => {
    // Wire the fake app state the way workspace-seats.js reads it (:81-94): cost rows carry
    // the seat (PR5a, run-detail.js:82); the degrade names the seat id in firstFailure.seatId.
    window.AmicusApp.state.detail = {
      run: { degrades: [{ kind: 'degrade', channel: 'dead-leg',
        data: { seat: 'deepseek', retryWaveId: 'w1',
          firstFailure: { seat: 'deepseek', seatId: 'deepseek#2', class: 'leg' } } }] },
      derived: { cost: { rows: [
        { model: 'deepseek', seat: 'deepseek#1', role: 'seat', status: 'ok', costDisplay: '$0.01' },
        { model: 'deepseek', seat: 'deepseek#2', role: 'seat', status: 'error', costDisplay: '$0.02' },
      ] } },
    };
    expect(badgedRows()).toBe(1);
  });

  test('control — a distinct-alias bench still badges by alias', () => {
    window.AmicusApp.state.detail = {
      run: { degrades: [{ kind: 'degrade', channel: 'dead-leg',
        data: { seat: 'a', retryWaveId: 'w1' } }] },
      derived: { cost: { rows: [
        { model: 'a', role: 'seat', status: 'error', costDisplay: '$0.01' },
        { model: 'b', role: 'seat', status: 'ok', costDisplay: '$0.02' },
      ] } },
    };
    expect(badgedRows()).toBe(1);
  });
});
```

⚠️ `makeFakeDom()`'s exact `window.AmicusApp` shape is fixture-specific — read
`tests/workspace/helpers/fake-workspace-page.js` and match it rather than trusting the sketch
above. If the helper does not let you set `state.detail` directly, extend the helper; do **not**
weaken the assertion to fit it.

- [ ] **Step 3: Run it and watch it fail**

```bash
npx jest tests/workspace/seat-panel-twins.test.js -t 'badges ONE row'
```

Expected: FAIL, received `2`. The control PASSES (preservation pin — its mutant is in Step 5).

- [ ] **Step 4: Implement**

⛔ **REV-2'S LOOKUP WAS A SILENT REGRESSION (round-2 B1 + A3, two independent raisers).** It
paired an **alias-or-seat-id key** with a **seat-id-only lookup** (`retried[s.seat || s.model]` —
which reads `s.seat` first and only falls through when `s.seat` is *null*, i.e. never on a twin
bench). For `srcLegStillDeadNote` and every `dead-wave` record the key is an alias, so the lookup
missed and **the retried seat lost its badge entirely** — turning HEAD's visible false positive
into a silent false negative. That is the defect class this whole module exists to prevent,
re-created by the fix meant to remove it.

Implement §0.8's **dual lookup** instead:

```js
// :57 — key: seat id when the record names one, alias otherwise. UNCHANGED from rev 2.
var key = (d.data.firstFailure && d.data.firstFailure.seatId) || d.data.seat;
// :117 — lookup: try the precise key, THEN the imprecise one. Both arms are load-bearing:
// `s.seat` catches dead-leg records that name a seat; `s.model` catches srcLeg + dead-wave,
// which name only an alias. Dropping either arm silently loses a whole emitter (round-2 B1/A3).
var isRetried = isReviewingRole(s.role) && !!(retried[s.seat] || retried[s.model]);
```

⚠️ Keep the existing `data.models[]` fan-out for `dead-wave` (`workspace-seats.js:64-67`) —
rev 2's key had no dead-wave branch at all, which is round-2 A3.

⚠️ `seatsFromRunStats` emits no `modelInput`, so dropping it from the lookup changes nothing on
this path (§0.4) — but `s.model` must stay, and now for a *different* reason than rev 2 gave.

Keep the `kind`/`channel` filter exactly as it is — `workspace-seats.js:47-50` documents that it
is load-bearing (`kind:'heal'` records carry the same `retryWaveId` fields for seats that
**recovered**, and a field-only scan would tag a recovered seat "retried once").

⚠️ The docblock at `:47` says this function "Mirrors `window.AmicusLive.deadSeats`' own predicate
(live-seats.js:186-200) EXACTLY, and must keep mirroring it." This task changes one side of that
mirror; the deferred M3/M4 PR changes the other. **Update the docblock to say the mirror is now
partial and why**, or the next reader will trust a claim that is no longer true — the
two-spellings defect council-1's B1 raised against PR5a.

- [ ] **Step 5: Run, apply both mutants, restore**

```bash
npx jest tests/workspace/
```

**Mutant 1:** revert the key to `data.seat`. Expected: the twin test goes RED.
**Mutant 2:** revert the lookup to `retried[s.modelInput || s.model]`. Expected: the twin test
goes RED (it reads the alias again). Restore byte-identically after each.

- [ ] **Step 6: Commit**

```bash
git add electron/workspace-ui/workspace-seats.js tests/workspace/seat-panel-twins.test.js
git commit -m "v4.8 PR5b T2: badge the seat that was retried, not its twin"
```

---

## Task 3: Multi-tick proof at the DOM

Tasks 1 and 2 fixed the *ids* and the *badge*. This task proves the *symptom* is gone where the
user sees it. It is separable from them in the one direction that matters: a reviewer could accept
the unit changes and still want the end-to-end pin, but never the reverse.

**Files:**
- Modify: `tests/workspace/seat-panel-twins.test.js`
- Read only: `electron/workspace-ui/workspace-render.js:179-233`

**Interfaces:**
- Consumes: Task 1's `seatsFromRunStats` output; `window.AmicusRender.renderSeats(tbody, seats,
  blindOn, labelOf)`.

- [ ] **Step 1: Write the failing test**

Append to `tests/workspace/seat-panel-twins.test.js`. **Two ticks minimum** — §0.1 proves a
single-tick test cannot see this defect.

⚠️ This task needs a *different* harness from Task 2: `makeFakeDoc()` from
`tests/workspace/workspace-render.test.js:20-141` (a bare element factory), **not**
`makeFakeDom()` from `helpers/fake-workspace-page` (a whole fake page). Copy `makeFakeDoc`
verbatim into this file — that is the established pattern and adds no dependency (F7).

```js
describe('T3 — the frozen row, at the DOM', () => {
  let R, doc;
  beforeEach(() => {
    global.window = { AmicusLive: require('../../electron/workspace-ui/live-model') };
    global.document = doc = makeFakeDoc();
    jest.isolateModules(() => { require('../../electron/workspace-ui/workspace-render.js'); });
    R = global.window.AmicusRender;
  });

  function paint(tbody, rows) {
    R.renderSeats(tbody, require('../../electron/workspace-ui/live-seats').seatsFromRunStats(rows),
      false, null);
    return tbody.children.map(r => [r.children[2].textContent, r.children[6].textContent]);
  }

  test('both twin rows keep updating across ticks', () => {
    const tbody = doc.createElement('tbody');
    paint(tbody, [
      { model: 'deepseek', seat: 'deepseek#1', role: 'seat', status: 'ok', costDisplay: '$0.01' },
      { model: 'deepseek', seat: 'deepseek#2', role: 'seat', status: 'error', costDisplay: '$0.02' },
    ]);
    const after2 = paint(tbody, [
      { model: 'deepseek', seat: 'deepseek#1', role: 'seat', status: 'DONE-1', costDisplay: '$0.11' },
      { model: 'deepseek', seat: 'deepseek#2', role: 'seat', status: 'DONE-2', costDisplay: '$0.22' },
    ]);
    expect(tbody.children.length).toBe(2);
    // The measured HEAD behaviour was [['ok','$0.01'], ['DONE-2','$0.22']] — row 1 frozen.
    expect(after2).toEqual([['DONE-1', '$0.11'], ['DONE-2', '$0.22']]);
  });
});
```

- [ ] **Step 2: Confirm it fails without Task 1**

⛔ **REV-2'S METHOD HERE WAS VACUOUS (round-2 A1, MAJOR).** It ran
`git stash push electron/workspace-ui/live-seats.js`. **`git stash push <path>` stashes only
*uncommitted* changes**, and Task 1 Step 7 already **committed** that file — so the stash is a
no-op (`No local changes to save`), the tree still contains the fix, and the step passes while
proving nothing. A step whose purpose is to observe RED, which cannot observe RED, is worse than
no step: it certifies the pin.

Use a reverse-checkout of the pre-Task-1 file instead, which works regardless of commit state:

```bash
# restore the file as it was BEFORE Task 1's commit, run the pin, then restore the fix
git checkout <task1-commit>^ -- electron/workspace-ui/live-seats.js
npx jest tests/workspace/seat-panel-twins.test.js -t 'keep updating'
git checkout HEAD -- electron/workspace-ui/live-seats.js
```

Expected on the reverted file: FAIL with received `[['ok','$0.01'],['DONE-2','$0.22']]` — the
exact frozen-row signature from §0.1. Confirm `git diff` is empty afterwards.

⚠️ **Verify the revert actually reverted** before trusting the FAIL: `git diff HEAD --stat` must
show `live-seats.js` modified during the run. Rev 2's whole failure was assuming a command had an
effect without checking that it did — the chair named exactly this as the plan's root weakness.

- [ ] **Step 3: Run it with Task 1 applied**

```bash
npx jest tests/workspace/seat-panel-twins.test.js
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/workspace/seat-panel-twins.test.js
git commit -m "v4.8 PR5b T3: pin the frozen-row symptom across two ticks"
```

- [ ] **Step 5: Run the full local gates before opening the PR**

```bash
npm test
```

Full suite, **no path argument, never piped through `tail`**. Then:

```bash
node scripts/check-file-sizes.js --all
npx eslint .
```

Baseline to beat: `526 suites / 7414 passed / 8 skipped / 0 failed`, plus the two F37 guards
updated in Task 1 Step 6 and the new `seat-panel-twins.test.js`. Sizes and lint exit 0.

---

## Task 4: Seat-keyed dead rows — ⛔ DEFERRED BY OWNER RULING (2026-08-15)

Kills M3/M4 (§0.2, §0.3) — the two sharpest defects, including the silently-erased dead seat.

> **RULING: option 3, defer to its own PR.** PR5b ships Tasks 1–3 only — a renderer-only slice,
> zero `src/` changes. M3/M4 are filed in `BACKLOG.md` with the §0.7 emitter table intact so the
> next plan starts from measurement rather than re-deriving it.
>
> **This is a deferral of scope, not of severity.** M4 is silent data loss and keeps that rating
> in the backlog entry. The reason it moves is blast radius: it is a *different* identity problem
> — the degrade-record vocabulary, not the row key — and PR5a's four-round council climb is
> direct evidence that mixing a producer change into a renderer PR is what makes review expensive.

**This task is NOT implemented in this PR.** The analysis below is retained as the input to the
follow-up PR, not as work to do here.

**The problem:** `deadSeats` dedups and suppresses on the alias. Fixing it needs the seat id.
Per §0.7 it is available as `data.firstFailure.seatId` for `retryLegStillDeadNote` and
`missingLegStillDeadNote` — but **not** for `srcLegStillDeadNote`, which emits no `firstFailure`
at all. Its call site does have `unit`, which carries both `unit.seats` (index-parallel with
`unit.models`, per `run-retry-group.js:33`) and `unit.firstFailures[].seatId`, so the id is
reachable — it just is not currently put into the note.

**The cost:** the note shapes are pinned by exact `toEqual` assertions.
`run-retry-notes.js:39-41` warns explicitly that adding a key unconditionally "breaks
degrade-channels.test.js's exact toEqual on a real dead wave." So this is a producer change plus
fixture updates in `tests/council/degrade-channels.test.js`.

**Three options:**

1. **Full fix** — add `seatId` to `srcLegStillDeadNote`'s `data`, then seat-key `deadSeats`'
   `seen`/`reviewing`/`byRole` maps. Closes both M3 and M4 on every emitter. Widest blast radius:
   one `src/` file, one council fixture file, and it puts a council-reviewed producer change into
   a PR that is otherwise renderer-only.
2. **Partial fix** — seat-key `deadSeats` using `data.firstFailure.seatId` where present, falling
   back to `data.seat`. No `src/` change. Closes M3/M4 for the two retry-origin emitters and
   leaves `srcLegStillDeadNote` (retry wave died wholesale, bench-batch) still collapsing.
   ⚠️ A partial fix that is not disclosed is the failure class this whole module exists to
   prevent. If this option is taken, the residual case must be named in the CHANGELOG and pinned
   by a test asserting the *known-wrong* behaviour, so it cannot rot into a silent surprise.
3. **Defer** — ship Tasks 1–3, file M3/M4 in BACKLOG with the §0.7 table, and give the dead-seat
   path its own PR.

**Recommendation was option 3, and it was taken.** Tasks 1–3 are a coherent, reviewable,
renderer-only slice that closes the defect the upstream handoff was written for. M3/M4 are a
different identity problem (degrade-record vocabulary) with a genuinely different blast radius,
and PR5a's history is specifically that mixing a restructure into a defect PR is what produced
the multi-round council climb. This is not category-based deferral — the per-item benefit test
fails: doing M3/M4 now makes Tasks 1–3 neither better, safer, nor cheaper, and it drags a
producer change and a council fixture rewrite into an otherwise `src/`-free PR.

⚠️ Recorded against the ruling: M4 is a **silent data-loss** defect, which this project's product
principle treats as severely as a crash. Option 2 remains rejected on its own terms — a partial
fix leaves a silent erasure in place on one emitter while appearing to close the class.

**What the follow-up PR must not lose:**
- `data.seat` stays the **alias**. `run-retry-notes.js:39-45` explains why (`verdict.js:72`
  compares it against `o.critic`). Add a key; never repurpose that one.
- `workspace-seats.js:47`'s docblock claims `retriedAliases` mirrors `deadSeats`' predicate
  "EXACTLY, and must keep mirroring it". **Task 2 changes one side of that mirror and renames the
  function to `retriedSeats`.** The follow-up PR changes the other side and must re-read that
  comment first — a mirror that stops mirroring is exactly the two-spellings defect council-1's
  B1 raised against PR5a.

---

## Self-Review

**Spec coverage.** M1/M2 → Tasks 1+3. M5 → Task 2 (still gated on measuring it end-to-end first).
M3/M4 → Task 4, explicitly deferred by ruling rather than silently dropped. §0.5's live path is
out of scope, and that exclusion was re-measured in revision 2 rather than argued.

**Placeholder scan.** Task 4 contains no implementation steps by design — it is a decision record,
not a task, and is labelled as such. Rev 1's one real placeholder (Task 3's un-bootstrappable test)
is fixed: F8. Task 2 Step 1 remains conditional on a measurement, which is deliberate — writing
assertions against an unmeasured property is failure mode #8 and the single most common way these
plans have been wrong. Revision 2 proves the point: measuring §0.4 changed what the defect *is*.

**Type consistency.** `seatsFromRunStats` produces `{id, seat, …}`; Task 2's lookup consumes
`seat`. `retriedAliases` → `retriedSeats` is renamed at its definition (`:57`) and its invocation
(`:94`); the lookup at `:117` changes its *key expression*, not the function name.
`renderSeats`'s `String(seat.id || seat.model)` is unchanged and needs no edit.

**Task ordering.** 1 → 2 → 3, and **1+2 are one shippable unit** (§0.4.1). Rev 1 had this wrong.

**Known gaps in THIS revision, stated rather than hidden:**
- Task 2's test sketch guesses at `makeFakeDom()`'s `window.AmicusApp` shape. I read the helper's
  exports but **not** its internals; the step says so and tells the implementer to match the real
  fixture. This is the most likely place revision 3 finds a defect.
- §0.4 was corrected by *reading* `:117`, not by running it. Task 2 Step 1 exists to close that.
- The two F37 guards are named and their breakage predicted, but I have **not** executed the
  JSON-key change to confirm nothing else fails. Task 1 Step 6 is the check.
- One refutation round, self-run. Every predecessor in this series needed four, and a self-run
  round shares the blind spots of the author — this is weaker evidence than an adjudicated
  council, and should not be read as equivalent.
