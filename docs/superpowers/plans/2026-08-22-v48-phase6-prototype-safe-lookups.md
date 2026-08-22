# v4.8 Phase 6, PR 1 — SI-24: prototype-safe document-keyed lookups

**Branch:** `v48-proto-safe-lookups` · **BASE:** `ee7da0db` (v4.8 Phase 5 merged)
**Written:** 2026-08-22, just-in-time, immediately before development.
**Spec authority:** `docs/superpowers/plans/2026-08-16-v48-phasing-and-rulings.md` §5 (Phase 6)
and its status-table row `| 24 |`. Ruling context: R2 (attribute nothing where there is nothing
to attribute).

---

## §0. Measured substrate

Everything below was measured **by execution at BASE `ee7da0db` on 2026-08-22**, not read off
source and not inherited from the BACKLOG. Probes are reproduced in each task so a reviewer can
re-run them rather than trust this section.

### §0.1 BASE is green — all seven gates, each with its own exit code

| gate | exit |
|---|---|
| `npm run lint` | 0 |
| `npm run check:secrets` | 0 |
| `npm run check:sizes` | 0 |
| `npm run check:citations` | 0 |
| `npm run check:tarball` | 0 |
| `npm run validate-docs` | 0 |
| `npm test` | 0 — **544 suites / 7818 passed / 8 skipped / 7826 total / 4 snapshots / 0 `●`** |

Working tree clean but for the pre-existing untracked `site-src/`.

### §0.2 The mechanism, stated once

A **module-level object literal used as a lookup table**, indexed by a string that arrives from a
document, resolves `Object.prototype`'s keys. `TABLE['toString']` is a function, not `undefined`,
so every `!== undefined` test, every `||` fallback, and every truthiness check that exists to
reject an unknown key **passes it through instead**.

The sibling shape is an **accumulator** — a bare `{}` written at a document-supplied key. There
`obj['__proto__'] = <number>` sets nothing and creates no own key: the write is silently
discarded.

### §0.3 The four carriers, each measured live

⚠️ **Anchors are by symbol.** The BACKLOG's SI-24 entry carries `tally.js:103-104` and
`tally.js:72`; measured today those are **`:77-78`** and **`:37`**. That is the *third* rot of
those numbers and the entry already says it is "anchored BY NAME" — the numbers rode along
anyway. Task 4 repairs them.

| # | site (by symbol) | shape | measured failure |
|---|---|---|---|
| A | `tally.js :: tally`, `VERDICTS[v.verdict]` (`:80`) | read | `basis` gains a 4th key, serialized `null` |
| B | `tally.js :: tally`, `VERDICTS[v.verdict] === 'a'` (`:113`) | read | **none — measured harmless**, see §0.5 |
| C | `street-cred.js :: computeStreetCred`, `perJudgeRank[…]` (`:218`) | write | `__proto__`-keyed judge silently **loses its rank** |
| D | `report.js :: SYMBOL` (`:21`) → 3 renderers | read | renders `function toString() { [native code] }` into MD/HTML |
| E | `debate.js :: PAST_TENSE` (`:16`) → 2 sites | read | `action` **vanishes** from the JSON document |

#### A — `tally.js`, the `basis` accumulator (the filed SI-24 defect)

```
verdict="toString"    -> {"a":0,"d":0,"n":0,"function toString() { [native code] }":null}
verdict="__proto__"   -> {"a":0,"d":0,"n":0,"[object Object]":null}
verdict="constructor" -> {"a":0,"d":0,"n":0,"function Object() { [native code] }":null}
verdict="valueOf"     -> {"a":0,"d":0,"n":0,"function valueOf() { [native code] }":null}
```

Four keys where the schema promises three, in **both** `tally.json` and `verdict.json`.
The comment at `:77-78` already **claims** this cannot happen ("Skip unknown verdict strings so a
stray value can't corrupt the basis"). The code does not do what its own comment says.

#### B — the `sameModelCorroboration` stamp: measured NOT live

```
VERDICTS["toString"]    === 'a'  ->  false
VERDICTS["__proto__"]   === 'a'  ->  false
VERDICTS["constructor"] === 'a'  ->  false
VERDICTS["valueOf"]     === 'a'  ->  false
```

and end-to-end on a twin bench, `sameModelCorroboration` is `undefined` for all four. See §0.5 —
this is a correction to the filing, not a defect this PR closes.

#### C — `perJudgeRank`, the accumulator half

```
judge="__proto__"   -> perJudgeRank={}                ownKeys=[]            withSelf=1
judge="toString"    -> perJudgeRank={"toString":1}    ownKeys=["toString"]  withSelf=1
judge="constructor" -> perJudgeRank={"constructor":1} ownKeys=["constructor"]
seat="__proto__"    -> perJudgeRank={}                ownKeys=[]
```

**`__proto__` only.** `toString`/`constructor`/`valueOf` shadow harmlessly and create own keys.
The `__proto__` row is the exact disagreement T3.3 fixed for the alias-collapse half: the map
says nothing, `withSelf` says 1. Both the judge-alias and the seat-id channel carry it.

#### D — `SYMBOL`, three renderers

```
BASE  vote="agree"    -> md cell="✓"
BASE  vote="bogus"    -> md cell="undefined"
BASE  vote="toString" -> md cell="function toString() { [native code] }"
BASE  matrix (|| '?') -> "function toString() { [native code] }"   <- the fallback is defeated
```

`report-md.js:50` and `report-html.js:42` have no fallback at all; `matrix-model.js:201`'s
`|| '?'` is defeated because a function is truthy.

#### E — `PAST_TENSE`, the worst shape

```
action="defend"      -> {"action":"defended","previousTier":"Confirmed"}
action="bogus"       -> {"action":"no-response","previousTier":"Confirmed"}
action="toString"    -> {"previousTier":"Confirmed"}          <- `action` KEY IS GONE
action="constructor" -> {"previousTier":"Confirmed"}          <- same
action="__proto__"   -> {"action":{},"previousTier":"Confirmed"}
```

`JSON.stringify` drops function values, so the document loses a contracted key entirely. The
`|| 'no-response'` at `debate.js:131` exists **precisely** to normalise unknown actions, and an
inherited key walks straight past it.

**Reachability, per carrier — corrected 2026-08-22 after Task 1 measured the MCP schema.**
⚠️ **This paragraph shipped WRONG in the plan's first commit (`d0e03fb0`)**, which said all of
A–D need "`mcp-tools.js`'s `z.string()`, which accepts every string". That is true of the
`judge`/`seat` fields and **false of `verdict`**. The carriers do not share one reachability
argument, and the difference is the *field*, not the path:

| carrier | keyed by | CLI path (`cli-handlers-council.js`, raw `JSON.parse`) | MCP path (`mcp-tools.js`) |
|---|---|---|---|
| A, B | `adjudications[].verdict` | **reachable** — no schema at all | **BLOCKED** — `z.enum(['agree','dispute','neutral'])` at `:420` |
| C | `rankings[].seat \|\| .judge` | **reachable** | **reachable** — both are `z.string()` |
| D | a verdict string read back off `tally.json` | **reachable** | inherits A/B's enum on the write path |
| E | `resp.action`, the model's own parsed defense response | **reachable** | **reachable** |

⚠️ **E is reachable from a real paid run, not from hand-assembled input at all.** `d.action`
originates at `debate.js:77` as `resp.action`, straight off the model's parsed output — a model
that emits `"action": "toString"` produces it with no operator involvement. E is the only carrier
of which that is true, and it is the one whose failure shape is a **missing key** in the document.

### §0.4 The fix, measured

`{ __proto__: null, … }` in the literal. Measured on all three tables:

```
VN = { __proto__: null, agree:'a', dispute:'d', neutral:'n' }
  getPrototypeOf -> null       own keys -> ["agree","dispute","neutral"]
  VN["toString"] VN["__proto__"] VN["constructor"] VN["valueOf"] -> all undefined
  VN["agree"] VN["dispute"] VN["neutral"] -> "a" "d" "n"    (unchanged)
  JSON.stringify(VN) -> {"agree":"a","dispute":"d","neutral":"n"}    (unchanged)
```

`Object.create(null)` for the accumulator:

```
M['__proto__'] = 1.5  ->  ownKeys ["__proto__"]   JSON {"__proto__":1.5}
  round-trip through JSON.parse -> own key SURVIVES, value 1.5, normal prototype restored
  Object.entries / Object.values / spread / for..in -> all behave normally
```

**Jest compatibility, measured** (a scratch suite, since 8 existing assertions read
`perJudgeRank`):

```
expect(nullProtoObj).toEqual({a:1,b:2})                      -> PASS
expect({row, perJudgeRank: nullProtoObj}).toEqual({…})        -> PASS
expect([{…, perJudgeRank: nullProtoObj}]).toEqual([{…}])      -> PASS   (the street-cred.test.js shape)
expect(nullProtoObj).toStrictEqual({a:1,b:2})                 -> FAIL
```

`toStrictEqual` is **not used** anywhere against these rows — grepped `street-cred.test.js`,
`seat-parity-ondisk.test.js`, `tally.test.js`, and every test naming `PAST_TENSE`/`SYMBOL`/
`VERDICTS`: zero hits. `seat-parity-ondisk.test.js` reads its rows back **from disk**, so those
are JSON-parsed ordinary objects and are unaffected either way.

### §0.5 Rulings

**R-A — the `basis` change is a FIX, not a shape change.** The BACKLOG entry explicitly defers
this decision ("it changes `basis` on a document that currently produces a `null`, so it needs a
decision about whether that is a fix or a shape change"). Ruled: **fix**. The current fourth key
is not data — it is a stringified function used as a property name, unreadable by any consumer,
and the code's own comment at `:77-78` already documents the post-fix behaviour as the intended
one. *Cost if wrong:* a consumer somewhere depends on a `null`-valued garbage key. Nothing in the
tree reads `basis` by anything but `a`/`d`/`n`.

**R-B — the lever is the TABLE, not the consumers.** The BACKLOG proposes
`Object.prototype.hasOwnProperty.call(VERDICTS, v.verdict)` "at both sites". Rejected: that is
one guard per consumer, and this release has already been burned by that shape (plan-authoring
failure mode #7 — *a rule needing a third spelling means the defect is in a consumer*; here it
would need **seven** spellings across 5 files). One `__proto__: null` per table closes all seven
index sites with no guard to keep in sync. *Cost if wrong:* a future reader adds a consumer and
assumes the guard is local. Mitigated by a comment at each table.

**R-C — site B is measured harmless, and the PR will say so.** The filing says "fix at both
sites". Measurement (§0.3 B) shows `VERDICTS[inherited] === 'a'` is false for every
`Object.prototype` key, so the `sameModelCorroboration` stamp never fires falsely today. R-B
fixes it for free with **zero behaviour change**. The PR body must not claim it closed two live
defects when one was never live.

**R-D — D and E are pulled into this PR rather than deferred.** They are the same mechanism, the
same one-token fix, and the same review surface; both measured live above; E is reachable from a
real run. Per the standing ruling that category-based deferral is ceremony, the per-item test
applies: doing them now is cheaper than a second plan/council/review cycle for a two-token change,
and — decisively — shipping SI-24 alone would let this PR's own headline ("the council's
document-keyed lookups no longer resolve inherited keys") ship **false**, with the report renderer
one file away still printing `function toString() { [native code] }` into a markdown table.
This deepens one Phase 6 item; it does not bundle a second one. *Cost if wrong:* a slightly wider
diff than the phasing doc's row 24 describes. Task 4 records the widening in the row itself.

**R-E — the `undefined`-rendering defect is FILED, not fixed.** Measured at BASE: `report-md.js`
renders the literal string `"undefined"` for **any** unknown verdict — `bogus` does it at BASE,
before this PR touches anything (§0.3 D). After the fix, inherited keys render exactly like
`bogus` does: the fix makes them **consistent with existing unknown-key behaviour**, not
well-rendered. The three renderers disagree with each other (`''`/`undefined`/`'?'`), and
reconciling them is a rendering-contract change, not a prototype change. Filed in Task 4.
⚠️ **The PR must not claim it "fixed the rendering".** It removed one class of garbage and left
a measured, pre-existing, differently-caused one.

**R-F — the wider table family is FILED, not swept.** `grep "^const [A-Z_0-9]* = {" src/`
returns **35** module-level tables. The great majority are keyed by internal enums, not by
document strings, and each needs its own reachability measurement before it deserves an edit.
A blanket sweep would ship 30-odd unmeasured claims. Filed in Task 4 with the discriminator that
makes the sweep tractable. ⚠️ Also filed, deliberately unfixed: the **ad-hoc** `byId = {}` maps
built *inside* functions (`debate.js:71` is one) — a different shape with a different reachability
argument.

---

## Global constraints

1. **No file may cross 300 lines.** If one approaches it, **EXTRACT — never shave a comment.**
   Current: `tally.js` 166, `street-cred.js` 234, `debate.js` 274 ⚠️, `report.js` 295 ⚠️.
   **`report.js` at 295 and `debate.js` at 274 have almost no headroom** — a table comment there
   must be 1-2 lines, or the constant moves. Measure with
   `node scripts/check-file-sizes.js`, whose rule is `content.split('\n').length` minus 1 when
   the file ends in a newline.
2. **Every behaviour claim is measured, never argued.** A claim about reachability, about a red
   set, or about what a document contains is only admissible with the command that produced it.
3. **Every fix gets a named mutant with a recorded red set**, following
   `tests/council/street-cred-mutants.js :: RANKALIAS` and its six siblings. An empty or
   shrinking red set means the property is unpinned — chase it, do not record it and move on.
4. **Commit before running any mutant.** Hand-revert or restore from a copy you made yourself.
   ⚠️ **Never run any command that overwrites the working tree from the index or a commit** —
   `git checkout -- <path>`, `git restore`, `git stash`, `git checkout-index`. The rule is by
   **effect**, not by spelling. Byte-verify a revert with `git show HEAD:<path>`.
5. **Do not re-derive §0.** It was measured at BASE today. Re-measure only what your own task
   changes.
6. **Anchor citations by SYMBOL**, never by line. If you must cite a line, open the file at that
   line and confirm the token before writing it down.

---

## Tasks

### T6.1.1 — `VERDICTS`: the filed SI-24 read site

**File:** `src/council/tally.js`

**Change (one token plus comment):**

```js
const VERDICTS = { __proto__: null, agree: 'a', dispute: 'd', neutral: 'n' };
```

Extend the comment at `:77-78` so it states the mechanism it now actually enforces — that the
skip is guaranteed by the table's null prototype, not by the `!== undefined` test alone, and that
`VERDICTS` is module-local (`module.exports` at `:166` does not name it), so the prototype is not
observable outside this file. Keep it short; `tally.js` has headroom but not a lot.

**Tests** — `tests/council/tally.test.js`:

- P1: for each of `toString`, `__proto__`, `constructor`, `valueOf` as `adjudications[].verdict`,
  `Object.keys(f.basis)` is exactly `['a','d','n']` and `JSON.stringify(f.basis)` is
  `{"a":0,"d":0,"n":0}`.
- P2: the three real verdicts still count — `agree`/`dispute`/`neutral` land in `a`/`d`/`n`.
- P3: an ordinary unknown verdict (`'bogus'`) behaves identically to an inherited one — this is
  the property that says the fix *unified* the two cases rather than special-casing four names.

**Named mutant `PROTOVERDICT`** — delete `__proto__: null,` from the literal. Record the measured
red set in the test file beside the pins. Expect P1 to red; **if P2 or P3 also red, say so** —
report the real set, do not curate it.

⚠️ Do **not** add a `hasOwnProperty` guard at either consumer (R-B).
⚠️ `sameModelCorroboration` (`:113`) must be byte-unchanged. It is fixed by the table, and R-C
records that it was never producing a wrong stamp.

---

### T6.1.2 — `perJudgeRank`: the SI-24 accumulator site

**File:** `src/council/street-cred.js`

**Change:**

```js
const all = [], peers = [], perJudgeRank = Object.create(null);
```

Add to `computeStreetCred`'s docblock, under the existing numbered item 3 (which documents the
alias-collapse half T3.3 closed), a short fourth note: the map is prototype-free so a judge whose
seat id or alias is `__proto__` keeps its rank instead of writing into the prototype and
vanishing. Cite the measurement, not the adjective.

**Tests** — `tests/council/street-cred.test.js`:

- P1: `rankings: [{ judge: '__proto__', order: ['x','y'] }]` → `perJudgeRank` has own key
  `__proto__` with the rank, and `Object.values(perJudgeRank)` agrees with `withSelf` (the same
  agreement invariant the existing `| 24 |` test asserts).
- P2: the same via the **seat** channel — `{ judge: 'j1', seat: '__proto__', … }`, since
  `[j.seat || j.judge]` means both channels carry it.
- P3: `toString`/`constructor` keep working (they shadowed harmlessly before; they must still be
  present after).
- P4: a JSON round-trip (`JSON.parse(JSON.stringify(row))`) preserves the `__proto__` entry — this
  is the property that matters, because the row is written to `tally.json`.

**Named mutant `PROTORANK`** in `tests/council/street-cred-mutants.js`, following the file's
existing seven — revert to `perJudgeRank = {}`. Record the measured red set. **Re-run the seven
existing mutants** (RANKALIAS, ALIASSELF, JUDGEALIAS, SEATALWAYS, ALIASDRIVER, NOFALLBACK,
EXPANDONCE) against the new tree and record their sets; that file's own header says to re-run them
whenever anything here changes. ⚠️ A red set that **shrinks** is the signal that a pin came
unmoored — chase it before recording.

⚠️ §0.4 measured that Jest `toEqual` accepts a null-prototype object in all three shapes this
file uses, and that no `toStrictEqual` reads these rows. If you nonetheless hit a matcher failure,
that is new information — report it, do not work around it by reverting to `{}`.

---

### T6.1.3 — `SYMBOL` and `PAST_TENSE`: the two measured-live siblings (R-D)

**Files:** `src/council/report.js`, `src/council/debate.js`

```js
const SYMBOL = { __proto__: null, agree: '✓', dispute: '✗', neutral: '–' };
const PAST_TENSE = { __proto__: null, defend: 'defended', amend: 'amended', withdraw: 'withdrawn', 'no-response': 'no-response' };
```

⚠️ **Size first.** `report.js` is **295/300** and `debate.js` is **274/300**. Add **at most one
line** of comment at each, or none. If either would cross, the comment goes in the task report
and the plan record instead — do **not** shave an existing comment to make room, and do not
extract for a one-token change.

⚠️ `SYMBOL` **is** exported (`report.js:295` names it) and is read by `report-html.js:42`,
`report-md.js:50` and `matrix-model.js:201`. `PAST_TENSE` is exported too (`debate.js:273`) and
read at `debate.js:131` and `run-debate.js:262`. The null prototype travels with the export —
that is the point — but it means **five** consumer sites change behaviour, so pin from the
consumer side, not only from the table.

**Tests:**

- `tests/council/report-md.test.js` (or `report.test.js`, whichever already exercises the vote
  cell): a vote of `toString` renders **the same cell as a vote of `bogus`**. Assert the
  equivalence, not the literal — R-E says the literal is `"undefined"` and is a separate,
  pre-existing defect this PR does not fix.
- `matrix-model` coverage: a vote of `toString` yields `'?'`, i.e. the `|| '?'` fallback is no
  longer defeated.
- `tests/council/debate.test.js`: `decorateRecord` with `action: 'toString'` yields
  `{action: 'no-response', previousTier: …}` — the **key is present and is a string**. Assert
  `typeof d.action === 'string'` explicitly; the BASE failure was the key *disappearing* from
  `JSON.stringify`, so a test that only compares parsed objects can miss it. Add the
  `JSON.stringify` round-trip assertion.
- Same for `__proto__` and `constructor`.

**Named mutants `PROTOSYMBOL` and `PROTOACTION`** — remove each `__proto__: null,` in turn.
Record both measured red sets.

---

### T6.1.4 — the record

**Files:** `BACKLOG.md`, `docs/superpowers/plans/2026-08-16-v48-phasing-and-rulings.md`,
`CHANGELOG.md`, this plan.

1. **Tick SI-24** in `BACKLOG.md` and repair its three stale line numbers
   (`tally.js:103-104` → `:77-78`; `tally.js:72` → `:37`) — ⚠️ **and re-derive them against the
   FINAL tree**, after T6.1.1's comment edit shifts them, not against BASE.
2. **Status-table row `| 24 |`** OPEN → DONE, recording what actually shipped: the accumulator
   half, the read half, **and** the two siblings R-D pulled in. Row 24 currently describes two
   sites; the PR closes four carriers across five files. Say so in the row.
3. **File** in `BACKLOG.md`, each with its measurement:
   - R-E's renderer disagreement (`''` / `"undefined"` / `'?'` across three renderers for an
     unknown verdict) — **measured at BASE with `bogus`**, so it is explicitly not caused here.
   - R-F's 35-table family, with the discriminator (document-keyed vs enum-keyed) that makes the
     sweep tractable, and the note that the v4.7 PR6 `Object.create(null)` family item covered the
     seats-panel only.
   - The ad-hoc in-function `byId = {}` maps (`debate.js:71` named as one instance, by symbol).
4. **CHANGELOG.md** — one entry under the v4.8.0 unreleased section.
5. **Verdict recount** in the phasing doc's §1, exactly as Phase 5 did: it read
   **15 DONE · 3 PARTIAL · 1 SUPERSEDED · 1 HOLD · 11 OPEN = 31**. Row 24 moving OPEN → DONE
   makes it **16 DONE · … · 10 OPEN = 31**. ⚠️ **Recount from the table, do not arithmetic it
   from this sentence** — that sentence is a BASE reading and this plan is exactly the kind of
   document that goes stale.
6. **Phase 6 resume point** in `BACKLOG.md`: strike SI-24 from the remaining list, leave the
   ordering paragraph's "preference only" ruling intact, and note that the next controller should
   re-derive ordering rather than inherit it.

⚠️ **Failure mode #10, THE FALSIFIED RECORD, is the live hazard of this task.** Every sentence
this task corrects may be the twin of a sentence somewhere else. **Grep the distinctive phrase**
of anything you edit, repo-wide — a same-file sweep cannot find twins. The known twin-carrier for
row 24's wording is `tests/council/street-cred-mutants.js` (its JUDGEALIAS block quotes the row's
"`| 24 |`" language) and `tests/council/street-cred.test.js:6` (which calls the site "unfiled").
**After this PR the site is filed and closed** — that word becomes false in both places.

---

## Verification (controller, after the final commit)

1. All seven gates, **each with its own real exit code**. Never `cmd | tail` and read `$?`.
2. `npm test` **synchronously in the foreground, after the final commit** — `.husky/pre-push`
   blocks unless `.test-passed` matches HEAD exactly.
3. Expect **544 suites** and **more than 7818 passing**; a count that does not rise means the new
   tests did not run.
4. Every named mutant re-run against the final tree, with its red set recorded in a committed
   file — not in the PR body alone.
