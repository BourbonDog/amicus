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

// ---------------------------------------------------------------------------
// v4.4.1 fix wave, F6 — a Stage-1 sub-wave that dies BEFORE its legs.
//
// The wave contributes no leg documents at all, so `deadLegs` (which filters
// legs that DID exist) cannot see it. Run v441plan01 therefore recorded stage1
// 'complete' with four seats missing. In LENS mode every seat is its own wave,
// so a run could lose seats and still exit 0 — the quorum gate only catches the
// single non-lens seat wave. Never aborts: it reports loudly and degrades.
// ---------------------------------------------------------------------------

/** A wave that died at server start: real status, real reason, zero legs. */
const deadWave = (reason = 'Failed to start server: database is locked') =>
  ({ wave: { status: 'error', legs: [], reason }, exitCode: 1 });

const twoJudges = () => okWave([
  mkLeg('gemini', judgeOut(['Review B', 'Review A'],
    [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'agree' }])),
  mkLeg('gpt', judgeOut(['Review A', 'Review B'],
    [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'dispute' }])),
]);
const chairOk = () => okWave([mkLeg('deepseek', 'Synthesis.\n\nVERDICT: Ship it', 'complete', 0.03)]);

const stageOf = (run, name) => (run.stages || []).find(s => s.name === name);

describe('a Stage-1 wave that dies before its legs (F6)', () => {
  let stderr;
  beforeEach(() => { stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true); });
  afterEach(() => stderr.mockRestore());
  const emitted = () => stderr.mock.calls.map(c => String(c[0])).join('');

  test('LENS mode: a dead lens solo degrades the run to 2 instead of exiting 0', async () => {
    const script = {
      'abc123-l1': () => okWave([mkLeg('gemini', review('gemini'))]),
      'abc123-l2': () => okWave([mkLeg('gpt', review('gpt'))]),
      'abc123-l3': () => deadWave(),
      'abc123-s2': twoJudges,
      'abc123-ch1': chairOk,
    };
    const opts = baseOptions(tmp, { lenses: ['security', 'performance', 'ux'] });
    const { exitCode, run } = await runCouncil(opts, deps(scriptedLaunchers(script)));

    expect(exitCode).toBe(2);                       // was 0: the seat vanished silently
    expect(run.status).toBe('partial');
    // The stage says so on disk, and names what was lost.
    const stage = stageOf(run, 'stage1');
    expect(stage.status).toBe('partial');
    expect(stage.deadWaves).toEqual([
      { waveId: 'abc123-l3', models: ['qwen'],
        reason: 'Failed to start server: database is locked' },
    ]);
    // …and it is impossible to miss on the way past.
    expect(emitted()).toMatch(/Stage-1 wave abc123-l3 \(qwen\) produced NO legs/);
    expect(emitted()).toMatch(/database is locked/);
    expect(emitted()).toMatch(/exit degraded \(2\)/);
  });

  test('NON-LENS: a dead critic solo degrades too — quorum only guards the seat wave', async () => {
    const script = {
      'abc123-s1': (o) => okWave(o.models.map(m => mkLeg(m, review(m)))),
      'abc123-c1': () => deadWave('Failed to start server: SQLITE_BUSY'),
      'abc123-s2': twoJudges,
      'abc123-ch1': chairOk,
    };
    const opts = baseOptions(tmp, { critic: 'qwen' });
    const { exitCode, run } = await runCouncil(opts, deps(scriptedLaunchers(script)));

    expect(exitCode).toBe(2);
    expect(stageOf(run, 'stage1').deadWaves).toEqual([
      { waveId: 'abc123-c1', models: ['qwen'], reason: 'Failed to start server: SQLITE_BUSY' },
    ]);
    expect(emitted()).toMatch(/Stage-1 wave abc123-c1 \(qwen\) produced NO legs/);
  });

  /**
   * v4.5.2. The test above proves the loss reaches run.json. It did NOT reach
   * verdict.json — so a run that produced a full verdict, tally and chair
   * synthesis without ever seeing its critic looked clean to anyone reading the
   * verdict, which is the file people actually open. Field run `dfb6a692`
   * shipped exactly that. The whole point of `--critic` is adversarial review;
   * its absence has to be legible where the conclusion is.
   */
  test('NON-LENS: a lost critic is recorded on verdict.json, not just run.json', async () => {
    const script = {
      'abc123-s1': (o) => okWave(o.models.map(m => mkLeg(m, review(m)))),
      'abc123-c1': () => deadWave('Failed to start server: Timeout waiting for server to start after 5000ms'),
      'abc123-s2': twoJudges,
      'abc123-ch1': chairOk,
    };
    const opts = baseOptions(tmp, { critic: 'qwen' });
    await runCouncil(opts, deps(scriptedLaunchers(script)));

    const verdict = JSON.parse(
      fs.readFileSync(path.join(opts.runDir, 'verdict.json'), 'utf-8'));
    expect(verdict.seatLoss).toBeDefined();
    expect(verdict.seatLoss.criticRequested).toBe('qwen');
    expect(verdict.seatLoss.criticSeated).toBe(false);
    expect(verdict.seatLoss.reason).toMatch(/Timeout waiting for server to start/);
  });

  test('a critic that DID seat is recorded as seated, so silence is unambiguous', async () => {
    const script = {
      'abc123-s1': (o) => okWave(o.models.map(m => mkLeg(m, review(m)))),
      'abc123-c1': () => okWave([mkLeg('qwen', review('qwen'))]),
      'abc123-s2': twoJudges,
      'abc123-ch1': chairOk,
    };
    const opts = baseOptions(tmp, { critic: 'qwen' });
    await runCouncil(opts, deps(scriptedLaunchers(script)));

    const verdict = JSON.parse(
      fs.readFileSync(path.join(opts.runDir, 'verdict.json'), 'utf-8'));
    expect(verdict.seatLoss.criticSeated).toBe(true);
  });

  test('a dead LEG (not a dead wave) marks the stage partial too, with no deadWaves', async () => {
    const script = happyScript();
    script['abc123-s1'] = () => okWave([
      mkLeg('gemini', review('gemini')), mkLeg('gpt', review('gpt')), mkLeg('qwen', '', 'error'),
    ], 2, 'partial');
    script['abc123-s2'] = twoJudges;
    const { exitCode, run } = await runCouncil(baseOptions(tmp), deps(scriptedLaunchers(script)));
    expect(exitCode).toBe(2);
    const stage = stageOf(run, 'stage1');
    expect(stage.status).toBe('partial');
    expect(stage.deadWaves).toBeUndefined();       // the leg existed; it is not a dead WAVE
  });

  test('a healthy Stage 1 is still `complete` and carries no deadWaves key', async () => {
    const { exitCode, run } = await runCouncil(baseOptions(tmp), deps(scriptedLaunchers(happyScript())));
    expect(exitCode).toBe(0);
    expect(stageOf(run, 'stage1').status).toBe('complete');
    expect(stageOf(run, 'stage1').deadWaves).toBeUndefined();
    expect(emitted()).not.toMatch(/produced NO legs/);
  });

  // A ceiling refusal is already announced, checkpointed and degraded by
  // run-budget.noteBudgetRefusal (via the REAL launcher). Claiming it here too
  // would report the same lost seat twice, in two different vocabularies.
  test('a budget refusal is NOT re-reported as a dead wave', async () => {
    const script = {
      'abc123-s1': (o) => okWave(o.models.map(m => mkLeg(m, review(m)))),
      'abc123-c1': () => ({ wave: null, exitCode: 1,
        errorDoc: { code: 'BUDGET_EXCEEDED', message: 'ceiling reached' } }),
      'abc123-s2': twoJudges,
      'abc123-ch1': chairOk,
    };
    const { run } = await runCouncil(baseOptions(tmp, { critic: 'qwen' }), deps(scriptedLaunchers(script)));
    expect(stageOf(run, 'stage1').deadWaves).toBeUndefined();
    expect(emitted()).not.toMatch(/produced NO legs/);
  });
});
