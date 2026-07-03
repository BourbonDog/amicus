'use strict';

/**
 * Tests for start.js terminal-state classification + exit code propagation.
 * Mocks runHeadless to simulate each outcome; asserts metadata.status and returned exit code.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// Mock opencode-client — must be declared before any require of start.js
const mockServerClose = jest.fn();
jest.mock('../src/opencode-client', () => ({
  createClient: jest.fn().mockReturnValue({}),
  createSession: jest.fn().mockResolvedValue('mock-session-id'),
  sendPrompt: jest.fn().mockResolvedValue(undefined),
  sendPromptAsync: jest.fn().mockResolvedValue(undefined),
  getMessages: jest.fn().mockResolvedValue([]),
  checkHealth: jest.fn().mockResolvedValue(true),
  startServer: jest.fn().mockResolvedValue({
    client: {},
    server: { url: 'http://127.0.0.1:4440', close: mockServerClose }
  }),
  loadMcpConfig: jest.fn().mockReturnValue(null),
  parseMcpSpec: jest.fn().mockReturnValue(null)
}));

jest.mock('../src/utils/logger', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn()
  }
}));

// Mock headless — we inject results per test
jest.mock('../src/headless', () => ({
  runHeadless: jest.fn(),
  FOLD_MARKER: '[SIDECAR_FOLD]',
  COMPLETE_MARKER: '[SIDECAR_FOLD]',
  extractSummary: jest.fn((text) => text || ''),
  DEFAULT_TIMEOUT: 900,
}));

const { runHeadless } = require('../src/headless');
const { startAmicus } = require('../src/index');

// Redirect os.homedir so session dirs land under our temp tree
const originalHomedir = os.homedir;
let mockHomeDir;
jest.spyOn(os, 'homedir').mockImplementation(() => mockHomeDir || originalHomedir());

describe('start.js terminal state classification', () => {
  let projectDir;

  beforeEach(() => {
    jest.clearAllMocks();
    const tmp = os.tmpdir();
    projectDir = fs.mkdtempSync(path.join(tmp, 'amicus-start-'));
    mockHomeDir = fs.mkdtempSync(path.join(tmp, 'amicus-home-'));
  });

  afterEach(() => {
    mockHomeDir = null;
    if (fs.existsSync(projectDir)) {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });

  /** Helper: run startAmicus with injected runHeadless result, return {code, metadata} */
  async function runWith(headlessResult) {
    runHeadless.mockResolvedValue(headlessResult);
    // Suppress stdout/console noise
    const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation();
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    let code;
    try {
      code = await startAmicus({
        model: 'google/gemini-2.5-flash',
        briefing: 'test task',
        project: projectDir,
        headless: true,
        timeout: 5,
      });
    } finally {
      stdoutSpy.mockRestore();
      consoleSpy.mockRestore();
    }

    // Find the session dir
    const sessionsDir = path.join(projectDir, '.claude', 'amicus_sessions');
    const sessions = fs.existsSync(sessionsDir) ? fs.readdirSync(sessionsDir) : [];
    const sessionDir = sessions.length ? path.join(sessionsDir, sessions[0]) : null;
    const metadata = sessionDir
      ? JSON.parse(fs.readFileSync(path.join(sessionDir, 'metadata.json'), 'utf-8'))
      : null;

    return { code, metadata };
  }

  it('completed result → metadata status "complete" and exit code 0', async () => {
    const { code, metadata } = await runWith({
      completed: true, timedOut: false, aborted: false, summary: 'done', taskId: 'test01'
    });
    expect(code).toBe(0);
    expect(metadata.status).toBe('complete');
  });

  it('error result → metadata status "error" and exit code 1', async () => {
    const { code, metadata } = await runWith({
      completed: false, timedOut: false, aborted: false, error: 'Something went wrong', summary: '', taskId: 'test02'
    });
    expect(code).toBe(1);
    expect(metadata.status).toBe('error');
  });

  it('timed-out result → metadata status "timed-out" and exit code 2', async () => {
    const { code, metadata } = await runWith({
      completed: false, timedOut: true, aborted: false, summary: 'partial', taskId: 'test03'
    });
    expect(code).toBe(2);
    expect(metadata.status).toBe('timed-out');
  });

  it('aborted result → metadata status "aborted" and exit code 2', async () => {
    const { code, metadata } = await runWith({
      completed: false, timedOut: false, aborted: true, summary: '', taskId: 'test04'
    });
    expect(code).toBe(2);
    expect(metadata.status).toBe('aborted');
  });
});
