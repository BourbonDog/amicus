// tests/f8-tag-parity.test.js
'use strict';

/**
 * v4.7 PR3 Task 9 (F8 composition): end-to-end tag/search/spend parity
 * invariant suite.
 *
 * Tasks 1-8 each RED-proved one LAYER of the --tag feature in isolation
 * (CLI arg validation, a single writer, a single launch site, ...). This
 * suite is different in kind: it drives the REAL CLI entry points
 * (handleStart / handleFanout / runCouncil) through to REAL disk writers
 * (metadata.json, wave.json, run.json, spend-ledger.jsonl) and back out
 * through the REAL read surfaces (enumerateSessions, searchSessions,
 * handleSpend --group-by, listCouncilRuns) — pinning the COMPOSITION later
 * PRs must keep green, not any single function's contract.
 *
 * Every scenario here is expected to pass immediately: it is built entirely
 * out of pieces Tasks 1-8 already proved RED->GREEN on their own. If a
 * scenario fails, the bug is in how two already-proven pieces were wired
 * together (a Task 1-8 regression), never a new behavior this suite invents —
 * see task-9-report.md for the mutation-check evidence that this suite
 * actually exercises the wiring and not just the individual layers.
 *
 * Harness idioms borrowed verbatim from (read these first if this file is
 * confusing):
 *   - tests/pack/cli-fanout-start-pack.test.js — parseArgs + handleStart/
 *     handleFanout CLI-level driving, mocked resolveLaunchModel.
 *   - tests/sidecar/fanout.test.js — the runFanout mock stack (route-launch,
 *     pricing, headless, session-utils, context-builder) and the B24 spend
 *     ledger describe block idiom.
 *   - tests/start-json.test.js — startSidecar's own spend-ledger append idiom
 *     (mock headless/context-builder/logger only, no route-launch/session-utils
 *     needed since the solo headless path never touches the shared server).
 *   - tests/continue-resume-spend.test.js — the AMICUS_CONFIG_DIR-as-ledger-dir
 *     save/restore idiom used by every describe block below.
 *   - tests/council/run-launch-spend.test.js + tests/mcp-council-list.test.js —
 *     the real-transport council leg chain and the council-row MCP surface.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// ---- shared mock stack (union of the precedents named above) ----
const mockResolveRouteForLaunch = jest.fn(async ({ model }) => ({
  kind: 'resolved', executableId: model,
  gateway: model.startsWith('openrouter/') ? 'openrouter'
    : model.startsWith('ollama/') ? 'local' : 'direct',
  provenance: {},
}));
jest.mock('../src/utils/route-launch', () => ({
  resolveRouteForLaunch: (...args) => mockResolveRouteForLaunch(...args),
}));

jest.mock('../src/utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const mockLookupPricing = jest.fn(() => null);
jest.mock('../src/utils/pricing', () => {
  const actual = jest.requireActual('../src/utils/pricing');
  return { ...actual, lookupPricing: (...args) => mockLookupPricing(...args) };
});

const mockRunHeadless = jest.fn();
jest.mock('../src/headless', () => {
  const actual = jest.requireActual('../src/headless');
  return { ...actual, runHeadless: mockRunHeadless };
});

const mockStartOpenCodeServer = jest.fn();
jest.mock('../src/sidecar/session-utils', () => {
  const actual = jest.requireActual('../src/sidecar/session-utils');
  return { ...actual, startOpenCodeServer: mockStartOpenCodeServer };
});

jest.mock('../src/sidecar/context-builder', () => ({
  buildContext: jest.fn(() => 'CTX'),
  parseDuration: jest.fn(),
}));

// resolveLaunchModel mocked to a passthrough (tests/pack/cli-fanout-start-pack.test.js
// idiom): every model literal used below is already slash-ful, so this needs
// no alias map. maybeOfferProviderDefaults stays REAL (requireActual spread)
// — it no-ops under --json anyway (start-helpers.js:159).
const mockResolveLaunchModel = jest.fn(async (args) => ({ model: args.model, alias: undefined }));
jest.mock('../src/utils/start-helpers', () => ({
  ...jest.requireActual('../src/utils/start-helpers'),
  resolveLaunchModel: (...args) => mockResolveLaunchModel(...args),
}));

const { parseArgs } = require('../src/cli');
const { handleStart } = require('../src/cli-handlers-run');
const { handleFanout } = require('../src/cli-handlers-fanout');
const { handleSpend } = require('../src/cli-handlers-spend');
const { readSpendRows } = require('../src/utils/spend-ledger');
const { enumerateSessions, searchSessions } = require('../src/sidecar/read');
const { runCouncil } = require('../src/council/run');
const runState = require('../src/council/run-state');
const { createLaunchers } = require('../src/council/run-launch');
const { listCouncilRuns } = require('../src/mcp-council-awareness');
const { scriptedLaunchers, happyScript, baseOptions } = require('./council/helpers/fake-launchers');

const noSignals = () => () => {};

/** A completed leg carrying a REPORTED cost (fanout.test.js's B24 idiom):
 * resolveLegCost short-circuits on reportedCost > 0 before ever consulting
 * pricing, so this stays deterministic and offline for both the solo
 * (startSidecar) and wave/council (runFanout) headless call shapes — both
 * pass `taskId` as runHeadless's 4th positional arg. */
const legOk = (taskId) => ({
  summary: `summary ${taskId}`, completed: true, timedOut: false, aborted: false, taskId, toolCalls: [],
  usage: { tokens: { input: 100, output: 50, reasoning: 0, cacheRead: 0, cacheWrite: 0 }, costReported: 0.005 },
});

/** cli-handlers-spend.test.js's `capture` idiom, adapted to always drive JSON
 * mode and always pin `dir` to the caller's ledgerDir (no network credit probe). */
async function captureSpendJson(extraArgs, ledgerDir) {
  const chunks = [];
  const orig = process.stdout.write;
  process.stdout.write = (s) => { chunks.push(s); return true; };
  try {
    await handleSpend({ _: ['spend'], json: true, ...extraArgs }, {
      dir: ledgerDir, readApiKeyValues: () => ({}),
      checkOpenRouterCredit: async () => ({ warning: null }), now: () => Date.now(),
    });
  } finally {
    process.stdout.write = orig;
  }
  return JSON.parse(chunks.join(''));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLookupPricing.mockReturnValue(null);
  mockResolveLaunchModel.mockImplementation(async (args) => ({ model: args.model, alias: undefined }));
  mockStartOpenCodeServer.mockResolvedValue({
    client: { tag: 'client' },
    server: { url: 'http://127.0.0.1:1', close: jest.fn(), goPid: 4242 },
  });
  mockRunHeadless.mockImplementation(async (_m, _s, _u, taskId) => legOk(taskId));
});

// ============================================================================
// Scenario 1: CLI solo chain — `amicus start --tag alpha`
// ============================================================================
describe('Scenario 1: CLI solo chain (--tag alpha)', () => {
  let project;
  let ledgerDir;
  let prevConfigDir;

  beforeEach(() => {
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'f8-solo-'));
    prevConfigDir = process.env.AMICUS_CONFIG_DIR;
    ledgerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f8-solo-ledger-'));
    process.env.AMICUS_CONFIG_DIR = ledgerDir;
  });

  afterEach(() => {
    fs.rmSync(project, { recursive: true, force: true });
    if (prevConfigDir === undefined) { delete process.env.AMICUS_CONFIG_DIR; }
    else { process.env.AMICUS_CONFIG_DIR = prevConfigDir; }
  });

  // T3-review regression-pin note: every OTHER --tag suite either mocks
  // startAmicus entirely (tests/pack/cli-fanout-start-pack.test.js — proves
  // the CLI forwards `tag` into the call, never that startSidecar's own
  // destructure/write picks it up) or calls startSidecar directly
  // (tests/start-json.test.js — proves the writer, never that the CLI
  // handler's options object actually reaches it). THIS is the only suite
  // that drives `handleStart` (cli-handlers-run.js) through to a REAL,
  // unmocked `startAmicus` write — so the metadata.json assertion below is
  // the first (and only) regression pin on cli-handlers-run.js:131's
  // `tag: args.tag,` forward. See task-9-report.md for the mutation-check
  // proof (commenting that line out fails this exact assertion).
  test('metadata.json, the run doc, the enumerateSessions row, searchSessions, and the spend row all carry tag "alpha"', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const code = await handleStart(parseArgs([
        'start', '--model', 'vendorx/solo-model', '--prompt', 'do the solo task',
        '--no-ui', '--json', '--no-cost-gate', '--cwd', project,
        '--task-id', 'solotagT9a', '--tag', 'alpha',
      ]));
      expect(code).toBe(0);

      // metadata.json
      const metaPath = path.join(project, '.claude', 'amicus_sessions', 'solotagT9a', 'metadata.json');
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      expect(meta.tag).toBe('alpha');

      // run doc (the ONLY stdout write in --json mode)
      expect(logSpy).toHaveBeenCalledTimes(1);
      const doc = JSON.parse(logSpy.mock.calls[0][0]);
      expect(doc.tag).toBe('alpha');

      // enumerateSessions row
      const rows = enumerateSessions(project, {});
      const row = rows.find((r) => r.id === 'solotagT9a');
      expect(row).toBeDefined();
      expect(row.tag).toBe('alpha');

      // searchSessions matches 'alpha' by tag
      const matches = searchSessions(rows, 'alpha', { project });
      expect(matches.map((r) => r.id)).toContain('solotagT9a');

      // spend row
      const spendRows = readSpendRows(ledgerDir);
      const spendRow = spendRows.find((r) => r.taskId === 'solotagT9a');
      expect(spendRow).toBeDefined();
      expect(spendRow.tag).toBe('alpha');
    } finally {
      logSpy.mockRestore();
    }
  });
});

// ============================================================================
// Scenario 2: CLI wave chain — `amicus fanout --tag alpha`
// ============================================================================
describe('Scenario 2: CLI wave chain (--tag alpha)', () => {
  let project;
  let ledgerDir;
  let prevConfigDir;

  beforeEach(() => {
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'f8-wave-'));
    prevConfigDir = process.env.AMICUS_CONFIG_DIR;
    ledgerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f8-wave-ledger-'));
    process.env.AMICUS_CONFIG_DIR = ledgerDir;
  });

  afterEach(() => {
    fs.rmSync(project, { recursive: true, force: true });
    if (prevConfigDir === undefined) { delete process.env.AMICUS_CONFIG_DIR; }
    else { process.env.AMICUS_CONFIG_DIR = prevConfigDir; }
  });

  test('wave metadata.json + wave.json, leg spend rows, --group-by tag, and --search over the full (>200-char) briefing all carry/find tag "alpha"', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    // >200 chars so the row's own `briefing` field (fanout.js:146 truncates to
    // 200) can NEVER satisfy the search below — only reading the full
    // waveDir/briefing.md (list-search.js's waveSearchMaterial) can.
    const needle = 'UNIQUE_TAIL_NEEDLE_9f3';
    const briefingText = `${'A'.repeat(220)} ${needle}`;
    try {
      const code = await handleFanout(parseArgs([
        'fanout', '--models', 'openrouter/a/b,openrouter/c/d', '--prompt', briefingText,
        '--json', '--no-cost-gate', '--no-validate-model', '--cwd', project,
        '--wave-id', 'wavetagT9b', '--tag', 'alpha',
      ]));
      expect(code).toBe(0);

      // wave metadata.json + wave.json
      const waveDir = path.join(project, '.claude', 'amicus_sessions', 'wavetagT9b');
      const meta = JSON.parse(fs.readFileSync(path.join(waveDir, 'metadata.json'), 'utf-8'));
      expect(meta.tag).toBe('alpha');
      const waveDoc = JSON.parse(fs.readFileSync(path.join(waveDir, 'wave.json'), 'utf-8'));
      expect(waveDoc.tag).toBe('alpha');

      // leg spend rows
      const spendRows = readSpendRows(ledgerDir).filter((r) => r.waveId === 'wavetagT9b');
      expect(spendRows).toHaveLength(2);
      for (const row of spendRows) { expect(row.tag).toBe('alpha'); }

      // --group-by tag groups the two leg rows under 'alpha'
      const spendDoc = await captureSpendJson({ 'group-by': 'tag' }, ledgerDir);
      const group = spendDoc.groups.find((g) => g.key === 'alpha');
      expect(group).toBeDefined();
      expect(group.runs).toBe(2);

      // --search over the tail of the full briefing.md (not the 200-char excerpt)
      const rows = enumerateSessions(project, {});
      const found = searchSessions(rows, needle.toLowerCase(), { project });
      expect(found.map((r) => r.id)).toContain('wavetagT9b');
    } finally {
      logSpy.mockRestore();
    }
  });
});

// ============================================================================
// Scenario 3: Council chain — runCouncil / real council-leg transport, tagged
// ============================================================================
describe('Scenario 3: Council chain (--tag alpha)', () => {
  test('runCouncil: run.json carries tag, the Stage-1 launch call carries it, and listCouncilRuns\' MCP row carries it', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'f8-council-'));
    try {
      const launchers = scriptedLaunchers(happyScript());
      const { exitCode, run } = await runCouncil(
        baseOptions(tmp, { councilName: 'nightly-council', tag: 'alpha' }),
        { launchers, appendRunFn: jest.fn(), statsFn: () => [], installSignalAbortFn: noSignals },
      );
      expect(exitCode).toBe(0);

      // run.json (returned doc + independent disk re-read)
      expect(run.tag).toBe('alpha');
      const onDisk = runState.readRun(path.join(tmp, 'council-abc123'));
      expect(onDisk.tag).toBe('alpha');

      // the primary Stage-1 seat-wave launch call carries the tag forward
      const s1 = launchers.calls.find((c) => c.waveId === 'abc123-s1');
      expect(s1.tag).toBe('alpha');

      // MCP surface (mcp-council-list.test.js idiom, direct — listCouncilRuns
      // is exactly what amicus_list's handler calls for council rows):
      const rows = listCouncilRuns(tmp);
      const row = rows.find((r) => r.id === 'abc123');
      expect(row).toBeDefined();
      expect(row.tag).toBe('alpha');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  // Closes a gap the DI-mocked fanoutFn test in run-launch-spend.test.js (a)
  // leaves open: that test proves createLaunchers().launchSolo FORWARDS tag
  // into whatever fanoutFn it's given, but with fanoutFn mocked out, never
  // proves the REAL runFanout -> real fanout-leg -> real disk writers
  // (sub-wave metadata.json, spend-ledger row) actually receive it. This test
  // is the real-transport counterpart, mirroring run-launch-spend.test.js's
  // own "real fanout chain" describe block (AMICUS_CONFIG_DIR ledger dir, no
  // live server) but through the createLaunchers() layer instead of calling
  // runFanout directly.
  describe('real council-leg transport (mirrors run-launch-spend.test.js\'s real fanout chain)', () => {
    let project;
    let ledgerDir;
    let prevConfigDir;

    beforeEach(() => {
      project = fs.mkdtempSync(path.join(os.tmpdir(), 'f8-council-leg-'));
      prevConfigDir = process.env.AMICUS_CONFIG_DIR;
      ledgerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f8-council-leg-ledger-'));
      process.env.AMICUS_CONFIG_DIR = ledgerDir;
    });

    afterEach(() => {
      fs.rmSync(project, { recursive: true, force: true });
      if (prevConfigDir === undefined) { delete process.env.AMICUS_CONFIG_DIR; }
      else { process.env.AMICUS_CONFIG_DIR = prevConfigDir; }
    });

    test('createLaunchers().launchSolo with tag: the sub-wave\'s own metadata.json AND its leg spend row both carry tag "alpha"', async () => {
      const { launchSolo } = createLaunchers();
      await launchSolo({
        model: 'deepseek', prompt: 'chair packet', project,
        waveId: 'ctagwave1', councilRunId: 'ctagrun1', councilName: 'default', tag: 'alpha',
      });

      // sub-wave metadata.json (the solo's own 1-leg wave dir)
      const meta = JSON.parse(fs.readFileSync(
        path.join(project, '.claude', 'amicus_sessions', 'ctagwave1', 'metadata.json'), 'utf-8'));
      expect(meta.tag).toBe('alpha');

      // leg spend row
      const rows = readSpendRows(ledgerDir);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        op: 'leg', councilRunId: 'ctagrun1', councilName: 'default', tag: 'alpha',
      });
    });
  });
});

// ============================================================================
// Scenario 4: Untagged parity — the same three chains, no --tag
// ============================================================================
describe('Scenario 4: Untagged parity (no --tag)', () => {
  describe('4a. CLI solo chain, untagged', () => {
    let project;
    let ledgerDir;
    let prevConfigDir;

    beforeEach(() => {
      project = fs.mkdtempSync(path.join(os.tmpdir(), 'f8-solo-untag-'));
      prevConfigDir = process.env.AMICUS_CONFIG_DIR;
      ledgerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f8-solo-untag-ledger-'));
      process.env.AMICUS_CONFIG_DIR = ledgerDir;
    });

    afterEach(() => {
      fs.rmSync(project, { recursive: true, force: true });
      if (prevConfigDir === undefined) { delete process.env.AMICUS_CONFIG_DIR; }
      else { process.env.AMICUS_CONFIG_DIR = prevConfigDir; }
    });

    test('metadata.json + run doc have NO tag key (absent, not null); spend row carries tag:null', async () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      try {
        const code = await handleStart(parseArgs([
          'start', '--model', 'vendorx/solo-model', '--prompt', 'untagged solo task',
          '--no-ui', '--json', '--no-cost-gate', '--cwd', project, '--task-id', 'solountagT9c',
        ]));
        expect(code).toBe(0);

        const metaPath = path.join(project, '.claude', 'amicus_sessions', 'solountagT9c', 'metadata.json');
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        expect('tag' in meta).toBe(false);

        const doc = JSON.parse(logSpy.mock.calls[0][0]);
        expect('tag' in doc).toBe(false);

        const spendRows = readSpendRows(ledgerDir);
        const spendRow = spendRows.find((r) => r.taskId === 'solountagT9c');
        expect(spendRow).toBeDefined();
        expect('tag' in spendRow).toBe(true);
        expect(spendRow.tag).toBeNull();
      } finally {
        logSpy.mockRestore();
      }
    });
  });

  describe('4b. CLI wave chain, untagged', () => {
    let project;
    let ledgerDir;
    let prevConfigDir;

    beforeEach(() => {
      project = fs.mkdtempSync(path.join(os.tmpdir(), 'f8-wave-untag-'));
      prevConfigDir = process.env.AMICUS_CONFIG_DIR;
      ledgerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f8-wave-untag-ledger-'));
      process.env.AMICUS_CONFIG_DIR = ledgerDir;
    });

    afterEach(() => {
      fs.rmSync(project, { recursive: true, force: true });
      if (prevConfigDir === undefined) { delete process.env.AMICUS_CONFIG_DIR; }
      else { process.env.AMICUS_CONFIG_DIR = prevConfigDir; }
    });

    test('wave metadata.json + wave.json have NO tag key; leg spend rows carry tag:null', async () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      try {
        const code = await handleFanout(parseArgs([
          'fanout', '--models', 'openrouter/a/b,openrouter/c/d', '--prompt', 'untagged wave task',
          '--json', '--no-cost-gate', '--no-validate-model', '--cwd', project,
          '--wave-id', 'wavuntagT9d',
        ]));
        expect(code).toBe(0);

        const waveDir = path.join(project, '.claude', 'amicus_sessions', 'wavuntagT9d');
        const meta = JSON.parse(fs.readFileSync(path.join(waveDir, 'metadata.json'), 'utf-8'));
        expect('tag' in meta).toBe(false);
        const waveDoc = JSON.parse(fs.readFileSync(path.join(waveDir, 'wave.json'), 'utf-8'));
        expect('tag' in waveDoc).toBe(false);

        const spendRows = readSpendRows(ledgerDir).filter((r) => r.waveId === 'wavuntagT9d');
        expect(spendRows).toHaveLength(2);
        for (const row of spendRows) {
          expect('tag' in row).toBe(true);
          expect(row.tag).toBeNull();
        }
      } finally {
        logSpy.mockRestore();
      }
    });
  });

  describe('4c. Council chain, untagged', () => {
    test('runCouncil: run.json and listCouncilRuns\' MCP row have NO tag key', async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'f8-council-untag-'));
      try {
        const launchers = scriptedLaunchers(happyScript());
        const { exitCode, run } = await runCouncil(
          baseOptions(tmp, { councilName: 'nightly-council' }),
          { launchers, appendRunFn: jest.fn(), statsFn: () => [], installSignalAbortFn: noSignals },
        );
        expect(exitCode).toBe(0);
        expect('tag' in run).toBe(false);
        const onDisk = runState.readRun(path.join(tmp, 'council-abc123'));
        expect('tag' in onDisk).toBe(false);

        const rows = listCouncilRuns(tmp);
        const row = rows.find((r) => r.id === 'abc123');
        expect(row).toBeDefined();
        expect('tag' in row).toBe(false);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });

    describe('real council-leg transport, untagged', () => {
      let project;
      let ledgerDir;
      let prevConfigDir;

      beforeEach(() => {
        project = fs.mkdtempSync(path.join(os.tmpdir(), 'f8-council-leg-untag-'));
        prevConfigDir = process.env.AMICUS_CONFIG_DIR;
        ledgerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f8-council-leg-untag-ledger-'));
        process.env.AMICUS_CONFIG_DIR = ledgerDir;
      });

      afterEach(() => {
        fs.rmSync(project, { recursive: true, force: true });
        if (prevConfigDir === undefined) { delete process.env.AMICUS_CONFIG_DIR; }
        else { process.env.AMICUS_CONFIG_DIR = prevConfigDir; }
      });

      test('the sub-wave\'s metadata.json has NO tag key; its leg spend row carries tag:null', async () => {
        const { launchSolo } = createLaunchers();
        await launchSolo({
          model: 'deepseek', prompt: 'chair packet', project,
          waveId: 'cuntagwave1', councilRunId: 'cuntagrun1', councilName: 'default',
        });

        const meta = JSON.parse(fs.readFileSync(
          path.join(project, '.claude', 'amicus_sessions', 'cuntagwave1', 'metadata.json'), 'utf-8'));
        expect('tag' in meta).toBe(false);

        const rows = readSpendRows(ledgerDir);
        expect(rows).toHaveLength(1);
        expect(rows[0].councilRunId).toBe('cuntagrun1');
        expect('tag' in rows[0]).toBe(true);
        expect(rows[0].tag).toBeNull();
      });
    });
  });

  describe('4d. (unattributed) grouping', () => {
    let project;
    let ledgerDir;
    let prevConfigDir;

    beforeEach(() => {
      project = fs.mkdtempSync(path.join(os.tmpdir(), 'f8-unattr-'));
      prevConfigDir = process.env.AMICUS_CONFIG_DIR;
      ledgerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f8-unattr-ledger-'));
      process.env.AMICUS_CONFIG_DIR = ledgerDir;
    });

    afterEach(() => {
      fs.rmSync(project, { recursive: true, force: true });
      if (prevConfigDir === undefined) { delete process.env.AMICUS_CONFIG_DIR; }
      else { process.env.AMICUS_CONFIG_DIR = prevConfigDir; }
    });

    test('untagged solo + untagged wave-leg spend rows all land in ONE "(unattributed)" --group-by tag bucket', async () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      try {
        const soloCode = await handleStart(parseArgs([
          'start', '--model', 'vendorx/solo-model', '--prompt', 'unattributed solo',
          '--no-ui', '--json', '--no-cost-gate', '--cwd', project, '--task-id', 'unattrsoloA',
        ]));
        expect(soloCode).toBe(0);

        const waveCode = await handleFanout(parseArgs([
          'fanout', '--models', 'openrouter/a/b,openrouter/c/d', '--prompt', 'unattributed wave',
          '--json', '--no-cost-gate', '--no-validate-model', '--cwd', project,
          '--wave-id', 'unattrwaveB',
        ]));
        expect(waveCode).toBe(0);

        const spendDoc = await captureSpendJson({ 'group-by': 'tag' }, ledgerDir);
        expect(spendDoc.total.runs).toBe(3); // 1 solo + 2 legs
        const groups = spendDoc.groups;
        expect(groups).toHaveLength(1);
        expect(groups[0]).toMatchObject({ key: '(unattributed)', runs: 3 });
      } finally {
        logSpy.mockRestore();
      }
    });
  });
});
