// tests/council/run-tools.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runCouncil } = require('../../src/council/run');
const { validateSeatToolsAgainstEngine } = require('../../src/council/run-seat-tools');
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
// v4.9 W7: happyScript's chair speaks review mode ('VERDICT:'); a task run
// needs an 'ANSWER:' terminal line or it buys an unscripted repair wave
// (identical rationale to tests/council/run-intent.test.js's own taskChair).
const taskLaunchersFor = () => fakes.scriptedLaunchers({
  ...fakes.happyScript('r1'),
  'r1-ch1': () => fakes.okWave([fakes.mkLeg('deepseek', 'Synthesis.\n\nANSWER: Converged', 'complete', 0.03)]),
});
const stage1 = (calls) => calls.filter((c) => c.waveId === 'r1-s1')[0];
const others = (calls) => calls.filter((c) => c.waveId !== 'r1-s1');
// Ruling P2-R33: a MINIMAL clean rendering for an arbitrary tool grant — one
// allow per granted id after the wildcard deny, nothing else non-deny. Every
// other engine default (the `.env` denies, doom_loop, external_directory
// noise, …) is either all-deny (inert to verifyAgentRendering's step (b)) or
// filtered out already — see run-seat-tools-verify.test.js for that pin.
// Tests that set an explicit --tools and expect exit 0 need this alongside
// listEngineToolIdsFn now that the tripwire runs unconditionally too.
const listEngineAgentsFnFor = (tools = []) => async () => ([
  { name: 'council-seat', permission: [
    { permission: '*', pattern: '*', action: 'deny' },
    ...tools.map((id) => ({ permission: id, pattern: '*', action: 'allow' })),
  ] },
  { name: 'council-support', permission: [{ permission: '*', pattern: '*', action: 'deny' }] },
]);

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

  // A2: a non-array `tools` (e.g. a bare string a direct caller passed instead
  // of an array) is refused before resolveSeatTools ever sees it.
  test('a non-array tools value is BAD_ARGS before anything launches (A2)', async () => {
    const launchers = launchersFor();
    const { exitCode, run } = await runCouncil(base({ tools: 'read' }), { launchers });
    expect(exitCode).toBe(1);
    expect(run.error.code).toBe('BAD_ARGS');
    expect(run.error.message).toContain('tools must be an array');
    expect(launchers.calls).toHaveLength(0);
  });

  // A3 (ruling P2-R28, supersedes P2-R25): --tools and --agent are refused
  // together on every door, runCouncil included.
  test('--agent with a non-empty --tools is BAD_ARGS: they cannot be combined (A3)', async () => {
    const launchers = launchersFor();
    const { exitCode, run } = await runCouncil(base({ agent: 'Build', tools: ['task'] }), { launchers });
    expect(exitCode).toBe(1);
    expect(run.error.code).toBe('BAD_ARGS');
    expect(run.error.message).toContain('cannot be combined');
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

  // D4 (ruling P2-R30): the engine check now runs for the intent's DEFAULT
  // too, not only an explicit opt-in — a task run is never launched against
  // an engine that does not actually declare `webfetch`.
  test('D4: a task-intent default (no --tools) is validated too — refused when the engine lacks webfetch', async () => {
    const launchers = launchersFor();
    const { exitCode, run } = await runCouncil(
      base({ intent: 'task' }), { launchers, listEngineToolIdsFn: async () => ['read'] });
    expect(exitCode).toBe(1);
    expect(run.error.code).toBe('BAD_ARGS');
    expect(run.error.message).toContain('webfetch');
    expect(launchers.calls).toHaveLength(0);
  });

  // D4, other half: a defaults-only run degrades QUIETLY when the engine
  // cannot be asked at all — nobody opted into that check. Needs the
  // task-shaped chair fixture (see taskLaunchersFor) to reach exit 0 at all.
  test('D4: a task-intent default degrades quietly when the engine cannot be asked at all', async () => {
    const launchers = taskLaunchersFor();
    const { exitCode } = await runCouncil(
      base({ intent: 'task' }), { launchers, listEngineToolIdsFn: async () => null });
    expect(exitCode).toBe(0);
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
    const { exitCode } = await runCouncil(base({ project, runDir: outside, tools: ['read'] }),
      { launchers, listEngineToolIdsFn: async () => ['read', 'webfetch'], listEngineAgentsFn: listEngineAgentsFnFor(['read']) });
    expect(exitCode).toBe(0);
    const s1 = stage1(launchers.calls);
    expect(s1.role).toBe('seat');
    expect(s1.directory).toBe(project);
    expect(s1.project).toBe(outside);
    expect(s1.prompt).toContain('Your tools: read. You have no others; if research is incomplete');
    expect(others(launchers.calls).every((c) => c.directory === undefined)).toBe(true);
    expect(runState.readRun(outside).seatTools).toEqual(['read']);
  });

  // A3 supersedes the old fixture here: --tools + --agent together now refuse
  // (see the "cannot be combined" test above), so this pin drops `tools`
  // entirely — the override still has to work with none.
  test('--agent Build skips the council agents and records the override', async () => {
    const launchers = launchersFor();
    const { exitCode } = await runCouncil(base({ agent: 'Build' }), { launchers });
    expect(exitCode).toBe(0); // no refusal: the override is the escape hatch
    expect(runState.readRun(runDir).agentOverride).toBe('Build');
  });

  // Re-review nit: dropping `tools` from the test above (A3) left
  // preflightSeatTools's `o.agent ? { ok: true, tools: [], local: false } :
  // resolveSeatTools(...)` short-circuit with no pin at all — under review
  // intent BOTH branches give `tools: []`, so nothing here could tell a real
  // short-circuit from an unconditional resolveSeatTools call. Only a
  // task-intent run can: resolveSeatTools's task default is `['webfetch']`,
  // which the short-circuit must never pick up. Uses taskLaunchersFor (see
  // its own comment above) because this run must reach exit 0.
  test('--agent Build short-circuits resolveSeatTools even under task intent: no webfetch default picked up', async () => {
    const launchers = taskLaunchersFor();
    const { exitCode } = await runCouncil(base({ agent: 'Build', intent: 'task' }), { launchers });
    expect(exitCode).toBe(0);
    expect(runState.readRun(runDir).seatTools).toBeUndefined();
    expect(runState.readRun(runDir).agentOverride).toBe('Build');
  });

  // B1/D1 (ruling P2-R31): under --agent there is no computed allowlist, so
  // the seat briefing — live AND the one persisted for auditability — carries
  // the override sentence instead of a tools-based one.
  test('--agent Build: the stage-1 briefing carries the override sentence, persisted too (D1)', async () => {
    const launchers = launchersFor();
    await runCouncil(base({ agent: 'Build' }), { launchers });
    expect(stage1(launchers.calls).prompt).toContain("You run as the engine's Build agent");
    const persisted = fs.readFileSync(path.join(runDir, 'briefing-stage1.md'), 'utf-8');
    expect(persisted).toContain("You run as the engine's Build agent");
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
      base({ agent: null, tools: ['webfetch'] }),
      { launchers, listEngineToolIdsFn: async () => ['webfetch'], listEngineAgentsFn: listEngineAgentsFnFor(['webfetch']) });
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

  // C5 (ruling P2-R35): the placement refusal names the ids THIS run classed
  // local, not a fixed example list — a typo'd id (e.g. `webfetsh`, meant to
  // be `webfetch`) is classed local by the same not-explicitly-remote rule
  // (isLocal), and naming it is what makes the typo visible.
  test('preflightSeatTools placement refusal names the ids it classed local, typo included (C5)', () => {
    const { preflightSeatTools } = require('../../src/council/run-seat-tools');
    const res = preflightSeatTools({ tools: ['webfetsh'], runDir: tmp, project: tmp });
    expect(res.error).not.toBeNull();
    expect(res.error.code).toBe('BAD_ARGS');
    expect(res.error.message).toContain('webfetsh');
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

// Ruling P2-R33 (council #247 round 2, C1): after registration, the run reads
// back what the engine actually rendered for council-seat/council-support
// (`listEngineAgentsFn`, mirroring the existing `listEngineToolIdsFn` seam)
// and refuses before any launch if a tree-supplied opencode.json/.opencode
// agent widened one of them. verifyAgentRendering's own pins live in
// run-seat-tools-verify.test.js; the real engine's rendering is pinned in
// tests/council-agents-engine.integration.test.js. Named mutant TRIPWIREOFF
// at the `if (o.councilAgents)` call in validateSeatToolsAgainstEngine:
// skipping the whole block reddens every "not ok" test below (nothing left
// to refuse the attack) while leaving every "ok" test green — the class of
// bug a tripwire that never fires produces.
describe('runCouncil engine-rendering tripwire (ruling P2-R33)', () => {
  const cleanNoTools = () => [
    { permission: '*', pattern: '*', action: 'deny' },
    { permission: 'edit', pattern: '*', action: 'deny' },
    { permission: 'bash', pattern: '*', action: 'deny' },
    { permission: 'webfetch', pattern: '*', action: 'deny' },
  ];
  const supportAttack = () => [
    { permission: '*', pattern: '*', action: 'deny' },
    { permission: 'task', pattern: '*', action: 'allow' },
    { permission: 'edit', pattern: '*', action: 'deny' },
    { permission: 'bash', pattern: '*', action: 'deny' },
    { permission: 'webfetch', pattern: '*', action: 'deny' },
  ];
  const relistAttack = () => [
    { permission: 'bash', pattern: '*', action: 'deny' },
    { permission: 'read', pattern: '*', action: 'allow' },
    { permission: 'read', pattern: '*.env', action: 'deny' },
    { permission: 'read', pattern: '*.env.*', action: 'deny' },
    { permission: 'external_directory', pattern: '*', action: 'deny' },
    { permission: '*', pattern: '*', action: 'deny' },
    { permission: 'webfetch', pattern: '*', action: 'allow' },
    { permission: 'edit', pattern: '*', action: 'deny' },
  ];

  // Ruling P2-R38 (B1, round 3): `canVerify` gates the whole block. Injected
  // launchers with NO lister means no real server to ask AND the launchers
  // are this test's own transport — verification is skipped, not judged
  // against a null it could never resolve. An explicit non-empty --tools is
  // used here specifically so a wrongly-verifying implementation would
  // refuse (pre-P2-R38 behaviour): a defaults-only run alone cannot tell a
  // genuine skip apart from the old degrade-and-continue path.
  test('launchers injected with no lister: agent verification is skipped, the run proceeds', async () => {
    const launchers = launchersFor();
    const { exitCode } = await runCouncil(
      base({ tools: ['webfetch'] }), { launchers, listEngineToolIdsFn: async () => ['webfetch'] });
    expect(exitCode).toBe(0);
    expect(stage1(launchers.calls).role).toBe('seat');
  });

  test('a clean engine rendering is verified ok: exit 0, the seat wave launches', async () => {
    const launchers = launchersFor();
    const listEngineAgentsFn = async () => ([
      { name: 'council-seat', permission: cleanNoTools() },
      { name: 'council-support', permission: cleanNoTools() },
    ]);
    const { exitCode } = await runCouncil(base(), { launchers, listEngineAgentsFn });
    expect(exitCode).toBe(0);
    expect(stage1(launchers.calls).role).toBe('seat');
  });

  test('a tree-widened council-support is refused before any launch, naming task', async () => {
    const launchers = launchersFor();
    const listEngineAgentsFn = async () => ([
      { name: 'council-seat', permission: cleanNoTools() },
      { name: 'council-support', permission: supportAttack() },
    ]);
    const { exitCode, run } = await runCouncil(base(), { launchers, listEngineAgentsFn });
    expect(exitCode).toBe(1);
    expect(run.error.code).toBe('BAD_ARGS');
    expect(run.error.message).toContain('rendered the council agents differently');
    expect(run.error.message).toContain('task');
    expect(launchers.calls).toHaveLength(0);
  });

  test('a tree that re-lists a granted tool is refused, naming it', async () => {
    const project = path.join(tmp, 'tree-p2r33'); fs.mkdirSync(project);
    const outside = path.join(tmp, 'run-outside-p2r33'); fs.mkdirSync(outside);
    const launchers = launchersFor();
    const listEngineAgentsFn = async () => ([
      { name: 'council-seat', permission: relistAttack() },
      { name: 'council-support', permission: cleanNoTools() },
    ]);
    const { exitCode, run } = await runCouncil(
      base({ project, runDir: outside, tools: ['read', 'webfetch'] }),
      { launchers, listEngineToolIdsFn: async () => ['read', 'webfetch'], listEngineAgentsFn });
    expect(exitCode).toBe(1);
    expect(run.error.code).toBe('BAD_ARGS');
    expect(run.error.message).toContain('rendered the council agents differently');
    expect(run.error.message).toContain('read');
    expect(launchers.calls).toHaveLength(0);
  });

  // Ruling P2-R39 (A1, round 3): the support legs (judges, debate, chair) run
  // with `project: <runDir>/_scratch`, so the verified directory set must
  // include it — an attacker's opencode.json sitting ONLY there would
  // otherwise render clean at `o.runDir` and reach a support leg unverified.
  test('the verified directories include _scratch (and the project tree when local)', async () => {
    const project = path.join(tmp, 'tree-scratch'); fs.mkdirSync(project);
    const outside = path.join(tmp, 'run-outside-scratch'); fs.mkdirSync(outside);
    const seen = [];
    const launchers = launchersFor();
    const listEngineAgentsFn = async (shared, dir) => {
      seen.push(dir);
      return [
        { name: 'council-seat', permission: [{ permission: '*', pattern: '*', action: 'deny' },
          { permission: 'read', pattern: '*', action: 'allow' }] },
        { name: 'council-support', permission: cleanNoTools() },
      ];
    };
    const { exitCode } = await runCouncil(base({ project, runDir: outside, tools: ['read'] }),
      { launchers, listEngineToolIdsFn: async () => ['read'], listEngineAgentsFn });
    expect(exitCode).toBe(0);
    expect(seen).toEqual(expect.arrayContaining([outside, path.join(outside, '_scratch'), project]));
  });

  test('an attack rendering returned ONLY for the _scratch directory is refused (P2-R39)', async () => {
    const launchers = launchersFor();
    const seen = [];
    const listEngineAgentsFn = async (shared, dir) => {
      seen.push(dir);
      if (dir.endsWith('_scratch')) {
        return [
          { name: 'council-seat', permission: cleanNoTools() },
          { name: 'council-support', permission: supportAttack() },
        ];
      }
      return [
        { name: 'council-seat', permission: cleanNoTools() },
        { name: 'council-support', permission: cleanNoTools() },
      ];
    };
    const { exitCode, run } = await runCouncil(base(), { launchers, listEngineAgentsFn });
    expect(exitCode).toBe(1);
    expect(run.error.code).toBe('BAD_ARGS');
    expect(run.error.message).toContain('rendered the council agents differently');
    expect(seen.some((d) => d.endsWith('_scratch'))).toBe(true);
    expect(launchers.calls).toHaveLength(0);
  });

  test('an unverifiable engine (null) with an explicit --tools opt-in refuses before any launch', async () => {
    const launchers = launchersFor();
    const { exitCode, run } = await runCouncil(base({ tools: ['webfetch'] }),
      { launchers, listEngineToolIdsFn: async () => ['webfetch'], listEngineAgentsFn: async () => null });
    expect(exitCode).toBe(1);
    expect(run.error.code).toBe('BAD_ARGS');
    expect(run.error.message).toContain('could not be verified');
    expect(launchers.calls).toHaveLength(0);
  });

  // Ruling P2-R38 (B1, round 3): REPLACES the old "null + defaults only
  // degrades quietly and continues" test — a defaults-only run is now
  // refused exactly like an explicit opt-in whenever verification can run
  // but the engine answers with no agent list at all.
  test('an unverifiable engine (null) with defaults only now refuses before any launch too', async () => {
    const launchers = launchersFor();
    const { exitCode, run } = await runCouncil(base(), { launchers, listEngineAgentsFn: async () => null });
    expect(exitCode).toBe(1);
    expect(run.error.code).toBe('BAD_ARGS');
    expect(run.error.message).toContain('could not be verified');
    expect(run.error.message).toContain('no shared server was available');
    expect(launchers.calls).toHaveLength(0);
  });

  // Ruling P2-R36 (wording) / P2-R38 (round 3, now a refusal not a note): the
  // message's `<why>` must tell the two null-agent-list causes apart.
  // `launchers` is injected everywhere else in this file, which
  // short-circuits acquireRunServer (run.js) and leaves `sharedServer` null —
  // so covering the OTHER wording needs a direct call through the seam
  // (validateSeatToolsAgainstEngine itself) with a truthy sharedServer stub.
  test('a truthy shared server with no agent list refuses, naming a different reason than no server at all', async () => {
    const o = { tools: [], seatTools: [], seatToolsLocal: false, councilAgents: {}, runDir, project: tmp };
    const result = await validateSeatToolsAgainstEngine(o, { serverClient: {} }, {
      listEngineAgentsFn: async () => null,
    });
    expect(result.error).not.toBeNull();
    expect(result.error.code).toBe('BAD_ARGS');
    expect(result.error.message).toContain('could not be verified');
    expect(result.error.message).toContain('answered without an agent list');
  });
});

// C4 (ruling P2-R35): critic and lens solos are Stage-1 legs like the seat
// wave — launchStage1's `common` object (run-stage1-launch.js) sets
// `role: 'seat'` on every Stage-1 launch, seat wave, critic solo and lens
// solos alike. Driven through the REAL createLaunchers (not the scripted
// fake) so the agent-name resolution in run-launch.js actually runs — the
// scripted fake only ever records `role`, never resolves it to an agent name.
describe('C4: critic and lens solos launch as council-seat', () => {
  const { createLaunchers } = require('../../src/council/run-launch');
  const { buildCouncilAgents } = require('../../src/council/seat-tools');

  // The scripted fake records opts VERBATIM (fake-launchers.js :: scriptedLaunchers),
  // so `role` — consumed by the real createLaunchers to pick the agent NAME,
  // never forwarded to the transport — is directly observable here.
  test('critic run: the seat wave and the critic solo both carry role seat', async () => {
    const launchers = fakes.scriptedLaunchers({ 'r1-s1': () => fakes.okWave([]), 'r1-c1': () => fakes.okWave([]) });
    await runCouncil(base({ critic: 'qwen' }), { launchers });
    const calls = launchers.calls.filter((c) => c.waveId === 'r1-s1' || c.waveId === 'r1-c1');
    expect(calls).toHaveLength(2);
    for (const c of calls) { expect(c.role).toBe('seat'); }
  });

  test('lens run: every lens solo carries role seat', async () => {
    const launchers = fakes.scriptedLaunchers({ 'r1-l1': () => fakes.okWave([]), 'r1-l2': () => fakes.okWave([]) });
    await runCouncil(base({ models: ['gemini', 'gpt'], critic: null, lenses: ['growth-stage VC', 'security architect'] }), { launchers });
    const calls = launchers.calls.filter((c) => c.waveId === 'r1-l1' || c.waveId === 'r1-l2');
    expect(calls).toHaveLength(2);
    for (const c of calls) { expect(c.role).toBe('seat'); }
  });

  // Through the launcher DI where the test CAN reach the resolution: the real
  // createLaunchers (not the scripted fake) so run-launch.js's `opts.role ===
  // 'seat' ? 'council-seat' : 'council-support'` actually runs.
  test('critic run, through the real createLaunchers: the seat wave and the critic solo resolve to council-seat', async () => {
    const seen = [];
    const fanoutFn = async (opts) => { seen.push(opts); return { wave: { status: 'complete', legs: [] }, exitCode: 0 }; };
    const agents = buildCouncilAgents({ tools: [], local: false });
    const launchers = createLaunchers({ fanoutFn, councilAgents: () => agents });
    await runCouncil(base({ critic: 'qwen' }), { launchers });
    const s1Calls = seen.filter((o) => o.waveId === 'r1-s1' || o.waveId === 'r1-c1');
    expect(s1Calls).toHaveLength(2);
    for (const c of s1Calls) { expect(c.agent).toBe('council-seat'); }
  });

  test('lens run, through the real createLaunchers: every lens solo resolves to council-seat', async () => {
    const seen = [];
    const fanoutFn = async (opts) => { seen.push(opts); return { wave: { status: 'complete', legs: [] }, exitCode: 0 }; };
    const agents = buildCouncilAgents({ tools: [], local: false });
    const launchers = createLaunchers({ fanoutFn, councilAgents: () => agents });
    await runCouncil(base({ models: ['gemini', 'gpt'], critic: null, lenses: ['growth-stage VC', 'security architect'] }), { launchers });
    const lensCalls = seen.filter((o) => o.waveId === 'r1-l1' || o.waveId === 'r1-l2');
    expect(lensCalls).toHaveLength(2);
    for (const c of lensCalls) { expect(c.agent).toBe('council-seat'); }
  });
});
