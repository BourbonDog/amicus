/**
 * The module table's "Key Exports" column marks a FUNCTION with `()` and a
 * VALUE without it.
 *
 * It used to write `name()` for every export, so string constants read as
 * functions: `OPENROUTER_NO_CREDIT_WARNING()` in the api-key-validation.js and
 * openrouter-credit.js rows. Council finding A3 on the #288 fix round
 * (PR 289) raised it.
 *
 * The classifier reads source text only and never requires the modules it
 * documents. Only an export it can PROVE is a value loses the parentheses.
 * Anything it cannot classify keeps the old `name()`, so the table never
 * gets less accurate than it was.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { buildModuleIndex } = require('../../scripts/generate-docs');

let tmpDir;
let srcDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-docs-kinds-'));
  srcDir = path.join(tmpDir, 'src');
  fs.mkdirSync(srcDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Write src/<rel>, then return the Key Exports cell of that module's row. */
function exportsCell(files, rel) {
  for (const [name, lines] of Object.entries(files)) {
    const full = path.join(srcDir, name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, lines.join('\n'));
  }
  const row = buildModuleIndex(tmpDir).split('\n').find((l) => l.startsWith(`| \`${rel}\``));
  expect(row).toBeDefined();
  return row.split('|')[3].trim();
}

describe('values are written without ()', () => {
  it('a string constant beside a function', () => {
    expect(exportsCell({ 'a.js': [
      "const WARNING = 'no credit';",
      'function check() {}',
      'module.exports = { check, WARNING };',
    ] }, 'a.js')).toBe('`check()`, `WARNING`');
  });

  it.each([
    ['a template literal', 'const V = `x${1}`;'],
    ['a number expression', 'const V = 5 * 60 * 1000;'],
    ['an object literal', 'const V = { a: 1 };'],
    ['an array literal', 'const V = [1, 2];'],
    ['Object.freeze', "const V = Object.freeze({ a: 'b' });"],
    ['a new instance', 'const V = new Set([1]);'],
    ['a boolean', 'let V = true;'],
    ['null', 'var V = null;'],
    ['a regex', 'const V = /ab+c/i;'],
    // Global builtins whose results are never functions (utils/provider-registry.js,
    // observe/on-complete.js).
    ['Object.fromEntries', 'const V = Object.fromEntries(P.map(p => [p.id, p.env]));'],
    ['Number(...) with a fallback', 'const V = Number(process.env.X) || 60000;'],
    ['String(...)', 'const V = String(1);'],
  ])('%s', (_label, decl) => {
    expect(exportsCell({ 'v.js': [decl, 'module.exports = { V };'] }, 'v.js')).toBe('`V`');
  });

  it('exports.X = <literal>', () => {
    expect(exportsCell({ 'e.js': [
      "exports.NAME = 'amicus';",
      'exports.run = function () {};',
    ] }, 'e.js')).toBe('`NAME`, `run()`');
  });

  it('a `key: original` pair is classified by what original is bound to', () => {
    expect(exportsCell({ 'k.js': [
      "const internalMsg = 'x';",
      'function internalFn() {}',
      'module.exports = { MSG: internalMsg, fn: internalFn };',
    ] }, 'k.js')).toBe('`MSG`, `fn()`');
  });

  it('a local alias follows the name it aliases', () => {
    expect(exportsCell({ 'al.js': [
      'function validateApiKey() {}',
      'const validateOpenRouterKey = validateApiKey;',
      "const BASE = 'b';",
      'const ALIAS = BASE;',
      'module.exports = { validateOpenRouterKey, ALIAS };',
    ] }, 'al.js')).toBe('`validateOpenRouterKey()`, `ALIAS`');
  });

  it('a re-export through a destructured relative require is classified where it is defined', () => {
    expect(exportsCell({
      'credit.js': [
        "const NO_CREDIT = 'none left';",
        'async function checkCredit() {}',
        'module.exports = { checkCredit, NO_CREDIT };',
      ],
      'validation.js': [
        'const {',
        '  checkCredit, NO_CREDIT: renamed,',
        "} = require('./credit');",
        'module.exports = { checkCredit, NO_CREDIT: renamed };',
      ],
    }, 'validation.js')).toBe('`checkCredit()`, `NO_CREDIT`');
  });

  // The shape council/briefings-stage2.js uses: a namespace require, then
  // `NAME: ns.NAME` in module.exports.
  it('a re-export through a namespace require and a member access', () => {
    expect(exportsCell({
      'chair.js': [
        "const VALUES = ['Ship it', 'Fix these first'];",
        'function repair() {}',
        'module.exports = { VALUES, repair };',
      ],
      'stage2.js': [
        "const chair = require('./chair');",
        'module.exports = { VALUES: chair.VALUES, repair: chair.repair };',
      ],
    }, 'stage2.js')).toBe('`VALUES`, `repair()`');
  });

  it('a direct require(...).NAME', () => {
    expect(exportsCell({
      'src1.js': ['const LIMIT = 300;', 'module.exports = { LIMIT };'],
      'use.js': ["const LIMIT = require('./src1').LIMIT;", 'module.exports = { LIMIT };'],
    }, 'use.js')).toBe('`LIMIT`');
  });

  it.each([
    ['string concatenation onto a constant', "const LEAD = 'Do not '; const P = LEAD + 'stop.';"],
    ['arithmetic on a constant', 'const S = 60; const P = S * 1000;'],
  ])('%s is a value', (_label, decl) => {
    expect(exportsCell({ 'b.js': [decl, 'module.exports = { P };'] }, 'b.js')).toBe('`P`');
  });

  it('a re-export from a sibling directory resolves the relative path', () => {
    expect(exportsCell({
      'utils/consts.js': ['const LIMIT = 300;', 'module.exports = { LIMIT };'],
      'cli/main.js': ["const { LIMIT } = require('../utils/consts.js');", 'module.exports = { LIMIT };'],
    }, 'cli/main.js')).toBe('`LIMIT`');
  });
});

describe('functions and anything unproven keep ()', () => {
  it.each([
    ['a function declaration', 'function F() {}'],
    ['an async function declaration', 'async function F() {}'],
    ['a generator', 'function* F() {}'],
    ['an arrow with parens', 'const F = (a, b) => a + b;'],
    ['an arrow with one bare param', 'const F = x => x;'],
    ['an async arrow', 'const F = async () => {};'],
    ['a function expression', 'const F = function () {};'],
    ['a class (a callable constructor)', 'class F {}'],
  ])('%s', (_label, decl) => {
    expect(exportsCell({ 'f.js': [decl, 'module.exports = { F };'] }, 'f.js')).toBe('`F()`');
  });

  it.each([
    ['a call result (could be either)', 'const F = make();'],
    ['a member expression', 'const F = process.env.F;'],
    ['a package require', "const { F } = require('fs');"],
    ['a binding the classifier cannot find', ''],
  ])('%s keeps the old rendering', (_label, decl) => {
    expect(exportsCell({ 'u.js': [decl, 'module.exports = { F };'] }, 'u.js')).toBe('`F()`');
  });

  it('a re-export cycle terminates and keeps the old rendering', () => {
    expect(exportsCell({
      'p.js': ["const { X } = require('./q');", 'module.exports = { X };'],
      'q.js': ["const { X } = require('./p');", 'module.exports = { X };'],
    }, 'p.js')).toBe('`X()`');
  });

  // The output alone cannot tell a guarded walk from an unguarded one: without
  // the visited-set guard the walk recurses until the stack overflows, and that
  // RangeError, thrown inside exportKind's try around readFileSync, is swallowed
  // into 'unknown'. Bounded file reads are what the guard actually buys.
  it('a re-export cycle is cut by the visited set, not by a stack overflow', () => {
    const spy = jest.spyOn(fs, 'readFileSync');
    try {
      exportsCell({
        'p.js': ["const { X } = require('./q');", 'module.exports = { X };'],
        'q.js': ["const { X } = require('./p');", 'module.exports = { X };'],
      }, 'p.js');
      expect(spy.mock.calls.length).toBeLessThan(50);
    } finally {
      spy.mockRestore();
    }
  });
});
