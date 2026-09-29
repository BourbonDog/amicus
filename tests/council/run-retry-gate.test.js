// tests/council/run-retry-gate.test.js
'use strict';

/**
 * D-06: the once-only Stage-1 retry's death-class gate (src/council/run-retry-gate.js).
 * The predicate is judged against the REAL formatter's output, never a pasted literal: a copied
 * reason is how a classifier and the thing it classifies drift apart.
 */
const fs = require('fs');
const path = require('path');
const { isOutputLengthLoss, outputLengthSkipClause, OUTPUT_LENGTH_SKIP_CLAUSE }
  = require('../../src/council/run-retry-gate');
const { formatOutputLengthReason } = require('../../src/utils/output-length');
const { formatNoOutputBackstopReason } = require('../../src/headless');

const TOKENS = { reasoning: 32000, output: 0 };
// Every arm of the reason's budget clause, and both streamed arms
// (utils/output-length.js :: formatOutputLengthReason): budget unreadable, set, unset with no
// ambient flag, unset with a plain ambient flag, unset with a non-plain one.
const MINTED = [
  formatOutputLengthReason({ tokens: TOKENS, budget: undefined, reasoningOnly: true, ambientFlag: null }),
  formatOutputLengthReason({ tokens: TOKENS, budget: 64000, reasoningOnly: true, ambientFlag: null }),
  formatOutputLengthReason({ tokens: TOKENS, budget: null, reasoningOnly: false, ambientFlag: null }),
  formatOutputLengthReason({ tokens: TOKENS, budget: null, reasoningOnly: true, ambientFlag: '64000' }),
  formatOutputLengthReason({ tokens: TOKENS, budget: null, reasoningOnly: true, ambientFlag: '64000abc' }),
];

describe('D-06: run-retry-gate :: isOutputLengthLoss', () => {
  test.each(MINTED.map((r, i) => [i, r]))('holds a leg whose reason is a minted OUTPUT_LENGTH death (arm %i)', (_i, reason) => {
    expect(isOutputLengthLoss({ modelInput: 'glm', status: 'error', error: reason })).toBe(true);
  });

  test('a timed-out leg is still held when its reason is the named death', () => {
    // utils/result-schema.js :: statusFromResult ranks timeout above error, so the class is read off
    // the reason, never off the status.
    expect(isOutputLengthLoss({ modelInput: 'glm', status: 'timeout', error: MINTED[1] })).toBe(true);
  });

  test('every other loss passes through to the retry', () => {
    const backstop = formatNoOutputBackstopReason({ ms: 480000, fromEnv: true });
    for (const leg of [null, undefined, {}, { error: null }, { error: 'boom' },
      { status: 'complete', error: '' }, { status: 'error', error: backstop },
      // Named mutant "PREFIXANYWHERE": `includes` would hold this provider error that merely quotes the prefix.
      { status: 'error', error: 'upstream said: OUTPUT_LENGTH: stopped' },
      // Ruling R3 (this module's docblock): the class is keyed on the reason's PREFIX, never on
      // `finish`. A length stop whose ENGINE error won the reason (headless.js :: runHeadless; the
      // shape tests/headless-output-length.test.js pins) is a different death, and it is retried.
      // Named mutant "FINISHKEYED": `|| leg.finish === 'length'` in isOutputLengthLoss holds this
      // leg, and the `expect` below reds.
      { status: 'error', finish: 'length', error: 'MessageOutputLengthError' }]) {
      expect(isOutputLengthLoss(leg)).toBe(false);
    }
  });
});

describe('D-06: run-retry-gate :: outputLengthSkipClause', () => {
  test('the clause is the exact announced sentence tail', () => {
    expect(OUTPUT_LENGTH_SKIP_CLAUSE).toBe('; its once-only retry was skipped: a relaunch reserves the same output budget');
    expect(outputLengthSkipClause({ status: 'error', error: MINTED[0] })).toBe(OUTPUT_LENGTH_SKIP_CLAUSE);
  });

  test('is the EMPTY string for every other leg, so their notes stay byte-identical', () => {
    // Named mutant "CLAUSEEVERYLEG": return the clause unconditionally.
    for (const leg of [null, {}, { status: 'error', error: 'boom' }, { status: 'complete', error: null }]) {
      expect(outputLengthSkipClause(leg)).toBe('');
    }
  });
});

describe('D-06: run-retry-gate keeps ONE spelling of the prefix', () => {
  test('the module requires utils/output-length and never re-spells the prefix', () => {
    // Named mutant "SECONDSPELLING": inline the prefix literal instead of importing it.
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'council', 'run-retry-gate.js'), 'utf8');
    expect(src).toContain("require('../utils/output-length')");
    expect(src).not.toMatch(/['"`]OUTPUT_LENGTH:/);
  });
});
