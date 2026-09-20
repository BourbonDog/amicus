// tests/helpers/code-only.test.js
'use strict';
const { codeOnly } = require('./code-only');

describe('codeOnly (#257 R-X41)', () => {
  test('a https:// URL literal in code survives (the // is not a comment opener)', () => {
    const src = "const url = 'https://example.com/path';\nconst x = 1;";
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
      "  // withdrawn: 'written in the reasoning channel'",
      '  return 1;',
      '}',
    ].join('\n');
    const stripped = codeOnly(src);
    expect(stripped).not.toContain('written in the reasoning channel');
    expect(stripped).toContain('return 1;');
  });

  test('a trailing // note after code stays (documented limitation, not a bug)', () => {
    const src = 'const kept = true; // written in the reasoning channel, historically';
    // The comment opener does not own the whole line, so codeOnly leaves it —
    // this is the documented tradeoff that keeps a `//` inside a URL literal
    // from being mistaken for a comment and swallowing real code with it.
    expect(codeOnly(src)).toContain('written in the reasoning channel');
    expect(codeOnly(src)).toContain('const kept = true;');
  });

  test('a block comment spanning multiple lines is removed entirely', () => {
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
  });

  test('non-string input is coerced, not thrown on', () => {
    expect(() => codeOnly(undefined)).not.toThrow();
  });
});
