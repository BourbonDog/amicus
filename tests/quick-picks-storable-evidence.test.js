'use strict';
/**
 * Issue #214, remedy 1. `toStorableRoute` decides direct-vs-gateway and its
 * result is PERSISTED -- `sidecar/setup.js` writes it straight into
 * `config.aliases` for the chosen default when it differs from the shipped
 * pin (#238 Q9). It carried a DIVERGENT_VENDORS guard but no catalog evidence
 * at all, so it could not tell "the direct form is served" from "we have no
 * idea" -- the same gap #208 closed on the picker path, still open on the
 * persistence path.
 */
const { toStorableRoute } = require('../src/utils/quick-picks');

const PICK = {
  alias: 'deepseek',
  vendorPath: 'deepseek',
  routes: { openrouter: 'openrouter/deepseek/deepseek-v4-pro' },
};

describe('toStorableRoute requires evidence (#214)', () => {
  test('a vendor whose namespace fetch was REJECTED is stored as the gateway route', () => {
    const info = {
      models: [{ id: 'openrouter/deepseek/deepseek-v4-pro' }],
      providerFailures: [{ provider: 'deepseek', reason: 'http-status', status: 401 }],
    };
    expect(toStorableRoute(PICK, info)).toBe('openrouter/deepseek/deepseek-v4-pro');
  });

  test('a direct form the catalog PROVES absent is stored as the gateway route', () => {
    const info = {
      models: [
        { id: 'openrouter/deepseek/deepseek-v4-pro' },
        { id: 'deepseek/deepseek-v4-flash' }, // populated namespace, WITHOUT v4-pro
      ],
    };
    expect(toStorableRoute(PICK, info)).toBe('openrouter/deepseek/deepseek-v4-pro');
  });

  test('a direct form the catalog confirms is stored bare (direct-first preserved)', () => {
    const info = {
      models: [
        { id: 'openrouter/deepseek/deepseek-v4-pro' },
        { id: 'deepseek/deepseek-v4-pro' },
      ],
    };
    expect(toStorableRoute(PICK, info)).toBe('deepseek/deepseek-v4-pro');
  });

  test('with no catalog at all it still strips -- never-fetched stays optimistic', () => {
    expect(toStorableRoute(PICK)).toBe('deepseek/deepseek-v4-pro');
  });
});
