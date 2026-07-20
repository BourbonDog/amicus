// tests/council/run-signal.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { runCouncil, SIGNAL_EXIT } = require('../../src/council/run');
const { scriptedLaunchers, happyScript, baseOptions, mkLeg, review } =
  require('./helpers/fake-launchers');

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'council-signal-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('signal abort finalization (spec §4: abort active wave; run.json aborted; 130/143)', () => {
  test('SIGINT during the Stage-1 wave: exit 130, run.json aborted, no Stage 2', async () => {
    const script = happyScript();
    script['abc123-s1'] = () => ({
      wave: { status: 'aborted', legs: [mkLeg('gemini', '', 'aborted')] }, exitCode: 130,
    });
    const launchers = scriptedLaunchers(script);
    const { exitCode, run } = await runCouncil(baseOptions(tmp), {
      launchers, appendRunFn: jest.fn(), statsFn: () => [], installSignalAbortFn: () => () => {},
    });
    expect(exitCode).toBe(130);
    expect(run.status).toBe('aborted');
    expect(run.exitCode).toBe(130);
    expect(launchers.calls.some(c => c.waveId === 'abc123-s2')).toBe(false);
  });

  test('SIGTERM during the Stage-2 wave: exit 143; stage1 artifacts survive', async () => {
    const script = happyScript();
    script['abc123-s2'] = () => ({ wave: { status: 'aborted', legs: [] }, exitCode: 143 });
    const { exitCode, run } = await runCouncil(baseOptions(tmp), {
      launchers: scriptedLaunchers(script), appendRunFn: jest.fn(), statsFn: () => [],
      installSignalAbortFn: () => () => {},
    });
    expect(exitCode).toBe(143);
    expect(run.status).toBe('aborted');
    expect(fs.existsSync(path.join(tmp, 'council-abc123', 'review-gemini.md'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'council-abc123', 'verdict.json'))).toBe(false);
  });

  test('between-stage signal: the driver handler checkpoints aborted and finalize honors it', async () => {
    let onAbort;
    const installSignalAbortFn = (opts) => { onAbort = opts.onAbort; return () => {}; };
    const script = happyScript();
    const realS2 = script['abc123-s2'];
    script['abc123-s2'] = (opts) => {
      onAbort('SIGINT');            // signal lands between the launch bookkeeping
      return realS2(opts);          // the in-flight wave still settles normally
    };
    const { exitCode, run } = await runCouncil(baseOptions(tmp), {
      launchers: scriptedLaunchers(script), appendRunFn: jest.fn(), statsFn: () => [],
      installSignalAbortFn,
    });
    expect(exitCode).toBe(SIGNAL_EXIT.SIGINT);
    expect(run.status).toBe('aborted');       // abort-wins beat the later finalize
  });

  test('chair-solo abort: exit 130 and no verdict emission', async () => {
    const script = happyScript();
    script['abc123-ch1'] = () => ({
      wave: { status: 'aborted', legs: [mkLeg('deepseek', '', 'aborted')] }, exitCode: 130,
    });
    const { exitCode } = await runCouncil(baseOptions(tmp), {
      launchers: scriptedLaunchers(script), appendRunFn: jest.fn(), statsFn: () => [],
      installSignalAbortFn: () => () => {},
    });
    expect(exitCode).toBe(130);
    expect(fs.existsSync(path.join(tmp, 'council-abc123', 'verdict.json'))).toBe(false);
  });
});
