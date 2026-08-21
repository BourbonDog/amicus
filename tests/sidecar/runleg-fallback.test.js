'use strict';

// Mock the OpenCode transport so the NON-injected runSingleAttempt test drives
// the real setup->finalize extraction against a canned runHeadless result (no
// server). The injected-runOnce tests below never call runHeadless, so the mock
// is inert for them.
jest.mock('../../src/headless', () => ({
  runHeadless: jest.fn(async () => ({
    summary: 'ok', completed: true,
    usage: { tokens: { input: 100, output: 40 }, costReported: 0.03 },
  })),
  waitForServer: jest.fn(async () => true),
}));

const fs = require('fs');
const os = require('os');
const path = require('path');
const { runLegWithFallback, runSingleAttempt } = require('../../src/sidecar/fanout-leg');
const { readSpendRows } = require('../../src/utils/spend-ledger');
const { createEventTail, EVENTS_FILE } = require('../../src/observe/events');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'fb-')); }

describe('runLegWithFallback (spec 6.2)', () => {
  test('a 429 on the primary substitutes the next chain model and records the swap', async () => {
    const project = tmp();
    let call = 0;
    // fake single-attempt runner: first (opus) 429s, second (sonnet) completes
    const fakeRunOnce = async ({ model }) => {
      call += 1;
      if (model === 'anthropic/claude-opus-5') {
        return { legId: 'w1-1', status: 'error', model, reason: 'HTTP 429 Too Many Requests',
          usage: { tokens: { input: 50, output: 0 }, cost: { amount: 0.01, source: 'reported' } } };
      }
      return { legId: 'w1-1', status: 'complete', model,
        usage: { tokens: { input: 100, output: 60 }, cost: { amount: 0.03, source: 'reported' } } };
    };
    const doc = await runLegWithFallback({
      leg: { model: 'anthropic/claude-opus-5', modelInput: 'opus' }, legId: 'w1-1', waveId: 'w1', project,
      fallback: { enabled: true, maxSubstitutions: 2, chains: {} },
      catalog: [{ id: 'anthropic/claude-opus-5' }, { id: 'anthropic/claude-sonnet-5' }, { id: 'anthropic/claude-haiku-5' }],
    }, {
      runOnce: fakeRunOnce,
      // DE-ROT (correction 3): RouteResult is keyed by `.kind`, not `.ok` — a
      // fake missing `.kind` breaks the loop immediately and no substitution
      // ever happens. Return the real shape.
      resolveRoute: async ({ model }) => ({ kind: 'resolved', executableId: model, gateway: 'direct' }),
      spendDir: project,
    });

    expect(call).toBe(2);
    expect(doc.status).toBe('complete');
    expect(doc.fallback).toMatchObject({ from: 'anthropic/claude-opus-5', reason: 'rate-limit' });
    expect(doc.attempts).toHaveLength(2);
    // usage summed across attempts (nothing hidden)
    expect(doc.usage.tokens.input).toBe(150);

    // two ledger rows: failed original + substitute
    const rows = readSpendRows(project);
    const orig = rows.find(r => r.model === 'anthropic/claude-opus-5');
    const sub = rows.find(r => r.substitutedFor === 'anthropic/claude-opus-5');
    expect(orig.status).toBe('error');
    expect(sub.attempt).toBe(1);
    expect(sub.model).toBe('anthropic/claude-sonnet-5');

    // leg-fallback event emitted into the wave dir
    const { getSessionDir } = require('../../src/session-manager');
    const evs = createEventTail(path.join(getSessionDir(project, 'w1'), EVENTS_FILE)).poll();
    expect(evs.some(e => e.event === 'leg-fallback' && e.toModel === 'anthropic/claude-sonnet-5')).toBe(true);
  });

  test('an auth failure never substitutes (chain untouched)', async () => {
    const project = tmp();
    let call = 0;
    const fakeRunOnce = async ({ model }) => { call += 1; return { legId: 'w1-1', status: 'error', model, reason: '401 invalid api key' }; };
    const doc = await runLegWithFallback({
      leg: { model: 'anthropic/claude-opus-5', modelInput: 'opus' }, legId: 'w1-1', waveId: 'w1', project,
      fallback: { enabled: true, maxSubstitutions: 2, chains: {} }, catalog: [{ id: 'anthropic/claude-opus-5' }],
    }, {
      runOnce: fakeRunOnce,
      resolveRoute: async (x) => ({ kind: 'resolved', executableId: x.model, gateway: 'direct' }),
      spendDir: project,
    });
    expect(call).toBe(1);            // no substitution attempt
    expect(doc.status).toBe('error');
    expect(doc.fallback).toBeUndefined();
  });

  // D16 (v4.7 F8): stampLegAttribution (fanout-wave-io.js) stamps `l.tag` onto
  // every leg before runLeg/runLegWithFallback ever sees it — recordAttemptSpend
  // (fanout-leg-fallback.js) must carry that tag onto EVERY attempt's row,
  // substitute included (not just the primary).
  test('a tagged leg carries the tag on every attempt row, substitute included', async () => {
    const project = tmp();
    let call = 0;
    const fakeRunOnce = async ({ model }) => {
      call += 1;
      if (model === 'anthropic/claude-opus-5') {
        return { legId: 'w1-1', status: 'error', model, reason: 'HTTP 429 Too Many Requests',
          usage: { tokens: { input: 50, output: 0 }, cost: { amount: 0.01, source: 'reported' } } };
      }
      return { legId: 'w1-1', status: 'complete', model,
        usage: { tokens: { input: 100, output: 60 }, cost: { amount: 0.03, source: 'reported' } } };
    };
    await runLegWithFallback({
      leg: { model: 'anthropic/claude-opus-5', modelInput: 'opus', tag: 'sprint42' }, legId: 'w1-1', waveId: 'w1', project,
      fallback: { enabled: true, maxSubstitutions: 2, chains: {} },
      catalog: [{ id: 'anthropic/claude-opus-5' }, { id: 'anthropic/claude-sonnet-5' }],
    }, {
      runOnce: fakeRunOnce,
      resolveRoute: async ({ model }) => ({ kind: 'resolved', executableId: model, gateway: 'direct' }),
      spendDir: project,
    });
    expect(call).toBe(2);
    const rows = readSpendRows(project);
    expect(rows).toHaveLength(2);
    for (const row of rows) { expect(row.tag).toBe('sprint42'); }
  });

  // D16 convention pin: an untagged leg's attempt row carries tag:null.
  test('an untagged leg carries tag:null on its attempt row', async () => {
    const project = tmp();
    const fakeRunOnce = async ({ model }) => ({ legId: 'w1-1', status: 'complete', model,
      usage: { tokens: { input: 100, output: 60 }, cost: { amount: 0.03, source: 'reported' } } });
    await runLegWithFallback({
      leg: { model: 'anthropic/claude-opus-5', modelInput: 'opus' }, legId: 'w1-1', waveId: 'w1', project,
      fallback: { enabled: true, maxSubstitutions: 2, chains: {} },
      catalog: [{ id: 'anthropic/claude-opus-5' }],
    }, {
      runOnce: fakeRunOnce,
      resolveRoute: async ({ model }) => ({ kind: 'resolved', executableId: model, gateway: 'direct' }),
      spendDir: project,
    });
    const rows = readSpendRows(project);
    expect(rows).toHaveLength(1);
    expect('tag' in rows[0]).toBe(true);
    expect(rows[0].tag).toBeNull();
  });

  test('chain exhausted -> fails with the ORIGINAL error, attempts recorded', async () => {
    const project = tmp();
    const fakeRunOnce = async ({ model }) => ({ legId: 'w1-1', status: 'error', model, reason: '429 rate limit',
      usage: { tokens: { input: 10, output: 0 }, cost: { amount: 0.001, source: 'reported' } } });
    const doc = await runLegWithFallback({
      leg: { model: 'anthropic/claude-opus-5', modelInput: 'opus' }, legId: 'w1-1', waveId: 'w1', project,
      fallback: { enabled: true, maxSubstitutions: 1, chains: {} },
      catalog: [{ id: 'anthropic/claude-opus-5' }, { id: 'anthropic/claude-sonnet-5' }],
    }, {
      runOnce: fakeRunOnce,
      resolveRoute: async (x) => ({ kind: 'resolved', executableId: x.model, gateway: 'direct' }),
      spendDir: project,
    });
    expect(doc.status).toBe('error');
    expect(doc.attempts.length).toBe(2);   // primary + 1 substitution (capped)
  });
});

describe('runSingleAttempt (the real, non-injected setup->runHeadless->finalize extraction)', () => {
  test('runs a leg end-to-end with a mocked runHeadless, writes leg metadata, returns a run doc', async () => {
    const project = tmp();
    // fanout.js normally mkdir's the wave dir before any leg launches
    // (fanout.js step 2); replicate that here so emitLegStarted/
    // emitLegTerminal (which append into it) have somewhere to write.
    const { getSessionDir: getSessionDirSetup } = require('../../src/session-manager');
    fs.mkdirSync(getSessionDirSetup(project, 'w9'), { recursive: true });
    const doc = await runSingleAttempt({
      leg: { model: 'anthropic/claude-opus-5', modelInput: 'opus' },
      legId: 'w9-1', waveId: 'w9', project,
      systemPrompt: 'sys', userMessage: 'task', timeoutMs: 60000, agent: 'build',
      client: {}, server: {}, quiet: true,
    });

    // run document shape (buildRunResult) + fallback-classifier aliases
    expect(doc.type).toBe('run');
    expect(doc.status).toBe('complete');
    expect(doc.taskId).toBe('w9-1');
    expect(doc.legId).toBe('w9-1');        // exposed for the fallback loop
    expect(doc.reason).toBeNull();         // === doc.error; loop reads either
    expect(doc.usage.tokens.input).toBe(100);

    // the real extraction wrote the leg's metadata + initial context to disk
    const { getSessionDir } = require('../../src/session-manager');
    const legDir = getSessionDir(project, 'w9-1');
    const meta = JSON.parse(fs.readFileSync(path.join(legDir, 'metadata.json'), 'utf-8'));
    expect(meta.status).toBe('complete');
    expect(meta.parentWave).toBe('w9');
    expect(meta.modelInput).toBe('opus');
    expect(fs.existsSync(path.join(legDir, 'initial_context.md'))).toBe(true);
    expect(fs.readFileSync(path.join(legDir, 'summary.md'), 'utf-8')).toBe('ok');

    // runSingleAttempt does NOT append spend — that is the caller's job
    // (runLeg once; runLegWithFallback per attempt), so the ledger is untouched.
    expect(readSpendRows(project)).toEqual([]);

    // M9 (correction 1): the extraction must carry the leg-started/leg-terminal
    // emits forward — assert they land in the WAVE dir's events.jsonl.
    const waveEvents = createEventTail(path.join(getSessionDir(project, 'w9'), EVENTS_FILE)).poll();
    expect(waveEvents.some(e => e.event === 'leg-started' && e.legId === 'w9-1')).toBe(true);
    expect(waveEvents.some(e => e.event === 'leg-terminal' && e.legId === 'w9-1')).toBe(true);
  });

  // MUTANT SEATDROP (v4.8 R5 T4.3) — revert fanout-leg.js:101's write to drop
  // the `seat` key entirely:
  //   writeLegPatch(legDir, { parentWave: waveId, modelInput: leg.modelInput });
  // Hand-applied, measured, hand-reverted; `git diff --stat
  // src/sidecar/fanout-leg.js` was empty (byte-identical to HEAD) both before
  // applying and after reverting. Red set (1, exactly): 'writes the leg seat
  // into metadata.json when the leg carries one (v4.8 R5)' below —
  // `meta.seat` comes back `undefined` instead of `'opus#2'`. The seatless-leg
  // pin that follows it stays green under this mutant too: it asserts
  // ABSENCE, and the mutant never adds a seat key either — that is the
  // preservation half being vacuously true under the mutant, not a coverage
  // gap in this pin.
  test('writes the leg seat into metadata.json when the leg carries one (v4.8 R5)', async () => {
    const project = tmp();
    const { getSessionDir } = require('../../src/session-manager');
    fs.mkdirSync(getSessionDir(project, 'w10'), { recursive: true });
    await runSingleAttempt({
      leg: { model: 'anthropic/claude-opus-5', modelInput: 'opus', seat: 'opus#2' },
      legId: 'w10-1', waveId: 'w10', project,
      systemPrompt: 'sys', userMessage: 'task', timeoutMs: 60000, agent: 'build',
      client: {}, server: {}, quiet: true,
    });
    const meta = JSON.parse(fs.readFileSync(
      path.join(getSessionDir(project, 'w10-1'), 'metadata.json'), 'utf-8'));
    expect(meta.seat).toBe('opus#2');
  });

  test('a seatless leg leaves metadata.json without a seat key at all (v4.8 R5)', async () => {
    const project = tmp();
    const { getSessionDir } = require('../../src/session-manager');
    fs.mkdirSync(getSessionDir(project, 'w11'), { recursive: true });
    await runSingleAttempt({
      leg: { model: 'anthropic/claude-opus-5', modelInput: 'opus' },
      legId: 'w11-1', waveId: 'w11', project,
      systemPrompt: 'sys', userMessage: 'task', timeoutMs: 60000, agent: 'build',
      client: {}, server: {}, quiet: true,
    });
    const meta = JSON.parse(fs.readFileSync(
      path.join(getSessionDir(project, 'w11-1'), 'metadata.json'), 'utf-8'));
    expect('seat' in meta).toBe(false);
  });

  // v4.4 B4 — the two leg-level truth signals runHeadless now returns must reach
  // the leg's usage block and metadata.json, or they die with the process.
  test('a leg that made a SUBAGENT call is marked subtreeUnknown on its usage block', async () => {
    const project = tmp();
    const { getSessionDir } = require('../../src/session-manager');
    fs.mkdirSync(getSessionDir(project, 'w8'), { recursive: true });
    const { runHeadless } = require('../../src/headless');
    runHeadless.mockImplementationOnce(async () => ({
      summary: 'ok', completed: true, subagentToolCalls: 1,
      usage: { tokens: { input: 966589, output: 7228 }, costReported: 0.11210719 },
    }));

    const doc = await runSingleAttempt({
      leg: { model: 'openrouter/qwen/qwen3-coder-next', modelInput: 'qwen-coder' },
      legId: 'w8-1', waveId: 'w8', project,
      systemPrompt: 'sys', userMessage: 'task', timeoutMs: 60000, agent: 'build',
      client: {}, server: {}, quiet: true,
    });

    // The leg's OWN cost is a real reported figure — what is unknown is its subtree.
    expect(doc.usage.cost.source).toBe('reported');
    expect(doc.usage.cost.amount).toBeCloseTo(0.11210719, 10);
    expect(doc.usage.subtreeUnknown).toBe(true);
    const meta = JSON.parse(fs.readFileSync(path.join(getSessionDir(project, 'w8-1'), 'metadata.json'), 'utf-8'));
    expect(meta.usage.subtreeUnknown).toBe(true);
  });

  test('toolSettleTimedOut travels onto the leg metadata; a clean leg carries neither flag', async () => {
    const project = tmp();
    const { getSessionDir } = require('../../src/session-manager');
    fs.mkdirSync(getSessionDir(project, 'w7'), { recursive: true });
    const { runHeadless } = require('../../src/headless');
    runHeadless.mockImplementationOnce(async () => ({
      summary: 'partial', completed: true, toolSettleTimedOut: true,
      unsettledToolCalls: [{ id: 'p1', name: 'task', firstSeenAt: '2026-07-26T04:35:02.492Z' }],
      usage: { tokens: { input: 10, output: 5 }, costReported: 0.001 },
    }));
    await runSingleAttempt({
      leg: { model: 'openrouter/a/b', modelInput: 'a' }, legId: 'w7-1', waveId: 'w7', project,
      systemPrompt: 'sys', userMessage: 'task', timeoutMs: 60000, agent: 'build',
      client: {}, server: {}, quiet: true,
    });
    const meta = JSON.parse(fs.readFileSync(path.join(getSessionDir(project, 'w7-1'), 'metadata.json'), 'utf-8'));
    expect(meta.toolSettleTimedOut).toBe(true);
    expect(meta.status).toBe('complete'); // completed, not failed — fail loud, not closed

    // …and the default mocked result (no flags) leaves both fields off entirely.
    fs.mkdirSync(getSessionDir(project, 'w6'), { recursive: true });
    await runSingleAttempt({
      leg: { model: 'openrouter/a/b', modelInput: 'a' }, legId: 'w6-1', waveId: 'w6', project,
      systemPrompt: 'sys', userMessage: 'task', timeoutMs: 60000, agent: 'build',
      client: {}, server: {}, quiet: true,
    });
    const clean = JSON.parse(fs.readFileSync(path.join(getSessionDir(project, 'w6-1'), 'metadata.json'), 'utf-8'));
    expect(clean.toolSettleTimedOut).toBeUndefined();
    expect(clean.toolSettleAborted).toBeUndefined();
    expect(clean.usage.subtreeUnknown).toBeUndefined();
  });

  test('LC-2: toolSettleAborted travels onto the leg metadata — including `false`', async () => {
    const project = tmp();
    const { getSessionDir } = require('../../src/session-manager');
    const { runHeadless } = require('../../src/headless');
    const base = {
      summary: 'partial', completed: true, toolSettleTimedOut: true,
      unsettledToolCalls: [{ id: 'p1', name: 'task', firstSeenAt: '2026-07-26T04:35:02.492Z' }],
      usage: { tokens: { input: 10, output: 5 }, costReported: 0.001 },
    };
    const run = async (legId, waveId, patch) => {
      fs.mkdirSync(getSessionDir(project, waveId), { recursive: true });
      runHeadless.mockImplementationOnce(async () => ({ ...base, ...patch }));
      await runSingleAttempt({
        leg: { model: 'openrouter/a/b', modelInput: 'a' }, legId, waveId, project,
        systemPrompt: 'sys', userMessage: 'task', timeoutMs: 60000, agent: 'build',
        client: {}, server: {}, quiet: true,
      });
      return JSON.parse(fs.readFileSync(path.join(getSessionDir(project, legId), 'metadata.json'), 'utf-8'));
    };

    expect((await run('w5-1', 'w5', { toolSettleAborted: true })).toolSettleAborted).toBe(true);
    // The load-bearing half: `false` means "we tried to stop the session and
    // could not — it may still be billing" and must NOT be dropped as falsy.
    const failed = await run('w4-1', 'w4', { toolSettleAborted: false });
    expect(failed.toolSettleAborted).toBe(false);
    expect(failed.status).toBe('complete'); // a failed abort never demotes the leg
  });

  test('a thrown setup still resolves to an error run doc (never rejects)', async () => {
    const project = tmp();
    const { runHeadless } = require('../../src/headless');
    runHeadless.mockImplementationOnce(async () => { throw new Error('server exploded'); });
    const doc = await runSingleAttempt({
      leg: { model: 'anthropic/claude-opus-5', modelInput: 'opus' },
      legId: 'w9-2', waveId: 'w9', project,
      systemPrompt: 'sys', userMessage: 'task', timeoutMs: 60000, agent: 'build',
      client: {}, server: {}, quiet: true,
    });
    expect(doc.status).toBe('error');
    expect(doc.reason).toMatch(/server exploded/);
  });
});

/**
 * v4.4.1 A1 — the multi-attempt fold used to `return { tokens, cost }`, throwing
 * away every other key resolveUsage puts on a usage block. `subtreeUnknown` was
 * the casualty: a leg that fell back to a substitute AND left an unattributable
 * subagent subtree lost the flag, sumWaveUsage never counted it, and run.json
 * claimed `costExact: true` for a total that was a floor. Only fallback legs were
 * affected — the single-attempt path returns its usage verbatim.
 */
describe('sumAttemptUsage keeps every truth signal across a fallback', () => {
  const { sumAttemptUsage } = require('../../src/sidecar/fanout-leg-fallback');
  const att = (usage) => ({ model: 'm', status: 'complete', usage });

  test('a single attempt is returned verbatim (unchanged for non-fallback legs)', () => {
    const usage = { tokens: { input: 1 }, cost: { amount: 0.5, currency: 'USD', source: 'reported' },
      subtreeUnknown: true };
    expect(sumAttemptUsage([att(usage)])).toBe(usage);
  });

  test('no attempt with usage folds to null, not to a fabricated $0', () => {
    expect(sumAttemptUsage([])).toBeNull();
    expect(sumAttemptUsage([{ model: 'm', status: 'error', usage: null }])).toBeNull();
  });

  test('tokens and cost still SUM across attempts, mixed sources still tagged', () => {
    const folded = sumAttemptUsage([
      att({ tokens: { input: 50, output: 0 }, cost: { amount: 0.01, currency: 'USD', source: 'reported' } }),
      att({ tokens: { input: 100, output: 60 }, cost: { amount: 0.03, currency: 'USD', source: 'estimated' } }),
    ]);
    expect(folded.tokens).toEqual({ input: 150, output: 60 });
    expect(folded.cost.amount).toBeCloseTo(0.04, 10);
    expect(folded.cost.source).toBe('mixed');
  });

  test('attempts that report tokens but no cost fold to cost null — a sum of nothing is not $0', () => {
    const folded = sumAttemptUsage([att({ tokens: { input: 5 } }), att({ tokens: { input: 7 } })]);
    expect(folded.cost).toBeNull();
    expect(folded.tokens.input).toBe(12);
  });

  // THE BUG. Attempt 0 leaves an unattributable subtree, then the substitute
  // succeeds cleanly. The leg's total is a floor and must keep saying so.
  test('subtreeUnknown on ANY attempt survives the fold — a later clean attempt cannot erase it', () => {
    const folded = sumAttemptUsage([
      att({ tokens: { input: 50 }, cost: { amount: 0.01, currency: 'USD', source: 'reported' }, subtreeUnknown: true }),
      att({ tokens: { input: 100 }, cost: { amount: 0.03, currency: 'USD', source: 'reported' } }),
    ]);
    expect(folded.subtreeUnknown).toBe(true);
    // …and it reaches the wave rollup, which is where the lie actually surfaced.
    const { sumWaveUsage } = require('../../src/utils/pricing');
    expect(sumWaveUsage([{ usage: folded }]).cost.subtreeUnknownLegs).toBe(1);
  });

  test('the flag survives in either order, and stays OFF when no attempt set it', () => {
    const clean = att({ tokens: { input: 1 }, cost: { amount: 0.01, currency: 'USD', source: 'reported' } });
    const dirty = att({ tokens: { input: 1 }, cost: { amount: 0.01, currency: 'USD', source: 'reported' }, subtreeUnknown: true });
    expect(sumAttemptUsage([dirty, clean]).subtreeUnknown).toBe(true);
    expect(sumAttemptUsage([clean, dirty]).subtreeUnknown).toBe(true);
    expect(sumAttemptUsage([clean, clean]).subtreeUnknown).toBeUndefined();
  });

  test('measured child-session spend from EVERY attempt survives — last-wins would under-report', () => {
    const withSub = (amount, sessions) => att({ tokens: { input: 10 },
      cost: { amount: 0.01, currency: 'USD', source: 'reported' },
      subtree: { sessions, tokens: { input: 5 }, cost: { amount, currency: 'USD', source: 'reported' } } });
    const folded = sumAttemptUsage([withSub(0.4, 1), withSub(0.25, 2)]);
    expect(folded.subtree.sessions).toBe(3);
    expect(folded.subtree.tokens.input).toBe(10);
    expect(folded.subtree.cost.amount).toBeCloseTo(0.65, 10);
    expect(folded.subtree.cost.source).toBe('reported');
  });

  test('a subtree that exists but reported nothing stays unknown, never $0', () => {
    const folded = sumAttemptUsage([
      att({ tokens: { input: 10 }, cost: { amount: 0.01, currency: 'USD', source: 'reported' },
        subtree: { sessions: 1, tokens: {}, cost: { amount: null, currency: 'USD', source: 'unknown' } } }),
      att({ tokens: { input: 10 }, cost: { amount: 0.01, currency: 'USD', source: 'reported' } }),
    ]);
    expect(folded.subtree.cost).toEqual({ amount: null, currency: 'USD', source: 'unknown' });
  });

  test('any OTHER key on the usage block survives the fold instead of being dropped', () => {
    const folded = sumAttemptUsage([
      att({ tokens: { input: 1 }, cost: null, someFutureFact: 'kept' }),
      att({ tokens: { input: 1 }, cost: null }),
    ]);
    expect(folded.someFutureFact).toBe('kept');
  });
});
