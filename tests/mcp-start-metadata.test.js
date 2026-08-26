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

// ---------------------------------------------------------------------------
// W1-M4, the amicus_start half (v4.7 PR7 shipped the amicus_fanout half as
// Task 7; this one was deliberately left open because nobody had DRIVEN the
// spawn-fallback path end to end, so there was no verified reproduction to fix
// against — see BACKLOG's "filed, not fixed" entry).
//
// THE REPRO DRIVE. The fallback is selected by AMICUS_SHARED_SERVER='0'
// (src/utils/shared-server.js:29 — the shared-server branch is
// `sharedServer.enabled && input.noUi`, so clearing the flag reaches the spawn
// path even for a headless start). A pack forwarding `briefing.template` is
// what makes raw and rendered differ at all: `checkPackForward` returns a bare
// `{notices: []}` without one, and briefing.md === input.prompt by
// construction.
//
// WHAT DIVERGED. On this path `briefing.md` and the initial `metadata.briefing`
// were both written from `input.prompt` — the RAW text — while the
// shared-server branch's own metadata write records `briefing: renderedPrompt`.
// And for a `start` row, `metadata.briefing` IS the `--search` corpus
// (src/sidecar/list-search.js :: rowMatchesSearch falls through to `row.briefing` for anything
// that is not a wave or a council run), so a child that dies before its own
// `createSessionMetadata` leaves the session permanently unfindable by the text
// the user actually sees — the same defect Task 7 closed for a wave.
//
// ── NAMED MUTANTS with MEASURED red sets ──────────────────────────────────
// Scope: `npx jest tests/mcp-start-metadata.test.js
// tests/pack/mcp-pack-params.test.js tests/mcp-fanout.test.js --maxWorkers=2`
// → 3 suites / 66 tests. Measured 2026-08-26, each applied ALONE to
// src/mcp-server.js and reverted; source restored by byte copy and
// checksum-verified, never by `git checkout`.
//
// `RAWSTARTBRIEFING` — the whole pre-W12 fallback restored: `briefing.md` and
//   `metadata.briefing` both written from `input.prompt`, `childPromptPath`
//   pinned to `briefingPath`, no sibling file: **1 suite / 3 tests red**, the
//   three below. The no-pack control stays GREEN by design — with nothing
//   rendered, raw and rendered are the same bytes, which is precisely the
//   "additive, byte-identical when it does not apply" property it exists for.
// `RAWSTARTMETA` — only the metadata half reverted (the on-disk file is right,
//   the search corpus is not): **1 suite / 2 tests red** — the metadata test
//   and the end-to-end findability test, NOT the briefing.md one. That split is
//   what says the two halves are pinned separately: for a `start` row it is
//   `metadata.briefing`, not `briefing.md`, that `--search` actually reads.
// ⚠️ RE-RUN, NEVER RENUMBER: a recorded red set asserts the set still fails.
// ---------------------------------------------------------------------------

describe('amicus_start spawn-fallback: a pack-rendered briefing (W1-M4)', () => {
  const MARKER = '=== W1M4-START-MARKER ===';
  const RAW = 'The raw start prompt.';

  /** Drive the spawn fallback with a config dir of our own; hand back the argv. */
  async function driveFallback(input, project, configDir) {
    let result; let argv;
    const prevConfig = process.env.AMICUS_CONFIG_DIR;
    const prevShared = process.env.AMICUS_SHARED_SERVER;
    process.env.AMICUS_CONFIG_DIR = configDir;
    process.env.AMICUS_SHARED_SERVER = '0';
    try {
      await jest.isolateModulesAsync(async () => {
        jest.doMock('child_process', () => ({
          spawn: jest.fn((_cmd, cmdArgs) => { argv = cmdArgs; return { pid: 4242, unref: jest.fn() }; }),
        }));
        const { handlers: h } = require('../src/mcp-server');
        result = await h.amicus_start(input, project);
      });
    } finally {
      if (prevConfig === undefined) { delete process.env.AMICUS_CONFIG_DIR; }
      else { process.env.AMICUS_CONFIG_DIR = prevConfig; }
      if (prevShared === undefined) { delete process.env.AMICUS_SHARED_SERVER; }
      else { process.env.AMICUS_SHARED_SERVER = prevShared; }
    }
    return { result, argv };
  }

  let project; let configDir;
  beforeEach(() => {
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'w1m4-start-proj-'));
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'w1m4-start-cfg-'));
    fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ aliases: {} }));
    // FIXTURE TRAP (same one the fanout twin hit): the built-in `review`
    // template needs {{artifact}}, which the pack pre-render can never supply,
    // so it is rejected before anything is written. A user template of our own
    // is the only way to reach the render path.
    fs.mkdirSync(path.join(configDir, 'templates'), { recursive: true });
    fs.writeFileSync(path.join(configDir, 'templates', 'w1m4-start-tpl.md'),
      `${MARKER}\n{{prompt}}\n`);
    fs.mkdirSync(path.join(configDir, 'packs'), { recursive: true });
    fs.writeFileSync(path.join(configDir, 'packs', 'w1m4-start-pack.json'), JSON.stringify({
      schemaVersion: 1, type: 'pack', name: 'w1m4-start-pack', version: '1.0.0', kind: 'solo',
      description: 'x', model: 'vendorx/solo-model', options: { noUi: true },
      briefing: { template: 'w1m4-start-tpl' },
    }, null, 2));
  });
  afterEach(() => {
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  const sessionDir = (result) =>
    path.join(project, '.claude', 'amicus_sessions', JSON.parse(result.content[0].text).taskId);

  test('briefing.md holds the RENDERED text, and the child is handed the raw prompt via briefing-input.md', async () => {
    const { result, argv } = await driveFallback(
      { prompt: RAW, pack: 'w1m4-start-pack' }, project, configDir);
    expect(result.isError).toBeUndefined();
    const dir = sessionDir(result);

    const briefing = fs.readFileSync(path.join(dir, 'briefing.md'), 'utf-8');
    expect(briefing).toContain(MARKER);
    expect(briefing).toContain(RAW);

    expect(fs.readFileSync(path.join(dir, 'briefing-input.md'), 'utf-8')).toBe(RAW);

    // The child re-renders from the RAW input, so promptMeta.template
    // provenance and byte-identical output both survive.
    const pfIdx = argv.indexOf('--prompt-file');
    expect(pfIdx).toBeGreaterThan(-1);
    expect(argv[pfIdx + 1]).toBe(path.join(dir, 'briefing-input.md'));
    expect(argv).toContain('--template');
    expect(argv[argv.indexOf('--template') + 1]).toBe('w1m4-start-tpl');
  });

  test('the initial metadata.briefing — the --search corpus — is the RENDERED text too', async () => {
    const { result } = await driveFallback(
      { prompt: RAW, pack: 'w1m4-start-pack' }, project, configDir);
    const meta = JSON.parse(fs.readFileSync(path.join(sessionDir(result), 'metadata.json'), 'utf-8'));
    expect(meta.briefing).toContain(MARKER);
    expect(meta.briefing).toContain(RAW);
  });

  test('a start row rendered this way is findable by the text the user sees', async () => {
    // The whole point, end to end: the marker only exists in the RENDERED
    // prompt, and the list surface must be able to find the session by it even
    // though the spawned child never got far enough to write anything.
    const { result } = await driveFallback(
      { prompt: RAW, pack: 'w1m4-start-pack' }, project, configDir);
    const { taskId } = JSON.parse(result.content[0].text);
    const { enumerateSessions, searchSessions } = require('../src/sidecar/read');
    const rows = searchSessions(enumerateSessions(project, {}), MARKER.toLowerCase(), { project });
    expect(rows.map(r => r.taskId || r.id)).toEqual([taskId]);
  });

  test('with NO pack: briefing.md is the raw prompt, no sibling file, --prompt-file unmoved', async () => {
    const { result, argv } = await driveFallback(
      { prompt: RAW, noUi: true, model: 'google/gemini-test' }, project, configDir);
    const dir = sessionDir(result);
    expect(fs.readFileSync(path.join(dir, 'briefing.md'), 'utf-8')).toBe(RAW);
    expect(fs.existsSync(path.join(dir, 'briefing-input.md'))).toBe(false);
    // The load-bearing default, the same one the fanout twin pins: without it
    // every non-template start would spawn with `--prompt-file undefined`.
    expect(argv[argv.indexOf('--prompt-file') + 1]).toBe(path.join(dir, 'briefing.md'));
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'metadata.json'), 'utf-8'));
    expect(meta.briefing).toBe(RAW);
  });
});
