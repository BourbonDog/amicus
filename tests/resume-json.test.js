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
const { SCHEMA_VERSION } = require('../src/utils/result-schema');
const { resumeAmicus } = require('../src/index');

describe('resume --json (B21-rest)', () => {
  let projectDir;
  let logSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-resjson-'));
    const dir = path.join(projectDir, '.claude', 'amicus_sessions', 'res0json1');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify({
      taskId: 'res0json1', model: 'google/gemini-2.5-flash', agent: 'build',
      briefing: 'orig', createdAt: new Date().toISOString(), status: 'complete'
    }));
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  it('emits ONLY a parseable run document on stdout on success', async () => {
    runHeadless.mockResolvedValue({
      summary: 'resumed summary', completed: true, timedOut: false, aborted: false, taskId: 'res0json1',
    });
    await resumeAmicus({
      taskId: 'res0json1', project: projectDir, headless: true, timeout: 5, json: true,
    });
    expect(logSpy).toHaveBeenCalledTimes(1);
    const doc = JSON.parse(logSpy.mock.calls[0][0]);
    expect(doc).toMatchObject({
      schemaVersion: SCHEMA_VERSION, type: 'run', taskId: 'res0json1',
      status: 'complete', summary: 'resumed summary',
    });
  });

  it('emits a parseable error document when the run errors', async () => {
    runHeadless.mockResolvedValue({
      summary: '', completed: false, timedOut: false, aborted: false, error: 'resume exploded', taskId: 'res0json1',
    });
    await resumeAmicus({
      taskId: 'res0json1', project: projectDir, headless: true, timeout: 5, json: true,
    });
    expect(logSpy).toHaveBeenCalledTimes(1);
    const doc = JSON.parse(logSpy.mock.calls[0][0]);
    expect(doc.status).toBe('error');
    expect(doc.error).toBe('resume exploded');
  });

  it('non-json mode still prints the fenced summary (unchanged)', async () => {
    runHeadless.mockResolvedValue({
      summary: 'resumed summary', completed: true, timedOut: false, aborted: false, taskId: 'res0json1',
    });
    await resumeAmicus({
      taskId: 'res0json1', project: projectDir, headless: true, timeout: 5,
    });
    expect(logSpy).toHaveBeenCalledTimes(1);
    const written = logSpy.mock.calls[0][0];
    expect(written).toContain('resumed summary');
    // must NOT be a JSON doc
    expect(() => JSON.parse(written)).toThrow();
  });
});

describe('handleResume --json pre-flight (bin/amicus.js wiring)', () => {
  function captureStdout(fn) {
    const out = [];
    const spyOut = jest.spyOn(process.stdout, 'write').mockImplementation((s) => { out.push(s); return true; });
    const spyErr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const spyExit = jest.spyOn(process, 'exit').mockImplementation((c) => { throw new Error(`exit:${c}`); });
    return fn().catch(e => e).finally(() => { spyOut.mockRestore(); spyErr.mockRestore(); spyExit.mockRestore(); }).then(() => out.join(''));
  }

  it('resume --json without --no-ui -> BAD_ARGS envelope on stdout', async () => {
    const { handleResume } = require('../src/cli-handlers-resume-continue');
    const out = await captureStdout(() => handleResume({ _: ['resume', 'sometask'], json: true, 'no-ui': false }));
    const doc = JSON.parse(out);
    expect(doc).toMatchObject({ type: 'error', ok: false, error: { code: 'BAD_ARGS' } });
  });

  it('resume --json without a task id -> BAD_SESSION envelope on stdout', async () => {
    const { handleResume } = require('../src/cli-handlers-resume-continue');
    const out = await captureStdout(() => handleResume({ _: ['resume'], json: true, 'no-ui': true }));
    const doc = JSON.parse(out);
    expect(doc).toMatchObject({ type: 'error', ok: false, error: { code: 'BAD_SESSION' } });
  });

  it('resume --json with an invalid task id -> BAD_SESSION envelope on stdout', async () => {
    const { handleResume } = require('../src/cli-handlers-resume-continue');
    const out = await captureStdout(() => handleResume({ _: ['resume', '../etc'], json: true, 'no-ui': true }));
    const doc = JSON.parse(out);
    expect(doc).toMatchObject({ type: 'error', ok: false, error: { code: 'BAD_SESSION' } });
  });
});
