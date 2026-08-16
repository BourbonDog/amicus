# v4.8 PR4 — Ledger `(model, resolvedModel)` grouping + seat→alias projection

**Branch:** `v48-pr4-ledger-seat-projection` · **Merge base:** `e2882192` (PR #154, v4.8 PR3)
**Spec:** `docs/superpowers/specs/2026-08-10-v4.8-ask-anything-count-everyone-design.md` §4.6, §4.7
**Predecessors:** PR0 `1031079` · PR1 `7cd32f8` · PR2a `5c93ead` · PR2b `ad8c83c` · PR3 `e2882192`

> **Revision 3.** Built by a 12-area recon (215 anchors: 135 CONFIRMED, 43 STALE, **37 FALSE**),
> then rewritten against an 8-lens refutation of R1 (**74 findings: 20 CRITICAL**), then rewritten
> again against a 7-lens refutation of R2's *corrections* (**53 findings: 17 CRITICAL**).
> **Round 2 found Criticals inside round 1's own corrections — twice on the same two sub-designs.**
> Where this document and any other document disagree, **this one has been measured and the other
> has not**. Assume the citations here are still wrong.
>
> **Corrections that were themselves wrong, and are now on their third spelling — treat these as
> the highest-risk paragraphs in the document:** §3.3's emission anchor (alias-first → alias-last →
> **pair-anchored**) and §1.3's reachability evidence (Stage-1 orphan → Stage-2 orphan →
> **hand-assembled/MCP input only**).

---

## 0. Owner rulings

| # | Ruling |
|---|---|
| **R4-1** | Ledger groups by the `(model, resolvedModel)` pair. Twin bench 2 rows → 1. |
| **R4-2** | Seam = core + latent-join hardening. Renderers stay PR5. **AMENDED — see R4-6.** |
| **R4-3** | Street-cred seat-keying is OUT; the silent rank collapse must be made LOUD. |
| **R4-4** | `tally.js:96` uses the **guarded** form, not the BACKLOG's naive one-liner. |
| **R4-5** | The R8 `sameModelCorroboration` stamp is IN — **and must reach `verdict.json`**, else it is invisible on every human surface (refutation #7/#17). |
| **R4-6** | **Task 7 (cost bijection → `legId`) is CUT from PR4** and re-filed. Nothing in PR4 turns that suite red, it needs six edits not four, and `legId` is not collision-free. |
| **R4-7** | **Task 8 keeps H4 only.** H1–H3 were each measured to be wrong or harmful as specified; re-filed with the evidence attached. |
| **R4-8** | **`meta.seats` is emitted only when the bench repeats an alias.** Preserves the byte-identity promise that has held since PR1. |
| **R4-9** | **PR4 does NOT unblock the Workspace blind-name surface.** `assignLabels`/`labelMap` seat-ification is its own PR, **before** PR5's matrix work. |
| **R4-10** | **PR4 stays ONE PR.** Round 2's Critical count clustered in the ledger grouping; the owner ruled against a PR4a/PR4b split and for a **third refutation round targeted at that design**. |
| **R4-11** | **R4-4 re-confirmed on corrected evidence.** Keep the guarded form — it is the fail-closed choice, matching `LEDGER_JOIN_ROLES` and every other fail-closed decision here. **Drop the "UNSAFE" framing**; it overstates. |
| **R4-12** | **The rank collapse is announced on stderr, NOT through the degrade sink** — precedent `run-finish.js:54`. No exit code, no run status, no verdict shape changes. |

---

## 1. What is actually broken (measured)

### 1.1 The ledger corrupts a twin bench's content — the row count is the lesser half

On `--models deepseek,deepseek`, `buildLedgerRows` emits two **byte-identical** rows via three
independent last-wins collapses, none of which emits a degrade:

1. `ledger.js:71` `findings.filter(f => f.raiser === model)` is **alias-exact** — both rows claim
   both twins' findings, so two findings are written to an append-only file four times.
2. `ledger.js:68-69` — the runStats join is last-wins, so twin #2's `conformance`/`resolvedModel`
   silently overwrites twin #1's.
3. `ledger.js:64` — the streetCred join is last-wins over two entries `computeStreetCred` emitted
   under the same key.

`deriveReliability` then reports `runs: 2` for **one** council run.

### 1.2 `tally.js:96` drops a twin's legitimate peer vote — #137's tally half

PR3 shipped **additive** seat: `judge`/`raiser` stay alias-valued byte-for-byte (`tally.js:89`,
`:105-106`, both emit-when-different). So line 96 compares aliases. Measured on
`['deepseek','deepseek','gpt']`, finding raised by `deepseek#1`:

| scenario | HEAD | correct |
|---|---|---|
| self + twin + gpt all agree | `{a:1,d:0}` Confirmed/**thin** | `{a:2,d:0}` Confirmed/**solid** |
| only self + twin (gpt silent) | `{a:0,d:0}` **Singleton** | `{a:1,d:0}` **Confirmed** |
| self+twin agree, gpt dispute | `{a:0,d:1}` Contested/thin | `{a:1,d:1}` Contested/solid |

Row 2 is the #137 headline: a full-basis corroboration tiers `Singleton`.

### 1.3 The peer filter must be fail-closed on asymmetric seat data (R4-4, R4-11)

`BACKLOG.md:1988-1996` prescribes `(v.seat || v.judge) !== (f.raiserSeat || f.raiser)`. It assumes
seat presence is **symmetric** between a finding and its votes. It is not — the two bindings are
independent — and when they disagree the naive form **counts the raiser's own vote as a peer**
(`'deepseek'` vote vs `'deepseek#1'` raiser → true). Measured: `{a:0,d:1}` Contested → `{a:2,d:1}`
**Confirmed**, a self-corroboration tier flip.

> **⚠️ THIRD SPELLING. Both earlier reachability claims were measured FALSE — do not restore either.**
> - **R1 said** an unbound *Stage-1* review (`run-launch.js:206` → `run.js:194`). **False:**
>   `run-stage2.js:92-97` pads that review's Stage-2 slot with a *placeholder* seat and `:105-107`
>   filters placeholders out of `judgeSeatOf`, so `:141` gives that judge `seat = null` too. The
>   nulls are **structurally correlated**.
> - **R2 said** an orphaned *Stage-2* leg, citing `run.js:219-223`. **Also false:** that is an
>   in-source *comment*, not a measurement. `leg-ids.js:16` stamps every leg's `taskId` and
>   `fanout-leg.js` writes it on both the normal (`:191`) and routing-failure (`:61`) paths, so a
>   real `-s2` wave cannot produce an unbindable leg — exactly as unreachable as the `-rv` case.
>
> **The reachable producer is EXTERNALLY-ASSEMBLED tally input** — the `amicus_council_tally` MCP
> path and the skill's hand-assembled input (`tally.js:79-83`: *"Claude assembles `input`"*).
> Task 5 **widens that door itself** by adding `findings[].raiserSeat` and `adjudications[].seat`
> to the zod, and nothing requires a caller to supply them consistently.

**Honest statement of the trade (R4-11 — the "UNSAFE" framing of R1/R2 is withdrawn):** on every
**engine-reachable** shape the two forms are byte-equivalent. They differ only on hand-assembled /
MCP input. There, the guard **excludes when seat presence is ambiguous** and the naive form
**includes**. The guard is chosen because ambiguity here is genuinely undecidable — a seat-less
`deepseek` vote is indistinguishable from the raiser's own — and this codebase resolves undecidable
identity fail-closed everywhere else (`LEDGER_JOIN_ROLES`, `bindSeats`' single-candidate rule,
`preflightSeats`). A lens argued the naive form is correct on the one asymmetric shape the repo
fixtures; in that fixture the ambiguity happens to resolve favourably, which is luck, not a
contract.

**Guarded form (R4-4):**
```js
const peers = f.raiser
  ? votes.filter(v => (v.seat && f.raiserSeat) ? v.seat !== f.raiserSeat : v.judge !== f.raiser)
  : votes;
```
On any unique-alias bench both operands are absent, so the `else` branch **is line 96 as it ships
today** — byte-identical.

**What the guard does NOT fix — BOTH shapes, stated; R2 caught R1 naming only one.**

1. **The raiser's own Stage-1 leg orphans.** `raiserSeat` and that seat's vote-seat vanish
   *together*, the guard falls back to the alias compare, and the twin's legitimate vote is still
   dropped. #137's undercount survives.
2. **A peer twin's leg orphans** (the *other* half — R2 CRITICAL 17). The guard's `else` branch
   drops that twin's legitimate agree, **and the R8 stamp does not fire either**, so the
   corroboration is silently absent rather than merely unlabelled.

Shape 2 is a **deliberate safe-drop**, not an oversight: a seat-less `deepseek` vote cannot be
distinguished from the raiser's own. Both shapes go in the CHANGELOG. Closing either needs seat
identity on the orphan paths — not PR4.

---

## 2. Spec claims that are FALSE or STALE (do not implement from §4.7 directly)

| Spec claim | Verdict | Measured |
|---|---|---|
| §4.7 "join runStats by `r.seat \|\| r.model`" | **FALSE** | No producer emits `seat`, **and** `tally.js:115-134` is an explicit allowlist that would strip one. `ledger.js` consumes tally's *output* (all 3 `appendRun` callers pass `tally(input)`). |
| §4.7 "group the run's seats by `(alias, resolvedModel \|\| alias)`" | **FALSE** | `record` carries no seats. `buildTallyInput` has no `seats` param; `o.seats` (`run.js:133`) is only checkpointed. |
| §4.7 "`sc` becomes seat-keyed" | **FALSE / ruled out** | `streetCred[].model` is literally `meta.models[i]`. `rankPositions` (`tally.js:38`) already collapsed the twins, so averaging "the group's seats" averages N copies of one value. **R4-3.** |
| §4.7 "role worst-wins, `critic` above `seat`" | **FALSE** | No role rank exists in `src/`. And it is unreachable: `preflightSeats` (`seats.js:252-255`) **rejects** a `--critic` alias occupying more than one seat, so `critic` and `seat` can never co-occur in one group. See §3.3. |
| §4.7 "`buildLedgerRows` changes; nothing else in the file does" | **STALE** | Range `62-89` exact; the claim is false (module-scope additions required). |
| §4.9 "row count for `gpt-5,openai/gpt-5`: two rows → one" | **FALSE** | Two **distinct pairs**; they correctly stay two, which is what preserves `aliases[]`. The bench that collapses is the **twin**. |
| §4.9 "golden fixtures pinning row counts re-baseline" | **FALSE** | There is **no duplicate-alias fixture anywhere** in the ledger tests; the 3 count pins stay at 3. Every duplicate-bench case is a **new** test. |
| §4.8 "Key the bijection on `legId`. The row carries it." | **FALSE on both halves** | No `legId` on the row; ground truth reads `leg.modelInput \|\| leg.model` (`run-cost-bijection.test.js:128`). **R4-6 cuts this from PR4.** |
| §4.6 "the peer filter becomes seat-exact — `v.judge !== f.raiser` compares seat ids" | **FALSE since PR3** | PR3 kept both alias-valued (additive ruling). This is why §1.3's guard is needed at all. |
| §4.6 "`meta.seats` is **REQUIRED** on the tally input" | **FALSE for PR4's purposes** | Verified by probe: `sameModelCorroboration` is computable from `v.judge === f.raiser` alone, because `judge` **is** the alias. **Task 5 does not depend on Task 3.** |
| §4.7 `run-chair.js:63` | **STALE** | It is `run-chair.js:61`. The file is unchanged since the spec's own base ⇒ the miscite was **wrong when written**. Treat §4.7/§4.8 line numbers as authored-by-guess. |
| §7.4.2 `meta.seats` as `{id, model}` | **FALSE shape** | `buildSeats` emits `{id, alias, role, lens, position}` (`seats.js:66-69`). There is no `model` key. |

---

## 3. Design

### 3.1 `seat` on runStats — exactly two producers

`joinsLedger` (`ledger.js:50-53`) **admits** `{seat, critic, chair, claude, council, redteam}` +
`lens:*` + null/undefined. It **excludes** `judge`, `chair-attempt`, `repair`, `superseded`,
`rebuttal`, `revote` and any named-unknown role.

> ⚠️ **Revision-2 correction.** R1's table said chair/claude were excluded. They are **admitted**
> (`ledger.js:49`). They still need no `seat` — but for a different reason: they are **off-bench
> or leg-less**, so no seat exists to stamp. Do not restate the false version.

| Producer | Role | Needs `seat`? | Why |
|---|---|---|---|
| `run-assemble.js:168-171` primary review rows | `seat`/`critic`/`lens:*` | **YES** | on-bench, seat in scope (`r.seat`) |
| `run-stage1-rows.js:98-99` dead-seat rows | the seat's own role | **YES** | on-bench, loop destructures `{seat, alias}` |
| chair / chair-attempt / `claude` | admitted, but off-bench or leg-less | no | no seat exists |
| judge / repair / superseded / rebuttal / revote | excluded by `joinsLedger` | no | can never win the join |

**Emit-when-DIFFERENT** (`seat.id !== alias`), matching PR3's precedent ⇒ absent on every
unique-alias bench ⇒ **every run that has ever shipped stays byte-identical.**

- ⚠️ `tests/council/tally.test.js:174-181` pins the **exact key array** of a minimal row. The spread
  must sit between `conformance` and `status`, the same slot as `waveId`/`resolvedModel`.
- ⚠️ `buildRunStatsEntry` destructures a **fixed param list** — an extra `seat` argument is
  silently dropped. The signature must actually change.
- `tests/council/run-debate.test.js:844` (`expect('seat' in r).toBe(false)`) filters to **debate
  roles only**, which this design does not touch. It stays GREEN. Task 2 must **confirm by running
  it**, not assume.

### 3.2 `meta.seats` — emit only when the bench repeats an alias (R4-8)

> ⚠️ **Revision-2 correction.** R1 claimed `tests/council/run-assemble.test.js:42-48`'s `toEqual`
> would catch an unconditional emit. **False** — Jest's `toEqual` recursively **ignores keys whose
> value is `undefined`**, so the natural spelling `seats,` sails past it. That pin is not a guard.
> Task 3 must add its own RED test using `expect('seats' in input.meta).toBe(false)`.
> **Rule for this PR: never use `toEqual` to guard an emit-when-X discipline; use `in`.**

- `buildTallyInput` gains a `seats` param and emits it **only when
  `seats.some(s => s.id !== s.alias)`** — i.e. only when the bench actually repeats an alias.
  `run.js:133` sets `o.seats` on *every* run, so an `...(seats ? …)` guard would be **vacuous** and
  would change three artifacts for every bench ever shipped.
- ⚠️ **The fallback is IDS ONLY, and must be derived from the BENCH — R2 refuted R1's blanket
  "the fallback is correct".** Absent `meta.seats`, a consumer may reconstruct seat **ids** (on a
  unique bench the id *is* the alias) but **`role`, `lens` and `position` are not recoverable at
  all** — they appear nowhere in `meta.models`. And the list must come from the bench, never from
  the verdict's `council` / `meta.models`, which carries the off-bench `claude`
  (`run-assemble.js:177`): deriving from it mints a seat id `claude` that `buildSeats` never mints
  and `seats.js:44-46` documents as deliberately absent. That would be the very positional join
  the next bullet forbids.
- ⚠️ **Absence does NOT imply a unique-alias bench.** Two of the three `appendRun` call sites feed
  hand-assembled input no seat machinery touches (`cli-handlers-council.js:39`,
  `mcp-server.js:1427`), and nothing constrains `meta.models` to be unique there. Consumers must
  treat absent `meta.seats` as "no seat table available", not as "the bench was unique."
- `run.js:237`'s `mkInput` passes `o.seats`.
- ⚠️ **`verdict.js:103-111` is an explicit, RENAMING meta projection** (`meta.models` → `council`).
  `meta.seats` does **not** reach `verdict.json` for free. **The verdict key is `seats`** (matching
  the existing `seatLoss` sibling). Pin the name — PR5 codes against it.
- ⚠️ **Claude asymmetry.** `run-assemble.js:177` pushes `CLAUDE_SEAT` onto `meta.models` while
  `seats[]` is bench-only (`seats.js:45-46`). **No consumer may join `meta.seats` to `meta.models`
  positionally.** The same warning applies to `streetCred[]`, which is built from `meta.models`.

### 3.3 `buildLedgerRows` — the grouping

**Enumeration.** Iterate `meta.models` for the outer alias order; for each alias, fan out over its
joinable runStats rows by `resolvedModel`. An alias with no joining runStats row yields one group
with `r = {}` — today's behaviour.

**Emission order — PAIR-ANCHORED: emit each `(alias, resolvedModel)` group at the LAST
`meta.models` position among the SEATS that contributed to THAT group.** A group whose rows carry
no seat (leg-less rows, `claude`, an alias with no joining runStats row) falls back to the alias's
own `meta.models` index.

> ⚠️ **THIRD SPELLING — this rule has now been wrong twice. Highest-risk paragraph in the plan.**
> `pickFallbackChair` **launches** `aliases[0]` (`run-chair.js:61`), and `deriveReliability` orders
> `aliases` by **last** ledger-file position (`ledger.js:133-135`, descending). So emission order
> decides which model a future council **pays for**, permanently, in an append-only file.
>
> - **R1 said first-occurrence.** Flips on an all-live `A,B,A`.
> - **R2 said last-occurrence.** Also wrong: it anchors on the **alias**, but the key is the
>   **pair**. When one alias fans into two groups — which §3.3's own consequence bullet says PR4
>   *creates* — every sub-group inherits the alias's single last position. Probe on `a,b,a` with a
>   **dead** second `a`: HEAD launches `b`, alias-last launches **`a`** (flip), alias-first and
>   pair-anchored both launch `b`. Two more reachable shapes flip identically under alias-last: a
>   `--fallback` substitution on the retried twin, and its SL-2 healed variant.
> - **Neither alias-anchored rule is right everywhere** — each is correct on the bench the other
>   fails. Only the pair anchor is shape-independent.
>
> **Both earlier pins would have passed while the hazard fired.** Task 6's pin must therefore:
> - assert `deriveReliability(...).aliases[0]` is **unchanged from HEAD** on **three** benches:
>   all-live `a,b,a`, `a,b,a` with a dead twin, and `a,b,a` with a divergent-resolution twin;
> - call `pickFallbackChair(deriveReliability({dir}), <a LATER run's bench sharing NO alias with the
>   ledgered group>, <that run's failed chair>)` — ⚠️ `run-chair.js:54-55` excludes any aggregate
>   whose key or aliases appear in the bench, so **passing the recording run's own bench returns
>   `null` and the assertion is vacuous**. Assert non-null *before* asserting the value.
>
> ⚠️ **Delete R2's runStats-order justification — it was false.** `ledger.js:70` already iterates
> `meta.models`, so "iterate `meta.models` for the outer order" is the status quo, not a change,
> and emission order is insensitive to runStats order. A healed fixture that only reorders runStats
> pins nothing. The fixture that *does* discriminate is a heal landing on a **different
> `resolvedModel`**.

**Per-group aggregation:**

| Field | Rule |
|---|---|
| `model` | the group's alias. **Stays alias-valued** — `pickFallbackChair` launches it. |
| `findingsRaised`, `bySeverity` | **union**, routed by the matcher below |
| `confirmRate`, `factErrorRate` | over that union |
| `conformance` | worst-wins (local rank + drift guard, below) |
| `role` | **total rule**, below |
| `wasChair` | **any-wins** (`rows.some(r => !!r.wasChair)`). Pin against the av-receiver fixture — the only shipped case where a bench alias carries `wasChair:true`. |
| `streetCred*` | today's alias-keyed lookup, unchanged (R4-3) |
| `resolvedModel` | the group's, emit-when-set |

**The `role` rule must be TOTAL — R2 found four separate groups it left undefined.** No
`ROLE_RANK`; instead, in order:

1. the role of the group's lowest-`position` **seat**, when the group owns at least one seat;
2. else the **first joining runStats row's** `r.role`;
3. else `'council'` — i.e. today's `r.role || 'council'` is the **tail of the rule**, not a
   fail-open to be refused.

**Pin all three branches.** Each is reachable and none was covered by R2's spelling:
- ⚠️ **`preflightSeats` load-bears nothing here.** It has ONE production caller (`run.js:131`),
  while **two of the three `appendRun` call sites** — `cli-handlers-council.js:39`
  (`amicus council tally <input.json>`, bare `JSON.parse`) and `mcp-server.js:1427` — feed
  hand-assembled input no preflight ever sees. `ledger.js:41-44` names that a supported shape. On
  those paths `critic`+`seat`, roleless+`seat` and `chair`+`seat` are all reachable **with no seats
  table at all**. Justify against the ungated paths, not against `preflightSeats`.
- ⚠️ **The `claude` group owns no seat, ever.** `run-assemble.js:177` pushes `CLAUDE_SEAT` onto
  `meta.models` while `seats[]` is bench-only (`seats.js:44-46`). Branch 1 is undefined there on
  **every** `--claude-review` run. Add a pin that the claude row still reads `role: 'claude'`.
- ⚠️ On a **unique-alias** bench both `meta.seats` (R4-8) and `runStats[].seat` (§3.1,
  emit-when-different) are **absent**, so branch 1 is undefined on every run that has ever shipped.
  Branch 2 is what preserves byte-identity.

**The findings-union matcher — also made total (R2 CRITICAL 2, IMPORTANT 4).** `raiserSeat` is
emit-when-DIFFERENT (`anonymize.js:60`), so it is absent for every unique-alias seat, for `claude`,
and for a twin whose Stage-1 leg orphaned.

- a finding **with** `raiserSeat` joins the group that owns that seat id (via Task 2's
  `runStats[].seat`). ⚠️ **If no group owns it, fall back to the alias rule below — NEVER drop.**
  Task 5 makes an unmatched `raiserSeat` reachable by adding the field to the MCP zod while nothing
  requires a matching `runStats[].seat`; dropping would delete the finding from `findingsRaised`,
  `bySeverity` and `confirmRate`, which is strictly worse than today's double-count.
- a finding **without** `raiserSeat` joins **exactly one** group of that alias — never all of them
  (defect 1.1). ⚠️ **Restrict the candidates to groups containing a row that actually produced a
  review** (a row with `resolvedModel`, i.e. built from a real leg). R2's measured counter-example:
  on a twin whose Stage-1 leg orphaned, the *lowest-position* group is the still-dead twin's — a
  seat that produced nothing — because a dead-seat row (`run-stage1-rows.js:98-99`, `leg: null`)
  carries a seat stamp and no `resolvedModel`, while the orphan's review row carries a
  `resolvedModel` and **no** seat stamp. The naive rule credits the orphan's findings, and its
  `confirmRate`, to a row for a seat that never reviewed.
- ⚠️ **When no seat table exists at all** (hand-assembled/MCP input with a repeated alias — nothing
  constrains `meta.models` to be unique: `mcp-tools.js:395` is `z.array(z.string()).min(1)`), keep
  today's single-group behaviour for that alias rather than splitting it. Pin it with a
  hand-assembled record, not an engine-shaped one.

**`worseConformance` must NOT be imported.** `ledger.js` requires only `fs`/`path`/`../utils/config`;
`run-assemble.js` pulls `verdict`→`report`→`findings`→`anonymize`→`seats`. Define
`CONFORMANCE_RANK` locally **plus a drift-guard test** asserting agreement with
`run-assemble.js:31` for all three values. Duplication that is *pinned* beats a dependency that is
*heavy*. ⚠️ The sibling's `|| 0` is **fail-open**; the local copy must be checked against every
value PR4 can feed it.

**Two consequences to state, not gloss:**

- **PR4 CREATES a `legacy:true` split** (R1 wrongly called this pre-existing). Today a dead-seat
  `extraRow` carrying no `resolvedModel` is appended after the primary rows
  (`run-assemble.js:175`) and **wins** the last-wins join for *both* emitted rows, so both come out
  resolvedModel-less and land in one group. Under the pair key the surviving seat keeps its
  `resolvedModel` and the dead one does not, so they split into two `deriveReliability` groups —
  one marked `legacy: true`. **Three** consequences, all of which must be disclosed (R2 found R1
  named only two): `pickFallbackChair` **candidacy**, the **lifetime average**, and — under an
  alias-anchored emission order — **`aliases[0]`, the launched name** itself. The pair anchor above
  makes the third one "unchanged"; that is precisely why it is the anchor.
- ⚠️ **The same shape splits ONE alias into TWO ledger ROWS on a UNIQUE-alias bench.** An orphaned
  Stage-1 leg still materializes a review with a real `resolvedModel` while its unbound seat
  produces a leg-less dead-seat row with none. So §2's "the 3 count pins stay at 3" is about
  *existing fixtures*, and must not be read as "a unique bench can never change row count." Decide
  it in Task 6 — collapse a leg-less group into that alias's reviewed group, or accept the extra
  row — and add the unique-bench orphan+dead-seat test either way.
- **Task 5 moves `confirmRate`.** `ledger.js:83` computes it from `tier === 'Confirmed'`, and Task
  5 changes which twin-bench findings are Confirmed. The ledger is where that becomes permanent.
  **Task 6 therefore depends on Task 5.**

### 3.4 The R8 stamp (R4-5)

**Predicate — same *alias*, stated honestly:**
```js
sameModelCorroboration = peers.some(v => VERDICTS[v.verdict] === 'a' && v.judge === f.raiser)
```
**Emit-when-TRUE only.** Always-emitting `false` would change the shape of every finding of every
run ever shipped.

⚠️ **Named limit — this must appear in the plan, the CHANGELOG and the schema description.**
`--models gpt-5,openai/gpt-5` is genuinely **one model under two aliases**, and the stamp does
**not** fire there, because votes carry no `resolvedModel`. So PR4's tally labels same-**alias**
corroboration while PR4's ledger treats `(alias, resolvedModel)` as identity. **The two documents
use different notions of "same model" and the plan says so rather than pretending otherwise.**

**It must reach `verdict.json`** (refutation #7/#17): `verdict.js:113-127` rebuilds findings from
an explicit field list, so a tally-only stamp is invisible on every human surface — `report.js`
and `report-html.js` both build from the **verdict**. Fold the projection into Task 4 alongside
`raiserSeat`. Rendering and the chair packet are **PR5**; R4-5's benefit is "the data exists and
survives to the summary document", not "it is displayed".

### 3.5 Latent-join hardening — H4 only (R4-7)

H1–H3 are **re-filed, not implemented**, each with its refutation evidence:

- **H1** (`run.js:227` conditional) — turns `tests/council/run-degrade.test.js:139-190` RED. It
  deletes a merge PR3 deliberately added, so an orphaned judge's `unstructured` conformance is
  dropped and `ledger.js:85`'s `r.conformance || 'clean'` writes a **false `clean`** into the
  append-only ledger. A second lens also refuted R1's "affirmative wrong guess" framing: on the
  only single-orphan shape anything constructs, the fallback lands on the **correct** seat by
  elimination.
- **H2** (`-rv` unbound join) — R1 cited the wrong tripwire (`debate.test.js:155-164` is a pure
  `applyDebate` test, untouched by an emitter change; the real pin is
  `run-debate.test.js:934-948`), and the emitter **cannot** discriminate: the deciding fact lives
  in `tallyInput.adjudications`, which `runRevoteWave` never receives.
- **H3** (`aliasOf` required) — turns shipped tests red; R1 gave Task 8 no test-update step.

**H4 — the only item that survives.** ⚠️ R1's "nothing enforces it" is **false**: `parseModelsList`
has a named unit pin and the twin launcher arguments are pinned end-to-end in `run-debate.test.js`.
The gap is the **middle** of the chain. Add **one** pin that `validateFanoutModels('a,a')` yields
two legs. Do not re-add a test that already exists.

### 3.6 Making the collapse LOUD (R4-3)

The rank collapse is completely silent — the "correct-but-SILENT degrade" the product principle
calls a bar failure.

> ⚠️ **THIRD SPELLING. R1 and R2 were both unimplementable; R2's was broken three ways.**
> - **`errors` is a DEAD channel, not a suppressed one.** `rankingToOrder` returns `errors: []` on a
>   twin bench because nothing ever *detects* the collapse — so "consume `errors`" ships a change
>   that **can never fire**, and the suite passes. R2 never said the collapse has to be *detected*
>   first; that missing sentence was the entire mechanism.
> - **Do not overload `errors`.** Its only consumer contract is a `string[]` of `unknown label '…'`,
>   pinned at `anonymize.test.js:89-90`.
> - **Do not use the degrade sink (R4-12).** `makeDegrade` validates `channel` against a frozen
>   allowlist and `run-degrade.js:22-32` **swallows the throw**, substituting an `internal` note
>   whose text says the detail is lost — loud and content-free. And a degrade would flip **every
>   healthy twin-bench run** from exit 0 to exit 2 with `status:'partial'`, adding a `degrades[]`
>   array to a verdict documented as byte-identical on a clean run — trading away byte-identity on
>   the exact bench shape v4.8 exists to support, for a limitation PR4 does not fix.

**What Task 8 actually does:** detect the collapse — `new Set(Object.values(labelMap)).size <
Object.keys(labelMap).length` — and emit a **plain stderr notice** (R4-12), following the precedent
at `run-finish.js:54`. No exit code, no run status, no verdict shape, no new degrade channel.
`.eslintrc.js:16` bans `console` in `src/council/*`; `process.stderr.write` is what the precedent
uses. This does **not** fix street cred, and the CHANGELOG must not imply it does.

### 3.7 `seats.js` — take the win, refuse the hazard

- **TAKE:** `seatKey` — `run-retry.js:149` and `run.js:224` are byte-identical;
  `run-debate-revote.js:64` is equivalent. ⚠️ **Leave `run.js:227` alone.** Its
  `|| byJudge.get(r.model)` fallback is load-bearing (`run.js:219-223`) and H1 is dropped (R4-7),
  so nothing in PR4 touches it.
- **TAKE:** an `aliasOf(seats, key)` projection + the `o.seats || buildSeats(...)` re-derivation,
  retiring the duplicate at `run-debate.js:125-129` / `run-stage1-launch.js:20-22`.
- **REFUSE:** the roster-padding consolidation — a **near-copy, not a win**. The head differs in
  all three ways that matter, and it is the safety-critical "never guess" block. ⚠️ Do not sweep in
  `stage1-bind.js:29`, a fourth `bindSeats` caller that deliberately does not pad.
- **Size:** `seats.js` **261/300** — not "roomy". Two helpers plus docblocks (this file averages
  ~2.5 comment lines per code line) will consume most of it. If more is needed, extract into
  `stage1-bind.js` (86 lines).

---

## 4. Constraints

- **Baseline: MEASURE at branch HEAD, never quote.** Recon measured `521 suites / 7241 passed / 8
  skipped / 0 failed`. ⚠️ **A WINDOWS number** — all 8 skips are POSIX-guarded and run on Linux CI.
  **No plan step may assert a literal pass count as a CI gate.**
- ⚠️ **`.test-passed` was warmed to `e2882192`** by recon's `npm test`. Gitignored, but the pre-push
  cache is warm where it was cold. Do not mistake a skipped pre-push run for a passing one.
- ⚠️ **`tests/` is NOT size-gated.** R1 claimed it was; four lenses refuted it. The gate's include
  list is `['src/**/*.js','electron/**/*.js']` only. **Grow existing test files; do not split them
  or invent new ones to dodge a gate that does not exist.**
- **Size gate (300) — every file PR4 touches, measured:**
  `ledger.js` 160 · `tally.js` 139 · `anonymize.js` 83 · `verdict.js` 212 · `run-stage2.js` 209 ·
  `debate.js` 224 · `seats.js` **261** · `run-assemble.js` **265** · `run.js` **272**.
  ⚠️ `run-stages.js` **292** and `run-retry.js` **290** — extract, never squeeze.
  `pack-resolve.js` / `electron-install.js` sit at **300/300**; a stray line in either fails CI.
- Lint bans `console` in `src/council/*` (`.eslintrc.js:16`, no override).
- Never `npm test -- <path>`; use `npx jest <pattern>`. Never pipe gates through `| tail`.

---

## 5. Tasks

| # | Task | Depends on |
|---|---|---|
| 1 | `seats.js`: `aliasOf` + `seatKey` consolidation (no behaviour change) | — |
| 2 | `seat` on the two ledger-joinable runStats producers + `tally.js` allowlist | 1 |
| 3 | `meta.seats` (emit-when-bench-repeats) on tally input **and** `verdict.seats` | 1 |
| 4 | `verdict.json`: `findings[].raiserSeat` **and** `sameModelCorroboration` | 5 |
| 5 | `tally.js:96` guarded + `debate.js:200` guarded + R8 stamp + **`mcp-tools.js` zod** | — |
| 6 | `buildLedgerRows` `(model, resolvedModel)` grouping | 2, 3, **5** |
| 7 | H4 pin only | — |
| 8 | Make the rank collapse loud (**both** sites) | — |
| 9 | Docs, schemas, CHANGELOG, BACKLOG corrections | all |

**Task 5 must be ONE commit** — `debate.js:186-190` forbids splitting. Both expressions written out
in full so neither can be mis-copied:

```js
// tally.js:96
const peers = f.raiser
  ? votes.filter(v => (v.seat && f.raiserSeat) ? v.seat !== f.raiserSeat : v.judge !== f.raiser)
  : votes;

// debate.js:200
const peerVerdicts = (f.adjudications || [])
  .filter(a => (a.seat && f.raiserSeat) ? a.seat !== f.raiserSeat : a.judge !== f.raiser)
  .map(a => a.verdict);
```
> ⚠️ **R1 printed the naive form here.** R2 then caught that **R2's own replacement dropped the
> trailing `.map(a => a.verdict)`** — found independently by two lenses. Without the tail,
> `peerVerdicts` becomes adjudication **objects** instead of verdict strings, and its sole consumer
> `verdictCounts` (`briefings-debate.js:56-59`) does `c[v]` with `v` an object, so every debated
> finding's defense brief would read *"Peer verdicts (anonymized): 0 dispute, 0 agree, 0 neutral"* —
> a paid brief telling the model nobody disputed it. **The `else` branch changes too, so this fires
> on EVERY bench**, including every unique-alias run ever shipped, destroying the byte-identity
> argument. In a block whose whole purpose is verbatim copying, this was the mis-copy it exists to
> prevent.
>
> **Both expressions above preserve their trailing transforms. Verify that before copying.**
> `tests/council/run-debate.test.js:252-255` is the only end-to-end pin on that output shape — add
> it to Task 5's must-stay-green list. **A lens applied the naive form to both sites and the ENTIRE
> suite stayed green**, so Task 5 must add a RED test for the asymmetric case at **both** sites.

**Task 5 also owns `src/mcp-tools.js` — this is a silent-degrade guard, not documentation.**
`amicus_council_tally`'s zod strips unknown keys and `mcp-server.js:1421-1423` hands the **parsed**
input to `tally()`. Today `findings[].raiserSeat` and `adjudications[].seat` are **stripped**, so
the guarded filter could never take the seat branch on the MCP path and #137's undercount would
survive there silently while the PR claims it fixed.

⚠️ **Spell the declarations out — the only shape written down anywhere else is the one §2 proves
FALSE.** Spec:373 says `z.object({ id: z.string(), model: z.string() })`, but `buildSeats` emits no
`model`, and zod strips unknown keys at *every* level — copying the spec's spelling would either
reject every real seat table or silently strip `alias`/`role`/`lens`/`position`, reproducing on the
MCP path the exact silent-strip class this task exists to close:

```js
seats: z.array(z.object({
  id: z.string(), alias: z.string(), role: z.string(),
  lens: z.string().nullable().optional(), position: z.number().optional(),
})).optional(),                    // meta
raiserSeat: z.string().optional(), // findings[]
seat: z.string().optional(),       // adjudications[]
```

**Task 4 emission rule** — `...(f.raiserSeat ? { raiserSeat: f.raiserSeat } : {})`, **not** the
`x || null` idiom the three sibling fields in that literal use. Tripwire to keep green:
`tests/council/seat-parity-ondisk.test.js`.

**Task 9 corrections** (each re-derived at `e2882192`):
- **`CHANGELOG.md` `[Unreleased]`** — PR3's own paragraph is falsified by Tasks 3/4 and both land in
  the same section: drop "gains **only** … has no `raiserSeat` slot", and the "none of these
  documents changes shape at all there" sentence now has a shape-level exception.
- `BACKLOG.md:1933-1939` — the run-stage2 roster item's consequence clause became **false at PR3**;
  its `:57` is now `:62`. Spec §4.5 ruled the roster *"stays alias — a launch argument."*
  **Nothing to fix in `run-stage2.js`.**
- `BACKLOG.md:2056` — `matrix-model.js` "on nobody's deferral list" is **false**; it is on spec:557.
- Stale in-source citations: `run-assemble.js:16` cites `tally.js:95`/`:110` (→ `:96`/`:112`);
  `seats.js:95` → `run-retry-group.js:66`; `run-stage2.js:136` cites `run-stages.js:117-120`
  (→ `:196`/`:222`); `run-debate-revote.js:111` and `run-stage2.js:85` cite one padding pattern at
  two different ranges.
- Schemas: **both** `council-tally.schema.json` **and** `council-verdict.schema.json` gain `seats`,
  `findings[].raiserSeat` and `sameModelCorroboration`. The only `additionalProperties:false` in
  either is scoped to the `debate` sub-object (`:62`, `:157`), so nothing rejects them.
- ⚠️ **`docs/council.md` is NOT pinned by the two suites R1 named** — neither
  `skill-tally-recipe-docs.test.js` nor `manual-orchestration-docs.test.js` opens it. The real gate
  is `tests/council-reference-docs.test.js`. Also update `docs/council.md:573` (which currently
  tells users the engine excludes the raiser's own adjudication — now seat-conditional) and `:641`.
- File the R4-6 / R4-7 / R4-9 deferrals with their refutation evidence attached.

---

## 6. Standing instructions for every task review

1. **MUTATE, DON'T READ** anything that freezes a contract. Three PR3 contracts were correct but
   had **zero** coverage; the mutations survived 990+ tests.
2. **RE-DERIVE EVERY USER-FACING CLAIM FROM THE SOURCE WHERE IT IS WRITTEN.** Never inherit one
   from this plan.
3. ⚠️ The `.bak` mutation recipe has a **multi-site hole** — a second apply overwrites the backup,
   restore silently leaves a mutation in the tree, **and the suite goes green.** Re-grep every
   mutant string.
4. **Never guard an emit-when-X rule with `toEqual`** — it ignores `undefined`-valued keys. Use
   `in` or `Object.keys`.
5. **Any copy-ready code block must be diffed against the shipped line, not read.** R2's own
   replacement for `debate.js:200` dropped a trailing `.map(a => a.verdict)` and would have broken
   every defense brief on every bench. Check the **whole statement**, including trailing
   transforms, not just the clause being changed.
6. **A rule is not done until it is TOTAL.** R2 found the `role` rule and the findings matcher each
   undefined on four+ reachable shapes — including every run that has ever shipped. For every rule
   in §3.3, enumerate: unique bench, twin bench, `claude` group, dead/leg-less seat, and
   hand-assembled input with no seat table.
7. Assume **every citation in this plan may still be wrong.** R1 drew 74 findings and R2 drew 53 —
   all in the plan. Five consecutive revs have had every defect originate in the plan, never in an
   implementation.
