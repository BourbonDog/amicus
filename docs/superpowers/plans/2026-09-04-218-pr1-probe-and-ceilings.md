# #218 PR 1 — Wire Probe and Direct-Provider Ceilings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure, on the pinned opencode 1.18.15 engine and with zero spend, exactly what `max_tokens` and reasoning parameters reach the wire under every configuration amicus can produce; and give the amicus catalog the direct-provider output ceilings it lacks so `outputBudget` can clamp direct routes.

**Architecture:** A dev script (`scripts/probe-max-tokens.js`) stands up a local HTTP capture server, points the engine's real `openrouter`, `anthropic` and a custom openai-compatible provider at it through `options.baseURL`, and records every outbound request body across a fixed case matrix. Separately, a new `model-ceilings-modelsdev.js` module fills `contextLength` / `maxOutputTokens` on catalog rows from the public keyless `https://models.dev/api.json` at catalog-refresh time, hooked into `refreshCatalog` behind a lazy require; the HTTPS core of `model-fetcher.js` is extracted into `http-get.js` so both callers share one timeout/failure vocabulary and `model-fetcher.js` shrinks below its 300-line ceiling.

**Tech Stack:** Node.js CommonJS (`'use strict'`), jest, `@opencode-ai/sdk` 1.18.15 (ESM, loaded via dynamic `import()`), Node `http`/`https`.

**Spec:** GitHub issue BourbonDog/amicus#218 and its research comment (2026-08-27), plus the design approved in chat on 2026-09-04, reproduced in the Design section below. Read the issue with `gh issue view 218 -R BourbonDog/amicus --comments`.

## Global Constraints

- Repo: `C:\Users\sendt\code\amicus` (bash: `/c/Users/sendt/code/amicus`). Work on branch `fix/218-probe-and-ceilings` off `main`.
- Every file under `src/**/*.js` and `electron/**/*.js` must stay at or under **300 lines** (`node scripts/check-file-sizes.js --all`); functions under 50 lines. `src/utils/model-fetcher.js` is at 299, `src/utils/result-schema.js` at 295, `src/utils/model-catalog.js` at 173, `src/sidecar/models.js` at 266. `scripts/` is not size-gated or linted.
- **Documentation Sync (HARD RULE):** any commit that adds a file in `src/`, `bin/` or `scripts/` MUST run `node scripts/generate-docs.js` and stage `CLAUDE.md` and `docs/architecture-map.md` in the same commit.
- Lint scope: `npm run lint` = `eslint src/ electron/ tests/helpers/`.
- Citations in prose: prefer the symbol form `file.js :: symbolName`; `node scripts/check-citations.js --all` must stay green.
- Never write `git checkout --` on files with uncommitted work. Commit before running any mutant.
- Commit message trailer on every commit: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Never make a paid model call. The probe uses a local capture server and dummy keys only.
- `node_modules` was aligned to the lock (`npm ci`, 2026-09-04): `opencode-ai`, `@opencode-ai/sdk`, `opencode-windows-x64` all 1.18.15. The 1.18.15 package ships **no source map** (binary only). Any engine-behaviour claim must be measured by the probe, not read from `node_modules/opencode-windows-x64/bin/index.js.map` (that file no longer exists; the stale 1.2.20 map it replaced misled the issue's research three times).
- Windows shell: run jest as `npx jest <path>`; paths in bash with forward slashes.

---

> **Superseded in part (2026-09-04):** the P1 probe refuted fact 4 (a per-model `options.max_tokens` DOES reach the wire, case E1) and the engine reports kimi-k3's ceiling as 1048576, not fact 6's live-models.dev 943718. The BACKLOG "v4.9.4 records" P1 entry is the measured record; read it before this section.

## Design (approved 2026-09-04)

**Measured facts this PR builds on** (pinned 1.18.15 binary and SDK, live APIs):

1. `maxOutputTokens(model) = Math.min(model.limit.output, OUTPUT_TOKEN_MAX) || OUTPUT_TOKEN_MAX`, `OUTPUT_TOKEN_MAX = OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX || 32000`; the flag parses only a positive integer, anything else is silently dropped.
2. The pinned SDK spawns `opencode serve` with `env: { ...process.env, OPENCODE_CONFIG_CONTENT }` synchronously before its first `await`.
3. The engine's prompt endpoint (`/session/{id}/message` and `/prompt_async`) accepts `variant: string` and has **no** `reasoning` field. amicus sends `body.reasoning = { effort }` (`src/opencode-client.js :: sendPrompt`), so `--thinking` has never reached the engine. An unknown `variant` is a silent no-op at request time.
4. The bundled `@openrouter/ai-sdk-provider` copies `providerOptions.openrouter.reasoning` into the request body; per-model config `options` merge into those provider options; `options.max_tokens` is dropped.
5. OpenRouter applies each model's default effort when none is sent: kimi-k3 `max`, qwen3.8-max `xhigh` (~95 % of `max_tokens` on reasoning). That reproduces every Mode 2 ledger row.
6. models.dev (`https://models.dev/api.json`, keyless, 4.5 MB) carries `limit.{context,output}` for anthropic 14/14, openai 42/47, google 39/39, deepseek 3/3, openrouter 361/361, including all seven ids in `ANTHROPIC_MODELS`. OpenRouter's own `top_provider.max_completion_tokens` disagrees with models.dev on 24 of 344 openrouter rows; the 6 openrouter rows without a ceiling are all `openrouter/openrouter/*` meta-routers. Google's ListModels response carries `outputTokenLimit` next to the `inputTokenLimit` amicus already lifts.
7. The engine itself already merges models.dev limits into every `{}` model descriptor. Enrichment changes what **amicus** can clamp and name, not what the engine knows.

**PR sequence** (this document is PR 1): PR 1 = P0 engine alignment (done), P1 wire probe, P3 ceilings. PR 2 = bidirectional `outputBudget` via the env flag, doctor check, docs sweep. PR 3 = name the Mode 2 death (`finish: 'length'` on the leg). PR 4 = send `variant` instead of `reasoning` (new issue, linked from #218). Each later PR gets its own plan written after PR 1's measurements land.

**P1 case matrix** (each case is its own engine start; every case records the outbound body, the `promptAsync` HTTP status, and the assistant message's `finish`/`error`):

| id | provider / model | descriptor | env flag | prompt extra | expected |
|---|---|---|---|---|---|
| A | openrouter kimi-k3 | `{}` | unset | none | `max_tokens` 32000, no `reasoning` |
| B | openrouter kimi-k3 | `{limit:{context:1048576,output:4096}}` | unset | none | 4096 |
| C1 | openrouter kimi-k3 | `{limit:{...,output:100000}}` | 64000 | none | 64000 |
| C2 | openrouter qwen3.8-max | `{limit:{context:1000000,output:50000}}` | 64000 | none | 50000 |
| C3 | openrouter kimi-k3 | `{}` | 64000 | none | 64000 (engine's own models.dev ceiling 943718) |
| D1 | openrouter kimi-k3 | `{}` | `64000abc` | none | 32000, silently |
| D2 | openrouter kimi-k3 | `{}` | `0` | none | 32000 |
| E1 | openrouter kimi-k3 | `{options:{max_tokens:4096}}` | unset | none | 32000 (dropped) |
| E2 | openrouter kimi-k3 | `{options:{reasoning:{effort:'low'}}}` | unset | none | `reasoning:{effort:'low'}` on the wire |
| F1 | openrouter kimi-k3 | `{}` | unset | amicus `sendPrompt` with `reasoning:{effort:'low'}` | **no** `reasoning` on the wire |
| F2 | openrouter kimi-k3 | `{}` | unset | `variant:'low'` | `reasoning:{effort:'low'}` |
| F3 | openrouter kimi-k3 | `{}` | unset | `variant:'medium'` (kimi has no medium) | record: silent no-op or error |
| F4 | openrouter qwen3.8-max | `{}` | unset | `variant:'medium'` | `reasoning:{effort:'medium'}` |
| H1 | anthropic claude-haiku-4-5 | `{}` | unset | none | 32000 |
| H2 | anthropic claude-haiku-4-5 | `{}` | 64000 | none | 64000 (engine ceiling 64000) |
| H3 | anthropic claude-haiku-4-5 | `{}` | unset | `variant:'high'` | `thinking.budget_tokens` 16000 |
| J1 | custom openai-compatible `unknown-model` | `{}` | unset | none | 32000 |
| J2 | custom openai-compatible `unknown-model` | `{}` | 64000 | none | 64000 (raw budget: nothing to clamp) |

Plus one `/config/providers` dump per provider family (keys, `limit`, and whether `variants` is exposed).

**P3 rules:** enrichment runs only on a refresh that already passed the floor-only check; in place on the fresh row objects; provider's own value wins and models.dev fills **only** null `contextLength` / `maxOutputTokens`; zero or absent models.dev limits are skipped; `openrouter/openrouter/*` routers and `local:true` rows are skipped; a touched row gains `limitSource: 'models.dev'`; the outcome (`filled`, `alreadyKnown`, `unknown`, `skippedRouters`, `skippedLocal`, `failure`) is persisted in the cache document as `ceilingEnrichment` and printed by `amicus models --refresh`; offline means rows unchanged and the line says so.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/utils/http-get.js` | create | One HTTPS GET that always resolves: `httpGetText`, `getJson`; the timer/destroy/failure core extracted from `model-fetcher.js` |
| `src/utils/model-fetcher.js` | modify | Use `httpGetText`; google normalizer lifts `outputTokenLimit`; shrinks below 299 |
| `src/utils/model-ceilings-modelsdev.js` | create | models.dev fetch, id mapping, fill rules, outcome counts |
| `src/utils/model-catalog.js` | modify | Lazy `_enrichCeilings` hook in `refreshCatalog`; `writeCache` persists `ceilingEnrichment`; `getCatalogInfo` exposes it |
| `src/utils/result-schema.js` | modify | `buildCatalogDoc` carries `ceilingEnrichment` |
| `src/sidecar/models.js` | modify | `runRefresh` prints the ceilings line and the JSON field |
| `scripts/probe-max-tokens.js` | create | The wire probe (dev script, not gated, not linted) |
| `tests/utils/http-get.test.js` | create | Helper contract |
| `tests/utils/model-ceilings-modelsdev.test.js` | create | Pure fill rules + injected fetch |
| `tests/model-catalog-ceilings.test.js` | create | Hook: called on success, not on floor-only, outcome persisted, failure/throw tolerated |
| `tests/model-fetcher.test.js`, `tests/utils/model-fetcher-enrichment.test.js` | modify | Google row shape gains `maxOutputTokens` |
| `tests/model-catalog.test.js`, `tests/model-catalog-failures.test.js`, `tests/model-catalog-local.test.js`, `tests/utils/model-catalog-v2.test.js` (+ any other file that `doMock`s `model-fetcher` and requires `model-catalog`) | modify | `doMock` the enrichment module so no unit test downloads 4.5 MB |
| `tests/sidecar/models-command.test.js` | modify | `--refresh` prints the ceilings line; `--json` carries the field |
| `docs/configuration.md`, `docs/usage.md`, `CHANGELOG.md`, `BACKLOG.md`, `CLAUDE.md`, `docs/architecture-map.md` | modify | Records and generated inventory |

---

### Task 0: Branch and baseline

**Files:** none modified.

- [ ] **Step 1: Create the branch from main**

```bash
cd /c/Users/sendt/code/amicus && git checkout main && git pull --ff-only && git checkout -b fix/218-probe-and-ceilings && git status --short
```

Expected: on `fix/218-probe-and-ceilings`; the only untracked entry is `site-src/` (pre-existing, leave it alone).

- [ ] **Step 2: Confirm the engine copy is the pin**

```bash
cd /c/Users/sendt/code/amicus && node -e "for (const p of ['opencode-ai','@opencode-ai/sdk','opencode-windows-x64']) console.log(p, require('./node_modules/'+p+'/package.json').version)"
```

Expected: three lines, all `1.18.15`. If any differ, run `npm ci --no-audit --no-fund` and re-check before continuing.

- [ ] **Step 3: Baseline the suites this PR touches**

```bash
cd /c/Users/sendt/code/amicus && npx jest tests/model-fetcher.test.js tests/model-fetcher-anthropic.test.js tests/utils/model-fetcher-enrichment.test.js tests/model-catalog.test.js tests/model-catalog-failures.test.js tests/model-catalog-local.test.js tests/utils/model-catalog-v2.test.js tests/sidecar/models-command.test.js 2>&1 | tail -8
```

Expected: all suites pass. Record the test count in your task report.

---

### Task 1: Extract the HTTPS core into `http-get.js`

**Files:**
- Create: `src/utils/http-get.js`
- Modify: `src/utils/model-fetcher.js` (lines 8 and 140-188: `require('https')` and `fetchViaConfigDetailed`)
- Test: `tests/utils/http-get.test.js`

**Interfaces:**
- Produces: `httpGetText(url, {headers?, timeoutMs?}) → Promise<{ok:true, body:string} | {ok:false, failure:{reason:'timeout'|'http-status'|'network-error', status?:number, detail?:string}}>`; `getJson(url, opts) → Promise<{ok:true, json:any} | {ok:false, failure}>` where `failure.reason` adds `'parse-error'`; `DEFAULT_TIMEOUT_MS = 5000`. Never rejects.
- Consumed by: Task 3 (`getJson`), and `model-fetcher.js :: fetchViaConfigDetailed` (`httpGetText`).

- [ ] **Step 1: Write the failing tests**

Create `tests/utils/http-get.test.js`:

```js
'use strict';
/**
 * src/utils/http-get.js — the always-resolves HTTPS GET shared by the
 * provider model fetch (#209 failure vocabulary) and the models.dev ceiling
 * fetch (#218 P3). Same mock shape as tests/model-fetcher.test.js:
 * https.get(url, { headers }, cb) returning an object with on()/destroy().
 */
const { EventEmitter } = require('events');
const https = require('https');

jest.mock('https');

const { httpGetText, getJson, DEFAULT_TIMEOUT_MS } = require('../../src/utils/http-get');

/** @param {{status?: number, body?: string, error?: Error, hang?: boolean}} o */
function mockGet(o = {}) {
  const req = new EventEmitter();
  req.destroy = jest.fn();
  https.get.mockImplementation((_url, _opts, cb) => {
    if (o.error) { process.nextTick(() => req.emit('error', o.error)); return req; }
    if (o.hang) { return req; }
    const res = new EventEmitter();
    res.statusCode = o.status === undefined ? 200 : o.status;
    cb(res);
    process.nextTick(() => { if (o.body) { res.emit('data', o.body); } res.emit('end'); });
    return req;
  });
  return req;
}

describe('httpGetText', () => {
  afterEach(() => { jest.useRealTimers(); https.get.mockReset(); });

  it('resolves {ok:true, body} on a 200', async () => {
    mockGet({ body: '{"a":1}' });
    await expect(httpGetText('https://x.test/y')).resolves.toEqual({ ok: true, body: '{"a":1}' });
  });

  it('passes headers through and defaults the timeout', async () => {
    mockGet({ body: 'ok' });
    await httpGetText('https://x.test/y', { headers: { 'User-Agent': 'amicus/test' } });
    expect(https.get).toHaveBeenCalledWith('https://x.test/y', { headers: { 'User-Agent': 'amicus/test' } }, expect.any(Function));
    expect(DEFAULT_TIMEOUT_MS).toBe(5000);
  });

  it('reports a non-200 as http-status with the code', async () => {
    mockGet({ status: 401, body: 'nope' });
    await expect(httpGetText('https://x.test/y')).resolves.toEqual({ ok: false, failure: { reason: 'http-status', status: 401 } });
  });

  it('reports a socket error as network-error', async () => {
    mockGet({ error: new Error('ECONNRESET') });
    await expect(httpGetText('https://x.test/y')).resolves.toEqual({ ok: false, failure: { reason: 'network-error', detail: 'ECONNRESET' } });
  });

  it('destroys the request and reports timeout when nothing answers', async () => {
    jest.useFakeTimers();
    const req = mockGet({ hang: true });
    const p = httpGetText('https://x.test/y', { timeoutMs: 250 });
    jest.advanceTimersByTime(251);
    await expect(p).resolves.toEqual({ ok: false, failure: { reason: 'timeout', detail: 'no response within 250ms' } });
    expect(req.destroy).toHaveBeenCalledTimes(1);
  });
});

describe('getJson', () => {
  afterEach(() => { https.get.mockReset(); });

  it('parses a JSON body', async () => {
    mockGet({ body: '{"models":[]}' });
    await expect(getJson('https://x.test/api.json')).resolves.toEqual({ ok: true, json: { models: [] } });
  });

  it('reports a non-JSON body as parse-error', async () => {
    mockGet({ body: '<html>' });
    const r = await getJson('https://x.test/api.json');
    expect(r.ok).toBe(false);
    expect(r.failure.reason).toBe('parse-error');
    expect(typeof r.failure.detail).toBe('string');
  });

  it('forwards a transport failure unchanged', async () => {
    mockGet({ status: 503 });
    await expect(getJson('https://x.test/api.json')).resolves.toEqual({ ok: false, failure: { reason: 'http-status', status: 503 } });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /c/Users/sendt/code/amicus && npx jest tests/utils/http-get.test.js 2>&1 | tail -6
```

Expected: FAIL with `Cannot find module '../../src/utils/http-get'`.

- [ ] **Step 3: Create `src/utils/http-get.js`**

```js
'use strict';

/**
 * @module http-get
 * One HTTPS GET, always resolved, never rejected — the timer/destroy/failure
 * core that model-fetcher.js :: fetchViaConfigDetailed carried inline (#209)
 * and that the models.dev ceiling fetch (#218 P3) needs too. Extracted rather
 * than copied so a second caller cannot drift from the first: the same failure
 * reasons and the same {reason, status?, detail?} shape the catalog persists
 * as providerFailures.
 *
 * The call shape is deliberately `https.get(url, { headers }, cb)` — the one
 * tests/model-fetcher.test.js mocks — so that suite keeps intercepting after
 * the extraction.
 */

const https = require('https');

const DEFAULT_TIMEOUT_MS = 5000;

/**
 * GET `url`; resolve with the raw body on a 200.
 * @param {string} url
 * @param {{headers?: object, timeoutMs?: number}} [opts]
 * @returns {Promise<{ok: true, body: string}|{ok: false, failure: {reason: string, status?: number, detail?: string}}>}
 */
function httpGetText(url, opts = {}) {
  const headers = opts.headers || {};
  const timeoutMs = opts.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : opts.timeoutMs;
  return new Promise((resolve) => {
    let chunks = '';
    const fail = (failure) => resolve({ ok: false, failure });
    const timer = setTimeout(() => {
      req.destroy();
      fail({ reason: 'timeout', detail: `no response within ${timeoutMs}ms` });
    }, timeoutMs);
    const req = https.get(url, { headers }, (res) => {
      if (res.statusCode !== 200) {
        clearTimeout(timer);
        res.on('data', () => {});
        res.on('end', () => fail({ reason: 'http-status', status: res.statusCode }));
        return;
      }
      res.on('data', (chunk) => { chunks += chunk; });
      res.on('end', () => { clearTimeout(timer); resolve({ ok: true, body: chunks }); });
    });
    req.on('error', (err) => {
      clearTimeout(timer);
      fail({ reason: 'network-error', detail: err.message });
    });
  });
}

/**
 * GET + JSON.parse. A body that is not JSON is a 'parse-error' failure, so a
 * caller sees the transport reasons plus exactly this one more.
 * @param {string} url
 * @param {{headers?: object, timeoutMs?: number}} [opts]
 * @returns {Promise<{ok: true, json: any}|{ok: false, failure: {reason: string, status?: number, detail?: string}}>}
 */
async function getJson(url, opts) {
  const res = await httpGetText(url, opts);
  if (!res.ok) { return res; }
  try {
    return { ok: true, json: JSON.parse(res.body) };
  } catch (err) {
    return { ok: false, failure: { reason: 'parse-error', detail: err.message } };
  }
}

module.exports = { httpGetText, getJson, DEFAULT_TIMEOUT_MS };
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /c/Users/sendt/code/amicus && npx jest tests/utils/http-get.test.js 2>&1 | tail -6
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Refactor `fetchViaConfigDetailed` to use the helper**

In `src/utils/model-fetcher.js`, replace line 8 `const https = require('https');` with:

```js
const { httpGetText } = require('./http-get');
```

Replace the whole `fetchViaConfigDetailed` function (the docblock stays; the body from `return new Promise((resolve) => {` through its closing `});`) with:

```js
async function fetchViaConfigDetailed(provider, key) {
  const config = PROVIDER_FETCH_CONFIG[provider];
  const url = config.buildUrl ? config.buildUrl(key) : config.url;
  const res = await httpGetText(url, { headers: config.authHeader(key), timeoutMs: FETCH_TIMEOUT_MS });
  if (!res.ok) { return { rows: [], failure: res.failure }; }
  try {
    return { rows: config.normalize(res.body), failure: null };
  } catch (err) {
    return { rows: [], failure: { reason: 'parse-error', detail: err.message } };
  }
}
```

Keep `const FETCH_TIMEOUT_MS = 5000;` where it is. Do not touch any normalizer in this task.

- [ ] **Step 6: Run the fetcher suites**

```bash
cd /c/Users/sendt/code/amicus && npx jest tests/model-fetcher.test.js tests/model-fetcher-anthropic.test.js tests/utils/model-fetcher-enrichment.test.js tests/utils/http-get.test.js 2>&1 | tail -8 && wc -l src/utils/model-fetcher.js
```

Expected: all pass with the same counts as the Task 0 baseline plus 8; `model-fetcher.js` is now under 285 lines.

- [ ] **Step 7: Regenerate the inventory and commit**

```bash
cd /c/Users/sendt/code/amicus && node scripts/generate-docs.js && git add src/utils/http-get.js src/utils/model-fetcher.js tests/utils/http-get.test.js CLAUDE.md docs/architecture-map.md && git commit -m "refactor(fetcher): extract the always-resolves HTTPS GET into utils/http-get.js

model-fetcher.js sat at 299 of the 300-line gate and #218 P3 needs the same
timer/destroy/failure core for a second keyless fetch. One helper, one failure
vocabulary, and the fetcher suite's https.get mock keeps intercepting.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Lift Google's `outputTokenLimit` first-party

**Files:**
- Modify: `src/utils/model-fetcher.js` (google normalizer, the `contextLength: m.inputTokenLimit ?? null,` line)
- Test: `tests/model-fetcher.test.js` (google expectation), `tests/utils/model-fetcher-enrichment.test.js` (google expectation + new case)

**Interfaces:**
- Produces: google catalog rows carry `maxOutputTokens: number|null` from the ListModels `outputTokenLimit` field. Task 3's fill rule then treats google like openrouter: provider's own value wins, models.dev fills only nulls.

- [ ] **Step 1: Update the two exact-shape assertions and add the new case**

In `tests/model-fetcher.test.js`, the test `'should fetch and normalize Google models'` expectation becomes:

```js
      expect(result).toEqual([
        { id: 'google/gemini-3-flash', name: 'Gemini 3 Flash', contextLength: null, pricing: null, maxOutputTokens: null },
        { id: 'google/gemini-3-pro', name: 'Gemini 3 Pro', contextLength: null, pricing: null, maxOutputTokens: null }
      ]);
```

In `tests/utils/model-fetcher-enrichment.test.js`, replace the test `'google normalize maps inputTokenLimit to contextLength, pricing null'` with:

```js
  it('google normalize maps inputTokenLimit and outputTokenLimit, pricing null', () => {
    const body = JSON.stringify({ models: [
      { name: 'models/gemini-3.1-pro-preview', displayName: 'Gemini 3.1 Pro', inputTokenLimit: 2000000, outputTokenLimit: 65536 },
      // #218 P3: a row without outputTokenLimit stays null — models.dev fills it at refresh, never a guess here.
      { name: 'models/gemini-old', displayName: 'Old', inputTokenLimit: 32768 }
    ] });
    const rows = PROVIDER_FETCH_CONFIG.google.normalize(body);
    expect(rows[0]).toEqual({
      id: 'google/gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro',
      contextLength: 2000000, pricing: null, maxOutputTokens: 65536
    });
    expect(rows[1]).toEqual({
      id: 'google/gemini-old', name: 'Old', contextLength: 32768, pricing: null, maxOutputTokens: null
    });
  });
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd /c/Users/sendt/code/amicus && npx jest tests/model-fetcher.test.js tests/utils/model-fetcher-enrichment.test.js 2>&1 | grep -E "✕|Tests:" | head -5
```

Expected: 2 failing tests, both on the google row shape (missing `maxOutputTokens`).

- [ ] **Step 3: Implement**

In `src/utils/model-fetcher.js`, google normalizer, after `contextLength: m.inputTokenLimit ?? null,` add:

```js
        // #218 P3: Google's ListModels publishes the ceiling first-party; models.dev fills only what stays null.
        maxOutputTokens: m.outputTokenLimit ?? null,
```

- [ ] **Step 4: Run to verify they pass**

```bash
cd /c/Users/sendt/code/amicus && npx jest tests/model-fetcher.test.js tests/utils/model-fetcher-enrichment.test.js 2>&1 | tail -5 && wc -l src/utils/model-fetcher.js
```

Expected: PASS; file still under 290 lines.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/sendt/code/amicus && git add src/utils/model-fetcher.js tests/model-fetcher.test.js tests/utils/model-fetcher-enrichment.test.js && git commit -m "feat(catalog): google rows carry maxOutputTokens from ListModels outputTokenLimit (#218)

The field sat one key away from the inputTokenLimit the normalizer already
lifted. First-party where the provider publishes it; models.dev (next commit)
fills only what stays null.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `model-ceilings-modelsdev.js` — fetch, map, fill

**Files:**
- Create: `src/utils/model-ceilings-modelsdev.js`
- Test: `tests/utils/model-ceilings-modelsdev.test.js`

**Interfaces:**
- Consumes: `getJson` from Task 1 (default), injectable via `deps.getJson`.
- Produces:
  - `limitsFromModelsDev(api) → Map<string, {context: number|null, output: number|null}>` keyed by amicus catalog id (`anthropic/claude-opus-5`, `openrouter/moonshotai/kimi-k3`); only vendors `anthropic, openai, google, deepseek, openrouter`; a limit is kept only if positive.
  - `fillCeilings(rows, limits) → {filled, alreadyKnown, unknown, skippedRouters, skippedLocal}`; mutates rows in place; sets `row.limitSource = 'models.dev'` on a touched row.
  - `enrichCeilings(rows, deps?) → Promise<{source:'models.dev', failure: null|{reason,status?,detail?}, filled, alreadyKnown, unknown, skippedRouters, skippedLocal}>`; never rejects.
  - Constants `MODELS_DEV_URL`, `MODELS_DEV_TIMEOUT_MS = 10000`.

- [ ] **Step 1: Write the failing tests**

Create `tests/utils/model-ceilings-modelsdev.test.js`:

```js
'use strict';
/**
 * #218 P3 — direct-provider ceilings from models.dev.
 *
 * Rules under test (approved design 2026-09-04): provider's own value wins and
 * models.dev fills ONLY null contextLength/maxOutputTokens; zero/absent limits
 * are never written; openrouter/openrouter/* routers and local rows are
 * skipped; the fill is in place so `authoritative`/`local` flags ride through;
 * the fetch failure vocabulary is http-get's.
 */
const {
  MODELS_DEV_URL, MODELS_DEV_TIMEOUT_MS, limitsFromModelsDev, fillCeilings, enrichCeilings
} = require('../../src/utils/model-ceilings-modelsdev');

const API = {
  anthropic: { models: {
    'claude-opus-5': { limit: { context: 1000000, output: 128000 } },
    'claude-haiku-4-5-20251001': { limit: { context: 200000, output: 64000 } },
  } },
  openai: { models: {
    'gpt-5-nano': { limit: { context: 400000, input: 272000, output: 128000 } },
    'gpt-image-2': { limit: { context: 0, output: 0 } },
  } },
  google: { models: { 'gemini-3.7-flash': { limit: { context: 1048576, output: 65536 } } } },
  deepseek: { models: { 'deepseek-v4-pro': { limit: { context: 1000000, output: 384000 } } } },
  openrouter: { models: {
    'moonshotai/kimi-k3': { limit: { context: 1048576, output: 943718 } },
    'z-ai/glm-5.3': { limit: { context: 262144, output: 262144 } },
    'openrouter/auto': { limit: { context: 2000000, output: 2000000 } },
    'no/limits': {},
  } },
  someothervendor: { models: { 'x': { limit: { context: 1, output: 1 } } } },
};

describe('limitsFromModelsDev', () => {
  it('keys by amicus catalog id with the vendor prefix, two-slash openrouter ids included', () => {
    const m = limitsFromModelsDev(API);
    expect(m.get('anthropic/claude-opus-5')).toEqual({ context: 1000000, output: 128000 });
    expect(m.get('openrouter/moonshotai/kimi-k3')).toEqual({ context: 1048576, output: 943718 });
    expect(m.get('google/gemini-3.7-flash')).toEqual({ context: 1048576, output: 65536 });
    expect(m.get('deepseek/deepseek-v4-pro')).toEqual({ context: 1000000, output: 384000 });
  });

  it('drops zero/absent limits and vendors amicus does not catalog', () => {
    const m = limitsFromModelsDev(API);
    expect(m.has('openai/gpt-image-2')).toBe(false);
    expect(m.has('openrouter/no/limits')).toBe(false);
    expect(m.has('someothervendor/x')).toBe(false);
  });

  it('tolerates a non-object document', () => {
    expect(limitsFromModelsDev(null).size).toBe(0);
    expect(limitsFromModelsDev('<html>').size).toBe(0);
    expect(limitsFromModelsDev({ anthropic: {} }).size).toBe(0);
  });
});

describe('fillCeilings', () => {
  const limits = () => limitsFromModelsDev(API);

  it('fills only null fields, in place, and stamps limitSource', () => {
    const row = { id: 'anthropic/claude-opus-5', name: 'Opus', contextLength: null, pricing: null, authoritative: false };
    const rows = [row];
    const counts = fillCeilings(rows, limits());
    expect(rows[0]).toBe(row);
    expect(row).toEqual({ id: 'anthropic/claude-opus-5', name: 'Opus', contextLength: 1000000, maxOutputTokens: 128000, pricing: null, authoritative: false, limitSource: 'models.dev' });
    expect(counts).toEqual({ filled: 1, alreadyKnown: 0, unknown: 0, skippedRouters: 0, skippedLocal: 0 });
  });

  it("the provider's own value wins over models.dev (24 openrouter rows disagree live)", () => {
    const row = { id: 'openrouter/z-ai/glm-5.3', contextLength: 262144, maxOutputTokens: 131072 };
    const counts = fillCeilings([row], limits());
    expect(row.maxOutputTokens).toBe(131072);
    expect(row.limitSource).toBeUndefined();
    expect(counts.alreadyKnown).toBe(1);
  });

  it('fills the one missing field when the other is known', () => {
    const row = { id: 'google/gemini-3.7-flash', contextLength: 1048576, maxOutputTokens: null };
    fillCeilings([row], limits());
    expect(row).toMatchObject({ contextLength: 1048576, maxOutputTokens: 65536, limitSource: 'models.dev' });
  });

  it('skips openrouter/openrouter/* routers and local rows, counts unknown ids', () => {
    const rows = [
      { id: 'openrouter/openrouter/auto', contextLength: null, maxOutputTokens: null },
      { id: 'ollama/llama3', contextLength: null, local: true },
      { id: 'openai/gpt-4-0613', contextLength: null },
    ];
    const counts = fillCeilings(rows, limits());
    expect(rows[0].maxOutputTokens).toBeNull();
    expect(rows[1].contextLength).toBeNull();
    expect(rows[2].contextLength).toBeNull();
    expect(counts).toEqual({ filled: 0, alreadyKnown: 0, unknown: 1, skippedRouters: 1, skippedLocal: 1 });
  });

  it('ignores malformed rows', () => {
    expect(() => fillCeilings([null, {}, { id: 42 }], limits())).not.toThrow();
  });
});

describe('enrichCeilings', () => {
  it('fetches models.dev with a 10 s timeout and an amicus User-Agent, then fills', async () => {
    const getJson = jest.fn(async () => ({ ok: true, json: API }));
    const rows = [{ id: 'deepseek/deepseek-v4-pro', contextLength: null }];
    const out = await enrichCeilings(rows, { getJson });
    expect(getJson).toHaveBeenCalledWith(MODELS_DEV_URL, {
      timeoutMs: MODELS_DEV_TIMEOUT_MS,
      headers: { 'User-Agent': expect.stringMatching(/^amicus\/\d+\.\d+\.\d+/) },
    });
    expect(MODELS_DEV_URL).toBe('https://models.dev/api.json');
    expect(MODELS_DEV_TIMEOUT_MS).toBe(10000);
    expect(rows[0]).toMatchObject({ contextLength: 1000000, maxOutputTokens: 384000 });
    expect(out).toEqual({ source: 'models.dev', failure: null, filled: 1, alreadyKnown: 0, unknown: 0, skippedRouters: 0, skippedLocal: 0 });
  });

  it('leaves rows untouched and reports the failure when models.dev is unreachable', async () => {
    const getJson = jest.fn(async () => ({ ok: false, failure: { reason: 'timeout', detail: 'no response within 10000ms' } }));
    const rows = [{ id: 'anthropic/claude-opus-5', contextLength: null }];
    const out = await enrichCeilings(rows, { getJson });
    expect(rows[0]).toEqual({ id: 'anthropic/claude-opus-5', contextLength: null });
    expect(out).toEqual({ source: 'models.dev', failure: { reason: 'timeout', detail: 'no response within 10000ms' }, filled: 0, alreadyKnown: 0, unknown: 0, skippedRouters: 0, skippedLocal: 0 });
  });

  it('never rejects, even when the fetch throws', async () => {
    const getJson = jest.fn(async () => { throw new Error('boom'); });
    const out = await enrichCeilings([{ id: 'anthropic/claude-opus-5', contextLength: null }], { getJson });
    expect(out.failure).toEqual({ reason: 'exception', detail: 'boom' });
    expect(out.filled).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd /c/Users/sendt/code/amicus && npx jest tests/utils/model-ceilings-modelsdev.test.js 2>&1 | tail -4
```

Expected: FAIL, `Cannot find module '../../src/utils/model-ceilings-modelsdev'`.

- [ ] **Step 3: Create the module**

Create `src/utils/model-ceilings-modelsdev.js`:

```js
'use strict';

/**
 * @module model-ceilings-modelsdev
 * #218 P3 — output ceilings for the direct-provider catalog rows.
 *
 * WHY: computeModelLimit (model-output-limit.js) refuses to emit a `limit`
 * descriptor unless the catalog knows BOTH a model's context and its output
 * ceiling — a blanket budget against an unknown ceiling would send an
 * over-ceiling max_tokens. OpenRouter publishes its ceiling on /models; the
 * direct openai/anthropic/google/deepseek lists do not (google's does, lifted
 * first-party in model-fetcher.js). models.dev publishes all of them, keyless.
 *
 * WHAT THIS DOES NOT CHANGE: the engine already resolves every `{}` descriptor's
 * limit from its own models.dev copy. This gives AMICUS the same numbers so it
 * can clamp an outputBudget on direct routes and name a reservation in a
 * dead-leg note. It reads models.dev directly, not the engine's cache file,
 * because that file's path and refresh flags are engine-private.
 *
 * RULES (measured 2026-09-04 against live data, see the plan):
 *   - the provider's own value WINS; models.dev fills ONLY null fields
 *     (OpenRouter and models.dev disagree on 24 of 344 openrouter ceilings);
 *   - a zero/absent models.dev limit is never written (openai image rows);
 *   - `openrouter/openrouter/*` meta-routers are skipped (models.dev says
 *     2,000,000 for `auto`, a number no underlying model honours);
 *   - local rows are skipped; the fill is IN PLACE so `authoritative`/`local`
 *     flags on the row objects ride through untouched.
 */

const MODELS_DEV_URL = 'https://models.dev/api.json';
const MODELS_DEV_TIMEOUT_MS = 10000;
/** The vendors amicus catalogs under these exact id prefixes (model-fetcher.js normalizers). */
const VENDORS = ['anthropic', 'openai', 'google', 'deepseek', 'openrouter'];

/** @returns {number|null} a positive finite integer, else null (same discipline as model-output-limit.js) */
function positive(v) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) { return null; }
  const n = Math.floor(v);
  return n > 0 ? n : null;
}

/**
 * Index a models.dev api.json document by amicus catalog id.
 * @param {*} api parsed https://models.dev/api.json
 * @returns {Map<string, {context: number|null, output: number|null}>}
 */
function limitsFromModelsDev(api) {
  const out = new Map();
  if (!api || typeof api !== 'object') { return out; }
  for (const vendor of VENDORS) {
    const models = api[vendor] && api[vendor].models;
    if (!models || typeof models !== 'object') { continue; }
    for (const [modelId, m] of Object.entries(models)) {
      const limit = (m && typeof m === 'object' && m.limit) || {};
      const context = positive(limit.context);
      const output = positive(limit.output);
      if (context === null && output === null) { continue; }
      out.set(`${vendor}/${modelId}`, { context, output });
    }
  }
  return out;
}

/**
 * Fill null contextLength / maxOutputTokens in place. Provider value wins.
 * @param {Array<object>} rows catalog rows (mutated)
 * @param {Map<string, {context: number|null, output: number|null}>} limits
 * @returns {{filled: number, alreadyKnown: number, unknown: number, skippedRouters: number, skippedLocal: number}}
 */
function fillCeilings(rows, limits) {
  const counts = { filled: 0, alreadyKnown: 0, unknown: 0, skippedRouters: 0, skippedLocal: 0 };
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== 'object' || typeof row.id !== 'string') { continue; }
    if (row.local === true) { counts.skippedLocal++; continue; }
    if (row.id.startsWith('openrouter/openrouter/')) { counts.skippedRouters++; continue; }
    const lim = limits.get(row.id);
    if (!lim) { counts.unknown++; continue; }
    let touched = false;
    if (positive(row.contextLength) === null && lim.context !== null) { row.contextLength = lim.context; touched = true; }
    if (positive(row.maxOutputTokens) === null && lim.output !== null) { row.maxOutputTokens = lim.output; touched = true; }
    if (touched) { row.limitSource = 'models.dev'; counts.filled++; } else { counts.alreadyKnown++; }
  }
  return counts;
}

/**
 * Fetch models.dev and fill `rows`. ALWAYS resolves; the outcome travels with
 * the rows it describes (model-catalog.js persists it as ceilingEnrichment).
 * @param {Array<object>} rows catalog rows (mutated in place)
 * @param {{getJson?: Function}} [deps] test seam
 * @returns {Promise<{source: 'models.dev', failure: null|{reason: string, status?: number, detail?: string},
 *   filled: number, alreadyKnown: number, unknown: number, skippedRouters: number, skippedLocal: number}>}
 */
async function enrichCeilings(rows, deps = {}) {
  const zero = { filled: 0, alreadyKnown: 0, unknown: 0, skippedRouters: 0, skippedLocal: 0 };
  const getJson = deps.getJson || require('./http-get').getJson;
  let res;
  try {
    res = await getJson(MODELS_DEV_URL, {
      timeoutMs: MODELS_DEV_TIMEOUT_MS,
      headers: { 'User-Agent': `amicus/${require('../../package.json').version}` },
    });
  } catch (err) {
    return { source: 'models.dev', failure: { reason: 'exception', detail: err.message }, ...zero };
  }
  if (!res || !res.ok) {
    return { source: 'models.dev', failure: (res && res.failure) || { reason: 'exception', detail: 'no result' }, ...zero };
  }
  return { source: 'models.dev', failure: null, ...fillCeilings(rows, limitsFromModelsDev(res.json)) };
}

module.exports = { MODELS_DEV_URL, MODELS_DEV_TIMEOUT_MS, limitsFromModelsDev, fillCeilings, enrichCeilings };
```

- [ ] **Step 4: Run to verify it passes**

```bash
cd /c/Users/sendt/code/amicus && npx jest tests/utils/model-ceilings-modelsdev.test.js 2>&1 | tail -5 && wc -l src/utils/model-ceilings-modelsdev.js
```

Expected: PASS, 11 tests; file about 110 lines.

- [ ] **Step 5: Regenerate the inventory and commit**

```bash
cd /c/Users/sendt/code/amicus && node scripts/generate-docs.js && git add src/utils/model-ceilings-modelsdev.js tests/utils/model-ceilings-modelsdev.test.js CLAUDE.md docs/architecture-map.md && git commit -m "feat(catalog): models.dev ceiling fill for direct-provider rows (#218 P3)

Pure fill rules: provider value wins, only nulls are filled, zero limits and
openrouter/openrouter/* routers are skipped, local rows untouched, in place so
row flags survive. Fetch is keyless with a 10 s timeout and an amicus UA.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Hook enrichment into `refreshCatalog` and persist the outcome

**Files:**
- Modify: `src/utils/model-catalog.js` (`_fetchAllModels` lazy-require block at line 22; `writeCache` at 72-82; `refreshCatalog` at 108-129; `getCatalogInfo` at 159-171)
- Modify: `tests/model-catalog.test.js`, `tests/model-catalog-failures.test.js`, `tests/model-catalog-local.test.js`, `tests/utils/model-catalog-v2.test.js`, and any other test file found by the grep in Step 1
- Test: `tests/model-catalog-ceilings.test.js`

**Interfaces:**
- Consumes: `enrichCeilings(rows)` from Task 3 through a lazy require `_enrichCeilings(rows)` so `jest.doMock('../src/utils/model-ceilings-modelsdev')` intercepts.
- Produces: cache document field `ceilingEnrichment: object|null`; `getCatalogInfo()` returns `ceilingEnrichment` (null when absent); `writeCache(models, providerFailures, ceilingEnrichment)`.

- [ ] **Step 1: Find every unit test that could trigger a real refresh**

```bash
cd /c/Users/sendt/code/amicus && grep -rl "src/utils/model-catalog'" tests/ | xargs grep -l "model-fetcher" | sort
```

Expected: at least `tests/model-catalog.test.js`, `tests/model-catalog-failures.test.js`, `tests/model-catalog-local.test.js`, `tests/utils/model-catalog-v2.test.js`. Every file listed gets the mock in Step 2 (a test that reaches `refreshCatalog` with a successful fetch would otherwise download 4.5 MB from models.dev).

- [ ] **Step 2: Add the enrichment mock to each listed file's `beforeEach`**

Immediately after the `jest.doMock('../src/utils/api-key-store', ...)` line in each `beforeEach` (path prefix `../../` in `tests/utils/`), add:

```js
    // #218 P3: refreshCatalog enriches ceilings from models.dev; keep the unit suite offline.
    jest.doMock('../src/utils/model-ceilings-modelsdev', () => ({
      enrichCeilings: jest.fn(async () => ({ source: 'models.dev', failure: null, filled: 0, alreadyKnown: 0, unknown: 0, skippedRouters: 0, skippedLocal: 0 })),
    }));
```

- [ ] **Step 3: Write the failing hook tests**

Create `tests/model-catalog-ceilings.test.js`:

```js
'use strict';
/**
 * #218 P3 — refreshCatalog fills direct-provider ceilings from models.dev.
 *
 * Contract: enrichment runs ONLY on a refresh that passed the floor-only check
 * (a failed refresh is never enriched — "stale cache stands"), on the very row
 * objects that get written, and its outcome is persisted beside the rows and
 * exposed by getCatalogInfo. A failing or throwing enrichment never fails the
 * refresh.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

describe('model-catalog: ceiling enrichment (#218 P3)', () => {
  let dir;
  beforeEach(() => {
    jest.resetModules();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-catceil-'));
    jest.doMock('../src/utils/config', () => ({ getConfigDir: () => dir }));
    jest.doMock('../src/utils/api-key-store', () => ({ readApiKeyValues: () => ({ openrouter: 'k' }) }));
  });
  afterEach(() => { jest.dontMock('../src/utils/config'); fs.rmSync(dir, { recursive: true, force: true }); });

  const OK = { source: 'models.dev', failure: null, filled: 1, alreadyKnown: 2, unknown: 3, skippedRouters: 0, skippedLocal: 0 };

  function mockFetcher(rows) {
    jest.doMock('../src/utils/model-fetcher', () => ({
      fetchAllModelsDetailed: jest.fn().mockResolvedValue({ rows, failures: [] }),
    }));
  }
  function mockEnrich(impl) {
    const enrichCeilings = jest.fn(impl);
    jest.doMock('../src/utils/model-ceilings-modelsdev', () => ({ enrichCeilings }));
    return enrichCeilings;
  }

  test('enriches the fetched rows in place and persists the outcome', async () => {
    const rows = [{ id: 'openrouter/x', name: 'x' }, { id: 'anthropic/claude-opus-5', name: 'Opus', contextLength: null }];
    mockFetcher(rows);
    const enrich = mockEnrich(async (r) => { r[1].contextLength = 1000000; r[1].maxOutputTokens = 128000; return OK; });
    const { refreshCatalog, getCatalogInfo, readCache } = require('../src/utils/model-catalog');
    const models = await refreshCatalog();
    expect(enrich).toHaveBeenCalledTimes(1);
    expect(enrich.mock.calls[0][0]).toBe(rows);              // same array, not a copy
    expect(models.find(m => m.id === 'anthropic/claude-opus-5')).toMatchObject({ contextLength: 1000000, maxOutputTokens: 128000 });
    expect(readCache().models.find(m => m.id === 'anthropic/claude-opus-5').maxOutputTokens).toBe(128000);
    expect(readCache().ceilingEnrichment).toEqual(OK);
    expect((await getCatalogInfo()).ceilingEnrichment).toEqual(OK);
  });

  test('a floor-only (failed) refresh is never enriched', async () => {
    mockFetcher([{ id: 'anthropic/claude-opus-5', name: 'Opus', authoritative: false }]);
    const enrich = mockEnrich(async () => OK);
    const { refreshCatalog, getCatalogInfo } = require('../src/utils/model-catalog');
    expect(await refreshCatalog()).toEqual([]);
    expect(enrich).not.toHaveBeenCalled();
    expect((await getCatalogInfo({ maxAgeMs: Number.POSITIVE_INFINITY })).ceilingEnrichment).toBeNull();
  });

  test('an unreachable models.dev is recorded and the refresh still succeeds', async () => {
    mockFetcher([{ id: 'openrouter/x', name: 'x' }]);
    const FAIL = { ...OK, filled: 0, alreadyKnown: 0, unknown: 0, failure: { reason: 'timeout', detail: 'no response within 10000ms' } };
    mockEnrich(async () => FAIL);
    const { refreshCatalog, readCache } = require('../src/utils/model-catalog');
    expect((await refreshCatalog()).length).toBe(1);
    expect(readCache().ceilingEnrichment).toEqual(FAIL);
  });

  test('a throwing enrichment is caught, recorded as an exception, and the rows are still written', async () => {
    mockFetcher([{ id: 'openrouter/x', name: 'x' }]);
    mockEnrich(async () => { throw new Error('kaboom'); });
    const { refreshCatalog, readCache } = require('../src/utils/model-catalog');
    expect((await refreshCatalog()).length).toBe(1);
    expect(readCache().ceilingEnrichment).toEqual({ source: 'models.dev', failure: { reason: 'exception', detail: 'kaboom' }, filled: 0 });
  });

  test('getCatalogInfo reports null when the cache predates the field', async () => {
    const { catalogPath, getCatalogInfo, CATALOG_SCHEMA_VERSION } = require('../src/utils/model-catalog');
    fs.writeFileSync(catalogPath(), JSON.stringify({ schemaVersion: CATALOG_SCHEMA_VERSION, fetchedAt: Date.now(), models: [{ id: 'openrouter/old', name: 'old' }] }));
    expect((await getCatalogInfo()).ceilingEnrichment).toBeNull();
  });
});
```

- [ ] **Step 4: Run to verify the new tests fail and the mocked suites still pass**

```bash
cd /c/Users/sendt/code/amicus && npx jest tests/model-catalog-ceilings.test.js tests/model-catalog.test.js tests/model-catalog-failures.test.js tests/model-catalog-local.test.js tests/utils/model-catalog-v2.test.js 2>&1 | grep -E "✕|✓|Tests:|Suites:" | tail -12
```

Expected: the four existing suites pass; `model-catalog-ceilings.test.js` fails on the first four tests (enrichment never called / `ceilingEnrichment` undefined). The fifth may pass already.

- [ ] **Step 5: Implement the hook**

In `src/utils/model-catalog.js`:

After line 22 (`async function _fetchAllModels(keys) ...`) add:

```js
async function _enrichCeilings(rows) { return require('./model-ceilings-modelsdev').enrichCeilings(rows); }
```

Replace `writeCache`:

```js
/**
 * Write a successful fetch: fresh models/fetchedAt, outcome fields cleared.
 * @param {Array} models
 * @param {Array} [providerFailures]
 * @param {object|null} [ceilingEnrichment] #218 P3 outcome for THESE rows (model-ceilings-modelsdev.js)
 */
function writeCache(models, providerFailures, ceilingEnrichment) {
  writeCacheDoc({
    schemaVersion: CATALOG_SCHEMA_VERSION,
    fetchedAt: Date.now(),
    models,
    // #209: which providers were ATTEMPTED and REJECTED for this fetch. Persisted
    // alongside the rows because it describes THESE rows -- a cache served later
    // is still a catalog whose deepseek namespace is empty for a reason.
    providerFailures: Array.isArray(providerFailures) ? providerFailures : [],
    ceilingEnrichment: ceilingEnrichment || null,
  });
}
```

In `refreshCatalog`, replace the two lines `writeCache(models, providerFailures);` / `return models;` with:

```js
  // #218 P3: fill direct-provider ceilings from models.dev AFTER the floor-only
  // check (a failed refresh is never enriched, so "stale cache stands" holds)
  // and IN PLACE on the fresh row objects, so `authoritative`/`local` ride
  // through untouched. enrichCeilings never rejects; the belt-and-braces catch
  // keeps a bug there from failing a refresh that already succeeded.
  let ceilingEnrichment;
  try {
    ceilingEnrichment = await _enrichCeilings(models);
  } catch (err) {
    ceilingEnrichment = { source: 'models.dev', failure: { reason: 'exception', detail: err.message }, filled: 0 };
  }
  writeCache(models, providerFailures, ceilingEnrichment);
  return models;
```

In `getCatalogInfo`, after the `providerFailures:` line add:

```js
    // #218 P3: where the direct-provider ceilings came from, or why they did not.
    ceilingEnrichment: (doc && doc.ceilingEnrichment) || null,
```

Update the `@returns` docblock of `getCatalogInfo` to include `ceilingEnrichment: object|null`.

- [ ] **Step 6: Run to verify everything passes**

```bash
cd /c/Users/sendt/code/amicus && npx jest tests/model-catalog-ceilings.test.js tests/model-catalog.test.js tests/model-catalog-failures.test.js tests/model-catalog-local.test.js tests/utils/model-catalog-v2.test.js 2>&1 | tail -6 && wc -l src/utils/model-catalog.js
```

Expected: all pass; `model-catalog.js` under 200 lines.

- [ ] **Step 7: Prove the unit suite stays offline**

```bash
cd /c/Users/sendt/code/amicus && grep -rn "model-ceilings-modelsdev" tests/ | grep -c doMock
```

Expected: a count equal to the number of files from Step 1 plus the new ceilings test.

⚠️ Superseded (final review 2026-09-04): Node's https.get ignores HTTPS_PROXY, so this run could not fail. The control is the doMock stanza in every catalog suite; a future offline proof must patch https.get to throw (e.g. a --setupFiles shim) rather than set a proxy.

- [ ] **Step 8: Commit**

```bash
cd /c/Users/sendt/code/amicus && git add src/utils/model-catalog.js tests/model-catalog-ceilings.test.js tests/model-catalog.test.js tests/model-catalog-failures.test.js tests/model-catalog-local.test.js tests/utils/model-catalog-v2.test.js && git commit -m "feat(catalog): refreshCatalog fills ceilings from models.dev and persists the outcome (#218 P3)

Hooked at the one seam every refresh entry (CLI, setup, Electron) shares, after
the floor-only check and in place on the written rows. Outcome rides the cache
doc as ceilingEnrichment; unit suites mock the module so nothing downloads.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

(If Step 1 listed additional files, add them to the `git add`.)

---

### Task 5: `amicus models --refresh` reports the ceilings

**Files:**
- Modify: `src/utils/result-schema.js` (`buildCatalogDoc`, line 189)
- Modify: `src/sidecar/models.js` (`runRefresh`, lines 88-116)
- Test: `tests/sidecar/models-command.test.js`

**Interfaces:**
- Consumes: `getCatalogInfo().ceilingEnrichment` from Task 4.
- Produces: `buildCatalogDoc({..., ceilingEnrichment})` → doc field `ceilingEnrichment: object|null` (additive within `SCHEMA_VERSION`, no bump); text line `Ceilings: ...` after `Refreshed catalog: N models.`

- [ ] **Step 1: Read the existing mock and write the failing tests**

Read `tests/sidecar/models-command.test.js` lines 1-62 to see how `getCatalogInfo` is mocked (the `jest.doMock('../../src/utils/model-catalog', ...)` at line 16). Extend that mock's `getCatalogInfo` return value with `ceilingEnrichment: null` as the default, then add these tests inside `describe('amicus models', ...)` next to `'--refresh refreshes and reports the count'`:

```js
  it('--refresh prints the ceilings line when models.dev filled rows', async () => {
    const handleModels = load({ ceilingEnrichment: { source: 'models.dev', failure: null, filled: 12, alreadyKnown: 380, unknown: 5, skippedRouters: 6, skippedLocal: 0 } });
    const { code, out } = await captureStdout(() => handleModels({ _: ['models'], refresh: true }));
    expect(code).toBe(0);
    expect(out).toContain('Ceilings: 12 rows filled from models.dev (380 already known, 5 unknown to models.dev)');
  });

  it('--refresh says so when models.dev was unreachable', async () => {
    const handleModels = load({ ceilingEnrichment: { source: 'models.dev', failure: { reason: 'timeout', detail: 'no response within 10000ms' }, filled: 0 } });
    const { out } = await captureStdout(() => handleModels({ _: ['models'], refresh: true }));
    expect(out).toContain('Ceilings: models.dev unreachable (timeout: no response within 10000ms); rows without a ceiling keep the engine default and outputBudget cannot clamp them');
  });

  it('--refresh --json carries ceilingEnrichment', async () => {
    const enrichment = { source: 'models.dev', failure: null, filled: 1, alreadyKnown: 0, unknown: 0, skippedRouters: 0, skippedLocal: 0 };
    const handleModels = load({ ceilingEnrichment: enrichment });
    const { out } = await captureStdout(() => handleModels({ _: ['models'], refresh: true, json: true }));
    expect(JSON.parse(out).ceilingEnrichment).toEqual(enrichment);
  });
```

Adapt `load(...)` to however that file's loader function is named and parameterised (it is the function at lines 14-52 that installs the `doMock`s and returns `require('../../src/sidecar/models')`); if it takes no options today, give it an optional `{ ceilingEnrichment }` argument that is merged into the mocked `getCatalogInfo` result. Keep every existing test unchanged.

- [ ] **Step 2: Run to verify they fail**

```bash
cd /c/Users/sendt/code/amicus && npx jest tests/sidecar/models-command.test.js 2>&1 | grep -E "✕|Tests:"
```

Expected: 3 failures (the two text lines absent; JSON field undefined).

- [ ] **Step 3: Implement**

In `src/utils/result-schema.js`, `buildCatalogDoc`:

```js
function buildCatalogDoc({ models, fetchedAt, refreshed = false, search = null,
  lastRefreshAttempt = null, lastRefreshError = null, ceilingEnrichment = null }) {
  return {
    schemaVersion: SCHEMA_VERSION,
    type: 'model-catalog',
    fetchedAt: fetchedAt || null,
    refreshed,
    search,
    count: models.length,
    models,
    lastRefreshAttempt: lastRefreshAttempt || null,
    lastRefreshError: lastRefreshError || null,
    ceilingEnrichment: ceilingEnrichment || null, // #218 P3: additive within SCHEMA_VERSION
  };
}
```

In `src/sidecar/models.js`, add above `runRefresh`:

```js
/** #218 P3: one honest line about where the direct-provider ceilings came from. */
function fmtCeilingLine(e) {
  if (!e) { return 'Ceilings: not attempted'; }
  if (e.failure) {
    const f = e.failure;
    const why = f.reason + (f.status ? ` ${f.status}` : '') + (f.detail ? `: ${f.detail}` : '');
    return `Ceilings: models.dev unreachable (${why}); rows without a ceiling keep the engine default and outputBudget cannot clamp them`;
  }
  return `Ceilings: ${e.filled} rows filled from models.dev (${e.alreadyKnown} already known, ${e.unknown} unknown to models.dev)`;
}
```

In `runRefresh`, change the destructure to `const { fetchedAt, lastRefreshAttempt, lastRefreshError, ceilingEnrichment } = await getCatalogInfo({ maxAgeMs: Number.POSITIVE_INFINITY });`, pass `ceilingEnrichment` into `buildCatalogDoc({...})` in the `--json` branch, and after `process.stdout.write(\`Refreshed catalog: ${models.length} models.\n\`);` add:

```js
  process.stdout.write(fmtCeilingLine(ceilingEnrichment) + '\n');
```

- [ ] **Step 4: Run to verify they pass and the gate holds**

```bash
cd /c/Users/sendt/code/amicus && npx jest tests/sidecar/models-command.test.js tests/utils/result-schema*.test.js 2>&1 | tail -5 && wc -l src/sidecar/models.js src/utils/result-schema.js
```

Expected: PASS; both files at or under 300 lines (`result-schema.js` ≈ 297).

- [ ] **Step 5: Commit**

```bash
cd /c/Users/sendt/code/amicus && git add src/utils/result-schema.js src/sidecar/models.js tests/sidecar/models-command.test.js && git commit -m "feat(models): --refresh reports where the ceilings came from (#218 P3)

Text and --json both carry the models.dev outcome, including the unreachable
case, so a refresh that could not fill direct-provider ceilings says so instead
of leaving outputBudget silently unable to clamp them.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Docs and records for P3

**Files:**
- Modify: `docs/configuration.md` (the "It needs a catalog that knows each model's ceiling" bullet, lines 92-95)
- Modify: `docs/usage.md` (lines 27 and 384)
- Modify: `CHANGELOG.md` (new `## [Unreleased]` section above `## [4.9.3]`)
- Modify: `BACKLOG.md` (new `## v4.9.4 records` section immediately above `## v4.9.3 records` at line 6934)

- [ ] **Step 1: Rewrite the configuration bullet**

Replace the bullet beginning `- **It needs a catalog that knows each model's ceiling.**` with:

```markdown
- **It needs a catalog that knows each model's ceiling.** Run `amicus models --refresh` after setting
  it. OpenRouter rows carry OpenRouter's own ceiling and Google rows carry Google's; the direct
  `openai` / `anthropic` / `deepseek` rows (and any row still missing a number) are filled from
  [models.dev](https://models.dev) at refresh, and the refresh output says how many were filled or why
  none could be. A model neither source knows keeps the old behaviour rather than receiving a guessed
  limit.
```

- [ ] **Step 2: Update the two usage lines**

`docs/usage.md:27` and `:384`: change the trailing comment to `# Force-fetch from provider APIs (+ ceilings from models.dev)`.

- [ ] **Step 3: Add the changelog entry**

Insert above `## [4.9.3] - 2026-08-28`:

```markdown
## [Unreleased]

### Added

- **Direct-provider output ceilings (#218 P3).** `amicus models --refresh` now fills
  `contextLength` / `maxOutputTokens` for `anthropic`, `openai` and `deepseek` rows from the keyless
  [models.dev](https://models.dev) index, and lifts Google's own `outputTokenLimit` first-party. The
  provider's own number always wins; models.dev fills only what is null, never a zero, and never
  the `openrouter/openrouter/*` meta-routers. The refresh prints the outcome (`Ceilings: …`) and
  `--json` carries it as `ceilingEnrichment`. Effect: `outputBudget` can now clamp direct routes
  too, which 4.9.3 documented as impossible because those lists "don't publish one".
- **`scripts/probe-max-tokens.js`.** A zero-spend wire probe: a local capture server plays the
  provider so the pinned engine's outbound `max_tokens` / `reasoning` / `thinking` fields can be
  read under every descriptor, env-flag and prompt shape amicus can produce. Re-run after every
  engine bump.

### Changed

- `src/utils/http-get.js` now owns the always-resolves HTTPS GET that `model-fetcher.js` carried
  inline; the failure vocabulary (`timeout` / `http-status` / `network-error` / `parse-error`) is
  unchanged.
```

- [ ] **Step 4: Open the v4.9.4 records section in the BACKLOG**

Insert immediately above the line `## v4.9.3 records — dispositions and rulings made in-cycle (2026-08-28)`:

```markdown
## v4.9.4 records — dispositions and rulings made in-cycle (2026-09-04)

Filed past-tense in the same commit as each fix, per the falsified-record rule.

- [x] **#218 P3 — direct-provider ceilings from models.dev (2026-09-04).** The 4.9.3 docs said the
  direct `openai` / `anthropic` / `google` / `deepseek` lists "don't publish one"; Google's
  ListModels does (`outputTokenLimit`, one key from the `inputTokenLimit` already lifted) and
  models.dev publishes all of them keyless (anthropic 14/14, openai 42/47, google 39/39,
  deepseek 3/3, every `ANTHROPIC_MODELS` id). Measured before writing the fill rule: OpenRouter's
  `top_provider.max_completion_tokens` disagrees with models.dev on 24 of 344 openrouter rows, so
  the provider's own value wins and models.dev fills nulls only; the 6 ceiling-less openrouter
  rows are all `openrouter/openrouter/*` meta-routers (models.dev says 2,000,000 for `auto`) and
  are skipped; models.dev carries `{context:0, output:0}` for openai image rows, never written.
  Hooked at `model-catalog.js :: refreshCatalog` — the one seam the CLI, `setup` and the Electron
  refresh button share — after the floor-only check, in place on the written rows. The engine
  already merges models.dev limits into every `{}` descriptor, so this changes what AMICUS can
  clamp and name, not what the engine knows.
- [x] **The repo's engine copy was stale, and its source map misled #218's research (2026-09-04).**
  `node_modules` held opencode 1.2.20 (`package-lock` pins 1.18.15) because `npm ci` had not run
  since the pin. Three engine-behaviour claims in the #218 research comment were read from the
  1.2.20 source map and are wrong for the pin: the OpenRouter effort table (1.2.20 sent effort only
  for gpt/gemini-3/claude ids; 1.18.15 maps every OpenRouter model's effort), the Anthropic
  thinking-budget selection (1.18.15 selects by the models.dev row's `reasoning_options`), and the
  flag parser (an Effect `Config.number` in the pin). `npm ci` aligned the copy; 1.18.15 ships no
  source map, so engine claims are now measured by `scripts/probe-max-tokens.js`, not read.
```

- [ ] **Step 5: Verify docs gates and commit**

```bash
cd /c/Users/sendt/code/amicus && node scripts/validate-docs.js --full 2>&1 | tail -3 && node scripts/check-citations.js --all 2>&1 | tail -2 && git add docs/configuration.md docs/usage.md CHANGELOG.md BACKLOG.md && git commit -m "docs: records for the models.dev ceiling fill and the stale engine copy (#218)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Expected: both gates clean.

---

### Task 7: The wire probe — write it, run it, record the measurements

**Files:**
- Create: `scripts/probe-max-tokens.js`
- Modify: `BACKLOG.md` (the v4.9.4 records section from Task 6)
- Output (gitignored): `output/218-probe-2026-09-04.json`

**Interfaces:**
- Consumes: `ensureNodeModulesBinInPath` from `src/utils/path-setup.js`; `sendPrompt` from `src/opencode-client.js` (case F1 only); `@opencode-ai/sdk` via dynamic `import()`.
- Produces: a markdown table on stdout and a JSON file `{ engine: {...}, providers: {...}, cases: [...] }`.

- [ ] **Step 1: Create `scripts/probe-max-tokens.js`**

```js
#!/usr/bin/env node
'use strict';

/**
 * Wire probe for issue #218: what max_tokens / reasoning / thinking does the
 * PINNED opencode engine actually put on the outbound provider request?
 *
 * Zero spend, no keys. A local capture server plays the provider: the real
 * `openrouter` provider is pointed at it through provider.openrouter.options.baseURL
 * (so the bundled @openrouter/ai-sdk-provider builds the request), the direct
 * `anthropic` provider the same way, and a custom openai-compatible block plays
 * "a model the engine has never heard of". Every request body is captured; the
 * server answers chat completions with an SSE stream whose finish_reason is
 * "length" (so the engine's assistant message records finish) and refuses
 * everything else with a 400 (the body was already captured).
 *
 * Usage:
 *   node scripts/probe-max-tokens.js [--out output/218-probe.json] [--only A,B,F1]
 *
 * Re-run after every engine bump: OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX is an
 * experimental flag, and the effort table changed between 1.2.20 and 1.18.15.
 * The header line names the engine version and binary that served the run.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const { ensureNodeModulesBinInPath } = require('../src/utils/path-setup');
ensureNodeModulesBinInPath();

const KIMI = 'moonshotai/kimi-k3';   // models.dev: effort low|high|max, ceiling 943718
const QWEN = 'qwen/qwen3.8-max';      // models.dev: effort minimal..xhigh, ceiling 131072
const HAIKU = 'claude-haiku-4-5';     // models.dev: budget_tokens (min 1024), ceiling 64000
const OR = (id) => ({ providerID: 'openrouter', modelID: id });
const AN = (id) => ({ providerID: 'anthropic', modelID: id });
const CUSTOM = { providerID: 'probe', modelID: 'unknown-model' };

// ---------------------------------------------------------------- capture server
function sseLength(res, model) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const chunk = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
  chunk({ id: 'probe', object: 'chat.completion.chunk', created: 0, model,
    choices: [{ index: 0, delta: { role: 'assistant', content: 'ok' }, finish_reason: null }] });
  chunk({ id: 'probe', object: 'chat.completion.chunk', created: 0, model,
    choices: [{ index: 0, delta: {}, finish_reason: 'length' }],
    usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 } });
  res.write('data: [DONE]\n\n');
  res.end();
}

function startCapture() {
  const captures = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let body = raw;
      try { body = JSON.parse(raw); } catch { /* keep raw text */ }
      const headers = { ...req.headers };
      delete headers.authorization; delete headers['x-api-key'];
      captures.push({ at: Date.now(), method: req.method, url: req.url, headers, body });
      if (req.method === 'POST' && /\/chat\/completions(\?.*)?$/.test(req.url)) {
        if (body && body.stream === false) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ id: 'probe', object: 'chat.completion',
            choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'length' }],
            usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 } }));
          return;
        }
        sseLength(res, body && body.model);
        return;
      }
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'probe: request captured' } }));
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({
      origin: `http://127.0.0.1:${server.address().port}`,
      captures,
      close: () => new Promise((r) => server.close(() => r())),
    }));
  });
}

// ---------------------------------------------------------------- engine
function resolveEngineBinary() {
  const names = process.platform === 'win32' ? ['opencode.exe', 'opencode.cmd', 'opencode'] : ['opencode'];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) { continue; }
    for (const n of names) { const p = path.join(dir, n); if (fs.existsSync(p)) { return p; } }
  }
  return '(opencode not found on PATH)';
}

/** The SAME shape amicus hands the engine (opencode-client.js :: buildServerOptions). */
function chatAgent() {
  return { description: 'wire probe', mode: 'primary', permission: { edit: 'ask', bash: 'ask', webfetch: 'allow' } };
}

function buildConfig(origin, c) {
  const cfg = { agent: { chat: chatAgent() }, provider: {} };
  if (c.or) { cfg.provider.openrouter = { options: { baseURL: `${origin}/api/v1`, apiKey: 'probe-key' }, models: c.or }; }
  if (c.anthropic) { cfg.provider.anthropic = { options: { baseURL: `${origin}/v1`, apiKey: 'probe-key' }, models: c.anthropic }; }
  if (c.custom) {
    cfg.provider.probe = { npm: '@ai-sdk/openai-compatible', name: 'probe',
      options: { baseURL: `${origin}/v1`, apiKey: 'probe-key' },
      models: { 'unknown-model': { name: 'unknown-model' } } };
  }
  return cfg;
}

const FLAG = 'OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX';

async function startEngine(sdk, config, env) {
  // Same discipline PR 2 will ship: set only around the synchronous spawn, restore
  // before awaiting. The pinned SDK spreads process.env before its first await.
  const saved = process.env[FLAG];
  if (env === undefined) { delete process.env[FLAG]; } else { process.env[FLAG] = env; }
  let pending;
  try {
    pending = sdk.createOpencodeServer({ hostname: '127.0.0.1', port: 0, timeout: 60000, config });
  } finally {
    if (saved === undefined) { delete process.env[FLAG]; } else { process.env[FLAG] = saved; }
  }
  const server = await pending;
  const client = sdk.createOpencodeClient({ baseUrl: server.url });
  return { server, client };
}

async function providersDump(client, providerID, modelID) {
  const r = await client.config.providers();
  const list = (r.data && r.data.providers) || [];
  const p = list.find((x) => x.id === providerID);
  const m = p && p.models && p.models[modelID];
  return m ? { keys: Object.keys(m), limit: m.limit ?? null, variants: m.variants ?? '(not exposed)', options: m.options ?? null } : { missing: true, providerIds: list.map((x) => x.id) };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function send(client, captures, c) {
  const created = await client.session.create({ body: { title: `probe ${c.id}` } });
  const sessionId = created.data && created.data.id;
  const engineVersion = (created.data && (created.data.version || (created.data.session && created.data.session.version))) || null;
  const before = captures.length;
  const parts = [{ type: 'text', text: 'ping' }];
  let res;
  if (c.viaAmicus) {
    const { sendPrompt } = require('../src/opencode-client');
    res = await sendPrompt(client, sessionId, { model: `${c.model.providerID}/${c.model.modelID}`, parts, agent: 'chat', reasoning: c.reasoning });
  } else {
    res = await client.session.promptAsync({ path: { id: sessionId }, body: { model: c.model, agent: 'chat', parts, ...(c.extra || {}) } });
  }
  const status = (res && res.response && res.response.status) || null;
  const error = res && res.error ? JSON.stringify(res.error).slice(0, 240) : null;
  const deadline = Date.now() + 20000;
  while (captures.length === before && Date.now() < deadline) { await sleep(100); }
  const wire = captures.slice(before).find((x) => x.method === 'POST') || null;
  let assistant = null;
  for (let i = 0; i < 25 && !(assistant && (assistant.finish || assistant.error)); i++) {
    await sleep(200);
    const msgs = await client.session.messages({ path: { id: sessionId } });
    const infos = (msgs.data || []).map((m) => m.info).filter((m) => m && m.role === 'assistant');
    assistant = infos[infos.length - 1] || null;
  }
  return { engineVersion, status, error, wire, assistant: assistant ? {
    keys: Object.keys(assistant), finish: assistant.finish ?? null,
    error: assistant.error ? (assistant.error.name || assistant.error.type || 'error') : null,
    variant: assistant.variant ?? null, tokens: assistant.tokens ?? null } : null };
}

// ---------------------------------------------------------------- case matrix
const CTX = 1048576;
const CASES = [
  { id: 'A',  title: 'bare {} descriptor', or: { [KIMI]: {} }, model: OR(KIMI), expect: 'max_tokens 32000, no reasoning' },
  { id: 'B',  title: 'limit.output 4096', or: { [KIMI]: { limit: { context: CTX, output: 4096 } } }, model: OR(KIMI), expect: '4096' },
  { id: 'C1', title: 'env 64000 + limit.output 100000', env: '64000', or: { [KIMI]: { limit: { context: CTX, output: 100000 } } }, model: OR(KIMI), expect: '64000' },
  { id: 'C2', title: 'env 64000 + limit.output 50000', env: '64000', or: { [QWEN]: { limit: { context: 1000000, output: 50000 } } }, model: OR(QWEN), expect: '50000' },
  { id: 'C3', title: 'env 64000 + bare {} (engine ceiling 943718)', env: '64000', or: { [KIMI]: {} }, model: OR(KIMI), expect: '64000' },
  { id: 'D1', title: 'env 64000abc (malformed)', env: '64000abc', or: { [KIMI]: {} }, model: OR(KIMI), expect: '32000 silently' },
  { id: 'D2', title: 'env 0', env: '0', or: { [KIMI]: {} }, model: OR(KIMI), expect: '32000' },
  { id: 'E1', title: 'options.max_tokens 4096', or: { [KIMI]: { options: { max_tokens: 4096 } } }, model: OR(KIMI), expect: '32000 (dropped)' },
  { id: 'E2', title: 'options.reasoning {effort:low}', or: { [KIMI]: { options: { reasoning: { effort: 'low' } } } }, model: OR(KIMI), expect: 'reasoning effort low on the wire' },
  { id: 'F1', title: 'amicus sendPrompt today: body.reasoning {effort:low}', or: { [KIMI]: {} }, model: OR(KIMI), viaAmicus: true, reasoning: { effort: 'low' }, expect: 'NO reasoning on the wire' },
  { id: 'F2', title: "prompt variant 'low' (kimi: low|high|max)", or: { [KIMI]: {} }, model: OR(KIMI), extra: { variant: 'low' }, expect: 'reasoning effort low' },
  { id: 'F3', title: "prompt variant 'medium' (kimi has no medium)", or: { [KIMI]: {} }, model: OR(KIMI), extra: { variant: 'medium' }, expect: 'record: silent no-op or error' },
  { id: 'F4', title: "prompt variant 'medium' (qwen has medium)", or: { [QWEN]: {} }, model: OR(QWEN), extra: { variant: 'medium' }, expect: 'reasoning effort medium' },
  { id: 'H1', title: 'direct anthropic haiku {}', anthropic: { [HAIKU]: {} }, model: AN(HAIKU), expect: '32000' },
  { id: 'H2', title: 'direct anthropic haiku {} + env 64000', env: '64000', anthropic: { [HAIKU]: {} }, model: AN(HAIKU), expect: '64000 (engine ceiling 64000)' },
  { id: 'H3', title: "direct anthropic haiku variant 'high'", anthropic: { [HAIKU]: {} }, model: AN(HAIKU), extra: { variant: 'high' }, expect: 'thinking budget_tokens 16000' },
  { id: 'J1', title: 'custom openai-compatible unknown model {}', custom: true, model: CUSTOM, expect: '32000' },
  { id: 'J2', title: 'custom unknown model + env 64000', env: '64000', custom: true, model: CUSTOM, expect: '64000 (raw budget, nothing to clamp)' },
];

function wireSummary(wire) {
  if (!wire) { return { path: null, maxTokens: null, reasoning: null, thinking: null, reasoningEffort: null }; }
  const b = (wire.body && typeof wire.body === 'object') ? wire.body : {};
  return {
    path: wire.url,
    maxTokens: b.max_tokens ?? b.max_completion_tokens ?? b.maxOutputTokens ?? null,
    reasoning: b.reasoning === undefined ? null : b.reasoning,
    thinking: b.thinking === undefined ? null : b.thinking,
    reasoningEffort: b.reasoning_effort ?? null,
  };
}

function fmt(v) { return v === null || v === undefined ? '—' : (typeof v === 'object' ? JSON.stringify(v) : String(v)); }

async function main() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--out');
  const outPath = outIdx >= 0 ? args[outIdx + 1] : null;
  const onlyIdx = args.indexOf('--only');
  const only = onlyIdx >= 0 ? new Set(args[onlyIdx + 1].split(',')) : null;

  const sdk = await import('@opencode-ai/sdk');
  const engine = { binary: resolveEngineBinary(), packageVersion: require('opencode-ai/package.json').version, sdkVersion: require('@opencode-ai/sdk/package.json').version, version: null };
  const cap = await startCapture();
  const results = [];
  const providers = {};
  for (const c of CASES) {
    if (only && !only.has(c.id)) { continue; }
    const { server, client } = await startEngine(sdk, buildConfig(cap.origin, c), c.env);
    try {
      const key = `${c.model.providerID}/${c.model.modelID}`;
      if (!providers[key]) { providers[key] = await providersDump(client, c.model.providerID, c.model.modelID); }
      const r = await send(client, cap.captures, c);
      engine.version = engine.version || r.engineVersion;
      results.push({ id: c.id, title: c.title, expect: c.expect, env: c.env ?? null, config: buildConfig('<capture>', c).provider, prompt: c.viaAmicus ? { viaAmicus: true, reasoning: c.reasoning } : (c.extra || {}), ...r });
    } catch (err) {
      results.push({ id: c.id, title: c.title, expect: c.expect, env: c.env ?? null, error: err.message, wire: null, assistant: null });
    } finally {
      server.close();
    }
  }
  await cap.close();

  process.stdout.write(`\nengine: opencode-ai ${engine.packageVersion} (sdk ${engine.sdkVersion}), server reports ${engine.version || '?'}\nbinary: ${engine.binary}\n\n`);
  process.stdout.write('| id | case | expected | env | wire path | max_tokens | reasoning | thinking | prompt status | assistant finish | assistant error |\n|---|---|---|---|---|---|---|---|---|---|---|\n');
  for (const r of results) {
    const w = wireSummary(r.wire);
    const a = r.assistant || {};
    process.stdout.write(`| ${r.id} | ${r.title} | ${r.expect} | ${fmt(r.env)} | ${fmt(w.path)} | ${fmt(w.maxTokens)} | ${fmt(w.reasoning ?? w.reasoningEffort)} | ${fmt(w.thinking)} | ${fmt(r.status)}${r.error ? ' ' + r.error.slice(0, 60) : ''} | ${fmt(a.finish)} | ${fmt(a.error)} |\n`);
  }
  process.stdout.write('\n/config/providers per model:\n');
  for (const [k, v] of Object.entries(providers)) { process.stdout.write(`- ${k}: ${JSON.stringify(v)}\n`); }
  if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify({ engine, providers, cases: results }, null, 2));
    process.stdout.write(`\nraw captures: ${outPath}\n`);
  }
}

main().catch((err) => { process.stderr.write(`probe failed: ${err.stack || err.message}\n`); process.exit(1); });
```

- [ ] **Step 2: Smoke one case**

```bash
cd /c/Users/sendt/code/amicus && node scripts/probe-max-tokens.js --only A 2>&1 | tail -12
```

Expected: an `engine:` line naming `opencode-ai 1.18.15` and a binary path under the repo's `node_modules/opencode-windows-x64/bin/`, and a table row for A with `wire path` `/api/v1/chat/completions` and a numeric `max_tokens`. If the row shows `—` for the wire path, the engine never reached the capture server: read the `prompt status`/`assistant error` columns, then run with `--only A` again after checking that `provider.openrouter.options.baseURL` was honoured (look at `/config/providers per model` for the model's `options`). Do not proceed until case A captures a body.

- [ ] **Step 3: Run the full matrix and save the raw captures**

```bash
cd /c/Users/sendt/code/amicus && node scripts/probe-max-tokens.js --out output/218-probe-2026-09-04.json 2>&1 | tee output/218-probe-2026-09-04.md | tail -40
```

Expected: 18 rows plus the providers dump. `output/` is gitignored (`.gitignore` root-anchored `/output/`), so nothing here is staged.

- [ ] **Step 4: Record the measurements in the BACKLOG, past tense**

Append to the `## v4.9.4 records` section (Task 6) a record whose body is the table exactly as printed, prefixed by one paragraph stating: the engine version and binary path from the header; which expectations held and which did not (list every row whose `max_tokens` / `reasoning` column differs from the `expected` column, with the observed value); whether `/config/providers` exposes `variants`; whether the assistant message carried `finish: 'length'`; and the verdict on F1 versus F2 in one sentence. Every sentence in that paragraph must be traceable to a row of the table. Heading:

```markdown
- [x] **#218 P1 — the wire probe, run against the pin (2026-09-04).** …
```

- [ ] **Step 5: Regenerate the inventory and commit**

```bash
cd /c/Users/sendt/code/amicus && node scripts/generate-docs.js && git add scripts/probe-max-tokens.js BACKLOG.md CLAUDE.md docs/architecture-map.md && git commit -m "feat(scripts): zero-spend wire probe for the engine's max_tokens and effort fields (#218 P1)

A local capture server plays OpenRouter, Anthropic and an unknown
openai-compatible model; 18 cases record what the pinned 1.18.15 engine puts
on the outbound request under every descriptor, env-flag and prompt shape
amicus can produce. Measurements filed in BACKLOG v4.9.4 records.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Gates and pull request

**Files:** none new.

- [ ] **Step 1: Run every gate**

```bash
cd /c/Users/sendt/code/amicus && npm run lint 2>&1 | tail -3 && node scripts/check-file-sizes.js --all 2>&1 | tail -2 && node scripts/check-secrets.js --all 2>&1 | tail -2 && node scripts/check-citations.js --all 2>&1 | tail -2 && node scripts/validate-docs.js --full 2>&1 | tail -2 && node scripts/generate-docs.js --check 2>&1 | tail -2 && node scripts/check-tarball-lifecycle.js 2>&1 | tail -2
```

Expected: every gate clean. Fix anything red before the next step; a fix that touches `src/` or `scripts/` re-runs `generate-docs.js`.

- [ ] **Step 2: Run the full unit suite**

```bash
cd /c/Users/sendt/code/amicus && npx jest 2>&1 | tail -6
```

Expected: `Test Suites: N passed`, `Tests: M passed, 8 skipped`, exit 0, where N is the Task 0 suite count plus 3 (http-get, model-ceilings-modelsdev, model-catalog-ceilings). Record N and M.

- [ ] **Step 3: Run the keyless integration rail**

```bash
cd /c/Users/sendt/code/amicus && npm run test:integration 2>&1 | tail -6
```

Expected: passes / self-skips as on `main`, exit 0.

- [ ] **Step 4: Confirm the branch is clean and push**

```bash
cd /c/Users/sendt/code/amicus && git status --short && git log --oneline main..HEAD && git push -u origin fix/218-probe-and-ceilings
```

Expected: no unstaged changes except `site-src/`; seven commits (Tasks 1-7).

- [ ] **Step 5: Open the PR**

```bash
cd /c/Users/sendt/code/amicus && gh pr create -R BourbonDog/amicus --base main --head fix/218-probe-and-ceilings --label council-review --title "feat: #218 PR 1 — zero-spend wire probe and direct-provider ceilings from models.dev" --body-file - <<'EOF'
Addresses #218 (PR 1 of 4). Measures the pinned engine on the wire and gives the catalog the direct-provider ceilings `outputBudget` needs to clamp direct routes.

## What is in here

- **`scripts/probe-max-tokens.js`** — a local capture server plays OpenRouter, Anthropic and an unknown openai-compatible model; 18 cases record the outbound `max_tokens` / `reasoning` / `thinking` the pinned 1.18.15 engine sends under every descriptor, env-flag and prompt shape amicus can produce. No keys, no spend. Results are filed in BACKLOG "v4.9.4 records".
- **Direct-provider ceilings.** `models --refresh` fills `contextLength` / `maxOutputTokens` for anthropic/openai/deepseek rows from the keyless models.dev index; Google's own `outputTokenLimit` is lifted first-party. Provider value wins, nulls only, zero limits and `openrouter/openrouter/*` routers skipped. The refresh prints the outcome and `--json` carries it.
- **`src/utils/http-get.js`** — the always-resolves HTTPS GET extracted from `model-fetcher.js` (which sat at 299/300) so both fetches share one failure vocabulary.

## What this changes for users

`outputBudget` can now clamp direct routes once the catalog is refreshed. Nothing changes with `outputBudget` unset.

## Corrections to #218's research, measured against the pin

See the BACKLOG record: the repo's `node_modules` held opencode 1.2.20 while the lock pins 1.18.15, and three engine-behaviour claims read from that stale source map do not hold for the pin. `npm ci` aligned the copy; 1.18.15 ships no map, hence the probe.

## Verification

- jest: <N> suites / <M> tests, exit 0
- test:integration (keyless): exit 0
- lint · check:sizes · check:secrets · check:citations · check:tarball · validate-docs --full · generate-docs --check: clean

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
```

Fill `<N>` and `<M>` from Step 2 before running. Then:

```bash
cd /c/Users/sendt/code/amicus && sleep 30 && gh pr view --json number,mergeable,statusCheckRollup -R BourbonDog/amicus | head -c 1500
```

Expected: `mergeable: MERGEABLE` and check suites present (an unmergeable PR silently gets ZERO check suites — see the memory note in this project's records).

- [ ] **Step 6: Confirm the council review was triggered by the label**

The `council-review` label is what `.github/workflows/council-review.yml` keys on (`contains(github.event.pull_request.labels.*.name, 'council-review')`). Opening a PR with the label attached double-fires the workflow (`opened` + `labeled`); the concurrency group cancels the first run almost immediately, which is routine and expected.

```bash
cd /c/Users/sendt/code/amicus && gh pr view --json labels -R BourbonDog/amicus | grep -c council-review && gh run list -R BourbonDog/amicus --workflow council-review.yml --branch fix/218-probe-and-ceilings --limit 3 --json status,conclusion,createdAt,event
```

Expected: the label count is 1 and at least one `council-review.yml` run is listed for the branch (one may already show `cancelled` — that is the double-fire). If the label is missing, add it with `gh pr edit --add-label council-review -R BourbonDog/amicus`. Record the run id in your report.

---

## Self-Review

**Spec coverage.** P0: Task 0 Step 2 verifies the aligned engine. P1: Task 7 implements every row of the case matrix (A, B, C1-C3, D1-D2, E1-E2, F1-F4, H1-H3, J1-J2) plus the `/config/providers` dump and the assistant `finish` read. P3: Task 1 (helper), Task 2 (Google first-party), Task 3 (rules), Task 4 (hook + persistence), Task 5 (reporting), Task 6 (docs and records). Not in scope here by design: P2, P4, P5's sweep of the "can only lower" sentences (PR 2), P6 (PR 4).

**Placeholder scan.** Task 5 Step 1 asks the implementer to adapt to the existing loader function's name; the assertions and the mock field are fully specified. Task 7 Step 4's BACKLOG paragraph is content-derived from the run, with its required sentences enumerated. Task 8 Step 5's `<N>`/`<M>` are filled from Step 2's output. No TBDs.

**Type consistency.** `httpGetText` / `getJson` (Task 1) match the calls in Task 3's `enrichCeilings` and Task 1's refactor; the `enrichCeilings` outcome shape `{source, failure, filled, alreadyKnown, unknown, skippedRouters, skippedLocal}` is identical in Task 3's tests, Task 4's mocks and Task 5's `fmtCeilingLine`; `writeCache(models, providerFailures, ceilingEnrichment)` and `getCatalogInfo().ceilingEnrichment` are used with the same names in Tasks 4 and 5; `buildCatalogDoc({ceilingEnrichment})` matches the `--json` assertion.
