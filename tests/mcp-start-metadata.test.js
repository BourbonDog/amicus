/**
 * F6 / Task 6.2 — briefing/mode/agent in MCP-created metadata at creation.
 *
 * Covers both amicus_start write sites:
 *  - spawn-fallback initial metadata (exercised end-to-end via a mocked
 *    child_process, AMICUS_SHARED_SERVER='0')
 *  - shared-server metadata write (source-contract check; the real shared
 *    path needs a live OpenCode server, so we pin the write's contents at
 *    the source level, matching tests/mcp-shared-server.test.js style)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// amicus_start routes the model through resolveRouteForLaunch (#61 Task 6.2).
// The synthetic 'google/gemini-test' model below exists to exercise metadata
// writes, not real routing — default-mock a deterministic passthrough
// (mirrors the same default mock in tests/mcp-server.test.js).
jest.mock('../src/utils/route-launch', () => ({
  resolveRouteForLaunch: jest.fn(async ({ model }) => ({
    kind: 'resolved',
    gateway: typeof model === 'string' && model.startsWith('openrouter/') ? 'openrouter' : 'direct',
    executableId: model,
    provenance: {},
  })),
}));

describe('amicus_start spawn-path initial metadata (F6)', () => {
  test('writes briefing + mode at creation', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-create-'));
    try {
      await jest.isolateModulesAsync(async () => {
        jest.doMock('child_process', () => ({
          spawn: jest.fn(() => ({ pid: 4242, unref: jest.fn() })),
        }));
        const prev = process.env.AMICUS_SHARED_SERVER;
        process.env.AMICUS_SHARED_SERVER = '0'; // force the spawn fallback
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
          if (prev === undefined) { delete process.env.AMICUS_SHARED_SERVER; }
          else { process.env.AMICUS_SHARED_SERVER = prev; }
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
        const prev = process.env.AMICUS_SHARED_SERVER;
        process.env.AMICUS_SHARED_SERVER = '0'; // force the spawn fallback
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
          if (prev === undefined) { delete process.env.AMICUS_SHARED_SERVER; }
          else { process.env.AMICUS_SHARED_SERVER = prev; }
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
    // v4.5 HOLD-gate decision 1 (parity): the shared-server path now renders a
    // pack-forwarded template before recording `briefing`, so this records
    // `renderedPrompt` (byte-identical to input.prompt when no pack template
    // applied) rather than the raw input — matching the CLI's own on-disk
    // briefing.md, which is always the rendered text.
    expect(sharedWrite).toContain('briefing: renderedPrompt');
    expect(sharedWrite).toContain("mode: 'headless'");
    expect(sharedWrite).toContain("agent: agent || 'build'");
  });

  // v4.7 F8 (D13, errata E-PR3-2): THE critical site. This shared-server branch
  // (sharedServer.enabled && input.noUi, the DEFAULT MCP headless path) never
  // spawns a CLI child, so argv forwarding (mcp-server.test.js's --tag tests)
  // can never reach it — input.tag must be stamped directly into this write,
  // same additive-only "absent (not null)" idiom as packRecord immediately
  // above it. Presence-only source-contract slice, same idiom as the pack
  // window tests above (mcp-pack-params.test.js).
  test('shared-server metadata write stamps input.tag additive-only (absent without a tag)', () => {
    const start = src.indexOf('opencodeSessionId: sessionId');
    const end = src.indexOf('buildContext(cwd');
    const sharedWrite = src.slice(start, end);
    expect(sharedWrite).toContain('...(input.tag ? { tag: input.tag } : {})');
  });
});
