/**
 * F6 / Task 6.2 — briefing/mode/agent in MCP-created metadata at creation.
 *
 * Covers both amicus_start write sites:
 *  - spawn-fallback initial metadata (exercised end-to-end via a mocked
 *    child_process, AMICUS_SHARED_SERVER='0')
 *  - shared-server metadata write (source-contract check here; a live
 *    OpenCode server isn't needed to drive this branch behaviorally —
 *    mockCommonSeams() in tests/mcp-server-wait-wiring.test.js stubs the
 *    seams and exercises it end-to-end, reading metadata.json off disk —
 *    so this file's source-level pin is a supplement, not the only coverage)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// amicus_start routes the model through resolveRouteForLaunch (#61 Task 6.2).
// The synthetic 'google/gemini-test' model below exists to exercise metadata
// writes, not real routing — default-mock a deterministic passthrough
// (mirrors the same default mock in tests/mcp-server.test.js).
jest.mock('../src/utils/route-launch', () => ({
  resolveRouteForLaunch: jest.fn(async ({ model }) => ({
    kind: 'resolved',
    gateway: typeof model === 'string' && model.startsWith('openrouter/') ? 'openrouter' : 'direct',
    executableId: model,
    provenance: {},
  })),
}));

describe('amicus_start spawn-path initial metadata (F6)', () => {
  test('writes briefing + mode at creation', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-create-'));
    try {
      await jest.isolateModulesAsync(async () => {
        jest.doMock('child_process', () => ({
          spawn: jest.fn(() => ({ pid: 4242, unref: jest.fn() })),
        }));
        const prev = process.env.AMICUS_SHARED_SERVER;
        process.env.AMICUS_SHARED_SERVER = '0'; // force the spawn fallback
        try {
          const { handlers: h } = require('../src/mcp-server');
          const result = await h.amicus_start(
            { prompt: 'audit the auth module', noUi: true, model: 'google/gemini-test' }, tmpDir);
          const { taskId } = JSON.parse(result.content[0].text);
          const metaPath = path.join(tmpDir, '.claude', 'amicus_sessions', taskId, 'metadata.json');
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
          expect(meta.briefing).toBe('audit the auth module');
          expect(meta.mode).toBe('headless');
          expect(meta.headless).toBe(true);
        } finally {
          if (prev === undefined) { delete process.env.AMICUS_SHARED_SERVER; }
          else { process.env.AMICUS_SHARED_SERVER = prev; }
        }
      });
    } finally { fs.rmSync(tmpDir, { recursive: true, force: true }); }
  });

  test('writes briefing + interactive mode when noUi is false', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-create-ui-'));
    try {
      await jest.isolateModulesAsync(async () => {
        jest.doMock('child_process', () => ({
          spawn: jest.fn(() => ({ pid: 5252, unref: jest.fn() })),
        }));
        const prev = process.env.AMICUS_SHARED_SERVER;
        process.env.AMICUS_SHARED_SERVER = '0'; // force the spawn fallback
        try {
          const { handlers: h } = require('../src/mcp-server');
          const result = await h.amicus_start(
            { prompt: 'open interactively', noUi: false, model: 'google/gemini-test' }, tmpDir);
          const { taskId } = JSON.parse(result.content[0].text);
          const metaPath = path.join(tmpDir, '.claude', 'amicus_sessions', taskId, 'metadata.json');
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
          expect(meta.briefing).toBe('open interactively');
          expect(meta.mode).toBe('interactive');
          expect(meta.headless).toBe(false);
        } finally {
          if (prev === undefined) { delete process.env.AMICUS_SHARED_SERVER; }
          else { process.env.AMICUS_SHARED_SERVER = prev; }
        }
      });
    } finally { fs.rmSync(tmpDir, { recursive: true, force: true }); }
  });
});

describe('shared-server path metadata keys (source contract)', () => {
  // The shared path needs a live OpenCode server to exercise; pin the write's
  // contents at the source level instead (established repo style, see
  // tests/mcp-shared-server.test.js).
  const src = fs.readFileSync(path.join(__dirname, '../src/mcp-server.js'), 'utf-8');
  test('shared-server metadata write includes briefing/mode/agent', () => {
    const start = src.indexOf('opencodeSessionId: sessionId');
    const end = src.indexOf('buildContext(cwd');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const sharedWrite = src.slice(start, end);
    // v4.5 HOLD-gate decision 1 (parity): the shared-server path now renders a
    // pack-forwarded template before recording `briefing`, so this records
    // `renderedPrompt` (byte-identical to input.prompt when no pack template
    // applied) rather than the raw input — matching the CLI's own on-disk
    // briefing.md, which is always the rendered text.
    expect(sharedWrite).toContain('briefing: renderedPrompt');
    expect(sharedWrite).toContain("mode: 'headless'");
    expect(sharedWrite).toContain("agent: agent || 'build'");
  });

  // v4.7 F8 (D13, errata E-PR3-2): THE critical site. This shared-server branch
  // (sharedServer.enabled && input.noUi, the DEFAULT MCP headless path) never
  // spawns a CLI child, so argv forwarding (mcp-server.test.js's --tag tests)
  // can never reach it — input.tag must be stamped directly into this write,
  // same additive-only "absent (not null)" idiom as packRecord immediately
  // above it. Presence-only source-contract slice, same idiom as the pack
  // window tests above (mcp-pack-params.test.js).
  test('shared-server metadata write stamps input.tag additive-only (absent without a tag)', () => {
    const start = src.indexOf('opencodeSessionId: sessionId');
    const end = src.indexOf('buildContext(cwd');
    const sharedWrite = src.slice(start, end);
    expect(sharedWrite).toContain('...(input.tag ? { tag: input.tag } : {})');
  });
});

// PR6 Task 2: the shared-server amicus_start path used to hang the whole
// budget gate off `packForward.maxCost !== undefined`, so a plain (no-pack)
// MCP start skipped it entirely while the CLI (cli-handlers-run.js:90) always
// gated with a cfg.maxCost fallback. This drives the REAL shared-server
// branch (sharedServer.enabled defaults true, input.noUi:true) and proves the
// gate now fires before ensureServer()/createSession() are ever reached — no
// live OpenCode server needed, since a refusal returns before that point.
describe('shared-server path: budget gate applies with NO pack (PR6 Task 2)', () => {
  test('refuses an over-threshold model on the shared-server path with NO pack', async () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-budget-cfg-'));
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-budget-proj-'));
    const prevConfigDir = process.env.AMICUS_CONFIG_DIR;
    const prevSharedServer = process.env.AMICUS_SHARED_SERVER;
    process.env.AMICUS_CONFIG_DIR = configDir;
    delete process.env.AMICUS_SHARED_SERVER; // force the shared-server path (default-enabled)
    try {
      fs.writeFileSync(
        path.join(configDir, 'config.json'),
        JSON.stringify({ maxCostPerMtok: 1.0 }, null, 2)
      );
      await jest.isolateModulesAsync(async () => {
        // Seed a pricing fixture for 'expensive-model' well above the $1/Mtok
        // cap above (style: same requireActual-spread idiom used elsewhere,
        // e.g. mockCommonSeams() in tests/mcp-server-wait-wiring.test.js).
        jest.doMock('../src/utils/pricing', () => ({
          ...jest.requireActual('../src/utils/pricing'),
          lookupPricing: (modelId) => (
            modelId === 'expensive-model' ? { prompt: 0.00005, completion: 0.00005 } : null
          ), // $50/Mtok
        }));
        const { handlers: h } = require('../src/mcp-server');
        const res = await h.amicus_start(
          { prompt: 'hi', model: 'expensive-model', noUi: true }, project);
        expect(res.isError).toBe(true);
        const doc = JSON.parse(res.content[0].text);
        expect(doc.error.code).toBe('BUDGET_EXCEEDED');
      });
    } finally {
      if (prevConfigDir === undefined) { delete process.env.AMICUS_CONFIG_DIR; }
      else { process.env.AMICUS_CONFIG_DIR = prevConfigDir; }
      if (prevSharedServer === undefined) { delete process.env.AMICUS_SHARED_SERVER; }
      else { process.env.AMICUS_SHARED_SERVER = prevSharedServer; }
      fs.rmSync(configDir, { recursive: true, force: true });
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  // PR6 Task 2 review follow-up: the only thing pinning the pack-over-config
  // precedence was `expect(preSpend).toMatch(/fwd\.maxCost/)` in
  // mcp-pack-params.test.js — a source-text check a BACKWARDS expression
  // (`cfg.maxCost !== undefined ? cfg.maxCost : fwd.maxCost`) would also
  // satisfy. This drives it behaviorally: the pack's tiny ceiling must win
  // over the config's huge one, so flipping the ternary turns this RED.
  test("a pack's maxCost wins over the config's, on the shared-server path", async () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-packwins-cfg-'));
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-packwins-proj-'));
    const prevConfigDir = process.env.AMICUS_CONFIG_DIR;
    const prevSharedServer = process.env.AMICUS_SHARED_SERVER;
    process.env.AMICUS_CONFIG_DIR = configDir;
    delete process.env.AMICUS_SHARED_SERVER;
    try {
      // Config ceiling is enormous; only the pack's can refuse this run.
      fs.writeFileSync(
        path.join(configDir, 'config.json'),
        JSON.stringify({ maxCost: 1000 }, null, 2)
      );
      fs.mkdirSync(path.join(configDir, 'packs'), { recursive: true });
      fs.writeFileSync(
        path.join(configDir, 'packs', 'tiny-ceiling.json'),
        JSON.stringify({
          schemaVersion: 1, type: 'pack', name: 'tiny-ceiling', version: '1.0.0',
          kind: 'solo', description: 'x', model: 'vendorx/cheap-model',
          options: { maxCost: 1e-9, noUi: true }, briefing: {},
        }, null, 2)
      );
      await jest.isolateModulesAsync(async () => {
        // Priced at $0.10/Mtok — far under the default per-Mtok cap, so the
        // ONLY branch that can refuse here is the ceiling.
        jest.doMock('../src/utils/pricing', () => ({
          ...jest.requireActual('../src/utils/pricing'),
          lookupPricing: (modelId) => (
            modelId === 'vendorx/cheap-model' ? { prompt: 0.0000001, completion: 0.0000001 } : null
          ),
        }));
        const { handlers: h } = require('../src/mcp-server');
        const res = await h.amicus_start(
          { prompt: 'hi', pack: 'tiny-ceiling', noUi: true }, project);
        expect(res.isError).toBe(true);
        const doc = JSON.parse(res.content[0].text);
        expect(doc.error.code).toBe('BUDGET_EXCEEDED');
      });
    } finally {
      if (prevConfigDir === undefined) { delete process.env.AMICUS_CONFIG_DIR; }
      else { process.env.AMICUS_CONFIG_DIR = prevConfigDir; }
      if (prevSharedServer === undefined) { delete process.env.AMICUS_SHARED_SERVER; }
      else { process.env.AMICUS_SHARED_SERVER = prevSharedServer; }
      fs.rmSync(configDir, { recursive: true, force: true });
      fs.rmSync(project, { recursive: true, force: true });
    }
  });
});
