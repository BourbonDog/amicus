// tests/scripts/run-integration-keyless.test.js
'use strict';
/**
 * Tests for scripts/run-integration-keyless.js's anti-spend sandbox (I-1,
 * whole-branch review of the v4.1.1 patch release).
 *
 * buildKeylessEnv() sandboxed only HOME/USERPROFILE. But
 * src/utils/auth-json.js's resolveAuthJsonPath() resolves the credentials
 * path from env.XDG_DATA_HOME FIRST, and falls back to env.APPDATA on win32
 * -- neither is rooted at the home directory, so os.homedir() sandboxing
 * does not contain them. A developer with either var set in their real
 * environment (XDG_DATA_HOME is common on Nix/home-manager and several Linux
 * distros; APPDATA is always set on Windows) escapes the sandbox entirely:
 * `tests/fanout-e2e.integration.test.js` calls loadCredentials() at module
 * scope and can pick up a REAL key there, billing a live wave. This was
 * reproduced for real during this release -- an early keyless-test attempt
 * leaked a live key and billed a real 2-model wave.
 *
 * Each test below plants a fake credential at the UNSANDBOXED location a
 * given root would resolve to, builds the keyless env from a source env that
 * has that root set (simulating a developer's real environment), and proves
 * -- via a spawned child process, mirroring exactly how the wrapper itself
 * launches jest as a child that only inherits `env` -- that neither
 * resolveAuthJsonPath() nor loadCredentials() can see outside the sandbox.
 *
 * The HOME/USERPROFILE case is included as a control: it was never broken
 * (buildKeylessEnv already repointed it), so it must pass before and after
 * this fix. XDG_DATA_HOME and APPDATA are the doors this pins shut.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { buildKeylessEnv } = require('../../scripts/run-integration-keyless');

const AUTH_JSON_MODULE = require.resolve('../../src/utils/auth-json');
const ENV_LOADER_MODULE = require.resolve('../../src/utils/env-loader');

/**
 * Spawn a fresh child node process under `env` (no inheritance from this
 * test's own process.env) that resolves the auth.json path and loads
 * credentials, exactly as a jest worker spawned by the real wrapper would.
 * @param {NodeJS.ProcessEnv} env
 * @param {{forceWin32?: boolean}} [opts]
 * @returns {{resolvedAuthPath: string, openrouterKey: string|null}}
 */
function probeInChild(env, { forceWin32 = false } = {}) {
  const script = `
    ${forceWin32 ? "Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });" : ''}
    const { resolveAuthJsonPath } = require(${JSON.stringify(AUTH_JSON_MODULE)});
    const { loadCredentials } = require(${JSON.stringify(ENV_LOADER_MODULE)});
    const resolvedAuthPath = resolveAuthJsonPath();
    loadCredentials();
    process.stdout.write(JSON.stringify({
      resolvedAuthPath,
      openrouterKey: process.env.OPENROUTER_API_KEY || null,
    }));
  `;
  const result = spawnSync(process.execPath, ['-e', script], { env, encoding: 'utf-8' });
  if (result.status !== 0) {
    throw new Error(`probe child exited ${result.status}: ${result.stderr}`);
  }
  return JSON.parse(result.stdout);
}

/** Plant a fake OpenCode auth.json (with a fake OpenRouter key) under `dir`/opencode/. */
function plantFakeAuthJson(dir, fakeKey) {
  const authDir = path.join(dir, 'opencode');
  fs.mkdirSync(authDir, { recursive: true });
  const authPath = path.join(authDir, 'auth.json');
  fs.writeFileSync(authPath, JSON.stringify({ openrouter: { key: fakeKey } }), 'utf-8');
  return authPath;
}

describe('buildKeylessEnv sandboxes every credential-path root (I-1)', () => {
  let workDir;
  let sandboxHome;

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-keyless-test-'));
    sandboxHome = path.join(workDir, 'sandbox-home');
    fs.mkdirSync(sandboxHome, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  test('XDG_DATA_HOME is rewritten to a sandbox-rooted path, not left at its real value', () => {
    const built = buildKeylessEnv({ XDG_DATA_HOME: path.join(workDir, 'real-xdg-data-home') }, sandboxHome);
    expect(built.XDG_DATA_HOME).toBe(path.join(sandboxHome, '.local', 'share'));
  });

  test('XDG_CONFIG_HOME is rewritten to a sandbox-rooted path', () => {
    const built = buildKeylessEnv({ XDG_CONFIG_HOME: path.join(workDir, 'real-xdg-config-home') }, sandboxHome);
    expect(built.XDG_CONFIG_HOME).toBe(path.join(sandboxHome, '.config'));
  });

  test('APPDATA is rewritten to a sandbox-rooted path, not left at its real value', () => {
    const built = buildKeylessEnv({ APPDATA: path.join(workDir, 'real-appdata') }, sandboxHome);
    expect(built.APPDATA).toBe(path.join(sandboxHome, 'AppData', 'Roaming'));
  });

  test('a fake key planted under a real XDG_DATA_HOME is unreachable through the sandboxed env', () => {
    const realXdgDataHome = path.join(workDir, 'real-xdg-data-home');
    fs.mkdirSync(realXdgDataHome, { recursive: true });
    const plantedPath = plantFakeAuthJson(realXdgDataHome, 'sk-or-v1-FAKEKEY-xdg');

    const sourceEnv = { XDG_DATA_HOME: realXdgDataHome, HOME: workDir, USERPROFILE: workDir };
    const built = buildKeylessEnv(sourceEnv, sandboxHome);
    const probe = probeInChild(built);

    expect(probe.resolvedAuthPath).not.toBe(plantedPath);
    expect(probe.resolvedAuthPath.startsWith(sandboxHome)).toBe(true);
    expect(probe.openrouterKey).toBeNull();
  });

  test('a fake key planted under a real %APPDATA% is unreachable through the sandboxed env (win32)', () => {
    const realAppData = path.join(workDir, 'real-appdata');
    fs.mkdirSync(realAppData, { recursive: true });
    const plantedPath = plantFakeAuthJson(realAppData, 'sk-or-v1-FAKEKEY-appdata');

    const sourceEnv = { APPDATA: realAppData, HOME: workDir, USERPROFILE: workDir };
    const built = buildKeylessEnv(sourceEnv, sandboxHome);
    const probe = probeInChild(built, { forceWin32: true });

    expect(probe.resolvedAuthPath).not.toBe(plantedPath);
    expect(probe.resolvedAuthPath.startsWith(sandboxHome)).toBe(true);
    expect(probe.openrouterKey).toBeNull();
  });

  test('control: a fake key planted under the real HOME was already unreachable (HOME/USERPROFILE sandboxing predates this fix)', () => {
    const realHome = path.join(workDir, 'real-home');
    const plantedPath = plantFakeAuthJson(path.join(realHome, '.local', 'share'), 'sk-or-v1-FAKEKEY-home');

    const sourceEnv = { HOME: realHome, USERPROFILE: realHome };
    const built = buildKeylessEnv(sourceEnv, sandboxHome);
    const probe = probeInChild(built);

    expect(probe.resolvedAuthPath).not.toBe(plantedPath);
    expect(probe.resolvedAuthPath.startsWith(sandboxHome)).toBe(true);
    expect(probe.openrouterKey).toBeNull();
  });
});
