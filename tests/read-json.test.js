// tests/read-json.test.js
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { readSidecar, listSidecars, enumerateSessions } = require('../src/sidecar/read');

describe('read --json and wave-aware list (F4)', () => {
  let project;
  let logSpy;

  const writeSession = (taskId, meta, summary) => {
    const dir = path.join(project, '.claude', 'amicus_sessions', taskId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify({ taskId, ...meta }, null, 2));
    if (summary !== undefined) { fs.writeFileSync(path.join(dir, 'summary.md'), summary); }
    return dir;
  };

  beforeEach(() => {
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-readjson-'));
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    fs.rmSync(project, { recursive: true, force: true });
  });

  it('read --json on a run session emits a parseable run document', async () => {
    writeSession('feed1111', {
      model: 'a/b', agent: 'plan', status: 'complete',
      createdAt: '2026-06-09T10:00:00.000Z', completedAt: '2026-06-09T10:01:00.000Z',
    }, 'sum');
    await readSidecar({ taskId: 'feed1111', json: true, project });
    const doc = JSON.parse(logSpy.mock.calls[0][0]);
    expect(doc).toMatchObject({ type: 'run', taskId: 'feed1111', status: 'complete', summary: 'sum' });
  });

  it('read --json on a wave emits the stored wave.json', async () => {
    const waveDir = writeSession('feed2222', { type: 'wave', status: 'complete', legs: [] });
    fs.writeFileSync(path.join(waveDir, 'wave.json'),
      JSON.stringify({ schemaVersion: 1, type: 'wave', waveId: 'feed2222', status: 'complete', counts: { total: 0, complete: 0, error: 0, timeout: 0, aborted: 0 }, legs: [] }));
    await readSidecar({ taskId: 'feed2222', json: true, project });
    const doc = JSON.parse(logSpy.mock.calls[0][0]);
    expect(doc.type).toBe('wave');
    expect(doc.waveId).toBe('feed2222');
  });

  it('non-json read of a wave prints the human aggregate', async () => {
    const waveDir = writeSession('feed3333', { type: 'wave', status: 'partial', legs: ['feed3333-1'] });
    fs.writeFileSync(path.join(waveDir, 'wave.json'), JSON.stringify({
      schemaVersion: 1, type: 'wave', waveId: 'feed3333', status: 'partial',
      counts: { total: 1, complete: 0, error: 1, timeout: 0, aborted: 0 }, durationMs: 1000,
      legs: [{ taskId: 'feed3333-1', modelInput: 'x', model: 'a/b', status: 'error', error: 'boom', summary: null, durationMs: 1000 }],
    }));
    await readSidecar({ taskId: 'feed3333', project });
    const out = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(out).toContain('feed3333');
    expect(out).toContain('partial');
  });

  it('enumerateSessions carries type/parentWave; list shows a wave marker', async () => {
    writeSession('feed4444', { type: 'wave', status: 'running', legs: ['feed4444-1', 'feed4444-2'], createdAt: new Date().toISOString() });
    writeSession('feed4444-1', { model: 'a/b', status: 'running', parentWave: 'feed4444', createdAt: new Date().toISOString() });

    const sessions = enumerateSessions(project, {});
    const wave = sessions.find(s => s.id === 'feed4444');
    expect(wave.type).toBe('wave');
    expect(wave.legCount).toBe(2);
    const leg = sessions.find(s => s.id === 'feed4444-1');
    expect(leg.parentWave).toBe('feed4444');

    await listSidecars({ project });
    const out = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(out).toContain('wave(2 legs)');
  });
});
