'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { formatWaveProgress, readLegState, createWaveHeartbeat } = require('../../src/sidecar/wave-progress');

describe('formatWaveProgress', () => {
  test('renders one terse line per leg with stage, msgs, latest', () => {
    const out = formatWaveProgress([
      { label: 'gemini', messages: 2, latest: 'Reading file', stage: 'receiving', stalled: false },
      { label: 'deepseek', messages: 0, latest: 'starting…', stalled: false },
    ]);
    const lines = out.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('gemini');
    expect(lines[0]).toContain('receiving');
    expect(lines[0]).toContain('2 msg');
    expect(lines[0]).toContain('Reading file');
    expect(lines[1]).toContain('starting'); // no stage → "starting"
  });
  test('flags a stalled leg', () => {
    const out = formatWaveProgress([{ label: 'm', messages: 1, latest: 'x', stage: 'receiving', stalled: true }]);
    expect(out).toContain('stalled');
  });
});

describe('readLegState', () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leg-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  test('degrades to starting when progress.json is absent', () => {
    const s = readLegState({ label: 'gemini', dir });
    expect(s).toEqual({ label: 'gemini', messages: 0, latest: 'starting…', stalled: false });
  });
  test('reflects on-disk progress + conversation', () => {
    fs.writeFileSync(path.join(dir, 'conversation.jsonl'),
      [JSON.stringify({ role: 'assistant', content: 'hi' })].join('\n'));
    fs.writeFileSync(path.join(dir, 'progress.json'),
      JSON.stringify({ stage: 'receiving', stageLabel: 'Generating response...', updatedAt: new Date().toISOString() }));
    const s = readLegState({ label: 'gemini', dir });
    expect(s.label).toBe('gemini');
    expect(s.messages).toBe(1);
    expect(s.stage).toBe('receiving');
    expect(s.stalled).toBe(false);
  });
});

describe('createWaveHeartbeat', () => {
  let dir;
  let stderrSpy;

  beforeEach(() => {
    jest.useFakeTimers();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wave-hb-'));
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    fs.rmSync(dir, { recursive: true, force: true });
    jest.useRealTimers();
  });

  test('writes wave banner with leg label to stderr after one interval tick', () => {
    const hb = createWaveHeartbeat([{ label: 'gemini', dir }], 15000);

    // No write before the first tick
    expect(stderrSpy).not.toHaveBeenCalled();

    jest.advanceTimersByTime(15000);

    expect(stderrSpy).toHaveBeenCalled();
    const written = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(written).toContain('[amicus] wave');
    expect(written).toContain('gemini');

    // stop() prevents further writes
    hb.stop();
    stderrSpy.mockClear();
    jest.advanceTimersByTime(15000);
    expect(stderrSpy).not.toHaveBeenCalled();
  });
});
