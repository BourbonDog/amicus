'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const Ajv = require('ajv/dist/2020');

const SCHEMAS = path.join(__dirname, '..', 'schemas');
const load = (name) => JSON.parse(fs.readFileSync(path.join(SCHEMAS, name), 'utf-8'));
const ajv = new Ajv({ allErrors: true, strict: false });

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'schema-live-')); }

describe('event schema validates real appendEvent output', () => {
  const validate = ajv.compile(load('event.schema.json'));
  test('a wave-terminal line validates', () => {
    const { appendEvent, EVENTS_FILE } = require('../src/observe/events');
    const dir = tmp();
    appendEvent(dir, { event: 'wave-terminal', id: 'w1', status: 'complete', counts: { complete: 2 }, usage: { cost: { amount: 0.2 } }, exitCode: 0 });
    const doc = JSON.parse(fs.readFileSync(path.join(dir, EVENTS_FILE), 'utf-8').trim());
    expect(validate(doc)).toBe(true);
  });
});

describe('progress schema validates real writeProgress output', () => {
  const validate = ajv.compile(load('progress.schema.json'));
  test('a receiving progress doc with usage validates', () => {
    const { writeProgress } = require('../src/sidecar/progress');
    const dir = tmp();
    writeProgress(dir, 'receiving', { usage: { tokens: { input: 1, output: 1, reasoning: 0, cacheRead: 0, cacheWrite: 0 }, costReported: 0 } });
    const doc = JSON.parse(fs.readFileSync(path.join(dir, 'progress.json'), 'utf-8'));
    expect(validate(doc)).toBe(true);
  });
});

describe('spend schema still validates the enriched spend doc', () => {
  const validate = ajv.compile(load('spend.schema.json'));
  test('a doc with groups/wasted/filters validates', () => {
    const { buildSpendDoc, groupRows, computeWasted, aggregateSpend } = require('../src/cli-handlers-spend');
    const rows = [];
    const { total, byModel } = aggregateSpend(rows);
    const doc = buildSpendDoc({ total, byModel, windowDays: null, credit: null,
      filters: { failed: true }, groupBy: 'wave', groups: groupRows(rows, 'wave'), wasted: computeWasted(rows) });
    expect(validate(doc)).toBe(true);
  });

  // Finding 2 regression guard: the assertion above only ever validates an
  // EMPTY spend doc (rows=[] => groups=[] and wasted.byStatus={}), so the
  // schema's item-level shape (groups[].key/amount/runs, a populated
  // wasted.byStatus) was never actually exercised. Seed real ledger rows via
  // appendSpend (same pattern as tests/cli-handlers-spend-query.test.js) and
  // build the doc through the real aggregateSpend/groupRows/computeWasted/
  // buildSpendDoc path so a future shape change that violates the schema
  // gets caught here.
  test('a doc built from real seeded rows has populated groups/wasted and validates', () => {
    const { appendSpend, readSpendRows } = require('../src/utils/spend-ledger');
    const { buildSpendDoc, groupRows, computeWasted, aggregateSpend } = require('../src/cli-handlers-spend');
    const dir = tmp();
    const usage = (amount) => ({ tokens: { input: 10, output: 5 }, cost: { amount, currency: 'USD', source: 'reported' } });
    appendSpend({ taskId: 'live-a', waveId: 'w1', model: 'gpt', mode: 'leg', usage: usage(0.10), op: 'leg', status: 'complete', project: '/p1', gateway: 'direct' }, { dir });
    appendSpend({ taskId: 'live-b', waveId: 'w1', model: 'gpt', mode: 'leg', usage: usage(0.05), op: 'leg', status: 'error', project: '/p1', gateway: 'direct' }, { dir });
    appendSpend({ taskId: 'live-c', waveId: 'w2', model: 'qwen', mode: 'leg', usage: usage(0.20), op: 'leg', status: 'timeout', project: '/p2', gateway: 'openrouter' }, { dir });

    const rows = readSpendRows(dir);
    const { total, byModel } = aggregateSpend(rows);
    const groups = groupRows(rows, 'wave');
    const wasted = computeWasted(rows);
    const doc = buildSpendDoc({ total, byModel, windowDays: null, credit: null,
      filters: {}, groupBy: 'wave', groups, wasted });

    expect(doc.groups.length).toBeGreaterThan(0);
    expect(Object.keys(doc.wasted.byStatus).length).toBeGreaterThan(0);
    expect(validate(doc)).toBe(true);
  });
});

/** Write one session's metadata.json (mirrors tests/mcp-status-enrichment.test.js). */
function createSession(projectDir, taskId, meta) {
  const sessDir = path.join(projectDir, '.claude', 'amicus_sessions', taskId);
  fs.mkdirSync(sessDir, { recursive: true });
  fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
    taskId, status: 'running', model: 'gemini', createdAt: new Date().toISOString(), ...meta,
  }, null, 2));
  return sessDir;
}
const parse = (r) => JSON.parse(r.content[0].text);

describe('wave-live schema validates a real composed amicus_status wave doc', () => {
  const validate = ajv.compile(load('wave-live.schema.json'));
  let projectDir; let handlers;
  beforeEach(() => {
    projectDir = tmp();
    handlers = require('../src/mcp-server').handlers;
  });
  afterEach(() => { jest.resetModules(); });

  test('a running wave with a priced leg validates', async () => {
    const { writeProgress } = require('../src/sidecar/progress');
    createSession(projectDir, 'wv-schema', { type: 'wave', status: 'running', legs: ['wv-schema-1'], pid: process.pid });
    const legDir = createSession(projectDir, 'wv-schema-1', { status: 'running', model: 'openrouter/x/y' });
    writeProgress(legDir, 'receiving', {
      usage: { tokens: { input: 10, output: 5, reasoning: 0, cacheRead: 0, cacheWrite: 0 }, costReported: 0.01 },
    });
    const doc = parse(await handlers.amicus_status({ taskId: 'wv-schema' }, projectDir));
    expect(doc.view).toBe('live');
    expect(validate(doc)).toBe(true);
  });
});

describe('run-live schema validates a real composed amicus_status single-session doc', () => {
  const validate = ajv.compile(load('run-live.schema.json'));
  let projectDir; let handlers;
  beforeEach(() => {
    projectDir = tmp();
    handlers = require('../src/mcp-server').handlers;
  });
  afterEach(() => { jest.resetModules(); });

  test('a running priced session validates', async () => {
    const { writeProgress } = require('../src/sidecar/progress');
    const sessDir = createSession(projectDir, 'run-schema', { status: 'running', model: 'openrouter/x/y', pid: process.pid });
    writeProgress(sessDir, 'receiving', {
      usage: { tokens: { input: 10, output: 5, reasoning: 0, cacheRead: 0, cacheWrite: 0 }, costReported: 0.01 },
    });
    const doc = parse(await handlers.amicus_status({ taskId: 'run-schema' }, projectDir));
    expect(doc.view).toBe('live');
    expect(validate(doc)).toBe(true);
  });
});

describe('council-run-live schema validates real buildCouncilStatusPayload output', () => {
  const validate = ajv.compile(load('council-run-live.schema.json'));
  const runState = require('../src/council/run-state');
  let projectDir;
  beforeEach(() => { jest.resetModules(); projectDir = tmp(); });
  afterEach(() => { jest.resetModules(); });

  test('a running council run with a priced active-stage leg validates', () => {
    const { writeProgress } = require('../src/sidecar/progress');
    const runDir = path.join(projectDir, 'council-schema-run');
    runState.initRun(runDir, {
      schemaVersion: 2, type: 'council-run', runId: 'schema-run', status: 'running',
      stages: [
        { name: 'stage1', status: 'complete', waveId: 'schema-run-s1', project: runDir },
        { name: 'stage2', status: 'running', waveId: 'schema-run-s2', project: runDir },
      ],
      bench: ['gemini', 'gpt'], chair: 'deepseek', critic: null, lenses: null, labelMap: null,
      options: { outDir: runDir }, usage: null, pid: process.pid,
      createdAt: new Date().toISOString(),
    });
    runState.writePointer(projectDir, 'schema-run', runDir);

    const waveDir = path.join(runDir, '.claude', 'amicus_sessions', 'schema-run-s2');
    fs.mkdirSync(waveDir, { recursive: true });
    fs.writeFileSync(path.join(waveDir, 'metadata.json'), JSON.stringify({
      taskId: 'schema-run-s2', type: 'wave', status: 'running', legs: ['schema-run-s2-1', 'schema-run-s2-2'],
    }));
    const legDir = path.join(runDir, '.claude', 'amicus_sessions', 'schema-run-s2-1');
    fs.mkdirSync(legDir, { recursive: true });
    // modelInput (the alias) is deliberately unlike `model` (the resolved id)
    // — DE-ROT F34/F36: role/blind-name must resolve off modelInput, not model.
    fs.writeFileSync(path.join(legDir, 'metadata.json'), JSON.stringify({
      taskId: 'schema-run-s2-1', status: 'running', model: 'google/gemini-2.5', modelInput: 'gemini',
    }));
    writeProgress(legDir, 'receiving', {
      usage: { tokens: { input: 40, output: 10, reasoning: 0, cacheRead: 0, cacheWrite: 0 }, costReported: 0.03 },
    });
    // DE-ROT Task 0.5 (F01): a second leg with no progress.json yet — the
    // just-started case a live seats panel most needs — must still get a row
    // that validates (no `usage` key at all, not an undefined one).
    const legDir2 = path.join(runDir, '.claude', 'amicus_sessions', 'schema-run-s2-2');
    fs.mkdirSync(legDir2, { recursive: true });
    fs.writeFileSync(path.join(legDir2, 'metadata.json'), JSON.stringify({ taskId: 'schema-run-s2-2', status: 'running' }));

    const { buildCouncilStatusPayload } = require('../src/mcp-council-awareness');
    const doc = buildCouncilStatusPayload(projectDir, 'schema-run');
    expect(doc.view).toBe('live');
    expect(doc.legs).toHaveLength(2);
    expect(doc.legs.find((l) => l.taskId === 'schema-run-s2-1').usage).toBeDefined();
    expect(doc.legs.find((l) => l.taskId === 'schema-run-s2-2').usage).toBeUndefined();
    // DE-ROT F34/F36: modelInput carries the alias, and role resolves off it
    // (not the resolved `model` id) even during stage2 (judging) — a model's
    // seat/critic/lens identity is stable across stages.
    expect(doc.legs.find((l) => l.taskId === 'schema-run-s2-1').modelInput).toBe('gemini');
    expect(doc.legs.find((l) => l.taskId === 'schema-run-s2-1').role).toBe('seat');
    expect(doc.legs.find((l) => l.taskId === 'schema-run-s2-2').modelInput).toBeNull();
    expect(doc.legs.find((l) => l.taskId === 'schema-run-s2-2').role).toBeNull();
    expect(validate(doc)).toBe(true);
  });
});
