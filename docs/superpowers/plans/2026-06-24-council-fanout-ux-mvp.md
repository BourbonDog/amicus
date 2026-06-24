# Council / Fan-out UX — MVP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the mature council/fan-out engine *legible* — surface live per-leg progress, show cost in human output, reach the deterministic council spine over MCP, and render a shareable disagreement+verdict report — all as presentation/wrappers over data WS-2/3/4 already persist, with **zero schema change**.

**Architecture:** Four units. **A** (live progress) adds a pure per-leg rollup module read by the fan-out heartbeat and the MCP `amicus_status` wave branch. **B** (cost-in-output) adds a shared `formatCost` primitive surfaced in `formatWaveHuman` and the council CLI renderer. **C** (council MCP) adds three thin handlers over the existing pure `src/council/*` functions plus their tool schemas. **D** (report renderer) is a new pure `src/council/report.js` (+ `report-html.js`) exposed as `amicus council report`, golden-tested against the WS-3 av-receiver fixture. No change to the council trust spine, headless completion logic, or any persisted schema.

**Tech Stack:** Node.js (CommonJS, `'use strict'`), Jest, Zod (MCP input schemas), `@modelcontextprotocol/sdk`. Source: `2026-06-24-council-fanout-ux-mvp-design.md`. Base: local `main` `976aaa1` (v1.2.1).

## Global Constraints

_Every task's requirements implicitly include this section._

- **Module system:** CommonJS, every source/test file starts with `'use strict';`. New `src/**/*.js` files MUST stay **≤ 300 lines** (the `check:sizes` gate). `src/mcp-server.js` (631) and `src/mcp-tools.js` (407) are on the gate's exclusion list — additions there are allowed, but keep them minimal.
- **Zero schema change:** do NOT bump `SCHEMA_VERSION` (result-schema), `COUNCIL_SCHEMA_VERSION`, `VERDICT_SCHEMA_VERSION`, or `LEDGER_SCHEMA_VERSION`. All units read existing fields only.
- **Cost is never invented:** only surface `usage.cost` exactly as resolved, always carrying its `source` tag (`reported` / `estimated` / `unknown` / `mixed`). A null amount renders `—` (or `?` for an explicitly `unknown` source); never fabricate a figure.
- **Judgment stays in Claude:** Unit D renders deterministic data only. It does NOT score, anonymize, synthesize, or re-compute tiers — it reads the FINAL tier from `verdict.json` (after any Claude override).
- **Error envelopes:** CLI pre-flight failures go through `failJson(useJson, {code: ERROR_CODES.BAD_ARGS, message, hint})` (from `src/utils/error-doc.js`), which writes a typed JSON envelope to stdout on `--json` and returns exit code 1.
- **Gates (run before every commit; the pre-commit/pre-push hooks enforce a subset):**
  - `npm test` — full unit suite (jest; excludes `*.integration.test.js`).
  - `npm run lint` — ESLint over `src/`. **No unused vars** (removing an import that becomes unused is mandatory).
  - `npm run check:secrets` — secret scan.
  - `npm run check:sizes` — 300-line gate.
  - `npm run generate-docs:check` — CLAUDE.md AUTO markers current (pre-commit auto-stages CLAUDE.md; never hand-edit the AUTO blocks).
  - `npm run validate-docs` — doc link/marker validation.
  - Single file: `npx jest <path/to/file.test.js>`. Single test: `npx jest <file> -t "<name pattern>"`.
- **Commit style:** Conventional Commits, scope `council-ux`: `feat(council-ux): …` / `test(council-ux): …` / `docs(council-ux): …`. ~50-char subject, lowercase, no trailing period. The repo history carries **no `Co-Authored-By` trailer** — match it.
- **Git policy:** build in a worktree off `main`; commit locally only. **Do NOT push or open a PR** — this program is local-first until the owner OKs a milestone (WS-0..4 cadence).

## Setup (before Task 1)

- [ ] **Create the build worktree off `main` and junction `node_modules`** (Windows PowerShell; run once):

```bash
git -C C:/Users/sendt/dev/amicus worktree add C:/Users/sendt/dev/amicus-councilux -b councilux/mvp main
```

```powershell
New-Item -ItemType Junction -Path C:\Users\sendt\dev\amicus-councilux\node_modules -Target C:\Users\sendt\dev\amicus\node_modules
node C:\Users\sendt\dev\amicus-councilux\scripts\setup-hooks.js
```

All subsequent work happens in `C:\Users\sendt\dev\amicus-councilux`. Hooks fire in the worktree (PR #9). **Junction-safe teardown after merge:** `Remove-Item -Force C:\Users\sendt\dev\amicus-councilux\node_modules` (NO `-Recurse` — it would delete the shared target), then `git -C C:/Users/sendt/dev/amicus worktree remove --force C:/Users/sendt/dev/amicus-councilux`.

---

# Unit A — Wave-aware live progress

### Task A1: Stall primitive in `progress.js`

**Files:**
- Modify: `src/sidecar/progress.js` (add `STALL_MS` + `isStalled`; export them at `module.exports`, line ~212)
- Test: `tests/sidecar/progress.test.js` (add a `describe('isStalled', …)` block)

**Interfaces:**
- Produces: `STALL_MS: number` (ms idle threshold) and `isStalled(lastActivityMs: number|null|undefined) → boolean`. Consumed by Task A2 (heartbeat) and Task A3 (MCP enrichment).

- [ ] **Step 1: Write the failing test** — append to `tests/sidecar/progress.test.js`:

```javascript
describe('isStalled', () => {
  const { isStalled, STALL_MS } = require('../../src/sidecar/progress');
  test('null / undefined idle is never stalled', () => {
    expect(isStalled(null)).toBe(false);
    expect(isStalled(undefined)).toBe(false);
  });
  test('idle at or under the threshold is not stalled', () => {
    expect(isStalled(STALL_MS)).toBe(false);
    expect(isStalled(STALL_MS - 1)).toBe(false);
  });
  test('idle over the threshold is stalled', () => {
    expect(isStalled(STALL_MS + 1)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/sidecar/progress.test.js -t isStalled`
Expected: FAIL — `isStalled is not a function`.

- [ ] **Step 3: Implement** — in `src/sidecar/progress.js`, add near the top-level helpers (above `module.exports`):

```javascript
/** A leg with no new activity for longer than this (ms) is flagged stalled in rollups. */
const STALL_MS = 60000;

/**
 * Is a leg stalled? True only when we have a real idle measurement that exceeds
 * the threshold; an unknown / just-started leg (null) is never "stalled".
 * @param {number|null|undefined} lastActivityMs ms since last activity
 * @returns {boolean}
 */
function isStalled(lastActivityMs) {
  return typeof lastActivityMs === 'number' && lastActivityMs > STALL_MS;
}
```

Then extend the existing `module.exports` (line ~212) — it currently reads `{ readProgress, writeProgress, extractLatest, computeLastActivity, STAGE_LABELS }`; add the two new members so it becomes `{ readProgress, writeProgress, extractLatest, computeLastActivity, STAGE_LABELS, STALL_MS, isStalled }`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest tests/sidecar/progress.test.js`
Expected: PASS (all existing progress tests + the 3 new `isStalled` cases).

- [ ] **Step 5: Commit**

```bash
git add src/sidecar/progress.js tests/sidecar/progress.test.js
git commit -m "feat(council-ux): stall primitive (STALL_MS + isStalled) in progress"
```

---

### Task A2: Pure wave-progress rollup module

**Files:**
- Create: `src/sidecar/wave-progress.js`
- Test: `tests/sidecar/wave-progress.test.js`

**Interfaces:**
- Consumes: `readProgress` + `isStalled` + `STALL_MS` from `./progress` (Task A1).
- Produces:
  - `formatWaveProgress(legStates: Array<{label,messages,latest,stage?,stalled}>) → string`
  - `readLegState({label, dir}) → {label, messages, latest, stage?, stalled}`
  - `createWaveHeartbeat(legs: Array<{label,dir}>, interval?: number) → {stop(): void}`
  Consumed by Task A3 (fan-out wiring).

- [ ] **Step 1: Write the failing test** — create `tests/sidecar/wave-progress.test.js`:

```javascript
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { formatWaveProgress, readLegState } = require('../../src/sidecar/wave-progress');

describe('formatWaveProgress', () => {
  test('renders one terse line per leg with stage, msgs, latest', () => {
    const out = formatWaveProgress([
      { label: 'gemini', messages: 2, latest: 'Reading file', stage: 'receiving', stalled: false },
      { label: 'deepseek', messages: 0, latest: 'starting…', stalled: false },
    ]);
    const lines = out.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('gemini');
    expect(lines[0]).toContain('receiving');
    expect(lines[0]).toContain('2 msg');
    expect(lines[0]).toContain('Reading file');
    expect(lines[1]).toContain('starting'); // no stage → "starting"
  });
  test('flags a stalled leg', () => {
    const out = formatWaveProgress([{ label: 'm', messages: 1, latest: 'x', stage: 'receiving', stalled: true }]);
    expect(out).toContain('stalled');
  });
});

describe('readLegState', () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leg-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  test('degrades to starting when progress.json is absent', () => {
    const s = readLegState({ label: 'gemini', dir });
    expect(s).toEqual({ label: 'gemini', messages: 0, latest: 'starting…', stalled: false });
  });
  test('reflects on-disk progress + conversation', () => {
    fs.writeFileSync(path.join(dir, 'conversation.jsonl'),
      [JSON.stringify({ role: 'assistant', content: 'hi' })].join('\n'));
    fs.writeFileSync(path.join(dir, 'progress.json'),
      JSON.stringify({ stage: 'receiving', stageLabel: 'Generating response...', updatedAt: new Date().toISOString() }));
    const s = readLegState({ label: 'gemini', dir });
    expect(s.label).toBe('gemini');
    expect(s.messages).toBe(1);
    expect(s.stage).toBe('receiving');
    expect(s.stalled).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/sidecar/wave-progress.test.js`
Expected: FAIL — `Cannot find module '../../src/sidecar/wave-progress'`.

- [ ] **Step 3: Implement** — create `src/sidecar/wave-progress.js`:

```javascript
// src/sidecar/wave-progress.js
'use strict';

/**
 * @module wave-progress
 * Per-leg live progress rollup for a fan-out wave. Each headless leg already
 * writes progress.json + conversation.jsonl to its own session dir; this reads
 * them on a timer and prints ONE terse line per leg to stderr — milestones,
 * never a token firehose (all three council models flagged firehose noise).
 */

const { readProgress, isStalled } = require('./progress');

const WAVE_HEARTBEAT_INTERVAL = 15000;

/**
 * Render one compact status line per leg. Pure: takes already-read leg states.
 * @param {Array<{label:string, messages:number, latest:string, stage?:string, stalled:boolean}>} legStates
 * @returns {string}
 */
function formatWaveProgress(legStates) {
  return legStates.map((s) => {
    const stage = s.stage || 'starting';
    const flag = s.stalled ? ' ⏳stalled' : '';
    return `[amicus]   ${String(s.label).padEnd(16)} ${String(stage).padEnd(10)} ` +
      `${s.messages} msg | ${s.latest}${flag}`;
  }).join('\n');
}

/**
 * Read a single leg's live state from its session dir. Degrades gracefully when
 * progress.json is absent (a leg that has not started writing yet).
 * @param {{label:string, dir:string}} leg
 * @returns {{label:string, messages:number, latest:string, stage?:string, stalled:boolean}}
 */
function readLegState(leg) {
  let p;
  try { p = readProgress(leg.dir); } catch { p = null; }
  if (!p) { return { label: leg.label, messages: 0, latest: 'starting…', stalled: false }; }
  return {
    label: leg.label,
    messages: p.messages,
    latest: p.latest,
    stage: p.stage,
    stalled: isStalled(p.lastActivityMs),
  };
}

/**
 * Start a wave heartbeat that prints a per-leg rollup each tick. Mirrors the
 * createHeartbeat contract: returns { stop() }.
 * @param {Array<{label:string, dir:string}>} legs
 * @param {number} [interval]
 * @returns {{stop: () => void}}
 */
function createWaveHeartbeat(legs, interval = WAVE_HEARTBEAT_INTERVAL) {
  const startTime = Date.now();
  const intervalId = setInterval(() => {
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const states = legs.map(readLegState);
    process.stderr.write(`[amicus] wave ${elapsed}s — ${states.length} legs\n${formatWaveProgress(states)}\n`);
  }, interval);
  return { stop() { clearInterval(intervalId); } };
}

module.exports = { formatWaveProgress, readLegState, createWaveHeartbeat, WAVE_HEARTBEAT_INTERVAL };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest tests/sidecar/wave-progress.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/sidecar/wave-progress.js tests/sidecar/wave-progress.test.js
git commit -m "feat(council-ux): pure per-leg wave-progress rollup module"
```

---

### Task A3: Wire the rollup into the fan-out heartbeat + MCP status

**Files:**
- Modify: `src/sidecar/fanout.js:112` (drop unused `createHeartbeat` import, add `createWaveHeartbeat`) and `:226` (use it)
- Modify: `src/mcp-server.js:11` (import `isStalled`) and `:265-268` (enrich each leg)
- Test: `tests/mcp-server.test.js` (add a wave-enrichment test in the `amicus_status` area)

**Interfaces:**
- Consumes: `createWaveHeartbeat` (A2), `readProgress` + `isStalled` (A1), `getSessionDir` (already imported in both files).

- [ ] **Step 1: Write the failing test** — append inside `tests/mcp-server.test.js` (follow the existing `describe('amicus_status enriched response', …)` fixture pattern: write session dirs under `tmpDir`, call `handlers.amicus_status(...)`, parse `result.content[0].text`):

```javascript
describe('amicus_status wave per-leg enrichment', () => {
  const fs = require('fs');
  const path = require('path');
  const os = require('os');
  const { getSessionDir } = require('../src/session-manager');
  let handlers; let tmpDir;
  beforeEach(() => {
    handlers = require('../src/mcp-server').handlers;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wave-status-'));
  });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  function writeSession(taskId, meta, extra = {}) {
    const dir = getSessionDir(tmpDir, taskId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify({ taskId, ...meta }));
    if (extra.conversation) { fs.writeFileSync(path.join(dir, 'conversation.jsonl'), extra.conversation); }
    if (extra.progress) { fs.writeFileSync(path.join(dir, 'progress.json'), JSON.stringify(extra.progress)); }
    return dir;
  }

  test('running wave legs carry latestActivity + stalled', async () => {
    writeSession('wv1-1', { model: 'gemini', status: 'running' }, {
      conversation: JSON.stringify({ role: 'assistant', content: 'working' }),
      progress: { stage: 'receiving', stageLabel: 'Generating response...', updatedAt: new Date().toISOString() },
    });
    writeSession('wv1-2', { model: 'deepseek', status: 'running' }); // no progress yet
    writeSession('wv1', { type: 'wave', status: 'running', legs: ['wv1-1', 'wv1-2'],
      models: ['gemini', 'deepseek'], pid: process.pid, createdAt: new Date().toISOString() });

    const result = await handlers.amicus_status({ taskId: 'wv1' }, tmpDir);
    const body = JSON.parse(result.content[0].text);
    expect(body.legs).toHaveLength(2);
    expect(body.legs[0]).toHaveProperty('latestActivity');
    expect(body.legs[0]).toHaveProperty('stalled', false);
    expect(body.legs[0].messages).toBe(1);
    // leg with no progress.json still returns its base fields without throwing
    expect(body.legs[1].model).toBe('deepseek');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/mcp-server.test.js -t "per-leg enrichment"`
Expected: FAIL — `body.legs[0]` has no `latestActivity` property.

- [ ] **Step 3a: Wire the fan-out heartbeat** — in `src/sidecar/fanout.js`, change the line-112 require from:

```javascript
  const { startOpenCodeServer, createHeartbeat, HEARTBEAT_INTERVAL } = require('./session-utils');
```

to (drop the now-unused `createHeartbeat`, add the rollup module):

```javascript
  const { startOpenCodeServer, HEARTBEAT_INTERVAL } = require('./session-utils');
  const { createWaveHeartbeat } = require('./wave-progress');
```

Then change line 226 from:

```javascript
  const heartbeat = options.quiet ? { stop() {} } : createHeartbeat(HEARTBEAT_INTERVAL);
```

to:

```javascript
  const heartbeat = options.quiet
    ? { stop() {} }
    : createWaveHeartbeat(
        legs.map((leg, i) => ({ label: leg.modelInput || leg.model, dir: legDirs[i] })),
        HEARTBEAT_INTERVAL
      );
```

(`legDirs` is already in scope — defined at line 209, before the heartbeat at 226.)

- [ ] **Step 3b: Enrich the MCP wave status** — in `src/mcp-server.js`, change the line-11 import from:

```javascript
const { readProgress } = require('./sidecar/progress');
```

to:

```javascript
const { readProgress, isStalled } = require('./sidecar/progress');
```

Then replace the wave-branch leg map (lines 265-268) from:

```javascript
      const legs = (metadata.legs || []).map((legId) => {
        const m = readMetadata(legId, cwd);
        return { taskId: legId, model: (m && m.model) || null, status: (m && m.status) || 'unknown' };
      });
```

with:

```javascript
      const legs = (metadata.legs || []).map((legId) => {
        const m = readMetadata(legId, cwd);
        const leg = { taskId: legId, model: (m && m.model) || null, status: (m && m.status) || 'unknown' };
        try {
          const p = readProgress(getSessionDir(cwd, legId));
          leg.messages = p.messages;
          leg.latestActivity = p.latest;
          leg.stalled = leg.status === 'running' && isStalled(p.lastActivityMs);
        } catch { /* no progress yet — leave base fields only */ }
        return leg;
      });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/mcp-server.test.js tests/sidecar/fanout.test.js`
Expected: PASS (new wave-enrichment test green; fanout suite unchanged). Then `npm run lint` — Expected: clean (confirms `createHeartbeat` is no longer an unused import in `fanout.js`).

- [ ] **Step 5: Commit**

```bash
git add src/sidecar/fanout.js src/mcp-server.js tests/mcp-server.test.js
git commit -m "feat(council-ux): wire per-leg rollup into fan-out heartbeat + amicus_status"
```

---

# Unit B — Cost/usage in human output

### Task B1: Shared `formatCost` primitive

**Files:**
- Modify: `src/utils/pricing.js` (add `formatCost`; export it)
- Test: `tests/utils/pricing.test.js` (add a `describe('formatCost', …)` block)

**Interfaces:**
- Produces: `formatCost(cost: {amount:number|null, source:string}|null|undefined) → string`. Consumed by Tasks B2, B3, and D1.

- [ ] **Step 1: Write the failing test** — append to `tests/utils/pricing.test.js`:

```javascript
describe('formatCost', () => {
  const { formatCost } = require('../../src/utils/pricing');
  test('reported renders a plain dollar figure', () => {
    expect(formatCost({ amount: 0.0123, currency: 'USD', source: 'reported' })).toBe('$0.0123');
    expect(formatCost({ amount: 25, currency: 'USD', source: 'reported' })).toBe('$25.00');
  });
  test('estimated and mixed get a ~ prefix', () => {
    expect(formatCost({ amount: 0.02, source: 'estimated' })).toBe('~$0.0200');
    expect(formatCost({ amount: 0.5, source: 'mixed' })).toBe('~$0.5000');
  });
  test('unknown source with null amount renders ?', () => {
    expect(formatCost({ amount: null, source: 'unknown' })).toBe('?');
  });
  test('missing cost renders an em dash', () => {
    expect(formatCost(null)).toBe('—');
    expect(formatCost(undefined)).toBe('—');
    expect(formatCost({ amount: null, source: 'reported' })).toBe('—');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/utils/pricing.test.js -t formatCost`
Expected: FAIL — `formatCost is not a function`.

- [ ] **Step 3: Implement** — in `src/utils/pricing.js`, add before `module.exports` and add `formatCost` to the exports:

```javascript
/**
 * Render a resolved cost object for humans. Never invents precision: a null
 * amount is '—' (or '?' when the source is explicitly 'unknown'); estimated /
 * mixed costs are marked with '~' so they can't be read as authoritative.
 * @param {{amount:number|null, source:string}|null|undefined} cost
 * @returns {string}
 */
function formatCost(cost) {
  if (!cost || cost.amount === null || cost.amount === undefined) {
    return cost && cost.source === 'unknown' ? '?' : '—';
  }
  const dollars = cost.amount < 1 ? `$${cost.amount.toFixed(4)}` : `$${cost.amount.toFixed(2)}`;
  return (cost.source === 'estimated' || cost.source === 'mixed') ? `~${dollars}` : dollars;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest tests/utils/pricing.test.js`
Expected: PASS (existing pricing tests + 4 new `formatCost` cases).

- [ ] **Step 5: Commit**

```bash
git add src/utils/pricing.js tests/utils/pricing.test.js
git commit -m "feat(council-ux): shared formatCost human renderer in pricing"
```

---

### Task B2: Cost in the fan-out human render

**Files:**
- Modify: `src/sidecar/fanout-output.js` (import `formatCost`; per-leg cost cell + wave total)
- Test: `tests/sidecar/fanout-output.test.js`

**Interfaces:**
- Consumes: `formatCost` (B1). Reads `leg.usage.cost` and `wave.usage.cost` (existing WS-2 fields).

- [ ] **Step 1: Write the failing test** — append to `tests/sidecar/fanout-output.test.js`:

```javascript
describe('formatWaveHuman cost', () => {
  const { formatWaveHuman } = require('../../src/sidecar/fanout-output');
  const wave = {
    waveId: 'wv1', status: 'complete', counts: { total: 2, complete: 2 }, durationMs: 12000,
    legs: [
      { taskId: 'wv1-1', modelInput: 'gemini', model: 'g', status: 'complete', durationMs: 6000, summary: 'ok',
        usage: { cost: { amount: 0.0123, source: 'reported' } } },
      { taskId: 'wv1-2', modelInput: 'deepseek', model: 'd', status: 'complete', durationMs: 6000, summary: 'ok',
        usage: { cost: { amount: 0.002, source: 'estimated' } } },
    ],
    usage: { cost: { amount: 0.0143, source: 'mixed' } },
  };
  test('shows a per-leg cost cell with source markers', () => {
    const out = formatWaveHuman(wave);
    expect(out).toContain('$0.0123');   // reported
    expect(out).toContain('~$0.0020');  // estimated
  });
  test('shows a wave total cost line', () => {
    expect(formatWaveHuman(wave)).toMatch(/Wave cost: ~\$0\.0143/);
  });
  test('a leg with no usage renders an em dash, not a crash', () => {
    const noUsage = { ...wave, legs: [{ taskId: 'x', modelInput: 'm', model: 'm', status: 'error', durationMs: 1 }],
      usage: undefined };
    expect(() => formatWaveHuman(noUsage)).not.toThrow();
    expect(formatWaveHuman(noUsage)).toContain('—');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/sidecar/fanout-output.test.js -t cost`
Expected: FAIL — output has no `$0.0123` / `Wave cost:`.

- [ ] **Step 3: Implement** — in `src/sidecar/fanout-output.js`:

Add the import at the top (after `'use strict';`):

```javascript
const { formatCost } = require('../utils/pricing');
```

Change the per-leg footer line (line 41) from:

```javascript
    lines.push(`  ${leg.taskId}  ${String(label).padEnd(12)} ${String(leg.status).padEnd(9)} ${fmtDuration(leg.durationMs)}`);
```

to (append a cost cell):

```javascript
    lines.push(`  ${leg.taskId}  ${String(label).padEnd(12)} ${String(leg.status).padEnd(9)} ` +
      `${String(fmtDuration(leg.durationMs)).padEnd(7)} ${formatCost(leg.usage && leg.usage.cost)}`);
```

Immediately after the `Wave …: status — …` push (line 38), add the wave total:

```javascript
  lines.push(`  Wave cost: ${formatCost(wave.usage && wave.usage.cost)}`);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest tests/sidecar/fanout-output.test.js`
Expected: PASS (existing render tests + 3 new cost cases).

- [ ] **Step 5: Commit**

```bash
git add src/sidecar/fanout-output.js tests/sidecar/fanout-output.test.js
git commit -m "feat(council-ux): per-leg cost + wave total in fanout human render"
```

---

### Task B3: Cost line in the council tally render

**Files:**
- Modify: `src/cli-handlers-council.js` (import `sumWaveUsage` + `formatCost`; add a cost line to `renderRecord`)
- Test: `tests/council/cli-handlers-council.test.js`

**Interfaces:**
- Consumes: `sumWaveUsage` + `formatCost` (B1) over `record.runStats` (each entry carries `.usage`).

- [ ] **Step 1: Write the failing test** — append to `tests/council/cli-handlers-council.test.js`:

```javascript
test('tally human render includes a cost line (sourced from runStats usage)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-cost-'));
  const file = path.join(dir, 'input.json');
  const withCost = {
    ...avInput,
    runStats: avInput.runStats.map((r, i) => ({
      ...r, usage: { tokens: { input: 100, output: 50 }, cost: { amount: 0.01 * (i + 1), source: 'reported' } },
    })),
  };
  fs.writeFileSync(file, JSON.stringify(withCost));
  const { code, out } = await capture(() => handleCouncil({ _: ['council', 'tally', file] })); // no --json
  expect(code).toBe(0);
  expect(out).toContain('Cost:');
  expect(out).toContain('$0.0600'); // 0.01+0.02+0.03 reported → toFixed(4)
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/council/cli-handlers-council.test.js -t "cost line"`
Expected: FAIL — render has no `Cost:` line.

- [ ] **Step 3: Implement** — in `src/cli-handlers-council.js`:

Change the line-5 import group to add pricing helpers:

```javascript
const { deriveReliability } = require('./council/ledger');
const { sumWaveUsage, formatCost } = require('./utils/pricing');
```

Change `renderRecord` (lines 35-39) from:

```javascript
function renderRecord(r) {
  const t = r.tierCounts;
  return `Council tally (${r.meta.runId})\n` +
    `  Confirmed ${t.Confirmed}  Contested ${t.Contested}  Singleton ${t.Singleton}  Disputed ${t.Disputed}\n`;
}
```

to:

```javascript
function renderRecord(r) {
  const t = r.tierCounts;
  const cost = sumWaveUsage(r.runStats || []).cost;
  return `Council tally (${r.meta.runId})\n` +
    `  Confirmed ${t.Confirmed}  Contested ${t.Contested}  Singleton ${t.Singleton}  Disputed ${t.Disputed}\n` +
    `  Cost: ${formatCost(cost)}\n`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest tests/council/cli-handlers-council.test.js`
Expected: PASS (existing council CLI tests + the new cost-line case; the av-receiver `--json` test is unaffected — it asserts only `tierCounts`).

- [ ] **Step 5: Commit**

```bash
git add src/cli-handlers-council.js tests/council/cli-handlers-council.test.js
git commit -m "feat(council-ux): cost line in amicus council tally render"
```

---

# Unit C — Council MCP tools

### Task C1: Council tool schemas in `mcp-tools.js`

**Files:**
- Modify: `src/mcp-tools.js` (add three tool definitions before the `amicus_guide` entry / array close at line ~283)
- Test: `tests/mcp-tools.test.js`

**Interfaces:**
- Produces (schema only): `amicus_council_tally`, `amicus_council_stats`, `amicus_verdict` entries in `getTools()`. Handlers are wired in Task C2.

- [ ] **Step 1: Write the failing test** — append to `tests/mcp-tools.test.js`:

```javascript
describe('council MCP tool schemas', () => {
  const { getTools } = require('../src/mcp-tools');
  const byName = () => Object.fromEntries(getTools().map(t => [t.name, t]));
  test('exposes the three council tools', () => {
    const t = byName();
    for (const name of ['amicus_council_tally', 'amicus_council_stats', 'amicus_verdict']) {
      expect(t).toHaveProperty(name);
      expect(typeof t[name].description).toBe('string');
      expect(t[name].annotations).toHaveProperty('readOnlyHint', true);
    }
  });
  test('tally schema requires findings, adjudications, rankings, meta', () => {
    const tally = byName().amicus_council_tally;
    for (const k of ['meta', 'findings', 'adjudications', 'rankings']) {
      expect(tally.inputSchema).toHaveProperty(k);
    }
  });
  test('stats schema has no required inputs', () => {
    const stats = byName().amicus_council_stats;
    expect(Object.keys(stats.inputSchema)).toEqual(expect.arrayContaining(['project']));
  });
});
```

Also update the existing exact-count assertion in `tests/mcp-tools.test.js` (line ~42) — change `expect(TOOLS).toHaveLength(10);` to `expect(TOOLS).toHaveLength(13);`. Task C1 adds three tools, so the fixed count must move from 10 to 13 or that pre-existing test fails at Step 4.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/mcp-tools.test.js -t council`
Expected: FAIL — the new council tools are absent from `getTools()` (the `-t council` filter runs only the new block; the count assertion turns green once Step 3 adds the tools).

- [ ] **Step 3: Implement** — in `src/mcp-tools.js`, insert these three objects into the array returned by `getTools()` (place them just before the `amicus_guide` entry at line ~284). Add the shared sub-schemas once, above the three tool objects:

```javascript
  {
    name: 'amicus_council_tally',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description:
      'Deterministic council tally over an ASSEMBLED, de-anonymized input ' +
      '(meta + findings + adjudications + rankings). Peers-only tier cascade ' +
      '(Confirmed/Contested/Disputed/Singleton) + street-cred. Pure + synchronous: ' +
      'returns the tally record immediately. No subprocess, no polling. Claude ' +
      'assembles the input and may override margin tiers afterward.',
    inputSchema: {
      meta: z.object({
        runId: z.string(), runType: z.string().optional(), date: z.string().optional(),
        models: z.array(z.string()).min(1), chair: z.string().optional(),
        claudeInCouncil: z.boolean().optional(),
      }).describe('Run metadata; meta.models lists every reviewed model.'),
      findings: z.array(z.object({
        id: z.string(), raiser: z.string(), severity: z.string(), claim: z.string().optional(),
      })).describe('Run-global findings (ids already A1/B2/C3-prefixed by Claude).'),
      adjudications: z.array(z.object({
        judge: z.string(), findingId: z.string(), verdict: z.enum(['agree', 'dispute', 'neutral']),
      })).describe('One row per (judge × finding).'),
      rankings: z.array(z.object({
        judge: z.string(), order: z.array(z.union([z.string(), z.array(z.string())])),
      })).describe("Each judge's preference order over the reviews (ties = nested array)."),
      runStats: z.array(z.record(z.any())).optional().describe('Optional per-model run stats (status/duration/usage).'),
      project: z.string().optional().describe('Optional project directory path.'),
    },
  },
  {
    name: 'amicus_council_stats',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description:
      'Per-model reviewer reliability derived from the append-only council ledger ' +
      '(avg peers-only street-cred, lifetime confirm/fact-error rates). Read-only; ' +
      'no inputs required.',
    inputSchema: {
      project: z.string().optional().describe('Optional project directory path.'),
    },
  },
  {
    name: 'amicus_verdict',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description:
      "Merge a tally record with Claude's Stage-4 decisions into the verdict " +
      'object (final tiers after overrides, decisions, applied flags). Pure + ' +
      'synchronous; returns the verdict — does NOT write it to disk.',
    inputSchema: {
      record: z.record(z.any()).describe('A tally() output record (from amicus_council_tally).'),
      decisions: z.array(z.object({
        id: z.string(), decision: z.string().optional(), applied: z.boolean().optional(),
        duplicateOf: z.string().nullable().optional(),
        tierOverride: z.object({ from: z.string(), to: z.string(), reason: z.string() }).nullable().optional(),
      })).optional().describe('Stage-4 per-finding decisions (default []).'),
      project: z.string().optional().describe('Optional project directory path.'),
    },
  },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest tests/mcp-tools.test.js`
Expected: PASS (existing tool-schema tests + 3 new council cases).

- [ ] **Step 5: Commit**

```bash
git add src/mcp-tools.js tests/mcp-tools.test.js
git commit -m "feat(council-ux): council MCP tool schemas (tally/stats/verdict)"
```

---

### Task C2: Council MCP handlers in `mcp-server.js`

**Files:**
- Modify: `src/mcp-server.js` (add three handlers to the exported `handlers` object, before `amicus_setup` at line ~577)
- Test: `tests/mcp-server.test.js`

**Interfaces:**
- Consumes: `tally` (`src/council/tally.js`), `buildVerdict` (`src/council/verdict.js`), `deriveReliability` (`src/council/ledger.js`); the registration loop already wires every `getTools()` name to `handlers[name]`.

- [ ] **Step 1: Write the failing test** — append to `tests/mcp-server.test.js`:

```javascript
describe('council MCP handlers', () => {
  const avInput = require('./council/fixtures/av-receiver-input');
  let handlers;
  beforeEach(() => { handlers = require('../src/mcp-server').handlers; });

  test('amicus_council_tally returns a tally record as JSON content', async () => {
    const res = await handlers.amicus_council_tally(avInput, process.cwd());
    expect(res.isError).toBeFalsy();
    const doc = JSON.parse(res.content[0].text);
    expect(doc.tierCounts).toEqual({ Confirmed: 19, Contested: 2, Singleton: 11, Disputed: 3 });
  });

  test('amicus_verdict merges decisions into the verdict', async () => {
    const tallyRes = await handlers.amicus_council_tally(avInput, process.cwd());
    const record = JSON.parse(tallyRes.content[0].text);
    const res = await handlers.amicus_verdict({ record, decisions: [{ id: 'A1', decision: 'accepted', applied: true }] }, process.cwd());
    const v = JSON.parse(res.content[0].text);
    expect(v.findings.find(f => f.id === 'A1').decision).toBe('accepted');
  });

  test('amicus_council_stats returns aggregated reliability', async () => {
    jest.resetModules();
    jest.doMock('../src/council/ledger', () => ({
      deriveReliability: () => [{ model: 'gpt', runs: 3, lowN: false, avgStreetCredPeersOnly: 1.4 }],
    }));
    const h = require('../src/mcp-server').handlers;
    const res = await h.amicus_council_stats({}, process.cwd());
    const agg = JSON.parse(res.content[0].text);
    expect(agg[0].model).toBe('gpt');
    jest.dontMock('../src/council/ledger');
    jest.resetModules();
  });

  test('amicus_council_tally on malformed input returns isError', async () => {
    const res = await handlers.amicus_council_tally({ meta: { models: [] } }, process.cwd());
    expect(res.isError).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/mcp-server.test.js -t "council MCP handlers"`
Expected: FAIL — `handlers.amicus_council_tally is not a function`.

- [ ] **Step 3: Implement** — in `src/mcp-server.js`, add to the `handlers` object (insert before `async amicus_setup()` at line ~577):

```javascript
  async amicus_council_tally(input) {
    try {
      const { tally } = require('./council/tally');
      return textResult(JSON.stringify(tally(input)));
    } catch (err) { return textResult(`council tally failed: ${err.message}`, true); }
  },

  async amicus_council_stats() {
    try {
      const { deriveReliability } = require('./council/ledger');
      return textResult(JSON.stringify(deriveReliability()));
    } catch (err) { return textResult(`council stats failed: ${err.message}`, true); }
  },

  async amicus_verdict(input) {
    try {
      const { buildVerdict } = require('./council/verdict');
      return textResult(JSON.stringify(buildVerdict(input.record, input.decisions || [])));
    } catch (err) { return textResult(`verdict build failed: ${err.message}`, true); }
  },
```

(These three names also need NO entry in `LEGACY_TOOL_ALIASES` — they're new, no sidecar_* alias.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/mcp-server.test.js`
Expected: PASS (the 4 new council-handler cases + the existing `handlers has all expected tool names` test still green — note that test lists a fixed set and does NOT fail on additional handlers).

- [ ] **Step 5: Commit**

```bash
git add src/mcp-server.js tests/mcp-server.test.js
git commit -m "feat(council-ux): council MCP handlers (tally/stats/verdict)"
```

---

# Unit D — Verdict / disagreement report renderer (the differentiator)

> **CLI scope note:** the command is `amicus council report <verdict.json> [--wave <wave.json>] [--md|--html]`. The primary input is a `verdict.json` (self-sufficient: it carries findings with final tier + basis + adjudications, street-cred, and `runStats` usage). `--wave` optionally supplies the wave-level cost total (otherwise derived from `runStats`). Auto-resolving a bare `waveId` string to its run-folder `verdict.json` is intentionally deferred (the council run-folder layout is not codified in a machine contract) — tracked as a follow-up.

### Task D1: Pure report renderer (`report.js` + `report-html.js`)

**Files:**
- Create: `src/council/report.js` (neutral model builder + Markdown renderer + `buildReport` dispatcher)
- Create: `src/council/report-html.js` (HTML renderer)
- Test: `tests/council/report.test.js`

**Interfaces:**
- Consumes: `formatCost` + `sumWaveUsage` (`src/utils/pricing.js`).
- Produces: `buildReport({verdict, wave?, tallyRecord?}, {format:'md'|'html'}) → string`; `toModel(verdict, wave) → object` (internal, exported for the html module + tests).

- [ ] **Step 1: Write the failing test** — create `tests/council/report.test.js`:

```javascript
'use strict';
const { tally } = require('../../src/council/tally');
const { buildVerdict } = require('../../src/council/verdict');
const { buildReport } = require('../../src/council/report');
const avInput = require('./fixtures/av-receiver-input');

function verdictFixture() {
  const record = tally(avInput);
  return buildVerdict(record, [{ id: 'C6', decision: 'denied', applied: false }]);
}

describe('buildReport markdown', () => {
  const md = buildReport({ verdict: verdictFixture() }, { format: 'md' });
  test('has a titled header with run metadata', () => {
    expect(md).toContain('# Council Report');
    expect(md).toContain('av-receiver-council');
  });
  test('renders the adjudication matrix with judge columns', () => {
    expect(md).toContain('Adjudication matrix');
    for (const judge of ['deepseek', 'gpt', 'mistral']) { expect(md).toContain(judge); }
  });
  test('renders the tier counts (peers-only, WS-3 golden)', () => {
    expect(md).toContain('Confirmed');
    expect(md).toMatch(/Disputed[^\n]*\|\s*3/);
  });
  test('groups findings by tier, Disputed-first, and shows the decision', () => {
    const disputedIdx = md.indexOf('### Disputed');
    const singletonIdx = md.indexOf('### Singleton');
    expect(disputedIdx).toBeGreaterThan(-1);
    expect(disputedIdx).toBeLessThan(singletonIdx);
    expect(md).toContain('C6'); // a Disputed finding, decided "denied"
    expect(md).toContain('denied');
  });
  test('renders a street-cred table and a cost table (no invented numbers)', () => {
    expect(md).toContain('Street-cred');
    expect(md).toContain('Cost');
    expect(md).toContain('—'); // av-receiver runStats.usage is null → em dash
  });
});

describe('buildReport html', () => {
  const html = buildReport({ verdict: verdictFixture() }, { format: 'html' });
  test('is a self-contained document with inline styles and a table', () => {
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<style');
    expect(html).toContain('<table');
    expect(html).toContain('av-receiver-council');
  });
});

describe('buildReport guards', () => {
  test('throws on a verdict missing findings', () => {
    expect(() => buildReport({ verdict: { runId: 'x' } }, { format: 'md' })).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/council/report.test.js`
Expected: FAIL — `Cannot find module '../../src/council/report'`.

- [ ] **Step 3a: Implement the model builder + Markdown renderer** — create `src/council/report.js`:

```javascript
// src/council/report.js
'use strict';

/**
 * @module council/report
 * Pure verdict/disagreement report renderer (the differentiator). Reads a
 * verdict.json (+ optional wave.json for the cost total) and produces a single
 * self-contained Markdown or HTML string. Renders deterministic data only — no
 * scoring, anonymization, or synthesis (that stays in Claude).
 */

const { formatCost, sumWaveUsage } = require('../utils/pricing');

const TIER_ORDER = ['Disputed', 'Contested', 'Confirmed', 'Singleton'];
const SYMBOL = { agree: '✓', dispute: '✗', neutral: '–' };

/** Build a neutral, render-agnostic model from a verdict (+ optional wave). */
function toModel(verdict, wave) {
  if (!verdict || !Array.isArray(verdict.findings)) {
    throw new Error('verdict.json must have a findings[] array');
  }
  const judges = verdict.council || [];
  const findings = verdict.findings.map((f) => {
    const byJudge = {};
    for (const j of judges) { byJudge[j] = null; }
    for (const adj of (f.adjudications || [])) { byJudge[adj.judge] = adj.verdict; }
    return {
      id: f.id, severity: f.severity, raiser: f.raiser, tier: f.tier,
      basis: f.basis || { a: 0, d: 0, n: 0 }, decision: f.decision || null,
      applied: f.applied === true, byJudge,
    };
  });
  const runStats = verdict.runStats || [];
  const costRows = runStats.map(r => ({
    model: r.model, status: r.status, durationMs: r.durationMs,
    cost: r.usage && r.usage.cost ? r.usage.cost : null,
  }));
  const total = (wave && wave.usage && wave.usage.cost) ? wave.usage.cost : sumWaveUsage(runStats).cost;
  return {
    header: {
      runType: verdict.runType || 'review', runId: verdict.runId, date: verdict.date,
      chair: verdict.chair, council: judges, claudeInCouncil: verdict.claudeInCouncil === true,
    },
    tierCounts: verdict.tierCounts || { Confirmed: 0, Contested: 0, Singleton: 0, Disputed: 0 },
    judges, findings,
    streetCred: verdict.streetCred || [],
    cost: { rows: costRows, total },
  };
}

function fmtNum(v) { return (v === null || v === undefined) ? '—' : v.toFixed(2); }
function fmtDur(ms) { return (ms === null || ms === undefined) ? '—' : `${Math.round(ms / 1000)}s`; }

function renderMd(m) {
  const h = m.header;
  const out = [];
  out.push(`# Council Report — ${h.runType} (${h.runId})`);
  const meta = [h.date, h.chair ? `chair: ${h.chair}` : null, `council: ${h.council.join(', ')}`,
    h.claudeInCouncil ? 'Claude in council' : null].filter(Boolean).join(' · ');
  out.push(`\n_${meta}_\n`);

  out.push('## Verdict summary\n');
  out.push('| Tier | Count |\n|---|---|');
  for (const t of TIER_ORDER) { out.push(`| ${t} | ${m.tierCounts[t]} |`); }

  out.push('\n## Adjudication matrix\n');
  out.push(`| Finding | Sev | Raiser | ${m.judges.join(' | ')} | Tier | Decision |`);
  out.push(`|---|---|---|${m.judges.map(() => '---').join('|')}|---|---|`);
  for (const f of m.findings) {
    const cells = m.judges.map((j) => {
      const v = f.byJudge[j];
      return (v ? SYMBOL[v] : ' ') + (j === f.raiser ? '*' : '');
    });
    out.push(`| ${f.id} | ${f.severity} | ${f.raiser} | ${cells.join(' | ')} | ${f.tier} | ${f.decision || ''} |`);
  }
  out.push('\n_Legend: ✓ agree · ✗ dispute · – neutral · `*` raiser\'s own vote_\n');

  out.push('## Street-cred (peers-only; lower = better)\n');
  out.push('| Model | peers-only | with-self |\n|---|---|---|');
  for (const s of m.streetCred) { out.push(`| ${s.model} | ${fmtNum(s.peersOnly)} | ${fmtNum(s.withSelf)} |`); }

  out.push('\n## Findings by tier\n');
  for (const t of TIER_ORDER) {
    const group = m.findings.filter(f => f.tier === t);
    if (!group.length) { continue; }
    out.push(`### ${t}`);
    for (const f of group) {
      const dec = f.decision ? ` — ${f.decision}${f.applied ? ' (applied)' : ''}` : '';
      out.push(`- **${f.id}** (${f.severity}, raiser ${f.raiser}) — a${f.basis.a}/d${f.basis.d}/n${f.basis.n}${dec}`);
    }
    out.push('');
  }

  out.push('## Cost\n');
  out.push('| Model | Status | Duration | Cost |\n|---|---|---|---|');
  for (const r of m.cost.rows) { out.push(`| ${r.model} | ${r.status} | ${fmtDur(r.durationMs)} | ${formatCost(r.cost)} |`); }
  out.push(`| **Wave total** | | | ${formatCost(m.cost.total)} |`);

  return out.join('\n') + '\n';
}

/**
 * @param {{verdict:object, wave?:object, tallyRecord?:object}} sources
 * @param {{format:'md'|'html'}} opts
 * @returns {string}
 */
function buildReport(sources, opts = {}) {
  const model = toModel(sources.verdict, sources.wave);
  if (opts.format === 'html') { return require('./report-html').renderHtml(model); }
  return renderMd(model);
}

module.exports = { buildReport, toModel, TIER_ORDER, SYMBOL };
```

- [ ] **Step 3b: Implement the HTML renderer** — create `src/council/report-html.js`:

```javascript
// src/council/report-html.js
'use strict';

/**
 * @module council/report-html
 * Self-contained HTML renderer for the council report (inline CSS, no server,
 * tier-colored rows). Consumes the neutral model from council/report.js.
 */

const { formatCost } = require('../utils/pricing');
const { TIER_ORDER, SYMBOL } = require('./report');

const TIER_COLOR = { Disputed: '#fde2e1', Contested: '#fef3c7', Confirmed: '#dcfce7', Singleton: '#e5e7eb' };

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function num(v) { return (v === null || v === undefined) ? '—' : v.toFixed(2); }
function dur(ms) { return (ms === null || ms === undefined) ? '—' : `${Math.round(ms / 1000)}s`; }

function renderHtml(m) {
  const h = m.header;
  const judgeHead = m.judges.map(j => `<th>${esc(j)}</th>`).join('');
  const matrixRows = m.findings.map((f) => {
    const cells = m.judges.map((j) => {
      const v = f.byJudge[j];
      return `<td class="c">${v ? SYMBOL[v] : ''}${j === f.raiser ? '<sup>*</sup>' : ''}</td>`;
    }).join('');
    return `<tr style="background:${TIER_COLOR[f.tier] || '#fff'}">` +
      `<td>${esc(f.id)}</td><td>${esc(f.severity)}</td><td>${esc(f.raiser)}</td>${cells}` +
      `<td>${esc(f.tier)}</td><td>${esc(f.decision || '')}</td></tr>`;
  }).join('');
  const credRows = m.streetCred.map(s =>
    `<tr><td>${esc(s.model)}</td><td>${num(s.peersOnly)}</td><td>${num(s.withSelf)}</td></tr>`).join('');
  const tierRows = TIER_ORDER.map(t =>
    `<tr><td>${t}</td><td>${m.tierCounts[t]}</td></tr>`).join('');
  const costRows = m.cost.rows.map(r =>
    `<tr><td>${esc(r.model)}</td><td>${esc(r.status)}</td><td>${dur(r.durationMs)}</td>` +
    `<td>${esc(formatCost(r.cost))}</td></tr>`).join('');
  const meta = [h.date, h.chair ? `chair: ${h.chair}` : null, `council: ${h.council.join(', ')}`,
    h.claudeInCouncil ? 'Claude in council' : null].filter(Boolean).map(esc).join(' · ');

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<title>Council Report — ${esc(h.runId)}</title>
<style>
  body { font: 14px/1.5 system-ui, sans-serif; max-width: 1000px; margin: 2rem auto; padding: 0 1rem; color: #1f2937; }
  h1 { font-size: 1.5rem; } h2 { margin-top: 2rem; border-bottom: 1px solid #e5e7eb; padding-bottom: .25rem; }
  table { border-collapse: collapse; width: 100%; margin: .5rem 0; }
  th, td { border: 1px solid #e5e7eb; padding: .35rem .5rem; text-align: left; }
  th { background: #f9fafb; } td.c { text-align: center; } .meta { color: #6b7280; }
  .legend { color: #6b7280; font-size: .85rem; }
</style></head><body>
<h1>Council Report — ${esc(h.runType)} (${esc(h.runId)})</h1>
<p class="meta">${meta}</p>
<h2>Verdict summary</h2>
<table><tr><th>Tier</th><th>Count</th></tr>${tierRows}</table>
<h2>Adjudication matrix</h2>
<table><tr><th>Finding</th><th>Sev</th><th>Raiser</th>${judgeHead}<th>Tier</th><th>Decision</th></tr>${matrixRows}</table>
<p class="legend">✓ agree · ✗ dispute · – neutral · <sup>*</sup> raiser's own vote</p>
<h2>Street-cred <span class="meta">(peers-only; lower = better)</span></h2>
<table><tr><th>Model</th><th>peers-only</th><th>with-self</th></tr>${credRows}</table>
<h2>Cost</h2>
<table><tr><th>Model</th><th>Status</th><th>Duration</th><th>Cost</th></tr>${costRows}
<tr><td><strong>Wave total</strong></td><td></td><td></td><td>${esc(formatCost(m.cost.total))}</td></tr></table>
</body></html>
`;
}

module.exports = { renderHtml };
```

- [ ] **Step 4: Run the tests to verify they pass + the size gate**

Run: `npx jest tests/council/report.test.js`
Expected: PASS (md header/matrix/tiers/groupings/street-cred/cost + html self-contained + guard).
Run: `npm run check:sizes`
Expected: clean (both new files are < 300 lines).

- [ ] **Step 5: Commit**

```bash
git add src/council/report.js src/council/report-html.js tests/council/report.test.js
git commit -m "feat(council-ux): pure verdict/disagreement report renderer (md + html)"
```

---

### Task D2: `amicus council report` CLI subcommand

**Files:**
- Modify: `src/cli-handlers-council.js` (add `runReport`; dispatch `report` in `handleCouncil`)
- Modify: `src/cli.js` (register `--html`/`--md` as boolean flags; add a `council report` usage line)
- Test: `tests/council/cli-handlers-council.test.js`

**Interfaces:**
- Consumes: `buildReport` (D1), `failJson`/`ERROR_CODES` (already imported), `fs` (already imported).

- [ ] **Step 1: Write the failing test** — append to `tests/council/cli-handlers-council.test.js`:

```javascript
const { tally } = require('../../src/council/tally');
const { buildVerdict } = require('../../src/council/verdict');

function writeVerdict(dir) {
  const v = buildVerdict(tally(avInput), [{ id: 'C6', decision: 'denied', applied: false }]);
  const p = path.join(dir, 'verdict.json');
  fs.writeFileSync(p, JSON.stringify(v));
  return p;
}

test('report renders markdown from a verdict.json (default --md)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-rep-'));
  const vp = writeVerdict(dir);
  const { code, out } = await capture(() => handleCouncil({ _: ['council', 'report', vp] }));
  expect(code).toBe(0);
  expect(out).toContain('# Council Report');
  expect(out).toContain('Adjudication matrix');
});

test('report --html emits a self-contained document', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-rep-'));
  const vp = writeVerdict(dir);
  const { code, out } = await capture(() => handleCouncil({ _: ['council', 'report', vp], html: true }));
  expect(code).toBe(0);
  expect(out).toContain('<!DOCTYPE html>');
  expect(out).toContain('<table');
});

test('report with a missing path → BAD_ARGS envelope on stdout, exit 1', async () => {
  const { code, out } = await capture(() => handleCouncil({ _: ['council', 'report'], json: true }));
  expect(code).toBe(1);
  expect(JSON.parse(out).error.code).toBe('BAD_ARGS');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/council/cli-handlers-council.test.js -t report`
Expected: FAIL — `unknown council subcommand 'report'` → exit 1 with `# Council Report` absent.

- [ ] **Step 3: Implement** — in `src/cli-handlers-council.js`:

Add the require near the top (after the existing requires):

```javascript
const { buildReport } = require('./council/report');
```

Add the `runReport` function (place it after `runStats`):

```javascript
function runReport(args, useJson) {
  const verdictPath = args._[2];
  if (!verdictPath) {
    return failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: 'council report needs a <verdict.json> path',
      hint: 'amicus council report <verdict.json> [--wave <wave.json>] [--md|--html]' });
  }
  let verdict;
  try { verdict = JSON.parse(fs.readFileSync(verdictPath, 'utf-8')); }
  catch (e) {
    return failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: `cannot read ${verdictPath}: ${e.message}`,
      hint: 'pass a valid verdict.json (from the council flow / amicus_verdict)' });
  }
  let wave = null;
  if (args.wave) {
    try { wave = JSON.parse(fs.readFileSync(args.wave, 'utf-8')); }
    catch (e) {
      return failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: `cannot read --wave ${args.wave}: ${e.message}`,
        hint: 'pass a valid wave.json or omit --wave' });
    }
  }
  let report;
  try { report = buildReport({ verdict, wave }, { format: args.html ? 'html' : 'md' }); }
  catch (e) {
    return failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: `cannot render report: ${e.message}`,
      hint: 'verdict.json needs findings[], streetCred[], runStats[], tierCounts' });
  }
  process.stdout.write(report.endsWith('\n') ? report : report + '\n');
  return 0;
}
```

Add the dispatch line inside `handleCouncil` (alongside `tally` / `stats`):

```javascript
  if (sub === 'report') { return runReport(args, useJson); }
```

Update the unknown-subcommand hint to mention `report`:

```javascript
  return failJson(useJson, { code: ERROR_CODES.BAD_ARGS,
    message: `unknown council subcommand '${sub || ''}'`, hint: 'amicus council tally|stats|report' });
```

Then register the new flags so the parser treats `--html` / `--md` as booleans (without this, `--html` would consume the next argument as its value). In `src/cli.js`, add `'html',` and `'md',` to the `booleanFlags` array inside `isBooleanFlag` (lines 100-116; `--json` is already there, `--wave` is value-taking by default so needs no entry):

```javascript
     'no-cost-gate',         // disable the budget gate for this run
     'html',                 // council report: emit a self-contained HTML page
     'md',                   // council report: emit Markdown (default)
   ];
```

And add a usage line under the existing `council stats` line (~307) in the help text:

```javascript
  council report <verdict.json> [--wave <wave.json>] [--md|--html]   Disagreement+verdict report
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/council/cli-handlers-council.test.js`
Expected: PASS (existing tally/stats cases + 3 new report cases). The unit tests construct `args` directly, so they don't depend on the `cli.js` change — but the real-CLI flag wiring above is what lets the Z1 smoke (`node bin/amicus.js council report … --html`) work.

- [ ] **Step 5: Commit**

```bash
git add src/cli-handlers-council.js tests/council/cli-handlers-council.test.js
git commit -m "feat(council-ux): amicus council report subcommand (md/html)"
```

---

### Task D3: Wire the renderer into the council skill

**Files:**
- Modify: `skills/second-opinion/SKILL.md` (Stage 5 — point report.md / crossreview-matrix.md assembly at `amicus council report`)

**Interfaces:** none (documentation). Gate: `npm run validate-docs` + `npm run generate-docs:check` + a read-back.

- [ ] **Step 1: Locate the Stage-5 outputs section**

Run: `grep -n "report.md\|crossreview-matrix\|## Stage 5\|Outputs" skills/second-opinion/SKILL.md`
Expected: the Stage-5 outputs bullets (around the `report.md` / `crossreview-matrix.md` lines the recon found).

- [ ] **Step 2: Add a renderer note** — under the Stage-5 `report.md` bullet, add:

```markdown
  - **Renderer:** once `verdict.json` is written, generate the human report with
    `amicus council report <run-folder>/verdict.json --md > <run-folder>/report.md`
    (use `--html` for a self-contained, shareable page). This emits the
    adjudication matrix (finding × judge), the peers-only street-cred table, the
    findings-by-tier groupings (Disputed-first), and the per-model + wave cost —
    deterministic data only. Prefer it over hand-assembling the matrix; reserve
    prose for the chair's synthesis and the decision log.
```

- [ ] **Step 3: Validate the docs**

Run: `npm run validate-docs && npm run generate-docs:check`
Expected: both clean (no broken links/markers introduced).

- [ ] **Step 4: Read it back**

Read `skills/second-opinion/SKILL.md` around the edit; confirm the note reads correctly in context and the command matches Task D2's interface exactly (`amicus council report <verdict.json> [--wave …] [--md|--html]`).

- [ ] **Step 5: Commit**

```bash
git add skills/second-opinion/SKILL.md
git commit -m "docs(council-ux): point council Stage-5 report.md at amicus council report"
```

---

# Finalize

### Task Z1: Real-LLM smoke + full gate sweep + holistic review

**Files:** none (verification only).

- [ ] **Step 1: Full gate sweep** (from the worktree root):

```bash
npm test && npm run lint && npm run check:secrets && npm run check:sizes && npm run generate-docs:check && npm run validate-docs
```

Expected: all green. Record the suite total (should be the v1.2.1 baseline + the new tests across Units A–D, 0 failed).

- [ ] **Step 2: Live per-leg progress + cost (Units A & B)** — run a real 2-model wave in the FOREGROUND (default `gemini` + `deepseek` work on this machine; never background a smoke — a backgrounded wave that ends its turn loses the run):

```bash
node bin/amicus.js fanout --models gemini,deepseek \
  --prompt "In one sentence each: name a strength and a weakness of monorepos." \
  --no-context --json --timeout 5
```

Expected on **stderr**: per-leg rollup lines (`[amicus] wave Ns — 2 legs` followed by one `gemini …` / `deepseek …` line each). Expected on **stdout**: a JSON wave with `usage.cost`. Then render the human view and confirm cost is visible:

```bash
node bin/amicus.js read <waveId>
```

Expected: per-leg cost cells + a `Wave cost: …` line (with correct `source` tags).

- [ ] **Step 3: MCP wave status enrichment (Unit A/MCP)** — sanity-check the enriched shape from a stored wave:

```bash
node -e "const {handlers}=require('./src/mcp-server'); handlers.amicus_status({taskId:'<waveId>'}, process.cwd()).then(r=>console.log(r.content[0].text))"
```

Expected: each leg object carries `latestActivity`, `messages`, and `stalled`.

- [ ] **Step 4: Council report end-to-end (Units C & D)** — build a verdict from the golden fixture and render both formats:

```bash
node -e "const {tally}=require('./src/council/tally'); const {buildVerdict,writeVerdictAtomic}=require('./src/council/verdict'); const av=require('./tests/council/fixtures/av-receiver-input'); writeVerdictAtomic('/tmp/verdict.json', buildVerdict(tally(av), [{id:'C6',decision:'denied',applied:false}]));"
node bin/amicus.js council report /tmp/verdict.json --md | head -40
node bin/amicus.js council report /tmp/verdict.json --html > /tmp/report.html && node -e "const s=require('fs').readFileSync('/tmp/report.html','utf-8'); if(!s.includes('<!DOCTYPE html>')||!s.includes('Adjudication matrix')) process.exit(1); console.log('html OK', s.length, 'bytes')"
```

Expected: the MD shows the matrix + tiers + street-cred + cost; the HTML is a self-contained doc. (Optional: open `/tmp/report.html` to eyeball the styling.) This renders from a real on-disk `verdict.json` (atomic-written here from the golden fixture), so it exercises the true artifact path. The end-to-end *live* round-trip — live model outputs → Stage 1-4 → `verdict.json` → report — runs only inside the Claude-orchestrated council skill (no single CLI produces a verdict from raw model text); it is validated on the next real council run, exactly as the WS-3 council smoke was deferred.

- [ ] **Step 5: Holistic review + finalize**

- Dispatch a fresh subagent (or run `/code-review`) for a whole-branch Opus review against the spec's acceptance criteria (§5): live per-leg progress + `amicus_status` enrichment; cost in `formatWaveHuman` + council tally; the three council MCP tools over no-Bash; `amicus council report --md|--html`; zero schema change; all gates green; smoke passed.
- Address any Critical/Important findings, then merge the worktree branch into local `main` (fast-forward), per the local-first program policy — **do not push.**

```bash
git -C C:/Users/sendt/dev/amicus merge --ff-only councilux/mvp
```

- Tear down the worktree (junction-safe): `Remove-Item -Force C:\Users\sendt\dev\amicus-councilux\node_modules` (NO `-Recurse`), then `git -C C:/Users/sendt/dev/amicus worktree remove --force C:/Users/sendt/dev/amicus-councilux`.

---

## Self-Review — spec coverage

| Spec item (§) | Covered by |
|---|---|
| Unit A — heartbeat per-leg rollup | A2 (`wave-progress.js`), A3 (fanout wiring) |
| Unit A — `amicus_status` `latestActivity` + `stalled` | A1 (`isStalled`), A3 (MCP enrichment) |
| Unit B — per-leg cost + wave total in `formatWaveHuman` | B1 (`formatCost`), B2 |
| Unit B — cost line in council renderers | B3 (`renderRecord`) |
| Unit C — `amicus_council_tally` / `amicus_council_stats` / `amicus_verdict` over MCP | C1 (schemas), C2 (handlers) |
| Unit D — `buildReport` (matrix, street-cred, tiers, cost; md+html) | D1 |
| Unit D — `amicus council report <…> [--md\|--html]` | D2 |
| Unit D — skill consumes the renderer | D3 |
| Decision 3 — schemas stay layered (read both, no new schema) | Global Constraints; D1 reads verdict + optional wave |
| Decision 4 — report is read-only over existing artifacts | D1/D2 (no writes, no model runs) |
| Decision 5 — judgment/anonymization stay in Claude | Global Constraints; D1 renders final verdict tiers only |
| §4 Testing — golden-fixture md+html; real-LLM 2-model smoke | D1 (golden), Z1 (smoke) |
| §5 Acceptance — full suite + all gates green | Z1 |
| §6 Risk — rollup terse/milestone, not a firehose | A2 (one line/leg, 15s tick unchanged) |

**Scope refinement flagged to owner:** the `amicus council report` CLI takes `<verdict.json> [--wave <wave.json>]` rather than the spec's `<verdict.json|waveId>`; bare-`waveId`→run-folder resolution is deferred (run-folder layout isn't a codified contract). `buildReport`'s pure core is unchanged by this.
