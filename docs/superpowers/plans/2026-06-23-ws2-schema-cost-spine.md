# WS-2 Schema & Cost Spine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the run/wave schema carry per-leg token & cost data, enforce a spend gate before any wave launches, and give every `--json` pre-flight failure a structured error envelope on stdout — then wire real cost into the council.

**Architecture:** Four units in dependency order. (A) a pure `error-doc.js` envelope used by the gate and by pre-flight failures; (B) a pure `pricing.js` (token aggregation + cached-pricing lookup + layered cost resolution) feeding a `usage` block added to schema v2; (C) a pure `budget.js` gate inserted into the fanout/start pre-flight; (D) council skill edits that consume the new data. Cost is always tagged `reported | estimated | unknown` so it is never a fabrication vector.

**Tech Stack:** Node.js (CommonJS), Jest, OpenCode SDK (`@opencode-ai/sdk`). No new runtime dependencies.

## Global Constraints

- **Node ≥ 18; Windows-first.** Tests must pass on Windows + Linux (CI matrix from WS-1).
- **File size gate:** every `src/**/*.js` file stays **under 300 lines** (pre-commit gate). New modules are small by design.
- **No `console.*` in new `src/` modules** — use `process.stdout.write(... + '\n')` / `process.stderr.write(... + '\n')` (matches `src/sidecar/models.js`). `bin/amicus.js` already uses `console.*` and is exempt.
- **Schema stability contract** (`result-schema.js` header): fields are only ADDED within a `SCHEMA_VERSION`; any rename/removal bumps it. WS-2 bumps `SCHEMA_VERSION` **1 → 2** for the additive `usage` block.
- **`ERROR_CODES` is frozen** once shipped: adding a code later is additive; renaming/removing is breaking.
- **Cost is never invented:** every cost carries `source: 'reported' | 'estimated' | 'unknown'`. Unpriced legs are surfaced, never silently counted as `$0`.
- **TDD, per-fix tests.** When a change alters behavior an existing test pins, update that test in the SAME task (the WS-0 pattern).
- **Baseline to keep green:** `npm test` = 125 suites / 1934 pass / 4 skip / 0 fail; `npm run lint` clean.
- **Execution:** worktree `C:\Users\sendt\dev\amicus-ws2`, branch `ws2/schema-cost-spine`, off `main` @ `3263c9f`, `node_modules` junctioned, hooks fire (PR #9). Local-only — no push/PR until the owner OKs the milestone.

---

### Task 1: Structured `--json` error envelope (#6)

**Files:**
- Create: `src/utils/error-doc.js`
- Create: `tests/utils/error-doc.test.js`
- Modify: `src/utils/validators.js:241-273` (add `code` to the missing-key return)
- Modify: `src/cli.js:160-162` (add `code` to the model-format return)
- Modify: `bin/amicus.js` — `handleStart` (~136-163), `handleFanout` bin-level arg checks (~201-231), `handleRead` (the read pre-flight task-id check)

**Interfaces:**
- Produces: `buildErrorDoc({ code, message, hint, command }) → { schemaVersion, type:'error', ok:false, error:{ code, message, hint, command } }`; `ERROR_CODES` (frozen object of string constants); `failJson(useJson, { code, message, hint, command }) → number` (writes the envelope to stdout when `useJson`, else the human message to stderr; returns exit code `1`).
- Consumes: `SCHEMA_VERSION` from `src/utils/result-schema.js` (currently `1`; Task 3 bumps it to `2` — `error-doc.js` imports it so the two never drift).

- [ ] **Step 1: Write the failing test for `buildErrorDoc` + `ERROR_CODES`**

Create `tests/utils/error-doc.test.js`:

```js
'use strict';
const { buildErrorDoc, ERROR_CODES, failJson } = require('../../src/utils/error-doc');
const { SCHEMA_VERSION } = require('../../src/utils/result-schema');

describe('error-doc', () => {
  it('builds an envelope with the shared schemaVersion and ok:false', () => {
    const doc = buildErrorDoc({ code: ERROR_CODES.MISSING_KEY, message: 'no key' });
    expect(doc).toEqual({
      schemaVersion: SCHEMA_VERSION,
      type: 'error',
      ok: false,
      error: { code: 'MISSING_KEY', message: 'no key', hint: null, command: null },
    });
  });

  it('passes hint and command through', () => {
    const doc = buildErrorDoc({ code: ERROR_CODES.BUDGET_EXCEEDED, message: 'too costly', hint: 'breakdown…', command: 'amicus fanout …' });
    expect(doc.error.hint).toBe('breakdown…');
    expect(doc.error.command).toBe('amicus fanout …');
  });

  it('freezes the code set', () => {
    expect(Object.isFrozen(ERROR_CODES)).toBe(true);
    expect(new Set(Object.values(ERROR_CODES))).toEqual(new Set([
      'BAD_ARGS', 'MISSING_PROMPT', 'BAD_MODEL', 'MISSING_KEY', 'BAD_SESSION', 'BUDGET_EXCEEDED', 'INTERNAL',
    ]));
  });
});

describe('failJson', () => {
  let outSpy, errSpy;
  beforeEach(() => {
    outSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    errSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });
  afterEach(() => { outSpy.mockRestore(); errSpy.mockRestore(); });

  it('writes a parseable envelope to stdout and nothing to stderr when useJson', () => {
    const code = failJson(true, { code: ERROR_CODES.BAD_ARGS, message: 'bad flag' });
    expect(code).toBe(1);
    expect(errSpy).not.toHaveBeenCalled();
    const written = outSpy.mock.calls[0][0];
    const parsed = JSON.parse(written);
    expect(parsed).toMatchObject({ type: 'error', ok: false, error: { code: 'BAD_ARGS' } });
  });

  it('writes the human message to stderr and nothing to stdout when not useJson', () => {
    failJson(false, { code: ERROR_CODES.BAD_ARGS, message: 'bad flag' });
    expect(outSpy).not.toHaveBeenCalled();
    expect(errSpy.mock.calls[0][0]).toContain('bad flag');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest tests/utils/error-doc.test.js`
Expected: FAIL — `Cannot find module '../../src/utils/error-doc'`.

- [ ] **Step 3: Implement `src/utils/error-doc.js`**

```js
// src/utils/error-doc.js
'use strict';

/**
 * @module error-doc
 * Structured error envelope for the `--json` contract (WS-2 #6). Every
 * pre-flight failure under --json writes one of these to STDOUT (with a stable
 * code) so an automation caller doing JSON.parse(stdout) gets a typed result
 * instead of an empty string. Non-JSON callers keep human text on stderr.
 */

const { SCHEMA_VERSION } = require('./result-schema');

/** Frozen — adding a code later is additive; renaming/removing is breaking. */
const ERROR_CODES = Object.freeze({
  BAD_ARGS: 'BAD_ARGS',             // bad/empty flag, mutually-exclusive flags, bad numeric/enum value
  MISSING_PROMPT: 'MISSING_PROMPT', // no/empty --prompt or --prompt-file
  BAD_MODEL: 'BAD_MODEL',           // bad model format, not on provider, not in catalog
  MISSING_KEY: 'MISSING_KEY',       // provider API key absent
  BAD_SESSION: 'BAD_SESSION',       // task id missing / invalid / not found
  BUDGET_EXCEEDED: 'BUDGET_EXCEEDED', // the WS-2 #10 spend gate
  INTERNAL: 'INTERNAL',             // unexpected pre-flight throw
});

/**
 * @param {{code: string, message: string, hint?: string, command?: string}} opts
 * @returns {object} error document
 */
function buildErrorDoc({ code, message, hint = null, command = null }) {
  return {
    schemaVersion: SCHEMA_VERSION,
    type: 'error',
    ok: false,
    error: { code, message, hint: hint || null, command: command || null },
  };
}

/**
 * Emit a pre-flight failure: JSON envelope to stdout when useJson, else the
 * human message to stderr. Returns the exit code (always 1) so callers can
 * `process.exit(failJson(...))`.
 * @param {boolean} useJson
 * @param {{code: string, message: string, hint?: string, command?: string}} opts
 * @returns {number}
 */
function failJson(useJson, { code, message, hint = null, command = null }) {
  if (useJson) {
    process.stdout.write(JSON.stringify(buildErrorDoc({ code, message, hint, command }), null, 2) + '\n');
  } else {
    process.stderr.write(message + '\n');
  }
  return 1;
}

module.exports = { ERROR_CODES, buildErrorDoc, failJson };
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx jest tests/utils/error-doc.test.js`
Expected: PASS (all 5).

- [ ] **Step 5: Add `code` to the two validators that carry distinct codes**

In `src/utils/validators.js`, the missing-key return (currently `src/utils/validators.js:261-269`) gains `code: 'MISSING_KEY'`:

```js
    return {
      valid: false,
      code: 'MISSING_KEY',
      error:
        `Error: ${keyName} not found for ${providerInfo.name}.\n\n` +
        'Fix with one of:\n' +
        `  - Store it in Amicus (recommended): amicus key ${provider} <apikey>\n` +
        persist +
        '  - Or add it to ~/.local/share/opencode/auth.json\n',
    };
```

In `src/cli.js`, the model-format branch (currently `src/cli.js:160-162`) gains `code: 'BAD_MODEL'`:

```js
  if (args.model && !isValidModelFormat(args.model)) {
    return { valid: false, code: 'BAD_MODEL', error: 'Error: --model must be in format provider/model (e.g., google/gemini-2.5-flash) or openrouter/provider/model' };
  }
```

(All other `validateStartArgs` returns stay code-less → the handler defaults them to `BAD_ARGS`.)

- [ ] **Step 6: Write the failing wiring test for `handleStart` / `handleFanout`**

Create `tests/bin/preflight-json-envelope.test.js`:

```js
'use strict';
const path = require('path');

// Import the bin module's handlers via the same path bin/amicus.js uses.
// handleStart/handleFanout live in src/cli-handlers.js (re-exported by bin).
const { handleStart, handleFanout } = require('../../src/cli-handlers');

function captureStdout(fn) {
  const out = [];
  const spyOut = jest.spyOn(process.stdout, 'write').mockImplementation((s) => { out.push(s); return true; });
  const spyErr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  const spyExit = jest.spyOn(process, 'exit').mockImplementation((c) => { throw new Error(`exit:${c}`); });
  return fn().catch(e => e).finally(() => { spyOut.mockRestore(); spyErr.mockRestore(); spyExit.mockRestore(); }).then(() => out.join(''));
}

describe('--json pre-flight failures emit an envelope on stdout', () => {
  it('start --json without --no-ui → BAD_ARGS envelope on stdout', async () => {
    const out = await captureStdout(() => handleStart({ json: true, 'no-ui': false, prompt: 'hi' }));
    const doc = JSON.parse(out);
    expect(doc).toMatchObject({ type: 'error', ok: false, error: { code: 'BAD_ARGS' } });
  });

  it('fanout --json with no --models → BAD_ARGS envelope on stdout', async () => {
    const out = await captureStdout(() => handleFanout({ json: true, prompt: 'hi' }));
    const doc = JSON.parse(out);
    expect(doc).toMatchObject({ type: 'error', ok: false, error: { code: 'BAD_ARGS' } });
  });
});
```

> **Note for the implementer:** confirm where `handleStart`/`handleFanout` actually live. In current `bin/amicus.js` they are defined inline; if so, extract them to `src/cli-handlers.js` (already exists for `handleAbort`/`handleSetup`/`handleKey`) as part of this step so they are unit-testable, and have `bin/amicus.js` import them. Keep `bin/amicus.js` and the extracted file each under the size gate.

- [ ] **Step 7: Run it to verify it fails**

Run: `npx jest tests/bin/preflight-json-envelope.test.js`
Expected: FAIL — handlers still `console.error` + `process.exit(1)` with no stdout, so `JSON.parse('')` throws.

- [ ] **Step 8: Route pre-flight exits through `failJson`**

In `handleStart`, replace the bare `console.error`/`process.exit(1)` pre-flight exits:

```js
  const { failJson, ERROR_CODES } = require('../src/utils/error-doc'); // adjust path if extracted
  const useJson = !!args.json;

  if (args.prompt !== undefined || args['prompt-file'] !== undefined) {
    const { resolvePromptSource } = require('../src/utils/prompt-source');
    const promptRes = resolvePromptSource(args);
    if (promptRes.error) { process.exit(failJson(useJson, { code: ERROR_CODES.MISSING_PROMPT, message: promptRes.error })); }
    args.prompt = promptRes.prompt;
  }
  if (args.json && !args['no-ui']) {
    process.exit(failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: 'Error: --json requires --no-ui' }));
  }
  // … model resolution …
  const validation = validateStartArgs(args);
  if (!validation.valid) {
    process.exit(failJson(useJson, { code: validation.code || ERROR_CODES.BAD_ARGS, message: validation.error }));
  }
```

In `handleFanout`, route each bin-level arg check through `failJson(useJson, …)` with: `resolvePromptSource` → `MISSING_PROMPT`; `--models` missing/empty → `BAD_ARGS`; `--wave-id` invalid → `BAD_SESSION`; `--agent chat` → `BAD_ARGS`; `--timeout` ≤0 → `BAD_ARGS`. Example for the models check:

```js
  if (typeof args.models !== 'string' || !args.models.trim()) {
    process.exit(failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: 'Error: --models is required (comma-separated aliases or provider/model IDs)' }));
  }
```

In `handleRead`, the task-id validation exit → `failJson(!!args.json, { code: ERROR_CODES.BAD_SESSION, message: check.error })`.

- [ ] **Step 9: Run the wiring test + the full unit suite**

Run: `npx jest tests/bin/preflight-json-envelope.test.js tests/utils/error-doc.test.js`
Expected: PASS.
Run: `npx jest` (full) — fix any pre-flight tests that asserted the old "stderr only / no stdout" behavior by updating them to the envelope (WS-0 pattern).
Expected: green.

- [ ] **Step 10: Lint + commit**

Run: `npm run lint`
```bash
git add src/utils/error-doc.js tests/utils/error-doc.test.js src/utils/validators.js src/cli.js bin/amicus.js src/cli-handlers.js tests/bin/preflight-json-envelope.test.js
git commit -m "feat(ws2): structured --json error envelope on pre-flight failure (#6)"
```

---

### Task 2: Pricing & usage primitives (#2 library)

**Files:**
- Create: `src/utils/pricing.js`
- Create: `tests/utils/pricing.test.js`
- Modify: `src/utils/model-catalog.js:103` (export `readCache`)

**Interfaces:**
- Produces:
  - `emptyUsageTotals() → { tokens:{input,output,reasoning,cacheRead,cacheWrite}, costReported:0 }`
  - `sumPerMessageUsage(map: Map<string,{tokens,cost}>) → { tokens:{…}, costReported:number }`
  - `lookupPricing(modelId: string) → { prompt:number, completion:number } | null` (per-token, numeric; null when missing/`pricing:null`/non-finite/negative)
  - `resolveLegCost({ reportedCost, tokens, pricing }) → { amount:number|null, currency:'USD', source:'reported'|'estimated'|'unknown' }`
  - `resolveUsage({ model, usageTotals }) → { tokens:{…}, cost:{amount,currency,source} }`
  - `sumWaveUsage(legs: Array<{usage?}>) → { tokens:{…}, cost:{amount,currency,source,reportedLegs,estimatedLegs,unpricedLegs} }`
- Consumes: `readCache` from `src/utils/model-catalog.js` (added this task) — a **sync, non-refreshing** cache read so cost resolution never triggers a network fetch.

- [ ] **Step 1: Export `readCache` from the catalog (sync, no refresh)**

In `src/utils/model-catalog.js`, add `readCache` to the exports (the function already exists at `model-catalog.js:33`):

```js
module.exports = { getCatalog, refreshCatalog, catalogPath, getCatalogInfo, readCache, CATALOG_SCHEMA_VERSION };
```

- [ ] **Step 2: Write the failing tests for `pricing.js`**

Create `tests/utils/pricing.test.js`:

```js
'use strict';
const pricing = require('../../src/utils/pricing');

describe('sumPerMessageUsage', () => {
  it('sums tokens + cost across messages without double-counting (map is keyed by id)', () => {
    const map = new Map();
    map.set('m1', { tokens: { input: 100, output: 200, reasoning: 10, cache: { read: 5, write: 1 } }, cost: 0.0021 });
    map.set('m2', { tokens: { input: 50, output: 60, reasoning: 0, cache: { read: 0, write: 0 } }, cost: 0.0009 });
    const t = pricing.sumPerMessageUsage(map);
    expect(t.tokens).toEqual({ input: 150, output: 260, reasoning: 10, cacheRead: 5, cacheWrite: 1 });
    expect(t.costReported).toBeCloseTo(0.003, 6);
  });

  it('tolerates missing tokens/cost fields → zeros', () => {
    const map = new Map();
    map.set('m1', { tokens: undefined, cost: undefined });
    const t = pricing.sumPerMessageUsage(map);
    expect(t.tokens).toEqual({ input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 });
    expect(t.costReported).toBe(0);
  });
});

describe('resolveLegCost', () => {
  const tokens = { input: 1_000_000, output: 1_000_000 };
  it('uses reported cost when > 0 → source reported', () => {
    expect(pricing.resolveLegCost({ reportedCost: 0.42, tokens, pricing: { prompt: 0.000003, completion: 0.00001 } }))
      .toEqual({ amount: 0.42, currency: 'USD', source: 'reported' });
  });
  it('estimates from pricing when reported is 0/absent → source estimated', () => {
    const r = pricing.resolveLegCost({ reportedCost: 0, tokens, pricing: { prompt: 0.000003, completion: 0.00001 } });
    expect(r.source).toBe('estimated');
    expect(r.amount).toBeCloseTo(0.000003 * 1e6 + 0.00001 * 1e6, 6); // 3 + 10 = 13
  });
  it('unknown when no reported and no pricing', () => {
    expect(pricing.resolveLegCost({ reportedCost: 0, tokens, pricing: null }))
      .toEqual({ amount: null, currency: 'USD', source: 'unknown' });
  });
});

describe('sumWaveUsage', () => {
  const leg = (source, amount, input = 10) => ({ usage: { tokens: { input, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }, cost: { amount, currency: 'USD', source } } });
  it('sums tokens, sums non-null amounts, classifies mixed + counts buckets', () => {
    const w = pricing.sumWaveUsage([leg('reported', 0.10), leg('estimated', 0.02), leg('unknown', null)]);
    expect(w.tokens.input).toBe(30);
    expect(w.cost.amount).toBeCloseTo(0.12, 6);
    expect(w.cost.source).toBe('mixed');
    expect(w.cost).toMatchObject({ reportedLegs: 1, estimatedLegs: 1, unpricedLegs: 1 });
  });
  it('all reported → source reported', () => {
    expect(pricing.sumWaveUsage([leg('reported', 0.1), leg('reported', 0.2)]).cost.source).toBe('reported');
  });
  it('no usage on a leg counts as unpriced', () => {
    const w = pricing.sumWaveUsage([{}, leg('reported', 0.1)]);
    expect(w.cost.unpricedLegs).toBe(1);
    expect(w.cost.source).toBe('mixed');
  });
});

describe('lookupPricing', () => {
  afterEach(() => jest.restoreAllMocks());
  it('returns numeric per-token pricing for a catalog row', () => {
    jest.spyOn(require('../../src/utils/model-catalog'), 'readCache')
      .mockReturnValue({ models: [{ id: 'openrouter/x/y', pricing: { prompt: '0.000003', completion: '0.00001' } }] });
    expect(pricing.lookupPricing('openrouter/x/y')).toEqual({ prompt: 0.000003, completion: 0.00001 });
  });
  it('returns null for pricing:null (direct providers) and for missing rows', () => {
    jest.spyOn(require('../../src/utils/model-catalog'), 'readCache')
      .mockReturnValue({ models: [{ id: 'google/gemini-3.5-flash', pricing: null }] });
    expect(pricing.lookupPricing('google/gemini-3.5-flash')).toBeNull();
    expect(pricing.lookupPricing('nope/missing')).toBeNull();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx jest tests/utils/pricing.test.js`
Expected: FAIL — `Cannot find module '../../src/utils/pricing'`.

- [ ] **Step 4: Implement `src/utils/pricing.js`**

```js
// src/utils/pricing.js
'use strict';

/**
 * @module pricing
 * Token aggregation + cached-pricing lookup + layered cost resolution (WS-2 #2).
 * Cost is resolved in layers and ALWAYS tagged with its source so it can never
 * be mistaken for an authoritative figure it isn't:
 *   reported  — OpenCode billed cost (msg.info.cost > 0)
 *   estimated — tokens × cached catalog pricing
 *   unknown   — neither available (e.g. a direct provider with pricing:null)
 */

function emptyUsageTotals() {
  return { tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }, costReported: 0 };
}

/**
 * Sum per-message usage. The poll loop re-reads ALL messages each poll, so the
 * caller stores the latest snapshot per message id in a Map; summing the Map's
 * values avoids double-counting streamed growth.
 * @param {Map<string,{tokens?:object, cost?:number}>} map
 */
function sumPerMessageUsage(map) {
  const totals = emptyUsageTotals();
  for (const v of map.values()) {
    const t = v && v.tokens ? v.tokens : {};
    totals.tokens.input += t.input || 0;
    totals.tokens.output += t.output || 0;
    totals.tokens.reasoning += t.reasoning || 0;
    totals.tokens.cacheRead += (t.cache && t.cache.read) || 0;
    totals.tokens.cacheWrite += (t.cache && t.cache.write) || 0;
    if (typeof v.cost === 'number') { totals.costReported += v.cost; }
  }
  return totals;
}

/** Sync, non-refreshing cached-pricing lookup by full route id. @returns {{prompt,completion}|null} */
function lookupPricing(modelId) {
  if (!modelId) { return null; }
  let cache;
  try { cache = require('./model-catalog').readCache(); } catch { return null; }
  if (!cache || !Array.isArray(cache.models)) { return null; }
  const row = cache.models.find(m => m && m.id === modelId);
  if (!row || !row.pricing) { return null; }
  const prompt = Number(row.pricing.prompt);
  const completion = Number(row.pricing.completion);
  if (!Number.isFinite(prompt) || !Number.isFinite(completion) || prompt < 0 || completion < 0) { return null; }
  return { prompt, completion };
}

/** @returns {{amount:number|null, currency:'USD', source:'reported'|'estimated'|'unknown'}} */
function resolveLegCost({ reportedCost, tokens, pricing }) {
  if (typeof reportedCost === 'number' && reportedCost > 0) {
    return { amount: reportedCost, currency: 'USD', source: 'reported' };
  }
  if (pricing && tokens) {
    const est = (tokens.input || 0) * pricing.prompt + (tokens.output || 0) * pricing.completion;
    if (est > 0) { return { amount: est, currency: 'USD', source: 'estimated' }; }
  }
  return { amount: null, currency: 'USD', source: 'unknown' };
}

/** Resolve a single run/leg's final usage block from raw totals + the model id. */
function resolveUsage({ model, usageTotals }) {
  const totals = usageTotals || emptyUsageTotals();
  const cost = resolveLegCost({ reportedCost: totals.costReported, tokens: totals.tokens, pricing: lookupPricing(model) });
  return { tokens: totals.tokens, cost };
}

/** Aggregate leg usage into a wave-level usage block. Legs without usage count as unpriced. */
function sumWaveUsage(legs) {
  const tokens = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 };
  let amount = 0; let anyAmount = false;
  let reportedLegs = 0, estimatedLegs = 0, unpricedLegs = 0;
  for (const leg of legs) {
    const u = leg && leg.usage;
    if (!u || !u.cost) { unpricedLegs++; continue; }
    for (const k of Object.keys(tokens)) { tokens[k] += (u.tokens && u.tokens[k]) || 0; }
    if (typeof u.cost.amount === 'number') { amount += u.cost.amount; anyAmount = true; }
    if (u.cost.source === 'reported') { reportedLegs++; }
    else if (u.cost.source === 'estimated') { estimatedLegs++; }
    else { unpricedLegs++; }
  }
  let source;
  if (reportedLegs > 0 && estimatedLegs === 0 && unpricedLegs === 0) { source = 'reported'; }
  else if (estimatedLegs > 0 && reportedLegs === 0 && unpricedLegs === 0) { source = 'estimated'; }
  else if (reportedLegs === 0 && estimatedLegs === 0) { source = 'unknown'; }
  else { source = 'mixed'; }
  return { tokens, cost: { amount: anyAmount ? amount : null, currency: 'USD', source, reportedLegs, estimatedLegs, unpricedLegs } };
}

module.exports = { emptyUsageTotals, sumPerMessageUsage, lookupPricing, resolveLegCost, resolveUsage, sumWaveUsage };
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npx jest tests/utils/pricing.test.js`
Expected: PASS (all groups).

- [ ] **Step 6: Lint + commit**

Run: `npm run lint`
```bash
git add src/utils/pricing.js tests/utils/pricing.test.js src/utils/model-catalog.js
git commit -m "feat(ws2): pricing + usage primitives — layered cost with source tag (#2)"
```

---

### Task 3: Capture usage + schema v2 wiring (#2)

**Files:**
- Modify: `src/utils/result-schema.js:12` (bump version), `:51-73` (run-doc `usage`), `:117-139` (wave-doc `usage`)
- Modify: `src/headless.js` (declare a usage map; capture in the poll loop ~373-386; add `usage` to the three return objects ~621-640, ~660-666)
- Modify: `src/sidecar/fanout-leg.js:90-104` (resolve + persist + pass leg usage)
- Modify: `src/sidecar/start.js:235-242` (resolve + persist + pass run usage)
- Modify: `tests/utils/result-schema.test.js` (extend for `usage`)
- Create: `tests/headless-usage.test.js`

**Interfaces:**
- Consumes: `resolveUsage`, `sumWaveUsage`, `sumPerMessageUsage` from `src/utils/pricing.js` (Task 2).
- Produces:
  - `runHeadless(...)` result objects gain `usage: { tokens:{input,output,reasoning,cacheRead,cacheWrite}, costReported:number }` (raw totals; cost is resolved downstream).
  - `buildRunResult({ …, usage = null })` adds a `usage` field: `usage !== null ? usage : (metadata.usage || null)`.
  - `buildWaveResult(...)` adds `usage: sumWaveUsage(legs)`.
  - `SCHEMA_VERSION === 2`.

- [ ] **Step 1: Write the failing schema tests (version + usage)**

Add to `tests/utils/result-schema.test.js` inside the `buildRunResult` describe:

```js
    it('attaches an explicit usage block, else falls back to metadata.usage, else null', () => {
      const usage = { tokens: { input: 1, output: 2, reasoning: 0, cacheRead: 0, cacheWrite: 0 }, cost: { amount: 0.01, currency: 'USD', source: 'reported' } };
      expect(buildRunResult({ taskId: 't', metadata: baseMeta, usage }).usage).toEqual(usage);
      expect(buildRunResult({ taskId: 't', metadata: { ...baseMeta, usage } }).usage).toEqual(usage);
      expect(buildRunResult({ taskId: 't', metadata: baseMeta }).usage).toBeNull();
    });
```

Add to the `buildWaveResult` describe:

```js
    it('aggregates leg usage into a wave usage block', () => {
      const u = (amount, source) => ({ tokens: { input: 5, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }, cost: { amount, currency: 'USD', source } });
      const doc = buildWaveResult({ waveId: 'w', legs: [
        { status: 'complete', usage: u(0.1, 'reported') },
        { status: 'complete', usage: u(0.05, 'estimated') },
      ] });
      expect(doc.usage.tokens.input).toBe(10);
      expect(doc.usage.cost.amount).toBeCloseTo(0.15, 6);
      expect(doc.usage.cost.source).toBe('mixed');
    });
```

And update the `SCHEMA_VERSION` expectation if any test pins the literal `1` (the wave rebuilder test writes `schemaVersion: 1` into a stored `wave.json` at `result-schema.test.js:204` — that asserts pass-through of a stored doc, so leave it; it does not assert the live constant).

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest tests/utils/result-schema.test.js`
Expected: FAIL — `usage` is `undefined` on both docs.

- [ ] **Step 3: Bump the version and add `usage` to the builders**

In `src/utils/result-schema.js`:

```js
const SCHEMA_VERSION = 2;
```

Add a `usage = null` param to `buildRunResult` and a field in its return object (after `opencodeSessionId`):

```js
function buildRunResult({ taskId, metadata = {}, result = null, summary = null, modelInput = null, sessionDir = null, waveId = null, usage = null }) {
  // … unchanged …
  return {
    // … unchanged fields …
    opencodeSessionId: metadata.opencodeSessionId || null,
    usage: usage !== null ? usage : (metadata.usage || null),
  };
}
```

In `buildWaveResult`, compute and add the wave usage (lazy require avoids any load-order surprises):

```js
function buildWaveResult({ waveId, legs = [], promptMeta = null, createdAt = null, completedAt = null, status = null }) {
  const { sumWaveUsage } = require('./pricing');
  const counts = { /* unchanged */ };
  const durationMs = durationBetween(createdAt, completedAt);
  return {
    // … unchanged fields through durationMs …
    durationMs,
    usage: sumWaveUsage(legs),
  };
}
```

- [ ] **Step 4: Run the schema tests**

Run: `npx jest tests/utils/result-schema.test.js`
Expected: PASS.

- [ ] **Step 5: Write the failing headless-capture test**

Create `tests/headless-usage.test.js`:

```js
'use strict';
const { sumPerMessageUsage } = require('../src/utils/pricing');

// runHeadless aggregates msg.info.tokens/msg.info.cost from assistant messages
// into a Map keyed by message id; this pins the aggregation contract the poll
// loop relies on (the loop wiring itself is covered by the e2e smoke in Task 6).
describe('headless usage aggregation contract', () => {
  it('a single assistant message snapshot resolves to its totals', () => {
    const map = new Map();
    // simulate two polls of the SAME message (streamed growth → latest wins)
    map.set('asst_1', { tokens: { input: 10, output: 1, reasoning: 0, cache: { read: 0, write: 0 } }, cost: 0.0001 });
    map.set('asst_1', { tokens: { input: 10, output: 40, reasoning: 5, cache: { read: 2, write: 0 } }, cost: 0.0006 });
    const t = sumPerMessageUsage(map);
    expect(t.tokens).toEqual({ input: 10, output: 40, reasoning: 5, cacheRead: 2, cacheWrite: 0 });
    expect(t.costReported).toBeCloseTo(0.0006, 6);
  });
});
```

- [ ] **Step 6: Run it to verify it passes (it pins Task-2 behavior; confirms no double-count)**

Run: `npx jest tests/headless-usage.test.js`
Expected: PASS.

- [ ] **Step 7: Capture usage in the `runHeadless` poll loop**

In `src/headless.js`, declare the map alongside the existing per-run state (near `toolCalls`/`output`, before the poll loop):

```js
  const usageByMsg = new Map();
```

In the assistant-message branch (currently `src/headless.js:373-386`), record the latest snapshot:

```js
            if (role === 'assistant') {
              currentAssistantMsgId = msg.info.id;
              if (msg.info.tokens || typeof msg.info.cost === 'number') {
                usageByMsg.set(msg.info.id, { tokens: msg.info.tokens, cost: msg.info.cost });
              }
              if (msg.info.error) { /* unchanged */ }
            }
```

Before the return statements (after the poll loop, near `src/headless.js:605`), compute the totals once:

```js
    const { sumPerMessageUsage } = require('./utils/pricing');
    const usage = sumPerMessageUsage(usageByMsg);
```

Add `usage` to the success return (`:632-640`), the error-with-no-output return (`:621-629`), and — using a zero default for safety — the catch-block return (`:660-666`):

```js
    return { summary: extractSummary(output), completed, timedOut, aborted, taskId, toolCalls, usage, exitCode: 0 };
```

For the catch block (where `usageByMsg` is in scope but the loop may not have run), use:

```js
    const { emptyUsageTotals } = require('./utils/pricing');
    return { summary: '', completed: false, timedOut: false, aborted: false, /* … */ usage: emptyUsageTotals() };
```

- [ ] **Step 8: Resolve + persist + pass usage in the leg and start callsites**

In `src/sidecar/fanout-leg.js` `runLeg` (currently `:90-104`):

```js
  const { resolveUsage } = require('../utils/pricing');
  const usage = result && result.usage ? resolveUsage({ model: leg.model, usageTotals: result.usage }) : null;
  const finalMeta = writeLegPatch(legDir, {
    status,
    reason: result.error || undefined,
    completedAt: new Date().toISOString(),
    usage: usage || undefined,
  });
  // … unchanged stderr line …
  return buildRunResult({
    taskId: legId, metadata: finalMeta, result: effectiveResult, summary,
    modelInput: leg.modelInput, sessionDir: legDir, waveId, usage,
  });
```

In `src/sidecar/start.js` (currently `:235-242`, in the `if (json)` block — but resolve usage for the metadata regardless so `read --json` works later):

```js
  const { resolveUsage } = require('../utils/pricing');
  const runUsage = result && result.usage ? resolveUsage({ model, usageTotals: result.usage }) : null;
  if (runUsage) {
    const m = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    m.usage = runUsage;
    fs.writeFileSync(metaPath, JSON.stringify(m, null, 2), { mode: 0o600 });
  }
  if (json) {
    const { buildRunResult } = require('../utils/result-schema');
    const finalMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    const doc = buildRunResult({ taskId, metadata: finalMeta, result, summary, modelInput, sessionDir: sessDir, usage: runUsage });
    console.log(JSON.stringify(doc, null, 2));
  }
```

(Interactive runs have no `result.usage` → `runUsage` is `null` → `usage: null` in the doc, honest "not captured"; WS-4 wires interactive capture.)

- [ ] **Step 9: Run the full unit suite**

Run: `npx jest`
Expected: green. Update any leg/start/read tests that snapshot the full doc and now see the new `usage` field (add `usage` to their expected object, or switch a strict `toEqual` to `toMatchObject`).

- [ ] **Step 10: Lint + commit**

Run: `npm run lint`
```bash
git add src/utils/result-schema.js src/headless.js src/sidecar/fanout-leg.js src/sidecar/start.js tests/utils/result-schema.test.js tests/headless-usage.test.js
git commit -m "feat(ws2): capture token/cost usage; schema v2 usage block + wave totals (#2)"
```

---

### Task 4: Enforced budget gate (#10)

**Files:**
- Create: `src/sidecar/budget.js`
- Create: `tests/sidecar/budget.test.js`
- Modify: `src/sidecar/fanout.js:48-85` (attach pricing + return codes from `validateFanoutModels`), `:134-137` (pre-flight error-doc + budget insertion)
- Modify: `src/cli.js:99-117` (register `--no-cost-gate`), `:122-127` (register numeric `--max-cost`), usage text (~347-357)
- Modify: `bin/amicus.js` `handleFanout` (~235-257) + `handleStart` (~165-193) to thread `maxCost`/`noCostGate` and gate the solo start path
- Modify: `src/cli-handlers.js`/`bin` as needed for the start-path gate

**Interfaces:**
- Consumes: `lookupPricing` (Task 2); `buildErrorDoc`/`failJson`/`ERROR_CODES` (Task 1).
- Produces:
  - `checkBudget(legs, { maxCostPerMtok, maxCost, promptChars, assumedOutputTokens }) → { ok:boolean, offending:Array, overCeiling:boolean, breakdown:{ legs:Array, totalEstCost:number, unpricedCount:number, maxCostPerMtok:number, maxCost:number|null } }` where each leg is `{ modelInput, model, pricing:{prompt,completion}|null }`.
  - `formatBudgetError(result) → string` (human/`hint` breakdown).
  - `DEFAULT_MAX_COST_PER_MTOK`, `ASSUMED_OUTPUT_TOKENS` constants.
  - `validateFanoutModels` now returns legs as `{ modelInput, model, pricing }` and errors as `{ error, code }`.

- [ ] **Step 1: Write the failing budget tests (deterministic, fixture pricing)**

Create `tests/sidecar/budget.test.js`:

```js
'use strict';
const { checkBudget, DEFAULT_MAX_COST_PER_MTOK } = require('../../src/sidecar/budget');

const leg = (modelInput, perTok) => ({ modelInput, model: `openrouter/${modelInput}`, pricing: perTok === null ? null : { prompt: perTok, completion: perTok } });

describe('checkBudget — per-$/Mtok threshold (hard, default on)', () => {
  it('refuses a leg far over the default cap', () => {
    const r = checkBudget([leg('o3pro', 0.0002)], {}); // 0.0002/tok = 200 $/Mtok
    expect(r.ok).toBe(false);
    expect(r.offending).toHaveLength(1);
    expect(r.offending[0].modelInput).toBe('o3pro');
  });
  it('allows a leg far under the default cap', () => {
    const r = checkBudget([leg('gemini', 0.0000003)], {}); // 0.3 $/Mtok
    expect(r.ok).toBe(true);
    expect(r.offending).toHaveLength(0);
  });
  it('honors an explicit lower maxCostPerMtok override', () => {
    const r = checkBudget([leg('mid', 0.00001)], { maxCostPerMtok: 5 }); // 10 $/Mtok > 5
    expect(r.ok).toBe(false);
  });
});

describe('checkBudget — unpriced legs', () => {
  it('surfaces unpriced legs and never counts them as $0 in the estimate', () => {
    const r = checkBudget([leg('directmodel', null)], { maxCost: 0.01, promptChars: 4000 });
    expect(r.breakdown.unpricedCount).toBe(1);
    expect(r.breakdown.totalEstCost).toBe(0); // no priced legs contributed
    expect(r.ok).toBe(true); // unpriced cannot trip the ceiling
  });
});

describe('checkBudget — soft total ceiling (opt-in)', () => {
  it('refuses when the summed estimate exceeds maxCost', () => {
    // 2 legs @ 0.00001/tok, ~1000 input tok + assumed output → > $0.001 ceiling
    const r = checkBudget([leg('a', 0.00001), leg('b', 0.00001)], { maxCost: 0.001, promptChars: 4000 });
    expect(r.overCeiling).toBe(true);
    expect(r.ok).toBe(false);
  });
  it('no ceiling set → never trips on cost total', () => {
    const r = checkBudget([leg('a', 0.0000003)], { promptChars: 4000 });
    expect(r.overCeiling).toBe(false);
  });
});

describe('threshold default', () => {
  it('is a positive number', () => { expect(DEFAULT_MAX_COST_PER_MTOK).toBeGreaterThan(0); });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest tests/sidecar/budget.test.js`
Expected: FAIL — `Cannot find module '../../src/sidecar/budget'`.

- [ ] **Step 3: Implement `src/sidecar/budget.js`**

```js
// src/sidecar/budget.js
'use strict';

/**
 * @module budget
 * Pre-flight spend gate (WS-2 #10). Two guards:
 *  - HARD per-$/Mtok threshold (on by default): refuses a model whose catalog
 *    price-per-Mtok exceeds the cap. Structural o3/o3-pro guard; no output
 *    length guess needed.
 *  - SOFT total-$ ceiling (opt-in via --max-cost): refuses when the summed
 *    per-leg ESTIMATE exceeds the ceiling. Estimate, not guaranteed.
 * Unpriced legs (direct providers, pricing:null) are surfaced, never $0.
 */

// Tuned against the live catalog at implementation time (see Step 7): allows
// the normal council bench (opus/gemini/deepseek/gpt) and blocks o3-pro-class.
const DEFAULT_MAX_COST_PER_MTOK = 60;
// Rough output budget for the soft ceiling estimate (output length is unknown
// pre-flight). Deliberately conservative; the ceiling is labeled "estimate".
const ASSUMED_OUTPUT_TOKENS = 4000;

function perMtok(perToken) { return perToken * 1e6; }

/**
 * @param {Array<{modelInput,model,pricing:{prompt,completion}|null}>} legs
 * @param {{maxCostPerMtok?,maxCost?,promptChars?,assumedOutputTokens?}} [opts]
 */
function checkBudget(legs, opts = {}) {
  const cap = (typeof opts.maxCostPerMtok === 'number' && opts.maxCostPerMtok > 0)
    ? opts.maxCostPerMtok : DEFAULT_MAX_COST_PER_MTOK;
  const inTok = Math.ceil((opts.promptChars || 0) / 4);
  const outTok = opts.assumedOutputTokens || ASSUMED_OUTPUT_TOKENS;
  const offending = [];
  const breakdownLegs = [];
  let totalEstCost = 0;
  let unpricedCount = 0;

  for (const leg of legs) {
    if (!leg.pricing) {
      breakdownLegs.push({ modelInput: leg.modelInput, model: leg.model, priced: false, perMtok: null, estCost: null });
      unpricedCount++;
      continue;
    }
    const pm = Math.max(perMtok(leg.pricing.prompt), perMtok(leg.pricing.completion));
    const estCost = leg.pricing.prompt * inTok + leg.pricing.completion * outTok;
    totalEstCost += estCost;
    const overThreshold = pm > cap;
    breakdownLegs.push({ modelInput: leg.modelInput, model: leg.model, priced: true, perMtok: pm, estCost, overThreshold });
    if (overThreshold) {
      offending.push({ modelInput: leg.modelInput, model: leg.model, perMtok: pm,
        reason: `$${pm.toFixed(2)}/Mtok exceeds the $${cap.toFixed(2)}/Mtok cap` });
    }
  }

  const overCeiling = (typeof opts.maxCost === 'number' && opts.maxCost > 0) ? totalEstCost > opts.maxCost : false;
  const ok = offending.length === 0 && !overCeiling;
  return { ok, offending, overCeiling, breakdown: { legs: breakdownLegs, totalEstCost, unpricedCount, maxCostPerMtok: cap, maxCost: opts.maxCost || null } };
}

/** Human-readable refusal text (also used as the error envelope `hint`). */
function formatBudgetError(result) {
  const lines = [];
  if (result.offending.length > 0) {
    lines.push('Budget gate: model(s) over the per-$/Mtok threshold:');
    for (const o of result.offending) { lines.push(`  - ${o.modelInput} (${o.model}): ${o.reason}`); }
  }
  if (result.overCeiling) {
    lines.push(`Budget gate: estimated total $${result.breakdown.totalEstCost.toFixed(4)} exceeds --max-cost $${result.breakdown.maxCost.toFixed(4)} (estimate, not guaranteed).`);
  }
  if (result.breakdown.unpricedCount > 0) {
    lines.push(`(${result.breakdown.unpricedCount} unpriced leg(s) — direct provider; cost unknown, not included in the estimate.)`);
  }
  lines.push('Override: --max-cost <$> to raise the ceiling, or --no-cost-gate to disable both guards (e.g. an intentional o3 run).');
  return lines.join('\n');
}

module.exports = { checkBudget, formatBudgetError, DEFAULT_MAX_COST_PER_MTOK, ASSUMED_OUTPUT_TOKENS };
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx jest tests/sidecar/budget.test.js`
Expected: PASS.

- [ ] **Step 5: Attach pricing + codes in `validateFanoutModels`**

In `src/sidecar/fanout.js`, update `validateFanoutModels` so legs carry pricing and errors carry a code:

```js
  const { tryResolveModel } = require('../utils/config');
  const { validateApiKey } = require('../utils/validators');
  const { validateAgainstCatalog } = require('../utils/model-validator');
  const { lookupPricing } = require('../utils/pricing');
  const legs = [];
  for (const modelInput of raw) {
    const resolved = tryResolveModel(modelInput);
    if (resolved.error) { return { error: `Error: model '${modelInput}': ${resolved.error}`, code: 'BAD_MODEL' }; }
    let model = resolved.model;
    const keyCheck = validateApiKey(model);
    if (!keyCheck.valid) { return { error: keyCheck.error, code: 'MISSING_KEY' }; }
    if (!opts.noValidateModel) {
      const alias = modelInput.includes('/') ? undefined : modelInput;
      try { model = await validateAgainstCatalog(model, alias); }
      catch (err) { return { error: err.message, code: 'BAD_MODEL' }; }
    }
    legs.push({ modelInput, model, pricing: lookupPricing(model) });
  }
  return { legs };
```

Also update the two early `{ error: … }` returns (empty list, over-cap) to add `code: 'BAD_ARGS'`.

- [ ] **Step 6: Insert the gate + emit error-docs for pre-creation pre-flight failures in `runFanout`**

In `src/sidecar/fanout.js` `runFanout`, replace the validation-error branch and add the budget gate BEFORE the wave record (step 2). Both happen before any wave dir exists → emit an error-doc, not a wave-doc:

```js
  const failPre = (code, message, hint) => {
    if (!options.quiet) {
      if (options.json) {
        const { buildErrorDoc } = require('../utils/error-doc');
        console.log(JSON.stringify(buildErrorDoc({ code, message, hint }), null, 2));
      } else {
        console.error(hint ? `${message}\n${hint}` : message);
      }
    }
    return { wave: null, errorDoc: { code, message }, exitCode: 1 };
  };

  // 1. Fail-fast validation
  const validated = await validateFanoutModels(options.models, { noValidateModel: options.noValidateModel });
  if (validated.error) { return failPre(validated.code || 'BAD_ARGS', validated.error); }
  const legs = validated.legs;

  // 1b. Budget gate (pre-creation; refuse before spending)
  if (!options.noCostGate) {
    const { checkBudget, formatBudgetError } = require('./budget');
    const promptChars = (options.promptMeta && options.promptMeta.chars) || (options.prompt ? options.prompt.length : 0);
    const budget = checkBudget(legs, { maxCostPerMtok: options.maxCostPerMtok, maxCost: options.maxCost, promptChars });
    if (!budget.ok) {
      return failPre('BUDGET_EXCEEDED', 'Error: budget gate refused the wave', formatBudgetError(budget));
    }
  }
```

(The existing `errorWave` helper stays for POST-creation failures — e.g. server-start failure — where a wave dir already exists.) `handleFanout` already only consumes `exitCode`, so the `{ wave: null, errorDoc }` shape is compatible.

- [ ] **Step 7: Tune `DEFAULT_MAX_COST_PER_MTOK` against the live catalog**

This is a one-time calibration, not a guess:
1. Refresh + inspect live pricing: `node bin/amicus.js models --refresh` then `node bin/amicus.js models --search opus`, `--search o3`, `--search gemini`, `--search deepseek` — note each model's `$/Mtok in/out`.
2. Set `DEFAULT_MAX_COST_PER_MTOK` so the normal council bench (opus/gemini/deepseek/gpt) is **below** it and o3-pro is **above** it. Record the observed numbers in the constant's comment (e.g. `// opus ~$X/Mtok (allowed), o3-pro ~$Y/Mtok (blocked) — observed 2026-06-23`).
3. Add a calibration regression test to `tests/sidecar/budget.test.js` using those observed values as fixtures:

```js
describe('threshold calibration (observed pricing)', () => {
  const at = (perMtokOut) => ({ modelInput: 'm', model: 'openrouter/m', pricing: { prompt: 0, completion: perMtokOut / 1e6 } });
  it('allows opus-class and blocks o3-pro-class at the default', () => {
    expect(checkBudget([at(/* observed opus out $/Mtok */ 75)], {}).ok).toBe(true);   // adjust to observed
    expect(checkBudget([at(/* observed o3-pro out $/Mtok */ 800)], {}).ok).toBe(false); // adjust to observed
  });
});
```

> If opus and o3 (regular) cannot be separated by per-$/Mtok, the threshold still blocks o3-**pro** (the $10–60/request offender); o3-regular is then bounded by the soft `--max-cost` ceiling and the council prose. Record this outcome in the comment.

- [ ] **Step 8: Register the CLI flags**

In `src/cli.js`, add `'no-cost-gate'` to the `booleanFlags` array (`:100-115`) and `'max-cost'` to `numericOptions` in `parseValue` (`:124`):

```js
  const numericOptions = ['context-turns', 'context-max-tokens', 'timeout', 'opencode-port', 'max-cost'];
```

Add to the fanout + start usage text (`getUsage`, near `:355`):

```
  --max-cost <$>               Refuse the wave if the estimated total exceeds $ (soft ceiling)
  --no-cost-gate               Disable the budget gate (per-$/Mtok threshold + ceiling) for this run
```

> `--max-cost` parses as a float, not int — in `parseValue`, branch `max-cost` to `parseFloat(value)` rather than `parseInt`. Add it as its own check above the `numericOptions` int block:
> ```js
> if (key === 'max-cost') { return parseFloat(value); }
> ```

- [ ] **Step 9: Thread the flags through `bin/amicus.js`**

In `handleFanout`'s `runFanout({...})` call, add:

```js
    maxCost: args['max-cost'],
    noCostGate: !!args['no-cost-gate'],
```

In `handleStart`, gate the solo path after model resolution (before `startSidecar`), reusing `failJson` + `checkBudget`:

```js
  if (!args['no-cost-gate']) {
    const { lookupPricing } = require('../src/utils/pricing');
    const { checkBudget, formatBudgetError } = require('../src/sidecar/budget');
    const leg = { modelInput: alias || args.model, model: args.model, pricing: lookupPricing(args.model) };
    const promptChars = (args.prompt && String(args.prompt).length) || 0;
    const budget = checkBudget([leg], { maxCost: args['max-cost'], promptChars });
    if (!budget.ok) {
      process.exit(failJson(useJson, { code: ERROR_CODES.BUDGET_EXCEEDED, message: 'Error: budget gate refused the run', hint: formatBudgetError(budget) }));
    }
  }
```

- [ ] **Step 10: Run the full unit suite + lint**

Run: `npx jest`
Expected: green. Update any fanout tests that asserted the old `errorWave` wave-doc on a validation error — they now get an error-doc (`{ wave: null, errorDoc }` / stdout `type:'error'`). Update with the source (WS-0 pattern).
Run: `npm run lint`

- [ ] **Step 11: Commit**

```bash
git add src/sidecar/budget.js tests/sidecar/budget.test.js src/sidecar/fanout.js src/cli.js bin/amicus.js src/cli-handlers.js
git commit -m "feat(ws2): enforced budget gate — per-\$/Mtok threshold + soft ceiling (#10)"
```

---

### Task 5: Council cost wiring (Unit D)

**Files:**
- Modify: `skills/second-opinion/SKILL.md` (Stage 0 cost estimate ~57, model-rec heuristic ~367; Stage 5 run-stats table ~258-260 + Output & naming ~377-378; cost-guardrail honor line ~61)
- Modify: `skills/second-opinion/MODEL-NOTES.md` (cost guardrail ~81-83)

**Interfaces:**
- Consumes: the wave/run `usage` block (Task 3) and the budget gate + override flags (Task 4). No code; documentation only — verified by the Task 6 smoke and a grep check.

- [ ] **Step 1: Replace the Stage-5 "no cost data" instruction with a real cost column**

In `skills/second-opinion/SKILL.md`, both the Stage-5 bullet (`:258-260`) and the Output & naming bullet (`:377-378`) currently end: *"**model, status, durationMs** … The schema carries no cost data — do not invent cost figures."* Replace that trailing sentence in both with:

```
**model, status, durationMs, and cost** read from the wave/run JSON `usage`
block. Cost is `usage.cost.amount` (USD); mark it with its `usage.cost.source`
— exact for `reported`, `~` for `estimated`, `?` for `unknown` — and never
invent a figure. Add a wave **total cost** row from the wave document's
`usage.cost` (`source: reported|estimated|mixed|unknown`).
```

- [ ] **Step 2: Make the Stage-0 cost estimate real**

In `skills/second-opinion/SKILL.md` Stage 0 (`:57`) where it says "State the estimated cost", append:

```
The estimate is the budget gate's pre-flight figure (per-$/Mtok pricing from
the cached catalog; direct-provider legs without catalog pricing are disclosed
as "cost unknown"). State it as an estimate, not a guarantee.
```

And in the model-recommendation heuristics (`:367`, "surface the estimated cost"), add the same "estimate, not guarantee; unpriced legs disclosed" qualifier.

- [ ] **Step 3: Rewrite the cost guardrail from prose-only to code-enforced**

In `skills/second-opinion/SKILL.md:61` ("Honor the cost guardrail in `MODEL-NOTES.md`…"), change to:

```
The budget gate enforces the cost guardrail in code: by default it refuses any
leg whose price exceeds the per-$/Mtok threshold (the o3/o3-pro guard). To run
an intentionally expensive model the user explicitly asked for by name, pass
`--no-cost-gate`; to raise only the total ceiling, pass `--max-cost <$>`.
```

In `skills/second-opinion/MODEL-NOTES.md:81-83`, rewrite the guardrail block:

```
## Cost guardrail
- The budget gate enforces this in code: a per-$/Mtok threshold (ON by default)
  refuses o3/o3-pro-class models before a wave launches. This replaces the old
  "remember not to" rule — it can no longer be forgotten.
- To run `o3`/`o3-pro` (≈ $10–60+/request) the user must ask by name AND you
  pass `--no-cost-gate` (disables both guards) for that run. Still warn first.
- `--max-cost <$>` raises only the soft total ceiling; it does not unblock an
  over-threshold model.
```

- [ ] **Step 4: Verify no contradictory cost prose remains**

Run: `npx rg -n "no cost data|do not invent cost|carries no cost" skills/second-opinion/`
Expected: no matches.
Run: `npx rg -n "cost" skills/second-opinion/SKILL.md skills/second-opinion/MODEL-NOTES.md`
Expected: every hit now references the `usage` block, the estimate, or the enforced gate — none claims cost is unavailable.

- [ ] **Step 5: Commit**

```bash
git add skills/second-opinion/SKILL.md skills/second-opinion/MODEL-NOTES.md
git commit -m "docs(ws2): wire real cost into the council — run-stats column, estimate, enforced guardrail (Unit D)"
```

---

### Task 6: Integration — real-LLM smoke + review + owner sync

**Files:**
- None (verification + sync). Reads: the whole WS-2 surface.

**Interfaces:**
- Consumes: everything from Tasks 1–5.

- [ ] **Step 1: Full gate**

Run: `npx jest` → expect green (baseline 1934 pass + the new WS-2 tests; 4 skip; 0 fail).
Run: `npm run lint` → clean.
Run: `node scripts/check-file-sizes.js` (or the size-check npm script) → new `src/` files all under 300 lines.

- [ ] **Step 2: Real-LLM `fanout --json` usage smoke (FOREGROUND — never background, the run is lost otherwise)**

Run (Bash, timeout ~480s), a 2-model wave with one OpenRouter leg and one direct-provider leg:

```bash
node bin/amicus.js fanout --models deepseek,gemini --prompt "Reply with the single word: pong." \
  --no-context --agent Plan --summary-length brief --timeout 5 --json
```

Expected stdout: one wave document with `schemaVersion: 2`, `usage.tokens` summed, `usage.cost` present; per-leg `usage.cost.source` is `reported` for the OpenRouter leg and `estimated` or `unknown` for the direct leg. Confirm no leg shows a fabricated `$0` with non-zero tokens.

- [ ] **Step 3: Real `BUDGET_EXCEEDED` refusal smoke**

Run a wave including an o3-class alias (do NOT pass `--no-cost-gate`):

```bash
node bin/amicus.js fanout --models o3,gemini --prompt "hi" --no-context --json
```

Expected: stdout is a single `{ "type": "error", "ok": false, "error": { "code": "BUDGET_EXCEEDED", … } }` with the breakdown in `hint`; exit code 1; **no OpenCode server started** (no leg ran). Then confirm `--no-cost-gate` lets it through (abort immediately once it starts — this only proves the override path; Ctrl-C is fine).

- [ ] **Step 4: Holistic review**

Dispatch an Opus holistic review over the WS-2 diff (`git diff main...HEAD`) against this plan + the spec: verify the cost `source` tag is never bypassed, the `ERROR_CODES` set is frozen and complete, the budget gate fires before any spend on both `fanout` and `start`, and no council prose contradicts the enforced code. Fix any merge-blockers found.

- [ ] **Step 5: Owner sync + finalize**

Sync the global council skill copy to the repo versions (council files changed in Task 5):

```bash
# copy SKILL.md + MODEL-NOTES.md to ~/.claude/skills/second-opinion/ (overwrite),
# preserving any user-only MODEL-NOTES reliability rows per prior practice.
```

Then report the WS-2 milestone to the owner for the push decision (`main` is local-only, currently 24 commits ahead of origin pre-WS-2). Do not push until the owner OKs.

---

## Self-Review

**1. Spec coverage:**
- #6 error envelope → Task 1 (buildErrorDoc, ERROR_CODES, failJson, pre-flight wiring) + Task 4 (fanout error-docs, BUDGET_EXCEEDED). ✅
- #2 telemetry → Task 2 (pricing primitives) + Task 3 (headless capture, schema v2, callsite wiring, persistence). ✅
- #10 budget gate → Task 4 (budget.js, threshold+ceiling, refuse-by-default, flags, config, fanout+start wiring, tuning). ✅
- Unit D council wiring → Task 5. ✅
- Layered cost + source tag, never-fabricate → Task 2 `resolveLegCost`/`resolveUsage`, Task 5 prose. ✅
- Real-LLM smoke + owner sync → Task 6. ✅
- Non-goal (interactive cost capture) → explicitly handled as `usage: null` in Task 3 Step 8. ✅

**2. Placeholder scan:** The only deliberately-deferred value is `DEFAULT_MAX_COST_PER_MTOK`, handled as an explicit, procedural **tuning step** (Task 4 Step 7) with a starting value (60), a calibration method, and a regression test — not a "TBD". The Task-1 handler-extraction note (`src/cli-handlers.js`) is a conditional with a concrete instruction. No bare TODOs.

**3. Type consistency:** `usage` raw totals (`{tokens, costReported}`) flow from `runHeadless` → `resolveUsage` → resolved `{tokens, cost:{amount,currency,source}}` → `buildRunResult`/metadata → `sumWaveUsage` → wave `usage`. `checkBudget` leg shape `{modelInput, model, pricing}` matches `validateFanoutModels`'s new return and the solo-start leg built in Task 4 Step 9. `ERROR_CODES` strings are referenced consistently. `failJson(useJson, {...}) → 1` used uniformly. `lookupPricing` returns numeric per-token pricing everywhere it's consumed (budget, resolveLegCost). ✅
