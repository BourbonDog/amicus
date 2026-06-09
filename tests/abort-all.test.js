'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { enumerateSessions } = require('../src/sidecar/read');

function seed(project, id, status) {
  const dir = path.join(project, '.claude', 'amicus_sessions', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'metadata.json'),
    JSON.stringify({ taskId: id, status, model: 'm', createdAt: new Date().toISOString() }));
}

describe('enumerateSessions', () => {
  let project;
  beforeEach(() => { project = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-enum-')); });
  afterEach(() => fs.rmSync(project, { recursive: true, force: true }));

  test('returns only running sessions when filtered', () => {
    seed(project, 'aaaaaaaa', 'running');
    seed(project, 'bbbbbbbb', 'complete');
    seed(project, 'cccccccc', 'running');
    const running = enumerateSessions(project, { status: 'running' });
    expect(running.map(s => s.id).sort()).toEqual(['aaaaaaaa', 'cccccccc']);
  });

  test('returns [] when no sessions dir exists', () => {
    expect(enumerateSessions(project, { status: 'running' })).toEqual([]);
  });
});

describe('handleAbort --all', () => {
  let project, logSpy;
  beforeEach(() => {
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-abortall-'));
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => { logSpy.mockRestore(); fs.rmSync(project, { recursive: true, force: true }); });

  test('marks every running session aborted', async () => {
    seed(project, 'aaaaaaaa', 'running');
    seed(project, 'bbbbbbbb', 'running');
    seed(project, 'cccccccc', 'complete');
    const { handleAbort } = require('../src/cli-handlers');
    await handleAbort({ _: ['abort'], all: true, cwd: project });
    const read = id => JSON.parse(fs.readFileSync(
      path.join(project, '.claude', 'amicus_sessions', id, 'metadata.json'), 'utf-8')).status;
    expect(read('aaaaaaaa')).toBe('aborted');
    expect(read('bbbbbbbb')).toBe('aborted');
    expect(read('cccccccc')).toBe('complete');
  });

  test('prints the no-op message when nothing is running', async () => {
    const { handleAbort } = require('../src/cli-handlers');
    await handleAbort({ _: ['abort'], all: true, cwd: project });
    expect(logSpy).toHaveBeenCalledWith('No running sessions to abort.');
  });
});
