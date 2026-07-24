'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');
const { getConfigDir } = require('../src/utils/config');
const { getEnvPath } = require('../src/utils/api-key-store');

// Proves the global setupFiles hermetic baseline (tests/setup/hermetic-config-dir.js):
// with NO per-test env setup, every config/keys read must resolve into an os.tmpdir()
// scratch dir, never the real ~/.config/amicus. If this suite fails, a test run can
// read or clobber the developer's real config and API keys.
describe('hermetic test baseline (global setupFiles)', () => {
  const tmpReal = fs.realpathSync(os.tmpdir());
  const isUnderTmp = (p) => {
    const rel = path.relative(tmpReal, fs.realpathSync(p));
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  };

  test('AMICUS_CONFIG_DIR and AMICUS_ENV_DIR are pinned under os.tmpdir()', () => {
    expect(process.env.AMICUS_CONFIG_DIR).toBeTruthy();
    expect(process.env.AMICUS_ENV_DIR).toBeTruthy();
    expect(isUnderTmp(process.env.AMICUS_CONFIG_DIR)).toBe(true);
    expect(isUnderTmp(process.env.AMICUS_ENV_DIR)).toBe(true);
  });

  test('getConfigDir() and getEnvPath() resolve inside os.tmpdir(), not real home', () => {
    expect(isUnderTmp(getConfigDir())).toBe(true);
    expect(isUnderTmp(path.dirname(getEnvPath()))).toBe(true);
    const realHome = process.env.HOME || process.env.USERPROFILE;
    if (realHome) {
      const realConfig = path.join(realHome, '.config', 'amicus');
      expect(getConfigDir().startsWith(realConfig)).toBe(false);
    }
  });

  test('the pinned config dir holds no real config.json (a fresh, empty sandbox)', () => {
    expect(fs.existsSync(path.join(process.env.AMICUS_CONFIG_DIR, 'config.json'))).toBe(false);
  });
});
