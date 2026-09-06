'use strict';

const { OUTPUT_LENGTH_PREFIX, isOutputLengthDeath, formatOutputLengthReason } = require('../../src/utils/output-length');

describe('isOutputLengthDeath (#218 PR 3)', () => {
  test("finish 'length' with no answer text on that message is the death (L1/L2/L4 shapes)", () => {
    expect(isOutputLengthDeath({ finish: 'length', hasText: false })).toBe(true);
  });
  test("finish 'length' with answer text on that message is NOT the death — a cut review (L3)", () => {
    // Named mutant "TEXTIGNORED": drop the hasText check — this reads true.
    expect(isOutputLengthDeath({ finish: 'length', hasText: true })).toBe(false);
  });
  test('no answer text with any other finish is not this death', () => {
    // Named mutant "NOTLENGTH": drop the finish check — 'stop' with no text reads true.
    expect(isOutputLengthDeath({ finish: 'stop', hasText: false })).toBe(false);
    expect(isOutputLengthDeath({ finish: null, hasText: false })).toBe(false);
    expect(isOutputLengthDeath({ finish: undefined, hasText: false })).toBe(false);
  });
  test('an unrecorded hasText is not text: a message with no parts is the death', () => {
    expect(isOutputLengthDeath({ finish: 'length' })).toBe(true);
  });
});

describe('formatOutputLengthReason (#218 PR 3)', () => {
  const tokens = { input: 5, output: 0, reasoning: 32000 };

  test('the ledger shape, budget unset: prefix, finish, counts, the engine default, the remedy', () => {
    expect(formatOutputLengthReason({ tokens, budget: null, reasoningOnly: false })).toBe(
      "OUTPUT_LENGTH: the provider stopped at the max_tokens reservation (finish 'length') and no answer text arrived — "
      + "32000 reasoning / 0 output tokens; outputBudget is unset — the engine's 32000 default reservation governs — "
      + 'raise outputBudget in config.json (docs/configuration.md, Output budget)');
  });
  test('a reasoning-only message says so', () => {
    expect(formatOutputLengthReason({ tokens, budget: null, reasoningOnly: true }))
      .toContain('and only reasoning was streamed, no answer text — 32000 reasoning / 0 output tokens');
  });
  test('a configured budget is named as plain digits', () => {
    // Named mutant "BUDGETUNSET": always print the unset clause — 8000 never appears.
    expect(formatOutputLengthReason({ tokens, budget: 8000 })).toContain('; outputBudget is 8000 — raise');
    expect(formatOutputLengthReason({ tokens, budget: 1e21 })).toContain('; outputBudget is 1000000000000000000000 — raise');
  });
  test('with no budget, an ambient plain-integer flag is named as what governs (council #232 r3 B1)', () => {
    // Named mutant "AMBIENTIGNORED": drop the two ambient branches — the default clause prints instead.
    expect(formatOutputLengthReason({ tokens, budget: null, ambientFlag: '64000' })).toContain(
      '; outputBudget is unset — the ambient OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX=64000 the engine was '
      + "started with governs (each leg reserves min(64000, the ceiling the engine's catalog knows for it)) — raise");
  });
  test('a malformed ambient flag is named as unmeasured, with the two measured fallbacks', () => {
    // Only a plain positive integer is measured to be honoured (probe D1/D2).
    expect(formatOutputLengthReason({ tokens, budget: null, ambientFlag: '64000abc' })).toContain(
      'outputBudget is unset and the ambient OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX=64000abc the engine was '
      + 'started with is not a plain positive integer — the only form measured to be honoured '
      + '(probe D1/D2: 64000abc and 0 fell back to 32000 silently); any other form is unmeasured');
    expect(formatOutputLengthReason({ tokens, budget: null, ambientFlag: '0' })).toContain(
      'outputBudget is unset and the ambient OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX=0 the engine was '
      + 'started with is not a plain positive integer — the only form measured to be honoured '
      + '(probe D1/D2: 64000abc and 0 fell back to 32000 silently); any other form is unmeasured');
  });
  test('an ambient flag beside a configured budget is not named — the budget overrode it', () => {
    const s = formatOutputLengthReason({ tokens, budget: 8000, ambientFlag: '64000' });
    expect(s).toContain('; outputBudget is 8000 — raise');
    expect(s).not.toContain('ambient');
  });
  test('an unreadable config is reported as such, never as "unset"', () => {
    expect(formatOutputLengthReason({ tokens, budget: undefined })).toContain('; outputBudget could not be read — raise');
  });
  test('missing token counts read as 0, never NaN', () => {
    expect(formatOutputLengthReason({ tokens: null, budget: null })).toContain(' — 0 reasoning / 0 output tokens;');
    expect(formatOutputLengthReason({ tokens: { output: 24000 }, budget: null })).toContain(' — 0 reasoning / 24000 output tokens;');
  });
  test('the prefix is the classifiable constant', () => {
    expect(OUTPUT_LENGTH_PREFIX).toBe('OUTPUT_LENGTH:');
    expect(formatOutputLengthReason({ tokens, budget: null }).startsWith(OUTPUT_LENGTH_PREFIX + ' ')).toBe(true);
  });
});
