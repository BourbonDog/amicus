# v4.8 PR2a — Seat-binding prerequisites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the two things Stage-1/retry seat binding needs first — test fixtures that emit legs real fanout could produce, and an incoherent option pair refused pre-spend. **No binding, and no change to any join.**

**Architecture:** PR2 was split after refutation found a fatal ordering defect in the combined draft. A second refutation pass then moved the seam again: **the retry un-collapse (H4) is NOT in this PR.** Un-collapsing `groupStage1Losses` while every downstream join stays alias-keyed launches two paid legs where one launched before, both writing the same review file — and the un-collapse is unimplementable without the leg→seat mapping that only `bindSeats` provides. H4 therefore lands in **PR2b**, behind the retry-side roster and the binding that make it safe.

**Tech Stack:** Node ≥22.12 CommonJS, jest, eslint.

**Provenance:** spec §4.4/§4.5, re-measured at `7cd32f8` by a 7-agent recon; a 4-agent refutation of the combined PR2 draft (119 claims, 19 Critical) forced the first split; a 2-agent refutation of this plan (85 claims, 5 Critical) forced the second and is folded in below.

## Global Constraints

- Hard **300 lines/file** gate (`scripts/check-file-sizes.js:18-19`; 300 passes, 301 fails). `--all` only measures TRACKED files — `git add` first. Tests are not gated. `seats.js` is 250/300.
- `src/` may cite the **spec**, never a plan path (`tests/docs-plan-refs.test.js`).
- `npm test` before `git push`. Never `npm test -- <path>`. Single suites: bare `npx jest <path>`. Never `| tail`.
- `npx jest --listTests` must be non-empty before trusting any RED.
- Line endings: `eol=lf`.

## Owner rulings

1. **Split PR2** (2026-08-12).
2. **H2 — `preflightSeats` rejects `critic` + `lenses` together.** Both handlers already enforce the XOR (`cli-handlers-council-run.js:149-159`, `mcp-council-run.js:122`), so no shipped entry point regresses.
3. **Fix the fixtures; never loosen `bindSeats`.**

## Why H4 moved to PR2b (evidence, so it is not re-litigated)

Landing the un-collapse alone would be a **behaviour change for the worse**, not neutral groundwork. With `o.models = ['deepseek','deepseek','x']` and both twins' Stage-1 legs dead:

- `run-retry.js:93` would launch `launchWave({models: ['deepseek','deepseek']})`; `parseModelsList` does not dedup, so **two real, paid legs launch where one launched before**.
- Both returned legs carry `modelInput: 'deepseek'`, so `run-retry.js:130`'s `unit.firstFailures.find(f => f.seat === seat)` returns the first entry for both.
- `run-launch.js:197` writes `review-${sanitizeName(modelInput)}.md` for both — the second **overwrites** the first, and both are pushed to `recoveredLegs`, producing two review entries pointing at one file.
- `run-retry.js:170`'s `new Set(unit.models)` re-collapses the duplicates anyway.

And it is unimplementable as specified: `groupStage1Losses`' inputs are dead waves (`{waveId, models:[alias]}`) and dead legs (`{modelInput, status, error}`) — **aliases only**. The only identity carrier is the leg's slot id, decoding which *is* `bindSeats`; and that slot indexes the **wave roster**, not the bench (`run-stage1-launch.js:47` filters the critic out of `-s1`), so `o.seats[slot-1]` mis-attributes every seat after a bench critic.

## Corrections folded in (do not re-derive)

| Earlier draft claimed | Truth at `7cd32f8` |
|---|---|
| slot = "the leg's position within its wave" | **Slot = the leg's 1-based index in the wave's LAUNCH ROSTER**, not in the returned legs array (`fanout.js:136` passes the launch plan's length; `seats.js:140` consumes it as `roster[n-1]`). The SL-2 fixtures return partial and even stray legs, so the two differ |
| Step 5's binding test proves the fixtures correct | It passes **vacuously** on `waveId`: `seats.js:133` INCLUDES a leg with no `waveId`, and `:138-140` then binds on `taskId` alone. A fixture that forgets `waveId` entirely still shows `bound.length === roster.length` |
| "Import the builders if they are exported" | They are **not exported**, and these are `.test.js` files — `require()`ing one re-registers its whole suite |
| The 37 invocations are at these 21 line numbers | The enumerated list covers **21 of 37**; 16 more at `:437,:450,:498,:536,:538,:585,:632,:634,:657,:692,:694`. One (`:585`) IS in a callback with `opts`. Treat any list as illustrative and re-derive by grep |
| Task 2's `grep "lenses" tests/ \| grep -i critic` | ~130 hits, nearly all `critic: null, lenses: null` boilerplate, and it misses base/override suites entirely. **Verified answer: no suite reaches `preflightSeats`/`runCouncil` with both set**, so Task 2 turns nothing RED |
| `buildSeats` "makes every role `lens:*` under lenses" | Only where a lens covers that index — `seats.js:62-65` leaves trailing seats `'seat'` when `lenses` is shorter than the bench (pinned `seats.test.js:49-51`) |

## Scope note

**No binding, no joins, no roles.** `bindSeats` is not called from `src/`. `launchStage1`'s return, the retry-side roster, `run-retry-group`'s un-collapse (H4), every alias-keyed join in `run-retry.js`/`run-stages.js`/`run-stage1-rows.js`, `roleFor`→`roleAt`, `artifactName` filenames, and the degrade channel are all **PR2b**. `describe('runStage2')` in `run-stages.test.js` (`:705-1009`, 34 leg builders) is **PR3** and untouched.

## File Structure

| File | Change |
|---|---|
| `tests/council/run-stages.test.js` (1009) | Wave-stamp Stage-1 legs; reconcile off-bench models and mismatched wave ids |
| `tests/council/run-retry.test.js` | Wave-stamp legs; `ctx.o` gains `seats`/`criticSeat` |
| `tests/council/seat-fixtures.test.js` | **NEW.** Proves the fixtures actually bind |
| `tests/council/fake-launchers-ids.test.js` | Document the shared helper's global-counter foot-gun |
| `src/council/seats.js` (250) | Fifth rejection: critic + lenses |
| `tests/council/seats-preflight.test.js` | Its tests |
| `CHANGELOG.md` | `### Changed` — one behaviour change |

---

## Task 1: Fixtures that emit legs real fanout could produce

**Files:** `tests/council/run-stages.test.js`, `tests/council/run-retry.test.js`, `tests/council/seat-fixtures.test.js` (new), `tests/council/fake-launchers-ids.test.js`

**Why:** under `bindSeats` every leg in the two suites PR2b must change is an ORPHAN. PR0 fixed the shared helper but never reached these local copies. **Nothing in `src/` changes here** — the only production reader of `leg.waveId` is `run-assemble.js:70`, which spreads it when present.

**The three builders** (read all three first):
- `run-stages.test.js:22-26` — `mkLeg`, `taskId: \`${model}-${++legSeq}\``, no `waveId`.
- `run-stages.test.js:33-34` — `usableLeg`/`deadLeg` wrapping `mkLeg`; **37 in-scope invocations, 36 of them in `mockResolvedValueOnce` literals with no `opts`** (the exception is `:585`). Re-derive the full list with `grep -n "usableLeg(\|deadLeg(" tests/council/run-stages.test.js` and ignore anything at `:705+` (PR3).
- `run-retry.test.js:84-85` — `usableLeg`/`deadLeg` build bare `{modelInput, status, …}` literals with **no `taskId` at all**.

- [ ] **Step 1: Baseline**

Run: `npx jest tests/council/run-stages.test.js tests/council/run-retry.test.js` — record exact counts.

- [ ] **Step 2: Reconcile three pre-existing incoherences FIRST**

Correct stamping is impossible until these are fixed:

1. **Off-bench models.** `:446-450`, `:458-462`, `:471-475` call `makeCtx()` with the default bench `['gemini','gpt','qwen']` but return legs for `a`/`b`. **Pass `models: ['a','b']` to those three `makeCtx` calls** — do not rename the legs; the surrounding assertions read the model names.
2. **Mismatched wave ids.** `:436`, `:449`, `:462`, `:474` label mock waves `'r1-s1'` and `:437`, `:450` label them `'r1-s1r1'`, while `makeCtx` sets `runId: 'abc123'` (`:49`). Normalise to the `abc123-*` family.
3. **Model or wave-id changes are expected and allowed. Any OTHER asserted value changing means the fixture edit is wrong** — stop and report.

- [ ] **Step 3: Stamp the legs — slot = ROSTER index**

Give `mkLeg` and both local `usableLeg`/`deadLeg` an explicit `waveId` parameter; emit `taskId: \`${waveId}-${slot}\`` **and** `waveId` on the leg.

**`slot` is the leg's 1-based index in the wave's LAUNCH ROSTER, not its index in the returned array.** The rosters:
- `-s1` → `o.models.filter(m => m !== o.critic)` in bench order (`run-stage1-launch.js:47`).
- `-c1` / `-l{i}` → a one-seat roster, so slot is always 1.
- `-s1r1` (and other `*r1`) → the dead seats that `groupStage1Losses` grouped, in `deadWaves`-then-`deadLegs` order (`run-retry-group.js:82-96`). You must read that grouping to know the order — do not guess.

Two fixtures return legs the roster cannot explain. Handle them explicitly:
- `:512-514` returns `[usableLeg('b'), usableLeg('a')]` for a retry wave whose roster is `['b']` alone. **Give `'a'` an intentionally non-conforming id** (e.g. `stray-1`) and comment that it models an engine-impossible response, so PR2b's `orphanLegs` assertion on it is meaningful rather than accidental.
- `:674-678` returns only `b`'s leg for a roster of `['b','c']` — slot 1 is correct here, but say so in a comment, because the same shape with `c` alone would need slot 2.

- [ ] **Step 4: `run-retry.test.js`, including its ctx**

`fakeCtx` (`:69-83`) returns an object literal, so `o` is not a binding — compute it first. Copy the `launchers` line verbatim from the current source rather than the ellipsis:

```js
function fakeCtx(oOverrides = {}, opts = {}) {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl2-'));
  createdRunDirs.push(runDir);
  const notes = [];
  const o = { runId: 'r1', runDir, models: ['a', 'b', 'crit'], critic: 'crit', lenses: null,
    briefing: 'B', date: 'D', timeout: 5, gateway: undefined, noValidateModel: false,
    noCostGate: false, councilName: null, fallback: null, catalog: null, ...oOverrides };
  // Production sets these at run.js:133. Without them, PR2b's twin tests would
  // pass through a buildSeats fallback — green for the wrong reason.
  o.seats = buildSeats(o.models, o.critic, o.lenses);
  o.criticSeat = (o.seats.find(s => s.alias === o.critic) || {}).id || null;
  return {
    o,
    launchers: { launchWave: opts.launchWave || jest.fn(), launchSolo: opts.launchSolo || jest.fn() },
    degrade: { note: (r) => notes.push(r) },
    addWave: jest.fn(),
    overBudget: opts.overBudget || (() => false),
    _notes: notes,
  };
}
```

Add `const { buildSeats } = require('../../src/council/seats');` to its imports. A first-attempt `deadLeg` passed as INPUT to `groupStage1Losses` carries the ORIGINAL wave id (`r1-s1`, `r1-l2`), never the retry wave's.

**Do not touch any `firstFailures` assertion** — H4 moved to PR2b, so `:23-26`, `:36` and `:235` all stay exactly as they are.

- [ ] **Step 5: Prove the fixtures bind — this task's real gate**

Counts cannot verify this task, and neither can a naive bind assertion. Create `tests/council/seat-fixtures.test.js` covering, for a unique-alias bench AND a twin bench (`['deepseek','deepseek']` → ids `deepseek#1`/`deepseek#2`):

1. every fixture leg carries `leg.waveId === waveId` (assert this **before** calling `bindSeats` — `seats.js:133` admits unstamped legs, so binding alone cannot see a missing `waveId`);
2. `bindSeats(waveId, roster, legs)` gives `bound.length === roster.length`, empty `unbound`, empty `orphanLegs`;
3. the two twin legs bind to **distinct** seat ids — the alias fallback can never fire for twins (`seats.js:141-145` requires exactly one hit), so slot correctness is the only thing separating them;
4. a negative case: a leg whose `taskId` names a different wave lands in `orphanLegs`.

The builders are **not exported and these are `.test.js` files — never `require()` them.** Copy the shapes verbatim with a `// mirrors run-stages.test.js:23-26` comment so drift is visible.

- [ ] **Step 6: Document the shared helper's foot-gun**

In `tests/council/fake-launchers-ids.test.js`, add a test showing a **bare** `mkLeg(m, s, status, cost, waveId)` yields `${waveId}-<n>` where `n` is a **module-global counter, not a roster slot** — only the two dispatchers (`fake-launchers.js:35-37`, `:103-105`) rewrite it. Assert with a regex (`/^w-s1-\d+$/`), never a literal number: earlier tests in that file already advance the counter.

- [ ] **Step 7: Verify**

Run: the Step 1 command — counts identical except where Step 2 legitimately renamed a model or wave id (report every delta).
Run: `npx jest tests/council/seat-fixtures.test.js` — green.
Run: `npx jest tests/council` — 0 failures.

- [ ] **Step 8: Commit**

```bash
git add tests/council/run-stages.test.js tests/council/run-retry.test.js tests/council/seat-fixtures.test.js tests/council/fake-launchers-ids.test.js
git commit -m "test(council): Stage-1 and retry fixtures emit engine-shaped legs

PR0 fixed the shared helper, but both suites carry their own builders —
model-prefixed ids, no waveId — which bindSeats orphans. Slot ids index
the wave's launch roster, not the returned array. Also reconciles three
pre-existing incoherences: legs for off-bench models, mock wave ids from
a different runId, and a global counter used as a roster slot."
```

---

## Task 2: `preflightSeats` rejects `critic` + `lenses` (H2)

**Files:** `src/council/seats.js`, `tests/council/seats-preflight.test.js`

**Why:** `preflightSeats` sets `criticSeat` from `o.critic` without consulting `o.lenses` (`seats.js:236-246`), while `buildSeats` gives the critic's seat a `lens:*` role whenever a lens covers its index (`seats.js:62-65`) — so a direct-`require()` caller persists a `criticSeat` naming a lens-role seat.

**Verified, so you need not check:** no existing suite reaches `preflightSeats` or `runCouncil` with both set (every `runCouncil` fixture defaults `critic: null, lenses: null` at `fake-launchers.js:70` and overrides exactly one; both handler XORs fire first). **`seats.test.js:34-38` and `:59-63` DO construct both — via `buildSeats`, which this guard does not touch. They are PR1's deliberately pinned divergence and must not be modified.** If your own `grep -rn "preflightSeats\|runCouncil" tests/` surfaces a new both-set caller, stop and report.

- [ ] **Step 1: Write the failing test**

Append to `tests/council/seats-preflight.test.js`:

```js
test('critic + lenses together is rejected pre-spend — the pair is incoherent, not merely unused', () => {
  const r = preflightSeats({ models: ['glm', 'qwen'], critic: 'qwen', lenses: ['A', 'B'] });
  expect(r.seats).toBe(null);
  expect(r.error.code).toBe('COUNCIL_SEATS_INVALID');
  expect(r.error.message).toMatch(/lens/i);
});

test('lenses alone, critic alone, and an EMPTY lenses array all still work', () => {
  expect(preflightSeats({ models: ['glm', 'qwen'], critic: null, lenses: ['A', 'B'] }).error).toBe(null);
  expect(preflightSeats({ models: ['glm', 'qwen'], critic: 'qwen', lenses: null }).error).toBe(null);
  // [] is not lenses anywhere else in this module (seats.js:55) — it must not trip the guard
  expect(preflightSeats({ models: ['glm', 'qwen'], critic: 'qwen', lenses: [] }).error).toBe(null);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/council/seats-preflight.test.js -t "critic + lenses"`

- [ ] **Step 3: Implement**

Add before the existing critic resolution. The `.length > 0` matters — an empty array is not lenses anywhere else in this module:

```js
  if (o.critic && Array.isArray(o.lenses) && o.lenses.length > 0) {
    return bad('--critic and --lenses are mutually exclusive: under lenses every seat carries its '
      + "own lens role and no seat can be the critic — drop one of the two");
  }
```

Then update the docblock: `seats.js:189` reads `Rejects four ways, all zero-spend:` over four bullets (`:190`, `:193`, `:200`, `:201`) — change it to **five** and add the new bullet.

- [ ] **Step 4: Verify**

Run: `npx jest tests/council/seats-preflight.test.js tests/council/seats.test.js` — green.
Run: `npx jest tests/council` — 0 failures.

- [ ] **Step 5: Commit**

```bash
git add src/council/seats.js tests/council/seats-preflight.test.js
git commit -m "feat(council): reject --critic with --lenses pre-spend

criticSeat was minted without consulting lenses, so a direct require()
caller could persist a criticSeat naming a lens-role seat. Both handlers
already enforce the XOR; the engine now does too."
```

---

## Task 3: CHANGELOG

**Files:** `CHANGELOG.md`

Append to `## [Unreleased]`'s existing `### Changed` subsection (PR1 created it at `CHANGELOG.md:6`/`:8` — verify, do not duplicate). **One** behaviour change ships in this PR:

- `--critic` together with `--lenses` is now refused before any paid leg.

**Do not mention roles, `roleAt`, lens twins, or retry behaviour** — none of that changes in this PR; those belong to PR2b's entry. A bench with no repeated alias is unaffected, and so is every shipped entry point (both handlers already rejected the pair).

- [ ] **Step 1:** write it. **Step 2:** `npm test` — 0 failures. **Step 3:** commit.

---

## Verification before opening the PR

- [ ] `npm run lint` clean · `npm run check:sizes` clean (after staging) · `npm test` 0 failures.
- [ ] `git diff origin/main...HEAD --stat` (**three-dot**) — only the File Structure files.
- [ ] **No binding anywhere in `src/`**, path-anchored so a comment cannot hide a call:
  `grep -rn "bindSeats" src/ --include='*.js' | grep -v '^src/council/seats.js:'` → empty.
- [ ] **No hand-rolled binding either:** no `src/` file outside `seats.js` parses a `-(\d+)$` suffix off `legId`/`taskId`.
- [ ] Open the PR **with the `council-review` label**.

## Self-review

**Spec coverage.** This PR delivers §4.4's fixture requirement ("the fake produces leg documents real fanout cannot produce") and H2. H4 and all binding are PR2b, with the evidence for that boundary recorded above so it is not re-litigated.

**Placeholder scan.** No `<…>` markers and no ellipses in any code block — Task 1 Step 4's `launchers:` line is written out literally, because an earlier draft's `{ … }` would have pasted as a syntax error.

**Type consistency.** `slot` means the launch-roster index in every place it appears: the corrections table, Task 1 Step 3's rule, the two stray-fixture rulings, and Step 5's assertions.

**The risk an implementer must not paper over.** Step 5's gate is the only thing that can see whether the fixtures are *correct*, and it must assert `leg.waveId` explicitly — `bindSeats` admits an unstamped leg and binds it on `taskId` alone, so a bind-only assertion would pass on fixtures that forgot half the change.
