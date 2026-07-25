'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { appendSpend, SPEND_LEDGER_FILE } = require('../src/utils/spend-ledger');
const { ERROR_CODES } = require('../src/utils/error-doc');
const { GROUP_DIMS, ROWS_CAP } = require('../src/spend-query');
const { getTools } = require('../src/mcp-tools');
const { handlers } = require('../src/mcp-server');
const { amicus_spend, buildSpendResult } = require('../src/mcp-spend');

function seed() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-spend-'));
  const u = (a) => ({ tokens: { input: 10, output: 5 }, cost: { amount: a, source: 'reported' } });
  appendSpend({ taskId: 'a', waveId: 'w1', model: 'gpt', mode: 'leg', usage: u(0.10), op: 'leg', status: 'complete', project: '/proj/one' }, { dir });
  appendSpend({ taskId: 'b', model: 'gpt', mode: 'headless', usage: u(0.30), op: 'start', status: 'error', project: '/proj/two' }, { dir });
  return dir;
}

/** Write raw ledger rows directly (bypasses appendSpend's forced `ts: now()`
 * so tests can control timestamps precisely, and is fast for bulk seeding —
 * mirrors tests/cli-handlers-spend.test.js's row()/writeRows() helpers. */
function row(overrides) {
  return {
    schemaVersion: 1,
    ts: new Date().toISOString(),
    taskId: 'r1', waveId: null, model: 'gpt', mode: 'leg',
    tokens: { input: 1, output: 1, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
    cost: { amount: 0.01, currency: 'USD', source: 'reported' },
    op: 'leg', status: 'complete', councilRunId: null, councilName: null, project: null, gateway: null,
    ...overrides,
  };
}

function writeRows(dir, rows) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, SPEND_LEDGER_FILE), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

describe('amicus_spend MCP handler (read-only; spec 7.3)', () => {
  test('returns a spend doc; text is NOT fenced (ids/numbers only)', () => {
    const dir = seed();
    const res = buildSpendResult({ groupBy: 'op', failed: true }, { dir });
    const doc = JSON.parse(res.content[0].text);
    expect(doc.type).toBe('spend');
    expect(doc.groupBy).toBe('op');
    expect(doc.filters.failed).toBe(true);
    // Real fence marker (src/utils/untrusted-fence.js), not a guessed placeholder —
    // this must actually match what fenceSidecarOutput() emits, or the guard is a no-op.
    expect(res.content[0].text).not.toContain('<untrusted_sidecar_output');
    expect(res.isError).toBeUndefined();
    expect(doc.wasted.runs).toBe(1);
  });

  test('invalid groupBy returns a BAD_ARGS error doc (repo error envelope, not an ad-hoc shape)', () => {
    const res = buildSpendResult({ groupBy: 'nope' }, { dir: seed() });
    expect(res.isError).toBe(true);
    const doc = JSON.parse(res.content[0].text);
    expect(doc.type).toBe('error');
    expect(doc.schemaVersion).toBeDefined();
    expect(doc.error.code).toBe(ERROR_CODES.BAD_ARGS);
    expect(doc.error.message).toMatch(/nope/);
    expect(doc.error.hint).toEqual(expect.stringContaining(GROUP_DIMS.join('|')));
  });

  test('filters by wave/council/model/op and reuses the shared query functions (real grouping, not reimplemented)', () => {
    const dir = seed();
    const res = buildSpendResult({ groupBy: 'model' }, { dir });
    const doc = JSON.parse(res.content[0].text);
    expect(doc.total.runs).toBe(2);
    expect(doc.byModel).toHaveLength(1);
    expect(doc.byModel[0].model).toBe('gpt');
    expect(doc.groups).toHaveLength(1);
    expect(doc.groups[0].key).toBe('gpt');
  });

  test("filterProject '.' expands to the resolved project dir (parity with CLI --project .), through the real amicus_spend entry", async () => {
    const dir = seed();
    const res = await amicus_spend({ filterProject: '.' }, '/proj/one', { dir });
    const doc = JSON.parse(res.content[0].text);
    expect(doc.filters.project).toBe('/proj/one');
    expect(doc.total.runs).toBe(1);
  });

  test('a non-"." filterProject is passed through literally, unexpanded', () => {
    const dir = seed();
    const res = buildSpendResult({ filterProject: '/proj/two' }, { dir });
    const doc = JSON.parse(res.content[0].text);
    expect(doc.filters.project).toBe('/proj/two');
    expect(doc.total.runs).toBe(1);
    expect(doc.byModel[0].amount).toBeCloseTo(0.3);
  });

  test('rows:true includes matching raw rows, capped', () => {
    const dir = seed();
    const res = buildSpendResult({ rows: true }, { dir });
    const doc = JSON.parse(res.content[0].text);
    expect(Array.isArray(doc.rows)).toBe(true);
    expect(doc.rows.length).toBe(2);
    expect(doc.rowsTruncated).toBe(false);
  });

  // Finding 2 (Fix Wave 1): the CLI's `--rows` cap (ROWS_CAP, spend-query.js)
  // is already covered for the CLI path (tests/cli-handlers-spend-query.test.js),
  // but the MCP path's own wiring through buildSpendResult was unproven —
  // seed()'s 2-row fixture above never crosses ROWS_CAP. Seed past the cap
  // and assert both the truncation and the flag through this entry point.
  test('rows:true caps at ROWS_CAP and sets rowsTruncated:true when clipped, through the MCP path', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-spend-big-'));
    const total = ROWS_CAP + 5;
    const rows = [];
    for (let i = 0; i < total; i++) {
      rows.push(row({ taskId: `t${i}`, cost: { amount: 0.01, currency: 'USD', source: 'reported' } }));
    }
    writeRows(dir, rows);
    const res = buildSpendResult({ rows: true }, { dir });
    const doc = JSON.parse(res.content[0].text);
    expect(doc.total.runs).toBe(total); // total rollup is unaffected by the --rows cap
    expect(doc.rows).toHaveLength(ROWS_CAP);
    expect(doc.rowsTruncated).toBe(true);
  });

  // Finding 1 (Fix Wave 1): `since` must be threaded end-to-end through the
  // MCP path (buildSpendResult -> parseSinceDays -> filterRows), not just
  // parsed and dropped. Seed one row inside the window and one outside it so
  // a working filter returns a STRICT SUBSET — a test that passes whether or
  // not the filter actually runs would be worthless as a regression guard.
  describe('since (Fix Wave 1 — Finding 1: MCP-only hosts can now window by time)', () => {
    const now = new Date('2026-07-24T12:00:00.000Z').getTime();
    const eightDaysAgo = new Date(now - 8 * 86400000).toISOString();
    const oneDayAgo = new Date(now - 1 * 86400000).toISOString();

    function seedSince() {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-spend-since-'));
      writeRows(dir, [
        row({ taskId: 'old', ts: eightDaysAgo, cost: { amount: 1.00, currency: 'USD', source: 'reported' } }),
        row({ taskId: 'recent', ts: oneDayAgo, cost: { amount: 0.50, currency: 'USD', source: 'reported' } }),
      ]);
      return dir;
    }

    test('since:"7d" restricts the window to the last 7 days and reports windowDays, through buildSpendResult', () => {
      const dir = seedSince();
      const res = buildSpendResult({ since: '7d' }, { dir, now: () => now });
      const doc = JSON.parse(res.content[0].text);
      expect(doc.windowDays).toBe(7);
      expect(doc.total.runs).toBe(1); // only 'recent' (1d ago) survives; 'old' (8d ago) is filtered out
      expect(doc.total.amount).toBeCloseTo(0.50, 6);
    });

    test('since:"7d" also restricts through the real amicus_spend async entry point', async () => {
      const dir = seedSince();
      const res = await amicus_spend({ since: '7d' }, undefined, { dir, now: () => now });
      const doc = JSON.parse(res.content[0].text);
      expect(doc.total.runs).toBe(1);
      expect(doc.total.amount).toBeCloseTo(0.50, 6);
    });

    test('an unparseable since returns a BAD_ARGS error doc (repo error envelope, matching the groupBy error path)', () => {
      const dir = seedSince();
      const res = buildSpendResult({ since: 'bogus' }, { dir, now: () => now });
      expect(res.isError).toBe(true);
      const doc = JSON.parse(res.content[0].text);
      expect(doc.type).toBe('error');
      expect(doc.error.code).toBe(ERROR_CODES.BAD_ARGS);
      expect(doc.error.message).toMatch(/bogus/);
    });

    test('no since -> windowDays is null and both rows are included (no accidental filtering)', () => {
      const dir = seedSince();
      const res = buildSpendResult({}, { dir, now: () => now });
      const doc = JSON.parse(res.content[0].text);
      expect(doc.windowDays).toBeNull();
      expect(doc.total.runs).toBe(2);
    });
  });

  test('amicus_spend (async MCP entry) delegates to buildSpendResult', async () => {
    const dir = seed();
    const res = await amicus_spend({ groupBy: 'model' }, undefined, { dir });
    expect(res).toHaveProperty('content');
    expect(res.content[0].type).toBe('text');
    const doc = JSON.parse(res.content[0].text);
    expect(doc.type).toBe('spend');
    expect(doc.total.runs).toBe(2);
  });
});

describe('amicus_spend tool registration (15 -> 16)', () => {
  test('is registered in getTools() with read-only annotations', () => {
    const tool = getTools().find((t) => t.name === 'amicus_spend');
    expect(tool).toBeDefined();
    expect(tool.annotations).toEqual({
      readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false,
    });
  });

  test('every inputSchema field has a .describe()', () => {
    const tool = getTools().find((t) => t.name === 'amicus_spend');
    for (const [key, schema] of Object.entries(tool.inputSchema)) {
      expect(typeof schema.description).toBe('string');
      expect(schema.description.length).toBeGreaterThan(0);
      void key;
    }
  });

  // Finding 1 (Fix Wave 1): the brief's Interfaces line names `since` as an
  // MCP input; the shipped tool omitted it. Prove it's actually present now,
  // not just documented as present.
  test('inputSchema has a since field (brief Interfaces line: since/wave/council/project/model/op/failed/groupBy/rows)', () => {
    const tool = getTools().find((t) => t.name === 'amicus_spend');
    expect(tool.inputSchema.since).toBeDefined();
  });

  test('has exactly 16 tools now', () => {
    expect(getTools()).toHaveLength(16);
  });

  test('mcp-server exports a handler function for amicus_spend', () => {
    expect(typeof handlers.amicus_spend).toBe('function');
  });

  // Correction 1: GROUP_DIMS must have exactly ONE definition. Prove the CLI's
  // validity check and the MCP tool's groupBy enum are driven by the SAME array
  // (src/spend-query.js), not two hand-copied literals that can silently drift.
  test('MCP groupBy enum is driven by the same GROUP_DIMS the CLI validates against', () => {
    const tool = getTools().find((t) => t.name === 'amicus_spend');
    const enumSchema = tool.inputSchema.groupBy.unwrap(); // unwrap ZodOptional
    expect(enumSchema.options).toEqual(GROUP_DIMS);
  });
});
