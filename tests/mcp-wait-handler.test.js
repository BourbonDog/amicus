// tests/mcp-wait-handler.test.js — disk-backed handler tests (mcp-headless-lifecycle pattern).
// Write FIRST: fails because handlers.amicus_wait is undefined.
// Run: npx jest tests/mcp-wait-handler.test.js
const fs = require('fs');
const path = require('path');
const os = require('os');

function createSession(projectDir, taskId, meta) {
  const sessDir = path.join(projectDir, '.claude', 'amicus_sessions', taskId);
  fs.mkdirSync(sessDir, { recursive: true });
  fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
    taskId, status: 'running', model: 'gemini', createdAt: new Date().toISOString(), ...meta,
  }, null, 2));
  return sessDir;
}
const parse = (r) => JSON.parse(r.content[0].text);

describe('amicus_wait handler', () => {
  let tmpDir; let handlers;
  beforeEach(() => {
    jest.resetModules();
    process.env.AMICUS_WAIT_POLL_INTERVAL_MS = '25'; // fast polls (read at module load)
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-wait-'));
    handlers = require('../src/mcp-server').handlers;
  });
  afterEach(() => {
    delete process.env.AMICUS_WAIT_POLL_INTERVAL_MS;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    jest.resetModules();
  });

  test('terminal session returns immediately: status shape + timedOut:false', async () => {
    createSession(tmpDir, 'w-done', { status: 'complete', completedAt: new Date().toISOString() });
    const body = parse(await handlers.amicus_wait({ taskId: 'w-done' }, tmpDir));
    expect(body.status).toBe('complete');
    expect(body.timedOut).toBe(false);
    expect(body).toHaveProperty('elapsed');
    expect(body).toHaveProperty('version');
  });

  test('running session times out: timedOut:true, no sleep-25 protocol', async () => {
    createSession(tmpDir, 'w-run', { status: 'running', pid: process.pid, headless: true });
    const res = await handlers.amicus_wait({ taskId: 'w-run', timeoutMs: 1000 }, tmpDir);
    const body = parse(res);
    expect(body.status).toBe('running');
    expect(body.timedOut).toBe(true);
    expect(body.next_poll).toBeUndefined();
    expect(res.content.map(c => c.text).join('\n')).not.toContain('sleep 25');
  }, 10000);

  test('poll fallback: resolves when metadata flips terminal on disk', async () => {
    const sessDir = createSession(tmpDir, 'w-flip', { status: 'running', pid: process.pid, headless: true });
    const metaPath = path.join(sessDir, 'metadata.json');
    setTimeout(() => {
      const m = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      m.status = 'complete'; m.completedAt = new Date().toISOString();
      fs.writeFileSync(metaPath, JSON.stringify(m, null, 2));
    }, 150);
    const body = parse(await handlers.amicus_wait({ taskId: 'w-flip', timeoutMs: 10000 }, tmpDir));
    expect(body.status).toBe('complete');
    expect(body.timedOut).toBe(false);
  }, 15000);

  test('wave: returns once ALL legs are terminal (wave record still running)', async () => {
    createSession(tmpDir, 'wave-1', { type: 'wave', status: 'running', legs: ['wave-1-1', 'wave-1-2'], pid: process.pid });
    createSession(tmpDir, 'wave-1-1', { status: 'complete' });
    createSession(tmpDir, 'wave-1-2', { status: 'running', pid: process.pid });
    const p = handlers.amicus_wait({ taskId: 'wave-1', timeoutMs: 10000 }, tmpDir);
    setTimeout(() => {
      const legMeta = path.join(tmpDir, '.claude', 'amicus_sessions', 'wave-1-2', 'metadata.json');
      const m = JSON.parse(fs.readFileSync(legMeta, 'utf-8'));
      m.status = 'error'; m.reason = 'boom';
      fs.writeFileSync(legMeta, JSON.stringify(m, null, 2));
    }, 150);
    const body = parse(await p);
    expect(body.type).toBe('wave');
    expect(body.legsComplete).toBe(2);
    expect(body.timedOut).toBe(false);
  }, 15000);

  test('in-process settle wakes a pending wait (fresh registry per resetModules)', async () => {
    const { registerInProcessRun, settleInProcessRun } = require('../src/mcp-wait');
    const sessDir = createSession(tmpDir, 'w-proc', { status: 'running', pid: null, headless: true });
    registerInProcessRun('w-proc');
    const p = handlers.amicus_wait({ taskId: 'w-proc', timeoutMs: 30000 }, tmpDir);
    await new Promise(r => setTimeout(r, 60));
    const metaPath = path.join(sessDir, 'metadata.json');
    const m = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    m.status = 'complete'; m.completedAt = new Date().toISOString();
    fs.writeFileSync(metaPath, JSON.stringify(m, null, 2));
    settleInProcessRun('w-proc');
    const body = parse(await p);
    expect(body.status).toBe('complete');
    expect(body.timedOut).toBe(false);
  }, 10000);

  test('unknown taskId returns the not-found error', async () => {
    const res = await handlers.amicus_wait({ taskId: 'nope-1' }, tmpDir);
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('not found');
  });

  // Task 15 (spec §5.3) end-to-end delivery wiring: the dispatch loop
  // (mcp-server.js's startMcpServer) calls handlers[tool.name](input, project,
  // server) — amicus_wait's 3rd param IS that McpServer instance. This proves
  // the full chain: requestMcpNotify at launch → handlers.amicus_wait receives
  // mcpServer → runWait's terminal branch calls mcpServer.server.sendLoggingMessage.
  describe('mcp-notify end-to-end: amicus_wait wires mcpServer.server.sendLoggingMessage', () => {
    test('a run marked via requestMcpNotify triggers sendLoggingMessage once, with a buildNotifyPayload-shaped arg', async () => {
      const { requestMcpNotify } = require('../src/mcp-notify');
      createSession(tmpDir, 'w-notify-done', { status: 'complete', completedAt: new Date().toISOString() });
      requestMcpNotify('w-notify-done');
      const sendLoggingMessage = jest.fn();
      const fakeMcpServer = { server: { sendLoggingMessage } };

      const res = await handlers.amicus_wait({ taskId: 'w-notify-done' }, tmpDir, fakeMcpServer);
      const body = parse(res);
      expect(body.status).toBe('complete');
      expect(sendLoggingMessage).toHaveBeenCalledTimes(1);
      const payload = sendLoggingMessage.mock.calls[0][0];
      expect(payload.level).toBe('info');
      expect(payload.logger).toBe('amicus');
      expect(payload.data.id).toBe('w-notify-done');
      expect(payload.data.status).toBe('complete');
    });

    test('a run NOT marked via requestMcpNotify never calls sendLoggingMessage', async () => {
      createSession(tmpDir, 'w-notify-unmarked', { status: 'complete', completedAt: new Date().toISOString() });
      const sendLoggingMessage = jest.fn();
      const fakeMcpServer = { server: { sendLoggingMessage } };

      await handlers.amicus_wait({ taskId: 'w-notify-unmarked' }, tmpDir, fakeMcpServer);
      expect(sendLoggingMessage).not.toHaveBeenCalled();
    });

    test('a sendLoggingMessage throw (unsupported transport) never fails the wait', async () => {
      const { requestMcpNotify } = require('../src/mcp-notify');
      createSession(tmpDir, 'w-notify-throws', { status: 'complete', completedAt: new Date().toISOString() });
      requestMcpNotify('w-notify-throws');
      const fakeMcpServer = { server: { sendLoggingMessage: () => { throw new Error('no transport'); } } };

      const res = await handlers.amicus_wait({ taskId: 'w-notify-throws' }, tmpDir, fakeMcpServer);
      const body = parse(res);
      expect(body.status).toBe('complete');
      expect(body.timedOut).toBe(false);
    });

    test('no mcpServer passed (e.g. direct handler call) never throws — notify is just skipped', async () => {
      createSession(tmpDir, 'w-notify-nomcp', { status: 'complete', completedAt: new Date().toISOString() });
      const res = await handlers.amicus_wait({ taskId: 'w-notify-nomcp' }, tmpDir);
      const body = parse(res);
      expect(body.status).toBe('complete');
    });
  });
});
