/**
 * Regression tests for #35: the github: install path must run identically on
 * Windows. The consumer-facing `prepare` lifecycle is what made the github:
 * path diverge from the registry path (clone -> prepare -> nested devDep
 * install -> cached-pack), so it is removed. Git hooks are still configured
 * for DEVELOPERS, now folded into the existing (non-fatal, #29) postinstall
 * flow: scripts/setup-hooks.js configures hooks only when git's toplevel is the
 * amicus package root itself, so invoking it from postinstall is a no-op for
 * consumers (see tests/setup-hooks.test.js) and sets core.hooksPath for devs.
 *
 * These tests assert the manifest shape and the dev hook-setup path without
 * ever running a real install (which is forbidden in this worktree).
 */

'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const SETUP_HOOKS = path.join(REPO_ROOT, 'scripts', 'setup-hooks.js');

/**
 * git exports repo context (GIT_DIR, GIT_INDEX_FILE, ...) to hooks. When this
 * suite runs inside a pre-push hook — e.g. pushing from a linked worktree —
 * inheriting those would redirect the scratch-repo git calls below at the real
 * repository. Strip GIT_* so every child git resolves its repo from cwd.
 */
const CLEAN_ENV = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !k.toUpperCase().startsWith('GIT_'))
);

function run(cmd, args, cwd, env) {
  return execFileSync(cmd, args, {
    cwd,
    encoding: 'utf-8',
    env: env ? { ...CLEAN_ENV, ...env } : CLEAN_ENV,
  });
}

describe('#35 — github: install runs identically (prepare removed)', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf-8'));

  test('package.json no longer declares a consumer-facing prepare script', () => {
    // prepare is the lifecycle that triggered the github: clone -> nested
    // install -> cached-pack dance that the registry path skips. It must be
    // gone so the github: path behaves identically to the registry path.
    expect(pkg.scripts.prepare).toBeUndefined();
  });

  test('postinstall is still wired to scripts/postinstall.js', () => {
    expect(pkg.scripts.postinstall).toBe('node scripts/postinstall.js');
  });

  test('setup-hooks.js still ships in the published "files" allowlist', () => {
    // postinstall now invokes setup-hooks for devs, so it must still be in the
    // tarball (its prior justification was the prepare hook).
    expect(pkg.files).toContain('scripts/setup-hooks.js');
    expect(pkg.files).toContain('scripts/postinstall.js');
  });

  describe('dev hook-setup still wires core.hooksPath after prepare removal', () => {
    let tmp;

    beforeEach(() => {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'install-prepare-'));
    });

    afterEach(() => {
      fs.rmSync(tmp, { recursive: true, force: true });
    });

    /**
     * A scratch dev checkout laid out like the real package: setup-hooks.js
     * sits at <root>/scripts/ and resolves its package root from __dirname, so
     * the copy — not this repo's own — is what a scratch repo must run.
     * @returns {string} path to the scratch checkout's setup-hooks.js
     */
    function initRepo(dir) {
      fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
      run('git', ['init', '-q', '-b', 'main', dir]);
      run('git', ['-C', dir, 'config', 'user.email', 'test@amicus.invalid']);
      run('git', ['-C', dir, 'config', 'user.name', 'prepare-removed test']);
      fs.mkdirSync(path.join(dir, '.husky'));
      const script = path.join(dir, 'scripts', 'setup-hooks.js');
      fs.copyFileSync(SETUP_HOOKS, script);
      return script;
    }

    test('invoking setup-hooks (the postinstall dev path) sets core.hooksPath', () => {
      const repo = path.join(tmp, 'repo');
      const script = initRepo(repo);

      // This is exactly what postinstall now runs for a dev checkout.
      run('node', [script], repo);

      expect(run('git', ['-C', repo, 'config', 'core.hooksPath']).trim()).toBe('.husky');
    });
  });
});
