// tests/council/run-single-server.test.js
'use strict';

/**
 * v4.4.1 Task 0.5 — a council run uses ONE OpenCode server.
 *
 * These tests drive the REAL createLaunchers (no injected `launchers`), so they
 * exercise the whole threading path: run.js acquires → run-launch.js forwards →
 * runFanout receives. Only the two ends are faked: the server start and the
 * fanout transport.
 *
 * The second half is the `_scratch` guarantee. Stage 2 runs its judges in
 * `<runDir>/_scratch` so a tool-capable judge cannot read the de-anonymized
 * `review-<model>.md` files or the plaintext labelMap in the parent run dir.
 * Sharing one server must not weaken that, and these tests check it directly
 * rather than trusting the argument.
 */

const mockRunFanout = jest.fn();
jest.mock('../../src/sidecar/fanout', () => ({
  ...jest.requireActual('../../src/sidecar/fanout'),
  runFanout: (...args) => mockRunFanout(...args),
}));

/**
 * The router, faked at the SAME seam a wave's own routing uses
 * (fanout-validate.js → utils/route-launch). `opus` is deliberately a DIVERGENT
 * vendor: OpenRouter serves `anthropic/claude-opus-4.8` while the direct API
 * serves `anthropic/claude-opus-4-8`. Any fix that "strips the openrouter/
 * prefix" instead of asking the router produces an id neither gateway serves.
 */
const ROUTES = {
  gemini: 'google/gemini-3.5-pro',
  gpt: 'openai/gpt-5.5',
  qwen: 'openrouter/qwen/qwen3-max',
  deepseek: 'deepseek/deepseek-v4',
  opus: 'anthropic/claude-opus-4-8',
  'openai/gpt-5.5-mini': 'openai/gpt-5.5-mini',
  ledgerpick: 'moonshot/kimi-k3',
};
const mockResolveRouteForLaunch = jest.fn(async ({ model }) => (
  ROUTES[model]
    ? { kind: 'resolved', executableId: ROUTES[model], gateway: 'direct', provenance: {} }
    : { kind: 'error', code: 'UNKNOWN_MODEL' }
));
jest.mock('../../src/utils/route-launch', () => ({
  resolveRouteForLaunch: (...args) => mockResolveRouteForLaunch(...args),
}));
jest.mock('../../src/utils/pricing', () => {
  const actual = jest.requireActual('../../src/utils/pricing');
  return { ...actual, lookupPricing: jest.fn(() => null) };
});

const fs = require('fs');
const os = require('os');
const path = require('path');
const { runCouncil } = require('../../src/council/run');
const { review, judgeOut, mkLeg, baseOptions } = require('./helpers/fake-launchers');

const noSignals = () => () => {};

/** A fake {client, server} pair with a spy-able close(). */
function fakeServerPair() {
  return {
    client: { tag: 'run-client' },
    server: { url: 'http://127.0.0.1:9/run', goPid: 77, close: jest.fn(async () => {}) },
  };
}

/** Transport-level script keyed by waveId, mirroring helpers/fake-launchers' happyScript. */
function happyTransport() {
  return {
    'abc123-s1': (o) => ({ wave: { status: 'complete', legs: o.models.split(',').map(m => mkLeg(m, review(m))) }, exitCode: 0 }),
    'abc123-s2': () => ({
      wave: {
        status: 'complete',
        legs: [
          mkLeg('gemini', judgeOut(['Review B', 'Review C', 'Review A'],
            [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'agree' }, { id: 'C1', verdict: 'neutral' }])),
          mkLeg('gpt', judgeOut(['Review A', 'Review C', 'Review B'],
            [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'agree' }, { id: 'C1', verdict: 'dispute' }])),
          mkLeg('qwen', judgeOut(['Review A', 'Review B', 'Review C'],
            [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'neutral' }, { id: 'C1', verdict: 'agree' }])),
        ],
      },
      exitCode: 0,
    }),
    'abc123-ch1': () => ({
      wave: { status: 'complete', legs: [mkLeg('deepseek', 'Synthesis.\n\nVERDICT: Ship it', 'complete', 0.03)] },
      exitCode: 0,
    }),
  };
}

describe('runCouncil — ONE OpenCode server per run (v4.4.1 Task 0.5)', () => {
  let tmp; let pair; let startFn; let script;

  const run = (overrides = {}, deps = {}) => runCouncil(
    baseOptions(tmp, overrides),
    { appendRunFn: jest.fn(), statsFn: () => [], installSignalAbortFn: noSignals,
      startOpenCodeServerFn: startFn, ...deps });

  beforeEach(() => {
    jest.clearAllMocks();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'council-1srv-'));
    pair = fakeServerPair();
    startFn = jest.fn(async () => pair);
    script = happyTransport();
    mockRunFanout.mockImplementation(async (o) => {
      const fn = script[o.waveId];
      if (!fn) { throw new Error(`no transport script for waveId ${o.waveId}`); }
      return fn(o);
    });
  });

  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  test('a full council run starts exactly ONE OpenCode server', async () => {
    const { exitCode } = await run();
    expect(exitCode).toBe(0);
    expect(startFn).toHaveBeenCalledTimes(1);
    // …and it launched more waves than that: Stage 1, Stage 2, the chair.
    expect(mockRunFanout.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  // ---- F1: the seed is RESOLVED executable ids, not raw alias names ----------
  //
  // buildProviderModels (utils/config.js) drops any seed string without a `/`,
  // so raw aliases registered NOTHING — the pre-#61 state Task 4.6/7.3 fixed.
  describe('the shared server is seeded with the ids a per-wave server would have', () => {
    test('bench + critic + chair are seeded as RESOLVED ids, never as aliases', async () => {
      await run({ critic: null });
      const seeded = startFn.mock.calls[0][1].models;
      expect(seeded).toEqual([
        'google/gemini-3.5-pro', 'openai/gpt-5.5', 'openrouter/qwen/qwen3-max', 'deepseek/deepseek-v4',
      ]);
      // The defect, pinned: not one bare alias survives into the seed, and
      // every entry carries the `/` addRoute requires.
      for (const id of seeded) {
        expect(Object.keys(ROUTES)).not.toContain(id);
        expect(id).toContain('/');
      }
    });

    // The evidence the fix is equivalent, not merely different: ask the REAL
    // per-wave routing path what each wave would have registered on a server of
    // its own, and require the shared seed to be a superset of that union.
    test('the seed is a superset of what every per-wave server would have registered', async () => {
      await run();
      const { validateFanoutModels } = require('../../src/sidecar/fanout-validate');
      const seeded = new Set(startFn.mock.calls[0][1].models);
      const perWave = new Set();
      for (const [o] of mockRunFanout.mock.calls) {
        const v = await validateFanoutModels(o.models, {
          noValidateModel: o.noValidateModel, gatewayMode: o.gatewayMode,
          fallback: o.fallback, catalog: o.catalog,
        });
        const ids = v.serverModels || v.legs.filter(l => l.ok).map(l => l.model);
        for (const id of ids) { perWave.add(id); }
      }
      expect(perWave.size).toBeGreaterThan(0);
      expect([...perWave].filter(id => !seeded.has(id))).toEqual([]);
    });

    // A divergent vendor's two gateway ids are DIFFERENT STRINGS, not
    // differently prefixed. The seed must be exactly what the router returned.
    test('a divergent-vendor route is seeded verbatim — nothing is derived by prefixing', async () => {
      await run({ models: ['gemini', 'gpt', 'opus'], critic: null });
      const seeded = startFn.mock.calls[0][1].models;
      expect(seeded).toContain('anthropic/claude-opus-4-8'); // direct: dash form
      expect(seeded).not.toContain('openrouter/anthropic/claude-opus-4-8');
      expect(seeded).not.toContain('anthropic/claude-opus-4.8');
    });

    // v4.3 Task 18 §6.2: run-launch.js forwards fallback/catalog on every stage
    // launch, so a per-wave server registered the chain union. So must this one.
    // Chains are keyed by the RESOLVED id (or its vendor), exactly as
    // fanout-validate.js keys them — another place a raw alias would miss.
    const chains = { 'google/gemini-3.5-pro': ['openai/gpt-5.5-mini'] };

    test('with fallback enabled, every chain candidate is in the seed', async () => {
      await run({ critic: null, fallback: { enabled: true, chains } });
      expect(startFn.mock.calls[0][1].models).toContain('openai/gpt-5.5-mini');
    });

    test('with fallback DISABLED the chain candidates stay out of the seed', async () => {
      await run({ critic: null, fallback: { enabled: false, chains } });
      expect(startFn.mock.calls[0][1].models).not.toContain('openai/gpt-5.5-mini');
    });

    // run-chair.js can promote a non-bench model out of the reliability ledger
    // mid-run. It is deterministic at run start (this run's own row is appended
    // only after the chair leg), so the seed can and must cover it.
    test('a chair the ledger could promote mid-run is seeded too', async () => {
      await run({ critic: null }, {
        statsFn: () => [{ model: 'ledgerpick', avgStreetCredPeersOnly: 1.1 }],
      });
      expect(startFn.mock.calls[0][1].models).toContain('moonshot/kimi-k3');
    });

    // Registration is config, not spend: an unroutable entry is dropped and
    // logged, never an abort. The leg fails loudly in its own wave instead.
    test('a model that cannot route is dropped from the seed, never fatal', async () => {
      const { exitCode } = await run({ models: ['gemini', 'gpt', 'nosuchmodel'], critic: null });
      expect(exitCode).toBe(0);
      const seeded = startFn.mock.calls[0][1].models;
      expect(seeded).not.toContain('nosuchmodel');
      expect(seeded).toContain('google/gemini-3.5-pro');
    });
  });

  test('every launch in the run rides the SAME injected pair, under serverClient (not client)', async () => {
    await run();
    expect(mockRunFanout.mock.calls.length).toBeGreaterThan(0);
    for (const [o] of mockRunFanout.mock.calls) {
      expect(o.server).toBe(pair.server);
      expect(o.serverClient).toBe(pair.client);
      // `client` on runFanout is the client TYPE string — it must stay unset.
      expect(o.client).toBeUndefined();
    }
  });

  // The one that matters more than a duplicate start: a double close tears the
  // server out from under the rest of the run.
  test('the run closes its server exactly once — happy path', async () => {
    await run();
    expect(pair.server.close).toHaveBeenCalledTimes(1);
  });

  test('the run closes its server exactly once — quorum error path', async () => {
    script['abc123-s1'] = () => ({
      wave: { status: 'partial', legs: [mkLeg('gemini', review('gemini'))] }, exitCode: 2,
    });
    const { exitCode, run: doc } = await run();
    expect(exitCode).toBe(1);
    expect(doc.error.code).toBe('COUNCIL_QUORUM');
    expect(pair.server.close).toHaveBeenCalledTimes(1);
  });

  test('the run closes its server exactly once — abort path', async () => {
    script['abc123-s1'] = () => ({ wave: { status: 'aborted', legs: [] }, exitCode: 130 });
    const { exitCode } = await run();
    expect(exitCode).toBe(130);
    expect(pair.server.close).toHaveBeenCalledTimes(1);
  });

  test('the run closes its server exactly once — internal throw path', async () => {
    script['abc123-s1'] = () => { throw new Error('transport exploded'); };
    const { exitCode } = await run();
    expect(exitCode).toBe(1);
    expect(pair.server.close).toHaveBeenCalledTimes(1);
  });

  // F4: the GENUINE signal terminal path. Every other close-once test above runs
  // with `installSignalAbortFn: noSignals`, so the path the brief's Step 9 named
  // — a real signal landing mid-run — was unexercised at the council level.
  describe('a real signal mid-run', () => {
    /** Capture run.js's handler so the test can fire it deterministically. */
    const capturing = (box) => ({ onAbort }) => { box.fire = onAbort; return jest.fn(); };

    const signalDuringStage1 = async (signal) => {
      const box = {};
      const s1 = script['abc123-s1'];
      script['abc123-s1'] = (o) => { box.fire(signal); return s1(o); };
      return run({}, { installSignalAbortFn: capturing(box) });
    };

    test('SIGINT: exit 130, run.json aborted, shared server closed exactly ONCE', async () => {
      const { exitCode } = await signalDuringStage1('SIGINT');
      expect(exitCode).toBe(130);
      expect(pair.server.close).toHaveBeenCalledTimes(1);
      const doc = JSON.parse(fs.readFileSync(path.join(baseOptions(tmp).runDir, 'run.json'), 'utf-8'));
      expect(doc.status).toBe('aborted');
      expect(doc.exitCode).toBe(130);
      // …and nothing paid launched after the signal.
      expect(mockRunFanout.mock.calls.some(([o]) => o.waveId === 'abc123-s2')).toBe(false);
    });

    test('SIGTERM: exit 143, shared server closed exactly ONCE', async () => {
      const { exitCode } = await signalDuringStage1('SIGTERM');
      expect(exitCode).toBe(143);
      expect(pair.server.close).toHaveBeenCalledTimes(1);
    });
  });

  // F2: finalize must survive its own failure.
  //
  // ⚠️ Correction to the review's stated mechanism: run.js's `return finalize(…)`
  // sites are BARE returns of a promise, so by async semantics a rejecting
  // finalize does NOT route through the enclosing catch — it never re-entered.
  // What it did instead was worse: it escaped runCouncil as a REJECTION, past
  // the module's own "never rejects for run errors" contract, after the shared
  // server had already been released and with no result for the caller. The
  // close is now claimed (so any future re-entry closes nothing twice) and the
  // bookkeeping is guarded (so the run still resolves).
  test('finalize surviving its own failure: run resolves, server still closed exactly once', async () => {
    const runState = require('../../src/council/run-state');
    const realCheckpoint = runState.checkpoint;
    let exploded = false;
    const spy = jest.spyOn(runState, 'checkpoint').mockImplementation((dir, patch) => {
      // Only the TERMINAL checkpoint (the one finalize writes) explodes.
      if (patch && patch.exitCode !== undefined) { exploded = true; throw new Error('run.json checkpoint exploded'); }
      return realCheckpoint(dir, patch);
    });
    const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const res = await run(); // must RESOLVE, not reject
      expect(exploded).toBe(true);
      expect(res.exitCode).toBe(0);
      // The returned doc still carries authoritative terminal fields.
      expect(res.run).toMatchObject({ status: 'complete', exitCode: 0 });
      expect(pair.server.close).toHaveBeenCalledTimes(1);
      expect(stderr.mock.calls.map(c => String(c[0])).join('')).toMatch(/bookkeeping failed at finalize/);
    } finally { spy.mockRestore(); stderr.mockRestore(); }
  });

  // Standing ruling: never fail closed on availability. A shared server that
  // cannot start is a NOTICE — the run continues with one server per wave.
  //
  // ⚠️ …but that fallback IS the bug this task removed, so it must also be LOUD
  // and DURABLE (Step 10.5). Run v441plan02 degraded exactly here, lost 4 of 5
  // seats to `database is locked`, and left nothing on run.json to show for it.
  describe('a shared-server start failure degrades — loudly, durably, never fatally', () => {
    let stderr;
    const failToStart = () => { startFn = jest.fn(async () => { throw new Error('database is locked'); }); };
    const runDoc = () => JSON.parse(
      fs.readFileSync(path.join(baseOptions(tmp).runDir, 'run.json'), 'utf-8'));

    beforeEach(() => {
      failToStart();
      stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    });
    afterEach(() => { stderr.mockRestore(); });

    test('it degrades to per-wave servers rather than aborting the run', async () => {
      const { exitCode } = await run();
      expect(exitCode).toBe(0);
      for (const [o] of mockRunFanout.mock.calls) {
        expect(o.server).toBeUndefined();
        expect(o.serverClient).toBeUndefined();
      }
      expect(stderr.mock.calls.map(c => String(c[0])).join('')).toMatch(/shared OpenCode server/i);
    });

    // NEVER FAIL CLOSED, pinned on its own: degrading must not abort the run.
    test('the run still completes when the shared server is unavailable', async () => {
      const { exitCode } = await run();
      expect(exitCode).not.toBe(1);
    });

    // (a): the degrade lands on the run's OWN record, next to budgetRefusals[].
    // A stderr Notice scrolls past; a `| tail` discarded the only one there was.
    test('a failed acquisition records sharedServerUnavailable on run.json', async () => {
      const { run: doc } = await run();
      expect(doc.sharedServerUnavailable).toBeTruthy();
      expect(doc.sharedServerUnavailable.error).toMatch(/database is locked/);
      expect(typeof doc.sharedServerUnavailable.at).toBe('string');
      // …and it survives to the ON-DISK terminal record, not just the return value.
      const onDisk = runDoc();
      expect(onDisk.sharedServerUnavailable.error).toMatch(/database is locked/);
      expect(onDisk.status).toBe('complete');
    });

    test('the degraded run.json still validates against the published schema', () => {
      const Ajv2020 = require('ajv/dist/2020');
      const schema = JSON.parse(fs.readFileSync(
        path.join(__dirname, '..', '..', 'schemas', 'council-run.schema.json'), 'utf-8'));
      const validate = new Ajv2020({ strict: false }).compile(schema);
      return run().then(({ run: doc }) => {
        if (!validate(doc)) { throw new Error('schema errors: ' + JSON.stringify(validate.errors, null, 2)); }
      });
    });

    // A clean acquisition must leave NO trace of a degrade — otherwise the field
    // is noise and a reader learns nothing from its presence.
    test('a healthy run carries no sharedServerUnavailable at all', async () => {
      startFn = jest.fn(async () => pair);
      const { run: doc } = await run();
      expect(doc.sharedServerUnavailable).toBeUndefined();
    });

    // Bookkeeping must never sink the run it reports on: run.js awaits the
    // acquisition OUTSIDE its try, so a throw here would escape runCouncil as a
    // rejection, past its "never rejects for run errors" contract.
    test('an unwritable run.json does not turn the degrade into a rejection', async () => {
      const runState = require('../../src/council/run-state');
      const real = runState.checkpoint;
      const spy = jest.spyOn(runState, 'checkpoint').mockImplementation((dir, patch) => {
        if (patch && patch.sharedServerUnavailable) { throw new Error('run.json is unwritable'); }
        return real(dir, patch);
      });
      try {
        const { exitCode } = await run(); // must RESOLVE, not reject
        expect(exitCode).toBe(0);
      } finally { spy.mockRestore(); }
    });
  });

  // ---- the `_scratch/` anonymisation boundary, verified rather than assumed ----
  describe('_scratch judge isolation survives the shared server', () => {
    test('Stage 2 is scoped to _scratch and Stage 1 to the run dir — on the SAME server', async () => {
      const opts = baseOptions(tmp);
      await run();
      const byWave = Object.fromEntries(mockRunFanout.mock.calls.map(([o]) => [o.waveId, o]));
      const scratch = path.join(opts.runDir, '_scratch');

      // Per-call scoping is what enforces the boundary; it is unchanged.
      expect(byWave['abc123-s1'].project).toBe(opts.runDir);
      expect(byWave['abc123-s1'].directory).toBe(opts.runDir);
      expect(byWave['abc123-s2'].project).toBe(scratch);
      expect(byWave['abc123-s2'].directory).toBe(scratch);

      // …while both ran on the one server.
      expect(byWave['abc123-s1'].server).toBe(pair.server);
      expect(byWave['abc123-s2'].server).toBe(pair.server);
      expect(startFn).toHaveBeenCalledTimes(1);
    });

    test('every council launch still strips MCP — a judge gains no tools from sharing', async () => {
      await run();
      for (const [o] of mockRunFanout.mock.calls) {
        expect(o.noMcp).toBe(true);
        expect(o.mcp).toBeUndefined();
        expect(o.mcpConfig).toBeUndefined();
      }
    });

    test('the de-anonymized reviews really do sit outside the judges\' directory', async () => {
      const opts = baseOptions(tmp);
      await run();
      // review-*.md live in the run dir; the judges are scoped to _scratch.
      for (const m of ['gemini', 'gpt', 'qwen']) {
        expect(fs.existsSync(path.join(opts.runDir, `review-${m}.md`))).toBe(true);
        expect(fs.existsSync(path.join(opts.runDir, '_scratch', `review-${m}.md`))).toBe(false);
      }
      expect(fs.existsSync(path.join(opts.runDir, 'run.json'))).toBe(true);
      expect(fs.existsSync(path.join(opts.runDir, '_scratch', 'run.json'))).toBe(false);
    });

    // The server process itself is directory-agnostic: startOpenCodeServer takes
    // no project/cwd, so there is nothing about it to scope to a directory in
    // the first place. Pinning the signature keeps that true.
    test('the shared server is started with no project/cwd of its own', async () => {
      await run();
      const [mcpConfig, serverOpts] = startFn.mock.calls[0];
      expect(serverOpts.project).toBeUndefined();
      expect(serverOpts.cwd).toBeUndefined();
      expect(serverOpts.directory).toBeUndefined();
      // MCP surface is built the same way every council wave builds it.
      expect(mcpConfig === null || typeof mcpConfig === 'object').toBe(true);
    });
  });
});
