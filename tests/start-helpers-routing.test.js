'use strict';

// resolveLaunchModel (#61 gateway routing integration, Task 4.5) — routes the
// `start` launch through resolveRouteForLaunch instead of the legacy
// resolveModelFromArgs/validateFallbackModel pair (those two are untouched;
// resume/continue still use them — see tests/start-helpers.test.js).
//
// route-launch (network/catalog-touching) is mocked per test, mirroring the
// pattern in tests/route-launch.test.js. route-error is NOT mocked — it's
// pure, so its real rendering is exercised end to end.

function loadStartHelpers({ resolveRouteForLaunch, loadConfig = () => null } = {}) {
  jest.resetModules();
  jest.doMock('../src/utils/config', () => ({
    loadConfig,
    resolveGatewayMode: () => 'auto',
  }));
  if (resolveRouteForLaunch) {
    jest.doMock('../src/utils/route-launch', () => ({ resolveRouteForLaunch }));
  }
  return require('../src/utils/start-helpers');
}

afterEach(() => {
  jest.dontMock('../src/utils/config');
  jest.dontMock('../src/utils/route-launch');
  jest.resetModules();
});

describe('resolveLaunchModel', () => {
  test('resolved: returns {model, alias, gateway} and writes nothing to stderr when there is no notice', async () => {
    const resolveRouteForLaunch = jest.fn().mockResolvedValue({
      kind: 'resolved', gateway: 'direct', executableId: 'openai/gpt-5.5', provenance: { source: 'cli' },
    });
    const { resolveLaunchModel } = loadStartHelpers({ resolveRouteForLaunch });
    const errSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const out = await resolveLaunchModel({ model: 'gpt' });

    expect(out).toMatchObject({ model: 'openai/gpt-5.5', alias: 'gpt', gateway: 'direct' });
    expect(resolveRouteForLaunch).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt', gatewayMode: 'auto', source: 'cli', allowSelection: false, validateModel: true,
    }));
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  test('resolved: --no-validate-model flips validateModel to false', async () => {
    const resolveRouteForLaunch = jest.fn().mockResolvedValue({
      kind: 'resolved', gateway: 'direct', executableId: 'openai/gpt-5.5', provenance: {},
    });
    const { resolveLaunchModel } = loadStartHelpers({ resolveRouteForLaunch });
    const errSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await resolveLaunchModel({ model: 'gpt', 'no-validate-model': true });

    expect(resolveRouteForLaunch).toHaveBeenCalledWith(expect.objectContaining({ validateModel: false }));
    errSpy.mockRestore();
  });

  test('resolved: prints the notice to stderr when present', async () => {
    const notice = "Model 'x' is unverified against the direct catalog; attempting anyway.";
    const resolveRouteForLaunch = jest.fn().mockResolvedValue({
      kind: 'resolved', gateway: 'openrouter', executableId: 'openrouter/openai/gpt-5.5', provenance: {}, notice,
    });
    const { resolveLaunchModel } = loadStartHelpers({ resolveRouteForLaunch });
    const errSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const out = await resolveLaunchModel({ model: 'gpt' });

    expect(out.model).toBe('openrouter/openai/gpt-5.5');
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining(notice));
    errSpy.mockRestore();
  });

  test('error: writes the human CLI message to stderr and exits 1', async () => {
    const resolveRouteForLaunch = jest.fn().mockResolvedValue({
      kind: 'error', type: 'model_route_error', field: 'model', requested: 'ghost/model',
      reason: 'model_not_found', preferredGateway: null, suggestions: [],
    });
    const { resolveLaunchModel } = loadStartHelpers({ resolveRouteForLaunch });
    const errSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((c) => { throw new Error(`exit:${c}`); });

    await expect(resolveLaunchModel({ model: 'ghost/model' })).rejects.toThrow('exit:1');

    expect(exitSpy).toHaveBeenCalledWith(1);
    const written = errSpy.mock.calls.map((c) => c[0]).join('');
    expect(written).toMatch(/not found in the catalog/);
    expect(written).not.toContain('"type":"model_route_error"'); // human text, not JSON
    errSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test('error with args.json:true writes structured JSON (type:model_route_error) to stderr and exits 1', async () => {
    const resolveRouteForLaunch = jest.fn().mockResolvedValue({
      kind: 'error', type: 'model_route_error', field: 'model', requested: 'ghost/model',
      reason: 'model_not_found', preferredGateway: null, suggestions: [],
    });
    const { resolveLaunchModel } = loadStartHelpers({ resolveRouteForLaunch });
    const errSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((c) => { throw new Error(`exit:${c}`); });

    await expect(resolveLaunchModel({ model: 'ghost/model', json: true })).rejects.toThrow('exit:1');

    expect(exitSpy).toHaveBeenCalledWith(1);
    const written = errSpy.mock.calls.map((c) => c[0]).join('');
    expect(written).toContain('"type":"model_route_error"');
    const doc = JSON.parse(written.trim());
    expect(doc).toMatchObject({ type: 'model_route_error', reason: 'model_not_found', requested: 'ghost/model' });
    errSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test('selection_required: renders (not an unhandled prompt) and exits 1 — interactive picker is Task 6.3', async () => {
    const resolveRouteForLaunch = jest.fn().mockResolvedValue({
      kind: 'selection_required', requested: 'gpt-5', suggestions: [{ model: 'openai/gpt-5.5', gateway: 'direct' }],
    });
    const { resolveLaunchModel } = loadStartHelpers({ resolveRouteForLaunch });
    const errSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((c) => { throw new Error(`exit:${c}`); });

    await expect(resolveLaunchModel({ model: 'gpt-5' })).rejects.toThrow('exit:1');

    expect(exitSpy).toHaveBeenCalledWith(1);
    const written = errSpy.mock.calls.map((c) => c[0]).join('');
    expect(written).toMatch(/Multiple models match/);
    errSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test('selection_required with args.json:true writes structured JSON with reason selection_required', async () => {
    const resolveRouteForLaunch = jest.fn().mockResolvedValue({
      kind: 'selection_required', requested: 'gpt-5', suggestions: [{ model: 'openai/gpt-5.5', gateway: 'direct' }],
    });
    const { resolveLaunchModel } = loadStartHelpers({ resolveRouteForLaunch });
    const errSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((c) => { throw new Error(`exit:${c}`); });

    await expect(resolveLaunchModel({ model: 'gpt-5', json: true })).rejects.toThrow('exit:1');

    const written = errSpy.mock.calls.map((c) => c[0]).join('');
    const doc = JSON.parse(written.trim());
    expect(doc).toMatchObject({ type: 'model_route_error', reason: 'selection_required', requested: 'gpt-5' });
    errSpy.mockRestore();
    exitSpy.mockRestore();
  });
});

describe('deriveAlias', () => {
  test('explicit no-slash alias is returned as-is', () => {
    const { deriveAlias } = loadStartHelpers();
    expect(deriveAlias({ model: 'gpt' })).toBe('gpt');
  });

  test('explicit slash-bearing model id -> undefined (not treated as an alias)', () => {
    const { deriveAlias } = loadStartHelpers();
    expect(deriveAlias({ model: 'openai/gpt-5.5' })).toBeUndefined();
  });

  test('undefined model + no-slash config default -> the config default', () => {
    const { deriveAlias } = loadStartHelpers({ loadConfig: () => ({ default: 'opus' }) });
    expect(deriveAlias({})).toBe('opus');
  });

  test('undefined model + slash-bearing config default -> undefined', () => {
    const { deriveAlias } = loadStartHelpers({ loadConfig: () => ({ default: 'anthropic/claude-opus-4-6' }) });
    expect(deriveAlias({})).toBeUndefined();
  });

  test('undefined model + no config at all -> undefined', () => {
    const { deriveAlias } = loadStartHelpers({ loadConfig: () => null });
    expect(deriveAlias({})).toBeUndefined();
  });
});
