/**
 * Tests for OpenCode SDK Client Wrapper
 *
 * Tests the SDK wrapper module that provides a clean interface
 * for interacting with the @opencode-ai/sdk.
 */

// Mock the SDK before requiring the module
const mockCreateOpencodeClient = jest.fn();
const mockCreateOpencodeServer = jest.fn();

// Mock the SDK module (used for require and dynamic import)
jest.mock('@opencode-ai/sdk', () => ({
  createOpencodeClient: mockCreateOpencodeClient,
  createOpencodeServer: mockCreateOpencodeServer,
  __esModule: true,
  default: {
    createOpencodeClient: mockCreateOpencodeClient,
    createOpencodeServer: mockCreateOpencodeServer
  }
}), { virtual: true });

// v4.9 W10 Task B (#133 piece 3): createSession pushes the server-reported
// `Session.version` — and the client it came from — into the skew detector.
// Mocked here so THIS suite pins the WIRING only (that neither is discarded any
// more, and that the detector can never break session creation); the
// comparison, the per-server record, the announcement and the rendered strings
// are pinned in tests/utils/engine-skew.test.js against injected seams.
const mockNoteSessionVersion = jest.fn();
jest.mock('../src/utils/engine-skew', () => ({
  noteSessionVersion: (...args) => mockNoteSessionVersion(...args),
}));

// Import after mock is set up
const {
  parseModelString,
  createClient,
  sendPrompt,
  createSession,
  getMessages,
  checkHealth,
  buildServerOptions
} = require('../src/opencode-client');

describe('OpenCode Client Wrapper', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Setup default mock for createOpencodeClient
    mockCreateOpencodeClient.mockReturnValue({
      session: {
        create: jest.fn(),
        prompt: jest.fn(),
        messages: jest.fn()
      },
      config: {
        get: jest.fn()
      }
    });
  });

  describe('parseModelString', () => {
    it('should parse openrouter model string with nested path', () => {
      const result = parseModelString('openrouter/google/gemini-2.5-flash');
      expect(result).toEqual({
        providerID: 'openrouter',
        modelID: 'google/gemini-2.5-flash'
      });
    });

    it('should parse simple provider/model format', () => {
      const result = parseModelString('anthropic/claude-3-5-sonnet');
      expect(result).toEqual({
        providerID: 'anthropic',
        modelID: 'claude-3-5-sonnet'
      });
    });

    it('should default to openrouter provider for model-only string', () => {
      const result = parseModelString('gemini-2.5-flash');
      expect(result).toEqual({
        providerID: 'openrouter',
        modelID: 'gemini-2.5-flash'
      });
    });

    it('should handle deeply nested model paths', () => {
      const result = parseModelString('openrouter/google/gemini-2.5-flash-preview-05-20');
      expect(result).toEqual({
        providerID: 'openrouter',
        modelID: 'google/gemini-2.5-flash-preview-05-20'
      });
    });

    it('should return object unchanged if already in SDK format', () => {
      const input = { providerID: 'anthropic', modelID: 'claude-3-5-sonnet' };
      const result = parseModelString(input);
      expect(result).toEqual(input);
    });

    it('should handle empty string gracefully', () => {
      const result = parseModelString('');
      expect(result).toEqual({
        providerID: 'openrouter',
        modelID: ''
      });
    });

    it('throws a descriptive error for an empty object (L5)', () => {
      // A bare {} would otherwise reach the SDK and return an opaque 400.
      expect(() => parseModelString({})).toThrow(/Invalid model object/);
      expect(() => parseModelString({})).toThrow(/providerID, modelID/);
    });

    it('throws when the object is missing providerID or modelID (L5)', () => {
      expect(() => parseModelString({ providerID: 'openrouter' })).toThrow(/Invalid model object/);
      expect(() => parseModelString({ modelID: 'gemini' })).toThrow(/Invalid model object/);
      expect(() => parseModelString({ providerID: 1, modelID: 2 })).toThrow(/Invalid model object/);
    });
  });

  describe('createClient', () => {
    // Note: These tests are skipped because Jest cannot mock dynamic import()
    // calls without --experimental-vm-modules. The createClient function is
    // tested indirectly through integration tests and the startServer tests.
    it.skip('should create a client with the specified base URL', async () => {
      const client = await createClient('http://127.0.0.1:14440');
      expect(client).toBeDefined();
      expect(client.session).toBeDefined();
    });

    it.skip('should create a client with default URL if not specified', async () => {
      const client = await createClient();
      expect(client).toBeDefined();
    });
  });

  describe('createSession', () => {
    it('should create a session and return session ID', async () => {
      // Mock the SDK client
      const mockClient = {
        session: {
          create: jest.fn().mockResolvedValue({
            data: { id: 'test-session-123' }
          })
        }
      };

      const sessionId = await createSession(mockClient);
      expect(sessionId).toBe('test-session-123');
      expect(mockClient.session.create).toHaveBeenCalled();
    });

    it('should throw if session creation fails', async () => {
      const mockClient = {
        session: {
          create: jest.fn().mockResolvedValue({
            error: { message: 'Failed to create session' }
          })
        }
      };

      await expect(createSession(mockClient)).rejects.toThrow('Failed to create session');
    });

    it('should handle nested session ID in response', async () => {
      const mockClient = {
        session: {
          create: jest.fn().mockResolvedValue({
            data: { session: { id: 'nested-session-456' } }
          })
        }
      };

      const sessionId = await createSession(mockClient);
      expect(sessionId).toBe('nested-session-456');
    });
  });

  /**
   * v4.9 W10 Task B (#133 piece 3) — the response's `version` stops being
   * discarded.
   *
   * MEASURED 2026-08-25 against a real locally spawned engine (not read off the
   * SDK's .d.ts): `client.session.create({})` answers with
   * `data = {directory,id,projectID,slug,time,title,version}` and `version` was
   * `"1.2.20"`, exactly this checkout's `node_modules/opencode-ai` version — so
   * `Session.version` is the ENGINE's version and comparing it against the
   * installed engine is meaningful. Same run: `data.id` began with `ses_` and
   * there was no nested `data.session`.
   *
   * The return type stays a plain string on purpose. Measured: all three
   * production callers — `headless.js`, `mcp-server.js`,
   * `sidecar/interactive.js` — do `sessionId = await createSession(client, …)`
   * and use the result as a string, so an object return would have been a
   * three-file breaking change to carry one diagnostic field. The version goes
   * out through the module that owns the comparison instead.
   */
  describe('createSession captures the engine version (#133 piece 3)', () => {
    it('forwards the server-reported version to the skew detector', async () => {
      const mockClient = {
        session: {
          create: jest.fn().mockResolvedValue({ data: { id: 'ses_abc', version: '1.17.3' } })
        }
      };

      const sessionId = await createSession(mockClient);

      expect(sessionId).toBe('ses_abc');
      expect(typeof sessionId).toBe('string'); // the return shape is unchanged
      expect(mockNoteSessionVersion).toHaveBeenCalledTimes(1);
      expect(mockNoteSessionVersion).toHaveBeenCalledWith('1.17.3', { client: mockClient });
    });

    /**
     * W10 round-1 review A3: the observation is only meaningful attached to the
     * server that made it, so the CLIENT rides along and the detector derives
     * the identity (its `serverKeyForClient`, pinned in
     * tests/utils/engine-skew.test.js against the measured SDK shape). Deriving
     * it here instead would put a second reader of the SDK's internals in the
     * client wrapper, and a second place to keep true.
     */
    it('forwards the CLIENT too, so the record is attributable to one server', async () => {
      const mockClient = {
        _client: { getConfig: () => ({ baseUrl: 'http://127.0.0.1:4096' }) },
        session: {
          create: jest.fn().mockResolvedValue({ data: { id: 'ses_keyed', version: '1.17.3' } })
        }
      };

      await createSession(mockClient);

      const [, deps] = mockNoteSessionVersion.mock.calls[0];
      expect(deps.client).toBe(mockClient); // the same object, not a copy or a derived string
    });

    it('reads the version off a nested session object too', async () => {
      const mockClient = {
        session: {
          create: jest.fn().mockResolvedValue({
            data: { session: { id: 'ses_nested', version: '0.9.0' } }
          })
        }
      };

      await createSession(mockClient);
      expect(mockNoteSessionVersion).toHaveBeenCalledWith('0.9.0', { client: mockClient });
    });

    it('an older server that reports no version is forwarded as undefined, not skipped', async () => {
      // The detector owns "no version means stay silent" — see
      // tests/utils/engine-skew.test.js. Keeping the call unconditional means
      // that rule lives in exactly one place.
      const mockClient = {
        session: { create: jest.fn().mockResolvedValue({ data: { id: 'ses_old' } }) }
      };

      const sessionId = await createSession(mockClient);
      expect(sessionId).toBe('ses_old');
      expect(mockNoteSessionVersion).toHaveBeenCalledWith(undefined, { client: mockClient });
    });

    it('a detector that throws cannot break session creation', async () => {
      mockNoteSessionVersion.mockImplementationOnce(() => { throw new Error('skew module is broken'); });
      const mockClient = {
        session: {
          create: jest.fn().mockResolvedValue({ data: { id: 'ses_survives', version: '1.17.3' } })
        }
      };

      await expect(createSession(mockClient)).resolves.toBe('ses_survives');
    });

    it('a failed create never reaches the detector', async () => {
      const mockClient = {
        session: { create: jest.fn().mockResolvedValue({ error: { message: 'nope' } }) }
      };

      await expect(createSession(mockClient)).rejects.toThrow('nope');
      expect(mockNoteSessionVersion).not.toHaveBeenCalled();
    });
  });

  describe('sendPrompt', () => {
    it('should send prompt with model specification', async () => {
      const mockClient = {
        session: {
          promptAsync: jest.fn().mockResolvedValue({
            data: {
              parts: [{ type: 'text', text: 'Response text' }]
            }
          })
        }
      };

      const result = await sendPrompt(mockClient, 'session-123', {
        model: 'openrouter/google/gemini-2.5-flash',
        parts: [{ type: 'text', text: 'Hello' }]
      });

      expect(mockClient.session.promptAsync).toHaveBeenCalledWith({
        path: { id: 'session-123' },
        body: expect.objectContaining({
          model: { providerID: 'openrouter', modelID: 'google/gemini-2.5-flash' },
          parts: [{ type: 'text', text: 'Hello' }]
        })
      });
      expect(result.data.parts[0].text).toBe('Response text');
    });

    it('should include system prompt when provided', async () => {
      const mockClient = {
        session: {
          promptAsync: jest.fn().mockResolvedValue({
            data: { parts: [] }
          })
        }
      };

      await sendPrompt(mockClient, 'session-123', {
        model: 'anthropic/claude-3-5-sonnet',
        system: 'You are a helpful assistant',
        parts: [{ type: 'text', text: 'Hello' }]
      });

      expect(mockClient.session.promptAsync).toHaveBeenCalledWith({
        path: { id: 'session-123' },
        body: expect.objectContaining({
          system: 'You are a helpful assistant'
        })
      });
    });

    it('should include agent when provided', async () => {
      const mockClient = {
        session: {
          promptAsync: jest.fn().mockResolvedValue({
            data: { parts: [] }
          })
        }
      };

      await sendPrompt(mockClient, 'session-123', {
        model: 'anthropic/claude-3-5-sonnet',
        parts: [{ type: 'text', text: 'Hello' }],
        agent: 'build'
      });

      expect(mockClient.session.promptAsync).toHaveBeenCalledWith({
        path: { id: 'session-123' },
        body: expect.objectContaining({
          agent: 'build'
        })
      });
    });

    it('should include tools config when provided', async () => {
      const mockClient = {
        session: {
          promptAsync: jest.fn().mockResolvedValue({
            data: { parts: [] }
          })
        }
      };

      await sendPrompt(mockClient, 'session-123', {
        model: 'anthropic/claude-3-5-sonnet',
        parts: [{ type: 'text', text: 'Hello' }],
        tools: { Bash: true, Edit: false }
      });

      expect(mockClient.session.promptAsync).toHaveBeenCalledWith({
        path: { id: 'session-123' },
        body: expect.objectContaining({
          tools: { Bash: true, Edit: false }
        })
      });
    });

    it('should handle model as object (already parsed)', async () => {
      const mockClient = {
        session: {
          promptAsync: jest.fn().mockResolvedValue({
            data: { parts: [] }
          })
        }
      };

      await sendPrompt(mockClient, 'session-123', {
        model: { providerID: 'anthropic', modelID: 'claude-3-5-sonnet' },
        parts: [{ type: 'text', text: 'Hello' }]
      });

      expect(mockClient.session.promptAsync).toHaveBeenCalledWith({
        path: { id: 'session-123' },
        body: expect.objectContaining({
          model: { providerID: 'anthropic', modelID: 'claude-3-5-sonnet' }
        })
      });
    });

    it('should include reasoning parameter when provided', async () => {
      const mockClient = {
        session: {
          promptAsync: jest.fn().mockResolvedValue({
            data: { parts: [] }
          })
        }
      };

      await sendPrompt(mockClient, 'session-123', {
        model: 'openrouter/google/gemini-3-pro-preview',
        parts: [{ type: 'text', text: 'Hello' }],
        reasoning: { effort: 'low' }
      });

      expect(mockClient.session.promptAsync).toHaveBeenCalledWith({
        path: { id: 'session-123' },
        body: expect.objectContaining({
          reasoning: { effort: 'low' }
        })
      });
    });

    it('should support all reasoning effort levels', async () => {
      const mockClient = {
        session: {
          promptAsync: jest.fn().mockResolvedValue({
            data: { parts: [] }
          })
        }
      };

      const effortLevels = ['minimal', 'low', 'medium', 'high', 'xhigh', 'none'];

      for (const effort of effortLevels) {
        await sendPrompt(mockClient, 'session-123', {
          model: 'openrouter/openai/gpt-5.2',
          parts: [{ type: 'text', text: 'Test' }],
          reasoning: { effort }
        });

        expect(mockClient.session.promptAsync).toHaveBeenLastCalledWith({
          path: { id: 'session-123' },
          body: expect.objectContaining({
            reasoning: { effort }
          })
        });
      }
    });

    it('should not include reasoning when not provided', async () => {
      const mockClient = {
        session: {
          promptAsync: jest.fn().mockResolvedValue({
            data: { parts: [] }
          })
        }
      };

      await sendPrompt(mockClient, 'session-123', {
        model: 'openrouter/google/gemini-3-flash-preview',
        parts: [{ type: 'text', text: 'Hello' }]
      });

      const callBody = mockClient.session.promptAsync.mock.calls[0][0].body;
      expect(callBody).not.toHaveProperty('reasoning');
    });

    it('should combine reasoning with other optional parameters', async () => {
      const mockClient = {
        session: {
          promptAsync: jest.fn().mockResolvedValue({
            data: { parts: [] }
          })
        }
      };

      await sendPrompt(mockClient, 'session-123', {
        model: 'openrouter/google/gemini-3-pro-preview',
        parts: [{ type: 'text', text: 'Hello' }],
        system: 'You are a helpful assistant',
        agent: 'build',
        tools: { Bash: true },
        reasoning: { effort: 'high' }
      });

      expect(mockClient.session.promptAsync).toHaveBeenCalledWith({
        path: { id: 'session-123' },
        body: {
          model: { providerID: 'openrouter', modelID: 'google/gemini-3-pro-preview' },
          parts: [{ type: 'text', text: 'Hello' }],
          system: 'You are a helpful assistant',
          agent: 'build',
          tools: { Bash: true },
          reasoning: { effort: 'high' }
        }
      });
    });
  });

  describe('getMessages', () => {
    it('should retrieve messages for a session', async () => {
      const mockClient = {
        session: {
          messages: jest.fn().mockResolvedValue({
            data: [
              { id: 'msg-1', parts: [{ type: 'text', text: 'Hello' }] },
              { id: 'msg-2', parts: [{ type: 'text', text: 'World' }] }
            ]
          })
        }
      };

      const messages = await getMessages(mockClient, 'session-123');
      expect(messages).toHaveLength(2);
      expect(mockClient.session.messages).toHaveBeenCalledWith({
        path: { id: 'session-123' }
      });
    });

    it('should return empty array if no messages', async () => {
      const mockClient = {
        session: {
          messages: jest.fn().mockResolvedValue({
            data: []
          })
        }
      };

      const messages = await getMessages(mockClient, 'session-123');
      expect(messages).toEqual([]);
    });

    it('logs and returns [] when the SDK response has no data array (error branch)', async () => {
      const { logger } = require('../src/utils/logger');
      const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
      const mockClient = {
        session: {
          messages: jest.fn().mockResolvedValue({
            response: { status: 500 },
            error: { message: 'boom' }
            // note: no `data` key
          })
        }
      };

      const messages = await getMessages(mockClient, 'session-err');
      expect(messages).toEqual([]);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      // context should carry the sessionId + surfaced error for diagnostics
      expect(warnSpy.mock.calls[0][1]).toMatchObject({ sessionId: 'session-err' });
      warnSpy.mockRestore();
    });

    it('does NOT log when the session genuinely has zero messages (data: [])', async () => {
      const { logger } = require('../src/utils/logger');
      const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
      const mockClient = {
        session: {
          messages: jest.fn().mockResolvedValue({ data: [] })
        }
      };

      const messages = await getMessages(mockClient, 'session-empty');
      expect(messages).toEqual([]);
      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe('checkHealth', () => {
    it('should return true when server is healthy', async () => {
      const mockClient = {
        global: {
          event: jest.fn().mockResolvedValue({})
        },
        config: {
          get: jest.fn().mockResolvedValue({ data: { version: '1.0' } })
        }
      };

      const isHealthy = await checkHealth(mockClient);
      expect(isHealthy).toBe(true);
    });

    it('should return false when server is not responding', async () => {
      const mockClient = {
        config: {
          get: jest.fn().mockRejectedValue(new Error('Connection refused'))
        }
      };

      const isHealthy = await checkHealth(mockClient);
      expect(isHealthy).toBe(false);
    });
  });

  describe('createChildSession', () => {
    it('should create a child session with parent ID', async () => {
      const mockClient = {
        session: {
          create: jest.fn().mockResolvedValue({
            data: { id: 'child-session-789' }
          })
        }
      };

      const { createChildSession } = require('../src/opencode-client');
      const sessionId = await createChildSession(mockClient, 'parent-session-123');

      expect(sessionId).toBe('child-session-789');
      expect(mockClient.session.create).toHaveBeenCalledWith({
        body: { parentID: 'parent-session-123' }
      });
    });

    it('should throw if child session creation fails', async () => {
      const mockClient = {
        session: {
          create: jest.fn().mockResolvedValue({
            error: { message: 'Failed to create child session' }
          })
        }
      };

      const { createChildSession } = require('../src/opencode-client');
      await expect(createChildSession(mockClient, 'parent-123'))
        .rejects.toThrow('Failed to create child session');
    });
  });

  describe('getChildren', () => {
    it('should get child sessions for a parent', async () => {
      const mockClient = {
        session: {
          children: jest.fn().mockResolvedValue({
            data: [
              { id: 'child-1', parentID: 'parent-123' },
              { id: 'child-2', parentID: 'parent-123' }
            ]
          })
        }
      };

      const { getChildren } = require('../src/opencode-client');
      const children = await getChildren(mockClient, 'parent-123');

      expect(children).toHaveLength(2);
      expect(mockClient.session.children).toHaveBeenCalledWith({
        path: { id: 'parent-123' }
      });
    });

    it('should return empty array if no children', async () => {
      const mockClient = {
        session: {
          children: jest.fn().mockResolvedValue({
            data: []
          })
        }
      };

      const { getChildren } = require('../src/opencode-client');
      const children = await getChildren(mockClient, 'parent-123');

      expect(children).toEqual([]);
    });
  });

  describe('listSessions', () => {
    it('should list all sessions', async () => {
      const mockClient = {
        session: {
          list: jest.fn().mockResolvedValue({
            data: [
              { id: 'ses_abc123', title: 'Session 1' },
              { id: 'ses_def456', title: 'Session 2' }
            ]
          })
        }
      };

      const { listSessions } = require('../src/opencode-client');
      const sessions = await listSessions(mockClient);

      expect(sessions).toHaveLength(2);
      expect(sessions[0].id).toBe('ses_abc123');
      expect(mockClient.session.list).toHaveBeenCalled();
    });

    it('should return empty array if no sessions', async () => {
      const mockClient = {
        session: {
          list: jest.fn().mockResolvedValue({ data: [] })
        }
      };

      const { listSessions } = require('../src/opencode-client');
      const sessions = await listSessions(mockClient);

      expect(sessions).toEqual([]);
    });

    it('should return empty array on error', async () => {
      const mockClient = {
        session: {
          list: jest.fn().mockRejectedValue(new Error('Connection error'))
        }
      };

      const { listSessions } = require('../src/opencode-client');
      const sessions = await listSessions(mockClient);

      expect(sessions).toEqual([]);
    });
  });

  describe('sendPromptAsync alias', () => {
    it('should be the same function as sendPrompt', () => {
      const { sendPrompt, sendPromptAsync } = require('../src/opencode-client');
      expect(sendPromptAsync).toBe(sendPrompt);
    });
  });

  describe('getSessionStatus', () => {
    it('should get session status', async () => {
      const mockClient = {
        session: {
          status: jest.fn().mockResolvedValue({
            data: { status: 'completed', id: 'session-123' }
          })
        }
      };

      const { getSessionStatus } = require('../src/opencode-client');
      const status = await getSessionStatus(mockClient, 'session-123');

      expect(status).toEqual({ status: 'completed', id: 'session-123' });
      expect(mockClient.session.status).toHaveBeenCalledWith({
        path: { id: 'session-123' }
      });
    });
  });

  describe('directory threading (#48)', () => {
    // The optional `directory` param defaults to undefined. When no caller
    // passes it, every session call MUST be byte-for-byte identical to today —
    // NO `query` key may appear in the args object (adding `query: {}` or
    // `query: { directory: undefined }` would change the wire shape).
    // When a caller DOES pass directory, it must surface as `query.directory`.

    describe('createSession', () => {
      const makeClient = () => ({
        session: {
          create: jest.fn().mockResolvedValue({ data: { id: 's1' } })
        }
      });

      it('omits query entirely when no directory is passed (no-op)', async () => {
        const client = makeClient();
        const { createSession } = require('../src/opencode-client');
        await createSession(client);
        // Identical to the pre-#48 shape: create({}) with no query.
        expect(client.session.create).toHaveBeenCalledWith({});
        expect(client.session.create.mock.calls[0][0]).not.toHaveProperty('query');
      });

      it('includes query.directory when a directory is passed', async () => {
        const client = makeClient();
        const { createSession } = require('../src/opencode-client');
        await createSession(client, '/proj/dir');
        expect(client.session.create).toHaveBeenCalledWith({
          query: { directory: '/proj/dir' }
        });
      });
    });

    describe('sendPrompt', () => {
      const makeClient = () => ({
        session: {
          promptAsync: jest.fn().mockResolvedValue({ data: { parts: [] } })
        }
      });

      it('omits query entirely when no directory is passed (no-op)', async () => {
        const client = makeClient();
        const { sendPrompt } = require('../src/opencode-client');
        await sendPrompt(client, 's1', {
          model: 'anthropic/claude-3-5-sonnet',
          parts: [{ type: 'text', text: 'hi' }]
        });
        const args = client.session.promptAsync.mock.calls[0][0];
        expect(args).not.toHaveProperty('query');
        expect(Object.keys(args).sort()).toEqual(['body', 'path']);
      });

      it('includes query.directory when a directory is passed', async () => {
        const client = makeClient();
        const { sendPrompt } = require('../src/opencode-client');
        await sendPrompt(client, 's1', {
          model: 'anthropic/claude-3-5-sonnet',
          parts: [{ type: 'text', text: 'hi' }],
          directory: '/proj/dir'
        });
        const args = client.session.promptAsync.mock.calls[0][0];
        expect(args.query).toEqual({ directory: '/proj/dir' });
        expect(args.path).toEqual({ id: 's1' });
      });
    });

    describe('getMessages', () => {
      const makeClient = () => ({
        session: {
          messages: jest.fn().mockResolvedValue({ data: [] })
        }
      });

      it('omits query entirely when no directory is passed (no-op)', async () => {
        const client = makeClient();
        const { getMessages } = require('../src/opencode-client');
        await getMessages(client, 's1');
        expect(client.session.messages).toHaveBeenCalledWith({
          path: { id: 's1' }
        });
        expect(client.session.messages.mock.calls[0][0]).not.toHaveProperty('query');
      });

      it('includes query.directory when a directory is passed', async () => {
        const client = makeClient();
        const { getMessages } = require('../src/opencode-client');
        await getMessages(client, 's1', '/proj/dir');
        expect(client.session.messages).toHaveBeenCalledWith({
          path: { id: 's1' },
          query: { directory: '/proj/dir' }
        });
      });
    });

    describe('getSessionStatus', () => {
      const makeClient = () => ({
        session: {
          status: jest.fn().mockResolvedValue({ data: {} })
        }
      });

      it('omits query entirely when no directory is passed (no-op)', async () => {
        const client = makeClient();
        const { getSessionStatus } = require('../src/opencode-client');
        await getSessionStatus(client, 's1');
        expect(client.session.status).toHaveBeenCalledWith({
          path: { id: 's1' }
        });
        expect(client.session.status.mock.calls[0][0]).not.toHaveProperty('query');
      });

      it('includes query.directory when a directory is passed', async () => {
        const client = makeClient();
        const { getSessionStatus } = require('../src/opencode-client');
        await getSessionStatus(client, 's1', '/proj/dir');
        expect(client.session.status).toHaveBeenCalledWith({
          path: { id: 's1' },
          query: { directory: '/proj/dir' }
        });
      });
    });

    describe('abortSession', () => {
      const makeClient = () => ({
        session: {
          abort: jest.fn().mockResolvedValue({ data: true })
        }
      });

      it('omits query entirely when no directory is passed (no-op)', async () => {
        const client = makeClient();
        const { abortSession } = require('../src/opencode-client');
        await abortSession(client, 's1');
        expect(client.session.abort).toHaveBeenCalledWith({
          path: { id: 's1' }
        });
        expect(client.session.abort.mock.calls[0][0]).not.toHaveProperty('query');
      });

      it('includes query.directory when a directory is passed', async () => {
        const client = makeClient();
        const { abortSession } = require('../src/opencode-client');
        await abortSession(client, 's1', '/proj/dir');
        expect(client.session.abort).toHaveBeenCalledWith({
          path: { id: 's1' },
          query: { directory: '/proj/dir' }
        });
      });
    });
  });

  describe('loadMcpConfig', () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');

    beforeEach(() => {
      jest.spyOn(fs, 'existsSync');
      jest.spyOn(fs, 'readFileSync');
    });

    afterEach(() => {
      fs.existsSync.mockRestore();
      fs.readFileSync.mockRestore();
    });

    it('should return null if no config file exists', () => {
      fs.existsSync.mockReturnValue(false);

      const { loadMcpConfig } = require('../src/opencode-client');
      const result = loadMcpConfig();

      expect(result).toBeNull();
    });

    it('should load MCP config from global opencode.json', () => {
      const globalConfigPath = path.join(os.homedir(), '.config', 'opencode', 'opencode.json');
      const mcpConfig = {
        'my-server': {
          type: 'local',
          command: ['npx', 'my-mcp-server'],
          enabled: true
        }
      };

      fs.existsSync.mockImplementation((p) => p === globalConfigPath);
      fs.readFileSync.mockReturnValue(JSON.stringify({ mcp: mcpConfig }));

      const { loadMcpConfig } = require('../src/opencode-client');
      const result = loadMcpConfig();

      expect(result).toEqual(mcpConfig);
    });

    it('should load MCP config from custom config path', () => {
      const customPath = '/custom/path/opencode.json';
      const mcpConfig = {
        'custom-server': {
          type: 'remote',
          url: 'https://mcp.example.com',
          enabled: true
        }
      };

      fs.existsSync.mockImplementation((p) => p === customPath);
      fs.readFileSync.mockReturnValue(JSON.stringify({ mcp: mcpConfig }));

      const { loadMcpConfig } = require('../src/opencode-client');
      const result = loadMcpConfig(customPath);

      expect(result).toEqual(mcpConfig);
    });

    it('should return null if config has no mcp section', () => {
      const globalConfigPath = path.join(os.homedir(), '.config', 'opencode', 'opencode.json');

      fs.existsSync.mockImplementation((p) => p === globalConfigPath);
      fs.readFileSync.mockReturnValue(JSON.stringify({ model: 'gemini-2.5' }));

      const { loadMcpConfig } = require('../src/opencode-client');
      const result = loadMcpConfig();

      expect(result).toBeNull();
    });

    it('should return null if mcp section is empty', () => {
      const globalConfigPath = path.join(os.homedir(), '.config', 'opencode', 'opencode.json');

      fs.existsSync.mockImplementation((p) => p === globalConfigPath);
      fs.readFileSync.mockReturnValue(JSON.stringify({ mcp: {} }));

      const { loadMcpConfig } = require('../src/opencode-client');
      const result = loadMcpConfig();

      expect(result).toBeNull();
    });

    it('should handle JSON parse errors gracefully', () => {
      const globalConfigPath = path.join(os.homedir(), '.config', 'opencode', 'opencode.json');

      fs.existsSync.mockImplementation((p) => p === globalConfigPath);
      fs.readFileSync.mockReturnValue('invalid json {');

      const { loadMcpConfig } = require('../src/opencode-client');
      const result = loadMcpConfig();

      expect(result).toBeNull();
    });

    it('resolves the project opencode.json against the passed projectDir, not cwd (M8)', () => {
      const projectDir = path.join(path.sep, 'target', 'project');
      const projectConfigPath = path.join(projectDir, 'opencode.json');
      const cwdConfigPath = path.join(process.cwd(), 'opencode.json');
      const mcpConfig = {
        'proj-server': { type: 'local', command: ['node', 'srv.js'], enabled: true }
      };

      // Only the project-dir config exists — NOT the cwd one.
      fs.existsSync.mockImplementation((p) => p === projectConfigPath);
      fs.readFileSync.mockImplementation((p) => {
        if (p === projectConfigPath) { return JSON.stringify({ mcp: mcpConfig }); }
        throw new Error(`unexpected read: ${p}`);
      });

      const { loadMcpConfig } = require('../src/opencode-client');
      const result = loadMcpConfig(undefined, projectDir);

      expect(result).toEqual(mcpConfig);
      // Must have probed the project-dir path, and must NOT have found config via cwd.
      expect(fs.existsSync).toHaveBeenCalledWith(projectConfigPath);
      // Guard: if cwd differs from projectDir, the cwd path was not the source.
      if (cwdConfigPath !== projectConfigPath) {
        expect(fs.existsSync).not.toHaveBeenCalledWith(cwdConfigPath);
      }
    });

    it('falls back to process.cwd() for the project config when projectDir is omitted', () => {
      const cwdConfigPath = path.join(process.cwd(), 'opencode.json');
      const mcpConfig = {
        'cwd-server': { type: 'local', command: ['node', 'srv.js'], enabled: true }
      };

      fs.existsSync.mockImplementation((p) => p === cwdConfigPath);
      fs.readFileSync.mockReturnValue(JSON.stringify({ mcp: mcpConfig }));

      const { loadMcpConfig } = require('../src/opencode-client');
      const result = loadMcpConfig();

      expect(result).toEqual(mcpConfig);
      expect(fs.existsSync).toHaveBeenCalledWith(cwdConfigPath);
    });
  });

  describe('parseMcpSpec', () => {
    it('should parse remote server URL format (name=url)', () => {
      const { parseMcpSpec } = require('../src/opencode-client');
      const result = parseMcpSpec('my-server=https://mcp.example.com');

      expect(result).toEqual({
        name: 'my-server',
        config: {
          type: 'remote',
          url: 'https://mcp.example.com',
          enabled: true
        }
      });
    });

    it('should parse local server command format (name=command)', () => {
      const { parseMcpSpec } = require('../src/opencode-client');
      const result = parseMcpSpec('my-server=npx my-mcp-server');

      expect(result).toEqual({
        name: 'my-server',
        config: {
          type: 'local',
          command: ['npx', 'my-mcp-server'],
          enabled: true
        }
      });
    });

    it('should parse JSON format', () => {
      const { parseMcpSpec } = require('../src/opencode-client');
      const jsonSpec = JSON.stringify({
        'custom-server': {
          type: 'local',
          command: ['node', 'server.js'],
          environment: { API_KEY: 'xxx' }
        }
      });
      const result = parseMcpSpec(jsonSpec);

      expect(result).toEqual({
        name: 'custom-server',
        config: {
          type: 'local',
          command: ['node', 'server.js'],
          environment: { API_KEY: 'xxx' }
        }
      });
    });

    it('should handle http URLs as remote', () => {
      const { parseMcpSpec } = require('../src/opencode-client');
      const result = parseMcpSpec('local-server=http://localhost:3000');

      expect(result).toEqual({
        name: 'local-server',
        config: {
          type: 'remote',
          url: 'http://localhost:3000',
          enabled: true
        }
      });
    });

    it('should return null for invalid format (no =)', () => {
      const { parseMcpSpec } = require('../src/opencode-client');
      const result = parseMcpSpec('invalid-format');

      expect(result).toBeNull();
    });

    it('should return null for invalid JSON', () => {
      const { parseMcpSpec } = require('../src/opencode-client');
      const result = parseMcpSpec('{invalid json');

      expect(result).toBeNull();
    });

    it('should handle empty name gracefully', () => {
      const { parseMcpSpec } = require('../src/opencode-client');
      const result = parseMcpSpec('=https://mcp.example.com');

      expect(result).toBeNull();
    });

    it('keeps a quoted command path with spaces as one token (L4)', () => {
      const { parseMcpSpec } = require('../src/opencode-client');
      const result = parseMcpSpec('my-server="C:\\Program Files\\node\\node.exe" server.js');

      expect(result).toEqual({
        name: 'my-server',
        config: {
          type: 'local',
          command: ['C:\\Program Files\\node\\node.exe', 'server.js'],
          enabled: true
        }
      });
    });

    it('still splits an unquoted command on whitespace (L4 back-compat)', () => {
      const { parseMcpSpec } = require('../src/opencode-client');
      const result = parseMcpSpec('my-server=npx  my-mcp-server --flag');

      // Collapses the double space and keeps every bare token.
      expect(result.config.command).toEqual(['npx', 'my-mcp-server', '--flag']);
    });
  });
});

describe('buildServerHandle (F3 #15 / B06 teardown race)', () => {
  test('prefers sdkServer.pid over the port scan', () => {
    const { buildServerHandle } = require('../src/opencode-client');
    const server = buildServerHandle(
      { url: 'http://127.0.0.1:4096', close: () => {}, pid: 111 },
      { findListenerPid: () => 999, kill: () => {} }
    );
    expect(server.goPid).toBe(111);
  });

  describe('close() (B06: direct SIGTERM to goPid + REF\'d escalation, not an unref\'d SIGKILL timer)', () => {
    test('SIGTERMs goPid directly on close (real escalation primitive, injected kill), in addition to sdkServer.close()', async () => {
      // Uses the REAL waitThenKill (not mocked) so this proves close() actually
      // wires the escalation primitive to send a SIGTERM to goPid — not just
      // that it calls some injected function.
      let alive = true;
      const kill = jest.fn((pid, sig) => {
        if (!alive) { const e = new Error('ESRCH'); e.code = 'ESRCH'; throw e; }
        if (sig === 'SIGTERM') { alive = false; } // dies immediately after TERM
      });
      const sdkClose = jest.fn();
      const { buildServerHandle } = require('../src/opencode-client');
      const server = buildServerHandle(
        { url: 'http://127.0.0.1:4096', close: sdkClose },
        { findListenerPid: () => 24680, kill, logger: { debug: () => {} } }
      );
      await server.close();
      expect(sdkClose).toHaveBeenCalled();
      const termCalls = kill.mock.calls.filter(([pid, sig]) => pid === 24680 && sig === 'SIGTERM');
      expect(termCalls).toHaveLength(1);
      // Process died right after TERM — escalation must NOT have needed SIGKILL.
      const killCalls = kill.mock.calls.filter(([, sig]) => sig === 'SIGKILL');
      expect(killCalls).toHaveLength(0);
    });

    test('engages the escalation primitive on goPid with a bounded (~2s) grace, no upfront wait', async () => {
      const waitThenKill = jest.fn(async () => ({ killed: [24680], exited: [], escalated: [24680] }));
      const { buildServerHandle } = require('../src/opencode-client');
      const server = buildServerHandle(
        { url: 'http://127.0.0.1:4096', close: () => {} },
        {
          findListenerPid: () => 24680,
          kill: () => {},
          logger: { debug: () => {} },
          waitThenKill,
        }
      );
      await server.close();
      expect(waitThenKill).toHaveBeenCalledTimes(1);
      const [pids, opts] = waitThenKill.mock.calls[0];
      expect(pids).toBe(24680);
      // No upfront grace before the direct SIGTERM — the SDK's close() never
      // reaches the Go binary, so there is nothing worth waiting for first.
      expect(opts.graceMs).toBe(0);
      expect(opts.escalate).toEqual(expect.objectContaining({ killGraceMs: 2000 }));
    });

    test('escalation primitive (real, unmocked) SIGKILLs goPid when it survives the SIGTERM', async () => {
      jest.useFakeTimers();
      const kill = jest.fn(); // never throws => pid is "always alive" until SIGKILL
      const { buildServerHandle } = require('../src/opencode-client');
      const server = buildServerHandle(
        { url: 'http://127.0.0.1:4096', close: () => {} },
        { findListenerPid: () => 24680, kill, logger: { debug: () => {} } }
      );
      const closed = server.close();
      await jest.advanceTimersByTimeAsync(2000); // CLOSE_KILL_GRACE_MS
      await closed;
      const termCalls = kill.mock.calls.filter(([pid, sig]) => pid === 24680 && sig === 'SIGTERM');
      const killCalls = kill.mock.calls.filter(([pid, sig]) => pid === 24680 && sig === 'SIGKILL');
      expect(termCalls).toHaveLength(1);
      expect(killCalls).toHaveLength(1);
      // TERM must be observed strictly before KILL.
      const sigOrder = kill.mock.calls.map(([, sig]) => sig).filter((s) => s !== 0);
      expect(sigOrder.indexOf('SIGTERM')).toBeLessThan(sigOrder.indexOf('SIGKILL'));
      jest.useRealTimers();
    });

    test('skips goPid === process.pid (degenerate self-pid guard)', async () => {
      const kill = jest.fn();
      const waitThenKill = jest.fn(async () => ({ killed: [], exited: [], escalated: [] }));
      const { buildServerHandle } = require('../src/opencode-client');
      const server = buildServerHandle(
        { url: 'http://127.0.0.1:4096', close: () => {} },
        { findListenerPid: () => process.pid, kill, logger: { debug: () => {} }, waitThenKill }
      );
      await server.close();
      expect(kill).not.toHaveBeenCalled();
      expect(waitThenKill).not.toHaveBeenCalled();
    });

    test('skips a falsy goPid entirely — no signals, no escalation call', async () => {
      const kill = jest.fn();
      const waitThenKill = jest.fn(async () => ({ killed: [], exited: [], escalated: [] }));
      const { buildServerHandle } = require('../src/opencode-client');
      const server = buildServerHandle(
        { url: 'http://127.0.0.1:4096', close: () => {} },
        { findListenerPid: () => null, kill, logger: { debug: () => {} }, waitThenKill }
      );
      await server.close();
      expect(kill).not.toHaveBeenCalled();
      expect(waitThenKill).not.toHaveBeenCalled();
    });

    test('does not arm the old unref\'d SIGKILL timer (no fallback setTimeout survives event-loop drain)', async () => {
      jest.useFakeTimers();
      const kill = jest.fn();
      const waitThenKill = jest.fn(async () => ({ killed: [], exited: [24680], escalated: [] }));
      const { buildServerHandle } = require('../src/opencode-client');
      const server = buildServerHandle(
        { url: 'http://127.0.0.1:4096', close: () => {} },
        { findListenerPid: () => 24680, kill, logger: { debug: () => {} }, waitThenKill }
      );
      await server.close();
      // Advance well past the old 2s fallback window — no timer-driven SIGKILL
      // should fire from close() itself; all killing now flows through the
      // injected (and already-awaited) waitThenKill call above.
      jest.advanceTimersByTime(5000);
      const killSignals = kill.mock.calls.filter(([, sig]) => sig === 'SIGKILL');
      expect(killSignals).toHaveLength(0);
      jest.useRealTimers();
    });
  });
});

describe('provider error detection (#37)', () => {
  const {
    providerErrorReason,
    INSUFFICIENT_CREDITS_REASON,
    sendPrompt,
  } = require('../src/opencode-client');

  describe('providerErrorReason', () => {
    it('maps HTTP 402 to "Insufficient credits"', () => {
      expect(providerErrorReason({ response: { status: 402 }, error: { message: 'Payment Required' } }))
        .toBe('Insufficient credits');
      expect(INSUFFICIENT_CREDITS_REASON).toBe('Insufficient credits');
    });

    it('maps other non-2xx statuses to a generic "Provider error: <status>"', () => {
      expect(providerErrorReason({ response: { status: 503 }, error: { message: 'down' } }))
        .toBe('Provider error: 503');
    });

    it('returns null for 2xx responses (no provider failure)', () => {
      expect(providerErrorReason({ response: { status: 200 }, data: { parts: [] } })).toBeNull();
    });

    it('returns null when there is no status and no error (benign result)', () => {
      expect(providerErrorReason({ data: { parts: [] } })).toBeNull();
      expect(providerErrorReason(undefined)).toBeNull();
    });

    it('does NOT flag a benign informational error that carries no non-2xx status', () => {
      // promptAsync sometimes returns an informational error (model config warning)
      // with a 2xx (or absent) status — this must remain "continue to poll".
      expect(providerErrorReason({ response: { status: 200 }, error: { message: 'model warning' } }))
        .toBeNull();
    });
  });

  describe('sendPrompt propagates provider error reason', () => {
    it('attaches "Insufficient credits" on a 402 result', async () => {
      const mockClient = {
        session: {
          promptAsync: jest.fn().mockResolvedValue({
            response: { status: 402 },
            error: { message: 'Payment Required' },
          }),
        },
      };

      const result = await sendPrompt(mockClient, 'session-123', {
        model: 'openrouter/google/gemini-2.5-flash',
        parts: [{ type: 'text', text: 'Hello' }],
      });

      expect(result.providerError).toBe('Insufficient credits');
    });

    it('attaches a generic provider error on other non-2xx results', async () => {
      const mockClient = {
        session: {
          promptAsync: jest.fn().mockResolvedValue({
            response: { status: 500 },
            error: { message: 'boom' },
          }),
        },
      };

      const result = await sendPrompt(mockClient, 'session-123', {
        model: 'openrouter/google/gemini-2.5-flash',
        parts: [{ type: 'text', text: 'Hello' }],
      });

      expect(result.providerError).toBe('Provider error: 500');
    });

    it('does NOT attach a provider error on a successful (2xx) result', async () => {
      const mockClient = {
        session: {
          promptAsync: jest.fn().mockResolvedValue({
            response: { status: 200 },
            data: { parts: [] },
          }),
        },
      };

      const result = await sendPrompt(mockClient, 'session-123', {
        model: 'openrouter/google/gemini-2.5-flash',
        parts: [{ type: 'text', text: 'Hello' }],
      });

      expect(result.providerError).toBeUndefined();
    });
  });
});

describe('buildServerOptions — ANTHROPIC_BASE_URL normalization (v4.6.2 PR1)', () => {
  const { _resetBaseUrlNotice } = require('../src/utils/base-url-classify');
  beforeEach(() => _resetBaseUrlNotice());

  const noticeSink = () => {
    const writes = [];
    return { deps: { write: s => writes.push(s), logger: { info: () => {} } }, writes };
  };

  test('host-form env -> provider.anthropic.options.baseURL is the /v1 form', () => {
    const { deps } = noticeSink();
    const so = buildServerOptions({
      _env: { ANTHROPIC_BASE_URL: 'https://api.anthropic.com' }, _noticeDeps: deps,
    });
    expect(so.config.provider.anthropic.options.baseURL)
      .toBe('https://api.anthropic.com/v1');
  });

  test('the notice announces once across two builds', () => {
    const { deps, writes } = noticeSink();
    const env = { ANTHROPIC_BASE_URL: 'https://api.anthropic.com' };
    buildServerOptions({ _env: env, _noticeDeps: deps });
    buildServerOptions({ _env: env, _noticeDeps: deps });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatch(/^Notice: ANTHROPIC_BASE_URL is host-form/);
  });

  test.each([
    [{ ANTHROPIC_BASE_URL: 'https://x.test/v1' }, 'already /v1'],
    [{ ANTHROPIC_BASE_URL: 'https://x.test/custom' }, 'nonstandard path'],
    [{ ANTHROPIC_BASE_URL: 'https://api.anthropic.com', AMICUS_BASE_URL_NORMALIZE: '0' }, 'knob off'],
    [{}, 'unset'],
  ])('no override injected for %j (%s)', (env) => {
    const so = buildServerOptions({ _env: env });
    const anthropic = so.config.provider.anthropic;
    expect(anthropic && anthropic.options && anthropic.options.baseURL).toBeFalsy();
  });

  test('an existing anthropic provider entry is merged, not clobbered', () => {
    // opus registers the anthropic provider via buildProviderModels
    const { deps } = noticeSink();
    const so = buildServerOptions({
      model: 'anthropic/claude-opus-4-8',
      _env: { ANTHROPIC_BASE_URL: 'https://api.anthropic.com' }, _noticeDeps: deps,
    });
    expect(so.config.provider.anthropic.models['claude-opus-4-8']).toEqual({});
    expect(so.config.provider.anthropic.options.baseURL).toBe('https://api.anthropic.com/v1');
  });
});
