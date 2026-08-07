# `pack save --pack-version` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `amicus pack save` able to set a pack's version — via a new `--pack-version <semver>` flag — and make the unusable `pack save --version` combination fail loudly instead of printing the amicus version banner and exiting 0 with no pack written.

**Architecture:** Three independent changes. (1) The `pack:` usage block advertises `--pack-version` and the handler reads `args['pack-version']` — `known-flags.js` scrapes the usage text, so the new flag becomes known with no second list to maintain. (2) A pure predicate `packSaveVersionConflict(args)` in `src/utils/cli-preflight.js`, called from `bin/amicus.js` immediately before the version-banner intercept, rejects `pack save --version` with `BAD_ARGS`. (3) Docs and CHANGELOG describe what actually works.

**Tech Stack:** Node.js (CommonJS in `src/`, ESLint strict), Jest.

**Spec:** [docs/superpowers/specs/2026-08-07-pack-save-version-design.md](../specs/2026-08-07-pack-save-version-design.md)

## Global Constraints

- Work in the worktree `C:\Users\sendt\code\amicus-wt-packversion`, branch `fix/pack-save-version` (off `origin/main`). `node_modules` is already junctioned in; **never run bare `npm install`**.
- Single suites: `npx jest <path>`. Full unit gate: `npm test`.
- **NEVER** run a `*.integration.test.js` file directly, and **never** `npm run test:all` — this machine has live API keys and those rails spend real money. Sanctioned rails only: `npm test`, `npm run test:integration`.
- ESLint strict: `no-var`, `eqeqeq: always`, `curly: all`, `semi: always`. JSDoc on public APIs.
- File size gate: 300 lines/file, 50 lines/function (pre-commit hook blocks). `src/utils/cli-preflight.js` is 43 lines and `src/cli-handlers-pack.js` is 239 — both stay well under after these changes.
- The pre-commit hook runs `generate-docs.js`, which may rewrite CLAUDE.md's auto sections and **auto-stages** the result. Let it; do not hand-edit anything between `<!-- AUTO:name -->` markers.
- `--version` keeps its global meaning everywhere except `pack save`. Do **not** remove `'version'` from `BOOLEAN_FLAGS`.

---

### Task 1: `--pack-version` — the spelling that works

**Files:**
- Modify: `src/cli.js:711-714` (the `--version <semver>` line in the `pack:` usage block)
- Modify: `src/cli-handlers-pack.js:26` and `src/cli-handlers-pack.js:117`
- Test: `tests/pack/cli-pack-cmd.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: the flag name `--pack-version` (parsed key `'pack-version'`), consumed by Task 2's error `hint` text and Task 3's docs.

- [ ] **Step 1: Write the failing tests**

Append this describe block to the end of `tests/pack/cli-pack-cmd.test.js`, before the final closing of the file (it is a top-level `describe`, so it goes after the last existing one):

```js
// v4.7 — `--version` could never reach this handler. `version` is a global
// BOOLEAN_FLAG (src/cli.js), so parseArgs set args.version=true, dropped the
// semver into positionals, and bin/amicus.js printed the version banner BEFORE
// command dispatch: exit 0, no pack written. The per-pack version is spelled
// `--pack-version`; the trap combination is rejected by packSaveVersionConflict
// (tests/bin/pack-save-version-guard.test.js).
describe('handlePack: save --pack-version', () => {
  test('flags path honors --pack-version', async () => {
    const code = await handlePack(pa([
      'save', 'versioned', '--kind', 'council', '--bench', 'alpha,beta',
      '--pack-version', '2.0.0',
    ]));
    expect(code).toBe(0);
    expect(stdout()).toContain("Saved pack 'versioned' v2.0.0");
    expect(store().readPack('versioned').pack.version).toBe('2.0.0');
  });

  test('absent --pack-version still defaults to 1.0.0', async () => {
    const code = await handlePack(pa([
      'save', 'unversioned', '--kind', 'council', '--bench', 'alpha,beta',
    ]));
    expect(code).toBe(0);
    expect(store().readPack('unversioned').pack.version).toBe('1.0.0');
  });

  // The net that makes the rename safe: a valueless `--pack-version` parses to
  // boolean true, and validatePack's semver check turns that into a loud
  // PACK_INVALID rather than a pack carrying `"version": true`.
  test('--pack-version with no value -> PACK_INVALID, no pack written', async () => {
    const code = await handlePack(pa([
      'save', 'novalue', '--kind', 'council', '--bench', 'alpha,beta', '--pack-version',
    ]));
    expect(code).toBe(1);
    expect(stderr()).toContain('version must be semver-shaped');
    expect(store().readPack('novalue').error).toBeTruthy();
  });

  test('--pack-version with a non-semver value -> PACK_INVALID', async () => {
    const code = await handlePack(pa([
      'save', 'badver', '--kind', 'council', '--bench', 'alpha,beta',
      '--pack-version', 'not-a-semver',
    ]));
    expect(code).toBe(1);
    expect(stderr()).toContain('version must be semver-shaped');
  });
});

// Anti-rot: help text must describe the flag that actually works. `--version`
// appears in NO usage block today (it is known only via BOOLEAN_FLAGS), so
// getUsage('pack') — header + pack block + trailer — is a sound place to assert
// its absence. Note `--pack-version` does not contain the substring `--version`.
describe('pack usage block advertises the flag that actually works', () => {
  const { getUsage } = require('../../src/cli');

  test('advertises --pack-version and not a bare --version', () => {
    const usage = getUsage('pack');
    expect(usage).toContain('--pack-version <semver>');
    expect(usage).not.toContain('--version');
  });
});
```

Then add this test **inside** the existing `describe('handlePack: save --from-run (solo session)', ...)` block (it needs that block's `seedSolo` helper and `project` tmpdir), immediately after the existing `'model + agent/thinking captured when present'` test:

```js
  test('--pack-version is honored on the --from-run path too', async () => {
    seedSolo('so3');
    const code = await handlePack(pa([
      'save', 'from-solo-versioned', '--from-run', 'so3', '--cwd', project,
      '--pack-version', '3.1.4',
    ]));
    expect(code).toBe(0);
    expect(store().readPack('from-solo-versioned').pack.version).toBe('3.1.4');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx jest tests/pack/cli-pack-cmd.test.js
```

Expected: FAIL. Specifically — `flags path honors --pack-version` fails with the pack landing at `v1.0.0`; `--from-run` likewise; `advertises --pack-version <semver>` fails because the block still says `--version <semver>`. The two `PACK_INVALID` tests and `absent --pack-version still defaults to 1.0.0` should already PASS (they describe behavior the change must preserve).

- [ ] **Step 3: Rename the flag in the usage block**

In `src/cli.js`, inside `USAGE_COMMAND_BLOCKS.pack`, replace these four lines:

```
                                --version <semver>       default 1.0.0 (an
                                                         unchanged re-save is a
                                                         no-op; a changed one
                                                         auto-bumps the patch)
```

with:

```
                                --pack-version <semver>  the SAVED PACK's
                                                         version, default 1.0.0
                                                         (an unchanged re-save
                                                         is a no-op; a changed
                                                         one auto-bumps the
                                                         patch). Not --version,
                                                         which is amicus's own
                                                         global flag.
```

- [ ] **Step 4: Read the new key in the handler**

In `src/cli-handlers-pack.js`, line 26, change:

```js
  const pack = { schemaVersion: 1, type: 'pack', name, version: args.version || '1.0.0', kind };
```

to:

```js
  // `--pack-version`, NOT `--version`: the latter is a global BOOLEAN_FLAG that
  // bin/amicus.js intercepts before dispatch, so it could never arrive here.
  const pack = { schemaVersion: 1, type: 'pack', name, version: args['pack-version'] || '1.0.0', kind };
```

and line 117, change:

```js
  const version = args.version || '1.0.0';
```

to:

```js
  const version = args['pack-version'] || '1.0.0'; // see buildPackFromFlags — never args.version
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx jest tests/pack/cli-pack-cmd.test.js
```

Expected: PASS, all tests in the suite.

- [ ] **Step 6: Verify the new flag is accepted by the unknown-flag rejector**

`known-flags.js` scrapes `--([a-z][a-z0-9-]*)` from `getUsage()`, so `--pack-version` should now be known automatically. Prove it:

```bash
npx jest tests/utils/known-flags.test.js
```

Expected: PASS.

```bash
node -e "const {getKnownFlags}=require('./src/utils/known-flags'); const k=getKnownFlags(); console.log('pack-version:', k.has('pack-version'), '| version:', k.has('version'));"
```

Expected output: `pack-version: true | version: true`

- [ ] **Step 7: Lint**

```bash
npm run lint
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/cli.js src/cli-handlers-pack.js tests/pack/cli-pack-cmd.test.js
git commit -m "fix(pack): pack save gains --pack-version, the version flag that can actually arrive"
```

---

### Task 2: reject `pack save --version` instead of printing the banner

**Files:**
- Modify: `src/utils/cli-preflight.js` (add `packSaveVersionConflict`, extend `module.exports`)
- Modify: `bin/amicus.js` (two requires near the top; one guard immediately before the `// Handle --version` block at line ~89)
- Test: `tests/bin/pack-save-version-guard.test.js` (create)

**Interfaces:**
- Consumes: the flag name `--pack-version` from Task 1 (named in the `hint` string).
- Produces: `packSaveVersionConflict(args)` → `{code: string, message: string, hint: string} | null`. Returns a `failJson` opts object rather than exiting, so `bin/amicus.js` keeps a single exit site and the predicate stays unit-testable.

- [ ] **Step 1: Write the failing test**

Create `tests/bin/pack-save-version-guard.test.js`:

```js
// tests/bin/pack-save-version-guard.test.js
'use strict';

/**
 * v4.7 — the `pack save --version` trap. `version` is a global BOOLEAN_FLAG
 * (src/cli.js), so `amicus pack save x --kind council --bench a,b --version
 * 2.0.0` parsed with args.version=true, hit bin/amicus.js's version-banner
 * intercept BEFORE command dispatch, and exited 0 having written NO pack — the
 * semver ended up in positionals and handlePack never ran. Third instance of
 * the accepted-and-silently-ignored class (v4.5.2 `start --headless`, v4.7
 * `fanout --quiet`).
 *
 * The predicate is tested directly rather than through bin/amicus.js: that file
 * is a script with a top-level main() and process.exit, which is the same
 * reason tests/bin/preflight-json-envelope.test.js tests extracted units.
 * `--pack-version` actually working is covered in tests/pack/cli-pack-cmd.test.js.
 */

const { parseArgs } = require('../../src/cli');
const { packSaveVersionConflict } = require('../../src/utils/cli-preflight');

describe('packSaveVersionConflict: fires for `pack save`', () => {
  test('--version <semver> -> BAD_ARGS whose hint names --pack-version', () => {
    const conflict = packSaveVersionConflict(parseArgs([
      'pack', 'save', 'mybench', '--kind', 'council', '--bench', 'a,b', '--version', '2.0.0',
    ]));
    expect(conflict).toMatchObject({ code: 'BAD_ARGS' });
    expect(conflict.hint).toContain('--pack-version');
  });

  test('--version=<semver> is caught too (isBooleanFlag discards the inline value)', () => {
    const args = parseArgs(['pack', 'save', 'mybench', '--kind', 'council', '--version=2.0.0']);
    // Pins the exact parser behaviour this guard exists for: the inline value is
    // dropped at src/cli.js's isBooleanFlag branch, ahead of the --key=value branch.
    expect(args.version).toBe(true);
    expect(packSaveVersionConflict(args)).toMatchObject({ code: 'BAD_ARGS' });
  });

  test('bare --version with no value is caught as well', () => {
    expect(packSaveVersionConflict(parseArgs(['pack', 'save', 'x', '--version'])))
      .toMatchObject({ code: 'BAD_ARGS' });
  });
});

describe('packSaveVersionConflict: silent everywhere else (banner still prints)', () => {
  test.each([
    ['bare --version', ['--version']],
    ['pack list --version', ['pack', 'list', '--version']],
    ['pack show --version', ['pack', 'show', 'x', '--version']],
    ['pack rm --version', ['pack', 'rm', 'x', '--version']],
    ['start --version', ['start', '--version']],
    ['council run --version', ['council', 'run', '--version']],
  ])('%s -> null', (_label, argv) => {
    expect(packSaveVersionConflict(parseArgs(argv))).toBeNull();
  });

  test('pack save WITHOUT --version -> null', () => {
    expect(packSaveVersionConflict(parseArgs([
      'pack', 'save', 'x', '--kind', 'council', '--bench', 'a,b',
    ]))).toBeNull();
  });

  test('pack save --pack-version -> null (the working spelling is never blocked)', () => {
    expect(packSaveVersionConflict(parseArgs([
      'pack', 'save', 'x', '--pack-version', '2.0.0',
    ]))).toBeNull();
  });

  test('tolerates a malformed args object', () => {
    expect(packSaveVersionConflict(null)).toBeNull();
    expect(packSaveVersionConflict({})).toBeNull();
    expect(packSaveVersionConflict({ version: true })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx jest tests/bin/pack-save-version-guard.test.js
```

Expected: FAIL with `TypeError: packSaveVersionConflict is not a function` on every test — the export does not exist yet.

- [ ] **Step 3: Add the predicate**

In `src/utils/cli-preflight.js`, add this function after `requireValidTaskId` and before `module.exports`:

```js
/**
 * `pack save --version <semver>` can never work, and used to fail SILENTLY:
 * `version` is a global BOOLEAN_FLAG (src/cli.js), so parseArgs sets
 * `args.version = true` and drops the semver into positionals, then
 * bin/amicus.js prints the version banner BEFORE command dispatch — so
 * `handlePack` never runs and no pack is written, at exit 0. `--version=2.0.0`
 * fails identically (the inline value is discarded at the isBooleanFlag branch,
 * ahead of the --key=value branch). The pack's own version is `--pack-version`.
 *
 * Returns the failure rather than exiting, so bin/amicus.js keeps one exit site
 * and this stays unit-testable (bin/amicus.js is a script, not a module).
 *
 * @param {object} args - parsed CLI args
 * @returns {{code: string, message: string, hint: string}|null} null when there is no conflict
 */
function packSaveVersionConflict(args) {
  if (!args || !args.version) { return null; }
  const argv = Array.isArray(args._) ? args._ : [];
  if (argv[0] !== 'pack' || argv[1] !== 'save') { return null; }
  return {
    code: ERROR_CODES.BAD_ARGS,
    message: "Error: --version is amicus's own global flag, not the saved pack's version",
    hint: 'Use --pack-version <semver> to set the version of the pack being saved.',
  };
}
```

Then change the export line from:

```js
module.exports = { requireNoUiForJson, requireValidTaskId };
```

to:

```js
module.exports = { requireNoUiForJson, requireValidTaskId, packSaveVersionConflict };
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx jest tests/bin/pack-save-version-guard.test.js
```

Expected: PASS, all tests.

- [ ] **Step 5: Wire the guard into `bin/amicus.js`**

Add two requires. After the existing line:

```js
const { unknownFlags, getKnownFlags } = require('../src/utils/known-flags');
```

insert:

```js
const { packSaveVersionConflict } = require('../src/utils/cli-preflight');
const { failJson } = require('../src/utils/error-doc');
```

Then find this block (around line 89):

```js
  // Handle --version
  if (args.version) {
    console.log(`amicus v${VERSION}`);
    process.exit(0);
  }
```

and insert the guard immediately **before** it, so the whole region reads:

```js
  // `pack save` documents a per-pack `--pack-version <semver>`. `--version` is a
  // global BOOLEAN_FLAG, so `pack save … --version 2.0.0` used to fall straight
  // into the banner below: exit 0, no pack written, the semver stranded in
  // positionals. Reject that one combination by name instead of silently doing
  // something else; every other --version still prints the banner.
  const versionConflict = packSaveVersionConflict(args);
  if (versionConflict) {
    process.exit(failJson(!!args.json, versionConflict));
  }

  // Handle --version
  if (args.version) {
    console.log(`amicus v${VERSION}`);
    process.exit(0);
  }
```

- [ ] **Step 6: Verify the real CLI end to end**

```bash
node bin/amicus.js pack save mybench --kind council --bench a,b --version 2.0.0; echo "exit=$?"
```

Expected: stderr shows `Error: --version is amicus's own global flag, not the saved pack's version` followed by `  → Use --pack-version <semver> to set the version of the pack being saved.`, and `exit=1`.

```bash
node bin/amicus.js pack save mybench --json --kind council --bench a,b --version 2.0.0; echo "exit=$?"
```

Expected: a JSON envelope on stdout with `"type": "error"`, `"ok": false`, `"code": "BAD_ARGS"`, and `exit=1`.

```bash
node bin/amicus.js --version; echo "exit=$?"
```

Expected: `amicus v<version>` and `exit=0` — the global flag is untouched.

```bash
node bin/amicus.js pack list --version; echo "exit=$?"
```

Expected: `amicus v<version>` and `exit=0` — only `pack save` is guarded.

- [ ] **Step 7: Lint**

```bash
npm run lint
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/utils/cli-preflight.js bin/amicus.js tests/bin/pack-save-version-guard.test.js
git commit -m "fix(pack): pack save --version fails BAD_ARGS instead of printing the version banner"
```

---

### Task 3: docs and CHANGELOG describe what actually works

**Files:**
- Modify: `docs/usage.md:306` (the "Every kind may also carry…" paragraph in the Policy packs section)
- Modify: `CHANGELOG.md` (the `### Fixed` list under `## [Unreleased]`, which begins at line 92)

**Interfaces:**
- Consumes: the flag name `--pack-version` (Task 1) and the `BAD_ARGS` rejection behavior (Task 2).
- Produces: nothing consumed by later tasks — this is the final task.

- [ ] **Step 1: Update `docs/usage.md`**

Replace line 306:

```markdown
Every kind may also carry `description`, `version` (semver, default `1.0.0`), and `briefing.template` (a template **reference**, not rendered text — a pack never captures briefing prose).
```

with:

```markdown
Every kind may also carry `description`, `version` (semver, default `1.0.0`), and `briefing.template` (a template **reference**, not rendered text — a pack never captures briefing prose).

The `version` field is set with **`--pack-version <semver>`**, not `--version` — the latter is amicus's own global "print the version" flag, which is intercepted before command dispatch and so can never carry a pack's version. `pack save --version` is rejected with `BAD_ARGS` naming the right spelling.
```

- [ ] **Step 2: Update `CHANGELOG.md`**

In the `### Fixed` list under `## [Unreleased]`, immediately after the `amicus fanout --quiet` bullet (which ends with "accepted-but-ignored shape as `list --search` above."), insert:

```markdown
- **`amicus pack save --version <semver>` was accepted and silently ignored — it wrote no pack at
  all.** `version` is a global boolean flag, so `parseArgs` set `args.version = true`, stranded the
  semver in positionals, and `bin/amicus.js` printed the amicus version banner *before* command
  dispatch — `handlePack` never ran, and the command exited 0 having saved nothing.
  `--version=2.0.0` failed identically. Meanwhile the handler read `args.version` for a value it
  could never receive, and both the help text and `docs/usage.md` documented `--version <semver>`
  as a real option. The pack's own version is now spelled **`--pack-version <semver>`** (honored on
  both the flags and `--from-run` paths), and `pack save --version` fails fast with `BAD_ARGS`
  naming the right spelling. Every other `--version` still prints the banner. Third instance of the
  accepted-but-ignored shape, after `list --search` and `fanout --quiet` above.
```

- [ ] **Step 3: Run the docs-sync suites**

```bash
npx jest tests/docs-quick-sync.test.js tests/docs-command-coverage.test.js
```

Expected: PASS. (`docs-quick-sync` anchors its version regex on the `amicus status demo123 --json` example, not on the pack help block, so it is unaffected by the rename.)

- [ ] **Step 4: Run the full unit gate**

```bash
npm test
```

Expected: PASS, full suite green. This is the pre-push gate — do not proceed past a failure.

- [ ] **Step 5: Commit**

The pre-commit hook runs `generate-docs.js` and may rewrite + auto-stage CLAUDE.md's auto sections (`cli-preflight.js` gained an export). Let it; do not hand-edit those markers.

```bash
git add docs/usage.md CHANGELOG.md
git commit -m "docs(pack): document --pack-version and the rejected --version combination"
```

- [ ] **Step 6: Confirm the reported command line is fixed**

Re-run the exact invocation from the bug report plus its corrected form:

```bash
node bin/amicus.js pack save mybench --kind council --bench a,b --version 2.0.0; echo "exit=$?"
```

Expected: `BAD_ARGS` on stderr naming `--pack-version`, `exit=1`.

```bash
node bin/amicus.js pack save mybench --kind council --bench a,b --pack-version 2.0.0; echo "exit=$?"
```

Expected: `Saved pack 'mybench' v2.0.0 → …/packs/mybench.json`, `exit=0`. Then clean up the scratch pack:

```bash
node bin/amicus.js pack rm mybench
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §1 Working spelling `--pack-version` in the usage block | Task 1, Step 3 |
| §2 Handler reads the new key (both `buildPackFromFlags` and `buildPackFromRun`) | Task 1, Step 4 |
| §3 Guard `packSaveVersionConflict` in `cli-preflight.js`, wired into `bin/amicus.js` before the banner, through `failJson` | Task 2, Steps 3 and 5 |
| §4 Docs name `--pack-version`; the pack-*field* line stays | Task 3, Step 1 |
| §5 Five RED-first tests | Task 1 Step 1 (working spelling ×2, anti-rot help), Task 2 Step 1 (guard fires, guard silent) |
| Non-goal: `writePack` semantics unchanged | No task touches `src/pack/pack-store.js` |
| Non-goal: no MCP surface change | No task touches `src/mcp-*.js` |
| Non-goal: `--version` unchanged elsewhere | Task 2 Step 6 asserts bare `--version` and `pack list --version` still print the banner |

**Type consistency:** `packSaveVersionConflict(args)` is defined in Task 2 Step 3 returning `{code, message, hint} | null`, exported in the same step, imported under that exact name in Task 2 Step 1's test and Task 2 Step 5's `bin/amicus.js` require. The parsed-args key is `'pack-version'` (bracket access) in Task 1 Step 4 and in every test that sets `--pack-version`. `failJson(useJson, opts)` matches the existing signature in `src/utils/error-doc.js:55`.

**Placeholder scan:** No TBD/TODO. Every code step shows complete code; every command step shows the exact command and its expected output.

**One behavior worth noting:** a valueless `--pack-version` parses to boolean `true`, which `validatePack` already rejects (`typeof pack.version !== 'string' || !SEMVER_RE.test(...)` at `src/pack/pack-validate.js:52`) with a loud `PACK_INVALID` and no pack written. Task 1 Step 1 pins this rather than adding a redundant guard.
