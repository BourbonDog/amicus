/**
 * Issue #36 follow-up — amicus_read must surface metadata.reason for a
 * terminally FAILED run that has NO usable summary.md.
 *
 * The original #36 guard only fired when summary.md EXISTED (the 0-byte
 * shared-server case). But a CRASHED session never writes summary.md at all,
 * so amicus_read hit the bare "No summary available" branch and the crash
 * reason was never shown. Same for timeout/aborted runs that produced no
 * summary. This verifies the reason is surfaced in those cases, while a
 * normal complete run is unchanged.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

function getText(result) {
  return result.content[0].text;
}

describe('amicus_read surfaces the failure reason when there is no summary (#36 follow-up)', () => {
  let tmpDir;
  let handlers;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-read-fail-'));
    handlers = require('../src/mcp-server').handlers;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    jest.resetModules();
  });

  function writeSession(taskId, meta, summary) {
    const sessDir = path.join(tmpDir, '.claude', 'amicus_sessions', taskId);
    fs.mkdirSync(sessDir, { recursive: true });
    fs.writeFileSync(
      path.join(sessDir, 'metadata.json'),
      JSON.stringify({ taskId, ...meta }, null, 2)
    );
    if (summary !== undefined) {
      fs.writeFileSync(path.join(sessDir, 'summary.md'), summary);
    }
    return sessDir;
  }

  test('crashed run with no summary.md surfaces the crash reason', async () => {
    const taskId = 'crashed-no-summary';
    writeSession(taskId, {
      status: 'crashed', model: 'gemini',
      reason: 'process exited with signal SIGSEGV',
    }); // no summary.md written at all

    const result = await handlers.amicus_read({ taskId }, tmpDir);
    const text = getText(result);
    expect(text).not.toContain('No summary available');
    expect(text).toContain('SIGSEGV');
    expect(text).toContain('crashed');
  });

  test('timeout run with no summary.md surfaces the reason', async () => {
    const taskId = 'timeout-no-summary';
    writeSession(taskId, {
      status: 'timeout', model: 'gpt',
      reason: 'session exceeded the 600s wall-clock limit',
    });

    const result = await handlers.amicus_read({ taskId }, tmpDir);
    const text = getText(result);
    expect(text).not.toContain('No summary available');
    expect(text).toContain('600s');
  });

  test('aborted run with an empty summary.md surfaces the reason', async () => {
    const taskId = 'aborted-empty-summary';
    writeSession(taskId, {
      status: 'aborted', model: 'gemini',
      reason: 'aborted by user via amicus_abort',
    }, '   \n'); // empty/whitespace-only summary

    const result = await handlers.amicus_read({ taskId }, tmpDir);
    const text = getText(result);
    expect(text).not.toContain('No summary available');
    expect(text).toContain('aborted by user');
  });

  test('a complete run with a real summary is unchanged', async () => {
    const taskId = 'complete-ok';
    writeSession(taskId, { status: 'complete', model: 'gemini' },
      '# Verdict\n\nLooks good to ship.');

    const result = await handlers.amicus_read({ taskId }, tmpDir);
    const text = getText(result);
    expect(text).toContain('Looks good to ship.');
    expect(text).not.toContain('Reason:');
    expect(text).not.toContain('No summary available');
  });

  test('a still-running session with no summary keeps the generic message', async () => {
    const taskId = 'still-running';
    writeSession(taskId, { status: 'running', model: 'gemini' });

    const result = await handlers.amicus_read({ taskId }, tmpDir);
    const text = getText(result);
    expect(text).toContain('No summary available');
  });
});
