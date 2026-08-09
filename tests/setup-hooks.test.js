/**
 * Regression tests for scripts/setup-hooks.js.
 *
 * Guards two behaviours:
 *
 * 1. Git hooks silently not firing in linked worktrees: husky pointed
 *    core.hooksPath at the generated, gitignored .husky/_ directory, which is
 *    never checked out in a worktree, so git found no hooks there and skipped
 *    them without any warning. setup-hooks.js points core.hooksPath at the
 *    committed .husky/ directory instead, which exists in every checkout.
 *
 * 2. The script never configuring a repo that merely *contains* the package.
 *    `git rev-parse` walks up the directory tree, so during a consumer's
 *    `npm install amicus` (cwd = node_modules/amicus) it finds the CONSUMER'S
 *    .git and used to write core.hooksPath=.husky there — pointing their repo
 *    at a directory that is not in the published tarball and silently disabling
 *    every hook in their .git/hooks. The guard compares `--show-toplevel`
 *    against the package root and no-ops unless they are the same directory.
 *
 * Fixtures mirror the real package layout (a copy of the script at
 * <pkgRoot>/scripts/setup-hooks.js) because the guard resolves the package root
 * from __dirname. Running THIS repo's copy against a scratch repo would
 * exercise a layout that never ships.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'setup-hooks.js');

/**
 * git exports repo context (GIT_DIR, GIT_INDEX_FILE, ...) to hooks. When this
 * suite runs inside a pre-push hook — e.g. pushing from a linked worktree —
 * inheriting those would redirect the scratch-repo git calls below at the
 * real repository (which is exactly what corrupted a real push once). Strip
 * GIT_* so every child git resolves its repo from cwd; explicit per-call env
 * overrides still win.
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

/**
 * Place a copy of setup-hooks.js at <pkgRoot>/scripts/setup-hooks.js, so the
 * script's own `path.resolve(__dirname, '..')` resolves to pkgRoot.
 * @returns {string} absolute path to the copied script
 */
function installScript(pkgRoot) {
  const dir = path.join(pkgRoot, 'scripts');
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, 'setup-hooks.js');
  fs.copyFileSync(SCRIPT, dest);
  return dest;
}

/** Init a git repo with deterministic identity and no signing. */
function initRepo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  run('git', ['init', '-q', '-b', 'main', dir]);
  run('git', ['-C', dir, 'config', 'user.email', 'test@amicus.invalid']);
  run('git', ['-C', dir, 'config', 'user.name', 'setup-hooks test']);
  run('git', ['-C', dir, 'config', 'commit.gpgsign', 'false']);
}

/**
 * A git repo laid out like the amicus checkout: a committed .husky/pre-commit
 * that drops a sentinel when it runs, plus scripts/setup-hooks.js.
 */
function initRepoWithHook(dir) {
  initRepo(dir);
  const hooksDir = path.join(dir, '.husky');
  fs.mkdirSync(hooksDir);
  const hook = path.join(hooksDir, 'pre-commit');
  fs.writeFileSync(hook, '#!/usr/bin/env sh\n: > .hook-fired\n');
  fs.chmodSync(hook, 0o755);
  installScript(dir);
  run('git', ['-C', dir, 'add', '.']);
  run('git', ['-C', dir, 'commit', '-q', '--no-verify', '-m', 'init']);
}

/** Write an executable hook into a repo's own .git/hooks directory. */
function writeGitHook(repo, name, body) {
  const hook = path.join(repo, '.git', 'hooks', name);
  fs.writeFileSync(hook, body);
  fs.chmodSync(hook, 0o755);
  return hook;
}

/** @returns {string|null} the configured core.hooksPath, or null when unset. */
function hooksPath(dir) {
  try {
    return run('git', ['-C', dir, 'config', 'core.hooksPath']).trim();
  } catch {
    return null; // `git config <key>` exits 1 when the key is not set
  }
}

describe('scripts/setup-hooks.js', () => {
  let tmp;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-hooks-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('package.json wires setup-hooks.js (postinstall + run-script, not prepare)', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf-8')
    );
    // #35: prepare is removed (it triggered the github: clone -> nested-install
    // dance the registry path skips). Hook setup is now folded into postinstall
    // and also exposed as a named `npm run setup-hooks` for the manual dev path.
    expect(pkg.scripts.prepare).toBeUndefined();
    expect(pkg.scripts.postinstall).toBe('node scripts/postinstall.js');
    expect(pkg.scripts['setup-hooks']).toBe('node scripts/setup-hooks.js');
  });

  test('sets core.hooksPath to .husky in a normal clone (.git is a directory)', () => {
    const repo = path.join(tmp, 'repo');
    initRepoWithHook(repo);

    run('node', [path.join(repo, 'scripts', 'setup-hooks.js')], repo);

    expect(hooksPath(repo)).toBe('.husky');
  });

  test('hooks resolve and fire inside a linked worktree (.git is a file)', () => {
    const repo = path.join(tmp, 'repo');
    initRepoWithHook(repo);
    run('node', [path.join(repo, 'scripts', 'setup-hooks.js')], repo); // one-time setup in the main clone

    const wt = path.join(tmp, 'wt');
    run('git', ['-C', repo, 'worktree', 'add', '-q', wt, '-b', 'wt-branch']);

    // .git in a linked worktree is a file, not a directory (the husky-era
    // prepare guard `[ -d .git ]` was false here).
    expect(fs.statSync(path.join(wt, '.git')).isFile()).toBe(true);

    // The shared repo config applies inside the worktree, and the committed
    // .husky dir exists there, so git can resolve and execute the hook.
    expect(hooksPath(wt)).toBe('.husky');
    run('git', ['-C', wt, 'hook', 'run', 'pre-commit']);
    expect(fs.existsSync(path.join(wt, '.hook-fired'))).toBe(true);
  });

  test('running setup from inside a worktree also works', () => {
    const repo = path.join(tmp, 'repo');
    initRepoWithHook(repo);
    const wt = path.join(tmp, 'wt');
    run('git', ['-C', repo, 'worktree', 'add', '-q', wt, '-b', 'wt-branch']);

    // scripts/ is committed, so the worktree checkout carries its own copy and
    // the package root resolves to the worktree — still the repo's toplevel.
    run('node', [path.join(wt, 'scripts', 'setup-hooks.js')], wt);

    // core.hooksPath lands in the shared repo config, covering every checkout.
    expect(hooksPath(wt)).toBe('.husky');
    expect(hooksPath(repo)).toBe('.husky');
  });

  test('exits 0 outside a git checkout', () => {
    const plain = path.join(tmp, 'not-a-repo');
    fs.mkdirSync(plain);
    const script = installScript(plain);

    expect(() =>
      run('node', [script], plain, { GIT_CEILING_DIRECTORIES: tmp })
    ).not.toThrow();
  });

  describe('installed as a dependency of another repo', () => {
    /**
     * Lay out a consumer git repo with amicus unpacked at
     * node_modules/amicus — exactly what npm produces, and the cwd npm uses
     * when it runs the postinstall lifecycle.
     * @returns {{consumer: string, pkgRoot: string, script: string}}
     */
    function installAsDependency(root) {
      const consumer = path.join(root, 'consumer');
      initRepo(consumer);
      const pkgRoot = path.join(consumer, 'node_modules', 'amicus');
      fs.mkdirSync(pkgRoot, { recursive: true });
      // The published tarball ships no .husky/ (it is not in package.json
      // "files"), which is what made the stray write actively destructive.
      expect(fs.existsSync(path.join(pkgRoot, '.husky'))).toBe(false);
      return { consumer, pkgRoot, script: installScript(pkgRoot) };
    }

    test('does not write core.hooksPath into the consumer repo', () => {
      const { consumer, script, pkgRoot } = installAsDependency(tmp);

      // npm runs lifecycle scripts with cwd = the package directory, from which
      // `git rev-parse` walks UP and finds the consumer's .git.
      run('node', [script], pkgRoot);

      expect(hooksPath(consumer)).toBeNull();
    });

    test('leaves the consumer\'s own hooks working', () => {
      const { consumer, script, pkgRoot } = installAsDependency(tmp);
      writeGitHook(consumer, 'pre-commit', '#!/usr/bin/env sh\n: > .consumer-hook-fired\n');

      run('node', [script], pkgRoot);

      run('git', ['-C', consumer, 'hook', 'run', 'pre-commit']);
      expect(fs.existsSync(path.join(consumer, '.consumer-hook-fired'))).toBe(true);
    });

    test('does not clobber a core.hooksPath the consumer set themselves', () => {
      const { consumer, script, pkgRoot } = installAsDependency(tmp);
      run('git', ['-C', consumer, 'config', 'core.hooksPath', '.githooks']);

      run('node', [script], pkgRoot);

      expect(hooksPath(consumer)).toBe('.githooks');
    });
  });

  test('configures the package root repo, not whatever repo the cwd is in', () => {
    const repo = path.join(tmp, 'repo');
    initRepoWithHook(repo);
    const unrelated = path.join(tmp, 'unrelated');
    initRepo(unrelated);

    // Invoked from an unrelated checkout — the package root is what counts.
    run('node', [path.join(repo, 'scripts', 'setup-hooks.js')], unrelated);

    expect(hooksPath(repo)).toBe('.husky');
    expect(hooksPath(unrelated)).toBeNull();
  });
});
