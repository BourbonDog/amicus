# v4.8 PR1 — Seat identity foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every bench position a derived **seat identity** so a duplicate bench (the same alias twice) can stop corrupting joins — and persist it — **without flipping a single consumer**.

**Architecture:** A new zero-require pure module `src/council/seats.js` holds the whole seat vocabulary: `buildSeats` derives the table from data `run.json` already persists, `roleAt` looks a role up, `bindSeats` resolves legs to seats, `artifactName`/`displayName` are the two presentation seams, and `preflightSeats` validates pre-spend. `run.js` calls it beside `preflightClaudeReview` and checkpoints `seats[]` + `criticSeat` into `run.json`. Every existing consumer keeps reading alias space; the flips are PR2–PR5.

**Tech Stack:** Node ≥22.12 **CommonJS** (CLAUDE.md:718-722 claims `"type": "module"` ESM — that is FALSE, there is no `type` field), jest, eslint.

**Provenance:** spec §4 (`docs/superpowers/specs/2026-08-10-v4.8-ask-anything-count-everyone-design.md:84-228`), re-measured at `1031079` by a 7-agent recon (9 spec claims WRONG, 32 STALE), then adversarially refuted by a 5-agent pass (227 claims checked; 9 Critical, 19 Important, 19 Minor — **all folded into the task text below**). Corrections are integrated, never an errata appendix. **Where this plan contradicts the spec, this plan is the corrected record.**

## Global Constraints

- Hard **300 lines/file** gate, `scripts/check-file-sizes.js:18-19` (`maxLines: 300`, include `src/**/*.js` + `electron/**/*.js`). `adjustedCount > limit`: **300 passes, 301 fails.** Sizes now: `run-assemble.js` 257, `run.js` 250, `run-stages.js` 244.
- **`--all` only measures TRACKED files** (`checkAllTracked` → `git ls-files`, `check-file-sizes.js:104-120`). A brand-new file is invisible to it until staged, so **`git add` before running the gate** or it passes vacuously.
- **`npm test` fails on a stale CLAUDE.md** (`tests/scripts/generate-docs-check.test.js`). Adding `src/council/seats.js` requires `node scripts/generate-docs.js` and committing CLAUDE.md. The pre-commit hook also auto-regenerates and auto-stages it — never unstage it.
- **`tests/docs-plan-refs.test.js` fails if any file under `src/` cites `docs/superpowers/plans/<file>.md`.** New comments may cite the **spec**, never this plan. Copy PR0's style: "v4.8 PR1", no path.
- `npm test` before `git push` — the pre-push hook re-runs the FULL suite unless `.test-passed` matches HEAD.
- Never `npm test -- <path>` (stamps `.test-passed`, makes pre-push SKIP the suite). Single suites: bare `npx jest <path>`.
- Never pipe gates through `| tail`.
- Worktrees must be SIBLINGS (`../amicus-wt-*`). jest's `testPathIgnorePatterns` contains `worktrees`, so a worktree under `.claude/worktrees/` collects **zero tests** — and two such stale worktrees exist on this box right now. **Before trusting any RED, confirm jest is collecting: `npx jest --listTests` must print a non-empty list.** "No tests found" is not a failing test.
- Commit style: `feat(council): …`, lowercase imperative.
- Line endings: `.gitattributes` sets `eol=lf`.

## Owner rulings (2026-08-12)

1. **`seats[]` is bench-only.** `buildSeats` never emits a `claude` seat: `claude` is banned from `o.models` (`run-assemble.js:92-103`) and synthesized into `meta.models` downstream (`:170`). Spec §4.3's "reconstructs full seat identity" is WRONG for `--claude-review` runs. PR2's `meta.models` flip must be `seats.map(s => s.id)` **plus** the existing `CLAUDE_SEAT` append. **Nothing may assume `meta.models.length === seats.length`.**
2. **Domain error code, not `BAD_ARGS`.** No code in `src/council/` has ever emitted `BAD_ARGS`, and `cli-handlers-council-run.js:242-247` explicitly defends domain codes. PR1 uses `COUNCIL_SEATS_INVALID`, mirroring `COUNCIL_CLAUDE_REVIEW_INVALID` (a **local const** at `run-assemble.js:31`, not a central enum).
3. **`preflightSeats` closes the off-bench-critic hole.** `runCouncil` never validated `critic ∈ models`; a direct `require()` caller silently launched an N+1th leg (`run-stage1-launch.js:56` is unconditional). CHANGELOG-worthy.
4. **The collision guard is narrow: only `#N`-induced collisions.** Rejecting *any* post-sanitize alias collision would break benches that run today (`vendor/a` + `vendor?a`) and reverse a shipped, council-ruled product decision — `src/workspace/artifact-guard.js:80-115` deliberately **detects and surfaces** such collisions with a `~N` de-collision scheme and a Workspace banner ("must be DETECTED and surfaced, never smoothed away"). PR1 rejects only collisions in which a **disambiguated `#N` seat id** participates — precisely the surface §4.2's rationale describes.
5. **The ambiguous-critic remedy is de-duplication, not a seat id.** `--critic 'deepseek#2'` is refused by every entry point (`cli-handlers-council-run.js:143`, `mcp-council-run.js:119` both require `bench.includes(critic)`), so advertising it would ship a dead end. The message and CHANGELOG say what works today; seat-id critics arrive in PR2 with the handler change.

## Design decisions (and why)

- **`preflightSeats`' body lives in `seats.js`, re-exported from `run-assemble.js`.** `run-assemble.js` is 257/300 with four more edits due in PR2–PR5; one re-export line costs 1 instead of ~40, and `asm.preflightSeats(o)` still works.
- **`seats.js` requires NOTHING.** Its consumers all require *it* in PR2–PR5, so any back-require would cycle. Two helpers therefore MOVE in and are re-exported from their old homes (the PR0 pattern): `slug` (`run-stages.js:30-32`) and `sanitizeName` (`run-launch.js:178-181`). Duplicating either would be a verbatim-duplication defect and a drift hazard — the lens role string and every artifact filename depend on them byte-for-byte.
- **`bindSeats(waveId, seats, legs)` — `seats` is the WAVE'S LAUNCH ROSTER in launch order**, not the seat table. The `-s1` roster is critic-filtered (`run-stage1-launch.js:47`), a retry roster is the loss subset (`run-retry.js:93`), so a legId's `-N` suffix indexes the roster and **never bench position**.
- **A leg with no `waveId` may bind ONLY by exact roster-slot id.** `result-schema.js:61` is `waveId: waveId !== null ? waveId : (metadata.parentWave || null)` — absence is expected, and the shared council fixture emits no `waveId` at all unless a 5th arg is passed (`fake-launchers.js:14-18`). Letting an unstamped leg reach the alias fallback would silently adopt a foreign wave's leg — the mis-attribution this module exists to kill.
- **`unbound` is seat-shaped; `orphanLegs` is added.** §4.5's "dead seats = `unbound ∪ deadWave.seats`" fixes `unbound` as seats-with-no-leg. A leg matching no seat is a different failure and must not vanish. **`bound` says nothing about usability** — a leg that ran and died still binds (`run-launch.js:194-196` drops non-`complete` legs from `materializeReviews` *after* this point), so PR2's dead-seat set is `unbound ∪ deadWave.seats ∪ {bound seats materializeReviews rejected}`.
- **No degrade channel in PR1.** `bindSeats` is pure and has no callers yet; the `src/utils/degrade.js:14-23` frozen-Set channel lands in PR2, with its emitter.

## Roles: what `buildSeats` does, and where it deliberately differs from `roleFor`

**This is the plan's most load-bearing correction — do not "restore parity".** `roleFor` (`run-stages.js:35-41`) resolves a lens by `o.models.indexOf(alias)`, which returns the FIRST bench index, so both twins of a repeated alias get the FIRST twin's lens. `buildSeats` is **positional** — seat *i* gets `lenses[i]` — which is the whole point of seat identity.

Measured divergences (verified by executing both functions):

| Input | `roleFor` | `buildSeats` (this plan) |
|---|---|---|
| `(['glm','glm'], null, ['First','Second'])` | `lens:first`, `lens:first` | `lens:first`, `lens:second` ✅ intended |
| `(['glm','glm'], 'glm', ['Skeptic','Optimist!'])` | `lens:skeptic`, `lens:skeptic` | `lens:skeptic`, `lens:optimist` ✅ intended |
| `lenses: []` (truthy in `roleFor`) | `lens:undefined` ×N | `seat` / `critic` |
| `lenses` shorter than bench | trailing `lens:undefined` | trailing `seat` |

Parity **does** hold for every bench the CLI can produce: no repeated alias, `lenses.length === bench.length` (`cli-handlers-council-run.js:161`), and `--critic ⊕ --lenses` (`:149`). Precedence is preserved exactly: under lenses, `'critic'` is unreachable.

**Consequence PR2 must plan for:** the advertised `roleFor` → `roleAt` consumer flip is therefore **not** byte-identical for a twin lens bench. It is a behaviour change and needs its own CHANGELOG line in PR2.

## Spec corrections folded in (do not re-derive from §4)

| Spec says | Truth at `1031079` |
|---|---|
| §4.3 buildSeats is "total over every legacy run dir" | Bench-only, no `claude` (ruling 1). `critic`/`lenses` are schema-OPTIONAL and legacy dirs carry mismatched pairs, so it must never throw |
| §4.3 "called from `run.js:124`", implying seats ride the seed | `initCouncilRun` ran at `run.js:75`, 49 lines earlier — seats must be **checkpointed** (the `labelMap` pattern). Moving the preflight above `:75` is wrong; `run-assemble.js:75-78` documents why it runs after initRun |
| §4.3 rejects with `BAD_ARGS` | `COUNCIL_SEATS_INVALID` (ruling 2) |
| §4.3 the disambiguated spelling is "printed in the hint" | There is no hint channel — the error is `{code, message}` and both render paths discard extras (`cli-handlers-council-run.js:271-273`, `cli-council-run-render.js:47`). Text goes **inside `message`** — and per ruling 5 it must not advertise a seat id |
| §4.5 `run-stages.js:33-40` roleFor | `:34-41`; its `indexOf` returns the FIRST bench index, not literally 0 |
| §4.5 `run-assemble.js:151` meta.models | `:152` — a spec authoring error, not PR0 drift |
| §4.4 `fanout.js:30-32` deriveLegIds | `src/sidecar/leg-ids.js:15-17` |
| §4.4 `run-retry.js:261-269` partial-wave comment | `:161-169` |
| §4.4 "every leg carries `leg.waveId`" | **FALSE** — `result-schema.js:61` falls back to `metadata.parentWave \|\| null`, and the council fixture omits it entirely |
| §4.4 the `fake-launchers.js:13` taskId task | **DONE in PR0** (`90396c2`), pinned by `tests/council/fake-launchers-ids.test.js`. Do not re-plan it |
| §4.4 `legId` is set by `runSingleAttempt`, `\|\|` is for routing failures | `legId` is **never persisted** (`result-schema.js:52-77` has no such key), so every disk-rebuilt wave is taskId-only. The `\|\|` is the NORMAL path |
| §4.5 `run-launch.js:217` is `sanitizeName(modelInput)` | It is `sanitizeName(leg.model)`; the reshaped objects at `run-debate.js:150-152`/`:185` carry no `legId`/`taskId`/`modelInput`, so PR3 must bind one level up at `run-debate.js:123` and `:179-180` |

## Scope note — what is NOT in this plan

- **Every row of §4.5's flip table.** Untouched: `tally.js`, `verdict.js`, `ledger.js`, `debate.js`, `run-debate.js`, `run-stage2.js`, `run-retry.js`, `run-retry-group.js`, `report.js`, `briefings-chair.js`, `src/workspace/{blind-mode,artifact-guard,matrix-model,live-normalize,run-detail}.js`, `electron/workspace-ui/{live-model,live-seats,workspace-panels}.js`.
- **`roleFor` stays** with its `run-stages.js` export — `observe/council-legs.js:89` has only a `modelInput`, so the alias-space shim is permanent.
- **The tally-input `meta`** (`run-assemble.js:150-155`) is a different document; `meta.seats` is PR3's (§4.6 makes it *required*). `tests/council/run-assemble.test.js:43-47` is an exact `toEqual` on all six tally-meta keys — **PR1 must not touch `buildTallyInput`.**
- **Two duplicate-bench collapse points the spec's inventory misses, both PR4:** `run-retry-group.js:10-15` (`lensIndexOf` retries a dead second-lens twin under the FIRST twin's briefing) and `:27-31` (`recordFailure` dedups `firstFailures` by alias, so two dead twins retry as one). The second is a **hard prerequisite for PR2's retry-path binding** — a collapsed retry unit yields a roster `bindSeats` cannot repair.
- **Handler-side seat ids** (`--critic 'deepseek#2'`) — PR2, per ruling 5.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/council/seats.js` | **NEW.** The seat vocabulary, zero requires | Create (~215 lines) |
| `tests/council/seats.test.js` | **NEW.** Pure-function suite | Create |
| `tests/council/seats-preflight.test.js` | **NEW.** Preflight suite | Create |
| `tests/council/seats-persist.test.js` | **NEW.** Driver-level run.json assertion | Create |
| `src/council/run-stages.js` (244) | Stage orchestration | `slug` moves out; require + re-export |
| `src/council/run-launch.js` | Launch/materialization | `sanitizeName` moves out; require + re-export |
| `src/council/run-assemble.js` (257) | Assembly + preflights | Re-export `preflightSeats` (+3) |
| `src/council/run.js` (250) | Council driver | Call + checkpoint (+7) |
| `src/council/run-state.js` | run.json seed | Seed the two keys (+1) |
| `schemas/council-run.schema.json` | run.json contract | Add `seats` + `criticSeat` |
| `tests/council/run-schema.test.js` | Schema pins | Add exact property pins |
| `CHANGELOG.md` | Release notes | `### Changed` under Unreleased |

---

## Task 1: `seats.js` — the module, `buildSeats`, `roleAt`

**Files:**
- Create: `src/council/seats.js`, `tests/council/seats.test.js`
- Modify: `src/council/run-stages.js`, `src/council/run-launch.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `seats.js` exports `{ slug, sanitizeName, buildSeats, roleAt }` (Tasks 2–4 append). `run-stages.js` keeps exporting `slug`; `run-launch.js` keeps exporting `sanitizeName`.

**Verified facts:**
- **`slug` is `run-stages.js:30-32` and has NO docblock.** `:28` is the `./run-stage1-rows` require, `:29` is blank, `:30-32` is the bare function. The `/** Role of a seat by its input alias. */` at `:34` belongs to `roleFor` and **stays**.
- `sanitizeName` **is** docblocked: `run-launch.js:178` is the docblock, `:179-181` the body. It is exported at the tail and imported by `src/council/run-stage2.js:24` and `src/workspace/artifact-guard.js:17` — the re-export must stay. `run-launch.js` itself uses it at `:198` and `:217`, so the require must satisfy those.
- `run-stages.js` uses `slug` inside `roleFor` (`:38`) — the require must satisfy that too.
- Read the **Roles** section above before writing `buildSeats`. Its divergences from `roleFor` are intentional and pinned by tests.

- [ ] **Step 1: Write the failing test**

Create `tests/council/seats.test.js`:

```js
// tests/council/seats.test.js
'use strict';
const { slug, sanitizeName, buildSeats, roleAt } = require('../../src/council/seats');

describe('slug / sanitizeName (moved here so seats.js needs zero requires)', () => {
  test('slug lowercases, hyphenates runs, and trims edges', () => {
    expect(slug('Devil Advocate!')).toBe('devil-advocate');
    expect(slug('  Red / Team  ')).toBe('red-team');
  });
  test('sanitizeName maps # to - (the seat-id collision surface)', () => {
    expect(sanitizeName('deepseek#2')).toBe('deepseek-2');
  });
});

describe('buildSeats', () => {
  test('a unique bench yields seat ids byte-identical to the aliases', () => {
    const seats = buildSeats(['glm', 'qwen', 'deepseek'], null, null);
    expect(seats.map(s => s.id)).toEqual(['glm', 'qwen', 'deepseek']);
    expect(seats.map(s => s.position)).toEqual([1, 2, 3]);
    expect(seats.every(s => s.role === 'seat')).toBe(true);
    expect(seats.every(s => s.lens === null)).toBe(true);
  });

  test('a duplicated alias gets #N suffixes, in bench order, on ALL of its seats', () => {
    const seats = buildSeats(['deepseek', 'glm', 'deepseek'], null, null);
    expect(seats.map(s => s.id)).toEqual(['deepseek#1', 'glm', 'deepseek#2']);
    expect(seats.map(s => s.alias)).toEqual(['deepseek', 'glm', 'deepseek']);
  });

  test('the critic role is by alias when there are no lenses', () => {
    expect(buildSeats(['glm', 'qwen'], 'qwen', null).map(s => s.role)).toEqual(['seat', 'critic']);
  });

  test('under lenses every role is a lens and critic is unreachable — roleFor precedence', () => {
    const seats = buildSeats(['glm', 'qwen'], 'qwen', ['Skeptic', 'Optimist!']);
    expect(seats.map(s => s.role)).toEqual(['lens:skeptic', 'lens:optimist']);
    expect(seats.map(s => s.lens)).toEqual(['Skeptic', 'Optimist!']);
  });

  test('lens roles are POSITIONAL — DELIBERATELY unlike roleFor, whose indexOf gives both twins the FIRST lens', () => {
    const seats = buildSeats(['glm', 'glm'], null, ['First', 'Second']);
    expect(seats.map(s => s.role)).toEqual(['lens:first', 'lens:second']);
  });

  test('an EMPTY lenses array is treated as no lenses — roleFor treats [] as truthy and yields lens:undefined', () => {
    expect(buildSeats(['glm'], 'glm', []).map(s => s.role)).toEqual(['critic']);
  });

  test('a lenses array SHORTER than the bench leaves trailing seats plain — roleFor yields lens:undefined', () => {
    expect(buildSeats(['glm', 'qwen'], null, ['A']).map(s => s.role)).toEqual(['lens:a', 'seat']);
  });

  test('total over legacy/degenerate inputs — never throws', () => {
    expect(buildSeats(null, null, null)).toEqual([]);
    expect(buildSeats([], null, null)).toEqual([]);
    expect(buildSeats(['glm'], null, ['A', 'B']).map(s => s.role)).toEqual(['lens:a']);
  });
});

describe('roleAt', () => {
  test('returns the seat role by id, and "seat" for an unknown id', () => {
    const seats = buildSeats(['glm', 'qwen'], 'qwen', null);
    expect(roleAt(seats, 'qwen')).toBe('critic');
    expect(roleAt(seats, 'glm')).toBe('seat');
    expect(roleAt(seats, 'nope')).toBe('seat');
    expect(roleAt(null, 'glm')).toBe('seat');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

First confirm jest is collecting (a worktree under `.claude/worktrees/` silently collects nothing):

Run: `npx jest --listTests`
Expected: a non-empty list.

Run: `npx jest tests/council/seats.test.js`
Expected: FAIL — `Cannot find module '../../src/council/seats'`.

- [ ] **Step 3: Create `src/council/seats.js`**

```js
// src/council/seats.js
'use strict';
// Seat identity (v4.8 workstream A, spec §4). A SEAT is one bench position:
// derived, never minted, stable for the life of a run. For every bench that
// has ever run — no alias repeated — a seat id equals its alias byte-for-byte,
// which is what keeps run.json, tally.json, verdict.json, report.html,
// artifact filenames and ledger rows unchanged.
//
// This module requires NOTHING, deliberately: its consumers (run-stages,
// run-launch, run-retry, run-stage2, run-assemble, run.js) all require IT, so
// any back-require would be a cycle. That is why slug and sanitizeName live
// here and are re-exported from their previous homes.

/** URL/role-safe token from free text (moved from run-stages.js, v4.8 PR1). */
function slug(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Filesystem-safe model name for review-/judge- artifact filenames. */
function sanitizeName(model) {
  return String(model).replace(/[^a-zA-Z0-9._-]/g, '-');
}

/**
 * Derive the seat table from data run.json already persists (run-state.js
 * seeds bench/critic/lenses). Pure and TOTAL: critic and lenses are
 * schema-optional and a legacy dir may carry a mismatched pair, so this never
 * throws and never guesses.
 *
 * Seat id (spec §4.2): the alias when it occupies exactly one bench seat, else
 * `alias#N` with N 1-based among the seats sharing that alias.
 *
 * Roles follow run-stages.js roleFor's PRECEDENCE — under lenses every seat is
 * a lens seat and 'critic' is unreachable — and match it for every bench the
 * CLI can produce (no repeated alias; lenses.length === bench.length, enforced
 * at cli-handlers-council-run.js:161). They DELIBERATELY diverge where roleFor
 * is wrong: roles here are POSITIONAL, so twins under lenses get their own
 * lens instead of both getting the first twin's (roleFor uses
 * o.models.indexOf). An empty lenses array counts as no lenses (roleFor treats
 * [] as truthy and yields 'lens:undefined'), and a lenses array shorter than
 * the bench leaves the trailing seats plain for the same reason. Do not
 * "restore parity" — the divergence IS the feature, and it is pinned by tests.
 *
 * The `claude` seat is deliberately absent: 'claude' is rejected from --models
 * (run-assemble.js:92-103) and synthesized onto meta.models downstream (:170).
 * seats[] is bench-only — never assume meta.models.length === seats.length.
 *
 * @param {?Array<string>} bench run.json's bench (o.models)
 * @param {?string} critic run.json's critic
 * @param {?Array<string>} lenses positionally bound to bench
 * @returns {Array<{id: string, alias: string, role: string, lens: ?string, position: number}>}
 */
function buildSeats(bench, critic, lenses) {
  const aliases = Array.isArray(bench) ? bench : [];
  const lensed = Array.isArray(lenses) && lenses.length > 0;
  const counts = new Map();
  for (const a of aliases) { counts.set(a, (counts.get(a) || 0) + 1); }
  const seen = new Map();
  return aliases.map((alias, i) => {
    const n = (seen.get(alias) || 0) + 1;
    seen.set(alias, n);
    const lens = lensed && lenses[i] !== undefined ? lenses[i] : null;
    const role = lensed
      ? (lens === null ? 'seat' : `lens:${slug(lens)}`)
      : (alias === critic ? 'critic' : 'seat');
    return {
      id: counts.get(alias) > 1 ? `${alias}#${n}` : alias,
      alias, role, lens, position: i + 1,
    };
  });
}

/**
 * Role of a seat by its id. Returns 'seat' for an unknown id, matching
 * roleFor's fallthrough for any alias that is not the critic. (roleFor returns
 * 'critic' for an OFF-BENCH critic because run-stages.js:40 is not gated on
 * bench membership; buildSeats never mints a seat for one and preflightSeats
 * rejects that state pre-spend, so 'seat' is right for every run v4.8 creates.)
 * @param {?Array<object>} seats
 * @param {string} seatId
 * @returns {string}
 */
function roleAt(seats, seatId) {
  const hit = (Array.isArray(seats) ? seats : []).find(s => s && s.id === seatId);
  return hit ? hit.role : 'seat';
}

module.exports = { slug, sanitizeName, buildSeats, roleAt };
```

- [ ] **Step 4: Move `slug` out of `run-stages.js`**

Delete `run-stages.js:29-32` — the blank separator at `:29` plus the three-line **undocumented** `function slug(text) { … }` at `:30-32`. Leave `:34`'s `/** Role of a seat by its input alias. */` (it is `roleFor`'s). Add after the `./run-stage1-rows` require:

```js
// slug lives in ./seats (v4.8 PR1) so that module can stay require-free;
// re-exported below — run-stages.test.js imports it from here.
const { slug } = require('./seats');
```

The tail `module.exports = { runStage1, runStage2, isAbortExit, slug, roleFor };` is untouched — it is now the re-export.

- [ ] **Step 5: Move `sanitizeName` out of `run-launch.js`**

Delete `run-launch.js:178-181` (docblock + body). Add to its requires:

```js
// sanitizeName lives in ./seats (v4.8 PR1) so that module can stay
// require-free; re-exported below — run-stage2.js and workspace/artifact-guard.js
// import it from here.
const { sanitizeName } = require('./seats');
```

The tail export list already names `sanitizeName` — untouched.

- [ ] **Step 6: Run the new suite, then every dependent suite**

Run: `npx jest tests/council/seats.test.js`
Expected: PASS.

Run: `npx jest tests/council tests/workspace tests/observe`
Expected: PASS, 0 failures (proves both re-exports still satisfy every importer).

- [ ] **Step 7: Stage, regenerate docs, then gate**

Run: `git add src/council/seats.js tests/council/seats.test.js src/council/run-stages.js src/council/run-launch.js`
then `node scripts/generate-docs.js`
then `node scripts/check-file-sizes.js --all`

Expected: CLAUDE.md updated with the new module; size gate silent exit 0. **Staging first is required** — `--all` reads `git ls-files`, so an unstaged new file is never measured.

- [ ] **Step 8: Commit**

```bash
git add src/council/seats.js tests/council/seats.test.js src/council/run-stages.js src/council/run-launch.js CLAUDE.md
git commit -m "feat(council): seat identity vocabulary — buildSeats + roleAt

New require-free src/council/seats.js (v4.8 workstream A). slug and
sanitizeName move here and are re-exported from run-stages.js and
run-launch.js so every import path is unchanged; seats.js must stay
require-free because PR2-PR5's consumers all require it.

Roles are POSITIONAL, which deliberately diverges from roleFor's indexOf
for a twin lens bench. No consumer reads seats yet."
```

---

## Task 2: `bindSeats` — resolve legs to seats without guessing

**Files:** modify `src/council/seats.js`, `tests/council/seats.test.js`

**Interfaces:**
- Consumes: `buildSeats`.
- Produces: `bindSeats(waveId, seats, legs) → { bound: [{seat, leg}], unbound: [seat], orphanLegs: [leg] }`.

**Verified facts:**
- `deriveLegIds` (`src/sidecar/leg-ids.js:15-17`) returns `` `${waveId}-${i + 1}` ``.
- **`legId` is never persisted** — `buildRunResult` (`src/utils/result-schema.js:52-77`) has no such key, so every disk-rebuilt wave (resume, workspace) is taskId-only. The `||` is the normal path, not a routing-failure special case.
- **`leg.waveId` may be absent.** `src/utils/result-schema.js:61` is `waveId: waveId !== null ? waveId : (metadata.parentWave || null)`, and `tests/council/helpers/fake-launchers.js:14-18` omits it unless a 5th argument is passed. Three consumers already treat it as optional (`run-assemble.js:66`, `tally.js:129`, `debate.js:107`).
- Callers hold multi-wave arrays: `run-stage1-launch.js:69-90` concatenates `-s1` with the `-c1` critic solo (or N `-l*` lens solos); `run-stages.js:113` appends recovered legs.
- Never index `wave.legs[i]` positionally — `run-retry.js:161-169` documents partial wave returns.

- [ ] **Step 1: Write the failing test**

Append to `tests/council/seats.test.js`:

```js
describe('bindSeats', () => {
  const { bindSeats } = require('../../src/council/seats');
  const leg = (over) => ({ waveId: 'r-s1', status: 'complete', ...over });

  test('binds by legId suffix against the WAVE ROSTER, so twins never cross', () => {
    const seats = buildSeats(['deepseek', 'deepseek'], null, null);
    const legs = [leg({ taskId: 'r-s1-2', model: 'deepseek', modelInput: 'deepseek' }),
      leg({ taskId: 'r-s1-1', model: 'deepseek', modelInput: 'deepseek' })];
    const { bound, unbound, orphanLegs } = bindSeats('r-s1', seats, legs);
    expect(bound.map(b => [b.seat.id, b.leg.taskId]))
      .toEqual([['deepseek#2', 'r-s1-2'], ['deepseek#1', 'r-s1-1']]);
    expect(unbound).toEqual([]);
    expect(orphanLegs).toEqual([]);
  });

  test('legId WINS over taskId — the two must resolve to different seats to prove precedence', () => {
    const seats = buildSeats(['glm', 'qwen'], null, null);
    const legs = [leg({ legId: 'r-s1-2', taskId: 'r-s1-1', model: 'qwen' })];
    expect(bindSeats('r-s1', seats, legs).bound[0].seat.id).toBe('qwen');
  });

  test('the roster is the WAVE roster, not the bench — a critic-filtered -s1 wave', () => {
    const seats = buildSeats(['glm', 'qwen', 'deepseek'], 'glm', null);
    const roster = seats.filter(s => s.role !== 'critic'); // run-stage1-launch.js:47
    const { bound } = bindSeats('r-s1', roster, [leg({ taskId: 'r-s1-1', modelInput: 'qwen' })]);
    expect(bound[0].seat.id).toBe('qwen');
  });

  test('falls back to alias ONLY when that alias holds exactly one seat', () => {
    const unique = buildSeats(['glm', 'qwen'], null, null);
    expect(bindSeats('r-s1', unique, [leg({ taskId: 'no-match', modelInput: 'qwen' })])
      .bound[0].seat.id).toBe('qwen');

    const twins = buildSeats(['glm', 'glm'], null, null);
    const ambiguous = bindSeats('r-s1', twins, [leg({ taskId: 'no-match', modelInput: 'glm' })]);
    expect(ambiguous.bound).toEqual([]);
    expect(ambiguous.orphanLegs).toHaveLength(1);
    expect(ambiguous.unbound.map(s => s.id)).toEqual(['glm#1', 'glm#2']);
  });

  test('a seat with no leg comes back unbound — the dead-seat input', () => {
    const seats = buildSeats(['glm', 'qwen'], null, null);
    const { bound, unbound } = bindSeats('r-s1', seats, [leg({ taskId: 'r-s1-1', modelInput: 'glm' })]);
    expect(bound).toHaveLength(1);
    expect(unbound.map(s => s.id)).toEqual(['qwen']);
  });

  test('legs stamped with another wave are IGNORED, not orphaned (callers hold concatenated arrays)', () => {
    const seats = buildSeats(['glm'], null, null);
    const legs = [leg({ taskId: 'r-s1-1', modelInput: 'glm' }),
      leg({ waveId: 'r-c1', taskId: 'r-c1-1', modelInput: 'critic-model' })];
    const out = bindSeats('r-s1', seats, legs);
    expect(out.bound).toHaveLength(1);
    expect(out.orphanLegs).toEqual([]);
  });

  test('an UNSTAMPED leg binds only by exact roster-slot id, never by alias', () => {
    const seats = buildSeats(['glm'], null, null);
    const bySlot = bindSeats('r-s1', seats, [{ taskId: 'r-s1-1', modelInput: 'glm' }]);
    expect(bySlot.bound).toHaveLength(1);
    // no waveId AND no matching slot id: adopting it by alias would silently
    // claim a foreign wave's leg.
    const byAlias = bindSeats('r-s1', seats, [{ taskId: 'zzz-9', modelInput: 'glm' }]);
    expect(byAlias.bound).toEqual([]);
    expect(byAlias.orphanLegs).toHaveLength(1);
  });

  test('a second leg claiming a bound seat is an orphan, never a silent overwrite', () => {
    const seats = buildSeats(['glm'], null, null);
    const legs = [leg({ taskId: 'r-s1-1', modelInput: 'glm' }), leg({ taskId: 'r-s1-1', modelInput: 'glm' })];
    const out = bindSeats('r-s1', seats, legs);
    expect(out.bound).toHaveLength(1);
    expect(out.orphanLegs).toHaveLength(1);
  });

  test('total over junk — never throws', () => {
    expect(bindSeats('r-s1', null, null)).toEqual({ bound: [], unbound: [], orphanLegs: [] });
    expect(bindSeats('r-s1', buildSeats(['glm'], null, null), [null]).orphanLegs).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/council/seats.test.js -t "bindSeats"`
Expected: FAIL — `bindSeats is not a function`.

- [ ] **Step 3: Implement `bindSeats`**

Append to `src/council/seats.js` before `module.exports`, and add `bindSeats` to the export list:

```js
/**
 * Resolve a wave's legs to its seats. Pure: it reports, it never emits a
 * degrade and never guesses — silent mis-attribution is the failure this whole
 * mechanism exists to kill (spec §4.4).
 *
 * `seats` is THE WAVE'S LAUNCH ROSTER, in launch order — not necessarily the
 * full seat table. The -s1 wave is critic-filtered (run-stage1-launch.js:47)
 * and a retry wave is the loss subset (run-retry.js:93), so a legId's `-N`
 * suffix indexes this roster, never bench position.
 *
 * Callers legitimately hold legs from several waves at once, so a leg stamped
 * with a DIFFERENT waveId is ignored rather than reported — call once per wave
 * over the same array. A leg with NO waveId (result-schema.js:61 falls back to
 * `metadata.parentWave || null`, and the council fixtures omit it) may bind
 * ONLY by an exact roster-slot id: adopting it by alias would silently claim a
 * foreign wave's leg.
 *
 * Resolution order per leg:
 *   1. `leg.legId || leg.taskId` matching `${waveId}-${n}` → roster slot n.
 *      Both are read because legId is never persisted, so every disk-rebuilt
 *      wave is taskId-only.
 *   2. alias (`leg.modelInput || leg.model`), only for a wave-stamped leg and
 *      only when that alias holds exactly one seat in this roster — for every
 *      bench that has ever run, this is today's exact behaviour.
 *   3. neither → the leg is an orphan and the seat stays unbound.
 *
 * `bound` says nothing about USABILITY: a leg that ran and died still binds
 * (run-launch.js:194-196 drops non-complete legs later). PR2's dead-seat set is
 * `unbound ∪ deadWave.seats ∪ {bound seats materializeReviews rejected}`.
 *
 * @param {string} waveId
 * @param {?Array<object>} seats the wave's launch roster, in launch order
 * @param {?Array<object>} legs
 * @returns {{bound: Array<{seat: object, leg: object}>, unbound: Array<object>, orphanLegs: Array<object>}}
 */
function bindSeats(waveId, seats, legs) {
  const roster = Array.isArray(seats) ? seats.filter(Boolean) : [];
  const all = Array.isArray(legs) ? legs.filter(Boolean) : [];
  const mine = all.filter(l => !l.waveId || l.waveId === waveId);
  const takenBy = new Map();
  const bound = [];
  const orphanLegs = [];
  for (const leg of mine) {
    const id = leg.legId || leg.taskId;
    const m = typeof id === 'string' ? id.match(/^(.*)-(\d+)$/) : null;
    let seat = (m && m[1] === waveId) ? roster[Number(m[2]) - 1] : undefined;
    if (!seat && leg.waveId === waveId) {
      const alias = leg.modelInput || leg.model;
      const hits = roster.filter(s => s.alias === alias);
      seat = hits.length === 1 ? hits[0] : undefined;
    }
    if (!seat || takenBy.has(seat.id)) { orphanLegs.push(leg); continue; }
    takenBy.set(seat.id, leg);
    bound.push({ seat, leg });
  }
  return { bound, unbound: roster.filter(s => !takenBy.has(s.id)), orphanLegs };
}
```

- [ ] **Step 4: Run the suite**

Run: `npx jest tests/council/seats.test.js`
Expected: PASS, every describe.

- [ ] **Step 5: Commit**

```bash
git add src/council/seats.js tests/council/seats.test.js
git commit -m "feat(council): bindSeats — resolve a wave's legs to its seats

Reports, never guesses: a seat with no leg comes back unbound, a leg
matching no seat comes back an orphan, and an unstamped leg binds only by
an exact roster-slot id so a foreign wave's leg is never adopted.

Zero behavior change: no caller yet."
```

---

## Task 3: `artifactName` and `displayName`

**Files:** modify `src/council/seats.js`, `tests/council/seats.test.js`

**Interfaces:** produces `artifactName(seat, kind) → string`, `displayName(seat) → string`.

**Verified facts:**
- The four shapes: `review-${sanitizeName(modelInput)}.md` (`run-launch.js:198`), `judge-${sanitizeName(judge)}.md` (`run-stage2.js:84`), and `${prefix}-${sanitizeName(leg.model)}.md` for `rebuttal`/`revote` (`run-launch.js:217`, prefix supplied by `run-debate.js:185` and `:222`). `src/workspace/artifact-guard.js:151-154` enumerates exactly `{review, judge, rebuttal, revote}` — that is the `kind` domain.
- §4.5's row for `run-launch.js:217` is WRONG about the field (it is `leg.model`), and the reshaped objects it flows from carry no `legId`/`taskId`/`modelInput` — PR3 must bind one level up. Not PR1's problem; recorded so PR3 does not inherit it.
- `displayName`'s only consumer is the chair packet. §4.2's byte-identical promise pins a unique-alias seat to its bare alias, so nothing may be appended unconditionally.

- [ ] **Step 1: Write the failing test**

Append to `tests/council/seats.test.js`:

```js
describe('artifactName / displayName', () => {
  const { artifactName, displayName } = require('../../src/council/seats');

  test('artifactName reproduces every shipped filename shape for a unique bench', () => {
    const [seat] = buildSeats(['deepseek'], null, null);
    expect(artifactName(seat, 'review')).toBe('review-deepseek.md');
    expect(artifactName(seat, 'judge')).toBe('judge-deepseek.md');
    expect(artifactName(seat, 'rebuttal')).toBe('rebuttal-deepseek.md');
    expect(artifactName(seat, 'revote')).toBe('revote-deepseek.md');
  });

  test('a twin sanitizes # to - (the collision surface preflightSeats guards)', () => {
    const seats = buildSeats(['deepseek', 'deepseek'], null, null);
    expect(artifactName(seats[1], 'review')).toBe('review-deepseek-2.md');
  });

  test('displayName is the seat id — the bare alias for every bench that has ever run', () => {
    expect(displayName(buildSeats(['glm'], null, null)[0])).toBe('glm');
    expect(displayName(buildSeats(['glm', 'glm'], null, null)[1])).toBe('glm#2');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/council/seats.test.js -t "artifactName"`
Expected: FAIL — `artifactName is not a function`.

- [ ] **Step 3: Implement both**

Append to `src/council/seats.js` before `module.exports`; add both to the export list:

```js
/**
 * The artifact filename for one seat. Reproduces the four shapes shipping
 * today — review-/judge-/rebuttal-/revote-<name>.md, the exact key set
 * workspace/artifact-guard.js enumerates — with the seat id in place of the
 * alias. Identical output for every bench that has ever run; a twin sanitizes
 * to `review-deepseek-2.md`, which is the collision surface preflightSeats
 * rejects pre-spend.
 * @param {{id: string}} seat
 * @param {'review'|'judge'|'rebuttal'|'revote'} kind
 * @returns {string}
 */
function artifactName(seat, kind) {
  return `${kind}-${sanitizeName(seat && seat.id)}.md`;
}

/**
 * How a seat is named to a human — chair packet review headers today.
 * Deliberately the seat id and nothing more: spec §4.2's byte-identical
 * promise means a unique-alias seat MUST render as its bare alias, so lens
 * text, position and role can never be appended unconditionally. It exists as
 * a named seam so a later rev changes presentation in one place instead of at
 * every call site.
 * @param {{id: string}} seat
 * @returns {string}
 */
function displayName(seat) {
  return seat && seat.id;
}
```

- [ ] **Step 4: Run the suite**

Run: `npx jest tests/council/seats.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/council/seats.js tests/council/seats.test.js
git commit -m "feat(council): artifactName + displayName seams

Both reproduce today's output exactly for any bench without a repeated
alias. Zero behavior change: no caller yet."
```

---

## Task 4: `preflightSeats` — validate pre-spend, persist to run.json

**Files:**
- Modify: `src/council/seats.js`, `src/council/run-assemble.js`, `src/council/run.js`, `src/council/run-state.js`, `schemas/council-run.schema.json`, `tests/council/run-schema.test.js`, `CHANGELOG.md`
- Create: `tests/council/seats-preflight.test.js`, `tests/council/seats-persist.test.js`

**Interfaces:** `preflightSeats(o) → { seats, criticSeat, error }`, re-exported as `asm.preflightSeats`. `run.js` assigns `o.seats`/`o.criticSeat` and checkpoints them.

**Verified facts:**
- Copy the sibling's shape exactly (`run-assemble.js:82-110`): a **local** `const` for the code (mirroring `:31`), an inner `bad = (detail) => ({ …, error: { code, message: \`council_seats_invalid: ${detail}\` } })`, early returns. Not a thrown error, not a central enum.
- Call site: `run.js:124-126`, inside the `try` at `:121`, AFTER `runState.initCouncilRun(o)` at `:75`. `asm` and `runState` are both in scope; `finalize(code, error)` takes that shape.
- Checkpoint pattern: `run.js:176` `runState.checkpoint(o.runDir, { labelMap: labels.labelMap });`, key seeded `labelMap: null` at `run-state.js:99`.
- **`tests/council/run-schema.test.js` has NO `readSchema`/`stripDescriptions` helpers.** It holds one `const SCHEMA = JSON.parse(fs.readFileSync(…'council-run.schema.json'), 'utf-8')` at `:15-16` plus `validate`. Those helpers live only in `tests/schemas-degrades-lockstep.test.js:12-27`, which is a test file exporting nothing — it **cannot be imported**. Write the pin against `SCHEMA` with a locally-defined stripper.
- The schema is open at top level (the only `additionalProperties:false` is on `debate` at `:132`), so **an ajv round-trip proves nothing** — the pin must assert the property definition directly.
- Ruling 4 narrows the collision guard; ruling 5 fixes the remedy text.

- [ ] **Step 1: Write the failing preflight test**

Create `tests/council/seats-preflight.test.js`:

```js
// tests/council/seats-preflight.test.js
'use strict';
const { preflightSeats } = require('../../src/council/seats');
const asm = require('../../src/council/run-assemble');

const ok = (o) => preflightSeats({ models: ['glm', 'qwen'], critic: null, lenses: null, ...o });

test('a clean bench yields seats + a null criticSeat and no error', () => {
  const r = ok({});
  expect(r.error).toBe(null);
  expect(r.seats.map(s => s.id)).toEqual(['glm', 'qwen']);
  expect(r.criticSeat).toBe(null);
});

test('a critic on the bench resolves to its seat id', () => {
  expect(ok({ critic: 'qwen' }).criticSeat).toBe('qwen');
});

test('an AMBIGUOUS critic is rejected pre-spend, and the remedy is one the CLI accepts', () => {
  const r = preflightSeats({ models: ['deepseek', 'deepseek'], critic: 'deepseek', lenses: null });
  expect(r.seats).toBe(null);
  expect(r.error.code).toBe('COUNCIL_SEATS_INVALID');
  expect(r.error.message).toContain('occupies 2 bench seats');
  // The seat-id spelling is NOT advertised: every entry point requires
  // bench.includes(critic) (cli-handlers-council-run.js:143), so suggesting
  // --critic 'deepseek#2' would be a dead end until PR2.
  expect(r.error.message).not.toContain('#2');
});

test('an OFF-BENCH critic is rejected pre-spend (v4.8: the engine now guards what only handlers did)', () => {
  const r = ok({ critic: 'nobody' });
  expect(r.error.code).toBe('COUNCIL_SEATS_INVALID');
  expect(r.error.message).toContain('nobody');
});

test('a seat id supplied as the critic is NOT accepted — no consumer understands one yet', () => {
  const r = preflightSeats({ models: ['deepseek', 'deepseek'], critic: 'deepseek#2', lenses: null });
  expect(r.error.code).toBe('COUNCIL_SEATS_INVALID');
});

test('a #N seat id colliding with a literal alias is rejected pre-spend', () => {
  const r = preflightSeats({ models: ['deepseek', 'deepseek', 'deepseek-2'], critic: null, lenses: null });
  expect(r.error.code).toBe('COUNCIL_SEATS_INVALID');
  expect(r.error.message).toContain('review-deepseek-2.md');
});

test('two bench entries resolving to the SAME seat id are rejected', () => {
  const r = preflightSeats({ models: ['deepseek#2', 'deepseek', 'deepseek'], critic: null, lenses: null });
  expect(r.error.code).toBe('COUNCIL_SEATS_INVALID');
  expect(r.error.message).toContain('deepseek#2');
});

test('a pure-alias collision still RUNS — artifact-guard surfaces it, PR1 does not refuse it', () => {
  const r = preflightSeats({ models: ['vendor/a', 'vendor?a'], critic: null, lenses: null });
  expect(r.error).toBe(null);
});

test('run-assemble re-exports it so asm.preflightSeats(o) is the call spelling', () => {
  expect(asm.preflightSeats).toBe(preflightSeats);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest tests/council/seats-preflight.test.js`
Expected: FAIL — `preflightSeats is not a function`.

- [ ] **Step 3: Implement `preflightSeats`**

Append to `src/council/seats.js` (add to `module.exports`):

```js
const SEATS_ERROR = 'COUNCIL_SEATS_INVALID';

/**
 * Mint the seat table and validate it, pre-spend. Runs AFTER initRun (so the
 * error doc lands in a run dir that exists) and BEFORE any launch, exactly like
 * its sibling preflightClaudeReview.
 *
 * Rejects four ways, all zero-spend:
 *   - two bench entries resolving to the SAME seat id (a bench alias spelling
 *     another alias's disambiguated id, e.g. 'deepseek#2' beside twin
 *     'deepseek' entries) — that table would be incoherent as a join key,
 *   - a collision in which a DISAMBIGUATED (#N) id participates, i.e. two seats
 *     whose review files would be the same name. Deliberately narrow: a
 *     pure-alias collision ('vendor/a' vs 'vendor?a') runs today and
 *     workspace/artifact-guard.js exists to detect and surface it, so v4.8
 *     refuses only the collisions its own id scheme creates,
 *   - a --critic alias occupying more than one seat,
 *   - a critic that is not on the bench at all. runCouncil never checked this
 *     (only the CLI/MCP handlers did), so a direct require() caller silently
 *     launched an N+1th leg meta.models never mentioned.
 *
 * Remedies ride INSIDE message: the engine error is {code, message} and both
 * render paths discard anything else. The message never suggests naming a seat
 * id — every entry point requires bench.includes(critic), so that spelling
 * cannot work until PR2 teaches the handlers.
 *
 * @param {{models: ?Array<string>, critic: ?string, lenses: ?Array<string>}} o
 * @returns {{seats: ?Array<object>, criticSeat: ?string, error: ?{code: string, message: string}}}
 */
function preflightSeats(o) {
  const bad = (detail) => ({ seats: null, criticSeat: null,
    error: { code: SEATS_ERROR, message: `council_seats_invalid: ${detail}` } });
  const seats = buildSeats(o.models, o.critic, o.lenses);

  const byId = new Set();
  const byFile = new Map();
  for (const s of seats) {
    if (byId.has(s.id)) {
      return bad(`two bench entries both resolve to seat id '${s.id}' — a bench alias may not `
        + "spell another alias's disambiguated seat id; rename one entry");
    }
    byId.add(s.id);
    const file = artifactName(s, 'review');
    const prev = byFile.get(file);
    // Only reject collisions this id scheme created: at least one side must be
    // a disambiguated id. Pure-alias collisions are artifact-guard's to surface.
    if (prev && (prev.includes('#') || s.id.includes('#'))) {
      return bad(`seats '${prev}' and '${s.id}' would both write ${file} — rename one bench entry`);
    }
    if (!prev) { byFile.set(file, s.id); }
  }

  if (o.critic) {
    const hits = seats.filter(s => s.alias === o.critic);
    if (hits.length === 0) {
      return bad(`--critic '${o.critic}' is not on the bench (${seats.map(s => s.id).join(', ') || 'empty'})`);
    }
    if (hits.length > 1) {
      return bad(`--critic '${o.critic}' is ambiguous: that alias occupies ${hits.length} bench seats `
        + '— remove the duplicate bench entry, or use two distinct aliases');
    }
    return { seats, criticSeat: hits[0].id, error: null };
  }
  return { seats, criticSeat: null, error: null };
}
```

- [ ] **Step 4: Re-export from `run-assemble.js`**

Add to its requires:

```js
// Seat identity lives in ./seats (v4.8 PR1) — that module is require-free by
// design, so preflightSeats' body lives there and is re-exported here to keep
// the asm.preflightSeats(o) call spelling and this file under the size gate.
const { preflightSeats } = require('./seats');
```

and add `preflightSeats` to the tail `module.exports`.

- [ ] **Step 5: Run the preflight suite**

Run: `npx jest tests/council/seats-preflight.test.js`
Expected: PASS, 9 tests.

- [ ] **Step 6: Wire the call site and the checkpoint**

In `run.js`, immediately after the `preflightClaudeReview` block (after `const claudeReview = pre.claudeReview;`):

```js
    // v4.8 §4.3: seats are derived pre-spend from data run.json already holds,
    // then checkpointed — initCouncilRun ran ~50 lines earlier, so they cannot
    // ride the seed.
    const seatPre = asm.preflightSeats(o);
    if (seatPre.error) { return finalize(1, seatPre.error); }
    o.seats = seatPre.seats;
    o.criticSeat = seatPre.criticSeat;
    runState.checkpoint(o.runDir, { seats: o.seats, criticSeat: o.criticSeat });
```

In `run-state.js`, extend the seed at `:99` (the `labelMap` precedent) so the keys are always present:

```js
    labelMap: null, seats: null, criticSeat: null,
```

- [ ] **Step 7: Write the persistence test**

The pure suites never prove seats reach disk, and the schema pin reads a static file — without this, `run.js` could be left unwired and everything stays green. Create `tests/council/seats-persist.test.js`, modelling its driver setup on an existing runCouncil suite (**read `tests/council/run-schema.test.js` or `tests/council/run-happy.test.js` first and copy its `scriptedLaunchers`/`happyScript`/`baseOptions`/tmp-dir wiring verbatim** — do not invent a harness):

```js
// tests/council/seats-persist.test.js
'use strict';
// run.json must actually carry the derived table: the pure suites cannot see
// the wiring, and the schema is open so an ajv pass proves nothing.
// <SETUP: copy the driver harness from the suite you read.>

test('seats[] + criticSeat are checkpointed into run.json', async () => {
  // <run a council with models ['gemini','gpt'] and critic 'gpt'>
  const run = JSON.parse(fs.readFileSync(path.join(runDir, 'run.json'), 'utf-8'));
  expect(run.seats.map(s => s.id)).toEqual(['gemini', 'gpt']);
  expect(run.seats.map(s => s.role)).toEqual(['seat', 'critic']);
  expect(run.criticSeat).toBe('gpt');
});
```

The `<SETUP:>` and `<run a council…>` markers are the only non-literal content in this plan: they exist because the harness must match the suite you copy. If no suite drives `runCouncil` to completion cheaply, STOP and report rather than inventing one.

- [ ] **Step 8: Add the schema properties and pin them**

In `schemas/council-run.schema.json`, add to `properties` (do NOT add to `required` — a run killed before preflight has them null):

```json
    "seats": {
      "description": "v4.8: derived seat table, one entry per bench position. Bench-only — the synthesized 'claude' review is never a seat.",
      "type": ["array", "null"],
      "items": {
        "type": "object",
        "required": ["id", "alias", "role", "position"],
        "properties": {
          "id": { "type": "string" },
          "alias": { "type": "string" },
          "role": { "type": "string" },
          "lens": { "type": ["string", "null"] },
          "position": { "type": "integer" }
        }
      }
    },
    "criticSeat": {
      "description": "v4.8: seat id of the critic, or null.",
      "type": ["string", "null"]
    },
```

Append to `tests/council/run-schema.test.js`, using the `SCHEMA` const that file already defines at `:15-16` and a locally-defined stripper (the helper in `schemas-degrades-lockstep.test.js` cannot be imported — that file exports nothing):

```js
// Local copy: tests/schemas-degrades-lockstep.test.js has the same helper but
// is a test file and exports nothing.
const stripDesc = (node) => JSON.parse(JSON.stringify(node, (k, v) => (k === 'description' ? undefined : v)));

test('the schema declares the v4.8 seats + criticSeat shape (the schema is open, so an ajv pass proves nothing)', () => {
  expect(stripDesc(SCHEMA.properties.criticSeat)).toEqual({ type: ['string', 'null'] });
  expect(stripDesc(SCHEMA.properties.seats)).toEqual({
    type: ['array', 'null'],
    items: {
      type: 'object',
      required: ['id', 'alias', 'role', 'position'],
      properties: {
        id: { type: 'string' }, alias: { type: 'string' }, role: { type: 'string' },
        lens: { type: ['string', 'null'] }, position: { type: 'integer' },
      },
    },
  });
  expect(SCHEMA.required).not.toContain('seats');
});
```

If that file wraps its tests in a `describe`, place this inside it and match the surrounding style.

- [ ] **Step 9: CHANGELOG**

`## [Unreleased]` (CHANGELOG.md:6) is currently EMPTY, and the file declares Keep a Changelog conformance — every bullet lives under a `### Added`/`### Changed`/`### Fixed` heading. **Create the `### Changed` subsection**, then add:

```markdown
### Changed

- **Council seats are validated before any paid leg.** `amicus council run` now refuses to start
  when `--critic` names a model that is not on the bench, when `--critic <alias>` is ambiguous
  because that alias occupies more than one bench seat (remove the duplicate entry, or use two
  distinct aliases), or when a bench mixes a repeated alias with a literal alias spelling its
  disambiguated form (e.g. `--models deepseek,deepseek,deepseek-2`, where two seats would write
  the same `review-deepseek-2.md`). The off-bench case previously launched an extra leg the run's
  own model roster never mentioned; the ambiguous case silently stripped both seats. Benches
  without a repeated alias are unaffected.
```

- [ ] **Step 10: Run the full suite**

Run: `npm test`
Expected: PASS, **0 failures** (judge on 0 failures, not the suite count — this plan adds three suites).

- [ ] **Step 11: Commit**

```bash
git add src/council/seats.js tests/council/seats-preflight.test.js tests/council/seats-persist.test.js src/council/run-assemble.js src/council/run.js src/council/run-state.js schemas/council-run.schema.json tests/council/run-schema.test.js CHANGELOG.md
git commit -m "feat(council): preflightSeats — validate seats pre-spend, persist to run.json

Rejects an off-bench critic, an ambiguous --critic on a duplicated alias,
two bench entries resolving to one seat id, and a #N-induced artifact
filename collision — all before any paid leg. seats[] + criticSeat are
checkpointed into run.json (initCouncilRun runs ~50 lines earlier, so
they cannot ride the seed).

The off-bench critic guard is new at the engine level: only the CLI and
MCP handlers checked it. Pure-alias collisions still run — artifact-guard
surfaces those by design."
```

---

## Verification before opening the PR

- [ ] `npm run lint` — clean.
- [ ] `npm run check:sizes` — clean (after staging). Expect `seats.js` ~215, `run-assemble.js` ~260, `run.js` ~257.
- [ ] `npm test` — 0 failures.
- [ ] `git diff origin/main...HEAD --stat` — **three-dot**, against the merge base: a concurrent session is landing `.github/workflows/ci.yml` + `tests/scripts/ci-workflow.test.js`, and a two-dot diff would render those as reverse changes. Only the File Structure files (plus CLAUDE.md) may appear.
- [ ] **Prove the zero-behaviour claim:** `git diff origin/main...HEAD -- src/council/run-stages.js src/council/run-launch.js` shows only the move-out, the require and the comment — no logic line changed.
- [ ] Open the PR **with the `council-review` label**.

## Self-review

**Spec coverage.** §4.2 seat id → Task 1. §4.3 buildSeats + preflightSeats → Tasks 1, 4. §4.4 bindSeats → Task 2. The train row's `roleAt`/`artifactName`/`displayName` → Tasks 1, 3. run.json `seats[]`/`criticSeat` → Task 4. §4.5–§4.8 are deliberately out, named in the Scope note.

**Placeholder scan.** The only non-literal content is Task 4 Step 7's `<SETUP:>` markers, which carry an explicit "copy the harness you read; STOP rather than invent" instruction. Everything else is literal.

**Type consistency.** `buildSeats` returns `{id, alias, role, lens, position}` — the same five keys in the schema, the same shape `roleAt`/`artifactName`/`displayName`/`bindSeats` consume and `preflightSeats` returns. `bindSeats`' three-key return is identical in its docblock and its tests. `COUNCIL_SEATS_INVALID` appears in the implementation, the tests, and the CHANGELOG's described behaviour.

**The risk an implementer must not paper over.** `bindSeats` has no callers in this PR, so its tests are the only thing holding its contract until PR2. If a test looks wrong, the test likelier encodes the intended contract — re-read the Design decisions and the Roles section before changing an assertion, and report rather than adapt.
