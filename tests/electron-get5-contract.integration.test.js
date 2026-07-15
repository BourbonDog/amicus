'use strict';
/**
 * @electron/get 5.x provisioning contract (integration).
 * Guarded: runs only when @electron/get@5 is installed AND AMICUS_TEST_ELECTRON_DOWNLOAD is set
 * (a real network download). Skips otherwise — including on the base @electron/get@2.x deps.
 *
 * WHY child_process: @electron/get 5.x is ESM-only. `await import()` inside Jest hits Jest's
 * ESM limitation (needs --experimental-vm-modules), so the REAL import + download run in a
 * plain Node subprocess (the repo's established pattern for ESM-only deps, cf.
 * update-notifier-loader). @electron/get 5.x's exports map also forbids
 * require('@electron/get/package.json'), so the version is read via fs (walking up from the
 * resolved entry), not require.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function getVersion() {
  try {
    let dir = path.dirname(require.resolve('@electron/get'));
    for (let i = 0; i < 5; i++) {
      const pkg = path.join(dir, 'package.json');
      if (fs.existsSync(pkg)) {
        const j = JSON.parse(fs.readFileSync(pkg, 'utf-8'));
        if (j.name === '@electron/get') { return j.version; }
      }
      dir = path.dirname(dir);
    }
  } catch { /* fall through */ }
  return null;
}

const version = getVersion();
const isGet5 = !!version && version.startsWith('5');
const d = (isGet5 && process.env.AMICUS_TEST_ELECTRON_DOWNLOAD) ? describe : describe.skip;

d('@electron/get 5.x provisioning contract', () => {
  jest.setTimeout(10 * 60 * 1000);

  test('dynamic import resolves downloadArtifact in real Node', () => {
    const out = execFileSync(process.execPath, ['--input-type=module', '-e',
      `const g = await import('@electron/get'); console.log('TYPEOF:' + typeof g.downloadArtifact);`,
    ], { encoding: 'utf-8', cwd: path.join(__dirname, '..') });
    expect(out).toContain('TYPEOF:function');
  });

  test('a real download checksum-validates and lands in the expected cache root', () => {
    const script = `
      const g = await import('@electron/get');
      const zip = await g.downloadArtifact({ version: '43.1.1', artifactName: 'electron' });
      const fs = await import('node:fs');
      console.log('ZIP:' + zip + '|EXISTS:' + fs.existsSync(zip));
    `;
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', script],
      { encoding: 'utf-8', cwd: path.join(__dirname, '..') });
    expect(out).toMatch(/ZIP:.*electron-v43\.1\.1-.+\.zip\|EXISTS:true/);
    // sumchecker validation is implicit: a checksum failure throws in the subprocess
    // (non-zero exit) and execFileSync would reject before this assertion.
  });
});
