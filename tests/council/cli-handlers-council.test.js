// tests/council/cli-handlers-council.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { handleCouncil } = require('../../src/cli-handlers-council');
const avInput = require('./fixtures/av-receiver-input');

function capture(fn) {
  const out = []; const orig = process.stdout.write;
  process.stdout.write = (s) => { out.push(s); return true; };
  return Promise.resolve().then(fn)
    .then(code => ({ code, out: out.join('') }))
    .finally(() => { process.stdout.write = orig; });
}

test('tally reads input.json and prints a record on --json', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-cli-'));
  const file = path.join(dir, 'input.json');
  fs.writeFileSync(file, JSON.stringify(avInput));
  const { code, out } = await capture(() => handleCouncil({ _: ['council', 'tally', file], json: true }));
  expect(code).toBe(0);
  const doc = JSON.parse(out);
  expect(doc.tierCounts).toEqual({ Confirmed: 19, Contested: 2, Singleton: 11, Disputed: 3 });
});

test('tally with a missing file emits a BAD_ARGS envelope on stdout, exit 1', async () => {
  const { code, out } = await capture(() => handleCouncil({ _: ['council', 'tally', 'nope.json'], json: true }));
  expect(code).toBe(1);
  expect(JSON.parse(out).error.code).toBe('BAD_ARGS');
});

test('unknown subcommand → BAD_ARGS', async () => {
  const { code, out } = await capture(() => handleCouncil({ _: ['council', 'frobnicate'], json: true }));
  expect(code).toBe(1);
  expect(JSON.parse(out).error.code).toBe('BAD_ARGS');
});

test('structurally-invalid input (valid JSON, missing arrays) → BAD_ARGS', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-cli-'));
  const file = path.join(dir, 'bad.json');
  fs.writeFileSync(file, JSON.stringify({ meta: { models: [] } }));
  const { code, out } = await capture(() => handleCouncil({ _: ['council', 'tally', file], json: true }));
  expect(code).toBe(1);
  expect(JSON.parse(out).error.code).toBe('BAD_ARGS');
});

test('tally human render includes a cost line (sourced from runStats usage)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-cost-'));
  const file = path.join(dir, 'input.json');
  const withCost = {
    ...avInput,
    runStats: avInput.runStats.map((r, i) => ({
      ...r, usage: { tokens: { input: 100, output: 50 }, cost: { amount: 0.01 * (i + 1), source: 'reported' } },
    })),
  };
  fs.writeFileSync(file, JSON.stringify(withCost));
  const { code, out } = await capture(() => handleCouncil({ _: ['council', 'tally', file] })); // no --json
  expect(code).toBe(0);
  expect(out).toContain('Cost:');
  expect(out).toContain('$0.0600'); // 0.01+0.02+0.03 reported → toFixed(4)
});
