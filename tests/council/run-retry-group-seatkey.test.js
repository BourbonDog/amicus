'use strict';
// v4.8 Phase 2 T2.1 — the seat-key rule is spelled ONCE in run-retry-group.js.
//
// Before this change, `recordFailure` open-coded `seatObj ? seatObj.id : seat` instead of
// calling the exported `seatKey` a few lines above it, even though the docblock above
// `seatKey` already claimed the rule was centralised. Two spellings in one file meant T2.2
// (which changes what the rule *means* at the dedup site) could update one and miss the
// other. These two pins guard that it now can't: P1 pins the OBSERVABLE behavior (recordFailure
// keys through seatKey), P2 pins the SOURCE shape (the rule's `X ? X.id : alias` pattern
// appears exactly once, and it's seatKey's own definition).
const fs = require('fs');
const path = require('path');
const { recordFailure, seatKey } = require('../../src/council/run-retry-group');

describe('T2.1 — recordFailure keys through the one exported seatKey rule', () => {
  test('P1 — recordFailure keys through the exported seatKey rule', () => {
    // Named mutant: swap the argument order to seatKey(seat, seatObj) and this goes RED.
    // Measured: a plain alias string has no `.id` property, so under the swap BOTH
    // branches below collapse to `undefined` instead of the values asserted here — see
    // the 75-input recon in task-1-report.md (0 diffs matched order; order load-bearing
    // under swap).
    const boundUnit = { firstFailures: [], models: [], seats: [] };
    const boundSeatObj = { id: 'gpt-4#2' };
    recordFailure(boundUnit, 'gpt-4', { seat: 'gpt-4' }, true, boundSeatObj);
    expect(boundUnit.firstFailures[0].seatId).toBe('gpt-4#2'); // seatObj.id, not the alias

    const unboundUnit = { firstFailures: [], models: [], seats: [] };
    recordFailure(unboundUnit, 'claude-3', { seat: 'claude-3' }, true, null);
    expect(unboundUnit.firstFailures[0].seatId).toBe('claude-3'); // alias fallback (seatObj null)
  });

  test('P2 — the rule is spelled once in this module', () => {
    // Named mutant: re-inline `seatObj ? seatObj.id : seat` at the recordFailure call site
    // and this goes RED (two matches instead of one). Guards the docblock's own claim,
    // which was false at dbdf09e6.
    const src = fs.readFileSync(
      path.join(__dirname, '../../src/council/run-retry-group.js'), 'utf8');
    // Matches the seat-key shape `X ? X.id : Y` where Y is a plain identifier (an alias
    // variable) — NOT the literal `null`. planStillDeadSources's `bound ? bound.id : null`
    // is a DIFFERENT rule (falls back to null, never to an alias) and must not match here.
    const seatKeyShape = /\b(\w+)\s*\?\s*\1\.id\s*:\s*(?!null\b)\w+/g;
    const matches = src.match(seatKeyShape) || [];
    expect(matches).toHaveLength(1);
    expect(matches[0]).toBe('s ? s.id : alias'); // seatKey's own definition, the only occurrence

    // Control: :108's null-fallback rule is a genuinely different rule and is untouched —
    // still present verbatim, and correctly NOT swept up by the regex above.
    expect(src).toMatch(/bound \? bound\.id : null/);
  });

  test('sanity — seatKey itself still implements the alias-fallback rule', () => {
    const seatObj = { id: 'seat-1' };
    expect(seatKey(seatObj, 'alias-1')).toBe('seat-1');
    expect(seatKey(null, 'alias-1')).toBe('alias-1');
  });
});
