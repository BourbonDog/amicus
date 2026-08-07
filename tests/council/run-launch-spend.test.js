// tests/council/run-launch-spend.test.js
'use strict';

/**
 * v4.3 Task 3 (spec §7.2): council leg spend attribution. Today every council
 * leg IS ledgered (fanout-leg.js:124's appendSpend), just with
 * councilRunId:null — so council chair/stage-leg spend is invisible in the
 * spend ledger. This closes that hole by stamping leg.councilRunId /
 * leg.councilName inside runFanout (fanout.js) and threading the ids down
 * from the council engine (run-launch.js -> run-stages/run-chair/run-debate).
 *
 * Test (a) is DI-only (the real `{fanoutFn}` seam on createLaunchers) and
 * needs no mocking of the transport.
 *
 * Tests (b)/(c) drive the REAL runFanout -> runLeg -> appendSpend ->
 * readSpendRows chain — no live OpenCode server, no live model call. This
 * mirrors tests/sidecar/fanout.test.js's existing mocking approach (mock
 * resolveRouteForLaunch + runHeadless + startOpenCodeServer; ledger dir via
 * AMICUS_CONFIG_DIR) rather than adding new test-only seams to fanout.js —
 * fanout.js is 277 lines against a hard 300-line gate with zero prior DI
 * seams, and Tasks 7/13/18/19 still need headroom in it.
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

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLaunchers } = require('../../src/council/run-launch');
const { runFanout } = require('../../src/sidecar/fanout');
const { readSpendRows } = require('../../src/utils/spend-ledger');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'council-spend-')); }

// A completed leg carrying a REPORTED cost, mirroring fanout.test.js's B24
// ledger block — resolveLegCost short-circuits on reportedCost > 0 before
// ever consulting pricing, so this stays deterministic and offline.
const legOk = (taskId) => ({
  summary: `summary ${taskId}`, completed: true, timedOut: false, aborted: false, taskId, toolCalls: [],
  usage: { tokens: { input: 100, output: 50, reasoning: 0, cacheRead: 0, cacheWrite: 0 }, costReported: 0.005 },
});

describe('council leg spend attribution (spec §7.2)', () => {
  // (a) run-launch threads the ids into the fanout call — the real DI seam
  // is {fanoutFn}, so this needs none of the transport mocks above.
  test('launchSolo forwards councilRunId/councilName into the runFanout options', async () => {
    let seen = null;
    const launchers = createLaunchers({ fanoutFn: async (opts) => { seen = opts; return { status: 'complete', legs: [] }; } });
    // Use a real writable temp dir, not a bogus '/p': launchWave mkdirSyncs
    // opts.project, and '/p' is an unwritable filesystem-root path on Linux
    // (EACCES) while Windows resolves it drive-relative — a real dir works on both.
    await launchers.launchSolo({
      role: 'chair', model: 'deepseek', councilRunId: 'c1', councilName: 'default', project: tmp(),
      systemPrompt: 's', userMessage: 'u', prompt: 'p',
    });
    expect(seen).toMatchObject({ councilRunId: 'c1', councilName: 'default' });
  });

  // D16 (v4.7 F8): tag rides the SAME forward as councilRunId/councilName —
  // same DI seam, same assertion shape as the test directly above.
  test('launchSolo forwards tag into the runFanout options (D16, same forward as councilRunId/councilName)', async () => {
    let seen = null;
    const launchers = createLaunchers({ fanoutFn: async (opts) => { seen = opts; return { status: 'complete', legs: [] }; } });
    await launchers.launchSolo({
      role: 'chair', model: 'deepseek', councilRunId: 'c1', councilName: 'default', tag: 'sprint42', project: tmp(),
      systemPrompt: 's', userMessage: 'u', prompt: 'p',
    });
    expect(seen).toMatchObject({ councilRunId: 'c1', councilName: 'default', tag: 'sprint42' });
  });

  describe('real fanout chain (AMICUS_CONFIG_DIR ledger dir, no live server)', () => {
    let prevConfigDir;
    let ledgerDir;
    let project;

    beforeEach(() => {
      jest.clearAllMocks();
      prevConfigDir = process.env.AMICUS_CONFIG_DIR;
      ledgerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-spend-ledger-'));
      process.env.AMICUS_CONFIG_DIR = ledgerDir;
      project = tmp();
      mockStartOpenCodeServer.mockResolvedValue({
        client: { tag: 'client' },
        server: { url: 'http://127.0.0.1:1', close: mockServerClose, goPid: 4242 },
      });
      mockRunHeadless.mockImplementation(async (_m, _s, _u, taskId) => legOk(taskId));
    });

    afterEach(() => {
      if (prevConfigDir === undefined) { delete process.env.AMICUS_CONFIG_DIR; }
      else { process.env.AMICUS_CONFIG_DIR = prevConfigDir; }
      fs.rmSync(project, { recursive: true, force: true });
    });

    // (b) runFanout stamps the ids onto each leg so fanout-leg.js's existing
    // (Task 1) appendSpend records them — the leg-stamping half of the fix.
    test('a council leg writes a ledger row carrying councilRunId + op:leg', async () => {
      await runFanout({
        models: 'deepseek', prompt: 'do the thing', project,
        includeContext: false, noValidateModel: true, json: true, quiet: true,
        waveId: 'ledgerwave-leg', councilRunId: 'c1', councilName: 'default',
      });
      const rows = readSpendRows(ledgerDir);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ op: 'leg', councilRunId: 'c1', councilName: 'default' });
    });

    // (c) end-to-end: a CHAIR solo (createLaunchers().launchSolo, exactly the
    // path run-chair.js's attemptChair/VERDICT-repair calls) must attribute
    // its ledger row. This is the spec's named defect ("chair spend is
    // invisible") and gets its own direct guard, not just an inference from
    // (a)+(b).
    test('a chair SOLO launched via createLaunchers().launchSolo carries councilRunId end-to-end', async () => {
      const { launchSolo } = createLaunchers();
      await launchSolo({
        model: 'deepseek', prompt: 'chair packet', project,
        waveId: 'ledgerwave-chair', councilRunId: 'c2', councilName: 'default',
      });
      const rows = readSpendRows(ledgerDir);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ op: 'leg', councilRunId: 'c2', councilName: 'default', model: 'deepseek' });
    });

    // D16 (v4.7 F8): a council leg launched with BOTH councilRunId and tag
    // carries both on its ledger row — the two attribution dims stamped in
    // the same stampLegAttribution pass (fanout-wave-io.js) must not clobber
    // each other.
    test('a council leg launched with a tag carries both councilRunId and tag', async () => {
      await runFanout({
        models: 'deepseek', prompt: 'do the thing', project,
        includeContext: false, noValidateModel: true, json: true, quiet: true,
        waveId: 'ledgerwave-tag', councilRunId: 'c3', councilName: 'default', tag: 'sprint42',
      });
      const rows = readSpendRows(ledgerDir);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ op: 'leg', councilRunId: 'c3', councilName: 'default', tag: 'sprint42' });
      // T7 review (ruled, accepted as desirable): the tag forward isn't
      // ledger-only — run-launch.js's `tag: opts.tag` reaches runFanout's own
      // options, so the SUB-WAVE's metadata.json inherits it too via the
      // pre-existing D13 spread (fanout.js's writeWaveMetadata call:
      // `...(options.tag ? { tag: options.tag } : {})`). A council leg's
      // tag is therefore visible on the wave record itself, not just the
      // spend ledger.
      const waveMeta = JSON.parse(fs.readFileSync(
        path.join(project, '.claude', 'amicus_sessions', 'ledgerwave-tag', 'metadata.json'), 'utf-8'));
      expect(waveMeta.tag).toBe('sprint42');
    });

    // An ordinary (non-council) fanout caller must see byte-for-byte the same
    // null attribution it saw before Task 3 — additive-only guard.
    test('an ordinary fanout leg (no council ids passed) keeps councilRunId/councilName null', async () => {
      await runFanout({
        models: 'deepseek', prompt: 'do the thing', project,
        includeContext: false, noValidateModel: true, json: true, quiet: true,
        waveId: 'ledgerwave-plain',
      });
      const rows = readSpendRows(ledgerDir);
      expect(rows).toHaveLength(1);
      expect(rows[0].councilRunId).toBeNull();
      expect(rows[0].councilName).toBeNull();
    });
  });
});
