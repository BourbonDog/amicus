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
    expect('finish' in row).toBe(false);
    expect(row.councilRunId).toBeNull();
    expect(row.gateway).toBeNull();
    expect(row.project).toBeNull();
    expect(row.status).toBeNull();
    // D16 (v4.7 F8): `tag` follows spend-ledger.js's file convention — the SAME
    // null-not-absent shape as the other nullable dims above (councilRunId,
    // project, ...), and is DELIBERATELY the opposite of createSessionMetadata's
    // absent-not-null `tag` convention (D13) — see spend-ledger.js:79-81.
    expect(row.tag).toBeNull();
  });

  test('carries tag when provided (D16, v4.7 F8)', () => {
    const dir = tmp();
    appendSpend({
      taskId: 't2t', model: 'gpt', mode: 'headless', usage, op: 'start', tag: 'sprint42',
    }, { dir });
    const [row] = readSpendRows(dir);
    expect(row.tag).toBe('sprint42');
  });

  test('fallback substitution fields ride when present', () => {
    const dir = tmp();
    appendSpend({ taskId: 't3', waveId: 'w1', model: 'haiku', mode: 'leg', usage,
      op: 'leg', status: 'complete', attempt: 1, substitutedFor: 'opus', retryOfWaveId: 'w0' }, { dir });
    const [row] = readSpendRows(dir);
    expect(row.attempt).toBe(1);
    expect(row.substitutedFor).toBe('opus');
    expect(row.retryOfWaveId).toBe('w0');
  });

  test('carries finish when provided, as a linkage-style field (#218 PR 3)', () => {
    const dir = tmp();
    appendSpend({ taskId: 't5', waveId: 'w1', model: 'kimi', mode: 'leg', usage, op: 'leg', status: 'error', finish: 'length' }, { dir });
    const [row] = readSpendRows(dir);
    expect(row.finish).toBe('length');
    expect(row.status).toBe('error');
  });

  test('writes `variant` only when it is a string (#218 PR 4)', () => {
    const dir = tmp();
    appendSpend({ taskId: 't6', model: 'kimi', mode: 'headless', usage, op: 'start', variant: 'low' }, { dir });
    const [row] = readSpendRows(dir);
    expect(row.variant).toBe('low');

    const dirNoVariant = tmp();
    appendSpend({ taskId: 't7', model: 'kimi', mode: 'headless', usage, op: 'start' }, { dir: dirNoVariant });
    const [rowNoVariant] = readSpendRows(dirNoVariant);
    expect('variant' in rowNoVariant).toBe(false);

    // Named mutant "VARIANTNULLED": `row.variant = variant || null`.
    const dirBogus = tmp();
    appendSpend({ taskId: 't8', model: 'kimi', mode: 'headless', usage, op: 'start', variant: 7 }, { dir: dirBogus });
    const [rowBogus] = readSpendRows(dirBogus);
    expect('variant' in rowBogus).toBe(false);
  });

  test('a null usage still no-ops (unchanged guarantee)', () => {
    const dir = tmp();
    appendSpend({ taskId: 't4', model: 'gpt', mode: 'headless', usage: null, op: 'start' }, { dir });
    expect(readSpendRows(dir)).toEqual([]);
  });
});
