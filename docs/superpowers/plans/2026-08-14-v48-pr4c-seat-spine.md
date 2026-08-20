# v4.8 PR4c — the seat spine

**Branch:** `v48-pr4c-seat-spine` · **Merge base:** `7f50d2da` (PR #156, v4.8 PR4b)
**Spec:** `docs/superpowers/specs/2026-08-10-v4.8-ask-anything-count-everyone-design.md` §4.6, §7.2, §7.4
**Predecessors:** PR0 `10310799` · PR1 `7cd32f81` · PR2a `5c93ead1` · PR2b `ad8c83ce` · PR3 `e2882192`
· PR4a `#155` · PR4b `7f50d2da`

> **Revision 4.** Revision 1 came from a 5-area recon at `7f50d2da` and was attacked by six lenses
> (**5 CRITICAL / 15 MAJOR / 14 MINOR**). Revision 2 folded those in and was attacked by four more,
> aimed only at the corrections (**8 CRITICAL / 11 MAJOR / 12 MINOR**). Revision 3 folded *those* in
> and was attacked by a fifth round targeted at **property claims specifically**, because the Critical
> count had not fallen — returning **3 CRITICAL / 2 MAJOR / 3 MINOR**, all three Criticals sharing
> **one root cause** (see §8.6). Every finding is folded in below.
>
> **What round 3 CONFIRMED, so it need not be re-litigated:** §3.3's stamp property (30 documents;
> both seat conjuncts are equivalent mutants, so the property is enforced twice) · R4c-9's
> four-producer agreement (7 benches) · `report-html.js` needing zero edits · the `claude` re-append ·
> byte-identity on unique benches including the defensive seats-present case · T19's blind spelling.
>
> ### ⚠️ ROUND 2 FOUND CRITICALS INSIDE ROUND 1'S CORRECTIONS, ON EVERY SUB-DESIGN IT WAS WARNED ABOUT
> In each case the correction **narrowed the entrance to the defect rather than closing it**:
> - **The R8 stamp** — revision 1 analysed only the inner ternary of `tally.js:96`; **revision 2's fix
>   analysed the inner ternary a second time** and the bug survived on a hand-assembled document. Now
>   on its **third** spelling (§3.3).
> - **The emit guard** — revision 2 claimed `seat.id !== seat.alias` "closes all three". It closed two;
>   PR3's two producers still compare against `model`, shipping §1.2 on the engine path (R4c-9).
> - **The tests** — round 1 found four specifications green against their own named mutants; revision 2
>   rewrote them and **T7 is the third spelling of that same failure** (§5).
> - **§3.6**, written after round 1 and never attacked, arrived with **three CRITICALs** of its own.
>
> **Two revision-2 claims rested on VACUOUS evidence** — measurements that never entered the code path
> they were cited for (§3.6's on-disk fixture; §3.2's `.slice()` precedent). Both are marked ⚠️ in
> place. Assume there are more.
>
> **Assume the citations here are still wrong.** Eight consecutive revs have had every substantive
> finding originate in the plan, never in an implementation.

---

## 0. Owner rulings

| # | Ruling |
|---|---|
| **R4c-1** | **`meta.seats` / `verdict.seats` are IN**, emit-only-when-the-bench-repeats-an-alias. ⚠️ **AMENDED by R4c-7 — the original justification was measured false and is withdrawn.** |
| **R4c-2** | **Street-cred seat-keying stays OUT** (R4-3 re-confirmed on new evidence — §1.4). Filed as its own PR with the measurements attached. |
| **R4c-3** | **Ledger findings attribution stays concentrated (R4b-2).** `ledger.js:128`'s "until PR4c" forecast **expires unfulfilled**; the comment is rewritten to say what is true. |
| **R4c-4** | **The peer filter takes the GUARDED form at BOTH sites, in ONE commit.** Re-decided PROBE-FIRST; R4-11's stated reason is measured FALSE and replaced (§1.3). |
| **R4c-5** | **Widening `src/mcp-tools.js` is REQUIRED, not documentation** (§1.5). ⚠️ It must be widened **permissively** — see §3.3; the strict spelling in revision 1 shipped a *loud* fork in place of the silent one. |
| **R4c-6** | **Riders: H4 pin IN. `seats.js` consolidation OUT. "Loud rank collapse" OUT** — its premise is measured wrong in three places (§2). |
| **R4c-7** | **`meta.seats` keeps the NARROW predicate (`s.id !== s.alias`), and R4c-1's stated reason is WITHDRAWN.** The honest claim is "resolvable on twin benches only". `lens` and `position` remain unrecoverable on every other bench; filed to BACKLOG. Byte-identity on lens/critic benches is worth more than a table PR5 can request when it needs one. |
| **R4c-8** | **The adjudication matrix is seat-keyed NOW, pulled forward from PR5** (§3.6). Revision 1 planned to ship a human-facing artifact whose evidence column contradicts its own verdict column; that fails the product principle as hard as a crash. |
| **R4c-9** | **All FOUR seat-emit producers move to one predicate `seat.id !== seat.alias`** — including PR3's two (`run.js:194` for `raiserSeat`, `run-assemble.js:166` for `adjudications[].seat`), which still compare against `model`. Revision 2 changed only the two new ones and claimed that "closes all three"; **measured false** (§3.1). This is a behaviour change to two fields PR3 already shipped, and §4 discloses it. Leaving them split would ship §1.2 — the exact defect R4c-1 exists to close — on the engine path, on a unique-alias bench. |

---

## 1. What is actually broken (measured at `7f50d2da`)

### 1.1 `runStats` rows cannot name their seat, and the allowlist would strip one anyway

`run-assemble.js:168-171` builds the primary review rows:

```js
  const runStats = reviews.map(r => buildRunStatsEntry({
    leg: r.leg, model: r.model, role: r.role, wasChair: false, conformance: r.conformance,
    findingsUnverified: r.findingsUnverified, repairRefused: r.repairRefused,
  }));
```

`r.seat` **is** in scope — but it is an **object**, not a string:
`run-stages.js:263` opens `reviews.push({` and `:264` reads
`model: m.modelInput, modelInput: m.modelInput, seat: m.seat || null,`
← `run-launch.js:206` `const seat = (seatOf && seatOf.get(leg)) || null;`
← `buildSeats` (`seats.js:66-69`) ⇒ `{id, alias, role, lens, position}`.

Probe-measured: `typeof seat -> object`,
`{"id":"gemini","alias":"gemini","role":"seat","lens":null,"position":1}`. Two HEAD consumers already
depend on the object shape — `run.js:194` (`r.seat && r.seat.id !== r.model`) and `run.js:227`
(`byJudge.get(r.seat ? r.seat.id : r.model)`).

> ⚠️ **Corrects PR4b's own plan.** `2026-08-13-v48-pr4b-ledger-grouping.md:109-110` says PR4c "is ~3
> lines because `r.seat` already reaches `run-assemble.js:168` unread." The reaching is true; the
> estimate is not. `buildRunStatsEntry` (`run-assemble.js:61-76`) destructures a **fixed param list**,
> so an extra `seat:` argument is silently dropped — the signature must change. And `tally.js:115-134`
> is an explicit allowlist that builds a **fresh object literal**, so a `seat` key on an input row is
> stripped before it can reach `tally.json`; `verdict.js:129` (`runStats: record.runStats`) copies
> tally's output verbatim, so `verdict.json` inherits the strip. Three files, not three lines.

### 1.2 The seat ids PR3 shipped are unresolvable

PR3 put `adjudications[].seat` and `findings[].raiserSeat` into `tally-input.json`/`tally.json`.
`buildTallyInput` (`run-assemble.js:152-159`) emits a six-key `meta` —
`runId, date, runType, models, chair, claudeInCouncil` — and no seat table.

`verdict.json` is worse: `verdict.js:106-111` is an explicit **renaming** projection
(`record.meta.models` → `council` at `:110`), so nothing from `meta` arrives that is not named there.
Measured — the tally finding carries `raiserSeat` and the verdict finding does not:

```
tally   findings[0] keys: [… tierOverride, adjudications, raiserSeat]
verdict findings[0] keys: [… tierOverride, duplicateOf, adjudications, decision, applied]
raiserSeat survived? false
adjudications[0]: {"judge":"b","verdict":"agree","seat":"b#1"}   ← survives by-reference
```

> ⚠️ Revision 1 printed `sameModelCorroboration` in the tally row of that probe. **That key is not
> reachable at HEAD** — `tally.js:105-106` is a closed literal — and the block was presented as
> measured HEAD output when it came from a patched copy. Corrected above.

### 1.3 The peer filter is alias-keyed — #137's tally half — and the naive fix is wrong on real runs

`tally.js:96` today:

```js
    const peers = f.raiser ? votes.filter(v => v.judge !== f.raiser) : votes;
```

Measured on bench `['deepseek','deepseek','gpt']`, finding raised by `deepseek#1`, input assembled
exactly as the engine emits it:

| scenario | HEAD | GUARDED |
|---|---|---|
| self + twin + gpt all agree | a=1 d=0 Confirmed / **thin** | a=2 d=0 Confirmed / **solid** |
| self + twin agree, gpt **silent** | **a=0 d=0 → Singleton** | a=1 d=0 → **Confirmed** |
| self + twin agree, gpt disputes | a=0 d=1 Contested / **thin** | a=1 d=1 Contested / **solid** |
| twin votes **neutral**, gpt silent | `{a:0,d:0,n:0}` | `{a:0,d:0,**n:1**}` — tier and confidence unchanged |

Row 2 is the headline: a finding with **one real corroborating peer** reports as the no-signal tier.

**The ceiling, measured on `--models deepseek,deepseek,deepseek`** (all three seats one alias): HEAD
emits every finding `Singleton`, `{a:0,d:0,n:0}`, `thin`, ledger `confirmRate: 0` — **the entire
cross-review is discarded**. PR4c: every finding `Confirmed`, `solid`, ledger `confirmRate: 1`.

> ### ⚠️ R4-11's REASON IS MEASURED FALSE — do not restore it
>
> R4-11 said the two forms *"differ only on hand-assembled / MCP input"* and chose GUARDED as a
> fail-closed preference. **Asymmetric seat data is ENGINE-REACHABLE in both directions.** The two
> producers are **independent** — each is `X && X.id !== alias` over a *different* binding operation:
>
> | field | emit site | seat source |
> |---|---|---|
> | `findings[].raiserSeat` | `anonymize.js:60` ← `run.js:194` | `reviews[i].seat` ← `run-launch.js:206` |
> | `adjudications[].seat` | `run-assemble.js:166` | `judgeResults[i].seat` ← `run-stage2.js:141` |
>
> Both are `|| null` by design and each is filled by its own `bindSeats` call over its own wave
> (`stage1-bind.js:29` / `run-stage2.js:104` / `run-retry.js:128`). Both stages carry an explicit
> `__unbound-` placeholder whose binds are then **filtered out** (`run-stage2.js:106`,
> `run-retry.js:129-131`) — `seat: null` is a designed-for state, not a hypothetical. Demonstrated
> through the real modules:
>
> - **Direction A** — Stage-1 seat bound, Stage-2 twin judge orphaned ⇒ finding HAS `raiserSeat`,
>   vote has NO `seat`.
> - **Direction B** (weaker precondition: only ONE unbound Stage-1 twin review; `run-stage2.js:92-95`
>   makes that review's judge a filtered placeholder while the other twin binds) ⇒ finding has NO
>   `raiserSeat`, vote HAS `seat`.
>
> Both directions: HEAD Singleton (a:0) · **NAIVE Confirmed (a:1)** · GUARDED Singleton (a:0).
> `bindSeats` orphaning is real on a twin bench — a `deepseek` leg whose id is not `${waveId}-${n}`
> cannot use the alias fallback (`seats.js:143-144` requires `hits.length === 1`, and `deepseek` has
> two seats) ⇒ `bound: ['gpt->gpt'], orphans: ['deepseek']`. Twin benches run end-to-end
> (`run-raiserseat-call.test.js:60-89`, exit 0; `run-debate.test.js:766/913/982`), and
> `preflightSeats` (`seats.js:219-258`) **never rejects a repeated alias** — it rejects seat-id
> collisions, artifact-filename collisions when either side is disambiguated (`:236-238`),
> `--critic` with `--lenses` (`:242-245`), and an off-bench critic (`:249-251`).
>
> **NAIVE silently promotes a Singleton to Confirmed on a real run whenever a twin seat fails to bind.**

**Truth table, 12 rows.** NAIVE≠GUARDED on **3/12**; NAIVE≠HEAD on **5/12**; GUARDED≠HEAD on **2/12**.
They differ **exactly when the aliases MATCH and precisely one side carries its seat id**.

> ⚠️ **The 5/12 figure describes SEAT-BEARING rows only and badly understates NAIVE's blast radius.**
> Measured during implementation: the NAIVE filter turns **66 of 162** council tests red, including the
> golden av-receiver fixture — because on any **seat-free** document `undefined !== undefined` is
> false, so NAIVE excludes *every* vote. NAIVE is not a subtly-wrong spelling that slips through; it is
> catastrophic on ordinary input. **T1/T2 remain the targeted engine-reachable pins** — they are what
> separate NAIVE from GUARDED on the shapes that matter — but do not read 5/12 as "NAIVE is nearly
> right".

- **Row 8** (`raiserSeat=deepseek#1`, `judge=deepseek`, `seat=deepseek#2`): HEAD excludes, GUARDED
  admits — **this row IS the #137 fix**.
- **Rows 1, 2, 6**: NAIVE admits where HEAD and GUARDED exclude — NAIVE's self-corroboration bug.
- **Row 10** (`raiserSeat=deepseek#1`, `judge=gpt`, `seat=deepseek#1`): HEAD admits, **both** NAIVE
  and GUARDED exclude. A regression against HEAD — **engine-unreachable** (`buildSeats` guarantees
  `seat.alias === alias`; `run-assemble.js:166` reads `j.seat.id` beside `j.judge` from the same
  entry). **Disclose (§4), do not fix.**

**The second site must move in the same commit.** `debate.js:203` is the only remaining alias-space
peer filter — `debate.js:81` and `debate.js:178` are **already** seat-space, and `debate.js:189-193`
says so in an in-source ⚠️ block. Measured on the shipped `run-debate.test.js:38` twin fixture: HEAD
tally `{a:0,d:1}` ↔ brief renders *"1 dispute, 0 agree, 0 neutral"*. Fix one without the other and the
defense brief's peer split disagrees with the tally the chair reads.

### 1.4 Street cred collapses twins — measured, deliberately NOT fixed here (R4c-2)

- `tally.js:32-42` `rankPositions`: `pos` is **model-keyed**, `pos.set(m, meanPos)`. On
  `order ["a","a","b"]` ⇒ `{a:2, b:3}` — the first twin's position 1 is **overwritten**, not averaged.
- `tally.js:49-67` `computeStreetCred` maps over `meta.models`, still `['a','a','b']`, so the record
  carries **two byte-identical `streetCred` rows**, reaching the user via `report.js:149` and
  `report-html.js:49`.
- `ledger.js:104` `new Map(streetCred.map(s => [s.model, s]))` last-wins into the **append-only** file.

### 1.5 The MCP path strips the seat keys — fixing the filter alone forks CLI from MCP

`mcp-tools.js:392-409`, measured through the real zod 3.25.76:

| object | accepted keys |
|---|---|
| `meta` | `runId, runType?, date?, models, chair?, claudeInCouncil?` |
| `findings[]` | `id, raiser, severity, claim?` — **only these four** |
| `adjudications[]` | `judge, findingId, verdict` — **only these three** |

`raiserSeat`, `seat` and **`location`** are all stripped. `mcp-server.js:1540-1543` hands the
SDK-**parsed** input to the handler and `:1424` does `const record = tally(input)`. Without R4c-5,
`amicus_council_tally` stays permanently on the #137 behaviour while `amicus council tally` —
`cli-handlers-council.js:24`, a raw `JSON.parse` with **no schema at all** — gets the fix.

> **Pre-existing defect, filed not fixed:** `location` is stripped on the same path while
> `anonymize.js:59` emits it and `:55-56` records that Action v2 joins on `claim`+`location`. §6 files it.
> ⚠️ Note the *opposite* asymmetry, measured: `mcp-tools.js:399,402` make `raiser` and `judge`
> **required** `z.string()`, so the MCP path is the one place §3.3's stamp hazard cannot arise.

---

## 2. Claims from the spec and from the PR4 draft that are FALSE or STALE

> ⚠️ **Provenance, corrected.** Rows 4–18 originate in `2026-08-13-v48-pr4b-ledger-grouping-DRAFT.md`,
> which is an **untracked working file in the main clone** (`C:\Users\sendt\code\amicus\docs\…`) — it
> is not at HEAD and not in any commit, so **a reviewer cannot open it**. It is cited for provenance
> only; every right-hand column below was re-measured against the repo and stands on its own.
> Rows 1–3 are the spec, which is in-tree. **15 rows are draft-inherited; 3 are spec-inherited.**

| # | Claim | Verdict | Measured |
|---|---|---|---|
| 1 | spec §4.6:194 "`meta.seats` is **REQUIRED** on the tally input; `tally()` must resolve seat → model" | **FALSE as a dependency** | Written assuming a seat-VALUED peer filter. PR3 ruled alias-valued + emit-when-different, so the R8 stamp is computable without a seat table (§3.3). `meta.seats` ships for R4c-1/R4c-7's reason, not the stamp's. |
| 2 | spec §4.6:186 "the peer filter becomes seat-exact — `v.judge !== f.raiser` compares seat ids" | **FALSE since PR3** | Both stay alias-valued. This is why §3.3's guard is needed at all. |
| 3 | spec §7.4.2 `seats: z.array(z.object({ id, model }))` | **FALSE shape** | `buildSeats` emits `{id, alias, role, lens, position}` — no `model` key. §3.3 also rejects the *strictness*, not only the shape. |
| 4 | draft "`run-stage1-rows.js:98-99` dead-seat rows" | **STALE** | `:89` is the `for (const [key, { seat, alias }] of deadSeats)` destructure; `:76-87` builds the map; **`:106-107`** is the row build. `:98-99` is now `finalLeg = …`. |
| 5 | draft producer table | **INCOMPLETE** | Omits `run-stage1-rows.js:57-58`, the `superseded` row. Role `superseded` is excluded by `joinsLedger`, so it is correctly unstamped — a reason, not an accident. |
| 6 | draft "`run-debate.test.js:844` filters to debate roles only, so it stays GREEN" | **assertion CONFIRMED, reason FALSE** | The Set literal is **`:838`** and the `.filter()` **`:839`** (`:837` is the test title). `superseded`/`repair` **are** `buildRunStatsEntry` products. It survives because (a) the fixture sets `runStats: []` (`:52`) and (b) debate rows use a different builder (`debate.js:134-147`, `run-debate.js:87`, `run-debate-revote.js:159`). **A `runCouncil`-level fixture would not be immune.** |
| 7 | draft "`run-assemble.test.js:42-48`'s `toEqual` would catch an unconditional emit" | **FALSE** | Probe-proven (jest 29.7.0, 5/5): `toEqual` ignores `undefined`-valued keys, and `JSON.stringify` drops them, so **no on-disk test catches it either**. `expect('seats' in meta).toBe(false)` catches it; `toStrictEqual` also works. |
| 8 | draft `seat-parity-ondisk.test.js` as the guard for the new fields | **HALF FALSE** | It binds `raiserSeat` (`:36`, `:94`) and a runStats `"seat":` key. It does **NOT** bind `meta.seats` — the FORBIDDEN needle `"seat":` does not match the substring `"seats":`. It does **NOT** bind `sameModelCorroboration` at all. §5 adds both needles. ⚠️ Revision 1 claimed "all three needles measured false"; measured, `"role": "seat"` is **present** in three documents — it simply is not the needle. |
| 9 | draft "`labelMap` collapses two seats onto one label" | **FALSE** | `anonymize.js:20-34`: keys are LABELS, unique by construction. `assignLabels(['a','a','b'])` ⇒ `{"Review A":"a","Review B":"a","Review C":"b"}`. The map that collapses is `letterByModel`, with **no production consumer** (`anonymize.js:18/28/31/33` + its own test only). |
| 10 | draft "`rankingToOrder` returns `errors: []` because nothing DETECTS the collapse" | **TRUE result, FALSE reason** | `anonymize.js:71-81` pushes only on an **unknown label** (`:75`); every label resolves on a twin bench. |
| 11 | draft "`.eslintrc.js:16` bans `console` in `src/council/*`" | **FALSE** | `'no-console': 'error'` is **global** at `.eslintrc.js:16`; council is simply not in any `overrides` exemption. `process.stderr.write` is permitted, 5× precedented in-directory. |
| 12 | draft "the third `appendRun` call site is in `run.js`" | **STALE** | It is **`run-finish.js:53`**. ⚠️ Revision 1 said `ledger.js:96-98` "already documents this" — **overstated**: that comment names the two hand-assembled sites and never names `run-finish.js` as the third. |
| 13 | draft "`docs/council.md` peer-exclusion passages at `:573`/`:641`" | **STALE by +2** | Now `:575`/`:643`, measured against `git show 8a9b6847:docs/council.md`. PR #156 changed the file `+27/-5` but only **+2** landed above `:573`. |
| 14 | draft "both schemas gain `seats`, `raiserSeat`, `sameModelCorroboration`" | **NOT REQUIRED** | Ajv-2020 accepts all three on both real documents, on every bench including twins. The only `additionalProperties:false` in either is scoped to `findings[].debate` (`council-tally.schema.json:62`, `council-verdict.schema.json:157`). §6 documents them anyway. |
| 15 | draft "`seatKey` consolidation is a win" | **FALSE (net-flat)** | `run.js:224` and `run-retry.js:149` are byte-identical (`od -c`, 54 B); **`run-debate-revote.js:64` is NOT** — it is `function seatKey(seat, alias) { … }`, a different form with different param names. `run.js` and `run-debate-revote.js` each use it **once**. ⚠️ `run.js:227` is a **third hand-inlined copy** that must stay (its `|| byJudge.get(r.model)` fallback is load-bearing, `run.js:216-223`). |
| 16 | draft refusing the roster-padding consolidation as "a near-copy, not a win" | **INVERTED** | It is the only duplicate with real lines — `run-retry.js:121-131`, `run-stage2.js:91-97`+`:104-107`, `run-debate-revote.js:115-126`, ~11 lines each, all three already requiring `./seats`. Still **not for PR4c**; recorded so the endorsement is not re-inherited backwards. |
| 17 | draft "`debate.js:200`", "`debate.js:154` sibling" | **STALE** | The filter is **`debate.js:203`**. `:154` is inside `allNoResponse`; the real siblings are `:81` and `:178`, **both already seat-space**. |
| 18 | draft "`tally.js:58` peer filter" as the same fix | **DIFFERENT SITE** | `:58` is `computeStreetCred`'s filter over ranking positions, alias-space **by construction**. R4c-2 leaves it. Do not conflate. |

---

## 3. Design

### 3.1 `seat` on runStats — two producers, and the guard compares the seat to ITS OWN alias

`joinsLedger` (`ledger.js:49-53`) admits `{seat, critic, chair, claude, council, redteam}` + `lens:*`
+ null/undefined; it excludes `judge`, `chair-attempt`, `repair`, `superseded`, `rebuttal`, `revote`
and any named-unknown role.

| Producer | Role | Stamp? | Why |
|---|---|---|---|
| `run-assemble.js:168-171` primary review rows | `seat`/`critic`/`lens:*` | **YES — when the seat is bound** | on-bench, ledger-joinable, `r.seat` in scope |
| `run-stage1-rows.js:106-107` dead-seat rows | the seat's own role | **YES — when the seat is bound** | on-bench, ledger-joinable; loop destructures `{seat, alias}` at `:89` |
| `run-stage1-rows.js:57` superseded | `superseded` | no | **excluded by `joinsLedger`** — can never win the join |
| `run-assemble.js:188` judge · `run-chair.js:170,:261` · `run-stage2.js:184` · `run-stages.js:222` | judge/chair-attempt/repair | no | excluded by `joinsLedger` |
| `run-finish.js:23` (`chairStats`) and `:32` (`giveUpRow`) | **both `chair`** | no | off-bench — no seat exists |
| `claudeRunStatsRow` — **`run-assemble.js:133-136`**, pushed `:180` | `claude` | no | a hand-built literal that **never calls `buildRunStatsEntry`**; `seats.js:44-46` excludes `claude` |

> ⚠️ **"YES" is conditional, and revision 1's unqualified YES was wrong.** Measured through the real
> `pushDeadSeatRows` + real `bindSeats`, two orphaned twin legs:
> `bindSeats ⇒ {"bound":[],"unbound":["deepseek#1","deepseek#2","gpt"],"orphanLegs":2}` and
> `rows for TWO dead twins ⇒ [{"model":"deepseek","role":"seat"}]` — **one row, no seat, for two paid
> seats**, because `deadSeats.set(keyOf(l), …)` (`run-stage1-rows.js:78`) falls back to the alias when
> `seatOf.get(l)` is null and `deadSeats` is a **Map**. The collapse is pre-existing; the stamp being
> inert there is new. §4 discloses it; §5's T12 pins **both** shapes.

**The guard compares the seat to its OWN alias.** `buildRunStatsEntry` takes the seat **object**:

```js
function buildRunStatsEntry({ leg, model, role, wasChair, conformance, findingsUnverified,
  repairRefused, seat }) {
  return {
    …
    ...(leg && leg.model ? { resolvedModel: leg.model } : {}),
    // v4.8 PR4c: emit-when-DIFFERENT, mirroring anonymize.js:60 — but compared
    // against the seat's OWN alias, never against `model`. buildSeats mints
    // `alias#N` only when an alias repeats (seats.js:67), so `id !== alias` IS
    // "the bench repeats this alias" — the identical predicate meta.seats uses
    // (§3.2), which is what stops the two guards disagreeing. Comparing against
    // `model` instead reads the LEG's modelInput, which is not the alias when a
    // leg reports none or when a --council preset carries a padded member.
    ...(seat && seat.id !== seat.alias ? { seat: seat.id } : {}),
    status: leg ? leg.status : 'error',
    …
  };
}
```

Callers pass the object: `run-assemble.js:168-171` → `seat: r.seat`; `run-stage1-rows.js:106-107` →
`seat` (the `{seat, alias}` destructure at `:89` — pass the seat itself, not `seat.id`).

> ### ⚠️ Revision 1's `rowModel` design was measured wrong THREE ways. Do not restore it.
> Revision 1 hoisted `const rowModel = model !== undefined ? model : (leg ? leg.model : null);` and
> emitted on `seat !== rowModel`, claiming that centralising the test prevented producer drift.
> Measured:
> 1. **It centralises the expression, not the operand.** `run-assemble.js:169` passes `r.model` (the
>    **leg's** `modelInput`); `run-stage1-rows.js:106` passes `alias` (the **bench** alias). One run,
>    bench `['gemini ','gpt','qwen']` with `qwen` dead:
>    `{"model":"gemini",…,"seat":"gemini "}` from the primary producer and **no** `seat` from the
>    dead-seat producer. Same bench, same expression, opposite outcomes.
> 2. **It breaks byte-identity on two UNIQUE-alias benches** — legs that report no `modelInput`
>    (`result-schema.js:63` can yield `modelInput: null`) and a whitespace-padded bench member.
>    The latter is reachable: `run-launch.js:111` joins and `fanout-validate.js:24` trims, but
>    `config.js:445-459 classifyCouncilMembers` pushes `member` **raw**, so any `--council <preset>`
>    with a padded member qualifies.
> 3. **It shipped seat ids with no table**, because `meta.seats` gated on `s.id !== s.alias` while the
>    rows gated on `seat.id !== rowModel` — measured `meta.seats? false` beside a present
>    `runStats[].seat` and `findings[].raiserSeat`, on the **engine** path. That is precisely §1.2, the
>    defect R4c-1 exists to close.
>
> Comparing against `seat.alias` closes items 1 and 2, deletes the hoist, and makes byte-identity a
> property of `buildSeats` rather than of leg metadata. ⚠️ **It does NOT close item 3 on its own —
> revision 2 claimed it "closes all three" and that was measured FALSE. See R4c-9 immediately below.** It also removes revision 1's **prose-only**
> "callers pass the id or null" contract: under `seat !== rowModel` an object is always `!==`, so a
> future producer passing `r.seat` would have written the **whole seat object** into three artifacts —
> measured. Under `seat.id !== seat.alias` the object *is* the contract.

> ### ⚠️⚠️ R4c-9 — PR3'S TWO PRODUCERS MUST MOVE TOO, OR §1.2 SHIPS
> The `seat.id !== seat.alias` guard fixes the two producers this PR adds. **PR3's two still compare
> against `model`** and revision 2 proposed no edit to either:
> - `run.js:194` — `r.seat && r.seat.id !== r.model ? r.seat.id : null` (feeds `raiserSeat` via `anonymize.js:60`)
> - `run-assemble.js:166` — `j.seat && j.seat.id !== j.judge ? { seat: j.seat.id } : {}`
>
> Measured end-to-end through real `buildSeats` → real `toGlobalFindings` → `buildTallyInput` → `tally()`:
>
> | bench | `meta.seats` | `runStats[].seat` | `raiserSeat` | `adjudications[].seat` |
> |---|---|---|---|---|
> | `['gemini','gpt']` control | absent | absent | absent | absent |
> | **`['openai/gpt-5 ','gpt']`** padded preset member | **absent** | **absent** | **`"openai/gpt-5 "`** | **`"openai/gpt-5 "`** |
> | **leg 0 reports no `modelInput`** | **absent** | **absent** | **`"gemini"`** | **`"gemini"`** |
> | `['deepseek','deepseek']` | present | `deepseek#1` | `deepseek#1` | `deepseek#1` |
>
> Rows 2–3 are **§1.2 verbatim — seat ids with no table — on a UNIQUE-alias bench, on the ENGINE
> path.** Change both to `seat.id !== seat.alias` so all four producers share one predicate.
>
> ⚠️ **This changes two fields PR3 already shipped.** On those two bench shapes the fields **stop**
> being emitted — which is correct (they were being emitted where the seat id equals the alias, i.e.
> where they carry no information, contradicting their own documented "emit-when-different" intent)
> but it is a change, and §4 discloses it. `run-assemble.js:166`'s comment at `:164-165` explains the
> emit rule and becomes stale; rewrite it.
>
> ⚠️ **A FOURTH unclosed shape, undisclosed until now:** a `--council` preset with a whitespace-padded
> member is *functionally a twin bench* (two legs, one executable) that `buildSeats` treats as two
> distinct aliases. Measured on `['openai/gpt-5 ','openai/gpt-5']` with both seats agreeing on both
> findings: `basis {a:0,d:0,n:0} Singleton` — **the #137 undercount survives in full, silently.**
> R4c-9 does not fix it; §4 lists it.

`tally.js:115-134` gains the matching allowlist entry **in the same slot** —
`...(r.seat ? { seat: r.seat } : {})`, immediately after `resolvedModel` (`:130`). Measured: both
sides of the round trip yield
`[model, role, wasChair, conformance, waveId, resolvedModel, seat, status, durationMs, usage]`.

> ⚠️ `tests/council/tally.test.js:180-181` pins the exact 7-key array of a **minimal** row. A
> conditional key in that slot leaves the minimal row unchanged; an **unconditional** key turns it RED.

### 3.2 `meta.seats` and `verdict.seats` (R4c-1 as amended by R4c-7)

`buildTallyInput` gains a `seats` param — appended last in the destructure — and emits:

```js
    ...(Array.isArray(seats) && seats.some(s => s.id !== s.alias) ? { seats: seats.slice() } : {}),
```

placed **last** in the `meta` literal (measured order:
`[runId, date, runType, models, chair, claudeInCouncil, seats]`), so the shipped six-key order is
untouched in every case and the new key is a pure tail.

> ⚠️ **`.slice()`'s justification in revision 2 was VACUOUS and is withdrawn.** It cited
> `run-assemble.js:156`'s `models: bench.slice()` — but that copy exists **because
> `meta.models.push(CLAUDE_SEAT)` mutates it at `:177`**. **Nothing mutates `meta.seats`**, and `toEqual`
> in T9 cannot distinguish `seats` from `seats.slice()`, so the copy is both unmotivated and untestable.
> Keep `.slice()` as cheap defence-in-depth if you like — the array is shared with
> `runState.checkpoint` (**`run.js:135`** — `:133` is `o.seats = seatPre.seats`) and with the provisional and final tally inputs — but say that,
> and do not claim a precedent that does not apply.

> ⚠️ **`...(seats ? … : {})` would be VACUOUS on the engine path** — `run.js:133` sets `o.seats`
> unconditionally past the preflight, and `buildSeats` always returns an **array** (`[]` for an empty
> bench, still truthy). Measured end-to-end: the vacuous guard writes a full seat table into
> `tally-input.json`, `tally.json` **and** `verdict.json` on **every unique-alias bench**.

> ### ⚠️ R4c-7 — R4c-1's stated reason is WITHDRAWN
> R4c-1 justified the table as *"`role`, `lens` and `position` appear nowhere else."* The guard asks a
> **different question** — "does the bench repeat an alias?" — and the two disagree on every
> `--lenses` or `--critic` bench with unique aliases. Measured: on
> `bench=['a','b'] lenses=['Security Review','perf']`, `meta.seats` is **absent**,
> `runStats[].role` carries only the slug `lens:security-review`, and the raw text `"Security Review"`
> appears **nowhere** in the tally input. `position` is unrecoverable on every bench.
>
> **The honest claim is: `meta.seats` makes seat ids resolvable on twin benches, and only there.**
> `lens` and `position` remain unrecoverable elsewhere — filed to BACKLOG, not fixed. The owner chose
> byte-identity on lens/critic benches (measured identical across eight configurations) over a table
> PR5 can request when it needs one.

- `run.js:237-241` `mkInput` passes `seats: o.seats`. It is the **only production caller** of
  `buildTallyInput`; the others are tests. The final input is derived by spread at
  `run-finish.js:36`, not rebuilt, so this is the single seam — measured to survive the debate path
  into `tally-provisional.json`, the final `tally-input.json`, `tally.json` and `verdict.json`.
- **Three artifacts change, not one.** `tally.js:111` copies `meta` **by reference, verbatim**, so
  `meta.seats` lands in `tally-input.json` and `tally.json` for free — and on a `--debate` run also in
  **`tally-provisional.json`** (`run-debate-stage.js:44`). It stops only at `verdict.json`.
- `verdict.js` gains `...(record.meta.seats ? { seats: record.meta.seats } : {})` immediately after
  `council:` (`:110`) — measured to land between `council` and `claudeInCouncil`. **The key is
  `seats`**, matching the existing `seatLoss` sibling. PR5 codes against this name.

**Fallback rules for consumers:**

- ⚠️ **Absence does NOT imply a unique-alias bench.** Two of the three `appendRun` call sites feed
  hand-assembled input no seat machinery touches (`cli-handlers-council.js:39`, `mcp-server.js:1427`).
  Absent `meta.seats` means "no seat table available", never "the bench was unique".
- ⚠️ **Never join `meta.seats` to `meta.models` positionally.** `run-assemble.js:177` pushes
  `CLAUDE_SEAT` (`'claude'`, `:34`) onto `meta.models` while `seats[]` is bench-only
  (`seats.js:44-46`). The same warning applies to `streetCred[]`.

### 3.3 The guarded peer filter and the R8 stamp — ONE commit (R4c-4)

**Both preserve their trailing transforms; verify that before copying.**

```js
// tally.js:96
const peers = f.raiser
  ? votes.filter(v => (v.seat && f.raiserSeat) ? v.seat !== f.raiserSeat : v.judge !== f.raiser)
  : votes;

// debate.js:203
const peerVerdicts = (f.adjudications || [])
  .filter(a => (a.seat && f.raiserSeat) ? a.seat !== f.raiserSeat : a.judge !== f.raiser)
  .map(a => a.verdict);
```

> ⚠️ **The `.map(a => a.verdict)` tail is load-bearing and its guard is a single test.**
> `briefings-debate.js:56-60` `verdictCounts` indexes `c` **by the element itself**. Measured through
> `buildDefenseBrief`: strings ⇒ `"1 dispute, 1 agree, 1 neutral"`; objects ⇒ `"0 dispute, 0 agree,
> 0 neutral"` — a **silent all-zero, byte-identical to the no-data case**, i.e. a paid brief telling
> the model nobody disputed it. A prior review dropped this tail twice. The only guard is
> `tests/council/run-debate.test.js:252-255` — measured RED against a `.map`-removed copy.

**The R8 stamp**, computed on the POST-filter `peers`, **emit-when-TRUE only**, placed **last in the
finding literal, after `raiserSeat`** (`tally.js:105-106`), with the computation immediately after
`assignTier`:

```js
...(f.raiser
  && peers.some(v => v.seat && f.raiserSeat && VERDICTS[v.verdict] === 'a' && v.judge === f.raiser)
  ? { sameModelCorroboration: true } : {}),
```

(`VERDICTS` is `tally.js:71`, module-private, `{ agree:'a', dispute:'d', neutral:'n' }`. `peers`
(`:96`) is in scope at the finding literal — same arrow body, measured.)

> ### ⚠️⚠️ THE LEADING `f.raiser &&` IS LOAD-BEARING. Revision 2 omitted it and the bug SURVIVED.
> Revision 2 wrote the stamp without `f.raiser &&` and claimed *"the stamp can only fire where
> `v.seat` and `f.raiserSeat` are both present, which is exactly the guard's seat branch, which
> requires `f.raiser` to be set."* **Every clause after "present" was false, and the reason is the
> same one revision 1 got wrong: `tally.js:96` has THREE branches and revision 2 analysed the inner
> ternary a second time.** The outer `f.raiser ? … : votes` skips the filter entirely, so `peers` can
> hold seat-carrying votes with the seat branch never running. Measured through the **real CLI
> handler**:
> ```json
> findings:      [{ "id":"F1","severity":"major","claim":"c","raiserSeat":"deepseek#1" }]
> adjudications: [{ "findingId":"F1","verdict":"agree","seat":"deepseek#2" }]
> ⇒ "tier":"Confirmed", "basis":{"a":1,…}, "sameModelCorroboration":true    exit 0
> ```
> Sharper, and it also refutes the semantic claim: with a single vote carrying
> `seat:'deepseek#1'` — **the raiser's own seat** — the stamp fires and the vote counts as its own
> peer. Add `raiser`/`judge` back to the same document and it correctly returns `a=0 Singleton`,
> stamp absent.
> `f.raiser &&` also closes §1.5's separate hole: `mcp-tools.js`'s `z.string()` **accepts `''`**, and
> `f.raiser === ''` is falsy ⇒ outer else ⇒ `'' === ''` ⇒ the stamp fired there too, reaching the
> **append-only ledger** via `mcp-server.js:1424`.

> ### ⚠️ REVISION 1'S STAMP WAS REACHABLE ON A LEGACY DOCUMENT. Two lenses broke it independently.
> Revision 1 wrote `peers.some(v => VERDICTS[v.verdict] === 'a' && v.judge === f.raiser)` and claimed
> it was *"structurally unreachable on every unique-alias bench and every legacy input."*
> **`tally.js:96` has THREE branches, not two.** The claim analysed the inner ternary; the **outer**
> `f.raiser ? … : votes` skips the filter entirely, and there `v.judge === f.raiser` is
> `undefined === undefined` ⇒ **TRUE** for any adjudication with no `judge` key (`tally.js:89` writes
> `judge: adj.judge`). Measured:
> ```js
> findings:      [{ id:'F1', severity:'major', claim:'c' }]        // no raiser
> adjudications: [{ findingId:'F1', verdict:'agree' }]              // no judge
> ⇒ sameModelCorroboration: true, on tally AND verdict
> ```
> Reachable through `cli-handlers-council.js:24` (raw `JSON.parse`, **no schema**), and an unset
> raiser is a designed-for state (`tally.js:93-95`). The artifact claimed same-model corroboration on
> a document that names no models.
>
> **The ACHIEVABLE property, stated as §8.5 requires — and this is its THIRD spelling, so verify it
> rather than trusting it:** *the stamp is unreachable unless a raiser is **named** (truthy `f.raiser`,
> which `''` is not) **and** a vote and its finding **both** carry seat ids.* Each of the three
> conjuncts is asserted in the expression itself; none is inferred from a branch.

**Why the stamp is correct without a seat table:** `peers` has already excluded the raiser **by
seat**, so any surviving peer whose **alias** equals the raiser's is a *different seat of the same
model*. That is exactly R8's signal. ⚠️ **True on every engine-produced document, and falsifiable on
hand-assembled input** — `raiserSeat:'qwen#1'` with a vote `{judge:'deepseek', seat:'gemini#9'}` and
`raiser:'deepseek'` fires the stamp across three unrelated aliases. Engine-unreachable (`buildSeats`
guarantees `seat.alias === alias`); stated so the sentence is not read as universal.

> ### ✅ THE STAMP PROPERTY IS NOW CONFIRMED BY MEASUREMENT, not by argument
> 30 documents through the real `tally()`: **every** truthy `f.raiser` fires (`true`, `1`, `'0'`,
> `0.5`, `[]`, `{}`, `[1]`, `'false'`, `' '`); **every** falsy one does not (`NaN`, `0`, `''`, `null`,
> `undefined`, `false`); non-string seats behave as identity (same reference ⇒ excluded, distinct ⇒
> admitted); unknown verdict strings never fire. Additionally, **dropping `v.seat &&` and dropping
> `f.raiserSeat &&` are equivalent mutants** — the guarded filter already makes both conjuncts
> unreachable-if-false — so the property is enforced twice and cannot be broken by dropping either.

> ⚠️ **NAMED LIMIT, and it cuts BOTH ways — this goes in the plan, the CHANGELOG and the schema description.**
> - **False negative:** `--models gpt-5,openai/gpt-5` is genuinely one model under two aliases, and the
>   stamp does **not** fire, because votes carry no `resolvedModel`.
> - **False positive:** a **split alias** — one alias whose two seats resolved to different
>   executables — fires it falsely. Measured on one run: the tally stamps
>   `sameModelCorroboration: true` while PR4b's ledger writes two rows,
>   `resolvedModel: openrouter/deepseek-chat` and `deepinfra/deepseek-v3`. **This is the exact case
>   PR4b was rewritten for** (`CHANGELOG.md:13`, pinned `ledger.test.js:741` T11). The false negative
>   omits a warning; the false positive tells a reader to **discount a genuinely independent
>   cross-executable corroboration.**
>
> So PR4c's tally labels same-**alias** corroboration while PR4b's ledger treats
> `(alias, resolvedModel)` as identity. **The two documents use different notions of "same model" and
> this release says so rather than pretending otherwise.**

**`src/mcp-tools.js` (R4c-5) — widen PERMISSIVELY.**

```js
seats: z.array(z.any()).nullable().optional(),     // meta
raiserSeat: z.string().nullable().optional(),      // findings[]
seat: z.string().nullable().optional(),            // adjudications[]
```

> ⚠️ **ERRATA (council review of PR #158, finding C1 — Confirmed).** This block originally spelled
> `seats` with a bare `.optional()` while giving the other two `.nullable().optional()`, and the
> implementation followed it — **two of three**. Measured at that spelling: the MCP path fails the
> WHOLE call with `seats: Expected array, received null`, while `amicus council tally`
> (`cli-handlers-council.js:24`, raw `JSON.parse`, no schema) accepts `meta.seats: null`, `tally()`
> carries it through, and every seat-space reader treats it as absent because `Array.isArray(null)`
> is `false` — report, workspace matrix and `verdict.json` all byte-identical to omitting the key.
> That is the same silent CLI/MCP fork R4c-5 exists to close, surviving one key later, and the ⚠️
> immediately below already states the reason it is wrong. Corrected in code and pinned by two new
> T16 cases.

> ⚠️ **Revision 2 spelled these `z.array(z.record(z.any()))` and bare `.optional()`, and both were
> measured to leave a fork.** `z.record(z.any())` requires every element to be an **object**, so the
> MCP path REJECTS `seats: ["deepseek#1","deepseek#2"]`, `[null,{…}]`, `[42]` — all of which the CLI
> accepts. And bare `.optional()` REJECTS `raiserSeat: null` / `seat: null`, which the CLI accepts and
> which produce **byte-identical output to omitting the key** — `|| null` is precisely the idiom a
> hand-assembling caller writes, and §3.4 spends a whole ⚠️ block on it. `z.array(z.any())` matches
> `amicus_verdict`'s own `record: z.record(z.any())` posture: **validate the envelope, not the payload**,
> and let `tally()` be the single arbiter of shape on both paths.

> ⚠️ **Revision 1 spelled the seat rows as a strict `z.object({id, alias, role, …})`. Measured, that
> ships a LOUD fork in place of the silent one:** a partial seat table returns
> `["seats.0.role: Required"]` and **fails the whole `amicus_council_tally` call**, where today it is
> silently stripped and the tally succeeds — and the CLI path accepts the same input. The strict inner
> object also re-creates the silent-strip class the moment `buildSeats` gains a field.
> `z.array(z.record(z.any()))` is **the file's own precedent** — `mcp-tools.js:407` already declares
> `runStats` that way, and measured, a `runStats` row's `seat` key already survives because of it.

`src/mcp-tools.js` is 703 lines but **exempt** (`scripts/check-file-sizes.js:28`); the widening takes
it to ~713.

### 3.4 `verdict.json` carries both finding fields

`verdict.js:116-124` is a closed literal; add both with the **spread-conditional**, never `|| null`:

```js
        ...(f.raiserSeat ? { raiserSeat: f.raiserSeat } : {}),
        ...(f.sameModelCorroboration ? { sameModelCorroboration: true } : {}),
```

> ⚠️ **`|| null` is prohibited and the reason is measured.**
> `JSON.stringify({...f, raiserSeat: null}, null, 2).includes('"raiserSeat":')` ⇒ **true**, so
> `raiserSeat: f.raiserSeat || null` fails **both** `seat-parity-ondisk.test.js:69` and `:94`.
> Of the three sibling fields in this literal, `duplicateOf` (`:120`) and `decision` (`:122`) use
> `|| null`; **`applied` (`:123`) does not** — it is `d.applied === true`. Revision 1 said all three.

One fix covers **THREE** `buildVerdict` call paths — revision 4 said two:
1. **the engine** — ⚠️ **NOT `run-assemble.js:223`.** Task 2's extraction moved `writeVerdictFiles`
   into `src/council/run-verdict-files.js`, where `buildVerdict` is called at **`:41`**;
   `run-assemble.js` no longer references it at all. §7's "RESOLVED AS SHIPPED" block records that
   extraction, so revision 4 **contradicted itself internally** on this citation.
2. **the CLI Stage-5 rebuild** — `src/cli-handlers-council.js:198` (note: `src/`, **not** `src/council/`),
   fed by a raw `JSON.parse` at `:155` with nothing stripping.
3. **the MCP twin** — `src/mcp-server.js:1452` (`amicus_verdict`), fed by `record: z.record(z.any())`
   (`mcp-tools.js:442`) with no strip. Covered by construction (same function, no projection), but it
   is a path and revision 4 mentioned it only to argue R4c-5's tally-only scope is right.
⚠️ The findings literal is at **`:123-131`** at branch HEAD, not `:116-124` — Task 2 inserted the
`meta.seats` spread plus six comment lines above it. Re-derive before editing.

### 3.5 The H4 pin (R4c-6)

`validateFanoutModels` (`fanout-validate.js:50-117`) does `raw = parseModelsList(modelsArg)` at `:51`
and one `legs.push` per entry in the `:67` loop — **no dedupe anywhere**.

> ⚠️ **`validateFanoutModels` is `async`.** Measured: `.constructor.name === 'AsyncFunction'`, so
> `validateFanoutModels('a,a').legs` is **`undefined`** and `.length` on it throws. Revision 1 quoted
> a synchronous probe. **T15 must `await`.** Awaited: `('a,a')` ⇒ 2 legs, `('a,a,a')` ⇒ 3, both
> `{modelInput:'a', ok:true, model:'a'}`.

The ends of the chain are pinned — `parseModelsList('a/b,a/b')` at `tests/sidecar/fanout.test.js:74-76`
(inside `describe('parseModelsList')`, which opens `:70`), and the twin launcher arguments end-to-end
at `run-debate.test.js:775/780-784/795-799`. **The middle is not**, in the default rail: the only twin
call to `validateFanoutModels` is `tests/local-provider-e2e.integration.test.js:184`, and
`jest.config.js` excludes `'\\.integration\\.test\\.js$'`, so `npm test` never runs it.

It is PR4c's business because `run-launch.js:111` is `models: opts.models.join(',')` — a twin council
bench arrives there as the literal `'deepseek,deepseek'`. A dedupe would strand seat `#2` unbound and
the seat spine would report a loss caused by a layer with no seat awareness.

**Home: `describe('validateFanoutModels')`, which opens at `tests/sidecar/fanout.test.js:96`** — not
"sibling to `:74`", which revision 1 said and which is a different describe block. The file imports
from `src/sidecar/fanout` (which re-exports at `:292`), not `src/sidecar/fanout-validate`, and
already `jest.mock`s `route-launch`, `pricing` and `logger` at file scope (`:18-37`), so **no new
mocking is needed**. **Named killing mutant:** `const raw = [...new Set(parseModelsList(modelsArg))]`
at `fanout-validate.js:51` — measured to kill exactly T15 and nothing else.

### 3.6 The adjudication matrix is seat-keyed (R4c-8)

**The defect is not only the star — a twin's DISPUTE is erased.** `report.js:40` is
`byJudge[adj.judge] = adj.verdict`, alias-keyed and **last-wins**. Measured on a twin bench
(`['deepseek','deepseek']`), real `buildVerdict` → `buildReport`:

```
| Finding | Sev | Raiser | deepseek | deepseek | Tier | Decision |
| A1 | major | deepseek | ✓* | ✓* | Confirmed |  |
| B1 | minor | deepseek | ✓* | ✓* | Contested |  |
tally says: A1 a1/d0/n0 Confirmed   B1 a0/d1/n0 Contested
```

**B1's tally counted one dispute; the matrix shows two agreements, both starred.** The alias last-wins
at `:40` erased a real vote. Revision 1 described this as a star problem; it is a data-loss problem
with a star problem on top. `report.js:141`'s `(v ? SYMBOL[v] : ' ') + (j === f.raiser ? '*' : '')` is
alias-keyed too, so both columns star. **HEAD is internally consistent; revision 1 would have shipped
an artifact that is not.**

**Column provenance, traced not inferred.** `report.js:36` `judges` ← `:24` `verdict.council` ←
`verdict.js:110` `council: record.meta.models` ← `run-assemble.js:156` `models: bench.slice()` — the
bench **aliases in bench order, duplicates preserved**, plus `claude` appended at `:177` and filtered
back out at `report.js:36` when `claudeInCouncil === true`. It is deliberately **not** the union of
`adjudications[].judge`: `report.js:29-35` documents that a dead judge with zero votes must still get
a blank column, pinned at `report-claude-column.test.js:120-132`. **The seat roster must therefore
come from the seat table, never from the votes.**

`workspace/matrix-model.js:47` takes the same roster one hop earlier — `tally.meta.models` — with the
same two collapses at `:55` (`votes[adj.judge]`, last-wins) and `:80` (`isRaiser: j === f.raiser`).

**The change. ⚠️ Revision 2's edit list was wrong in four ways; three independent lenses reproduced
each. This is the corrected list.**

| file | edits |
|---|---|
| `src/council/report.js` | **(a)** `toModel`'s finding literal (`:41-45`) gains `raiser: seatSpace ? (f.raiserSeat \|\| f.raiser) : f.raiser`; **(b)** roster `:36`; **(c)** vote key `:40`. **NO star edit.** |
| `src/council/report-html.js` | **ZERO edits** — genuinely, once (a) lands. Verified: twin HTML renders `<th>deepseek#1</th><th>deepseek#2</th>`, `<sup>*</sup>` present, raiser cell `deepseek#1`, with no edit to the file |
| `src/workspace/matrix-model.js` | roster `:47`; vote key `:55`; `isRaiser` `:80`; the pair spelling at `:77`/`:87`; **and `:72`'s `raiser: pairFor(f.raiser, map)`** — see the ⚠️ below |
| `src/workspace/run-detail.js` | **ZERO edits** — the roster is `tally.meta.seats`, so the 3-arg `buildMatrixModel` signature is preserved. |
| `electron/workspace-ui/workspace-matrix.js` | **ZERO edits** (headers `:62-64`, star `:77`, tooltip `:17`, drill `:88` all read the model). |

> ### ⚠️ (a) IS THE WHOLE STAR FIX, AND REVISION 2'S STAR EDIT WAS A NO-OP
> At `report.js:141` and `report-html.js:42`, `f` is the **model** finding built by `toModel`, whose
> literal is `{id, severity, raiser, tier, basis, decision, applied, byJudge, debate}` — **there is no
> `raiserSeat` on it.** Implementing exactly the three edits revision 2 named makes the star **vanish
> entirely** on a twin bench — precisely the outcome §3.6 uses to reject the star-only alternative,
> and it contradicts this section's own `FULL SEAT-KEY | A1 | deepseek#1 | ✓* | ✓ |` row. Measured:
> ```
> revision 2's list as written : | A1 | major | gemini | ✓  | ✗ | Contested |   ← star GONE
> with (a)                     : | A1 | major | gemini | ✓* | ✗ | Contested |
> ```
> **`raiser: f.raiserSeat || f.raiser` in `toModel` is strictly better than a star edit:** it makes
> `j === f.raiser` seat-correct at `report.js:141` **and** `report-html.js:42` with **zero edits in
> either**, and it also fixes the **Raiser column** (`report.js:143`), which revision 2 left
> alias-valued so the header would read `deepseek#1` while the raiser cell read `deepseek`.
> Byte-identical on a unique bench, because `raiserSeat` is absent there.

> ### ⚠️ (b)+(c) MUST BE RE-KEYED TOGETHER, OR EVERY EXISTING TWIN VERDICT RENDERS BLANK
> Revision 2 gave the roster and the vote key **independent fallbacks**. `adjudications[].seat` shipped
> in **PR3**; `verdict.seats` is **new here**. So any twin-bench `verdict.json` already on disk from
> PR3/PR4a/PR4b has seat-keyed votes and no seat roster — the roster falls back to aliases, the votes
> key to seat ids, and **nothing intersects**:
> ```
> HEAD : | A1 | major | gemini | ✗* | ✗* | Singleton |
> rev2 : | A1 | major | gemini |    |    | Singleton |   ← EVERY VOTE GONE
> ```
> Reachable on three schema-free paths: `amicus council report <verdict.json>`
> (`cli-handlers-council.js:81`), `amicus council verdict <tally.json> --render` (`:155` — which
> **overwrites the existing report.html** with the blank matrix), and `amicus_verdict`
> (`record: z.record(z.any())`). §3.2 says absence of a seat table must never be read as "the bench was
> unique"; revision 2's §3.6 then relied on exactly that inference.
>
> **One flag decides both, and `??`/`?.` are not it** — `[].map()` is `[]`, which is not nullish, so
> `??` does not fall through and an empty table **deletes every judge column**; `seats: {}` throws
> `verdict.seats?.map is not a function` and surfaces as `cannot render report:` where HEAD renders.
> `[]` is reachable: R4c-5's zod accepts it and `verdict.js`'s `...(record.meta.seats ? …)` treats it
> as **truthy**.
> ```js
> const seatSpace = Array.isArray(verdict.seats) && verdict.seats.length > 0
>   && verdict.seats.every(s => s && typeof s.id === 'string');   // ⚠️ the third conjunct is REQUIRED
> const judges = seatSpace ? verdict.seats.map(s => s.id) : aliasJudges;
> // …and in the same object, the vote key AND the raiser — all THREE on one flag:
> byJudge[(seatSpace && adj.seat) || adj.judge] = adj.verdict;
> raiser: seatSpace ? (f.raiserSeat || f.raiser) : f.raiser,
> ```
> With `seatSpace` false the whole section reduces to HEAD, so every pre-PR4c document renders exactly
> as it does today. The workspace uses the identical flag over `tally.meta.seats`.
>
> ⚠️ **ERRATA (council review of PR #158, finding A3/B1 — raised independently by two models).**
> "The workspace uses the identical flag" was implemented as a **verbatim second copy** of the
> expression in `matrix-model.js`, which is a maintenance coupling: edit one site and the two
> renderers disagree about which space a document is in — the class §3.6 exists to remove. The
> `ledger.js:61-69` precedent (a documented copy paid for by a drift guard) was checked and **does
> not apply**: its rationale is import weight, and measured, `require('src/workspace/matrix-model')`
> already loads six first-party modules with `src/council/report.js` among them — it has imported
> `SYMBOL` from that file since v4.4 for exactly this single-source reason. Sharing costs **zero new
> require edges**, so the predicate is now `isSeatSpace`, exported from `report.js` and imported by
> `matrix-model.js`, and `tests/council/seat-matrix.test.js` gains a nine-shape table driving BOTH
> renderers against it.
>
> ⚠️⚠️ **THE WELL-FORMEDNESS CONJUNCT IS LOAD-BEARING, AND §3.3's OWN DECISION IS WHAT MAKES IT SO.**
> Revision 4's two-conjunct flag then did `.map(s => s.id)`. Measured: `seats: [null, {…}]` makes
> `buildReport` **THROW `TypeError: Cannot read properties of null`** where HEAD renders, and
> `seats: ["deepseek#1","deepseek#2"]` yields a roster of `undefined` columns with **every vote
> deleted**. Both arrive through the three schema-free `JSON.parse` entry points this section already
> enumerates — **and through R4c-5's `z.array(z.any())`, which §3.3's ⚠️ names
> `["deepseek#1","deepseek#2"]` as the exact array it chose that spelling to accept.** Two sections
> designed independently: §3.3 widened the door deliberately to close a CLI/MCP fork, and §3.6 then
> trusted what came through it. The third conjunct is identical on every case this section enumerates
> (absent, `[]`, `{}`, well-formed, unique-with-table) and falls back to alias space **whole**
> otherwise. Dropping it is a killed mutant on both renderers.
>
> ⚠️⚠️ **ONE FLAG, THREE READERS — revision 3 gated two of them and the star DIED.** Revision 3 put
> `raiser: f.raiserSeat || f.raiser` **outside** the flag. Measured, on a document with `raiserSeat`
> and no `seats`:
> ```
> HEAD : | A1 | major | deepseek   | ✓* | ✓* | Confirmed |
> rev3 : | A1 | major | deepseek#1 |  ✓ |  ✓ | Confirmed |   ← star GONE, raiser cell in seat space
> ```
> The Raiser cell renders a seat id while **every column header renders the alias** — the exact
> contradiction this section cites to reject revision 2's star edit, inverted. `report.js:168`'s
> Findings-by-tier line leaks it too. Reachable four ways: `verdict.js`'s guard is
> `record.meta.seats ?`, so `meta.seats: []` (which this section itself enumerates as reachable) gives
> `verdict.seats = []` ⇒ `seatSpace` false ⇒ raiser still re-keyed; plus the three schema-free
> `JSON.parse` entry points (`cli-handlers-council.js:24`, `:81`, `:155`); plus R4c-5's permissive zod.
> **T21 does not catch it** — its fixture is *pre*-PR4c, so it has no `raiserSeat` at all.

> ### ⚠️ THE WORKSPACE HAS THE SAME THIRD READER — `matrix-model.js:72`
> Revision 3's workspace edit list omitted `raiser: pairFor(f.raiser, map)` at `:72`, and
> `workspace-matrix.js:70` renders `display(row.raiser)`. Implementing only the four listed edits
> reproduces, verbatim, the inconsistency this section fixes on the report:
> ```
> | A1 | major | deepseek |  *  |  ✓  |        row.raiser.model="deepseek", starred header="deepseek#1"
> ```
> ⚠️ **The naive repair LEAKS in blind mode:** `pairFor(f.raiserSeat || f.raiser, map).label` is `null`
> on a twin, so blind would render `deepseek#1`. It needs the same third spelling as the columns:
> `{ model: seatSpace ? (f.raiserSeat || f.raiser) : f.raiser, label: labelFor(f.raiser, map) }`.

> ### ⚠️ THE `claude` COLUMN — the workspace and the report do NOT agree, and only one is filtered
> `report.js:36` filters `claude` out of `council` when `claudeInCouncil === true`;
> **`matrix-model.js:47` does not** — `tally.meta.models` carries `claude` (`run-assemble.js:177`) and
> HEAD renders it as a blank column. `seats[]` is **bench-only** (`seats.js:44-46`), so a seat roster
> silently **deletes** that column. Measured on a unique bench with `claudeInCouncil: true`:
> `HEAD ["gemini","gpt","claude"]` → `["gemini","gpt"]`.
> **Re-append `claude` to the workspace roster when `tally.meta.claudeInCouncil === true`**, so the
> only thing that changes on a claude run is the twin split. ⚠️ Revision 2's supporting evidence was
> **vacuous**: `tests/fixtures/council-run-complete/run.json` has **no `seats` key at all** and its
> `tally.meta` has none either, so "identical on the shipped on-disk fixture" never entered the seat path.

> ### ⚠️ BLIND MODE — revision 2's spelling has no mechanism, and does not even show seat ids
> `display(pair, blind)` (`workspace-render.js:46-49`) is `blind && pair.label ? pair.label : pair.model`,
> and `pairFor(x, map)` returns `{model: x, label}`. So "build their pair as `pairFor(seat.alias, map)`
> while the column's identity stays `seat.id`" has **no mechanism** — there is nowhere for `seat.id` to
> go. Measured, three spellings:
> ```
> pairFor(seat.alias)  [rev 2's literal text]  PLAIN deepseek | deepseek       BLIND Review A | Review A
> pairFor(seat.id)     [T19's named mutant]    PLAIN deepseek#1 | deepseek#2   BLIND deepseek#1 | deepseek#2  ← LEAKS
> {model: seat.id, label: labelFor(seat.alias, map)}   PLAIN deepseek#1 | deepseek#2   BLIND Review A | Review A  ✅
> ```
> Revision 2's form masks correctly but restores **two indistinguishable columns** — one `✓*`, one `✗`
> — which is the R4c-8 defect again. **Only the third spelling satisfies both halves**, and
> `labelFor` is **already exported** from `blind-mode.js`; add it to `matrix-model.js`'s existing
> destructure. No new file.

**Prerequisites, corrected.** The **report** half needs `verdict.seats` (§3.2), `raiserSeat` (§3.4)
**and §3.3's guarded filter** — without §3.3 a real twin run renders `| A1 | ✓* | ✗ |` against
`basis {a:0,d:0,n:0}`, so the "row agrees with basis" claim needs all three. Revision 2 named only
two. The **workspace** half takes `tally.meta.seats`, so it shares §3.2's prerequisite; revision 2's
"no prerequisite" claim was true only for the `run.seats` spelling, which costs a 4th parameter.

**Column title:** `deepseek#1` / `deepseek#2`, minted at `seats.js:67`. `report.js:136` joins
`m.judges` verbatim; `report-html.js:38` wraps in `esc()`. `seats.js:178 displayName(seat)` is the
pre-built seam that returns exactly `seat.id`.

> ### ⚠️ BYTE-IDENTITY ON A UNIQUE BENCH — PROVEN, and it is a mechanism not a coincidence
> Built in scratch copies and rendered: **5 verdicts × 2 formats, every one `===`** — av-receiver
> (3 judges, 35 findings), claude-in-council, a degraded bench where `qwen` cast no votes, a clean
> bench with 0 findings, and a debate verdict. Workspace model identical on the shipped on-disk
> fixture `tests/fixtures/council-run-complete`.
> **Defensive case also measured:** a unique bench with a `seats` table present *anyway* is still
> identical, because `s.id === s.alias` there — **the change does not depend on §3.2's guard holding.**
> Mechanism: `buildSeats` (`seats.js:67`) mints `alias#N` only when `counts.get(alias) > 1`;
> `run-assemble.js:166` and `anonymize.js:60` are both emit-when-DIFFERENT, so `adj.seat` and
> `f.raiserSeat` are **absent**; every `||` falls through to the alias and the roster falls through to
> `council`.
> **Whole-tree measurement, seat-keyed:** `521 suites passed / 7269 passed / 8 skipped / 4 snapshots
> passed`. **Nothing moves.** Both snapshot suites (`report-debate.test.js:70,:73`;
> `report-claude-column.test.js:141,:144`) snapshot the same **unique-alias** fixture
> (`tests/council/fixtures/av-receiver-input.js:20`).

> ### ⚠️⚠️ HARD PREREQUISITE — BLIND MODE LEAKS THE MODEL NAME UNDER A NAIVE RE-KEY
> This is the R4-9 hazard, now measured. `pairFor` (`src/workspace/blind-mode.js:20-30`) resolves a
> label by scanning `labelMap` **values** for an exact model match. On a twin bench the map is
> `{'Review A':'deepseek','Review B':'deepseek'}`, so `pairFor('deepseek#1', map).label === null`, and
> `display()` (`electron/workspace-ui/workspace-render.js:46-49`) is
> `blind && pair.label ? pair.label : pair.model`. Measured:
> ```
> HEAD  header BLIND: [Review A | Review A]      ← masked (collapsed, but masked)
> SEAT  header BLIND: [deepseek#1 | deepseek#2]  ← UNMASKED
> ```
> **A seat id contains its alias, so rendering a seat id in blind mode defeats blind mode.**
>
> **The rule: resolve the LABEL from the seat's ALIAS, and carry the seat's ID only as column
> identity.** `matrix-model.js:77`/`:87` build their pair as `pairFor(seat.alias, map)` while the
> column's identity stays `seat.id`. Blind mode then renders `Review A` for both twins — collapsed,
> exactly as HEAD does, and **masked**; non-blind renders `deepseek#1`/`deepseek#2`.
> **Blind mode must never render a seat id.** §5 pins it.

> ### ⚠️ THE MATRIX HAS ITS OWN ORPHAN SHAPE, and §4 enumerated none for it
> With the roster in seat space and votes keyed `(seatSpace && adj.seat) || adj.judge`, a judge whose
> **Stage-2 seat orphaned** emits no `adj.seat`, so its vote lands under a bare-alias key **no column
> reads** — silently dropped from the rendered matrix while still counting in `basis`. Measured on
> the round-1-proven asymmetric shape, with the raiser a unique alias (so `f.raiserSeat` is absent and
> the guard is a pure alias compare):
> ```
> | A1 | major | gpt | ✓ |   |  * | Contested |      basis {"a":1,"d":1,"n":0}
>                          ↑ the dispute is COUNTED and rendered NOWHERE
> ```
> HEAD at least renders it, via last-wins. This is a **new** discrepancy of the same class §3.6 exists
> to remove, on a shape §4.6 already lists for the tally. **Disclose it in §4.6 as a fourth shape**, and
> pin it — §5's T17 asserts "the rendered row agrees with `basis`", which is false here.

**Two risks measured and NOT fixed here, both pre-existing:**

1. **The judge-prose drill stays broken on a twin bench.** `artifact-guard.js:121-142` allowlists
   `judge-deepseek.md`; the engine writes `judge-deepseek-1.md`/`-2.md` (`run-stage2.js:145` via
   `seats.artifactName`, `seats.js:164-166`). At HEAD `resolveArtifactName`
   (`workspace-panels.js:41-47`) requests a file that does not exist; seat-keyed it requests one that
   *does* exist but is **not on the allowlist**, so `readRunArtifact` (`artifact-guard.js:218`) still
   refuses. **No regression, no fix** — `artifact-guard.js:128-137` already defers the allowlist
   rebuild as a hard prerequisite for PR5.
2. **The MCP tally path strips the seat keys**, so a verdict assembled through MCP renders alias-keyed
   even on a twin bench. Closed by R4c-5 in this PR; without it CLI and MCP fork here too.

> ### The star-only alternative, measured — it trades a visible contradiction for a silent one
> Keying only the star by `f.raiserSeat` is two one-line edits and needs no `verdict.seats`. Measured
> on the same twin bench:
> ```
> HEAD          | A1 | deepseek   | ✓* | ✓* | Confirmed |    | B1 | ✓* | ✓* | Contested |
> STAR-ONLY     | A1 | deepseek   | ✓  | ✓  | Confirmed |    | B1 | ✓  | ✓  | Contested |
> FULL SEAT-KEY | A1 | deepseek#1 | ✓* | ✓  | Confirmed |    | B1 | ✗  | ✓* | Contested |
> tally: A1 a1/d0/n0 Confirmed · B1 a0/d1/n0 Contested
> ```
> Star-only removes "everything starred yet Confirmed" and **installs a different contradiction**: B1
> still renders two agreements against a basis of `a0/d1`, because `report.js:40`'s last-wins erased
> the dispute. It also erases the star entirely (`'deepseek' === 'deepseek#1'` is false for both
> columns), losing true information. **Only the full re-key makes the rendered row and the basis
> agree.** Recorded because the owner ruled before this measurement existed; it confirms the ruling.

⚠️ **All twin-bench measurements in this section are SYNTHETIC** — no twin-bench run exists on disk in
this worktree (`tests/fixtures/council-run-complete` is unique-alias). They were built through the
real `buildSeats`, `tally()` and `buildVerdict` with this plan's own edits applied to scratch copies.
An end-to-end twin run is §5's job.

---

## 4. Consequences to disclose, not discover

1. **Twin-bench findings change tier — in BOTH directions.** The #137 fix is a behaviour change by
   design. Measured promotions: `Singleton → Confirmed`; `thin → solid`. **Measured demotions:**
   `Confirmed → Contested` (twin disputes, gpt agrees) and `Contested → Disputed` (twin disputes, gpt
   disputes). `basis.n` also moves (twin neutral: `{a:0,d:0,n:0}` → `{a:0,d:0,n:1}`, tier unchanged).
   Revision 1 framed this as promotion only, which let a reader conclude the ledger could only improve.
   **`Disputed` is the numerator of `ledger.js:151`'s `factErrorRate`**, aggregated into
   `lifetimeFactErrorRate` (`ledger.js:239`) and surfaced by `amicus council stats` — a permanent
   reliability **penalty** in an append-only file that is never migrated.
   **Ceiling:** on `--models deepseek,deepseek,deepseek`, ledger `confirmRate` moves **0 → 1**.
2. **The tier change alters WHAT IS PAID FOR, and can flip exit 0 → 2 with no legs launched.**
   `debate.js:161 nothingToDebate` counts `Contested + Disputed`. ⚠️ Revision 3 said "the guard only
   ever ADMITS votes"; **measured false** — on the row-10 shape `Contested {a:0,d:1}` →
   **`Singleton {a:0,d:0}`** and `Disputed {a:0,d:2}` → **`Contested {a:0,d:1}`**, so `nothingToDebate`
   can flip *true* where it was false as well as the reverse. Measured: a twin's dispute makes `nothingToDebate` **false where it was true** in three
   distinct scenarios, and `debateTargets` goes from 0 defense solos to 1 plus a re-vote judge. The
   run then launches a defense solo per raising seat, a re-vote leg per disputing seat, and up to two
   bounded repairs — **2–4 billed legs where the same run previously paid nothing**
   (`run-all-clean.test.js:181` states the zero-legs contract explicitly). It also moves findings
   *out* of the set, skipping a round HEAD ran. And on a run whose `--max-cost` ceiling is already
   reached, `run-debate-stage.js:96-107`'s `else if (worthDebating)` fires the `debate-degraded`
   channel → `run.js:266 finalize(degraded.value ? 2 : 0)`, so the run **exits 2 and writes a
   `degrades[]` entry into `verdict.json` and the report's "What was lost"** where HEAD exited 0
   silently — without launching anything.
3. **The GitHub Action promotes twin-corroborated findings to inline PR annotations.**
   `.github/workflows/council-review.yml:320` is `select(.tier == "Confirmed")` → `:339/:344` check-run
   annotations posted on the diff; `:467-468` is a top-level `### Confirmed findings` section while
   `:482-484` keeps Singleton inside a collapsed `<details>`. A finding corroborated only by its own
   twin moves from the collapsed list to a top-level section **plus an inline annotation** — the most
   externally visible surface amicus has. (The job's pass/fail gates on `overallVerdict`/`fail_on`
   `:299-303` and tolerates exit 2 `:259-261`, so consequence 2's degrade does not by itself fail it.)
4. **`sameModelCorroboration` is alias-only in BOTH directions** — §3.3's named limit. It misses
   `gpt-5,openai/gpt-5` and it **fires falsely on a split alias**, the exact bench PR4b was rewritten
   for.
5. **Row 10 is a regression against HEAD** (`raiserSeat` present, vote's alias differs but its seat
   equals the raiser's): HEAD counts it a peer, PR4c does not. **Engine-unreachable**, but real on
   hand-assembled input, and disclosed rather than hidden.
6. **Five shapes the fix does NOT close** (revision 1 listed two; revision 2 three):
   - **The raiser's own Stage-1 leg orphans** — `raiserSeat` and that seat's vote-seat vanish
     *together*, the guard falls back to the alias compare, and #137's undercount survives.
   - **A peer twin's leg orphans** — the `else` branch drops that twin's legitimate agree, **and the
     R8 stamp does not fire either**, so the corroboration is silently absent rather than merely
     unlabelled. A **deliberate safe-drop**: a seat-less `deepseek` vote cannot be distinguished from
     the raiser's own.
   - **Two orphaned twin seats collapse to ONE dead-seat row with no seat** (§3.1's ⚠️). Pre-existing;
     the stamp is inert there.
   - **A `--council` preset with a whitespace-padded member** is functionally a twin bench (two legs,
     one executable) that `buildSeats` treats as two distinct aliases. Measured on
     `['openai/gpt-5 ','openai/gpt-5']` with both seats agreeing: `basis {a:0,d:0,n:0} Singleton` —
     **the #137 undercount survives in full, silently.** `config.js:445-459 classifyCouncilMembers`
     pushes the member raw where `parseModelsList` would trim.
   - **A judge whose Stage-2 seat orphaned has its vote counted in `basis` but rendered NOWHERE** in
     the seat-keyed matrix — it keys to a bare alias no column reads (§3.6's ⚠️). HEAD renders it via
     last-wins. New with §3.6; §5's T22 pins whichever behaviour is chosen.
     > ⚠️ **Annotated 2026-08-20 (v4.8 T2.4 / PR C), not rewritten** — preserved dated record, and
     > true of its own tree. This shape is **SI-22.5**, and it is now CLOSED: ruling R3 chose to
     > render, so the vote folds into a conditional `UNATTRIBUTED` column in both consumers and
     > stays in `basis`. "§5's T22 pins whichever behaviour is chosen" was discharged by T2.4
     > **replacing** T22 shape 1's pin rather than keeping it green.
   - **The RAISER's Stage-1 seat orphans on a twin bench ⇒ the star disappears and the Raiser cell
     names no column.** `meta.seats`' guard runs over the whole seat table and is independent of
     binding, so a twin bench **always** ships a table; `raiserSeat` needs `r.seat` (`run.js:194`),
     which is null when that leg orphans. Measured, **engine path**:
     `HEAD | A1 | deepseek | ✓* | ✓* | Confirmed |` → `PR4c | A1 | deepseek |  | ✓ | Confirmed |`
     (workspace identical). §5's T22 covers only the judge's seat; **T17's "the rendered row agrees
     with `basis`" is false here.** Pin both.
7. **Two fields PR3 already ships change shape on two bench forms (R4c-9).** Moving `run.js:194` and
   `run-assemble.js:166` onto `seat.id !== seat.alias` means `findings[].raiserSeat` and
   `adjudications[].seat` **stop** being emitted on a padded-member bench and on a bench whose legs
   report no `modelInput`. That is a correction — they were being emitted where the seat id equals the
   alias, carrying no information and contradicting their own documented emit-when-different intent —
   but it is a visible change to two shipped fields. **TWO comments become stale, not one:**
   `run-assemble.js:164-165`, and **`run.js:189-192`** — whose parenthetical
   *"(`r.seat.id === r.model` on a unique-alias bench)"* names the exact operand R4c-9 replaces.
   ⚠️ Also state, rather than leave it reading as a second guard: after R4c-9, **`anonymize.js:60`'s
   second test `raiserSeat !== raiser` is provably DEAD** — for every bench `preflightSeats` admits,
   `seat.id !== seat.alias` implies `seat.id !== r.model`.
8. **Artifacts that gain keys, on twin benches only:** `meta.seats` in `tally-input.json`,
   `tally.json` and — on `--debate` runs — `tally-provisional.json`; `seats` in `verdict.json`;
   `runStats[].seat`; `findings[].raiserSeat` and `findings[].sameModelCorroboration` in
   `verdict.json`. Consumers must not read absence as "the bench was unique".
9. **The rendered matrix changes on a twin bench — and stops losing a vote (§3.6, R4c-8).** One column
   per seat, titled `deepseek#1`/`deepseek#2`; the star marks the raiser's **seat**. This *fixes* a
   pre-existing data loss — `report.js:40`'s alias last-wins silently erased a twin's dispute, so a
   finding whose tally basis was `a0/d1` rendered as two agreements. **Unique-alias benches are
   byte-identical, proven over 5 verdicts × 2 formats.** In blind mode both twin columns still read
   `Review A`, unchanged from HEAD — a seat id must never render there, because it contains the alias.
10. **The chair packet becomes internally unreconcilable on a twin bench.** `run-assemble.js:250-254`
   passes the chair only `reviews, rankings, adjudications, record.tierCounts`; `briefings-chair.js:88`
   renders `--- Review by ${r.model} ---` and `:92-93` renders `${a.findingId} — ${a.judge}:
   ${a.verdict}` — all alias-keyed. The chair is handed *"Deterministic tier counts: {Confirmed: 1}"*
   beside two `A1 — deepseek:` lines, with nothing in the packet that can reconcile them.
11. **Still broken after PR4c, filed not fixed:** street cred's last-wins rank and duplicate rows
   (`tally.js:38`, `:51`), the ledger's last-wins street-cred join (`ledger.js:104`), the ledger's
   alias-attributed findings (R4c-3), `location` stripping on the MCP tally path (§1.5), and
   `lens`/`position` being unrecoverable on non-twin benches (R4c-7).

---

## 5. Tests

**⚠️ The implementer MEASURES and records the RED/GREEN status of every test below. This plan does
not predict it.** A prior rev published a predicted table and round 2 measured three of six entries
wrong. Record the measured status in the PR body.

**⚠️ Every test that is GREEN at HEAD needs a NAMED killing mutant**, demonstrated. Do **not** blanket-
require RED-before-GREEN.

> ### ⚠️⚠️ THE SYSTEMIC GAP, FOUND BY IMPLEMENTATION — THREE CONSECUTIVE STEPS SHIPPED UNPINNED
> This plan's tests validate **units**, and its most load-bearing steps are **wiring**. Measured, three
> times in a row, each time by the implementer rather than by any of the ten review lenses:
> - **R4c-9** — reverting *either* producer (`run.js:194` → `!== r.model`, `run-assemble.js:166` →
>   `!== j.judge`) passed **164/164**, including the existing twin-bench pin.
> - **R4c-7** — the widened predicate the owner rejected was killed by exactly **1 test of 55**, and
>   only because a test was added for it during Task 2.
> - **§3.2 step 2** — deleting `seats: o.seats` from `run.js`'s `mkInput`, which ships the whole
>   feature **dead on the engine path**, passed **91 suites / 1551 tests**. Every §5 test for §3.2
>   called `buildTallyInput`/`buildVerdict` **directly**.
>
> **THE RULE, for every remaining task: for each numbered step and each owner ruling, name the test
> that goes RED when that step is REVERTED — and run the revert to prove it.** A unit test on the
> function the step edits does not do this; the step is usually the *call site*, not the function.
> When the step is engine wiring, the pin must be an on-disk end-to-end run.

> ### The single most important measurement about this suite
> A lens implemented **all of §3.1–§3.4** and ran the real suite: **521 suites / 7269 passed /
> 8 skipped / 7277 total / 0 failed — byte-identical to the HEAD baseline.** Revision 1 said the suite
> has "zero coverage of the divergence". Measured, it has **zero coverage of the entire change set**.
> `run-cost-bijection.test.js:192` was confirmed green **by running it**. Every test below is
> genuinely new.

| # | Test | Guards / named mutant |
|---|---|---|
| T1 | `tally()` — asymmetric seat, **Direction A** (finding has `raiserSeat`, vote has no `seat`, aliases match) ⇒ excluded | GUARDED vs NAIVE. Measured GREEN at HEAD+GUARDED, RED at NAIVE |
| T2 | Direction B (no `raiserSeat`, vote has `seat`) ⇒ excluded | mirror of T1; same measured result |
| T3 | Symmetric seats, aliases match, **seats differ** ⇒ **admitted** (row 8) | the #137 fix. ⚠️ Separates GUARDED from HEAD **only** — it does NOT separate GUARDED from NAIVE. T1/T2 carry that |
| T4 | `debate.js:203` — the asymmetric case at the second site | measured RED at NAIVE (dir A) **and** RED at HEAD (symmetric twins) |
| T6a/T6b | `sameModelCorroboration` fires on a twin agree; **absent, not `false`,** otherwise | T6a RED at HEAD; T6b kills the unconditional-`false` mutant. ⚠️ **"RED at HEAD *and NAIVE*" was a PREDICTION and is measured WRONG** — NAIVE admits the twin's seat-carrying vote too, so the stamp still fires and T6a is GREEN under it. Only the HEAD half holds. **Fourth instance of the published-predicted-status class this section itself forbids.** ⚠️ State which DOCUMENT each reads — revision 2 did not, which is how T6c's gap opened |
| T6c | `sameModelCorroboration` **survives into `verdict.json`** | ⚠️ **§3.4's carry-through had NO test.** Deleting `...(f.sameModelCorroboration ? … : {})` from `verdict.js` passes **all 1556** council + workspace tests, including every other §5 test. §4.8 lists it as a key `verdict.json` gains |
| T7 | The stamp is absent on a document whose votes and finding carry seat ids **that equal their aliases** — fixture **`{id:'F1', raiser:'gemini', severity:'major', claim:'c', raiserSeat:'gemini'}`** + `adjudications:[{judge:'gpt',verdict:'agree',seat:'gpt'}]` | ⚠️⚠️ **FOURTH spelling, and revision 3 broke it ITSELF.** Rev 2's fixture ("a unique-alias bench") was green because the engine emits no seat keys there. Rev 3 named a fixture — **and omitted `raiser`**, so the leading `f.raiser &&` that rev 3 added to close the R8 hole **short-circuits the whole expression and the mutant cannot fire.** Measured: stamp `undefined` under both the shipped form and the drop-conjunct mutant. **The hardening disarmed the pin written to guard it, and nobody re-measured.** |
| T7b | The stamp does **not** fire on a raiser-less, judge-less document **WITH `raiserSeat` and `adjudications[].seat` SET** | ⚠️ **restated.** Revision 2 said "seat-free", which is why it stayed green against the very defect its section is about. Named mutant: **revision 2's own stamp** (drop the leading `f.raiser &&`) ⇒ must be RED |
| T7d | The stamp does **not** fire when `raiser` and `judge` are `''` | §1.5 — `mcp-tools.js`'s `z.string()` accepts the empty string, and it reaches `appendRun`. Same mutant as T7b |
| ~~T7c~~ | ~~`gpt-5,openai/gpt-5` does not fire the stamp~~ | ❌ **DELETED — dead weight.** Across 18 mutants T7c went red under exactly one, `uncond-smc-false`, which is already T6b's; **no mutation of the shipped expression can kill T7c without also killing T7a/T7b.** §8.4 requires a named mutant per green-at-HEAD pin and this one cannot have one. The limit stays documented in §3.3 and the CHANGELOG; it is not testable |
| T8 | `expect('seats' in input.meta).toBe(false)` on a unique-alias bench | ⚠️ **the fixture must PASS `seats: buildSeats(['gemini','gpt','qwen'], null, null)`** — the existing block (`run-assemble.test.js:35-40`) passes no `seats` at all, and measured, T8 without it is GREEN against the vacuous mutant. Name **both** mutants: `seats,` and `...(seats ? …)` |
| T9 | `meta.seats` present on a twin bench and equal to `buildSeats` output | RED at HEAD |
| T9b | `meta.seats` is a **pure tail** — key order `[runId,date,runType,models,chair,claudeInCouncil,seats]` | §3.2's placement; T9 asserts only the value |
| T10 | `verdict.seats` on a twin bench; **`expect('seats' in verdict).toBe(false)`** on a unique one | ⚠️ **must use `in`** — measured, `toBeUndefined()` and a JSON check are both GREEN against an unconditional emit |
| T11a/T11c | `verdict.findings[].raiserSeat` survives; T11c kills the `|| null` idiom | T11a RED at HEAD |
| T12 | `runStats[].seat` on a twin bench for **both** producers, **and both dead-seat shapes** — seat bound ⇒ stamped; seat orphaned ⇒ **absent, one row for two seats** | ⚠️ revision 1's T12 was satisfiable on the bound path alone and gave false confidence |
| T12b | `seat` is emitted on `seat.id !== seat.alias`, **not** on the caller's `model` | §3.1's ⚠️. Mutants: `seat !== rowModel` on (a) a leg reporting no `modelInput`, (b) a padded bench alias. ⚠️ **(a) is described imprecisely above and in §3.1: `model` does NOT become `null`.** `run-launch.js:205` is `const modelInput = leg.modelInput \|\| leg.model`, so the review's `model` falls back to the leg's **resolved executable id**. The divergence is real and the test is valid, but the operands are *resolved id vs alias*, not *null vs alias* — a fixture spelling it `model: null` does not exercise the case. (§3.1's own R4c-9 table is consistent with the corrected reading: it shows the **alias** `"gemini"` being emitted as `raiserSeat`, which only happens if the compared operand is the resolved id.) Measured: the `rowModel` mutant fires on (a)+(b) **and nothing else** |
| T13a/T13b | `runStats[].seat` survives `tally()`'s allowlist into `tally.json` **and** `verdict.json` | both RED at HEAD and against the missing-allowlist mutant |
| T13c | Round-trip **key order** is identical on both sides of `tally()` | measured correct-by-luck today; `tally.test.js:180-181` pins only a row WITHOUT `seat` |
| T14 | A `superseded` row carries **no** `seat` even on a twin bench | ⚠️ needs **no** expensive fixture — `pushDeadSeatRows` is exported (`run-stage1-rows.js:111`). Confirmed **not** caught by `run-debate.test.js:844` ⇒ non-redundant. **Named mutant: `seat: seatOf.get(dead) \|\| null` (the OBJECT) on the `:57` push.** ⚠️ Revision 3 named `seat: (seatOf.get(dead) \|\| {}).id \|\| null` — **measured INERT**: that passes an id STRING, and under §3.1's object convention `'deepseek#1'.id` and `.alias` are both `undefined`, so the guard is false and nothing is emitted (164/164 pass, zero effect). It was a leftover from revision 1's id-string design that §3.1 itself replaced. **Here the stale artifact was the MUTANT, not the test** — same failure class, inverted |
| T14c | **R4c-9's two producers are pinned** — a padded-`--council`-member bench (§3.1's R4c-9 table row 2) drives both at once | ⚠️⚠️ **ADDED DURING TASK 1. Revision 3 named NO test for R4c-9, and BOTH reverts were measured invisible: `run.js` back to `!== r.model` and `run-assemble.js:166` back to `!== j.judge` each passed 164/164, including the existing twin-bench pin** — because on a twin bench `seat.id !== r.model` and `seat.id !== seat.alias` agree. An owner ruling that changes two fields PR3 already shipped would have gone in with zero coverage. **GENERALISE THIS: every remaining owner ruling must be checked for a test that can actually separate it from its revert.** |
| T14b | A **judge** row carries no `seat` on a twin bench | ⚠️ §3.1's table row was **unpinned**: `j.seat` is in scope at `run-assemble.js:188`, and adding `seat: j.seat` there passes **92 suites / 1556 tests**. `run-debate.test.js:838`'s Set is `{rebuttal,revote,superseded,repair}` — **`judge` is not in it**. Revision 2 spent a whole test on `superseded` and none on the rows whose seat is actually reachable |
| T15 | `await validateFanoutModels('a/b,a/b')` ⇒ 2 legs | ⚠️ **must `await`** (§3.5). Home: `describe('validateFanoutModels')` at `fanout.test.js:96`. Mutant: `[...new Set(...)]` at `fanout-validate.js:51` |
| T16 | **`amicus_council_tally`'s zod retains `meta.seats`, `findings[].raiserSeat`, `adjudications[].seat`** | ⚠️ **R4c-5 had ZERO tests in revision 1.** `tests/mcp-tools.test.js:663-668` pins only key *presence*; the `run-schema-debate.test.js` bullet is **ajv/JSON-schema, a different mechanism**. Measured RED at HEAD on all three. ~10 lines; the file already imports `getTools()` |
| T17 | `buildReport` on a **twin bench**: one column per seat, titled `deepseek#1`/`deepseek#2`; the star lands on the raiser's seat only; **the rendered row agrees with `basis`** | §3.6. The existing suite catches star-loss (6 tests) and column-reorder (14 tests) but has **no twin-bench case at all** — that is the only uncovered axis. Mutant: revert `:40` to `byJudge[adj.judge]` ⇒ B1 renders two agrees against `a0/d1` |
| T18 | `buildMatrixModel` on a twin bench: one cell per seat, `isRaiser` true on the raiser's seat and **false** on its twin, **AND the NON-BLIND header reads `deepseek#1`/`deepseek#2`** | §3.6, workspace half. Mutants: revert `:80` to `j === f.raiser` ⇒ both true; **and revision 2's `pairFor(seat.alias, map)` ⇒ both headers read `deepseek`**. ⚠️ Without the header half, T18 and T19 are both GREEN under revision 2's broken spelling AND the correct one |
| T19 | **Blind mode renders NO seat id on a twin bench** — both columns read `Review A` | Mutant: `pairFor(seat.id, map)` ⇒ headers render `deepseek#1`/`deepseek#2` **unmasked**, measured |
| T20 | The matrix model is unchanged when a `seats` table is present on a **unique-alias** bench — **including `claudeInCouncil: true`** | ⚠️ revision 2's first half ("byte-identical on a unique bench") is **not writable** — there is no HEAD renderer in-tree to diff against — and is already covered by the four snapshots. **This half is the new one, and it is what catches the deleted `claude` column** (it FAILED against revision 2's design) |
| T21 | A **PR3-shaped twin verdict** — `adjudications[].seat` present, `seats` absent — renders exactly as HEAD | the blank-matrix regression. Mutant: independent fallbacks for roster and vote key ⇒ every vote cell empty |
| T22 | A judge whose Stage-2 seat orphaned still has its vote **rendered** | §3.6's ⚠️ orphan gap — the vote counts in `basis` but keys to a phantom column. If the plan accepts the drop instead, this test asserts the disclosed behaviour and §4.6 gains the shape |

**Existing tests to EXTEND:**

- ⚠️ **`tests/council/seat-parity-ondisk.test.js:36` — the extension is NOT a choice of two.** Measured
  end-to-end, **both** of revision 1's offered options are **GREEN** against the vacuous-guard mutant
  §3.2 warns about, which writes a full seat table into all three artifacts on every unique-alias
  bench. The `keyUnion` option is also dead weight for the stamp mutant (its verdict half is green,
  because `verdict.js`'s own conditional hides a tally-side `false`) and it couples the suite to
  `debateScript()`'s finding mix. **Take the needle list and make it:**
  `FORBIDDEN = ['"seat":', '"raiserSeat":', '"seats":', '"sameModelCorroboration":', '__unbound-']`.
  `'"seats":'` measured **false** in all documents at HEAD and under a correct implementation ⇒ no
  false-positive risk. ✅ `'"seats":'` was added in Task 2; **`'"sameModelCorroboration":'` is §3.3's
  to add.**
  ⚠️ **THE FILE READS FOUR ARTIFACTS AND THE `--debate` RUN WRITES FIVE.** `tally-provisional.json` —
  which §3.2 itself names as a document `meta.seats` reaches — was never scanned. Fixed in Task 2; the
  read loop now covers all five and every needle applies to it.
- A **verdict-side twin of `tests/council/run-schema-debate.test.js:96-113`** — that file pins "the
  tally schema genuinely permits `seat`/`raiserSeat`" against a future tightening. **No verdict-side
  equivalent exists** (confirmed).

**Redundant — do NOT add:** revision 1's T5 (`run-debate.test.js:252-255` **already exists**, and
revision 1 listed it in both the new-test table and the must-stay-green list); T13's "absent" half
(duplicates `tally.test.js:180-181`); T12's "absent on a unique bench" half (duplicates
`seat-parity-ondisk.test.js:36`'s `'"seat":'` needle); T11b (duplicates `seat-parity-ondisk.test.js:94`).

**Must-stay-green list — revision 2's was both over- and under-inclusive; corrected by mutation:**

*The pins that actually fired* under the 18 mutants run against this design:
`run-assemble.test.js:224-229` and `seat-parity-ondisk.test.js` (the two live runStats-shape pins) ·
`tally.test.js:180-181` · `run-assemble.test.js:43-48,68` · `run-debate.test.js:252-255,844` ·
`run-all-clean.test.js:181` · `run-raiserseat-call.test.js:60-89` · `tally.test.js:100,86,91,133,148` ·
`run-debate.test.js:232,509,555`.

*Added — revision 2 omitted all of these, and §3.6 or R4c-5 edits the code they cover:*
**the 20 report/matrix tests T17's own row cites** (star-loss 6, column-reorder 14) —
`report-claude-column.test.js:89-92,94-100,102-105,107-112,120-123,125-128,130-132,141,144` ·
`report.test.js:18-21` · `report-debate.test.js:70,73` · `matrix-model.test.js:16-22,24-35,42-60,62-70,91-96`
· **`tests/mcp-tools.test.js`** (R4c-5 edits `src/mcp-tools.js`) ·
**`tests/council/run-schema-debate.test.js`** (§5 extends it) ·
**`tests/workspace/workspace-matrix.test.js`** and **`tests/workspace/matrix-drill-rejection.test.js`**
— the only regression pins for §3.6's "`workspace-matrix.js`: ZERO edits", whose **input shape** changes.

*Measured DEAD WEIGHT — carry them if you like, but do not claim they guard this change:*
`run-cost-bijection.test.js:158,186,192,206,262` and `resolved-model-threading.test.js:52-58,63,103-105`
**never fired under any of the 18 mutants**, including the runStats-shape ones.

⚠️ **An end-to-end twin test is CHEAP, not expensive.** Revision 2 deferred it as "§5's job".
Measured: `seat-parity-ondisk.test.js:48-62` (real `runCouncil` + `debateScript()` fake launchers) and
`run-raiserseat-call.test.js:60-89` (a complete twin `s1`/`s2`/`ch1` script via `launchersFromScript`)
are both reusable, and a working T17 was **~30 lines** producing real `run.json`/`tally.json`/
`verdict.json` on disk. The orphan fixture is cheaper still — `bindSeats('w', seats.slice(0,2), twoLegs)`
returns `bound: []` in **three lines**, no `runCouncil`, no disk.

---

## 6. Docs, schemas, CHANGELOG, BACKLOG

**`CHANGELOG.md` — `[Unreleased]` is `:6`→`:179`, one `### Changed` subsection at `:8`, 17 bullets.**

- **`:143-146` becomes FALSE and must be REWRITTEN, not appended to.** It says `verdict.json` gains
  "**only** `adjudications[].seat`", "has no `raiserSeat` slot", and "a reader holding just the verdict
  still cannot tell which of two same-alias seats raised a finding". PR4c negates all three. This
  paragraph is the written record of the defect PR4c fixes; leaving it ships a lie.
- **`:146-147`** — "none of these documents changes shape at all there" **stays true iff** every new
  field is emit-when-set. An always-emitted `sameModelCorroboration: false` breaks it **while passing
  `seat-parity-ondisk`** at HEAD (§5 closes that hole).
- ⚠️ **`:100-111` is falsified and revision 1 missed it.** That bullet appoints itself the authority on
  twin-bench debate cost — "up to two billed legs per duplicated pair per debate round … worst case is
  four … read this entry rather than that object when estimating what a duplicate bench costs." §4.2
  breaks the bound, because the round can newly **exist**, not merely gain legs. ("A bench whose
  aliases are all distinct launches exactly the legs it did before" stays true.)
- ⚠️ **`:136-137`** enumerates what `tally-input.json`/`tally.json` gain; PR4c adds `meta.seats`,
  `runStats[].seat` and `findings[].sameModelCorroboration`.
- **`:155-162`** — the "partial-return seat loss is recorded in `run.json` but not yet reflected in
  `verdict.json` … filed BACKLOG item for PR4" known limitation. **PR4c does not close it.** Leave it
  and say so.
- New entries: §4.1's tier change with its measured table and the 0→1 ceiling; §4.2's cost and
  exit-code change; §4.3's Action promotion; §4.4's two-way stamp limit; §4.8's artifact list;
  §4.11's still-broken list.

**`docs/council.md` — revision 1 named two passages; there are six.**

- `:575` — "including the raiser's own adjudication of its own finding — the engine excludes it
  automatically when scoring" ⇒ becomes **seat-conditional**.
- `:643` — `findings[].basis` "raiser's own vote excluded when a raiser is known" ⇒ seat-conditional.
- **`:577`** — the runStats row inventory `{model, role, wasChair, conformance, status, durationMs,
  usage, waveId?, resolvedModel?}` ⇒ needs `seat?`.
- **`:566-572`** — the `meta.*` field table ⇒ needs `meta.seats`.
- **`:717-735`** — `verdict.json`'s output-schema block and its "Key notes" ⇒ need `seats`,
  `raiserSeat`, `sameModelCorroboration`.
- **`:969`** — the shipped report legend `` `*` raiser's own vote ``, inside the
  `amicus council report --md` sample that opens at `:944`. §3.6 changes what the star means: it now
  marks the raiser's **seat**, so on a twin bench exactly one of two same-alias columns carries it.
- **`:782`** — the prose "`*` marking the raiser's own vote", same change.

Re-derive every one of these line numbers at implementation time; they moved +2 at PR4b and will move
again as this PR's own edits land.

⚠️ **Two legend dialects already exist and §3.6 will make them diverge further.**
`report.js:145` and `report-html.js:134` say *"raiser's own vote"*; `workspace-matrix.js:120` says
*"`* raiser`"*. Pick one wording and apply it to all three, or state why not.
⚠️ **Citation rot to fix in passing:** `tests/council/report-claude-column.test.js:13` cites
"docs/council.md:661" for the legend. The actual line is **969**.
The four snapshot legend lines (`report-claude-column.test.js.snap:172`/`:236`,
`report-debate.test.js.snap:172`/`:236`) pin the current wording — measured **not** to move under
§3.6 itself, but they will move if the wording is unified.

**Other docs that state the peer-exclusion rule — all become seat-conditional, and revision 1 named
none of them:**
`skills/second-opinion/COUNCIL-DESIGN.md:148` ("for a finding raised by model R, peers are all judges
except R") · `skills/second-opinion/SKILL.md:465` ("The raiser's own adjudication is excluded from the
cascade.") · `skills/second-opinion/MANUAL-ORCHESTRATION.md:145` ("the tally engine excludes it when
computing peers-only tiers") · `README.md:78` (softer — "unknowingly judging its own, so self-bias
washes out").

**In-source comments that become false:**
- ⚠️ **`debate.js:189-193`** — the in-source block saying `peerVerdicts`' filter "stays ALIAS-space on
  purpose … and belongs to PR4". §1.3 cites it as evidence; PR4c invalidates it. Revision 1 rewrote
  `ledger.js:128`'s expired forecast and left this one.
- **`ledger.js:128`** (R4c-3) — the "until PR4c" forecast expires. State that findings remain
  alias-attributed, that R4b-2's concentration stands, and that seat attribution is filed.
- ⚠️ **CITATION ROT THIS PR CREATES — measured after Task 3, and three sites are OUTSIDE the file that
  caused it.** `tally.js` grew from 144 to 180 lines, moving everything below the filter:
  - **`src/council/run-assemble.js:17`** — cites `tally.js:95` (exclusion) and `:110` (`judged`).
    Correct now: **`:110`** is the filter and **`:148`** is `judged:`. ⚠️ The `:110` citation is
    **actively misleading** — it points at the peer filter while claiming `judged`. Fix in Task 7.
  - **`src/workspace/matrix-model.js:13`** and **`tests/workspace/matrix-model.test.js:38`** — both
    cite `tally.js:106` for `tierOverride: null`; correct now **`:139`**. Both are §3.6's files ⇒ fix
    in Task 5.
  - Already fixed inside Task 3's own commit: `tests/council/tally.test.js` (`:105`→`:138`,
    `:115-134`→`:151-176`).
  - ⚠️⚠️ **ROT COMPOUNDED WITHIN THIS PR — Task 3 wrote THREE FRESH citations to an ALREADY-STALE
    line.** `verdict.js:129` (`runStats: record.runStats`) was correct at merge base `7f50d2da`,
    Task 2 moved it to `:136`, and Task 3 then authored **new** references to `:129` in
    `src/council/tally.js:170`, `tests/council/tally.test.js:9` and `tests/council/tally.test.js:270`.
    Task 4 moved it again to **`:148`**. **Task 7 must fix all three to `:148` and re-derive rather
    than copy.** Lesson for any multi-commit PR: a citation written mid-PR is not safer than one
    inherited from a plan — re-derive at the moment of writing.
  **Standing rule applied by Task 3 and worth keeping: fix comments in files your commit already
  edits; report the rest rather than widening the diff.**

**Schemas: no edit is REQUIRED** (§2 row 14, ajv-measured on every bench including twins). Document
`seats`, `findings[].raiserSeat` and `findings[].sameModelCorroboration` in both
`schemas/council-tally.schema.json` and `schemas/council-verdict.schema.json` anyway — **with §3.3's
two-way limit in the description** — and add the verdict-side openness pin (§5).

⚠️ **No docs test forces any of this.** `tests/council-reference-docs.test.js:71-75,:112-116` is
**top-level keys only** and a **loose substring** check, and `docs/council.md` already contains the
substring `seats`. Three further suites read the file: `docs-council-toc-anchors.test.js:23`,
`docs-command-coverage.test.js:106,123-124`, and `docs-anchors.test.js` — the latter via
`fs.readdirSync(docsDir)` at **`:56`** (revision 1 cited `:53-54,66,83`, which are **comments**).
**Document because it is right.**

**BACKLOG, filed with the measurements attached:** street cred's last-wins rank + duplicate rows
(`tally.js:38`, `:51`) and the ledger join (`ledger.js:104`) — R4c-2; `letterByModel`
(`anonymize.js:18/28/31/33`) as **dead code** with a live-looking collapse; `location` stripped on the
MCP tally path; the roster-padding consolidation (§2 row 16) with the note that the prior refusal was
inverted; the five orphan/unclosed shapes from §4.6; `lens`/`position` unrecoverable on non-twin benches
(R4c-7); the chair packet's alias-space adjudication list (§4.10); and **`VERDICTS[v.verdict]`
resolves INHERITED keys** — `tally.js:98-99`'s comment claims stray verdicts are skipped, but
`VERDICTS` is a plain object literal, so `verdict: 'toString'` yields
`basis["function toString() { [native code] }"] = NaN`, serialized as `null` in `tally.json` and
`verdict.json`. Reachable on the schema-free CLI path. Pre-existing, and PR4c's stamp reads the same
expression — a `Object.prototype.hasOwnProperty` guard is the fix.

---

## 7. Constraints

- **MEASURE at branch HEAD; never quote a pass count as a gate.** Baseline, measured twice
  independently: **521 suites / 7269 passed / 8 skipped / 7277 total, exit 0** (Windows; the 8 skips
  are POSIX-guarded and run on Linux CI). Assert **zero failures** and report totals.
- ⚠️ **`.test-passed` is already warmed to `7f50d2da`.** Gitignored (`.gitignore:37`), but the pre-push
  cache is warm where it was cold. **A skipped pre-push run is not a passing one.**
- **Size gate** is `['src/**/*.js','electron/**/*.js']`, `maxLines: 300`
  (`scripts/check-file-sizes.js:18-19`), counted as `wc -l` (`:52-60`). `tests/`, `scripts/`,
  `schemas/`, `docs/` are **NOT gated** — grow existing test files; do not split them.

> ### ⚠️ THE DOCUMENTATION BUDGET — revision 1 had none, and that is why it did not fit
> Measured, three ways:
> | variant | `run-assemble.js` | gate |
> |---|---|---|
> | HEAD | 269 | pass |
> | §3.1+§3.2 with only the comment §3.1 itself quotes | **277** | pass |
> | §3.1+§3.2 **documented at the file's own density** | **302** | **BLOCKED** |
> | the 302 variant **after extraction** | **280** | pass |
>
> ⚠️ **"the file's own density" was the WRONG WORD and revision 2 used it twice.** Measured
> comment-lines-per-code-line at HEAD: `run-assemble.js` **0.90**, `tally.js` 0.49, `report.js` 0.49,
> `report-html.js` 0.22, `matrix-model.js` 0.69. The +33 is **32 comment lines for 2 new code lines**
> — roughly **18×** the file's actual density. It is a *decision-documentation* budget, which is
> defensible on this PR, but call it that.
>
> **⚠️ THE DICHOTOMY WAS FALSE. The third option is the one to take: tight documentation, NO
> extraction.** It parses, lints clean, and keeps every *substantive* warning (the own-alias operand,
> the vacuous-`seats ?` hazard, R4c-7's scoping); only restatement is compressed. §3.6 does not touch
> this file.
>
> ⚠️ **This is a BUDGET TO RE-MEASURE, not a measured fact.** Two authors implementing "tight docs"
> to a standard each would defend in review got **288** and **293** — and the second had to include
> R4c-9's required disclosure, which the first did not. **Measure your own number before deciding
> whether you need an extraction.**
>
> ### ✅ RESOLVED AS SHIPPED — the extraction WAS required, and is done
> Task 1 (§3.1 + R4c-9, documented) landed `run-assemble.js` at **287**. §3.2 fully documented then
> measured **314/300**, so per this section the `writeVerdictFiles` extraction was taken rather than
> cutting documentation: new **`src/council/run-verdict-files.js`** (52 lines), re-exported from
> `run-assemble.js` on the `seats.js`/`preflightSeats` precedent, so `asm.writeVerdictFiles(...)` and
> every existing test survived untouched. **Both named consequences fired exactly as written:**
> `ledger.js:61-67`'s stated reason needed rewriting (the require graph is one hop *longer* now, not
> shorter) and `generate-docs-check.test.js` went RED on **both** `tree` and `modules`.
> ⚠️ Two figures in this section did not transfer and are corrected: `writeVerdictFiles` is at
> **`:222-250`** post-Task-1 (not `:204-232`), and "lands at 276" was measured from the un-extracted
> 302 variant — **from 287 the extraction lands at 260**, and §3.2 documented takes it to **288**.
>
> **Current, as committed:** `run-assemble.js` **288**/300 · `run-verdict-files.js` **52** ·
> `run.js` **281** · `verdict.js` **219** · `ledger.js` **278** · `tally.js` 144 ·
> `run-stage1-rows.js` 116 · `anonymize.js` 91. Remaining tasks must re-measure; `run-assemble.js`
> has **12 lines** and `run.js` **19**.
>
> **Fallback, measured, if an implementer's documentation runs longer than 288:** extract
> `writeVerdictFiles` (`run-assemble.js:204-232`, 29 lines) rather than `buildChairPacketFile`. It is
> the **only** consumer of both `require('./verdict')` (`:22`) and `require('./report')` (`:23`), so it
> removes 31 lines and lands at **276** — six better than the chair-packet extraction's **282** (the
> figure revision 2 gave as 280). Costs: `ledger.js:61-67`'s stated reason for its local
> `CONFORMANCE_RANK` copy ("run-assemble pulls verdict → report →") becomes partly false and must be
> edited. Note also that `buildChairPacketFile` has **zero test coverage** anywhere in `tests/`.
>
> ⚠️ **If any extraction is taken, it has a prerequisite:** a new file under `src/` turns
> `tests/scripts/generate-docs-check.test.js` RED with *"Stale CLAUDE.md AUTO marker(s): **tree,
> modules**"* — **both** markers, not just `modules`. Run `node scripts/generate-docs.js`; measured, it
> changes **only `CLAUDE.md`** (one tree line, one table row), because `docs/plans/` does not exist in
> this repo and `generate-docs.js:231`'s `existsSync` skips it. ⚠️ `:236` runs `git add`.
> ✅ **The five-export truncation does NOT bite** (revision 2 warned it would): `extractExports`
> (`generate-docs-helpers.js:107`) keeps the first 5 keys and `buildChairPacketFile` is already the
> **6th**, so it never appeared in the table and run-assemble's row is byte-identical after a move.
> Stale citation to fix either way: `docs/superpowers/specs/2026-08-10-…-design.md:333` cites
> `run-assemble.js:243 buildChairPacketFile`.

- **Every file, measured after a FULLY DOCUMENTED build of §3.1–§3.4 AND §3.6.** Revision 2's figures
  were the *undocumented floor plus three* for the §3.6 files and are corrected here:

| file | HEAD | rev 2 said | **measured** | spare |
|---|---|---|---|---|
| `src/council/run-assemble.js` | 269 | 280 | **288–293** (tight docs, no extraction; two authors) | 12 / **7** |
| `src/council/tally.js` | 139 | 170 | **181** | 119 |
| `src/council/verdict.js` | 212 | 225 | **227** | 73 |
| `src/council/debate.js` | 227 | 234 | **233** | 67 |
| `src/council/run.js` | 272 | 275 | **277** | 23 |
| `src/council/run-stage1-rows.js` | 111 | 116 | **115** | 185 |
| `src/council/report.js` | 220 | 224 | **240** | 60 |
| `src/council/report-html.js` | 144 | 144 | **146** | 154 |
| `src/workspace/matrix-model.js` | 94 | 97 | **109** | 191 |
| `src/workspace/run-detail.js` | 235 | +1 | **235 — no edit** | 65 |
| `electron/workspace-ui/workspace-matrix.js` | 260 | zero edits | **260 — zero edits** ✅ | 40 |
| `src/mcp-tools.js` (exempt) | 703 | 713 | **715** | — |

  **Whole tree with everything built: 273 gated files, 0 violations; eslint exit 0.**
- ⚠️ **A file revision 2 forgot: `electron/workspace-ui/workspace-render.js` is 297/300 — THREE lines
  of headroom** — and its `display()` at `:46-49` is the exact function §3.6's blind-mode rule turns
  on. It needs no edit under the chosen spelling, but nothing may grow it.
- Lint: `'no-console': 'error'` is **global** at `.eslintrc.js:16`. `npm run lint` =
  `eslint src/ electron/ tests/helpers/` (`package.json:58`).
- This worktree takes pre-commit's `--no-stash` branch (`.husky/pre-commit:23`), so `eslint --fix` may
  touch unstaged hunks. **Stage whole files.**
- Never `npm test -- <path>`; use `npx jest <pattern>`. Never pipe a gate through `| tail`. Run
  `npm test` before `git push`.
- **Do not push without asking.** Open the PR with the `council-review` label.
- ⚠️ **One mutator at a time in this worktree.** Any parallel review works from `git show HEAD:` copies
  in a scratch dir, never in place. ⚠️ A mirror that inherits the worktree's `.git` **file** lets
  `scripts/generate-docs.js` resolve back to the real repo and stage into its index — a lens hit this.
- ⚠️ **A crashed agent can leave a mutant behind.** PR4b lost both fix-pass agents to API 529s mid-run;
  one left a one-word reversal of an owner ruling in the working tree. **Read the uncommitted diff line
  by line before every commit.**

---

## 8. Standing instructions for every task review

1. **MUTATE, DON'T READ** anything this plan calls frozen. Worked example: a lens implemented all of
   §3.1–§3.4 and the full suite stayed green at 7269/7269. The suite has **zero** coverage of this
   change set; nothing here is protected by an existing test.
2. **Re-derive every user-facing claim from the source where it is WRITTEN.** Never inherit a citation
   from this plan, a recon report, or a reviewer. A citation sweep of revision 1 found **18** wrong
   against ~170 correct — including a §2 whose source document is not in the repo.
3. **A rule is not done until it is TOTAL.** Enumerate: unique bench · twin, both seats bound · twin,
   raiser's seat orphaned · twin, peer's seat orphaned · **twin, BOTH seats orphaned** · twin with
   divergent resolutions · lens twins · **a `--council` preset with a padded member** · **a leg with no
   `modelInput`** · chair-on-bench · `claude` · an alias with no joinable row · hand-assembled input
   with no seats · **hand-assembled input with no raiser and no judge** · MCP input · an alias
   appearing 3+ times · a `superseded` row on a twin bench · legacy input with neither field.
4. **A test that is GREEN at HEAD is not automatically vacuous, and a test made RED by editing its
   expectation is not automatically fixed.** §5 requires a named mutant per preservation pin — and
   revision 1 shipped two test specifications that were GREEN against the very mutants they named.
5. **State the ACHIEVABLE property, not the preservation goal.** §3.3's revision-1 claim
   ("structurally unreachable") is the worked example of getting this wrong **in the same document
   that mandates it**. The achievable property is scoped to what the expression actually tests.
6. **A FLAG IS NOT SUFFICIENT UNTIL YOU HAVE ENUMERATED EVERY READER OF THE FIELD IT PROTECTS.**
   Round 3's three Criticals were **one** root cause: a guard introduced to make two readers of a
   field agree, with a **third** reader left outside it. §3.6 gated the roster and the vote key and
   left the *raiser*; the workspace repeated it at `matrix-model.js:72`. Before declaring a flag
   sufficient, grep every site that reads the field and put each one on the flag.
7. **AFTER HARDENING AN EXPRESSION, RE-RUN THE PINS THAT GUARD IT.** The worked example is in this
   document: revision 3 added a leading `f.raiser &&` to close the R8 hole, which **short-circuited
   T7's fixture and disarmed the very test written to catch that hole** — fourth consecutive spelling
   of a test green against its own mutant. A hardening that makes a pin unreachable looks exactly like
   a pin that passes.
8. **Assume every citation here may be wrong.**
