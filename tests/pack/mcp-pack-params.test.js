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
const { handleCouncilRunTool } = require('../../src/mcp-council-run');
const { getTools } = require('../../src/mcp-tools');
const { readRun } = require('../../src/council/run-state');

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
