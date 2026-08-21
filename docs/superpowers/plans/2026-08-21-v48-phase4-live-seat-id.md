# v4.8 Phase 4 — R5, seat id on the live leg row

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Carry a leg's seat id from the Stage-1 roster down to the live leg row, so
`electron/workspace-ui/live-dead-seats.js:207`'s `if (s.seat)` arm — today permanently dead on the
live path — actually executes.

**Architecture:** Seat identity already exists at launch (`run-stage1-launch.js`'s
`seated[].roster`) and already survives to the terminal path (`run-assemble.js` cost rows →
`seatsFromRunStats`). What is missing is the LIVE path. This plan threads the roster through the
existing transport as an index-parallel `seats[]`, stamps `leg.seat` at the attribution seam that
already exists for `councilRunId`/`tag`, persists it via the `writeLegPatch` call that already runs
once per attempt, and reads it back out through `buildLegRow` → `seatOf`. Six hops, every one an
existing seam; no new module, no new file.

**Tech Stack:** Node.js (CommonJS), Jest, ES5 IIFE renderer modules, JSON Schema 2020-12.

**Spec:** `docs/superpowers/plans/2026-08-16-v48-phasing-and-rulings.md` §5 "Phase 4 · R5 — 1 PR",
and `BACKLOG.md :: NEXT TASK — Phase 4: R5, seat id on the live leg row`.

---

## 0. Measured substrate — 2026-08-21 at `1832b9c7`

Everything in this section was re-derived at plan-writing time by opening the line or running the
command. Nothing is carried forward from the phasing doc, from `BACKLOG.md`, or from the previous
controller. Where a carried claim turned out to be wrong, §0.5 says so.

### 0.1 Gates — all seven measured at BASE, each with its own exit code

`npm run lint` · `check:secrets` · `check:sizes` · `check:citations` · `check:tarball` ·
`validate-docs` — **all EXIT=0**. `npm test` — **EXIT=0**, and the log contains **exactly one**
`Test Suites:` block (`grep -c` = 1, so the tail is the final block, not a mid-run one):

```
Test Suites: 542 passed, 542 total
Tests:       8 skipped, 7797 passed, 7805 total
Snapshots:   4 passed, 4 total
Time:        208.499 s
```

### 0.2 Sizes (authoritative rule: `content.split('\n').length`, −1 if it ends with `\n`)

| file | lines | headroom to 300 |
|---|---:|---:|
| `src/sidecar/fanout.js` | **294** | **6** |
| `src/council/run-launch.js` | 244 | 56 |
| `src/observe/council-legs.js` | 240 | 60 |
| `electron/workspace-ui/live-dead-seats.js` | 226 | 74 |
| `src/sidecar/fanout-leg.js` | 217 | 83 |
| `src/workspace/live-normalize.js` | 170 | 130 |
| `src/council/run-stage1-launch.js` | 111 | 189 |
| `src/sidecar/fanout-wave-io.js` | 87 | 213 |

⚠️ **`fanout.js` at 294 is the single hardest constraint in this plan and it drives the design.**
The gate (`scripts/check-file-sizes.js`, `CONFIG.maxLines: 300`, `include: ['src/**/*.js',
'electron/**/*.js']`) does not exclude this file. **The stamp must NOT live in `fanout.js`.** It
lives in `stampLegAttribution` (`fanout-wave-io.js`, 87 lines), which `fanout.js:120` already
calls — so `fanout.js` gains **zero lines**.

### 0.3 The dead arm, reproduced at BASE

`deadSeats` has **two** call sites, and the arm's liveness differs between them:

- `electron/workspace-ui/workspace-seats.js:197` — **TERMINAL.** Its `seats` comes from
  `workspace-seats.js:116`, `seatsFromRunStats(d.derived.cost.rows)`. `live-seats.js:98` emits
  `seat: r.seat || null`. **`.seat` IS set here** (non-null exactly when the bench repeats an
  alias). The arm is LIVE on this path.
- `electron/workspace-ui/workspace-seats.js:273` — **LIVE TICK.** Its `live.seats` comes from
  `normalizeLive` → `seatOf` (`src/workspace/live-normalize.js:35`), whose returned object literal
  has keys `id, model, modelInput, role, status, stage, messages, tokensIn, tokensOut,
  costDisplay, lastActivity, latestPreview, stalled` — **no `seat` key, verified by opening
  lines 35–68.** Upstream, `buildLegRow` (`src/observe/council-legs.js:127-130`) builds
  `{taskId, model, status, modelInput, role}` plus progress/usage fields — **no `seat`, verified by
  opening lines 127–130.**

**Therefore `if (s.seat)` at `live-dead-seats.js:207` is unreachable on the live-tick path and
reachable on the terminal path.** The BACKLOG's wording ("permanently dead on the live path") is
exact and re-verifies. **The task is unchanged.** The in-file comment at
`live-dead-seats.js:204-206` states the same mechanism and is TRUE at BASE — which is precisely
why it becomes FALSE when this plan lands (see §0.6).

### 0.4 The threading chain, measured hop by hop

| # | site | at BASE | change |
|---|---|---|---|
| 1 | `run-stage1-launch.js:47`, `:60-61`, `:69-70` | `seated[i].roster` exists, index-parallel with `seated[i].models` | add `seats:` to each of the 3 launch objects |
| 2 | `run-launch.js :: launchWave` (`:84`) | forwards ~30 named keys into `fanoutFn({...})` | forward `seats: opts.seats` |
| 2b | `run-launch.js :: launchSolo` (`:174`) | `launchWave({ ...opts, models: [opts.model] })` | **no change — `seats` rides the spread free** |
| 3 | `fanout.js:120` | `stampLegAttribution(legs, options)` already called | **no change — zero lines added to a 294-line file** |
| 4 | `fanout-wave-io.js :: stampLegAttribution` (`:80-85`) | stamps `councilRunId`/`councilName`/`tag` | stamp `l.seat` index-parallel, **emit-when-DIFFERENT** (§0.7) |
| 5 | `fanout.js:258` | `runLeg({ leg, ... })` passes the whole leg object | **no change — `.seat` rides free** |
| 6 | `fanout-leg.js:101` | `writeLegPatch(legDir, { parentWave, modelInput })` | add `seat: leg.seat` |
| 7 | `council-legs.js:127-130` | row literal | add `seat: meta.seat \|\| null` |
| 8 | `live-normalize.js:35` `seatOf` | object literal | add `seat: leg.seat \|\| null` |
| 9 | `schemas/council-run-live.schema.json:37-49` | leg-row `properties` | declare `seat` |

**Four measured facts that make this cheap, each verified by opening the line:**

1. **The fallback path is FREE.** `fanout-leg-fallback.js:160` is
   `const runOnce = deps.runOnce || ((a) => require('./fanout-leg').runSingleAttempt(a, deps));`
   — the fallback loop calls `runSingleAttempt`, the same function that owns the `writeLegPatch` at
   `fanout-leg.js:101`. **Hop 6 is ONE edit site covering BOTH paths**, not two.
2. **`writeLegPatch` already gives absent-not-null for free.** `fanout-leg.js:29` is
   `Object.entries(patch).filter(([, v]) => v !== undefined)`. A leg with no seat contributes
   `seat: undefined`, which is filtered out — so a unique-alias bench writes a **byte-identical**
   `metadata.json`. No guard to add.
3. **`validateFanoutModels` preserves index and length.** `fanout-validate.js:66-87`:
   `const legs = []` then `for (const modelInput of raw)` pushing **exactly once per model** on
   both branches (`:72` resolved, `:85` unroutable) with no `continue` preceding a push. So
   `legs[i]` ↔ `raw[i]` ↔ `options.models.split(',')[i]`. **A leg that fails to route still holds
   its slot**, which is what keeps the seat alignment true for a partially-routable bench.
4. **The schema accepts it already, and the house pattern is to declare it anyway.**
   `council-run-live.schema.json:56` is `"additionalProperties": true`, and the leg-row `items`
   object (`:34-51`) declares no `additionalProperties` at all (defaults to true). So `seat` is
   accepted without any schema edit. **But `council-tally.schema.json:43` is the precedent set by
   this very release (v4.8 T3.3)**: it declares a `seat` property whose description says outright
   that no `additionalProperties: false` means the field was always valid and the declaration
   "documents the shape rather than changing what is accepted." Phase 4 follows that pattern.

### 0.5 ⚠️ A carried citation that is WRONG — `:: runLeg` names the wrong function

Both the phasing doc (§5, Phase 4) and `BACKLOG.md`'s NEXT TASK entry say:

> extend `writeLegPatch` (`src/sidecar/fanout-leg.js :: runLeg`)

**Measured: `runLeg` does not contain a `writeLegPatch` call.** Function boundaries in
`src/sidecar/fanout-leg.js` (`grep -n '^async function\|^function'`):

```
 19  function legStatusFromResult(result)
 25  function writeLegPatch(legDir, patch)
 53  function buildRoutingFailureLeg({...})
 77  async function runSingleAttempt({...})     <-- contains :101 and :175
205  async function runLeg(args)                <-- 6-line dispatcher, no writeLegPatch
```

`runLeg` (`:205-212`) is a dispatcher: it branches to `runLegWithFallback` or awaits
`runSingleAttempt`, then calls `recordAttemptSpend`. **The `writeLegPatch` calls at `:101` and
`:175` are both inside `runSingleAttempt`.** The docblock at `:68-70` explains why — the body was
extracted out of the pre-fallback `runLeg` ("Faithful extraction of the pre-fallback `runLeg`
body"), and the symbol anchor was never re-pointed after that extraction.

This is the release's recurring citation-rot class. **T4.6 corrects both carriers.** It is recorded
here rather than silently fixed so the correction itself is auditable.

⚠️ **Do NOT let this correction falsify its neighbours** (failure mode #10). The phrase
`fanout-leg.js :: runLeg` must be swept repo-wide, case-insensitively, before any edit.

### 0.6 ⚠️ What this change FALSIFIES — the record risk, named up front

This plan makes a true sentence false **by design**. That is the most expensive recurring defect in
this project, so the sites are enumerated now, not discovered later.

- **`live-dead-seats.js:204-206`** — *"a bare insert would write the STRING key 'undefined' on the
  live-tick path, whose payload carries no seat identity at all (live-normalize.js seatOf emits a
  per-LEG taskId)."* **This becomes FALSE at T4.5.** The live-tick payload WILL carry seat identity.
  ⚠️ The guard itself stays — `s.seat` is still null for a unique-alias bench, so the `if` is still
  load-bearing. **Only the JUSTIFICATION changes, and it must be rewritten to say why the guard
  survives, not deleted.** A deleted guard here re-arms the string-key bug.
- **`live-seats.js:88-90`** — describes `r.seat` as emit-when-set *upstream from
  `run-assemble.js:89`*. Still true (that is the terminal path) but now only half the story.
  **Re-read; edit only if it reads as an exhaustive statement.**
- **`workspace-seats.js:150`, `:160-161`, `:173-174`** — all three describe `s.seat` semantics in
  the DUAL-lookup join. `:160` says *"`s.seat` is a SEAT ID (`alias#N`, from run-assemble.js:89 via
  the cost row)"* — after T4.5 there is a second producer. `:173-174` says *"`s.seat` is null on a
  unique bench"* — **still true on both paths**, because hop 4 stamps nothing when the roster has
  no distinct seat id. **Re-read all three against the code; correct only what is actually false.**
- **`live-normalize.js:9-16`** — the header enumerates the composed doc's `legs:[{...}]` shape
  field by field. **Adding `seat` makes that enumeration incomplete.** Must be extended.
- **`council-legs.js:25`** — *"`writeLegPatch(legDir, { parentWave, modelInput })`"* — an explicit
  two-key enumeration that T4.3 makes incomplete.

⚠️ **`council-legs.js:25` and `live-normalize.js:9-16` are the dangerous pair**: both are
enumerations in a *different file* from the one being edited, so a same-file sweep cannot find
them. **Grep the distinctive phrase repo-wide, case-insensitively.**

### 0.7 ⚠️ A DRAFT OF THIS PLAN WAS WRONG — the guard is `id !== alias`, not `id`

> **This section records a controller error caught in self-review, before dispatch.** It is written
> down rather than silently fixed, following the annotation convention of
> `docs/superpowers/plans/2026-08-21-v48-seat-resolution.md` §0.4/§0.5.

The first draft of T4.2 stamped `if (s && s.id) { l.seat = s.id; }`, and §0.4, T4.4, the schema
description and the Definition of Done all claimed on that basis that a unique-alias bench stays
byte-identical. **That was reasoning about the seat shape instead of measuring it, and it is
false.** `src/council/seats.js:67`:

```js
      id: counts.get(alias) > 1 ? `${alias}#${n}` : alias,
```

**On a unique bench `seat.id` IS the alias string** — not null, not undefined. An `if (s.id)` guard
is therefore true for *every* seat, and would have stamped an alias-valued `seat` onto every leg of
every run: the exact defect `src/council/run-assemble.js:165-169` records having already fixed once
("which emitted a seat id equal to its own alias whenever the two strings drifted … i.e. exactly
where the field carries no information").

**The correct predicate is `seat && seat.id !== seat.alias`**, stated at
`src/council/run-stats-entry.js:55-64`:

> emit-when-DIFFERENT, compared against the seat's OWN alias — never against `model`. buildSeats
> mints `alias#N` only when an alias repeats (seats.js:67), so `id !== alias` IS "the bench repeats
> this alias": the single predicate all four seat-emit producers now share, which is what stops
> them disagreeing.

**The four existing producers** are `run-assemble.js:158` (`meta.seats`, via `.some(...)`), `:170`
(`adjudications[].seat`), `:189` (`rankings[].seat`), and `run-stats-entry.js:64` (`runStats[].seat`
— the one that feeds the terminal path's `seatsFromRunStats`). **Hop 4 makes a fifth.**

⚠️ **There is no exported helper to reuse.** `run-stats-entry.js` exports only
`buildRunStatsEntry` and is **deliberately `require`-free** (`:12-18`, pinned by
`tests/council/run-stats-entry.test.js` :: P3, which greps this file's raw text for `require(`).
All four existing copies are inline spreads, so a fifth inline copy **matches the established
pattern**. Extracting a shared predicate would mean touching four working sites and is **out of
scope** — **file it, do not do it here.**

⚠️ **One hazard from `:59-63` that does NOT apply to hop 4, stated so nobody re-derives it:** that
comment warns `model` is not the alias when a leg reports no `modelInput` (it falls back to the
resolved id) or when a `--council` preset carries a padded member. **Hop 4 is immune** — it keys on
`options.seats[i]` by INDEX and compares the roster entry's own `id` against its own `alias`,
never against `model`.

**Consequence: "null on a unique-alias bench" and "byte-identical" are now TRUE claims** throughout
this plan, because nothing is stamped there at all. They were false in the draft.

### 0.8 ⚠️ A SECOND stale citation — `run-assemble.js:89`

While verifying §0.8, `src/council/run-assemble.js:89` was opened. **It is inside
`labelClaudeReview`'s docblock and has nothing to do with seats.** It is cited as the seat-stamp
site by at least `electron/workspace-ui/live-seats.js:88-90` and
`electron/workspace-ui/workspace-seats.js:160`.

⚠️ **The MECHANISM those comments describe is correct** — "stamps it only when seat.id differs from
seat.alias, which seats.js:67 makes true exactly for a repeated alias" is exactly right, and
`seats.js:67` is exactly right. **Only the line number is rotten.** The real producer for the cost
rows those comments are about is `src/council/run-stats-entry.js :: buildRunStatsEntry`.

**T4.6 re-anchors these by SYMBOL.** ⚠️ Do not "correct" the surrounding prose — it is true. This
is a citation repair, not a truth repair, and conflating the two is how a correct edit falsifies a
true sentence.

### 0.9 Ordering — re-derived, not carried

The phasing doc §6 splits orderings into two lists. Measured at BASE:

- **"Genuinely gating (mechanical)"** contains **`R5 → any seat-keyed suppression on the live
  tick`**. R5 is this phase. So R5 *gates* downstream work; **nothing in that list gates R5.**
- **"Preference only"** contains `Phase 3 vs Phase 4 order`. **Phase 3 is merged (PR #176), so this
  preference is moot** — it cannot constrain anything now.
- Phase 5 (SI-10/SI-13) and Phase 6's independents are equally unblocked. Nothing forces them
  first, and nothing forces Phase 4 first.

**Conclusion: Phase 4 is unblocked, is the resume point `BACKLOG.md` itself names, and is the only
candidate that discharges a hard gate for later work. Proceed.** This is a preference exercised on
a measured tie, not a discovered dependency — stated plainly so the next controller need not
re-derive it.

---

## 1. Scope

**In:** hops 1–9 of §0.4; the schema declaration; the truth pass of §0.6; the citation correction
of §0.5; CHANGELOG and `docs/` updates; `BACKLOG.md` bookkeeping.

**Out:**
- Any **consumer** of the newly-live `s.seat` on the live tick. R5 exists to *enable* seat-keyed
  live suppression; **actually keying suppression on it is the downstream work R5 gates**, and it
  ships separately.
- Stage-2 / chair / debate / repair legs. Those launch through `run-stage2.js`, `run-chair.js`,
  `run-debate.js`, which do not carry a `seated[].roster`. **Stage 1 only** — the phasing doc scopes
  R5 to `run-stage1-launch.js` and this plan does not widen it.
- The `credFor`/`credSeats` A1 and B1 findings from PR #177's council. Not prerequisites; filed.
- SI-18, SI-22.x, SI-12, SI-25, SI-17 C3, the roster SOURCES lever. All independent.

---

## 2. Global Constraints

- **Size gate 300 lines**, `src/**/*.js` + `electron/**/*.js`. ⚠️ `fanout.js` is at **294**. If any
  file crosses, **EXTRACT — never shave comments.**
- ⚠️ **Never run any command that overwrites the working tree from the index or a commit** —
  `git checkout -- <path>`, `git checkout-index`, `git restore`, `git stash`. **The rule is by
  EFFECT, not spelling.** Commit before mutants; hand-revert; byte-verify with
  `git show HEAD:<path>`.
- **Preservation pins are green at HEAD by construction — prove each with a NAMED MUTANT, never
  RED-before-GREEN. Behaviour changes DO get RED-before-GREEN.**
- ⚠️ **An empty mutant red set means the property is UNPINNED. A SHRINKING red set is the same
  signature — chase it, don't record it.**
- **Verification by EXECUTION, never assertion.**
- **Never derive a corrected citation by OFFSET ARITHMETIC — open the line.** Symbol anchors,
  whole `file.js :: symbol` token on ONE physical line. A green `check:citations` is **not**
  evidence: it only checks the number is in RANGE.
- **Read every NEW sentence against the code.** Grep the distinctive PHRASE repo-wide,
  **case-insensitively**, for every sentence edited.
- `electron/workspace-ui/*.js` are **ES5 IIFE** modules — no `const`/`let`/arrow/spread in them.
  (`live-dead-seats.js` uses `var`/`function` throughout; match it.)
- `.husky/pre-push` **BLOCKS unless `.test-passed` matches HEAD** — run `npm test` **after** the
  final commit, **synchronously, in the foreground**.
- `gh` needs **`-R BourbonDog/amicus`**.

### Gates — all must exit 0 before the PR is opened

```
npm run lint && npm run check:secrets && npm run check:sizes && npm run check:citations && npm run check:tarball && npm run validate-docs && npm test
```

Run each with its **own** exit code. Do **not** pipe to `tail` and read `$?`.
⚠️ A jest log can contain TWO summary blocks — `grep -c "Test Suites:"` must read **1**.
⚠️ Known intermittent: `tests/docs-plan-refs.test.js`, ~1 red in 8 runs, cause unknown. **Capture
the full ● block verbatim before re-running.**

---

## 3. Tasks

### Task 1: T4.1 — Thread the roster into the transport

**Files:**
- Modify: `src/council/run-stage1-launch.js:47`, `:60-61`, `:69-70`
- Modify: `src/council/run-launch.js` (inside `launchWave`, `:84-155`)
- Test: `tests/council/run-stage1-launch.test.js` (or the suite that already spies `launchers`)

**Interfaces:**
- Consumes: nothing.
- Produces: `options.seats` — `Array<{id: string, alias: string, ...}> | undefined`, **index-parallel
  with `options.models`**, reaching `runFanout`. Consumed by T4.2.

- [ ] **Step 1: PROBE the index-parallelism claim before relying on it.**

⚠️ **Failure mode #8 (THE ASSERTED PROPERTY).** `run-stage1-launch.js:57-59` *asserts* that
`seats1` and `roster` stay aligned ("MUST mirror :54's `m !== o.critic` exactly"). **Do not trust
the comment — measure it.** Write a throwaway probe that, for each of the three launch shapes
(lens, seat-wave, critic-solo) and across benches including a **repeated alias, non-adjacent**
(`--models a,b,a`) and a **critic that is also a bench alias**, asserts
`seated[i].models.length === seated[i].roster.length` and `roster[k].alias === models[k]` for every
`k`. Record the result in the commit message. **If it ever fails, STOP and report — the whole plan
rests on this.**

- [ ] **Step 2: Write the failing test**

```js
test('launchStage1 forwards a seats[] index-parallel with models on every launch', async () => {
  const calls = [];
  const launchers = {
    launchWave: async (o) => { calls.push(o); return { wave: { legs: [] }, exitCode: 0 }; },
    launchSolo: async (o) => { calls.push(o); return { wave: { legs: [] }, exitCode: 0, leg: null }; },
  };
  const o = { runId: 'r1', runDir: dir, models: ['a', 'b', 'a'], critic: null, briefing: 'b', date: 'd' };
  await launchStage1({ o, launchers, addWave() {} });
  const seatWave = calls.find((c) => c.waveId === 'r1-s1');
  expect(seatWave.seats).toHaveLength(seatWave.models.length);
  expect(seatWave.seats.map((s) => s.alias)).toEqual(seatWave.models);
  // The point of the whole plan: a repeated alias yields DISTINCT seat ids.
  expect(new Set(seatWave.seats.map((s) => s.id)).size).toBe(3);
});
```

- [ ] **Step 3: Run it and confirm it FAILS**

Run: `npx jest tests/council/run-stage1-launch.test.js -t 'index-parallel' --silent`
Expected: FAIL — `seatWave.seats` is `undefined`, so `toHaveLength` throws.

- [ ] **Step 4: Implement — 3 lines in `run-stage1-launch.js`, 1 in `run-launch.js`**

In `run-stage1-launch.js`, add `seats:` to each launch object. The roster is **already computed**
on the line above each one, so reuse it rather than re-deriving:

```js
// :47-51  lens
seated.push({ waveId, models: [m], roster: seats.slice(i, i + 1) });
launches.push(launchers.launchSolo({
  ...common, model: m, waveId, seats: seated[seated.length - 1].roster,
  prompt: briefings.buildLensBriefing({ lens: o.lenses[i], briefing: o.briefing, date: o.date }),
}));
```

Apply the same `seats: seated[seated.length - 1].roster` addition to the seat wave (`:62-65`) and
the critic solo (`:71-74`).

⚠️ **`seats` must NOT go into `common`** — `common` is shared across all three launches and the
roster is **per-wave**. Putting it there would give every wave the full bench.

In `run-launch.js :: launchWave`, forward it into the `fanoutFn({...})` call, beside `councilRunId`:

```js
      // v4.8 R5: the per-wave roster, index-parallel with `models`, so
      // stampLegAttribution (fanout-wave-io.js) can name each leg's seat. Plain
      // pass-through: `undefined` for every non-council caller and for the chair/
      // debate/repair launches, whose stamp guard then no-ops.
      seats: opts.seats,
```

⚠️ `launchSolo` (`:174`) needs **no change** — `{ ...opts }` carries `seats` through. Confirm by
execution, not by reading.

- [ ] **Step 5: Run the test and confirm it PASSES**

Run: `npx jest tests/council/run-stage1-launch.test.js --silent`
Expected: PASS, whole file green.

- [ ] **Step 6: Confirm `launchSolo` really does carry it**

Run: `npx jest tests/council/run-launch.test.js --silent`
Expected: PASS. Then add an assertion that a `launchSolo` call reaches `fanoutFn` with `seats`
set, and re-run. **Execution, not assertion.**

- [ ] **Step 7: Size gate + commit**

```bash
npm run check:sizes
git add src/council/run-stage1-launch.js src/council/run-launch.js tests/council/
git commit -m "feat(council): forward the per-wave seat roster into the fanout transport (v4.8 R5 T4.1)"
```

---

### Task 2: T4.2 — Stamp `leg.seat` at the attribution seam

**Files:**
- Modify: `src/sidecar/fanout-wave-io.js:80-85` (`stampLegAttribution`)
- Test: `tests/sidecar/fanout-wave-io.test.js`

**Interfaces:**
- Consumes: `options.seats` from T4.1.
- Produces: `leg.seat` — `string | undefined` on each element of `legs`. Consumed by T4.3.

- [ ] **Step 1: Write the failing test**

⚠️ **Every fixture carries BOTH `id` and `alias`** — the predicate compares them (§0.7). A fixture
with only `id` would make `id !== undefined` trivially true and the test would pass against the
broken guard.

```js
describe('stampLegAttribution — seat (v4.8 R5)', () => {
  // A twin bench: buildSeats mints `a#1`/`a#2` because the alias repeats (seats.js:67).
  const TWIN = [{ id: 'a#1', alias: 'a' }, { id: 'b', alias: 'b' }, { id: 'a#2', alias: 'a' }];

  test('stamps the seat id on a repeated alias, and NOT on a unique one', () => {
    const legs = [{ modelInput: 'a' }, { modelInput: 'b' }, { modelInput: 'a' }];
    stampLegAttribution(legs, { seats: TWIN });
    expect(legs[0].seat).toBe('a#1');
    expect(legs[2].seat).toBe('a#2');
    // `b` is unique, so buildSeats set id === alias and there is nothing to say.
    expect('seat' in legs[1]).toBe(false);
  });

  test('a fully unique bench stamps NOTHING — byte-identical to pre-R5', () => {
    const legs = [{ modelInput: 'a' }, { modelInput: 'b' }];
    stampLegAttribution(legs, { seats: [{ id: 'a', alias: 'a' }, { id: 'b', alias: 'b' }] });
    expect(legs.some((l) => 'seat' in l)).toBe(false);
  });

  test('stamps NOTHING when no seats ride the options — absent, not null', () => {
    const legs = [{ modelInput: 'a' }];
    stampLegAttribution(legs, {});
    expect('seat' in legs[0]).toBe(false);
  });

  test('a leg with no matching roster entry gets no seat key', () => {
    const legs = [{ modelInput: 'a' }, { modelInput: 'b' }];
    stampLegAttribution(legs, { seats: [{ id: 'a#1', alias: 'a' }] });
    expect(legs[0].seat).toBe('a#1');
    expect('seat' in legs[1]).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and confirm test 1 FAILS**

Run: `npx jest tests/sidecar/fanout-wave-io.test.js -t 'seat (v4.8 R5)' --silent`
Expected: FAIL on test 1 (`legs[0].seat` is `undefined`). Tests 2–4 pass **vacuously** at HEAD —
that is expected and is exactly why they are written now: they are the preservation pins that must
still hold after Step 3, and Step 5's mutant is what actually proves them.

- [ ] **Step 3: Implement**

```js
  // v4.8 R5: seat identity for the LIVE path. `options.seats` is the launching
  // wave's roster, index-parallel with `options.models` by construction
  // (run-stage1-launch.js builds `roster` and `models` from the same filter, and
  // fanout-validate.js:66-87 pushes exactly one leg per model on BOTH its ok and
  // its unroutable branch, so a leg that never routed still holds its slot).
  //
  // ⚠️ emit-when-DIFFERENT, against the seat's OWN alias — the shared predicate
  // stated at run-stats-entry.js :: buildRunStatsEntry, which the three sites in
  // run-assemble.js also spell. buildSeats mints `alias#N` ONLY when an alias
  // repeats (seats.js:67), so `id !== alias` IS "the bench repeats this alias",
  // and on a unique bench `id` IS the alias — a bare `if (s.id)` would stamp an
  // alias-valued seat onto every leg of every run, the exact defect
  // run-assemble.js:165-169 records having already fixed once.
  // Comparing against the seat's own alias and never against `model` also makes
  // this immune to the two cases where `model` is NOT the alias (a leg reporting
  // no modelInput; a padded --council member).
  if (Array.isArray(options.seats)) {
    legs.forEach((l, i) => {
      const s = options.seats[i];
      if (s && s.id !== s.alias) { l.seat = s.id; }
    });
  }
```

- [ ] **Step 4: Run and confirm all four PASS**

Run: `npx jest tests/sidecar/fanout-wave-io.test.js --silent`
Expected: PASS, whole file green.

- [ ] **Step 5: Named mutant `SEATALIAS` — the predicate pin**

Preservation pins are green at HEAD by construction, so RED-before-GREEN proves nothing for them.
This mutant is **the draft bug of §0.7**, so it is the one that matters most. Apply by hand, run,
record the red set, then **hand-revert** (⚠️ never `git checkout`):

```js
// MUTANT SEATALIAS: compare on truthiness instead of difference — stamps every seat.
if (s && s.id) { l.seat = s.id; }
```

Expected: reds **"a fully unique bench stamps NOTHING"** and the third assertion of test 1
(`'seat' in legs[1]`). **At least two reds.** **If the red set is EMPTY, the property is UNPINNED —
stop and add the pin that catches it.** Record the exact red set in the commit message.

- [ ] **Step 6: Named mutant `SEATSLOPPY` — the index pin**

```js
// MUTANT SEATSLOPPY: drop the roster-entry guard, writing `undefined` as a present key.
legs.forEach((l, i) => { l.seat = options.seats[i] && options.seats[i].id; });
```

Expected: reds **"a leg with no matching roster entry gets no seat key"**. Record the red set;
hand-revert.

⚠️ **Two mutants, not one** — `SEATALIAS` pins *which* seats get stamped, `SEATSLOPPY` pins *what
happens off the end of the roster*. A single mutant covering both would not tell you which property
broke.

- [ ] **Step 7: Byte-verify the revert, then commit**

```bash
git diff --stat src/sidecar/fanout-wave-io.js
npm run check:sizes
git add src/sidecar/fanout-wave-io.js tests/sidecar/fanout-wave-io.test.js
git commit -m "feat(fanout): stamp the seat id onto each leg, emit-when-different (v4.8 R5 T4.2)"
```

The `git diff --stat` must show **only** the T4.2 addition before the `git add`.

---

### Task 3: T4.3 — Persist the seat to `metadata.json`

**Files:**
- Modify: `src/sidecar/fanout-leg.js:101` (inside **`runSingleAttempt`**, ⚠️ **not** `runLeg` — see §0.5)
- Modify: `src/observe/council-legs.js:25` (the docblock enumeration this falsifies — see §0.6)
- Test: `tests/sidecar/fanout-leg.test.js`

**Interfaces:**
- Consumes: `leg.seat` from T4.2.
- Produces: `metadata.json`'s `seat` key. Consumed by T4.4.

- [ ] **Step 1: Write the failing test**

```js
test('runSingleAttempt writes the leg seat into metadata.json (v4.8 R5)', async () => {
  const doc = await runSingleAttempt(argsFor({ leg: { model: 'm', modelInput: 'a', seat: 'a#2' } }));
  const meta = JSON.parse(fs.readFileSync(path.join(legDirOf(doc), 'metadata.json'), 'utf-8'));
  expect(meta.seat).toBe('a#2');
});

test('a seatless leg leaves metadata.json without a seat key at all', async () => {
  const doc = await runSingleAttempt(argsFor({ leg: { model: 'm', modelInput: 'a' } }));
  const meta = JSON.parse(fs.readFileSync(path.join(legDirOf(doc), 'metadata.json'), 'utf-8'));
  expect('seat' in meta).toBe(false);
});
```

⚠️ Match the existing harness in that file for `argsFor`/`legDirOf` — **read the suite first** and
reuse its helpers rather than inventing new ones.

- [ ] **Step 2: Run and confirm test 1 FAILS**

Run: `npx jest tests/sidecar/fanout-leg.test.js -t 'v4.8 R5' --silent`
Expected: test 1 FAILS (`meta.seat` undefined); test 2 passes vacuously (the preservation pin,
proved by Step 6's mutant).

- [ ] **Step 3: Implement — one key**

```js
    writeLegPatch(legDir, { parentWave: waveId, modelInput: leg.modelInput, seat: leg.seat });
```

⚠️ **No guard needed and none should be added.** `writeLegPatch:29` already filters `undefined`.
Adding `...(leg.seat ? {seat: leg.seat} : {})` would be a second, redundant guard on the same
property — and a reader would then have to check both to know the behaviour.

- [ ] **Step 4: Run and confirm BOTH pass, plus the fallback path**

Run: `npx jest tests/sidecar/fanout-leg.test.js tests/sidecar/fanout-leg-fallback.test.js --silent`
Expected: PASS. **The fallback suite is the point** — `fanout-leg-fallback.js:160` routes through
`runSingleAttempt`, so the seat must appear on a fallback-substituted leg too **without a second
edit**. If it does not, that premise from §0.4 fact 1 is wrong — **stop and re-measure.**

- [ ] **Step 5: Fix the enumeration this falsifies (§0.6)**

`src/observe/council-legs.js:25` reads `writeLegPatch(legDir, { parentWave, modelInput })` — now
incomplete. Before editing, sweep for twins:

```bash
grep -rniF "parentWave, modelInput" --include=*.js --include=*.md . | grep -v node_modules
```

Correct **every** hit, then re-run the grep and confirm it returns only corrected sites.

- [ ] **Step 6: Named mutant `SEATDROP`**

```js
// MUTANT SEATDROP: revert the key.
writeLegPatch(legDir, { parentWave: waveId, modelInput: leg.modelInput });
```

Expected: reds test 1 of Step 1. Record the red set. **Hand-revert**, then
`git diff --stat src/sidecar/fanout-leg.js` to byte-verify.

- [ ] **Step 7: Commit**

```bash
npm run check:sizes && npm run check:citations
git add src/sidecar/fanout-leg.js src/observe/council-legs.js tests/sidecar/
git commit -m "feat(fanout): persist the leg seat id to metadata.json (v4.8 R5 T4.3)"
```

---

### Task 4: T4.4 — Read it back on the leg row, and declare it in the schema

**Files:**
- Modify: `src/observe/council-legs.js:127-130` (`buildLegRow`)
- Modify: `schemas/council-run-live.schema.json:37-49`
- Test: `tests/observe/council-legs.test.js`, `tests/schemas-live.test.js`

**Interfaces:**
- Consumes: `metadata.json`'s `seat` from T4.3.
- Produces: `row.seat` — `string | null` on every composed-doc leg row. Consumed by T4.5.

- [ ] **Step 1: Write the failing test**

```js
test('buildLegRow carries the seat off metadata.json (v4.8 R5)', () => {
  writeMeta(legDir, { taskId: 'w-1', status: 'running', model: 'm', modelInput: 'a', seat: 'a#2' });
  const { rows } = buildLegRows(project, ['w-1'], runCtx);
  expect(rows[0].seat).toBe('a#2');
});

test('buildLegRow reports a truthful null when metadata.json has no seat', () => {
  writeMeta(legDir, { taskId: 'w-2', status: 'running', model: 'm', modelInput: 'a' });
  const { rows } = buildLegRows(project, ['w-2'], runCtx);
  expect(rows[0].seat).toBeNull();
});
```

⚠️ **`null`, not absent, on this row** — deliberately unlike hops 4 and 6. `buildLegRow`'s existing
literal already emits truthful nulls for `model`/`modelInput` (`:123`, `:128`), and every consumer
reads `row.seat` with `||`. The absent-not-null discipline at `:161` is scoped to `usage`/
`usageError`, which are *conditionally computed*; the base literal is unconditional. **Match the
literal you are editing, not the other convention in the same file.**

- [ ] **Step 2: Run and confirm BOTH FAIL**

Run: `npx jest tests/observe/council-legs.test.js -t 'v4.8 R5' --silent`
Expected: test 1 FAILS (`undefined`), test 2 FAILS too (`undefined` is not `null`). **Both red** —
this is a behaviour change on both branches, so both get RED-before-GREEN.

- [ ] **Step 3: Implement**

```js
  const row = {
    taskId: legId, model: meta.model || null, status: meta.status || 'unknown',
    modelInput, role,
    // v4.8 R5: the leg's seat id (`alias#N`), written at launch by
    // fanout-leg.js :: runSingleAttempt. Null on a unique-alias bench, where
    // buildSeats sets id === alias and the shared emit-when-DIFFERENT predicate
    // therefore stamps nothing — the same rule run-stats-entry.js ::
    // buildRunStatsEntry applies on the terminal path.
    seat: meta.seat || null,
  };
```

- [ ] **Step 4: Run and confirm both PASS, and nothing else reds**

Run: `npx jest tests/observe/ --silent`
Expected: PASS. ⚠️ **`tests/observe/council-legs.test.js` uses `toEqual` only on nested
`usage.cost` (`:118`, `:161`), never on a whole row — measured at BASE.** If a whole-row `toEqual`
reds anyway, a suite changed since; read it before touching it.

- [ ] **Step 5: Declare the property in the schema**

Add to `council-run-live.schema.json`'s leg-row `properties`, after `role` (`:41`), modelled on
`council-tally.schema.json:43`:

```json
          "seat": { "type": ["string", "null"], "description": "v4.8 R5, optional. This leg's seat id (`alias#N`) when the bench repeats an alias, else null. Written at launch by src/sidecar/fanout-leg.js :: runSingleAttempt from the per-wave roster and read back by src/observe/council-legs.js :: buildLegRow. The leg-row `items` object declares no `additionalProperties: false`, so an additive field was already accepted here — this documents the shape rather than changing what is accepted. A unique-alias run emits null on every leg and its document is byte-identical to a pre-R5 one." },
```

- [ ] **Step 6: Run the schema suite**

Run: `npx jest tests/schemas-live.test.js --silent`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
npm run check:sizes && npm run check:citations
git add src/observe/council-legs.js schemas/council-run-live.schema.json tests/
git commit -m "feat(observe): carry the leg seat id onto the live leg row (v4.8 R5 T4.4)"
```

---

### Task 5: T4.5 — Normalize it to the renderer, and make the dead arm live

**Files:**
- Modify: `src/workspace/live-normalize.js:35-68` (`seatOf`) and its header (`:9-16`)
- Modify: `electron/workspace-ui/live-dead-seats.js:204-206` (the comment this falsifies)
- Test: `tests/workspace/live-normalize.test.js`, `tests/workspace/dead-seat-rows.test.js`

**Interfaces:**
- Consumes: `row.seat` from T4.4.
- Produces: `seat.seat` on every live-tick seat — the field `live-dead-seats.js:207` reads.

- [ ] **Step 1: Write the failing tests — INCLUDING the end-to-end one that is the point**

```js
test('seatOf carries the leg seat (v4.8 R5)', () => {
  expect(seatOf({ taskId: 't1', model: 'm', modelInput: 'a', seat: 'a#2' }).seat).toBe('a#2');
  expect(seatOf({ taskId: 't2', model: 'm', modelInput: 'a' }).seat).toBeNull();
});
```

⚠️ **This fixture was corrected mid-flight (controller ruling PF-4) after the first one was traced
and found to be green at HEAD.** The arm only ever ADDS keys to `reviewing`, so it can only ever
SUPPRESS. A test whose dead candidate is keyed `a#1` while the live seat is `a#2` never touches
`reviewing['a#1']` in either world and proves nothing. **The arm changes the outcome exactly when
a dead candidate's key EQUALS a live seat's id** — a seat that died and came back.

```js
// tests/workspace/dead-seat-rows.test.js — THE POINT OF THE WHOLE PHASE.
test('a live seat suppresses its OWN revived seat id, and only that one (v4.8 R5)', () => {
  const degrades = [
    { kind: 'degrade', channel: 'dead-leg', data: { seatId: 'a#1', seat: 'a' } },
    { kind: 'degrade', channel: 'dead-leg', data: { seatId: 'a#2', seat: 'a' } },
  ];
  const liveSeats = [{ role: 'seat', model: 'm', modelInput: 'a', seat: 'a#2' }];
  const rows = deadSeats(degrades, null, liveSeats, {});
  // At HEAD the live seat carried no `.seat`, so `reviewing` held only the alias
  // `a` and BOTH dead rows survived — including a#2, which is alive. With the
  // seat arm live, `reviewing['a#2']` suppresses its own row, while the genuinely
  // dead twin a#1 still survives beside it.
  expect(rows.map((r) => r.seat)).toEqual(['a#1']);
});
```

⚠️ **Both halves are load-bearing.** `['a#1']` — not `[]` and not `['a#1','a#2']`. Dropping `a#1`
would mean the alias arm had over-suppressed; keeping `a#2` would mean the seat arm never fired.

- [ ] **Step 2: Run and confirm they FAIL**

Run: `npx jest tests/workspace/live-normalize.test.js tests/workspace/dead-seat-rows.test.js -t 'v4.8 R5' --silent`
Expected: both FAIL. ⚠️ **The dead-seat-rows test must fail for the RIGHT reason** — the received
value must be **`['a#1', 'a#2']`** (the revived seat not yet suppressed). Any other failure means
the fixture is wrong, not the code: `[]` would mean over-suppression, and a shape error means the
`add()` dedup rejected the second candidate. **If you see anything but `['a#1','a#2']`, STOP and
report — do not adjust the expectation to match what you got.**

- [ ] **Step 3: Implement `seatOf`**

```js
    role: leg.role || null,
    // ⚠️ v4.8 R5: the leg's seat id, and the reason live-dead-seats.js:207's
    // `if (s.seat)` arm is reachable at all. Null on a unique-alias bench, so the
    // guard there stays load-bearing — see the comment at that line.
    seat: leg.seat || null,
```

- [ ] **Step 4: Extend the header enumeration (§0.6)**

`live-normalize.js:12-14` enumerates the composed doc's leg shape. Add `seat` to that list.
**Open the line and read it before editing; do not paste from here.**

- [ ] **Step 5: Rewrite the now-false comment at `live-dead-seats.js:204-206` (§0.6)**

⚠️ **The guard STAYS. Only its justification changes.** `s.seat` is still null on a unique-alias
bench, so a bare insert would still write a literal string key. Replace the parenthetical that
claims the live payload carries no seat identity:

```js
      // Both spaces. The alias arm keeps legacy/alias-only candidates suppressible; the seat
      // arm is what lets a dead twin survive beside a live one. Guarded: `s.seat` is null on a
      // unique-alias bench on BOTH paths — the terminal one (run-stats-entry.js ::
      // buildRunStatsEntry) and, since v4.8 R5, the live tick (live-normalize.js :: seatOf).
      // Both spell the same emit-when-DIFFERENT predicate, `seat.id !== seat.alias`, so the two
      // producers cannot disagree. A bare insert would write a STRING key for every such seat.
```

⚠️ **This file is ES5 IIFE** — `var`/`function` only.
⚠️ **Verify every claim in the sentence you are writing by opening the code** — this replacement
text was authored at plan time and both anchors are symbol anchors precisely so they cannot rot,
but the *behaviour* claim ("null on a unique-alias bench, on both paths") is yours to re-confirm.
⚠️ **Do NOT write `run-assemble.js:89` here.** That is the stale citation §0.8 exists to retire;
re-introducing it in a new sentence is the failure mode this plan is trying to break.

- [ ] **Step 6: Run and confirm PASS**

Run: `npx jest tests/workspace/ --silent`
Expected: PASS.

- [ ] **Step 7: Named mutant `LIVESEATBLIND`**

```js
// MUTANT LIVESEATBLIND: delete seatOf's new `seat:` line entirely.
    role: leg.role || null,
```

Expected: reds the `seatOf` test **and** the suppression test of Step 1 (which should go back to
returning `['a#1','a#2']`). **Two reds.** If only one reds, the end-to-end property is unpinned —
say so and add the pin. Hand-revert; byte-verify with `git diff --stat`.

- [ ] **Step 8: Commit**

```bash
npm run check:sizes && npm run check:citations
git add src/workspace/live-normalize.js electron/workspace-ui/live-dead-seats.js tests/workspace/
git commit -m "feat(workspace): normalize the seat id onto live seats, making the dead arm live (v4.8 R5 T4.5)"
```

---

### Task 6: T4.6 — The record: truth pass, citation correction, bookkeeping

**Files:**
- Modify: `docs/superpowers/plans/2026-08-16-v48-phasing-and-rulings.md` (§5 Phase 4, §1 status table)
- Modify: `BACKLOG.md` (the NEXT TASK entry → completed; file the next resume point)
- Modify: `CHANGELOG.md`
- Modify: `docs/council.md` and/or `docs/where-things-live.md` if either enumerates the leg row
- Modify: `electron/workspace-ui/live-seats.js:88-90`, `workspace-seats.js:150/160-161/173-174` —
  **only if measured false**

- [ ] **Step 1: Correct the stale `:: runLeg` citation (§0.5) — sweep FIRST**

```bash
grep -rniF "fanout-leg.js :: runLeg" --include=*.md --include=*.js . | grep -v node_modules
```

Correct every hit to `src/sidecar/fanout-leg.js :: runSingleAttempt`. ⚠️ **Symbol anchor, whole
`file.js :: symbol` token on ONE physical line** — `check-citations.js` cannot join wrapped lines
(measured blind spot). Re-run the grep after editing and confirm zero stale hits remain.

- [ ] **Step 1b: Correct the stale `run-assemble.js:89` seat-stamp citation (§0.8)**

```bash
grep -rni "run-assemble\.js:89" --include=*.md --include=*.js . | grep -v node_modules
```

Known carriers: `electron/workspace-ui/live-seats.js:88-90` and
`electron/workspace-ui/workspace-seats.js:160`. **Open `src/council/run-assemble.js:89` first and
confirm for yourself that it is `labelClaudeReview`'s docblock** — do not take §0.8's word for it.
Re-anchor each hit by SYMBOL to `src/council/run-stats-entry.js :: buildRunStatsEntry`.

⚠️ **The surrounding prose is TRUE — do not edit it.** "stamps it only when seat.id differs from
seat.alias, which seats.js:67 makes true exactly for a repeated alias" is exactly right. This is a
citation repair, not a truth repair. Conflating the two is how a correct edit falsifies a true
sentence (failure mode #10).

⚠️ Other `run-assemble.js:NN` citations may be stale too, but **this task fixes only `:89`** — the
one it measured. Do not sweep-and-guess the rest by offset arithmetic; file them if you spot them.

- [ ] **Step 2: Re-read each §0.6 site against the code and correct only what is FALSE**

For each of `live-seats.js:88-90`, `workspace-seats.js:150`, `:160-161`, `:173-174`: open the line,
open the code it describes, and decide. **Record the verdict for each — including "still true, not
edited" — naming WHAT was verified, not just "re-verified"** (the durable lesson from T-A8: a
ledger row saying "re-verified" MUST name what it verified).

⚠️ **`:173-174` is expected to still be TRUE** (`s.seat` really is null on a unique bench, on both
paths). Do not "fix" a true sentence.

- [ ] **Step 3: Phrase-sweep every sentence edited in T4.1–T4.6**

For each edited sentence, take its most distinctive 4–6 word phrase and:

```bash
grep -rni "<phrase>" --include=*.js --include=*.md . | grep -v node_modules
```

⚠️ **Case-insensitively** — one past sweep reported "NONE" because it searched `SI-12` while the
leftovers were lowercase `si12`.

- [ ] **Step 4: CHANGELOG**

Under the v4.8.0 unreleased section, state the behaviour change **and its limit**:

```markdown
- Live council-run leg rows now carry the leg's seat id (`alias#N`) when the bench repeats an
  alias, threaded from the Stage-1 roster through the fanout transport to `metadata.json` and back
  out via the composed live doc. On a unique-alias bench every leg reports `null` and the document
  is byte-identical to before. Stage 1 only — chair, debate and repair legs launch without a
  roster and are unchanged.
```

- [ ] **Step 5: Update the phasing doc §1 status table and §5 Phase 4 entry**

⚠️ **Failure mode #10 (THE FALSIFIED RECORD).** Flipping a status-table cell has twice in this
release falsified a sentence elsewhere that read the table. **After editing the table, grep for
prose that describes it** and confirm each such sentence still holds.

- [ ] **Step 6: `BACKLOG.md` — close Phase 4, file the next resume point**

Mark the NEXT TASK entry ✅ COMPLETED. **File the successor explicitly** — Phase 5 (SI-10/SI-13)
and Phase 6's independents are both unblocked, and §0.9's ordering re-derivation should be carried
forward so the next controller does not repeat it. ⚠️ **Never tick SI-18.**

⚠️ **Do not weaken, hedge, or re-litigate the R2 disclosure** while editing nearby prose.

- [ ] **Step 7: All six non-test gates, each with its own exit code**

```bash
npm run lint; echo "lint=$?"
npm run check:secrets; echo "secrets=$?"
npm run check:sizes; echo "sizes=$?"
npm run check:citations; echo "citations=$?"
npm run check:tarball; echo "tarball=$?"
npm run validate-docs; echo "docs=$?"
```

- [ ] **Step 8: Commit, then `npm test` SYNCHRONOUSLY in the foreground**

```bash
git add -A
git commit -m "docs(v4.8): the record for R5 (v4.8 R5 T4.6)"
npm test
```

⚠️ **In this order.** `.husky/pre-push` blocks unless `.test-passed` matches HEAD exactly, and
`posttest` writes it. ⚠️ **Foreground.** A background test monitor cost an hour on one branch.
⚠️ `grep -c "Test Suites:"` on the log must read **1**.

---

## 4. Definition of done

- [ ] All seven gates exit 0, each measured with its own exit code.
- [ ] `npm test` green, **one** `Test Suites:` block, suite count >= 542 and **0 failed**.
- [ ] `live-dead-seats.js:207`'s `if (s.seat)` arm **executes on the live path**, proved by the
      end-to-end dead-twin test in T4.5, not by reading.
- [ ] A unique-alias bench is **byte-identical**: nothing is stamped (the `id !== alias` predicate
      of §0.7 is false for every seat), `metadata.json` has no `seat` key, and every live leg row
      reports `seat: null`.
- [ ] The seat-emit predicate is `seat.id !== seat.alias`, matching the four existing producers.
      **A `if (s.id)` truthiness guard anywhere in the diff is the §0.7 defect and must not ship.**
- [ ] Four named mutants — `SEATALIAS`, `SEATSLOPPY`, `SEATDROP`, `LIVESEATBLIND` — each applied,
      each red set **recorded**, each hand-reverted and byte-verified with `git diff --stat`.
      ⚠️ **An empty or shrinking red set is chased, not recorded.**
- [ ] Every §0.6 site adjudicated, each verdict naming **what** was verified.
- [ ] **Both** stale citations corrected: `:: runLeg` (§0.5) and `run-assemble.js:89` (§0.8), each
      swept case-insensitively, each re-anchored by SYMBOL, with the true prose around the second
      one left untouched.
- [ ] Filed, not fixed: extracting the now-fivefold `id !== alias` predicate into a shared helper
      (§0.7). Out of scope here — it would touch four working sites.
- [ ] `.test-passed` matches HEAD (i.e. `npm test` ran **after** the final commit).
- [ ] PR opened with `gh -R BourbonDog/amicus`. ⚠️ **No required status checks — `--auto` merges
      IMMEDIATELY.** Watch checks explicitly.
- [ ] Council verdict read from the **VERDICT COMMENT**, checking **duration and stage line
      first**: a ~26–36s run is credit exhaustion, a ~337s run can be a partial with an errored
      chair. Only a multi-minute `run complete` with `chair:complete` and real street-cred numbers
      is a real verdict. ⚠️ Collapse findings to **MECHANISMS** before acting; adjudicate each by
      measurement; **a repeated finding is not a stronger one.**
