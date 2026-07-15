/**
 * MCP Model Validation Tests
 *
 * amicus_continue below still does eager, syntactic-only model validation via
 * tryResolveModel (unmigrated — CLI parity note in start-helpers.js: "resume/
 * continue keep using that legacy pair until Tasks 5.2/7.3 migrate them too").
 *
 * amicus_start (#61 Task 6.2) no longer resolves models itself: it routes
 * through resolveRouteForLaunch (src/utils/route-launch.js) and renders a
 * structured `model_route_error` (src/utils/route-error.js) on failure,
 * mirroring the CLI's resolveLaunchModel (start-helpers.js). Most tests below
 * mock resolveRouteForLaunch directly (deterministic, no network/real-key
 * dependency, same pattern as tests/start-helpers-routing.test.js); one test
 * exercises the real router end to end (mirroring tests/route-launch.test.js's
 * deep-mock-the-I/O-only pattern) to prove the wiring itself, not just the
 * mock's passthrough.
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
    process.env.AMICUS_CONFIG_DIR = tempDir;
    jest.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    // maxRetries: Windows holds brief handles on freshly-written session files,
    // so a plain recursive rm can hit ENOTEMPTY; retry a few times (no-op on POSIX).
    fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    // Hygiene for the amicus_start tests below that jest.doMock these seams
    // (mirrors tests/route-launch.test.js's afterEach) — a no-op when a given
    // test never mocked them, so it's safe to run unconditionally, including
    // before/after the amicus_continue tests further down which never mock
    // any of these and must keep exercising the real config/router modules.
    jest.dontMock('../src/utils/route-launch');
    jest.dontMock('../src/utils/api-key-store');
    jest.dontMock('../src/utils/auth-json');
    jest.dontMock('../src/utils/model-catalog');
    jest.resetModules();
  });

  function writeConfig(config) {
    fs.writeFileSync(
      path.join(tempDir, 'config.json'),
      JSON.stringify(config, null, 2)
    );
  }

  describe('amicus_start (#61 Task 6.2: routed through resolveRouteForLaunch)', () => {
    test('unroutable model: returns a structured model_route_error, never spawns', async () => {
      let spawnCalled = false;
      await jest.isolateModulesAsync(async () => {
        jest.doMock('child_process', () => ({
          spawn: jest.fn(() => {
            spawnCalled = true;
            return { pid: 99999, unref: jest.fn() };
          }),
        }));
        jest.doMock('../src/utils/route-launch', () => ({
          resolveRouteForLaunch: jest.fn(async () => ({
            kind: 'error', type: 'model_route_error', field: 'model',
            requested: 'nonexistent-model', reason: 'invalid_descriptor',
            preferredGateway: null, suggestions: [],
          })),
        }));
        const { handlers } = require('../src/mcp-server');
        const result = await handlers.amicus_start(
          { model: 'nonexistent-model', prompt: 'test' }, tempDir
        );

        expect(result.isError).toBe(true);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed).toMatchObject({
          type: 'model_route_error', field: 'model',
          requested: 'nonexistent-model', reason: 'invalid_descriptor',
        });
      });
      expect(spawnCalled).toBe(false);
    });

    test('end-to-end (real router, not mocked): gateway-only vendor with no OpenRouter key -> no_openrouter_key', async () => {
      let spawnCalled = false;
      await jest.isolateModulesAsync(async () => {
        jest.doMock('child_process', () => ({
          spawn: jest.fn(() => {
            spawnCalled = true;
            return { pid: 99999, unref: jest.fn() };
          }),
        }));
        // Deep-mock only the I/O the real router touches (keys + catalog),
        // exactly as tests/route-launch.test.js does — route-launch,
        // model-descriptor, and gateway-router all run for real here.
        jest.doMock('../src/utils/api-key-store', () => ({ readApiKeys: () => ({}) }));
        jest.doMock('../src/utils/auth-json', () => ({ readAuthJsonKeys: () => ({}) }));
        jest.doMock('../src/utils/model-catalog', () => ({
          getCatalogInfo: async () => ({ models: [], lastRefreshError: null }),
        }));
        const { handlers } = require('../src/mcp-server');
        // x-ai has no direct integration (provider-registry.js) — a
        // gateway-only vendor with no OpenRouter key configured must fail
        // with 'no_openrouter_key', not silently fall through.
        const result = await handlers.amicus_start(
          { model: 'x-ai/grok-4.3', prompt: 'test' }, tempDir
        );

        expect(result.isError).toBe(true);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed).toMatchObject({
          type: 'model_route_error', reason: 'no_openrouter_key', preferredGateway: 'openrouter',
        });
      });
      expect(spawnCalled).toBe(false);
    });

    test('resolvable model: spawns using the router executableId, not the raw alias', async () => {
      let spawnCalled = false;
      let capturedArgs;
      await jest.isolateModulesAsync(async () => {
        jest.doMock('child_process', () => ({
          spawn: jest.fn((cmd, args) => {
            spawnCalled = true;
            capturedArgs = args;
            return { pid: 99999, unref: jest.fn(), stdout: { on: jest.fn() }, stderr: { on: jest.fn() } };
          }),
        }));
        const resolveRouteForLaunch = jest.fn(async () => ({
          kind: 'resolved', gateway: 'openrouter',
          executableId: 'openrouter/google/gemini-3-flash-preview', provenance: {},
        }));
        jest.doMock('../src/utils/route-launch', () => ({ resolveRouteForLaunch }));
        const { handlers } = require('../src/mcp-server');
        const result = await handlers.amicus_start(
          { model: 'gemini', prompt: 'test' }, tempDir
        );

        expect(result.isError).toBeUndefined();
        expect(resolveRouteForLaunch).toHaveBeenCalledWith(expect.objectContaining({ model: 'gemini' }));
        const idx = capturedArgs.indexOf('--model');
        expect(idx).toBeGreaterThan(-1);
        expect(capturedArgs[idx + 1]).toBe('openrouter/google/gemini-3-flash-preview');
      });
      expect(spawnCalled).toBe(true);
    });

    test('no model and no config default: model routing still returns a structured error, never a crash', async () => {
      // No config file at all.
      let spawnCalled = false;
      await jest.isolateModulesAsync(async () => {
        jest.doMock('child_process', () => ({
          spawn: jest.fn(() => {
            spawnCalled = true;
            return { pid: 99999, unref: jest.fn() };
          }),
        }));
        const resolveRouteForLaunch = jest.fn(async () => ({
          kind: 'error', type: 'model_route_error', field: 'model',
          requested: undefined, reason: 'invalid_descriptor', preferredGateway: 'auto', suggestions: [],
        }));
        jest.doMock('../src/utils/route-launch', () => ({ resolveRouteForLaunch }));
        const { handlers } = require('../src/mcp-server');
        const result = await handlers.amicus_start({ prompt: 'test' }, tempDir);

        expect(result.isError).toBe(true);
        expect(resolveRouteForLaunch).toHaveBeenCalledWith(expect.objectContaining({ model: undefined }));
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.type).toBe('model_route_error');
      });
      expect(spawnCalled).toBe(false);
    });

    test('no model but config has a default: the default alias is resolved and passed to the router', async () => {
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
        const resolveRouteForLaunch = jest.fn(async () => ({
          kind: 'resolved', gateway: 'openrouter',
          executableId: 'openrouter/google/gemini-3-flash-preview', provenance: {},
        }));
        jest.doMock('../src/utils/route-launch', () => ({ resolveRouteForLaunch }));
        const { handlers } = require('../src/mcp-server');
        const result = await handlers.amicus_start({ prompt: 'test' }, tempDir);

        expect(result.isError).toBeUndefined();
        expect(resolveRouteForLaunch).toHaveBeenCalledWith(expect.objectContaining({ model: 'gemini' }));
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
