# v4.8 — SI-22.4: `--council` preset members are classified untrimmed

**Branch:** `v48-si22.4-preset-trim` · **BASE:** `ecf90f19` · Item **SI-22.4**. Ships alone,
**LAST** before the release. **Written:** 2026-08-23, just-in-time, measured at BASE.

**The filed defect** (`BACKLOG.md`, SI-22 item 4): *"A `--council` preset with a whitespace-padded
member is functionally a twin bench that `buildSeats` treats as two distinct aliases."*
`classifyCouncilMembers` pushes `member` **raw** where `parseModelsList` would trim, and
`buildSeats` mints `alias#N` only when `counts.get(alias) > 1` — so `['openai/gpt-5 ','openai/gpt-5']`
is two aliases, not one. Measured then: both seats agreeing on both findings gave
`basis {a:0,d:0,n:0} Singleton` — the peer-corroboration undercount survived in full.
*"The fix is upstream (trim at classification), not in the peer filter."*

---

## §0. Measured substrate

### §0.1 ⚠️ The filed framing is INCOMPLETE — the dominant effect is not twin-merging

Both the item and the scheduling note describe this as an input-hygiene fix whose one knock-on is
*"trimming turns a whitespace-padded preset member into a REAL twin bench, so artifact filenames
change and `meta.seats` starts emitting."* Measured at BASE by calling the real
`config.js :: classifyCouncilMembers` and comparing against the same call on pre-trimmed input:

| shape | catalog | BEFORE | AFTER trim |
|---|---|---|---|
| `['openai/gpt-5 ', 'openai/gpt-5']` | present | models `["openai/gpt-5"]`, **1 dropped** | models `["openai/gpt-5","openai/gpt-5"]` |
| `['openai/gpt-5 ', 'openai/gpt-5']` | empty | models `["openai/gpt-5 ","openai/gpt-5"]` | models `["openai/gpt-5","openai/gpt-5"]` |
| `['openai/gpt-5 ']` | present | **models `[]`** — nothing runs | models `["openai/gpt-5"]` |
| `['openai/gpt-5 ']` | empty | models `["openai/gpt-5 "]` | models `["openai/gpt-5"]` |
| `['gpt ']` | empty | **models `[]`** — nothing runs | models `["gpt"]` |
| `['gpt ', 'gpt']` | empty | models `["gpt"]`, **1 dropped** | models `["gpt","gpt"]` |

**Every one of the six changes behaviour, and the dominant change is RESURRECTION, not merging:**
a member that is **dropped today starts running**. That is a **new paid leg** on four of six shapes,
and on two of them the bench goes from empty to non-empty.

⚠️ **Only ONE row is the twin-merge the item describes** (row 2, the empty-catalog case), and even
there the before-state is already two distinct aliases — so what changes is *two unrelated seats*
becoming *a real twin bench*. That IS the documented knock-on. The other five are behaviour changes
the record never names. See **R22.4-1**.

### §0.2 Why the padded member is dropped today — the three gates, in order

`classifyCouncilMembers` (`config.js :: classifyCouncilMembers`):

1. `const id = member.includes('/') ? member : aliases[member];` — a padded **alias** (`'gpt '`)
   misses the alias table and is dropped as *"alias no longer resolves to a known model"*.
2. `isLocalProvider(vendor)` → pushed **raw**, bypassing gate 3 entirely.
3. `if (known.size > 0 && !known.has(id))` — a padded **full id** carries its trailing space into the
   catalog lookup and is dropped as *"resolved id is not present in the cached model catalog"*.
   ⚠️ `known.size > 0` means an **absent or empty catalog skips this gate**, which is why the padded
   full id survives raw on a fresh install that has never run `models --refresh`.

### §0.3 The divergence that justifies the fix

`--models` **trims**: `sidecar/fanout-validate.js :: parseModelsList` is
`modelsArg.split(',').map(s => s.trim()).filter(Boolean)`, reached from
`cli-handlers-fanout.js:42`. `--council` presets go through `classifyCouncilMembers`, which does
not. **The same whitespace is benign on one flag and fatal on the other.**

### §0.4 What a drop costs the user TODAY — it is not silent

- `council/presets-cli.js:149-150` renders `${member} (${reason})` under `dropped:` in
  `amicus council show`.
- `council/run.js:80-87` emits a `dropped-members` degrade note whose `effect` reads *"the bench is
  smaller than the preset requested; **the run will exit degraded (2)**"*.
- `reason` is persisted into `run.json` (`run-state.js`, `mcp-council-run.js`).

So today a trailing space in a preset turns into a **degraded exit code**. That is the strongest
argument for the trim, and it is stronger than the undercount the item leads with.

### §0.5 ⚠️ A TRIPWIRE sits directly in the function's docblock

`config.js :: classifyCouncilMembers`'s docblock (`:426-436`) states that its two `reason` strings
are free text with no consumer branching on them, and then:

> *"The tripwire: if a THIRD reason string is ever added here, **stop and re-decide** whether
> `reason` should become a coded enum instead of free text — this note marks that decision point,
> it does not make it."*

An all-whitespace member (`'   '`) trims to `''`. Measured at BASE it is already dropped by gate 1
(*"alias no longer resolves"*), and it still is after trimming, so **no third reason is required**.
See **R22.4-4** — do not trip this on a hygiene fix.

### §0.6 Sizes and coverage

```
629  src/utils/config.js   ⚠️ GRANDFATHERED in check-file-sizes.js:22 — the 300 gate does NOT
                              apply, so there is no size pressure here. Do not use that as licence.
130  src/council/report-md.js
146  src/council/report-html.js
```
`classifyCouncilMembers` is exercised from `tests/council/cli-handlers-council.test.js`,
`run-assemble.test.js`, `run-raiserseat-call.test.js`, `tests/pack/cli-fanout-start-pack.test.js`.
**No test covers a padded member at all** — re-derive that before relying on it.

---

## §1. Rulings

**R22.4-1 — the trim ships, and the record must lead with RESURRECTION.** The fix is right:
whitespace is a typo, not intent, and `--models` already trims (§0.3), so today the two flags
disagree and the `--council` side converts a typo into a degraded exit (§0.4). But the item's
framing — hygiene fix, one twin-bench knock-on — is **incomplete on five of six measured shapes**.
The record must state the measured effect: **members that are dropped today start running, which is
a new paid leg.** Anyone reading only the old framing will not budget for that.
*Cost if wrong:* a user with a padded preset member sees one more billed leg than before — which is
what they asked for by writing the member.

**R22.4-2 — trim per member, keep the RAW string in `dropped`/`droppedMembers`.** A member still
dropped after trimming must be reported as the user wrote it, or they cannot find it in their
config. Only the value pushed into `models` is trimmed.
*Cost if wrong:* a user greps their config for a string that isn't there.

**R22.4-3 — an empty-after-trim member must NOT reach `models`.** `parseModelsList`'s own shape is
`.map(trim).filter(Boolean)`. Measured, `'   '` is already dropped by gate 1 both before and after,
so this is a preservation property, not a new behaviour — pin it as such with a **named mutant**,
not RED-before-GREEN.

**R22.4-4 — do NOT add a third `reason` string.** §0.5's tripwire says to stop and re-decide the
free-text-vs-enum question if a third is added. That decision is not this PR's to make on a hygiene
fix. If the implementation appears to need one, **STOP and report** rather than adding it.

**R22.4-5 — the twin-bench knock-on is REAL but NARROW, and must be measured end to end, not
argued.** Where trimming produces a duplicate alias, `buildSeats` mints `alias#2`, artifact
filenames gain a `-2` sibling and `meta.seats` starts emitting (it ships only when the bench repeats
an alias). Prove it through a real run, not by reasoning from `buildSeats`.

**R22.4-6 — take the `report-md.js`/`report-html.js` rider.** Both render `s.model` for street-cred
rows, so a twin bench shows two DIFFERENT numbers under one alias — ambiguous about which seat is
which. The rows already carry `seat` (`street-cred.js` emits `seat: id === m ? null : id`), so the
fix is `s.seat || s.model`, the same fallback SI-25 used. It has been deferred twice as
*"SI-25-adjacent"*, which is an association, not a schedule, and it is **homeless**. It belongs
here because **this is the PR that makes twin benches reachable from a preset** — the rider's
defect only becomes visible because of this change.
*Cost if wrong:* two one-line renderer changes ride a classification fix; both are pinned.

---

## Global constraints

1. **No file over 300 lines** — ⚠️ `src/utils/config.js` is **grandfathered** (629 lines) so the
   gate does not fire, which makes it easier to sprawl. Keep the change small anyway.
2. **Every behaviour claim measured, never argued.** New behaviour gets RED-before-GREEN;
   preservation properties get a **named mutant** instead.
3. **Commit before any mutant.** ⚠️ **Never** `git checkout -- <path>`, `git restore`, `git stash`,
   `git checkout-index` — the rule is by **effect**, not spelling. Hand-revert, byte-verify with
   `git diff` plus a SHA-1 against `git show HEAD:<path>`.
4. ⚠️ **Line endings vary per file and the answer CHANGES.** Committed objects are LF
   (`.gitattributes:22`); a working-tree file rewritten by a Windows-side tool stays CRLF until git
   next touches it. Measure in bytes with Python; MSYS `sed`/`cat -A` silently strip `\r`.
5. **THREE passes over every sentence you touch:** phrase sweep, **target sweep** (the symbols you
   changed), and the **fence test** — *"what does a reader DO after reading this, and is that still
   the right action?"* Tell: a negative or limiting construction naming your target ("untouched",
   "only", "cannot", "never", "zero") is a scope fence, and a truth test cannot detect one that
   moved. This class has fired seven times on this release.
6. **Commit with hooks ON.** `check:citations` catches a symbol anchor pointing at a symbol that
   does not exist yet; bypassing the hook is how one landed earlier in this release.
7. **State the counting rule behind any number filed.** A measurement without its basis is not
   admissible.

---

## Tasks

### T-22.4.1 — the trim, and the pins that bound it

`src/utils/config.js :: classifyCouncilMembers`. Trim per member (R22.4-2); `models` receives the
trimmed value, `dropped`/`droppedMembers` keep the raw one. No third `reason` (R22.4-4).

⚠️ Trim **before** gate 1's `member.includes('/')` test, so a padded alias resolves and a padded id
reaches the catalog lookup clean — that is the whole point.

**Pins — the six shapes of §0.1's table are the specification.** Each asserts the AFTER column.
Plus:
- an all-whitespace member never reaches `models` (R22.4-3);
- a member with **no** padding is byte-identical through the function (preservation);
- `dropped`/`droppedMembers` report the RAW string (R22.4-2);
- exactly **two** distinct `reason` strings still exist in the function (R22.4-4 — a cheap guard
  that trips if anyone adds a third).

**Named mutants**, each with a red set measured at FULL `npx jest --no-coverage` scope:
- `NOTRIM` — remove the trim. Must red the resurrection pins.
- `TRIMDROPPED` — report the trimmed string in `droppedMembers` instead of the raw one.
- `KEEPEMPTY` — let an empty-after-trim member through to `models`.

⚠️ **An empty red set is a finding, not a result.**

### T-22.4.2 — the knock-on, measured end to end (R22.4-5)

Drive a real council run from a preset whose members trim to a duplicate alias, and assert the
knock-on **from artifacts, not from reasoning**: `buildSeats` mints `alias#2`, the run dir gains the
`-2` artifact sibling, and `meta.seats` is present where it would otherwise be absent. Name the
fixture; do not reuse a bench that already repeats an alias, or the test proves nothing.

### T-22.4.3 — the rider (R22.4-6)

`report-md.js` and `report-html.js`: `s.model` → `s.seat || s.model` for street-cred rows. Pin a
twin bench rendering two distinguishable rows, and a unique-alias bench rendering **byte-identically**
to today. Named mutant `CREDALIAS` (revert to `s.model`).

### T-22.4.4 — the record

`BACKLOG.md` (tick SI-22.4 and its item-4 body), the phasing doc (status row 22.4 → DONE),
`CHANGELOG.md`.

⚠️ **Lead with R22.4-1**: the measured effect is resurrection — dropped members start running — and
say plainly that the filed framing named only the twin-bench knock-on. Give the six-row table.
⚠️ Record that this closes the `--models`/`--council` divergence (§0.3) and that the old behaviour
turned a trailing space into a **degraded exit 2** (§0.4).
⚠️ Record R22.4-6: the rider was homeless, deferred twice as *"SI-25-adjacent"*, and *"adjacent to
X"* is an association, not a schedule.
⚠️ Update the resume point: **v4.8.0 is now feature-complete; only the release run remains** —
version pin across 6 files → CHANGELOG → tag → `publish.yml`.
⚠️ Carry forward that `run-retry.js` is at 300/300 with no scheduled extraction.

Re-derive every citation against the FINAL tree. `output/` and dated plan snapshots are out of scope
— dated records, never "gitignored".
