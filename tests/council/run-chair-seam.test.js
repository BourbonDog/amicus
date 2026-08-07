// tests/council/run-chair-seam.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const runMod = require('../../src/council/run');
const { runCouncil } = runMod;
const runState = require('../../src/council/run-state');
const { scriptedLaunchers, happyScript, baseOptions, mkLeg, okWave } =
  require('./helpers/fake-launchers');

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'council-chair-seam-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const noSignals = () => () => {};
const runDir = () => path.join(tmp, 'council-abc123');
const deps = (launchers, extra = {}) => ({
  launchers, appendRunFn: jest.fn(), statsFn: () => [],
  installSignalAbortFn: noSignals, ...extra,
});
const chairStage = (run) => ((run && run.stages) || []).find(s => s.name === 'chair') || null;
const readInput = () => JSON.parse(
  fs.readFileSync(path.join(runDir(), 'tally-input.json'), 'utf-8'));

describe('run.js export surface (must survive the extraction)', () => {
  test('runCouncil, pickFallbackChair and SIGNAL_EXIT stay exported from ./run', () => {
    expect(typeof runMod.runCouncil).toBe('function');
    expect(typeof runMod.pickFallbackChair).toBe('function');
    expect(runMod.SIGNAL_EXIT).toEqual({ SIGINT: 130, SIGTERM: 143, SIGBREAK: 143 });
  });
});

describe('chair packet threading + artifacts', () => {
  test('the -ch1 prompt is byte-identical to chair-packet.md; prose + chair name reach the artifacts', async () => {
    const script = happyScript();
    let ch1Prompt = null;
    script['abc123-ch1'] = (opts) => {
      ch1Prompt = opts.prompt;
      return okWave([mkLeg('deepseek', 'Synthesis of the bench.\n\nVERDICT: Ship it', 'complete', 0.03)]);
    };
    const { exitCode } = await runCouncil(baseOptions(tmp), deps(scriptedLaunchers(script)));

    expect(exitCode).toBe(0);
    expect(ch1Prompt).toBe(fs.readFileSync(path.join(runDir(), 'chair-packet.md'), 'utf-8'));
    expect(fs.readFileSync(path.join(runDir(), 'chair-output.md'), 'utf-8'))
      .toContain('Synthesis of the bench.');
    const verdict = JSON.parse(fs.readFileSync(path.join(runDir(), 'verdict.json'), 'utf-8'));
    expect(verdict.chair).toBe('deepseek');
    expect(verdict.overallVerdict).toBe('Ship it');
    expect(readInput().runStats.find(r => r.wasChair))
      .toMatchObject({ model: 'deepseek', role: 'chair', conformance: 'clean' });
  });

  test('every chair launch carries the run options and targets the run dir (never _scratch)', async () => {
    const script = happyScript();
    script['abc123-ch1'] = () => okWave([mkLeg('deepseek', 'Prose, no verdict line.', 'complete', 0.03)]);
    script['abc123-ch4'] = () => okWave([mkLeg('deepseek', 'VERDICT: Ship it')]);
    const launchers = scriptedLaunchers(script);
    await runCouncil(baseOptions(tmp), deps(launchers));

    const chairCalls = launchers.calls.filter(c => /-ch\d$/.test(c.waveId));
    expect(chairCalls.map(c => c.waveId)).toEqual(['abc123-ch1', 'abc123-ch4']);
    for (const c of chairCalls) {
      expect(c.project).toBe(runDir());     // the chair is NOT judge-isolated
      expect(c.timeout).toBe(5);
      expect(c.gateway).toBe('auto');
      expect(c.noValidateModel).toBe(false);
    }
  });
});

describe('abort-cascade registration + degraded propagation across the seam', () => {
  test('the VERDICT repair registers -ch4 on the chair stage BEFORE launching', async () => {
    const script = happyScript();
    script['abc123-ch1'] = () => okWave([mkLeg('deepseek', 'Prose only.', 'complete', 0.03)]);
    let midFlight = null;
    script['abc123-ch4'] = () => {
      midFlight = chairStage(runState.readRun(runDir()));   // observed from inside the launch
      return okWave([mkLeg('deepseek', 'VERDICT: Ship it')]);
    };
    const { exitCode } = await runCouncil(baseOptions(tmp), deps(scriptedLaunchers(script)));

    expect(exitCode).toBe(0);
    expect(midFlight.waveIds).toEqual(['abc123-ch1', 'abc123-ch4']);
    expect(readInput().runStats.find(r => r.wasChair).conformance).toBe('repaired');
  });

  test('a chair give-up degrades to exit 2 but still writes the final tally and ledgers once', async () => {
    const script = happyScript();
    script['abc123-ch1'] = () => okWave([mkLeg('deepseek', '', 'error')], 1, 'error');
    script['abc123-ch2'] = () => okWave([mkLeg('deepseek', '', 'error')], 1, 'error');
    const appendRunFn = jest.fn();
    const { exitCode, run } = await runCouncil(baseOptions(tmp),
      deps(scriptedLaunchers(script), { appendRunFn }));

    expect(exitCode).toBe(2);                       // degraded.value crossed the boundary
    expect(chairStage(run).status).toBe('error');
    expect(appendRunFn).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(path.join(runDir(), 'tally.json'))).toBe(true);
    expect(readInput().runStats.some(r => r.wasChair)).toBe(false);
    expect(runState.readRun(runDir()).chair).toBe('deepseek');  // give-up keeps the requested chair
    // v4.7 D2: give-up still leaves NO wasChair:true row, and now yields
    // exactly one explicit error row for the requested chair so the walk's
    // outcome isn't silently absorbed.
    const rows = readInput().runStats;
    expect(rows.some(r => r.wasChair === true)).toBe(false);
    const giveUpRows = rows.filter(r => r.role === 'chair' && r.status === 'error');
    expect(giveUpRows).toHaveLength(1);
    expect(giveUpRows[0]).toMatchObject({ model: 'deepseek', wasChair: false, usage: null });
    expect('waveId' in giveUpRows[0]).toBe(false);
  });
});

describe('signals are re-read AFTER every chair launch (getter, not snapshot)', () => {
  test('SIGINT landing during the chair solo → exit 130, no tally, no verdict, no ledger row', async () => {
    let onAbort;
    const installSignalAbortFn = (opts) => { onAbort = opts.onAbort; return () => {}; };
    const script = happyScript();
    script['abc123-ch1'] = () => {
      onAbort('SIGINT');                  // lands while the chair leg is in flight
      return okWave([mkLeg('deepseek', 'Synthesis.\nVERDICT: Ship it', 'complete', 0.03)]);
    };
    const appendRunFn = jest.fn();
    const { exitCode, run } = await runCouncil(baseOptions(tmp),
      deps(scriptedLaunchers(script), { appendRunFn, installSignalAbortFn }));

    expect(exitCode).toBe(130);
    expect(run.status).toBe('aborted');
    expect(appendRunFn).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(runDir(), 'tally.json'))).toBe(false);
    expect(fs.existsSync(path.join(runDir(), 'verdict.json'))).toBe(false);
  });

  test('SIGTERM landing during the -ch4 repair → exit 143, no verdict', async () => {
    let onAbort;
    const installSignalAbortFn = (opts) => { onAbort = opts.onAbort; return () => {}; };
    const script = happyScript();
    script['abc123-ch1'] = () => okWave([mkLeg('deepseek', 'Prose only.', 'complete', 0.03)]);
    script['abc123-ch4'] = () => {
      onAbort('SIGTERM');
      return okWave([mkLeg('deepseek', 'VERDICT: Ship it')]);
    };
    const { exitCode, run } = await runCouncil(baseOptions(tmp),
      deps(scriptedLaunchers(script), { installSignalAbortFn }));

    expect(exitCode).toBe(143);
    expect(run.status).toBe('aborted');
    expect(fs.existsSync(path.join(runDir(), 'verdict.json'))).toBe(false);
  });
});

describe('cost ceiling still skips the chair without launching it', () => {
  test('maxCost tripped before the chair: stage skipped, no -ch1, exit 2, verdict written', async () => {
    const launchers = scriptedLaunchers(happyScript());
    const { exitCode, run } = await runCouncil(baseOptions(tmp, { maxCost: 0.05 }), deps(launchers));

    expect(exitCode).toBe(2);
    expect(launchers.calls.some(c => c.waveId === 'abc123-ch1')).toBe(false);
    expect(chairStage(run).status).toBe('skipped');
    expect(JSON.parse(fs.readFileSync(path.join(runDir(), 'verdict.json'), 'utf-8')).overallVerdict)
      .toBeNull();
    // v4.7 D2 review fix: a cost-skipped chair never calls recordAttempt, so
    // chairAttempts AND chairRows both stay empty — zero rows of any
    // chair-class role, not just no wasChair:true row.
    expect(readInput().runStats.filter(r => ['chair', 'chair-attempt', 'repair'].includes(r.role)))
      .toHaveLength(0);
  });
});
