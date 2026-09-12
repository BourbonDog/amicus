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

const { verifyAgentRendering, listEngineAgents } = require('../../src/council/run-seat-tools');

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

  // Measured against the REAL pinned engine (tests/council-agents-engine.
  // integration.test.js): it appends `external_directory` allows for its own
  // paths (a tool-output cache dir, the machine's opencode config dirs) with
  // a SPECIFIC pattern, sometimes AFTER our own rules. buildCouncilAgents
  // never emits `external_directory` with any pattern but `*`, so these are
  // never our policy and must not read as a widened agent.
  test('engine-injected external_directory noise (a specific path, not "*") after our own rules is ignored', () => {
    const withNoise = [
      ...CLEAN_SEAT,
      { permission: 'external_directory', pattern: 'C:\\Users\\x\\.local\\share\\opencode\\tool-output\\*', action: 'allow' },
    ];
    expect(verifyAgentRendering(withNoise, ['read', 'webfetch'])).toEqual({ ok: true });
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
