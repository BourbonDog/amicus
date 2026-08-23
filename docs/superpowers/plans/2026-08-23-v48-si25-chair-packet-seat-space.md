# v4.8 — SI-25: the chair packet is assembled entirely in alias space

**Branch:** `v48-si25-chair-packet-seats` · **BASE:** `c0745013` · Item **SI-25**, ruling **R15**.
Ships alone. **Written:** 2026-08-23, just-in-time, measured at BASE.

**The defect, from `BACKLOG.md`'s own entry:** on a twin bench the chair is handed
*"Deterministic tier counts: {Confirmed: 1}"* beside two `A1 — deepseek:` lines, **with nothing in
the packet able to reconcile them.** PR4c seat-keyed the report and the Workspace matrix but not
this packet, so the human-facing artifact and the model-facing one now disagree.

---

## §0. Measured substrate

### §0.1 The three sites, and their DEFINITIVE numbering

The numbering is not guessable from the file — it comes from
`docs/superpowers/plans/2026-08-20-v48-phase3-street-cred.md` ("SI-25 site (3), identified
first-hand"), which fixed it. Measured at BASE against `briefings-chair.js :: buildChairPacket`:

| site | line | renders | alias-space expression |
|---|---|---|---|
| **(1)** | `:88` | review blocks | `` `--- Review by ${r.model} ---` `` |
| **(2)** | `:93` | adjudications | `` `${a.findingId} — ${a.judge}: ${a.verdict}` `` |
| **(3)** | `:90` | peer rankings | `` `${r.judge}: ${JSON.stringify(r.order)}` `` |

⚠️ **Site (3) is the RANKINGS one, not the adjudications one.** R15 reads *"sites (1)+(2) now,
site (3) rides the street-cred PR"*, and it is easy to assume (3) is the last one in the file. It is
the middle one.

### §0.2 ⚠️ R15's disposition for site (3) is STALE — it rode nothing

R15 sent site (3) to "the street-cred PR" = Phase 3. **Phase 3 shipped and did not do it.** Its own
plan says so twice, verbatim: *"Phase 3 UNBLOCKS it; Phase 3 does not do it. Nothing in this PR may
claim SI-25 closed."* Measured at BASE: `:90` is still `` `${r.judge}: ${JSON.stringify(r.order)}` ``.

So site (3) is **unblocked and homeless**. See ruling **R25-1**.

### §0.3 What data actually reaches each site — and the emit-when-different rule

- **rankings[] and adjudications[]** pass through whole (`run-assemble.js:250-251`). Both carry
  `seat` — but **only when it differs from the alias**:
  ```js
  ...(j.seat && j.seat.id !== j.seat.alias ? { seat: j.seat.id } : {})    // :170 and :189
  ```
  On a unique-alias bench `seat` is **absent**, so a `seat || alias` fallback is byte-identical
  there by construction. This is spec §4.2's promise and it is why the fallback is correct rather
  than merely convenient. `seat` here is a **string** (`j.seat.id`), not a seat object.
- **reviews[] does NOT.** ⚠️ `run-assemble.js :: buildChairPacketFile` projects them down first:
  ```js
  reviews: reviews.map(r => ({ model: r.model, text: r.text }))              // :248
    .concat(claudeReview ? [{ model: 'claude', text: claudeReview.text }] : []),
  ```
  `r.seat` (a seat **object** — `run-assemble.js:192` passes `seat: r.seat`) is dropped before the
  packet ever sees it. **Site (1) cannot be fixed inside `briefings-chair.js` alone.** The BACKLOG
  entry already names `buildChairPacketFile` as part of this item.
- **The Claude review has no seat at all** — it is concatenated as `{ model: 'claude', text }`.
  `tests/council/run-claude-review.test.js:56` pins `'Review by claude'`. The fallback is load-bearing,
  not defensive.

### §0.4 ⚠️ `orderSeats` is NOT a drop-in replacement for `order`

`anonymize.js :: rankingToOrder` builds them as **parallel per-slot arrays**, and a slot is either a
scalar or an array (a tie):

```js
const order      = slots.map(s => Array.isArray(s) ? s.map(mapOne)  : mapOne(s));
const orderSeats = slots.map(s => Array.isArray(s) ? s.map(seatOne) : seatOne(s));
```

`seatOne` returns **`(seatMap && seatMap[label]) || null`** — so `orderSeats` legitimately contains
`null`s. And `run-assemble.js:187` ships it when **any** entry is truthy
(`j.orderSeats.flat().some(Boolean)`), so a **mixed** array of seat ids and nulls is a normal,
shipping shape. Rendering `JSON.stringify(r.orderSeats)` would print `null` into the one artifact a
paid chair reads as authoritative. Site (3) needs a **per-slot, tie-aware zip**. See **R25-3**.

### §0.5 `displayName` is the designated seam, and it has ZERO production consumers

`seats.js :: displayName` returns `seat && seat.id`. Its docblock says it is *"How a seat is named to
a human — **chair packet review headers today**"* and *"a named seam so a later rev changes
presentation in one place instead of at every call site."* Measured: **nothing in `src/` calls it.**
Its only readers are `tests/council/seats.test.js:181-183`. It was built for this item and never
wired.

Pinned behaviour: `displayName(buildSeats(['glm'],…)[0]) === 'glm'`;
`displayName(buildSeats(['glm','glm'],…)[1]) === 'glm#2'`.

### §0.6 Sizes and cycle risk

```
182/300  src/council/briefings-chair.js    <- sites (1)(2)(3); requires NOTHING today
271/300  src/council/run-assemble.js       <- the reviews projection; 29 lines of headroom
```
`seats.js` requires nothing, so `require('./seats')` from `briefings-chair.js` is cycle-free.
⚠️ `briefings-stage2.js` **requires** `briefings-chair.js` and re-exports `buildChairPacket`
(`:158`) — the header at `briefings-chair.js:5-10` warns a back-require would resolve `dateLine` to
`undefined` at load. Do not require `briefings-stage2` from here.

### §0.7 Existing pins

- `run-chair-seam.test.js:45` — the `-ch1` prompt is **byte-identical** to `chair-packet.md`.
  Holds regardless of this change, but it means any packet change is observable end to end.
- `run-claude-review.test.js:56` — `'Review by claude'`.
- `briefings-stage2.test.js:138-140`, `r8-surfaced.test.js:101` — section ordering/emptiness.
- **Nothing pins the twin-bench rendering of any of the three sites.** That gap is the reason this
  item shipped a defect; T-SI25.2 closes it.

---

## §1. Rulings

**R25-1 — do ALL THREE sites, not (1)+(2).** R15 deferred site (3) to a PR that shipped without it
(§0.2), so the deferral has no remaining referent. All three exhibit the SAME collapse: on a twin
bench, two judges both render `deepseek:`. Fixing two of three would leave the rankings block
collapsed while the record claims SI-25 closed — the half-fix is worse than either extreme, because
a packet that is seat-keyed in two blocks and alias-keyed in a third is *still* unreconcilable and no
longer looks it. This is the per-item benefit test, not category deferral.
*Cost if wrong:* site (3) is the intricate one (§0.4); if its zip proves hairier than measured,
split it out and say so — do not ship a partial zip.

**R25-2 — the invariant is BYTE-IDENTICAL OUTPUT ON A UNIQUE-ALIAS BENCH.** Spec §4.2. It is free:
`seat` is absent from rankings/adjudications exactly when it would equal the alias (§0.3), and
`displayName(seat) === seat.id === alias` for a unique seat. Every site therefore uses a fallback,
never an unconditional seat read. **A test must prove the byte-identity, not assert it.**

**R25-3 — site (3) renders a per-slot zip, tie-aware, null-safe.** For slot `i`: if `order[i]` is an
array, map each element `k` to `orderSeats[i][k] || order[i][k]`; otherwise `orderSeats[i] ||
order[i]`. If `orderSeats` is absent entirely, render `order` unchanged. ⚠️ `orderSeats` may be
shorter, mixed with `null`s, or absent — index defensively and never let a `null` reach the JSON.
*Cost if wrong:* a `null` or a dropped tie in the chair's ranking block. Pin both shapes.

**R25-4 — wire `displayName`, do not re-implement it.** §0.5. Site (1) is exactly what its docblock
says it exists for. Sites (2) and (3) receive `seat` as a **string** already (`j.seat.id`), so
`displayName` does not apply there — do not call it on a string.

**R25-5 — site (1) requires a `run-assemble.js` change, and it must stay minimal.** Forward the seat
through the projection at `:248`. That file has 29 lines of headroom; keep the change to the
projection plus a comment. ⚠️ **The Claude review keeps no seat** — the fallback must render
`claude` unchanged.

---

## Global constraints

1. **No file over 300 lines** (`content.split('\n').length`, minus 1 if it ends in a newline).
   **EXTRACT — never shave a comment.** ⚠️ `src/council/run-retry.js` is at 300/300 and has NO
   scheduled extraction — this item does not touch it.
2. **Byte-identical output on every unique-alias bench** (R25-2), proven by a test, not argued.
3. **Every behaviour claim measured, never argued** — admissible only with the command that produced
   it. New behaviour gets RED-before-GREEN; preservation pins get a **named mutant** instead.
4. **Commit before running any mutant.** ⚠️ **Never** `git checkout -- <path>`, `git restore`,
   `git stash`, or `git checkout-index` — the rule is by **effect**, not spelling. Hand-revert and
   byte-verify with `git diff` plus a SHA-1 against `git show HEAD:<path>`.
5. ⚠️ **Line endings vary PER FILE.** `.gitattributes:22` forces LF in the object DB and on
   checkout, but `BACKLOG.md` and the phasing doc are **CRLF in the working tree**; `git status` is
   clean either way. MSYS `sed`/`cat -A` **silently strip `\r`**. Read bytes with Python.
6. **Two sweeps after any correction** — the distinctive PHRASE of what you changed, AND the TARGET
   symbol/filename, repo-wide. The phrase sweep structurally cannot find a true sentence elsewhere
   that your change turned false. This class has fired five times on this release.
7. **Prefer SYMBOL ANCHORS** (`file.js :: symbol`) over `file.js:NNN` in anything you write.
   ⚠️ `check-citations.js` only range-checks, is blind to bare `(:NNN)` refs, and does not scan the
   doc tree at all — a green gate proves very little.

---

## Tasks

### T-SI25.1 — seat-key all three sites

**`src/council/briefings-chair.js`** — `require('./seats')` for `displayName` (cycle-free, §0.6).

- **Site (1)** `:88` → `` `--- Review by ${displayName(r.seat) || r.model} ---` ``
- **Site (2)** `:93` → `` `${a.findingId} — ${a.seat || a.judge}: ${a.verdict}` ``
- **Site (3)** `:90` → key `${r.seat || r.judge}`, values the R25-3 zip.

Give site (3)'s zip a small named local helper in this file rather than inlining it — it is the one
piece with real logic, and it needs to be nameable from a test and a mutant.

**`src/council/run-assemble.js :: buildChairPacketFile`** `:248` — forward the seat object through
the projection (R25-5). One comment line stating WHY the projection exists at all (it drops
`findings`, `conformance`, `leg` etc. deliberately) and why `seat` now rides with it.

⚠️ **Do not** change `order`, `orderSeats`, `tallyInput`, `verdict.json`, the report, or any launch
argument. `run-debate.test.js`'s parity pin exists because a seat id in a model-carrying **launch**
argument is a non-routable model name and a real paid failure. **The packet is prose, not a launch
argument** — that boundary is what makes this safe, and it must stay explicit in a comment.

### T-SI25.2 — the pins

Nothing today pins the twin-bench rendering of any site (§0.7). Add, in the natural home
(`tests/council/briefings-stage2.test.js` unless measurement says otherwise — re-derive it):

1. **Twin bench, all three sites** — two `deepseek` seats render distinguishably (`deepseek` /
   `deepseek#2`) in the review header, the adjudication line and the rankings line.
2. **Byte-identity on a unique-alias bench (R25-2)** — build a packet with seats present and
   `seat.id === seat.alias`, and assert it equals the packet built with the seat fields absent.
   This is the invariant; make it an equality, not a `toContain`.
3. **`'Review by claude'` still renders** with no seat (§0.3).
4. **R25-3's shapes** — a tie slot, a `null` inside `orderSeats`, and `orderSeats` absent
   altogether. ⚠️ **No `null` may reach the rendered JSON.**

**Named mutants, each with a red set measured at FULL `npx jest --no-coverage` scope:**
- `ALIASBACK` — revert one site to its alias-only expression. Must red the twin-bench pin.
- `SEATONLY` — drop the `|| alias` fallback at each site. Must red the claude pin and/or the
  unique-alias byte-identity pin. **This is the mutant that proves R25-2 is load-bearing.**
- `NULLLEAK` — in the zip, use `orderSeats[i]` unconditionally. Must red the null-shape pin.
- `FLATTIE` — in the zip, drop the `Array.isArray` arm. Must red the tie pin.

⚠️ **An empty red set is a finding, not a result.**

### T-SI25.3 — the record

`BACKLOG.md` (tick SI-25 and its `- [ ]` item at the *"chair packet is assembled entirely in alias
space"* entry), the phasing doc (status row 25 → DONE), `CHANGELOG.md`.

⚠️ **Record R25-1 explicitly and prominently**: R15 said sites (1)+(2), this shipped all three, and
the reason is that R15's home for site (3) evaporated when Phase 3 unblocked-but-did-not-do it.
Anyone reading R15 later must not conclude the extra site was scope creep.
⚠️ **Record that `displayName` had zero production consumers until now** (§0.5) — a seam documented
as in-use that nothing called is worth one line so the next reader trusts docblocks less.
⚠️ Re-derive every citation against the FINAL tree. `output/` and dated plan snapshots are out of
scope — dated records, never "gitignored".
