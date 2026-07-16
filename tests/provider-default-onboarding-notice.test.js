'use strict';

// Existing-user one-time onboarding offer (Part 2, Task 9) -- a single
// non-blocking notice line pointing configured-but-not-yet-onboarded users at
// the per-provider cost-aware default picker (`amicus key <provider>`, Task
// 6). This is a printed line, NEVER an interactive prompt -- it must not
// touch stdin.
//
// Mirrors tests/routing-migration-notice.test.js's jest.doMock factory style:
// config/api-key-store/provider-registry are mocked so the gating logic is
// exercised in isolation, plus the isTTY-toggle pattern from
// tests/start-helpers-routing.test.js.

const ALL_FALSE = { openrouter: false, google: false, openai: false, anthropic: false, deepseek: false };
const DIRECT_PROVIDERS = ['google', 'openai', 'anthropic', 'deepseek'];

function loadStartHelpers({
  apiKeys = ALL_FALSE,
  aliases = {},
  hasTierOnboarded = () => false,
  markTierOnboarded = jest.fn(),
} = {}) {
  jest.resetModules();
  jest.doMock('../src/utils/config', () => ({
    hasTierOnboarded,
    markTierOnboarded,
    loadConfig: () => ({ aliases }),
  }));
  jest.doMock('../src/utils/api-key-store', () => ({
    readApiKeys: () => apiKeys,
  }));
  jest.doMock('../src/utils/provider-registry', () => ({
    listDirectProviders: () => DIRECT_PROVIDERS,
  }));
  return require('../src/utils/start-helpers');
}

function withTTY(value, fn) {
  const orig = process.stdin.isTTY;
  process.stdin.isTTY = value;
  try {
    return fn();
  } finally {
    process.stdin.isTTY = orig;
  }
}

afterEach(() => {
  jest.dontMock('../src/utils/config');
  jest.dontMock('../src/utils/api-key-store');
  jest.dontMock('../src/utils/provider-registry');
  jest.resetModules();
});

describe('maybeOfferProviderDefaults', () => {
  test('fires once: prints the tip and marks onboarded (direct key exists, flag unset, no vendor alias, interactive)', () => {
    withTTY(true, () => {
      const markTierOnboarded = jest.fn();
      const { maybeOfferProviderDefaults } = loadStartHelpers({
        apiKeys: { ...ALL_FALSE, openai: true },
        markTierOnboarded,
      });
      const outSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

      maybeOfferProviderDefaults({});

      expect(outSpy).toHaveBeenCalledTimes(1);
      expect(outSpy.mock.calls[0][0]).toMatch(/amicus key <provider>/);
      expect(markTierOnboarded).toHaveBeenCalledTimes(1);
      outSpy.mockRestore();
    });
  });

  test('suppressed on the second call: hasTierOnboarded() true -> no print, flag not re-set', () => {
    withTTY(true, () => {
      const markTierOnboarded = jest.fn();
      const { maybeOfferProviderDefaults } = loadStartHelpers({
        apiKeys: { ...ALL_FALSE, openai: true },
        hasTierOnboarded: () => true,
        markTierOnboarded,
      });
      const outSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

      maybeOfferProviderDefaults({});

      expect(outSpy).not.toHaveBeenCalled();
      expect(markTierOnboarded).not.toHaveBeenCalled();
      outSpy.mockRestore();
    });
  });

  test('suppressed when a vendor-named alias already exists (user already used the picker)', () => {
    withTTY(true, () => {
      const markTierOnboarded = jest.fn();
      const { maybeOfferProviderDefaults } = loadStartHelpers({
        apiKeys: { ...ALL_FALSE, openai: true },
        aliases: { openai: 'openai/gpt-5.5' },
        markTierOnboarded,
      });
      const outSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

      maybeOfferProviderDefaults({});

      expect(outSpy).not.toHaveBeenCalled();
      expect(markTierOnboarded).not.toHaveBeenCalled();
      outSpy.mockRestore();
    });
  });

  test('suppressed non-interactively: --json set, even on a TTY', () => {
    withTTY(true, () => {
      const markTierOnboarded = jest.fn();
      const { maybeOfferProviderDefaults } = loadStartHelpers({
        apiKeys: { ...ALL_FALSE, openai: true },
        markTierOnboarded,
      });
      const outSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

      maybeOfferProviderDefaults({ json: true });

      expect(outSpy).not.toHaveBeenCalled();
      expect(markTierOnboarded).not.toHaveBeenCalled();
      outSpy.mockRestore();
    });
  });

  test('suppressed non-interactively: --quiet set, even on a TTY', () => {
    withTTY(true, () => {
      const markTierOnboarded = jest.fn();
      const { maybeOfferProviderDefaults } = loadStartHelpers({
        apiKeys: { ...ALL_FALSE, openai: true },
        markTierOnboarded,
      });
      const outSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

      maybeOfferProviderDefaults({ quiet: true });

      expect(outSpy).not.toHaveBeenCalled();
      expect(markTierOnboarded).not.toHaveBeenCalled();
      outSpy.mockRestore();
    });
  });

  test('suppressed non-interactively: not a TTY at all', () => {
    withTTY(false, () => {
      const markTierOnboarded = jest.fn();
      const { maybeOfferProviderDefaults } = loadStartHelpers({
        apiKeys: { ...ALL_FALSE, openai: true },
        markTierOnboarded,
      });
      const outSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

      maybeOfferProviderDefaults({});

      expect(outSpy).not.toHaveBeenCalled();
      expect(markTierOnboarded).not.toHaveBeenCalled();
      outSpy.mockRestore();
    });
  });

  test('suppressed when no direct provider has a key (e.g. only openrouter configured)', () => {
    withTTY(true, () => {
      const markTierOnboarded = jest.fn();
      const { maybeOfferProviderDefaults } = loadStartHelpers({
        apiKeys: { ...ALL_FALSE, openrouter: true },
        markTierOnboarded,
      });
      const outSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

      maybeOfferProviderDefaults({});

      expect(outSpy).not.toHaveBeenCalled();
      expect(markTierOnboarded).not.toHaveBeenCalled();
      outSpy.mockRestore();
    });
  });

  test('never throws: an error inside the gating logic is swallowed (try/catch safety net)', () => {
    withTTY(true, () => {
      jest.resetModules();
      jest.doMock('../src/utils/config', () => ({
        hasTierOnboarded: () => { throw new Error('boom'); },
        markTierOnboarded: jest.fn(),
        loadConfig: () => ({}),
      }));
      jest.doMock('../src/utils/api-key-store', () => ({ readApiKeys: () => ALL_FALSE }));
      jest.doMock('../src/utils/provider-registry', () => ({ listDirectProviders: () => [] }));
      const { maybeOfferProviderDefaults } = require('../src/utils/start-helpers');

      expect(() => maybeOfferProviderDefaults({})).not.toThrow();
    });
  });
});

describe('maybeOfferProviderDefaults - real config integration (no mutation beyond the flag)', () => {
  const os = require('os');
  const path = require('path');
  const fs = require('fs');
  const CFG = path.join(os.tmpdir(), `amicus-tier-onboarding-notice-${process.pid}`);

  beforeEach(() => {
    process.env.AMICUS_CONFIG_DIR = CFG;
    fs.mkdirSync(CFG, { recursive: true });
  });

  afterEach(() => {
    delete process.env.AMICUS_CONFIG_DIR;
    fs.rmSync(CFG, { recursive: true, force: true });
    jest.dontMock('../src/utils/api-key-store');
    jest.resetModules();
  });

  // provider-registry is intentionally left UNMOCKED here (unlike the
  // doMock-everything tests above): config.js's own top-level require of
  // provider-registry (for isDirectProvider) must resolve to the real module,
  // and the real listDirectProviders() already returns exactly
  // ['google','openai','anthropic','deepseek'] -- no need to fake it.

  test('only writes routing.tier_onboarded; existing default/aliases/other routing keys are untouched', () => {
    jest.resetModules();
    jest.doMock('../src/utils/api-key-store', () => ({
      readApiKeys: () => ({ ...ALL_FALSE, anthropic: true }),
    }));
    fs.writeFileSync(path.join(CFG, 'config.json'), JSON.stringify({
      default: 'sonnet',
      aliases: { sonnet: 'anthropic/claude-sonnet-4-6' },
      routing: { prefer: 'direct' },
    }));

    withTTY(true, () => {
      const { maybeOfferProviderDefaults } = require('../src/utils/start-helpers');
      const outSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

      maybeOfferProviderDefaults({});

      expect(outSpy).toHaveBeenCalledTimes(1);
      outSpy.mockRestore();
    });

    const written = JSON.parse(fs.readFileSync(path.join(CFG, 'config.json'), 'utf-8'));
    expect(written).toEqual({
      default: 'sonnet',
      aliases: { sonnet: 'anthropic/claude-sonnet-4-6' },
      routing: { prefer: 'direct', tier_onboarded: true },
    });
  });

  test('second run is a no-op: config is byte-identical after the flag is already set', () => {
    jest.resetModules();
    jest.doMock('../src/utils/api-key-store', () => ({
      readApiKeys: () => ({ ...ALL_FALSE, anthropic: true }),
    }));
    fs.writeFileSync(path.join(CFG, 'config.json'), JSON.stringify({
      routing: { tier_onboarded: true },
    }));

    withTTY(true, () => {
      const { maybeOfferProviderDefaults } = require('../src/utils/start-helpers');
      const outSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

      maybeOfferProviderDefaults({});

      expect(outSpy).not.toHaveBeenCalled();
      outSpy.mockRestore();
    });

    const written = JSON.parse(fs.readFileSync(path.join(CFG, 'config.json'), 'utf-8'));
    expect(written).toEqual({ routing: { tier_onboarded: true } });
  });
});
