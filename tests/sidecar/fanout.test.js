// tests/sidecar/fanout.test.js
'use strict';

const mockValidateAgainstCatalog = jest.fn(async (m) => m);
jest.mock('../../src/utils/model-validator', () => ({
  validateAgainstCatalog: mockValidateAgainstCatalog,
}));

const mockValidateApiKey = jest.fn(() => ({ valid: true }));
jest.mock('../../src/utils/validators', () => {
  const actual = jest.requireActual('../../src/utils/validators');
  return { ...actual, validateApiKey: mockValidateApiKey };
});

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

    it('resolves every model and keeps the original input alongside (with pricing field)', async () => {
      const r = await validateFanoutModels('openrouter/a/b,c/d');
      expect(r.legs).toHaveLength(2);
      expect(r.legs[0]).toMatchObject({ modelInput: 'openrouter/a/b', model: 'openrouter/a/b' });
      expect(r.legs[1]).toMatchObject({ modelInput: 'c/d', model: 'c/d' });
      // pricing field is present (may be null if not in catalog)
      expect(Object.prototype.hasOwnProperty.call(r.legs[0], 'pricing')).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(r.legs[1], 'pricing')).toBe(true);
      expect(mockValidateAgainstCatalog).toHaveBeenCalledTimes(2);
    });

    it('fails fast on a missing API key', async () => {
      mockValidateApiKey.mockReturnValueOnce({ valid: false, error: 'Error: no key for provider a' });
      const r = await validateFanoutModels('a/b,c/d');
      expect(r.error).toMatch(/no key/);
    });

    it('fails fast on catalog rejection unless noValidateModel', async () => {
      mockValidateAgainstCatalog.mockRejectedValueOnce(new Error('Model not in catalog: a/zzz'));
      const r = await validateFanoutModels('a/zzz');
      expect(r.error).toMatch(/not in catalog/);

      const r2 = await validateFanoutModels('a/zzz', { noValidateModel: true });
      expect(r2.legs).toHaveLength(1);
    });

    it('fails fast on an unresolvable alias', async () => {
      // 'nosuchalias' has no slash → resolveModel throws (no such alias in config)
      const r = await validateFanoutModels('nosuchalias-xyz-f4');
      expect(r.error).toBeDefined();
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
});
