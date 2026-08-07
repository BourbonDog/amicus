# v4.7 PR2 — GOA-7 prerequisite: resolved-id ledger, legacy-read — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every runStats row built from a served leg carries `resolvedModel` (the executable id that actually served), the council ledger stamps it at `LEDGER_SCHEMA_VERSION` 2 (legacy-read, no migration), reliability stats segment by resolved id with `aliases[]`/`legacy` marks, and the chair fallback picker survives the re-key without ever launching an unroutable name.

**Architecture:** Additive threading of the already-present-but-discarded `leg.model` (executable id) through every row producer, the tally allowlist, and the ledger, then a re-keyed aggregation. `row.model` stays the alias everywhere — `resolvedModel` is a new emit-only-when-set field, never a rewrite. The chair picker launches the group's most-recent ALIAS (`aliases[0]`), keeping launch strings in alias-space so routing semantics are unchanged.

**Tech Stack:** Node 22 (CommonJS), jest. Repo: amicus, worktree `C:\Users\sendt\code\amicus-wt-v47-pr2`, branch `feat/v4.7-pr2-goa7-resolved-ledger` off `origin/main` = `06a3665`.

**Spec:** `docs/superpowers/specs/2026-08-06-v4.7-count-is-the-count-design.md` §6 (D8–D12), rulings R2 (legacy-read) + the §2 table. Recon re-grounded 2026-08-07 at `06a3665` by a 10-agent workflow (7 tracers + 3 adversarial verifiers); errata below.

## Errata vs spec §6 (recon 2026-08-07, controller-ruled per the E2/E6 precedent — owner veto open)

- **E-PR2-1 (D8 correction, verifier-REFUTED premise):** "all callers get it free" via `buildRunStatsEntry` is false. `tally.js:115-131` re-projects EVERY row through a field allowlist and verdict.json/ledger read the POST-projection record — the tally allowlist edit is mandatory (spec §5 D3 anticipated this for waveId; same slot). Additionally three shapers bypass the builder entirely: `claudeRunStatsRow` (leg-less, stays untouched), debate's `legRow`/inline reshapes (`run-debate.js:39-45,92,145`), and `debateRunStatsRows`' `mk()` (`debate.js:101-115`). D8 is a five-site edit: builder + tally + three debate shapers.
- **E-PR2-2 (D8 scope ruling):** debate rows ARE threaded (Task 2). The resolved id is destroyed at debate normalization today; threading it is ~5 small spreads, keeps "every row auditable to what served" true, and debate roles still never join the ledger (no D9/D10 interaction). Emission source is the RAW leg's `.model` at the normalization sites — never the normalized shape's `.model` (that is the alias).
- **E-PR2-3 (D11 correction, verifier-PARTIALLY-REFUTED):** the spec's "the router accepts both [alias and resolved id]" is not a blanket guarantee — four enumerated failure subclasses exist for raw executable ids (divergent-vendor cross-gateway forms, openrouter-literal under `--gateway direct`, openrouter-literal without an OR key, removed alias). Design consequence: `pickFallbackChair` launches `aliases[0]` (most-recent alias, recency = ledger append order); the fall-back-to-resolved-id branch exists only for aggregate rows with no `aliases` (old fixtures/foreign rows) — in production `aliases[]` is non-empty by construction (every ledger row carries an alias-space `model`).
- **E-PR2-4 (D12 gap):** `docs/configuration.md:241` (council-ledger.jsonl row description) goes stale under D9 and is added to the docs register.
- **E-PR2-5 (test rot):** `tests/council/ledger.test.js:93-100` pins newer-schemaVersion tolerance with literal `2` — vacuous after the bump. Rewritten relative to the exported constant (`LEDGER_SCHEMA_VERSION + 1`).
- **E-PR2-6 (D12 confirmation):** NO new schema file for the ledger (the 19-filename pin `tests/schemas.test.js:294-303`; ledger row shape stays unpublished prose in docs/schemas.md). `council-stats.schema.json` gets additive row properties only; NO new top-level envelope fields (`ledger.test.js:102-107` toEqual pin).
- **E-PR2-7 (R2 conflation, accepted as ruled):** absence⇒legacy also captures brand-new v2 rows built from `leg: null` (give-up chair, retried-no-leg seats, claude, hand-assembled/MCP tally input). This follows R2 as ruled — a leg-less death's resolution is genuinely unknowable, and spec §3.4 explicitly blesses the claude row as "legacy-keyed forever, correctly". Pinned by tests + documented, not special-cased.
- **Substitution attribution (explicit, from recon):** a fallback-substituted leg's `resolvedModel` is the SUBSTITUTE's id — that is D8's stated "what actually served" intent; a substituted seat's reliability accrues to the substitute. Pinned in Task 7.

## Global Constraints

Every task's requirements implicitly include ALL of these:

- **`row.model` is NEVER repurposed** — it stays the alias. The bijection suite (`tests/council/run-cost-bijection.test.js:205-206`) compares `${waveId}::${r.model}` multisets against `${waveId}::${modelInput||model}`; writing resolved ids into `model` fails all six scenarios.
- **`resolvedModel` is sourced ONLY from a raw leg's `.model`** (or a normalized debate leg's already-threaded `.resolvedModel`). **NEVER from `modelInput`** — that would mint an alias as a fake resolved id.
- **Emit-only-when-set everywhere** (builder, debate shapers, tally allowlist, ledger row, `legacy` flag). Four exact-equality pins depend on it: `tally.test.js:180-181`, `run-assemble.test.js:177-180`, `debate.test.js:99-102/151-154/168-171` — they must pass BYTE-UNEDITED (that is the byte-compat proof).
- **`src/council/run.js` (295/300) and `src/council/run-stages.js` (290/300) take ZERO edits** — their rows flow through `buildRunStatsEntry` untouched. Do not open them except to read.
- **`deriveReliability` stays version-blind** — it never reads `schemaVersion` (legacy-read = pure absent-field semantics; no version-conditional reads, no migration).
- **`LEDGER_SCHEMA_VERSION` 1→2**; absent `resolvedModel` ⇒ legacy row aggregated under its alias (spec R2).
- **`aliases[]` recency comes from ledger file append order ONLY** — `date` is day-granular (CLI) or free-form (MCP path) and must never be compared.
- **No new schema file; no new top-level fields on the council-stats envelope.**
- Single test suites: **bare `npx jest <path>`** — `npm test -- <path>` stamps `.test-passed` and makes pre-push SKIP the full suite.
- **Never bare `npm install`**; manual CLI checks via `node bin/amicus.js`, never PATH `amicus`; `git add` with explicit paths (never `-am`/`-A`); test fixtures in `fs.mkdtempSync(os.tmpdir())` dirs; never write `degraded.value` anywhere.
- 300-line gate (physical lines, `scripts/check-file-sizes.js` semantics). Expected post-edit sizes: ledger.js ~150, tally.js ~138, run-assemble.js ~256, run-chair.js ~266, run-debate.js ~281, debate.js ~179, cli-handlers-council.js ~243 — all clear. If any file threatens 300, STOP and report; do not extract mid-task.
- Commits: conventional prefixes (`feat:`/`test:`/`fix:`/`docs:`), one task = one commit unless a step says otherwise.

---

### Task 1: D8 core — `resolvedModel` through `buildRunStatsEntry` and the tally allowlist

**Files:**
- Modify: `src/council/run-assemble.js:38-68` (docblock + builder)
- Modify: `src/council/tally.js:115-131` (allowlist + F3 comment)
- Test: `tests/council/run-assemble.test.js` (near the model-override test at :183-189)
- Test: `tests/council/tally.test.js` (near the waveId survival test at :184-191)

**Interfaces:**
- Consumes: `buildRunStatsEntry({leg, model, role, wasChair, conformance, findingsUnverified, repairRefused})` — current shape at run-assemble.js:54-68; `tally(record)` allowlist map at tally.js:115-131.
- Produces: rows may carry `resolvedModel: <string>` (only when `leg && leg.model`); `tally()` output rows preserve `resolvedModel` when present. Tasks 3, 4, 7 rely on the field name `resolvedModel` exactly.

- [ ] **Step 1: Write the failing tests**

In `tests/council/run-assemble.test.js`, inside the `buildRunStatsEntry` describe block (after the model-override test at ~:183-189):

```js
  describe('resolvedModel (v4.7 GOA-7 D8)', () => {
    test('carries leg.model (the executable id) alongside the alias override', () => {
      const row = buildRunStatsEntry({
        leg: { model: 'openai/gpt-5.2', modelInput: 'gpt', status: 'complete', durationMs: 5, usage: null },
        model: 'gpt', role: 'seat',
      });
      expect(row.model).toBe('gpt');
      expect(row.resolvedModel).toBe('openai/gpt-5.2');
    });

    test('leg:null emits NO resolvedModel key (give-up chair / dead-seat shape)', () => {
      const row = buildRunStatsEntry({ leg: null, model: 'gpt', role: 'chair' });
      expect('resolvedModel' in row).toBe(false);
    });

    test('a leg with model:null (routing-failure/setup-throw class) emits NO resolvedModel — and never falls back to modelInput', () => {
      const row = buildRunStatsEntry({
        leg: { model: null, modelInput: 'gpt', status: 'error', durationMs: null, usage: null },
        model: 'gpt', role: 'seat',
      });
      expect('resolvedModel' in row).toBe(false);
    });
  });
```

In `tests/council/tally.test.js`, beside the waveId survival test (~:184-191), following its exact pattern (same record scaffold the neighboring tests use):

```js
  test('resolvedModel survives the tally allowlist when set (v4.7 GOA-7 D8)', () => {
    const record = tally(baseRecord({
      runStats: [{ model: 'gpt', role: 'seat', wasChair: false, conformance: 'clean',
        resolvedModel: 'openai/gpt-5.2', status: 'complete', durationMs: 5, usage: null }],
    }));
    expect(record.runStats[0].resolvedModel).toBe('openai/gpt-5.2');
  });

  test('absent resolvedModel stays absent through tally (legacy/hand-assembled rows)', () => {
    const record = tally(baseRecord({
      runStats: [{ model: 'gpt', role: 'seat', wasChair: false, conformance: 'clean',
        status: 'complete', durationMs: 5, usage: null }],
    }));
    expect('resolvedModel' in record.runStats[0]).toBe(false);
  });
```

⚠️ Adapt the record scaffold to what the file actually uses (read the neighboring waveId test first — if it builds the record inline rather than via a `baseRecord` helper, do the same). The assertions are the contract; the scaffold follows the file's idiom. The existing exact-key pin at :180-181 must remain BYTE-UNEDITED and green.

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npx jest tests/council/run-assemble.test.js tests/council/tally.test.js`
Expected: the three new run-assemble tests FAIL (`resolvedModel` undefined); the tally survival test FAILS (field stripped); the absence tests may already pass — that is fine, they are regression pins.

- [ ] **Step 3: Implement**

`src/council/run-assemble.js` — extend the docblock (lines 38-43) by appending one sentence to the paragraph ending "(ledger.js:20-24).":

```
 * `resolvedModel` (v4.7 GOA-7) preserves leg.model — the executable id that
 * actually served, post-fallback-substitution — emit-only-when-set and never
 * sourced from modelInput (an alias must never masquerade as a resolved id).
```

In `buildRunStatsEntry`, add one spread after the waveId spread (line 63):

```js
    ...(leg && leg.waveId ? { waveId: leg.waveId } : {}),
    ...(leg && leg.model ? { resolvedModel: leg.model } : {}),
```

`src/council/tally.js` — in the allowlist map, add after the waveId line (:127):

```js
      ...(r.waveId ? { waveId: r.waveId } : {}),
      ...(r.resolvedModel ? { resolvedModel: r.resolvedModel } : {}),
```

And update the F3 comment's LAST sentence (currently "The append-only LEDGER is deliberately NOT extended — that is a schema-versioned product decision.") to:

```js
      // when set, and the runStats schema declares no additionalProperties, so a
      // run without either is byte-for-byte unchanged. v4.7 GOA-7 exercised the
      // ledger's schema-versioned extension slot: `resolvedModel` rides this
      // allowlist into the ledger's v2 rows (ledger.js, LEDGER_SCHEMA_VERSION 2).
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/council/run-assemble.test.js tests/council/tally.test.js`
Expected: ALL PASS, including the untouched exact-key pin at tally.test.js:180-181 and the leg:null toEqual at run-assemble.test.js:177-180.

- [ ] **Step 5: Run the dependent suites** (rows flow into every driver)

Run: `npx jest tests/council/run-happy.test.js tests/council/run-chair.test.js tests/council/run-chair-seam.test.js tests/council/run-stages.test.js tests/council/run-cost-bijection.test.js tests/council/verdict.test.js tests/council/report.test.js`
Expected: ALL PASS (driver pins are toMatchObject; the additive field is invisible to them). Any failure here = STOP, diagnose before proceeding.

- [ ] **Step 6: Commit**

```bash
git add src/council/run-assemble.js src/council/tally.js tests/council/run-assemble.test.js tests/council/tally.test.js
git commit -m "feat(council): thread resolvedModel through buildRunStatsEntry and the tally allowlist (GOA-7 D8)"
```

---

### Task 2: D8 debate — thread `resolvedModel` through the four debate shapers

**Files:**
- Modify: `src/council/run-debate.js:39-45` (legRow), `:92` (defense reshape), `:145` (revote push)
- Modify: `src/council/debate.js:101-115` (`mk()` passthrough)
- Test: `tests/council/debate.test.js` (direct `debateRunStatsRows` unit)
- Test: `tests/council/run-debate.test.js` (driver-level; if debate driver tests live elsewhere, grep `debateScript` under tests/ and use that file)

**Interfaces:**
- Consumes: raw fanout leg docs (`.model` = executable id, `.modelInput` = alias); normalized debate leg shapes (`{model, status, durationMs, usage, conformance, summary, waveId?}`).
- Produces: normalized debate legs and debate runStats rows may carry `resolvedModel` (emit-only-when-set). Task 7 asserts debate rows carry it end-to-end.

- [ ] **Step 1: Write the failing unit test**

In `tests/council/debate.test.js`, add beside the existing `debateRunStatsRows` tests (the three toEqual arrays at ~:93-186 stay BYTE-UNEDITED):

```js
  test('mk passes resolvedModel through when the normalized leg carries it (v4.7 GOA-7 D8)', () => {
    const rows = debateRunStatsRows({
      defenseLegs: [{ model: 'gemini', resolvedModel: 'google/gemini-3.5-pro', status: 'complete',
        durationMs: 5, usage: null, conformance: 'clean', waveId: 'r-d1' }],
      revoteLegs: [{ model: 'gpt', status: 'complete', durationMs: 5, usage: null, conformance: 'clean' }],
    });
    expect(rows[0]).toMatchObject({ role: 'rebuttal', resolvedModel: 'google/gemini-3.5-pro' });
    expect('resolvedModel' in rows[1]).toBe(false);
  });
```

- [ ] **Step 2: Write the failing driver test**

In the debate driver suite (grep `debateScriptMap` under tests/ to find it), add a test that overrides the script so legs carry a distinct executable id, then asserts the debate rows in tally-input.json carry it. Pattern (adapt runId/paths to the file's existing idiom):

```js
  test('debate rows carry resolvedModel from the raw legs (v4.7 GOA-7 D8)', async () => {
    const resolved = (m) => ({ gemini: 'google/gemini-3.5-pro', gpt: 'openai/gpt-5.2', qwen: 'qwen/qwen3-max', deepseek: 'deepseek/deepseek-v4' }[m] || m);
    const script = debateScriptMap();
    // Re-wrap every scripted wave so each leg's .model is the executable id
    // while .modelInput stays the alias (mkLeg sets both to the alias).
    for (const [k, fn] of Object.entries(script)) {
      script[k] = (opts) => {
        const r = fn(opts);
        r.wave.legs = r.wave.legs.map(l => ({ ...l, model: resolved(l.model) }));
        return r;
      };
    }
    const opts = baseOptions(tmp, { runId: 'r', runDir: path.join(tmp, 'council-r'), debate: true });
    await runCouncil(opts, { launchers: launchersFromScript(script), appendRunFn: jest.fn(),
      statsFn: () => [], installSignalAbortFn: () => () => {} });
    const input = JSON.parse(fs.readFileSync(path.join(opts.runDir, 'tally-input.json'), 'utf-8'));
    const rebuttal = input.runStats.find(r => r.role === 'rebuttal');
    const revote = input.runStats.find(r => r.role === 'revote');
    expect(rebuttal.resolvedModel).toBe('google/gemini-3.5-pro');
    expect(revote.resolvedModel).toBeDefined();
  });
```

⚠️ Adapt the runCouncil invocation/option shape to the file's existing debate tests (read them first — the debate flag/option name and deps must match what the suite already uses; the existing tests are the authority on the harness shape).

- [ ] **Step 3: Run both to verify they fail**

Run: `npx jest tests/council/debate.test.js tests/council/run-debate.test.js`
Expected: FAIL — `resolvedModel` undefined on debate rows.

- [ ] **Step 4: Implement the four shapers**

`src/council/run-debate.js` — `legRow` (leg branch only; the leg-absent stub stays byte-identical):

```js
function legRow(model, leg, conformance) {
  return leg
    ? { model, status: leg.status, durationMs: typeof leg.durationMs === 'number' ? leg.durationMs : null,
        usage: leg.usage || null, conformance, summary: leg.summary || '',
        ...(leg.waveId ? { waveId: leg.waveId } : {}),
        ...(leg.model ? { resolvedModel: leg.model } : {}) }
    : { model, status: 'error', durationMs: null, usage: null, conformance, summary: '' };
}
```

Defense reshape (line ~92, the `leg:` ternary in `runDefenseSolo`'s return — the raw `leg` here is post-swap, i.e. the FINAL leg):

```js
    leg: leg ? { model: raiser, status: leg.status, durationMs: leg.durationMs, usage: leg.usage,
      conformance, summary: leg.summary, waveId: leg.waveId,
      ...(leg.model ? { resolvedModel: leg.model } : {}) } : stub,
```

Revote push (line ~145, from `outLeg` — the post-repair final leg):

```js
    legs.push({ model: judge, status: outLeg.status, durationMs: outLeg.durationMs, usage: outLeg.usage,
      conformance, summary: outLeg.summary || '', waveId: outLeg.waveId,
      ...(outLeg.model ? { resolvedModel: outLeg.model } : {}) });
```

Also update the legRow docblock (:32-38): append one line — `Threads resolvedModel (the raw leg's .model, the executable id) emit-only-when-set — v4.7 GOA-7 D8.`

`src/council/debate.js` — `mk()`:

```js
  const mk = (role) => (l) => ({
    model: l.model, role, wasChair: false, conformance: l.conformance || 'clean',
    status: l.status || 'unknown',
    durationMs: typeof l.durationMs === 'number' ? l.durationMs : null,
    usage: l.usage || null,
    ...(l.waveId ? { waveId: l.waveId } : {}),
    ...(l.resolvedModel ? { resolvedModel: l.resolvedModel } : {}),
  });
```

- [ ] **Step 5: Run the tests to verify they pass; the three toEqual pins stay green byte-unedited**

Run: `npx jest tests/council/debate.test.js tests/council/run-debate.test.js tests/council/run-cost-bijection.test.js`
Expected: ALL PASS.

- [ ] **Step 6: Commit**

```bash
git add src/council/run-debate.js src/council/debate.js tests/council/debate.test.js tests/council/run-debate.test.js
git commit -m "feat(council): thread resolvedModel through the debate shapers (GOA-7 D8, errata E-PR2-2)"
```

---

### Task 3: D9 — ledger schema bump + `resolvedModel` on ledger rows

**Files:**
- Modify: `src/council/ledger.js:7` (constant), `:55-81` (buildLedgerRows)
- Test: `tests/council/ledger.test.js` (row-stamp tests + the :93-100 future-version rewrite)
- Test: `tests/mcp-server.test.js` (the amicus_council_tally append path writes v2 rows — grep `amicus_council_tally` for the existing test block)

**Interfaces:**
- Consumes: joined runStats rows (may carry `resolvedModel` from Tasks 1-2); `LEDGER_SCHEMA_VERSION` (exported).
- Produces: ledger rows stamped `schemaVersion: 2`, carrying `resolvedModel` (emit-only-when-set, copied from the JOINED runStats row). Task 4 groups on it.

- [ ] **Step 1: Write the failing tests**

In `tests/council/ledger.test.js` (follow the file's existing record/tmp-dir scaffolding):

```js
  test('rows are stamped with the CURRENT schema version (2 after GOA-7 D9)', () => {
    const rows = buildLedgerRows(baseRecord());
    expect(LEDGER_SCHEMA_VERSION).toBe(2);
    for (const row of rows) { expect(row.schemaVersion).toBe(2); }
  });

  test('resolvedModel is copied from the JOINED runStats row when present (D9)', () => {
    const record = baseRecord();
    record.runStats = [{ model: 'gpt', role: 'seat', wasChair: false, conformance: 'clean',
      resolvedModel: 'openai/gpt-5.2', status: 'complete', durationMs: 5, usage: null }];
    record.meta.models = ['gpt'];
    const rows = buildLedgerRows(record);
    expect(rows[0].resolvedModel).toBe('openai/gpt-5.2');
  });

  test('absent resolvedModel on the joined row ⇒ NO resolvedModel key on the ledger row (legacy-by-absence, R2)', () => {
    const record = baseRecord();  // its runStats rows carry no resolvedModel
    const rows = buildLedgerRows(record);
    for (const row of rows) { expect('resolvedModel' in row).toBe(false); }
  });

  test('a model with NO joining runStats row gets no resolvedModel (the {} join fallback)', () => {
    const record = baseRecord();
    record.runStats = [];  // nothing joins; role/conformance fall back
    const rows = buildLedgerRows(record);
    for (const row of rows) { expect('resolvedModel' in row).toBe(false); }
  });
```

Rewrite the newer-schemaVersion tolerance test (:93-100): replace its literal `schemaVersion: 2` with `schemaVersion: LEDGER_SCHEMA_VERSION + 1` (import the constant from `../../src/council/ledger` — it is exported), and update the test name to say "a FUTURE schemaVersion" so the pin stays meaningful forever.

In `tests/mcp-server.test.js`, inside the existing `amicus_council_tally` describe (grep for it; follow its config-dir redirect idiom):

```js
  test('the tally append path writes v2 rows carrying resolvedModel (GOA-7 D9 — the silent best-effort site)', async () => {
    // Invoke amicus_council_tally with a runStats row carrying resolvedModel
    // (reuse the block's existing valid-record fixture, adding
    // resolvedModel: 'openai/gpt-5.2' to one allowlist-role row), then read
    // council-ledger.jsonl from the redirected config dir and assert:
    const lines = fs.readFileSync(path.join(cfgDir, 'council-ledger.jsonl'), 'utf-8')
      .trim().split('\n').map(JSON.parse);
    const row = lines.find(r => r.model === 'gpt');
    expect(row.schemaVersion).toBe(2);
    expect(row.resolvedModel).toBe('openai/gpt-5.2');
  });
```

⚠️ The invocation scaffold comes from the neighboring tally tests in that file — reuse their handler-call + config-dir redirection verbatim; only the fixture row and the two assertions are new.

- [ ] **Step 2: Run to verify failures**

Run: `npx jest tests/council/ledger.test.js tests/mcp-server.test.js`
Expected: version-stamp test FAILS (1 ≠ 2); resolvedModel-copy tests FAIL (key absent); rewritten future-version test PASSES (3 is still newer than 1 — it is a rewrite, not a RED).

- [ ] **Step 3: Implement**

`src/council/ledger.js:7`:

```js
// v4.7 GOA-7 D9: v2 rows may carry `resolvedModel` (the executable id that
// served, copied from the joined runStats row, emit-only-when-set). Absent
// resolvedModel ⇒ legacy row, aggregated under its alias (spec R2) — this
// covers ALL pre-v2 history AND leg-less v2 rows (give-up chair, dead seats,
// claude, hand-assembled tally input), whose resolution is genuinely
// unknowable. Legacy-READ only: readers never inspect schemaVersion, rows are
// never migrated.
const LEDGER_SCHEMA_VERSION = 2;
```

In `buildLedgerRows`, add after the `conformance` line (:78):

```js
      conformance: r.conformance || 'clean',
      ...(r.resolvedModel ? { resolvedModel: r.resolvedModel } : {}),
```

- [ ] **Step 4: Run to verify green**

Run: `npx jest tests/council/ledger.test.js tests/mcp-server.test.js tests/council/cli-handlers-council.test.js`
Expected: ALL PASS (the cli round-trip suite proves the CLI tally→append→stats path tolerates v2 rows).

- [ ] **Step 5: Commit**

```bash
git add src/council/ledger.js tests/council/ledger.test.js tests/mcp-server.test.js
git commit -m "feat(council): LEDGER_SCHEMA_VERSION 2 — ledger rows carry resolvedModel, legacy-read (GOA-7 D9)"
```

---

### Task 4: D10 — two-mode aggregation in `deriveReliability`

**Files:**
- Modify: `src/council/ledger.js:101-122` (deriveReliability)
- Test: `tests/council/ledger.test.js`

**Interfaces:**
- Consumes: ledger rows (v1 alias-only + v2 with optional `resolvedModel`).
- Produces: aggregate rows `{model, runs, lowN, avgStreetCredPeersOnly, lifetimeConfirmRate, lifetimeFactErrorRate, conformance, aliases, legacy?}` where `model` = `resolvedModel || model` group key, `aliases` = unique row-level aliases most-recent-FIRST, `legacy: true` only when every row in the group lacks `resolvedModel`. Tasks 5-6 rely on `aliases` (exact name) and `legacy`.

- [ ] **Step 1: Write the failing tests**

In `tests/council/ledger.test.js` (tmp-dir + appendRun scaffolding as the grouping tests at :71-100 use). Helper rows follow the file's existing row-literal idiom:

```js
  describe('deriveReliability — resolved-id grouping (v4.7 GOA-7 D10)', () => {
    test('v2 rows group by resolvedModel; aliases[] collects row aliases most-recent-first', () => {
      // Append, in order: alias 'gpt' → openai/gpt-5.2; alias 'gpt4' → openai/gpt-5.2
      // (two aliases, one executable id, second observed later)
      appendRows([
        row({ model: 'gpt', resolvedModel: 'openai/gpt-5.2' }),
        row({ model: 'gpt4', resolvedModel: 'openai/gpt-5.2' }),
      ]);
      const agg = deriveReliability({ dir });
      expect(agg).toHaveLength(1);
      expect(agg[0].model).toBe('openai/gpt-5.2');
      expect(agg[0].runs).toBe(2);
      expect(agg[0].aliases).toEqual(['gpt4', 'gpt']);   // most recent FIRST
      expect('legacy' in agg[0]).toBe(false);
    });

    test('rows without resolvedModel stay alias-keyed and marked legacy: true (R2)', () => {
      appendRows([row({ model: 'gemini' }), row({ model: 'gemini' })]);
      const agg = deriveReliability({ dir });
      expect(agg[0]).toMatchObject({ model: 'gemini', legacy: true, aliases: ['gemini'] });
    });

    test('history splits at the bump: legacy alias group + resolved group coexist for one lineage', () => {
      appendRows([
        row({ model: 'gpt' }),                                    // pre-v2 history
        row({ model: 'gpt', resolvedModel: 'openai/gpt-5.2' }),   // post-v2
      ]);
      const agg = deriveReliability({ dir });
      const keys = agg.map(a => a.model).sort();
      expect(keys).toEqual(['gpt', 'openai/gpt-5.2']);
      expect(agg.find(a => a.model === 'gpt').legacy).toBe(true);
      expect('legacy' in agg.find(a => a.model === 'openai/gpt-5.2')).toBe(false);
    });

    test('a mixed group merges honestly when a legacy full-id row equals a v2 key — no legacy mark', () => {
      appendRows([
        row({ model: 'openai/gpt-5.2' }),                                   // old row launched by full id
        row({ model: 'gpt', resolvedModel: 'openai/gpt-5.2' }),
      ]);
      const agg = deriveReliability({ dir });
      expect(agg).toHaveLength(1);
      expect('legacy' in agg[0]).toBe(false);
      expect(agg[0].aliases).toEqual(['gpt', 'openai/gpt-5.2']);
    });

    test('the claude group is legacy-keyed forever (spec §3.4) — leg-less rows never resolve', () => {
      appendRows([row({ model: 'claude', role: 'claude' })]);
      const agg = deriveReliability({ dir });
      expect(agg[0]).toMatchObject({ model: 'claude', legacy: true });
    });
  });
```

Where `appendRows`/`row` are small local helpers writing JSONL lines into the test's tmp config dir with the file's standard base-row fields (copy the base-row shape from the :71-81 round-trip test; `row(overrides)` spreads overrides over it, deleting `resolvedModel` when the override omits it).

- [ ] **Step 2: Run to verify failures**

Run: `npx jest tests/council/ledger.test.js`
Expected: new describe FAILS (grouping is alias-only, no aliases/legacy fields); the existing grouping tests at :71-100 still PASS (their rows lack resolvedModel — grouping falls back to model).

- [ ] **Step 3: Implement**

Replace `deriveReliability` (`src/council/ledger.js:101-122`) with:

```js
/**
 * Aggregate the ledger per model. peersOnly nulls excluded; lowN flags < 3 runs.
 * v4.7 GOA-7 D10: groups by `row.resolvedModel || row.model` — v2 rows segment
 * by the executable id that actually served; rows without a resolvedModel
 * (pre-v2 history, leg-less rows, hand-assembled tally input) stay alias-keyed
 * with `legacy: true`. `aliases` lists every row-level `model` (alias) observed
 * for the group, most recently observed FIRST — ledger append order is the only
 * recency signal (`date` is day-granular, free-form on the MCP path), so
 * aliases[0] is the launch-preferred name (pickFallbackChair, D11).
 * Version-blind by design: schemaVersion is never read (legacy-read, R2).
 */
function deriveReliability(opts = {}) {
  const dir = opts.dir || getConfigDir();
  const byKey = new Map();
  for (const row of readRows(dir)) {
    const key = row.resolvedModel || row.model;
    if (!byKey.has(key)) { byKey.set(key, []); }
    byKey.get(key).push(row);
  }
  return [...byKey.entries()].map(([model, rows]) => {
    const peers = rows.map(r => r.streetCredPeersOnly).filter(v => typeof v === 'number');
    const confirms = rows.map(r => r.confirmRate).filter(v => typeof v === 'number');
    const facts = rows.map(r => r.factErrorRate).filter(v => typeof v === 'number');
    const conformance = rows.reduce((acc, r) => { acc[r.conformance] = (acc[r.conformance] || 0) + 1; return acc; }, {});
    const lastSeen = new Map();
    rows.forEach((r, i) => { lastSeen.set(r.model, i); });
    const aliases = [...lastSeen.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m);
    return {
      model, runs: rows.length, lowN: rows.length < 3,
      avgStreetCredPeersOnly: avg(peers),
      lifetimeConfirmRate: avg(confirms),
      lifetimeFactErrorRate: avg(facts),
      conformance,
      aliases,
      ...(rows.every(r => !r.resolvedModel) ? { legacy: true } : {}),
    };
  });
}
```

- [ ] **Step 4: Run to verify green**

Run: `npx jest tests/council/ledger.test.js tests/council/cli-handlers-council.test.js tests/mcp-server.test.js`
Expected: ALL PASS (aggregate additions are per-row; the buildStatsDoc envelope toEqual at :102-107 passes rows by reference).

- [ ] **Step 5: Commit**

```bash
git add src/council/ledger.js tests/council/ledger.test.js
git commit -m "feat(council): deriveReliability groups by resolved id with aliases[] + legacy marks (GOA-7 D10)"
```

---

### Task 5: D11 — `pickFallbackChair` survives the re-key

**Files:**
- Modify: `src/council/run-chair.js:25-44` (docblock + picker)
- Test: `tests/council/run-chair.test.js`
- Test: `tests/council/run-claude-review.test.js` (claude-guard extension)

**Interfaces:**
- Consumes: D10 aggregates (`{model, aliases?, avgStreetCredPeersOnly, ...}`).
- Produces: same signature `pickFallbackChair(statsRows, bench, failedChair) → string|null`; the returned string is `aliases[0]` when aliases exist, else `model`. run.js:236-238 and run-server.js:128 call sites are UNTOUCHED (pure-function change keeps the two in lockstep automatically).

- [ ] **Step 1: Write the failing tests**

In `tests/council/run-chair.test.js`, beside the existing picker unit tests (:19-34):

```js
  describe('pickFallbackChair under resolved-id keys (v4.7 GOA-7 D11)', () => {
    const agg = (model, cred, aliases) => ({ model, avgStreetCredPeersOnly: cred,
      ...(aliases ? { aliases } : {}) });

    test('a bench seat is excluded even when its group is keyed by executable id', () => {
      const rows = [agg('google/gemini-3.5-pro', 1.0, ['gemini']), agg('grok', 2.0, ['grok'])];
      // 'gemini' is on the bench — its resolved-keyed group must NOT be promoted.
      expect(pickFallbackChair(rows, ['gemini', 'gpt'], 'deepseek')).toBe('grok');
    });

    test('the just-failed chair is excluded via aliases[] too', () => {
      const rows = [agg('deepseek/deepseek-v4', 1.0, ['deepseek']), agg('grok', 2.0, ['grok'])];
      expect(pickFallbackChair(rows, ['gemini'], 'deepseek')).toBe('grok');
    });

    test('the promoted name is the most-recent ALIAS (aliases[0]), never the raw key', () => {
      const rows = [agg('openai/gpt-5.2', 1.0, ['gpt4', 'gpt'])];
      expect(pickFallbackChair(rows, ['gemini'], 'deepseek')).toBe('gpt4');
    });

    test('rows without aliases (pre-D10 shape) fall back to the key — old fixtures stay valid', () => {
      const rows = [agg('grok', 1.5)];
      expect(pickFallbackChair(rows, ['gemini'], 'deepseek')).toBe('grok');
    });

    test("a group with 'claude' anywhere in its name set is never promoted (paranoia pin)", () => {
      const rows = [agg('some/exec-id', 0.5, ['claude']), agg('grok', 2.0, ['grok'])];
      expect(pickFallbackChair(rows, ['gemini'], 'deepseek')).toBe('grok');
    });
  });
```

In `tests/council/run-claude-review.test.js`, beside the existing claude-guard tests (:76-91):

```js
  test('a resolvedModel-bearing rowset still never yields claude (v4.7 D11 guard pin)', () => {
    const rows = [
      { model: 'claude', aliases: ['claude'], avgStreetCredPeersOnly: 0.5 },
      { model: 'x/exec', aliases: ['x'], avgStreetCredPeersOnly: 3.0 },
    ];
    expect(pickFallbackChair(rows, [], null)).toBe('x');
  });
```

(Import `pickFallbackChair` exactly as that file already does — it is re-exported from `../../src/council/run`.)

- [ ] **Step 2: Run to verify failures**

Run: `npx jest tests/council/run-chair.test.js tests/council/run-claude-review.test.js`
Expected: bench-via-aliases, failed-chair-via-aliases, most-recent-alias, and paranoia tests FAIL against the current key-only picker; the no-aliases fallback test PASSES (regression pin); ALL existing picker tests still PASS.

- [ ] **Step 3: Implement**

Replace `pickFallbackChair` (`src/council/run-chair.js:37-44`) with:

```js
function pickFallbackChair(statsRows, bench, failedChair) {
  const benchSet = new Set(bench);
  // v4.7 GOA-7 D11: an aggregate's identity is its key PLUS every alias it was
  // observed under — post-D10 keys may be executable ids while bench/o.chair
  // stay alias-space, so every exclusion tests the whole name set (a bench
  // seat's resolved-keyed group must never be promoted as its own chair).
  // The LAUNCHED name is aliases[0] (most-recent alias): alias-space names
  // re-enter the router's alias bridge and current key/gateway policy; a raw
  // executable id would dodge them (divergent-vendor forms, openrouter-
  // literals under --gateway direct, dropped aliases). aliases[] is non-empty
  // for every ledger-derived group; the bare-model fallback covers pre-D10
  // aggregate shapes only.
  const names = (r) => [r.model, ...(Array.isArray(r.aliases) ? r.aliases : [])];
  const excluded = (r) => names(r).some(n => n === 'claude' || benchSet.has(n) || n === failedChair);
  const candidates = (statsRows || [])
    .filter(r => !excluded(r) && typeof r.avgStreetCredPeersOnly === 'number')
    .sort((a, b) => a.avgStreetCredPeersOnly - b.avgStreetCredPeersOnly);
  if (!candidates.length) { return null; }
  const top = candidates[0];
  return (Array.isArray(top.aliases) && top.aliases.length) ? top.aliases[0] : top.model;
}
```

Keep the existing docblock (:25-36) and append one paragraph: `v4.7 GOA-7 D11: exclusions test the group key AND aliases[]; the promoted name is aliases[0] (most-recent alias) so the launch string stays routable through the same alias policy both call sites (run.js mid-walk, run-server.js pre-seed) already resolve.`

- [ ] **Step 4: Run the tests + the seam's dependent suites**

Run: `npx jest tests/council/run-chair.test.js tests/council/run-claude-review.test.js tests/council/run-chair-seam.test.js tests/council/run-single-server.test.js`
Expected: ALL PASS — especially run-single-server.test.js:194-199 (the 'ledgerpick' promoted-chair seeding pin: no-aliases row falls back to the routable key) and run-chair.test.js:78-103 (e2e promotion still launches 'grok').

- [ ] **Step 5: Commit**

```bash
git add src/council/run-chair.js tests/council/run-chair.test.js tests/council/run-claude-review.test.js
git commit -m "feat(council): aliases[]-aware chair fallback — exclusion by full name set, launch by most-recent alias (GOA-7 D11)"
```

---

### Task 6: D10 surfaces — stats render, schema, MCP passthrough

**Files:**
- Modify: `src/cli-handlers-council.js:61-67` (renderStats)
- Modify: `schemas/council-stats.schema.json:16-24` (additive row properties)
- Test: `tests/council/cli-handlers-council.test.js` (renderStats pins — green-field)
- Test: `tests/schemas.test.js:179-186` (fixture extension)
- Test: `tests/mcp-server.test.js:2262-2279` (mock-row extension)

**Interfaces:**
- Consumes: D10 aggregates with `aliases`/`legacy`.
- Produces: human stats table with dynamic model-column width + `legacy` marker; schema documents `aliases`/`legacy`. No envelope changes.

- [ ] **Step 1: Write the failing tests**

In `tests/council/cli-handlers-council.test.js` (renderStats has NO existing tests — new describe; capture stdout the way the file's other CLI tests do, or export-test renderStats if the file already requires it — read the file's idiom first; if renderStats is not exported, drive it through the stats command with a redirected config dir as the :33-43 round-trip test does):

```js
  describe('renderStats (v4.7 GOA-7 D10 surfaces)', () => {
    test('legacy groups carry a legacy marker in the notes column', () => {
      const out = renderStats([{ model: 'gemini', runs: 5, lowN: false,
        avgStreetCredPeersOnly: 1.5, lifetimeConfirmRate: 0.5, lifetimeFactErrorRate: 0.1,
        conformance: { clean: 5 }, aliases: ['gemini'], legacy: true }]);
      expect(out).toContain('legacy');
    });

    test('a resolved-id key longer than 16 chars widens the model column instead of shifting it', () => {
      const rows = [{ model: 'openrouter/qwen/qwen3-max', runs: 1, lowN: true,
        avgStreetCredPeersOnly: 2.0, lifetimeConfirmRate: null, lifetimeFactErrorRate: null,
        conformance: { clean: 1 }, aliases: ['qwen'] }];
      const out = renderStats(rows);
      const [header, row] = out.split('\n');
      expect(header.indexOf('runs')).toBeGreaterThan('openrouter/qwen/qwen3-max'.length);
      expect(row.startsWith('openrouter/qwen/qwen3-max ')).toBe(true);
    });

    test('non-legacy rows render no legacy marker', () => {
      const out = renderStats([{ model: 'openai/gpt-5.2', runs: 4, lowN: false,
        avgStreetCredPeersOnly: 1.2, lifetimeConfirmRate: 0.6, lifetimeFactErrorRate: 0.0,
        conformance: { clean: 4 }, aliases: ['gpt'] }]);
      expect(out).not.toContain('legacy');
    });
  });
```

In `tests/schemas.test.js` (:179-186), extend the buildStatsDoc-vs-schema fixture rows with `aliases: ['gpt']` on one row and `legacy: true` on another, so the schema exercise covers the new properties.

In `tests/mcp-server.test.js` (:2262-2279), extend the mocked deriveReliability row with `aliases: ['deepseek'], legacy: true` and assert both survive into the fenced doc (`doc.models[0].aliases` / `.legacy` after the block's existing unfence + parse).

- [ ] **Step 2: Run to verify failures**

Run: `npx jest tests/council/cli-handlers-council.test.js tests/schemas.test.js tests/mcp-server.test.js`
Expected: the legacy-marker and column-width tests FAIL; schema + MCP extensions PASS already (additive passthrough — they are documentation-pins, not REDs; that is expected and fine).

- [ ] **Step 3: Implement**

`src/cli-handlers-council.js` — replace `renderStats` (:61-67):

```js
function renderStats(agg) {
  if (!agg.length) { return 'No council runs recorded yet.\n'; }
  // v4.7 GOA-7 D10: group keys may be executable ids (>16 chars) — size the
  // model column to the longest key; legacy (alias-keyed) groups get a notes
  // marker beside low-N.
  const w = Math.max(16, ...agg.map(a => String(a.model).length));
  return 'model'.padEnd(w) + ' runs  avg-cred  confirm  fact-err  notes\n' +
    agg.map(a => `${String(a.model).padEnd(w)} ${String(a.runs).padStart(4)}  ` +
      `${fmt(a.avgStreetCredPeersOnly)}     ${fmt(a.lifetimeConfirmRate)}    ${fmt(a.lifetimeFactErrorRate)}` +
      `${a.lowN ? '   low-N' : ''}${a.legacy ? '   legacy' : ''}`).join('\n') + '\n';
}
```

`schemas/council-stats.schema.json` — add two properties to the row `properties` object (after `conformance`):

```json
          "conformance": { "type": "object" },
          "aliases": {
            "type": "array", "items": { "type": "string" },
            "description": "Every alias observed for this group, most recently observed first — aliases[0] is the launch-preferred name (v4.7 GOA-7)."
          },
          "legacy": {
            "type": "boolean",
            "description": "True when every row in the group lacks resolvedModel — alias-keyed history from before resolved-id segmentation, or leg-less rows whose resolution is unknowable (v4.7 GOA-7, spec R2)."
          }
```

- [ ] **Step 4: Run to verify green**

Run: `npx jest tests/council/cli-handlers-council.test.js tests/schemas.test.js tests/mcp-server.test.js tests/mcp-tools.test.js`
Expected: ALL PASS, including the 19-filename pin (no file added) and the envelope toEqual.

- [ ] **Step 5: Commit**

```bash
git add src/cli-handlers-council.js schemas/council-stats.schema.json tests/council/cli-handlers-council.test.js tests/schemas.test.js tests/mcp-server.test.js
git commit -m "feat(council): stats surfaces render legacy marks + dynamic key column; schema documents aliases/legacy (GOA-7 D10)"
```

---

### Task 7: The threading invariant — end-to-end driver suite

**Files:**
- Create: `tests/council/resolved-model-threading.test.js`

**Interfaces:**
- Consumes: everything Tasks 1-5 produced; `scriptedLaunchers`/`happyScript`/`baseOptions`/`mkLeg` from `tests/council/helpers/fake-launchers.js`.
- Produces: the D8/D9 end-to-end pin suite later PRs must keep green.

- [ ] **Step 1: Write the suite** (it should pass immediately if Tasks 1-5 are correct — each scenario was RED-proven at its own task; this suite pins the COMPOSITION)

```js
// tests/council/resolved-model-threading.test.js — v4.7 GOA-7 (PR2): the
// resolved-id thread, leg → runStats row → tally.json/verdict.json → ledger
// row → deriveReliability group. mkLeg sets model === modelInput (both the
// alias), so every scripted leg here overrides .model to a distinct
// executable id — proving the field carries what SERVED, not the alias.
// Substitution attribution rides the same shape: a fallback-substituted leg's
// doc arrives with .model = the substitute's id (fanout-leg-fallback.js:232),
// indistinguishable from these fixtures by design.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { runCouncil } = require('../../src/council/run');
const { deriveReliability, buildLedgerRows } = require('../../src/council/ledger');
const { scriptedLaunchers, happyScript, baseOptions } = require('./helpers/fake-launchers');

const RESOLVED = { gemini: 'google/gemini-3.5-pro', gpt: 'openai/gpt-5.2',
  qwen: 'qwen/qwen3-max', deepseek: 'deepseek/deepseek-v4' };

/** happyScript with every leg's .model rewritten to its executable id. */
function resolvedScript() {
  const script = happyScript();
  for (const [k, fn] of Object.entries(script)) {
    script[k] = (opts) => {
      const r = fn(opts);
      r.wave.legs = r.wave.legs.map(l => ({ ...l, model: RESOLVED[l.model] || l.model }));
      return r;
    };
  }
  return script;
}

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'council-rm-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('resolvedModel threading (GOA-7 D8/D9 end-to-end)', () => {
  let runDir; let ledgerRows;

  beforeEach(async () => {
    const opts = baseOptions(tmp);
    runDir = opts.runDir;
    const appendRunFn = jest.fn(record => { ledgerRows = buildLedgerRows(record); });
    const res = await runCouncil(opts, {
      launchers: scriptedLaunchers(resolvedScript()),
      appendRunFn, statsFn: () => [], installSignalAbortFn: () => () => {},
    });
    expect(res.exitCode).toBe(0);
  });

  test('every leg-bearing runStats row carries resolvedModel = the executable id; model stays the alias', () => {
    const input = JSON.parse(fs.readFileSync(path.join(runDir, 'tally-input.json'), 'utf-8'));
    for (const row of input.runStats) {
      expect(row.resolvedModel).toBe(RESOLVED[row.model]);   // every happy-path row has a leg
      expect(RESOLVED[row.model]).toBeDefined();             // model is still the alias
    }
  });

  test('tally.json and verdict.json carry the field through the allowlist', () => {
    for (const f of ['tally.json', 'verdict.json']) {
      const doc = JSON.parse(fs.readFileSync(path.join(runDir, f), 'utf-8'));
      const seat = doc.runStats.find(r => r.model === 'gemini' && r.role !== 'judge');
      expect(seat.resolvedModel).toBe('google/gemini-3.5-pro');
    }
  });

  test('ledger rows are v2 and carry resolvedModel from the joined primary row', () => {
    expect(ledgerRows).toHaveLength(3);
    for (const row of ledgerRows) {
      expect(row.schemaVersion).toBe(2);
      expect(row.resolvedModel).toBe(RESOLVED[row.model]);
    }
  });

  test('deriveReliability groups those rows by executable id with the alias in aliases[]', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-rm-cfg-'));
    try {
      const file = path.join(dir, 'council-ledger.jsonl');
      fs.writeFileSync(file, ledgerRows.map(r => JSON.stringify(r)).join('\n') + '\n');
      const agg = deriveReliability({ dir });
      const g = agg.find(a => a.model === 'google/gemini-3.5-pro');
      expect(g).toBeDefined();
      expect(g.aliases).toEqual(['gemini']);
      expect('legacy' in g).toBe(false);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('leg-less rows stay resolvedModel-free (the R2/E-PR2-7 absence class)', () => {
  test('the give-up chair error row and untouched fixtures carry no resolvedModel', async () => {
    // Chair walk dies: ch1/ch2 return dead legs, no ledger rows to promote a ch3.
    const script = happyScript();
    const dead = () => ({ wave: { status: 'error', legs: [{ taskId: 'x', model: null,
      modelInput: 'deepseek', status: 'error', summary: '', durationMs: null, usage: null }] }, exitCode: 1 });
    script['abc123-ch1'] = dead; script['abc123-ch2'] = dead;
    const opts = baseOptions(tmp);
    await runCouncil(opts, { launchers: scriptedLaunchers(script), appendRunFn: jest.fn(),
      statsFn: () => [], installSignalAbortFn: () => () => {} });
    const input = JSON.parse(fs.readFileSync(path.join(opts.runDir, 'tally-input.json'), 'utf-8'));
    const giveUp = input.runStats.find(r => r.role === 'chair' && r.status === 'error');
    expect(giveUp).toBeDefined();
    expect('resolvedModel' in giveUp).toBe(false);
  });
});
```

⚠️ The give-up scenario's dead-chair script shape must match how existing chair-walk tests fake dead attempts — read `tests/council/run-chair.test.js:105-116` (give-up → exit 2) first and mirror its script exactly (waveIds `-ch1`/`-ch2`, statsFn empty so no ch3). Adjust the dead-leg literal to that file's idiom; the ASSERTIONS are the contract.

- [ ] **Step 2: Run the suite**

Run: `npx jest tests/council/resolved-model-threading.test.js`
Expected: ALL PASS. If a threading test fails, a Task 1-5 edit is wrong — STOP and report which link of the chain dropped the field (do not patch the test to match).

- [ ] **Step 3: Prove the pin bites (mutation check, no commit)**

Temporarily comment out the tally allowlist line added in Task 1 (`...(r.resolvedModel ? ...)` in tally.js), run the suite, confirm the tally.json/ledger tests FAIL, then restore the line and re-run to green. This proves the suite guards the exact silent-strip failure mode E-PR2-1 names.

- [ ] **Step 4: Run the full council test directory**

Run: `npx jest tests/council`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/council/resolved-model-threading.test.js
git commit -m "test(council): end-to-end resolvedModel threading invariant suite (GOA-7 D8/D9)"
```

---

### Task 8: D12 — docs + CHANGELOG

**Files:**
- Modify: `docs/schemas.md:52`
- Modify: `docs/council.md:555`, `:574-586`, `:763-772`
- Modify: `skills/second-opinion/MANUAL-ORCHESTRATION.md:149-155`
- Modify: `docs/configuration.md:241` (errata E-PR2-4)
- Modify: `CHANGELOG.md` `[Unreleased]`

All edits are against the SHIPPED code of Tasks 1-7 — verify each claim against the committed source, not this plan's prose, before writing it (the v4.6.3-arc docs-drift lesson).

- [ ] **Step 1: docs/schemas.md:52** — replace the single bullet claiming both JSONL ledgers "each stays at its own v1 row format" with (keep surrounding structure):

```markdown
- The two JSONL ledgers are internal append-only storage, not emitted/published docs.
  `spend-ledger.jsonl` stays at its own v1 row format (`SPEND_LEDGER_SCHEMA_VERSION` is 1,
  unrelated to the envelope versions above). `council-ledger.jsonl` is at
  `LEDGER_SCHEMA_VERSION` **2** (v4.7 GOA-7): v2 rows may carry `resolvedModel` — the
  executable id that actually served. **Legacy-read, no migration:** readers never inspect
  a row's schemaVersion; a row without `resolvedModel` (all pre-v2 history, plus leg-less
  rows whose resolution is unknowable) simply aggregates under its alias, marked
  `legacy` in `council stats` output. spend.schema.json (below) is still the published doc
  built from spend-ledger.jsonl rows — neither ledger's row shape itself is published.
```

- [ ] **Step 2: docs/council.md** —
  - `:555` row shape: add `resolvedModel?` to the field list with the sentence: `resolvedModel? (v4.7) — the executable id that actually served the row's leg, emit-only-when-set; leg-less rows (the give-up chair row, dead seats with no leg, the claude row) never carry it. model stays the council alias.`
  - `:574-579` (waveId emit-only paragraph): append: `resolvedModel follows the same emit-only-when-set discipline and the same never-invent rule — it is never derived from the alias.`
  - `:581-586` (ledger-join consequence): append: `Since v4.7 the ledger row copies the joined row's resolvedModel and council stats groups by resolvedModel || model — see the stats section below.`
  - `:763-772` (stats section): update the keying sentence at :763 to: `Output: one row per RESOLVED model (v4.7 — rows that carry resolvedModel group by the executable id that served; rows without one group by alias and are marked legacy). Each row also lists aliases[] — every alias observed for the group, most recent first; the chair fallback promotion launches aliases[0].` Add `aliases` and `legacy` rows to the field table.
- [ ] **Step 3: skills/second-opinion/MANUAL-ORCHESTRATION.md:149-155** — extend the "v4.7 CA-4 note" with: `Hand-assembled runStats rows carry no resolvedModel; their ledger rows therefore aggregate as alias-keyed legacy groups in council stats — expected and by design (R2 legacy-by-absence), not an error. Add resolvedModel (the executable id that served) to a row only if you know it; never copy the alias into it.`
- [ ] **Step 4: docs/configuration.md:241** — read the current council-ledger.jsonl row description and update it to name v2 + optional `resolvedModel` + legacy-read (same facts as Step 1, one sentence).
- [ ] **Step 5: CHANGELOG.md `[Unreleased]`** — append to the existing Added/Changed sections (PR1 content already there):

```markdown
### Added
- `runStats[].resolvedModel` — every row built from a served leg now records the executable
  id that actually served (post-fallback-substitution), emit-only-when-set; carried through
  tally.json/verdict.json and onto council-ledger rows (GOA-7 prerequisite).
- `council stats` rows gain `aliases[]` (every alias observed for a group, most recent
  first) and a `legacy` mark on alias-keyed groups; the human table marks `legacy` in the
  notes column and sizes the model column to the longest key.

### Changed
- `LEDGER_SCHEMA_VERSION` 1 → 2. Legacy-read, no migration: rows without `resolvedModel`
  (all pre-v4.7 history and leg-less rows) aggregate under their alias, marked `legacy`.
- `council stats` groups reliability by resolved model id (`resolvedModel || model`) —
  history splits honestly at the bump; a retargeted alias's new rows start `low-N`.
- Chair fallback promotion (`pickFallbackChair`) excludes candidates by their FULL name set
  (group key + `aliases[]`) and launches the group's most-recent alias — a bench seat's
  resolved-keyed group can no longer be promoted as its own chair.
```

(Adjust bullets to match what actually shipped; fold into existing section headers rather than duplicating them.)

- [ ] **Step 6: Verify + commit**

Run: `npx jest tests/docs-links.test.js tests/schemas.test.js` (and any docs-driven suite that greps council.md — grep `council.md` under tests/ and run what hits).
Expected: PASS.

```bash
git add docs/schemas.md docs/council.md docs/configuration.md skills/second-opinion/MANUAL-ORCHESTRATION.md CHANGELOG.md
git commit -m "docs: resolved-id ledger v2, legacy-read, aliases[]/legacy stats marks (GOA-7 D12)"
```

---

### Task 9: Full gates + push + PR

- [ ] **Step 1:** `npm test` (full suite) — expect ~496 suites green, 0 fail. Then `npm run lint`, `npm run check:sizes`, `node scripts/generate-docs.js --check` if it exists (else skip — pre-commit self-heals markers).
- [ ] **Step 2:** Verify zero edits landed in `src/council/run.js` and `src/council/run-stages.js`: `git diff origin/main --stat -- src/council/run.js src/council/run-stages.js` → empty.
- [ ] **Step 3:** Push with the full-suite pre-push hook (≥5-minute timeout): `git push -u origin feat/v4.7-pr2-goa7-resolved-ledger`.
- [ ] **Step 4:** Open the PR with `gh -R BourbonDog/amicus pr create` — title `v4.7 PR2 — GOA-7 prerequisite: resolved-id ledger, legacy-read (D8–D12)`; body: spec §6 reference, the errata block (E-PR2-1..7, owner veto open), the D11 design consequence (launch = most-recent alias), test evidence (suite counts, mutation check), and riders if any. End the body with the house attribution line.
- [ ] **Step 5:** Verify CI checks launch (the webhook-drop lesson: `gh -R BourbonDog/amicus api repos/BourbonDog/amicus/commits/<head-sha>/check-suites` if nothing appears; remedy = close/reopen the PR).

---

## Self-review notes (spec coverage)

- D8 → Tasks 1-2 (+ E-PR2-1/2 multi-site correction). D9 → Task 3. D10 → Tasks 4, 6. D11 → Task 5. D12 → Task 8 (+ E-PR2-4). §9 testing → every task's RED steps + Task 7's composition suite + the Task 7 mutation check.
- Not in scope (spec non-goals): recency decay, seat-id fields, chairAttempts[].usage, F8/tags, the 62-nit sweep.
- Type consistency: field name `resolvedModel` everywhere; aggregate fields `aliases` (array, most-recent-first) and `legacy` (emit-only-when-true); picker return = `aliases[0] || model`.
