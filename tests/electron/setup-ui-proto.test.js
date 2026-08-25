const vm = require('vm');
const { buildSetupHTML } = require('../../electron/setup-ui');

describe('setup wizard defaultAliases far-side seed', () => {
  test('a null-prototype table cannot cross a serialization boundary and stay null-prototype', () => {
    const html = buildSetupHTML();
    const match = html.match(/var defaultAliases = (.+?);\r?\n/);
    expect(match).not.toBeNull();
    const obj = vm.runInNewContext(`(${match[1]})`);
    expect(obj['toString']).toBeUndefined();
    expect(obj['constructor']).toBeUndefined();
  });
});

// T3 (PR 199 auto-review finding 1): every page table keyed by USER-controlled
// alias names must be null-prototype, or an alias literally named __proto__
// hits the Object.prototype setter on assignment (silent no-op) and the
// read-back returns Object.prototype -- which then throws on .split('/') in
// updateAliasesForConfiguredKeys. defaultAliases already ships the far-side
// Object.create(null) seed; these are its siblings.
describe('setup wizard alias tables far-side seed (T3)', () => {
  const ALIAS_KEYED_TABLES = ['aliasEdits', 'aliasDisplay', 'savedAliases', 'aliasWrites', 'changedWrites'];

  test.each(ALIAS_KEYED_TABLES)(
    '%s initializer yields a null-prototype table where a literal __proto__ alias lands as an OWN key',
    (name) => {
      const html = buildSetupHTML();
      const match = html.match(new RegExp(`var ${name} = (.+?);\\r?\\n`));
      expect(match).not.toBeNull();
      const obj = vm.runInNewContext(`(${match[1]})`);
      expect(Object.getPrototypeOf(obj)).toBeNull();
      obj['__proto__'] = 'openai/gpt-5';
      expect(Object.prototype.hasOwnProperty.call(obj, '__proto__')).toBe(true);
      // The :439-class read must get the stored string back (splittable),
      // never Object.prototype.
      expect(obj['__proto__']).toBe('openai/gpt-5');
    }
  );

  test('savedAliases re-seed from cfg.aliases carries a literal __proto__ alias across as an OWN key', () => {
    const html = buildSetupHTML();
    const match = html.match(/savedAliases = (Object\.assign\([^;]+?, cfg\.aliases\));/);
    expect(match).not.toBeNull();
    // JSON.parse is how cfg crosses the IPC boundary in real life, and it is
    // the one way to build an OWN __proto__ key in a fixture (an object
    // literal's '__proto__': v is the prototype-setting special form).
    const cfg = { aliases: JSON.parse('{"__proto__":"openai/gpt-5","gemini":"google/gemini-3-pro"}') };
    const obj = vm.runInNewContext(match[1], { cfg });
    expect(Object.prototype.hasOwnProperty.call(obj, '__proto__')).toBe(true);
    expect(obj['__proto__']).toBe('openai/gpt-5');
    expect(obj['gemini']).toBe('google/gemini-3-pro');
  });
});
