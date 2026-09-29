# Amicus Backlog
The live work list for this repo. It is not shipped (package.json `files`).
History, rulings and measured facts moved verbatim to BACKLOG-ARCHIVE.md on 2026-09-27
(frozen at 8e08a63d; its line numbers are the old BACKLOG.md line numbers; closures are
listed at its end). The archive is never edited except to append dispositions.
Legend: - [ ] open · - [~] partly done · - [x] done (moves to the archive's dispositions at the next consolidation)
Add an item: one line under its theme — `- [ ] **<id>** — <work> (<issues>) — <evidence>`;
mint ids as `B-<theme>-<n>`; cite symbols, not line numbers; no size tables (the v4.8 spec's ruling R19: `npm run check:sizes`).

## Open work

- The live items, carried from the 2026-09-27 audit's open-items list with their ids unchanged, plus the gaps the audit found untracked, marked (new 2026-09-27).
- Format: `- [ ] **id** — work (was L<n>; issues) — evidence`. `was L<n>` is a line of BACKLOG-ARCHIVE.md; a letter suffix (`L1282a`, `L1282b`) tells apart two audited rows on the same line.
- Evidence `file:NNN` is true at `8e08a63d`, the dated-record rule of docs/CITATIONS.md: re-read it before acting, and cite `file.js :: symbol` in new text.
- Ids: council-round findings are spelled `#PR-rN-Xn`, minted ids are `B-<theme>-<n>`, and `N-nn` are the audit's new items.
- ⛔ means the fix lands in a file at 300/300, so B-SZ-1 comes first (Release Constraint 6: "extract, never shave").
- ▶ D-nn meant the item waited on that owner decision. All 41 were decided on 2026-09-28 (see "Owner decisions"), so no item waits on one now.
- Order within a theme: blockers first, then by age, then items blocked on a decision.
- "Slice N", "the refusal survey" and `refusal-signatures.md` name audit files outside this repo: C:/Users/sendt/OneDrive/AIProjects/SecondBrain/output/2026-09-27-amicus-backlog-audit/ and C:/Users/sendt/OneDrive/AIProjects/SecondBrain/output/2026-09-27-amicus-cluster-b/refusal-signatures.md.

### Cluster B: ruled by the owner 2026-09-27 (closed, not open work)

- **L8721 majority → exit 2** — CLOSED, no exit change. The seat census, the report rows, the CI title and the end-of-run stderr line keep the signal. Supersedes the 2026-09-16 ruling. (was L8721; #242, #259) — `unverified-repair` / `repair-refused` stay render-time rows that never flip the exit code (src/utils/degrade.js:52-59).
- **#242 item 3 (vacuity grading)** — REFUSED, no code.
  - Reasons: the unverified row names the seat, a seat with no findings has no findings rows, and the token heuristic has no measured threshold.
  - The item-3 comment was posted on 2026-09-28 (issuecomment-5870646040). #242 stays OPEN for item 1 (see **#242-1** under council-verdict). (was: named inside L8721; #242) — gh #242, Ask item 3.
- **#259 (the chair re-tiers findings)** — CLOSED, no code.
  - Reasons: the CI comment's tier lists and the report already carry the tally's tiers, and its Ask 2 named report.html, which never renders the chair's prose.
  - GitHub #259 was closed as not planned on 2026-09-28, with the ruling's comment (issuecomment-5870645268). (was L8790; #259) — src/council/briefings-chair.js:164-250.
- **#256 Ask item 3 (a provider-refusal class in the census)** — REFUSED, no code.
  - Reasons: the dead-seat notice already quotes the provider's refusal verbatim, and the #264 CI preflight addresses the root. (was L8943; #256 closed) — `seatsReviewed.refused` counts refused repairs (src/council/verdict-seats-reviewed.js:85-89, :122).
  - ⚠️ The ruling's reason does not cover one case: a refusal that arrives after the leg produced output. That leg is recorded `complete`, and no notice quotes the refusal (N-01, under council-legs).
- **#244 dead-row `conformance: clean` residue** — MERGED in #272 (`5577667b`, 2026-09-28; a fourth value, `none`) after two council rounds, both "Fix these first"; the owner ruled reply-only after round 2. Ships in 4.14.1. (was: named inside L8721; #244 closed) — the refusal survey measured refused legs' runStats rows reading `status:"error"`, `conformance:"clean"` (refusal-signatures.md §3a).
- **Knock-on:** L8741 gave "a prerequisite of #259" as the reason to split report.js, and that reason is gone. report.js stays in B-SZ-1 only.

### council-verdict

- [x] **GOA-3a** — Add a per-finding `confidence` (0–1) to the findings contract, parsed tolerantly, feeding the thin/solid split and the chair packet. GoA; closed 2026-09-28 by D-07 (parked; the design stays in docs/superpowers/plans/2026-08-05-goa-paper-review-adoption-notes.md). (was L1282a; —) — no confidence key in `FINDINGS_JSON_SHAPE` (src/council/briefings.js:48-67) or `TASK_FINDINGS_JSON_SHAPE` (src/council/briefings-task.js:52-73).
- [x] **GOA-7** — Add recency decay, or a last-K window defined over runs rather than rows, to the ledger's reliability stats. GoA; closed 2026-09-28 by D-07 (parked; the design stays in docs/superpowers/plans/2026-08-05-goa-paper-review-adoption-notes.md). Its resolved-model prerequisite shipped; keep the id, which docs/ROADMAP.md:245 cites. (was L1315b; —) — src/council/ledger-stats.js:59-86 averages every row.
- [ ] **#177-A1** — Add an isolating pin for `credFor`'s `ids.length > 0` guard (an empty-group case). (was L2722; —) — src/council/ledger-join.js:214; no empty-group case in tests/council/ledger.test.js.
- [ ] **#177-B1** — Measure a pair group that repeats a resolved seat id before deciding whether the dedup needs a pin. (was L2728; —) — dedup unchanged at src/council/ledger-join.js:219; no test drives it.
- [ ] **B-CV-1** — Reword the present-tense "the shipped" `byJudge[adj.judge]` test comment, the last carrier of that literal (parked by owner ruling). (was L2901; —) — tests/council/seat-matrix.test.js:75.
- [ ] **B-CV-2** — ⛔ Export `UNATTRIBUTED` from both consumers so the tests stop holding 46 bare-string copies. (was L3015; —) — defined at src/council/report.js:30 and src/workspace/matrix-model.js:36; absent from the exports at report.js:300 and matrix-model.js:220.
- [ ] **B-CV-3** — ⛔ Compute `columnFor` once per adjudication in both consumers. Measure first. (was L3021; —) — src/council/report.js:189/:201; src/workspace/matrix-model.js:153/:172.
- [ ] **SI-22.4-r1** — Reword four comments that still give "a padded `--council` member" as a live cause, each when its file is next opened. (was L3565; —) — src/council/run-assemble.js:175, src/council/run-stats-entry.js:97, src/council/run.js:208, src/sidecar/fanout-wave-io.js:103.
- [ ] **SI-25-r1** — Fix the `buildChairPacketFile` docblock, which claims the packet is "lifted verbatim… same composition". (was L3804; —) — src/council/run-assemble.js:242-244 vs :276, which adds `findings`.
- [ ] **#174-r2-C2** — Make `raiser` and `judge` `z.string().min(1)` in the MCP tally schema. (was L4758, L3153; —) — src/mcp-tools.js:437, :472 are bare `z.string()`; declined twice as already filed, never refuted.
- [ ] **#242-1** — Write each repair leg's output back to `review-<seat>.md` and the Stage-2 bundle, so Stage 2 and the chair see what the tally scored. (was: no BACKLOG row; kept open by today's ruling; #242) — gh #242, Ask item 1.
- [ ] **B-CV-4** — Pin that every debate-row producer stamps a non-empty status, since the deleted `mk || 'unknown'` default rests on a producer census. (was L8547; —) — src/council/debate.js:185-189; G1c pins only the verbatim ride (tests/council/runstats-byte-order.test.js:133-141).
- [ ] **B-CV-5** — Pin that `run.json` carries no `runStats`; today that is prose only. (was L8561; —) — src/council/run-state.js has no `runStats`; the claim sits at tests/council/runstats-byte-order.test.js:486-487.
- [ ] **B-CV-6** — Add an end-to-end `runCouncil` test in which a refused repair reaches `verdict.json` on disk. (was L8729; —) — only negative or hand-built coverage: tests/council/run-all-clean.test.js:84, tests/council/run-finish-ledger-gate.test.js:120-158.
- [ ] **B-CV-7** — Add a `reasoning-absent` degrade channel for a reasoning seat that reasons zero (two instances on record, L8780 and L8955-8958). (was L8780; —) — no such channel in src/utils/degrade.js:14-63.
- [ ] **B-CV-8** — Remove or consume the exported `MIN_CROSS_REVIEW_JUDGES`, which has no importer. (was L8932a; PR #263) — src/council/run-stage2-notes.js:292 (only other hits :201, :281); `thinCrossReviewWhy` now has a test consumer.
- [ ] **B-CV-9** — Bucket a non-boolean `died` so it is counted and not mis-named "the bench seated only N judges". (was L8932b; PR #263) — src/council/run-stage2-notes.js:243-248, :262-266.
- [ ] **#257-r3-A1** — Escape Markdown in degrade text before the Markdown report renders it. (was L9227; #257) — src/council/report-md.js:59, :69. Neither `formatDegrade` (src/utils/degrade.js:106-112) nor `collapseExcerpt` (src/utils/text-sanitize.js:79-87) escapes.
- [ ] **B-CV-10** (new 2026-09-27) — Decide how a bench-drawn chair's give-up row reaches the ledger: document the second ledger row it writes, or join it to its seat's group. (was: no BACKLOG row; —) — measured 2026-09-27 on `fix/244-conformance-none` through `buildRunStatsEntry` → `tally` → `buildLedgerRows`: when the chair also sits on the bench and its bench leg resolved, the leg-less give-up row (no `resolvedModel`) forms its own pair group, which `ledger-join.js :: benchLegs` keeps (a chair-only group decides its own fields), so the model gets a second ledger row (`clean` before the #244 residue fix, `none` after). It makes docs/council.md's "one row per distinct (`model`, `resolvedModel`) pair on the bench" and skills/second-opinion/SKILL.md's "one row per model on an ordinary bench" imprecise.
- [x] **GOA-4a** — Order the seat rail by street cred with high/moderate/low badges across report.js, report-md.js, report-html.js and the Workspace matrix. GoA (the badge scheme is GOA-2's); closed 2026-09-28 by D-07 (parked; the design stays in docs/superpowers/plans/2026-08-05-goa-paper-review-adoption-notes.md). (was L1290a; —) — the only street-cred sort is chair promotion (src/council/chair-fallback.js:62-67).
- [x] **GOA-4b** — Add an efficiency panel showing calls, tokens and cost against the full static bench. GoA (it needs a picked subset to compare against); closed 2026-09-28 by D-07 (parked; the design stays in docs/superpowers/plans/2026-08-05-goa-paper-review-adoption-notes.md). (was L1290b; —) — src/council/report-cost.js renders per-row cost only.
- [x] **GOA-4c** — Name in the report why each seat was picked. GoA; needs GOA-1's picker; closed 2026-09-28 by D-07 (parked; the design stays in docs/superpowers/plans/2026-08-05-goa-paper-review-adoption-notes.md). (was L1290c; —) — no picker output exists.
- [x] **GOA-8** — Add a shadow seat: judged at full fidelity, votes excluded from tier bases, findings advisory. GoA; needs GOA-1; closed 2026-09-28 by D-07 (parked; the design stays in docs/superpowers/plans/2026-08-05-goa-paper-review-adoption-notes.md). (was L1331; —) — nothing in src. `LEDGER_JOIN_ROLES` (src/council/ledger.js:53) is now fail-closed, so a new role is silently dropped unless added there.
- [x] **SL-4** (new 2026-09-28) — Make `council run` refuse an `--out-dir` that already holds another run's `run.json`, naming the existing runId and the fix; no format change (decided D-04). (was L671; follow-ups #279, #280) — `run-state.js :: initRun` merges the new seed into the old record key by key (`mergeRun` spreads the existing record, then the patch), and `cli-handlers-council-run.js :: handleCouncilRun` resolves `--out-dir` without refusing one in use, so two runs silently merge into one `run.json`. The v4.8 spec lists SL-4 under "BACKLOG.md's refuted/closed sections", but no closure was ever recorded (BACKLOG-ARCHIVE.md L9476). — done in #277 (51fa10e9): the CLI door (`cli-council-run-tools.js :: checkCouncilRunTools`) and the MCP door (`mcp-council-run-dir.js :: resolveMcpRunDir`) both refuse before any write, through `run-state.js :: otherRunInDir`.
- [x] **B-CV-11** (new 2026-09-28) — Render an unrecognized verdict as `?` in report-md.js and report-html.js, as the Workspace matrix already does (decided D-09). (was L5778; —) — `report-md.js :: renderMd` and `report-html.js :: renderHtml` both write `v ? SYMBOL[v] : …`, so an unknown verdict prints the literal `undefined`; `matrix-model.js :: buildMatrixModel` writes `SYMBOL[vote] || '?'`. — done in #277 (51fa10e9): both renderers now write `SYMBOL[v] || '?'`.

### council-legs

- [ ] **B-CL-1** — ⛔ Bill a true-stray retry leg's usage to a runStats row instead of dropping it. (was L2598; —) — src/council/run-retry.js:214 `if (!ff) { continue; }`; src/council/run-stages.js:136 only notes `orphanLegs`. The lane-D matrix of #275's review, a 22,083-cell probe of the real `run-stages.js :: runStage1` (B-CL-13 names where it is kept), measured 200 production-reachable cells where a retry leg that binds to no seat is dropped from the spend record (`run-retry.js :: retryStage1Losses`); the count was identical on main before #275.
- [ ] **B-CL-2** — ⛔ Forward the seat roster to the Stage-1 retry wave, so a retried twin's live row stops reading `seat: null`. (was L3217; —) — src/council/run-retry.js:88-97 (`common` forwards no `seats`).
- [ ] **B-CL-3** — Enforce `stampLegAttribution`'s index-parallel contract and add a misaligned-roster test. (was L3232; —) — src/sidecar/fanout-wave-io.js :: stampLegAttribution never checks `s.alias` against `leg.modelInput`; tests/sidecar/fanout-wave-io.test.js@8e08a63d:36-67, its one describe block, uses aligned fixtures only (corrected 2026-09-29: written as `:36-70`, past the file's 67 lines).
- [ ] **B-CL-4** — Import `twinAliases` / `legLossKey` from the leaf module, not through run-retry-group.js. (was L4232b; —) — src/council/run-stage1-rows.js:16.
- [ ] **B-CL-5** — Count a wholly dead wave's seats in `counts.total`. (was L4581; —) — src/council/run-stages.js:90, :128; src/council/stage1-bind.js:40.
- [ ] **B-CL-6** — Declare `deadWaves` / `seats` / `partial` on stage entries in the run schema, and `degrades[].data.firstFailure.seatId`. (was L4585a, L4585b; —) — schemas/council-run.schema.json:18-26, :118-121; src/council/run.js:172 writes `deadWaves`.
- [ ] **SI-12** — Stop a double orphan collapsing onto one conformance row in run.js's Stage-2 merge. Latent and unreachable from production; owner ruling R19 (2026-08-20) keeps it open. (was L5116, L3955; —) — src/council/run.js:242, :244.
- [ ] **B-CL-7** — Emit an `output-truncated` Note for Stage-2 judge, chair and debate legs cut mid-JSON, not only for Stage 1. (was L8136; #218 closed) — `truncatedReviewNote` only at src/council/run-stages.js:155; reasoning-only judges are already covered (src/council/run-stage2-notes.js:140-186).
- [ ] **#202** — CI council glm/qwen Stage-1 no-output deaths are tracked on GitHub #202 (with #251). The BACKLOG entries are its measurements. (was L7082, L8453a, L8453b, L8851; #202, #251) — both issues OPEN. Pinning qwen to one upstream did not move the tail (PR #266; .github/workflows/council-review.yml:142-166); glm was never pinned.
- [ ] **#206-r4-C3** — Stop a warm engine-log hit serving a stale excerpt as final in a death report (a bypass or an age stamp). (was L8604; —) — src/utils/engine-log.js:207-227; there are now two call sites, src/headless.js:904 and :1533.
- [ ] **#207-r6-A3** — Qualify the `ttftMs` one-poll bound, or use a monotonic clock, so a forward wall-clock jump cannot inflate it. (was L8678; —) — src/headless.js:860, :1351; the bound sentence is at :1332-1334.
- [ ] **B-CL-8** — Stop `noStatusDetail` calling a non-object, non-empty status answer "an empty status". (was L8932c; PR #263) — src/headless.js:400-401.
- [ ] **B-CL-9** — Read the #270 weekend rounds' judge legs (zero spend) to test "judge deaths are a regime" against the weekend, before the artifacts expire on 2026-12-18/19. (was L9009; #251, #202) — runs 35437150184, 35444701260, 35465599616, 35476684772, 35514703539 (4.13.0's busy extension confounds the comparison); expiry read via `gh api`.
- [ ] **B-CL-10** — Name the cause on a dead Stage-1 repair solo; two post-boundary deaths carry an empty reason. (was L9053; #251) — src/council/run-stages.js:222-228; `buildRunStatsEntry` has no reason field (src/council/run-stats-entry.js:70-138).
- [ ] **#269-r2-D2** — Count second firings that read `window extended once … (session: idle)` before adding a mid-extension status re-check. (was L9130; #251) — status read once, at src/headless.js:1469.
- [ ] **#257-r3-F3.3** — ⛔ Compare sanitised strings in the duplicate-reason check. (was L9236; #257) — src/council/run-retry-notes.js:222-225 compares the raw text, then renders `boundReason`.
- [ ] **#257-r3-F3.4** — Replace `judgeDeadNote`'s bare literal 200 cap with the named bound. (was L9242; #257) — src/council/run-stage2-notes.js:63, against a minted-reason supremum of 660 (the #257 spec's R-X50); two tests say "filed, not fixed".
- [ ] **#257-r6-A1** — ⛔ Announce a rescued promoted defence or re-vote. (was L9271; #257) — src/council/run-debate.js:89-93; src/council/run-debate-revote.js:174.
- [ ] **#257-r6-C1** — Carry `standDown` in `promotedJudgeNote`'s `data`, not only in the prose. (was L9272; #257) — src/council/run-stage2-notes.js:193-196, :135 (the value arrives at :119).
- [ ] **#257-r6-A2** — ⛔ Key the debate round note by seat and stage, not by kind + alias. (was L9273; #257) — src/council/run-debate.js:297.
- [ ] **#257-r6-A3** — Pass `relaunchWaveId` on stood-down `judge-reasoning-only` records. (was L9274; #257) — src/council/run-stage2-judge.js:234 (set at :157; only :257 passes it).
- [ ] **B-CL-11** — Find out why glm's judge leg finished `length` with 0 output yet ended `complete` (run 36150179459's artifacts). (was L9276; #218, #257 closed) — `isOutputLengthDeath` at src/utils/output-length.js:74-76 is applied at src/headless.js:1965-1971.
- [ ] **N-01** (new 2026-09-27) — Keep a refusal that arrives after output: store the late `sessionError` as a leg rider on the success path (for example `reason` in `metadata.json`). Today such a leg returns the success shape with no error key, so it is recorded `complete` and the refusal text reaches none of `metadata.json`, `wave.json`, runStats or the spend ledger. No classifier; the #256 Ask item 3 ruling stands. (was: no BACKLOG row; #256) — "F1 semantics" (src/headless.js:1938-1939): `failedWithNoUsableOutput` needs no usable output (:2053), and the success return from :2103 carries no `error`. Measured twice (the refusal survey, §3b and §5.5): CI leg `692ca346-s1-2` in run 31807881067 (286 chars, `sessionError: "Key limit exceeded (monthly limit)…"`) and local leg `pr5b-plan-r2-l4-1` (62 KB of narration, $0.99).
- [ ] **N-04** (new 2026-09-27) — Optionally anchor `error-classify.js`'s status-code alternatives with `\b` (a one-line change), adding no new classes. The only error classifier sorts all five measured OpenRouter refusal texts (the refusal survey's T1, T2, T3, T3b, T4) into `'other'`, which means no cheaper-model substitution: correct for the hard caps (T3/T4), a lost recovery for T1 (`can only afford <A>`) and T2 (transient). Latent: the unanchored `429|503|529|401|403` would misread a T1 `<A>` such as 14290; no measured value trips it. A second latent case, #275's follow-up (2026-09-29): the same digits can match an `OUTPUT_LENGTH` reason's token counts (15293 contains `529`), so with fallback enabled, `fanout-leg-fallback.js :: runLegWithFallback` substitutes a cheaper model before `run-retry-gate.js :: isOutputLengthLoss` can hold the leg; `\b` narrows this case but does not close it, since a count of exactly 429 still matches (not measured). (was: no BACKLOG row; #256, PR #275) — src/utils/error-classify.js:13-16 (the patterns), :19-26 (the classifier); its sole caller is src/sidecar/fanout-leg-fallback.js:207-208.
- [x] **N-07** (new 2026-09-27) — Reword the eight comments that still describe the retired "C2 derivation" (#135's C2) as a future consumer, each in the next PR that touches its file; pairs with D-22 (decided 2026-09-28: the rewording joins N-12's comment-only PR). (was: no BACKLOG row; #251, #135) — src/council/run-stats-entry.js:103; src/headless.js:654, :1344; src/utils/ttft.js:46; tests/council/run-stats-entry.test.js:43; tests/no-output-backstop-wiring.test.js:891, :1109, :1171. The derivation was retired when the #135 ruling dropped #251 item 2 (BACKLOG-ARCHIVE.md L9000). — done in #278 (e36be7fc), inside N-12: no "C2 derivation" is left in src/ or tests/, and both schemas' `ttftMs` descriptions now call it a probe- and forensics-only measurement.
- [x] **GOA-3b** — Substitute a seat through fallback chains on chronic low confidence plus `unstructured` conformance, instead of paying for repair solos. GoA; needs GOA-3a; closed 2026-09-28 by D-07 (parked; the design stays in docs/superpowers/plans/2026-08-05-goa-paper-review-adoption-notes.md). (was L1282b; —) — nothing in src reads a per-finding confidence.
- [x] **B-CL-12** (new 2026-09-28) — Skip the once-only Stage-1 retry for an `OUTPUT_LENGTH` death and say why: the notice names the alias's `outputBudget` (decided D-06, moderate confidence). First confirm, at zero spend from the #202 corpus (B-OTH-3), that a same-budget retry never rescued an `OUTPUT_LENGTH` death. (was L8120; #218 closed) — the retry has no death-class gate (`run-retry-group.js :: groupStage1Losses` groups every loss) and relaunches the seat with the same reservation, so it likely dies the same way and bills the reservation twice ($0.63 → $1.26 on the #218 kimi row). The lever for this death is the alias's `outputBudget`. run-retry.js and run-retry-notes.js are among B-SZ-1's files at the cap. — done in #275 (f94b2152): the zero-spend recount came first and found no rescue in the 2 same-budget retries on record; `groupStage1Losses` now holds such a leg (`run-retry-gate.js :: isOutputLengthLoss`), and the skipped-leg notice says why. amicus has no per-alias budget (`config.js :: getOutputBudget`), so the notice names the one `outputBudget` in force.
- [ ] **B-CL-13** (new 2026-09-29) — Record what the taskId-less twin floor of owner ruling R2 (2026-08-16) bills. The collapse itself is deliberate (BACKLOG-ARCHIVE.md L5662, "The R2 floor is deliberate, not a gap"), but the spend it drops goes unsaid: when two unbound twins whose legs carry no `taskId` both die and both retries die, the Stage-1 rows record 6¢ against 7¢ billed, and when both twins are skipped for cost, 2¢ against 5¢. (was: no BACKLOG row; PR #275) — both counts are identical on main before #275, so neither is D-06's, and both are silent. No fanout produces a taskId-less leg: `fanout-leg.js :: runSingleAttempt` stamps each leg with the id `leg-ids.js :: deriveLegIds` mints. Repro: the programme's matrix probe, a 22,083-cell drive of the real `run-stages.js :: runStage1`, kept outside this repo in the owner's notes at C:/Users/sendt/OneDrive/AIProjects/SecondBrain/output/2026-09-28-amicus-approved-work/lane-d-matrix/probe.js. The owner decided on 2026-09-29: a BACKLOG entry, no code now.
- [ ] **B-CL-14** (new 2026-09-29) — Revisit D-06's no-retry hold if any same-budget retry is ever seen to rescue an `OUTPUT_LENGTH` seat. The owner ruled no opt-out on 2026-09-29 (#275's council round 2, A1 and C1): 0 of the 2 same-budget retries on record rescued a seat, one billed its reservation twice, and every notice names the `outputBudget` fix. (was: no BACKLOG row; PR #275) — the spend ledger records every such death, so the watch is a zero-spend read. The hold is the `held` unit of `run-retry-group.js :: groupStage1Losses`, keyed by `run-retry-gate.js :: isOutputLengthLoss`.
- [ ] **B-CL-15** (new 2026-09-29) — Let a held `OUTPUT_LENGTH` leg retry when its retry engine's output budget differs from its first leg's, or reword the skip clause for that edge. After a mid-run edit of `outputBudget` in config.json, a per-wave engine that spawns later reserves the new budget, so "a relaunch reserves the same output budget" is false there, and the hold skips a retry the edit might have rescued. (was: no BACKLOG row; PR #275) — #275's council round 2, A2 (minor). The clause is `run-retry-gate.js :: OUTPUT_LENGTH_SKIP_CLAUSE`; a per-wave engine (`run-server.js :: acquireRunServer`) reads the budget once, at its own spawn (`opencode-client.js :: startServer`).
- [ ] **B-CL-16** (new 2026-09-29) — Lift run-stages.js's inline skipped-leg note beside `run-retry-gate.js :: outputLengthSkipClause`, which frees about 13 lines; #275 left the file at 298 of 300. (was: no BACKLOG row; PR #275) — the note is built inline in `run-stages.js :: runStage1`; `npm run check:sizes` is the live count (B-SZ-1).
- [ ] **B-CL-17** (new 2026-09-29) — ⛔ If `run-retry-group.js :: groupStage1Losses` ever stops holding every `OUTPUT_LENGTH` leg, have the retry pass (`run-retry.js :: retryStage1Losses`) return its held legs explicitly. The T-A5 exemption in `run-stage1-superseded.js :: supersededRows` keys on the death class (`run-retry-gate.js :: isOutputLengthLoss`), not on held membership, which is exact only while the grouper holds every such leg. (was: no BACKLOG row; PR #275) — tests/council/run-retry.test.js's "D-06: an OUTPUT_LENGTH death is held out of the once-only retry" pins that routing, so a change to it reds first (the `run-retry-gate.js` module docblock).
- [ ] **B-CL-18** (new 2026-09-29) — Reword the comment above tests/council/run-retry.test.js's "D-06: an OUTPUT_LENGTH death is held out of the once-only retry", which says the retry "would run on the same engine", to the gate's qualified wording, "an engine started from the same config.json" (nit). (was: no BACKLOG row; PR #275) — the qualified wording is the `run-retry-gate.js` module docblock's; a per-wave engine is not the same engine (B-CL-15).

### routing-catalog

- [ ] **B-RC-1** — Stop the second network fetch on the no-cache refresh-failure path. (was L290; —) — src/utils/model-catalog.js:37-41 (a cache needs `models`), :101-102, :177. Reached from src/sidecar/models.js:94-95 and electron/ipc-setup.js:221-224, whose comment claims it avoids a second fetch.
- [ ] **B-RC-2** — Allow a per-route output-ceiling override for a model neither catalog knows. (was L7979; #218 closed) — limits come only from the catalog cache (src/utils/config.js:404-407); src/utils/local-providers.js has no limit field.
- [ ] **VCMD-5** — Add the direct-openai exception to the default wording of the doctor output-budget row. (was L8039a; #218) — src/utils/doctor-output-budget-check.js:145, :159.
- [ ] **VCMD-6** — Stop an alias set made only of direct-openai routes printing "0 of 0 alias routes". (was L8039b; #218) — src/utils/doctor-output-budget-check.js:100.
- [ ] **V16-follow-up** — Revalidate on key add (the filed follow-up to v4.9 ruling V16). (was L8340b; #195 closed) — only the launch-time hint exists (src/utils/gateway-router.js:102-107).
- [ ] **#207-r6-A2** — Run the CLI-side alias audit after the handler's validation, so rejected runs compute no notices. (was L8658; —) — src/cli-council-run-bench.js:153-160; 12 `failJson` exits follow it in src/cli-handlers-council-run.js (:135 to :219).
- [ ] **B-RC-3** — ⛔ Check `closed` before `renderScreen`, so a Ctrl-C during the inline refresh paints no screen. (was L8759c; #238 closed) — src/sidecar/aliases-review.js:159-161.
- [ ] **B-RC-4** — Stop ids longer than 44 columns pushing the `amicus aliases` state column right (cosmetic). (was L8765; #238) — src/sidecar/aliases.js:201.
- [ ] **B-RC-5** — Reword `N alias update(s) available` for `add` proposals once `notable` ships (waits on that trigger). (was L8837; #238) — src/utils/alias-notice.js:197; `"notable": []` at src/utils/curated-pins.json:155.
- [ ] **B-RC-6** — Drop the "1 hour old" floor in `catalogAgeText` (cosmetic; two pins and the Electron banner change together). (was L8839; #238) — src/utils/alias-refresh-state.js:82; pinned at tests/utils/alias-refresh-state.test.js:129.
- [ ] **B-RC-7** — Persist the serving upstream per leg once the engine exposes it; re-run scripts/probe-provider-routing.js at the next engine bump. (was L9064; #202) — the engine is still 1.18.15 (package.json:81, :84); no upstream field in src/utils/leg-riders.js:38-45.
- [ ] **#257-r3-C2** — Warn before a run when a seat keeps losing by promotion. CHANGELOG and ROADMAP already tell users this is filed. (was L9219; #257) — no doctor check (src/cli-handlers-doctor.js:134-237); CHANGELOG.md:114, docs/ROADMAP.md:646.
- [x] **GOA-5** — Add a scout seat: k−1 seats on merit plus one rotating under-sampled seat. GoA; needs GOA-1; closed 2026-09-28 by D-07 (parked; the design stays in docs/superpowers/plans/2026-08-05-goa-paper-review-adoption-notes.md). (was L1299; —) — nothing in src or electron.
- [x] **GOA-6** — Treat `lowN` as prior-vs-evidence in the picker. GoA; needs GOA-1; closed 2026-09-28 by D-07 (parked; the design stays in docs/superpowers/plans/2026-08-05-goa-paper-review-adoption-notes.md). (was L1307; —) — `lowN` is display-only (src/council/ledger-stats.js:77; src/cli-handlers-council.js:93).

### config-io

- [ ] **B-IO-1** — Absolutize `AMICUS_PROJECT_DIR` in `recordSession`, or treat a non-absolute entry as cannot-confirm, so `doctor --fix` cannot prune a live entry. Worse than recorded: the env route is real. (was L1717; #40 closed) — src/mcp-server.js:165-168, :82-84; src/utils/project-path.js:27-60; src/utils/session-index-prune.js:72-76.
- [ ] **SI-22.4-r3** — Pin the `__proto__: null` literals in src/sidecar/setup.js by exporting `resolveChoice` (owner: Christian). (was L3695; —) — src/sidecar/setup.js:117, :56, :137; the exports at :744-758 omit it.
- [ ] **B-IO-2** — Print one summary line above the N conversion Notices on the first save after upgrade. (was L8763; #238 closed) — src/utils/alias-state.js:55 calls `notify` once per key; src/utils/config.js:95, :123.
- [ ] **B-IO-3** — Sweep orphaned `.config.json.<pid>.<hex>.tmp` files. (was L8907; PR #261) — src/utils/session-index-tmp-sweep.js:32-34 filters the sessions-index prefix only; the name comes from src/utils/atomic-write.js:29.
- [ ] **B-IO-4** — Keep a dangling `config.json` symlink a symlink on save (an `lstat` + `readlink` fallback). (was L8910; PR #261) — src/utils/config.js:106-111 (its own comment calls this a follow-up).
- [ ] **B-IO-5** — Qualify atomic-write.js's crash-safety claim (process crash, no fsync). (was L8912; PR #261) — src/utils/atomic-write.js:4-6; the qualifier exists only at src/utils/config.js:115-117.
- [ ] **B-IO-6** — Stop a POSIX filename containing a literal backslash splitting into pseudo-segments. (was L8923a; PR #262) — src/utils/env-write-guard.js:72-74.
- [ ] **B-IO-7** — Stop `saveApiKey(provider, key, null)` throwing a TypeError. (was L8923b; PR #262) — src/utils/api-key-store.js:195 → src/utils/env-raw-store.js:54 → src/utils/env-write-guard.js:139-140 (the `= {}` default does not replace `null`).
- [ ] **N-14** (new 2026-09-27) — Reword the two comments that cite ruling "R16-1", which is defined nowhere, to cite the R16 prune record by title (the owner's ruling R16 of 2026-08-16; its R16-2/R16-3 calls are at BACKLOG-ARCHIVE.md L1685 and L6551). (was: no BACKLOG row; —) — src/utils/session-index-prune.js:15, :176; "R16-1" has 0 hits in BACKLOG-ARCHIVE.md and docs/.

### gui-electron

- [ ] **B-GUI-1** — Pin the free-picker's missing-`name` fallback (nit). (was L295; #27 closed) — electron/setup-ui-council.js:72; no such case in tests/electron/setup-ui-council.test.js.
- [ ] **PR1F-4** — ⛔ Paint the retry marker on the live tick, not only on the terminal path. This is a render-layer fix, not the "data-layer change" the record says. (was L1583; —) — `retriedSeats` is called only in `renderSeatsPanel` (electron/workspace-ui/workspace-seats.js:144); live tick at workspace-verbs.js:130-131.
- [ ] **B-GUI-2** — Drive the UI to see whether a click on the synthetic UNATTRIBUTED matrix cell silently does nothing. (was L3091; —) — electron/workspace-ui/workspace-matrix.js:79-89; workspace-panels.js:114-143.
- [ ] **B-GUI-3** — Widen the `retriedSeats` / `deadSeats` drift pin to twins, or reword its docblock, which still calls PR5b's M3/M4 "deferred" (they shipped in PR5c). (was L6694; —) — tests/workspace/workspace-seats.test.js:444-449.
- [ ] **B-GUI-4** — End the offer session when a setup window closes without Finish. (was L8374; —) — `endSession` (electron/offer-session.js:41-47) is called only from the setup-done handler (electron/ipc-setup.js:114).
- [ ] **B-GUI-5** — Show the `seatsReviewed` census in the Workspace. (was L8734; #242) — 0 hits in src/workspace and electron; written at src/council/verdict.js:148.
- [ ] **B-GUI-6** — Stop `⌄ choose…` committing on `change`, which stages every option an arrow key passes over. (was L8809; #238) — electron/setup-ui-alias-review.js:180-185.
- [ ] **B-GUI-7** — Ask the row classifier in `commitNew` instead of hard-coding `pinned`, and replace the source-regex pin. (was L8817; #238) — electron/setup-ui-alias-script.js:280, :288 vs :210; pin at tests/setup-ui-alias-script-dom.test.js:282-291.
- [ ] **B-GUI-8** — Add a DOM test that drives `commitModel` from the change event to the Review step. (was L8819; #238) — electron/setup-ui-alias-script.js:201-214 has 0 test references.
- [ ] **B-GUI-9** — Close the partial-commit gap when `seedFreeCouncil` throws after the single save. (was L8821; #238) — electron/ipc-setup.js:159-161.
- [ ] **B-GUI-10** — Drop the renderer's own key probe before save, which costs two round trips and leaves a revoked-between window. (was L8920; PR #262) — electron/setup-ui-keys-script.js:67, :69; electron/ipc-keys.js:92.
- [ ] **B-GUI-11** — Log a warning on save-key's empty-key refusal. (was L8922; PR #262) — electron/ipc-keys.js:81; only the 401 arm warns (:93-97).

### ci-tests

- [ ] **REL-2** — Point `mcp-repomix-e2e` at a real project in some workflow, so plugin-chain MCP discovery runs somewhere. (was L443; —) — it skips unless `AMICUS_REPOMIX_E2E_PROJECT` is set (tests/mcp-repomix-e2e.integration.test.js:29-37), and no workflow sets it.
- [ ] **TST-1** — Add a real `--debate` fixture and drive the Workspace drill-in through it. (was L443; —) — no debate fixture under tests/fixtures/; the drill-in uses a stub (tests/workspace/workspace-app-boundary.test.js:206-223).
- [ ] **B-CI-1** — Clear electron-toolbar-e2e's two 3 s SIGKILL fallback timers when `close` wins (the holder already fixed in the MCP suites). (was L498b; —) — tests/electron-toolbar-e2e.integration.test.js:166-169, 178-181 (not measured).
- [ ] **B-CI-2** — Close the citation gate's blind spots:
  - join wrapped lines;
  - accept quoted-title symbols, bare `:NNN` continuations and `.md` targets;
  - check a line cite against its content;
  - state the counting rule behind "3639".
  - (was L4103, L4125, L4149, L4161 (Mechanisms A–D), L4205, L4092, L3762, L9112; #251) — scripts/check-citations.js:101-118 (one line at a time), :80 (identifier-only), :74-82 (`.js` only), :277-282 (range only), :52 (src/electron/tests only), :35 and docs/CITATIONS.md:82 ("3639").
- [ ] **B-CI-3** — Rewrite the rotted line citations as symbol cites (was L2916, L2923, L2928 (T2.4 citations 1–3), L8407a, L8916; #280, whose last two items are more of them):
  - src/council/ledger.js:45, src/council/report.js:122, src/workspace/seat-space.js:22;
  - eight src/mcp-server.js cites, plus src/workspace/live-normalize.js:15-16, tests/pack/mcp-pack-params.test.js:544 and tests/mcp-tools.test.js:791-792;
  - src/utils/engine-variants.js:70, tests/utils/engine-variants.test.js:24 and tests/build-provider-models-local.test.js:84;
  - add N-09 (new 2026-09-27): src/council/run-stage2-judge.js:5 cites `BACKLOG:9161`, which was already 15 lines early (the "#257 (build, E1 review M6)" entry is BACKLOG-ARCHIVE.md L9176, and L9161 is inside the #257 R10 reader record), so cite the entry by title.
- [ ] **B-CI-4** — Keep a mutant-name registry; names collided twice in v4.8 (owner: Christian). (was L3702; —) — only per-area records exist (tests/council/*-mutants.js).
- [ ] **SI-27-r1** — Give mutant COLLIDEID a second pin. (was L3752; —) — one carrier only: tests/council/run-retry-launch.test.js:79 (named again at :24).
- [ ] **SI-25-r2** — Run the byte-identity pin of SI-25's R25-2 invariant on more than one small bench. (was L3834; —) — tests/council/chair-packet-seats.test.js:80-103 uses one two-seat fixture.
- [ ] **T-A8-PARTIALSKIP** — Pin the unmappable skip branch with a unit of ≥2 `srcLegs`. (was L4053; —) — the gap is recorded at tests/council/run-retry.test.js:1088-1104.
- [ ] **B-CI-5** — Capture the full `●` block the next time `docs-plan-refs.test.js` fails. The race between its directory walk and file reads is a hypothesis, not measured. (was L4211; —) — tests/docs-plan-refs.test.js:27, unchanged since 5419b6c4.
- [ ] **B-CI-6** — Widen run-retry-keys.test.js's require-scan to `require (` and `import(`. (was L4232a; —) — tests/council/run-retry-keys.test.js:42.
- [ ] **B-CI-7** — Replace T-A6's last-hop `twins` source pin with a behavioural pin. (was L4232c; —) — tests/council/run-retry-twins-threading.test.js:121-123.
- [ ] **B-CI-8** — Pin the abort-branch half of "one twin bound, one not". (was L4595; —) — the abort branch is src/council/run-stages.js:91-112; the only twin abort test is lens-mode with both bound (tests/council/run-stages.test.js:790).
- [ ] **B-CI-9** — Promote the darwin A4 parity diff from REPORT-ONLY once a clean run exists. (was L7000; —) — scripts/probe-darwin-extract.js:285, :309; docs/electron-testing.md:523-526.
- [ ] **B-CI-10** — Make the CI pre-flight stop a seat that resolves to something else, not only one that resolves to nothing. (was L7101; —) — .github/workflows/council-review.yml:392 (`getEffectiveAliases` merges the defaults back in), :342-344, :395-405.
- [ ] **B-CI-11** — Put each lost seat's cause (`degrades[].data.reason`) in the PR's sticky comment. (was L7115; —) — council-review.yml:1724 and :1835-1877 print counts only; confirmed by the #257 spec :411.
- [ ] **B-CI-12** — Give tests/e2e.test.js "should pass model to SDK sendPromptAsync call" a per-test timeout (two timeout hits). Slices 6 and 7 each merged it into the other; it is one item. (was L8219, L8736b; —) — tests/e2e.test.js:388-402 passes no timeout (re-read); runs 33180625912, 34777725713.
- [ ] **#206-r4-C4** — Make the F-1 doc pin placement-aware; today it checks one section-global set. (was L8622; —) — tests/mcp-tool-params-docs.test.js:84, :93-95, :98-101.
- [ ] **B-CI-13** — Add a hostile `shipped` fixture so `renderScreen`'s wrap is load-bearing. (was L8759a; #238) — src/sidecar/aliases-review-render.js:103; the hostile test uses `shipped: null` (tests/sidecar/aliases-review.test.js:305-320).
- [ ] **B-CI-14** — Test aliases.js's catalog-unavailable Notice with a hostile `getCatalogInfo` throw. (was L8759b; #238) — src/sidecar/aliases.js:103; no test asserts it.
- [ ] **B-CI-15** — Settle the "environment torn down" noise from ipc-setup-catalog-snapshot.test.js with one jest run. (was L8813; —) — tests/electron/ipc-setup-catalog-snapshot.test.js (its only change since the cut was to mock factories).
- [ ] **B-CI-16** — Test the `homedir() === null` branch of the env write guard. (was L8923c; PR #262) — src/utils/env-write-guard.js:145.
- [ ] **B-CI-17** — Bound `HEX_RE` in the token-drift test so `#262` stops reading as a colour. (was L8926; PR #262) — tests/electron/electron-token-drift.test.js:80.
- [ ] **B-CI-18** — Escape `%`, CR and LF in workflow annotations. (was L8938b; PR #264) — .github/workflows/council-review.yml:604.
- [ ] **B-CI-19** — Key the hermetic scratch dir by worktree as well as by jest worker. (was L8947; —) — tests/setup/hermetic-config-dir.js:25-26.
- [ ] **B-CI-20** — Order the pre-commit docs regen after the test gate, or document the ordering, and fix CONTRIBUTING's "CLAUDE.md marker regen" (the markers live in docs/architecture-map.md). (was L9125; #251) — .husky/pre-commit; scripts/generate-docs.js:254; CONTRIBUTING.md:28-30 (re-read).
- [x] **B-CI-21** (new 2026-09-28) — Run `validateCrossLinks` on README and docs/*.md as well as CLAUDE.md: the cross-file half of the v4.7 docs PR's F-6 (decided D-10). (was L1856; —) — `generate-docs.js :: validateCrossLinks` has two callers, `runCheckMode` and generate-docs-check.test.js's "CLAUDE.md cross-links all resolve", and both pass it CLAUDE.md only. package.json `files` ships `docs/*.md`, and npm ships README. In-page anchors are already gated for README and docs/*.md (tests/docs-anchors.test.js). — done in #278 (e36be7fc): `--check` and the test share `generate-docs.js :: collectCrossLinkErrors`, over CLAUDE.md, README.md and every top-level docs/*.md, each resolved against its own directory; a link that leaves the repository is refused.
- [ ] **B-CI-22** (new 2026-09-29) — Add a real-archive test in which an ordinary extraction failure carries a hostile entry name, end to end through the sanitizer; building one needs a CRC override in tests/helpers/zip-fixture.js. (was: no BACKLOG row; PR #274) — no such test exists (#274's body, "Not in this PR"); `zip-fixture.js :: buildZip` always writes the true CRC.
- [ ] **B-CI-23** (new 2026-09-29) — Give the round-2 sanitizer test a positive control that proves the entry name is still dangerous before sanitization; today it relies on the entry's UTF-8 flag. (was: no BACKLOG row; PR #274) — tests/electron-refusal-sanitize.test.js's "one layer down, the in-memory extractor throws an already-safe refusal (RAWCOMPOSE)".
- [ ] **B-CI-24** (new 2026-09-29) — Sweep the dead message shape out of two tests: tests/electron-artifact-custody.test.js and tests/electron-trust-wiring.test.js still build `robustExtract`'s `refusing to extract <zip>: …` refusal, which no live producer writes, though neither asserts on it. (was: no BACKLOG row; PR #274) — #274's body, "Not in this PR".
- [ ] **B-CI-25** (new 2026-09-29) — Make the phantom-dependency scan see `import(...)`, and an `import` in a shipped `.mjs` (none ships today); it reads `require(...)` only. (was: no BACKLOG row; PR #274) — tests/no-phantom-dependencies.test.js's "no phantom dependencies in shipped code". An older gap, which #274's final review found and did not cause.
- [ ] **B-CI-26** (new 2026-09-29) — Harden the stale-import guard, a text scan that misses a computed property access, an `import`, or a require whose path is not a string literal (none exists today). (was: no BACKLOG row; PR #274) — tests/no-phantom-dependencies.test.js's "no stale importer of what unzip.js no longer exports (council round 4, A3)".
- [ ] **B-CI-27** (new 2026-09-29) — Gate `packaging/` automatically: a static check, or a Windows CI job that runs the Chocolatey stub harness. Today the harness is read by hand, and only the nuspec's `<version>` pin is tested (tests/scripts/package-manifest.test.js). (was: no BACKLOG row; PR #278) — the harness, 22 cases on Windows PowerShell 5.1 and PowerShell 7, is kept outside this repo in the owner's notes at C:/Users/sendt/OneDrive/AIProjects/SecondBrain/output/2026-09-28-amicus-approved-work/lane-e-choco-harness/.
- [ ] **B-CI-28** (new 2026-09-29) — Gate the docs' factual claims: nothing checks the ROADMAP's SHAs, the registry dates or the docs' glob claims. (was: no BACKLOG row; PR #278) — #278's council round 2, D3: every such claim was verified true by hand (`git show`, `git blame` and the saved registry records), and a gate was left as the follow-up.
- [ ] **B-CI-29** (new 2026-09-29) — Validate README's `<img src>` links: `generate-docs.js :: validateCrossLinks` reads only `[text](target)` links, and README's eight cards are `<img src="./docs/cards/…">`. (was: no BACKLOG row; PR #278) — #278's body, "Not in this PR".
- [ ] **B-CI-30** (new 2026-09-29) — Decide whether D-10's cross-link roster (`generate-docs.js :: collectCrossLinkTargets`: CLAUDE.md, README.md and the top-level docs/*.md) extends to the other markdown the package ships: `CHANGELOG.md`, `skills/**/*.md` and `commands/*.md`. (was: no BACKLOG row; PR #278) — package.json `files` ships `CHANGELOG.md`, `skills/` and `commands/`.
- [ ] **B-CI-31** (new 2026-09-29) — Add a win32-gated absolute drive-letter row, such as `D:\evil`, to `electron-install.test.js :: ESCAPES`, the table of "resolveElectronBinary refuses a path.txt name that climbs out of its directory (D-03, B-SEC-6)". `electron-exe-rel.js :: containedExe` already refuses that form through its `path.isAbsolute` arm, but nothing pins it. The row must be gated to win32, because on POSIX `C:\…` is a plain filename inside `dist/`. (was: no BACKLOG row; PR #276) — #276's body, "Not in this PR" (a deferred minor of its Tasks 1-2 review). Its final review measured the joined form as inert on Windows (`existsSync` is false for `dist\C:\Windows\System32\cmd.exe`), so the row pins a refusal and closes no hole.
- [ ] **B-CI-32** (new 2026-09-29) — Make the paid live rail green. `integration-live.yml` fails the same three suites at v4.14.1 and at 4.14.2, so today the rail gates nothing. `electron-toolbar-e2e` (10 tests) never finds its toolbar target ("Toolbar target not found after 20000ms"), and the cause is not yet measured: the runner's install leaves the Electron binary unprovisioned, `electron/index.js` downloads it lazily at `require`, and `electron-toolbar-e2e.integration.test.js :: ensureDisplay` starts Xvfb. `mcp-headless-e2e` (2 tests) and `shared-server-e2e` (1 test) each lose one real-LLM session that stalls until the test's cap ("timed-out"; in the shared-server run, 2 messages from 15 s to 120 s), the #202 heavy-tail class. (was: no BACKLOG row; the 4.14.2 cut) — runs 36569483894 (main 4c41e76b) and 36572266816 (tag v4.14.1) have identical signatures: 13 failed, 14 skipped and 78 passed of 105. The workflow first ran on 2026-09-29.

### size-refactor

- [ ] **B-SZ-1** — Extract before editing any gated file at the cap (Release Constraint 6: "extract, never shave"), starting with the 18 at 300/300. Keep no size tables in BACKLOG: `npm run check:sizes` is the live count (the v4.8 spec's ruling R19).
  - (was L823, L269, L291, L656, L875, L878, L1715, L2863, L3560, L3845, L3869, L3902, L4255, L4277, L6563, L8262, L8325, L8741, L9265; —)
  - Evidence: 382 gated files, 18 at exactly 300/300, 42 at ≥291 and 0 over at 8e08a63d. Slices 2 and 4 measured this independently with the gate's rule (scripts/check-file-sizes.js:53-54).
  - The 18: `provider-default-picker`, `engine-skew`, `resume`, `fanout`, `electron-layout`, `conversation-mirror`, `aliases-review`, `pack-resolve`, `mcp-council-run`, `run-server`, `run-retry`, `run-retry-notes`, `run-debate`, `run-debate-revote`, `report`, `debate`, `workspace-seats`, `live-dead-seats`.
- [ ] **B-SZ-2** — Split scripts/probe-provider-routing.js (308 lines) when a round adds cases. It sits outside the gate. (was L9068; #202) — scripts/check-file-sizes.js:20 gates only src/** and electron/**.

### spend-pricing

- [ ] **B-SP-1** — Add a direct test for `mode: 'interactive'` spend rows (nit). (was L296; —) — the mode is set at src/sidecar/start.js:228; no test asserts it.
- [ ] **#267** — Size the hidden title request against the OpenRouter dashboard (free), then suppress it or set `small_model`, and add the docs/council.md spend note (Ask 4). (was L9055; #267) — src/opencode-client.js:148 creates sessions with no title; no `small_model` in src. The refusal survey adds evidence: title calls reserve 32000 tokens and were refused too (new 2026-09-27: seven title-agent calls, `small=true`, `google/gemini-3.7-flash`, were refused on 2026-08-15; the refusal survey, §3c and §7.6).
- [ ] **B-SP-2** — Stop a `MAX_COST` containing a newline firing the "capped" notice with nothing clamped. (was L8938d; PR #264) — .github/workflows/council-review.yml:574-575 vs :1372.
- [ ] **B-SP-3** — Stop an all-free `workflow_call` bench reading as unpriced on every run. (was L8938e; PR #264) — src/utils/council-credit-reservation.js:118-120; the warning prints at src/utils/council-credit-preflight.js:225.
- [ ] **B-SP-4** — Bound the models-price fetch by wall clock, not socket inactivity. (was L8938f; PR #264) — src/utils/council-credit-reservation.js:229 (`req.setTimeout`), :201.
- [ ] **B-SP-5** — Make `sumPerMessageUsage` report "no usage observed" instead of all-zero totals; CHANGELOG, troubleshooting and a test point at this seam. (was L9264; #257) — src/utils/pricing.js:24-36; CHANGELOG.md:104; docs/troubleshooting.md:236; tests/council/degrade-contract.test.js:243-244.
- [ ] **N-05** (new 2026-09-27) — Stop `amicus spend --group-by tag` without `--json` silently printing the by-model view: render the groups in human output, or reject `--group-by` without `--json` with a message. The output is wrong and nothing warns. (was: no BACKLOG row; a v4.7 PR3 rider never transcribed, no issue) — src/cli-handlers-spend.js:253 computes `groups`, and :271 `renderHuman({ total, byModel, windowDays, credit, wasted })` drops them; the rider is at docs/superpowers/plans/2026-08-07-v47-pr3-f8-tags-search.md:20, :259, :267.

### security-redaction

- [ ] **B-SEC-1** — Sweep the module-level lookup tables for model-keyed ones that need `__proto__: null`. (was L5795; —) — src has 38 `const X = {` tables (34 when filed); 3 are null-prototype (src/council/tally.js:42, report.js:25, debate.js:29).
- [ ] **B-SEC-2** — Evaluate the in-function `byId = {}` maps keyed by finding id (the same family). (was L5814; —) — src/council/debate.js:84, :200.
- [ ] **B-SEC-3** — Route `spend`'s credit probe through the live-probes gate and extend the pin. (was L8199; —) — src/cli-handlers-spend.js:126 calls `checkOpenRouterCredit` raw; the gate is src/utils/doctor-key-auth-check.js:133-147; the pin is tests/api-key-validation-structured.test.js:305-335.
- [ ] **B-SEC-4** — Defang the inbound fence's own close tag in `fenceSidecarOutput`. (was L8440; —) — src/utils/untrusted-fence.js:38-47 interpolates `${body}` raw.
- [ ] **#206-r4-C1** — Match a non-whitespace character before `>` in the outbound close-tag defang (same file as B-SEC-4). (was L8573; —) — src/utils/untrusted-fence.js:73-74 allows only `\s*`; the open pattern at :84-85 has the needed shape.
- [ ] **#263-B1** — Route the session-probe `detail`, and the retry arm's engine message, through provider-error redaction. (was L8930; PR #263) — appended at src/headless.js:335; rendered through `collapseExcerpt` only (src/utils/session-status.js:149-159, :166).
- [ ] **B-SEC-5** — Bring `buildRoutingFailureLeg` inside the redaction-perimeter test. (was L8935; PR #264) — tests/utils/redaction-perimeter.test.js:110-126 lists only `error:` literals; src/sidecar/fanout-leg.js:73-86.
- [ ] **N-02** (new 2026-09-27) — Rotate the CI OpenRouter key, so the 64-character key-management id from the refusal URL (`…/keys/<id>`), which sits unredacted in 8 public council-review job logs, is dead. Owner action, no code. Rotation keeps the logs and artifacts, which are evidence (N-08); deleting the 8 logs is the alternative, and it cannot be undone. (was: no BACKLOG row; —) — the refusal survey, §7.5 (measured; all 8 carry one CI key, compared by hash). The 4.12.0 redaction (src/utils/redact-provider-error.js:42) protects new text only. The runs' unexpired artifacts probably carry the id too (inferred; measured only for run 35143585179). The CI key was rotated on 2026-09-28; mark this done once the owner confirms the old key is deleted.
- [x] **B-SEC-6** (new 2026-09-28) — Give `resolveElectronBinary` the containment bound `distHeldExe` has: refuse a `path.txt` name that resolves outside `dist/`, before the spawn (decided D-03). (was L7355; follow-ups #282) — `electron-install.js :: resolveElectronBinary` joins the `heldExeRel` name onto `dist/` unchecked, and `isElectronUsable` is a bare `existsSync`, so with `path.txt` = `../SIBLING` a file outside `dist/` reads as usable (`repairElectron` never runs) and is the path handed to the spawn. `electron-exe-rel.js :: distHeldExe` already refuses a name whose path relative to `dist/` escapes it or is absolute. — done in #276 (d567a595): both now share `electron-exe-rel.js :: containedExe`, so such a name resolves to null, is not usable, and is re-provisioned instead of spawned.
- [x] **B-SEC-7** (new 2026-09-28) — Refuse when `checksums.json` exists but has no row for the requested electron file, naming the version and the fix; keep allowing only when there is no table at all, the legacy case (decided D-02). (was L7402; follow-ups #282) — `electron-trust.js :: expectedDigest` returns null both when there is no anchor and when the table lacks the file, and `verifyArtifactBytes` then returns `{ verdict: 'no-digest', allowed: true }` for either. The allow exists for packages that predate `checksums.json`, since refusing those would loop re-downloads (the comment above `verifyArtifactBytes`); a present table that lacks the version is the attacker-chosen case. The allow is disclosed in CHANGELOG.md's 4.9.6 entry. — done in #276 (d567a595): `electron-trust.js :: isUnlisted` tells the two nulls apart, and `repairElectron` refuses before any download (`electron-refuse.js :: refuseUnlistedArtifact`). By the owner's ruling Q2 (2026-09-28), `AMICUS_ALLOW_UNVERIFIED_ELECTRON=1` still accepts such a file, marked unverified; "no table at all" is implemented as no usable table (missing, unparseable, empty, or with no well-formed sha256 row).
- [ ] **B-SEC-8** (new 2026-09-29) — If an `UNSAFE_PATTERNS` entry ever needs a flag or a backreference, classify with `UNSAFE_PATTERNS.some((p) => p.test(msg))`. `zip-from-buffer.js :: NAME_REFUSAL` joins the patterns' sources with `|`: an exact union, since `|` binds loosest, but it drops each pattern's flags and would renumber a backreference. No pattern has either today. (was: no BACKLOG row; PR #274) — #274's body, "Not in this PR" (its council round 4, A1); the list is `unzip.js :: UNSAFE_PATTERNS`.
- [ ] **B-SEC-9** (new 2026-09-29) — Give the `unlisted` refusal a field that tells version skew from an unsupported platform, so each hint can pick by kind. `electron-refuse.js :: refuseUnlistedArtifact` words the two branches differently but returns the same `integrity: 'unlisted'`, so `doctor-electron-mcp-check.js :: evaluateElectronMcp` names `npx -y amicus@latest doctor --fix` for both, and `electron-ensure.js :: ensureElectron` appends the generic `amicus doctor --fix` hint to the platform branch. On a host Electron publishes no build for, neither command can help, and no fix exists there. (was: no BACKLOG row; PR #276, #282) — #276's body, "Not in this PR" (its final review, M8(d)). Supported hosts never reach the platform branch. #282's multi-copy hint item concerns the same choice in `evaluateElectronMcp`.
- [ ] **B-SEC-10** (new 2026-09-29) — Stop a prerelease row satisfying the `covered` test in `electron-refuse.js :: refuseUnlistedArtifact`. A `v43.1.1` request asks whether any key starts with `electron-v43.1.1-`, and `electron-v43.1.1-beta.1-…` does, so the refusal takes its platform wording (Electron "publishes no build for this platform") for what is really version skew. Only a hand-installed prerelease table can reach this; `^43` never resolves to one. (was: no BACKLOG row; PR #276, #282) — #276's body, "Not in this PR" (its final review, M8(c)). #282's first item is the same prefix test misreading a table whose row for this platform is malformed.
- [ ] **B-SEC-11** (new 2026-09-29) — Pass the artifact name through `collapseExcerpt` in the nine older refusal lines that still print it raw, as `refuseUnlistedArtifact` now does (defence in depth). Eight are in four pre-existing helpers, two lines each: `electron-refuse.js :: refuseUnsafeArchive`, `electron-refuse.js :: rejectCachedZip`, `electron-refuse.js :: rejectDownloadedZip` and `electron-refuse.js :: refuseUnreadableArtifact`. The ninth is in `electron-repair-cache.js :: repairFromCache`. (was: no BACKLOG row; PR #276, #282) — none is reachable with an unchecked name today: `electron-install.js :: repairElectron` is the only production entry to all nine (directly, or through `repairFromCache` and `electron-provision.js :: controlledProvision`), and it refuses a name that fails `electron-custody.js :: isSafeArtifactName` before any of them runs. That is the finding of the scoped re-review of #276's council-round-1 fixes, recorded in the lane-B ledger (the owner's notes, outside this repo: C:/Users/sendt/OneDrive/AIProjects/SecondBrain/output/2026-09-28-amicus-approved-work/lane-b-sdd/progress.md) and stated in #276's body, "Not in this PR"; the callers re-read on main at dc778353 agree. #276 sanitized only `refuseUnlistedArtifact`, the trust gate's lines and the download route's own lines; inline wraps are line-neutral, and electron-refuse.js is at 291 of 300. #282's platform-and-arch item is the same class of raw interpolation.

### docs

- [ ] **B-DOC-1** — Reword docs/architecture.md:25, which frames the fold handoff as a push. (was L239; —) — unchanged since 2026-07-03 (docs/architecture.md:25).
- [ ] **#177-B2** — Break up the 583-character `meta.models` table cell (nit). (was L2733; —) — docs/council.md:774.
- [ ] **B-DOC-2** — Fix three defects in scripts/generate-docs-helpers.js; the third fix also retires the load-bearing export-order comment (#207 r6 A4). (was L8284a, L8284b, L8284c, L8698; —)
  - Docblocks under `'use strict'` are missed (:40-50), which leaves 138 empty Purpose cells in docs/architecture-map.md.
  - Constants render as `name()` (:230).
  - Exports are silently capped at 5 (:107); the order comment sits at src/cli-council-run-bench.js:163-178.
- [ ] **N-10** (new 2026-09-27) — Say "in the repository, not the npm package" wherever a shipped doc points npm users at BACKLOG, as docs/ROADMAP.md:36 and :103 already do. The section titles still resolve through this file's Reference index and Moved sections. (was: no BACKLOG row; —) — docs/configuration.md:114 ("the four probe tables filed in `BACKLOG.md` under 'v4.9.4 records'"), :167; docs/council.md:1112; docs/troubleshooting.md:236; eight docs/ROADMAP.md lines. `package.json` `files` ships `docs/*.md` but not BACKLOG.md.
- [x] **N-11** (new 2026-09-27) — Fix two stale shipped docs in one docs PR: docs/DISTRIBUTION.md:161 still says "Status: wired, not yet published (Phase 9c)", though BACKLOG-ARCHIVE.md L162 records the MCP Registry as published; docs/ROADMAP.md:285-299 strikes only LC-5, though CA-4, RN-1, RN-5, RN-11, TST-2 and TST-3 have shipped. Pairs with D-13. (was: no BACKLOG row; —) — both re-read at 8e08a63d. — done in #278 (e36be7fc): the MCP Registry section reads "Status: published" (since v1.9.1, 2026-07-03), and the ROADMAP's "Deferred out of v4.4.1" table strikes all six.
- [x] **N-12** (new 2026-09-27) — One comment-only PR for the comments that point at old structures. (was: no BACKLOG row; —) — done in #278 (e36be7fc): every bullet below except CONTRIBUTING.md's wording, which is B-CI-20's.
  - .eslintrc.js:76-82 says "Tallied and deferred to v4.5; see BACKLOG.md", which the v4.8 spec's ruling R17 superseded.
  - .eslintrc.js:112 says ":159 is toCanonicalDefault itself", but the primitive is `stripGatewayPrefix` (src/utils/curated-models.js:129).
  - src/cli-council-run-bench.js:165, src/utils/untrusted-fence.js:142 and src/utils/engine-skew.js:287 still say "CLAUDE.md's Key Exports"; the table has lived in docs/architecture-map.md since 46d2694a.
  - CONTRIBUTING.md:28-30's wording is in B-CI-20.
  - src/council/parse-stage2.js's header says the repair loop lives in run-stages.js, which holds only the Stage-1 loop: the Stage-2 judge loop is `run-stage2-judge.js :: adjudicateJudgeLeg` and the chair's ch4 repair is in run-chair.js (found 2026-09-27 by the #244 residue final review).
  - D-22 (decided 2026-09-28): the `mk` `ttftMs` widening is closed, so reword the comments that still describe its consumer (N-07): the eight that name the retired "C2 derivation" as the future reader of `ttftMs`, in src/council/run-stats-entry.js, src/headless.js (two), src/utils/ttft.js, tests/council/run-stats-entry.test.js and tests/no-output-backstop-wiring.test.js (three). N-07 has their dated lines.
  - D-28 (decided 2026-09-28): reword the "Filed, not fixed" comment on the `statSync` age check in `session-index-tmp-sweep.js :: listSessionIndexTmpFiles`, and its twin in session-metadata-tmp-sweep.js, to say that the age check reading the target's mtime is accepted under the owner's Option B ruling (v4.7 PR7, 2026-08-08). Re-read 2026-09-28: only the first says "Filed, not fixed"; the twin is session-metadata-tmp-sweep.js's module header, which notes that its sibling uses `statSync`.
  - D-34 (decided 2026-09-28): add one comment in `fanout-retry.js :: retryFailedWave` saying that a retry wave launched from rendered text has no template provenance: it reads the original wave's rendered `briefing.md` back as its prompt instead of re-rendering the template.
- [ ] **N-15** (new 2026-09-27) — Optionally annotate the v4.8 spec's §10.6 rule with one line pointing at the archive entry that refutes it. (was: no BACKLOG row; —) — docs/superpowers/specs/2026-08-10-v4.8-ask-anything-count-everyone-design.md:657 still requires `COUNCIL_INTENT_MISMATCH`; BACKLOG-ARCHIVE.md L8384 is the only record of the refutation.
- [ ] **B-DOC-3** (new 2026-09-27) — Reword the stats table's `runs` cell in docs/council.md, "Number of ledger rows for this model (one per council run it participated in)": `ledger-stats.js :: countRuns` has counted distinct non-empty run ids since v4.8, and a model can have more than one ledger row in a run (per-executable rows since 4.8.0; B-CV-10). (was: no BACKLOG row; —) — found 2026-09-27 during the #244 residue docs work.
- [x] **B-DOC-4** (new 2026-09-28) — D-07's docs edits: one docs/ROADMAP.md line parking the GoA family (pointing at the adoption notes), and fix the v4.8 spec line that lists GOA-2 as closed with nothing behind it (decided D-07). (was: no BACKLOG row; —) — D-07 closed the nine GOA items here on 2026-09-28. docs/ROADMAP.md's B4 note already says to reconcile GOA-1 with B4 before either is scoped, and not to build both. The v4.8 spec's line puts GOA-2 and SL-4 under "BACKLOG.md's refuted/closed sections", which record neither (BACKLOG-ARCHIVE.md L9476); SL-4 is open work again (D-04). ⚠️ tests/docs-plan-refs.test.js fails on any file under docs/ outside docs/superpowers/ that cites a `docs/superpowers/plans/` path, because plans are pruned at the release cut, so a ROADMAP line that quotes the adoption notes' path fails it. — done in #278 (e36be7fc): the ROADMAP note names the adoption notes by date and title, not by path, and the v4.8 spec carries a dated correction for GOA-2 and SL-4 instead of a rewrite.

### distribution-release

- [x] **BL-10** — Drop the unused `tiktoken` dependency and regenerate the lockfile, riding D-01's PR (owner disposition B40: bundle into any dependency-touching PR). Decided D-01 (2026-09-28): BL-10 rides the same PR as N-06's deletion of `robustExtract` and `extract-zip`. (was L77, L62; —) — package.json:85; `git grep tiktoken -- src` is empty; docs/configuration.md:831 already calls it unused. — done in #274 (dc778353): tiktoken is gone from package.json and package-lock.json, and tests/no-phantom-dependencies.test.js pins that nothing declares or requires it.
- [ ] **B-REL-1** — Add a trailing-slash `IFLNK` entry case to the platform-independent suite. (was L7006a; —) — docs/electron-testing.md:572-575; no such test exists.
- [ ] **B-REL-2** — Clean the plan dir when a native extractor's spawn fails; the `catch` skips `cleanDir`. (was L7262; —) — src/sidecar/electron-native-plan.js:109-112, :122.
- [ ] **B-REL-3** — Measure on darwin whether `path.join` against electron's forward slashes breaks the layout check. (was L7361; —) — src/sidecar/electron-exe-rel.js:45-46; src/sidecar/electron-layout.js:190.
- [ ] **v4.9.5-M11** — Derive `tar.exe` from a trusted path and resolve `powershell` absolutely in the native hatch. (was L7419; —) — src/sidecar/unzip.js:93, :101, reached only through src/sidecar/electron-native-plan.js:103.
- [x] **N-06** (new 2026-09-27) — Drop `extract-zip`, which only dead code carries: `robustExtract` has no production caller. Decided D-01 (2026-09-28): delete `robustExtract` and `extract-zip`; BL-10 rides the same PR. Keep `nativeUnzipPlan`, `UNSAFE_PATTERNS` and `yauzl`, and give the PR its own branch, tests and council round. (was: no BACKLOG row; —) — the definition is at src/sidecar/unzip.js:205, the export at :296, and the only `require('extract-zip')` at :226; `yauzl` is a direct dependency (package.json), so the buffer extractor does not need `extract-zip`. It is the only production dependency with an unfixable advisory. — done in #274 (dc778353), after four council rounds: `robustExtract` and the `extract-zip` dependency are deleted, and `unzip.js` still exports `nativeUnzipPlan`, `MAX_MS` and `UNSAFE_PATTERNS`, which `zip-from-buffer.js :: NAME_REFUSAL` is now built from. extract-zip remains only as a dev-only transitive dependency of puppeteer.
- [ ] **B-REL-4** (new 2026-09-28) — Pursue the community plugin-marketplace listing: find out whether the 2026-07-01 submission landed, and resubmit through the Console form if it did not (decided D-13). (was L160; —) — docs/DISTRIBUTION.md's community-marketplace status has read "submitted 2026-07-01 — awaiting Anthropic review" since that day, and no approval or listing is recorded. Its "Submit" section names the Console form; a PR to the marketplace auto-closes. The same file's stale MCP Registry status is N-11's. #278 (e36be7fc) found that the submission was never listed (re-checked 2026-09-28), and docs/DISTRIBUTION.md now says so; what remains is the owner's resubmission through the Console form.
- [ ] **B-REL-5** (new 2026-09-28) — Publish a Chocolatey package: a `chocolateyInstall.ps1` that runs `npm i -g amicus`, with a `nodejs-lts` dependency and no embedded binary, so no VERIFICATION.txt (decided D-13). The owner decided on 2026-09-29: same-account elevation only. The install refuses to run as SYSTEM, and ends by naming the account and the folder it installed into; there is no machine-wide prefix and no detection of another admin account. It stays open until the owner's elevated install test passes and the package is published (docs/DISTRIBUTION.md's Chocolatey section lists the steps). (was L165; —) — at 8e08a63d nothing existed: no `chocolateyInstall.ps1` or `.nuspec` was tracked. Since #278 (e36be7fc), `packaging/chocolatey/` tracks a drafted, untested `amicus.nuspec`, `tools/chocolateyInstall.ps1` and `tools/chocolateyUninstall.ps1`. The filing rates it medium effort (moderation latency) and prefers it to Scoop, whose contained buckets reject the npm-wrapper form.
- [ ] **B-REL-6** (new 2026-09-28) — List amicus in the third-party MCP directories: claim Glama's auto-indexed entry, submit to PulseMCP and mcp.so, publish to Smithery (`smithery mcp publish`), and open a PR to `punkpeye/awesome-mcp-servers` (decided D-13). (was L167; —) — no listing is recorded, and no directory manifest is tracked. Most of these ingest the official MCP Registry, where amicus is already published. Since #278 (e36be7fc), docs/DISTRIBUTION.md's "Third-party MCP directories" table gives each one's status (checked 2026-09-28): Glama and PulseMCP already list amicus, ingested from the MCP Registry, and PulseMCP needs nothing; Smithery is deferred by the owner, because its publish flow needs a hosted HTTP endpoint or an MCPB bundle and amicus has neither. What remains is the owner's: claim Glama's entry, submit to mcp.so, and open the awesome-mcp-servers PR.
- [x] **B-REL-7** (new 2026-09-28) — Add three steps to docs/publishing.md's "Release checklist": the window sweep (before the version pin, diff `git log <lasttag>..main` against `[Unreleased]` and rule on every commit it does not mention), a clause-by-clause audit of the CHANGELOG's "Known limitations after this release" bullet against the entries above it, and the MCP Registry probe that reads `s.server.version`, not `s.version`. Drop the POSIX teardown smoke (decided D-11). (was L272, L3815, L8144, L8209; —) — none of the three is in the checklist; they run from the machine-local release recipe. The registry moved `version` under `server`, so a probe of `s.version` reads `undefined` and still looks like success. The POSIX smoke needs a macOS or Linux machine the dev loop does not have. — done in #278 (e36be7fc): the checklist gained the window sweep and the per-version MCP Registry probe, which reads `s.server.version`; its known-limits audit is keyed to the whole class of such text, not one title, since the only bullet so titled was retitled at the 4.8.0 cut. The POSIX smoke was only ever a proposal, never a checklist step, so dropping it took no edit.
- [ ] **B-REL-8** (new 2026-09-29) — ⛔ Stop a failed promote writing an escaping `path.txt` back: skip the put-back when the old name escapes `dist/` (`electron-exe-rel.js :: containedExe` returns null for it). When the swap fails, for example with EPERM while an Electron runs from `dist/`, `electron-layout.js :: promoteDist` restores the old name, such as `../SIBLING`, and every GUI launch then re-extracts from the cache and fails until the handle is released. Availability only, and it clears itself; before D-03, that launch spawned the sibling instead. (was: no BACKLOG row; PR #276) — #276's body, "Not in this PR" (its final review, M7). electron-layout.js is at 300/300, so B-SZ-1's extraction comes first.

### engine-opencode

- [ ] **B-ENG-1** — Re-run the #218 probe matrix end to end and re-file its `checks:` line (62 cases). Fix the #218 findings PR-6, PR-7 and m10 in the same pass. (was L7969, L8041, L8042, L8043; #218 closed)
  - PR-6: the `configJson` pin matches any path ending in `/config.json` (scripts/probe-max-tokens.js:914).
  - PR-7: the dump runs before `waitKnown` (:807 before :818).
  - m10: the #218 probe row M12's `expect` text (:611).
  - The script is unchanged since d1dfdb1d.
- [ ] **B-ENG-2** — Add a probe row that prompts right after a cold engine spawn, plus the known-model flip row. Code cites it as "BACKLOG item 3". (was L8013; —) — src/utils/engine-variants.js:40; the #218 probe cases end at M23.
- [ ] **EP-5** — Add a `providerMissing` stop and a same-process "unknown last time" memo (including "EP-5 sharpened", L8098). (was L8035; —) — no `providerMissing` in src or tests; the wait is `DECLARATION_WAIT_MS` (src/utils/engine-variants.js:41).
- [ ] **B-ENG-3** — Optionally add a models.dev cross-check as a second witness for `engineSourced`, run outside the keyless canary. (was L8065; —) — src reads no `reasoning_options`.
- [ ] **B-ENG-4** — Shorten `formatUnverifiedVariantNote` to a one-line Notice. (was L8075; —) — src/utils/engine-variants.js:289-296; printed at src/headless.js:1002-1003 and src/sidecar/interactive.js:110-111.
- [ ] **#235-r1-D6** — Let `continue` / `resume` carry their own `--thinking` level. (was L8078; —) — rejected at src/cli-handlers-resume-continue.js:44-47 and :93-96; src/sidecar/resume.js:147.
- [ ] **#235-r4-C3** — Add the second `config.get()` read that subtracts config-set cells. (was L8102; —) — src/utils/engine-variants.js:245 ("FILED, not built").
- [ ] **B-ENG-5** — Reword the non-empty-set `VARIANT_UNDECLARED` reason ("the engine's catalogue lists…") together with its six byte-for-byte pins. (was L8108; —) — src/utils/engine-variants.js:254; pins include tests/utils/engine-variants.test.js:63, :198; quoted at docs/troubleshooting.md:288.
- [ ] **B-ENG-6** — Decide which auth.json candidate wins when several exist, so a stale XDG file cannot shadow the live one. Keep the XDG-first order (ruling P2-R42) and change only the selection rule. (was L8271; —) — src/utils/auth-json.js:40-46, :24-25.

### other

- [ ] **N-08** (new 2026-09-27) — **Before 2026-11-12**, choose which CI evidence artifacts to keep and download them (downloads need the owner's approval); then archive the corpus under docs/probes/ (B-OTH-3) and do the zero-spend weekend read (B-CL-9). Losing the evidence cannot be undone. (was: no BACKLOG row; #251, #202, #256) — `council-run` artifacts are kept 90 days (read with `gh api` on 2026-09-27; nothing downloaded): run 31807881067, the earliest refusal evidence, expires 2026-11-12; run 35143585179, the #256 run, 2026-12-15; the #270 weekend rounds 35437150184 and 35514703539, 2026-12-18 and 2026-12-19; the 27-set corpus's source artifacts expire the same way.
- [ ] **B-OTH-1** — Say in `waitThenKill`'s JSDoc that `exited` includes the pids SIGKILLed under escalation (nit). (was L259; —) — src/utils/abort-coordinator.js:116-117; the only `escalate` caller reads `escalated`.
- [ ] **#136** — Easy bug reporting is tracked on GitHub #136. (was L6576; #136) — #136 OPEN.
- [ ] **REC-4** — Make `pack save --from-run` read the leg's `variant`, which the writer emits, instead of `thinking`. (was L8037; —) — src/cli-handlers-pack.js:95 vs src/sidecar/fanout-leg.js:247.
- [ ] **B-OTH-2** — Install a startup-level listener for an asynchronous EPIPE on a piped stderr. (was L8914; PR #261) — none in src or bin; only `armStream` arms one (src/utils/alias-shadow-writer.js:168-208), and only once a notice prints.
- [ ] **B-OTH-3** — Archive the 27-set probe corpus (`legs.tsv`, `rounds.tsv`) under docs/probes/ before its source CI artifacts expire (they are kept 90 days; see N-08). (was L9072; #251, #202) — tracked nowhere (`git ls-files`); `.superpowers/` is excluded by .git/info/exclude:8.
- [ ] **#257-R1** — Print a stderr note when a solo `amicus start` prints promoted reasoning. (was L9138; #257) — src/sidecar/start.js:187 → src/sidecar/session-utils.js:126-128; `promoted` reaches only metadata.json (start.js:212).
- [ ] **#257-R1-fanout** — Mark promoted reasoning in `amicus fanout` output. (was L9140; #257) — src/sidecar/fanout-output.js:26-27 prints `leg.summary` and never reads `promoted`.
- [x] **#206-r4-C2** (new 2026-09-28) — Make `amicus list --json` print the enumeration-failure notice on stderr, the empty listing included, with stdout unchanged; flip the pin that asserts the silence (decided D-08). (was L8589; —) — `read.js :: listSidecars` collects the failure through `mergeCouncilRows`'s `onUnavailable` sink and prints it only in the human branch, so under `--json` "no council runs" and "enumeration failed" look the same; the truncation notice already reaches `--json` callers on stderr. The pin is the stderr assertion in list-council-merge.test.js's "--json stdout is untouched — the note is prose, and prose is not the contract". — done in #277 (51fa10e9): under `--json`, `listSidecars` prints the notice on stderr after any `--limit` notice, the empty listing included, and the flipped pin is "--json stdout is untouched — the note goes to stderr, where the truncation notice goes (D-08)".

## Owner decisions (all decided 2026-09-28)

- The full options, reasons and sources for each decision stay in the consolidation record, `OWNER-DECISIONS.md` in C:/Users/sendt/OneDrive/AIProjects/SecondBrain/output/2026-09-27-amicus-backlog-audit/ (not in this repo), beside the owner's answers in `DECISIONS-2026-09-28.md`. The decided lines move to the archive's dispositions at the next consolidation.
- [x] **D-01** — Should `extract-zip`, the one production dependency with an unfixable advisory, be deleted together with `robustExtract`, the only code that requires it? — decided 2026-09-28: (a) delete both, keeping `nativeUnzipPlan`, `UNSAFE_PATTERNS` and `yauzl`, in a PR of their own that BL-10 rides (N-06, BL-10) — shipped in #274
- [x] **D-02** — When `checksums.json` is present but has no row for the requested electron file, should verification refuse instead of allowing? — decided 2026-09-28: (a) refuse, naming the version and the fix; only a missing table still allows (B-SEC-7) — shipped in #276
- [x] **D-03** — Should `resolveElectronBinary` refuse a `path.txt` name that resolves outside `dist/`, as `distHeldExe` already does? — decided 2026-09-28: (a) add the same bound, refused before the spawn (B-SEC-6) — shipped in #276
- [x] **D-04** — What should `council run` do when `--out-dir` already holds another run's `run.json` (SL-4)? — decided 2026-09-28: (a) refuse, naming the existing runId and the fix; no format change (SL-4) — shipped in #277
- [x] **D-05** — Should CI provision a model catalog so the cost gate and the ledger price every leg, instead of the measured 3.7× spend floor? — decided 2026-09-28: (b) accept the ruled floor: ruling D5a (2026-07-26) stands, `--max-cost` bounds known spend only, and the CI key's monthly limit is the real cap; closed
- [x] **D-06** — Should a seat that died at its output reservation (`OUTPUT_LENGTH`) get the once-only, same-budget Stage-1 retry? — decided 2026-09-28: (a) skip the retry and name the alias's `outputBudget`, once a zero-spend read of the #202 corpus confirms no same-budget retry ever rescued one (B-CL-12) — shipped in #275
- [x] **D-07** — Build query-aware seat selection (GOA-1), choose ROADMAP B4 instead, or park the GoA family (GOA-1..8)? — decided 2026-09-28: (c) park it: the nine GOA items here close, the GOA-7 id stays resolvable, and the ROADMAP line and the v4.8 spec fix are B-DOC-4 — shipped in #278 (its docs part, B-DOC-4: the path-free ROADMAP note and the v4.8 spec's dated correction)
- [x] **D-08** — Should `amicus list --json` put the notice for a failed council enumeration on stderr? — decided 2026-09-28: (a) notice on stderr, stdout unchanged, flip the pin (#206-r4-C2) — shipped in #277
- [x] **D-09** — What should the three vote-symbol renderers print for a verdict they do not know? — decided 2026-09-28: (a) `?` everywhere, as the matrix does (B-CV-11) — shipped in #277
- [x] **D-10** — Should the v4.7 docs PR's cross-file link check (F-6) extend beyond CLAUDE.md to README and docs/*.md? — decided 2026-09-28: (a) call `validateCrossLinks` on them (B-CI-21) — shipped in #278
- [x] **D-11** — Should docs/publishing.md carry the release steps actually run from the machine-local recipe? — decided 2026-09-28: (a) add the three missing steps, drop the POSIX teardown smoke (B-REL-7) — shipped in #278
- [x] **D-12** — Should doctor flag an npm `registry=` that is not the default? — decided 2026-09-28: (b) accept it as disclosed in CHANGELOG.md's 4.9.6 entry; no doctor row; closed
- [x] **D-13** — Which optional distribution channels stay on the list? — decided 2026-09-28: (b) pursue all three as open work: the community-marketplace listing (B-REL-4), Chocolatey (B-REL-5) and the third-party MCP directories (B-REL-6); N-11 stays its own item — shipped in #278 (its repo part: the drafted, untested Chocolatey package in `packaging/chocolatey/` and each channel's status in docs/DISTRIBUTION.md; the listings themselves are the owner's actions, so B-REL-4..6 stay open)
- [x] **D-14** — Fund the paid measurements that five items wait on (LC-1, FR-3, SL-1, the 240k caveat, the v4.9.7 A1 bench review), or close them? — decided 2026-09-28: (a) as recommended: all five closed
- [x] **D-15** — Add seven "add another pin?" pins (TST-7, PROTOALIASES, `<select>`→Finish, S-W12, the loose `toMatch`, the roster union, the 34 s wiring suite), or accept the existing coverage? — decided 2026-09-28: (a) as recommended: all seven closed as covered
- [x] **D-16** — Accept the four disclosed report ↔ matrix divergences as designed, or schedule one "one roster source" PR? — decided 2026-09-28: (a) as recommended: all four accepted; closed
- [x] **D-17** — Build a second engine spawn per affected leg for the exact pre-spawn fit of a thinking variant, or close? — decided 2026-09-28: (a) as recommended: closed
- [x] **D-18** — How should a mixed-group chair leg keep its own conformance (SI-17)? — decided 2026-09-28: (a) as recommended: the disclosed loss is accepted; closed
- [x] **D-19** — Close SI-16 (three functions over the 50-line guideline) on the W2 splits, or keep it open? — decided 2026-09-28: (a) as recommended: closed; B-SZ-1's extraction shrinks them
- [x] **D-20** — Add `location` and `claim` to `verdict.json` (the SI-23 residual), or keep `tally.json` as their carrier? — decided 2026-09-28: (a) as recommended: closed; `tally.json` stays the carrier
- [x] **D-21** — Add a positive judges census to `verdict.json`, or close? — decided 2026-09-28: (a) as recommended: closed
- [x] **D-22** — Widen debate rows (`mk`) for `ttftMs` when no consumer is left, or close? — decided 2026-09-28: (a) as recommended: closed; the N-07 rewording joins N-12
- [x] **D-23** — Is the split of the two Singleton causes still wanted? — decided 2026-09-28: (a) as recommended: closed
- [x] **D-24** — Quarantine westpac-jv-02's inverted pre-task-mode rankings in lifetime stats, or accept them? — decided 2026-09-28: (a) as recommended: accepted; closed
- [x] **D-25** — File a surface for genuinely unattributed artifacts as work, or accept "listed, attributed to nobody" as the design? — decided 2026-09-28: (a) as recommended: accepted; closed
- [x] **D-26** — Does any stderr-only notice from the MCP-spawned council child need an MCP channel? — decided 2026-09-28: (a) as recommended: closed; what the caller must see goes in `degrades[]`
- [x] **D-27** — Should a seat that healed via retry carry its own marker? — decided 2026-09-28: (a) as recommended: closed
- [x] **D-28** — Accept the statSync age check reading the target's mtime under Option B, or switch it to lstat? — decided 2026-09-28: (a) as recommended: accepted; the comment rewording joins N-12
- [x] **D-29** — Rename the `<untrusted_sidecar_output>` fence tag in lockstep, or keep it? — decided 2026-09-28: (a) as recommended: recorded as a permanent wire token; closed
- [x] **D-30** — Accept CA-5's `name === 'task'` proxy as the fallback, or replace it? — decided 2026-09-28: (a) as recommended: accepted as the documented fallback; closed
- [x] **D-31** — Accept RN-2's best-effort blind-mode masking in the run list, or schedule a fix? — decided 2026-09-28: (a) as recommended: closed
- [x] **D-32** — Should the citation gate scan BACKLOG's `- [ ]` lines? — decided 2026-09-28: (a) as recommended: the exclusion stands; closed
- [x] **D-33** — Re-derive the per-shape table's STALE cells, or archive the table? — decided 2026-09-28: (a) as recommended: closed; the table stays in the archive
- [x] **D-34** — Is it intended that a retry wave launched from rendered text has no template provenance? — decided 2026-09-28: (a) as recommended: closed; its one comment joins N-12
- [x] **D-35** — Is a persisted client tag in shared-server metadata wanted? — decided 2026-09-28: (a) as recommended: dropped
- [x] **D-36** — Log `migrateEnvFileKey`'s silent test-run refusal, or accept the silent skip? — decided 2026-09-28: (a) as recommended: accepted; closed
- [x] **D-37** — File an upstream report of `@electron/get`'s `mirrorVar()` precedence, or drop it? — decided 2026-09-28: (a) as recommended: dropped
- [x] **D-38** — Keep `platformExe`'s dead `mas` arm for parity, or delete it? — decided 2026-09-28: (a) as recommended: the code stays; closed
- [x] **D-39** — Build a pane-only `aliases --ui` window, or treat #238's ruling R-P3-3 as final? — decided 2026-09-28: (a) as recommended: #238's ruling R-P3-3 is final; closed
- [x] **D-40** — Document the other producers' leg-rider key order, or drop the item? — decided 2026-09-28: (a) as recommended: closed
- [x] **D-41** — Say what #266 C6's extra assertion ("nothing follows the deciding wildcard") should forbid, or drop it? — decided 2026-09-28: (a) as recommended: dropped

## Reference index

- Rulings, do-not-re-file lists, traps and measured facts that are still in force, listed by the exact heading of the archive section that holds them. Every `L<n>` in this section is a line of BACKLOG-ARCHIVE.md.
- Local-only pointers are not on GitHub: `.superpowers/` is excluded by .git/info/exclude:8, and the v4.5 ledger was destroyed.
- Qualify a ruling id by its series when you cite it. A bare `R<n>` can mean the v4.8 spec's R1–R19 (docs/superpowers/specs/2026-08-10-v4.8-ask-anything-count-everyone-design.md), the owner's v4.8 rulings R1–R20 (R1–R16 of 2026-08-16, tabled at L2042; R17–R20 added by 2026-08-20), or the PR5x filings R4/R5. F1–F5 span four namespaces; A1/B1/B2/B3/C2/D1/D2 recur across three electron councils; M-numbers mean #218 probe rows, v4.9.5 M8/M10/M11 or v4.4.1 M-ids.

**Rulings and "do not re-file"**
- `### The three owner rulings (Christian, 2026-07-26)` → BACKLOG-ARCHIVE.md L385
  - Rulings D5a/D5b/D5c, D1 and D3 (2026-07-26). This is the only in-repo record; ruling D1 (2026-07-26) is cited at src/workspace/live-normalize.js:135.
- `### Refuted findings — do NOT re-file (v4.4.1)` → BACKLOG-ARCHIVE.md L449
  - RN-6 WONTFIX (guarded by tests/workspace/live-loop.test.js:581-594). Its detail pointer (`.superpowers/sdd/task-8-report.md` §2, L460) is local-only.
- `### Closed at ship — do not re-file` → BACKLOG-ARCHIVE.md L1214
  - T20-m1, T14-m8, T15-m10, and the v4.5 final review's F1–F5. Code cites these as "v4.5 final-review Fn" and "v4.5 HOLD-gate decision 2".
- `## v4.7.1 + v4.8.0 — release split (ruled 2026-08-09)` → BACKLOG-ARCHIVE.md L1885, and `### The seven rulings, with rationale` → BACKLOG-ARCHIVE.md L1906
  - The release-shape ruling and the do-not-re-file list (B02/B03/B27).
  - Note: the rationale of ruling 1 of the seven (2026-08-09) is refuted by errata E-2a (docs/superpowers/plans/2026-08-09-v471-diagnostics.md:178); the pin's value is determinism. L1930's "package.json only" is refuted by errata E-2b.
- `## v4.8.0 — SCOPE RULED (2026-08-16) — read this before the sections below` → BACKLOG-ARCHIVE.md L1975
  - The plans it calls "the full record" were pruned in 102302d4. Recover them with `git show v4.8.0:docs/superpowers/plans/<file>`.
- `### Traps — do not implement these as written` → BACKLOG-ARCHIVE.md L1993
  - Five traps.
- `### Owner rulings (2026-08-16)` → BACKLOG-ARCHIVE.md L2042
  - Owner rulings R1–R16 (2026-08-16). The series continues with R17–R20, added by 2026-08-20 and recorded inside the L2063 section (for example ruling R19 at L2621 and ruling R20 at L2977, both dated 2026-08-20); the full table is in the pruned plan (`git show v4.8.0:docs/superpowers/plans/2026-08-16-v48-phasing-and-rulings.md`).
  - Cite them as "owner ruling Rn" with its date, because the bare numbers collide with the v4.8 spec's R1–R19 and the PR5x filings R4/R5.
- `### Deferred to v4.9.0` → BACKLOG-ARCHIVE.md L4335
  - The Holds line at L4342: SI-21, PR5a-1, PR5c-DOMKEY, PR5c-STANDING are "not work, do not re-scope".
- `## v4.8 PR5a council fix-waves — owner rulings (2026-08-15)` → BACKLOG-ARCHIVE.md L6580
  - The PR5a-1 HOLD.
- `## v4.8 PR5b — owner ruling (2026-08-15)` → BACKLOG-ARCHIVE.md L6613
  - The emitter-arm table.
  - `data.seat` stays the ALIAS.
  - `seat-unbound` is a shared channel, so gate on retry-family fields.
  - Note shapes are pinned by exact `toEqual`.
- `## v4.8 PR5c — filed, not fixed (2026-08-15)` → BACKLOG-ARCHIVE.md L6750
  - The "consumer cannot reconcile identity / wrong lever" finding.
  - The PR5c residuals R1–R3 and residual R-W9b, pinned known-wrong.
  - The PR5c-DOMKEY HOLD.
- `### Standing note for the next reviewer of this area` → BACKLOG-ARCHIVE.md L6866
  - The PR5c-STANDING HOLD.
- `### The startup schema check — #133 fix 4, DISPOSITION (v4.9 W10 Task B, 2026-08-25)` → BACKLOG-ARCHIVE.md L6466
  - No DB-schema validation will be built; the runtime handshake in `utils/engine-skew.js` is the honest check.
- `### Council findings declined this cycle, with reasons` → BACKLOG-ARCHIVE.md L8230
  - A do-not-re-raise list (v4.9.3).
- `## v4.9 records — dispositions and rulings made in-cycle (2026-08-25)` → BACKLOG-ARCHIVE.md L8251. This is the only in-tree home of these rulings, because their plan was pruned (68465b39):
  - the v4.9 rulings V16 (L8340) and V17 (L8346), and the v4.9 W5 ruling (L8317);
  - the task-run intent fix, with `toModel` unchanged (L8358);
  - `MAX_CATALOG_AGE_MS` as a single source (L8380);
  - the refutation of the v4.8 spec's §10.6 (L8384);
  - the e2e double-failure decision (L8329);
  - the #202 TTFT heavy tail and its refuted remedies (L8453).
- `## v4.11.0 cut — #238 Phases 2–4 dispositions (2026-09-16)` → BACKLOG-ARCHIVE.md L8800
  - The accepted same-instant race (L8834). #238's R-P3/R-P4 rulings live in their plans.

**Measured facts**
- `## v4.9.4 records — dispositions and rulings made in-cycle (2026-09-04)` → BACKLOG-ARCHIVE.md L7429
  - The four #218 probe tables: P1 (19 cases), PR 2 (32), PR 3 (37) and PR 4 (61, plus probe row M23).
  - The `/config/providers` dumps and the engine facts.
  - Cited by title from docs/configuration.md:114 (a shipped doc) and from 7 live src/tests/scripts sites; probe-row ids are cited on 635 lines.
- `## Waves 2–3.0 — zero-spend probes, the v4.12.0 cut, the Lever 2 experiment (2026-09-17/18)` → BACKLOG-ARCHIVE.md L8966
  - "Records — measured" (L8997-9045), which the #251 spec builds on (:3, :45, :284).
  - The #266 frequency record and its ritual (L9078-9093).
- `## Wave 1 — open-issues review dispositions (2026-09-16/17)` → BACKLOG-ARCHIVE.md L8867
  - The seven-round frequency record (L8951-8964).
  - The ritual "the `council-review` label comes off the moment a round completes".
- `## v4.9.6 records — artifact custody (2026-09-08)` → BACKLOG-ARCHIVE.md L6944
  - One race, three remedies, two defeated.
  - electron@43.1.1 ships no install script.
  - The CI-bench output ceilings.
  - "Spend is a floor".
  - `outputBudget` is read from the BASE ref.
- `## v4.9.5 records — the Electron trust boundary (2026-09-07)` → BACKLOG-ARCHIVE.md L7373
  - The release record, and "a mutant proves a control is wired, not that its inputs are trusted".
- `## v4.9.7 — B3 and B2: the second name table, and a fence that was refused (2026-09-09)` → BACKLOG-ARCHIVE.md L7161, `### B3 — the fix was not a taxonomy. It was reading the OTHER table.` → BACKLOG-ARCHIVE.md L7163 and `### B2 — half already closed, and the fence REFUSED rather than deferred` → BACKLOG-ARCHIVE.md L7213
  - The design records of v4.9.7's B3 and B2. The function now lives in src/sidecar/zip-local-name-scan.js:164 (L7183 names it `zip-name-scan.js :: scanLocalNames`), and `ditto` has since been measured (5103f588).
- `## v4.9.7 — A1: the guard that asked the wrong question (2026-09-09)` → BACKLOG-ARCHIVE.md L7275
  - The method record.
- `## v4.9.7 candidates — deferred from the v4.9.6 cut (2026-09-08)` → BACKLOG-ARCHIVE.md L7120
  - v4.9.7's B1: "NOT a defect".
- `### Quote the real engine error — #133 root fix` → BACKLOG-ARCHIVE.md L6450
  - The engine writes one timestamped log file per process, and both schemes are live.
- `### v4.6 SHIPPED 2026-08-02 — the degrade announcement invariant (execution record)` → BACKLOG-ARCHIVE.md L735
  - The owner interpretation (L786).
  - The voice ruling (L788-796), mirrored at src/utils/remediation-hints.js:82-86.
  - The measured baseline (L815-817), cited by docs/ROADMAP.md:149.
- `## SL-2 live-smoke findings (2026-08-03, runs 0084d48c + 2039b2d1)` → BACKLOG-ARCHIVE.md L678
  - The "VERIFIABLE voice" ruling (L687-688), cited by src/utils/doctor-base-url-check.js:5.
- `## v4.5.2 deferred — field-report items NOT taken (2026-07-31)` → BACKLOG-ARCHIVE.md L630
  - SL-3 is fail-soft (the v4.8 spec's ruling R16).

**Heavily cited v4.8 records**
- `` ### The durable finding was the release's centre — ✅ FIXED: slots (T2.2) and rows in ALL FOUR retry shapes (T2.2 for three, T-A4 `1e385895` for the partial return, 2026-08-17) `` → BACKLOG-ARCHIVE.md L2063. It holds:
  - the accepted costs of ruling R2 (2026-08-16) (L2089);
  - the per-shape statement (L2191);
  - the per-round finding-ID map (L2229);
  - SI-TWINS (L2424);
  - PR #170 round-2 C1, "measured, not a defect" (L2491);
  - PR #176's C2, "MEASURED FALSE" (L2813);
  - Release Constraint 6 (L2866, L3438, L3558);
  - the named-mutant red sets (L3112) and PR #174's declined C1 (L3160);
  - the exclusion-3 record of ruling R20 (2026-08-20), misplaced at L3096-3111;
  - the T-series task records (522 hits).
- `` ### ⚠️ `src/council/run-retry.js` is at 300/300 — ZERO headroom (2026-08-22, Wave 1) `` → BACKLOG-ARCHIVE.md L3845
  - L3851 is the last statement of "Release Constraint 6". Four src files cite it.
- `#### Corrections this inventory made` → BACKLOG-ARCHIVE.md L3974
  - The T6.5 precedent: "never specified → drop".
- `#### Measured-real, unchanged, and still to do` → BACKLOG-ARCHIVE.md L3985
  - W1-3 and W1-4.
- `### v4.8 Phase 2 T-A8 — truth pass, and what it filed (2026-08-17)` → BACKLOG-ARCHIVE.md L4048
  - The durable lesson (L4062) and "Unamendable" (L4241).
- `#### Seat identity — PR2b handoff (2026-08-13)` → BACKLOG-ARCHIVE.md L4418
  - The artifact allowlist, taken from `run.seats`.
  - The W9 seat-loss gate, including residual R-W9a.
  - "Residual R3" (the PR2b handoff's) and the `data.legId` discriminator, both cited from electron/workspace-ui/live-dead-seats.js.
- `#### Seat identity — PR3 handoff (2026-08-13)` → BACKLOG-ARCHIVE.md L4625
  - The REJECTED ruling on the PR3 council's finding D1 (glm) (L5045-5058).
  - The `orphanLegNote` wording rule (L5036-5041).
  - KEYRAW (L5004-5013), cited as "BACKLOG.md holds the measurement".
  - SI-10's "exit-2 follow-up" (L4926).
- `#### Filed by PR4c — the seat spine (2026-08-14)` → BACKLOG-ARCHIVE.md L5419
  - The SI-DUP counting rules and "electron re-spellings are structural" (L6133-6139).
  - Null prototypes across serialization (L5499-5501).
  - The **verbatim** SI-22.1/.2 quotes (L5567, L5617), which pair with tests/council/tally.test.js:533 and :507.
  - The retired claim "T1 and T2 are the ONLY tests" (L5570).
  - The SI-21 HOLD (L5534).
- `### Bench adaptation — closes #135, finishes #129` → BACKLOG-ARCHIVE.md L6241
  - PR #207 council rounds 2–5 (L6271-6448), the only BACKLOG record, cited about 70 times from code.
  - "BACKLOG C5", #135's C5 (L6259).

**Earlier records and traps**
- `## v4.7 PR7 dispositions filed, not fixed (2026-08-08)` → BACKLOG-ARCHIVE.md L1559
  - The statSync Option B ruling (L1594); its title is quoted in src.
- `## v4.7 PR3 rider follow-ups (2026-08-07)` → BACKLOG-ARCHIVE.md L1616
  - The judgment calls under rulings R16-2/R16-3 (L1685-1712; sub-rulings of the owner's ruling R16, 2026-08-16), cited 8 times.
  - "Do not adopt 33" (L1674-1683).
- `## GoA paper review (2026-08-05) — query-aware selection, relevance weighting, exploration` → BACKLOG-ARCHIVE.md L1246
  - The pointer to the adoption notes, and GOA-7 (docs/ROADMAP.md:245).
- `### Deferred out of v4.4.1 into v4.5` → BACKLOG-ARCHIVE.md L440
  - The ENV-1 decision, mirrored at src/utils/env-num.js:24-28.
- `### Closed at the v4.4.1 release cut (2026-07-27)` → BACKLOG-ARCHIVE.md L468
  - Trap: re-measure the baseline at the branch's own merge-base before calling a delta drift (ENV-7).
- `### v4.4.1 lint-gate deferrals (ENV-5, 2026-07-27)` → BACKLOG-ARCHIVE.md L490
  - Never set the rule to `warn` (L531-534).
  - The permanent no-console exemptions (L536-541).
  - `no-var` is settled by the v4.8 spec's ruling R17.
- `## v4.4.1 fast-follow (2026-07-26 → 2026-07-27)` → BACKLOG-ARCHIVE.md L371
  - The Appendix A/B/C it asks you to read are **local-only**: they are in `.superpowers/`, not on GitHub.
- `## v4.1.2 divergent-vendor sweep (2026-07-22)` → BACKLOG-ARCHIVE.md L320
  - The divergent-vendor class (L325-329), now enforced by .eslintrc.js:23-33.
- `## Phase 19 smoke note (2026-07-03)` → BACKLOG-ARCHIVE.md L307
  - The wire-token continuity decision.
- `## Distribution & docs` → BACKLOG-ARCHIVE.md L148
  - The "Skip" channel list (L170-172).
- `### Low / cosmetic (12) — confirmed, tracked for cleanup` → BACKLOG-ARCHIVE.md L122
  - The exclusion line (L139).
- `## Review findings (DeepSeek, verified)` → BACKLOG-ARCHIVE.md L16
  - BL-6 was refuted.
  - BL-7, the per-run fold nonce, has 53 code citations.
- `## v4.8.0 release cut — filed from the CHANGELOG audit (2026-08-23)` → BACKLOG-ARCHIVE.md L6873
  - A filing written in the present tense is falsified by the fix (L6907-6913).
- `### Filed at the W14 truth pass (2026-08-26) — PR #207 council round 6` → BACKLOG-ARCHIVE.md L8637
  - The #207 r6 A1 `armStream` design note.
- `## #257 — filed at the PR (2026-09-19)` → BACKLOG-ARCHIVE.md L9136
  - The #257 R10 reader record (L9142-9175) and L9189's corrections.
  - A test quotes this heading (tests/council/degrade-contract.test.js:243-244).
- `## Post-ship batch (2026-09-25)` → BACKLOG-ARCHIVE.md L9278
  - Probe records live in `docs/probes/<probe>/`.
  - The MODEL-NOTES seed installs only if missing.

**Dispositions of 2026-09-27**
- `## Dispositions recorded at the 2026-09-27 consolidation` → BACKLOG-ARCHIVE.md L9297 (appended at the consolidation)
  - The owner's Cluster B rulings of 2026-09-27, the 141 rows closed at this consolidation (DONE, DROP, RECORD, MERGED) with their evidence, and the record corrections the audits found, each naming the archive line it corrects.
  - Its RECORD lines are the standing records: holds, accepted limits and rulings, one line each.

## Moved sections

- Every heading of the frozen archive (BACKLOG-ARCHIVE.md L1–L9295), in order, with its line in that file, so a citation by section title still resolves: find the title here, then read the archive at that line.
- Generated mechanically from `grep -n -E '^#{1,4} ' BACKLOG-ARCHIVE.md`. Each heading line is quoted byte for byte, including its leading `#`s, so ids inside a heading stay as written.

- L1 — `# Amicus Backlog`
- L16 — `## Review findings (DeepSeek, verified)`
- L73 — `### Open follow-ups`
- L81 — `## Second review (GLM 5.2, verified 2026-07-01)`
- L92 — `### Recommended (10) — confirmed real, worth fixing`
- L122 — `### Low / cosmetic (12) — confirmed, tracked for cleanup`
- L141 — `### Second-review follow-ups`
- L148 — `## Distribution & docs`
- L176 — `## Future goals (from the 2026-07-01 review-execution plan)`
- L197 — `## Phase 11 whole-phase review triage (2026-07-02)`
- L221 — `## Phase 12 whole-phase review triage (2026-07-02)`
- L237 — `## v1.9.0 release-cut triage (2026-07-03)`
- L245 — `## Phase 15 whole-phase review triage (2026-07-03)`
- L277 — `## Phase 17 whole-phase review triage (2026-07-03)`
- L286 — `## Phase 16 review roll-up (2026-07-03)`
- L307 — `## Phase 19 smoke note (2026-07-03)`
- L311 — `## Phase 20 whole-phase review triage (2026-07-04)`
- L320 — `## v4.1.2 divergent-vendor sweep (2026-07-22)`
- L371 — `## v4.4.1 fast-follow (2026-07-26 → 2026-07-27)`
- L385 — `### The three owner rulings (Christian, 2026-07-26)`
- L402 — `### Closed by v4.4.0 itself — do not carry these forward`
- L410 — `### Closed by v4.4.1`
- L440 — `### Deferred out of v4.4.1 into v4.5`
- L449 — `### Refuted findings — do NOT re-file (v4.4.1)`
- L468 — `### Closed at the v4.4.1 release cut (2026-07-27)`
- L490 — `### v4.4.1 lint-gate deferrals (ENV-5, 2026-07-27)`
- L543 — `### Filed at the v4.4.1 final whole-branch review (2026-07-27)`
- L630 — `## v4.5.2 deferred — field-report items NOT taken (2026-07-31)`
- L678 — `## SL-2 live-smoke findings (2026-08-03, runs 0084d48c + 2039b2d1)`
- L727 — `## v4.5.0 post-ship dispositions (2026-07-28)`
- L735 — `### v4.6 SHIPPED 2026-08-02 — the degrade announcement invariant (execution record)`
- L821 — `### Next-rev hard gates — resolve before/at kickoff *(carried past v4.6.0; the tight-file table was re-measured at the v4.6 ship and is current)*`
- L898 — `### Fix-sized carries`
- L934 — `### Minor findings riding forward (one line each; full reasoning is in the ledger)`
- L1214 — `### Closed at ship — do not re-file`
- L1246 — `## GoA paper review (2026-08-05) — query-aware selection, relevance weighting, exploration`
- L1352 — `## v4.6.3 sweep riders (transcribed at the release cut, 2026-08-05)`
- L1431 — `## v4.7 PR1 findings (2026-08-06)`
- L1559 — `## v4.7 PR7 dispositions filed, not fixed (2026-08-08)`
- L1616 — `## v4.7 PR3 rider follow-ups (2026-08-07)`
- L1793 — `## v4.7 docs PR — filed, not shipped (2026-08-08)`
- L1885 — `## v4.7.1 + v4.8.0 — release split (ruled 2026-08-09)`
- L1906 — `### The seven rulings, with rationale`
- L1918 — `## v4.7.1 — the diagnostics stop lying — ✅ SHIPPED v4.7.1, 2026-08-09`
- L1975 — `## v4.8.0 — SCOPE RULED (2026-08-16) — read this before the sections below`
- L1987 — `### The ruling`
- L1993 — `### Traps — do not implement these as written`
- L2042 — `### Owner rulings (2026-08-16)`
- L2063 — `` ### The durable finding was the release's centre — ✅ FIXED: slots (T2.2) and rows in ALL FOUR retry shapes (T2.2 for three, T-A4 `1e385895` for the partial return, 2026-08-17) ``
- L3845 — `` ### ⚠️ `src/council/run-retry.js` is at 300/300 — ZERO headroom (2026-08-22, Wave 1) ``
- L3869 — `` ### ⚠️ The file-size gate is at saturation — re-measured 2026-08-22 (v4.8 Wave 2.5, `T-R16.2`) ``
- L3902 — `` ### ⚠️ `src/cli-handlers-doctor.js` is at 299/300 — one line of headroom (2026-08-22, `R16`/`T-R16.1`) ``
- L3922 — `### v4.8 release inventory — what remains for 4.8.0, MEASURED (2026-08-22)`
- L3941 — `#### The four items that were OPEN in neither a phase list nor §7's deferred list`
- L3974 — `#### Corrections this inventory made`
- L3985 — `#### Measured-real, unchanged, and still to do`
- L4048 — `### v4.8 Phase 2 T-A8 — truth pass, and what it filed (2026-08-17)`
- L4245 — `### Size gate — re-measured 2026-08-17 (v4.8 Phase 2 T-A8)`
- L4284 — `### Size gate — re-measured 2026-08-16 (kept: the Phase 0/Phase 1 before-and-after)`
- L4335 — `### Deferred to v4.9.0`
- L4357 — `### Tracker state`
- L4365 — `## v4.8.0 — the council does new work`
- L4370 — `### Task mode — closes #134, finishes #130`
- L4405 — `### Seat identity — closes #137, and PR1F-1 properly`
- L4418 — `#### Seat identity — PR2b handoff (2026-08-13)`
- L4625 — `#### Seat identity — PR3 handoff (2026-08-13)`
- L5108 — `#### PR3 post-review adjudication (2026-08-13)`
- L5286 — `#### Filed by PR4b — ledger grouping (2026-08-13)`
- L5419 — `#### Filed by PR4c — the seat spine (2026-08-14)`
- L6241 — `### Bench adaptation — closes #135, finishes #129`
- L6450 — `### Quote the real engine error — #133 root fix`
- L6466 — `### The startup schema check — #133 fix 4, DISPOSITION (v4.9 W10 Task B, 2026-08-25)`
- L6500 — `### Setup polish — #138`
- L6548 — `### Carried from the dropped v4.7.2 scope`
- L6574 — `### Explicitly NOT in v4.8.0`
- L6580 — `## v4.8 PR5a council fix-waves — owner rulings (2026-08-15)`
- L6613 — `## v4.8 PR5b — owner ruling (2026-08-15)`
- L6750 — `## v4.8 PR5c — filed, not fixed (2026-08-15)`
- L6866 — `### Standing note for the next reviewer of this area`
- L6873 — `## v4.8.0 release cut — filed from the CHANGELOG audit (2026-08-23)`
- L6944 — `## v4.9.6 records — artifact custody (2026-09-08)`
- L7120 — `## v4.9.7 candidates — deferred from the v4.9.6 cut (2026-09-08)`
- L7161 — `## v4.9.7 — B3 and B2: the second name table, and a fence that was refused (2026-09-09)`
- L7163 — `### B3 — the fix was not a taxonomy. It was reading the OTHER table.`
- L7213 — `### B2 — half already closed, and the fence REFUSED rather than deferred`
- L7255 — `### Filed by the B3/B2 pass — open`
- L7275 — `## v4.9.7 — A1: the guard that asked the wrong question (2026-09-09)`
- L7353 — `### Filed by the A1 pass — open`
- L7373 — `## v4.9.5 records — the Electron trust boundary (2026-09-07)`
- L7429 — `## v4.9.4 records — dispositions and rulings made in-cycle (2026-09-04)`
- L8185 — `## v4.9.3 records — dispositions and rulings made in-cycle (2026-08-28)`
- L8230 — `### Council findings declined this cycle, with reasons`
- L8251 — `## v4.9 records — dispositions and rulings made in-cycle (2026-08-25)`
- L8529 — `### Filed at the W14 truth pass (2026-08-26) — PR #205 tails`
- L8571 — `### Filed at the W14 truth pass (2026-08-26) — PR #206 council round 4`
- L8637 — `### Filed at the W14 truth pass (2026-08-26) — PR #207 council round 6`
- L8714 — `## Next-patch candidates — follow-ups from the v4.9.8 cut (2026-09-13; filed as "v4.9.9 candidates" — v4.10.0 shipped #238 Phase 1 on 2026-09-14 without any of them, all still open)`
- L8744 — `## v4.10.0 cut — #238 Phase 1 dispositions (2026-09-14)`
- L8774 — `## Council infrastructure — observed on PR #250's two rounds (2026-09-15)`
- L8800 — `## v4.11.0 cut — #238 Phases 2–4 dispositions (2026-09-16)`
- L8867 — `## Wave 1 — open-issues review dispositions (2026-09-16/17)`
- L8966 — `## Waves 2–3.0 — zero-spend probes, the v4.12.0 cut, the Lever 2 experiment (2026-09-17/18)`
- L9095 — `## #251 item 1 — filed at the PR (2026-09-18; one closed by council round 1)`
- L9136 — `## #257 — filed at the PR (2026-09-19)`
- L9217 — `### Round 3 (2026-09-19) — filed, not fixed`
- L9262 — `### Round 4 (2026-09-20) — filed, not fixed`
- L9267 — `### Round 6 (2026-09-25) — filed, not fixed`
- L9278 — `## Post-ship batch (2026-09-25)`
