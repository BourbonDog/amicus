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
const launchersFor = () => fakes.scriptedLaunchers(fakes.happyScript('r1'));
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
    expect(runState.readRun(runDir).agentOverride).toBeUndefined(); // emit-when-set
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

  // Review r1 minor: the CLI's house style for an unset option is `agent:
  // null` (run.js's own `o` seed defaults critic/lenses/maxCost/etc. the same
  // way), not an omitted key — `null` must behave exactly like absent, never
  // like an invalid override AND never like `--agent Build`'s skip branch.
  // `--tools webfetch` (a REMOTE id, so no run-directory rule applies) is the
  // discriminator without touching intent: if the guard wrongly rejected null
  // this would exit 1 BAD_ARGS before any launch; if null were wrongly routed
  // through the --agent-override branch, `--tools` would never even be
  // consulted and seatTools would never be recorded — so seeing it recorded,
  // and the run completing 0 through a real (validated) engine check, proves
  // the normal policy ran, i.e. council agents are genuinely in play.
  test('agent: null behaves exactly like no agent (CLI unset-option house style)', async () => {
    const launchers = launchersFor();
    const { exitCode } = await runCouncil(
      base({ agent: null, tools: ['webfetch'] }), { launchers, listEngineToolIdsFn: async () => ['webfetch'] });
    expect(exitCode).toBe(0); // no refusal
    expect(runState.readRun(runDir).seatTools).toEqual(['webfetch']); // the policy ran — council agents are in play
    expect(runState.readRun(runDir).agentOverride).toBeUndefined(); // absent, unlike an explicit override
  });

  // Final review minor (NOPROJECTSCOPE): with a local tool opted in and a
  // falsy o.project, isPathInside(runDir, undefined) is false, so the
  // run-directory placement rule alone would PASS and run-launch.js's
  // directory fallback would silently resolve to the run dir itself — a
  // direct caller (bypassing the CLI's required --project) could scope a
  // seat to the very dir holding its own sibling sessions. Defensive
  // refusal, before any launch.
  // ⚠️ Deviation from the literal brief: the brief's fixture (`project:
  // undefined` driven through runCouncil) cannot reach this guard —
  // runCouncil's OWN initCouncilRun (run-state.js :: writePointer ::
  // pointerPath) does `path.join(project, …)` unconditionally, several
  // lines before preflightSeatTools ever runs, and throws a raw
  // (uncaught) TypeError on a falsy project regardless of --tools. That
  // crash is pre-existing, unrelated to seat tools, and out of scope here.
  // Calling preflightSeatTools directly is the faithful equivalent: it is
  // the exported unit the guard actually lives in, with no engine/server
  // dependency, matching how this module's own docblock describes it
  // ("preflightSeatTools (BEFORE the server): shape + refusals need no
  // engine ... so both are decided, and refused, at ZERO SPEND").
  test('preflightSeatTools refuses a local tool with no project directory (NOPROJECTSCOPE)', () => {
    const { preflightSeatTools } = require('../../src/council/run-seat-tools');
    const outside = path.join(tmp, 'run-outside'); fs.mkdirSync(outside);
    const res = preflightSeatTools({ tools: ['read'], runDir: outside, project: undefined });
    expect(res.error).not.toBeNull();
    expect(res.error.code).toBe('BAD_ARGS');
    expect(res.error.message).toContain('needs a project directory');
  });

  // Pins that the refusal happens in preflightSeatTools, BEFORE
  // acquireRunServer is ever called — startOpenCodeServerFn is the seam
  // acquireRunServer uses (run-server.js :: acquireRunServer). No fake
  // launchers are injected here either, so a false pass-through would have
  // to reach real transport code, not merely a test double.
  test('a refused id is caught before the shared server ever starts (no launchers injected)', async () => {
    const startOpenCodeServerFn = jest.fn();
    const { exitCode, run } = await runCouncil(base({ tools: ['task'] }), { startOpenCodeServerFn });
    expect(exitCode).toBe(1);
    expect(run.error.code).toBe('BAD_ARGS');
    expect(run.error.message).toContain('--agent Build');
    expect(startOpenCodeServerFn).not.toHaveBeenCalled();
  });
});
