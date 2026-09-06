// tests/start-json.test.js
'use strict';

const mockRunHeadless = jest.fn();
jest.mock('../src/headless', () => {
  const actual = jest.requireActual('../src/headless');
  return { ...actual, runHeadless: mockRunHeadless };
});

jest.mock('../src/sidecar/context-builder', () => ({
  buildContext: jest.fn(() => 'CTX'),
  parseDuration: jest.fn(),
}));

jest.mock('../src/utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const fs = require('fs');
const { SCHEMA_VERSION } = require('../src/utils/result-schema');
const os = require('os');
const path = require('path');
const { startSidecar } = require('../src/sidecar/start');

describe('start --json (F4)', () => {
  let project;
  let logSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-startjson-'));
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    mockRunHeadless.mockResolvedValue({
      summary: 'JSON MODE SUMMARY', completed: true, timedOut: false, aborted: false,
      taskId: 'x', toolCalls: [], exitCode: 0,
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
    fs.rmSync(project, { recursive: true, force: true });
  });

  it('emits ONLY a parseable run document on stdout', async () => {
    await startSidecar({
      model: 'openrouter/a/b', prompt: 'task', noUi: true, cwd: project,
      includeContext: false, json: true, modelInput: 'somealias', taskId: 'feed0001',
    });
    expect(logSpy).toHaveBeenCalledTimes(1); // exactly one stdout write
    const doc = JSON.parse(logSpy.mock.calls[0][0]); // whole-output parse must succeed
    expect(doc).toMatchObject({
      schemaVersion: SCHEMA_VERSION, type: 'run', taskId: 'feed0001',
      model: 'openrouter/a/b', modelInput: 'somealias',
      status: 'complete', summary: 'JSON MODE SUMMARY',
    });
    expect(doc.sessionDir).toContain('feed0001');
  });

  it('a solo --json run document carries variant when the result did (#218 PR 4)', async () => {
    mockRunHeadless.mockResolvedValue({
      summary: 'JSON MODE SUMMARY', completed: true, timedOut: false, aborted: false,
      taskId: 'x', toolCalls: [], exitCode: 0, variant: 'low',
    });
    await startSidecar({
      model: 'openrouter/a/b', prompt: 'task', noUi: true, cwd: project,
      includeContext: false, json: true, modelInput: 'somealias', taskId: 'feed0006',
    });
    const doc = JSON.parse(logSpy.mock.calls[0][0]);
    expect(doc.status).toBe('complete');
    expect(doc.variant).toBe('low');
  });

  it('emits a parseable error document when the run errors', async () => {
    mockRunHeadless.mockResolvedValue({
      summary: '', completed: false, timedOut: false, aborted: false, error: 'model exploded', taskId: 'x',
    });
    await startSidecar({
      model: 'openrouter/a/b', prompt: 'task', noUi: true, cwd: project,
      includeContext: false, json: true, taskId: 'feed0002',
    });
    const doc = JSON.parse(logSpy.mock.calls[0][0]);
    expect(doc.status).toBe('error');
    expect(doc.error).toBe('model exploded');
  });

  it('non-json mode still prints the summary, fenced as untrusted output (B03)', async () => {
    await startSidecar({
      model: 'openrouter/a/b', prompt: 'task', noUi: true, cwd: project,
      includeContext: false, taskId: 'feed0003',
    });
    expect(logSpy).toHaveBeenCalledTimes(1);
    const written = logSpy.mock.calls[0][0];
    expect(written).toContain('<untrusted_sidecar_output');
    expect(written).toContain('</untrusted_sidecar_output>');
    expect(written).toContain('JSON MODE SUMMARY');
  });

  it('emits a parseable error document even when runHeadless THROWS', async () => {
    mockRunHeadless.mockRejectedValue(new Error('server exploded'));
    await startSidecar({
      model: 'openrouter/a/b', prompt: 'task', noUi: true, cwd: project,
      includeContext: false, json: true, taskId: 'feed0004',
    });
    const doc = JSON.parse(logSpy.mock.calls[0][0]);
    expect(doc.status).toBe('error');
    expect(doc.error).toBe('server exploded');
  });

  it('non-json mode still propagates a runHeadless throw (unchanged behavior)', async () => {
    mockRunHeadless.mockRejectedValue(new Error('server exploded'));
    await expect(startSidecar({
      model: 'openrouter/a/b', prompt: 'task', noUi: true, cwd: project,
      includeContext: false, taskId: 'feed0005',
    })).rejects.toThrow('server exploded');
  });
});

describe('spend ledger append on start finalize (B24)', () => {
  let project;
  let prevConfigDir;
  let ledgerDir;

  beforeEach(() => {
    jest.clearAllMocks();
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-startspend-'));
    prevConfigDir = process.env.AMICUS_CONFIG_DIR;
    ledgerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-startspend-ledger-'));
    process.env.AMICUS_CONFIG_DIR = ledgerDir;
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    fs.rmSync(project, { recursive: true, force: true });
    if (prevConfigDir === undefined) { delete process.env.AMICUS_CONFIG_DIR; }
    else { process.env.AMICUS_CONFIG_DIR = prevConfigDir; }
  });

  it('a headless run with usage appends one spend-ledger row, mode:headless', async () => {
    // costReported > 0 short-circuits resolveLegCost before it ever consults
    // pricing/catalog lookups — keeps this test independent of catalog state.
    mockRunHeadless.mockResolvedValue({
      summary: 'done', completed: true, timedOut: false, aborted: false, taskId: 'x', toolCalls: [],
      usage: { tokens: { input: 200, output: 80, reasoning: 0, cacheRead: 0, cacheWrite: 0 }, costReported: 0.02 },
    });
    const { readSpendRows } = require('../src/utils/spend-ledger');
    await startSidecar({
      model: 'openrouter/a/b', prompt: 'task', noUi: true, cwd: project,
      includeContext: false, json: true, taskId: 'spend0001',
    });
    const rows = readSpendRows(ledgerDir);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      taskId: 'spend0001', waveId: null, model: 'openrouter/a/b', mode: 'headless',
      tokens: { input: 200, output: 80 },
      cost: { amount: 0.02, currency: 'USD', source: 'reported' },
      // Guards start.js's effectiveProject wiring (cwd || project): `cwd` is what
      // MCP/Cowork always pass, and it must win over the bare `project` default.
      // Asserting equality to the tmpdir passed as `cwd` above (not `project`,
      // which was never set) fails this test if start.js reverts to bare `project`.
      project: project,
    });
  });

  // D16 (v4.7 F8): a solo `start --tag` run's ledger row carries the tag —
  // read back off `m` (the re-read metadata at start.js's finalize site), the
  // same in-scope value its neighboring gateway comment enforces.
  it('a headless run started with --tag carries the tag on its ledger row', async () => {
    mockRunHeadless.mockResolvedValue({
      summary: 'done', completed: true, timedOut: false, aborted: false, taskId: 'x', toolCalls: [],
      usage: { tokens: { input: 200, output: 80, reasoning: 0, cacheRead: 0, cacheWrite: 0 }, costReported: 0.02 },
    });
    const { readSpendRows } = require('../src/utils/spend-ledger');
    await startSidecar({
      model: 'openrouter/a/b', prompt: 'task', noUi: true, cwd: project,
      includeContext: false, json: true, taskId: 'spend0004', tag: 'sprint42',
    });
    const rows = readSpendRows(ledgerDir);
    expect(rows).toHaveLength(1);
    expect(rows[0].tag).toBe('sprint42');
  });

  // D16: the convention pin at the other end — an untagged solo run's row
  // carries tag:null (present, not omitted), matching spend-ledger.js's
  // nullable-dim convention (contrast with metadata.json's own absent-not-null
  // tag, D13 — start-metadata.js :: createSessionMetadata).
  it('an untagged headless run carries tag:null on its ledger row', async () => {
    mockRunHeadless.mockResolvedValue({
      summary: 'done', completed: true, timedOut: false, aborted: false, taskId: 'x', toolCalls: [],
      usage: { tokens: { input: 5, output: 5, reasoning: 0, cacheRead: 0, cacheWrite: 0 }, costReported: 0.001 },
    });
    const { readSpendRows } = require('../src/utils/spend-ledger');
    await startSidecar({
      model: 'openrouter/a/b', prompt: 'task', noUi: true, cwd: project,
      includeContext: false, json: true, taskId: 'spend0005',
    });
    const rows = readSpendRows(ledgerDir);
    expect(rows).toHaveLength(1);
    expect('tag' in rows[0]).toBe(true);
    expect(rows[0].tag).toBeNull();
  });

  // #218 PR 3 whole-branch review: the solo `start` ledger row carries `finish`
  // when the result has one — the OUTPUT_LENGTH death's receipt.
  // Named mutant "SOLOROWNOFINISH" (drop `finish` from start.js's appendSpend).
  it("an OUTPUT_LENGTH run's ledger row carries finish 'length' beside status 'error'", async () => {
    mockRunHeadless.mockResolvedValue({
      summary: '', completed: false, timedOut: false, aborted: false, taskId: 'x', toolCalls: [],
      finish: 'length', variant: 'high',
      error: "OUTPUT_LENGTH: the provider stopped at the max_tokens reservation (finish 'length') and no answer text arrived — 32000 reasoning / 0 output tokens; outputBudget is unset — the engine's 32000 default reservation governs — raise outputBudget in config.json (docs/configuration.md, Output budget)",
      usage: { tokens: { input: 5, output: 0, reasoning: 32000, cacheRead: 0, cacheWrite: 0 }, costReported: 0.63 },
    });
    const { readSpendRows } = require('../src/utils/spend-ledger');
    await startSidecar({
      model: 'openrouter/a/b', prompt: 'task', noUi: true, cwd: project,
      includeContext: false, json: true, taskId: 'spend0006',
    });
    const rows = readSpendRows(ledgerDir);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('error');
    expect(rows[0].finish).toBe('length'); // SOLOROWNOFINISH
    expect(rows[0].variant).toBe('high'); // SOLOROWNOVARIANT
  });

  it('a run with no finish on the result leaves the key off the ledger row', async () => {
    mockRunHeadless.mockResolvedValue({
      summary: 'done', completed: true, timedOut: false, aborted: false, taskId: 'x', toolCalls: [],
      usage: { tokens: { input: 5, output: 5, reasoning: 0, cacheRead: 0, cacheWrite: 0 }, costReported: 0.001 },
    });
    const { readSpendRows } = require('../src/utils/spend-ledger');
    await startSidecar({
      model: 'openrouter/a/b', prompt: 'task', noUi: true, cwd: project,
      includeContext: false, json: true, taskId: 'spend0007',
    });
    const rows = readSpendRows(ledgerDir);
    expect(rows).toHaveLength(1);
    expect('finish' in rows[0]).toBe(false);
    expect('variant' in rows[0]).toBe(false);
  });

  it('a run with no usage on the result does not append a row', async () => {
    mockRunHeadless.mockResolvedValue({
      summary: 'done', completed: true, timedOut: false, aborted: false, taskId: 'x', toolCalls: [],
      // no .usage
    });
    const { readSpendRows } = require('../src/utils/spend-ledger');
    await startSidecar({
      model: 'openrouter/a/b', prompt: 'task', noUi: true, cwd: project,
      includeContext: false, json: true, taskId: 'spend0002',
    });
    expect(readSpendRows(ledgerDir)).toHaveLength(0);
  });

  it('a ledger append failure never fails the run (best-effort)', async () => {
    mockRunHeadless.mockResolvedValue({
      summary: 'done', completed: true, timedOut: false, aborted: false, taskId: 'x', toolCalls: [],
      usage: { tokens: { input: 5, output: 5, reasoning: 0, cacheRead: 0, cacheWrite: 0 }, costReported: 0.001 },
    });
    // Force appendSpend to throw — start.js wraps the call in its own try/catch,
    // so the run must still complete and emit its JSON doc normally.
    jest.spyOn(require('../src/utils/spend-ledger'), 'appendSpend').mockImplementation(() => {
      throw new Error('ledger boom');
    });
    const logSpy = console.log;
    const exitCode = await startSidecar({
      model: 'openrouter/a/b', prompt: 'task', noUi: true, cwd: project,
      includeContext: false, json: true, taskId: 'spend0003',
    });
    expect(exitCode).toBe(0);
    expect(logSpy).toHaveBeenCalledTimes(1);
    const doc = JSON.parse(logSpy.mock.calls[0][0]);
    expect(doc.status).toBe('complete');
    jest.restoreAllMocks();
  });
});

describe('finalizeSession signature (source guard)', () => {
  it('accepts an opts arg and uses process.stderr.write for quietStdout routing', () => {
    const src = fs.readFileSync(path.join(__dirname, '../src/sidecar/session-utils.js'), 'utf-8');
    expect(src).toMatch(/function finalizeSession\(sessionDir, summary, project, metadata, opts = \{\}\)/);
    expect(src).toContain('process.stderr.write');
  });
});
