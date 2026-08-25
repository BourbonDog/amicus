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
