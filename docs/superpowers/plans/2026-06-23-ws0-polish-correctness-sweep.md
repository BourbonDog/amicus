# WS-0 Polish & Correctness Sweep — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land six small, independent correctness/security/brand fixes that remove "half-finished" seams from the Amicus user surface.

**Architecture:** Each task is a self-contained, test-first change to one concern. No shared new modules; all edits are localized to existing files. Several existing tests assert the *old* "sidecar" strings and are updated within the task that changes the corresponding source.

**Tech Stack:** Node.js (≥18), Jest, ESLint. Windows-first (`process.platform`-aware where relevant).

## Global Constraints

- **Preserve legacy back-compat (SHIMS.md):** never modify the `src/sidecar/` module dir/import paths, `getCompatEnv`/env shims, the dual-registered `sidecar_*` MCP tool aliases, or the `sidecar` chat skill. Only user-facing *output strings* change.
- **No runtime dependency changes.** Task 6 touches dev-deps only.
- **Brand sweep = user-facing output only.** Do NOT touch JSDoc/comments (except `config.js:96`, which documents a string being changed) or model-prompt scaffolding (`continue.js`/`resume.js` "Sidecar" text is injected into model context — out of scope).
- **Gate every task before commit:** `npm test` green (baseline ~1925 pass / 4 skip / 0 fail) and `npm run lint` clean. Run from the worktree root `C:\Users\sendt\dev\amicus-ws0`.
- **Worktree:** branch `ws0/polish-correctness-sweep`, local-only — no push/PR until the owner OKs.

---

### Task 1: `-1` "variable pricing" sentinel renders as `—`

**Files:**
- Modify: `src/sidecar/models.js:23-28` (`perMtok`)
- Test: `tests/sidecar/models-command.test.js` (add one case)

- [ ] **Step 1: Write the failing test** — add inside the existing `describe('amicus models', ...)` block:

```js
it('renders the -1 variable-pricing sentinel as — not a negative price', async () => {
  const catalog = [
    { id: 'openrouter/acme/variable', name: 'Variable', contextLength: 1000,
      pricing: { prompt: '-1', completion: '-1' } },
  ];
  const { handleModels } = loadHandler({ catalog });
  const { code, out } = await captureStdout(() => handleModels({ _: ['models'] }));
  expect(code).toBe(0);
  expect(out).toContain('$/Mtok in — out —');
  expect(out).not.toContain('-1000000');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest tests/sidecar/models-command.test.js -t "variable-pricing sentinel"`
Expected: FAIL — output contains `-1000000.00`, not `—`.

- [ ] **Step 3: Implement the minimal fix** — replace `perMtok` (`src/sidecar/models.js:23-28`):

```js
/** '0.000003' per token → '3.00' per Mtok; '—' when unknown or variable (-1) */
function perMtok(perToken) {
  if (perToken === null || perToken === undefined) { return '—'; }
  const n = Number(perToken);
  if (Number.isNaN(n) || n < 0) { return '—'; }
  return (n * 1e6).toFixed(2);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest tests/sidecar/models-command.test.js -t "variable-pricing sentinel"`
Expected: PASS.

- [ ] **Step 5: Gate + commit**

```bash
npm test && npm run lint
git add src/sidecar/models.js tests/sidecar/models-command.test.js
git commit -m "fix(models): render -1 variable-pricing sentinel as — not a negative price"
```

---

### Task 2: `amicus models` marks the user's *effective* aliases

**Files:**
- Modify: `src/sidecar/models.js:4,39-47` (`aliasMarks` + two doc comments)
- Test: `tests/sidecar/models-command.test.js` (add one case)

**Interfaces:**
- Consumes: `getEffectiveAliases()` from `src/utils/config.js` (already exported, line 287).

- [ ] **Step 1: Write the failing test** — add inside `describe('amicus models', ...)`:

```js
it('marks rows using the user\'s effective aliases, not curated defaults', async () => {
  jest.resetModules();
  jest.doMock('../../src/utils/model-catalog', () => ({
    getCatalogInfo: jest.fn(async () => ({
      models: [
        { id: 'openrouter/x-ai/grok-4.3', name: 'Grok 4.3', contextLength: 256000, pricing: null },
      ],
      fetchedAt: 1718000000000,
    })),
    refreshCatalog: jest.fn(async () => []),
    catalogPath: () => 'C:/fake/model-catalog.json',
  }));
  jest.doMock('../../src/utils/config', () => ({
    getEffectiveAliases: () => ({ myalias: 'openrouter/x-ai/grok-4.3' }),
    getDefaultAliases: () => ({ gemini: 'openrouter/google/not-in-catalog' }),
  }));
  const { handleModels } = require('../../src/sidecar/models');
  const { code, out } = await captureStdout(() => handleModels({ _: ['models'] }));
  expect(code).toBe(0);
  expect(out).toContain('[myalias] openrouter/x-ai/grok-4.3');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest tests/sidecar/models-command.test.js -t "effective aliases"`
Expected: FAIL — current code reads `getDefaultAliases()` (which maps to `not-in-catalog`), so the grok row is unmarked.

- [ ] **Step 3: Implement the minimal fix** — replace `aliasMarks` (`src/sidecar/models.js:39-47`):

```js
/** alias marks: id → comma-joined alias names (effective user aliases) */
function aliasMarks() {
  const { getEffectiveAliases } = require('../utils/config');
  const map = new Map();
  for (const [alias, model] of Object.entries(getEffectiveAliases())) {
    map.set(model, map.has(model) ? `${map.get(model)},${alias}` : alias);
  }
  return map;
}
```

Then fix the two stale doc comments: line 4 `list (curated aliases marked)` → `list (effective aliases marked)`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest tests/sidecar/models-command.test.js -t "effective aliases"`
Expected: PASS.

- [ ] **Step 5: Gate + commit**

```bash
npm test && npm run lint
git add src/sidecar/models.js tests/sidecar/models-command.test.js
git commit -m "fix(models): mark effective user aliases, not curated defaults"
```

---

### Task 3: Platform-correct, in-product missing-key error

**Files:**
- Modify: `src/utils/validators.js:261-271` (`validateApiKey` missing-key branch)
- Modify: `tests/env-loader.test.js:171-180` (existing test asserts the old macOS/zsh message)
- Test: `tests/utils/validators-apikey.test.js` (new)

**Interfaces:**
- Consumes: `provider` (line 254, `model.split('/')[0].toLowerCase()`) and `providerInfo = PROVIDER_KEY_MAP[provider]` (`{ key, name }`).

- [ ] **Step 1: Write the failing test** — create `tests/utils/validators-apikey.test.js`:

```js
const { validateApiKey } = require('../../src/utils/validators');

describe('validateApiKey missing-key message', () => {
  const KEY = 'GOOGLE_GENERATIVE_AI_API_KEY';
  let savedEnv, savedPlatform;

  beforeEach(() => {
    savedEnv = process.env[KEY];
    delete process.env[KEY];
    savedPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  });
  afterEach(() => {
    if (savedEnv === undefined) { delete process.env[KEY]; } else { process.env[KEY] = savedEnv; }
    Object.defineProperty(process, 'platform', savedPlatform);
  });
  const setPlatform = (p) =>
    Object.defineProperty(process, 'platform', { value: p, configurable: true });

  it('leads with the in-product `amicus key <provider>` fix and drops legacy brand', () => {
    setPlatform('linux');
    const r = validateApiKey('google/gemini-3.5-flash');
    expect(r.valid).toBe(false);
    expect(r.error).toContain('GOOGLE_GENERATIVE_AI_API_KEY not found');
    expect(r.error).toContain('amicus key google');
    expect(r.error).not.toMatch(/sidecar/i);
  });

  it('shows Windows-correct persistence on win32 (setx, no ~/.zshrc)', () => {
    setPlatform('win32');
    const r = validateApiKey('google/gemini-3.5-flash');
    expect(r.error).toContain('setx GOOGLE_GENERATIVE_AI_API_KEY');
    expect(r.error).not.toContain('~/.zshrc');
    expect(r.error).not.toContain('~/.zshenv');
  });

  it('shows shell-rc guidance on non-Windows', () => {
    setPlatform('darwin');
    const r = validateApiKey('google/gemini-3.5-flash');
    expect(r.error).toContain('~/.zshenv');
    expect(r.error).not.toContain('setx');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest tests/utils/validators-apikey.test.js`
Expected: FAIL — current message says `sidecar setup`, hardcodes `~/.zshenv` on all platforms, never mentions `amicus key`.

- [ ] **Step 3: Implement the rewrite** — replace `src/utils/validators.js:261-271`:

```js
  if (!process.env[providerInfo.key]) {
    const keyName = providerInfo.key;
    const isWin = process.platform === 'win32';
    const persist = isWin
      ? `  - Persist it for new shells: setx ${keyName} <your-key>\n` +
        `    (or add $env:${keyName} to your PowerShell $PROFILE)\n`
      : `  - Persist it across shells: add 'export ${keyName}=<your-key>' to ~/.zshenv\n` +
        '    (non-interactive shells like Claude Code and CI do not source ~/.zshrc)\n';
    return {
      valid: false,
      error:
        `Error: ${keyName} not found for ${providerInfo.name}.\n\n` +
        'Fix with one of:\n' +
        `  - Store it in Amicus (recommended): amicus key ${provider} <your-key>\n` +
        persist +
        '  - Or add it to ~/.local/share/opencode/auth.json\n',
    };
  }
```

- [ ] **Step 4: Update the coupled existing test** — `tests/env-loader.test.js:177-179`, replace the three assertions with:

```js
      expect(result.error).toContain('OPENROUTER_API_KEY not found');
      expect(result.error).toContain('amicus key openrouter');
      expect(result.error).toMatch(
        process.platform === 'win32' ? /setx OPENROUTER_API_KEY/ : /~\/\.zshenv/
      );
```

- [ ] **Step 5: Run both test files to verify they pass**

Run: `npx jest tests/utils/validators-apikey.test.js tests/env-loader.test.js`
Expected: PASS.

- [ ] **Step 6: Gate + commit**

```bash
npm test && npm run lint
git add src/utils/validators.js tests/utils/validators-apikey.test.js tests/env-loader.test.js
git commit -m "fix(validators): platform-correct missing-key error leading with amicus key"
```

---

### Task 4: Secret-scan coverage for Google / OpenAI / DeepSeek

**Files:**
- Modify: `scripts/check-secrets.js:17-23` (`CONFIG.patterns`)
- Test: `tests/scripts/check-secrets.test.js` (add cases)

**Design note:** OpenAI-legacy and DeepSeek both use a bare `sk-` + alphanumeric run; one shared pattern covers both. It cannot match `sk-or-`/`sk-ant-`/`sk-proj-` because each has a hyphen within the first few chars that breaks the `{32,}` alphanumeric run. The mandatory negative tests prove this.

- [ ] **Step 1: Write the failing tests** — add inside `describe('scanForSecrets', ...)`:

```js
it('detects Google AI API keys', () => {
  const results = scanForSecrets('KEY=' + 'AIza' + 'B'.repeat(35), '.env');
  expect(results.some(r => r.pattern === 'AIza')).toBe(true);
});

it('detects OpenAI project keys', () => {
  const results = scanForSecrets('OPENAI=' + 'sk-proj-' + 'a'.repeat(40), '.env');
  expect(results.some(r => r.pattern === 'sk-proj-')).toBe(true);
  expect(results.some(r => r.pattern === 'sk-')).toBe(false);
});

it('detects OpenAI-legacy / DeepSeek bare sk- keys', () => {
  const legacy = scanForSecrets('OPENAI=' + 'sk-' + 'a'.repeat(48), '.env');
  expect(legacy.some(r => r.pattern === 'sk-')).toBe(true);
  const deepseek = scanForSecrets('DEEPSEEK=' + 'sk-' + 'b'.repeat(32), '.env');
  expect(deepseek.some(r => r.pattern === 'sk-')).toBe(true);
});

it('does NOT cross-match sk-or- / sk-ant- as bare sk- keys', () => {
  const orRes = scanForSecrets('K=sk-or-v1-abc123def456ghijkl', '.env');
  expect(orRes.some(r => r.pattern === 'sk-or-')).toBe(true);
  expect(orRes.some(r => r.pattern === 'sk-')).toBe(false);

  const antRes = scanForSecrets('K=sk-ant-' + 'a'.repeat(40), '.env');
  expect(antRes.some(r => r.pattern === 'sk-ant-')).toBe(true);
  expect(antRes.some(r => r.pattern === 'sk-')).toBe(false);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx jest tests/scripts/check-secrets.test.js -t "Google AI|OpenAI|DeepSeek|cross-match"`
Expected: FAIL — patterns `AIza` / `sk-proj-` / `sk-` don't exist yet.

- [ ] **Step 3: Add the patterns** — append to `CONFIG.patterns` (`scripts/check-secrets.js`, after the existing five, before the closing `]`):

```js
    { regex: /AIza[0-9A-Za-z\-_]{35}/g, name: 'AIza', description: 'Google AI API key' },
    { regex: /sk-proj-[A-Za-z0-9_-]{20,}/g, name: 'sk-proj-', description: 'OpenAI project API key' },
    { regex: /sk-[A-Za-z0-9]{32,}/g, name: 'sk-', description: 'OpenAI/DeepSeek API key' },
```

- [ ] **Step 4: Run the new + existing secret tests to verify all pass**

Run: `npx jest tests/scripts/check-secrets.test.js`
Expected: PASS (all new cases plus the five pre-existing patterns).

- [ ] **Step 5: Gate + commit**

```bash
npm test && npm run lint
git add scripts/check-secrets.js tests/scripts/check-secrets.test.js
git commit -m "feat(check-secrets): scan for Google/OpenAI/DeepSeek keys without sk-or/sk-ant collision"
```

---

### Task 5: User-facing brand sweep (`sidecar setup`/`abort` → `amicus`)

**Files:**
- Modify (source): `src/cli-handlers.js:100`, `src/utils/alias-resolver.js:70`, `src/utils/config.js:96,127,134,156`, `src/sidecar/setup.js:171,184`
- Modify (coupled tests): `tests/config.test.js:276`, `tests/config-resolve.test.js` (3 sites), `tests/mcp-model-validation.test.js` (3 sites)

- [ ] **Step 1: Enumerate every site (source + tests)**

Run: `grep -rn "sidecar setup\|Usage: sidecar\|Sidecar Setup Wizard" src tests`
Expected: the source sites above + test assertions in `config.test.js`, `config-resolve.test.js`, `mcp-model-validation.test.js`. (Confirms nothing new crept in.)

- [ ] **Step 2: Apply the source edits**

- `src/cli-handlers.js:100` → `console.error('Usage: amicus abort <task_id>');`
- `src/utils/alias-resolver.js:70` → `` `Fix with: amicus setup --add-alias ${alias}=provider/model` ``
- `src/utils/config.js:96` (comment) → `* 3. If modelArg is unknown alias -> throw Error mentioning 'amicus setup'`
- `src/utils/config.js:127` → `` `Unknown model alias '${modelArg}'. Run 'amicus setup' to configure aliases.` ``
- `src/utils/config.js:134` → `'No model specified and no default configured. Run \'amicus setup\' to set a default model.'`
- `src/utils/config.js:156` → `` `Default alias '${defaultValue}' not found in aliases. Run 'amicus setup' to fix configuration.` ``
- `src/sidecar/setup.js:171` → `console.log('=== Amicus Setup Wizard ===');`
- `src/sidecar/setup.js:184` → `console.log('Set OPENROUTER_API_KEY to get started, or run: amicus setup');`

- [ ] **Step 3: Update the coupled tests** (replace each `sidecar setup` → `amicus setup`, and `/sidecar setup/i` → `/amicus setup/i`, including `it`/`test` descriptions):

- `tests/config.test.js:276` → `expect(result.error.toLowerCase()).toContain('amicus setup');`
- `tests/config-resolve.test.js` — both `expect(() => config.resolveModel(...)).toThrow(/amicus setup/i)` sites (lines ~67 and ~149) and the `it('should throw Error mentioning amicus setup ...')` description (line ~60).
- `tests/mcp-model-validation.test.js` — both `.toContain('amicus setup')` sites (lines ~78 and ~148) and the `test('returns isError with amicus setup hint', ...)` description (line ~62).

Verify none remain:

Run: `grep -rn "sidecar setup" src tests`
Expected: no output (the `src/sidecar/` module name and SHIMS surfaces contain no "sidecar setup" literal).

- [ ] **Step 4: Manual smoke for the readline wizard header** (no unit test — `runInteractiveSetup` is interactive):

Run: `node bin/amicus.js setup` then immediately Ctrl-C after the header prints.
Expected: header reads `=== Amicus Setup Wizard ===`.

- [ ] **Step 5: Gate + commit**

```bash
npm test && npm run lint
git add src/cli-handlers.js src/utils/alias-resolver.js src/utils/config.js src/sidecar/setup.js tests/config.test.js tests/config-resolve.test.js tests/mcp-model-validation.test.js
git commit -m "refactor(brand): replace user-facing 'sidecar' command hints with 'amicus'"
```

---

### Task 6: Clear the dev-only `ws@7` audit high

**Files:**
- Modify: `package-lock.json` (and `package.json` only if `npm audit fix` changes a dev range)

- [ ] **Step 1: Capture the baseline**

Run: `npm audit`
Expected: note the `high` count and confirm `ws` (via `chrome-remote-interface`) appears, in the **dev** tree.

- [ ] **Step 2: Attempt a non-breaking fix**

Run: `npm audit fix` (NOT `--force`)
Expected: `ws` bumped within a compatible range, or a message that it needs a breaking change.

- [ ] **Step 3: Decision branch**
  - If `npm audit fix` resolved it without `--force`: continue.
  - If it would require a breaking major (`--force`): **do not force.** Instead add a one-line note under issue #17 tracking (e.g. in `docs/` troubleshooting or a code comment near the dev-dep) and stop after documenting — leave deps unchanged.

- [ ] **Step 4: Verify nothing broke**

Run: `npm audit && npm test`
Expected: `high` count decreased (or residual documented); full suite green.

- [ ] **Step 5: Commit**

```bash
git add package-lock.json package.json
git commit -m "chore(deps): npm audit fix for dev-only ws@7 high (refs #17)"
```

---

## Self-Review

**Spec coverage:** Item 2 → Task 1 ✓; Item 1 → Task 2 ✓; Item 3 → Task 3 ✓; Item 4 → Task 4 ✓; Item 5 → Task 5 ✓; Item 6 → Task 6 ✓. Spec's "preserve SHIMS" and "no runtime dep change" → Global Constraints ✓. Spec's manual-smoke verification (items 1 & 3) covered by Task 2/Task 3 tests + Task 5 Step 4 wizard smoke.

**Placeholder scan:** all code/test steps contain literal content; Task 5 test-update lines cite approximate line numbers (~60/~149/~62/~148) because exact lines shift as edits land, but each is pinned by an exact old→new token and a `grep` enumeration step, not a vague directive. Task 6 is a command task with an explicit decision branch (no forced breaking change).

**Type/name consistency:** `getEffectiveAliases` (Task 2) matches the export at `config.js:287`; `validateApiKey` (Task 3) matches the export at `validators.js:293`; `aliasMarks`/`perMtok` names unchanged; pattern `name` fields (`AIza`/`sk-proj-`/`sk-`) consistent between Task 4 impl and tests.

**Coupling captured:** every existing test asserting an old "sidecar" string is updated in the same task that changes its source (env-loader→Task 3; config/config-resolve/mcp-model-validation→Task 5).
