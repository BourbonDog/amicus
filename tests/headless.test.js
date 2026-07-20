/**
 * Tests for headless mode runner
 *
 * Tests the headless mode runner that uses OpenCode SDK (no CLI spawning).
 */

const fs = require('fs');

// Mock fs
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  appendFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  unlinkSync: jest.fn(),
  // writeFileAtomic (progress.js's writer) tmp-writes then renames; both
  // no-ops, matching the other fs stubs above.
  renameSync: jest.fn(),
  rmSync: jest.fn()
}));

// Mock the opencode-client module
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
  getSessionStatus: mockGetSessionStatus
}));

jest.mock('../src/utils/logger', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn()
  }
}));

const { runHeadless: runHeadlessRaw, extractSummary, findTrailingFoldMarker, COMPLETE_MARKER, FOLD_MARKER, formatFoldOutput, DEFAULT_TIMEOUT } = require('../src/headless');
const { buildFoldMarker } = require('../src/utils/fold-marker');

// 15b.3: fixed per-suite nonce. Most of this file's fixtures embed a
// completion marker in mocked model output and expect runHeadless to fold on
// it — since completion now requires the marker to carry THIS run's nonce,
// every such fixture must (a) use NONCED_MARKER instead of the bare
// COMPLETE_MARKER and (b) agree on a nonce with runHeadless's detection.
// `runHeadless` below is a thin wrapper around the real one that DEFAULTS
// options.nonce to NONCE (a call passing its OWN options.nonce — e.g. the
// nonce-security-property tests further down — always wins, since that
// value overwrites the default in the spread below). This means most of the
// ~45 call sites in this file needed ZERO signature changes: only the
// fixtures that actually assert on marker-triggered completion had their
// [SIDECAR_FOLD] literal swapped for NONCED_MARKER.
const NONCE = 'testnonce1234567';
const NONCED_MARKER = buildFoldMarker(NONCE);

/** Merge {nonce: NONCE} into a runHeadless options object (own properties win). */
function withNonce(options = {}) {
  return { nonce: NONCE, ...options };
}

/**
 * Test-local shim: same signature as the real runHeadless, but the trailing
 * `options` argument defaults to carrying this suite's NONCE when the call
 * site omits it entirely (the common case: `runHeadless(m, s, u, t, p, ms)`
 * with no 7th/8th arg). A caller that DOES pass its own options object keeps
 * full control — `withNonce()`'s spread order means an explicit
 * `options.nonce` (or the deliberate ABSENCE of one, tested in the
 * nonce-security describe block below via a differently-named nonce) is
 * never silently overwritten... except this shim can't tell "options passed
 * without .nonce" from "options not passed" — so tests needing a DIFFERENT
 * or ABSENT nonce call the real runHeadlessRaw directly instead.
 */
function runHeadless(model, systemPrompt, userMessage, taskId, project, timeoutMs, agent, options) {
  if (arguments.length <= 6) {
    return runHeadlessRaw(model, systemPrompt, userMessage, taskId, project, timeoutMs, undefined, { nonce: NONCE });
  }
  return runHeadlessRaw(model, systemPrompt, userMessage, taskId, project, timeoutMs, agent, withNonce(options));
}

describe('Headless Mode Runner', () => {
  let mockClient;
  let mockServer;

  beforeEach(() => {
    jest.clearAllMocks();

    // Default: non-idle status so existing tests never see the SDK-idle path.
    mockGetSessionStatus.mockResolvedValue({ type: 'busy' });

    // Setup fs mocks
    fs.existsSync.mockReturnValue(true);

    // Setup SDK client mock
    mockClient = {
      session: {
        create: jest.fn(),
        prompt: jest.fn(),
        messages: jest.fn()
      },
      config: {
        get: jest.fn()
      }
    };

    mockServer = {
      url: 'http://127.0.0.1:4440',
      close: mockServerClose
    };

    mockStartServer.mockResolvedValue({ client: mockClient, server: mockServer });
  });

  describe('runHeadless', () => {
    const testProject = '/test/project';
    const testModel = 'openrouter/google/gemini-2.5-flash';
    const testSystemPrompt = '# Test system prompt';
    const testUserMessage = 'Please complete the task';
    const testTaskId = 'abc12345';

    it('should start server using SDK startServer', async () => {
      mockCheckHealth.mockResolvedValue(true);
      mockCreateSession.mockResolvedValue('session-123');
      mockSendPromptAsync.mockResolvedValue(undefined);
      mockGetMessages.mockResolvedValue([{
        info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
        parts: [{ type: 'text', text: `Done!\n${NONCED_MARKER}` }]
      }]);

      await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 5000);

      expect(mockStartServer).toHaveBeenCalled();
    });

    describe('SDK Integration', () => {
      it('should use createSession from SDK client', async () => {
        mockCheckHealth.mockResolvedValue(true);
        mockCreateSession.mockResolvedValue('session-123');
        mockSendPromptAsync.mockResolvedValue(undefined);
        mockGetMessages.mockResolvedValue([{
          info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
          parts: [{ type: 'text', text: NONCED_MARKER }]
        }]);
      });

      it('should use sendPromptAsync from SDK client with model specification', async () => {
        mockCheckHealth.mockResolvedValue(true);
        mockCreateSession.mockResolvedValue('session-123');
        mockSendPromptAsync.mockResolvedValue(undefined);
        mockGetMessages.mockResolvedValue([{
          info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
          parts: [{ type: 'text', text: NONCED_MARKER }]
        }]);

        await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 5000);

        expect(mockSendPromptAsync).toHaveBeenCalledWith(
          mockClient,
          'session-123',
          expect.objectContaining({
            model: testModel,
            system: testSystemPrompt,
            parts: [{ type: 'text', text: testUserMessage }]
          })
        );
      });

      it('should use checkHealth to verify server is ready', async () => {
        mockCheckHealth.mockResolvedValue(true);
        mockCreateSession.mockResolvedValue('session-123');
        mockSendPromptAsync.mockResolvedValue(undefined);
        mockGetMessages.mockResolvedValue([{
          info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
          parts: [{ type: 'text', text: NONCED_MARKER }]
        }]);
      });

      it('should use getMessages to poll for completion', async () => {
        mockCheckHealth.mockResolvedValue(true);
        mockCreateSession.mockResolvedValue('session-123');
        mockSendPromptAsync.mockResolvedValue(undefined);
        // First poll doesn't have marker, second does
        mockGetMessages
          .mockResolvedValueOnce([{ parts: [{ type: 'text', text: 'Still working...' }] }])
          .mockResolvedValueOnce([{
            info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
            parts: [{ type: 'text', text: `Done!\n${NONCED_MARKER}` }]
          }]);

        await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 10000);

        expect(mockGetMessages).toHaveBeenCalledWith(mockClient, 'session-123');
      }, 15000); // Increase timeout for polling test
    });

    describe('Default Agent', () => {
      it('should default to build agent when no agent specified', async () => {
        mockCheckHealth.mockResolvedValue(true);
        mockCreateSession.mockResolvedValue('session-123');
        mockSendPromptAsync.mockResolvedValue(undefined);
        mockGetMessages.mockResolvedValue([{
          info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
          parts: [{ type: 'text', text: NONCED_MARKER }]
        }]);

        // Call without agent parameter (undefined)
        await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 5000, undefined);

        expect(mockSendPromptAsync).toHaveBeenCalledWith(
          mockClient,
          'session-123',
          expect.objectContaining({
            agent: 'build'
          })
        );
      });

      it('should respect explicit agent when provided', async () => {
        mockCheckHealth.mockResolvedValue(true);
        mockCreateSession.mockResolvedValue('session-123');
        mockSendPromptAsync.mockResolvedValue(undefined);
        mockGetMessages.mockResolvedValue([{
          info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
          parts: [{ type: 'text', text: NONCED_MARKER }]
        }]);

        await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 5000, 'plan');

        expect(mockSendPromptAsync).toHaveBeenCalledWith(
          mockClient,
          'session-123',
          expect.objectContaining({
            agent: 'plan'
          })
        );
      });
    });

    describe('Completion Detection', () => {
      it('should detect [SIDECAR_FOLD] marker in response', async () => {
        mockCheckHealth.mockResolvedValue(true);
        mockCreateSession.mockResolvedValue('session-123');
        mockSendPromptAsync.mockResolvedValue(undefined);
        mockGetMessages.mockResolvedValue([{
          info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
          parts: [{ type: 'text', text: `Summary content\n${NONCED_MARKER}` }]
        }]);
      });

      it('should return summary content before [SIDECAR_FOLD] marker', async () => {
        const summaryText = '## Task Summary\nCompleted the task.';
        mockCheckHealth.mockResolvedValue(true);
        mockCreateSession.mockResolvedValue('session-123');
        mockSendPromptAsync.mockResolvedValue(undefined);
        mockGetMessages.mockResolvedValue([{
          info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
          parts: [{ type: 'text', text: `${summaryText}\n${NONCED_MARKER}` }]
        }]);
      });
    });

    describe('Server Management', () => {
      it('should return error if server fails to start', async () => {
        // Health check always fails
        mockCheckHealth.mockResolvedValue(false);

        const result = await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 5000);

        expect(result.completed).toBe(false);
        expect(result.error).toContain('server failed to start');
        expect(mockServerClose).toHaveBeenCalled();
      }, 20000);

      it('should return error if startServer throws', async () => {
        mockStartServer.mockRejectedValue(new Error('Failed to start server'));

        const result = await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 5000);

        expect(result.completed).toBe(false);
        expect(result.error).toContain('Failed to start server');
      });

      it('should return error if session creation fails', async () => {
        mockCheckHealth.mockResolvedValue(true);
        mockCreateSession.mockRejectedValue(new Error('Failed to create session'));

        const result = await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 5000);

        expect(result.completed).toBe(false);
        expect(result.error).toContain('Failed to create session');
      });

      it('should close server on completion', async () => {
        mockCheckHealth.mockResolvedValue(true);
        mockCreateSession.mockResolvedValue('session-123');
        mockSendPromptAsync.mockResolvedValue(undefined);
        mockGetMessages.mockResolvedValue([{
          info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
          parts: [{ type: 'text', text: NONCED_MARKER }]
        }]);

        await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 5000);

        expect(mockServerClose).toHaveBeenCalled();
      });

      it('should close server on error', async () => {
        mockCheckHealth.mockResolvedValue(true);
        mockCreateSession.mockResolvedValue('session-123');
        mockSendPromptAsync.mockRejectedValue(new Error('Network error'));

        await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 5000);

        expect(mockServerClose).toHaveBeenCalled();
      });
    });

    describe('Conversation Logging', () => {
      it('should create session directory if it does not exist', async () => {
        fs.existsSync.mockReturnValue(false);
        mockCheckHealth.mockResolvedValue(true);
        mockCreateSession.mockResolvedValue('session-123');
        mockSendPromptAsync.mockResolvedValue(undefined);
        mockGetMessages.mockResolvedValue([{
          info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
          parts: [{ type: 'text', text: NONCED_MARKER }]
        }]);

        await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 5000);

        expect(fs.mkdirSync).toHaveBeenCalledWith(
          expect.stringContaining(testTaskId),
          { recursive: true, mode: 0o700 }
        );
      });

      it('should log system prompt as first message', async () => {
        mockCheckHealth.mockResolvedValue(true);
        mockCreateSession.mockResolvedValue('session-123');
        mockSendPromptAsync.mockResolvedValue(undefined);
        mockGetMessages.mockResolvedValue([{
          info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
          parts: [{ type: 'text', text: NONCED_MARKER }]
        }]);

        await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 5000);

        expect(fs.appendFileSync).toHaveBeenCalled();
        const firstCall = fs.appendFileSync.mock.calls[0];
        const loggedMessage = JSON.parse(firstCall[1].replace('\n', ''));
        expect(loggedMessage.role).toBe('system');
        expect(loggedMessage.content).toBe(testSystemPrompt);
      });

      it('should log assistant output', async () => {
        const responseText = 'This is the response';
        mockCheckHealth.mockResolvedValue(true);
        mockCreateSession.mockResolvedValue('session-123');
        mockSendPromptAsync.mockResolvedValue(undefined);
        mockGetMessages.mockResolvedValue([{
          info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
          parts: [{ type: 'text', text: `${responseText}\n${NONCED_MARKER}` }]
        }]);

        await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 5000);

        const assistantCalls = fs.appendFileSync.mock.calls.filter(call => {
          try {
            const msg = JSON.parse(call[1].replace('\n', ''));
            return msg.role === 'assistant';
          } catch {
            return false;
          }
        });
        expect(assistantCalls.length).toBeGreaterThan(0);
      });

      it('should include timestamps in logged messages', async () => {
        mockCheckHealth.mockResolvedValue(true);
        mockCreateSession.mockResolvedValue('session-123');
        mockSendPromptAsync.mockResolvedValue(undefined);
        mockGetMessages.mockResolvedValue([{
          info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
          parts: [{ type: 'text', text: NONCED_MARKER }]
        }]);

        await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 5000);

        const firstCall = fs.appendFileSync.mock.calls[0];
        const loggedMessage = JSON.parse(firstCall[1].replace('\n', ''));
        expect(loggedMessage.timestamp).toBeDefined();
        expect(() => new Date(loggedMessage.timestamp)).not.toThrow();
      });
    });

    describe('Return Value', () => {
      it('should return summary, completed flag, and timedOut flag', async () => {
        mockCheckHealth.mockResolvedValue(true);
        mockCreateSession.mockResolvedValue('session-123');
        mockSendPromptAsync.mockResolvedValue(undefined);
        mockGetMessages.mockResolvedValue([{
          info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
          parts: [{ type: 'text', text: `Summary\n${NONCED_MARKER}` }]
        }]);

        const result = await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 5000);

        expect(result).toHaveProperty('summary');
        expect(result).toHaveProperty('completed');
        expect(result).toHaveProperty('timedOut');
      });

      it('should return taskId in result', async () => {
        mockCheckHealth.mockResolvedValue(true);
        mockCreateSession.mockResolvedValue('session-123');
        mockSendPromptAsync.mockResolvedValue(undefined);
        mockGetMessages.mockResolvedValue([{
          info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
          parts: [{ type: 'text', text: NONCED_MARKER }]
        }]);

        const result = await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 5000);

        expect(result.taskId).toBe(testTaskId);
      });
    });
  });

  describe('extractSummary', () => {
    it('extracts content before the trailing nonced marker', () => {
      const output = `Summary content\n${NONCED_MARKER}`;
      expect(extractSummary(output, NONCE)).toBe('Summary content');
    });

    it('handles output without a marker', () => {
      const output = 'Just some text without marker';
      expect(extractSummary(output, NONCE)).toBe(output);
    });

    it('handles empty output without requiring a nonce', () => {
      expect(extractSummary('')).toBe('');
      expect(extractSummary(null)).toBe('');
      expect(extractSummary(undefined)).toBe('');
    });

    it('throws when output is non-empty and no nonce is given (v4.0 §9 — legacy path retired)', () => {
      expect(() => extractSummary('Summary content\n[SIDECAR_FOLD]'))
        .toThrow(/requires a per-run nonce/);
    });

    it('no longer splits on the legacy bare marker even WITH a nonce (bare form retired)', () => {
      const output = 'Summary content\n[SIDECAR_FOLD]';
      expect(extractSummary(output, NONCE)).toBe(output.trim());
    });

    it('trims whitespace', () => {
      const output = `  Summary  \n  ${NONCED_MARKER}`;
      expect(extractSummary(output, NONCE)).toBe('Summary');
    });

    it('splits on a TRAILING marker even with blank lines after it (#BL-7)', () => {
      const output = `Summary content\n${NONCED_MARKER}\n\n  `;
      expect(extractSummary(output, NONCE)).toBe('Summary content');
    });

    it('does NOT strip a marker echoed mid-output — only the trailing one (#BL-7)', () => {
      const output = `Reproducing the format:\n${NONCED_MARKER}\nthen more analysis`;
      expect(extractSummary(output, NONCE)).toBe(output.trim());
    });

    it('splits on the trailing marker when an earlier one is echoed (#BL-7)', () => {
      const output = `See ${NONCED_MARKER} usage above\nrest of summary\n${NONCED_MARKER}`;
      expect(extractSummary(output, NONCE)).toBe(`See ${NONCED_MARKER} usage above\nrest of summary`);
    });
  });

  describe('findTrailingFoldMarker (#BL-7 + 15b.3 nonce)', () => {
    it('matches the nonced marker when it is the final non-empty line', () => {
      expect(findTrailingFoldMarker(`done\n${NONCED_MARKER}`, NONCE)).toBeGreaterThanOrEqual(0);
      expect(findTrailingFoldMarker(`done\n${NONCED_MARKER}\n\n`, NONCE)).toBeGreaterThanOrEqual(0);
      expect(findTrailingFoldMarker(`   ${NONCED_MARKER}   `, NONCE)).toBeGreaterThanOrEqual(0);
    });

    it('does NOT match a marker echoed inline in prose', () => {
      expect(findTrailingFoldMarker(`splits on the ${NONCED_MARKER} marker`, NONCE)).toBe(-1);
    });

    it('does NOT match a standalone marker followed by more content', () => {
      // The core hardening: an own-line marker mid-output is not a completion signal.
      expect(findTrailingFoldMarker(`here:\n${NONCED_MARKER}\nmore work`, NONCE)).toBe(-1);
    });

    it('returns the TRAILING marker index when several appear', () => {
      const out = `a\n${NONCED_MARKER}\nb\n${NONCED_MARKER}`;
      // Index points at the last marker line (after "b\n"), not the first.
      expect(findTrailingFoldMarker(out, NONCE)).toBe(out.lastIndexOf(NONCED_MARKER));
    });

    it('returns -1 for empty/absent', () => {
      expect(findTrailingFoldMarker('', NONCE)).toBe(-1);
      expect(findTrailingFoldMarker(null, NONCE)).toBe(-1);
      expect(findTrailingFoldMarker('no marker here', NONCE)).toBe(-1);
    });

    // 15b.3 core red: the bare legacy marker and a marker carrying a
    // DIFFERENT nonce must never match — only this exact nonce completes.
    it('does NOT match the bare legacy [SIDECAR_FOLD] marker (no nonce)', () => {
      expect(findTrailingFoldMarker('done\n[SIDECAR_FOLD]', NONCE)).toBe(-1);
    });

    it('does NOT match a marker carrying a DIFFERENT nonce', () => {
      expect(findTrailingFoldMarker('done\n[SIDECAR_FOLD:someOtherNonce]', NONCE)).toBe(-1);
    });

    it('returns -1 when no nonce is supplied at all, even with a bare marker present', () => {
      expect(findTrailingFoldMarker('done\n[SIDECAR_FOLD]', undefined)).toBe(-1);
    });
  });

  describe('Reasoning/Thinking Support', () => {
    const testProject = '/test/project';
    const testModel = 'openrouter/google/gemini-3-pro-preview';
    const testSystemPrompt = '# Test system prompt';
    const testUserMessage = 'Please complete the task';
    const testTaskId = 'abc12345';

    beforeEach(() => {
      mockCheckHealth.mockResolvedValue(true);
      mockCreateSession.mockResolvedValue('session-123');
      mockSendPromptAsync.mockResolvedValue(undefined);
      mockGetMessages.mockResolvedValue([{
        info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
        parts: [{ type: 'text', text: NONCED_MARKER }]
      }]);
    });

    it('should pass reasoning parameter to sendPromptAsync when provided', async () => {
      await runHeadless(
        testModel,
        testSystemPrompt,
        testUserMessage,
        testTaskId,
        testProject,
        5000,
        'build',
        { reasoning: { effort: 'low' } }
      );

      expect(mockSendPromptAsync).toHaveBeenCalledWith(
        expect.anything(),
        'session-123',
        expect.objectContaining({
          reasoning: { effort: 'low' }
        })
      );
    });

    it('should support all reasoning effort levels', async () => {
      const effortLevels = ['minimal', 'low', 'medium', 'high', 'xhigh', 'none'];

      for (const effort of effortLevels) {
        mockSendPromptAsync.mockClear();

        await runHeadless(
          testModel,
          testSystemPrompt,
          testUserMessage,
          testTaskId,
          testProject,
          5000,
          'build',
          { reasoning: { effort } }
        );

        expect(mockSendPromptAsync).toHaveBeenCalledWith(
          expect.anything(),
          'session-123',
          expect.objectContaining({
            reasoning: { effort }
          })
        );
      }
    }, 30000);

    it('should not include reasoning when not provided in options', async () => {
      await runHeadless(
        testModel,
        testSystemPrompt,
        testUserMessage,
        testTaskId,
        testProject,
        5000,
        'build',
        {}
      );

      const callArgs = mockSendPromptAsync.mock.calls[0][2];
      expect(callArgs).not.toHaveProperty('reasoning');
    });

    it('should combine reasoning with other options like mcp', async () => {
      const mcpConfig = { 'my-server': { type: 'remote', url: 'https://example.com' } };

      await runHeadless(
        testModel,
        testSystemPrompt,
        testUserMessage,
        testTaskId,
        testProject,
        5000,
        'build',
        { mcp: mcpConfig, reasoning: { effort: 'high' } }
      );

      expect(mockSendPromptAsync).toHaveBeenCalledWith(
        expect.anything(),
        'session-123',
        expect.objectContaining({
          reasoning: { effort: 'high' }
        })
      );

      // Verify MCP was passed to startServer
      expect(mockStartServer).toHaveBeenCalledWith(
        expect.objectContaining({
          mcp: mcpConfig
        })
      );
    });
  });

  describe('FOLD_MARKER', () => {
    it('should be exported as [SIDECAR_FOLD]', () => {
      expect(FOLD_MARKER).toBe('[SIDECAR_FOLD]');
    });

    it('should have COMPLETE_MARKER equal FOLD_MARKER for backward compat', () => {
      expect(COMPLETE_MARKER).toBe(FOLD_MARKER);
    });
  });

  describe('formatFoldOutput', () => {
    it('should format with all fields (nonced marker header)', () => {
      const output = formatFoldOutput({
        model: 'google/gemini-2.5-pro', sessionId: 'abc123',
        client: 'code-local', cwd: '/projects/myapp',
        mode: 'interactive', summary: 'Test summary', nonce: NONCE
      });
      expect(output).toContain(NONCED_MARKER);
      expect(output).toContain('Model: google/gemini-2.5-pro');
      expect(output).toContain('Session: abc123');
      expect(output).toContain('Client: code-local');
      expect(output).toContain('CWD: /projects/myapp');
      expect(output).toContain('Mode: interactive');
      expect(output).toContain('---');
      expect(output).toContain('Test summary');
    });

    it('should use defaults for missing optional fields', () => {
      const output = formatFoldOutput({ model: 'test', sessionId: 'x', summary: 'hi', nonce: NONCE });
      expect(output).toContain('Client: code-local');
      expect(output).toContain('Mode: headless');
    });

    // 15b.3
    it('uses the nonced marker when a nonce is provided', () => {
      const output = formatFoldOutput({
        model: 'test', sessionId: 'x', summary: 'hi', nonce: NONCE
      });
      expect(output).toContain(NONCED_MARKER);
      expect(output).not.toContain('[SIDECAR_FOLD]');
    });

    it('throws when no nonce is provided (v4.0 §9 — bare-writer fallback retired)', () => {
      expect(() => formatFoldOutput({ model: 'test', sessionId: 'x', summary: 'hi' }))
        .toThrow(/requires a per-run nonce/);
    });
  });

  describe('DEFAULT_TIMEOUT', () => {
    it('should be 15 minutes per spec §6.2', () => {
      expect(DEFAULT_TIMEOUT).toBe(15 * 60 * 1000);
    });
  });

  describe('Session Abort', () => {
    const testProject = '/test/project';
    const testModel = 'openrouter/google/gemini-2.5-flash';
    const testSystemPrompt = '# Test system prompt';
    const testUserMessage = 'Please complete the task';
    const testTaskId = 'abort123';

    beforeEach(() => {
      mockCheckHealth.mockResolvedValue(true);
      mockCreateSession.mockResolvedValue('session-123');
      mockSendPromptAsync.mockResolvedValue(undefined);
    });

    it('should set timedOut flag when timeout is reached', async () => {
      // Never complete — timeout should trigger
      mockGetMessages.mockResolvedValue([{
        info: { role: 'assistant', id: 'msg-1', time: {} },
        parts: [{ id: 'p1', type: 'text', text: 'Still working...' }]
      }]);

      const result = await runHeadless(
        testModel, testSystemPrompt, testUserMessage, testTaskId, testProject,
        3000 // Very short timeout
      );

      expect(result.timedOut).toBe(true);
      expect(mockServerClose).toHaveBeenCalled();
    }, 10000);

    it('should check for external abort signal in metadata', async () => {
      // First poll: normal. Second poll: metadata says aborted.
      let pollCount = 0;
      mockGetMessages.mockImplementation(() => {
        pollCount++;
        return Promise.resolve([{
          info: { role: 'assistant', id: 'msg-1', time: {} },
          parts: [{ id: 'p1', type: 'text', text: 'Working...' }]
        }]);
      });

      // On second poll, simulate metadata.status = 'aborted'
      const originalReadFileSync = fs.readFileSync;
      fs.readFileSync = jest.fn((filePath, _encoding) => {
        if (typeof filePath === 'string' && filePath.includes('metadata.json') && pollCount >= 2) {
          return JSON.stringify({ status: 'aborted' });
        }
        // For other reads, return empty string
        return '';
      });

      // existsSync should return true for metadata check
      fs.existsSync.mockImplementation((p) => {
        if (typeof p === 'string' && p.includes('metadata.json')) {
          return pollCount >= 2;
        }
        return true;
      });

      const result = await runHeadless(
        testModel, testSystemPrompt, testUserMessage, testTaskId, testProject,
        30000 // Long timeout — abort should happen before this
      );

      // Should have detected external abort
      expect(result.aborted).toBe(true);
      expect(mockServerClose).toHaveBeenCalled();

      // Restore
      fs.readFileSync = originalReadFileSync;
    }, 15000);

    it('does not hang when getMessages never resolves — dies at --timeout', async () => {
      // getMessages hangs forever. Without a per-call timeout the loop would
      // freeze on the await and never re-check the deadline. Driven with fake
      // timers so termination is deterministic regardless of CI runner speed —
      // a real-elapsed-time bound flakes badly on starved macOS/Windows runners
      // (the headless suite runs ~3 min, and timers get delayed past any bound).
      jest.useFakeTimers();
      try {
        mockGetMessages.mockImplementation(() => new Promise(() => {}));

        const p = runHeadless(
          testModel, testSystemPrompt, testUserMessage, testTaskId, testProject,
          300, // 300ms --timeout (deadline in fake-clock terms)
          'build', { pollIntervalMs: 5, pollCallTimeoutMs: 50 }
        );
        // Advance fake time well past the 300ms deadline; the async variant flushes
        // microtasks between timer fires so the poll loop progresses to termination.
        await jest.advanceTimersByTimeAsync(2000);
        const result = await p;

        expect(result.timedOut).toBe(true);
        expect(mockAbortSession).toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    }, 10000); // real-time safety net only; a true forever-hang trips this
  });

  describe('Progress Updates', () => {
    const testProject = '/test/project';
    const testModel = 'openrouter/google/gemini-2.5-flash';
    const testSystemPrompt = '# Test system prompt';
    const testUserMessage = 'Please complete the task';
    const testTaskId = 'progress1';

    beforeEach(() => {
      mockCheckHealth.mockResolvedValue(true);
      mockCreateSession.mockResolvedValue('session-123');
      mockSendPromptAsync.mockResolvedValue(undefined);
      mockGetMessages.mockResolvedValue([{
        info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
        parts: [{ type: 'text', text: NONCED_MARKER }]
      }]);
    });

    it('should write progress updates to progress.json at lifecycle stages', async () => {
      await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 5000);

      // Verify writeFileSync was called with progress.json content
      const progressWrites = fs.writeFileSync.mock.calls.filter(call =>
        typeof call[0] === 'string' && call[0].includes('progress.json')
      );

      // Should have at least 3 progress updates:
      // initializing, server_ready/session_created, prompt_sent
      expect(progressWrites.length).toBeGreaterThanOrEqual(3);

      // Check that stages were written in order
      const stages = progressWrites.map(call => JSON.parse(call[1]).stage);
      expect(stages).toContain('initializing');
      expect(stages).toContain('prompt_sent');
    });

    it('should write receiving stage when first assistant text is detected', async () => {
      // First poll: model starts producing text
      mockGetMessages
        .mockResolvedValueOnce([{
          info: { role: 'assistant', id: 'msg-1', time: {} },
          parts: [{ id: 'p1', type: 'text', text: 'Working on it...' }]
        }])
        .mockResolvedValueOnce([{
          info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
          parts: [{ id: 'p1', type: 'text', text: `Working on it... Done\n${NONCED_MARKER}` }]
        }]);

      await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 15000);

      const progressWrites = fs.writeFileSync.mock.calls.filter(call =>
        typeof call[0] === 'string' && call[0].includes('progress.json')
      );

      const stages = progressWrites.map(call => JSON.parse(call[1]).stage);
      expect(stages).toContain('receiving');
    }, 20000);

    it('should write receiving stage when tool_use is detected (no text yet)', async () => {
      // First poll: model makes a tool call, no text yet
      mockGetMessages
        .mockResolvedValueOnce([{
          info: { role: 'assistant', id: 'msg-1', time: {} },
          parts: [
            { id: 'tool-1', type: 'tool_use', name: 'web_search', input: { query: 'test' } }
          ]
        }])
        .mockResolvedValueOnce([{
          info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
          parts: [
            { id: 'tool-1', type: 'tool_use', name: 'web_search', input: { query: 'test' } },
            { id: 'p1', type: 'text', text: `Search results found\n${NONCED_MARKER}` }
          ]
        }]);

      await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 15000);

      const progressWrites = fs.writeFileSync.mock.calls.filter(call =>
        typeof call[0] === 'string' && call[0].includes('progress.json')
      );

      const stages = progressWrites.map(call => JSON.parse(call[1]).stage);
      expect(stages).toContain('receiving');

      // Should include tool name in the progress data
      const receivingWrite = progressWrites.find(call =>
        JSON.parse(call[1]).stage === 'receiving'
      );
      if (receivingWrite) {
        const data = JSON.parse(receivingWrite[1]);
        expect(data.latestTool).toBe('web_search');
      }
    }, 20000);

    it('should update progress with latest tool name on each new tool call', async () => {
      // Multiple tool calls across polls
      mockGetMessages
        .mockResolvedValueOnce([{
          info: { role: 'assistant', id: 'msg-1', time: {} },
          parts: [
            { id: 'tool-1', type: 'tool_use', name: 'web_search', input: { query: 'test' } }
          ]
        }])
        .mockResolvedValueOnce([{
          info: { role: 'assistant', id: 'msg-1', time: {} },
          parts: [
            { id: 'tool-1', type: 'tool_use', name: 'web_search', input: { query: 'test' } },
            { id: 'tool-2', type: 'tool_use', name: 'Read', input: { path: '/tmp/x' } }
          ]
        }])
        .mockResolvedValueOnce([{
          info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
          parts: [
            { id: 'tool-1', type: 'tool_use', name: 'web_search', input: { query: 'test' } },
            { id: 'tool-2', type: 'tool_use', name: 'Read', input: { path: '/tmp/x' } },
            { id: 'p1', type: 'text', text: `Done\n${NONCED_MARKER}` }
          ]
        }]);

      await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 15000);

      const progressWrites = fs.writeFileSync.mock.calls.filter(call =>
        typeof call[0] === 'string' && call[0].includes('progress.json')
      );

      // Find all receiving writes
      const receivingWrites = progressWrites.filter(call =>
        JSON.parse(call[1]).stage === 'receiving'
      );

      // Should have updated at least twice (one for each new tool)
      expect(receivingWrites.length).toBeGreaterThanOrEqual(2);

      // Last receiving write should have the latest tool name
      const lastReceiving = JSON.parse(receivingWrites[receivingWrites.length - 1][1]);
      expect(lastReceiving.latestTool).toBe('Read');
    }, 25000);

    it('should include messagesReceived count in receiving stage', async () => {
      mockGetMessages.mockResolvedValue([{
        info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
        parts: [{ id: 'p1', type: 'text', text: `Response text\n${NONCED_MARKER}` }]
      }]);

      await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 5000);

      const progressWrites = fs.writeFileSync.mock.calls.filter(call =>
        typeof call[0] === 'string' && call[0].includes('progress.json')
      );

      const receivingWrites = progressWrites.filter(call =>
        JSON.parse(call[1]).stage === 'receiving'
      );

      if (receivingWrites.length > 0) {
        const data = JSON.parse(receivingWrites[receivingWrites.length - 1][1]);
        expect(data.messagesReceived).toBeGreaterThanOrEqual(1);
      }
    });
  });

  describe('Polling Behavior', () => {
    const testProject = '/test/project';
    const testModel = 'openrouter/google/gemini-2.5-flash';
    const testSystemPrompt = '# Test system prompt';
    const testUserMessage = 'Please complete the task';
    const testTaskId = 'poll12345';

    beforeEach(() => {
      mockCheckHealth.mockResolvedValue(true);
      mockCreateSession.mockResolvedValue('session-123');
      mockSendPromptAsync.mockResolvedValue(undefined);
    });

    it('should capture streaming text incrementally (no duplication)', async () => {
      // Simulate text growing between polls (same part, increasing length)
      mockGetMessages
        .mockResolvedValueOnce([{
          info: { role: 'assistant', id: 'msg-1', time: {} },
          parts: [{ id: 'p1', type: 'text', text: 'Hello' }]
        }])
        .mockResolvedValueOnce([{
          info: { role: 'assistant', id: 'msg-1', time: {} },
          parts: [{ id: 'p1', type: 'text', text: 'Hello world' }]
        }])
        .mockResolvedValueOnce([{
          info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
          parts: [{ id: 'p1', type: 'text', text: `Hello world done\n${NONCED_MARKER}` }]
        }]);

      const result = await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 15000);

      // Output should be "Hello world done" — not "HelloHello worldHello world done"
      expect(result.summary).toBe('Hello world done');
    }, 20000);

    it('should only finish when the LAST assistant message is complete', async () => {
      // Two assistant messages: first is finished, second still streaming
      mockGetMessages
        .mockResolvedValueOnce([
          {
            info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
            parts: [{ id: 'p1', type: 'text', text: 'First response done' }]
          },
          {
            info: { role: 'assistant', id: 'msg-2', time: {} },
            parts: [{ id: 'p2', type: 'text', text: 'Still working...' }]
          }
        ])
        .mockResolvedValueOnce([
          {
            info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
            parts: [{ id: 'p1', type: 'text', text: 'First response done' }]
          },
          {
            info: { role: 'assistant', id: 'msg-2', time: { completed: Date.now() } },
            parts: [{ id: 'p2', type: 'text', text: `Still working... Done\n${NONCED_MARKER}` }]
          }
        ]);

      const result = await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 15000);
      expect(result.summary).toContain('Done');
    }, 20000);

    it('should exclude user message parts from output', async () => {
      mockGetMessages.mockResolvedValue([
        {
          info: { role: 'user', id: 'msg-u1', time: {} },
          parts: [{ id: 'pu1', type: 'text', text: 'USER TEXT SHOULD NOT APPEAR' }]
        },
        {
          info: { role: 'assistant', id: 'msg-a1', time: { completed: Date.now() } },
          parts: [{ id: 'pa1', type: 'text', text: `Assistant output\n${NONCED_MARKER}` }]
        }
      ]);

      const result = await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 10000);
      expect(result.summary).not.toContain('USER TEXT SHOULD NOT APPEAR');
      expect(result.summary).toContain('Assistant output');
    }, 15000);

    it('should handle tool part type same as tool_use', async () => {
      mockGetMessages.mockResolvedValue([{
        info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
        parts: [
          { id: 'tool-1', type: 'tool', name: 'Read', input: { path: '/test.js' } },
          { id: 'p1', type: 'text', text: `Found file\n${NONCED_MARKER}` }
        ]
      }]);

      const result = await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 10000);
      expect(result.toolCalls).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: 'Read' })])
      );
    }, 15000);

    it('should NOT trigger fold for inline [SIDECAR_FOLD] in prose', async () => {
      // First poll has FOLD inline (not on its own line) — should NOT trigger
      mockGetMessages
        .mockResolvedValueOnce([{
          info: { role: 'assistant', id: 'msg-1', time: {} },
          parts: [{ id: 'p1', type: 'text', text: 'The function splits on [SIDECAR_FOLD] marker' }]
        }])
        // Second poll: same output, assistant finishes (stablePolls kicks in)
        .mockResolvedValueOnce([{
          info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
          parts: [{ id: 'p1', type: 'text', text: 'The function splits on [SIDECAR_FOLD] marker' }]
        }])
        .mockResolvedValue([{
          info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
          parts: [{ id: 'p1', type: 'text', text: 'The function splits on [SIDECAR_FOLD] marker' }]
        }]);

      const result = await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 15000);
      // Ended via the stablePolls idle fallback — a genuine completion signal.
      expect(result.completed).toBe(true);
      // The inline marker was NOT treated as a fold delimiter: it survives in the summary.
      expect(result.summary).toContain('[SIDECAR_FOLD]');
    }, 25000);

    it('should trigger fold when the nonced marker is on its own line', async () => {
      mockGetMessages.mockResolvedValue([{
        info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
        parts: [{ id: 'p1', type: 'text', text: `Summary content\n${NONCED_MARKER}` }]
      }]);

      const result = await runHeadless(
        testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 10000, 'build', withNonce()
      );
      expect(result.completed).toBe(true);
      expect(result.summary).toBe('Summary content');
    }, 15000);

    // #BL-7 CORE SECURITY PROPERTY: a bare [SIDECAR_FOLD] emitted on its own
    // line but followed by MORE content (echoing these instructions, a prior
    // sidecar summary, or scraped text) must NOT trigger a premature fold — the
    // model is still working. Only a marker that is the FINAL non-empty line folds.
    it('does NOT fold on a standalone [SIDECAR_FOLD] that is followed by more content (#BL-7)', async () => {
      const echoed = 'To finish I would emit:\n[SIDECAR_FOLD]\n...but I am not done yet, continuing analysis';
      mockGetMessages.mockResolvedValue([{
        info: { role: 'assistant', id: 'msg-1', time: {} },
        parts: [{ id: 'p1', type: 'text', text: echoed }]
      }]);

      const result = await runHeadless(
        testModel, testSystemPrompt, testUserMessage, testTaskId, testProject,
        30000, 'build', { pollIntervalMs: 5, stableIdlePolls: 3 }
      );
      // Ended via the idle fallback (a genuine completion), NOT the fold marker:
      // the echoed marker is preserved as content, never treated as a delimiter.
      expect(result.completed).toBe(true);
      expect(result.summary).toContain('[SIDECAR_FOLD]');
      expect(result.summary).toContain('continuing analysis');
    }, 20000);

    it('DOES fold once the nonced marker becomes the final non-empty line (#BL-7)', async () => {
      // Same content, but the model has now genuinely finished — marker is last.
      mockGetMessages.mockResolvedValue([{
        info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
        parts: [{ id: 'p1', type: 'text', text: `All analysis complete.\n${NONCED_MARKER}\n` }]
      }]);

      const result = await runHeadless(
        testModel, testSystemPrompt, testUserMessage, testTaskId, testProject,
        10000, 'build', withNonce({ pollIntervalMs: 5 })
      );
      expect(result.completed).toBe(true);
      expect(result.summary).toBe('All analysis complete.');
    }, 15000);

    // 15b.3 — per-run fold nonce (BL-7 residual): the bare [SIDECAR_FOLD]
    // marker used to be sufficient to fold ANY run. That means model output
    // that merely REPRODUCES the bare marker (e.g. because it read these very
    // instructions, or a doc, or another run's transcript) could force a
    // premature completion even once it's pinned to the final line. A per-run
    // nonce closes that: only the marker THIS run's prompt actually asked for
    // completes THIS run.
    describe('per-run fold nonce (15b.3, #BL-7 residual)', () => {
      it('does NOT complete on a bare [SIDECAR_FOLD] (no nonce) when the run has a configured nonce', async () => {
        mockGetMessages.mockResolvedValue([{
          info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
          parts: [{ id: 'p1', type: 'text', text: 'All analysis complete.\n[SIDECAR_FOLD]\n' }]
        }]);

        const result = await runHeadless(
          testModel, testSystemPrompt, testUserMessage, testTaskId, testProject,
          30000, 'build', { pollIntervalMs: 5, stableIdlePolls: 3, nonce: 'expectedNonce123' }
        );
        // Never sees ITS nonce — must NOT fold on the bare marker. It ends via
        // the idle fallback instead (a genuine completion, not a fold-marker one).
        expect(result.completed).toBe(true);
        expect(result.summary).toContain('[SIDECAR_FOLD]');
      });

      it('does NOT complete when the output carries the WRONG nonce', async () => {
        mockGetMessages.mockResolvedValue([{
          info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
          parts: [{ id: 'p1', type: 'text', text: 'All analysis complete.\n[SIDECAR_FOLD:wrongnonce999]\n' }]
        }]);

        const result = await runHeadless(
          testModel, testSystemPrompt, testUserMessage, testTaskId, testProject,
          30000, 'build', { pollIntervalMs: 5, stableIdlePolls: 3, nonce: 'expectedNonce123' }
        );
        expect(result.completed).toBe(true); // via idle fallback, not the fold branch
        expect(result.summary).toContain('[SIDECAR_FOLD:wrongnonce999]');
      });

      it('DOES complete when the output carries the CORRECT nonce as the final line', async () => {
        mockGetMessages.mockResolvedValue([{
          info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
          parts: [{ id: 'p1', type: 'text', text: 'All analysis complete.\n[SIDECAR_FOLD:expectedNonce123]\n' }]
        }]);

        const result = await runHeadless(
          testModel, testSystemPrompt, testUserMessage, testTaskId, testProject,
          10000, 'build', { pollIntervalMs: 5, nonce: 'expectedNonce123' }
        );
        expect(result.completed).toBe(true);
        expect(result.summary).toBe('All analysis complete.');
      });
    });

    it('completes via the idle fallback after stableIdlePolls without assistantFinished', async () => {
      const stableMessage = [{
        info: { role: 'assistant', id: 'msg-1', time: {} },
        parts: [{ id: 'p1', type: 'text', text: 'Final output' }]
      }];
      mockGetMessages.mockResolvedValue(stableMessage);
      const result = await runHeadless(
        testModel, testSystemPrompt, testUserMessage, testTaskId, testProject,
        30000, 'build', { pollIntervalMs: 5, stableIdlePolls: 4 }
      );
      expect(result.summary).toBe('Final output');
    });

    it('should NOT exit early when model has not started generating yet', async () => {
      // Simulate slow model startup: first 3 polls return empty messages,
      // then assistant message appears. Before the fix, stablePolls would
      // increment during the empty polls and exit after 4, before the model
      // even started.
      let callCount = 0;
      mockGetMessages.mockImplementation(() => {
        callCount++;
        if (callCount <= 3) {
          // Model still loading — no assistant message yet
          return Promise.resolve([]);
        }
        // Model responds on poll 4
        return Promise.resolve([{
          info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
          parts: [{ id: 'p1', type: 'text', text: 'Delayed response' }]
        }]);
      });

      const result = await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 30000);
      expect(result.summary).toBe('Delayed response');
      // Must have polled at least 4 times (3 empty + 1 with response + 2 stable)
      expect(callCount).toBeGreaterThanOrEqual(4);
    }, 35000);

    it('should NOT exit early when assistant message exists but has no output', async () => {
      // The SDK creates an empty assistant message placeholder immediately
      // when promptAsync is called. This message has a non-null ID but no
      // text parts. Without the output.length > 0 guard, stablePolls would
      // count these empty polls and exit after 4.
      let callCount = 0;
      mockGetMessages.mockImplementation(() => {
        callCount++;
        if (callCount <= 4) {
          // SDK placeholder: assistant message exists but has no text parts
          return Promise.resolve([{
            info: { role: 'assistant', id: 'msg-placeholder', time: {} },
            parts: []
          }]);
        }
        // Model actually responds on poll 5
        return Promise.resolve([{
          info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
          parts: [{ id: 'p1', type: 'text', text: 'Real response' }]
        }]);
      });

      const result = await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 30000);
      expect(result.summary).toBe('Real response');
      expect(callCount).toBeGreaterThanOrEqual(5);
    }, 35000);

    it('should propagate session error when model returns error with no output', async () => {
      // Simulate model error: assistant message has error info, time.completed,
      // but no text parts. This happens when API key is invalid, model not found, etc.
      mockGetMessages.mockResolvedValue([{
        info: {
          role: 'assistant',
          id: 'msg-err-1',
          time: { completed: Date.now() },
          error: { name: 'ModelError', data: { message: 'API key invalid' } }
        },
        parts: []
      }]);

      const result = await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 30000);
      expect(result.error).toBe('API key invalid');
      expect(result.completed).toBe(false);
      expect(result.summary).toBe('');
    }, 15000);

    it('surfaces a 402 provider error even when NO assistant message is emitted (#37)', async () => {
      // 402 at the client boundary: sendPromptAsync reports providerError, but the
      // server emits no assistant message (getMessages stays empty). Without the
      // boundary detection this run would look idle/empty rather than errored.
      mockSendPromptAsync.mockResolvedValue({
        response: { status: 402 },
        error: { message: 'Payment Required' },
        providerError: 'Insufficient credits',
      });
      mockGetMessages.mockResolvedValue([]);

      const result = await runHeadless(
        testModel, testSystemPrompt, testUserMessage, testTaskId, testProject,
        30000, 'build', { pollIntervalMs: 5 }
      );
      expect(result.completed).toBe(false);
      expect(result.error).toBe('Insufficient credits');
      expect(result.summary).toBe('');
    }, 15000);

    it('still completes normally when a benign assistant warning is present (no regression)', async () => {
      // sendPromptAsync returns a benign informational error (no non-2xx status) →
      // no providerError → the loop must "continue to poll" and complete normally.
      mockSendPromptAsync.mockResolvedValue({
        response: { status: 200 },
        error: { message: 'informational model warning' },
      });
      mockGetMessages.mockResolvedValue([{
        info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
        parts: [{ id: 'p1', type: 'text', text: `All good\n${NONCED_MARKER}` }]
      }]);

      const result = await runHeadless(
        testModel, testSystemPrompt, testUserMessage, testTaskId, testProject,
        30000, 'build', { pollIntervalMs: 5 }
      );
      expect(result.completed).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.summary).toBe('All good');
    }, 15000);

    it('should reset stablePolls when output grows', async () => {
      // Simulate streaming: same part ID, text grows each poll then stabilizes
      let callCount = 0;
      const textStages = ['A', 'AB', 'ABC', 'ABC', 'ABC', 'ABC', 'ABC', 'ABC', 'ABC'];
      mockGetMessages.mockImplementation(() => {
        callCount++;
        const text = textStages[Math.min(callCount - 1, textStages.length - 1)];
        return Promise.resolve([{
          info: { role: 'assistant', id: 'msg-1', time: {} },
          parts: [{ id: 'p1', type: 'text', text }]
        }]);
      });

      const result = await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 30000);
      // Output should be "ABC" (incremental: "A" + "B" + "C")
      expect(result.summary).toBe('ABC');
      // Polls: 1(A), 2(AB), 3(ABC), then 4 stable polls needed → at least 7
      expect(callCount).toBeGreaterThanOrEqual(7);
    }, 35000);

    it('honors an injected poll interval (fast path)', async () => {
      mockGetMessages.mockResolvedValue([{
        info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
        parts: [{ id: 'p1', type: 'text', text: `Quick\n${NONCED_MARKER}` }]
      }]);
      const start = Date.now();
      const result = await runHeadless(
        testModel, testSystemPrompt, testUserMessage, testTaskId, testProject,
        30000, 'build', { pollIntervalMs: 5 }
      );
      expect(result.completed).toBe(true);
      expect(Date.now() - start).toBeLessThan(1000); // 5ms polls, not 2000ms
    });

    it('does NOT exit during a quiet tool-call gap longer than the old 4-poll threshold', async () => {
      const running = {
        info: { role: 'assistant', id: 'msg-1', time: {} },
        parts: [
          { id: 't1', type: 'tool_use', name: 'Read', input: { path: '/big' } },
          { id: 'p1', type: 'text', text: 'Reading the file' }
        ]
      };
      const done = {
        info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
        parts: [
          { id: 't1', type: 'tool_use', name: 'Read', input: { path: '/big' } },
          { id: 'p1', type: 'text', text: `Reading the file... done\n${NONCED_MARKER}` }
        ]
      };
      let n = 0;
      mockGetMessages.mockImplementation(() => {
        n++;
        return Promise.resolve(n >= 8 ? [done] : [running]);
      });
      const result = await runHeadless(
        testModel, testSystemPrompt, testUserMessage, testTaskId, testProject,
        30000, 'build', { pollIntervalMs: 5, stableIdlePolls: 20 }
      );
      expect(result.completed).toBe(true);
      expect(result.summary).toContain('done');
      expect(n).toBeGreaterThanOrEqual(8);
    });

    it('treats new tool calls/results as activity (resets the idle counter)', async () => {
      const seq = [
        [{ info: { role: 'assistant', id: 'm1', time: {} }, parts: [
          { id: 'x', type: 'text', text: 'go' }, { id: 't1', type: 'tool_use', name: 'A', input: {} }] }],
        [{ info: { role: 'assistant', id: 'm1', time: {} }, parts: [
          { id: 'x', type: 'text', text: 'go' }, { id: 't1', type: 'tool_use', name: 'A', input: {} },
          { id: 'r1', type: 'tool_result', tool_use_id: 't1', content: 'ok' }] }],
        [{ info: { role: 'assistant', id: 'm1', time: {} }, parts: [
          { id: 'x', type: 'text', text: 'go' }, { id: 't1', type: 'tool_use', name: 'A', input: {} },
          { id: 'r1', type: 'tool_result', tool_use_id: 't1', content: 'ok' },
          { id: 't2', type: 'tool_use', name: 'B', input: {} }] }],
        [{ info: { role: 'assistant', id: 'm1', time: { completed: Date.now() } }, parts: [
          { id: 'x', type: 'text', text: `go done\n${NONCED_MARKER}` }] }],
      ];
      let n = 0;
      mockGetMessages.mockImplementation(() => Promise.resolve(seq[Math.min(n++, seq.length - 1)]));
      const result = await runHeadless(
        testModel, testSystemPrompt, testUserMessage, testTaskId, testProject,
        30000, 'build', { pollIntervalMs: 5, stableIdlePolls: 2 }
      );
      expect(result.completed).toBe(true);
    });

    it('completes when the SDK reports the session idle (with output present)', async () => {
      mockGetSessionStatus.mockResolvedValue({ type: 'idle' });
      // Output present, but NO fold marker and NO time.completed — only the SDK idle signal can end it.
      mockGetMessages.mockResolvedValue([{
        info: { role: 'assistant', id: 'm1', time: {} },
        parts: [{ id: 'p1', type: 'text', text: 'All done, no fold marker' }]
      }]);
      const result = await runHeadless(
        testModel, testSystemPrompt, testUserMessage, testTaskId, testProject,
        30000, 'build', { pollIntervalMs: 5, stableIdlePolls: 100000 } // huge, so ONLY status can end it
      );
      expect(result.summary).toContain('All done');
    });

    it('does NOT complete on idle before any output exists', async () => {
      // Idle reported immediately, but no output on the first polls → must NOT end early.
      mockGetSessionStatus.mockResolvedValue({ type: 'idle' });
      let n = 0;
      mockGetMessages.mockImplementation(() => {
        n++;
        if (n < 3) { return Promise.resolve([]); } // no messages yet
        return Promise.resolve([{
          info: { role: 'assistant', id: 'm1', time: { completed: Date.now() } },
          parts: [{ id: 'p1', type: 'text', text: `Real output\n${NONCED_MARKER}` }]
        }]);
      });
      const result = await runHeadless(
        testModel, testSystemPrompt, testUserMessage, testTaskId, testProject,
        30000, 'build', { pollIntervalMs: 5 }
      );
      expect(result.summary).toContain('Real output');
      expect(n).toBeGreaterThanOrEqual(3);
    });
  });
});
