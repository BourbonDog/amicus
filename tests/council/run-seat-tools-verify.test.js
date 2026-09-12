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
const { verifyAgentRendering, listEngineAgents } = require('../../src/council/run-seat-tools');
const { verificationDirectories } = require('../../src/council/run-seat-tools-verify');

const CLEAN_SEAT = [
  { permission: '*', pattern: '*', action: 'deny' },
  { permission: 'read', pattern: '*', action: 'allow' },
  { permission: 'read', pattern: '*.env', action: 'deny' },
  { permission: 'read', pattern: '*.env.*', action: 'deny' },
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
