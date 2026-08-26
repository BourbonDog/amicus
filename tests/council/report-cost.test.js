// tests/council/report-cost.test.js
'use strict';

/**
 * v4.9 W8 T-A step 1 — the COST-TABLE extraction (report.js -> report-cost.js).
 * report.js was at 296/300 and the task-intent fork could not fit; the cost
 * model moved out to make room. These are IDENTITY pins: the transform is
 * unchanged, so what has to be pinned is that toModel still routes through it
 * and that the moved expressions still answer the same way.
 *
 * ⚠️ What actually guards the BYTES is wider than this file and named on
 * purpose: report-debate.test.js and report-claude-column.test.js each carry a
 * whole-document `toMatchSnapshot()` of the rendered markdown (both contain the
 * Cost table), report.test.js pins the four role suffixes and the twin-bench
 * seat labels in BOTH formats, and the digests recorded in the T-A step-1
 * evidence were measured before and after the move over four documents.
 */

const { toModel } = require('../../src/council/report');
const { buildCostModel } = require('../../src/council/report-cost');

const baseVerdict = runStats => ({
  schemaVersion: 2, type: 'council-verdict', runId: 'r1', runType: 'council',
  date: '2026-08-25', chair: 'deepseek', council: ['alpha', 'beta'],
  claudeInCouncil: false, findings: [], streetCred: [], tierCounts: {}, runStats,
});

const ROWS = [
  { model: 'alpha', role: 'seat', wasChair: false, status: 'complete', durationMs: 10, usage: null },
  { model: 'alpha', role: 'judge', wasChair: false, status: 'complete', durationMs: 5, usage: null },
  { model: 'gemini', seat: 'gemini#2', role: 'judge', wasChair: false, status: 'complete', durationMs: 6, usage: { cost: { amount: 0.5, source: 'reported' } } },
  { model: 'beta', role: 'repair', wasChair: false, status: 'timeout', durationMs: 3, usage: null },
  { model: 'deep', role: 'chair', wasChair: true, status: 'complete', durationMs: 7, usage: null },
];

describe('report-cost — extraction pins (v4.9 W8 T-A)', () => {
  test('X1 — toModel ROUTES the cost half through the extracted builder', () => {
    // Named mutant STALECOST (toModel rebuilds `{rows, total}` inline, disagreeing
    // with the module — role suffixes dropped, every cost null). MEASURED red set:
    // X1, report.test.js's "cost rows tag judge rows and only judge rows" + "cost
    // rows also tag chair-attempt/repair/superseded rows" + both A2 cases, and all
    // FOUR snapshots (report-debate + report-claude-column, md and html).
    // ⚠️ Measured the other way too, and this pin is NOT the net: dropping the role
    // suffix INSIDE report-cost.js leaves X1 GREEN — both sides of the comparison
    // read the same module, so no disagreement exists to see. That mutant reddens X2
    // and the same four report.test.js cases. X1 catches the routing, X2 the answer.
    const v = baseVerdict(ROWS);
    expect(toModel(v).cost).toEqual(buildCostModel(v.runStats, undefined));
  });

  test('X2 — the four role suffixes and the seat-keyed label survive the move', () => {
    const { rows } = buildCostModel(ROWS, undefined);
    expect(rows.map(r => r.model)).toEqual([
      'alpha', 'alpha (judge)', 'gemini#2 (judge)', 'beta (repair)', 'deep',
    ]);
    // The row keeps its own status/duration/cost, and a usage-less row reports null
    // rather than inventing a number.
    expect(rows[0]).toEqual({ model: 'alpha', status: 'complete', durationMs: 10, cost: null });
    expect(rows[2].cost).toEqual({ amount: 0.5, source: 'reported' });
  });

  test("X3 — the wave's total WINS over the runStats sum, and its absence falls back", () => {
    // The `wave` parameter is what the extraction turned from a closed-over
    // variable into an argument, and NO test in the four report suites passed a
    // wave before this one (measured: `grep -rn "buildReport({ verdict.*wave" tests/`
    // returns nothing) — the seam it created was untested in both directions.
    const wave = { usage: { cost: { amount: 42, source: 'reported' } } };
    expect(buildCostModel(ROWS, wave).total).toEqual({ amount: 42, source: 'reported' });
    const summed = buildCostModel(ROWS, undefined).total;
    expect(summed).not.toEqual({ amount: 42, source: 'reported' });
    // A wave with no usage total is not a wave for this purpose — fall back, never throw.
    expect(buildCostModel(ROWS, { usage: {} }).total).toEqual(summed);
    expect(buildCostModel([], undefined).rows).toEqual([]);
  });
});
