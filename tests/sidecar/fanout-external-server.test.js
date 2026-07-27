// tests/sidecar/fanout-external-server.test.js
'use strict';

/**
 * v4.4.1 Task 0.5 — runFanout's external-server seam.
 *
 * The defect: a council run launches its Stage-1 seat wave and its critic solo
 * under ONE Promise.all (run-stages.js:83). Both called runFanout, and runFanout
 * started a server unconditionally — so two starts ~140ms apart raced on
 * OpenCode's SQLite and the loser died with `database is locked`. Run
 * v441plan01 lost four of five seats in 736ms and failed quorum.
 *
 * The seam mirrors runHeadless (src/headless.js:245) with one deliberate name
 * divergence: runFanout's `options.client` is already the client TYPE string, so
 * the injected SDK client is `options.serverClient`.
 */

const mockResolveRouteForLaunch = jest.fn(async ({ model }) => ({
  kind: 'resolved', executableId: model, gateway: 'direct', provenance: {},
}));
jest.mock('../../src/utils/route-launch', () => ({
  resolveRouteForLaunch: (...args) => mockResolveRouteForLaunch(...args),
}));

jest.mock('../../src/utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../src/utils/pricing', () => {
  const actual = jest.requireActual('../../src/utils/pricing');
  return { ...actual, lookupPricing: jest.fn(() => null) };
});

const mockRunHeadless = jest.fn();
jest.mock('../../src/headless', () => {
  const actual = jest.requireActual('../../src/headless');
  return { ...actual, runHeadless: mockRunHeadless };
});

const mockStartOpenCodeServer = jest.fn();
jest.mock('../../src/sidecar/session-utils', () => {
  const actual = jest.requireActual('../../src/sidecar/session-utils');
  return { ...actual, startOpenCodeServer: mockStartOpenCodeServer };
});

jest.mock('../../src/sidecar/context-builder', () => ({
  buildContext: jest.fn(() => 'CTX'),
  parseDuration: jest.fn(),
}));

const fs = require('fs');
const os = require('os');
const path = require('path');
const { runFanout } = require('../../src/sidecar/fanout');
const { getSessionDir } = require('../../src/session-manager');

/** A fresh {client, server} pair with a spy-able close(). */
function fakeServerPair(tag = 'shared') {
  return {
    client: { tag },
    server: { url: `http://127.0.0.1:1/${tag}`, goPid: 4242, close: jest.fn(async () => {}) },
  };
}

const legOk = (taskId) => ({
  summary: `summary ${taskId}`, completed: true, timedOut: false, aborted: false, taskId, toolCalls: [],
});

describe('runFanout external-server seam (v4.4.1 Task 0.5)', () => {
  let project;

  beforeEach(() => {
    jest.clearAllMocks();
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-extsrv-'));
    mockStartOpenCodeServer.mockImplementation(async () => fakeServerPair('owned'));
    mockRunHeadless.mockImplementation(async (_m, _s, _u, taskId) => legOk(taskId));
  });

  afterEach(() => { fs.rmSync(project, { recursive: true, force: true }); });

  const fanoutOpts = (over = {}) => ({
    models: 'openrouter/a/b,openrouter/c/d',
    prompt: 'do the thing',
    promptMeta: { source: 'inline', file: null, chars: 12 },
    project,
    includeContext: false,
    noValidateModel: true,
    json: true,
    quiet: true,
    ...over,
  });

  // Step 1/6: the pinned defect, inverted. Two concurrent waves that SHARE an
  // injected server start exactly ONE server between them — before the seam
  // existed this was two, 140ms apart, and the loser died on `database is locked`.
  test('two concurrent waves sharing an injected server start ZERO servers of their own', async () => {
    const pair = fakeServerPair();
    const results = await Promise.all([
      runFanout(fanoutOpts({ waveId: 'aaaa0001', serverClient: pair.client, server: pair.server })),
      runFanout(fanoutOpts({ waveId: 'aaaa0002', serverClient: pair.client, server: pair.server })),
    ]);
    expect(mockStartOpenCodeServer).toHaveBeenCalledTimes(0);
    expect(pair.server.close).not.toHaveBeenCalled();
    expect(results.map(r => r.wave.status)).toEqual(['complete', 'complete']);
  });

  // The counterfactual that proves the assertion above is about the seam and
  // not about the mock: without injection, the SAME two concurrent waves each
  // start their own server. That is the race, pinned.
  test('without injection, two concurrent waves each start their OWN server (the race)', async () => {
    await Promise.all([
      runFanout(fanoutOpts({ waveId: 'aaaa0003' })),
      runFanout(fanoutOpts({ waveId: 'aaaa0004' })),
    ]);
    expect(mockStartOpenCodeServer).toHaveBeenCalledTimes(2);
  });

  test('an injected server is used by every leg and is NOT closed — it is not ours', async () => {
    const pair = fakeServerPair();
    const { wave, exitCode } = await runFanout(
      fanoutOpts({ waveId: 'aaaa0005', serverClient: pair.client, server: pair.server }));

    expect(mockStartOpenCodeServer).not.toHaveBeenCalled();
    expect(pair.server.close).not.toHaveBeenCalled();
    expect(mockRunHeadless).toHaveBeenCalledTimes(2);
    for (const call of mockRunHeadless.mock.calls) {
      expect(call[7].client).toBe(pair.client);
      expect(call[7].server).toBe(pair.server);
    }
    expect(wave.status).toBe('complete');
    expect(exitCode).toBe(0);
  });

  test('a server runFanout started itself is still owned and still closed', async () => {
    const pair = fakeServerPair('owned');
    mockStartOpenCodeServer.mockResolvedValue(pair);
    await runFanout(fanoutOpts({ waveId: 'aaaa0006' }));
    expect(mockStartOpenCodeServer).toHaveBeenCalledTimes(1);
    expect(pair.server.close).toHaveBeenCalledTimes(1);
  });

  // Both or neither: a half-injection must not run clientless. It falls back to
  // owning a server, which is the safe direction (a duplicate start degrades;
  // a missing client crashes every leg).
  test('server without serverClient falls back to owning a server', async () => {
    const pair = fakeServerPair();
    await runFanout(fanoutOpts({ waveId: 'aaaa0007', server: pair.server }));
    expect(mockStartOpenCodeServer).toHaveBeenCalledTimes(1);
    expect(pair.server.close).not.toHaveBeenCalled();
  });

  test('serverClient without server falls back to owning a server', async () => {
    const pair = fakeServerPair();
    await runFanout(fanoutOpts({ waveId: 'aaaa0008', serverClient: pair.client }));
    expect(mockStartOpenCodeServer).toHaveBeenCalledTimes(1);
  });

  // `options.client` on runFanout is the client TYPE string (buildMcpConfig's
  // clientType). It must never be mistaken for an injected SDK client.
  test('options.client (the client TYPE string) does NOT trigger the seam', async () => {
    const pair = fakeServerPair();
    await runFanout(fanoutOpts({ waveId: 'aaaa0009', client: 'cowork', server: pair.server }));
    expect(mockStartOpenCodeServer).toHaveBeenCalledTimes(1);
  });

  // mcp-server.js's wave abort SIGTERMs metadata.goPid as "the orchestrator +
  // its OWNED OpenCode server" — recording an injected server's pid there would
  // invite a per-wave abort to kill every sibling wave in the run.
  test('an injected server\'s goPid is NOT recorded in the wave metadata', async () => {
    const pair = fakeServerPair();
    await runFanout(fanoutOpts({ waveId: 'aaaa0010', serverClient: pair.client, server: pair.server }));
    const meta = JSON.parse(fs.readFileSync(
      path.join(getSessionDir(project, 'aaaa0010'), 'metadata.json'), 'utf-8'));
    expect(meta.goPid).toBeUndefined();

    await runFanout(fanoutOpts({ waveId: 'aaaa0011' })); // owned server: still recorded
    const owned = JSON.parse(fs.readFileSync(
      path.join(getSessionDir(project, 'aaaa0011'), 'metadata.json'), 'utf-8'));
    expect(owned.goPid).toBe(4242);
  });

  // Step 10: the failed run wrote metadata.json with the reason but no
  // wave.json, so run.json recorded stage1 'complete' with no trace of four
  // dead seats. Backlog C1 covered the pre-`try` throw; this is its sibling.
  describe('a wave that dies before its legs still writes wave.json', () => {
    test('server-start failure persists an error wave doc', async () => {
      mockStartOpenCodeServer.mockRejectedValue(new Error('Unexpected error\n\ndatabase is locked'));
      const { wave, exitCode } = await runFanout(fanoutOpts({ waveId: 'aaaa0012' }));

      const waveDir = getSessionDir(project, 'aaaa0012');
      const doc = JSON.parse(fs.readFileSync(path.join(waveDir, 'wave.json'), 'utf-8'));
      expect(doc.status).toBe('error');
      expect(doc.reason).toMatch(/database is locked/);
      expect(doc.error).toMatch(/database is locked/);
      expect(doc.waveId).toBe('aaaa0012');

      // …and the returned doc agrees with what landed on disk.
      expect(wave.status).toBe('error');
      expect(exitCode).toBe(1);

      const meta = JSON.parse(fs.readFileSync(path.join(waveDir, 'metadata.json'), 'utf-8'));
      expect(meta.status).toBe('error');
      expect(meta.reason).toMatch(/database is locked/);
    });
  });
});
