# v4.8 PR5a — the artifact spine

**Merge base:** `266046a5` (PR4c, [#158]). **Branch:** `v48-pr5-surfaces`.
**Suite baseline at merge base:** `522 suites / 7345 passed / 8 skipped / 7353 total / 4 snapshots`, exit 0.
Size gate exit 0. Lint exit 0.

**Revision 5.** Four refutation rounds, each aimed at the previous revision's corrections:

| round | aimed at | result |
|---|---|---|
| 1 — six lenses | rev 1 | **19 CRITICAL, 29 MAJOR, 27 MINOR** |
| 2 — three lenses | rev 1's corrections | **7 CRITICAL, 9 MAJOR, 9 MINOR** — rev 2's replacement design re-created the defect it was written to kill |
| 3 — one lens | rev 3's new design | **2 CRITICAL, 7 MAJOR, 4 MINOR** — rev 3 re-created it a third time, on a plain-ASCII bench |
| 4 — one lens | rev 4's new design | **8 CRITICAL, 6 MAJOR, 3 MINOR** — and it found the marker three revisions had asserted away, which is what revision 5 is built on |

**Every finding across all three rounds was against the plan; none against the code.** Ninth
consecutive revision with that signature.

Corrections are recorded **in place** — ⛔ **REV-1/2/3 WAS WRONG** — rather than silently patched,
because the next plan should start from the errors this one made. Three transferable lessons, each
paid for:

1. **Rev 2's union was derived by reasoning about *why rev 1 failed* instead of re-running rev 1's
   own measurement against the new expression.** Failure mode #8, inside a correction block that was
   itself convicting failure mode #8.
2. **Rev 3 removed a guard citing a measurement taken against a spelling it does not ship** (§3.1.1),
   and deleted a true disclosure by reasoning about the new design in isolation instead of diffing
   against HEAD (§4).
3. **All three designs validated a rule about *names* on benches where every leg binds.** The on-disk
   namespace only collides when one does not. Any future rule about filenames in this codebase must
   be measured against an **orphaned leg**, not just a healthy run.

Written immediately before development, against merged `main` at this moment, per the standing
anti-rot ruling. Every line number was re-measured at `266046a5` by execution.

---

## 0. What this PR is, and why it is only half of PR5

### 0.1 The defect

`src/workspace/artifact-guard.js:87` builds the artifact allowlist from **`run.bench`** — alias
space. Since PR3, the engine names review/judge/rebuttal/revote files from the **seat**
(`run-launch.js:207,:234`, `run-stage2.js:145`, via `seats.js:164-166 artifactName`).

Measured on a real `runCouncil` twin, all six seat-named files on disk, `run.seats` populated:

```
engine wrote : review-gemini-1.md  review-gemini-2.md  judge-gemini-1.md  judge-gemini-2.md
allowlist has: review-gemini.md    judge-gemini.md
INTERSECTION : []   size 0
readRunArtifact('review-gemini-1.md') => {"error":"artifact not allowed: review-gemini-1.md"}
readRunArtifact('review-gemini.md')   => {"error":"not written yet: review-gemini.md"}
```

`run-detail`'s manifest reports `review-gemini.md {present:false}` and `artifactCollisions: []`, so
`workspace-app.js:185 renderBanners` raises **nothing**. `artifact-guard.js:128-137` already
discloses this and names it *"the PR5 Workspace flip (BACKLOG: Hard prerequisite for PR5)"*.

### 0.2 The defect nobody had written down

`--models "vendor/a,vendor?a,vendor/a"` passes `preflightSeats` (`seats.js:236` refuses a
post-sanitize collision only when a `#` is on one side, so two distinct aliases colliding is
**allowed by design** and handled by `~N`):

```
seat ids        : vendor/a#1 , vendor?a , vendor/a#2
engine writes   : review-vendor-a-1.md , review-vendor-a.md , review-vendor-a-2.md
allowlist has   : review-vendor-a.md , review-vendor-a~2.md
artifactsByModel: vendor/a -> review-vendor-a.md
readRunArtifact('review-vendor-a.md') => "SEATPOS2"   <-- vendor?a's review, CONTENT-verified
```

`review-vendor-a.md` physically contains **`vendor?a`'s** review. The allowlist attributes it to
**`vendor/a`**. The GUI **serves it, labelled wrong** — the RN-1 cross-match class that
`artifact-guard.js:73-119` exists to kill, re-armed by PR3's seat naming.
`CHANGELOG.md:179-186`'s bolded universal ("cannot open **any** per-seat artifact … records it
`present:false`") is falsified on **both** halves.

> A silent misattribution is worse than a refusal. Per the product principle, a correct-but-silent
> degrade fails the bar as hard as a crash.

### 0.3 The split (R5-1)

**This PR is PR5a: the artifact and terminal-record path.** PR5b is the live/DOM path, planned
separately, immediately before it is built.

⛔ **REV-1 SAID ONE ELECTRON FILE. ⛔ REV-3 SAID TWO. Measured: three.**

| file | lines | free | why |
|---|---|---|---|
| `workspace-panels.js` | 157 | 143 | `resolveArtifactName`, the drill-in join |
| `workspace-lazy.js` | 233 | **67** | the three panel loops (rev 1 omitted it from its risk table) |
| `workspace-app.js` | 278 | **22** | one banner string — `:187` says *"bench entries X and Y"* and will now sometimes name **seat ids** (§3.1.2) |

Rev 3 excluded `workspace-app.js` by its own split line and therefore had nowhere to put a fix its
own design made necessary. The line is: PR5a touches `src/**` plus exactly those three; it touches
**no** file that renders the live tick.

| | PR5a | PR5b |
|---|---|---|
| allowlist rebuild; `resolveArtifactName`; the drill-in re-vote join | ✅ | |
| `costPanel`'s dropped `seat`; judge-row `seat` | ✅ | |
| `report.js` cost rows; the R8 marker; the chair packet's R8 **signal** | ✅ | |
| the chair packet's **identity** (six surfaces) | descoped to its own PR (R5-9) | |
| `live-seats` row id, `renderSeats` key, dead-row key, `retriedAliases` | | ✅ |
| `deadSeats` per-source design; `council-legs` role; `live-normalize`; awareness payload | | ✅ |
| `labelMap` seat-keying; `assignLabels`; `labelOf`/`letterByModel` reconciliation | | ✅ |

### 0.4 Citation rot corrected at this merge base

| Cited as | Actually at `266046a5` |
|---|---|
| `run-launch.js:198` / `:217`; `run-stage2.js:84` | `:207` / `:234`; `:145` — **all shipped in PR3** |
| `run.js:203` judge map | `:229` — **already seat-keyed** |
| `artifact-guard.js:130` cites `run-debate.js:139-140` | the seat rides at `run-debate.js:151-152` (`:150` is the comment) |
| the same comment cites `run-debate-revote.js:161-163` | the seat rides at `run-debate-revote.js:169-171` |
| spec §4.5:165 cites `briefings-stage2.js:222` | that file only re-exports (`:158`); the renderer is `briefings-chair.js:88` |
| `BACKLOG.md:1898-1899` — "two off-by-one citations" | **three** sites: `:1898` (`artifact-guard.js:86`→`:87`), `:1903` (`:81-85`→`:82-86`), `:1918` (`:86`→`:87`) |
| `workspace-panels.js:25` cites `run-launch.js:92-94` for `sanitizeName` | `seats.js:20-22` |
| PR4c plan §1.4 cites `report.js:149` | `report.js:153` |
| rev 1 cited `buildChairPacketFile` at `run-assemble.js:263-276` | **`:263-277`** (`:276` is `return packet;`) |
| rev 1 attributed `matrix-model` / `report-html` to "spec §4.5" | they appear only in the train (`spec:556-558`); §4.5's report content is prose at `:151` |
| spec §4.5 `report.js` matrix / `matrix-model.js` | **shipped in PR4c (R4c-8)** |
| spec §4.5 `report-html` | **needs ZERO edits** — inherits PR4c through the neutral model |

⚠️ **Intra-PR ordering.** T1 moves `artifact-guard.js:87`, `:82-86`, `:128-137`, `:161-166`. T4 moves
`run-assemble.js:238` and everything below it, including `:269` and `buildChairPacketFile`. T5/T6
move `report.js:141`, `:153`, `:200`. **Every task re-greps its target before editing, and T8 runs
LAST and re-measures every citation it writes.** Rev 1 instructed T8 to write `artifact-guard.js:87`
into BACKLOG — a line T1 had already invalidated. That is the PR4c defect promoted from accident to
instruction.

---

## 1. Owner rulings

| # | Ruling |
|---|---|
| **R5-1** | **PR5 splits into PR5a (artifact + terminal record) and PR5b (live + DOM).** §0.3. |
| **R5-2** | **The blind lookup is seat-keyed with an explicit label-less rule — deferred to PR5b.** PR5a touches **no** `labelMap`. Consequence for T2 in §3.2: the call sites must resolve the label from `seat.alias` while carrying `seat.id` as identity, or blind mode leaks (§2.3). |
| **R5-3** | **`sameModelCorroboration` is surfaced everywhere in this rev** — `report.js` md, `report-html.js`, and the chair packet. |
| **R5-4** | **The live path gets seats threaded through, carefully** — PR5b. |
| **R5-5** | **§4.5's `~N` composition clause is WITHDRAWN.** Its conclusion survives; its justification does not (§2.1). |
| **R5-6** | **REINSTATED.** ⛔ Rev 2 withdrew it on a true measurement (`run.json` carries neither gate field) generalized into a false claim of undeliverability. `review-claude.md` ships as a **fixed artifact** (§2.2). |
| **R5-7** | **Street-cred seat-keying stays OUT** — already ruled R4c-2. Two identical rows on a twin, stated as a known limitation with the measurement attached. |
| **R5-8** | **T4 reverses PR4c's T14b pin.** `run-assemble.test.js:286-307` asserts judge rows carry no `seat`, on the rationale that `joinsLedger` excludes `judge`. That rationale was *"no consumer needs it"*; PR5a creates one. The pin is **replaced by the invariant it was proxying** — that a judge row cannot enter the ledger join — tested directly, and asserted on the **role string**, not on today's output (§2.4). |
| **R5-9** | ⛔ **REPLACED. The chair packet's IDENTITY work is DESCOPED to its own PR.** Rev 2 ruled it "moves as one space" after counting three surfaces. There are **five**, one of them inside a line rev 2 counted as handled, and closing them requires a seat-keyed `labelMap` — which **R5-2 forbids PR5a from touching**. R5-9 was unachievable inside its own plan's scope line (§2.5). **T7 keeps only the R8 corroboration signal**, which touches no identity. |
| **R5-10** | **The R8 marker goes on the TIER cell** (`Confirmed†`), not the finding row or the raiser cell. Both of those are pinned by exact-equality and regex on the one fixture that carries the flag; the tier is also what R8 semantically qualifies (§3.6). Two PR4c pins update deliberately. |
| ~~**R5-11**~~ | ⛔ **SUPERSEDED BY R5-13.** Existence-aware attribution at the manifest layer was ruled on the premise — supplied by this plan — that `run.json` carried no orphan marker. **Measured: it does** (§3.1). Round 4 broke the existence design eight ways, all of which the marker dissolves. |
| **R5-13** | **NEW — a fallback name is emitted only for an alias that ACTUALLY ORPHANED**, spelled from `run.degrades[]`'s `seat-unbound` note (`data.seat`, which is the engine's own fallback-name source), never from `seat.alias`. Scores **0/8 wrong** on the case matrix where rev 4 scores 3/8, under both readings of the settledness question. `artifactAllowlist` stays **pure**; `run-detail.js` stays a pass-through; **T2b is deleted**. |
| **R5-12** | **NEW — `review-claude.md` ships in its OWN COMMIT** (T1b), separate from the rebuild. Measured: the rebuild alone is byte-identical on all five unique/legacy shapes; R5-6 riding in the same task is what breaks all five and inverts a fourth test. Separating them keeps the byte-identity pins provable and lets a bisect tell the two effects apart. |

---

## 2. What refutation changed

### 2.1 The `~N` composition clause (R5-5)

`sanitizeName` maps `#`→`-`, so the positional suffix renders `-N` and the collision suffix is `~N`.

⛔ **REV-1 WAS WRONG** to justify the withdrawal with *"the alphabets are disjoint, mechanical
stacking is impossible."* `~` is itself outside `[a-zA-Z0-9._-]`, and `-N` names collide freely.
Driving the algorithm on a hand-built `run.json`:

```
seats [{id:'vendor/a#1'},{id:'vendor?a#1'}]
  => review-vendor-a-1.md , review-vendor-a-1~2.md      <-- STACKED
  => collisions [{"sanitized":"vendor-a-1","models":["vendor/a#1","vendor?a#1"]}]
```

`preflightSeats` refuses the *bench* forms — its error message is literally this case — but
`artifactAllowlist` has no preflight in front of it; it runs on whatever `run.json` `readRunArtifact`
parses off disk. The **conclusion** stands (a stacked name is a name nobody writes, and the manifest
reports it absent). The **reason** is replaced, and §6 gains a pin for it.

### 2.2 `review-claude.md` — R5-6 withdrawn

Three lenses measured this independently. `run-state.js:129` is the only writer of
`run.json.options` and emits a fixed four-key projection; `claudeInCouncil` is set only on tally/
verdict `meta` (`run-assemble.js:178`).

```
initCouncilRun with claudeReviewFile set =>
  run.json keys: … options, pid, runId, schemaVersion, seats, stages, status, type, usage
  has claudeInCouncil: false     has claudeReviewFile: false
  options = {"timeout":…,"maxCost":…,"gateway":"auto","outDir":"…"}
census over 15 readable run.json: {claudeInCouncil:0, claudeReviewFile:0, optionsClaudeReviewFile:0}
```

⛔ **REV-2 THEN OVER-CORRECTED**, generalizing a true statement about one function's *signature*
into "structurally, past or future … cannot be gated". Round 2 falsified that:

- `claudeInCouncil` **is persisted on disk** in both `tally.json` (`meta`) and `verdict.json`, and
  `run-detail.js:195-217` **already parses both**. Coverage over the dirs with a readable
  `run.json` is identical to the `labelMap` signal — the field is right there.
- `ptr.runDir` is in scope at `artifact-guard.js:181`, **37 lines above** the allowlist check at
  `:218`, so an existence gate is available inside the guard itself.
- The stated objection — "widens every run's allowlist and manifest by one row" — is **empirically
  hollow**. HEAD's manifest already ships absent fixed rows on a normal run:
  `bundle-stage2.md present=false`, `chair-packet.md present=false`,
  `chair-output.md present=false`, `tally-input.json present=false`.

**R5-6 is reinstated** and ships the simplest working form: `review-claude.md` joins
`FIXED_ARTIFACTS`. One line, no gate, no new input to `artifactAllowlist`, and the presence manifest
already tells the truth about absent fixed names. The legacy byte-identity pins compare *derived*
names for a bench; a new fixed row is disclosed in §4 and its test updated deliberately.

### 2.3 T2 as specified UNMASKS blind mode

⛔ **REV-1 WAS WRONG.** Its call-site section said only "ES5 `var`, no `#NNN` in comments". Measured with the real
`buildNamePairs` and the real `display()` on a real twin run:

```
run.labelMap : {"Review A":"gemini","Review B":"gemini"}      labelByModel : {"gemini":"Review B"}
BLIND=true  HEAD    review titles : ["Review B","Review B"]        <-- collapsed, but MASKED
BLIND=true  REV-1 T2 review titles: ["gemini#1","gemini#2"]        <-- UNMASKED. Leak.
labelOf(seat id) : [null,null]
```

`display()` is `blind && pair.label ? pair.label : (pair.model || '—')` — a seat id contains its
alias, so rendering one defeats blind mode. This is verbatim the hazard `matrix-model.js:66-76`
already solved. **The rule for T2: carry `seat.id` as identity, resolve the label from
`seat.alias`.** No `labelMap` change (R5-2 stands); the split is done at the call site.

> ⚠️ **Citation annotated 2026-08-20 (v4.8 T2.4), not renumbered** — this file is preserved dated
> record. `matrix-model.js:66-76` was true when written and through `ed5c0c02`; T2.4 grew the file
> and at `e5376399` that range is the `@returns` docblock and the function signature. The
> blind-mode hazard block itself is unmoved in substance and now lives inside
> `src/workspace/matrix-model.js :: buildMatrixModel`. ⚠️ This citation is the **verbatim twin** of
> one that was fixed in `tests/workspace/seat-panels.test.js` during T-C2 — a per-file sweep could
> not have found it, which is why the rule is to grep the distinctive phrase repo-wide.

### 2.4 T4 reverses a merged pin (R5-8)

`run-assemble.test.js:286-307`, PR4c, verbatim rationale:

> `joinsLedger` (ledger.js:49-53) excludes role `judge`, so a judge row can never win the ledger
> join and must not be stamped. `j.seat` IS in scope at the judge push, which is exactly why this
> needs a pin rather than a note

Verified: `LEDGER_JOIN_ROLES = Set(['seat','critic','chair','claude','council','redteam'])` —
`'judge'` absent, so `joinsLedger('judge')` is `false`. So stamping is **safe**, and the pin asserted *absence*
as a proxy for *unreachability*. PR5a's cost table needs the stamp, so the proxy is replaced by the
real invariant, which is the stronger test.

⛔ **REV-2 GOT THE POLARITY WRONG.** `joinsLedger` is **fail-OPEN**, not fail-closed, and
`ledger.js:39-48` documents that deliberately (*"the ABSENCE of a role … joins too"*):

```
"judge" -> false   "rebuttal"/"revote"/"superseded"/"repair" -> false
null    -> true    undefined -> true          <-- FAIL-OPEN
```

The reversal is still safe — `'judge'` is an explicit non-member — but the replacement pin must
assert on the **role string**, not on today's output, or it will not catch a refactor that drops or
renames `role`. A second, independent reason the stamp is inert, which strengthens the pin:
`buildLedgerRows`' `rows.push({...})` projects **no `seat` key at all**.

**T4 is the ONE currently-green test that inverts by design.** Measured, T4 alone, full suite:

```
Test Suites: 1 failed, 520 passed     Tests: 1 failed, 8 skipped, 7335 passed
FAIL tests/council/run-assemble.test.js
  ● v4.8 PR4c T14b: judge rows carry NO seat, even on a twin bench
```

⚠️ **Two more invert for other reasons** — see §3.6 (R5-10, the two `seat-matrix.test.js` R8-marker
pins) and §4.2 (`generate-docs-check.test.js`, from the new module). Rev 2's "exactly ONE" counted
only this one.

### 2.5 The chair packet's identity work is DESCOPED (R5-9, replaced)

⛔ **REV-1 WAS WRONG** to move one identity surface and leave the others. ⛔ **REV-2 WAS WRONG** to
answer that by ruling "it moves as ONE space" — it counted three surfaces where there are **five**,
and one of the misses is *inside a line it counted as handled*:

```
briefings-chair.js:88   `--- Review by ${r.model} ---`                      surface 1
briefings-chair.js:90   `${r.judge}: …`                                     surface 2  (the KEY)
briefings-chair.js:90   `… ${JSON.stringify(r.order)}`                      surface 3  (the VALUES)
briefings-chair.js:93   `${a.findingId} — ${a.judge}: ${a.verdict}`         surface 4
briefings-debate.js:166 `Re-vote changes: ${j}: ${prior[j]} → ${revotes[j]}` surface 5
run-assemble.js:270     the `claude` review block (`model: 'claude'`)       surface 6
```

⚠️ **ANNOTATION 2026-08-23 — surfaces 1–4 are CLOSED; 5 and 6 are not, and 6 never will be.** Left
as PR5a's own record; the disposition below is the current state, not a rewrite of the block above.
- **Surfaces 1, 2, 3, 4** — closed by `SI-25` (`f7fe180d` + `0c06bca9` + `95ee5520`, ruling
  **R25-1**, all three rendering sites in one PR). Surface 3, the rankings VALUES — *"the one that
  kills R5-9"* — is now a per-slot, tie-aware, null-safe zip in `briefings-chair.js ::
  seatKeyedOrder`, because `orderSeats` legitimately carries `null`s and may be short or absent, so
  it is not a drop-in for `order`.
- **Surface 5 — untouched by SI-25, and it did not need to be.** It is
  `briefings-debate.js :: buildDebateAddendum`'s `Re-vote changes:` line (`:166` at 2026-08-23 too;
  read it by symbol). Per the measurement at *"rev 2's premise was false"* below, it **already
  rendered seat ids** — it is the surface that made the `--debate` twin packet internally
  inconsistent in the first place. ⚠️ Which means the sentence *"HEAD's `--debate` twin packet is
  **already** internally inconsistent, on the leg that costs money"* below is now **history, not
  current state**: SI-25 moved surfaces 1–4 into the space surface 5 was already in, so the
  inconsistency that paragraph measures is what SI-25 closed. Nothing to do here.
- **Surface 6 — deliberately unchanged and NOT a defect.** The Claude review is concatenated as
  `{ model: 'claude', text }` with **no seat at all**, and `SI-25` keeps it rendering as `claude`
  through the `|| r.model` fallback — that fallback is load-bearing, pinned, and the mutant
  `SEATONLY` (which drops it) reds 4 suites / 12 tests.
- ⚠️ The prose above the block says *"three surfaces where there are **five**"* while the block
  itself lists **six**. Pre-existing, unresolved, and untouched by SI-25 — flagged so a later reader
  does not take either count as authoritative without recounting.

**Surface 3 is the one that kills R5-9.** `r.order` is produced by `rankingToOrder(parsed.ranking,
labels.labelMap)` (`run-stage2.js:202`) and is **alias-valued by construction**. Driving the real
`buildChairPacket` with rev 2's T7 applied exactly as written:

```
--- Review by gemini#1 ---              --- Review by gemini#2 ---
gemini#1: ["gemini","gemini"]           gemini#2: ["gemini","gemini"]
```

The chair is instructed to *"weigh each reviewer's standing by **rank position**"* (`:64-65`) — and
after rev 2's T7 the rank positions still name no seat. **Moving them requires `labelMap` to become
seat-keyed, which R5-2 explicitly forbids PR5a from touching.** R5-9 was unachievable inside its own
plan's scope line.

⛔ **And rev 2's premise was false.** It asserted "HEAD is collapsed but internally consistent."
Measured on a real `--debate` twin's `chair-packet.md`, surface 5 **already renders seat ids**:

```
--- Review by gemini ---   (x2, ALIAS)      gemini: ["gemini","gemini"]   (x2, ALIAS)
--- Debate round outcomes ---
  Re-vote changes: gemini#2: dispute → agree; gemini#1: agree → dispute    <-- SEAT
```

HEAD's `--debate` twin packet is **already** internally inconsistent, on the leg that costs money.

**Ruling: the chair packet's identity work descopes to its own PR**, with all six surfaces and this
measurement attached. **T7 keeps only the R8 corroboration signal**, which touches no identity and
is what R5-3 asked for. A half-move is worse than the collapse, and PR5a cannot afford the whole
move without violating R5-2.

⛔ Rev 2 also mis-scoped the fix it did propose: it said `rankings` "need one line at
`run-assemble.js:216`, where `j.seat` is in scope". `j.seat` **is** in scope there (verified), but
`run-assemble.test.js:195` is a **merged PR3 pin** — *"rankings (street-cred) stay alias-valued —
unchanged by seat"* — that the change directly contradicts, and rev 2 never found it.

⛔ **And rev 1's §4.5 invariant was an ASSERTED PROPERTY, broken by measurement.** It claimed
"unique benches unchanged (seat id === alias)". The title renders `r.model` = `m.modelInput` =
`leg.modelInput || leg.model` (`run-stages.js:264`, `run-launch.js:205`) — **not** the alias:

```
leg reports NO modelInput, bench ['gemini','gpt'], id===alias on every seat: true
  TODAY "--- Review by google/gemini-2.5-pro ---"  ->  REV-1 "--- Review by gemini ---"   CHANGES
padded --council member, bench [' gemini','gpt'],  id===alias on every seat: true
  TODAY "--- Review by gemini ---"  ->  REV-1 "--- Review by  gemini ---"   CHANGES (double space!)
```

Both are the two divergences `run-assemble.js:84-88` (R4c-9) already names in shipped prose. The
guard that fixes it is the predicate the other four producers share — title from the seat only when
`seat.id !== seat.alias` — and it was **verified byte-identical in both counterexamples**. It is
**carried to the descoped PR, not applied here**, because it fixes surface 1 of six.

⚠️ **FOLLOW-UP 2026-08-23 — the descoped PR is `SI-25`, and the guard DID ship there, but the carry
did not work.** SI-25's own plan prescribed surface 1 as an **unconditional** seat forward
(`displayName(r.seat) || r.model` with `seat` always projected) — i.e. exactly the REV-1 shape this
paragraph had already measured as breaking byte identity, with both counterexamples on record here
since 2026-08-14. The implementer re-derived the same mechanism from
`run-launch.js :: materializeReviews` during the task and the deviation was accepted (ruling P2);
the emit-when-DIFFERENT predicate now lives at `run-assemble.js :: buildChairPacketFile`'s reviews
projection, and the named mutant **`SEATALWAYS`** — which reverts it to the plan's prescription —
reds exactly 1 test out of 7914, where before SI-25 it would have red **zero**. ⚠️ **The lesson is
about the carry, not the code:** a measured counterexample written into a descoping ruling is only
carried if the receiving plan quotes it. This one was two files away and the plan cited this
document for other things.

⚠️ And even the guard's *fallback* arm is not the alias: on `['gemini','gemini','gpt']` where the
third leg reports no `modelInput`, the guarded title for the `gpt` seat is
`openai/gpt-5-2025-08-07` — neither seat id nor alias, a **third** space in one packet. The descoped
PR inherits that, fully measured, rather than discovering it.

### 2.6 The two currently-green allowlist tests do NOT invert

⛔ **REV-1 WAS WRONG**, and so was the recon memo it inherited this from. Both fixtures are
`artifactAllowlist({ bench: ['gemini','gemini'] })` with **no `seats` key**, so §3.1's own predicate
sends them down the legacy branch. Measured against a working T1:

```
:91-95   'duplicate bench entries do not produce duplicate rows'  -> STILL PASSES
:119-122 'genuinely identical bench entries ... not a collision'  -> STILL PASSES
```

They stay green and **must** — they are the executable form of §6's legacy-parity case. Rev 1's
instruction to rewrite them would have **deleted the alias-path coverage the same plan mandates**.
The correct instruction is to **add** seat-bearing twin fixtures.

---

## 3. The design

### 3.1 A fallback name exists only where a leg ORPHANED — R5-13

Four designs were refuted here. The first three all died the same way, and round 3 named it:

> a rule about *names* was validated on benches where every leg binds, and the on-disk namespace
> only collides when one does not.

⛔ **REV-1 (substitute seats for aliases)** took a landed orphan review off the allowlist, no banner.
The engine writes **seat-when-bound, alias-otherwise** (`run-launch.js:207`, `run-stage2.js:145`,
`run-launch.js:234`), and `stage1-bind.js:35` says so: *"an orphan leg is a review that LANDED —
materializeReviews writes it under its **alias** name — for a seat we cannot name."*

⛔ **REV-2 (flat union)** re-admitted the bare alias as a competing entity. `sort()` gave the bare
name to the alias that writes nothing and handed the seat that wrote the file a phantom `~2` —
§0.2's misattribution intact **and** a readable artifact lost, simultaneously. It also fabricated a
banner on `['a','a','a-1','a-1']`, where all four artifacts are distinct.

⛔ **REV-3 (primary attributes, fallback merely reachable)** deduped a fallback that equalled *a
different seat's* primary, erasing the evidence that two seats claim one filename. On a real run of
`['a','a','a-1','a-1']` with one orphan it served the orphan's bytes under `a#1`, `collisions:
undefined`, banner `""`.

⛔ **REV-4 (existence-aware settling at the manifest layer)** was broken **eight** ways. The three
that matter: a healthy `--debate` twin **raised a spurious run-integrity banner** (rebuttal/revote
primaries never exist on a run with no disputes, so both twins stayed unsettled and contested one
name); a merely-**dead** twin seat banners a clean run, because "primary absent" cannot distinguish
*"orphaned under its alias"* from *"produced nothing"*; and mid-flight, **every unique bench's
reviews panel went blank** — `getRunDetail` is reachable on a running run via
`cli-handlers-council-run.js:227`'s own `amicus watch <id> --ui` hint.

#### The marker the first four designs assumed away

⛔ **REV-3 AND REV-4 BOTH ASSERTED** that *"`run.json` carries no marker distinguishing them"*.
Measured — it does, for exactly the question that matters:

```
stage-1 orphan        degrades=1  orphan-aliases=["a-1"]  missing-seats=[]
stage-2 orphan        degrades=1  orphan-aliases=["a-1"]  missing-seats=[]
dead seat, no orphan  degrades=0  orphan-aliases=[]       missing-seats=[]
clean twin run        degrades=0  orphan-aliases=[]       missing-seats=[]
```

`run.degrades[]` (persisted by `run-degrade.js:36`) carries `channel: 'seat-unbound'` with
`data.legId` present **iff** a leg orphaned — and `data.seat = leg.modelInput || leg.model`, which is
**the engine's own fallback-name source** (`run-launch.js:205`). Not a proxy for it. The same string.

#### The rule

**A fallback name is emitted only for an alias that actually orphaned, and its spelling comes from
the orphan note, not from `seat.alias`.**

```js
const orphans = (run.degrades || [])
  .filter(d => d && d.channel === 'seat-unbound' && d.data && d.data.legId)
  .map(d => d.data.seat)
  .filter(s => typeof s === 'string' && s);
```

- **PRIMARY** per entity — `artifactName(seat, kind)` with a seat table, else
  `${kind}-${sanitizeName(alias)}.md` over `[...new Set(bench)]`. Collision detection, `~N` and the
  attribution map operate on **primaries only**.
- **FALLBACK** per orphan note — `${kind}-${sanitizeName(note.data.seat)}.md`. Listed, never
  attributed. Pushed **after** primaries so first-occurrence dedupe preserves ordering.
- A name claimed by a primary **and** by an orphan fallback is genuinely ambiguous: **listed,
  unattributed, and it raises the banner.**

Measured across the full case matrix, against both readings of the settledness question rev 4 could
not resolve:

```
rule2=self-blocks  fallback-gate=all     => 3/8 cases WRONG    <<< REV 4 AS WRITTEN
rule2=other-only   fallback-gate=all     => 2/8 cases WRONG
rule2=self-blocks  fallback-gate=orphan  => 0/8 cases WRONG
rule2=other-only   fallback-gate=orphan  => 0/8 cases WRONG
```

**The gate makes the settledness question moot** — which is why it also makes the *filesystem*
question moot.

#### What this reverses, and what it costs

⛔ **R5-11 IS SUPERSEDED (R5-13).** The owner ruled for existence-aware attribution at the manifest
layer, on the premise — supplied by this plan — that no marker existed. **The premise was false.**
With the gate:

- `artifactAllowlist(run)` **stays pure**. No `statSync`, no `claims` structure, no second producer
  of `collisions`, and **T2b is deleted**.
- `run-detail.js` **stays a pass-through**; its only change is T3's one key.
- Every rev-4 CRITICAL that came from existence-testing disappears with it: stale files from
  `--run-id` reuse (a shipped flag that `initCouncilRun` does not require to be empty, and that
  `skills/second-opinion/MODEL-NOTES.md:117` tells users to pin), 0-byte files, a directory of that
  name, a `statSync` throw, and every in-flight banner.
- **An orphan whose leg reported no `modelInput` becomes REACHABLE** — the case §3.1.2 previously
  listed as a permanent limit. The note carries `leg.model`, so the fallback name matches what
  `materializeReviews` actually wrote:
  `readRunArtifact('review-google-gemini-2.5-pro.md')` goes from `artifact not allowed` to
  `"Prose SEATPOS3."`.

**Residual, disclosed:** the note's alias gates all four kinds, so a **stage-2** orphan also emits
that alias's stage-1 fallback. Keyable off `data.waveId`'s `-s1`/`-s2` suffix; PR5a does not key it,
and the cost is one extra listed-but-absent name, never a misattribution.

#### 3.1.1 `isSeatTable`

`isSeatSpace` (`report.js:53-56`, shared) plus **non-empty ids** and **unique ids**, with the entity
list `Set`-deduped.

⛔ **REV-3 REMOVED the uniqueness conjunct** citing "duplicate ids dedupe through the entity `Set`" —
a measurement taken against a spelling it did not ship (`seatTable.map(s => s.id)`, no `Set`).
Against the shipped expression, duplicates mint `collisions: [{"sanitized":"gemini",
"models":["gemini"]}]`, whose one-element `join(' and ')` produces malformed English **and**
suppresses a real `COUNCIL_ALL_LEGS_DEAD` banner via `workspace-app.js:185`'s early return.

⚠️ **Both conjuncts are observable only on the NAME LIST** — `collisions` is `undefined` either way.
Every mutant for them asserts on the list.

⚠️ ⛔ **REV-4's "narrowed on BOTH fields" was wrong**: both conjuncts are *id* conjuncts.
`isSeatTable` never validates `alias`. Under R5-13 that no longer matters for fallbacks (they come
from the orphan note, not from `seat.alias`), but the primary path still reads `s.id` only, and the
legacy branch reads `bench`. No `alias` guard is needed; rev 3's `review-undefined.md` /
`review-null.md` outputs are unreachable once fallbacks stop reading `seat.alias`.

⚠️ **Disclosed:** `isSeatTable` fails **WHOLE**. One malformed id reverts the run to the alias branch
— measured: seat files `{"error":"artifact not allowed"}`, banner `""`, reviews panel `[]`, i.e.
byte-for-byte §0.1's failure, silently. Reachable only from a hand-edited `run.json` or a direct
`require()` caller.

#### 3.1.2 What this design does NOT deliver

- **`BACKLOG.md:1911-1921` is discharged in substance, not in letter.** It rules that a seat-built
  allowlist *"stops listing the alias-named stray"*. Under R5-13 a stray retry leg **is** an
  orphan — it emits a `seat-unbound` note — so its name is still listed, but never attributed and
  never rendered under a model. T8 records it as **partially** discharged, with the measurement.
- **⛔ Rev 3 claimed "no stray renders under a model" as a property of the allowlist.** Measured, with
  HEAD's panel loop the stray renders **twice, under the model's name**. It is a property of **T2's
  loop**, and the two must ship together.
- **The banner sentence is wrong in more than one word.** `workspace-app.js:187` says *"bench entries
  X and Y both sanitize to Z"*. A R5-13 collision is primary-vs-orphan-fallback, **not** a sanitize
  collision, and the operands can be seat ids. ⛔ Rev 3 budgeted one word; the sentence needs
  rewriting, and it must not swallow the real-failure banner it currently `return`s in front of.

### 3.2 `artifactsByModel` becomes seat-keyed — with FIVE call sites, not three (T2)

⛔ **REV-1 WAS WRONG**: *"Its only consumer is `resolveArtifactName`, whose call sites are
`workspace-lazy.js:157,:173,:192`."* Measured — five sites, two files, **and two of them are
already in seat space at HEAD**:

```
workspace-lazy.js:157,:173,:192      <- fed run.bench            (ALIAS)
workspace-panels.js:117,:118         <- fed judgePair.model      (SEAT ID, via PR4c's matrix)
```

The chain `workspace-panels.js:57 renderMatrix(…, drillIntoJudge)` → `workspace-matrix.js:88
onDrill(cell.judge, …)` → `matrix-model.js:112 judge: c.pair` → `:74 pair:{model: s.id}` means
`drillIntoJudge` receives a **seat id** whenever PR4c's `isSeatSpace` fires:

> ⚠️ **Citations annotated 2026-08-20 (v4.8 T2.4), not renumbered** — preserved dated record. Both
> `matrix-model.js:112` and `:74` were true when written and through `ed5c0c02`; T2.4 moved them
> and at `e5376399` both stated lines are comments. Both constructs still exist, inside
> `src/workspace/matrix-model.js :: buildMatrixModel`, and the chain above still holds.
> ⚠️ The `:74` here is a **bare `:NNN` continuation**, which `check-citations.js` cannot parse even
> for a `.js` target — see BACKLOG's citation-gate Mechanism C.

```
matrix judges : ["gemini#1","gemini#2"]
  resolveArtifactName("gemini#1",'judge') = judge-gemini-1.md  [map HIT: false] on disk: true allowlisted: false
```

`resolveArtifactName` is therefore **already a two-space function at HEAD**, and rev 1's RULE OF ONE
SPACE analysis was derived from an incomplete roster.

**And PR5a upgrades a silent nothing into a silent wrong answer if the drill is not fixed.**
`workspace-panels.js:108-118`:

```js
var rv = ((A.state.debate && A.state.debate.revotes) || []).find(function (r) {
  return r.judge === judgePair.model && r.id === findingId;   // revotes[].judge is ALIAS by design
});
var artifactName = rv ? resolveArtifactName(judgePair.model, 'revote')
                      : resolveArtifactName(judgePair.model, 'judge');
```

`debate.json`'s `revotes[].judge` is deliberately alias-valued (`run-debate.js:214-222`, whose
comment cites *this* call site as the reason). Today the join misses **and** the name misses, so
`if (!section) { return; }` fires and nothing renders. T1+T2 make the name resolve — so a user
drilling a re-voted dispute cell on a `--debate` twin would be shown **the original judge's prose,
highlighted as the re-vote**.

⛔ **REV-2's PRESCRIPTION WAS UNSATISFIABLE.** It said "keyed off the seat's alias against
`revotes[].judge` **plus** the seat identity" — a two-term AND. Measured: `debate.json` **already
carries `seat` beside `judge`** (`run-debate.js:225-230`), but **emit-when-different**, so on a
unique bench every row lacks it:

```
--debate twin  : [{judge:"gemini",seat:"gemini#2",id:"A1"}, {judge:"gemini",seat:"gemini#1",id:"A1"}, …]
--debate unique: [{judge:"gpt",id:"A1"}, {judge:"gemini",id:"A1"}, …]   rows WITHOUT seat: 4 of 4
```

Rev 2's conjunction is therefore **unsatisfiable on 100% of production benches** and implementing it
literally regresses the drill-in that works today. **The correct join is one term:**
`(r.seat || r.judge) === judgePair.model && r.id === findingId`.

⚠️ **One case is genuinely unfixable and is disclosed, not papered over.** When the re-vote legs
orphan, `seatKey` falls back to the alias and `revoteByJudge`'s alias key **last-wins**, so one
twin's entire re-vote set is erased *before* `debate.json` is written:

```
twin-orphan-rv: revotes[] = [{judge:"gemini"},{judge:"gemini"}]  (no seat on either)
                revote files: ["revote-bundle.md","revote-gemini.md"]   <-- one file, clobbered
```

That is upstream data loss of PR4b's class. No drill-in fix can recover it; §6 case 11 states the
limit rather than asserting the drill always lands.

Also in scope for T2:
- `workspace-panels.js:91-98` is a **live forecast comment** naming this PR (*"Closed by the PR5
  Workspace flip that rebuilds the allowlist from `run.seats`; do NOT patch it here"*). PR5a
  fulfils it; it is rewritten, not left.
- `run-detail.js:217` is a second reader of the literal key `artifactsByModel` — it decides whether
  the map may be renamed. **Grep before renaming.**
- The blind-label rule from §2.3.

### 3.3 The spec row rev 1 dropped: `run-detail.js:211-217`

Spec `:176`: *"Also entering the change set, absent from every proposal: `workspace-panels.js:41-47`
`resolveArtifactName`, **`run-detail.js:211-217`**."* Rev 1 covered the first and never mentioned the
second. `:211-217` is the `derived` block carrying `artifactCollisions` and `artifactsByModel` — the
only channel from `artifact-guard` to the renderer.

⛔ **REV-2 WAS WRONG** that T2 needs a `run-detail.js` change to reach seat data — and it
**contradicted itself three paragraphs later** in §3.7. `getRunDetail` returns the whole parsed
`run`, so `run.seats` already reaches the renderer. Proved by removing the proposed `derived.seats`
block and re-running the blind-mode and drill-in cases:

```
derived.seats REMOVED from run-detail.js
  √ blind ON: NO rendered review title contains a seat id
  √ drilling the RE-VOTED cell lands on the revote artifact, not the judge one
  Tests: 7 passed, 7 total
```

⛔ **AND REV-3 THEN OVER-CORRECTED IT** — "the only `run-detail.js` change PR5a needs is T3's one
key" was true of rev 3's design and is **false of R5-11's**. `run-detail.js:220-228` is the only
place in the tree that already knows which artifacts exist, so it is where claims are settled
(§3.1). It becomes a **producer** in this PR: T2b.

Both earlier statements were right about their own design and wrong about the shipped one. The rule
that generalizes: **a "which file does not need changing" claim expires the moment the design
changes**, and rev 3 carried rev 2's answer forward without re-deriving it.

### 3.4 The dropped seat (T3, T4)

`run-detail.js:74-80 costPanel` drops `r.seat`; `run-assemble.js:237-239` builds the judge row
without one, though `j.seat` is in scope and `:215` already uses it. Add both.

⛔ **REV-1 WAS WRONG** that T3 has a consumer in PR5a. Measured: `derived.cost.rows`' only reader is
`renderCost` (`workspace-render.js:242-259`, **297/300, PR5b side**), and T5 reads
`verdict.runStats` directly (`report.js:123`), not the cost panel. **T3 is a payload-shape change
whose renderer lands in PR5b.** It ships here because T4 and T5 make the seat available and leaving
`costPanel` alone would strand PR5b behind a `src/` change; its test is honestly a **shape pin**,
not a behaviour test, and the plan says so rather than implying a screen changes.

The chair row deliberately stays seat-less — `run-finish.js:23-33` has no seat to pass. Disclosed.

### 3.5 The cost table (T5) — and the extraction that is NOT required

`report.js:140-144` renders four indistinguishable rows on a twin. Change to `r.seat || r.model`.
Depends on T4: measured three ways — with T5 alone only the two seat rows separate.

⛔ **REV-1 WAS WRONG** that the named seam existed: `buildReport` is **five lines (`:269-273`)
containing no cost or street-cred code at all**, so extracting around it saves 4 lines.

⛔ **REV-2 WAS WRONG** to declare the extraction REQUIRED. It measured "house style 303 — over by
3". Rebuilt in house style with T5 + T6 and **no** extraction:

```
report.js WITH T5 + T6, no extraction = 294      gate 300 -> UNDER by 6
```

A 9-line swing — i.e. inside comment-writing variance. **A required-vs-optional ruling resting on a
3-line margin was never a measurement.** The extraction is therefore **optional**. If it is taken,
the seam is the symmetric one `report-html.js` precedents (extract `renderMd` + its two private
formatters into `src/council/report-md.js`, lazy-required to break the `TIER_ORDER`/`SYMBOL` cycle;
measured `report.js` **174-195** + `report-md.js` **116-125**; `renderMd` has exactly one call site
and is not exported, so zero call-site churn; two dead requires must go or lint fails).

**Default: do NOT extract.** Every new `src/**/*.js` file costs a `generate-docs` regeneration
(§4.2) and a review surface, and 294/300 needs neither.

⚠️ **T4+T5 only half-fix the table, and this is disclosed rather than discovered.** Rows built
through the real `buildRunStatsEntry` on a twin:

```
role=seat   seat=gemini#1  -> "gemini#1"          role=judge  seat=gemini#1 -> "gemini#1 (judge)"
role=repair seat=undefined -> "gemini (repair)"   <-- run-stages.js:222 / run-stage2.js:184
```

`repair`, `superseded` (`run-stage1-rows.js:56-58`) and every `debateRunStatsRows` row
(`debate.js:134-136`) pass no seat. §6 case 6's "four distinguishable rows" is satisfiable while the
table still shows duplicates elsewhere. Listed in §4.

### 3.6 The R8 stamp reaches a human (T6, T7) — R5-3

Spec §4.6:188 asserts the chair packet surfaces it and the renderers show it. **Both measured
false**; the only consumers are the producer (`tally.js:142`), the carrier (`verdict.js:142`),
schemas, prose and document-level test pins. **Renderer consumers: none.**

⛔ **REV-1 MISSED a fourth edit.** `report.js:92-100`'s neutral-model literal is **CLOSED** — it
names every key it copies off a finding:

```
toModel finding keys : ["id","severity","raiser","tier","basis","decision","applied","byJudge","debate"]
sameModelCorroboration survives toModel? -> false
```

Both renderers consume `m.findings`, so **neither can see the flag until `toModel` is amended.**
This is the identical defect PR4c hit at `verdict.js:133` — which rev 1 quoted in its own citation
table before repeating it one file downstream.

⛔ **REV-1 WAS WRONG that the legend may be unconditional.** Written that way, a unique-alias
verdict diverges from HEAD at the legend line and every subsequent line shifts — breaking byte
identity on **every** run and reddening the existing pins and all four snapshots. **Gated** behind
the `m.findings.some(...)` idiom this file already uses three times: `HEAD.buildReport ===
NEW.buildReport` on a unique verdict returns **true**. Cost +2 lines.

#### Where the marker goes (R5-10)

⛔ **REV-1 AND REV-2 BOTH FAILED TO SPECIFY PLACEMENT**, and both natural placements are pinned by
the one fixture that carries the flag. `seat-matrix.test.js` probes `A1 -> false, B1 -> true`, and:

- `:121` is an **exact-equality** pin: `'| B1 | major | gemini#2 | ✓ | ✓* | Confirmed |  |'`
- `:149` matches the HTML row by regex `/<tr[^>]*><td>B1<\/td>.*?<\/tr>/`

**The marker goes on the TIER cell** — `Confirmed†` — because that is what R8 semantically
qualifies: the tier's implicit claim of independent corroboration. Both pins update **deliberately**
and are listed in §4, not discovered at gate time.

The legend line is **gated** behind `m.findings.some(f => f.sameModelCorroboration)`, per the
correction above.

#### The chair packet (T7) — corroboration only

Per **R5-9 (replaced)**, the identity work descopes. T7 ships **only** the R8 signal.

⛔ **REV-1 WAS WRONG** that `briefings-chair.js` "needs zero edits". `sameModelCorroboration` is
stamped on the **finding**, not on `tallyInput.adjudications`, so it needs a new parameter through
`buildChairPacket` (`:87`) and a render line. `briefings-chair.js` is 156 lines with 144 free; it
was simply unbudgeted.

#### The re-measurement, taken (T4 shipped)

✅ **MEASURED, not predicted.** With T4 applied, `run-assemble.js` is **293/300 — 7 lines free**
(288 before; the reversal comment was trimmed from 7 lines to 5 after the first measurement read
295). Rev 2's "303–306, extraction required" assumed T7 also carried the titles; it does not.

**7 lines is enough, and the extraction is NOT taken** — provided T7 is shaped correctly:

- **Do not thread a new parameter through `run-assemble.js`.** `buildChairPacketFile` already passes
  `record.tierCounts` into `buildChairPacket`; it passes `record.findings` too, which is where
  `sameModelCorroboration` already lives (`tally.js:142` stamps it on the finding). That is **one
  line** in `run-assemble.js`.
- **All rendering lands in `briefings-chair.js`** — 156 lines, **144 free**, the roomiest file in the
  task, and the file spec §4.6:197 names for the chair-packet wording.
  ⚠️ **Re-measured 2026-08-23: `briefings-chair.js` is 243/300, 57 free** — PR5a's T7 and then SI-25
  (which added `seatKeyedOrder` and its docblock) spent most of that headroom. Still the roomiest of
  the pair, but *"144 free"* must not be planned against.

The seam stays documented in case a later task needs it (`run-assemble.js:263-277` →
`run-chair-packet.js`, measured 275 + 53; `displayName` must leave the `./seats` destructure or
`no-unused-vars` fails lint), but PR5a does not take it, for the same `generate-docs` reason as §3.5.

### 3.7 `electron/workspace-ui/**` constraints

ES5 `var` (`no-var` is `off` **deliberately** at `.eslintrc.js:76`; `warn` is refused because
`lint-staged` runs `eslint --fix` and would rewrite silently at commit). `env: {browser:true,
node:false}` — the renderer **cannot** `require('src/…')`; seat data arrives as data, and
`getRunDetail` already returns the whole parsed `run`, so `run.seats` reaches the renderer today.
**`prefer-const` is still `error`** — harmless for `var`, fatal for a stray `let`. Never write a
`#NNN` issue reference in a comment here: `electron-token-drift.test.js:80` scans
`/#[0-9a-fA-F]{3,8}\b/`. Script load order is pinned by
`tests/workspace/helpers/script-load-order.js:22-33` against `index.html:101-118` — a new file means
editing that list.

**Environmental hazard, not this PR's:** `src/pack/pack-resolve.js` and
`src/sidecar/electron-install.js` sit at exactly **300/300**. Any one-line addition to either breaks
the whole-tree gate.

---

## 4. Disclosed consequences

1. **The twin allowlist grows.** Measured, **rebuild alone** (T1a, R5-12 keeping `review-claude.md`
   out of this commit): twin **7 → 11**, twin `+debate` **12 → 20**, unique 3-bench **11 → 11
   (byte-identical, list + `collisions` + map key order)**. T1b then adds exactly one row everywhere.
   Absent manifest rows on a debate twin go **4 → 6** — ⛔ rev 3 wrote "5 → 11", which does not
   reproduce. No consumer assumes manifest length equals bench length (verified).
2. **FOUR currently-green tests invert**, all deliberately. ⛔ Rev 1 claimed two and named the wrong
   two; ⛔ rev 2 claimed exactly one; ⛔ rev 3 claimed three and missed the one its own R5-6 caused.
   - `run-assemble.test.js:286-307` (PR4c T14b) — T4, by R5-8, replaced with the ledger-role invariant.
   - `seat-matrix.test.js:121` and `:149` — T6, by R5-10, the R8 marker on the tier cell.
   - `artifact-guard.test.js:77` *"missing/invalid bench yields fixed names only"* — **T1b only**
     (`Expected length: 5, Received length: 6`). Measured as the **single** failure in a full-suite
     run of the whole design: `1 failed, 521 passed / 7344 passed`. R5-12 is what keeps this
     attributable to its own commit.
   - `tests/scripts/generate-docs-check.test.js:31` — **only if** a new module ships. Proved by
     isolation: two *empty* files redden it (`Stale CLAUDE.md AUTO marker(s): tree, modules`). §3.5
     and §3.6 therefore default to **no extraction**; if one is taken, `node scripts/generate-docs.js`
     and committing `CLAUDE.md` is a required step, not a footnote.
3. **Three fulfilled-forecast comments are rewritten**, not edited around: `artifact-guard.js:82-86`
   and `:128-137`, and `workspace-panels.js:91-98`.
4. **The F1 bench stops raising its collision banner** — and that is a real HEAD→design flip, not a
   tautology. ⛔ Rev 3 deleted rev 2's disclosure by arguing "under this design it never raised one in
   the first place", which is trivially true of any new design. Measured against HEAD: HEAD raises
   `[{"sanitized":"vendor-a","models":["vendor/a","vendor?a"]}]`; the design does not, because every
   seat settles by primary and no name is contested. Correct in substance — and the same bench with
   **one orphaned leg** keeps its banner (§3.1), which is the case that matters.
5. **`isSeatTable` fails WHOLE and silently.** One malformed seat id reverts the entire run to the
   alias branch. Measured on a healthy twin with one empty id: seat files
   `{"error":"artifact not allowed"}`, alias file `{"error":"not written yet"}`, **banner text `""`,
   reviews panel requests `[]`** — byte-for-byte §0.1's failure, silently. Fail-safe but silent; the
   reachable cause is a hand-edited `run.json` or a direct `require()` caller.
5b. **The banner's wording changes** (`workspace-app.js:187`) — it will now sometimes name seat ids
   rather than bench entries, so the sentence is corrected. One string; the reason the split line
   moved to three electron files (§0.3).
6. **The R8 marker changes report bytes** for runs carrying the flag — twin benches only, because
   the legend is gated. Verified `HEAD.buildReport === NEW.buildReport` on a unique verdict.
7. **`review-claude.md` becomes readable** (R5-6, shipped in its own commit per R5-12) — one new
   fixed row on every run's allowlist and manifest, the same shape as the four absent fixed rows HEAD
   already ships (`bundle-stage2.md`, `chair-packet.md`, `chair-output.md`, `tally-input.json` all
   report `present=false` on a normal run). It is what breaks byte-identity and inverts
   `artifact-guard.test.js:77`, which is why it is a separate commit.
7b. **An orphan whose leg reported no `modelInput` stays unreachable.** Measured:
   `review-google-gemini-2.5-pro.md` lands on disk and is on no list, because the engine's fallback
   name comes from `leg.modelInput || leg.model` while the design's comes from `seat.alias`. Not a
   regression — HEAD cannot reach it either — but it bounds what the fallback rule delivers.
7c. **A stray retry leg no longer renders under a model** — but only once T2 lands. ⛔ Rev 3 claimed
   this as a property of the allowlist; measured with HEAD's panel loop the stray renders **twice,
   under the model's name**. The property belongs to T2's loop, and the two must ship together.
8. **The cost table is only half-fixed.** `repair`, `superseded` and debate rows still collapse on a
   twin (§3.5). Street-cred still renders two identical rows (R5-7 / R4c-2). The chair runStats row
   still carries no seat (§3.4).
9. **The chair packet's identity stays collapsed** — and on a `--debate` twin stays *internally
   inconsistent*, because the debate addendum already renders seat ids while every other surface
   renders aliases (§2.5). PR5a does not make this worse; it does not fix it either. Descoped with
   all six surfaces measured.
10. **An orphaned re-vote on a twin loses one seat's entire re-vote set upstream**, before
    `debate.json` is written (§3.2). Unfixable at the drill-in; disclosed as PR4b-class data loss.
11. **T3 has no consumer in PR5a** (§3.4) — its renderer lands in PR5b. Stated, not implied away.
12. **PR5b's defects stay live.** The seats panel still silently loses an errored twin on a reorder
    tick; the live role is still wrong for the second twin on a lens bench; blind mode still
    collapses twins to one label — `Review A` in the matrix (first-match `labelFor`) and
    `Review B` in the panels (last-wins `labelByModel`), which is itself an inconsistency PR5b owns.
    ⛔ Rev 2 stated only the `Review A` half as if it were the whole fact.
    **#137 stays open until PR6.**

---

## 5. Tasks

Every task states its **killing mutant** and its **revert check**, and runs both. Per PR4c: after
tightening any expression, re-run its pins and confirm each still FAILS its mutant.

**T0 — Baseline. ✅ DONE.** `npm test` on `v48-pr5-surfaces` before any edit, exit 0:

```
Test Suites: 522 passed, 522 total
Tests:       8 skipped, 7345 passed, 7353 total
Snapshots:   4 passed, 4 total          Time: 208.215 s
```

Identical to the merge-base figure. Every later claim is measured against **this** number, not
against §0's.

**T1a — `artifact-guard.js`: primaries, plus a fallback per ORPHAN NOTE** (§3.1, R5-13).
`isSeatTable` with **both** id conjuncts plus a `Set`-deduped entity list; collision/`~N` and the
attribution map over **primaries only**; fallback names derived from `run.degrades[]`'s
`seat-unbound` notes (`data.legId` present, name from `data.seat`), all four kinds with
`rebuttal-`/`revote-` gated on `run.debate`, pushed **after** primaries; a name claimed by a primary
**and** an orphan fallback is unattributed and enters `collisions`; rewrite `:82-86` and `:128-137`.
**No `review-claude.md` in this commit** (R5-12). Stays **pure** — no `statSync`, no `claims`
structure, no second `collisions` producer.
*Mutants:* (a) **drop the orphan gate** (emit a fallback for every `seat.alias`) → the healthy
`--debate` twin banner test and the dead-twin-seat banner test both go RED; (b) attribute the
fallback → the `['a','a','a-1','a-1']` + orphan **content** test RED; (c) entities = bench → the twin
listing test RED; (d) drop the non-empty conjunct → the `review-.md` test RED; (e) drop the
uniqueness conjunct **and** the `Set` → the one-model-banner test RED; (f) spell the fallback from
`seat.alias` instead of `note.data.seat` → the no-`modelInput` orphan reachability test RED.
⚠️ **(d) and (e) must assert on the NAME LIST, never on `collisions`** — ⛔ rev 2's mutant asserted on
`collisions`, which is `undefined` either way, so it could not fire, and ⛔ rev 3 then deleted the
conjunct on the strength of that dead mutant.
⚠️ **Every mutant must be RUN.** Round 4 found two of three named T2b mutants were **dead on the
fixtures the plan named** — one because `artifactsByModel` held only primary names, so attributing a
fallback had no consumer anywhere.
*Revert check:* reverting T1a turns the F1 content test RED.
❗ **Do NOT rewrite `artifact-guard.test.js:91-95` / `:119-122`.** They are legacy-path pins and stay
green. Add seat-bearing fixtures alongside, and add "(legacy, no seats)" to both titles, which now
under-describe what they pin.

**T1b — `review-claude.md` into `FIXED_ARTIFACTS`** (R5-6, R5-12). **Its own commit.** Update
`artifact-guard.test.js:77` in the same commit. This is the only change in the PR that breaks the
byte-identity of the allowlist on unique and legacy benches, and separating it is what keeps T1a's
five byte-identity pins provable.
*Mutant:* remove the entry → the `review-claude.md` readability test RED.

⛔ **T2b IS DELETED** (R5-13 supersedes R5-11). The orphan gate makes the settledness question moot,
so no filesystem knowledge is needed and `run-detail.js` stays a pass-through. Round 4 measured the
eight ways the existence design broke; every one of them came from testing existence.

**T2 — the five call sites, plus the banner string** (§3.2). Grep every `artifactsByModel` reader
before renaming. Seat-key the map and both files' call sites; **fix the drill-in join to the one-term
form**; apply the blind-label rule (`labelByModel[seat.alias]`, carry `seat.id`); rewrite
`workspace-panels.js:91-98`; correct `workspace-app.js:187`'s "bench entries" wording (§3.1.2).
ES5 `var`; no `#NNN`; `prefer-const` is still `error`.
⚠️ **`resolveArtifactName`'s legacy fallback arm goes from dormant to LIVE and must be neutered.**
`workspace-panels.js:41-47` falls back to `kind + '-' + sanitizeName(model) + '.md'` on a map miss.
Today an alias always hits, so the arm only serves pre-v4.5 payloads. Seat-keying makes every
alias-keyed caller miss — and because fallback names are now allowlisted and often present, the miss
resolves to a **real, wrong-seat file** instead of the honest empty state. Measured:
`resolveArtifactName("vendor?a","review") = review-vendor-a.md`, which is `vendor/a`'s primary.
**On a miss, return null.** ⛔ Rev 3 never mentioned this arm.
⚠️ **The panel loops iterate PRIMARIES, deduped by resolved name.** Measured: iterating seats drops
the orphan (allowlisted, `present:true`, never requested); iterating primaries+fallbacks renders it
but yields three sections all titled `Review B` under blind — worse than HEAD. An unattributed
fallback stays reachable but unlisted, consistent with §3.1.2 and with T2b's no-guess rule.
Measured to fit: panels 157 → **163-177**, lazy 233 → **241**, app 278 (+0 net, one string).
*Mutants:* (a) revert the lazy sites to `run.bench` → twin panel test RED; (b) key the label with
`seat.id` → **blind-leak test RED**; (c) alias-only re-vote join → drill test RED; (d) the two-term
AND rev 2 proposed → the **unique-bench** drill test RED.

**T3 — `costPanel` carries `r.seat`.** Shape pin. *Mutant:* remove the key → shape test RED.
*Revert check:* **none possible within PR5a — stated, not faked.**

**T4 — judge runStats rows carry the seat (R5-8).** `seat: j.seat` at `:238`. Replace
`run-assemble.test.js:286-307` with a pin that asserts **on the role string** against
`LEDGER_JOIN_ROLES`, plus the second invariant rev 2 missed: `buildLedgerRows` projects no `seat`
key at all. *Mutant:* remove the key → twin judge-cost test RED. *Revert check:* T5's table test
fails without T4 — measured three ways.

**T5 — `report.js` cost rows** (§3.5). `r.seat || r.model`. **Do not extract** unless the measured
file exceeds 300 (measured 294 with T5+T6). *Mutant:* `r.model` → twin cost-table test RED.

**T6 — the R8 marker** (§3.6, R5-10). `toModel` (the edit rev 1 missed), the tier cell in both
renderers, gated legend. Update `seat-matrix.test.js:121` and `:149` deliberately.
*Mutants:* drop the marker in each renderer independently → each renderer's own test RED; revert
`toModel` → both RED.

**T7 — the chair packet's R8 signal only** (§3.6). New parameter through `buildChairPacket`;
re-measure `run-assemble.js` before writing. *Mutant:* drop the line → the chair R8 test RED.

**T8 — docs. RUNS LAST, re-measures every citation it writes.**
- ⛔ **REV-1 WAS WRONG about the doc gate.** `tests/docs-anchors.test.js:5-8,:104` covers
  **top-level, non-recursive `docs/*.md` + README, pinned at exactly 16 files**. It does **not**
  cover `skills/`. ⛔ **REV-2 then misattributed the extension** to R10; it is **R19** (`spec:41`,
  and `spec:569` assigns it to PR-Z). Do not add a top-level `docs/*.md`; every added `](#anchor)`
  must resolve to an ATX heading in the same file.
- `CHANGELOG.md:179-186` — **correct, do not append.**
- `docs/council.md:232-237` (the same false universal), `:814-817` (T6's legend makes "the two say
  the same thing" false), `:1002` (the verbatim sample legend), and the `review-<model>.md` residue
  at **`:471` and `:1080`** — ⛔ rev 2 also listed `:525`, which is a concrete
  `amicus council validate review-deepseek.md` example, not residue.
- `BACKLOG.md` — three citation sites (`:1898`, `:1903`, `:1918`). **Record honestly that
  `:1911-1921`'s literal instruction is NOT discharged** (§3.1.2): the alias name is still listed,
  and this design deliberately refuses to guess orphan-vs-stray.
- `skills/second-opinion/SKILL.md:365-366`'s run-stats table diverges from the engine renderer after
  T4/T5 — note it; say explicitly that `SKILL.md:299` / `COUNCIL-DESIGN.md:155`'s stale Singleton
  definition belongs to **PR-Z**.
- **If any extraction was taken:** `node scripts/generate-docs.js`, commit `CLAUDE.md`.

**T9 — Gates.** `npm test` (full, no path arg, never `| tail`), `node scripts/check-file-sizes.js
--all`, `npm run lint`. All exit 0. Report real totals against T0.

---

## 6. Test design

**The number that governs this section:** the full rev-2 design was applied to a scratch copy and the
entire suite stayed green — `522 passed / 7345 passed / 4 snapshots`, byte-identical to baseline,
across all four `report.js` require forms. PR4c's dominant finding, reproduced twice.
**Assume no existing test constrains this change set.**

⛔ **REV-1 OVER-CLAIMED** ("every new test is a genuine RED"). ⛔ **REV-2 CORRECTED cases 1–8 and
then repeated the error for 9–14.** Measured status at HEAD, as worded:

| case | at HEAD | note |
|---|---|---|
| 1 end-to-end twin | **RED** | anti-vacuity writable only with indexed review bodies (below) |
| 2 F1 content | **RED** | this is the case both earlier designs failed |
| 3 preserved collision | GREEN — **pin** | |
| 4 legacy parity (absent/`null`/`[]`) | GREEN — **pin** | ⛔ rev 1 cited `verdict.js:117`; that guards `verdict.json`. `artifactAllowlist` only ever sees `run.json`, which seeds `seats: null` |
| 5 unique bench with seats | GREEN — **pin** | |
| 6 cost table | **RED** | ⚠️ scope the html assertion **to the cost table** — the matrix already emits `<td>gemini#1</td>` |
| 7 R8 marker | **RED** | one test per renderer |
| 8 chair packet titles | descoped with R5-9 | replaced by the R8-signal test |
| 9 orphan-alias reachable | GREEN as worded — **pin** | the RED form is "every file the run wrote is allowlisted" |
| 10 blind-mode twin | RED **for the wrong reason** | at HEAD the twin panel renders zero sections, so there are no titles to leak. Assert against the T2 mutant, not against HEAD |
| 11 drill-in re-vote | **RED** | must also pin the **unique** bench still joins (kills rev 2's two-term AND), and disclose the orphaned-re-vote loss |
| 12 chair packet one-space | **withdrawn** | R5-9 descoped |
| 13 ledger unreachability | GREEN **and vacuous** | at HEAD judge rows carry no seat, so it holds for the wrong reason. Assert on the **role string**; the anti-vacuity companion is the RED half |
| 14 malformed `run.seats` | GREEN — **pin** on T1's new code | assert on the **name list**, never `collisions` |

❗ **Cases added in rev 4 — the orphan∩collision intersection all three designs died on.** Every one
of these must drive a **real `runCouncil` with an orphaned leg** and assert on **file content**, not
on names. A rule about filenames validated only on healthy runs is exactly what produced three wrong
designs.

| # | case | expected |
|---|---|---|
| 15 | `['a','a','a-1','a-1']`, one `a-1` leg orphaned | `review-a-1.md` claimed by `a#1`(primary) + `a-1#1`(fallback, unsettled) ⇒ **unattributed + banner**. RED against rev 3's dedupe, which served the orphan's bytes as `a#1`'s |
| 16 | `['vendor/a','vendor?a','vendor?a']`, one orphan | banner **retained** (HEAD raises one; rev 3 deleted it), no misattribution |
| 17 | `['a','a','a-1','a-1']`, **all bound** | four distinct primaries, all settled, all attributed, **no banner** — the anti-vacuity partner to 15 |
| 18 | F1 with all legs bound | every seat settles by primary ⇒ `vendor?a → review-vendor-a.md` = its own review, **by content** |
| 19 | no-guess | an unsettled seat's sole fallback file exists ⇒ still **unattributed**. Mutant: attribute it → RED |
| 20 | one-model banner | duplicate seat ids do not mint `collisions: [{models:["gemini"]}]`; assert on the **name list** |

**Anti-vacuity for case 1 — verified.** `fake-launchers.js:63`'s `happyScript` is
`okWave(opts.models.map(m => mkLeg(m, review(m))))` — **identical bodies for twins**, which makes a
naive distinctness assertion vacuous. The indexed form is already the shipped idiom at
`seat-matrix.test.js:80`: `okWave(opts.models.map((m, i) => mkLeg(m, review(\`${m}${i + 1}\`))))`.

**Mutation harness.** `report.js` has **four** request forms — `./report`, `./council/report`,
`../council/report`, `../../src/council/report` — and all four must be remapped or the exercise
over-reports survivors. ⛔ Rev 1 named two. ⛔ **Rev 2 then made the same mistake one file over**:
`report-html` also has **two** forms (`./report-html` from `report.js:271`, and
`../../src/council/report-html` from `report.test.js:127`, which calls `renderHtml` directly).
Remap both. If §3.5's extraction is taken, `report-md` will have the same two-form shape.
⚠️ T1 adds a **third** reader of `isSeatSpace` via `../council/report`, so that mutant's blast radius
now includes the allowlist itself.

**Do NOT touch** `tests/workspace/dead-seat-rows.test.js:368` — PR5b's constraint, not PR5a's bug.

---

## 7. Risks

| Risk | Mitigation |
|---|---|
| The design re-creates the defect it fixes | **It did three times, and each time only on an ORPHANED leg.** Cases 15–19 drive a real orphan and assert on content. They are the first tests written; nothing else starts until they are RED at HEAD and against each named mutant. |
| A "which file needs no change" claim is carried across a design change | §3.3 — rev 2 and rev 3 each got it right for their own design and wrong for the shipped one. Every such claim is re-derived at revision time. |
| The rebuild deletes RN-1 while fixing #137 | Case 3; §2.1 and §2.2 record why the `~N` machinery stays. |
| A readable artifact disappears | Case 9 + §3.1's fallback rule. |
| A stray retry leg is displayed as a review | §3.1.2 — fallbacks are listed but never attributed, so no stray renders under a model. |
| Blind mode leaks | Case 10 + T2 mutant (b). |
| The drill-in gets worse, not better | Case 11 + T2 mutants (c) and (d). |
| A size ruling rests on comment-writing variance | **It did.** Both extractions are now optional-by-default with the measured margin stated (294/300, and re-measure T7). |
| A new module silently reddens the gate run | §4.2 — `generate-docs` is a named step, not a footnote. |
| A task is shippable-but-invisible | Every task states a revert check; **T3's is stated as impossible rather than faked.** |
| Citations rot inside the PR | T8 runs last and re-measures; §0.4 lists what T1/T4/T5 move. |
| The PR reads as closing #137 | §4.12 and the PR body both say it does not. |
