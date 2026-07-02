/**
 * F6 / Task 6.2 — briefing/mode/agent in MCP-created metadata at creation.
 *
 * Covers both amicus_start write sites:
 *  - spawn-fallback initial metadata (exercised end-to-end via a mocked
 *    child_process, SIDECAR_SHARED_SERVER='0')
 *  - shared-server metadata write (source-contract check; the real shared
 *    path needs a live OpenCode server, so we pin the write's contents at
 *    the source level, matching tests/mcp-shared-server.test.js style)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

describe('amicus_start spawn-path initial metadata (F6)', () => {
  test('writes briefing + mode at creation', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-create-'));
    try {
      await jest.isolateModulesAsync(async () => {
        jest.doMock('child_process', () => ({
          spawn: jest.fn(() => ({ pid: 4242, unref: jest.fn() })),
        }));
        const prev = process.env.SIDECAR_SHARED_SERVER;
        process.env.SIDECAR_SHARED_SERVER = '0'; // force the spawn fallback
        try {
          const { handlers: h } = require('../src/mcp-server');
          const result = await h.amicus_start(
            { prompt: 'audit the auth module', noUi: true, model: 'google/gemini-test' }, tmpDir);
          const { taskId } = JSON.parse(result.content[0].text);
          const metaPath = path.join(tmpDir, '.claude', 'amicus_sessions', taskId, 'metadata.json');
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
          expect(meta.briefing).toBe('audit the auth module');
          expect(meta.mode).toBe('headless');
          expect(meta.headless).toBe(true);
        } finally {
          if (prev === undefined) { delete process.env.SIDECAR_SHARED_SERVER; }
          else { process.env.SIDECAR_SHARED_SERVER = prev; }
        }
      });
    } finally { fs.rmSync(tmpDir, { recursive: true, force: true }); }
  });

  test('writes briefing + interactive mode when noUi is false', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-create-ui-'));
    try {
      await jest.isolateModulesAsync(async () => {
        jest.doMock('child_process', () => ({
          spawn: jest.fn(() => ({ pid: 5252, unref: jest.fn() })),
        }));
        const prev = process.env.SIDECAR_SHARED_SERVER;
        process.env.SIDECAR_SHARED_SERVER = '0'; // force the spawn fallback
        try {
          const { handlers: h } = require('../src/mcp-server');
          const result = await h.amicus_start(
            { prompt: 'open interactively', noUi: false, model: 'google/gemini-test' }, tmpDir);
          const { taskId } = JSON.parse(result.content[0].text);
          const metaPath = path.join(tmpDir, '.claude', 'amicus_sessions', taskId, 'metadata.json');
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
          expect(meta.briefing).toBe('open interactively');
          expect(meta.mode).toBe('interactive');
          expect(meta.headless).toBe(false);
        } finally {
          if (prev === undefined) { delete process.env.SIDECAR_SHARED_SERVER; }
          else { process.env.SIDECAR_SHARED_SERVER = prev; }
        }
      });
    } finally { fs.rmSync(tmpDir, { recursive: true, force: true }); }
  });
});

describe('shared-server path metadata keys (source contract)', () => {
  // The shared path needs a live OpenCode server to exercise; pin the write's
  // contents at the source level instead (established repo style, see
  // tests/mcp-shared-server.test.js).
  const src = fs.readFileSync(path.join(__dirname, '../src/mcp-server.js'), 'utf-8');
  test('shared-server metadata write includes briefing/mode/agent', () => {
    const start = src.indexOf('opencodeSessionId: sessionId');
    const end = src.indexOf('buildContext(cwd');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const sharedWrite = src.slice(start, end);
    expect(sharedWrite).toContain('briefing: input.prompt');
    expect(sharedWrite).toContain("mode: 'headless'");
    expect(sharedWrite).toContain("agent: agent || 'build'");
  });
});
