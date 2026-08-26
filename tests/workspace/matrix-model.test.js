'use strict';

const fs = require('fs');
const path = require('path');

const { buildMatrixModel } = require('../../src/workspace/matrix-model');
const { SYMBOL } = require('../../src/council/report');

const FX = path.join(__dirname, '..', 'fixtures', 'council-run-complete');
const tally = JSON.parse(fs.readFileSync(path.join(FX, 'tally.json'), 'utf-8'));
const run = JSON.parse(fs.readFileSync(path.join(FX, 'run.json'), 'utf-8'));

describe('buildMatrixModel', () => {
  const m = buildMatrixModel(tally, run.labelMap);

  test('judge columns follow tally meta.models with dual names', () => {
    expect(m.judges).toEqual([
      { model: 'gemini', label: 'Review A' },
      { model: 'gpt', label: 'Review B' },
      { model: 'qwen', label: 'Review C' },
    ]);
  });

  test('cells carry verdict, the report.js symbol, and the raiser marker', () => {
    const a1 = m.rows.find((r) => r.id === 'A1');
    expect(a1.cells.map((c) => c.sym)).toEqual([' ', SYMBOL.agree, SYMBOL.agree]);
    expect(a1.cells[0].isRaiser).toBe(true);
    expect(a1.cells[1].verdict).toBe('agree');
    expect(a1.raiser).toEqual({ model: 'gemini', label: 'Review A' });
    // Negative cases: a constant `true` on either flag would still pass every
    // other assertion in this suite (only C2 is thin; only A1's own cell is
    // its raiser's).
    expect(a1.cells[1].isRaiser).toBe(false);
    expect(a1.thin).toBe(false);
  });

  // ⚠️ DE-ROT (F07): tally.json's own `tierOverride` is unconditionally null on
  // every real run (tally.js :: tally) — it is not a fallback source. Without a
  // verdict.json, the row must show no badge and the PRE-override tier. Only
  // when verdict.json is joined by id does the post-override tier + the real
  // {from,to,reason} badge appear (verdict.js :: buildVerdict).
  test('thin confidence and basis pass through; tierOverride/tier are verdict-sourced, tally-tier as fallback', () => {
    const c2 = m.rows.find((r) => r.id === 'C2');
    expect(c2.thin).toBe(true);
    expect(c2.basis).toEqual({ a: 0, d: 0, n: 2 });

    const c1 = m.rows.find((r) => r.id === 'C1');
    expect(c1.tierOverride).toBeNull();
    expect(c1.tier).toBe('Contested');
    // C1 is the fixture's only finding with an asymmetric verdict pair
    // (gemini agree / gpt dispute) — pins the column mapping and both
    // non-blank symbols at once.
    expect(c1.cells.map((c) => c.sym)).toEqual([SYMBOL.agree, SYMBOL.dispute, ' ']);

    const verdict = JSON.parse(fs.readFileSync(path.join(FX, 'verdict.json'), 'utf-8'));
    const mv = buildMatrixModel(tally, run.labelMap, verdict);
    const c1v = mv.rows.find((r) => r.id === 'C1');
    expect(c1v.tierOverride).toEqual({ from: 'Contested', to: 'Confirmed', reason: 'chair judgment' });
    expect(c1v.tier).toBe('Confirmed');
  });

  test('missing votes render as blank cells (partial-wave tolerance)', () => {
    const degradedTally = JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', 'fixtures', 'council-run-degraded', 'tally.json'), 'utf-8'));
    const dm = buildMatrixModel(degradedTally, run.labelMap);
    const a1 = dm.rows.find((r) => r.id === 'A1');
    // judges are still the full bench; the dead qwen judge simply has no vote anywhere
    expect(a1.cells.map((c) => c.verdict)).toEqual([null, 'agree', null]);
    expect(a1.cells[2].sym).toBe(' ');
  });

  // ⚠️ DE-ROT (F29): the v4.1 debate decoration must survive into the row (the shipped
  // fixtures are non-debate runs, so this case is synthetic).
  test('debate decoration passes through; undecorated findings are null', () => {
    const dm = buildMatrixModel({ meta: { models: ['gemini'] }, findings: [
      { id: 'A1', raiser: 'gemini', tier: 'Confirmed', debate: { action: 'withdrawn', previousTier: 'Contested' } },
      { id: 'A2', raiser: 'gemini', tier: 'Confirmed' },
    ] }, { 'Review A': 'gemini' });
    expect(dm.rows[0].debate).toEqual({ action: 'withdrawn', previousTier: 'Contested' });
    expect(dm.rows[1].debate).toBeNull();
  });

  test('degenerate tallies do not throw', () => {
    expect(buildMatrixModel({ meta: {}, findings: null }, {}).rows).toEqual([]);
    expect(buildMatrixModel({}, null).judges).toEqual([]);
  });

  // Review follow-up: a malformed `adjudications` element (on-disk JSON is
  // hand-editable, and Task 3 feeds this a defensive parse of it) must blank
  // one cell, not throw and blank the whole matrix panel.
  test('a null/malformed adjudication element does not crash the row; other votes still register', () => {
    const dm = buildMatrixModel({ meta: { models: ['gemini', 'gpt'] }, findings: [
      { id: 'A1', raiser: 'gemini', tier: 'Confirmed', adjudications: [null, { judge: 'gpt', verdict: 'agree' }] },
    ] }, {});
    expect(dm.rows[0].cells.map((c) => c.verdict)).toEqual([null, 'agree']);
  });
});
