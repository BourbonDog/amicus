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

  // Council A1 on PR 291: a cycle that never passes through a local binding
  // used to skip the visited set, which only guarded binding lookups.
  it.each([
    ['a namespace member', ["const q = require('./q');", 'module.exports = { X: q.X };'],
      ["const p = require('./p');", 'module.exports = { X: p.X };']],
    ['a direct require(...).NAME', ["module.exports = { X: require('./q').X };"],
      ["module.exports = { X: require('./p').X };"]],
    ['exports.X = require(...).X', ["exports.X = require('./q').X;"], ["exports.X = require('./p').X;"]],
  ])('a re-export cycle through %s terminates', (_label, p, q) => {
    const spy = jest.spyOn(fs, 'readFileSync');
    try {
      expect(exportsCell({ 'p.js': p, 'q.js': q }, 'p.js')).toBe('`X()`');
      expect(spy.mock.calls.length).toBeLessThan(50);
    } finally {
      spy.mockRestore();
    }
  });

  // Council B1/C1 on PR 291: `new` and Object.freeze can both yield a callable.
  it.each([
    ['new Function', "const F = new Function('return 1');"],
    ['new Proxy over a function', 'const F = new Proxy(function () {}, {});'],
    ['an instance of a local class', 'class Thing {}\nconst F = new Thing();'],
    ['Object.freeze of a function', 'function g() {}\nconst F = Object.freeze(g);'],
    ['Object.freeze of an arrow', 'const F = Object.freeze(() => 1);'],
  ])('%s', (_label, decl) => {
    expect(exportsCell({ 'n.js': [decl, 'module.exports = { F };'] }, 'n.js')).toBe('`F()`');
  });

  // Council A2/C2 on PR 291: only a top-level declaration binds the exported
  // name. Comments, strings and nested scopes must not decide it.
  it.each([
    ['a commented-out declaration', ["// const F = 'old';", 'const F = make();']],
    ['a block-commented declaration', ["/* const F = 'old'; */", 'const F = make();']],
    ['a declaration inside a string', ['const DOC = "const F = 1;";', 'const F = make();']],
    ['a declaration inside a template', ['const DOC = `const F = 1;`;', 'const F = make();']],
    ['a shadowing declaration in a nested scope', ['function setup() { const F = 1; return F; }', 'const F = make();']],
  ])('%s does not decide the binding', (_label, lines) => {
    expect(exportsCell({ 's.js': [...lines, 'module.exports = { F };'] }, 's.js')).toBe('`F()`');
  });

  it('a commented-out exports.F = <literal> does not decide the export', () => {
    expect(exportsCell({ 'c.js': ['// exports.F = 1;', 'exports.F = function () {};'] }, 'c.js')).toBe('`F()`');
  });

  it('an export reassigned inside a function is not proven by its first value', () => {
    expect(exportsCell({ 'r.js': [
      "exports.F = 'placeholder';",
      'function init() { exports.F = () => {}; }',
      'module.exports.init = init;',
    ] }, 'r.js')).toBe('`F()`, `init()`');
  });

  it('a module that does not parse proves nothing', () => {
    expect(exportsCell({ 'x.js': ["const V = 'x';", 'module.exports = { V };', '}'] }, 'x.js')).toBe('`V()`');
  });

  // Council A4 on PR 291: a package name must never be looked up next to the
  // requiring module, even when a sibling file happens to share it.
  it('a package require is not resolved against a same-named sibling file', () => {
    expect(exportsCell({
      'fs.js': ["const F = 'x';", 'module.exports = { F };'],
      'u.js': ["const { F } = require('fs');", 'module.exports = { F };'],
    }, 'u.js')).toBe('`F()`');
  });
});

describe('what the fixes above must not take away', () => {
  it.each([
    ['new Map', 'const V = new Map();'],
    ['new Error', "const V = new Error('x');"],
    ['Object.freeze of an array constant', "const BASE = ['a'];\nconst V = Object.freeze(BASE);"],
    ['a conditional between two literals', "const V = process.env.X ? 'a' : 'b';"],
    ['a negative number', 'const V = -1;'],
    // How council/briefings*.js builds its prompt text: join always returns a string.
    ['an array literal joined into a string', "const V = ['a', 'b'].join('\\n');"],
  ])('%s is a value', (_label, decl) => {
    expect(exportsCell({ 'v.js': [decl, 'module.exports = { V };'] }, 'v.js')).toBe('`V`');
  });

  // The regex classifier read only an expression's first character, so these
  // passed as values because they start with `[` or `{`.
  it.each([
    ['an element of an array literal', 'function g() {}\nconst F = [g][0];'],
    ['a property of an object literal', 'function g() {}\nconst F = { g }.g;'],
    ['another method on an array literal', 'function g() {}\nconst F = [g].find(Boolean);'],
  ])('%s keeps ()', (_label, decl) => {
    expect(exportsCell({ 'm.js': [decl, 'module.exports = { F };'] }, 'm.js')).toBe('`F()`');
  });
});

// Shapes the parser makes visible that the fixes above also had to decide.
describe('anything that could still end up a function keeps ()', () => {
  it.each([
    ['a fallback to a function', 'const F = process.env.X || function () {};'],
    ['a value with a function fallback', 'const F = Number(process.env.X) || (() => 1);'],
    ['a conditional with a function branch', "const F = process.env.X ? 'a' : () => 1;"],
    ['a let reassigned to a function', "let F = 'x';\nF = () => 1;"],
    ['a shadowed builtin constructor', "const Map = require('./m');\nconst F = new Map();"],
  ])('%s', (_label, decl) => {
    expect(exportsCell({ 'g.js': [decl, 'module.exports = { F };'] }, 'g.js')).toBe('`F()`');
  });

  it.each([
    ['module.exports is replaced inside a function', ['function reset() { module.exports = { V: () => 1 }; }']],
    ['module.exports.V is assigned as well', ['module.exports.V = () => 1;']],
  ])('a value is not proven when %s', (_label, extra) => {
    expect(exportsCell({ 'w.js': ["const V = 'x';", 'module.exports = { V };', ...extra] }, 'w.js')).toBe('`V()`');
  });

  it('a spread after the property could replace it', () => {
    // The table's name scan also lists `extra`; only V's rendering is under test.
    expect(exportsCell({ 'sp.js': ["const V = 'x';", 'const extra = {};', 'module.exports = { V, ...extra };'] }, 'sp.js'))
      .toMatch(/^`V\(\)`/);
  });

  it('a top-level value is found past a nested declaration of the same name', () => {
    expect(exportsCell({ 't.js': [
      'function setup() { const V = make(); return V; }',
      "const V = 'x';",
      'module.exports = { V, setup };',
    ] }, 't.js')).toBe('`V`, `setup()`');
  });
});
