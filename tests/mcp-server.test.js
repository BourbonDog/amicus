/**
 * MCP Server Handler Tests
 *
 * Tests the tool handler implementations in src/mcp-server.js.
 * Each handler is tested directly (without starting the actual MCP server)
 * using the exported `handlers` object.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Tests that verify the args passed to the spawned CLI process.
 * Uses jest.isolateModulesAsync + jest.doMock to mock child_process per-test.
 * jest.doMock (unlike jest.mock) is not hoisted, so it can reference outer variables.
 */
describe('MCP spawn arg building', () => {
  test('amicus_start passes --task-id matching returned taskId', async () => {
    let capturedArgs;
    await jest.isolateModulesAsync(async () => {
      jest.doMock('child_process', () => ({
        spawn: jest.fn((cmd, args) => {
          capturedArgs = args;
          return { pid: 12345, unref: jest.fn(), stdout: { on: jest.fn() }, stderr: { on: jest.fn() } };
        }),
      }));
      const { handlers: h } = require('../src/mcp-server');
      const result = await h.amicus_start({ prompt: 'test task', noUi: true, model: 'google/gemini-test' }, '/tmp');
      const { taskId } = JSON.parse(result.content[0].text);
      const idx = capturedArgs.indexOf('--task-id');
      expect(idx).toBeGreaterThan(-1);
      expect(capturedArgs[idx + 1]).toBe(taskId);
    });
  });

  test('amicus_start auto-passes --client cowork', async () => {
    let capturedArgs;
    await jest.isolateModulesAsync(async () => {
      jest.doMock('child_process', () => ({
        spawn: jest.fn((cmd, args) => {
          capturedArgs = args;
          return { pid: 12345, unref: jest.fn(), stdout: { on: jest.fn() }, stderr: { on: jest.fn() } };
        }),
      }));
      const { handlers: h } = require('../src/mcp-server');
      await h.amicus_start({ prompt: 'test task', noUi: true, model: 'google/gemini-test' }, '/tmp');
      const idx = capturedArgs.indexOf('--client');
      expect(idx).toBeGreaterThan(-1);
      expect(capturedArgs[idx + 1]).toBe('cowork');
    });
  });

  test('amicus_start passes --session-id when parentSession is provided', async () => {
    let capturedArgs;
    await jest.isolateModulesAsync(async () => {
      jest.doMock('child_process', () => ({
        spawn: jest.fn((cmd, args) => {
          capturedArgs = args;
          return { pid: 12345, unref: jest.fn(), stdout: { on: jest.fn() }, stderr: { on: jest.fn() } };
        }),
      }));
      const { handlers: h } = require('../src/mcp-server');
      await h.amicus_start({ prompt: 'test task', noUi: true, model: 'google/gemini-test', parentSession: 'f58f2782-fc8c-41bc-afbc-e0c130b91aaf' }, '/tmp');
      const idx = capturedArgs.indexOf('--session-id');
      expect(idx).toBeGreaterThan(-1);
      expect(capturedArgs[idx + 1]).toBe('f58f2782-fc8c-41bc-afbc-e0c130b91aaf');
    });
  });

  test('amicus_start passes --timeout when provided', async () => {
    let capturedArgs;
    await jest.isolateModulesAsync(async () => {
      jest.doMock('child_process', () => ({
        spawn: jest.fn((cmd, args) => {
          capturedArgs = args;
          return { pid: 12345, unref: jest.fn(), stdout: { on: jest.fn() }, stderr: { on: jest.fn() } };
        }),
      }));
      const { handlers: h } = require('../src/mcp-server');
      await h.amicus_start({ prompt: 'test task', noUi: true, model: 'google/gemini-test', timeout: 30 }, '/tmp');
      const idx = capturedArgs.indexOf('--timeout');
      expect(idx).toBeGreaterThan(-1);
      expect(capturedArgs[idx + 1]).toBe('30');
    });
  });

  test('amicus_continue returns a NEW taskId, not the parent taskId', async () => {
    await jest.isolateModulesAsync(async () => {
      jest.doMock('child_process', () => ({
        spawn: jest.fn(() => ({
          pid: 12345, unref: jest.fn(),
          stdout: { on: jest.fn() }, stderr: { on: jest.fn() },
        })),
      }));
      const { handlers: h } = require('../src/mcp-server');
      const parentTaskId = 'parent123';
      const result = await h.amicus_continue(
        { taskId: parentTaskId, prompt: 'follow-up task', noUi: true }, '/tmp'
      );
      const { taskId } = JSON.parse(result.content[0].text);
      expect(taskId).not.toBe(parentTaskId);
      expect(taskId).toBeTruthy();
    });
  });

  test('amicus_continue passes --task-id matching the new returned taskId', async () => {
    let capturedArgs;
    await jest.isolateModulesAsync(async () => {
      jest.doMock('child_process', () => ({
        spawn: jest.fn((cmd, args) => {
          capturedArgs = args;
          return { pid: 12345, unref: jest.fn(), stdout: { on: jest.fn() }, stderr: { on: jest.fn() } };
        }),
      }));
      const { handlers: h } = require('../src/mcp-server');
      const result = await h.amicus_continue(
        { taskId: 'old-parent', prompt: 'new task', noUi: true }, '/tmp'
      );
      const { taskId: newTaskId } = JSON.parse(result.content[0].text);
      const idx = capturedArgs.indexOf('--task-id');
      expect(idx).toBeGreaterThan(-1);
      expect(capturedArgs[idx + 1]).toBe(newTaskId);
    });
  });
});

describe('BL-1: prompt goes via --prompt-file, never inline (Windows ~32KB cap)', () => {
  const bigPrompt = 'X'.repeat(40000); // exceeds the ~32KB command-line cap

  test('amicus_start writes briefing.md and spawns --prompt-file, not inline --prompt', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1-start-'));
    let capturedArgs;
    try {
      await jest.isolateModulesAsync(async () => {
        jest.doMock('child_process', () => ({
          spawn: jest.fn((cmd, args) => {
            capturedArgs = args;
            return { pid: 12345, unref: jest.fn(), stdout: { on: jest.fn() }, stderr: { on: jest.fn() } };
          }),
        }));
        // Disable the shared-server path so we exercise the spawn fallback.
        const prev = process.env.SIDECAR_SHARED_SERVER;
        process.env.SIDECAR_SHARED_SERVER = '0';
        try {
          const { handlers: h } = require('../src/mcp-server');
          const result = await h.amicus_start(
            { prompt: bigPrompt, noUi: true, model: 'google/gemini-test' }, tmpDir);
          const { taskId } = JSON.parse(result.content[0].text);

          // The spawn command line must NOT carry the prompt inline.
          expect(capturedArgs).not.toContain('--prompt');
          expect(capturedArgs).not.toContain(bigPrompt);

          // It must pass --prompt-file pointing at the session's briefing.md.
          const idx = capturedArgs.indexOf('--prompt-file');
          expect(idx).toBeGreaterThan(-1);
          const briefingPath = capturedArgs[idx + 1];
          expect(briefingPath).toContain(taskId);
          expect(briefingPath.endsWith('briefing.md')).toBe(true);

          // The prompt must be written to that file, in full.
          expect(fs.existsSync(briefingPath)).toBe(true);
          expect(fs.readFileSync(briefingPath, 'utf-8')).toBe(bigPrompt);
        } finally {
          if (prev === undefined) { delete process.env.SIDECAR_SHARED_SERVER; }
          else { process.env.SIDECAR_SHARED_SERVER = prev; }
        }
      });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('amicus_continue writes briefing.md and spawns --prompt-file, not inline --prompt', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1-cont-'));
    let capturedArgs;
    try {
      await jest.isolateModulesAsync(async () => {
        jest.doMock('child_process', () => ({
          spawn: jest.fn((cmd, args) => {
            capturedArgs = args;
            return { pid: 12345, unref: jest.fn(), stdout: { on: jest.fn() }, stderr: { on: jest.fn() } };
          }),
        }));
        const { handlers: h } = require('../src/mcp-server');
        const result = await h.amicus_continue(
          { taskId: 'parent-1', prompt: bigPrompt, noUi: true }, tmpDir);
        const { taskId: newTaskId } = JSON.parse(result.content[0].text);

        expect(capturedArgs).not.toContain('--prompt');
        expect(capturedArgs).not.toContain(bigPrompt);

        const idx = capturedArgs.indexOf('--prompt-file');
        expect(idx).toBeGreaterThan(-1);
        const briefingPath = capturedArgs[idx + 1];
        expect(briefingPath).toContain(newTaskId);
        expect(briefingPath.endsWith('briefing.md')).toBe(true);

        expect(fs.existsSync(briefingPath)).toBe(true);
        expect(fs.readFileSync(briefingPath, 'utf-8')).toBe(bigPrompt);
      });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('amicus_setup Electron pre-flight', () => {
  test('pre-flights checkElectronAvailable and returns isError message routing to headless setup when Electron is absent', async () => {
    await jest.isolateModulesAsync(async () => {
      const spawnSpy = jest.fn(() => ({
        pid: 12345, unref: jest.fn(),
        stdout: { on: jest.fn() }, stderr: { on: jest.fn() },
      }));
      jest.doMock('child_process', () => ({ spawn: spawnSpy }));
      const checkSpy = jest.fn(() => false);
      jest.doMock('../src/sidecar/interactive-process', () => ({
        ...jest.requireActual('../src/sidecar/interactive-process'),
        checkElectronAvailable: checkSpy,
      }));
      const { handlers: h } = require('../src/mcp-server');
      const result = await h.amicus_setup();
      expect(checkSpy).toHaveBeenCalled();
      expect(result.isError).toBe(true);
      const text = result.content[0].text;
      // Must not claim a window appeared
      expect(text).not.toMatch(/window should appear/i);
      // Must route the user to the headless terminal-based setup
      expect(text).toMatch(/headless|terminal|amicus setup/i);
      // Must NOT have spawned the detached GUI setup process
      expect(spawnSpy).not.toHaveBeenCalled();
    });
  });

  test('spawns the setup process and reports accurately when Electron is present', async () => {
    await jest.isolateModulesAsync(async () => {
      let capturedArgs;
      const spawnSpy = jest.fn((cmd, args) => {
        capturedArgs = args;
        return { pid: 12345, unref: jest.fn(), stdout: { on: jest.fn() }, stderr: { on: jest.fn() } };
      });
      jest.doMock('child_process', () => ({ spawn: spawnSpy }));
      jest.doMock('../src/sidecar/interactive-process', () => ({
        ...jest.requireActual('../src/sidecar/interactive-process'),
        checkElectronAvailable: jest.fn(() => true),
      }));
      const { handlers: h } = require('../src/mcp-server');
      const result = await h.amicus_setup();
      expect(result.isError).toBeUndefined();
      expect(spawnSpy).toHaveBeenCalled();
      expect(capturedArgs).toContain('setup');
      expect(result.content[0].text).toMatch(/window should appear/i);
    });
  });
});

describe('safeSessionDir (shared validator)', () => {
  const { safeSessionDir, validateTaskId } = require('../src/utils/validators');

  test('allows valid task IDs', () => {
    const result = safeSessionDir('/tmp/project', 'abc-123_task');
    expect(result).toContain('abc-123_task');
  });

  test('rejects path traversal attempts', () => {
    expect(() => safeSessionDir('/tmp/project', '../../../etc'))
      .toThrow('path traversal');
  });

  test('rejects dot-dot within task ID', () => {
    expect(() => safeSessionDir('/tmp/project', 'task/../../../etc'))
      .toThrow('path traversal');
  });

  test('validateTaskId accepts valid IDs', () => {
    expect(validateTaskId('abc123').valid).toBe(true);
    expect(validateTaskId('task-001').valid).toBe(true);
    expect(validateTaskId('my_task').valid).toBe(true);
  });

  test('validateTaskId rejects invalid IDs', () => {
    expect(validateTaskId('../etc').valid).toBe(false);
    expect(validateTaskId('').valid).toBe(false);
    expect(validateTaskId(null).valid).toBe(false);
    expect(validateTaskId('a;rm -rf /').valid).toBe(false);
  });
});

describe('MCP Server Handlers', () => {
  let handlers;

  beforeEach(() => {
    jest.clearAllMocks();
    handlers = require('../src/mcp-server').handlers;
  });

  afterEach(() => {
    jest.resetModules();
  });

  test('exports handlers object', () => {
    expect(handlers).toBeDefined();
    expect(typeof handlers).toBe('object');
  });

  test('exports startMcpServer function', () => {
    const { startMcpServer } = require('../src/mcp-server');
    expect(typeof startMcpServer).toBe('function');
  });

  test('handlers has all expected tool names', () => {
    const expectedTools = [
      'amicus_start', 'amicus_status', 'amicus_read',
      'amicus_list', 'amicus_resume', 'amicus_continue',
      'amicus_setup', 'amicus_guide', 'amicus_abort', 'amicus_fanout',
    ];
    for (const name of expectedTools) {
      expect(handlers).toHaveProperty(name);
      expect(typeof handlers[name]).toBe('function');
    }
  });

  describe('amicus_guide', () => {
    test('returns guide text with Amicus content', async () => {
      const result = await handlers.amicus_guide({});
      expect(result).toHaveProperty('content');
      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain('Amicus');
    });

    test('guide text contains workflow instructions', async () => {
      const result = await handlers.amicus_guide({});
      const text = result.content[0].text;
      expect(text).toContain('amicus_start');
      expect(text).toContain('amicus_status');
      expect(text).toContain('amicus_read');
    });
  });

  describe('amicus_list', () => {
    test('returns empty message for fresh project with no sessions', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
      try {
        const result = await handlers.amicus_list({}, tmpDir);
        expect(result.content[0].text).toContain('No amicus sessions found');
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('returns empty message when sessions dir exists but is empty', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
      const sessionsDir = path.join(tmpDir, '.claude', 'sidecar_sessions');
      fs.mkdirSync(sessionsDir, { recursive: true });
      try {
        const result = await handlers.amicus_list({}, tmpDir);
        expect(result.content[0].text).toContain('No amicus sessions found');
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('lists sessions with metadata', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'task001');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
        taskId: 'task001',
        status: 'complete',
        model: 'gemini',
        briefing: 'Test task briefing',
        createdAt: new Date().toISOString(),
      }));

      try {
        const result = await handlers.amicus_list({}, tmpDir);
        const parsed = JSON.parse(result.content[0].text);
        expect(Array.isArray(parsed)).toBe(true);
        expect(parsed).toHaveLength(1);
        expect(parsed[0].id).toBe('task001');
        expect(parsed[0].status).toBe('complete');
        expect(parsed[0].model).toBe('gemini');
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('filters sessions by status', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
      const sessionsBase = path.join(tmpDir, '.claude', 'sidecar_sessions');

      // Create a running session
      const runDir = path.join(sessionsBase, 'running1');
      fs.mkdirSync(runDir, { recursive: true });
      fs.writeFileSync(path.join(runDir, 'metadata.json'), JSON.stringify({
        taskId: 'running1', status: 'running', model: 'gemini',
        createdAt: new Date().toISOString(),
      }));

      // Create a complete session
      const doneDir = path.join(sessionsBase, 'done1');
      fs.mkdirSync(doneDir, { recursive: true });
      fs.writeFileSync(path.join(doneDir, 'metadata.json'), JSON.stringify({
        taskId: 'done1', status: 'complete', model: 'gpt',
        createdAt: new Date().toISOString(),
      }));

      try {
        const result = await handlers.amicus_list({ status: 'running' }, tmpDir);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed).toHaveLength(1);
        expect(parsed[0].status).toBe('running');
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('sorts sessions by createdAt descending', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
      const sessionsBase = path.join(tmpDir, '.claude', 'sidecar_sessions');

      const older = path.join(sessionsBase, 'older');
      fs.mkdirSync(older, { recursive: true });
      fs.writeFileSync(path.join(older, 'metadata.json'), JSON.stringify({
        taskId: 'older', status: 'complete', model: 'a',
        createdAt: '2026-01-01T00:00:00.000Z',
      }));

      const newer = path.join(sessionsBase, 'newer');
      fs.mkdirSync(newer, { recursive: true });
      fs.writeFileSync(path.join(newer, 'metadata.json'), JSON.stringify({
        taskId: 'newer', status: 'complete', model: 'b',
        createdAt: '2026-03-01T00:00:00.000Z',
      }));

      try {
        const result = await handlers.amicus_list({}, tmpDir);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed[0].id).toBe('newer');
        expect(parsed[1].id).toBe('older');
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });
  });

  describe('amicus_status', () => {
    test('returns status for existing running session with progress', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'abc12345');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
        taskId: 'abc12345',
        status: 'running',
        pid: process.pid,
        model: 'gemini',
        agent: 'Chat',
        briefing: 'Test briefing content',
        createdAt: new Date().toISOString(),
      }));
      // Write a conversation.jsonl so progress reader finds messages
      fs.writeFileSync(path.join(sessDir, 'conversation.jsonl'),
        '{"role":"user","content":"hello"}\n{"role":"assistant","content":"hi there"}\n');

      try {
        const result = await handlers.amicus_status({ taskId: 'abc12345' }, tmpDir);
        expect(result.isError).toBeUndefined();
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.taskId).toBe('abc12345');
        expect(parsed.status).toBe('running');
        expect(parsed).toHaveProperty('elapsed');
        expect(parsed).toHaveProperty('messages');
        expect(parsed).toHaveProperty('lastActivity');
        expect(parsed).toHaveProperty('latest');
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('returns error for missing session', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
      try {
        const result = await handlers.amicus_status({ taskId: 'nonexistent' }, tmpDir);
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('not found');
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('not-found message names the resolved project (#41)', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
      try {
        const result = await handlers.amicus_status({ taskId: 'nonexistent' }, tmpDir);
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain(tmpDir);
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });
  });

  describe('amicus_status enriched response', () => {
    test('includes messages and lastActivity when running', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-status-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'prog1');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
        taskId: 'prog1', status: 'running', pid: process.pid,
        createdAt: new Date().toISOString(),
      }));
      fs.writeFileSync(path.join(sessDir, 'conversation.jsonl'),
        '{"role":"user","content":"analyze auth"}\n' +
        '{"role":"assistant","toolCall":{"name":"Read"}}\n' +
        '{"role":"assistant","content":"Found the issue"}\n');

      try {
        const result = await handlers.amicus_status({ taskId: 'prog1' }, tmpDir);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.status).toBe('running');
        expect(parsed.messages).toBe(2);
        expect(parsed.lastActivity).toBeDefined();
        expect(parsed.latest).toBeDefined();
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('returns Starting up when no conversation yet', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-status-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'noprog');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
        taskId: 'noprog', status: 'running', pid: process.pid,
        createdAt: new Date().toISOString(),
      }));

      try {
        const result = await handlers.amicus_status({ taskId: 'noprog' }, tmpDir);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.messages).toBe(0);
        expect(parsed.latest).toBe('Starting up...');
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('detects crashed process and updates status', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-status-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'dead1');
      fs.mkdirSync(sessDir, { recursive: true });
      // PID 2147483647 is guaranteed to not exist
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
        taskId: 'dead1', status: 'running', pid: 2147483647,
        createdAt: new Date().toISOString(),
      }));

      try {
        const result = await handlers.amicus_status({ taskId: 'dead1' }, tmpDir);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.status).toBe('crashed');
        expect(parsed.reason).toBeDefined();

        // Verify metadata on disk was updated
        const diskMeta = JSON.parse(fs.readFileSync(
          path.join(sessDir, 'metadata.json'), 'utf-8'));
        expect(diskMeta.status).toBe('crashed');
        expect(diskMeta.crashedAt).toBeDefined();
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('does not include latest/messages for completed sessions', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-status-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'done1');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
        taskId: 'done1', status: 'complete',
        createdAt: new Date().toISOString(),
      }));

      try {
        const result = await handlers.amicus_status({ taskId: 'done1' }, tmpDir);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.taskId).toBe('done1');
        expect(parsed.status).toBe('complete');
        expect(parsed).toHaveProperty('elapsed');
        expect(parsed.latest).toBeUndefined();
        expect(parsed.messages).toBeUndefined();
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('includes reason for error/crashed sessions', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-status-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'err1');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
        taskId: 'err1', status: 'error',
        reason: 'API key expired',
        createdAt: new Date().toISOString(),
      }));

      try {
        const result = await handlers.amicus_status({ taskId: 'err1' }, tmpDir);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.status).toBe('error');
        expect(parsed.reason).toBe('API key expired');
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });
  });

  describe('amicus_status elapsed bound by end timestamp (#42)', () => {
    const { durationBetween } = require('../src/utils/result-schema');

    function fmt(ms) {
      return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
    }

    // A run that started 10 minutes ago but finished 2.1s after it started.
    // Buggy code reports ~10m (now - createdAt); correct code reports 0m 2s.
    const createdAt = new Date(Date.now() - 600000).toISOString();
    const endAt = new Date(new Date(createdAt).getTime() + 2100).toISOString();

    test('single-session: elapsed reflects completedAt, not now', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-elapsed-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'fin1');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
        taskId: 'fin1', status: 'complete', createdAt, completedAt: endAt,
      }));
      try {
        const result = await handlers.amicus_status({ taskId: 'fin1' }, tmpDir);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.elapsed).toBe(fmt(durationBetween(createdAt, endAt)));
        expect(parsed.elapsed).toBe('0m 2s');
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('single-session: aborted run bounds elapsed by abortedAt', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-elapsed-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'abo1');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
        taskId: 'abo1', status: 'aborted', reason: 'user abort',
        createdAt, abortedAt: endAt,
      }));
      try {
        const result = await handlers.amicus_status({ taskId: 'abo1' }, tmpDir);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.elapsed).toBe('0m 2s');
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('wave: completed wave bounds elapsed by completedAt', async () => {
      const { getSessionDir } = require('../src/session-manager');
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-elapsed-'));
      const legDir = getSessionDir(tmpDir, 'wfin-1');
      fs.mkdirSync(legDir, { recursive: true });
      fs.writeFileSync(path.join(legDir, 'metadata.json'),
        JSON.stringify({ taskId: 'wfin-1', status: 'complete', model: 'gemini' }));
      const waveDir = getSessionDir(tmpDir, 'wfin');
      fs.mkdirSync(waveDir, { recursive: true });
      fs.writeFileSync(path.join(waveDir, 'metadata.json'), JSON.stringify({
        taskId: 'wfin', type: 'wave', status: 'complete', legs: ['wfin-1'],
        models: ['gemini'], createdAt, completedAt: endAt,
      }));
      try {
        const result = await handlers.amicus_status({ taskId: 'wfin' }, tmpDir);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.elapsed).toBe('0m 2s');
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('wave: crashed wave bounds elapsed by crashedAt', async () => {
      const { getSessionDir } = require('../src/session-manager');
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-elapsed-'));
      const legDir = getSessionDir(tmpDir, 'wcr-1');
      fs.mkdirSync(legDir, { recursive: true });
      fs.writeFileSync(path.join(legDir, 'metadata.json'),
        JSON.stringify({ taskId: 'wcr-1', status: 'crashed', model: 'gemini' }));
      const waveDir = getSessionDir(tmpDir, 'wcr');
      fs.mkdirSync(waveDir, { recursive: true });
      fs.writeFileSync(path.join(waveDir, 'metadata.json'), JSON.stringify({
        taskId: 'wcr', type: 'wave', status: 'crashed', legs: ['wcr-1'],
        models: ['gemini'], reason: 'crash', createdAt, crashedAt: endAt,
      }));
      try {
        const result = await handlers.amicus_status({ taskId: 'wcr' }, tmpDir);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.elapsed).toBe('0m 2s');
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });
  });

  describe('amicus_status next_poll field', () => {
    test('includes next_poll when headless:true and status:running', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-poll-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'hl1');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
        taskId: 'hl1', status: 'running', pid: process.pid,
        headless: true, createdAt: new Date().toISOString(),
      }));
      fs.writeFileSync(path.join(sessDir, 'conversation.jsonl'), '');
      try {
        const result = await handlers.amicus_status({ taskId: 'hl1' }, tmpDir);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed).toHaveProperty('next_poll');
        expect(parsed.next_poll).toHaveProperty('hint');
        expect(parsed.next_poll.hint).toContain('sleep 25');
        expect(parsed.next_poll).not.toHaveProperty('recommended_wait_seconds');
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('omits next_poll when headless is false (interactive)', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-poll-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'ia1');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
        taskId: 'ia1', status: 'running', pid: process.pid,
        headless: false, createdAt: new Date().toISOString(),
      }));
      fs.writeFileSync(path.join(sessDir, 'conversation.jsonl'), '');
      try {
        const result = await handlers.amicus_status({ taskId: 'ia1' }, tmpDir);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed).not.toHaveProperty('next_poll');
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('omits next_poll when headless is missing (legacy sessions)', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-poll-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'leg1');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
        taskId: 'leg1', status: 'running', pid: process.pid,
        createdAt: new Date().toISOString(),
      }));
      fs.writeFileSync(path.join(sessDir, 'conversation.jsonl'), '');
      try {
        const result = await handlers.amicus_status({ taskId: 'leg1' }, tmpDir);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed).not.toHaveProperty('next_poll');
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('omits next_poll when headless:true but status:complete', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-poll-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'hlc1');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
        taskId: 'hlc1', status: 'complete', headless: true,
        createdAt: new Date().toISOString(),
      }));
      try {
        const result = await handlers.amicus_status({ taskId: 'hlc1' }, tmpDir);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.status).toBe('complete');
        expect(parsed).not.toHaveProperty('next_poll');
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('next_poll hint contains at-least-30s guidance', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-poll-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'ph1');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
        taskId: 'ph1', status: 'running', pid: process.pid,
        headless: true, createdAt: new Date().toISOString(),
      }));
      fs.writeFileSync(path.join(sessDir, 'conversation.jsonl'), '');
      try {
        const result = await handlers.amicus_status({ taskId: 'ph1' }, tmpDir);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.next_poll.hint).toContain('sleep 25');
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('headless running amicus_status includes system-reminder content block', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-poll-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'sr2');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
        taskId: 'sr2', status: 'running', pid: process.pid,
        headless: true, createdAt: new Date().toISOString(),
      }));
      fs.writeFileSync(path.join(sessDir, 'conversation.jsonl'), '');
      try {
        const result = await handlers.amicus_status({ taskId: 'sr2' }, tmpDir);
        expect(result.content).toHaveLength(2);
        expect(result.content[1].text).toContain('<system-reminder>');
        expect(result.content[1].text).toContain('sleep 25');
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('interactive running amicus_status has no system-reminder', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-poll-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'sri2');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
        taskId: 'sri2', status: 'running', pid: process.pid,
        headless: false, createdAt: new Date().toISOString(),
      }));
      fs.writeFileSync(path.join(sessDir, 'conversation.jsonl'), '');
      try {
        const result = await handlers.amicus_status({ taskId: 'sri2' }, tmpDir);
        expect(result.content).toHaveLength(1);
        expect(result.content[0].text).not.toContain('<system-reminder>');
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });
  });

  describe('amicus_status stall detection', () => {
    test('includes stalled: true when lastActivityMs exceeds threshold', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-stall-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'stall1');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
        taskId: 'stall1', status: 'running', model: 'gemini',
        pid: process.pid, headless: true,
        createdAt: new Date(Date.now() - 300000).toISOString(),
      }));
      // Write conversation.jsonl with old mtime (3 minutes ago)
      const convPath = path.join(sessDir, 'conversation.jsonl');
      fs.writeFileSync(convPath, JSON.stringify({ role: 'assistant', content: 'working' }));
      const threeMinutesAgo = new Date(Date.now() - 180000);
      fs.utimesSync(convPath, threeMinutesAgo, threeMinutesAgo);
      // Write old progress.json too
      fs.writeFileSync(path.join(sessDir, 'progress.json'), JSON.stringify({
        stage: 'receiving', stageLabel: 'Executing tool call...',
        updatedAt: threeMinutesAgo.toISOString()
      }));

      try {
        const result = await handlers.amicus_status({ taskId: 'stall1' }, tmpDir);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.stalled).toBe(true);
        expect(parsed.stalledForSeconds).toBeGreaterThanOrEqual(170);
        expect(parsed.recovery).toContain('amicus_abort');
        expect(parsed.recovery).toContain('amicus_resume');
        expect(parsed.recovery).toContain('stall1');
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('does not include stalled flag when activity is recent', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-nostall-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'active1');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
        taskId: 'active1', status: 'running', model: 'gemini',
        pid: process.pid, headless: true,
        createdAt: new Date().toISOString(),
      }));
      // Write fresh conversation.jsonl
      fs.writeFileSync(path.join(sessDir, 'conversation.jsonl'),
        JSON.stringify({ role: 'assistant', content: 'working' }));
      fs.writeFileSync(path.join(sessDir, 'progress.json'), JSON.stringify({
        stage: 'receiving', stageLabel: 'Generating response...',
        updatedAt: new Date().toISOString()
      }));

      try {
        const result = await handlers.amicus_status({ taskId: 'active1' }, tmpDir);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.stalled).toBeUndefined();
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('does not include stalled flag for interactive sessions even when idle', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-int-stall-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'int1');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
        taskId: 'int1', status: 'running', model: 'gemini',
        pid: process.pid,
        createdAt: new Date(Date.now() - 300000).toISOString(),
      }));
      const convPath = path.join(sessDir, 'conversation.jsonl');
      fs.writeFileSync(convPath, JSON.stringify({ role: 'assistant', content: 'working' }));
      const threeMinutesAgo = new Date(Date.now() - 180000);
      fs.utimesSync(convPath, threeMinutesAgo, threeMinutesAgo);
      fs.writeFileSync(path.join(sessDir, 'progress.json'), JSON.stringify({
        stage: 'receiving', stageLabel: 'Executing tool call...',
        updatedAt: threeMinutesAgo.toISOString()
      }));

      try {
        const result = await handlers.amicus_status({ taskId: 'int1' }, tmpDir);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.stalled).toBeUndefined();
        expect(parsed.recovery).toBeUndefined();
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('does not include stalled flag for completed sessions', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-done-stall-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'done2');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
        taskId: 'done2', status: 'complete', model: 'gemini',
        createdAt: new Date(Date.now() - 600000).toISOString(),
      }));

      try {
        const result = await handlers.amicus_status({ taskId: 'done2' }, tmpDir);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.stalled).toBeUndefined();
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });
  });

  describe('amicus_status model field', () => {
    test('includes model in status response when stored in metadata', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-model-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'mdl1');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
        taskId: 'mdl1', status: 'complete',
        model: 'openrouter/x-ai/grok-4.3',
        createdAt: new Date().toISOString(),
      }));
      try {
        const result = await handlers.amicus_status({ taskId: 'mdl1' }, tmpDir);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.model).toBe('openrouter/x-ai/grok-4.3');
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('omits model field when not stored in metadata', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-nomodel-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'nomdl');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
        taskId: 'nomdl', status: 'complete',
        createdAt: new Date().toISOString(),
      }));
      try {
        const result = await handlers.amicus_status({ taskId: 'nomdl' }, tmpDir);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed).not.toHaveProperty('model');
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });
  });

  describe('amicus_status version field (#33)', () => {
    test('includes the running amicus version in the status payload', async () => {
      const runningVersion = require('../package.json').version;
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-ver-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'ver1');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
        taskId: 'ver1', status: 'complete',
        createdAt: new Date().toISOString(),
      }));
      try {
        const result = await handlers.amicus_status({ taskId: 'ver1' }, tmpDir);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.version).toBe(runningVersion);
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('includes version on a wave status payload too', async () => {
      const runningVersion = require('../package.json').version;
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-verw-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'verw');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
        taskId: 'verw', type: 'wave', status: 'complete', legs: [],
        createdAt: new Date().toISOString(),
      }));
      try {
        const result = await handlers.amicus_status({ taskId: 'verw' }, tmpDir);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.version).toBe(runningVersion);
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('appends a stale-version warning when on-disk package.json is newer', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-verstale-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'verstale');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
        taskId: 'verstale', status: 'complete',
        createdAt: new Date().toISOString(),
      }));
      try {
        await jest.isolateModulesAsync(async () => {
          jest.doMock('fs', () => {
            const real = jest.requireActual('fs');
            return {
              ...real,
              readFileSync: jest.fn((p, ...rest) => {
                // Only intercept the on-disk package.json re-read; pass through
                // every other read (metadata.json, etc.) to the real fs.
                if (String(p).endsWith('package.json')) {
                  return JSON.stringify({ version: '99.99.99' });
                }
                return real.readFileSync(p, ...rest);
              }),
            };
          });
          const { handlers: h } = require('../src/mcp-server');
          const result = await h.amicus_status({ taskId: 'verstale' }, tmpDir);
          const allText = result.content.map(c => c.text).join('\n');
          expect(allText).toContain('99.99.99');
          expect(allText.toLowerCase()).toContain('restart');
        });
      } finally {
        jest.dontMock('fs');
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('emits no stale warning when on-disk version matches running', async () => {
      const runningVersion = require('../package.json').version;
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-verok-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'verok');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
        taskId: 'verok', status: 'complete',
        createdAt: new Date().toISOString(),
      }));
      try {
        await jest.isolateModulesAsync(async () => {
          jest.doMock('fs', () => {
            const real = jest.requireActual('fs');
            return {
              ...real,
              readFileSync: jest.fn((p, ...rest) => {
                if (String(p).endsWith('package.json')) {
                  return JSON.stringify({ version: runningVersion });
                }
                return real.readFileSync(p, ...rest);
              }),
            };
          });
          const { handlers: h } = require('../src/mcp-server');
          const result = await h.amicus_status({ taskId: 'verok' }, tmpDir);
          const allText = result.content.map(c => c.text).join('\n');
          expect(allText.toLowerCase()).not.toContain('restart your mcp client');
        });
      } finally {
        jest.dontMock('fs');
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('does not crash when the on-disk version re-read throws', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-verthrow-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'verthrow');
      fs.mkdirSync(sessDir, { recursive: true });
      const metaPath = path.join(sessDir, 'metadata.json');
      fs.writeFileSync(metaPath, JSON.stringify({
        taskId: 'verthrow', status: 'complete',
        createdAt: new Date().toISOString(),
      }));
      const metaContent = fs.readFileSync(metaPath, 'utf-8');
      try {
        await jest.isolateModulesAsync(async () => {
          jest.doMock('fs', () => {
            const real = jest.requireActual('fs');
            return {
              ...real,
              readFileSync: jest.fn((p, ...rest) => {
                if (String(p).endsWith('package.json')) {
                  throw new Error('disk gone');
                }
                if (String(p).endsWith('metadata.json')) {
                  return metaContent;
                }
                return real.readFileSync(p, ...rest);
              }),
            };
          });
          const { handlers: h } = require('../src/mcp-server');
          const result = await h.amicus_status({ taskId: 'verthrow' }, tmpDir);
          const parsed = JSON.parse(result.content[0].text);
          expect(parsed.status).toBe('complete');
          const allText = result.content.map(c => c.text).join('\n');
          expect(allText.toLowerCase()).not.toContain('restart your mcp client');
        });
      } finally {
        jest.dontMock('fs');
        fs.rmSync(tmpDir, { recursive: true });
      }
    });
  });

  describe('amicus_read', () => {
    test('returns summary when available', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'read123');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), '{}');
      fs.writeFileSync(path.join(sessDir, 'summary.md'), '## Test Summary\n\nResults here.');

      try {
        const result = await handlers.amicus_read({ taskId: 'read123' }, tmpDir);
        expect(result.isError).toBeUndefined();
        expect(result.content[0].text).toContain('Test Summary');
        expect(result.content[0].text).toContain('Results here.');
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('summary prepends model when stored in metadata', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-readmdl-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'rdmdl1');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
        model: 'openrouter/x-ai/grok-4.3',
      }));
      fs.writeFileSync(path.join(sessDir, 'summary.md'), '## Results\n\nFound the bug.');
      try {
        const result = await handlers.amicus_read({ taskId: 'rdmdl1' }, tmpDir);
        expect(result.content[0].text).toContain('openrouter/x-ai/grok-4.3');
        expect(result.content[0].text).toContain('Found the bug.');
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('summary works without model in metadata', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-readnomdl-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'rdnomdl');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), '{}');
      fs.writeFileSync(path.join(sessDir, 'summary.md'), '## Results\n\nAll good.');
      try {
        const result = await handlers.amicus_read({ taskId: 'rdnomdl' }, tmpDir);
        expect(result.content[0].text).toContain('All good.');
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('returns metadata when mode is metadata', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'meta1');
      fs.mkdirSync(sessDir, { recursive: true });
      const meta = { taskId: 'meta1', status: 'complete', model: 'gemini' };
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify(meta));

      try {
        const result = await handlers.amicus_read({ taskId: 'meta1', mode: 'metadata' }, tmpDir);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.taskId).toBe('meta1');
        expect(parsed.status).toBe('complete');
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('returns conversation when mode is conversation', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'conv1');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), '{}');
      fs.writeFileSync(path.join(sessDir, 'conversation.jsonl'), '{"role":"user","content":"hello"}\n');

      try {
        const result = await handlers.amicus_read({ taskId: 'conv1', mode: 'conversation' }, tmpDir);
        expect(result.content[0].text).toContain('hello');
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('returns message when no conversation file exists', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'noconv');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), '{}');

      try {
        const result = await handlers.amicus_read({ taskId: 'noconv', mode: 'conversation' }, tmpDir);
        expect(result.content[0].text).toContain('No conversation recorded');
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('returns message when no summary file exists', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'nosum');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), '{}');

      try {
        const result = await handlers.amicus_read({ taskId: 'nosum' }, tmpDir);
        expect(result.content[0].text).toContain('No summary available');
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('returns error for missing session', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
      try {
        const result = await handlers.amicus_read({ taskId: 'nope' }, tmpDir);
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('not found');
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('not-found message names the resolved project (#41)', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
      try {
        const result = await handlers.amicus_read({ taskId: 'nope' }, tmpDir);
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain(tmpDir);
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });
  });

  describe('amicus_start', () => {
    test('handler is an async function', () => {
      expect(typeof handlers.amicus_start).toBe('function');
    });

    test('returns interactive mode message when noUi is false', async () => {
      await jest.isolateModulesAsync(async () => {
        jest.doMock('child_process', () => ({
          spawn: jest.fn(() => ({ pid: 12345, unref: jest.fn() })),
        }));
        const { handlers: h } = require('../src/mcp-server');
        const result = await h.amicus_start({ prompt: 'analyze auth', noUi: false, model: 'google/gemini-test' }, '/tmp');
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.mode).toBe('interactive');
        expect(parsed.message).toContain('Do NOT poll');
        expect(parsed.message).toContain('clicked Fold');
      });
    });

    test('returns headless mode message with at-least-30s guidance when noUi is true', async () => {
      await jest.isolateModulesAsync(async () => {
        jest.doMock('child_process', () => ({
          spawn: jest.fn(() => ({ pid: 12345, unref: jest.fn() })),
        }));
        const { handlers: h } = require('../src/mcp-server');
        const result = await h.amicus_start({ prompt: 'implement feature', noUi: true, model: 'google/gemini-test' }, '/tmp');
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.mode).toBe('headless');
        expect(parsed.message).toContain('headless');
      });
    });

    test('headless amicus_start response includes system-reminder content block', async () => {
      await jest.isolateModulesAsync(async () => {
        jest.doMock('child_process', () => ({
          spawn: jest.fn(() => ({ pid: 12345, unref: jest.fn() })),
        }));
        const { handlers: h } = require('../src/mcp-server');
        const result = await h.amicus_start({ prompt: 'test task', noUi: true, model: 'google/gemini-test' }, '/tmp');
        expect(result.content).toHaveLength(2);
        expect(result.content[1].text).toContain('<system-reminder>');
        expect(result.content[1].text).toContain('sleep 25');
      });
    });

    test('interactive amicus_start response has no system-reminder', async () => {
      await jest.isolateModulesAsync(async () => {
        jest.doMock('child_process', () => ({
          spawn: jest.fn(() => ({ pid: 12345, unref: jest.fn() })),
        }));
        const { handlers: h } = require('../src/mcp-server');
        const result = await h.amicus_start({ prompt: 'analyze auth', noUi: false, model: 'google/gemini-test' }, '/tmp');
        expect(result.content).toHaveLength(1);
        expect(result.content[0].text).not.toContain('<system-reminder>');
      });
    });
  });

  describe('amicus_resume', () => {
    test('handler is an async function', () => {
      expect(typeof handlers.amicus_resume).toBe('function');
    });
  });

  describe('amicus_continue', () => {
    test('handler is an async function', () => {
      expect(typeof handlers.amicus_continue).toBe('function');
    });
  });

  describe('amicus_setup', () => {
    test('handler is an async function', () => {
      expect(typeof handlers.amicus_setup).toBe('function');
    });
  });

  describe('amicus_abort PID killing', () => {
    test('sends SIGTERM to process when PID is stored in metadata (marker-first: kill only after the grace window)', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-abort-pid-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'killme1');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
        taskId: 'killme1', status: 'running', model: 'gemini',
        pid: 99999,
        createdAt: new Date().toISOString(),
      }));

      // Marker-first ordering (Phase 3): the SIGTERM is a fallback that only
      // fires after the grace window. Fake timers + a short grace let us
      // drain that window deterministically; the mock MUST stay installed
      // until every grace-kill timer is cleared, or a pending timer fires
      // the real process.kill after mockRestore.
      const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => {});
      jest.useFakeTimers();
      process.env.AMICUS_ABORT_GRACE_MS = '60';
      try {
        const result = await handlers.amicus_abort({ taskId: 'killme1' }, tmpDir);
        expect(result.isError).toBeUndefined();
        expect(killSpy).not.toHaveBeenCalledWith(99999, 'SIGTERM');

        await jest.advanceTimersByTimeAsync(1000);
        expect(killSpy).toHaveBeenCalledWith(99999, 'SIGTERM');
      } finally {
        jest.clearAllTimers();
        jest.useRealTimers();
        killSpy.mockRestore();
        delete process.env.AMICUS_ABORT_GRACE_MS;
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('marks aborted even if process already exited (SIGTERM throws ESRCH)', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-abort-gone-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'gone1');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
        taskId: 'gone1', status: 'running', model: 'gemini',
        pid: 99999,
        createdAt: new Date().toISOString(),
      }));

      const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => {
        const err = new Error('No such process');
        err.code = 'ESRCH';
        throw err;
      });
      try {
        const result = await handlers.amicus_abort({ taskId: 'gone1' }, tmpDir);
        expect(result.isError).toBeUndefined();
        const meta = JSON.parse(fs.readFileSync(path.join(sessDir, 'metadata.json'), 'utf-8'));
        expect(meta.status).toBe('aborted');
      } finally {
        killSpy.mockRestore();
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('aborts a running session — status updated to aborted', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'abort1');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
        taskId: 'abort1', status: 'running', model: 'gemini',
        createdAt: new Date().toISOString(),
      }));

      // No PID in metadata — abort should still update status gracefully
      try {
        const result = await handlers.amicus_abort({ taskId: 'abort1' }, tmpDir);
        expect(result.isError).toBeUndefined();
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.status).toBe('aborted');
        expect(parsed.taskId).toBe('abort1');

        const meta = JSON.parse(fs.readFileSync(path.join(sessDir, 'metadata.json'), 'utf-8'));
        expect(meta.status).toBe('aborted');
        expect(meta.abortedAt).toBeDefined();
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('returns informational message for non-running session', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'done1');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
        taskId: 'done1', status: 'complete', model: 'gemini',
        createdAt: new Date().toISOString(),
      }));

      try {
        const result = await handlers.amicus_abort({ taskId: 'done1' }, tmpDir);
        expect(result.content[0].text).toContain('not running');
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('returns error for missing session', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
      try {
        const result = await handlers.amicus_abort({ taskId: 'nonexistent' }, tmpDir);
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('not found');
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('not-found message names the resolved project (#41)', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
      try {
        const result = await handlers.amicus_abort({ taskId: 'nonexistent' }, tmpDir);
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain(tmpDir);
        expect(result.content[0].text).toContain('pass the original "project"');
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });
  });
});

describe('amicus_start context and summary args', () => {
  it('passes --context-turns to CLI', async () => {
    let capturedArgs = [];
    await jest.isolateModulesAsync(async () => {
      jest.doMock('child_process', () => ({
        spawn: (_cmd, args, _opts) => {
          capturedArgs = args;
          return { pid: 1234, unref: jest.fn(), stdout: { on: jest.fn() }, stderr: { on: jest.fn() } };
        }
      }));
      jest.doMock('fs', () => ({
        ...jest.requireActual('fs'),
        mkdirSync: jest.fn(),
        writeFileSync: jest.fn(),
        existsSync: jest.fn(() => false)
      }));
      const { handlers } = require('../src/mcp-server');
      await handlers.amicus_start({ prompt: 'test', model: 'openrouter/test/model', contextTurns: 25 }, '/tmp/proj');
    });
    expect(capturedArgs).toContain('--context-turns');
    expect(capturedArgs).toContain('25');
  });

  it('passes --context-since to CLI', async () => {
    let capturedArgs = [];
    await jest.isolateModulesAsync(async () => {
      jest.doMock('child_process', () => ({
        spawn: (_cmd, args, _opts) => {
          capturedArgs = args;
          return { pid: 1234, unref: jest.fn(), stdout: { on: jest.fn() }, stderr: { on: jest.fn() } };
        }
      }));
      jest.doMock('fs', () => ({
        ...jest.requireActual('fs'),
        mkdirSync: jest.fn(),
        writeFileSync: jest.fn(),
        existsSync: jest.fn(() => false)
      }));
      const { handlers } = require('../src/mcp-server');
      await handlers.amicus_start({ prompt: 'test', model: 'openrouter/test/model', contextSince: '2h' }, '/tmp/proj');
    });
    expect(capturedArgs).toContain('--context-since');
    expect(capturedArgs).toContain('2h');
  });

  it('passes --context-max-tokens to CLI', async () => {
    let capturedArgs = [];
    await jest.isolateModulesAsync(async () => {
      jest.doMock('child_process', () => ({
        spawn: (_cmd, args, _opts) => {
          capturedArgs = args;
          return { pid: 1234, unref: jest.fn(), stdout: { on: jest.fn() }, stderr: { on: jest.fn() } };
        }
      }));
      jest.doMock('fs', () => ({
        ...jest.requireActual('fs'),
        mkdirSync: jest.fn(),
        writeFileSync: jest.fn(),
        existsSync: jest.fn(() => false)
      }));
      const { handlers } = require('../src/mcp-server');
      await handlers.amicus_start({ prompt: 'test', model: 'openrouter/test/model', contextMaxTokens: 40000 }, '/tmp/proj');
    });
    expect(capturedArgs).toContain('--context-max-tokens');
    expect(capturedArgs).toContain('40000');
  });

  it('passes --summary-length to CLI', async () => {
    let capturedArgs = [];
    await jest.isolateModulesAsync(async () => {
      jest.doMock('child_process', () => ({
        spawn: (_cmd, args, _opts) => {
          capturedArgs = args;
          return { pid: 1234, unref: jest.fn(), stdout: { on: jest.fn() }, stderr: { on: jest.fn() } };
        }
      }));
      jest.doMock('fs', () => ({
        ...jest.requireActual('fs'),
        mkdirSync: jest.fn(),
        writeFileSync: jest.fn(),
        existsSync: jest.fn(() => false)
      }));
      const { handlers } = require('../src/mcp-server');
      await handlers.amicus_start({ prompt: 'test', model: 'openrouter/test/model', summaryLength: 'verbose' }, '/tmp/proj');
    });
    expect(capturedArgs).toContain('--summary-length');
    expect(capturedArgs).toContain('verbose');
  });

  it('passes --no-context to CLI when includeContext is false', async () => {
    let capturedArgs = [];
    await jest.isolateModulesAsync(async () => {
      jest.doMock('child_process', () => ({
        spawn: (_cmd, args, _opts) => {
          capturedArgs = args;
          return { pid: 1234, unref: jest.fn(), stdout: { on: jest.fn() }, stderr: { on: jest.fn() } };
        }
      }));
      jest.doMock('fs', () => ({
        ...jest.requireActual('fs'),
        mkdirSync: jest.fn(),
        writeFileSync: jest.fn(),
        existsSync: jest.fn(() => false)
      }));
      const { handlers } = require('../src/mcp-server');
      await handlers.amicus_start({ prompt: 'self-contained task', model: 'openrouter/test/model', includeContext: false }, '/tmp/proj');
    });
    expect(capturedArgs).toContain('--no-context');
  });

  it('does NOT pass --no-context when includeContext is true', async () => {
    let capturedArgs = [];
    await jest.isolateModulesAsync(async () => {
      jest.doMock('child_process', () => ({
        spawn: (_cmd, args, _opts) => {
          capturedArgs = args;
          return { pid: 1234, unref: jest.fn(), stdout: { on: jest.fn() }, stderr: { on: jest.fn() } };
        }
      }));
      jest.doMock('fs', () => ({
        ...jest.requireActual('fs'),
        mkdirSync: jest.fn(),
        writeFileSync: jest.fn(),
        existsSync: jest.fn(() => false)
      }));
      const { handlers } = require('../src/mcp-server');
      await handlers.amicus_start({ prompt: 'needs context', model: 'openrouter/test/model', includeContext: true }, '/tmp/proj');
    });
    expect(capturedArgs).not.toContain('--no-context');
  });

  it('does NOT pass --no-context when includeContext is omitted', async () => {
    let capturedArgs = [];
    await jest.isolateModulesAsync(async () => {
      jest.doMock('child_process', () => ({
        spawn: (_cmd, args, _opts) => {
          capturedArgs = args;
          return { pid: 1234, unref: jest.fn(), stdout: { on: jest.fn() }, stderr: { on: jest.fn() } };
        }
      }));
      jest.doMock('fs', () => ({
        ...jest.requireActual('fs'),
        mkdirSync: jest.fn(),
        writeFileSync: jest.fn(),
        existsSync: jest.fn(() => false)
      }));
      const { handlers } = require('../src/mcp-server');
      await handlers.amicus_start({ prompt: 'default behavior', model: 'openrouter/test/model' }, '/tmp/proj');
    });
    expect(capturedArgs).not.toContain('--no-context');
  });
});

describe('amicus_continue context args', () => {
  it('passes --context-turns to CLI', async () => {
    let capturedArgs = [];
    await jest.isolateModulesAsync(async () => {
      jest.doMock('child_process', () => ({
        spawn: (_cmd, args, _opts) => {
          capturedArgs = args;
          return { pid: 1234, unref: jest.fn(), stdout: { on: jest.fn() }, stderr: { on: jest.fn() } };
        }
      }));
      jest.doMock('fs', () => ({
        ...jest.requireActual('fs'),
        mkdirSync: jest.fn(),
        writeFileSync: jest.fn(),
        existsSync: jest.fn(() => false)
      }));
      const { handlers } = require('../src/mcp-server');
      await handlers.amicus_continue({ taskId: 'abc123', prompt: 'continue task', contextTurns: 10 }, '/tmp/proj');
    });
    expect(capturedArgs).toContain('--context-turns');
    expect(capturedArgs).toContain('10');
  });

  it('passes --context-max-tokens to CLI', async () => {
    let capturedArgs = [];
    await jest.isolateModulesAsync(async () => {
      jest.doMock('child_process', () => ({
        spawn: (_cmd, args, _opts) => {
          capturedArgs = args;
          return { pid: 1234, unref: jest.fn(), stdout: { on: jest.fn() }, stderr: { on: jest.fn() } };
        }
      }));
      jest.doMock('fs', () => ({
        ...jest.requireActual('fs'),
        mkdirSync: jest.fn(),
        writeFileSync: jest.fn(),
        existsSync: jest.fn(() => false)
      }));
      const { handlers } = require('../src/mcp-server');
      await handlers.amicus_continue({ taskId: 'abc123', prompt: 'continue task', contextMaxTokens: 20000 }, '/tmp/proj');
    });
    expect(capturedArgs).toContain('--context-max-tokens');
    expect(capturedArgs).toContain('20000');
  });
});

describe('amicus_start stderr capture', () => {
  let tmpDir;

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-stderr-'));
  });

  afterEach(() => {
    // maxRetries: Windows holds brief handles on freshly-written session files,
    // so a plain recursive rm can hit ENOTEMPTY; retry a few times (no-op on POSIX).
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  test('spawns process with stderr redirected to file', async () => {
    let capturedOpts;
    await jest.isolateModulesAsync(async () => {
      jest.doMock('child_process', () => ({
        spawn: jest.fn((_cmd, _args, opts) => {
          capturedOpts = opts;
          return { pid: 12345, unref: jest.fn() };
        }),
      }));
      // Ensure real fs is used (clear any leaked mock from prior tests)
      jest.doMock('fs', () => jest.requireActual('fs'));
      const { handlers: h } = require('../src/mcp-server');
      await h.amicus_start({ prompt: 'test task', noUi: true, model: 'google/gemini-test' }, tmpDir);
    });
    // stdio[2] should be a number (file descriptor), not 'ignore'
    expect(typeof capturedOpts.stdio[2]).toBe('number');
  });

  test('amicus_resume passes sessionDir for stderr capture', async () => {
    let capturedOpts;
    // Pre-create session with metadata so resume can find it
    const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'res1');
    fs.mkdirSync(sessDir, { recursive: true });
    fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
      taskId: 'res1', status: 'complete',
      createdAt: new Date().toISOString(),
    }));

    await jest.isolateModulesAsync(async () => {
      jest.doMock('child_process', () => ({
        spawn: jest.fn((_cmd, _args, opts) => {
          capturedOpts = opts;
          return { pid: 12345, unref: jest.fn() };
        }),
      }));
      jest.doMock('fs', () => jest.requireActual('fs'));
      const { handlers: h } = require('../src/mcp-server');
      await h.amicus_resume({ taskId: 'res1' }, tmpDir);
    });
    // stdio[2] should be a number (file descriptor), not 'ignore'
    expect(typeof capturedOpts.stdio[2]).toBe('number');
  });

  test('amicus_continue passes sessionDir for stderr capture', async () => {
    let capturedOpts;
    await jest.isolateModulesAsync(async () => {
      jest.doMock('child_process', () => ({
        spawn: jest.fn((_cmd, _args, opts) => {
          capturedOpts = opts;
          return { pid: 12345, unref: jest.fn() };
        }),
      }));
      jest.doMock('fs', () => jest.requireActual('fs'));
      const { handlers: h } = require('../src/mcp-server');
      await h.amicus_continue({ taskId: 'old1', prompt: 'follow up' }, tmpDir);
    });
    // stdio[2] should be a number (file descriptor), not 'ignore'
    expect(typeof capturedOpts.stdio[2]).toBe('number');
  });
});

describe('amicus_status wave per-leg enrichment', () => {
  const fs = require('fs');
  const path = require('path');
  const os = require('os');
  const { getSessionDir } = require('../src/session-manager');
  let handlers; let tmpDir;
  beforeEach(() => {
    handlers = require('../src/mcp-server').handlers;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wave-status-'));
  });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  function writeSession(taskId, meta, extra = {}) {
    const dir = getSessionDir(tmpDir, taskId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify({ taskId, ...meta }));
    if (extra.conversation) { fs.writeFileSync(path.join(dir, 'conversation.jsonl'), extra.conversation); }
    if (extra.progress) { fs.writeFileSync(path.join(dir, 'progress.json'), JSON.stringify(extra.progress)); }
    return dir;
  }

  test('running wave legs carry latestActivity + stalled', async () => {
    writeSession('wv1-1', { model: 'gemini', status: 'running' }, {
      conversation: JSON.stringify({ role: 'assistant', content: 'working' }),
      progress: { stage: 'receiving', stageLabel: 'Generating response...', updatedAt: new Date().toISOString() },
    });
    writeSession('wv1-2', { model: 'deepseek', status: 'running' }); // no progress yet
    writeSession('wv1', { type: 'wave', status: 'running', legs: ['wv1-1', 'wv1-2'],
      models: ['gemini', 'deepseek'], pid: process.pid, createdAt: new Date().toISOString() });

    const result = await handlers.amicus_status({ taskId: 'wv1' }, tmpDir);
    const body = JSON.parse(result.content[0].text);
    expect(body.legs).toHaveLength(2);
    expect(body.legs[0]).toHaveProperty('latestActivity');
    expect(body.legs[0]).toHaveProperty('stalled', false);
    expect(body.legs[0].messages).toBe(1);
    // leg with no progress.json still returns its base fields without throwing
    expect(body.legs[1].model).toBe('deepseek');
  });
});

describe('council MCP handlers', () => {
  const avInput = require('./council/fixtures/av-receiver-input');
  const { deriveReliability } = require('../src/council/ledger');
  let handlers;
  let prevConfigDir;
  let ledgerDir;
  beforeEach(() => {
    handlers = require('../src/mcp-server').handlers;
    // Isolate the reliability ledger so tally's auto-append uses a temp dir.
    prevConfigDir = process.env.AMICUS_CONFIG_DIR;
    ledgerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-council-cfg-'));
    process.env.AMICUS_CONFIG_DIR = ledgerDir;
  });
  afterEach(() => {
    if (prevConfigDir === undefined) { delete process.env.AMICUS_CONFIG_DIR; }
    else { process.env.AMICUS_CONFIG_DIR = prevConfigDir; }
  });

  test('amicus_council_tally auto-appends a ledger row visible to council stats', async () => {
    expect(deriveReliability({ dir: ledgerDir })).toEqual([]);
    const res = await handlers.amicus_council_tally(avInput, process.cwd());
    expect(res.isError).toBeFalsy();
    const gpt = deriveReliability({ dir: ledgerDir }).find(a => a.model === 'gpt');
    expect(gpt).toBeDefined();
    expect(gpt.runs).toBe(1);
  });

  test('amicus_council_tally returns a tally record as JSON content', async () => {
    const res = await handlers.amicus_council_tally(avInput, process.cwd());
    expect(res.isError).toBeFalsy();
    const doc = JSON.parse(res.content[0].text);
    expect(doc.tierCounts).toEqual({ Confirmed: 29, Contested: 2, Singleton: 1, Disputed: 3 });
  });

  test('amicus_verdict merges decisions into the verdict', async () => {
    const tallyRes = await handlers.amicus_council_tally(avInput, process.cwd());
    const record = JSON.parse(tallyRes.content[0].text);
    const res = await handlers.amicus_verdict({ record, decisions: [{ id: 'A1', decision: 'accepted', applied: true }] }, process.cwd());
    const v = JSON.parse(res.content[0].text);
    expect(v.findings.find(f => f.id === 'A1').decision).toBe('accepted');
  });

  test('amicus_council_stats returns aggregated reliability', async () => {
    jest.resetModules();
    jest.doMock('../src/council/ledger', () => ({
      deriveReliability: () => [{ model: 'gpt', runs: 3, lowN: false, avgStreetCredPeersOnly: 1.4 }],
    }));
    const h = require('../src/mcp-server').handlers;
    const res = await h.amicus_council_stats({}, process.cwd());
    const agg = JSON.parse(res.content[0].text);
    expect(agg[0].model).toBe('gpt');
    jest.dontMock('../src/council/ledger');
    jest.resetModules();
  });

  test('amicus_council_tally on malformed input returns isError', async () => {
    const res = await handlers.amicus_council_tally({ meta: { models: [] } }, process.cwd());
    expect(res.isError).toBe(true);
  });
});
