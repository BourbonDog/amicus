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

const { runHeadless } = require('../src/headless');
const { SCHEMA_VERSION } = require('../src/utils/result-schema');
const { continueAmicus } = require('../src/index');

describe('continue --json (B21-rest)', () => {
  let projectDir;
  let logSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-contjson-'));
    const oldDir = path.join(projectDir, '.claude', 'amicus_sessions', 'old0json1');
    fs.mkdirSync(oldDir, { recursive: true });
    fs.writeFileSync(path.join(oldDir, 'metadata.json'), JSON.stringify({
      taskId: 'old0json1', model: 'google/gemini-2.5-flash', agent: 'build',
      briefing: 'orig', createdAt: new Date().toISOString(), status: 'complete'
    }));
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  it('emits ONLY a parseable run document on stdout on success, carrying the NEW task id', async () => {
    runHeadless.mockResolvedValue({
      summary: 'continued summary', completed: true, timedOut: false, aborted: false, taskId: 'new0json1',
    });
    await continueAmicus({
      taskId: 'old0json1', newTaskId: 'new0json1', briefing: 'follow-up',
      model: 'google/gemini-2.5-flash', project: projectDir,
      headless: true, timeout: 5, json: true,
    });
    expect(logSpy).toHaveBeenCalledTimes(1);
    const doc = JSON.parse(logSpy.mock.calls[0][0]);
    expect(doc).toMatchObject({
      schemaVersion: SCHEMA_VERSION, type: 'run', taskId: 'new0json1',
      status: 'complete', summary: 'continued summary',
    });
  });

  it('emits a parseable error document when the run errors', async () => {
    runHeadless.mockResolvedValue({
      summary: '', completed: false, timedOut: false, aborted: false, error: 'continue exploded', taskId: 'new0json2',
    });
    await continueAmicus({
      taskId: 'old0json1', newTaskId: 'new0json2', briefing: 'follow-up',
      model: 'google/gemini-2.5-flash', project: projectDir,
      headless: true, timeout: 5, json: true,
    });
    expect(logSpy).toHaveBeenCalledTimes(1);
    const doc = JSON.parse(logSpy.mock.calls[0][0]);
    expect(doc.status).toBe('error');
    expect(doc.error).toBe('continue exploded');
  });

  it('non-json mode still prints the fenced summary (unchanged)', async () => {
    runHeadless.mockResolvedValue({
      summary: 'continued summary', completed: true, timedOut: false, aborted: false, taskId: 'new0json3',
    });
    await continueAmicus({
      taskId: 'old0json1', newTaskId: 'new0json3', briefing: 'follow-up',
      model: 'google/gemini-2.5-flash', project: projectDir,
      headless: true, timeout: 5,
    });
    expect(logSpy).toHaveBeenCalledTimes(1);
    const written = logSpy.mock.calls[0][0];
    expect(written).toContain('continued summary');
    expect(() => JSON.parse(written)).toThrow();
  });
});

describe('handleContinue --json pre-flight (bin/amicus.js wiring)', () => {
  function captureStdout(fn) {
    const out = [];
    const spyOut = jest.spyOn(process.stdout, 'write').mockImplementation((s) => { out.push(s); return true; });
    const spyErr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const spyExit = jest.spyOn(process, 'exit').mockImplementation((c) => { throw new Error(`exit:${c}`); });
    return fn().catch(e => e).finally(() => { spyOut.mockRestore(); spyErr.mockRestore(); spyExit.mockRestore(); }).then(() => out.join(''));
  }

  it('continue --json without --no-ui -> BAD_ARGS envelope on stdout', async () => {
    const { handleContinue } = require('../src/cli-handlers-resume-continue');
    const out = await captureStdout(() => handleContinue({
      _: ['continue', 'sometask'], json: true, 'no-ui': false, prompt: 'hi',
    }));
    const doc = JSON.parse(out);
    expect(doc).toMatchObject({ type: 'error', ok: false, error: { code: 'BAD_ARGS' } });
  });

  it('continue --json without a task id -> BAD_SESSION envelope on stdout', async () => {
    const { handleContinue } = require('../src/cli-handlers-resume-continue');
    const out = await captureStdout(() => handleContinue({ _: ['continue'], json: true, 'no-ui': true, prompt: 'hi' }));
    const doc = JSON.parse(out);
    expect(doc).toMatchObject({ type: 'error', ok: false, error: { code: 'BAD_SESSION' } });
  });

  it('continue --json with an invalid task id -> BAD_SESSION envelope on stdout', async () => {
    const { handleContinue } = require('../src/cli-handlers-resume-continue');
    const out = await captureStdout(() => handleContinue({
      _: ['continue', '../etc'], json: true, 'no-ui': true, prompt: 'hi',
    }));
    const doc = JSON.parse(out);
    expect(doc).toMatchObject({ type: 'error', ok: false, error: { code: 'BAD_SESSION' } });
  });

  it('continue --json without --prompt -> MISSING_PROMPT envelope on stdout', async () => {
    const { handleContinue } = require('../src/cli-handlers-resume-continue');
    const out = await captureStdout(() => handleContinue({ _: ['continue', 'sometask'], json: true, 'no-ui': true }));
    const doc = JSON.parse(out);
    expect(doc).toMatchObject({ type: 'error', ok: false, error: { code: 'MISSING_PROMPT' } });
  });
});
