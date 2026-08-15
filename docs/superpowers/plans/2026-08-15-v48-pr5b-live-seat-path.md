# v4.8 PR5b — the terminal seat path

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Merge base:** `ccb0551d` (PR5b extraction, [#160]). **Branch:** `v48-pr5b-seat-path`.
**Suite baseline at merge base:** `526 suites / 7414 passed / 8 skipped / 0 failed`, exit 0.
Size gate exit 0. Lint exit 0. Main CI green (run `31888547400`, after one macOS/node-24
jest-worker SIGSEGV re-ran clean — environmental, not a code fact).

**Revision 1.** Not yet refutation-tested. Every prior plan in this series took 4–5 rounds and
**every finding was against the plan, never the code**; assume this one is wrong in ways the
measurements below do not yet cover.

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

  | file | lines | free |
  |---|---|---|
  | `electron/workspace-ui/live-seats.js` | 249 | 51 |
  | `electron/workspace-ui/workspace-seats.js` | 194 | 106 |
  | `electron/workspace-ui/workspace-render.js` | **282** | **18** ← tight |
  | `src/council/run-retry-notes.js` | 105 | 195 |

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

### 0.4 M5 — the retry marker can land on the wrong row

`retriedAliases` (`workspace-seats.js:57-71`) keys on the alias, and its consumer looks rows up
via `rowsByKey[String(s.id || s.model)]` (`workspace-seats.js:99-104`) — which on duplicate keys
is last-wins. Not yet probed in isolation; **Task 3 must measure it before fixing it.**

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

| emitter | channel | carries a seat id? |
|---|---|---|
| `retryLegStillDeadNote` (`run-retry-notes.js:67`) | `dead-leg` | ✅ `data.firstFailure.seatId` |
| `missingLegStillDeadNote` (`:92`) | `dead-leg` | ✅ `data.firstFailure.seatId` |
| `srcLegStillDeadNote` (`:51`) | `dead-leg` | ❌ **no `firstFailure` at all** |
| `waveStillDeadNote` (`:28`, partial) | `seat-unbound` | ❌ alias only — and `deadSeats` filters this channel out anyway |

Evidence, measured not assumed: `run-retry.test.js:628` asserts
`units[0].firstFailures.map(f => f.seatId)` → `['deepseek#1','deepseek#2']` on a twin bench, and
`degrade-channels.test.js:126` shows `firstFailure: {…, seatId: 'beta'}` inside a **shipped**
degrade record.

⚠️ `data.seat` itself stays the **alias**, deliberately — `run-retry-notes.js:39-45` explains
that `verdict.js:72` compares it against `o.critic`, which is an alias. **Do not re-point
`data.seat` at the seat id.** Add a key; never repurpose that one.

---

## File Structure

| file | change |
|---|---|
| `electron/workspace-ui/live-seats.js` | modify `seatsFromRunStats` (id + carry `seat`), `deadSeats` (seat-keyed dedup + suppression) |
| `electron/workspace-ui/workspace-seats.js` | `retriedAliases` → seat-keyed; consumer lookup |
| `src/council/run-retry-notes.js` | `srcLegStillDeadNote` gains `seatId` (Task 4 only) |
| `tests/workspace/seat-panel-twins.test.js` | **new** — the twin-bench pins, all multi-tick |
| `tests/council/degrade-channels.test.js` | update the exact `toEqual` shapes (Task 4 only) |

`workspace-render.js` is **read but not modified** — its `String(seat.id || seat.model)` keying is
already correct once `seat.id` is correct. That is the whole reason this PR is small.

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

Create `tests/workspace/seat-panel-twins.test.js`. Copy the `makeFakeDoc()` harness from
`tests/workspace/workspace-render.test.js:20-141` verbatim — it is the established pattern and
adds no dependency.

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

  // The F37 pin this id expression originally existed for — a --debate run emits extra
  // runStats rows for the SAME alias with role rebuttal/revote. Must still not collide.
  test('F37 preserved: debate roles do not collide with the seat row', () => {
    const ids = LS.seatsFromRunStats([
      { model: 'a', role: 'seat' }, { model: 'a', role: 'rebuttal' }, { model: 'a', role: 'revote' },
    ]).map(r => r.id);
    expect(new Set(ids).size).toBe(3);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx jest tests/workspace/seat-panel-twins.test.js
```

Expected: the first two tests FAIL (`new Set(ids).size` is `1`, not `2`; `r.seat` is `undefined`,
not the seat id). The two controls PASS — they are preservation pins and are green at HEAD by
construction. **Do not treat their passing as progress.**

- [ ] **Step 3: Implement**

In `electron/workspace-ui/live-seats.js`, replace the `id:` line and add `seat:`:

```js
      // ⚠️ DE-ROT (F37) + v4.8 PR5b: the composite id is over the SEAT, not the alias. A
      // --debate run emits extra runStats rows for the same alias (role 'rebuttal'/'revote',
      // src/council/debate.js:88-96) — that is what the role half kills. PR1 then made a bench
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

- [ ] **Step 5: Apply the named mutant and measure RED**

Revert the id expression to `(r.model) + ':' + (r.role || 'seat')` in the real file. Re-run.
Expected: the two twin tests go RED. Restore byte-identically (`git diff` must be empty for the
mutant line). A pin that does not go red here is not pinning anything.

- [ ] **Step 6: Run every suite that touches this function**

```bash
npx jest tests/workspace/
```

Expected: PASS. `workspace-seats.test.js`, `dead-seat-rows.test.js`, `live-loop.test.js`,
`blind-flip.test.js` and `workspace-app-boundary.test.js` all exercise `renderSeats`; any of them
asserting a literal `'a:seat'` key needs its expectation moved to the JSON spelling. **If one
asserts a key it did not construct, that is a finding — record it, do not silently edit it.**

- [ ] **Step 7: Commit**

```bash
git add electron/workspace-ui/live-seats.js tests/workspace/seat-panel-twins.test.js
git commit -m "v4.8 PR5b T1: key terminal seat rows on the seat, not the alias"
```

---

## Task 2: Multi-tick proof that the frozen row is gone

Task 1 fixed the *id*. This task proves the *symptom* is gone, at the DOM level. It is a separate
task because a reviewer could reasonably accept Task 1's unit change and still reject this — the
id being distinct does not, by itself, prove `renderSeats` behaves.

**Files:**
- Modify: `tests/workspace/seat-panel-twins.test.js`
- Read only: `electron/workspace-ui/workspace-render.js:179-233`

**Interfaces:**
- Consumes: Task 1's `seatsFromRunStats` output; `window.AmicusRender.renderSeats(tbody, seats,
  blindOn, labelOf)`.

- [ ] **Step 1: Write the failing test**

Append to `tests/workspace/seat-panel-twins.test.js`. **Two ticks minimum** — §0.1 proves a
single-tick test cannot see this defect.

```js
describe('T2 — the frozen row, at the DOM', () => {
  let R, doc;
  beforeEach(() => {
    global.window = { AmicusLive: require('../../electron/workspace-ui/live-model') };
    global.document = doc = makeFakeDoc();          // harness copied in Task 1 Step 1
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

- [ ] **Step 2: Confirm it fails at HEAD-minus-Task-1**

```bash
git stash push electron/workspace-ui/live-seats.js
npx jest tests/workspace/seat-panel-twins.test.js -t 'keep updating'
git stash pop
```

Expected while stashed: FAIL with received `[['ok','$0.01'],['DONE-2','$0.22']]` — the exact
frozen-row signature from §0.1. This is the step that proves the test is pinned to the real
defect and not to an artefact of the harness.

- [ ] **Step 3: Run it with Task 1 applied**

```bash
npx jest tests/workspace/seat-panel-twins.test.js
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/workspace/seat-panel-twins.test.js
git commit -m "v4.8 PR5b T2: pin the frozen-row symptom across two ticks"
```

---

## Task 3: Seat-keyed retry markers

Kills M5 (§0.4). **Measure before fixing** — §0.4 is the one defect in this plan that is reasoned
from the code rather than probed, and this plan's whole failure history is plans being wrong.

**Files:**
- Modify: `electron/workspace-ui/workspace-seats.js:57-71` (`retriedAliases`), `:94-104` (consumer)
- Test: `tests/workspace/seat-panel-twins.test.js`

**Interfaces:**
- Consumes: `run.degrades[]`; Task 1's `seat` field on each seat row.
- Produces: `retriedSeats(degrades)` → a null-prototype object keyed by **seat id when known,
  alias otherwise**. Renamed from `retriedAliases`; update both call sites (`:94` and the
  `seats.forEach` join at `:103-104`).

- [ ] **Step 1: Measure the current behaviour**

Write a throwaway probe asserting what HEAD does when one twin was retried and the other was not.
Record the measured output **in the commit message**. If it turns out HEAD is already correct,
**delete this task and say so** — do not implement a fix for a defect that does not exist.

- [ ] **Step 2: Write the failing test** (only if Step 1 confirmed the defect)

```js
test('T3 — the retry marker lands on the retried seat only', () => {
  const degrades = [{ kind: 'degrade', channel: 'dead-leg',
    data: { seat: 'deepseek', retryWaveId: 'w1',
      firstFailure: { seat: 'deepseek', seatId: 'deepseek#2', class: 'leg' } } }];
  const marked = WS.retriedSeats(degrades);
  expect(marked['deepseek#2']).toBe(true);
  expect(marked['deepseek#1']).toBeUndefined();
});

test('T3 control — a distinct-alias bench still marks by alias', () => {
  const marked = WS.retriedSeats([{ kind: 'degrade', channel: 'dead-leg',
    data: { seat: 'a', retryWaveId: 'w1' } }]);
  expect(marked.a).toBe(true);
});
```

- [ ] **Step 3: Implement**

Key on `data.firstFailure && data.firstFailure.seatId ? data.firstFailure.seatId : data.seat`.
Keep the `kind`/`channel` filter exactly as it is — `workspace-seats.js:47-50` documents that it
is load-bearing (`kind:'heal'` records carry the same `retryWaveId` fields for seats that
**recovered**, and a field-only scan would tag a recovered seat "retried once").

⚠️ The docblock at `:47` says this function "Mirrors `window.AmicusLive.deadSeats`' own predicate
(live-seats.js:186-200) EXACTLY, and must keep mirroring it." Task 4 changes that predicate. **If
Task 4 ships, this comment and this function must move with it in the same PR** — a mirror that
stops mirroring is exactly the two-spellings defect council-1's B1 raised against PR5a.

- [ ] **Step 4: Run, mutate, restore**

```bash
npx jest tests/workspace/
```
Then revert the key expression to `data.seat`, confirm RED, restore byte-identically.

- [ ] **Step 5: Commit**

```bash
git add electron/workspace-ui/workspace-seats.js tests/workspace/seat-panel-twins.test.js
git commit -m "v4.8 PR5b T3: key retry markers on the seat when the record names one"
```

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
  "EXACTLY, and must keep mirroring it". Task 3 changes one side of that mirror. **The follow-up
  PR changes the other side and must re-read that comment first** — a mirror that stops
  mirroring is exactly the two-spellings defect council-1's B1 raised against PR5a.

---

## Self-Review

**Spec coverage.** M1/M2 → Tasks 1+2. M5 → Task 3 (gated on measuring it first). M3/M4 → Task 4,
explicitly unresolved and escalated rather than silently dropped. §0.5's live path is out of
scope and says so.

**Placeholder scan.** Task 4 contains no implementation steps by design — it is a decision
record, not a task, and is labelled as such. Task 3 Step 2 is conditional on Step 1's
measurement, which is deliberate: writing its assertions now would be asserting a property I have
not measured, which is failure mode #8 and the single most common way these plans have been
wrong.

**Type consistency.** `seatsFromRunStats` produces `{id, seat, …}`; Task 3's join consumes
`seat`. `retriedAliases` → `retriedSeats` is renamed at its definition and both call sites.
`renderSeats`'s `String(seat.id || seat.model)` is unchanged and needs no edit.

**Known gaps in this revision, stated rather than hidden:**
- §0.4 (M5) is the one defect reasoned from code, not probed. Task 3 Step 1 exists to correct that
  before any code is written.
- The `JSON.stringify` key changes the spelling of `dataset.key`. I have **not** measured how many
  existing tests assert that spelling literally; Task 1 Step 6 is where that surfaces. If it is
  more than two or three, the key format is the wrong lever and a plain separator that cannot
  appear in an alias should be reconsidered.
- No refutation round has been run against this plan. Every predecessor needed four.
