// tests/sidecar/fanout-wave-io.test.js
'use strict';

const { stampLegAttribution } = require('../../src/sidecar/fanout-wave-io');

// Two named mutants guard the emit-when-different predicate in
// stampLegAttribution's seat block (src/sidecar/fanout-wave-io.js). Both were
// hand-applied against a committed HEAD, measured, then hand-reverted — never
// landed in the module itself — so this comment is the durable record of what
// each one proves (the report under .superpowers/ that first recorded these
// red sets does not survive the branch).
//
//   MUTANT SEATALIAS — compare on truthiness instead of difference:
//     if (s && s.id) { l.seat = s.id; }
//   in place of the real `if (s && s.id !== s.alias) { l.seat = s.id; }`.
//   Measured red set (2): 'a fully unique bench stamps NOTHING —
//   byte-identical to pre-R5', and the third assertion
//   (`'seat' in legs[1]`) of 'stamps the seat id on a repeated alias, and NOT
//   on a unique one'.
//
//   MUTANT SEATSLOPPY (surgical) — drop ONLY the `s &&` roster-entry guard,
//   keeping the alias comparison:
//     legs.forEach((l, i) => {
//       const s = options.seats[i];
//       if (s.id !== s.alias) { l.seat = s.id; }
//     });
//   Measured red set (1, exactly): 'a leg with no matching roster entry gets
//   no seat key' — an out-of-range `options.seats[i]` is `undefined`, and
//   `undefined.id` throws (TypeError), where the real guarded code silently
//   no-ops. A first draft of this mutant deleted the WHOLE `if` clause
//   (`s && s.id !== s.alias`) rather than only the `s &&` guard; that broader
//   form ALSO reds the two SEATALIAS-covered tests above (measured red set of
//   3), so it was rejected as not isolating this property — SEATALIAS pins
//   WHICH seats get stamped, SEATSLOPPY pins what happens OFF THE END of the
//   roster, and a single mutant reding both cannot say which property broke.
describe('stampLegAttribution — seat (v4.8 R5)', () => {
  // A twin bench: buildSeats mints `a#1`/`a#2` because the alias repeats (seats.js:67).
  const TWIN = [{ id: 'a#1', alias: 'a' }, { id: 'b', alias: 'b' }, { id: 'a#2', alias: 'a' }];

  test('stamps the seat id on a repeated alias, and NOT on a unique one', () => {
    const legs = [{ modelInput: 'a' }, { modelInput: 'b' }, { modelInput: 'a' }];
    stampLegAttribution(legs, { seats: TWIN });
    expect(legs[0].seat).toBe('a#1');
    expect(legs[2].seat).toBe('a#2');
    // `b` is unique, so buildSeats set id === alias and there is nothing to say.
    expect('seat' in legs[1]).toBe(false);
  });

  test('a fully unique bench stamps NOTHING — byte-identical to pre-R5', () => {
    const legs = [{ modelInput: 'a' }, { modelInput: 'b' }];
    stampLegAttribution(legs, { seats: [{ id: 'a', alias: 'a' }, { id: 'b', alias: 'b' }] });
    expect(legs.some((l) => 'seat' in l)).toBe(false);
  });

  test('stamps NOTHING when no seats ride the options — absent, not null', () => {
    const legs = [{ modelInput: 'a' }];
    stampLegAttribution(legs, {});
    expect('seat' in legs[0]).toBe(false);
  });

  test('a leg with no matching roster entry gets no seat key', () => {
    const legs = [{ modelInput: 'a' }, { modelInput: 'b' }];
    stampLegAttribution(legs, { seats: [{ id: 'a#1', alias: 'a' }] });
    expect(legs[0].seat).toBe('a#1');
    expect('seat' in legs[1]).toBe(false);
  });
});
