// tests/council/cli-handlers-council.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { handleCouncil } = require('../../src/cli-handlers-council');
const avInput = require('./fixtures/av-receiver-input');
const { tally } = require('../../src/council/tally');
const { deriveReliability } = require('../../src/council/ledger');

function capture(fn) {
  const out = []; const orig = process.stdout.write;
  process.stdout.write = (s) => { out.push(s); return true; };
  return Promise.resolve().then(fn)
    .then(code => ({ code, out: out.join('') }))
    .finally(() => { process.stdout.write = orig; });
}

// Redirect the ledger (council-ledger.jsonl lives under getConfigDir()) to a
// temp dir so tally's auto-append never touches the real ~/.config ledger.
let prevConfigDir;
let ledgerDir;
beforeEach(() => {
  prevConfigDir = process.env.AMICUS_CONFIG_DIR;
  ledgerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-cfg-'));
  process.env.AMICUS_CONFIG_DIR = ledgerDir;
});
afterEach(() => {
  if (prevConfigDir === undefined) { delete process.env.AMICUS_CONFIG_DIR; }
  else { process.env.AMICUS_CONFIG_DIR = prevConfigDir; }
});

test('tally auto-appends a ledger row that council stats then reflects', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-cli-'));
  const file = path.join(dir, 'input.json');
  fs.writeFileSync(file, JSON.stringify(avInput));
  expect(deriveReliability({ dir: ledgerDir })).toEqual([]); // empty before the run
  const { code } = await capture(() => handleCouncil({ _: ['council', 'tally', file], json: true }));
  expect(code).toBe(0);
  const gpt = deriveReliability({ dir: ledgerDir }).find(a => a.model === 'gpt');
  expect(gpt).toBeDefined();
  expect(gpt.runs).toBe(1);
});

test('tally --no-ledger computes the record without appending a row', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-cli-'));
  const file = path.join(dir, 'input.json');
  fs.writeFileSync(file, JSON.stringify(avInput));
  const { code, out } = await capture(() =>
    handleCouncil({ _: ['council', 'tally', file], json: true, 'no-ledger': true }));
  expect(code).toBe(0);
  expect(JSON.parse(out).tierCounts).toBeDefined();      // record still produced
  expect(deriveReliability({ dir: ledgerDir })).toEqual([]); // but nothing recorded
});

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

const { buildVerdict } = require('../../src/council/verdict');

function writeVerdict(dir) {
  const v = buildVerdict(tally(avInput), [{ id: 'C6', decision: 'denied', applied: false }]);
  const p = path.join(dir, 'verdict.json');
  fs.writeFileSync(p, JSON.stringify(v));
  return p;
}

test('report renders markdown from a verdict.json (default --md)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-rep-'));
  const vp = writeVerdict(dir);
  const { code, out } = await capture(() => handleCouncil({ _: ['council', 'report', vp] }));
  expect(code).toBe(0);
  expect(out).toContain('# Council Report');
  expect(out).toContain('Adjudication matrix');
});

test('report --html emits a self-contained document', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-rep-'));
  const vp = writeVerdict(dir);
  const { code, out } = await capture(() => handleCouncil({ _: ['council', 'report', vp], html: true }));
  expect(code).toBe(0);
  expect(out).toContain('<!DOCTYPE html>');
  expect(out).toContain('<table');
});

test('report with a missing path → BAD_ARGS envelope on stdout, exit 1', async () => {
  const { code, out } = await capture(() => handleCouncil({ _: ['council', 'report'], json: true }));
  expect(code).toBe(1);
  expect(JSON.parse(out).error.code).toBe('BAD_ARGS');
});
