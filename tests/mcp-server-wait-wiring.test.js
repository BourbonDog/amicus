'use strict';

/**
 * Phase-5 review fix (Minor #4 / deferred-minor #4) — regression coverage for
 * the shared-server amicus_start settle wiring.
 *
 * Before this fix, settleInProcessRun(taskId) was called in-chain inside the
 * .then (after finalizeHeadlessResult + removeSession) and the .catch (after
 * the error-metadata write). If either handler body threw (e.g. removeSession),
 * settle was skipped: a pending amicus_wait would leak its waiter and the
 * throw would become an unhandled rejection.
 *
 * The fix moves both settle calls into a single .finally() appended to the
 * promise chain, so settle ALWAYS fires after the handler bodies — preserving
 * the load-bearing "terminal metadata written before settle" ordering that
 * amicus_wait's in-process fast path depends on.
 *
 * These tests drive the REAL amicus_start handler through the shared-server
 * path with the same jest.doMock/jest.isolateModulesAsync seams used
 * elsewhere in tests/mcp-server.test.js (child_process, fs) plus the
 * lazily-required in-handler seams (./sidecar/session-utils,
 * ./opencode-client, ./sidecar/context-builder, ./prompt-builder,
 * ./headless).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// amicus_start routes the model through resolveRouteForLaunch (#61 Task 6.2).
// These tests use a synthetic 'google/gemini-test' model purely to exercise
// the settle-wiring behavior below, not real routing — default-mock a
// deterministic passthrough so it doesn't depend on real keys/catalog state
// (mirrors the same default mock in tests/mcp-server.test.js).
jest.mock('../src/utils/route-launch', () => ({
  resolveRouteForLaunch: jest.fn(async ({ model }) => ({
    kind: 'resolved',
    gateway: typeof model === 'string' && model.startsWith('openrouter/') ? 'openrouter' : 'direct',
    executableId: model,
    provenance: {},
  })),
}));

function mockCommonSeams({ runHeadlessImpl }) {
  // Shared server startup: avoid spawning a real OpenCode Go process.
  jest.doMock('../src/sidecar/session-utils', () => ({
    ...jest.requireActual('../src/sidecar/session-utils'),
    startOpenCodeServer: jest.fn(async () => ({
      server: { url: 'http://127.0.0.1:0', goPid: null, close: jest.fn() },
      client: {},
    })),
  }));
  jest.doMock('../src/opencode-client', () => ({
    ...jest.requireActual('../src/opencode-client'),
    createSession: jest.fn(async () => 'opencode-session-1'),
  }));
  jest.doMock('../src/sidecar/context-builder', () => ({
    ...jest.requireActual('../src/sidecar/context-builder'),
    buildContext: jest.fn(() => null),
  }));
  jest.doMock('../src/prompt-builder', () => ({
    ...jest.requireActual('../src/prompt-builder'),
    buildPrompts: jest.fn(() => ({ system: 'sys', userMessage: 'user' })),
  }));
  jest.doMock('../src/headless', () => ({
    ...jest.requireActual('../src/headless'),
    // runHeadless(model, systemPrompt, userMessage, taskId, project, timeoutMs, agent, options)
    runHeadless: jest.fn((...args) => runHeadlessImpl(args[3], ...args)),
  }));
}

function readMeta(sessionDir) {
  return JSON.parse(fs.readFileSync(path.join(sessionDir, 'metadata.json'), 'utf-8'));
}

async function drain(times = 6) {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

describe('shared-server amicus_start settle wiring (Minor #4)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-wait-wiring-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    jest.resetModules();
  });

  test('success path: registerInProcessRun happens before runHeadless, and the waiter settles after terminal metadata is written', async () => {
    let registeredBeforeRunHeadless = null;
    let capturedTaskId = null;
    let metaStatusWhenRunHeadlessResolved = null;

    await jest.isolateModulesAsync(async () => {
      mockCommonSeams({
        runHeadlessImpl: async (taskId) => {
          // (a) registerInProcessRun must have already been called by the
          // time runHeadless is invoked.
          const { hasInProcessRun } = require('../src/mcp-wait');
          registeredBeforeRunHeadless = hasInProcessRun(taskId);
          return { completed: true, summary: 'all done' };
        },
      });

      const { handlers } = require('../src/mcp-server');
      const mcpWait = require('../src/mcp-wait');

      const startResult = await handlers.amicus_start(
        { prompt: 'test prompt', noUi: true, model: 'google/gemini-test' }, tmpDir);
      const { taskId } = JSON.parse(startResult.content[0].text);
      capturedTaskId = taskId;
      const sessionDir = path.join(tmpDir, '.claude', 'amicus_sessions', taskId);

      // (b) settle-order probe: the waiter must still be registered (settle
      // not yet fired) immediately after runHeadless resolves and BEFORE the
      // .then body's terminal metadata write is guaranteed to have happened —
      // then, once the whole chain (including .finally) has drained, the
      // waiter must be settled AND the terminal metadata must already be on
      // disk. This proves "terminal metadata written before settle", the
      // ordering amicus_wait's in-process fast path depends on.
      expect(mcpWait.hasInProcessRun(taskId)).toBe(true); // not settled yet — chain hasn't run

      await drain();

      try { metaStatusWhenRunHeadlessResolved = readMeta(sessionDir).status; } catch { /* ignore */ }
      expect(registeredBeforeRunHeadless).toBe(true);
      expect(metaStatusWhenRunHeadlessResolved).toBe('complete');
      expect(mcpWait.hasInProcessRun(taskId)).toBe(false); // settled after chain drains
    });
    expect(capturedTaskId).not.toBeNull();
  });

  test('failure path: the waiter settles after error metadata is written, even when the run rejects', async () => {
    await jest.isolateModulesAsync(async () => {
      mockCommonSeams({
        runHeadlessImpl: async () => { throw new Error('boom: run failed'); },
      });

      const { handlers } = require('../src/mcp-server');
      const mcpWait = require('../src/mcp-wait');

      const startResult = await handlers.amicus_start(
        { prompt: 'test prompt', noUi: true, model: 'google/gemini-test' }, tmpDir);
      const { taskId } = JSON.parse(startResult.content[0].text);
      const sessionDir = path.join(tmpDir, '.claude', 'amicus_sessions', taskId);

      expect(mcpWait.hasInProcessRun(taskId)).toBe(true); // registered, not yet settled

      await drain();

      const meta = readMeta(sessionDir);
      expect(meta.status).toBe('error');
      expect(meta.reason).toContain('boom: run failed');
      expect(mcpWait.hasInProcessRun(taskId)).toBe(false); // settled after error metadata written
    });
  });

  test('failure path: settle still fires (via .finally) even if a handler-body step (removeSession) throws', async () => {
    await jest.isolateModulesAsync(async () => {
      mockCommonSeams({
        runHeadlessImpl: async () => ({ completed: true, summary: 'all done' }),
      });

      const { handlers } = require('../src/mcp-server');
      const mcpWait = require('../src/mcp-wait');

      // Force removeSession (called inside the .then body, on the success
      // path, before settle used to be called in-chain) to throw — the exact
      // regression scenario the review flagged. Two defects, both fixed by
      // 15a.1: (1) settle is wired via .finally (a separate chain step), so it
      // fires regardless of what the .then/.catch bodies did — no leaked
      // waiter. (2) the .then body's removeSession call is now itself guarded
      // (try/catch): a throw there is logged and swallowed IN PLACE rather
      // than rejecting the .then and falling into .catch, which used to
      // unconditionally overwrite the already-committed 'complete' metadata
      // with 'error' (a real bug — a committed success got clobbered by a
      // cleanup-step failure). Spy on the prototype method; mcp-server.js
      // calls it on the shared `sharedServer` singleton instance, which
      // resolves the mocked prototype method via normal prototype dispatch.
      const { SharedServerManager } = require('../src/utils/shared-server');
      let removeSessionCalls = 0;
      const removeSpy = jest.spyOn(SharedServerManager.prototype, 'removeSession')
        .mockImplementation(() => {
          removeSessionCalls += 1;
          throw new Error('removeSession exploded');
        });

      try {
        const startResult = await handlers.amicus_start(
          { prompt: 'test prompt', noUi: true, model: 'google/gemini-test' }, tmpDir);
        const { taskId } = JSON.parse(startResult.content[0].text);
        const sessionDir = path.join(tmpDir, '.claude', 'amicus_sessions', taskId);

        await drain();
        await new Promise((resolve) => setTimeout(resolve, 10));

        // Core assertion: even though removeSession threw INSIDE the .then
        // body, .finally still ran and settled the waiter — no leaked waiter.
        expect(mcpWait.hasInProcessRun(taskId)).toBe(false);

        // The .then's guard swallows the throw in place — the .then never
        // rejects, so .catch's (separate) removeSession call never runs.
        expect(removeSessionCalls).toBe(1);

        // Fixed behavior (15a.1): the already-committed 'complete' status
        // from finalizeHeadlessResult survives the removeSession throw —
        // no clobber to 'error'.
        expect(readMeta(sessionDir).status).toBe('complete');
      } finally {
        removeSpy.mockRestore();
      }
    });
  });

  // 15a.1 defect (a): a throw inside .catch's OWN removeSession call (this
  // time for a genuine pre-terminal failure — runHeadless itself rejected,
  // so .catch is legitimately reached) must not escape as an unhandled
  // rejection. Distinct from the .then-body guard above: this exercises the
  // SECOND removeSession call site, inside .catch.
  test('failure path: a removeSession throw INSIDE .catch (genuine run failure) does not escape and still settles', async () => {
    await jest.isolateModulesAsync(async () => {
      mockCommonSeams({
        runHeadlessImpl: async () => { throw new Error('boom: run failed'); },
      });

      const { handlers } = require('../src/mcp-server');
      const mcpWait = require('../src/mcp-wait');
      const { SharedServerManager } = require('../src/utils/shared-server');
      const removeSpy = jest.spyOn(SharedServerManager.prototype, 'removeSession')
        .mockImplementation(() => { throw new Error('removeSession exploded in catch'); });

      const unhandled = [];
      const onUnhandled = (reason) => unhandled.push(reason);
      process.on('unhandledRejection', onUnhandled);

      try {
        const startResult = await handlers.amicus_start(
          { prompt: 'test prompt', noUi: true, model: 'google/gemini-test' }, tmpDir);
        const { taskId } = JSON.parse(startResult.content[0].text);
        const sessionDir = path.join(tmpDir, '.claude', 'amicus_sessions', taskId);

        await drain();
        await new Promise((resolve) => setTimeout(resolve, 10));

        // The genuine run failure still gets recorded as 'error' — the
        // pre-terminal-failure path is unchanged by this fix.
        const meta = readMeta(sessionDir);
        expect(meta.status).toBe('error');
        expect(meta.reason).toContain('boom: run failed');
        expect(mcpWait.hasInProcessRun(taskId)).toBe(false); // settle still fires
        expect(unhandled).toHaveLength(0); // the removeSession throw never escaped
      } finally {
        process.removeListener('unhandledRejection', onUnhandled);
        removeSpy.mockRestore();
      }
    });
  });

  // 15a.1 defect (b), general form: ANY terminal status finalizeHeadlessResult
  // can commit (not just 'complete') must survive a later in-chain throw —
  // proves the guard is a status check, not a removeSession special-case.
  test('failure path: a committed "aborted" status survives a later removeSession throw', async () => {
    await jest.isolateModulesAsync(async () => {
      mockCommonSeams({
        runHeadlessImpl: async () => ({ completed: false, aborted: true, summary: 'partial' }),
      });

      const { handlers } = require('../src/mcp-server');
      const { SharedServerManager } = require('../src/utils/shared-server');
      const removeSpy = jest.spyOn(SharedServerManager.prototype, 'removeSession')
        .mockImplementation(() => { throw new Error('removeSession exploded'); });

      try {
        const startResult = await handlers.amicus_start(
          { prompt: 'test prompt', noUi: true, model: 'google/gemini-test' }, tmpDir);
        const { taskId } = JSON.parse(startResult.content[0].text);
        const sessionDir = path.join(tmpDir, '.claude', 'amicus_sessions', taskId);

        await drain();
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(readMeta(sessionDir).status).toBe('aborted'); // not clobbered to 'error'
      } finally {
        removeSpy.mockRestore();
      }
    });
  });
});
