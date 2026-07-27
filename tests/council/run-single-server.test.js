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

  test('the server is seeded with every model the run can launch (bench + critic + chair)', async () => {
    await run({ critic: null });
    expect(startFn.mock.calls[0][1].models).toEqual(['gemini', 'gpt', 'qwen', 'deepseek']);
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

  // Standing ruling: never fail closed on availability. A shared server that
  // cannot start is a NOTICE — the run continues with one server per wave.
  test('a shared-server start failure degrades to per-wave servers, it does not abort the run', async () => {
    startFn = jest.fn(async () => { throw new Error('database is locked'); });
    const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const { exitCode } = await run();
      expect(exitCode).toBe(0);
      for (const [o] of mockRunFanout.mock.calls) {
        expect(o.server).toBeUndefined();
        expect(o.serverClient).toBeUndefined();
      }
      expect(stderr.mock.calls.map(c => String(c[0])).join('')).toMatch(/shared OpenCode server/i);
    } finally { stderr.mockRestore(); }
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
