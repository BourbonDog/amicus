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
 *   3. `~/.local/share/opencode/auth.json`, reached by the suites that call
 *      `loadCredentials()` at module scope (e.g. fanout-e2e) -- and
 *      utils/auth-json.js resolves that path with `os.homedir()` too.
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
 * Scrubbing in the parent process before Jest is spawned fixes both sources at
 * once: the workers are child processes and inherit the real, scrubbed env, so
 * `os.homedir()` resolves to the sandbox for every worker and every CLI/MCP
 * subprocess the tests themselves spawn.
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

  // 3. An empty home. os.homedir() reads $HOME on POSIX and %USERPROFILE% on
  //    Windows, so both are set. This is what defeats the
  //    `~/.config/amicus/.env` fallback in the suites' own HAS_API_KEY checks,
  //    and it makes a developer machine behave exactly like a fresh CI runner.
  env.HOME = sandboxHome;
  env.USERPROFILE = sandboxHome;

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

module.exports = { buildKeylessEnv, run };
