// tests/sidecar/fanout-output.test.js
'use strict';

const { formatWaveHuman, fmtDuration } = require('../../src/sidecar/fanout-output');

describe('formatWaveHuman', () => {
  const wave = {
    waveId: 'deadbeef',
    status: 'partial',
    counts: { total: 2, complete: 1, error: 0, timeout: 1, aborted: 0 },
    durationMs: 65000,
    legs: [
      { taskId: 'deadbeef-1', modelInput: 'gemini', model: 'openrouter/google/gemini-3.5', status: 'complete', durationMs: 60000, summary: 'Gemini summary text', error: null },
      { taskId: 'deadbeef-2', modelInput: 'gpt', model: 'openrouter/openai/gpt-6', status: 'timeout', durationMs: 65000, summary: null, error: null },
    ],
  };

  it('renders one section per leg in order, plus a status footer', () => {
    const out = formatWaveHuman(wave);
    const gemIdx = out.indexOf('gemini');
    const gptIdx = out.indexOf('gpt');
    expect(gemIdx).toBeGreaterThan(-1);
    expect(gptIdx).toBeGreaterThan(gemIdx);
    expect(out).toContain('Gemini summary text');
    expect(out).toContain('deadbeef');
    expect(out).toContain('partial');
    expect(out).toContain('timeout');
  });

  it('shows a placeholder for legs without a summary', () => {
    const out = formatWaveHuman(wave);
    expect(out).toContain('(no output)');
  });
});

describe('fmtDuration', () => {
  const { fmtDuration } = require('../../src/sidecar/fanout-output');
  it('formats null, zero, seconds and minutes', () => {
    expect(fmtDuration(null)).toBe('-');
    expect(fmtDuration(undefined)).toBe('-');
    expect(fmtDuration(0)).toBe('0s');
    expect(fmtDuration(42000)).toBe('42s');
    expect(fmtDuration(65000)).toBe('1m5s');
  });
});
