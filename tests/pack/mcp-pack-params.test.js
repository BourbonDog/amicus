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

// Production maps imported directly (T15-m5): the previous hand-copied mirrors
// diverged once (the council copy silently dropped `template`) — importing the
// real tables makes that class of drift impossible.
const { COUNCIL_PACK_PARAM_MAP } = require('../../src/mcp-council-run');
const { FANOUT_PACK_PARAM_MAP, SOLO_PACK_PARAM_MAP } = require('../../src/mcp-server');
// W1-M6/M7: same T15-m5 rule — KIND_OPTIONS is the table the guard below
// walks, imported live so the guard tracks it instead of pinning a copy.
const { KIND_OPTIONS } = require('../../src/pack/pack-validate');

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
// v4.5 HOLD-gate decision 2: agent is no longer a valid council pack option, so
// this fixture (used only for the lenses round-trip below) no longer sets it —
// renamed from COUNCIL_ORPHAN_PACK since it is no longer an orphan-knob vehicle.
const COUNCIL_LENSES_PACK = () => ({
  schemaVersion: 1, type: 'pack', name: 'council-lenses-pack', version: '1.0.0', kind: 'council',
  description: 'x', bench: ['vendorx/model-a', 'vendorx/model-b'], chair: 'vendorx/pack-chair',
  critic: null, lenses: ['lensA', 'lensB'], options: {}, briefing: {},
});
// v4.5 HOLD-gate decision 2: a council pack that still carries a dropped option
// (agent/thinking/summaryLength) now fails validation outright — it can no
// longer reach the orphan-notice code path at all.
const COUNCIL_DROPPED_OPTION_PACK = () => ({
  schemaVersion: 1, type: 'pack', name: 'council-dropped-option-pack', version: '1.0.0', kind: 'council',
  description: 'x', bench: ['vendorx/model-a', 'vendorx/model-b'], chair: 'vendorx/pack-chair',
  critic: null, lenses: null, options: { agent: 'Plan' }, briefing: {},
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
    // Window widened 700->950 (v4.5 HOLD-gate decision 1): the renderedPrompt
    // doc comment above `briefing:` pushed packRecord further into the slice
    // (T15-m4 already flags this fixed-offset idiom as brittle; not
    // re-litigated here, just re-measured).
    expect(metaWrite.slice(0, 950)).toContain('packRecord');
  });

  test('amicus_start records the pack on the spawn-fallback pre-seed metadata write', () => {
    const start = src.indexOf('async amicus_start(');
    const end = src.indexOf('async amicus_status(', start);
    const handler = src.slice(start, end);
    // Locate the spawn-fallback pre-seed write by searching from the spawn invocation onward
    const spawnIdx = handler.indexOf('spawnSidecarProcess');
    const preSpawnSection = handler.slice(spawnIdx);
    const metaWrite = preSpawnSection.slice(preSpawnSection.indexOf("'metadata.json'"));
    // The window is a PROXIMITY bound — "in this write, not some later one" —
    // not a budget for the write's prose. Widened from 600 in v4.9 W12, which
    // added W1-M4's note to the same object literal and left `packRecord` at
    // 725 characters; the object itself did not grow.
    expect(metaWrite.slice(0, 900)).toContain('packRecord');
  });

  test('the MCP bridge is imported from pack/pack-resolve, never re-deriving the knob tables', () => {
    expect(src).toContain("require('./pack/pack-resolve')");
  });

  // ---- v4.5 HOLD-gate decision 1: pack-forwarded maxCost/template (source-text) ----

  test('amicus_fanout conditionally forwards pack.forward.maxCost/.template as CLI flags, never unconditionally, never --pack', () => {
    const start = src.indexOf('async amicus_fanout(');
    const end = src.indexOf('async amicus_council_tally(', start);
    const handler = src.slice(start, end);
    expect(handler).toMatch(/if\s*\(\s*packForward\.maxCost\s*!==\s*undefined\s*\)/);
    expect(handler).toMatch(/if\s*\(\s*packForward\.template\s*!==\s*undefined\s*\)/);
    expect(handler).toContain("'--max-cost'");
    expect(handler).toContain("'--template'");
    expect(handler).not.toContain("'--pack'");
    // pack resolution (and its forward capture) must precede the spawn call.
    expect(handler.indexOf('applyPackToMcpInput')).toBeLessThan(handler.indexOf('spawnSidecarProcess'));
  });

  test('amicus_start\'s spawn-fallback path conditionally forwards pack.forward.maxCost/.template as CLI flags', () => {
    const start = src.indexOf('async amicus_start(');
    const end = src.indexOf('async amicus_status(', start);
    const handler = src.slice(start, end);
    // Scope to the spawn-fallback half (after the shared-server branch closes).
    const spawnIdx = handler.indexOf('spawnSidecarProcess');
    const fallbackSection = handler.slice(0, spawnIdx);
    expect(fallbackSection).toMatch(/if\s*\(\s*packForward\.maxCost\s*!==\s*undefined\s*\)/);
    expect(fallbackSection).toMatch(/if\s*\(\s*packForward\.template\s*!==\s*undefined\s*\)/);
    expect(fallbackSection).toContain("'--max-cost'");
    expect(fallbackSection).toContain("'--template'");
  });

  // v4.5 Wave-1 REVIEW FIX (I1/I2): superseded the single test that used to
  // live here ("...in-process shared-server path applies packForward.template
  // (render) and packForward.maxCost (budget gate) BEFORE createSession").
  // That test pinned the OLD (buggy) shape — a SECOND, un-validated
  // applyTemplate call inline in this branch. The fix moves validation/dry-run
  // of BOTH knobs into ONE upfront `prepareForward` call shared by both of
  // this handler's downstream paths (see src/pack/pack-forward.js); the two
  // tests below assert the new, stronger shape directly instead of freezing
  // the obsoleted one (same precedent as this branch's own Wave-1 report:
  // "tests/mcp-start-metadata.test.js's ... asserted the literal briefing:
  // input.prompt — broke once briefing became renderedPrompt — fixed to
  // assert the new literal").
  test('mcp-server.js defines a shared checkPackForward helper that delegates to pack-forward.js\'s prepareForward', () => {
    const fnStart = src.indexOf('function checkPackForward(');
    expect(fnStart).toBeGreaterThan(-1);
    const fnEnd = src.indexOf('\n}\n', fnStart);
    const fn = src.slice(fnStart, fnEnd);
    expect(fn).toContain("require('./pack/pack-forward')");
    expect(fn).toContain('prepareForward');
    // Defined once, outside (before) both handlers — never re-derived per call site.
    expect(fnStart).toBeLessThan(src.indexOf('async amicus_start('));
  });

  test('amicus_start validates/dry-runs a pack-forwarded maxCost/template via checkPackForward ONCE, before EITHER downstream path (the shared-server branch or the spawn-fallback)', () => {
    const start = src.indexOf('async amicus_start(');
    const end = src.indexOf('async amicus_status(', start);
    const handler = src.slice(start, end);
    const prepareIdx = handler.indexOf('checkPackForward(');
    expect(prepareIdx).toBeGreaterThan(-1);
    expect(prepareIdx).toBeLessThan(handler.indexOf('sharedServer.enabled && input.noUi'));
    expect(prepareIdx).toBeLessThan(handler.indexOf('spawnSidecarProcess'));
  });

  test('amicus_fanout validates/dry-runs a pack-forwarded maxCost/template via checkPackForward before any wave dir / metadata write', () => {
    const start = src.indexOf('async amicus_fanout(');
    const end = src.indexOf('async amicus_council_tally(', start);
    const handler = src.slice(start, end);
    const prepareIdx = handler.indexOf('checkPackForward(');
    expect(prepareIdx).toBeGreaterThan(-1);
    expect(prepareIdx).toBeLessThan(handler.indexOf("'metadata.json'"));
    expect(prepareIdx).toBeLessThan(handler.indexOf('spawnSidecarProcess'));
  });

  test('amicus_start\'s in-process shared-server path reuses the pre-validated fwd.renderedPrompt/fwd.maxCost (no second template render) BEFORE createSession — parity with the spawn-fallback path', () => {
    const start = src.indexOf('async amicus_start(');
    const end = src.indexOf('async amicus_status(', start);
    const handler = src.slice(start, end);
    const sharedIdx = handler.indexOf('sharedServer.enabled && input.noUi');
    expect(sharedIdx).toBeGreaterThan(-1);
    const createSessionIdx = handler.indexOf('await createSession(', sharedIdx);
    expect(createSessionIdx).toBeGreaterThan(sharedIdx);
    const preSpend = handler.slice(sharedIdx, createSessionIdx);
    // The ceiling GATE itself (needs resolvedModel/pricing, unavailable to the
    // pack-domain pack-forward.js module) still runs here, fed the
    // already-validated fwd.maxCost; the template is NOT rendered a second
    // time (that already happened once, in the shared prepareForward call
    // above, before sharedIdx).
    expect(preSpend).toContain('checkBudget');
    expect(preSpend).toMatch(/fwd\.maxCost/);
    expect(preSpend).not.toContain("require('./template/apply')");
    // `fwd.renderedPrompt` used to be re-derived INSIDE this window. v4.9 W12
    // (W1-M4) hoisted that one expression above the branch so the spawn
    // fallback shares it — the reuse property this test exists for, in a
    // stronger form: there is now exactly ONE "rendered, else raw" in the
    // handler, it is derived before either path, and this path CONSUMES it.
    const derivation = /const renderedPrompt = fwd\.renderedPrompt !== undefined/;
    expect(handler.slice(0, sharedIdx)).toMatch(derivation);
    expect(preSpend).not.toMatch(derivation);
    expect(preSpend).toMatch(/\brenderedPrompt\b/);
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
      packRef: 'fanout-direct-pack', expectedKind: 'fanout', input, paramMap: FANOUT_PACK_PARAM_MAP,
    });
    expect(res.error).toBeUndefined();
    expect(input.includeContext).toBe(false);
  });

  test('includeContext invert: caller-explicit includeContext:false is never overwritten by the pack', () => {
    store().writePack(FANOUT_TEST_PACK()); // pack also sets options.noContext: true
    const input = { includeContext: false };
    const res = applyPackToMcpInput({
      packRef: 'fanout-direct-pack', expectedKind: 'fanout', input, paramMap: FANOUT_PACK_PARAM_MAP,
    });
    expect(res.error).toBeUndefined();
    expect(input.includeContext).toBe(false);
  });

  test('models array -> CSV -> array round trip when the pack fills an absent models key', () => {
    store().writePack(FANOUT_TEST_PACK()); // bench: ['vendorx/model-a', 'vendorx/model-b']
    const input = {};
    const res = applyPackToMcpInput({
      packRef: 'fanout-direct-pack', expectedKind: 'fanout', input, paramMap: FANOUT_PACK_PARAM_MAP,
    });
    expect(res.error).toBeUndefined();
    expect(input.models).toEqual(['vendorx/model-a', 'vendorx/model-b']);
  });

  test('lenses array -> CSV -> array round trip when the pack fills an absent lenses key', () => {
    store().writePack(COUNCIL_LENSES_PACK()); // lenses: ['lensA', 'lensB']
    const input = {};
    const res = applyPackToMcpInput({
      packRef: 'council-lenses-pack', expectedKind: 'council', input, paramMap: COUNCIL_PACK_PARAM_MAP,
    });
    expect(res.error).toBeUndefined();
    expect(input.lenses).toEqual(['lensA', 'lensB']);
  });

  test('explicit wins: a caller-provided models array is never touched by the pack bench', () => {
    store().writePack(FANOUT_TEST_PACK()); // pack.bench differs from the caller's models
    const input = { models: ['explicit/a', 'explicit/b'] };
    const res = applyPackToMcpInput({
      packRef: 'fanout-direct-pack', expectedKind: 'fanout', input, paramMap: FANOUT_PACK_PARAM_MAP,
    });
    expect(res.error).toBeUndefined();
    expect(input.models).toEqual(['explicit/a', 'explicit/b']);
  });

  test('explicit wins: a caller-provided gateway is never overwritten by the pack', () => {
    store().writePack(FANOUT_TEST_PACK()); // pack sets options.gateway: 'openrouter'
    const input = { gateway: 'direct' };
    const res = applyPackToMcpInput({
      packRef: 'fanout-direct-pack', expectedKind: 'fanout', input, paramMap: FANOUT_PACK_PARAM_MAP,
    });
    expect(res.error).toBeUndefined();
    expect(input.gateway).toBe('direct');
  });

  test("absent-key fill: noUi/agent fill from the pack when genuinely absent (locks Finding 1's fix)", () => {
    store().writePack(SOLO_TEST_PACK()); // options: { noUi: true, agent: 'Plan' }
    const input = {}; // no noUi/agent key at all — the post-fix Zod-parsed shape
    const res = applyPackToMcpInput({
      packRef: 'solo-direct-pack', expectedKind: 'solo', input, paramMap: SOLO_PACK_PARAM_MAP,
    });
    expect(res.error).toBeUndefined();
    expect(input.noUi).toBe(true);
    expect(input.agent).toBe('Plan');
  });

  // ---- v4.5 HOLD-gate decision 1: maxCost/template forward instead of orphan-notice ----
  test("forward (decision 1): a fanout pack's maxCost has no MCP schema param but is forwarded via res.forward, never silently dropped and never an ignore-notice", () => {
    store().writePack(FANOUT_TEST_PACK()); // options.maxCost: 5
    const input = {};
    const res = applyPackToMcpInput({
      packRef: 'fanout-direct-pack', expectedKind: 'fanout', input, paramMap: FANOUT_PACK_PARAM_MAP,
    });
    expect(res.error).toBeUndefined();
    expect(res.forward).toEqual(expect.objectContaining({ maxCost: 5 }));
    expect(input.maxCost).toBeUndefined(); // still no MCP schema destination — never written onto input
    expect(res.notices.find((n) => /max-?[Cc]ost/.test(n))).toBeUndefined(); // applied, not ignored
  });

  test('forward (decision 1): a fanout pack with no maxCost/template forwards nothing', () => {
    store().writePack({ ...FANOUT_TEST_PACK(), options: { noContext: true, gateway: 'openrouter' } });
    const input = {};
    const res = applyPackToMcpInput({
      packRef: 'fanout-direct-pack', expectedKind: 'fanout', input, paramMap: FANOUT_PACK_PARAM_MAP,
    });
    expect(res.error).toBeUndefined();
    expect(res.forward).toEqual({});
  });

  test('forward (decision 1): a solo pack briefing.template has no MCP schema param but is forwarded via res.forward', () => {
    store().writePack({ ...SOLO_TEST_PACK(), briefing: { template: 'review' } });
    const input = {};
    const res = applyPackToMcpInput({
      packRef: 'solo-direct-pack', expectedKind: 'solo', input, paramMap: SOLO_PACK_PARAM_MAP,
    });
    expect(res.error).toBeUndefined();
    expect(res.forward.template).toBe('review');
    expect(input.template).toBeUndefined();
    expect(res.notices.find((n) => n.includes('template'))).toBeUndefined();
  });

  test('forward (decision 1): council already has real paramMap destinations for maxCost/template — forward stays empty', () => {
    store().writePack(COUNCIL_PACK()); // no maxCost/template set in this fixture's options, but destinations exist either way
    const input = { maxCost: 3, template: 'review' };
    const res = applyPackToMcpInput({
      packRef: 'sec-review', expectedKind: 'council', input, paramMap: COUNCIL_PACK_PARAM_MAP,
    });
    expect(res.error).toBeUndefined();
    expect(res.forward).toEqual({});
  });

  // T15-m5: mirror of the solo test above — a council pack's briefing.template
  // (no explicit input.template) must round-trip onto input.template via
  // COUNCIL_PACK_PARAM_MAP's real `template` destination, never fall through to
  // res.forward. This is the regression lock for the divergence that motivated
  // importing the production map: the old hand-copied TEST_COUNCIL_PARAM_MAP
  // silently omitted `template`, which would (if reintroduced) misroute the
  // pack's template into `forward` instead of `input.template` — and
  // handleCouncilRunTool (mcp-council-run.js) only ever reads input.template
  // to render the briefing, never res.forward, so the template would silently
  // never apply.
  test('template round trip (T15-m5): a council pack briefing.template with no explicit input.template lands on input.template via the real paramMap destination, never on res.forward', () => {
    store().writePack({ ...COUNCIL_PACK(), briefing: { template: 'review' } });
    const input = {};
    const res = applyPackToMcpInput({
      packRef: 'sec-review', expectedKind: 'council', input, paramMap: COUNCIL_PACK_PARAM_MAP,
    });
    expect(res.error).toBeUndefined();
    expect(input.template).toBe('review');
    expect(res.forward.template).toBeUndefined();
  });

  // ---- v4.5 HOLD-gate decision 1b (T15-m10): remaining orphan notices name the pack's own camelCase option key ----
  test('notice wording (decision 1b): a fanout pack\'s contextTurns/contextMaxTokens stay notice-only, named by their camelCase pack option key', () => {
    store().writePack({
      ...FANOUT_TEST_PACK(),
      options: { contextTurns: 20, contextMaxTokens: 5000 },
    });
    const input = {};
    const res = applyPackToMcpInput({
      packRef: 'fanout-direct-pack', expectedKind: 'fanout', input, paramMap: FANOUT_PACK_PARAM_MAP,
    });
    expect(res.error).toBeUndefined();
    const turnsNotice = res.notices.find((n) => n.includes('contextTurns'));
    const tokensNotice = res.notices.find((n) => n.includes('contextMaxTokens'));
    expect(turnsNotice).toBeDefined();
    expect(tokensNotice).toBeDefined();
    // Never the CLI kebab-case arg-key form — that's the exact bug being fixed.
    expect(res.notices.some((n) => n.includes('context-turns'))).toBe(false);
    expect(res.notices.some((n) => n.includes('context-max-tokens'))).toBe(false);
    expect(input.contextTurns).toBeUndefined();
    expect(input.contextMaxTokens).toBeUndefined();
  });

  // ---- W1-M6/M7: the solo knob/param-map invariant behind the forward-notice loop ----
  //
  // There is no live defect on the interactive `amicus_start` path today: it can never
  // reach the shared-server branch (mcp-server.js:458 gates that branch on
  // `sharedServer.enabled && input.noUi`, and an interactive call has no `noUi`), so it
  // always takes spawn-fallback, which resolves the pack in-process before spawning
  // (single-resolution rule) — see the `packNotices` push loop in mcp-server.js. That
  // loop is UNREACHABLE for solo only by invariant: every key `validatePack(mode:'run')`
  // lets through (KIND_OPTIONS.solo) currently either round-trips onto `input` via a real
  // SOLO_PACK_PARAM_MAP destination, or forwards via pack-resolve.js's FORWARDABLE_ARG_KEYS
  // (maxCost — the only KIND_OPTIONS.solo entry with no paramMap destination). Neither table
  // is re-typed here (T15-m5): KIND_OPTIONS is imported live above, and instead of mirroring
  // pack-resolve.js's private (unexported) FORWARDABLE_ARG_KEYS — that file sits at exactly
  // 300/300 lines and is not in this task's file list, so it cannot gain an export — this
  // walks each KIND_OPTIONS.solo key through the REAL applyPackToMcpInput and inspects the
  // REAL res.notices it produces, so pack-resolve.js's own forwarding/notice decision is
  // authoritative, never guessed.
  //
  // Known limit (reported, not hidden): a key that validatePack accepts but that
  // pack-resolve.js's own knob tables (COMMON_OPTION_KNOBS / CONTEXT_OPTION_KNOBS, private to
  // pack-resolve.js) never read into `args` at all would produce NO notice — not because it
  // is safely routed, but because it never reaches the diff this guard (and the notice loop
  // it guards) can see. That is a different, narrower defect than the one this task scopes
  // (KIND_OPTIONS drifting ahead of SOLO_PACK_PARAM_MAP/FORWARDABLE_ARG_KEYS on the MCP
  // surface specifically) and is why the recon mutation below touches two files, not one.
  test('every KIND_OPTIONS.solo key round-trips through applyPackToMcpInput without an orphan notice — a key with neither a SOLO_PACK_PARAM_MAP destination nor FORWARDABLE_ARG_KEYS membership would be silently dropped were it not for the notice loop in src/mcp-server.js', () => {
    for (const optionKey of KIND_OPTIONS.solo) {
      const packName = `solo-w1m67-${optionKey.toLowerCase()}`;
      store().writePack({
        schemaVersion: 1, type: 'pack', name: packName, version: '1.0.0', kind: 'solo',
        description: 'x', model: 'vendorx/solo-model', options: { [optionKey]: true }, briefing: {},
      });
      const input = {};
      const res = applyPackToMcpInput({
        packRef: packName, expectedKind: 'solo', input, paramMap: SOLO_PACK_PARAM_MAP,
      });
      expect(res.error).toBeUndefined();
      const orphanNotice = res.notices.find((n) => n.includes(optionKey));
      if (orphanNotice) {
        throw new Error(
          `KIND_OPTIONS.solo key '${optionKey}' has neither a SOLO_PACK_PARAM_MAP destination nor ` +
          `FORWARDABLE_ARG_KEYS membership — produced: "${orphanNotice}". Without the packNotices push ` +
          "loop in amicus_start's spawn-fallback path (src/mcp-server.js), a pack setting this " +
          'knob would be silently dropped instead of surfaced to the caller.'
        );
      }
    }
  });

  // ---- v4.5 HOLD-gate decision 2: a dropped council option fails resolution outright ----
  test('a council pack carrying a dropped option (agent) now fails PACK_INVALID — it can no longer reach the orphan-notice path', () => {
    store().writePack(COUNCIL_DROPPED_OPTION_PACK()); // options.agent: 'Plan'
    const input = {};
    const res = applyPackToMcpInput({
      packRef: 'council-dropped-option-pack', expectedKind: 'council', input, paramMap: COUNCIL_PACK_PARAM_MAP,
    });
    expect(res.error).toBeDefined();
    expect(res.error.code).toBe(ERROR_CODES.PACK_INVALID);
    expect(res.error.message).toContain("unknown option 'agent'");
  });

  test('kind mismatch returns a structured PACK_KIND_MISMATCH error naming both kinds', () => {
    store().writePack(FANOUT_KIND_PACK()); // kind: 'fanout', name: 'wrong-kind-for-council'
    const input = {};
    const res = applyPackToMcpInput({
      packRef: 'wrong-kind-for-council', expectedKind: 'council', input, paramMap: COUNCIL_PACK_PARAM_MAP,
    });
    expect(res.error).toBeDefined();
    expect(res.error.code).toBe(ERROR_CODES.PACK_KIND_MISMATCH);
    expect(res.error.message).toContain('fanout');
    expect(res.error.message).toContain('council');
  });
});

// ---------------------------------------------------------------------------
// Wave-1 review fix wave (I1/I2/I3): pack-forwarded maxCost/template must be
// validated BEFORE any spawn or state write on amicus_fanout, never blind.
// ---------------------------------------------------------------------------

describe('amicus_fanout: pre-spend validation of pack-forwarded maxCost/template', () => {
  const FANOUT_TEMPLATE_NEEDS_ARTIFACT_PACK = () => ({
    schemaVersion: 1, type: 'pack', name: 'fanout-review-template-pack', version: '1.0.0', kind: 'fanout',
    description: 'x', bench: ['vendorx/model-a', 'vendorx/model-b'], options: {}, briefing: { template: 'review' },
  });
  const FANOUT_STRING_MAXCOST_PACK = () => ({
    schemaVersion: 1, type: 'pack', name: 'fanout-string-maxcost-pack', version: '1.0.0', kind: 'fanout',
    description: 'x', bench: ['vendorx/model-a', 'vendorx/model-b'], options: { maxCost: '2.00' }, briefing: {},
  });

  // child_process.spawn has no DI seam (Wave-1 report: confirmed no injectable
  // spawn seam) — mocked per-call via jest.isolateModulesAsync + jest.doMock,
  // the same idiom tests/mcp-start-metadata.test.js already established for
  // exercising a REAL handler call without launching a real child process.
  async function callFanoutWithMockedSpawn(input, project) {
    let result; let spawnMock;
    await jest.isolateModulesAsync(async () => {
      spawnMock = jest.fn(() => ({ pid: 4242, unref: jest.fn() }));
      jest.doMock('child_process', () => ({ spawn: spawnMock }));
      const { handlers: h } = require('../../src/mcp-server');
      result = await h.amicus_fanout(input, project);
    });
    return { result, spawnCallCount: spawnMock.mock.calls.length };
  }

  function waveDirCount(project) {
    const sessBase = path.join(project, '.claude', 'amicus_sessions');
    return fs.existsSync(sessBase) ? fs.readdirSync(sessBase).length : 0;
  }

  test('I1: a pack template needing an artifact (review) fails pre-spend — isError, NO wave dir, NO spawn (never strands a pid-less running wave)', async () => {
    store().writePack(FANOUT_TEMPLATE_NEEDS_ARTIFACT_PACK());
    const { result, spawnCallCount } = await callFanoutWithMockedSpawn(
      { pack: 'fanout-review-template-pack', prompt: 'Review this.' }, tmp);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/artifact/);
    expect(spawnCallCount).toBe(0);
    expect(waveDirCount(tmp)).toBe(0);
  });

  test('I2: a pack with a non-numeric (string) maxCost fails pre-spend — isError, NO wave dir, NO spawn (never runs uncapped)', async () => {
    store().writePack(FANOUT_STRING_MAXCOST_PACK());
    const { result, spawnCallCount } = await callFanoutWithMockedSpawn(
      { pack: 'fanout-string-maxcost-pack', prompt: 'Do the thing.' }, tmp);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('fanout-string-maxcost-pack');
    expect(spawnCallCount).toBe(0);
    expect(waveDirCount(tmp)).toBe(0);
  });

  test('valid forwarded maxCost/template still spawn normally (no regression)', async () => {
    store().writePack({
      schemaVersion: 1, type: 'pack', name: 'fanout-valid-forward-pack', version: '1.0.0', kind: 'fanout',
      description: 'x', bench: ['vendorx/model-a', 'vendorx/model-b'], options: { maxCost: 5 }, briefing: {},
    });
    const { result, spawnCallCount } = await callFanoutWithMockedSpawn(
      { pack: 'fanout-valid-forward-pack', prompt: 'Do the thing.' }, tmp);
    expect(result.isError).toBeUndefined();
    expect(spawnCallCount).toBe(1);
    expect(waveDirCount(tmp)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// v4.7 PR7 Task 9: an empty/whitespace prompt or a non-positive timeout must
// never strand a pid-less 'running' orphan wave. This is failure mode (d):
// {timeout: -1} is reachable BOTH as a typed MCP param (closed by the zod
// schema's .positive() in mcp-tools.js) AND via a pack (validatePack only
// checks option KEY names, never value types — a guard on the zod schema
// alone is half a guard). Both entrances are exercised below.
// ---------------------------------------------------------------------------

describe('amicus_fanout: reject empty prompt / non-positive timeout before any wave dir (v4.7 PR7 Task 9)', () => {
  // Local variant of callFanoutWithMockedSpawn / waveDirCount —
  // mirrors this file's own established idiom (see callFanoutCapturingArgv
  // below) of each describe block owning its helpers rather than reaching
  // into a sibling describe's closure.
  async function callFanoutWithMockedSpawn(input, project) {
    let result; let spawnMock;
    await jest.isolateModulesAsync(async () => {
      spawnMock = jest.fn(() => ({ pid: 4242, unref: jest.fn() }));
      jest.doMock('child_process', () => ({ spawn: spawnMock }));
      const { handlers: h } = require('../../src/mcp-server');
      result = await h.amicus_fanout(input, project);
    });
    return { result, spawnCallCount: spawnMock.mock.calls.length };
  }

  function waveDirCount(project) {
    const sessBase = path.join(project, '.claude', 'amicus_sessions');
    return fs.existsSync(sessBase) ? fs.readdirSync(sessBase).length : 0;
  }

  const FANOUT_NEGATIVE_TIMEOUT_PACK = () => ({
    schemaVersion: 1, type: 'pack', name: 'fanout-negative-timeout-pack', version: '1.0.0', kind: 'fanout',
    description: 'x', bench: ['vendorx/model-a', 'vendorx/model-b'], options: { timeout: -1 }, briefing: {},
  });

  test('empty prompt: isError, NO wave dir, NO spawn (never strands a pid-less running wave)', async () => {
    const { result, spawnCallCount } = await callFanoutWithMockedSpawn(
      { models: ['vendorx/model-a', 'vendorx/model-b'], prompt: '' }, tmp);
    expect(result.isError).toBe(true);
    expect(spawnCallCount).toBe(0);
    expect(waveDirCount(tmp)).toBe(0);
  });

  test('whitespace-only prompt: isError, NO wave dir, NO spawn (never strands a pid-less running wave)', async () => {
    const { result, spawnCallCount } = await callFanoutWithMockedSpawn(
      { models: ['vendorx/model-a', 'vendorx/model-b'], prompt: '   ' }, tmp);
    expect(result.isError).toBe(true);
    expect(spawnCallCount).toBe(0);
    expect(waveDirCount(tmp)).toBe(0);
  });

  test('typed timeout: -1 with a valid prompt: isError, NO wave dir, NO spawn (the TYPED door)', async () => {
    const { result, spawnCallCount } = await callFanoutWithMockedSpawn(
      { models: ['vendorx/model-a', 'vendorx/model-b'], prompt: 'ok', timeout: -1 }, tmp);
    expect(result.isError).toBe(true);
    expect(spawnCallCount).toBe(0);
    expect(waveDirCount(tmp)).toBe(0);
  });

  test('a pack carrying options.timeout: -1: isError, NO wave dir, NO spawn (the PACK door — validatePack checks keys, never values)', async () => {
    store().writePack(FANOUT_NEGATIVE_TIMEOUT_PACK());
    const { result, spawnCallCount } = await callFanoutWithMockedSpawn(
      { pack: 'fanout-negative-timeout-pack', prompt: 'ok' }, tmp);
    expect(result.isError).toBe(true);
    expect(spawnCallCount).toBe(0);
    expect(waveDirCount(tmp)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// W1-M4 (v4.7 PR7): an MCP fanout wave whose spawned CLI child aborts before
// fanout.js:145 used to leave briefing.md holding the RAW prompt forever —
// list-search.js's waveSearchMaterial reads briefing.md verbatim as the
// `--search` corpus, so the wave was permanently unfindable by the text the
// user actually sees. This block pins that briefing.md now holds the
// RENDERED text when a pack forwards a template, while the child still gets
// the raw prompt via a sibling briefing-input.md so its own later render
// (and promptMeta.template provenance) is unaffected.
// ---------------------------------------------------------------------------

describe('amicus_fanout: renders briefing.md at the pre-seed so an aborted wave stays searchable (W1-M4)', () => {
  const MARKER = '=== W1-M4-MARKER ===';

  // FIXTURE TRAP: the only template fixture already in this file ('review',
  // used by the I1 test above) needs {{artifact}}, which the fanout pre-seed
  // dry run can never supply — it is rejected before any wave dir is created.
  // A real user template, written into THIS test's own tmp AMICUS_CONFIG_DIR,
  // is required to reach the render path at all.
  function writeUserTemplate(name) {
    const dir = path.join(tmp, 'templates');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${name}.md`), `${MARKER}\n{{prompt}}\n`);
  }

  function waveDirFor(result, project) {
    const body = JSON.parse(result.content[0].text);
    return path.join(project, '.claude', 'amicus_sessions', body.waveId);
  }

  // Local variant of callFanoutWithMockedSpawn that also hands back
  // the captured spawn argv, needed to assert --prompt-file/--template.
  async function callFanoutCapturingArgv(input, project) {
    let result; let spawnMock; let argv;
    await jest.isolateModulesAsync(async () => {
      spawnMock = jest.fn((cmd, cmdArgs) => { argv = cmdArgs; return { pid: 4242, unref: jest.fn() }; });
      jest.doMock('child_process', () => ({ spawn: spawnMock }));
      const { handlers: h } = require('../../src/mcp-server');
      result = await h.amicus_fanout(input, project);
    });
    return { result, spawnCallCount: spawnMock.mock.calls.length, argv };
  }

  test('a pack-forwarded template renders briefing.md, hands the child the raw prompt via briefing-input.md, and still forwards --template', async () => {
    writeUserTemplate('w1m4-marker-template');
    store().writePack({
      schemaVersion: 1, type: 'pack', name: 'w1m4-template-pack', version: '1.0.0', kind: 'fanout',
      description: 'x', bench: ['vendorx/model-a', 'vendorx/model-b'], options: {},
      briefing: { template: 'w1m4-marker-template' },
    });
    const input = { pack: 'w1m4-template-pack', prompt: 'The raw prompt text.' };
    const { result, spawnCallCount, argv } = await callFanoutCapturingArgv(input, tmp);

    expect(result.isError).toBeUndefined();
    expect(spawnCallCount).toBe(1);
    const waveDir = waveDirFor(result, tmp);

    // 1. briefing.md contains the rendered marker (the search corpus).
    const briefing = fs.readFileSync(path.join(waveDir, 'briefing.md'), 'utf-8');
    expect(briefing).toContain(MARKER);
    expect(briefing).toContain(input.prompt);

    // 2. briefing-input.md is the raw prompt, byte-identical.
    const briefingInput = fs.readFileSync(path.join(waveDir, 'briefing-input.md'), 'utf-8');
    expect(briefingInput).toBe(input.prompt);

    // 3. the spawned child's --prompt-file points at briefing-input.md, and
    // --template is still forwarded (unchanged from today).
    const pfIdx = argv.indexOf('--prompt-file');
    expect(pfIdx).toBeGreaterThan(-1);
    expect(argv[pfIdx + 1]).toBe(path.join(waveDir, 'briefing-input.md'));
    const tIdx = argv.indexOf('--template');
    expect(tIdx).toBeGreaterThan(-1);
    expect(argv[tIdx + 1]).toBe('w1m4-marker-template');
  });

  test('with no pack: briefing.md is the raw prompt verbatim, no briefing-input.md is written, and --prompt-file defaults to briefing.md', async () => {
    const input = { models: ['vendorx/model-a', 'vendorx/model-b'], prompt: 'Plain prompt, no pack.' };
    const { result, spawnCallCount, argv } = await callFanoutCapturingArgv(input, tmp);

    expect(result.isError).toBeUndefined();
    expect(spawnCallCount).toBe(1);
    const waveDir = waveDirFor(result, tmp);

    // 4. no pack forwarded: briefing.md === input.prompt, no sibling file.
    expect(fs.readFileSync(path.join(waveDir, 'briefing.md'), 'utf-8')).toBe(input.prompt);
    expect(fs.existsSync(path.join(waveDir, 'briefing-input.md'))).toBe(false);

    // The load-bearing default: childPromptPath falls back to briefingPath,
    // or every non-template wave would spawn with --prompt-file undefined.
    const pfIdx = argv.indexOf('--prompt-file');
    expect(pfIdx).toBeGreaterThan(-1);
    expect(argv[pfIdx + 1]).toBe(path.join(waveDir, 'briefing.md'));
  });
});

describe('amicus_start spawn-fallback: pre-spend validation of pack-forwarded maxCost/template', () => {
  const SOLO_TEMPLATE_NEEDS_ARTIFACT_PACK = () => ({
    schemaVersion: 1, type: 'pack', name: 'solo-review-template-pack', version: '1.0.0', kind: 'solo',
    description: 'x', model: 'vendorx/solo-model', options: {}, briefing: { template: 'review' },
  });

  // Same idiom as the amicus_fanout describe block above, plus a route-launch
  // stub (mirrors tests/mcp-start-metadata.test.js's file-level mock) — model
  // routing runs BEFORE this handler's pack-forward validation and would
  // otherwise need a real catalog/API key to resolve.
  async function callStartWithMockedSpawn(input, project) {
    let result; let spawnMock;
    await jest.isolateModulesAsync(async () => {
      spawnMock = jest.fn(() => ({ pid: 4242, unref: jest.fn() }));
      jest.doMock('child_process', () => ({ spawn: spawnMock }));
      jest.doMock('../../src/utils/route-launch', () => ({
        resolveRouteForLaunch: jest.fn(async ({ model }) => ({
          kind: 'resolved', gateway: 'direct', executableId: model, provenance: {},
        })),
      }));
      const { handlers: h } = require('../../src/mcp-server');
      result = await h.amicus_start(input, project);
    });
    return { result, spawnCallCount: spawnMock.mock.calls.length };
  }

  function sessionDirCount(project) {
    const sessBase = path.join(project, '.claude', 'amicus_sessions');
    return fs.existsSync(sessBase) ? fs.readdirSync(sessBase).length : 0;
  }

  test('I1: a pack template needing an artifact (review) fails pre-spend on the spawn-fallback path — isError, NO session dir, NO spawn', async () => {
    store().writePack(SOLO_TEMPLATE_NEEDS_ARTIFACT_PACK());
    const { result, spawnCallCount } = await callStartWithMockedSpawn(
      { pack: 'solo-review-template-pack', prompt: 'Review this.', model: 'vendorx/solo-model' }, tmp);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/artifact/);
    expect(spawnCallCount).toBe(0);
    expect(sessionDirCount(tmp)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Wave-1 review fix (I4): fanout wave pre-seed records child pid so
// pre-creation deaths (e.g., budget gate failPre) are reapable by crash
// detection, which probes pid-bearing records only.
// ---------------------------------------------------------------------------

describe('I4: amicus_fanout wave metadata pre-seed includes child pid', () => {
  async function callFanoutWithMockedSpawn(input, project) {
    let result; let spawnMock;
    await jest.isolateModulesAsync(async () => {
      spawnMock = jest.fn(() => ({ pid: 4242, unref: jest.fn() }));
      jest.doMock('child_process', () => ({ spawn: spawnMock }));
      const { handlers: h } = require('../../src/mcp-server');
      result = await h.amicus_fanout(input, project);
    });
    return { result, spawnMock };
  }

  test('fanout wave metadata.json pre-seed includes pid as a number matching the spawned child pid', async () => {
    const { result, spawnMock } = await callFanoutWithMockedSpawn(
      { models: ['model-a', 'model-b'], prompt: 'Test.' }, tmp);

    expect(result.isError).toBeUndefined();
    expect(spawnMock.mock.calls.length).toBe(1);

    // Extract the waveId from the response
    const responseText = result.content[0].text;
    const waveIdMatch = responseText.match(/"waveId"\s*:\s*"([^"]+)"/);
    expect(waveIdMatch).toBeTruthy();
    const waveId = waveIdMatch[1];

    // Read the wave metadata
    const waveDir = path.join(tmp, '.claude', 'amicus_sessions', waveId);
    const metaPath = path.join(waveDir, 'metadata.json');
    expect(fs.existsSync(metaPath)).toBe(true);

    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    expect(meta.pid).toBe(4242);
    expect(typeof meta.pid).toBe('number');
  });
});
