// tests/council/run-happy.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { runCouncil } = require('../../src/council/run');
const { scriptedLaunchers, happyScript, baseOptions } = require('./helpers/fake-launchers');

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'council-run-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const noSignals = () => () => {};

describe('runCouncil — full happy path (fake launchers)', () => {
  let result; let appendRunFn; let runDir;

  beforeEach(async () => {
    appendRunFn = jest.fn();
    const opts = baseOptions(tmp);
    runDir = opts.runDir;
    result = await runCouncil(opts, {
      launchers: scriptedLaunchers(happyScript()),
      appendRunFn, statsFn: () => [], installSignalAbortFn: noSignals,
    });
  });

  test('exit 0, run.json complete with the stage ladder', () => {
    expect(result.exitCode).toBe(0);
    const run = JSON.parse(fs.readFileSync(path.join(runDir, 'run.json'), 'utf-8'));
    expect(run).toMatchObject({
      schemaVersion: 2, type: 'council-run', runId: 'abc123', status: 'complete', exitCode: 0,
      bench: ['gemini', 'gpt', 'qwen'], chair: 'deepseek',
    });
    expect(run.stages.map(s => [s.name, s.status])).toEqual([
      ['stage1', 'complete'], ['stage2', 'complete'], ['chair', 'complete'],
      ['tally', 'complete'], ['verdict', 'complete'],
    ]);
    expect(run.labelMap).toEqual({
      'Review A': 'gemini', 'Review B': 'gpt', 'Review C': 'qwen',
    });
    expect(run.usage.cost.amount).toBeCloseTo(0.09); // 3 reviews + 3 judges @0.01 + chair @0.03
  });

  test('pointer file resolves the run dir', () => {
    const ptr = JSON.parse(fs.readFileSync(
      path.join(tmp, '.claude', 'amicus_sessions', 'council-abc123.json'), 'utf-8'));
    expect(ptr).toEqual({ runId: 'abc123', runDir });
  });

  test('run-dir artifacts: skill-compatible layout (spec §4)', () => {
    for (const f of ['briefing-stage1.md', 'review-gemini.md', 'review-gpt.md', 'review-qwen.md',
      'bundle-stage2.md', 'judge-gemini.md', 'judge-gpt.md', 'judge-qwen.md',
      'chair-packet.md', 'chair-output.md', 'tally-input.json', 'tally.json',
      'verdict.json', 'report.html', 'run.json']) {
      expect(fs.existsSync(path.join(runDir, f))).toBe(true);
    }
  });

  test('five-keys meta pins in tally-input.json (spec §5)', () => {
    const input = JSON.parse(fs.readFileSync(path.join(runDir, 'tally-input.json'), 'utf-8'));
    expect(input.meta).toMatchObject({
      runId: 'abc123', runType: 'headless', claudeInCouncil: false,
      models: ['gemini', 'gpt', 'qwen'], chair: 'deepseek',
    });
    const chairRow = input.runStats.find(r => r.wasChair);
    expect(chairRow).toMatchObject({ model: 'deepseek', role: 'chair' });
    // #83 (v4.6 Plan 2): 3 seat rows + 3 judge rows (one per bench model, all judge) + 1 chair row.
    expect(input.runStats).toHaveLength(7);
  });

  test('verdict.json carries the parsed chair verdict; report.html rendered', () => {
    const verdict = JSON.parse(fs.readFileSync(path.join(runDir, 'verdict.json'), 'utf-8'));
    expect(verdict.overallVerdict).toBe('Ship it');
    expect(verdict.chair).toBe('deepseek');
    expect(fs.readFileSync(path.join(runDir, 'report.html'), 'utf-8')).toContain('Council Report');
  });

  test('ledger appended exactly once with the FINAL record', () => {
    expect(appendRunFn).toHaveBeenCalledTimes(1);
    const record = appendRunFn.mock.calls[0][0];
    expect(record.meta.runId).toBe('abc123');
    expect(record.runStats.some(r => r.wasChair)).toBe(true);
  });
});

describe('runCouncil — lenses force no-ledger (spec §4)', () => {
  test('appendRunFn is never called on a lens run', async () => {
    const appendRunFn = jest.fn();
    const { judgeOut, mkLeg, okWave, review } = require('./helpers/fake-launchers');
    const script = {
      'abc123-l1': () => okWave([mkLeg('gemini', review('gemini'))]),
      'abc123-l2': () => okWave([mkLeg('gpt', review('gpt'))]),
      'abc123-l3': () => okWave([mkLeg('qwen', review('qwen'))]),
      'abc123-s2': () => okWave([
        mkLeg('gemini', judgeOut(['Review B', 'Review C', 'Review A'], [{ id: 'A1', verdict: 'agree' }])),
        mkLeg('gpt', judgeOut(['Review A', 'Review C', 'Review B'], [{ id: 'B1', verdict: 'agree' }])),
        mkLeg('qwen', judgeOut(['Review A', 'Review B', 'Review C'], [{ id: 'C1', verdict: 'neutral' }])),
      ]),
      'abc123-ch1': () => okWave([mkLeg('deepseek', 'Synthesis.\nVERDICT: Fix these first')]),
    };
    const result = await runCouncil(
      baseOptions(tmp, { lenses: ['growth-stage VC', 'security architect', 'skeptical buyer'] }),
      { launchers: scriptedLaunchers(script), appendRunFn, statsFn: () => [], installSignalAbortFn: noSignals });
    expect(result.exitCode).toBe(0);
    expect(appendRunFn).not.toHaveBeenCalled();
  });
});
