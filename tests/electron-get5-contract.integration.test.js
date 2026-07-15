'use strict';
/**
 * @electron/get 5.x provisioning contract (integration).
 *
 * WHY child_process: @electron/get 5.x is ESM-only. `await import()` inside Jest hits Jest's
 * ESM limitation (needs --experimental-vm-modules), so the REAL import + download run in a
 * plain Node subprocess (the repo's established pattern for ESM-only deps, cf.
 * update-notifier-loader). @electron/get 5.x's exports map also forbids
 * require('@electron/get/package.json'), so the version is read via fs.
 *
 * The IMPORT contract runs whenever @electron/get@5 is present (no network) — a standing
 * regression test for the CJS->ESM boundary the self-heal depends on. The DOWNLOAD contract
 * (real network) is gated behind AMICUS_TEST_ELECTRON_DOWNLOAD.
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

const REPO = path.join(__dirname, '..');
function runNode(script) {
  return execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf-8', cwd: REPO });
}

const version = getVersion();
const isGet5 = !!version && version.startsWith('5');
const dImport = isGet5 ? describe : describe.skip;
const dDownload = (isGet5 && process.env.AMICUS_TEST_ELECTRON_DOWNLOAD) ? describe : describe.skip;

dImport('@electron/get 5.x import contract (no network)', () => {
  test('dynamic import resolves downloadArtifact in real Node', () => {
    const out = runNode(`const g = await import('@electron/get'); console.log('TYPEOF:' + typeof g.downloadArtifact);`);
    expect(out).toContain('TYPEOF:function');
  });
});

dDownload('@electron/get 5.x download contract (real network)', () => {
  jest.setTimeout(10 * 60 * 1000);

  test('a real download checksum-validates and lands in the expected cache root', () => {
    const out = runNode(`
      const g = await import('@electron/get');
      const zip = await g.downloadArtifact({ version: '43.1.1', artifactName: 'electron' });
      const fs = await import('node:fs');
      console.log('ZIP:' + zip + '|EXISTS:' + fs.existsSync(zip));
    `);
    expect(out).toMatch(/ZIP:.*electron-v43\.1\.1-.+\.zip\|EXISTS:true/);
  });

  test('a corrupted cache entry is re-validated by sumchecker, not trusted', () => {
    // Corrupt the cached zip, then re-download WITHOUT force: sumchecker must reject the
    // tampered cache and re-fetch a valid zip (integrity is enforced, not bypassed).
    const out = runNode(`
      const g = await import('@electron/get');
      const fs = await import('node:fs');
      const zip = await g.downloadArtifact({ version: '43.1.1', artifactName: 'electron' });
      const before = fs.statSync(zip).size;
      fs.writeFileSync(zip, Buffer.concat([fs.readFileSync(zip), Buffer.from('TAMPER')])); // corrupt cache
      const zip2 = await g.downloadArtifact({ version: '43.1.1', artifactName: 'electron' });
      const after = fs.statSync(zip2).size;
      console.log('AFTER_MATCHES_VALID:' + (after === before));
    `);
    // A re-validated, re-fetched zip has the correct (original) size, not the tampered size.
    expect(out).toContain('AFTER_MATCHES_VALID:true');
  });
});
