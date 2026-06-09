# F4 — Council-Native Fan-Out & Structured JSON Output — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `amicus fanout` (N models, same prompt, one shared OpenCode server, one call), a stable `--json` result schema on `fanout`/`start`/`read`, `--prompt-file` on `start`+`fanout`, an MCP `amicus_fanout` tool, wave-aware `status`/`read`/`list`/`abort`, and a consecutive-poll-failure fast-exit in the headless poller.

**Architecture:** One `fanout` process starts ONE OpenCode server and runs N concurrent `runHeadless()` legs via the existing external-server mode (`options.client`/`options.server`), each leg an ordinary session with `parentWave` metadata and an injected per-leg watchdog (never `process.exit`/`server.close`). Results aggregate into a versioned wave JSON document persisted as `wave.json` in the wave's session dir. Spec: `docs/superpowers/specs/2026-06-09-f4-fanout-json-design.md`.

**Tech Stack:** Node 18+ CommonJS, Jest 29, Zod (MCP schemas), existing amicus modules (`runHeadless`, `SessionPaths`, `markAborted`, `IdleWatchdog`, `buildMcpConfig`, `validateAgainstCatalog`).

---

## Execution setup (before Task 1)

Repo: `C:\Users\sendt\dev\amicus` (main, clean, origin synced). Per the F3 contended-clone lesson, build in an isolated worktree:

```powershell
git -C C:\Users\sendt\dev\amicus worktree add C:\Users\sendt\dev\amicus-f4 -b f4-exec main
New-Item -ItemType Junction -Path C:\Users\sendt\dev\amicus-f4\node_modules -Target C:\Users\sendt\dev\amicus\node_modules
```

All work happens in `C:\Users\sendt\dev\amicus-f4`. Rules:
- **NEVER run bare `npm install`** — the repo's postinstall mutates the user's global Claude config. If deps are ever needed: `npm install --ignore-scripts --omit=optional`.
- Baseline check before Task 1: `npm test` → expect **0 failed** (1669+ passed, 5 skipped). `npm run lint` → clean.
- Pre-commit hooks: lint-staged (eslint on staged src js), secret scan, 300-line cap on `src/**/*.js` **in subdirectories** (top-level `src/*.js` escape the glob — do not rely on this for NEW files; every new file below is sized to fit), CLAUDE.md marker regen (may auto-stage CLAUDE.md — that's expected).
- Cleanup of the junction later: `Remove-Item -Force C:\Users\sendt\dev\amicus-f4\node_modules` (**WITHOUT `-Recurse`** — `-Recurse` deletes the shared target!).

## File map

| File | Action | Responsibility |
| --- | --- | --- |
| `src/utils/result-schema.js` | Create (~190 lines) | Versioned run/wave JSON documents, status + exit-code mapping, rebuild-from-session |
| `src/utils/prompt-source.js` | Create (~60 lines) | `--prompt` XOR `--prompt-file` resolution, BOM strip, prompt metadata |
| `src/sidecar/fanout.js` | Create (~280 lines) | `runFanout` orchestrator, model-list validation, leg lifecycle, wave abort |
| `src/sidecar/fanout-output.js` | Create (~70 lines) | Human (non-JSON) wave output |
| `src/headless.js` | Modify | Consecutive-poll-failure fast-exit |
| `src/cli.js` | Modify | `getUsage()` fanout/json/prompt-file text |
| `bin/amicus.js` | Modify | `fanout` command, `--prompt-file`/`--json` on start, exit-code plumbing |
| `src/utils/lifecycle.js` | Modify | `fanout` is a one-shot command |
| `src/sidecar/start.js` | Modify | `json` option on `startSidecar` |
| `src/sidecar/session-utils.js` | Modify | `finalizeSession` quiet-stdout option |
| `src/sidecar/read.js` | Modify | `--json` on read (run+wave), wave marker in list |
| `src/cli-handlers.js` | Modify | `abort <waveId>` aborts all legs |
| `src/mcp-tools.js` | Modify | `amicus_fanout` tool definition |
| `src/mcp-server.js` | Modify | `amicus_fanout` handler, wave-aware status/read |
| `src/index.js` | Modify | Export `runFanout` |
| `tests/utils/result-schema.test.js`, `tests/utils/prompt-source.test.js`, `tests/sidecar/fanout.test.js`, `tests/sidecar/fanout-output.test.js`, `tests/headless-poll-failures.test.js`, `tests/fanout-cli.test.js`, `tests/read-json.test.js`, `tests/abort-wave.test.js`, `tests/mcp-fanout.test.js`, `tests/fanout-e2e.integration.test.js` | Create | Mirror tests |

Commits use `feat(f4):` / `test(f4):` / `docs(f4):` prefixes. Run the FULL suite (`npm test` — includes `evals/tests/`) before every commit; `*.integration.test.js` files are excluded from the default gate automatically.

---

### Task 1: Result schema module — builders + status/exit mapping

**Files:**
- Create: `src/utils/result-schema.js`
- Test: `tests/utils/result-schema.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// tests/utils/result-schema.test.js
'use strict';

const {
  SCHEMA_VERSION,
  buildRunResult,
  buildWaveResult,
  waveStatusFromLegs,
  waveExitCode,
} = require('../../src/utils/result-schema');

describe('result-schema', () => {
  describe('buildRunResult', () => {
    const baseMeta = {
      model: 'openrouter/deepseek/deepseek-v4',
      agent: 'plan',
      createdAt: '2026-06-09T10:00:00.000Z',
      completedAt: '2026-06-09T10:03:04.211Z',
      status: 'complete',
      opencodeSessionId: 'ses_123',
    };

    it('maps a clean result to status complete with schemaVersion and duration', () => {
      const doc = buildRunResult({
        taskId: 'a1b2c3d4',
        metadata: baseMeta,
        result: { completed: true, timedOut: false, aborted: false },
        summary: 'all good',
        modelInput: 'deepseek',
        sessionDir: 'C:\\x\\a1b2c3d4',
      });
      expect(doc).toMatchObject({
        schemaVersion: SCHEMA_VERSION,
        type: 'run',
        taskId: 'a1b2c3d4',
        waveId: null,
        model: 'openrouter/deepseek/deepseek-v4',
        modelInput: 'deepseek',
        agent: 'plan',
        status: 'complete',
        summary: 'all good',
        error: null,
        opencodeSessionId: 'ses_123',
      });
      expect(doc.durationMs).toBe(184211);
    });

    it('maps result flags: error beats complete, timeout and aborted map to their statuses', () => {
      expect(buildRunResult({ taskId: 't', metadata: baseMeta, result: { error: 'boom' } }).status).toBe('error');
      expect(buildRunResult({ taskId: 't', metadata: baseMeta, result: { timedOut: true } }).status).toBe('timeout');
      expect(buildRunResult({ taskId: 't', metadata: baseMeta, result: { aborted: true } }).status).toBe('aborted');
      // precedence: aborted > timeout > error
      expect(buildRunResult({ taskId: 't', metadata: baseMeta, result: { aborted: true, timedOut: true, error: 'x' } }).status).toBe('aborted');
    });

    it('without a result object, passes through metadata.status (read of a live/legacy session)', () => {
      const doc = buildRunResult({ taskId: 't', metadata: { ...baseMeta, status: 'running', completedAt: null } });
      expect(doc.status).toBe('running');
      expect(doc.durationMs).toBeNull();
    });

    it('error field is null when complete, populated from result.error or metadata.reason otherwise', () => {
      expect(buildRunResult({ taskId: 't', metadata: baseMeta, result: {} }).error).toBeNull();
      expect(buildRunResult({ taskId: 't', metadata: baseMeta, result: { error: 'boom' } }).error).toBe('boom');
      expect(buildRunResult({ taskId: 't', metadata: { ...baseMeta, status: 'error', reason: 'oops' } }).error).toBe('oops');
    });

    it('inherits waveId from metadata.parentWave when not given explicitly', () => {
      const doc = buildRunResult({ taskId: 't', metadata: { ...baseMeta, parentWave: 'deadbeef' } });
      expect(doc.waveId).toBe('deadbeef');
    });
  });

  describe('waveStatusFromLegs + waveExitCode', () => {
    const leg = (status) => ({ status });

    it('all complete → complete → exit 0', () => {
      const s = waveStatusFromLegs([leg('complete'), leg('complete')]);
      expect(s).toBe('complete');
      expect(waveExitCode(s)).toBe(0);
    });

    it('some complete → partial → exit 2', () => {
      const s = waveStatusFromLegs([leg('complete'), leg('timeout'), leg('error')]);
      expect(s).toBe('partial');
      expect(waveExitCode(s)).toBe(2);
    });

    it('none complete → error → exit 1', () => {
      const s = waveStatusFromLegs([leg('error'), leg('timeout')]);
      expect(s).toBe('error');
      expect(waveExitCode(s)).toBe(1);
    });

    it('none complete but some aborted → aborted → exit 1', () => {
      const s = waveStatusFromLegs([leg('aborted'), leg('error')]);
      expect(s).toBe('aborted');
      expect(waveExitCode(s)).toBe(1);
    });
  });

  describe('buildWaveResult', () => {
    it('assembles counts, status, prompt meta and timing', () => {
      const legs = [
        { status: 'complete', taskId: 'w-1' },
        { status: 'timeout', taskId: 'w-2' },
      ];
      const doc = buildWaveResult({
        waveId: 'deadbeef',
        legs,
        promptMeta: { source: 'file', file: 'C:\\b.md', chars: 41230 },
        createdAt: '2026-06-09T10:00:00.000Z',
        completedAt: '2026-06-09T10:05:12.456Z',
      });
      expect(doc).toMatchObject({
        schemaVersion: SCHEMA_VERSION,
        type: 'wave',
        waveId: 'deadbeef',
        status: 'partial',
        counts: { total: 2, complete: 1, error: 0, timeout: 1, aborted: 0 },
        prompt: { source: 'file', file: 'C:\\b.md', chars: 41230 },
      });
      expect(doc.durationMs).toBe(312456);
      expect(doc.legs).toHaveLength(2);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/utils/result-schema.test.js`
Expected: FAIL — `Cannot find module '../../src/utils/result-schema'`

- [ ] **Step 3: Implement the module**

```js
// src/utils/result-schema.js
'use strict';

/**
 * @module result-schema
 * Versioned, machine-parseable result documents for `--json` output (F4).
 *
 * Stability contract: fields are only ADDED within a SCHEMA_VERSION;
 * any rename/removal bumps SCHEMA_VERSION.
 */

const SCHEMA_VERSION = 1;

/** Leg/run statuses that count as terminal for wave aggregation. */
const TERMINAL_STATUSES = ['complete', 'error', 'timeout', 'aborted', 'crashed', 'idle-timeout'];

/**
 * Map a runHeadless-style result object to a run status.
 * Precedence: aborted > timeout > error > complete.
 * @param {{aborted?: boolean, timedOut?: boolean, error?: string}} result
 * @returns {string}
 */
function statusFromResult(result) {
  if (result.aborted) { return 'aborted'; }
  if (result.timedOut) { return 'timeout'; }
  if (result.error) { return 'error'; }
  return 'complete';
}

/**
 * Build a run document (single session result).
 * Used by `start --json`, `read <taskId> --json`, and every wave leg.
 *
 * @param {object} opts
 * @param {string} opts.taskId
 * @param {object} [opts.metadata] - Session metadata (model, agent, timestamps, status…)
 * @param {object|null} [opts.result] - Live runHeadless result (flags win over metadata.status)
 * @param {string|null} [opts.summary]
 * @param {string|null} [opts.modelInput] - What the caller typed (alias), if known
 * @param {string|null} [opts.sessionDir]
 * @param {string|null} [opts.waveId] - Explicit wave id (falls back to metadata.parentWave)
 * @returns {object} run document
 */
function buildRunResult({ taskId, metadata = {}, result = null, summary = null, modelInput = null, sessionDir = null, waveId = null }) {
  const status = result ? statusFromResult(result) : (metadata.status || 'unknown');
  const createdAt = metadata.createdAt || null;
  const completedAt = metadata.completedAt || metadata.abortedAt || null;
  const durationMs = (createdAt && completedAt)
    ? new Date(completedAt).getTime() - new Date(createdAt).getTime()
    : null;
  return {
    schemaVersion: SCHEMA_VERSION,
    type: 'run',
    taskId,
    waveId: waveId !== null ? waveId : (metadata.parentWave || null),
    model: metadata.model || null,
    modelInput: modelInput !== null ? modelInput : (metadata.modelInput || null),
    agent: metadata.agent || null,
    status,
    summary,
    error: status === 'complete' ? null : ((result && result.error) || metadata.reason || null),
    createdAt,
    completedAt,
    durationMs,
    sessionDir,
    opencodeSessionId: metadata.opencodeSessionId || null,
  };
}

/**
 * Aggregate wave status from leg documents.
 * all complete → 'complete'; ≥1 complete → 'partial';
 * 0 complete + ≥1 aborted → 'aborted'; else 'error'.
 * @param {Array<{status: string}>} legs
 * @returns {string}
 */
function waveStatusFromLegs(legs) {
  const complete = legs.filter(l => l.status === 'complete').length;
  if (complete === legs.length && legs.length > 0) { return 'complete'; }
  if (complete > 0) { return 'partial'; }
  if (legs.some(l => l.status === 'aborted')) { return 'aborted'; }
  return 'error';
}

/**
 * Map a wave status to a CLI exit code: complete=0, partial=2, error/aborted=1.
 * @param {string} waveStatus
 * @returns {number}
 */
function waveExitCode(waveStatus) {
  if (waveStatus === 'complete') { return 0; }
  if (waveStatus === 'partial') { return 2; }
  return 1;
}

/**
 * Build a wave document from leg run documents.
 * @param {object} opts
 * @param {string} opts.waveId
 * @param {Array<object>} opts.legs - run documents (in --models order)
 * @param {{source: string, file: string|null, chars: number}|null} [opts.promptMeta]
 * @param {string|null} [opts.createdAt]
 * @param {string|null} [opts.completedAt]
 * @param {string|null} [opts.status] - Override (e.g. 'aborted' on signal); default aggregates legs
 * @returns {object} wave document
 */
function buildWaveResult({ waveId, legs, promptMeta = null, createdAt = null, completedAt = null, status = null }) {
  const counts = {
    total: legs.length,
    complete: legs.filter(l => l.status === 'complete').length,
    error: legs.filter(l => l.status === 'error').length,
    timeout: legs.filter(l => l.status === 'timeout').length,
    aborted: legs.filter(l => l.status === 'aborted').length,
  };
  const durationMs = (createdAt && completedAt)
    ? new Date(completedAt).getTime() - new Date(createdAt).getTime()
    : null;
  return {
    schemaVersion: SCHEMA_VERSION,
    type: 'wave',
    waveId,
    status: status || waveStatusFromLegs(legs),
    counts,
    legs,
    prompt: promptMeta,
    createdAt,
    completedAt,
    durationMs,
  };
}

module.exports = {
  SCHEMA_VERSION,
  TERMINAL_STATUSES,
  statusFromResult,
  buildRunResult,
  buildWaveResult,
  waveStatusFromLegs,
  waveExitCode,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/utils/result-schema.test.js`
Expected: PASS (all)

- [ ] **Step 5: Commit**

```bash
git add src/utils/result-schema.js tests/utils/result-schema.test.js
git commit -m "feat(f4): versioned run/wave result schema with status + exit-code mapping"
```

---

### Task 2: Result schema — rebuild documents from session dirs

**Files:**
- Modify: `src/utils/result-schema.js` (append two functions + exports)
- Test: `tests/utils/result-schema.test.js` (append a describe block)

- [ ] **Step 1: Write the failing tests** (append to `tests/utils/result-schema.test.js`)

```js
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  buildRunResultFromSession,
  buildWaveResultFromSession,
} = require('../../src/utils/result-schema');

describe('result-schema session rebuilders', () => {
  let project;

  const writeSession = (taskId, meta, summary) => {
    const dir = path.join(project, '.claude', 'amicus_sessions', taskId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify({ taskId, ...meta }, null, 2));
    if (summary !== undefined) {
      fs.writeFileSync(path.join(dir, 'summary.md'), summary);
    }
    return dir;
  };

  beforeEach(() => {
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-schema-'));
  });

  afterEach(() => {
    fs.rmSync(project, { recursive: true, force: true });
  });

  it('rebuilds a run doc from metadata + summary.md', () => {
    writeSession('aaaa1111', {
      model: 'openrouter/x/y', agent: 'plan', status: 'complete',
      createdAt: '2026-06-09T10:00:00.000Z', completedAt: '2026-06-09T10:01:00.000Z',
    }, 'the summary');
    const doc = buildRunResultFromSession(project, 'aaaa1111');
    expect(doc.type).toBe('run');
    expect(doc.status).toBe('complete');
    expect(doc.summary).toBe('the summary');
    expect(doc.durationMs).toBe(60000);
  });

  it('returns null summary when summary.md is missing', () => {
    writeSession('bbbb2222', { status: 'running', createdAt: '2026-06-09T10:00:00.000Z' });
    const doc = buildRunResultFromSession(project, 'bbbb2222');
    expect(doc.status).toBe('running');
    expect(doc.summary).toBeNull();
  });

  it('throws for a missing session', () => {
    expect(() => buildRunResultFromSession(project, 'nope0000')).toThrow(/not found/);
  });

  it('wave: prefers stored wave.json when present', () => {
    const waveDir = writeSession('cafe0001', { type: 'wave', status: 'complete', legs: ['cafe0001-1'] });
    fs.writeFileSync(path.join(waveDir, 'wave.json'), JSON.stringify({ schemaVersion: 1, type: 'wave', waveId: 'cafe0001', status: 'complete', legs: [] }));
    const doc = buildWaveResultFromSession(project, 'cafe0001');
    expect(doc.waveId).toBe('cafe0001');
    expect(doc.status).toBe('complete');
  });

  it('wave: rebuilds live from leg sessions when wave.json is missing', () => {
    writeSession('cafe0002', {
      type: 'wave', status: 'running', legs: ['cafe0002-1', 'cafe0002-2'],
      createdAt: '2026-06-09T10:00:00.000Z',
      promptMeta: { source: 'inline', file: null, chars: 5 },
    });
    writeSession('cafe0002-1', { model: 'a/b', status: 'complete', parentWave: 'cafe0002', createdAt: '2026-06-09T10:00:01.000Z', completedAt: '2026-06-09T10:01:00.000Z' }, 'leg one');
    writeSession('cafe0002-2', { model: 'c/d', status: 'error', reason: 'boom', parentWave: 'cafe0002', createdAt: '2026-06-09T10:00:01.000Z' });
    const doc = buildWaveResultFromSession(project, 'cafe0002');
    expect(doc.status).toBe('partial');
    expect(doc.counts).toMatchObject({ total: 2, complete: 1, error: 1 });
    expect(doc.legs[0].summary).toBe('leg one');
    expect(doc.legs[1].error).toBe('boom');
    expect(doc.prompt).toEqual({ source: 'inline', file: null, chars: 5 });
  });
});
```

- [ ] **Step 2: Run to verify the new block fails**

Run: `npx jest tests/utils/result-schema.test.js`
Expected: FAIL — `buildRunResultFromSession is not a function`

- [ ] **Step 3: Implement** (append to `src/utils/result-schema.js`, before `module.exports`; add the new names to `module.exports`)

```js
/**
 * Rebuild a run document from a persisted session directory.
 * @param {string} project - Project dir
 * @param {string} taskId
 * @returns {object} run document
 * @throws {Error} if the session does not exist
 */
function buildRunResultFromSession(project, taskId) {
  const fs = require('fs');
  const path = require('path');
  const { resolveExistingSessionDir } = require('../session-manager');
  const sessionDir = resolveExistingSessionDir(project, taskId);
  const metaPath = path.join(sessionDir, 'metadata.json');
  if (!fs.existsSync(metaPath)) {
    throw new Error(`Session ${taskId} not found`);
  }
  const metadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  const summaryPath = path.join(sessionDir, 'summary.md');
  const summary = fs.existsSync(summaryPath) ? fs.readFileSync(summaryPath, 'utf-8') : null;
  return buildRunResult({ taskId, metadata, summary, sessionDir });
}

/**
 * Rebuild a wave document. Prefers the stored wave.json (written atomically at
 * fanout exit); falls back to a live rebuild from leg sessions (e.g. after a
 * hard kill of the fanout process).
 * @param {string} project
 * @param {string} waveId
 * @returns {object} wave document
 * @throws {Error} if the wave session does not exist
 */
function buildWaveResultFromSession(project, waveId) {
  const fs = require('fs');
  const path = require('path');
  const { resolveExistingSessionDir } = require('../session-manager');
  const waveDir = resolveExistingSessionDir(project, waveId);
  const wavePath = path.join(waveDir, 'wave.json');
  if (fs.existsSync(wavePath)) {
    return JSON.parse(fs.readFileSync(wavePath, 'utf-8'));
  }
  const metaPath = path.join(waveDir, 'metadata.json');
  if (!fs.existsSync(metaPath)) {
    throw new Error(`Wave ${waveId} not found`);
  }
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  const legs = (meta.legs || []).map((legId) => {
    try { return buildRunResultFromSession(project, legId); }
    catch { return buildRunResult({ taskId: legId, metadata: { status: 'unknown', parentWave: waveId } }); }
  });
  return buildWaveResult({
    waveId,
    legs,
    promptMeta: meta.promptMeta || null,
    createdAt: meta.createdAt || null,
    completedAt: meta.completedAt || null,
  });
}
```

And extend the exports object:

```js
module.exports = {
  SCHEMA_VERSION,
  TERMINAL_STATUSES,
  statusFromResult,
  buildRunResult,
  buildWaveResult,
  buildRunResultFromSession,
  buildWaveResultFromSession,
  waveStatusFromLegs,
  waveExitCode,
};
```

- [ ] **Step 4: Run tests**

Run: `npx jest tests/utils/result-schema.test.js`
Expected: PASS. Also check the file stays ≤300 lines: `(Get-Content src/utils/result-schema.js | Measure-Object -Line).Lines` → must be ≤ 300.

- [ ] **Step 5: Commit**

```bash
git add src/utils/result-schema.js tests/utils/result-schema.test.js
git commit -m "feat(f4): rebuild run/wave JSON documents from persisted sessions"
```

---

### Task 3: Prompt source module (`--prompt` XOR `--prompt-file`)

**Files:**
- Create: `src/utils/prompt-source.js`
- Test: `tests/utils/prompt-source.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// tests/utils/prompt-source.test.js
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolvePromptSource } = require('../../src/utils/prompt-source');

describe('resolvePromptSource', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-prompt-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('errors when both --prompt and --prompt-file are given', () => {
    const r = resolvePromptSource({ prompt: 'x', 'prompt-file': 'y.md' });
    expect(r.error).toMatch(/mutually exclusive/);
  });

  it('errors when neither is given', () => {
    const r = resolvePromptSource({});
    expect(r.error).toMatch(/--prompt or --prompt-file is required/);
  });

  it('errors when --prompt is a bare flag with no value', () => {
    const r = resolvePromptSource({ prompt: true });
    expect(r.error).toMatch(/requires a value/);
  });

  it('returns inline prompt with metadata', () => {
    const r = resolvePromptSource({ prompt: 'hello world' });
    expect(r.prompt).toBe('hello world');
    expect(r.promptMeta).toEqual({ source: 'inline', file: null, chars: 11 });
  });

  it('reads a prompt file, strips a UTF-8 BOM, resolves the path', () => {
    const f = path.join(tmp, 'briefing.md');
    fs.writeFileSync(f, '﻿briefing text');
    const r = resolvePromptSource({ 'prompt-file': f });
    expect(r.prompt).toBe('briefing text');
    expect(r.promptMeta.source).toBe('file');
    expect(r.promptMeta.file).toBe(path.resolve(f));
    expect(r.promptMeta.chars).toBe(13);
  });

  it('handles files larger than the 32KB Windows arg cap', () => {
    const f = path.join(tmp, 'big.md');
    fs.writeFileSync(f, 'y'.repeat(40000));
    const r = resolvePromptSource({ 'prompt-file': f });
    expect(r.prompt.length).toBe(40000);
  });

  it('errors on a missing file', () => {
    const r = resolvePromptSource({ 'prompt-file': path.join(tmp, 'nope.md') });
    expect(r.error).toMatch(/cannot read --prompt-file/);
  });

  it('errors on an empty/whitespace-only file', () => {
    const f = path.join(tmp, 'empty.md');
    fs.writeFileSync(f, '   \n');
    const r = resolvePromptSource({ 'prompt-file': f });
    expect(r.error).toMatch(/empty/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/utils/prompt-source.test.js`
Expected: FAIL — `Cannot find module '../../src/utils/prompt-source'`

- [ ] **Step 3: Implement**

```js
// src/utils/prompt-source.js
'use strict';

/**
 * @module prompt-source
 * Resolve the prompt for start/fanout from --prompt XOR --prompt-file (F4).
 * --prompt-file exists because Windows caps a CLI argument at ~32 KB, which
 * forced fragile `--prompt "$(cat briefing)"` launches.
 */

const fs = require('fs');
const path = require('path');

/**
 * @param {object} args - Parsed CLI args (kebab-case keys, as from parseArgs)
 * @returns {{prompt: string, promptMeta: {source: 'inline'|'file', file: string|null, chars: number}} | {error: string}}
 */
function resolvePromptSource(args) {
  const inline = args.prompt;
  const file = args['prompt-file'];

  if (inline !== undefined && file !== undefined) {
    return { error: 'Error: --prompt and --prompt-file are mutually exclusive' };
  }
  if (inline === undefined && file === undefined) {
    return { error: 'Error: --prompt or --prompt-file is required' };
  }
  if (inline === true || file === true) {
    return { error: 'Error: --prompt/--prompt-file requires a value' };
  }

  if (file !== undefined) {
    let text;
    try {
      text = fs.readFileSync(file, 'utf-8');
    } catch (err) {
      return { error: `Error: cannot read --prompt-file ${file}: ${err.message}` };
    }
    if (text.charCodeAt(0) === 0xFEFF) { text = text.slice(1); }
    if (!text.trim()) {
      return { error: `Error: --prompt-file ${file} is empty` };
    }
    return {
      prompt: text,
      promptMeta: { source: 'file', file: path.resolve(file), chars: text.length },
    };
  }

  return {
    prompt: String(inline),
    promptMeta: { source: 'inline', file: null, chars: String(inline).length },
  };
}

module.exports = { resolvePromptSource };
```

- [ ] **Step 4: Run tests**

Run: `npx jest tests/utils/prompt-source.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/prompt-source.js tests/utils/prompt-source.test.js
git commit -m "feat(f4): prompt-source module - --prompt XOR --prompt-file with BOM strip"
```

---

### Task 4: Headless consecutive-poll-failure fast-exit

**Files:**
- Modify: `src/headless.js` (poll loop, ~lines 296-552)
- Test: `tests/headless-poll-failures.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/headless-poll-failures.test.js
'use strict';

const mockCreateSession = jest.fn();
const mockSendPromptAsync = jest.fn();
const mockGetMessages = jest.fn();
const mockCheckHealth = jest.fn();
const mockStartServer = jest.fn();
const mockServerClose = jest.fn();
const mockAbortSession = jest.fn();
const mockGetSessionStatus = jest.fn();

jest.mock('../src/opencode-client', () => ({
  createSession: mockCreateSession,
  sendPromptAsync: mockSendPromptAsync,
  getMessages: mockGetMessages,
  checkHealth: mockCheckHealth,
  startServer: mockStartServer,
  abortSession: mockAbortSession,
  getSessionStatus: mockGetSessionStatus,
}));

jest.mock('fs', () => ({
  existsSync: jest.fn(() => true),
  mkdirSync: jest.fn(),
  appendFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  readFileSync: jest.fn(() => JSON.stringify({ status: 'running' })),
  unlinkSync: jest.fn(),
}));

jest.mock('../src/utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const { runHeadless } = require('../src/headless');

describe('consecutive poll-failure fast-exit (F4)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckHealth.mockResolvedValue(true);
    mockCreateSession.mockResolvedValue('session-1');
    mockSendPromptAsync.mockResolvedValue(undefined);
    mockGetSessionStatus.mockResolvedValue({ type: 'busy' });
    mockStartServer.mockResolvedValue({
      client: {},
      server: { url: 'http://127.0.0.1:1', close: mockServerClose },
    });
  });

  it('bails with an error after K consecutive getMessages failures (dead server)', async () => {
    mockGetMessages.mockRejectedValue(new Error('ECONNREFUSED'));
    const started = Date.now();
    const result = await runHeadless(
      'openrouter/a/b', 'sys', 'user', 'task1234', '/proj',
      60000, 'build',
      { pollIntervalMs: 5, maxConsecutivePollFailures: 3 }
    );
    expect(Date.now() - started).toBeLessThan(10000); // far less than the 60s timeout
    expect(result.completed).toBe(false);
    expect(result.error).toMatch(/3 consecutive/);
  });

  it('resets the failure counter on a successful poll', async () => {
    // 2 failures, then success-with-marker → must complete despite K=3
    mockGetMessages
      .mockRejectedValueOnce(new Error('blip'))
      .mockRejectedValueOnce(new Error('blip'))
      .mockResolvedValue([{
        info: { role: 'assistant', id: 'm1', time: { completed: Date.now() } },
        parts: [{ type: 'text', text: 'done\n[SIDECAR_FOLD]\n' }],
      }]);
    const result = await runHeadless(
      'openrouter/a/b', 'sys', 'user', 'task1234', '/proj',
      60000, 'build',
      { pollIntervalMs: 5, maxConsecutivePollFailures: 3 }
    );
    expect(result.completed).toBe(true);
    expect(result.error).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/headless-poll-failures.test.js`
Expected: FAIL — first test times out at 60s budget or `result.error` undefined (no fast-exit exists yet)

- [ ] **Step 3: Implement in `src/headless.js`**

3a. Next to the other poll constants (after `POLL_CALL_TIMEOUT_MS`, ~line 32), add:

```js
const MAX_CONSECUTIVE_POLL_FAILURES = Number(process.env.AMICUS_MAX_CONSECUTIVE_POLL_FAILURES) || 15; // ≈30s at 2s polls
```

3b. In `runHeadless`, next to the other injectable knobs (after `const pollCallTimeoutMs = options.pollCallTimeoutMs || POLL_CALL_TIMEOUT_MS;`), add:

```js
    const maxConsecutivePollFailures = options.maxConsecutivePollFailures || MAX_CONSECUTIVE_POLL_FAILURES;
    let consecutivePollFailures = 0;
```

3c. Immediately after the successful `getMessages` call inside the try block — i.e. right after:

```js
        const messages = await withTimeout(
          getMessages(client, sessionId),
          Math.min(pollCallTimeoutMs, remaining),
          'getMessages'
        );
```

add:

```js
        consecutivePollFailures = 0;
```

3d. Replace the existing poll-error catch:

```js
      } catch (pollError) {
        logger.debug('Polling error', { error: pollError.message });
        // Continue polling despite errors
      }
```

with:

```js
      } catch (pollError) {
        consecutivePollFailures++;
        logger.debug('Polling error', {
          error: pollError.message, consecutivePollFailures
        });
        if (consecutivePollFailures >= maxConsecutivePollFailures) {
          // F4: a dead server otherwise burns the full timeout in futile polls.
          sessionError = sessionError
            || `Polling failed ${consecutivePollFailures} consecutive times: ${pollError.message}`;
          logger.error('Exiting poll loop after consecutive failures', {
            consecutivePollFailures, taskId
          });
          break;
        }
      }
```

3e. The existing tail already propagates `sessionError && !output` as an error result, so no further change. Export the new constant by adding `MAX_CONSECUTIVE_POLL_FAILURES,` to the `module.exports` object at the bottom.

- [ ] **Step 4: Run the new test, then the full suite**

Run: `npx jest tests/headless-poll-failures.test.js` → PASS
Run: `npm test` → 0 failed (existing headless tests must not regress; they mock `getMessages` as resolving, so the counter stays 0)

- [ ] **Step 5: Commit**

```bash
git add src/headless.js tests/headless-poll-failures.test.js
git commit -m "feat(f4): bail headless poll loop after K consecutive poll failures"
```

---

### Task 5: Human (non-JSON) wave output formatter

**Files:**
- Create: `src/sidecar/fanout-output.js`
- Test: `tests/sidecar/fanout-output.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// tests/sidecar/fanout-output.test.js
'use strict';

const { formatWaveHuman } = require('../../src/sidecar/fanout-output');

describe('formatWaveHuman', () => {
  const wave = {
    waveId: 'deadbeef',
    status: 'partial',
    counts: { total: 2, complete: 1, error: 0, timeout: 1, aborted: 0 },
    durationMs: 65000,
    legs: [
      { taskId: 'deadbeef-1', modelInput: 'gemini', model: 'openrouter/google/gemini-3.5', status: 'complete', durationMs: 60000, summary: 'Gemini summary text', error: null },
      { taskId: 'deadbeef-2', modelInput: 'gpt', model: 'openrouter/openai/gpt-6', status: 'timeout', durationMs: 65000, summary: null, error: null },
    ],
  };

  it('renders one section per leg in order, plus a status footer', () => {
    const out = formatWaveHuman(wave);
    const gemIdx = out.indexOf('gemini');
    const gptIdx = out.indexOf('gpt');
    expect(gemIdx).toBeGreaterThan(-1);
    expect(gptIdx).toBeGreaterThan(gemIdx);
    expect(out).toContain('Gemini summary text');
    expect(out).toContain('deadbeef');
    expect(out).toContain('partial');
    expect(out).toContain('timeout');
  });

  it('shows a placeholder for legs without a summary', () => {
    const out = formatWaveHuman(wave);
    expect(out).toContain('(no output)');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/sidecar/fanout-output.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```js
// src/sidecar/fanout-output.js
'use strict';

/**
 * @module fanout-output
 * Human-readable rendering of a wave document (the non-JSON default for
 * `amicus fanout` stdout and `amicus read <waveId>`).
 */

/** Format ms as "1m5s" / "42s". */
function fmtDuration(ms) {
  if (ms === null || ms === undefined) { return '-'; }
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m${s % 60}s` : `${s}s`;
}

/**
 * Render a wave document for humans: per-leg sections in order, then a footer.
 * @param {object} wave - Wave document (result-schema shape)
 * @returns {string}
 */
function formatWaveHuman(wave) {
  const lines = [];
  for (const leg of wave.legs) {
    const label = leg.modelInput || leg.model || leg.taskId;
    lines.push(`${'─'.repeat(8)} ${label} (${leg.taskId}) ${'─'.repeat(8)}`);
    if (leg.summary) {
      lines.push(leg.summary.trim());
    } else {
      lines.push(`(no output) [${leg.status}${leg.error ? `: ${leg.error}` : ''}]`);
    }
    lines.push('');
  }
  lines.push('─'.repeat(40));
  lines.push(`Wave ${wave.waveId}: ${wave.status} — ${wave.counts.complete}/${wave.counts.total} complete in ${fmtDuration(wave.durationMs)}`);
  for (const leg of wave.legs) {
    const label = leg.modelInput || leg.model || leg.taskId;
    lines.push(`  ${leg.taskId}  ${String(label).padEnd(12)} ${String(leg.status).padEnd(9)} ${fmtDuration(leg.durationMs)}`);
  }
  return lines.join('\n');
}

module.exports = { formatWaveHuman, fmtDuration };
```

- [ ] **Step 4: Run tests**

Run: `npx jest tests/sidecar/fanout-output.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/sidecar/fanout-output.js tests/sidecar/fanout-output.test.js
git commit -m "feat(f4): human wave output formatter"
```

---

### Task 6: Fan-out model-list validation + leg-ID derivation

**Files:**
- Create: `src/sidecar/fanout.js` (validation half)
- Test: `tests/sidecar/fanout.test.js` (validation describe block)

- [ ] **Step 1: Write the failing tests**

```js
// tests/sidecar/fanout.test.js
'use strict';

const mockValidateAgainstCatalog = jest.fn(async (m) => m);
jest.mock('../../src/utils/model-validator', () => ({
  validateAgainstCatalog: mockValidateAgainstCatalog,
}));

const mockValidateApiKey = jest.fn(() => ({ valid: true }));
jest.mock('../../src/utils/validators', () => {
  const actual = jest.requireActual('../../src/utils/validators');
  return { ...actual, validateApiKey: mockValidateApiKey };
});

jest.mock('../../src/utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const { parseModelsList, deriveLegIds, validateFanoutModels } = require('../../src/sidecar/fanout');

describe('fanout validation helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.AMICUS_FANOUT_MAX_LEGS;
  });

  describe('parseModelsList', () => {
    it('splits, trims, drops empties', () => {
      expect(parseModelsList(' a/b, c/d ,,e/f ')).toEqual(['a/b', 'c/d', 'e/f']);
    });
    it('allows duplicates (distinct legs)', () => {
      expect(parseModelsList('a/b,a/b')).toEqual(['a/b', 'a/b']);
    });
    it('returns [] for empty/boolean input', () => {
      expect(parseModelsList('')).toEqual([]);
      expect(parseModelsList(true)).toEqual([]);
      expect(parseModelsList(undefined)).toEqual([]);
    });
  });

  describe('deriveLegIds', () => {
    it('derives <waveId>-1..N in order', () => {
      expect(deriveLegIds('deadbeef', 3)).toEqual(['deadbeef-1', 'deadbeef-2', 'deadbeef-3']);
    });
    it('derived ids satisfy the task-id pattern', () => {
      const { TASK_ID_PATTERN } = jest.requireActual('../../src/utils/validators');
      for (const id of deriveLegIds('a1b2c3d4', 10)) {
        expect(TASK_ID_PATTERN.test(id)).toBe(true);
      }
    });
  });

  describe('validateFanoutModels', () => {
    it('errors on an empty list', async () => {
      const r = await validateFanoutModels('');
      expect(r.error).toMatch(/--models requires/);
    });

    it('enforces the leg cap (default 10, env-overridable)', async () => {
      const eleven = Array.from({ length: 11 }, (_, i) => `p/m${i}`).join(',');
      const r = await validateFanoutModels(eleven);
      expect(r.error).toMatch(/cap of 10/);

      process.env.AMICUS_FANOUT_MAX_LEGS = '12';
      const r2 = await validateFanoutModels(eleven);
      expect(r2.legs).toHaveLength(11);
    });

    it('resolves every model and keeps the original input alongside', async () => {
      const r = await validateFanoutModels('openrouter/a/b,c/d');
      expect(r.legs).toEqual([
        { modelInput: 'openrouter/a/b', model: 'openrouter/a/b' },
        { modelInput: 'c/d', model: 'c/d' },
      ]);
      expect(mockValidateAgainstCatalog).toHaveBeenCalledTimes(2);
    });

    it('fails fast on a missing API key', async () => {
      mockValidateApiKey.mockReturnValueOnce({ valid: false, error: 'Error: no key for provider a' });
      const r = await validateFanoutModels('a/b,c/d');
      expect(r.error).toMatch(/no key/);
    });

    it('fails fast on catalog rejection unless noValidateModel', async () => {
      mockValidateAgainstCatalog.mockRejectedValueOnce(new Error('Model not in catalog: a/zzz'));
      const r = await validateFanoutModels('a/zzz');
      expect(r.error).toMatch(/not in catalog/);

      const r2 = await validateFanoutModels('a/zzz', { noValidateModel: true });
      expect(r2.legs).toHaveLength(1);
    });

    it('fails fast on an unresolvable alias', async () => {
      // 'nosuchalias' has no slash → resolveModel throws (no such alias in config)
      const r = await validateFanoutModels('nosuchalias-xyz-f4');
      expect(r.error).toBeDefined();
    });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/sidecar/fanout.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the validation half of `src/sidecar/fanout.js`**

```js
// src/sidecar/fanout.js
'use strict';

/**
 * @module fanout
 * F4 council-native fan-out: run N models on the same prompt concurrently on
 * ONE shared OpenCode server (runHeadless external-server mode). Each leg is
 * an ordinary session (parentWave metadata); results aggregate into a wave
 * document persisted as wave.json in the wave session dir.
 * Spec: docs/superpowers/specs/2026-06-09-f4-fanout-json-design.md
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('../utils/logger');

/** Default max legs per wave (env-overridable). */
const DEFAULT_MAX_LEGS = 10;

/**
 * Split a --models value into trimmed, non-empty entries (duplicates allowed).
 * @param {string|boolean|undefined} modelsArg
 * @returns {string[]}
 */
function parseModelsList(modelsArg) {
  if (typeof modelsArg !== 'string') { return []; }
  return modelsArg.split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * Derive leg task IDs: <waveId>-1 .. <waveId>-N (matches TASK_ID_PATTERN).
 * @param {string} waveId
 * @param {number} count
 * @returns {string[]}
 */
function deriveLegIds(waveId, count) {
  return Array.from({ length: count }, (_, i) => `${waveId}-${i + 1}`);
}

/**
 * Fail-fast validation of the whole model list BEFORE any leg launches:
 * alias resolution, API-key presence, live-catalog validation (F3 machinery).
 * @param {string} modelsArg - Raw --models value
 * @param {{noValidateModel?: boolean}} [opts]
 * @returns {Promise<{legs: Array<{modelInput: string, model: string}>} | {error: string}>}
 */
async function validateFanoutModels(modelsArg, opts = {}) {
  const raw = parseModelsList(modelsArg);
  if (raw.length === 0) {
    return { error: 'Error: --models requires a comma-separated list (e.g. gemini,gpt,deepseek)' };
  }
  const maxLegs = Number(process.env.AMICUS_FANOUT_MAX_LEGS) || DEFAULT_MAX_LEGS;
  if (raw.length > maxLegs) {
    return { error: `Error: --models exceeds the fan-out cap of ${maxLegs} legs (set AMICUS_FANOUT_MAX_LEGS to raise)` };
  }

  const { tryResolveModel } = require('../utils/config');
  const { validateApiKey } = require('../utils/validators');
  const legs = [];
  for (const modelInput of raw) {
    const resolved = tryResolveModel(modelInput);
    if (resolved.error) {
      return { error: `Error: model '${modelInput}': ${resolved.error}` };
    }
    let model = resolved.model;
    const keyCheck = validateApiKey(model);
    if (!keyCheck.valid) {
      return { error: keyCheck.error };
    }
    if (!opts.noValidateModel) {
      const { validateAgainstCatalog } = require('../utils/model-validator');
      const alias = modelInput.includes('/') ? undefined : modelInput;
      try {
        model = await validateAgainstCatalog(model, alias);
      } catch (err) {
        return { error: err.message };
      }
    }
    legs.push({ modelInput, model });
  }
  return { legs };
}

module.exports = { parseModelsList, deriveLegIds, validateFanoutModels, DEFAULT_MAX_LEGS };
```

- [ ] **Step 4: Run tests**

Run: `npx jest tests/sidecar/fanout.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/sidecar/fanout.js tests/sidecar/fanout.test.js
git commit -m "feat(f4): fanout model-list validation and leg-id derivation"
```

---

### Task 7: Fan-out orchestrator (`runFanout`)

**Files:**
- Modify: `src/sidecar/fanout.js` (orchestrator half — append; keep TOTAL ≤300 lines, this file is size-checked)
- Test: `tests/sidecar/fanout.test.js` (orchestrator describe block)

- [ ] **Step 1: Write the failing tests** (append to `tests/sidecar/fanout.test.js`; extend the mock section at the TOP of the file with the additional mocks shown here — jest.mock calls are hoisted, so they all live together at the top)

```js
// --- additional mocks (place at top of file with the others) ---
const mockRunHeadless = jest.fn();
jest.mock('../../src/headless', () => {
  const actual = jest.requireActual('../../src/headless');
  return { ...actual, runHeadless: mockRunHeadless };
});

const mockServerClose = jest.fn();
const mockStartOpenCodeServer = jest.fn();
jest.mock('../../src/sidecar/session-utils', () => {
  const actual = jest.requireActual('../../src/sidecar/session-utils');
  return { ...actual, startOpenCodeServer: mockStartOpenCodeServer };
});

const mockBuildContext = jest.fn(() => 'CTX');
jest.mock('../../src/sidecar/context-builder', () => ({
  buildContext: mockBuildContext,
  parseDuration: jest.fn(),
}));
// --- end additional mocks ---

const fsReal = require('fs');
const os = require('os');
const pathReal = require('path');
const { runFanout } = require('../../src/sidecar/fanout');

describe('runFanout orchestrator', () => {
  let project;

  const legOk = (taskId) => ({
    summary: `summary ${taskId}`, completed: true, timedOut: false, aborted: false, taskId, toolCalls: [],
  });

  beforeEach(() => {
    jest.clearAllMocks();
    project = fsReal.mkdtempSync(pathReal.join(os.tmpdir(), 'amicus-fanout-'));
    mockStartOpenCodeServer.mockResolvedValue({
      client: { tag: 'client' },
      server: { url: 'http://127.0.0.1:1', close: mockServerClose, goPid: 4242 },
    });
    mockRunHeadless.mockImplementation(async (_m, _s, _u, taskId) => legOk(taskId));
  });

  afterEach(() => {
    fsReal.rmSync(project, { recursive: true, force: true });
  });

  const baseOpts = () => ({
    models: 'openrouter/a/b,openrouter/c/d',
    prompt: 'do the thing',
    promptMeta: { source: 'inline', file: null, chars: 12 },
    project,
    includeContext: false,
    noValidateModel: true,
    json: true,
    quiet: true, // suppress stdout in tests
  });

  it('starts ONE server, runs N legs with the shared client/server, returns a complete wave', async () => {
    const { wave, exitCode } = await runFanout(baseOpts());

    expect(mockStartOpenCodeServer).toHaveBeenCalledTimes(1);
    expect(mockRunHeadless).toHaveBeenCalledTimes(2);
    for (const call of mockRunHeadless.mock.calls) {
      const options = call[7];
      expect(options.client).toEqual({ tag: 'client' });
      expect(options.server.url).toBe('http://127.0.0.1:1');
      expect(options.watchdog).toBeDefined(); // injected per-leg watchdog
    }
    expect(mockServerClose).toHaveBeenCalledTimes(1);
    expect(wave.status).toBe('complete');
    expect(wave.counts).toMatchObject({ total: 2, complete: 2 });
    expect(exitCode).toBe(0);
  });

  it('derives leg ids from the wave id and persists legs as ordinary sessions with parentWave', async () => {
    const { wave } = await runFanout({ ...baseOpts(), waveId: 'cafe1234' });
    expect(wave.waveId).toBe('cafe1234');
    expect(wave.legs.map(l => l.taskId)).toEqual(['cafe1234-1', 'cafe1234-2']);

    const legMeta = JSON.parse(fsReal.readFileSync(
      pathReal.join(project, '.claude', 'amicus_sessions', 'cafe1234-1', 'metadata.json'), 'utf-8'));
    expect(legMeta.parentWave).toBe('cafe1234');
    expect(legMeta.status).toBe('complete');
    const legSummary = fsReal.readFileSync(
      pathReal.join(project, '.claude', 'amicus_sessions', 'cafe1234-1', 'summary.md'), 'utf-8');
    expect(legSummary).toBe('summary cafe1234-1');
  });

  it('one leg failing yields partial results, sibling summaries intact, exit 2', async () => {
    mockRunHeadless
      .mockImplementationOnce(async (_m, _s, _u, taskId) => legOk(taskId))
      .mockImplementationOnce(async (_m, _s, _u, taskId) => ({
        summary: '', completed: false, timedOut: true, aborted: false, taskId, toolCalls: [],
      }));
    const { wave, exitCode } = await runFanout(baseOpts());
    expect(wave.status).toBe('partial');
    expect(exitCode).toBe(2);
    expect(wave.legs[0].status).toBe('complete');
    expect(wave.legs[1].status).toBe('timeout');
    expect(wave.legs[0].summary).toMatch(/^summary /);
  });

  it('a leg that REJECTS becomes an error leg, never sinks siblings', async () => {
    mockRunHeadless
      .mockImplementationOnce(async () => { throw new Error('kaboom'); })
      .mockImplementationOnce(async (_m, _s, _u, taskId) => legOk(taskId));
    const { wave, exitCode } = await runFanout(baseOpts());
    expect(wave.legs[0].status).toBe('error');
    expect(wave.legs[0].error).toMatch(/kaboom/);
    expect(wave.legs[1].status).toBe('complete');
    expect(exitCode).toBe(2);
  });

  it('builds context ONCE and reuses it across legs', async () => {
    await runFanout({ ...baseOpts(), includeContext: true });
    expect(mockBuildContext).toHaveBeenCalledTimes(1);
  });

  it('writes wave.json and finalizes wave metadata', async () => {
    const { wave } = await runFanout({ ...baseOpts(), waveId: 'cafe9999' });
    const waveDir = pathReal.join(project, '.claude', 'amicus_sessions', 'cafe9999');
    const stored = JSON.parse(fsReal.readFileSync(pathReal.join(waveDir, 'wave.json'), 'utf-8'));
    expect(stored.waveId).toBe('cafe9999');
    expect(stored.status).toBe(wave.status);
    const meta = JSON.parse(fsReal.readFileSync(pathReal.join(waveDir, 'metadata.json'), 'utf-8'));
    expect(meta.type).toBe('wave');
    expect(meta.status).toBe('complete');
    expect(fsReal.readFileSync(pathReal.join(waveDir, 'briefing.md'), 'utf-8')).toBe('do the thing');
  });

  it('json mode (non-quiet): stdout carries EXACTLY one parseable JSON document', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await runFanout({ ...baseOpts(), quiet: false });
      expect(logSpy).toHaveBeenCalledTimes(1);
      const doc = JSON.parse(logSpy.mock.calls[0][0]); // whole-output parse must succeed
      expect(doc.type).toBe('wave');
      expect(doc.schemaVersion).toBe(1);
    } finally {
      logSpy.mockRestore();
    }
  });

  it('server start failure → error wave, exit 1, no legs launched', async () => {
    mockStartOpenCodeServer.mockRejectedValueOnce(new Error('no server'));
    const { wave, exitCode } = await runFanout(baseOpts());
    expect(exitCode).toBe(1);
    expect(wave.status).toBe('error');
    expect(mockRunHeadless).not.toHaveBeenCalled();
  });

  it('per-leg watchdog timeout marks ONLY that leg aborted (no process.exit, no server.close)', async () => {
    let capturedWatchdog;
    mockRunHeadless.mockImplementationOnce(async (_m, _s, _u, taskId, _p, _t, _a, options) => {
      capturedWatchdog = options.watchdog;
      options.watchdog.onTimeout(); // simulate idle-timeout firing mid-run
      return { summary: '', completed: false, timedOut: false, aborted: true, taskId, toolCalls: [] };
    }).mockImplementationOnce(async (_m, _s, _u, taskId) => legOk(taskId));

    const { wave } = await runFanout({ ...baseOpts(), waveId: 'cafe7777' });
    expect(capturedWatchdog).toBeDefined();
    // sibling unaffected, server closed exactly once at the END
    expect(wave.legs[1].status).toBe('complete');
    expect(mockServerClose).toHaveBeenCalledTimes(1);
    const legMeta = JSON.parse(fsReal.readFileSync(
      pathReal.join(project, '.claude', 'amicus_sessions', 'cafe7777-1', 'metadata.json'), 'utf-8'));
    expect(legMeta.status).toBe('aborted');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/sidecar/fanout.test.js`
Expected: FAIL — `runFanout is not a function`

- [ ] **Step 3: Implement the orchestrator** (append to `src/sidecar/fanout.js`; replace the `module.exports` line)

```js
/** Map a runHeadless result to a leg metadata status. */
function legStatusFromResult(result) {
  const { statusFromResult } = require('../utils/result-schema');
  return statusFromResult(result);
}

/** Write/merge wave metadata (preserves fields an MCP pre-spawn handler wrote). */
function writeWaveMetadata(waveDir, patch) {
  const metaPath = path.join(waveDir, 'metadata.json');
  let existing = {};
  if (fs.existsSync(metaPath)) {
    try { existing = JSON.parse(fs.readFileSync(metaPath, 'utf-8')); } catch { /* corrupt → rewrite */ }
  }
  const merged = { ...existing, ...patch };
  fs.writeFileSync(metaPath, JSON.stringify(merged, null, 2), { mode: 0o600 });
  return merged;
}

/**
 * Run one leg end-to-end: session record → runHeadless (shared server) →
 * leg finalize. Never throws — always resolves to a run document.
 */
async function runLeg({ leg, legId, waveId, project, systemPrompt, userMessage, timeoutMs, agent, client, server, summaryLength, reasoning, quiet }) {
  const { IdleWatchdog } = require('../utils/idle-watchdog');
  const { markAborted } = require('../utils/session-abort');
  const { runHeadless } = require('../headless');
  const { SessionPaths, saveInitialContext } = require('./session-utils');
  const { buildRunResult } = require('../utils/result-schema');
  const { createSessionMetadata } = require('./start');

  const legDir = createSessionMetadata(legId, project, {
    model: leg.model, prompt: userMessage, noUi: true, agent: agent || 'build',
  });
  writeLegPatch(legDir, { parentWave: waveId, modelInput: leg.modelInput });
  saveInitialContext(legDir, systemPrompt, userMessage);

  // Per-leg watchdog: timeout aborts ONLY this leg (file-marker → the leg's
  // own poll loop exits). NEVER server.close()/process.exit() — shared server.
  const watchdog = new IdleWatchdog({
    mode: 'headless',
    onTimeout: () => {
      logger.warn('Leg idle-timeout — aborting leg', { legId });
      markAborted(legDir, 'leg idle-timeout');
    },
  }).start();

  let result;
  try {
    result = await runHeadless(
      leg.model, systemPrompt, userMessage, legId, project,
      timeoutMs, agent || 'build',
      { client, server, watchdog, summaryLength, reasoning }
    );
  } catch (err) {
    result = { summary: '', completed: false, timedOut: false, aborted: false, error: err.message, taskId: legId };
  } finally {
    watchdog.cancel();
  }

  const status = legStatusFromResult(result);
  const summary = result.summary || null;
  if (summary) {
    fs.writeFileSync(SessionPaths.summaryFile(legDir), summary, { mode: 0o600 });
  }
  const finalMeta = writeLegPatch(legDir, {
    status,
    reason: result.error || undefined,
    completedAt: new Date().toISOString(),
  });
  if (!quiet) {
    process.stderr.write(`[fanout] leg ${legId} (${leg.modelInput}): ${status}\n`);
  }
  return buildRunResult({
    taskId: legId, metadata: finalMeta, result, summary,
    modelInput: leg.modelInput, sessionDir: legDir, waveId,
  });
}

/** Read-merge-write a leg's metadata.json. Returns the merged object. */
function writeLegPatch(legDir, patch) {
  const metaPath = path.join(legDir, 'metadata.json');
  let meta = {};
  try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')); } catch { /* fresh */ }
  const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  const merged = { ...meta, ...defined };
  fs.writeFileSync(metaPath, JSON.stringify(merged, null, 2), { mode: 0o600 });
  return merged;
}

/**
 * Run a fan-out wave. Spec §4.3.
 * @param {object} options - models, prompt, promptMeta, waveId?, project, agent?,
 *   thinking?, timeout? (minutes), summaryLength?, includeContext?, sessionId?,
 *   contextTurns?, contextSince?, contextMaxTokens?, mcp?, mcpConfig?, noMcp?,
 *   excludeMcp?, noValidateModel?, json?, client?, quiet? (suppress stdout — tests)
 * @returns {Promise<{wave: object, exitCode: number}>} Never rejects for leg errors.
 */
async function runFanout(options) {
  const { buildWaveResult, waveExitCode } = require('../utils/result-schema');
  const { generateTaskId, buildMcpConfig } = require('./start');
  const { startOpenCodeServer, createHeartbeat, HEARTBEAT_INTERVAL } = require('./session-utils');
  const { buildContext } = require('./context-builder');
  const { buildPrompts } = require('../prompt-builder');
  const { installSignalAbort, markAborted } = require('../utils/session-abort');
  const { getSessionDir } = require('../session-manager');

  const project = options.project || process.cwd();
  const createdAt = new Date().toISOString();
  const emit = (doc) => {
    if (options.quiet) { return; }
    if (options.json) {
      console.log(JSON.stringify(doc, null, 2));
    } else {
      const { formatWaveHuman } = require('./fanout-output');
      console.log(formatWaveHuman(doc));
    }
  };
  const errorWave = (waveId, message) => {
    const doc = buildWaveResult({ waveId: waveId || null, legs: [], promptMeta: options.promptMeta || null, createdAt, completedAt: new Date().toISOString(), status: 'error' });
    doc.error = message;
    emit(doc);
    return { wave: doc, exitCode: 1 };
  };

  // 1. Fail-fast validation
  const validated = await validateFanoutModels(options.models, { noValidateModel: options.noValidateModel });
  if (validated.error) { return errorWave(options.waveId, validated.error); }
  const legs = validated.legs;

  // 2. Wave record
  const waveId = options.waveId || generateTaskId();
  const legIds = deriveLegIds(waveId, legs.length);
  const waveDir = getSessionDir(project, waveId);
  fs.mkdirSync(waveDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(waveDir, 'briefing.md'), options.prompt, { mode: 0o600 });
  writeWaveMetadata(waveDir, {
    taskId: waveId, type: 'wave', status: 'running', mode: 'headless',
    models: legs.map(l => l.model), legs: legIds,
    briefing: String(options.prompt).slice(0, 200),
    promptMeta: options.promptMeta || null,
    pid: process.pid, project, createdAt,
  });

  // 3. Context + prompts built ONCE (model-independent)
  const context = options.includeContext !== false
    ? buildContext(project, options.sessionId || 'current', {
        contextTurns: options.contextTurns, contextSince: options.contextSince,
        contextMaxTokens: options.contextMaxTokens, client: options.client,
      })
    : '[Context excluded by caller - briefing is self-contained]';
  const { system: systemPrompt, userMessage } = buildPrompts(
    options.prompt, context, project, true, options.agent || 'build', options.summaryLength, options.client
  );

  // 4. One shared OpenCode server
  const mcpServers = buildMcpConfig({
    mcp: options.mcp, mcpConfig: options.mcpConfig, clientType: options.client,
    noMcp: options.noMcp, excludeMcp: options.excludeMcp,
  });
  let client, server;
  try {
    ({ client, server } = await startOpenCodeServer(mcpServers));
  } catch (err) {
    writeWaveMetadata(waveDir, { status: 'error', reason: err.message, completedAt: new Date().toISOString() });
    return errorWave(waveId, `Failed to start server: ${err.message}`);
  }
  if (server.goPid) { writeWaveMetadata(waveDir, { goPid: server.goPid }); }

  // 5. Signal abort: mark wave + all legs, close server, exit 130/143
  const legDirs = legIds.map(id => getSessionDir(project, id));
  let signalled = false;
  const uninstallSignals = installSignalAbort({
    onAbort: (signal) => {
      if (signalled) { return; }
      signalled = true;
      logger.warn('Signal received — aborting wave', { waveId, signal });
      markAborted(waveDir, signal);
      for (const dir of legDirs) { markAborted(dir, signal); }
      try { server.close(); } catch { /* best-effort */ }
      const code = signal === 'SIGINT' ? 130 : 143;
      const t = setTimeout(() => process.exit(code), 300);
      if (t.unref) { t.unref(); }
    },
  });

  // 6. Launch all legs concurrently (runLeg never rejects)
  const heartbeat = options.quiet ? { stop() {} } : createHeartbeat(HEARTBEAT_INTERVAL);
  const timeoutMs = (options.timeout || 15) * 60 * 1000;
  const reasoning = options.thinking ? { effort: options.thinking } : undefined;
  let legDocs;
  try {
    legDocs = await Promise.all(legs.map((leg, i) => runLeg({
      leg, legId: legIds[i], waveId, project, systemPrompt, userMessage,
      timeoutMs, agent: options.agent, client, server,
      summaryLength: options.summaryLength, reasoning, quiet: options.quiet,
    })));
  } finally {
    heartbeat.stop();
    uninstallSignals();
    try { server.close(); } catch { /* already closed on signal */ }
  }

  // 7. Aggregate, persist, finalize, emit
  const completedAt = new Date().toISOString();
  const wave = buildWaveResult({
    waveId, legs: legDocs, promptMeta: options.promptMeta || null, createdAt, completedAt,
  });
  fs.writeFileSync(path.join(waveDir, 'wave.json'), JSON.stringify(wave, null, 2), { mode: 0o600 });
  writeWaveMetadata(waveDir, { status: wave.status, completedAt });
  emit(wave);
  return { wave, exitCode: waveExitCode(wave.status) };
}

module.exports = {
  parseModelsList, deriveLegIds, validateFanoutModels, DEFAULT_MAX_LEGS,
  runFanout, runLeg, writeWaveMetadata,
};
```

NOTE for the implementer: run `npm run lint` and fix any unused-var complaints. Keep the TOTAL file ≤300 lines (it is size-checked); if over, trim comments first, then move `runLeg`/`writeLegPatch` into a new `src/sidecar/fanout-leg.js` (also ≤300) and require it from `fanout.js` — exports and tests stay unchanged.

- [ ] **Step 4: Run tests + line-count check**

Run: `npx jest tests/sidecar/fanout.test.js` → PASS
Run: `(Get-Content src/sidecar/fanout.js | Measure-Object -Line).Lines` → ≤ 300
Run: `npm test` → 0 failed

- [ ] **Step 5: Commit**

```bash
git add src/sidecar/fanout.js tests/sidecar/fanout.test.js
git commit -m "feat(f4): runFanout orchestrator - shared server, concurrent legs, wave aggregation"
```

---

### Task 8: CLI wiring — `fanout` command, exit codes, usage text

**Files:**
- Modify: `bin/amicus.js` (dispatch + new handler)
- Modify: `src/utils/lifecycle.js:15` (one-shot set)
- Modify: `src/cli.js` (usage text)
- Test: `tests/fanout-cli.test.js`, plus extend `tests/utils/lifecycle.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// tests/fanout-cli.test.js
'use strict';

const { getUsage } = require('../src/cli');
const { ONE_SHOT_COMMANDS } = require('../src/utils/lifecycle');

describe('fanout CLI surface', () => {
  it('usage text documents fanout, --models, --prompt-file, --json and exit codes', () => {
    const usage = getUsage();
    expect(usage).toContain('fanout');
    expect(usage).toContain('--models');
    expect(usage).toContain('--prompt-file');
    expect(usage).toContain('--wave-id');
    expect(usage).toMatch(/exit code/i);
  });

  it('fanout is a one-shot command (exit watchdog armed)', () => {
    expect(ONE_SHOT_COMMANDS.has('fanout')).toBe(true);
  });

  it('bin/amicus.js routes fanout and plumbs the exit code', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '../bin/amicus.js'), 'utf-8');
    expect(src).toContain("case 'fanout':");
    expect(src).toContain('handleFanout');
    expect(src).toContain('armExitWatchdog(exitCode');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/fanout-cli.test.js`
Expected: FAIL on all three

- [ ] **Step 3: Implement**

3a. `src/utils/lifecycle.js:15` — add `'fanout'`:

```js
const ONE_SHOT_COMMANDS = new Set(['start', 'continue', 'resume', 'list', 'read', 'abort', 'fanout']);
```

3b. `bin/amicus.js` — in `main()`, change the dispatch to capture an exit code. Replace:

```js
  try {
    switch (command) {
      case 'start':
        await handleStart(args);
        break;
```

with:

```js
  let exitCode = 0;
  try {
    switch (command) {
      case 'start':
        await handleStart(args);
        break;
      case 'fanout':
        exitCode = await handleFanout(args);
        break;
```

(keep every other `case` unchanged), and replace the tail:

```js
  if (isOneShotCommand(command)) {
    armExitWatchdog(0, 1500, { log: (m, meta) => logger.debug(m, meta) });
  }
```

with:

```js
  if (exitCode) { process.exitCode = exitCode; }
  if (isOneShotCommand(command)) {
    armExitWatchdog(exitCode, 1500, { log: (m, meta) => logger.debug(m, meta) });
  }
```

3c. `bin/amicus.js` — add the handler (next to `handleStart`):

```js
/**
 * Handle 'amicus fanout' command (F4).
 * Returns the wave exit code: 0 all complete, 2 partial, 1 none/hard failure.
 */
async function handleFanout(args) {
  const { resolvePromptSource } = require('../src/utils/prompt-source');
  const promptRes = resolvePromptSource(args);
  if (promptRes.error) {
    console.error(promptRes.error);
    process.exit(1);
  }
  if (typeof args.models !== 'string' || !args.models.trim()) {
    console.error('Error: --models is required (comma-separated aliases or provider/model IDs)');
    process.exit(1);
  }
  if (args['wave-id']) {
    const check = validateTaskId(String(args['wave-id']));
    if (!check.valid) {
      console.error(check.error);
      process.exit(1);
    }
  }
  if (args.agent && String(args.agent).toLowerCase() === 'chat') {
    console.error('Error: --agent chat is interactive-only; fanout is headless');
    process.exit(1);
  }

  // Direct require — the src/index.js public re-export is added later (Task 13)
  const { runFanout } = require('../src/sidecar/fanout');
  const { exitCode } = await runFanout({
    models: args.models,
    prompt: promptRes.prompt,
    promptMeta: promptRes.promptMeta,
    waveId: args['wave-id'],
    project: args.cwd || process.cwd(),
    agent: args.agent || args.mode,
    thinking: args.thinking,
    timeout: args.timeout,
    summaryLength: args['summary-length'],
    includeContext: !args['no-context'],
    sessionId: args['session-id'],
    contextTurns: args['context-turns'],
    contextSince: args['context-since'],
    contextMaxTokens: args['context-max-tokens'],
    mcp: args.mcp,
    mcpConfig: args['mcp-config'],
    noMcp: args['no-mcp'],
    excludeMcp: args['exclude-mcp'],
    noValidateModel: args['no-validate-model'],
    json: !!args.json,
    client: args.client,
  });
  return exitCode;
}
```

3d. `src/cli.js` `getUsage()` — in the `Commands:` block after the `start` line add:

```
  fanout      Run N models on the same prompt in parallel (headless)
```

and after the `Options for 'start':` block add:

```
Options for 'fanout':
  --models <a,b,c>             Required. Comma-separated aliases or provider/model IDs
  --prompt <text>              Task briefing (or use --prompt-file)
  --prompt-file <path>         Read the briefing from a UTF-8 file (avoids the
                               ~32KB Windows argument cap). Mutually exclusive
                               with --prompt. Also works with 'start'.
  --wave-id <id>               Explicit wave ID (leg IDs become <id>-1..N)
  --json                       Emit the wave result as stable JSON on stdout
  Shared per-leg knobs: --agent, --thinking, --timeout, --summary-length,
  --no-context, --context-*, --mcp*, --no-validate-model, --cwd
  Exit codes: 0 all legs complete, 2 partial, 1 none complete / hard failure
```

and under `Options for 'start':` add (after the `--prompt` line):

```
  --prompt-file <path>         Read the prompt from a UTF-8 file (XOR --prompt)
  --json                       With --no-ui: emit the run result as stable JSON
```

- [ ] **Step 4: Run tests**

Run: `npx jest tests/fanout-cli.test.js` → PASS
Run: `npm test` → 0 failed (the cli-process integration tests are excluded from the default gate)

- [ ] **Step 5: Smoke the validation paths end-to-end (no API call)**

Run: `node bin/amicus.js fanout --prompt "x"`
Expected: `Error: --models is required …`, exit 1
Run: `node bin/amicus.js fanout --models a/b --prompt x --prompt-file y`
Expected: `Error: --prompt and --prompt-file are mutually exclusive`, exit 1

- [ ] **Step 6: Commit**

```bash
git add bin/amicus.js src/utils/lifecycle.js src/cli.js tests/fanout-cli.test.js
git commit -m "feat(f4): amicus fanout CLI command with exit-code plumbing and usage docs"
```

---

### Task 9: `--prompt-file` + `--json` on `start`

**Files:**
- Modify: `bin/amicus.js` `handleStart`
- Modify: `src/sidecar/start.js` `startSidecar` tail
- Modify: `src/sidecar/session-utils.js` `finalizeSession`
- Test: `tests/start-json.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// tests/start-json.test.js
'use strict';

const mockRunHeadless = jest.fn();
jest.mock('../src/headless', () => {
  const actual = jest.requireActual('../src/headless');
  return { ...actual, runHeadless: mockRunHeadless };
});

jest.mock('../src/sidecar/context-builder', () => ({
  buildContext: jest.fn(() => 'CTX'),
  parseDuration: jest.fn(),
}));

jest.mock('../src/utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const fs = require('fs');
const os = require('os');
const path = require('path');
const { startSidecar } = require('../src/sidecar/start');

describe('start --json (F4)', () => {
  let project;
  let logSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-startjson-'));
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    mockRunHeadless.mockResolvedValue({
      summary: 'JSON MODE SUMMARY', completed: true, timedOut: false, aborted: false,
      taskId: 'x', toolCalls: [], exitCode: 0,
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
    fs.rmSync(project, { recursive: true, force: true });
  });

  it('emits ONLY a parseable run document on stdout', async () => {
    await startSidecar({
      model: 'openrouter/a/b', prompt: 'task', noUi: true, cwd: project,
      includeContext: false, json: true, modelInput: 'somealias', taskId: 'feed0001',
    });
    expect(logSpy).toHaveBeenCalledTimes(1); // exactly one stdout write
    const doc = JSON.parse(logSpy.mock.calls[0][0]); // whole-output parse must succeed
    expect(doc).toMatchObject({
      schemaVersion: 1, type: 'run', taskId: 'feed0001',
      model: 'openrouter/a/b', modelInput: 'somealias',
      status: 'complete', summary: 'JSON MODE SUMMARY',
    });
    expect(doc.sessionDir).toContain('feed0001');
  });

  it('emits a parseable error document when the run errors', async () => {
    mockRunHeadless.mockResolvedValue({
      summary: '', completed: false, timedOut: false, aborted: false, error: 'model exploded', taskId: 'x',
    });
    await startSidecar({
      model: 'openrouter/a/b', prompt: 'task', noUi: true, cwd: project,
      includeContext: false, json: true, taskId: 'feed0002',
    });
    const doc = JSON.parse(logSpy.mock.calls[0][0]);
    expect(doc.status).toBe('error');
    expect(doc.error).toBe('model exploded');
  });

  it('non-json mode still prints the raw summary (back-compat)', async () => {
    await startSidecar({
      model: 'openrouter/a/b', prompt: 'task', noUi: true, cwd: project,
      includeContext: false, taskId: 'feed0003',
    });
    expect(logSpy).toHaveBeenCalledWith('JSON MODE SUMMARY');
  });
});

describe('finalizeSession conflict routing (F4)', () => {
  it('accepts an opts arg and routes the conflict warning to stderr in json mode', () => {
    const src = fs.readFileSync(path.join(__dirname, '../src/sidecar/session-utils.js'), 'utf-8');
    expect(src).toMatch(/function finalizeSession\(sessionDir, summary, project, metadata, opts = \{\}\)/);
    expect(src).toContain('process.stderr.write');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/start-json.test.js`
Expected: FAIL (json option unknown; conflict-routing source assertions fail)

- [ ] **Step 3: Implement**

3a. `src/sidecar/session-utils.js` — change `finalizeSession` signature and conflict output:

```js
/** Finalize session - detect conflicts, save summary, update metadata */
function finalizeSession(sessionDir, summary, project, metadata, opts = {}) {
  const metaPath = SessionPaths.metadataFile(sessionDir);

  // Detect file conflicts
  const conflicts = detectConflicts(
    { written: metadata.filesWritten },
    project,
    new Date(metadata.createdAt)
  );

  if (conflicts.length > 0) {
    const conflictWarning = formatConflictWarning(conflicts);
    if (opts.quietStdout) {
      // JSON mode: stdout must stay pure JSON (F4) — warn on stderr instead.
      process.stderr.write(`\n${conflictWarning}\n`);
    } else {
      console.log(`\n${conflictWarning}\n`);
    }
    metadata.conflicts = conflicts;
  }
```

(rest of the function unchanged.)

3b. `src/sidecar/start.js` — destructure the new options in `startSidecar` (add `json` and `modelInput` to the existing destructuring):

```js
  const {
    model, prompt, briefing, sessionId, session = 'current',
    cwd, project = process.cwd(), contextTurns = 50, contextSince,
    contextMaxTokens = 80000, noUi, headless = false, timeout = 15,
    agent, mcp, mcpConfig, summaryLength = 'normal', thinking,
    client, sessionDir, noMcp, excludeMcp, opencodePort, coworkProcess, includeContext = true,
    position = 'right', json = false, modelInput = null
  } = options;
```

then replace the tail of `startSidecar` — currently:

```js
  outputSummary(summary);
  const metaPath = SessionPaths.metadataFile(sessDir);
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
```

through the end of the function — with:

```js
  if (!json) { outputSummary(summary); }
  const metaPath = SessionPaths.metadataFile(sessDir);
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));

  // Persist OpenCode session ID for resume capability
  if (result && result.opencodeSessionId) {
    meta.opencodeSessionId = result.opencodeSessionId;
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), { mode: 0o600 });
  }

  // Mark error results as 'error' instead of 'complete'
  if (result && result.error) {
    meta.status = 'error';
    meta.reason = result.error;
    meta.completedAt = new Date().toISOString();
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), { mode: 0o600 });
    logger.error('Session completed with error', { taskId, error: result.error });
  } else {
    finalizeSession(sessDir, summary, effectiveProject, meta, { quietStdout: json });
  }

  if (json) {
    const { buildRunResult } = require('../utils/result-schema');
    const finalMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    const doc = buildRunResult({
      taskId, metadata: finalMeta, result, summary,
      modelInput, sessionDir: sessDir,
    });
    console.log(JSON.stringify(doc, null, 2));
  }
```

3c. `bin/amicus.js` `handleStart` — at the TOP of the function, resolve the prompt source and gate `--json`:

```js
async function handleStart(args) {
  // F4: --prompt-file support (XOR --prompt) and --json gating
  if (args.prompt !== undefined || args['prompt-file'] !== undefined) {
    const { resolvePromptSource } = require('../src/utils/prompt-source');
    const promptRes = resolvePromptSource(args);
    if (promptRes.error) {
      console.error(promptRes.error);
      process.exit(1);
    }
    args.prompt = promptRes.prompt;
  }
  if (args.json && !args['no-ui']) {
    console.error('Error: --json requires --no-ui');
    process.exit(1);
  }

  const { model, alias } = resolveModelFromArgs(args);
```

(rest unchanged) — and add to the `startSidecar({...})` call object:

```js
    json: !!args.json,
    modelInput: alias || null,
```

- [ ] **Step 4: Run tests**

Run: `npx jest tests/start-json.test.js` → PASS
Run: `npm test` → 0 failed (notably `tests/sidecar/start.test.js` and `tests/sidecar/session-utils.test.js` must not regress — the new `opts` parameter is optional and defaults preserve old behavior)

- [ ] **Step 5: Commit**

```bash
git add src/sidecar/start.js src/sidecar/session-utils.js bin/amicus.js tests/start-json.test.js
git commit -m "feat(f4): --json and --prompt-file on start; conflict warning routed to stderr in json mode"
```

---

### Task 10: `read --json` (run + wave) and wave marker in `list`

**Files:**
- Modify: `src/sidecar/read.js`
- Modify: `bin/amicus.js` `handleRead` (pass `json`)
- Test: `tests/read-json.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// tests/read-json.test.js
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { readSidecar, listSidecars, enumerateSessions } = require('../src/sidecar/read');

describe('read --json and wave-aware list (F4)', () => {
  let project;
  let logSpy;

  const writeSession = (taskId, meta, summary) => {
    const dir = path.join(project, '.claude', 'amicus_sessions', taskId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify({ taskId, ...meta }, null, 2));
    if (summary !== undefined) { fs.writeFileSync(path.join(dir, 'summary.md'), summary); }
    return dir;
  };

  beforeEach(() => {
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-readjson-'));
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    fs.rmSync(project, { recursive: true, force: true });
  });

  it('read --json on a run session emits a parseable run document', async () => {
    writeSession('feed1111', {
      model: 'a/b', agent: 'plan', status: 'complete',
      createdAt: '2026-06-09T10:00:00.000Z', completedAt: '2026-06-09T10:01:00.000Z',
    }, 'sum');
    await readSidecar({ taskId: 'feed1111', json: true, project });
    const doc = JSON.parse(logSpy.mock.calls[0][0]);
    expect(doc).toMatchObject({ type: 'run', taskId: 'feed1111', status: 'complete', summary: 'sum' });
  });

  it('read --json on a wave emits the stored wave.json', async () => {
    const waveDir = writeSession('feed2222', { type: 'wave', status: 'complete', legs: [] });
    fs.writeFileSync(path.join(waveDir, 'wave.json'),
      JSON.stringify({ schemaVersion: 1, type: 'wave', waveId: 'feed2222', status: 'complete', counts: { total: 0, complete: 0, error: 0, timeout: 0, aborted: 0 }, legs: [] }));
    await readSidecar({ taskId: 'feed2222', json: true, project });
    const doc = JSON.parse(logSpy.mock.calls[0][0]);
    expect(doc.type).toBe('wave');
    expect(doc.waveId).toBe('feed2222');
  });

  it('non-json read of a wave prints the human aggregate', async () => {
    const waveDir = writeSession('feed3333', { type: 'wave', status: 'partial', legs: ['feed3333-1'] });
    fs.writeFileSync(path.join(waveDir, 'wave.json'), JSON.stringify({
      schemaVersion: 1, type: 'wave', waveId: 'feed3333', status: 'partial',
      counts: { total: 1, complete: 0, error: 1, timeout: 0, aborted: 0 }, durationMs: 1000,
      legs: [{ taskId: 'feed3333-1', modelInput: 'x', model: 'a/b', status: 'error', error: 'boom', summary: null, durationMs: 1000 }],
    }));
    await readSidecar({ taskId: 'feed3333', project });
    const out = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(out).toContain('feed3333');
    expect(out).toContain('partial');
  });

  it('enumerateSessions carries type/parentWave; list shows a wave marker', async () => {
    writeSession('feed4444', { type: 'wave', status: 'running', legs: ['feed4444-1', 'feed4444-2'], createdAt: new Date().toISOString() });
    writeSession('feed4444-1', { model: 'a/b', status: 'running', parentWave: 'feed4444', createdAt: new Date().toISOString() });

    const sessions = enumerateSessions(project, {});
    const wave = sessions.find(s => s.id === 'feed4444');
    expect(wave.type).toBe('wave');
    expect(wave.legCount).toBe(2);
    const leg = sessions.find(s => s.id === 'feed4444-1');
    expect(leg.parentWave).toBe('feed4444');

    await listSidecars({ project });
    const out = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(out).toContain('wave(2 legs)');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/read-json.test.js`
Expected: FAIL

- [ ] **Step 3: Implement in `src/sidecar/read.js`**

3a. In `enumerateSessions`, extend the record (the `byId.set(d, {...})` object):

```js
        byId.set(d, {
          id: d, model: meta.model, status: meta.status, agent: meta.agent,
          briefing: meta.briefing, createdAt: meta.createdAt,
          type: meta.type || 'run',
          parentWave: meta.parentWave || null,
          legCount: Array.isArray(meta.legs) ? meta.legs.length : null,
        });
```

3b. In `listSidecars`, change the model-column rendering line from:

```js
        `${(s.model || '').padEnd(23)}` +
```

to:

```js
        `${(s.type === 'wave' ? `wave(${s.legCount} legs)` : (s.model || '')).padEnd(23)}` +
```

3c. In `readSidecar`, destructure `json` and handle it first (after the `sessionDir` existence check):

```js
async function readSidecar(options) {
  const { taskId, conversation, metadata, json, project = process.cwd() } = options;

  const sessionDir = safeSessionDir(project, taskId);

  if (!fs.existsSync(sessionDir)) {
    throw new Error(`Session ${taskId} not found`);
  }

  const metaPath = path.join(sessionDir, 'metadata.json');
  let meta = {};
  try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')); } catch { /* legacy/partial */ }

  if (json) {
    const { buildRunResultFromSession, buildWaveResultFromSession } = require('../utils/result-schema');
    const doc = meta.type === 'wave'
      ? buildWaveResultFromSession(project, taskId)
      : buildRunResultFromSession(project, taskId);
    console.log(JSON.stringify(doc, null, 2));
    return;
  }

  if (meta.type === 'wave' && !conversation && !metadata) {
    const { buildWaveResultFromSession } = require('../utils/result-schema');
    const { formatWaveHuman } = require('./fanout-output');
    console.log(formatWaveHuman(buildWaveResultFromSession(project, taskId)));
    return;
  }
```

(then the existing `if (conversation) … else if (metadata) … else …` body continues unchanged.)

3d. `bin/amicus.js` `handleRead` — add `json: args.json,` to the `readSidecar({...})` call.

- [ ] **Step 4: Run tests**

Run: `npx jest tests/read-json.test.js` → PASS
Run: `(Get-Content src/sidecar/read.js | Measure-Object -Line).Lines` → ≤ 300
Run: `npm test` → 0 failed

- [ ] **Step 5: Commit**

```bash
git add src/sidecar/read.js bin/amicus.js tests/read-json.test.js
git commit -m "feat(f4): read --json for runs and waves; wave marker in list"
```

---

### Task 11: `abort <waveId>` aborts all legs

**Files:**
- Modify: `src/cli-handlers.js` `handleAbort`
- Test: `tests/abort-wave.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/abort-wave.test.js
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../src/utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const { handleAbort } = require('../src/cli-handlers');

describe('abort <waveId> (F4)', () => {
  let project;
  let logSpy;

  const writeSession = (taskId, meta) => {
    const dir = path.join(project, '.claude', 'amicus_sessions', taskId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify({ taskId, ...meta }, null, 2));
    return dir;
  };

  const readStatus = (taskId) => JSON.parse(fs.readFileSync(
    path.join(project, '.claude', 'amicus_sessions', taskId, 'metadata.json'), 'utf-8')).status;

  beforeEach(() => {
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-abortwave-'));
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    fs.rmSync(project, { recursive: true, force: true });
  });

  it('marks the wave AND every running leg aborted; completed legs stay complete', async () => {
    writeSession('beef0001', { type: 'wave', status: 'running', legs: ['beef0001-1', 'beef0001-2'] });
    writeSession('beef0001-1', { status: 'running', parentWave: 'beef0001' });
    writeSession('beef0001-2', { status: 'complete', parentWave: 'beef0001' });

    await handleAbort({ _: ['abort', 'beef0001'], cwd: project });

    expect(readStatus('beef0001')).toBe('aborted');
    expect(readStatus('beef0001-1')).toBe('aborted');
    expect(readStatus('beef0001-2')).toBe('complete'); // not clobbered
  });

  it('plain session abort still works', async () => {
    writeSession('beef0002', { status: 'running' });
    await handleAbort({ _: ['abort', 'beef0002'], cwd: project });
    expect(readStatus('beef0002')).toBe('aborted');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/abort-wave.test.js`
Expected: FAIL — wave legs are not aborted (and completed leg gets clobbered if naive)

- [ ] **Step 3: Implement in `src/cli-handlers.js`**

In `handleAbort`, replace the final block:

```js
  const { markAborted } = require('./utils/session-abort');
  markAborted(sessionDir, 'manual abort');
  console.log(`Session ${taskId} marked as aborted.`);
```

with:

```js
  const { markAborted } = require('./utils/session-abort');
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));

  // F4: aborting a wave aborts every still-running leg too.
  if (meta.type === 'wave') {
    const { resolveExistingSessionDir } = require('./session-manager');
    let aborted = 0;
    for (const legId of meta.legs || []) {
      const legDir = resolveExistingSessionDir(project, legId);
      try {
        const legMeta = JSON.parse(fs.readFileSync(path.join(legDir, 'metadata.json'), 'utf-8'));
        if (legMeta.status === 'running') {
          if (markAborted(legDir, 'wave abort')) { aborted++; }
        }
      } catch { /* skip unreadable leg */ }
    }
    markAborted(sessionDir, 'manual abort');
    console.log(`Wave ${taskId} marked as aborted (${aborted} running leg(s) aborted).`);
    return;
  }

  markAborted(sessionDir, 'manual abort');
  console.log(`Session ${taskId} marked as aborted.`);
```

NOTE: `handleAbort` already parses `metaPath` JSON earlier for validation — reuse that parse result if convenient, but keep behavior identical.

- [ ] **Step 4: Run tests**

Run: `npx jest tests/abort-wave.test.js tests/abort-all.test.js` → PASS (abort-all must not regress; legs are ordinary sessions so `--all` already covers them)
Run: `npm test` → 0 failed

- [ ] **Step 5: Commit**

```bash
git add src/cli-handlers.js tests/abort-wave.test.js
git commit -m "feat(f4): abort <waveId> aborts the wave and all running legs"
```

---

### Task 12: MCP — `amicus_fanout` tool + wave-aware status/read

**Files:**
- Modify: `src/mcp-tools.js` (tool definition, append to the `getTools()` array before `amicus_guide`)
- Modify: `src/mcp-server.js` (new handler + wave branches in `amicus_status`/`amicus_read`)
- Test: `tests/mcp-fanout.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// tests/mcp-fanout.test.js
'use strict';

const { getTools } = require('../src/mcp-tools');

describe('amicus_fanout MCP surface (F4)', () => {
  it('defines the amicus_fanout tool with models array and prompt', () => {
    const tool = getTools().find(t => t.name === 'amicus_fanout');
    expect(tool).toBeDefined();
    expect(tool.description).toMatch(/parallel/i);
    expect(tool.inputSchema.models).toBeDefined();
    expect(tool.inputSchema.prompt).toBeDefined();
  });

  it('handler writes briefing.md and spawns the CLI with --prompt-file, never inline prompt', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '../src/mcp-server.js'), 'utf-8');
    expect(src).toContain('async amicus_fanout(');
    expect(src).toContain("'--prompt-file'");
    expect(src).toContain("'--wave-id'");
    expect(src).toContain('briefing.md');
    // wave-aware status + read
    expect(src).toMatch(/type === 'wave'/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/mcp-fanout.test.js`
Expected: FAIL

- [ ] **Step 3: Implement**

3a. `src/mcp-tools.js` — insert into the array returned by `getTools()` (after the `amicus_abort` entry):

```js
  {
    name: 'amicus_fanout',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    description:
      'Run N models on the SAME prompt in parallel on one shared engine ' +
      '(headless only) and aggregate the results. Returns {waveId, taskIds[]} ' +
      'immediately. Poll amicus_status with the waveId (run `sleep 25` between ' +
      'polls); when done, amicus_read the waveId for the aggregated JSON wave ' +
      'document (per-leg summaries inside). Each leg is also an ordinary ' +
      'session readable by taskId.',
    inputSchema: {
      models: z.array(safeModel).min(1).max(10).describe(
        `2-10 models for genuine fan-out. Short aliases (${aliasNames}) or full provider/model IDs. Duplicates allowed.`
      ),
      prompt: z.string().describe(
        'The briefing sent to every model. Self-contained briefings work best (set includeContext false).'
      ),
      agent: z.enum(['Plan', 'Build']).optional().describe(
        'Agent mode for every leg. Build (default): full tool access. Plan: read-only analysis. Chat is not supported headless.'
      ),
      thinking: z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']).optional().describe(
        'Reasoning effort for every leg. Default: medium.'
      ),
      timeout: z.number().optional().describe(
        'Per-leg timeout in minutes (wall-clock ≈ slowest leg). Default: 15.'
      ),
      summaryLength: z.enum(['brief', 'normal', 'verbose']).optional().describe(
        'Summary verbosity for every leg.'
      ),
      includeContext: z.boolean().optional().default(true).describe(
        'Include parent conversation context (built once, shared by all legs). Set false for self-contained briefings.'
      ),
      project: z.string().optional().describe(
        'Optional project directory path. Auto-detected from working directory if omitted.'
      ),
    },
  },
```

3b. `src/mcp-server.js` — add the handler to the `handlers` object (after `amicus_abort`):

```js
  async amicus_fanout(input, project) {
    const cwd = project || getProjectDir(input.project);
    const { generateTaskId } = require('./sidecar/start');
    const { deriveLegIds } = require('./sidecar/fanout');
    const waveId = generateTaskId();
    const legIds = deriveLegIds(waveId, input.models.length);
    const waveDir = getSessionDir(cwd, waveId);

    let briefingPath;
    try {
      fs.mkdirSync(waveDir, { recursive: true, mode: 0o700 });
      briefingPath = path.join(waveDir, 'briefing.md');
      // The prompt goes via file: the spawned command line must NOT carry it,
      // or it re-hits the ~32KB Windows argument cap (F4 spec §4.2).
      fs.writeFileSync(briefingPath, input.prompt, { mode: 0o600 });
      fs.writeFileSync(path.join(waveDir, 'metadata.json'), JSON.stringify({
        taskId: waveId, type: 'wave', status: 'running', legs: legIds,
        models: input.models, headless: true, createdAt: new Date().toISOString(),
      }, null, 2), { mode: 0o600 });
    } catch (err) {
      return textResult(`Failed to prepare fan-out wave: ${err.message}`, true);
    }

    const args = [
      'fanout', '--models', input.models.join(','),
      '--prompt-file', briefingPath, '--wave-id', waveId,
      '--json', '--client', 'cowork', '--cwd', cwd,
    ];
    const agent = input.agent || 'Build';
    args.push('--agent', agent);
    if (input.thinking)      { args.push('--thinking', input.thinking); }
    if (input.timeout)       { args.push('--timeout', String(input.timeout)); }
    if (input.summaryLength) { args.push('--summary-length', input.summaryLength); }
    if (input.includeContext === false) { args.push('--no-context'); }

    try { spawnSidecarProcess(args, waveDir); } catch (err) {
      return textResult(`Failed to start fan-out: ${err.message}`, true);
    }

    const body = JSON.stringify({
      waveId, taskIds: legIds, status: 'running', mode: 'headless',
      message: 'Fan-out started. Poll amicus_status with the waveId; amicus_read the waveId when complete.',
    });
    return { content: [{ type: 'text', text: body }, { type: 'text', text: HEADLESS_START_REMINDER }] };
  },
```

3c. `src/mcp-server.js` `amicus_status` — immediately after the `if (!metadata) { … }` guard, add the wave branch:

```js
    if (metadata.type === 'wave') {
      const legs = (metadata.legs || []).map((legId) => {
        const m = readMetadata(legId, cwd);
        return { taskId: legId, model: (m && m.model) || null, status: (m && m.status) || 'unknown' };
      });
      const { TERMINAL_STATUSES } = require('./utils/result-schema');
      const done = legs.filter(l => TERMINAL_STATUSES.includes(l.status)).length;
      const ms = Date.now() - new Date(metadata.createdAt).getTime();
      const response = {
        taskId: metadata.taskId, type: 'wave', status: metadata.status,
        legsComplete: done, legsTotal: legs.length, legs,
        elapsed: `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`,
      };
      const responseText = JSON.stringify(response);
      if (metadata.status === 'running') {
        return { content: [{ type: 'text', text: responseText }, { type: 'text', text: HEADLESS_STATUS_REMINDER }] };
      }
      return textResult(responseText);
    }
```

3d. `src/mcp-server.js` `amicus_read` — after the session-exists check, before the `mode` handling, add:

```js
    const readMeta = (() => {
      try { return JSON.parse(fs.readFileSync(path.join(sessionDir, 'metadata.json'), 'utf-8')); }
      catch { return {}; }
    })();
    if (readMeta.type === 'wave' && (input.mode || 'summary') === 'summary') {
      const wavePath = path.join(sessionDir, 'wave.json');
      if (fs.existsSync(wavePath)) {
        return textResult(fs.readFileSync(wavePath, 'utf-8'));
      }
      const legsTotal = (readMeta.legs || []).length;
      return textResult(`Wave ${input.taskId} is still running (${legsTotal} legs). Poll amicus_status.`);
    }
```

- [ ] **Step 4: Run tests**

Run: `npx jest tests/mcp-fanout.test.js tests/mcp-tools.test.js tests/mcp-tool-aliases.test.js tests/mcp-server.test.js` → PASS
(The `sidecar_*` alias dual-registration iterates `getTools()`, so `sidecar_fanout` registers automatically; if an alias test enumerates tool names, update its expected list to include `amicus_fanout`/`sidecar_fanout`.)
Run: `npm test` → 0 failed

- [ ] **Step 5: Commit**

```bash
git add src/mcp-tools.js src/mcp-server.js tests/mcp-fanout.test.js
git commit -m "feat(f4): MCP amicus_fanout tool with wave-aware status/read"
```

---

### Task 13: Public API export + docs polish + full verification

**Files:**
- Modify: `src/index.js` (export `runFanout`)
- Modify: `src/mcp-tools.js` `getGuideText()` (mention fan-out)
- Test: extend `tests/index-exports.test.js`

- [ ] **Step 1: Write the failing test** (append to `tests/index-exports.test.js`)

```js
describe('F4 exports', () => {
  it('exposes runFanout on the public API', () => {
    const api = require('../src/index');
    expect(typeof api.runFanout).toBe('function');
  });
});
```

Run: `npx jest tests/index-exports.test.js` → FAIL

- [ ] **Step 2: Implement**

2a. `src/index.js` — add with the other sidecar requires:

```js
const { runFanout } = require('./sidecar/fanout');
```

and add `runFanout,` to the `module.exports` object (under the canonical Amicus API comment).

2b. `src/mcp-tools.js` `getGuideText()` — in the `## Async Workflow` section, after the Headless Mode list, add:

```
### Fan-Out (amicus_fanout)
Run the SAME prompt across 2-10 models in parallel (one shared engine):
1. amicus_fanout with models + prompt -> {waveId, taskIds[]}
2. sleep 25, then amicus_status with the waveId (repeat until done)
3. amicus_read the waveId -> aggregated JSON wave document (per-leg summaries inside)
Each leg is an ordinary session: read/resume/continue it by taskId.
```

- [ ] **Step 3: Full verification**

Run: `npx jest tests/index-exports.test.js` → PASS
Run: `npm test` → **0 failed** (expect ≈1700+ passed / 5 skipped)
Run: `npm run lint` → clean
Run: `node bin/amicus.js --help` → fanout section renders

- [ ] **Step 4: Commit**

```bash
git add src/index.js src/mcp-tools.js tests/index-exports.test.js
git commit -m "feat(f4): export runFanout; document fan-out in the MCP guide"
```

---

### Task 14: Real-LLM integration smoke (gated tier)

**Files:**
- Create: `tests/fanout-e2e.integration.test.js`

- [ ] **Step 1: Write the gated test** (integration tier only — `*.integration.test.js` is excluded from the default `npm test` gate)

```js
// tests/fanout-e2e.integration.test.js
'use strict';

/**
 * Real-LLM fan-out smoke. Runs ONLY when an OpenRouter key is configured
 * (same skip-when-no-key pattern as the other real-LLM integration tests).
 * Run via: npm run test:integration -- fanout-e2e
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const hasKey = !!process.env.OPENROUTER_API_KEY;
const d = hasKey ? describe : describe.skip;

d('fanout end-to-end (real LLM)', () => {
  jest.setTimeout(10 * 60 * 1000);

  it('runs a 2-model wave and emits a parseable wave document', () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-fanout-e2e-'));
    try {
      const out = execFileSync('node', [
        path.join(__dirname, '..', 'bin', 'amicus.js'),
        'fanout',
        '--models', 'openrouter/google/gemini-2.5-flash,openrouter/deepseek/deepseek-chat',
        '--prompt', 'Reply with exactly the word PONG and nothing else.',
        '--no-context', '--agent', 'Plan', '--timeout', '5',
        '--json', '--cwd', project,
      ], { encoding: 'utf-8' });

      const doc = JSON.parse(out);
      expect(doc.type).toBe('wave');
      expect(doc.schemaVersion).toBe(1);
      expect(doc.legs).toHaveLength(2);
      expect(['complete', 'partial']).toContain(doc.status);
      expect(fs.existsSync(path.join(project, '.claude', 'amicus_sessions', doc.waveId, 'wave.json'))).toBe(true);
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  });
});
```

NOTE: model IDs in this test are examples — before committing, run `npm run models:check` and substitute two currently-valid cheap OpenRouter IDs if these have drifted.

- [ ] **Step 2: Verify gating + (optionally) run for real**

Run: `npm test` → the new file does NOT run (integration excluded), 0 failed.
If a key is configured locally: `npm run test:integration -- fanout-e2e` → PASS (exit code of the CLI may be 2 if one cheap model flakes — the test accepts partial).

- [ ] **Step 3: Commit**

```bash
git add tests/fanout-e2e.integration.test.js
git commit -m "test(f4): real-LLM 2-model fanout smoke (integration tier, skip-when-no-key)"
```

---

## Final wrap-up (after Task 14)

- [ ] Mark the spec implemented: edit the `status:` line in `docs/superpowers/specs/2026-06-09-f4-fanout-json-design.md` frontmatter to `status: implemented (date — subagent-driven; suite green, lint clean)` and add a short `> Implemented` banner listing commits, mirroring the F3 spec.
- [ ] `npm test` (full suite) + `npm run lint` one last time from a clean tree.
- [ ] Merge `f4-exec` → `main` (fast-forward preferred), push, clean up the worktree:

```powershell
git -C C:\Users\sendt\dev\amicus merge --ff-only f4-exec
git -C C:\Users\sendt\dev\amicus push origin main
Remove-Item -Force C:\Users\sendt\dev\amicus-f4\node_modules   # junction — NO -Recurse
git -C C:\Users\sendt\dev\amicus worktree remove C:\Users\sendt\dev\amicus-f4
git -C C:\Users\sendt\dev\amicus branch -d f4-exec
```

- [ ] `git commit -m "docs(f4): mark fanout+json spec implemented"` for the spec status edit.

## Acceptance criteria traceability (spec §7)

1. Concurrent fanout on one server, legs as ordinary sessions → Tasks 7, 10, 11.
2. Stable pure-JSON docs on fanout/start/read, parseable even on failure → Tasks 1, 2, 7, 9, 10.
3. `--prompt-file` >32 KB on Windows → Tasks 3, 8, 9 (test in Task 3).
4. MCP `amicus_fanout` immediate IDs + wave status/read → Task 12.
5. Partial results, exit 2, sibling results intact → Tasks 1, 7 (tests).
6. `abort <waveId>` + Ctrl-C abort all legs → Tasks 7 (signal), 11 (CLI).
7. Suite green, lint clean → every task's Step 4 + final wrap-up.
