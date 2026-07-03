/**
 * Issue #47 — shared-server MCP sessions must be scoped to the project directory.
 *
 * The shared OpenCode server is shared across projects, so a session is only
 * found by a `?directory=` query. A directory-scoped CREATE with UN-scoped
 * follow-up calls reproduces the identical "session not found in project" bug
 * class. These tests prove that EVERY per-session SDK call on the shared-server
 * path (createSession + sendPromptAsync + getMessages + getSessionStatus +
 * abortSession) is scoped to the SAME resolved project directory.
 *
 * runHeadless is the function that carries the per-session follow-up calls on
 * the shared-server path (mcp-server.js fires it with the shared client/server),
 * so we drive it directly with options.directory and assert the threading.
 */

const fs = require('fs');

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  appendFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  unlinkSync: jest.fn(),
  readFileSync: jest.fn(),
}));

const mockCreateSession = jest.fn();
const mockSendPromptAsync = jest.fn();
const mockGetMessages = jest.fn();
const mockCheckHealth = jest.fn();
const mockStartServer = jest.fn();
const mockServerClose = jest.fn();
const mockAbortSession = jest.fn();
const mockGetSessionStatus = jest.fn();

jest.mock('../src/opencode-client', () => ({
  createSession: mockCreateSession,
  sendPrompt: mockSendPromptAsync,
  sendPromptAsync: mockSendPromptAsync,
  getMessages: mockGetMessages,
  checkHealth: mockCheckHealth,
  startServer: mockStartServer,
  abortSession: mockAbortSession,
  getSessionStatus: mockGetSessionStatus,
}));

jest.mock('../src/utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const { runHeadless } = require('../src/headless');
const { buildFoldMarker } = require('../src/utils/fold-marker');

describe('shared-server runHeadless scopes every per-session call to the directory (#47)', () => {
  const PROJECT = '/canonical/project/dir';
  const model = 'openrouter/google/gemini-2.5-flash';
  const systemPrompt = '# sys';
  const userMessage = 'do the thing';
  const taskId = 'scope47';
  // 15b.3: these tests only care about directory-scoping, not fold-marker
  // semantics — but completion now requires a matching nonce, so every
  // fixture that used to complete on the bare marker needs one.
  const NONCE = 'scope47nonce0001';
  const NONCED_MARKER = buildFoldMarker(NONCE);

  let mockClient;
  let mockServer;

  beforeEach(() => {
    jest.clearAllMocks();
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('{}');
    mockGetSessionStatus.mockResolvedValue({ type: 'busy' });
    mockClient = { session: {}, config: {} };
    mockServer = { url: 'http://127.0.0.1:4440', close: mockServerClose };
    mockStartServer.mockResolvedValue({ client: mockClient, server: mockServer });
    mockCheckHealth.mockResolvedValue(true);
  });

  test('createSession is scoped to the project directory (shared-server, no preexisting sessionId)', async () => {
    mockCreateSession.mockResolvedValue('sess-1');
    mockSendPromptAsync.mockResolvedValue(undefined);
    mockGetMessages.mockResolvedValue([{
      info: { role: 'assistant', id: 'm1', time: { completed: Date.now() } },
      parts: [{ id: 'p1', type: 'text', text: `done\n${NONCED_MARKER}` }],
    }]);

    // Shared-server mode: caller passes client+server. Directory must thread through.
    await runHeadless(model, systemPrompt, userMessage, taskId, PROJECT, 5000, 'build', {
      client: mockClient, server: mockServer, directory: PROJECT, nonce: NONCE,
    });

    // A scoped create is required so the shared server files the session under
    // the right project. An UNSCOPED create reproduces the #47 failure.
    expect(mockCreateSession).toHaveBeenCalledWith(mockClient, PROJECT);
  });

  test('sendPromptAsync carries the directory', async () => {
    mockCreateSession.mockResolvedValue('sess-1');
    mockSendPromptAsync.mockResolvedValue(undefined);
    mockGetMessages.mockResolvedValue([{
      info: { role: 'assistant', id: 'm1', time: { completed: Date.now() } },
      parts: [{ id: 'p1', type: 'text', text: `done\n${NONCED_MARKER}` }],
    }]);

    await runHeadless(model, systemPrompt, userMessage, taskId, PROJECT, 5000, 'build', {
      client: mockClient, server: mockServer, directory: PROJECT, nonce: NONCE,
    });

    expect(mockSendPromptAsync).toHaveBeenCalledWith(
      mockClient, 'sess-1',
      expect.objectContaining({ directory: PROJECT }),
    );
  });

  test('getMessages is scoped to the directory (un-scoped poll reproduces #47)', async () => {
    mockCreateSession.mockResolvedValue('sess-1');
    mockSendPromptAsync.mockResolvedValue(undefined);
    mockGetMessages.mockResolvedValue([{
      info: { role: 'assistant', id: 'm1', time: { completed: Date.now() } },
      parts: [{ id: 'p1', type: 'text', text: `done\n${NONCED_MARKER}` }],
    }]);

    await runHeadless(model, systemPrompt, userMessage, taskId, PROJECT, 5000, 'build', {
      client: mockClient, server: mockServer, directory: PROJECT, nonce: NONCE,
    });

    expect(mockGetMessages).toHaveBeenCalledWith(mockClient, 'sess-1', PROJECT);
  });

  test('getSessionStatus is scoped to the directory', async () => {
    mockCreateSession.mockResolvedValue('sess-1');
    mockSendPromptAsync.mockResolvedValue(undefined);
    // Output present so the status probe runs, then idle ends the run.
    mockGetSessionStatus.mockResolvedValue({ type: 'idle' });
    mockGetMessages.mockResolvedValue([{
      info: { role: 'assistant', id: 'm1', time: {} },
      parts: [{ id: 'p1', type: 'text', text: 'streaming output, no marker' }],
    }]);

    await runHeadless(model, systemPrompt, userMessage, taskId, PROJECT, 30000, 'build', {
      client: mockClient, server: mockServer, directory: PROJECT,
      pollIntervalMs: 5,
    });

    expect(mockGetSessionStatus).toHaveBeenCalledWith(mockClient, 'sess-1', PROJECT);
  });

  test('abortSession on timeout is scoped to the directory', async () => {
    // Driven with fake timers so the timeout fires deterministically regardless of
    // CI runner speed — a real-elapsed-time deadline flakes on starved runners
    // (the established headless.test.js "dies at --timeout" pattern).
    jest.useFakeTimers();
    try {
      mockCreateSession.mockResolvedValue('sess-1');
      mockSendPromptAsync.mockResolvedValue(undefined);
      // Output GROWS every poll so the idle-completion heuristic never fires — a
      // model that's genuinely still streaming never goes idle. That leaves the
      // timeout deadline as the only exit, which is the abort path under test.
      // (A constant message would let the ~30-stable-poll idle break end the run
      // BEFORE the 200ms deadline, so the timeout-abort never ran — that race is
      // exactly what flaked on CI.)
      let chunk = 0;
      mockGetMessages.mockImplementation(() => Promise.resolve([{
        info: { role: 'assistant', id: 'm1', time: {} },
        parts: [{ id: 'p1', type: 'text', text: 'still working' + '.'.repeat(++chunk) }],
      }]));
      mockGetSessionStatus.mockResolvedValue({ type: 'busy' });
      mockAbortSession.mockResolvedValue(undefined);

      const p = runHeadless(model, systemPrompt, userMessage, taskId, PROJECT, 200, 'build', {
        client: mockClient, server: mockServer, directory: PROJECT,
        pollIntervalMs: 5,
      });
      // Advance the fake clock past the 200ms deadline; the async variant flushes
      // microtasks between timer fires so the poll loop reaches the timeout-abort path.
      await jest.advanceTimersByTimeAsync(2000);
      await p;

      expect(mockAbortSession).toHaveBeenCalledWith(mockClient, 'sess-1', PROJECT);
    } finally {
      jest.useRealTimers();
    }
  });

  test('a preexisting (already-scoped) sessionId still polls scoped to the directory', async () => {
    // When mcp-server.js created the session scoped and passes sessionId in,
    // runHeadless must NOT re-create, but its follow-up polls must STILL be
    // scoped — a scoped create with unscoped follow-ups reproduces #47.
    mockSendPromptAsync.mockResolvedValue(undefined);
    mockGetMessages.mockResolvedValue([{
      info: { role: 'assistant', id: 'm1', time: { completed: Date.now() } },
      parts: [{ id: 'p1', type: 'text', text: `done\n${NONCED_MARKER}` }],
    }]);

    await runHeadless(model, systemPrompt, userMessage, taskId, PROJECT, 5000, 'build', {
      client: mockClient, server: mockServer, directory: PROJECT, sessionId: 'pre-made', nonce: NONCE,
    });

    expect(mockCreateSession).not.toHaveBeenCalled();
    expect(mockGetMessages).toHaveBeenCalledWith(mockClient, 'pre-made', PROJECT);
    expect(mockSendPromptAsync).toHaveBeenCalledWith(
      mockClient, 'pre-made',
      expect.objectContaining({ directory: PROJECT }),
    );
  });
});

describe('mcp-server shared-server path scopes createSession to the resolved project (#47)', () => {
  // Source-level guard: the shared-server start branch must pass the resolved
  // project dir into createSession (NOT a bare createSession(client)).
  const path = require('path');
  const realFs = jest.requireActual('fs');
  const src = realFs.readFileSync(
    path.join(__dirname, '../src/mcp-server.js'), 'utf-8'
  );

  test('createSession on the shared-server path receives the project directory', () => {
    // The bare, unscoped form must be gone from the shared-server branch.
    expect(src).not.toContain('createSession(client)');
    // It must be scoped to the resolved project dir (cwd in this handler).
    expect(src).toMatch(/createSession\(client,\s*cwd\)/);
  });

  test('runHeadless is invoked with a directory option scoped to the project', () => {
    expect(src).toMatch(/directory:\s*cwd/);
  });
});
