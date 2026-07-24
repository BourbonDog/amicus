// tests/sidecar/fanout.test.js
'use strict';

// #61 Task 7.3: fanout leg models now route through resolveRouteForLaunch
// (the gateway router bridge) instead of tryResolveModel/validateApiKey/
// validateAgainstCatalog directly — mock the bridge so these tests never
// depend on the real machine's configured API keys or a live catalog fetch.
// Default: echo the requested model back as the resolved executableId (every
// orchestrator-test model string below is already a fully-qualified
// `vendor/model` or `openrouter/vendor/model` literal), matching the old
// tryResolveModel passthrough for a slash-bearing input byte for byte.
// Gateway is a three-value axis: 'openrouter' | 'local' | 'direct'. The
// `ollama/` prefix is a test-only convention (mirrors gateway-router.js's
// real local-provider executableId shape, `<vendor>/<model>`) letting a
// designated model resolve to 'local' so tests can cover the v4.2
// local-provider attribution path without touching any real model string
// used elsewhere in this file.
const mockResolveRouteForLaunch = jest.fn(async ({ model }) => ({
  kind: 'resolved',
  executableId: model,
  gateway: model.startsWith('openrouter/') ? 'openrouter'
    : model.startsWith('ollama/') ? 'local'
      : 'direct',
  provenance: {},
}));
jest.mock('../../src/utils/route-launch', () => ({
  resolveRouteForLaunch: (...args) => mockResolveRouteForLaunch(...args),
}));

jest.mock('../../src/utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const mockLookupPricing = jest.fn(() => null);
jest.mock('../../src/utils/pricing', () => {
  const actual = jest.requireActual('../../src/utils/pricing');
  return { ...actual, lookupPricing: (...args) => mockLookupPricing(...args) };
});

// --- additional mocks (place at top of file with the others) ---
const mockRunHeadless = jest.fn();
jest.mock('../../src/headless', () => {
  const actual = jest.requireActual('../../src/headless');
  return { ...actual, runHeadless: mockRunHeadless };
});

const mockServerClose = jest.fn();
const mockStartOpenCodeServer = jest.fn();
jest.mock('../../src/sidecar/session-utils', () => {
  const actual = jest.requireActual('../../src/sidecar/session-utils');
  return { ...actual, startOpenCodeServer: mockStartOpenCodeServer };
});

const mockBuildContext = jest.fn(() => 'CTX');
jest.mock('../../src/sidecar/context-builder', () => ({
  buildContext: mockBuildContext,
  parseDuration: jest.fn(),
}));
// --- end additional mocks ---

const { parseModelsList, deriveLegIds, validateFanoutModels, runFanout } = require('../../src/sidecar/fanout');

describe('fanout validation helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLookupPricing.mockReturnValue(null);
    delete process.env.AMICUS_FANOUT_MAX_LEGS;
  });

  describe('parseModelsList', () => {
    it('splits, trims, drops empties', () => {
      expect(parseModelsList(' a/b, c/d ,,e/f ')).toEqual(['a/b', 'c/d', 'e/f']);
    });
    it('allows duplicates (distinct legs)', () => {
      expect(parseModelsList('a/b,a/b')).toEqual(['a/b', 'a/b']);
    });
    it('returns [] for empty/boolean input', () => {
      expect(parseModelsList('')).toEqual([]);
      expect(parseModelsList(true)).toEqual([]);
      expect(parseModelsList(undefined)).toEqual([]);
    });
  });

  describe('deriveLegIds', () => {
    it('derives <waveId>-1..N in order', () => {
      expect(deriveLegIds('deadbeef', 3)).toEqual(['deadbeef-1', 'deadbeef-2', 'deadbeef-3']);
    });
    it('derived ids satisfy the task-id pattern', () => {
      const { TASK_ID_PATTERN } = jest.requireActual('../../src/utils/validators');
      for (const id of deriveLegIds('a1b2c3d4', 10)) {
        expect(TASK_ID_PATTERN.test(id)).toBe(true);
      }
    });
  });

  describe('validateFanoutModels', () => {
    it('errors on an empty list', async () => {
      const r = await validateFanoutModels('');
      expect(r.error).toMatch(/--models requires/);
    });

    it('enforces the leg cap (default 10, env-overridable)', async () => {
      const eleven = Array.from({ length: 11 }, (_, i) => `p/m${i}`).join(',');
      const r = await validateFanoutModels(eleven);
      expect(r.error).toMatch(/cap of 10/);

      process.env.AMICUS_FANOUT_MAX_LEGS = '12';
      const r2 = await validateFanoutModels(eleven);
      expect(r2.legs).toHaveLength(11);
    });

    it('routes every model through the gateway router and keeps the original input alongside (with pricing field)', async () => {
      const r = await validateFanoutModels('openrouter/a/b,c/d');
      expect(r.legs).toHaveLength(2);
      expect(r.legs[0]).toMatchObject({ modelInput: 'openrouter/a/b', ok: true, model: 'openrouter/a/b' });
      expect(r.legs[1]).toMatchObject({ modelInput: 'c/d', ok: true, model: 'c/d' });
      // pricing field is present (may be null if not in catalog)
      expect(Object.prototype.hasOwnProperty.call(r.legs[0], 'pricing')).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(r.legs[1], 'pricing')).toBe(true);
      expect(mockResolveRouteForLaunch).toHaveBeenCalledTimes(2);
    });

    // #61 whole-branch review FIX 2: a resolved leg carries its router notice
    // (or null) forward so runFanout can surface it on the wave doc — fanout
    // has no CLI-single stderr path to print it on directly.
    it('carries a resolved leg\'s routeResult.notice forward (null when absent)', async () => {
      mockResolveRouteForLaunch
        .mockImplementationOnce(async ({ model }) => ({
          kind: 'resolved', executableId: model, gateway: 'direct', provenance: {}, notice: 'migrated notice',
        }))
        .mockImplementationOnce(async ({ model }) => ({
          kind: 'resolved', executableId: model, gateway: 'direct', provenance: {},
        }));
      const r = await validateFanoutModels('a/b,c/d');
      expect(r.legs[0].notice).toBe('migrated notice');
      expect(r.legs[1].notice).toBeNull();
    });

    // #61 Task 7.3: a routing failure (missing key, catalog miss, unresolvable
    // alias) is now a PER-LEG outcome (`ok:false` + the router's RouteResult),
    // not a whole-list `{error}` — sibling legs must still resolve. The
    // pre-#61 fail-fast behavior for these three cases is superseded by the
    // gateway router (resolveRoute's key/catalog checks), which
    // validateFanoutModels now delegates to instead of tryResolveModel/
    // validateApiKey/validateAgainstCatalog directly.
    it('a leg with no key for its vendor fails ONLY that leg, not the whole list', async () => {
      mockResolveRouteForLaunch.mockImplementationOnce(async () => ({
        kind: 'error', type: 'model_route_error', field: 'model', requested: 'a/b',
        reason: 'no_key_for_vendor', preferredGateway: 'direct', suggestions: [],
      }));
      const r = await validateFanoutModels('a/b,c/d');
      expect(r.error).toBeUndefined();
      expect(r.legs[0]).toMatchObject({ modelInput: 'a/b', ok: false });
      expect(r.legs[0].routeResult.reason).toBe('no_key_for_vendor');
      expect(r.legs[1]).toMatchObject({ modelInput: 'c/d', ok: true, model: 'c/d' });
    });

    it('a catalog miss fails ONLY that leg; --no-validate-model flips validateModel through to the router', async () => {
      mockResolveRouteForLaunch.mockImplementationOnce(async () => ({
        kind: 'error', type: 'model_route_error', field: 'model', requested: 'a/zzz',
        reason: 'model_not_found', preferredGateway: 'direct', suggestions: [],
      }));
      const r = await validateFanoutModels('a/zzz');
      expect(r.legs).toHaveLength(1);
      expect(r.legs[0]).toMatchObject({ modelInput: 'a/zzz', ok: false });
      expect(r.legs[0].routeResult.reason).toBe('model_not_found');

      mockResolveRouteForLaunch.mockClear();
      const r2 = await validateFanoutModels('a/zzz', { noValidateModel: true });
      expect(r2.legs).toHaveLength(1);
      expect(mockResolveRouteForLaunch).toHaveBeenCalledWith(expect.objectContaining({ validateModel: false }));
    });

    it('an unresolvable/invalid model string fails ONLY that leg', async () => {
      mockResolveRouteForLaunch.mockImplementationOnce(async () => ({
        kind: 'error', type: 'model_route_error', field: 'model', requested: 'nosuchalias-xyz-f4',
        reason: 'invalid_descriptor', preferredGateway: 'auto', suggestions: [],
      }));
      const r = await validateFanoutModels('nosuchalias-xyz-f4');
      expect(r.legs).toHaveLength(1);
      expect(r.legs[0]).toMatchObject({ modelInput: 'nosuchalias-xyz-f4', ok: false });
      expect(r.legs[0].routeResult.reason).toBe('invalid_descriptor');
    });

    it('forwards gatewayMode to the router per leg (defaults to auto when unset)', async () => {
      await validateFanoutModels('a/b');
      expect(mockResolveRouteForLaunch).toHaveBeenCalledWith(expect.objectContaining({
        model: 'a/b', gatewayMode: 'auto', source: 'cli', allowSelection: false, validateModel: true,
      }));

      mockResolveRouteForLaunch.mockClear();
      await validateFanoutModels('a/b', { gatewayMode: 'direct' });
      expect(mockResolveRouteForLaunch).toHaveBeenCalledWith(expect.objectContaining({ gatewayMode: 'direct' }));
    });

    it('treats invalid AMICUS_FANOUT_MAX_LEGS values as unset (default cap applies)', async () => {
      const eleven = Array.from({ length: 11 }, (_, i) => `p/m${i}`).join(',');
      process.env.AMICUS_FANOUT_MAX_LEGS = 'garbage';
      expect((await validateFanoutModels(eleven)).error).toMatch(/cap of 10/);
      process.env.AMICUS_FANOUT_MAX_LEGS = '0';
      expect((await validateFanoutModels(eleven)).error).toMatch(/cap of 10/);
    });
  });
});

const fsReal = require('fs');
const os = require('os');
const pathReal = require('path');

describe('runFanout orchestrator', () => {
  let project;

  const legOk = (taskId) => ({
    summary: `summary ${taskId}`, completed: true, timedOut: false, aborted: false, taskId, toolCalls: [],
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockLookupPricing.mockReturnValue(null); // default: unpriced legs (existing tests unaffected)
    project = fsReal.mkdtempSync(pathReal.join(os.tmpdir(), 'amicus-fanout-'));
    mockStartOpenCodeServer.mockResolvedValue({
      client: { tag: 'client' },
      server: { url: 'http://127.0.0.1:1', close: mockServerClose, goPid: 4242 },
    });
    mockRunHeadless.mockImplementation(async (_m, _s, _u, taskId) => legOk(taskId));
  });

  afterEach(() => {
    fsReal.rmSync(project, { recursive: true, force: true });
  });

  const baseOpts = () => ({
    models: 'openrouter/a/b,openrouter/c/d',
    prompt: 'do the thing',
    promptMeta: { source: 'inline', file: null, chars: 12 },
    project,
    includeContext: false,
    noValidateModel: true,
    json: true,
    quiet: true, // suppress stdout in tests
  });

  it('starts ONE server, runs N legs with the shared client/server, returns a complete wave', async () => {
    const { wave, exitCode } = await runFanout(baseOpts());

    expect(mockStartOpenCodeServer).toHaveBeenCalledTimes(1);
    expect(mockRunHeadless).toHaveBeenCalledTimes(2);
    for (const call of mockRunHeadless.mock.calls) {
      const options = call[7];
      expect(options.client).toEqual({ tag: 'client' });
      expect(options.server.url).toBe('http://127.0.0.1:1');
      expect(options.watchdog).toBeDefined(); // injected per-leg watchdog
    }
    expect(mockServerClose).toHaveBeenCalledTimes(1);
    expect(wave.status).toBe('complete');
    expect(wave.counts).toMatchObject({ total: 2, complete: 2 });
    expect(exitCode).toBe(0);
  });

  it('feeds the shared server every resolved leg id (#61 Task 4.6/7.3 sole-input invariant)', async () => {
    await runFanout(baseOpts());
    expect(mockStartOpenCodeServer).toHaveBeenCalledTimes(1);
    const serverOpts = mockStartOpenCodeServer.mock.calls[0][1];
    expect(serverOpts).toMatchObject({ models: ['openrouter/a/b', 'openrouter/c/d'] });
  });

  // Whole-branch review FIX 1 (spec §6 judge isolation): a caller-supplied
  // `directory` must reach every leg's runHeadless call so its tool-exec cwd
  // is scoped, not just its session-metadata `project`. A caller that omits
  // it (every non-council fanout caller today) must see `undefined` reach
  // runHeadless too — i.e. behavior stays byte-for-byte unchanged for them.
  it('forwards a caller-supplied directory to every leg\'s runHeadless call', async () => {
    await runFanout({ ...baseOpts(), directory: '/scoped/run-dir' });
    expect(mockRunHeadless).toHaveBeenCalledTimes(2);
    for (const call of mockRunHeadless.mock.calls) {
      expect(call[7].directory).toBe('/scoped/run-dir');
    }
  });

  it('leaves runHeadless options.directory undefined when the caller omits it (non-council callers unaffected)', async () => {
    await runFanout(baseOpts());
    expect(mockRunHeadless).toHaveBeenCalledTimes(2);
    for (const call of mockRunHeadless.mock.calls) {
      expect(call[7].directory).toBeUndefined();
    }
  });

  // #61 whole-branch review FIX 2: a leg's migration notice (routeResult.notice)
  // had no CLI stderr to land on in fanout — one process resolves MANY legs,
  // not a single launch — so it must surface on the wave doc instead.
  it('surfaces a leg-level migration notice on the wave doc (FIX 2)', async () => {
    mockResolveRouteForLaunch.mockImplementationOnce(async ({ model }) => ({
      kind: 'resolved', executableId: model, gateway: 'direct', provenance: {},
      notice: 'Routing openai via direct API (previously OpenRouter). ' +
        'Set routing.prefer: "openrouter" (or use --gateway openrouter) to restore.',
    }));
    const { wave } = await runFanout(baseOpts());
    expect(wave.notices).toEqual([
      'Routing openai via direct API (previously OpenRouter). ' +
        'Set routing.prefer: "openrouter" (or use --gateway openrouter) to restore.',
    ]);
  });

  it('an ordinary wave (no migration) has an empty notices array', async () => {
    const { wave } = await runFanout(baseOpts());
    expect(wave.notices).toEqual([]);
  });

  it('derives leg ids from the wave id and persists legs as ordinary sessions with parentWave', async () => {
    const { wave } = await runFanout({ ...baseOpts(), waveId: 'cafe1234' });
    expect(wave.waveId).toBe('cafe1234');
    expect(wave.legs.map(l => l.taskId)).toEqual(['cafe1234-1', 'cafe1234-2']);

    const legMeta = JSON.parse(fsReal.readFileSync(
      pathReal.join(project, '.claude', 'amicus_sessions', 'cafe1234-1', 'metadata.json'), 'utf-8'));
    expect(legMeta.parentWave).toBe('cafe1234');
    expect(legMeta.status).toBe('complete');
    const legSummary = fsReal.readFileSync(
      pathReal.join(project, '.claude', 'amicus_sessions', 'cafe1234-1', 'summary.md'), 'utf-8');
    expect(legSummary).toBe('summary cafe1234-1');
  });

  it('one leg failing yields partial results, sibling summaries intact, exit 2', async () => {
    mockRunHeadless
      .mockImplementationOnce(async (_m, _s, _u, taskId) => legOk(taskId))
      .mockImplementationOnce(async (_m, _s, _u, taskId) => ({
        summary: '', completed: false, timedOut: true, aborted: false, taskId, toolCalls: [],
      }));
    const { wave, exitCode } = await runFanout(baseOpts());
    expect(wave.status).toBe('partial');
    expect(exitCode).toBe(2);
    expect(wave.legs[0].status).toBe('complete');
    expect(wave.legs[1].status).toBe('timeout');
    expect(wave.legs[0].summary).toMatch(/^summary /);
  });

  // #61 perf cleanup: when EVERY leg fails routing, runFanout must short-
  // circuit straight to the error wave BEFORE starting the shared OpenCode
  // server — starting (and immediately tearing down) a server no leg will
  // ever touch is pure waste. The resulting wave doc/counts/exitCode must be
  // identical to what the old code produced via the server round-trip.
  it('all legs unroutable short-circuits to an error wave WITHOUT starting the server (#61 perf)', async () => {
    // .mockImplementationOnce (not .mockImplementation) x2, matching the two
    // legs in baseOpts(): a persistent override here would leak into every
    // later test in this file (jest.clearAllMocks() in beforeEach clears call
    // data, not implementations set via .mockImplementation).
    const routingFailure = async () => ({
      kind: 'error', type: 'model_route_error', field: 'model', requested: 'x',
      reason: 'no_key_for_vendor', preferredGateway: 'direct', suggestions: [],
    });
    mockResolveRouteForLaunch.mockImplementationOnce(routingFailure).mockImplementationOnce(routingFailure);
    const { wave, exitCode } = await runFanout({ ...baseOpts(), waveId: 'cafe3333' });

    expect(mockStartOpenCodeServer).not.toHaveBeenCalled();
    expect(mockRunHeadless).not.toHaveBeenCalled();
    expect(wave.status).toBe('error');
    expect(exitCode).toBe(1);
    expect(wave.counts).toMatchObject({ total: 2, complete: 0, error: 2 });
    expect(wave.legs.every(l => l.status === 'error')).toBe(true);
    expect(wave.notices).toEqual([]);

    // wave.json on disk agrees with the returned doc (same aggregation path).
    const stored = JSON.parse(fsReal.readFileSync(
      pathReal.join(project, '.claude', 'amicus_sessions', 'cafe3333', 'wave.json'), 'utf-8'));
    expect(stored.status).toBe('error');
    expect(stored.counts).toMatchObject({ total: 2, error: 2 });
    const meta = JSON.parse(fsReal.readFileSync(
      pathReal.join(project, '.claude', 'amicus_sessions', 'cafe3333', 'metadata.json'), 'utf-8'));
    expect(meta.status).toBe('error');
  });

  it('a leg whose MODEL never routes fails ONLY that leg — sibling still runs (#61 Task 7.3)', async () => {
    mockResolveRouteForLaunch.mockImplementationOnce(async () => ({
      kind: 'error', type: 'model_route_error', field: 'model', requested: 'openrouter/a/b',
      reason: 'no_openrouter_key', preferredGateway: 'openrouter', suggestions: [],
    }));
    const { wave, exitCode } = await runFanout(baseOpts());
    expect(wave.status).toBe('partial');
    expect(exitCode).toBe(2);
    expect(wave.legs[0].status).toBe('error');
    expect(wave.legs[0].error).toMatch(/OpenRouter/i);
    expect(wave.legs[1].status).toBe('complete');
    // The unroutable leg never reaches the model runner — only the sibling does.
    expect(mockRunHeadless).toHaveBeenCalledTimes(1);
    // The shared server only registers the leg that actually resolved.
    const serverOpts = mockStartOpenCodeServer.mock.calls[0][1];
    expect(serverOpts.models).toEqual(['openrouter/c/d']);
  });

  it('a leg that REJECTS becomes an error leg, never sinks siblings', async () => {
    mockRunHeadless
      .mockImplementationOnce(async () => { throw new Error('kaboom'); })
      .mockImplementationOnce(async (_m, _s, _u, taskId) => legOk(taskId));
    const { wave, exitCode } = await runFanout(baseOpts());
    expect(wave.legs[0].status).toBe('error');
    expect(wave.legs[0].error).toMatch(/kaboom/);
    expect(wave.legs[1].status).toBe('complete');
    expect(exitCode).toBe(2);
  });

  it('a leg whose SETUP throws becomes an error leg — wave still writes wave.json, never rejects', async () => {
    // Pre-try setup (createSessionMetadata) throwing must NOT propagate through
    // Promise.all past runFanout's finally — it would skip wave.json and the
    // documented "runLeg never throws / never rejects" contract. The failing
    // leg should resolve to an error run document and the wave aggregates.
    const startMod = require('../../src/sidecar/start');
    const realCreate = startMod.createSessionMetadata;
    const spy = jest.spyOn(startMod, 'createSessionMetadata')
      .mockImplementationOnce(() => { throw new Error('setup boom'); })
      .mockImplementation((...args) => realCreate(...args));
    try {
      const { wave, exitCode } = await runFanout({ ...baseOpts(), waveId: 'cafe2222' });
      expect(wave.legs[0].status).toBe('error');
      expect(wave.legs[0].error).toMatch(/setup boom/);
      expect(wave.legs[1].status).toBe('complete');
      expect(exitCode).toBe(2);
      // wave.json still persisted despite the leg-setup throw
      const stored = JSON.parse(fsReal.readFileSync(
        pathReal.join(project, '.claude', 'amicus_sessions', 'cafe2222', 'wave.json'), 'utf-8'));
      expect(stored.status).toBe('partial');
    } finally {
      spy.mockRestore();
    }
  });

  it('builds context ONCE and reuses it across legs', async () => {
    await runFanout({ ...baseOpts(), includeContext: true });
    expect(mockBuildContext).toHaveBeenCalledTimes(1);
  });

  it('forwards coworkProcess + sessionId into the (single) buildContext call (#10)', async () => {
    await runFanout({
      ...baseOpts(),
      includeContext: true,
      sessionId: 'parent-uuid-123',
      coworkProcess: 'modest-laughing-goodall',
    });
    expect(mockBuildContext).toHaveBeenCalledTimes(1);
    const [, sessionArg, optsArg] = mockBuildContext.mock.calls[0];
    expect(sessionArg).toBe('parent-uuid-123');
    expect(optsArg.coworkProcess).toBe('modest-laughing-goodall');
  });

  it('writes wave.json and finalizes wave metadata', async () => {
    const { wave } = await runFanout({ ...baseOpts(), waveId: 'cafe9999' });
    const waveDir = pathReal.join(project, '.claude', 'amicus_sessions', 'cafe9999');
    const stored = JSON.parse(fsReal.readFileSync(pathReal.join(waveDir, 'wave.json'), 'utf-8'));
    expect(stored.waveId).toBe('cafe9999');
    expect(stored.status).toBe(wave.status);
    const meta = JSON.parse(fsReal.readFileSync(pathReal.join(waveDir, 'metadata.json'), 'utf-8'));
    expect(meta.type).toBe('wave');
    expect(meta.status).toBe('complete');
    expect(fsReal.readFileSync(pathReal.join(waveDir, 'briefing.md'), 'utf-8')).toBe('do the thing');
  });

  // Task 7 (spec §4.2 Surface B): proves the REAL runFanout/runLeg call sites
  // (not just the emit helpers in isolation, covered by
  // tests/observe/fanout-events.test.js) actually write events.jsonl into the
  // WAVE dir — leg emits land there too, never in the leg's own session dir.
  it('emits wave-started/leg-started/leg-terminal/wave-terminal into the wave dir events.jsonl', async () => {
    const { createEventTail, EVENTS_FILE } = require('../../src/observe/events');
    const { wave } = await runFanout({ ...baseOpts(), waveId: 'cafeaaaa' });
    const waveDir = pathReal.join(project, '.claude', 'amicus_sessions', 'cafeaaaa');
    const events = createEventTail(pathReal.join(waveDir, EVENTS_FILE)).poll();
    expect(events.map(e => e.event)).toEqual([
      'wave-started', 'leg-started', 'leg-started', 'leg-terminal', 'leg-terminal', 'wave-terminal',
    ]);
    const started = events.find(e => e.event === 'wave-started');
    expect(started).toMatchObject({ id: 'cafeaaaa', legIds: ['cafeaaaa-1', 'cafeaaaa-2'] });
    const legTerminals = events.filter(e => e.event === 'leg-terminal');
    expect(legTerminals.map(e => e.legId).sort()).toEqual(['cafeaaaa-1', 'cafeaaaa-2']);
    expect(legTerminals.every(e => e.status === 'complete')).toBe(true);
    const terminal = events.find(e => e.event === 'wave-terminal');
    expect(terminal).toMatchObject({ id: 'cafeaaaa', status: wave.status, exitCode: 0 });
    expect(terminal.counts).toMatchObject({ total: 2, complete: 2 });
    // No leg-level events.jsonl in the leg's OWN session dir — Task 7 emits
    // leg-started/leg-terminal into the owning WAVE dir only.
    const legEventsPath = pathReal.join(project, '.claude', 'amicus_sessions', 'cafeaaaa-1', EVENTS_FILE);
    expect(fsReal.existsSync(legEventsPath)).toBe(false);
  });

  it('json mode (non-quiet): stdout carries EXACTLY one parseable JSON document', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await runFanout({ ...baseOpts(), quiet: false });
      expect(logSpy).toHaveBeenCalledTimes(1);
      const doc = JSON.parse(logSpy.mock.calls[0][0]); // whole-output parse must succeed
      expect(doc.type).toBe('wave');
      expect(doc.schemaVersion).toBe(2);
    } finally {
      logSpy.mockRestore();
    }
  });

  it('server start failure → error wave, exit 1, no legs launched', async () => {
    mockStartOpenCodeServer.mockRejectedValueOnce(new Error('no server'));
    const { wave, exitCode } = await runFanout(baseOpts());
    expect(exitCode).toBe(1);
    expect(wave.status).toBe('error');
    expect(mockRunHeadless).not.toHaveBeenCalled();
  });

  it('per-leg watchdog timeout marks ONLY that leg aborted (no process.exit, no server.close)', async () => {
    let capturedWatchdog;
    mockRunHeadless.mockImplementationOnce(async (_m, _s, _u, taskId, _p, _t, _a, options) => {
      capturedWatchdog = options.watchdog;
      options.watchdog.onTimeout(); // simulate idle-timeout firing mid-run
      return { summary: '', completed: false, timedOut: false, aborted: true, taskId, toolCalls: [] };
    }).mockImplementationOnce(async (_m, _s, _u, taskId) => legOk(taskId));

    const { wave } = await runFanout({ ...baseOpts(), waveId: 'cafe7777' });
    expect(capturedWatchdog).toBeDefined();
    // sibling unaffected, server closed exactly once at the END
    expect(wave.legs[1].status).toBe('complete');
    expect(mockServerClose).toHaveBeenCalledTimes(1);
    const legMeta = JSON.parse(fsReal.readFileSync(
      pathReal.join(project, '.claude', 'amicus_sessions', 'cafe7777-1', 'metadata.json'), 'utf-8'));
    expect(legMeta.status).toBe('aborted');
  });

  it('SIGINT mid-wave: finalizes an aborted wave document, exit 130, wave.json written', async () => {
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit must not be called on first signal');
    });
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      mockRunHeadless.mockImplementation(async (_m, _s, _u, taskId) => {
        // Fire the signal while the first leg is in flight, then resolve as aborted
        if (taskId.endsWith('-1')) {
          process.emit('SIGINT');
          await new Promise(r => setTimeout(r, 20));
          return { summary: '', completed: false, timedOut: false, aborted: true, taskId, toolCalls: [] };
        }
        await new Promise(r => setTimeout(r, 30));
        return { summary: '', completed: false, timedOut: false, aborted: true, taskId, toolCalls: [] };
      });

      const { wave, exitCode } = await runFanout({ ...baseOpts(), waveId: 'cafe5555', quiet: false });

      expect(exitCode).toBe(130);
      expect(wave.status).toBe('aborted');
      expect(exitSpy).not.toHaveBeenCalled();
      // wave.json persisted with the aborted status
      const stored = JSON.parse(fsReal.readFileSync(
        pathReal.join(project, '.claude', 'amicus_sessions', 'cafe5555', 'wave.json'), 'utf-8'));
      expect(stored.status).toBe('aborted');
      // stdout got exactly one parseable document
      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(JSON.parse(logSpy.mock.calls[0][0]).status).toBe('aborted');
      // wave + leg metadata marked aborted
      const waveMeta = JSON.parse(fsReal.readFileSync(
        pathReal.join(project, '.claude', 'amicus_sessions', 'cafe5555', 'metadata.json'), 'utf-8'));
      expect(waveMeta.status).toBe('aborted');
    } finally {
      exitSpy.mockRestore();
      logSpy.mockRestore();
    }
  });

  it('a leg finishing concurrently with an abort cannot demote the aborted marker', async () => {
    // Simulate: signal marks the leg aborted while runHeadless is in flight;
    // the leg then completes normally — disk status must stay 'aborted'.
    mockRunHeadless.mockImplementationOnce(async (_m, _s, _u, taskId, projectArg) => {
      const legDir = pathReal.join(projectArg, '.claude', 'amicus_sessions', taskId);
      const meta = JSON.parse(fsReal.readFileSync(pathReal.join(legDir, 'metadata.json'), 'utf-8'));
      meta.status = 'aborted';
      fsReal.writeFileSync(pathReal.join(legDir, 'metadata.json'), JSON.stringify(meta, null, 2));
      return legOk(taskId); // completes "successfully" after the abort marker landed
    }).mockImplementationOnce(async (_m, _s, _u, taskId) => legOk(taskId));

    const { wave } = await runFanout({ ...baseOpts(), waveId: 'cafe6666' });
    const legMeta = JSON.parse(fsReal.readFileSync(
      pathReal.join(project, '.claude', 'amicus_sessions', 'cafe6666-1', 'metadata.json'), 'utf-8'));
    expect(legMeta.status).toBe('aborted');       // disk: abort preserved
    expect(wave.legs[0].status).toBe('aborted');  // doc agrees with disk
    expect(wave.legs[1].status).toBe('complete');
  });

  it('validation failure returns error-doc (not a wave), leaves no wave directory behind', async () => {
    // Pre-creation pre-flight errors (invalid models list) emit an error-doc, not a wave-doc.
    // Source: WS-2 coupling change — failPre returns { wave: null, errorDoc, exitCode: 1 }.
    const result = await runFanout({ ...baseOpts(), models: '', waveId: 'cafe0000' });
    expect(result.exitCode).toBe(1);
    expect(result.wave).toBeNull();
    expect(result.errorDoc).toBeDefined();
    expect(result.errorDoc.code).toBe('BAD_ARGS');
    expect(fsReal.existsSync(pathReal.join(project, '.claude', 'amicus_sessions', 'cafe0000'))).toBe(false);
  });

  it('honors explicitly-passed maxCostPerMtok over config default (refuses with BUDGET_EXCEEDED)', async () => {
    // Covers Finding 1: runFanout must prefer options.maxCostPerMtok over cfg.maxCostPerMtok.
    // Strategy: mock lookupPricing to return a priced model ($30/Mtok out), then pass
    // maxCostPerMtok: 0.0001 (tiny threshold). The budget gate should fire pre-flight
    // — wave: null, errorDoc.code === BUDGET_EXCEEDED, no server started.
    mockLookupPricing.mockReturnValue({ prompt: 0.01, completion: 0.03 }); // ~$30/Mtok out
    const result = await runFanout({
      ...baseOpts(),
      maxCostPerMtok: 0.0001,
      noCostGate: false,
      waveId: 'cafe1111',
    });
    expect(result.exitCode).toBe(1);
    expect(result.wave).toBeNull();
    expect(result.errorDoc).toBeDefined();
    expect(result.errorDoc.code).toBe('BUDGET_EXCEEDED');
    expect(mockStartOpenCodeServer).not.toHaveBeenCalled();
  });

  describe('spend ledger append (B24)', () => {
    let prevConfigDir;
    let ledgerDir;
    beforeEach(() => {
      prevConfigDir = process.env.AMICUS_CONFIG_DIR;
      ledgerDir = fsReal.mkdtempSync(pathReal.join(os.tmpdir(), 'amicus-spend-ledger-'));
      process.env.AMICUS_CONFIG_DIR = ledgerDir;
      // resolveUsage's internal lookupPricing() call is NOT affected by the
      // mockLookupPricing export override (module-local reference — see
      // pricing.js resolveUsage), so use a REPORTED cost instead: resolveLegCost
      // short-circuits on reportedCost > 0 before ever consulting pricing.
      mockRunHeadless.mockImplementation(async (_m, _s, _u, taskId) => ({
        ...legOk(taskId),
        usage: { tokens: { input: 100, output: 50, reasoning: 0, cacheRead: 0, cacheWrite: 0 }, costReported: 0.005 },
      }));
    });
    afterEach(() => {
      if (prevConfigDir === undefined) { delete process.env.AMICUS_CONFIG_DIR; }
      else { process.env.AMICUS_CONFIG_DIR = prevConfigDir; }
    });

    it('appends one spend-ledger row per leg, tagged with the waveId', async () => {
      const { readSpendRows } = require('../../src/utils/spend-ledger');
      await runFanout({ ...baseOpts(), waveId: 'ledgerwave1' });
      const rows = readSpendRows(ledgerDir);
      expect(rows).toHaveLength(2);
      expect(rows.map(r => r.taskId).sort()).toEqual(['ledgerwave1-1', 'ledgerwave1-2']);
      for (const row of rows) {
        expect(row.waveId).toBe('ledgerwave1');
        expect(row.mode).toBe('leg');
        expect(row.tokens).toMatchObject({ input: 100, output: 50 });
        expect(row.cost).toEqual({ amount: 0.005, currency: 'USD', source: 'reported' });
      }
    });

    it('a leg with no usage (errored before pricing) does not append a row', async () => {
      const { readSpendRows } = require('../../src/utils/spend-ledger');
      mockRunHeadless
        .mockImplementationOnce(async (_m, _s, _u, taskId) => ({
          summary: '', completed: false, timedOut: false, aborted: false, taskId, toolCalls: [],
          // no .usage
        }))
        .mockImplementationOnce(async (_m, _s, _u, taskId) => ({
          ...legOk(taskId),
          usage: { tokens: { input: 10, output: 5, reasoning: 0, cacheRead: 0, cacheWrite: 0 }, costReported: 0 },
        }));
      await runFanout({ ...baseOpts(), waveId: 'ledgerwave2' });
      const rows = readSpendRows(ledgerDir);
      expect(rows).toHaveLength(1);
      expect(rows[0].taskId).toBe('ledgerwave2-2');
    });

    // fanout-leg.js:131-132 prefers the resolved leg.gateway (set by
    // validateFanoutModels from the router's RouteResult) over the old
    // string-prefix heuristic, which mislabeled v4.2 local-provider legs
    // (Ollama/LM Studio/vLLM) as 'direct'. Exercise the real
    // runFanout -> runLeg -> appendSpend path with a leg whose resolved
    // route reports gateway:'local' to guard against that regression.
    it('a leg whose resolved route reports gateway:local is attributed gateway:local on its ledger row', async () => {
      const { readSpendRows } = require('../../src/utils/spend-ledger');
      await runFanout({
        ...baseOpts(), models: 'openrouter/a/b,ollama/llama3', waveId: 'ledgerwave3',
      });
      const rows = readSpendRows(ledgerDir);
      expect(rows).toHaveLength(2);
      const localRow = rows.find(r => r.model === 'ollama/llama3');
      const openrouterRow = rows.find(r => r.model === 'openrouter/a/b');
      expect(localRow).toMatchObject({ gateway: 'local' });
      expect(openrouterRow).toMatchObject({ gateway: 'openrouter' });
    });
  });
});

// 15a.1/B07: writeWaveMetadata must not let an in-flight init/finalize patch
// clobber an abort that already landed. Race: MCP pre-writes status:'running'
// -> spawn -> user aborts (markAborted writes status:'aborted' via markTerminal)
// -> the CLI child's own init writeWaveMetadata({status:'running',...}) races
// the abort marker. Same precedence rule already proven for leg metadata in
// fanout-leg.js's writeLegPatch (abort wins; ported into writeWaveMetadata).
describe('writeWaveMetadata abort-wins guard (B07)', () => {
  const { writeWaveMetadata } = require('../../src/sidecar/fanout');
  let waveDir;

  beforeEach(() => {
    waveDir = fsReal.mkdtempSync(pathReal.join(os.tmpdir(), 'amicus-wavemeta-'));
  });

  afterEach(() => {
    fsReal.rmSync(waveDir, { recursive: true, force: true });
  });

  const readMeta = () => JSON.parse(fsReal.readFileSync(pathReal.join(waveDir, 'metadata.json'), 'utf-8'));

  it('does not let a running-status patch clobber an already-aborted wave', () => {
    writeWaveMetadata(waveDir, { taskId: 'beef0001', status: 'aborted', reason: 'Aborted (SIGINT)' });

    const merged = writeWaveMetadata(waveDir, { status: 'running' });

    expect(merged.status).toBe('aborted');
    expect(readMeta().status).toBe('aborted');
  });

  it('still applies non-status fields from the patch even when status is dropped', () => {
    writeWaveMetadata(waveDir, { taskId: 'beef0002', status: 'aborted' });

    const merged = writeWaveMetadata(waveDir, { status: 'running', goPid: 4242 });

    expect(merged.status).toBe('aborted');
    expect(merged.goPid).toBe(4242); // non-status fields still merge normally
  });

  it('allows a status patch through when the existing status is NOT aborted', () => {
    writeWaveMetadata(waveDir, { taskId: 'beef0003', status: 'running' });

    const merged = writeWaveMetadata(waveDir, { status: 'complete' });

    expect(merged.status).toBe('complete');
  });

  it('allows re-affirming aborted -> aborted (not treated as a demotion)', () => {
    writeWaveMetadata(waveDir, { taskId: 'beef0004', status: 'aborted' });

    const merged = writeWaveMetadata(waveDir, { status: 'aborted', completedAt: '2026-01-01T00:00:00.000Z' });

    expect(merged.status).toBe('aborted');
    expect(merged.completedAt).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('buildWaveResult count remainder rule (#14)', () => {
  const { buildWaveResult, TERMINAL_STATUSES } = require('../../src/utils/result-schema');

  const leg = (status) => ({ taskId: `t-${status}`, status });

  it('crashed/idle-timeout legs count toward total only; named buckets sum to total minus the remainder', () => {
    const legs = [
      leg('complete'),
      leg('error'),
      leg('timeout'),
      leg('aborted'),
      leg('crashed'),
      leg('idle-timeout'),
    ];
    const { counts } = buildWaveResult({ waveId: 'w', legs });

    expect(counts.total).toBe(6);
    const named = counts.complete + counts.error + counts.timeout + counts.aborted;
    // crashed + idle-timeout are reflected in `total` only — the documented remainder.
    const remainder = legs.filter(l => l.status === 'crashed' || l.status === 'idle-timeout').length;
    expect(remainder).toBe(2);
    expect(named).toBe(counts.total - remainder);
  });

  it('all six terminal statuses are recognized as terminal (mcp done-count parity)', () => {
    // The MCP wave path counts a leg as "done" iff its status is in TERMINAL_STATUSES.
    // buildWaveResult's `total` is legs.length; for an all-terminal wave the MCP
    // done-count must equal counts.total so the two accountings agree.
    const legs = TERMINAL_STATUSES.map(leg);
    const { counts } = buildWaveResult({ waveId: 'w', legs });
    const mcpDone = legs.filter(l => TERMINAL_STATUSES.includes(l.status)).length;
    expect(mcpDone).toBe(counts.total);
    // And every status NOT in the named buckets is part of the remainder.
    const named = counts.complete + counts.error + counts.timeout + counts.aborted;
    expect(counts.total - named).toBe(
      legs.filter(l => !['complete', 'error', 'timeout', 'aborted'].includes(l.status)).length,
    );
  });
});
