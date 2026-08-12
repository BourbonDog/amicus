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

    // The pin is now a single source of truth: ACTIONLINT_VERSION in step env,
    // interpolated into the download URL. Nothing may hardcode a second version.
    const pinned = y.match(/ACTIONLINT_VERSION:\s*'?(\d+\.\d+\.\d+)'?/);
    expect(pinned).not.toBeNull();

    // Every version literal ATTACHED to the word actionlint must agree with the
    // pin. Adjacency (`actionlint v1.2.3`, `actionlint_1.2.3`) is deliberate:
    // the previous form of this check scanned `actionlint[^\n]*v?(\d+\.\d+\.\d+)`
    // — greedy to end of line — so a comment mentioning a SECOND tool and its
    // version ("actionlint 1.7.12 + shellcheck 0.11.0") reported shellcheck's
    // version as an actionlint version and failed. Version consistency between
    // the pin, the URL and the filename is now pinned precisely by the
    // "fetched robustly and verified" describe block below.
    const versionMatches = [...y.matchAll(/actionlint[ _/@]v?(\d+\.\d+\.\d+)/g)].map((m) => m[1]);
    expect(versionMatches.length).toBeGreaterThan(0);
    expect(new Set(versionMatches)).toEqual(new Set([pinned[1]]));

    // never "latest"/unpinned
    expect(y).not.toMatch(/actionlint[ _/@]latest/i);
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

// The actionlint step used to be `bash <(curl ...)` of the upstream installer,
// which pipes `curl -L` straight into `tar xvz` with no --fail, no --retry, no
// timeout and no checksum. On 2026-08-12 (run 31622335985) runner egress died
// mid-transfer TWICE IN A ROW, delivered 107 bytes instead of the ~2.3MB
// tarball, and blocked an unrelated PR from merging. These pins hold the two
// properties that fixed it: retry the transfer, and verify what came back
// before executing it.
describe('ci workflow — actionlint is fetched robustly and verified', () => {
  const yml = () => fs.readFileSync(WF, 'utf-8');
  /** The actionlint step body: from its `- name:` to the end of the quality job. */
  const step = () => {
    const y = yml();
    const start = y.indexOf('- name: actionlint');
    expect(start).toBeGreaterThan(-1);
    const end = y.indexOf('windows-install-smoke:', start);
    expect(end).toBeGreaterThan(start);
    return y.slice(start, end);
  };

  test('the version and its sha256 are pinned together as step env', () => {
    const s = step();
    expect(s).toMatch(/ACTIONLINT_VERSION:\s*'?\d+\.\d+\.\d+'?/);
    // A real 64-hex digest — not a placeholder, not a truncation.
    expect(s).toMatch(/ACTIONLINT_SHA256:\s*'?[0-9a-f]{64}'?\s*$/m);
  });

  test('the download URL is built from the pinned version, off the official release host', () => {
    const s = step();
    expect(s).toContain(
      'https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}/'
    );
  });

  test('the tarball is checksum-verified BEFORE anything is extracted from it', () => {
    const s = step();
    const verifyAt = s.search(/sha256sum\s+(--check|-c)\b/);
    const extractAt = s.search(/\btar\s+-[a-z]*x/);
    expect(verifyAt).toBeGreaterThan(-1);
    expect(extractAt).toBeGreaterThan(-1);
    // Verifying after extraction would mean untrusted bytes already hit tar.
    expect(verifyAt).toBeLessThan(extractAt);
  });

  test('a failed transfer is retried with backoff rather than failing the job outright', () => {
    const s = step();
    // An outer loop of >= 3 attempts, each a fresh curl process...
    expect(s).toMatch(/for\s+attempt\s+in\s+1\s+2\s+3/);
    // ...spaced by a real sleep, so a transient egress blip is not a merge blocker.
    expect(s).toMatch(/sleep\s/);
  });

  test('curl fails loudly and cannot hang the job forever', () => {
    const s = step();
    // Without --fail an HTTP error body is written to the file and only the
    // checksum catches it; without --max-time a stalled transfer inherits the
    // job timeout.
    expect(s).toMatch(/--fail\b/);
    expect(s).toMatch(/--max-time\s+\d+/);
    expect(s).toMatch(/--retry\s+\d+/);
    // The 107-byte failure was a truncated stream, so the bytes must land in a
    // file that can be checksummed — never straight down a pipe.
    expect(s).toMatch(/--output\s/);
  });

  test('the amd64-only checksum pin fails with its own message on a non-amd64 runner', () => {
    const s = step();
    // If ubuntu-latest ever flips arch, this must not look like a compromised
    // download (a checksum mismatch loop) — it must say what to re-pin.
    expect(s).toContain('uname -m');
    expect(s).toContain('x86_64');
  });

  test('no remote script or archive is ever piped into a shell or tar', () => {
    const y = yml();
    // The original failure mode, and the supply-chain hole, in one assertion:
    // executing bytes that were never verified.
    expect(y).not.toMatch(/bash\s*<\(\s*curl/);
    expect(y).not.toMatch(/curl[^\n]*\|\s*(bash|sh)\b/);
    expect(y).not.toMatch(/curl[^\n]*\|\s*tar\b/);
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
