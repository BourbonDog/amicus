'use strict';

// #61 Task 7.3: continue's explicit --model now routes through the SAME
// gateway router bridge as start (resolveLaunchModel, start-helpers.js)
// instead of the legacy resolveModelFromArgs/validateFallbackModel pair.
// resolveLaunchModel's own branch-by-branch behavior (resolved/error/
// selection_required) is already covered exhaustively by
// tests/start-helpers-routing.test.js — this file proves the WIRING: that
// handleContinue actually calls into that same path and surfaces the same
// structured route error / exit(1) contract start does.
//
// route-launch is mocked (network/catalog-touching); route-error is NOT
// mocked — it's pure, so its real rendering is exercised end to end.

function loadHandleContinue({ resolveRouteForLaunch, loadConfig = () => null } = {}) {
  jest.resetModules();
  jest.doMock('../src/utils/config', () => ({
    loadConfig,
    resolveGatewayMode: () => 'auto',
  }));
  if (resolveRouteForLaunch) {
    jest.doMock('../src/utils/route-launch', () => ({ resolveRouteForLaunch }));
  }
  return require('../src/cli-handlers-resume-continue');
}

afterEach(() => {
  // Every module any test in this file doMocks must be unmocked here —
  // jest.resetModules() alone only clears the module registry cache, it does
  // NOT undo a jest.doMock() registration, so a stale mock (e.g. '../src/index'
  // from an earlier test's continueAmicus stub) would otherwise silently leak
  // into later tests that expect the REAL implementation.
  jest.dontMock('../src/utils/config');
  jest.dontMock('../src/utils/route-launch');
  jest.dontMock('../src/index');
  jest.dontMock('../src/headless');
  jest.dontMock('../src/utils/logger');
  jest.dontMock('../src/utils/model-catalog');
  jest.resetModules();
});

// #61 whole-branch review FIX 4 (cheap parity): handleStart validates
// --gateway via validateStartArgs (cli.js) — continue never did, so a
// typo'd value silently fell through to resolveGatewayMode's pass-through
// instead of failing fast with a clear error.
describe('handleContinue validates --gateway (#61 whole-branch review FIX 4)', () => {
  test('an invalid --gateway value fails fast, before any routing occurs (json mode)', async () => {
    const resolveRouteForLaunch = jest.fn();
    const { handleContinue } = loadHandleContinue({ resolveRouteForLaunch });
    const outSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((c) => { throw new Error(`exit:${c}`); });

    await expect(handleContinue({
      _: ['continue', 'sometask'], json: true, 'no-ui': true, prompt: 'hi', gateway: 'bogus',
    })).rejects.toThrow('exit:1');

    expect(resolveRouteForLaunch).not.toHaveBeenCalled();
    const written = outSpy.mock.calls.map((c) => c[0]).join('');
    const doc = JSON.parse(written.trim());
    expect(doc.error).toMatchObject({ code: 'BAD_ARGS' });
    expect(doc.error.message).toContain('--gateway must be one of: auto, direct, openrouter');

    outSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test('an invalid --gateway value fails fast even with no --model given', async () => {
    const resolveRouteForLaunch = jest.fn();
    const { handleContinue } = loadHandleContinue({ resolveRouteForLaunch });
    const errSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((c) => { throw new Error(`exit:${c}`); });

    await expect(handleContinue({
      _: ['continue', 'sometask'], 'no-ui': true, prompt: 'hi', gateway: 'bogus',
    })).rejects.toThrow('exit:1');

    expect(resolveRouteForLaunch).not.toHaveBeenCalled();
    const written = errSpy.mock.calls.map((c) => c[0]).join('');
    expect(written).toContain('--gateway must be one of: auto, direct, openrouter');

    errSpy.mockRestore();
    exitSpy.mockRestore();
  });
});

describe('handleContinue --model routes through the gateway router (#61 Task 7.3)', () => {
  test('a gateway-only vendor with no OpenRouter key routes and fails with the structured route error (mirrors start)', async () => {
    // x-ai has no direct integration (provider-registry.js) — resolveRoute's
    // gateway-only-vendor branch requires an OpenRouter key; simulate none.
    const resolveRouteForLaunch = jest.fn().mockResolvedValue({
      kind: 'error', type: 'model_route_error', field: 'model', requested: 'x-ai/grok-4.3',
      reason: 'no_openrouter_key', preferredGateway: 'openrouter', suggestions: [],
    });
    const { handleContinue } = loadHandleContinue({ resolveRouteForLaunch });
    const errSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const outSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((c) => { throw new Error(`exit:${c}`); });

    await expect(handleContinue({
      _: ['continue', 'sometask'], json: true, 'no-ui': true, prompt: 'hi', model: 'x-ai/grok-4.3',
    })).rejects.toThrow('exit:1');

    expect(resolveRouteForLaunch).toHaveBeenCalledWith(expect.objectContaining({
      model: 'x-ai/grok-4.3', gatewayMode: 'auto', source: 'cli', allowSelection: false, validateModel: true,
    }));
    expect(exitSpy).toHaveBeenCalledWith(1);
    const written = outSpy.mock.calls.map((c) => c[0]).join('');
    const doc = JSON.parse(written.trim());
    expect(doc).toMatchObject({ type: 'error', ok: false, error: { code: 'MISSING_KEY' } });
    expect(doc.error.message).toContain('x-ai/grok-4.3');

    errSpy.mockRestore();
    outSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test('a resolved route rewrites args.model to the router executableId and forwards gateway/resolutionVersion (#61 Task 5.2, best-effort provenance)', async () => {
    const resolveRouteForLaunch = jest.fn().mockResolvedValue({
      kind: 'resolved', gateway: 'direct', executableId: 'google/gemini-2.5-flash',
      provenance: { source: 'cli', resolutionVersion: 1 },
    });
    jest.resetModules();
    jest.doMock('../src/utils/config', () => ({ loadConfig: () => null, resolveGatewayMode: () => 'auto' }));
    jest.doMock('../src/utils/route-launch', () => ({ resolveRouteForLaunch }));
    const mockContinueAmicus = jest.fn().mockResolvedValue({ ok: true });
    jest.doMock('../src/index', () => ({ continueAmicus: mockContinueAmicus }));
    const { handleContinue } = require('../src/cli-handlers-resume-continue');

    await handleContinue({
      _: ['continue', 'sometask'], 'no-ui': true, prompt: 'hi', model: 'gemini',
    });

    expect(mockContinueAmicus).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'google/gemini-2.5-flash', gateway: 'direct', resolutionVersion: 1 })
    );
  });

  test('no --model given: the prior session model is inherited verbatim, never re-routed, and no fresh provenance is forwarded', async () => {
    const resolveRouteForLaunch = jest.fn();
    jest.resetModules();
    jest.doMock('../src/utils/config', () => ({ loadConfig: () => null, resolveGatewayMode: () => 'auto' }));
    jest.doMock('../src/utils/route-launch', () => ({ resolveRouteForLaunch }));
    const mockContinueAmicus = jest.fn().mockResolvedValue({ ok: true });
    jest.doMock('../src/index', () => ({ continueAmicus: mockContinueAmicus }));
    const { handleContinue } = require('../src/cli-handlers-resume-continue');

    await handleContinue({ _: ['continue', 'sometask'], 'no-ui': true, prompt: 'hi' });

    expect(resolveRouteForLaunch).not.toHaveBeenCalled();
    expect(mockContinueAmicus).toHaveBeenCalledWith(
      expect.objectContaining({ model: undefined, gateway: undefined, resolutionVersion: undefined })
    );
  });
});

describe('continue session metadata records route provenance end-to-end (#61 Task 5.2, best-effort)', () => {
  test('an explicit --model resolution writes gateway + resolutionVersion into the NEW session metadata.json', async () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-cont-prov-'));
    const oldDir = path.join(projectDir, '.claude', 'amicus_sessions', 'oldprov1');
    fs.mkdirSync(oldDir, { recursive: true });
    fs.writeFileSync(path.join(oldDir, 'metadata.json'), JSON.stringify({
      taskId: 'oldprov1', model: 'google/gemini-2.5-flash', agent: 'build',
      briefing: 'orig', createdAt: new Date().toISOString(), status: 'complete',
    }));

    const resolveRouteForLaunch = jest.fn().mockResolvedValue({
      kind: 'resolved', gateway: 'direct', executableId: 'openai/gpt-5.5',
      provenance: { source: 'cli', resolutionVersion: 1 },
    });
    jest.resetModules();
    jest.doMock('../src/utils/config', () => ({ loadConfig: () => null, resolveGatewayMode: () => 'auto' }));
    jest.doMock('../src/utils/route-launch', () => ({ resolveRouteForLaunch }));
    jest.doMock('../src/headless', () => ({
      runHeadless: jest.fn().mockResolvedValue({
        summary: 'ok', completed: true, timedOut: false, aborted: false, taskId: 'newprov1',
      }),
    }));
    jest.doMock('../src/utils/logger', () => ({
      logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
    }));

    try {
      const { handleContinue } = require('../src/cli-handlers-resume-continue');
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      try {
        await handleContinue({
          _: ['continue', 'oldprov1'], 'no-ui': true, prompt: 'follow up',
          model: 'openai/gpt-5.5', 'task-id': 'newprov1', cwd: projectDir, timeout: 5,
        });
      } finally {
        logSpy.mockRestore();
      }

      const newMeta = JSON.parse(fs.readFileSync(
        path.join(projectDir, '.claude', 'amicus_sessions', 'newprov1', 'metadata.json'), 'utf-8'));
      expect(newMeta.gateway).toBe('direct');
      expect(newMeta.resolutionVersion).toBe(1);
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test('inheriting the prior model (no --model) never writes gateway/resolutionVersion into the NEW session metadata.json', async () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-cont-prov-inherit-'));
    const oldDir = path.join(projectDir, '.claude', 'amicus_sessions', 'oldprov2');
    fs.mkdirSync(oldDir, { recursive: true });
    fs.writeFileSync(path.join(oldDir, 'metadata.json'), JSON.stringify({
      taskId: 'oldprov2', model: 'google/gemini-2.5-flash', agent: 'build',
      briefing: 'orig', createdAt: new Date().toISOString(), status: 'complete',
    }));

    jest.resetModules();
    jest.doMock('../src/headless', () => ({
      runHeadless: jest.fn().mockResolvedValue({
        summary: 'ok', completed: true, timedOut: false, aborted: false, taskId: 'newprov2',
      }),
    }));
    jest.doMock('../src/utils/logger', () => ({
      logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
    }));
    // Inherited-model path: continueSidecar calls warnIfNotInCatalog(model),
    // which reads the live catalog — stub it so this test never touches the
    // network/disk cache (mirrors tests/sidecar/continue-resume-validation.test.js).
    jest.doMock('../src/utils/model-catalog', () => ({ getCatalog: jest.fn(async () => []) }));

    try {
      const { handleContinue } = require('../src/cli-handlers-resume-continue');
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      try {
        await handleContinue({
          _: ['continue', 'oldprov2'], 'no-ui': true, prompt: 'follow up',
          'task-id': 'newprov2', cwd: projectDir, timeout: 5,
        });
      } finally {
        logSpy.mockRestore();
      }

      const newMeta = JSON.parse(fs.readFileSync(
        path.join(projectDir, '.claude', 'amicus_sessions', 'newprov2', 'metadata.json'), 'utf-8'));
      expect(newMeta.gateway).toBeUndefined();
      expect(newMeta.resolutionVersion).toBeUndefined();
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });
});
