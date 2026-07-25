'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { writeProgress, readProgress } = require('../../src/sidecar/progress');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'prog-usage-')); }

describe('progress.json usage snapshot (spec 4.1)', () => {
  test('writeProgress stamps schemaVersion/type and stores raw usage', () => {
    const dir = tmp();
    writeProgress(dir, 'receiving', {
      messagesReceived: 3,
      usage: { tokens: { input: 3000, output: 400, reasoning: 0, cacheRead: 0, cacheWrite: 0 }, costReported: 0 },
    });
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'progress.json'), 'utf-8'));
    expect(raw.schemaVersion).toBe(1);
    expect(raw.type).toBe('progress');
    expect(raw.usage.tokens.input).toBe(3000);
    expect(raw.usage.costReported).toBe(0);
  });

  test('readProgress passes usage through', () => {
    const dir = tmp();
    writeProgress(dir, 'receiving', { usage: { tokens: { input: 10, output: 5 }, costReported: 0.01 } });
    const p = readProgress(dir);
    expect(p.usage.tokens.input).toBe(10);
  });

  test('a flush without usage still stamps envelope (no usage key)', () => {
    const dir = tmp();
    writeProgress(dir, 'prompt_sent', {});
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'progress.json'), 'utf-8'));
    expect(raw.type).toBe('progress');
    expect('usage' in raw).toBe(false);
  });
});
