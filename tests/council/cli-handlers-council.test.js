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
});
