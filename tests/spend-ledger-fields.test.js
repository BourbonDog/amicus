'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { appendSpend, readSpendRows, SPEND_LEDGER_SCHEMA_VERSION } = require('../src/utils/spend-ledger');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'spend-fields-')); }

describe('appendSpend additive attribution fields (spec 7.1)', () => {
  const usage = { tokens: { input: 10, output: 5 }, cost: { amount: 0.02, currency: 'USD', source: 'reported' } };

  test('schema version stays 1', () => {
    expect(SPEND_LEDGER_SCHEMA_VERSION).toBe(1);
  });

  test('writes op/status/attribution when provided', () => {
    const dir = tmp();
    appendSpend({
      taskId: 't1', waveId: 'w1', model: 'gpt', mode: 'leg', usage,
      op: 'leg', status: 'complete', councilRunId: 'c9', councilName: 'default',
      project: '/proj', gateway: 'openrouter',
    }, { dir });
    const [row] = readSpendRows(dir);
    expect(row).toMatchObject({
      schemaVersion: 1, taskId: 't1', waveId: 'w1', model: 'gpt', mode: 'leg',
      op: 'leg', status: 'complete', councilRunId: 'c9', councilName: 'default',
      project: '/proj', gateway: 'openrouter',
    });
  });

  test('omits absent linkage fields entirely; nullable dims are null', () => {
    const dir = tmp();
    appendSpend({ taskId: 't2', model: 'gpt', mode: 'headless', usage, op: 'start' }, { dir });
    const [row] = readSpendRows(dir);
    expect('attempt' in row).toBe(false);
    expect('substitutedFor' in row).toBe(false);
    expect('retryOfWaveId' in row).toBe(false);
    expect(row.councilRunId).toBeNull();
    expect(row.gateway).toBeNull();
  });

  test('fallback substitution fields ride when present', () => {
    const dir = tmp();
    appendSpend({ taskId: 't3', waveId: 'w1', model: 'haiku', mode: 'leg', usage,
      op: 'leg', status: 'complete', attempt: 1, substitutedFor: 'opus' }, { dir });
    const [row] = readSpendRows(dir);
    expect(row.attempt).toBe(1);
    expect(row.substitutedFor).toBe('opus');
  });

  test('a null usage still no-ops (unchanged guarantee)', () => {
    const dir = tmp();
    appendSpend({ taskId: 't4', model: 'gpt', mode: 'headless', usage: null, op: 'start' }, { dir });
    expect(readSpendRows(dir)).toEqual([]);
  });
});
