# v4.7 PR5 — Sweep theme (b): small code fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the 15 theme-(b) small-code sweep items (spec §8 / ruling R1), including ruling
**R5** (`--out` normalize + reject) and D18's first standing-note conversion, and **re-file the
deferred items' BACKLOG text with recon-corrected facts** so PR6 doesn't inherit wrong specs.

**Architecture:** Nine tasks grouped by file cluster. Unlike PR4 (comments/tests/docs), this PR
changes real behavior at six sites — each gets a CHANGELOG line and RED-first tests. No file in
this PR's roster is near the 300-line gate; the three AT-GATE files (`sidecar/fanout.js`,
`pack/pack-resolve.js`, `sidecar/electron-install.js`, all exactly 300) are **not touched by any
item here** — keep it that way.

**Tech Stack:** Node 22 CommonJS, jest. Repo: `C:\Users\sendt\code\amicus-wt-v47-pr5`
(worktree, branch `chore/v4.7-pr5-sweep-small-code`, base `b3f8892`).

**Grounding:** Recon workflow 2026-08-07 at `b3f8892` — 28 agents (7 tracers + 20 blind
adversarial verifiers + grounding). Every item below was re-verified OPEN with current line
numbers and a verified fix shape. **The verifiers refuted 9 of 20 fix shapes**; where a shape was
corrected, this plan carries the corrected one and says so. Baseline: 501 suites / 6768 passed /
7 skipped / 0 fail.

## Global Constraints

- **Locate everything by content, never by the line numbers in BACKLOG item text** — most cited
  line refs are stale (PR0–PR4 moved them). The line numbers *in this plan* were measured at
  `b3f8892` and are good, but re-confirm before editing.
- **Tight-file gate (300 physical lines, `split('\n')` arithmetic — `Measure-Object -Line`
  undercounts).** Nothing in this roster is close except `src/mcp-council-run.js` (285 → ~289
  after Task 7); if any task finds itself needing a second edit to that file, stop and report.
  **Never add a line to `src/sidecar/fanout.js`, `src/pack/pack-resolve.js`, or
  `src/sidecar/electron-install.js` — all three are at exactly 300 and one line fails the gate.**
- **Six behavior changes ship here** (T14-m1, T11-d, T5-m4, T15-m2, SR-2/R5, and T3-m1's message
  text). Each needs a `CHANGELOG.md [Unreleased]` line in Task 9. Everything else is internal.
- **TDD, RED first.** Every behavior change gets a test that fails before the fix and passes
  after. Every internal refactor gets a mutation proof (break the code, watch the test go red,
  restore). Record each in the task report.
- **Never weaken an existing assertion.** Where a test must change because the behavior
  legitimately changed (T14-m1, T11-d), retarget it and say precisely why in the report.
- **Ops:** `npx jest <path>` for unit suites. **NEVER** run a `*.integration.test.js` file
  directly and **never** `npm run test:all` — this machine has a live `OPENROUTER_API_KEY` and
  those rails bypass the keyless scrubbing and spend real money. The sanctioned rails are
  `npm test` and `npm run test:integration`. No bare `npm install`. Path-specific `git add`.
- **BACKLOG discipline (D17):** dispositions happen in Task 9 only, as `[x]` + a
  ` — done v4.7 PR5` suffix at each item's own line. Never delete item text.

---

### Task 1: pack-CLI cluster — T13-m1, T14-m7, T14-m1

**Files:**
- Modify: `src/pack/pack-cli.js:33` (T13-m1)
- Modify: `src/cli-handlers-pack.js` — `:77-79` + `:125-127` (T14-m7), `:155` + the `list` branch
  (T14-m1)
- Test: `tests/pack/cli-pack-cmd.test.js` (T14-m1 assertions flip stdout→stderr)

**Interfaces — Produces:** nothing new exported. `renderPackList(doc)` returns **data only** after
this task (no `Warning:` lines appended); callers that want warnings must write them themselves.

- [ ] **Step 1 (T13-m1): stop the fall-through.** `src/pack/pack-cli.js:33` currently is
`if (pr.error) { process.exit(failJson(useJson, pr.error)); }` followed immediately by
`for (const n of pr.notices) { ... }`. `applyPackToArgs`'s two error returns
(`pack-resolve.js:76`, `:262`) carry **no** `notices` key, so a test that stubs `process.exit`
non-throwing gets `TypeError: pr.notices is not iterable` instead of the asserted exit code.
Change to an early return:

```js
  if (pr.error) { return process.exit(failJson(useJson, pr.error)); }
```

(The sibling inline copy at `cli-handlers-council-run.js:55-56` already early-returns — this
makes the helper match.)

- [ ] **Step 2: prove it.** Add to `tests/pack/cli-pack-cmd.test.js` (or the pack suite that owns
`applyPackOrExit` — grep for `applyPackOrExit` under `tests/` and use that file) a test that
stubs `process.exit` as a **non-throwing** spy and drives a missing-pack ref through
`handleFanout`/`handleStart`, asserting the exit code was 1 and no `TypeError` escaped. Run it
against the OLD code first to see the `TypeError` (that is the RED), then apply Step 1.

- [ ] **Step 3 (T14-m7): collapse the duplicate lazy requires.** `src/cli-handlers-pack.js:77-79`
(inside `packFromWave`) and `:125-127` (inside `buildPackFromRun`) are byte-identical triples:

```js
  const fs = require('fs');
  const path = require('path');
  const { getSessionDir } = require('./session-manager');
```

Delete **both** blocks and add the three requires at module top beside the existing ones (~`:20-21`).
Verified safe: no circular require (`session-manager` does not require `cli-handlers-pack`), and
`getSessionDir` reads `AMICUS_CONFIG_DIR` at call time, so a module-top binding does not freeze
the test env. **Design note to carry into your report:** lazy `require('./session-manager')`
inside handler bodies is the house CLI-startup idiom (`cli-handlers-abort.js:49/97/158/228`,
`cli-handlers-watch.js:55`, `mcp-council-awareness.js:47`), so hoisting *this* file deviates from
it. If you judge the idiom worth preserving, the alternative is to keep one lazy require and pass
`getSessionDir` (or the resolved dir) from `buildPackFromRun` into `packFromWave` — either way the
duplication dies. Pick one, implement it, and state the reasoning.

- [ ] **Step 4 (T14-m1): warnings to stderr.** `renderPackList` (`src/cli-handlers-pack.js:155`)
ends with `for (const w of doc.warnings) { text += \`Warning: ${w}\n\`; }`, and `:203` writes that
whole string to **stdout** — so `amicus pack list | grep` mixes diagnostics into data. `pack save`
already writes the identical string to **stderr** (`:191`). Fix:
  1. Delete the warnings loop from `renderPackList` so it renders data only.
  2. In the `sub === 'list'` human branch (after the `process.stdout.write(...renderPackList(doc))`
     at ~`:203`), add:

```js
    for (const w of doc.warnings) { process.stderr.write(`Warning: ${w}\n`); }
```

  3. Leave the `--json` path completely untouched — `warnings` stays a field on the JSON doc.

- [ ] **Step 5: retarget the pins.** `tests/pack/cli-pack-cmd.test.js`'s corrupt-pack test
(~`:152-163`) asserts `stdout()` contains `'Warning:'` and `'broken.json'`. Those two expectations
move to `stderr()`. **Strengthen while you are there:** also assert `stdout()` does *not* contain
`'Warning:'` — that is the actual bug this fixes, and without it the test would pass even if the
warning were written to both streams. The `'No packs.'` `toBe('No packs.\n')` assertion at ~`:149`
stays byte-exact and gets stricter for free.

- [ ] **Step 6: run + mutate.** `npx jest tests/pack/` green. Mutation for T14-m1: put the
warnings loop back in `renderPackList` → the new `stdout` negative assertion must FAIL; restore.
Mutation for T14-m7: none needed (pure refactor — the suite passing IS the proof, but confirm
`npx jest tests/pack/cli-pack-cmd.test.js` exercises both `packFromWave` and `buildPackFromRun`;
if either is uncovered, say so).

- [ ] **Step 7: Commit.**
`git add src/pack/pack-cli.js src/cli-handlers-pack.js tests/pack/cli-pack-cmd.test.js`
`git commit -m "fix(pack): T13-m1 early-return past the notices loop; T14-m7 dedupe lazy requires; T14-m1 pack list warnings to stderr"`

---

### Task 2: T11-d — the pack critic+lenses hole (verifier-corrected shape)

**Files:**
- Modify: `src/pack/pack-validate.js` (hoist the check out of the array-bench branch)
- Modify: `tests/pack/cli-council-pack.test.js:203-210` (retarget — see Step 3)
- Modify: `tests/pack/pack-validate.test.js` (new positive pin in the by-name-bench describe)
- Decide: `src/cli-handlers-council-run.js:130-133` (dead-branch call — see Step 4)

**The defect:** `pack-validate.js:90`'s
`if (pack.critic && pack.lenses) { errors.push('critic and lenses are mutually exclusive'); }`
sits **inside** the `else if (Array.isArray(bench) && bench.length >= 2)` branch. A **string**
bench takes the earlier `typeof bench === 'string'` branch (`:78-83`), which only pushes the
"deferred to run time" warning — so a council pack with `bench: 'trio'` + `critic` + `lenses`
passes validation in **both** save and run mode.

**⚠️ The verifier's decisive find:** `tests/pack/cli-council-pack.test.js:100-104` defines
`CRITIC_LENSES_CONFLICT_PACK` with a **string** bench + critic + lenses, and the test at
`:203-210` asserts it reaches the *handler's* error. **That test is green only because this hole
exists.** The hoist will break it, and that is correct — plan for it, do not "fix" the hoist.

- [ ] **Step 1: write the RED.** In `tests/pack/pack-validate.test.js`, find the by-name-bench
describe (~`:183-195`) and add:

```js
  test('a string bench does NOT excuse critic+lenses (T11-d)', () => {
    const pack = {
      schemaVersion: 1, type: 'pack', name: 'by-name-conflict', version: '1.0.0', kind: 'council',
      description: 'x', bench: 'trio', chair: null, critic: 'alpha', lenses: ['sec', 'perf'],
      options: {}, briefing: {},
    };
    const res = validatePack(pack, { mode: 'run' });
    expect(res.ok).toBe(false);
    expect(res.errors).toContain('critic and lenses are mutually exclusive');
  });
```

Run it: `npx jest tests/pack/pack-validate.test.js` → this test FAILS (`res.ok` is `true` today).

- [ ] **Step 2: hoist the check.** In `src/pack/pack-validate.js`, add above the bench `if/else`
chain (the check is bench-**independent**, unlike chair-is-a-seat / critic-in-bench / lenses-count,
which legitimately defer for a by-name bench):

```js
  // T11-d: bench-independent — a by-name bench used to skip this entirely, so a pack
  // could carry both and only fail (mis-attributed) at handler time.
  if (pack.kind === 'council' && pack.critic && pack.lenses) {
    errors.push('critic and lenses are mutually exclusive');
  }
```

and **delete** the copy at `:90`. Re-run Step 1's test → GREEN. Verify the neighbor at
`pack-validate.test.js:~186` (string bench, `critic: null`, lenses only) still yields a *warning*,
not an error.

- [ ] **Step 3: retarget the now-broken test.** `tests/pack/cli-council-pack.test.js:203-210` will
now fail: `applyPackToArgs` rejects earlier at `pack-resolve.js:91-98` with
`Error: pack 'critic-lenses-conflict' failed validation: critic and lenses are mutually exclusive`
(code `PACK_INVALID`), so the old assertions — `'--critic and --lenses ...'` (dashes absent from
the validate wording) and `"(set by pack '...')"` — no longer hold. Rewrite it as what the
behavior now *is*:

```js
  test('a pack supplying BOTH critic and lenses fails PACK_INVALID pre-spend (T11-d)', async () => {
    store().writePack(CRITIC_LENSES_CONFLICT_PACK());
    // ...drive handleCouncilRun exactly as the old test did...
    expect(doc.error.code).toBe(ERROR_CODES.PACK_INVALID);
    expect(doc.error.message).toMatch(/critic and lenses are mutually exclusive/);
    expect(runCouncil).not.toHaveBeenCalled();
  });
```

State in your report that the old test's *subject* — pack attribution on the handler's
mutual-exclusion error — ceases to exist by design.

- [ ] **Step 4: the dead-branch decision (report it, do not guess).** With the hoist in place,
`cli-handlers-council-run.js:132`'s `packSuffix('critic') || packSuffix('lenses')` becomes
**unreachable from a pack**: `pack-resolve.js:140/:143` already suppress both explicit-flag ×
pack-field crossings, so pack-supplies-both was the only live route to a pack-attributed suffix
there. Do **not** merely reword it — that would be dressing an unreachable branch. Read the site,
decide **delete vs. keep-with-a-comment**, implement your choice, and justify it in the report
with the reachability argument. (Keeping it with an honest "unreachable since T11-d; retained
because the explicit-flag path still needs the message" comment is acceptable **if** you verify
the explicit-flag path really does still reach that line.)

- [ ] **Step 5: verify the blast radius yourself.** The verifier checked these and found them
unaffected — confirm, don't assume: `tests/pack/pack-validate.test.js:99-105` (array bench),
`tests/cli-council-run.test.js:38`, `tests/mcp-council-run.test.js:77` (explicit flags, no pack),
`tests/pack/pack-resolve.test.js:248-266` (XOR suppression), `tests/pack/mcp-pack-params.test.js`.
The MCP surface is covered for free — `applyPackToMcpInput` reuses `applyPackToArgs` →
`validatePack` run mode (`src/mcp-council-run.js:120`).

- [ ] **Step 6: run + commit.** `npx jest tests/pack/ tests/cli-council-run.test.js tests/mcp-council-run.test.js` green.
`git add src/pack/pack-validate.js tests/pack/pack-validate.test.js tests/pack/cli-council-pack.test.js` (+ `src/cli-handlers-council-run.js` if Step 4 edited it)
`git commit -m "fix(pack): T11-d — critic+lenses is bench-independent; a by-name bench no longer skips the check"`

---

### Task 3: usage-text cosmetics — T5-m6, T14-m6

**Files:**
- Modify: `src/cli.js` — the `fanout:` block (~`:469-489`) and the `pack:` block (`:696-725`)
- Test: `tests/utils/known-flags.test.js` (new regression pin — see Step 3)

**⚠️ THE HAZARD THAT GOVERNS THIS TASK:** `src/utils/known-flags.js:68` **derives the accepted-flag
set by scraping `getUsage()`** for `--([a-z][a-z0-9-]*)`. Six flags appear **only** inside the
`pack:` usage block: `--kind`, `--bench`, `--no-debate`, `--version`, `--description`,
`--from-run`. Dropping any of them while compressing makes `amicus pack save --kind …` fail with
an unknown-flag rejection. **Every `--flag` token in the current block must survive verbatim.**

- [ ] **Step 1 (T5-m6): fix the ragged column.** In the `fanout:` block, the description column is
32 (1-indexed) for 22 rows but **33** for these: `--retry-failed <waveId>` (`:469` + its
continuations `:470-473`), `--gateway <mode>` (`:480`), `--follow` (`:481`), `--on-complete <cmd>`
(`:482` + continuations `:483-489`). Delete **exactly one leading space** from each of those 15
lines so every description starts at column 32. Continuation lines drop in lockstep with their
flag line. **Zero non-whitespace edits** — no token, word, or wrap point changes. (The `spend:`
block is uniformly 33 and internally consistent — it is *not* part of this item; leave it.)

- [ ] **Step 2: verify by eye and by machine.** `node bin/amicus.js fanout --help` — the columns
now line up. Then confirm the flag set is unchanged (Step 3's test covers this permanently).

- [ ] **Step 3: write the known-flags regression pin FIRST** (before touching the `pack:` block —
this is the net that catches a compression mistake). In `tests/utils/known-flags.test.js`:

```js
test('the pack usage block is the sole source of six flags — compressing it must not drop them', () => {
  const flags = getKnownFlags();
  for (const f of ['kind', 'bench', 'no-debate', 'version', 'description', 'from-run']) {
    expect(flags).toContain(f);
  }
});
```

(Match the file's own accessor — read how existing tests obtain the flag set and reuse that shape;
`getKnownFlags()` may return a Set, in which case use `.has`.) Run it: GREEN today. Mutation:
delete `--kind` from the usage block → FAILS; restore.

- [ ] **Step 4 (T14-m6): compress the `pack:` block.** Rewrite the body (`:696-725`) from 30 lines
to ~10-12, matching the `provider:`/`init:`/`spend:` house style. Keep the sub-command lines
(`pack save <name> --kind council|fanout|solo [flags]`, `pack save <name> --from-run <id>`,
`pack list`, `pack show`, `pack rm`) and collapse the deeply-hanging per-flag sub-list into 3-4
grouped prose lines, e.g.:

```
    Flags: --bench <a,b,c|name> (council/fanout) · --model (solo) · --chair/--critic/--lenses
    (council) · --debate/--no-debate (council) · --timeout/--max-cost/--gateway (shared) ·
    --agent/--thinking/--summary-length (fanout/solo) · --template <name|path> (reference only,
    not rendered) · --version <semver> (default 1.0.0; unchanged re-save is a no-op, changed
    auto-bumps patch) · --description <text>
```

Adapt wording/wrapping to the block's real style — the invariant is the flag tokens, not my prose.

- [ ] **Step 5: run.** `npx jest tests/utils/known-flags.test.js tests/pack/` green, plus any
usage/docs suite that snapshots help text (`git grep -l "getUsage" tests/` and run those). Then
`node scripts/generate-docs.js --check` — if the help text feeds generated docs, regen and include
the regen in this commit.

- [ ] **Step 6: Commit.**
`git add src/cli.js tests/utils/known-flags.test.js` (+ any regenerated doc)
`git commit -m "style(cli): T5-m6 align the fanout help column; T14-m6 compress the pack usage block (flag tokens pinned)"`

---

### Task 4: template cluster — T3-m1, T5-m4

**Files:**
- Modify: `src/template/render.js:38-44` (T3-m1 empty-key guard)
- Modify: `src/template/apply.js:69` (T5-m4 project normalize) and `:55`, `:58`, `:73` (hints)
- Test: `tests/template/render.test.js`, `tests/template/apply.test.js`

- [ ] **Step 1 (T3-m1): the unfollowable remedy.** Reproduced live: a template containing
`{{var.}}` renders the error `Error: template uses {{var.}} but no --var =<value> was given` —
and `--var =<value>` is itself **rejected** by the parser (`apply.js:41-44` requires `eq >= 1`).
So the message tells the user to run a command that cannot work. In `renderTemplate`'s
`name.startsWith('var.')` branch, add an empty-key guard **before** the `!(key in vars)` lookup:

```js
      if (key === '') {
        return { error: `Error: Unknown template variable {{var.}} — {{var.<key>}} requires a key. Known: ${knownList()}` };
      }
```

- [ ] **Step 2: RED-first test.** In `tests/template/render.test.js`, beside the existing
`{{var.missing}}` case (~`:73`), add a case rendering `'Hi {{var.}} there'` and assert the error
does **not** contain `'--var ='` and does mention that a key is required. Confirm it FAILS before
Step 1's edit.

- [ ] **Step 3 (T5-m4a): normalize `{{project}}`.** `apply.js:50` resolves the artifact path
(`artifactPath = path.resolve(String(artifactFile))`) but `:69` passes `project: String(project)`
raw — callers hand it `args.cwd || process.cwd()`, so a relative or non-normalized `--cwd` renders
verbatim into the briefing. Change `:69` to:

```js
    project: path.resolve(String(project)),
```

(`path` is already required at `apply.js:13`.) **Do NOT resolve inside `render.js`** —
`renderTemplate` stays a pure interpolator.

- [ ] **Step 4: fix the test ripple this causes.** `tests/template/apply.test.js:30-32` passes
`project: '/proj'` and asserts `/in \/proj$/`. On Windows `path.resolve('/proj')` is `C:\proj`, so
that assertion must become **path-derived**: build the expected string from
`path.resolve('/proj')` rather than hardcoding the POSIX form. Run on this Windows box to confirm.

- [ ] **Step 5 (T5-m4b): real hints on TEMPLATE_RENDER.** All three `TEMPLATE_RENDER` returns
(`apply.js:55`, `:58`, `:73`) carry `hint: null`, while the sibling `TEMPLATE_NOT_FOUND` at `:28`
carries `hint: 'amicus template list'`. Give each a real, *followable* hint: `:55`/`:58` are the
artifact read-failure and the 256 KB cap → a path/size-oriented hint; `:73` is the strict-render
violation → point at the variable contract (`'amicus template show <name>'`, or the known-variable
list — `KNOWN_VARIABLES` is exported from `render.js:87`). One static hint per site; no new
plumbing. **Every hint you write must name something that actually exists** — verify each command
or path you reference.

- [ ] **Step 6: pin the hints.** Add assertions that each of the three error paths returns a
non-null `hint` (and, for the one you can drive most cheaply, that the hint's text matches).
Mutation: revert one hint to `null` → that assertion FAILS; restore.

- [ ] **Step 7: run + commit.** `npx jest tests/template/` green; also
`npx jest tests/bin/preflight-json-envelope.test.js tests/template/cli-wiring.test.js` (they drive
these error paths through the handlers).
`git add src/template/render.js src/template/apply.js tests/template/render.test.js tests/template/apply.test.js`
`git commit -m "fix(template): T3-m1 empty-key {{var.}} message; T5-m4 resolve {{project}} and give TEMPLATE_RENDER real hints"`

---

### Task 5: SR-2 / ruling R5 — `--out` normalize + reject

**Files:**
- Modify: `src/cli.js:104-116` (the `-o` short-alias branch of `parseArgs`)
- Modify: `src/cli-handlers-council.js:174` (the R1 guard in `runVerdict`)
- Test: `tests/council/cli-handlers-council.test.js` (extend the R1 pins at ~`:396`, `:423`) and
  a parser-level pin (find the suite that tests `parseArgs` — `git grep -l "parseArgs" tests/`)
- Docs (Task 9 handles the CHANGELOG; docs edits belong **here** with the code): `docs/council.md`
  (~`:648` usage line, ~`:699` prose), `src/cli.js:577` help text if wording changes

**Owner ruling R5 (spec §2, §8/D19):** *"Normalize + reject — `--out` consumes values like every
other flag, asymmetric form gets the standard error; CHANGELOG-lined."*

**Measured today (empirically, against the real parser):**

| input | today | after |
|---|---|---|
| `--out -x` | `out === '-x'` → writes a file literally named `-x` | BAD_ARGS |
| `-o -x` | `out === true` | BAD_ARGS |
| `--out` (bare) | `out === true` → BAD_ARGS already | BAD_ARGS |
| `--out=` | `out === ''` → BAD_ARGS already | BAD_ARGS |
| `-o out.json` / `--out out.json` | `out === 'out.json'` | **unchanged** |

Root cause: `cli.js:109` tests `if (next && !next.startsWith('-'))` for `-o`, while the generic
long-option branch at `:132` tests `!next.startsWith('--')`. The two branches disagree.

**Consumer map (verified exhaustively — these are the ONLY two):** `src/cli-handlers-council.js:174`
(the guard) and `:178` (`const outPath = args.out || './verdict.json'`). No MCP, pack, or electron
consumer reads `args.out`. **`--out-dir` is a separate key** (`out-dir`, consumed at
`mcp-council-run.js:170`, `run-state.js:9`, `run-scan.js:75`) — untouched; say so in the PR body so
a reviewer does not conflate them.

- [ ] **Step 1: RED at the parser.** Add a test asserting `parseArgs(['council','verdict','t.json','-o','-x']).out === '-x'` — it FAILS today (yields `true`). This pins the *normalization*.

- [ ] **Step 2: normalize.** Change the `-o` branch's test at `cli.js:109` to the same
`!next.startsWith('--')` shape the long branch uses, and add a one-line comment stating the two
branches are deliberately lockstep. Step 1 goes GREEN.

- [ ] **Step 3: RED at the consumer.** Add a test driving
`handleCouncil({ _: ['council','verdict', <tally path>], out: '-x' })` and asserting `BAD_ARGS`.
It FAILS today (`'-x'` is a "legitimate string", so `:178` resolves it and
`writeVerdictAtomic('-x', verdict)` writes a file named `-x` in cwd — the exact class R1 was
written to stop, one form short).

- [ ] **Step 4: reject.** Widen the existing R1 guard at `cli-handlers-council.js:174` from
`(typeof args.out !== 'string' || args.out === '')` to additionally refuse a leading dash:

```js
  if (typeof args.out !== 'string' || args.out === '' || args.out.startsWith('-')) {
```

Reuse the **same** `ERROR_CODES.BAD_ARGS`, message, and hint already there ("asymmetric form gets
the standard error" — R5). If you extend the message to name the offending token (v4.5.3
strict-CLI voice), keep the two hint strings at `:152`/`:176` byte-identical to each other, and
note the wording choice in your report.

- [ ] **Step 5: confirm the whole matrix.** Assert all five forms in the table above, including
that the two **valid** forms still work unchanged (that is the regression guard). The existing R1
pins (`out: true` at ~`:396`, `out: ''` at ~`:423`) are the templates — extend, don't replace.

- [ ] **Step 6: docs.** Update `docs/council.md` (~`:648` `[-o|--out <out.json>]` usage line, ~`:699`
"override with -o/--out") only if the wording changed; `src/cli.js:577`'s help text likewise. Then
`node scripts/generate-docs.js --check` (regen + include if it reports drift). **Do not** write the
CHANGELOG line here — Task 9 owns `[Unreleased]` to avoid a merge race with itself.

- [ ] **Step 7: run + commit.** `npx jest tests/council/ tests/utils/known-flags.test.js tests/pack/args-explicit.test.js` green
(the last two carry the only other `-o` fixtures, both well-formed — they must stay green).
`git add src/cli.js src/cli-handlers-council.js tests/council/cli-handlers-council.test.js <parser test file> docs/council.md`
`git commit -m "fix(cli): R5 — --out/-o parse in lockstep and reject dash-leading values (was: -o -x silently became boolean, --out -x wrote a file named -x)"`

---

### Task 6: SR-3 — the EISDIR unremovable bucket

**Files:**
- Modify: `src/utils/session-metadata-tmp-sweep.js:58-63`
- Modify: `src/utils/session-index-tmp-sweep.js:35-40`
- Test: the two suites that own them (`tests/doctor-metadata-tmp-sweep.test.js`,
  `tests/doctor-tmp-sweep.test.js`, plus any direct unit suite — grep for
  `listSessionMetadataTmpFiles`)

**The defect:** `isMetadataTmp` filters on **name only**, so a *directory* named
`.metadata.json.123.abc.tmp` passes. `listTmpIn` then lstats it purely for `mtimeMs` — which a
directory has — so it survives the `.filter((f) => f.mtimeMs !== null)` and is reported as an
orphan file. `unlinkSync` on it throws EISDIR (POSIX) / EPERM (Windows), gets swallowed by the
best-effort catch, and the doctor row reads `swept N, 1 remaining (too fresh or unremovable)`
**forever**, with no way to tell which bucket it is in.

- [ ] **Step 1: RED.** Add a fixture that `mkdir`s a name-shaped **directory** inside a session dir
and asserts `listSessionMetadataTmpFiles()` returns `[]`. Today it returns one entry — that is the
RED. Mirror it for the index sibling.

- [ ] **Step 2: fix, reusing the stat you already take.** Both sites already stat inside the map
just to read `.mtimeMs` — capture the stat object instead of adding a second syscall. In
`session-metadata-tmp-sweep.js:58-63`:

```js
      let st = null;
      try { st = fs.lstatSync(p); } catch { /* raced away */ }
      return { name, mtimeMs: st && st.isFile() ? st.mtimeMs : null };
```

The existing `.filter((f) => f.mtimeMs !== null)` at `:63` then drops directories, symlinks,
sockets and FIFOs with **zero new control flow**.

- [ ] **Step 3: same shape at the sibling — but keep its syscall.** Apply the identical structure at
`session-index-tmp-sweep.js:35-40`. **That sibling uses `statSync`, not `lstatSync` — do not
silently upgrade it.** The metadata file's `lstat` choice is documented at
`session-metadata-tmp-sweep.js:27-31`; changing the index sibling's is a separate symlink-policy
decision with its own reasoning. Keep `statSync().isFile()` there and add a one-line comment
recording the deliberate divergence.

- [ ] **Step 4: leave the throwing-unlink test alone.** It explicitly pins *never-crash*, not a
fix — add alongside it, don't modify it. Add a one-line docblock note that name-shaped directories
are excluded by design.

- [ ] **Step 5: run + mutate.** `npx jest tests/doctor-metadata-tmp-sweep.test.js tests/doctor-tmp-sweep.test.js`
plus any direct unit suite, green. Mutation: drop the `st.isFile()` condition → the new RED tests
fail again; restore.

- [ ] **Step 6: Commit.**
`git add src/utils/session-metadata-tmp-sweep.js src/utils/session-index-tmp-sweep.js <test files>`
`git commit -m "fix(doctor): SR-3 — name-shaped directories no longer land in the tmp sweep's unremovable bucket"`

---

### Task 7: council/MCP cluster — T15-m2, SR-5

**Files:**
- Modify: `src/mcp-council-run.js` — `:97-103` (capture) + `:150-162` (seed). **285 lines now;
  this fix lands it at ~289. Do not make any other edit to this file in this PR.**
- Modify: `src/council/run-chair.js:218`/`:224` (SR-5 literal hoist; 277 → 278)
- Modify: `src/council/run-state.js:104-106` — the stale comment this fix invalidates
- Test: `tests/mcp-council-run.test.js`

- [ ] **Step 1 (T15-m2): RED.** The MCP council path discards template provenance: `run.json`
records pack provenance but no template `{name,hash}`, unlike the CLI's `run.template`. Add a test
asserting that a pack-forwarded `input.template` lands `run.template.{name,hash}` on the seeded
`run.json`, and a companion asserting **no** `template` key appears when `input.template` is
undefined (absent, not null). The first FAILS today.

- [ ] **Step 2: capture and seed (3 lines).** In `src/mcp-council-run.js`:
  1. Before the template block: `let templateMeta = null;` (mirrors `cli-handlers-council-run.js:82`).
  2. Inside `if (input.template !== undefined) { ... }` at `:97-103`, after `briefing = t.prompt;`:
     `templateMeta = t.promptMeta && t.promptMeta.template;` (the CLI's `:90` line, defensive form).
  3. In the `runState.initRun(runDir, {...})` literal, beside the existing
     `...(packRecord ? { pack: packRecord } : {})` and `...(droppedMembers.length ? { droppedMembers } : {})`:
     `...(templateMeta ? { template: templateMeta } : {}),` — same absent-not-null comment voice.

Merge safety is already proven by the `pack`/`droppedMembers` precedent: the spawned CLI child's own
seed passes `template: null` (`cli-handlers-council-run.js:198`) and `run-state.js:106`'s
`...(o.template ? ... : {})` omits the key, so `mergeRun`'s shallow merge preserves the pre-seeded
value. `schemas/council-run.schema.json:49` already declares `"template": { "type": "object" }` —
**no schema change**.

- [ ] **Step 3: kill the comment this makes false.** `src/council/run-state.js:104-106` carries the
F9 note *"the MCP seed (mcp-council-run.js, initRun directly) never sets this in v4.5"* — that
becomes untrue the moment Step 2 lands. Update it to state what is now true. (This is the exact
comment-staleness class PR4 spent its whole review budget on; do not leave it.)

- [ ] **Step 4 (SR-5): hoist the ch4 literal.** `src/council/run-chair.js` builds
`` `${o.runId}-ch4` `` twice — at `:218` (`runState.appendStageWave(o.runDir, 'chair', ...)`) and
`:224` (`waveId:`). ch1–ch3 were already converged to a single binding (`:178` `waveId1`, `:183`
`waveId2`, `:194` `waveId3`). Insert immediately before `:218`, inside the
`if (chairText && !overallVerdict && !overBudget())` block:

```js
      const waveId4 = `${o.runId}-ch4`;
```

and use it at both sites. ch4 cannot use `attemptChair` (different prompt/model, no
`recordAttempt`) — which is *why* the raw pair survived; the convergence here is the hoist, not a
call-site unification. Byte-identical waveId string ⇒ no CHANGELOG line, no behavior change.

- [ ] **Step 5: run + mutate.** `npx jest tests/mcp-council-run.test.js tests/council/` green.
Mutation for T15-m2: remove the `template` spread → the new pin FAILS; restore. For SR-5: change
`waveId4` to a different literal → any ch4 fixture assertion fails (if none exists, say so and
rely on the byte-identical argument, stated explicitly in your report).

- [ ] **Step 6: Commit.**
`git add src/mcp-council-run.js src/council/run-chair.js src/council/run-state.js tests/mcp-council-run.test.js`
`git commit -m "fix(council): T15-m2 MCP council runs record template provenance; SR-5 hoist the ch4 waveId literal"`

---

### Task 8: two hardening one-liners — T16-m1, SR-4

**Files:**
- Modify: `src/sidecar/workspace-auto-open.js:37` (T16-m1)
- Modify: `.github/workflows/publish.yml:130` (SR-4)
- Test: `tests/sidecar/workspace-auto-open.test.js`, `tests/scripts/publish-workflow.test.js`

- [ ] **Step 1 (T16-m1): RED.** `shouldAutoOpenWorkspace` destructures `env` without a default at
`:37` and reads `env.DISPLAY` at `:58`, so a Linux call with `env: undefined` **throws**, though
the JSDoc at `:26` documents `env` as always an object. The suite's helper
(`shouldAutoOpenWorkspace({ ...BASE, ...over })` at ~`:51`) makes this a one-line case: add a test
passing `env: undefined` with `platform: 'linux'` and assert `{ open: false, reason: 'no-display' }`.
It throws today.

- [ ] **Step 2: fix.** Default the destructured param at `:37`: `env = {},`. Preferred over a
defensive guard at `:58` because it protects every future `env.*` read and needs no comment. Pure
hardening — the observable decision for every documented call shape is unchanged.

- [ ] **Step 3 (SR-4): escape the BRE dots.** `.github/workflows/publish.yml:130` interpolates
`$VERSION` (a semver like `4.7.0`) into a **BRE** grep, where each `.` matches any character. The
false-match direction is fail-toward-**skip** — i.e. a silently dropped release — which is why it
is worth tightening even though it is not exploitable. Add one line just above the `if`, inside the
same `run:` block:

```yaml
          VERSION_RE=$(printf '%s' "$VERSION" | sed 's/[.]/\\./g')
```

and swap `\"$VERSION\"` → `\"$VERSION_RE\"` in the **version** grep only (the `status`/`active`
grep interpolates nothing and needs no change). **Do not reach for `grep -F`** — the pattern still
needs the `[[:space:]]*` classes. **Do not restructure the compound `if`** —
`tests/scripts/publish-workflow.test.js:149-159` pins its exact shape.

- [ ] **Step 4: pin it.** Extend that same test file's registry-skip block (~`:137-159`) with an
assertion that the version grep no longer contains a bare interpolated `$VERSION` inside the quoted
needle — e.g. assert the skip condition matches `/VERSION_RE/` **and** that a `VERSION_RE=`
assignment with a dot-escaping `sed` appears in the same step block. Keep the existing D6 comment
at `:122-129` and append one sentence explaining the escape and the fail-toward-skip direction.

- [ ] **Step 5: run + commit.** `npx jest tests/sidecar/workspace-auto-open.test.js tests/scripts/publish-workflow.test.js` green.
Also `npm run lint` (you touched a `src/` file) and, if the repo lints workflows,
`actionlint` runs in CI — make sure the YAML stays valid (a syntax error here breaks the release
pipeline, so re-read the block once before committing).
`git add src/sidecar/workspace-auto-open.js .github/workflows/publish.yml tests/sidecar/workspace-auto-open.test.js tests/scripts/publish-workflow.test.js`
`git commit -m "fix: T16-m1 default env in the workspace auto-open guard; SR-4 escape the registry version grep's BRE dots"`

---

### Task 9: D18 standing note, BACKLOG dispositions, CHANGELOG, deferred re-files

**Files:**
- Modify: `src/utils/config.js:419-421` (the standing note)
- Modify: `BACKLOG.md` (dispositions + the deferred items' corrected text + one stale cross-ref)
- Modify: `CHANGELOG.md` (`[Unreleased]`)

- [ ] **Step 1 (D18 / ruling R4): move the droppedMembers watch-note to its code site.** The note
is a tripwire, not a defect — verified: `classifyCouncilMembers` (`src/utils/config.js:429-446`)
pushes exactly two `reason` literals (`:434`, `:441`), and **no consumer branches on the string**
(`presets-cli.js:149-150` displays it; `run.js:80-87` puts it in a degrade payload;
`cli-council-run-bench.js:74` only type-checks it). Extend the `@returns` docblock above
`classifyCouncilMembers` with a standing note stating: the two reason strings are free text, are
display-only today (name both consumers), and **a third reason being added is the tripwire** to
re-decide whether `reason` should become a coded enum.
**Correct the shape while transcribing:** the BACKLOG says `{ref, reason}`; the produced shape is
`{member, reason}` (`config.js:434`/`:441`). The docblock must state the real key.

- [ ] **Step 2: BACKLOG dispositions.** Tick each item this PR fixed with `[x]` +
` — done v4.7 PR5` at its own line (re-locate by ID token; work **bottom-up** so numbers stay
stable): T3-m1, T5-m4, T5-m6, T11-d, T13-m1, T14-m1, T14-m6, T14-m7, T15-m2, T16-m1, plus the
v4.6.3 riders for the `--out` asymmetry (R5), the EISDIR bucket, the BRE dot escape, and the
run-chair ch4 literals. The droppedMembers carry gets
` — standing note: moved to src/utils/config.js docblock (v4.7 PR5)`.
**Do NOT tick** anything in the deferred list below.

- [ ] **Step 3: fix a stale cross-reference.** `BACKLOG.md:~1032-1033` still says *"the separate
`errorWave` call site was deliberately left out of this fix — see the still-open errorWave carry
above"*. That carry is **closed** (shipped in #123, ticked in PR4). Correct the sentence.

- [ ] **Step 4: re-file the deferred items with recon-corrected facts.** This is a real deliverable:
PR6 must not inherit specs the verifiers already disproved. For each item below, **append a
`— recon 2026-08-07:` note** to its BACKLOG entry (do not delete the original text):
  - **T19-m1** — the proposed "capture blind and bail" fix is **regressive**: in the
    panel-closed-mid-flight window it leaves a settled-bailed promise cached, giving a
    *permanently blank* panel (worse than today's wrong titles). There is also a deterministic,
    race-free path the item misses (open → close → flip blind → reopen returns the cached settled
    promise). Correct shape: unconditional `delete loading[id]` in `wireLazyPanels`' sameRun arm,
    plus re-calling `files()` in the completion handler and remapping titles by `name` (blind-independent).
  - **T19-m2** — the genuinely unterminated path is `drillIntoJudge`'s derived promise, whose
    production caller (`workspace-matrix.js:79`) discards it; terminate **there**. Once
    `p.catch(...)` is attached inside `loadPanel`, the two fire-and-forget sites can no longer
    produce unhandled rejections, so the wrapper the item proposes is not the fix.
  - **PR1F-1** — the guard belongs in the two bench **resolvers** (`cli-council-run-bench.js`
    `resolveBench`, `mcp-council-bench.js` `resolveBenchInput`), not the CLI handler: the MCP path
    creates the run dir, writes `briefing.md`, seeds `run.json` as `running`, and writes the
    pointer **before** spawning, so a handler-only guard leaves an orphaned `running` run.
    Rider: `amicus council save` accepts duplicate members too.
  - **PR1F-2** — there is a **fourth** builder the item never names (`mk` in `debate.js:102-109`),
    and the real hazard is **key order** (not `findingsUnverified`): `JSON.stringify` preserves
    insertion order, so unification changes `run.json` bytes for every debate row carrying a
    `waveId`, and the existing `toEqual`/`toMatchObject` pins are order-insensitive and would not
    catch it. Also `mk`'s `l.status || 'unknown'` vs `buildRunStatsEntry`'s `leg ? leg.status : 'error'`
    diverge. Correct shape needs `buildRunStatsEntry` extracted to a **pure** module (`debate.js`
    is declared DI-free with zero requires). Stays deferred to its own TDD pass, as filed.
  - **PR1F-3** — **five** engine-born sites take the `'clean'` default, not two (add
    `run-stage2.js:122` and `run-stages.js:244`), and the item's proposed
    `solo.leg && res.ok ? 'repaired' : 'unstructured'` expression is a **constant**: the push at
    `run-stages.js:181` precedes `res = validateFindings(...)` and sits inside a `while (!res.ok ...)`
    loop, so `res.ok` is always false there. Use a flat literal, or move the pushes below
    validation — an explicit design call. Do **not** flip the `|| 'clean'` default (primary error
    rows depend on it).
  - **PR1F-4** — the proposed `r.status === 'error'` gate is **too narrow**: the leg-status
    vocabulary includes `'timed-out'`, a primary retry trigger, so the gate would never fire for
    the very case the retry text exists for. Also there is exactly **one** production call site
    (`workspace-seats.js:47`), not two, and the live-tick path never goes through
    `seatsFromRunStats` at all — so the fix is terminal-path-only. Line budget: `live-model.js`
    is 284/300 and the honest implementation is +20-30, so it needs the helper to land in
    `workspace-seats.js` (132) instead.
  - **W1-M4** — "eventually consistent" is **conditional**: `sidecar/fanout.js`'s leg-routing pass
    and budget preflight both return **before** the wave-record write, so a child that exits there
    leaves `briefing.md` permanently raw — and `list-search.js:56` reads that file as the
    `--search` corpus, making it a permanently-wrong *search surface*, not a cosmetic window.
    There is also a repo ruling in the opposite direction (`tests/mcp-start-metadata.test.js:96-105`
    pins `briefing: renderedPrompt` for parity with the CLI's on-disk file).
  - **W1-M5** — the proposed MCP trailer names `maxCost`/`noCostGate`, which **do not exist on
    `amicus_start`** (they belong to `amicus_council_run`), and `noCostGate` is unreachable by any
    route on that path. The ceiling can only have arrived from a pack, so the honest MCP text is
    pack-flavored; and the refusal has **two** branches (`overCeiling` vs the per-$/Mtok
    threshold) whose remedies differ — the second has *no* override over MCP at all. Also
    `budget.js:74`'s ceiling line is a second CLI-flavored string on the same path.

- [ ] **Step 5: CHANGELOG.** Add to `[Unreleased]`, matching the section vocabulary
(`### Changed` uses a bolded lead clause + em-dash rationale; `### Fixed` uses the
"was accepted and silently ignored" strict-CLI voice). Six behavior changes need coverage —
group them honestly rather than padding: the R5 `--out` rejection (this is the headline; note that
`--out -x` previously wrote a file named `-x`), `pack list` warnings moving to stderr, the pack
critic+lenses hole closing, `{{project}}` now path-resolved, MCP council runs recording template
provenance, and the `{{var.}}` message. Put R5 under `### Changed` (it rejects a previously-accepted
parse) and the rest where they fit.

- [ ] **Step 6: verify BACKLOG hygiene.** `git diff BACKLOG.md` must show **only** checkbox flips,
suffix additions, the corrected cross-reference, and the appended `— recon 2026-08-07:` notes —
**zero deletions of item text**. Confirm the tick count matches the item list in Step 2.

- [ ] **Step 7: docs gate.** `node scripts/generate-docs.js --check` clean (regen + include if
drift). Run the docs suites: `git grep -l "usage.md\|CHANGELOG" tests/` and run what that names.

- [ ] **Step 8: Commit.**
`git add src/utils/config.js BACKLOG.md CHANGELOG.md`
`git commit -m "docs: D18 standing note for droppedMembers; BACKLOG dispositions for theme (b); re-file the deferred items with recon-corrected facts"`

---

### Task 10: gates, final review, PR (controller-run, no implementer)

- [ ] Full suite: `npm test` (baseline 501 suites / 6768; expect a modest test delta).
- [ ] `npm run lint` + `npm run check:sizes`. Confirm `src/mcp-council-run.js` ≤ 300 and that
  `fanout.js` / `pack-resolve.js` / `electron-install.js` are still exactly 300 (untouched).
- [ ] `npm run test:integration` (the sanctioned keyless rail) — Task 8 touched the publish
  workflow; the quality gate runs `actionlint` in CI, so also eyeball the YAML diff once more.
- [ ] `git fetch origin`; merge and re-run the suite if `origin/main` moved.
- [ ] **Plan committed?** — `git status` must show no untracked plan file. (It is committed up
  front this time; verify anyway.)
- [ ] Fable whole-branch final review via `review-package b3f8892..HEAD`, with the ledger's
  Minors triaged; consolidated fix wave if findings.
- [ ] Push (`GIT_TERMINAL_PROMPT=0 git -c credential.helper= -c credential.helper='!gh auth git-credential' push -u origin chore/v4.7-pr5-sweep-small-code`, ≥5-min timeout — the pre-push hook reruns the full suite).
- [ ] Open the PR (`gh -R BourbonDog/amicus`). Body: the 15 items, the six behavior changes called
  out individually, the R5 ruling, the deferred-item re-files with their corrected facts, and the
  riders. Watch all 11 CI checks.

## Deferred (explicit — do not sweep in)

**To PR6 (theme c: GUI + M-sized):** T19-m1, T19-m2, T20-m2, SR-1 (the `Object.create(null)`
family — its GUI boundary overlaps T20-m2's `existing` map, so they belong together), PR1F-4,
W1-M4, W1-M5, W1-M6/M7, T5-m3 (the triplicated template-block extraction — note the
`known-flags.test.js` scan only reads top-level `src/cli*.js`, so the new module **must** be named
`src/cli-template-args.js` or the args reads leave the guard's reach), and the remaining
watch-notes' D18 conversions.

**To its own TDD pass (as originally filed):** PR1F-2 (`legRow` unification), PR1F-1 and PR1F-3
(both need design rulings recorded before implementation).
