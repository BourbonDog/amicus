// tests/council/run-chair.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { runCouncil, pickFallbackChair } = require('../../src/council/run');
const { scriptedLaunchers, happyScript, baseOptions, mkLeg, okWave } =
  require('./helpers/fake-launchers');

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'council-chair-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const noSignals = () => () => {};
const readVerdict = () => JSON.parse(
  fs.readFileSync(path.join(tmp, 'council-abc123', 'verdict.json'), 'utf-8'));

describe('pickFallbackChair (highest peers-only street-cred = LOWEST mean rank)', () => {
  const rows = [
    { model: 'mistral', avgStreetCredPeersOnly: 2.4 },
    { model: 'grok', avgStreetCredPeersOnly: 1.2 },
    { model: 'gemini', avgStreetCredPeersOnly: 1.0 },   // bench → excluded
    { model: 'deepseek', avgStreetCredPeersOnly: 1.1 }, // failed chair → excluded
    { model: 'unjudged', avgStreetCredPeersOnly: null }, // never judged → excluded
  ];
  test('picks the best non-bench, non-failed-chair model', () => {
    expect(pickFallbackChair(rows, ['gemini', 'gpt', 'qwen'], 'deepseek')).toBe('grok');
  });
  test('returns null when no candidate exists', () => {
    expect(pickFallbackChair([], ['gemini'], 'deepseek')).toBeNull();
    expect(pickFallbackChair(rows.slice(2), ['gemini', 'unjudged'], 'deepseek')).toBeNull();
  });
});

describe('chair retry + fallback promotion', () => {
  test('transient failure: retry same chair once succeeds → exit 0', async () => {
    const script = happyScript();
    script['abc123-ch1'] = () => okWave([mkLeg('deepseek', '', 'error')], 1, 'error');
    script['abc123-ch2'] = () => okWave([mkLeg('deepseek', 'Synthesis.\nVERDICT: Ship it', 'complete', 0.03)]);
    const launchers = scriptedLaunchers(script);
    const { exitCode } = await runCouncil(baseOptions(tmp), {
      launchers, appendRunFn: jest.fn(), statsFn: () => [], installSignalAbortFn: noSignals,
    });
    expect(exitCode).toBe(0);
    expect(readVerdict().overallVerdict).toBe('Ship it');
  });

  test('both chair attempts die → ledger fallback promoted; meta.chair = actual chair', async () => {
    const script = happyScript();
    script['abc123-ch1'] = () => okWave([mkLeg('deepseek', '', 'error')], 1, 'error');
    script['abc123-ch2'] = () => okWave([mkLeg('deepseek', '', 'timeout')], 1, 'error');
    script['abc123-ch3'] = (opts) => {
      expect(opts.model).toBe('grok');
      return okWave([mkLeg('grok', 'Fallback synthesis.\nVERDICT: Fix these first', 'complete', 0.02)]);
    };
    const statsFn = () => [
      { model: 'grok', avgStreetCredPeersOnly: 1.2 },
      { model: 'gemini', avgStreetCredPeersOnly: 1.0 },
    ];
    const { exitCode } = await runCouncil(baseOptions(tmp), {
      launchers: scriptedLaunchers(script), appendRunFn: jest.fn(), statsFn,
      installSignalAbortFn: noSignals,
    });
    expect(exitCode).toBe(0);
    const verdict = readVerdict();
    expect(verdict.overallVerdict).toBe('Fix these first');
    expect(verdict.chair).toBe('grok');   // final tally meta.chair = actual chair
    const input = JSON.parse(fs.readFileSync(path.join(tmp, 'council-abc123', 'tally-input.json'), 'utf-8'));
    expect(input.runStats.find(r => r.wasChair).model).toBe('grok');
  });

  test('give up: no fallback candidate → overallVerdict null, exit 2', async () => {
    const script = happyScript();
    script['abc123-ch1'] = () => okWave([mkLeg('deepseek', '', 'error')], 1, 'error');
    script['abc123-ch2'] = () => okWave([mkLeg('deepseek', '', 'error')], 1, 'error');
    const { exitCode, run } = await runCouncil(baseOptions(tmp), {
      launchers: scriptedLaunchers(script), appendRunFn: jest.fn(), statsFn: () => [],
      installSignalAbortFn: noSignals,
    });
    expect(exitCode).toBe(2);
    expect(run.status).toBe('partial');
    expect(readVerdict().overallVerdict).toBeNull();
  });
});

describe('chair VERDICT-line repair (one re-prompt)', () => {
  test('missing VERDICT → repair -ch4 supplies it → exit 0', async () => {
    const script = happyScript();
    script['abc123-ch1'] = () => okWave([mkLeg('deepseek', 'Great synthesis, no verdict line.', 'complete', 0.03)]);
    script['abc123-ch4'] = () => okWave([mkLeg('deepseek', 'VERDICT: Fundamental rethink')]);
    const { exitCode } = await runCouncil(baseOptions(tmp), {
      launchers: scriptedLaunchers(script), appendRunFn: jest.fn(), statsFn: () => [],
      installSignalAbortFn: noSignals,
    });
    expect(exitCode).toBe(0);
    expect(readVerdict().overallVerdict).toBe('Fundamental rethink');
  });

  test('still missing after the one repair → keep prose, overallVerdict null, exit 2', async () => {
    const script = happyScript();
    script['abc123-ch1'] = () => okWave([mkLeg('deepseek', 'Prose only, forever.', 'complete', 0.03)]);
    script['abc123-ch4'] = () => okWave([mkLeg('deepseek', 'still no verdict line')]);
    const { exitCode } = await runCouncil(baseOptions(tmp), {
      launchers: scriptedLaunchers(script), appendRunFn: jest.fn(), statsFn: () => [],
      installSignalAbortFn: noSignals,
    });
    expect(exitCode).toBe(2);
    expect(readVerdict().overallVerdict).toBeNull();
    // chair prose is kept (spec: "keep chair prose")
    expect(fs.readFileSync(path.join(tmp, 'council-abc123', 'chair-output.md'), 'utf-8'))
      .toContain('Prose only, forever.');
  });
});
