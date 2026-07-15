const { checkNodeVersion, MIN_NODE } = require('../src/utils/node-version-guard');

test('MIN_NODE is 22.12.0', () => {
  expect(MIN_NODE).toBe('22.12.0');
});
test('passes on the floor and above', () => {
  expect(checkNodeVersion('22.12.0', MIN_NODE).ok).toBe(true);
  expect(checkNodeVersion('24.5.0', MIN_NODE).ok).toBe(true);
});
test('fails below the floor with an actionable message', () => {
  const r = checkNodeVersion('20.11.0', MIN_NODE);
  expect(r.ok).toBe(false);
  expect(r.message).toMatch(/Node .*22\.12/);
  expect(r.message).toMatch(/20\.11\.0/);
});
