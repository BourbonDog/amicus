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
        expect(parsed).toMatchObject({ schemaVersion: 2, type: 'error', ok: false });
        expect(parsed.error.code).toBe('BAD_MODEL');
        expect(parsed.error.message).toContain('could not be parsed');
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
        expect(parsed).toMatchObject({ schemaVersion: 2, type: 'error', ok: false });
        expect(parsed.error.code).toBe('MISSING_KEY'); // for the no_openrouter_key case
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

    // #61 whole-branch review FIX 2: maybeMigrationNotice (route-launch.js)
    // builds routeResult.notice AND burns the one-shot migration_notified
    // flag at resolution time — before this fix, amicus_start never surfaced
    // it anywhere (no CLI stderr exists for an MCP caller), so the flag-burn
    // never corresponded to anything the user/agent actually saw.
    test('a both-keys user routed direct: the response surfaces the router migration notice', async () => {
      let capturedArgs;
      await jest.isolateModulesAsync(async () => {
        jest.doMock('child_process', () => ({
          spawn: jest.fn((cmd, args) => {
            capturedArgs = args;
            return { pid: 99999, unref: jest.fn(), stdout: { on: jest.fn() }, stderr: { on: jest.fn() } };
          }),
        }));
        const resolveRouteForLaunch = jest.fn(async () => ({
          kind: 'resolved', gateway: 'direct', executableId: 'openai/gpt-5.5', provenance: {},
          notice: 'Routing openai via direct API (previously OpenRouter). ' +
            'Set routing.prefer: "openrouter" (or use --gateway openrouter) to restore.',
        }));
        jest.doMock('../src/utils/route-launch', () => ({ resolveRouteForLaunch }));
        const { handlers } = require('../src/mcp-server');
        const result = await handlers.amicus_start(
          { model: 'gpt', prompt: 'test', noUi: true }, tempDir
        );

        expect(result.isError).toBeUndefined();
        const texts = result.content.map(c => c.text);
        expect(texts.some(t => t.includes('Routing openai via direct API'))).toBe(true);
      });
      // Spawn path (the shared server cannot start in this test environment) —
      // confirms the model still routed correctly alongside the notice.
      expect(capturedArgs.includes('--model')).toBe(true);
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
        expect(parsed.type).toBe('error');
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

    test('validation failure returns the {schemaVersion, type:error} doc (v4.0 §7)', async () => {
      const handlers = require('../src/mcp-server').handlers;
      const res = await handlers.amicus_start({ prompt: '' }, process.cwd());
      expect(res.isError).toBe(true);
      const parsed = JSON.parse(res.content[0].text);
      expect(parsed).toMatchObject({ schemaVersion: 2, type: 'error', ok: false });
      expect(parsed.error.code).toBe('MISSING_PROMPT');
      expect(parsed.error.message).toContain('prompt');
    });
  });

  // #61 whole-branch review FIX 3: amicus_continue's explicit --model now
  // routes through the SAME gateway router as amicus_start (resolveRouteForLaunch)
  // instead of the legacy tryResolveModel (alias-existence-only) pre-check, so
  // an unroutable model returns a structured model_route_error and never
  // spawns a child doomed to die opaquely. The no-model inherit-prior-session
  // path (last test below) is unchanged.
  describe('amicus_continue', () => {
    test('returns isError for invalid model override (real router: unparseable descriptor never reaches a key check)', async () => {
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
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.type).toBe('error');
        expect(parsed.error.message).toContain('could not be parsed');
      });
      expect(spawnCalled).toBe(false);
    });

    // #61 whole-branch review FIX 3 acceptance test (named in the task brief):
    // an unroutable new model on continue (gateway-only vendor forced direct)
    // returns the structured error and never spawns.
    test('unroutable new model (grok, --gateway direct): returns a structured model_route_error, never spawns', async () => {
      let spawnCalled = false;
      await jest.isolateModulesAsync(async () => {
        jest.doMock('child_process', () => ({
          spawn: jest.fn(() => {
            spawnCalled = true;
            return { pid: 99999, unref: jest.fn() };
          }),
        }));
        const resolveRouteForLaunch = jest.fn(async () => ({
          kind: 'error', type: 'model_route_error', field: 'model', requested: 'grok',
          reason: 'no_direct_integration', preferredGateway: 'direct', suggestions: [],
        }));
        jest.doMock('../src/utils/route-launch', () => ({ resolveRouteForLaunch }));
        const { handlers } = require('../src/mcp-server');
        const result = await handlers.amicus_continue(
          { taskId: 'prev-task', prompt: 'continue work', model: 'grok', gateway: 'direct' }, tempDir
        );

        expect(result.isError).toBe(true);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.type).toBe('error');
        expect(parsed.error.message).toContain('no direct API integration');
        expect(resolveRouteForLaunch).toHaveBeenCalledWith(expect.objectContaining({ model: 'grok', gatewayMode: 'direct' }));
      });
      expect(spawnCalled).toBe(false);
    });

    test('proceeds when model override is valid: forwards the router executableId, not the raw alias', async () => {
      writeConfig({
        default: 'gemini',
        aliases: { gemini: 'openrouter/google/gemini-3-flash-preview' },
      });

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
        // Deterministic — mirrors the amicus_start tests above; a real router
        // call here would depend on whichever API keys happen to be
        // configured on the machine running the suite (auth.json is NOT
        // scoped by AMICUS_CONFIG_DIR), which the alias-existence-only
        // legacy check this replaces never had to account for.
        const resolveRouteForLaunch = jest.fn(async () => ({
          kind: 'resolved', gateway: 'openrouter',
          executableId: 'openrouter/google/gemini-3-flash-preview', provenance: {},
        }));
        jest.doMock('../src/utils/route-launch', () => ({ resolveRouteForLaunch }));
        const { handlers } = require('../src/mcp-server');
        const result = await handlers.amicus_continue(
          { taskId: 'prev-task', prompt: 'continue', model: 'gemini' }, tempDir
        );

        expect(result.isError).toBeUndefined();
        expect(resolveRouteForLaunch).toHaveBeenCalledWith(expect.objectContaining({ model: 'gemini' }));
        const idx = capturedArgs.indexOf('--model');
        expect(idx).toBeGreaterThan(-1);
        expect(capturedArgs[idx + 1]).toBe('openrouter/google/gemini-3-flash-preview');
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
