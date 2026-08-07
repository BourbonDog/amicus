// tests/gateway-route-catalog.test.js
'use strict';

const { pairAcrossGateways } = require('../src/utils/gateway-route-catalog');

/** Build a minimal catalogInfo (only `.models[].id` matters to this pure helper). */
const cat = (ids) => ({ models: ids.map((id) => ({ id })) });

describe('pairAcrossGateways — verbatim, conservative cross-gateway pairing', () => {
  test('opus: direct + openrouter rows present, dot/dash forms normalize to the same key', () => {
    const catalogInfo = cat([
      'anthropic/claude-opus-4-8',
      'openrouter/anthropic/claude-opus-4.8',
      'anthropic/claude-sonnet-5', // unrelated row, must not be picked up
      'openrouter/openai/gpt-5.5', // unrelated vendor, must not be picked up
    ]);

    expect(pairAcrossGateways('anthropic', 'claude-opus-4-8', catalogInfo)).toEqual({
      direct: 'anthropic/claude-opus-4-8',
      openrouter: 'openrouter/anthropic/claude-opus-4.8',
    });

    // Same result when the caller's versionToken is spelled with dots instead
    // of dashes -- normalization must treat '.' and '-' as equivalent for MATCH.
    expect(pairAcrossGateways('anthropic', 'claude-opus-4.8', catalogInfo)).toEqual({
      direct: 'anthropic/claude-opus-4-8',
      openrouter: 'openrouter/anthropic/claude-opus-4.8',
    });
  });

  test('haiku: direct row carries a trailing date suffix the OR row lacks', () => {
    const catalogInfo = cat([
      'anthropic/claude-haiku-4-5-20251001',
      'openrouter/anthropic/claude-haiku-4.5',
    ]);

    expect(pairAcrossGateways('anthropic', 'claude-haiku-4.5', catalogInfo)).toEqual({
      direct: 'anthropic/claude-haiku-4-5-20251001',
      openrouter: 'openrouter/anthropic/claude-haiku-4.5',
    });
  });

  // Synthetic fixture: pairAcrossGateways only ever sees the catalogInfo handed
  // to it here, never a live catalog -- what makes this shape historical is that
  // the live catalog now confirms a direct route for fable (authored 2026-08-05).
  // Kept to pin how the helper handles a model with genuinely no direct-side key.
  test('fable: OpenRouter-only model returns just the openrouter side, no direct key at all', () => {
    const catalogInfo = cat([
      'openrouter/anthropic/claude-fable-5',
      'anthropic/claude-opus-4-8', // unrelated direct row present in the same vendor namespace
    ]);

    const result = pairAcrossGateways('anthropic', 'claude-fable-5', catalogInfo);
    expect(result).toEqual({ openrouter: 'openrouter/anthropic/claude-fable-5' });
    expect(result.direct).toBeUndefined();
  });

  test('versionToken with no match in either namespace => {}', () => {
    const catalogInfo = cat([
      'anthropic/claude-opus-4-8',
      'openrouter/anthropic/claude-opus-4.8',
    ]);

    expect(pairAcrossGateways('anthropic', 'claude-nonexistent-99', catalogInfo)).toEqual({});
  });

  test('unknown vendor => {} even if the versionToken matches another vendor\'s model', () => {
    const catalogInfo = cat(['anthropic/claude-opus-4-8', 'openrouter/anthropic/claude-opus-4.8']);
    expect(pairAcrossGateways('openai', 'claude-opus-4-8', catalogInfo)).toEqual({});
  });

  test('ambiguous direct side (two direct rows normalize to the same key) is omitted, not guessed', () => {
    // Two dated direct variants both strip down to the same normalized key.
    // The helper must not pick one arbitrarily -- the direct side is dropped
    // entirely while the unambiguous openrouter side is still returned.
    const catalogInfo = cat([
      'anthropic/claude-sonnet-5-20250101',
      'anthropic/claude-sonnet-5-20250601',
      'openrouter/anthropic/claude-sonnet-5',
    ]);

    const result = pairAcrossGateways('anthropic', 'claude-sonnet-5', catalogInfo);
    expect(result).toEqual({ openrouter: 'openrouter/anthropic/claude-sonnet-5' });
    expect(result.direct).toBeUndefined();
  });

  test('ambiguous on both sides => {} (empty, never a fabricated pair)', () => {
    // Both namespaces contain two dated variants that normalize to the same
    // key -- neither side can be resolved with confidence, so both are omitted.
    const catalogInfo = cat([
      'anthropic/claude-sonnet-5-20250101',
      'anthropic/claude-sonnet-5-20250601',
      'openrouter/anthropic/claude-sonnet-5-20250101',
      'openrouter/anthropic/claude-sonnet-5-20250601',
    ]);

    expect(pairAcrossGateways('anthropic', 'claude-sonnet-5', catalogInfo)).toEqual({});
  });

  test('empty catalog => {}', () => {
    expect(pairAcrossGateways('anthropic', 'claude-opus-4-8', { models: [] })).toEqual({});
  });

  test('missing/malformed catalogInfo => {} (never throws)', () => {
    expect(pairAcrossGateways('anthropic', 'claude-opus-4-8', {})).toEqual({});
    expect(pairAcrossGateways('anthropic', 'claude-opus-4-8', null)).toEqual({});
    expect(pairAcrossGateways('anthropic', 'claude-opus-4-8', undefined)).toEqual({});
  });

  test('never-invent guarantee: every returned id is verbatim present in catalogInfo.models', () => {
    const ids = [
      'anthropic/claude-opus-4-8',
      'openrouter/anthropic/claude-opus-4.8',
      'anthropic/claude-haiku-4-5-20251001',
      'openrouter/anthropic/claude-haiku-4.5',
      'openrouter/anthropic/claude-fable-5',
      'openai/gpt-5.5',
      'openrouter/openai/gpt-5.5',
    ];
    const catalogInfo = cat(ids);

    const cases = [
      ['anthropic', 'claude-opus-4-8'],
      ['anthropic', 'claude-haiku-4.5'],
      ['anthropic', 'claude-fable-5'],
      ['openai', 'gpt-5.5'],
    ];

    for (const [vendor, token] of cases) {
      const result = pairAcrossGateways(vendor, token, catalogInfo);
      for (const side of ['direct', 'openrouter']) {
        if (result[side] !== undefined) {
          expect(ids.includes(result[side])).toBe(true);
        }
      }
    }
  });

  test('non-divergent vendor (openai) pairs both forms when ids are identical across gateways', () => {
    const catalogInfo = cat(['openai/gpt-5.5', 'openrouter/openai/gpt-5.5']);
    expect(pairAcrossGateways('openai', 'gpt-5.5', catalogInfo)).toEqual({
      direct: 'openai/gpt-5.5',
      openrouter: 'openrouter/openai/gpt-5.5',
    });
  });

  test('does not cross-match a different vendor whose model segment happens to be identical', () => {
    // e.g. two vendors both shipping a model literally named 'foo-1' should
    // never pair across vendors.
    const catalogInfo = cat(['openai/foo-1', 'openrouter/deepseek/foo-1']);
    expect(pairAcrossGateways('openai', 'foo-1', catalogInfo)).toEqual({ direct: 'openai/foo-1' });
    expect(pairAcrossGateways('deepseek', 'foo-1', catalogInfo)).toEqual({ openrouter: 'openrouter/deepseek/foo-1' });
  });

  // Task 6 (#gwid): Task 5 left the shape of `versionToken` untested beyond the
  // documented "bare model segment" contract. Task 6's caller (gateway-route-audit.js)
  // always strips `openrouter/<vendor>/` before calling -- these tests lock down
  // what happens on either side of a misuse of that contract, so a future caller
  // that forgets to strip can never silently corrupt a pairing.
  test('a versionToken still carrying the full openrouter/<vendor>/ prefix normalizes identically to the bare segment (robust, not a wrong match)', () => {
    const catalogInfo = cat([
      'anthropic/claude-opus-4-8',
      'openrouter/anthropic/claude-opus-4.8',
    ]);
    const bare = pairAcrossGateways('anthropic', 'claude-opus-4-8', catalogInfo);
    const prefixed = pairAcrossGateways('anthropic', 'openrouter/anthropic/claude-opus-4-8', catalogInfo);
    expect(prefixed).toEqual(bare);
    expect(prefixed).toEqual({
      direct: 'anthropic/claude-opus-4-8',
      openrouter: 'openrouter/anthropic/claude-opus-4.8',
    });
  });

  test('a versionToken prefixed with a DIFFERENT vendor than the `vendor` argument fails closed (=> {}, never a fabricated cross-vendor pair)', () => {
    const catalogInfo = cat([
      'anthropic/claude-opus-4-8',
      'openrouter/anthropic/claude-opus-4.8',
      'openai/gpt-5.5',
      'openrouter/openai/gpt-5.5',
    ]);
    // Caller passes an openai-shaped token while asking to pair against 'anthropic' --
    // normalizeKey only strips the DECLARED vendor's own prefix, so the mismatched
    // 'openai/' segment survives into the comparison key and matches nothing.
    expect(pairAcrossGateways('anthropic', 'openai/gpt-5.5', catalogInfo)).toEqual({});
  });
});
