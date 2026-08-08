'use strict';

/**
 * v4.7 PR6 — bare `--cwd` parses as boolean `true` (src/cli.js:101) and
 * `--cwd=` as '' (src/cli.js:72). DEFAULTS (src/cli.js:28) always seeds a
 * real absolute string, so a non-string or empty args.cwd can only mean
 * "typed without a value". Left unguarded it reached 16
 * `args.cwd || process.cwd()` sites across 9 handlers: council run threw a
 * raw TypeError, template silently resolved <cwd>/true.
 *
 * Modelled on tests/bin/pack-save-version-guard.test.js's spawn idiom.
 */

const { execFileSync } = require('child_process');
const path = require('path');
const BIN = path.join(__dirname, '..', '..', 'bin', 'amicus.js');

function run(args) {
  try {
    execFileSync(process.execPath, [BIN, ...args], { encoding: 'utf-8', stdio: 'pipe' });
    return { code: 0, stderr: '' };
  } catch (e) { return { code: e.status, stderr: e.stderr || '' }; }
}

describe('--cwd requires a value (v4.7 PR6)', () => {
  // Bare --cwd parsed as boolean true and reached 16 `args.cwd || process.cwd()`
  // sites: council run threw a TypeError, template silently resolved <cwd>/true.
  it('rejects a bare --cwd', () => {
    const r = run(['council', 'run', '--cwd', '--prompt', 'x']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('--cwd requires a value');
  });

  it('rejects --cwd=', () => {
    const r = run(['council', 'run', '--cwd=', '--prompt', 'x']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('--cwd requires a value');
  });

  it('does not fire when --cwd carries a real path', () => {
    const r = run(['council', 'run', '--cwd', process.cwd(), '--prompt', 'x']);
    expect(r.stderr).not.toContain('--cwd requires a value');
  });

  it('does not fire when --cwd is absent', () => {
    expect(run(['--help']).stderr).not.toContain('--cwd requires a value');
  });
});
