// tests/pack/mcp-pack-params.test.js
'use strict';

/**
 * v4.5 Task 15 (B7/F5): `pack?` param on the three MCP run tools
 * (amicus_council_run / amicus_fanout / amicus_start).
 *
 * Council is covered behaviorally (argv-capture style, modeled on
 * tests/mcp-council-run-inputs.test.js): a real in-process call against real
 * pack-store/pack-resolve, with only spawnFn injected/captured.
 *
 * fanout/start are covered via source-text assertions (the
 * tests/mcp-fanout.test.js idiom) — spawnSidecarProcess and the shared-server
 * path are not seamed for a full behavioral call from this file, and the
 * brief's own test contract specifies source-text assertions for these two.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { z } = require('zod');
const { handleCouncilRunTool } = require('../../src/mcp-council-run');
const { getTools } = require('../../src/mcp-tools');
const { readRun } = require('../../src/council/run-state');
const { applyPackToMcpInput } = require('../../src/pack/pack-resolve');
const { ERROR_CODES } = require('../../src/utils/error-doc');

const store = () => require('../../src/pack/pack-store');

let tmp; let briefingFile;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-pack-params-'));
  process.env.AMICUS_CONFIG_DIR = tmp;
  fs.writeFileSync(path.join(tmp, 'config.json'), JSON.stringify({ aliases: {} }));
  briefingFile = path.join(tmp, 'briefing.md');
  fs.writeFileSync(briefingFile, 'Review this.');
});
afterEach(() => {
  delete process.env.AMICUS_CONFIG_DIR;
  fs.rmSync(tmp, { recursive: true, force: true });
});

// spawnFn is injected by mcp-server; capture the argv instead of spawning.
const helpers = (spawnCalls) => ({
  spawnFn: (args, dir) => { spawnCalls.push({ args, dir }); return { pid: 4242 }; },
  clientName: 'claude-code',
});

// ---- fixtures (slash-ful model ids so seatOk() passes with no alias config) ----
const COUNCIL_PACK = () => ({
  schemaVersion: 1, type: 'pack', name: 'sec-review', version: '1.0.0', kind: 'council',
  description: 'x', bench: ['vendorx/model-a', 'vendorx/model-b'], chair: 'vendorx/pack-chair',
  critic: null, lenses: null, options: {}, briefing: {},
});
const FANOUT_KIND_PACK = () => ({
  schemaVersion: 1, type: 'pack', name: 'wrong-kind-for-council', version: '1.0.0', kind: 'fanout',
  description: 'x', bench: ['vendorx/model-a', 'vendorx/model-b'], options: {}, briefing: {},
});

// ---- fix wave 2 (Task 15 review, Findings 1-3) fixtures ----
// Test-local mirrors of mcp-server.js's FANOUT_PACK_PARAM_MAP / SOLO_PACK_PARAM_MAP
// and mcp-council-run.js's COUNCIL_PACK_PARAM_MAP. Neither module exports its map —
// these are plain MCP-key -> CLI-arg-key rename tables (not knob logic), so a
// same-shaped local copy exercises applyPackToMcpInput directly without reaching
// into another module's internals.
const TEST_FANOUT_PARAM_MAP = {
  models: 'models', council: 'council', gateway: 'gateway', agent: 'agent', thinking: 'thinking',
  timeout: 'timeout', summaryLength: 'summary-length',
  includeContext: { argKey: 'no-context', invert: true },
};
const TEST_SOLO_PARAM_MAP = {
  model: 'model', gateway: 'gateway', agent: 'agent', noUi: 'no-ui', thinking: 'thinking',
  timeout: 'timeout', contextTurns: 'context-turns', contextMaxTokens: 'context-max-tokens',
  summaryLength: 'summary-length',
  includeContext: { argKey: 'no-context', invert: true },
};
const TEST_COUNCIL_PARAM_MAP = {
  models: 'models', council: 'council', chair: 'chair', critic: 'critic', lenses: 'lenses',
  debate: 'debate', timeoutMinutes: 'timeout', maxCost: 'max-cost', gateway: 'gateway',
};

const FANOUT_TEST_PACK = () => ({
  schemaVersion: 1, type: 'pack', name: 'fanout-direct-pack', version: '1.0.0', kind: 'fanout',
  description: 'x', bench: ['vendorx/model-a', 'vendorx/model-b'],
  options: { noContext: true, maxCost: 5, gateway: 'openrouter' }, briefing: {},
});
const SOLO_TEST_PACK = () => ({
  schemaVersion: 1, type: 'pack', name: 'solo-direct-pack', version: '1.0.0', kind: 'solo',
  description: 'x', model: 'vendorx/solo-model',
  options: { noUi: true, agent: 'Plan' }, briefing: {},
});
const COUNCIL_ORPHAN_PACK = () => ({
  schemaVersion: 1, type: 'pack', name: 'council-orphan-pack', version: '1.0.0', kind: 'council',
  description: 'x', bench: ['vendorx/model-a', 'vendorx/model-b'], chair: 'vendorx/pack-chair',
  critic: null, lenses: ['lensA', 'lensB'], options: { agent: 'Plan' }, briefing: {},
});

describe('amicus_council_run pack param', () => {
  test('pack input with no models spawns the expanded bench + pre-seeds run.json with the pack object', async () => {
    store().writePack(COUNCIL_PACK());
    const calls = [];
    const res = await handleCouncilRunTool(
      { briefingFile, pack: 'sec-review', outDir: 'run1' }, tmp, helpers(calls));
    expect(res.isError).toBeUndefined();
    expect(calls).toHaveLength(1);
    const args = calls[0].args;
    expect(args[args.indexOf('--models') + 1]).toBe('vendorx/model-a,vendorx/model-b');
    expect(args[args.indexOf('--chair') + 1]).toBe('vendorx/pack-chair');
    expect(args).not.toContain('--pack'); // single-resolution rule: never spawn --pack

    const run = readRun(path.join(tmp, 'run1'));
    expect(run.pack).toEqual({
      name: 'sec-review', version: '1.0.0', hash: expect.stringMatching(/^[0-9a-f]{12}$/), source: 'dir',
    });
  });

  test('explicit chair param beats pack chair', async () => {
    store().writePack(COUNCIL_PACK());
    const calls = [];
    const res = await handleCouncilRunTool(
      { briefingFile, pack: 'sec-review', chair: 'vendorx/explicit-chair' }, tmp, helpers(calls));
    expect(res.isError).toBeUndefined();
    expect(calls).toHaveLength(1);
    const args = calls[0].args;
    expect(args[args.indexOf('--chair') + 1]).toBe('vendorx/explicit-chair');
  });

  test('kind mismatch returns isError text naming both kinds', async () => {
    store().writePack(FANOUT_KIND_PACK());
    const calls = [];
    const res = await handleCouncilRunTool(
      { briefingFile, pack: 'wrong-kind-for-council' }, tmp, helpers(calls));
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('fanout');
    expect(res.content[0].text).toContain('council');
    expect(calls).toHaveLength(0);
  });

  test('a bench-override notice (explicit models + pack bench) surfaces as extra response content', async () => {
    store().writePack(COUNCIL_PACK());
    const calls = [];
    const res = await handleCouncilRunTool(
      { briefingFile, pack: 'sec-review', models: ['vendorx/other-a', 'vendorx/other-b'] }, tmp, helpers(calls));
    expect(res.isError).toBeUndefined();
    const noticeBlock = res.content.find((c) => /Notice:/.test(c.text));
    expect(noticeBlock).toBeDefined();
    expect(noticeBlock.text).toContain('overrides the bench');
    // explicit --models wins: the spawned argv uses the EXPLICIT models, not the pack's.
    const args = calls[0].args;
    expect(args[args.indexOf('--models') + 1]).toBe('vendorx/other-a,vendorx/other-b');
  });
});

describe('pack-error hint parity over MCP (T15-m1, final-review)', () => {
  // Before the fix, council/fanout's pack-error branch forwarded only
  // pr.error.message, dropping pr.error.hint — amicus_start's own pack-error
  // branch (mcp-server.js:289-291) keeps it via buildErrorDoc. A mistyped
  // pack name is PACK_NOT_FOUND, which DOES carry a hint ('amicus pack
  // list') — the scenario that exposes the drop. Both handlers return this
  // error BEFORE ever spawning a child (pack resolution runs first), so a
  // real behavioral call is safe here — no spawn to mock.
  test('amicus_council_run: a mistyped pack name response contains the recovery hint', async () => {
    const calls = [];
    const res = await handleCouncilRunTool(
      { briefingFile, pack: 'totally-not-a-real-pack' }, tmp, helpers(calls));
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('not found');
    expect(res.content[0].text).toContain('amicus pack list');
    expect(calls).toHaveLength(0);
  });

  test('amicus_fanout: a mistyped pack name response contains the recovery hint', async () => {
    const { handlers } = require('../../src/mcp-server');
    const res = await handlers.amicus_fanout({ pack: 'totally-not-a-real-pack' }, tmp);
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('not found');
    expect(res.content[0].text).toContain('amicus pack list');
  });
});

describe('the pack param is declared on all three run-tool schemas; tool count stays 16', () => {
  test('getTools()', () => {
    const tools = getTools();
    expect(tools).toHaveLength(16);
    for (const name of ['amicus_council_run', 'amicus_fanout', 'amicus_start']) {
      const tool = tools.find((t) => t.name === name);
      expect(tool).toBeDefined();
      expect(Object.keys(tool.inputSchema)).toEqual(expect.arrayContaining(['pack']));
    }
  });
});

describe('amicus_fanout / amicus_start pack wiring (source-text assertions, tests/mcp-fanout.test.js idiom)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/mcp-server.js'), 'utf-8');

  test('amicus_fanout resolves the pack in-process, before spawning, and never forwards --pack', () => {
    const start = src.indexOf('async amicus_fanout(');
    const end = src.indexOf('async amicus_council_tally(', start);
    const handler = src.slice(start, end);
    expect(handler).toContain('applyPackToMcpInput');
    expect(handler).toContain('input.pack');
    expect(handler).toContain('packRecord');
    expect(handler).not.toContain("'--pack'");
    // pack resolution must precede the spawn call in source order.
    expect(handler.indexOf('applyPackToMcpInput')).toBeLessThan(handler.indexOf('spawnSidecarProcess'));
  });

  test('amicus_fanout records the pack on the wave metadata pre-spawn write', () => {
    const start = src.indexOf('async amicus_fanout(');
    const end = src.indexOf('async amicus_council_tally(', start);
    const handler = src.slice(start, end);
    const metaWrite = handler.slice(handler.indexOf("'metadata.json'"));
    expect(metaWrite.slice(0, 400)).toContain('packRecord');
  });

  test('amicus_start resolves the pack in-process and never forwards --pack', () => {
    const start = src.indexOf('async amicus_start(');
    const end = src.indexOf('async amicus_status(', start);
    const handler = src.slice(start, end);
    expect(handler).toContain('applyPackToMcpInput');
    expect(handler).toContain('input.pack');
    expect(handler).toContain('packRecord');
    expect(handler).not.toContain("'--pack'");
  });

  test('amicus_start records the pack on the shared-server solo metadata write', () => {
    const start = src.indexOf('async amicus_start(');
    const end = src.indexOf('async amicus_status(', start);
    const handler = src.slice(start, end);
    const metaWrite = handler.slice(handler.indexOf('opencodeSessionId: sessionId'));
    expect(metaWrite.slice(0, 700)).toContain('packRecord');
  });

  test('amicus_start records the pack on the spawn-fallback pre-seed metadata write', () => {
    const start = src.indexOf('async amicus_start(');
    const end = src.indexOf('async amicus_status(', start);
    const handler = src.slice(start, end);
    // Locate the spawn-fallback pre-seed write by searching from the spawn invocation onward
    const spawnIdx = handler.indexOf('spawnSidecarProcess');
    const preSpawnSection = handler.slice(spawnIdx);
    const metaWrite = preSpawnSection.slice(preSpawnSection.indexOf("'metadata.json'"));
    expect(metaWrite.slice(0, 600)).toContain('packRecord');
  });

  test('the MCP bridge is imported from pack/pack-resolve, never re-deriving the knob tables', () => {
    expect(src).toContain("require('./pack/pack-resolve')");
  });
});

// ---------------------------------------------------------------------------
// Fix wave 2 (Task 15 review, Findings 1-3).
// ---------------------------------------------------------------------------

describe('Zod schema no longer defaults noUi/agent/includeContext (Finding 1 regression)', () => {
  // Parses through the REAL tool schema (z.object(inputSchema).parse), the same
  // shape the MCP SDK builds from getTools()'s inputSchema — a schema-level
  // regression lock, since a unit test that hand-builds its own input object
  // (bypassing Zod) would not notice if `.default(...)` were ever reintroduced.
  test('amicus_start: omitting noUi/agent/includeContext leaves all three genuinely absent after parsing', () => {
    const startTool = getTools().find((t) => t.name === 'amicus_start');
    const parsed = z.object(startTool.inputSchema).parse({ prompt: 'hi' });
    expect('noUi' in parsed).toBe(false);
    expect('agent' in parsed).toBe(false);
    expect('includeContext' in parsed).toBe(false);
  });

  test('amicus_fanout: omitting includeContext leaves it genuinely absent after parsing', () => {
    const fanoutTool = getTools().find((t) => t.name === 'amicus_fanout');
    const parsed = z.object(fanoutTool.inputSchema).parse({ prompt: 'hi' });
    expect('includeContext' in parsed).toBe(false);
  });
});

describe('applyPackToMcpInput (direct unit tests)', () => {
  test('includeContext invert: pack noContext:true fills includeContext:false when absent', () => {
    store().writePack(FANOUT_TEST_PACK());
    const input = {};
    const res = applyPackToMcpInput({
      packRef: 'fanout-direct-pack', expectedKind: 'fanout', input, paramMap: TEST_FANOUT_PARAM_MAP,
    });
    expect(res.error).toBeUndefined();
    expect(input.includeContext).toBe(false);
  });

  test('includeContext invert: caller-explicit includeContext:false is never overwritten by the pack', () => {
    store().writePack(FANOUT_TEST_PACK()); // pack also sets options.noContext: true
    const input = { includeContext: false };
    const res = applyPackToMcpInput({
      packRef: 'fanout-direct-pack', expectedKind: 'fanout', input, paramMap: TEST_FANOUT_PARAM_MAP,
    });
    expect(res.error).toBeUndefined();
    expect(input.includeContext).toBe(false);
  });

  test('models array -> CSV -> array round trip when the pack fills an absent models key', () => {
    store().writePack(FANOUT_TEST_PACK()); // bench: ['vendorx/model-a', 'vendorx/model-b']
    const input = {};
    const res = applyPackToMcpInput({
      packRef: 'fanout-direct-pack', expectedKind: 'fanout', input, paramMap: TEST_FANOUT_PARAM_MAP,
    });
    expect(res.error).toBeUndefined();
    expect(input.models).toEqual(['vendorx/model-a', 'vendorx/model-b']);
  });

  test('lenses array -> CSV -> array round trip when the pack fills an absent lenses key', () => {
    store().writePack(COUNCIL_ORPHAN_PACK()); // lenses: ['lensA', 'lensB']
    const input = {};
    const res = applyPackToMcpInput({
      packRef: 'council-orphan-pack', expectedKind: 'council', input, paramMap: TEST_COUNCIL_PARAM_MAP,
    });
    expect(res.error).toBeUndefined();
    expect(input.lenses).toEqual(['lensA', 'lensB']);
  });

  test('explicit wins: a caller-provided models array is never touched by the pack bench', () => {
    store().writePack(FANOUT_TEST_PACK()); // pack.bench differs from the caller's models
    const input = { models: ['explicit/a', 'explicit/b'] };
    const res = applyPackToMcpInput({
      packRef: 'fanout-direct-pack', expectedKind: 'fanout', input, paramMap: TEST_FANOUT_PARAM_MAP,
    });
    expect(res.error).toBeUndefined();
    expect(input.models).toEqual(['explicit/a', 'explicit/b']);
  });

  test('explicit wins: a caller-provided gateway is never overwritten by the pack', () => {
    store().writePack(FANOUT_TEST_PACK()); // pack sets options.gateway: 'openrouter'
    const input = { gateway: 'direct' };
    const res = applyPackToMcpInput({
      packRef: 'fanout-direct-pack', expectedKind: 'fanout', input, paramMap: TEST_FANOUT_PARAM_MAP,
    });
    expect(res.error).toBeUndefined();
    expect(input.gateway).toBe('direct');
  });

  test("absent-key fill: noUi/agent fill from the pack when genuinely absent (locks Finding 1's fix)", () => {
    store().writePack(SOLO_TEST_PACK()); // options: { noUi: true, agent: 'Plan' }
    const input = {}; // no noUi/agent key at all — the post-fix Zod-parsed shape
    const res = applyPackToMcpInput({
      packRef: 'solo-direct-pack', expectedKind: 'solo', input, paramMap: TEST_SOLO_PARAM_MAP,
    });
    expect(res.error).toBeUndefined();
    expect(input.noUi).toBe(true);
    expect(input.agent).toBe('Plan');
  });

  test("orphan-knob notice: a fanout pack's maxCost has no MCP destination and is reported, not silently dropped", () => {
    store().writePack(FANOUT_TEST_PACK()); // options.maxCost: 5
    const input = {};
    const res = applyPackToMcpInput({
      packRef: 'fanout-direct-pack', expectedKind: 'fanout', input, paramMap: TEST_FANOUT_PARAM_MAP,
    });
    expect(res.error).toBeUndefined();
    const notice = res.notices.find((n) => n.includes('max-cost'));
    expect(notice).toBeDefined();
    expect(notice).toContain("pack 'fanout-direct-pack'");
    expect(notice).toContain('amicus_fanout');
    expect(notice).toContain('does not support over MCP');
    expect(input.maxCost).toBeUndefined(); // never forwarded — the human decides
  });

  test("orphan-knob notice: a council pack's agent has no MCP destination and is reported", () => {
    store().writePack(COUNCIL_ORPHAN_PACK()); // options.agent: 'Plan'
    const input = {};
    const res = applyPackToMcpInput({
      packRef: 'council-orphan-pack', expectedKind: 'council', input, paramMap: TEST_COUNCIL_PARAM_MAP,
    });
    expect(res.error).toBeUndefined();
    const notice = res.notices.find((n) => n.includes('agent'));
    expect(notice).toBeDefined();
    expect(notice).toContain('amicus_council_run');
  });

  test('kind mismatch returns a structured PACK_KIND_MISMATCH error naming both kinds', () => {
    store().writePack(FANOUT_KIND_PACK()); // kind: 'fanout', name: 'wrong-kind-for-council'
    const input = {};
    const res = applyPackToMcpInput({
      packRef: 'wrong-kind-for-council', expectedKind: 'council', input, paramMap: TEST_COUNCIL_PARAM_MAP,
    });
    expect(res.error).toBeDefined();
    expect(res.error.code).toBe(ERROR_CODES.PACK_KIND_MISMATCH);
    expect(res.error.message).toContain('fanout');
    expect(res.error.message).toContain('council');
  });
});
