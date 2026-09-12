// tests/council/run-tools.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runCouncil } = require('../../src/council/run');
const runState = require('../../src/council/run-state');
const fakes = require('./helpers/fake-launchers');

let tmp; let runDir;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'run-tools-'));
  runDir = path.join(tmp, 'council-r1');
  fs.mkdirSync(runDir, { recursive: true });
});
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

// The same option bag run-intent.test.js drives runCouncil with, minus intent.
const base = (extra = {}) => ({
  briefing: 'Review this.', models: ['gemini', 'gpt', 'qwen'], chair: 'deepseek',
  project: tmp, runId: 'r1', runDir, timeout: 1, maxCost: null, gateway: 'auto',
  noValidateModel: true, date: '2026-09-12', json: true, ...extra,
});
const launchersFor = () => fakes.scriptedLaunchers(fakes.happyScript ? fakes.happyScript('r1') : fakes.script3('r1'));
const stage1 = (calls) => calls.filter((c) => c.waveId === 'r1-s1')[0];
const others = (calls) => calls.filter((c) => c.waveId !== 'r1-s1');

describe('runCouncil seat tools (spec 2026-09-11 §4)', () => {
  test('review default: stage-1 launches with role seat and the no-tools sentence; support roles have no role', async () => {
    const launchers = launchersFor();
    const { exitCode } = await runCouncil(base(), { launchers });
    expect(exitCode).toBe(0);
    expect(stage1(launchers.calls).role).toBe('seat');
    expect(stage1(launchers.calls).prompt).toContain('begin immediately with the review.');
    expect(others(launchers.calls).every((c) => c.role === undefined)).toBe(true);
    expect(runState.readRun(runDir).seatTools).toBeUndefined(); // emit-when-non-empty
  });

  test('task default: the seat sentence names webfetch and run.json records seatTools', async () => {
    const launchers = launchersFor();
    await runCouncil(base({ intent: 'task' }), { launchers });
    expect(stage1(launchers.calls).prompt).toContain('Your tools: webfetch.');
    expect(runState.readRun(runDir).seatTools).toEqual(['webfetch']);
  });

  test('a refused id is BAD_ARGS before anything launches, naming --agent Build', async () => {
    const launchers = launchersFor();
    const { exitCode, run } = await runCouncil(base({ tools: ['task'] }), { launchers });
    expect(exitCode).toBe(1);
    expect(run.error.code).toBe('BAD_ARGS');
    expect(run.error.message).toContain('--agent Build');
    expect(launchers.calls).toHaveLength(0);
  });

  // ⚠️ Deviation from the task-4 brief (documented in task-4-report.md): the
  // brief's literal fixture left `project` at its `base()` default (`tmp`) and
  // only renamed `runDir` to `path.join(tmp, 'outside')` — which is still a
  // CHILD of `tmp`, so it trips the run-directory-placement refusal (Step 3)
  // before the engine-declared-ids check (Step 3's second half) is ever
  // reached, and the resulting message names the placement rule, never
  // 'grepp'. Verified empirically (RED run). This test's own title and note
  // (a) in the brief ("the 'outside' fixtures pass the allowed-root half of
  // the rule") make the intent unambiguous: `runDir` must sit OUTSIDE
  // `project`, exactly like the sibling-directory fixture the very next test
  // builds. Fixed here the same way: `project` is its own sibling directory
  // under `tmp`, not the bare `tmp` default.
  test('an id the engine does not declare is BAD_ARGS after the server, before any launch', async () => {
    const launchers = launchersFor();
    const project = path.join(tmp, 'proj'); fs.mkdirSync(project);
    const listEngineToolIdsFn = async () => ['read', 'webfetch', 'grep'];
    const { exitCode, run } = await runCouncil(
      base({ project, tools: ['grepp'], runDir: path.join(tmp, 'outside') }), { launchers, listEngineToolIdsFn });
    expect(exitCode).toBe(1);
    expect(run.error.code).toBe('BAD_ARGS');
    expect(run.error.message).toContain('grepp');
    expect(launchers.calls).toHaveLength(0);
  });

  test('--tools with no way to ask the engine is refused, never launched unvalidated', async () => {
    const launchers = launchersFor();
    const { exitCode, run } = await runCouncil(base({ tools: ['webfetch'] }), { launchers, listEngineToolIdsFn: async () => null });
    expect(exitCode).toBe(1);
    expect(run.error.code).toBe('BAD_ARGS');
    expect(run.error.message).toContain('could not be validated');
    expect(launchers.calls).toHaveLength(0);
  });

  test('a local tool with the run dir INSIDE the project is refused (spec §4 run-directory placement)', async () => {
    const launchers = launchersFor();
    const { exitCode, run } = await runCouncil(base({ tools: ['read'] }), { launchers, listEngineToolIdsFn: async () => ['read'] });
    expect(exitCode).toBe(1);
    expect(run.error.code).toBe('BAD_ARGS');
    expect(run.error.message).toContain('OUTSIDE the project tree');
    expect(launchers.calls).toHaveLength(0);
  });

  test('a local tool with the run dir outside the project: seats are scoped to the project tree, metadata stays in the run dir', async () => {
    const project = path.join(tmp, 'tree'); fs.mkdirSync(project);
    const outside = path.join(tmp, 'run-outside'); fs.mkdirSync(outside);
    const launchers = launchersFor();
    const { exitCode } = await runCouncil(base({ project, runDir: outside, tools: ['read'] }), { launchers, listEngineToolIdsFn: async () => ['read', 'webfetch'] });
    expect(exitCode).toBe(0);
    const s1 = stage1(launchers.calls);
    expect(s1.role).toBe('seat');
    expect(s1.directory).toBe(project);
    expect(s1.project).toBe(outside);
    expect(s1.prompt).toContain('Your tools: read. You have no others; if research is incomplete');
    expect(others(launchers.calls).every((c) => c.directory === undefined)).toBe(true);
    expect(runState.readRun(outside).seatTools).toEqual(['read']);
  });

  test('--agent Build skips the council agents and records the override', async () => {
    const launchers = launchersFor();
    const { exitCode } = await runCouncil(base({ agent: 'Build', tools: ['task'] }), { launchers });
    expect(exitCode).toBe(0); // no refusal: the override is the escape hatch
    expect(runState.readRun(runDir).agentOverride).toBe('Build');
  });
});
