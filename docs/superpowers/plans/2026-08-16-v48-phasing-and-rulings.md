# v4.8.0 — recon, rulings, and phasing (2026-08-16)

**Measured against `main` = `53cd689c`** (the [PR #164] merge), clean, no open PRs. Suite baseline
529 suites / 7472 passed / 8 skipped / 0 failed; size gate, lint, docs all exit 0.

This is a **scoping memo, not an implementation plan.** Plans in this project are written
just-in-time, immediately before the development they describe. What follows is the durable
measured substrate a plan can be written *from*, plus the owner rulings that fix the shape of the
work. Every claim below was established by execution — a run command, a probe against the real
module, or a verbatim quoted executing line — not by reading code and reasoning about it.

---

## 0. The headline

v4.8.0's own framing was three large issues attacking two baked-in assumptions. Eleven PRs went
into **one** of the three (seat identity). The scope conversation happened on 2026-08-16 and the
ruling is:

> **Task mode (#134 / #130) moves to v4.9.0, with #146 folded in. v4.8.0 ships the seat-identity
> remainder plus the cheap repairs.**

---

## 1. The 27 "open" seat-identity items are not 27 open items

The list at `BACKLOG.md:1898-2315` was treated as evidence to verify, not as scope. Verified
item-by-item, each verdict then independently re-measured by a second pass instructed to refute it.

**6 DONE · 3 PARTIAL · 1 SUPERSEDED · 1 HOLD · 16 OPEN.** SI-22 is a roll-up of five independent
shapes, so the true open work-item count is **20**, not 16.

> **These are the recon's counts at `53cd689c` and are not re-derived as work lands** — the table
> below is the live record; read a verdict there, not here. One change since: **SI-22.3 moved
> OPEN → PARTIAL** (T2.2, 2026-08-16, `33e2ecf7`), which makes it 4 PARTIAL / 15 OPEN and 19 open
> work items on the same counting rule.

| # | Verdict | Item | Current anchor (by symbol) |
|---|---|---|---|
| 01 | **DONE** | artifact allowlist from `o.seats` | `workspace/artifact-names.js :: artifactAllowlist` |
| 02 | OPEN → **v4.9** | `deriveSeatLoss` + renderers blind to `seat-unbound` | `verdict.js :: deriveSeatLoss` · `live-dead-seats.js :: deadSeats` · `workspace-seats.js :: retriedSeats` |
| 03 | PARTIAL → ruled | Stage-2 judge roster from `modelInput` | `run-stage2.js :: runStage2` |
| 04 | **DONE** | tally peer filter | `tally.js :: tally` |
| 05 | PARTIAL | `debate.js` second copy of the filter | `debate.js :: debateTargets` |
| 06 | OPEN | `computeStreetCred` peer split | `tally.js :: computeStreetCred` |
| 07 | **DONE** | R8 `sameModelCorroboration` stamp | `tally.js :: tally` |
| 08 | **DONE** | `meta.seats` in tally input | `run-assemble.js :: buildTallyInput` |
| 09 | **DONE** | `verdict.json` lacks `raiserSeat` | `verdict.js :: buildVerdict` |
| 10 | OPEN | `-rv` leg binds to no seat → invented row | `run-debate-revote.js :: runRevoteWave` → `debate.js :: applyDebate` |
| 11 | **DONE** | `matrix-model.js` alias join | `matrix-model.js :: buildMatrixModel` |
| 12 | OPEN | double-orphan conformance collapse | `run.js :: runCouncil` |
| 13 | OPEN → JSDoc | `applyDebate` writes seat id into `judge` | `debate.js :: applyDebate` |
| 14 | PARTIAL | nothing pins "launcher must not dedupe" | `tests/council/run-launch.test.js` |
| 15 | **SUPERSEDED** | seatKey + padding duplication | by PR5c-SEATKEY + SI-27 |
| 16 | OPEN → **v4.9** | function lengths | `runStage2` 161 · `runDebate` 165 · `runRevoteWave` 91 |
| 17 | OPEN → ruled | chair-on-bench, no engine guard | `seats.js :: preflightSeats` (absence) |
| 18 | OPEN | findings attributed by alias | `ledger.js :: buildLedgerRows` |
| 19 | OPEN | never-ran aggregate stays chair-promotable | `run-chair.js :: pickFallbackChair` |
| 20 | OPEN | street cred collapses twins ×3 | `tally.js :: rankPositions` · `:: computeStreetCred` · `ledger.js` |
| 21 | **HOLD** | lens/position unrecoverable | owner-deferred; its own prose is false (§3) |
| 22.1 | OPEN | raiser's own leg orphans | `tally.js :: tally` |
| 22.2 | OPEN | peer twin's leg orphans | `tally.js :: tally` |
| 22.3 | **PARTIAL** (T2.2, `33e2ecf7`) | ~~two orphaned twins → ONE dead row~~ producer fixed, N→N on both arms; the `run-retry.js` reconcile still under-counts a PARTIAL retry return | `run-stage1-rows.js :: pushDeadSeatRows` (done) · `run-retry.js :: retryStage1Losses`'s `launched` (open, needs an extraction) |
| 22.4 | OPEN | whitespace-padded preset member | `utils/config.js :: classifyCouncilMembers` |
| 22.5 | OPEN | orphaned Stage-2 judge rendered nowhere | `report.js :: toModel` · `matrix-model.js` · `report-html.js` |
| 23 | OPEN | `location` stripped on MCP tally path | `mcp-tools.js :: getTools` |
| 24 | OPEN | `VERDICTS[v.verdict]` inherited keys | `tally.js :: tally` **+ `:: computeStreetCred`** (unfiled second site) |
| 25 | OPEN | chair packet in alias space | `briefings-chair.js :: buildChairPacket` — three sites, three sizes |
| 26 | OPEN | `letterByModel` dead code | `anonymize.js :: assignLabels` |
| 27 | OPEN | roster-padding ×3 | `run-retry.js` · `run-stage2.js` · `run-debate-revote.js` |

**PR5x filings:** PR5a-1 **HOLD** · PR5b-1 OPEN→v4.9 · R4 OPEN→v4.9 · R5 OPEN→**v4.8** ·
DOMKEY **HOLD** · DURABLE OPEN→**v4.8 (T2.2)** · SEATKEY OPEN→split · STANDING **HOLD**.

---

## 2. Traps in the backlog itself — read before implementing anything

1. **SI-04 prescribes a fix that is measurably wrong.** It says to write
   `(v.seat || v.judge) !== (f.raiserSeat || f.raiser)`. Measured in both orphan directions this
   **re-arms #137** — it admits the raiser's own vote as its own peer. The shipped code took a
   different, correct form. **Delete that expression.**
2. **Two green tests assert the wrong behaviour as disclosed.** `tally.test.js:329` (T1) and
   `:341` (T2) pin exactly SI-22.1's and SI-22.2's outcomes (`basis {a:0,d:0,n:0}`, `Singleton`).
   The peer-split fix must **replace** them, not pass them. Writing it "keeping the suite green" is
   impossible. Pin the replacement with a **named mutant**, not a preservation test.
3. **Three source comments are false, and SI-08's DONE endorses them.**
   `run-assemble.js:190` and `tests/council/run-assemble.test.js:102` both claim "`position` is
   unrecoverable on every bench." Measured by executing `buildSeats` + `buildTallyInput`: on
   `['deepseek','deepseek','gpt']` every `meta.seats` element carries `position`, and on a lensed
   twin bench `lens` survives **verbatim**. Both facts are recoverable exactly when the bench
   repeats an alias. SI-21's own proposed correction is also wrong.
4. **Three filings, three different counts of the same duplication, all wrong.** SI-15 says 3;
   SI-27 enumerates 4 and misses 5; PR5c-SEATKEY says 3 + "a fourth". Measured: **9 object-form
   spellings, all in `src/`, zero in `electron/`**, plus 9 string-form post-emit reads (5 `src/`,
   4 `electron/`). ⚠️ Corrected 2026-08-16: **no filing ever said "nine"** — it is the two **TRUE**
   counts that both come to nine, over **disjoint sets**. Any number here
   needs its counting rule stated beside it.
5. **Citation rot is per-citation, not per-item.** SI-02's `live-seats.js:188` rotted to
   `live-dead-seats.js:144`, but `verdict.js:68/:71` did **not** — both still land exactly on the
   two filters. Treating the whole list as rotten throws away good anchors.
6. **PR5c's commit title misleads on SI-22.3.** `16fbad16` is titled "stop inferring seat identity
   in the consumer" and describes N-orphans-become-N-rows. It fixed the **consumer**; the runStats
   **producer** still collapsed. A reader arriving from the commit title will believe this closed.
   ✅ **The producer SHIPPED 2026-08-16 (T2.2, `33e2ecf7`)** — N orphaned twins now give N rows on
   both arms. Kept as a trap because the mis-dating hazard is unchanged, and because SI-22.3 is
   **PARTIAL**, not closed: see §3 and the table row above.

---

## 3. The durable finding, confirmed — and ✅ FIXED by T2.2

PR5c's ruling was containment: stop inferring, dedup only on exact identity, accept a visible
duplicate. The cure named was producer-side identity starting at `run-retry-group.js`'s
`recordFailure`. **That was confirmed by measurement.**

`recordFailure` wrote `const key = seatObj ? seatObj.id : seat`. Measured on
`['deepseek','deepseek','gpt']` with two **unbound** dead twin legs:
`models=["deepseek"], seats=[null], firstFailures.seatId=["deepseek"]` — **one retry slot for two
dead seats.** Controls: both bound → `models=["deepseek","deepseek"]`; unique alias → unaffected.
That is a spend-affecting producer defect. It paired with SI-22.3, where `pushDeadSeatRows`
collapsed two orphaned twins to one row on **both** arms. Fix either alone and the run's spend and
its record disagree.

✅ **BOTH SHIPPED TOGETHER 2026-08-16 — T2.2, `33e2ecf7`**, exactly as that last sentence required.
Re-measured on the same bench: `models=["deepseek","deepseek"]`, `seats=[null,null]` (neither
guessed) and two dead-seat rows, each carrying no seat; controls unmoved.

⚠️ **One sub-case remains, which is why the table above reads PARTIAL, not DONE.** `run-retry.js`'s
`launched` Map is `seatKey`-first-wins, a keyspace no first-attempt distinguisher can enter, so a
retry wave returning FEWER legs than it launched still gives 1 note and 1 row for two
unattributable twins (control, BOUND twins: 2 and 2), and both still-dead notes read slot 0's
`firstFailure`. The fix is a per-key slot count measured at **+7 lines**; `run-retry.js` has **5**
free and `run-retry-group.js` has **1**, so it is an extraction prerequisite, not a shave.
**BACKLOG.md's "The durable finding" section carries both measurements with their controls, the
budget, and one further stated invariant for whoever extracts that file.**

**R4 and R5 are NOT one job.** The instinct that both are producer-side seat identity was tested
and does not hold. Measured in both directions: with a keyed dead `deepseek#2` on the critic alias
and a live critic-role leg for `deepseek#1`, `deadSeats` returns `[]` **both with and without** a
`seat` field on the live row — the critic arm never reads `s.seat`. R5's payload change neither
fixes nor worsens R4, and R4's fix touches no file R5 touches. Further: **nothing in v4.8 can cure
R4** — its bench has no seat-identity critic answer (`criticSeat` is null there, `roleAt` calls
both twins 'critic') and it is unreachable by any run v4.8 creates.

---

## 4. Owner rulings (2026-08-16)

| # | Question | Ruling |
|---|---|---|
| R1 | Task mode scope | **→ v4.9.0**, with #146 folded in |
| R2 | What happens to a record whose seat cannot be identified | **Hybrid** — the producer mints a distinguisher (roster slot / leg id) where it has one; where it genuinely has nothing, mark explicitly, attribute nothing, announce on a channel |
| R3 | Orphaned Stage-2 judge vote (SI-22.5) | **Render as unattributed, keep it in basis** — three renderers move together, T22 pins edited deliberately |
| R4 | Chair-on-bench (SI-17) | **Normalise before the ledger join**, inside Phase 3 — works on all paths including the two hand-assembled `appendRun` ones a preflight guard cannot reach |
| R5 | SI-02 + R4 (Workspace dead-seat) | **Defer both to v4.9** — the `seatLoss` partial-return limitation carries |
| R6 | PR5b-1 two-document split | **Defer** — Phase 2 closes direction (ii) for free; the remainder needs a hand-edited `run.json` |
| R7 | R5 (live payload) | **Ship in v4.8** — measured independent, and it is the plumbing v4.9's Workspace phase needs |
| R8 | `-rv` join (SI-10) | **Refuse** a re-vote whose seat is unknown → SI-13 collapses to a JSDoc edit at `debate.js:44` |
| R9 | Stage-2 judge roster (SI-03) | **Per-SEAT is correct** — close the double-pay half as intent; R8's corroboration stamp exists to label exactly this |
| R10 | MCP tally schema (SI-23) | **Fix the closed z.object properly** — own PR, document-shape change; `evidence`/`file`/`line` stop dropping too |
| R11 | Function lengths (SI-16) | **Defer the splits** — SI-27 takes the useful slice |
| R12 | #135 TTFT (C2) | **Probe first** — log `firstSubstantiveAt`, read one real council run, then scope C2 |
| R13 | #133 | **Piece 1 only** — `opencodeSessionId`; the parser and the resolver both wait |
| R14 | Duplication | **SI-27 in v4.8, after Phase 2, home = `stage1-bind.js`**; seatKey cross-file consolidation → v4.9 |
| R15 | SI-25 chair packet | **Sites (1)+(2) now** as a small PR; site (3) rides Phase 3 |
| R16 | `sessions-index` leak | **Pin all 13 unpinned rails** |

---

## 5. The task list

### Phase 0 · Truth pass — 1 PR, doc-only
- **T0.1** Tick SI-01/04/07/08/09/11 · strike SI-15 · re-file R4 as hand-edit-only latent
- **T0.2** Delete SI-04's prescribed expression (§2.1)
- **T0.3** Correct the lens/position prose at `run-assemble.js:190`, `run-assemble.test.js:102`,
  SI-21, SI-08 (§2.3)
- **T0.4** Merge SI-15 + SI-27 + PR5c-SEATKEY into one filing **with its counting rule stated**
- **T0.5** Add "must **replace** `tally.test.js` T1/T2" to SI-22.1 and SI-22.2
- **T0.6** Commit the re-measured size-gate table

### Phase 1 · Extraction — 2 PRs, pure moves pinned by function identity
- **T1.1** `buildRunStatsEntry` out of `run-assemble.js` → **SHIPPED: 297 → 252 measured**
  (the 247 here was a projection; the 5-line gap is real and the measured value is the one Phases
  2–3 should plan against). `buildChairPacketFile` now opens at `run-assemble.js:223`.
  **Hard prereq of three things:** Phase 3's `rankings[]` seat, #135's TTFT field, carried PR1F-2
- **T1.2** Extract from `report.js` (**298/300**) — hard prereq of **T2.4**.
  ⚠️ Corrected 2026-08-16: this line and §6 previously also claimed SI-25. They were wrong —
  SI-25's sites are `briefings-chair.js :: buildChairPacket` (182 lines) and
  `run-assemble.js :: buildChairPacketFile`; `report.js` never carried a chair packet. T1.1 is
  what mechanically gated SI-25 site (1) (`run-assemble.js` was at 297/300); at 252 it is clear

> Use the PR5b shape: byte-for-byte move, re-exported so no caller changes, pinned by function
> **identity** (`toBe`) across import paths. That PR earned the sequence's only clean verdict.

### Phase 2 · Unidentified-seat identity — 4 PRs · ruling R2
- **T2.1** `run-retry-group.js:114` calls its own exported `seatKey` at `:51`.
  Hard prereq of T2.2 — two independent spellings in one file, and T2.2 changes that vocabulary
- **T2.2** Producer: `recordFailure` + `pushDeadSeatRows` key on roster slot / leg id.
  N orphans → N retry slots and N rows, **both arms**. MUST ship together.
  ⚠️ measure the interaction with `deriveSeatLoss`'s channel gates — SI-02 is deferred but the
  degrade notes `recordFailure` produces are what `deriveSeatLoss` reads
- **T2.3** Peer split: `tally.js` + `debate.js` in **one commit** — they already disagree today
  (measured: `debateTargets` returns 1 peer where `tally` counts 2, because `tally` has an outer
  `f.raiser ?` branch `debate.js` lacks; the comment at `debate.js:189-193` claiming "the SAME
  guard" is false). **Replaces** T1/T2
- **T2.4** Consumers: SI-12 refuses to join on an unidentifying key; SI-22.5 renders an
  **unattributed** column across all three renderers with the vote still in basis

### Phase 3 · Seat-keyed street cred + ledger — 1 large PR
- **T3.1** SI-26 (`letterByModel` delete) lands first or folds in — both edit `assignLabels`'
  return literal and JSDoc
- **T3.2** Seat onto `rankings[]` (`buildTallyInput:216`) + seat-ify
  `assignLabels`/`rankingToOrder` — schema change
- **T3.3** Fixed internal order: `rankPositions` → peer split → `perJudgeRank` →
  `computeStreetCred` driver → ledger. Includes SI-17 **normalise** (R4). Replaces
  `ledger.test.js` T12
- ⚠️ **`ledger.js:106` must ship in the same PR.** Measured: the two twin street-cred rows are
  byte-identical today, which makes that Map join a no-op. Seat-key `rankPositions` alone and they
  diverge — at which point the Map **silently drops one**, and the fix is strictly worse than the bug
- Closes SI-06, SI-18, SI-19, SI-20, SI-17. Unblocks SI-25 site (3)

### Phase 4 · R5 — 1 PR
Seat id on the live leg row: extend `writeLegPatch` in `fanout-leg.js :: runLeg` so `buildLegRow`
reads the seat off `metadata.json`, threading from `run-stage1-launch.js`'s `seated[].roster`; then
through `live-normalize.js :: seatOf`. Makes `live-dead-seats.js:207`'s `if (s.seat)` arm — today
permanently dead on the live path — actually live.

### Phase 5 · Debate join — 1 PR
SI-10 **refuse** a re-vote whose seat is unknown, and announce. SI-13 becomes a JSDoc edit.

### Phase 6 · Independents — ~6 PRs, each ships alone
SI-22.4 trim (+ the knock-on: trimming turns a padded preset into a REAL twin bench, so artifact
filenames change and `meta.seats` starts emitting) · SI-23 (own PR, R10) · SI-24 both sites
including the unfiled `computeStreetCred` **data-loss** site · SI-14 twin pin · T6.5 repair-row
seat · T6.6 `skills/` doc-fact gate · SI-25 sites (1)+(2) (R15)

> T6.6 is a live defect, not scaffolding: `tally.js` returns **Confirmed** for `(a=1, d=0)` while
> `skills/second-opinion/SKILL.md:299` and `COUNCIL-DESIGN.md:155` both define Singleton as `d=0`
> and `a<2`. `docs/council.md:662` is correct. **That stale line is what #130's author quoted.**

### Phase 7 · Repairs — ~7 PRs
- #135 **C0**: `DEFAULT_NO_OUTPUT_BACKSTOP_MS` 120000 → 300000, delete `council-review.yml:242`.
  Retires **CI's** knob exactly. Does **not** retire the owner's 900000 — that is 3× the new
  default and the only hard evidence is a kimi leg that died at 240s with zero output, reasoning
  and tool calls
- #135 **C5**: alias-shadow warning + OpenRouter-vs-direct notes
- #135 **C2 probe** (R12), then scope
- #133 **Piece 1** (R13): `opencodeSessionId` into both `runHeadless` returns + `legPatch`.
  4 lines, 2 files. `result-schema.js` promises this field and delivers `null` on **21/21** leg
  docs today
- #138 **Pieces 1+2**: the priced picker is unreachable for returning users; the GUI Finish handler
  lacks readline's clobber guard. Both are repairs to already-shipped v4.2 code
- Carried: leak fix across **all 13** unpinned rails (R16) · `mcp-server.js:684` one-liner ·
  `listCouncilRuns` dedupe (6 rows / 5 ids on real data)

### Post-Phase-2 · SI-27 — 1 PR
Padding/bindSeats/placeholder-filter core → `stage1-bind.js`, parameterised on
`(waveId, rosterSource, aliasAt, legs)`, returning both the filtered `seatOf` Map and the raw
`bindRes`. **The orphan tail differs at all three sites (push / degrade.note / nothing) and stays
at the call site.** Own PR — consolidation must not ride a defect PR.

**Roughly 24–28 PRs**, though Phase 6 and 7 are mostly small and several will combine.

---

## 6. Hard prerequisites vs preference ordering

**Genuinely gating (mechanical):**
- T1.1 → Phase 3 + #135 C2 + carried PR1F-2 (one extraction, three consumers)
- T1.2 → T2.4 (**not** SI-25 — corrected 2026-08-16; see the Phase 1 task list. SI-25's sites are
  in `briefings-chair.js` and `run-assemble.js`, never `report.js`. Its one mechanical gate was
  T1.1, which has shipped: `run-assemble.js` 297 → 252, and `briefings-chair.js` is 182 — both
  clear of the 300-line gate, so nothing now blocks SI-25 sites (1)+(2))
- T2.1 → T2.2
- R2's ruling → T2.2, T2.3, T2.4
- Phase 3's internal order, and `ledger.js:106` in the same PR
- Phase 3 → SI-25 site (3)
- SI-22.4 → SI-17's refuse branch (moot under R4's normalise ruling, but keep the edge recorded)
- #133 Piece 1 → any future log reading (timestamp-only correlation measured 1-in-3 ambiguous on a
  3-leg wave, i.e. it fails exactly in the fanout shape #133 actually was)
- R5 → any seat-keyed suppression on the live tick
- Phase 2 → PR5b-1 direction (ii), which it closes as a side effect

**Preference only:** Phase 3 vs Phase 4 order · everything within Phases 5, 6, 7.

---

## 7. Deferred to v4.9.0

Task mode (#134/#130) **+ #146** · the Workspace dead-seat surface (SI-02, R4, PR5b-1) · SI-16
splits · seatKey cross-file consolidation · #133 Pieces 2–3 · #138 Piece 3 · #135 C4 · carried
PR1F-2 *unification*, PR1F-3, the prune check, F-1, F-5, the CLI `list` merge, KNOWN_VARIABLES.

**Holds — not work, do not re-scope:** SI-21, PR5a-1, PR5c-DOMKEY, PR5c-STANDING.

### Why task mode moved

- **9–12 PRs**, ~44 source files, 5 schemas, 30–45 test files.
- **The surface map is not converged.** The design spec enumerates "the nine dispatch sites" and
  warns anything missing "produces a review run wearing a task label." Measurement found a **tenth
  and eleventh**: `briefings-debate.js :: buildDefenseBrief` opens *"You reviewed an artifact and
  raised the findings below"* and `buildRevoteBundle` opens *"You previously adjudicated findings
  on this artifact"* — same hard-coded review frame, no mode parameter, reachable because
  `nothingToDebate` gates on tier alone.
- **Nothing carries the deliverable.** The design says `overall` "is the seat's deliverable."
  Measured: one runtime read (`findings.js:188`), used as an emptiness gate, discarded.
  `validateFindings` returns `{ok, findings, errors}`. It reaches no durable artifact.
- **Two product rulings are unmade**: task+debate (fork or block), and where the answer lands.
- **#146 names a third hard-frame** the backlog never counted: `briefings-chair.js ::
  CHAIR_VERDICT_VALUES` is a closed literal parsed against `parse-stage2.js :: CHAIR_VERDICTS`. A
  TASK MODE header alone leaves a produce-analysis run's chair compelled to answer
  "Ship it | Fix these first | Fundamental rethink" about a piece of research.

### Extractions task mode will need (v4.9 prerequisites, not v4.8)
`run-chair.js` 294 · `run-stages.js` 292 · `mcp-council-run.js` 291 · `pack-resolve.js` **300/300**
(passes today; the first added line blocks the commit).

---

## 8. Issue-tracker state (2026-08-16)

**Ten open issues, not eight.** Beyond the eight the backlog knows: **#146** (2026-08-11) and
**#161** (2026-08-15, by jschairb — the only external reporter in the tracker). Neither appears in
`BACKLOG.md`. **Zero open PRs.** Not one of the ten has a comment; eight of ten have `updatedAt`
within four minutes of `createdAt`. The tracker had no maintenance during the entire v4.8 cycle,
which is the mechanism by which it and the backlog drifted apart.

- **#133 is majority-discharged** — the exact opencode pin and the version-aware doctor both
  shipped. Only fix 3 is scoped; fix 4 (a startup schema check) is scoped nowhere.
- **#129 is ~40% discharged** by v4.7.1.
- **#137's literal ask was satisfiable at v4.7.1** — `git show v4.7.1:src/council/run-stage1-launch.js`
  already composed the lens by position. The eleven PRs bought correctness and attributability, not
  the seating.
- **#130 and #134 are not one design.** #130's own scope note offers three end-states and asks only
  that the silent one die; five of its six suggested directions need no generative-brief support.
  Its ledger-skip half has a working one-line precedent at `run-finish.js:51`.
- **Triage inconsistency:** #134, #135 and #136 all close with the same "placeholder … for a
  brainstorming session" self-description. Only #136 was excluded.

---

## 9. Method note

Two workflows, 32 agents, ~5.3M tokens. Every item was verified by one agent and then independently
re-measured by a second instructed to refute it — because the recurring failure in this series is
*verification by assertion instead of verification by execution*, and because a false DONE silently
drops real work. The cross-check pass found **23 supersession/overlap relations** and **9
contradictions between verified items**, each resolved by measurement. Nine of those corrections
came from the refute pass overturning the first verdict, which is the argument for keeping the
adversarial stage on any future pass over this list.
