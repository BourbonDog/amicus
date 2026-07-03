const fs = require('fs');
const os = require('os');
const path = require('path');

describe('getConfigDir (amicus rebrand; legacy dir fallback removed #19)', () => {
  let tmpHome;
  const orig = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-home-'));
    delete process.env.AMICUS_CONFIG_DIR;
    delete process.env.SIDECAR_CONFIG_DIR;
    process.env.HOME = tmpHome;
    process.env.USERPROFILE = tmpHome;
  });

  afterEach(() => {
    process.env = { ...orig };
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  const getConfigDir = () => require('../../src/utils/config').getConfigDir;

  it('defaults to ~/.config/amicus when no legacy dir exists', () => {
    expect(getConfigDir()()).toBe(path.join(tmpHome, '.config', 'amicus'));
  });

  it('ignores ~/.config/sidecar even when it exists and amicus does not (#19 absence pin)', () => {
    fs.mkdirSync(path.join(tmpHome, '.config', 'sidecar'), { recursive: true });
    expect(getConfigDir()()).toBe(path.join(tmpHome, '.config', 'amicus'));
  });

  it('prefers ~/.config/amicus when both exist', () => {
    fs.mkdirSync(path.join(tmpHome, '.config', 'sidecar'), { recursive: true });
    fs.mkdirSync(path.join(tmpHome, '.config', 'amicus'), { recursive: true });
    expect(getConfigDir()()).toBe(path.join(tmpHome, '.config', 'amicus'));
  });

  it('honors AMICUS_CONFIG_DIR override', () => {
    process.env.AMICUS_CONFIG_DIR = path.join(tmpHome, 'custom');
    expect(getConfigDir()()).toBe(path.join(tmpHome, 'custom'));
  });

  it('ignores the legacy SIDECAR_CONFIG_DIR override (#19 absence pin)', () => {
    process.env.SIDECAR_CONFIG_DIR = path.join(tmpHome, 'legacy-custom');
    expect(getConfigDir()()).not.toBe(path.join(tmpHome, 'legacy-custom'));
    expect(getConfigDir()()).toBe(path.join(tmpHome, '.config', 'amicus'));
  });

  it('migrateLegacyConfigDir no longer exists as an export (#19 absence pin)', () => {
    const config = require('../../src/utils/config');
    expect(config.migrateLegacyConfigDir).toBeUndefined();
  });
});
