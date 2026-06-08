const path = require('path');

describe('getCompatEnv', () => {
  const SUFFIX = 'CONFIG_DIR';
  let warnSpy;

  beforeEach(() => {
    jest.resetModules();
    delete process.env.AMICUS_CONFIG_DIR;
    delete process.env.SIDECAR_CONFIG_DIR;
    warnSpy = jest.fn();
    jest.doMock('../../src/utils/logger', () => ({ logger: { warn: warnSpy, info: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
  });

  function load() {
    return require('../../src/utils/env-compat').getCompatEnv;
  }

  it('returns the AMICUS_ value when set', () => {
    process.env.AMICUS_CONFIG_DIR = '/new';
    expect(load()(SUFFIX)).toBe('/new');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('falls back to the SIDECAR_ value and warns once', () => {
    process.env.SIDECAR_CONFIG_DIR = '/legacy';
    const getCompatEnv = load();
    expect(getCompatEnv(SUFFIX)).toBe('/legacy');
    expect(getCompatEnv(SUFFIX)).toBe('/legacy');
    expect(warnSpy).toHaveBeenCalledTimes(1); // one-time warning
  });

  it('prefers AMICUS_ over SIDECAR_ when both are set', () => {
    process.env.AMICUS_CONFIG_DIR = '/new';
    process.env.SIDECAR_CONFIG_DIR = '/legacy';
    expect(load()(SUFFIX)).toBe('/new');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('returns undefined when neither is set', () => {
    expect(load()(SUFFIX)).toBeUndefined();
  });
});
