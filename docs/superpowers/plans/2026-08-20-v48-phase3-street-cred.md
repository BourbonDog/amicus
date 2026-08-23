# v4.8.0 · Phase 3 — seat-keyed street cred + ledger

**Branch** `v48-phase3-street-cred` · **BASE** `006bdec5` (merge of PR #175) · written 2026-08-20.

Phase 2 is closed. Street cred is the last producer surface still computed entirely in alias space:
on a twin bench `rankPositions` overwrites one twin's position, `computeStreetCred` emits two
byte-identical rows, and the ledger's `Map` join drops one of them. The three are one defect and
must be taken as one seat-keyed change — piecemeal, each fix makes the next one worse.

Written just-in-time per the standing ruling on plan rot. **Every number below was measured at BASE
on 2026-08-20 by execution and must be re-measured by the task that depends on it.**

---

## 0. Measured substrate — 2026-08-20 at `006bdec5`

### 0.1 Gates — there are SIX, not four

The brief named four. CI (`.github/workflows/ci.yml:75-79`) runs five gate scripts plus the suite.
All six measured green at BASE, each with its own exit code (not a pipeline's):

| gate | result |
|---|---|
| `npm run lint` | exit 0 |
| `npm run check:secrets` | exit 0 |
| `npm run check:sizes` | exit 0 |
| `npm run check:citations` | exit 0 |
| `npm run check:tarball` | exit 0 |
| `npm run validate-docs` | exit 0 — "All markers are current." |
| `npm test` | **541 suites / 7723 passed / 8 skipped / 4 snapshots / 0 failed**, zero `●` |

⚠️ **The recorded baseline of `7711 passed` is stale — the measured count is `7723`.** Suites match
at 541. Do not carry 7711 forward.

⚠️ `validate-docs` is NOT in CI. It checks `CLAUDE.md`'s `AUTO:` markers, and **`CLAUDE.md` is
gitignored** (`.gitignore` :: "Agent instruction files (local development only)"). A new `src/`
module still requires `npm run generate-docs` locally or this gate reddens for you alone.

⚠️ Known intermittent: `tests/docs-plan-refs.test.js`, ~1 red in 8 runs. It PASSED this run.
Capture the full `●` block verbatim before re-running.

### 0.2 Sizes (authoritative rule: `content.split('\n').length`, −1 if it ends with `\n`)

Measured with the gate's own rule, self-checked against two known values first
(`run-retry.js` = 299 ✓, `run-stages.js` = 294 ✓).

| File | Lines | |
|---|---:|---|
| `src/council/ledger.js` | **283/300** | ⚠️ 17 free — **Phase 3 must edit it.** See §2 |
| `src/council/run.js` | **281/300** | ⚠️ 19 free — T3.2 touches the `assignLabels` call site |
| `src/council/run-assemble.js` | 252/300 | 48 free — the `rankings[]` site |
| `src/council/verdict.js` | 231/300 | 69 free — the closed streetCred literal |
| `src/council/tally.js` | 188/300 | 112 free — the bulk of T3.3 lands here |
| `src/council/report-html.js` | 146/300 | |
| `src/council/report-md.js` | 130/300 | |
| `src/council/anonymize.js` | 91/300 | 209 free — T3.1 only removes lines |
| `src/council/report.js` | **295/300** | ⛔ 5 free — but see below, Phase 3 does NOT touch it |
| `src/workspace/matrix-model.js` | 216/300 | T2.4 territory — leave alone |
| `src/council/run-retry.js` | **299/300** | ⛔ untouchable |
| `src/council/run-stages.js` | **294/300** | ⛔ untouchable |

**Two corrections to the brief's table, both measured:** `report.js` is **295**, not 277;
`matrix-model.js` is **216**, not 212.

✅ **`report.js` at 295/300 is NOT a Phase 3 risk.** Its only streetCred contact is
`report.js:269` — `streetCred: verdict.streetCred || []`, a pure pass-through. Verified by grep:
that is the file's sole `streetCred` occurrence. The renderers that read the rows
(`report-md.js`, `report-html.js`) have 170 and 154 lines free.

⚠️ **`tests/**` is NOT size-gated** — `CONFIG.include` is `['src/**/*.js', 'electron/**/*.js']`.
Test work in this PR is unconstrained by the ceiling.

### 0.3 The central hazard, reproduced by probe

Against the live `src/council/tally.js :: computeStreetCred`, bench `models: ['a','a','b']`:

```
row0 === row1 byte-identical?  true
ledger.js:106 Map size: 2  (streetCred rows in: 3)   -> 1 row dropped
LOSSLESS TODAY? true
```

And the same join over rows that DIVERGE (what seat-keying `rankPositions` alone produces):

```
Map size: 2 of 3 -> DROPPED 1
survivor for 'a': {"withSelf":2.5,"peersOnly":3,...}
SILENTLY LOST:    {"withSelf":1.5,"peersOnly":2,...}
```

✅ **CONFIRMED by execution, first-hand.** The twin rows are byte-identical today, so the drop is a
genuine no-op. Seat-key `rankPositions` alone and the drop starts losing a real seat's numbers into
an **append-only** file. `src/council/ledger.js :: buildLedgerRows`' join must ship in this PR.

The site, re-derived (the brief's `ledger.js:106` is **exact and un-rotted**):

```js
// src/council/ledger.js :: buildLedgerRows
const sc = new Map(streetCred.map(s => [s.model, s]));
```

Its two readers are `ledger.js :: buildLedgerRows`' `const s = sc.get(model) || {};` and the
`streetCredWithSelf` / `streetCredPeersOnly` row fields immediately below it.

### 0.4 A SECOND collapse, measured — `perJudgeRank`

Not named in the brief. Two twin JUDGES (both seats of alias `a` returned a ranking):

```
rankings: [{judge:'a',order:['a','b']}, {judge:'a',order:['b','a']}, {judge:'b',order:['a','b']}]
perJudgeRank for model "a": {"a":2,"b":1}   <- 2 entries, but 3 judges ranked it
withSelf 1.333  peersOnly 1
```

`perJudgeRank[judge] = rank` is **last-wins keyed by judge alias**, while `withSelf`/`peersOnly`
accumulate into ARRAYS. So on a twin bench **the map and the averages disagree on the same row**:
`perJudgeRank` implies mean 1.5, `withSelf` reports 1.333. This is the *"unfiled `computeStreetCred`
**data-loss** site"* the phasing doc files under row `| 24 |` (`tally.js :: tally` **+
`:: computeStreetCred`**). It is in T3.3's path and must be closed or explicitly declared out.

### 0.5 ⚠️ The seat universe — you may NOT join positionally, and the code says so

The obvious design (walk `meta.models` and `meta.seats` in lockstep) is **explicitly forbidden by
the codebase**, in the comment guarding the emit itself:

> `src/council/run-assemble.js :: buildTallyInput` — *"⚠️ Consumers: absence means "no seat table
> available", NEVER "the bench was unique" … And seats[] is BENCH-ONLY, so it must never be joined
> positionally to meta.models (`claude` is pushed onto that at :226) or to streetCred[]."*

Three measured facts behind it:
- `meta.seats` is emitted **only** when `seats.some(s => s.id !== s.alias)` — i.e. only on a
  repeated-alias bench. Absence never means "the bench was unique".
- `meta.models` gets `claude` pushed onto it (`run-assemble.js :: buildTallyInput`), `meta.seats`
  never does — `seats.js :: buildSeats` is bench-only by design.
- Two of `appendRun`'s three call sites (`cli-handlers-council.js`, `mcp-server.js`) feed
  hand-assembled input that no seat machinery ever touches.

**Therefore: every seat join in this PR is BY VALUE (alias / seat id), never by index.**

⚠️ That comment's own `(:226)` citation has **rotted** — `run-assemble.js:226` is
`const packet = buildChairPacket({`. The real `meta.models.push(CLAUDE_SEAT)` is at
`run-assemble.js:181`. It is a bare `:NNN` continuation, so the citation gate is structurally blind
to it (Mechanism C). Phase 3 edits this comment; re-anchor it BY SYMBOL.

### 0.6 ⚠️ `labelMap` must NOT be seat-ified — measured

T3.2 says "seat-ify `assignLabels`/`rankingToOrder`". Taken literally — changing `labelMap`'s
VALUES from aliases to seat ids — it breaks a live Workspace consumer. Measured against the real
`src/workspace/blind-mode.js :: labelFor`:

```
TODAY     labelFor("gemini", {'Review A':'gemini'})   -> "Review A"
SEATIFIED labelFor("gemini", {'Review A':'gemini#1'}) -> null      <- the label is LOST
```

`labelFor` does an exact-string match against the labelMap VALUE. `src/workspace/live-normalize.js`
names this exact class in-code: the alias *"is the council ALIAS (e.g. `gemini`) that run.json's
labelMap and blind mode's labelFor() key on"*, and a lookup that never matches is how blind mode
breaks. `labelMap` is also persisted to `run.json` (`run.js :: runCouncil` checkpoint) and declared
in `schemas/council-run.schema.json:45`.

⚠️ **State it accurately:** the measured effect is that the label is **lost** (`null`). Do not
escalate that to "leaks the model id" — that is the neighbouring failure the cited comment
describes, and this probe did not measure it.

**Design consequence, binding on T3.2:** `labelMap` keeps label→alias, byte-identical. Seat identity
rides a SEPARATE, additive channel. See T3.2.

### 0.7 Schema headroom — measured, and it is permissive

```
council-tally.schema.json  streetCred.items -> keys: [type, required(['model']), properties]
                                               additionalProperties: ABSENT -> permissive
council-verdict.schema.json streetCred.items -> {"type":"object"}   -> fully permissive
```

An additive `seat` field on a streetCred row validates against BOTH schemas with no edit. The schema
should still be updated for documentation, but this is **not** a breaking schema change.
`rankings[]` in `src/mcp-tools.js` is a `z.object` and must be checked separately — R10 records that
a *closed* `z.object` there silently drops fields.

### 0.8 Citations re-derived against the live tree — the rot table

Every line below was **opened**. No offset arithmetic was used, and none may be: the five rotted
`tally.js` citations happen to be uniformly +1, which is exactly the coincidence that has shipped
wrong values twice in this release.

| Cited as | Claim | ACTUAL at `006bdec5` | |
|---|---|---|---|
| `ledger.js:106` | the streetCred Map join | `const sc = new Map(streetCred.map(s => [s.model, s]));` | ✅ exact |
| `buildTallyInput:216` (phasing doc T3.2) | the `rankings[]` site | `:216` is a JSDoc line; real site is `run-assemble.js:171` | ❌ rotted |
| `tally.js:32-42` (BACKLOG) | `rankPositions` | `:32` is the JSDoc; fn opens `:33` | ❌ rotted |
| `tally.js:38` (BACKLOG) | `pos.set(m, meanPos)` | `:38` is `const meanPos = …`; `pos.set` is `:39` | ❌ rotted |
| `tally.js:49-67` (BACKLOG) | `computeStreetCred` | `:49` is `*/`; fn opens `:50` | ❌ rotted |
| `tally.js:51` (BACKLOG) | the `models.map` driver | `:51` is `const judgePos = …`; driver is `:52` | ❌ rotted |
| `tally.js:58` (BACKLOG) | the `judge !== m` peer split | `:58` is `all.push(rank);`; split is `:59` | ❌ rotted |
| `tally.test.js:331` / `:357` (phasing doc) | T1 / T2 | T1 is `:341`, T2 is `:367` | ❌ **the CORRECTION rotted** |
| `run-assemble.js:194`'s `(:89)` | the emit-when-DIFFERENT predicate | `:89` is `/**`; predicate is `run-stats-entry.js:64` | ❌ rotted, in `src/` |
| `run-assemble.js` comment's `(:226)` | `meta.models.push(CLAUDE_SEAT)` | `:226` is `const packet = …`; real site `:181` | ❌ rotted, in `src/` |
| `anonymize.js` `:18` `:28` `:31` `:33` (SI-26) | the four `letterByModel` lines | all four exact | ✅ |
| `briefings-chair.js:88` / `:93` (SI-25) | reviews / adjudications render | both exact | ✅ |
| `live-normalize.js`'s `anonymize.js:30` | labelMap stamped from alias | `labelMap[e.label] = e.model;` | ✅ |

**Every one of these is converted to a SYMBOL anchor by this PR (rule 5b), not to a new number.**

⚠️ **ANNOTATION 2026-08-23 — the `briefings-chair.js:88` / `:93` (SI-25) row's ✅ has expired.** Both
numbers were exact when this table was taken (`006bdec5`) and both have since moved: `SI-25`
(`f7fe180d`) seat-keyed those renders, so at its HEAD site (1) is `:149` and site (2) is `:154`, with
the rankings render — site (3), which this row does not list — at `:151`. The row is left as the
audit's own record; the durable anchor is `briefings-chair.js :: buildChairPacket`. This is the
table's own point demonstrating itself: a ✅ on a line number is a timestamp, not a property.

### 0.9 The citation gate's blind spots — re-measured by executing its own parser

Run against the real exported `parseCitations`:

```
A. same-line symbol anchor  -> ["ledger.js :: buildLedgerRows"]   VISIBLE
B. WRAPPED across newline   -> INVISIBLE
C. bare :NNN continuation   -> INVISIBLE
D. non-.js path (.md)       -> INVISIBLE
E. non-.js path (.json)     -> INVISIBLE
F. quoted test title        -> INVISIBLE
```

`parseCitations` splits on `\n` and execs **per line**; the regex requires the path to end in `.js`.
A green `check:citations` is not evidence. Two of the rotted rows in §0.8 are in `src/` and are
invisible to it today.

### 0.10 The pins that must be REPLACED, not adjusted

- **`tests/council/ledger.test.js:767` — T12**, *"street cred stays alias-keyed on EVERY row, and the
  launch stays on the short alias"*. Its load-bearing assertions are
  `expect(rows[1].streetCredPeersOnly).toBe(1)` and
  `expect(pickFallbackChair(…)).toBe('gpt-5')`. T3.3 changes exactly this behaviour.
  **Replace it deliberately** — the PR-B lesson is that an adjusted pin can go green against its own
  mutant.
- ⚠️ **A near-twin pin sits immediately before it** (the `// street cred does NOT concentrate`
  assertion in the preceding test). T3.3 names only T12; **this second one will also move.** Do not
  discover it from a red — go and read it first.
  > ⚠️ **WRONG, BY MEASUREMENT (T3.3, confirmed by T3.4).** The near-twin pin is `T11`
  > (`ledger.test.js:754`, *"a split alias concentrates FINDINGS on the anchor"*) and its
  > `streetCredPeersOnly` assertion does **not** move: its fixture (`models ['gpt','other']`,
  > hand-written alias-keyed `streetCred`, no `seat` on any `runStats` row) takes the alias branch
  > both before and after this PR, so `rows[1].streetCredPeersOnly` reads `1` unchanged. T3.3 read
  > it first as this note instructed, measured the false prediction, and annotated T11 in place
  > (`ledger.test.js:774-781`) to say WHY it is unchanged — the alias fallback, now one branch of
  > two — rather than moving it for ceremony. `T12` (this section's actual subject) still moved,
  > exactly as predicted above.

---

## 1. Scope

**Closes** SI-06, SI-17, SI-18, SI-19, SI-20. **Unblocks** SI-25 site (3).

> ⚠️ **WRONG ABOUT SI-18 — measured 2026-08-21 (T3.4), not merely disputed.** This PR does NOT close
> SI-18 ("findings attributed by alias", `ledger.js :: buildLedgerRows`).
> `findings.filter(f => f.raiser === model)` — SI-18's own body — is byte-unchanged across every
> commit of this entire PR (zero-context diff, this plan's own `006bdec5` base to the branch tip).
> What T3.3 closes at the SAME `buildLedgerRows` anchor is the street-cred join (SI-20's third
> site), a neighbour, not SI-18 itself. Read "Closes" above as SI-06, SI-17, SI-19, SI-20 only.

Their definitions, from the phasing doc's §1 status table (one line each; there are no fuller
filings — the BACKLOG bodies are written as bare `| NN |` rows that `git grep SI-06` cannot find):

| # | Item | Anchor |
|---|---|---|
| 06 | `computeStreetCred` peer split | `tally.js :: computeStreetCred` |
| 17 | chair-on-bench, no engine guard | `seats.js :: preflightSeats` (absence) |
| 18 | findings attributed by alias | `ledger.js :: buildLedgerRows` |
| 19 | never-ran aggregate stays chair-promotable | `run-chair.js :: pickFallbackChair` |
| 20 | street cred collapses twins ×3 | `tally.js :: rankPositions` · `:: computeStreetCred` · `ledger.js` |
| 26 | `letterByModel` dead code | `anonymize.js :: assignLabels` |

**SI-25 site (3), identified first-hand.** `briefings-chair.js :: buildChairPacket` has three
alias-space sites: `:88` reviews, `:93` adjudications, and **`:90` rankings** —
`` `${r.judge}: ${JSON.stringify(r.order)}` ``. Site (3) is the rankings one, which is why R15 has it
riding this phase. **Phase 3 UNBLOCKS it; Phase 3 does not do it.** Nothing in this PR may claim
SI-25 closed.

⚠️ **ANNOTATION 2026-08-23 — leave this paragraph exactly as it stands; it is why the numbering is
trustworthy.** This is the first-hand identification that fixed which site is which, and every later
document (ruling R15, the SI-25 plan, ruling R25-1) depends on it. Two things follow it, neither of
which changes it:
1. **The middle sentence did exactly what it said, and that is the whole problem.** Phase 3 shipped
   on 2026-08-21 having unblocked site (3) and not done it, so R15's home for site (3) — *"the
   street-cred PR"*, i.e. this one — evaporated. Site (3) was then unblocked and **homeless**.
2. **Ruling R25-1 (2026-08-23) therefore did ALL THREE sites in SI-25's own PR** (`f7fe180d` +
   `0c06bca9` + `95ee5520`), not the (1)+(2) R15 scheduled. **That is not scope creep** — the
   deferral had no remaining referent, and a two-of-three fix would have left the rankings block
   alias-keyed while the record claimed SI-25 closed.

⚠️ **The line numbers above are `006bdec5` readings and have moved** (site (1) `:149`, site (3)
`:151`, site (2) `:154` at SI-25's HEAD). **The site NUMBERING has not moved and must not** — site
(3) is the rankings render, the MIDDLE one in the file, not the last.

### Explicitly OUT of scope — nothing may claim otherwise

- **SI-22.1 and SI-22.2 remain OPEN.** Per R2 the ambiguous peer drop stays, `basis` does not move
  for it, and the undercount deliberately remains.
- **SI-12 remains OPEN** — *double-orphan conformance collapse* in `run.js :: runCouncil`. It is
  NOT what T2.4 closed (that was SI-22.5; ruling R19). If you meet "SI-12" used for a consumer-side
  join defect, that is the mislabel that originated at `4ee46696`.
- **The roster SOURCES** (`verdict.seats`/`council` vs `tally.meta.seats`/`models` + `claudeTail`)
  are unproven and stay unproven here. R17 residual. The rig exists
  (`tests/council/seat-matrix.test.js :: disagreement`) for whoever takes it.
- **R20's claude-column divergence** — disclose/pin/file only. Do not align the rosters.
- **`report.js` and `matrix-model.js`** — T2.4 territory, untouched.
- **`seatKey` cross-file consolidation** → v4.9 per R14. It is still spelled three times
  (`run-retry-keys.js:15`, `run-debate-revote.js:64`, `run.js:228`). **Reuse the rule; do not
  consolidate it.**

### ⚠️ Disambiguate "R4" before citing it

There are two, and they read differently:
- **Owner ruling R4** — *"Chair-on-bench (SI-17): **Normalise before the ledger join**, inside
  Phase 3 — works on all paths including the two hand-assembled `appendRun` ones a preflight guard
  cannot reach."* **This is Phase 3 work.**
- **A review finding R4** from an earlier PR (Workspace dead-seat), deferred to v4.9 with SI-02 and
  PR5b-1.

The phasing doc settles it: *"**R4 and R5 are NOT one job.**"* and *"**nothing in v4.8 can cure
R4**"* — the latter is about the **Workspace/critic half only**. Do not read the v4.9 deferral as
cancelling the Phase 3 line item.

---

## 2. The `ledger.js` extraction — planned BEFORE it is needed (T3.0)

⚠️ **This is the gating fact of the phase, the way `run-retry.js` was for Phase 2.** `ledger.js` is
283/300 with **17 free**, and Phase 3 must edit its join plus write the comment run that explains a
seat-keyed join into an append-only file. T2.4 measured `report.js` going 197 → 295 in one task,
almost all comment. 17 lines does not survive that. **Constraint 6: when the gate fires, EXTRACT.**

**The seam: WRITE path vs READ/aggregate path.** Measured — it is clean and one-directional.

| stays in `ledger.js` | moves to `src/council/ledger-stats.js` |
|---|---|
| `LEDGER_SCHEMA_VERSION`, `LEDGER_JOIN_ROLES`, `joinsLedger` | `LEDGER_FILE` |
| `countSeverity`, `CONFORMANCE_RANK`, `mergeConformance` | `readRows`, `avg`, `countRuns` |
| `buildLedgerRows`, `appendRun` | `deriveReliability`, `buildStatsDoc` |

**Measured split** (`sed`-extracted at BASE, counted with the gate's rule):

```
moved body (readRows … buildStatsDoc):  83 lines
remainder (1-191 + 275-283):           200 lines
```

`ledger.js` lands at **~200-205** once the require and re-exports are added — **~95 lines of
headroom**, which is what the seat-join comment needs.

**Why `ledger-stats.js` owns `LEDGER_FILE`:** it is the only value both halves share (`appendRun`
writes it, `readRows` reads it). Putting it in the leaf makes the dependency one-directional —
`ledger.js → ledger-stats.js`, no cycle. `buildStatsDoc`'s lazy `require('./tally')` travels with it
unchanged.

**`ledger.js` re-exports the moved names.** Its `module.exports` surface stays byte-identical, so
**zero consumers change**: `cli-handlers-council.js`, `run-server.js`, `run.js`, `mcp-server.js` and
eight test files all keep importing from `./council/ledger`. This is the lowest-risk shape available
and it makes the move provable as a pure move.

⚠️ `ledger.js`'s export block carries *"CLAUDE.md's AUTO:modules marker truncates at five exports —
append new ones at the END"*. Honour it, and run `npm run generate-docs` for the new module (§0.1).

**T3.0 is a PURE MOVE.** Byte-identical function bodies, separate commit, `npm test` green before
any Phase 3 behaviour change is written. Phase 1 and Phase 2 both landed their extractions
byte-perfect first try; there is no reason for this one to be different.

---

## 3. Global Constraints

**Inherited verbatim from `docs/superpowers/plans/2026-08-17-v48-t2x-run-retry-extraction.md`
§Global Constraints.** They were earned by ~30 review findings. **Not re-derived, not softened.**
Read that section — **1–11 and 5a–5d bind every task here.** Echoed below is only the subset this PR
will actually collide with; 4, 8, 9 and 11 bind by reference and are not restated.

- **1 · Verification by EXECUTION, never by assertion.** Every numeric claim measured; every
  citation traced to the executing line.
- **2 · Preservation pins are green at HEAD by construction — prove each with a NAMED MUTANT, never
  RED-before-GREEN.** The behaviour changes here (the seat on `rankings[]`, the seat-keyed
  `rankPositions`, the ledger join) DO get RED-before-GREEN.
- **3 · NEVER run any command that overwrites the working tree from the index or a commit** —
  `git checkout -- <path>`, `git checkout-index`, `git restore`, whatever it is called. **The rule
  is by EFFECT, not by spelling.** T2.4 lost two Critical repairs to `git checkout-index -f -a`,
  which exited 0 with no output. Commit before mutants; hand-revert; byte-verify with
  `git show HEAD:<path>`.
- **5 / 5a / 5b · Grep the distinctive PHRASE repo-wide, case-INSENSITIVELY.** Sweep citations of
  every file the commit TOUCHES, not just those whose citations you are fixing. Symbol anchors,
  never new line numbers, **never offset arithmetic — OPEN THE LINE.** Whole `file.js :: symbol`
  token on ONE physical line or the gate is blind to it (§0.9).
- **5c / 5d · Sweep for prose the behaviour change falsified, and read every NEW sentence against
  the code.** `docs/council.md` is covered by no gate at all.
- **6 · The 300-line gate blocks the COMMIT. EXTRACT, never shave.** §2 does this up front.
- **7 · Do not write a test whose title claims more than its assertion executes.**
- **10 · The council RENUMBERS findings between rounds.** Anchor by commit + mechanism, never by a
  bare id. A repeated finding is not a stronger one — in T2.4 thirteen findings collapsed to five
  mechanisms, one raised four times under four ids. Adjudicate each by measurement; one run, then
  move on.

**Additional, specific to this PR:**

- **P-1 · `ledger.js :: buildLedgerRows`' join ships in THIS PR.** Non-negotiable (§0.3). A commit
  that seat-keys `rankPositions` without it is strictly worse than HEAD and must not exist even
  transiently on the branch — order the commits so the join lands with or before the divergence.
- **P-2 · Every seat join is BY VALUE, never by index** (§0.5). `meta.seats` is bench-only,
  conditionally emitted, and absent on two of three `appendRun` paths.
- **P-3 · `labelMap` keeps label→alias, byte-identical** (§0.6). Seat identity rides a separate
  additive channel. `schemas/council-run.schema.json` must not change.
- **P-4 · Emit-when-DIFFERENT, not emit-when-set.** Every new seat field follows the established
  predicate `seat && seat.id !== seat.alias` (`run-stats-entry.js:64`; adjudications at
  `run-assemble.js :: buildTallyInput`). **A unique-alias run's `run.json`, `tally-input.json`,
  `tally.json`, `verdict.json`, `report.md`, `report.html` and ledger rows must come out
  byte-identical.** Prove it, do not assume it.
- **P-5 · An empty red set means the property is UNPINNED, not that the code is safe.** T2.4 shipped
  a conjunct green against its own mutant and caught it only with an adversarial fixture.
- **P-6 · A jest output file contains TWO summary blocks and only the LAST is final.** `tail` it.
  Reading the first would have recorded a T2.4 mutant as `0 failed`.
- **P-7 · Nothing may claim SI-22.1, SI-22.2, SI-12 or SI-25 closed** (§1).

### Gates — all SIX must exit 0 before the PR is opened

```
npm test                       # baseline 541 suites / 7723 passed / 8 skipped / 0 failed
npm run lint
npm run check:secrets
npm run check:sizes
npm run check:citations
npm run check:tarball
npm run validate-docs
```

⚠️ **Hooks live in `.husky`. `pre-push` BLOCKS unless `.test-passed` matches HEAD exactly** — run
`npm test` AFTER the final commit. `posttest` writes `.test-passed`.

---

## 4. Tasks

### T3.0 — extract the ledger read half (pure move)

Per §2. `readRows`, `avg`, `countRuns`, `deriveReliability`, `buildStatsDoc` and `LEDGER_FILE` move
to `src/council/ledger-stats.js`; `ledger.js` requires it and re-exports every moved name so the
public surface is unchanged.

1. Move the bodies **byte-identically**. No renames, no reflow, no comment edits.
2. `ledger.js` re-exports; consumer imports are untouched. Verify by grep that no call site changed.
3. `npm run generate-docs` for the new module; `validate-docs` green.
4. `check:sizes` green with `ledger.js` measured **at or under ~205**.

**Named mutant** — this is a preservation task, so no RED-before-GREEN. At minimum: break the
re-export of `deriveReliability` and confirm the consumer suites go red, proving the shim is load
bearing rather than decorative.

**Done when:** all six gates green, `ledger.js` ≤ 210, and `git diff` shows no executable line
changed other than the require/export plumbing.

### T3.1 — SI-26: delete `letterByModel`

Four lines in `src/council/anonymize.js` — the JSDoc `:18`, the `const` `:28`, the assignment `:31`
and the return literal `:33` — plus two in `tests/council/anonymize.test.js` (`:8` destructure,
`:15` assertion). **Measured: zero production consumers repo-wide.**

Lands first because T3.2 edits the same return literal and JSDoc. If it folds into T3.2 instead,
say so in the commit rather than leaving two tasks claiming one edit.

**Named mutant:** none needed — this is a deletion. The proof is the repo-wide grep, run
case-insensitively, plus a green suite.

### T3.2 — the seat onto `rankings[]`, and the seat channel through `assignLabels`/`rankingToOrder`

The site, re-derived: `src/council/run-assemble.js :: buildTallyInput` —
`const rankings = okJudges.map(j => ({ judge: j.judge, order: j.order }));` (the phasing doc's
`buildTallyInput:216` is rotted; it is `:171` today, and it will move again — anchor by symbol).

1. `rankings[]` entries gain **`seat`** (the judge's own identity) under P-4's emit-when-DIFFERENT
   predicate, matching the adjudication `seat` emitted 1 line above it. `j.seat` can be null on an
   orphaned `-s2` leg — `run.js :: runCouncil`'s Stage-2 conformance merge already documents that
   exact case and falls back rather than assuming symmetry. **Copy that shape; do not invent a
   second one.**
2. `assignLabels` gains an additive seat channel — a label→seat-id map emitted only when the bench
   repeats an alias. **`labelMap` is untouched** (P-3, §0.6).
3. `rankingToOrder` gains the optional seat map and returns the seat-valued order alongside the
   alias-valued `order`. **`order` stays exactly as today** so `briefings-chair.js` and the tally
   schema are unmoved; site (3) becomes *possible*, not *done*.
   ⚠️ **STILL TRUE, BUT NO LONGER A FENCE — 2026-08-23.** Every clause holds: `order` is byte-for-byte
   what it was, and the tally schema is unmoved. **Do NOT read "`briefings-chair.js` is unmoved" as
   current state.** `SI-25` (`f7fe180d`, ruling R25-1) did site (3): `buildChairPacket`'s
   `rankingLines` now renders `seatKeyedOrder(r.order, r.orderSeats)` — a per-slot, tie-aware,
   null-safe zip of the two arrays this bullet created — instead of `JSON.stringify(r.order)`, and
   the file went 182 → 243 lines. What *this* PR left unmoved, the PR two days later moved, using
   exactly the channel this bullet opened. "Possible, not done" has become "done".
4. `src/council/verdict.js`'s closed streetCred literal —
   `record.streetCred.map(s => ({ model, withSelf, peersOnly }))` — **must carry the seat through**,
   or `verdict.json` silently strips it. This site is filed nowhere; it was found by measurement.
5. Update `schemas/council-tally.schema.json` for documentation (§0.7 — additive, non-breaking) and
   check `src/mcp-tools.js`'s `rankings` `z.object` is not closed (R10's class).

**RED-before-GREEN** for the new field. **Named mutants** for what must not regress: at minimum one
that flips the predicate to emit-when-set, which must red a byte-identity pin on a unique-alias
bench.

⚠️ **`run.js` has 19 free lines.** Put the explanatory weight in `anonymize.js` (209 free) and
`tally.js` (112 free), not at the call site. If `run.js` approaches the gate, **extract — do not
shave** (Constraint 6); its natural seam is the `// ---- Stage 2` block.

### T3.3 — the fixed internal order

`rankPositions` → peer split → `perJudgeRank` → `computeStreetCred` driver → ledger join. **In that
order**, per the phasing doc's gating list. Includes SI-17 **normalise** (R4).

1. **`rankPositions`** keys by seat when the order carries seats, else by alias exactly as today.
2. **The peer split** — `if (judge !== m)` at `tally.js:59` is the third alias comparison (SI-06).
   Seat-key it. ⚠️ Self-exclusion by alias currently drops **both** twin judges from a twin's peers;
   measured in §0.4. Decide that deliberately and pin what you decide.
3. **`perJudgeRank`** — close the last-wins collapse of §0.4, or declare it out with its
   measurement. The map and the averages must not disagree on the same row.
4. **The `computeStreetCred` driver** — one row per SEAT, joined BY VALUE (P-2), with alias rows for
   anything that has no seat (claude, hand-assembled input). `seat` additive under P-4.
5. **SI-17 normalise (R4)** — normalise **before** the ledger join, so it works on all three
   `appendRun` paths including the two hand-assembled ones a preflight guard cannot reach.
6. **The ledger join** — `new Map(streetCred.map(s => [s.model, s]))` becomes seat-aware. P-1: this
   lands with or before step 1, never after.

**RED-before-GREEN** for every behaviour change above. **Named mutants** for the preservation
properties — at minimum one reverting the join to `s.model`, which must red on a twin bench and be
**silent on a unique-alias bench** (that asymmetry is the whole point; if it reds on both, the
byte-identity property is not actually pinned).

**Replace `ledger.test.js` T12 deliberately**, and read its near-twin predecessor first (§0.10).

Record measured red sets **in the tree** (the `tests/council/peer-split-mutants.js` precedent), not
in a gitignored report path.

### T3.4 — the sweep

- Re-derive **every** citation in §0.8 against the FINAL tree and convert each to a symbol anchor.
  Open every line. The five `tally.js` rows are uniformly +1 — **do not apply +1**.
- Fix the two in-`src/` rots this plan found: `run-assemble.js`'s `(:89)` → `run-stats-entry.js ::
  buildRunStatsEntry`, and its `(:226)` → the `CLAUDE_SEAT` push by symbol. Both are invisible to
  the citation gate, so neither will be caught for you.
- Grep the distinctive PHRASE, **case-insensitively**, of every comment edited. T2.4's sweep
  reported "NONE" because it searched `SI-12` and the leftovers were lowercase `si12`.
- Sweep `docs/council.md` — no gate covers it. Its streetCred shape at `:634` shows `perJudgeRank`.
- Update `BACKLOG.md`: tick SI-06/17/18/19/20/26, repoint NEXT TASK, and correct the rotted
  citations in the SI-06/SI-20 bodies.
  > ⚠️ **WRONG ABOUT SI-18 — corrected by controller ruling before T3.4 executed (see §1's own
  > blockquote above for the measurement).** SI-18's own filter is byte-unchanged by this PR; only
  > SI-06, SI-17, SI-19, SI-20 and SI-26 were ticked. SI-18 stays open, annotated in place with its
  > narrowed scope, exactly as its own BACKLOG entry and the phasing doc's §1 row 18 now read.
- Close the Phase 3 record in the phasing doc (`✅ COMPLETED <date> by <task> (<sha>)`), following
  the T2.2/T2.3/T2.4 convention. **Append rulings, never renumber** — R1–R20 keep their numbers.

---

## 5. Definition of done

- All six gates green, `npm test` run AFTER the final commit.
- A unique-alias bench produces byte-identical `run.json`, `tally-input.json`, `tally.json`,
  `verdict.json`, `report.md`, `report.html` and ledger rows. **Proved by execution.**
- A twin bench produces one street-cred row per SEAT, and the ledger join drops none of them.
- Every mutant named in the plan re-run and its red set recorded in the tree.
- Every citation this PR touched re-derived against the FINAL tree and symbol-anchored.
- Nothing claims SI-22.1, SI-22.2, SI-12 or SI-25 closed.
- PR labelled `council-review` (it touches source). **Read the council's VERDICT COMMENT, not the
  job status** — the job passes regardless. A ~26s run with all legs dead is an OpenRouter monthly
  key-limit failure, not a clean review.
- `gh` needs `-R BourbonDog/amicus`. **NO REQUIRED STATUS CHECKS — `gh pr merge --auto` merges
  IMMEDIATELY.** Watch `gh pr checks <n> -R BourbonDog/amicus` explicitly.
