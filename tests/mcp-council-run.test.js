// tests/mcp-council-run.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { handleCouncilRunTool, buildCouncilStatusPayload } = require('../src/mcp-council-run');
const runState = require('../src/council/run-state');
const { getTools } = require('../src/mcp-tools');

let tmp; let briefingFile;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-council-'));
  briefingFile = path.join(tmp, 'briefing.md');
  fs.writeFileSync(briefingFile, 'Review this.');
});
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const helpers = (spawnCalls = []) => ({
  spawnFn: (args, dir) => { spawnCalls.push({ args, dir }); },
  clientName: 'claude-code',
});
const input = (extra = {}) => ({ briefingFile, models: ['gemini', 'gpt', 'qwen'], ...extra });
const parseFenced = (res) => {
  const text = res.content[0].text;
  expect(text).toContain('<untrusted_sidecar_output');           // born-fenced (spec §8)
  const m = text.match(/\{[\s\S]*\}/);
  return JSON.parse(m[0]);
};

describe('amicus_council_run handler', () => {
  test('spawns the CLI child and returns {runId, runDir} immediately, fenced', async () => {
    const calls = [];
    const res = await handleCouncilRunTool(input(), tmp, helpers(calls));
    expect(res.isError).toBeUndefined();
    const body = parseFenced(res);
    expect(body.type).toBe('council-run');
    expect(body.schemaVersion).toBe(2);
    expect(body.status).toBe('running');
    expect(body.runDir).toBe(path.join(tmp, `council-${body.runId}`));
    // Pre-seeded state: pointer + run.json exist BEFORE the child starts.
    const ptr = JSON.parse(fs.readFileSync(
      path.join(tmp, '.claude', 'amicus_sessions', `council-${body.runId}.json`), 'utf-8'));
    expect(ptr.runDir).toBe(body.runDir);
    const run = JSON.parse(fs.readFileSync(path.join(body.runDir, 'run.json'), 'utf-8'));
    expect(run).toMatchObject({ type: 'council-run', status: 'running', chair: 'deepseek' });
    // Briefing copied into the run dir; child launched with --prompt-file on the COPY.
    expect(fs.readFileSync(path.join(body.runDir, 'briefing.md'), 'utf-8')).toBe('Review this.');
    const args = calls[0].args;
    expect(args.slice(0, 2)).toEqual(['council', 'run']);
    expect(args).toContain('--run-id');
    expect(args[args.indexOf('--prompt-file') + 1]).toBe(path.join(body.runDir, 'briefing.md'));
    expect(args[args.indexOf('--models') + 1]).toBe('gemini,gpt,qwen');
    expect(args[args.indexOf('--cwd') + 1]).toBe(tmp);
    expect(args).toContain('--json');
  });

  // T15-m2: a pack-forwarded input.template (the only way a template reaches
  // this handler — MCP has no template schema param of its own) renders the
  // briefing AND must now carry its provenance onto the seeded run.json, the
  // same way the CLI's --template does (cli-handlers-council-run.js).
  describe('T15-m2: template provenance on the seeded run.json', () => {
    let prevConfigDir;
    beforeEach(() => {
      prevConfigDir = process.env.AMICUS_CONFIG_DIR;
      process.env.AMICUS_CONFIG_DIR = tmp;
      const dir = path.join(tmp, 'templates');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'prompt-only.md'), 'Custom wrapper: {{prompt}}');
    });
    afterEach(() => {
      if (prevConfigDir === undefined) { delete process.env.AMICUS_CONFIG_DIR; }
      else { process.env.AMICUS_CONFIG_DIR = prevConfigDir; }
    });

    test('a pack-forwarded input.template lands run.template.{name,hash} on the seeded run.json', async () => {
      const res = await handleCouncilRunTool(input({ template: 'prompt-only' }), tmp, helpers());
      const body = parseFenced(res);
      const run = JSON.parse(fs.readFileSync(path.join(body.runDir, 'run.json'), 'utf-8'));
      expect(run.template).toEqual({ name: 'prompt-only', hash: expect.any(String) });
      // The rendered (templated) briefing is what's written and spawned on —
      // same single-application-point precedent as the CLI.
      expect(fs.readFileSync(path.join(body.runDir, 'briefing.md'), 'utf-8'))
        .toBe('Custom wrapper: Review this.');
    });

    test('no input.template → no template key on the seeded run.json (absent, not null)', async () => {
      const res = await handleCouncilRunTool(input(), tmp, helpers());
      const body = parseFenced(res);
      const run = JSON.parse(fs.readFileSync(path.join(body.runDir, 'run.json'), 'utf-8'));
      expect(run).not.toHaveProperty('template');
    });
  });

  test('forwards chair/critic/lenses/maxCost/timeoutMinutes/gateway', async () => {
    const calls = [];
    await handleCouncilRunTool(input({
      chair: 'mistral', critic: 'gpt', maxCost: 2.5, timeoutMinutes: 10, gateway: 'openrouter',
    }), tmp, helpers(calls));
    const args = calls[0].args;
    expect(args[args.indexOf('--chair') + 1]).toBe('mistral');
    expect(args[args.indexOf('--critic') + 1]).toBe('gpt');
    expect(args[args.indexOf('--max-cost') + 1]).toBe('2.5');
    expect(args[args.indexOf('--timeout') + 1]).toBe('10');
    expect(args[args.indexOf('--gateway') + 1]).toBe('openrouter');
  });

  test.each([
    ['missing briefingFile', { briefingFile: undefined }, /briefingFile/],
    ['unreadable briefingFile', { briefingFile: '/nope/missing.md' }, /cannot read/i],
    ['models + council', { council: 'budget' }, /exactly one/],
    ['<2 seats', { models: ['gemini'] }, /at least 2/],
    ['chair in bench', { chair: 'gpt' }, /bench seat/],
    ['critic outside bench', { critic: 'mistral' }, /must be one of the bench/],
    ['critic + lenses', { critic: 'gpt', lenses: ['a', 'b', 'c'] }, /mutually exclusive/],
    ['lens count mismatch', { lenses: ['a'] }, /one lens per seat/],
    // Task 15 (spec §5.3): exec is deliberately NOT exposed over MCP — the
    // ONLY onComplete value accepted is 'mcp-notify'.
    ['onComplete exec string', { onComplete: 'rm -rf /' }, /mcp-notify/i],
  ])('validation: %s → isError, no spawn', async (_n, extra, msgRe) => {
    const calls = [];
    const res = await handleCouncilRunTool(input(extra), tmp, helpers(calls));
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(msgRe);
    expect(calls).toHaveLength(0);
  });

  test('spawn failure marks run.json error (no orphan running record)', async () => {
    const res = await handleCouncilRunTool(input(), tmp, {
      spawnFn: () => { throw new Error('spawn boom'); }, clientName: 'claude-code',
    });
    expect(res.isError).toBe(true);
    const dirs = fs.readdirSync(tmp).filter(d => d.startsWith('council-'));
    const run = JSON.parse(fs.readFileSync(path.join(tmp, dirs[0], 'run.json'), 'utf-8'));
    expect(run.status).toBe('error');
  });

  test('records the spawned child pid beside run.json, not inside it', async () => {
    const res = await handleCouncilRunTool(input(), tmp, {
      spawnFn: () => ({ pid: 4242 }), clientName: 'claude-code',
    });
    const body = parseFenced(res);
    // Deliberately its own file: the child owns run.json, and a cross-process
    // read-merge-write has no lock, so patching a pid in could clobber the
    // child's first checkpoint (or be clobbered by it).
    expect(runState.readSpawnPid(body.runDir)).toBe(4242);
    const run = JSON.parse(fs.readFileSync(path.join(body.runDir, 'run.json'), 'utf-8'));
    expect(run.pid).toBeUndefined();
    expect(run.status).toBe('running');
  });

  test('a child that dies before writing its own pid is still crash-detected (no pid-less orphan)', async () => {
    // 999999999 is guaranteed dead — stands in for a child that died in the
    // window between spawn and its own runState.initRun({pid}) checkpoint.
    const res = await handleCouncilRunTool(input(), tmp, {
      spawnFn: () => ({ pid: 999999999 }), clientName: 'claude-code',
    });
    const body = parseFenced(res);
    const payload = buildCouncilStatusPayload(tmp, body.runId);
    expect(payload.status).toBe('error');
    expect(payload.reason).toContain('exited unexpectedly');
  });

  test("run.json's own pid wins once the child checkpoints it", async () => {
    const res = await handleCouncilRunTool(input(), tmp, {
      spawnFn: () => ({ pid: 999999999 }), clientName: 'claude-code',
    });
    const body = parseFenced(res);
    // The live pid the child recorded must take precedence over the spawn
    // record, or a recycled/stale spawn.pid could crash-flag a healthy run.
    runState.checkpoint(body.runDir, { pid: process.pid });
    const payload = buildCouncilStatusPayload(tmp, body.runId);
    expect(payload.status).toBe('running');
  });

  test('tolerates a spawnFn that returns no child (run stays running, no pid)', async () => {
    const res = await handleCouncilRunTool(input(), tmp, helpers());
    const body = parseFenced(res);
    const run = JSON.parse(fs.readFileSync(path.join(body.runDir, 'run.json'), 'utf-8'));
    expect(run.status).toBe('running');
    expect(run.pid).toBeUndefined();
    expect(runState.readSpawnPid(body.runDir)).toBeNull();
  });

  test('maxCost <= 0 → isError, no spawn, no orphan run.json directory', async () => {
    const calls = [];
    const res = await handleCouncilRunTool(input({ maxCost: -1 }), tmp, helpers(calls));
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/maxCost/);
    expect(calls).toHaveLength(0);
    expect(fs.readdirSync(tmp).filter(d => d.startsWith('council-'))).toHaveLength(0);
  });

  test('timeoutMinutes <= 0 → isError, no spawn, no orphan run.json directory', async () => {
    const calls = [];
    const res = await handleCouncilRunTool(input({ timeoutMinutes: -5 }), tmp, helpers(calls));
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/timeoutMinutes/);
    expect(calls).toHaveLength(0);
    expect(fs.readdirSync(tmp).filter(d => d.startsWith('council-'))).toHaveLength(0);
  });

  test('outDir escaping the project directory → isError, no spawn, escaped dir not created', async () => {
    const calls = [];
    const res = await handleCouncilRunTool(
      input({ outDir: path.join('..', 'escaped-council') }), tmp, helpers(calls));
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/outDir must resolve to a path inside the project directory/);
    expect(calls).toHaveLength(0);
    expect(fs.existsSync(path.resolve(tmp, '..', 'escaped-council'))).toBe(false);
  });

  // Task 15 (spec §5.3) delivery seam: on successful launch with
  // onComplete: 'mcp-notify', the run is marked in the shared in-process
  // registry so runWait's terminal branch (mcp-wait.js) can later consume it
  // and send the notification. Omitted onComplete never marks anything.
  describe('onComplete: mcp-notify marks the run for the delivery seam', () => {
    const { consumeMcpNotify } = require('../src/mcp-notify');

    test("'mcp-notify' → run succeeds AND is marked (consumeMcpNotify returns true once)", async () => {
      const res = await handleCouncilRunTool(input({ onComplete: 'mcp-notify' }), tmp, helpers());
      expect(res.isError).toBeUndefined();
      const body = parseFenced(res);
      expect(consumeMcpNotify(body.runId)).toBe(true);
      expect(consumeMcpNotify(body.runId)).toBe(false); // once-semantics
    });

    test('omitted onComplete → run succeeds but is NOT marked', async () => {
      const res = await handleCouncilRunTool(input(), tmp, helpers());
      const body = parseFenced(res);
      expect(consumeMcpNotify(body.runId)).toBe(false);
    });
  });
});

describe('tool registration', () => {
  test('amicus_council_run is the 15th default tool', () => {
    const tools = getTools();
    expect(tools.map(t => t.name)).toContain('amicus_council_run');
    // amicus_spend (v4.3 Task 5) is now the 16th; this test's name refers to
    // amicus_council_run's own ordinal, which is unchanged.
    expect(tools).toHaveLength(16);
  });

  test('mcp-server wires the handler and injects spawn helpers (source check)', () => {
    const src = fs.readFileSync(path.join(__dirname, '../src/mcp-server.js'), 'utf-8');
    expect(src).toContain('amicus_council_run');
    expect(src).toContain("require('./mcp-council-run')");
    expect(src.indexOf('handleCouncilRunTool')).toBeGreaterThan(-1);
  });
});

describe('amicus_council_run tools / agent (spec 2026-09-11 §4)', () => {
  // Ruling P2-R28 supersedes P2-R25: `tools` and `agent` together are now
  // refused outright on every door (see the 'agent + tools IS refused' test
  // below) rather than short-circuited, so each of these single-flag cases
  // stays its own test.
  test('forwards remote tools as --tools on the child argv (no agent)', async () => {
    const spawnCalls = [];
    const res = await handleCouncilRunTool(input({ tools: ['webfetch', 'websearch'] }), tmp, helpers(spawnCalls));
    expect(res.isError).toBeFalsy();
    const { args } = spawnCalls[0];
    expect(args[args.indexOf('--tools') + 1]).toBe('webfetch,websearch');
    expect(args).not.toContain('--agent');
  });
  // B2/D6: todowrite never touches the tree, so it rides through the MCP
  // door exactly like webfetch/websearch — no out-dir placement rule applies.
  test('forwards todowrite as --tools on the child argv (B2/D6)', async () => {
    const spawnCalls = [];
    const res = await handleCouncilRunTool(input({ tools: ['todowrite'] }), tmp, helpers(spawnCalls));
    expect(res.isError).toBeFalsy();
    const { args } = spawnCalls[0];
    expect(args[args.indexOf('--tools') + 1]).toBe('todowrite');
  });
  test('forwards agent as --agent on the child argv (no tools)', async () => {
    const spawnCalls = [];
    const res = await handleCouncilRunTool(input({ agent: 'Plan' }), tmp, helpers(spawnCalls));
    expect(res.isError).toBeFalsy();
    const { args } = spawnCalls[0];
    expect(args[args.indexOf('--agent') + 1]).toBe('Plan');
    expect(args).not.toContain('--tools');
  });
  test('a local tool over MCP is refused before anything spawns — the MCP run dir must stay inside the project', async () => {
    const spawnCalls = [];
    const res = await handleCouncilRunTool(input({ tools: ['read'] }), tmp, helpers(spawnCalls));
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('amicus council run --tools');
    expect(spawnCalls).toHaveLength(0);
  });
  test('a malformed tools entry is refused before anything spawns', async () => {
    const spawnCalls = [];
    const res = await handleCouncilRunTool(input({ tools: ['../x'] }), tmp, helpers(spawnCalls));
    expect(res.isError).toBe(true);
    expect(spawnCalls).toHaveLength(0);
  });
  test('absent tools/agent leave the argv byte-identical (no --tools, no --agent)', async () => {
    const spawnCalls = [];
    await handleCouncilRunTool(input(), tmp, helpers(spawnCalls));
    expect(spawnCalls[0].args).not.toContain('--tools');
    expect(spawnCalls[0].args).not.toContain('--agent');
  });
  // Review r1 P2-R20: a permanently-refused id (task) is not a placement
  // problem (REMOTE_TOOL_IDS.includes('task') is false, so it used to fall
  // into the "local tools" branch and suggest --out-dir, a command that
  // would also fail) — it must be refused the same way resolveSeatTools
  // refuses it, naming the real escape hatch.
  // C6 (P2-R35, council #247 round 2): the message no longer says `--agent
  // Build` — an MCP client never types a `--` flag — it says `agent: "Build"`.
  test('a permanently-refused id (task) over MCP is refused naming the Build agent, not the out-dir fence (review r1 P2-R20)', async () => {
    const spawnCalls = [];
    const res = await handleCouncilRunTool(input({ tools: ['task'] }), tmp, helpers(spawnCalls));
    expect(res.isError).toBe(true);
    expect(res.content[0].text.startsWith('tools:')).toBe(true);
    expect(res.content[0].text).toContain('agent: "Build"');
    expect(spawnCalls).toHaveLength(0);
  });
  // Ruling P2-R28 (supersedes P2-R25): `tools` and `agent` are mutually
  // exclusive on every door, including MCP — the override already runs every
  // leg on its own agent with its full tool set, so a computed allowlist next
  // to it is refused before either is consulted further.
  test('agent + tools IS refused: --tools cannot be combined with --agent (P2-R28)', async () => {
    const spawnCalls = [];
    const res = await handleCouncilRunTool(input({ agent: 'Build', tools: ['task'] }), tmp, helpers(spawnCalls));
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('cannot be combined');
    expect(spawnCalls).toHaveLength(0);
  });
  // C6: the same rewrite applied to the conflict message — no MCP client
  // should ever see a `--` flag it cannot type.
  test('MCP refusal wording never leaks CLI flag syntax (C6)', async () => {
    const spawnCalls = [];
    const res = await handleCouncilRunTool(input({ agent: 'Plan', tools: ['webfetch'] }), tmp, helpers(spawnCalls));
    expect(res.isError).toBe(true);
    expect(res.content[0].text).not.toContain('--');
    expect(spawnCalls).toHaveLength(0);
  });

  // Re-review nit: agentToolsConflict only ever saw an ARRAY-shaped `input.tools`
  // (`Array.isArray(input.tools) ? input.tools : undefined`), so a
  // schema-bypassing bare string slipped past the conflict check even though
  // resolveRemoteOnlyTools's own docblock names a string as a supported
  // "defense-in-depth" shape — an inconsistency between the two guards.
  // `toolsIn` now normalizes once so both see the same shape.
  test('a string tools value with agent is refused the same as an array (schema-bypass, D8)', async () => {
    const spawnCalls = [];
    const before = fs.readdirSync(tmp);
    const res = await handleCouncilRunTool(input({ agent: 'Plan', tools: 'webfetch' }), tmp, helpers(spawnCalls));
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('cannot be combined');
    expect(spawnCalls).toHaveLength(0);
    expect(fs.readdirSync(tmp)).toEqual(before); // no run dir was created
  });
});
