// tests/sidecar/fanout-wave-io.test.js
'use strict';

const { stampLegAttribution } = require('../../src/sidecar/fanout-wave-io');

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
