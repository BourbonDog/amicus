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
  // #257 R-X44(b) (round-4 fix round 1): a leg with NO usage record has no token counts to
  // report, and 'after 0 reasoning / 0 output tokens' was a measurement the engine never made.
  // Named mutant "TRUNCATEDZEROS": restore the `|| 0` floor.
  test('a leg with no usage says the usage was not reported — it never mints zeros', () => {
    const r = makeDegrade(truncatedReviewNote('glm', { finish: 'length' }));
    expect(r.why).toBe("the provider stopped for length (finish 'length') — token usage not reported; "
      + 'the review ends where the reservation ended');
    expect(r.data).toEqual({ seat: 'glm', finish: 'length', reasoningTokens: null, outputTokens: null });
  });
  // The PROSE is all-or-nothing — half a split is not a split a reader can use — while `data`
  // is per-field: an unusable count is `null`, a usable one is itself. Never 0 for either.
  test.each([
    ['reasoning missing', { output: 700 }, null, 700],
    ['output missing', { reasoning: 31000 }, 31000, null],
    ['a non-integer count', { reasoning: 31000.5, output: 700 }, null, 700],
    ['a negative count', { reasoning: -1, output: 700 }, null, 700],
    // R-X44(c): `output: 0` beside a NaN is not a report at all — no count is positive.
    ['a NaN count beside a zero', { reasoning: NaN, output: 0 }, null, null],
    ['a NaN count beside a positive one', { reasoning: NaN, output: 700 }, null, 700],
    ['a string count', { reasoning: '31000', output: 700 }, null, 700],
  ])('one unusable count (%s) makes the whole split unreported', (_n, tokens, wantR, wantO) => {
    const r = makeDegrade(truncatedReviewNote('glm', { finish: 'length', usage: { tokens } }));
    expect(r.why).toContain("(finish 'length') — token usage not reported;");
    expect(r.data).toEqual({ seat: 'glm', finish: 'length', reasoningTokens: wantR, outputTokens: wantO });
  });
  // R-X44(c): a reported zero needs a REPORT to sit in — `input` positive here. Without one,
  // the all-zero record is an absence of observation, pinned in the next test.
  test('REPORTED zeros stay zeros — the note is byte-identical to the pre-R-X44 wording', () => {
    const r = makeDegrade(truncatedReviewNote('glm', { finish: 'length', usage: { tokens: { input: 1200, reasoning: 0, output: 0 } } }));
    expect(r.why).toBe("the provider stopped for length (finish 'length') after 0 reasoning / 0 output tokens; "
      + 'the review ends where the reservation ended');
    expect(r.data).toEqual({ seat: 'glm', finish: 'length', reasoningTokens: 0, outputTokens: 0 });
  });
  test('an all-zero usage record is an absence of observation, not two reported zeros (R-X44(c))', () => {
    const r = makeDegrade(truncatedReviewNote('glm', { finish: 'length', usage: { tokens: { reasoning: 0, output: 0 } } }));
    expect(r.why).toContain("(finish 'length') — token usage not reported;");
    expect(r.data).toEqual({ seat: 'glm', finish: 'length', reasoningTokens: null, outputTokens: null });
  });

  /**
   * #257 R-X44(b) — ONE spelling of the not-reported literal across every home that mints it.
   *
   * ⚠️ READ BEFORE CHANGING. R-X44 is one rule with three renderers, and a reader meets them
   * on the same surfaces — stderr, run.json, the `amicus council report` Markdown — so a second
   * wording of "we do not know the counts" is a second vocabulary for one fact:
   *   - `council/promoted.js :: tokenSplit` — every promoted-leg announcement (fix G1);
   *   - `council/run-retry-notes.js :: truncatedReviewNote` — the cut-review note (this file);
   *   - `utils/output-length.js :: formatOutputLengthReason` — the OUTPUT_LENGTH death.
   * They live in three modules with no shared constant between them ON PURPOSE (`promoted.js`
   * is a LEAF that requires nothing, spec R12's require-free pin), so the literal is held equal
   * HERE instead. `tokenSplit` is the canonical one: this is a STRICT equality against it, not
   * a `toContain` on a set — adding a member to relax a failure is the drift, not the fix.
   *
   * ⚠️ THE PREDICATE IS NOT PINNED EQUAL, ONLY THE WORDING — and the three do differ (council
   * #270 r4 review of G2, M1). All three share R-X44(c)'s `reportedTokens` gate (no positive
   * count in the record ⇒ not a report), pinned below on the product's own zero object. The
   * PER-COUNT test then differs by ruling: `promoted.js :: promotedFacts` and
   * `truncatedReviewNote` use `Number.isInteger(v) && v >= 0`, `formatOutputLengthReason` uses
   * `Number.isFinite`. MEASURED divergence: `{ reasoning: 31000.5, output: 700 }` reads
   * `token usage not reported` in the first two and `31000.5 reasoning / 700 output tokens` in
   * the third; a negative count likewise. Each follows its own ruling text, so this is recorded,
   * not asserted — unifying on `isInteger && >= 0` would be a behaviour change and needs a ruling.
   */
  test('R-X44(b) cross-module: the not-reported literal has ONE spelling in every home', () => {
    const { formatOutputLengthReason } = require('../../src/utils/output-length');
    const { tokenSplit } = require('../../src/council/promoted');
    const NOT_REPORTED = tokenSplit({ reasoning: null, output: null, finish: null });
    expect(NOT_REPORTED).toBe('token usage not reported');
    expect(truncatedReviewNote('glm', { finish: 'length' }).why)
      .toContain(`(finish 'length') — ${NOT_REPORTED};`);
    expect(formatOutputLengthReason({ tokens: null, budget: null }))
      .toContain(`— ${NOT_REPORTED}; outputBudget`);
  });

  /**
   * #257 R-X44(c) — THE ARM IS REACHABLE FROM THE PRODUCT, on the object the product passes.
   *
   * The round-4 review's I1: `formatOutputLengthReason`'s only caller (`headless.js:1967`) hands
   * it `sumPerMessageUsage(...)`.tokens, which `pricing.js:14-32` seeds from `emptyUsageTotals()`
   * and accumulates with `|| 0` — so a leg whose engine reported NO usage arrives as all zeros
   * and the not-reported arm could never fire in production. The same seam writes the leg
   * document's `usage`, so `promotedFacts` and `truncatedReviewNote` saw zeros too.
   *
   * This pin uses `emptyUsageTotals()` itself — not a hand-written `{ reasoning: 0, output: 0 }`
   * — so it is the REAL object, and if pricing.js ever adds a sixth count the three formatters
   * are re-checked against it automatically. ⚠️ The SEAM is still unfixed: the leg document and
   * the spend ledger keep the zeros and cost is estimated from them. That is filed in BACKLOG.md
   * under `## #257 — filed at the PR (2026-09-19)`; this pin covers the PROSE only.
   */
  test('R-X44(c) cross-module: all three homes read the product\'s own zero totals as unreported', () => {
    const { formatOutputLengthReason } = require('../../src/utils/output-length');
    const { tokenSplit, promotedFacts } = require('../../src/council/promoted');
    const { emptyUsageTotals } = require('../../src/utils/pricing');
    const ZEROS = emptyUsageTotals().tokens;
    // Non-vacuity: this really is the all-zero shape the summing seam mints.
    expect(Object.values(ZEROS).every((v) => v === 0)).toBe(true);
    expect(Object.keys(ZEROS).sort()).toEqual(['cacheRead', 'cacheWrite', 'input', 'output', 'reasoning']);

    const NOT_REPORTED = 'token usage not reported';
    expect(tokenSplit(promotedFacts({ promoted: true, usage: { tokens: ZEROS } }))).toBe(NOT_REPORTED);
    expect(truncatedReviewNote('glm', { finish: 'length', usage: { tokens: ZEROS } }).why)
      .toContain(`(finish 'length') — ${NOT_REPORTED};`);
    expect(formatOutputLengthReason({ tokens: ZEROS, budget: null }))
      .toContain(`— ${NOT_REPORTED}; outputBudget`);
    // The machine fields follow the prose: null, never a fabricated 0.
    expect(truncatedReviewNote('glm', { finish: 'length', usage: { tokens: ZEROS } }).data)
      .toEqual({ seat: 'glm', finish: 'length', reasoningTokens: null, outputTokens: null });
    expect(promotedFacts({ promoted: true, usage: { tokens: ZEROS } }))
      .toEqual({ reasoning: null, output: null, finish: null });

    // ONE positive count anywhere makes the same record a report, in all three.
    const OBSERVED = { ...ZEROS, input: 1200 };
    expect(tokenSplit(promotedFacts({ promoted: true, usage: { tokens: OBSERVED } })))
      .toBe('0 reasoning / 0 output tokens');
    expect(truncatedReviewNote('glm', { finish: 'length', usage: { tokens: OBSERVED } }).why)
      .toContain("(finish 'length') after 0 reasoning / 0 output tokens;");
    expect(formatOutputLengthReason({ tokens: OBSERVED, budget: null }))
      .toContain(' — 0 reasoning / 0 output tokens;');
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

  /**
   * #257 (spec R4/R11) — a Stage-2 judge that answered only in its reasoning
   * channel and whose fenced block STILL parsed. Its own channel, and kind
   * 'info': the adjudication counts, nothing was lost, the exit code must not
   * move. Without the registration below, run-degrade.js's sink rewrites the
   * note as `internal` ("a degrade on channel 'judge-reasoning-only' could not
   * be recorded") — which, being kind 'degrade', would take an untouched run
   * from 0 to 2.
   *
   * NAMED MUTANT — CHANNELUNREGISTERED: remove `'judge-reasoning-only',` from
   * DEGRADE_CHANNELS in src/utils/degrade.js. Reds both tests below.
   */
  test('DEGRADE_CHANNELS has judge-reasoning-only', () => {
    expect(DEGRADE_CHANNELS.has('judge-reasoning-only')).toBe(true);
  });

  test('makeDegrade keeps a judge-reasoning-only note as info, not internal', () => {
    const rec = makeDegrade({
      kind: 'info',
      channel: 'judge-reasoning-only',
      what: 'judge gpt answered in its reasoning channel',
      why: 'its fenced block parsed and was used',
      effect: 'the adjudication counts; nothing else changes',
    });
    expect(rec.channel).toBe('judge-reasoning-only');
    expect(rec.kind).toBe('info');              // never flips degraded.value
    expect(formatDegrade(rec)).toMatch(/^Note: /);
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
