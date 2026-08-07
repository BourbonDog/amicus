# v4.7 PR3 — F8: tags, --search, one list — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `--tag <t>` on start/fanout/council run (CLI + MCP, stored absent-not-null on all artifacts), one shared session enumeration behind both `amicus list` and `amicus_list` (with the dead `--all` implemented as documented cross-project listing and a TAG column), `--search <q>` over id + tag + briefing text on both list surfaces, and spend rows/grouping gaining the `tag` dimension.

**Architecture:** Tag storage copies the pack absent-not-null idiom at every site (now SEVEN physical writes: four CLI-side + three MCP twins). List unification keeps `enumerateSessions` as the single core and re-grafts the MCP-only decorations (sanitized previews, running-row enrichment, council-pointer merge) on top. Search is a read-side substring filter over material already on disk — no new storage, with per-class fallbacks (wave `briefing.md`, council `briefing-stage1.md` post-separator). Two relief extractions land first because `start.js`/`fanout.js` sit at 298/300 exactly where tag lines must go.

**Tech Stack:** Node 22 (CommonJS), jest. Worktree `C:\Users\sendt\code\amicus-wt-v47-pr3`, branch `feat/v4.7-pr3-f8-tags-search` off `origin/main` = `4ddf4be`. Baseline 496 suites / 6622 / 0 fail.

**Spec:** `docs/superpowers/specs/2026-08-06-v4.7-count-is-the-count-design.md` §7 (D13–D16). Recon re-grounded 2026-08-07 at `4ddf4be` (7 tracers + 3 adversarial verifiers).

## Errata vs spec §7 (recon 2026-08-07, controller-ruled per the E2/E6 precedent — owner veto open)

- **E-PR3-1 (D13 validation):** `sanitizeCouncilName` (cli-council-run-bench.js:30-34) CLEANS (strips C0/DEL, trims, silently truncates to 64) — it does not reject; the spec's "mirrors sanitizeCouncilName … reject otherwise" mischaracterizes the mirror. Ruling: a NEW validator with reject semantics using the established safe-charset regex `/^[a-zA-Z0-9_-]{1,64}$/` (the `safeTaskId` shape at mcp-tools.js:17-20). CLI exits 1 with a clear message; MCP rejects at the Zod boundary.
- **E-PR3-2 (D13 write sites):** the spec's four logical sites are SEVEN physical writes once the MCP twins are counted. The critical one: `amicus_start`'s shared-server in-process branch (mcp-server.js:428+, the DEFAULT MCP headless path) never spawns a CLI child — argv forwarding cannot reach it; `input.tag` must be stamped directly into its metadata write (~mcp-server.js:502, pack precedent). Fanout/council MCP paths forward `--tag` on child argv (conditional pushes; read-merge covers storage).
- **E-PR3-3 (D14 divergences, verifier-enumerated):** the two list surfaces diverge beyond the spec's carve-out. Rulings: (a) MCP running-row enrichment (phase/messageCount/lastActivityAt/latestPreview) stays an MCP-side layer ON TOP of the shared enumeration — never inside it (CLI list must not pay a conversation.jsonl parse); (b) row-field union: `enumerateSessions` gains `mode` (meta.mode || headless-derived) so MCP keeps it and CLI --json gains it additively; MCP rows gain `type`/`parentWave`/`legCount` additively; (c) the MCP `status` Zod input relaxes from `z.enum(['all','running','complete'])` to `z.string().optional()` with a describe naming common values — the handler already accepts any status, the CLI accepts free strings, and a pinned test already exercises 'aborted' by bypassing the enum; (d) project scoping stays per-surface (CLI --cwd vs MCP resolveProjectDir) — enumerateSessions takes project as an argument, so this is automatic; stated, not changed. (e) Council rows stay CLI-invisible this PR (the merge remains MCP-side per D14's wording); a CLI council-rows column is a rider.
- **E-PR3-4 (D14 --all):** the documented semantic (cli.js:513, docs/usage.md:427) is "Show all projects" — cross-project listing. Ruling: implement it via the config-dir `sessions-index.json` (the only existing taskId→project map), treated as ADVISORY (missing/stale entries and unreadable projects skip silently); rows gain `project`; the human table gains a PROJECT column only under `--all`.
- **E-PR3-5 (D15 material, verifier-refuted premise):** "briefing.md on council runs" is MCP-launch-only — CLI-launched council runs have NO briefing.md (only the composed `briefing-stage1.md`). Search rulings: council reads `briefing.md`, falling back to the raw-briefing portion of `briefing-stage1.md` (the text after the `--- MATERIAL / BRIEFING ---` separator), tolerating absence of both (id/tag-only match). Waves read `waveDir/briefing.md` (full text; also cures the MCP pre-flight-failure class whose metadata never gains a briefing), falling back to the 200-char excerpt. LEG rows (briefing = composed userMessage incl. parent context) match on id/tag ONLY — briefing-matching legs would hit inherited parent text N+1 times per wave. All absent-material rows degrade to id/tag matching, never crash.
- **E-PR3-6 (D16 cut decision):** measured marginal write path = 3 files (fanout leg-stamp, fanout-leg-fallback row field, spend-ledger accept+write) vs the spec's pre-recorded 2-file cut line — but every edit is ~1 line riding the existing councilRunId idiom, and fanout-leg.js is a zero-edit pass-through. Ruling: **D16 KEPT.** The real costs are named and handled: the relief extractions (Task 1), the `rowKey` switch case (silent-'(unattributed)' trap), and the UNPINNED hand-copied groupBy enum in `schemas/spend.schema.json` (a fourth lockstep site the spec missed — edited + newly pinned). Spend `tag` follows the file's own dim convention (`tag: tag || null`, null-not-absent — deliberately different from D13's metadata absent-not-null; the file's :79-81 comment is the authority). `SPEND_LEDGER_SCHEMA_VERSION` stays 1 (the file's own additive precedent: v4.3 six fields, v4.4.1 subtreeUnknown; the GOA-7 council-ledger bump is the sibling counter-precedent — asymmetry stated in docs/PR body). Human `spend` rendering is untouched (groups are --json/MCP-only today; a human grouped view is a rider). Continue/resume rows get no tag under D13 (no --tag input there) — inherit-from-metadata is a rider.
- **E-PR3-7 (motivation + guards):** `--search` is ALREADY in the global known-flags set via `models --search`, so `amicus list --search q` passes the gate TODAY and is silently ignored — D15 closes that hole. The spec's cited "v4.5.3 all-32-spawned-flags test" does not exist at this checkout; the real guards are known-flags.test.js:45-50/:126-155. `--tag` with `--retry-failed` is REJECTED (BAD_ARGS) — retry waves keep their own identity; inheriting the original wave's tag is a rider.

## Global Constraints

Every task's requirements implicitly include ALL of these:

- **Absent-not-null everywhere on metadata/docs** (the pack idiom): a run without --tag is BYTE-IDENTICAL on metadata.json, wave.json, run.json, and result docs. Spend rows are the ONE deliberate exception (`tag: tag || null`, dim convention).
- **No new MCP tools** (16 pinned at mcp-tools.test.js:45-46 and mcp-council-run-inputs.test.js:67-69) — only new inputs on existing tools. Zod params use `.optional()`, NEVER `.default()` (the materialized-key lesson).
- **MCP spawn pushes are conditional** (`if (input.tag)`) — argv byte-unchanged pins (mcp-council-run-inputs.test.js:58) must stay green.
- **Search runs on RAW stored text** (before sanitizePreview) on both surfaces; MCP previews stay sanitized at 80 chars.
- **Enrichment stays out of enumerateSessions** — terminal MCP rows keep phase/messageCount/latestPreview/lastActivityAt strictly undefined (mcp-status-enrichment.test.js:86-89).
- **GROUP_DIMS: append 'tag' at the END** (the hint regex at cli-handlers-spend-query.test.js:147 pins the existing order as a prefix). rowKey MUST gain `case 'tag'` in the same commit.
- **New argv-reading code lives in top-level `src/cli*.js` files** (the known-flags scan boundary, cli-council-run-bench.js:5-7). A validator receiving an already-extracted value may live in utils.
- **Size gates:** start.js 298 and fanout.js 298 get relief extractions FIRST (Task 1); after it, no gated file may exceed 300 (`continue.js` 297 and `session-utils.js` 296 take ZERO edits; `mcp-council-awareness.js` 283 has ~17 lines of room — stay inside it). cli.js/mcp-server.js/mcp-tools.js are grandfathered-exempt; bin/amicus.js is unscanned.
- **docs/usage.md edits must not break the docs-quick-sync slice window** (tests/docs-quick-sync.test.js:48-77: '## Other Commands' → '## MCP Server', the `--status running` comment block contiguous through its blank line).
- Single suites: bare `npx jest <path>` (never `npm test -- <path>`). Never bare `npm install`. Path-specific `git add`. Tmp-dir fixtures. Conventional commit prefixes; one task = one commit unless stated.

---

### Task 1: Relief extractions — `createSessionMetadata` out of start.js; leg-attribution stamp out of fanout.js

**Files:**
- Create: `src/sidecar/start-metadata.js`
- Modify: `src/sidecar/start.js` (remove the function, require + re-export)
- Modify: `src/sidecar/fanout.js:122-126` (replace the stamp block with a helper call)
- Modify: `src/sidecar/fanout-wave-io.js` (receives `stampLegAttribution`)

**Interfaces:**
- Produces: `createSessionMetadata(taskId, project, options)` exported from BOTH `src/sidecar/start-metadata.js` and (re-export, unchanged import paths) `src/sidecar/start.js`. `stampLegAttribution(legs, options)` exported from `fanout-wave-io.js` — stamps `councilRunId`/`councilName` onto legs exactly as today (Task 7 adds tag here).
- Zero behavior change; this is a mechanical move.

- [ ] **Step 1:** Move `createSessionMetadata` (start.js:36-75, verbatim including its docblock) to new `src/sidecar/start-metadata.js` with the needed requires (`fs`, `SessionPaths`, `writeFileAtomic` — copy the exact require forms start.js uses). In start.js: `const { createSessionMetadata } = require('./start-metadata');` and KEEP `createSessionMetadata` in start.js's module.exports (grep its importers — fanout-leg.js and any others import it from './start'; the re-export keeps every import working).
- [ ] **Step 2:** In fanout.js, replace lines 122-126 (the councilRunId/councilName forEach + its §7.2 comment) with `stampLegAttribution(legs, options);` and add the function to fanout-wave-io.js:

```js
/**
 * v4.3 §7.2 (moved here v4.7 PR3 Task 1): stamp council attribution onto every
 * leg — fanout-leg's appendSpend reads it; no-op for every non-council caller.
 * v4.7 F8 (Task 7) adds tag stamping in the same pass.
 */
function stampLegAttribution(legs, options) {
  if (options.councilRunId || options.councilName) {
    legs.forEach(l => { l.councilRunId = options.councilRunId; l.councilName = options.councilName; });
  }
}
```

Export it; require it in fanout.js alongside the existing fanout-wave-io imports.
- [ ] **Step 3:** Run the movers' dependent suites: `npx jest tests/sidecar/fanout.test.js tests/council/run-launch-spend.test.js tests/start.test.js tests/start-json.test.js tests/read-json.test.js tests/pack/cli-fanout-start-pack.test.js` — ALL PASS with zero test edits (the proof of a pure move). Measure both files with gate arithmetic; report the new counts (expect start.js ~260s, fanout.js ~294).
- [ ] **Step 4:** Commit:

```bash
git add src/sidecar/start-metadata.js src/sidecar/start.js src/sidecar/fanout.js src/sidecar/fanout-wave-io.js
git commit -m "refactor(sidecar): extract createSessionMetadata + leg-attribution stamp (F8 relief, zero behavior)"
```

---

### Task 2: `--tag` CLI surface — validator, usage blocks, handler plumbing, retry-failed reject

**Files:**
- Modify: `src/utils/validators.js` (new `validateTag`)
- Modify: `src/cli.js` (three usage-block lines)
- Modify: `src/cli-handlers-run.js` (~:93-121), `src/cli-handlers-fanout.js` (~:28-36 and :117-159), `src/cli-handlers-council-run.js` (~:138-148, :181-216)
- Test: `tests/utils/validators.test.js` (or the file's existing home for validator tests — grep `TASK_ID_PATTERN` under tests/), `tests/utils/known-flags.test.js`, plus one rejection test per handler in each handler's existing suite

**Interfaces:**
- Produces: `validateTag(value) → {ok: true, tag} | {ok: false, error}` — rejects non-strings (a valueless `--tag` parses to boolean `true`), rejects anything failing `/^[a-zA-Z0-9_-]{1,64}$/`. Handlers read `args.tag`, validate (exit 1 with the error on failure), and pass `tag` into their options objects (`startAmicus`/`runFanout`/`runCouncil`). Task 3 stores it.

- [ ] **Step 1: Failing tests.** `validateTag` unit tests (valid simple tag; 64-char boundary ok; 65 rejected; empty rejected; boolean true rejected — the valueless-flag shape; space/dot/emoji rejected). known-flags: extend the usage-derived sample list (:28-33 region) with `'tag'` AND add beside :45-50: `test("'tag' is a known flag (F8 — forwarded by MCP spawns)", () => { expect(getKnownFlags().has('tag')).toBe(true); });` — RED until the usage lines land. Handler tests: `--tag 'bad tag!'` exits 1 with the validator message; `fanout --retry-failed <id> --tag x` exits 1 BAD_ARGS (`--tag cannot be combined with --retry-failed`).
- [ ] **Step 2: RED run:** `npx jest tests/utils/known-flags.test.js tests/utils/validators.test.js` (+ the handler suites) — new tests FAIL.
- [ ] **Step 3: Implement.** validators.js:

```js
const TAG_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
/**
 * v4.7 F8 (D13): tag validation REJECTS (unlike sanitizeCouncilName, which
 * cleans) — a stored tag is a user-chosen search key, so silent truncation
 * or charset-stripping would make `--search`/`--group-by tag` miss it.
 * Non-string guards the valueless `--tag` parse (cli.js turns it into true).
 */
function validateTag(value) {
  if (typeof value !== 'string' || !TAG_PATTERN.test(value)) {
    return { ok: false, error: 'Invalid --tag: 1-64 chars, letters/digits/_/- only' };
  }
  return { ok: true, tag: value };
}
```

Export both. cli.js usage lines (exact text, one per block — start near :457, fanout near :492, council run bracket list near :583):

```
  --tag <t>                Label this session for list/search/spend grouping (1-64 chars, [A-Za-z0-9_-])
```

(council run block: add `[--tag <t>]` to the bracket list.) Handlers: in each, where `args.tag !== undefined`, run validateTag, print the error + exit 1 on failure, else add `tag: args.tag` beside `pack: packRecord` in the options object (:120 / :158 / :190 slots). cli-handlers-fanout.js retry branch (:28-36): reject the combination BEFORE dispatch with the BAD_ARGS message above.
- [ ] **Step 4: GREEN + dependent suites:** `npx jest tests/utils/known-flags.test.js tests/utils/validators.test.js tests/cli.test.js tests/cli-process.integration.test.js <handler suites>`.
- [ ] **Step 5: Commit:** `feat(cli): --tag on start/fanout/council run — reject-style validation, usage-registered (F8 D13)`

---

### Task 3: D13 storage — the four CLI-side sites + wave-doc threading

**Files:**
- Modify: `src/sidecar/start-metadata.js` (destructure + spread), `src/sidecar/start.js` (pass tag at the :185-187 call)
- Modify: `src/sidecar/fanout.js` (writeWaveMetadata spread + metaTag inherit + both buildWaveResult call sites)
- Modify: `src/utils/result-schema.js` (solo spread :73 region; buildWaveResult param :132 + spread :159), `src/utils/result-schema-rebuild.js` (~:93 pattern)
- Modify: `src/council/run-state.js` (initCouncilRun seed spread, :110 region)
- Test: the pack pin suites' siblings — `tests/pack/cli-fanout-start-pack.test.js` idiom, `tests/pack/cli-council-pack.test.js` idiom, `tests/sidecar/fanout.test.js`

**Interfaces:**
- Consumes: `tag` on handler options (Task 2). Produces: `metadata.tag`, wave-metadata `tag`, `run.json.tag`, solo/wave result-doc `tag` — all absent-not-null. Tasks 5/6/7 read them.

- [ ] **Step 1: Failing tests** (mirror the pack pin shapes exactly — each suite's existing pack tests are the scaffolding authority):
  - solo: `start --tag alpha` → metadata.json has `tag: 'alpha'`; without --tag → `'tag' in meta === false`; run doc carries tag (and absence).
  - wave: fanout with tag → wave metadata + wave.json carry it; without → key absent from BOTH (the fanout.test.js:862-867 twin).
  - council: runCouncil with `tag` in options → run.json seed carries it; absent → key absent (the cli-council-pack.test.js:257-259 twin).
  - rebuild: a wave rebuilt from metadata carrying tag keeps it (result-schema-rebuild path).
- [ ] **Step 2: RED run** on those suites.
- [ ] **Step 3: Implement** — every edit is the pack idiom verbatim:
  - start-metadata.js: add `tag` to the destructure (:38 shape) and `...(tag ? { tag } : {}),` after the pack spread (:69 shape). start.js :185-187 call: add `tag` to the passed options object.
  - fanout.js: in the writeWaveMetadata object add `...(options.tag ? { tag: options.tag } : {}),` after the pack spread (:151); beside `const metaPack = waveMeta.pack;` (:163) add `const metaTag = waveMeta.tag;`; at BOTH buildWaveResult call sites (:174 and :285 regions) add `tag: options.tag || metaTag,` beside the pack argument.
  - result-schema.js: solo — `...(metadata.tag ? { tag: metadata.tag } : {}),` after :73; wave — add `tag = null` to buildWaveResult's params (:132) and `...(tag ? { tag } : {}),` after the pack spread (:159).
  - result-schema-rebuild.js: `...(meta.tag ? { tag: meta.tag } : {}),` beside the :93 pack line.
  - run-state.js: `...(o.tag ? { tag: o.tag } : {}),` after the pack spread (:110).
- [ ] **Step 4: GREEN + dependents:** `npx jest tests/pack/cli-fanout-start-pack.test.js tests/pack/cli-council-pack.test.js tests/sidecar/fanout.test.js tests/start-json.test.js tests/read-json.test.js tests/council/run-schema.test.js tests/schemas.test.js`
- [ ] **Step 5:** Add `"tag": { "type": "string" }` (plain string, never `["string","null"]` — the schemas.test.js:94-102 pack:null-rejection precedent) to `schemas/run.schema.json` and `schemas/wave.schema.json` beside their pack entries, and to `schemas/council-run.schema.json`'s top-level properties. Re-run `npx jest tests/schemas.test.js tests/council/run-schema.test.js`.
- [ ] **Step 6: Commit:** `feat(sidecar): store tag absent-not-null on solo/wave/council artifacts + result docs (F8 D13)`

---

### Task 4: D13 MCP — Zod inputs, spawn forwarding, the shared-server fifth site

**Files:**
- Modify: `src/mcp-tools.js` (:123, :371, :511 slots), `src/mcp-server.js` (spawn builders :394-426 and :1293-1319; the in-process metadata write ~:502), `src/mcp-council-run.js` (builder :168-197)
- Test: `tests/mcp-server.test.js`, `tests/mcp-council-run-inputs.test.js`, `tests/mcp-fanout.test.js`, `tests/mcp-start-metadata.test.js`, `tests/mcp-tools.test.js`

**Interfaces:**
- Produces: `tag` input on amicus_start/amicus_fanout/amicus_council_run (Zod `.optional()` + the TAG_PATTERN regex); children receive `--tag` conditionally; the shared-server MCP solo stores tag with NO child.

- [ ] **Step 1: Failing tests:**
  - Zod: invalid tag (`'bad tag!'`, 65 chars) rejected at the schema for all three tools; valid accepted; omitted → key absent from parsed input (`.optional()`, no `.default()`).
  - Spawn capture (each builder's existing argv-capture idiom): `input.tag: 'alpha'` → argv contains `'--tag', 'alpha'`; omitted input → argv BYTE-IDENTICAL to today (the :58 pin extended).
  - Shared-server: the amicus_start in-process path with `tag` writes metadata.json carrying `tag: 'alpha'`; without → key absent (extend tests/mcp-start-metadata.test.js's source-window or behavior tests per that file's idiom).
- [ ] **Step 2: RED run** on those suites.
- [ ] **Step 3: Implement:** mcp-tools.js — beside each pack param: `tag: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/, '1-64 chars, letters/digits/_/- only').optional().describe('Label this session for list/search/spend grouping'),`. Spawn builders — `if (input.tag) { args.push('--tag', input.tag); }` in each conditional run (:407-417 region, :1303-1319 region, mcp-council-run.js :174-197 region). Shared-server write — `...(input.tag ? { tag: input.tag } : {}),` beside the packRecord spread at mcp-server.js:502.
- [ ] **Step 4: GREEN + dependents:** `npx jest tests/mcp-server.test.js tests/mcp-council-run-inputs.test.js tests/mcp-fanout.test.js tests/mcp-start-metadata.test.js tests/mcp-tools.test.js`
- [ ] **Step 5: Commit:** `feat(mcp): tag inputs forwarded to spawned children + stamped on the shared-server in-process path (F8 D13, errata E-PR3-2)`

---

### Task 5: D14 — one enumeration, live --all, TAG column, MCP re-graft

**Files:**
- Modify: `src/sidecar/read.js` (enumerateSessions + listSidecars + render)
- Modify: `src/mcp-server.js` (amicus_list :982-1031 consumes the shared core), `src/mcp-council-awareness.js` (council rows gain tag, :221-226), `src/mcp-tools.js` (status input relax, :216)
- Modify: `bin/amicus.js` (handleList passes through unchanged — verify only)
- Test: `tests/read-json.test.js`, `tests/abort-all.test.js`, `tests/mcp-server.test.js`, `tests/mcp-status-enrichment.test.js`, `tests/mcp-council-list.test.js`, `tests/council-pointer-fence.test.js`

**Interfaces:**
- Consumes: metadata `tag` (Task 3), `sessions-index.json` (`src/utils/session-index.js` — advisory map taskId→canonicalProjectPath).
- Produces: enumerateSessions rows gain `tag` (emit-only-when-set: `...(meta.tag ? { tag: meta.tag } : {})`), `mode` (meta.mode || (meta.headless ? 'headless' : 'interactive')), and under --all a `project` field. `enumerateAllProjects(opts)` (new, read.js): unique project set = values of sessions-index ∪ the current project, each enumerated with per-project try/catch skip. MCP amicus_list keeps its response shape byte-compatible plus additive fields.

- [ ] **Step 1: Failing tests:**
  - read.js rows carry tag when stored, absent otherwise; rows carry mode.
  - `--all`: two tmp projects, sessions in both, sessions-index seeded (write the index file in the fixture per src/utils/session-index.js's format) → listSidecars({all: true}) returns rows from both with `project` set; a stale index entry pointing at a missing dir is skipped silently; without --all only the cwd project appears.
  - Human render: TAG column appears between STATUS and AGE (assert header contains 'TAG' and a tagged row renders the tag; the 'wave(2 legs)' marker pin at read-json.test.js:77 stays green).
  - MCP: amicus_list rows still carry sanitized previews (≤80, no `<>`/backticks), mode, running-only enrichment (terminal rows strictly undefined — the :86-89 pins BYTE-UNEDITED), council merge intact, plus NEW: rows carry tag; council rows carry tag; ordinary MCP rows now also carry type/parentWave/legCount (additive assertions).
  - MCP status input: `status: 'aborted'` accepted THROUGH the schema now (the schema-level rejection is gone).
- [ ] **Step 2: RED run.**
- [ ] **Step 3: Implement:**
  - read.js: add to the row literal `...(meta.tag ? { tag: meta.tag } : {}),` and `mode: meta.mode || (meta.headless ? 'headless' : 'interactive'),`. New `enumerateAllProjects(opts)`: read the index via a tolerant require of `../utils/session-index` (use its exported read helper if one exists — check the module; else read the file with try/catch → {}), build `new Set([...Object.values(index), project])`, enumerate each inside try/catch, stamp `project` on each row, merge + createdAt-desc sort + status filter. listSidecars: `const { status, all, json, project = process.cwd() } = options;` and `const sessions = all ? enumerateAllProjects({ status, project }) : enumerateSessions(project, { status });`. Render: header `'ID        MODEL                  STATUS     TAG         AGE         BRIEFING'` (+ `PROJECT` appended only when all); row inserts `(s.tag || '').padEnd(12)` between status and age; when all, append the project path last.
  - mcp-server.js amicus_list: replace the inline readdir/parse loop (:987-1017) with `enumerateSessions(cwd)` rows, then per-row re-graft EXACTLY today's decorations: `briefing: sanitizePreview(String(row.briefing || ''), 80)`, keep row.mode, and the running-only readProgress enrichment block unchanged; keep the council merge (:1021) and status filter (:1025-1027) as-is. Require enumerateSessions from '../sidecar/read' — wait, mcp-server.js is at src/ root: `require('./sidecar/read')`.
  - mcp-council-awareness.js :221-226: add `...(run.tag ? { tag: run.tag } : {}),` to the row literal.
  - mcp-tools.js :216: `status: z.string().optional().describe("Filter by status ('all', 'running', 'complete', 'error', 'aborted', …)"),`.
- [ ] **Step 4: GREEN + dependents:** `npx jest tests/read-json.test.js tests/abort-all.test.js tests/mcp-server.test.js tests/mcp-status-enrichment.test.js tests/mcp-council-list.test.js tests/council-pointer-fence.test.js tests/mcp-tools.test.js`
- [ ] **Step 5: Commit:** `feat(list): one enumeration behind CLI+MCP, live --all (cross-project via sessions-index), TAG column (F8 D14)`

---

### Task 6: D15 — `--search` on both list surfaces

**Files:**
- Modify: `src/sidecar/read.js` (search core + CLI wiring), `src/mcp-server.js` (search input consumption), `src/mcp-tools.js` (amicus_list `search` param), `bin/amicus.js` (pass `search: args.search`), `src/cli.js` (list usage block gains `--search <q>`)
- Test: `tests/read-json.test.js` (or a new `tests/list-search.test.js`), `tests/mcp-server.test.js`

**Interfaces:**
- Produces: `searchSessions(rows, q, ctx)` in read.js — case-insensitive substring over: row.id, row.tag, and per-class briefing material: solo → row.briefing (full); wave → `waveDir/briefing.md` when readable else row.briefing (excerpt); LEG rows (parentWave set) → id/tag ONLY; council rows (type 'council-run', MCP path) → runDir/briefing.md else the post-`--- MATERIAL / BRIEFING ---` portion of briefing-stage1.md, else id/tag. Missing material never throws (swallow-catch idiom, read.js:58 / mcp-council-awareness.js:219 templates). CLI `amicus list --search q` and MCP `amicus_list {search}` both consume it; `--search` with no value errors `--search requires a value` (the models.js:279-281 shape); the --json output echoes `search: q` (the buildCatalogDoc precedent — for list, wrap rows as today, echo only if the list --json shape has a natural slot; otherwise skip the echo and note it).
- [ ] **Step 1: Failing tests:** match by id substring; by tag; by solo briefing text (case-insensitive); by wave FULL text beyond the 200-char excerpt (fixture with a >200-char prompt whose tail is the needle, briefing.md present); wave fallback to excerpt when briefing.md missing; LEG rows NOT matched by briefing text (parent-context needle misses the leg row) but matched by id; council row matched via briefing.md (MCP fixture) AND via briefing-stage1.md fallback (write a fixture stage file with the separator); absent-material row degrades to id/tag; `--search` valueless errors; MCP search param accepted + filters.
- [ ] **Step 2: RED run.**
- [ ] **Step 3: Implement** per the interface above. The core matcher mirrors models.js:70-73 (`toLowerCase().includes`, OR across fields). Keep all file reads inside try/catch. For the council fence: reuse `containsOnDisk` exactly as mcp-council-awareness.js:214 does — never a bare path join.
- [ ] **Step 4: GREEN + dependents** (the Task 5 suite list + the new tests).
- [ ] **Step 5: Commit:** `feat(list): --search over id/tag/briefing on CLI + MCP, per-class material fallbacks (F8 D15, errata E-PR3-5)`

---

### Task 7: D16 — spend tag dimension

**Files:**
- Modify: `src/sidecar/fanout-wave-io.js` (stampLegAttribution gains tag), `src/sidecar/fanout-leg-fallback.js` (~:43 row field), `src/utils/spend-ledger.js` (:63-99 param + row), `src/sidecar/start.js` (:262-273 solo row `tag: m.tag`), `src/spend-query.js` (:20 GROUP_DIMS append + :50-59 rowKey case), `schemas/spend.schema.json` (:36 enum), `src/cli.js` (:636 usage literal)
- Test: `tests/utils/spend-ledger.test.js`, `tests/spend-ledger-fields.test.js`, `tests/cli-handlers-spend-query.test.js`, `tests/mcp-spend.test.js`, `tests/council/run-launch-spend.test.js`, `tests/schemas-live.test.js`

**Interfaces:**
- Consumes: options.tag (Tasks 2-3), leg objects (stamped `l.tag = options.tag` in stampLegAttribution when set). Produces: spend rows carry `tag` (null-default dim convention); `--group-by tag` groups real keys with untagged history under `'(unattributed)'`.

- [ ] **Step 1: Failing tests:**
  - Leg rows: a fanout with tag → every leg's ledger row carries `tag: 'alpha'` (the run-launch-spend.test.js:68-79 councilRunId template, driven through the real runFanout chain); untagged → `tag: null` (extend spend-ledger-fields.test.js:32-43 with the chosen convention pin).
  - Solo row: start with tag → its spend row carries it.
  - Grouping: rows with tags 'a'/'a'/null → `--group-by tag` yields groups keyed 'a' and '(unattributed)' — the REAL-KEY assertion that kills the rowKey-default-arm mutant (mutation-check it: remove the `case 'tag'` → this test must fail with one '(unattributed)' bucket).
  - Schema lockstep NEW PIN: assert `require('../../schemas/spend.schema.json')`'s groupBy enum `toEqual(GROUP_DIMS)` (kills the hand-copy drift class forever), and/or validate a groupBy:'tag' doc in schemas-live.test.js.
  - The CLI hint regex (:147) stays green (append-at-end proof).
- [ ] **Step 2: RED run.**
- [ ] **Step 3: Implement:** stampLegAttribution gains `if (options.tag) { legs.forEach(l => { l.tag = options.tag; }); }`. fanout-leg-fallback.js row: `tag: (leg && leg.tag) || null,` beside councilRunId (:42-43). spend-ledger.js: `tag` joins the destructure and the row as `tag: tag || null,` in the nullable-dims block (:82-87) — update the :79-81 comment's dim list. start.js solo row: `tag: m.tag || null,` (m re-read from metadata at :254 — the in-scope-value rule the :265-272 comment enforces). spend-query.js: GROUP_DIMS append `'tag'` LAST; rowKey `case 'tag': return row.tag || UNATTRIBUTED;` (match the file's existing case idiom). spend.schema.json enum: append `"tag"`. cli.js:636: `--group-by <model|wave|council|project|op|day|tag>`. Update fanout-leg-fallback's :20-23 docstring contract note (tagless rows byte-identical... they are NOT byte-identical now — tag:null is added; correct the note: rows gain the null-default tag dim; the byte-identity claim applies to the linkage-field conventions).

  ⚠️ Note: `tag: null` on every new untagged row is a ROW SHAPE change — verify tests/utils/spend-ledger.test.js:79-86 (Object.keys omission pin for subtreeUnknown) stays green (it pins subtreeUnknown's absence, not the full key set) and extend it to document tag's null-not-absent choice.
- [ ] **Step 4: GREEN + dependents:** `npx jest tests/utils/spend-ledger.test.js tests/spend-ledger-fields.test.js tests/cli-handlers-spend-query.test.js tests/mcp-spend.test.js tests/council/run-launch-spend.test.js tests/schemas-live.test.js tests/sidecar/fanout.test.js tests/sidecar/runleg-fallback.test.js tests/continue-resume-spend.test.js`
- [ ] **Step 5: Commit:** `feat(spend): tag dimension — leg/solo row stamping, --group-by tag, schema enum pinned to GROUP_DIMS (F8 D16)`

---

### Task 8: Docs + CHANGELOG

**Files:** `docs/usage.md` (:12 cheat-sheet, :424-428 Other Commands block — mind the docs-quick-sync slice window, :578 dims row, :780 MCP mirror, :32), `README.md` (:400, :449, :485), `src/mcp-tools.js` (amicus_list description :212-214 gains tag/search mention), `CHANGELOG.md` [Unreleased].

All claims verified against SHIPPED code of Tasks 1-7 (the docs-drift discipline). CHANGELOG: Added — `--tag` (three commands, CLI+MCP, absent-not-null storage); `amicus list --search` + MCP search (per-class material, fallbacks); spend `tag` dimension. Changed — `amicus list`/`amicus_list` now share one enumeration (MCP rows gain type/parentWave/legCount; CLI rows gain mode; MCP status input accepts the full status vocabulary); TAG column. Fixed (new section before [4.6.3]) — `--all` now lists all projects via the session index (was silently ignored since its introduction); `amicus list --search` was silently ignored (flag known repo-wide via models --search) — now implemented. Verify with `npx jest tests/docs-quick-sync.test.js tests/docs-command-coverage.test.js tests/cli.test.js` + grep-driven docs suites. Commit: `docs: F8 tags/search/one-list + spend tag dimension (F8 D13-D16)`

---

### Task 9: End-to-end parity invariant suite

**Files:** Create `tests/f8-tag-parity.test.js`

One suite pinning the composition: (1) CLI solo/wave/council with `--tag alpha` → tag on metadata, result docs, run.json, list rows (CLI + MCP surfaces), spend rows, `--group-by tag` groups, `--search alpha` hits all three classes; (2) the SAME through MCP handler paths (shared-server solo stamped without a child — the E-PR3-2 site; fanout/council via captured-argv + pre-seed merges where the harness supports it, per existing MCP test idioms); (3) untagged runs: byte-absent everywhere (metadata/docs/run.json), `tag: null` on spend rows only, '(unattributed)' grouping; (4) a mutation check per the PR2 pattern: comment out the shared-server stamp (mcp-server.js:502 region) → the MCP-solo parity test MUST fail; restore, verify clean diff. Run `npx jest tests/f8-tag-parity.test.js` then the full `npx jest tests/` directory sweep for the touched areas. Commit: `test(f8): tag/search/spend end-to-end parity suite + shared-server mutation proof`

---

### Task 10: Gates + push + PR

Full `npm test` (~497 suites expected), `npm run lint`, `npm run check:sizes` (start.js/fanout.js must be ≤300 — expect ~265/~296), zero-edit check on `continue.js`/`session-utils.js` (`git diff origin/main --stat -- src/sidecar/continue.js src/sidecar/session-utils.js` empty), push (≥5-min timeout), PR titled `v4.7 PR3 — F8: tags, --search, one list (D13–D16)` with the errata block (E-PR3-1..7, owner veto open) + riders: retry-failed tag inheritance; continue/resume spend-row tag inherit; CLI council rows in list; human spend grouped view; check-suite verification (webhook-drop lesson).

---

## Self-review notes

- Spec coverage: D13 → Tasks 2-4; D14 → Task 5 (+E-PR3-3/4 rulings); D15 → Task 6 (+E-PR3-5); D16 → Task 7 (+E-PR3-6 kept-with-costs); docs → Task 8; §9 testing → per-task REDs + Task 9 composition + two mutation checks (rowKey, shared-server stamp).
- Type consistency: `tag` field name everywhere; `validateTag`/`TAG_PATTERN` (utils/validators.js); `stampLegAttribution(legs, options)`; `enumerateAllProjects(opts)`; spend convention `tag: tag || null` (dims) vs absent-not-null (metadata/docs) — deliberate fork, documented at both sites.
- Known deliberate scope-outs (riders, not gaps): council rows in CLI list; human grouped spend view; retry-failed/continue tag inheritance.
