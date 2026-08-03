# SL-2 — Stage-1 once-only retry ("a lost seat gets one more chance") — design

**Date:** 2026-08-03 · **Status:** approved in session (Christian) · **Provenance:** BACKLOG.md
SL-2, pulled forward by the SL-3 heal-first ruling (Christian, 2026-08-03, recorded in
BACKLOG.md and commit `c08e575`). First live council use of the v4.6 `kind:'heal'` vocabulary
(D7 anticipated exactly this emitter).

**One sentence:** when a Stage-1 sub-wave dies before its legs exist, or a Stage-1 leg ends
with no usable output, the run relaunches it exactly once — serially, after the surviving
launches settle — announcing a heal on recovery and the ordinary degrade only if the retry
also dies.

---

## §1 Why (and why now)

The engine is not losing legs at the infra layer anymore (11 four-seat runs on v4.5.4:
10 clean), but when a seat *is* lost the run today records it permanently dead on the first
failure. The SL-3 question — may an explicitly requested critic degrade at all — was ruled
**heal-first**: build the retry, collect post-retry frequency data, then re-decide SL-3.
A retry is the north-star move (self-heal beats self-diagnose beats crash), and v4.6 built
the exact vocabulary it needs: heal records that announce in the one voice without flipping
the exit code.

## §2 Rulings taken in the brainstorm (owner, 2026-08-03)

| # | Ruling |
|---|---|
| **D1** | **Scope: dead waves AND dead legs.** A dead leg (leg ran, ended `error`/`timeout`, no usable output) retries too — it is the only loss class actually observed in the baseline, and covering it is what makes the SL-3 frequency data move. Worst case re-pays one leg per dead seat. |
| **D2** | **Unconditional — no knob.** No new flag or env var. Bounded to once per seat, gated on the run's budget position, announced in the one voice. Accepted consequence: a timeout leg whose retry also times out adds up to one full leg window of wall-clock. |
| **D3** | **Shape: extracted module** `src/council/run-retry.js` at one seam in `runStage1` — the house pattern (run-degrade / run-budget / run-launch precedents), unit-testable in isolation. |

Design-level decisions (mine, veto by editing this doc):

| # | Decision |
|---|---|
| **D4** | **Heals are per SEAT** — symmetric with the per-seat `dead-leg` voice. A recovered 3-seat wave prints three `Recovered:` lines. Recovery is rare; per-seat symmetry beats compactness. |
| **D5** | **Post-retry degrades attribute at the granularity of the FINAL failure.** Retry wave died wholesale → one wave-level `dead-wave` degrade (enriched why). Retry wave produced legs but some died → per-seat `dead-leg` degrades (why names both attempts). |
| **D6** | **The rare double-announce is accepted.** If the `--max-cost` ceiling refuses the retry wave's *reservation*, a truthful `budget-refusal` record fires for the retry wave alongside the seat's dead-seat degrade. Both records are true; the case needs a nearly-exhausted ceiling plus a death. Documented, not suppressed. |
| **D7** | **A skipped retry is not a record.** When `overBudget()` pre-gates the retry away, the ordinary degrade fires unchanged — the seat's loss is already announced; "we did not retry" is not a second loss. |

## §3 Measured reality (verified against `main` @ `c08e575`)

- Stage-1 launches all sub-waves under one `Promise.all` — bench wave `<runId>-s1` via
  `launchers.launchWave`, critic solo `<runId>-c1` and lens solos `<runId>-l<i>` via
  `launchers.launchSolo` (`src/council/run-stages.js:31-80`). Every waveId is recorded via
  `runState.appendStageWave` **before** launch so `amicus abort` cascades reach it (`:51`).
- Loss collection: `deadWaves` = waves that produced no legs, excluding aborts and
  `BUDGET_EXCEEDED` (`run-stages.js:85-107`); `deadLegs` = legs not materialized
  (`:147-149`). Degrade notes fire immediately after collection: `dead-wave` loop
  (`:136-145`), `dead-leg` loop (`:151-160`).
- The sink flips `degraded.value` on every `kind:'degrade'` record and **never un-flips**
  (`src/council/run-degrade.js:38`); heals never flip. Every note checkpoints `degrades[]`
  into run.json (`:36`).
- The voice already renders heals: `formatDegrade` leads with `Recovered:` for
  `kind:'heal'` (`src/utils/degrade.js:62-66`). `makeDegrade` validates channel membership
  against the frozen `DEGRADE_CHANNELS` set (`:14-22`, `:32-34`).
- Budget: `reserveBudget(waveId, estimate)` is a synchronous read-and-claim keyed by
  waveId; `addWave` releases the claim and counts measured legs in one step
  (`src/council/run-budget.js:101-135`). `overBudget()` trips on KNOWN spend only (`:77`).
  A dead wave still writes its wave doc (v4.4.1 NEW-2), so its reservation is released
  through the normal `addWave` path before any retry launches.
- `runFanout` already accepts `retryOfWaveId` and threads it onto legs and spend-ledger
  rows (`src/sidecar/fanout.js:44,256,263`; `src/utils/spend-ledger.js:60-91`) — built for
  v4.3's `--retry-failed`. It also suppresses fanout's own stdout doc-print when set
  (`fanout.js:75`), which for an in-council launch is already the desired behavior.
- The report's "What was lost" section already filters heals (v4.6 Plan 2); `seatLoss` is
  derived from the sink's records (`src/council/verdict.js:51-75`, `run-assemble.js:198-204`).

## §4 The retry flow

New module **`src/council/run-retry.js`**, exporting `retryStage1Losses(ctx, losses)`.
Seam in `runStage1` (`run-stages.js`), replacing the immediate degrade-noting:

1. `launchStage1` returns `{aborted, legs, deadWaves}` — unchanged. Abort still returns
   early; no retry on an aborted run.
2. Materialize once; compute `deadLegs` — unchanged predicate.
3. **`retryStage1Losses(ctx, { deadWaves, deadLegs })`**:
   - Group the losses: dead bench seats (from a dead bench wave OR dead bench legs) →
     one retry wave `<runId>-s1r1` with `buildSeatBriefing`; dead critic → solo
     `<runId>-c1r1` with `buildCriticBriefing`; dead lens *i* → solo `<runId>-l<i>r1`
     with its lens briefing. (A dead bench wave and dead bench legs cannot coexist for
     the same wave; the group union is still one retry wave.)
   - Launch retries **sequentially** in stable order (bench, critic, lenses ascending).
     Before each: if `ctx.overBudget()` → skip that retry (D7).
   - Each retry: `appendStageWave(runDir, 'stage1', retryWaveId)` **before** launch;
     launch through the same `ctx.launchers` with `retryOfWaveId: <deadWaveId>` in the
     options (one passthrough line added in `run-launch.js`).
   - An abort exit from a retry propagates: return `{aborted}` immediately, matching
     `launchStage1`'s posture — no degrade-noting on an aborted run.
   - For each retried seat that produced a usable leg — "usable" is the same
     `materializeReviews` predicate that defines a live seat today, no new definition —
     emit a **heal** through `ctx.degrade.note` (per D4) and merge the leg into the
     returned leg set.
   - Return `{aborted: null, legs: merged, stillDeadWaves, stillDeadLegs}` with each
     still-dead entry carrying both attempts' failure facts for the enriched why.
4. `runStage1` notes degrades **only for the still-dead sets** (D5 granularity), then
   re-materializes reviews over the merged legs (idempotent re-write plus the recovered
   seats) and proceeds to validation/repair/quorum exactly as today. Recovered seats count
   toward quorum by construction — the quorum gate runs downstream of the merge.

**No retry of a retry.** The retry pass consumes loss sets produced by the first attempt
only; its own losses go straight to degrades.

## §5 The records (exact voice)

Heal, channel **`stage1-retry`**, `kind:'heal'`, per recovered seat:

- **what:** `seat <model> reviewed on retry`
- **why (leg-death):** `its first leg ended '<status>' with no usable output and was relaunched once`
- **why (wave-death):** `its first wave <waveId> produced no legs (<reason>) and was relaunched once`
- **effect:** `The seat is in this council; nothing was lost`
- **data:** `{ seat, retryWaveId, retryOfWaveId, firstFailure: {class: 'wave'|'leg', status?, reason?} }`

Renders as: `Recovered: seat gpt reviewed on retry — its first leg ended 'error' with no
usable output and was relaunched once. The seat is in this council; nothing was lost.`

Still-dead degrades keep today's channels and shapes, with the why enriched. All four
attempt-class combinations, explicitly:

- leg → retry leg died: `dead-leg` why gains `` ; its once-only retry also ended '<status>' ``
- wave → retry wave died wholesale: `dead-wave` why gains `` ; the once-only retry wave also produced no legs ``
- wave → retry produced legs, this seat's died: **`dead-leg`** (D5 final-failure
  granularity) with why: `` its first wave <waveId> produced no legs (<reason>); its once-only retry leg ended '<status>' with no usable output ``
- leg → retry wave died wholesale (bench batch case): `dead-leg` why gains
  `` ; its once-only retry wave produced no legs ``
- A skipped retry (D7) leaves today's texts byte-unchanged.

**Fifth family (amendment — added by the Task-4 fix wave, after this section was first
written, to close the partial-return vanish class):** a launched seat can come back with NO
leg record at all, distinct from a leg record that came back unusable — a retry unit's
response that only partially reconciles against its own launched-seat set (e.g. a bench unit
retries `[a, b]` and the response contains a leg for `a` only). Always **`dead-leg`**
(never `dead-wave`, regardless of whether the seat's original loss was wave- or leg-class),
via `missingLegStillDeadNote` (`src/council/run-retry-notes.js`): why is the same origin fact
the other four combinations use (wave-origin or leg-origin) with `` ; its once-only retry
produced no leg for this seat `` appended, and **`data.status`/`data.reason` are both
`null`** — there is no retry-attempt status to name, only the absence of one, for both
origins. `deriveSeatLoss` (`src/council/verdict.js`) is this family's verdict-surface
rendering: its null-status fallback renders `'the critic leg produced no usable output'` in
place of the pre-fix literal string `"ended 'null'"`.

**Vocabulary ripple (corrected at plan time):** add `'stage1-retry'` to `DEGRADE_CHANNELS`
(`src/utils/degrade.js`) only. The three schema copies type `channel` as a free string —
re-measured 2026-08-03 — so no schema edit is needed and
`tests/schemas-degrades-lockstep.test.js` is untouched.

**seatLoss invariant:** heal records never contribute to `seatLoss` derivation — **a healed
critic counts as seated** (`criticSeated: true`). This is the pin that makes the SL-3
re-decision data trustworthy. Verify `deriveSeatLoss` matches on the dead channels (not
"any record"), and pin it either way.

## §6 Budget

- Pre-gate: `ctx.overBudget()` before each retry launch — the repair-path precedent
  (`run-stages.js` module docblock).
- Under the gate, the retry's fresh waveId rides the normal `reserveBudget`/`addWave`
  cycle. **No double-reserve by construction:** the dead wave's claim was released when its
  (NEW-2-guaranteed) wave doc passed through `addWave`, and the retry claims only its own
  new waveId. Pinned by test.
- D6's accepted double-announce documented in §2.

## §7 Out of scope

- **Stage-2 judge waves, the chair, debate legs.** The chair has its own fallback chain
  (`chair-failed` channel); judge losses degrade via `thin-cross-review`. SL-2 is filed
  for Stage 1 and stays there.
- **SL-1** (stagger fallback-path launches) — separate backlog item, unchanged.
- **FR-3** (createSession lock-race retry) — distinct item; note SL-2 softens its
  *consequence* (a wave killed by that race now gets one relaunch) without touching its
  cause. Any future FR-3 fix still reuses `isRetryableStartFailure`.
- **SL-3 itself** — re-decided later with the frequency data this feature produces.
- **Fanout CLI surface** — `fanout --retry-failed` (manual, v4.3) is untouched.

## §8 Success criteria

1. A dead Stage-1 wave or leg is relaunched exactly once, serially, after the surviving
   launches settle; retries never launch on an aborted run.
2. A recovered seat produces: one `stage1-retry` heal record (stderr `Recovered:` line,
   `run.json`/`verdict.json` `degrades[]`), **no** degrade record, `degraded.value` still
   `false` (exit 0 absent other degrades), and a review that counts toward quorum.
3. A seat still dead after its retry produces exactly **one** dead-seat degrade
   (`dead-wave`/`dead-leg`, D5 granularity, enriched why naming both attempts) and the run
   exits degraded (2) as today. (D6's corner is the sole exception: a ceiling-refused retry
   reservation may add a truthful `budget-refusal` record beside it.)
4. A healed critic yields `seatLoss.criticSeated === true`; heal records never flip any
   seatLoss field.
5. The retry claims only its own fresh waveId reservation — no double-reserve (pinned).
6. Retry legs and their spend-ledger rows carry `retryOfWaveId`; retry waveIds are in
   `stages[].waveIds` before launch (abort- and watch-reachable).
7. `overBudget()` pre-gate: no retry attempted when over; the ordinary degrade fires with
   today's text byte-unchanged.
8. An abort exit during a retry propagates as abort — no degrade-noting.
9. No new flag or env knob; identical behavior on CLI and MCP transports (engine-level).
10. `'stage1-retry'` present in DEGRADE_CHANNELS; the lockstep test passes unmodified.

## §9 Testing

- **Unit — `tests/council/run-retry.test.js`:** grouping (bench batch, solos separate);
  briefing selection per role; sequential launch order; `appendStageWave` before launch;
  `retryOfWaveId` threading; heal emission per recovered seat; still-dead passthrough with
  both attempts' facts; `overBudget` skip; abort propagation.
- **Integration — through `runStage1`:** recovered → heal + exit 0 + quorum counts the
  seat; retry-dies → one enriched degrade, not two; skipped-retry texts byte-unchanged;
  critic recovery → `criticSeated: true`.
- **Invariant pins:** healed seat leaves `degraded.value` false; degrades are noted only
  after the retry pass (order pin); no reservation for a retried wave outlives its
  `addWave`; the degrade-invariant source-scan still passes (the module never touches
  `degraded.value`).
- **Schema:** none — channel is a free string in all three copies; the lockstep test stays untouched and green.

## §10 Size gates and verification items

Files touched: new `run-retry.js` (~150 target); `run-stages.js` seam (~10 lines net);
`run-launch.js` +1 passthrough; `degrade.js` +1 channel.
None are in the tight-file table today — **re-measure at plan time** (hard-gate rule; the
numbers move every release).

Plan-time verification items (facts to confirm before coding, not open questions):
- `launchWave`'s existing stdout suppression for in-council fanout calls; `retryOfWaveId`
  adds a second suppressor harmlessly (`fanout.js:75`).
- `deriveSeatLoss`'s matching basis (channel-based expected) — pin either way (§5).
- GUI smoke: `renderSeats` shows the retried seat's live leg (RN-11 family — verify, not
  a blocker).
