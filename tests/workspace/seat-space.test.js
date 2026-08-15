'use strict';

/**
 * v4.8 PR5b — the seat-space predicate extraction.
 *
 * The MOVE itself needs no new behavioural coverage: the functions were cut and pasted
 * byte-for-byte, and their behaviour is already pinned by tests/workspace/artifact-names.test.js
 * (which still imports isSeatTable from artifact-names.js) and tests/workspace/run-detail.test.js
 * (which imports it from artifact-guard.js). If the move changed anything, those go red.
 *
 * What IS new, and what this file exists for, are the two claims the split itself makes:
 *   1. ONE predicate, three import paths — re-exports, never re-implementations.
 *   2. The new module's header claims "pure and total: no I/O, no throw path". PR5a's fix
 *      waves produced THREE documented-but-unpinned claims that only a mutant caught, so a
 *      claim written in a header here gets an assertion under it in the same commit.
 */

const seatSpace = require('../../src/workspace/seat-space');
const artifactNames = require('../../src/workspace/artifact-names');
const artifactGuard = require('../../src/workspace/artifact-guard');

describe('one predicate, three import paths', () => {
  // Identity, not equivalence: `toBe` on a function reference cannot pass for a copy that
  // merely behaves the same today. A second implementation anywhere in the chain — the exact
  // drift that produced council-1's B1 between the renderer and the allowlist — fails here.
  test('isSeatTable is the SAME function object at every layer', () => {
    expect(artifactNames.isSeatTable).toBe(seatSpace.isSeatTable);
    expect(artifactGuard.isSeatTable).toBe(seatSpace.isSeatTable);
  });

  test('orphanExonerations is the SAME function object at both layers', () => {
    // artifact-guard.js deliberately does NOT re-export this one: it is a name-derivation
    // input, not part of the read-fence surface. Asserted so that stays a decision.
    expect(artifactNames.orphanExonerations).toBe(seatSpace.orphanExonerations);
    expect('orphanExonerations' in artifactGuard).toBe(false);
  });

  test('the extracted module exports exactly the two predicates', () => {
    expect(Object.keys(seatSpace).sort()).toEqual(['isSeatTable', 'orphanExonerations']);
  });
});

describe('pure and total — the header claim, pinned', () => {
  // Both functions read a schema-free JSON.parse of run.json, so "any shape" is the real
  // input domain, not a hypothetical one. A throw here reaches getRunDetail, which has no
  // try/catch around artifactAllowlist — it would blank the whole run detail, not one panel.
  const HOSTILE = [
    undefined, null, 0, '', 'seats', true, [], {},
    { seats: null }, { seats: 'nope' }, { seats: [] }, { seats: [null] }, { seats: [undefined] },
    { seats: [{}] }, { seats: [{ id: 1 }] }, { seats: [{ id: 'a' }] },
    { seats: [{ id: 'a', alias: 2 }] }, { seats: Object.create(null) },
    { degrades: null }, { degrades: 'nope' }, { degrades: [null] }, { degrades: [{}] },
    { degrades: [{ channel: 'seat-unbound' }] },
    { degrades: [{ channel: 'seat-unbound', data: {} }] },
    { degrades: [{ channel: 'seat-unbound', data: { legId: 'x' } }] },
    { degrades: [{ channel: 'seat-unbound', data: { legId: 'x', seat: 7 } }] },
    { runId: 42, degrades: [{ channel: 'seat-unbound', data: { legId: 'x', seat: 'a' } }] },
  ];

  test('orphanExonerations never throws, and always returns a Map', () => {
    for (const run of HOSTILE) {
      expect(() => seatSpace.orphanExonerations(run)).not.toThrow();
      expect(seatSpace.orphanExonerations(run)).toBeInstanceOf(Map);
    }
  });

  test('isSeatTable never throws, and always returns a boolean', () => {
    for (const run of HOSTILE) {
      const seats = run && typeof run === 'object' ? run.seats : run;
      expect(() => seatSpace.isSeatTable(seats)).not.toThrow();
      expect(typeof seatSpace.isSeatTable(seats)).toBe('boolean');
    }
  });

  test('neither function mutates its input', () => {
    // `degrades` and `seats` are handed straight from getRunDetail's parsed run.json, which
    // is also returned to the renderer wholesale — a mutation here would ship to the UI.
    const run = {
      runId: 'r1',
      seats: [{ id: 'a#1', alias: 'a' }, { id: 'a#2', alias: 'a' }],
      degrades: [{ channel: 'seat-unbound', data: { legId: 'l1', seat: 'a', waveId: 'r1-s2' } }],
    };
    const before = JSON.stringify(run);
    seatSpace.isSeatTable(run.seats);
    seatSpace.orphanExonerations(run);
    expect(JSON.stringify(run)).toBe(before);
  });
});
