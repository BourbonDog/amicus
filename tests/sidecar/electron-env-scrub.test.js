// tests/sidecar/electron-env-scrub.test.js
'use strict';

/**
 * WHICH ENVIRONMENT NAMES A HOSTILE REPOSITORY CAN PLANT — the enumeration, kept
 * honest against the installed libraries.
 *
 * The trust boundary: a repository controls the `.npmrc` and `package.json` of
 * the directory amicus's own docs tell people to `npx -y amicus@latest` in, and
 * npm turns that into exactly two name shapes — `npm_config_<key lowercased>`
 * and `npm_package_config_<key case-preserved>`. Bare `ELECTRON_*` and
 * `AMICUS_*` names are out of its reach, which is why the escape hatch can be a
 * plain environment variable and a machine-level `ELECTRON_MIRROR` is honoured.
 *
 * WHAT THIS SUITE LOST IN THE SECOND COUNCIL ROUND, and why. It used to drive
 * `scrubbedChildEnv`, which built an environment for the last-resort
 * `install.js` SPAWN, and it pinned the artifact selectors
 * (`npm_config_platform` / `npm_package_config_platform` and the arch pair) that
 * chose WHICH artifact that child fetched. Seat B1 (BLOCKER) had that spawn
 * deleted: it downloaded and extracted outside every control, and pinned with
 * `require('./checksums.json')` out of the SCANNED directory. With no child
 * process there is no child environment, and with `platform`/`arch` passed to
 * amicus's own downloader as ARGUMENTS there is no environment name that can
 * choose an artifact. Both are gone; `src/sidecar/electron-env-scrub.js` keeps
 * the measured install.js enumeration as its record.
 *
 * What remains, and what this suite still pins, is the MIRROR-KNOB half — the
 * one that still has a live consumer, because `@electron/get` runs IN AMICUS'S
 * OWN PROCESS and reads those names directly (council seat D5).
 *
 * ── NAMED MUTANT ──────────────────────────────────────────────────────────
 * SCRUBCASESENSITIVE  electron-env-scrub.js :: isRepoPlantedName — drop the
 *   `.toLowerCase()`.
 *   RED: "the UPPER-case spellings match too (npm writes them, @electron/get
 *   reads them)".
 * ──────────────────────────────────────────────────────────────────────────
 */

const path = require('path');

const scrub = require('../../src/sidecar/electron-env-scrub');
const trust = require('../../src/sidecar/electron-trust');

describe('the split is a RE-EXPORT, not a second copy', () => {
  test('electron-trust re-exports the same function objects', () => {
    expect(trust.isRepoPlantedName).toBe(scrub.isRepoPlantedName);
    expect(trust.REPO_ENV_PREFIXES).toBe(scrub.REPO_ENV_PREFIXES);
  });

  test('the names that served the deleted install.js spawn are GONE, not merely unused', () => {
    // Dead plumbing that stays exported gets picked back up. `scrubbedChildEnv`
    // built an env for a child that no longer exists.
    expect(scrub.scrubbedChildEnv).toBeUndefined();
    expect(scrub.ELECTRON_INSTALL_TARGET_ENV).toBeUndefined();
    expect(trust.scrubbedChildEnv).toBeUndefined();
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

describe('withScrubbedRepoEnv — the IN-PROCESS download scrub (D5) (INPROCESSUNSCRUBBED)', () => {
  // Seat D5: the v4.9.6 scrub covered only the last-resort install.js SPAWN, and
  // amicus's own controlled download runs @electron/get IN THIS PROCESS off
  // `process.env`. MEASURED against the installed @electron/get 5.0.0 with an
  // injected downloader and no network:
  //   UNSCRUBBED -> https://hostile.example/attacker/v43.1.1/electron-v43.1.1-win32-x64.zip
  //   SCRUBBED   -> https://github.com/electron/electron/releases/download/v43.1.1/...
  const HOSTILE = {
    npm_config_electron_mirror: 'http://attacker.example/evil/',
    NPM_CONFIG_ELECTRON_MIRROR: 'http://attacker.example/evil/',
    npm_package_config_electron_customFilename: 'evil.zip',
    npm_config_electron_use_remote_checksums: '1',
  };
  const KEPT = {
    ELECTRON_MIRROR: 'https://mirror.corp/electron/',
    electron_config_cache: '/var/cache/electron',
    PATH: '/usr/bin',
  };

  test('every repo-plantable name is gone DURING the call, and back after it', () => {
    const env = { ...HOSTILE, ...KEPT };
    let during = null;
    const out = scrub.withScrubbedRepoEnv(() => { during = { ...env }; return 'result'; }, env);

    expect(out).toBe('result');
    for (const name of Object.keys(HOSTILE)) { expect(during[name]).toBeUndefined(); }
    for (const [name, value] of Object.entries(KEPT)) { expect(during[name]).toBe(value); }
    expect(env).toEqual({ ...HOSTILE, ...KEPT });        // restored, byte for byte
  });

  test('the promise is returned UNAWAITED, so the env is back before it settles', async () => {
    // The contract engine-output-flag.js already ships. A long-lived MCP process
    // must never see a scrubbed environment across an await — every other child
    // it spawns in that window would inherit it.
    const env = { ...HOSTILE };
    let seenInsideTheAwait = null;
    await scrub.withScrubbedRepoEnv(() => (async () => {
      await Promise.resolve();
      seenInsideTheAwait = env.npm_config_electron_mirror;
    })(), env);

    expect(seenInsideTheAwait).toBe(HOSTILE.npm_config_electron_mirror);
    expect(env).toEqual(HOSTILE);
  });

  test('a throw restores just as completely as a return', () => {
    const env = { ...HOSTILE, ...KEPT };
    expect(() => scrub.withScrubbedRepoEnv(() => { throw new Error('boom'); }, env)).toThrow('boom');
    expect(env).toEqual({ ...HOSTILE, ...KEPT });
  });

  test('a name is RESTORED, never re-added as the string "undefined"', () => {
    // `env[name] = undefined` stores the STRING 'undefined', which mirrorVar
    // would read as a truthy mirror URL and use.
    const env = { npm_config_electron_mirror: 'http://attacker.example/evil/' };
    scrub.withScrubbedRepoEnv(() => {}, env);
    expect(env.npm_config_electron_mirror).toBe('http://attacker.example/evil/');
    const empty = {};
    scrub.withScrubbedRepoEnv(() => {}, empty);
    expect(Object.keys(empty)).toEqual([]);
  });
});

describe('the mirror-knob prefixes cover every name @electron/get can read', () => {
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

  test('all 25 repo-reachable mirror names are recognised', () => {
    expect(repoReachable).toHaveLength(25);
    for (const name of repoReachable) { expect(scrub.isRepoPlantedName(name)).toBe(true); }
  });

  test('the UPPER-case spellings match too (npm writes them, @electron/get reads them) (SCRUBCASESENSITIVE)', () => {
    // MEASURED (npm 11.16.0, Windows 11) — two ways a repository reaches an
    // upper-case slot: an `.npmrc` `electron_mirror=…` overwrites the VALUE of an
    // existing `NPM_CONFIG_ELECTRON_MIRROR` without renaming it, and a
    // `package.json` `"config": {"ELECTRON_MIRROR": …}` plants
    // `npm_package_config_ELECTRON_MIRROR` with nothing pre-existing at all.
    for (const name of [
      'NPM_CONFIG_ELECTRON_MIRROR', 'npm_package_config_ELECTRON_MIRROR',
      'NPM_PACKAGE_CONFIG_ELECTRON_CUSTOM_DIR',
    ]) {
      expect(scrub.isRepoPlantedName(name)).toBe(true);
    }
  });

  test('the 5 BARE mirror names are NOT repo-plantable — a repository cannot set them', () => {
    for (const name of bare) { expect(scrub.isRepoPlantedName(name)).toBe(false); }
  });

  test("electron install.js's own pin-disabling knob is covered by the prefixes", () => {
    // `npm_config_electron_use_remote_checksums` turns electron's own bundled
    // checksum pin OFF. The BARE spelling beside it is the machine owner's.
    for (const name of [
      'npm_config_electron_use_remote_checksums',
      'NPM_CONFIG_ELECTRON_USE_REMOTE_CHECKSUMS',
      'npm_package_config_electron_use_remote_checksums',
    ]) {
      expect(scrub.isRepoPlantedName(name)).toBe(true);
    }
    expect(scrub.isRepoPlantedName('electron_use_remote_checksums')).toBe(false);
  });

  test('unrelated names are left entirely alone', () => {
    for (const name of [
      'PATH', 'HOME', 'ELECTRON_CACHE', 'electron_config_cache', 'HTTPS_PROXY',
      'ELECTRON_GET_USE_PROXY', 'AMICUS_ALLOW_UNVERIFIED_ELECTRON', 'npm_config_registry',
    ]) {
      expect(scrub.isRepoPlantedName(name)).toBe(false);
    }
  });
});
