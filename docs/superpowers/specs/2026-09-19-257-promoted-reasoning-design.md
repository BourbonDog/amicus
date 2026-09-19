# #257 — a promoted reasoning answer is not a deliverable (design)

Date 2026-09-19. Baseline: main `7e2fc83f` = amicus v4.13.0. Owner decisions of 2026-09-19 in §2.
The measured data-flow map this spec argues from is recorded in the SDD ledger
(`.superpowers/sdd/2026-09-19-257-promoted-reasoning/00-dataflow-map.md`, local-only); every
citation below is on `7e2fc83f`, and the plan re-measures each at writing time.

## 0. Vocabulary

- **Promotion** — `src/sidecar/conversation-mirror.js:271-278`: when the assistant finished with
  no text part, the accumulated reasoning becomes `output` so the completion gates fire;
  `promotedOutput` holds the stand-in and is cleared the moment real answer text arrives
  (`:162-164`). At a leg's terminal return, `mirror.promotedOutput` non-empty ⇔ the leg's output
  IS the promoted reasoning.
- **Promoted leg** — a leg whose terminal output is the promoted reasoning. Today it returns
  `status: complete`, exit 0, the reasoning as `summary`. With `finish: 'length'` it is already
  an `OUTPUT_LENGTH` death (rows L2/L4, `src/utils/output-length.js:44-46`); this spec is about
  every other finish (`stop`, an arm the code does not know, no finish).
- **Deliverable** — for a Stage-1 seat, a review the judges can read; for a judge, a fenced block
  that parses.

## 1. Problem, as measured

- PR #254 round 1: qwen's retry leg (`openrouter/qwen/qwen3.8-27b`) — 40,332 reasoning tokens,
  1 output token, `finish: stop`, `complete`. `review-qwen.md` 149,340 bytes, 0 fenced blocks,
  opens "Let me carefully analyze". The repair leg extracted C1–C4 (`repaired`,
  `findingsUnverified`); the Stage-2 bundle was 179 KB of which that review was ≈ 92 %; three of
  four judges died at the backstop on it; gpt alone adjudicated; the chair praised it as a review.
- Round 2, benign twin: glm as a judge answered entirely in the reasoning channel; its fenced
  block parsed (25 adjudications); nothing fired. The deliberation was real; the channel was wrong.
- Mechanism on `7e2fc83f`: `promotedOutput` has ZERO readers outside the mirror.
  `src/headless.js:2053` treats non-empty output with no error as usable; `materializeReviews`
  (`src/council/run-launch.js:237-251`) keeps any `complete` leg with a non-empty summary; the
  bundle (`src/council/briefings-stage2.js:125-131`) and the chair packet
  (`src/council/briefings-chair.js:186-189`) embed review text uncapped with no metadata beside
  it. `tests/headless-output-length.test.js:114` pins the `finish: stop` shape as correct today —
  this is a deliberate behaviour change, not a regression.
- The issue's remedy ("send it to repair") is refuted by invariant LC-11
  (`src/council/run-stages.js:224-228`): the repair's output is a bare JSON block that never
  becomes review text. Repair can salvage findings for the tally; it cannot give the judges a
  review. The once-only Stage-1 retry can: `src/council/run-stages.js:79-87` retries exactly the
  legs `materializeReviews` rejected.

## 2. Decisions taken (owner, 2026-09-19)

1. **A: retry, not repair.** A promoted Stage-1 leg is no deliverable: it is rejected before
   materialization, so the once-only retry fires; a seat whose retry also promotes (or dies) is a
   lost seat. The repair leg never sees promoted text.
2. **Solo legs keep the promotion** (the issue's own ruling: a user reads it, and
   `conversation.jsonl` already keeps the reasoning). The council layer decides; headless only
   records the fact.
3. **B: a seat that stays promoted after its retry is a LOSS** — `stillDeadLegs`, `seatLoss`, a
   `Notice:` degrade, exit 2 — the same class as a leg that died, not a refused/unverified seat
   under the Wave 4 Cluster B half rule. "Reviewed" means "delivered a review".
4. **Rulings R1–R8 in §5 stand** as written.

## 3. The mechanism

### 3.1 Mint the fact — `src/headless.js`, the normal terminal return (`:2103-2126`)
`promoted: true`, emit-when-true (the `variantUnverified` idiom), computed as
`mirror.promotedOutput.length > 0` at the return. No mirror change (the file is 300/300 and
already holds the fact). The failed-with-no-usable-output return (`:2070-2099`) never carries it —
a leg that died has no deliverable to classify; the catch return (`:2192-2221`) never carries it.
The OUTPUT_LENGTH path is untouched: `finish === 'length'` with no text dies as before (rows
L2/L4) and is not `promoted`.

### 3.2 Ride the fact to every leg document (emit-when-true, delete-when-absent)
| document | site |
|---|---|
| council leg object | `src/sidecar/fanout-leg.js:235-238` beside `ttftMs`/`finish`; the fallback-substitution scrub at `:57` gains `'promoted'` (a substitute attempt starts clean) |
| solo/leg `metadata.json` | `src/sidecar/session-utils.js:108-113` `finalizeSession` (emit/delete), and the four direct writers `session-finalize.js:63-79`, `start.js:200-210`, `continue.js:247-256`, `resume.js:252-261`; each `finalizeSession` caller passes it in `opts`; the shared-server error branch deletes a stale one (R-X9) |
| wave document leg entry | `src/utils/result-schema.js:83-85` `buildRunResult` — the file is 300/300, so the rider block is EXTRACTED first (a sibling module the plan names), never a fourth field crammed onto line 85 |
| `schemas/run.schema.json` | `promoted` declared beside `finish`/`ttftMs`/`backstop`, boolean, emit-when-true; no schemaVersion bump (fields are only added within a version, header `:5`) |
| runStats row → tally.json → verdict.json | `src/council/run-stats-entry.js:64-113` (hand-spelled: the file is require-free by a text pin) AND `src/council/tally.js:166-197` allowlist; a roster test like the `ttftMs` one (`tests/council/run-stats-entry.test.js:256`) so no site escapes |
| spend ledger | NOT carried (a receipt, not a leg document) |

### 3.3 Stage 1: reject before materialization — `src/council/run-launch.js:237-251`
`materializeReviews` gains a third skip beside "dead" and "empty": `if (leg.promoted === true) continue;`
with the docblock sentence "a promoted leg is `complete` with text, and the text is not a review".
Consequences, all existing machinery: the leg is in `deadLegs0` (`run-stages.js:81`) → the
once-only retry (`:87`) → healed (`Recovered:`) or `stillDeadLegs` (`:149`) → `pushDeadSeatRows`
(`:276`) → `degraded` (`:280`) → exit 2. The repair loop (`:189`) never sees it; `attemptedCount`
(`:177`) is never computed on chain-of-thought.

### 3.4 What the announcements say (the one voice, `src/utils/degrade.js:96-102`)
- Retry heal — **DESIGN SKETCH, not the shipped string** (amended at build, R-X17, 2026-09-19):
  the sketch below invented a new sentence; what shipped is the EXISTING heal announcement with
  R9's clause spliced in after "with no usable output", which is what R9 always said and what
  keeps every non-promoted heal byte-identical.
  Sketch: `Recovered: seat <seat>'s review — the first attempt answered only in its reasoning
  channel (<reasoning> reasoning tokens, <output> output tokens; finish '<finish>'), which is not
  a review. The retry's review is the one the judges read.`
  **Shipped** (record fields pinned at `tests/council/run-retry.test.js:1374-1377` and
  `tests/council/run-stages.test.js:818-819`, rendered by `formatDegrade`,
  `src/utils/degrade.js:103`, as `<lead>: <what> — <why>. <effect>.`):
  `Recovered: seat a reviewed on retry — its first leg ended 'complete' with no usable output — it
  answered only in its reasoning channel (40332 reasoning / 1 output tokens, finish 'stop'), which
  is not a review and was relaunched once. The seat is in this council; nothing was lost.`
  The cause clause is computed where the retry names first-attempt deaths today
  (`src/council/run-retry-notes.js`; the plan cites the line).
- Still lost — **DESIGN SKETCH, not the shipped string** (amended at build, R-X17, 2026-09-19);
  same rule: the existing still-dead announcement with R9's clause appended once per attempt.
  Sketch: `Notice: seat <seat> lost — both attempts answered only in the reasoning channel;
  no review reached the judges. <effect from the existing lost-seat record>.`
  **Shipped** (the `what`/`why` pinned at `tests/council/run-stages.test.js:860-861`, scenario (b),
  and the same `why` shape for another seat at `tests/council/run-retry.test.js:1409-1412`; the
  `effect` is `legEffect`, `src/council/run-retry-notes.js:23-25`, over that scenario's two-seat
  bench — pinned as a formula, not as this string; same renderer):
  `Notice: seat b did not review — the leg ended 'complete' with no usable output — it answered
  only in its reasoning channel (40332 reasoning / 1 output tokens, finish 'stop'), which is not a
  review; its once-only retry also ended 'complete' — it answered only in its reasoning channel
  (40332 reasoning / 1 output tokens, finish 'stop'), which is not a review. 1 of 2 seats
  reviewed; the run continues with the bench that did and will exit degraded (2).`
- The dead-seat row (`src/council/run-stage1-rows.js:211-212`) keeps the leg's true
  `status: complete` and carries `promoted: true`; **the census
  (`src/council/verdict-seats-reviewed.js:101-128`) counts `reviewed` as
  `status === 'complete' && promoted !== true`** so "3 of 4 seats reviewed" is true when one seat
  stayed promoted. No new census key (the loss is visible in the degrade record and the row, and
  in `seatLoss` when `--critic` was requested — amended at build, R-X16, 2026-09-19).

### 3.5 Stage-2 judges — `src/council/run-stage2.js:180-189`, `src/council/run-stage2-notes.js:60-75`
A third arm beside `legDied` / `legAnsweredEmpty`:
`legAnsweredFromReasoning = !legDied && leg.promoted === true`.
- Parse proceeds unchanged (`parseJudgeOutput` over `leg.summary`; `lastJsonBlock` takes the last
  opener that parses). **If it parses, the adjudication is used** (the issue's ask 3) and an
  `info` note is raised: `Note: judge <seat> answered in its reasoning channel — its fenced block
  parsed and was used; the deliberation itself was read by nobody.` (no exit change; the quoted
  wording corrected to the shipped literal at build, R-X13, 2026-09-19).
- Third arm the design missed (amended at build, R-X13, 2026-09-19): the judge repair loop
  (`run-stage2.js`, the bounded 2-attempt `-q<N>` repair) can supply the parseable block for a
  promoted judge whose own answer had none; the adjudication is used with
  `conformance: 'repaired'`, and the same `info` note fires with a `why` that names the repair —
  `its own answer carried no parseable block; the adjudication used came from the judge repair
  (attempt <n>); the deliberation itself was read by nobody (…)` — and `data.repaired: true`.
- If it does not parse, `thinCrossReviewWhy` gains the clause `<n> answered only in the reasoning
  channel with no parseable block` instead of the generic "no parseable Stage-2 block".
- Judge prose is never embedded anywhere today (`buildChairPacket` takes rankings/adjudications
  only) — pinned, not changed.

### 3.6 The chair packet and the bundle
No marker. A promoted review cannot reach `buildJudgeBundle` or `buildChairPacket` because it
never materializes; a tripwire test pins the observable (no `reviews[]` entry whose
`leg.promoted` is true reaches either builder, on a run whose first attempt promoted and whose
retry healed).

## 4. What does not change (the fences)
- The promotion itself (`conversation-mirror.js:271-278`) and every mirror pin — solo answers
  still surface reasoning-only output; the un-promotion on real text is untouched.
- The `OUTPUT_LENGTH` death (`finish: 'length'`, rows L1–L4) — byte-identical reasons.
- The repair loop, LC-11, `REPAIR_CHANGED_FINDING_COUNT`, `findingsUnverified`/`repairRefused`,
  the `unverified-repair`/`repair-refused` rows — untouched; a promoted leg never enters them.
- The bundle and packet builders — byte-identical for every bench with no promoted leg (mutant:
  the rejection removed → the promoted review reappears in the bundle; a fixture pins it).
- The census shape `{reviewed, unverified, refused, of}` — no new key.
- CI worst case — a promoted first attempt costs the same once-only retry an empty one costs today.

## 5. Rulings made in this spec (mine — each with its cost if wrong; the owner let them stand)
- R1 **No solo notice.** The promotion is a designed solo behaviour; this PR adds the `promoted`
  field to solo `metadata.json` and nothing on stderr. Cost if wrong: a solo user still reads
  reasoning as the answer with no announcement — a BACKLOG candidate, not this PR.
- R2 **Mint in headless from `mirror.promotedOutput`, not in the mirror.** Cost if wrong: if a
  later mirror change clears `promotedOutput` on a path other than real text, the fact goes
  missing silently — pinned by a named mutant on the terminal return.
- R3 **The still-promoted seat keeps `status: complete` on its row; the census predicate
  excludes it.** Cost if wrong: any third reader of `status === 'complete'` (the workspace's seat
  rows, `deriveSeatLoss`) may count the seat as reviewed — the plan greps every reader of
  `'complete'` in src/council, src/workspace and electron and rules on each (failure mode #8's
  root cause: a guard for two readers with a third left outside).
- R4 **Judge: accept-if-parses plus an info note, no retry.** Judges have no retry today; this PR
  does not add one. Cost if wrong: a promoted judge with no parseable block is still a lost judge
  — the clause names why, nothing recovers it.
- R5 **Extract the wave-doc rider block** rather than join lines in `result-schema.js`. Cost if
  wrong: an extraction touches a 300/300 file with byte-order pins — the plan classifies each as
  GREEN-at-HEAD with a mutant, not RED.
- R6 **`promoted` is emit-when-true, never `promoted: false`.** Every other rider is emit-when-set;
  a `false` key would change byte-identity on every leg document.
- R7 **No schemaVersion bump.**
- R8 **CHANGELOG `### Changed` with an upgrade sentence** (failure mode #17): a seat that today
  counts as reviewed on a promoted answer will be retried and, if it repeats, counted lost and the
  run exits 2. Docs: `docs/council.md` (leg completion), `docs/troubleshooting.md` (the
  first-person-review symptom), `docs/configuration.md:172-184` (the paragraph that promises the
  L2/L4 behaviour), MODEL-NOTES (the #135 block "until #257 lands" bullet becomes "handled since
  the next minor" — only if that block has landed by then), the `run.schema.json` field,
  `schemas/council-tally.schema.json`'s runStats row, `docs/usage.md` if it lists leg fields.
- R9 **The retry notes carry the reasoning-channel fact, byte-identical otherwise.** The heal
  note (`run-retry.js:226`) and the still-dead notes (`run-retry-notes.js:130,175-176,198`;
  `run-stages.js:119`) derive the first attempt's cause from a minted `firstFailure` record
  (`run-retry-group.js:236`: `{ seat, class: 'leg', status, reason }`), so a promoted first leg
  would read "ended 'complete' with no usable output". The mint gains `promoted:
  { reasoning, output, finish }` (emit-when-promoted) and every site appends ONE clause built by
  one helper — ` — it answered only in its reasoning channel (<reasoning> reasoning / <output>
  output tokens, finish '<finish>'), which is not a review` — inserted after "with no usable
  output". For every leg that is not promoted the clause is the empty string, so every pinned
  string in `run-retry.test.js`, `run-retry-notes.test.js` and `degrade-contract.test.js` stays
  byte-identical. Cost if wrong: a promoted leg announced with a true-but-uninformative cause;
  pinned by wording tests per site. (amended at build, R-X14, 2026-09-19) A sixth site the
  enumeration missed: `verdict-seat-loss.js :: deriveSeatLoss` renders `the critic leg ended
  '<status>' with no usable output` into verdict.json's `seatLoss.reason` for a still-dead
  critic; it appends the same clause, fed by `data.promoted` — the reasoning-channel facts every
  Stage-1 dead-leg record now carries emit-when-promoted (srcLegStillDeadNote,
  retryLegStillDeadNote [the retry leg], missingLegStillDeadNote [the first failure's], the
  skipped-leg note) so machine readers get the fact wherever prose names it.
- R10 **Out of scope, filed in BACKLOG:** the other readers of a completed status that a
  promoted leg could fool — the chair (`chair-fallback.js:87`, `run-chair.js:61`), the debate
  defense/re-vote legs (`run-debate.js:61,84,267`, `run-debate-revote.js:172,240`) and the
  fallback-substitution chain (`fanout-leg-fallback.js:203`). A chair or defense that answers
  only in its reasoning channel is the same disease on a different surface; this PR records the
  `promoted` fact on those legs too (they are legs) and changes nothing about how they are read.
  `models-probe.js:41` is correct as is: a promoted probe answer still means "served".
- R11 **The promoted-judge note has its own channel, `judge-reasoning-only`, kind `info`.**
  Registered in `degrade.js` (the drift pin in `degrade-contract.test.js:214-231` reads every
  `channel:` literal in src). Not `stage2-judge`: that channel means a judge DIED, and its
  consumers gate on it. Its `why` names which of the TWO success paths supplied the parseable
  block: its own fenced block parsed and was used, or, when the judge repair supplied the block,
  names the repair (amended at build, R-X13, 2026-09-19).
- R12 **`promoted` never rides an `error` leg.** The failed-with-no-usable-output return never
  emits it (an L2/L4 death has a non-empty stand-in and is a death, not a promoted leg), so
  three of the four direct error-branch metadata writers need no new line (start.js and
  continue.js write a fresh session's metadata; resume.js scrubs at
  `updateSessionStatus('running')`); the shared-server path, `session-finalize.js`'s error
  branch, deletes stale riders in place (council #232 r1 B1) and gains an unconditional
  `delete metadata.promoted` (amended at build, R-X9, 2026-09-19); a hand-assembled result
  carrying both `error` and `promoted: true` is pinned to stamp nothing. The reopen delete list
  in `resume.js :: updateSessionStatus` (`:118`) gains `promoted`, the same way it holds
  `finish`/`variant`/`backstop`. The council leg rider in fanout-leg.js is status-agnostic like
  its finish/backstop siblings; R12 holds at the producer (headless never emits the key on the
  failed or catch return — mutant PROMOTEDONDEATH) (amended at build, R-X12, 2026-09-19).

## 6. Data flow after the change
```
mirror.promotedOutput non-empty at return
  └─ headless normal return: promoted:true ──► fanout-leg rider ──► leg.promoted
        ├─ solo: metadata.json { promoted:true }, output unchanged (no notice)          [R1]
        └─ council Stage 1: materializeReviews SKIPS ──► deadLegs0 ──► once-only retry
              ├─ retry healed ──► Recovered: … answered only in its reasoning channel … [3.4]
              └─ retry promoted/died ──► stillDeadLegs ──► row {status:complete, promoted:true}
                     ──► census reviewed excludes it ──► seatLoss + Notice ──► exit 2   [B]
     council Stage 2 judge: parse as today
              ├─ parses ──► used + Note (info)                                          [3.5]
              └─ no block ──► thin-cross-review why: "answered only in the reasoning channel"
     bundle / chair packet: never see a promoted review (tripwire)                      [3.6]
     documents: metadata.json, wave.json (extracted riders), tally.json, verdict.json, schema
```

## 7. Tests the plan must carry (GREEN/RED classified at HEAD by the plan, each with a named mutant)
- headless: the terminal return emits `promoted` on a `stop` + reasoning-only leg and not on a
  leg with answer text (the existing `:114` pin is REWRITTEN as the deliberate change);
  mutant PROMOTEDDROPPED.
- fanout-leg rider + scrub list; the four metadata writers + `finalizeSession` (the
  *DROPPED/*STALE mutant pairs the siblings use).
- `materializeReviews` rejects a promoted leg (mutant PROMOTEDKEPT) and is byte-identical
  otherwise.
- run-stages scenario: first attempt promoted → retry fires → healed note wording; retry promoted
  again → dead-seat row, census `reviewed` excludes it, `seatLoss`, exit 2 (mutant
  CENSUSPROMOTED).
- tally allowlist + `buildRunStatsEntry` roster ("no promoted site escapes"), result-schema
  emit-when-true, run.schema.json validates the new field.
- Stage 2: the third arm; parse-and-use with the note; the thin-cross-review clause.
- Tripwire: no promoted review reaches the bundle or the packet.
- Docs gates: `docs-quick-sync`, citations, the degrade channel drift pin (any new channel
  literal registered in `degrade.js:14-53`).

## 8. Rollout
One PR, `feat/257-promoted-reasoning`, council-gated (the owner labels; label OFF after each
round). CHANGELOG `[Unreleased] ### Changed`. Ships in the next minor; CI installs
`amicus@latest`, so the first live sample is the first post-release round in which a seat answers
in its reasoning channel (measured once in three rounds on qwen — expect it rarely).

## 9. Self-review against the plan-authoring catalog
- #19 every terminal write enumerated (3.2), not the helper's callers alone.
- #8/#3 the census predicate names its third readers as a plan task (R3), not a claim.
- #17 the behaviour change has a CHANGELOG owner and an upgrade sentence (R8).
- #12 corollary 3: the docs that PROMISE today's behaviour are listed (R8).
- #61 counts: 4 direct metadata writers + 1 shared, 3 files at 300/300, 1 pin rewritten.
- #64 power: the live sample rate is "once in three rounds", stated, not promised.

## 10. Addendum — every remaining reader (owner decision C at council round 1, 2026-09-19)

R10 and R-X17 filed the chair, debate and repair readers as out of scope. Council round 1 on PR #270
rated that the headline gap; the owner ruled "C": pull them all in. Measured map: the SDD ledger's
`r10-sites-map.md` (every anchor re-verified at `4a2c111c`). Rulings R-X21–R-X25 and R-X27 below; each site
gets ONE conjunct, `&& !isPromotedLeg(<leg>)`, and rides its existing not-ok path unchanged.

| site | today | rule |
|---|---|---|
| Stage-1 `-p<N>` repair solo (`run-stages.js:214`) | the repair leg's reasoning becomes `repairing` and is validated as findings | a promoted repair is a FAILED repair attempt inside the existing bound (`attempts < 2`): `repaired` is `''`; the `role: 'repair'` row (built by `buildRunStatsEntry`) carries `promoted: true`; the seat ends `conformance: 'unstructured'` exactly as after a dead repair. No new note (R-X21). |
| Stage-2 `-q<N>` judge repair (`run-stage2.js:225`) | a promoted repair's reasoning is parsed and, if a block parses, USED | the same conjunct: a promoted repair is never used; the loop's existing arms run. The measured gap "a promoted repair of a non-promoted judge fires no `judge-reasoning-only` note" closes by construction — such a repair can no longer supply the block, so the note's `attempts > 0` arm fires only for a promoted ORIGINAL rescued by a non-promoted repair, which is what its `why` says. The judge artifact `judge-<seat>.md` is still written for a promoted judge (the audit trail the note points at). |
| Chair attempt (`run-chair.js:61`) + classifier (`chair-fallback.js:87`) | a promoted chair leg is `ok`; its reasoning becomes the synthesis | `ok` gains the conjunct, so the walk continues (ch2 same chair, ch3 the ledger-promoted fallback, then give-up → `chair-failed`, exit 2 — the existing path). The classifier returns `{ outcome: 'no-output', reason: 'answered only in its reasoning channel (<r> reasoning / <o> output tokens[, finish '<f>']); no synthesis to read' }` — the closed `outcome` enum is untouched and the `chair-failed` `why` prints the reason with zero template edits. The `chair-attempt` row carries `promoted: true`. (R-X22) |
| Chair verdict-line repair (ch4, `run-chair.js:205`) | a promoted ch4 repair leg's deliberation was scanned for a `VERDICT:` line | the same conjunct; a promoted repair supplies no line, the existing no-parseable-line arm of `chair-failed` fires (exit 2); the `repair` row carries `promoted: true`. (R-X27, found by the docs review — the map missed this summary reader) |
| Debate defence (`run-debate.js:61-67`, `:84-88`) | a promoted defence is `leg`-truthy; its reasoning is parsed and, if it parses, applied | gate the PARSE, not the leg: a promoted defence is UNPARSEABLE — `parsed = { ok: false, byId: allNoResponse(expectedIds), errors: [{ code: 'REASONING_ONLY', detail: 'answered only in its reasoning channel' }] }`, `conformance: 'unstructured'`; the real leg document is KEPT so the `rebuttal` row carries `promoted: true` and its usage; the one bounded repair runs as for any unparseable defence; a promoted repair leg is unparseable the same way; `bad()` degrades the round through `conformance` (no `debate-degraded` wording change — "returned unstructured output" is what the parser saw). Every affected finding's original stands (`action: 'no-response'`, the existing enum). (R-X23) |
| Debate re-vote (`run-debate-revote.js:240-245`, `:172-173`) | a promoted re-vote is `alive`; its reasoning is parsed | the same parse gate: `parsed` is the failed parse with `code: 'REASONING_ONLY'`, `conformance: 'unstructured'`, the ONE bounded repair runs, a promoted repair leg is unparseable the same way; the judge's provisional verdict stands. The file is at 300/300: every edit is in place and the `./promoted` require shares an existing require line. (R-X23) |
| Fallback-substitution chain (`fanout-leg-fallback.js:203`) | a promoted attempt is `complete` and returned | UNCHANGED, ruled out: `isRetryable` is capacity-only, so a conjunct there changes nothing; a reasoning-only answer is not a capacity signal and earns no substitute. The council rejects the leg one layer up. (R-X24) |
| Census predicates `isUnverifiedSeat` / `isRefusedSeat` (`verdict-seats-reviewed.js:77`, `:82`) | reachable only through a materialized review, so unreachable for a promoted row | both gain `&& r.promoted !== true` so the "unverified ≤ reviewed" invariant rests on the predicates, not on unreachability. (R-X25) |

Out of this PR, filed: `src/sidecar/fanout-output.js:27` — the `amicus fanout` CLI prints a promoted
leg's reasoning as its answer with no marker (R1's sibling on the fanout surface).

Rulings, each with its cost if wrong:
- R-X21 **The repair solos gate and stay silent at run time.** A failed repair is silent today by
  design (its record is the `role: 'repair'` row and the seat's `unstructured` conformance); a
  promoted repair joins that class, and its row says `promoted: true`. Cost: a reader of the run
  learns the cause from the row, not from a `Notice:`.
- R-X22 **The chair carries the cause in `chairAttempts[].reason`.** No new enum value, no new
  channel, no template edit. Cost: none measured; a promoted chair costs the walk's two extra legs.
- R-X23 **Debate treats a promoted answer as unparseable, keeps the leg, repairs once.** Cost: one
  bounded repair leg is still paid for a promoted defence or re-vote — the same price an
  unparseable one pays today.
- R-X24 **The substitution chain is unchanged.** Cost: none — measured to change nothing.
- R-X25 **The two census predicates gain the guard.** Cost: none — unreachable today.
- R-X27 **The ch4 verdict-line repair is gated too.** Cost: one conjunct.
