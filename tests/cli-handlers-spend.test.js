// tests/cli-handlers-spend.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { handleSpend } = require('../src/cli-handlers-spend');
const { SPEND_LEDGER_FILE, SPEND_LEDGER_SCHEMA_VERSION } = require('../src/utils/spend-ledger');
const { SCHEMA_VERSION } = require('../src/utils/result-schema');

function capture(fn) {
  const out = [];
  const orig = process.stdout.write;
  process.stdout.write = (s) => { out.push(s); return true; };
  return Promise.resolve().then(fn)
    .then(code => ({ code, out: out.join('') }))
    .finally(() => { process.stdout.write = orig; });
}

let ledgerDir;
beforeEach(() => {
  ledgerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spend-cli-'));
});

function row(overrides) {
  return {
    schemaVersion: SPEND_LEDGER_SCHEMA_VERSION,
    ts: new Date().toISOString(),
    taskId: 'r1', waveId: null, model: 'openrouter/anthropic/claude-opus-4.8', mode: 'headless',
    tokens: { input: 100, output: 50, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
    cost: { amount: 0.01, currency: 'USD', source: 'reported' },
    ...overrides,
  };
}

function writeRows(rows) {
  const file = path.join(ledgerDir, SPEND_LEDGER_FILE);
  fs.writeFileSync(file, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
}

function noCreditDeps(extra = {}) {
  return { dir: ledgerDir, readApiKeyValues: () => ({}), checkOpenRouterCredit: async () => ({ warning: null }), now: () => Date.now(), ...extra };
}

describe('amicus spend — rollup math', () => {
  test('totals + per-model rows, most-expensive first', async () => {
    writeRows([
      row({ taskId: 'a', model: 'opus', cost: { amount: 0.10, currency: 'USD', source: 'reported' } }),
      row({ taskId: 'b', model: 'gpt', cost: { amount: 0.50, currency: 'USD', source: 'reported' } }),
      row({ taskId: 'c', model: 'opus', cost: { amount: 0.05, currency: 'USD', source: 'reported' } }),
    ]);
    const { code, out } = await capture(() => handleSpend({ _: ['spend'], json: true }, noCreditDeps()));
    expect(code).toBe(0);
    const doc = JSON.parse(out);
    expect(doc.total.amount).toBeCloseTo(0.65, 6);
    expect(doc.byModel[0].model).toBe('gpt');   // most expensive first
    expect(doc.byModel[0].amount).toBeCloseTo(0.50, 6);
    expect(doc.byModel[0].runs).toBe(1);
    expect(doc.byModel[1].model).toBe('opus');
    expect(doc.byModel[1].amount).toBeCloseTo(0.15, 6);
    expect(doc.byModel[1].runs).toBe(2);
  });

  test('per-model source mix (reported/estimated/unknown counts)', async () => {
    writeRows([
      row({ taskId: 'a', model: 'opus', cost: { amount: 0.10, currency: 'USD', source: 'reported' } }),
      row({ taskId: 'b', model: 'opus', cost: { amount: 0.05, currency: 'USD', source: 'estimated' } }),
      row({ taskId: 'c', model: 'opus', cost: { amount: null, currency: 'USD', source: 'unknown' } }),
    ]);
    const { out } = await capture(() => handleSpend({ _: ['spend'], json: true }, noCreditDeps()));
    const doc = JSON.parse(out);
    const opus = doc.byModel.find(m => m.model === 'opus');
    expect(opus.sourceMix).toEqual({ reported: 1, estimated: 1, unknown: 1 });
    expect(opus.runs).toBe(3);
  });

  test('tokens are summed per model and overall', async () => {
    writeRows([
      row({ taskId: 'a', model: 'opus', tokens: { input: 100, output: 50, reasoning: 0, cacheRead: 0, cacheWrite: 0 } }),
      row({ taskId: 'b', model: 'opus', tokens: { input: 200, output: 20, reasoning: 0, cacheRead: 0, cacheWrite: 0 } }),
    ]);
    const { out } = await capture(() => handleSpend({ _: ['spend'], json: true }, noCreditDeps()));
    const doc = JSON.parse(out);
    expect(doc.total.tokens).toMatchObject({ input: 300, output: 70 });
    expect(doc.byModel[0].tokens).toMatchObject({ input: 300, output: 70 });
  });

  test('--since 7d restricts the window to the last 7 days', async () => {
    const now = new Date('2026-07-02T12:00:00.000Z').getTime();
    const eightDaysAgo = new Date(now - 8 * 86400000).toISOString();
    const oneDayAgo = new Date(now - 1 * 86400000).toISOString();
    writeRows([
      row({ taskId: 'old', ts: eightDaysAgo, cost: { amount: 1.00, currency: 'USD', source: 'reported' } }),
      row({ taskId: 'recent', ts: oneDayAgo, cost: { amount: 0.50, currency: 'USD', source: 'reported' } }),
    ]);
    const { out } = await capture(() => handleSpend({ _: ['spend'], json: true, since: '7d' }, noCreditDeps({ now: () => now })));
    const doc = JSON.parse(out);
    expect(doc.total.amount).toBeCloseTo(0.50, 6);
    expect(doc.windowDays).toBe(7);
  });

  test('--json doc has schemaVersion and type', async () => {
    writeRows([row({})]);
    const { out } = await capture(() => handleSpend({ _: ['spend'], json: true }, noCreditDeps()));
    const doc = JSON.parse(out);
    expect(doc.schemaVersion).toBe(SCHEMA_VERSION);
    expect(doc.type).toBe('spend');
  });

  test('empty ledger → friendly message, exit 0', async () => {
    const { code, out } = await capture(() => handleSpend({ _: ['spend'] }, noCreditDeps()));
    expect(code).toBe(0);
    expect(out.toLowerCase()).toMatch(/no spend recorded/);
  });

  test('missing ledger file entirely → same friendly message, exit 0', async () => {
    fs.rmSync(ledgerDir, { recursive: true, force: true });
    const { code, out } = await capture(() => handleSpend({ _: ['spend'] }, noCreditDeps()));
    expect(code).toBe(0);
    expect(out.toLowerCase()).toMatch(/no spend recorded/);
  });

  test('empty ledger skips the OpenRouter credit probe entirely (nothing to attach it to)', async () => {
    const checkSpy = jest.fn(async () => ({ warning: null, limitRemaining: 5 }));
    await capture(() => handleSpend({ _: ['spend'] },
      noCreditDeps({ readApiKeyValues: () => ({ openrouter: 'sk-or-abc' }), checkOpenRouterCredit: checkSpy })));
    expect(checkSpy).not.toHaveBeenCalled();
  });

  test('corrupt/unparseable rows are skipped, not fatal', async () => {
    const file = path.join(ledgerDir, SPEND_LEDGER_FILE);
    fs.writeFileSync(file, JSON.stringify(row({ taskId: 'ok' })) + '\n{ broken\n');
    const { code, out } = await capture(() => handleSpend({ _: ['spend'], json: true }, noCreditDeps()));
    expect(code).toBe(0);
    const doc = JSON.parse(out);
    expect(doc.total.runs).toBe(1);
  });

  test('human-mode output renders a table with model rows and a total line', async () => {
    writeRows([row({ model: 'opus', cost: { amount: 0.10, currency: 'USD', source: 'reported' } })]);
    const { out } = await capture(() => handleSpend({ _: ['spend'] }, noCreditDeps()));
    expect(out).toContain('opus');
    expect(out).toMatch(/\$0\.10/);
    expect(out.toLowerCase()).toContain('total');
  });
});

describe('amicus spend — OpenRouter credit footer', () => {
  test('shows remaining credit when an OpenRouter key is configured', async () => {
    writeRows([row({})]);
    const deps = noCreditDeps({
      readApiKeyValues: () => ({ openrouter: 'sk-or-abc' }),
      checkOpenRouterCredit: async () => ({ warning: null, limitRemaining: 12.34 }),
    });
    const { out } = await capture(() => handleSpend({ _: ['spend'] }, deps));
    expect(out).toMatch(/12\.34/);
  });

  test('skips the footer silently when no OpenRouter key is configured', async () => {
    writeRows([row({})]);
    const deps = noCreditDeps({ readApiKeyValues: () => ({}) });
    const checkSpy = jest.fn(async () => ({ warning: null, limitRemaining: 99 }));
    const { out } = await capture(() => handleSpend({ _: ['spend'] }, { ...deps, checkOpenRouterCredit: checkSpy }));
    expect(checkSpy).not.toHaveBeenCalled();
    expect(out).not.toMatch(/remaining/i);
  });

  test('a credit-check failure never fails the command (best-effort)', async () => {
    writeRows([row({})]);
    const deps = noCreditDeps({
      readApiKeyValues: () => ({ openrouter: 'sk-or-abc' }),
      checkOpenRouterCredit: async () => { throw new Error('network down'); },
    });
    const { code } = await capture(() => handleSpend({ _: ['spend'] }, deps));
    expect(code).toBe(0);
  });

  test('a credit check that never resolves does not block the command past ~5s', async () => {
    writeRows([row({})]);
    const deps = noCreditDeps({
      readApiKeyValues: () => ({ openrouter: 'sk-or-abc' }),
      checkOpenRouterCredit: () => new Promise(() => {}), // never resolves
    });
    const start = Date.now();
    const { code } = await capture(() => handleSpend({ _: ['spend'] }, deps));
    expect(code).toBe(0);
    expect(Date.now() - start).toBeLessThan(6000);
  }, 8000);
});
