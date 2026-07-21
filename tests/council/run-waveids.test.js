// tests/council/run-waveids.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { runCouncil } = require('../../src/council/run');
const runState = require('../../src/council/run-state');
const { scriptedLaunchers, happyScript, baseOptions, mkLeg, okWave, review } =
  require('./helpers/fake-launchers');

// runCouncil records its OWN pid in run.json, so an in-process abortCouncilRun
// would waitThenKill this jest worker. Stub just that call (session-utils needs
// the module's other exports) — these tests assert the per-leg cascade, which
// is the behaviour that must work WITHOUT the process-tree fallback.
jest.mock('../../src/utils/abort-coordinator', () => ({
  ...jest.requireActual('../../src/utils/abort-coordinator'),
  waitThenKill: jest.fn(() => Promise.resolve()),
}));

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'council-waveids-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const noSignals = () => () => {};
const runDir = () => path.join(tmp, 'council-abc123');
/** Read one stage entry out of run.json AS IT STANDS RIGHT NOW (mid-run). */
const stageOf = (name) => {
  const run = runState.readRun(runDir()) || {};
  return (run.stages || []).find(s => s.name === name) || null;
};
const deps = (launchers, statsFn = () => []) => ({
  launchers, appendRunFn: jest.fn(), statsFn, installSignalAbortFn: noSignals,
});

describe('stage entries record every sub-wave they launch (abort-cascade targeting)', () => {
  test('chair stage carries its in-flight sub-wave id while the chair is running', async () => {
    const script = happyScript();
    let midFlight = null;
    script['abc123-ch1'] = () => {
      midFlight = stageOf('chair');   // observed from inside the launch
      return okWave([mkLeg('deepseek', 'Synthesis.\nVERDICT: Ship it', 'complete', 0.03)]);
    };
    const { exitCode } = await runCouncil(baseOptions(tmp), deps(scriptedLaunchers(script)));

    expect(exitCode).toBe(0);
    expect(midFlight).not.toBeNull();
    expect(midFlight.status).toBe('running');
    expect(midFlight.project).toBe(runDir());
    expect(midFlight.waveIds).toContain('abc123-ch1');
  });

  test('a retried chair records the retry sub-wave too', async () => {
    const script = happyScript();
    script['abc123-ch1'] = () => okWave([mkLeg('deepseek', '', 'error')], 1, 'error');
    let midFlight = null;
    script['abc123-ch2'] = () => {
      midFlight = stageOf('chair');
      return okWave([mkLeg('deepseek', 'Synthesis.\nVERDICT: Ship it', 'complete', 0.03)]);
    };
    const { exitCode } = await runCouncil(baseOptions(tmp), deps(scriptedLaunchers(script)));

    expect(exitCode).toBe(0);
    expect(midFlight.waveIds).toEqual(['abc123-ch1', 'abc123-ch2']);
  });

  test('critic solo is recorded on stage1 alongside the seat wave', async () => {
    const script = happyScript();
    let seenAtLaunch = null;
    script['abc123-c1'] = (opts) => {
      seenAtLaunch = (stageOf('stage1') || {}).waveIds;
      return okWave([mkLeg(opts.model, review(opts.model))]);
    };
    const { exitCode } = await runCouncil(
      baseOptions(tmp, { critic: 'qwen' }), deps(scriptedLaunchers(script)));

    expect(exitCode).toBe(0);
    expect(seenAtLaunch).toContain('abc123-c1');   // targetable while in flight
    expect(stageOf('stage1').waveIds).toEqual(['abc123-s1', 'abc123-c1']);
  });

  test('lens solos are recorded on stage1 (the -s1 seat wave never launches)', async () => {
    const seen = {};
    const script = happyScript();
    delete script['abc123-s1'];   // lens mode launches one solo per seat instead
    ['gemini', 'gpt', 'qwen'].forEach((m, i) => {
      script[`abc123-l${i + 1}`] = (opts) => {
        seen[opts.waveId] = (stageOf('stage1') || {}).waveIds;
        return okWave([mkLeg(opts.model, review(opts.model))]);
      };
    });
    const { exitCode } = await runCouncil(
      baseOptions(tmp, { lenses: ['security', 'performance', 'ux'] }),
      deps(scriptedLaunchers(script)));

    expect(exitCode).toBe(0);
    // Each lens leg must be targetable the moment it is in flight — before the
    // fix, stage1 advertised only the phantom `-s1` and the cascade found nothing.
    expect(seen['abc123-l1']).toContain('abc123-l1');
    expect(seen['abc123-l2']).toContain('abc123-l2');
    expect(seen['abc123-l3']).toContain('abc123-l3');
    expect(stageOf('stage1').waveIds).toEqual(['abc123-l1', 'abc123-l2', 'abc123-l3']);
  });

  test('lens mode does not advertise a phantom -s1 seat wave', async () => {
    const script = happyScript();
    delete script['abc123-s1'];
    ['gemini', 'gpt', 'qwen'].forEach((m, i) => {
      script[`abc123-l${i + 1}`] = (opts) => okWave([mkLeg(opts.model, review(opts.model))]);
    });
    const { exitCode } = await runCouncil(
      baseOptions(tmp, { lenses: ['security', 'performance', 'ux'] }),
      deps(scriptedLaunchers(script)));

    expect(exitCode).toBe(0);
    // `-s1` is never launched in lens mode; advertising it made every consumer
    // (abort cascade, status leg rollup) chase a wave that does not exist.
    expect(stageOf('stage1').waveId).toBeUndefined();
  });

  test('non-lens mode still records the -s1 seat wave as the primary waveId', async () => {
    const { exitCode } = await runCouncil(
      baseOptions(tmp), deps(scriptedLaunchers(happyScript())));

    expect(exitCode).toBe(0);
    expect(stageOf('stage1').waveId).toBe('abc123-s1');
  });
});

/** Stand up the wave+leg session records the real launcher would have created. */
function seedWaveOnDisk(project, waveId) {
  const dir = (id) => path.join(project, '.claude', 'amicus_sessions', id);
  fs.mkdirSync(dir(waveId), { recursive: true });
  fs.mkdirSync(dir(`${waveId}-1`), { recursive: true });
  fs.writeFileSync(path.join(dir(waveId), 'metadata.json'), JSON.stringify({
    taskId: waveId, type: 'wave', status: 'running', legs: [`${waveId}-1`],
  }));
  fs.writeFileSync(path.join(dir(`${waveId}-1`), 'metadata.json'), JSON.stringify({
    taskId: `${waveId}-1`, status: 'running',
  }));
  return dir(`${waveId}-1`);
}

describe('full loop: engine-written run.json is abortable per leg', () => {
  test('aborting mid-chair marks the live chair leg, not just the process tree', async () => {
    const { abortCouncilRun } = require('../../src/mcp-council-run');
    const { waitThenKill } = require('../../src/utils/abort-coordinator');
    const script = happyScript();
    let outcome = null; let legDir = null;
    script['abc123-ch1'] = (opts) => {
      legDir = seedWaveOnDisk(runDir(), opts.waveId);
      outcome = abortCouncilRun(tmp, 'abc123');   // external `amicus abort`
      return okWave([mkLeg('deepseek', 'Synthesis.\nVERDICT: Ship it', 'complete', 0.03)]);
    };
    await runCouncil(baseOptions(tmp), deps(scriptedLaunchers(script)));

    expect(outcome).toEqual({ aborted: true, cascaded: 1 });
    expect(JSON.parse(fs.readFileSync(path.join(legDir, 'metadata.json'), 'utf-8')).status)
      .toBe('aborted');
    expect(runState.readRun(runDir()).status).toBe('aborted');   // abort-wins survives finalize
    expect(waitThenKill).toHaveBeenCalled();   // fallback still armed — just not what marked the leg
  });
});
