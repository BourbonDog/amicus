# Council leg completion — PR 3 of 3: surface what the tally already knows (#242) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A seat whose findings came from a repair nothing could verify stops passing as a full review: the report's "What was lost" gains one row per such seat (and one per refused repair), and `verdict.json`'s `seatsReviewed` census gains a third number, `unverified`, which the council-review check title and sticky comment print when it is non-zero.

**Architecture:** Nothing new is computed at run time. `run-stages.js :: runStage1` already marks a review `findingsUnverified: true` (the original response carried no parseable findings block, so the bounded repair's "same findings, fixed" contract could not be checked) and `repairRefused: {code, detail}` (the contract was checked and broken); both ride the `runStats` row through `tally.json` into `verdict.json` and died at the renderer. A new leaf, `src/council/report-lost-rows.js :: lostRowsOf(runStats)`, turns those rows into `makeDegrade` records at RENDER time; `report.js :: toModel` appends them to the model's `degrades` after the sink's own records, so both renderers print them through `formatDegrade` (the one voice) with no renderer edit. `verdict-seats-reviewed.js :: seatsReviewedOf` adds `unverified`; the schema declares it; the workflow's two jq census reads print it when `> 0`.

**Tech Stack:** Node.js (CommonJS), Jest, Ajv (schema pins), GitHub Actions + jq (the two census reads in `.github/workflows/council-review.yml`).

**Spec:** `docs/superpowers/specs/2026-09-11-council-leg-completion-design.md` §5 ("Sub-fix 3 — surface what the tally already knows (#242)"), §6 (data flow), §7 (rollout). Issue #242 (revised 2026-09-11) is the filing; its 2026-09-11 comment carries the two measurements §0 quotes below.

## Global Constraints

- Branch `feat/council-unverified-surfacing` off `main` `5541bb44` (PR #247 merged 2026-09-13). PR targets `main`; carries the `council-review` label; merges only after its council run **completes** (`verdict.json` `overallVerdict` + `seatsReviewed`, never the check colour). The push and `gh pr create` are the owner's call — the controller STOPS before them.
- Every commit ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Plan edits are force-added (`git add -f docs/superpowers/plans/...`; the directory is gitignored but tracked).
- **300-line gate** (`scripts/check-file-sizes.js`, `> 300` fails): `src/council/report.js` is **299/300** and lands at exactly **300** after Task 1 (one added `require` line; the `degrades:` edit and the one comment edit replace lines one-for-one). `src/council/verdict-seats-reviewed.js` is 60. The new leaf is budgeted at 60–90 lines. Never add a second line to `report.js`.
- **Data source is `runStats`, nothing new is computed, nothing new is written.** No sink note, no `run.json`/`verdict.json.degrades[]` entry, no exit-code change, no new flag. Rows are derived from `verdict.runStats` when the report is built, so re-rendering a pre-4.9.8 `verdict.json` shows them too (ruling R1 below).
- **One voice.** Rows are `makeDegrade` records rendered through `formatDegrade`; their channels (`unverified-repair`, `repair-refused`) are registered in `DEGRADE_CHANNELS` (`tests/council/degrade-contract.test.js` "DRIFT PIN" reads every `channel: '…'` literal in `src/`).
- **The wording never says "stub"** (spec §5; #242 comment: in study run B2 qwen-flash carried the flag on a real 19,064-byte review whose trailing JSON block was malformed). Exact row text — `what` / `why` / `effect` — is fixed by Task 1 and quoted by the CHANGELOG and docs; do not paraphrase it anywhere.
- **Byte-identity.** A verdict with no flagged row renders byte-identically to `main` in both formats (named mutant **ROWALWAYS** must redden). `verdict.json` for a record with no bench rows is unchanged (no census key). A record WITH bench rows gains `unverified` inside the census — the one deliberate byte change to `verdict.json` (ruling R2).
- `seatsReviewed` shape and key order: `{ reviewed, unverified, of }`. `reviewed` keeps its meaning; `unverified` counts bench-role rows (`seat`, `critic`, `lens:<slug>`) carrying `findingsUnverified === true`; `repairRefused` rows are NOT counted in `unverified` (ruling R3). Both `lostRowsOf` and the census test the flag with `=== true` — the producer (`tally.js`) emits it only as the literal `true`.
- Tests: RED/GREEN classified per test; GREEN-at-HEAD preservation pins are proven by a named mutant, measured on the COMMITTED tree (commit first; apply the edit; run; `git checkout -- <the one mutated file>`; confirm `git diff --stat` is empty). Named mutants: **ROWALWAYS**, **REFUSEDDROP** (Task 1), **CENSUSZERO** (Task 2), **TITLEBLIND** (Task 3). Record each measured red set in the test file's docblock in a follow-up commit — never pre-write a number into a commit message or source comment.
- Sanctioned test commands only: `npx jest <file …>` for unit files; `npm test` (the pre-push gate, the only writer of `.test-passed`); `npm run test:integration` (keyless). Never `--testMatch` / `--testPathIgnorePatterns`; never `npm run test:all`; never anything that spends.
- Never `git checkout -- <file>` while other uncommitted edits exist. Never `npm install` (postinstall mutates global Claude config). Write test files and workflow edits with the editor tool, never a bash heredoc (heredocs on this machine collapse `\\` to `\`, and Task 3's test asserts a literal `\(` inside a JS string).
- Docs edited in place: `docs/council.md` (three sites, exact text given), `CHANGELOG.md` `## [Unreleased]` → `### Fixed` (new bullet after the PR 1 bullet), `schemas/council-verdict.schema.json`, and `docs/architecture-map.md` regenerated by `node scripts/generate-docs.js` and STAGED in the same commit that adds the new module (the pre-commit hook regenerates it in write mode but a stale committed map fails `tests/scripts/generate-docs-check.test.js`).
- Sweep after every prose edit: grep the distinctive phrase of each sentence you changed, repo-wide (`docs/ src/ tests/ CHANGELOG.md BACKLOG.md README.md`), uncapped, and fix every twin.

---

## §0 — Measured at plan-writing time (2026-09-13, `main` = `5541bb44`)

**Where the flag is born and where it dies (file:line, re-read for this plan):**
- `src/council/run-stages.js:247-258` — `unverified = true` when `conformance === 'repaired' && attemptedCount === null`; `repairRefused = { code: 'REPAIR_CHANGED_FINDING_COUNT', detail: \`repair returned ${n} findings, original attempted ${m}\` }` when the count differs (then `conformance = 'unstructured'`, findings `[]`); the review is pushed with `text: m.text` either way (`:258-267`), and `run-stage2.js:114` labels EVERY review into the judge bundle — so a refused-repair seat's prose still reaches the judges.
- `src/council/run-assemble.js:199` → `run-stats-entry.js:79-80` (emit-when-set on the runStats row) → `tally.js:178-179` (allowlist: `...(r.findingsUnverified ? { findingsUnverified: true } : {})`, `...(r.repairRefused ? { repairRefused: r.repairRefused } : {})`) → `verdict.js:125` (`runStats: record.runStats`, verbatim). Only primary review rows ever carry either flag (grep of `src/` for `findingsUnverified`: run-assemble.js:199, run-stages.js:266, run-stats-entry.js:79, tally.js:178; nothing in run-stage1-rows.js).
- `src/council/report.js:279` — `degrades: (verdict.degrades || []).filter(d => d.kind !== 'heal' && d.kind !== 'info')` is the ONLY source of "What was lost" in both renderers (`report-md.js:54-58`, `report-html.js:66-67,83-85`); `toModel` has exactly one caller (`report.js:291 buildReport`). `m.degrades` is read by nothing else.
- `src/council/verdict-seats-reviewed.js:44-58` — `seatsReviewedOf`: `reviewed` = bench rows with `status === 'complete'`, `of` = bench rows; `isBenchRole` = `seat` | `critic` | `lens:*`; emit-when-set (no bench rows → `{}`).
- `schemas/council-verdict.schema.json:232-241` — `seatsReviewed` has `additionalProperties: false`, `required: ["reviewed", "of"]`, so the census MUST be declared before `buildVerdict` writes it (else `tests/council/run-schema-debate.test.js` "the verdict buildVerdict derives from it validates" goes red — that twin tally has a `role: 'seat'` row). `tests/schemas.test.js` validates `buildVerdict(tally(avInput))`, whose runStats rows are `role: 'council'` (legacy) → no census there.
- `.github/workflows/council-review.yml:763` (check-run TITLE) and `:873` (sticky-comment `SEATS_LINE`) are the two census reads. `tests/scripts/council-review-workflow.test.js:136-151` pins that both segments contain `seatsReviewed` and that EVERY line containing `seatsReviewed` matches `/if \.seatsReviewed|\/\/ *""|\/\/ *empty/` — a nested `if .seatsReviewed.unverified > 0` on the same line satisfies it. `jq` is NOT installed on this machine; the expression is validated by reasoning from jq's documented ordering (`null < false < true < numbers`, so `null > 0` and `0 > 0` are both `false`) and by the first labelled council run on the PR, which is the PR's own gate anyway.
- `src/utils/degrade.js:14-45` — `DEGRADE_CHANNELS`; `makeDegrade` requires non-blank `what`/`why`/`effect`, optional `remedy`, optional plain-object `data`; `formatDegrade` renders `` `${lead}: ${what} — ${why}. ${effect}.${remedy}\n` `` with lead `Notice` for kind `degrade`.
- Sizes: `report.js` 299, `report-md.js` 174, `report-html.js` 173, `verdict-seats-reviewed.js` 60, `degrade.js` 96, `verdict.js` 292.
- `.eslintrc.js`: no `max-len`; `quotes: single, avoidEscape`; `curly: all`; `eqeqeq`; `no-console` in `src/`.
- The Workspace GUI has no reader of `seatsReviewed` (`src/workspace/`, `electron/`: 0 hits); its "lost" panels read `run.json.degrades` (`src/workspace/seat-space.js:129`, `live-normalize.js:134`) — out of this PR's scope (spec §5 names report.html and seatsReviewed); recorded as a follow-up in Task 3's CHANGELOG sentence? NO — see Follow-ups at the end; the CHANGELOG states only what ships.

**The fixture (ruling R6):** glove-breakin-01's artifacts (spec §5's example, `{reviewed: 4, unverified: 3, of: 5}`) are not on this machine. Study run **D0** (`SecondBrain/output/council-leg-study-2026-09-11/runs/D0/`, same brief and seats, the on-demand reproduction #242's comment cites) is: `runStats` = kimi/grok/qwen `role: 'seat'`, all three `conformance: 'repaired', findingsUnverified: true, status: 'complete'`, plus three `role: 'repair'` rows, three judges, one chair (10 rows); `verdict.json` carries `intent: "task"`, `overallVerdict: "Insufficient"`, `seatsReviewed: {"reviewed": 3, "of": 3}` (the PRE-4.9.8 census), no `degrades` key. Rendered on `main` today through `buildReport`: **md 2007 bytes, html 12560 bytes, no "What was lost"** — the byte-identity baseline Task 1 pins for the flag-stripped document. Files are 13,233 B (`tally.json`) and 11,393 B (`verdict.json`), findings are eight glove-care claims — nothing sensitive.

**Quoted from #242's 2026-09-11 comment (the measurement this plan builds on):** "D0 … produced three narration stubs of 171–383 B, all `conformance: repaired` + `findingsUnverified: true` … `run.json` reported `complete`, exit 0, and no `degrades` key at all." and "In B2 … qwen-flash came back `repaired` + `findingsUnverified: true` on a real **19,064-byte** review whose trailing JSON block was malformed. The flag means exactly what `run-stages.js:247` says … true of a vacuous repair and of a good review alike."

**Rulings made while writing this plan (each: what — why — cost if wrong):**
- **R1 — render-time derivation in `toModel`, not a sink note.** The spec says "data source: runStats, no new computation" and names only the report and the census; a sink `degrade` record would flip `degraded` and the exit code (a behaviour change the owner did not approve), and an `info` record renders under Notes, not "What was lost". Cost if wrong: the run's end-of-run stderr and the Workspace's lost-seat panels do not show the rows; a later change can add a sink `info` note with the same channel names (registered by this PR).
- **R2 — `unverified` is ALWAYS written inside the census (0 is a measurement), key order `reviewed / unverified / of`; the schema DECLARES it but does not REQUIRE it** (documents written before 4.9.8 still validate; the repo's convention is additive/documentary schema edits, `schemaVersion` stays 2). Cost if wrong: every `verdict.json` with a census changes by one key; emit-when-non-zero would be a one-line change plus a schema note.
- **R3 — `unverified` counts `findingsUnverified === true` bench rows only; `repairRefused` seats get a "What was lost" row but are not counted.** The spec's "seats whose findings are flagged" is the LC-11 flag; a refused repair tallied NO findings, so "unverified findings" would misdescribe it — its row says what happened. Cost if wrong: a reader wanting refused repairs in the number reads the row instead; adding them is a one-term change.
- **R4 — the row's seat label is `r.seat || r.model`**, the rule the street-cred rows already use (`report-md.js:112`, `report-html.js:57`): the seat id when the bench repeats an alias, else the alias.
- **R5 — test placement.** The spec names `tests/council/report-html*.test.js` and `verdict-seats-reviewed.test.js`; neither exists. Report tests go in a new `tests/council/report-unverified.test.js`; census tests join the existing `#202` describe in `tests/council/verdict.test.js`; the workflow pin joins `tests/scripts/council-review-workflow.test.js`.
- **R6 — fixture = study run D0, verbatim**, at `tests/council/fixtures/study-d0/{tally.json,verdict.json,README.md}` (the directory `tests/council/fixtures/` already holds `av-receiver-input.js`; `generate-docs` skips `fixtures` directories; `tests/workspace/fixtures.test.js` enumerates its three run dirs by name, so a new directory under `tests/council/fixtures/` is invisible to it).

**Pre-flight conflict scan (pairs sharing a file/interface):**

| Pair | Producer → consumer | Finding |
|---|---|---|
| T1 `lostRowsOf` ↔ T2 `seatsReviewedOf` | both read `runStats[].findingsUnverified === true`; T1 also reads `repairRefused` | consistent by construction (both `=== true`; R3 keeps `repairRefused` out of the count) — no shared code needed, each is a leaf |
| T1 `degrade.js` channels ↔ T1 drift pin | `DEGRADE_CHANNELS` gains two ids; the pin greps `src/` for `channel:` literals | the new leaf's literals are registered in the same commit — the pin stays green |
| T2 schema ↔ T2 code | `buildVerdict` writes `unverified`; the schema has `additionalProperties: false` on the census | land in ONE commit (Step order inside Task 2: test RED → code + schema → GREEN) |
| T2 census ↔ T3 workflow | jq reads `.seatsReviewed.unverified` | T3 follows T2; an older verdict (no key) prints as before (`null > 0` false) |
| T1 report.js ↔ 300-line gate | 299 → 300 | exactly at the limit; the gate is `> 300` |
| T1 docs paragraph ↔ T3 docs bullets | three separate sites in `docs/council.md` | no overlap; T3's sweep covers T1's phrase too |

---

## File structure

- Create `src/council/report-lost-rows.js` — the leaf: `lostRowsOf(runStats) → Array<makeDegrade record>` (60–90 lines).
- Create `tests/council/report-unverified.test.js` — rows, rendering in both formats, ordering, byte-identity, mutant record.
- Create `tests/council/fixtures/study-d0/tally.json`, `verdict.json` (verbatim copies), `README.md` (provenance, 6 lines).
- Modify `src/utils/degrade.js` — two channel ids + comment (inside `DEGRADE_CHANNELS`, after `'stage2-judge'`).
- Modify `src/council/report.js` — one `require` line (→ 300 lines), the `degrades:` line, one comment line.
- Modify `src/council/verdict-seats-reviewed.js` — `unverified`, docblock, `@returns`.
- Modify `schemas/council-verdict.schema.json` — declare `unverified`.
- Modify `tests/council/verdict.test.js` — V1–V9 expectations, V10–V14.
- Modify `.github/workflows/council-review.yml:759-763` and `:867-873`; `tests/scripts/council-review-workflow.test.js` (one test).
- Modify `docs/council.md` (report paragraph — Task 1; verdict key note, repair paragraph, runStats row clause — Task 3), `CHANGELOG.md` (Task 3), `docs/architecture-map.md` (regenerated, Task 1).

---

### Task 1: The rows — `report-lost-rows.js`, the two channels, the `toModel` hook, the D0 fixture, the report tests

**Files:**
- Create: `src/council/report-lost-rows.js`
- Create: `tests/council/report-unverified.test.js`
- Create: `tests/council/fixtures/study-d0/tally.json`, `tests/council/fixtures/study-d0/verdict.json`, `tests/council/fixtures/study-d0/README.md`
- Modify: `src/utils/degrade.js` (the `DEGRADE_CHANNELS` literal, after `'stage2-judge',` at line 41)
- Modify: `src/council/report.js:18-20` (add one `require`), `:266` (one comment line), `:279` (the `degrades:` line)
- Modify: `src/council/report-md.js:50-51` (the section-guard comment — see Step 6 item 4)
- Modify: `docs/council.md:996-998` (the `amicus council report` "What it renders" paragraph)
- Regenerate: `docs/architecture-map.md` (`node scripts/generate-docs.js`)

**Interfaces:**
- Consumes: `makeDegrade` / `formatDegrade` / `DEGRADE_CHANNELS` from `src/utils/degrade.js`; `verdict.runStats` rows as written by `tally.js:167-197` (`findingsUnverified: true` emit-when-true; `repairRefused: {code, detail}` emit-when-set; `seat` emit-when-different).
- Produces: `lostRowsOf(runStats)` — `runStats` any value (schema-free entry points); returns `[]` unless an array; for each plain-object row, in order: an `unverified-repair` record when `row.findingsUnverified === true`, then a `repair-refused` record when `row.repairRefused` is a plain object. Records are frozen `makeDegrade` output, `kind: 'degrade'`, `data: { seat }` / `data: { seat, code }`. Task 2's census must agree with the `=== true` test. Task 3 quotes the exact `what`/`why`/`effect` strings below into docs and CHANGELOG.

- [ ] **Step 1: Copy the fixture and write its provenance note**

```bash
mkdir -p tests/council/fixtures/study-d0
cp "/c/Users/sendt/OneDrive/AIProjects/SecondBrain/output/council-leg-study-2026-09-11/runs/D0/tally.json" tests/council/fixtures/study-d0/tally.json
cp "/c/Users/sendt/OneDrive/AIProjects/SecondBrain/output/council-leg-study-2026-09-11/runs/D0/verdict.json" tests/council/fixtures/study-d0/verdict.json
```

Write `tests/council/fixtures/study-d0/README.md`:

```markdown
# Study run D0 (2026-09-11 council leg-failure study) — verbatim

`tally.json` and `verdict.json` exactly as the engine wrote them (run `20dde633`, task intent,
seats kimi/grok/qwen). All three seats came back as narration stubs, were repaired, and carry
`findingsUnverified: true` on their `runStats` rows; the run reported `complete`, exit 0, no
`degrades`. `verdict.json` is the PRE-4.9.8 document: its census is `{reviewed: 3, of: 3}`.
The fixture for #242 / spec §5 (tests/council/report-unverified.test.js, verdict.test.js V12).
```

Verify the copy: `node -e "const t=require('./tests/council/fixtures/study-d0/tally.json'); console.log(t.runStats.filter(r=>r.findingsUnverified===true).map(r=>r.model))"` → `[ 'kimi', 'grok', 'qwen' ]`.

- [ ] **Step 2: Write the failing test file**

Create `tests/council/report-unverified.test.js` with exactly this content (editor tool, not a heredoc):

```js
// tests/council/report-unverified.test.js
'use strict';

/**
 * #242 / spec §5 (v4.9.8, PR 3 of 3): the report surfaces what the tally already knows.
 *
 * `run-stages.js :: runStage1` marks a review `findingsUnverified: true` when the ORIGINAL
 * response carried no parseable findings block — the bounded repair's contract ("the same
 * findings, fixed") could not be checked — and `repairRefused: {code, detail}` when the
 * contract was checked and broken. Both ride the runStats row through tally.json into
 * verdict.json (tally.js's allowlist) and, before this change, died at the renderer: "What was
 * lost" was built from the sink's `degrades[]` alone. Study run D0 (2026-09-11) is the fixture:
 * three narration stubs, three repairs, `3 of 3` reviewed, and report.html said nothing.
 *
 * Rows are derived from `verdict.runStats` at RENDER time (`report-lost-rows.js ::
 * lostRowsOf`), appended to the model's `degrades` AFTER the sink's own records, and rendered
 * through `formatDegrade` — the one voice — by both renderers untouched. Nothing is written to
 * run.json or verdict.json, so re-rendering a pre-4.9.8 verdict.json shows the rows too (the D0
 * verdict.json on disk IS such a document: its census is the old `{reviewed, of}`).
 *
 * The wording never says "stub": the flag also fires on a real 19,064-byte review whose
 * trailing JSON block was malformed (study run B2, qwen-flash).
 *
 * Named mutants (exact edits in src/council/report-lost-rows.js; red sets measured on the
 * committed tree and recorded here by the implementer):
 *   ROWALWAYS   — `if (r.findingsUnverified === true) { rows.push(unverifiedRow(r)); }`
 *                 → `rows.push(unverifiedRow(r));` (every row becomes a loss). Red set: TBD-MEASURE
 *   REFUSEDDROP — the `if (isPlainObject(r.repairRefused)) { rows.push(refusedRow(r)); }` statement removed.
 *                 Red set: TBD-MEASURE
 */

const fs = require('fs');
const path = require('path');
const { buildReport, toModel } = require('../../src/council/report');
const { buildVerdict } = require('../../src/council/verdict');
const { tally } = require('../../src/council/tally');
const { lostRowsOf } = require('../../src/council/report-lost-rows');
const { formatDegrade, DEGRADE_CHANNELS } = require('../../src/utils/degrade');
const avInput = require('./fixtures/av-receiver-input');

const FX = path.join(__dirname, 'fixtures', 'study-d0');
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(FX, name), 'utf-8'));

const base = (extra) => ({
  schemaVersion: 2, type: 'council-verdict', runId: 'r1', runType: 'council',
  date: '2026-09-13', chair: 'deepseek', council: ['alpha', 'beta'],
  claudeInCouncil: false, overallVerdict: null,
  findings: [], streetCred: [], runStats: [],
  tierCounts: { Confirmed: 0, Contested: 0, Singleton: 0, Disputed: 0 },
  ...extra,
});
const seatRow = (model, extra) => ({ model, role: 'seat', wasChair: false, conformance: 'clean',
  status: 'complete', durationMs: 1, usage: null, ...extra });
const DEAD_LEG = {
  kind: 'degrade', channel: 'dead-leg', what: 'seat beta did not review',
  why: "the leg ended 'timeout' with no usable output", effect: '1 of 2 seats reviewed',
};

// The exact voice line (formatDegrade output without its trailing newline). Task 3's docs and
// CHANGELOG quote the what/why/effect; a paraphrase anywhere is a defect.
const UNVERIFIED_LINE = (seat) => `Notice: seat ${seat}'s findings came from a repair of a response with no findings block — nothing verified them. the tiers they were given rest on the repair alone; the seat still counts as reviewed.`;
const REFUSED_LINE = "Notice: seat beta's repair was refused (REPAIR_CHANGED_FINDING_COUNT) — repair returned 2 findings, original attempted 3. the seat contributed no findings; its review text still reached the judges and it counts as reviewed.";

describe('lostRowsOf — the rows the tally already knows (#242, spec §5)', () => {
  test('D0: one unverified-repair row per flagged seat, in runStats order, as frozen makeDegrade records', () => {
    const rows = lostRowsOf(readJson('tally.json').runStats);
    expect(rows.map(r => r.channel)).toEqual(['unverified-repair', 'unverified-repair', 'unverified-repair']);
    expect(rows.map(r => r.data.seat)).toEqual(['kimi', 'grok', 'qwen']);
    for (const r of rows) {
      expect(r.kind).toBe('degrade');
      expect(Object.isFrozen(r)).toBe(true);
      expect(formatDegrade(r)).toBe(`${UNVERIFIED_LINE(r.data.seat)}\n`);
    }
  });

  test('a refused repair gets a repair-refused row naming the code, with the detail as the why', () => {
    const rows = lostRowsOf([seatRow('beta', { conformance: 'unstructured',
      repairRefused: { code: 'REPAIR_CHANGED_FINDING_COUNT', detail: 'repair returned 2 findings, original attempted 3' } })]);
    expect(rows).toHaveLength(1);
    expect(rows[0].channel).toBe('repair-refused');
    expect(rows[0].data).toEqual({ seat: 'beta', code: 'REPAIR_CHANGED_FINDING_COUNT' });
    expect(formatDegrade(rows[0])).toBe(`${REFUSED_LINE}\n`);
  });

  test('a refused repair with no code/detail (hand-assembled input) still renders, with fallbacks', () => {
    const rows = lostRowsOf([seatRow('beta', { repairRefused: {} })]);
    expect(rows).toHaveLength(1);
    expect(rows[0].what).toBe("seat beta's repair was refused (REPAIR_REFUSED)");
    expect(rows[0].why).toBe('the repair broke its contract');
    expect(rows[0].data).toEqual({ seat: 'beta', code: 'REPAIR_REFUSED' });
  });

  test('the seat LABEL is the seat id when the bench repeats an alias, else the alias (the street-cred rule)', () => {
    const rows = lostRowsOf([seatRow('kimi', { seat: 'kimi#2', findingsUnverified: true }),
      seatRow('grok', { findingsUnverified: true })]);
    expect(rows.map(r => r.data.seat)).toEqual(['kimi#2', 'grok']);
    expect(rows[0].what).toContain("seat kimi#2's");
  });

  test("a row carrying BOTH facts yields both rows, unverified first — the exclusivity is the producer's, not the renderer's", () => {
    const rows = lostRowsOf([seatRow('x', { findingsUnverified: true, repairRefused: { code: 'C', detail: 'd' } })]);
    expect(rows.map(r => r.channel)).toEqual(['unverified-repair', 'repair-refused']);
  });

  test('emit-when-TRUE, matching the producer: a truthy non-boolean flag is not a flag, a string repairRefused is not a refusal', () => {
    expect(lostRowsOf([seatRow('x', { findingsUnverified: 'yes' }), seatRow('y', { findingsUnverified: 1 })])).toEqual([]);
    expect(lostRowsOf([seatRow('z', { repairRefused: 'REPAIR_CHANGED_FINDING_COUNT' })])).toEqual([]);
  });

  test('tolerates every schema-free shape the report entry points can deliver', () => {
    for (const bad of [undefined, null, {}, 'runStats', 42, [], [null, 42, 'x', {}, [], true]]) {
      expect(lostRowsOf(bad)).toEqual([]);
    }
  });

  test('never says "stub", and both channels are registered (the degrade-contract drift pin reads src/)', () => {
    const rows = lostRowsOf(readJson('tally.json').runStats)
      .concat(lostRowsOf([seatRow('b', { repairRefused: { code: 'C', detail: 'd' } })]));
    expect(rows).toHaveLength(4);
    for (const r of rows) { expect(`${r.what} ${r.why} ${r.effect}`).not.toMatch(/stub/i); }
    expect(DEGRADE_CHANNELS.has('unverified-repair')).toBe(true);
    expect(DEGRADE_CHANNELS.has('repair-refused')).toBe(true);
  });
});

describe('the report renders the rows through the one voice, in both formats', () => {
  const verdict = readJson('verdict.json'); // the PRE-4.9.8 document: census {reviewed, of}

  test('the fixture is the pre-4.9.8 verdict.json — the rows come from runStats, not from a rebuild', () => {
    expect(verdict.seatsReviewed).toEqual({ reviewed: 3, of: 3 });
    expect('degrades' in verdict).toBe(false);
    const m = toModel(verdict);
    expect(m.degrades.map(d => d.data.seat)).toEqual(['kimi', 'grok', 'qwen']);
    expect(m.notes).toEqual([]);
  });

  test('md: a What-was-lost section between the tier table and the matrix, one line per seat', () => {
    const md = buildReport({ verdict }, { format: 'md' });
    const lost = md.indexOf('## What was lost');
    expect(lost).toBeGreaterThan(md.indexOf('_Tiers report peer concurrence, never verification._'));
    expect(lost).toBeLessThan(md.indexOf('## Adjudication matrix'));
    for (const seat of ['kimi', 'grok', 'qwen']) { expect(md).toContain(`- ${UNVERIFIED_LINE(seat)}`); }
  });

  test('html: the section table carries the channel column and the voice line', () => {
    const html = buildReport({ verdict }, { format: 'html' });
    expect(html).toContain('<h2>What was lost</h2>');
    expect((html.match(/<td>unverified-repair<\/td>/g) || []).length).toBe(3);
    expect(html).toContain(`<td>${UNVERIFIED_LINE('kimi')}</td>`);
  });

  test("the sink's own records come FIRST; the runStats rows are appended after them", () => {
    const v = base({ degrades: [DEAD_LEG], runStats: [seatRow('alpha', { findingsUnverified: true })] });
    expect(toModel(v).degrades.map(d => d.channel)).toEqual(['dead-leg', 'unverified-repair']);
    const md = buildReport({ verdict: v }, { format: 'md' });
    expect(md.indexOf('seat beta did not review')).toBeLessThan(md.indexOf("seat alpha's findings"));
  });

  test('a heal or info record is still not a loss; an unverified row still is', () => {
    const v = base({
      degrades: [{ kind: 'info', channel: 'ledger-skipped', what: 'w', why: 'y', effect: 'e' },
        { kind: 'heal', channel: 'stage1-retry', what: 'h', why: 'y', effect: 'e' }],
      runStats: [seatRow('alpha', { findingsUnverified: true })],
    });
    const m = toModel(v);
    expect(m.notes.map(d => d.channel)).toEqual(['ledger-skipped']);
    expect(m.degrades.map(d => d.channel)).toEqual(['unverified-repair']);
  });
});

describe('byte-identity: a verdict with no flagged row renders exactly as before (mutant ROWALWAYS)', () => {
  test('av-receiver (three rows, no flags): no rows, no section — GREEN at HEAD by construction, pinned by ROWALWAYS', () => {
    const v = buildVerdict(tally(avInput), []);
    expect(v.runStats.length).toBeGreaterThan(0);
    expect(toModel(v).degrades).toEqual([]);
    for (const format of ['md', 'html']) {
      expect(buildReport({ verdict: v }, { format })).not.toContain('What was lost');
    }
  });

  test('D0 with its three flags stripped renders to the bytes main 5541bb44 produced (md 2007 / html 12560)', () => {
    // Measured 2026-09-13 on main 5541bb44, before this change, on this same fixture: the
    // renderer must not move a single byte of an unflagged document. If this reddens with a
    // different length while lostRowsOf is untouched, something ELSE changed the renderer —
    // stop and say so rather than re-pinning the number.
    const v = JSON.parse(JSON.stringify(readJson('verdict.json')));
    for (const r of v.runStats) { delete r.findingsUnverified; delete r.repairRefused; }
    const md = buildReport({ verdict: v }, { format: 'md' });
    const html = buildReport({ verdict: v }, { format: 'html' });
    expect(md).not.toContain('What was lost');
    expect(`md ${Buffer.byteLength(md)} html ${Buffer.byteLength(html)}`).toBe('md 2007 html 12560');
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx jest tests/council/report-unverified.test.js`
Expected: FAIL — `Cannot find module '../../src/council/report-lost-rows'`. Paste the first failing lines into the report as RED evidence.

- [ ] **Step 4: Register the two channels**

In `src/utils/degrade.js`, inside the `DEGRADE_CHANNELS` literal, immediately after the line `  'stage2-judge',` (line 41) and before `  'internal',`, insert:

```js
  // #242 / spec §5 (v4.9.8): render-time rows the report derives from runStats
  // (council/report-lost-rows.js) — never emitted by the sink, so neither can
  // flip `degraded` or the exit code. `unverified-repair`: a seat's findings
  // came from a repair of a response with no findings block
  // (runStats[].findingsUnverified); `repair-refused`: the repair broke its
  // count contract (runStats[].repairRefused). Registered here because the
  // degrade-contract drift pin reads every `channel:` literal in src/.
  'unverified-repair', 'repair-refused',
```

- [ ] **Step 5: Write the leaf**

Create `src/council/report-lost-rows.js`:

```js
// src/council/report-lost-rows.js
'use strict';

/**
 * @module council/report-lost-rows
 * "What was lost" rows the tally already knows (#242, spec §5): one per runStats seat whose
 * findings came from a repair nothing could verify (`findingsUnverified`), one per refused
 * repair (`repairRefused`). Derived at RENDER time from `verdict.runStats` — never written into
 * run.json or verdict.json's `degrades[]`, never handed to the degrade sink — so the run's exit
 * code, its `degraded` state and every on-disk artifact are unchanged, and re-rendering an
 * older verdict.json shows the rows too.
 *
 * A LEAF over utils/degrade: the rows are `makeDegrade` records so both renderers print them
 * through `formatDegrade`, the report's one voice, and their channels sit in DEGRADE_CHANNELS
 * (the degrade-contract drift pin reads this file's `channel:` literals).
 *
 * ⚠️ The wording never says "stub". The flag means exactly what run-stages.js :: runStage1 says:
 * the ORIGINAL response carried no parseable findings block, so nothing could check the repair —
 * true of a vacuous repair and of a good review whose trailing JSON was malformed alike (study
 * run B2: a 19,064-byte review carried it). Both facts are tested with `=== true` / a plain
 * object, matching what tally.js emits; a hand-assembled truthy string is not a flag.
 *
 * `data.seat` is the row's label: the seat id when the bench repeats an alias, else the alias —
 * the `seat || model` rule the street-cred rows use in both renderers.
 */

const { makeDegrade } = require('../utils/degrade');

function seatLabel(r) {
  if (typeof r.seat === 'string' && r.seat) { return r.seat; }
  if (typeof r.model === 'string' && r.model) { return r.model; }
  return 'unknown';
}

function unverifiedRow(r) {
  const seat = seatLabel(r);
  return makeDegrade({
    channel: 'unverified-repair',
    what: `seat ${seat}'s findings came from a repair of a response with no findings block`,
    why: 'nothing verified them',
    effect: 'the tiers they were given rest on the repair alone; the seat still counts as reviewed',
    data: { seat },
  });
}

function refusedRow(r) {
  const seat = seatLabel(r);
  const { code: rawCode, detail: rawDetail } = r.repairRefused;
  const code = (typeof rawCode === 'string' && rawCode.trim()) ? rawCode.trim() : 'REPAIR_REFUSED';
  const detail = (typeof rawDetail === 'string' && rawDetail.trim()) ? rawDetail.trim() : 'the repair broke its contract';
  return makeDegrade({
    channel: 'repair-refused',
    what: `seat ${seat}'s repair was refused (${code})`,
    why: detail,
    effect: 'the seat contributed no findings; its review text still reached the judges and it counts as reviewed',
    data: { seat, code },
  });
}

function isPlainObject(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

/**
 * @param {*} runStats `verdict.runStats` — any shape: the report's entry points are schema-free
 *   JSON.parse (see report.js :: isSeatSpace), so a non-array yields no rows rather than a throw.
 * @returns {Array<object>} frozen makeDegrade records, in runStats order; `[]` when none.
 */
function lostRowsOf(runStats) {
  const rows = [];
  for (const r of (Array.isArray(runStats) ? runStats : [])) {
    if (!isPlainObject(r)) { continue; }
    if (r.findingsUnverified === true) { rows.push(unverifiedRow(r)); }
    if (isPlainObject(r.repairRefused)) { rows.push(refusedRow(r)); }
  }
  return rows;
}

module.exports = { lostRowsOf };
```

- [ ] **Step 6: Hook the rows into the model (three one-for-one edits; `report.js` ends at exactly 300 lines)**

In `src/council/report.js`:

1. After line 20 (`const { buildCostModel } = require('./report-cost');`) add ONE line:
   ```js
   const { lostRowsOf } = require('./report-lost-rows'); // #242: a leaf; back-requires nothing here
   ```
2. Replace the comment line `    // \`notes\`, which both renderers list APART from "What was lost".` (line 266 before the insert) with this ONE line:
   ```js
       // `notes`, which both renderers list APART from "What was lost". v4.9.8 (#242): the runStats-derived unverified/refused-repair rows (./report-lost-rows) are appended AFTER the sink's records.
   ```
3. Replace the line `    degrades: (verdict.degrades || []).filter(d => d.kind !== 'heal' && d.kind !== 'info'),` with this ONE line:
   ```js
       degrades: (verdict.degrades || []).filter(d => d.kind !== 'heal' && d.kind !== 'info').concat(lostRowsOf(verdict.runStats)),
   ```

Then: `wc -l src/council/report.js` → `300`, and `node scripts/check-file-sizes.js --all` exits 0.

4. (Added after the Task 1 review, ruling P3-R9.) In `src/council/report-md.js:50-51` the guard comment "Heading-over-nothing: emitted ONLY when the run actually degraded, so a clean verdict's report stays byte-identical to before this section existed." becomes false once the model carries the runStats-derived rows (D0 did not degrade and now renders the section). Reword it to: `// Heading-over-nothing: emitted ONLY when the model carries losses — the sink's records plus (v4.9.8, #242) the runStats-derived unverified/refused-repair rows report.js :: toModel appends — so a clean verdict's report stays byte-identical to before this section existed.` (`report-md.js` has headroom; two lines are fine.) `report-html.js`'s guard comment ("absent or empty degrades ⇒ no section at all") stays true and is not touched. The unverified row's `effect` was also softened at that review (ruling P3-R8): it must be true on every document it can render on, including a pre-4.9.8 `verdict.json` whose census has no `unverified` key — so it does not name the census.

- [ ] **Step 7: Run the new file and every suite that renders a report or reads the channel registry**

Run: `npx jest tests/council/report-unverified.test.js tests/council/report.test.js tests/council/report-intent.test.js tests/council/report-md.test.js tests/council/report-cost.test.js tests/council/report-debate.test.js tests/council/report-claude-column.test.js tests/council/report-cred-seat.test.js tests/council/degrade-contract.test.js tests/council/degrade-surface.test.js tests/council/run-all-clean.test.js tests/scripts/check-file-sizes.test.js`
Expected: all PASS, output pristine. Also `npm run lint` → clean.

- [ ] **Step 8: The docs paragraph for `amicus council report`**

In `docs/council.md`, the "What it renders" paragraph (starts at line 992 `**What it renders**, in this order:`), replace these three lines:

```
**What was lost** section
when the run degraded (plus a **Notes** list for informational records, e.g. a task run's
ledger-skipped announcement), the **adjudication matrix** (finding × judge, `✓`/`✗`/`–` with
```

with:

```
**What was lost** section
when the run degraded — and, since v4.9.8 (#242), one row per seat whose findings came from a
repair of a response with no findings block (channel `unverified-repair`) and one per refused
repair (channel `repair-refused`, naming the code), derived from `runStats[]` when the report is
built, so re-rendering an older `verdict.json` shows them too — (plus a **Notes** list for
informational records, e.g. a task run's ledger-skipped announcement), the **adjudication
matrix** (finding × judge, `✓`/`✗`/`–` with
```

Then sweep: `grep -rn "when the run degraded" docs/ src/ CHANGELOG.md README.md` — every other hit must still be true (they describe the sink's records; leave them unless one claims "What was lost" holds ONLY degrades).

- [ ] **Step 9: Regenerate the architecture map, commit**

```bash
node scripts/generate-docs.js
git status --short
git add src/council/report-lost-rows.js src/utils/degrade.js src/council/report.js tests/council/report-unverified.test.js tests/council/fixtures/study-d0 docs/council.md docs/architecture-map.md
git commit -m "feat(council): report gains one What-was-lost row per unverified repair and per refused repair (#242, spec §5)

The flag has ridden runStats through tally.json and verdict.json since LC-11 and died at
the renderer. lostRowsOf (a leaf over utils/degrade) derives the rows from verdict.runStats
when the report is built; toModel appends them after the sink's records, so both renderers
print them through formatDegrade unchanged and a pre-4.9.8 verdict.json re-renders with them.
Nothing is written to run.json or verdict.json; the exit code does not move. Fixture: study
run D0 (three flagged seats), verbatim.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

If the pre-commit hook rewrites `docs/architecture-map.md` again, `git status` will show it — stage and amend once, then re-check `git status --short` is clean.

- [ ] **Step 10: Measure ROWALWAYS and REFUSEDDROP on the committed (clean) tree**

Precondition: `git status --short` shows nothing but `?? site-src/`.

ROWALWAYS: in `src/council/report-lost-rows.js` change `    if (r.findingsUnverified === true) { rows.push(unverifiedRow(r)); }` to `    rows.push(unverifiedRow(r));`. Confirm the edit took (`git diff --stat` shows the file). Run: `npx jest tests/council/report-unverified.test.js tests/council/report.test.js tests/council/report-intent.test.js tests/council/degrade-surface.test.js tests/council/run-all-clean.test.js`. Record every failing test name (expected: at least "av-receiver … pinned by ROWALWAYS", "D0 with its three flags stripped…", "D0: one unverified-repair row per flagged seat…", and "never says stub… (toHaveLength 4)"). Restore: `git checkout -- src/council/report-lost-rows.js`; `git diff --stat` → empty.

REFUSEDDROP: delete the line `    if (isPlainObject(r.repairRefused)) { rows.push(refusedRow(r)); }`. Same suites. Expected red: the three refused-repair tests and "both facts". Restore the same way.

If either mutant survives (zero reds), that is the finding — report it as DONE_WITH_CONCERNS with the exact edit; do not invent a test to kill an equivalent mutant.

- [ ] **Step 11: Record the measured red sets and commit**

Replace both `TBD-MEASURE` placeholders in the docblock of `tests/council/report-unverified.test.js` with the measured lists (test names, count). Commit:

```bash
git add tests/council/report-unverified.test.js
git commit -m "test(council): record the measured ROWALWAYS / REFUSEDDROP red sets

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: The census — `seatsReviewed` gains `unverified`, the schema declares it, the verdict tests pin it

**Files:**
- Modify: `src/council/verdict-seats-reviewed.js` (docblock lines 10-15, `@returns` line 24, the return literal lines 54-57)
- Modify: `schemas/council-verdict.schema.json:232-241` (`seatsReviewed`)
- Modify: `tests/council/verdict.test.js` (the `#202 — verdict.json publishes seats reviewed of seats benched` describe, lines ~250-340)

**Interfaces:**
- Consumes: `runStats[].findingsUnverified === true` (the same test Task 1's `lostRowsOf` uses); `isBenchRole` unchanged.
- Produces: `seatsReviewedOf(runStats)` → `{ seatsReviewed: { reviewed, unverified, of } }` (key order fixed) or `{}`. Task 3's jq reads `.seatsReviewed.unverified`.

- [ ] **Step 1: Write the failing tests**

In `tests/council/verdict.test.js`, add `const Ajv = require('ajv/dist/2020');` to the top-level requires (after `const path = require('path');`; `fs` and `path` are already required). The `/dist/2020` build is required: the schemas declare `$schema: https://json-schema.org/draft/2020-12/schema`, and the default `require('ajv')` throws `no schema with key or ref "https://json-schema.org/draft/2020-12/schema"` (measured; `tests/council/run-schema-debate.test.js:5` and `tests/schemas.test.js:13` use the same build). D0's rebuilt verdict validates against the schema on `main` today (measured), so V12's schema assertion fails only if `unverified` is written without being declared. Then, inside the `#202` describe, change V1–V9's `toEqual` literals to carry `unverified: 0` in the middle position, e.g. V1 → `{ reviewed: 3, unverified: 0, of: 3 }`, V2 → `{ reviewed: 2, unverified: 0, of: 3 }`, V3 → `{ reviewed: 2, unverified: 0, of: 2 }`, V4 → `{ reviewed: 1, unverified: 0, of: 2 }`, V7 → `{ reviewed: 2, unverified: 0, of: 3 }`, V8 → `{ reviewed: 2, unverified: 0, of: 2 }`, V9 → `{ reviewed: 1, unverified: 0, of: 1 }` (V5 and V6 assert absence; unchanged). Append, before the closing of that describe:

```js
  // #242 / spec §5 (v4.9.8): the third number. A seat whose findings came from a repair of a
  // response with no findings block (run-stages.js sets `findingsUnverified: true`) is
  // `reviewed` — its leg completed — AND `unverified`. Always written with the census: 0 is a
  // measurement, absence keeps its one meaning (no bench rows). Not a stub count (study run B2:
  // a real 19,064-byte review carried the flag). Named mutant CENSUSZERO
  // (`unverified: seats.filter(r => r.findingsUnverified === true).length` → `unverified: 0`),
  // red set measured on the committed tree: TBD-MEASURE
  test('V10 flagged seats are counted under `unverified` — and still under `reviewed`', () => {
    const flagged = (model) => ({ ...seatRow(model, 'complete'), findingsUnverified: true });
    const v = build([flagged('glm'), flagged('qwen'), seatRow('gpt', 'complete')]);
    expect(v.seatsReviewed).toEqual({ reviewed: 3, unverified: 2, of: 3 });
  });

  test('V11 the key order is reviewed / unverified / of — the shape spec §5 names and the CI title prints', () => {
    const v = build([seatRow('glm', 'complete')]);
    expect(Object.keys(v.seatsReviewed)).toEqual(['reviewed', 'unverified', 'of']);
  });

  test('V12 study run D0 (three narration stubs, three repairs): 3 reviewed · 3 unverified · of 3, and the document validates', () => {
    const record = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'study-d0', 'tally.json'), 'utf-8'));
    const v = buildVerdict(record, []);
    expect(v.seatsReviewed).toEqual({ reviewed: 3, unverified: 3, of: 3 });
    const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'schemas', 'council-verdict.schema.json'), 'utf-8'));
    const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
    expect(`${validate(v)} ${JSON.stringify(validate.errors)}`).toBe('true null');
  });

  test('V13 a flagged NON-bench row and a refused repair are not counted under `unverified`', () => {
    // A `repair` row never carries the flag in production (only primary review rows do) — the
    // pin is that the census filters by ROLE before it reads the flag. A refused repair
    // (`repairRefused`, conformance unstructured) tallied NO findings; the report's
    // repair-refused row says so, and this number is about findings that WERE tallied.
    const v = build([
      seatRow('glm', 'complete'),
      { ...seatRow('qwen', 'complete'), conformance: 'unstructured',
        repairRefused: { code: 'REPAIR_CHANGED_FINDING_COUNT', detail: 'repair returned 2 findings, original attempted 3' } },
      { model: 'glm', role: 'repair', wasChair: false, conformance: 'clean', status: 'complete',
        durationMs: 1, usage: null, findingsUnverified: true },
    ]);
    expect(v.seatsReviewed).toEqual({ reviewed: 2, unverified: 0, of: 2 });
  });

  test('V14 the flag is tested `=== true` on a record that bypassed tally(): a truthy string is not a flag', () => {
    // tally.js's allowlist coerces any truthy value to the literal `true`, so through `build`
    // this shape cannot be observed. buildVerdict is also reachable on hand-assembled and MCP
    // records (V6) — there the census reads exactly what the producer would have written.
    const v = buildVerdict({ meta, findings: [], streetCred: [], tierCounts: {},
      runStats: [{ ...seatRow('glm', 'complete'), findingsUnverified: 'yes' }, seatRow('gpt', 'complete')] });
    expect(v.seatsReviewed).toEqual({ reviewed: 2, unverified: 0, of: 2 });
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest tests/council/verdict.test.js`
Expected: V1–V4, V7–V9 FAIL (received object lacks `unverified`); V10–V14 FAIL. Paste the first failure as RED evidence.

- [ ] **Step 3: Implement the census and declare it in the schema (one commit)**

`src/council/verdict-seats-reviewed.js`:

1. In the module docblock, after the sentence ending `a \`timeout\` is not a review any more than an \`error\` is.` (line 15), add:
   ```
    * `unverified` (#242 / spec §5, v4.9.8) is those bench seats whose findings came from a
    * repair of a response with no parseable findings block — the LC-11 flag
    * run-stages.js :: runStage1 sets on the row. The seat stays in `reviewed` (its leg
    * completed) and is counted here too. ALWAYS written once the census is: 0 is a
    * measurement, absence keeps its one meaning. Key order is reviewed / unverified / of —
    * the shape spec §5 names and the council-review check title prints. Not a stub count
    * (study run B2: a real 19,064-byte review with a malformed trailing block carried the
    * flag). A refused repair (`repairRefused`) is NOT counted: that seat tallied no findings
    * at all, and the report's `repair-refused` row says so.
   ```
2. Change the `@returns` line to `@returns {{seatsReviewed?: {reviewed: number, unverified: number, of: number}}}`.
3. Replace the return literal with:
   ```js
     return { seatsReviewed: {
       reviewed: seats.filter(r => r.status === 'complete').length,
       // `=== true`, matching tally.js's emit-when-true — a hand-assembled truthy string is not
       // a flag (V14). Named mutant: CENSUSZERO (tests/council/verdict.test.js).
       unverified: seats.filter(r => r.findingsUnverified === true).length,
       of: seats.length,
     } };
   ```

`schemas/council-verdict.schema.json`, inside `"seatsReviewed"`:

1. Append to the end of its `"description"` string: ` v4.9.8 (#242): \`unverified\` joins the census — bench seats among \`reviewed\` whose findings came from a repair of a response with no parseable findings block (runStats[].findingsUnverified). buildVerdict ALWAYS writes it since that version (0 is a measurement); it is declared, not required, so documents written before it still validate.`
2. Replace the `"properties"` object with (order matters — it documents the written order):
   ```json
         "properties": {
           "reviewed": { "type": "integer", "minimum": 0, "description": "Bench seats whose leg completed." },
           "unverified": { "type": "integer", "minimum": 0, "description": "v4.9.8 (#242): bench seats, counted in `reviewed` too, whose findings came from a repair of a response with no parseable findings block — the tally scored those findings and nothing verified the repair. Not a stub count. A refused repair (runStats[].repairRefused) is not counted here." },
           "of": { "type": "integer", "minimum": 1, "description": "Bench seats benched, post-retry." }
         },
   ```
   Keep `"required": ["reviewed", "of"]` and `"additionalProperties": false` as they are.

- [ ] **Step 4: Run to verify green, plus every schema consumer**

Run: `npx jest tests/council/verdict.test.js tests/schemas.test.js tests/council/run-schema-debate.test.js tests/council/chair-scale-drift.test.js tests/council/verdict-seat-loss.test.js tests/council/verdict-degrades.test.js tests/council/report-unverified.test.js tests/council/run-stages.test.js tests/workspace/dead-seat-twins.test.js`
Expected: all PASS. `npm run lint` clean.

- [ ] **Step 5: Commit**

```bash
git add src/council/verdict-seats-reviewed.js schemas/council-verdict.schema.json tests/council/verdict.test.js
git commit -m "feat(council): seatsReviewed gains unverified — {reviewed, unverified, of} (#242, spec §5)

A seat whose findings came from a repair of a response with no findings block is still
reviewed (its leg completed) and is now also counted as unverified, always written with the
census. Study run D0 reads 3 reviewed · 3 unverified · of 3 where it read 3 of 3. The
schema declares the key without requiring it, so older documents validate.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 6: Measure CENSUSZERO on the clean tree, record, commit**

Edit `src/council/verdict-seats-reviewed.js`: `    unverified: seats.filter(r => r.findingsUnverified === true).length,` → `    unverified: 0,`. Confirm with `git diff --stat`. Run `npx jest tests/council/verdict.test.js tests/council/report-unverified.test.js`. Expected red: V10, V12 (and nothing in report-unverified). Restore with `git checkout -- src/council/verdict-seats-reviewed.js`; `git diff --stat` empty. Replace `TBD-MEASURE` in the V10 comment with the measured list and commit:

```bash
git add tests/council/verdict.test.js
git commit -m "test(council): record the measured CENSUSZERO red set

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: The publish gate sees it — workflow title + footer, the workflow pin, docs and CHANGELOG

**Files:**
- Modify: `.github/workflows/council-review.yml:759-763` (TITLE comment + jq) and `:867-873` (SEATS_LINE comment + jq)
- Modify: `tests/scripts/council-review-workflow.test.js` (one new test after "the census read tolerates the key being ABSENT")
- Modify: `docs/council.md` — the `amicus council verdict` "Key notes" list (~line 951, after the `findings[].sameModelCorroboration` bullet); the repair-contract prose (after the bullet ending "the count the original declared." ~line 692); the `runStats[]` row of the tally-record table (~line 769, the shape literal)
- Modify: `CHANGELOG.md` — `## [Unreleased]` → `### Fixed`, a new bullet appended after the existing PR 1 bullet (before `## [4.9.7]`)

**Interfaces:**
- Consumes: `verdict.json.seatsReviewed.unverified` (Task 2), the exact row text (Task 1).
- Produces: check-run title `… · seats 4/5 (3 unverified)` and footer `seats reviewed: 4 of 5 (3 unverified) · ` when `unverified > 0`; byte-identical otherwise.

- [ ] **Step 1: Write the failing workflow test**

In `tests/scripts/council-review-workflow.test.js`, directly after the test `'#202: the census read tolerates the key being ABSENT (emit-when-set)'`, add:

```js
  test('#242: the unverified count reaches the title and the footer, printed only when non-zero', () => {
    const y = yml();
    const checkIdx = y.indexOf('Publish the Council Review check run');
    const commentIdx = y.indexOf('Post sticky PR comment');
    // `> 0`, never a bare truthiness test: jq treats 0 as TRUE, so `if .seatsReviewed.unverified`
    // would print "(0 unverified)" on every clean run; and jq orders null below every number,
    // so a pre-4.9.8 verdict.json (no key) prints exactly as before. Named mutant TITLEBLIND
    // (the nested clause deleted from the TITLE line) reddens the first segment.
    for (const seg of [y.slice(checkIdx, commentIdx), y.slice(commentIdx)]) {
      expect(seg).toContain('if .seatsReviewed.unverified > 0 then " (\\(.seatsReviewed.unverified) unverified)" else "" end');
    }
  });
```

Run: `npx jest tests/scripts/council-review-workflow.test.js` → the new test FAILS (both segments lack the clause); everything else passes.

- [ ] **Step 2: Edit the two jq reads (single lines — the existing guard test checks every line that mentions `seatsReviewed`)**

`.github/workflows/council-review.yml`, replace lines 759-763 (the four `# #202…` comment lines and the `TITLE=` line) with:

```yaml
          # #202: the seat census rides the TITLE, which is the one line a reader
          # sees without opening anything. `if .seatsReviewed then … else "" end`
          # because the key is emit-when-set — a bare interpolation would publish
          # "seats null/null" on exactly the degraded runs it exists to describe.
          # #242 (v4.9.8): `unverified` rides the same census, printed only when
          # non-zero — jq orders null below every number, so an older verdict.json
          # (no key) and a clean run (0) both print exactly as before.
          TITLE=$(jq -r --arg v "$OVERALL" '"VERDICT: \($v) — Confirmed \(.tierCounts.Confirmed) · Contested \(.tierCounts.Contested) · Disputed \(.tierCounts.Disputed) · Singleton \(.tierCounts.Singleton)" + (if .seatsReviewed then " · seats \(.seatsReviewed.reviewed)/\(.seatsReviewed.of)" + (if .seatsReviewed.unverified > 0 then " (\(.seatsReviewed.unverified) unverified)" else "" end) else "" end)' "$RUN_DIR/verdict.json")
```

Replace lines 867-873 (the `# #202: \`models:\` above…` comment block and the `SEATS_LINE=` line) with:

```yaml
          # #202: `models:` above is the bench that was ASKED FOR. This is how much
          # of it actually reviewed — the fact a reader could not previously get
          # from this comment at all, because `seatLoss` is structurally absent
          # whenever no --critic was requested, and CI never requests one. Carries
          # its own trailing separator so an absent census leaves the footer
          # byte-identical rather than stranding a " · ".
          # #242 (v4.9.8): the unverified count, only when non-zero (see the TITLE note).
          SEATS_LINE=$(jq -r 'if .seatsReviewed then "seats reviewed: \(.seatsReviewed.reviewed) of \(.seatsReviewed.of)" + (if .seatsReviewed.unverified > 0 then " (\(.seatsReviewed.unverified) unverified)" else "" end) + " · " else "" end' "$RUN_DIR/verdict.json")
```

Indentation: keep exactly the existing 10-space indent of those `run:` lines. Verify the YAML still parses: `node -e "require('js-yaml').load(require('fs').readFileSync('.github/workflows/council-review.yml','utf-8')); console.log('yaml ok')"` (js-yaml is a dev dependency; if it is not installed, `node -e "require('yaml')"` — if neither loads, say so in the report and rely on `tests/scripts/council-review-workflow.test.js` + CI's actionlint job).

Run: `npx jest tests/scripts/council-review-workflow.test.js tests/scripts/ci-workflow.test.js` → all PASS (the guard test still matches every `seatsReviewed` line because each new clause sits on a line that starts with `if .seatsReviewed`).

- [ ] **Step 3: Docs — three sites in `docs/council.md`**

(a) `amicus council verdict` "Key notes": after the bullet beginning `- \`findings[].sameModelCorroboration\` — **v4.8**, optional, \`true\` only.` add:

```markdown
- `seatsReviewed` — **#202**, optional: `{reviewed, unverified, of}`, derived from `runStats` at build time (never passed in) and emitted only when the record carries at least one bench-role row (`seat`, `critic`, `lens:<slug>`), so `0 of 0` is never written. `of` counts bench seats post-retry (a healed seat once — its first attempt is `role:'superseded'`), `reviewed` those whose leg completed, and `unverified` (**v4.9.8**, #242) those among them whose findings came from a repair of a response with no parseable findings block (`runStats[].findingsUnverified`): the tally scored those findings, nothing verified the repair, and the flag is not a stub detector — a real review whose trailing JSON block was malformed carries it too. `unverified` is always written with the census; the council-review check title and sticky comment print it only when non-zero. A refused repair (`runStats[].repairRefused`) is not counted here — that seat contributed no findings at all, and the report's `repair-refused` row says so.
```

(b) The repair-contract prose: after the bullet that ends `draws when it checks a repair against the count the original declared.` and before the paragraph beginning `This closes a contradiction`, insert (with a blank line on each side):

```markdown
**When the original carried no block at all there is nothing to check the repair against**, so
the repair is accepted and the seat's `runStats` row carries `findingsUnverified: true` — the
seat is counted as reviewed, its findings are tallied, and nothing verified them. Since v4.9.8
(#242) that fact is surfaced rather than merely recorded: `verdict.json`'s `seatsReviewed`
counts the seat under `unverified`, and the report's **What was lost** gains a row for it
(*seat X's findings came from a repair of a response with no findings block — nothing verified
them*). A repair that returned a **different number** of findings than the original declared is
refused instead — `repairRefused: {code, detail}` on the row, `conformance: unstructured`, no
findings tallied, the seat's own prose still reaching the judges — and gets a `repair-refused`
row naming the code.
```

(c) The `runStats[]` row of the tally-record table (line ~769): in the shape literal `` `{model, role, wasChair, conformance, status, durationMs, usage, waveId?, resolvedModel?, seat?}` `` append, right after the closing backtick of that literal: `` — plus `findingsUnverified?: true` / `repairRefused?: {code, detail}` (the two halves of the repair contract's outcome, see the repair paragraph under `amicus council validate`) and `ttftMs?` (v4.9 W13) ``. Do not touch anything else in that cell.

Sweep after (a)–(c): `grep -rn "seats reviewed\|reviewed, of\|{reviewed, of}\|reviewed/of" docs/ src/ tests/ CHANGELOG.md BACKLOG.md README.md .github/` (uncapped; `wc -l` first). Every hit that describes the census SHAPE must now say three numbers or be a historical entry (a released CHANGELOG section, BACKLOG history, an SDD ledger) — correct live docs/comments only; leave release history alone. Report the list.

- [ ] **Step 4: CHANGELOG**

In `CHANGELOG.md`, `## [Unreleased]` → `### Fixed`, append after the PR 1 bullet (the one ending `(… §3; PR 1 of 3.)`) and before `## [4.9.7]`:

```markdown
- **A seat whose findings nothing could verify no longer passes as a full review.** When a
  Stage-1 response carried no parseable findings block and the bounded repair supplied one, the
  seat's `runStats` row has carried `findingsUnverified: true` since the repair contract landed
  (LC-11) — through `tally.json` and `verdict.json` — and died at the renderer: `report.html`'s
  **What was lost** table held only the degrade sink's records (dead legs and the like), and
  `seatsReviewed` counted the seat as a full reviewer. Now the report (Markdown and HTML) gains
  one **What was lost** row per such seat (channel `unverified-repair`: *seat X's findings came
  from a repair of a response with no findings block — nothing verified them*) and one per
  refused repair (channel `repair-refused`, naming the code), derived from `runStats` when the
  report is built — so `amicus council report` on an older `verdict.json` shows them too, and
  nothing in `run.json`, the exit code or the degrade sink changes. `verdict.json`'s census gains
  a third number, `seatsReviewed: {reviewed, unverified, of}` (always written; older documents
  still validate), and the council-review check title and sticky comment print `(N unverified)`
  when it is non-zero. The wording never says "stub": the flag also fires on a real review whose
  trailing JSON block was malformed. Study run D0 (three narration stubs, three repairs) now
  reads `3 reviewed · 3 unverified · of 3` with three rows where it read `3 of 3` and nothing.
  (#242; `docs/superpowers/specs/2026-09-11-council-leg-completion-design.md` §5; PR 3 of 3.)
```

Then re-read the bullet against the code: every claim must point at a line you can name (`report-lost-rows.js`, `report.js:279`, `verdict-seats-reviewed.js`, the two jq lines). Strike anything you cannot.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/council-review.yml tests/scripts/council-review-workflow.test.js docs/council.md CHANGELOG.md
git commit -m "ci+docs(council): the publish gate prints the unverified count; docs and CHANGELOG for #242 (spec §5)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 6: Measure TITLEBLIND on the clean tree, record, commit**

In the workflow's TITLE line delete the substring ` + (if .seatsReviewed.unverified > 0 then " (\(.seatsReviewed.unverified) unverified)" else "" end)` (the TITLE line only). `git diff --stat` shows the file. Run `npx jest tests/scripts/council-review-workflow.test.js`. Expected red: exactly the `#242` test. Restore with `git checkout -- .github/workflows/council-review.yml`; `git diff --stat` empty. Add the measured result to the new test's comment (`red set: <name>, 1 test`) and commit:

```bash
git add tests/scripts/council-review-workflow.test.js
git commit -m "test(ci): record the measured TITLEBLIND red set

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4 (controller-run, no dispatch): gates, PR body, STOP

- [ ] `npm run lint` → clean.
- [ ] `npm run check:sizes` → exit 0 (report.js at 300).
- [ ] `npm run generate-docs:check` → exit 0 (the map committed in Task 1 is current).
- [ ] `npm test` → exit 0, 0 failures; `.test-passed` equals `git rev-parse HEAD`. Report the suite/test totals as measured (do not compare to a hardcoded number).
- [ ] `npm run test:integration` → exit 0 (keyless tier; the engine probe suite from PR 2 included).
- [ ] Write `<workspace>/pr-body.md`: title `council: surface unverified repairs in the report and the seatsReviewed census (#242, spec §5, PR 3 of 3)`; body = what shipped (the CHANGELOG bullet's substance), the four named mutants with their measured red sets, the D0 before/after (`3 of 3` → `3 reviewed · 3 unverified · of 3` + three rows), the rulings R1–R6 verbatim, "what this PR does NOT do" (no sink note, no exit-code change, Workspace panels unchanged, `repairRefused` not counted in `unverified`), and the trailer `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- [ ] STOP. The push and `gh pr create --label council-review` are outward-facing: ask the owner in chat. After the run: read `verdict.json` (`overallVerdict`, `seatsReviewed` — now three numbers), never the check colour; a degraded run is not a review.

---

## Follow-ups recorded (not in this PR)

- The Workspace GUI's lost-seat panels read `run.json.degrades` (`src/workspace/seat-space.js:129`, `live-normalize.js:134`) and will not show the runStats-derived rows; the run's end-of-run stderr prints nothing for them either. Both would need a sink `info` note on the (now registered) channels — a behaviour change for the owner to approve.
- `report.js` sits at exactly 300 lines; its next edit needs a split (the sixth src file at the cap).
- `unverified` counts `findingsUnverified` only (R3); the severity refinement #242 item 3 asks for (0 extracted findings, anomalously small repair output) is a separate change layered on the flag.
- #242 item 1 (write repair output back to `review-<seat>.md` / the Stage-2 bundle) stays on the issue, per spec §5.

## Self-review (writing-plans checklist)

- **Spec coverage.** §5 change bullet 1 (rows, both channels, wording without "stub", data source runStats) → Task 1. Bullet 2 (`{reviewed, unverified, of}`, glove example → D0 `{3, 3, 3}`, "the publish gate sees it") → Tasks 2 and 3. §5 tests line (fixture with 3 flagged seats, rows present, counts exact, byte-identity + mutant ROWALWAYS) → Task 1 Steps 2/10, Task 2. §7 (CHANGELOG, `docs/council.md`, `npm test` + keyless before push, council-review label, owner's gate) → Task 3 and Task 4. §5's "#242 item 1 not in this spec" → Follow-ups.
- **Placeholders.** The only `TBD-MEASURE` tokens are deliberate: they are replaced by the implementer with measured red sets in a follow-up commit (Tasks 1/2/3 last steps). No "add tests", no "similar to Task N".
- **Type consistency.** `lostRowsOf(runStats)` (Task 1) is required by name in `report.js` (Task 1 Step 6) and in the test file; `seatsReviewedOf` keeps its signature; the jq keys match the census keys; `UNVERIFIED_LINE`/`REFUSED_LINE` in the tests equal `formatDegrade` of the leaf's literals (`${lead}: ${what} — ${why}. ${effect}.`), checked by hand: what + ` — ` + why + `. ` + effect + `.`.
- **Fixture ↔ matcher (failure mode #1).** V13's refused/repair rows pass through `tally()` (kept as objects / `true`); V14's `'yes'` deliberately bypasses `tally()` because the allowlist would coerce it — stated in the test. The D0 `verdict.json` renders through `toModel` unchanged today (measured: md 2007 / html 12560).
- **Numbers (failure mode #33).** 2007/12560 are measured on the tree this plan targets and pinned in a test that says what to do if they move; every other number is measured by the implementer after the step that could change it.
