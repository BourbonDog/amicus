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
> below is the live record; read a verdict there, not here. ⚠️ **This "changes since" list is
> affirmative and enumerative, so it must be extended whenever a verdict moves — it is not covered
> by the "not re-derived" caveat above.** THREE changes since, not one: **SI-22.3 moved OPEN →
> PARTIAL** (T2.2, 2026-08-16, `33e2ecf7`) and then **PARTIAL → DONE** (T-A4, 2026-08-17,
> `1e385895`); and **SI-22.5 moved OPEN → DONE** (T2.4, 2026-08-20, `774dcdc2`+`d82e2127` /
> `09212e97`+`fa0c5ae7`). Re-counted directly off the live table at T2.4 fix round 1:
> **8 DONE · 3 PARTIAL · 1 SUPERSEDED · 1 HOLD · 18 OPEN** across its 31 rows (SI-22 already
> expanded into 22.1–22.5). ⚠️ The previous line read **7 DONE · … · 19 OPEN** and named only two
> changes; SI-22.5's move was made by T2.4's first commit and not carried here until this round —
> exactly the miss this paragraph's own ⚠️ exists to prevent.
> ⚠️ **FIVE MORE changes since T2.4 fix round 1 — v4.8 Phase 3 (2026-08-20/21): rows 06, 17, 19, 20
> and 26 all moved OPEN → DONE.** T3.1 (`13ae8cf6`) closed **26**; T3.3 (`fb3fa09d` + fix round 1
> `8027391b`) closed **06**, **17**, **19** and **20**. Row **18 did NOT move** — it stays OPEN; see
> its own cell for the narrowed scope (T3.3 closed a NEIGHBOUR half of the same `buildLedgerRows`
> anchor, not this row's own filter). Re-counted directly off the live table by bucketing every
> row's Verdict cell, not by arithmetic on the prior line: **13 DONE · 3 PARTIAL · 1 SUPERSEDED · 1
> HOLD · 13 OPEN** across the same 31 rows.
> ⚠️ The derived "open work items" total is deliberately NOT restated: the recon's rule counts the
> SI-22 roll-up as one OPEN row expanded to five, and the table counts the five directly, so the two
> disagree about whether a shape that passed through PARTIAL is decremented once or twice. Count off
> the table with the rule you need and state the rule, rather than inheriting a number.
> ⚠️ **ONE MORE change since Phase 3 — v4.8 Phase 4 (2026-08-21): R5 moved OPEN→v4.8→DONE**, in the
> **PR5x filings** line immediately below this table (R5 is a PR5-series filing, not one of the 31
> numbered rows above, so it has no cell of its own here). T4.1–T4.6 (`e42b6aaa` … `8cb811e6`, and
> the bookkeeping commit that lands with this sentence) shipped it: the Stage-1 roster now threads
> through the fanout transport to `metadata.json` and back out via the composed live doc, so
> `live-dead-seats.js:209`'s `if (s.seat)` arm executes on the live path for the first time, pinned
> by the named mutant `LIVESEATBLIND` (red set 2). Re-counted directly off the 31-row table by
> bucketing every Verdict cell — **unchanged**, because Phase 4/R5 touches no row in it: **13 DONE ·
> 3 PARTIAL · 1 SUPERSEDED · 1 HOLD · 13 OPEN**, the same partition as the line above, confirmed
> rather than carried forward by arithmetic.
> ⚠️ **TWO MORE changes since Phase 4 — v4.8 Phase 5 (2026-08-21): rows 10 and 13 both moved
> OPEN → DONE.** T5.1 (`9868be06` + fix round `6b452c99`) and T5.2 (`4eee59fa` + `c9b9c541`) closed
> **10** — the `-rv` wave now refuses to publish a key it cannot account for, and announces the
> refusal on `seat-unbound`, ⚠️ **which degrades the run to exit 2**, exactly as a Stage-1 orphan
> already does. T5.3 (`f885c1ea` + fix round `7c46d282`) closed **13**, collapsing to the JSDoc edit
> ruling **R8** predicted once 10 landed. Re-counted directly off the 31-row table by bucketing
> every Verdict cell, not by arithmetic on the line above: **15 DONE · 3 PARTIAL · 1 SUPERSEDED ·
> 1 HOLD · 11 OPEN**.
> ⚠️ Row **16's Verdict did not move** (still OPEN → v4.9) and it is not part of that count change —
> but its anchor column's three function lengths were re-measured in the same pass and **all three
> were wrong**; see the row. ⚠️ This line read *"two of the three"* until T5.4 fix round 1 — it did
> not resolve against the row's own enumeration, which names three corrections.
> ⚠️ **ONE MORE change since Phase 5 — v4.8 Phase 6 PR1 (2026-08-22): row 24 moved OPEN → DONE.**
> Four `Object.prototype`-collision carriers on the council document path closed at the table:
> `tally.js :: VERDICTS` (`36297e18`+`41733c58`), `street-cred.js :: perJudgeRank`
> (`46b89f75`+`3e1a09a7`, closing the half T3.3 left unfiled), and `report.js :: SYMBOL` +
> `debate.js :: PAST_TENSE` (`7ebe91ca`+`faccd178`, plus follow-up rounds `551f8366`+`7bacef50` and
> `308e90d1`+`8aab4059`) — the `PAST_TENSE` half is defense-in-depth, not a live-bug fix (see the
> row). Named mutants: `PROTOVERDICT`, `PROTORANK`, `PROTOSYMBOL`, `PROTOACTION`, `ACTIONPASSTHRU`,
> `DOUBLEBREACH`. Re-counted directly off the 31-row table by bucketing every Verdict cell, not by
> arithmetic on the line above: **16 DONE · 3 PARTIAL · 1 SUPERSEDED · 1 HOLD · 10 OPEN**.
> ⚠️ **That line was ALREADY stale when written — off by one DONE/PARTIAL, not just the two rows
> below.** Row 05 (`debate.js` second copy of the filter) reads **DONE** at its own cell, corrected
> 2026-08-22 by the v4.8 release inventory, which found its old PARTIAL wording stale — but that
> correction was never propagated into this running tally. Bucketing the table AS WRITTEN just
> above, before either of the two changes below: **17 DONE · 2 PARTIAL · 1 SUPERSEDED · 1 HOLD · 10
> OPEN** — 10 OPEN was already right; only DONE/PARTIAL were off by one each. Read a verdict off
> the table's own cell, never off this sentence's arithmetic — which is exactly why this note
> exists.
> ⚠️ **TWO MORE changes since Phase 6 PR1 — v4.8 Wave 2 (2026-08-22): rows 18 and 23 both moved
> OPEN → DONE.** `78ed7a40` (PR #184, ruling R14) closed **18**: `ledger-join.js ::
> splitFindingsBySeat` now attributes each finding to the pair group whose own `runStats` rows
> carry a matching `raiserSeat`, instead of dumping every raised finding onto the block's first
> pair group; the row SET does not move. `d5378684` (PR #183, ruling R10) closed **23**:
> `mcp-tools.js`'s closed schema now declares `location`, and `tally.js :: tally`'s `outFindings`
> map — independently dropping it regardless of validation — now forwards it, plus `claim` in the
> same PR's fix round. Re-counted directly off the 31-row table by bucketing every Verdict cell,
> not by arithmetic on either line above: **19 DONE · 2 PARTIAL · 1 SUPERSEDED · 1 HOLD · 8 OPEN**.

| # | Verdict | Item | Current anchor (by symbol) |
|---|---|---|---|
| 01 | **DONE** | artifact allowlist from `o.seats` | `workspace/artifact-names.js :: artifactAllowlist` |
| 02 | OPEN → **v4.9** | `deriveSeatLoss` + renderers blind to `seat-unbound` | `verdict.js :: deriveSeatLoss` · `live-dead-seats.js :: deadSeats` · `workspace-seats.js :: retriedSeats` |
| 03 | PARTIAL → ruled | Stage-2 judge roster from `modelInput` | `run-stage2.js :: runStage2` |
| 04 | **DONE** | tally peer filter | `tally.js :: tally` |
| 05 | **DONE** (v4.8 Phase 2 T-B2 `e23e56cd`; row corrected 2026-08-22 by the v4.8 release inventory, which found it STALE) | ~~`debate.js` second copy of the filter~~ there is no second copy: `debate.js :: debateTargets` calls `peer-split.js :: peersOf` at `debate.js:254`, and that function's own docblock states it was **"the last hand-rolled peer filter left in this file"**. Measured by opening the file, not inferred from T-B2's commit message | `debate.js :: debateTargets` |
| 06 | **DONE** (T3.3 `fb3fa09d`, 2026-08-21) | ~~`computeStreetCred` peer split~~ the third alias comparison now compares SEATS when both sides carry one, aliases otherwise (ruling ledger C-2), reusing `peer-split.js :: peersOf`'s shape | `street-cred.js :: computeStreetCred` |
| 07 | **DONE** | R8 `sameModelCorroboration` stamp | `tally.js :: tally` |
| 08 | **DONE** | `meta.seats` in tally input | `run-assemble.js :: buildTallyInput` |
| 09 | **DONE** | `verdict.json` lacks `raiserSeat` | `verdict.js :: buildVerdict` |
| 10 | **DONE** (T5.1 `9868be06`+`6b452c99` + T5.2 `4eee59fa`+`c9b9c541`, 2026-08-21, ruling R8; **narrowed by T5.5 `f19624c4`+`8d40f4f5`, 2026-08-22**) | ~~`-rv` leg binds to no seat → invented row~~ the wave now **refuses** to publish a re-vote key it cannot account for (`judgeKeys.includes(key)`) and announces it on `seat-unbound`. ⚠️ **It shipped with a second arm, `boundLegs.has(leg) \|\|`, which T5.5 DELETED** — a leg `taskId`-bound to a §3.4 placeholder slot while carrying a foreign alias satisfied it, so the foreign key was published and `applyDebate` invented a phantom row: the SI-10 shape surviving through the guard meant to close it (a paid council confirmed it from three seats; owner ruled fix). ⚠️ **The refusal degrades the run — exit 2**, exactly as a Stage-1 orphan does, and since T5.5 that composition is **pinned end to end** through the real `createDegradeSink` + `resolveTerminalExit`, not only by probe. The leg is untouched: its `runStats` row, its `revote-<name>.md` and its `conformance` all still land; only the votes are withheld. Measured end to end: 3 adjudications → 2, the seat-less phantom row gone, `Confirmed {a:2,d:1}` → `Contested {a:1,d:1}`, one note — and the BOUND twin's re-vote still applies, so it is surgical. Pinned by `JOINBLIND`/`REFUSEALL`/`LEGDROP`/`E2EBLIND`/`BOUNDREADD`/`NOTEHEAL`/`WHYSTALE`/`WHATSTALE`/`KEYRAW` | `run-debate-revote.js :: runRevoteWave` → `debate.js :: applyDebate` |
| 11 | **DONE** | `matrix-model.js` alias join | `matrix-model.js :: buildMatrixModel` |
| 12 | OPEN | double-orphan conformance collapse | `run.js :: runCouncil` |
| 13 | **DONE** (T5.3 `f885c1ea`+`7c46d282`, 2026-08-21, ruling R8) | ~~`applyDebate` writes seat id into `judge`~~ collapsed to the JSDoc edit R8 predicted, once row 10 landed: the `aliasOf` contract — what an omitted `aliasOf` writes, and which two joins that value reaches — is now stated in `applyDebate`'s own docblock. **No behaviour change and no thrown error**; making `aliasOf` required was considered and NOT taken. ⚠️ R8's *"a JSDoc edit at `debate.js:44`"* is a LINE, and `:44` is not the `aliasOf` param — anchor by symbol | `debate.js :: applyDebate` |
| 14 | PARTIAL | nothing pins "launcher must not dedupe" | `tests/council/run-launch.test.js` |
| 15 | **SUPERSEDED** | seatKey + padding duplication | by PR5c-SEATKEY + SI-27 |
| 16 | OPEN → **v4.9** | function lengths. ⚠️ **All three counts re-measured 2026-08-21 (T5.4) by brace-matching the current tree, and ALL THREE were wrong** (this said "two" until fix round 1, contradicting its own list): `runStage2` was recorded as 161 and is **165** (`:47-211`) — stale before v4.8 Phase 5, which never touches that file; `runRevoteWave` was 91, was **157** (`:124-280`) after T5.1, and is **125** (`:148-272`) after T5.5 deleted the `boundLegs` arm and its comment block and then repaired five sentences that deletion falsified, across three review rounds (re-brace-matched 2026-08-22 against the final tree); `runDebate` was recorded here as 165 and is **166** (`:106-271`) — ⚠️ note the BACKLOG's twin entry recorded `runDebate` as 166 and was right, so the two documents disagreed, and only this one was wrong about it ⚠️ **Two of the three moved again on 2026-08-23 (SI-27), re-brace-matched against the final tree: `runStage2` `:47-211` = 165 ⇒ **`:47-205` = 159**; `runRevoteWave` `:148-272` = 125 ⇒ **`:153-266` = 114**; `runDebate` `:106-271` = 166 unchanged (SI-27 has no site in that file). The 2026-08-21 numbers are left standing as the dated measurement they are — this is an annotation, not a renumbering (`docs/CITATIONS.md`). All three still exceed the guideline, so the row’s disposition (v4.9) does not change.** ⚠️ **This annotation sat in a FIFTH cell of a FOUR-column table until 2026-08-23 and rendered as NOTHING** — GFM silently drops excess cells, so every number in it was invisible while column 4 still showed the stale 165 · 166 · 125. Folded into this cell, the way row 27 does it, and column 4 updated. | `run-stage2.js :: runStage2` **159** · `run-debate.js :: runDebate` 166 · `run-debate-revote.js :: runRevoteWave` **114** |
| 17 | **DONE** (T3.3 `fb3fa09d`, 2026-08-21, ruling R4) | ~~chair-on-bench, no engine guard~~ normalised at the ledger join instead of guarded: a chair-synthesis row never decides a bench seat's `role`/`conformance` when the group also holds a bench leg; `wasChair` stays any-wins | `ledger-join.js :: benchLegs` |
| 18 | **DONE** (v4.8 Wave 2, `78ed7a40`, 2026-08-22, ruling R14) | ~~findings attributed by alias — only this half of `buildLedgerRows` was still open; T3.3 closed the OTHER half of the same anchor (the street-cred join, row 20) but `findings.filter(f => f.raiser === model)` was byte-unchanged~~ that filter line is STILL byte-identical (`ledger.js:143`) — this fix does not touch it — but `ledger-join.js :: splitFindingsBySeat` now credits each finding to the ONE pair group whose own `runStats` rows carry a matching `raiserSeat`, replacing the unconditional first-group dump; R4b-2's concentration is now the fallback for what cannot resolve, not the rule. Row SET unchanged. Verified by the `avInput` golden fixture, 7 example tests + 3 direct unit tests of `splitFindingsBySeat`, and named mutant `FINDINGALIAS` (RED 2 tests/1 suite); `LEDGERALIAS` re-run unchanged at 2/1 | `ledger.js :: buildLedgerRows` · `ledger-join.js :: splitFindingsBySeat` |
| 19 | **DONE** (T3.3 `fb3fa09d`, 2026-08-21) | ~~never-ran aggregate stays chair-promotable~~ closes as a side effect of seat-attributed street cred (row 20): a dead seat now gets its OWN seat-keyed row, which resolves to `null`/`null` rather than borrowing its live twin's number | `run-chair.js :: pickFallbackChair` |
| 20 | **DONE** (T3.3 `fb3fa09d` + fix round 1 `8027391b`, 2026-08-21) | ~~street cred collapses twins ×3~~ all three sites seat-keyed: `rankPositions` keys by seat where `orderSeats` names one, `computeStreetCred`'s driver is one row per seat, and the ledger join is seat-keyed with an alias-mean fallback | `street-cred.js :: rankPositions` · `:: computeStreetCred` · `ledger-join.js :: credFor` |
| 21 | **HOLD** | lens/position unrecoverable | owner-deferred; its own prose is false (§3) |
| 22.1 | OPEN | raiser's own leg orphans | `tally.js :: tally` |
| 22.2 | OPEN | peer twin's leg orphans | `tally.js :: tally` |
| 22.3 | **DONE** (T2.2 `33e2ecf7` + T-A4 `1e385895`, 2026-08-17) | ~~two orphaned twins → ONE dead row~~ producer fixed, and the reconcile half too: a PARTIAL retry return now gives 2 notes / 2 stillDeadLegs (B1) and each note reads its OWN slot's `firstFailure` (B2), output-identical to the BOUND control. ⚠️ Row/note half closed in **four of four** retry shapes; the SLOT half is closed **and bounded** — `min(N, roster count)` since T-A3 `4413eb25`, never an unqualified N→N | `run-stage1-rows.js :: pushDeadSeatRows` (done) · `run-retry.js :: retryStage1Losses`'s `launched` (done — slot COUNT, not first-wins) |
| 22.4 | **DONE** (v4.8 SI-22.4, 2026-08-23; trim + rider + pins `1c7a9087`, the four named mutant red sets `4c49becc`, fix round 1 `f771f59b`; branch `v48-si22.4-preset-trim`, BASE `ecf90f19`, plan `276d5a18`) | ~~whitespace-padded preset member~~ each preset member is trimmed **before gate 1**, so a padded alias reaches the alias table clean and a padded full id reaches the catalog lookup clean; `models` carries the trimmed value while `dropped`/`droppedMembers` keep the member RAW, so a user can still find it in their own config. ⚠️ **This row's own wording was INCOMPLETE** — it reads as input hygiene, but measured over six shapes **ALL SIX change behaviour and the dominant effect is RESURRECTION, not de-duplication**: a member dropped today starts RUNNING — a new paid leg on four of the six, and on two of those the bench goes from empty to non-empty. Only ONE of the six is the twin-merge this row implies. The six-row table has one home, `CHANGELOG.md`. ⚠️ The knock-on is proved from **ARTIFACTS**, not reasoned from `buildSeats`: `meta.seats` = `['gemini#1','gemini#2']`, `review-gemini-1.md`/`review-gemini-2.md` on disk, `review-gemini.md` **absent**, against a same-padding no-collision control that asserts `'seats' in meta === false`. **Rider R22.4-6** — both report renderers now label street-cred rows `s.seat \|\| s.model`, byte-identical on a unique-alias bench against BASE's own renderers loaded from `276d5a18` (`renderMd` 733/733, `renderHtml` 9667/9667). ⚠️ **Record that the rider was HOMELESS** — deferred twice as *"SI-25-adjacent"*, and an association is not a schedule. ⚠️ A **THIRD** street-cred renderer, `electron/workspace-ui/workspace-matrix.js:147-149`, is still alias-labelled, so on a twin bench the report and the Workspace now disagree — filed for **v4.9 with a named owner (Christian) and the `opts.labelOf` seat-id signature change as its stated GATE**, deliberately NOT as an adjacency. Named mutants, none empty: `NOTRIM` 2 suites/9 tests · `TRIMDROPPED` 1/2 · `KEEPEMPTY` 1/1 · `ROWSEATDROP` 2/3, all four independently reproduced. 549 suites / 7929 passed / 8 skipped / 0 failed (BASE 546 / 7909); all five gates clean | `utils/config.js :: classifyCouncilMembers` · `report-md.js :: renderMd` · `report-html.js :: renderHtml` |
| 22.5 | **DONE** (T2.4 `774dcdc2`+`d82e2127` / `09212e97`+`fa0c5ae7`, 2026-08-20) | ~~orphaned Stage-2 judge rendered nowhere~~ the vote→column join now REFUSES a key that names no column and folds it into a conditional `UNATTRIBUTED` column (R3 render, R18 one column); the vote stays in `basis`. Broader than the row's original wording — it closes `''`, `undefined`, non-string and orphan-seat keys, of which the Stage-2 orphan is one case. ⚠️ `report-html.js` in the anchor column is **wrong and was wrong when written**: the column propagates from the model, so BOTH renderers needed **zero** edits (`git diff ed5c0c02..0cb2d4d9 -- src/council/report-html.js` = 0 bytes). ⚠️ NOT SI-12 — see row 12, still OPEN (ruling **R19**) | `report.js :: toModel` · `matrix-model.js :: buildMatrixModel` (renderers untouched) |
| 23 | **DONE** (v4.8 Wave 2, `d5378684`, 2026-08-22, ruling R10) | ~~`location` stripped on MCP tally path~~ the closed `z.object` now declares `location`; `tally.js :: tally`'s `outFindings` map — independently dropping it regardless of validation, CLI path too — now forwards it emit-when-present. A same-PR fix round (council A1/B1) closed the identical gap for `claim` one line below. ⚠️ **Closes into `tally.json` only, not `verdict.json`** — `verdict.js :: buildVerdict`'s closed `out` literal forwards neither field; filed, not fixed (`BACKLOG.md`). Named mutants: `SCHEMASTRIP` RED 2 tests/1 suite (reproduced directly for this record — the commit itself states no count); `CLAIMDROP` RED 2 suites/2 tests (commit-stated) | `mcp-tools.js :: getTools` · `tally.js :: tally` |
| 24 | **DONE** (v4.8 Phase 6 PR1, 2026-08-22, SI-24) | ~~`VERDICTS[v.verdict]` inherited keys — the `tally.js` site is still open; T3.3 closed the unfiled second site's `perJudgeRank` half (mutant `JUDGEALIAS`, keyed on seat first)~~ four `Object.prototype`-collision carriers closed at the table (`__proto__: null` / `Object.create(null)`), not two sites: **A** `tally.js :: VERDICTS` (read, CLI-only — MCP's `adjudications[].verdict` is `z.enum`) `36297e18`+`41733c58`; **C** `street-cred.js :: perJudgeRank` (write/accumulator, CLI **and** MCP — closes the half T3.3 left unfiled) `46b89f75`+`3e1a09a7`; **D** `report.js :: SYMBOL` (read, 3 renderers, CLI **and** MCP — `amicus_verdict`'s unvalidated `record: z.record(z.any())` bypasses A/B's `tally()`-gated enum) and **E** `debate.js :: PAST_TENSE` (read, defense-in-depth ONLY — `parse-stage2.js`'s allowlist already makes a real defense response unreachable, so this closes a latent hole, not a live bug) both `7ebe91ca`+`faccd178`, plus two follow-up rounds `551f8366`+`7bacef50` and `308e90d1`+`8aab4059` that retracted a born-false reachability claim for E. Named mutants `PROTOVERDICT` · `PROTORANK` · `PROTOSYMBOL` · `PROTOACTION` · `ACTIONPASSTHRU` · `DOUBLEBREACH` — the last two are a compound pair: `PAST_TENSE`'s null prototype and the allowlist are each independently sufficient, so only breaching BOTH reds the pin | `tally.js :: VERDICTS` · `street-cred.js :: perJudgeRank` · `report.js :: SYMBOL` · `debate.js :: PAST_TENSE` |
| 25 | **DONE** (v4.8 SI-25, 2026-08-23, ruling R15 **as amended by R25-1**; code commits only — code + 15 pins `f7fe180d`, the five named mutants `0c06bca9`, fix round 1 `95ee5520`; branch `v48-si25-chair-packet-seats`, BASE `c0745013`) | ~~chair packet in alias space~~ **all THREE rendering sites seat-keyed, not the (1)+(2) R15 scheduled** — review headers resolve the seat through `seats.js :: displayName`, adjudications and the rankings KEY fall back seat-then-alias, and the rankings VALUES go through a new per-slot, tie-aware, null-safe zip. Site (1) also needed `run-assemble.js`: its reviews projection dropped `r.seat` before the packet saw it, and the seat now rides through it under the same emit-when-DIFFERENT rule as `rankings[]`, so a no-twin bench stays byte-identical. ⚠️ **R25-1, not scope creep**: R15 sent site (3) — the **rankings** site, the middle one in the file — to Phase 3, which unblocked it and deliberately did not do it, leaving the deferral with no referent. Five named mutants, none empty (`ALIASBACK` 1 suite/3 tests · `SEATONLY` 4/12 · `NULLLEAK` 1/4 · `FLATTIE` 1/1 · `HDRSEATFWD` 1/1, denominator 546 suites / 7914 tests), all five reproduced exactly by an independent re-measurement | `briefings-chair.js :: buildChairPacket` · `:: seatKeyedOrder` · `run-assemble.js :: buildChairPacketFile` |
| 26 | **DONE** (T3.1 `13ae8cf6`, 2026-08-20) | ~~`letterByModel` dead code~~ deleted — the JSDoc `@returns` clause, the `const`, the populate line and the return-literal key; `labelMap`/`entries` untouched | `anonymize.js :: assignLabels` |
| 27 | **DONE** (code: `80680c9f` + `ed827eaa` + `68bee03e` + `d29a3462`; record: `943a047b` + `9b712414` + `747c3a3e` + final-review fixes; and the PRE-BASE anchor corrections `9b059842` + `8e1c8e24` without which this row's site list was wrong — 2026-08-23, ruling R14; BASE `8b06c5e5`, branch BASE `dda1b8cf`) | ~~roster-padding ×3~~ the pad / bind / drop-placeholder core is consolidated into `stage1-bind.js :: bindPaddedWave(waveId, rosterSource, aliasAt, legs)` → `{seatOf, bindRes, placeholders}`, serving all three sites; **each site keeps its own orphan/missing tail** (push / degrade.note / nothing). Sizes: `stage1-bind.js` 86→142, `run-retry-launch.js` 67→55, `run-stage2.js` 213→207, `run-debate-revote.js` 274→268, `run-stage1-rows.js` 214→220; 545 suites / 7891 passed / 8 skipped / 0 failed. ⚠️ **ANCHOR CORRECTED 2026-08-22, and it held** — the first file was `run-retry.js` here and that was WRONG: it holds no padding site at all, and SI-27 confirmed it by shipping without one. ⚠️ **Consequence, unchanged: SI-27 does NOT relieve `run-retry.js`'s 300/300 saturation** — a belief carried through Wave 2.5 on the strength of this cell. That file stays saturated and is a standing hazard for whoever next touches it. ⚠️ **But it is not untouched either: ruling P5 let SI-27 reword ONE comment line in it** (`run-retry.js:22`, a sentence SI-27 made half false), one line → one line, still exactly 300/300. ⚠️ The `:36` line ref and the quoted header *"Consolidating the three"* in the pre-2026-08-23 version of this cell are both gone from the tree — SI-27 rewrote that header; anchor by symbol | `stage1-bind.js :: bindPaddedWave` ← `run-retry-launch.js :: bindRetryWave` (55/300) · `run-stage2.js :: runStage2` (207/300) · `run-debate-revote.js :: runRevoteWave` (268/300) |

**PR5x filings:** PR5a-1 **HOLD** · PR5b-1 OPEN→v4.9 · R4 OPEN→v4.9 · R5 OPEN→v4.8→**DONE (v4.8
Phase 4, 2026-08-21)** · DOMKEY **HOLD** · DURABLE OPEN→**v4.8 (T2.2)** · SEATKEY OPEN→split ·
STANDING **HOLD**.

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

   ✅ **EXECUTED 2026-08-19 at `e23e56cd` (v4.8 Phase 2 T-B2).** Annotation only — the sentences
   above stand exactly as written on 2026-08-16, per `docs/CITATIONS.md`'s preserved-record rule.
   What actually happened: both tests were REPLACED, not passed; their titles now end
   `⇒ excluded AND announced`; and the cited lines have moved — T1 `tally.test.js:331` (was
   `:329`), T2 `tally.test.js:357` (was `:341`), both re-derived by opening the file. The
   replacement is pinned by the named mutant `NAIVESPLIT` (17 suites / 97 tests red), not by a
   preservation test.
   ⚠️ **SUPERSEDED COUNT — annotation only.** Per `docs/CITATIONS.md`, this is a dated snapshot and
   the sentence above stands: `97` was true at T-B2 (`e23e56cd`). T-B4's two re-runs make it
   **17 suites / 109 tests**, which is also the value at HEAD — T-B5's round-1 volume pin briefly
   inflated it to 110 and round 3 removed that coupling. Single source:
   `tests/council/peer-split-mutants.js :: NAIVESPLIT`. ⚠️ Replacing the tests did **not** close SI-22.1 or SI-22.2: by owner ruling
   R2 the vote is still dropped, `basis` still reads `{a:0,d:0,n:0}`, the tier is still
   `Singleton`, and the undercount deliberately remains. Only the announcement —
   `findings[].unattributedPeerDrops` — is new. Do not re-issue this instruction.

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
   both arms **for every twin the producer is handed**. Kept as a trap because the mis-dating hazard
   is unchanged ~~, and because SI-22.3 is **PARTIAL**, not closed: a PARTIAL retry return still
   hands the producer only ONE of two unattributable twins~~ (STRUCK at T-A8 fix round 2: this
   clause was left standing and resolved only by the banner below — being adjacent to a correction
   is not the same as being corrected). See §3 and the table row above.
   ✅ **UPDATE 2026-08-17 — SI-22.3 is no longer PARTIAL.** v4.8 Phase 2 T-A4 (`1e385895`) closed the
   partial-return under-count (2 notes / 2 `stillDeadLegs` where it gave 1 and 1) and the slot-0
   first-failure provenance together; measured, the UNBOUND case is now output-IDENTICAL to the
   BOUND control in both the partial- and full-return shapes. The mis-dating trap stands. ⚠️ So does
   the ban on the unqualified headline — T-A3 (`4413eb25`) BOUNDED the slot mint by the roster, so
   N orphans buy `min(N, roster count)` slots. Per-shape statement at `BACKLOG.md` :: SI-22.3.

---

## 3. The durable finding, confirmed — ✅ FIXED by T2.2 for three retry shapes of four, and by T-A4 (2026-08-17) for the fourth

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

✅ **UPDATE 2026-08-17 (v4.8 Phase 2 T-A4, `1e385895`): the sub-case below is CLOSED.** The whole
paragraph is kept verbatim as the filing that scoped the fix. ⚠️ **Read EVERY verdict, measurement,
costing AND CROSS-REFERENCE in it as HISTORY — not only the ones named here.** That explicitly
includes *"the table above reads PARTIAL, not DONE"*: the status-table row for 22.3 was changed to
**DONE** in this same commit, so that clause is a pointer at a live artifact which no longer says
what it claims. (Named for convenience, not as the limit of the guard: the *"OPEN for a partial
return"* clause, the *"1 note and 1 row"* measurement, the *"+7 lines / 5 free"* costing.)
Measured on the final tree: a partial return now gives **2** notes and **2** `stillDeadLegs`, each
note carrying its own slot's `firstFailure`, output-IDENTICAL to the BOUND control; the extraction
that unblocked it landed first, as R14 required. ⚠️ **The headline ban in the first sentence below
SURVIVES** — T-A3 bounded the mint at `min(N, roster count)`.

⚠️ **One sub-case remains, which is why the table above reads PARTIAL, not DONE — and why the
unqualified headline "N orphans → N retry slots and N rows, both arms" must not be restated in
either wording.** The retry-SLOT half is closed in every shape (`recordFailure` runs before any
retry outcome exists). The ROW/NOTE half is closed for a wholesale retry death, a FULL retry return
and a skipped unit, and OPEN for a partial return. `run-retry.js`'s `launched` Map is
`seatKey`-first-wins, a keyspace no first-attempt distinguisher can enter, so a retry wave returning
FEWER legs than it launched still gives 1 note and 1 row for two unattributable twins (control,
BOUND twins: 2 and 2) — code council finding **B1** on PR #170 — and both still-dead notes read
slot 0's `firstFailure` — finding **B2**. The fix is a per-key slot count measured at **+7 lines**;
`run-retry.js` has **5** free and `run-retry-group.js` has **1**, so it is an extraction
prerequisite, not a shave, and R14 forbids riding that refactor on a defect PR.
**BACKLOG.md's "The durable finding" section carries the full per-retry-outcome table, both
measurements with their controls, the scoped NEXT TASK entry that closes B1 and B2 together, the
two accepted R2 costs, the SI-TWINS consolidation filing, and one further stated invariant for
whoever extracts that file.**

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
| R15 | SI-25 chair packet | **Sites (1)+(2) now** as a small PR; site (3) rides Phase 3. ⚠️ **AMENDED 2026-08-23 by ruling R25-1 — the PR shipped ALL THREE sites, and that is not scope creep.** Site (3) is the **rankings** render (the MIDDLE site in `buildChairPacket`, not the last — easy to mis-assume). "Rides Phase 3" did not happen: Phase 3 UNBLOCKED site (3) and deliberately did not do it, stating so verbatim twice in its own plan, so by 2026-08-23 the deferral had no remaining referent. Fixing two of three would have left the rankings block alias-keyed while the record claimed SI-25 closed. See status-table row `\| 25 \|` above and `BACKLOG.md`'s ticked *"chair packet is assembled entirely in alias space"* entry |
| R16 | `sessions-index` leak | **Pin all 13 unpinned rails** |
| R17 | What is the consumer-side unidentifying-key defect? (asked as *"what is SI-12?"* — see R19) | The consumer-side sibling of PR B's council C1. **Narrow option:** the report.js/matrix-model.js strictness asymmetry is not in scope and no shared module is extracted |
| R18 | Where does a refused vote go? | **Fold into UNATTRIBUTED** — one column, one concept; the vote stays in `basis` |
| R19 | The work R17 scoped was labelled **SI-12**, but SI-12 is already taken — row `\| 12 \|` above, *double-orphan conformance collapse* at `run.js :: runCouncil`, still OPEN | **Fold it into SI-22.5. Do not mint a new identifier.** Leave SI-12 exactly as it is, and describe the closed defect by mechanism. ⚠️ The mislabel **predates this PR** — T2.4's line below has read *"SI-12 refuses to join on an unidentifying key"* since `4ee46696` |
| R20 | A `judge: 'claude'` vote on a `claudeInCouncil: true` document lands in DIFFERENT columns in the two consumers. ⚠️ **Mechanism corrected 2026-08-20 (T2.4 fix round 2), by execution:** the ruling as first written said `matrix-model.js` "re-appends it as `claudeTail`" — **inverted**. `report.js` **filters** `claude` out of its own roster and folds; `matrix-model.js`'s alias branch has **no filter at all**, so it keeps it. `claudeTail` is on the **seat-space** branch only, where it RE-ADDS claude; forcing it empty leaves the divergence unchanged, and the flag moves `report.js` only. The ruling itself is unchanged — only its stated cause | **Disclose, pin and file.** Pin the measured behaviour of both consumers; correct the column's documented meaning to *no column on this bench*, not *nobody could attribute this*; file against the roster-SOURCES lever. **Do not align the rosters** — out of scope per R17 |

⚠️ **R8's anchor is a LINE and it was never precise — corrected 2026-08-21 (v4.8 Phase 5 T5.4), and
the ruling itself is unchanged.** R8 reads *"a JSDoc edit at `debate.js:44`"*. Measured at Phase 5's
BASE `9ef275e5`: `:44` was real and inside `applyDebate`'s docblock, but it was the
**`defenseByRaiser`** `@param` line — the `aliasOf` param SI-13 is about was `:46`. Both have since
moved (T5.3 grew that file 256→274). **Anchor by symbol: `debate.js :: applyDebate`.** R8's
substance — refuse rather than resolve, and SI-13 collapses to documentation — shipped exactly as
ruled; see rows 10 and 13 and the Phase 5 section of §5.

⚠️ **R16's own phrase is unsourced — corrected 2026-08-22 (v4.8 Wave 1, T-W1.2), and the ruling
itself is unchanged.** R16 reads *"Pin all 13 unpinned rails."* A repo-wide grep for that phrase
and for "13" near `sessions-index`/`unpinned rails` found only this table row — no filing, no
count, no enumeration of what the 13 rails are, anywhere else in the tree. The underlying defect is
real and measured (`BACKLOG.md`'s `sessions-index.json` growth entry: a full
read→parse→mutate→write of the whole index on every session start), and R16 stands — **scope it
from that growth entry, not from this row's "13."**

✅ **R16 SHIPPED — v4.8 Wave 2.5 (2026-08-22, `T-R16.1`, `0a6a8032`).** New doctor check +
`--fix` (`src/utils/session-index-prune.js`, mirroring `session-index-tmp-sweep.js`'s shape),
liveness-based only per R16-2 (no TTL, no mtime), probing the distinct project set per R16-3
(measured: 7 `statSync` calls for a 2000-entry/7-project index, not 2000). Named mutant
`STALEKEEP`, red set 5 tests, reproduced at full 545-suite scope. ⚠️ **Scope the claim honestly**:
this closes the structural gap, not the headline 18,874-entry/31.4%-dead measurement — the bulk of
that was test residue from the `/tmp` hermeticity leak PR #123 already sealed. R16-4's "13
unpinned rails" phrase was re-grepped at implementation time and is still unsourced, exactly as
annotated above. Full record: `BACKLOG.md`'s ticked `sessions-index.json` growth entry.

⚠️ **R10's own list is wrong on three of four names — corrected 2026-08-22 (v4.8 Wave 2), and the
ruling itself is unchanged.** R10 reads *"`evidence`/`file`/`line` stop dropping too."* Measured
across `src/`, `schemas/`, `tests/`, `findings.js :: REQUIRED`, `briefings.js ::
FINDINGS_JSON_SHAPE` and `anonymize.js :: toGlobalFindings`: only `location` exists as a finding
property anywhere in this codebase's shape. `evidence`/`file`/`line` have zero producers and zero
consumers, and no finding object anywhere under `src/council/` is ever read as `.file`, `.line` or
`.evidence` (grepped, zero hits) — the only place `file` and `line` co-occur as sibling keys on one
record anywhere in the repo is `scripts/check-secrets.js`'s secret-scanner output
(`{file, secrets: [{line, ...}]}`), an unrelated domain. `rationale` is real
(Stage-1-required, `findings.js :: REQUIRED`) but `anonymize.js :: toGlobalFindings` never forwards
it past Stage-1, so adding it to the MCP tally schema would invent a shape the engine's own path
never produces. R10 stands as ruled — fix the closed `z.object` properly — and SI-23 (`d5378684`,
row 23 above) did exactly that for the one real name, `location` (and, in the same PR's fix round,
`claim`, which was already declared but separately dropped by `tally.js`'s own map). **Scope any
future reading of R10 from this annotation's measurement, not from the ruling's own list of names.**

⚠️ **R17–R20 were ruled 2026-08-20, not 2026-08-16** — appended here rather than renumbered, so
R1–R16 keep the numbers every other document cites them by. R17/R18 were taken before T2.4 / PR C
wrote any code; R19 and R20 during its fix round.
⚠️ **R19 corrects a false premise this document briefly carried.** R17 was asked as *"what is
SI-12?"*, and an earlier draft of this note asserted that **SI-12 had no definition anywhere in the
repository**. That is **false**: SI-12 is defined in this file's own live status table as row
`| 12 |`, *double-orphan conformance collapse*, and filed in `BACKLOG.md` — still OPEN. The search
that "found nothing" was `git grep SI-12`, and the table writes a bare `| 12 |`, so the string never
occurs: **a search that cannot express its target reported nothing wrong**, the same false-assurance
class this release files as citation-gate Mechanisms A–D. The closed work is **SI-22.5**.

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
  ⚠️ **`:223` has rotted — re-measured 2026-08-23 (v4.8 SI-25).** Counting rule: the line of
  `function buildChairPacketFile(` in `src/council/run-assemble.js`, read at both SI-25's BASE
  `c0745013` and its HEAD — **`:242` at both**, so the drift happened between 2026-08-16 and that
  BASE and SI-25 did not cause it. Anchor by symbol: `run-assemble.js :: buildChairPacketFile`.
  **Hard prereq of three things:** Phase 3's `rankings[]` seat, #135's TTFT field, carried PR1F-2
- **T1.2** Extract from `report.js` (**298/300**) — hard prereq of **T2.4**.
  ⚠️ Corrected 2026-08-16: this line and §6 previously also claimed SI-25. They were wrong —
  SI-25's sites are `briefings-chair.js :: buildChairPacket` (182 lines) and
  `run-assemble.js :: buildChairPacketFile`; `report.js` never carried a chair packet. T1.1 is
  what mechanically gated SI-25 site (1) (`run-assemble.js` was at 297/300); at 252 it is clear
  ⚠️ **Two notes, 2026-08-23 (v4.8 SI-25).** (a) **The sentence above is unfinished in the source** —
  it ends at "at 252 it is clear" with no object; a dropped clause, pre-existing, left as history.
  (b) **Both line counts have moved now that SI-25 has shipped**: `briefings-chair.js` 182 → **243**,
  `run-assemble.js` 252 → 271 → **278** (gate's rule: `content.split('\n').length`, minus 1 if the
  file ends in a newline). Both are still clear of the 300 gate; the *conclusion* holds, the
  *numbers* do not — re-measure rather than quoting 182 or 252 from here.

> Use the PR5b shape: byte-for-byte move, re-exported so no caller changes, pinned by function
> **identity** (`toBe`) across import paths. That PR earned the sequence's only clean verdict.

### Phase 2 · Unidentified-seat identity — 4 PRs · ruling R2
- **T2.1** `run-retry-group.js:114` calls its own exported `seatKey` at `:51`.
  Hard prereq of T2.2 — two independent spellings in one file, and T2.2 changes that vocabulary
- **T2.2** Producer: `recordFailure` + `pushDeadSeatRows` key on roster slot / leg id.
  N orphans → N retry slots and N rows, **both arms**. MUST ship together.
  ⚠️ **SHIPPED PARTIAL 2026-08-16 (`33e2ecf7`)** — the slot half closed in every shape, the row/note
  half in three retry shapes of four. The goal line above is what was *planned*, not what holds;
  see §3 and BACKLOG's "The durable finding" for the scoped result and the B1/B2 follow-up.
  ✅ **COMPLETED 2026-08-17 by Phase 2 T-A3/T-A4** — the row/note half now holds in **four of four**
  retry shapes (T-A4 closed the partial return), and the slot half is additionally **bounded by the
  roster** (T-A3). ⚠️ The goal line above is STILL not what holds: `min(N, roster count)` slots, not
  N. Read `BACKLOG.md` :: SI-22.3 per-shape
  ⚠️ measure the interaction with `deriveSeatLoss`'s channel gates — SI-02 is deferred but the
  degrade notes `recordFailure` produces are what `deriveSeatLoss` reads
- **T2.3** Peer split: `tally.js` + `debate.js` in **one commit** — they already disagree today
  (measured: `debateTargets` returns 1 peer where `tally` counts 2, because `tally` has an outer
  `f.raiser ?` branch `debate.js` lacks; the comment at `debate.js:189-193` claiming "the SAME
  guard" is false). **Replaces** T1/T2
  ✅ **COMPLETED 2026-08-19 by Phase 2 T-B1 (`0fd630b6`) + T-B2 (`e23e56cd`)** — the desync
  above IS closed: `debate.js :: debateTargets` now routes through the same
  `peer-split.js :: peersOf` that `tally.js` calls, so the comment quoted above as false is no
  longer written anywhere in the tree. `unattributedPeerDrops(f, votes)` is a new function both
  documents call, on `findings[]`, emitted only when > 0; `tally.test.js` T1/T2 were REPLACED,
  not merely kept green; the field is declared in `council-tally.schema.json`.
  ⚠️ **DID NOT close SI-22.1 or SI-22.2 — read this precisely.** Per owner ruling **R2** the
  ambiguous drop STAYS: `basis` does not move, tier does not move, the undercount survives
  exactly as before, on purpose. The only change is that the drop is now **announced**. Nor is
  the mark rendered anywhere yet: `byRaiser` feeds `buildDefenseBrief` only and never reaches
  disk, and `verdict.js :: buildVerdict`'s findings literal is closed and does not copy the
  field — so before **T2.4 / PR C** the number is observable only in `tally.json`. Read
  "Replaces T1/T2" above as replacing WRONG-behaviour pins with right-behaviour-plus-mark pins,
  not as closing SI-22.1/SI-22.2 — both stay open.
- **T2.4** Consumers: ~~SI-12~~ **SI-22.5** refuses to join on an unidentifying key; SI-22.5 renders an
  **unattributed** column across all three renderers with the vote still in basis
  ⚠️ **THE `SI-12` LABEL ON THIS LINE IS WRONG AND HAS BEEN SINCE `4ee46696` (2026-08-16), when
  this line was written** — it is corrected here, not introduced here. SI-12 is row `| 12 |` of the
  live status table above, *double-orphan conformance collapse* at `run.js :: runCouncil`, and it is
  **still OPEN**. Owner ruling **R19** (2026-08-20): the work T2.4 did is **SI-22.5**; fold it there,
  do not mint a new identifier, and leave SI-12 untouched.
  ✅ **COMPLETED 2026-08-20 by Phase 2 T-C1 (`774dcdc2` + `d82e2127`) + T-C2 (`09212e97` +
  `fa0c5ae7`) + T-C3 (`0cb2d4d9` + its fix round, the branch tip)** — **the unidentifying-key join
  is closed in both consumers.** `src/council/report.js :: toModel`
  and `src/workspace/matrix-model.js :: buildMatrixModel` each classify the vote key instead of
  trusting it: a key that is not a non-empty string naming a real column folds to `UNATTRIBUTED`
  (**R18**) and the vote **stays in `basis`**. Written twice, deliberately not shared, per **R17**.
  **SI-22.5 is closed with it, per R3.** ⚠️ **"All three renderers" above describes the outcome,
  not the edit** — measured: the council renderers needed **zero** changes, because the column
  propagates from the model alone; `git diff` against the branch point is 0 bytes for
  `report-md.js`, `report-html.js` and all of `electron/`. The column is **conditional**: it
  appears only when a vote actually folds, so a clean document renders exactly as before.
  ⚠️ **The two consumers were proved to agree by an EXHAUSTIVE fuzz, not by shape pins** —
  **407 disagreements / 504 cases at `32a63e92`** (the tree with `report.js` fixed and
  `matrix-model.js` not) **→ 0 / 504** at `e5376399`, in
  `tests/council/seat-matrix.test.js :: fuzzCases`. Read `BACKLOG.md`'s **SI-22.5** entry for the
  filing.
  ⚠️ **DID NOT close SI-22.1 or SI-22.2 — read this precisely.** Per owner ruling **R2** the
  ambiguous *peer* drop still STAYS: `basis` does not move for it, the undercount survives exactly
  as before, on purpose, and the drop remains merely **announced** in
  `findings[].unattributedPeerDrops`. SI-22.5 is a **rendering** closure on the vote→column join
  and says nothing about the peer filter. Nothing in T2.4 makes the peer undercount fixed.
  ⚠️ **It also did NOT close SI-12** (row `| 12 |`, a different defect — ruling **R19**), and it
  did not close **SI-22.4**. ⚠️ **One shape is deliberately left DIVERGENT and is now pinned rather
  than fixed — ruling R20**: a `judge: 'claude'` vote on a `claudeInCouncil: true` document folds to
  `UNATTRIBUTED` in `report.js` and lands in the `claude` column in `matrix-model.js`. Filed against
  the roster-SOURCES lever in `BACKLOG.md`; aligning the rosters stays out of scope per **R17**.
  ⚠️ **T22 shape 1's pin was REPLACED, not kept green** — the old pin asserted the pre-fix
  behaviour, so it had to assert the opposite. Read that as replacing a wrong-behaviour pin with a
  right-behaviour one, exactly as T2.3's "Replaces T1/T2" should be read.

### Phase 3 · Seat-keyed street cred + ledger — 1 large PR
- **T3.1** SI-26 (`letterByModel` delete) lands first or folds in — both edit `assignLabels`'
  return literal and JSDoc
- **T3.2** Seat onto `rankings[]` (`buildTallyInput:216`) + seat-ify
  `assignLabels`/`rankingToOrder` — schema change
  ⚠️ **`buildTallyInput:216` rotted before T3.2 even shipped — re-derived 2026-08-21 (T3.4): `:216`
  is `runStats.push(buildRunStatsEntry({` inside the judge-row loop, unrelated to `rankings[]`.**
  Prefer the symbol anchor `run-assemble.js :: buildTallyInput`, which does not rot when the
  function gains lines — as this one did, twice, before T3.2's own commit landed.
- **T3.3** Fixed internal order: `rankPositions` → peer split → `perJudgeRank` →
  `computeStreetCred` driver → ledger. Includes SI-17 **normalise** (R4). Replaces
  `ledger.test.js` T12
- ⚠️ **`ledger.js:106` must ship in the same PR.** Measured: the two twin street-cred rows are
  byte-identical today, which makes that Map join a no-op. Seat-key `rankPositions` alone and they
  diverge — at which point the Map **silently drops one**, and the fix is strictly worse than the bug
- Closes SI-06, SI-18, SI-19, SI-20, SI-17. Unblocks SI-25 site (3)
  ⚠️ **WRONG ABOUT SI-18 — measured 2026-08-21 (v4.8 Phase 3 T3.4), not merely disputed.** SI-18
  ("findings attributed by alias") is NOT closed: `ledger.js :: buildLedgerRows`'s
  `findings.filter(f => f.raiser === model)` is byte-unchanged across this entire PR (zero-context
  diff, `f207538c` to the branch tip). This PR closes a DIFFERENT half of the same anchor — the
  street-cred join, SI-20's third site. Leave SI-18 open; see §1 row 18.

✅ **COMPLETED 2026-08-21 by Phase 3 T3.1 (`13ae8cf6`+`a46e90cb`) + T3.2 (`b17a6329`+`b341b273`) +
T3.3 (`fb3fa09d`+`1c5d36b9`+`05cfa5ac`+`46719a7f`+`8027391b`+`d766bc71`) + T3.4 (citation and
tracker sweep, no behaviour change)** — shipped in the internal order this section specifies: T3.1
deleted `letterByModel` (SI-26); T3.2 carried the seat channel onto `assignLabels`/`rankingToOrder`
and put `seat` on `rankings[]`; T3.3 added `rankings[].orderSeats` (the one further hop T3.2
deliberately stopped short of) and seat-keyed `rankPositions`, `computeStreetCred`'s driver
(`credSeats`, one row per SEAT), the peer split and `perJudgeRank`, plus the ledger join — now
`ledger-join.js :: credFor`, extracted in the same commit rather than left at the `ledger.js:106`
cited above — and SI-17's normalise (R4) via `ledger-join.js :: benchLegs`. Closes **SI-06, SI-17,
SI-19, SI-20**; unblocks SI-25 site (3). ⚠️ **"Unblocks" is exact and stays exact — Phase 3 did not
DO site (3), and by 2026-08-23 that had a consequence.** R15 had sent site (3) here, so unblocking
it without doing it left it homeless; ruling **R25-1** therefore shipped all three sites in SI-25's
own PR on 2026-08-23. **Do not read this line as "site (3) shipped in Phase 3"** — the resume points
downstream of it did, and were wrong. **Does NOT close SI-18** — see the ⚠️ immediately above;
the line this replaces was wrong about it from the day it was written. Release constraint 6
(extract, never shave) fired twice: `street-cred.js` now holds
`computeStreetCred`/`rankPositions`/`credSeats`, and `ledger-join.js` holds
`benchLegs`/`credFor`/`meanCred`. One disclosed, unrepaired consequence of the SI-17 normalise —
on a mixed group the chair leg's own `conformance` no longer reaches the ledger at all, only
`wasChair: true` survives — is filed in `BACKLOG.md` for the owner to rule on, not decided here.

### Phase 4 · R5 — 1 PR
Seat id on the live leg row: extend `writeLegPatch` in `fanout-leg.js :: runSingleAttempt` so
`buildLegRow` reads the seat off `metadata.json`, threading from `run-stage1-launch.js`'s
`seated[].roster`; then through `live-normalize.js :: seatOf`. Makes `live-dead-seats.js:209`'s
`if (s.seat)` arm — dead on the live path at every measurement before this phase — actually live.
⚠️ **Citation correction (v4.8 T4.6):** this line named the symbol `:: runLeg` and the line number
`:207` until this pass. Measured: `runLeg` is a 6-line dispatcher with no `writeLegPatch` call —
both write sites are inside `runSingleAttempt` — and the arm moved from `:207` to `:209` when
T4.5's own comment rewrite grew the file above it. Corrected here and in `BACKLOG.md`'s matching
Phase 4 entry; case-insensitive repo sweep confirmed no other live carrier of either stale form.
The mechanism this line describes was, and remains, correct — a citation repair, not a truth
repair.

✅ **COMPLETED 2026-08-21 by Phase 4 T4.1 (`e42b6aaa`) + T4.2 (`49c2313d`+`41d6f793`) + T4.3
(`3c95bd18`+`94fdb76b`+`2294ce8a`+`c009c7eb`+`3e5ad689`) + T4.4 (`40b26dde`+`2d69a987`) + T4.5
(`b9c760a5`+`6a944404`) + T4.6 (the truth pass, citation correction and bookkeeping — no behaviour
change).** The per-wave Stage-1 roster now threads through the fanout transport
(`fanout-wave-io.js :: stampLegAttribution`, stamping `leg.seat` emit-when-DIFFERENT against the
seat's own alias — the same predicate `run-stats-entry.js :: buildRunStatsEntry` and the three
`run-assemble.js` producers already share) to `metadata.json` via `fanout-leg.js ::
runSingleAttempt`, and back out through `council-legs.js :: buildLegRow` and
`live-normalize.js :: seatOf`. `live-dead-seats.js:209`'s `if (s.seat)` arm now **executes on the
live path**, pinned end to end by the named mutant `LIVESEATBLIND` (red set 2). A unique-alias
bench writes nothing new to `metadata.json` — byte-identical to pre-R5 — but the composed live doc
is **not** byte-identical regardless: every leg row gains an explicit `seat: null` (T4.4's
annotation corrected a false "byte-identical" claim about this same doc before it shipped). Stage
1's initial launch only, as scoped: chair, debate, repair, and the Stage-1 retry wave
(`run-retry.js :: retryStage1Losses`, a separate Stage-1 launch site) all launch without a roster
and are unchanged — a retried twin's live row still reports `seat: null` (filed in `BACKLOG.md`,
not fixed here). Four
named mutants recorded and hand-reverted end to end: `SEATALIAS` (the predicate pin, red set 2),
`SEATSLOPPY` (the surgical index pin, red set 1), `SEATDROP` (the persistence pin, red set 2) and
`LIVESEATBLIND` (the end-to-end pin, red set 2). T4.6 also re-anchored `run-assemble.js:89` by
symbol to `run-stats-entry.js :: buildRunStatsEntry` in `electron/workspace-ui/live-seats.js`,
`workspace-seats.js` and `tests/workspace/seat-panel-twins.test.js` — that line is
`labelClaudeReview`'s docblock, unrelated to seats, and the mechanism those comments describe was
already correct; only the line number was rotten.

### Phase 5 · Debate join — 1 PR
SI-10 **refuse** a re-vote whose seat is unknown, and announce. SI-13 becomes a JSDoc edit.

✅ **COMPLETED 2026-08-21 by Phase 5 T5.1 (`9868be06` + fix round `6b452c99`) + T5.2 (`4eee59fa` +
`c9b9c541`) + T5.3 (`f885c1ea` + fix round `7c46d282`) + T5.4 (the record — BACKLOG verdicts, this
table, the citation repairs and the CHANGELOG; no behaviour change), then **T5.5 2026-08-22
(`f19624c4` + assertion-order `8d40f4f5`)**, which closed the two mechanisms a paid multi-model
council confirmed against PR #179.** `run-debate-revote.js ::
runRevoteWave` publishes `byJudge[key]` only when its key names a judge this wave actually launched
— `judgeKeys.includes(key)`. ⚠️ **It shipped with a second arm, `boundLegs.has(leg) ||`, and T5.5
deleted it.** `seats.js :: bindSeats` matches `leg.legId || leg.taskId` to a roster SLOT with no
alias check, so a leg stamped into a §3.4 placeholder's slot while carrying a foreign alias BOUND
(arm 1 true) and still keyed on that foreign alias (arm 2 false): the key was published, no note
was emitted, and `applyDebate` invented a phantom adjudication row while the roster hole's own
seat-less row kept its stale `dispute` — finding A1 went 2 adjudication rows in, **3** out. Three
council seats raised it independently (kimi's C1 as a blocker) and reproduced that out-count; the
owner ruled delete. RED-before-GREEN, because it is a behaviour change: the `BOUNDDROP` block that
pinned the defect was inverted, confirmed red at `269badf1` and green after, and the §3.4 roster
hole (whose own alias IS a `judgeKey`) still publishes with no note, its two pinning blocks
untouched. Otherwise the parsed votes are **withheld** and the
refusal is announced on the **`seat-unbound`** channel (`run-debate-revote.js ::
reVoteUnboundNote`). The leg itself is untouched: its `runStats` row, its `revote-<name>.md` and its
`conformance` all still land.
⚠️ **The refusal DEGRADES the run — exit 2.** Measured by execution, not reasoned: the note carries
no `kind`, `src/utils/degrade.js:34` defaults it to `'degrade'`, `run-degrade.js ::
createDegradeSink`'s `note()` sets `degraded.value = true` for that kind, and `run-finalize.js ::
resolveTerminalExit` turns that into **2** on an otherwise-clean run — identical to the
`stage1-bind.js :: orphanLegNote` control run beside it. ⚠️ **An earlier draft of the Phase 5 plan
claimed the opposite ("exit-code-neutral"); it was measured false and corrected. Do not
reintroduce it.** ⚠️ That chain was a PROBE until T5.5, which pinned it: one test drives the real
`createDegradeSink` with a refusal **derived from** the real `runRevoteWave` and asserts
`degraded.value === true` and `resolveTerminalExit({exitCode: 0, …}) === 2`, with an
unflipped-flag control returning 0.
Measured end to end through the real `runDebate`, twin bench, one unbindable `-rv` leg: **3
adjudications → 2**, the seat-less phantom row gone, `Confirmed {a:2,d:1}` → `Contested {a:1,d:1}`,
exactly one `seat-unbound` note — and the **bound** twin's re-vote still applies, so the refusal is
**surgical**, not a blanket revert. Named mutants, all recorded in `tests/council/run-debate.test.js`
and each hand-applied then byte-verified on revert. ⚠️ **Every count below was re-measured at T5.5
(2026-08-22)** across six suites — `run-debate.test.js` + `debate.test.js` + `run-stages.test.js` +
`seat-space.test.js` + `degrade-sink.test.js` + `run-finalize.test.js` (243 tests) — because T5.5
added three tests to the guard's path, and **three counts moved**. Deleting the guard (`JOINBLIND`,
red set 1 at T5.1; the identical deletion re-measured as `E2EBLIND`, 2, once T5.2's end-to-end pin
existed) reds **6**; `LEGDROP` was 1 and is **2**; `REFUSEALL` is **3**, unchanged. T5.5's own four:
**`BOUNDREADD`** (**2** — re-add the deleted arm and its Set), **`WHYSTALE`** (**2** — restore the
pre-T5.5 `why` literal), **`NOTEHEAL`** (**1** — make the refusal's record `kind: 'heal'`, so it
stops degrading the run), **`KEYRAW`** (**1** — drop the join key's `|| 'unknown'` fallback, so a
leg carrying no model name renders `'undefined'`) and **`WHATSTALE`** (**3** — restore the
pre-round-3 `what` literal, which still claimed the refused leg "matches no seat on that wave's
roster"). ⚠️ Re-measured a SECOND time after review round 1 added the note-fallback test:
guard-deletion 5 → **6**, `WHYSTALE` 1 → **2**; re-measured a THIRD time in round 3 with all eight
unchanged but for the new `WHATSTALE`. The pre-T5.5 numbers are DATED readings, not live values.
SI-13 shipped as **documentation only**, exactly as **R8** predicted: `debate.js :: applyDebate`'s
docblock now states the `aliasOf` contract. **No behaviour change, no thrown error**; making
`aliasOf` required was considered and NOT taken. Two things R8 ruled *against* and that this phase
therefore did not do: **resolving** an ambiguous bare-alias key to a seat, and `applied: false` rows
in `debate.json` (so `revoteJudges` and `revoteApplied` visibly disagree on a refused leg, and the
degrade note is what explains why).

### Phase 6 · Independents — ~6 PRs, each ships alone
~~SI-22.4 trim (+ the knock-on: trimming turns a padded preset into a REAL twin bench, so artifact
filenames change and `meta.seats` starts emitting)~~ **DONE (v4.8 SI-22.4, 2026-08-23) — see
status-table row `| 22.4 |`; the knock-on is exactly right, and the row records the effect this
line does NOT name: four of six measured shapes gain a paid leg** · SI-23 (own PR, R10) · ~~SI-24 both sites
including the unfiled `computeStreetCred` **data-loss** site~~ **DONE (PR1, 2026-08-22) — see
status-table row `| 24 |`** · ~~SI-14 twin pin~~ **DONE (v4.8 Wave 1, 2026-08-22)** · ~~T6.5 repair-row
seat~~ **DROPPED** · ~~T6.6 `skills/` doc-fact gate~~ **DONE (v4.8 Wave 1, 2026-08-22)** · ~~SI-25 sites (1)+(2) (R15)~~ **DONE (v4.8 SI-25, 2026-08-23) — all THREE sites, ruling R25-1; see status-table row `\| 25 \|`**

> ⚠️ **T6.5 was DROPPED 2026-08-22 (v4.8 release inventory, owner ruling) because it was never specified.** `grep -rn "T6\.5"` over the whole repo returned exactly two hits — this line and its twin in `BACKLOG.md`'s Phase 6 resume point — and nothing else: no filed defect, no anchor, no description of what "repair-row seat" meant. It is struck rather than carried, on the reasoning that if it named something real it will resurface with an actual defect behind it. **Phase 6 is therefore ~6 PRs, of which SI-24 has shipped and 5 remain.**
> ⚠️ **Superseded 2026-08-22 (v4.8 Wave 1) — T6.6 and SI-14 also shipped, in the same PR as `#135
> C0` below. Phase 6 is down to 3: SI-22.4, SI-23, SI-25 sites (1)+(2).** See "Wave structure for
> the v4.8.0 remainder" after Phase 7, below, which is now the live resume point — the "each ships
> alone" ordering above is superseded by the owner's wave grouping.
> ⚠️ **Superseded again 2026-08-23: SI-23 shipped in Wave 2 and SI-25 shipped as its own PR, so
> Phase 6 is down to ONE — `SI-22.4`**, which is Wave 3's last item.
> ⚠️ **Superseded a third time, later on 2026-08-23: `SI-22.4` shipped. Phase 6 is CLOSED — ZERO
> members remain, and v4.8.0 is FEATURE-COMPLETE.** Only the release run is left.

> T6.6 is a live defect, not scaffolding: `tally.js :: assignTier` (`:28`) returns **Confirmed**
> (`confidence: thin`) for `(a=1, d=0)` — measured by execution 2026-08-21 — while
> `skills/second-opinion/SKILL.md:299` and `skills/second-opinion/COUNCIL-DESIGN.md:158` both define
> Singleton as `d = 0` and `a < 2`. `docs/council.md` is the correct one: its cascade table
> (`:662-673`) gives Confirmed for `a === 1 && d === 0` at `:667`, and `:671` states it in prose.
> **That stale line is what #130's author quoted.**
> ⚠️ **All four anchors re-derived 2026-08-21 (v4.8 Phase 5 T5.4) by opening each file, and two were
> wrong here.** `COUNCIL-DESIGN.md:155` is the **Disputed** row of that same cascade table, not the
> Singleton one — `:158` is Singleton; and `docs/council.md:662` is the cascade **heading**, not the
> row that decides `(1, 0)`. `SKILL.md:299` was correct as cited. The defect itself is unchanged —
> this is a citation repair, not a truth repair.
> ✅ **DONE — v4.8 Wave 1, T-W1.1 (2026-08-22, `c0a7c728`).** `assignTier` re-verified by execution
> across ten boundary `(a,d)` pairs before the fix. Both files now read Confirmed as "`a ≥ 2` and
> `a > d`, or `a = 1` and `d = 0`" and Singleton as "else (`a = 0` and `d = 0`)". A second, uncited
> twin surfaced while fixing this — a `SKILL.md` prose paraphrase ("at most one endorsement, no
> pushback") two paragraphs from the cited line, asserting the same false claim — fixed in the same
> commit, along with `COUNCIL-DESIGN.md`'s Confirmed row, which was independently missing the
> `a=1,d=0` case entirely. Full detail: `BACKLOG.md`'s T6.6 entry in the Phase 6 resume point.

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

✅ **`#135 C0` DONE — v4.8 Wave 1 (2026-08-22, `4391f0b4` + ripple fix `b0d8e232`).** Shipped
exactly as scoped: `DEFAULT_NO_OUTPUT_BACKSTOP_MS` 120000 → 300000, `council-review.yml:242`'s
override and its comment deleted, the owner's `900000` untouched (confirmed: it exists nowhere in
the tracked tree). ⚠️ **Scope grew from the 2 files measured above to 11**, forced rather than
chosen: the retry path doubles the backstop, so `run-retry.test.js`'s hardcoded `240000` assertions
had to become `600000` or CI would ship red, and several docs/tests asserted the old "120s" as a
live fact the change falsified. Named mutant `BACKSTOPDEFAULT`, red set 4 tests / 2 suites. A
review pass found one instance the first sweep missed (`src/sidecar/models-probe.js:31`, a second
"120s" claim in the same file already edited for this class) plus two more the controller's own
sweep added (`tests/no-output-backstop-wiring.test.js:383` and `:424`); all three closed in the
same follow-up commit. Full detail: `BACKLOG.md`'s `#135 C0` entries in the v4.8 release inventory.

✅ **`#133` Piece 1 DONE — v4.8 Wave 2 (2026-08-22, `86a069a6`, PR #185, ruling R13).** Shipped as
scoped: `opencodeSessionId` threaded onto `runHeadless`'s two substantive returns (guaranteed
assigned) and, measured rather than assumed, onto the catch-all exception return too
(`sessionId || null` — an exception before session creation reaches that same catch with the id
still unset); `fanout-leg.js`'s `legPatch` carries it through to disk with `|| undefined`, matching
the sibling status/reason/usage fields, so a session-less leg carries neither key rather than a
`null` that could clobber a prior attempt's real id on a fallback retry. A same-PR council fix
round reordered the field after the return objects' spreads (fragility fix, no observed clobber)
and pinned the catch-all's sessionId-**unset** branch, which the first pass had reasoned about but
never actually pinned. ⚠️ **No named mutant exists for this change** — verification is 6 pinning
tests across 3 suites (`tests/headless.test.js` ×4, `tests/headless-poll-failures.test.js` ×1,
`tests/sidecar/fanout.test.js` ×1), one of the four in `headless.test.js` added by the council fix
round. Piece 1 only, per R13 — the log parser and the session-id resolver remain out of scope. Full
detail: `BACKLOG.md`'s Wave 2 record.

**W1-4 — v4.8 Wave 1 ruling (2026-08-22): `#135 C5` and the `#135 C2` probe are DEFERRED to v4.9.**
#135 self-describes as *"a placeholder for a reminder for a brainstorming session"* and neither
item has a measured target.

**W1-3 — v4.8 Wave 1 ruling (2026-08-22): the `mcp-server.js:684` one-liner and the
`listCouncilRuns` dedupe (6 rows / 5 ids) are DROPPED as never-specified, on the T6.5 precedent
(§5 Phase 6, above).** Both appeared only in this section's own `Carried:` line and in
`BACKLOG.md`'s release inventory quoting it — no filed defect, no anchor, no description; the "6
rows / 5 ids" measurement exists nowhere else in the tree. ⚠️ **Not the same as `BACKLOG.md`'s live
entry "Council runs are invisible to CLI `amicus list`"** (`mcp-council-awareness.js:205`), which
is properly filed with two open design decisions and stays. **R16 is retained**, not dropped — see
its own §4 row and annotation: its "13 unpinned rails" phrase is unsourced, scope it from
`BACKLOG.md`'s `sessions-index.json` growth entry instead.

### Wave structure for the v4.8.0 remainder — owner ruling, v4.8 Wave 1 (2026-08-22)

Supersedes the Phase-6-then-Phase-7 sequencing above as the **resume point**; Phases 6 and 7 above
remain the measured substrate for what each item IS, not for what order to take them in.
⚠️ **The "resume point" role itself has since moved to "NEXT TASK — Wave 2.5" below** — this
section's own wave list is accurate as a record of what was ruled, but read the status annotations
inline (not this note) for what is actually done.

- **Wave 1** — batched, one PR. **DONE**: T6.6, SI-14, `#135 C0` (this PR).
- **Wave 2** — run **3-wide in isolated worktrees**: SI-23 · `#133 Piece 1` · SI-18 (newly promoted
  into v4.8.0 scope by `BACKLOG.md`'s release inventory, not part of Phase 6/7 as originally
  scoped) — **then** SI-25 sites (1)+(2) · `#138` Pieces 1+2.
  ✅ **The 3-wide slot is DONE — 2026-08-22**: `SI-23` (`d5378684`, PR #183), `#133 Piece 1`
  (`86a069a6`, PR #185), `SI-18` (`78ed7a40`, PR #184) — see status-table rows 18/23 and the Phase
  7 `#133` annotation, above. ⚠️ **The "then" half — `SI-25` sites (1)+(2), `#138` Pieces 1+2 — did
  NOT ship** and is not part of what "Wave 2 done" covers. ⚠️ **`SI-25` shipped later, on 2026-08-23,
  as its own PR outside every wave — and shipped all THREE sites (R25-1); see the annotated
  "Not in a wave" bullet below.** `#138` Pieces 1+2 remain open.
- **Wave 2.5 — DONE.** R16, scoped from `BACKLOG.md`'s `sessions-index.json` growth entry, not from
  this document's own "13 unpinned rails" wording (unsourced — see §4's R16 annotation). ✅ Shipped
  2026-08-22 as `T-R16.1` (`0a6a8032`) — see §4's R16 annotation, above, for the full record.
- **Wave 3 — ✅ DONE 2026-08-23.** **strictly serial**: SI-27 **first** (✅ **DONE 2026-08-23** —
  see row 27), SI-22.4 **LAST** (✅ **DONE 2026-08-23** — see row 22.4; the serial order held, and
  the knock-on below is exactly what the artifacts show) — SI-22.4’s trim knock-on
  turns a whitespace-padded preset member into a REAL twin bench (changed artifact filenames,
  `meta.seats` starts emitting), which SI-27’s consolidation should absorb rather than the other
  way around — and, SI-27 having shipped first, now will. ⚠️ **CORRECTED 2026-08-23: this said
  `SI-27` extracts from `src/council/run-retry.js`
  (300/300). It does NOT** — see row 27’s anchor above. That file holds no padding site and
  gained no headroom from SI-27; **nothing else in v4.8.0 relieves its 300/300** (`BACKLOG.md`).
  ⚠️ **Precision, 2026-08-23: SI-27 did change ONE comment line in it** (ruling P5, one line →
  one line, still exactly 300/300) — so "not a site" is true, "not touched at all" is not.
  ⚠️ Since
  Wave 2.5, `src/cli-handlers-doctor.js` is also at 299/300 and the file-size gate more broadly is
  at saturation (three files at 300/300, twelve within 6 lines of the cap) — re-measured detail in
  `BACKLOG.md`’s two dedicated entries; neither blocks the Wave 3 remainder.
- ~~Not in a wave: `SI-25` sites (1)+(2) (ruling R15 — remaining Phase 6 member, not yet scheduled).~~
  ✅ **DONE 2026-08-23** — it never joined a wave; it shipped as its own PR on branch
  `v48-si25-chair-packet-seats` (`f7fe180d` + `0c06bca9` + `95ee5520`), and it shipped **all three**
  rendering sites, not the (1)+(2) R15 scheduled (ruling **R25-1**). ⚠️ **After this, `SI-22.4` is
  the only item left before the release** — Wave 3's last, for the twin-bench knock-on stated above.
  ✅ **`SI-22.4` SHIPPED later on 2026-08-23** (`1c7a9087` + `4c49becc` + `f771f59b`, branch
  `v48-si22.4-preset-trim`). **v4.8.0 is FEATURE-COMPLETE**: the release run — version pin across 6
  files → CHANGELOG → tag → `publish.yml` — is the only remaining task.

Full detail and citations: `BACKLOG.md`’s "NEXT TASK — Wave 3 remainder" entry (2026-08-23) in
the Phase 6 resume point — it supersedes the "NEXT TASK — Wave 3" entry this line used to name,
and carries the ticked SI-27 record plus the three SI-27 riders.

### Post-Phase-2 · SI-27 — 1 PR — ✅ SHIPPED 2026-08-23
Padding/bindSeats/placeholder-filter core → `stage1-bind.js`, parameterised on
`(waveId, rosterSource, aliasAt, legs)`, returning both the filtered `seatOf` Map and the raw
`bindRes`. **The orphan tail differs at all three sites (push / degrade.note / nothing) and stays
at the call site.** Own PR — consolidation must not ride a defect PR.
✅ **Shipped exactly that way**: own PR, after Phase 2, on the stated signature, returning
`{seatOf, bindRes, placeholders}`, every site keeping its own tail — `80680c9f` + `ed827eaa` +
`68bee03e` + `d29a3462`. Full record: `BACKLOG.md`’s ticked SI-27 entry and row 27 above.

**Roughly 24–28 PRs**, though Phase 6 and 7 are mostly small and several will combine.

---

## 6. Hard prerequisites vs preference ordering

**Genuinely gating (mechanical):**
- T1.1 → Phase 3 + #135 C2 + carried PR1F-2 (one extraction, three consumers)
- T1.2 → T2.4 (**not** SI-25 — corrected 2026-08-16; see the Phase 1 task list. SI-25's sites are
  in `briefings-chair.js` and `run-assemble.js`, never `report.js`. Its one mechanical gate was
  T1.1, which has shipped: `run-assemble.js` 297 → 252, and `briefings-chair.js` is 182 — both
  clear of the 300-line gate, so nothing now blocks SI-25 sites (1)+(2))
  ✅ **Discharged 2026-08-23 — SI-25 has shipped**, all three sites (R25-1). The two line counts in
  this bullet are the 2026-08-16 readings and have since moved: `briefings-chair.js` **243**,
  `run-assemble.js` **278**, both still clear of the gate.
- T2.1 → T2.2
- R2's ruling → T2.2, T2.3, T2.4
- Phase 3's internal order, and `ledger.js:106` in the same PR
- Phase 3 → SI-25 site (3) — ✅ **both ends done**: Phase 3 shipped 2026-08-21 (unblocking only),
  site (3) shipped 2026-08-23 inside SI-25 (R25-1). ⚠️ This gate is why site (3) was homeless for two
  days: discharging a prerequisite is not doing the work behind it.
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
