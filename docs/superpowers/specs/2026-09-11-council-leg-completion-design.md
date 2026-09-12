# Council leg completion — design

Date: 2026-09-11 · Status: amended after owner review (three-usage framing; opt-in local tools) · Evidence: `SecondBrain/output/council-leg-study-2026-09-11/` (MANIFEST.md, runs/*/REPORT.md, crosscheck.py)

## 0. Vocabulary

Three discrete ways the council is used. The words are used in exactly these senses throughout.

- **Task mode** — the council as a co-worker, researching or creating new work.
- **Review mode** — the council reviewing an artifact or piece of work the caller hands it.
- **The headless CI workflow** — a specific pipeline (`council-review.yml`) that *uses* review mode on a PR diff with its own gate policy. It is a caller of the engine, not a mode.

## 1. Problem, as measured

Council runs lose stage-1 seats three different ways. Each class below has at least two witnesses in the study and in the ledger.

| class | mechanism | witnesses |
|---|---|---|
| **1 — idle-gate harvest** | inter-tool narration completes → `mirror.output > 0` arms the stable-idle gate → the final message's reasoning/text is invisible in flight → 30 flat polls → the leg is declared `complete` with only the narration | glove-breakin-01 (3/3), D0 (3/3), B4 `wsgate02-s1-3`, council-232-r2 (3-byte glm review) |
| **2 — tool-call hang** | a `Plan`-toolset call (`grep`, `glob`, `task`) never returns → `Tool call stalled` at 300 s → dead leg | gemini ×4 (grep/glob over the global amicus install), cohere ×2 (`task {}` spawning a child session amicus cannot observe) |
| **3 — zero-token black hole** | provider never speaks → `NO_OUTPUT_BACKSTOP` | kimi (A1, D1), gemma-4-31b:free ×2, #202's CI record |

Classes 1 and 2 share one precondition — *a stage-1 seat uses tools* — which is why 30 of the 42 historical runs were clean: their briefs carried the material and the seats never reached for a tool. Class 3 is provider-side and stays in #202's lane; this design does not address it.

**The class-1 receipt.** D0 replicated glove-breakin-01 with `LOG_LEVEL=debug`. On every one of the three cut polls the loop had *just called* `session.status` (the "authoritative" signal, `headless.js:1204`); the SDK never reported `idle` (0 lines in the trace, 0 `unavailable` lines), and the heuristic fired anyway at `stablePolls: 30, assistantFinished: false`. The DB holds each seat's full deliverable, completed 39–107 s after the harvest. D1 changed one variable (`AMICUS_STABLE_IDLE_POLLS=150`): the same seats delivered, harvested 1–5 s *after* completion. A1 and E1 showed the other half: without tools, `outputLength` is 0 for the whole stream and jumps to the full length on the poll the message finalizes — the gate never arms, by accident of the placeholder guard at `headless.js:1274`.

**The class-2 receipt.** opencode logged `evaluated permission=grep … allow` for gemini and then nothing for 300 s; standalone ripgrep on that directory takes 1 s. For cohere, the parent's `task` part sat `running` while the child session either produced 0 tokens (original) or ran 21 tool messages and wedged on `bash` (retry). E1 showed gemini makes **0** tool calls when the brief says not to.

**The independence receipt.** In glove-plan-01 (review mode, artifact in the brief, "nothing else is in scope"), gemini read `glove-plan-01-s1-1/metadata.json` and `glove-plan-01-s1-3/…` — the other two seats' session files — before dying. A seat with `read` can open sibling sessions in the run directory; once their `summary.md` exists it can read the other reviews before writing its own. The anonymized Stage 2 assumes that cannot happen.

## 2. Decisions taken (owner, 2026-09-11)

1. **Tool access is a property of the run, set by the caller according to whether the seat must go and get its material — not a property of the mode.** The engine exposes the lever and defaults it safely.
   - **Task mode:** `webfetch` on by default (the co-worker can research). Local tools — `read`, `grep`, `glob`, `bash` — off unless the caller **opts in**. Owner's ruling: opt-in is right even for creating new work.
   - **Review mode:** off by default; the artifact under review arrives in the brief (`--artifact`, `--pack`, or pasted), which is how every local review run on record was built. `read`/`grep`/`glob` opt-in when the artifact is a path rather than text.
   - **The headless CI workflow** inherits the review-mode default (it inlines the diff). It needs no change and does not constrain the design.
   - **Never in a headless seat, any usage,** without the explicit `agent` override: `task` (spawns child sessions amicus cannot observe) and `skill` (where gemini's harness-reading started).
   - **Support roles** — repair, stage-2 judges, debate, chair — never have tools; their briefs already say so and the engine now enforces it.
2. **Gate fix:** the stable-idle heuristic is subordinated to `session.status`. (Alternatives: subscribe to `/event` part deltas — a follow-up, not a substitute; raise `STABLE_IDLE_POLLS` — rejected on D1's evidence: qwen ran 796 s, and any invisible part longer than the threshold is still cut.)

## 3. Sub-fix 1 — the stable-idle gate defers to `session.status`

**Where.** `src/headless.js` — the per-poll status read at :1207–1224 and the heuristic at :1271–1290 (the site the code already labels *"v4.4 B4 part 1 — THE MEASURED DEFECT SITE"*).

**Change.** Record the outcome of each poll's `getSessionStatus` as `lastSdkStatus ∈ {'busy','retry','idle','other','unavailable'}`. The pinned SDK's `SessionStatus` is the three-arm union `idle | retry | busy` (`@opencode-ai/sdk` `types.gen.d.ts`; `utils/session-status.js` reads the same arm): `retry` is provider backoff and the engine has not given up, so it is held exactly like `busy` — otherwise a 429 between attempts reads as flat output and the same harvest survives on the rate-limited providers the study measured (amended 2026-09-11 after the whole-branch review). On the `!assistantFinished` branch of the stable-idle gate (threshold `stableIdlePolls`), a poll where `lastSdkStatus` is `'busy'` or `'retry'` **and no tool call is live** (`liveTools.length === 0`, the array `deferForUnsettledTools` already reads) counts as activity: the flat-poll counter resets, and one debug line (`Idle heuristic reset: SDK busy, no live tools`, with `stablePolls` and `sdkStatus`) is emitted on the first vetoed poll of each flat stretch and again whenever a non-zero count is reset (a status flip-flop, or a tool finishing mid-stretch), so a trace shows the veto once per flat stretch plus once per such reset — on the D0 shape the counter never leaves 0, so "on non-zero reset" alone was silent exactly where the veto matters (amended 2026-09-11). `Polling loop exited` carries `sdkStatus` too. **The `liveTools` guard is load-bearing** (measured 2026-09-11, plan probe): the v4.4 B4 bounded tool-settle ceiling fires *through* this gate while the engine is busy and then aborts the session (LC-2); a veto without the guard fails 16 tests, 13 of them that ceiling/abort suite (12 once Task 2 finalized the ALREADY-terminal fixture — the number every shipped record carries). With the guard, whenever a tool is live B4 governs exactly as today. The `assistantFinished` branch (threshold `stableFinishedPolls`, message already finalized) is unchanged. The `mirror.output.length > 0` arming guard is unchanged — with the veto in place, narration arming is harmless.

**Semantics.** This makes the heuristic the *fallback* the comment at :1206 already says it is ("on any error, fall back to the activity heuristic"). A status call that throws yields `unavailable`, which permits the heuristic — today's behavior, preserved. Nothing else moves: the leg `--timeout`, the no-output backstop, the tool-stall detector and `TOOL_SETTLE_GRACE_MS` all stand, so a session that is *busy-but-wedged* still dies by timeout and is named `timeout`, which is honest; the v4.9.2 death-time status read is backstop-only and does not run on the timeout path, which is why the exit line now carries the last SDK status. Two additions after the council review of PR #246 (2026-09-11): when the fallback heuristic ends an unfinalized message with no tool live — reachable only because `session.status` did not say `busy`/`retry` — the leg logs a warning naming the status it saw, so a stuttering status endpoint cannot re-open the mid-answer harvest silently; and when a `retry` status schedules its `next` attempt beyond the leg deadline, the leg ends at once with the named reason `RETRY_BEYOND_DEADLINE` (status `error`, session aborted) instead of holding a seat for a deliverable that cannot arrive — never on a finalized last message, which the stable-finished path owns, and never while a tool call is live, which the B4 ceiling owns. The bound for a busy-but-wedged leg stays the leg `--timeout`: D1's qwen was legitimately busy for 796 s, so any intermediate ceiling below that re-creates the harvest.

**Not in scope.** No new runStats/ledger field. (The #202 lesson: `tally.js`'s hand-maintained allowlist strips any key it is not taught; adding one is a separate, pinned change.)

**Tests.** `tests/headless-idle-completion.test.js` gains twelve cases: (a) status `busy` + flat non-zero output for `> stableIdlePolls` polls → no exit; the leg completes on the finalize poll via the `stableFinishedPolls` path; (b) status unavailable + flat → exits at `stableIdlePolls` (fallback preserved); (c) status `idle` → the existing sdk-idle exit, unchanged. (d) status `retry` + the D0 shape → held like busy (named mutant **RETRYHARVEST**: drop the retry arm, reddens (d) only). (e) the D0 shape with a settled tool part present (the real D0 mirror) → held. (f) busy + never finalizes → ends by the leg `--timeout`, exit line carries the status. (g) a busy → unavailable → busy flip-flop → counts while unavailable, resets on busy, two trace lines (mutant **FLAPSILENT**). (h) the fallback ending an unfinalized message logs a warning naming the status, for `unavailable` and for an unknown type (mutant **FALLBACKSILENT**). (i) `retry` with `next` beyond the deadline → `RETRY_BEYOND_DEADLINE` at once, session aborted (mutants **NEXTIGNORED**, **BACKOFFNOTFORCED**). (j) the pinned SDK's `SessionStatus` union is exactly `idle | retry | busy`. (k) a finalized message plus a retry scheduled past the deadline → completes on the stable-finished path, nothing discarded (mutant **FINISHEDRETRYEXIT**). (l) a retry past the deadline while a tool call is live → the B4 ceiling governs, no early exit (mutant **RETRYOVERTOOL**). Named mutant **BUSYIGNORED** (the veto never fires: replace the SDK-status test with `false`) must redden (a), (d), (e), (f) and (g) and nothing else; **VETOOVERCEILING** (drop the liveTools guard) reddens the 12 B4 ceiling/abort cases in premature-completion. `tests/observe/premature-completion.test.js` and `tests/headless-output-length.test.js` (mutants NOEXIT, SESSIONWIDE) are re-run unchanged; if either asserts the 30-poll exit against a busy status, that assertion was pinning the defect and is updated with a comment naming this spec.

**Live check (release ritual, spends).** Replay `briefs/brief-research.md` with `kimi,grok,qwen` and default thresholds: expect 3/3 deliverables, no `Session appears complete (idle)` with `assistantFinished: false`, run time comparable to D1.

## 4. Sub-fix 2 — council seats run as agents with a per-run tool allowlist

**Where.** Agent registration: `src/opencode-client.js` :653–680, the same `config.agent` injection that already defines `chat` (schema: `tools?: { [name]: boolean }`, `@opencode-ai/sdk` 1.18.15 `types.gen.d.ts` :1170; `permission.external_directory` exists on the same schema). Agent choice: `src/council/run-launch.js:120` (`agent: opts.agent || 'Plan'`). Intent: `o.intent` in `src/council/run.js` (present only when `'task'`; review normalizes to absent — `tests/council/run-intent.test.js`). Server options carry `agentName` via `src/sidecar/session-utils.js:259` / `buildServerOptions` :535. **Implemented (PR 2, 2026-09-12):** measured tool ids on the pinned engine are `invalid, question, bash, read, glob, grep, edit, write, task, webfetch, todowrite, websearch, skill, apply_patch`; refused for seats: `task`, `skill`, and also `edit`, `write`, `apply_patch`, `question`, `invalid`; remote: `webfetch`, `websearch`. `GET /agent` renders `permission` as a rule list and an unknown tool id is accepted at start, so amicus validates against `tool.ids()`. The out-dir rule is applied on the CLI as "outside the project tree and under an allowed root"; over MCP (run dir inside the project) local tools are refused; the seat agent denies `.env`/`.env.*` reads (ruling P2-R9: the engine evaluates permissions by findLast, so a bare `read` allow would have exposed them).

**Change.**
- **Two agents per council server.** `council-support` (every declared tool `false`; used by repair, stage-2 judges, debate, and chair — always). `council-seat` (used by stage-1 seats and their retries), whose tool map is computed per run: `defaultFor(intent) ∪ optIn`, where `defaultFor('task') = {webfetch}` and `defaultFor(review) = {}`. `mode: 'primary'` on both; `permission: { webfetch: 'allow', edit: 'deny', bash: <'allow' only when opted in> }`. When any local tool is opted in, `permission.external_directory: 'deny'` — a seat may read the project tree and nothing outside it (the global-install grep that killed gemini is outside it).
- **The opt-in lever.** `--tools <a,b,c>` on `amicus council run` and a `tools` parameter on the MCP council tool. Validated against the engine's declared tool ids; `task` and `skill` are refused with a Notice naming the `agent` override as the escape hatch for anyone who truly wants the full `Plan` agent. The existing MCP `agent` option (`mcp-tools.js:347`, `Plan | Build`) stays as that override — `opts.agent` wins over the computed seat agent.
- **Tool ids are derived from the engine's own declaration at implementation time and pinned by a keyless probe — never hand-listed in code.** (The ids observed in this study are `read`, `grep`, `glob`, `bash`, `webfetch`, `task`, `skill`; the SDK also names `subtask`.) Reason: an undeclared or misspelled key is silent, and #218 showed a malformed `limit` poisons the whole server with `ConfigInvalidError` — a malformed agent block must be caught the same way.
- **Run-directory placement when local tools are opted in.** The legs' project directory is the run's out-dir today, which contains `.claude/amicus_sessions/*` — the sibling sessions. An opted-in `read` must not be able to open them: when `--tools` includes any local tool, the engine requires the out-dir to sit outside the project tree (refused with a Notice otherwise). Without opt-in the question does not arise — the seat has no `read`.
- `run-launch.js`: `agent: opts.agent || 'council-seat'` for stage-1 seats and their retries, `'council-support'` for every other role; `intent` and the opt-in list are plumbed into the launch opts from `run.js`.
- **Briefing lines, computed from the effective allowlist.** A seat with no tools gets the existing no-tools sentence (`briefings-chair.js:18`, `CHAIR_NO_TOOLS_LEAD` + `'review.'` / `'answer.'`). A seat with tools gets one line naming exactly them — *"Your tools: webfetch. You have no others — do not attempt to read files, search directories, or run commands; if research is incomplete, say so in the deliverable rather than leave it unwritten."* Config enforces, the briefing informs (E1: told not to, gemini complied). `SEAT-BRIEFS.md` and `docs/council.md` updated.

**Error handling.** The probe pins registration and the rendered rule order (including that the seat's `.env` deny rules land after its own `read` allow); what a seat experiences on a refused tool call — the engine's tool-unavailable result, the leg continuing — is the §7 live replay's check, not the probe's. If the run's shared server cannot start, the run degrades with a Notice (`sharedServerUnavailable`) and each wave's fallback server registers the same agents (`serverAgents` rides to fanout); an explicit `--tools` opt-in that no engine could validate is refused before any launch (`--tools could not be validated`). An unknown id in `--tools` is `BAD_ARGS` before launch, listing the engine's declared ids.

**Tests.** `tests/council/run-launch*.test.js`: seat agent by intent, opt-in union, `task`/`skill` refused, override wins, every support role gets `council-support`. `tests/opencode-client*.test.js`: both agents present in the emitted config with the computed map; `external_directory: 'deny'` present iff a local tool is opted in. `tests/council/run-intent.test.js` extended for `--tools`. Keyless integration: the pinned engine accepts the config and reports both agents via `GET /agent` (or the config echo #218 PR 4 used).

## 5. Sub-fix 3 — surface what the tally already knows (#242)

**Where.** `src/council/report-html.js:63–84` and `report-md.js:55` ("What was lost" is built from `run.json.degrades` only); `src/council/verdict-seats-reviewed.js:44–60` (`seatsReviewedOf(runStats)`); the flag is set at `src/council/run-stages.js:247–266` (`findingsUnverified` ⇔ the original emitted no parseable block; `repairRefused` ⇔ the count check failed) and already survives to `tally.json` and `verdict.json`.

**Change.**
- "What was lost" gains one row per `runStats` seat with `findingsUnverified` (channel `unverified-repair`: *"seat X's findings came from a repair of a response with no findings block; nothing verified them"*) and per `repairRefused` (channel `repair-refused`, with the code). Data source: `runStats`, no new computation. The wording never says "stub": B2's qwen-flash carried the flag on a real 19 k review whose JSON block was malformed.
- `seatsReviewed` gains a third number: `{ reviewed, unverified, of }`. `reviewed` keeps its meaning; `unverified` counts stage-1 seats whose findings are flagged. Glove-breakin-01 then reads `{ reviewed: 4, unverified: 3, of: 5 }` instead of `4 of 5 · Converged`. The publish gate (verdict + seatsReviewed) sees it.
- #242's item 1 (write repair output back to `review-<seat>.md` / the Stage-2 bundle) is **not** in this spec: after sub-fix 1 the narration-stub repair case largely disappears, and the remaining write-back question is a separate small change on #242.

**Tests.** `tests/council/report-html*.test.js`, `report-md`, `verdict-seats-reviewed.test.js` with glove-breakin-01's `tally.json` as a fixture (3 flagged seats): rows present, counts exact, and a run with no flags renders byte-identically to today (mutant **ROWALWAYS** must redden).

## 6. Data flow after the change

```
poll ─ getMessages ─ mirror ─ progressed?
     └ getSessionStatus ─ lastSdkStatus
gates, in order:  length-death │ sdk-idle (status idle) │ backstop │ tool-stall
                  │ stable-finished (msg finalized, 2 polls)
                  │ stable-idle (heuristic, 30 polls) — NEW: vetoed while lastSdkStatus ∈ {busy, retry} and no tool is live
                  │ leg timeout
seat agent:  council-seat = defaultFor(intent) ∪ --tools opt-in  (task→{webfetch}, review→{})
             council-support = no tools (repair, judges, debate, chair)
             opts.agent override wins (MCP `agent`: Plan | Build)
report:      degrades[] + runStats.findingsUnverified/repairRefused → "What was lost"; seatsReviewed {reviewed, unverified, of}
```

## 7. Rollout

- Three PRs in this order, each small enough to review on its own: (1) gate veto; (2) council agents, `--tools`, briefing lines; (3) report/verdict surfacing. Each PR carries the `council-review` label and merges only after its council run **completes** (owner's hard gate).
- Release as **v4.9.8**. (1) and (3) are correctness fixes; (2) is a behavior change and gets a CHANGELOG entry plus a `docs/council.md` section covering the per-usage defaults, `--tools`, and the `agent` override. The headless CI workflow needs no change.
- `npm test` before push; `npm run test:integration` (keyless) covers the engine probe; the live replay in §3 is release-ritual only.

## 8. For the owner — recommendations, not blockers

1. **Upstream on opencode**, with the study's session ids as evidence: (a) `grep`/`glob` over a directory holding 170 MB binaries is approved and never runs (D0/glove sessions); (b) `task {}` with empty arguments is accepted and spawns a child session (C2). Recommend filing both. `session.messages` not exposing in-flight parts is by design (`/event` is the delta channel) — no filing.
2. **Historical verdicts** that adjudicated stubs (council-232-r2/r3, pr5c-r2's 1,333-byte qwen) — whether to re-run is a judgment call; the data is in the study manifest.
3. **Follow-up:** `/event` subscription for part deltas (exact TTFT, growth-based progress correct by construction) — a separate design once (1) has shipped and been measured.

## 9. Self-review

No placeholders. §2 decisions match §3–§5 and use the §0 vocabulary throughout; nothing in the design is keyed on the CI workflow. Scope: three bounded changes, one PR each — no decomposition needed. Ambiguities resolved explicitly: the tool list is engine-derived (not hand-listed); `task`/`skill` are refused in `--tools` and reachable only via the `agent` override; retries of stage-1 seats keep the seat agent; `reviewed` keeps its meaning and `unverified` is additive; opted-in local tools require the out-dir outside the project tree and `external_directory: 'deny'`.
