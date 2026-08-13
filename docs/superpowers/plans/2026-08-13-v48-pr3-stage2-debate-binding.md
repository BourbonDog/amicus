# v4.8 PR3 — Stage-2 + debate seat binding (additive seat, zero space migration)

**Merge-base: `main` = `ad8c83c`** (merge of [PR #153] = PR2b). Every number, line and behaviour in this
plan was **re-measured or executed at that commit** by an 11-agent recon pass on 2026-08-13. The spec
(`docs/superpowers/specs/2026-08-10-v4.8-ask-anything-count-everyone-design.md`) was written at
`c11bdd1`: **7 of its 27 §4.4/§4.5 rows are still line-accurate, 13 have MOVED, 6 are STALE or FALSE.**
Section 2 lists the corrections. **Where this plan and the spec disagree, this plan is the measured one
— but where this plan and SOURCE disagree, SOURCE wins and you must stop and say so.**

---

## 0. Owner rulings (Christian, 2026-08-13) — settled, do not relitigate

- **R3-1 — Additive seat, NOT a space migration.** `adjudications[].judge`, `rankings[].judge`,
  `meta.models`, **`tallyInput.findings[].raiser`**, every runStats `model`, every ledger row, the
  report matrix and street-cred stay **alias-valued, byte-for-byte, on every bench**. The seat rides
  **alongside** as a new optional field. The raiser half is IN scope.
  ⚠️ **"`raiser` stays alias" means the tally-input FIELD.** Three *keys* deliberately become seat
  keys — `byRaiser`, `defenseByRaiser`, and `debate.json`'s `debateFindings[].raiser` — see §3.3 for
  why each is correct and why re-aliasing `defenseByRaiser` silently loses a twin's findings.
- **R3-2 — A twin bench launches ONE LEG PER SEAT, on BOTH debate waves.** `disputingJudges` and
  `debateTargets` both become seat-aware; `run-debate.js` projects seat → alias for the launchers.
  ⚠️ **Measured consequence: up to TWO extra paid legs per twin pair** (one defense/rebuttal solo AND
  one re-vote leg), plus their repair solos — not "one extra leg", which is how this ruling was first
  written. CHANGELOG-worthy; see Task 7 entry 1.
- **R3-3 — Widen the artifact-name skew and disclose it.** `judge-`, `rebuttal-` and `revote-` all move
  to `artifactName(seat, kind)`. PR2b's existing CHANGELOG Known Limitation is extended to name them.
  PR5 closes all five families at once.
- **R3-4 — Extract `runRevoteWave` into its own module** as a pure, proven-byte-identical Task 1.

## 0.1 Why additive rather than the spec's space migration — the evidence

`judgeResults[].judge` fans out five ways and **two branches are launch arguments the spec never
enumerates** (§4.7 names only `pickFallbackChair`):

```
run-stage2.js:82  judge = leg.modelInput || leg.model
 → run-assemble.js:163 adjudications[].judge   → tally.js:96  v.judge !== f.raiser
 → run-assemble.js:164 rankings[].judge        → tally.js:58  judge !== m
 → run-assemble.js:186 judge runStats .model   → report.js:40 byJudge[adj.judge]
                                               → debate.js:60 a.judge === judge
                                               → debate.js:139 disputingJudges
                                                  → run-debate.js:116 launchWave({models}) ⚠️
run.js:189 toGlobalFindings(letter, r.model, …) → f.raiser
 → ledger.js:71 findings.filter(f => f.raiser === model)
 → debate.js:155 byRaiser[f.raiser] → run-debate.js:59 launchSolo({model: raiser}) ⚠️
```

Executed: `byRaiser` keys → `['deepseek#1']`; `disputingJudges` → `['deepseek#2']`. Neither routable.

**THE LAUNCHER INVENTORY — SIX sites, not two.** ⚠️ **After Task 1, four of them live in two different
files.** Re-derive with
`grep -n "launchSolo\|launchWave" src/council/run-debate.js src/council/run-debate-revote.js src/council/run-stage2.js`:

| # | symbol / site | argument | fed by | after Task 1 |
|---|---|---|---|---|
| L1 | `runDefenseSolo`'s defense solo (`run-debate.js:59`) | `model: raiser` | its 2nd parameter | stays in `run-debate.js` |
| L2 | **`runDefenseSolo`'s defense REPAIR solo (`run-debate.js:78-79`)** | `model: raiser` | the same parameter. **Missing from the spec, from §4.7, and from this plan's first draft** | stays |
| L3 | `runRevoteWave`'s wave (`run-debate.js:116`) | `models: judges` | `disputingJudges` | **moves to `run-debate-revote.js`** |
| L4 | `runRevoteWave`'s re-vote repair solo (`run-debate.js:136`) | `model: judge` | the `-rv` wave leg | **moves to `run-debate-revote.js`** |
| L5 | `runStage2`'s `-s2` wave (`run-stage2.js:63-64`) | `models: judges` | `reviews.map(r => r.modelInput)` (`:57`) | unchanged; **PR3 leaves it alias — Task 4 Step 3 pins it** |
| L6 | `runStage2`'s `-q<N>` judge-repair solo (`run-stage2.js:104-105`) | `model: judge` | `leg.modelInput \|\| leg.model` (`:82`) | unchanged; PR3 leaves it alias |

⚠️ **L5 is the one an implementer is most likely to break** — it sits beside Task 4's new seat roster
construction, and passing the seat-object roster into `models:` is the obvious wrong move.

**A half-flip is a regression, not an incomplete fix** (measured, duplicate bench; every row below is
byte-identical on a unique-alias bench because `seats.js:67` sets `id = alias` when the alias is unique):

⚠️ **The two half-flips are DIFFERENT hypotheses and produce different damage — the column each row
belongs to is load-bearing.** Measured separately:

| surface | today | **half-flip A**: judge→seat, raiser alias | **half-flip B**: raiser→seat, `meta.models` alias |
|---|---|---|---|
| `tally.js:96` basis | `{a:0,d:0}` false **Singleton** | `{a:2,d:0}` false **Confirmed** — counts the raiser's OWN vote | — |
| `tally.js:58` `peersOnly` | 2 | 1.5 (self-rank no longer excluded) | — |
| `ledger.js:71` `findingsRaised` | double-counted | **unchanged, still double-counted** (it reads only `meta.models` × `f.raiser`, neither of which moves under A) | **0 on every row, `confirmRate: null`** |
| `report.js` matrix | one twin's vote renders | **both twin columns blank** | — |
| `computeStreetCred` w/ seat `order` | populated | — | `withSelf:null, peersOnly:null` for every seat |

`confirmRate` (`ledger.js:83`) and `streetCredPeersOnly` (`:80`) are appended to an **append-only**
JSONL and averaged for life; `peersOnly` is the sort key `pickFallbackChair` **launches** from.

And `applyDebate`'s miss branch **fails open** — a space mismatch invents an adjudication row rather
than throwing (`debate.js:62`). Measured: a 3-seat bench produced **5** adjudications on one finding,
the tier moved, no diagnostic.

**The additive design keeps every existing wire value untouched on every bench, so none of the above
can happen, and it still fixes everything in §1.**

---

## 1. What PR3 fixes

Four defects the owner named, plus **two live bugs on `main` that neither the spec nor BACKLOG records**:

| # | Defect | Site | Evidence it is live |
|---|---|---|---|
| # | Defect | Site | Status on `main` today |
|---|---|---|---|
| D1 | `judge-<alias>.md` clobber — two twin judges, ONE file | `run-stage2.js:84` | **LIVE.** Probe: run dir contained `["judge-deepseek.md"]` for 2 judges |
| D2 | `rebuttal-`/`revote-<alias>.md` clobber | `run-launch.js:227` via `run-debate.js:185,:222` | ⚠️ **LATENT for BOTH.** A clobber needs two writes to one path; today twins collapse **upstream** — `byRaiser` is alias-keyed (`debate.js:155`) so two twin raisers share ONE defense solo and ONE `rebuttal-deepseek.md` write, and `disputingJudges` Set-dedups so there is one `revote-` write. Measured: `byRaiser` keys `['deepseek']` → 1 solo → `['rebuttal-deepseek.md']`. **PR3 creates the second write (Task 6 Step 2 / Step 6) and names it per seat in the same task** |
| D3 | `byJudge[judge]` last-wins clobber | `run-debate.js:149` | ⚠️ **LATENT, NOT LIVE — masked by D6.** `disputingJudges` Set-dedups aliases, so the `-rv` roster can never contain two twins today and `byJudge` never actually clobbers. It becomes reachable **the moment D6 is fixed** — which is why D3, D4 and D6 must land in ONE task |
| D4 | `${waveId}-${judge}r` repair id collides for twins | `run-debate.js:134` | ⚠️ **LATENT**, same masking as D3 |
| D4b | …and the SAME line silently nests session dirs for slash-bearing aliases | `run-debate.js:134` | **LIVE and independent of any of this.** `r1-rv-openrouter/deepseek/deepseek-chatr` → a 3-level nested dir that fails `TASK_ID_PATTERN` (`validators.js:25`) and is therefore invisible to `amicus read`/`list` (`sidecar/read.js:50`). Derived sub-wave ids are never validated |
| **D5 (new)** | **`applyDebate`'s `.find()` is FIRST-WINS** — with two twin `{A1, judge:'deepseek'}` rows and one re-vote, only the first flips | `debate.js:60` | **LIVE.** Measured: `A1` moved `Disputed → Contested` on a **partially applied** re-vote, silently |
| **D6 (new)** | **`disputingJudges` Set-dedups aliases** — two disputing twin seats buy ONE re-vote leg; the second seat's verdict can never be updated | `debate.js:139` | **LIVE.** Probe: 2 twins disputing → `["gemini"]` |
| D7 | `run.js:212`'s judge map collapses twins, so a judge's `unstructured` conformance never reaches its seat's row | `run.js:212-215` | **LIVE.** Probe: 3 judgeResults → Map size 2; `byJudge.get('deepseek')` returns the SECOND twin |

⚠️ **Do not claim D2, D3 or D4 were live — anywhere, least of all in the CHANGELOG.** All three are
latent, masked by the alias-keyed collapse upstream (`byRaiser`, `disputingJudges`). **PR3 unmasks and
closes them in the same task.** Only **D1, D4b, D5, D6 and D7** are live today.
If a live *filename* clobber is wanted for the CHANGELOG, the honest one is the **sanitizeName
collision** (two DISTINCT aliases sanitizing to one name), which `run-launch.js:227` clobbers today
and which seat-based naming does **not** fix — do not attribute that one to twin benches either.
This distinction was wrong in two successive drafts of this plan and is exactly the
false-user-facing-claim class that shipped through four review stages in PR2b.

**Explicitly NOT fixed by PR3 (deferred, unimproved but never worse):** #137's tally basis (a twin bench
still yields a false `Singleton` — `tally.js:96` is untouched), `sameModelCorroboration` (R8),
`meta.seats`, the ledger `(model, resolvedModel)` grouping, street-cred seat-exactness, the report /
Workspace matrix, `blind-mode.js`, `live-seats.js`, `workspace-panels.js`, `run-detail.js`,
`artifact-guard.js`, the cost bijection.

---

## 2. Spec corrections you must not re-derive

| spec claim | measured at `ad8c83c` |
|---|---|
| §4.5 `tally.js:96` "→ seat identity + the R8 stamp" | **The peer filter needs ZERO edits.** Once raiser and judge are both seat-valued, `v.judge !== f.raiser` *is* seat-exact. Only `sameModelCorroboration` is a `tally.js` semantic edit. PR3 does neither |
| §4.5 `verdict.js:38-39,:72,:87` critic tests → `criticSeat` equality | **NO-OP.** `criticSeat === critic` is invariant: `preflightSeats` rejects an ambiguous critic (`seats.js:252-255`) and a unique alias has `id === alias`. `grep -n judge src/council/verdict.js` → empty |
| §4.8 "Key the bijection on `legId`. **The row carries it**" | **FALSE, both halves.** `buildRunStatsEntry` (`run-assemble.js:60-75`) emits no `legId`; the test's ground truth reads `leg.modelInput \|\| leg.model` (`run-cost-bijection.test.js:111,:128`) |
| §4.5 `run-launch.js:217` rebuttal/revote = `sanitizeName(modelInput)` | It is `sanitizeName(leg.model)` at **`:227`**, and the objects reaching it are freshly built literals carrying **no** `legId`/`taskId`/`modelInput` |
| §4.5 `run-stage2.js:79` judge binding | `:79` is `const extraRows = [];`. The binding is **`:82`** |
| §4.5 `run.js:175/:180/:203` | **`:184` / `:189` / `:212`** |
| §4.5 `run-assemble.js:151/:159/:181-183/:243` | **`:156` / `:163` (+`:164`, which the spec never lists) / `:186` / `:247`** |
| §4.5 `run-stages.js:112` materializes `[...legs, ...recoveredLegs]` | **`:153`** (+41 — the worst drift in the set) |
| §4.4 `run-retry.js` nine joins; `run-stages.js:267-270` `deadAliases` | **DONE in PR2b.** The symbol `deadAliases` no longer exists anywhere in `src/` |
| §4.4 `fake-launchers.js:13` taskId | **DONE in PR0** — but `run-debate.test.js` has its **own** `leg()` helper PR0 never touched |
| §4.4 `deriveLegIds` at `fanout.js:30-32` | **`src/sidecar/leg-ids.js:15-17`** (PR0 split) |
| §4.5 `live-model.js:216-220,:283` | **`electron/workspace-ui/live-seats.js:178-179`** (PR0 split) |
| §4.5 `run-stages.js:33-40` `roleFor` → `roleAt` | **Overruled in flight by PR2b** — `run-stages.js:269` reads `m.seat.role` off the bound seat, with a ⚠️ saying "NOT `roleAt(o.seats)`" |
| §4.5 chair packet `{ model: r.seat.displayName }` | `displayName` is a **function** (`seats.js:178`), not a property. (Out of PR3 scope regardless) |
| §4.2 `sanitizeName (run-launch.js:180)` | `seats.js:20-22`, re-exported from `run-launch.js:235` |
| §4.7 `pickFallbackChair` at `run-chair.js:63` | **`:61`** |

Also stale and worth fixing while adjacent (docs-only, Task 7): `artifact-guard.js:25-26` cites
`run-debate.js:119` / `run-debate.js:261` / `run-launch.js:127-136`; actual `:106` / `:247-248` /
`:223-232`. And `seats.js:44-46` cites `run-assemble.js:92-103` / `:170`; actual `:96-107` / `:174`.

---

## 3. The design

### 3.1 The one rule

> **Aliases launch and ledger. Seats bind, key and name files. They travel as PARALLEL data on the
> same object — never as two spellings of one field.**

Every new field is **optional and emit-when-set**. Absent seats ⇒ every expression below reduces to
the literal line shipping today ⇒ legacy parity is automatic and needs no branch.

### 3.2 The join key idiom (copy it verbatim; it is PR2b's, already reviewed)

```js
const seatKey = (s, alias) => (s ? s.id : alias);        // run-retry.js:149
```

### 3.3 The new/changed fields, end to end

| carrier | new field | value | who reads it |
|---|---|---|---|
| `reviews[]` (`run-stages.js:264`) | `seat` | the seat OBJECT or `null` | `run-stage2.js` roster, `run.js:189`, `run.js:214` |
| `judgeResults[]` (`run-stage2.js:129,:141`) | `seat` | the bound seat OBJECT or `null` | `run.js:212`, `run-assemble.js:163` |
| `adjudications[]` (`run-assemble.js:163`) | `seat` | `j.seat.id`, **emit-when-DIFFERENT** | `tally.js:89` passthrough → `debate.js:60`, `debate.js:139` |
| `findings[]` (`anonymize.js:51`) | `raiserSeat` | the raiser's seat id, **emit-when-DIFFERENT** | `tally.js:105` passthrough → `debate.js:155` |
| `revoteByJudge` keys (`run-debate-revote.js`) | — | `seatKey(seat, alias)` | `debate.js:58` |
| `byRaiser` / `defenseByRaiser` keys (`debate.js:155`, `run-debate.js:188`) | — | `f.raiserSeat \|\| f.raiser` | `run-debate.js:178` |
| `debate.json`'s `debateFindings[].raiser` (`debate.js:43`) | — | the raiser **KEY** | nothing in `src/` — writers only |
| `debate.json`'s `revotes[].judge` (`run-debate.js:245`) | — | `seatKey(seat, alias)` | ⚠️ **`workspace-panels.js`'s `drillIntoJudge` (`:98-100`) joins `r.judge === judgePair.model`, and `judgePair.model` is the bench ALIAS** — see Task 6 Step 9 |
| `addendumOutcomes[].priorVerdicts` / `.revotes` keys (`run-debate.js:268-275`) | — | `seatKey(seat, alias)` | `briefings-debate.js:164-167` renders them as prose; **both maps must share one space or every line prints `no prior verdict`** |

⚠️ **EMIT-WHEN-DIFFERENT, not emit-when-set.** Write `seat`/`raiserSeat` **only when the value differs
from the alias it accompanies**:
```js
...(j.seat && j.seat.id !== j.judge ? { seat: j.seat.id } : {})
```
On a unique-alias bench `seat.id === alias`, so the field is absent and `tally-input.json`,
`tally.json` and `verdict.json` are **byte-identical artifacts**, not merely behaviourally identical.
Emit-when-set would add a redundant key to every document on every run — a universal artifact-shape
change the CHANGELOG would then have to disclose, for zero benefit. Every consumer reads
`(a.seat || a.judge)`, which is unaffected.

**Two identity rulings that look like violations and are not:**

- **`defenseByRaiser` stays SEAT-keyed.** Do NOT "fix" it to the alias. Proven by execution: with two
  twins (`deepseek#1` amends A1, `deepseek#2` withdraws B1), seat-keyed gives keys
  `["deepseek#1","deepseek#2"]` and **both** `debateFindings` rows, with A1's claim amended.
  Alias-keyed collapses to `["deepseek"]` and — because `defenseByRaiser[dr.raiser] = {...dr.byId}`
  (`run-debate.js:188`) is **last-wins** — keeps only the LAST twin's map: **A1's row vanishes from
  `debate.json` and its amended claim never reaches `findings[]`.** ⚠️ *Which* twin is lost depends on
  `Promise.all` resolution order, and that is the point — it is not recoverable. **Do not encode "B1
  is dropped" as a regression pin; that test would fail.** (An earlier draft of this paragraph stated
  the loss backwards.)
- **`debate.json`'s `debateFindings[].raiser` therefore becomes the seat key on a twin bench.** This is
  a deliberate improvement, not a §3.3 violation: it is a *different field* from
  `tallyInput.findings[].raiser` (which is untouched), nothing in `src/` reads it (grep: writers only),
  and on a unique bench it is byte-identical. Disclose it in the CHANGELOG.

**Unchanged, deliberately, and a reviewer must reject any diff that moves them:** `judge`,
`rankings[].judge`, `meta.models`, **`tallyInput.findings[].raiser`**, every runStats `model`,
`legRow`'s first argument, `debateRunStatsRows`' output shape, `tally.js:96`, `tally.js:58`,
`data.seat` on degrade notes.

### 3.4 The roster-padding pattern — MANDATORY, copy from `run-retry.js:107-137`

`bindSeats` filters falsy roster entries internally (`seats.js:131`), so passing a roster with a `null`
hole **slides every later slot into that hole and mis-attributes**. Two `{id: null}` sentinels also
**collide** on the id-keyed dedup (`seats.js:146`). PR2b hit both. The proven pattern:

```js
const placeholders = new Set();
const roster = seatsInLaunchOrder.map((s, i) => {
  if (s) { return s; }
  const p = { id: `__unbound-${waveId}-${i + 1}`, alias: aliases[i], role: 'seat', lens: null, position: i + 1 };
  placeholders.add(p);
  return p;
});
const bindRes = bindSeats(waveId, roster, legs);
const seatOf = new Map(bindRes.bound.filter(b => !placeholders.has(b.seat)).map(b => [b.leg, b.seat]));
```

⚠️ **Track placeholders by IDENTITY (`Set.has(obj)`), never by an id-name prefix test.** A bench alias
that literally began `__unbound-` would make a name test drop a REAL seat's binding — a name-collision
channel inside the one mechanism whose whole contract is "never guess". This comment exists verbatim at
**`run-retry.js:117-120`** (the placeholder mint is `:122-127`, the bind `:129`, the identity filter
`:130-132`); do not weaken it. *(First draft cited `:658-661` — a file that is 290 lines long. That was
a recon-report line number copied without opening the source: failure class 5, caught here.)*

### 3.5 Legacy-parity proof obligation

For **every** edit below, the task's review must state which expression reduces to today's literal when
`seat`/`raiserSeat` are absent, and a test must pin it. This is the byte-identical promise.

⚠️ **The promise has exactly ONE disclosed exception, and it is not a shape change.** Task 6 replaces the
re-vote repair id `${waveId}-${judge}r` with `${waveId}-${sanitizeName(key)}r` — deliberately, because the
raw form nested a `/`-bearing alias three directory levels deep (D4). On a unique-alias bench `key` **is**
the alias, so the two forms differ only when the alias contains a character `sanitizeName` rewrites (anything
outside `[a-zA-Z0-9._-]`) *and* that judge's re-vote actually drew a repair. Such a run records a different
`waveId` for that ONE leg in `run.json`'s `stages[].waveIds` and in its `runStats` row of
`tally-input.json`, `tally.json` **and `verdict.json`** — `verdict.js:129` is `runStats: record.runStats`,
so the verdict carries the tally's array through **by reference** and shows the changed id too.

**Scope the claim to what was actually measured, and no further:** the exception is confined to that ONE
leg's identifier. No document gains or loses a key, no run-dir artifact filename changes, and no other
leg's `waveId` moves. It is nonetheless a real byte difference in three shipped documents, so §3.5's
promise must be stated *with* the exception rather than over it — which is what the CHANGELOG now does.
*(Added by the final whole-branch review, F6 — the unconditional wording above was the claim, the shipped
slash-bug fix was the reality. An earlier draft of THIS annotation then over-corrected in the same
breath: it read "Every other document, filename and leg stays byte-identical", which is the very
unconditional byte-identity claim F6 exists to retire, and it is false for `verdict.json` for exactly the
by-reference reason above. Caught by the scoped re-review of the F6 fix. Same sentence class as the
false Workspace sentence caught at Task 7 and the one that already shipped once in PR2b: a correction
written without re-opening the file the claim is about.)*

---

## 4. Tasks

Each task is one commit. **No task may leave the suite red.** Run `npx jest <path> --silent` per task —
**never `npm test -- <path>`** (it rewrites `.test-passed` and the pre-push hook then trusts a partial
run). Never pipe a gate through `| tail`.

### Task 0 — Branch, plan commit, baseline

1. Sibling worktree `../amicus-wt-pr3` off `origin/main` (`ad8c83c`), created from **PowerShell**.
   Junction `node_modules` from the main clone.
2. Commit this plan and the scoping memo (`2026-08-13-v48-pr3-scoping-memo.md`) as the first commit.
3. Baseline — **already MEASURED in this worktree on 2026-08-13, not quoted**:
   **519 suites passed / 7188 passed / 8 skipped / 7196 total / 0 failed / 4 snapshots**, 208.8 s,
   `npm test` exit 0. (It happens to match PR2b's merge report exactly, but it was re-run, not
   inherited.) Re-run `npm run lint` and `npm run check:sizes` and record their exit codes.
   ⚠️ If your `npm test` disagrees with 519/7188/8, STOP — something moved and every count in this
   plan is suspect.
4. Record measured sizes: `run-debate.js` **283**, `run-stages.js` **292**, `run-retry.js` **290**,
   `run-stage2.js` **147**, `debate.js` **177**, `run.js` **259**, `run-assemble.js` **262**,
   `tally.js` **139**, `run-launch.js` **236**, `anonymize.js` (measure).

### Task 1 — Extract `runRevoteWave` → `src/council/run-debate-revote.js` (NO behaviour change)

**Why:** `run-debate.js` is 283/300 — 17 lines. Owner ruling R3-4.

**Move verbatim** from `run-debate.js`: `legOpts` (**L24-31 — L24 is its JSDoc line; include it**),
`legRow` (L33-48 incl. JSDoc), `runRevoteWave` (L101-155). Export all three. `run-debate.js` requires
them back and keeps `runDefenseSolo` + `runDebate`.

**Requires for the new module:** `fs`, `path`, `./briefings-debate`, `./parse-stage2`
(`parseRevote`), `./run-state`, `../observe/events` (`emitStageStarted`), and
**`isAbortExit` from `./run-launch`, NEVER from `./run-stages`.**
Rationale, and it is load-bearing: `run-stage2.js:12` records that taking `isAbortExit` from
`run-launch.js` "is what dissolved the old cycle (v4.4.1 review F5)". Requiring `./run-stages` from a
new leaf drags in `run-retry` → `run-retry-notes` → `briefings` and re-opens that cycle class.
There is exactly ONE cycle in `src/council/` today (`report.js ↔ report-html.js`); do not add a second.
*(Task 6 will add `./seats` to this module for `bindSeats`/`artifactName`/`sanitizeName`. **Not in
Task 1** — Task 1 is a pure move and must add no symbol.)*

- [ ] Step 1: create the module, move the three functions **byte-identically** (comments included).
- [ ] Step 2: fix `run-debate.js`'s require block. **Measured, not guessed:**
      - **DELETE `const { emitStageStarted } = require('../observe/events');`** — it is used at exactly
        ONE site, `run-debate.js:114`, which is **inside** `runRevoteWave` and moves out. Leaving it is
        a `no-unused-vars` **error** (`.eslintrc.js:13`) that `eslint --fix` cannot repair, and it fails
        this task's own Step 5 lint gate. *(The first draft of this plan named it as still-used. It is
        not.)*
      - **DROP `parseRevote`** from the `./parse-stage2` destructure — same reason. Keep
        `parseDebateDefense` (`runDefenseSolo` uses it).
      - **REQUIRE BACK all three moved symbols**, `runRevoteWave` included — `runDebate` calls it at
        `run-debate.js:214`. Omitting it turns a lint error into a `ReferenceError`.
      - **Genuinely still used by what stays** (keep every one): `fs`, `path`, `dbrief`
        (`./briefings-debate`), `parseDebateDefense`, `./debate`'s exports, `materializeDebate`,
        `tally`, `isAbortExit`, `runState`.
      - Verify by execution, not by reading: `npx eslint src/council/run-debate.js
        src/council/run-debate-revote.js` must exit 0.
- [ ] Step 3: prove byte-identical. `git diff` must show only moves + the require/export lines.
      Run `npx jest tests/council/run-debate.test.js tests/council/debate.test.js --silent` — green,
      **same test count**.
- [ ] Step 4: `npm run check:sizes` and record both files' new line counts.
      ⚠️ **Exit 0 is NOT evidence the new module was scanned.** `npm run check:sizes` is
      `check-file-sizes.js --all`, whose `checkAllTracked()` (`:113-120`) enumerates via
      `listTrackedFiles()` → `git ls-files` (`:104-107`) — **an untracked file is invisible to it** —
      and `main()`'s `--all` branch prints **nothing** on success, so there is no list to grep.
      Assert directly instead:
      ```bash
      node -e "const {checkFileSize}=require('./scripts/check-file-sizes');const fs=require('fs');const p='src/council/run-debate-revote.js';console.log(checkFileSize(fs.readFileSync(p,'utf8'),p,300))"
      ```
      `null` ⇒ under the limit. *(An earlier draft told the implementer to grep `--all`'s output and
      treat a miss as a broken glob — which would have sent them editing `CONFIG.include` to chase a
      phantom. The glob is fine; `matchesPattern('src/council/run-debate-revote.js', ['src/**/*.js'])`
      is `true`.)*
- [ ] Step 5: `npm run lint` — exit 0.
- [ ] Step 5: `CLAUDE.md` AUTO markers — `scripts/generate-docs.js --check` gates the module tree and
      the exports table. Run it; regenerate if it fails.

**Naming caution:** `run-debate-stage.js` already exists (the thin `run.js` ↔ `run-debate.js` wrapper).
Do not name the new file anything that reads as its sibling-by-accident.

### Task 2 — Stamp `describe('runStage2')`'s fixtures (TEST-ONLY, all 13 tests stay green)

**Range: `tests/council/run-stages.test.js:1170-1474`** (next `describe` at `:1476`).
**RE-DERIVE IT FIRST** — `grep -n "describe('runStage2'" tests/council/run-stages.test.js` and find its
closing brace. It is **not** `:780-1084`; that number is from an older note and is wrong.

**35 leg-builder invocations** (34 `mkLeg`, 1 `deadLeg`, 0 `usableLeg`): 2 in `stage1Reviews()`
(`:1175`, `:1178` — review-row `.leg` values, not wave legs) and **33 in test bodies**.

**12 bare `onWave` callbacks need an `opts` parameter added**: `:1227, 1256, 1287, 1308, 1329, 1344,
1362, 1383, 1399, 1417, 1440, 1461`. Only T1 (`:1191`) already has it. **1 bare `onSolo`**: `:1348`.

- [ ] Step 1: widen the 12 bare `onWave: () =>` to `onWave: (opts) =>` and the bare `onSolo` at `:1348`.
- [ ] Step 2: stamp every in-body builder with `(waveId, slot)`.
      **Preserve each literal — do NOT rewrite the hand-built 2-element arrays into `.map`.** 11 of the
      12 bare `onWave`s build two legs with *different* summaries per model; a `.map` rewrite changes
      their shape. Use:
      ```js
      onWave: (opts) => okWave([
        mkLeg('gemini', 'no json', 'complete', opts.waveId, 1),
        mkLeg('gpt', judgeOut([...], [...]), 'complete', opts.waveId, 2),
      ]),
      ```
- [ ] Step 3: `stage1Reviews()` (`:1171-1180`) gains `seat:` per entry, mirroring Task 3's production
      shape. Use real seats: `buildSeats(['gemini','gpt'], null, null)` positionally.
- [ ] Step 4: run `npx jest tests/council/run-stages.test.js --silent`. **Green, identical test count.**

**TRAPS — all three are live and all three fail SILENTLY:**

| # | Trap | Source |
|---|---|---|
| T1 | `mkLeg`'s **3rd positional is `status`**, defaulted `'complete'`. `mkLeg('gemini','x','abc123-s2',1)` silently sets `status: 'abc123-s2'`. Unlike `deadLeg`, `mkLeg` has **no guard**. **Always spell `'complete'` explicitly.** | `run-stages.test.js:31-36` |
| T2 | `deadLeg` at `:1444` has TWO defaulted params before `waveId`/`slot` — it must become `deadLeg('gemini', 'error', 'boom', opts.waveId, 1)` or the `DEAD_LEG_STATUSES` guard throws (that guard is itself pinned at `:103-107`) | `run-stages.test.js:48-56` |
| T3 | A leg with **no `waveId`** can bind ONLY by exact roster-slot id; and for a **twin** roster the alias fallback can never bind (`seats.js:143-144` requires `hits.length === 1`). Measured: twin roster + `waveId`-stamped alias-only legs → `bound: []`, 2 orphans | `seats.js:133,:141-144` |

⚠️ **`bindSeats` binds a leg with a `waveId` field only, via the alias fallback, on a unique-alias
bench.** That is why a half-stamped fixture looks correct here and would silently mis-seat a twin.
Stamp the slot, not just the waveId.

### Task 3 — `run-debate.test.js` harness (TEST-ONLY, all 59 tests stay green)

Two independent defects, both of which would make Task 6 **green for the wrong reason**:

- [ ] Step 1: the file-local `leg()` helper (`:39-42`) emits ``taskId: `${model}-t` `` — a leg document
      real fanout **cannot produce**. `bindSeats`' `/^(.*)-(\d+)$/` never matches it, and the alias
      fallback needs `leg.waveId === waveId`. Measured today against a `['gpt','qwen']` roster:
      `bound: []`, `unbound: ['gpt','qwen']`, 2 orphans.
      **Census, measured — re-derive it before you start:** `leg()` is invoked **41 times across 28
      lines**; **32 invocations omit `waveId`** and **9 pass one, across 6 lines** (`:373`, `:438`,
      `:482` ×2, `:484`, `:502` ×2, `:512` ×2). *(The first draft said "26 of 28, only :502 and :512" —
      wrong by ~13 sites and by 4 lines. An implementer using that as the done-check stops short and
      leaves unbindable legs in the suite, which then exercise the orphan path in Task 6 instead of the
      seat-bound one — green for the wrong reason, which is the whole reason this task exists.)*
      ⚠️ **Copy the shape from `scriptedLaunchers`' re-stamp at
      `tests/council/helpers/fake-launchers.js:41-48`** (`leg.taskId = \`${opts.waveId}-${slot}\``,
      roster-slot-based, consumed without replacement) — **NOT from `mkLeg` at `:14-18`, which uses a
      file-global `legSeq` counter, not a slot.** A global counter produces unique ids that index the
      wrong roster position.
      **Done-check:** no `-t` taskIds remain anywhere in the file, and a probe binding each wave's legs
      against its roster returns `unbound: []` and `orphanLegs: []`.
- [ ] Step 2: `ctxFor` (`:47-57`) supplies **no `o.seats`, no `o.criticSeat`, no `o.models`, no
      `ctx.degrade`**. Production sets the first three at `run.js:131-135` and `ctx.degrade` at
      `run.js:119`. Widen it exactly as PR2a widened `run-stages.test.js`'s `makeCtx` (`:59-100`),
      including the explanatory comment. Without `ctx.degrade` any new note call throws
      `Cannot read properties of undefined`.
- [ ] Step 3: `npx jest tests/council/run-debate.test.js --silent` — **59 green, count unchanged.**

### Task 4 — The seat reaches Stage 2; `judge-<seat>.md`; the conformance merge

**RED first.** Write these before touching `src/`, and paste the failing output into the task report:

1. A twin bench `['deepseek','deepseek']` through `runStage2` writes **two** judge files
   (`judge-deepseek-1.md`, `judge-deepseek-2.md`). RED today — measured: run dir contains
   `["judge-deepseek.md"]`, one file for two judges.
2. `judgeResults[]` carries a distinct `seat` per twin; `judge` is still `'deepseek'` on both.
3. A unique bench writes `judge-gemini.md` byte-identically (parity pin) — GREEN today, must stay.
4. `run.js`'s conformance merge reaches BOTH twins (D7). RED today — probe: `byJudge.get('deepseek')`
   returns the SECOND twin, so both reviews take the second twin's conformance.

**Edits:**

- [ ] Step 1 — `src/council/run-stages.js:264`. Add `seat: m.seat || null,` **onto the existing line**:
      ```js
      model: m.modelInput, modelInput: m.modelInput, seat: m.seat || null,
      ```
      **Net zero lines — `run-stages.js` stays at 292/300.** There is no `max-len` rule
      (`.eslintrc.js:12-22` — verified). `materializeReviews` already resolves the seat
      (`run-launch.js:206`) and returns it on each row (`:210`); `runStage1` currently consumes it for
      `role` (`:269`) and **drops it**. ⚠️ **Do not add a separate line here.** Standing constraint:
      `run-stages.js` at 292 and `run-retry.js` at 290 need an EXTRACTION, not a squeeze — a zero-line
      additive field is the only edit this plan permits in either file.
- [ ] Step 2 — `src/council/run-stage2.js`. Add `const { artifactName } = require('./seats');`.
      **`artifactName` is NOT re-exported from `run-launch.js`** (its exports are
      `{createLaunchers, materializeReviews, materializeDebate, sanitizeName, isAbortExit}`), so require
      `./seats` directly — it requires nothing, so **zero cycle risk**. `run-stage2.js` has 153 lines of
      headroom; there is no size pressure in this file.
- [ ] Step 3 — build the `-s2` bind roster **in `reviews` order**, using §3.4's padding pattern:
      ```js
      const judges = reviews.map(r => r.modelInput);         // UNCHANGED — the launch argument
      const roster = /* padded reviews.map(r => r.seat) */;
      ```
      **Why `reviews` order is correct:** `judges` is built from the same array by the same `.map`, and
      real fanout stamps `${waveId}-${i+1}` off that same index (`src/sidecar/leg-ids.js:15-17`). This
      holds even after an SL-2 heal, when recovered legs are **appended** (`run-stages.js:153`) and
      `reviews` order is therefore no longer seat order — both arrays derive from the same `reviews`.
- [ ] Step 4 — `bindSeats(`${o.runId}-s2`, roster, wave.legs)`; drop placeholder binds by identity.
- [ ] Step 5 — the filename at `run-stage2.js:84`:
      ```js
      const name = seat ? artifactName(seat, 'judge') : `judge-${sanitizeName(judge)}.md`;
      ```
      Mirrors `materializeReviews`' shipped shape at `run-launch.js:207` exactly.
- [ ] Step 6 — attach `seat` to **both** `judgeResults.push` sites (`:129` the `ok:false` branch and
      `:141` the ok branch). `judge` is unchanged at both.
      ⚠️ `run-stage2.js:122`'s repair row keeps `model: judge` (ALIAS). `extraRows[].model` is pinned
      alias by `run-stages.test.js:1430-1432` and `:1454`, and §4.7 forbids a seat id on a ledger row.
      **Do not add `seat` to any runStats row** — `tally.js`'s allowlist (`:115-133`) has no `seat` key
      and would silently drop it, and adding that key is PR4's.
- [ ] Step 7 — an unbound judge seat emits `ctx.degrade.note({ channel: 'seat-unbound', … })`,
      following `stage1-bind.js:53`'s `orphanLegNote` shape verbatim (`data: { waveId, legId, seat }`).
      **`data.seat` is the ALIAS.** ⚠️ **The reason is consistency with the shipped `orphanLegNote`
      shape (`stage1-bind.js:63`), NOT `criticSeated`.** `deriveSeatLoss` (`verdict.js:65-89`) filters
      `degrades[]` to `channel === 'dead-wave'` (`:68`) and `channel === 'dead-leg'` (`:71`) **only** —
      a `seat-unbound` note's `data.seat` never reaches `criticSeated` or `deadBenchSeats` at all.
      PR2b's own CHANGELOG documents this as a known limitation (`CHANGELOG.md:37-44`). *(This plan's
      first draft justified C2 with the `criticSeated` argument, which is true of `dead-leg` notes and
      false of this one — an over-generalized recon fact. C2 still binds; its reason here is different.)*
      **`data.legId` is the discriminator**: present ⇒ an orphan leg (a review DID land); absent ⇒ a
      missing seat. **Only `run-degrade.js` may assign `degraded.value`** — go through `ctx.degrade.note`.
      ⚠️ **THIS CHANGES AN EXIT CODE.** `run-degrade.js:38` sets `degraded.value = true` for any record
      with `kind === 'degrade'`, so a Stage-2 wave that returns an unattributable leg now exits **2**
      where it previously exited 0 silently. That is the correct behaviour and it is symmetric with what
      PR2b shipped for Stage 1 (`CHANGELOG.md:30-32`) — **but it MUST be disclosed in Task 7's CHANGELOG.**
- [ ] Step 8 — `src/council/run.js:212-215`: key the map on `seatKey(j.seat, j.judge)` and look up
      `seatKey(r.seat, r.model)`.
      ⚠️ **THE MIXED CASE IS REACHABLE — an earlier draft claimed it was not, and that claim was
      FALSE.** It proved only one direction (`r.seat === null ⇒ j.seat === null`, because the
      placeholder is minted and then dropped). **The converse fails.** `j.seat` comes from
      `bindSeats(`${runId}-s2`, roster, wave.legs)`, which can fail to bind for reasons that have
      nothing to do with the review's seat: on a twin roster any `-s2` leg without a parseable
      `${waveId}-${n}` slot id is an orphan (`seats.js:141-146` needs `hits.length === 1` for the alias
      fallback), and `seats.js:133`'s `mine` filter silently discards a leg carrying a foreign
      `waveId`. In that state `r.seat` is a real seat and `j.seat` is `null`, so the two keys skew:
      `'deepseek#1'` vs `'deepseek'`. **Today the merge reaches both reviews (with D7's wrong
      last-wins value); a naive `seatKey` on both sides makes it reach ZERO** — a silent, total loss of
      the Stage-2 conformance merge. That is the very state Step 7 exists to degrade-note, and Task 2's
      trap T3 already measured it.
      **THE FIX — asymmetric fallback.** Key the map on `seatKey(j.seat, j.judge)`, then look up
      `r.seat ? r.seat.id : r.model` **and, on a miss, fall back to `r.model`**:
      ```js
      const j = byJudge.get(r.seat ? r.seat.id : r.model) || byJudge.get(r.model);
      ```
      An orphaned judge leg then still merges by alias — today's behaviour — while a bound twin merges
      by seat. **Pin BOTH**: (a) a twin bench with both `-s2` legs bound merges each judge onto its own
      seat's review; (b) a fixture whose `-s2` leg is an orphan still merges that judge's conformance
      onto its review. Without (b) the merge silently stops, which is a wrong `conformance` in
      `tally.json` and in the ledger row.
- [ ] Step 9 — gates: `npx jest tests/council/run-stages.test.js tests/council/run-launch.test.js
      tests/council/seats.test.js --silent`, `npm run lint`, `npm run check:sizes`.

### Task 5 — Additive `seat` on adjudications, `raiserSeat` on findings

**RED first:** an adjudication built from a seat-carrying `judgeResults` survives `tally()` with its
`seat`; a finding raised by a seat-carrying review survives with its `raiserSeat`. Both RED today —
`tally.js:89` and `:105` are **two-key / eight-key allowlists** that silently drop unknown fields.

- [ ] Step 1 — `src/council/anonymize.js`: `toGlobalFindings(letter, raiser, findings, raiserSeat)`
      gains a 4th parameter, **emitted only when it is truthy AND differs from `raiser`** — the same
      guard Step 3 uses, not "emitted when set". `run-assemble.js:125` calls it for Claude with three
      args ⇒ Claude's findings correctly carry **no** `raiserSeat` (Claude is not a seat —
      `seats.js:44-46`, and `run-assemble.js:96-107` rejects `claude` from `--models`, which is the
      guarantee no seat id can ever be `'claude'`).
- [ ] Step 2 — `src/council/run.js:189`: pass **`r.seat && r.seat.id !== r.model ? r.seat.id : null`**.
      ⚠️ **NOT `r.seat ? r.seat.id : null`.** On a unique-alias bench `r.seat` is present and
      `r.seat.id === r.model`, so the naive form emits `raiserSeat` on **every finding of every run** —
      a universal artifact-shape change that falsifies §3.3's byte-identical promise and Task 7's
      "no shape change on a unique bench" claim, and it ships **green** because no suite pins the
      findings shape. Measured under the naive form: a unique bench's tally-input finding came back
      `{...,"raiserSeat":"gemini"}`. *(An earlier draft carried the guard on Step 3 and omitted it
      here — the two halves of §3.3 disagreed with each other.)*
- [ ] Step 3 — `src/council/run-assemble.js:163`: add
      `...(j.seat && j.seat.id !== j.judge ? { seat: j.seat.id } : {})` — **emit-when-DIFFERENT** (§3.3).
      **`judge: j.judge` is unchanged. `:164`'s `rankings` is unchanged** — street-cred stays alias.
- [ ] Step 4 — `src/council/tally.js:89` and `:105`, two **passthrough** lines folded onto the existing
      literals (no new lines):
      ```js
      byFinding.get(adj.findingId).push({ judge: adj.judge, verdict: adj.verdict, ...(adj.seat ? { seat: adj.seat } : {}) });
      ```
      and `...(f.raiserSeat ? { raiserSeat: f.raiserSeat } : {})` on the findings return.
      **This is the ONLY `tally.js` change PR3 makes.** It is a passthrough, not a semantic change:
      `tally.js:96`, `:58`, `assignTier`, `computeStreetCred` and the runStats allowlist are untouched.
- [ ] Step 5 — schema check. `schemas/council-tally.schema.json` has `additionalProperties: false`
      **only at `:62`, scoped to the `debate` sub-object** (verified). `findings` items and
      `adjudications` items are open, `adjudications` is `{type:'array', items:{type:'object'}}` with no
      declared `judge` at all. **No schema edit is needed.** Add a test that asserts this — a future
      tightening of the schema must fail loudly, not silently drop the field.
- [ ] Step 6 — ⚠️ `tests/council/run-assemble.test.js:43-48` is an exact `toEqual` on all six
      `meta` keys. PR3 does **not** touch `meta`, so it must stay green **unedited**. If it goes red,
      you have changed `meta` and are out of scope — stop.
- [ ] Step 7 — gates: `npx jest tests/council/tally.test.js tests/council/run-assemble.test.js
      tests/council/anonymize.test.js --silent` (re-derive the anonymize suite's real path).

### Task 6 — The debate identity flip (ONE atomic task — pure + impure together)

**This task must not be split.** `debateTargets` keying `byRaiser` on the seat makes
`run-debate.js:178`'s `raisers` seat-valued, and `run-debate.js:59` **launches** them. `disputingJudges`
returning seats makes `run-debate.js:116` **launch** them. Landing either half alone puts a seat id into
a launcher — a red intermediate and a real paid-leg failure. This is exactly the straddling-signature
failure that forced PR2's split; do not repeat it.

**RED first — EIGHT tests, each with measured evidence:**

1. `applyDebate`, twin rows `{A1, judge:'deepseek', seat:'deepseek#1'}` and `{A1, judge:'deepseek',
   seat:'deepseek#2'}`, with a re-vote map carrying **BOTH** seat keys ⇒ **both** rows flip, each from
   its own key. **RED today — but NOT for the reason an earlier draft claimed.** The seat keys match no
   `a.judge`, so `debate.js:60`'s `.find()` misses and `:62` **fails open and pushes two brand-new
   rows**: measured, the array goes 2 → 4 and neither original flips. D5's first-wins form is only
   observable with an ALIAS-keyed map (measured control: `['agree','dispute']` — only the first flips),
   which is the shape production emits today and which Step 6 removes. **Do not describe test 1's
   failure as "only the first flips"** — the pasted RED output will show array growth, and an
   implementer expecting the other symptom will think the fixture is wrong.
2. **The discriminating companion to (1), and it is the one that proves the key is seat-EXACT:** the
   same two rows with a re-vote map carrying **ONLY `deepseek#1`** ⇒ `deepseek#1`'s row flips and
   `deepseek#2`'s verdict is **untouched**. ⚠️ Without this pin, an implementer who finds (1) failing
   is tempted to loosen the match back toward alias equality — which reinstates D5, the defect this
   task exists to kill. *(The first draft asserted "one seat-keyed re-vote ⇒ both rows flip", which
   Step 1's own edit cannot and must not produce.)*
3. **`applyDebate` must NOT grow the adjudications array** when every re-vote key matches a known
   judge. The contract pin that makes a future half-flip fail loudly instead of inventing rows
   (`debate.js:62` fails open). Measured today: a 3-seat bench produced 5 rows.
4. **The push branch itself — `debate.js:62` is currently UNCOVERED by the entire test suite.**
   `debate.test.js:65-71` is *named* "a re-vote on an id the judge never disputed" but `baseInput()`
   already carries `{findingId:'A2', judge:'gpt'}` at `debate.test.js:20`, so it takes the `.find()`
   branch. **Write a real push-branch test**: a re-vote keyed on a seat id for a finding that seat never
   adjudicated must push `{judge: 'deepseek', seat: 'deepseek#2'}` — **`judge` is the ALIAS, never the
   key.** Without this test, Step 1's `aliasOf` defect ships green.
5. `debateTargets` partitions twins — `byRaiser` has two keys. RED today (one key).
6. `disputingJudges` does not collapse twins. RED today (`Set` collapse, D6).
7. Repair-id uniqueness: two twin judges repairing in one `-rv` wave get distinct waveIds. RED today —
   both get `r-rv-deepseekr`. The seat form is `r-rv-deepseek-2r`.
**That is SEVEN RED tests.** The launcher-argument guard is the eighth test but it is **NOT** a RED
one — it belongs below.

**Parity pins (GREEN today, must stay green):**

- **Launcher-argument guard (a mutation-resistant invariant, not a case test):** capture every
  `launchSolo`/`launchWave` `opts.model`/`opts.models` during a **twin-bench** debate and assert every
  captured value is a member of `o.models`. ⚠️ **It is GREEN at `ad8c83c` and green after Tasks 1-5** —
  `byRaiser` only becomes seat-keyed in Task 6 Step 2. Measured today: every captured identity is in
  `o.models`. Its value is that omitting Step 5b's `raiserAlias` turns it **red**, which is exactly the
  regression it exists to catch. Listing it as RED-first (an earlier draft did) tells the implementer
  to paste failing output that does not exist. The harness already supports it —
  `fakeLaunchers(script, seen)` (`run-debate.test.js:33`) pushes `opts` for both launchers; only Task 3
  Step 2's `o.models` widening is needed.
- a unique bench produces byte-identical `debate.json`,
`rebuttal-*.md` / `revote-*.md` filenames, `revotesJson`, `debateRunStatsRows` output, and
`tally-input.json`; `debate.test.js:65-71` still passes unedited; and every `role:'rebuttal'|'revote'|
'superseded'|'repair'` runStats row's `model` is a member of `meta.models` **on a twin bench**
(a unique-bench version of that assertion is vacuous).

**Edits — `src/council/debate.js`:**

- [ ] Step 1 — `applyDebate` takes an additional **optional `aliasOf` FUNCTION** — the same one Step 4
      builds, not a second projection with a different shape — and matches on the seat when present:
      ```js
      const entry = adjudications.find(a => a.findingId === id && (a.seat || a.judge) === key);
      if (entry) { entry.verdict = rv.verdict; }
      else {
        const alias = aliasOf ? aliasOf(key) : key;
        adjudications.push({ findingId: id, judge: alias, verdict: rv.verdict, ...(alias !== key ? { seat: key } : {}) });
      }
      ```
      **Legacy parity:** no seats ⇒ `(a.seat || a.judge) === a.judge`, `alias === key` ⇒ the pushed row
      is `{findingId, judge, verdict}`, byte-identical to today.
      ⚠️ **`aliasOf` MUST be threaded into `applyDebate` — `run-debate.js:226-227` is its only call
      site** (this says nothing about the *other* places `aliasOf` must be threaded; see Step 5b).
      Add it to that object literal and to `applyDebate`'s destructure and JSDoc. Without it the
      else-branch writes a **seat id into the alias-space `judge` field**, which reaches `tally.js:96`
      (measured: `basis {a:1,d:0}` → tier **Confirmed**, where the alias spelling gives `Singleton`) and
      `report.js:40`. Test 4 above is what catches this; nothing in the current suite does.
      *(The first draft invented a `revoteAliasOf` OBJECT that no step ever built, and indexed it —
      `revoteAliasOf[key]` — while Step 4 built a FUNCTION. Either spelling yielded `undefined`, fell
      through to `|| key`, and produced exactly the corrupt row the parameter exists to prevent. **One
      projection, one shape, one name: `aliasOf`.**)*
      ⚠️ `debate.js:27-29`'s JSDoc already declares a `provisionalRecord` param the destructure does not
      take (pre-existing rot). Fix the JSDoc; **do not wire the parameter up.**
- [ ] Step 2 — `debateTargets`: key `byRaiser` on `f.raiserSeat || f.raiser`. Claude's findings have no
      `raiserSeat`, so its key stays the literal `'claude'` and `run-debate.js:178`'s
      `.filter(m => m !== 'claude')` and `:195`'s `byRaiser.claude` keep working unchanged.
      ⚠️ Leave `peerVerdicts`' `a.judge !== f.raiser` (`debate.js:154`) **alone** — it is a second copy
      of the #137 class and belongs to PR4 with `tally.js:96`. Say so in a comment.
- [ ] Step 3 — `disputingJudges` returns `adj.seat || adj.judge`, still `Set`-deduped (correct: dedup by
      seat, not by alias).

**Edits — `src/council/run-debate.js` + `src/council/run-debate-revote.js`:**

> ⚠️ **EVERY LINE NUMBER BELOW IS A MERGE-BASE (`ad8c83c`) NUMBER, AND TASK 1 INVALIDATES ALL OF THEM.**
> Task 1 removes ~79 lines from above every sink here (`legOpts` L24-31, `legRow` L33-48,
> `runRevoteWave` L101-155, the `emitStageStarted` require L22), so `runDefenseSolo`'s launch is no
> longer at `:59`, the stub no longer at `:93`, the `materializeDebate` literal no longer at `:185` —
> and `runRevoteWave`'s sinks are **in a different file entirely**.
> **Navigate by SYMBOL, and re-derive every line before editing:**
> ```bash
> grep -n "launchSolo\|launchWave\|legRow(\|model: raiser\|model: judge\|materializeDebate" \
>   src/council/run-debate.js src/council/run-debate-revote.js
> ```
> A bare `:NNN` in this task is a hint about *which* expression is meant, never a cursor position.

- [ ] Step 4 — build ONE projection in `runDebate` and pass it down. `seatById = new Map((ctx.o.seats
      || []).map(s => [s.id, s]))`; `aliasOf = (key) => { const s = seatById.get(key); return s ? s.alias : key; }`.
      **Legacy-parity condition, stated precisely:** `aliasOf` is the identity function for **any key
      that is not a known seat id** — which covers both a null `o.seats` (a direct-require caller) and
      the `'claude'` reserved key. On a unique-alias bench `s.alias === s.id`, so it is the identity
      there too. It is NOT "identity when `o.seats` is absent" — that phrasing hides the unique-bench
      case, which is the one every existing test exercises.
      **The `-rv` roster is seat OBJECTS, and Step 6 needs them:** `disputingJudges` returns seat *ids*,
      so build `judgeSeats = judgeKeys.map(k => seatById.get(k) || null)` and feed THAT (padded per
      §3.4) to `bindSeats`. The plan's first draft never said where the objects came from.
- [ ] Step 5 — **run-debate has FOUR model-carrying launch sites, not three** (§0.1's table; re-derive
      with `grep -n "launchSolo\|launchWave" src/council/run-debate.js`). Every one takes an ALIAS:
      `:59` defense solo · **`:78-79` defense REPAIR solo** · `run-debate-revote.js`'s
      `launchWave({models: judgeKeys.map(aliasOf)})` · the re-vote repair solo.
      ⚠️ A seat id in any of these is a **non-routable model name and a real paid failure**, not a test
      failure. Regression pin: `pickFallbackChair` still receives alias-space `o.models`
      (`run-chair.js:192`). Test 8 above is the structural guard.
- [ ] **Step 5b — THE RAISER BOUNDARY PROJECTION. This is the step whose absence made the first draft
      wrong in six places.** Step 2 makes `runDefenseSolo`'s 2nd parameter a **seat KEY**.
      ⚠️ **`aliasOf` is a `const` local to `runDebate` — it is NOT in scope inside `runDefenseSolo` or
      `runRevoteWave`, which are module-scope functions.** Under `'use strict'` a bare `aliasOf(...)`
      there is a `ReferenceError` on the first defense solo of every debate run. **Thread it
      explicitly**; spell the new signatures:
      ```js
      async function runDefenseSolo(ctx, raiserKey, findings, idx, aliasOf)   // called at run-debate.js:180
      async function runRevoteWave(ctx, judgeKeys, bundleFindings, judgeSeats, aliasOf)  // in run-debate-revote.js, called at :214
      ```
      Then in `runDefenseSolo` project **once**, as the first statement:
      ```js
      const raiserAlias = aliasOf(raiserKey);
      ```
      and use **`raiserAlias`** at the **six sinks inside that function**: the defense launch (`:59`),
      the repair launch (`:78-79`), both `legRow(...)` calls (`:88`, `:89`), the `stub` literal's
      `model` (`:93`), and the returned `leg.model` (`:95`).
      ⚠️ **The `materializeDebate` literal (`:185`) is NOT one of them — it lives in `runDebate`,
      where `raiserAlias` does not exist.** Write it there as
      `model: aliasOf(d.raiser)` (plus `seat: seatById.get(d.raiser) || null` per Step 8).
      **`raiserKey` survives in exactly three places:** the returned `{ raiser: raiserKey }`,
      `defenseByRaiser`'s key (`:188` — §3.3: this MUST stay seat-keyed), and the `seat` field Step 8
      adds for the filename.
      **Why:** `legRow`/`stub`/the returned leg all become `debateRunStatsRows` rows, whose `model`
      must be ALIAS on every bench (R3-1, §3.3, and `run-stage1-rows.js:23-27`'s identical ruling for
      the Stage-1 twins). Measured under the first draft: `runStats` carried
      `[{"model":"deepseek#1","role":"rebuttal"},{"model":"deepseek#1","role":"superseded"}]`.
      *(The persisted ledger is NOT corrupted by this — `joinsLedger` excludes those roles
      (`ledger.js:49`) — so do not justify it that way. What breaks is `tally.json` / `verdict.json` /
      `report.html`'s cost table, which R3-1 promises are alias-valued on every bench.)*
- [ ] Step 6 — R3-2: the `-rv` roster is now one entry per disputing **seat**, so a twin bench launches
      two legs where one launched before. Bind the returned legs with §3.4's padding pattern against
      the Step-4 seat-object roster and key `byJudge` on `seatKey(seat, alias)`.
      ⚠️ `debateSummary.revoteJudges = revoteLegs.length` (`run-debate.js:256`) therefore **increases**
      on a twin bench, and it is written to `run.json`. Disclose it in Task 7.
- [ ] Step 7 — repair id: `` `${waveId}-${sanitizeName(seatKey(seat, judge))}r` ``.
      ⚠️ **The trailing `r` is load-bearing** — it is what stops `bindSeats`' `/^(.*)-(\d+)$/` matching a
      repair id whose judge alias is a bare number (`r1-rv-2r` does not match; `r1-rv-2` would). A plan
      or implementation that drops it re-arms a collision. This also fixes the pre-existing slash bug
      (D4): `sanitizeName` maps `/[^a-zA-Z0-9._-]/g → '-'`, so
      `r1-rv-openrouter/deepseek/deepseek-chatr` stops nesting three directory levels.
- [ ] Step 8 — filenames (R3-3). `materializeDebate` (`run-launch.js:223-232`) takes plain
      `{model, summary}` literals, **not leg documents**, so PR2b's object-identity `seatOf` Map does not
      transfer. Add an optional `seat` field to the literals the two call sites build
      (`run-debate.js:185` rebuttal, the revote push) and inside `materializeDebate`:
      ```js
      const name = leg.seat ? artifactName(leg.seat, prefix) : `${prefix}-${sanitizeName(leg.model)}.md`;
      ```
      Update its JSDoc (`run-launch.js:215-222`) — it currently documents `<prefix>-<sanitizeName(model)>`.
      `run-launch.js` is 236/300, 64 lines of headroom.
- [ ] Step 9 — `revotesJson[].judge` (`run-debate.js:245`), `addendumOutcomes[].priorVerdicts`
      (`:268-269`) and `.revotes` (`:275`) must all be keyed **in the same space**. The addendum
      renderer iterates `Object.keys(revotes)` and looks up `prior[j]` (`briefings-debate.js:164`) — a
      space skew between them prints `no prior verdict` on **every** line. `priorVerdicts` is built from
      `f.adjudications`, so key it `a.seat || a.judge` to match.
      ⚠️ **`revotesJson` is written verbatim into `debate.json` (`run-debate.js:247-248`), and
      `debate.json` has a REAL consumer that joins on the alias:** `drillIntoJudge`
      (`electron/workspace-ui/workspace-panels.js:98-100`) matches `r.judge === judgePair.model`, where
      `judgePair.model` is the bench alias — and the comment at `:87-88` states that contract
      explicitly. On a twin bench that join silently fails after this step. **This is a code decision,
      not a stale-comment cleanup.** Either carry an alias alongside the seat key in `revotesJson`
      (`{ judge: aliasOf(key), seat: key, … }`, which keeps the existing join working and is consistent
      with everything else in this PR), or file it as a disclosed twin-bench Workspace regression for
      PR5. **Prefer the first** — it costs one expression and breaks nothing.
      ⚠️ **AMENDED against what shipped (`18dc0e9`). As written, this step was SELF-CONTRADICTORY
      on both of its halves.** Annotated in place rather than silently superseded, per this plan's
      own convention.
      1. **The sketch `{ judge: aliasOf(key), seat: key, … }` emits `seat` UNCONDITIONALLY** — on
         every row of every run, including a bench with no repeated alias, where `key` already
         *is* the alias. That contradicts this same task's GREEN criterion above ("a unique bench
         produces byte-identical `debate.json` … `revotesJson`"), and it is precisely the
         emit-when-SET form §3.3 rejects for `adjudications[].seat` two tasks earlier. **Shipped
         form is emit-when-DIFFERENT** (`run-debate.js:217`):
         ```js
         revotesJson.push({ judge: alias, ...(alias !== key ? { seat: key } : {}),
           id, verdict: rv.verdict, reason: rv.reason || null, applied: true });
         ```
      2. **The step demands `priorVerdicts` and `revotes` share ONE key space, then hands the
         implementer two.** It keys `priorVerdicts` `a.seat || a.judge` (seat space — correct)
         while its own sketch leaves `revotesJson[].judge` **alias**-valued. So the addendum's
         `revotes` map, which is built from `revotesJson`, must **not** be keyed on `r.judge`:
         two twins share one alias, `Object.fromEntries` is last-wins, and the pair collapses onto
         a single entry in alias space while `priorVerdicts` still holds two in seat space — which
         is exactly the skew this step exists to prevent, because `briefings-debate.js:164`
         iterates `Object.keys(revotes)` and `:167` prints `no prior verdict` on every key
         `prior` does not hold. **Shipped form keys it `r.seat || r.judge`**
         (`run-debate.js:252`), the same fallback pair `priorVerdicts` uses at `:246`.
      Net: both of the step's stated goals do hold in the shipped code — the Workspace's alias
      join keeps working *and* the addendum's two maps agree line for line — but via the
      `x.seat || x.judge` fallback pair on **both** sides, never via the literal sketch. Task 7
      discloses the resulting `debate.json` shape (alias-valued `judge`, additive `seat`).
- [ ] Step 10 — **THE INVARIANT (not a no-edit rule).** Every `model:` in a debate runStats row, and in
      every `materializeDebate` literal, must be **ALIAS-valued on every bench**.
      ⚠️ **"Do not touch these lines" is the WRONG instruction and was the first draft's worst error.**
      Step 2 changes the *space of the variable those literals read*, so holding the lines constant is
      precisely what converts them from alias to seat. Step 5b is the edit that preserves the invariant
      on the defense side (`raiserAlias` at the six in-function sinks, `aliasOf(d.raiser)` at
      `materializeDebate`).
      **The re-vote side needs the same treatment for `judge` — and after Task 1 those sinks are in
      `src/council/run-debate-revote.js`, NOT `run-debate.js`.** Navigate by symbol: inside
      `runRevoteWave`, both `legRow(judge, …)` calls (merge-base `:146`, `:147`) and the
      `legs.push({ model: judge, … })` literal (merge-base `:150`) must carry the **ALIAS**, while
      `byJudge`'s key (merge-base `:149`) carries the **seat key**. ⚠️ Those are two *different values*
      on the same loop iteration — that is the parallel-array discipline, not an inconsistency.
      `legs` also feeds `materializeDebate(…, 'revote')`, so each pushed leg additionally carries the
      `seat` field Step 8 needs for the filename.
      **`debateRunStatsRows` itself changes by ZERO lines** — it copies `l.model` verbatim, so fixing
      the callers is sufficient. **Do NOT add a `seat` key to any runStats row**: `tally.js`'s allowlist
      (`:115-133`) has no such key and would silently drop it, and `debate.test.js:99-102` is an exact
      `toEqual` that would fail. That field is PR4's.
      **Verify by execution, on a twin bench:** every `role:'rebuttal'|'revote'|'superseded'|'repair'`
      runStats row's `model` is a member of `meta.models`, and no value anywhere in `tally.json`'s
      runStats matches `/#/`.
- [ ] Step 11 — gates: `npx jest tests/council/run-debate.test.js tests/council/debate.test.js
      tests/council/run-cost-bijection.test.js --silent`, `npm run lint`, `npm run check:sizes`.
      Report `run-debate.js` and `run-debate-revote.js` line counts.

### Task 7 — CHANGELOG, docs, BACKLOG

- [ ] Step 1 — CHANGELOG. Three entries, each **re-verified against the source where it is written**,
      not inherited from this plan:
      1. Twin/duplicate benches get per-seat judge, rebuttal and revote artifacts and per-seat legs.
         **State the paid-leg change in FULL** — there are TWO, not one:
         * one **defense (rebuttal) solo per raising seat**, where it previously launched one per
           raising **alias** (`byRaiser` collapse, Task 6 Step 2) — plus that solo's own repair;
         * one **re-vote leg per disputing seat**, where it previously launched one per disputing
           **alias** (`disputingJudges` Set-dedup, Task 6 Step 6).
         So a twin pair costs **up to two extra billed legs** per round, plus repairs — not "one extra
         paid leg", which is what R3-2 and an earlier draft of this entry said. `run.json`'s
         `debate.revoteJudges` (`run-debate.js:256`) tracks only the re-vote half; **the defense half
         has no counter**, so the CHANGELOG is the only place a user learns about it.
      2. The fixed partial re-vote application (**D5 — live today**) and D4b's nested-session-dir bug
         for slash-bearing aliases (**live today, independent of duplicate benches**).
         ⚠️ **Do NOT claim D3 or D4's twin collisions were live** — they are latent, masked by D6
         (§1). Say they are *closed before they could fire*, or say nothing about them.
      3. ⚠️ **CORRECT `CHANGELOG.md:45-49`, do not extend it. The SHIPPED sentence is FALSE.**
         PR2b's unreleased entry says "only one of a twin bench's two review files appears in the
         Workspace list … this is a Workspace listing gap, not data loss." **Measured at `ad8c83c`,
         both halves are wrong:**
         ```
         artifactAllowlist({bench:['deepseek','deepseek','gemini']}) → ['review-deepseek.md', 'judge-deepseek.md', 'review-gemini.md', 'judge-gemini.md', …]
         actually written by materializeReviews          → ['review-deepseek-1.md','review-deepseek-2.md','review-gemini.md']
         on the allowlist?                               → [false, false, true]
         ```
         `uniqueModels = [...new Set(bench)]` (`artifact-guard.js:86`) de-duplicates the bench, so
         **NEITHER** twin file is allowlisted — not "only one". And the same list is the **read gate**:
         `readRunArtifact` (`artifact-guard.js:207`) returns `artifact not allowed` for both, while
         `run-detail.js:193,:225` lists a **phantom** `review-deepseek.md` marked `present:false`.
         So the accurate statement is: **the Workspace cannot open a twin bench's per-seat artifacts at
         all**, and shows a phantom entry instead. Files on disk are complete — no data loss — but it is
         a read refusal, not a listing gap.
         **Write the corrected sentence, covering all four families** (`review-`, `judge-`, `rebuttal-`,
         `revote-`), and note PR5 closes it.
         *(Sequence worth remembering: this plan's FIRST draft said "the Workspace cannot open them" and
         was right; round 1 of review told me that was wrong and pointed at the shipped CHANGELOG; round
         2 measured the code and found the CHANGELOG itself false. **A reviewer quoting a shipped
         document is not a reviewer measuring the code** — and a claim can survive a whole review round
         precisely because everyone is reading the same wrong sentence.)*
         The `~N` suffix (`artifact-guard.js:99-118`) fires only when two **DISTINCT** raw bench strings
         sanitize to one name; identical twins are collapsed by the `Set` first, so it never fires on a
         twin bench. Do not mention it as the mechanism.
      4. **The exit-code change** (Task 4 Step 7): a Stage-2 wave returning an unattributable leg now
         exits **2** where it previously exited 0 silently. Symmetric with PR2b's Stage-1 change
         (`CHANGELOG.md:30-32`).
      5. **`debate.json` key-space changes on a twin bench** (§3.3), byte-identical on every
         unique-alias bench: `findings[].raiser` becomes the raiser seat key, **and — unless Task 6
         Step 9 carries an alias alongside — `revotes[].judge` becomes the judge seat key**, along with
         the chair addendum's `priorVerdicts`/`revotes` keys that `briefings-debate.js:164-167` renders
         as prose. Whichever way Step 9 is resolved, say so here; do not disclose only `raiser`.
      ⚠️ **`tally-input.json` / `tally.json` / `verdict.json` do NOT change shape on a unique bench** —
      `seat` and `raiserSeat` are emit-when-DIFFERENT (§3.3). If an implementer used emit-when-set, that
      claim becomes false and this entry must change; check the code before writing it.
      ⚠️ **A user-facing claim must be re-verified against SOURCE where it is written, and
      cross-document agreement is NOT corroboration when both documents trace to the same unverified
      sentence.** A false CHANGELOG line survived a 6-lens refutation, an adjudication, a brief and a
      task review in PR2b for exactly that reason.
- [ ] Step 2 — `docs/council.md:216, 280, 284-285, 305-306, 340` and
      `skills/second-opinion/SKILL.md:531, 534` describe `judge-<model>.md` / `rebuttal-<model>.md` /
      `revote-<model>.md`. Re-derive those line numbers, then make them precise about seat vs alias.
      ⚠️ `skills/` is inside `tests/docs-plan-refs.test.js`'s SCANNED roots — **never leave a
      `docs/superpowers/plans/…` path in `src/`, `docs/` or `skills/`.** Citing the SPEC path is allowed.
- [ ] Step 3 — BACKLOG: file the PR4 carries — `tally.js:96`/`:58` seat-exactness (now unblocked, both
      sides carry a seat), `debate.js:154`'s `peerVerdicts` copy of the same defect, `meta.seats`, the
      R8 stamp, and **`src/workspace/matrix-model.js:47,:55,:74-80`, which is on nobody's deferral list**
      and performs the identical `meta.models × adjudications[].judge` join `report.js` does.
- [ ] Step 4 — fix these stale in-code citations (self-contained; re-derive each before editing):
      * `src/workspace/artifact-guard.js:25-26` cites `run-debate.js:119` / `run-debate.js:261` /
        `run-launch.js:127-136`. Actual: `run-debate.js:106` (the `revote-bundle.md` write),
        `run-debate.js:247-248` (the `debate.json` write), `run-launch.js:223-232`
        (`materializeDebate`). ⚠️ Task 1 moves `runRevoteWave`, so `revote-bundle.md`'s write **lands
        in `run-debate-revote.js`** — cite the new module, not a line in the old one.
      * `src/council/seats.js:44-46` cites `run-assemble.js:92-103` / `:170`. Actual: `:96-107` / `:174`.
      * If Task 6 Step 9 changes the key space of `revotesJson[].judge`, check whether
        `electron/workspace-ui/workspace-panels.js`'s comments still describe it correctly; correct or
        BACKLOG whatever it falsifies. Do not leave a source comment asserting something PR3 made false.
- [ ] Step 5 — `scripts/generate-docs.js --check`; regenerate CLAUDE.md AUTO markers if needed.

### Task 8 — Whole-branch review and gates

- [ ] Full `npm test`, `npm run lint`, `npm run check:sizes` — **paste real output, never `| tail`.**
- [ ] Report the suite delta against Task 0's measured baseline, and account for every added test.
- [ ] A whole-branch review by the most capable model. **Per-task reviews cannot see cross-task
      composition defects** — PR2a's slot-swap and PR2b's `roleAt`-collapse were both found only here.
- [ ] `git diff main <branch> -- src tests schemas` reviewed in full.
- [ ] Open the PR with the **`council-review`** label. **Do not push without owner approval.**

---

## 5. Standing constraints (violating any of these is a task failure)

| # | Constraint | Enforcement |
|---|---|---|
| C1 | A seat id must **never** reach a launch argument or a ledger row | `run-chair.js:61` launches `top.aliases[0]`; `ledger.js:68-70` joins on `r.model` |
| C2 | `data.seat` on degrade notes stays **ALIAS** | For `dead-leg`/`dead-wave` notes: `verdict.js:72,:87` compare it against `o.critic`, so a seat value makes `criticSeated` true for a dead critic. For the **`seat-unbound`** channel the reason is different — `deriveSeatLoss` never reads it (`verdict.js:68,:71` filter to those two channels only, per `CHANGELOG.md:37-44`) — so the binding reason there is consistency with `orphanLegNote`'s shipped shape (`stage1-bind.js:63`). **Do not state the `criticSeated` reason for a `seat-unbound` note; it is false.** |
| C3 | Only `src/council/run-degrade.js` may assign `degraded.value` | `tests/council/degrade-invariant.test.js` regex-walks all of `src/` |
| C4 | `src/`, `docs/`, `skills/` may cite the SPEC path, never a plan path | `tests/docs-plan-refs.test.js` |
| C5 | `no-unused-vars` and `no-console` are **errors**; `eslint --fix` cannot fix the first | `.eslintrc.js:13,16` |
| C6 | `run-stages.js` (292) and `run-retry.js` (290) take **zero-net-line** edits only | `npm run check:sizes`, `adjustedCount > 300` |
| C7 | `npx jest <path>`, never `npm test -- <path>`; never `\| tail` | `.husky/pre-push` trusts `.test-passed` |
| C8 | Worktrees are siblings (`../amicus-wt-*`) with junctioned `node_modules`; delete the junction **without** `-Recurse` | destroys the shared target otherwise |

## 6. Explicit non-goals — reject any diff that does these

`tally.js:96` · `tally.js:58` · `computeStreetCred` · the `tally.js` runStats allowlist ·
`sameModelCorroboration` · `meta.seats` · `meta.models` · `rankings[].judge` · `ledger.js` ·
`verdict.js` · `report.js` / `report-html.js` · `matrix-model.js` · `blind-mode.js` · `live-seats.js` ·
`workspace-panels.js` · `run-detail.js` · `artifact-guard.js` · the cost bijection · `findings.js`
(the spec's "zero lines" claim holds — confirm it, do not act on it) · `run-stages.js`'s `roleFor`
shim (`observe/council-legs.js:89` still needs it) · PR2b's open B1 ghost-review-file defect
(owner-ruled **PR5**; do not fix it here, and do not re-file it) · **the anonymize twin collapse**
(next paragraph).

⚠️ **THE ANONYMIZE TWIN COLLAPSE — a non-goal that WILL corrupt a careless twin fixture.**
`assignLabels` (`anonymize.js:20-34`) builds `labelMap['Review A'] = 'deepseek'` **and**
`labelMap['Review B'] = 'deepseek'` for twins, and `letterByModel` keeps **one key for two seats**
(last wins). `rankingToOrder` therefore returns an `order` naming an alias that occupies two seats, and
`rankPositions` (`tally.js:32-42`) collapses them with `pos.set(m, …)`. **PR3 does not fix this** —
spec §4.5 row 1 (`assignLabels` → seat ids, re-sorted by seat position) is PR4's.
**Consequence for every duplicate-bench fixture PR3 writes:** `rankings[].order` and anything derived
from it (`streetCred`, `perJudgeRank`) is garbage on a twin bench **before PR3 touches anything**. Do
not assert on those fields in a twin-bench test, and do not "fix" a twin fixture until its
`order`/`streetCred` expectations look right — you would be pinning PR4's job. Assert on
`adjudications`, `basis`, filenames, launch arguments and `byJudge` only.

## 7. Review instructions

- **Mutation-test every contract this PR freezes** — at minimum `bindSeats`' roster padding, the
  `(a.seat || a.judge)` merge key, and the `seatKey` fallback. PR1 proved two of its own brief's tests
  vacuous this way while the implementation was already correct. Reading is not enough.
- **The `.bak` mutation recipe has a multi-site hole**: a second apply overwrites the backup, restore
  silently leaves a mutation in the tree, and the suite goes GREEN. **Batch multi-site mutations into
  one apply, and re-grep every mutant string after restoring.**
- **State why code IS safe, never what would make it unsafe.** A defensive comment written as a
  dependency reads to reviewers as a live hazard — PR1 spent a council run on exactly that.
- If a doc, this plan, or a prior task report contradicts source, **source wins**; mark the doc STALE
  in the task report and say so loudly.
