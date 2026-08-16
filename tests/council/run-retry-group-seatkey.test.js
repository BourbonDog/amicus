'use strict';
// v4.8 Phase 2 T2.1 — the seat-key rule is spelled ONCE in run-retry-group.js.
//
// Before this change, `recordFailure` open-coded `seatObj ? seatObj.id : seat` instead of
// calling the exported `seatKey` a few lines above it, even though the docblock above
// `seatKey` already claimed the rule was centralised. Two spellings in one file meant T2.2
// (which changes what the rule *means* at the dedup site) could update one and miss the
// other. These two pins guard that it now can't: P1 pins recordFailure's OBSERVABLE OUTPUT
// (the correct seatId, bound and unbound); P2 pins recordFailure's OWN TEXT via
// Function.prototype.toString() — it delegates to seatKey and does not re-inline the rule.
// P2 was originally a whole-file regex scan; retired after review found it fragile on three
// independent axes at once (exact-whitespace assertions, brittleness to reformatting/comments/
// strings elsewhere in the file, and a pattern that cannot span a dot in the matched
// identifier) — scoping to the function itself, rather than patching the same regex again,
// fixes the first two outright (see P2's own comment for the third). A separate control below
// guards planStillDeadSources's DIFFERENT null-fallback rule, so it is never confused with
// either pin.
const { recordFailure, planStillDeadSources, seatKey } =
  require('../../src/council/run-retry-group');

describe('T2.1 — recordFailure keys through the one exported seatKey rule', () => {
  test('P1 — recordFailure emits the correct seatId, for a bound seat and for an unbound one', () => {
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

  test('P2 — recordFailure keys through the exported seatKey rule, not a re-inlined copy', () => {
    // Named mutant "INLINE": replace the seatKey(...) call with the re-inlined
    // `seatObj ? seatObj.id : seat` and this goes RED (the negative assertion fails).
    // Scoped to recordFailure's own text via toString(), not a whole-file regex scan: immune
    // to comments, string literals, or reformatting elsewhere in the file, and this assertion
    // is presence/absence, not exact-string, so it is not whitespace-exact either.
    // Known, disclosed gap (not patched further — same reasoning that retired the old regex
    // rather than re-patching it): `\w+` cannot span a dot, so a re-inline written with a
    // dotted identifier (e.g. `u.seatObj ? u.seatObj.id : seat`) would slip past both halves.
    const src = recordFailure.toString();
    expect(src).toMatch(/seatKey\s*\(/);          // it delegates to the exported rule
    expect(src).not.toMatch(/\?\s*\w+\.id\s*:/);  // and does not re-inline the rule itself
  });

  test('control — planStillDeadSources still falls back to null, a different rule from seatKey', () => {
    // Anchored by symbol, not a line number — a bare line number here has already rotted once
    // (T2.1's own docblock edit shifted this rule, and the comment pinning it was not
    // re-derived until a later review round).
    expect(planStillDeadSources.toString()).toMatch(/bound \? bound\.id : null/);
  });

  test('sanity — seatKey itself still implements the alias-fallback rule', () => {
    const seatObj = { id: 'seat-1' };
    expect(seatKey(seatObj, 'alias-1')).toBe('seat-1');
    expect(seatKey(null, 'alias-1')).toBe('alias-1');
  });
});
