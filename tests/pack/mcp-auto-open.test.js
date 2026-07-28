// tests/pack/mcp-auto-open.test.js
'use strict';

/**
 * v4.5 Task 17 (spec §6, ★ headline feature): amicus_council_run auto-opens
 * the Council Workspace via the new detached launcher. `helpers.autoOpen` is
 * the test seam (mcp-council-run.js falls back to the real
 * workspace-auto-open/workspace-window modules when it is absent) — every
 * behavioral test here injects a fake {decide, launch} pair so no test ever
 * reaches a real spawn() for the launch step itself.
 *
 * Argv/response style follows tests/mcp-council-run-inputs.test.js.
 * AMICUS_CONFIG_DIR sandboxing follows tests/pack/mcp-pack-params.test.js:
 * the wiring block always calls the REAL getWorkspaceAutoOpen() to build the
 * decision context (even when decide/launch are faked), and that reads
 * config.json off disk, so it must not touch a real ambient config dir.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { z } = require('zod');
const { handleCouncilRunTool } = require('../../src/mcp-council-run');
const { getTools } = require('../../src/mcp-tools');

let tmp; let briefingFile;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-auto-open-'));
  process.env.AMICUS_CONFIG_DIR = tmp;
  briefingFile = path.join(tmp, 'briefing.md');
  fs.writeFileSync(briefingFile, 'Review this.');
});
afterEach(() => {
  delete process.env.AMICUS_CONFIG_DIR;
  fs.rmSync(tmp, { recursive: true, force: true });
});

// spawnFn is injected by mcp-server; capture the argv instead of spawning.
// autoOpen is the NEW v4.5 test seam standing in for the real
// shouldAutoOpenWorkspace/launchWorkspaceWindowDetached modules.
const helpers = ({ spawnCalls = [], autoOpen } = {}) => ({
  spawnFn: (args, dir) => { spawnCalls.push({ args, dir }); return { pid: 4242 }; },
  clientName: 'claude-code',
  ...(autoOpen ? { autoOpen } : {}),
});
const input = (extra = {}) => ({ briefingFile, models: ['gemini', 'gpt', 'qwen'], ...extra });
const parseFenced = (res) => {
  const text = res.content[0].text;
  expect(text).toContain('<untrusted_sidecar_output'); // born-fenced (spec §8)
  const m = text.match(/\{[\s\S]*\}/);
  return JSON.parse(m[0]);
};

describe('amicus_council_run auto-open wiring', () => {
  test('decision {open:true} launches the workspace once and reports workspaceOpened:true', async () => {
    const launchCalls = [];
    const autoOpen = {
      decide: () => ({ open: true, reason: 'ok' }),
      launch: (opts) => { launchCalls.push(opts); },
    };
    const res = await handleCouncilRunTool(input(), tmp, helpers({ autoOpen }));
    expect(res.isError).toBeUndefined();
    const body = parseFenced(res);
    expect(body.workspaceOpened).toBe(true);
    expect(body.workspaceOpenReason).toBeUndefined();
    expect(launchCalls).toHaveLength(1);
    expect(launchCalls[0]).toEqual({ project: tmp, runId: body.runId });
  });

  test("decision {open:false, reason:'electron-absent'} skips launch and reports the reason", async () => {
    const launchCalls = [];
    const autoOpen = {
      decide: () => ({ open: false, reason: 'electron-absent' }),
      launch: (opts) => { launchCalls.push(opts); },
    };
    const res = await handleCouncilRunTool(input(), tmp, helpers({ autoOpen }));
    expect(res.isError).toBeUndefined();
    const body = parseFenced(res);
    expect(body.workspaceOpened).toBe(false);
    expect(body.workspaceOpenReason).toBe('electron-absent');
    expect(launchCalls).toHaveLength(0);
  });

  test('ui: false input reaches the decision helper as uiParam: false', async () => {
    let seenCtx;
    const autoOpen = {
      decide: (ctx) => { seenCtx = ctx; return { open: false, reason: 'param-suppressed' }; },
      launch: () => {},
    };
    await handleCouncilRunTool(input({ ui: false }), tmp, helpers({ autoOpen }));
    expect(seenCtx.uiParam).toBe(false);
  });

  test('a launch that throws does not fail the tool result (best-effort, run body unaffected)', async () => {
    const autoOpen = {
      decide: () => ({ open: true, reason: 'ok' }),
      launch: () => { throw new Error('spawn boom'); },
    };
    const res = await handleCouncilRunTool(input(), tmp, helpers({ autoOpen }));
    expect(res.isError).toBeUndefined();
    const body = parseFenced(res);
    expect(body.status).toBe('running'); // the run itself still succeeded
    expect(body.workspaceOpened).toBe(false);
    expect(body.workspaceOpenReason).toMatch(/^auto-open-failed:/);
  });

  test('no injected autoOpen (real wiring): a non-code-local client never opens, but the body still carries both fields', async () => {
    const res = await handleCouncilRunTool(input(), tmp, helpers());
    expect(res.isError).toBeUndefined();
    const body = parseFenced(res);
    expect(body.workspaceOpened).toBe(false);
    expect(typeof body.workspaceOpenReason).toBe('string');
    expect(body.workspaceOpenReason.length).toBeGreaterThan(0);
  });
});

describe('amicus_council_run schema gains ui; tool count stays 16', () => {
  test('getTools()', () => {
    const tools = getTools();
    expect(tools).toHaveLength(16);
    const tool = tools.find((t) => t.name === 'amicus_council_run');
    expect(Object.keys(tool.inputSchema)).toEqual(expect.arrayContaining(['ui']));
  });

  // Regression-lock idiom from tests/pack/mcp-pack-params.test.js ("Finding 1"):
  // parses the REAL Zod shape (z.object(inputSchema).parse), the same shape the
  // MCP SDK builds from getTools()'s inputSchema, so a reintroduced `.default()`
  // on `ui` would be caught here — a hand-built input object bypassing Zod
  // would never notice a `.default()` silently materializing the key.
  test('ui stays optional WITHOUT a default: omitting it leaves it genuinely absent after parsing', () => {
    const tool = getTools().find((t) => t.name === 'amicus_council_run');
    const parsed = z.object(tool.inputSchema).parse({ briefingFile: 'x.md', models: ['a', 'b'] });
    expect('ui' in parsed).toBe(false);
  });
});

describe('launchWorkspaceWindowDetached', () => {
  const { launchWorkspaceWindowDetached } = require('../../src/sidecar/workspace-window');

  test('not usable -> {launched:false, reason:"electron-absent"}, spawn never called', () => {
    const spawn = jest.fn();
    const res = launchWorkspaceWindowDetached({ project: '/p', runId: 'r1' }, {
      isElectronUsable: () => false,
      resolveElectronBinary: () => 'C:\\electron.exe',
      spawn,
    });
    expect(res).toEqual({ launched: false, reason: 'electron-absent' });
    expect(spawn).not.toHaveBeenCalled();
  });

  test('usable -> spawns detached/ignore with the workspace env contract and unrefs the child', () => {
    const unref = jest.fn();
    const spawn = jest.fn(() => ({ unref }));
    const res = launchWorkspaceWindowDetached({ project: 'C:\\proj', runId: 'aaaa1111' }, {
      isElectronUsable: () => true,
      resolveElectronBinary: () => 'C:\\electron.exe',
      spawn,
    });
    expect(res).toEqual({ launched: true });
    expect(spawn).toHaveBeenCalledTimes(1);
    const [bin, args, opts] = spawn.mock.calls[0];
    expect(bin).toBe('C:\\electron.exe');
    expect(args[args.length - 1]).toMatch(/electron[\\/]+main\.js$/);
    expect(opts.detached).toBe(true);
    expect(opts.stdio).toBe('ignore');
    expect(opts.env).toMatchObject({
      AMICUS_MODE: 'council-workspace',
      AMICUS_PROJECT: 'C:\\proj',
      AMICUS_RUN_ID: 'aaaa1111',
    });
    expect(unref).toHaveBeenCalledTimes(1);
  });

  test('empty runId still launches (run-list landing), AMICUS_RUN_ID is the empty string', () => {
    const unref = jest.fn();
    const spawn = jest.fn(() => ({ unref }));
    const res = launchWorkspaceWindowDetached({ project: '/p' }, {
      isElectronUsable: () => true,
      resolveElectronBinary: () => 'electron',
      spawn,
    });
    expect(res).toEqual({ launched: true });
    const opts = spawn.mock.calls[0][2];
    expect(opts.env.AMICUS_RUN_ID).toBe('');
  });

  test('spawn throwing is caught: {launched:false, reason: "spawn-failed: ..."}', () => {
    const res = launchWorkspaceWindowDetached({ project: '/p' }, {
      isElectronUsable: () => true,
      resolveElectronBinary: () => 'electron',
      spawn: () => { throw new Error('ENOENT'); },
    });
    expect(res.launched).toBe(false);
    expect(res.reason).toMatch(/^spawn-failed: ENOENT/);
  });
});

describe('auto-open is MCP-path-only (CLI pin, tests/mcp-fanout.test.js source-text idiom)', () => {
  test('src/cli-handlers-council-run.js never references workspace-auto-open or launchWorkspaceWindow', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../src/cli-handlers-council-run.js'), 'utf-8');
    expect(src).not.toContain('workspace-auto-open');
    expect(src).not.toContain('launchWorkspaceWindow');
  });
});
