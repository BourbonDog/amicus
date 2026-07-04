// tests/scripts/ci-workflow.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const WF = path.join(__dirname, '..', '..', '.github', 'workflows', 'ci.yml');

describe('ci workflow (B43 — actionlint in CI)', () => {
  const yml = () => fs.readFileSync(WF, 'utf-8');

  test('quality job lints GitHub Actions workflows with actionlint, pinned to a release version', () => {
    const y = yml();
    expect(y).toContain('actionlint');
    // pinned version string — never "latest"/unpinned. The download-actionlint.bash
    // script takes the version as its first positional arg; require the same
    // pinned tag to appear in both the download URL and the invocation.
    const versionMatches = [...y.matchAll(/actionlint[^\n]*v?(\d+\.\d+\.\d+)/g)].map((m) => m[1]);
    expect(versionMatches.length).toBeGreaterThan(0);
    const distinctVersions = new Set(versionMatches);
    expect(distinctVersions.size).toBe(1);
    expect(y).not.toMatch(/download-actionlint\.bash["'`\s]*\)?\s*$/m);
  });

  test('actionlint step lives in the quality job (ubuntu-latest, alongside lint/secrets/sizes)', () => {
    const y = yml();
    const qualityIdx = y.indexOf('quality:');
    const windowsSmokeIdx = y.indexOf('windows-install-smoke:');
    expect(qualityIdx).toBeGreaterThan(-1);
    expect(windowsSmokeIdx).toBeGreaterThan(qualityIdx);
    const qualityBlock = y.slice(qualityIdx, windowsSmokeIdx);
    expect(qualityBlock).toContain('actionlint');
    expect(qualityBlock).toContain('npm run lint');
    expect(qualityBlock).toContain('npm run check:sizes');
  });
});
