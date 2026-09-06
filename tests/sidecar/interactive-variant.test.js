'use strict';

/**
 * #218 PR 4 whole-branch review (EP-4 / REC-2 / PRT-2 / D4; TM-2's pins ride here).
 * The interactive sender is the DEFAULT `amicus start` mode, and it discarded
 * sendPrompt's result: no `variant` on the run document or ledger row, and an
 * unverified send warned nothing. tests/sidecar/start.test.js pins that start.js
 * passes `variant` INTO runInteractive; this file pins what comes OUT of it.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const mockCreateSession = jest.fn();
const mockSendPromptAsync = jest.fn();
const mockServerClose = jest.fn(async () => {});

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../src/utils/agent-mapping', () => ({
  mapAgentToOpenCode: () => ({ agent: 'chat' }),
}));
jest.mock('../../src/sidecar/interactive-mirror', () => ({
  startInteractiveMirror: () => ({ stop: jest.fn().mockResolvedValue({ usage: null }) }),
}));
jest.mock('../../src/utils/idle-watchdog', () => ({
  IdleWatchdog: class { start() { return this; } touch() {} cancel() {} },
}));
jest.mock('../../src/utils/activity-poller', () => ({
  createActivityPoller: () => ({ stop: jest.fn() }),
  killIfAlive: jest.fn(),
}));
jest.mock('../../src/sidecar/interactive-abort', () => {
  const actual = jest.requireActual('../../src/sidecar/interactive-abort');
  return { ...actual, startAbortWatch: () => ({ stop: jest.fn(), wasAborted: () => false }) };
});
jest.mock('../../src/sidecar/electron-ensure', () => ({
  ensureElectron: jest.fn().mockResolvedValue({ ok: true, path: '/fake/electron' }),
}));
jest.mock('../../src/opencode-client', () => ({
  createSession: (...a) => mockCreateSession(...a),
  sendPromptAsync: (...a) => mockSendPromptAsync(...a),
  getMessages: jest.fn().mockResolvedValue([]),
  getSessionStatus: jest.fn().mockResolvedValue({}),
  abortSession: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../src/sidecar/session-utils', () => ({
  startOpenCodeServer: jest.fn().mockResolvedValue({
    client: {},
    server: { url: 'http://127.0.0.1:1', close: (...a) => mockServerClose(...a), outputBudget: 24000 },
  }),
}));
// The Electron child: stdout/stderr emitters plus a clean exit on the next tick
// (the shape tests/sidecar/interactive-progress.test.js uses).
jest.mock('child_process', () => ({
  spawn: jest.fn(() => {
    const handlers = {};
    const proc = {
      pid: 4242,
      kill: jest.fn(),
      stdout: { on: (ev, cb) => { handlers[`stdout:${ev}`] = cb; } },
      stderr: { on: (ev, cb) => { handlers[`stderr:${ev}`] = cb; } },
      on: (ev, cb) => { handlers[ev] = cb; },
    };
    setImmediate(() => { if (handlers.close) { handlers.close(0); } });
    return proc;
  }),
}));

const { runInteractive } = require('../../src/sidecar/interactive');
const { logger } = require('../../src/utils/logger');

const QWEN = 'openrouter/qwen/qwen3.8-max-0902';

describe('#218 PR 4 — what the interactive (GUI) sender records', () => {
  let project;

  beforeEach(() => {
    jest.clearAllMocks();
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-ivar-'));
    mockCreateSession.mockResolvedValue('ses_test');
  });

  afterEach(() => {
    fs.rmSync(project, { recursive: true, force: true });
  });

  it('the level SENT and its verification reach the resolved result (EP-4 / REC-2)', async () => {
    // Named mutants "INTERACTIVEVARIANTDROPPED" (drop the merge into `result`) and
    // "GUIUNVERIFIEDSILENT" (drop the logger.warn).
    mockSendPromptAsync.mockResolvedValue({ data: {}, sentVariant: { variant: 'high', verified: false, waitedMs: 5001 } });
    const result = await runInteractive(QWEN, 'sys', 'hi', 'ivar0001', project, { variant: 'high', agent: 'chat' });
    expect(result.variant).toBe('high');
    expect(result.variantUnverified).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith('Variant sent unverified', expect.objectContaining({
      note: expect.stringContaining(`did not know ${QWEN} within 5001 ms`),
    }));
  });

  it('a verified send carries variant and no variantUnverified', async () => {
    mockSendPromptAsync.mockResolvedValue({ data: {}, sentVariant: { variant: 'low', verified: true, waitedMs: 0 } });
    const result = await runInteractive(QWEN, 'sys', 'hi', 'ivar0002', project, { variant: 'low', agent: 'chat' });
    expect(result.variant).toBe('low');
    expect('variantUnverified' in result).toBe(false);
    expect(logger.warn).not.toHaveBeenCalledWith('Variant sent unverified', expect.anything());
  });

  it("forwards variant and the handle's outputBudget to sendPromptAsync, never reasoning (TM-2)", async () => {
    // Named mutant "GUIBUDGETDROPPED": delete the `promptOptions.outputBudget` line.
    mockSendPromptAsync.mockResolvedValue({ data: {}, sentVariant: { variant: 'high', verified: true, waitedMs: 0 } });
    await runInteractive(QWEN, 'sys', 'hi', 'ivar0003', project, { variant: 'high', agent: 'chat' });
    const opts = mockSendPromptAsync.mock.calls[0][2];
    expect(opts.variant).toBe('high');
    expect(opts.outputBudget).toBe(24000);
    expect(opts).not.toHaveProperty('reasoning');
  });

  it('a refusal becomes "Session setup failed: VARIANT_…" and closes the server (D4)', async () => {
    // Named mutant "GUIREFUSALPREFIX": rethrow from interactive.js's catch — the promise rejects.
    const err = new Error("VARIANT_UNDECLARED: openrouter/moonshotai/kimi-k3 does not declare a 'medium' variant — the engine's catalogue lists low, high, max for it (/config/providers); an undeclared variant is a silent no-op on the wire (probe F3/M7), so nothing was sent. Pick one of the listed levels, or omit --thinking to run at the provider's own default effort");
    err.name = 'VariantRefusedError'; err.code = 'VARIANT_UNDECLARED';
    mockSendPromptAsync.mockRejectedValue(err);
    const result = await runInteractive('openrouter/moonshotai/kimi-k3', 'sys', 'hi', 'ivar0004', project, { variant: 'medium', agent: 'chat' });
    expect(result.error.startsWith('Session setup failed: VARIANT_UNDECLARED:')).toBe(true);
    expect(mockServerClose).toHaveBeenCalled();
    expect('variant' in result).toBe(false);
  });
});
