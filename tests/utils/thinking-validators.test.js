'use strict';
const { validateThinkingLevel, VARIANT_LEVELS } = require('../../src/utils/thinking-validators');
const { VARIANT_LEVELS: ENGINE_LEVELS } = require('../../src/utils/engine-variants');

describe('validateThinkingLevel — a vocabulary check only (#218 PR 4)', () => {
  it('is the same array engine-variants exports (identity, not a copy)', () => {
    // Named mutant "COPIEDLIST": a local literal — equal today, drifts tomorrow.
    expect(VARIANT_LEVELS).toBe(ENGINE_LEVELS);
  });
  it('accepts every level the curated routes declare, `max` included (M0)', () => {
    for (const level of ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']) {
      expect(validateThinkingLevel(level)).toEqual({ valid: true });
    }
  });
  it('accepts an omitted level', () => { expect(validateThinkingLevel(undefined)).toEqual({ valid: true }); });
  it('rejects a level outside the vocabulary, naming it', () => {
    expect(validateThinkingLevel('turbo')).toEqual({ valid: false, error: 'Error: --thinking must be one of: none, minimal, low, medium, high, xhigh, max' });
  });
  it('never adjusts: there is no per-model table and no warning (the engine\'s declaration decides at send time)', () => {
    // Named mutant "ADJUSTBACK": return {valid: true, warning, adjustedLevel: 'medium'} for 'minimal'.
    const r = validateThinkingLevel('minimal');
    expect(r).toEqual({ valid: true });
    expect(r).not.toHaveProperty('adjustedLevel');
    expect(require('../../src/utils/thinking-validators')).not.toHaveProperty('MODEL_THINKING_SUPPORT');
    expect(require('../../src/utils/validators')).not.toHaveProperty('getSupportedThinkingLevels');
  });
});
