'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../src/utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }
}));
jest.mock('../src/headless', () => ({ runHeadless: jest.fn() }));
jest.mock('../src/sidecar/interactive', () => ({
  runInteractive: jest.fn(), checkElectronAvailable: jest.fn(() => true)
}));
jest.mock('../src/utils/mcp-discovery', () => ({ discoverParentMcps: jest.fn(() => null) }));
jest.mock('../src/opencode-client', () => ({
  loadMcpConfig: jest.fn(() => null), parseMcpSpec: jest.fn(() => null)
}));

const { runHeadless } = require('../src/headless');
const { runInteractive } = require('../src/sidecar/interactive');
const { continueSidecar } = require('../src/index');

describe('continue.js terminal state + exit code', () => {
  let projectDir;

  beforeEach(() => {
    jest.clearAllMocks();
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-cont-'));
    const oldDir = path.join(projectDir, '.claude', 'amicus_sessions', 'old00001');
    fs.mkdirSync(oldDir, { recursive: true });
    fs.writeFileSync(path.join(oldDir, 'metadata.json'), JSON.stringify({
      taskId: 'old00001', model: 'google/gemini-2.5-flash', agent: 'build',
      briefing: 'orig', createdAt: new Date().toISOString(), status: 'complete'
    }));
  });
  afterEach(() => fs.rmSync(projectDir, { recursive: true, force: true }));

  async function runWith(headlessResult, opts = {}) {
    runHeadless.mockResolvedValue(headlessResult);
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    let code;
    try {
      code = await continueSidecar({
        taskId: 'old00001', newTaskId: 'new00001', briefing: 'follow-up',
        model: 'google/gemini-2.5-flash', project: projectDir,
        headless: true, timeout: 5, ...opts,
      });
    } finally { consoleSpy.mockRestore(); }
    const meta = JSON.parse(fs.readFileSync(path.join(
      projectDir, '.claude', 'amicus_sessions', 'new00001', 'metadata.json'), 'utf-8'));
    return { code, meta };
  }

  it('error result → status "error" + reason, exit 1 (was: complete/undefined)', async () => {
    const { code, meta } = await runWith({ completed: false, error: 'boom', summary: '', taskId: 'new00001' });
    expect(code).toBe(1);
    expect(meta.status).toBe('error');
    expect(meta.reason).toBe('boom');
  });

  it('timed-out result → status "timed-out", exit 2', async () => {
    const { code, meta } = await runWith({ completed: false, timedOut: true, summary: 'partial', taskId: 'new00001' });
    expect(code).toBe(2);
    expect(meta.status).toBe('timed-out');
  });

  it('completed result → status "complete", exit 0', async () => {
    const { code, meta } = await runWith({ completed: true, summary: 'done', taskId: 'new00001' });
    expect(code).toBe(0);
    expect(meta.status).toBe('complete');
  });

  it('interactive empty-summary run stays "complete" (carve-out preserved)', async () => {
    runInteractive.mockResolvedValue({ summary: '', completed: true, timedOut: false, taskId: 'new00001' });
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    let code;
    try {
      code = await continueSidecar({
        taskId: 'old00001', newTaskId: 'new00001', briefing: 'follow-up',
        model: 'google/gemini-2.5-flash', project: projectDir, headless: false,
      });
    } finally { consoleSpy.mockRestore(); }
    const meta = JSON.parse(fs.readFileSync(path.join(
      projectDir, '.claude', 'amicus_sessions', 'new00001', 'metadata.json'), 'utf-8'));
    expect(code).toBe(0);
    expect(meta.status).toBe('complete'); // NOT re-classified by the #36 guard
  });
});
