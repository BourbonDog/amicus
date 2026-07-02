// tests/sidecar/interactive-progress.test.js
'use strict';

/**
 * F6c — interactive lifecycle progress. The interactive path (Electron GUI)
 * never wrote lifecycle stages, so amicus_status / the CLI heartbeat read
 * "Starting up... | 0 messages" forever on a live GUI run. This asserts the
 * four lifecycle stages get written via writeProgress, in order, and that
 * the resume branch skips 'prompt_sent' (resume sends no prompt).
 * Hermetic: no real electron/opencode/fs needed — see mocks below.
 */

jest.mock('../../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('../../src/opencode-client', () => ({
  createSession: jest.fn().mockResolvedValue('ses_test'),
  sendPromptAsync: jest.fn().mockResolvedValue({}),
  getMessages: jest.fn().mockResolvedValue([]),
  getSessionStatus: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../src/sidecar/session-utils', () => ({
  startOpenCodeServer: jest.fn().mockResolvedValue({
    client: { fake: 'client' },
    server: { url: 'http://localhost:4096', close: jest.fn() },
  }),
}));
jest.mock('../../src/utils/agent-mapping', () => ({ mapAgentToOpenCode: () => ({ agent: 'chat' }) }));
jest.mock('../../src/utils/env-compat', () => ({ getCompatEnv: () => undefined }));
jest.mock('../../src/session-manager', () => ({ getSessionDir: () => '/sess/dir' }));
jest.mock('../../src/sidecar/interactive-mirror', () => ({
  startInteractiveMirror: () => ({ stop: jest.fn().mockResolvedValue({ usage: null }) }),
}));
jest.mock('../../src/utils/idle-watchdog', () => ({ IdleWatchdog: class { start() { return this; } touch() {} cancel() {} } }));
jest.mock('../../src/utils/activity-poller', () => ({ createActivityPoller: () => ({ stop: jest.fn() }), killIfAlive: jest.fn() }));
jest.mock('../../src/sidecar/electron-ensure', () => ({ ensureElectron: jest.fn().mockResolvedValue({ ok: true, path: '/fake/electron' }) }));
jest.mock('../../src/sidecar/progress', () => ({ writeProgress: jest.fn() }));
jest.mock('fs', () => ({ ...jest.requireActual('fs'), mkdirSync: jest.fn() }));
jest.mock('child_process', () => ({
  spawn: jest.fn(() => {
    const handlers = {};
    const proc = { stdout: { on: () => {} }, stderr: { on: () => {} }, on: (ev, cb) => { handlers[ev] = cb; } };
    setImmediate(() => { if (handlers.close) { handlers.close(0); } });
    return proc;
  }),
}));

const { writeProgress } = require('../../src/sidecar/progress');
const { runInteractive } = require('../../src/sidecar/interactive');

describe('interactive lifecycle progress (F6c)', () => {
  beforeEach(() => {
    writeProgress.mockClear();
  });

  test('writes initializing → server_ready → session_created → prompt_sent to the session dir', async () => {
    await runInteractive('m', 'sys', 'hi', 'task-1', 'C:/proj', {});
    const stages = writeProgress.mock.calls.map(c => c[1]);
    expect(stages).toEqual(expect.arrayContaining(['initializing', 'server_ready', 'session_created', 'prompt_sent']));
    expect(stages.indexOf('initializing')).toBeLessThan(stages.indexOf('server_ready'));
    expect(stages.indexOf('session_created')).toBeLessThan(stages.indexOf('prompt_sent'));
    expect(writeProgress.mock.calls[0][0]).toBe('/sess/dir');
  });

  test('resume path writes session_created but NOT prompt_sent', async () => {
    await runInteractive('m', 'sys', 'hi', 'task-2', 'C:/proj', { isResume: true, opencodeSessionId: 'ses_old' });
    const stages = writeProgress.mock.calls.map(c => c[1]);
    expect(stages).toContain('session_created');
    expect(stages).not.toContain('prompt_sent');
  });

  // Contract: progressStage() wraps mkdirSync+writeProgress in a try/catch
  // that must NEVER break the GUI — a progress-write failure is best-effort
  // only. Deleting that try/catch would make this test fail (runInteractive
  // would reject instead of resolving normally).
  test('progress write failures never break the GUI: runInteractive still resolves when writeProgress throws', async () => {
    writeProgress.mockImplementation(() => { throw new Error('disk full'); });

    const result = await runInteractive('m', 'sys', 'hi', 'task-3', 'C:/proj', {});

    expect(result.completed).toBe(true);
    expect(result.error).toBeUndefined();
    // Other stages were still attempted despite each write throwing.
    const stages = writeProgress.mock.calls.map(c => c[1]);
    expect(stages).toEqual(expect.arrayContaining(['initializing', 'server_ready', 'session_created', 'prompt_sent']));
  });
});
