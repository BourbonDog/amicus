// tests/read-json.test.js
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { readSidecar, listSidecars, enumerateSessions, enumerateAllProjects } = require('../src/sidecar/read');
const { recordSession } = require('../src/utils/session-index');
const { canonicalProjectPath } = require('../src/utils/project-path');

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

  it('read --json on a live wave (no wave.json) reports running, not error', async () => {
    writeSession('feed5555', { type: 'wave', status: 'running', legs: ['feed5555-1'], createdAt: new Date().toISOString() });
    writeSession('feed5555-1', { model: 'a/b', status: 'running', parentWave: 'feed5555', createdAt: new Date().toISOString() });
    await readSidecar({ taskId: 'feed5555', json: true, project });
    const doc = JSON.parse(logSpy.mock.calls[0][0]);
    expect(doc.status).toBe('running');
    expect(doc.legs[0].status).toBe('running');
  });

  it('wave counts: crashed/idle-timeout legs count toward total only (remainder rule, #14)', async () => {
    // Live rebuild (no wave.json) so buildWaveResult computes counts from leg metadata.
    writeSession('feed7777', {
      type: 'wave', status: 'partial',
      legs: ['feed7777-1', 'feed7777-2', 'feed7777-3', 'feed7777-4'],
      createdAt: '2026-06-09T10:00:00.000Z', completedAt: '2026-06-09T10:01:00.000Z',
    });
    writeSession('feed7777-1', { model: 'a/b', status: 'complete', parentWave: 'feed7777' }, 'ok');
    writeSession('feed7777-2', { model: 'c/d', status: 'crashed', parentWave: 'feed7777', reason: 'boom' });
    writeSession('feed7777-3', { model: 'e/f', status: 'idle-timeout', parentWave: 'feed7777' });
    writeSession('feed7777-4', { model: 'g/h', status: 'error', parentWave: 'feed7777' });

    await readSidecar({ taskId: 'feed7777', json: true, project });
    const doc = JSON.parse(logSpy.mock.calls[0][0]);
    const c = doc.counts;
    expect(c.total).toBe(4);
    const named = c.complete + c.error + c.timeout + c.aborted;
    // crashed + idle-timeout are reflected only in `total` — total exceeds the named sum.
    expect(named).toBe(2);
    expect(c.total - named).toBe(2);
    expect(c.total).toBeGreaterThan(named);
  });

  it('read --json on corrupt metadata throws a contextual error', async () => {
    const dir = writeSession('feed6666', { status: 'complete' });
    fs.writeFileSync(path.join(dir, 'metadata.json'), '{ not json');
    await expect(readSidecar({ taskId: 'feed6666', json: true, project }))
      .rejects.toThrow(/feed6666: metadata is corrupt/);
  });

  // v4.7 F8 (D14): enumerateSessions rows gain `tag` (emit-only-when-set) and
  // `mode` (meta.mode, else derived from meta.headless).
  describe('enumerateSessions rows carry tag + mode (F8 D14)', () => {
    it('carries tag when stored on metadata; omits the key entirely otherwise', () => {
      writeSession('tagged01', {
        model: 'a/b', status: 'complete', tag: 'sprint-42', createdAt: new Date().toISOString(),
      });
      writeSession('untagged1', {
        model: 'a/b', status: 'complete', createdAt: new Date().toISOString(),
      });
      const sessions = enumerateSessions(project, {});
      const tagged = sessions.find(s => s.id === 'tagged01');
      const untagged = sessions.find(s => s.id === 'untagged1');
      expect(tagged.tag).toBe('sprint-42');
      expect('tag' in untagged).toBe(false);
    });

    it('mode prefers meta.mode, falls back to meta.headless, defaults to interactive', () => {
      writeSession('modeexp1', {
        model: 'a/b', status: 'complete', mode: 'headless', createdAt: new Date().toISOString(),
      });
      writeSession('modeexp2', {
        model: 'a/b', status: 'complete', headless: true, createdAt: new Date().toISOString(),
      });
      writeSession('modeexp3', {
        model: 'a/b', status: 'complete', createdAt: new Date().toISOString(),
      });
      const sessions = enumerateSessions(project, {});
      expect(sessions.find(s => s.id === 'modeexp1').mode).toBe('headless');
      expect(sessions.find(s => s.id === 'modeexp2').mode).toBe('headless');
      expect(sessions.find(s => s.id === 'modeexp3').mode).toBe('interactive');
    });
  });

  it('human render shows a TAG column between STATUS and AGE', async () => {
    writeSession('tagrow01', {
      model: 'a/b', status: 'complete', tag: 'sprint-42', createdAt: new Date().toISOString(),
    });
    await listSidecars({ project });
    const out = logSpy.mock.calls.map(c => c[0]).join('\n');
    const headerLine = out.split('\n').find(l => l.includes('STATUS'));
    expect(headerLine).toContain('TAG');
    expect(headerLine.indexOf('STATUS')).toBeLessThan(headerLine.indexOf('TAG'));
    expect(headerLine.indexOf('TAG')).toBeLessThan(headerLine.indexOf('AGE'));
    expect(out).toContain('sprint-42');
  });

  // v4.7 F8 (D14): --all goes cross-project via the advisory sessions-index.
  describe('--all cross-project listing (F8 D14)', () => {
    let projB, configDir, prevConfigDir;

    beforeEach(() => {
      projB = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-projB-'));
      configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-idxcfg-'));
      prevConfigDir = process.env.AMICUS_CONFIG_DIR;
      process.env.AMICUS_CONFIG_DIR = configDir;
    });

    afterEach(() => {
      if (prevConfigDir === undefined) { delete process.env.AMICUS_CONFIG_DIR; }
      else { process.env.AMICUS_CONFIG_DIR = prevConfigDir; }
      fs.rmSync(projB, { recursive: true, force: true });
      fs.rmSync(configDir, { recursive: true, force: true });
    });

    it('enumerateAllProjects merges the cwd project with indexed projects, stamps `project`, and skips a stale entry silently', () => {
      writeSession('localone', {
        model: 'a/b', status: 'complete', createdAt: '2026-01-01T00:00:00.000Z',
      });
      const bDir = path.join(projB, '.claude', 'amicus_sessions', 'remoteone');
      fs.mkdirSync(bDir, { recursive: true });
      fs.writeFileSync(path.join(bDir, 'metadata.json'), JSON.stringify({
        taskId: 'remoteone', model: 'c/d', status: 'complete', createdAt: '2026-02-01T00:00:00.000Z',
      }));
      recordSession('remoteone', projB);

      // Stale entry: a taskId indexed against a project directory that no longer exists.
      const missingDir = path.join(os.tmpdir(), 'amicus-missing-does-not-exist-xyz');
      recordSession('staleone', missingDir);

      const rows = enumerateAllProjects({ project });
      expect(rows.map(r => r.id).sort()).toEqual(['localone', 'remoteone']);
      expect(rows.find(r => r.id === 'localone').project).toBe(project);
      expect(rows.find(r => r.id === 'remoteone').project).toBe(canonicalProjectPath(projB));
    });

    it('listSidecars({all:true}) prints rows from both projects with a PROJECT column; without --all only the cwd project appears', async () => {
      writeSession('localtwo', {
        model: 'a/b', status: 'complete', createdAt: '2026-01-01T00:00:00.000Z',
      });
      const bDir = path.join(projB, '.claude', 'amicus_sessions', 'remotetwo');
      fs.mkdirSync(bDir, { recursive: true });
      fs.writeFileSync(path.join(bDir, 'metadata.json'), JSON.stringify({
        taskId: 'remotetwo', model: 'c/d', status: 'complete', createdAt: '2026-02-01T00:00:00.000Z',
      }));
      recordSession('remotetwo', projB);

      await listSidecars({ project, all: true });
      const out = logSpy.mock.calls.map(c => c[0]).join('\n');
      expect(out).toContain('remotetwo');
      expect(out).toContain('localtwo');
      expect(out).toContain('PROJECT');

      logSpy.mockClear();
      await listSidecars({ project });
      const out2 = logSpy.mock.calls.map(c => c[0]).join('\n');
      expect(out2).toContain('localtwo');
      expect(out2).not.toContain('remotetwo');
      expect(out2).not.toContain('PROJECT');
    });
  });
});
