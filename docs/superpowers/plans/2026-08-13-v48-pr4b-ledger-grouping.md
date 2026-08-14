# v4.8 PR4b — Ledger `(model, resolvedModel)` grouping

**Branch:** `v48-pr4b-ledger-grouping` · **Merge base:** `c1c3a5ee` (PR #155, v4.8 PR4a)
**Spec:** `docs/superpowers/specs/2026-08-10-v4.8-ask-anything-count-everyone-design.md` §4.7, §4.9
**Predecessors:** PR0 `1031079` · PR1 `7cd32f8` · PR2a `5c93ead` · PR2b `ad8c83c` · PR3 `e2882192` · PR4a `c1c3a5ee`

> **Revision 3.** Rev 1 came from an 8-lens recon; a 7-lens round refuted it (**54 findings, 13
> CRITICAL**); rev 2 folded those; a 6-lens round then refuted **the corrections** (**58 findings,
> 17 CRITICAL — 40 of them introduced BY rev 2**). This revision folds round 2. It supersedes
> `2026-08-13-v48-pr4b-ledger-grouping-DRAFT.md` (the revision-3 PR4 plan) entirely.
>
> **The Critical count did not fall (13 → 17), and the cluster location is the reason this goes to
> implementation anyway.** Every round-2 Critical sits in **§5, the test specification** — none in
> §3, the design. Three independent lenses each BUILT §3 and agree it is sound: exactly the three
> predicted breaks and no fourth, `ledger.js` 221/300, `npm run lint` exit 0, final suite
> **522 suites / 7265 passed / 8 skipped, exit 0**, §1.4's arithmetic exact, §4.11 reproducing, and
> all three prescribed test fixes working. What kept failing was a **table of predictions about
> test outcomes** — which is not a thing prose can get right. §5 no longer predicts; it measures.
> A third refutation round on rewritten predictions would be the wrong lever a third time.
>
> **What revision 1 got wrong, and it is the whole shape of the PR.** It set out to make PR4b
> preserve HEAD's promoted fallback chair, and derived an emission-order rule to do it. Measured
> over 4000 randomised ledgers, the launched chair changes on **620 benches (15.5%)** — and the
> decomposition is:
>
> | cause | flips | fixable by re-ordering? |
> |---|---|---|
> | the fan-out changing which group wins | **537** | no |
> | emission order moving `aliases[0]` | 83 | partly — **33** of the 620 total |
> | the `runs` change | 18 | no |
>
> **Parity was never achievable, and emission order was the 13% lever.** This is failure class #7
> (the wrong lever) firing for the second consecutive PR. Revision 2 drops the parity goal
> (**R4b-3**) and states the honest property instead.

---

## 0. Owner rulings

| # | Ruling |
|---|---|
| **R4b-1** | `runs` counts **distinct `runId`s** per group, not rows. History self-corrects; the append-only file never blends two counting units. `lowN` follows `runs`. |
| **R4b-2** | On an alias that splits into multiple rows, **findings** statistics concentrate on one row; the others carry `findingsRaised: 0` and null rates. |
| **R4b-3** | **Accept and disclose the chair change.** PR4b corrects the ledger's model of history; corrected history re-ranks. Drop "identical to HEAD" from the plan, pin the NEW behaviour deliberately, and disclose in CHANGELOG + BACKLOG. |
| **R4b-4** | Within a multi-row pair group, `conformance` is **worst-wins** and `wasChair` **any-wins** — disclosed and tested on the documented `council tally` shape, even though it rewrites a persisted scalar there. |

**R4b-2 does NOT extend to street cred.** Revision 1 extended it and flagged the extension for
attack; the attack landed. Concentration of street cred **alone** flips the launch from `gpt-5` to
the raw executable id `openai/gpt-5` on bench `['gpt-5','gpt-5','openai/gpt-5']` with one twin leg
dead — the exact form `run-chair.js:48-52` argues against — while changing nothing on a plain
divergent twin. Measured: HEAD `gpt-5`, grouping-only `gpt-5`, grouping+concentration
`openai/gpt-5`. **Street cred stays alias-keyed on every row, exactly as today.**

Inherited and still binding:

- **A seat id must NEVER appear in a ledger row** (`run-stage1-rows.js:23-27`).
- **No dedup may drift onto the bench path** (`BACKLOG.md:1783` ruling 4; `BACKLOG.md:2114-2126`
  R3-2 needs `['gpt','deepseek','deepseek']` to make THREE legs). Collapsing duplicates is a
  **ledger-row** operation only.

---

## 1. What is actually broken (measured at `c1c3a5ee`)

### 1.1 The runStats join destroys data before anything can group it

`ledger.js:68-69` is `new Map(runStats.filter(joinsLedger).map(r => [r.model, r]))` — model-keyed,
last-wins.

| Bench | Today | Truth |
|---|---|---|
| twin, legs resolved **differently** | 2 rows, both the **last** executable. The other is **erased** — zero rows, invisible to `deriveReliability` and so to `pickFallbackChair`. | both served; both should be recorded |
| twin, one live + one dead | 2 rows, `resolvedModel` absent on both, both carrying the **dead** seat's `conformance` | the live leg's resolution and conformance should survive |
| twin, live `repaired` + dead `clean` | 2 rows, both `clean` | `repaired` should survive |

A silently wrong written value in an append-only file that is never migrated — the class the product
principle calls a bar failure.

### 1.2 The row count

`ledger.js:70` is `meta.models.map(...)`: row count is `meta.models.length` unconditionally. A twin
bench emits **two byte-identical rows** (measured end-to-end through the real `runCouncil` driver).

### 1.3 `runs` over-counts — and not only for twins

`runs: rows.length` (`ledger.js:137`). One council run on `--models a,a` reports `runs: 2`. So does
`--models gpt-5,openai/gpt-5` when both resolve to one executable. **Any bench where one executable
serves more than one seat inflates its own council-appearance count.**

Consumers: `lowN: rows.length < 3` (rendered at `cli-handlers-council.js:70`), and PR4a's **second**
sort term (`run-chair.js:70`).

### 1.4 Row count is also the denominator of `avg()` — PR4a's FIRST sort term

⚠️ **Revision 1 missed this entirely.** `avg()` (`ledger.js:107`) divides by row count, so duplicate
rows **double-weight** the average. Collapsing them moves `avgStreetCredPeersOnly` —
`pickFallbackChair`'s *first* sort term (`run-chair.js:69`) — plus `lifetimeConfirmRate`,
`lifetimeFactErrorRate`, and the `conformance` histogram. On the forcing bench the aggregate moves
`1.333 → 1.5` (HEAD averages `[1,2,1]` over three rows; PR4b averages `[2,1]` over two). Measured
chair flip with a competing aggregate at `1.4`: HEAD launches `gpt-5`, PR4b launches `kimi`.

### 1.5 Findings are alias-attributed and cannot be split

`ledger.js:71` is `findings.filter(f => f.raiser === model)` — alias-exact, so on a twin bench each
row claims **both** twins' findings. Left naive, the split makes it worse in kind: each executable
gets a fabricated `confirmRate` (measured `0.5`/`0.5` where truth is `1.0`/`0.0` and `0.0`/`1.0`).
R4b-2 is the answer.

`raiserSeat` is already on findings (PR3, `anonymize.js:60`); the missing half is `runStats[].seat`,
which is **PR4c** and is ~3 lines because `r.seat` already reaches `run-assemble.js:168` unread.

---

## 2. Emission order — what it can and cannot buy

The only behavioural consumer of ledger row order: `deriveReliability` builds `aliases[]` from
`lastSeen` (`ledger.js:133-135`), so **`aliases[0]` is the `model` of the LAST row of the group**,
and `pickFallbackChair` **launches** `top.aliases[0]` (`run-chair.js:74`). Second blast radius:
that name feeds `run-server.js:124-130` → `resolve(promoted,'cli')`, a path that **never fails
closed** (`run-server.js:69` logs and drops).

**THE RULE.** Emit one block per distinct alias, blocks ordered ascending by that alias's **LAST**
index in `meta.models`. Ties are impossible — `lastIndexOf` is unique per alias.

**What it buys, stated honestly (R4b-3):**

> ✅ On every bench where **no alias repeats AND no alias has more than one joinable runStats row**,
> `lastIndexOf(alias) === indexOf(alias)`, blocks come out in `meta.models` order, and PR4b's row
> set and order are byte-identical to HEAD. **That is the property worth having, and it is the
> reason to choose this spelling.**
>
> ⚠️ **The second clause is load-bearing and revision 2 omitted it** — which made the ✅ paragraph
> contradict this document's own §4.10. Measured counter-example on a bench with **no repeated
> alias**: `meta.models: ['a','b']` with runStats `[a/council→X, b/council→B, a/chair→Y wasChair]`
> gives HEAD **2** rows and PR4b **3**. Chair-on-bench and any multi-role alias fall outside the
> property; they route to §4.10/§4.11 and T14, never to T6.
>
> ❌ It does **not** preserve the launched fallback chair. On `--models a,b,a` with `a`'s seats
> resolving differently and `b` sharing `a`'s first executable, the launch flips `b → a` under
> *every* block-per-alias order that satisfies the rule; the only order that would preserve it is
> interleaved, which block-per-alias forbids. Do not add a fourth spelling to chase this — 587 of
> the 620 flips are caused by the join fix, not by order.

⚠️ **First-occurrence anchoring is what a naive `new Map(model + '\0' + resolvedModel)` produces
for free.** It is the default spelling and it is the wrong one: on the forcing bench
`--models gpt-5,openai/gpt-5,gpt-5` (all → `openai/gpt-5`) it promotes the executable-id-shaped name
over the short alias, which `run-chair.js:48-52` argues against at length.

⚠️ **Emission order has ZERO coverage in the repo.** Two lenses independently mutated it —
`meta.models.slice().reverse()`, and a full PR4b build with first-occurrence anchoring injected via
`moduleNameMapper` — and the **entire suite passed: 521 suites / 7246 tests** both times.
`tests/council/ledger.test.js:440-456` looks like the guard and is not: it writes rows directly via
its local `appendRows` helper, bypassing `buildLedgerRows`. PR4b must bring its own.

⚠️ **The fan-out GROWS a group's alias set, so `pickFallbackChair` exclusions grow too.**
`run-chair.js:54-55` excludes an aggregate if **any** alias is on the bench. Once `vendor/X`
legitimately carries alias `a` (because seat `a#1` really did resolve to it), a bench containing `a`
excludes that whole group. Measured: **4.7% of randomised single-run ledgers go from a promoted
chair to `null`** — the chain gives up, `overallVerdict` null, exit 2. This is the exclusion working
correctly on newly-accurate data (chair ∉ bench is the point of resolved-keyed grouping), but the
*outcome* is user-visible and goes in §4.

---

## 3. Design — `src/council/ledger.js` only

### 3.1 The join becomes a fan-out

Replace the last-wins `rs` Map with a two-level group: `alias → resolvedKey → row[]`, where
`resolvedKey = r.resolvedModel || ''`. Only `joinsLedger(r.role)` rows participate;
`LEDGER_JOIN_ROLES` (`ledger.js:49`) is untouched.

### 3.2 Enumeration and emission

1. **Distinct** aliases from `meta.models`, ordered ascending by `meta.models.lastIndexOf(alias)`.
2. For each alias, its pair groups in **first-observed runStats order**.
3. An alias with **no** joinable runStats row yields exactly **one** row with `r = {}` — measured to
   be today's behaviour across all three sub-shapes (no row at all; only a `judge` row; only a
   named-unknown role): `{role:'council', wasChair:false, conformance:'clean'}`, no `resolvedModel`.

⚠️ **`meta.models` MUST stay the row driver.** Two of the three `appendRun` call sites feed
hand-assembled input (`cli-handlers-council.js:39`, `mcp-server.js:1427`) where `runStats` may be
empty. Measured: `runStats: []` with three bench models emits **3 rows today and 0 under a
runStats-driven loop**.

⚠️ **`meta.models: ['a','a']` with `runStats: []` emits ONE row, not two.** Rule 1 dedups
unconditionally — the collapse must not depend on whether `runStats` happens to be populated.
Revision 1 contradicted itself here (rule 1 said 1, T7 said 2) and the shape is reachable on both
hand-assembled paths, where nothing validates `meta.models` for uniqueness. **T7's fixture must use
a repeated alias**; with distinct aliases both readings agree and the test is provably vacuous.

### 3.3 Scalar fields within a pair group holding more than one row (R4b-4)

| Field | Rule | Why |
|---|---|---|
| `conformance` | **worst-wins**, folded with `worseConformance`'s semantics, **seeded from the group's first row's `conformance || 'clean'`** | The codebase's blessed primitive for this merge (`run-assemble.js:31` rank, `:38-40` function). Recording `clean` for a seat that was `unstructured` is a written-wrong value. |
| `wasChair` | **any-wins** (`rows.some(r => !!r.wasChair)`) | A boolean fact has no last-wins reading. |
| `role` | **last row of the pair group wins** | Measured: **no role ordering exists anywhere in `src/`**. With no principled merge, stay closest to today. Lens twins (`lens:security` + `lens:performance` on one alias) are genuinely undecidable — document, do not invent a rank. |
| `resolvedModel` | the group's key, emit-when-set | unchanged shape |

⚠️ **Seed the conformance fold from the first row, not from `'clean'`.** `worseConformance` returns
its **first** argument on a rank tie (`>=`), and `CONFORMANCE_RANK[unknown] || 0` is `0`. A fold
seeded at `'clean'` converts an **unknown** conformance value to `'clean'` on a *single-row* group —
i.e. on a plain unique-alias bench, where HEAD emits it verbatim via `r.conformance || 'clean'`.
Measured: `conformance:"weird"` → HEAD `"weird"`, naive seed `"clean"`, correct seed `"weird"`.

⚠️ **`role` "last" means last of the pair group, which is not identical to today on a split alias.**
Today's last-wins is last-of-all-joinable-rows-for-the-alias; once the alias splits, that row may be
in a different group. Same for `wasChair`: a chair-on-bench alias resolving divergently now writes
`wasChair: false` on the seat row where HEAD wrote `true`. Both go in §4.

**`CONFORMANCE_RANK` is copied locally into `ledger.js`, not imported.** `ledger.js` requires only
`fs`, `path`, `../utils/config`; `run-assemble.js` pulls `verdict → report → findings → anonymize →
seats` plus `atomic-write`. Pay for the duplication with the T13 drift guard, written as **pairwise
agreement including an unknown value** — the seed defect above is only caught in that form.

### 3.4 The statistics anchor (R4b-2) — findings only

Within an alias's block, exactly **one** row is the *stats anchor* and carries
`findingsRaised`/`bySeverity`/`confirmRate`/`factErrorRate`. Every other row of that block carries
`findingsRaised: 0` and all-zero `bySeverity`; the null rates then **fall out of the existing
`judged && denom ? … : null` expressions with `denom === 0`** — verified, no new branch.

**The anchor is the block's FIRST pair group.** One rule, no exception.

> ⚠️ Revision 1 preferred "the first group carrying a `resolvedModel`" and called it load-bearing.
> **Both halves of that justification were refuted.** (a) A dead seat's row is not necessarily
> leg-less: `retryLegBySeat` (`run-stage1-rows.js:65-66`) surfaces the real still-dead retry leg and
> `run-assemble.js:71` emits `resolvedModel` whenever `leg.model` exists, so a timed-out seat's row
> **does** carry one — the preference cannot separate live from dead. (b) Dead-first ordering is
> unreachable engine-side anyway: `run-assemble.js:168` builds `runStats` from `reviews`, and
> `:175` pushes `extraRows` after. In every constructible case the two rules select the same group.
> A rule that buys nothing is a rule reviewers stop looking behind.

**Known limitation, disclosed:** on hand-assembled input with an unusual row order the anchor can
fall on a non-reviewing seat. Findings are alias-attributed until PR4c regardless, so this changes
which row carries an already-approximate number, not its correctness.

**Street cred does NOT concentrate** — see §0.

### 3.5 `runs` (R4b-1) — `deriveReliability`

```js
// A non-empty STRING runId is an identity; anything else counts individually.
const key = (typeof row.runId === 'string' && row.runId) ? row.runId : null;
```
`runs` = distinct non-null keys + one per null key. `lowN = runs < 3`.

⚠️ **Spell the predicate literally.** `runId: ''` is persistable — measured exit 0 three times
through the real `handleCouncil` tally path, written verbatim as `"runId":""`. Under `if (r.runId)`
three tallies read `runs: 3, lowN: false`; under `if ('runId' in r)` the same three read
`runs: 1, lowN: true`, permanently, in a file that is never migrated. Numeric `runId: 0` is the
mirror hazard. **No existing test distinguishes the spellings** — both produce the identical three
failures below — so T9 must pin it.

⚠️ **`runs` becomes caller-controllable on the two hand-assembled paths.** `meta.runId` is copied
verbatim from user JSON; `schemas/council-tally.schema.json:13-15` requires only a string, with no
uniqueness constraint anywhere. Consequences to disclose (§4): re-running `amicus council tally
input.json` **without** `--no-ledger` — which `docs/council.md:660-661` describes as a double-count
you avoid with that flag — now collapses to one `run` instead of two; and a harness writing a
constant runId pins `runs: 1, lowN: true` forever. Revision 1 called this "an unrealistic fixture"
and told reviewers not to flag it. **Both were wrong; the gag is struck.**

**Exactly three existing expectations move** — verified twice by whole-suite mutant (`Tests: 3
failed, 8 skipped, 7243 passed, 7254 total`), with no fourth anywhere in the tree. They do **not**
take the same fix:

| Test | Actual shape | Fix |
|---|---|---|
| `ledger.test.js:87-97` | `appendRun(record)` **twice**; `record = tally(avInput)`, so both rows carry `meta.runId: 'av-receiver-council'` (fixture line 34 — **not** `'r'`, which belongs to `debateBaseInput()` at `:16`) | give the second append a distinct runId; keep `toBe(2)` |
| `ledger.test.js:153-160` | **ONE** `appendRun` at `:155` plus a hand-built `{...gptRow, schemaVersion: LEDGER_SCHEMA_VERSION + 1}` appended raw at `:158`, inheriting the same runId. There is **no second append**. | stamp the literal at `:157` with `runId: 'r-future'`; keep `toBe(2)` |
| `ledger.test.js:376-389` | two **aliases** sharing `runId: 'r1'`, one executable | assert **`runs: 1`** — a genuine semantic correction. Do NOT add a second runId. |

> ⚠️ **The `:153-160` row is the trap, and revision 1 walked into it.** Its purpose is the
> version-blind legacy-read contract (`ledger.js:118`): prove a row stamped with an unknown
> `schemaVersion` still aggregates. Changing `toBe(2)` → `toBe(1)` there was **measured** to leave
> the test green **with lines 156-158 deleted entirely** — the future-schema row never written, the
> guard gone, nothing red. Row 3's "do not paper over it" instruction applies to row 3 **only**;
> row 2 needs the opposite.

---

## 4. Consequences to disclose, not discover (R4b-3)

**PR4b FIXES:**
1. Divergent twins: both executables recorded; neither erased.
2. Mixed live/dead twins: the live leg's `resolvedModel` and `conformance` survive.
3. `runs`/`lowN` become honest, for pre-PR4b rows too.
4. A run's `findingsRaised` finally sums correctly across its rows.

**PR4b CHANGES — every one goes in the CHANGELOG:**

5. **The ledger-promoted fallback chair can change** on any history where one executable served more
   than one seat. Measured **15.5%** of randomised benches. Causes, in order of size: the fan-out
   moving which group wins (537/620), emission order moving `aliases[0]` (83), the `runs` change
   (18). The old values were derived from erased and double-counted rows.
6. **The fallback chair can go from promoted to absent** (measured 4.7%), because the fan-out grows
   a group's alias set and `run-chair.js:54-55` excludes on **any** alias. Blast radius includes
   `run-server.js:124-130`, which never fails closed.
7. **`avgStreetCredPeersOnly`, `lifetimeConfirmRate`, `lifetimeFactErrorRate` and the `conformance`
   histogram move** wherever duplicate rows were double-weighting the mean (§1.4). This moves PR4a's
   **first** sort term.
8. `runs` drops and `lowN` moves for twins **and** alias-divergent benches; both render in
   `council stats`. `runs` is now caller-controllable on the two hand-assembled paths (§3.5).
9. Twin bench row count 2 → 1. **Contradicts a shipped in-tree comment** —
   `run-stage1-rows.js:26-27` calls two rows "the CORRECT outcome for two dead twins". It must move.
10. **Chair-on-bench, divergent resolutions:** 1 row → 2 on a unique-alias bench.
11. **Chair-on-bench, one shared resolution:** row count unchanged, but `conformance` moves from the
    chair row's value to worst-wins and `wasChair` from last-wins to any-wins (R4b-4). ⚠️ **This is
    the documented `amicus council tally` shape, not an engine-only edge** — the golden fixture
    (`models: JUDGES, chair: 'deepseek'`) and `docs/council.md:867-875`'s worked example both put
    the chair on the bench, `docs/council.md:575-581` prescribes one row per paid launch with both
    `council` and `chair` as primary roles, and neither hand-assembled call site has or can have a
    chair guard. Measured on that exact meta: `conformance` `clean → unstructured`.
12. `wasChair` no longer propagates across a **split** alias (§3.3).
13. A mixed live/dead twin now emits **an extra permanent line in `council stats`** — the
    executable-keyed group plus a `legacy` alias-keyed one, where HEAD showed one. The legacy line
    accrues `runs`, clears `low-N` at three runs, and carries **zero findings but a NUMERIC street
    cred** borrowed from its live twin (street cred is alias-keyed and did not concentrate — §0).
    ⚠️ Revision 2 wrote "null cred" here, contradicting §0's own measurement: that row's cred is
    numeric, and it *must* be, because keeping it numeric is exactly what makes dropping
    concentration preserve the launched name.

**PR4b does NOT fix:**
14. Findings remain alias-attributed (→ PR4c).
15. Street cred remains alias-level; twins stay collapsed at `assignLabels`. Unchanged by PR4b.
16. A never-ran aggregate is **not** excluded from chair candidacy, and can **win** it. Revision 1
    claimed street-cred concentration handled this; concentration was then dropped (§0) because it
    caused a worse regression. So the residual stands and is stronger than "not excluded": the
    leg-less group keeps its borrowed numeric cred and can outrank the executable it routes to.
    ⚠️ This is a **pre-existing** hazard in kind — the borrowed cred exists today too, merged into
    one group — but PR4b makes it a standalone promotable aggregate. File it with the measurement;
    the real fix is seat-attributed street cred, which is PR4c's territory, not a rule to invent here.

---

## 5. Tests

`tests/` is not size-gated and not linted. Grow `tests/council/ledger.test.js` (457 lines).

| # | Test | Guards |
|---|---|---|
| T1 | twin, same resolution → **1** row | §1.2 |
| T2 | twin, divergent resolutions → **2** rows, **both** executables present | §1.1 |
| T3 | mixed live/dead twin, engine-realistic order → live row keeps `resolvedModel` and `conformance` | §1.1 |
| T3b | same, with the leg-less row ordered **FIRST** → pins the anchor rule deliberately | §3.4 |
| T4 | two LIVE twins sharing one resolution, one `unstructured` + one `clean` → merged row reads `unstructured`. ⚠️ **not** two dead twins — `pushDeadSeatRows` passes no `conformance` and `buildRunStatsEntry` defaults it to `'clean'`, so two dead twins can never differ | §3.3 |
| T5a | forcing bench `[gpt-5, openai/gpt-5, gpt-5]` (all → `openai/gpt-5`), aggregate as **SOLE candidate** → assert the launched name is `gpt-5` **and** `aliases` equals `['gpt-5','openai/gpt-5']`. ⚠️ assert **non-null first**. **This is the only spelling that kills the `indexOf` mutant** | §2 |
| T5b | **same bench PLUS a competitor at cred `1.4`** → assert `avgStreetCredPeersOnly` is literally `1.5` and the launch flips to the competitor | §1.4 |
| T6 | unique-alias benches: **row count and order unchanged**; av-receiver still 3 rows; the three existing `toHaveLength(3)` pins stay. ⚠️ label this "row set unchanged", **not** byte-identity — §4.11 breaks byte-identity on a unique-alias bench | §2 |
| T7 | hand-assembled, `runStats: []`, **`meta.models: ['a','a']`** → **1** row | §3.2 |
| T8 | bench alias whose only runStats row has a non-joinable role → still gets its row | §3.2 |
| T9 | `runs` counts distinct runIds; one twin run → 1; **three rows with `runId: ''` → 3**; **`runId: 0` twice → 2**; rows with no runId count individually | R4b-1, §3.5 |
| T10 | `lowN` boundary on a twin bench across 1/2/3 council runs | R4b-1 |
| T11 | split alias: the non-anchor row reads `findingsRaised: 0` and **null** rates | R4b-2 |
| T12 | a split alias's non-anchor group **still carries its alias-keyed street cred** (concentration was dropped) and the launched chair is asserted explicitly on `['gpt-5','gpt-5','openai/gpt-5']` with one twin leg dead → **`gpt-5`**, not the executable id | §0, §2 |
| T13a | drift guard on the RANK COPY: local merge agrees with `run-assemble.js`'s exported `worseConformance` pairwise across `clean`/`repaired`/`unstructured` **and an unknown value**. Its mutant is *changing a rank value in the local copy* | §3.3 |
| T13b | seed pin, **through `buildLedgerRows`**: a SINGLE-row pair group with `conformance: 'weird'` emits `conformance: 'weird'`. ⚠️ T13a cannot catch the seed defect — the seed lives in `buildLedgerRows` and a function-to-function comparison never reaches it | §3.3 |
| T14 | chair-on-bench, one shared resolution, on the golden fixture's meta → row count unchanged, `conformance` worst-wins, `wasChair` any-wins | §4.11 |

**RED/GREEN discipline — MEASURE IT, DO NOT PREDICT IT.**

⚠️ **Revision 2 published a table classifying each test RED-or-GREEN-at-HEAD. Three of its six
"GREEN by construction" entries were measured wrong** (T5, T7 and T13 are all RED at HEAD), and the
table carried a "do not fix them" instruction that would have sent an implementer to weaken exactly
those three. **A test's status at HEAD is a measurement, not a deduction, and this plan is not
allowed to assert one.**

**The deliverable instead:** run the full test set against unmutated HEAD *before* touching
`src/`, and record the actual RED/GREEN status of every test in the PR description. Then:

- Every test that comes out **RED at HEAD** needs no further proof — HEAD is its mutant.
- Every test that comes out **GREEN at HEAD** must be proven by a **named mutant** that turns it
  red, and the mutant's literal output goes in the PR description. **A green-at-HEAD test with no
  mutant that kills it is not a test** — delete it or fix it, do not ship it.

Mutants to run regardless of classification, because each is a wrong implementation someone will
plausibly write:

| mutant | must kill |
|---|---|
| §3.2's `lastIndexOf` → `indexOf` | **T5a** — ⚠️ measured INERT against T5b: with a competitor at 1.4 present, reordering two rows cannot change their mean, so the launch stays on the competitor and the mutant passed the **entire suite** (522 suites / 7264 passed, exit 0). This is why T5 is split. |
| anchor → `pairGroups[pairGroups.length - 1]` | T3b |
| re-introduce street-cred concentration | T12 |
| seed the conformance fold at `'clean'` | **T13b** — ⚠️ measured INERT against T13a |
| change a rank value in the local `CONFORMANCE_RANK` | T13a |

---

## 6. Docs, schemas, BACKLOG

**No schema work.** No ledger-row schema exists (`docs/schemas.md:52-61` states the exclusion in
terms). `LEDGER_SCHEMA_VERSION` stays **2** — no new row *field*. `council-stats.schema.json`'s
`runs` has no description and its `aliases` description stays true: nothing to edit.

**Prose that becomes false, none of it test-pinned:**
- `docs/council.md:659-660` — "one row per `meta.models` entry".
- `docs/council.md:660-661` — the `--no-ledger` re-tally double-count sentence (§3.5).
- `docs/configuration.md:241` — "One row per council model per run".
- `ledger.js:61` JSDoc — "One model-level row per council model."
- **`run-chair.js:61-64`** — "⚠️ `runs` is TOTAL ledger rows (ledger.js:137)". Shipped by PR4a one
  commit ago; R4b-1 falsifies both the statement and its line citation. **Rewrite, do not delete** —
  it is the rationale for PR4a's second sort term.
- `run-stage1-rows.js:26-27` — the two-dead-twins comment (§4.9).
- `tests/council/debate.test.js:269` inline comment — "one per `meta.models` entry".

⚠️ Edit `docs/council.md` **in place**; `tests/docs-anchors.test.js:104` pins the top-level docs file
count at 16.

**BACKLOG:**
- `BACKLOG.md:1294` (GOA-7) — prerequisite half shipped in v4.7 but still an open checkbox, and its
  citation (`run-debate.js:135-137`) points at unrelated cost-ceiling prose. Tick, re-scope to
  recency-decay, fix the citation.
- `BACKLOG.md:1860` — both halves stale: the gate is `run-finish.js:51`, and `run.js` is **272**
  lines, not 295.
- **FILE NEW:** chair-on-bench. The guard exists at `cli-handlers-council-run.js:137`,
  `mcp-council-run.js:114` **and `src/pack/pack-validate.js:93`** — never in `src/council/`, and it
  **cannot** cover the two hand-assembled `appendRun` paths. Same gap class documented at
  **`seats.js:198-206`** (the `preflightSeats` gap list — **not** `:76-79`, which says the opposite).
- **FILE NEW:** findings seat attribution → PR4c.
- **FILE NEW:** §4.16 — a never-ran aggregate remains chair-promotable.

---

## 7. Constraints

- **MEASURE at branch HEAD; never quote a pass count as a gate.** Baseline measured for this branch:
  **521 suites / 7246 passed / 8 skipped / 7254 total, exit 0** (Windows; the 8 skips are
  POSIX-guarded). Assert **zero failures** and report totals.
- Size gate is `['src/**/*.js','electron/**/*.js']` only. `ledger.js` is **160/300**; a faithful
  implementation measured **212** lines with `npm run lint` exit 0.
- This worktree takes pre-commit's `--no-stash` branch, so `eslint --fix` may touch unstaged hunks.
  **Stage whole files.**
- `CLAUDE.md`'s AUTO:modules marker truncates at five exports; append any new export at the **end**.
  Pre-commit regenerates and auto-stages — expect the hunk.
- Never `npm test -- <path>`; use `npx jest <pattern>`. Never pipe a gate through `| tail`. Run
  `npm test` before `git push`.
- **Do not push without asking.** Open the PR with the `council-review` label.
- ⚠️ **One mutator at a time in this worktree.** Round 1 ran seven mutating lenses concurrently and
  they observed each other's in-flight edits to `src/council/ledger.js`. Any future parallel review
  must work from `git show HEAD:` copies in a scratch dir, never in place.

---

## 8. Standing instructions for every task review

1. **MUTATE, DON'T READ** anything the plan calls frozen. Worked example: emission order has zero
   coverage — two independent full-suite mutants passed 7246/7246.
2. **Re-derive every user-facing claim from the source where it is WRITTEN.** Never inherit a
   citation from this plan, a recon report, or a reviewer.
3. **A rule is not done until it is TOTAL.** For §3.2/§3.3/§3.4 enumerate: unique bench, twin same
   resolution, twin divergent, mixed live/dead, two dead twins, lens twins, chair-on-bench (both
   resolution cases), `claude`, an alias with no joinable row, non-joinable role only, hand-assembled
   with empty `runStats`, hand-assembled with a repeated alias, an alias appearing 3+ times, and
   runStats rows whose model is not in `meta.models`.
4. **A test that is GREEN at HEAD is not automatically vacuous, and a test made RED by editing its
   expectation is not automatically fixed.** §5 names which are which and gives the mutant for each
   preservation pin. The `:153-160` case is the worked example of the second failure.
5. **Assume every citation here may be wrong.** Six consecutive revs have had every substantive
   finding originate in the plan, never in an implementation.
