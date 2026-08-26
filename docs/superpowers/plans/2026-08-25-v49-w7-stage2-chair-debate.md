# v4.9 W7 — Stage-2, chair, and debate task forks — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** A task run's Stage-2 judges rank "which response best does the work", its chair
synthesizes an ANSWER (Converged | Split | Insufficient — closing #146's ask), and its debate
round speaks in claims — with review runs byte-identical everywhere.

**Architecture:** Mirrors W6: task templates in new sibling modules
(`briefings-stage2-task.js`, `briefings-chair-task.js`), thin intent dispatchers on the review
modules with lazy call-time requires, same-line swaps at the near-cap call sites. The chair
scale exists as TWO independent constants today (`briefings-chair.js:20`,
`parse-stage2.js:16`) — the ANSWER pair ships with a drift pin over BOTH pairs (memo trap 2).
Debate twins go in-file (`briefings-debate.js` is 178/300 — room; the builders gain an
`intent` arg defaulting review).

**Tech Stack:** Node 22, Jest.

**Spec:** v4.8 design spec §5.4-§5.5 + memo rulings V2 (fork debate), V3 (answer lands in the
existing artifacts), V4 (ANSWER scale + lockstep), V11 (labels/section headers stay shared —
one vocabulary; record any extension of that ruling you make).

## Global Constraints

- Review-run byte identity for every composed prompt and parsed value (existing pins + new
  absence pins). `run-chair.js` is 296/300 — its swaps must be NET 0 (dispatch pushed into
  parse-stage2/briefings dispatchers, mode-ternary inside existing template literals).
- `ANSWER:` and `VERDICT:` are disjoint by construction — pin both directions
  (parseChairVerdict null on ANSWER text; parseChairAnswer null on VERDICT text).
- No git mutations by implementers; focused suites only, `--maxWorkers=2`; sizes gate clean.

---

### Task T-A: the chair surface (#146)

**Files:** Create `src/council/briefings-chair-task.js`,
`tests/council/briefings-chair-task.test.js`, `tests/council/chair-scale-drift.test.js`;
Modify `src/council/parse-stage2.js`, `src/council/briefings-chair.js` (dispatchers + packet
intent), `src/council/run-chair.js` (net-0 swaps), `src/council/run-assemble.js`
(`buildChairPacketFile` reads intent off the record's meta — no signature change),
`schemas/council-verdict.schema.json` (IF `overallVerdict` is enum-pinned — measure first),
`tests/council/run-chair.test.js` (+ e2e task pins).
**Interfaces (produced):**
- `briefings-chair-task.js`: `CHAIR_ANSWER_VALUES = ['Converged', 'Split', 'Insufficient']`,
  `ANSWER_SCALE_ADDENDUM`, `TASK_CHAIR_SYNTHESIS`, `TASK_CHAIR_SYNTHESIS_NO_CLAIMS`,
  `buildTaskChairRepairPrompt({synthesis})`, `TASK_CONCURRENCE_CAVEAT`.
- `parse-stage2.js`: `CHAIR_ANSWERS` (independent spelling, drift-pinned),
  `parseChairAnswer(text)` (mirror of `parseChairVerdict`: last matching `^ANSWER:` line,
  prefix-anchored, canonical phrase returned), and
  `parseChairTerminal(text, intent)` → task ? parseChairAnswer : parseChairVerdict.
- `briefings-chair.js`: `buildChairPacket` gains optional `intent` on its args (absent =
  review, byte-identical — pin); `chairRepairPromptFor(intent, args)` dispatcher
  (lazy-requires the task module).

- [ ] Texts (exact; adjust only on validator/parser contradiction, and report):
  - `TASK_CHAIR_SYNTHESIS`: `'You are the council chair. Write the synthesized ANSWER across
    the responses, rankings, and adjudications below: adopt the strongest response, merge
    complementary ones, or refuse the premise if the bench showed it unsound. State the
    consensus, the disagreements and which way they went, and close the synthesis with a
    RESIDUAL RISK section — the claims peers disputed that your answer still depends on.'`
  - `TASK_CHAIR_SYNTHESIS_NO_CLAIMS` (bench declared no adjudicable claims — the LC-10-shaped
    twin): chair synthesizes across responses and rankings, told plainly that declaring no
    discrete claims is a valid outcome, and not to manufacture disputes.
  - `TASK_CONCURRENCE_CAVEAT` (pushed into the packet when intent==='task', after the
    adjudications section, R8-style placement): `'Peer agreement on a claim is CONCURRENCE,
    not verification — models correlate on priors. Weigh adjudications accordingly.'`
  - `ANSWER_SCALE_ADDENDUM`: keep the HARD QUESTIONS section verbatim from
    `VERDICT_SCALE_ADDENDUM`, then: a final line, alone, exactly one of `ANSWER: Converged` /
    `ANSWER: Split` / `ANSWER: Insufficient`, with: `'"Converged" = the bench substantially
    agrees and the synthesis above is well-supported. "Split" = material disagreement
    remains; the synthesis states both positions and what would settle them. "Insufficient" =
    the bench's work cannot support an answer — missing information, an unsound premise, or
    too little usable output. Name which, in the synthesis ABOVE, not on the ANSWER line.'`
  - `buildTaskChairRepairPrompt`: mirror `buildChairRepairPrompt` byte-structure (LC-12:
    synthesis rides along), final lines listing the three `ANSWER:` phrases.
- [ ] `buildChairPacket` intent forks ONLY: the synthesis instruction (task pair replaces
  CHAIR_TASK/CHAIR_TASK_NO_FINDINGS), the scale addendum, the no-tools preamble's last word
  (`'begin immediately with the verdict.'` → task: `'…with the answer.'` — mode-ternary on
  the same pushed string), and the concurrence caveat push. Section headers and
  `Review by`/`Review <letter>` labels stay shared (V11 — record the extension in the
  module docblock).
- [ ] `run-chair.js` net-0 swaps: both `parseChairVerdict(…)` sites →
  `parseChairTerminal(…, o.intent)`; the ch4 prompt → `chairRepairPromptFor(o.intent, {…})`;
  the chair-failed `why` → `` `…no parseable ${o.intent === 'task' ? 'ANSWER' : 'VERDICT'}: line` ``
  on the same line. Verify 296/300 unchanged.
- [ ] `run-assemble.js :: buildChairPacketFile`: pass `intent` from the record's meta
  (emit-when-task convention: absent = review).
- [ ] Schema: measure whether `council-verdict.schema.json` enum-pins `overallVerdict`; if
  yes, widen to the six-value union (RED-first). Also grep every `overallVerdict` consumer
  for literal comparisons (spec claims none; verify at this tree, list what you find).
- [ ] Pins: parseChairAnswer unit family mirroring parseChairVerdict's; BOTH disjointness
  directions; the two-pair drift test (`CHAIR_VERDICT_VALUES` ≡ `CHAIR_VERDICTS`,
  `CHAIR_ANSWER_VALUES` ≡ `CHAIR_ANSWERS`); task packet pins (ANSWER addendum present,
  VERDICT addendum absent, caveat present, RESIDUAL RISK instruction present); review packet
  byte-identity; e2e through the real `runChair`: task chair emitting `ANSWER: Converged` →
  `overallVerdict === 'Converged'`, `chairConformance 'clean'`; task chair missing the line →
  ch4 repair prompt asks for ANSWER phrases; named mutant `ANSWERSCALEDRIFT` (skew one copy
  of the ANSWER constants) — red set recorded, reverted byte-exact.

### Task T-B: the judge bundle

**Files:** Create `src/council/briefings-stage2-task.js`,
`tests/council/briefings-stage2-task.test.js`; Modify `src/council/briefings-stage2.js`
(dispatcher `judgeBundleFor(intent, args)`), `src/council/run-stage2.js` (bundle call swap),
existing stage-2 suites for absence pins.
**Interfaces:** `buildTaskJudgeBundle({reviews, findings, date, briefing})` — note the EXTRA
`briefing` arg (spec §5.4: task judges see the briefing; review judges never do).
- [ ] Texts: frame `'You are judging the anonymized peer responses below. Each was produced
  independently against the same briefing, which is included at the end.'`; Task A rank:
  `'order the responses from the one that best does the work the briefing asked for to the
  one that does it least well'`; Task B adjudicate: `'for EVERY claim id in the index, judge
  whether the claim holds: agree / dispute / neutral'`; no-claims twins of
  `JUDGE_TASK_B_NO_FINDINGS`/`NO_FINDINGS_INDEX` in claims wording; bundle tail section
  `'--- THE BRIEFING (what every response was asked to do) ---'`. `JUDGE_OUTPUT_CONTRACT`
  and the `Review <letter>` label vocabulary stay shared (V11).
- [ ] `run-stage2.js`: the bundle build threads intent + the briefing (available on ctx.o —
  measure which field carries the composed briefing text and thread THAT; never re-read
  disk). Judge repair prompt rides the shared contract — verify, don't fork.
  *(OVERTURNED by measurement in the review-fix round, 2026-08-25: the repair prompt embeds
  the ranking bullet, so once the contract forked (review F1) the repair had to fork with it
  — `judgeRepairPromptFor(intent, …)` shipped; a task judge was otherwise re-prompted on the
  review axis in up to 2 paid solos.)*
- [ ] Pins: task bundle contains the briefing tail + rank/adjudicate task wordings; REVIEW
  bundle contains NO briefing (the anonymity-narrowing pin the spec says never existed —
  write it now); labels shared; parse path unchanged (parseJudgeOutput untouched); named
  mutant `TASKBUNDLENOBRIEF` (drop the briefing tail from the task bundle) — red set.

### Task T-C: the debate twins (V2)

**Files:** Modify `src/council/briefings-debate.js` (in-file task variants; builders gain
`intent` arg defaulting review), `src/council/run-debate.js` + `src/council/run-debate-revote.js`
(thread `ctx.o.intent` at the two dispatch sites), their suites.
- [ ] Texts: defense — `'You produced an answer and declared the claims below as load-bearing.
  Peer analysts (anonymous) disputed them. For each claim: defend it with your strongest
  argument, amend it if the dispute exposed a real flaw, or withdraw it.'` (mirror the review
  brief's structure/actions verbatim — same actions, same JSON contract). Revote bundle —
  `'You previously adjudicated claims from this bench's answers and disputed at least one of
  those below. The raiser has now responded. Re-vote each claim: agree / dispute / neutral.'`
  (again mirroring the review structure). Repair prompts ride the shared `repair()` — verify.
- [ ] Byte-identity: review-path defense/revote briefs unchanged (existing pins + absence
  pins); parsers frame-neutral (no edits).
- [ ] Pins: task defense/revote wording present under intent 'task', review wording under
  absent; e2e: a task run with `--debate` composes task-framed defense + revote briefs (drive
  `runDefenseWave`/`runRevoteWave` with stubbed launchers, house style); named mutant
  `TASKDEBATEDROP` (defense builder ignores intent) — red set.

### Task T-D (lead): wave gates
- [ ] Full `npm test` tail -10, lint, sizes, citations, docs check; three-axis sweep
  (fragment grep); commit.
