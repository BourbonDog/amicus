'use strict';

/**
 * v4.4 Task 2 — `costExact: true` while the total is short.
 *
 * `council-wsgate01` reported `costExact: true` and was **$0.0215 short** of
 * OpenCode's own ledger. Root cause, reconciled leg-by-leg against the OpenCode
 * database (see the report for the queries):
 *
 *   amicus known  = $0.28211  (7 root sessions, EVERY one `source: 'reported'`)
 *   child session = $0.02146  (`ses_06374dcba`, agent `explore`, parent
 *                              `ses_063752792` = leg `wsgate01-s1-2`)
 *   OpenCode truth= $0.30357  ⇒ shortfall is 100.0% the child session.
 *
 * So this is NOT a rounding error, NOT a partial-usage leg, and NOT a
 * float-accumulation problem: every leg reported real tokens and a real billed
 * cost. The defect is the PREDICATE. `costExact` was computed as
 * `unknownLegs === 0` — i.e. "no leg reported zero usage" — which is a statement
 * about observation coverage of the LEG's own session, not about whether the
 * total is complete. Child-session spend is billed separately, is NOT rolled
 * into the parent's `session.cost`, and is never enumerated, so a fully-priced
 * run can be quietly short and still assert exactness.
 *
 * The fix: a leg that made a SUBAGENT (`task`) call has unattributed subtree
 * spend, and a total that omits it must not claim to be exact. Verified 1:1 on
 * the corpus — exactly 2 `task` tool calls across all 37 wsgate sessions, and
 * exactly 2 child sessions, each parented by the calling leg.
 */

const { resolveUsage, sumWaveUsage } = require('../../src/utils/pricing');
const { createBudget } = require('../../src/council/run-budget');
const recorded = require('../fixtures/v44-cost-replay/recorded-runs.json');

const legWith = (amount, extra = {}) => ({
  usage: { tokens: { input: 10, output: 5 }, cost: { amount, currency: 'USD', source: 'reported' }, ...extra },
});

describe('subtreeUnknown is carried on a leg usage block', () => {
  test('resolveUsage marks a leg whose subtree spend is unattributed', () => {
    const u = resolveUsage({
      model: 'openrouter/qwen/qwen3-coder-next',
      usageTotals: { tokens: { input: 966589, output: 7228 }, costReported: 0.11210719 },
      subtreeUnknown: true,
    });
    expect(u.cost).toEqual({ amount: 0.11210719, currency: 'USD', source: 'reported' });
    expect(u.subtreeUnknown).toBe(true);
  });

  test('the field is ABSENT (not false) when there is no subtree — byte-identical legacy shape', () => {
    const u = resolveUsage({
      model: 'openrouter/z-ai/glm-5.2',
      usageTotals: { tokens: { input: 3990, output: 2464 }, costReported: 0.02939432378 },
    });
    expect(Object.keys(u).sort()).toEqual(['cost', 'tokens']);
  });
});

describe('sumWaveUsage counts subtree-unknown legs separately from unpriced ones', () => {
  test('a fully-priced wave with one subtree-unknown leg', () => {
    const rolled = sumWaveUsage([
      legWith(0.01),
      legWith(0.02, { subtreeUnknown: true }),
      legWith(0.03),
    ]);
    expect(rolled.cost.unpricedLegs).toBe(0);       // every leg reported usage
    expect(rolled.cost.subtreeUnknownLegs).toBe(1); // …but one has a child session
    expect(rolled.cost.amount).toBeCloseTo(0.06, 10);
  });

  test('the two counts are independent — an unpriced leg is not a subtree leg', () => {
    const rolled = sumWaveUsage([
      { usage: { tokens: {}, cost: { amount: null, currency: 'USD', source: 'unknown' } } },
      legWith(0.02, { subtreeUnknown: true }),
    ]);
    expect(rolled.cost.unpricedLegs).toBe(1);
    expect(rolled.cost.subtreeUnknownLegs).toBe(1);
  });

  test('zero subtree legs reports 0, never undefined (stable shape for readers)', () => {
    expect(sumWaveUsage([legWith(0.01)]).cost.subtreeUnknownLegs).toBe(0);
  });
});

describe('costExact must be true ONLY when the total is genuinely complete', () => {
  test('THE BUG: a fully-priced run with an unattributed child session is NOT exact', () => {
    const legs = [legWith(0.01), legWith(0.02, { subtreeUnknown: true })];
    const b = createBudget({ allLegs: legs, maxCost: 0.5, write: () => {} });
    const block = b.usageBlock();
    expect(block.unknownLegs).toBe(0);          // the OLD predicate's answer
    expect(block.subtreeUnknownLegs).toBe(1);
    expect(block.costExact).toBe(false);        // the corrected flag
  });

  test('a run with neither unpriced nor subtree legs still reports exact', () => {
    const b = createBudget({ allLegs: [legWith(0.01), legWith(0.02)], maxCost: null, write: () => {} });
    expect(b.usageBlock()).toMatchObject({ unknownLegs: 0, subtreeUnknownLegs: 0, costExact: true });
  });

  test('an unpriced leg still makes it inexact (the v4.4 Item 3 behaviour is preserved)', () => {
    const legs = [{ usage: { tokens: {}, cost: { amount: null, currency: 'USD', source: 'unknown' } } }];
    const b = createBudget({ allLegs: legs, maxCost: null, write: () => {} });
    expect(b.usageBlock().costExact).toBe(false);
  });

  test('subtree-unknown spend does NOT trip the --max-cost ceiling (fail loud, not closed)', () => {
    const legs = [legWith(0.01, { subtreeUnknown: true })];
    const b = createBudget({ allLegs: legs, maxCost: 0.5, write: () => {} });
    expect(b.overBudget()).toBe(false);
    expect(b.spent()).toBeCloseTo(0.01, 10);
  });

  test('the stderr notice fires for a subtree-unknown run that has NO unpriced legs', () => {
    const out = [];
    const b = createBudget({ allLegs: [legWith(0.28211, { subtreeUnknown: true })], maxCost: 0.5, write: (s) => out.push(s) });
    b.noticeUnknownSpend();
    const text = out.join('');
    expect(text).toMatch(/subagent|child session/i);
    expect(text).toMatch(/HIGHER than reported|at least/i);
    expect(text).toMatch(/1 /);
  });

  test('the notice is emitted at most once per run even when both kinds are present', () => {
    const out = [];
    const b = createBudget({
      allLegs: [legWith(0.01, { subtreeUnknown: true }), { usage: { tokens: {}, cost: { amount: null, source: 'unknown' } } }],
      maxCost: null, write: (s) => out.push(s),
    });
    b.noticeUnknownSpend();
    b.noticeUnknownSpend();
    expect(out).toHaveLength(1);
  });
});

describe('wsgate01 reconciliation against the OpenCode oracle', () => {
  const run = recorded.runs.wsgate01;

  test('the recorded run had ZERO unpriced legs — every leg reported a real billed cost', () => {
    expect(run.legs.every((l) => l.recorded.source === 'reported')).toBe(true);
    expect(run.recordedRunCost.unpricedLegs).toBe(0);
  });

  test('the entire $0.0215 shortfall is the ONE child session, to the cent', () => {
    const child = run.b4Unreachable.filter((x) => x.kind === 'child-session');
    expect(child).toHaveLength(1);
    expect(child[0].parentLeg).toBe('wsgate01-s1-2');
    // known + child == OpenCode's own ledger, to the oracle's 4 decimals.
    expect(run.recordedRunTotal + child[0].amount).toBeCloseTo(run.openCodeTruth, 4);
    // …and the shortfall is 100% child spend, not a rounding artefact. $0.0215 is
    // ~600x the 4-decimal rounding floor, which is why float drift was never a
    // plausible explanation.
    expect(run.openCodeTruth - run.recordedRunTotal).toBeCloseTo(child[0].amount, 4);
  });

  test('the child session\'s parent leg is exactly the leg that made a `task` call', () => {
    // Not inferred — the DB shows 2 `task` tool calls across all 37 wsgate
    // sessions and 2 child sessions, in 1:1 correspondence.
    expect(run.subagentLegs).toEqual(['wsgate01-s1-2']);
    expect(run.b4Unreachable[0].parentLeg).toBe(run.subagentLegs[0]);
  });

  test('CORRECTED FLAG: replaying wsgate01 through the fixed pipeline reports costExact FALSE', () => {
    const legs = run.legs.map((l) => ({
      legId: l.legId,
      usage: resolveUsage({
        model: l.model,
        usageTotals: { tokens: l.tokens, costReported: l.costReported },
        subtreeUnknown: run.subagentLegs.includes(l.legId),
      }),
    }));
    const b = createBudget({ allLegs: legs, maxCost: run.maxCost, write: () => {} });
    const block = b.usageBlock();

    // Pre-fix this run asserted costExact:true while $0.0215 short.
    expect(block.costExact).toBe(false);
    expect(block.unknownLegs).toBe(0);
    expect(block.subtreeUnknownLegs).toBe(1);
    // The known total is unchanged — nothing is fabricated in either direction.
    expect(block.cost.amount).toBeCloseTo(run.recordedRunTotal, 10);
    expect(block.cost.source).toBe('reported');
    // And the honest statement the flag now licenses: the truth is at least this.
    expect(run.openCodeTruth).toBeGreaterThan(block.cost.amount);
  });
});

describe('the corrected flag reaches the surfaces that render the total', () => {
  test('run-detail costPanel PREFERS run.usage.costExact over recomputing it', () => {
    // The contract that matters: a run.json whose usage says the total is
    // inexact must NOT be re-derived as exact just because unpricedLegs is 0.
    const { costPanel } = require('../../src/workspace/run-detail');
    const panel = costPanel({
      usage: {
        cost: { amount: 0.28211, currency: 'USD', source: 'reported', unpricedLegs: 0, subtreeUnknownLegs: 1 },
        unknownLegs: 0, subtreeUnknownLegs: 1, costExact: false,
      },
      options: { maxCost: 0.5 },
    }, null);
    expect(panel.costExact).toBe(false);
    expect(panel.subtreeUnknownLegs).toBe(1);
  });

  test('the human run summary says the total is a floor when a subtree is unattributed', () => {
    const { renderRunHuman } = require('../../src/cli-handlers-council-run');
    const text = renderRunHuman({
      runId: 'wsgate01', status: 'complete', exitCode: 0, bench: ['a'], chair: 'b',
      options: { outDir: 'x', maxCost: 0.5 },
      usage: {
        cost: { amount: 0.28210993974, currency: 'USD', source: 'reported', unpricedLegs: 0, subtreeUnknownLegs: 1 },
        unknownLegs: 0, subtreeUnknownLegs: 1, costExact: false,
      },
    });
    expect(text).toMatch(/\$0\.2821/);
    expect(text).toMatch(/subagent/i);
    expect(text).toMatch(/at least/i);
  });
});
