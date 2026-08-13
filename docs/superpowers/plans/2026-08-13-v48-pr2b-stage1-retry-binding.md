# v4.8 PR2b — Stage-1 + retry seat binding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flip every Stage-1 and retry consumer from alias-space to seat-space, so a bench that repeats an alias stops silently collapsing two seats into one — and so a launched seat whose leg never comes back stops vanishing entirely.

**Architecture:** `launchStage1` and the retry pass each gain an **additive** per-wave roster on their return. `bindSeats` (frozen in PR1) is then called **once per wave** over that wave's OWN legs array — never over the flattened multi-wave `legs`. The resulting `Map<leg, seat>` threads forward to `materializeReviews` (seat-id filenames), to the review rows (`roleAt`), to the retry grouping (H4's un-collapse), and to the dead-seat rows. A new `seat-unbound` degrade channel announces the two ways the leg↔seat join can fail.

**Tech Stack:** Node ≥22.12 CommonJS, jest, eslint.

**Provenance:** spec §4.4/§4.5, re-measured at `5c93ead` by a 10-agent recon plus a completeness critic; then refuted by a 6-lens adversarial pass (55 raw findings → **21 confirmed defects, all in this plan**) and adjudicated with every claim re-executed. Every line number below was read first-hand at `5c93ead`. The spec's §4.5 line numbers are ~2/3 stale and are NOT reproduced here.

---

## Global Constraints

- Hard **300 lines/file** gate (`scripts/check-file-sizes.js:18` `maxLines: 300`; the check is `adjustedCount > limit`, so 300 passes and 301 fails). `--all` measures TRACKED files only — `git add` first. Tests are not gated. **Headroom at HEAD: `seats.js` 261, `run-assemble.js` 262, `run.js` 259, `run-stages.js` 243, `run-launch.js` 225, `run-retry.js` 195, `run-retry-group.js` 113, `run-stage1-launch.js` 94, `run-retry-notes.js` 74, `run-stage1-rows.js` 65, `src/utils/degrade.js` 69.** Do not add to `seats.js` — its API is frozen and it has 39 lines of headroom.
- `src/` may cite the **spec** path, never a plan path (`tests/docs-plan-refs.test.js:10` scans `['src','docs','skills']`, `:28` matches `docs/superpowers/plans/…`). `CHANGELOG.md` and `BACKLOG.md` at the repo root are NOT scanned. **Never leave a breadcrumb pointing at this plan file inside `src/`.**
- **`no-unused-vars` is an ERROR** (`.eslintrc.js:13`, `['error', { argsIgnorePattern: '^_' }]` — the ignore pattern covers **arguments only**, a comment does not satisfy it, and `eslint --fix` cannot fix it). `.husky/pre-commit` runs `npx lint-staged --no-stash` under `set -e` over `src/**/*.js`, and `--no-verify` is forbidden. **Destructure only what the current task consumes** — see Tasks 2/3/7.
- `no-console` is an **error** in `src/council` with no override (`.eslintrc.js:16`); `npm run lint` has no `--fix` in CI. Use `ctx.degrade.note()` or `src/utils/logger.js`.
- **Only `src/council/run-degrade.js` may assign `degraded.value`** — `tests/council/degrade-invariant.test.js:19` regex-walks all of `src/` for `degraded.value =`.
- A **heal never flips `degraded.value`** and must leave the run at exit 0 (`tests/council/degrade-surface.test.js:81-83`).
- Channel ids must match `/^[a-z0-9]+(-[a-z0-9]+)*$/` (`tests/council/degrade-contract.test.js:45`). `seat-unbound` passes; `seatUnbound` and `seat_unbound` do not.
- `npm test` before `git push`. **Never `npm test -- <path>`** — single suites are `npx jest <path>`. **Never pipe a gate through `| tail`** (masks the exit code). `npx jest --listTests` must be non-empty before trusting any RED.
- Rewording a module docblock's **first line**, or reordering the **first five** names in a `module.exports = {…}`, makes `CLAUDE.md`'s AUTO markers stale and fails `tests/scripts/generate-docs-check.test.js`. The pre-commit hook self-heals it by running `generate-docs` in write mode and staging `CLAUDE.md` — so **commit through the hook**, never `--no-verify`.
- Line endings: `eol=lf`.
- **Measured baseline at `5c93ead`: 518 suites / 7132 passed / 8 skipped / 7140 total / 0 failed** (`npm test`, 208s). This was measured for this plan, not recalled.

---

## Owner rulings (2026-08-13)

1. **R-A — accept the artifact-guard skew, disclose it.** After Task 3, a twin bench writes `review-deepseek-1.md` + `review-deepseek-2.md`, while `src/workspace/artifact-guard.js:86` (`const uniqueModels = [...new Set(bench)];`) still allowlists only `review-deepseek.md`. Both verified empirically at HEAD. PR2b ships the seat-id filenames anyway: today's behaviour **loses** one twin's review (the second write clobbers the first) and misattributes the survivor; after Task 3 no data is lost, only Workspace visibility lags. CHANGELOG + a BACKLOG hard-prerequisite for PR5 are Task 9.
2. **R-B — announce AND retry unbound seats.** A launched seat whose leg never returns is invisible today: it is in neither `deadLegs0` (no leg object exists) nor `deadWaves` (the wave did produce legs). PR2b routes it into the retry pass as a first-class loss **and** announces it when the retry does not save it.
3. **The v4.6 invariant constrains how R-B is implemented.** `run-stages.js:70-71`: *"one retry BEFORE anything is recorded lost — the sink never un-flips, so a degrade for a seat the retry saves must never fire at all."* So the `seat-unbound` degrade for a **missing seat** fires only on the skipped and still-dead paths, never at bind time. An **orphan leg** is different — not a loss, not retryable — and is announced immediately.

---

## Corrections folded in (do not re-derive)

| Earlier belief | Truth at `5c93ead`, verified by execution |
|---|---|
| `preflightSeats` refuses a twin bench, so twin hazards are hypothetical | **FALSE, and it inverts the risk.** `preflightSeats({models:['deepseek','deepseek'],critic:null,lenses:null})` returns `{seats:[…#1,…#2], criticSeat:null, error:null}` — executed. It refuses only an ambiguous critic, an off-bench critic, critic+lenses, a same-resolved-id bench, and a filename collision in which a `#N` id participates. **Twins reach production through the CLI today.** |
| `seated[]` is thrown away | Half true. `seated` (`run-stage1-launch.js:31`) is read at exactly one line — `:86`, inside the dead-wave push — so a **dead** wave's roster survives as `deadWaves[].models`; a **live** wave's roster is discarded. |
| roleFor has two call sites | Two **flip** sites (`run-stages.js:223`, `run-stage1-rows.js:61`) but **three** invocations: `src/observe/council-legs.js:89` keeps the alias-space shim. `roleFor` must stay exported. Do not delete it. |
| H4's collapse is one line | **Two** in `run-retry-group.js`: `recordFailure`'s `f.seat === seat` (`:28`) and `lensIndexOf`'s `(o.models||[]).indexOf(model)` (`:13`). The lens one is reachable — the deadLegs loop calls `lensIndexOf(o, null, seat)` (`:86`), so the regex branch can never fire and twin lens seats provably share one unit today. |
| `run-retry.js` re-collapses at five more places | **Seven** in `run-retry.js` (`:110`, `:126`, `:130`, `:156`, `:170`, `:175`, `:181`) plus the two **alias** feeders at `:171`/`:172` — and once more OUTSIDE it, at **`run-stages.js:78`**'s alias-keyed `healed` Set (Task 6 Step 4c). |
| The retry dispatch is symmetric | It is not. `:93` launches a bench unit with `models: unit.models.slice()` (H4 ⇒ two paid legs; `fanout-validate.js:24`'s `parseModelsList` does **not** dedup), while `:94` launches critic/lens with `model: unit.models[0]`. Task 6 fixes the lens collapse at its source so each lens twin gets its own unit. |
| Adding a channel touches the schemas | It does not — verified across all three: `council-run`, `doctor`, `council-verdict` all type `channel` as `{"type":"string"}`, no enum. No renderer switches on channel. `council-run.schema.json` has no `deadWaves` property and no `additionalProperties:false`, so Task 1's `deadWaves[].seats` and Task 7's `partial:true` ride into run.json schema-clean. |
| A forgotten channel registration fails loudly | It does **not**. `run-degrade.js:21-32` catches `makeDegrade`'s throw and rewrites it as an `internal` degrade that still flips `degraded.value`. A test asserting only `degrades.length` or `exitCode === 2` passes. **Always assert on `.channel`.** |
| Passing `unit.seats` unfiltered avoids the slot-shift a `filter(Boolean)` causes | **FALSE — they are identical.** `seats.js:131` already does `seats.filter(Boolean)`. Executed with roster `[seatA, null, seatC]` and legs slotted 1/2/3, **both** bind leg `b` to seat `c`. A `{id: null}` sentinel is worse: `bindSeats` dedups on `seat.id` (`:146`, `:150`), so two sentinels collide (`bound 1, unbound 0, orphans 1`). Pad with a **unique** id and drop placeholder binds — Task 5 Step 4. |
| `ctx._notes.filter(n => n.kind === 'degrade')` proves no degrade fired | Vacuous — always `[]`. `_notes` holds the RAW note argument (`run-stages.test.js:90`); no builder in this path sets `kind`, which is defaulted inside `makeDegrade` (`utils/degrade.js:29`), never called by the stub sink. Only the heal sets one (`run-retry.js:142`). Assert on **channels**. |
| `tests/council/run-stages.test.js` is 1009 lines | **1078** LF lines at `5c93ead` (byte-accurate, no CR). 1009 was PR2a's count. Every line the plan cites in that file re-verified correct. |
| "exactly three `runStage1` drivers in `tests/`" | Three *files*, but `degrade-channels.test.js` alone drives it **five** times (`:51`, `:83`, `:111`, `:238`, `:260`) — verified — and **three** of those build legs with neither `taskId` nor `waveId`. |

---

## The three traps that decide this PR

**1. Build the roster with the SAME predicate as the alias filter, never with `criticSeat`.**
`run-stage1-launch.js:47` is `const seats = o.models.filter(m => m !== o.critic);`. Its seat-space twin must be `seats.filter(s => s.alias !== o.critic)` — **not** `seats.filter(s => s.id !== o.criticSeat)`. Executed: on a unique bench all three agree; on `['a','crit','crit']` with critic `crit` the launch plan is `['a']`, `byAlias` is `['a']`, and `byCriticSeat` is `['a','crit']` — one longer, so **every legId slot shifts by one** and `bindSeats` (`seats.js:140`, `roster[N-1]`) mis-binds every leg. `preflightSeats` rejects that bench, but only for callers going through `run.js`; the point of `bindSeats` is to be total.

**2. Bind over `wave.legs`, never over the flattened `legs`.**
`run-stage1-launch.js:74` (`legs.push(...got)`) is where per-wave attribution is destroyed. Build each wave's entry inside the `results.forEach` at `:69-90`, where `got` and `seated[i]` coexist. A single `bindSeats` call over the concatenated array produces false orphans in fixtures (`seats.js:133` admits any leg with no `waveId`) and silent filtering in production (production legs **do** carry `waveId` — `fanout-leg.js:62`, `:193` — so the `mine` filter is real there and dead in every fixture).

**3. `bound` does not mean usable.**
`materializeReviews` rejects a leg twice after binding — `run-launch.js:193` (`leg.status !== 'complete'`) and `:195` (blank summary). The dead-seat set is `unbound ∪ deadWave.seats ∪ {bound seats materializeReviews rejected}`, not `unbound` alone.

---

## File Structure

| File | Lines @HEAD | Change |
|---|---|---|
| `src/council/stage1-bind.js` | **NEW** (~100) | Per-wave binding, the missing-seat loss record, and the `seat-unbound` note builders |
| `src/council/run-stage1-launch.js` | 94 | `seated` entries gain `roster`; additive `waves`; `deadWaves` entries gain `seats` |
| `src/council/run-stages.js` | 243 | Bind per wave, thread `seatOf`/`allSeatOf`, emit orphan notes, route missing seats, `roleAt` at `:223`, seat-key the retry-abort return at `:74-82` |
| `src/council/run-launch.js` | 225 | `materializeReviews` gains an optional `seatOf`; filename via `artifactName` |
| `src/council/run-retry-group.js` | 113 | Units gain `seats`; H4; the `partial` class in all three dead-wave branches |
| `src/council/run-retry.js` | 195 | Bind the retry wave; additive `out.seatOf`; seat-key the reconcile; lockstep `stillDeadWaves` narrowing |
| `src/council/run-retry-notes.js` | 74 | All **three** still-dead builders take the `partial`/`missing` flag |
| `src/council/run-stage1-rows.js` | 65 | Dead **seats** not dead aliases; `roleAt` at `:61` |
| `src/utils/degrade.js` | 69 | `+1` channel |
| `tests/council/stage1-bind.test.js` | **NEW** | Unit tests for the new module |
| `tests/council/run-stages.test.js` | **1078** | `makeCtx` gains seats; `okWave` gains a waveId; twin cases |
| `tests/council/run-retry.test.js` | 305 | Twin retry cases; H4 pins; four exact-match repairs |
| `tests/council/run-launch.test.js` | 203 | `buildSeats` import; seat-name cases (uses `tmp`, **not** `runDir`) |
| `tests/council/fake-launchers-ids.test.js` | 66 | The partial-return pin inverts |
| `tests/council/degrade-channels.test.js` | — | Three leg blocks stamped; one `firstFailure` pin |
| `tests/council/budget-reservation.test.js` | — | Driver gains a seat table AND a `degrade` sink |
| `tests/council/degrade-contract.test.js` | — | `+1` block |
| `CHANGELOG.md`, `BACKLOG.md` | — | Task 9 |

---

## Task 0: Make every runStage1 driver bind-capable

**Files:**
- Modify: `tests/council/run-stages.test.js` (`makeCtx` at `:57`, its `o` literal at `:70-75`; `okWave` at `:36`)
- Modify: `tests/council/degrade-channels.test.js` (`:44-47`, `:76-79`, `:104-107`)
- Modify: `tests/council/budget-reservation.test.js` (`:343-349`)
- Modify: `tests/council/helpers/fake-launchers.js` (`:14`, `:35-37`, `:101-103`)
- Modify: `tests/council/fake-launchers-ids.test.js` (`:28-50` comment, `:56-66`)
- Modify: `tests/council/seat-fixtures.test.js`

**Interfaces:**
- Produces: every `runStage1` driver supplies `o.seats` + `o.criticSeat`, waves carry a `waveId`, legs carry roster-slot ids, and every ctx has a `degrade` sink.

**Why this is Task 0:** `roleAt` returns `'seat'` for an unknown id **without throwing** (`seats.js:83-86`), and `bindSeats` returns empty sets for an empty roster. If any consumer lands before its fixture, the dead-seat assertions stay **green while completely unbound** and only the critic/lens role pins go red — which reads as a source bug.

- [ ] **Step 1: Baseline**

```bash
npx jest tests/council/run-stages.test.js tests/council/run-retry.test.js tests/council/run-launch.test.js tests/council/degrade-channels.test.js tests/council/budget-reservation.test.js tests/council/fake-launchers-ids.test.js tests/council/seat-fixtures.test.js
```

- [ ] **Step 2: `run-stages.test.js` — seats on `makeCtx`'s `o`**

`makeCtx` starts at `:57`; its `o` literal is at `:70-75`. Add to the requires:

```js
const { buildSeats } = require('../../src/council/seats');
```

Inside `makeCtx`, before the returned object literal:

```js
  // Production sets these at run.js:133-134 (asm.preflightSeats). Without them
  // every consumer under test falls through roleAt's unknown-id default and an
  // empty bindSeats roster — green for the wrong reason.
  const seats = buildSeats(models, critic, lenses);
  const criticSeat = (seats.find(s => s.alias === critic) || {}).id || null;
```

and add `seats, criticSeat,` to the `o` literal.

- [ ] **Step 3: `run-stages.test.js` — `okWave` must carry its waveId**

`:36` is `const okWave = (legs) => ({ wave: { status: 'complete', legs }, exitCode: 0 });`. Real fanout sets `wave.waveId` and `budget-reservation.test.js:334` does too; this suite is the outlier.

```js
const okWave = (legs, waveId) => ({ wave: { status: 'complete', ...(waveId ? { waveId } : {}), legs }, exitCode: 0 });
```

**No production code may read `r.wave.waveId`** — the wave id comes from `seated[i].waveId` on the launch side (Task 1). This step stops the fixture diverging from production; it is not a dependency.

- [ ] **Step 4: the bare `mkLeg` sites in `onWave`/`onSolo` callbacks**

Re-derive — do not trust a count:

```bash
grep -n "usableLeg(\|deadLeg(\|mkLeg(" tests/council/run-stages.test.js
```

Ignore everything inside `describe('runStage2')` (**PR3** — confirm its true current range with `grep -n "describe('runStage2'" tests/council/run-stages.test.js` first). For each remaining invocation inside an `onWave`/`onSolo` callback, `opts` is in scope and the callback builds one leg per roster model **in order**: stamp `waveId = opts.waveId`, `slot = <1-based index in opts.models>` (or `1` for a solo).

⚠️ **Three same-named `mkLeg` builders have incompatible 4th positionals.** `run-stages.test.js:30` and `seat-fixtures.test.js:39` are `(model, summary, status, waveId, slot)`; `helpers/fake-launchers.js:14` is `(model, summary, status, cost, waveId)`. Stamping a helper call the way you stamped a suite call lands the wave id in `cost` and the slot in `waveId`. `run-stages.test.js:46-52`'s `DEAD_LEG_STATUSES` guard catches this class for `deadLeg`; the helper has no such guard and 25 test files require it.

- [ ] **Step 5: `helpers/fake-launchers.js` — stamp the ROSTER slot, without replacement**

At `:35-37` and `:101-103` the dispatchers stamp `leg.taskId` from the **returned array's** index. That equals the roster slot only for a full, in-order return and is **wrong for a partial one** — the shape SL-2 fixtures produce.

```js
    // Stamp the ROSTER slot, not the returned-array index: a PARTIAL return
    // (fewer legs than models) is exactly the shape SL-2 fixtures produce, and
    // the returned index restarts at 0 regardless of which slot the leg stands
    // in for. Slots are consumed WITHOUT replacement, so a twin roster still
    // yields distinct ids (-1, -2) exactly as real fanout does — a plain
    // indexOf is first-match and would hand both twins slot 1.
    const remaining = (opts.models || []).slice();
    r.wave.legs.forEach((leg, i) => {
      const alias = leg.modelInput || leg.model;
      const k = remaining.indexOf(alias);
      if (k >= 0) { remaining[k] = null; }
      leg.taskId = `${opts.waveId}-${k >= 0 ? k + 1 : i + 1}`;
      leg.waveId = opts.waveId;
    });
```

`leg.waveId` is new here and deliberate: production legs carry it (`fanout-leg.js:62`, `:193`; persisted at `result-schema.js:61`) and the fakes never have, so the fixtures exercise the **opposite** `bindSeats` branch from production.

- [ ] **Step 6: `fake-launchers-ids.test.js` — one pin inverts**

That suite already pins this helper three times, and it is why Step 5 must be verified here rather than at Task 9. `:19` and `:25` drive a **twin** roster and assert `['r-s1-1','r-s1-2']` — the without-replacement assignment keeps both green (verified). Exactly one pin changes, `:56-66`, which exists to record the hazard and must now record its fix:

```js
test('PARTIAL return: the dispatcher stamps the ROSTER slot, not the returned-array index', async () => {
  // opts.models names a 2-seat roster ['gemini', 'gpt'], standing in for a retry
  // wave where only gpt (roster slot 2) lost its seat and comes back. v4.8 PR2b:
  // the dispatcher now looks the leg up in opts.models, so the taskId names gpt's
  // real roster slot and bindSeats resolves it to the right seat.
  const launchers = scriptedLaunchers({ 'r-s1': () => okWave([mkLeg('gpt', review('gpt'))]) });
  const { wave } = await launchers.launchWave({ waveId: 'r-s1', models: ['gemini', 'gpt'] });
  expect(wave.legs[0].taskId).toBe('r-s1-2'); // roster slot, NOT the returned index
});
```

Update the `:28-50` header comment in the same commit — it documents the old behaviour as current.

- [ ] **Step 7: `degrade-channels.test.js` — THREE leg blocks**

Re-derive with `grep -c "await runStage1(" tests/council/degrade-channels.test.js` (→ **5**, at `:51`, `:83`, `:111`, `:238`, `:260`) — never by counting files. **Three** build legs with neither `taskId` nor `waveId`, so from Task 2's commit every one is an orphan and both roster seats are unbound (executed: `bound 0, unbound ['alpha','beta'], orphans 2`). Stamp all three blocks (`:44-47`, `:76-79`, `:104-107`) identically:

```js
        wave: { waveId: 'r1-s1', legs: [
          { modelInput: 'alpha', status: 'complete', summary: review('alpha'),
            taskId: 'r1-s1-1', waveId: 'r1-s1' },
          { modelInput: 'beta', status: 'timeout', summary: '',
            taskId: 'r1-s1-2', waveId: 'r1-s1' },
        ] },
```

(at `:104-107` keep that block's extra `error: 'no first token'` on the beta leg). The two dead-wave drivers (`:233-236`, `:255-258`) return `legs: []` and need no change.

- [ ] **Step 8: `budget-reservation.test.js` — a seat table AND a degrade sink**

`:343-349` builds a ctx with **no `degrade` key at all** and **no seats**, and drives the real `runStage1` with a critic. Without the sink, Task 2's emitter throws `TypeError: Cannot read properties of undefined (reading 'note')`; without the seats, `roleAt(undefined, id)` returns `'seat'` for every id. Add `const { buildSeats } = require('../../src/council/seats');` to its requires and:

```js
    const ctx = {
      o: { briefing: 'm', models: ['gpt', 'gemini', 'kimi'], critic: 'kimi', lenses: null,
        chair: 'deepseek', runId: 'xyz', runDir, date: '2026-07-26', councilName: null,
        seats: buildSeats(['gpt', 'gemini', 'kimi'], 'kimi', null), criticSeat: 'kimi' },
      launchers, addWave: budget.addWave, overBudget: budget.overBudget,
      degrade: { note: () => {} },
      scratchDir: path.join(runDir, '_scratch'),
    };
```

- [ ] **Step 9: Prove the fixtures bind — extend `seat-fixtures.test.js`**

```js
test('run-stages fixture legs bind one-to-one with their wave roster', () => {
  const roster = buildSeats(['deepseek', 'deepseek', 'gpt'], null, null);
  const legs = roster.map((s, i) => ({ modelInput: s.alias, status: 'complete',
    summary: 'x', taskId: `abc123-s1-${i + 1}`, waveId: 'abc123-s1' }));
  for (const leg of legs) { expect(leg.waveId).toBe('abc123-s1'); }   // BEFORE binding
  const { bound, unbound, orphanLegs } = bindSeats('abc123-s1', roster, legs);
  expect(unbound).toEqual([]);
  expect(orphanLegs).toEqual([]);
  // leg <-> seat CORRESPONDENCE. `expect(b.leg.taskId).toBe(`${waveId}-${b.seat.position}`)`
  // is a TAUTOLOGY of bindSeats' own rule — seats.js:139-140 CHOOSES the seat FROM
  // the taskId's slot number, so a slot SWAP satisfies it (verified). Compare
  // independently derived facts instead.
  const bySeat = new Map(bound.map(b => [b.seat.id, b.leg]));
  expect(bySeat.get('deepseek#1')).toBe(legs[0]);
  expect(bySeat.get('deepseek#2')).toBe(legs[1]);
  expect(bySeat.get('gpt')).toBe(legs[2]);
  // ...and prove the assertion bites:
  const swapped = [{ ...legs[0], taskId: 'abc123-s1-2' }, { ...legs[1], taskId: 'abc123-s1-1' }, legs[2]];
  const s = bindSeats('abc123-s1', roster, swapped);
  expect(new Map(s.bound.map(b => [b.seat.id, b.leg])).get('deepseek#1')).toBe(swapped[1]);
});
```

Assert `leg.waveId` **before** calling `bindSeats` — `seats.js:133` admits unstamped legs and `:138-140` then binds on `taskId` alone, so a bind-only assertion passes vacuously on a missing `waveId`.

- [ ] **Step 10: Run every touched suite; counts may rise, zero failures**

```bash
npx jest tests/council/run-stages.test.js tests/council/run-retry.test.js tests/council/run-launch.test.js tests/council/degrade-channels.test.js tests/council/budget-reservation.test.js tests/council/fake-launchers-ids.test.js tests/council/seat-fixtures.test.js
```

Nothing in `src/` changed, so **any** assertion that changes value other than a model name, a wave id, or a task id means the fixture edit is wrong — stop and report.

- [ ] **Step 11: Commit**

```bash
git add tests/ docs/superpowers/plans/2026-08-13-v48-pr2b-stage1-retry-binding.md
git commit -m "test(council): make every runStage1 driver bind-capable"
```

---

## Task 1: `launchStage1` returns an additive per-wave roster

**Files:**
- Modify: `src/council/run-stage1-launch.js` (`:15`, `:31`, `:36-64`, `:67`, `:69-90`, `:91`)
- Test: `tests/council/run-stages.test.js`

**Interfaces:**
- Produces: `launchStage1(ctx) → { aborted, legs, deadWaves, waves }` where `waves: Array<{ waveId: string, roster: Array<Seat>, legs: Array<object> }>` — one entry per **launched** wave, in launch order, `legs` being that wave's own array (`[]` for a wave that produced none). `deadWaves[]` additionally carries `seats: Array<Seat>` (the same roster).
- Consumes: `o.seats` (set at `run.js:133`), falling back to `buildSeats(o.models, o.critic, o.lenses)`.

**Why additive:** the sole consumer is `run-stages.js:63`, which destructures three keys. There is no `waves` key anywhere at HEAD, and `council-run.schema.json` sets no `additionalProperties: false`.

- [ ] **Step 1: Write the failing test**

Add to `tests/council/run-stages.test.js` (outside `describe('runStage2')`):

```js
describe('launchStage1 roster return', () => {
  const { launchStage1 } = require('../../src/council/run-stage1-launch');

  test('a twin bench gets one wave entry whose roster is seat-space and slot-ordered', async () => {
    const ctx = makeCtx({ models: ['deepseek', 'deepseek', 'gpt'],
      onWave: (opts) => okWave([], opts.waveId) });
    const r = await launchStage1(ctx);
    expect(r.waves).toHaveLength(1);
    expect(r.waves[0].waveId).toBe('abc123-s1');
    expect(r.waves[0].roster.map(s => s.id)).toEqual(['deepseek#1', 'deepseek#2', 'gpt']);
  });

  test('the -s1 roster drops the critic by ALIAS, in lockstep with the launch plan', async () => {
    // A unique-alias bench cannot see this: `models.filter(m => m !== critic)`,
    // `seats.filter(s => s.alias !== critic)` and `seats.filter(s => s.id !== criticSeat)`
    // are byte-identical there. They diverge ONLY on a repeated critic alias —
    // the alias filter drops BOTH twins, the criticSeat filter drops ONE, and the
    // roster then runs one longer than the launch plan, shifting every legId slot.
    // preflightSeats rejects an ambiguous critic, which is exactly why bindSeats
    // has to be total.
    const seen = [];
    const ctx = makeCtx({ models: ['a', 'crit', 'crit'], critic: 'crit',
      onWave: (opts) => { seen.push(opts.models.slice()); return okWave([], opts.waveId); },
      onSolo: (opts) => ({ wave: { waveId: opts.waveId, legs: [] }, exitCode: 0, leg: null }) });
    const r = await launchStage1(ctx);
    const s1 = r.waves.find(w => w.waveId === 'abc123-s1');
    expect(seen[0]).toEqual(['a']);                       // :47 drops BOTH twins
    expect(s1.roster.map(s => s.alias)).toEqual(['a']);   // criticSeat filter would give ['a','crit']
    expect(s1.roster).toHaveLength(seen[0].length);
    const c1 = r.waves.find(w => w.waveId === 'abc123-c1');
    expect(c1.roster.map(s => s.id)).toEqual(['crit#1']);
  });

  test('lens mode gives each bench position its own wave and its own seat', async () => {
    const ctx = makeCtx({ models: ['deepseek', 'deepseek'], lenses: ['risk', 'cost'],
      onSolo: (opts) => ({ wave: { waveId: opts.waveId, legs: [] }, exitCode: 0, leg: null }) });
    const r = await launchStage1(ctx);
    expect(r.waves.map(w => w.waveId)).toEqual(['abc123-l1', 'abc123-l2']);
    expect(r.waves.map(w => w.roster[0].id)).toEqual(['deepseek#1', 'deepseek#2']);
  });

  test('a dead wave carries its roster as seats alongside the alias models', async () => {
    const ctx = makeCtx({ models: ['a', 'b'], onWave: (opts) => okWave([], opts.waveId) });
    const r = await launchStage1(ctx);
    expect(r.deadWaves).toHaveLength(1);
    expect(r.deadWaves[0].models).toEqual(['a', 'b']);
    expect(r.deadWaves[0].seats.map(s => s.id)).toEqual(['a', 'b']);
  });

  test('each wave entry carries its OWN legs, never the flattened union', async () => {
    const ctx = makeCtx({ models: ['a', 'b', 'crit'], critic: 'crit',
      onWave: (opts) => okWave([mkLeg('a', 'r', 'complete', opts.waveId, 1),
        mkLeg('b', 'r', 'complete', opts.waveId, 2)], opts.waveId),
      onSolo: (opts) => { const leg = mkLeg('crit', 'r', 'complete', opts.waveId, 1);
        return { wave: { waveId: opts.waveId, legs: [leg] }, exitCode: 0, leg }; } });
    const r = await launchStage1(ctx);
    expect(r.legs).toHaveLength(3);                                   // flattened, unchanged
    expect(r.waves.map(w => w.legs.length)).toEqual([2, 1]);          // partitioned
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx jest tests/council/run-stages.test.js -t "launchStage1 roster return"
```

Expected: FAIL — `r.waves` is `undefined`.

- [ ] **Step 3: Implement**

`src/council/run-stage1-launch.js` — add the require (`seats.js` requires nothing, so no cycle):

```js
const { buildSeats } = require('./seats');
```

After `const { o, launchers } = ctx;` (`:15`):

```js
  // Seat identity for THIS launch. run.js:133 sets o.seats from asm.preflightSeats;
  // buildSeats is pure and total, so a direct require() caller or a legacy run dir
  // reconstructs the same table rather than binding nothing (spec §4.3).
  const seats = Array.isArray(o.seats) && o.seats.length > 0
    ? o.seats
    : buildSeats(o.models, o.critic, o.lenses);
```

Rename the local `const seats = o.models.filter(…)` at `:47` to `seats1` (update its uses at `:48` and `:52`) so it does not shadow the seat table. Then carry the roster on each `seated.push`, mapping **positionally**:

- lens branch (`:40`), inside `o.models.forEach((m, i) => …)`:
  ```js
      seated.push({ waveId, models: [m], roster: seats.slice(i, i + 1) });
  ```
- `-s1` branch (`:50`):
  ```js
      // MUST mirror :47's `m !== o.critic` exactly. Filtering on `s.id !== o.criticSeat`
      // instead would drop ONE twin where the alias filter drops BOTH, shifting every
      // legId slot by one on a bench preflightSeats never saw.
      seated.push({ waveId: `${o.runId}-s1`, models: seats1.slice(),
        roster: seats.filter(s => s.alias !== o.critic) });
  ```
- `-c1` branch (`:58`):
  ```js
      seated.push({ waveId: `${o.runId}-c1`, models: [o.critic],
        roster: seats.filter(s => s.alias === o.critic).slice(0, 1) });
  ```

Declare the accumulator beside `legs` (`:67`): `const waves = [];`

Inside `results.forEach((r, i) => …)`, immediately after `legs.push(...got)` (`:74`) — **the only place `got` and `seated[i]` coexist**:

```js
    // Per-wave partition, captured BEFORE the flatten above erases attribution.
    // bindSeats is called once per entry by the consumer; a wave that produced
    // nothing still gets an entry so its roster is never lost.
    waves.push({ waveId: seated[i].waveId, roster: seated[i].roster, legs: got });
```

Add `seats` to the dead-wave push (`:85-89`): `waveId: seated[i].waveId, models: seated[i].models, seats: seated[i].roster,`

And the return (`:91`): `return { aborted, legs, deadWaves, waves };`

- [ ] **Step 4: Verify green**

```bash
npx jest tests/council/run-stages.test.js tests/council/budget-reservation.test.js tests/council/degrade-channels.test.js
```

- [ ] **Step 5: Size gate + commit**

```bash
git add -A && npm run check:sizes
git commit -m "feat(council): launchStage1 returns an additive per-wave seat roster"
```

---

## Task 2: `stage1-bind.js`, the `seat-unbound` channel, and the orphan-leg emitter

**Files:**
- Create: `src/council/stage1-bind.js`
- Modify: `src/utils/degrade.js` (`:14-23`)
- Modify: `src/council/run-stages.js` (`:63-64`)
- Test: `tests/council/stage1-bind.test.js` (new), `tests/council/degrade-contract.test.js`

**Interfaces:**
- Produces:
  - `bindStage1Waves(waves) → { seatOf: Map<legObject, Seat>, missingSeats: Array<{waveId, seat, returned, expected}>, orphanLegs: Array<{waveId, leg}> }`
  - `orphanLegNote(waveId, leg) → {channel, what, why, effect, data}`
  - `missingSeatDeadWave(m) → {waveId, models, seats, reason, partial: true}`
- Consumes: Task 1's `waves`.

⚠️ **Destructure ONLY `orphanLegs` in this task.** `seatOf` has no consumer until Task 3 and `missingSeats` none until Task 7; `no-unused-vars` is an **error** whose ignore pattern covers arguments only, a comment does not satisfy it, and `eslint --fix` cannot fix it — so either unused binding fails Step 7's lint AND the pre-commit hook, with `--no-verify` forbidden. (Reproduced against this tree: `error 'seatOf' is assigned a value but never used`, exit 1.) The destructure widens task by task: `{orphanLegs}` here → `{seatOf, orphanLegs}` at Task 3 → `{seatOf, missingSeats, orphanLegs}` at Task 7.

- [ ] **Step 1: Declare the channel and pin it**

`src/utils/degrade.js:14-23`, in the council-runtime group:

```js
  'stage1-retry',
  // v4.8: the seat<->leg join failed. Two shapes, one channel: a launched seat
  // whose wave returned legs but none of them its own, and a returned leg that
  // matches no roster slot. Never a guess — silent mis-attribution is the
  // failure seat identity exists to kill (spec §4.4).
  'seat-unbound',
```

Add a block to `tests/council/degrade-contract.test.js` mirroring the `stage1-retry` block, asserting `makeDegrade({channel:'seat-unbound', …})` round-trips and `DEGRADE_CHANNELS.has('seat-unbound')`.

- [ ] **Step 2: Write the failing test**

Create `tests/council/stage1-bind.test.js`:

```js
'use strict';
const { bindStage1Waves, orphanLegNote, missingSeatDeadWave } = require('../../src/council/stage1-bind');
const { buildSeats } = require('../../src/council/seats');

const leg = (alias, waveId, slot, extra = {}) => ({ modelInput: alias, status: 'complete',
  summary: 'r', waveId, taskId: `${waveId}-${slot}`, ...extra });

describe('bindStage1Waves', () => {
  test('twins bind to distinct seats and seatOf keys on the leg OBJECT', () => {
    const roster = buildSeats(['deepseek', 'deepseek'], null, null);
    const legs = [leg('deepseek', 'w-s1', 1), leg('deepseek', 'w-s1', 2)];
    const r = bindStage1Waves([{ waveId: 'w-s1', roster, legs }]);
    expect(r.seatOf.get(legs[0]).id).toBe('deepseek#1');
    expect(r.seatOf.get(legs[1]).id).toBe('deepseek#2');
    expect(r.missingSeats).toEqual([]);
    expect(r.orphanLegs).toEqual([]);
  });

  test('two waves are bound INDEPENDENTLY — a leg of wave B is not an orphan of wave A', () => {
    const seats = buildSeats(['a', 'crit'], 'crit', null);
    const wa = { waveId: 'w-s1', roster: [seats[0]], legs: [leg('a', 'w-s1', 1)] };
    const wc = { waveId: 'w-c1', roster: [seats[1]], legs: [leg('crit', 'w-c1', 1)] };
    const r = bindStage1Waves([wa, wc]);
    expect(r.orphanLegs).toEqual([]);
    expect(r.missingSeats).toEqual([]);
    expect(r.seatOf.size).toBe(2);
  });

  test('a partial return yields a missing seat, carrying the counts for its prose', () => {
    const roster = buildSeats(['a', 'b'], null, null);
    const legs = [leg('a', 'w-s1', 1)];
    const r = bindStage1Waves([{ waveId: 'w-s1', roster, legs }]);
    expect(r.missingSeats).toEqual([{ waveId: 'w-s1', seat: roster[1], returned: 1, expected: 2 }]);
  });

  test('a wave that returned NOTHING yields no missing seats — dead-wave already owns it', () => {
    const roster = buildSeats(['a', 'b'], null, null);
    const r = bindStage1Waves([{ waveId: 'w-s1', roster, legs: [] }]);
    expect(r.missingSeats).toEqual([]);
    expect(r.orphanLegs).toEqual([]);
  });

  test('a wave with an ORPHAN leg yields no missing seats — its review already landed', () => {
    const roster = buildSeats(['a', 'b'], null, null);
    const stray = leg('zzz', 'w-s1', 9, { taskId: 'stray-1' });
    const r = bindStage1Waves([{ waveId: 'w-s1', roster, legs: [leg('a', 'w-s1', 1), stray] }]);
    expect(r.orphanLegs).toEqual([{ waveId: 'w-s1', leg: stray }]);
    expect(r.missingSeats).toEqual([]);   // b is NOT retried: a paid leg is unaccounted for
  });

  test('an orphan leg note names the channel and the leg', () => {
    const stray = leg('zzz', 'w-s1', 9, { taskId: 'stray-1' });
    const note = orphanLegNote('w-s1', stray);
    expect(note.channel).toBe('seat-unbound');
    expect(note.what).toContain('stray-1');
    expect(note.data).toEqual({ waveId: 'w-s1', legId: 'stray-1', seat: 'zzz' });
  });

  test('missingSeatDeadWave is a single-seat dead-wave record flagged partial', () => {
    const roster = buildSeats(['a', 'b'], null, null);
    const w = missingSeatDeadWave({ waveId: 'w-s1', seat: roster[1], returned: 1, expected: 2 });
    expect(w).toEqual({ waveId: 'w-s1', models: ['b'], seats: [roster[1]],
      reason: 'the wave returned 1 of 2 legs and none of them was this seat’s', partial: true });
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

```bash
npx jest tests/council/stage1-bind.test.js
```

Expected: FAIL — `Cannot find module '../../src/council/stage1-bind'`.

- [ ] **Step 4: Implement `src/council/stage1-bind.js`**

```js
// src/council/stage1-bind.js
'use strict';
// Stage-1 seat binding (v4.8 workstream A, spec §4.4). Lives here rather than in
// run-stages.js because that file is at 243/300 and this is where the leg<->seat
// join and its two failure shapes belong together.

const { bindSeats } = require('./seats');

/**
 * Bind every Stage-1 wave to its own roster, ONE CALL PER WAVE.
 *
 * Never call bindSeats once over the flattened leg array: seats.js:133 admits a
 * leg with no waveId, so a concatenated array makes wave B's legs candidates for
 * wave A's slots. The waves[] entries from launchStage1 are already partitioned
 * by construction (run-stage1-launch.js captures each wave's own `got`).
 *
 * @param {Array<{waveId: string, roster: Array<object>, legs: Array<object>}>} waves
 * @returns {{seatOf: Map<object, object>,
 *   missingSeats: Array<{waveId: string, seat: object, returned: number, expected: number}>,
 *   orphanLegs: Array<{waveId: string, leg: object}>}}
 */
function bindStage1Waves(waves) {
  const seatOf = new Map();
  const missingSeats = [];
  const orphanLegs = [];
  for (const w of (Array.isArray(waves) ? waves : [])) {
    const legs = Array.isArray(w.legs) ? w.legs : [];
    const roster = Array.isArray(w.roster) ? w.roster : [];
    const { bound, unbound, orphanLegs: strays } = bindSeats(w.waveId, roster, legs);
    for (const b of bound) { seatOf.set(b.leg, b.seat); }
    for (const leg of strays) { orphanLegs.push({ waveId: w.waveId, leg }); }
    // A wave that returned ZERO legs contributes no missing seats: it is already a
    // dead wave (or a budget refusal, or an abort), each with its own louder
    // channel. A wave that returned legs we could NOT attribute contributes none
    // either: an orphan leg is a review that LANDED — materializeReviews writes it
    // under its alias name — for a seat we cannot name. Retrying that seat would
    // buy a SECOND paid leg and put two reviews on one seat, breaking the
    // invariant run-stages.js:106-109 states. The orphan is already announced on
    // `seat-unbound` at bind time (R-B: orphans are not a loss and not retryable).
    if (legs.length === 0 || strays.length > 0) { continue; }
    for (const seat of unbound) {
      missingSeats.push({ waveId: w.waveId, seat, returned: legs.length, expected: roster.length });
    }
  }
  return { seatOf, missingSeats, orphanLegs };
}

/**
 * A returned leg that matches no roster slot. Announced immediately — unlike a
 * missing seat it is not a loss and there is nothing to retry, and unlike a
 * mis-binding it is exactly the case where guessing would be wrong.
 */
function orphanLegNote(waveId, leg) {
  const legId = (leg && (leg.legId || leg.taskId)) || 'unidentified';
  const alias = (leg && (leg.modelInput || leg.model)) || 'unknown';
  return {
    channel: 'seat-unbound',
    what: `leg ${legId} in wave ${waveId} matches no seat on that wave's roster`,
    why: `its id names no roster slot of ${waveId}, and its model '${alias}' does not identify `
      + 'exactly one seat there',
    effect: 'Its review is kept under its model name and is NOT attributed to a seat; nothing was '
      + 'guessed and nothing was dropped',
    data: { waveId, legId, seat: alias },
  };
}

/**
 * Turn a missing seat into a single-seat dead-wave record so the ordinary SL-2
 * retry machinery relaunches it (owner ruling R-B). `partial: true` is what keeps
 * the prose honest downstream: the wave DID produce legs, so the plain dead-wave
 * sentence would be false.
 */
function missingSeatDeadWave(m) {
  return {
    waveId: m.waveId,
    models: [m.seat.alias],
    seats: [m.seat],
    reason: `the wave returned ${m.returned} of ${m.expected} legs and none of them was this seat’s`,
    partial: true,
  };
}

module.exports = { bindStage1Waves, orphanLegNote, missingSeatDeadWave };
```

- [ ] **Step 5: Wire the orphan emitter into `runStage1`**

Add to `src/council/run-stages.js`'s requires:

```js
const { bindStage1Waves, orphanLegNote } = require('./stage1-bind');
```

Change `:63` and insert after the abort guard at `:64`:

```js
  const { aborted, legs, deadWaves, waves } = await launchStage1(ctx);
  if (aborted) { return { aborted, reviews: [], deadLegs: [], deadWaves: [], degraded: false, extraRows: [] }; }

  // Per-wave binding, before anything reads a leg. Orphans are announced now —
  // they are not a loss, so the "never degrade for a seat the retry saves" rule
  // below does not apply to them.
  const { orphanLegs } = bindStage1Waves(waves);
  for (const { waveId, leg } of orphanLegs) { ctx.degrade.note(orphanLegNote(waveId, leg)); }
```

- [ ] **Step 6: Verify green, then MUTATION-TEST the channel**

```bash
npx jest tests/council/stage1-bind.test.js tests/council/degrade-contract.test.js tests/council/run-stages.test.js tests/council/degrade-channels.test.js
```

`run-degrade.js:21-32` rewrites an unregistered channel as `internal` and **still** flips `degraded.value`, so a test asserting only `degrades.length` or `exitCode === 2` passes on a forgotten registration:

⚠️ **Restore from a byte copy, never `git checkout --`.** The file you are mutating holds UNCOMMITTED work from Step 1, and `git checkout -- <file>` reverts to HEAD — silently discarding that edit along with the mutation. (This happened for real on Task 2; it was caught by a grep, but only by luck.) The recipe below is independent of git state.

```bash
node -e "const fs=require('fs');const f='src/utils/degrade.js';fs.copyFileSync(f,f+'.bak');const s=fs.readFileSync(f,'utf8');const m=s.replace(\"'seat-unbound',\",'');if(m===s){console.error('MUTATION DID NOT APPLY');process.exit(1)}fs.writeFileSync(f,m)"
npx jest tests/council/degrade-contract.test.js tests/council/stage1-bind.test.js
node -e "const fs=require('fs');const f='src/utils/degrade.js';fs.copyFileSync(f+'.bak',f);fs.unlinkSync(f+'.bak')"
git diff --stat src/utils/degrade.js
```

Expected: RED while mutated. If green, the assertions do not name `.channel` — fix them before proceeding. After restoring, confirm `grep -c "seat-unbound" src/utils/degrade.js` is non-zero — a silently-lost registration is the exact failure this step exists to catch.

- [ ] **Step 7: Commit**

```bash
git add -A && npm run check:sizes && npm run lint
git commit -m "feat(council): seat-unbound degrade channel + per-wave Stage-1 binding"
```

---

## Task 3: `materializeReviews` names files by seat

**Files:**
- Modify: `src/council/run-launch.js` (`:22`, `:182-202`)
- Modify: `src/council/run-stages.js` (`:63`'s destructure, `:66`, `:112`)
- Test: `tests/council/run-launch.test.js`

**Interfaces:**
- Produces: `materializeReviews(runDir, legs, seatOf?) → Array<{model, modelInput, file, text, leg, seat}>` — `seatOf` optional `Map<legObject, Seat>`; `seat` is the bound seat or `null`.

- [ ] **Step 0: give the suite the two identifiers the new tests use**

`tests/council/run-launch.test.js:6` is `const { createLaunchers, materializeReviews } = require('../../src/council/run-launch');` — no `buildSeats` — and there is **no `runDir` binding anywhere in the file**; the temp dir is `tmp` (`:8-9`). Verified: `grep -c runDir` → 0, `grep -c buildSeats` → 0. Add beneath `:6`:

```js
const { buildSeats } = require('../../src/council/seats');
```

and write every new test against `tmp`, matching the existing calls at `:149`/`:157`.

- [ ] **Step 1: Write the failing test**

```js
describe('materializeReviews seat naming', () => {
  test('a bound seat names the file via artifactName; twins no longer clobber', () => {
    const seats = buildSeats(['deepseek', 'deepseek'], null, null);
    const legs = [{ modelInput: 'deepseek', status: 'complete', summary: 'first' },
      { modelInput: 'deepseek', status: 'complete', summary: 'second' }];
    const seatOf = new Map([[legs[0], seats[0]], [legs[1], seats[1]]]);
    const out = materializeReviews(tmp, legs, seatOf);
    expect(out.map(m => path.basename(m.file)))
      .toEqual(['review-deepseek-1.md', 'review-deepseek-2.md']);
    expect(fs.readFileSync(out[0].file, 'utf8')).toBe('first');
    expect(fs.readFileSync(out[1].file, 'utf8')).toBe('second');
    expect(out.map(m => m.seat.id)).toEqual(['deepseek#1', 'deepseek#2']);
  });

  test('a unique-alias bench is BYTE-IDENTICAL with or without a seat', () => {
    const seats = buildSeats(['gpt'], null, null);
    const legs = [{ modelInput: 'gpt', status: 'complete', summary: 'r' }];
    const withSeat = materializeReviews(tmp, legs, new Map([[legs[0], seats[0]]]));
    const without = materializeReviews(tmp, legs);
    expect(path.basename(withSeat[0].file)).toBe('review-gpt.md');
    expect(path.basename(without[0].file)).toBe('review-gpt.md');
  });

  test('an unbound (orphan) leg keeps its alias filename and reports seat null', () => {
    const legs = [{ modelInput: 'zzz', status: 'complete', summary: 'r' }];
    const out = materializeReviews(tmp, legs, new Map());
    expect(path.basename(out[0].file)).toBe('review-zzz.md');
    expect(out[0].seat).toBeNull();
  });

  test('a bound but DEAD leg is still rejected — bound does not mean usable', () => {
    const seats = buildSeats(['gpt'], null, null);
    const legs = [{ modelInput: 'gpt', status: 'timeout', summary: 'r' }];
    expect(materializeReviews(tmp, legs, new Map([[legs[0], seats[0]]]))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx jest tests/council/run-launch.test.js -t "materializeReviews seat naming"
```

Expected: FAIL — both twins write `review-deepseek.md`, and `m.seat` is `undefined`.

- [ ] **Step 3: Implement**

`src/council/run-launch.js` — extend the require at `:22` to `const { sanitizeName, artifactName } = require('./seats');` and rewrite `:182-202`:

```js
/**
 * Write one review file per surviving Stage-1 leg (skill layout). Dead legs and
 * empty summaries are skipped — the caller applies the wave-degrade rules to
 * what remains, which is why a BOUND seat can still end up dead here.
 *
 * With `seatOf` the filename is the SEAT's (artifactName), byte-identical to the
 * alias name for every bench that has ever run, and what stops two twins from
 * clobbering one file. An unbound leg keeps its alias name rather than being
 * dropped: it is unattributable, not unusable, and dropping it would lose a
 * review that lands today.
 *
 * @param {string} runDir
 * @param {Array<object>} legs run documents from the wave/solo docs
 * @param {Map<object, object>} [seatOf] leg document -> seat, keyed by object identity
 * @returns {Array<{model: string, modelInput: string, file: string, text: string,
 *   leg: object, seat: ?object}>}
 */
function materializeReviews(runDir, legs, seatOf) {
  const out = [];
  for (const leg of legs) {
    if (!leg || leg.status !== 'complete') { continue; }
    const text = leg.summary;
    if (!text || !String(text).trim()) { continue; }
    const modelInput = leg.modelInput || leg.model;
    const seat = (seatOf && seatOf.get(leg)) || null;
    const name = seat ? artifactName(seat, 'review') : `review-${sanitizeName(modelInput)}.md`;
    const file = path.join(runDir, name);
    fs.writeFileSync(file, text, { mode: 0o600 });
    out.push({ model: leg.model, modelInput, file, text, leg, seat });
  }
  return out;
}
```

- [ ] **Step 4: Thread `seatOf` through the Stage-1 call sites**

Widen Task 2's destructure to `const { seatOf, orphanLegs } = bindStage1Waves(waves);` — `seatOf` now has a consumer, so `no-unused-vars` is satisfied.

- `run-stages.js:66` → `const firstPass = materializeReviews(o.runDir, legs, seatOf);`
- `run-stages.js:112` → `const materialized = materializeReviews(o.runDir, [...legs, ...retry.recoveredLegs], seatOf);`

⚠️ `retry.recoveredLegs` are RETRY-wave leg objects and are **absent** from this Stage-1 map, so they get `seat: null` and today's alias filename. That is correct at this commit — H4 does not land until Task 6, so there is at most one recovered leg per alias and nothing can clobber. **Task 5 replaces `seatOf` here with the `allSeatOf` union**; do not skip it.

- `run-retry.js:125` is Task 5's.

- [ ] **Step 5: Verify green**

```bash
npx jest tests/council/run-launch.test.js tests/council/run-stages.test.js tests/council/run-retry.test.js tests/council/run-cost-bijection.test.js
```

- [ ] **Step 6: Commit**

```bash
git add -A && npm run check:sizes && npm run lint
git commit -m "feat(council): review filenames come from the seat, not the alias"
```

---

## Task 4: `roleFor` → `roleAt`, site 1

**Files:**
- Modify: `src/council/run-stages.js` (`:31`, `:222-227`)
- Test: `tests/council/run-stages.test.js`

**This is a behaviour change for twin lens benches and needs its own CHANGELOG line (Task 9).** `roleFor` (`run-stages.js:34-40`) resolves the lens with `o.models.indexOf(alias)`, returning the FIRST twin's index for both — so `--models a,a --lenses risk,cost` gives both seats `lens:risk` today. `buildSeats` is positional, so `roleAt` gives `lens:risk` and `lens:cost`. **`roleFor` stays exported** (`run-stages.js:243`) — `src/observe/council-legs.js:89` has only a `modelInput`.

- [ ] **Step 1: Write the failing test**

```js
test('twin lens seats get their OWN lens, not the first twin’s (roleAt vs roleFor)', async () => {
  const ctx = makeCtx({ models: ['deepseek', 'deepseek'], lenses: ['risk', 'cost'],
    onSolo: (opts) => { const leg = mkLeg(opts.model, review(), 'complete', opts.waveId, 1);
      return { wave: { waveId: opts.waveId, legs: [leg] }, exitCode: 0, leg }; } });
  const r = await runStage1(ctx);
  expect(r.reviews.map(x => x.role)).toEqual(['lens:risk', 'lens:cost']);
});

test('roleFor is still exported for the alias-space shim', () => {
  expect(typeof require('../../src/council/run-stages').roleFor).toBe('function');
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx jest tests/council/run-stages.test.js -t "twin lens seats"
```

Expected: FAIL — `['lens:risk', 'lens:risk']`.

- [ ] **Step 3: Implement**

Add `roleAt` to the `./seats` require at `run-stages.js:31`, then at `:223`:

```js
      model: m.modelInput, modelInput: m.modelInput,
      // Seat-space role (spec §4.5). roleFor's o.models.indexOf hands both lens
      // twins the FIRST twin's lens; buildSeats is positional and does not. An
      // unbound leg has no seat, so it falls back to the alias-space shim, which
      // is what it got before this rev.
      role: m.seat ? roleAt(o.seats, m.seat.id) : roleFor(o, m.modelInput),
```

⚠️ `roleAt(seats, id)` reads `o.seats` — the **full bench table**, not the wave roster. Task 0 Steps 2 and 8 gave `run-stages.test.js` and `budget-reservation.test.js` one; `degrade-channels.test.js`'s five ctx literals (`:39`, `:71`, `:99`, `:229`, `:251`) still have none, so `roleAt(undefined, id)` returns `'seat'` there for every id. That is latent (no role assertions in that suite) but must not be relied on — if a role assertion is ever added there, give that literal a seat table first.

- [ ] **Step 4: Verify green + commit**

```bash
npx jest tests/council/run-stages.test.js tests/council/run-assemble.test.js tests/observe
git add -A && npm run check:sizes && npm run lint
git commit -m "feat(council): review roles come from the seat table"
```

---

## Task 5: the retry pass carries a seat roster, and its bindings escape

**Files:**
- Modify: `src/council/run-retry-group.js` (`:27-31`, `:41`, `:44-48`, `:58-62`, `:67-96`)
- Modify: `src/council/run-retry.js` (`:42`, `:44-46`, `:58`, `:98`, `:125`, `:127`, `:153-154`, `:178-179`, `:187-190`)
- Modify: `src/council/run-stages.js` (`:72`, `:110-112`)
- Test: `tests/council/run-retry.test.js`

**Interfaces:**
- Produces: every retry unit gains `seats: Array<?Seat>` **index-parallel to `models`** — same order, same length, `null` where the seat could not be identified.
- Produces: `groupStage1Losses(o, deadWaves, deadLegs, seatOf)`.
- Produces: `retryStage1Losses` returns an additive **`seatOf: Map<legObject, Seat>`** covering every retry-wave leg it bound.
- Produces: `run-stages.js` builds `allSeatOf = new Map([...seatOf, ...retry.seatOf])` and uses it for every post-retry consumer.

**Why `seats` is a second array and not a replacement for `models`:** `run-retry.js:93` feeds `unit.models` straight into `launchWave({models})`, joined into a `--models` string. A seat id is **not routable** — `deepseek#2` is not a model name (spec §4.7). Aliases launch; seats bind.

**Why `out.seatOf` is mandatory here and not in Task 8:** `retry.recoveredLegs` and `retry.stillDeadRetryLegs` are RETRY-wave leg objects. An object-keyed map that never saw them returns `undefined`, so without this every healed seat re-materializes with `seat: null`, two healed twins both write `review-deepseek.md` (the second clobbers the first), and `roleAt` falls back to the alias shim — re-arming the very bug Task 4 fixed. Task 6's stated deliverable is produced by nothing earlier.

**H4 is NOT in this task.** `recordFailure` still dedups by alias here, so `seats` holds one seat per alias and every array length is unchanged.

- [ ] **Step 1: Write the failing test**

```js
test('a retry unit carries seats parallel to models, in launch order', () => {
  const seats = buildSeats(['a', 'b'], null, null);
  const o = { runId: 'r1', models: ['a', 'b'], critic: null, lenses: null, seats };
  const units = groupStage1Losses(o, [{ waveId: 'r1-s1', models: ['a', 'b'],
    seats, reason: 'x' }], [], new Map());
  expect(units[0].models).toEqual(['a', 'b']);
  expect(units[0].seats.map(s => s.id)).toEqual(['a', 'b']);
});

test('a dead LEG contributes its BOUND seat, taken from seatOf', () => {
  const seats = buildSeats(['a', 'b'], null, null);
  const o = { runId: 'r1', models: ['a', 'b'], critic: null, lenses: null, seats };
  const dead = { modelInput: 'b', status: 'error', error: 'boom' };
  const units = groupStage1Losses(o, [], [dead], new Map([[dead, seats[1]]]));
  expect(units[0].seats.map(s => s.id)).toEqual(['b']);
});

test('unit.seats is index-parallel to unit.models and a hole never shifts a slot', () => {
  const seats = buildSeats(['a', 'b'], null, null);
  const o = { runId: 'r1', models: ['a', 'b'], critic: null, lenses: null, seats };
  const unidentified = { modelInput: 'a', status: 'error', error: 'boom' };  // no seatOf entry
  const dead = { modelInput: 'b', status: 'error', error: 'boom' };
  const units = groupStage1Losses(o, [], [unidentified, dead], new Map([[dead, seats[1]]]));
  expect(units[0].models).toEqual(['a', 'b']);
  expect(units[0].seats).toHaveLength(units[0].models.length);
  expect(units[0].seats[0]).toBeNull();       // unidentified — never guessed
  expect(units[0].seats[1].id).toBe('b');     // position preserved despite the hole
});

test('the retry wave binds its own legs, names files by seat, and publishes seatOf', async () => {
  const ctx = fakeCtx({ models: ['a'], critic: null }, {
    launchWave: jest.fn().mockResolvedValue(okWave([
      { modelInput: 'a', status: 'complete', summary: review(),
        taskId: 'r1-s1r1-1', waveId: 'r1-s1r1' }], 'r1-s1r1')),
  });
  const out = await retryStage1Losses(ctx, {
    deadWaves: [{ waveId: 'r1-s1', models: ['a'], seats: ctx.o.seats, reason: 'x' }],
    deadLegs: [], counts: { reviewed: 0, total: 1 } });
  expect(out.recoveredLegs).toHaveLength(1);
  expect(out.seatOf.get(out.recoveredLegs[0]).id).toBe('a');
  expect(fs.existsSync(path.join(ctx.o.runDir, 'review-a.md'))).toBe(true);
});
```

- [ ] **Step 2: Run and watch fail**

```bash
npx jest tests/council/run-retry.test.js -t "parallel to models"
```

Expected: FAIL — `units[0].seats` is `undefined`.

- [ ] **Step 3: the grouping side**

`run-retry-group.js`: give every unit literal a `seats: []` beside its `models: []` (`:44-48` and both branches of `lensUnitFor` at `:58-62`). Seed the critic unit's the same way `models` is seeded:

```js
  const criticSeatObj = (o.seats || []).find(s => s.alias === o.critic) || null;
  const criticUnit = { unit: 'critic', waveId: `${o.runId}-c1r1`, retryOfWaveId: `${o.runId}-c1`,
    models: o.critic ? [o.critic] : [], seats: criticSeatObj ? [criticSeatObj] : [],
    firstFailures: [], srcWaves: [], srcLegs: [] };
```

`recordFailure` carries the seat and pushes it in lockstep:

```js
function recordFailure(unit, seat, ff, trackModel = true, seatObj = null) {
  if (unit.firstFailures.some(f => f.seat === seat)) { return; }
  unit.firstFailures.push(ff);
  if (trackModel) { unit.models.push(seat); unit.seats.push(seatObj); }
}
```

Change `groupStage1Losses`'s signature to `(o, deadWaves = [], deadLegs = [], seatOf = new Map())` and supply the seat at each call site:

- dead-wave loop (`:72`, `:79`): replace `models.forEach(seat => …)` with
  `models.forEach((seat, idx) => recordFailure(u, seat, { seat, class: 'wave', waveId: w.waveId, reason: w.reason }, true, (w.seats || [])[idx] || null))`
- dead-leg loop (`:88`, `:94`): `recordFailure(u, seat, ff, true, seatOf.get(leg) || null)`

⚠️ A `null` entry in `unit.seats` means "we could not identify this seat" — never substitute an alias lookup, which is the guess the whole mechanism forbids. Task 8's `deadSeats.set(s ? s.id : alias, …)` reads that signal.

- [ ] **Step 4: the retry-side bind**

`run-retry.js`: import `bindSeats`, then insert the block below immediately **AFTER `:98`** — do **NOT** re-declare `legs`; `:98` already IS `const legs = (res.wave && Array.isArray(res.wave.legs)) ? res.wave.legs : [];`. And `bindSeats` returns a plain object (`seats.js:150`), never something a `for…of` can walk.

```js
    // The retry wave's roster IS unit.seats — recordFailure pushes models and
    // seats in lockstep, and deriveLegIds slot-indexes that same launch plan.
    // A null entry means "we could not identify this seat"; pad it with a
    // position-stable placeholder carrying a UNIQUE id so no slot shifts, then
    // drop placeholder binds so nothing is guessed.
    const retryRoster = unit.seats.map((s, i) => s
      || { id: `__unbound-${unit.waveId}-${i + 1}`, alias: unit.models[i], role: 'seat', lens: null, position: i + 1 });
    const bindRes = bindSeats(unit.waveId, retryRoster, legs);
    const retrySeatOf = new Map(bindRes.bound
      .filter(b => !String(b.seat.id).startsWith('__unbound-'))
      .map(b => [b.leg, b.seat]));
    for (const [l, s] of retrySeatOf) { out.seatOf.set(l, s); }
```

⚠️ **Do not filter and do not use a null-id sentinel.** Verified at HEAD: `seats.js:131` is `const roster = Array.isArray(seats) ? seats.filter(Boolean) : [];`, so passing `unit.seats` unfiltered is byte-identical to `unit.seats.filter(Boolean)` — a hole shifts every later slot either way (roster `[seatA, null, seatC]`, legs slotted 1/2/3: **both** bind leg `b` to seat `c`). And `{id: null, alias}` is worse — `bindSeats` dedups on `seat.id` (`:146`, `:150`), so two sentinels collide (`bound 1, unbound 0, orphans 1`).

Change `:125`:

```js
    const usable = new Set(materializeReviews(o.runDir, legs, retrySeatOf).map(m => m.leg));
```

Make the map part of the CONTRACT — `:44-46` becomes:

```js
  const out = { aborted: null, recoveredLegs: [], stillDeadNotes: [],
    stillDeadWaves: [], stillDeadLegs: [], skippedDeadWaves: [], skippedDeadLegs: [],
    stillDeadRetryLegs: [], seatOf: new Map() };
```

Add `seatOf` to `retryStage1Losses`'s destructured options at `:42`, pass it to `groupStage1Losses(o, deadWaves, deadLegs, seatOf)` at `:58`, and update the sole caller `run-stages.js:72` to pass `seatOf`.

- [ ] **Step 5: track the lost SEATS, not just their aliases**

`stillDeadWaves` entries must narrow `seats` in lockstep with `models`, or Task 8's dead-seat loop index-zips a healed seat against a lost seat's alias. `:127` becomes:

```js
    const lostWaveSeats = new Map(); // waveId -> [{alias, seat}] still lost from a wave-origin
```

both push sites (`:153-154`, `:178-179`):

```js
          if (!lostWaveSeats.has(ff.waveId)) { lostWaveSeats.set(ff.waveId, []); }
          lostWaveSeats.get(ff.waveId).push({ alias: seat, seat: boundSeat || null });
```

and `:187-190`:

```js
    // Wave-origin seats still lost. `seats` is narrowed in LOCKSTEP with `models`,
    // or run-stage1-rows.js's dead-seat loop index-zips a healed seat against a
    // lost seat's alias. Since v4.8 a wave can contribute SEVERAL srcWave records
    // sharing one waveId (one per missing seat, stage1-bind.js's
    // missingSeatDeadWave), so the lookup fires once per waveId — not once per
    // record, which would push every still-lost seat of that wave N times.
    const reconciled = new Set();
    for (const w of unit.srcWaves) {
      if (reconciled.has(w.waveId)) { continue; }
      reconciled.add(w.waveId);
      const lost = lostWaveSeats.get(w.waveId) || [];
      if (lost.length > 0) {
        out.stillDeadWaves.push({ ...w, models: lost.map(x => x.alias), seats: lost.map(x => x.seat) });
      }
    }
```

- [ ] **Step 6: the `allSeatOf` union in `run-stages.js`**

Before `:112`:

```js
  // A recovered leg is a RETRY-wave object and is absent from Stage-1's seatOf.
  // Without this union every healed seat re-materializes with seat:null, two
  // healed twins both write review-deepseek.md (the second clobbers the first),
  // and roleAt falls back to the alias shim.
  const allSeatOf = new Map([...seatOf, ...retry.seatOf]);
  const materialized = materializeReviews(o.runDir, [...legs, ...retry.recoveredLegs], allSeatOf);
```

Update the comment at `:110-111`: with seat-named files the second write is no longer an "idempotent no-op" for a twin bench — it is the clobber this PR removes, which is why the union is mandatory.

- [ ] **Step 7: Verify green + commit**

```bash
npx jest tests/council/run-retry.test.js tests/council/run-stages.test.js tests/council/run-cost-bijection.test.js tests/council/degrade-channels.test.js
git add -A && npm run check:sizes && npm run lint
git commit -m "feat(council): retry units carry a seat roster and publish their bindings"
```

---

## Task 6: H4 — un-collapse the retry grouping

**Files:**
- Modify: `src/council/run-retry-group.js` (`:10-15`, `:27-31`, `:86`)
- Modify: `src/council/run-retry.js` (`:110`, `:114`, `:126`, `:130`, `:156`, `:170-172`, `:175`, `:181`)
- Modify: `src/council/run-stages.js` (`:74-82`)
- Modify: `tests/council/run-retry.test.js` (`:24-27`, `:37`, `:284`)
- Modify: `tests/council/degrade-channels.test.js` (`:119-121`)

**This task changes what is LAUNCHED and PAID FOR — it lands after Tasks 3 and 5 for exactly that reason.** Before Task 3 two paid legs would clobber one review file; before Task 5 the second leg's outcome is discarded by the alias Sets.

- [ ] **Step 1: Write the failing tests**

```js
test('H4: two dead twin seats retry as two legs, not one', async () => {
  const seats = buildSeats(['deepseek', 'deepseek'], null, null);
  const o = { runId: 'r1', models: ['deepseek', 'deepseek'], critic: null, lenses: null, seats };
  const d1 = { modelInput: 'deepseek', status: 'error', error: 'a' };
  const d2 = { modelInput: 'deepseek', status: 'error', error: 'b' };
  const units = groupStage1Losses(o, [], [d1, d2], new Map([[d1, seats[0]], [d2, seats[1]]]));
  expect(units[0].models).toEqual(['deepseek', 'deepseek']);
  expect(units[0].seats.map(s => s.id)).toEqual(['deepseek#1', 'deepseek#2']);
  // The dedup key is the NEW field. `ff.seat` must stay ALIAS-valued: verdict.js:72
  // (`legs.find(l => l.data.seat === critic)`) compares data.seat against o.critic,
  // an alias, and workspace-seats.js / live-seats.js read it too (PR4/PR5).
  expect(units[0].firstFailures.map(f => f.seatId)).toEqual(['deepseek#1', 'deepseek#2']);
  expect(units[0].firstFailures.map(f => f.seat)).toEqual(['deepseek', 'deepseek']);
});

test('H4: twin LENS seats get separate units — lensIndexOf must not use indexOf', () => {
  const seats = buildSeats(['deepseek', 'deepseek'], null, ['risk', 'cost']);
  const o = { runId: 'r1', models: ['deepseek', 'deepseek'], critic: null,
    lenses: ['risk', 'cost'], seats };
  const d1 = { modelInput: 'deepseek', status: 'error' };
  const d2 = { modelInput: 'deepseek', status: 'error' };
  const units = groupStage1Losses(o, [], [d1, d2], new Map([[d1, seats[0]], [d2, seats[1]]]));
  expect(units.map(u => u.waveId)).toEqual(['r1-l1r1', 'r1-l2r1']);
});

test('a twin bench whose retry heals BOTH seats emits no degrade and exits clean', async () => {
  let call = 0;
  const ctx = makeCtx({ models: ['deepseek', 'deepseek'],
    onWave: (opts) => { call += 1;
      return call === 1
        ? okWave([deadLeg('deepseek', 'error', 'boom', opts.waveId, 1),
          deadLeg('deepseek', 'error', 'boom', opts.waveId, 2)], opts.waveId)
        : okWave([mkLeg('deepseek', review(), 'complete', opts.waveId, 1),
          mkLeg('deepseek', review(), 'complete', opts.waveId, 2)], opts.waveId); } });
  const r = await runStage1(ctx);
  expect(r.degraded).toBe(false);
  expect(ctx._notes.map(n => n.channel)).toEqual(['stage1-retry', 'stage1-retry']);
});
```

- [ ] **Step 2: Run and watch fail**

```bash
npx jest tests/council/run-retry.test.js -t "H4"
```

Expected: FAIL — one unit, one model, one firstFailure, and `f.seatId` is `undefined`.

- [ ] **Step 3: Un-collapse, both points**

`recordFailure` (`:27-31`) — dedup on the **seat id**, falling back to the alias when no seat was identified (today's behaviour, and right: two unidentifiable losses on one alias must still collapse, because nothing distinguishes them):

```js
function recordFailure(unit, seat, ff, trackModel = true, seatObj = null) {
  const key = seatObj ? seatObj.id : seat;
  if (unit.firstFailures.some(f => f.seatId === key)) { return; }
  unit.firstFailures.push({ ...ff, seatId: key });
  if (trackModel) { unit.models.push(seat); unit.seats.push(seatObj); }
}
```

⚠️ **Keep `ff.seat` alias-valued and ADD `ff.seatId`.** `ff.seat` is minted by the caller (`run-retry-group.js:83-84`) from `leg.modelInput || leg.model` and is read by all four note builders and by `run-retry.js:130`/`:175`; `data.seat` flows to `verdict.js:72`, `workspace-seats.js` and `live-seats.js` (PR4/PR5).

`lensIndexOf` (`:10-15`) — take the seat's position instead of the alias's first index:

```js
/** 1-based lens index for a loss: the waveId convention, else the seat's own
 *  bench position. The old `o.models.indexOf(model)` was first-match, so twin
 *  aliases both resolved to the FIRST twin's lens and shared one retry unit —
 *  and the deadLegs loop passes waveId=null, so that branch was the only one
 *  those losses could take. */
function lensIndexOf(o, waveId, model, seatObj = null) {
  const m = /-l(\d+)$/.exec(waveId || '');
  if (m) { return Number(m[1]); }
  if (seatObj && Number.isInteger(seatObj.position)) { return seatObj.position; }
  const i = (o.models || []).indexOf(model);
  return i === -1 ? null : i + 1;
}
```

and `:86`: `const u = lensUnitFor(lensIndexOf(o, null, seat, seatOf.get(leg) || null));`

- [ ] **Step 4: Seat-key the re-collapse points in `run-retry.js`**

Re-derive with `grep -n "launchedSeats\|notedSeats\|seenSeats\|f\.seat\|=== seat" src/council/run-retry.js`. **Do not use** `grep -n "new Set(\|\.find(f => f.seat\|=== seat" …` — verified at HEAD, it returns only `:110, :125, :126, :130, :156, :170, :175, :181` and matches **neither `:171` nor `:172`**.

| Line | Today | After |
|---|---|---|
| `:110`,`:114` | `notedSeats` Set of aliases from `w.models` | Set of seat ids from `w.seats`, falling back to the alias |
| `:126` | `seenSeats = new Set(legs.map(alias))` | Set of bound seat ids from `bindRes.bound`, plus aliases for orphans |
| `:130` | `unit.firstFailures.find(f => f.seat === seat)` | `f.seatId === boundSeatId` |
| `:156`,`:181` | `unit.srcLegs.find(l => alias === seat)` | match on the bound seat, else the alias |
| `:170`,`:171`,`:172` | THREE feeders build `launchedSeats`: `new Set(unit.models)`, then every srcWave's `w.models`, then every srcLeg's alias — the last two are **aliases**, and `unit.seats` may hold `null` (so `unit.seats.map(s => s.id)` **throws**) | replace all three together, keying an unidentified source by its alias exactly as `recordFailure`'s `const key = seatObj ? seatObj.id : seat;` does, so `:130`/`:175`'s lookups still match (see below) |
| `:175` | `unit.firstFailures.find(f => f.seat === seat)` | `f.seatId === seatId` |

```js
    const seatKey = (s, alias) => (s ? s.id : alias);
    const launchedSeats = new Set(unit.seats.map((s, i) => seatKey(s, unit.models[i])));
    for (const w of unit.srcWaves) {
      (w.models || []).forEach((m, i) => launchedSeats.add(seatKey((w.seats || [])[i], m)));
    }
    for (const l of unit.srcLegs) { launchedSeats.add(seatKey(seatOf.get(l) || null, l.modelInput || l.model)); }
```

⚠️ `:161-169`'s comment documents the CRITICAL fix that every launched seat lands in exactly one of recovered / still-dead / skipped. Leaving `:171`/`:172` alias-keyed makes `launchedSeats` a **mix** — executed for a twin bench it is `["deepseek#1","deepseek#2","deepseek"]` — while `seenSeats` is now seat ids, so the stray alias never matches and the reconcile emits a phantom dead-leg degrade for a run where BOTH twins healed: `degraded: true`, exit 2, on a fully recovered run.

- [ ] **Step 4b: update the four exact-match pins `{...ff, seatId: key}` breaks**

`toEqual` is exact. Every `seatId` below equals its alias — that IS the byte-identity claim for a unique-alias bench, so pin it rather than loosening to `toMatchObject`.

`tests/council/run-retry.test.js:24-27` →
```js
    expect(u.firstFailures).toEqual([
      { seat: 'a', class: 'wave', waveId: 'r1-s1', reason: 'server never started', seatId: 'a' },
      { seat: 'b', class: 'wave', waveId: 'r1-s1', reason: 'server never started', seatId: 'b' },
    ]);
```
`:37` →
```js
    expect(units[1].firstFailures).toEqual([{ seat: 'crit', class: 'leg', status: 'timeout', reason: null, seatId: 'crit' }]);
```
`:284` →
```js
    expect(u.firstFailures[0]).toEqual({ seat: 'a', class: 'leg', status: 'error', reason: 'boom', seatId: 'a' });
```
`tests/council/degrade-channels.test.js:119-121` →
```js
    expect(dead.data).toEqual({ seat: 'beta', status: 'timeout', reason: 'no first token',
      firstFailure: { seat: 'beta', class: 'leg', status: 'timeout', reason: 'no first token', seatId: 'beta' },
      retryWaveId: 'r1-s1r1' });
```

- [ ] **Step 4c: the sixth re-collapse point — the retry-abort return**

`run-stages.js:74-82`'s `healed` Set is alias-keyed and is **outside** `run-retry.js`. Before H4 a twin pair shared one retry unit, so at most one could heal and the alias Set was harmless. After Step 3 both twins retry; if one heals and the other does not, a later unit's abort makes `healed.has('deepseek')` true for BOTH — the still-dead twin is filtered out of `deadLegs` **and** `deadWaves[].models` and is recorded as if it had reviewed. `run.js` persists that return into stage-1 state.

```js
  if (retry.aborted) {
    // Seat-keyed since v4.8 H4: two twin seats now retry independently, so an
    // alias Set marks BOTH healed the moment one of them is, and the still-dead
    // twin silently disappears from deadLegs and deadWaves.
    const healedSeatIds = new Set(retry.recoveredLegs.map((l) => {
      const s = retry.seatOf.get(l);
      return s ? s.id : (l.modelInput || l.model);
    }));
    const keyOf = (l) => { const s = seatOf.get(l); return s ? s.id : (l.modelInput || l.model); };
    return { aborted: retry.aborted, reviews: [], degraded: false, extraRows: [],
      deadLegs: deadLegs0.filter(l => !healedSeatIds.has(keyOf(l))),
      deadWaves: allDeadWaves.map((w) => {
        const keep = (w.models || []).map((m, i) => ({ m, s: (w.seats || [])[i] || null }))
          .filter(({ m, s }) => !healedSeatIds.has(s ? s.id : m));
        return { ...w, models: keep.map(x => x.m), seats: keep.map(x => x.s) };
      }).filter(w => w.models.length > 0) };
  }
```

(`allDeadWaves` is Task 7's binding; until Task 7 lands, this reads `deadWaves`. Task 7 changes the one identifier.)

- [ ] **Step 5: Verify + MUTATION-TEST the un-collapse**

```bash
npx jest tests/council/run-retry.test.js tests/council/run-stages.test.js tests/council/degrade-channels.test.js
```

Revert the dedup key to the alias and confirm RED.

⚠️ **Restore from a byte copy, never `git checkout --`.** The files you are mutating hold UNCOMMITTED work from Steps 3-4c, and `git checkout -- <file>` reverts to HEAD — silently discarding that work along with the mutation. (This happened for real on Task 2.) The recipe below is independent of git state.

```bash
node -e "const fs=require('fs');const f='src/council/run-retry-group.js';fs.copyFileSync(f,f+'.bak');const s=fs.readFileSync(f,'utf8');const m=s.replace('f.seatId === key','f.seat === seat');if(m===s){console.error('MUTATION DID NOT APPLY');process.exit(1)}fs.writeFileSync(f,m)"
npx jest tests/council/run-retry.test.js
node -e "const fs=require('fs');const f='src/council/run-retry-group.js';fs.copyFileSync(f+'.bak',f);fs.unlinkSync(f+'.bak')"
git diff --stat src/council/run-retry-group.js
```

Repeat the same copy/mutate/restore shape for `launchedSeats` in `src/council/run-retry.js` (mutate it back to `new Set(unit.models)` plus the two alias feeders). Both must go RED, and each mutation must report that it applied — a mutation that silently fails to apply reads as a pass. After each restore, confirm `git diff --stat` shows the file still carrying your Step 3-4c work.

- [ ] **Step 6: Commit**

```bash
git add -A && npm run check:sizes && npm run lint
git commit -m "feat(council): H4 - two dead twin seats retry as two seats"
```

---

## Task 7: route missing seats into the retry, and announce what it does not save

**Files:**
- Modify: `src/council/run-stages.js` (`:63`'s destructure, after the bind, `:72`, `:81`, `:84-93`)
- Modify: `src/council/run-retry-group.js` (all three dead-wave branches, incl. the critic branch at `:73-76`)
- Modify: `src/council/run-retry.js` (`:143-146`, `:152`, `:177`)
- Modify: `src/council/run-retry-notes.js` (**all three** still-dead builders)
- Test: `tests/council/run-stages.test.js`, `tests/council/degrade-channels.test.js`

- [ ] **Step 1: Write the failing test**

```js
test('a partial wave return is retried, and healing it emits NO degrade', async () => {
  let call = 0;
  const ctx = makeCtx({ models: ['a', 'b'],
    onWave: (opts) => { call += 1;
      return call === 1
        ? okWave([mkLeg('a', review(), 'complete', opts.waveId, 1)], opts.waveId)   // b missing
        : okWave([mkLeg('b', review(), 'complete', opts.waveId, 1)], opts.waveId); } });
  const r = await runStage1(ctx);
  expect(r.reviews.map(x => x.model).sort()).toEqual(['a', 'b']);
  expect(r.degraded).toBe(false);
  // ctx._notes holds the RAW note argument (run-stages.test.js:90), and no degrade
  // builder in this path sets `kind` — it is defaulted inside makeDegrade
  // (utils/degrade.js:29), which this stub sink never calls. Only the heal sets one
  // (run-retry.js:142), so `n.kind === 'degrade'` is [] for every run, degraded or
  // not. Assert on the channels that actually appear.
  expect(ctx._notes.map(n => n.channel)).toEqual(['stage1-retry']);
  expect(ctx._notes.filter(n => n.kind !== 'heal')).toEqual([]);
});

test('a partial return the retry cannot save degrades on seat-unbound, with honest prose', async () => {
  let call = 0;
  const ctx = makeCtx({ models: ['a', 'b'],
    onWave: (opts) => { call += 1;
      // Wave 1 returns only a's leg, so seat b is unbound and is routed into the
      // retry. The RETRY wave must NOT return anything that can bind to b: an
      // 'a'-labelled leg stamped `${waveId}-1` binds to seat b BY SLOT
      // (seats.js:139-140, verified) and HEALS. An off-roster alias in an
      // out-of-range slot is an orphan, so b reaches the reconcile loop as a
      // still-missing seat and missingLegStillDeadNote — the builder that
      // actually fires — is exercised.
      return call === 1
        ? okWave([mkLeg('a', review(), 'complete', opts.waveId, 1)], opts.waveId)
        : okWave([mkLeg('zzz', review(), 'complete', opts.waveId, 9)], opts.waveId); } });
  const r = await runStage1(ctx);
  expect(r.degraded).toBe(true);
  const note = ctx._notes.find(n => n.channel === 'seat-unbound' && n.data.seat === 'b');
  expect(note).toBeDefined();
  expect(note.why).toContain('returned 1 of 2 legs');
  expect(note.why).not.toContain('produced no legs');    // the first wave DID produce legs
  expect(note.why).not.toContain("ended 'undefined'");   // there was never a leg for this seat
});
```

- [ ] **Step 2: Run and watch fail**

```bash
npx jest tests/council/run-stages.test.js -t "partial wave return"
```

Expected: FAIL — seat `b` vanishes silently; `r.degraded` is `false`, there is no second wave, and no note carries channel `seat-unbound`.

- [ ] **Step 3: Route them in**

`run-stages.js` — widen the destructure and append to the retry's dead-wave input:

```js
  const { seatOf, missingSeats, orphanLegs } = bindStage1Waves(waves);
  for (const { waveId, leg } of orphanLegs) { ctx.degrade.note(orphanLegNote(waveId, leg)); }
  // R-B: a launched seat whose leg never came back is a LOSS, not a curiosity.
  // It reaches the retry as a single-seat dead wave flagged `partial` so its
  // prose stays true — the wave did produce legs, just not this seat's.
  const allDeadWaves = [...deadWaves, ...missingSeats.map(missingSeatDeadWave)];
```

Add `missingSeatDeadWave` to the `./stage1-bind` require. Pass `allDeadWaves` to `retryStage1Losses` at `:72`, and use it in the abort filter at `:81` (Task 6 Step 4c already writes `allDeadWaves` there).

`run-retry-group.js` — **all three** dead-wave branches carry the flag. The lens and bench branches:

```js
      models.forEach((seat, idx) => recordFailure(u, seat,
        { seat, class: w.partial ? 'missing' : 'wave', waveId: w.waveId, reason: w.reason },
        true, (w.seats || [])[idx] || null));
```

and the critic branch at `:73-76` — `missingSeatDeadWave` stamps `waveId: m.waveId`, so a partial `-c1` record matches `isCriticWave` (`:42-43`) and would otherwise be recorded `class: 'wave'`:

```js
    } else if (isCriticWave(w)) {
      criticUnit.srcWaves.push(w);
      recordFailure(criticUnit, o.critic,
        { seat: o.critic, class: w.partial ? 'missing' : 'wave', waveId: w.waveId, reason: w.reason }, false);
    }
```

`run-retry.js` — `grep -rn "ff\.class" src/` returns **five** sites: `run-retry-notes.js:44`, `:65` and `run-retry.js:144`, `:152`, `:177`.
- `:143-146` (the heal's `why`) gains a `missing` arm:
  ```js
          why: ff.class === 'wave'
            ? `its first wave ${ff.waveId} produced no legs (${ff.reason}) and was relaunched once`
            : ff.class === 'missing'
              ? `${ff.reason} in wave ${ff.waveId}, and it was relaunched once`
              : `its first leg ended '${ff ? ff.status : 'unknown'}' with no usable output and was relaunched once`,
  ```
- `:152` and `:177`: change `ff.class === 'wave'` to `ff.class !== 'leg'` so a `missing` loss routes with the wave-origin half into `lostWaveSeats` — it has a `waveId` and no `srcLeg`, so the else branch would drop it from every array.

`run-retry-notes.js` — **all three** still-dead builders take the flag. `waveStillDeadNote` is reachable only from `run-retry.js:112` (the wholesale-death branch); a partial loss the retry cannot save normally reaches `retryLegStillDeadNote` (`:150`) or `missingLegStillDeadNote` (`:176`), and both hard-code `channel: 'dead-leg'`. A `missing` ff has a `reason` and a `waveId` but **never** a `status` — without the `missing` arm both render `the leg ended 'undefined'` (verified by executing them at HEAD).

```js
function waveStillDeadNote(w, unit) {
  const partial = !!w.partial;
  return { channel: partial ? 'seat-unbound' : 'dead-wave',
    what: partial
      ? `seat ${(w.models || [])[0]} did not review`
      : `Stage-1 wave ${w.waveId} (${(w.models || []).join(', ') || 'no models'}) produced NO legs`,
    why: `${w.reason || 'no reason recorded'}; the once-only retry wave also produced no legs`,
    effect: 'Those seats are NOT in this council. The run continues with the bench that did '
      + 'launch and will exit degraded (2)',
    // `seat` rides ONLY on the partial shape: adding it unconditionally breaks
    // degrade-channels.test.js's exact toEqual on a real dead wave. It stays
    // the ALIAS — verdict.js:72 compares data.seat against o.critic.
    data: { waveId: w.waveId, models: w.models, reason: w.reason, retryWaveId: unit.waveId,
      ...(partial ? { seat: (w.models || [])[0] } : {}) } };
}

function retryLegStillDeadNote(seat, ff, retryLeg, unit, counts) {
  const missing = !!(ff && ff.class === 'missing');
  const why = ff && ff.class === 'wave'
    ? `its first wave ${ff.waveId} produced no legs (${ff.reason}); `
      + `its once-only retry leg ended '${retryLeg.status}' with no usable output`
    : missing
      ? `${ff.reason} in wave ${ff.waveId}; its once-only retry leg ended `
        + `'${retryLeg.status}' with no usable output`
      : `the leg ended '${ff ? ff.status : 'unknown'}'${ff && ff.reason ? `: ${ff.reason}` : ''} `
        + `with no usable output; its once-only retry also ended '${retryLeg.status}'`;
  return { channel: missing ? 'seat-unbound' : 'dead-leg',
    what: `seat ${seat} did not review`, why,
    effect: legEffect(counts),
    data: { seat, status: retryLeg.status, reason: retryLeg.error || null,
      firstFailure: ff, retryWaveId: unit.waveId } };
}

function missingLegStillDeadNote(seat, ff, unit, counts) {
  const missing = !!(ff && ff.class === 'missing');
  const fact = ff && ff.class === 'wave'
    ? `its first wave ${ff.waveId} produced no legs (${ff.reason})`
    : missing
      ? `${ff.reason} in wave ${ff.waveId}`
      : `the leg ended '${ff ? ff.status : 'unknown'}'${ff && ff.reason ? `: ${ff.reason}` : ''} with no usable output`;
  return { channel: missing ? 'seat-unbound' : 'dead-leg',
    what: `seat ${seat} did not review`,
    why: `${fact}; its once-only retry produced no leg for this seat`,
    effect: legEffect(counts),
    data: { seat, status: null, reason: null, firstFailure: ff, retryWaveId: unit.waveId } };
}
```

`run-stages.js:84-93` — the skipped-dead-wave loop does the same:

```js
  for (const d of retry.skippedDeadWaves) {
    ctx.degrade.note({
      channel: d.partial ? 'seat-unbound' : 'dead-wave',
      what: d.partial
        ? `seat ${(d.models || [])[0]} did not review`
        : `Stage-1 wave ${d.waveId} (${d.models.join(', ') || 'no models'}) produced NO legs`,
      why: d.reason,
      effect: 'Those seats are NOT in this council. The run continues with the bench that did '
        + 'launch and will exit degraded (2)',
      data: { waveId: d.waveId, models: d.models, reason: d.reason,
        ...(d.partial ? { seat: (d.models || [])[0] } : {}) },
    });
  }
```

- [ ] **Step 4: Verify + prove no double-announce**

```bash
npx jest tests/council/run-stages.test.js tests/council/degrade-channels.test.js tests/council/run-retry.test.js tests/council/verdict.test.js
```

Add two negative pins:
1. A **wholly** dead wave still emits exactly one `dead-wave` note and **zero** `seat-unbound` notes — `bindStage1Waves` skips zero-leg waves precisely to guarantee this, and a regression is invisible without the pin.
2. A 3-seat wave that returns 1 leg and whose retry saves neither missing seat yields exactly **one** `stillDeadWaves` entry with `models` `['b','c']` — proving the `reconciled` Set in Task 5 Step 5 collapses the repeated waveId.

- [ ] **Step 5: Commit**

```bash
git add -A && npm run check:sizes && npm run lint
git commit -m "feat(council): a seat whose leg never returned is retried, then announced"
```

---

## Task 8: dead-seat rows key on seats

**Files:**
- Modify: `src/council/run-stage1-rows.js` (whole file)
- Modify: `src/council/run-retry.js` (`out.attemptedSeats`)
- Modify: `src/council/run-stages.js` (`:231`)
- Test: `tests/council/run-stages.test.js`, `tests/council/run-assemble.test.js`

**Why `attemptedSeats` and not the notes:** `:46-49` derives "was this seat retried?" by scanning `retry.stillDeadNotes` for `n.channel === 'dead-leg' && n.data.seat`. Seat-keying `deadAliases` while `data.seat` stays an alias makes `attemptedAliases.has(seatId)` **always false** for a twin, so `finalLeg` falls through to `deadLegs0.find(...)` and re-attaches a first-attempt leg to a seat that WAS retried — the phantom pairing the `:33-43` comment says E5 was amended to eliminate. Structured data sidesteps it **and** keeps `data.seat` alias-valued for `verdict.js:72`, `workspace-seats.js` and `live-seats.js`.

⚠️ Row `model` stays the **alias** — spec §4.7: a seat id must never appear in a ledger row, because `pickFallbackChair` launches `top.aliases[0]`. Two rows with `model:'deepseek'` is the correct count; the ledger's `(model, resolvedModel)` grouping is **PR4**.

- [ ] **Step 1: Write the failing tests**

```js
test('two dead twin seats produce TWO dead-seat rows, not one', async () => {
  const ctx = makeCtx({ models: ['deepseek', 'deepseek'],
    onWave: (opts) => okWave([deadLeg('deepseek', 'error', 'boom', opts.waveId, 1),
      deadLeg('deepseek', 'error', 'boom', opts.waveId, 2)], opts.waveId) });
  const r = await runStage1(ctx);
  const primary = r.extraRows.filter(x => x.role !== 'repair' && x.role !== 'superseded');
  expect(primary).toHaveLength(2);
  expect(primary.every(x => x.model === 'deepseek')).toBe(true);   // ledger rows stay routable
});

test('a partially healed dead wave yields exactly ONE dead-seat row, for the seat that stayed lost', async () => {
  let call = 0;
  const ctx = makeCtx({ models: ['a', 'b'],
    onWave: (opts) => { call += 1;
      return call === 1
        ? okWave([], opts.waveId)                                                    // whole wave dies
        : okWave([mkLeg('a', review(), 'complete', opts.waveId, 1)], opts.waveId); } }); // only a heals
  const r = await runStage1(ctx);
  const primary = r.extraRows.filter(x => x.role !== 'repair' && x.role !== 'superseded');
  expect(primary).toHaveLength(1);
  expect(primary[0].model).toBe('b');
});

test('a dead twin LENS seat gets its own lens role on its row', async () => {
  const ctx = makeCtx({ models: ['deepseek', 'deepseek'], lenses: ['risk', 'cost'],
    onSolo: (opts) => ({ wave: { waveId: opts.waveId, legs: [] }, exitCode: 0, leg: null }) });
  const r = await runStage1(ctx);
  const primary = r.extraRows.filter(x => x.role !== 'repair' && x.role !== 'superseded');
  expect(primary.map(x => x.role).sort()).toEqual(['lens:cost', 'lens:risk']);
});
```

- [ ] **Step 2: Run and watch fail**

Expected: FAIL — one row, because `deadAliases` is a `Set` of alias strings.

- [ ] **Step 3: Implement**

`run-retry.js` — add to `out` (`:44-46`) `attemptedSeats: new Set()` and add the seat key wherever a still-dead note is pushed (`:120`, `:150`, `:176`), using the same `seatKey(s, alias)` helper Task 6 introduced.

`run-stage1-rows.js` — `roleAt` and `seatOf` arrive as **parameters**, never requires (`:6-8` documents why). Full replacement body:

```js
/** Push superseded-seat and primary-error dead-seat rows onto extraRows. */
function pushDeadSeatRows({ o, retry, deadLegs0, stillDeadLegs, stillDeadWaves, extraRows,
  roleFor, roleAt, seatOf }) {
  const keyOf = (leg) => { const s = seatOf.get(leg); return s ? s.id : (leg.modelInput || leg.model); };

  // Superseded rows: a leg-origin seat's FIRST leg stops being primary the moment
  // a retry was actually attempted for it, healed or not.
  const supersededKeys = new Set([
    ...retry.recoveredLegs.map(keyOf),
    ...retry.stillDeadLegs.map(keyOf),
  ]);
  for (const dead of deadLegs0) {
    if (supersededKeys.has(keyOf(dead))) {
      extraRows.push(buildRunStatsEntry({ leg: dead, model: dead.modelInput || dead.model,
        role: 'superseded', wasChair: false }));
    }
  }

  // Primary error rows: one per SEAT with no surviving review.
  const retryLegBySeat = new Map();
  for (const leg of retry.stillDeadRetryLegs) { retryLegBySeat.set(keyOf(leg), leg); }

  const deadSeats = new Map();   // seat key -> { seat, alias }
  for (const l of stillDeadLegs) {
    const s = seatOf.get(l) || null;
    const alias = l.modelInput || l.model;
    deadSeats.set(s ? s.id : alias, { seat: s, alias });
  }
  for (const w of stillDeadWaves) {
    // models and seats are narrowed in LOCKSTEP by run-retry.js's reconcile, so
    // index-zipping them is safe here and nowhere else.
    (w.models || []).forEach((alias, i) => {
      const s = (w.seats || [])[i] || null;
      deadSeats.set(s ? s.id : alias, { seat: s, alias });
    });
  }

  for (const [key, { seat, alias }] of deadSeats) {
    let finalLeg = retryLegBySeat.get(key);
    if (!finalLeg) {
      finalLeg = retry.attemptedSeats.has(key)
        ? null                                                     // retried; no leg at all for this seat
        : (deadLegs0.find(l => keyOf(l) === key) || null);         // never retried
    }
    extraRows.push(buildRunStatsEntry({ leg: finalLeg, model: alias,
      role: seat ? roleAt(o.seats, seat.id) : roleFor(o, alias), wasChair: false }));
  }
}
```

Update the call at `run-stages.js:231` to pass `roleAt` and **`allSeatOf`** (the Stage-1 ∪ retry union from Task 5), **not** the Stage-1 `seatOf` — `retry.recoveredLegs` and `retry.stillDeadRetryLegs` are retry-wave leg objects, absent from the Stage-1 map.

- [ ] **Step 4: Verify + commit**

```bash
npx jest tests/council/run-stages.test.js tests/council/run-assemble.test.js tests/council/run-cost-bijection.test.js tests/council/ledger.test.js
git add -A && npm run check:sizes && npm run lint
git commit -m "feat(council): dead-seat rows key on the seat, not the alias"
```

⚠️ `run-cost-bijection.test.js`'s six scenarios (`:212`, `:293`, `:318`, `:338`, `:377`, `:400`) are **all unique-alias benches** — it is not a twin gate. It will pass whether or not the twin accounting is right; the twin proof is Step 1's tests.

---

## Task 9: CHANGELOG, BACKLOG, and the whole-suite gate

**Files:** `CHANGELOG.md` (the `## [Unreleased]` / `### Changed` block at `:6-8`), `BACKLOG.md`

- [ ] **Step 1: CHANGELOG — five entries**

1. **The `roleFor` → `roleAt` behaviour change** (its own line, per PR1's handoff): under `--lenses`, a bench that repeats an alias now gives each seat **its own** lens. Previously `o.models.indexOf` returned the first twin's index for both, so `--models a,a --lenses risk,cost` gave both seats `lens:risk`. Benches with no repeated alias are unaffected.
2. **A seat whose leg never came back is no longer silent.** Previously a partial wave return dropped that seat with no note, no row, and exit 0. It is now retried once like any other Stage-1 loss and — only if the retry does not recover it — announced on the new `seat-unbound` degrade channel, so the run exits 2.
3. **A bench that repeats an alias now retries and files both seats.** Two dead twin seats produce two retry legs, two heals and two review files instead of one; reviews are written as `review-<seat>.md`.
4. **`verdict.json`'s seat-loss text changes for partial returns.** A partial-return loss now reaches `verdict.js`'s `summarizeSeatLoss` through run.json's `deadWaves`, so runs that previously showed nothing now report the lost seat. Intended by R-B — say so rather than letting it read as drift.
5. **Known limitation (R-A):** for a bench that repeats an alias, the Council Workspace does not yet list the per-seat review files — `artifact-guard.js` still builds its allowlist from a de-duplicated bench. The files are written and complete; only the Workspace listing lags. Name the release that closes it.

- [ ] **Step 2: BACKLOG — the PR5 hard prerequisite and three PR4 items**

Record: `src/workspace/artifact-guard.js:86`'s `uniqueModels = [...new Set(bench)]` must build from `o.seats` **before** PR5's workspace flip; its `:81-85` comment's stated intent inverts (spec §4.5); there is currently **zero** twin-bench coverage in `tests/workspace/` or `tests/electron/`. PR4 items: `verdict.js`'s `seatLoss` (`:68`/`:71`) and both Workspace dead-seat renderers (`workspace-seats.js:64`, `live-seats.js:193`) gate on `dead-leg`/`dead-wave` and are **blind to `seat-unbound`**; and `run-stage2.js:57` builds its judge roster from `reviews[].modelInput`, so a twin bench pays for two judge legs and clobbers one `judge-<alias>.md` — pre-existing, made more reachable by PR2b.

- [ ] **Step 3: Full gates**

```bash
npm test
```
```bash
npm run lint
```
```bash
npm run check:sizes
```

Baseline to beat: **518 suites / 7132 passed / 8 skipped / 0 failed**. Suite count may rise; failures must be zero. **Never `| tail`.**

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs: v4.8 PR2b changelog + the artifact-guard prerequisite for PR5"
```

---

## Spec coverage

| Scope item | Task |
|---|---|
| (a) `launchStage1` additive per-wave `waves` | 1 |
| (b) retry-path additive roster | 5 |
| (c) H4 un-collapse in `run-retry-group.js` | 6 |
| (d) `bindSeats` once per wave at every Stage-1/retry consumer | 2 (Stage-1), 5 (retry) |
| (e) `roleFor` → `roleAt` at both flip sites | 4, 8 |
| (f) `materializeReviews` uses `artifactName(seat,'review')` | 3 |
| (g) new degrade channel + first emitter | 2 (channel + orphan emitter), 7 (missing-seat emitter) |
| Owner ruling R-B | 2, 7 |
| Owner ruling R-A disclosure | 9 |

**Explicitly OUT of scope (PR3–PR5, per PR2a's forbid-list):** `run-stage2.js` and `describe('runStage2')` in `run-stages.test.js`; `run-debate.js`/`debate.js`; `tally.js` (including the `runStats` `seat` field and `sameModelCorroboration`); `ledger.js`'s `(model, resolvedModel)` grouping; `verdict.js`'s critic tests; `report.js`/`report-html.js`; `blind-mode.js`; `live-model.js`; `workspace-panels.js`; `run-detail.js`; `artifact-guard.js`; `run-assemble.js`'s `meta.models`.
