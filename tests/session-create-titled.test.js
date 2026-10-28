'use strict';
/**
 * #267 — council #294 round 2, D3: every engine session amicus creates is titled
 * because every create goes through the two titled wrappers in
 * src/opencode-client.js (createSession and createChildSession, whose wire shape
 * tests/opencode-client.test.js pins). An untitled `client.session.create(...)`
 * anywhere else in shipped code would bring back the engine's hidden
 * title-generation request, so this fails on any other call site, and on a third
 * one inside the wrappers' own file.
 * Named mutant "STRAYSESSIONCREATE": add `client.session.create({})` to any tracked src file.
 *
 * `git ls-files`, not a directory walk: a tracked list cannot name the size gate's
 * transient fixture (see tests/helpers/read-if-present.js for that race).
 */
const path = require('path');
const { execFileSync } = require('child_process');
const { readIfPresent } = require('./helpers/read-if-present');

const ROOT = path.join(__dirname, '..');
const WRAPPERS = 'src/opencode-client.js';

test('only the titled wrappers in src/opencode-client.js create engine sessions (#267)', () => {
  const files = execFileSync('git', ['ls-files', '--', 'src', 'electron', 'bin'], { cwd: ROOT, encoding: 'utf8' })
    .split(/\r?\n/).filter((f) => f.endsWith('.js'));
  expect(files).toContain(WRAPPERS);
  const sites = [];
  for (const file of files) {
    const text = readIfPresent(path.join(ROOT, file));
    if (text === null) { continue; }
    text.split(/\r?\n/).forEach((line, i) => {
      if (/\.session\.create\s*\(/.test(line) && !/^\s*(\*|\/\/)/.test(line)) { sites.push(`${file}:${i + 1}`); }
    });
  }
  expect(sites.filter((s) => !s.startsWith(`${WRAPPERS}:`))).toEqual([]);
  expect(sites.filter((s) => s.startsWith(`${WRAPPERS}:`))).toHaveLength(2);
});
