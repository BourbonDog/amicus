'use strict';

/**
 * v4.4.1 CA-1 (B4) — child-session (subagent) spend enumeration.
 *
 * A leg that calls the `task` tool spawns a CHILD OpenCode session. Its spend is
 * billed separately, is NOT rolled into the parent session's `cost`, and was
 * never enumerated by amicus — so it was invisible to every total the product
 * prints. Measured across the four recorded paid runs: **$0.492506**
 * ($0.021460 in `wsgate01`, $0.471046 in `wsgate02`). `wsgate01` is the honest
 * limit case: every leg reported tokens, `unpricedLegs: 0`, `costExact: true`,
 * and the run was still 7.1% short — 100% of the gap was one `explore` child.
 *
 * Both prior blockers are closed. The client capability already existed
 * (`getChildren`, src/opencode-client.js — only `directory` scoping was
 * missing, LC-7), and the premature-completion fix (`dcb0792`) means a `task`
 * part goes terminal only when its child session ends, so enumerating at
 * finalization no longer captures a silent floor.
 *
 * THE HONESTY RULE these tests exist to pin: never fabricate a number. A subtree
 * we could not fully walk, or a child whose spend we cannot state, is reported
 * as UNKNOWN (`complete: false` -> the leg's existing `subtreeUnknown` flag),
 * never as zero.
 */

const { collectSubtreeUsage, subtreeIsUnknown, SUBTREE_MAX_DEPTH, SUBTREE_MAX_SESSIONS } =
  require('../../src/sidecar/child-sessions');

/** An assistant message carrying a finalized usage payload. */
const billed = (id, cost, input = 100, output = 20) => ({
  info: { id, role: 'assistant', cost, tokens: { input, output, reasoning: 0, cache: { read: 0, write: 0 } } },
  parts: [],
});

/**
 * A fake OOencode client over a {parentId: [childIds]} map plus a
 * {sessionId: messages} map. Counts calls so the bounds can be asserted.
 */
function fakeClient({ children = {}, messages = {}, failChildrenFor = [], failMessagesFor = [] } = {}) {
  const calls = { children: [], messages: [] };
  return {
    calls,
    session: {
      children: async ({ path: p, query }) => {
        calls.children.push({ id: p.id, directory: query && query.directory });
        if (failChildrenFor.includes(p.id)) { throw new Error('boom'); }
        return { data: (children[p.id] || []).map((id) => ({ id })) };
      },
      messages: async ({ path: p, query }) => {
        calls.messages.push({ id: p.id, directory: query && query.directory });
        if (failMessagesFor.includes(p.id)) { throw new Error('boom'); }
        return { data: messages[p.id] || [] };
      },
    },
  };
}

describe('collectSubtreeUsage — the measured wsgate01/wsgate02 case', () => {
  test('one @explore child: its cost is attributed and the subtree is COMPLETE', async () => {
    const client = fakeClient({
      children: { root: ['kid'] },
      messages: { kid: [billed('k1', 0.021460)] },
    });
    const r = await collectSubtreeUsage(client, 'root', {});
    expect(r.complete).toBe(true);
    expect(r.sessions).toHaveLength(1);
    expect(r.sessions[0].id).toBe('kid');
    expect(r.costReported).toBeCloseTo(0.021460, 10);
    expect(r.tokens.input).toBe(100);
  });

  test('several messages in one child are summed, not last-write-wins', async () => {
    const client = fakeClient({
      children: { root: ['kid'] },
      messages: { kid: [billed('k1', 0.30), billed('k2', 0.171046)] },
    });
    const r = await collectSubtreeUsage(client, 'root', {});
    expect(r.costReported).toBeCloseTo(0.471046, 10);
    expect(r.tokens.input).toBe(200);
  });

  test('no children at all: complete, zero, and NOT flagged unknown', async () => {
    const r = await collectSubtreeUsage(fakeClient({}), 'root', {});
    expect(r).toMatchObject({ complete: true, costReported: 0 });
    expect(r.sessions).toEqual([]);
  });
});

describe('the walk is bounded and cycle-proof', () => {
  test('a grandchild is reached and summed', async () => {
    const client = fakeClient({
      children: { root: ['a'], a: ['b'] },
      messages: { a: [billed('m', 0.01)], b: [billed('m', 0.02)] },
    });
    const r = await collectSubtreeUsage(client, 'root', {});
    expect(r.sessions.map((s) => s.id).sort()).toEqual(['a', 'b']);
    expect(r.costReported).toBeCloseTo(0.03, 10);
    expect(r.complete).toBe(true);
  });

  test('a cycle terminates: each session is visited exactly once', async () => {
    const client = fakeClient({
      children: { root: ['a'], a: ['b'], b: ['a', 'root'] },
      messages: { a: [billed('m', 0.01)], b: [billed('m', 0.02)] },
    });
    const r = await collectSubtreeUsage(client, 'root', {});
    expect(r.sessions.map((s) => s.id).sort()).toEqual(['a', 'b']);
    expect(r.costReported).toBeCloseTo(0.03, 10); // 'a' is not counted twice
    expect(client.calls.messages.filter((c) => c.id === 'a')).toHaveLength(1);
  });

  test('exceeding the depth bound reports INCOMPLETE, keeping what it did measure', async () => {
    // A chain longer than SUBTREE_MAX_DEPTH.
    const children = { root: ['s0'] };
    const messages = {};
    for (let i = 0; i < SUBTREE_MAX_DEPTH + 3; i++) {
      children[`s${i}`] = [`s${i + 1}`];
      messages[`s${i}`] = [billed('m', 0.001)];
    }
    messages[`s${SUBTREE_MAX_DEPTH + 3}`] = [billed('m', 0.001)];
    const r = await collectSubtreeUsage(fakeClient({ children, messages }), 'root', {});
    expect(r.complete).toBe(false);
    expect(r.costReported).toBeGreaterThan(0);   // partial, and declared partial
    expect(r.sessions.length).toBeLessThanOrEqual(SUBTREE_MAX_SESSIONS);
  });

  test('exceeding the session cap reports INCOMPLETE', async () => {
    const kids = Array.from({ length: SUBTREE_MAX_SESSIONS + 5 }, (_, i) => `k${i}`);
    const messages = {};
    for (const k of kids) { messages[k] = [billed('m', 0.001)]; }
    const r = await collectSubtreeUsage(fakeClient({ children: { root: kids }, messages }), 'root', {});
    expect(r.complete).toBe(false);
    expect(r.sessions.length).toBeLessThanOrEqual(SUBTREE_MAX_SESSIONS);
  });
});

describe('anything we could not determine is UNKNOWN, never zero', () => {
  test('a getChildren failure marks the subtree incomplete rather than empty-and-exact', async () => {
    const r = await collectSubtreeUsage(fakeClient({ failChildrenFor: ['root'] }), 'root', {});
    expect(r.complete).toBe(false);
    expect(r.costReported).toBe(0);
    expect(r.sessions).toEqual([]);
  });

  test('a child whose messages cannot be read is incomplete, and the siblings still count', async () => {
    const client = fakeClient({
      children: { root: ['good', 'bad'] },
      messages: { good: [billed('m', 0.05)] },
      failMessagesFor: ['bad'],
    });
    const r = await collectSubtreeUsage(client, 'root', {});
    expect(r.complete).toBe(false);
    expect(r.costReported).toBeCloseTo(0.05, 10);
  });

  test('a child that reports tokens but no cost is UNKNOWN — the B2 rule, one level down', async () => {
    const client = fakeClient({
      children: { root: ['kid'] },
      messages: { kid: [{ info: { id: 'k', role: 'assistant', cost: 0, tokens: { input: 900, output: 30 } } }] },
    });
    const r = await collectSubtreeUsage(client, 'root', {});
    expect(r.complete).toBe(false);       // work happened; its price is not stateable
    expect(r.costReported).toBe(0);
    expect(r.sessions[0].priced).toBe(false);
  });

  test('a child with no messages at all cannot be claimed free either', async () => {
    const client = fakeClient({ children: { root: ['kid'] }, messages: { kid: [] } });
    const r = await collectSubtreeUsage(client, 'root', {});
    expect(r.complete).toBe(false);
    expect(r.costReported).toBe(0);
  });

  test('a per-call timeout does not throw out of the collector', async () => {
    const hang = { session: { children: () => new Promise(() => {}), messages: () => new Promise(() => {}) } };
    const r = await collectSubtreeUsage(hang, 'root', { callTimeoutMs: 20 });
    expect(r.complete).toBe(false);
    expect(r.sessions).toEqual([]);
  });
});

describe('subtreeIsUnknown — the calibration, which is the whole argument', () => {
  const u = (walkComplete, sessionsFound, subagentCalls) =>
    subtreeIsUnknown({ walkComplete, sessionsFound, subagentCalls });

  test('a clean walk that fully accounted for a subagent is KNOWN', () => {
    expect(u(true, 1, 1)).toBe(false);
  });

  test('an ordinary leg with no subagent and no children is KNOWN', () => {
    expect(u(true, 0, 0)).toBe(false);
  });

  test('a `task` call with no child found is UNKNOWN — the two readings disagree', () => {
    expect(u(true, 1 - 1, 1)).toBe(true);
  });

  test('a partial walk that DID find children is UNKNOWN', () => {
    expect(u(false, 2, 0)).toBe(true);
    expect(u(false, 2, 1)).toBe(true);
  });

  test('a failed walk on a leg that called `task` is UNKNOWN', () => {
    expect(u(false, 0, 1)).toBe(true);
  });

  test('CRYING WOLF GUARD: a failed walk with NO evidence of a subtree flags nothing', () => {
    // An OpenCode server that does not serve /session/{id}/children fails every
    // walk. `!walkComplete` alone would then mark every leg of every run
    // inexact forever — noise that trains the reader to ignore the flag on the
    // one run where it matters. No evidence, no claim: the pre-CA-1 behaviour.
    expect(u(false, 0, 0)).toBe(false);
  });
});

describe('LC-7: the walk is directory-scoped like every other per-session call', () => {
  test('directory is threaded into BOTH children and messages', async () => {
    const client = fakeClient({
      children: { root: ['kid'] },
      messages: { kid: [billed('k', 0.01)] },
    });
    await collectSubtreeUsage(client, 'root', { directory: '/proj' });
    expect(client.calls.children.every((c) => c.directory === '/proj')).toBe(true);
    expect(client.calls.messages.every((c) => c.directory === '/proj')).toBe(true);
  });

  test('omitting directory leaves the calls byte-for-byte un-scoped (v4.0 parity)', async () => {
    const client = fakeClient({ children: { root: ['kid'] }, messages: { kid: [billed('k', 0.01)] } });
    await collectSubtreeUsage(client, 'root', {});
    expect(client.calls.children[0].directory).toBeUndefined();
    expect(client.calls.messages[0].directory).toBeUndefined();
  });
});
