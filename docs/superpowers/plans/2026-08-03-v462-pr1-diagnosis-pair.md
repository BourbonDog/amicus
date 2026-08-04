# v4.6.2 PR1 — "the diagnosis pair" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ship spec §4 — the `ANTHROPIC_BASE_URL` doctor check + announced provider-config
normalization (items 1/R1, D1, D2) and the stored-alias drift warning (item 2A, D3).

**Architecture:** one new pure util (`base-url-classify.js`: classify + override decision +
once-per-process notice), one new doctor-check module (`doctor-base-url-check.js`, the
`doctor-mcp-checks.js` pattern) registered in `runDoctorChecks`, one insertion in
`buildServerOptions` (`opencode-client.js`, grandfathered) that carries the normalized URL as
`config.provider.anthropic.options.baseURL` — **config-level, no process env is ever written**
(refines spec D2: same user-visible effect, zero env mutation) — and one new audit function
(`findDriftedStoredAliases`) wired into the two existing audit consumers (`models --check`,
doctor `aliases` row).

**Tech Stack:** Node 18 CommonJS, jest, house patterns only (guard() doctor rows, `Notice: `
stderr convention, `options._*` test seams, lazy `require` inside functions).

**Spec:** `docs/superpowers/specs/2026-08-03-v462-field-report-five-design.md` (§4, R1, D1–D3).

## Global Constraints

- TDD: every behavior lands with its failing test first (spec §9).
- Verifiable voice: the doctor row states only what it string-inspected (BACKLOG ruling).
- One notice per process; `Notice: ` prefix on stderr (house convention).
- `AMICUS_BASE_URL_NORMALIZE=0` disables normalization (D1); default is ON.
- Drift resolution goes through `toStorableRoute()` — never bare `toCanonicalDefault()` (D3).
- Drift never changes `models --check`'s exit code (mirrors `buildFallbackDriftReport`'s
  "Never affects the exit code" contract at `src/sidecar/models.js:189`).
- Size gates: `cli-handlers-doctor.js` starts at 274/300 (+~14 planned ≈ 288 — verify with
  `npm run check:sizes` after Task 4; if a task lands it ≥293, extract into
  `doctor-mcp-checks.js` FIRST). `models.js` starts 217/300, `alias-audit.js` 111/300.
  `opencode-client.js` is on the grandfathered exclude list.
- After adding any new `src/` module: `node scripts/generate-docs.js` before committing, or
  the docs gate fails (Task 5 runs it).
- Commits: conventional prefixes; end every commit message with
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: `base-url-classify` util

**Files:**
- Create: `src/utils/base-url-classify.js`
- Test: `tests/base-url-classify.test.js`

**Interfaces:**
- Consumes: nothing (pure module; lazy-requires `./logger` only inside the announcer).
- Produces: `classifyBaseUrl(value) -> {form: 'absent'|'host'|'v1'|'other', normalized: string|null}`;
  `resolveBaseUrlOverride(env) -> string|null`;
  `announceBaseUrlNormalizationOnce(value, normalized, deps?) -> void`;
  `_resetBaseUrlNotice() -> void` (test seam). Tasks 2 and 3 import these exact names.

- [ ] **Step 1: Write the failing test**

Create `tests/base-url-classify.test.js`:

```js
'use strict';

const {
  classifyBaseUrl, resolveBaseUrlOverride,
  announceBaseUrlNormalizationOnce, _resetBaseUrlNotice,
} = require('../src/utils/base-url-classify');

describe('classifyBaseUrl', () => {
  test.each([undefined, null, '', '   '])('absent for %p', (v) => {
    expect(classifyBaseUrl(v)).toEqual({ form: 'absent', normalized: null });
  });

  test('host form: bare origin', () => {
    expect(classifyBaseUrl('https://api.anthropic.com'))
      .toEqual({ form: 'host', normalized: 'https://api.anthropic.com/v1' });
  });

  test('host form: trailing slash is not doubled', () => {
    expect(classifyBaseUrl('https://proxy.corp/'))
      .toEqual({ form: 'host', normalized: 'https://proxy.corp/v1' });
  });

  test('host form: value is trimmed', () => {
    expect(classifyBaseUrl(' https://api.anthropic.com ').normalized)
      .toBe('https://api.anthropic.com/v1');
  });

  test.each(['https://x.test/v1', 'https://x.test/v1/', 'https://gw.test/api/v1'])(
    'v1 form passes through: %s', (v) => {
      expect(classifyBaseUrl(v)).toEqual({ form: 'v1', normalized: null });
    });

  test.each(['https://x.test/api', 'https://x.test/v2', 'not a url at all'])(
    'other form passes through: %s', (v) => {
      expect(classifyBaseUrl(v)).toEqual({ form: 'other', normalized: null });
    });
});

describe('resolveBaseUrlOverride', () => {
  test('host-form env yields the normalized override', () => {
    expect(resolveBaseUrlOverride({ ANTHROPIC_BASE_URL: 'https://api.anthropic.com' }))
      .toBe('https://api.anthropic.com/v1');
  });

  test.each([
    [{}, 'unset'],
    [{ ANTHROPIC_BASE_URL: 'https://x.test/v1' }, 'already /v1'],
    [{ ANTHROPIC_BASE_URL: 'https://x.test/custom' }, 'nonstandard path'],
    [{ ANTHROPIC_BASE_URL: 'https://api.anthropic.com', AMICUS_BASE_URL_NORMALIZE: '0' }, 'knob off'],
  ])('null when %j (%s)', (env) => {
    expect(resolveBaseUrlOverride(env)).toBeNull();
  });
});

describe('announceBaseUrlNormalizationOnce', () => {
  beforeEach(() => _resetBaseUrlNotice());

  test('writes one Notice line, once per process', () => {
    const writes = [];
    const deps = { write: s => writes.push(s), logger: { info: () => {} } };
    announceBaseUrlNormalizationOnce('https://h', 'https://h/v1', deps);
    announceBaseUrlNormalizationOnce('https://h', 'https://h/v1', deps);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatch(/^Notice: ANTHROPIC_BASE_URL is host-form/);
    expect(writes[0]).toContain('https://h/v1');
    expect(writes[0]).toContain('AMICUS_BASE_URL_NORMALIZE=0');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/base-url-classify.test.js`
Expected: FAIL — `Cannot find module '../src/utils/base-url-classify'`

- [ ] **Step 3: Write the implementation**

Create `src/utils/base-url-classify.js`:

```js
/**
 * @module base-url-classify
 * v4.6.2 PR1 (spec §4, D1/D2): ANTHROPIC_BASE_URL classification, the
 * normalization decision, and the once-per-process notice.
 *
 * The convention split (field-proven by a control pair on run 0084d48c):
 * Anthropic SDKs — including Claude Code itself — treat the var as a HOST and
 * append /v1 themselves; OpenCode's provider layer treats it as the FULL
 * prefix and appends /messages. A host-form value is therefore correct for
 * Claude Code and fatal for every OpenCode direct-anthropic leg
 * (host/messages -> 404 "Not Found").
 *
 * Forms: absent (unset/blank) · host (path '' or '/') · v1 (path ends /v1)
 * · other (any other path, or unparseable — passed through untouched; an
 * exotic proxy serving /messages at a custom root stays possible, D1).
 */
'use strict';

/** @param {string|undefined|null} value @returns {{form:string, normalized:string|null}} */
function classifyBaseUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    return { form: 'absent', normalized: null };
  }
  const trimmed = value.trim();
  let url;
  try { url = new URL(trimmed); } catch { return { form: 'other', normalized: null }; }
  const path = url.pathname.replace(/\/+$/, '');
  if (path === '') {
    return { form: 'host', normalized: trimmed.replace(/\/+$/, '') + '/v1' };
  }
  if (path.endsWith('/v1')) { return { form: 'v1', normalized: null }; }
  return { form: 'other', normalized: null };
}

/**
 * The baseURL override the OpenCode server config should carry, or null.
 * Null when: var absent, already /v1, nonstandard path, or normalization
 * disabled via AMICUS_BASE_URL_NORMALIZE=0 (D1's escape hatch).
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string|null}
 */
function resolveBaseUrlOverride(env = process.env) {
  if (env.AMICUS_BASE_URL_NORMALIZE === '0') { return null; }
  const { form, normalized } = classifyBaseUrl(env.ANTHROPIC_BASE_URL);
  return form === 'host' ? normalized : null;
}

let noticeShown = false;

/**
 * One notice per process (D2): the server may start many times (shared-server
 * retries, fanout waves) and the treatment is identical every time.
 * @param {string} value - the raw env value seen
 * @param {string} normalized - the value handed to the engine config
 * @param {{write?:Function, logger?:object}} [deps] - test seams
 */
function announceBaseUrlNormalizationOnce(value, normalized, deps = {}) {
  if (noticeShown) { return; }
  noticeShown = true;
  const write = deps.write || (s => process.stderr.write(s));
  const log = deps.logger || require('./logger').logger;
  write(`Notice: ANTHROPIC_BASE_URL is host-form (${value}); passing ${normalized} to the engine `
    + '(Anthropic SDKs append /v1 themselves; OpenCode treats the value as a full prefix; '
    + 'set AMICUS_BASE_URL_NORMALIZE=0 to disable).\n');
  log.info('ANTHROPIC_BASE_URL normalized for engine config', { value, normalized });
}

/** Test seam: reset the once-guard. */
function _resetBaseUrlNotice() { noticeShown = false; }

module.exports = {
  classifyBaseUrl, resolveBaseUrlOverride,
  announceBaseUrlNormalizationOnce, _resetBaseUrlNotice,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/base-url-classify.test.js`
Expected: PASS (all cases)

- [ ] **Step 5: Commit**

```bash
git add src/utils/base-url-classify.js tests/base-url-classify.test.js
git commit -m "feat(base-url): classify ANTHROPIC_BASE_URL forms + normalization decision

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: the `anthropic-base-url` doctor row

**Files:**
- Create: `src/utils/doctor-base-url-check.js`
- Modify: `src/cli-handlers-doctor.js` (require block near the top with the other check
  modules, and one `checks.push` after the `aliases` check at ~`:155`)
- Test: `tests/doctor-base-url.test.js`

**Interfaces:**
- Consumes: `classifyBaseUrl` from Task 1.
- Produces: `evaluateAnthropicBaseUrl(d) -> {id,name,status,message,hint}` where
  `d.env` (optional) overrides `process.env`. Doctor row id: `anthropic-base-url`.

- [ ] **Step 1: Write the failing test**

Create `tests/doctor-base-url.test.js`:

```js
'use strict';

const { evaluateAnthropicBaseUrl } = require('../src/utils/doctor-base-url-check');

describe('evaluateAnthropicBaseUrl', () => {
  test('unset -> ok "not set"', () => {
    const row = evaluateAnthropicBaseUrl({ env: {} });
    expect(row).toMatchObject({ id: 'anthropic-base-url', status: 'ok', message: 'not set' });
  });

  test('full-prefix form -> ok, value shown', () => {
    const row = evaluateAnthropicBaseUrl({ env: { ANTHROPIC_BASE_URL: 'https://x.test/v1' } });
    expect(row.status).toBe('ok');
    expect(row.message).toContain('https://x.test/v1');
    expect(row.message).toContain('full-prefix');
  });

  test('host form -> warn, prints the value it SEES and the treatment', () => {
    const row = evaluateAnthropicBaseUrl({ env: { ANTHROPIC_BASE_URL: 'https://api.anthropic.com' } });
    expect(row.status).toBe('warn');
    expect(row.message).toContain('https://api.anthropic.com');
    expect(row.message).toContain('https://api.anthropic.com/v1');
    expect(row.message).toMatch(/passes .*\/v1 to the engine/);
    expect(row.hint).toBeNull();
  });

  test('host form with normalization disabled -> warn + actionable hint', () => {
    const row = evaluateAnthropicBaseUrl({
      env: { ANTHROPIC_BASE_URL: 'https://api.anthropic.com', AMICUS_BASE_URL_NORMALIZE: '0' },
    });
    expect(row.status).toBe('warn');
    expect(row.message).toContain('disabled');
    expect(row.hint).toContain('https://api.anthropic.com/v1');
  });

  test('nonstandard path -> ok, passed through unchanged', () => {
    const row = evaluateAnthropicBaseUrl({ env: { ANTHROPIC_BASE_URL: 'https://gw.test/custom' } });
    expect(row.status).toBe('ok');
    expect(row.message).toContain('passed through unchanged');
  });
});

describe('doctor registration', () => {
  test('runDoctorChecks carries the anthropic-base-url row', async () => {
    const { runDoctorChecks } = require('../src/cli-handlers-doctor');
    const rows = await runDoctorChecks();
    expect(rows.map(r => r.id)).toContain('anthropic-base-url');
  });
});
```

Note: if `runDoctorChecks` is not exported from `src/cli-handlers-doctor.js`, check how
`tests/cli-handlers-doctor.test.js` reaches the checks and mirror that access pattern for the
registration test instead of inventing a new export.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/doctor-base-url.test.js`
Expected: FAIL — `Cannot find module '../src/utils/doctor-base-url-check'`

- [ ] **Step 3: Write the check module**

Create `src/utils/doctor-base-url-check.js`:

```js
/**
 * @module doctor-base-url-check
 * v4.6.2 PR1 (spec §4): the 'anthropic-base-url' doctor row.
 *
 * VERIFIABLE voice (BACKLOG ruling): states only what it string-inspected.
 * It always prints the value the process SEES — the var can live ONLY in a
 * parent process env (the field case: set in the Claude Code app process,
 * absent from every persisted scope on disk), so the seen value IS the
 * diagnostic; "where it is set" may be unfindable.
 */
'use strict';

const { classifyBaseUrl } = require('./base-url-classify');

/** @param {{env?:NodeJS.ProcessEnv}} [d] @returns {{id,name,status,message,hint}} */
function evaluateAnthropicBaseUrl(d = {}) {
  const id = 'anthropic-base-url'; const name = 'ANTHROPIC_BASE_URL';
  const env = d.env || process.env;
  const value = env.ANTHROPIC_BASE_URL;
  const { form, normalized } = classifyBaseUrl(value);
  if (form === 'absent') {
    return { id, name, status: 'ok', message: 'not set', hint: null };
  }
  if (form === 'v1') {
    return { id, name, status: 'ok', message: `${value} (full-prefix form)`, hint: null };
  }
  if (form === 'host') {
    const disabled = env.AMICUS_BASE_URL_NORMALIZE === '0';
    const treatment = disabled
      ? 'normalization is disabled (AMICUS_BASE_URL_NORMALIZE=0) — direct-anthropic legs will 404'
      : `amicus passes ${normalized} to the engine`;
    return {
      id, name, status: 'warn',
      message: `host-form: ${value} — Anthropic SDKs append /v1; OpenCode treats it as the full prefix; ${treatment}`,
      hint: disabled ? `set ANTHROPIC_BASE_URL=${normalized} (or unset AMICUS_BASE_URL_NORMALIZE)` : null,
    };
  }
  return { id, name, status: 'ok', message: `${value} (nonstandard path — passed through unchanged)`, hint: null };
}

module.exports = { evaluateAnthropicBaseUrl };
```

- [ ] **Step 4: Register the row**

In `src/cli-handlers-doctor.js`: add with the other check-module requires at the top:

```js
const baseUrlCheck = require('./utils/doctor-base-url-check');
```

and immediately after the `aliases` `checks.push(...)` block (currently ends ~`:155`):

```js
  checks.push(guard('anthropic-base-url', 'ANTHROPIC_BASE_URL',
    () => baseUrlCheck.evaluateAnthropicBaseUrl(d)));
```

- [ ] **Step 5: Run the new test + the whole doctor family**

Run: `npx jest tests/doctor-base-url.test.js tests/cli-handlers-doctor.test.js tests/doctor-summary.test.js tests/doctor-handler.test.js tests/doctor-fix.test.js tests/setup-doctor-finale.test.js tests/result-schema-doctor.test.js`
Expected: PASS. If any pre-existing doctor test pins a row COUNT or a full row-id list, update
that pin to include `anthropic-base-url` (a row-list pin is the only legitimate edit; do not
weaken assertions).

- [ ] **Step 6: Commit**

```bash
git add src/utils/doctor-base-url-check.js src/cli-handlers-doctor.js tests/doctor-base-url.test.js
git commit -m "feat(doctor): anthropic-base-url row — states the value seen + its treatment

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

(plus any doctor-family test files updated in Step 5)

---

### Task 3: provider-config normalization in `buildServerOptions`

**Files:**
- Modify: `src/opencode-client.js` (insert directly after
  `config.provider = buildProviderModels(resolvedForProvider);` at ~`:558`)
- Test: `tests/opencode-client.test.js` (new `describe` block; `buildServerOptions` is exported
  at `:899`)

**Interfaces:**
- Consumes: `resolveBaseUrlOverride`, `announceBaseUrlNormalizationOnce`, `_resetBaseUrlNotice`
  from Task 1.
- Produces: `buildServerOptions(options)` honors `options._env` (test seam, defaults
  `process.env`) and `options._noticeDeps` (forwarded to the announcer). When the env carries a
  host-form `ANTHROPIC_BASE_URL` and the knob is not `'0'`, the returned
  `serverOptions.config.provider.anthropic.options.baseURL` is the normalized value.

- [ ] **Step 1: Write the failing test**

Append to `tests/opencode-client.test.js` (match the file's existing require style for
`buildServerOptions`):

```js
describe('buildServerOptions — ANTHROPIC_BASE_URL normalization (v4.6.2 PR1)', () => {
  const { _resetBaseUrlNotice } = require('../src/utils/base-url-classify');
  beforeEach(() => _resetBaseUrlNotice());

  const noticeSink = () => {
    const writes = [];
    return { deps: { write: s => writes.push(s), logger: { info: () => {} } }, writes };
  };

  test('host-form env -> provider.anthropic.options.baseURL is the /v1 form', () => {
    const { deps } = noticeSink();
    const so = buildServerOptions({
      _env: { ANTHROPIC_BASE_URL: 'https://api.anthropic.com' }, _noticeDeps: deps,
    });
    expect(so.config.provider.anthropic.options.baseURL)
      .toBe('https://api.anthropic.com/v1');
  });

  test('the notice announces once across two builds', () => {
    const { deps, writes } = noticeSink();
    const env = { ANTHROPIC_BASE_URL: 'https://api.anthropic.com' };
    buildServerOptions({ _env: env, _noticeDeps: deps });
    buildServerOptions({ _env: env, _noticeDeps: deps });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatch(/^Notice: ANTHROPIC_BASE_URL is host-form/);
  });

  test.each([
    [{ ANTHROPIC_BASE_URL: 'https://x.test/v1' }, 'already /v1'],
    [{ ANTHROPIC_BASE_URL: 'https://x.test/custom' }, 'nonstandard path'],
    [{ ANTHROPIC_BASE_URL: 'https://api.anthropic.com', AMICUS_BASE_URL_NORMALIZE: '0' }, 'knob off'],
    [{}, 'unset'],
  ])('no override injected for %j (%s)', (env) => {
    const so = buildServerOptions({ _env: env });
    const anthropic = so.config.provider.anthropic;
    expect(anthropic && anthropic.options && anthropic.options.baseURL).toBeFalsy();
  });

  test('an existing anthropic provider entry is merged, not clobbered', () => {
    // opus registers the anthropic provider via buildProviderModels
    const { deps } = noticeSink();
    const so = buildServerOptions({
      model: 'anthropic/claude-opus-4-8',
      _env: { ANTHROPIC_BASE_URL: 'https://api.anthropic.com' }, _noticeDeps: deps,
    });
    expect(so.config.provider.anthropic.models['claude-opus-4-8']).toEqual({});
    expect(so.config.provider.anthropic.options.baseURL).toBe('https://api.anthropic.com/v1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/opencode-client.test.js -t "ANTHROPIC_BASE_URL normalization"`
Expected: FAIL — `so.config.provider.anthropic` (or `.options`) undefined on the host-form cases

- [ ] **Step 3: Implement the insertion**

In `src/opencode-client.js`, directly after `config.provider = buildProviderModels(resolvedForProvider);`:

```js
  // v4.6.2 PR1 (spec §4, D1/D2): a host-form ANTHROPIC_BASE_URL is correct
  // for Anthropic SDKs (they append /v1) and fatal for OpenCode's
  // direct-anthropic provider (it appends /messages -> 404). Carry the
  // normalized full-prefix form as a provider-config override — config-level,
  // no process env is written anywhere. AMICUS_BASE_URL_NORMALIZE=0 disables.
  // Merge order keeps any existing options.baseURL authoritative (M-5 lesson:
  // never clobber a user-authored value with a derived one).
  const { resolveBaseUrlOverride, announceBaseUrlNormalizationOnce } = require('./utils/base-url-classify');
  const baseUrlEnv = options._env || process.env;
  const anthropicBaseUrl = resolveBaseUrlOverride(baseUrlEnv);
  if (anthropicBaseUrl) {
    if (!Object.prototype.hasOwnProperty.call(config.provider, 'anthropic')) {
      config.provider.anthropic = { models: {} };
    }
    config.provider.anthropic.options = {
      baseURL: anthropicBaseUrl,
      ...(config.provider.anthropic.options || {}),
    };
    announceBaseUrlNormalizationOnce(baseUrlEnv.ANTHROPIC_BASE_URL, anthropicBaseUrl, options._noticeDeps);
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/opencode-client.test.js`
Expected: PASS — the new block AND every pre-existing test in the file (none of them set
`ANTHROPIC_BASE_URL`, so `_env` defaulting to `process.env` must not disturb them; if the CI
env ever carries the var, the `_env: {}` seam in existing tests is the fix, not skipping).

- [ ] **Step 5: Commit**

```bash
git add src/opencode-client.js tests/opencode-client.test.js
git commit -m "feat(engine): normalize host-form ANTHROPIC_BASE_URL as provider-config override

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: stored-alias drift warning (2A)

**Files:**
- Modify: `src/utils/alias-audit.js` (new exported function)
- Modify: `src/sidecar/models.js` (`:16` import line, `runCheck` human + `--json` paths)
- Modify: `src/cli-handlers-doctor.js` (deps at ~`:40`, `aliases` check at `:148-155`)
- Test: `tests/alias-drift.test.js`

**Interfaces:**
- Consumes: `collectAliasSources` shapes (`{alias, model, source}`), catalog rows (`{id}`),
  `resolveQuickPicks`/`toStorableRoute` from `src/utils/quick-picks.js`.
- Produces: `findDriftedStoredAliases(sources, catalog) -> Array<{alias, stored, current}>`,
  exported from `alias-audit.js`. Doctor `aliases` row message gains `N drifted: <aliases>`;
  `models --check` prints `DRIFTED:` lines and its `--json` doc gains a `drifted` array.

- [ ] **Step 1: Write the failing test**

Create `tests/alias-drift.test.js`. Build the catalog fixture so the quick-pick family
resolution is real (find the `gemini` family's `vendorPath`/`idPattern` in
`src/utils/curated-models.js` first and shape fixture ids to match — the test must go through
the real `resolveQuickPicks`, not a mock):

```js
'use strict';

const { findDriftedStoredAliases } = require('../src/utils/alias-audit');
const { resolveQuickPicks, toStorableRoute } = require('../src/utils/quick-picks');

// Fixture ids must satisfy the real gemini family pattern in curated-models.js
// so resolveQuickPicks yields a live route. Adjust ids after reading that file
// — the SHAPE of these tests is the contract, the ids must be family-real.
const CATALOG = [
  { id: 'openrouter/google/gemini-3.6-flash' },
  { id: 'openrouter/google/gemini-3.1-flash-lite-preview' }, // listed but old
  { id: 'openrouter/deepseek/deepseek-chat-v3' },
];

describe('findDriftedStoredAliases', () => {
  test('sanity: the fixture resolves a live gemini family route', () => {
    const live = resolveQuickPicks(CATALOG).find(r => r.alias === 'gemini');
    expect(live && live.source).toBe('live');
    expect(toStorableRoute(live)).toBeTruthy();
  });

  test('stored alias behind the current resolution -> one drift row', () => {
    const sources = [
      { alias: 'gemini', model: 'openrouter/google/gemini-3.1-flash-lite-preview', source: 'user-config' },
    ];
    const rows = findDriftedStoredAliases(sources, CATALOG);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      alias: 'gemini',
      stored: 'openrouter/google/gemini-3.1-flash-lite-preview',
    });
    expect(rows[0].current).not.toBe(rows[0].stored);
  });

  test('stored alias matching the current resolution -> no row', () => {
    const live = resolveQuickPicks(CATALOG).find(r => r.alias === 'gemini');
    const sources = [{ alias: 'gemini', model: toStorableRoute(live), source: 'user-config' }];
    expect(findDriftedStoredAliases(sources, CATALOG)).toHaveLength(0);
  });

  test('non-user-config sources are never checked', () => {
    const sources = [
      { alias: 'gemini', model: 'openrouter/google/gemini-3.1-flash-lite-preview', source: 'defaults' },
      { alias: 'gemini', model: 'openrouter/google/gemini-3.1-flash-lite-preview', source: 'curated-route (openrouter)' },
    ];
    expect(findDriftedStoredAliases(sources, CATALOG)).toHaveLength(0);
  });

  test('a stored model absent from the catalog is stale, not drifted', () => {
    const sources = [{ alias: 'gemini', model: 'openrouter/google/gemini-2-dead', source: 'user-config' }];
    expect(findDriftedStoredAliases(sources, CATALOG)).toHaveLength(0);
  });

  test('a custom alias with no quick-pick family has no "current" to drift from', () => {
    const sources = [{ alias: 'mymodel', model: 'openrouter/deepseek/deepseek-chat-v3', source: 'user-config' }];
    expect(findDriftedStoredAliases(sources, CATALOG)).toHaveLength(0);
  });

  test('empty catalog -> [] (cannot check)', () => {
    expect(findDriftedStoredAliases([{ alias: 'gemini', model: 'x/y', source: 'user-config' }], []))
      .toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/alias-drift.test.js`
Expected: FAIL — `findDriftedStoredAliases is not a function`

- [ ] **Step 3: Implement the audit function**

Append to `src/utils/alias-audit.js` (before `module.exports`), and add the export:

```js
/**
 * Stored aliases whose target is LIVE in the catalog but no longer what a
 * fresh `amicus setup` would seed today — the v4.6.1 release-gate class
 * (stored `gemini` -> 3.1-flash-lite-preview: still catalog-listed so
 * findStaleAliases passes it, no longer what the family resolves to).
 * Report + suggest, never auto-repair (this module's charter).
 *
 * Only user-config rows are checked (defaults/curated follow the catalog by
 * construction), only for aliases that are quick-pick families (a custom
 * alias has no "current" to drift from), and only when the stored target is
 * itself catalog-live (a dead target is findStaleAliases's finding, not
 * ours). Resolution goes through toStorableRoute() — the guarded 4.1.2
 * helper — never a bare prefix strip (spec D3).
 * @param {Array<{alias:string,model:string,source:string}>} sources
 * @param {Array<{id:string}>} catalog
 * @returns {Array<{alias:string,stored:string,current:string}>}
 */
function findDriftedStoredAliases(sources, catalog) {
  if (!catalog || catalog.length === 0) { return []; }
  const { resolveQuickPicks, toStorableRoute } = require('./quick-picks');
  const current = new Map();
  for (const r of resolveQuickPicks(catalog)) {
    if (r.source !== 'live') { continue; }
    const stored = toStorableRoute(r);
    if (stored) { current.set(r.alias, stored); }
  }
  const byProvider = idsByProvider(catalog);
  return sources
    .filter(({ source }) => source === 'user-config')
    .filter(({ model }) => {
      const ids = byProvider.get(model.split('/')[0]);
      return !!(ids && ids.has(model));
    })
    .filter(({ alias, model }) => current.has(alias) && current.get(alias) !== model)
    .map(({ alias, model }) => ({ alias, stored: model, current: current.get(alias) }));
}
```

```js
module.exports = { collectAliasSources, findStaleAliases, findDriftedStoredAliases, suggestReplacements };
```

- [ ] **Step 4: Run the unit test**

Run: `npx jest tests/alias-drift.test.js`
Expected: PASS. If the family-resolution sanity test fails, fix the FIXTURE ids against
`curated-models.js` — do not mock `resolveQuickPicks`.

- [ ] **Step 5: Wire `models --check`**

In `src/sidecar/models.js`: extend the import at `:16`:

```js
const { collectAliasSources, findStaleAliases, findDriftedStoredAliases, suggestReplacements } = require('../utils/alias-audit');
```

In `runCheck`, after the `stale` mapping (`:145-146`), add:

```js
  const drifted = findDriftedStoredAliases(sources, catalog);
```

Add `drifted` to the `buildAuditDoc({...})` call in the `--json` branch (and add the field in
`buildAuditDoc` itself — locate it in this file, additive key, default `[]`). Drift never
affects `exitCode` (see Global Constraints).

In the human path, after the stale block (`:163-175`) and BEFORE the
`Pinned fallback drift` block, add:

```js
  for (const dr of drifted) {
    process.stdout.write(`DRIFTED: ${dr.alias} -> ${dr.stored} (stored; current resolution: ${dr.current})\n`);
    process.stdout.write(`  stored aliases don't follow catalog updates — refresh: amicus setup --add-alias ${dr.alias}=${dr.current}\n`);
  }
```

Also update the all-clear line so it only prints when BOTH lists are empty:

```js
  if (stale.length === 0 && drifted.length === 0) {
    process.stdout.write(`All aliases resolve to catalog models (${sources.length} checked).\n`);
  } else if (stale.length > 0) {
```

(keeping the existing stale loop inside that `else if`; the drift loop above runs
unconditionally after it).

- [ ] **Step 6: Wire the doctor `aliases` row**

In `src/cli-handlers-doctor.js` deps (~`:40`), beside `findStaleAliases`:

```js
    findDriftedStoredAliases: (s, c) => require('./utils/alias-audit').findDriftedStoredAliases(s, c),
```

Replace the `aliases` check body (`:148-155`) with:

```js
  checks.push(guard('aliases', 'Model aliases', () => {
    const cache = d.readCache();
    const catalog = (cache && cache.models) || [];
    const sources = d.collectAliasSources();
    const stale = d.findStaleAliases(sources, catalog);
    const drifted = d.findDriftedStoredAliases(sources, catalog);
    if (stale.length === 0 && drifted.length === 0) {
      return { id: 'aliases', name: 'Model aliases', status: 'ok', message: catalog.length ? 'all resolve' : 'catalog empty — not checked', hint: null };
    }
    const parts = [];
    if (stale.length) { parts.push(`${stale.length} stale: ${stale.map(s => s.alias).join(', ')}`); }
    if (drifted.length) { parts.push(`${drifted.length} drifted: ${drifted.map(s => s.alias).join(', ')}`); }
    return { id: 'aliases', name: 'Model aliases', status: 'warn', message: parts.join('; '), hint: 'amicus models --check' };
  }));
```

- [ ] **Step 7: Add consumer tests + run the affected families**

Append to `tests/alias-drift.test.js`:

```js
describe('doctor aliases row — drift wiring', () => {
  test('drift-only state warns with "1 drifted"', async () => {
    const { runDoctorChecks } = require('../src/cli-handlers-doctor');
    const rows = await runDoctorChecks({
      readCache: () => ({ models: CATALOG, fetchedAt: Date.now() }),
      collectAliasSources: () => ([
        { alias: 'gemini', model: 'openrouter/google/gemini-3.1-flash-lite-preview', source: 'user-config' },
      ]),
    });
    const row = rows.find(r => r.id === 'aliases');
    expect(row.status).toBe('warn');
    expect(row.message).toMatch(/1 drifted: gemini/);
  });
});
```

(Mirror the deps-override calling convention used by `tests/cli-handlers-doctor.test.js` — if
`runDoctorChecks(depsOverride)` differs from this shape, follow the existing tests' pattern.)

Run: `npx jest tests/alias-drift.test.js tests/cli-handlers-doctor.test.js tests/doctor-summary.test.js` plus every existing test file that exercises `models --check` (find them:
`grep -rln "runCheck\|models --check\|buildAuditDoc" tests/ | head`).
Expected: PASS; update any `--json` shape pins to include the additive `drifted: []` field.

- [ ] **Step 8: Commit**

```bash
git add src/utils/alias-audit.js src/sidecar/models.js src/cli-handlers-doctor.js tests/alias-drift.test.js
git commit -m "feat(audit): stored-alias drift warning — stored != current family resolution

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

(plus any consumer test files updated in Step 7)

---

### Task 5: docs, gates, and the PR

**Files:**
- Modify: `docs/configuration.md` (env-var table), `docs/usage.md` (doctor + models sections),
  `CHANGELOG.md` (`[Unreleased]`)
- Possibly regenerated: `CLAUDE.md` markers via `node scripts/generate-docs.js`

**Interfaces:** none produced; this task closes the PR.

- [ ] **Step 1: configuration.md** — add to the environment-variable table (match the existing
row format exactly; read neighboring rows first):

```markdown
| `AMICUS_BASE_URL_NORMALIZE` | `1` | Set `0` to stop amicus from carrying a host-form `ANTHROPIC_BASE_URL` into the engine as `<value>/v1`. Host-form is the Anthropic-SDK convention (the SDK appends `/v1`); OpenCode treats the value as a full prefix, so unnormalized host-form 404s every direct-Anthropic leg. |
```

- [ ] **Step 2: usage.md** — in the `### amicus doctor` section, add the row description
(`anthropic-base-url` — prints the value the process sees and how amicus will treat it); in the
`amicus models` area document `--check` now also reporting `DRIFTED:` stored aliases with the
refresh command. Match surrounding prose style; keep each addition to 2-4 lines.

- [ ] **Step 3: CHANGELOG.md `[Unreleased]`** — under `### Added`:

```markdown
- `doctor`: new `anthropic-base-url` row — prints the exact `ANTHROPIC_BASE_URL` the process
  sees and how it will be treated (the host-form value is only findable at runtime).
- Host-form `ANTHROPIC_BASE_URL` is now carried into the engine as `<value>/v1`
  (provider-config override, announced once per process; `AMICUS_BASE_URL_NORMALIZE=0`
  disables). Host-form — the Anthropic-SDK convention — previously 404'd every
  direct-Anthropic leg run through OpenCode.
- `models --check` and the `doctor` aliases row now flag stored-alias drift: a stored alias
  that is catalog-listed but no longer the current family resolution (the v4.6.1 `gemini`
  release-gate class), with the exact `setup --add-alias` refresh command.
```

- [ ] **Step 4: Regenerate doc markers**

Run: `node scripts/generate-docs.js`
Expected: exits 0; `CLAUDE.md`/marker updates staged by the script (new modules
`base-url-classify.js`, `doctor-base-url-check.js` enter the tree markers).

- [ ] **Step 5: Full gates**

Run, each expected green:
- `npm run lint`
- `npm run check:sizes`  (verify `cli-handlers-doctor.js` stayed <293; if ≥293, extract the
  aliases+base-url checks into `doctor-mcp-checks.js` before proceeding)
- `npm test`  (full suite — count the delta vs the Task-0 baseline and attribute every new test)

- [ ] **Step 6: Commit docs**

```bash
git add docs/configuration.md docs/usage.md CHANGELOG.md CLAUDE.md
git commit -m "docs(v4.6.2-pr1): configuration/usage/CHANGELOG for base-url + drift warning

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Live smoke (manual, ~$0.03, run from this worktree)**

1. Control pair (proves the normalization end-to-end, and that provider-config beats env
   inside OpenCode — the plan's one live assumption):
   `ANTHROPIC_BASE_URL=https://api.anthropic.com node bin/amicus.js fanout --models opus --prompt "Reply with exactly: SMOKE OK"`
   Expected: leg COMPLETES (pre-change this 404s "Not Found"); stderr shows the one
   `Notice: ANTHROPIC_BASE_URL is host-form...` line.
2. Same command with `AMICUS_BASE_URL_NORMALIZE=0`: expected 404 "Not Found" (the escape
   hatch really disables) — this failure is the PASS condition.
3. `ANTHROPIC_BASE_URL=https://api.anthropic.com node bin/amicus.js doctor` — the new row
   warns and prints value + treatment; plain `node bin/amicus.js doctor` — row reads
   `not set`.
4. Drift: `node bin/amicus.js setup --add-alias gemini=openrouter/google/gemini-3.1-flash-lite-preview`
   (if that id has left the catalog entirely, pick any catalog-listed non-current gemini id),
   then `node bin/amicus.js models --check` → expect the `DRIFTED:` block; then restore:
   `node bin/amicus.js setup --add-alias gemini=openrouter/google/gemini-3.6-flash`.
   ⚠️ Steps 4's alias writes hit the REAL user config — restore is not optional.
   If smoke 1 FAILS (leg still 404s), STOP: the provider-config-beats-env assumption is
   wrong — do not merge; fall back to reporting + escalating in the session.

- [ ] **Step 8: Push branch + open the PR**

```bash
git push -u origin feat/v4.6.2-pr1-diagnosis-pair
```

(pre-push runs the full suite — allow ≥5 minutes). Then open the PR with `gh pr create`
targeting `main`, title `v4.6.2 PR1: ANTHROPIC_BASE_URL check+normalize and stored-alias
drift warning`, body summarizing spec §4 + the smoke evidence, ending with the standard
Claude Code attribution line.

---

## Plan self-review (done at writing time)

- **Spec coverage:** §4 base-URL check ✓ (T2), D1/D2 normalize+knob+announce ✓ (T1/T3), 2A
  drift ✓ (T4), §9 tests ✓ (per task), §10 docs ✓ (T5). The §4 "child env" phrasing is
  implemented as a provider-config override — recorded in the header as a D2 refinement
  (zero env writes, same effect).
- **Placeholders:** none; every code step carries the code. Two deliberate
  verify-against-reality steps (doctor export shape T2-S1, fixture family ids T4-S1) name the
  exact file to consult and forbid the lazy alternative (new exports / mocks).
- **Type consistency:** `{form, normalized}` and `{alias, stored, current}` used identically
  across tasks; row id `anthropic-base-url` consistent in T2/T5.
