# The busy-aware no-output backstop (#251 item 1) — design

Issue #251 item 1, as re-specified by the Wave 2 and Wave 3.0 measurements (2026-09-17) and ruled by
the owner on 2026-09-18. Closes #135 when it ships (owner ruling, 2026-09-18). Baseline: `main` @
`a74ed58c` (v4.12.0 + PR #266 + PR #268, unreleased).

## 0. Vocabulary

- **The backstop** — `src/utils/no-output-backstop.js :: createNoOutputBackstop`, a loop-driven state
  machine (`armed → disarmed | fired`) that the poll loop in `src/headless.js :: runHeadless` ticks once
  per poll with `substantiveActivity` (output, reasoning or tool motion). Its **window** is
  `noOutputBackstopMs`: the env default `AMICUS_NO_OUTPUT_BACKSTOP_MS` (300 000 ms) or a caller-set
  value (CI sets 480 000 ms; the Stage-1 retry passes the escalated window; the live model probe passes
  30 000 ms).
- **The two firing sites** — the pre-send site (`headless.js`, the `withTimeout(sendPromptPromise, …)`
  catch: the engine never returned from the prompt-send call) and the poll-loop site (`headless.js`,
  `noOutputBackstop.tick(substantiveActivity, Date.now()) === 'fired'`).
- **The leg cap** — `timeoutMs`, runHeadless's sixth argument: `(o.timeout || 15) × 60 000` for
  council legs (CI `--timeout 16` = 960 000 ms).
- **The status probe** — `headless.js :: sessionStatusSafe(readStatus, client, sessionId, dirArgs, ms)`:
  one bounded (`STATUS_PROBE_MS` = 5 000 ms) read of the engine's `session.status`, returning either a
  renderable engine `SessionStatus` (`{type:'idle'} | {type:'busy'} | {type:'retry', attempt, message,
  next}`) or a `probeUnknown('skipped'|'failed'|'no-status', detail)` outcome marked by a module-private
  Symbol (`src/utils/session-status.js`). It cannot throw or hang.
- **The retry window** — `src/council/run-retry-window.js :: retryBackstopMs(base, legTimeoutMs)` =
  `min(2 × base, floor(0.95 × legTimeoutMs))`: the window a relaunched Stage-1 seat gets (CI: 912 000 ms).
- **The death report** — the leg's `error` string, `NO_OUTPUT_BACKSTOP: no output, reasoning, or tool
  calls in Ns — <window phrase>` followed by up to three append-only clauses: ` — engine log: …`,
  ` (engine skew: …)`, ` (session: …)`. `src/sidecar/models-probe.js` classifies on the prefix only.

## 1. Problem, as measured

- **Every backstop kill on the published 4.12.0 build reports `(session: busy)`** — 6 of 6 across PR
  #266 rounds 2–3 (runs 35296348847, 35301412453): qwen 480 722 ms, deepseek 480 487 ms and 913 904 ms
  (round 2); glm, qwen, deepseek all at ~481 s (round 3). By the engine's contract `busy` means an open,
  active provider request at the moment of the kill: not a refusal (`retry`), not an engine that believes
  it is done (`idle`), not a probe that could not answer (`unknown`).
- **The retry heals most of them, with first tokens the first attempt would have produced had it been
  allowed to.** Round 3's three dead seats healed with TTFT 28 s, 133 s and 503 s — the last past the
  480 s wall and inside the 912 s retry window. Round 2's qwen retry spoke at 380 s; PR #250's qwen retry
  at 575 s. Survivors on the same rounds first spoke at 438 s, 391 s, 424 s, 468 s (12 s of margin).
- **Both faces exist.** deepseek (round 2) was busy at 480 s and still busy at 914 s: an extension to the
  cap would have burnt 960 s and lost the seat anyway. So the extension is bounded, once, and recorded —
  the next corpus must be able to count how many kills it saved and how many it only delayed.
- **`k × input` is dead** (Wave 2, 27 sets / 295 legs / 57 kills): k = 1.58 ms/token pooled, 0.170 on
  Stage-1 first attempts; an input-derived window never binds against the 480 s floor. Item 2 is dropped;
  item 1 is the whole lever.
- **The poll loop already consults `session.status` — but only when `mirror.output.length > 0`**
  (`headless.js`, the busy/retry veto of the stable-idle heuristic and `RETRY_BEYOND_DEADLINE`, spec
  2026-09-11 §3). A zero-output leg reaches the kill without that read, and the kill-time read that
  exists (`noOutputBackstopReason`) is consulted for the REPORT, never for the DECISION.
- **Cost of the class:** a judge death is final (judges are never retried); a Stage-1 double death loses
  the seat; PR #266 round 2 and PR #250 round 2 were adjudicated on 3-of-4 benches for this reason.

## 2. Decisions taken (owner, 2026-09-18)

1. **Consult the session before the kill, and extend once on `busy` or `retry`.** The status read
   moves ahead of the kill at the poll-loop firing site; a busy or retrying session gets one more window.
2. **Never extend on `unknown`.** A probe that timed out, failed, was skipped, or got no status is not
   evidence about the session (#219). `idle` is not extended either — the engine believes it is done.
3. **Cap at the leg cap.** The extended deadline never reaches `timeoutMs`; the named diagnosis
   (`NO_OUTPUT_BACKSTOP`, not a generic `timeout`) must survive.
4. **Record which case each kill was**, so the next corpus can size the extension honestly.

## 3. The mechanism — the poll-loop firing site

At the tick where the backstop reports `fired`, before anything is killed:

1. Read the status once: `status = await sessionStatusSafe(getSessionStatus, client, sessionId,
   dirArgs, statusProbeMs)`.
2. Compute the extension target: `extendedMs = extendWindowMs(noOutputBackstopMs, timeoutMs)` (§4) and
   `extendedDeadline = outputClockStartedAt + extendedMs` (the backstop's own clock origin,
   `headless.js`, `const outputClockStartedAt = Date.now()` just before the backstop is created).
3. Decide by this table. `type` is `status.type`; "probe outcome" is `isProbeOutcome(status)`.

| status at the fired tick | room to extend? | action |
|---|---|---|
| `busy` (engine) | yes | **extend once**: `noOutputBackstop.extend(extendedDeadline)`, record, keep polling |
| `retry` (engine), `next` not finite or `next <= extendedDeadline` | yes | **extend once**, same as busy |
| `retry` (engine), `next > extendedDeadline` | — | kill now; record `why: 'retry-beyond-window'` |
| `busy` / `retry` (engine) | no — `extendedMs <= noOutputBackstopMs` (window already at the clamp) | kill now; record `why: 'at-cap'` |
| `busy` / `retry` (engine) | no — already extended once | kill now; the record already says `extended: true` |
| `idle` (engine) | — | kill now (unchanged) |
| probe outcome (`unknown — probe skipped/failed/no-status`) | — | kill now (unchanged; decision 2) |
| any other renderable engine type | — | kill now (unchanged) — an arm this code does not know is not evidence of life |

"Room to extend" is exactly `!extendedOnce && extendedMs > noOutputBackstopMs`. The `extend` call is
the ONLY way a `fired` backstop re-arms; progress still disarms it permanently; a second `fired` kills.

4. On **extend**: `logger.warn('No-output backstop extended once on session status', { taskId,
   sessionId, status: type, fromMs: noOutputBackstopMs, toMs: extendedMs, atMs })` and the record (§5.2)
   is set. No stderr line — the extension is not a degrade, and the death report or the surviving leg's
   record carries it.
5. On **kill**: exactly today's path (`backstopFired = true`, `sessionError = await
   noOutputBackstopReason(…)`, break, abort the session), with two differences: the reason closure takes
   the status ALREADY READ for the decision (one HTTP call, not two) plus the record, and the reason string
   gains the §5.1 clause when the record has something to say.
6. After an extension the leg is an ordinary living leg: the TTFT stamp, the idle/finished exits, the
   tool-stall detector, the leg cap — all unchanged. If it dies at the extended deadline the status is
   read afresh for the report (the decision is not re-run: once means once).

**The pre-send firing site is unchanged** (ruling R3): the prompt-send call itself never returned, which
is engine-side; the session may not have accepted the prompt at all. It kills at the window with today's
byte-identical string and records `why: 'pre-send'`.

**The `mirror.output.length > 0` gate on the poll loop's own status read is untouched** (spec 2026-09-11
§3 — it stops a pre-processing `idle` from ending a run early). This design adds a read at one instant
only: the fired tick of a zero-output leg.

## 4. The extension window — one formula, one home

`extendWindowMs(baseMs, legTimeoutMs) = Math.min(2 * baseMs, Math.floor(legTimeoutMs * 0.95))` — the
retry window's formula, verbatim, moved to `src/utils/no-output-backstop.js` and re-exported by
`src/council/run-retry-window.js` as `retryBackstopMs` (the SAME function object; a test asserts
identity, not equivalence). Reasons, all inherited from #219's measurement in `run-retry-window.js`:
doubled because a latency failure is structurally unhealable by repeating the window; clamped STRICTLY
below the cap so the backstop still fires first and the named diagnosis survives; `2 × 0 = 0` still
disables.

Worked values (measured configurations):

| leg | base | leg cap | extended | room? |
|---|---|---|---|---|
| CI Stage-1 first attempt, CI judge | 480 000 | 960 000 | 912 000 | yes (+432 s) |
| CI Stage-1 retry (already `retryBackstopMs`) | 912 000 | 960 000 | 912 000 | **no → `at-cap`** |
| local default (`--timeout 15`) | 300 000 | 900 000 | 600 000 | yes |
| live model probe (`models --check --live`) | 30 000 | 120 000 | 60 000 | yes (ruling R8) |
| `AMICUS_NO_OUTPUT_BACKSTOP_MS=0` | 0 | any | 0 | never arms — unchanged |

The CI worst-case pin (`tests/scripts/council-review-workflow.test.js`, `worstCaseMs = legCap +
min(2 × noOutput, floor(legCap × 0.95)) + 2 × legCap`) is UNCHANGED by this design: its first term is
already the leg cap (a streaming first attempt was never bounded by the backstop — #219's correction),
and an extended silent first attempt (912 s) is below it. The retry leg cannot extend in CI. Nothing in
this design moves any CI timing value.

## 5. The record

### 5.1 The death report — one appended clause, byte-identical otherwise

The head sentence and the three existing clauses keep their bytes and order (engine log → skew →
session). When the decision produced a record with something to say, ONE clause is appended after the
session clause, in exactly one of these forms (seconds are integers, `Math.round(ms / 1000)`):

- extended, then died: ` — window extended once from 480s to 912s at 481s on session busy`
  (`busy` or `retry`, the status at the extension)
- busy/retry but the window was already at the clamp: ` — not extended: the window is already at the
  leg cap`
- retry whose next attempt lies past the extended window: ` — not extended: the engine schedules its
  next attempt at 2026-09-18T12:34:56.000Z, past the extended window`

`idle`, probe outcomes, unknown arms and the pre-send site append NOTHING — those strings are
byte-identical to 4.12.0's. The head sentence's `in Ns` reports the window IN FORCE at the kill (912 s
after an extension), because "no output in 480 s" would be false for a leg that was silent for 912.
The window phrase (`the AMICUS_NO_OUTPUT_BACKSTOP_MS window (0 disables)` / `a caller-set window
overriding …`) is unchanged; after an extension the clause is what says the window was 480 s.

The clause is rendered by a pure `formatBackstopExtensionClause(record)` in
`src/utils/no-output-backstop.js`, composed by `headless.js :: formatNoOutputBackstopReason` through a
new optional `extension` field. Untrusted text never enters it: every value is a number amicus measured,
a status TYPE identifier already sanitised by `isRenderableStatus`, or an ISO timestamp amicus formatted.

### 5.2 The leg record — a `backstop` field, emit-when-set

Set on the runHeadless result whenever the poll-loop firing site made a decision, or the pre-send site
fired. Absent on every leg the backstop never fired for — byte-identical documents.

```js
backstop: {
  windowMs: 480000,      // the window in force at the FIRST firing (integer ≥ 0)
  firedAtMs: 480722,     // elapsed on the backstop's clock at that firing (integer ≥ 0)
  status: 'busy',        // decision input as a type identifier: 'busy' | 'idle' | 'retry' |
                         // 'unknown' (any probe outcome) | <other engine type, sanitised>
  extended: true,        // whether the window was extended
  extendedToMs: 912000,  // only when extended
  why: 'at-cap',         // only when NOT extended for a reason other than the status:
                         // 'at-cap' | 'retry-beyond-window' | 'pre-send'
  retryNextIso: '2026-09-18T12:34:56.000Z', // only with why 'retry-beyond-window': the engine's `next`
}
```

The decision itself is a pure function, `decideBackstopExtension({ status, windowMs, firedAtMs,
legTimeoutMs, clockStartedAt }) → { extendTo: number|null, record }`, in
`src/utils/no-output-backstop.js`, so the table in §3 is tested row by row without driving the poll
loop; `headless.js` only calls it, applies `extendTo` to the backstop, and keeps the record. It
classifies on the RAW `status.type` and records the SANITISED identifier (the #219 r2 rule in
`session-status.js`); a probe outcome records `'unknown'`.

A **surviving** leg that was extended and then spoke carries the same object (`extended: true`) beside
its `ttftMs` — that pair is the direct count of legs the extension saved, which is the measurement the
owner asked for. The shape is validated by one exported predicate, `isBackstopRecord(x)`, used by every
writer below (a forged or partial object is dropped, never coerced).

**Writers — every terminal write of a leg document (failure mode #19):**

The set was MEASURED by grepping every writer of `finish`, the last field added to these documents
(`grep -rn '\.finish\b\|finish:' src/sidecar src/session-manager.js`): nine sites in six files, plus
the runHeadless returns. One rule everywhere: **set when `isBackstopRecord(result.backstop)`, otherwise
delete the key** (a stale record from a previous attempt must never ride a new one — the same
delete-when-absent rule `finish` and `variant` follow, council #232 r1 B1).

| document | writer (the `finish` line's sibling) | change |
|---|---|---|
| runHeadless result | `src/headless.js` — the `failedWithNoUsableOutput` return, the success return, the outer `catch` return | `...(isBackstopRecord(backstopRecord) ? { backstop: backstopRecord } : {})` beside `ttftMs` |
| council / fanout leg document + wave doc | `src/sidecar/fanout-leg.js` (`legPatch`, the `finish:` line) | `backstop: (result && isBackstopRecord(result.backstop)) ? result.backstop : undefined` |
| every `finalizeSession` caller (complete / timed-out / aborted) | `src/sidecar/session-utils.js :: finalizeSession` (the `opts.finish` line) | `opts.backstop` set-or-delete on `metadata` |
| shared-server error branch | `src/sidecar/session-finalize.js :: finalizeHeadlessResult` (the `metadata.finish` line) + its `finalizeSession` opts | `stampBackstop(metadata, result)`; `backstop: result && result.backstop` in the opts |
| `start` error branch + opts | `src/sidecar/start.js` (`meta.finish`, and the `finalizeSession` opts) | same |
| `continue` error branch + opts | `src/sidecar/continue.js` (`meta.finish`, and the `finalizeSession` opts) | same |
| `resume` reopen + error branch + opts | `src/sidecar/resume.js` (the `delete meta.finish; …` line on reopen; `updatedMetadata.finish`; the opts) | `delete meta.backstop` joins the reopen line; same stamp; same opts |

`stampBackstop(meta, result)` is one exported helper in `session-finalize.js` (set-or-delete), so the
four error branches share one implementation instead of four copies (failure mode #11: one shared
implementation, not a second patch at a second site).

**Deliberately NOT reached** (rulings R5, R6): `src/utils/result-schema.js :: buildRunResult` (the file
is 300/300; the solo `read` surface carries the case in the reason string), the runStats projection
(`run-stats-entry.js`, `tally.js`, `verdict.json`) and the spend ledger (`appendSpend` callers in
`start.js`, `fanout-leg-fallback.js`, `reopen-spend.js`). The corpus that sizes the extension is built
from leg documents and `run.json` degrade notes (`data.reason` carries the whole reason string), exactly
as Wave 2's was.

## 6. What does not change — the fences

- The backstop still arms at leg launch, still disarms permanently on the first substantive tick, still
  fires before the leg cap, still reports only what it observed. `fired` is terminal FOR TICKS; only
  `extend()` re-arms it, at most once.
- `ttftMs` is still the disarm moment; a leg saved by the extension records a TTFT larger than its
  original window, which is how the saving is visible.
- The `NO_OUTPUT_BACKSTOP:` prefix, the classification in `models-probe.js`, the dead-leg prose in
  `run-retry-notes.js` (it renders `leg.error` verbatim and compares first/retry reasons trimmed) — all
  unchanged. A retry that dies `at-cap` now carries a different string from its first attempt, so the
  retry note will render both reasons; that is more information, not a regression.
- The Stage-1 retry still gets `retryBackstopMs` (same number as today); the CI worst case is unchanged
  (§4); `RETRY_BEYOND_DEADLINE` and the busy/retry veto (output > 0) are untouched.
- `AMICUS_NO_OUTPUT_BACKSTOP_MS=0` still disables everything: a disarmed backstop never fires, so the
  decision never runs.

## 7. Rulings made in this spec (mine — each with its cost if wrong)

- **R1 — The extension target is the retry window's formula, not "one more backstop interval" and not
  the leg cap.** #251's text said "one more backstop interval, bounded by the leg cap"; `2 × base`
  clamped at `0.95 × cap` IS one more interval wherever the cap allows it, and where it does not the clamp
  keeps the named diagnosis (the whole point of #219's correction). *Cost if wrong:* at
  `cap ≤ 2 × base` the extension is up to 5 % shorter than a full interval (CI first attempt: 432 s of
  a possible 480).
- **R2 — `retry` extends only when the engine's `next` attempt falls inside the extended window.** The
  output>0 path already ends a leg whose retry is scheduled past its deadline (`RETRY_BEYOND_DEADLINE`,
  council #246); extending a zero-output leg past a `next` it cannot reach would burn the window for
  nothing. *Cost if wrong:* a `next` the engine later brings forward is missed — the retry then dies
  under the named clause and the seat's once-only retry runs, as today.
- **R3 — The pre-send site never extends.** The failure is the engine not returning from
  `prompt_async`, upstream of any provider stream; `busy` there says nothing about a stream that may not
  exist. *Cost if wrong:* one class of leg keeps today's behaviour exactly.
- **R4 — Survivors record the extension too.** Without it the only evidence of a saved leg is a TTFT
  above a window the reader has to know. *Cost if wrong:* one small object on a handful of legs.
- **R5 — `result-schema.js :: buildRunResult` does not carry the field.** The file is at the 300-line
  gate with zero headroom, and the solo `read` surface already shows the reason string, which carries the
  case. *Cost if wrong:* a solo `read --json` consumer parses the clause instead of a field.
- **R6 — The runStats projection and the ledger do not carry the field.** `verdict.json`'s schema is
  unchanged; the corpus reads leg documents. *Cost if wrong:* a future census needs the leg docs, which
  the evidence artifact already ships.
- **R7 — The status probe budget stays `STATUS_PROBE_MS` (5 s), and a kill-path read that answers
  `unknown` kills exactly as today.** A slower probe on a loaded engine converts to a longer kill, never
  to an extension. *Cost if wrong:* none new — today's behaviour.
- **R8 — The live model probe (`models --check --live`) gets the extension like every other leg.** Its
  30 s window doubles to 60 s for a session the engine reports busy, under its 2-minute ceiling; its
  classification (`/^NO_OUTPUT_BACKSTOP:/` → `accepted-but-silent`) is unchanged and `docs/usage.md`'s
  "no output within the probe window" stays true. No opt-out option is added (an option is three
  surfaces to get wrong, failure mode #22). *Cost if wrong:* `models --check --live` waits up to 30 s
  longer per busy-silent alias.
- **R9 — The wiring suite's default status mock becomes `{type:'idle'}`.** Today it is `{type:'busy'}`
  (so every death carried the busy clause); under this design a busy default would extend every dying
  test leg and double their durations (failure mode #36). Pins that asserted `(session: busy)` on a kill
  assert `(session: idle)` — same bytes otherwise — and the busy/retry/unknown cases get their own
  fixtures. *Cost if wrong:* a wording change in ~10 test assertions.

## 8. Data flow after the change

```
poll N: substantiveActivity=false ─► backstop.tick ─► 'fired'
        ─► sessionStatusSafe (≤ 5 s)
              ├─ busy / retry(next inside) & room ─► backstop.extend(deadline) ─► record{extended:true} ─► poll N+1 …
              │       └─ later: activity ─► disarmed ─► … normal completion; result.backstop rides out
              │       └─ later: 'fired' again ─► status read for the REPORT ─► kill; clause "extended once …"
              ├─ busy / retry & no room ─► record{extended:false, why:'at-cap'} ─► kill; clause "not extended: … leg cap"
              ├─ retry(next beyond) ─► record{why:'retry-beyond-window'} ─► kill; clause "… past the extended window"
              └─ idle / unknown / other ─► record{extended:false} ─► kill; string byte-identical to 4.12.0
result ─► fanout-leg.js (leg doc) / session-finalize.js + start.js (solo metadata) ─► `backstop` field
result.error ─► run-retry-notes.js `data.reason` (verbatim) ─► run.json degrades[] ─► the next corpus
```

## 9. Rollout

One PR, `feat/251-busy-aware-backstop`, council-gated (the owner labels; label OFF after each round).
Ships in the next minor. CHANGELOG `[Unreleased] ### Changed` (a shipped mechanism changes behaviour —
failure mode #17): one bullet naming the extension rule, the clause, the `backstop` record, and the
unchanged CI worst case. Docs surfaces that PROMISE the old behaviour and must be amended in the same PR
(failure mode #12 corollary 3): `src/utils/no-output-backstop.js` docblock ("fired is terminal"),
`docs/troubleshooting.md` (the `NO_OUTPUT_BACKSTOP` section: the fourth clause and the record),
`skills/second-opinion/MODEL-NOTES.md` (the backstop bullet: "disarms permanently … independent of
`--timeout`" gains the one clamped extension; the retry bullet notes the shared formula and the CI
retry's `at-cap`), `docs/council.md` ("Leg completion and `session.status`"), `docs/configuration.md`
(the `AMICUS_NO_OUTPUT_BACKSTOP_MS` row), and the comment block above `AMICUS_NO_OUTPUT_BACKSTOP_MS` in
`.github/workflows/council-review.yml`. The Saturday council round the owner planned can be this PR's
round.

**What the first CI rounds on this build should show, and what would refute the lever:** kills carrying
`extended once … on session busy` (the extension delayed a death) versus survivors carrying
`backstop.extended: true` with `ttftMs` in (480 s, 912 s] (the extension saved a leg). If, over the next
corpus, the saved count is ~0 and the delayed count matches the old kill count, the extension is only
cost and should be reverted — the record exists to make that call cheap.

## 10. Self-review (against the plan-authoring checklist)

- #34 (enumerate a union's arms): the decision table names every `SessionStatus` arm the pinned SDK
  publishes (`idle | retry | busy`, pinned by `tests/headless-idle-completion.test.js`), every probe
  outcome, AND the unknown-arm case.
- #19 (every terminal write): §5.2 lists the writers by grepping `finish`'s threading, the last field
  added to the same documents; the two excluded writers are excluded by ruling, not omission.
- #8 corollary (a pin that encodes the bug): §4 shows the CI worst-case formula is unchanged and why
  (first term already `legCap`); the plan's test derives the extension from the workflow's own values.
- #36 (durations, not verdicts): R9 predicts the duration change and removes it from the default; the
  plan's Global Constraints require the implementer to report suite durations before/after.
- #42 (a frozen string on every document): the clause appears only on strings built at the two firing
  sites; documents on disk are untouched; the byte-identity pin covers every non-extending case.
- #12 corollary 3 (promises in docs): §9 lists every prose surface that states "terminal", "permanent",
  "independent of --timeout" or "fires first".
- #17: this changes a shipped setting's behaviour → `### Changed`, with the upgrade sentence.
