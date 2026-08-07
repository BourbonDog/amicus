'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { appendSpend, readSpendRows } = require('../src/utils/spend-ledger');
const { handleSpend, filterRows, groupRows, computeWasted, buildSpendDoc, aggregateSpend } = require('../src/cli-handlers-spend');
const { parseArgs } = require('../src/cli');

function seed() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spend-q-'));
  const u = (a) => ({ tokens: { input: 10, output: 5 }, cost: { amount: a, currency: 'USD', source: 'reported' } });
  appendSpend({ taskId: 'a', waveId: 'w1', model: 'gpt', mode: 'leg', usage: u(0.10), op: 'leg', status: 'complete', councilRunId: 'c1', councilName: 'default', project: '/p1', gateway: 'direct' }, { dir });
  appendSpend({ taskId: 'b', waveId: 'w1', model: 'gpt', mode: 'leg', usage: u(0.05), op: 'leg', status: 'error', councilRunId: 'c1', councilName: 'default', project: '/p1', gateway: 'direct' }, { dir });
  appendSpend({ taskId: 'c', waveId: 'w2', model: 'qwen', mode: 'leg', usage: u(0.20), op: 'leg', status: 'timeout', project: '/p2', gateway: 'openrouter' }, { dir });
  appendSpend({ taskId: 'd', model: 'gpt', mode: 'headless', usage: u(0.30), op: 'start', status: 'complete', project: '/p2' }, { dir });
  return dir;
}

describe('filterRows', () => {
  const dir = seed();
  const rows = readSpendRows(dir);

  test('--wave narrows to that wave', () => {
    expect(filterRows(rows, { wave: 'w1' }).map(r => r.taskId).sort()).toEqual(['a', 'b']);
  });
  test('--council matches runId', () => {
    expect(filterRows(rows, { council: 'c1' })).toHaveLength(2);
  });
  test('--model prefix-matches', () => {
    expect(filterRows(rows, { model: 'gpt' }).map(r => r.taskId).sort()).toEqual(['a', 'b', 'd']);
  });
  test('--failed keeps only non-complete rows', () => {
    expect(filterRows(rows, { failed: true }).map(r => r.status).sort()).toEqual(['error', 'timeout']);
  });
  test('--op filters by op', () => {
    expect(filterRows(rows, { op: 'start' }).map(r => r.taskId)).toEqual(['d']);
  });
});

describe('groupRows', () => {
  const rows = readSpendRows(seed());
  // NOTE (deviation from the brief's literal test, documented in task-4-report.md):
  // the brief's sample asserted g[0].key === 'w2' with the comment
  // "0.20 > 0.15 (w1) > start row's null wave" — but seed()'s row 'd' (the
  // headless/--start row with no waveId) carries cost.amount 0.30, the
  // LARGEST of the four rows. Per the brief's own rowKey()/groupRows() (used
  // verbatim here, and consistent with "old rows group under (unattributed),
  // never skipped"), a null waveId buckets under '(unattributed)', so that
  // bucket's amount (0.30) legitimately sorts first — confirmed by the
  // fixture math checking out everywhere else (computeWasted's 0.05+0.20=0.25,
  // the council test's `some()` check). This corrects the fixture's expected
  // order to match its own numbers; the grouping/sort SEMANTICS are unchanged.
  test('group-by wave sums per wave, most-expensive first', () => {
    const g = groupRows(rows, 'wave');
    expect(g[0].key).toBe('(unattributed)'); // 0.30 (headless 'd', no wave) > 0.20 (w2) > 0.15 (w1)
    expect(g[0].amount).toBeCloseTo(0.30, 5);
    const w2 = g.find(x => x.key === 'w2');
    expect(w2.amount).toBeCloseTo(0.20, 5);
    const w1 = g.find(x => x.key === 'w1');
    expect(w1.amount).toBeCloseTo(0.15, 5);
    expect(w1.runs).toBe(2);
  });
  test('group-by council buckets null council under (unattributed)', () => {
    const g = groupRows(rows, 'council');
    expect(g.some(x => x.key === '(unattributed)')).toBe(true);
  });

  // D16 (v4.7 F8): tag is GROUP_DIMS' new last entry. Real keys ('a') AND
  // untagged rows (null -> '(unattributed)') must both survive grouping — this
  // is the mutation-kill assertion: delete rowKey's `case 'tag':` arm and
  // EVERY row (including the two genuinely tagged 'a') falls through to the
  // default arm and collapses into a single '(unattributed)' bucket, which
  // would make `g).toHaveLength(2)` and `a.runs === 2` both fail.
  test('group-by tag buckets real keys and null under (unattributed) — kills the rowKey default-arm mutant', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spend-q-tag-'));
    const u = (amt) => ({ tokens: { input: 10, output: 5 }, cost: { amount: amt, currency: 'USD', source: 'reported' } });
    appendSpend({ taskId: 'ta', model: 'gpt', mode: 'leg', usage: u(0.10), op: 'leg', tag: 'a' }, { dir });
    appendSpend({ taskId: 'tb', model: 'gpt', mode: 'leg', usage: u(0.05), op: 'leg', tag: 'a' }, { dir });
    appendSpend({ taskId: 'tc', model: 'gpt', mode: 'leg', usage: u(0.20), op: 'leg' }, { dir }); // no tag -> null
    const tagRows = readSpendRows(dir);
    const g = groupRows(tagRows, 'tag');
    expect(g).toHaveLength(2);
    const a = g.find(x => x.key === 'a');
    const unattributed = g.find(x => x.key === '(unattributed)');
    expect(a).toBeDefined();
    expect(a.runs).toBe(2);
    expect(a.amount).toBeCloseTo(0.15, 5);
    expect(unattributed).toBeDefined();
    expect(unattributed.runs).toBe(1);
    expect(unattributed.amount).toBeCloseTo(0.20, 5);
  });
});

describe('computeWasted (spec 6.3, resolved Q6)', () => {
  const rows = readSpendRows(seed());
  test('sums non-complete rows, bucketed by status', () => {
    const w = computeWasted(rows);
    expect(w.runs).toBe(2);
    expect(w.amount).toBeCloseTo(0.25, 5);
    expect(w.byStatus.error).toMatchObject({ runs: 1 });
    expect(w.byStatus.timeout).toMatchObject({ runs: 1 });
  });

  // Deliberate choice (task-4 report): a row written before v4.3 has no
  // `status` field at all (status: null once read off the ledger). We cannot
  // know whether that historical run actually failed, so treating it as
  // "wasted" would fabricate a failure that was never recorded. `wasted`
  // therefore only counts rows with an EXPLICIT non-complete status; a
  // null/missing status is excluded from both the runs count and byStatus.
  test('a pre-v4.3 row (status: null) is excluded from wasted, not bucketed as a failure', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spend-q-legacy-'));
    // Simulate a pre-v4.3 ledger line: no op/status/council*/project/gateway at all.
    const legacyRow = {
      schemaVersion: 1, ts: new Date().toISOString(), taskId: 'legacy', waveId: null,
      model: 'opus', mode: 'headless',
      tokens: { input: 1, output: 1, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
      cost: { amount: 0.42, currency: 'USD', source: 'reported' },
    };
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'spend-ledger.jsonl'), JSON.stringify(legacyRow) + '\n');
    const legacyRows = readSpendRows(dir);
    expect(legacyRows[0].status).toBeUndefined();
    const w = computeWasted(legacyRows);
    expect(w.runs).toBe(0);
    expect(w.amount).toBe(0);
    expect(w.byStatus).toEqual({});
  });
});

describe('buildSpendDoc byte-compat when no new flags', () => {
  test('keeps total/byModel and adds groupBy=model + wasted', () => {
    const rows = readSpendRows(seed());
    const { total, byModel } = aggregateSpend(rows);
    const doc = buildSpendDoc({ total, byModel, windowDays: null, credit: null,
      filters: {}, groupBy: 'model', groups: groupRows(rows, 'model'), wasted: computeWasted(rows) });
    expect(doc.type).toBe('spend');
    expect(doc.byModel).toBe(byModel);
    expect(doc.groupBy).toBe('model');
    expect(doc.wasted.runs).toBe(2);
  });
});

describe('handleSpend end-to-end with flags', () => {
  test('--json --group-by wave --failed emits a filtered grouped doc', async () => {
    const dir = seed();
    const out = [];
    const write = process.stdout.write.bind(process.stdout);
    process.stdout.write = (s) => { out.push(s); return true; };
    try {
      await handleSpend({ _: ['spend'], json: true, 'group-by': 'wave', failed: true }, { dir });
    } finally { process.stdout.write = write; }
    const doc = JSON.parse(out.join(''));
    expect(doc.groupBy).toBe('wave');
    expect(doc.filters.failed).toBe(true);
    // only the two failed rows survive; grouped by their waves
    expect(doc.groups.reduce((n, g) => n + g.runs, 0)).toBe(2);
  });

  test('an unknown --group-by value fails through failJson with a hint, not a throw', async () => {
    const dir = seed();
    const out = [];
    const write = process.stdout.write.bind(process.stdout);
    process.stdout.write = (s) => { out.push(s); return true; };
    let code;
    try {
      code = await handleSpend({ _: ['spend'], json: true, 'group-by': 'bogus' }, { dir });
    } finally { process.stdout.write = write; }
    expect(code).toBe(1);
    const doc = JSON.parse(out.join(''));
    expect(doc.type).toBe('error');
    expect(doc.error.hint).toMatch(/model\|wave\|council\|project\|op\|day/);
  });

  test('an empty result set (filters match nothing) emits a valid zero doc, not an error', async () => {
    const dir = seed();
    const out = [];
    const write = process.stdout.write.bind(process.stdout);
    process.stdout.write = (s) => { out.push(s); return true; };
    let code;
    try {
      code = await handleSpend({ _: ['spend'], json: true, model: 'no-such-model-xyz' }, { dir });
    } finally { process.stdout.write = write; }
    expect(code).toBe(0);
    const doc = JSON.parse(out.join(''));
    expect(doc.type).toBe('spend');
    expect(doc.total.runs).toBe(0);
    expect(doc.groups).toEqual([]);
    expect(doc.wasted.runs).toBe(0);
  });

  test('--rows attaches the capped raw rows matching the filters', async () => {
    const dir = seed();
    const out = [];
    const write = process.stdout.write.bind(process.stdout);
    process.stdout.write = (s) => { out.push(s); return true; };
    try {
      await handleSpend({ _: ['spend'], json: true, rows: true, failed: true }, { dir });
    } finally { process.stdout.write = write; }
    const doc = JSON.parse(out.join(''));
    expect(doc.rows).toHaveLength(2);
    expect(doc.rowsTruncated).toBe(false);
  });

  test('--rows is capped at 1000 with rowsTruncated: true when clipped', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spend-q-big-'));
    const u = { tokens: { input: 1, output: 1 }, cost: { amount: 0.01, currency: 'USD', source: 'reported' } };
    for (let i = 0; i < 1005; i++) {
      appendSpend({ taskId: `t${i}`, model: 'gpt', mode: 'leg', usage: u, op: 'leg', status: 'complete' }, { dir });
    }
    const out = [];
    const write = process.stdout.write.bind(process.stdout);
    process.stdout.write = (s) => { out.push(s); return true; };
    try {
      await handleSpend({ _: ['spend'], json: true, rows: true }, { dir });
    } finally { process.stdout.write = write; }
    const doc = JSON.parse(out.join(''));
    expect(doc.total.runs).toBe(1005); // total is unaffected by the --rows cap
    expect(doc.rows).toHaveLength(1000);
    expect(doc.rowsTruncated).toBe(true);
  }, 15000);

  test('without --rows, the doc has no rows/rowsTruncated keys at all', async () => {
    const dir = seed();
    const out = [];
    const write = process.stdout.write.bind(process.stdout);
    process.stdout.write = (s) => { out.push(s); return true; };
    try {
      await handleSpend({ _: ['spend'], json: true }, { dir });
    } finally { process.stdout.write = write; }
    const doc = JSON.parse(out.join(''));
    expect(doc.rows).toBeUndefined();
    expect(doc.rowsTruncated).toBeUndefined();
  });

  test('human mode renders a Wasted rollup line when failed rows exist', async () => {
    const dir = seed();
    const out = [];
    const write = process.stdout.write.bind(process.stdout);
    process.stdout.write = (s) => { out.push(s); return true; };
    try {
      await handleSpend({ _: ['spend'] }, { dir });
    } finally { process.stdout.write = write; }
    const text = out.join('');
    expect(text).toMatch(/Wasted/);
    expect(text).toMatch(/amicus spend --failed/);
  });
});

// TRAP 1 guard: `--failed` and `--rows` MUST be registered as boolean flags in
// src/cli.js's isBooleanFlag(), or the real parser swallows the next token as
// their value instead of treating them as booleans. This drives the REAL
// parser (not a unit test of filterRows) to prove the registration is real.
//
// RED-PHASE NOTE (mirrors tests/cli-council-run-flags.test.js): a flag
// followed by ANOTHER --flag already parses as boolean today regardless of
// registration — the parser's `next && !next.startsWith('--')` guard saves
// it, so `['spend', '--failed', '--group-by', 'wave']` can never fail here
// (verified empirically). The shape that actually proves registration is a
// flag followed by a BARE (non---) token: unregistered, that token gets
// consumed as the flag's STRING value and vanishes from positionals.
describe('parseArgs registers --failed and --rows as boolean flags (TRAP 1)', () => {
  test('--failed does not swallow a following bare token as its value', () => {
    const args = parseArgs(['spend', '--failed', 'extra']);
    expect(args.failed).toBe(true);      // before registration: 'extra' (a string)
    expect(args._).toContain('extra');   // before registration: eaten as --failed's value
  });

  test('--rows does not swallow a following bare token as its value', () => {
    const args = parseArgs(['spend', '--rows', 'extra']);
    expect(args.rows).toBe(true);
    expect(args._).toContain('extra');
  });

  // Regression coverage for the exact command shape named in the brief —
  // composes correctly today (see RED-PHASE NOTE above for why this alone
  // isn't proof of registration).
  test('--failed followed by --group-by <value> composes correctly', () => {
    const args = parseArgs(['spend', '--failed', '--group-by', 'wave']);
    expect(args.failed).toBe(true);
    expect(args['group-by']).toBe('wave');
  });

  test('--rows followed by --json composes correctly', () => {
    const args = parseArgs(['spend', '--rows', '--json']);
    expect(args.rows).toBe(true);
    expect(args.json).toBe(true);
  });
});
