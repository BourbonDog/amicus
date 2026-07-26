'use strict';

/**
 * v4.4 — REPLAY RECONCILIATION against four real paid council runs.
 *
 * The diagnosis (.superpowers/sdd/v44/zero-usage-diagnosis.md §10.5) establishes
 * that `council-wsgate01/`..`council-wsgate04/` plus OpenCode's own session DB
 * form a COMPLETE OFFLINE ORACLE with known ground truth, and that replaying the
 * recorded legs through the patched resolver is "the single highest-value check
 * and costs nothing".
 *
 * `tests/fixtures/v44-cost-replay/recorded-runs.json` is a read-only extraction
 * of those runs (the run dirs themselves are irreplaceable paid evidence and are
 * never touched): per leg, the RAW resolver inputs (`tokens`, `costReported`)
 * plus the `recorded` block the PRE-FIX pipeline actually wrote, plus each leg's
 * progress.json snapshot; per run, the OpenCode-DB truth total from §0 and the
 * verified B4 amounts from §5. The catalog pricing is pinned in the fixture so
 * the replay never depends on this machine's catalog cache.
 *
 * What this file proves:
 *   ✔ no leg reports `estimated $0` off an all-zero token total any more (B2)
 *   ✔ every dollar of the residual gap to OpenCode's truth is accounted for by
 *     the amounts the diagnosis measured — nothing is unexplained
 *   ✔ v4.4.1 CA-1: the measured CHILD-SESSION column ($0.492506 across the four
 *     runs) is now RECOVERED into `known` rather than merely flagged — see the
 *     `CA-1 replay` block below.
 * What it still does NOT claim to recover, because no replay can:
 *   ✘ the B1 finalization-race losses (`wsgate04`, $0.0145) and the
 *     post-completion PARENT messages (`wsgate02`, $0.14279). Both were closed
 *     at the CAPTURE layer (the post-loop usage settle; dcb0792's deferral of a
 *     leg's completion until its `task` part goes terminal) and neither can be
 *     reconstructed from a recording of a run that predates the fix.
 */

const fs = require('fs');
const path = require('path');

const FIXTURE = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', 'fixtures', 'v44-cost-replay', 'recorded-runs.json'), 'utf-8'));

const catalog = require('../../src/utils/model-catalog');
const localProviders = require('../../src/utils/local-providers');
const pricing = require('../../src/utils/pricing');

/** The catalog exactly as it stood when the four runs executed. */
function pinCatalog() {
  const models = Object.entries(FIXTURE.pricing).map(([id, p]) => ({ id, pricing: p }));
  jest.spyOn(catalog, 'readCache').mockReturnValue({ models });
  jest.spyOn(localProviders, 'isLocalProvider').mockImplementation((v) => v === 'lmstudio');
  jest.spyOn(localProviders, 'getLocalProviders').mockReturnValue({
    lmstudio: { id: 'lmstudio', pricing: { prompt: 0, completion: 0 } },
  });
}

beforeEach(pinCatalog);
afterEach(() => jest.restoreAllMocks());

/** Re-resolve one recorded leg through the CURRENT pipeline. */
const replayLeg = (leg) => pricing.resolveUsage({
  model: leg.model,
  usageTotals: { tokens: leg.tokens, costReported: leg.costReported },
});

/** Re-roll a whole recorded run. */
function replayRun(run) {
  const legs = run.legs.map((l) => ({ legId: l.legId, usage: replayLeg(l) }));
  const rolled = pricing.sumWaveUsage(legs);
  return { legs, cost: rolled.cost };
}

const RUN_KEYS = ['wsgate01', 'wsgate02', 'wsgate03', 'wsgate04'];
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

describe('the fixture is the oracle the diagnosis described', () => {
  test('35 legs across four runs, with the §0 truth totals attached', () => {
    expect(RUN_KEYS.map((k) => FIXTURE.runs[k].legs.length)).toEqual([7, 11, 6, 11]);
    expect(sum(RUN_KEYS.map((k) => FIXTURE.runs[k].legs.length))).toBe(35);
    expect(FIXTURE.runs.wsgate02.openCodeTruth).toBe(0.9859);
    expect(FIXTURE.runs.wsgate02.maxCost).toBe(0.75);
    expect(FIXTURE.runs.wsgate02.recordedRunTotal).toBeCloseTo(0.3720, 4);
  });

  test('the pre-fix pipeline produced FOUR authoritative-looking $0 legs', () => {
    const lies = RUN_KEYS.flatMap((k) => FIXTURE.runs[k].legs
      .filter((l) => l.recorded.source === 'estimated' && l.recorded.amount === 0)
      .map((l) => `${k}/${l.legId}`));
    expect(lies).toEqual([
      'wsgate02/wsgate02-s1-3',
      'wsgate04/wsgate04-p1-1',
      'wsgate04/wsgate04-p2-1',
      'wsgate04/wsgate04-s1-3',
    ]);
  });
});

describe('B2 regression guard over every recorded leg', () => {
  test('NO leg resolves to estimated $0 off an all-zero token total', () => {
    const offenders = [];
    for (const k of RUN_KEYS) {
      for (const leg of FIXTURE.runs[k].legs) {
        const r = replayLeg(leg);
        if (!pricing.hasObservedTokens(leg.tokens) && r.cost.amount === 0) {
          offenders.push(`${k}/${leg.legId} -> ${JSON.stringify(r.cost)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test('each of the four former lies is now {amount:null, source:unknown}', () => {
    const targets = [['wsgate02', 'wsgate02-s1-3'], ['wsgate04', 'wsgate04-p1-1'],
      ['wsgate04', 'wsgate04-p2-1'], ['wsgate04', 'wsgate04-s1-3']];
    for (const [k, legId] of targets) {
      const leg = FIXTURE.runs[k].legs.find((l) => l.legId === legId);
      expect(replayLeg(leg).cost).toEqual({ amount: null, currency: 'USD', source: 'unknown' });
      expect(pricing.formatCost(replayLeg(leg).cost)).toBe('?');
    }
  });

  test('every leg that DID report tokens is unchanged by the fix', () => {
    for (const k of RUN_KEYS) {
      for (const leg of FIXTURE.runs[k].legs) {
        if (!pricing.hasObservedTokens(leg.tokens)) { continue; }
        const r = replayLeg(leg);
        expect(r.cost.source).toBe(leg.recorded.source);
        expect(r.cost.amount).toBeCloseTo(leg.recorded.amount, 10);
      }
    }
  });

  test("the three haiku error legs stay honest 'unknown' (they always were)", () => {
    const haiku = RUN_KEYS.flatMap((k) => FIXTURE.runs[k].legs
      .filter((l) => String(l.model).startsWith('anthropic/claude-haiku')));
    expect(haiku).toHaveLength(3);
    for (const l of haiku) {
      expect(l.recorded.source).toBe('unknown');
      expect(replayLeg(l).cost.source).toBe('unknown');
    }
  });
});

describe('per-run reconciliation against the OpenCode oracle', () => {
  /**
   * The headline. council-wsgate02 really spent $0.9859 against a $0.75 ceiling
   * while run.json said $0.3720 — and the leg that swallowed the difference
   * (wsgate02-s1-3) was printed as a confident `$0.0000`.
   */
  test('wsgate02: known spend is unchanged, but the missing $0.6138 is now a FLAGGED unknown', () => {
    const run = FIXTURE.runs.wsgate02;
    const { cost } = replayRun(run);

    // Known spend: identical to before (the zeroed leg contributed nothing then either).
    expect(cost.amount).toBeCloseTo(0.37202345, 8);
    expect(cost.amount).toBeCloseTo(run.recordedRunTotal, 8);

    // …but the run now declares three legs it cannot price, where before it
    // declared only two (the haiku pair) and asserted $0 for the third.
    expect(run.recordedRunCost.unpricedLegs).toBe(2);
    expect(run.recordedRunCost.estimatedLegs).toBe(1);
    expect(cost.unpricedLegs).toBe(3);
    expect(cost.estimatedLegs).toBe(0);
    expect(cost.source).toBe('mixed');

    // The specific leg that ate the money no longer reads as free.
    const s13 = replayRun(run).legs.find((l) => l.legId === 'wsgate02-s1-3');
    expect(pricing.formatCost(s13.usage.cost)).toBe('?');

    // FULL RECONCILIATION to OpenCode's truth: known + the verified B4 amounts.
    const b4 = sum(run.b4Unreachable.map((x) => x.amount));
    expect(b4).toBeCloseTo(0.61384, 5);
    expect(cost.amount + b4).toBeCloseTo(run.openCodeTruth, 4);
    // i.e. $0.37202 (reported, honest) + $0.47105 (child @explore session)
    //    + $0.14279 (parent messages billed 2-3 min AFTER the leg was declared
    //      complete mid-Task-call) = $0.98586 ≈ $0.9859 OpenCode truth.

    // And the ceiling: known spend still does NOT cross $0.75, so per the owner's
    // "fail LOUD, not fail CLOSED" ruling the run is not halted — it is FLAGGED.
    expect(cost.amount).toBeLessThan(run.maxCost);
    expect(cost.unpricedLegs).toBeGreaterThan(0);
  });

  /**
   * The whole-corpus statement: for all four runs,
   *   known(after fix) + measured B1 race loss + measured B4 unreachable == OpenCode truth
   * to within the 4-decimal rounding of the §0 oracle. Nothing is unexplained.
   */
  test('every run reconciles: known + measured B1 + measured B4 == the OpenCode truth', () => {
    const table = RUN_KEYS.map((k) => {
      const run = FIXTURE.runs[k];
      const { cost } = replayRun(run);
      const b1 = sum(run.b1RaceLoss.map((x) => x.amount));
      const b4 = sum(run.b4Unreachable.map((x) => x.amount));
      return {
        run: k, known: cost.amount, unknownLegs: cost.unpricedLegs, b1, b4,
        truth: run.openCodeTruth, residual: run.openCodeTruth - (cost.amount + b1 + b4),
      };
    });
    for (const row of table) {
      expect(Math.abs(row.residual)).toBeLessThan(0.0002);
    }
    // The gap is B4 for wsgate01/02, B1 for wsgate04, and nothing for wsgate03 —
    // exactly the split the diagnosis measured, per defect.
    expect(table.map((r) => [r.run, r.b1 > 0, r.b4 > 0]))
      .toEqual([['wsgate01', false, true], ['wsgate02', false, true],
        ['wsgate03', false, false], ['wsgate04', true, false]]);
    // wsgate03 was already exact — the fix must not perturb a correct run.
    const w3 = table.find((r) => r.run === 'wsgate03');
    expect(w3.known).toBeCloseTo(w3.truth, 4);
    expect(w3.unknownLegs).toBe(1); // its one haiku error leg, unchanged
  });

  test('wsgate01 is the honest LIMIT of these fixes: fully priced, still $0.0215 short', () => {
    const run = FIXTURE.runs.wsgate01;
    const { cost } = replayRun(run);
    // No leg here had a zero-token total, so B2 changes nothing at all…
    expect(cost.unpricedLegs).toBe(0);
    expect(cost.source).toBe('reported');
    expect(cost.amount).toBeCloseTo(run.recordedRunTotal, 10);
    // …and the entire shortfall is one unreachable child @explore session (B4).
    expect(run.b4Unreachable).toHaveLength(1);
    expect(run.b4Unreachable[0].amount).toBeCloseTo(run.openCodeTruth - cost.amount, 4);
    // This run therefore still reports costExact-looking output while being short.
    // That is B4's remaining exposure, documented, not silently fixed here.
  });

  test('wsgate04: the two 155ms/29ms race losses become unknown rather than $0', () => {
    const run = FIXTURE.runs.wsgate04;
    const { cost, legs } = replayRun(run);
    expect(cost.amount).toBeCloseTo(run.recordedRunTotal, 8);
    expect(cost.unpricedLegs).toBe(3);
    for (const legId of ['wsgate04-p1-1', 'wsgate04-p2-1', 'wsgate04-s1-3']) {
      expect(legs.find((l) => l.legId === legId).usage.cost.source).toBe('unknown');
    }
    // B4 is empty for this run: its whole $0.0145 gap is the B1 race, which the
    // post-loop usage re-poll (tests/observe/usage-settle.test.js) closes at the
    // capture layer for FUTURE runs. It cannot be recovered from a recorded run.
    expect(run.b4Unreachable).toHaveLength(0);
    expect(run.b1RaceLoss).toHaveLength(2);
    expect(sum(run.b1RaceLoss.map((x) => x.amount))).toBeCloseTo(0.01450007, 7);
    expect(run.openCodeTruth - cost.amount).toBeCloseTo(0.0145, 4);
    // The third unknown (wsgate04-s1-3) is the diagnosis's "fifth, non-bug case":
    // OpenCode itself recorded cost 0 / tokens 0 with time.completed set, so it
    // contributes nothing to the gap — and `unknown` is precisely the right label
    // for work that happened and was tallied but whose cost we cannot state.
    expect(run.legs.find((l) => l.legId === 'wsgate04-s1-3').costReported).toBe(0);
  });
});

/**
 * v4.4.1 CA-1 — the same oracle, replayed with child-session attribution on.
 *
 * The fixture's `b4Unreachable` rows are the MEASURED per-defect amounts from
 * the OpenCode DB, split by kind:
 *   - `child-session`                   the subagent session amicus never walked
 *   - `post-completion-parent-messages` the PARENT's own messages, billed after
 *                                       the leg was declared complete mid-`task`
 * CA-1 recovers the first kind and only the first kind. The second was closed at
 * the CAPTURE layer by dcb0792 (a `task` part no longer goes terminal while its
 * child session is live, so those messages are now inside the leg's own window)
 * and cannot be recovered from a recording, exactly like the B1 race losses.
 *
 * Replay feeds each recorded leg the child-session amount its own run measured,
 * through the SAME resolveUsage/sumWaveUsage path production now uses, and
 * asserts the B4 child-session column has moved out of the residual and into
 * `known`.
 */
describe('CA-1 replay: the child-session column moves into KNOWN', () => {
  const childRows = (run) => run.b4Unreachable.filter((x) => x.kind === 'child-session');
  const parentTailRows = (run) => run.b4Unreachable.filter((x) => x.kind !== 'child-session');

  /** Re-roll a run WITH the measured child sessions attributed to their parent legs. */
  function replayRunAttributed(run) {
    const byParent = new Map();
    for (const row of childRows(run)) {
      const cur = byParent.get(row.parentLeg) || { sessions: 0, costReported: 0 };
      byParent.set(row.parentLeg, { sessions: cur.sessions + 1, costReported: cur.costReported + row.amount });
    }
    const legs = run.legs.map((l) => {
      const kids = byParent.get(l.legId);
      return {
        legId: l.legId,
        usage: pricing.resolveUsage({
          model: l.model,
          usageTotals: { tokens: l.tokens, costReported: l.costReported },
          subtree: kids ? { ...kids, tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 } } : undefined,
        }),
      };
    });
    return { legs, cost: pricing.sumWaveUsage(legs).cost };
  }

  test('wsgate01 — the run that reported costExact while 7.1% short now reconciles EXACTLY', () => {
    const run = FIXTURE.runs.wsgate01;
    const before = replayRun(run).cost.amount;
    const { cost } = replayRunAttributed(run);
    expect(before).toBeCloseTo(0.28210993974, 8);           // every leg priced, still short
    expect(cost.subtreeSessions).toBe(1);
    expect(cost.subtreeCost).toBeCloseTo(0.021460, 8);
    // THE HEADLINE: known == OpenCode truth, with nothing left over.
    expect(cost.amount).toBeCloseTo(run.openCodeTruth, 4);
    expect(run.openCodeTruth - cost.amount).toBeLessThan(0.0002);
    expect(parentTailRows(run)).toHaveLength(0);
  });

  test('wsgate02 — $0.471046 moves into known; only the parent tail remains', () => {
    const run = FIXTURE.runs.wsgate02;
    const { cost, legs } = replayRunAttributed(run);
    // The fixture records the DB amounts at 5dp ($0.47105); the diagnosis quotes
    // them at full precision ($0.471046). Assert to the fixture's own resolution.
    expect(cost.subtreeCost).toBeCloseTo(0.471046, 4);
    // The leg's OWN cost is still honestly unknown (it observed no tokens) —
    // attribution must not launder that into a reported-looking number.
    const s13 = legs.find((l) => l.legId === 'wsgate02-s1-3');
    expect(s13.usage.cost).toEqual({ amount: null, currency: 'USD', source: 'unknown' });
    expect(s13.usage.subtree.cost.source).toBe('reported');
    expect(s13.usage.subtree.cost.amount).toBeCloseTo(0.471046, 4);
    // …and the child money is banked anyway.
    expect(cost.amount).toBeCloseTo(0.37202345 + 0.471046, 4);
    // Residual is now EXACTLY the post-completion parent tail, which dcb0792
    // closed at the capture layer and no replay can recover.
    const tail = sum(parentTailRows(run).map((x) => x.amount));
    expect(tail).toBeCloseTo(0.14279, 5);
    expect(run.openCodeTruth - (cost.amount + tail)).toBeLessThan(0.0002);
  });

  test('THE RECONCILIATION: known(after CA-1) + B1 + parent-tail == OpenCode truth, all four runs', () => {
    const table = RUN_KEYS.map((k) => {
      const run = FIXTURE.runs[k];
      const { cost } = replayRunAttributed(run);
      const b1 = sum(run.b1RaceLoss.map((x) => x.amount));
      const tail = sum(parentTailRows(run).map((x) => x.amount));
      return { run: k, known: cost.amount, subtree: cost.subtreeCost, b1, tail,
        truth: run.openCodeTruth, residual: run.openCodeTruth - (cost.amount + b1 + tail) };
    });
    for (const row of table) { expect(Math.abs(row.residual)).toBeLessThan(0.0002); }
    // The B4 child-session column is now ZERO in the residual for every run: it
    // is inside `known`. $0.021460 + $0.471046 = $0.492506 recovered.
    expect(sum(table.map((r) => r.subtree))).toBeCloseTo(0.492506, 4);
    expect(table.map((r) => [r.run, r.subtree > 0, r.b1 > 0, r.tail > 0])).toEqual([
      ['wsgate01', true, false, false],
      ['wsgate02', true, false, true],
      ['wsgate03', false, false, false],
      ['wsgate04', false, true, false],
    ]);
  });

  test('a run with no subagents is not perturbed by the attribution path', () => {
    // wsgate03 was already exact. Adding the CA-1 machinery must not move it.
    const plain = replayRun(FIXTURE.runs.wsgate03).cost;
    const attributed = replayRunAttributed(FIXTURE.runs.wsgate03).cost;
    expect(attributed.amount).toBeCloseTo(plain.amount, 12);
    expect(attributed.subtreeCost).toBe(0);
    expect(attributed.subtreeSessions).toBe(0);
  });
});

describe('B3 evidence carried by the same fixture', () => {
  test('31 of 35 legs ended with an all-zero progress.json usage snapshot', () => {
    const all = RUN_KEYS.flatMap((k) => FIXTURE.runs[k].legs);
    expect(all.filter((l) => l.progressTokenTotal === 0)).toHaveLength(31);
    expect(all.filter((l) => l.progressTokenTotal > 0)).toHaveLength(4);
  });

  test('every leg ended on a `receiving` or `prompt_sent` stage — never a terminal one', () => {
    const stages = new Set(RUN_KEYS.flatMap((k) => FIXTURE.runs[k].legs.map((l) => l.progressStage)));
    expect([...stages].sort()).toEqual(['prompt_sent', 'receiving']);
    expect(stages.has('complete')).toBe(false);
  });

  test('legs whose metadata held real usage but whose snapshot read zero', () => {
    const mismatched = RUN_KEYS.flatMap((k) => FIXTURE.runs[k].legs
      .filter((l) => l.progressTokenTotal === 0 && pricing.hasObservedTokens(l.tokens)));
    // These are exactly the legs that rendered as FREE in the live GUI while
    // metadata.json held thousands of real tokens and a reported cost.
    expect(mismatched.length).toBeGreaterThanOrEqual(24);
    for (const l of mismatched) { expect(replayLeg(l).cost.amount).toBeGreaterThan(0); }
  });
});

describe('the v4.2 free-local promise survives the same replay', () => {
  test('an lmstudio seat with real tokens still resolves to estimated $0.0000', () => {
    const r = pricing.resolveUsage({
      model: 'lmstudio/qwen3-30b',
      usageTotals: { tokens: { input: 12400, output: 3100, reasoning: 0, cacheRead: 0, cacheWrite: 0 }, costReported: 0 },
    });
    expect(r.cost).toEqual({ amount: 0, currency: 'USD', source: 'estimated' });
    expect(pricing.formatCost(r.cost)).toBe('~$0.0000');
  });

  test('a free local seat and an unknown paid seat are never the same string', () => {
    const free = pricing.resolveUsage({
      model: 'lmstudio/qwen3-30b',
      usageTotals: { tokens: { input: 100, output: 10 }, costReported: 0 },
    });
    const unknown = replayLeg(FIXTURE.runs.wsgate04.legs.find((l) => l.legId === 'wsgate04-p1-1'));
    expect(pricing.formatCost(free.cost)).toBe('~$0.0000');
    expect(pricing.formatCost(unknown.cost)).toBe('?');
    expect(pricing.formatCost(free.cost)).not.toBe(pricing.formatCost(unknown.cost));
  });

  test('a rolled-up wave of free local seats stays exact (no phantom unknowns)', () => {
    const legs = [1, 2, 3].map((n) => ({
      usage: pricing.resolveUsage({
        model: `lmstudio/m${n}`,
        usageTotals: { tokens: { input: 900 * n, output: 120 * n }, costReported: 0 },
      }),
    }));
    const w = pricing.sumWaveUsage(legs);
    expect(w.cost).toMatchObject({ amount: 0, source: 'estimated', unpricedLegs: 0, estimatedLegs: 3 });
  });
});
