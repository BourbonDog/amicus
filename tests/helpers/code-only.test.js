// tests/helpers/code-only.test.js
'use strict';
const { codeOnly } = require('./code-only');

describe('codeOnly (#257 R-X41)', () => {
  test('a https:// URL literal in code survives (the // is not a comment opener)', () => {
    const src = 'const url = \'https://example.com/path\';\nconst x = 1;';
    expect(codeOnly(src)).toContain('https://example.com/path');
    expect(codeOnly(src)).toContain('const x = 1;');
  });

  test('a block comment holding a pinned phrase is removed', () => {
    const src = [
      '/*',
      ' * this arm briefly said "written in the reasoning channel" before it was',
      ' * withdrawn',
      ' */',
      'const kept = true;',
    ].join('\n');
    const stripped = codeOnly(src);
    expect(stripped).not.toContain('written in the reasoning channel');
    expect(stripped).toContain('const kept = true;');
  });

  test('a whole-line // comment is removed', () => {
    const src = [
      '// R-X29 briefly added an arm here: "written in the reasoning channel"',
      'const kept = true;',
    ].join('\n');
    const stripped = codeOnly(src);
    expect(stripped).not.toContain('written in the reasoning channel');
    expect(stripped).toContain('const kept = true;');
  });

  test('indented whole-line // comments are also removed', () => {
    const src = [
      'function f() {',
      '  // withdrawn: \'written in the reasoning channel\'',
      '  return 1;',
      '}',
    ].join('\n');
    const stripped = codeOnly(src);
    expect(stripped).not.toContain('written in the reasoning channel');
    expect(stripped).toContain('return 1;');
  });

  // Fix round 1 (#257 R-X41 refined): the round-0 helper's trailing-// case
  // was a documented LIMITATION (a trailing `//` after code was never
  // stripped). The string-aware walker knows a trailing `//` sits OUTSIDE
  // any string once it has scanned the code before it, so it strips this
  // too now — that former limitation is gone. Superseded case, kept as a
  // regression pin on the new (stricter, more correct) behavior.
  test('a trailing // note after code IS removed too (the walker knows it is outside a string)', () => {
    const src = 'const kept = true; // written in the reasoning channel, historically';
    const stripped = codeOnly(src);
    expect(stripped).not.toContain('written in the reasoning channel');
    expect(stripped).toContain('const kept = true;');
    // Only the comment is gone -- the newline before it (there is none here)
    // and everything up to the // is untouched.
    expect(stripped).toBe('const kept = true; ');
  });

  test('a block comment spanning multiple lines is removed entirely, one blank line per newline it held', () => {
    const src = [
      'const a = 1;',
      '/**',
      ' * long jsdoc block',
      ' * mentions written in the reasoning channel here too',
      ' */',
      'const b = 2;',
    ].join('\n');
    const stripped = codeOnly(src);
    expect(stripped).not.toContain('written in the reasoning channel');
    expect(stripped).toContain('const a = 1;');
    expect(stripped).toContain('const b = 2;');
    // Line structure preserved: same number of lines in, same number out.
    expect(stripped.split('\n').length).toBe(src.split('\n').length);
  });

  test('non-string input is coerced, not thrown on', () => {
    expect(() => codeOnly(undefined)).not.toThrow();
  });

  describe('fix round 1 (#257 R-X41 refined) -- string-aware walker', () => {
    // (a) THE motivating case: a glob-shaped string containing "/*" must not
    // be misread as an unterminated block comment that swallows everything
    // up to the NEXT real block comment -- including genuinely reintroduced,
    // pin-worthy code sitting in between. This is Finding IMP1 point 2 from
    // the round-0 review, reproduced against the round-0 regex helper before
    // it was replaced (see round4-fixG5-report.md's "Fix round 1" section
    // for that run's output) and fixed here.
    test('(a) \'**/*.js\' in code, then real code, then a real block comment: the code between survives', () => {
      const src = [
        'const pattern = \'**/*.js\';',
        'const secretPhrase = \'written in the reasoning channel\';',
        '/* a real, later block comment */',
        'const kept = true;',
      ].join('\n');
      const stripped = codeOnly(src);
      // The glob string itself is untouched...
      expect(stripped).toContain('\'**/*.js\'');
      // ...and the CODE LINE that follows it (not inside any string) is not
      // eaten by a phantom "block comment" that runs from the glob's "/*" to
      // the real block comment below it.
      expect(stripped).toContain('written in the reasoning channel');
      expect(stripped).toContain('const kept = true;');
      // The real block comment is still stripped.
      expect(stripped).not.toContain('a real, later block comment');
    });

    // (b) A double-quoted string holding a fake comment survives byte-for-byte.
    test('(b) "/* not a comment */" inside a double-quoted string survives byte-for-byte', () => {
      const src = 'const x = "/* not a comment */";';
      expect(codeOnly(src)).toBe(src);
    });

    // (c) A template literal containing // and /* survives -- interpolation
    // contents are not descended into either (documented simplification).
    test('(c) a template literal containing // and /* survives, interpolation included', () => {
      const src = 'const t = `has // and /* inside ${1 + 1} too`;';
      expect(codeOnly(src)).toBe(src);
    });

    // (d) An escaped quote inside a string does not end the string early, so
    // the "comment-shaped" text after it is still inside the string and
    // survives untouched.
    test('(d) an escaped quote inside a string does not end it early', () => {
      const src = 'const s = \'it\\\'s /* still a string */\';';
      expect(codeOnly(src)).toBe(src);
    });

    // (e) kept from round 0: https:// in code survives (now via the walker's
    // string/code tracking rather than a whole-line regex).
    test('(e) https:// in ordinary code (not inside a string) still survives', () => {
      const src = 'logger.info(\'see https://example.com/docs for details\');';
      expect(codeOnly(src)).toBe(src);
    });

    // (f) kept from round 0: a block comment and a whole-line // comment
    // holding the pinned phrase are both removed.
    test('(f) a block comment and a whole-line // comment holding the pinned phrase are both removed', () => {
      const blockSrc = '/* written in the reasoning channel */\nconst kept = 1;';
      expect(codeOnly(blockSrc)).not.toContain('written in the reasoning channel');
      expect(codeOnly(blockSrc)).toContain('const kept = 1;');

      const lineSrc = '// written in the reasoning channel\nconst kept = 1;';
      expect(codeOnly(lineSrc)).not.toContain('written in the reasoning channel');
      expect(codeOnly(lineSrc)).toContain('const kept = 1;');
    });

    // (g) superseded round-0 limitation: a trailing // note after code IS now
    // removed too. See the top-level test above for the full pin; this one
    // restates it inside the fix-round-1 describe block per the ruling's
    // list, so the (a)-(h) mapping is easy to audit line for line.
    test('(g) a trailing // note after code is removed (former round-0 limitation is gone)', () => {
      const src = 'const kept = true; // written in the reasoning channel, historically';
      expect(codeOnly(src)).not.toContain('written in the reasoning channel');
      expect(codeOnly(src)).toContain('const kept = true;');
    });

    // (h) the regex-literal limitation, pinned with an example that shows
    // CURRENT (known-limited) behaviour -- not asserting correctness, just
    // that the limitation is measured so a future reader knows it is known,
    // not missed. A character-class regex literal shaped like /[/*]/ puts an
    // unescaped "/" directly next to a "*" INSIDE the regex source; the
    // walker (which does not parse regex literals) misreads that pair as a
    // block-comment opener and consumes forward looking for the next close-
    // comment delimiter, which is NOT the regex's own closing slash -- it
    // swallows real code after it too, until end of input here (there is no
    // later "*/" in this fixture to stop it).
    test('(h) regex-literal limitation: a /[/*]/ character class misleads the walker (documented, not fixed)', () => {
      const src = 'const re = /[/*]/; const after = 1;';
      const stripped = codeOnly(src);
      // Documents the actual (limited) behaviour: everything from the
      // character class's "/*" onward is swallowed, including "const after
      // = 1;", because no later close-comment delimiter exists to stop it.
      expect(stripped).toBe('const re = /[');
      expect(stripped).not.toContain('const after = 1;');
    });
  });
});
