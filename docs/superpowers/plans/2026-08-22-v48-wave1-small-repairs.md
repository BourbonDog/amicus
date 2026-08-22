# v4.8 Wave 1 — three small repairs, batched

**Branch:** `v48-wave1-small-repairs` · **BASE:** `97814f8f`
**Written:** 2026-08-22, just-in-time, immediately before development.
**Spec authority:** `docs/superpowers/plans/2026-08-16-v48-phasing-and-rulings.md` §5 Phases 6–7,
and `BACKLOG.md :: v4.8 release inventory`.

Three items, each a handful of lines, in three unrelated files. Batched into one PR because five
separate PRs for ~50 lines is ceremony — §5's own note says *"Phase 6 and 7 are mostly small and
several will combine"*, and the subagent method's own guidance is to batch small same-shape work.

**Wave structure this PR belongs to** (owner ruling 2026-08-22): Wave 1 batched · Wave 2 run
3-wide in isolated worktrees (SI-23 · #133 Piece 1 · SI-18, then SI-25 · #138) · Wave 2.5 R16 ·
Wave 3 strictly serial (SI-27, then SI-22.4 last for its bench-shape knock-on).

---

## §0. Measured substrate

Measured against `97814f8f` on 2026-08-22. Re-measure anything your own task changes; do not
re-derive the rest.

### §0.1 T6.6 — the `skills/` doc-fact gate (a LIVE defect)

`tally.js :: assignTier` returns **Confirmed** (`confidence: thin`) for `(a=1, d=0)` — established
by execution 2026-08-21, not read off the source. Two skill documents contradict it:

| file | says | correct? |
|---|---|---|
| `skills/second-opinion/SKILL.md:299` | Singleton is *"`d = 0` and `a < 2`"* | ❌ that makes `(1,0)` Singleton |
| `skills/second-opinion/COUNCIL-DESIGN.md:158` | same definition | ❌ |
| `docs/council.md:667` | Confirmed for `a === 1 && d === 0` (cascade table `:662-673`) | ✅ |
| `docs/council.md:671` | states it in prose | ✅ |

⚠️ **All four anchors were re-derived 2026-08-21 by opening each file, and two of the phasing
doc's own citations were wrong** (`COUNCIL-DESIGN.md:155` is the *Disputed* row, not Singleton;
`docs/council.md:662` is the cascade heading, not the deciding row). **Re-open all four again at
implementation time** — this file has now been edited since that check.

### §0.2 SI-14 — nothing pins "duplicates must survive to leg construction"

`src/sidecar/fanout-validate.js:22 :: parseModelsList` — measured, the whole function:

```js
function parseModelsList(modelsArg) {
  if (typeof modelsArg !== 'string') { return []; }
  return modelsArg.split(',').map(s => s.trim()).filter(Boolean);
}
```

Its docblock already says *"duplicates allowed"* (`:18`). **Owner ruling R3-2 — one re-vote leg per
seat — depends on `['gpt','deepseek','deepseek']` producing THREE legs, not two**, and that was
verified end-to-end through the real `runFanout`. But **nothing enforces it**: a future `uniq()` or
`new Set(...)` anywhere on the `--models` → leg-construction path would silently drop a twin's leg,
breaking R3-2 with no error, no failure outside that area, and a plausible-looking diff.

`tests/council/run-debate.test.js`'s `describe('runDebate — twin bench: joins on the seat, launches
on the alias', …)` (from `TWIN_BENCH = ['deepseek','deepseek','gpt']`, `:55`) already *exercises*
the invariant at the `runDebate` level — it just never **names** it.

Files already touching `parseModelsList` in tests: `tests/sidecar/fanout.test.js`,
`models-probe.test.js`, `retry-failed.test.js`, `tests/template/cli-wiring.test.js`.

### §0.3 #135 C0 — the backstop default is below what CI needs

```
src/utils/no-output-backstop.js:23        const DEFAULT_NO_OUTPUT_BACKSTOP_MS = 120000;
src/utils/no-output-backstop.js:27        envNumber('AMICUS_NO_OUTPUT_BACKSTOP_MS', DEFAULT_…, env)
.github/workflows/council-review.yml:240  # runs on 2026-08-12 lost every first leg to NO_OUTPUT_BACKSTOP
.github/workflows/council-review.yml:242  AMICUS_NO_OUTPUT_BACKSTOP_MS: '300000'
```

CI carries an override **because the default is too low**. Raising the default to `300000` retires
that override exactly.

⚠️ **It does NOT retire the owner's `900000`.** That is 3× the new default, and the only hard
evidence behind it is a kimi leg that died at 240 s with zero output, reasoning and tool calls.
**Leave any 900000 setting alone.**

### §0.4 Rulings

**W1-1 — three items, one PR.** Different files, no shared symbol, ~50 lines total. *Cost if
wrong:* one reviewer holds three small concerns at once.

**W1-2 — SI-14 ships as a TEST plus a comment, not a code change.** The invariant already holds;
what is missing is enforcement. Adding a `uniq` guard would be inventing a defect to fix. *Cost if
wrong:* nothing — a pin cannot break behaviour.

**W1-3 — two Phase 7 "Carried" items are DROPPED as never-specified, on the T6.5 precedent.**
`mcp-server.js:684 one-liner` and `listCouncilRuns dedupe (6 rows / 5 ids on real data)` each
appear **only** in the phasing doc's `Carried:` line (`:551`–`:552`) and in the release inventory
quoting it. No filed defect, no anchor, no description; the "6 rows / 5 ids" measurement exists
nowhere else. The owner dropped T6.5 on exactly this reasoning — *if it named something real it
will resurface with an actual defect behind it* — and that precedent is applied here rather than
re-asked. ⚠️ **Do not confuse the dropped dedupe with `BACKLOG.md`'s live entry *"Council runs are
invisible to CLI `amicus list`"*** (`mcp-council-awareness.js:205`), which is a different item, is
properly filed, and carries two open design decisions. That one stays.

**W1-4 — #135 C5 and the C2 probe are DEFERRED to v4.9 (owner ruling).** #135 self-describes as
*"a placeholder for a reminder for a brainstorming session"* and neither item has a measured
target. **R16 is NOT deferred** — its `sessions-index.json` growth defect is real and measured
(18,874 entries, 0.69 MB, 31.4 % pointing at dead paths; a full read→parse→mutate→write of the
whole index **on every session start**). ⚠️ But R16's own phrase *"pin all 13 unpinned rails"*
appears nowhere except that ruling row — **the number 13 is unsourced**. Scope R16 at Wave 2.5
from the growth entry, not from the ruling's wording.

---

## Global constraints

1. **No file may cross 300 lines** (rule: `content.split('\n').length`, minus 1 when the file ends
   in a newline). **EXTRACT — never shave a comment.**
2. **Every behaviour claim is measured, never argued** — admissible only with the command that
   produced it.
3. **Every behaviour change gets a named mutant with a red set measured at FULL `npx jest
   --no-coverage` scope.** A directory-scoped run under-counts, and a shrink is indistinguishable
   from a real alarm.
4. **Commit before running any mutant.** ⚠️ **Never** `git checkout -- <path>`, `git restore`,
   `git stash`, or `git checkout-index` — the rule is by **effect**, not spelling. Hand-revert and
   byte-verify with `git show HEAD:<path>`.
5. Anchor citations by **SYMBOL**. If you write a line number, open the file at it first.
6. `actionlint` runs inside the `quality` gate — a workflow edit must keep it green.

---

## Tasks

### T-W1.1 — the three repairs (one dispatch, batched)

**(a) T6.6 — docs.** Correct the Singleton definition in `skills/second-opinion/SKILL.md` and
`skills/second-opinion/COUNCIL-DESIGN.md` so it matches what `assignTier` actually does. ⚠️
**Re-open all four anchors first** (§0.1) — two of the phasing doc's citations for this were
already wrong once. ⚠️ **Verify `assignTier`'s behaviour by executing it**, do not trust §0.1.
Then grep the corrected phrase repo-wide: if `d = 0` / `a < 2` appears anywhere else as a
Singleton definition, it is a twin and it is now false.

**(b) SI-14 — the pin.** Add a named test asserting `parseModelsList('gpt,deepseek,deepseek')`
returns **three** entries with the duplicate intact, and state the invariant in one place:
*duplicates must survive to leg construction*, with **why** (owner ruling R3-2, one re-vote leg per
seat). Put it where `parseModelsList` is already tested. Named mutant **`MODELSUNIQ`** — wrap the
return in a de-duplication (`[...new Set(...)]`); record the measured red set at full scope.
⚠️ **If `MODELSUNIQ`'s red set is EMPTY, your pin does not reach the function** — that is a
finding, chase it, do not record a zero.

**(c) #135 C0 — the default.** `DEFAULT_NO_OUTPUT_BACKSTOP_MS` 120000 → 300000, and delete the now
redundant `AMICUS_NO_OUTPUT_BACKSTOP_MS: '300000'` at `council-review.yml:242` **together with the
explanatory comment above it**, which becomes false the moment the default matches. Leave any
`900000` alone. Update whichever existing tests assert the old default. Named mutant
**`BACKSTOPDEFAULT`** — revert to 120000; record the red set. ⚠️ An empty red set means the default
is unpinned: add the pin, do not record a zero.

### T-W1.2 — the record

`BACKLOG.md`, the phasing doc, `CHANGELOG.md`.

Mark T6.6, SI-14 and #135 C0 done. Record **W1-3** (the two dropped naked references, with the
grep that establishes they were never specified, and the explicit warning not to confuse the
dropped dedupe with the live `amicus list` entry) and **W1-4** (#135 C5 + C2 probe → v4.9; R16
retained but its "13 rails" phrase unsourced).

Re-derive every citation against the **final** tree by opening each file at its line. Grep the
distinctive phrase of anything corrected — a same-file sweep cannot find twins.
⚠️ `output/` and dated plan snapshots are **out of scope** for any sweep: run artifacts and dated
records, never "gitignored" as the reason.
