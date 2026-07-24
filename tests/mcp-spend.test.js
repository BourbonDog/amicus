'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { appendSpend } = require('../src/utils/spend-ledger');
const { ERROR_CODES } = require('../src/utils/error-doc');
const { GROUP_DIMS } = require('../src/spend-query');
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
