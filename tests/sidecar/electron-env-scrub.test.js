// tests/sidecar/electron-env-scrub.test.js
'use strict';

/**
 * F2 — the artifact-selector scrub missed a spelling (v4.9.6, council seat B2).
 *
 * "ELECTRON_INSTALL_TARGET_ENV lists only 'npm_config_platform'/'npm_config_arch',
 * so a repo package.json "config": {"platform":...} plants
 * npm_package_config_platform/-arch into the unpinned last-resort install.js env."
 *
 * The module already handled BOTH npm shapes for the `electron_*` mirror knobs;
 * the platform/arch pair simply never got the same treatment. Both spellings are
 * now DERIVED from the key, so the asymmetry cannot come back by omission.
 *
 * WHAT THE RE-ENUMERATION FOUND, recorded here because it bounds the claim: the
 * INSTALLED electron 43.1.1 `install.js` does not itself read
 * `npm_package_config_platform` / `-arch` — it reads `ELECTRON_INSTALL_PLATFORM`
 * || `npm_config_platform` (lines 20, 99) and `ELECTRON_INSTALL_ARCH` ||
 * `npm_config_arch` (lines 21, 27). So the surviving spelling was not a live
 * exploit against this electron; it was a hole in the model the module states it
 * enforces, with nothing failing if a future install.js walked through it.
 *
 * ── NAMED MUTANT ──────────────────────────────────────────────────────────
 * TARGETSPELLINGMISSED  electron-env-scrub.js — build the list from one shape:
 *   `.flatMap((key) => [\`npm_config_${key}\`])`.
 *   RED: "the package.json spelling of the artifact selectors is scrubbed too".
 * ──────────────────────────────────────────────────────────────────────────
 */

const path = require('path');

const scrub = require('../../src/sidecar/electron-env-scrub');
const trust = require('../../src/sidecar/electron-trust');

describe('the split is a RE-EXPORT, not a second copy', () => {
  test('electron-trust re-exports the same function objects', () => {
    expect(trust.scrubbedChildEnv).toBe(scrub.scrubbedChildEnv);
    expect(trust.isRepoPlantedName).toBe(scrub.isRepoPlantedName);
    expect(trust.REPO_ENV_PREFIXES).toBe(scrub.REPO_ENV_PREFIXES);
    expect(trust.ELECTRON_INSTALL_TARGET_ENV).toBe(scrub.ELECTRON_INSTALL_TARGET_ENV);
  });

  test('electron-env-scrub is a true leaf: it requires nothing', () => {
    // The arrow is electron-install -> electron-provision -> electron-trust ->
    // electron-env-scrub. A require here would be the first step back up it.
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', '..', 'src', 'sidecar', 'electron-env-scrub.js'), 'utf8',
    );
    expect(src.match(/^\s*(const .*=\s*)?require\(/gm)).toBeNull();
  });
});

describe('F2 — the artifact selectors, in BOTH shapes npm produces (TARGETSPELLINGMISSED)', () => {
  test('the package.json spelling of the artifact selectors is scrubbed too', () => {
    // npm turns a repo package.json `"config": {"platform": "linux"}` into
    // `npm_package_config_platform`, case PRESERVED. v4.9.5 removed only the
    // .npmrc spelling, so this pair rode into the last-resort install.js spawn.
    const out = scrub.scrubbedChildEnv({
      env: {
        npm_config_platform: 'linux',
        npm_config_arch: 'arm64',
        npm_package_config_platform: 'linux',
        npm_package_config_arch: 'arm64',
        npm_package_config_PLATFORM: 'linux',      // npm keeps the author's case
        NPM_PACKAGE_CONFIG_ARCH: 'arm64',
        PATH: '/usr/bin',
      },
      platform: 'win32',
      arch: 'x64',
    });
    expect(Object.keys(out).filter((k) => /^npm_/i.test(k))).toEqual([]);
    expect(out.ELECTRON_INSTALL_PLATFORM).toBe('win32');
    expect(out.ELECTRON_INSTALL_ARCH).toBe('x64');
    expect(out.PATH).toBe('/usr/bin');
  });

  test('the list is DERIVED from the keys, so neither shape can be dropped by omission', () => {
    for (const key of scrub.ELECTRON_INSTALL_TARGET_KEYS) {
      expect(scrub.ELECTRON_INSTALL_TARGET_ENV).toContain(`npm_config_${key}`);
      expect(scrub.ELECTRON_INSTALL_TARGET_ENV).toContain(`npm_package_config_${key}`);
    }
    expect(scrub.ELECTRON_INSTALL_TARGET_ENV).toHaveLength(scrub.ELECTRON_INSTALL_TARGET_KEYS.length * 2);
  });

  test('isRepoPlantedName matches both shapes of both keys in any case', () => {
    for (const name of [
      'npm_config_platform', 'NPM_CONFIG_PLATFORM', 'npm_package_config_platform',
      'npm_package_config_PLATFORM', 'npm_config_arch', 'NPM_PACKAGE_CONFIG_ARCH',
    ]) {
      expect(scrub.isRepoPlantedName(name)).toBe(true);
    }
    // ...and the BARE names install.js ranks FIRST stay the machine owner's.
    for (const name of ['ELECTRON_INSTALL_PLATFORM', 'ELECTRON_INSTALL_ARCH', 'platform', 'arch']) {
      expect(scrub.isRepoPlantedName(name)).toBe(false);
    }
  });
});

describe('F2 — the mirror-knob prefixes cover every name @electron/get can read', () => {
  // Re-enumerated from @electron/get 5.0.0, dist/artifact-utils.js lines 20-35.
  // mirrorVar(name) is called for exactly these five names, and reads six
  // spellings of each. This test REBUILDS all thirty from the same rules the
  // library uses, so a name the prefixes miss shows up here rather than in the
  // field. Rows 1-5 are repo-plantable and must be scrubbed; row 6 is a BARE
  // name a repository cannot set, and is deliberately kept.
  const MIRROR_VARS = ['mirror', 'nightlyMirror', 'customDir', 'customFilename', 'customVersion'];
  const snake = (name) => name.replace(/([a-z])([A-Z])/g, (_, a, b) => `${a}_${b}`).toLowerCase();

  const repoReachable = MIRROR_VARS.flatMap((name) => [
    `npm_config_electron_${name.toLowerCase()}`,
    `NPM_CONFIG_ELECTRON_${snake(name).toUpperCase()}`,
    `npm_config_electron_${snake(name)}`,
    `npm_package_config_electron_${name}`,
    `npm_package_config_electron_${snake(name)}`,
  ]);
  const bare = MIRROR_VARS.map((name) => `ELECTRON_${snake(name).toUpperCase()}`);

  test('all 25 repo-reachable mirror names are stripped from the installer spawn', () => {
    const env = Object.fromEntries(repoReachable.map((n) => [n, 'http://attacker.example/evil/']));
    env.PATH = '/usr/bin';
    const out = scrub.scrubbedChildEnv({ env, platform: 'win32', arch: 'x64' });
    expect(repoReachable).toHaveLength(25);
    for (const name of repoReachable) { expect(out[name]).toBeUndefined(); }
    expect(out.PATH).toBe('/usr/bin');
  });

  test('the 5 BARE mirror names survive — a repository cannot set them', () => {
    const env = Object.fromEntries(bare.map((n) => [n, 'https://mirror.corp/electron/']));
    const out = scrub.scrubbedChildEnv({ env, platform: 'win32', arch: 'x64' });
    for (const name of bare) { expect(out[name]).toBe('https://mirror.corp/electron/'); }
  });

  test('electron install.js\'s own pin-disabling knob is covered by the prefixes', () => {
    // electron's install.js, lines 47-50 — `npm_config_electron_use_remote_checksums` turns
    // electron's own bundled checksum pin OFF. The BARE spelling beside it is the
    // machine owner's and is kept.
    const out = scrub.scrubbedChildEnv({
      env: {
        npm_config_electron_use_remote_checksums: '1',
        NPM_CONFIG_ELECTRON_USE_REMOTE_CHECKSUMS: '1',
        npm_package_config_electron_use_remote_checksums: '1',
        electron_use_remote_checksums: '1',
      },
      platform: 'win32',
      arch: 'x64',
    });
    expect(Object.keys(out).filter((k) => /^npm_/i.test(k))).toEqual([]);
    expect(out.electron_use_remote_checksums).toBe('1');
  });
});
