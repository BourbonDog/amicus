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
5. **A′ (council round 2, 2026-09-19): the Stage-2 judge exception (R4) is withdrawn.** A promoted
   judge is never used as it stands; its retry is one relaunch with the original bundle, then one
   repair of real text, then it stands down and says so. The same relaunch for a promoted defence
   or re-vote. R-X32–R-X34 in §11.

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
> Superseded by §11 R-X32 (owner decision A′, council round 2): the accept-if-parses rule below no
> longer applies — a promoted judge is relaunched, never used as it stands. Kept as the round-0
> record.

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
  — the clause names why, nothing recovers it — superseded by R-X32 (§11).
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
  names the repair (amended at build, R-X13, 2026-09-19) — superseded by R-X32 (§11): the channel
  and its `info` kind stand, but there is no "own fenced block" path any more and the note fires on
  every ending the relaunch can have.
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
`r10-sites-map.md` (every anchor re-verified at `4a2c111c`). Rulings R-X21–R-X27 below; each site
gets ONE conjunct, `&& !isPromotedLeg(<leg>)`, and rides its existing not-ok path unchanged.

| site | today | rule |
|---|---|---|
| Stage-1 `-p<N>` repair solo (`run-stages.js:214`) | the repair leg's reasoning becomes `repairing` and is validated as findings | a promoted repair is a FAILED repair attempt inside the existing bound (`attempts < 2`): `repaired` is `''`; the `role: 'repair'` row (built by `buildRunStatsEntry`) carries `promoted: true`; the seat ends `conformance: 'unstructured'` exactly as after a dead repair. No new note (R-X21). |
| Stage-2 `-q<N>` judge repair (`run-stage2.js:225`) | a promoted repair's reasoning is parsed and, if a block parses, USED | the same conjunct: a promoted repair is never used; the loop's existing arms run. The measured gap "a promoted repair of a non-promoted judge fires no `judge-reasoning-only` note" closes by construction — such a repair can no longer supply the block, so the note's `attempts > 0` arm fires only for a promoted ORIGINAL rescued by a non-promoted repair, which is what its `why` says. The judge artifact `judge-<seat>.md` is still written for a promoted judge (the audit trail the note points at). |
| Chair attempt (`run-chair.js:61`) + classifier (`chair-fallback.js:87`) | a promoted chair leg is `ok`; its reasoning becomes the synthesis | `ok` gains the conjunct, so the walk continues (ch2 same chair, ch3 the ledger-promoted fallback, then give-up → `chair-failed`, exit 2 — the existing path). The classifier returns `{ outcome: 'no-output', reason: 'answered only in its reasoning channel (<r> reasoning / <o> output tokens[, finish '<f>']); no synthesis to read' }` — the closed `outcome` enum is untouched and the `chair-failed` `why` prints the reason with zero template edits. The `chair-attempt` row carries `promoted: true`. (R-X22) |
| Chair verdict-line repair (ch4, `run-chair.js:205`) | a promoted ch4 repair leg's deliberation was scanned for a `VERDICT:` line | the same conjunct; a promoted repair supplies no line, the existing no-parseable-line arm of `chair-failed` fires (exit 2); the `repair` row carries `promoted: true`. (R-X27, found by the docs review — the map missed this summary reader) |
| Debate defence (`run-debate.js:61-67`, `:84-88`) | a promoted defence is `leg`-truthy; its reasoning is parsed and, if it parses, applied | gate the PARSE, not the leg: a promoted defence is UNPARSEABLE — `parsed = { ok: false, byId: allNoResponse(expectedIds), errors: [{ code: 'REASONING_ONLY', detail: 'answered only in its reasoning channel' }] }`, `conformance: 'unstructured'`; the real leg document is KEPT so the `rebuttal` row carries `promoted: true` and its usage; the one bounded repair runs as for any unparseable defence; a promoted repair leg is unparseable the same way; `bad()` degrades the round through `conformance` (no `debate-degraded` wording change — "returned unstructured output" is what the parser saw). Every affected finding's original stands (`action: 'no-response'`, the existing enum). (R-X23) The real leg document is KEPT and its row carries `promoted: true` — the one leg-sourced field `debate.js :: mk` forwards beyond the five it already copies (R-X26; G1 golden byte-identical, G1f pins the slot). |
| Debate re-vote (`run-debate-revote.js:240-245`, `:172-173`) | a promoted re-vote is `alive`; its reasoning is parsed | the same parse gate: `parsed` is the failed parse with `code: 'REASONING_ONLY'`, `conformance: 'unstructured'`, the ONE bounded repair runs, a promoted repair leg is unparseable the same way; the judge's provisional verdict stands. The file is at 300/300: every edit is in place and the `./promoted` require shares an existing require line. (R-X23) |
| Fallback-substitution chain (`fanout-leg-fallback.js:203`) | a promoted attempt is `complete` and returned | UNCHANGED, ruled out: `isRetryable` is capacity-only, so a conjunct there changes nothing; a reasoning-only answer is not a capacity signal and earns no substitute. The council rejects the leg one layer up. (R-X24) |
| Census predicates `isUnverifiedSeat` / `isRefusedSeat` (`verdict-seats-reviewed.js:77`, `:82`) | reachable only through a materialized review, so unreachable for a promoted row | both gain `&& r.promoted !== true` so the "unverified ≤ reviewed" invariant rests on the predicates, not on unreachability. (R-X25) |

Out of this PR, filed: `src/sidecar/fanout-output.js:27` — the `amicus fanout` CLI prints a promoted
leg's reasoning as its answer with no marker (R1's sibling on the fanout surface).

Rulings, each with its cost if wrong:
- R-X21 **The repair solos gate and stay silent at run time.** A failed repair is silent today by
  design (its record is the `role: 'repair'` row and the seat's `unstructured` conformance); a
  promoted repair joins that class, and its row says `promoted: true`. Cost: a reader of the run
  learns the cause from the row, not from a `Notice:` — narrowed by R-X36 (§12) for the Stage-2
  judge: a promoted `-q<N>` repair of a judge that ends unusable is announced — and by R-X46 (§13)
  for the debate: a promoted repair of a real defence or re-vote is named in the note.
- R-X22 **The chair carries the cause in `chairAttempts[].reason`.** No new enum value, no new
  channel, no template edit. Cost: none measured; a promoted chair costs the walk's two extra legs.
- R-X23 **Debate treats a promoted answer as unparseable, keeps the leg, repairs once.** Cost: one
  bounded repair leg is still paid for a promoted defence or re-vote — the same price an
  unparseable one pays today.
- R-X24 **The substitution chain is unchanged.** Cost: none — measured to change nothing.
- R-X25 **The two census predicates gain the guard.** Cost: none — unreachable today.
- R-X26 **The debate rows carry the fact.** `mk`'s synthetic leg forwards `promoted` emit-when-true;
  the shaped literals in `run-debate.js` and `run-debate-revote.js` carry it; `legRow` already passed
  the real leg. Cost: one field on debate rows the byte-order suite documented as "re-decide" —
  re-decided here.
- R-X27 **The ch4 verdict-line repair is gated too.** Cost: one conjunct.

## 11. Addendum — council round 2 (2026-09-19)

Council round 2 on PR #270 (run `35444701260`, 4/4 seats, "Fix these first") confirmed twelve
findings and contested one (its adjudicated sticky comment: 12 / 1 / 0 / 0). Five clusters bear on
the design: A2 → R-X29; D2 → R-X30; A4 + B2 + C1 → R-X31, with A3 (the wave schema) refuted a second
time and made moot inside it; B1 (`leg.error` raw) filed inside R-X31; and A1 + D1 — the Stage-2
judge exception R4 — ruled A′ by the owner: withdrawn (R-X32–R-X34 below). The remaining four are ruled
without a code change. D3 (contested): `promotedOutput` is initialised to `''` in the mirror's state
(`src/sidecar/conversation-mirror.js:47`) and its only assignments are `''` (`:164`) and the
accumulated `reasoningOutput` string (`:276`), so the `.length` read at the mint
(`src/headless.js:2129`) cannot throw. D4: the three `promotedFacts(leg)` reads in one dead-leg note
(`src/council/run-stages.js:120`, `:123`) are pure reads of one leg on a path that runs once per
lost seat, and the note is pinned byte-identical — left as is. D5: the two `require`s on one line at
`src/council/run-debate-revote.js:52` are the 300-line gate's deliberate consequence (§10, the
re-vote row); splitting that file is its own change. D6: `tokenSplit` and `reasoningOnlyClause` read
`facts.finish` as given because every facts object they receive is minted by `promotedFacts` —
directly (`src/council/chair-fallback.js:104`, `src/council/run-retry-notes.js:145`, `:190`,
`src/council/run-stages.js:120`, `:123`) or through the first-failure record it minted
(`src/council/run-retry-group.js:238` → `ff.promoted`, read at `src/council/run-retry-notes.js:198`,
`:220`, `src/council/run-retry.js:226`) and the `data.promoted` the run.json record carries for
`deriveSeatLoss` (`src/council/verdict-seat-loss.js:132-133`); the bound is producer-side by design
(R-X31).

Every `file:line` in this section is measured on `a028e12d`, the head carrying all three fixes: the
table's middle column names the behaviour at `ba1b47d7`, the citations name where that code lives
now. The last three rows (R-X32–R-X34) are the A′ round and are measured differently, as each says:
their citations are on `77aa18d5` — the head carrying fixes E1 and E2 — and their middle column
names the behaviour at `5e624ef8`, the head those two fixes branched from, not at `ba1b47d7`.

| finding | at `ba1b47d7` | rule |
|---|---|---|
| R-X29 — the bounded repairs fed a promoted leg's reasoning back verbatim | all three repair solos read the promoted `summary` and shipped it inside LC-12's `--- YOUR PREVIOUS <KIND> (verbatim — this is the text to correct) ---` block, unbounded: the defence (`run-debate.js:85`), the re-vote (`run-debate-revote.js:169`) and the Stage-2 `-q<N>` judge repair (`run-stage2.js:200`) | each call site ships `''` and the briefing grows a THIRD arm that says why and asks afresh — `Your previous defense was written in the reasoning channel and is not a defense — there is no prior text to correct; answer afresh. Do not invent a position to satisfy the schema: say so in your output.` (`briefings-debate.js:205-208`); the re-vote arm reads the same way for a re-vote, and the judge arm the same for a judgement, with its own do-not-invent clause (`briefings-stage2.js:183-186`). The judge repair's flag is `judging === '' && isPromotedLeg(leg)` (`run-stage2.js:214`), so a real `-q1` answer returns the verbatim arm to `-q2`. Named mutants DEFENSEREPAIRCARRIESREASONING, REVOTEREPAIRCARRIESREASONING, JUDGEREPAIRCARRIESREASONING. |
| R-X30 — a kept promoted defence or re-vote was still materialized | `materializeDebate` (`run-launch.js:280`) wrote `leg.summary` for every entry that had one, so a promoted defence or re-vote — KEPT under R-X23 so its row could carry the fact — reached `rebuttal-<seat>.md` / `revote-<seat>.md`: an artifact that reads as a rebuttal and is none | the skip `materializeReviews` already had, `if (isPromotedLeg(leg)) { continue; }` (`run-launch.js:287`, its twin at `:250`). The `rebuttal` literal forwards `promoted` emit-when-true so the materializer can see it (`run-debate.js:138-141`); the `revote` literals already did under R-X26 (`run-debate-revote.js:293-295`). Named mutants DEBATEPROMOTEDMATERIALIZED, DEBATELITERALPROMOTEDDROPPED. |
| R-X31 — the `finish` bound, the forked token fragment, the silent wave schema | the bound was a printable-ASCII strip (`[^\x20-\x7e]`) that kept every Markdown character, so a provider-controlled finish reached the sticky PR comment CI renders `verdict.json :: seatLoss.reason` into; the token parenthetical was hand-spelled a second time in `chair-fallback.js`; `wave.schema.json` said nothing about `promoted` (refuted as a defect — a wave's leg object is open — then made moot by declaring it) | the strip is an allowlist, `[^A-Za-z0-9_.:-]`, applied before the 40-char ceiling (`promoted.js:73`; `MAX_FINISH_CHARS` at `:37`); `tokenSplit(facts)` (`promoted.js:89`) is the one home — `reasoningOnlyClause` composes from it (`:104`) and `chair-fallback.js` imports it (`:16`, used at `:104`), both announcements byte-identical, pinned by string AND by source; `wave.schema.json:30-34` declares `promoted` as `{type: boolean, enum: [true]}` on its leg objects, which stay OPEN. Named mutants FINISHMARKDOWN, SPLITFORKED, SPLITINLINED. — the "sticky PR comment" surface named here was never measured and is false; the true surfaces are in §12 (R-X35). |
| R-X32 — the Stage-2 judge exception (R4): a promoted judge's deliberation was adjudicated as its judgement | (at `5e624ef8`, not the header's `ba1b47d7`) a promoted judge's `summary` went straight to `parseJudgeOutput` and an accept-if-parses hit was USED (`run-stage2.js@5e624ef8:188-190`); the same deliberation was written to `judge-<seat>.md` for any leg that came back `complete` with a summary (`run-stage2.js@5e624ef8:169-173`); and the bounded `-q<N>` repair that followed was a repair solo in a fresh session with no bundle to judge from, so it could not succeed | never used as it stands, however well the deliberation parses. A promoted leg is unparseable BY RULE — `{ ok: false, errors: [{ code: 'REASONING_ONLY', detail: 'answered only in its reasoning channel' }] }` (`run-stage2.js:189`) — so attempt 1 of the SAME bounded loop is a RELAUNCH with the original `bundle` (`run-stage2.js:215-216`; `bundle` at `:124`), keeping the `-q<N>` waveId (`:205`), the `role: 'repair'` row (`:238-239`) and `conformance: 'repaired'` when it is used (`:240`) — only the note's prose tells a relaunch from a repair. A relaunch with real but unparseable text gets the one remaining LC-12 repair carrying the RELAUNCH's text (`:230`); a relaunch that is promoted again or dies stands the judge down (the `while` conjunct at `:202`; the outcome is recorded at `:231-234`). No `judge-<seat>.md` from a promoted leg — the relaunch's real text is the artifact (`:173` and `:233`). `promotedJudgeNote` (`run-stage2-notes.js:97`) announces BOTH outcomes on the existing info channel `judge-reasoning-only` (`degrade.js:51`; no new literal, so the drift pin holds), called at `run-stage2.js:284` (rescued) and `:261` (stood down). Its `why` is `its own answer was its deliberation, not a judgement; <cause>; the deliberation itself was read by nobody (<r> reasoning / <o> output tokens)`, and `<cause>` is one of seven, byte-exact (six causes, the `answered` cause carrying two arms — `run-stage2-notes.js:103-120`): rescued by the relaunch itself — `relaunched once with the original briefing, and that relaunch's adjudication is the one used`; rescued by its repair — `relaunched once with the original briefing, and the relaunch's answer needed one repair — the adjudication used came from that repair (attempt 2)`; stood down, promoted again — `relaunched once with the original briefing, and the relaunch answered in its reasoning channel again`; stood down, died — `relaunched once with the original briefing, and the relaunch produced no usable text`; stood down, answered unparseably, with TWO arms forked on `attempts` (review I1, because `ctx.overBudget()` is re-checked between the relaunch and its repair) — `relaunched once with the original briefing, and the relaunch's answer did not parse after its one repair` when `attempts === 2`, and `relaunched once with the original briefing, and the relaunch's answer did not parse — the cost ceiling was reached before its repair` when `attempts === 1`; and never relaunched — `not relaunched — the cost ceiling was reached first`. A user abort during the relaunch returns at `run-stage2.js:224-228` before the judge's row or its note is written, exactly as an abort during a repair always has (aborted runs never reach tally). The thin-cross-review clause becomes `<n> answered only in the reasoning channel and was not rescued` (`run-stage2-notes.js:187`, review M1): under A′ such a judge HAS been relaunched, and that relaunch may have answered in the OUTPUT channel unparseably, so "with no parseable block" was no longer true of all four stand-down causes. Named mutants JUDGEOWNBLOCKUSED, RELAUNCHISREPAIR, STANDDOWNDROPPED, STANDDOWNSILENT, JUDGEARTIFACTPROMOTED, RELAUNCHARTIFACTDROPPED, ARMREADDED-STAGE2. |
| R-X33 — the same defect on the debate's two surfaces: a promoted defence or re-vote was repaired against its deliberation | (at `5e624ef8`, not the header's `ba1b47d7`) the one bounded repair of a promoted defence (`run-debate.js@5e624ef8:85`) and of a promoted re-vote (`run-debate-revote.js@5e624ef8:169`) shipped R-X29's third arm — a repair frame, with no prior text, for a seat that had produced no answer to repair | the one bounded retry of a promoted defence is a RELAUNCH with its ORIGINAL brief (`run-debate.js:85`; `brief` at `:53`, the same `const` the `-d<N>` defence wave was launched with — the id is built at `:54`, so a second raiser's defence is `-d2`), and of a promoted re-vote a RELAUNCH with the SHARED re-vote bundle (`run-debate-revote.js:169`; `bundle` at `:203`, the string also written to `revote-bundle.md` at `:207` and launched at `:220`, threaded through `repairRevoteLeg`'s signature at `:156` and its call at `:246`). Everything downstream is unchanged: the `leg2` gate, `conformance`, the `superseded`/`repair` rows and the emit-when-true `promoted` spreads, so a relaunch that comes back promoted again is unparseable and the original still stands (a defence as `no-response`, a re-vote leaving the judge's provisional verdict) — today's stand-down. Named mutants DEFENSERELAUNCHISREPAIR, REVOTERELAUNCHISREPAIR. |
| R-X34 — R-X29's third briefing arm is unreachable under A′ | (at `5e624ef8`, not the header's `ba1b47d7`) `briefings-stage2.js :: judgeRepairPromptWith` and `briefings-debate.js :: repair` each took a `promoted` flag and returned a third `absent` arm saying the previous answer "was written in the reasoning channel … answer afresh" — reachable only from the call sites R-X32 and R-X33 have now removed | the arm is WITHDRAWN from both files rather than left unreachable: `judgeRepairPromptWith(contract, { errors, judgement })` takes no `promoted` key and `absent` is the single empty-arm string again, byte-identical to the old empty arm (`briefings-stage2.js:179-188`, the withdrawal recorded in its docblock at `:167-175`); the same for `repair(kind, contract, errors, prior)` (`briefings-debate.js:200-203`, docblock `:186-194`). A dead prompt string is unreachable through the builders' return values, so behaviour cannot guard it — SOURCE pins do: each test file reads its own `src/council/briefings-*.js` and asserts it does not contain `written in the reasoning channel`, beside a positive control on the surviving empty arm (`tests/council/briefings-stage2.test.js:252-260` with `:272-276`; `tests/council/briefings-debate.test.js:130-136` with `:104-112`). A stale caller's `promoted` key is pinned to change nothing on the Stage-2 surface ONLY (`tests/council/briefings-stage2.test.js:262-270`), because the Stage-2 dispatchers forward the whole args object; `briefings-debate.js :: repair(kind, contract, errors, prior)` is positional (`:200`), so no `promoted` key can reach it and no such pin exists there. R-X29's principle stands by construction (there is no repair prompt for a promoted leg at all); only its mechanism is superseded. Named mutants ARMREADDED-STAGE2, ARMREADDED-DEBATE. |

Rulings, each with its cost if wrong:
- R-X29 **No repair prompt carries a promoted leg's text.** Cost: a repair that could have used the
  reasoning as context loses it — that is the thesis. Mechanism superseded by R-X34; the principle
  holds by construction.
- R-X30 **`materializeDebate` skips a promoted leg like `materializeReviews` does.** Cost: one fewer
  artifact; the reasoning stays in the leg's session `summary.md` and `wave.json`.
- R-X31 **The finish bound is an identifier allowlist; the token fragment has one home; the wave
  schema declares the fact.** Cost: none measured. — the "sticky PR comment" surface named here was
  never measured and is false; the true surfaces are in §12 (R-X35). `leg.error`'s raw interpolation into the same
  announcement strings is PRE-EXISTING — the Stage-1 dead-leg template has carried it since #85
  (`79f03422`, 2026-08-01), and #202 (`f0915292`) copied the shape into Stage 2, where #219 has
  since bounded it (`run-stage2-notes.js:59`, `collapseExcerpt(leg.error, 200)`). It is filed, not
  fixed here: bounding the Stage-1 and retry templates changes pinned strings for every error over
  the bound and belongs to its own PR.
- R-X32 **A promoted Stage-2 judge is never used as it stands: it is relaunched once with the
  original bundle, then repaired only if that relaunch produced real text, then stood down — and
  the note says which.** The R4 exception is withdrawn. Cost: one paid relaunch per promoted judge,
  replacing a paid repair solo in a fresh session with no bundle to judge from, so it could not
  succeed.
- R-X33 **A promoted debate defence or re-vote is relaunched with its original briefing — the
  defence brief, the shared re-vote bundle — never repaired against its deliberation.** Cost: none
  beyond the relaunch; the bound is still exactly one retry, and the stand-down is unchanged.
- R-X34 **R-X29's third briefing arm is withdrawn from both briefing files, not left
  unreachable.** Cost: none — dead code removed. R-X29's principle is unaffected: with no repair
  prompt built for a promoted leg at all, no promoted text can ride one.

## 12. Addendum — council round 3 (2026-09-19)

Council round 3 on PR #270 (run `35465599616`, **3/4 seats** — qwen died on a busy-window no-output
backstop kill on both its attempts, an ordinary leg death and not a promoted case) returned
"Fix these first": **8 confirmed + 3 contested**.

**The round's first finding is about this spec, not about the code.** Rounds 1 and 2 both wrote
that the `finish` bound exists so a provider-controlled finish "cannot carry Markdown into a sticky
PR comment" (§11, R-X31). **That premise was never measured and is false.** Measured on this head:
the workflow's `Post sticky PR comment` step
(`.github/workflows/council-review.yml:1755`, its comment body composed at `:1836-1878`) builds the
comment from the sticky marker, the heading, the chair verdict line, the tier table, the four
tier sections and the withdrawn-in-debate list — each run through the step's own `neutralize()`
sed filter (`:1771`) — the street-cred table, and a `---` status/cost footer carrying `MODELS`,
the seat census (`SEATS_LINE`, `:1835`), the chair, `fail_on` and the evidence link. It
interpolates **neither `seatLoss` nor `degrades`, anywhere**. The guarantee is therefore
STRUCTURAL, not a consequence of CI never asking for a critic: `critic` is a `workflow_call`
input (`:27-28`), and the workflow has no `workflow_dispatch` trigger at all (`on:` at `:14` is
`pull_request` and `workflow_call`), so "the default PR path requests none" would have been a
configuration-dependent reason for a claim that holds regardless. No degrade prose and no seat-loss reason ever reaches that comment. An item filed long before this round already said so from the other direction (`BACKLOG.md:7115-7118`: “`verdict.json :: seatsReviewed` reaches the check-run title and the sticky comment; `run.json :: degrades[].data.reason` lives only inside the artifact”) — the record contradicted itself for two rounds and nobody read both halves.

**The surfaces that DO render this prose**, all measured on this head:

- the stderr `Notice:` / `Note:` lines — `src/utils/degrade.js :: formatDegrade` (`:106`);
- `run.json` and `verdict.json` as text (machine fields, read by humans);
- the **Markdown** that `src/council/report-md.js :: renderMd` (`:22`) produces — written to
  stdout by `amicus council report` (`src/cli-handlers-council.js:123`) and returned as text by the
  MCP `amicus_verdict` tool's `render: true` path (`src/mcp-tools.js:514`, handler
  `src/mcp-server.js:1508`, the render at `:1528`). Each degrade record is a Markdown
  **list item** (`report-md.js:59`, `- ` + `formatDegrade(d)`; the notes list at `:69`), and that
  list item is the one surface where a Markdown-active character actually renders. **This renderer
  writes no `report.md`**: the artifact it puts on disk is `report.html`, and
  `src/council/report-html.js:31` (`esc`) escapes it. (`report.md`, where a run folder has one, is
  the Claude-authored Stage-5 synthesis that EMBEDS this Markdown as one section — see
  `docs/council.md` § Where artifacts live; no code in `src/` writes it.)

`collapseExcerpt` (`src/utils/text-sanitize.js:79`) strips ANSI and bidi controls, turns every
remaining control byte into a space, collapses whitespace and caps with an ellipsis. It does **not**
neutralise Markdown-active characters — true of the Stage-2 judge-death prose (#219) as well, which
is why a Markdown-neutral `formatDegrade` is FILED at the PR rather than fixed here.

Every `file:line` below is measured on `a46db3ce`, the head carrying fixes F1, F2 and F3; the
table's middle column names the behaviour at `7de27d45`, the head round 3 reviewed.

| finding | at `7de27d45` | rule |
|---|---|---|
| C1 (confirmed major, deepseek) — the finish allowlist still let a hostile finish open emphasis | the allowlist `[^A-Za-z0-9_.:-]` KEEPS `_`, and CommonMark opens emphasis on a leading, trailing or doubled underscore (`_x_` → *x*, `__x__` → **x**); only an INTRAWORD `_` is inert. `tests/council/promoted.test.js` asserted `finishOf('*_~\`') === '_'` under a comment claiming a hostile finish "cannot open … emphasis" — the comment was false and the test proved the loophole | R-X35: a third step, `FINISH_LONE_UNDERSCORE = /(?<![A-Za-z0-9])_\|_(?![A-Za-z0-9])/g` (`src/council/promoted.js:55`), drops every `_` without an alphanumeric on BOTH sides, applied AFTER the 40-char ceiling (`promoted.js:131-132`; `MAX_FINISH_CHARS` at `:41`). That input now yields `null` (`promoted.js:137`, `finish: finish || null`), and the false comment is corrected in place (`tests/council/promoted.test.js:101-107`). Named mutants UNDERSCOREEMPHASIS, FINISHUNBOUNDED, FINISHMARKDOWN. |
| B1 (confirmed major, gpt) — a promoted judge REPAIR was silent | a judge whose ORIGINAL answer was real but unparseable got the ordinary `-q1` repair; if THAT repair came back promoted, `run-stage2.js@7de27d45:229` (`const out = (solo.leg && !isPromotedLeg(solo.leg) && solo.leg.summary) || '';`) dropped its text to `''`, the loop continued, and a judge that then ended `conformance: 'unstructured'` raised NO note at all — `promotedJudgeNote` fired only when the ORIGINAL leg was promoted. The `-q<N>` row carried `promoted: true` (the machine record); the prose said nothing | R-X36: `repairPromoted` records the FIRST `-q<N>` attempt that came back promoted for a judge whose original was not, and is consulted only if the judge ends unusable (`src/council/run-stage2-judge.js :: adjudicateJudgeLeg`). The note forks on `standDown === 'repair-promoted'` (`src/council/run-stage2-notes.js:118-124`), on the SAME `judge-reasoning-only` channel, with `what` = `` judge <alias>'s repair answered in its reasoning channel `` and `data: { judge, seat, attempts, repairPromotedAttempt }` — no `reasoningTokens`/`outputTokens`, because the ORIGINAL leg was real. Named mutants REPAIRPROMOTEDSILENT, REPAIRGUARDDROPPED, FIRSTPROMOTEDREPAIRLOST, JUDGEREPAIRPROMOTEDUSED. |
| C4 (contested minor, deepseek) + M6 (filed at round 2) — the stand-down cause was dual-encoded, in a file with no headroom | the cause lived in three places at once: the `while` conjunct `!(isPromotedLeg(leg) && attempts === 1 && judging === '')`, the `relaunch` enum, and `attempts`, from which `promotedJudgeNote` RE-DERIVED it; and `run-stage2.js` sat at 298/300 with two 250+-char lines carrying those conjuncts, so the next edit had nowhere to go | R-X37: the leg-loop body moved VERBATIM to `src/council/run-stage2-judge.js :: adjudicateJudgeLeg` (228 lines; `run-stage2.js` is now 177), with exactly four non-behavioural edits (the `repairSeq` counter onto `env`, `continue` → `return null`). ONE explicit `standDown` state (`run-stage2-judge.js:103`) replaces the conjunct and the enum: `null` (rescued), `relaunch-promoted`, `relaunch-died`, `relaunch-unparseable`, `relaunch-unrepaired`, `not-relaunched`, and R-X36's `repair-promoted`. All seven pre-existing `why` sentences are BYTE-IDENTICAL — only the option KEY changed, and the old `relaunch` key is pinned as ignored. Named mutants STANDDOWNDROPPED, STANDDOWNSILENT, I1UNFORKED (all re-verified after the move). |
| A1 (confirmed minor, glm; raised at round 2 as B1 and filed then) — the Stage-1 dead-leg prose quoted `leg.error` RAW | the five Stage-1 prose sites interpolated provider-controlled `leg.error` verbatim into the `why`, while the analogous Stage-2 judge-death prose had been bounded with `collapseExcerpt(leg.error, 200)` since #219 | R-X38: all five bound their error text at `MAX_LEG_ERROR_CHARS` — `src/council/run-stages.js:127` (skipped leg) and `src/council/run-retry-notes.js:184` (still-dead first leg), `:224` (the `retryCause` fragment), `:238` and `:262` (`ff.reason`), re-measured on `32fefea4`. All five were spelled `collapseExcerpt(…, MAX_LEG_ERROR_CHARS)` at round 3; R-X42 (§13) folded the four in `run-retry-notes.js` into `boundReason(…)` at round 4, and `run-stages.js:127` still spells the call inline. The cap is **800**, defined at `run-retry-notes.js:54` and exported at `:299`. **400 and 200 were REFUTED by measurement**: the cap bounds provider NOISE and must pass every reason amicus itself MINTS whole, and the longest minted reason AT ROUND 3 was **518** characters (`headless.js :: formatNoOutputBackstopReason`, caller-set + extended + every clause), with the `OUTPUT_LENGTH` remedy at **517**, a plain-ambient-flag `OUTPUT_LENGTH` at **438** and a non-extended backstop at **398** — three of nine over 400, re-measured at round 3 against the real formatters with the pin's own inputs. ⚠️ **Superseded at round 4 (R-X43, §13), and the four numbers above are now history, not a current measurement.** Until R-X43 the ambient `OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX` was interpolated verbatim, so the longest minted reason was OPERATOR-controlled and no finite cap could be a proof — "800 clears the longest by 282" was a statement about a sample, and it is false now. With the flag bounded to 96 characters before it is quoted, the longest reason amicus can mint is a computable worst case, MEASURED on `32fefea4` through the real formatters: **620** for the pinned rows (budget unset + a 96-digit PLAIN flag, quoted twice — 620 again for a 500-character one, because the quote is capped), **605** for a 96-character NON-plain flag, leaving **180** of headroom under the 800 cap; the SUPREMUM over all legal inputs is **627** (pathological finite counts — a JS number's decimal form caps at 24 characters), leaving **173**. Both 180 and 173 are BELOW the 200-character engine-log excerpt this format embeds, so that clause of the round-3 sentence no longer holds either and was removed from `run-retry-notes.js`'s own cap docblock for the same reason. The four round-3 rows are unmoved by R-X44 because each passes explicit counts. The machine fields (`data.reason`, `ff.reason` as minted, `verdict.json :: seatLoss.reason`) stay RAW by design. Named mutants DEADLEGPROSERAW, RETRYPROSERAW, MINTEDREASONTRUNCATED. |
| C3 (contested minor, deepseek; HQ2) — a bare `promoted: true` silently lost the cause | `data.promoted` is a facts object on the three Stage-1 still-dead RECORDS but the literal `true` on rows and leg documents, and `reasoningOnlyClause` returned `''` for anything that was not a facts object — so a producer stamping the boolean would have re-opened the R-X14 regression without a sound | R-X39: `reasoningOnlyClause(true)` now returns the cause without the token parenthetical (`src/council/promoted.js:178`), built from the shared `REASONING_ONLY_CAUSE` const (`:155`) so the two arms cannot drift. The facts arm is byte-identical; `tokenSplit` is never called with the boolean. Named mutant BAREPROMOTEDSWALLOWED. |
| C2 (confirmed major, deepseek) — for a seat that deterministically answers reasoning-only, the branch GUARANTEES the loss | as raised: "for an engine that deterministically answers reasoning-only (the motivating qwen case), the branch guarantees every council it sits on loses that seat with exit 2 and burns both the output and the once-only retry with zero healing path" | R-X40: **stands** on owner decisions A and B (round 0, §2): a promoted answer is no deliverable, the once-only retry fires, and a seat that repeats it is a LOSS with exit 2. A seat that answers this way on every call will therefore lose every council it sits on, by design — the cure is to re-seat it. A pre-flight / `doctor` warning is FILED (BACKLOG, #257 round 3) and recorded in the CHANGELOG upgrade note and in `docs/troubleshooting.md`; no code change this round. |
| the nits (A2, A3, C7 — confirmed; C6 — contested) and C5 (confirmed minor) | A2: `tests/council/verdict.test.js` said `promoted` was "not yet in tally.js's allowlist in this worktree", stale since Task 5 landed. A3: `src/council/run-debate.js` called the superseded leg the original "when the repair produced a usable (complete) leg" — a promoted repair leg is complete and NOT usable, and `leg = leg2` still records it. C6: `promoted.js`'s header said the finish is "BOUNDED here, at the one producer" without saying that the MACHINE fields carry it raw. C7: `run-stages.js` read `promotedFacts(leg)` three times inside one note literal. C5 (deepseek): the test regime is “heavily coupled to source text (fs.readFileSync substring pins forbidding/requiring specific strings)”, asserts named-mutant red-sets “without any mutation-run evidence in the diff”, and “at least one security claim made in the tests is false” | all four nits FIXED, comment-only except C7: A2 at `tests/council/verdict.test.js:446-449`; A3 at `src/council/run-debate.js:72-76`; C6 at `src/council/promoted.js:62-95`, which now names every prose surface, the Markdown list item, the structural reason the sticky comment is not one, and the machine writers by name; C7 at `src/council/run-stages.js:118` (`const pf = promotedFacts(leg);`, one read, note byte-identical). C5 is ANSWERED rather than ruled: every named mutant was applied, run and reverted live in this round's three fix reports and in the PR body, with the failing test titles quoted; the SOURCE pins (a test reading its own `src/` file) are deliberate where the claim is "this string has ONE home" — behaviour cannot guard the absence of a string; and the one genuinely false comment C5 pointed at is the emphasis comment fixed under R-X35. |

Two of the confirmed findings named the sticky PR comment as the surface their defect would render
in — A1 ("via data.reason → deriveSeatLoss → seatLoss.reason — the sticky PR comment") and C1
("renders as `<strong>x</strong>`/`<em>x</em>` in the sticky PR comment"). Both defects are real and
both are fixed; the SURFACE they named is the false premise this section opens with, which the
council inherited from §11's own wording. A finding can be right about the mechanism and wrong
about where it lands.

Rulings, each with its cost if wrong:
- R-X35 **A `finish` keeps an underscore only INSIDE a word.** CommonMark flanking: an intraword `_`
  can neither open nor close emphasis; a leading, trailing or doubled one can. The 40-char ceiling
  runs BEFORE the underscore rule, because a truncation could otherwise END in a right-flanking `_`
  (measured: `'a'×39 + '_' + 'b'×5` yields a trailing underscore when the rule runs first). Cost: a
  pathological finish whose first 40 allowlisted characters are all underscores renders as nothing
  (`null`) instead of a fragment — a finish is a diagnostic token, not a message.
- R-X36 **A non-promoted judge whose `-q<N>` repair comes back promoted, and who ends unusable, is
  announced** — on `judge-reasoning-only`, with a `what` naming the REPAIR rather than the judge's
  own answer, and the FIRST such attempt is the one named. Cost: one more `Note:` on a path that was
  silent; a rescued judge still raises nothing.
- R-X37 **The Stage-2 judge leg-loop body lives in its own module, and the stand-down cause has ONE
  explicit state.** Cost: none behavioural — the move is verbatim and the seven `why` strings are
  byte-identical; the price is one more file in `src/council/`.
- R-X38 **The Stage-1 dead-leg prose is bounded like the Stage-2 judge-death prose, at a cap
  measured to pass every amicus-minted reason WHOLE.** The cap bounds provider noise; it must never
  eat a remedy amicus wrote for the operator to act on. Cost: a provider error longer than 800
  characters is quoted in the prose as its first 799 plus an ellipsis — `data.reason` keeps the
  verbatim bytes. ⚠️ No finite cap WAS a PROOF while `formatOutputLengthReason` interpolated the
  operator-controlled `OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX` verbatim
  (`output-length.js@1e929ccd:83-84`); the pin was a tripwire on drift and the guarantee at the
  formatter was FILED — round 4 (R-X43) BUILT it and bounded the last unbounded input; the cap now
  clears a computable worst case (620 on the pinned rows, 627 over all legal inputs), not a sample.
- R-X39 **A bare `promoted: true` names the cause too, without the token parenthetical.** Cost:
  none — it carries no numbers to quote, and the facts arm is untouched.
- R-X40 **C2 stands on owner decisions A and B.** A seat that answers only in its reasoning channel
  on every call loses every council it sits on: retried once, then lost, exit 2. Cost: an operator
  pays for one wasted retry per run until they re-seat the model; the pre-flight warning that would
  have told them first is filed, not built.

## 13. Addendum — council round 4 (2026-09-20)

Council round 4 on PR #270 (run `35476684772`, 2026-09-19 23:38Z → 2026-09-20 00:10Z, 32 min,
$0.88 over 11 rows) returned "Fix these first" with **4 of 4 seats reviewed**. qwen AND deepseek
both died on their FIRST Stage-1 attempt — `NO_OUTPUT_BACKSTOP` at the 912 s busy-extended window,
the #269 extension firing and rescuing neither — and both were healed by the once-only retry: two
`stage1-retry` heal degrades, no seat lost, and no promoted leg anywhere in the run (0 `promoted`
keys in `run.json`), so the feature under review was again not exercised live. Chair gemini-pro.
**14 findings** (glm A1–A3, gpt B1, qwen C1–C3, deepseek D1–D7): **13 Confirmed, 1 Contested
(D4)** — B1 blocker, D1/D2/D3 major, A1/A2/D4/D5/D6 minor, A3/C1/C2/C3/D7 nit.

Every `file:line` below is measured on `32fefea4`, the head carrying fixes G1, G2, G3 and G5;
the table's middle column names the behaviour at `1e929ccd`, the head round 4 reviewed.

| finding | at `1e929ccd` | rule |
|---|---|---|
| B1 (blocker, gpt, 2-1) — "the suite fails deterministically": a source-text negative pin forbids a literal this PR's own comment introduces | **REFUTED AS STATED, by measurement.** The literal `written in the reasoning channel` is LINE-WRAPPED across `src/council/briefings-debate.js:187-188` (`written in the reasoning` / ` * channel`), so `tests/council/briefings-debate.test.js`'s `not.toContain` never matched it; the marker suite on that head recorded `PASS tests/council/briefings-debate.test.js` (`suite-marker-1e929ccd.log:14066`), 664 of 664 suites green. The FRAGILITY is real and unmeasured until now: one reflow of that comment turns a green pin red. | R-X41: a source-text NEGATIVE pin inspects CODE, not comments. `tests/helpers/code-only.js :: codeOnly` (149 lines) strips comments with a STRING-AWARE character walker — single-quoted, double-quoted and template spans are tracked with backslash escapes, so a glob such as `'**/*.js'` inside a string can never be misread as a block-comment opener and swallow the real code after it (the regex pair the first draft used did exactly that, reproduced live). Regex literals are the ONE documented limitation, pinned by its own case. Applied at 6 of the 14 pins written `expect(src).not.toContain` in `tests/` — the mandated `tests/council/briefings-debate.test.js:140` plus five whose pinned string is PROSE a comment may legitimately quote; the other 8 stay raw because their string is an identifier, a call, a property or a require path. (10 further negative source pins are spelled `expect(SRC)` — `main-security-wiring` ×2, `preload-workspace` ×4, `workspace-shell` ×2, `workspace/md-lite` ×2 — and keep the raw form too: their strings are identifiers and channel names. "14" is the count of the lowercase-`src` form the ruling enumerated, not of every source-text negative pin in `tests/`.) The comment at `:187-188` stays. A comment quoting the two-character close-comment sequence cannot exist in valid JS (any such sequence ENDS a block comment), which the helper's header states rather than defends against. Named mutant COMMENTREFLOW. |
| A1 (minor, glm, 3-0; raised at round 2 as B1 and filed then) — the retry-note header promises every `why` bounded, and four arms interpolate the reason RAW | CONFIRMED: `ff.reason` raw at `run-retry-notes.js@1e929ccd:232` (wave arm), `:235` (missing arm), `:259`, `:261`; `w.reason` raw at `:80`; `d.reason` raw at `:150`; and the heal note's wave/missing arms raw at `run-retry.js@1e929ccd:223`/`:225` — while the module header (`:19-23`) states the invariant for all of them. | R-X42: ONE helper, `boundReason` (`src/council/run-retry-notes.js:55`, exported), is this cap's only spelling at every prose arm in that module and in `run-retry.js`'s heal note — twelve call sites (ten in that module, two in `run-retry.js`'s heal note), the four inline `collapseExcerpt(x, MAX_LEG_ERROR_CHARS)` calls folded into it. The ruling's own count of "ten" enumerated eight arms in that module (six of them raw; `:239` and `:263` already spelled `collapseExcerpt(…)`) plus the heal note's two, so it counted only two of the four folded calls; twelve is the measurement. Every `data.*` field stays RAW, asserted per arm. The header's invariant is now true of every arm, and both files stayed inside the 300-line gate in place (`run-retry-notes.js` 299, `run-retry.js` 300). The MINOR-7c fallback survives the bound: a falsy or whitespace-only reason still reads `no reason recorded` on both wave arms. Named mutants WAVEARMRAW, MISSINGARMRAW, HEALARMRAW. |
| A2 (minor, glm, 3-0; filed at round 3) — a cap on the OUTPUT cannot protect a remedy whose INPUT is operator-controlled | CONFIRMED: `utils/output-length.js@1e929ccd:83-84` interpolated the ambient `OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX` verbatim (twice on the plain arm, once on the non-plain), so R-X38's 800-character cap was a tripwire on drift and no finite cap could be a proof. | R-X43: the guarantee moves to the formatter. `formatOutputLengthReason` bounds the flag with `safeFragment` (`MAX_FRAGMENT_CHARS` 96) BEFORE quoting it (`src/utils/output-length.js:127`) while `PLAIN_OUTPUT_TOKEN_FLAG` still tests the RAW bytes (`:134`) — the engine saw the raw value, the prose quotes a bounded copy — and the doctor row took the same split at its five quoting sites (`src/utils/doctor-output-budget-check.js:140`). With the flag at most 96 plus an ellipsis, the budget a number and the counts numbers, the longest minted reason is a COMPUTABLE worst case, **re-measured on this head through the real formatters**: **620** (budget unset plus a 96-digit PLAIN flag, quoted twice — and 620 again for a 500-character one, because the quote is capped), **605** (a 96-character NON-plain flag), **180** under the 800 cap. The four round-3 rows are UNMOVED (518 backstop, 517 non-plain flag, 438 plain flag, 398 non-extended backstop) because each passes explicit counts. ⚠️ 620 is the longest PINNED row; the SUPREMUM over all legal inputs is **627**, measured with pathological finite counts (a JS number's decimal form caps at 24 characters, `-1.7976931348623157e+308`), 173 under the cap — the docblocks name both numbers so neither can claim a worst case that a legal input beats. The round-3 BACKLOG filing is closed. Named mutants FLAGUNBOUNDED, MINTEDREASONTRUNCATED. |
| D2 + D5 (major + minor, deepseek, 3-0; HQ2) — the announcements confidently broadcast a fabricated `(0 reasoning / 0 output tokens)` when the provider reported no usage | CONFIRMED: `promoted.js@1e929ccd:136-137` floored an absent, invalid or negative count to `0` and `tokenSplit` at `promoted.js@1e929ccd:152` rendered the two zeros; `reasoningOnlyClause({})` therefore rendered the fabrication, and `tests/council/run-chair.test.js@1e929ccd:403` PINNED it for a leg with no usage at all. | R-X44: an unreported count is `null`, never a fabricated 0. `promotedFacts` records `null` unless the count is a non-negative integer that was actually reported; `tokenSplit` (`src/council/promoted.js:194`) renders the literal `token usage not reported` unless BOTH counts are integers, the `, finish '<f>'` clause unchanged; `reasoningOnlyClause({})` therefore renders the CAUSE with `(token usage not reported)` — the cause is never swallowed (R-X39), only the numbers are withheld. The chair reason (`src/council/chair-fallback.js:104`) reads that same parenthetical and follows it. `data` fields carry the nulls. **R-X44(b):** one rule, every formatter that quotes counts — `truncatedReviewNote` (`src/council/run-retry-notes.js:283`) says ` — token usage not reported` in place of ` after <r> reasoning / <o> output tokens`, and `formatOutputLengthReason` the same; the three homes are pinned EQUAL to `tokenSplit`'s literal rather than to three copies of it, because `promoted.js` is a LEAF that may require nothing. **R-X44(c):** the live path sums per-message usage through `pricing.js :: sumPerMessageUsage`, which floors a leg that reported nothing to ALL-ZERO totals — so the three formatters apply ONE physics rule, `reportedTokens` (`src/council/promoted.js:158`, hand-spelled a second time at `src/utils/output-length.js:56` because `utils/` must not require `council/`): a usage record with NO positive count is not a report (a `finish 'length'` stop consumed the reservation; a promoted leg produced the reasoning it promoted; a true report carries a positive input count at least), while a reported 0 beside a positive count stays a reported zero. `pricing.js :: hasObservedTokens` was read as the ruling directs and REJECTED: it counts input and output only (v4.4.1 CA-7), so `{reasoning: 32000, output: 0}` — the #218 flagship shape and the corpus's own fixture — would have read as unreported. The SEAM itself (the leg document and the spend ledger still carrying the summed zeros in their token fields) is FILED in `BACKLOG.md` under #257 — the `pricing.js :: sumPerMessageUsage` item — not fixed. Named mutants ZEROFABRICATED, TRUNCATEDZEROS, OUTPUTLENGTHZEROS, ALLZEROREPORTED. |
| A3 + C1 + C2 + C3 + D1 + D7 (major plus five nits, glm/qwen/deepseek, all 3-0; HQ1) — the runStats taxonomy is stretched into falsehoods: a relaunch filed as a `repair`, and a RESCUED judge row carrying `promoted: true` with `fromReasoning: true`, indistinguishable from a judge that delivered nothing | CONFIRMED as record semantics: `run-stage2-judge.js@1e929ccd:112` and `:156` pushed `role: 'repair'` for the attempt-1 RELAUNCH; `:224`'s ok:true entry carried `fromReasoning: isPromotedLeg(leg)` (true for a rescued judge) and `leg: leg`, the ORIGINAL promoted leg (#83 attribution), with NO rescue marker — so `run-assemble.js@1e929ccd:226` built a judge row emitting `promoted: true` and nothing to tell a rescue from a loss. | R-X45 (a): a new runStats role, **`relaunch`** — the follow-up ask that RE-asks a promoted seat with its ORIGINAL briefing rather than correcting it: the attempt-1 `-q<N>` of a promoted judge, every one of them, used or not (`src/council/run-stage2-judge.js:172`), and a promoted defence's or re-vote's relaunch that produced nothing usable, stamped by `debate.js :: mk` (`src/council/debate.js:189`) off a transport mark `legRow` carries (`src/council/run-debate-revote.js:76-77`) and never copies onto the row. A relaunch that SUCCEEDS is not one of these rows: it becomes the rebuttal or revote row and supersedes the promoted first leg, as a successful repair does. The `-q<N>` id space is unchanged — the id says "a follow-up ask of this seat", the ROLE says which kind. Consumers: `ROLE_SUFFIX.relaunch` (`src/council/report-cost.js:43`) so the cost table cannot collide it with that model's own seat row; `LEDGER_JOIN_ROLES` untouched and fail-closed, so a relaunch row never joins the model-keyed ledger row (pinned, named mutant LEDGERRELAUNCHJOINS); `verdict-seats-reviewed.js :: isBenchRole` is an ALLOWLIST and excludes it by construction; `SEATS_PANEL_EXCLUDED_ROLES.relaunch` (`electron/workspace-ui/live-seats.js:74`) so the SAME launch, renamed, does not become a phantom seat row the Workspace panel never showed. (b) `conformance` is the ASKS-TO-PARSE axis and nothing else — `clean` = the first ask parsed, `repaired` = a later ask parsed, `unstructured` = no ask parsed — values UNCHANGED: a relaunch-rescued judge is `repaired` because a later ask parsed, a stood-down promoted judge is `unstructured` because none did, and the CAUSE lives on the row's `role`/`promoted` and in the note. (c) a rescued judge's ok:true entry carries `rescued: true` and `usedWaveId` and NEVER `fromReasoning: true` (`src/council/run-stage2-judge.js:257-258`); the judge row emits `rescued: true` through THE ONE row builder, in the slot between `promoted` and `usage` (`src/council/run-stats-entry.js:133`), which is the slot `tally.js:206`'s re-projection uses — so the tally-input row and the `tally.json` / `verdict.json` row are the same shape by construction rather than by agreement, and the marker TRAVELS (buildVerdict copies `runStats` verbatim), declared beside `promoted` at `schemas/council-tally.schema.json:118`. The rescued arm of the `judge-reasoning-only` note carries `relaunchWaveId` and `usedWaveId` in `data` (`src/council/run-stage2-notes.js:176`), emit-when-set, with `what` and `why` byte-unchanged; `leg` stays the attribution leg (#83). Named mutants RELAUNCHROLEREPAIR, DEBATERELAUNCHROLEREPAIR, RESCUEDMARKERDROPPED, USEDWAVEIDDROPPED, FROMREASONINGONRESCUED, RELAUNCHWAVEIDDROPPED, JUDGEROWRESCUEDDROPPED, RESCUEDNOTPROJECTED, RESCUEDORDERDRIFT, RELAUNCHSUFFIXDROPPED, RELAUNCHSEATPHANTOM. |
| D4 (contested, deepseek, 1-1-1) — two "contracts" for one key order | The comment invited the misreading: `leg-riders.js@1e929ccd:13-15` called the LEG DOCUMENT's rider order "the contract" while `run-stats-entry.js@1e929ccd:113` emits `promoted` after `ttftMs` in the runStats ROW — two projections with two orders, one of them claiming to be universal. | R-X45 (d): comment-only. `src/utils/leg-riders.js:13-17` now names WHOSE order it pins (the leg document's: `ttftMs, finish, variant, variantUnverified, backstop, promoted`) and says plainly that the runStats ROW is a separate projection with its own order (there `promoted` rides after `ttftMs` and before `usage`) — "neither order is the other's contract". No behaviour changed and no test moved. |
| D6 (minor, deepseek, 2-0-1) — a promoted repair supersedes real text, and R-X30 then writes no artifact for it, so the seat's real words are recorded nowhere | CONFIRMED: `run-debate.js@1e929ccd:92`'s bare `if (leg2) { … leg = leg2; }` made a PROMOTED repair the kept leg even when wave 1 had answered with real but unparseable prose; R-X30's skip (`src/council/run-launch.js:287`) then stood that leg's artifact down, so the real text reached no `rebuttal-<seat>.md`. `run-debate-revote.js@1e929ccd:177`'s bare `return leg2 ? …` was the same. | R-X46: a promoted repair never supersedes real text. The supersede arm now requires the retry leg to be REAL or the wave-1 leg to have been promoted itself — `leg2 && (!isPromotedLeg(leg2) || isPromotedLeg(leg))` at `src/council/run-debate.js:92` and `src/council/run-debate-revote.js:177` — so the wave-1 text stays the kept leg (`conformance: 'unstructured'`, its rebuttal artifact written as before), and the promoted repair is a `repair` row carrying `promoted: true` rather than a `superseded` row over text nobody will ever read. R-X36's rule applied to the debate: a `promoted: true` row is never the ONLY record of itself, so the round's one `debate-degraded` note NAMES every affected raiser and WHAT KIND of retry it was, via `promotedRepairClause` (`src/council/run-debate-stage.js:65`) appended to the unchanged head sentence `one or more defense or re-vote legs died or returned unstructured output`. The four shipped forms, byte-exact: `; <a>'s repair answered only in its reasoning channel` · `; the repairs of <a> and <b> answered only in their reasoning channels` · `; <a>'s relaunch answered only in its reasoning channel again` · `; the relaunches of <a> and <b> answered only in their reasoning channels again` (Oxford-free `a, b and c` beyond two; groups in first-appearance order; the kind read off the SAME mark `debate.js :: mk` stamps the role from, so the sentence and the row can never disagree). The list is deliberately NOT narrowed: a promoted retry that TIMED OUT lands in it too, and the clause is true of every member. The clause is the empty string for every other degraded round, so every other `why` is byte-identical. Named mutants DEFENSEPROMOTEDREPAIRSUPERSEDES, REVOTEPROMOTEDREPAIRSUPERSEDES, DEBATEPROMOTEDREPAIRSILENT, DEBATEPROMOTEDREPAIRUNNAMED, RELAUNCHCALLEDREPAIR, PROMOTEDKINDDROPPED. |
| D3 (major, deepseek, 2-1, gpt disputes; chair: deliberate) — a seat answering reasoning-only twice "silently" flips a run from exit 0 to exit 2 | This is round 3's C2 verbatim, and "silently" is refuted by measurement: the loss is announced on THREE surfaces — the seat-loss `Notice:` (`src/council/run-stages.js:118-131`), the `seatLoss` record when `--critic` was requested (`src/council/verdict-seat-loss.js:132-133`), and the `seatsReviewed` census in `verdict.json`. | R-X47: R-X40 stands, reaffirmed. A seat that answers reasoning-only on both asks is lost and the run exits 2, by design (owner decisions A and B) — the alternative is the disease. The operator's lever is the bench; the pre-flight or doctor warning that would name such a seat BEFORE the money is spent stays filed. Raised in rounds 3 and 4; the owner's reaffirmation is asked for at this round's presentation, with the recommendation that it stands. No code change. |
| **HQ1** — if `promoted: true` means "this seat failed to deliver a review" for a Stage-1 leg, how is a downstream consumer to read a RESCUED Stage-2 judge row carrying the same flag? | the question as asked | Answered the way Stage 1 already answers it, not by stretching a field: a row describes its LEG, and the `-s2` leg DID answer only in its reasoning channel, so `promoted: true` is true of it. What was missing is the SECOND fact — `rescued: true` beside it, emitted by the one row builder and travelling to `tally.json` and `verdict.json` (R-X45(c)) — and the rescue's own row, now named `relaunch` rather than `repair` (R-X45(a)). A consumer reads `promoted` WITH `rescued`: promoted alone is a judge that delivered nothing; promoted with rescued is a judge whose relaunch delivered. No field is made to mean two things. |
| **HQ2** — why fabricate and broadcast `(0 reasoning / 0 output tokens)` when the usage is genuinely missing, instead of omitting the clause? | the question as asked | Because a floor was written where a null belonged, and nothing pinned the difference. R-X44 removes the fabrication without taking the CAUSE with it (deepseek asked for the clause to be omitted entirely; R-X39 had already ruled the cause is never swallowed): the numbers are withheld and the sentence says `token usage not reported`. R-X44(b) makes it one rule for every formatter that quotes counts, pinned equal across the three homes; R-X44(c) makes it one PHYSICS rule, so the product's own all-zero totals read as the absence of observation they are. |
| **HQ3** — how can the `run-retry-notes.js` header declare a bounding invariant on all provider-controlled text while the templates beneath it interpolate `ff.reason` raw? | the question as asked | It could not; the header was true of the leg arms only, and the wave and missing arms were never swept (R-X38 enumerated five Stage-1 sites and stopped there). R-X42 closes it with ONE helper at every arm and a test that asserts the header's invariant directly — no `why` in any arm carries a newline or an escape — so the sentence in the header and the code beneath it are pinned to each other rather than merely co-located. |
| **HQ4** — if source-text negative assertions guard against prompt regression, how do they distinguish executable code from documentation explaining the design? | the question as asked | They did not, and round 4 measured the consequence: the pin that was supposed to guard R-X34 passed only because the phrase happened to wrap across two comment lines. R-X41 draws the line where the language does — `codeOnly` strips comments (string-aware, so a comment-opener shape inside a string literal cannot hide real code) and the assertion runs on what is left; a pin whose string is an identifier, a call, a property or a require path keeps the raw form on purpose, because a comment quoting exact executable syntax is the rare case and some of those pins (the require-free LEAF pins) are comment-inclusive BY DESIGN. |

Rulings, each with its cost if wrong:
- R-X41 **A source-text negative pin inspects code, not comments.** Cost: a comment-stripper that
  mis-parses could blind a pin — the walker is string-aware and its own test pins both the glob
  case it fixes and the regex-literal case it does not; no pin `codeOnly` is applied to today
  scans a regex literal.
- R-X42 **One helper bounds every prose interpolation of a reason.** Cost: a reason that was
  byte-identical before now collapses internal whitespace runs; every affected `why` is re-pinned
  and `data.reason` is unchanged.
- R-X43 **The operator's ambient flag is bounded before it is quoted, and tested on the raw
  bytes.** Cost: an exotic flag longer than 96 characters is shown truncated in prose (its raw
  value is in `data.reason` and in the engine's own environment), and a whitespace-padded value is
  quoted trimmed while still taking the "not a plain positive integer" arm — the arm is the truth
  about the engine's fallback, not about the quote.
- R-X44 **An unreported token count is `null`, never a fabricated 0 — in every formatter that
  quotes one.** Cost: a producer that stamps `{}` by mistake still announces a promoted seat (as
  R-X39 intends) but without counts; `data` carries nulls where it carried zeros. For R-X44(c):
  a provider that truly reported all-zero usage on a length stop (none known) would read as
  unreported.
- R-X45 **A relaunch is recorded as one, and a rescued judge says so.** Cost: a consumer that
  filters `role === 'repair'` misses relaunch rows — every consumer in `src/` AND `electron/` was
  grepped and updated in the same wave, the ledger join is fail-closed, and the tally schema is
  validated. `rescued` is additive on a row with no `additionalProperties: false`, so every
  document written before it still validates.
- R-X46 **A promoted repair never supersedes real text, and the note names whose retry it was.**
  Cost: a rebuttal artifact carries text that did not parse — it already did before #257, and the
  note now says so, by alias and by kind.
- R-X47 **R-X40 stands.** Cost: an operator pays for one wasted retry per run until they re-seat
  the model; the pre-flight warning that would have told them first is filed, not built.
