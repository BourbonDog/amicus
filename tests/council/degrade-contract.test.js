'use strict';

const { makeDegrade, DEGRADE_CHANNELS } = require('../../src/utils/degrade');

const valid = {
  channel: 'dead-leg',
  what: 'seat gemma-4-31b did not review',
  why: 'the leg timed out after 8m with no output',
  effect: '3 of 4 seats reviewed; the run exits degraded (2)',
};

test.each(['what', 'why', 'effect'])('rejects a missing %s', (field) => {
  const input = { ...valid };
  delete input[field];
  expect(() => makeDegrade(input)).toThrow(new RegExp(field));
});

test.each(['what', 'why', 'effect'])('rejects a blank %s', (field) => {
  expect(() => makeDegrade({ ...valid, [field]: '   ' })).toThrow(new RegExp(field));
});

test('accepts an absent remedy', () => {
  expect(makeDegrade(valid).remedy).toBeUndefined();
});

test('rejects an unknown channel', () => {
  expect(() => makeDegrade({ ...valid, channel: 'invented' })).toThrow(/channel/);
});

test('defaults kind to degrade and accepts heal', () => {
  expect(makeDegrade(valid).kind).toBe('degrade');
  expect(makeDegrade({ ...valid, kind: 'heal' }).kind).toBe('heal');
});

test('rejects an unknown kind', () => {
  expect(() => makeDegrade({ ...valid, kind: 'sideways' })).toThrow(/kind/);
});

test('freezes the record', () => {
  const d = makeDegrade(valid);
  expect(() => { d.what = 'mutated'; }).toThrow();
});

test('every channel id is kebab-case', () => {
  for (const c of DEGRADE_CHANNELS) { expect(c).toMatch(/^[a-z]+(-[a-z]+)*$/); }
});
