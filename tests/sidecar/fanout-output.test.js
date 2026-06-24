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

  it('renders a top-level wave error when present', () => {
    const out = formatWaveHuman({ ...wave, error: 'Error: --models requires a comma-separated list' });
    expect(out).toContain('Error: --models requires');
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

describe('formatWaveHuman cost', () => {
  const { formatWaveHuman } = require('../../src/sidecar/fanout-output');
  const wave = {
    waveId: 'wv1', status: 'complete', counts: { total: 2, complete: 2 }, durationMs: 12000,
    legs: [
      { taskId: 'wv1-1', modelInput: 'gemini', model: 'g', status: 'complete', durationMs: 6000, summary: 'ok',
        usage: { cost: { amount: 0.0123, source: 'reported' } } },
      { taskId: 'wv1-2', modelInput: 'deepseek', model: 'd', status: 'complete', durationMs: 6000, summary: 'ok',
        usage: { cost: { amount: 0.002, source: 'estimated' } } },
    ],
    usage: { cost: { amount: 0.0143, source: 'mixed' } },
  };
  test('shows a per-leg cost cell with source markers', () => {
    const out = formatWaveHuman(wave);
    expect(out).toContain('$0.0123');   // reported
    expect(out).toContain('~$0.0020');  // estimated
  });
  test('shows a wave total cost line', () => {
    expect(formatWaveHuman(wave)).toMatch(/Wave cost: ~\$0\.0143/);
  });
  test('a leg with no usage renders an em dash, not a crash', () => {
    const noUsage = { ...wave, legs: [{ taskId: 'x', modelInput: 'm', model: 'm', status: 'error', durationMs: 1 }],
      usage: undefined };
    expect(() => formatWaveHuman(noUsage)).not.toThrow();
    expect(formatWaveHuman(noUsage)).toContain('—');
  });
});
