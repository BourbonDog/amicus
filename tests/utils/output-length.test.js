'use strict';

const { OUTPUT_LENGTH_PREFIX, isOutputLengthDeath, formatOutputLengthReason } = require('../../src/utils/output-length');

describe('isOutputLengthDeath (#218 PR 3)', () => {
  test("finish 'length' with no output at all is the death (L1 shape)", () => {
    expect(isOutputLengthDeath({ finish: 'length', output: '', promotedReasoning: false })).toBe(true);
  });
  test("finish 'length' with output PROMOTED from reasoning is the death (L2/L4 shape)", () => {
    // Named mutant "PROMOTEIGNORED": drop the promotedReasoning clause — this reads false.
    expect(isOutputLengthDeath({ finish: 'length', output: 'thinking…', promotedReasoning: true })).toBe(true);
  });
  test("finish 'length' with real answer text is NOT the death — a cut review", () => {
    expect(isOutputLengthDeath({ finish: 'length', output: 'Partial review', promotedReasoning: false })).toBe(false);
  });
  test('no output with any other finish is not this death', () => {
    // Named mutant "NOTLENGTH": drop the finish check — 'stop' with no output reads true.
    expect(isOutputLengthDeath({ finish: 'stop', output: '', promotedReasoning: false })).toBe(false);
    expect(isOutputLengthDeath({ finish: null, output: '', promotedReasoning: false })).toBe(false);
    expect(isOutputLengthDeath({ finish: undefined, output: '' })).toBe(false);
  });
});

describe('formatOutputLengthReason (#218 PR 3)', () => {
  const tokens = { input: 5, output: 0, reasoning: 32000 };

  test('the ledger shape, budget unset: prefix, finish, counts, the engine default, the remedy', () => {
    expect(formatOutputLengthReason({ tokens, budget: null, promotedReasoning: false })).toBe(
      "OUTPUT_LENGTH: the provider stopped at the max_tokens reservation (finish 'length') and no answer text arrived — "
      + "32000 reasoning / 0 output tokens; outputBudget is unset — the engine's 32000 default reservation governs — "
      + 'raise outputBudget in config.json (docs/configuration.md, Output budget)');
  });
  test('promoted reasoning says so', () => {
    expect(formatOutputLengthReason({ tokens, budget: null, promotedReasoning: true }))
      .toContain('and only reasoning was streamed, no answer text — 32000 reasoning / 0 output tokens');
  });
  test('a configured budget is named as plain digits', () => {
    // Named mutant "BUDGETUNSET": always print the unset clause — 8000 never appears.
    expect(formatOutputLengthReason({ tokens, budget: 8000 })).toContain('; outputBudget is 8000 — raise');
    expect(formatOutputLengthReason({ tokens, budget: 1e21 })).toContain('; outputBudget is 1000000000000000000000 — raise');
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
