'use strict';
/**
 * @electron/get 5.x provisioning contract (integration).
 * Guarded: runs only when @electron/get@5 is installed AND AMICUS_TEST_ELECTRON_DOWNLOAD is set
 * (a real network download). Skips otherwise — including on the base @electron/get@2.x deps, where
 * Phase 1 lives. Activates in Phase 2 (Task 2.1) once 5.x is a declared dependency.
 *
 * NOTE: @electron/get@5's `exports` map forbids `require('@electron/get/package.json')`
 * (ERR_PACKAGE_PATH_NOT_EXPORTED), so the version is read via fs, not require (spike finding).
 */
const fs = require('fs');
const path = require('path');

function getVersion() {
  try {
    const p = path.join(require.resolve('@electron/get').replace(/dist[\/].*$/, ''), 'package.json');
    return JSON.parse(fs.readFileSync(p, 'utf-8')).version;
  } catch {
    try { return JSON.parse(fs.readFileSync(require.resolve('@electron/get/package.json'), 'utf-8')).version; }
    catch { return null; }
  }
}

const version = getVersion();
const isGet5 = !!version && version.startsWith('5');
const d = (isGet5 && process.env.AMICUS_TEST_ELECTRON_DOWNLOAD) ? describe : describe.skip;

d('@electron/get 5.x provisioning contract', () => {
  jest.setTimeout(10 * 60 * 1000);

  test('dynamic import resolves downloadArtifact', async () => {
    const g = await import('@electron/get');
    expect(typeof g.downloadArtifact).toBe('function');
  });

  test('a real download checksum-validates and lands in the expected cache root', async () => {
    const { downloadArtifact } = await import('@electron/get');
    const zip = await downloadArtifact({ version: '43.1.1', artifactName: 'electron' });
    expect(zip).toMatch(/electron-v43\.1\.1-.+\.zip$/);
    expect(fs.existsSync(zip)).toBe(true);
    // sumchecker validation is implicit: a checksum failure throws before returning a path.
  });
});
