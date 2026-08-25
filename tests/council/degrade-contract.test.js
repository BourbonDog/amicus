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
  for (const c of DEGRADE_CHANNELS) { expect(c).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/); }
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

describe("stage1-retry channel (SL-2)", () => {
  test('makeDegrade accepts a stage1-retry heal', () => {
    const r = makeDegrade({
      channel: 'stage1-retry', kind: 'heal',
      what: 'seat gpt reviewed on retry',
      why: "its first leg ended 'error' with no usable output and was relaunched once",
      effect: 'The seat is in this council; nothing was lost',
      data: { seat: 'gpt' },
    });
    expect(r.kind).toBe('heal');
    expect(r.channel).toBe('stage1-retry');
  });

  test('formatDegrade renders a stage1-retry heal with the Recovered: lead', () => {
    const r = makeDegrade({ channel: 'stage1-retry', kind: 'heal',
      what: 'seat gpt reviewed on retry', why: 'relaunched once',
      effect: 'The seat is in this council; nothing was lost' });
    expect(formatDegrade(r)).toBe(
      'Recovered: seat gpt reviewed on retry — relaunched once. The seat is in this council; nothing was lost.\n');
  });
});

describe("kind 'info' + channel 'ledger-skipped' (v4.9 task mode, W5.1)", () => {
  const info = {
    kind: 'info', channel: 'ledger-skipped',
    what: 'task runs write no reliability rows',
    why: 'ledger-driven chair promotion draws only on review-run history',
    effect: 'fallback candidates come from review runs only',
  };

  test('makeDegrade accepts an info record on ledger-skipped', () => {
    const r = makeDegrade(info);
    expect(r.kind).toBe('info');
    expect(r.channel).toBe('ledger-skipped');
  });

  test('formatDegrade renders an info record with the Note: lead', () => {
    expect(formatDegrade(makeDegrade({ ...info, what: 'a', why: 'b', effect: 'c' })))
      .toBe('Note: a — b. c.\n');
  });

  test('DEGRADE_CHANNELS has ledger-skipped', () => {
    expect(DEGRADE_CHANNELS.has('ledger-skipped')).toBe(true);
  });

  test('a degrade and a heal still lead Notice / Recovered — info changed neither', () => {
    expect(formatDegrade(makeDegrade({ ...valid, what: 'a', why: 'b', effect: 'c' })))
      .toBe('Notice: a — b. c.\n');
    expect(formatDegrade(makeDegrade({ ...valid, kind: 'heal', what: 'a', why: 'b', effect: 'c' })))
      .toBe('Recovered: a — b. c.\n');
  });
});

describe('seat-unbound channel (v4.8)', () => {
  test('makeDegrade round-trips a seat-unbound degrade', () => {
    const r = makeDegrade({
      channel: 'seat-unbound',
      what: "leg stray-1 in wave w-s1 matches no seat on that wave's roster",
      why: "its id names no roster slot of w-s1, and its model 'zzz' does not identify exactly one seat there",
      effect: 'Its review is kept under its model name and is NOT attributed to a seat; nothing was '
        + 'guessed and nothing was dropped',
      data: { waveId: 'w-s1', legId: 'stray-1', seat: 'zzz' },
    });
    expect(r.kind).toBe('degrade');
    expect(r.channel).toBe('seat-unbound');
  });

  test('DEGRADE_CHANNELS has seat-unbound', () => {
    expect(DEGRADE_CHANNELS.has('seat-unbound')).toBe(true);
  });
});
