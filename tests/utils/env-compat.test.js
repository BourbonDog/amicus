/**
 * src/utils/env-compat.js (getCompatEnv) was removed in #19 — the SIDECAR_*
 * env-var fallback shim no longer exists. This is a representative absence
 * pin at one consumer (config.js's getConfigDir, which used to route through
 * getCompatEnv('CONFIG_DIR')): SIDECAR_CONFIG_DIR must now be silently
 * ignored, and only AMICUS_CONFIG_DIR is honored.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

describe('SIDECAR_* env fallback removal (#19)', () => {
  const origAmicus = process.env.AMICUS_CONFIG_DIR;
  const origLegacy = process.env.SIDECAR_CONFIG_DIR;

  afterEach(() => {
    if (origAmicus === undefined) { delete process.env.AMICUS_CONFIG_DIR; } else { process.env.AMICUS_CONFIG_DIR = origAmicus; }
    if (origLegacy === undefined) { delete process.env.SIDECAR_CONFIG_DIR; } else { process.env.SIDECAR_CONFIG_DIR = origLegacy; }
    jest.resetModules();
  });

  it('the env-compat module no longer exists', () => {
    expect(() => require('../../src/utils/env-compat')).toThrow();
  });

  it('SIDECAR_CONFIG_DIR is ignored by getConfigDir (absence pin)', () => {
    jest.resetModules();
    delete process.env.AMICUS_CONFIG_DIR;
    const legacyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-cfg-'));
    process.env.SIDECAR_CONFIG_DIR = legacyDir;
    const { getConfigDir } = require('../../src/utils/config');
    expect(getConfigDir()).not.toBe(path.resolve(legacyDir));
  });

  it('AMICUS_CONFIG_DIR still works directly (no shim needed)', () => {
    jest.resetModules();
    delete process.env.SIDECAR_CONFIG_DIR;
    const amicusDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-cfg-'));
    process.env.AMICUS_CONFIG_DIR = amicusDir;
    const { getConfigDir } = require('../../src/utils/config');
    expect(getConfigDir()).toBe(path.resolve(amicusDir));
  });
});
