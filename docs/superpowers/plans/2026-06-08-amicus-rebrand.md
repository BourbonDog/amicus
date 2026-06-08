# Amicus Rebrand (claude-sidecar → amicus) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebrand the forked `claude-sidecar` engine to **Amicus** — npm `amicus`, CLI `amicus`/`am`, and consistent `amicus*` internal identifiers — while keeping every legacy `sidecar*` form working as a deprecated, backward-compatible shim.

**Architecture:** This is the F6 "rebrand" slice of the Amicus v1 spec (`docs/superpowers/specs/2026-06-07-amicus-product-design.md`). The user chose **deep rename + compatibility shims**: rename internals (env vars, config dir, session dir, MCP tool ids, config token, exported fns) to `amicus*`, but accept the old `sidecar*` forms as deprecated aliases so pre-rebrand setups (including the maintainer's live `~/.config/sidecar/.env` credentials and any existing `~/.claude/sidecar_sessions/`) keep working. All shims are centralized through two small helpers and logged once on use, so a future revision can delete them in one pass (tracked in `docs/SHIMS.md`).

**Tech Stack:** Node.js (CommonJS) ≥18, Jest (unit + `*.integration.test.js`), Electron (optional dep), `@modelcontextprotocol/sdk`, OpenCode SDK. Tests run via `npm test` (unit) and `npm run test:integration`. Lint via `npm run lint`.

---

## Strategy notes (read once before Task 1)

- **Two shim primitives, defined first (Task 2):**
  1. `getCompatEnv(suffix)` — reads `AMICUS_<suffix>`, falls back to `SIDECAR_<suffix>` with a one-time deprecation warning.
  2. The **dual-directory** pattern — write to the new `amicus*` path; for reads, prefer the new path but fall back to the legacy `sidecar*` path when only it exists.
- **`KEEP` (do NOT rename), confirmed during planning:** the `sidecar` chat skill name + its install dir `~/.claude/skills/sidecar/`; upstream attribution to `jrenaldi79/sidecar`; the git `upstream` remote; the bundled council skill dir `skills/second-opinion/`. The internal OpenCode "mode" string value `'sidecar'` in `electron/toolbar.js`/`main.js` (the `mode` parameter, not the brand) also stays.
- **Shim removal:** every shim gets a `// DEPRECATED(amicus-shim): remove in a future revision — see docs/SHIMS.md` comment and a row in `docs/SHIMS.md`. Task 14 verifies the inventory is complete.
- **Commit discipline:** one commit per task (DRY, frequent commits). Keep the suite green at every commit.
- **Baseline surface (from code exploration):** ~56 files contain `claude-sidecar`; the standalone word `sidecar` appears in ~1000 files (mostly KEEP — comments/skill/internal). Acceptance gates below target the user-facing/identity strings, not the standalone word.

---

## Task 1: Branch + green baseline + SHIMS.md scaffold

**Files:**
- Create: `docs/SHIMS.md`
- Verify only: test suite

- [ ] **Step 1: Create the working branch**

```bash
git -C C:/Users/sendt/dev/amicus switch -c rebrand/amicus
```

- [ ] **Step 2: Establish the green baseline (must pass before any change)**

Run: `npm test`
Expected: PASS (record the passing test count; later tasks must not regress it).
Then run: `npm run test:integration`
Expected: PASS (the CLI-process integration tests spawn `bin/sidecar.js`).

- [ ] **Step 3: Scaffold the shim tracker**

Create `docs/SHIMS.md`:

```markdown
# Amicus compatibility shims (remove in a future revision)

These backward-compat shims let pre-rebrand `sidecar*` setups keep working after
the Amicus rebrand. Each is logged once on use. **Remove all of these together in
a future major revision once users have migrated.** See the rebrand plan:
`docs/superpowers/plans/2026-06-08-amicus-rebrand.md`.

| Shim | Location | Legacy form kept working | Remove by |
| --- | --- | --- | --- |
| (filled in as tasks land) | | | |
```

- [ ] **Step 4: Commit**

```bash
git add docs/SHIMS.md
git commit -m "chore(rebrand): branch + shim tracker scaffold"
```

---

## Task 2: Central env-compat shim helper

**Files:**
- Create: `src/utils/env-compat.js`
- Test: `tests/utils/env-compat.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/utils/env-compat.test.js`:

```javascript
const path = require('path');

describe('getCompatEnv', () => {
  const SUFFIX = 'CONFIG_DIR';
  let warnSpy;

  beforeEach(() => {
    jest.resetModules();
    delete process.env.AMICUS_CONFIG_DIR;
    delete process.env.SIDECAR_CONFIG_DIR;
    warnSpy = jest.fn();
    jest.doMock('../../src/utils/logger', () => ({ logger: { warn: warnSpy, info: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
  });

  function load() {
    return require('../../src/utils/env-compat').getCompatEnv;
  }

  it('returns the AMICUS_ value when set', () => {
    process.env.AMICUS_CONFIG_DIR = '/new';
    expect(load()(SUFFIX)).toBe('/new');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('falls back to the SIDECAR_ value and warns once', () => {
    process.env.SIDECAR_CONFIG_DIR = '/legacy';
    const getCompatEnv = load();
    expect(getCompatEnv(SUFFIX)).toBe('/legacy');
    expect(getCompatEnv(SUFFIX)).toBe('/legacy');
    expect(warnSpy).toHaveBeenCalledTimes(1); // one-time warning
  });

  it('prefers AMICUS_ over SIDECAR_ when both are set', () => {
    process.env.AMICUS_CONFIG_DIR = '/new';
    process.env.SIDECAR_CONFIG_DIR = '/legacy';
    expect(load()(SUFFIX)).toBe('/new');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('returns undefined when neither is set', () => {
    expect(load()(SUFFIX)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/utils/env-compat.test.js`
Expected: FAIL ("Cannot find module '../../src/utils/env-compat'").

- [ ] **Step 3: Write minimal implementation**

Create `src/utils/env-compat.js`:

```javascript
/**
 * Environment-variable compatibility shim (Amicus rebrand).
 *
 * DEPRECATED(amicus-shim): the SIDECAR_* fallbacks exist only for backward
 * compatibility with pre-rebrand setups. Remove in a future revision once users
 * have migrated to the AMICUS_* names. See docs/SHIMS.md.
 */
const { logger } = require('./logger');

const warned = new Set();

/**
 * Read an env var by its canonical AMICUS_<suffix> name, falling back to the
 * legacy SIDECAR_<suffix> name (with a one-time deprecation warning) if unset.
 *
 * @param {string} suffix - e.g. 'CONFIG_DIR' (no AMICUS_/SIDECAR_ prefix)
 * @returns {string|undefined}
 */
function getCompatEnv(suffix) {
  const amicusName = `AMICUS_${suffix}`;
  if (process.env[amicusName] !== undefined) {
    return process.env[amicusName];
  }
  const legacyName = `SIDECAR_${suffix}`;
  if (process.env[legacyName] !== undefined) {
    if (!warned.has(legacyName)) {
      warned.add(legacyName);
      logger.warn(
        `${legacyName} is deprecated; use ${amicusName} instead. ` +
        'Support will be removed in a future Amicus release.'
      );
    }
    return process.env[legacyName];
  }
  return undefined;
}

module.exports = { getCompatEnv };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/utils/env-compat.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Record the shim + commit**

Add to `docs/SHIMS.md` table: `| Env var prefix | src/utils/env-compat.js | SIDECAR_* env vars | next major |`

```bash
git add src/utils/env-compat.js tests/utils/env-compat.test.js docs/SHIMS.md
git commit -m "feat(rebrand): add getCompatEnv env-var shim helper"
```

---

## Task 3: Package identity + bins + bin entry file rename

**Files:**
- Modify: `package.json:2` (name), `package.json:23-26` (bin), `package.json:39` (start script)
- Rename: `bin/sidecar.js` → `bin/amicus.js`; `bin/sidecar` → `bin/amicus` (the wrapper)
- Modify references to the bin path: `src/mcp-server.js:55`, `package.json:39`
- Test: `tests/cli-process.integration.test.js:13` (bin path constant)

- [ ] **Step 1: Rename the bin entry files (preserve git history)**

```bash
git -C C:/Users/sendt/dev/amicus mv bin/sidecar.js bin/amicus.js
git -C C:/Users/sendt/dev/amicus mv bin/sidecar bin/amicus
```

- [ ] **Step 2: Update `package.json` name + bin map + start script**

In `package.json`, set:

```json
  "name": "amicus",
```

Replace the `bin` block (lines 23-26) with — canonical `amicus`/`am` plus deprecated `sidecar`/`claude-sidecar` shims, all pointing at the renamed entry:

```json
  "bin": {
    "amicus": "./bin/amicus.js",
    "am": "./bin/amicus.js",
    "sidecar": "./bin/amicus.js",
    "claude-sidecar": "./bin/amicus.js"
  },
```

Update the `start` script (line 39): `bin/sidecar.js` → `bin/amicus.js`.

- [ ] **Step 3: Update internal references to the bin path**

`src/mcp-server.js:55` — change `path.join(__dirname, '..', 'bin', 'sidecar.js')` to `'amicus.js'`:

```javascript
  const sidecarBin = path.join(__dirname, '..', 'bin', 'amicus.js');
```

(Leave the local variable name `sidecarBin` — internal, harmless; renaming it is optional cleanup.)

`tests/cli-process.integration.test.js:13` — update the bin constant:

```javascript
const AMICUS_BIN = path.join(__dirname, '..', 'bin', 'amicus.js');
```

…and update its single use on line 22 (`[SIDECAR_BIN, ...args]` → `[AMICUS_BIN, ...args]`).

- [ ] **Step 4: Verify the bins resolve and the suite is green**

Run: `node bin/amicus.js --help`
Expected: prints usage, exits 0 (text still says "sidecar" — fixed in Task 4).
Run: `npm run test:integration`
Expected: PASS (the integration test now points at `bin/amicus.js`).

- [ ] **Step 5: Record shim + commit**

Add to `docs/SHIMS.md`: `| CLI bins | package.json bin | sidecar, claude-sidecar commands | next major |`

```bash
git add package.json bin/ src/mcp-server.js tests/cli-process.integration.test.js docs/SHIMS.md
git commit -m "feat(rebrand): rename package to amicus, bins amicus/am (+sidecar shims)"
```

---

## Task 4: CLI self-identification (usage, version, messages)

**Files:**
- Modify: `src/cli.js` (`getUsage()`, lines 289-361)
- Modify: `bin/amicus.js` (version line ~60; update message ~52; comments ~4)
- Modify: `tests/cli-process.integration.test.js:36` (version assertion)

- [ ] **Step 1: Update the failing test first (version assertion)**

In `tests/cli-process.integration.test.js`, change line 36:

```javascript
    expect(stdout.trim()).toContain(`amicus v${VERSION}`);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest tests/cli-process.integration.test.js -t "prints version"`
Expected: FAIL (output still says `claude-sidecar v…`).

- [ ] **Step 3: Update `bin/amicus.js` version + update strings**

- Line ~3-4 comment: `Sidecar CLI Entry Point` → `Amicus CLI Entry Point`.
- Line ~60: `console.log(\`claude-sidecar v${VERSION}\`)` → `console.log(\`amicus v${VERSION}\`)`.
- Line ~52 stderr: `Run \`npm install -g claude-sidecar\` to upgrade.` → `Run \`npm install -g amicus\` to upgrade.`
- Line ~48: `process.env.SIDECAR_UPDATE_INFO` → set the canonical `AMICUS_UPDATE_INFO` (the Electron reader gets a fallback in Task 9):

```javascript
      process.env.AMICUS_UPDATE_INFO = JSON.stringify(cliUpdateInfo);
```

- [ ] **Step 4: Rewrite `getUsage()` in `src/cli.js`**

Replace every user-facing `sidecar` in the usage text (lines 289-361) with `amicus`. Exact replacements:
- `Usage: sidecar <command> [options]` → `Usage: amicus <command> [options]`
- `(see 'sidecar setup')` (line 306) → `(see 'amicus setup')`
- All five Examples (lines 355-360): `sidecar start…`, `sidecar list`, `sidecar resume abc123`, `sidecar read abc123 --conversation` → `amicus …`.
- Command descriptions that say "sidecar" as the product (e.g. `Launch a new sidecar`) → keep "sidecar" ONLY where it denotes the *spawned-conversation noun*; the maintainer may prefer "session". Default: `Launch a new sidecar` → `Launch a new amicus session`, `Show previous sidecars` → `Show previous sessions`, `Reopen a previous sidecar` → `Reopen a previous session`, `New sidecar building on previous` → `New session building on previous`, `Output sidecar summary/conversation` → `Output session summary/conversation`, `Abort a running sidecar session` → `Abort a running session`.

- [ ] **Step 5: Run tests to verify pass**

Run: `npx jest tests/cli-process.integration.test.js`
Expected: PASS (version + help tests green; `--help` asserts only on `Usage:`/`start`/`list`/`read`/`mcp`, all still present).

- [ ] **Step 6: Commit**

```bash
git add src/cli.js bin/amicus.js tests/cli-process.integration.test.js
git commit -m "feat(rebrand): amicus branding in CLI usage, version, and messages"
```

---

## Task 5: Config dir + env-var prefix (with shims)

**Files:**
- Modify: `src/utils/config.js:38-48` (`getConfigDir`)
- Modify: `src/utils/env-loader.js` (comments only; behavior unchanged — it reads the dir from config.js)
- Test: `tests/utils/config-dir.test.js` (new)

- [ ] **Step 1: Write the failing test**

Create `tests/utils/config-dir.test.js`:

```javascript
const fs = require('fs');
const os = require('os');
const path = require('path');

describe('getConfigDir (amicus rebrand + shim)', () => {
  let tmpHome;
  const orig = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-home-'));
    delete process.env.AMICUS_CONFIG_DIR;
    delete process.env.SIDECAR_CONFIG_DIR;
    process.env.HOME = tmpHome;
    process.env.USERPROFILE = tmpHome;
  });

  afterEach(() => {
    process.env = { ...orig };
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  const getConfigDir = () => require('../../src/utils/config').getConfigDir;

  it('defaults to ~/.config/amicus when no legacy dir exists', () => {
    expect(getConfigDir()()).toBe(path.join(tmpHome, '.config', 'amicus'));
  });

  it('falls back to ~/.config/sidecar when it exists and amicus does not', () => {
    fs.mkdirSync(path.join(tmpHome, '.config', 'sidecar'), { recursive: true });
    expect(getConfigDir()()).toBe(path.join(tmpHome, '.config', 'sidecar'));
  });

  it('prefers ~/.config/amicus when both exist', () => {
    fs.mkdirSync(path.join(tmpHome, '.config', 'sidecar'), { recursive: true });
    fs.mkdirSync(path.join(tmpHome, '.config', 'amicus'), { recursive: true });
    expect(getConfigDir()()).toBe(path.join(tmpHome, '.config', 'amicus'));
  });

  it('honors AMICUS_CONFIG_DIR override', () => {
    process.env.AMICUS_CONFIG_DIR = path.join(tmpHome, 'custom');
    expect(getConfigDir()()).toBe(path.join(tmpHome, 'custom'));
  });

  it('honors the legacy SIDECAR_CONFIG_DIR override (shim)', () => {
    process.env.SIDECAR_CONFIG_DIR = path.join(tmpHome, 'legacy-custom');
    expect(getConfigDir()()).toBe(path.join(tmpHome, 'legacy-custom'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/utils/config-dir.test.js`
Expected: FAIL (current default is `~/.config/sidecar`; no AMICUS handling).

- [ ] **Step 3: Rewrite `getConfigDir` in `src/utils/config.js`**

Replace lines 38-48 with:

```javascript
const { getCompatEnv } = require('./env-compat');

/** @returns {string} Config directory path */
function getConfigDir() {
  const override = getCompatEnv('CONFIG_DIR');
  if (override) {
    const resolved = path.resolve(override);
    if (resolved.includes('\0')) {
      throw new Error('Invalid AMICUS_CONFIG_DIR: null bytes not allowed');
    }
    return resolved;
  }
  const homeDir = process.env.HOME || process.env.USERPROFILE;
  const amicusDir = path.join(homeDir, '.config', 'amicus');
  // DEPRECATED(amicus-shim): fall back to the legacy ~/.config/sidecar dir if it
  // exists and the new one does not, so pre-rebrand credentials keep working.
  // Remove in a future revision — see docs/SHIMS.md.
  if (!fs.existsSync(amicusDir)) {
    const legacyDir = path.join(homeDir, '.config', 'sidecar');
    if (fs.existsSync(legacyDir)) {
      return legacyDir;
    }
  }
  return amicusDir;
}
```

(Put the `require('./env-compat')` line with the other requires at the top of the file, not inside the function.)

- [ ] **Step 4: Update comments referencing the old path**

`src/utils/env-loader.js` lines 5, 18 and `src/utils/config.js:1` — change prose `~/.config/sidecar` / "Sidecar Config Module" to mention `~/.config/amicus` (note the legacy fallback). No behavior change.

- [ ] **Step 5: Run tests to verify pass**

Run: `npx jest tests/utils/config-dir.test.js`
Expected: PASS (5 tests).
Run: `npm test`
Expected: PASS (no regressions — `config-change-flow.test.js` sets `SIDECAR_CONFIG_DIR` explicitly, still honored via the shim).

- [ ] **Step 6: Record shim + commit**

Add to `docs/SHIMS.md`: `| Config dir | src/utils/config.js getConfigDir | ~/.config/sidecar fallback | next major |`

```bash
git add src/utils/config.js src/utils/env-loader.js tests/utils/config-dir.test.js docs/SHIMS.md
git commit -m "feat(rebrand): default config dir to ~/.config/amicus with sidecar fallback"
```

---

## Task 6: Session directory dual-dir shim

**Files:**
- Modify: `src/session-manager.js:33-35` (`getSessionDir`) and JSDoc examples (31, 224)
- Modify inline session paths: `src/mcp-server.js:108`, `:334`, `:389`
- Modify: `src/utils/validators.js` (`safeSessionDir`) and `src/sidecar/session-utils.js` (`SessionPaths`) and `src/headless.js` — apply the same canonical-write/dual-read pattern (read each file first; the constant `'sidecar_sessions'` becomes a shared helper)
- Test: `tests/session-dir-shim.test.js` (new)

**Approach:** Add one canonical helper in `session-manager.js`, then route every session-path construction through it. New sessions are **written** to `.claude/amicus_sessions/`; **reads/lists** prefer `amicus_sessions` but transparently include the legacy `.claude/sidecar_sessions/` so existing sessions remain visible.

- [ ] **Step 1: Write the failing test**

Create `tests/session-dir-shim.test.js`:

```javascript
const fs = require('fs');
const os = require('os');
const path = require('path');
const sm = require('../src/session-manager');

describe('session dir shim', () => {
  let proj;
  beforeEach(() => { proj = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-sess-')); });
  afterEach(() => { fs.rmSync(proj, { recursive: true, force: true }); });

  it('getSessionDir returns the amicus_sessions path for writes', () => {
    expect(sm.getSessionDir(proj, 'abc')).toBe(
      path.join(proj, '.claude', 'amicus_sessions', 'abc')
    );
  });

  it('resolveExistingSessionDir prefers amicus_sessions', () => {
    const dir = path.join(proj, '.claude', 'amicus_sessions', 'abc');
    fs.mkdirSync(dir, { recursive: true });
    expect(sm.resolveExistingSessionDir(proj, 'abc')).toBe(dir);
  });

  it('resolveExistingSessionDir falls back to legacy sidecar_sessions', () => {
    const legacy = path.join(proj, '.claude', 'sidecar_sessions', 'abc');
    fs.mkdirSync(legacy, { recursive: true });
    expect(sm.resolveExistingSessionDir(proj, 'abc')).toBe(legacy);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest tests/session-dir-shim.test.js`
Expected: FAIL (`getSessionDir` still returns `sidecar_sessions`; `resolveExistingSessionDir` undefined).

- [ ] **Step 3: Implement the helper in `src/session-manager.js`**

Replace `getSessionDir` (lines 33-35) and add `resolveExistingSessionDir`:

```javascript
const SESSIONS_DIR = 'amicus_sessions';
// DEPRECATED(amicus-shim): legacy session dir read for pre-rebrand sessions.
// Remove in a future revision — see docs/SHIMS.md.
const LEGACY_SESSIONS_DIR = 'sidecar_sessions';

/** Canonical session dir for WRITES (new sessions). */
function getSessionDir(projectDir, taskId) {
  return path.join(projectDir, '.claude', SESSIONS_DIR, taskId);
}

/** Resolve an EXISTING session dir for reads: prefer amicus, fall back to legacy. */
function resolveExistingSessionDir(projectDir, taskId) {
  const current = getSessionDir(projectDir, taskId);
  if (fs.existsSync(current)) { return current; }
  const legacy = path.join(projectDir, '.claude', LEGACY_SESSIONS_DIR, taskId);
  if (fs.existsSync(legacy)) { return legacy; }
  return current; // default to the new path
}
```

Export both names plus the constants:

```javascript
module.exports = {
  // ...existing exports...
  getSessionDir,
  resolveExistingSessionDir,
  SESSIONS_DIR,
  LEGACY_SESSIONS_DIR,
};
```

- [ ] **Step 4: Route the other call sites through the helper**

- `src/mcp-server.js`: lines 108 and 389 (`path.join(cwd, '.claude', 'sidecar_sessions', taskId)`) become `require('./session-manager').getSessionDir(cwd, taskId)` (write paths → new dir). For the `sidecar_list` directory scan (line 334), list BOTH roots and merge:

```javascript
  const { SESSIONS_DIR, LEGACY_SESSIONS_DIR } = require('./session-manager');
  const roots = [SESSIONS_DIR, LEGACY_SESSIONS_DIR]
    .map(d => path.join(cwd, '.claude', d))
    .filter(fs.existsSync);
  if (roots.length === 0) { return textResult('No amicus sessions found.'); }
  // readdir across roots, dedupe by task id (amicus wins), then build `sessions`
```

  (Note the user-facing message becomes **"No amicus sessions found."** — Task 4 already aligned the CLI; this is the MCP path.)
- `src/utils/validators.js` `safeSessionDir`: read the file; replace its hardcoded `'sidecar_sessions'` with `resolveExistingSessionDir` semantics for read callers (status/read/abort) — these operate on existing sessions, so they must see legacy dirs.
- `src/sidecar/session-utils.js` `SessionPaths.sessionDir`: route to `getSessionDir` (writes) — confirm by reading the file; keep the public shape used by `tests/sidecar/start.test.js`.
- `src/headless.js:75`: replace the literal path with the helper.

- [ ] **Step 5: Update integration-test fixtures to prove the shim (not just rename)**

`tests/cli-process.integration.test.js` deliberately writes fixtures under `.claude/sidecar_sessions/` (lines 103, 135, 154, 186, 211). **Leave the existing `list`/`read`/`abort` fixtures on the legacy path** — they now exercise the read-shim and must still pass. Add ONE new test that writes under `.claude/amicus_sessions/` and asserts `list` finds it. The "No sidecar sessions" assertion (line 91) becomes:

```javascript
      expect(stdout).toContain('No amicus sessions');
```

- [ ] **Step 6: Run tests**

Run: `npm test && npm run test:integration`
Expected: PASS (legacy fixtures still found via shim; new amicus fixture found; empty message updated).

- [ ] **Step 7: Record shim + commit**

Add to `docs/SHIMS.md`: `| Session dir | src/session-manager.js + call sites | .claude/sidecar_sessions reads | next major |`

```bash
git add src/session-manager.js src/mcp-server.js src/utils/validators.js src/sidecar/session-utils.js src/headless.js tests/session-dir-shim.test.js tests/cli-process.integration.test.js docs/SHIMS.md
git commit -m "feat(rebrand): write amicus_sessions, read legacy sidecar_sessions (shim)"
```

---

## Task 7: Config-update token + hash-comment (dual-emit/parse shim)

**Files:**
- Modify: `src/utils/config.js:213` (`<!-- sidecar-config-hash: … -->`)
- Modify: `skill/SKILL.md` (the `[SIDECAR_CONFIG_UPDATE]` parser + the `sidecar-config-hash` reference, ~line 754)
- Modify: the stderr-marker emit site — **grep to locate** (`git grep -n "SIDECAR_CONFIG_UPDATE"`); it is NOT in `src/` per exploration, so it is emitted from a CLI path that builds the string. Update wherever found; if it genuinely does not exist in shipped code, add the canonical marker to the emit point in `src/sidecar/start.js` (read the file's config-change block first).
- Test: `tests/sidecar/config-change-flow.test.js`, `tests/sidecar/start.test.js`

**Decision:** canonical = `[AMICUS_CONFIG_UPDATE]` and `<!-- amicus-config-hash: … -->`. Shim = the parser (skill) and the hash extractor accept **both** old and new markers, so existing `CLAUDE.md` files with `sidecar-config-hash` still match (otherwise the first post-upgrade run would spuriously report "config changed").

- [ ] **Step 1: Update tests to expect the new canonical token (and keep a legacy-accepting case)**

In `tests/sidecar/config-change-flow.test.js`:
- The `extractHashFromClaudeMd` regex (line 50) must accept both: `/(?:amicus|sidecar)-config-hash: ([0-9a-f]+)/`.
- The emit string in `simulateConfigCheck` (line 65) and assertions (lines 103, 173, 198, 227, 252, 361, 371, 486) change `SIDECAR_CONFIG_UPDATE`→`AMICUS_CONFIG_UPDATE` and `sidecar-config-hash`→`amicus-config-hash`.
- Keep ONE test proving the legacy comment still matches:

```javascript
    it('still extracts a legacy sidecar-config-hash comment (shim)', () => {
      fs.writeFileSync(path.join(projectDir, 'CLAUDE.md'),
        '<!-- sidecar-config-hash: abcd1234 -->');
      expect(extractHashFromClaudeMd()).toBe('abcd1234');
    });
```

In `tests/sidecar/start.test.js` lines 51, 61, 74, 84-85, 92: `SIDECAR_CONFIG_UPDATE`→`AMICUS_CONFIG_UPDATE`; the `sidecar-config-hash` regex → dual-accepting form above.

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/sidecar/config-change-flow.test.js tests/sidecar/start.test.js`
Expected: FAIL (emit still uses the old marker).

- [ ] **Step 3: Update `src/utils/config.js`**

Line 213 — emit the canonical hash comment:

```javascript
  const hashComment = newHash ? `<!-- amicus-config-hash: ${newHash} -->` : '';
```

- [ ] **Step 4: Update the stderr marker emit site**

Run `git grep -n "SIDECAR_CONFIG_UPDATE"` (excluding tests/skill). Update the emit to `[AMICUS_CONFIG_UPDATE]`. If the only occurrences are in `skill/SKILL.md` and tests (i.e. the live emit is constructed elsewhere), read `src/sidecar/start.js`'s config-change block and ensure it writes `[AMICUS_CONFIG_UPDATE]` to stderr.

- [ ] **Step 5: Update the skill parser (shim: accept both)**

In `skill/SKILL.md` (~line 754), update the documented marker to `[AMICUS_CONFIG_UPDATE]` and make the parser/instructions accept either `amicus-config-hash` or `sidecar-config-hash` (dual-match), so existing `CLAUDE.md` files keep working.

- [ ] **Step 6: Run tests**

Run: `npx jest tests/sidecar/config-change-flow.test.js tests/sidecar/start.test.js`
Expected: PASS (including the legacy-accepting shim test).

- [ ] **Step 7: Record shim + commit**

Add to `docs/SHIMS.md`: `| Config token | config.js + skill parser | [SIDECAR_CONFIG_UPDATE] / sidecar-config-hash parse | next major |`

```bash
git add src/utils/config.js src/sidecar/start.js skill/SKILL.md tests/sidecar/
git commit -m "feat(rebrand): AMICUS_CONFIG_UPDATE token + amicus-config-hash (legacy parse shim)"
```

---

## Task 8: MCP server name + tool names + dual-registration shim

**Files:**
- Modify: `src/mcp-server.js:447` (server name), the `handlers` object keys (73-441), the in-text tool references in reminders (50-51) and messages, and the registration loop (449-462)
- Modify: `src/mcp-tools.js` (the `name:` of each tool, 33/117/134/152/167/189/224/232/248, and the `sidecar_*` references inside descriptions + guide text)
- Test: `tests/mcp-tool-aliases.test.js` (new)

**Decision:** canonical tool names `amicus_start`, `amicus_status`, `amicus_read`, `amicus_list`, `amicus_resume`, `amicus_continue`, `amicus_setup`, `amicus_abort`, `amicus_guide`; server name `amicus`. Shim = ALSO register each tool under its old `sidecar_*` name (same handler), so existing agent scripts keep working.

- [ ] **Step 1: Write the failing test**

Create `tests/mcp-tool-aliases.test.js`:

```javascript
const { getTools } = require('../src/mcp-tools');
const { handlers } = require('../src/mcp-server');

describe('MCP tool naming + alias shim', () => {
  it('canonical tools are amicus_*', () => {
    const names = getTools().map(t => t.name);
    expect(names).toContain('amicus_start');
    expect(names).toContain('amicus_guide');
    expect(names).not.toContain('sidecar_start'); // canonical list is amicus_*
  });

  it('handlers expose amicus_* keys', () => {
    expect(typeof handlers.amicus_start).toBe('function');
    expect(typeof handlers.amicus_status).toBe('function');
  });
});
```

(The registration-time alias is asserted indirectly; add a unit check that the alias map covers every canonical tool — see Step 4.)

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/mcp-tool-aliases.test.js`
Expected: FAIL (handlers/tools still `sidecar_*`).

- [ ] **Step 3: Rename in `src/mcp-tools.js` and `src/mcp-server.js`**

- `src/mcp-tools.js`: change each `name: 'sidecar_X'` → `name: 'amicus_X'`. Within descriptions + `getGuideText()`, replace user-facing `sidecar_status`/`sidecar_read`/`sidecar_guide`/`sidecar_list`/`sidecar_resume`/`sidecar_continue` references with the `amicus_*` equivalents, and prose "Sidecar"/"a sidecar" product references → "Amicus"/"an Amicus session" (keep the chat-skill noun where it reads naturally).
- `src/mcp-server.js`: rename the `handlers` object keys `sidecar_X` → `amicus_X` (73-440); update the two reminder constants (50-51) `sidecar_status` → `amicus_status`; server name (447) `'sidecar'` → `'amicus'`; the stderr banner (473) `[sidecar]` → `[amicus]`; `computeNextPoll` hint (45) `sidecar_status` → `amicus_status`.

- [ ] **Step 4: Add the dual-registration shim in `startMcpServer` (449-462)**

```javascript
  // DEPRECATED(amicus-shim): also register each tool under its legacy sidecar_*
  // name so existing agent scripts keep working. Remove in a future revision.
  const LEGACY_TOOL_ALIASES = {
    amicus_start: 'sidecar_start', amicus_status: 'sidecar_status',
    amicus_read: 'sidecar_read', amicus_list: 'sidecar_list',
    amicus_resume: 'sidecar_resume', amicus_continue: 'sidecar_continue',
    amicus_setup: 'sidecar_setup', amicus_abort: 'sidecar_abort',
    amicus_guide: 'sidecar_guide',
  };

  for (const tool of getTools()) {
    const register = (name) => server.registerTool(
      name,
      { description: tool.description, inputSchema: tool.inputSchema, annotations: tool.annotations },
      async (input) => {
        try { return await handlers[tool.name](input, getProjectDir(input.project)); }
        catch (err) {
          logger.error(`MCP tool error: ${name}`, { error: err.message });
          return textResult(`Error: ${err.message}`, true);
        }
      }
    );
    register(tool.name);
    if (LEGACY_TOOL_ALIASES[tool.name]) { register(LEGACY_TOOL_ALIASES[tool.name]); }
  }
```

- [ ] **Step 5: Run tests**

Run: `npx jest tests/mcp-tool-aliases.test.js && npm test`
Expected: PASS. Also sanity-check the server starts: `node bin/amicus.js mcp` should boot and print `[amicus] MCP server running on stdio` (Ctrl-C to exit).

- [ ] **Step 6: Record shim + commit**

Add to `docs/SHIMS.md`: `| MCP tool names | src/mcp-server.js registration | sidecar_* tool aliases | next major |`

```bash
git add src/mcp-tools.js src/mcp-server.js tests/mcp-tool-aliases.test.js docs/SHIMS.md
git commit -m "feat(rebrand): amicus_* MCP tools + server name (sidecar_* alias shim)"
```

---

## Task 9: Exported public API aliases

**Files:**
- Modify: `src/index.js` (add `*Amicus` exports as canonical; keep `*Sidecar` as deprecated aliases)
- Test: `tests/index-exports.test.js` (new)

**Note:** internal modules (`src/sidecar/start.js` etc.) keep their existing `startSidecar` implementation names — only the **public** `src/index.js` surface gets canonical `amicus` aliases, to avoid touching every internal caller in this slice.

- [ ] **Step 1: Write the failing test**

Create `tests/index-exports.test.js`:

```javascript
const api = require('../src/index');

describe('public API amicus aliases', () => {
  it('exposes canonical *Amicus names', () => {
    expect(typeof api.startAmicus).toBe('function');
    expect(typeof api.listAmicus).toBe('function');
    expect(typeof api.resumeAmicus).toBe('function');
    expect(typeof api.continueAmicus).toBe('function');
    expect(typeof api.readAmicus).toBe('function');
  });
  it('keeps legacy *Sidecar aliases pointing to the same fns (shim)', () => {
    expect(api.startAmicus).toBe(api.startSidecar);
    expect(api.listAmicus).toBe(api.listSidecars);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/index-exports.test.js`
Expected: FAIL (`startAmicus` undefined).

- [ ] **Step 3: Add aliases in `src/index.js`**

In the `module.exports` block, add the canonical names alongside the existing ones:

```javascript
  // Canonical Amicus public API (the *Sidecar names below are deprecated shims)
  startAmicus: startSidecar,
  listAmicus: listSidecars,
  resumeAmicus: resumeSidecar,
  continueAmicus: continueSidecar,
  readAmicus: readSidecar,
```

Add a `// DEPRECATED(amicus-shim): remove *Sidecar exports in a future revision — see docs/SHIMS.md` comment above the existing `startSidecar,` line. Update the file header (lines 1-5) "Claude Sidecar - Main Module" → "Amicus - Main Module".

- [ ] **Step 4: Run tests**

Run: `npx jest tests/index-exports.test.js && npm test`
Expected: PASS.

- [ ] **Step 5: Record shim + commit**

Add to `docs/SHIMS.md`: `| Public API | src/index.js | startSidecar/listSidecars/... aliases | next major |`

```bash
git add src/index.js tests/index-exports.test.js docs/SHIMS.md
git commit -m "feat(rebrand): canonical *Amicus public API (keep *Sidecar aliases)"
```

---

## Task 10: Electron app branding

**Files:**
- Modify: `electron/main.js:94` (window title), `:48-56` (env reads → compat), comments (2-9, 172, 351-356), `createSidecarWindow` (426)
- Modify: `electron/toolbar.js:16` (`getBrandName`), `:171` (tooltip), `:189/191/194/212/217` (window flag var names), comments (1-5)

**Note:** Electron is an optional dependency and the GUI hang (F2) is a *separate* plan; here we only rebrand strings/vars. There are no Electron unit tests asserting these, so verification is via grep + a manual title check (optional, GUI may hang on this machine — see project notes).

- [ ] **Step 1: Window title + brand**

- `electron/main.js:94`: `CLIENT === 'cowork' ? 'Openwork Sidecar' : 'Claude Sidecar'` → `'Openwork Amicus' : 'Amicus'`.
- `electron/toolbar.js:16`: `return client === 'cowork' ? 'Openwork Sidecar' : 'Claude Sidecar';` → `'Openwork Amicus' : 'Amicus';`
- Titles on `main.js:242` and `:398` use `getBrandName(CLIENT)` — automatically correct once `getBrandName` is updated.

- [ ] **Step 2: Env reads via the compat helper**

`electron/main.js:48-56` reads nine `SIDECAR_*` vars. Replace each `process.env.SIDECAR_X` with `getCompatEnv('X')` (add `const { getCompatEnv } = require('../src/utils/env-compat');` at the top). The corresponding **setters** must emit `AMICUS_*`: `src/mcp-server.js:66` (`SIDECAR_DEBUG_PORT` → `AMICUS_DEBUG_PORT`), `bin/amicus.js` (`AMICUS_UPDATE_INFO`, done in Task 4), and any `SIDECAR_MODE`/`SIDECAR_TASK_ID`/etc. setters in `src/sidecar/*` (grep `git grep -n "SIDECAR_[A-Z_]* ="` and `env: {.*SIDECAR_`). The reader's `getCompatEnv` keeps old setters working during transition.

- [ ] **Step 3: Internal var/comment renames**

`electron/toolbar.js`: `__sidecarToolbarAction`→`__amicusToolbarAction`, `__sidecarUpdateAction`→`__amicusUpdateAction` (lines 189, 191, 194, 212, 217 — rename in both the toolbar HTML/JS string and any `main.js` `executeJavaScript` that polls these flags; grep `git grep -n "__sidecar"`). Tooltip `:171` `sidecar resume` → `amicus resume`. `createSidecarWindow`→`createAmicusWindow` (`main.js:426` + its call sites; grep `git grep -n "createSidecarWindow"`). Header comments → "Amicus".

- [ ] **Step 4: Verify**

Run: `git grep -n "Claude Sidecar\|Openwork Sidecar\|__sidecar\|createSidecarWindow" electron/`
Expected: no matches.
Run: `npm test`
Expected: PASS (no electron unit tests regressed).

- [ ] **Step 5: Commit**

```bash
git add electron/ src/mcp-server.js
git commit -m "feat(rebrand): Amicus branding + AMICUS_* env in Electron shell"
```

---

## Task 11: Postinstall + updater (messages, npm name, MCP registration)

**Files:**
- Modify: `scripts/postinstall.js` (lines 4, 20, 58, 60, 69, 73, 81, 83, 85, 87, 103, 105, 107, 109, 114, 121)
- Modify: `src/utils/updater.js` (lines 4, 32 via compat, 97, 122)

- [ ] **Step 1: Postinstall — npm name, messages, MCP registration name (+ alias)**

- Line 4 comment, lines 58/60/73/83/85/87/105/107/109/114 console prefixes `[claude-sidecar]` → `[amicus]`.
- Line 20: `args: ['-y', 'claude-sidecar@latest', 'mcp']` → `'amicus@latest'`.
- Lines 69 + 81 + 103 register the MCP server under the name `'sidecar'`. Register under `'amicus'` AND keep registering `'sidecar'` as a deprecated duplicate so existing clients that reference `sidecar` keep resolving (shim). Minimal change: call `addMcpToConfigFile(path, 'amicus', MCP_CONFIG)` and also `addMcpToConfigFile(path, 'sidecar', MCP_CONFIG)`; for the CLI path (line 69) run `claude mcp add-json amicus …` (and best-effort `sidecar`). The skill install dir stays `~/.claude/skills/sidecar/` (line 17 — KEEP).
- Line 121: `Run \`sidecar setup\`` → `Run \`amicus setup\``.

- [ ] **Step 2: Updater — package name + messages**

- `src/utils/updater.js:122`: `spawn('npm', ['install', '-g', 'claude-sidecar@latest'], …)` → `'amicus@latest'`.
- Line 97: `Run \`sidecar update\`` → `Run \`amicus update\``.
- Line 32: `process.env.SIDECAR_MOCK_UPDATE` → `getCompatEnv('MOCK_UPDATE')` (add the require). This keeps `tests/updater.test.js` working if it sets `SIDECAR_MOCK_UPDATE`; if that test sets the env var, update it to `AMICUS_MOCK_UPDATE` OR rely on the shim — grep `git grep -n "SIDECAR_MOCK_UPDATE" tests/` and align.
- Line 4 comment → "amicus".

- [ ] **Step 3: Verify**

Run: `npm test`
Expected: PASS (updater tests green via the compat shim or updated env name).
Run: `node scripts/postinstall.js` in a scratch HOME (optional) — expect `[amicus]` messages and both `amicus`/`sidecar` MCP entries written.

- [ ] **Step 4: Record shim + commit**

Add to `docs/SHIMS.md`: `| MCP registration | scripts/postinstall.js | duplicate 'sidecar' server entry | next major |`

```bash
git add scripts/postinstall.js src/utils/updater.js tests/updater.test.js docs/SHIMS.md
git commit -m "feat(rebrand): amicus npm name + messages in postinstall/updater (sidecar MCP alias)"
```

---

## Task 12: User-facing docs, site, and assets

**Files (rename inventory — exact `claude-sidecar`/product `Sidecar` strings):**
- `README.md`: title (11), hero alt (15), `Sidecar opens…` (17), npm badge (23), TOC anchors (36, 56), `## What Is Sidecar?` (56) + narrative, `npm install -g claude-sidecar` (101, 470-473), `sidecar setup`/`sidecar start …` examples (113, 136, 166-182), command headers `### \`sidecar X\`` (221-325), MCP section product refs (401, 482). **KEEP** the upstream GitHub URLs (27-28, 502-503).
- `site/index.html`: `<title>` (6), `og:title` (8), social refs (10/16/18), npm links (293-294, 305-306, 334 install), narrative "sidecar"/"sidecars" product refs (466, 497, 538, 597-598), examples (711-751), output sample (753). **KEEP** GitHub links.
- `docs/architecture.md`, `docs/configuration.md`, `docs/troubleshooting.md`, `docs/usage.md`, `docs/testing.md`, `docs/electron-testing.md`, `docs/publishing.md`: update product/CLI refs and config-dir/env-var mentions (note the legacy fallback).
- Asset rename: `git mv docs/what-is-sidecar.svg docs/what-is-amicus.svg` (+ update refs in README/site); check `docs/hero.svg`, `docs/social-card.svg` for embedded "Claude Sidecar" text and update.
- `.github/workflows/publish.yml:53`: release-notes prompt `called claude-sidecar` → `called amicus`.

**Guidance:** these are user-facing identity strings — replace `claude-sidecar`→`amicus`, `Claude Sidecar`→`Amicus`, `Openwork Sidecar`→`Openwork Amicus`, and the `sidecar <cmd>` CLI examples→`amicus <cmd>`. Keep MCP tool names in docs as `amicus_*` (Task 8). Do NOT touch upstream attribution/URLs or the `sidecar` chat-skill name.

- [ ] **Step 1: Apply the README + site + docs renames** per the inventory above (read each file; replace identity strings; keep KEEP-list intact).

- [ ] **Step 2: Rename the asset + fix references**

```bash
git -C C:/Users/sendt/dev/amicus mv docs/what-is-sidecar.svg docs/what-is-amicus.svg
```
Then update every `what-is-sidecar.svg` reference (grep `git grep -n "what-is-sidecar"`).

- [ ] **Step 3: Acceptance gate — no stray user-facing product name**

Run: `git grep -n "claude-sidecar" -- README.md site/ docs/ .github/`
Expected: NO matches except intentional upstream references (the `jrenaldi79/sidecar` URLs). Manually confirm each remaining hit is a KEEP.
Run: `git grep -n "Claude Sidecar\|Openwork Sidecar"`
Expected: no matches anywhere.

- [ ] **Step 4: Commit**

```bash
git add README.md site/ docs/ .github/workflows/publish.yml
git commit -m "docs(rebrand): Amicus branding across README, site, docs, assets"
```

---

## Task 13: Skill launch commands (CLI invocations → amicus)

**Files:**
- `skill/SKILL.md`: header (24), install (31), `sidecar --version` (36), prose product refs (52), all `sidecar start … --no-ui` command examples (79, 112, 159, 165, 171, 189, 228, …). **KEEP** `name: sidecar` (line 2) and the skill's identity.
- `skills/second-opinion/SKILL.md:75`: `sidecar start --model <alias> --agent Plan --no-context --no-ui` → `amicus start …`. Grep the whole `skills/second-opinion/` tree for `sidecar ` CLI invocations and `claude-sidecar`.

**Guidance:** the **skills keep their names** (`sidecar` chat skill, `second-opinion` council). Only the **CLI commands they shell out to** change `sidecar`→`amicus` (and `npm install -g claude-sidecar`→`amicus`). The config-update token in `skill/SKILL.md` was handled in Task 7.

- [ ] **Step 1: Update `skill/SKILL.md`** — replace `sidecar <cmd>` CLI examples with `amicus <cmd>`, install line, `--version`, and product prose "Sidecar"→"Amicus". Leave `name: sidecar`, the TRIGGER block's skill identity, and `~/.claude/skills/sidecar/` references intact.

- [ ] **Step 2: Update `skills/second-opinion/**`** — `git grep -n "sidecar \|claude-sidecar" skills/second-opinion/`; change CLI invocations to `amicus`. (The council also drives sidecar via the MCP `amicus_*`/`sidecar_*` tools — both work post-Task-8.)

- [ ] **Step 3: Acceptance gate**

Run: `git grep -n "sidecar start\|sidecar list\|sidecar resume\|sidecar read\|sidecar setup\|npm install -g claude-sidecar" -- skill/ skills/`
Expected: no matches (all CLI examples now `amicus …`).
Run: `git grep -n "^name: sidecar" skill/SKILL.md`
Expected: still present (skill name KEPT).

- [ ] **Step 4: Commit**

```bash
git add skill/SKILL.md skills/second-opinion/
git commit -m "docs(rebrand): skill CLI invocations use amicus (skill names unchanged)"
```

---

## Task 14: Full verification, gates, and spec/backlog update

**Files:**
- Verify: full suite + lint
- Modify: `docs/SHIMS.md` (finalize), `docs/superpowers/specs/2026-06-07-amicus-product-design.md` (mark F6 rebrand done; add shim-removal backlog item)

- [ ] **Step 1: Full green suite + lint**

Run: `npm test`
Expected: PASS (≥ the Task 1 baseline count; new shim tests added).
Run: `npm run test:integration`
Expected: PASS.
Run: `npm run lint`
Expected: clean (fix any `no-unused-vars` from renamed identifiers).

- [ ] **Step 2: Identity acceptance gates (the spec's F6 bar)**

Run: `node bin/amicus.js --version` → prints `amicus v0.5.2`.
Run: `node bin/amicus.js --help` → usage says `amicus`, no `claude-sidecar`.
Run: `git grep -nI "claude-sidecar"` → every remaining hit is an intentional KEEP (upstream URL/attribution, `package-lock.json` transitive, or a shim alias string). Eyeball the list; there must be **no user-facing** `claude-sidecar`.
Run: `git grep -nI "Claude Sidecar\|Openwork Sidecar"` → no matches.

- [ ] **Step 3: Shim self-test (prove backward compat in one pass)**

- Legacy env: `AMICUS_CONFIG_DIR` unset, `SIDECAR_CONFIG_DIR=/tmp/x node bin/amicus.js list --cwd .` still honors the dir (one deprecation warning).
- Legacy sessions: a fixture under `.claude/sidecar_sessions/<id>/` is still listed by `amicus list`.
- Legacy MCP tool name `sidecar_start` is still registered (Task 8 test) and old `sidecar`/`claude-sidecar` bins still launch.

- [ ] **Step 4: Finalize `docs/SHIMS.md`** — confirm every shim from Tasks 2/3/5/6/7/8/9/11 has a row with a concrete location.

- [ ] **Step 5: Update the spec**

In `docs/superpowers/specs/2026-06-07-amicus-product-design.md`:
- §4 Progress: move "code rebrand" from *not done* to *done*; note shims pending removal.
- §6 F6: mark the rename acceptance criterion met.
- §7 backlog: add **"Remove Amicus compatibility shims (see docs/SHIMS.md) in a future revision once users migrate."**

- [ ] **Step 6: Commit + finish the branch**

```bash
git add docs/SHIMS.md docs/superpowers/specs/2026-06-07-amicus-product-design.md
git commit -m "chore(rebrand): finalize shim inventory + mark F6 rebrand done in spec"
```

Then use **superpowers:finishing-a-development-branch** to decide merge/PR/cleanup for `rebrand/amicus`.

---

## Self-review (completed by plan author)

- **Spec coverage (F6 rebrand):** npm name (T3), CLI bins amicus/am (T3), CLI/usage/version branding (T4), README/site/docs (T12), skill launch commands (T13), MCP registration (T11), Electron branding (T10), one-step install messages (T11). Deep-rename internals chosen by the user: env vars (T2/T5/T10), config dir (T5), session dir (T6), config token (T7), MCP tool names (T8), exported fns (T9) — each with a shim. ✅ The broader one-step `setup` install (F6's installer) beyond messaging is its own plan (the spec lists it under F6 install + F5 catalog seeding) — flagged, not silently dropped.
- **Type/name consistency:** `getCompatEnv(suffix)` (T2) is reused in T5/T10/T11. `getSessionDir`/`resolveExistingSessionDir`/`SESSIONS_DIR` (T6) are referenced consistently in T6 call sites. Canonical tool names `amicus_*` and the `LEGACY_TOOL_ALIASES` map (T8) match the handler keys renamed in the same task. Public aliases `startAmicus`→`startSidecar` (T9) match `src/index.js` symbols.
- **No placeholders:** behavioral code (env shim, config dir, session helper, MCP alias loop, export aliases) and the affected tests are shown in full; bulk branding is given as exact file:line inventories + `git grep` acceptance gates rather than guessed line content (the executing subagent reads each file before editing).
- **Known unread internals** (`src/utils/validators.js` safeSessionDir, `src/sidecar/session-utils.js`, `src/sidecar/start.js`, `src/cli-handlers.js`): each relevant task instructs reading the file first and applies a pattern defined earlier in the plan — no invented signatures.
