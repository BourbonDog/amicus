// tests/council/seats-preflight.test.js
'use strict';
const { preflightSeats } = require('../../src/council/seats');
const asm = require('../../src/council/run-assemble');

const ok = (o) => preflightSeats({ models: ['glm', 'qwen'], critic: null, lenses: null, ...o });

test('a clean bench yields seats + a null criticSeat and no error', () => {
  const r = ok({});
  expect(r.error).toBe(null);
  expect(r.seats.map(s => s.id)).toEqual(['glm', 'qwen']);
  expect(r.criticSeat).toBe(null);
});

test('a critic on the bench resolves to its seat id', () => {
  expect(ok({ critic: 'qwen' }).criticSeat).toBe('qwen');
});

test('an AMBIGUOUS critic is rejected pre-spend, and the remedy is one the CLI accepts', () => {
  const r = preflightSeats({ models: ['deepseek', 'deepseek'], critic: 'deepseek', lenses: null });
  expect(r.seats).toBe(null);
  expect(r.error.code).toBe('COUNCIL_SEATS_INVALID');
  expect(r.error.message).toContain('occupies 2 bench seats');
  // The seat-id spelling is NOT advertised: every entry point requires
  // bench.includes(critic) (cli-handlers-council-run.js:143), so suggesting
  // --critic 'deepseek#2' would be a dead end until PR2.
  expect(r.error.message).not.toContain('#2');
});

test('an OFF-BENCH critic is rejected pre-spend (v4.8: the engine now guards what only handlers did)', () => {
  const r = ok({ critic: 'nobody' });
  expect(r.error.code).toBe('COUNCIL_SEATS_INVALID');
  expect(r.error.message).toContain('nobody');
});

test('a seat id supplied as the critic is NOT accepted — no consumer understands one yet', () => {
  const r = preflightSeats({ models: ['deepseek', 'deepseek'], critic: 'deepseek#2', lenses: null });
  expect(r.error.code).toBe('COUNCIL_SEATS_INVALID');
});

test('a #N seat id colliding with a literal alias is rejected pre-spend', () => {
  const r = preflightSeats({ models: ['deepseek', 'deepseek', 'deepseek-2'], critic: null, lenses: null });
  expect(r.error.code).toBe('COUNCIL_SEATS_INVALID');
  expect(r.error.message).toContain('review-deepseek-2.md');
});

test('two bench entries resolving to the SAME seat id are rejected', () => {
  const r = preflightSeats({ models: ['deepseek#2', 'deepseek', 'deepseek'], critic: null, lenses: null });
  expect(r.error.code).toBe('COUNCIL_SEATS_INVALID');
  expect(r.error.message).toContain('deepseek#2');
});

test('a pure-alias collision still RUNS — artifact-guard surfaces it, PR1 does not refuse it', () => {
  const r = preflightSeats({ models: ['vendor/a', 'vendor?a'], critic: null, lenses: null });
  expect(r.error).toBe(null);
});

test('run-assemble re-exports it so asm.preflightSeats(o) is the call spelling', () => {
  expect(asm.preflightSeats).toBe(preflightSeats);
});

test('critic + lenses together is rejected pre-spend — the pair is incoherent, not merely unused', () => {
  const r = preflightSeats({ models: ['glm', 'qwen'], critic: 'qwen', lenses: ['A', 'B'] });
  expect(r.seats).toBe(null);
  expect(r.error.code).toBe('COUNCIL_SEATS_INVALID');
  expect(r.error.message).toMatch(/lens/i);
});

test('lenses alone, critic alone, and an EMPTY lenses array all still work', () => {
  expect(preflightSeats({ models: ['glm', 'qwen'], critic: null, lenses: ['A', 'B'] }).error).toBe(null);
  expect(preflightSeats({ models: ['glm', 'qwen'], critic: 'qwen', lenses: null }).error).toBe(null);
  // [] is not lenses anywhere else in this module (seats.js:55) — it must not trip the guard
  expect(preflightSeats({ models: ['glm', 'qwen'], critic: 'qwen', lenses: [] }).error).toBe(null);
});
