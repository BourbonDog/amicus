'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// Mocks for the end-to-end describe block below (Finding 2): same set
// continue-json.test.js / resume-json.test.js already use to drive the REAL
// continueSidecar/resumeSidecar without touching a real model/Electron/OpenCode.
jest.mock('../src/utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }
}));
jest.mock('../src/headless', () => ({ runHeadless: jest.fn() }));
jest.mock('../src/sidecar/interactive', () => ({
  runInteractive: jest.fn()
}));
jest.mock('../src/sidecar/interactive-process', () => ({
  checkElectronAvailable: jest.fn(() => true)
}));
jest.mock('../src/utils/mcp-discovery', () => ({ discoverParentMcps: jest.fn(() => null) }));
jest.mock('../src/opencode-client', () => ({
  loadMcpConfig: jest.fn(() => null), parseMcpSpec: jest.fn(() => null)
}));
jest.mock('../src/utils/model-validator', () => ({ warnIfNotInCatalog: jest.fn() }));

const { finalizeSpendForReopen } = require('../src/sidecar/reopen-spend');
const { continueSidecar } = require('../src/sidecar/continue');
const { resumeSidecar } = require('../src/sidecar/resume');
const { runHeadless } = require('../src/headless');
const { readSpendRows } = require('../src/utils/spend-ledger');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'reopen-spend-')); }

/** Seed a session dir at the layout continueSidecar/resumeSidecar expect. */
function seedSession(projectDir, taskId, overrides = {}) {
  const dir = path.join(projectDir, '.claude', 'amicus_sessions', taskId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify({
    taskId, model: 'google/gemini-2.5-flash', agent: 'build',
    briefing: 'orig', createdAt: new Date().toISOString(), status: 'complete',
    ...overrides,
  }));
  return dir;
}

describe('continue/resume finalize writes usage + ledger row (BACKLOG.md:280)', () => {
  const result = { summary: 'x', completed: true, usage: { tokens: { input: 100, output: 40 }, costReported: 0.03 } };

  test('resolves usage into metadata and appends a row with the given op', () => {
    const dir = tmp();
    const meta = { taskId: 'k1', model: 'gpt', mode: 'headless', status: 'complete' };
    const out = finalizeSpendForReopen({
      taskId: 'k1', model: 'gpt', mode: 'headless', op: 'continue',
      result, status: 'complete', project: '/p', metadata: meta,
    }, { dir });
    expect(out.usage.tokens.input).toBe(100);
    expect(meta.usage.tokens.input).toBe(100);
    const rows = require('../src/utils/spend-ledger').readSpendRows(dir);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ taskId: 'k1', op: 'continue', model: 'gpt', status: 'complete' });
  });

  test('no usage totals -> no row, no metadata.usage (an errored reopen)', () => {
    const dir = tmp();
    const meta = { taskId: 'k2', model: 'gpt' };
    const out = finalizeSpendForReopen({
      taskId: 'k2', model: 'gpt', mode: 'headless', op: 'resume',
      result: { summary: '', completed: false, error: 'boom' }, status: 'error', project: '/p', metadata: meta,
    }, { dir });
    expect(out.usage).toBeNull();
    expect('usage' in meta).toBe(false);
    expect(require('../src/utils/spend-ledger').readSpendRows(dir)).toEqual([]);
  });
});

// Finding 2: only the pure helper above had coverage — the reload -> call-helper
// -> conditional write-back wiring at continue.js:~270-278 / resume.js:~252-261
// was entirely unexercised. These drive the REAL continueSidecar/resumeSidecar
// (not the helper directly) so a wrong-variable capture, a swapped `op`, or a
// dropped write-back would actually fail a test.
describe('continue/resume wiring: end-to-end spend-ledger + metadata.usage (Finding 2)', () => {
  let projectDir;
  let prevConfigDir;
  let ledgerDir;
  let logSpy;
  const usage = { tokens: { input: 50, output: 20, reasoning: 0, cacheRead: 0, cacheWrite: 0 }, costReported: 0.01 };

  beforeEach(() => {
    jest.clearAllMocks();
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-e2espend-'));
    prevConfigDir = process.env.AMICUS_CONFIG_DIR;
    ledgerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-e2espend-ledger-'));
    process.env.AMICUS_CONFIG_DIR = ledgerDir;
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    fs.rmSync(projectDir, { recursive: true, force: true });
    if (prevConfigDir === undefined) { delete process.env.AMICUS_CONFIG_DIR; }
    else { process.env.AMICUS_CONFIG_DIR = prevConfigDir; }
  });

  it('continueSidecar appends a spend-ledger row with op:"continue" and writes metadata.usage', async () => {
    seedSession(projectDir, 'old0e2e1');
    runHeadless.mockResolvedValue({
      summary: 'continued', completed: true, timedOut: false, aborted: false, taskId: 'new0e2e1', usage,
    });
    await continueSidecar({
      taskId: 'old0e2e1', newTaskId: 'new0e2e1', briefing: 'follow-up',
      model: 'google/gemini-2.5-flash', project: projectDir,
      headless: true, timeout: 5, json: true,
    });
    const rows = readSpendRows(ledgerDir);
    expect(rows).toHaveLength(1);
    // Guards the op values NOT being swapped between continue.js/resume.js.
    expect(rows[0]).toMatchObject({ taskId: 'new0e2e1', op: 'continue', status: 'complete' });
    const doc = JSON.parse(logSpy.mock.calls[0][0]);
    expect(doc.usage.tokens.input).toBe(50);
  });

  it('resumeSidecar appends a spend-ledger row with op:"resume" and writes metadata.usage', async () => {
    seedSession(projectDir, 'res0e2e1');
    runHeadless.mockResolvedValue({
      summary: 'resumed', completed: true, timedOut: false, aborted: false, taskId: 'res0e2e1', usage,
    });
    await resumeSidecar({
      taskId: 'res0e2e1', project: projectDir, headless: true, timeout: 5, json: true,
    });
    const rows = readSpendRows(ledgerDir);
    expect(rows).toHaveLength(1);
    // Guards the op values NOT being swapped between continue.js/resume.js.
    expect(rows[0]).toMatchObject({ taskId: 'res0e2e1', op: 'resume', status: 'complete' });
    const doc = JSON.parse(logSpy.mock.calls[0][0]);
    expect(doc.usage.tokens.input).toBe(50);
  });

  it('timed-out continue writes a ledger row with status "timeout" (start.js vocabulary, not "timed-out")', async () => {
    seedSession(projectDir, 'old0e2e2');
    runHeadless.mockResolvedValue({
      summary: 'partial', completed: false, timedOut: true, aborted: false, taskId: 'new0e2e2', usage,
    });
    await continueSidecar({
      taskId: 'old0e2e2', newTaskId: 'new0e2e2', briefing: 'follow-up',
      model: 'google/gemini-2.5-flash', project: projectDir,
      headless: true, timeout: 5, json: true,
    });
    const rows = readSpendRows(ledgerDir);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('timeout');
  });

  it('timed-out resume writes a ledger row with status "timeout" (start.js vocabulary, not "timed-out")', async () => {
    seedSession(projectDir, 'res0e2e2');
    runHeadless.mockResolvedValue({
      summary: 'partial', completed: false, timedOut: true, aborted: false, taskId: 'res0e2e2', usage,
    });
    await resumeSidecar({
      taskId: 'res0e2e2', project: projectDir, headless: true, timeout: 5, json: true,
    });
    const rows = readSpendRows(ledgerDir);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('timeout');
  });
});
