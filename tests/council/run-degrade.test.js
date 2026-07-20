// tests/council/run-degrade.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { runCouncil } = require('../../src/council/run');
const { scriptedLaunchers, happyScript, baseOptions, review, judgeOut, mkLeg, okWave } =
  require('./helpers/fake-launchers');

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'council-degrade-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const noSignals = () => () => {};
const deps = (launchers) => ({ launchers, appendRunFn: jest.fn(), statsFn: () => [], installSignalAbortFn: noSignals });

describe('quorum failure (spec §4: <2 completed Stage-1 reviews → exit 1)', () => {
  test('stops before Stage 2, error doc COUNCIL_QUORUM, run.json status error', async () => {
    const script = {
      'abc123-s1': (opts) => okWave([
        mkLeg('gemini', review('gemini')),
        mkLeg('gpt', '', 'error'),
        mkLeg('qwen', '', 'timeout'),
      ], 2, 'partial'),
      // NO -s2 script: reaching Stage 2 throws "no script for waveId abc123-s2"
    };
    const launchers = scriptedLaunchers(script);
    const { exitCode, run } = await runCouncil(baseOptions(tmp), deps(launchers));
    expect(exitCode).toBe(1);
    expect(run.status).toBe('error');
    expect(run.error).toMatchObject({ code: 'COUNCIL_QUORUM' });
    expect(launchers.calls.some(c => c.waveId === 'abc123-s2')).toBe(false);
    expect(fs.existsSync(path.join(baseOptions(tmp).runDir, 'tally.json'))).toBe(false);
  });
});

describe('one dead Stage-1 leg, >=2 survivors (mission-pinned: exit 2)', () => {
  test('proceeds with the survivors and exits 2', async () => {
    const script = happyScript();
    script['abc123-s1'] = () => okWave([
      mkLeg('gemini', review('gemini')),
      mkLeg('gpt', review('gpt')),
      mkLeg('qwen', '', 'error'),
    ], 2, 'partial');
    script['abc123-s2'] = () => okWave([
      mkLeg('gemini', judgeOut(['Review B', 'Review A'], [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'agree' }])),
      mkLeg('gpt', judgeOut(['Review A', 'Review B'], [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'dispute' }])),
    ]);
    const { exitCode, run } = await runCouncil(baseOptions(tmp), deps(scriptedLaunchers(script)));
    expect(exitCode).toBe(2);
    expect(run.status).toBe('partial');
    // The run still completes: verdict + report exist for the surviving bench.
    const verdict = JSON.parse(fs.readFileSync(path.join(run.options.outDir, 'verdict.json'), 'utf-8'));
    expect(verdict.council).toEqual(['gemini', 'gpt', 'qwen']); // bench unchanged in meta
  });
});

describe('judge shortfall (>=2 reviews but <2 completed judges → exit 2, judged:false)', () => {
  test('tally judged:false comes from tally itself; exit 2', async () => {
    const script = happyScript();
    script['abc123-s2'] = () => okWave([
      mkLeg('gemini', judgeOut(['Review B', 'Review C', 'Review A'],
        [{ id: 'A1', verdict: 'agree' }])),
      mkLeg('gpt', '', 'timeout'),
      mkLeg('qwen', '', 'error'),
    ], 2, 'partial');
    const { exitCode } = await runCouncil(baseOptions(tmp), deps(scriptedLaunchers(script)));
    expect(exitCode).toBe(2);
    const record = JSON.parse(fs.readFileSync(
      path.join(path.join(tmp, 'council-abc123'), 'tally.json'), 'utf-8'));
    expect(record.judged).toBe(false);            // rankings.length >= 2 is tally's job
  });
});

describe('repaired judge does NOT degrade the run', () => {
  test('one malformed judge that repairs cleanly still exits 0', async () => {
    const script = happyScript();
    script['abc123-s2'] = () => okWave([
      mkLeg('gemini', 'no json from this judge'),
      mkLeg('gpt', judgeOut(['Review A', 'Review C', 'Review B'],
        [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'agree' }, { id: 'C1', verdict: 'dispute' }])),
      mkLeg('qwen', judgeOut(['Review A', 'Review B', 'Review C'],
        [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'neutral' }, { id: 'C1', verdict: 'agree' }])),
    ]);
    script['abc123-q1'] = () => okWave([
      mkLeg('gemini', judgeOut(['Review B', 'Review C', 'Review A'],
        [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'agree' }, { id: 'C1', verdict: 'neutral' }])),
    ]);
    const { exitCode } = await runCouncil(baseOptions(tmp), deps(scriptedLaunchers(script)));
    expect(exitCode).toBe(0);
    const input = JSON.parse(fs.readFileSync(
      path.join(tmp, 'council-abc123', 'tally-input.json'), 'utf-8'));
    const gemini = input.runStats.find(r => r.model === 'gemini');
    expect(gemini.conformance).toBe('repaired');   // worst-wins merge into the seat row
  });
});
