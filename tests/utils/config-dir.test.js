const fs = require('fs');
const os = require('os');
const path = require('path');

describe('getConfigDir (amicus rebrand + dir-fallback shim)', () => {
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

  it('falls back to ~/.config/sidecar when it exists and amicus does not', () => {
    fs.mkdirSync(path.join(tmpHome, '.config', 'sidecar'), { recursive: true });
    expect(getConfigDir()()).toBe(path.join(tmpHome, '.config', 'sidecar'));
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
});
