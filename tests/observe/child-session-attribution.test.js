'use strict';

/**
 * v4.4.1 CA-1 — end-to-end wiring: runHeadless walks its leg's CHILD sessions
 * and hands the measured spend back on the result AND on the terminal
 * progress.json the live GUI reads.
 *
 * The measured defect this closes (from OpenCode's own DB, `wsgate01-s1-2` and
 * `wsgate02-s1-3`): a `task` call spawns a child session, OpenCode bills it
 * separately and does not roll it into the parent's cost, and amicus never
 * asked. $0.492506 across four recorded paid runs was invisible to every total
 * the product prints — including on `wsgate01`, which reported `costExact: true`
 * while 7.1% short.
 *
 * The unit-level rules live in tests/sidecar/child-sessions.test.js; this file
 * pins the SEAM: that headless actually calls the walk, before the server
 * closes, and that both channels carry the answer.
 */

const fs = require('fs');

jest.mock('fs', () => ({
  existsSync: jest.fn(() => true),
  mkdirSync: jest.fn(),
  appendFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  unlinkSync: jest.fn(),
  renameSync: jest.fn(),
  rmSync: jest.fn(),
  readFileSync: jest.fn(() => JSON.stringify({ status: 'running' })),
}));

const mockCreateSession = jest.fn();
const mockSendPromptAsync = jest.fn();
const mockGetMessages = jest.fn();
const mockGetChildren = jest.fn();
const mockCheckHealth = jest.fn();
const mockStartServer = jest.fn();
const mockAbortSession = jest.fn();
const mockGetSessionStatus = jest.fn();

jest.mock('../../src/opencode-client', () => ({
  createSession: mockCreateSession,
  sendPrompt: mockSendPromptAsync,
  sendPromptAsync: mockSendPromptAsync,
  getMessages: mockGetMessages,
  getChildren: mockGetChildren,
  checkHealth: mockCheckHealth,
  startServer: mockStartServer,
  abortSession: mockAbortSession,
  getSessionStatus: mockGetSessionStatus,
}));

const mockLogger = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() };
jest.mock('../../src/utils/logger', () => ({ logger: mockLogger }));

const { runHeadless } = require('../../src/headless');
const { buildFoldMarker } = require('../../src/utils/fold-marker');

const NONCE = 'childsessionnonce99';
const MARKER = buildFoldMarker(NONCE);
const MODEL = 'openrouter/qwen/qwen3.7-max';
const OPTS = { nonce: NONCE, pollIntervalMs: 5, stableFinishedPolls: 1, stableIdlePolls: 3 };

const toolPart = (id, tool) => ({
  id, callID: `call_${id}`, type: 'tool', tool,
  state: { status: 'completed', input: { description: 'explore' }, output: 'ok', title: tool, time: { start: 1, end: 2 } },
});
const textPart = (id, text) => ({ id, type: 'text', text });
const msg = (id, parts, { cost, tokens } = {}) => ({
  info: {
    role: 'assistant', id, time: { created: 1, completed: 2 },
    ...(cost !== undefined ? { cost } : {}),
    ...(tokens !== undefined ? { tokens } : {}),
  },
  parts,
});

/** The terminal progress.json payload (the last one written). */
function terminalProgress() {
  const writes = fs.writeFileSync.mock.calls
    .filter((c) => typeof c[0] === 'string' && c[0].includes('progress.json'))
    .map((c) => JSON.parse(c[1]));
  return writes[writes.length - 1];
}

const PARENT_TOKENS = { input: 5000, output: 400, reasoning: 0, cache: { read: 0, write: 0 } };

beforeEach(() => {
  jest.clearAllMocks();
  fs.existsSync.mockReturnValue(true);
  fs.readFileSync.mockReturnValue(JSON.stringify({ status: 'running' }));
  mockCheckHealth.mockResolvedValue(true);
  mockCreateSession.mockResolvedValue('ses_parent');
  mockSendPromptAsync.mockResolvedValue(undefined);
  mockAbortSession.mockResolvedValue(undefined);
  mockGetSessionStatus.mockResolvedValue({ type: 'idle' });
  mockGetChildren.mockResolvedValue([]);
  mockStartServer.mockResolvedValue({
    client: {}, server: { url: 'http://127.0.0.1:1', close: jest.fn() },
  });
});

describe('a leg that spawned a subagent gets its child spend back', () => {
  test('THE RECOVERY: the child session cost rides home on the result', async () => {
    mockGetMessages.mockImplementation(async (_c, id) => (id === 'ses_kid'
      ? [msg('k1', [], { cost: 0.021460, tokens: { input: 9000, output: 700, cache: { read: 0, write: 0 } } })]
      : [msg('m1', [textPart('t', `review\n${MARKER}\n`), toolPart('p1', 'task')], {
        cost: 0.28211, tokens: PARENT_TOKENS,
      })]));
    mockGetChildren.mockImplementation(async (_c, id) => (id === 'ses_parent' ? [{ id: 'ses_kid' }] : []));

    const r = await runHeadless(MODEL, 'sys', 'user', 'kid1', '/proj', 60000, 'build', OPTS);

    expect(r.completed).toBe(true);
    expect(r.subagentToolCalls).toBe(1);
    expect(r.subtree).toMatchObject({ sessions: 1, unknown: false });
    expect(r.subtree.costReported).toBeCloseTo(0.021460, 10);
    // The leg's own usage is untouched — attribution is additive, never a merge.
    expect(r.usage.costReported).toBeCloseTo(0.28211, 10);
  });

  test('the terminal progress record carries it too (the live GUI reads that file)', async () => {
    mockGetMessages.mockImplementation(async (_c, id) => (id === 'ses_kid'
      ? [msg('k1', [], { cost: 0.5, tokens: { input: 10, output: 1, cache: { read: 0, write: 0 } } })]
      : [msg('m1', [textPart('t', `review\n${MARKER}\n`), toolPart('p1', 'task')], {
        cost: 0.1, tokens: PARENT_TOKENS,
      })]));
    mockGetChildren.mockImplementation(async (_c, id) => (id === 'ses_parent' ? [{ id: 'ses_kid' }] : []));

    await runHeadless(MODEL, 'sys', 'user', 'kid2', '/proj', 60000, 'build', OPTS);

    const p = terminalProgress();
    expect(p.stage).toBe('complete');
    expect(p.usage.subtree).toMatchObject({ sessions: 1 });
    expect(p.usage.subtree.costReported).toBeCloseTo(0.5, 10);
    expect(p.usage.subtreeUnknown).toBeUndefined();
  });

  test('the walk is directory-scoped when the leg is (#47 / LC-7)', async () => {
    mockGetMessages.mockResolvedValue([msg('m1', [textPart('t', `done\n${MARKER}\n`)], {
      cost: 0.01, tokens: PARENT_TOKENS,
    })]);
    await runHeadless(MODEL, 'sys', 'user', 'kid3', '/proj', 60000, 'build',
      { ...OPTS, directory: '/proj' });
    expect(mockGetChildren).toHaveBeenCalledWith({}, 'ses_parent', '/proj');
  });
});

describe('what could not be walked stays UNKNOWN — never a fabricated zero', () => {
  test('a `task` leg whose walk fails reports subtree unknown and invents no number', async () => {
    mockGetMessages.mockResolvedValue([msg('m1', [textPart('t', `review\n${MARKER}\n`), toolPart('p1', 'task')], {
      cost: 0.28211, tokens: PARENT_TOKENS,
    })]);
    mockGetChildren.mockRejectedValue(new Error('404 not found'));

    const r = await runHeadless(MODEL, 'sys', 'user', 'kid4', '/proj', 60000, 'build', OPTS);

    expect(r.subtree).toMatchObject({ sessions: 0, costReported: 0, unknown: true });
    expect(terminalProgress().usage.subtreeUnknown).toBe(true);
    expect(terminalProgress().usage.subtree).toBeUndefined(); // no zero-valued block
  });

  test('a `task` leg whose walk finds NO child is unknown — the readings disagree', async () => {
    mockGetMessages.mockResolvedValue([msg('m1', [textPart('t', `review\n${MARKER}\n`), toolPart('p1', 'task')], {
      cost: 0.1, tokens: PARENT_TOKENS,
    })]);
    mockGetChildren.mockResolvedValue([]);

    const r = await runHeadless(MODEL, 'sys', 'user', 'kid5', '/proj', 60000, 'build', OPTS);
    expect(r.subtree.unknown).toBe(true);
  });

  test('CRYING WOLF GUARD: an ordinary leg on a server with no children endpoint is NOT flagged', async () => {
    // The regression that would make this feature worse than useless: an
    // OpenCode build that 404s /session/{id}/children would otherwise mark
    // every leg of every run inexact forever.
    mockGetMessages.mockResolvedValue([msg('m1', [textPart('t', `done\n${MARKER}\n`)], {
      cost: 0.05, tokens: PARENT_TOKENS,
    })]);
    mockGetChildren.mockRejectedValue(new Error('404 not found'));

    const r = await runHeadless(MODEL, 'sys', 'user', 'kid6', '/proj', 60000, 'build', OPTS);
    expect(r.subtree.unknown).toBe(false);
    expect(r.subagentToolCalls).toBeUndefined();
    expect(terminalProgress().usage.subtreeUnknown).toBeUndefined();
  });

  test('CA-5 closed in the other direction: a tool merely NAMED `task` that spawns nothing…', async () => {
    // …still reports unknown, because we cannot tell "spawned nothing" from
    // "the walk missed it". Erring toward honesty is the documented posture —
    // and unlike the old proxy, a walk that DOES find and price the child now
    // clears the flag (proven by THE RECOVERY above), which the proxy could
    // never do.
    mockGetMessages.mockResolvedValue([msg('m1', [textPart('t', `done\n${MARKER}\n`), toolPart('p1', 'task')], {
      cost: 0.05, tokens: PARENT_TOKENS,
    })]);
    mockGetChildren.mockResolvedValue([]);
    const r = await runHeadless(MODEL, 'sys', 'user', 'kid7', '/proj', 60000, 'build', OPTS);
    expect(r.subtree.unknown).toBe(true);
  });
});
