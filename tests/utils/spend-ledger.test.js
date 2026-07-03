// tests/utils/spend-ledger.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  appendSpend,
  readSpendRows,
  SPEND_LEDGER_FILE,
  SPEND_LEDGER_SCHEMA_VERSION,
} = require('../../src/utils/spend-ledger');

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'spend-ledger-'));
}

describe('appendSpend', () => {
  it('appends one JSONL row with the documented shape', () => {
    const dir = mkTmpDir();
    appendSpend({
      taskId: 'abc123',
      model: 'openrouter/anthropic/claude-opus-4.8',
      mode: 'headless',
      usage: { tokens: { input: 100, output: 50 }, cost: { amount: 0.01, currency: 'USD', source: 'reported' } },
    }, { dir });
    const file = path.join(dir, SPEND_LEDGER_FILE);
    expect(fs.existsSync(file)).toBe(true);
    const rows = readSpendRows(dir);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      schemaVersion: SPEND_LEDGER_SCHEMA_VERSION,
      taskId: 'abc123',
      model: 'openrouter/anthropic/claude-opus-4.8',
      mode: 'headless',
      tokens: { input: 100, output: 50 },
      cost: { amount: 0.01, currency: 'USD', source: 'reported' },
    });
    expect(typeof rows[0].ts).toBe('string');
    expect(new Date(rows[0].ts).toString()).not.toBe('Invalid Date');
  });

  it('carries waveId when present (a fanout leg)', () => {
    const dir = mkTmpDir();
    appendSpend({
      taskId: 'wave1-1', waveId: 'wave1', model: 'opus', mode: 'leg',
      usage: { tokens: { input: 1, output: 1 }, cost: { amount: 0.001, currency: 'USD', source: 'estimated' } },
    }, { dir });
    expect(readSpendRows(dir)[0].waveId).toBe('wave1');
  });

  it('waveId is null (not undefined) for a plain run — keeps the row shape stable across JSON round-trips', () => {
    const dir = mkTmpDir();
    appendSpend({
      taskId: 'solo1', model: 'opus', mode: 'headless',
      usage: { tokens: { input: 1, output: 1 }, cost: { amount: 0.001, currency: 'USD', source: 'estimated' } },
    }, { dir });
    expect(readSpendRows(dir)[0].waveId).toBeNull();
  });

  it('is a no-op (never throws) when usage is null — nothing priced to record', () => {
    const dir = mkTmpDir();
    expect(() => appendSpend({ taskId: 't1', model: 'opus', mode: 'headless', usage: null }, { dir })).not.toThrow();
    expect(readSpendRows(dir)).toHaveLength(0);
  });

  it('best-effort: a write failure (unwritable dir) is swallowed, never throws', () => {
    // Point at a path that cannot be created as a directory (a file in its place).
    const parent = mkTmpDir();
    const blockerFile = path.join(parent, 'blocked');
    fs.writeFileSync(blockerFile, 'x');
    const badDir = path.join(blockerFile, 'nested'); // parent is a file, not a dir
    expect(() => appendSpend({
      taskId: 't1', model: 'opus', mode: 'headless',
      usage: { tokens: { input: 1, output: 1 }, cost: { amount: 0.001, currency: 'USD', source: 'estimated' } },
    }, { dir: badDir })).not.toThrow();
  });
});

describe('readSpendRows', () => {
  it('returns [] for a missing ledger file', () => {
    const dir = mkTmpDir();
    expect(readSpendRows(dir)).toEqual([]);
  });

  it('skips unparseable/corrupt lines (deriveReliability precedent)', () => {
    const dir = mkTmpDir();
    appendSpend({
      taskId: 'ok1', model: 'opus', mode: 'headless',
      usage: { tokens: { input: 1, output: 1 }, cost: { amount: 0.001, currency: 'USD', source: 'estimated' } },
    }, { dir });
    fs.appendFileSync(path.join(dir, SPEND_LEDGER_FILE), '{ broken partial line\n');
    appendSpend({
      taskId: 'ok2', model: 'opus', mode: 'headless',
      usage: { tokens: { input: 1, output: 1 }, cost: { amount: 0.002, currency: 'USD', source: 'estimated' } },
    }, { dir });
    const rows = readSpendRows(dir);
    expect(rows).toHaveLength(2);
    expect(rows.map(r => r.taskId)).toEqual(['ok1', 'ok2']);
  });
});
