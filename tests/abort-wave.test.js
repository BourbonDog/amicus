// tests/abort-wave.test.js
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../src/utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const { handleAbort } = require('../src/cli-handlers');

describe('abort <waveId> (F4)', () => {
  let project;
  let logSpy;

  const writeSession = (taskId, meta) => {
    const dir = path.join(project, '.claude', 'amicus_sessions', taskId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify({ taskId, ...meta }, null, 2));
    return dir;
  };

  const readStatus = (taskId) => JSON.parse(fs.readFileSync(
    path.join(project, '.claude', 'amicus_sessions', taskId, 'metadata.json'), 'utf-8')).status;

  beforeEach(() => {
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-abortwave-'));
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    fs.rmSync(project, { recursive: true, force: true });
  });

  it('marks the wave AND every running leg aborted; completed legs stay complete', async () => {
    writeSession('beef0001', { type: 'wave', status: 'running', legs: ['beef0001-1', 'beef0001-2'] });
    writeSession('beef0001-1', { status: 'running', parentWave: 'beef0001' });
    writeSession('beef0001-2', { status: 'complete', parentWave: 'beef0001' });

    await handleAbort({ _: ['abort', 'beef0001'], cwd: project });

    expect(readStatus('beef0001')).toBe('aborted');
    expect(readStatus('beef0001-1')).toBe('aborted');
    expect(readStatus('beef0001-2')).toBe('complete'); // not clobbered
  });

  it('plain session abort still works', async () => {
    writeSession('beef0002', { status: 'running' });
    await handleAbort({ _: ['abort', 'beef0002'], cwd: project });
    expect(readStatus('beef0002')).toBe('aborted');
  });
});
