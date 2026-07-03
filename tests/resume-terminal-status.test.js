'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

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

const { runHeadless } = require('../src/headless');
const { runInteractive } = require('../src/sidecar/interactive');
const { resumeAmicus } = require('../src/index');

describe('resume.js terminal state + exit code', () => {
  let projectDir;

  beforeEach(() => {
    jest.clearAllMocks();
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-res-'));
    // Resume reuses the SAME taskId/dir — seed the session being resumed.
    const dir = path.join(projectDir, '.claude', 'amicus_sessions', 'res00001');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify({
      taskId: 'res00001', model: 'google/gemini-2.5-flash', agent: 'build',
      briefing: 'orig', createdAt: new Date().toISOString(), status: 'complete'
    }));
  });
  afterEach(() => fs.rmSync(projectDir, { recursive: true, force: true }));

  async function runWith(headlessResult, opts = {}) {
    runHeadless.mockResolvedValue(headlessResult);
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    let code;
    try {
      code = await resumeAmicus({
        taskId: 'res00001', project: projectDir,
        headless: true, timeout: 5, ...opts,
      });
    } finally { consoleSpy.mockRestore(); }
    const meta = JSON.parse(fs.readFileSync(path.join(
      projectDir, '.claude', 'amicus_sessions', 'res00001', 'metadata.json'), 'utf-8'));
    return { code, meta };
  }

  it('error result → status "error" + reason, exit 1 (was: complete/undefined)', async () => {
    const { code, meta } = await runWith({ completed: false, error: 'boom', summary: '', taskId: 'res00001' });
    expect(code).toBe(1);
    expect(meta.status).toBe('error');
    expect(meta.reason).toBe('boom');
  });

  it('timed-out result → status "timed-out", exit 2', async () => {
    const { code, meta } = await runWith({ completed: false, timedOut: true, summary: 'partial', taskId: 'res00001' });
    expect(code).toBe(2);
    expect(meta.status).toBe('timed-out');
  });

  it('completed result → status "complete", exit 0', async () => {
    const { code, meta } = await runWith({ completed: true, summary: 'done', taskId: 'res00001' });
    expect(code).toBe(0);
    expect(meta.status).toBe('complete');
  });

  it('interactive empty-summary run stays "complete" (carve-out preserved)', async () => {
    runInteractive.mockResolvedValue({ summary: '', completed: true, timedOut: false, taskId: 'res00001' });
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    let code;
    try {
      code = await resumeAmicus({ taskId: 'res00001', project: projectDir, headless: false });
    } finally { consoleSpy.mockRestore(); }
    const meta = JSON.parse(fs.readFileSync(path.join(
      projectDir, '.claude', 'amicus_sessions', 'res00001', 'metadata.json'), 'utf-8'));
    expect(code).toBe(0);
    expect(meta.status).toBe('complete'); // NOT re-classified by the #36 guard
  });
});

describe('bin/amicus.js exit-code wiring', () => {
  it('captures exit codes from handleResume and handleContinue', () => {
    const src = fs.readFileSync(path.join(__dirname, '../bin/amicus.js'), 'utf-8');
    expect(src).toMatch(/exitCode = await handleResume\(args\)/);
    expect(src).toMatch(/exitCode = await handleContinue\(args\)/);
  });
});
