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
      schemaVersion: 1, type: 'run', taskId: 'feed0001',
      model: 'openrouter/a/b', modelInput: 'somealias',
      status: 'complete', summary: 'JSON MODE SUMMARY',
    });
    expect(doc.sessionDir).toContain('feed0001');
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

  it('non-json mode still prints the raw summary (back-compat)', async () => {
    await startSidecar({
      model: 'openrouter/a/b', prompt: 'task', noUi: true, cwd: project,
      includeContext: false, taskId: 'feed0003',
    });
    expect(logSpy).toHaveBeenCalledWith('JSON MODE SUMMARY');
  });
});

describe('finalizeSession conflict routing (F4)', () => {
  it('accepts an opts arg and routes the conflict warning to stderr in json mode', () => {
    const src = fs.readFileSync(path.join(__dirname, '../src/sidecar/session-utils.js'), 'utf-8');
    expect(src).toMatch(/function finalizeSession\(sessionDir, summary, project, metadata, opts = \{\}\)/);
    expect(src).toContain('process.stderr.write');
  });
});
