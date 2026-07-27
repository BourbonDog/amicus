'use strict';

/**
 * v4.4 — `amicus spend` must not turn "cost unknown" into "$0.0000".
 *
 * Diagnosis §9 ("Spend ledger — corrupted, silently") and §8 (final paragraph):
 * every reader coerced a null `cost.amount` to 0 BEFORE formatting
 * (src/cli-handlers-spend.js:61-63, src/spend-query.js:72,95), so a model whose
 * rows are ALL unpriced printed `$0.0000` in the cost column with only the `u`
 * count contradicting it. Combined with B2's fabricated `estimated $0` rows,
 * both the CLI and the `amicus_spend` MCP tool under-reported real spend while
 * looking authoritative.
 *
 * The fix keeps `amount` a plain number (the published spend.schema.json pins
 * `groups[].amount` and `wasted.amount` to `type: "number"`), and adds an
 * explicit `unpricedRows` count plus a human rendering that names it. Known
 * spend stays exact; the unknown is stated, never folded into the number.
 */

const { aggregateSpend } = require('../src/cli-handlers-spend');
const { groupRows, computeWasted } = require('../src/spend-query');

const tokens = { input: 100, output: 50, reasoning: 0, cacheRead: 0, cacheWrite: 0 };
const zeroTokens = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 };

/** A real priced row. */
const priced = (model, amount, extra = {}) => ({
  model, tokens, cost: { amount, currency: 'USD', source: 'reported' },
  status: 'complete', op: 'leg', ts: '2026-07-26T00:00:00.000Z', ...extra,
});

/** The row a zero-token leg now writes after the B2 fix. */
const unpriced = (model, extra = {}) => ({
  model, tokens: zeroTokens, cost: { amount: null, currency: 'USD', source: 'unknown' },
  status: 'complete', op: 'leg', ts: '2026-07-26T00:00:00.000Z', ...extra,
});

/**
 * v4.4.1 CA-2. The row that `unpricedRows` structurally cannot see: the leg's
 * OWN cost resolved (it is PRICED, it lands in the `r` bucket, it contributes
 * to the total), but it spawned a child session the walk could not price — so
 * the total it contributes to is a floor, not a measurement.
 */
const subtreeUnknown = (model, amount, extra = {}) => priced(model, amount, { subtreeUnknown: true, ...extra });

describe('aggregateSpend counts rows that contribute NO amount', () => {
  test('total + per-model carry unpricedRows', () => {
    const { total, byModel } = aggregateSpend([
      priced('glm', 0.02), unpriced('glm'), unpriced('qwen'),
    ]);
    expect(total.amount).toBeCloseTo(0.02, 8);
    expect(total.unpricedRows).toBe(2);
    const glm = byModel.find((m) => m.model === 'glm');
    const qwen = byModel.find((m) => m.model === 'qwen');
    expect(glm.unpricedRows).toBe(1);
    expect(qwen.unpricedRows).toBe(1);
    expect(qwen.amount).toBe(0); // the sum of nothing is still 0…
  });

  test('a fully priced ledger reports unpricedRows 0', () => {
    const { total, byModel } = aggregateSpend([priced('glm', 0.02), priced('glm', 0.03)]);
    expect(total.unpricedRows).toBe(0);
    expect(byModel[0].unpricedRows).toBe(0);
  });

  test('a row with no cost block at all counts as unpriced', () => {
    const { total } = aggregateSpend([{ model: 'x', tokens: null, status: 'complete' }]);
    expect(total.unpricedRows).toBe(1);
  });

  test('total + per-model carry unattributedSubtreeRows for a PRICED but incomplete row', () => {
    const { total, byModel } = aggregateSpend([
      subtreeUnknown('glm', 0.02), priced('glm', 0.03), priced('qwen', 0.01),
    ]);
    expect(total.amount).toBeCloseTo(0.06, 8); // every row's own cost still counts
    expect(total.unpricedRows).toBe(0);        // …and none of them is unpriced
    expect(total.unattributedSubtreeRows).toBe(1);
    expect(byModel.find((m) => m.model === 'glm').unattributedSubtreeRows).toBe(1);
    expect(byModel.find((m) => m.model === 'qwen').unattributedSubtreeRows).toBe(0);
  });

  test('a row can be BOTH unpriced and unattributed-subtree — the counts sit beside each other', () => {
    const { total } = aggregateSpend([unpriced('glm', { subtreeUnknown: true })]);
    expect(total.unpricedRows).toBe(1);
    expect(total.unattributedSubtreeRows).toBe(1);
  });
});

describe('groupRows and computeWasted carry the same count', () => {
  test('groupRows exposes unpricedRows per group', () => {
    const groups = groupRows([priced('glm', 0.02, { waveId: 'w1' }), unpriced('glm', { waveId: 'w1' })], 'wave');
    expect(groups[0].key).toBe('w1');
    expect(groups[0].unpricedRows).toBe(1);
    expect(groups[0].amount).toBeCloseTo(0.02, 8);
  });

  test('computeWasted exposes unpricedRows for failed rows', () => {
    const w = computeWasted([
      priced('glm', 0.02, { status: 'error' }),
      unpriced('glm', { status: 'error' }),
      priced('glm', 0.5, { status: 'complete' }), // excluded: not wasted
    ]);
    expect(w.runs).toBe(2);
    expect(w.amount).toBeCloseTo(0.02, 8);
    expect(w.unpricedRows).toBe(1);
  });

  test('groupRows counts unattributed-subtree rows separately from unpriced rows', () => {
    const [g] = groupRows([
      subtreeUnknown('a', 0.01),
      priced('a', 0.02),
      unpriced('a'),
    ], 'model');
    expect(g.amount).toBeCloseTo(0.03, 8);
    expect(g.unpricedRows).toBe(1);            // the null-cost row
    expect(g.unattributedSubtreeRows).toBe(1); // the priced-but-incomplete row
  });

  test('computeWasted carries unattributedSubtreeRows on the roll-up and per status', () => {
    const w = computeWasted([
      subtreeUnknown('a', 0.01, { status: 'error' }),
      priced('a', 0.02, { status: 'error' }),
      subtreeUnknown('a', 0.5, { status: 'complete' }), // excluded: not wasted
    ]);
    expect(w.runs).toBe(2);
    expect(w.unattributedSubtreeRows).toBe(1);
    expect(w.byStatus.error.unattributedSubtreeRows).toBe(1);
  });

  test('amount stays a plain number so spend.schema.json still validates', () => {
    const groups = groupRows([unpriced('glm')], 'model');
    expect(typeof groups[0].amount).toBe('number');
    expect(typeof computeWasted([unpriced('glm', { status: 'error' })]).amount).toBe('number');
  });
});

describe('the human table never prints a bare $0.0000 for an unpriced model', () => {
  const { handleSpend } = require('../src/cli-handlers-spend');
  const fs = require('fs');
  const os = require('os');
  const path = require('path');

  let dir; let out;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spend-unknown-'));
    out = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });
  afterEach(() => {
    out.mockRestore();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const writeLedger = (rows) => fs.writeFileSync(
    path.join(dir, 'spend-ledger.jsonl'),
    rows.map((r) => JSON.stringify({ schemaVersion: 1, ...r })).join('\n') + '\n');

  const text = () => out.mock.calls.map((c) => String(c[0])).join('');

  test('an all-unpriced model shows "?" plus an unknown count, not $0.0000', async () => {
    writeLedger([unpriced('openrouter/z-ai/glm-5.2'), unpriced('openrouter/z-ai/glm-5.2')]);
    const code = await handleSpend({ _: [] }, { dir, readApiKeyValues: () => ({}), now: () => Date.now() });
    expect(code).toBe(0);
    const t = text();
    expect(t).toMatch(/\?/);
    expect(t).not.toMatch(/\$0\.0000\s+r0/); // the old lie: a measured-looking zero
    expect(t).toMatch(/2 unpriced/);
  });

  test('a mixed ledger prints known spend AND the unpriced count on the total line', async () => {
    writeLedger([priced('glm', 0.372), unpriced('qwen')]);
    await handleSpend({ _: [] }, { dir, readApiKeyValues: () => ({}), now: () => Date.now() });
    const t = text();
    expect(t).toMatch(/0\.3720/);
    expect(t).toMatch(/1 unpriced/);
    expect(t).toMatch(/at least/i);
  });

  test('a fully priced ledger total line is unchanged (no unknown noise)', async () => {
    writeLedger([priced('glm', 0.372)]);
    await handleSpend({ _: [] }, { dir, readApiKeyValues: () => ({}), now: () => Date.now() });
    const t = text();
    expect(t).toMatch(/Total: \$0\.3720 across 1 run\(s\)/);
    expect(t).not.toMatch(/unpriced/);
  });

  test('the --json doc carries unpricedRows on total, byModel, groups and wasted', async () => {
    writeLedger([priced('glm', 0.372), unpriced('qwen', { status: 'error' })]);
    await handleSpend({ _: [], json: true }, { dir, readApiKeyValues: () => ({}), now: () => Date.now() });
    const doc = JSON.parse(text());
    expect(doc.total.unpricedRows).toBe(1);
    expect(doc.byModel.find((m) => m.model === 'qwen').unpricedRows).toBe(1);
    expect(doc.groups.find((g) => g.key === 'qwen').unpricedRows).toBe(1);
    expect(doc.wasted.unpricedRows).toBe(1);
  });

  // v4.4.1 CA-2: this row is PRICED, so nothing in the unpriced machinery above
  // can surface it — the table has to say the second thing itself.
  test('a subtree-unknown row adds its own line saying real spend is HIGHER', async () => {
    writeLedger([subtreeUnknown('glm', 0.372)]);
    await handleSpend({ _: [] }, { dir, readApiKeyValues: () => ({}), now: () => Date.now() });
    const t = text();
    expect(t).toMatch(/Total: \$0\.3720/);   // the leg's own cost is still exact
    expect(t).not.toMatch(/unpriced/);       // and it is NOT an unpriced row
    expect(t).toMatch(/1 row\(s\) spawned a subagent/);
    expect(t).toMatch(/HIGHER/);
  });

  test('the two lines are different statements and both appear when both apply', async () => {
    writeLedger([subtreeUnknown('glm', 0.372), unpriced('qwen')]);
    await handleSpend({ _: [] }, { dir, readApiKeyValues: () => ({}), now: () => Date.now() });
    const t = text();
    expect(t).toMatch(/1 unpriced row\(s\) — cost unknown and NOT in the total/);
    expect(t).toMatch(/1 row\(s\) spawned a subagent whose CHILD session spend could NOT be determined/);
  });

  test('the --json doc carries unattributedSubtreeRows everywhere unpricedRows lives', async () => {
    writeLedger([subtreeUnknown('glm', 0.372, { status: 'error' }), priced('qwen', 0.01)]);
    await handleSpend({ _: [], json: true }, { dir, readApiKeyValues: () => ({}), now: () => Date.now() });
    const doc = JSON.parse(text());
    expect(doc.total.unattributedSubtreeRows).toBe(1);
    expect(doc.byModel.find((m) => m.model === 'glm').unattributedSubtreeRows).toBe(1);
    expect(doc.byModel.find((m) => m.model === 'qwen').unattributedSubtreeRows).toBe(0);
    expect(doc.groups.find((g) => g.key === 'glm').unattributedSubtreeRows).toBe(1);
    expect(doc.wasted.unattributedSubtreeRows).toBe(1);
  });
});

describe('the spend ledger records an unknown cost as unknown, never as a measured $0', () => {
  const { appendSpend, readSpendRows } = require('../src/utils/spend-ledger');
  const fs = require('fs');
  const os = require('os');
  const path = require('path');

  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spend-ledger-unknown-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  test('a zero-token leg writes {amount:null, source:unknown}', () => {
    // This is the block src/utils/pricing.js resolveUsage now produces for the
    // real council-wsgate04/wsgate04-p1-1 shape (all-zero tokens, priced model).
    const { resolveUsage } = require('../src/utils/pricing');
    const usage = resolveUsage({
      model: 'openrouter/z-ai/glm-5.2',
      usageTotals: { tokens: zeroTokens, costReported: 0 },
    });
    appendSpend({ taskId: 't1', model: 'openrouter/z-ai/glm-5.2', mode: 'leg', usage, op: 'leg', status: 'complete' }, { dir });
    const rows = readSpendRows(dir);
    expect(rows).toHaveLength(1);
    expect(rows[0].cost).toEqual({ amount: null, currency: 'USD', source: 'unknown' });
    // …and NOT the pre-fix row, which landed in the `e` bucket as a measurement:
    expect(rows[0].cost.source).not.toBe('estimated');
  });
});
