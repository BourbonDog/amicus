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

describe('ci workflow — the macOS/node-24 SIGSEGV mitigation', () => {
  const yml = () => fs.readFileSync(WF, 'utf-8');

  // The mitigation is defense-in-depth against a NATIVE crash: it produces no
  // assertion failure when it works and no assertion failure when it is removed,
  // so nothing else in the repo would notice its loss. These pins are the only
  // thing standing between a silent deletion and the flake coming back.
  test('the macos/node-24 matrix leg still carries a workerIdleMemoryLimit', () => {
    const y = yml();
    const include = y.slice(y.indexOf('include:'), y.indexOf('steps:'));
    expect(include).toMatch(/os:\s*macos-latest/);
    expect(include).toMatch(/node:\s*24/);
    expect(include).toMatch(/jest-flags:\s*--workerIdleMemoryLimit=\d+(MB|GB)/);
  });

  test('the limit is at most 512MB — the escalation after the 2026-08-07 hit at 1GB', () => {
    const y = yml();
    const m = y.match(/--workerIdleMemoryLimit=(\d+)(MB|GB)/);
    expect(m).not.toBeNull();
    const mb = m[2] === 'GB' ? Number(m[1]) * 1024 : Number(m[1]);
    // Loosening this back toward 1GB re-opens the flake that the fourth hit
    // proved 1GB does not bound. Raising it needs a new hit record in the
    // matrix comment explaining what changed, not just a bigger number.
    expect(mb).toBeLessThanOrEqual(512);
  });

  test('the flag reaches jest, and only that leg gets it', () => {
    const y = yml();
    // The test step forwards matrix.jest-flags; every other leg leaves it unset,
    // so the step degrades to a plain `npm test`.
    expect(y).toMatch(/npm test -- \$\{\{\s*matrix\.jest-flags\s*\}\}/);
    expect([...y.matchAll(/--workerIdleMemoryLimit=/g)]).toHaveLength(1);
  });
});
