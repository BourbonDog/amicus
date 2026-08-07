// tests/bin/pack-save-version-guard.test.js
'use strict';

/**
 * v4.7 — the `pack save --version` trap. `version` is a global BOOLEAN_FLAG
 * (src/cli.js), so `amicus pack save x --kind council --bench a,b --version
 * 2.0.0` parsed with args.version=true, hit bin/amicus.js's version-banner
 * intercept BEFORE command dispatch, and exited 0 having written NO pack — the
 * semver ended up in positionals and handlePack never ran. Third instance of
 * the accepted-and-silently-ignored class (v4.5.2 `start --headless`, v4.7
 * `fanout --quiet`).
 *
 * The predicate is tested directly rather than through bin/amicus.js: that file
 * is a script with a top-level main() and process.exit, which is the same
 * reason tests/bin/preflight-json-envelope.test.js tests extracted units.
 * `--pack-version` actually working is covered in tests/pack/cli-pack-cmd.test.js.
 */

const { parseArgs } = require('../../src/cli');
const { packSaveVersionConflict } = require('../../src/utils/cli-preflight');

describe('packSaveVersionConflict: fires for `pack save`', () => {
  test('--version <semver> -> BAD_ARGS whose hint names --pack-version', () => {
    const conflict = packSaveVersionConflict(parseArgs([
      'pack', 'save', 'mybench', '--kind', 'council', '--bench', 'a,b', '--version', '2.0.0',
    ]));
    expect(conflict).toMatchObject({ code: 'BAD_ARGS' });
    expect(conflict.hint).toContain('--pack-version');
  });

  test('--version=<semver> is caught too (isBooleanFlag discards the inline value)', () => {
    const args = parseArgs(['pack', 'save', 'mybench', '--kind', 'council', '--version=2.0.0']);
    // Pins the exact parser behaviour this guard exists for: the inline value is
    // dropped at src/cli.js's isBooleanFlag branch, ahead of the --key=value branch.
    expect(args.version).toBe(true);
    expect(packSaveVersionConflict(args)).toMatchObject({ code: 'BAD_ARGS' });
  });

  test('bare --version with no value is caught as well', () => {
    expect(packSaveVersionConflict(parseArgs(['pack', 'save', 'x', '--version'])))
      .toMatchObject({ code: 'BAD_ARGS' });
  });
});

describe('packSaveVersionConflict: silent everywhere else (banner still prints)', () => {
  test.each([
    ['bare --version', ['--version']],
    ['pack list --version', ['pack', 'list', '--version']],
    ['pack show --version', ['pack', 'show', 'x', '--version']],
    ['pack rm --version', ['pack', 'rm', 'x', '--version']],
    ['start --version', ['start', '--version']],
    ['council run --version', ['council', 'run', '--version']],
  ])('%s -> null', (_label, argv) => {
    expect(packSaveVersionConflict(parseArgs(argv))).toBeNull();
  });

  test('pack save WITHOUT --version -> null', () => {
    expect(packSaveVersionConflict(parseArgs([
      'pack', 'save', 'x', '--kind', 'council', '--bench', 'a,b',
    ]))).toBeNull();
  });

  test('pack save --pack-version -> null (the working spelling is never blocked)', () => {
    expect(packSaveVersionConflict(parseArgs([
      'pack', 'save', 'x', '--pack-version', '2.0.0',
    ]))).toBeNull();
  });

  test('tolerates a malformed args object', () => {
    expect(packSaveVersionConflict(null)).toBeNull();
    expect(packSaveVersionConflict({})).toBeNull();
    expect(packSaveVersionConflict({ version: true })).toBeNull();
  });
});
