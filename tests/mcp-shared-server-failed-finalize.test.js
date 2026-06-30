/**
 * Issue #36 — when the shared-server headless run fails, the MCP surface
 * (amicus_status / amicus_read) must report the failure, not silently report
 * success with a 0-byte summary.
 *
 * We simulate what the shared-server .then handler writes (via
 * finalizeHeadlessResult) for a failed run, then drive the real MCP handlers
 * to verify the user-facing behavior.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const { finalizeHeadlessResult } = require('../src/sidecar/session-finalize');

function getText(result) {
  return result.content[0].text;
}

describe('MCP surface for a failed shared-server run (#36)', () => {
  let tmpDir;
  let handlers;
  const taskId = 'failed-finalize-001';

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-failfin-'));
    handlers = require('../src/mcp-server').handlers;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    jest.resetModules();
  });

  function createRunningSession() {
    const sessDir = path.join(tmpDir, '.claude', 'amicus_sessions', taskId);
    fs.mkdirSync(sessDir, { recursive: true });
    fs.writeFileSync(
      path.join(sessDir, 'metadata.json'),
      JSON.stringify({
        taskId, status: 'running', pid: null, headless: true,
        model: 'gemini', createdAt: new Date().toISOString(),
      }, null, 2)
    );
    return sessDir;
  }

  test('amicus_status reports error (not complete) with the reason', async () => {
    const sessDir = createRunningSession();
    const meta = JSON.parse(fs.readFileSync(path.join(sessDir, 'metadata.json'), 'utf-8'));

    // Simulate the shared-server .then handler finalizing a fast-failed run.
    finalizeHeadlessResult(sessDir, { completed: false, error: '402 insufficient credits' }, tmpDir, meta);

    const statusResult = await handlers.amicus_status({ taskId }, tmpDir);
    const status = JSON.parse(getText(statusResult));
    expect(status.status).toBe('error');
    expect(status.status).not.toBe('complete');
    expect(status.reason).toContain('402');
  });

  test('amicus_read surfaces metadata.reason instead of the 0-byte summary', async () => {
    const sessDir = createRunningSession();
    const meta = JSON.parse(fs.readFileSync(path.join(sessDir, 'metadata.json'), 'utf-8'));
    finalizeHeadlessResult(sessDir, { completed: false, error: '402 insufficient credits' }, tmpDir, meta);

    // A failed run writes an EXISTING 0-byte summary.md, so amicus_read hits the
    // file-exists branch — it must NOT report "No summary available", and it must
    // surface the failure reason.
    const readResult = await handlers.amicus_read({ taskId }, tmpDir);
    const text = getText(readResult);
    expect(text).not.toContain('No summary available');
    expect(text).toContain('402');
  });
});
