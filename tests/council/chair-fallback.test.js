// tests/council/chair-fallback.test.js
'use strict';

/**
 * v4.9 W4 — the chair-fallback extraction (PR5b shape: pure move + re-export).
 *
 * The MOVE itself needs no new behavioural coverage: pickFallbackChair and
 * classifyChairAttempt were cut and pasted byte-for-byte, and their behaviour is
 * already pinned by tests/council/run-chair.test.js (which imports
 * pickFallbackChair through run.js's re-export) and the LC-5 chairAttempts pins.
 * If the move changed anything, those go red.
 *
 * What IS new, and what this file exists for, is the claim the split itself
 * makes: ONE implementation per function, re-exported — never re-implemented.
 */

const chairFallback = require('../../src/council/chair-fallback');
const runChair = require('../../src/council/run-chair');
const run = require('../../src/council/run');

describe('one implementation, re-exported at every layer', () => {
  // Identity, not equivalence: `toBe` on a function reference cannot pass for a
  // copy that merely behaves the same today. A second implementation anywhere in
  // the chain fails here.
  test('pickFallbackChair is the SAME function object at every layer', () => {
    expect(runChair.pickFallbackChair).toBe(chairFallback.pickFallbackChair);
    // run.js re-exports it too (run-server.js's pre-seed twin lives on this chain).
    expect(run.pickFallbackChair).toBe(chairFallback.pickFallbackChair);
  });

  test('classifyChairAttempt is the SAME function object at both layers', () => {
    expect(runChair.classifyChairAttempt).toBe(chairFallback.classifyChairAttempt);
    // run.js deliberately does NOT re-export the classifier: it is a walk-internal
    // taxonomy, not part of the engine surface. Asserted so that stays a decision.
    expect('classifyChairAttempt' in run).toBe(false);
  });

  test('the extracted module exports exactly the two functions', () => {
    expect(Object.keys(chairFallback).sort()).toEqual(['classifyChairAttempt', 'pickFallbackChair']);
  });
});
