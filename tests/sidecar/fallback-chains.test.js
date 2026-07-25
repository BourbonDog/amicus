'use strict';

const { resolveFallbackConfig, deriveChain, vendorOf } = require('../../src/sidecar/fallback-chains');

describe('resolveFallbackConfig (default OFF; flag wins)', () => {
  test('default OFF when nothing set', () => {
    expect(resolveFallbackConfig({ config: {} }).enabled).toBe(false);
  });
  test('config enables it; --no-fallback overrides back off', () => {
    expect(resolveFallbackConfig({ config: { fallbacks: { enabled: true } } }).enabled).toBe(true);
    expect(resolveFallbackConfig({ flagFallback: false, config: { fallbacks: { enabled: true } } }).enabled).toBe(false);
  });
  test('--fallback enables even when config is silent', () => {
    expect(resolveFallbackConfig({ flagFallback: true, config: {} }).enabled).toBe(true);
  });
  test('maxSubstitutions defaults to 2', () => {
    expect(resolveFallbackConfig({ config: {} }).maxSubstitutions).toBe(2);
  });
});

describe('deriveChain', () => {
  const catalog = [
    { id: 'anthropic/claude-opus-5' },
    { id: 'anthropic/claude-sonnet-5' },
    { id: 'anthropic/claude-haiku-5' },
  ];

  test('explicit config chain wins verbatim', () => {
    const chain = deriveChain('opus', { config: { chains: { opus: ['sonnet', 'openrouter/x/y'] } }, catalog });
    expect(chain).toEqual(['sonnet', 'openrouter/x/y']);
  });

  test('tier-walk default: opus -> sonnet -> haiku, dropping the failed model', () => {
    const chain = deriveChain('anthropic/claude-opus-5', { config: {}, catalog });
    expect(chain).toEqual(['anthropic/claude-sonnet-5', 'anthropic/claude-haiku-5']);
  });

  test('tier-walk default: a failed sonnet only offers CHEAPER substitutes (regression guard)', () => {
    const chain = deriveChain('anthropic/claude-sonnet-5', { config: {}, catalog });
    expect(chain).toEqual(['anthropic/claude-haiku-5']);
    expect(chain).not.toContain('anthropic/claude-opus-5');
  });

  test('unknown vendor -> empty chain (leg fails as today)', () => {
    expect(deriveChain('mystery/model-1', { config: {}, catalog: [] })).toEqual([]);
  });
});

describe('vendorOf', () => {
  test('strips openrouter/ and takes the vendor segment', () => {
    expect(vendorOf('openrouter/anthropic/claude-opus-5')).toBe('anthropic');
    expect(vendorOf('anthropic/claude-opus-5')).toBe('anthropic');
    expect(vendorOf('opus')).toBe('opus'); // bare alias -> itself (config lookup key)
  });
});
