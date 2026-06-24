/**
 * MCP Model Validation Tests
 *
 * Tests eager model validation in amicus_start and amicus_continue
 * MCP handlers. Invalid models should return isError: true immediately
 * instead of spawning a child process that crashes silently.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

describe('MCP eager model validation', () => {
  let tempDir;
  let originalEnv;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-mcp-val-'));
    originalEnv = { ...process.env };
    process.env.SIDECAR_CONFIG_DIR = tempDir;
    jest.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    // maxRetries: Windows holds brief handles on freshly-written session files,
    // so a plain recursive rm can hit ENOTEMPTY; retry a few times (no-op on POSIX).
    fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  function writeConfig(config) {
    fs.writeFileSync(
      path.join(tempDir, 'config.json'),
      JSON.stringify(config, null, 2)
    );
  }

  describe('amicus_start', () => {
    test('returns isError for unknown alias', async () => {
      writeConfig({
        default: 'gemini',
        aliases: { gemini: 'openrouter/google/gemini-3-flash-preview' },
      });

      let spawnCalled = false;
      await jest.isolateModulesAsync(async () => {
        jest.doMock('child_process', () => ({
          spawn: jest.fn(() => {
            spawnCalled = true;
            return { pid: 99999, unref: jest.fn() };
          }),
        }));
        const { handlers } = require('../src/mcp-server');
        const result = await handlers.amicus_start(
          { model: 'nonexistent-model', prompt: 'test' }, tempDir
        );

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('nonexistent-model');
      });
      expect(spawnCalled).toBe(false);
    });

    test('returns isError with amicus setup hint', async () => {
      writeConfig({
        default: 'gemini',
        aliases: { gemini: 'openrouter/google/gemini-3-flash-preview' },
      });

      await jest.isolateModulesAsync(async () => {
        jest.doMock('child_process', () => ({
          spawn: jest.fn(() => ({ pid: 99999, unref: jest.fn() })),
        }));
        const { handlers } = require('../src/mcp-server');
        const result = await handlers.amicus_start(
          { model: 'badmodel', prompt: 'test' }, tempDir
        );

        expect(result.isError).toBe(true);
        expect(result.content[0].text.toLowerCase()).toContain('amicus setup');
      });
    });

    test('proceeds to spawn with valid alias', async () => {
      writeConfig({
        default: 'gemini',
        aliases: { gemini: 'openrouter/google/gemini-3-flash-preview' },
      });

      let spawnCalled = false;
      await jest.isolateModulesAsync(async () => {
        jest.doMock('child_process', () => ({
          spawn: jest.fn(() => {
            spawnCalled = true;
            return { pid: 99999, unref: jest.fn() };
          }),
        }));
        const { handlers } = require('../src/mcp-server');
        const result = await handlers.amicus_start(
          { model: 'gemini', prompt: 'test' }, tempDir
        );

        expect(result.isError).toBeUndefined();
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.status).toBe('running');
      });
      expect(spawnCalled).toBe(true);
    });

    test('proceeds to spawn with full model ID', async () => {
      writeConfig({
        default: 'gemini',
        aliases: { gemini: 'openrouter/google/gemini-3-flash-preview' },
      });

      let spawnCalled = false;
      await jest.isolateModulesAsync(async () => {
        jest.doMock('child_process', () => ({
          spawn: jest.fn(() => {
            spawnCalled = true;
            return { pid: 99999, unref: jest.fn() };
          }),
        }));
        const { handlers } = require('../src/mcp-server');
        const result = await handlers.amicus_start(
          { model: 'openrouter/google/gemini-3-flash-preview', prompt: 'test' }, tempDir
        );

        expect(result.isError).toBeUndefined();
      });
      expect(spawnCalled).toBe(true);
    });

    test('returns isError when no model and no config default', async () => {
      // No config file at all
      let spawnCalled = false;
      await jest.isolateModulesAsync(async () => {
        jest.doMock('child_process', () => ({
          spawn: jest.fn(() => {
            spawnCalled = true;
            return { pid: 99999, unref: jest.fn() };
          }),
        }));
        const { handlers } = require('../src/mcp-server');
        const result = await handlers.amicus_start(
          { prompt: 'test' }, tempDir
        );

        expect(result.isError).toBe(true);
        expect(result.content[0].text.toLowerCase()).toContain('amicus setup');
      });
      expect(spawnCalled).toBe(false);
    });

    test('proceeds when no model but config has default', async () => {
      writeConfig({
        default: 'gemini',
        aliases: { gemini: 'openrouter/google/gemini-3-flash-preview' },
      });

      let spawnCalled = false;
      await jest.isolateModulesAsync(async () => {
        jest.doMock('child_process', () => ({
          spawn: jest.fn(() => {
            spawnCalled = true;
            return { pid: 99999, unref: jest.fn() };
          }),
        }));
        const { handlers } = require('../src/mcp-server');
        const result = await handlers.amicus_start(
          { prompt: 'test' }, tempDir
        );

        expect(result.isError).toBeUndefined();
      });
      expect(spawnCalled).toBe(true);
    });
  });

  describe('amicus_continue', () => {
    test('returns isError for invalid model override', async () => {
      writeConfig({
        default: 'gemini',
        aliases: { gemini: 'openrouter/google/gemini-3-flash-preview' },
      });

      let spawnCalled = false;
      await jest.isolateModulesAsync(async () => {
        jest.doMock('child_process', () => ({
          spawn: jest.fn(() => {
            spawnCalled = true;
            return { pid: 99999, unref: jest.fn() };
          }),
        }));
        const { handlers } = require('../src/mcp-server');
        const result = await handlers.amicus_continue(
          { taskId: 'prev-task', prompt: 'continue work', model: 'bogus-alias' }, tempDir
        );

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('bogus-alias');
      });
      expect(spawnCalled).toBe(false);
    });

    test('proceeds when model override is valid', async () => {
      writeConfig({
        default: 'gemini',
        aliases: { gemini: 'openrouter/google/gemini-3-flash-preview' },
      });

      let spawnCalled = false;
      await jest.isolateModulesAsync(async () => {
        jest.doMock('child_process', () => ({
          spawn: jest.fn(() => {
            spawnCalled = true;
            return { pid: 99999, unref: jest.fn() };
          }),
        }));
        const { handlers } = require('../src/mcp-server');
        const result = await handlers.amicus_continue(
          { taskId: 'prev-task', prompt: 'continue', model: 'gemini' }, tempDir
        );

        expect(result.isError).toBeUndefined();
      });
      expect(spawnCalled).toBe(true);
    });

    test('proceeds when no model override (uses original)', async () => {
      let spawnCalled = false;
      await jest.isolateModulesAsync(async () => {
        jest.doMock('child_process', () => ({
          spawn: jest.fn(() => {
            spawnCalled = true;
            return { pid: 99999, unref: jest.fn() };
          }),
        }));
        const { handlers } = require('../src/mcp-server');
        const result = await handlers.amicus_continue(
          { taskId: 'prev-task', prompt: 'continue' }, tempDir
        );

        // No model validation needed when no model override
        expect(result.isError).toBeUndefined();
      });
      expect(spawnCalled).toBe(true);
    });
  });
});
