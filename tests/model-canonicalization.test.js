'use strict';

/**
 * Unit tests for the two canonicalization primitives extracted out of
 * provider-default-picker.js (issue 195 follow-up F1/B4/B6, council review
 * of PR 198): `directFormIfSafe` (list-building, optimistic) and
 * `directFormIfProven` (persistence, requires positive evidence). See
 * src/utils/model-canonicalization.js's module docstring for why they are
 * two separately-named functions instead of one with a mode flag.
 */

const {
  directFormIfSafe, directFormIfProven,
} = require('../src/utils/model-canonicalization');

const populatedGoogleCatalog = [
  // Authoritative, populated direct namespace that OMITS the gemma id below.
  { id: 'google/gemini-3.7-flash' },
  { id: 'openrouter/google/gemini-3.7-flash' },
  { id: 'openrouter/google/gemma-4-31b-it:free' },
];

describe('directFormIfSafe — list-building (optimistic: strip unless proven invalid)', () => {
  // The catalog here DELIBERATELY also carries a row at the stripped-prefix
  // (dot-preserved) form -- coincidental in reality, but it forces
  // classifyModel to return 'valid' for that bare id, so this test can only
  // pass if DIVERGENT_VENDORS is checked FIRST and unconditionally, before
  // classifyModel runs at all. A weaker fixture (no such row) would still
  // pass even with the gate deleted, since classifyModel would separately
  // return 'invalid' for the dot-form against a dash-only namespace --
  // proving nothing about the gate itself.
  test('divergent vendor (anthropic): always passed through, even when classifyModel would otherwise say the stripped form is valid', () => {
    const catalog = [
      { id: 'anthropic/claude-opus-4-8' },
      { id: 'anthropic/claude-opus-4.8' }, // coincidental dot-form row -- would classify 'valid'
      { id: 'openrouter/anthropic/claude-opus-4.8' },
    ];
    expect(directFormIfSafe('anthropic', 'openrouter/anthropic/claude-opus-4.8', { models: catalog }))
      .toBe('openrouter/anthropic/claude-opus-4.8');
  });

  test('gateway-only vendor (no direct integration at all): passed through unchanged', () => {
    expect(directFormIfSafe('qwen', 'openrouter/qwen/qwen3-max', { models: [] }))
      .toBe('openrouter/qwen/qwen3-max');
  });

  test('no evidence (empty catalog): strips -- a bare guess is reasonable when nothing disproves it', () => {
    expect(directFormIfSafe('deepseek', 'openrouter/deepseek/deepseek-v3.2', { models: [] }))
      .toBe('deepseek/deepseek-v3.2');
  });

  test('proven invalid (populated, authoritative namespace omits the bare id): kept OpenRouter-prefixed', () => {
    expect(directFormIfSafe('google', 'openrouter/google/gemma-4-31b-it:free', { models: populatedGoogleCatalog }))
      .toBe('openrouter/google/gemma-4-31b-it:free');
  });

  test('proven valid (bare id present in the catalog): strips', () => {
    expect(directFormIfSafe('google', 'openrouter/google/gemini-3.7-flash', { models: populatedGoogleCatalog }))
      .toBe('google/gemini-3.7-flash');
  });
});

describe('directFormIfProven — persistence (conservative: strip only on positive evidence)', () => {
  // Same reasoning as directFormIfSafe's equivalent test above: the
  // coincidental dot-form row forces classifyModel to return 'valid' for
  // the stripped id, so this only passes if DIVERGENT_VENDORS is gated
  // FIRST and unconditionally -- otherwise "positive evidence" (F1) would
  // wrongly authorize the strip.
  test('divergent vendor (anthropic): always passed through, even when classifyModel would otherwise say the stripped form is valid', () => {
    const catalog = [
      { id: 'anthropic/claude-opus-4-8' },
      { id: 'anthropic/claude-opus-4.8' }, // coincidental dot-form row -- would classify 'valid'
      { id: 'openrouter/anthropic/claude-opus-4.8' },
    ];
    expect(directFormIfProven('anthropic', 'openrouter/anthropic/claude-opus-4.8', { models: catalog }))
      .toBe('openrouter/anthropic/claude-opus-4.8');
  });

  test('gateway-only vendor: passed through unchanged', () => {
    expect(directFormIfProven('qwen', 'openrouter/qwen/qwen3-max', { models: [] }))
      .toBe('openrouter/qwen/qwen3-max');
  });

  // F1 (council review of PR 198): this is the corrected behavior. A failed
  // or absent catalog fetch is NO evidence either way -- directFormIfSafe's
  // "strip unless proven invalid" default would fabricate a direct id here
  // (the exact bug issue 195 fixed, reintroduced on every degraded fetch).
  // directFormIfProven instead preserves chosenId exactly as given.
  test('no evidence (empty catalog): id is preserved VERBATIM, never fabricated', () => {
    expect(directFormIfProven('deepseek', 'openrouter/deepseek/deepseek-v3.2', { models: [] }))
      .toBe('openrouter/deepseek/deepseek-v3.2');
  });

  test('no evidence (absent catalog, {models: undefined} coerced by the caller): id is preserved verbatim', () => {
    expect(directFormIfProven('deepseek', 'openrouter/deepseek/deepseek-v3.2', { models: [] }))
      .toBe('openrouter/deepseek/deepseek-v3.2');
  });

  test('proven invalid (populated, authoritative namespace omits the bare id): kept OpenRouter-prefixed', () => {
    expect(directFormIfProven('google', 'openrouter/google/gemma-4-31b-it:free', { models: populatedGoogleCatalog }))
      .toBe('openrouter/google/gemma-4-31b-it:free');
  });

  test('proven valid (bare id present in the catalog): strips -- happy path unaffected', () => {
    expect(directFormIfProven('google', 'openrouter/google/gemini-3.7-flash', { models: populatedGoogleCatalog }))
      .toBe('google/gemini-3.7-flash');
  });
});

// F1/B4: provider-default-picker.js's module.exports re-exports these two
// functions rather than wrapping or re-implementing them, so a caller using
// either import path gets the SAME function object -- pins the extraction
// as a pure move, not a fork that could silently diverge.
describe('extraction identity (pure move, not a duplicate)', () => {
  test('provider-default-picker.js re-exports the SAME function objects as model-canonicalization.js', () => {
    const picker = require('../src/utils/provider-default-picker');
    expect(picker.directFormIfSafe).toBe(directFormIfSafe);
    expect(picker.directFormIfProven).toBe(directFormIfProven);
  });
});
