'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

function writeSession(projectDir, taskId, meta) {
  const dir = path.join(projectDir, '.claude', 'amicus_sessions', taskId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'metadata.json'),
    JSON.stringify({ taskId, status: 'running', createdAt: new Date().toISOString(), ...meta }, null, 2));
  return dir;
}
const readMeta = (projectDir, taskId) => JSON.parse(fs.readFileSync(
  path.join(projectDir, '.claude', 'amicus_sessions', taskId, 'metadata.json'), 'utf-8'));
const parseResult = (r) => JSON.parse(r.content[0].text);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

describe('amicus_abort ordering (Phase 3)', () => {
  let tmpDir; let handlers; let killSpy;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-abort-'));
    process.env.AMICUS_ABORT_GRACE_MS = '60';
    handlers = require('../src/mcp-server').handlers;
    killSpy = jest.spyOn(process, 'kill').mockImplementation(() => {}); // every pid reads "alive"
  });
  afterEach(() => {
    killSpy.mockRestore();
    delete process.env.AMICUS_ABORT_GRACE_MS;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    jest.resetModules();
  });

  test('wave abort marks wave + all running legs BEFORE any kill; pid+goPid SIGTERMed only after grace', async () => {
    writeSession(tmpDir, 'cafe0001', { type: 'wave', legs: ['cafe0001-1', 'cafe0001-2'], pid: 4242, goPid: 4343 });
    writeSession(tmpDir, 'cafe0001-1', { parentWave: 'cafe0001' });                     // running
    writeSession(tmpDir, 'cafe0001-2', { parentWave: 'cafe0001', status: 'complete' }); // finished

    const data = parseResult(await handlers.amicus_abort({ taskId: 'cafe0001' }, tmpDir));
    expect(data.status).toBe('aborted');
    expect(data.legsAborted).toBe(1);

    // markers landed synchronously — and NO SIGTERM has been sent yet
    expect(readMeta(tmpDir, 'cafe0001').status).toBe('aborted');
    expect(readMeta(tmpDir, 'cafe0001-1').status).toBe('aborted');
    expect(readMeta(tmpDir, 'cafe0001-2').status).toBe('complete'); // never clobbered
    expect(killSpy).not.toHaveBeenCalledWith(4242, 'SIGTERM');
    expect(killSpy).not.toHaveBeenCalledWith(4343, 'SIGTERM');

    await sleep(500); // grace (60ms) + one 250ms poll cycle + slack
    expect(killSpy).toHaveBeenCalledWith(4242, 'SIGTERM'); // orchestrator fallback-killed
    expect(killSpy).toHaveBeenCalledWith(4343, 'SIGTERM'); // owned Go server fallback-killed
  });

  test('regression: MCP wave abort no longer strands legs — status shows no running leg', async () => {
    writeSession(tmpDir, 'cafe0002', { type: 'wave', legs: ['cafe0002-1'], pid: 4242 });
    writeSession(tmpDir, 'cafe0002-1', { parentWave: 'cafe0002' });
    await handlers.amicus_abort({ taskId: 'cafe0002' }, tmpDir);
    const status = parseResult(await handlers.amicus_status({ taskId: 'cafe0002' }, tmpDir));
    expect(status.status).toBe('aborted');
    expect(status.legs.every(l => l.status !== 'running')).toBe(true);
    expect(status.legs[0].status).toBe('aborted');
    // Drain the fire-and-forget waitThenKill poll (grace 60ms + one 250ms poll
    // cycle + slack) — same as the sibling tests — so the real-timer interval
    // never leaks past mockRestore()/jest.resetModules() below.
    await sleep(500);
  });

  test('single session: marker immediate, wedged pid killed only after grace', async () => {
    writeSession(tmpDir, 'beef0003', { pid: 5555 });
    await handlers.amicus_abort({ taskId: 'beef0003' }, tmpDir);
    expect(readMeta(tmpDir, 'beef0003').status).toBe('aborted');
    expect(readMeta(tmpDir, 'beef0003').abortedAt).toBeDefined();
    expect(killSpy).not.toHaveBeenCalledWith(5555, 'SIGTERM'); // marker-first
    await sleep(500);
    expect(killSpy).toHaveBeenCalledWith(5555, 'SIGTERM'); // fallback for a wedged process
  });

  test('single session that honors the marker within the grace window is never signalled', async () => {
    writeSession(tmpDir, 'beef0004', { pid: 6666 });
    killSpy.mockImplementation((pid, sig) => {
      if (pid === 6666 && sig === 0) { const e = new Error('ESRCH'); e.code = 'ESRCH'; throw e; }
    }); // liveness probe says "already exited"
    await handlers.amicus_abort({ taskId: 'beef0004' }, tmpDir);
    await sleep(500);
    expect(killSpy).not.toHaveBeenCalledWith(6666, 'SIGTERM');
  });

  test('shared-server session (pid null) is marker-only; the shared goPid is NEVER killed', async () => {
    writeSession(tmpDir, 'beef0005', { pid: null, goPid: 7777, opencodeSessionId: 'ses_x' });
    await handlers.amicus_abort({ taskId: 'beef0005' }, tmpDir);
    expect(readMeta(tmpDir, 'beef0005').status).toBe('aborted');
    await sleep(500);
    expect(killSpy).not.toHaveBeenCalledWith(7777, 'SIGTERM');
  });
});
