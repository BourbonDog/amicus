// tests/sidecar/aliases-review-e2e.test.js
'use strict';

/**
 * F4b: `runReview`'s deps now MERGE onto `defaultDeps()` instead of replacing
 * it wholesale, so a test can inject only the interactive edges
 * (isTTY/ask/write/stderr) and let every real collaborator run — real
 * config read/normalize/save, real addAlias/removeAlias — against the
 * hermetic scratch config (AMICUS_CONFIG_DIR), exactly as a live `amicus
 * aliases --review` session would. Only `../../src/utils/model-catalog` is
 * mocked (no real network); everything else is the genuine module.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const FRESH_CATALOG = {
  models: [
    { id: 'openrouter/z-ai/glm-5.2' },
    { id: 'openrouter/z-ai/glm-5.3' },
    { id: 'openrouter/z-ai/glm-5.4' },
  ],
  fetchedAt: Date.now(),
  lastRefreshAttempt: null,
  lastRefreshError: null,
  providerFailures: [],
  ceilingEnrichment: null,
};

/** @returns {Function} an `ask` that hands out `answers` in order, then throws */
function scriptedAsk(answers) {
  const queue = [...answers];
  return async () => {
    if (queue.length === 0) { throw new Error('no more scripted answers'); }
    return queue.shift();
  };
}

describe('aliases --review — e2e against a real scratch config (#238 PR1 fix wave F4b)', () => {
  let cfg, runReview;

  beforeEach(() => {
    jest.resetModules();
    process.env.AMICUS_CONFIG_DIR = path.join(os.tmpdir(), `amicus-aliases-review-e2e-${process.pid}-${Date.now()}`);
    fs.rmSync(process.env.AMICUS_CONFIG_DIR, { recursive: true, force: true });
    jest.doMock('../../src/utils/model-catalog', () => ({
      getCatalogInfo: jest.fn(async () => FRESH_CATALOG),
      readCache: jest.fn(() => FRESH_CATALOG),
      DEFAULT_MAX_AGE_MS: 24 * 60 * 60 * 1000,
    }));
    cfg = require('../../src/utils/config');
    ({ runReview } = require('../../src/sidecar/aliases-review'));
  });

  afterEach(() => {
    fs.rmSync(process.env.AMICUS_CONFIG_DIR, { recursive: true, force: true });
  });

  test('accept [1] the newer sibling: the on-disk config pins glm to glm-5.4', async () => {
    cfg.saveConfig({ aliases: { glm: 'openrouter/z-ai/glm-5.2' } });
    const code = await runReview({}, { isTTY: true, ask: scriptedAsk(['1']), write: () => {}, stderr: () => {} });
    expect(code).toBe(0);
    const onDisk = JSON.parse(fs.readFileSync(cfg.getConfigPath(), 'utf-8'));
    expect(onDisk.aliases.glm).toBe('openrouter/z-ai/glm-5.4');
  });

  test('follow [2] the shipped pin: the on-disk config has no glm key, and getEffectiveAliases().glm is the shipped id', async () => {
    cfg.saveConfig({ aliases: { glm: 'openrouter/z-ai/glm-5.2' } });
    const code = await runReview({}, { isTTY: true, ask: scriptedAsk(['2']), write: () => {}, stderr: () => {} });
    expect(code).toBe(0);
    const onDisk = JSON.parse(fs.readFileSync(cfg.getConfigPath(), 'utf-8'));
    expect(Object.prototype.hasOwnProperty.call(onDisk.aliases || {}, 'glm')).toBe(false);
    expect(cfg.getEffectiveAliases().glm).toBe(cfg.getDefaultAliases().glm);
  });
});
