/**
 * MCP Headless Lifecycle Integration Tests
 *
 * Tests the full lifecycle of MCP-driven headless Amicus sessions by calling
 * MCP handlers directly with realistic filesystem state. No real processes
 * are spawned — all state is created via fs in temp directories.
 *
 * Test pattern: create session dirs + metadata on disk, then call handlers
 * from require('../src/mcp-server').handlers and verify behavior.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

/** Create a session directory with metadata.json */
function createSession(projectDir, taskId, meta) {
  const sessDir = path.join(projectDir, '.claude', 'sidecar_sessions', taskId);
  fs.mkdirSync(sessDir, { recursive: true });
  const defaults = {
    taskId,
    status: 'running',
    model: 'gemini',
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(
    path.join(sessDir, 'metadata.json'),
    JSON.stringify({ ...defaults, ...meta }, null, 2)
  );
  return sessDir;
}

/** Write conversation.jsonl entries to a session directory */
function writeConversation(sessDir, entries) {
  const lines = entries
    .map(e => JSON.stringify(e))
    .join('\n');
  fs.writeFileSync(path.join(sessDir, 'conversation.jsonl'), lines + '\n');
}

/** Write summary.md to a session directory */
function writeSummary(sessDir, text) {
  fs.writeFileSync(path.join(sessDir, 'summary.md'), text);
}

/** Write a debug.log file to a session directory */
function writeDebugLog(sessDir, text) {
  fs.writeFileSync(path.join(sessDir, 'debug.log'), text);
}

/** Parse the text content from an MCP handler result */
function parseResult(result) {
  return JSON.parse(result.content[0].text);
}

/** Get raw text from an MCP handler result */
function getText(result) {
  return result.content[0].text;
}

describe('MCP Headless Lifecycle Integration', () => {
  let tmpDir;
  let handlers;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-lifecycle-'));
    handlers = require('../src/mcp-server').handlers;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    jest.resetModules();
  });

  describe('Happy path: start -> poll -> complete -> read', () => {
    test('full lifecycle from running to complete with summary', async () => {
      const taskId = 'lifecycle-001';

      // Step 1: Create session in running state with pid=process.pid
      const sessDir = createSession(tmpDir, taskId, {
        status: 'running',
        pid: process.pid,
        model: 'gemini',
        briefing: 'Analyze auth module',
      });

      // Step 2: Write initial conversation entries
      writeConversation(sessDir, [
        { role: 'assistant', content: 'Starting analysis of auth module...' },
        { role: 'assistant', content: 'Found 3 potential issues in token validation.' },
      ]);

      // Step 3: Call amicus_status - verify status=running
      const statusResult = await handlers.amicus_status({ taskId }, tmpDir);
      const statusData = parseResult(statusResult);
      expect(statusData.taskId).toBe(taskId);
      expect(statusData.status).toBe('running');
      expect(statusData).toHaveProperty('elapsed');
      expect(statusResult.isError).toBeUndefined();

      // Step 4: Add more conversation entries (simulating progress)
      writeConversation(sessDir, [
        { role: 'assistant', content: 'Starting analysis of auth module...' },
        { role: 'assistant', content: 'Found 3 potential issues in token validation.' },
        { role: 'assistant', content: 'Fixing issue 1: expired token check...' },
        { role: 'assistant', content: 'Fixing issue 2: refresh token rotation...' },
        { role: 'assistant', content: 'All fixes applied. Running tests...' },
      ]);

      // Step 5: Simulate completion - update metadata, write summary
      const metaPath = path.join(sessDir, 'metadata.json');
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      meta.status = 'complete';
      meta.completedAt = new Date().toISOString();
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));

      writeSummary(sessDir, '## Auth Module Analysis\n\nFixed 3 issues in token validation.');

      // Step 6: Call amicus_status again - verify status=complete
      const finalStatus = await handlers.amicus_status({ taskId }, tmpDir);
      const finalData = parseResult(finalStatus);
      expect(finalData.status).toBe('complete');

      // Step 7: Call amicus_read - verify summary content
      const readResult = await handlers.amicus_read({ taskId }, tmpDir);
      expect(getText(readResult)).toContain('Auth Module Analysis');
      expect(getText(readResult)).toContain('Fixed 3 issues');
      expect(readResult.isError).toBeUndefined();
    });
  });

  describe('Progress via conversation read', () => {
    test('conversation grows over time and is readable', async () => {
      const taskId = 'progress-001';
      const sessDir = createSession(tmpDir, taskId, { status: 'running' });

      // No conversation yet - conversation mode returns no data
      const noConv = await handlers.amicus_read({ taskId, mode: 'conversation' }, tmpDir);
      expect(getText(noConv)).toContain('No conversation recorded');

      // Write 2 entries
      writeConversation(sessDir, [
        { role: 'assistant', content: 'Step 1 complete.' },
        { role: 'assistant', content: 'Step 2 complete.' },
      ]);

      const conv2 = await handlers.amicus_read({ taskId, mode: 'conversation' }, tmpDir);
      expect(getText(conv2)).toContain('Step 1 complete');
      expect(getText(conv2)).toContain('Step 2 complete');

      // Write 5 entries (overwrite)
      writeConversation(sessDir, [
        { role: 'assistant', content: 'Step 1 complete.' },
        { role: 'assistant', content: 'Step 2 complete.' },
        { role: 'assistant', content: 'Step 3 complete.' },
        { role: 'assistant', content: 'Step 4 complete.' },
        { role: 'assistant', content: 'Step 5: All done.' },
      ]);

      const conv5 = await handlers.amicus_read({ taskId, mode: 'conversation' }, tmpDir);
      const text = getText(conv5);
      expect(text).toContain('Step 5: All done');
      // Count the JSONL lines
      const lines = text.trim().split('\n').filter(l => l.trim());
      expect(lines.length).toBe(5);
    });
  });

  describe('Dead PID detection via abort', () => {
    test('aborting a session with a dead PID still marks it aborted', async () => {
      const taskId = 'deadpid-001';
      // PID 2147483647 is virtually guaranteed to not exist
      createSession(tmpDir, taskId, {
        status: 'running',
        pid: 2147483647,
      });

      // amicus_abort should handle ESRCH gracefully
      const result = await handlers.amicus_abort({ taskId }, tmpDir);
      expect(result.isError).toBeUndefined();
      const data = parseResult(result);
      expect(data.status).toBe('aborted');

      // Verify metadata was updated on disk
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', taskId);
      const meta = JSON.parse(fs.readFileSync(path.join(sessDir, 'metadata.json'), 'utf-8'));
      expect(meta.status).toBe('aborted');
      expect(meta.abortedAt).toBeDefined();
    });

    test('status shows aborted after abort', async () => {
      const taskId = 'deadpid-002';
      createSession(tmpDir, taskId, {
        status: 'running',
        pid: 2147483647,
      });

      await handlers.amicus_abort({ taskId }, tmpDir);

      const status = await handlers.amicus_status({ taskId }, tmpDir);
      const data = parseResult(status);
      expect(data.status).toBe('aborted');
    });
  });

  describe('Timeout scenario', () => {
    test('completed session with timedOut flag reports complete status', async () => {
      const taskId = 'timeout-001';
      const sessDir = createSession(tmpDir, taskId, {
        status: 'complete',
        timedOut: true,
        completedAt: new Date().toISOString(),
      });

      // Write partial output as summary
      writeSummary(sessDir, '## Partial Results\n\nTask timed out after 15 minutes. Partial analysis below.');

      const status = await handlers.amicus_status({ taskId }, tmpDir);
      const data = parseResult(status);
      expect(data.status).toBe('complete');

      // amicus_read returns partial summary
      const read = await handlers.amicus_read({ taskId }, tmpDir);
      expect(getText(read)).toContain('Partial Results');
      expect(getText(read)).toContain('timed out');
    });

    test('timed-out session metadata is readable', async () => {
      const taskId = 'timeout-002';
      createSession(tmpDir, taskId, {
        status: 'complete',
        timedOut: true,
        model: 'o3',
        briefing: 'Complex refactoring task',
      });

      const read = await handlers.amicus_read({ taskId, mode: 'metadata' }, tmpDir);
      const meta = JSON.parse(getText(read));
      expect(meta.timedOut).toBe(true);
      expect(meta.model).toBe('o3');
    });
  });

  describe('Abort workflow: start -> abort -> verify', () => {
    test('abort running session with live PID', async () => {
      const taskId = 'abort-live-001';
      // Use process.pid as a known-alive PID
      createSession(tmpDir, taskId, {
        status: 'running',
        pid: process.pid,
      });

      // Mock process.kill to prevent actually killing ourselves
      const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => {});

      try {
        const result = await handlers.amicus_abort({ taskId }, tmpDir);
        const data = parseResult(result);
        expect(data.status).toBe('aborted');
        expect(data.taskId).toBe(taskId);

        // Verify process.kill was called with our PID
        expect(killSpy).toHaveBeenCalledWith(process.pid, 'SIGTERM');

        // Verify status persisted
        const status = await handlers.amicus_status({ taskId }, tmpDir);
        expect(parseResult(status).status).toBe('aborted');
      } finally {
        killSpy.mockRestore();
      }
    });

    test('abort a non-running session returns informational message', async () => {
      const taskId = 'abort-done-001';
      createSession(tmpDir, taskId, { status: 'complete' });

      const result = await handlers.amicus_abort({ taskId }, tmpDir);
      expect(getText(result)).toContain('not running');
    });

    test('abort a nonexistent session returns error', async () => {
      const result = await handlers.amicus_abort({ taskId: 'nope-nope' }, tmpDir);
      expect(result.isError).toBe(true);
      expect(getText(result)).toContain('not found');
    });

    test('abort persists abortedAt timestamp', async () => {
      const taskId = 'abort-ts-001';
      createSession(tmpDir, taskId, {
        status: 'running',
        pid: 2147483647,
      });

      const before = new Date().toISOString();
      await handlers.amicus_abort({ taskId }, tmpDir);

      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', taskId);
      const meta = JSON.parse(fs.readFileSync(path.join(sessDir, 'metadata.json'), 'utf-8'));
      expect(meta.abortedAt).toBeDefined();
      expect(new Date(meta.abortedAt).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime());
    });
  });

  describe('PID preservation in metadata', () => {
    test('createSessionMetadata preserves existing metadata layout', () => {
      const { createSessionMetadata } = require('../src/sidecar/start');
      const taskId = 'pid-preserve-001';

      // First, write metadata with a PID (simulating what MCP handler does).
      // createSessionMetadata now writes to the canonical amicus dir, so the
      // pre-seeded fixture and read-back must live there too.
      const sessDir = path.join(tmpDir, '.claude', 'amicus_sessions', taskId);
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(
        path.join(sessDir, 'metadata.json'),
        JSON.stringify({ taskId, status: 'running', pid: 12345, createdAt: new Date().toISOString() }, null, 2)
      );

      // createSessionMetadata overwrites metadata (it creates fresh metadata)
      createSessionMetadata(taskId, tmpDir, {
        model: 'gemini',
        prompt: 'test task',
        noUi: true,
      });

      const meta = JSON.parse(fs.readFileSync(path.join(sessDir, 'metadata.json'), 'utf-8'));
      // The function creates metadata with standard fields
      expect(meta.taskId).toBe(taskId);
      expect(meta.status).toBe('running');
      expect(meta.model).toBe('gemini');
      expect(meta.briefing).toBe('test task');
      expect(meta.mode).toBe('headless');
    });
  });

  describe('Debug log capture', () => {
    test('debug.log file is created and readable in session directory', async () => {
      const taskId = 'debug-001';
      const sessDir = createSession(tmpDir, taskId, {
        status: 'error',
        error: 'Server crashed unexpectedly',
      });

      writeDebugLog(sessDir, 'Error: ECONNREFUSED at 127.0.0.1:4321\nStack trace...\n');

      // Verify debug.log exists and is readable
      const debugPath = path.join(sessDir, 'debug.log');
      expect(fs.existsSync(debugPath)).toBe(true);
      const content = fs.readFileSync(debugPath, 'utf-8');
      expect(content).toContain('ECONNREFUSED');

      // Status still shows error state
      const status = await handlers.amicus_status({ taskId }, tmpDir);
      const data = parseResult(status);
      expect(data.status).toBe('error');

      // Metadata mode shows error details
      const metaResult = await handlers.amicus_read({ taskId, mode: 'metadata' }, tmpDir);
      const meta = JSON.parse(getText(metaResult));
      expect(meta.error).toContain('crashed');
    });
  });

  describe('Progress tracking through amicus_status', () => {
    test('status reflects progress.json lifecycle stages', async () => {
      const taskId = 'progress-stage-001';
      const { writeProgress } = require('../src/sidecar/progress');

      // Step 1: Create session - no progress.json yet
      const sessDir = createSession(tmpDir, taskId, {
        status: 'running',
        pid: process.pid,
      });

      const status1 = await handlers.amicus_status({ taskId }, tmpDir);
      const data1 = parseResult(status1);
      expect(data1.status).toBe('running');
      expect(data1.latest).toBe('Starting up...');
      expect(data1.messages).toBe(0);

      // Step 2: Write initializing stage
      writeProgress(sessDir, 'initializing');

      const status2 = await handlers.amicus_status({ taskId }, tmpDir);
      const data2 = parseResult(status2);
      expect(data2.stage).toBe('initializing');
      expect(data2.latest).toBe('Starting OpenCode server...');
      expect(data2.messages).toBe(0);

      // Step 3: Write prompt_sent stage
      writeProgress(sessDir, 'prompt_sent');

      const status3 = await handlers.amicus_status({ taskId }, tmpDir);
      const data3 = parseResult(status3);
      expect(data3.stage).toBe('prompt_sent');
      expect(data3.latest).toBe('Briefing delivered, waiting for response...');
      expect(data3.messages).toBe(0);

      // Step 4: Write receiving stage with tool call
      writeProgress(sessDir, 'receiving', {
        messagesReceived: 1,
        latestTool: 'web_search',
        stageLabel: 'Calling tool: web_search',
      });

      // Also add a tool_use entry to conversation.jsonl (simulating headless.js)
      writeConversation(sessDir, [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'Search the web' },
        { role: 'assistant', type: 'tool_use', toolCall: { id: 't1', name: 'web_search' } },
      ]);

      const status4 = await handlers.amicus_status({ taskId }, tmpDir);
      const data4 = parseResult(status4);
      expect(data4.stage).toBe('receiving');
      expect(data4.latest).toBe('Using web_search');
      expect(data4.messages).toBe(1);

      // Step 5: Tool_use entry WITHOUT name (SDK doesn't populate part.name)
      writeConversation(sessDir, [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'Search the web' },
        { role: 'assistant', type: 'tool_use', toolCall: { id: 't1' } },
      ]);
      writeProgress(sessDir, 'receiving', {
        messagesReceived: 1,
        latestTool: 'web_search',
        stageLabel: 'Calling tool: web_search',
      });

      const status5 = await handlers.amicus_status({ taskId }, tmpDir);
      const data5 = parseResult(status5);
      // extractLatest returns "Executing tool call..." but progress.json
      // has latestTool, so readProgress overrides with "Calling tool: web_search"
      expect(data5.latest).toBe('Calling tool: web_search');

      // Step 6: Text output arrives
      writeConversation(sessDir, [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'Search the web' },
        { role: 'assistant', type: 'tool_use', toolCall: { id: 't1' } },
        { role: 'assistant', content: 'Here are the search results for your query.' },
      ]);

      const status6 = await handlers.amicus_status({ taskId }, tmpDir);
      const data6 = parseResult(status6);
      expect(data6.messages).toBe(2);
      expect(data6.latest).toBe('Here are the search results for your query.');
    });

    test('status without progress.json falls back to conversation.jsonl', async () => {
      const taskId = 'progress-fallback-001';
      const sessDir = createSession(tmpDir, taskId, {
        status: 'running',
        pid: process.pid,
      });

      // No progress.json - only conversation.jsonl
      writeConversation(sessDir, [
        { role: 'assistant', content: 'Analyzing code...' },
        { role: 'assistant', toolCall: { name: 'Read', id: 'r1' } },
      ]);

      const status = await handlers.amicus_status({ taskId }, tmpDir);
      const data = parseResult(status);
      expect(data.messages).toBe(2);
      expect(data.latest).toBe('Using Read');
      expect(data.stage).toBeUndefined();
    });
  });

  describe('No conversation yet', () => {
    test('session with no conversation file returns appropriate message', async () => {
      const taskId = 'empty-001';
      createSession(tmpDir, taskId, { status: 'running' });

      // Reading conversation mode when no file exists
      const conv = await handlers.amicus_read({ taskId, mode: 'conversation' }, tmpDir);
      expect(getText(conv)).toContain('No conversation recorded');

      // Status is still running
      const status = await handlers.amicus_status({ taskId }, tmpDir);
      expect(parseResult(status).status).toBe('running');
    });

    test('session with no summary file returns appropriate message', async () => {
      const taskId = 'empty-002';
      createSession(tmpDir, taskId, { status: 'running' });

      // Reading summary when session is still running
      const summary = await handlers.amicus_read({ taskId }, tmpDir);
      expect(getText(summary)).toContain('No summary available');
    });
  });

  describe('List filtering during lifecycle', () => {
    test('list shows sessions across different statuses', async () => {
      createSession(tmpDir, 'run-1', { status: 'running', createdAt: '2026-03-08T10:00:00Z' });
      createSession(tmpDir, 'done-1', { status: 'complete', createdAt: '2026-03-08T09:00:00Z' });
      createSession(tmpDir, 'abort-1', { status: 'aborted', createdAt: '2026-03-08T08:00:00Z' });

      // List all
      const all = await handlers.amicus_list({}, tmpDir);
      const allData = parseResult(all);
      expect(allData.length).toBe(3);

      // Filter running
      const running = await handlers.amicus_list({ status: 'running' }, tmpDir);
      const runData = parseResult(running);
      expect(runData.length).toBe(1);
      expect(runData[0].id).toBe('run-1');

      // Filter complete
      const complete = await handlers.amicus_list({ status: 'complete' }, tmpDir);
      const completeData = parseResult(complete);
      expect(completeData.length).toBe(1);
      expect(completeData[0].id).toBe('done-1');

      // Filter aborted
      const aborted = await handlers.amicus_list({ status: 'aborted' }, tmpDir);
      const abortedData = parseResult(aborted);
      expect(abortedData.length).toBe(1);
      expect(abortedData[0].id).toBe('abort-1');
    });

    test('list returns sorted by createdAt descending', async () => {
      createSession(tmpDir, 'first', { status: 'complete', createdAt: '2026-03-08T08:00:00Z' });
      createSession(tmpDir, 'second', { status: 'complete', createdAt: '2026-03-08T09:00:00Z' });
      createSession(tmpDir, 'third', { status: 'complete', createdAt: '2026-03-08T10:00:00Z' });

      const result = await handlers.amicus_list({}, tmpDir);
      const data = parseResult(result);
      expect(data[0].id).toBe('third');
      expect(data[1].id).toBe('second');
      expect(data[2].id).toBe('first');
    });
  });

  describe('Status elapsed time', () => {
    test('elapsed time is calculated from createdAt', async () => {
      const taskId = 'elapsed-001';
      // Created 2 minutes ago
      const twoMinAgo = new Date(Date.now() - 120000).toISOString();
      createSession(tmpDir, taskId, {
        status: 'running',
        createdAt: twoMinAgo,
      });

      const status = await handlers.amicus_status({ taskId }, tmpDir);
      const data = parseResult(status);
      // Should show approximately 2m in the elapsed field
      expect(data.elapsed).toMatch(/^2m \d+s$/);
    });
  });

  describe('Read modes', () => {
    test('default read mode returns summary', async () => {
      const taskId = 'readmode-001';
      const sessDir = createSession(tmpDir, taskId, { status: 'complete' });
      writeSummary(sessDir, '## Summary Content\n\nDone.');

      const result = await handlers.amicus_read({ taskId }, tmpDir);
      expect(getText(result)).toContain('Summary Content');
    });

    test('metadata mode returns JSON metadata', async () => {
      const taskId = 'readmode-002';
      createSession(tmpDir, taskId, {
        status: 'complete',
        model: 'gpt-4o',
        briefing: 'Test read modes',
      });

      const result = await handlers.amicus_read({ taskId, mode: 'metadata' }, tmpDir);
      const meta = JSON.parse(getText(result));
      expect(meta.model).toBe('gpt-4o');
      expect(meta.briefing).toBe('Test read modes');
    });

    test('conversation mode returns JSONL content', async () => {
      const taskId = 'readmode-003';
      const sessDir = createSession(tmpDir, taskId, { status: 'complete' });
      writeConversation(sessDir, [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'World' },
      ]);

      const result = await handlers.amicus_read({ taskId, mode: 'conversation' }, tmpDir);
      const text = getText(result);
      expect(text).toContain('"role":"user"');
      expect(text).toContain('"role":"assistant"');
    });
  });

  describe('Error handling', () => {
    test('status for nonexistent session returns error', async () => {
      const result = await handlers.amicus_status({ taskId: 'no-such-task' }, tmpDir);
      expect(result.isError).toBe(true);
      expect(getText(result)).toContain('not found');
    });

    test('read for nonexistent session returns error', async () => {
      const result = await handlers.amicus_read({ taskId: 'no-such-task' }, tmpDir);
      expect(result.isError).toBe(true);
      expect(getText(result)).toContain('not found');
    });
  });
});
