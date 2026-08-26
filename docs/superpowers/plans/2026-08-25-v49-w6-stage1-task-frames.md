# v4.9 W6 — Stage-1 task frames — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** A task-intent run composes task-framed Stage-1 briefings at every dispatch site —
seat, critic, lens, the retry re-brief, the on-disk `briefing-stage1.md`, and the findings
repair prompt — while review runs stay byte-identical.

**Architecture:** One new module `src/council/briefings-task.js` holds every task twin;
`briefings.js` gains thin per-surface dispatchers (`stage1SeatBriefing(intent, args)` etc.)
that lazy-require the task module at call time (load-acyclic: briefings-task top-requires
briefings for the shared skeleton; briefings never top-requires briefings-task). Call sites
swap `briefings.buildXxx(args)` → `briefings.stage1Xxx(o.intent, args)` — same line counts,
which is what keeps `run.js` at its 300/300 ceiling untouched net.

**Tech Stack:** Node 22, Jest.

**Spec:** v4.8 design spec §5.1-§5.3 (CUT 1, CUT 2, KEEP) + phasing memo §2 rulings V10, V13
+ the converged surface map. `findings.js` changes by ZERO lines (CUT 1/2) — the validator,
the repair count contract, and `SEVERITIES` are shared verbatim across modes.

## Global Constraints

- Review-run byte identity for every composed prompt (existing suites + explicit pins).
- The `--- MATERIAL / BRIEFING ---` separator is a PRODUCTION contract
  (`src/sidecar/list-search.js:14` reads `briefing-stage1.md` post-separator) — the task
  composition must share the same skeleton constant, pinned byte-identical.
- `run.js` is 300/300 and `run-stages.js` 294/300: call-site swaps must be net ≤ 0 lines in
  those files (dispatcher-swap on the same lines).
- No `git add -A`; no git mutations by implementers; focused suites only, `--maxWorkers=2`.

---

### Task A: `briefings-task.js` + dispatchers in `briefings.js`

**Files:** Create `src/council/briefings-task.js`; Modify `src/council/briefings.js`;
Create `tests/council/briefings-task.test.js`.
**Interfaces (produced, exact):**
- `briefings-task.js` exports: `TASK_ANTI_SYCOPHANCY_CLAUSE`, `TASK_FINDINGS_JSON_SHAPE`,
  `TASK_FINDINGS_CONTRACT`, `buildTaskSeatBriefing(args)`, `buildTaskCriticBriefing(args)`,
  `buildTaskLensBriefing({lens, briefing, date})`, `buildTaskFindingsRepairPrompt({errors, review})`.
- `briefings.js` additionally exports: `stage1SeatBriefing(intent, args)`,
  `stage1CriticBriefing(intent, args)`, `stage1LensBriefing(intent, args)`,
  `stage1RepairPrompt(intent, args)` — each `intent === 'task'
  ? require('./briefings-task').buildTaskXxx(args) : buildXxx(args)` (lazy call-time require),
  plus `composeWith(role, clause, contract, args)` (the generalized internal skeleton —
  `compose` becomes a delegating wrapper so the review path is byte-identical by construction).

- [ ] Refactor `briefings.js :: compose` → internal
  `composeWith(role, clause, contract, { briefing, date })` joining
  `[role, clause, dateLine(date), contract, '--- MATERIAL / BRIEFING ---', briefing]`;
  `compose(role, args)` delegates with `ANTI_SYCOPHANCY_CLAUSE, FINDINGS_CONTRACT`. Run the
  existing briefings suites — byte-identity proof, zero pin edits expected.
- [ ] Write `briefings-task.js` with these exact texts (refine wording only where a text
  contradicts the validator — never the structure):
  - Seat role: `'You are one analyst on an independent multi-model bench. Do the work the '
    + 'briefing below asks for: produce the analysis, answer, or artifact it requests — you '
    + 'are not reviewing the briefing, you are executing it. Another analyst is doing the '
    + 'same work independently.'`
  - `TASK_ANTI_SYCOPHANCY_CLAUSE`: `'Do not hedge to be agreeable. Lead with your strongest '
    + 'position and show why it holds. Never perform confidence you don\\'t hold — where the '
    + 'evidence is thin, say so and mark the claim an assumption. Do not pad: state every '
    + 'load-bearing claim and no invented ones. An empty claims list under a real answer is '
    + 'a valid result.'`
  - `TASK_TWO_PART_FRAMING` (internal): lines `'Produce exactly two things, in this order:'`,
    `''`, `'1. Your deliverable — the full analysis, answer, or artifact the briefing asks for.'`,
    `'2. A trailing fenced ```json block immediately after it — no text after it:'`
  - `TASK_FINDINGS_JSON_SHAPE`: same JSON skeleton as the review shape (same keys, same
    example), glosses swapped:
    `'- "overall" — your answer, compressed to one paragraph: the position your deliverable takes. Always required.'`
    `'- "findings" — the load-bearing claims your deliverable rests on, always present. If the'`
    `'  reasoning is fully inline and no discrete claim needs adjudication, emit [] and say so'`
    `'  in "overall". Never invent a claim to fill the array.'`
    `'- "id" — sequential integer within this response, starting at 1.'`
    `'- "severity" — one of: blocker | major | minor | nit. blocker = the answer fails if this'`
    `'  claim is wrong; major = materially weakens it; minor = adjusts a detail; nit = cosmetic.'`
    `'- "claim", "location", "rationale" — non-empty strings. "location" names what the claim'`
    `'  rests on: a source, a computation, or the literal word "assumption".'`
    `'Emit the JSON verbatim after the deliverable, without preamble, so it parses cleanly.'`
  - Critic brief (V13), four passes over generative work: assumption hunt (what will the
    other analysts take as given that is contestable — for every likely premise, what
    evidence supports it), edge-case hunt (where does the asked-for work break: unexpected
    input, the degenerate case, at zero, at one, at scale), framing check (is the briefing's
    own framing the right question — what is it not asking that it should), actionability
    test (what would someone acting on the likely answers need that they won't have). Close
    with the be-specific + empty-pass-valid lines, reworded for claims.
  - Lens: `'Do the work the briefing asks for strictly through the lens of a ${lens}. '
    + 'Produce only what that perspective is qualified to produce, at the depth a top '
    + 'practitioner of it would reach. Stay in-domain: if something matters but is outside '
    + 'your lens, leave it to the other analysts.'`
  - Repair prompt: mirror `buildFindingsRepairPrompt`'s structure exactly (LC-6/LC-10
    lessons carry): `'--- YOUR PREVIOUS RESPONSE (verbatim — this is the text to correct) ---'`,
    empty-case branch `'Your previous response was empty — there is no prior text to correct. '
    + 'Do not invent claims to satisfy the schema: emit an empty "findings" array and say so '
    + 'in "overall".'`, error list, `'Re-emit ONLY the corrected findings JSON block (the same '
    + 'claims, fixed — do not add or remove claims), as a single fenced ```json block:'`,
    then `TASK_FINDINGS_JSON_SHAPE`.
- [ ] Add the four dispatchers to `briefings.js` exports.
- [ ] Tests (`briefings-task.test.js`): (1) every task builder's output contains its role/
  framing lines and the byte-identical `--- MATERIAL / BRIEFING ---` separator (pin against
  the same string `list-search.js` uses); (2) the task shape keeps the SAME JSON skeleton keys
  and the severity enum verbatim (`blocker | major | minor | nit` — CUT 1); (3) empty-set
  validity gloss present in shape AND repair empty-branch (LC-10 parity); (4) a composed task
  seat brief validates round-trip: feed a synthetic response with the task shape through the
  REAL `validateFindings` (findings.js untouched) — proves CUT 2; (5) dispatcher contract:
  `stage1SeatBriefing(undefined, args)` byte-equals `buildSeatBriefing(args)`; `('task', …)`
  equals the task builder; same for critic/lens/repair.

### Task B: call-site swaps + end-to-end dispatch pins

**Files:** Modify `src/council/run-stage1-launch.js` (three dispatches),
`src/council/run-retry-launch.js` (`briefingFor` — three branches),
`src/council/run.js` (the `briefing-stage1.md` write — dispatcher swap, NET 0),
`src/council/run-stages.js` (the repair-prompt call — dispatcher swap, NET ≤ 0);
Test: `tests/council/run-stage1-task-dispatch.test.js` (new) + existing launch/retry suites.
**Interfaces:** Consumes Task A's dispatchers exactly as named.
- [ ] Swap each site to `briefings.stage1Xxx(o.intent, {...same args})`. In
  `run-retry-launch.js :: briefingFor`, thread `o.intent` into all THREE branches (critic,
  lens, seat) — the spec's "a retried task seat is re-briefed as a reviewer" failure.
- [ ] Verify net line counts: `run.js` stays exactly 300; `run-stages.js` ≤ 294. Run
  `node scripts/check-file-sizes.js`.
- [ ] Dispatch pins (drive the real modules with a stubbed launcher, house style from the
  existing launch tests): (1) task run → the `-s1` wave prompt, the critic solo prompt, the
  lens solo prompts, and `briefing-stage1.md` all open with the task frames; (2) review run →
  all byte-identical to pre-W6 (fixture-compare against the review builders directly);
  (3) the RETRY path: a task run's retried seat/critic/lens re-brief uses the task frames
  (RED-first: write against the un-threaded `briefingFor` and watch it compose review text);
  (4) `briefing-stage1.md` still splits on `--- MATERIAL / BRIEFING ---`
  (`list-search`-shape pin).
- [ ] Named mutant `TASKFRAMEDROP`: make `stage1SeatBriefing` ignore intent (always review).
  Record the red set across the new pins; revert byte-exact.

### Task C (lead): wave gates
- [ ] Full `npm test` (tail -10), lint, sizes, citations, docs check; three-axis sweep;
  commit `feat(v4.9 W6): Stage-1 task frames — every dispatch site forks on intent`.
