// tests/council/run-stage1-task-dispatch.test.js
'use strict';

// v4.9 W6 Task B — end-to-end dispatch pins. Every Stage-1 dispatch site forks
// on `o.intent` ('task' | absent): the -s1 seat wave, the critic solo, the lens
// solos (run-stage1-launch.js), the retry re-brief (run-retry-launch.js ::
// briefingFor — the spec's "a retried task seat is re-briefed as a reviewer"
// failure), the persisted briefing-stage1.md (run.js), and the findings-repair
// solo (run-stages.js). A review run stays byte-identical to the review
// builders at every one of those surfaces. Drives the REAL modules with
// stubbed launchers — house style from run-stage1-launch.test.js and
// run-happy.test.js.
//
// Named mutant "TASKFRAMEDROP": in briefings.js make stage1SeatBriefing ignore
// intent (`return buildSeatBriefing(args);` unconditionally). MEASURED
// 2026-08-25 (--maxWorkers=2, this suite + briefings-task/run-stage1-launch/
// run-retry-launch/run-happy/run-stages/run-retry/briefings — 250 tests):
// 4 RED in 2 suites. THIS file 3 — "task run: the -s1 wave and the critic solo
// compose the TASK frames" (the seat assertion; the critic dispatcher is not
// this mutant's), "task retry re-brief: all three briefingFor branches compose
// the TASK frames", "task run-dir: briefing-stage1.md IS the composed task
// seat brief…". briefings-task.test.js 1 — "intent 'task' → byte-identical to
// the task builders". The lens/repair task pins and every review-byte-identity
// pin stayed green (246 of 250). Reverted byte-exact (sha256-verified).

const fs = require('fs');
const path = require('path');
const os = require('os');
const { launchStage1 } = require('../../src/council/run-stage1-launch');
const { briefingFor } = require('../../src/council/run-retry-launch');
const { runCouncil } = require('../../src/council/run');
const briefings = require('../../src/council/briefings');
const task = require('../../src/council/briefings-task');
const { scriptedLaunchers, happyScript, baseOptions, mkLeg, okWave, review } =
  require('./helpers/fake-launchers');

// PRODUCTION contract: src/sidecar/list-search.js:14 splits briefing-stage1.md
// on this exact string (the constant is not exported from list-search).
const SEPARATOR = '--- MATERIAL / BRIEFING ---';

const ARGS = { briefing: 'B', date: 'D' };
const noSignals = () => () => {};

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'council-task-dispatch-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

/** Drive the real launchStage1 with capture-only launchers; return recorded calls. */
async function driveStage1(o) {
  const calls = [];
  const launchers = {
    launchWave: async (opts) => { calls.push(opts); return { wave: { legs: [] }, exitCode: 0 }; },
    launchSolo: async (opts) => { calls.push(opts); return { wave: { legs: [] }, exitCode: 0, leg: null }; },
  };
  await launchStage1({ o, launchers, addWave() {} });
  return calls;
}

describe('launchStage1 dispatches on o.intent (v4.9 W6 Task B)', () => {
  test('task run: the -s1 wave and the critic solo compose the TASK frames', async () => {
    const o = { runId: 'r1', runDir: tmp, models: ['a', 'b', 'c'], critic: 'c',
      lenses: null, intent: 'task', ...ARGS };
    const calls = await driveStage1(o);
    expect(calls.find(c => c.waveId === 'r1-s1').prompt).toBe(task.buildTaskSeatBriefing(ARGS));
    expect(calls.find(c => c.waveId === 'r1-c1').prompt).toBe(task.buildTaskCriticBriefing(ARGS));
  });

  test('task run: every lens solo composes the TASK lens frame', async () => {
    const o = { runId: 'r1', runDir: tmp, models: ['a', 'b'], critic: null,
      lenses: ['growth-stage VC', 'security architect'], intent: 'task', ...ARGS };
    const calls = await driveStage1(o);
    expect(calls.find(c => c.waveId === 'r1-l1').prompt)
      .toBe(task.buildTaskLensBriefing({ lens: 'growth-stage VC', ...ARGS }));
    expect(calls.find(c => c.waveId === 'r1-l2').prompt)
      .toBe(task.buildTaskLensBriefing({ lens: 'security architect', ...ARGS }));
  });

  test('review run (intent absent): all three dispatch sites byte-equal the review builders (pre-W6 fixture)', async () => {
    const o = { runId: 'r1', runDir: tmp, models: ['a', 'b', 'c'], critic: 'c',
      lenses: null, ...ARGS };
    const calls = await driveStage1(o);
    expect(calls.find(c => c.waveId === 'r1-s1').prompt).toBe(briefings.buildSeatBriefing(ARGS));
    expect(calls.find(c => c.waveId === 'r1-c1').prompt).toBe(briefings.buildCriticBriefing(ARGS));
    const lensed = { runId: 'r2', runDir: tmp, models: ['a'], critic: null,
      lenses: ['security architect'], ...ARGS };
    const lensCalls = await driveStage1(lensed);
    expect(lensCalls.find(c => c.waveId === 'r2-l1').prompt)
      .toBe(briefings.buildLensBriefing({ lens: 'security architect', ...ARGS }));
  });
});

describe('briefingFor (retry re-brief) threads o.intent into all THREE branches', () => {
  // The spec's named failure: a retried task seat re-briefed as a REVIEWER.
  // RED-first: written against the un-threaded briefingFor, which composed
  // review text for every task unit below.
  const o = { intent: 'task', lenses: ['growth-stage VC'], ...ARGS };

  test('task retry re-brief: all three briefingFor branches compose the TASK frames', () => {
    expect(briefingFor(o, { unit: 'critic' })).toBe(task.buildTaskCriticBriefing(ARGS));
    expect(briefingFor(o, { unit: 'lens', lensIndex: 1 }))
      .toBe(task.buildTaskLensBriefing({ lens: 'growth-stage VC', ...ARGS }));
    expect(briefingFor(o, { unit: 'seat' })).toBe(task.buildTaskSeatBriefing(ARGS));
  });

  test('review retry re-brief (intent absent): all three branches byte-equal the review builders', () => {
    const r = { lenses: ['growth-stage VC'], ...ARGS };
    expect(briefingFor(r, { unit: 'critic' })).toBe(briefings.buildCriticBriefing(ARGS));
    expect(briefingFor(r, { unit: 'lens', lensIndex: 1 }))
      .toBe(briefings.buildLensBriefing({ lens: 'growth-stage VC', ...ARGS }));
    expect(briefingFor(r, { unit: 'seat' })).toBe(briefings.buildSeatBriefing(ARGS));
  });
});

describe('runCouncil end to end: briefing-stage1.md + the repair solo fork on intent', () => {
  // gemini's Stage-1 leg carries an INVALID severity so the findings-repair
  // solo (abc123-p1) actually launches; the repair returns a clean review and
  // the run completes. countAttemptedFindings sees 1 before and after (LC-11).
  const badGemini = 'Prose gemini.\n\n```json\n' + JSON.stringify({
    overall: 'take',
    findings: [{ id: 1, severity: 'high', claim: 'claim-gemini', location: 'loc', rationale: 'why' }],
  }) + '\n```\n';

  function repairScript() {
    const script = happyScript();
    const s1 = script['abc123-s1'];
    script['abc123-s1'] = (opts) => {
      const w = s1(opts);
      w.wave.legs.find(l => l.modelInput === 'gemini').summary = badGemini;
      return w;
    };
    script['abc123-p1'] = () => okWave([mkLeg('gemini', review('gemini'))]);
    return script;
  }

  test('task run-dir: briefing-stage1.md IS the composed task seat brief and still splits on the separator', async () => {
    const opts = baseOptions(tmp, { intent: 'task' });
    const launchers = scriptedLaunchers(happyScript());
    const result = await runCouncil(opts, {
      launchers, appendRunFn: () => {}, statsFn: () => [], installSignalAbortFn: noSignals,
    });
    expect(result.exitCode).toBe(0);
    const wave = launchers.calls.find(c => c.waveId === 'abc123-s1');
    const expected = task.buildTaskSeatBriefing({ briefing: opts.briefing, date: opts.date });
    expect(wave.prompt).toBe(expected);
    const s1 = fs.readFileSync(path.join(opts.runDir, 'briefing-stage1.md'), 'utf-8');
    expect(s1).toBe(expected);
    // list-search-shape pin: the post-separator slice is the raw material.
    const idx = s1.indexOf(SEPARATOR);
    expect(idx).not.toBe(-1);
    expect(s1.slice(idx + SEPARATOR.length)).toBe('\n\n' + opts.briefing);
  });

  test('task run: the findings-repair solo composes the TASK repair frame', async () => {
    const launchers = scriptedLaunchers(repairScript());
    const result = await runCouncil(baseOptions(tmp, { intent: 'task' }), {
      launchers, appendRunFn: () => {}, statsFn: () => [], installSignalAbortFn: noSignals,
    });
    expect(result.exitCode).toBe(0);
    const p1 = launchers.calls.find(c => c.waveId === 'abc123-p1');
    expect(p1.prompt).toContain('--- YOUR PREVIOUS RESPONSE (verbatim — this is the text to correct) ---');
    expect(p1.prompt).toContain('That response\'s trailing findings JSON failed validation');
    expect(p1.prompt.endsWith(task.TASK_FINDINGS_JSON_SHAPE)).toBe(true);
    expect(p1.prompt).not.toContain('YOUR PREVIOUS REVIEW');
  });

  test('review run stays byte-identical: briefing-stage1.md and the repair solo use the review frames', async () => {
    const launchers = scriptedLaunchers(repairScript());
    const opts = baseOptions(tmp);
    const result = await runCouncil(opts, {
      launchers, appendRunFn: () => {}, statsFn: () => [], installSignalAbortFn: noSignals,
    });
    expect(result.exitCode).toBe(0);
    expect(fs.readFileSync(path.join(opts.runDir, 'briefing-stage1.md'), 'utf-8'))
      .toBe(briefings.buildSeatBriefing({ briefing: opts.briefing, date: opts.date }));
    const p1 = launchers.calls.find(c => c.waveId === 'abc123-p1');
    expect(p1.prompt).toContain('--- YOUR PREVIOUS REVIEW (verbatim — this is the text to correct) ---');
    expect(p1.prompt.endsWith(briefings.FINDINGS_JSON_SHAPE)).toBe(true);
    expect(p1.prompt).not.toContain('YOUR PREVIOUS RESPONSE');
  });
});
