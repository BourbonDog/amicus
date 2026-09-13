// tests/council/run-seat-tools-verify.test.js
'use strict';

/**
 * Ruling P2-R33 (council #247 round 2, C1): unit tests for the two pieces the
 * post-registration tripwire is built from — `verifyAgentRendering` (pure)
 * and `listEngineAgents` (mirrors run-server.js :: listEngineToolIds). The
 * three rule lists below are the measured 2026-09-12 renderings (opencode
 * 1.18.15) named in the spec: a clean council-seat, a tree-widened
 * council-support (the support attack), and a tree that re-lists a granted
 * key and moves it before the wildcard deny (the re-list attack).
 *
 * The runCouncil-level wiring (validateSeatToolsAgainstEngine calling these
 * before any Stage-1 launch) is pinned in tests/council/run-tools.test.js;
 * the real engine's own rendering is pinned in
 * tests/council-agents-engine.integration.test.js.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { verifyAgentRendering, listEngineAgents, verifyAgentFields } = require('../../src/council/run-seat-tools');
const {
  verificationDirectories, resolvePhysicalPath,
} = require('../../src/council/run-seat-tools-verify');

const CLEAN_SEAT = [
  { permission: '*', pattern: '*', action: 'deny' },
  { permission: 'read', pattern: '*', action: 'allow' },
  { permission: 'read', pattern: '*.env', action: 'deny' },
  { permission: 'read', pattern: '*.env.*', action: 'deny' },
  { permission: 'read', pattern: '*.envrc', action: 'deny' },
  { permission: 'webfetch', pattern: '*', action: 'allow' },
  { permission: 'edit', pattern: '*', action: 'deny' },
  { permission: 'bash', pattern: '*', action: 'deny' },
  { permission: 'external_directory', pattern: '*', action: 'deny' },
];

// P2-R44 (round 4, C4): T1's REAL measured rendering for a tree opencode.json
// = {"agent":{"council-seat":{"tools":{"*":false},"permission":{"read":
// {"*.env":"allow","*.env.*":"allow","*.envrc":"allow"}}}}} on council-seat —
// the server's VALUES win per sub-key (so the three patterns still say
// `deny`), but the TREE's sub-key ORDER wins, so the denies render BEFORE
// `read[*]=allow`. Under findLast, `.env`/`.env.*`/`.envrc` are all ALLOWED
// on the real engine even though every rule the pre-round-4 tripwire checked
// (existence, never position) is present.
const ENV_REORDER_ATTACK = [
  { permission: '*', pattern: '*', action: 'deny' },
  { permission: 'read', pattern: '*.env', action: 'deny' },
  { permission: 'read', pattern: '*.env.*', action: 'deny' },
  { permission: 'read', pattern: '*.envrc', action: 'deny' },
  { permission: 'read', pattern: '*', action: 'allow' },
  { permission: 'grep', pattern: '*', action: 'allow' },
  { permission: 'webfetch', pattern: '*', action: 'allow' },
  { permission: 'edit', pattern: '*', action: 'deny' },
  { permission: 'bash', pattern: '*', action: 'deny' },
  { permission: 'external_directory', pattern: '*', action: 'deny' },
];

// council-support: { tools: { "*": true, "task": true } } in a reviewed
// tree's own opencode.json — the tree-only `task` key keeps the TREE's
// position, after the tree's own `"*"`, so it renders after the server's
// `*=deny` and wins under the engine's findLast evaluation.
const SUPPORT_ATTACK = [
  { permission: '*', pattern: '*', action: 'deny' },
  { permission: 'task', pattern: '*', action: 'allow' },
  { permission: 'edit', pattern: '*', action: 'deny' },
  { permission: 'bash', pattern: '*', action: 'deny' },
  { permission: 'webfetch', pattern: '*', action: 'deny' },
  { permission: 'external_directory', pattern: '*', action: 'deny' },
];

// A tree that re-lists `read` moves the server's `read=allow` BEFORE the
// tree's own `"*"` (and so before `*=deny`) — the seat silently loses it.
const RELIST_ATTACK = [
  { permission: 'bash', pattern: '*', action: 'deny' },
  { permission: 'read', pattern: '*', action: 'allow' },
  { permission: 'read', pattern: '*.env', action: 'deny' },
  { permission: 'read', pattern: '*.env.*', action: 'deny' },
  { permission: 'read', pattern: '*.envrc', action: 'deny' },
  { permission: 'external_directory', pattern: '*', action: 'deny' },
  { permission: '*', pattern: '*', action: 'deny' },
  { permission: 'webfetch', pattern: '*', action: 'allow' },
  { permission: 'edit', pattern: '*', action: 'deny' },
];

describe('verifyAgentRendering (ruling P2-R33)', () => {
  test('the clean seat rendering (allowlist read+webfetch) is ok', () => {
    expect(verifyAgentRendering(CLEAN_SEAT, ['read', 'webfetch'])).toEqual({ ok: true });
  });

  test('the clean support rendering (allowlist []) is ok', () => {
    const support = [
      { permission: '*', pattern: '*', action: 'deny' },
      { permission: 'edit', pattern: '*', action: 'deny' },
      { permission: 'bash', pattern: '*', action: 'deny' },
      { permission: 'webfetch', pattern: '*', action: 'deny' },
      { permission: 'external_directory', pattern: '*', action: 'deny' },
    ];
    expect(verifyAgentRendering(support, [])).toEqual({ ok: true });
  });

  test('the support attack (a tree-widened council-support, allowlist []) is not ok, naming task', () => {
    const r = verifyAgentRendering(SUPPORT_ATTACK, []);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('task');
  });

  test('the re-list attack (a tree re-listing read moves its allow before the wildcard deny) is not ok, naming read', () => {
    const r = verifyAgentRendering(RELIST_ATTACK, ['read', 'webfetch']);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('read');
  });

  // P2-R44 (round 4, C4): order-verified read denies, not merely existence.
  test('P2-R44: the T1 env-reorder attack (denies render before the read allow) is not ok, naming .env', () => {
    const r = verifyAgentRendering(ENV_REORDER_ATTACK, ['grep', 'read', 'webfetch']);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('.env');
  });

  test('P2-R44: a read seat missing the .envrc deny after its read allow is not ok, naming .envrc', () => {
    const rules = [
      { permission: '*', pattern: '*', action: 'deny' },
      { permission: 'read', pattern: '*', action: 'allow' },
      { permission: 'read', pattern: '*.env', action: 'deny' },
      { permission: 'read', pattern: '*.env.*', action: 'deny' },
      { permission: 'webfetch', pattern: '*', action: 'allow' },
    ];
    const r = verifyAgentRendering(rules, ['read', 'webfetch']);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('.envrc');
  });

  // GRANTDENYBLIND target: a granted tool re-denied by a non-`.env` pattern
  // after its own allow must be refused, naming it — not waved through
  // because an earlier allow already satisfies the "at least one" check.
  test('P2-R44: grep[*]=allow then grep[*]=deny after the wildcard is not ok, naming grep', () => {
    const rules = [
      { permission: '*', pattern: '*', action: 'deny' },
      { permission: 'grep', pattern: '*', action: 'allow' },
      { permission: 'grep', pattern: '*', action: 'deny' },
    ];
    const r = verifyAgentRendering(rules, ['grep']);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('grep');
  });

  // The three SEAT_READ_DENY_PATTERNS denies are present and correctly
  // ordered here (so step 5 has nothing to say) — isolates step 3's
  // narrowing check as the ONLY thing that can catch `src/*`, so this test
  // reddens on GRANTDENYBLIND for the reason it names, not by accident.
  test('P2-R44: a narrowing read[src/*]=deny after the read allow is not ok, naming the pattern', () => {
    const rules = [
      { permission: '*', pattern: '*', action: 'deny' },
      { permission: 'read', pattern: '*', action: 'allow' },
      { permission: 'read', pattern: '*.env', action: 'deny' },
      { permission: 'read', pattern: '*.env.*', action: 'deny' },
      { permission: 'read', pattern: '*.envrc', action: 'deny' },
      { permission: 'read', pattern: 'src/*', action: 'deny' },
    ];
    const r = verifyAgentRendering(rules, ['read']);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('src/*');
  });

  test('P2-R44: a seat with allowlist [webfetch] and no read rules at all is still ok (step 5 only applies when read is granted)', () => {
    const rules = [
      { permission: '*', pattern: '*', action: 'deny' },
      { permission: 'webfetch', pattern: '*', action: 'allow' },
      { permission: 'edit', pattern: '*', action: 'deny' },
      { permission: 'bash', pattern: '*', action: 'deny' },
      { permission: 'external_directory', pattern: '*', action: 'deny' },
    ];
    expect(verifyAgentRendering(rules, ['webfetch'])).toEqual({ ok: true });
  });

  test('no wildcard deny at all is not ok', () => {
    expect(verifyAgentRendering([{ permission: 'read', pattern: '*', action: 'allow' }], ['read']))
      .toEqual({ ok: false, reason: 'no wildcard deny' });
  });

  test('the LAST */* rule governs: a */* allow after our own */* deny is "no wildcard deny", not ok', () => {
    const r = verifyAgentRendering([
      { permission: '*', pattern: '*', action: 'deny' },
      { permission: '*', pattern: '*', action: 'allow' },
    ], []);
    expect(r).toEqual({ ok: false, reason: 'no wildcard deny' });
  });

  // Ruling P2-R40 (A2/B2, round 3) narrowed this from "any specific
  // external_directory pattern is ignored" to "only the engine's OWN data
  // directory is ignored" — a tree could otherwise hide a widening allow
  // behind any path that merely LOOKED specific. Measured against the REAL
  // pinned engine (tests/council-agents-engine.integration.test.js): it
  // appends exactly one such rule after the agent block, for its own
  // tool-output cache under its own data directory
  // (`<home>/.local/share/opencode/tool-output/*`), sometimes AFTER our own
  // rules. buildCouncilAgents never emits `external_directory` with any
  // pattern but `*`, so this one is never OUR policy and must not read as a
  // widened agent — built here from the real `os.homedir()`, in its native
  // (backslash, on this platform) form.
  test('engine-injected external_directory noise for its OWN data dir, native-separator form, is ignored', () => {
    const enginePath = path.join(os.homedir(), '.local', 'share', 'opencode', 'tool-output', '*');
    const withNoise = [
      ...CLEAN_SEAT,
      { permission: 'external_directory', pattern: enginePath, action: 'allow' },
    ];
    expect(verifyAgentRendering(withNoise, ['read', 'webfetch'])).toEqual({ ok: true });
  });

  // Same directory, forward-slash form (the canonical `<home>/.local/share/
  // opencode/tool-output/*` notation this module's own docblock uses) —
  // compared case-insensitively/slash-insensitively, so either rendering of
  // the same real path is recognized.
  test('the same engine data dir, forward-slash form, is also ignored', () => {
    const enginePathFwd = `${os.homedir().replace(/\\/g, '/')}/.local/share/opencode/tool-output/*`;
    const withNoise = [
      ...CLEAN_SEAT,
      { permission: 'external_directory', pattern: enginePathFwd, action: 'allow' },
    ];
    expect(verifyAgentRendering(withNoise, ['read', 'webfetch'])).toEqual({ ok: true });
  });

  // Ruling P2-R40 (B2): a specific external_directory allow that is NOT
  // under the engine's own data directory is a widened rule like any other —
  // it must fail loudly, naming the pattern, not ride through as "noise".
  test('a specific external_directory allow OUTSIDE the engine data dir is not ok, naming it', () => {
    const withAttack = [...CLEAN_SEAT, { permission: 'external_directory', pattern: '/tmp/*', action: 'allow' }];
    const r = verifyAgentRendering(withAttack, ['read', 'webfetch']);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('/tmp/*');
  });

  // Ruling P2-R42 (round-3 nits, mutant XDGROOTDROP): the engine data dir is
  // resolved XDG-first, matching src/utils/auth-json.js :: authJsonCandidates
  // and src/utils/engine-log.js :: engineLogDirCandidates (same engine, same
  // data root) — not only the hard-coded ~/.local/share/opencode home form.
  test('P2-R42: an external_directory allow under $XDG_DATA_HOME/opencode is exempt when XDG_DATA_HOME is set', () => {
    const xdgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p2r42-xdg-'));
    const original = process.env.XDG_DATA_HOME;
    try {
      process.env.XDG_DATA_HOME = xdgDir;
      const pattern = path.join(xdgDir, 'opencode', 'tool-output', '*');
      expect(verifyAgentRendering(
        [...CLEAN_SEAT, { permission: 'external_directory', pattern, action: 'allow' }],
        ['read', 'webfetch'],
      )).toEqual({ ok: true });
    } finally {
      if (original === undefined) { delete process.env.XDG_DATA_HOME; } else { process.env.XDG_DATA_HOME = original; }
      fs.rmSync(xdgDir, { recursive: true, force: true });
    }
  });

  test('P2-R42: the SAME $XDG_DATA_HOME-shaped pattern is NOT exempt once XDG_DATA_HOME is unset', () => {
    const original = process.env.XDG_DATA_HOME;
    try {
      delete process.env.XDG_DATA_HOME;
      const pattern = path.join(os.tmpdir(), 'p2r42-xdg-unset-fixture', 'opencode', 'tool-output', '*');
      const r = verifyAgentRendering(
        [...CLEAN_SEAT, { permission: 'external_directory', pattern, action: 'allow' }],
        ['read', 'webfetch'],
      );
      expect(r.ok).toBe(false);
      expect(r.reason).toContain('tool-output');
    } finally {
      if (original === undefined) { delete process.env.XDG_DATA_HOME; } else { process.env.XDG_DATA_HOME = original; }
    }
  });

  test('P2-R42: the ~/.local/share/opencode home form is still exempt with XDG_DATA_HOME unset', () => {
    const original = process.env.XDG_DATA_HOME;
    try {
      delete process.env.XDG_DATA_HOME;
      const pattern = path.join(os.homedir(), '.local', 'share', 'opencode', 'tool-output', '*');
      expect(verifyAgentRendering(
        [...CLEAN_SEAT, { permission: 'external_directory', pattern, action: 'allow' }],
        ['read', 'webfetch'],
      )).toEqual({ ok: true });
    } finally {
      if (original === undefined) { delete process.env.XDG_DATA_HOME; } else { process.env.XDG_DATA_HOME = original; }
    }
  });

  // P2-R45 (round 4, B1/C1, mutant EXEMPTBROAD): the exemption is narrowed to
  // the data root's `tool-output/` subdirectory only — a sibling directory
  // under the SAME data root (which also holds the engine's `auth.json`) is
  // a widened rule like any other, not "noise".
  test('P2-R45: an external_directory allow under the home data root but NOT tool-output (e.g. secrets) is not ok, naming it', () => {
    const pattern = path.join(os.homedir(), '.local', 'share', 'opencode', 'secrets', '*');
    const r = verifyAgentRendering(
      [...CLEAN_SEAT, { permission: 'external_directory', pattern, action: 'allow' }],
      ['read', 'webfetch'],
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('secrets');
  });

  test('P2-R45: the same holds under $XDG_DATA_HOME — a secrets sibling of tool-output is not ok', () => {
    const xdgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p2r45-xdg-'));
    const original = process.env.XDG_DATA_HOME;
    try {
      process.env.XDG_DATA_HOME = xdgDir;
      const pattern = path.join(xdgDir, 'opencode', 'secrets', '*');
      const r = verifyAgentRendering(
        [...CLEAN_SEAT, { permission: 'external_directory', pattern, action: 'allow' }],
        ['read', 'webfetch'],
      );
      expect(r.ok).toBe(false);
      expect(r.reason).toContain('secrets');
    } finally {
      if (original === undefined) { delete process.env.XDG_DATA_HOME; } else { process.env.XDG_DATA_HOME = original; }
      fs.rmSync(xdgDir, { recursive: true, force: true });
    }
  });

  // Ruling P2-R36 (round 2, check (b)): an ask cannot be answered by a headless
  // leg, so an allowlisted id rendered `ask` (not `allow`) after the wildcard
  // deny must fail loudly, not ride through because its pattern/permission
  // matched the allowlist.
  test('an allowlisted id rendered ask (not allow) after the wildcard deny is not ok, naming it', () => {
    const withAsk = [...CLEAN_SEAT, { permission: 'read', pattern: '*', action: 'ask' }];
    const r = verifyAgentRendering(withAsk, ['read', 'webfetch']);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('read');
  });
});

// Ruling P2-R53 (council #247 round 6, B1): a rendered council agent's
// NON-permission surface — verifyAgentRendering above only ever checked
// `permission`. The clean fixture is the measured 2026-09-13 shape
// (probe-r6.js / probe-r6-out.json's "clean" object).
describe('verifyAgentFields (ruling P2-R53)', () => {
  const clean = () => ({
    name: 'council-seat', mode: 'primary', native: false, hidden: null, topP: null,
    temperature: null, color: null, variant: null, prompt: null, options: {}, steps: null,
    permission: [],
  });

  test('a clean rendering is ok', () => {
    expect(verifyAgentFields(clean())).toEqual({ ok: true });
  });

  test('a model set (tree-injected) is not ok, naming model', () => {
    const r = verifyAgentFields({ ...clean(), model: { providerID: 'openrouter', modelID: 'x' } });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('model');
  });

  test('a prompt set is not ok, naming prompt', () => {
    const r = verifyAgentFields({ ...clean(), prompt: 'x' });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('prompt');
  });

  test('options carrying a key is not ok, naming the key', () => {
    const r = verifyAgentFields({ ...clean(), options: { reasoning: 'high' } });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('reasoning');
  });

  test('mode other than primary is not ok, naming mode', () => {
    const r = verifyAgentFields({ ...clean(), mode: 'subagent' });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('mode');
  });

  test('temperature set is not ok, naming temperature', () => {
    const r = verifyAgentFields({ ...clean(), temperature: 0.3 });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('temperature');
  });

  test('a native agent is not ok, naming it, even with every other field clean', () => {
    const r = verifyAgentFields({ ...clean(), native: true });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('native');
  });

  // The measured probe-r6-out.json "tree" fixture: a tree sets prompt, model,
  // temperature, topP and options together, but the server had already set
  // prompt/temperature (so those two survive as the SERVER's own values,
  // unchanged) — model is the first genuinely tree-controlled field in check
  // order, so it is the named offender, not prompt.
  test('the measured tree-attack rendering is not ok, naming model (the first offender in check order)', () => {
    const r = verifyAgentFields({
      ...clean(),
      topP: 0.5, temperature: 0.3, color: '#ff0000',
      model: { modelID: 'deepseek/deepseek-v4-flash-0731', providerID: 'openrouter' },
      prompt: 'PREEXISTING-AMICUS-PROMPT', options: { reasoning: 'high' },
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('model');
  });

  // Fields simply ABSENT (no key at all, not even set to null) must be
  // treated exactly like a clean rendering — a real engine response may omit
  // a key entirely rather than sending it as null (`model` is absent, per
  // the brief, on a clean rendering that has none configured).
  test('an object with the checked fields simply absent (not even null) is ok', () => {
    expect(verifyAgentFields({ name: 'council-seat', mode: 'primary', permission: [] })).toEqual({ ok: true });
  });
});

describe('listEngineAgents (mirrors run-server.js :: listEngineToolIds)', () => {
  test('returns the agents the engine lists, scoped to the directory', async () => {
    const calls = [];
    const shared = {
      serverClient: { app: { agents: async (args) => { calls.push(args); return { data: [{ name: 'council-seat' }] }; } } },
    };
    expect(await listEngineAgents(shared, '/proj')).toEqual([{ name: 'council-seat' }]);
    expect(calls[0]).toEqual({ query: { directory: '/proj' } });
  });

  test('returns null (never throws) with no server, no app namespace, a throw, or a non-array', async () => {
    expect(await listEngineAgents(null, '/p')).toBeNull();
    expect(await listEngineAgents({ serverClient: {} }, '/p')).toBeNull();
    expect(await listEngineAgents({ serverClient: { app: { agents: async () => { throw new Error('404'); } } } }, '/p')).toBeNull();
    expect(await listEngineAgents({ serverClient: { app: { agents: async () => ({ data: 'nope' }) } } }, '/p')).toBeNull();
  });
});

// Ruling P2-R39 (A1, round 3): the support legs (judges, debate, chair) run
// with `project: <runDir>/_scratch` — a directory that does not exist yet at
// verification time, since run-stage2.js only creates it once Stage 2
// actually starts. Named mutant SCRATCHUNCHECKED: reverting to the pre-P2-R39
// set (`[o.runDir, ...(local ? [o.project] : [])]`) drops `_scratch` from the
// return value here, and reddens run-tools.test.js's "_scratch" pins (the
// directory-recording test, and the attack-only-in-_scratch refusal).
describe('verificationDirectories (ruling P2-R39)', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-dirs-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  test('a non-local run: the run dir and its _scratch subdirectory, deduplicated', () => {
    const runDir = path.join(tmp, 'run1');
    const dirs = verificationDirectories({ runDir, seatToolsLocal: false });
    expect(dirs).toEqual([runDir, path.join(runDir, '_scratch')]);
  });

  test('a local run: the run dir, _scratch, and the project tree', () => {
    const runDir = path.join(tmp, 'run2');
    const project = path.join(tmp, 'proj2');
    const dirs = verificationDirectories({ runDir, project, seatToolsLocal: true });
    expect(dirs).toEqual([runDir, path.join(runDir, '_scratch'), project]);
  });

  test('creates _scratch when absent, so the engine has a real directory to answer for', () => {
    const runDir = path.join(tmp, 'run3');
    fs.mkdirSync(runDir, { recursive: true });
    const scratchDir = path.join(runDir, '_scratch');
    expect(fs.existsSync(scratchDir)).toBe(false);
    verificationDirectories({ runDir, seatToolsLocal: false });
    expect(fs.existsSync(scratchDir)).toBe(true);
  });

  test('never throws when _scratch already exists', () => {
    const runDir = path.join(tmp, 'run4');
    fs.mkdirSync(path.join(runDir, '_scratch'), { recursive: true });
    expect(() => verificationDirectories({ runDir, seatToolsLocal: false })).not.toThrow();
  });
});

// Ruling P2-R54 (council #247 round 6, C1): resolvePhysicalPath walks up to
// the deepest EXISTING ancestor and resolves THAT through fs.realpathSync.native,
// so a not-yet-created run directory reached through a symlink/junction still
// resolves through it.
describe('resolvePhysicalPath (ruling P2-R54)', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-phys-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  test('a non-existent deep path under a temp dir resolves to <realpath(tmp)>/<tail>', () => {
    const deep = path.join(tmp, 'a', 'b', 'c');
    const expected = path.join(fs.realpathSync.native(tmp), 'a', 'b', 'c');
    expect(resolvePhysicalPath(deep)).toBe(expected);
  });

  test('a path whose root does not exist is returned unchanged', () => {
    // path.dirname of a root returns the root itself (fixed point) — the
    // walk-up loop detects that and bails out, returning the input verbatim,
    // whether or not this particular root happens to exist on this machine.
    const bogusRoot = process.platform === 'win32'
      ? 'Q:\\amicus-round6-does-not-exist\\nested\\deep'
      : '/amicus-round6-does-not-exist-xyz/nested/deep';
    const rootPiece = process.platform === 'win32' ? 'Q:\\' : '/amicus-round6-does-not-exist-xyz';
    if (fs.existsSync(rootPiece)) { return; } // moot on a machine where this exists; harmless either way
    expect(resolvePhysicalPath(bogusRoot)).toBe(bogusRoot);
  });

  // Symlink/junction capability is probed once, synchronously, at
  // collection time — `test.skip` must be chosen before any test body runs.
  // Junctions need no elevated privilege on Windows NTFS, so this should
  // pass on an ordinary dev box; skips (rather than fails) where the OS or
  // filesystem refuses it.
  let canSymlink = true;
  {
    const probeParent = fs.mkdtempSync(path.join(os.tmpdir(), 'symlink-probe-'));
    const probeTarget = path.join(probeParent, 'target');
    fs.mkdirSync(probeTarget);
    try {
      fs.symlinkSync(probeTarget, path.join(probeParent, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
    } catch {
      canSymlink = false;
    }
    fs.rmSync(probeParent, { recursive: true, force: true });
  }

  (canSymlink ? test : test.skip)('a path under a junction/symlink resolves to the target', () => {
    const target = path.join(tmp, 'inner');
    fs.mkdirSync(target);
    const link = path.join(tmp, 'link');
    fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
    const nested = path.join(link, 'file.txt');
    expect(resolvePhysicalPath(nested)).toBe(path.join(fs.realpathSync.native(target), 'file.txt'));
  });
});
