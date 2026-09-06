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

describe("kind 'info' + channel 'output-truncated' (#218 PR 3)", () => {
  const { truncatedReviewNote } = require('../../src/council/run-retry-notes');
  test('DEGRADE_CHANNELS has output-truncated', () => {
    expect(DEGRADE_CHANNELS.has('output-truncated')).toBe(true);
  });
  test('truncatedReviewNote is an info record that formats with Note: and Try:', () => {
    const leg = { finish: 'length', usage: { tokens: { input: 900, output: 700, reasoning: 31000 } } };
    const r = makeDegrade(truncatedReviewNote('kimi', leg));
    expect(r.kind).toBe('info');
    expect(r.channel).toBe('output-truncated');
    expect(formatDegrade(r)).toBe("Note: seat kimi's review was cut at its output reservation — the provider stopped for length (finish 'length') after 31000 reasoning / 700 output tokens; the review ends where the reservation ended. The review is in the packet as far as it got, and its header in the chair packet says it was cut; nothing else changes. Try: raise outputBudget in config.json (docs/configuration.md, Output budget).\n");
    expect(r.data).toEqual({ seat: 'kimi', finish: 'length', reasoningTokens: 31000, outputTokens: 700 });
  });
  test('a leg with no usage still formats with zero counts', () => {
    expect(makeDegrade(truncatedReviewNote('glm', { finish: 'length' })).why).toContain('after 0 reasoning / 0 output tokens;');
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

/**
 * #202 — the stage-2 judge-death channel, plus the drift pin that would have
 * caught its absence.
 *
 * WHY THE DRIFT PIN EXISTS. `run-stages.test.js :: makeCtx` hands runStage2 a
 * RAW collector (`{ note: (n) => notes.push(n) }`) that never calls
 * `makeDegrade`, so a note on an UNREGISTERED channel passes every test in that
 * file while failing in production — where run-degrade.js's sink catches the
 * throw and rewrites the note as `internal` ("a degrade on channel 'x' could not
 * be recorded"). The run still degrades; the reason is destroyed. That is a
 * false green of exactly the shape #202 was filed about, so the fix is a pin
 * that reads the SOURCE rather than any test's stub.
 */
describe('#202 — every channel the runtime emits is registered', () => {
  test('DEGRADE_CHANNELS has stage2-judge', () => {
    expect(DEGRADE_CHANNELS.has('stage2-judge')).toBe(true);
  });

  test('makeDegrade accepts a stage2-judge note rather than rewriting it as internal', () => {
    const rec = makeDegrade({
      channel: 'stage2-judge',
      what: 'judge gpt did not adjudicate',
      why: "its Stage-2 leg ended 'error': NO_OUTPUT_BACKSTOP",
      effect: 'the run will exit degraded (2)',
    });
    expect(rec.channel).toBe('stage2-judge');
    expect(rec.kind).toBe('degrade');           // what flips degraded.value
  });

  test('DRIFT PIN — no `channel:` literal in src/ escapes the registry', () => {
    const fs = require('fs');
    const path = require('path');
    const ROOT = path.join(__dirname, '..', '..');
    const walk = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })
      .flatMap(e => (e.isDirectory() ? walk(`${dir}/${e.name}`)
        : (e.name.endsWith('.js') ? [`${dir}/${e.name}`] : [])));
    const unregistered = [];
    for (const f of walk('src')) {
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
      // #219 r2 (deepseek): matching single quotes ONLY meant a double-quoted
      // literal walked straight past the guard written to stop exactly that.
      for (const m of src.matchAll(/\bchannel:\s*['"]([a-z0-9-]+)['"]/g)) {
        if (!DEGRADE_CHANNELS.has(m[1])) { unregistered.push(`${f}: '${m[1]}'`); }
      }
    }
    expect(unregistered).toEqual([]);
  });
});
