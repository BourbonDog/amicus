# v4.8 PR3 — scoping memo (decision required before the plan is written)

**Measured at `main` = `ad8c83c`.** 11-agent read-only recon; every behavioural claim below was
**executed** against the real modules, not reasoned. Reports in the session scratchpad
(`pr3-recon/r1…r11-*.md`); probe scripts alongside them.

---

## 0. OWNER RULINGS (Christian, 2026-08-13) — these are settled

- **R3-1 — Scope: option A, both halves.** Additive `seat` alongside the alias. `judge`, `raiser`,
  `meta.models`, `rankings[].judge`, runStats `model` and every ledger/report/street-cred value stay
  **alias, byte-for-byte, on every bench**. The raiser half is IN (so `debateTargets`, the defense
  solos and `rebuttal-*.md` are fixed too).
- **R3-2 — A twin bench launches ONE RE-VOTE LEG PER SEAT.** `disputingJudges` becomes seat-aware and
  `run-debate.js` projects seat → alias for the launcher. This buys one extra **paid** leg per twin
  pair and is CHANGELOG-worthy.
- **R3-3 — Widen the artifact-name skew and disclose it.** All three families
  (`judge-`/`rebuttal-`/`revote-`) move to `artifactName(seat, kind)` in PR3, and PR2b's existing
  CHANGELOG Known Limitation is extended to name them. PR5 closes all five families at once.
- **R3-4 — Extract `runRevoteWave` into its own module** as a pure, proven-byte-identical Task 1
  (not a `debate-bind.js` helper). `run-debate.js` is 283/300.

## 1. What the owner named as PR3

> run-stage2.js's judge roster and `judge-<name>.md` filenames, the judge binding, run-debate.js's
> byJudge/twin-collision defects, and debate.js's re-vote merge — plus `describe('runStage2')` in
> tests/council/run-stages.test.js and its 34 leg builders. Everything else stays PR4/PR5.

## 2. The finding that reshapes it

**`judgeResults[].judge` is not a local variable. It is the head of a five-way fan-out**, and two of
the five branches are **launch arguments**:

```
run-stage2.js:82   const judge = leg.modelInput || leg.model
   → judgeResults[].judge
      → run-assemble.js:163  adjudications[].judge
      → run-assemble.js:164  rankings[].judge
      → run-assemble.js:186  judge runStats row .model
         → tally.js:96   v.judge !== f.raiser          (peer filter — the #137 site)
         → tally.js:58   judge !== m                   (street-cred peer filter)
         → report.js:40  byJudge[adj.judge]            (matrix cells)
         → debate.js:60  a.judge === judge             (re-vote merge — owner's scope)
         → debate.js:139 disputingJudges → judges.add(adj.judge)
            → run-debate.js:203 → run-debate.js:116
               launchWave({ models: judges })          ⚠️ LAUNCH ARGUMENT
```

and symmetrically on the raiser side:

```
run.js:189  toGlobalFindings(letter, r.model, …) → finding.raiser
   → tally.js:96   the other half of the peer filter
   → ledger.js:71  findings.filter(f => f.raiser === model)   (model ∈ meta.models)
   → debate.js:155 byRaiser[f.raiser]
      → run-debate.js:178 raisers → run-debate.js:59
         launchSolo({ model: raiser })                 ⚠️ LAUNCH ARGUMENT
```

The spec's §4.7 invariant ("a seat id must never appear in a ledger row… `pickFallbackChair`
**launches** `top.aliases[0]`") names exactly **one** launcher. **There are three more**, all inside
`run-debate.js` (`:59`, `:116`, `:136`), all fed by values §4.5 asks PR3 to move into seat space.
Executed proof:

```
debateTargets  byRaiser keys (→ launchSolo model:) = [ 'deepseek#1' ]
disputingJudges           (→ launchWave models:)   = [ 'deepseek#2' ]
```

Neither is routable.

## 3. Why a half-flip is a regression, not merely an incomplete fix

Every surface below is **byte-identical for any bench with no repeated alias** (`buildSeats`
sets `id = alias` when the alias is unique — `seats.js:67`). The divergence is duplicate-bench only.
But a duplicate bench **is reachable at HEAD** — `preflightSeats` rejects five ways and
`--models deepseek,deepseek` trips none of them.

| surface | today (all alias) | judge→seat, raiser stays alias | measured by |
|---|---|---|---|
| `tally.js:96` basis | `{a:0,d:0}` false **Singleton** | `{a:2,d:0}` false **Confirmed** — counts the raiser's **own** vote | R5 probe |
| `tally.js:58` `peersOnly` | 2 | 1.5 — self-rank no longer excluded | R5 probe |
| `ledger.js:71` `findingsRaised` | double-counted | **0 on every row** (`f.raiser` no longer matches `meta.models`) | R11 probe |
| `report.js` matrix | one twin's vote renders | **both twin columns blank** | R5 + R11 probes |
| `computeStreetCred` w/ seat `order` | populated | `withSelf: null, peersOnly: null` for **every** seat | R11 probe |

`confirmRate` (`ledger.js:83`) and `streetCredPeersOnly` (`:80`) are appended to an **append-only**
JSONL and averaged for life by `deriveReliability` — and `peersOnly` is the sort key
`pickFallbackChair` uses to decide **which model to launch**. A half-flip poisons that permanently.

And `applyDebate`'s miss branch **fails open**:

```js
// debate.js:60-62
const entry = adjudications.find(a => a.findingId === id && a.judge === judge);
if (entry) { entry.verdict = rv.verdict; }
else { adjudications.push({ findingId: id, judge, verdict: rv.verdict }); }
```

A space mismatch does not throw — it **invents an adjudication row**. Measured: a 3-seat bench
produced **5** adjudications on one finding, tier moved, no diagnostic.

## 4. Two live bugs on `main` today that PR3 can fix (neither is in the spec)

1. **`applyDebate`'s `.find()` is first-wins.** With two twin `{A1, judge:'deepseek'}` rows and one
   re-vote, only the FIRST flips; the second twin's stale `dispute` survives. Measured: `A1` moved
   `Disputed → Contested` on a **partially applied** re-vote. Silent.
2. **`disputingJudges` Set-dedups aliases**, so two disputing twin seats buy **one** re-vote leg.
   The second seat's verdict can never be updated. (Fixing this means a twin bench launches **two**
   legs where one launched before — a real cost/behaviour change.)

## 5. Corrections to the spec that change the work

| spec claim | measured at `ad8c83c` |
|---|---|
| §4.5 `tally.js:96` "→ seat identity + the R8 stamp" | **The peer filter needs ZERO edits.** Once `raiser` and `judge` are both seat ids, `v.judge !== f.raiser` *is* seat-exact. Only `sameModelCorroboration` is a `tally.js` edit |
| §4.5 `verdict.js` critic tests → `criticSeat` equality | **NO-OP.** `criticSeat === critic` is invariant (`preflightSeats` rejects an ambiguous critic; a unique alias has `id === alias`) |
| §4.8 "Key the bijection on `legId`. **The row carries it**" | **FALSE both halves.** `buildRunStatsEntry` emits no `legId`; the test's ground truth reads `leg.modelInput \|\| leg.model`, not `leg.legId \|\| leg.taskId` |
| §4.5 `run-launch.js:217` rebuttal/revote = `sanitizeName(modelInput)` | It is `sanitizeName(leg.model)` at `:227`, and the objects reaching it carry no `legId`/`taskId`/`modelInput` — PR3 must bind one level up |
| §4.4 `run-retry.js` nine joins / `run-stages.js:267-270` `deadAliases` | **DONE in PR2b.** `deadAliases` no longer exists anywhere in `src/` |
| §4.4 `fake-launchers.js:13` taskId fix | **DONE in PR0** — but `run-debate.test.js` has its **own** `leg()` helper (`:39-42`) that PR0 never touched |
| §4.5 `live-model.js:216-220` | File was split in PR0; the dedup is `electron/workspace-ui/live-seats.js:178-179` |
| line numbers generally | 7 of 27 rows exact, 13 MOVED, 6 STALE/FALSE. `run-stages.js:112` → `:153` (+41) |

## 6. THE FOUR OPTIONS

### A — Additive seat, zero space migration  ★ recommended

Keep every existing field in **alias** space, byte-for-byte. Carry the seat **alongside** it.

- `judgeResults[]` gains `seat` (the seat object) — `judge` unchanged.
- `run-assemble.js:163` emits `...(j.seat ? { seat: j.seat.id } : {})` on each adjudication;
  `judge` unchanged.
- `tally.js:89` passes `seat` through (**one additive line**); `tally.js:105` likewise if the raiser
  half is included. *(Schema-legal: `additionalProperties:false` at `council-tally.schema.json:62`
  is scoped to the `debate` sub-object only — verified.)*
- `debate.js:60` prefers `a.seat === seatId`, falls back to `a.judge === judge`.
- `disputingJudges` returns seat ids; `run-debate.js` maps `seat → alias` for the two launchers.
- `byJudge` keyed on `seat.id`; `judge-`/`rebuttal-`/`revote-` filenames via `artifactName(seat, …)`;
  repair id `${waveId}-${sanitizeName(seat.id)}r`.

**Fixes:** all four things the owner named, plus both live bugs in §4, plus `run.js:212`'s conformance
merge, plus the pre-existing slash bug in the repair waveId.
**Regressions:** none. Every wire value (`meta.models`, `adjudications[].judge`, `rankings[].judge`,
`f.raiser`, runStats `model`, ledger rows, report matrix, street-cred) is untouched **on every bench,
duplicate or not**.
**Leaves for PR4:** #137's tally fix (still a false Singleton on a twin bench — *unimproved, not
worse*), the R8 stamp, `meta.seats`, the ledger grouping.
**Cost:** 1–2 additive lines in `tally.js` — a file the owner deferred. It is a passthrough, not a
semantic change.

### B — Full space migration (spec's PR3 + most of PR4)

Flip `judge`, `rankings`, `raiser`, `meta.models` together, add `meta.seats`, and absorb §4.7's
seat→alias ledger projection so `pickFallbackChair` still gets routable names.
**Fixes:** everything in A **plus** #137's tally fix and street-cred.
**Cost:** pulls PR4's ledger work forward; `tests/council/run-assemble.test.js:43-48` is an exact
`toEqual` on all six `meta` keys and re-baselines; touches 6 forbidden files. Largest PR of the train.

### C — Filenames + ids only (strictly smaller than the owner's words)

`judge-`/`rebuttal-`/`revote-` names, the repair id, `run.js:212`'s judge map. No identity moves.
**Drops** `byJudge` and the `debate.js` re-vote merge — two of the four things the owner named — and
leaves both live bugs in §4 unfixed.

### D — Split: PR3 = A, PR3b = the raiser/defense half

A, minus the `f.raiser`/`debateTargets`/defense-solo half (twins keep sharing one defense solo —
unimproved, not worse). Smallest coherent PR that still delivers everything the owner named.

---

## 7. Three sub-rulings needed whichever option is picked

1. **Does a twin bench launch TWO re-vote legs?** Making `disputingJudges` seat-aware means
   `launchWave({models:['deepseek','deepseek']})` — one extra **paid** leg per twin pair. It is the
   correct behaviour (each seat re-votes its own dispute) but it is a cost change.
2. **`artifact-guard.js` skew.** PR2b already shipped `review-<seat>.md` while the Workspace allowlist
   still builds `review-<alias>.md` + a `~N` collision suffix — disclosed as a Known Limitation with
   PR5 as the hard prereq. Flipping `judge-`/`rebuttal-`/`revote-` **widens that same disclosed skew**
   by three more filename families. Widen-and-disclose, or defer the debate filenames to PR5 with the
   rest?
3. **`run-debate.js` is 283/300 — 17 lines.** The seat roster, the alias projection at two launchers
   and the bind will not fit. The repo's blessed precedent is `stage1-bind.js` (a 60-line module PR2b
   created for exactly this reason). Is a `debate-bind.js` sibling in scope as PR3 Task 1?

## 8. Prerequisites every option shares (measured)

- **`run-stages.js:263` must add `seat: m.seat`.** `materializeReviews` already resolves and returns
  the seat (`run-launch.js:206`, `:210`); `runStage1` consumes it for `role` and **drops it**. Without
  it there is no seat to bind anywhere downstream. `run-stages.js` is **292/300** — the one-line add
  lands at 293. Any prose in the same file does not fit.
- **`tests/council/run-debate.test.js`'s local `leg()` (`:39-42`) emits `taskId: '${model}-t'`** — a
  leg document real fanout cannot produce. Measured against a twin roster: `bound: []`, 2 orphans.
  26 of 28 call sites omit `waveId` entirely. PR0 fixed the **shared** helper; this local one was
  never touched. Hard prerequisite for any `bindSeats` call in `run-debate.js`.
- **`ctxFor` (`run-debate.test.js:47-57`) supplies no `o.seats`, no `o.models`, no `ctx.degrade`.**
  ~40 direct-`runDebate` tests would go green for the wrong reason (or throw on `ctx.degrade.note`).
- **`describe('runStage2')` is `tests/council/run-stages.test.js:1170-1475`** — **not** `:780-1084`.
  13 tests, **34 `mkLeg(` + 1 `deadLeg(`**; 2 of the 34 are review-row `.leg` values, not wave legs.
  **10 of the 12 `onWave:` callbacks take no `opts` parameter** and must be widened.
  `makeCtx` (`:59-100`) IS already seat-aware (PR2a); `stage1Reviews()` (`:1171-1180`) is not.
- **`src/workspace/matrix-model.js` is on nobody's deferral list** and performs the identical
  `meta.models × adjudications[].judge` join `report.js` does (`:47`, `:55`, `:74-80`). Whichever PR
  moves `meta.models` must move it too.
