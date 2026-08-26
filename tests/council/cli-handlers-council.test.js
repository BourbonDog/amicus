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

// v4.9 W5.4 gate 2. MEASURED: tally() copies `meta` VERBATIM from the input
// onto the returned record (tally.js — the `meta` key of the return literal),
// so the gate reads the RECORD's meta.intent, not a re-parse of the input.
// Named mutant LEDGERGATE2: drop the intent conjunct in runTally's append
// gate — the task test goes red (a ledger row appears). The auto-append test
// above is the absent-intent control; the explicit-'review' test pins that a
// hand-assembled input saying 'review' still appends.
test("tally with meta.intent 'task' computes the record but appends NO ledger row", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-cli-task-'));
  const file = path.join(dir, 'input.json');
  fs.writeFileSync(file, JSON.stringify({ ...avInput, meta: { ...avInput.meta, intent: 'task' } }));
  const { code, out } = await capture(() => handleCouncil({ _: ['council', 'tally', file], json: true }));
  expect(code).toBe(0);
  expect(JSON.parse(out).tierCounts).toBeDefined();      // record still produced
  expect(deriveReliability({ dir: ledgerDir })).toEqual([]); // but nothing recorded
});

test("tally with an explicit meta.intent 'review' still appends (hand-assembled inputs may materialize it)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-cli-rev-'));
  const file = path.join(dir, 'input.json');
  fs.writeFileSync(file, JSON.stringify({ ...avInput, meta: { ...avInput.meta, intent: 'review' } }));
  const { code } = await capture(() => handleCouncil({ _: ['council', 'tally', file], json: true }));
  expect(code).toBe(0);
  const gpt = deriveReliability({ dir: ledgerDir }).find(a => a.model === 'gpt');
  expect(gpt).toBeDefined();
  expect(gpt.runs).toBe(1);
});

test('stats --json emits the wrapped council-stats doc, not a bare array (v4.0 §7)', async () => {
  const { code, out } = await capture(() => handleCouncil({ _: ['council', 'stats'], json: true }));
  expect(code).toBe(0);
  const doc = JSON.parse(out);
  expect(Array.isArray(doc)).toBe(false);
  expect(doc.schemaVersion).toBe(2);
  expect(doc.type).toBe('council-stats');
  expect(Array.isArray(doc.models)).toBe(true);
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

test('validate --json carries the council v2 envelope, additive over ok/findings/errors (v4.0 §7)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-validate-env-'));
  const p = path.join(dir, 'review.md');
  fs.writeFileSync(p, 'prose\n```json\n{"findings":[{"id":1,"severity":"minor","claim":"c","location":"l","rationale":"r"}]}\n```');
  const { code, out } = await capture(() => handleCouncil({ _: ['council', 'validate', p], json: true }));
  expect(code).toBe(0);
  const doc = JSON.parse(out);
  expect(doc.schemaVersion).toBe(2);
  expect(doc.type).toBe('council-validate');
  expect(doc.ok).toBe(true);
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
  expect(written.schemaVersion).toBe(2);
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
    _: ['council', 'verdict', tallyPath], decisions: decisionsPath, out: outPath, json: true,
  }));
  expect(code).toBe(0);
  const doc = JSON.parse(out);
  expect(doc.schemaVersion).toBe(2);
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

// v4.8 PR4c §3.4 — the SECOND buildVerdict call path. The engine reaches
// buildVerdict through run-verdict-files.js; this Stage-5 rebuild reaches it
// from a raw `JSON.parse` of a tally.json with no schema in between
// (cli-handlers-council.js), and it OVERWRITES the run's verdict.json. One fix
// covers both only if nothing on this path drops the keys — so it is measured
// here rather than argued.
test('verdict: the Stage-5 CLI rebuild carries raiserSeat and sameModelCorroboration', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-verdict-seat-'));
  const record = tally({
    meta: { runId: 'twin', runType: 'headless', date: 'd',
      models: ['deepseek', 'deepseek', 'gpt'], chair: 'gemini', claudeInCouncil: false },
    rankings: [], runStats: [],
    findings: [{ id: 'F1', raiser: 'deepseek', raiserSeat: 'deepseek#1', severity: 'major', claim: 'c' }],
    adjudications: [{ findingId: 'F1', judge: 'deepseek', verdict: 'agree', seat: 'deepseek#2' }],
  });
  // The tally.json ON DISK — the CLI's only input.
  const tallyPath = path.join(dir, 'tally.json');
  fs.writeFileSync(tallyPath, JSON.stringify(record));
  expect(record.findings[0].raiserSeat).toBe('deepseek#1');
  expect(record.findings[0].sameModelCorroboration).toBe(true);

  const outPath = path.join(dir, 'verdict.json');
  const { code } = await capture(() =>
    handleCouncil({ _: ['council', 'verdict', tallyPath], out: outPath }));
  expect(code).toBe(0);
  // The verdict.json THIS COMMAND WROTE.
  const written = JSON.parse(fs.readFileSync(outPath, 'utf-8'));
  expect(written.findings[0].raiserSeat).toBe('deepseek#1');
  expect(written.findings[0].sameModelCorroboration).toBe(true);
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

test('verdict: decisions.json is an object, not an array → BAD_ARGS whose hint mentions the decisions array', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-verdict-'));
  const tallyPath = writeTally(dir);
  const objectDecisions = path.join(dir, 'object-decisions.json');
  fs.writeFileSync(objectDecisions, JSON.stringify({ id: 'C6', decision: 'denied' }));
  const { code, out } = await capture(() => handleCouncil({
    _: ['council', 'verdict', tallyPath], decisions: objectDecisions, json: true,
  }));
  expect(code).toBe(1);
  const doc = JSON.parse(out);
  expect(doc.error.code).toBe('BAD_ARGS');
  expect(doc.error.hint).toMatch(/decisions/);
  expect(doc.error.hint).toMatch(/array/i);
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

test('verdict: rebuild preserves prior seatLoss and degrades from the run folder verbatim (#87)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-verdict-'));
  const tallyPath = writeTally(dir);
  const priorSeatLoss = { criticRequested: 'critic-m', criticSeated: false, reason: 'timeout', deadBenchSeats: ['beta'] };
  const priorDegrades = [{ kind: 'degrade', channel: 'dead-leg', what: 'w', why: 'y', effect: 'e' }];
  // The run folder's own verdict.json — the tally's sibling — is what #87 was
  // silently destroying; the rebuild must read it back before overwriting it.
  fs.writeFileSync(path.join(dir, 'verdict.json'), JSON.stringify({
    runId: 'av-receiver-council', seatLoss: priorSeatLoss, degrades: priorDegrades,
  }));
  const outPath = path.join(dir, 'out-verdict.json');
  const { code, out } = await capture(() => handleCouncil({
    _: ['council', 'verdict', tallyPath], out: outPath, json: true,
  }));
  expect(code).toBe(0);
  const doc = JSON.parse(out);
  expect(doc.seatLoss).toEqual(priorSeatLoss);
  expect(doc.degrades).toEqual(priorDegrades);
});

test('verdict: rebuild has neither seatLoss nor degrades when no prior verdict.json exists (#87)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-verdict-'));
  const tallyPath = writeTally(dir);
  const outPath = path.join(dir, 'verdict.json');
  const { code, out } = await capture(() => handleCouncil({
    _: ['council', 'verdict', tallyPath], out: outPath, json: true,
  }));
  expect(code).toBe(0);
  const doc = JSON.parse(out);
  expect(doc).not.toHaveProperty('seatLoss');
  expect(doc).not.toHaveProperty('degrades');
});

test('verdict: a valueless -o/--out errors instead of writing a file named true (v4.6.3 R1)', async () => {
  // parseArgs records a trailing bare -o as boolean true (cli.js:104-115)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-verdict-'));
  const tallyPath = writeTally(dir);
  const cwd = process.cwd();
  process.chdir(dir);
  let result;
  try {
    result = await capture(() => handleCouncil({ _: ['council', 'verdict', tallyPath], out: true, json: true }));
  } finally {
    process.chdir(cwd);
  }
  expect(result.code).toBe(1);
  const doc = JSON.parse(result.out);
  expect(doc.error.code).toBe('BAD_ARGS');
  expect(doc.error.message).toMatch(/-o\/--out/);
  // Verify no artifacts leaked: directory should only contain the seeded tally file
  expect(fs.readdirSync(dir).sort()).toEqual(['tally.json']);
});

test('verdict: an empty --out= value errors the same way, never silently defaulting', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-verdict-'));
  const tallyPath = writeTally(dir);
  const cwd = process.cwd();
  process.chdir(dir);
  let result;
  try {
    result = await capture(() => handleCouncil({ _: ['council', 'verdict', tallyPath], out: '', json: true }));
  } finally {
    process.chdir(cwd);
  }
  expect(result.code).toBe(1);
  expect(JSON.parse(result.out).error.code).toBe('BAD_ARGS');
  // Verify no artifacts leaked: directory should only contain the seeded tally file
  expect(fs.readdirSync(dir).sort()).toEqual(['tally.json']);
});

test('verdict: a dash-leading -o/--out value errors instead of writing a file literally named that token (R5)', async () => {
  // Before R5, parseArgs treated '-x' as a legitimate string value (only a
  // bare/empty -o/--out tripped the v4.6.3 R1 guard above), so this resolved
  // straight through to writeVerdictAtomic('-x', verdict) — a file named
  // '-x' landing in cwd. Same failure class as R1, one form short.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-verdict-'));
  const tallyPath = writeTally(dir);
  const cwd = process.cwd();
  process.chdir(dir);
  let result;
  try {
    result = await capture(() => handleCouncil({ _: ['council', 'verdict', tallyPath], out: '-x', json: true }));
  } finally {
    process.chdir(cwd);
  }
  expect(result.code).toBe(1);
  const doc = JSON.parse(result.out);
  expect(doc.error.code).toBe('BAD_ARGS');
  expect(doc.error.message).toMatch(/-o\/--out/);
  // Verify no artifacts leaked: directory should only contain the seeded tally file (no '-x')
  expect(fs.readdirSync(dir).sort()).toEqual(['tally.json']);
});

// ---------------------------------------------------------------------------
// renderStats (v4.7 GOA-7 D10 surfaces)
// ---------------------------------------------------------------------------
// renderStats is not exported (no sibling render helper is either — see
// module.exports), so these drive it through `council stats` (human mode)
// with the ledger redirected to the outer beforeEach's tmp `ledgerDir`,
// seeding raw ledger rows the same way tests/council/ledger.test.js does
// (deriveReliability's real aggregation produces the aliases[]/legacy shape
// renderStats consumes — no need to hand-build aggregate rows).
function ledgerRow(overrides = {}) {
  const base = {
    schemaVersion: 2, runId: 'r1', date: '2026-08-01', runType: 'headless',
    model: 'alpha', role: 'seat', wasChair: false, judged: true,
    streetCredWithSelf: 1, streetCredPeersOnly: 1,
    findingsRaised: 0, bySeverity: { blocker: 0, major: 0, minor: 0, nit: 0 },
    confirmRate: 1, factErrorRate: 0, conformance: 'clean',
  };
  const merged = { ...base, ...overrides };
  if (!('resolvedModel' in overrides)) { delete merged.resolvedModel; }
  return merged;
}
function appendLedgerRows(rows) {
  const file = path.join(ledgerDir, 'council-ledger.jsonl');
  for (const r of rows) { fs.appendFileSync(file, JSON.stringify(r) + '\n'); }
}

/**
 * v4.9 W8 T-B — the zero-rows surface self-diagnoses (ruling V5 / spec §10.4's R10
 * gap: "`amicus council stats` under-reports with no in-band way to say so").
 *
 * An empty reliability table is AMBIGUOUS in exactly one direction that matters
 * now: a fresh install and a task-only install render identically, because task
 * runs never append a ledger row (the intent gate in `runTally`, pinned above by
 * "tally with meta.intent 'task' computes the record but appends NO ledger row").
 * One line closes that, at the only site that can know the table is empty.
 *
 * Named mutant STATSSILENT: drop the second line from the `!agg.length` branch.
 * RED SET: the zero-rows test below. The non-empty control stays green — it is
 * the absence pin, and the five renderStats tests below it are the byte-level
 * proof that a populated table is untouched.
 */
describe('renderStats zero-rows self-diagnosis (v4.9 W8)', () => {
  test('an empty ledger says WHY it can be empty — task runs write no reliability rows', async () => {
    const { code, out } = await capture(() => handleCouncil({ _: ['council', 'stats'] }));
    expect(code).toBe(0);
    expect(out).toBe('No council runs recorded yet.\n'
      + 'Task runs never write reliability rows; a task-only install has no history here.\n');
  });

  test('a populated ledger renders no self-diagnosis line (control)', async () => {
    appendLedgerRows([ledgerRow({ model: 'gpt', resolvedModel: 'openai/gpt-5.2' })]);
    const { code, out } = await capture(() => handleCouncil({ _: ['council', 'stats'] }));
    expect(code).toBe(0);
    expect(out).not.toContain('Task runs never write reliability rows');
    expect(out).not.toContain('No council runs recorded yet');
    expect(out).toContain('openai/gpt-5.2');       // non-vacuous: the table really rendered
  });

  test('--json is unchanged — the line is human-render only', async () => {
    const { code, out } = await capture(() => handleCouncil({ _: ['council', 'stats'], json: true }));
    expect(code).toBe(0);
    expect(out).not.toContain('Task runs never write reliability rows');
    expect(JSON.parse(out).models).toEqual([]);
  });
});

describe('renderStats (v4.7 GOA-7 D10 surfaces)', () => {
  test('legacy groups carry a legacy marker in the notes column', async () => {
    // No resolvedModel on any row → deriveReliability marks the group legacy.
    appendLedgerRows([
      ledgerRow({ model: 'gemini' }), ledgerRow({ model: 'gemini' }), ledgerRow({ model: 'gemini' }),
      ledgerRow({ model: 'gemini' }), ledgerRow({ model: 'gemini' }),
    ]);
    const { code, out } = await capture(() => handleCouncil({ _: ['council', 'stats'] }));
    expect(code).toBe(0);
    expect(out).toContain('legacy');
  });

  test('a resolved-id key longer than 16 chars widens the model column instead of shifting it', async () => {
    appendLedgerRows([ledgerRow({ model: 'qwen', resolvedModel: 'openrouter/qwen/qwen3-max' })]);
    const { code, out } = await capture(() => handleCouncil({ _: ['council', 'stats'] }));
    expect(code).toBe(0);
    const [header, row] = out.split('\n');
    expect(header.indexOf('runs')).toBeGreaterThan('openrouter/qwen/qwen3-max'.length);
    expect(row.startsWith('openrouter/qwen/qwen3-max ')).toBe(true);
  });

  test('non-legacy rows render no legacy marker', async () => {
    appendLedgerRows([
      ledgerRow({ model: 'gpt', resolvedModel: 'openai/gpt-5.2' }),
      ledgerRow({ model: 'gpt', resolvedModel: 'openai/gpt-5.2' }),
      ledgerRow({ model: 'gpt', resolvedModel: 'openai/gpt-5.2' }),
      ledgerRow({ model: 'gpt', resolvedModel: 'openai/gpt-5.2' }),
    ]);
    const { code, out } = await capture(() => handleCouncil({ _: ['council', 'stats'] }));
    expect(code).toBe(0);
    expect(out).not.toContain('legacy');
    // Non-vacuous: the resolved id must actually appear in the rendered row,
    // so this test can't pass against an empty/blank table.
    expect(out).toContain('openai/gpt-5.2');
  });

  // Final-review consolidated wave (item 3b): pins BOTH co-occurrence and
  // column ORDER of the two notes markers on one row — low-N (runs < 3) and
  // legacy (every row in the group lacks resolvedModel) are independent
  // conditions that a single group can satisfy simultaneously, and renderStats
  // always appends low-N before legacy (cli-handlers-council.js's `${a.lowN ?
  // '   low-N' : ''}${a.legacy ? '   legacy' : ''}`).
  test('a low-N legacy group renders both markers on one row, low-N before legacy', async () => {
    appendLedgerRows([ledgerRow({ model: 'gemini' })]);  // runs=1 → lowN; no resolvedModel → legacy
    const { code, out } = await capture(() => handleCouncil({ _: ['council', 'stats'] }));
    expect(code).toBe(0);
    const row = out.split('\n').find(l => l.startsWith('gemini'));
    expect(row).toContain('low-N   legacy');
  });

  // Final-review consolidated wave (item 3c): byte-identity pin on the fixed
  // header layout for the common case (all keys ≤ 16 chars, so the model
  // column floors at 16) — guards the exact column widths/spacing against an
  // accidental reformat, not just substring presence.
  test('header line is byte-identical to the fixed 16-char-floor layout when all keys are short', async () => {
    appendLedgerRows([ledgerRow({ model: 'gpt', resolvedModel: 'openai/gpt-5.2' })]);
    const { code, out } = await capture(() => handleCouncil({ _: ['council', 'stats'] }));
    expect(code).toBe(0);
    const [header] = out.split('\n');
    expect(header).toBe('model            runs  avg-cred  confirm  fact-err  notes');
  });
});

// ---------------------------------------------------------------------------
// council save / list / show (B23)
// ---------------------------------------------------------------------------

function seedAliases(aliases) {
  const { loadConfig, saveConfig } = require('../../src/utils/config');
  const cfg = loadConfig() || {};
  cfg.aliases = { ...(cfg.aliases || {}), ...aliases };
  saveConfig(cfg);
}

describe('council save', () => {
  test('happy path saves a >=2 member council and confirms it', async () => {
    const { code, out } = await capture(() =>
      handleCouncil({ _: ['council', 'save', 'mine'], models: 'opus,gpt', json: true }));
    expect(code).toBe(0);
    const doc = JSON.parse(out);
    expect(doc.ok).toBe(true);
    expect(doc.name).toBe('mine');
    expect(doc.models).toEqual(['opus', 'gpt']);
    const { getCouncil } = require('../../src/utils/config');
    expect(getCouncil('mine')).toEqual(['opus', 'gpt']);
  });

  test('human-mode save prints a confirmation line', async () => {
    const { code, out } = await capture(() =>
      handleCouncil({ _: ['council', 'save', 'mine'], models: 'opus,gpt' }));
    expect(code).toBe(0);
    expect(out).toContain('mine');
    expect(out).toContain('opus');
    expect(out).toContain('gpt');
  });

  test('overwriting an existing name succeeds with a notice', async () => {
    await capture(() => handleCouncil({ _: ['council', 'save', 'mine'], models: 'opus,gpt', json: true }));
    const { code, out } = await capture(() =>
      handleCouncil({ _: ['council', 'save', 'mine'], models: 'haiku,deepseek', json: true }));
    expect(code).toBe(0);
    const doc = JSON.parse(out);
    expect(doc.overwritten).toBe(true);
    expect(doc.models).toEqual(['haiku', 'deepseek']);
    const { getCouncil } = require('../../src/utils/config');
    expect(getCouncil('mine')).toEqual(['haiku', 'deepseek']);
  });

  test('rejects fewer than 2 members', async () => {
    const { code, out } = await capture(() =>
      handleCouncil({ _: ['council', 'save', 'solo'], models: 'opus', json: true }));
    expect(code).toBe(1);
    expect(JSON.parse(out).error.code).toBe('BAD_ARGS');
    const { getCouncil } = require('../../src/utils/config');
    expect(getCouncil('solo')).toBeNull();
  });

  test('rejects an unresolvable member (unknown alias, not a provider/model id)', async () => {
    const { code, out } = await capture(() =>
      handleCouncil({ _: ['council', 'save', 'bad'], models: 'opus,not-a-real-alias', json: true }));
    expect(code).toBe(1);
    expect(JSON.parse(out).error.code).toBe('BAD_ARGS');
  });

  test('accepts a full provider/model id alongside an alias', async () => {
    const { code, out } = await capture(() =>
      handleCouncil({ _: ['council', 'save', 'mixed'], models: 'opus,openrouter/some/vendor-model', json: true }));
    expect(code).toBe(0);
    expect(JSON.parse(out).models).toEqual(['opus', 'openrouter/some/vendor-model']);
  });

  test('missing --models → BAD_ARGS', async () => {
    const { code, out } = await capture(() =>
      handleCouncil({ _: ['council', 'save', 'mine'], json: true }));
    expect(code).toBe(1);
    expect(JSON.parse(out).error.code).toBe('BAD_ARGS');
  });

  test('missing name → BAD_ARGS', async () => {
    const { code, out } = await capture(() =>
      handleCouncil({ _: ['council', 'save'], models: 'opus,gpt', json: true }));
    expect(code).toBe(1);
    expect(JSON.parse(out).error.code).toBe('BAD_ARGS');
  });

  test('saving a name that collides with a built-in bench name shadows it (allowed)', async () => {
    const { code, out } = await capture(() =>
      handleCouncil({ _: ['council', 'save', 'budget'], models: 'opus,gpt', json: true }));
    expect(code).toBe(0); // allowed — this is exactly how a user shadows a built-in
    expect(JSON.parse(out).ok).toBe(true);
    const { getCouncil } = require('../../src/utils/config');
    expect(getCouncil('budget')).toEqual(['opus', 'gpt']);
  });

  test('saving a built-in bench name reports shadowsBuiltin and prints the notice (v4.6.3 D7)', async () => {
    const { code, out } = await capture(() =>
      handleCouncil({ _: ['council', 'save', 'budget'], models: 'deepseek,glm', json: true }));
    expect(code).toBe(0);
    const doc = JSON.parse(out);
    expect(doc.ok).toBe(true);
    expect(doc.shadowsBuiltin).toBe(true);
    expect(doc.overwritten).toBe(false); // first save: nothing in user config — the old marker under-fired here
  });

  test('re-saving a shadowing name is BOTH overwritten and shadowsBuiltin', async () => {
    await capture(() => handleCouncil({ _: ['council', 'save', 'budget'], models: 'deepseek,glm', json: true }));
    const { code, out } = await capture(() =>
      handleCouncil({ _: ['council', 'save', 'budget'], models: 'haiku,opus', json: true }));
    expect(code).toBe(0);
    const doc = JSON.parse(out);
    expect(doc.overwritten).toBe(true);
    expect(doc.shadowsBuiltin).toBe(true);
  });

  test('a non-built-in name reports shadowsBuiltin false and prints no shadow notice', async () => {
    const { code, out } = await capture(() =>
      handleCouncil({ _: ['council', 'save', 'mine'], models: 'deepseek,glm' }));
    expect(code).toBe(0);
    expect(out).not.toMatch(/shadows the built-in/);
  });

  test('human-mode shadow save prints the notice line', async () => {
    const { out } = await capture(() =>
      handleCouncil({ _: ['council', 'save', 'frontier'], models: 'deepseek,glm' }));
    expect(out).toMatch(/shadows the built-in bench of the same name/);
  });

  test('human-mode re-save of a shadowing name prints BOTH the overwritten marker and the shadow notice', async () => {
    await capture(() => handleCouncil({ _: ['council', 'save', 'budget'], models: 'deepseek,glm' }));
    const { code, out } = await capture(() =>
      handleCouncil({ _: ['council', 'save', 'budget'], models: 'haiku,opus' }));
    expect(code).toBe(0);
    expect(out).toContain("Saved council 'budget' (overwritten): haiku, opus");
    expect(out).toMatch(/shadows the built-in bench of the same name/);
  });
});

describe('council list', () => {
  test('lists built-ins plus user-saved councils, marking built-ins', async () => {
    await capture(() => handleCouncil({ _: ['council', 'save', 'mine'], models: 'opus,gpt', json: true }));
    const { code, out } = await capture(() => handleCouncil({ _: ['council', 'list'], json: true }));
    expect(code).toBe(0);
    const doc = JSON.parse(out);
    const names = doc.councils.map(c => c.name);
    expect(names).toEqual(expect.arrayContaining(['free', 'budget', 'frontier', 'mine']));
    const builtin = doc.councils.find(c => c.name === 'budget');
    expect(builtin.builtin).toBe(true);
    const custom = doc.councils.find(c => c.name === 'mine');
    expect(custom.builtin).toBe(false);
  });

  test('marks a built-in as shadowed when the user has saved a same-named council', async () => {
    await capture(() => handleCouncil({ _: ['council', 'save', 'budget'], models: 'opus,gpt', json: true }));
    const { code, out } = await capture(() => handleCouncil({ _: ['council', 'list'], json: true }));
    expect(code).toBe(0);
    const doc = JSON.parse(out);
    const entries = doc.councils.filter(c => c.name === 'budget');
    // one user entry that shadows the built-in; the built-in itself is flagged shadowed
    const userEntry = entries.find(c => c.builtin === false);
    const builtinEntry = entries.find(c => c.builtin === true);
    expect(userEntry).toBeDefined();
    expect(builtinEntry.shadowed).toBe(true);
  });

  test('human-mode list prints names with a [built-in] marker', async () => {
    const { code, out } = await capture(() => handleCouncil({ _: ['council', 'list'] }));
    expect(code).toBe(0);
    expect(out).toContain('free');
    expect(out).toContain('budget');
    expect(out).toContain('frontier');
    expect(out.toLowerCase()).toContain('built-in');
  });
});

describe('council show', () => {
  test('shows a user-saved council with resolution results', async () => {
    await capture(() => handleCouncil({ _: ['council', 'save', 'mine'], models: 'opus,gpt', json: true }));
    const { code, out } = await capture(() => handleCouncil({ _: ['council', 'show', 'mine'], json: true }));
    expect(code).toBe(0);
    const doc = JSON.parse(out);
    expect(doc.name).toBe('mine');
    expect(doc.builtin).toBe(false);
    expect(doc.members).toEqual(['opus', 'gpt']);
    expect(doc.resolved).toEqual(['opus', 'gpt']);
    expect(doc.dropped).toEqual([]);
  });

  test('shows a built-in bench (budget) with builtin:true', async () => {
    const { code, out } = await capture(() => handleCouncil({ _: ['council', 'show', 'budget'], json: true }));
    expect(code).toBe(0);
    const doc = JSON.parse(out);
    expect(doc.name).toBe('budget');
    expect(doc.builtin).toBe(true);
    expect(doc.resolved.length).toBeGreaterThanOrEqual(2);
  });

  test('shows the dynamic free bench with builtin:true and resolved members', async () => {
    const { code, out } = await capture(() => handleCouncil({ _: ['council', 'show', 'free'], json: true }));
    expect(code).toBe(0);
    const doc = JSON.parse(out);
    expect(doc.name).toBe('free');
    expect(doc.builtin).toBe(true);
    expect(doc.resolved.length).toBeGreaterThanOrEqual(2);
  });

  test('show free resolves against the cached catalog, not the offline pinned fallback', async () => {
    // Seed a :free-rows catalog whose picks differ from PINNED_FREE_MODELS,
    // so this only passes if `show` actually reads the cache (B24 rider fix).
    const catalogPath = path.join(ledgerDir, 'model-catalog.json');
    fs.writeFileSync(catalogPath, JSON.stringify({
      schemaVersion: 2,
      fetchedAt: Date.now(),
      models: [
        { id: 'openrouter/mistralai/mistral-small:free', name: 'Mistral Small (free)' },
        { id: 'openrouter/nvidia/nemotron:free', name: 'Nemotron (free)' },
      ],
    }));
    const { code, out } = await capture(() => handleCouncil({ _: ['council', 'show', 'free'], json: true }));
    expect(code).toBe(0);
    const doc = JSON.parse(out);
    expect(doc.builtin).toBe(true);
    expect(doc.members).toEqual(expect.arrayContaining([
      'openrouter/mistralai/mistral-small:free',
      'openrouter/nvidia/nemotron:free',
    ]));
    // The offline pinned fallback (deepseek-r1:free etc.) must NOT appear —
    // proves the dynamic catalog pick was used, not the empty-catalog fallback.
    expect(doc.members).not.toEqual(expect.arrayContaining(['openrouter/deepseek/deepseek-r1:free']));
  });

  test('free bench delists a previously-picked vendor when its :free row drops out of the catalog', async () => {
    // Catalog now has a free row for only ONE vendor (mistral) — the dynamic
    // free bench can only pick from what's present, so a vendor that used to
    // show up (e.g. deepseek/google/qwen from the pinned fallback) reports
    // as absent from `members` once the catalog is consulted at all.
    const catalogPath = path.join(ledgerDir, 'model-catalog.json');
    fs.writeFileSync(catalogPath, JSON.stringify({
      schemaVersion: 2,
      fetchedAt: Date.now(),
      models: [{ id: 'openrouter/mistralai/mistral-small:free', name: 'Mistral Small (free)' }],
    }));
    const { code, out } = await capture(() => handleCouncil({ _: ['council', 'show', 'free'], json: true }));
    expect(code).toBe(0);
    const doc = JSON.parse(out);
    expect(doc.members).toEqual(['openrouter/mistralai/mistral-small:free']);
    expect(doc.resolved).toEqual(['openrouter/mistralai/mistral-small:free']);
    expect(doc.members).not.toContain('openrouter/deepseek/deepseek-r1:free');
  });

  test('reports dropped/delisted members for a user council when aliases no longer resolve', async () => {
    seedAliases({ 'gone-alias': 'openrouter/dead/model-x' });
    await capture(() => handleCouncil({ _: ['council', 'save', 'flaky'], models: 'opus,gone-alias', json: true }));
    // Now remove the alias entirely so it no longer resolves.
    const { loadConfig, saveConfig } = require('../../src/utils/config');
    const cfg = loadConfig();
    delete cfg.aliases['gone-alias'];
    saveConfig(cfg);
    const { code, out } = await capture(() => handleCouncil({ _: ['council', 'show', 'flaky'], json: true }));
    expect(code).toBe(0);
    const doc = JSON.parse(out);
    expect(doc.dropped).toContain('gone-alias');
    expect(doc.resolved).toEqual(['opus']);
  });

  // v4.5 Wave 2 (post-HOLD chip, task-23-report.md Anomaly 1): `show`'s old
  // resolved/dropped split only asked "does this alias map to SOME id?" —
  // never "is that id still in the cached catalog?" — so a member whose
  // alias resolves to a catalog-absent id (e.g. a direct-vendor route with no
  // matching row in the cache) read as healthy here while the real run path
  // (resolveCouncilMembers) silently drops it on every actual run. This is
  // the live repro's shape: one bench member's resolved id present in the
  // catalog, one absent — `show` must now agree with resolveCouncilMembers
  // and report the catalog-absent one as dropped, not resolved.
  test('reports a catalog-absent member as dropped, matching resolveCouncilMembers (not merely whether the alias maps to SOME id)', async () => {
    seedAliases({ 'catalog-ghost': 'vendorx/ghost-model' });
    await capture(() => handleCouncil({ _: ['council', 'save', 'delisted-check'], models: 'opus,catalog-ghost', json: true }));
    const { getEffectiveAliases } = require('../../src/utils/config');
    const opusId = getEffectiveAliases().opus;
    // Catalog present (non-empty, so the tri-state "unknown never blocks" rule
    // does NOT apply) but omits catalog-ghost's resolved id.
    const catalogPath = path.join(ledgerDir, 'model-catalog.json');
    fs.writeFileSync(catalogPath, JSON.stringify({
      schemaVersion: 2, fetchedAt: Date.now(), models: [{ id: opusId }],
    }));
    const { code, out } = await capture(() => handleCouncil({ _: ['council', 'show', 'delisted-check'], json: true }));
    expect(code).toBe(0);
    const doc = JSON.parse(out);
    expect(doc.resolved).toEqual(['opus']);
    expect(doc.dropped).toEqual(['catalog-ghost']);
    // Reason detail (the new additive field run.json's droppedMembers also
    // uses) must distinguish this from an unresolvable-alias drop.
    expect(doc.droppedMembers).toEqual([
      { member: 'catalog-ghost', reason: expect.stringMatching(/catalog/i) },
    ]);
  });

  test('unknown name → BAD_ARGS error, exit 1', async () => {
    const { code, out } = await capture(() => handleCouncil({ _: ['council', 'show', 'ghost'], json: true }));
    expect(code).toBe(1);
    expect(JSON.parse(out).error.code).toBe('BAD_ARGS');
  });

  test('missing name → BAD_ARGS', async () => {
    const { code, out } = await capture(() => handleCouncil({ _: ['council', 'show'], json: true }));
    expect(code).toBe(1);
    expect(JSON.parse(out).error.code).toBe('BAD_ARGS');
  });

  test('human-mode show prints the member list', async () => {
    await capture(() => handleCouncil({ _: ['council', 'save', 'mine'], models: 'opus,gpt', json: true }));
    const { code, out } = await capture(() => handleCouncil({ _: ['council', 'show', 'mine'] }));
    expect(code).toBe(0);
    expect(out).toContain('opus');
    expect(out).toContain('gpt');
  });

  // v4.5 Wave 2 tri-state lock: empty/offline catalog (no model-catalog.json) →
  // no member drops, guaranteeing the rule at show's shared classifyCouncilMembers.
  test('show with empty offline catalog reports NO dropped members', async () => {
    const sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-show-offline-'));
    const prevConfigDir = process.env.AMICUS_CONFIG_DIR;
    process.env.AMICUS_CONFIG_DIR = sandboxDir;
    try {
      jest.resetModules();
      const { handleCouncil: HC } = require('../../src/cli-handlers-council');
      seedAliases({ 'test-offline': 'openrouter/test/model-x' });
      await capture(() => HC({ _: ['council', 'save', 'offline-test'], models: 'opus,test-offline', json: true }));
      const { code, out } = await capture(() => HC({ _: ['council', 'show', 'offline-test'], json: true }));
      expect(code).toBe(0);
      const doc = JSON.parse(out);
      expect(doc.resolved.length).toBeGreaterThanOrEqual(1);
      expect(doc.dropped).toEqual([]);
      expect(doc.droppedMembers).toEqual([]);
    } finally {
      if (prevConfigDir === undefined) { delete process.env.AMICUS_CONFIG_DIR; }
      else { process.env.AMICUS_CONFIG_DIR = prevConfigDir; }
      jest.resetModules();
      fs.rmSync(sandboxDir, { recursive: true, force: true });
    }
  });

  // v4.5 Wave 2 tri-state lock: a local-provider member (e.g. ollama/...) is
  // never dropped regardless of catalog state, guaranteeing the rule at show's
  // shared classifyCouncilMembers.
  test('show with local-provider member never reports it dropped', async () => {
    const sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-show-local-'));
    const prevConfigDir = process.env.AMICUS_CONFIG_DIR;
    process.env.AMICUS_CONFIG_DIR = sandboxDir;
    try {
      jest.resetModules();
      jest.doMock('../../src/utils/local-providers', () => ({
        isLocalProvider: (id) => id === 'ollama',
        getLocalProviders: () => ({ ollama: { id: 'ollama' } }),
      }));
      const { handleCouncil: HC } = require('../../src/cli-handlers-council');
      seedAliases({ 'gemini-alias': 'google/gemini-2.5-flash' });
      await capture(() => HC({ _: ['council', 'save', 'local-test'], models: 'gemini-alias,ollama/llama3.3', json: true }));
      // Write a catalog that includes only the cloud model, NOT the local one.
      const catalogPath = path.join(sandboxDir, 'model-catalog.json');
      fs.writeFileSync(catalogPath, JSON.stringify({
        schemaVersion: 2, fetchedAt: Date.now(), models: [{ id: 'google/gemini-2.5-flash' }],
      }));
      const { code, out } = await capture(() => HC({ _: ['council', 'show', 'local-test'], json: true }));
      expect(code).toBe(0);
      const doc = JSON.parse(out);
      expect(doc.members).toContain('ollama/llama3.3');
      expect(doc.resolved).toContain('ollama/llama3.3');
      expect(doc.dropped).not.toContain('ollama/llama3.3');
    } finally {
      if (prevConfigDir === undefined) { delete process.env.AMICUS_CONFIG_DIR; }
      else { process.env.AMICUS_CONFIG_DIR = prevConfigDir; }
      jest.resetModules();
      fs.rmSync(sandboxDir, { recursive: true, force: true });
    }
  });
});
