'use strict';

const { makeDegrade, formatDegrade, DEGRADE_CHANNELS } = require('../../src/utils/degrade');

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

test('degrade renders what / why / effect in one line', () => {
  const line = formatDegrade(makeDegrade({
    channel: 'dead-leg',
    what: 'seat gemma-4-31b did not review',
    why: 'the leg timed out after 8m with no output',
    effect: '3 of 4 seats reviewed; the run exits degraded (2)',
  }));
  expect(line).toBe(
    'Notice: seat gemma-4-31b did not review — the leg timed out after 8m with no output. '
    + '3 of 4 seats reviewed; the run exits degraded (2).\n'
  );
});

test('remedy is appended only when present', () => {
  const withRemedy = formatDegrade(makeDegrade({
    channel: 'dead-leg', what: 'a', why: 'b', effect: 'c', remedy: 'retry with --timeout 15',
  }));
  expect(withRemedy).toContain('Try: retry with --timeout 15.');
  expect(withRemedy).toBe('Notice: a — b. c. Try: retry with --timeout 15.\n');
});

test('a heal is labelled Recovered, not Notice', () => {
  const line = formatDegrade(makeDegrade({
    kind: 'heal', channel: 'shared-server-unavailable',
    what: 'the shared OpenCode server failed to start', why: 'database is locked',
    effect: 'retried and succeeded; no seats lost',
  }));
  expect(line.startsWith('Recovered: ')).toBe(true);
});

test('carries a frozen copy of structured data when provided', () => {
  const src = { seat: 'beta', status: 'timeout' };
  const d = makeDegrade({ ...valid, data: src });
  expect(d.data).toEqual({ seat: 'beta', status: 'timeout' });
  expect(d.data).not.toBe(src);                       // a copy, not the caller's object
  expect(() => { d.data.seat = 'mutated'; }).toThrow(); // frozen (file is 'use strict')
  src.seat = 'changed-later';
  expect(d.data.seat).toBe('beta');                   // insulated from later caller mutation
});

test('omits data when absent and rejects a non-object data', () => {
  expect(makeDegrade(valid).data).toBeUndefined();
  expect(() => makeDegrade({ ...valid, data: 'a string' })).toThrow(/data/);
  expect(() => makeDegrade({ ...valid, data: ['an', 'array'] })).toThrow(/data/);
  expect(() => makeDegrade({ ...valid, data: null })).toThrow(/data/);
});
