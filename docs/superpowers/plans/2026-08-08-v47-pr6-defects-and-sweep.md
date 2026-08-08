# v4.7 PR6 — four live defects + the ruling-free sweep subset

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four live defects the PR6 recon found by execution (a pack-null crash, an ungated
MCP cost gate, a prototype-key throw that kills the seats panel, and a family of valueless-flag
crashes including a CLI containment escape), and close the ruling-free half of sweep theme (c).

**Architecture:** Ten independent tasks. Tasks 1–6 are behavior fixes, each RED-proven. Tasks 7–10
are the sweep: one extraction, and standing notes that convert BACKLOG checkboxes into tripwires
at their code sites (spec D18/R4). GUI-file edits are deliberately concentrated in **one** task so
the three tight `electron/workspace-ui/*.js` files are measured against the 300-line gate once.

**Tech Stack:** CommonJS, Node 22, jest. No new dependencies.

## Global Constraints

- **File-size gate is HARD at 300 lines.** `scripts/check-file-sizes.js` counts
  `content.split('\n').length`, then subtracts 1 when the content ends with a newline. Gated globs
  are `src/**/*.js` and `electron/**/*.js` ONLY — `tests/**` and `bin/**` are ungated.
  Grandfather-exempt: `src/cli.js`, `src/mcp-server.js`, `src/mcp-tools.js`, `src/headless.js`,
  `src/opencode-client.js`, `src/session-manager.js`, `src/utils/config.js`.
- **Measured budgets at `9ea05bf`** (gate arithmetic, not raw): `pack-resolve.js` **300/300 — FULL,
  must not take a line**; `workspace-panels.js` 294; `workspace-render.js` 293; `live-model.js` 284;
  `workspace-app.js` 278; `cli-handlers-pack.js` 252; `cli-handlers-council-run.js` 251;
  `bin/amicus.js` 246 (ungated); `cli-handlers-fanout.js` 185; `cli-handlers-run.js` 165;
  `pack-store.js` 130; `pack-forward.js` 96; `known-flags.js` 91; `session-index-tmp-sweep.js` 84;
  `budget.js` 83; `cli-council-run-bench.js` 81; `error-doc.js` 67; `mcp-council-bench.js` 45.
  **Re-measure any file you edit before committing.**
- **TDD is mandatory.** Every behavior change is RED-proven first. Where a change is comment-only,
  the plan says so explicitly and no test is manufactured — do not invent a tautological pin.
- **Never run bare `npm install`** (use `--ignore-scripts`). Test branches with `node bin/amicus.js`,
  never PATH `amicus`.
- **Error-message voice** follows the v4.5.3 strict-CLI precedent, verbatim shape from
  `src/cli-handlers-council.js:183`: `` `-o/--out cannot start with '-': got '${args.out}'` ``.
- **Standing-note format** follows the PR5 droppedMembers precedent: move the note to its code
  site, then tick the BACKLOG line with `— standing note v4.7 PR6: <where it now lives>`.
- `npm test` before any push. The pre-push hook reruns the full suite — allow `git push` ≥5 min.

---

## File Structure

| File | Change | Task |
|---|---|---|
| `src/pack/pack-store.js` | reject non-object pack bodies in `readPack`; truthful `@returns` docblock | 1 |
| `src/mcp-server.js` | hoist the budget gate out of the pack-only `if`; pass a surface descriptor | 2, 3 |
| `src/sidecar/budget.js` | `formatBudgetError(result, surface)` — branch-specific remedies | 3 |
| `bin/amicus.js` | one `--cwd` choke-point guard covering all 16 consumer sites | 4 |
| `src/cli-handlers-council-run.js` | valueless/dash guards for `--out-dir`, `--claude-review`, `--run-id`, `--timeout`; containment fence | 5 |
| `electron/workspace-ui/live-model.js` | `Object.create(null)` ×3; `#108b` note; `#108c` citation fix | 6 |
| `electron/workspace-ui/workspace-render.js` | `Object.create(null)` ×2; T20-m2 standing note | 6 |
| `electron/workspace-ui/workspace-app.js` | `Object.create(null)` ×1 (`labelByModel`) | 6 |
| **`src/cli-template-args.js`** (new) | shared `applyTemplateForArgs` — collapses the triplication | 7 |
| `src/cli-handlers-run.js`, `-fanout.js`, `-council-run.js` | call the shared helper | 7 |
| `src/utils/session-metadata-tmp-sweep.js`, `session-index-tmp-sweep.js` | paired standing notes | 8, 9 |
| `src/cli-council-run-bench.js`, `src/mcp-council-bench.js` | mirrored parallel-evolution notes | 8 |
| `.github/workflows/publish.yml` | `#110a` pre-check comment | 8 |
| `tests/helpers/doctor-base-deps.js` | `#110b` third-omission contract line | 9 |
| `BACKLOG.md`, `CHANGELOG.md` | dispositions, duplicate collapse, behavior-change entries | 10 |

---

## Task 1: Reject non-object pack bodies (`readPack`)

**Files:**
- Modify: `src/pack/pack-store.js:55` (docblock), `:69-71` (the guard)
- Test: `tests/pack/pack-store.test.js`, `tests/pack/cli-pack-cmd.test.js`

**Interfaces:**
- Produces: `readPack(ref)` now returns `{error}` for any pack body that is not a plain object.
  Callers `pack-resolve.js:76` and `cli-handlers-pack.js:225` map it to `PACK_NOT_FOUND` unchanged —
  **do not touch either caller.**

**Why:** `pack-store.js:69`'s guard is `r.kind === 'name' && pack && pack.name !== r.name`. The
`pack &&` short-circuits on `null`, so a pack file containing `null` returns as a **success** with
`pack: null`. Reproduced: `council run --pack nullpack` → uncaught
`TypeError: Cannot read properties of null (reading 'kind')` at `pack-resolve.js:80`;
`pack show nullpack` → uncaught `TypeError` at `cli-handlers-pack.js:171`; `pack show --json` →
**exit 0** with `"pack": null`. Path-form refs with any non-object JSON (`[]`, `5`, `"x"`) reach
`PACK_KIND_MISMATCH` reading `pack 'undefined' is kind 'undefined'`.

`pack-resolve.js` is at **300/300** and cannot take a line — which is also why the guard belongs
here, at the single producer, rather than in each consumer.

- [ ] **Step 1: Write the failing tests**

Append to `tests/pack/pack-store.test.js`:

```js
describe('readPack rejects non-object bodies (v4.7 PR6)', () => {
  // A pack file whose JSON body is valid but not an object used to return as a
  // SUCCESS with `pack: null` — `pack &&` in the name-match guard short-circuited —
  // and crashed both callers on `pack.kind` / `pack.name`.
  const cases = [
    ['null', 'null'],
    ['an array', '[]'],
    ['a number', '5'],
    ['a string', '"x"'],
    ['a boolean', 'true'],
  ];
  for (const [label, body] of cases) {
    it(`returns {error} when the body is ${label}`, () => {
      const file = path.join(tmpPacksDir, 'bad.json');
      fs.writeFileSync(file, body);
      const r = readPack(file);
      expect(r.error).toMatch(/is not a pack object/);
      expect(r.pack).toBeUndefined();
    });
  }

  it('still accepts a well-formed object pack', () => {
    const file = path.join(tmpPacksDir, 'good.json');
    fs.writeFileSync(file, JSON.stringify({ name: 'good', kind: 'council', version: '1.0.0' }));
    expect(readPack(file).pack).toEqual({ name: 'good', kind: 'council', version: '1.0.0' });
  });
});
```

Use the file's existing tmp-dir/`readPack` import idiom — read the top of
`tests/pack/pack-store.test.js` and match it; do not introduce a second harness.

- [ ] **Step 2: Run to verify RED**

```bash
npx jest tests/pack/pack-store.test.js -t "non-object bodies"
```

Expected: 5 failures. `null`/`[]`/`5`/`"x"`/`true` all currently return `{pack: <value>}` with no
`error` key, so `expect(r.error).toMatch(...)` fails on `undefined`.

- [ ] **Step 3: Implement the guard**

In `src/pack/pack-store.js`, immediately after the `JSON.parse` catch (currently `:68`) and
**before** the name-match guard:

```js
  if (pack === null || typeof pack !== 'object' || Array.isArray(pack)) {
    return { error: `Error: pack ${file} is not a pack object (found ${pack === null ? 'null' : Array.isArray(pack) ? 'an array' : typeof pack})` };
  }
```

Then simplify the now-redundant defensive `pack &&` on the following guard — `pack` is provably a
plain object past this point:

```js
  if (r.kind === 'name' && pack.name !== r.name) {
    return { error: `Error: pack file ${file} declares name '${pack.name}' which does not match its filename — rename one of them` };
  }
```

- [ ] **Step 4: Replace the `@returns` docblock (this closes T11-a truthfully)**

Replace `src/pack/pack-store.js:55` with:

```js
/**
 * @returns {{pack, path, source:'dir'|'path', hash}|{error}}
 * All SIX `{error}` returns below — malformed name, name-form unreadable,
 * path-form unreadable, invalid JSON, non-object body, name/filename mismatch —
 * are mapped to PACK_NOT_FOUND by both callers (pack-resolve.js:76,
 * cli-handlers-pack.js:225). A new `{error}` added here inherits that code
 * silently: re-code it deliberately or it lands as "not found".
 * PACK_NOT_FOUND has a FOURTH producer that never calls readPack —
 * `pack rm` (cli-handlers-pack.js:242, via rmPack) — unified there by the
 * v4.5 HOLD-gate decision 3 and pinned at tests/pack/cli-pack-cmd.test.js:370.
 * PACK_INVALID is NOT readPack's: it belongs to validatePack
 * (pack-resolve.js:94, cli-handlers-pack.js:199) and to prepareForward's
 * maxCost guard (pack-forward.js:68-76), which is not a validatePack call.
 */
```

Every claim in that block was verified at `9ea05bf`. Do not add sentences to it.

- [ ] **Step 5: Verify GREEN and add the end-to-end CLI pin**

```bash
npx jest tests/pack/pack-store.test.js
```

Then append to `tests/pack/cli-pack-cmd.test.js`, matching that file's existing `pack show` idiom:

```js
it('pack show on a null-bodied pack exits 1 with PACK_NOT_FOUND, not a TypeError', () => {
  fs.writeFileSync(path.join(packsDir, 'nullpack.json'), 'null');
  const code = handlePack({ _: ['pack', 'show', 'nullpack'], json: true });
  expect(code).toBe(1);
  expect(JSON.parse(stdout()).error.code).toBe('PACK_NOT_FOUND');
});
```

- [ ] **Step 6: Full suite + gate, then commit**

```bash
npx jest && node scripts/check-file-sizes.js
```

```bash
git add src/pack/pack-store.js tests/pack/pack-store.test.js tests/pack/cli-pack-cmd.test.js
git commit -m "fix(pack): a non-object pack body returned as success and crashed both callers"
```

---

## Task 2: Close the MCP shared-server cost-gate hole

**Files:**
- Modify: `src/mcp-server.js:442` (the gate's enclosing `if`), `:449` (the `maxCost` expression)
- Test: `tests/mcp-start-metadata.test.js`

**Interfaces:**
- Produces: the shared-server `amicus_start` path now runs `checkBudget` unconditionally.
  `packRecord` is **no longer guaranteed non-null** at the refusal site — Task 3's wording depends
  on this, so Task 3 must not assume a pack name exists.

**Why:** The whole gate hangs off `if (packForward.maxCost !== undefined)` at `mcp-server.js:442`,
and `packForward` is only populated when `input.pack` is set. The CLI gates unconditionally with a
`cfg.maxCost` fallback (`cli-handlers-run.js:90-97`). So an MCP headless `amicus_start` with **no
pack** at $80/Mtok runs where the CLI refuses. `sharedServer.enabled` defaults **true**
(`src/utils/shared-server.js:29`), so this is the default MCP path, not an exotic branch.

- [ ] **Step 1: Write the failing test**

Append to `tests/mcp-start-metadata.test.js`, reusing that file's existing shared-server harness
(it already drives this path live at `:59-84`):

```js
it('refuses an over-threshold model on the shared-server path with NO pack', async () => {
  // The gate used to sit inside `if (packForward.maxCost !== undefined)`, so a
  // no-pack MCP start skipped it entirely while the CLI refused the same model.
  writeConfig({ maxCostPerMtok: 1.0 });
  const res = await callTool('amicus_start', {
    prompt: 'hi', model: 'expensive-model', noUi: true, cwd: project,
  });
  expect(res.isError).toBe(true);
  const doc = JSON.parse(res.content[0].text);
  expect(doc.error.code).toBe('BUDGET_EXCEEDED');
});
```

Seed `expensive-model` through the same pricing fixture the file already uses for
`lookupPricing`; if none exists, add one at a per-Mtok rate above the configured cap.

- [ ] **Step 2: Run to verify RED**

```bash
npx jest tests/mcp-start-metadata.test.js -t "NO pack"
```

Expected: FAIL — `res.isError` is `undefined` and the run proceeds, because the gate never executes.

- [ ] **Step 3: Hoist the gate**

In `src/mcp-server.js`, delete the `if (packForward.maxCost !== undefined) {` line at `:442` and its
matching closing brace at `:464`, promoting the body one level. Then change the `maxCost` passed to
`checkBudget` so it mirrors `cli-handlers-run.js:97`'s fallback exactly:

```js
        // v4.7 PR6: the gate used to hang off `packForward.maxCost !== undefined`,
        // so a no-pack MCP start skipped it while the CLI (cli-handlers-run.js:90)
        // gated unconditionally with a cfg.maxCost fallback. Same guard, both doors.
        const { lookupPricing } = require('./utils/pricing');
        const { checkBudget, formatBudgetError } = require('./sidecar/budget');
        const { loadConfig } = require('./utils/config');
        const cfg = loadConfig() || {};
        const soloLeg = { modelInput: input.model || resolvedModel, model: resolvedModel, pricing: lookupPricing(resolvedModel) };
        const budget = checkBudget([soloLeg], {
          maxCostPerMtok: cfg.maxCostPerMtok,
          maxCost: fwd.maxCost !== undefined ? fwd.maxCost : cfg.maxCost,
          promptChars: (renderedPrompt && renderedPrompt.length) || 0,
        });
```

Leave the `if (!budget.ok) { … }` refusal block exactly as it is — Task 3 rewrites its wording.

- [ ] **Step 4: Verify GREEN, and prove the pack path still refuses**

```bash
npx jest tests/mcp-start-metadata.test.js tests/pack/mcp-pack-params.test.js tests/sidecar/budget.test.js
```

All must pass. If a pack-path test now fails, the fallback expression is wrong — `fwd.maxCost`
must still win over `cfg.maxCost` when a pack sets it.

- [ ] **Step 5: Commit**

```bash
git add src/mcp-server.js tests/mcp-start-metadata.test.js
git commit -m "fix(mcp): the shared-server start path skipped the budget gate unless a pack set maxCost"
```

---

## Task 3: Surface-aware budget refusal text

**Files:**
- Modify: `src/sidecar/budget.js:67-82`, `src/mcp-server.js` (the single `formatBudgetError` call)
- Test: `tests/sidecar/budget.test.js`

**Interfaces:**
- Consumes: Task 2's hoisted gate. `packRecord` may be **null** here — the text must not assume a
  pack name.
- Produces: `formatBudgetError(result, surface = { kind: 'cli' })`. The two other call sites
  (`cli-handlers-run.js:99`, `sidecar/fanout-budget.js:51`) pass nothing and are **untouched** —
  the default preserves their bytes exactly.

**Why (and why in this order):** the current `:79` trailer is pushed unconditionally for every
branch and names CLI flags that do not exist over MCP. Two further defects the recon proved:
`budget.js:62` makes `ok` require `offending.length === 0`, so **raising `--max-cost` can never
clear an offending-only refusal** — yet the trailer tells the user to do exactly that. And now that
Task 2 has landed, "call without the pack parameter" is no longer an escape hatch, so any text
suggesting it would be false.

- [ ] **Step 1: Write the failing tests**

Append to `tests/sidecar/budget.test.js` (the file currently has **zero** coverage of
`formatBudgetError`, so all of this is new ground):

```js
describe('formatBudgetError surfaces (v4.7 PR6)', () => {
  const offendingOnly = { ok: false, offending: [{ modelInput: 'o3', model: 'o3', reason: '$80.00/Mtok exceeds the $10.00/Mtok cap' }], overCeiling: false, breakdown: { totalEstCost: 1, unpricedCount: 0, maxCost: null } };
  const ceilingOnly = { ok: false, offending: [], overCeiling: true, breakdown: { totalEstCost: 12.5, unpricedCount: 0, maxCost: 10 } };

  it('defaults to the CLI surface when no surface is passed (byte-compatible)', () => {
    expect(formatBudgetError(ceilingOnly)).toContain('--max-cost');
    expect(formatBudgetError(ceilingOnly)).toBe(formatBudgetError(ceilingOnly, { kind: 'cli' }));
  });

  it('does NOT tell a CLI user to raise --max-cost when the refusal is threshold-only', () => {
    // budget.js:62 — ok requires offending.length === 0, so raising the ceiling
    // can never clear this branch. The old trailer said it could.
    const text = formatBudgetError(offendingOnly);
    expect(text).not.toMatch(/--max-cost <\$> to raise/);
    expect(text).toContain('--no-cost-gate');
  });

  it('names no CLI flags on the MCP surface', () => {
    const text = formatBudgetError(ceilingOnly, { kind: 'mcp' });
    expect(text).not.toMatch(/--max-cost|--no-cost-gate/);
  });

  it('does not offer dropping the pack as an MCP escape (the gate now always runs)', () => {
    expect(formatBudgetError(ceilingOnly, { kind: 'mcp' })).not.toMatch(/without the .?pack/i);
  });
});
```

- [ ] **Step 2: Run to verify RED**

```bash
npx jest tests/sidecar/budget.test.js -t "surfaces"
```

Expected: 3 of 4 FAIL (the byte-compat one passes trivially today). The threshold-only test fails
because the trailer is unconditional; both MCP tests fail because the parameter does not exist.

- [ ] **Step 3: Implement**

Replace `src/sidecar/budget.js:66-82` with:

```js
/**
 * Human-readable refusal text (also used as the error envelope `hint`).
 * @param {object} result checkBudget's return value
 * @param {{kind:'cli'|'mcp'}} [surface] where the text will be read. Remedies are
 *   surface-specific: the MCP tool surface has no --flags, and (since v4.7 PR6's
 *   gate hoist) no per-call override at all. Defaults to 'cli' so the two CLI
 *   callers stay byte-identical.
 */
function formatBudgetError(result, surface = { kind: 'cli' }) {
  const lines = [];
  const isMcp = surface && surface.kind === 'mcp';
  if (result.offending.length > 0) {
    lines.push('Budget gate: model(s) over the per-$/Mtok threshold:');
    for (const o of result.offending) { lines.push(`  - ${o.modelInput} (${o.model}): ${o.reason}`); }
  }
  if (result.overCeiling) {
    lines.push(`Budget gate: estimated total $${result.breakdown.totalEstCost.toFixed(4)} exceeds ${isMcp ? 'the configured maxCost' : '--max-cost'} $${result.breakdown.maxCost.toFixed(4)} (estimate, not guaranteed).`);
  }
  if (result.breakdown.unpricedCount > 0) {
    lines.push(`(${result.breakdown.unpricedCount} unpriced leg(s) — direct provider; cost unknown, not included in the estimate.)`);
  }
  // The threshold branch cannot be cleared by raising the ceiling: `ok` above
  // requires offending.length === 0 regardless of maxCost. Only name a remedy
  // that actually works on the branch that fired.
  if (isMcp) {
    lines.push(result.offending.length > 0
      ? 'Override: raise maxCostPerMtok in the amicus config, or choose a cheaper model.'
      : 'Override: raise maxCost in the amicus config, or choose a cheaper model.');
  } else {
    lines.push(result.offending.length > 0
      ? 'Override: --no-cost-gate to disable both guards (e.g. an intentional o3 run), or raise maxCostPerMtok in config.'
      : 'Override: --max-cost <$> to raise the ceiling, or --no-cost-gate to disable both guards.');
  }
  return lines.join('\n');
}
```

Then in `src/mcp-server.js`, change the one refusal-site call to
`hint: formatBudgetError(budget, { kind: 'mcp' }),`.

- [ ] **Step 4: Verify GREEN and prove the CLI callers are byte-unchanged**

```bash
npx jest tests/sidecar/budget.test.js tests/sidecar/fanout-budget.test.js tests/mcp-start-metadata.test.js
```

- [ ] **Step 5: Commit**

```bash
git add src/sidecar/budget.js src/mcp-server.js tests/sidecar/budget.test.js
git commit -m "fix(budget): refusal text named CLI flags over MCP and a remedy that cannot work"
```

---

## Task 4: One `--cwd` choke point

**Files:**
- Modify: `bin/amicus.js` — insert after the `unknownFlags` block (ends `:56`), before the
  crash-handler block at `:59`
- Test: `tests/bin/cwd-guard.test.js` (create)

**Interfaces:**
- Produces: a bare or empty `--cwd` exits 1 before any handler runs. Every
  `args.cwd || process.cwd()` consumer (**16 sites across 9 handlers**) is covered by this one guard.

**Why:** bare `--cwd` parses as boolean `true` (`src/cli.js:101`) and `--cwd=` as `''`
(`src/cli.js:72`). `DEFAULTS` (`src/cli.js:28`) always seeds a real absolute string, so a
non-string or empty `args.cwd` can **only** mean "typed without a value". Downstream it either
throws (`council run` → `TypeError: The "paths[0]" argument must be of type string`) or silently
resolves against `<cwd>/true` (`template/apply.js:69` does `path.resolve(String(project))`).
Only `start` sanitizes today (`src/cli.js:245` `validateCwdPath`).

`bin/amicus.js` is **not** size-gated (only `src/**` and `electron/**` are), so this guard has room
and belongs at the single entry point rather than in nine handlers.

- [ ] **Step 1: Write the failing test**

Create `tests/bin/cwd-guard.test.js`, modelled on the existing
`tests/bin/pack-save-version-guard.test.js` (same spawn idiom — read it first and match it):

```js
const { execFileSync } = require('child_process');
const path = require('path');
const BIN = path.join(__dirname, '..', '..', 'bin', 'amicus.js');

function run(args) {
  try {
    execFileSync(process.execPath, [BIN, ...args], { encoding: 'utf-8', stdio: 'pipe' });
    return { code: 0, stderr: '' };
  } catch (e) { return { code: e.status, stderr: e.stderr || '' }; }
}

describe('--cwd requires a value (v4.7 PR6)', () => {
  // Bare --cwd parsed as boolean true and reached 16 `args.cwd || process.cwd()`
  // sites: council run threw a TypeError, template silently resolved <cwd>/true.
  it('rejects a bare --cwd', () => {
    const r = run(['council', 'run', '--cwd', '--prompt', 'x']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('--cwd requires a value');
  });

  it('rejects --cwd=', () => {
    const r = run(['council', 'run', '--cwd=', '--prompt', 'x']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('--cwd requires a value');
  });

  it('does not fire when --cwd carries a real path', () => {
    const r = run(['council', 'run', '--cwd', process.cwd(), '--prompt', 'x']);
    expect(r.stderr).not.toContain('--cwd requires a value');
  });

  it('does not fire when --cwd is absent', () => {
    expect(run(['--help']).stderr).not.toContain('--cwd requires a value');
  });
});
```

- [ ] **Step 2: Run to verify RED**

```bash
npx jest tests/bin/cwd-guard.test.js
```

Expected: the first two FAIL — today bare `--cwd` reaches the handler and dies with a `TypeError`
stack (exit code 1 but the wrong message), and `--cwd=` silently proceeds.

- [ ] **Step 3: Implement**

Insert in `bin/amicus.js` immediately after the `unknownFlags` block's closing brace:

```js
  // `--cwd` typed with no value parses as boolean `true` (src/cli.js:101) and
  // `--cwd=` as '' (src/cli.js:72). DEFAULTS (src/cli.js:28) always seeds a real
  // absolute string, so a non-string or empty cwd can ONLY mean "typed without a
  // value" — which makes this guard provably free of false positives. Left
  // unguarded it reached 16 `args.cwd || process.cwd()` sites across 9 handlers:
  // council run threw a raw TypeError, template silently resolved <cwd>/true.
  // No dash check here: absolute paths never start with '-', and `--cwd ./x` is
  // legitimate.
  if (typeof args.cwd !== 'string' || args.cwd === '') {
    console.error('Error: --cwd requires a value');
    console.error(command
      ? `Run \`amicus ${command} --help\` to see valid options.`
      : 'Run `amicus --help` to see valid options.');
    process.exit(1);
  }
```

- [ ] **Step 4: Verify GREEN, then prove nothing else regressed**

```bash
npx jest tests/bin/ tests/cli.test.js tests/utils/known-flags.test.js
```

If any suite that spawns the bin without `--cwd` now exits 1, `DEFAULTS` is not seeding `cwd` on
that path — stop and report rather than weakening the guard.

- [ ] **Step 5: Commit**

```bash
git add bin/amicus.js tests/bin/cwd-guard.test.js
git commit -m "fix(cli): a bare --cwd reached 16 consumer sites as boolean true"
```

---

## Task 5: `council run` valueless-flag guards + containment

**Files:**
- Modify: `src/cli-handlers-council-run.js` — guards at the top of the handler (at/after `:48`,
  where `explicitKeys` is already established), containment check beside `:177-180`
- Test: `tests/cli-council-run-flags.test.js` (exists, 331 lines — **append**, do not create)

**Interfaces:**
- Consumes: `const explicitKeys = args.__explicit || new Set();` — **already present at `:48`**.
  Use it. Do **not** write `args.__explicit.has(...)` directly: ~26 existing tests build `args` by
  hand with no `__explicit` and would throw.

**Why:** reproduced by driving `handleCouncilRun` with `run.js` stubbed —
`--out-dir` bare → runDir `<project>\true`, exit 0; `--out-dir -x` → `<project>\-x`, exit 0, and
the CLI has **no** containment fence where MCP has one (`mcp-council-run.js:137-141`
`isPathInside`); `--claude-review` bare → `TypeError` at `:217`; `--run-id` bare → `council-true`;
`--timeout` bare → `timeout: true` reaches `runCouncil`; `--timeout abc` → **NaN**, which passes
the `<= 0` guard at `:146`.

**Scope note:** `--cwd` is Task 4's, at the bin choke point. Do not add a second `--cwd` guard here.

- [ ] **Step 1: Write the failing tests**

Append to `tests/cli-council-run-flags.test.js`, using that file's existing `argsBase()` helper:

```js
describe('valueless and dash-leading value flags (v4.7 PR6)', () => {
  // These flags reached runCouncil as `true`, as a NaN, or as a path escaping
  // the project — the CLI had no containment fence where MCP has isPathInside.
  const bad = [
    ['out-dir', true, /--out-dir requires a value/],
    ['out-dir', '-x', /--out-dir cannot start with '-'/],
    ['claude-review', true, /--claude-review requires a value/],
    ['run-id', true, /--run-id requires a value/],
    ['timeout', true, /--timeout requires a number/],
    ['timeout', 'abc', /--timeout requires a number/],
  ];
  for (const [flag, value, re] of bad) {
    it(`rejects --${flag} ${JSON.stringify(value)}`, async () => {
      const args = { ...argsBase(), [flag]: value, __explicit: new Set([flag]) };
      const code = await handleCouncilRun(args);
      expect(code).toBe(1);
      // The assertion that actually goes RED: the handler writes nothing to disk,
      // so a leak check would be vacuous. Prove the engine was never reached.
      expect(runCouncil).not.toHaveBeenCalled();
      expect(JSON.parse(stdout()).error.message).toMatch(re);
    });
  }

  it('rejects an --out-dir that escapes the project', async () => {
    const args = { ...argsBase(), 'out-dir': path.join('..', '..', 'escape'), __explicit: new Set(['out-dir']) };
    expect(await handleCouncilRun(args)).toBe(1);
    expect(runCouncil).not.toHaveBeenCalled();
    expect(JSON.parse(stdout()).error.message).toMatch(/must stay inside the project/);
  });

  it('still accepts a normal --out-dir', async () => {
    const args = { ...argsBase(), 'out-dir': 'my-run', __explicit: new Set(['out-dir']) };
    await handleCouncilRun(args);
    expect(runCouncil).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify RED**

```bash
npx jest tests/cli-council-run-flags.test.js -t "valueless and dash-leading"
```

Expected: all 8 FAIL. Today every one of them returns 0 and calls `runCouncil`.

- [ ] **Step 3: Implement the value guards**

In `src/cli-handlers-council-run.js`, immediately after `:48`'s `explicitKeys` line:

```js
  // v4.7 PR6: these all parse as boolean `true` when typed without a value
  // (src/cli.js:101) and reached runCouncil as `true`, a NaN, or a bogus path.
  // Voice matches the R5 -o/--out precedent (cli-handlers-council.js:183).
  for (const flag of ['out-dir', 'claude-review', 'run-id']) {
    if (!explicitKeys.has(flag)) { continue; }
    const v = args[flag];
    if (typeof v !== 'string' || v === '') {
      return failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: `Error: --${flag} requires a value` });
    }
    if (v.startsWith('-')) {
      return failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: `Error: --${flag} cannot start with '-': got '${v}'` });
    }
  }
  // --timeout is DEFAULTS-seeded to 15 (src/cli.js:31), so `!== undefined` proves
  // nothing; NaN is the real hole — it passes the `<= 0` guard below.
  if (explicitKeys.has('timeout') && (typeof args.timeout !== 'number' || !Number.isFinite(args.timeout))) {
    return failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: `Error: --timeout requires a number: got '${args.timeout}'` });
  }
```

- [ ] **Step 4: Implement the containment fence**

Replace the `runDir` computation (currently `:177-180`) with:

```js
  const project = args.cwd || process.cwd();
  const runDir = args['out-dir']
    ? path.resolve(project, String(args['out-dir']))
    : path.resolve(project, `council-${runId}`);
  // v4.7 PR6: MCP has fenced this since v4.5 (mcp-council-run.js:137-141); the CLI
  // never did, so `--out-dir ../../x` wrote outside the project and exited 0.
  const { isPathInside } = require('./utils/paths');
  if (!isPathInside(runDir, project)) {
    return failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: `Error: --out-dir must stay inside the project: '${args['out-dir']}' resolves outside ${project}` });
  }
```

Confirm `isPathInside`'s real module path first — `grep -rn "function isPathInside" src/` — and
import from wherever `mcp-council-run.js:137` gets it. Do not hand-roll a second copy.

- [ ] **Step 5: Verify GREEN and re-measure**

```bash
npx jest tests/cli-council-run-flags.test.js tests/cli-council-run.test.js tests/council/ && node scripts/check-file-sizes.js
```

`cli-handlers-council-run.js` starts at **251/300**; this task adds roughly +22. If it crosses 300,
extract the guard loop into `src/cli-council-run-guards.js` — that name keeps it inside
`known-flags.test.js`'s top-level `src/cli*.js` scan.

- [ ] **Step 6: Commit**

```bash
git add src/cli-handlers-council-run.js tests/cli-council-run-flags.test.js
git commit -m "fix(council): valueless flags reached the engine, and --out-dir could escape the project"
```

---

## Task 6: The GUI file bundle — `Object.create(null)` sweep + three standing notes

**Files:**
- Modify: `electron/workspace-ui/live-model.js` (`seen` `:211`, `reviewing`, `byRole`; #108b note;
  #108c citation fix), `electron/workspace-ui/workspace-render.js` (`existing` `:186`, `seen` `:190`;
  T20-m2 note), `electron/workspace-ui/workspace-app.js:147` (`labelByModel`)
- Test: `tests/workspace/live-model.test.js`, `tests/workspace/dead-seat-rows.test.js`

**Why all in one task:** these three files have **16, 7, and 22** lines of headroom respectively.
Splitting them across tasks means measuring the gate three times against a moving target. One task,
one measurement.

**Why it matters more than filed:** BACKLOG calls this "silently suppressed". It is worse — at
`workspace-render.js:212`, `existing['toString']` yields the inherited *function*, which has no
`.children`, so the line raises `TypeError: Cannot read properties of undefined (reading '0')` and
**aborts the entire seats repaint and every subsequent live tick**.

- [ ] **Step 1: Write the failing tests**

Append to `tests/workspace/live-model.test.js`, using its existing `deadLeg(seat)` helper at `:149`:

```js
describe('prototype-named models (v4.7 PR6)', () => {
  // Bare-object maps inherit Object.prototype keys: every one of the 12 own-property
  // names is truthy off `{}`, so a model named `toString` was dropped by `seen`
  // and again by `reviewing`.
  for (const name of ['toString', 'constructor', 'valueOf', 'hasOwnProperty']) {
    it(`a seat named '${name}' still renders a dead row`, () => {
      expect(deadSeats([deadLeg(name)], null, [], null)).toHaveLength(1);
    });
  }

  it("a critic-role candidate named 'toString' survives too", () => {
    // Takes the byRole branch (pipe-delimited, immune) — needs only the `seen` fix,
    // which is why this case alone does NOT prove the family framing.
    expect(deadSeats([deadLeg('toString')], null, [], { critic: 'toString' })).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify RED**

```bash
npx jest tests/workspace/live-model.test.js -t "prototype-named"
```

Expected: 5 FAIL, all returning `[]`. Confirm that patching **only** `seen` still leaves the first
four RED — that is what justifies sweeping the family rather than the one site.

- [ ] **Step 3: Apply the sweep (six sites, all net-zero lines)**

`live-model.js`: `var seen = {};` → `var seen = Object.create(null);` (`:211`), and the same for
`var reviewing = {};` and `var byRole = {};`.
`workspace-render.js`: `var existing = {};` → `Object.create(null)`, and `var seen = {};` → same.
`workspace-app.js:147`: `state.labelByModel = {};` → `state.labelByModel = Object.create(null);`

Add **one** short rationale comment, in `live-model.js` above `seen`:

```js
    // ⚠️ Object.create(null) throughout this family (also workspace-render.js's
    // `existing`/`seen` and workspace-app.js's `labelByModel`): a model literally
    // named `toString` is truthy off a bare object, so it was dropped here and —
    // worse — crashed workspace-render.js:212 reading `.children` off an inherited
    // function, killing the seats repaint and every tick after it.
```

Do **not** repeat that paragraph at the other five sites. `byRole` is *not* vulnerable (its keys are
pipe-delimited and no prototype name contains `|`) — it is swept for uniformity; say so in the
commit message, not in five comments.

- [ ] **Step 4: Add the `labelByModel` render pin**

`labelByModel` is the site that produces visibly garbage output rather than a silent drop. Append to
`tests/workspace/dead-seat-rows.test.js`, driving its existing `paint()` harness with a run whose
`derived.names` contains `{ model: 'toString', label: 'Model A' }`, and assert the rendered label is
`'Model A'` — not a function's source text.

- [ ] **Step 5: Write the three standing notes (spec D18/R4)**

**#108b** — extend the existing role-awareness comment above `isReviewing`
(`live-model.js:246-250`); do **not** open a new block:

```js
    // Role 'claude' is deliberately absent: it is emitted only by claudeRunStatsRow
    // (src/council/run-assemble.js:129-132) for a seat that never launches a leg, and
    // preflightClaudeReview (run-assemble.js:86-102) rejects 'claude' as chair/critic/
    // bench — so no 'claude' leg can die. If that reservation ever loosens, this
    // allowlist is the single place to extend.
```

**#108c** — the `deadSeats` docblock already documents the hidden dependency, so this is a BACKLOG
tick only. While there, fix the stale citation inside it: `cli-handlers-council-run.js:196` →
`src/cli-handlers-council-run.js:130-140` (note the missing `src/` prefix too — the same docblock
uses it for `src/council/run-stages.js` two lines above).

**T20-m2** (ruled a note, not a fix) — fold into the existing RN-11 comment at
`workspace-render.js:217-219`:

```js
    // The O(n²) `find()` per seat is deliberate: bench is capped at 26 (anonymize.js:21),
    // so this is ~100 rows worst case on a debate run, every 1.5s. `existing` above is
    // already the map an O(n) rewrite would need — reach for it only if this table ever
    // renders unbounded rows.
```

- [ ] **Step 6: Verify GREEN and re-measure all three files**

```bash
npx jest tests/workspace/ tests/electron/ && node scripts/check-file-sizes.js
```

Expected budgets after: `live-model.js` ~284→~294, `workspace-render.js` ~293→~297,
`workspace-app.js` unchanged at 278. **If either tight file crosses 300, stop and report** — the
fallback is to move that file's note into a BACKLOG "Standing notes" section (D18 permits it), not
to shrink the note into something untrue.

- [ ] **Step 7: Commit**

```bash
git add electron/workspace-ui/ tests/workspace/
git commit -m "fix(workspace): a model named toString crashed the seats repaint; sweep the bare-object family"
```

---

## Task 7: Extract the triplicated template block

**Files:**
- Create: `src/cli-template-args.js`
- Modify: `src/cli-handlers-run.js:40-50`, `src/cli-handlers-fanout.js:64-73`,
  `src/cli-handlers-council-run.js:84-90`
- Test: `tests/cli-template-args.test.js` (create)

**Interfaces:**
- Produces: `applyTemplateForArgs(args, prompt, useJson)` returning a discriminated union:
  `{applied:false}` | `{applied:true, prompt, promptMeta, templateMeta}` | `{fail:<exitCode>}`.

**Two hard constraints:**
1. **The module MUST be named `src/cli-template-args.js`.** `tests/utils/known-flags.test.js` scans
   only top-level `src/cli*.js`; a different name silently drops out of that gate. Verify by reading
   the glob in that test before you start.
2. **It must never call `process.exit`.** `run` and `fanout` call `process.exit(failJson(...))`, but
   `council-run` **returns** the code — its handler contract is return-the-exit-code. A helper that
   exits would break it. Return `{fail}` and let each caller decide.

- [ ] **Step 1: Write the failing test**

Create `tests/cli-template-args.test.js`:

```js
const { applyTemplateForArgs } = require('../src/cli-template-args');

describe('applyTemplateForArgs', () => {
  it('returns {applied:false} when neither --template nor --artifact/--var is set', () => {
    expect(applyTemplateForArgs({}, 'hi', false)).toEqual({ applied: false });
  });

  it('fails when --artifact is used without --template', () => {
    const r = applyTemplateForArgs({ artifact: 'a.md' }, 'hi', true);
    expect(r.fail).toBe(1);
    expect(JSON.parse(stdout()).error.message)
      .toBe('Error: --artifact/--var require --template (expansion happens only in template files)');
  });

  it('fails when --var is used without --template', () => {
    expect(applyTemplateForArgs({ var: ['k=v'] }, 'hi', true).fail).toBe(1);
  });
});
```

Add an `{applied:true}` case that stubs `./template/apply` via `jest.mock` and asserts `prompt`,
`promptMeta`, and `templateMeta` are threaded through and `t.notices` are pumped to stderr.

- [ ] **Step 2: Run to verify RED**

```bash
npx jest tests/cli-template-args.test.js
```

Expected: `Cannot find module '../src/cli-template-args'` — a genuine RED.

- [ ] **Step 3: Create the module**

```js
'use strict';

const { failJson, ERROR_CODES } = require('./utils/error-doc');

const NEEDS_TEMPLATE_MSG =
  'Error: --artifact/--var require --template (expansion happens only in template files)';

/**
 * The single application point for --template/--artifact/--var, shared by the
 * three CLI handlers that used to carry it verbatim.
 *
 * NEVER calls process.exit: `start` and `fanout` exit on failure but `council run`
 * RETURNS its exit code, so the decision belongs to the caller.
 *
 * @param {object} args parsed argv
 * @param {string|undefined} prompt pre-template prompt text
 * @param {boolean} useJson
 * @returns {{applied:false}
 *   | {applied:true, prompt:string, promptMeta:object, templateMeta:object}
 *   | {fail:number}}
 */
function applyTemplateForArgs(args, prompt, useJson) {
  if (args.template !== undefined) {
    const { applyTemplate } = require('./template/apply');
    const t = applyTemplate({
      templateRef: args.template, prompt,
      artifactFile: args.artifact, varList: args.var,
      project: args.cwd || process.cwd(),
    });
    if (t.error) { return { fail: failJson(useJson, t.error) }; }
    for (const n of t.notices) { process.stderr.write(n + '\n'); }
    return {
      applied: true, prompt: t.prompt, promptMeta: t.promptMeta,
      templateMeta: t.promptMeta.template,
    };
  }
  if (args.artifact !== undefined || args.var !== undefined) {
    return { fail: failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: NEEDS_TEMPLATE_MSG }) };
  }
  return { applied: false };
}

module.exports = { applyTemplateForArgs, NEEDS_TEMPLATE_MSG };
```

- [ ] **Step 4: Rewrite the three call sites**

`src/cli-handlers-run.js` (replaces `:40-50`) — note it threads `args.prompt`, not a local:

```js
  const tpl = applyTemplateForArgs(args, args.prompt, useJson);
  if (tpl.fail !== undefined) { process.exit(tpl.fail); }
  if (tpl.applied) { args.prompt = tpl.prompt; templateMeta = tpl.templateMeta; }
```

`src/cli-handlers-fanout.js` (replaces `:64-73`):

```js
  const tpl = applyTemplateForArgs(args, promptRes.prompt, useJson);
  if (tpl.fail !== undefined) { process.exit(tpl.fail); }
  if (tpl.applied) { promptRes = { prompt: tpl.prompt, promptMeta: tpl.promptMeta }; }
```

`src/cli-handlers-council-run.js` (replaces `:84-90`) — **returns**, does not exit:

```js
  const tpl = applyTemplateForArgs(args, promptRes.prompt, useJson);
  if (tpl.fail !== undefined) { return tpl.fail; }
  if (tpl.applied) { promptRes = { prompt: tpl.prompt, promptMeta: tpl.promptMeta }; }
```

Add `const { applyTemplateForArgs } = require('./cli-template-args');` to each file's import block
and delete each now-unused `applyTemplate` require.

- [ ] **Step 5: Add the drift guard**

The whole point is that the string stops being triplicated. Append to
`tests/cli-template-args.test.js`:

```js
it('the needs-template message exists in exactly one source file', () => {
  const hits = execSync('git grep -l "expansion happens only in template files" -- src/', { encoding: 'utf-8' })
    .trim().split('\n').filter(Boolean);
  expect(hits).toEqual(['src/cli-template-args.js']);
});
```

- [ ] **Step 6: Verify GREEN across every affected surface**

```bash
npx jest tests/cli-template-args.test.js tests/template/ tests/cli.test.js tests/utils/known-flags.test.js tests/council/ tests/pack/
```

Then the full suite. Expected line deltas: `cli-handlers-run.js` 165→~158,
`cli-handlers-fanout.js` 185→~179, `cli-handlers-council-run.js` down ~6 from wherever Task 5 left it.

- [ ] **Step 7: Commit**

```bash
git add src/cli-template-args.js src/cli-handlers-run.js src/cli-handlers-fanout.js src/cli-handlers-council-run.js tests/cli-template-args.test.js
git commit -m "refactor(cli): collapse the triplicated template block into cli-template-args.js"
```

---

## Task 8: Standing notes — sweeps, resolvers, publish pre-check

**Files:**
- Modify: `src/utils/session-metadata-tmp-sweep.js` (#109a on `sessionsRoot()`, #109b on
  `evaluateSessionMetadataTmpSweep`), `src/utils/session-index-tmp-sweep.js` (#109b twin),
  `src/cli-council-run-bench.js` + `src/mcp-council-bench.js` (mirrored pair),
  `.github/workflows/publish.yml` (#110a)

**These are comment-only.** No behavior changes, so **no RED-first test is possible** — do not
manufacture one. Verification is "the existing suites stay green".

Each note must be a **mirrored pair** where the hazard is editing either side alone. A one-sided
note is not a tripwire.

- [ ] **Step 1: #109a — `sessionsRoot()` reads `process.cwd()` directly**

Replace `src/utils/session-metadata-tmp-sweep.js:41`'s one-line docblock with:

```js
/**
 * The cwd-scoped sessions root: <cwd>/.claude/amicus_sessions.
 * Reads process.cwd() directly, NOT doctor's injected getCwd
 * (cli-handlers-doctor.js:33) — the list/unlink deps are wired argument-free
 * at :83-84, so that seam does not reach here. Thread cwd through those deps
 * if a `doctor --cwd <dir>` mode ever lands.
 */
```

- [ ] **Step 2: #109b — the paired byte-identical message strings**

Append to `evaluateSessionMetadataTmpSweep`'s docblock (before its closing ` */`):

```js
 * The four `message` strings below are byte-identical to the index sibling's
 * (session-index-tmp-sweep.js:63/66/77/79) on purpose — `id`/`name` and the
 * `fixDetail` wording are the only disambiguators between the two rows.
 * Reword one side and the pairing silently breaks: reword both, or neither.
```

And to `evaluateSessionIndexTmpSweep`'s docblock in the sibling:

```js
 * Its four `message` strings are byte-identical to
 * session-metadata-tmp-sweep.js's by design (only `id`/`name`/`fixDetail`
 * differ) — reword both or neither.
```

- [ ] **Step 3: resolveBench / resolveBenchInput — the mirrored pair**

Append to `resolveBench`'s docblock in `src/cli-council-run-bench.js`:

```js
 * Parallel twin: mcp-council-bench.js's `resolveBenchInput` hand-rolls the same
 * models-XOR-council wrapper around the shared `resolveCouncilMembers` core.
 * They have already diverged (this side has a third guard for a valueless
 * --council, and the min-seat rule lives in both callers, not here) — change
 * a validation rule on one side, change the other.
```

And to `resolveBenchInput`'s docblock in `src/mcp-council-bench.js`:

```js
 * Parallel twin: cli-council-run-bench.js's `resolveBench` wraps the same
 * `resolveCouncilMembers` core with its own XOR rules (CLI failJson docs there,
 * plain `{error}` strings here) and carries one guard this side lacks. The two
 * wrappers evolve independently — change a validation rule on one, change both.
```

- [ ] **Step 4: #110a — the publish pre-check's two independent greps**

Insert in `.github/workflows/publish.yml` immediately above the `VERSION_RE=` assignment (currently
`:131`), at the same 10-space indent as its neighbours:

```yaml
          # The two greps scan the body INDEPENDENTLY — together they prove the
          # body mentions $VERSION and mentions an active status, not that the
          # two belong to the same record. Sound only because the endpoint is
          # version-scoped (/versions/$VERSION) and returns one version; if the
          # registry ever returns a collection, replace both with one jq check
          # over the matching entry.
```

**It must not contain the literal `exit 1`** — `tests/scripts/publish-workflow.test.js:161` asserts
the pre-check region contains none.

- [ ] **Step 5: Verify and re-measure**

```bash
npx jest tests/doctor-metadata-tmp-sweep.test.js tests/doctor-tmp-sweep.test.js tests/scripts/publish-workflow.test.js tests/mcp-council-run-inputs.test.js tests/council/ && node scripts/check-file-sizes.js
```

Also run `actionlint` on the edited workflow (CI pins **v1.7.7**); expect exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/utils/session-metadata-tmp-sweep.js src/utils/session-index-tmp-sweep.js src/cli-council-run-bench.js src/mcp-council-bench.js .github/workflows/publish.yml
git commit -m "docs(standing-notes): convert four watch-notes to paired code-site tripwires (D18)"
```

---

## Task 9: The tmp-sweep riders (PR5F-4, PR5F-3) and #110b

**Files:**
- Modify: `src/utils/session-index-tmp-sweep.js:37-39` (PR5F-4 reword),
  `src/utils/session-metadata-tmp-sweep.js` (PR5F-3 docblock),
  `tests/helpers/doctor-base-deps.js` (#110b)
- Test: `tests/doctor-metadata-tmp-sweep.test.js`

**Ordering matters:** PR5F-4 rewrites the very citation that names
`session-metadata-tmp-sweep.js:27-31`, and PR5F-3 adds a paragraph to that same docblock — which
would invalidate the line numbers. **Do PR5F-4 first, in this task, before PR5F-3.**

- [ ] **Step 1: PR5F-4 — replace the line-number citation with a named anchor**

Replace `src/utils/session-index-tmp-sweep.js:37-39` with:

```js
      // statSync (not lstatSync) is deliberate here — see the "Symlink safety"
      // paragraph in session-metadata-tmp-sweep.js's module docblock for why that
      // sibling never follows symlinks; this file's choice to follow them is a
      // separate, unreviewed symlink-policy decision left as-is (SR-3 only added
      // the isFile() gate).
```

A quoted heading is grep-able and survives any edit above it; the target paragraph already carries
that exact heading.

- [ ] **Step 2: PR5F-3 — document the symlink behavior delta**

Add to `src/utils/session-metadata-tmp-sweep.js`'s module docblock, immediately after the existing
"Symlink safety" paragraph:

```js
 * Consequence of the SR-3 isFile() gate (listTmpIn, below): a SYMLINK whose
 * basename matches the tmp pattern is now excluded from the list entirely —
 * neither swept nor reported. Before SR-3 it was swept (unlink removes the
 * link, never the target — a safe success). Deliberate: this module's
 * never-follow policy applies to the entries it unlinks too. Note the sibling
 * session-index-tmp-sweep.js diverges here — it uses statSync, so a
 * symlink-to-a-file with the matching name IS still swept there.
```

- [ ] **Step 3: PR5F-3 — the POSIX-only pin**

The docblock is load-bearing precisely because this test never runs on Windows. Add beside SR-3's
directory fixture in `tests/doctor-metadata-tmp-sweep.test.js` (~`:238`):

```js
const itPosix = process.platform === 'win32' ? it.skip : it;
itPosix('a name-shaped symlink is excluded, not reported as an orphan', () => {
  const taskDir = path.join(sessionsRoot(), 'abc123');
  fs.mkdirSync(taskDir, { recursive: true });
  const target = path.join(taskDir, 'real.json');
  fs.writeFileSync(target, '{}');
  fs.symlinkSync(target, path.join(taskDir, 'metadata.json.tmp-1'));
  expect(listSessionMetadataTmpFiles()).toEqual([]);
});
```

- [ ] **Step 4: Prove the fixture is real before trusting the assertion**

On POSIX, first run it with `expect(...).toHaveLength(1)` to prove the symlink is actually created
and visible to the module, watch it FAIL, then flip to `toEqual([])` and watch it pass. That is the
honest RED→GREEN for pinning already-correct behavior. On Windows the test skips — say so in the
commit message rather than pretending it ran.

- [ ] **Step 5: #110b — name the third omission in the helper contract**

Add to `tests/helpers/doctor-base-deps.js`, after the `doctor-local-providers.test.js` bullet
(~`:33`):

```js
 *     - doctor-local-providers.test.js ALSO omits `env` — a preserved
 *       divergence from that file's pre-consolidation fixture, not a reasoned
 *       pin (its own comment at :19-22). Inert today: only
 *       doctor-base-url-check.js reads `d.env`, and that row is never asserted
 *       in that file.
```

- [ ] **Step 6: Verify**

```bash
npx jest tests/doctor-metadata-tmp-sweep.test.js tests/doctor-tmp-sweep.test.js tests/doctor-local-providers.test.js && node scripts/check-file-sizes.js
```

- [ ] **Step 7: Commit**

```bash
git add src/utils/ tests/doctor-metadata-tmp-sweep.test.js tests/helpers/doctor-base-deps.js
git commit -m "docs(sweep): named-anchor citation, symlink delta pin, and the third base-deps omission"
```

---

## Task 10: BACKLOG dispositions, duplicate collapse, CHANGELOG

**Files:**
- Modify: `BACKLOG.md`, `CHANGELOG.md`

**Every item this PR touched gets an explicit tick** (spec D17 — the lists close). A fixed-but-unticked
item is false open debt, which is exactly the failure D17 exists to prevent; PR4 shipped one.

- [ ] **Step 1: Tick the fixed items**

| BACKLOG item | Disposition line to append |
|---|---|
| T11-a | `— done v4.7 PR6 (docblock now truthful; the underlying non-object-body crash was fixed in the same PR)` |
| T20-m2 | `— standing note v4.7 PR6: folded into the RN-11 comment at electron/workspace-ui/workspace-render.js renderSeats` |
| SR-1 / #108 | `— done v4.7 PR6` |
| #108b | `— standing note v4.7 PR6: extended the role-awareness comment above isReviewing (electron/workspace-ui/live-model.js)` |
| #108c | `— standing note v4.7 PR6: already at the deadSeats docblock; stale citation corrected in the same commit` |
| #109a, #109b, #110a, #110b | `— standing note v4.7 PR6: <exact code site>` |
| resolveBench parallel evolution | `— standing note v4.7 PR6: mirrored docblocks at src/cli-council-run-bench.js resolveBench and src/mcp-council-bench.js resolveBenchInput (the entry's file paths were stale — both were extracted in v4.6 Task 4b / v4.7 PR0)` |
| T5-m3 | `— done v4.7 PR6 (src/cli-template-args.js)` |
| PR5F-3, PR5F-4 | `— done v4.7 PR6` |
| PR5F-2 | `— done v4.7 PR6, but SPLIT: --cwd is guarded once at bin/amicus.js (16 consumer sites); council run's own valueless flags guarded in-handler. The filed shape (B) was rejected — it would have turned `amicus models --check` into exit 1.` |
| W1-M5 | `— partially done v4.7 PR6: the parity half (the gate no longer hangs off packForward.maxCost) and the surface-aware text both shipped.` |

- [ ] **Step 2: Collapse the duplicate (ruled 2026-08-08, spec D18)**

Delete the `- [x] Phase-11 test-hygiene bundle's skill-docs remainder … — #110` bullet (3 lines,
in the v4.6.3 sweep-riders section) and extend the surviving canonical entry's tail so nothing
dangles:

```
  — done v4.7 PR4; pin tightened, null-guard half already resolved by 7cf3f18 (mustMatch), filed
  sight-unseen. Originally double-filed as a #110 sweep rider; that duplicate collapsed here in
  v4.7 PR6 per spec D18.
```

PR4 deliberately chose cross-referencing over collapsing; this reverses that per the spec's explicit
ruling. Note the reversal in the PR body — do not silently overturn a prior PR's choice.

- [ ] **Step 3: Re-file the deferred items with recon-corrected specs**

Append `— recon 2026-08-08:` notes to **T19-m1, T19-m2, PR1F-4, W1-M4, W1-M6/W1-M7** carrying the
corrected facts, so PR7 plans from truth rather than re-deriving refuted shapes. Source them from
`.superpowers/sdd/pr6-recon-report.md` §3. At minimum each must record:

- **T19-m1/m2** — must be ONE task behind a mandatory `workspace-panels.js` extraction (294/300).
  The 2026-08-07 corrected shape was itself refuted: remapping titles by `name` reintroduces
  cross-model misattribution when `artifactsByModel` is absent (measured
  `["vendor/a","vendor:a"]` → `["vendor:a","vendor:a"]`), and a third path — the artifact manifest
  changing between issue and completion — survives both halves.
- **W1-M4** — option (B) throws `ReferenceError` on every wave (hoists a `legs` read into its TDZ),
  breaks the pinned `fanout.test.js:738`, and closes 2 of ~17 pre-launch abort paths.
  `src/sidecar/fanout.js` is at **300/300** — zero headroom.
- **W1-M6/M7** — "the path is dead" is **wrong**: spawn-fallback is the default for interactive
  `amicus_start`. Source shape verified correct; the test plan is what fails.
- **PR1F-4** — dropping the `=== 'error'` gate is confirmed right; needs an owner ruling on the
  rendering surface, and the helper must land in `workspace-seats.js` (133/300), not `live-model.js`.

- [ ] **Step 4: CHANGELOG**

Under `[Unreleased]`, add a `### Fixed` block. Four of these are **behavior changes users can
observe**, so each gets its own line, not a roll-up:

```markdown
- A pack file whose JSON body is not an object (`null`, an array, a bare number or string) used to
  read as a *successful* load and then crash with an uncaught `TypeError` — `council run --pack` and
  `pack show` both died, and `pack show --json` exited 0 with `"pack": null`. It is now a clean
  `PACK_NOT_FOUND`.
- **The MCP `amicus_start` shared-server path skipped the budget gate entirely unless a pack set
  `maxCost`.** It now gates unconditionally with the same `maxCost`/`maxCostPerMtok` config fallback
  the CLI has always used. Runs that previously proceeded may now be refused — that is the fix.
- Budget refusal text is now surface-aware: the MCP surface no longer names `--max-cost`/
  `--no-cost-gate` (flags that do not exist there), and neither surface suggests raising the ceiling
  for a per-$/Mtok refusal, which could never clear it.
- `--cwd` typed without a value parsed as boolean `true` and reached 16 consumer sites — crashing
  `council run` with a raw `TypeError` and silently resolving templates against `<cwd>/true`. It now
  exits 1 at the entry point. Same treatment for `council run`'s `--out-dir`, `--claude-review`,
  `--run-id`, and `--timeout` (which also accepted `NaN`).
- **`council run --out-dir` could write outside the project.** The MCP path has been fenced since
  v4.5; the CLI now applies the same containment check.
- A council member whose model name collides with an `Object.prototype` key (`toString`,
  `constructor`, …) crashed the Workspace seats repaint and every live tick after it.
```

- [ ] **Step 5: Commit**

```bash
git add BACKLOG.md CHANGELOG.md
git commit -m "docs: PR6 dispositions, duplicate collapse, and recon-corrected re-files"
```

---

## Deferred out of this PR (with reasons)

| Item | Why not here |
|---|---|
| **T19-m1 + T19-m2** | Need a `workspace-panels.js` extraction (294/300) plus a genuine design pass — the last two proposed shapes were both refuted, the second for reintroducing cross-model misattribution. |
| **PR1F-4** | Needs an owner ruling on the rendering surface. |
| **W1-M4** | Filed option (B) is broken three ways; `fanout.js` has zero headroom. |
| **W1-M6/M7** | Source shape is sound but the "dead path" premise is false, so the item needs re-framing before it can be planned. |

---

## Self-review

**Coverage.** Every ruling-free item from the recon roster maps to a task: SR-1→6, T5-m3→7,
#108b/#108c→6, #109a/#109b/#110a→8, #110b→9, resolveBench→8, T20-m2→6 (ruled a note),
PR5F-3/PR5F-4→9, dup collapse→10, T11-a→1. All four live defects map to Tasks 1–6. The three
owner rulings from 2026-08-08 are executed: T20-m2 as a note (Task 6), the collapse per spec
(Task 10), and W1-M5's parity fix strictly before its wording (Tasks 2→3).

**Placeholders.** None — every code step carries the code, every test step the test.

**Type consistency.** `applyTemplateForArgs(args, prompt, useJson)` returns the same three-arm union
in Task 7's module, its tests, and all three call sites. `formatBudgetError(result, surface)` has
one signature across Task 3's implementation, its tests, and the `mcp-server.js` call.
`{ kind: 'cli' | 'mcp' }` is the surface shape everywhere.

**Ordering constraints, all explicit.** Task 3 depends on Task 2 (`packRecord` may be null).
Task 9's PR5F-4 precedes its PR5F-3. Task 6 bundles every GUI-file edit so the three tight files
are measured once. Task 5 warns that `cli-handlers-council-run.js` may need an extraction, and names
`src/cli-council-run-guards.js` so it stays inside `known-flags.test.js`'s scan.
