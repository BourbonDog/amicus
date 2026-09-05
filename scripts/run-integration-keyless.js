#!/usr/bin/env node
'use strict';
/**
 * Run the integration tier with every provider credential removed, so the
 * money-spending suites self-skip and only the free assertions execute.
 *
 * WHY A WRAPPER AND NOT A JEST `--setupFiles` SHIM
 * ------------------------------------------------
 * Every paid suite in `tests/*.integration.test.js` gates itself on API-key
 * presence, and that gate reads THREE sources, not one:
 *
 *   1. the process env, e.g. `process.env.OPENROUTER_API_KEY`;
 *   2. `~/.config/amicus/.env`, read directly by the suites' own HAS_API_KEY
 *      check via `os.homedir()`;
 *   3. OpenCode's `auth.json`, reached by the suites that call
 *      `loadCredentials()` at module scope (e.g. fanout-e2e) via
 *      utils/auth-json.js's `resolveAuthJsonPath()`.
 *
 * A `--setupFiles` shim can delete the env vars, but it CANNOT move
 * `os.homedir()`: Jest gives each test environment a *copy* of `process.env`,
 * while `os.homedir()` is a libuv call against the REAL process environment.
 * Writing `process.env.HOME` inside the sandbox therefore never reaches it, so
 * sources 2 and 3 survive.
 *
 * Measured, not assumed. The shim version of this was tried and produced two
 * distinct wrong outcomes in a single run: suites gated on source 2 saw
 * HAS_API_KEY true but had no env credentials, so they ran and failed (17
 * spurious failures), while fanout-e2e picked a real key out of source 3 and
 * billed for a live 2-model wave. Both are exactly what this rail exists to
 * prevent.
 *
 * THIS IS NOT A SINGLE DOOR. `resolveAuthJsonPath()` does not resolve
 * source 3 through `os.homedir()` alone -- it checks `env.XDG_DATA_HOME`
 * FIRST, and falls back to `env.APPDATA` on win32, before ever falling back
 * to the home-relative `.local/share` path. Repointing only `HOME`/
 * `USERPROFILE` -- the fix this wrapper originally shipped with -- closes the
 * home-relative fallback but leaves XDG_DATA_HOME and APPDATA wide open: a
 * developer with either exported in their real environment (XDG_DATA_HOME is
 * common on Nix/home-manager and several Linux distros; APPDATA is always set
 * on Windows) escapes the sandbox entirely, through exactly the shape of gap
 * that billed the live 2-model wave described above. A whole-branch review
 * reproduced this end to end with a planted fake key: with XDG_DATA_HOME set,
 * `resolveAuthJsonPath()` resolved OUTSIDE the sandbox and `loadCredentials()`
 * picked the fake key straight up. Every credential-path root has to be
 * repointed into the sandbox, not just the two `os.homedir()` env vars.
 *
 * Scrubbing in the parent process before Jest is spawned fixes every source at
 * once: the workers are child processes and inherit the real, scrubbed env, so
 * `os.homedir()` *and* every XDG/APPDATA root resolve inside the sandbox for
 * every worker and every CLI/MCP subprocess the tests themselves spawn.
 *
 * The scrub is GENERIC rather than a hand-maintained deny-list of test files:
 * key names come from the engine's own PROVIDER_ENV_MAP, so a provider added
 * later is scrubbed automatically, and a paid suite added later self-skips
 * automatically as long as it follows the existing key-gate pattern.
 *
 * Usage:
 *   node scripts/run-integration-keyless.js          # via `npm run test:integration`
 *   npm run test:integration:live                    # the paid rail (NOT this script)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { PROVIDER_ENV_MAP, LEGACY_KEY_NAMES } = require('../src/utils/api-key-store');

/**
 * The engine's OWN credential/config env channels, which no AMICUS_* or
 * provider-key name covers. The pinned opencode engine honours each:
 *   - OPENCODE_AUTH_CONTENT: an inline auth.json, read straight out of the
 *     variable -- it bypasses the HOME/XDG/APPDATA sandbox entirely, because
 *     it never touches the filesystem at all;
 *   - OPENCODE_API_KEY: a bare key the engine accepts directly;
 *   - OPENCODE_CONFIG / OPENCODE_CONFIG_DIR: config-file overrides that can
 *     name providers (and their keys) from outside the sandbox;
 *   - OPENCODE_CONFIG_CONTENT: an inline config document, read straight out of
 *     the variable like OPENCODE_AUTH_CONTENT. The pinned SDK writes its own
 *     value on every server it spawns, so an engine started THROUGH the SDK
 *     never inherits an ambient one -- but a hand-spawned `opencode serve`
 *     would, so it is scrubbed rather than left to be shadowed.
 * Deleted by buildKeylessEnv() and asserted absent by probe-max-tokens.js's
 * assertSandboxed(), which imports this same list so scrub and gate agree by
 * construction.
 *
 * PINNED TO opencode 1.18.15, AND HAND-MAINTAINED (council #230 B2). Nothing
 * makes it follow an engine bump: a release that adds a sixth channel would
 * leave a credential path open with no test failing. RE-VERIFY IT ON EVERY
 * ENGINE BUMP -- grep the new binary for each name and for any other it reads,
 * e.g.
 *   grep -a -c OPENCODE_AUTH_CONTENT node_modules/opencode-windows-x64/bin/opencode.exe
 * (repeat per name; a zero count means the channel is gone, and a new
 * `OPENCODE_*` credential/config name means the list is short) -- then re-run
 * `node scripts/probe-max-tokens.js` so the sandbox gate is exercised against
 * the engine actually pinned.
 * @type {string[]}
 */
const ENGINE_CREDENTIAL_ENV = [
  'OPENCODE_AUTH_CONTENT',
  'OPENCODE_API_KEY',
  'OPENCODE_CONFIG',
  'OPENCODE_CONFIG_DIR',
  // The SDK overwrites this one on every spawn it makes, so it cannot reach an
  // SDK-started engine -- but a hand-spawned engine would read it.
  'OPENCODE_CONFIG_CONTENT',
];

/**
 * The three sandbox-rooted directories buildKeylessEnv() points
 * XDG_DATA_HOME / XDG_CONFIG_HOME / APPDATA at. Shared with run() below so the
 * paths it mkdir's can never drift from the ones actually placed in env.
 * @param {string} sandboxHome
 * @returns {{xdgDataHome: string, xdgConfigHome: string, appData: string}}
 */
function sandboxSubdirs(sandboxHome) {
  return {
    xdgDataHome: path.join(sandboxHome, '.local', 'share'),
    xdgConfigHome: path.join(sandboxHome, '.config'),
    appData: path.join(sandboxHome, 'AppData', 'Roaming'),
  };
}

/**
 * Build a credential-free copy of an environment.
 * @param {NodeJS.ProcessEnv} sourceEnv
 * @param {string} sandboxHome absolute path to an empty home directory
 * @returns {NodeJS.ProcessEnv}
 */
function buildKeylessEnv(sourceEnv, sandboxHome) {
  const env = { ...sourceEnv };

  // 1. Every provider credential, current and legacy.
  for (const envVar of Object.values(PROVIDER_ENV_MAP)) { delete env[envVar]; }
  for (const legacyName of Object.keys(LEGACY_KEY_NAMES)) { delete env[legacyName]; }

  // 2. The credential/config directory overrides, so the home directory is the
  //    only remaining lookup path -- and step 3 sandboxes that.
  delete env.AMICUS_ENV_DIR;
  delete env.AMICUS_CONFIG_DIR;

  // 2b. The engine's own credential/config channels. OPENCODE_AUTH_CONTENT in
  //     particular carries an inline auth.json in the variable itself, so no
  //     amount of directory sandboxing below can contain it.
  for (const name of ENGINE_CREDENTIAL_ENV) { delete env[name]; }

  // 3. An empty home. os.homedir() reads $HOME on POSIX and %USERPROFILE% on
  //    Windows, so both are set. This is what defeats the
  //    `~/.config/amicus/.env` fallback in the suites' own HAS_API_KEY checks,
  //    and it makes a developer machine behave exactly like a fresh CI runner.
  env.HOME = sandboxHome;
  env.USERPROFILE = sandboxHome;

  // 3b. Every OTHER credential-path root, sandboxed the same way -- not
  //     deleted, since something on the machine may legitimately need these
  //     set, just repointed so they resolve inside the sandbox instead of the
  //     real ones. auth-json.js's resolveAuthJsonPath() checks XDG_DATA_HOME
  //     before it ever falls back to $HOME/.local/share, and falls back to
  //     %APPDATA% on win32 before that -- so os.homedir() sandboxing alone
  //     does NOT contain them. See the module docstring above.
  const dirs = sandboxSubdirs(sandboxHome);
  env.XDG_DATA_HOME = dirs.xdgDataHome;
  env.XDG_CONFIG_HOME = dirs.xdgConfigHome;
  env.APPDATA = dirs.appData;

  // 4. Opt-in escape hatches for the paid/network extras, so they cannot be
  //    switched on by ambient state either.
  delete env.AMICUS_TEST_ELECTRON_DOWNLOAD;

  return env;
}

/** @returns {number} the child's exit code */
function run() {
  const sandboxHome = path.join(os.tmpdir(), 'amicus-keyless-home');
  try {
    fs.mkdirSync(sandboxHome, { recursive: true });
    // Also create the three subdirectories env.APPDATA/XDG_DATA_HOME/XDG_CONFIG_HOME will
    // point at (not just sandboxHome itself). Discovered via the Task 18 CDP workspace e2e
    // suite: on Windows, Electron crashes hard (no window, no CDP target) the instant
    // %APPDATA% resolves to a directory that does not exist -- every prior keyless-tier
    // suite gates on HAS_API_KEY and self-skips before ever spawning Electron here, so this
    // was never exercised until a fixture-driven (zero-model-calls) suite needed no key.
    const { xdgDataHome, xdgConfigHome, appData } = sandboxSubdirs(sandboxHome);
    fs.mkdirSync(xdgDataHome, { recursive: true });
    fs.mkdirSync(xdgConfigHome, { recursive: true });
    fs.mkdirSync(appData, { recursive: true });
  } catch { /* best effort: a missing dir still reads as "no credentials" */ }

  // NB: 'jest/bin/jest' (no .js) -- that is the subpath jest's package
  // "exports" map exposes; 'jest/bin/jest.js' throws ERR_PACKAGE_PATH_NOT_EXPORTED.
  const jestBin = require.resolve('jest/bin/jest');
  const args = [
    jestBin,
    '--testPathIgnorePatterns=worktrees',
    '--testMatch=**/tests/**/*.integration.test.js',
    ...process.argv.slice(2),
  ];

  const result = spawnSync(process.execPath, args, {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..'),
    env: buildKeylessEnv(process.env, sandboxHome),
  });

  if (result.error) {
    process.stderr.write(`Failed to launch jest: ${result.error.message}\n`);
    return 1;
  }
  return result.status === null ? 1 : result.status;
}

if (require.main === module) {
  process.exit(run());
}

module.exports = { buildKeylessEnv, run, ENGINE_CREDENTIAL_ENV };
