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
  expect(doc.tierCounts).toEqual({ Confirmed: 29, Contested: 2, Singleton: 1, Disputed: 3 });
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

// ---------------------------------------------------------------------------
// council validate
// ---------------------------------------------------------------------------

function goodFindingsText() {
  return 'Prose review goes here.\n\n```json\n' + JSON.stringify({
    overall: 'looks fine',
    findings: [{ id: 1, severity: 'blocker', claim: 'x', location: 'y', rationale: 'z' }],
  }) + '\n```\n';
}

test('validate: a well-formed findings block is ok, exit 0, --json prints the full result', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-validate-'));
  const file = path.join(dir, 'review-gpt.md');
  fs.writeFileSync(file, goodFindingsText());
  const { code, out } = await capture(() => handleCouncil({ _: ['council', 'validate', file], json: true }));
  expect(code).toBe(0);
  const doc = JSON.parse(out);
  expect(doc.ok).toBe(true);
  expect(doc.findings).toHaveLength(1);
  expect(doc.errors).toEqual([]);
});

test('validate: a well-formed findings block, human mode prints a one-line summary', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-validate-'));
  const file = path.join(dir, 'review-gpt.md');
  fs.writeFileSync(file, goodFindingsText());
  const { code, out } = await capture(() => handleCouncil({ _: ['council', 'validate', file] }));
  expect(code).toBe(0);
  expect(out).toContain('1 finding');
  expect(out).toContain('blocker');
});

test('validate: malformed findings JSON → exit 2 (distinct from BAD_ARGS), --json carries ok:false + errors', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-validate-'));
  const file = path.join(dir, 'review-bad.md');
  fs.writeFileSync(file, 'prose only, no fenced json block here');
  const { code, out } = await capture(() => handleCouncil({ _: ['council', 'validate', file], json: true }));
  expect(code).toBe(2);
  const doc = JSON.parse(out);
  expect(doc.ok).toBe(false);
  expect(doc.errors[0].code).toBe('NO_FENCED_BLOCK');
});

test('validate: malformed findings JSON, human mode prints each error code + detail', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-validate-'));
  const file = path.join(dir, 'review-bad.md');
  fs.writeFileSync(file, 'prose only, no fenced json block here');
  const { code, out } = await capture(() => handleCouncil({ _: ['council', 'validate', file] }));
  expect(code).toBe(2);
  expect(out).toContain('NO_FENCED_BLOCK');
  expect(out).toContain('no ```json block found');
});

test('validate: missing file → BAD_ARGS envelope, exit 1 (distinct from the ok:false exit 2)', async () => {
  const { code, out } = await capture(() => handleCouncil({ _: ['council', 'validate', 'nope.md'], json: true }));
  expect(code).toBe(1);
  expect(JSON.parse(out).error.code).toBe('BAD_ARGS');
});

test('validate: no path argument → BAD_ARGS envelope, exit 1', async () => {
  const { code, out } = await capture(() => handleCouncil({ _: ['council', 'validate'], json: true }));
  expect(code).toBe(1);
  expect(JSON.parse(out).error.code).toBe('BAD_ARGS');
});

// ---------------------------------------------------------------------------
// council verdict
// ---------------------------------------------------------------------------

function writeTally(dir) {
  const record = tally(avInput);
  const p = path.join(dir, 'tally.json');
  fs.writeFileSync(p, JSON.stringify(record));
  return p;
}

function writeDecisions(dir) {
  const p = path.join(dir, 'decisions.json');
  fs.writeFileSync(p, JSON.stringify([{ id: 'C6', decision: 'denied', applied: false }]));
  return p;
}

test('verdict: happy path writes verdict.json atomically to the default path and prints a summary', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-verdict-'));
  const tallyPath = writeTally(dir);
  const decisionsPath = writeDecisions(dir);
  const cwd = process.cwd();
  process.chdir(dir);
  let result;
  try {
    result = await capture(() =>
      handleCouncil({ _: ['council', 'verdict', tallyPath], decisions: decisionsPath }));
  } finally {
    process.chdir(cwd);
  }
  expect(result.code).toBe(0);
  const outPath = path.join(dir, 'verdict.json');
  expect(fs.existsSync(outPath)).toBe(true);
  const written = JSON.parse(fs.readFileSync(outPath, 'utf-8'));
  expect(written.schemaVersion).toBe(1);
  expect(written.runId).toBe('av-receiver-council');
  const denied = written.findings.find(f => f.id === 'C6');
  expect(denied.decision).toBe('denied');
  expect(result.out).toContain('schema');
});

test('verdict: --json prints the full verdict document', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-verdict-'));
  const tallyPath = writeTally(dir);
  const decisionsPath = writeDecisions(dir);
  const outPath = path.join(dir, 'out.json');
  const { code, out } = await capture(() => handleCouncil({
    _: ['council', 'verdict', tallyPath], decisions: decisionsPath, o: outPath, json: true,
  }));
  expect(code).toBe(0);
  const doc = JSON.parse(out);
  expect(doc.schemaVersion).toBe(1);
  expect(doc.findings.length).toBeGreaterThan(0);
  expect(fs.existsSync(outPath)).toBe(true);
});

test('verdict: -o/--out writes to a custom path', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-verdict-'));
  const tallyPath = writeTally(dir);
  const decisionsPath = writeDecisions(dir);
  const outPath = path.join(dir, 'custom-verdict.json');
  const { code } = await capture(() => handleCouncil({
    _: ['council', 'verdict', tallyPath], decisions: decisionsPath, out: outPath,
  }));
  expect(code).toBe(0);
  expect(fs.existsSync(outPath)).toBe(true);
  expect(fs.existsSync(path.join(dir, 'verdict.json'))).toBe(false);
});

test('verdict: --decisions is optional (defaults to [])', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-verdict-'));
  const tallyPath = writeTally(dir);
  const outPath = path.join(dir, 'verdict.json');
  const { code } = await capture(() => handleCouncil({ _: ['council', 'verdict', tallyPath], out: outPath }));
  expect(code).toBe(0);
  const written = JSON.parse(fs.readFileSync(outPath, 'utf-8'));
  expect(written.findings.every(f => f.decision === null)).toBe(true);
});

test('verdict: missing tally path → BAD_ARGS, exit 1', async () => {
  const { code, out } = await capture(() => handleCouncil({ _: ['council', 'verdict'], json: true }));
  expect(code).toBe(1);
  expect(JSON.parse(out).error.code).toBe('BAD_ARGS');
});

test('verdict: unreadable tally file → BAD_ARGS, exit 1', async () => {
  const { code, out } = await capture(() =>
    handleCouncil({ _: ['council', 'verdict', 'nope.json'], json: true }));
  expect(code).toBe(1);
  expect(JSON.parse(out).error.code).toBe('BAD_ARGS');
});

test('verdict: unparseable decisions file → BAD_ARGS, exit 1', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-verdict-'));
  const tallyPath = writeTally(dir);
  const badDecisions = path.join(dir, 'bad-decisions.json');
  fs.writeFileSync(badDecisions, 'not json');
  const { code, out } = await capture(() => handleCouncil({
    _: ['council', 'verdict', tallyPath], decisions: badDecisions, json: true,
  }));
  expect(code).toBe(1);
  expect(JSON.parse(out).error.code).toBe('BAD_ARGS');
});

test('verdict: malformed tally JSON (not valid JSON) → BAD_ARGS, exit 1', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-verdict-'));
  const tallyPath = path.join(dir, 'tally.json');
  fs.writeFileSync(tallyPath, 'not json');
  const { code, out } = await capture(() =>
    handleCouncil({ _: ['council', 'verdict', tallyPath], json: true }));
  expect(code).toBe(1);
  expect(JSON.parse(out).error.code).toBe('BAD_ARGS');
});

test('verdict: structurally-invalid tally (valid JSON, missing meta/findings) → BAD_ARGS, exit 1', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-verdict-'));
  const tallyPath = path.join(dir, 'tally.json');
  fs.writeFileSync(tallyPath, JSON.stringify({ foo: 'bar' }));
  const { code, out } = await capture(() =>
    handleCouncil({ _: ['council', 'verdict', tallyPath], json: true }));
  expect(code).toBe(1);
  expect(JSON.parse(out).error.code).toBe('BAD_ARGS');
});
