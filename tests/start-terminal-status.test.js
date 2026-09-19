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

  // #218 PR 3 whole-branch review: an OUTPUT_LENGTH death resolves to
  // `status: 'error'`, so start.js takes the branch that writes metadata.json
  // directly and never calls finalizeSession — the branch Task 4 left without a
  // `finish` stamp. Named mutant "SOLOERRORNOFINISH" (delete the `meta.finish`
  // line from that branch in start.js/continue.js/resume.js).
  it("an OUTPUT_LENGTH result → metadata status \"error\", an OUTPUT_LENGTH: reason and finish 'length'", async () => {
    const { code, metadata } = await runWith({
      completed: false, timedOut: false, aborted: false, summary: '', taskId: 'test05',
      finish: 'length',
      error: "OUTPUT_LENGTH: the provider stopped at the max_tokens reservation (finish 'length') and no answer text arrived — 32000 reasoning / 0 output tokens; outputBudget is unset — the engine's 32000 default reservation governs — raise outputBudget in config.json (docs/configuration.md, Output budget)",
    });
    expect(code).toBe(1);
    expect(metadata.status).toBe('error');
    expect(metadata.reason.startsWith('OUTPUT_LENGTH:')).toBe(true);
    expect(metadata.finish).toBe('length'); // SOLOERRORNOFINISH
  });

  it('a completed result with no finish leaves the key off metadata (emit-when-set)', async () => {
    const { metadata } = await runWith({
      completed: true, timedOut: false, aborted: false, summary: 'done', taskId: 'test06'
    });
    expect(metadata.status).toBe('complete');
    expect('finish' in metadata).toBe(false);
  });

  // #251 item 1: a NO_OUTPUT_BACKSTOP death resolves to `status: 'error'` too, so it
  // takes the same branch as OUTPUT_LENGTH above — the one that writes metadata.json
  // directly and never calls finalizeSession.
  it('a NO_OUTPUT_BACKSTOP result stamps the backstop record on metadata (#251 item 1)', async () => {
    // Named mutant "SOLOERRORNOBACKSTOP": drop the `stampBackstop(meta, result)` line from start.js's error branch.
    const REC = { windowMs: 480000, firedAtMs: 480722, status: 'busy', extended: true, extendedToMs: 912000 };
    const { code, metadata } = await runWith({
      completed: false, timedOut: false, aborted: false, summary: '', taskId: 'test0b1',
      error: 'NO_OUTPUT_BACKSTOP: no output in 912s — window extended once from 480s to 912s at 481s on session busy',
      backstop: REC,
    });
    expect(code).toBe(1);
    expect(metadata.status).toBe('error');
    expect(metadata.backstop).toEqual(REC); // SOLOERRORNOBACKSTOP
  });

  it('a completed result with no backstop leaves the key off metadata (emit-when-set)', async () => {
    // Named mutant "SOLOBACKSTOPCOERCED": in session-utils.js :: finalizeSession, `metadata.backstop = opts.backstop || null;` — the key appears as null here.
    const { metadata } = await runWith({
      completed: true, timedOut: false, aborted: false, summary: 'done', taskId: 'test0b2'
    });
    expect(metadata.status).toBe('complete');
    expect('backstop' in metadata).toBe(false);
  });

  // #218 PR 4: variant/variantUnverified ride the same error branch as finish.
  // Named mutant "SOLOERRORNOVARIANT" (delete the `meta.variant` / `meta.variantUnverified`
  // lines from start.js's error branch).
  it('an OUTPUT_LENGTH result carrying variant stamps it beside finish on the error branch (#218 PR 4)', async () => {
    const { code, metadata } = await runWith({
      completed: false, timedOut: false, aborted: false, summary: '', taskId: 'test07',
      finish: 'length', variant: 'high', variantUnverified: true,
      error: "OUTPUT_LENGTH: the provider stopped at the max_tokens reservation (finish 'length') and no answer text arrived — 32000 reasoning / 0 output tokens; outputBudget is unset — the engine's 32000 default reservation governs — raise outputBudget in config.json (docs/configuration.md, Output budget)",
    });
    expect(code).toBe(1);
    expect(metadata.status).toBe('error');
    expect(metadata.finish).toBe('length');
    expect(metadata.variant).toBe('high'); // SOLOERRORNOVARIANT
    expect(metadata.variantUnverified).toBe(true); // SOLOERRORNOVARIANT
  });

  it('a completed result carrying variant reaches metadata through finalizeSession', async () => {
    const { metadata } = await runWith({
      completed: true, timedOut: false, aborted: false, summary: 'done', taskId: 'test08', variant: 'low', promoted: true,
    });
    expect(metadata.status).toBe('complete');
    expect(metadata.variant).toBe('low');
    expect('variantUnverified' in metadata).toBe(false);
    // #257: `promoted` rides the same opts passthrough as variant. Named mutant
    // "STARTPROMOTEDDROPPED": drop `promoted` from start.js's finalizeSession opts.
    expect(metadata.promoted).toBe(true);
  });

  // #257 / spec R12: a death never carries the fact. The engine's promoted-reasoning
  // answer IS a usable deliverable, so the failed-with-no-usable-output return never
  // emits it — and start.js's direct error-branch metadata writer therefore learns no
  // key at all. Named mutant "ERRORPROMOTED": add
  // `...(result && result.promoted ? { promoted: true } : {})` to that literal.
  it('an ERROR result carrying promoted: true stamps NO promoted on metadata (spec R12)', async () => {
    const { code, metadata } = await runWith({
      completed: false, timedOut: false, aborted: false, summary: '', taskId: 'test09',
      promoted: true, error: 'connection reset',
    });
    expect(code).toBe(1);
    expect(metadata.status).toBe('error');
    expect('promoted' in metadata).toBe(false);
  });
});
