/**
 * Regression tests for scripts/setup-hooks.js.
 *
 * Guards the fix for git hooks silently not firing in linked worktrees:
 * husky pointed core.hooksPath at the generated, gitignored .husky/_
 * directory, which is never checked out in a worktree, so git found no
 * hooks there and skipped them without any warning. setup-hooks.js points
 * core.hooksPath at the committed .husky/ directory instead, which exists
 * in every checkout.
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
 * Create a git repo with a committed .husky/pre-commit that drops a
 * sentinel file when it runs.
 */
function initRepoWithHook(dir) {
  fs.mkdirSync(dir, { recursive: true });
  run('git', ['init', '-q', '-b', 'main', dir]);
  run('git', ['-C', dir, 'config', 'user.email', 'test@amicus.invalid']);
  run('git', ['-C', dir, 'config', 'user.name', 'setup-hooks test']);
  run('git', ['-C', dir, 'config', 'commit.gpgsign', 'false']);
  const hooksDir = path.join(dir, '.husky');
  fs.mkdirSync(hooksDir);
  const hook = path.join(hooksDir, 'pre-commit');
  fs.writeFileSync(hook, '#!/usr/bin/env sh\n: > .hook-fired\n');
  fs.chmodSync(hook, 0o755);
  run('git', ['-C', dir, 'add', '.']);
  run('git', ['-C', dir, 'commit', '-q', '--no-verify', '-m', 'init']);
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

    run('node', [SCRIPT], repo);

    expect(run('git', ['-C', repo, 'config', 'core.hooksPath']).trim()).toBe('.husky');
  });

  test('hooks resolve and fire inside a linked worktree (.git is a file)', () => {
    const repo = path.join(tmp, 'repo');
    initRepoWithHook(repo);
    run('node', [SCRIPT], repo); // one-time setup in the main clone

    const wt = path.join(tmp, 'wt');
    run('git', ['-C', repo, 'worktree', 'add', '-q', wt, '-b', 'wt-branch']);

    // .git in a linked worktree is a file, not a directory (the husky-era
    // prepare guard `[ -d .git ]` was false here).
    expect(fs.statSync(path.join(wt, '.git')).isFile()).toBe(true);

    // The shared repo config applies inside the worktree, and the committed
    // .husky dir exists there, so git can resolve and execute the hook.
    expect(run('git', ['-C', wt, 'config', 'core.hooksPath']).trim()).toBe('.husky');
    run('git', ['-C', wt, 'hook', 'run', 'pre-commit']);
    expect(fs.existsSync(path.join(wt, '.hook-fired'))).toBe(true);
  });

  test('running setup from inside a worktree also works', () => {
    const repo = path.join(tmp, 'repo');
    initRepoWithHook(repo);
    const wt = path.join(tmp, 'wt');
    run('git', ['-C', repo, 'worktree', 'add', '-q', wt, '-b', 'wt-branch']);

    run('node', [SCRIPT], wt);

    // core.hooksPath lands in the shared repo config, covering every checkout.
    expect(run('git', ['-C', wt, 'config', 'core.hooksPath']).trim()).toBe('.husky');
    expect(run('git', ['-C', repo, 'config', 'core.hooksPath']).trim()).toBe('.husky');
  });

  test('exits 0 outside a git checkout', () => {
    const plain = path.join(tmp, 'not-a-repo');
    fs.mkdirSync(plain);

    expect(() =>
      run('node', [SCRIPT], plain, { GIT_CEILING_DIRECTORIES: tmp })
    ).not.toThrow();
  });
});
