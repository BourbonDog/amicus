'use strict';
/**
 * Council #216, A1/B2/C1 (raised independently by qwen, gpt and deepseek).
 *
 * `findDriftedStoredAliases` computed its "current resolution" with
 * `toStorableRoute(r, { models: catalog })` -- models only, providerFailures
 * discarded. So for a namespace whose fetch was REJECTED it produced the bare
 * direct form, while sidecar/setup.js (evidence-aware) persists the gateway
 * form. The audit then reports drift that does not exist, and its suggested
 * repair would write back exactly the unservable direct id #208 removed.
 */
const { findDriftedStoredAliases } = require('../src/utils/alias-audit');

// deepseek's DIRECT namespace is absent -- the shape a 401'd fetch leaves.
const CATALOG = [
  { id: 'openrouter/deepseek/deepseek-v4-pro', name: 'DS V4 Pro' },
  { id: 'openrouter/deepseek/deepseek-v4-flash', name: 'DS V4 Flash' },
];
const FAILURES = [{ provider: 'deepseek', reason: 'http-status', status: 401 }];

describe('findDriftedStoredAliases honours provider-failure evidence (#216 A1/B2/C1)', () => {
  test('does not report drift against a stored gateway route when the namespace was rejected', () => {
    const sources = [{ alias: 'deepseek', model: 'openrouter/deepseek/deepseek-v4-pro', source: 'user-config' }];
    const drifted = findDriftedStoredAliases(sources, { models: CATALOG, providerFailures: FAILURES });
    expect(drifted).toEqual([]);
  });

  test('still accepts a bare catalog array (existing callers unaffected)', () => {
    const sources = [{ alias: 'deepseek', model: 'openrouter/deepseek/deepseek-v4-pro', source: 'user-config' }];
    expect(Array.isArray(findDriftedStoredAliases(sources, CATALOG))).toBe(true);
  });
});
