'use strict';
/**
 * Issue #214: the wizard renderer hand-copied `stripGatewayPrefix` as
 * `toBareIfDirect` (electron/setup-ui.js), dropping BOTH guards the real
 * primitive has -- DIVERGENT_VENDORS and the classifyModel/namespace check.
 * The renderer cannot `require()`, so the decision moves server-side and ships
 * as data: one safe storable form per (pick, provider).
 */
const { canonicalRoutesFor } = require('../src/utils/quick-picks');

const CATALOG = [
  // healthy: google's direct namespace is populated and serves the bare form
  { id: 'google/gemini-3.7-flash' },
  { id: 'openrouter/google/gemini-3.7-flash' },
  // anthropic: OpenRouter's dot id; the direct API serves only the dash form
  { id: 'anthropic/claude-opus-4-8' },
  { id: 'openrouter/anthropic/claude-opus-4.8' },
  // deepseek: direct namespace absent (its fetch was rejected)
  { id: 'openrouter/deepseek/deepseek-v4-pro' },
];

describe('canonicalRoutesFor (#214)', () => {
  test('strips to the direct form when the catalog proves it is served', () => {
    const pick = { vendorPath: 'google', routes: { openrouter: 'openrouter/google/gemini-3.7-flash' } };
    expect(canonicalRoutesFor(pick, { models: CATALOG }).openrouter).toBe('google/gemini-3.7-flash');
  });

  test('never strips a DIVERGENT vendor -- the renderer copy did, fabricating a dot id', () => {
    const pick = { vendorPath: 'anthropic', routes: { openrouter: 'openrouter/anthropic/claude-opus-4.8' } };
    expect(canonicalRoutesFor(pick, { models: CATALOG }).openrouter)
      .toBe('openrouter/anthropic/claude-opus-4.8');
  });

  test('never strips when the vendor namespace fetch was rejected', () => {
    const pick = { vendorPath: 'deepseek', routes: { openrouter: 'openrouter/deepseek/deepseek-v4-pro' } };
    const info = { models: CATALOG, providerFailures: [{ provider: 'deepseek', reason: 'http-status', status: 401 }] };
    expect(canonicalRoutesFor(pick, info).openrouter).toBe('openrouter/deepseek/deepseek-v4-pro');
  });

  test('leaves an already-direct route untouched', () => {
    const pick = { vendorPath: 'google', routes: { google: 'google/gemini-3.7-flash' } };
    expect(canonicalRoutesFor(pick, { models: CATALOG }).google).toBe('google/gemini-3.7-flash');
  });
});
