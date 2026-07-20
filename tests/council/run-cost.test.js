// tests/council/run-cost.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { runCouncil } = require('../../src/council/run');
const { scriptedLaunchers, happyScript, baseOptions } = require('./helpers/fake-launchers');

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'council-cost-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const noSignals = () => () => {};
const deps = (launchers) => ({ launchers, appendRunFn: jest.fn(), statsFn: () => [], installSignalAbortFn: noSignals });

// Fake legs cost $0.01 each: after Stage 1 spent=0.03; after Stage 2 spent=0.06.

describe('cost ceiling BEFORE tally (spec §4: stop; error doc cost_exceeded; exit 1)', () => {
  test('maxCost 0.02: Stage 2 never launches; no tally.json', async () => {
    const launchers = scriptedLaunchers(happyScript());
    const { exitCode, run } = await runCouncil(
      baseOptions(tmp, { maxCost: 0.02 }), deps(launchers));
    expect(exitCode).toBe(1);
    expect(run.status).toBe('error');
    expect(run.error).toMatchObject({ code: 'COST_EXCEEDED' });
    expect(launchers.calls.some(c => c.waveId === 'abc123-s2')).toBe(false);
    expect(fs.existsSync(path.join(tmp, 'council-abc123', 'tally.json'))).toBe(false);
  });
});

describe('cost ceiling AFTER tally exists (spec §4: verdict without chair; overallVerdict null; exit 2)', () => {
  test('maxCost 0.05: chair skipped, verdict.json written with overallVerdict null', async () => {
    const launchers = scriptedLaunchers(happyScript());
    const { exitCode, run } = await runCouncil(
      baseOptions(tmp, { maxCost: 0.05 }), deps(launchers));
    expect(exitCode).toBe(2);
    expect(run.status).toBe('partial');
    expect(launchers.calls.some(c => c.waveId === 'abc123-ch1')).toBe(false); // never launched
    const runDir = path.join(tmp, 'council-abc123');
    expect(fs.existsSync(path.join(runDir, 'tally.json'))).toBe(true);
    const verdict = JSON.parse(fs.readFileSync(path.join(runDir, 'verdict.json'), 'utf-8'));
    expect(verdict.overallVerdict).toBeNull();
    const chairStage = run.stages.find(s => s.name === 'chair');
    expect(chairStage.status).toBe('skipped');
  });

  test('no ceiling (maxCost null) never gates', async () => {
    const { exitCode } = await runCouncil(baseOptions(tmp, { maxCost: null }),
      deps(scriptedLaunchers(happyScript())));
    expect(exitCode).toBe(0);
  });
});
