// tests/council-pointer-fence.test.js
'use strict';

/**
 * The v4.3 CLI/MCP half of the pointer-containment fence.
 *
 * src/council/run-state.js's readPointer validates a `council-<id>.json`
 * pointer file's {runId, runDir} JSON only for truthiness (:133-139), so a
 * tampered or stale pointer can point runDir anywhere on disk. Three rounds of
 * council review closed this for the v4.4 Workspace GUI (electron/
 * ipc-workspace.js's workspace:open-report, src/workspace/artifact-guard.js,
 * src/workspace/run-detail.js, src/workspace/run-scan.js — all four now check
 * isRealpathContained before touching disk) but were scoped to Phase-1
 * workspace modules only. The SAME gap remained on the older v4.3 surface that
 * backs amicus_status / amicus_abort / amicus_list / `amicus watch`:
 *
 *   src/mcp-council-awareness.js  buildCouncilStatusPayload / abortCouncilRun /
 *                                 listCouncilRuns
 *   src/cli-handlers-watch.js     resolveWatchTarget
 *   src/observe/watch-render.js   runWatchLoop's events.jsonl tail
 *
 * Two of those are strictly worse than the GUI's read-only leak: both
 * buildCouncilStatusPayload's crash-detection branch and abortCouncilRun call
 * runState.checkpoint(ptr.runDir, ...) — a WRITE at an attacker-chosen path.
 *
 * Fixture invariant (the trap the workspace-side fixes hit repeatedly): a REAL
 * runDir is always nested inside project — src/mcp-council-run.js:109 rejects
 * an outDir outside the project at creation time. Every "legitimate" seed below
 * therefore nests runDir under the project; only the tampered-pointer seeds
 * point outside, at a real, readable, sibling temp directory.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const runState = require('../src/council/run-state');

let project; let outside; let handlers;

beforeEach(() => {
  jest.resetModules();
  project = fs.mkdtempSync(path.join(os.tmpdir(), 'ptr-fence-proj-'));
  outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ptr-fence-out-'));
  handlers = require('../src/mcp-server').handlers;
});
afterEach(() => {
  fs.rmSync(project, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
  jest.resetModules();
});

/**
 * Write a council run.json into `runDir` and register a pointer for it under
 * `project`. `runDir` is passed explicitly so a test can seed the production
 * shape (nested) or the tampered shape (outside) with the same helper.
 */
function seedRunAt(runDir, runId, status, extra = {}) {
  runState.initRun(runDir, {
    schemaVersion: 2, type: 'council-run', runId, status,
    stages: [{ name: 'stage1', status: status === 'running' ? 'running' : 'complete', project: runDir }],
    bench: ['gemini', 'gpt'], chair: 'deepseek', critic: null, lenses: null,
    labelMap: null, options: { outDir: runDir }, usage: null,
    createdAt: new Date().toISOString(), ...extra,
  });
  fs.writeFileSync(path.join(runDir, 'briefing.md'), 'secret briefing text');
  runState.writePointer(project, runId, runDir);
  return runDir;
}

/** The production shape: runDir nested under the project. */
function seedNested(runId, status, extra = {}) {
  return seedRunAt(path.join(project, `council-${runId}`), runId, status, extra);
}

/** The attack shape: a valid pointer whose runDir is a real dir OUTSIDE the project. */
function seedEscaping(runId, status, extra = {}) {
  return seedRunAt(path.join(outside, `council-${runId}`), runId, status, extra);
}

const readRaw = (runDir) => fs.readFileSync(path.join(runDir, 'run.json'), 'utf-8');

describe('buildCouncilStatusPayload — pointer containment fence', () => {
  const build = (id) => require('../src/mcp-council-awareness').buildCouncilStatusPayload(project, id);

  test('a tampered pointer whose runDir escapes the project resolves to null (no payload)', () => {
    seedEscaping('esc11111', 'running');
    expect(build('esc11111')).toBeNull();
  });

  test('the crash-detection checkpoint() WRITE never lands in an escaping runDir', () => {
    // status:'running' + a pid that cannot exist is exactly the branch that
    // checkpoints {status:'error'} into ptr.runDir. The fence must refuse
    // BEFORE that write, not merely refuse to return the payload.
    const runDir = seedEscaping('esc22222', 'running', { pid: 999999999 });
    const before = readRaw(runDir);
    expect(build('esc22222')).toBeNull();
    expect(readRaw(runDir)).toBe(before);
    expect(JSON.parse(readRaw(runDir)).status).toBe('running');
  });

  test('a legitimate nested runDir still builds a payload (the fence is not over-broad)', () => {
    seedNested('good1111', 'running', { pid: process.pid });
    const doc = build('good1111');
    expect(doc).not.toBeNull();
    expect(doc.type).toBe('council-run');
    expect(doc.runId).toBe('good1111');
  });

  test('amicus_status surfaces the EXISTING not-found error contract, not a new shape', async () => {
    seedEscaping('esc33333', 'running');
    const res = await handlers.amicus_status({ taskId: 'esc33333' }, project);
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('not found in project');
  });
});

describe('abortCouncilRun — pointer containment fence (write primitive)', () => {
  const abort = (id) => require('../src/mcp-council-awareness').abortCouncilRun(project, id);

  test('an escaping pointer returns null and run.json is left byte-identical (no abort write)', () => {
    const runDir = seedEscaping('esc44444', 'running');
    const before = readRaw(runDir);
    expect(abort('esc44444')).toBeNull();
    expect(readRaw(runDir)).toBe(before);
    expect(JSON.parse(readRaw(runDir)).status).toBe('running');
  });

  test('a legitimate nested runDir still aborts', () => {
    const runDir = seedNested('good2222', 'running');
    expect(abort('good2222')).toMatchObject({ aborted: true });
    expect(runState.readRun(runDir).status).toBe('aborted');
  });

  test('MCP amicus_abort on an escaping pointer keeps the existing not-found error contract', async () => {
    const runDir = seedEscaping('esc55555', 'running');
    const res = await handlers.amicus_abort({ taskId: 'esc55555' }, project);
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('not found in project');
    expect(JSON.parse(readRaw(runDir)).status).toBe('running');
  });

  test('CLI amicus abort on an escaping pointer falls through to "not found" and writes nothing', async () => {
    const runDir = seedEscaping('esc66666', 'running');
    const { handleAbort } = require('../src/cli-handlers-abort');
    const errs = jest.spyOn(console, 'error').mockImplementation(() => {});
    // handleAbort's not-found path calls process.exit(1); make it throw so the
    // promise rejects instead of tearing down the jest worker.
    const exit = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exited'); });
    await expect(handleAbort({ _: ['abort', 'esc66666'], cwd: project })).rejects.toThrow('exited');
    expect(errs.mock.calls.map((c) => String(c[0])).join('\n')).toContain('not found');
    expect(JSON.parse(readRaw(runDir)).status).toBe('running');
    exit.mockRestore();
    errs.mockRestore();
  });
});

describe('listCouncilRuns — pointer containment fence', () => {
  const list = () => require('../src/mcp-council-awareness').listCouncilRuns(project);

  test('an escaping pointer is skipped; legitimate rows still list', () => {
    seedNested('good3333', 'complete');
    seedEscaping('esc77777', 'complete');
    const ids = list().map((r) => r.id);
    expect(ids).toEqual(['good3333']);
  });

  test("the escaping run's briefing.md is never read into a row", () => {
    seedEscaping('esc88888', 'complete');
    expect(JSON.stringify(list())).not.toContain('secret briefing text');
  });
});

describe('resolveWatchTarget — pointer containment fence', () => {
  const resolve = (id) => require('../src/cli-handlers-watch').resolveWatchTarget(id, project);

  test('an escaping pointer resolves to kind unknown (same as a missing pointer)', () => {
    seedEscaping('esc99999', 'running');
    expect(resolve('esc99999')).toMatchObject({ kind: 'unknown', id: 'esc99999' });
    expect(resolve('esc99999').runDir).toBeUndefined();
  });

  test('a legitimate nested runDir still resolves to kind council', () => {
    const runDir = seedNested('good4444', 'running');
    expect(resolve('good4444')).toMatchObject({ kind: 'council', id: 'good4444', runDir });
  });
});

describe('runWatchLoop — pointer containment fence (events tail)', () => {
  function capture(fn) {
    const out = []; const err = [];
    const origOut = process.stdout.write; const origErr = process.stderr.write;
    process.stdout.write = (s) => { out.push(s); return true; };
    process.stderr.write = (s) => { err.push(s); return true; };
    const restore = () => { process.stdout.write = origOut; process.stderr.write = origErr; };
    return Promise.resolve(fn())
      .then((code) => { restore(); return { code, out: out.join(''), err: err.join('') }; })
      .catch((e) => { restore(); throw e; });
  }

  /**
   * A TERMINAL status doc, deliberately — an unfenced runWatchLoop must fall
   * through to the poll and then EXIT rather than spin (its `doc === null`
   * branch is not terminal and its injected sleep is a no-op, so a statusFn
   * returning nothing would hang the suite instead of failing it).
   */
  const terminalStatusFn = () => jest.fn(async () => ({
    content: [{ type: 'text', text: JSON.stringify({
      taskId: 'x', type: 'council-run', status: 'complete', exitCode: 0, stages: [], elapsed: '0m 1s',
    }) }],
  }));

  test('a council target whose runDir escapes the project is refused before any status poll', async () => {
    const runDir = seedEscaping('escaaaaa', 'running');
    const { runWatchLoop } = require('../src/observe/watch-render');
    const statusFn = terminalStatusFn();
    const { code, err } = await capture(() => runWatchLoop(
      { kind: 'council', id: 'escaaaaa', runDir }, {}, project,
      { statusFn, sleep: async () => {}, isTTY: false }
    ));
    expect(code).toBe(1);
    expect(statusFn).not.toHaveBeenCalled();
    expect(err.length).toBeGreaterThan(0);
  });

  test('--json refusal uses the existing failJson BAD_SESSION envelope', async () => {
    const runDir = seedEscaping('escbbbbb', 'running');
    const { runWatchLoop } = require('../src/observe/watch-render');
    const { code, out } = await capture(() => runWatchLoop(
      { kind: 'council', id: 'escbbbbb', runDir }, { json: true }, project,
      { statusFn: terminalStatusFn(), sleep: async () => {}, isTTY: false }
    ));
    expect(code).toBe(1);
    const doc = JSON.parse(out);
    expect(doc.ok).toBe(false);
    expect(doc.error.code).toBe('BAD_SESSION');
  });

  test('a legitimate nested council runDir still runs the loop to a terminal doc', async () => {
    const runDir = seedNested('good5555', 'running');
    const { runWatchLoop, mapExitCode } = require('../src/observe/watch-render');
    const terminal = { taskId: 'good5555', type: 'council-run', status: 'complete', exitCode: 0, stages: [], elapsed: '0m 1s' };
    const statusFn = jest.fn(async () => ({ content: [{ type: 'text', text: JSON.stringify(terminal) }] }));
    const { code } = await capture(() => runWatchLoop(
      { kind: 'council', id: 'good5555', runDir }, {}, project,
      { statusFn, sleep: async () => {}, isTTY: false }
    ));
    expect(code).toBe(mapExitCode(terminal));
    expect(statusFn).toHaveBeenCalled();
  });
});
