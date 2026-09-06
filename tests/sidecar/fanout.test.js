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
    // SI-14: duplicates must survive to leg construction. Owner ruling R3-2
    // (one re-vote leg per disputing SEAT — tests/council/run-debate.test.js:967)
    // depends on a twin bench producing one leg PER OCCURRENCE, not per unique
    // value: ['gpt','deepseek','deepseek'] must stay three entries all the way
    // to leg construction, or seat #2 of the repeated alias silently loses its
    // leg with no error.
    //
    // ⚠️ WHAT THIS PIN ACTUALLY COVERS, and what it does NOT — corrected after a
    // paid council raised it as C1 (major, a3/d0/n0) against the first wording,
    // which claimed this pin makes a `uniq()` "anywhere on this path" loud. It
    // does not. It covers `parseModelsList` ONLY. Coverage of the rest of the
    // path is real but comes from a DIFFERENT test, and the boundary is
    // measured, not argued:
    //   named mutant "MODELSUNIQ" — `[...new Set(...)]` on this function's
    //     return. RED: 3 tests / 1 suite (this pin, `allows duplicates
    //     (distinct legs)`, and validateFanoutModels' `keeps a duplicated model
    //     as two distinct legs (no dedupe)`).
    //   named mutant "DOWNSTREAMUNIQ" — `const raw = [...new Set(
    //     parseModelsList(modelsArg))]` inside `validateFanoutModels`, i.e. a
    //     dedupe introduced DOWNSTREAM of this function. RED: 1 test / 1 suite —
    //     `validateFanoutModels > keeps a duplicated model as two distinct legs
    //     (no dedupe)` ONLY. This pin stays GREEN against it.
    // Both measured at full `npx jest --no-coverage` scope, 2026-08-22.
    // So the invariant IS guarded at both points, by two different tests — and
    // a dedupe introduced anywhere with no test at all (leg construction inside
    // runFanout, say) would still be silent. Do not thin either test.
    it('SI-14: preserves every duplicate occurrence for leg construction (R3-2)', () => {
      expect(parseModelsList('gpt,deepseek,deepseek')).toEqual(['gpt', 'deepseek', 'deepseek']);
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

    // v4.8 PR4c (§3.5): the ends of this chain are pinned — parseModelsList's
    // duplicate case at :74-76, and the twin launcher arguments end-to-end in
    // tests/council/run-debate.test.js — but the MIDDLE was not, on the default
    // rail: the only other twin call to validateFanoutModels lives in
    // local-provider-e2e.integration.test.js, which jest.config.js excludes.
    // It is the seat spine's business because run-launch.js :: launchWave
    // contains `models: opts.models.join(',')`, so a twin council bench arrives here as
    // the literal 'deepseek,deepseek'. A dedupe would strand seat #2 unbound and
    // the seat spine would report a seat loss caused by a layer that has no seat
    // awareness at all. NOTE: validateFanoutModels is an AsyncFunction — the
    // un-awaited form gives `undefined` for `.legs`, so this MUST await.
    it('keeps a duplicated model as two distinct legs (no dedupe)', async () => {
      const r = await validateFanoutModels('a/b,a/b');
      expect(r.legs).toHaveLength(2);
      expect(r.legs[0]).toMatchObject({ modelInput: 'a/b', ok: true, model: 'a/b' });
      expect(r.legs[1]).toMatchObject({ modelInput: 'a/b', ok: true, model: 'a/b' });
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

    // v4.3 Task 18 (spec §6.2 sole-input invariant)
    it('fallback enabled: serverModels is the union of primaries + resolved chain candidates (unresolvable ones dropped)', async () => {
      // .mockImplementationOnce (not .mockImplementation) — the latter would
      // permanently replace this shared mock's default for every later test
      // in the file, not just this one.
      const resolved = (model) => ({ kind: 'resolved', executableId: model,
        gateway: model.startsWith('openrouter/') ? 'openrouter' : 'direct', provenance: {} });
      mockResolveRouteForLaunch
        .mockImplementationOnce(async ({ model }) => resolved(model))  // primary a/b
        .mockImplementationOnce(async ({ model }) => resolved(model))  // primary c/d
        .mockImplementationOnce(async ({ model }) => resolved(model))  // chain candidate a/cheap
        .mockImplementationOnce(async () => ({                        // chain candidate a/bad-candidate
          kind: 'error', type: 'model_route_error', field: 'model', requested: 'a/bad-candidate',
          reason: 'model_not_found', preferredGateway: 'direct', suggestions: [],
        }));
      const r = await validateFanoutModels('a/b,c/d', {
        fallback: { enabled: true, maxSubstitutions: 2, chains: { 'a/b': ['a/cheap', 'a/bad-candidate'] } },
        catalog: [],
      });
      expect(r.legs.map(l => l.model)).toEqual(['a/b', 'c/d']);
      expect(r.serverModels).toEqual(expect.arrayContaining(['a/b', 'c/d', 'a/cheap']));
      expect(r.serverModels).not.toContain('a/bad-candidate');
    });

    it('fallback disabled/absent: serverModels is undefined (caller falls back to okLegs.map)', async () => {
      const r = await validateFanoutModels('a/b,c/d');
      expect(r.serverModels).toBeUndefined();
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

  // v4.6.2 PR3 Task 1: the live-probe override rides the same options-object
  // vehicle as `directory` above — runFanout -> runLeg -> runSingleAttempt's
  // runHeadless call. Mirrors the directory pair exactly (forwards / stays
  // undefined by default) so a plain fanout caller (every caller before PR3's
  // models-probe module) sees byte-identical runHeadless options.
  it('forwards noOutputBackstopMs to every leg\'s runHeadless call', async () => {
    await runFanout({ ...baseOpts(), noOutputBackstopMs: 30000 });
    expect(mockRunHeadless).toHaveBeenCalledTimes(2);
    for (const call of mockRunHeadless.mock.calls) {
      expect(call[7].noOutputBackstopMs).toBe(30000);
    }
  });

  it('leaves runHeadless options.noOutputBackstopMs undefined when the caller omits it (plain fanout callers unaffected)', async () => {
    await runFanout(baseOpts());
    expect(mockRunHeadless).toHaveBeenCalledTimes(2);
    for (const call of mockRunHeadless.mock.calls) {
      expect(call[7].noOutputBackstopMs).toBeUndefined();
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

  // #133 P1: opencodeSessionId is promised by schemas/run.schema.json and
  // already set by the interactive path, but runHeadless never carried it
  // through to a fanout leg. This pins BOTH ends: the leg's on-disk
  // metadata.json (legPatch, fanout-leg.js) and the in-memory wave doc
  // (result-schema.js's buildRunResult) agree, for a leg that HAS a session
  // and one that does not (the "clean leg carries neither key" convention —
  // see the comment on legPatch's opencodeSessionId field).
  it('threads a leg\'s opencodeSessionId from runHeadless onto its on-disk leg patch and the wave doc (#133 P1)', async () => {
    mockRunHeadless
      .mockImplementationOnce(async (_m, _s, _u, taskId) => ({ ...legOk(taskId), opencodeSessionId: 'ses_leg1' }))
      .mockImplementationOnce(async (_m, _s, _u, taskId) => legOk(taskId)); // no session on this leg
    const { wave } = await runFanout({ ...baseOpts(), waveId: 'sess1234' });

    const legMeta1 = JSON.parse(fsReal.readFileSync(
      pathReal.join(project, '.claude', 'amicus_sessions', 'sess1234-1', 'metadata.json'), 'utf-8'));
    expect(legMeta1.opencodeSessionId).toBe('ses_leg1');
    expect(wave.legs[0].opencodeSessionId).toBe('ses_leg1');

    // A leg with no session id still produces a well-formed document: the
    // key is absent on disk (undefined, not a written null — the
    // read-merge-write convention) but the emitted wave doc coerces the
    // absence to schema-valid null (result-schema.js:72), never undefined.
    const legMeta2 = JSON.parse(fsReal.readFileSync(
      pathReal.join(project, '.claude', 'amicus_sessions', 'sess1234-2', 'metadata.json'), 'utf-8'));
    expect(legMeta2.status).toBe('complete');
    expect('opencodeSessionId' in legMeta2).toBe(false);
    expect(wave.legs[1].opencodeSessionId).toBeNull();
  });

  // v4.9 W13 Task A — the TTFT probe's middle hops: runHeadless's `ttftMs` onto
  // the on-disk leg patch (fanout-leg.js) and onto the emitted run document
  // (result-schema.js :: buildRunResult). Modeled on the #133 P1 pin directly
  // above, with ONE deliberate difference in the absence half: `ttftMs` is
  // emit-when-set on BOTH ends — the leg with no measurement carries no key on
  // disk AND no key in the wave doc, where `opencodeSessionId` coerces its
  // absence to a schema-required null. That is the point: an absent ttft is not
  // "zero milliseconds to first token", and it is not "null"; it is "this leg
  // produced nothing substantive, so there is nothing to report". run.schema.json
  // declares it optional-integer for exactly that reason.
  //
  // ⚠️ Like its #133 P1 sibling, this pin mocks runHeadless and therefore stays
  // GREEN under the named mutant TTFTDROP (which deletes the measure inside
  // runHeadless). It pins the threading, a different unit. Do not "fix" it.
  it('threads a leg\'s ttftMs from runHeadless onto its on-disk leg patch and the wave doc (v4.9 W13 Task A)', async () => {
    mockRunHeadless
      .mockImplementationOnce(async (_m, _s, _u, taskId) => ({ ...legOk(taskId), ttftMs: 8123 }))
      .mockImplementationOnce(async (_m, _s, _u, taskId) => legOk(taskId)); // never produced output
    const { wave } = await runFanout({ ...baseOpts(), waveId: 'ttft1234' });

    const legMeta1 = JSON.parse(fsReal.readFileSync(
      pathReal.join(project, '.claude', 'amicus_sessions', 'ttft1234-1', 'metadata.json'), 'utf-8'));
    expect(legMeta1.ttftMs).toBe(8123);
    expect(wave.legs[0].ttftMs).toBe(8123);

    const legMeta2 = JSON.parse(fsReal.readFileSync(
      pathReal.join(project, '.claude', 'amicus_sessions', 'ttft1234-2', 'metadata.json'), 'utf-8'));
    expect(legMeta2.status).toBe('complete');
    expect('ttftMs' in legMeta2).toBe(false);
    expect('ttftMs' in wave.legs[1]).toBe(false);
  });

  /**
   * PR #203 council round 1, findings A3 + C1 — the null guard, pinned by SHAPE.
   *
   * MEASURED: the null path is NOT drivable from the outside. `result` is read
   * bare three statements earlier (`legStatusFromResult(result)` →
   * `statusFromResult`, which dereferences `result.aborted`), so a nullish
   * `result` throws before this expression is ever evaluated — there is no
   * fixture that reaches it. A behavioural pin here would therefore be a pin on
   * the wrong line. What IS worth defending is the guard's presence: it makes
   * `ttftMs` agree with its `toolSettleTimedOut`/`toolSettleAborted` siblings
   * instead of relying on an invariant this file does not consistently assume.
   * Named mutant NULLGUARD: delete the leading `result &&`. RED measured
   * 2026-08-26 at the 7-suite/273-test focused scope — 1 test / 1 suite, this
   * one. It is the whole red set, which is the honest cost of a shape pin.
   * RE-MEASURED at PR #207 round 3 (8 suites / 323 tests) and again at round 4
   * (same 8 suites, 330 tests): still 1 test / 1 suite, this one. The mutant
   * survived the predicate swap below unchanged, which is exactly the point —
   * the two properties are independent.
   *
   * ⚠️ PR #207 council round 2 (B2): this used to be
   * `expect(src).toContain('<the exact source line>')`, which pinned the
   * FORMATTING as tightly as the guard — a line wrap, a quote-style change or
   * one added space broke the suite for a reason that had nothing to do with
   * the null guard it exists to defend. Whitespace is collapsed first and the
   * expression is matched as an ordered TOKEN sequence instead, so the pin
   * survives any reformat and still dies to NULLGUARD (re-measured below).
   */
  it('the on-disk ttftMs hop keeps the `result &&` guard its siblings use (PR #203 A3/C1)', () => {
    const src = fsReal.readFileSync(
      pathReal.join(__dirname, '..', '..', 'src', 'sidecar', 'fanout-leg.js'), 'utf-8');
    const norm = src.replace(/\s+/g, ' ');
    // Tokens in order: the `result &&` null guard, THEN the shared honesty
    // predicate, THEN the pass-through/undefined arms. Quote style is free.
    // ⚠️ PR #207 round 3 (B3) replaced the middle token: the bare `typeof`
    // number test admitted NaN/Infinity/negative/fractional, so all five gates
    // now share `isMeasuredTtft` (see tests/council/run-stats-entry.test.js).
    // The `result &&` half — the property THIS pin exists for — is unchanged.
    expect(norm).toMatch(
      /ttftMs:\s*result\s*&&\s*isMeasuredTtft\(result\.ttftMs\)\s*\?\s*result\.ttftMs\s*:\s*undefined/);
    // …and the guard half survives alongside it: `result && result.ttftMs`
    // alone would resurrect the 0-eating bug the shape exists to avoid.
    expect(norm).not.toMatch(/ttftMs:\s*result\s*&&\s*result\.ttftMs\s*\|\|/);
  });

  /**
   * PR #207 council round 3, B3 — the drift pin for BOTH hops this file owns.
   *
   * `run.schema.json` declares ttftMs `integer, minimum 0`. A `typeof` gate let
   * four families through: NaN and ±Infinity (which `JSON.stringify` writes as
   * `null` — MEASURED — so the on-disk document violates its own schema while
   * looking like an honest absence), negatives (a backward wall-clock jump
   * during the probe's `Date.now()` delta) and fractions (a hand-edited leg).
   * Dropping rather than clamping is the ruling: emit-when-VALID is the same
   * discipline as emit-when-set, and a clamped `0` would read as "instant first
   * token", which is a measurement this leg never made.
   */
  it('a DISHONEST ttftMs (NaN / Infinity / negative / fractional) is dropped on BOTH hops (round 3, B3)', async () => {
    const bad = [NaN, Infinity, -Infinity, -5, 1.5];
    for (let i = 0; i < bad.length; i++) {
      const waveId = `ttftbad${i}`;
      mockRunHeadless
        .mockImplementationOnce(async (_m, _s, _u, taskId) => ({ ...legOk(taskId), ttftMs: bad[i] }))
        .mockImplementationOnce(async (_m, _s, _u, taskId) => legOk(taskId));
      const { wave } = await runFanout({ ...baseOpts(), waveId });

      const legMeta = JSON.parse(fsReal.readFileSync(
        pathReal.join(project, '.claude', 'amicus_sessions', `${waveId}-1`, 'metadata.json'), 'utf-8'));
      expect(`${bad[i]} on disk: ${'ttftMs' in legMeta}`).toBe(`${bad[i]} on disk: false`);
      expect(`${bad[i]} in wave: ${'ttftMs' in wave.legs[0]}`).toBe(`${bad[i]} in wave: false`);
    }
  });

  // A first substantive tick observed inside the first poll is a real 0, and 0
  // is exactly the value a `|| undefined` omit-if-absent idiom would silently
  // eat — which is why both hops guard on a VALUE TEST instead.
  //
  // PR #207 round 5 (B1): that test is no longer the local `typeof === 'number'`
  // this comment used to name — round 3's B3 replaced it with the shared
  // `utils/ttft.js :: isMeasuredTtft`, which the production line asserted just
  // above now spells. What survives 0 is `Number.isInteger(0) && 0 >= 0`, both
  // true; what the widening ADDED is the rejection of NaN, ±Infinity, negatives
  // and fractions, none of which `typeof` excluded.
  it('a ttftMs of 0 survives both hops (it is a measurement, not an absence)', async () => {
    mockRunHeadless
      .mockImplementationOnce(async (_m, _s, _u, taskId) => ({ ...legOk(taskId), ttftMs: 0 }))
      .mockImplementationOnce(async (_m, _s, _u, taskId) => legOk(taskId));
    const { wave } = await runFanout({ ...baseOpts(), waveId: 'ttft0000' });

    const legMeta1 = JSON.parse(fsReal.readFileSync(
      pathReal.join(project, '.claude', 'amicus_sessions', 'ttft0000-1', 'metadata.json'), 'utf-8'));
    expect(legMeta1.ttftMs).toBe(0);
    expect(wave.legs[0].ttftMs).toBe(0);
  });

  it("threads a leg's finish from runHeadless onto its on-disk leg patch and the wave doc (#218 PR 3)", async () => {
    mockRunHeadless
      .mockImplementationOnce(async (_m, _s, _u, taskId) => ({ ...legOk(taskId), finish: 'length' }))
      .mockImplementationOnce(async (_m, _s, _u, taskId) => legOk(taskId)); // older engine: no finish
    const { wave } = await runFanout({ ...baseOpts(), waveId: 'fin12345' });
    const legMeta1 = JSON.parse(fsReal.readFileSync(
      pathReal.join(project, '.claude', 'amicus_sessions', 'fin12345-1', 'metadata.json'), 'utf-8'));
    expect(legMeta1.finish).toBe('length');
    expect(wave.legs[0].finish).toBe('length');
    const legMeta2 = JSON.parse(fsReal.readFileSync(
      pathReal.join(project, '.claude', 'amicus_sessions', 'fin12345-2', 'metadata.json'), 'utf-8'));
    expect('finish' in legMeta2).toBe(false);
    expect('finish' in wave.legs[1]).toBe(false);
  });

  // The leg DOCUMENT this asserts on is metadata.json — the hop `legPatch` owns.
  // The wave doc's own legs are built by result-schema.js :: buildRunResult,
  // which copies a whitelist off metadata (ttftMs, finish, pack, tag) and does
  // not yet carry these two; that hop is not this change's.
  it('#218 PR 4: a leg\'s variant and unverified flag reach the leg document', async () => {
    // Named mutant "LEGVARIANTDROPPED": drop the two `legPatch` fields.
    mockRunHeadless
      .mockImplementationOnce(async (_m, _s, _u, taskId) => ({ ...legOk(taskId), variant: 'low', variantUnverified: true }))
      .mockImplementationOnce(async (_m, _s, _u, taskId) => legOk(taskId)); // no variant asked for
    await runFanout({ ...baseOpts(), waveId: 'var12345' });
    const legMeta1 = JSON.parse(fsReal.readFileSync(
      pathReal.join(project, '.claude', 'amicus_sessions', 'var12345-1', 'metadata.json'), 'utf-8'));
    expect(legMeta1.variant).toBe('low');
    expect(legMeta1.variantUnverified).toBe(true);
    const legMeta2 = JSON.parse(fsReal.readFileSync(
      pathReal.join(project, '.claude', 'amicus_sessions', 'var12345-2', 'metadata.json'), 'utf-8'));
    expect('variant' in legMeta2).toBe(false);
    expect('variantUnverified' in legMeta2).toBe(false);
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

  // Task 13 (spec §5.2): --follow prints the SAME events Task 7 already emits
  // to disk (proven above) — via the REAL runFanout/runLeg wiring, not the
  // printer in isolation (that's tests/observe/follow.test.js) — and never
  // touches stdout, so --json's contract is untouched.
  it('--follow: streams the wave\'s own events as NDJSON to stderr in emission order, and stdout stays the normal single wave document (spec §5.2)', async () => {
    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const { wave } = await runFanout({ ...baseOpts(), waveId: 'cafefeed', quiet: false, follow: true });

      // Every stderr write that parses as JSON is one NDJSON event line, in
      // the same order Task 7 already writes to events.jsonl (see the
      // 'emits wave-started/leg-started/leg-terminal/wave-terminal' test
      // above) — proving the dual-sink threading actually fires end-to-end.
      const ndjsonLines = stderrSpy.mock.calls.map(c => c[0]).filter((s) => {
        try { JSON.parse(s); return true; } catch { return false; } // drops fanout-leg's plain-text [fanout] notice lines
      });
      expect(ndjsonLines.map(s => JSON.parse(s).event)).toEqual([
        'wave-started', 'leg-started', 'leg-started', 'leg-terminal', 'leg-terminal', 'wave-terminal',
      ]);
      expect(ndjsonLines.every(s => s.endsWith('\n'))).toBe(true);

      // stdout carries EXACTLY one parseable JSON document — the normal wave
      // doc contract (same as the --follow-off assertion below), untouched.
      expect(logSpy).toHaveBeenCalledTimes(1);
      const doc = JSON.parse(logSpy.mock.calls[0][0]);
      expect(doc).toEqual(wave);
      expect(doc.type).toBe('wave');
    } finally {
      stderrSpy.mockRestore();
      logSpy.mockRestore();
    }
  });

  it('--follow off (default): the wave\'s own event emission never writes to stderr', async () => {
    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      await runFanout({ ...baseOpts(), waveId: 'cafebabe' });
      expect(stderrSpy).not.toHaveBeenCalled();
    } finally {
      stderrSpy.mockRestore();
    }
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

  // Rider A (v4.7.1 diagnostics): --quiet must suppress BOTH streams, not
  // just one. The launch banner and wave doc are stdout (fanout.js:77/:80);
  // per-leg progress and the wave heartbeat are stderr (fanout-leg.js:58/:188,
  // wave-progress.js:75) — each gated by its own `if (!quiet)`/`options.quiet`
  // check, so a fix to one gate could silently leave the other stream noisy
  // and nothing here would have caught it before this test existed.
  // Spy console.log, NOT process.stdout.write: Jest swaps in its own Console
  // that never funnels through process.stdout.write, so that spy would pass
  // vacuously even on code that prints every call.
  it.each([true, false])('quiet writes nothing to stdout or stderr (json:%s)', async (json) => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      await runFanout({ ...baseOpts(), json });
      expect(logSpy).not.toHaveBeenCalled();
      expect(errSpy).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
    }
  });

  // v4.3 Task 19 Fix Wave 1 (Finding 3): a retry launch (options.retryOfWaveId
  // set by fanout-retry.js) must NOT print its own wave doc to stdout —
  // fanout-retry.js owns that print (after enriching retryOf/effective onto
  // it). This must be additive-only: the --on-complete hook and wave.json
  // still fire/write exactly as a normal wave (only the console.log is gated).
  it('retry launch (options.retryOfWaveId set) suppresses runFanout\'s own stdout doc-print, but --on-complete and wave.json are untouched', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const spawnCalls = [];
    const fakeSpawn = (cmd, opts) => {
      spawnCalls.push({ cmd, opts });
      const listeners = {};
      const child = {
        stdout: { on: () => {} }, stderr: { on: () => {} },
        on: (ev, cb) => { listeners[ev] = cb; },
        kill: () => {},
      };
      setImmediate(() => listeners.close && listeners.close(0));
      return child;
    };
    try {
      const { wave } = await runFanout({
        ...baseOpts(), quiet: false, retryOfWaveId: 'w1',
        onComplete: 'echo retry-done',
        onCompleteDeps: { spawn: fakeSpawn, logger: { warn: () => {}, debug: () => {} } },
      });
      // the doc-print is suppressed for a retry launch...
      expect(logSpy).not.toHaveBeenCalled();
      // ...but the --on-complete hook still fires (never gated by retryOfWaveId)...
      expect(spawnCalls).toHaveLength(1);
      expect(spawnCalls[0].cmd).toBe('echo retry-done');
      // ...and wave.json is still written (only the stdout print is suppressed).
      const wavePath = pathReal.join(project, '.claude', 'amicus_sessions', wave.waveId, 'wave.json');
      expect(fsReal.existsSync(wavePath)).toBe(true);
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

  // v4.7 F8 (D13) — T3 review finding: errorWave (the closure defined near
  // the top of runFanout, invoked here when startOpenCodeServer rejects) is
  // a THIRD buildWaveResult call site the original Task 3 pass missed — it
  // carried pack but not tag, so a tagged wave whose server failed to start
  // would have persisted wave.json WITHOUT the tag (silent drop, since
  // `amicus read --json` prefers wave.json over the metadata rebuild).
  // Same fixture as the "server start failure" test immediately above.
  it('server start failure: the error wave still carries options.tag (T3 review, errorWave call site)', async () => {
    mockStartOpenCodeServer.mockRejectedValueOnce(new Error('no server'));
    const { wave } = await runFanout({ ...baseOpts(), waveId: 'cafetag5', tag: 'sprint-42' });
    expect(wave.status).toBe('error');
    expect(wave.tag).toBe('sprint-42');
    const stored = JSON.parse(fsReal.readFileSync(
      pathReal.join(project, '.claude', 'amicus_sessions', 'cafetag5', 'wave.json'), 'utf-8'));
    expect(stored.tag).toBe('sprint-42');
  });

  it('server start failure without --tag: the error wave has NO tag key (absent, not null)', async () => {
    mockStartOpenCodeServer.mockRejectedValueOnce(new Error('no server'));
    const { wave } = await runFanout({ ...baseOpts(), waveId: 'cafetag6' });
    expect(wave.status).toBe('error');
    expect('tag' in wave).toBe(false);
    const stored = JSON.parse(fsReal.readFileSync(
      pathReal.join(project, '.claude', 'amicus_sessions', 'cafetag6', 'wave.json'), 'utf-8'));
    expect('tag' in stored).toBe(false);
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

    // D16 (v4.7 F8): a fanout launched with --tag stamps that tag onto every
    // leg (stampLegAttribution, fanout-wave-io.js) so each leg's ledger row
    // carries it — driven through the REAL runFanout -> runLeg -> appendSpend
    // chain, same as the wave/gateway rows above.
    it('a fanout launched with tag carries it on every leg ledger row', async () => {
      const { readSpendRows } = require('../../src/utils/spend-ledger');
      await runFanout({ ...baseOpts(), waveId: 'ledgerwave4', tag: 'sprint42' });
      const rows = readSpendRows(ledgerDir);
      expect(rows).toHaveLength(2);
      for (const row of rows) { expect(row.tag).toBe('sprint42'); }
    });

    // D16: the convention pin at the other end — an ordinary (untagged) fanout
    // leg's row carries tag:null (present, not omitted — spend-ledger.js's
    // nullable-dim convention), not undefined/absent.
    it('an untagged fanout leg carries tag:null on its ledger row', async () => {
      const { readSpendRows } = require('../../src/utils/spend-ledger');
      await runFanout({ ...baseOpts(), waveId: 'ledgerwave5' });
      const rows = readSpendRows(ledgerDir);
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect('tag' in row).toBe(true);
        expect(row.tag).toBeNull();
      }
    });
  });

  // v4.5 final-review F2: an MCP-spawned child fanout process never receives
  // --pack (single-resolution rule) — mcp-server.js resolves the pack
  // in-process and pre-seeds waveDir/metadata.json with it BEFORE spawning
  // the child. runFanout must inherit that pre-seeded pack onto wave.json
  // when its OWN options.pack is absent, at BOTH buildWaveResult call sites
  // (the all-legs-unroutable short-circuit and normal completion).
  describe('pack inheritance from pre-seeded metadata.json (F2, final-review)', () => {
    const PACK_RECORD = { name: 'fanout-review', version: '1.0.0', hash: 'abc123def456', source: 'dir' };

    function preSeedMetadataWithPack(waveId) {
      const waveDir = pathReal.join(project, '.claude', 'amicus_sessions', waveId);
      fsReal.mkdirSync(waveDir, { recursive: true });
      fsReal.writeFileSync(pathReal.join(waveDir, 'metadata.json'), JSON.stringify({
        taskId: waveId, type: 'wave', status: 'running', pack: PACK_RECORD,
      }, null, 2));
      return waveDir;
    }

    it('normal completion: wave.json inherits the pre-seeded pack when options.pack is absent (mirrors mcp-server.js pre-seed)', async () => {
      preSeedMetadataWithPack('cafepack1');
      const { wave } = await runFanout({ ...baseOpts(), waveId: 'cafepack1' });
      expect(wave.pack).toEqual(PACK_RECORD);
      const stored = JSON.parse(fsReal.readFileSync(
        pathReal.join(project, '.claude', 'amicus_sessions', 'cafepack1', 'wave.json'), 'utf-8'));
      expect(stored.pack).toEqual(PACK_RECORD);
    });

    it('all-legs-unroutable short-circuit: wave.json inherits the pre-seeded pack when options.pack is absent', async () => {
      preSeedMetadataWithPack('cafepack2');
      const routingFailure = async () => ({
        kind: 'error', type: 'model_route_error', field: 'model', requested: 'x',
        reason: 'no_key_for_vendor', preferredGateway: 'direct', suggestions: [],
      });
      mockResolveRouteForLaunch.mockImplementationOnce(routingFailure).mockImplementationOnce(routingFailure);
      const { wave } = await runFanout({ ...baseOpts(), waveId: 'cafepack2' });
      expect(wave.status).toBe('error');
      expect(wave.pack).toEqual(PACK_RECORD);
      const stored = JSON.parse(fsReal.readFileSync(
        pathReal.join(project, '.claude', 'amicus_sessions', 'cafepack2', 'wave.json'), 'utf-8'));
      expect(stored.pack).toEqual(PACK_RECORD);
    });

    // v4.7 PR3 rider: errorWave is the THIRD buildWaveResult site. The T3
    // review gave it the tag inherit (`options.tag || metaTag`) but left pack
    // at bare `options.pack` — so an MCP-spawned wave whose server fails to
    // start persisted wave.json WITHOUT the pre-seeded pack, while the very
    // same wave's tag survived. Asymmetry, not intent: same silent-drop shape
    // the tag fix closed, and `amicus read --json` prefers wave.json.
    it('server start failure: the error wave inherits the pre-seeded pack (third buildWaveResult site)', async () => {
      preSeedMetadataWithPack('cafepack4');
      mockStartOpenCodeServer.mockRejectedValueOnce(new Error('no server'));
      const { wave } = await runFanout({ ...baseOpts(), waveId: 'cafepack4' });
      expect(wave.status).toBe('error');
      expect(wave.pack).toEqual(PACK_RECORD);
      const stored = JSON.parse(fsReal.readFileSync(
        pathReal.join(project, '.claude', 'amicus_sessions', 'cafepack4', 'wave.json'), 'utf-8'));
      expect(stored.pack).toEqual(PACK_RECORD);
    });

    it('server start failure without any pack: the error wave has NO pack key (absent, not null)', async () => {
      mockStartOpenCodeServer.mockRejectedValueOnce(new Error('no server'));
      const { wave } = await runFanout({ ...baseOpts(), waveId: 'cafepack5' });
      expect(wave.status).toBe('error');
      expect('pack' in wave).toBe(false);
      const stored = JSON.parse(fsReal.readFileSync(
        pathReal.join(project, '.claude', 'amicus_sessions', 'cafepack5', 'wave.json'), 'utf-8'));
      expect('pack' in stored).toBe(false);
    });

    it('an explicitly-passed options.pack still wins (precedence holds even if metadata.json seeded differently)', async () => {
      preSeedMetadataWithPack('cafepack3');
      const EXPLICIT_PACK = { name: 'explicit-pack', version: '2.0.0', hash: 'deadbeefcafe', source: 'dir' };
      const { wave } = await runFanout({ ...baseOpts(), waveId: 'cafepack3', pack: EXPLICIT_PACK });
      expect(wave.pack).toEqual(EXPLICIT_PACK);
    });

    it('no pack anywhere: wave.json has NO pack key (absent, not null)', async () => {
      const { wave } = await runFanout({ ...baseOpts(), waveId: 'cafepack4' });
      expect('pack' in wave).toBe(false);
      const stored = JSON.parse(fsReal.readFileSync(
        pathReal.join(project, '.claude', 'amicus_sessions', 'cafepack4', 'wave.json'), 'utf-8'));
      expect('pack' in stored).toBe(false);
    });
  });

  // v4.7 F8 (D13): --tag storage — same absent-not-null idiom, and the same
  // metaTag inherit-from-pre-seeded-metadata mechanism as pack above (mirrors
  // the describe block immediately above it; that block is the scaffolding
  // authority). Both buildWaveResult call sites (the normal-completion path
  // and the all-legs-unroutable short-circuit) are exercised here exactly as
  // they are for pack.
  describe('tag inheritance from pre-seeded metadata.json and pass-through (F8 D13)', () => {
    function preSeedMetadataWithTag(waveId) {
      const waveDir = pathReal.join(project, '.claude', 'amicus_sessions', waveId);
      fsReal.mkdirSync(waveDir, { recursive: true });
      fsReal.writeFileSync(pathReal.join(waveDir, 'metadata.json'), JSON.stringify({
        taskId: waveId, type: 'wave', status: 'running', tag: 'sprint-42',
      }, null, 2));
      return waveDir;
    }

    it('normal completion: wave.json inherits the pre-seeded tag when options.tag is absent', async () => {
      preSeedMetadataWithTag('cafetag1');
      const { wave } = await runFanout({ ...baseOpts(), waveId: 'cafetag1' });
      expect(wave.tag).toBe('sprint-42');
      const stored = JSON.parse(fsReal.readFileSync(
        pathReal.join(project, '.claude', 'amicus_sessions', 'cafetag1', 'wave.json'), 'utf-8'));
      expect(stored.tag).toBe('sprint-42');
    });

    it('all-legs-unroutable short-circuit: wave.json inherits the pre-seeded tag when options.tag is absent', async () => {
      preSeedMetadataWithTag('cafetag2');
      const routingFailure = async () => ({
        kind: 'error', type: 'model_route_error', field: 'model', requested: 'x',
        reason: 'no_key_for_vendor', preferredGateway: 'direct', suggestions: [],
      });
      mockResolveRouteForLaunch.mockImplementationOnce(routingFailure).mockImplementationOnce(routingFailure);
      const { wave } = await runFanout({ ...baseOpts(), waveId: 'cafetag2' });
      expect(wave.status).toBe('error');
      expect(wave.tag).toBe('sprint-42');
      const stored = JSON.parse(fsReal.readFileSync(
        pathReal.join(project, '.claude', 'amicus_sessions', 'cafetag2', 'wave.json'), 'utf-8'));
      expect(stored.tag).toBe('sprint-42');
    });

    it('an explicitly-passed options.tag still wins (precedence holds even if metadata.json seeded differently)', async () => {
      preSeedMetadataWithTag('cafetag3');
      const { wave } = await runFanout({ ...baseOpts(), waveId: 'cafetag3', tag: 'explicit-tag' });
      expect(wave.tag).toBe('explicit-tag');
    });

    it('no tag anywhere: wave.json has NO tag key (absent, not null)', async () => {
      const { wave } = await runFanout({ ...baseOpts(), waveId: 'cafetag4' });
      expect('tag' in wave).toBe(false);
      const stored = JSON.parse(fsReal.readFileSync(
        pathReal.join(project, '.claude', 'amicus_sessions', 'cafetag4', 'wave.json'), 'utf-8'));
      expect('tag' in stored).toBe(false);
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
