// tests/pack/args-explicit.test.js
'use strict';
const { parseArgs } = require('../../src/cli');

test('typed flags are recorded; DEFAULTS-seeded keys are not', () => {
  const args = parseArgs(['fanout', '--models', 'a,b', '--timeout', '30']);
  expect(args.__explicit.has('models')).toBe(true);
  expect(args.__explicit.has('timeout')).toBe(true);
  expect(args.__explicit.has('summary-length')).toBe(false); // seeded default only
  expect(args.__explicit.has('no-ui')).toBe(false);          // seeded default only
  expect(args.timeout).toBe(30);
});

test('boolean flags, --key=value, accumulating flags, and -o are recorded', () => {
  const args = parseArgs(['council', 'run', '--json', '--gateway=direct', '--var', 'a=1', '-o', 'x.md']);
  for (const k of ['json', 'gateway', 'var', 'out']) { expect(args.__explicit.has(k)).toBe(true); }
});

test('unregistered --no-* flags are recorded under their given key', () => {
  const args = parseArgs(['fanout', '--no-fallback']);
  expect(args.__explicit.has('no-fallback')).toBe(true);
});

test('positionals record nothing', () => {
  expect(parseArgs(['start', 'freeform']).__explicit.size).toBe(0);
});
