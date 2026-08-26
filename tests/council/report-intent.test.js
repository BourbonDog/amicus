// tests/council/report-intent.test.js
'use strict';

/**
 * v4.9 W8 T-A — the report surface renders a TASK run honestly:
 *   1. `toModel` carries `intent` (absent ⇒ 'review'), and the header WORD forks.
 *   2. Both renderers print the concurrence qualifier with the tier table
 *      (spec §5.4: "tiers report peer concurrence, never verification").
 *   3. "What was lost" is losses only — a kind:'info' announcement (v4.9's
 *      `ledger-skipped`) rides a separate Notes list instead.
 *
 * Every fork is pinned BOTH WAYS: the review control asserts absence, because
 * the wave's standing constraint is that a review run's report is byte-identical
 * to HEAD's.
 */

const { buildReport, toModel } = require('../../src/council/report');

const base = extra => ({
  schemaVersion: 2, type: 'council-verdict', runId: 'r1', runType: 'council',
  date: '2026-08-25', chair: 'deepseek', council: ['alpha', 'beta'],
  claudeInCouncil: false, overallVerdict: null,
  findings: [], streetCred: [], runStats: [],
  tierCounts: { Confirmed: 1, Contested: 0, Singleton: 2, Disputed: 0 },
  ...extra,
});

const taskVerdict = extra => base({ intent: 'task', ...extra });
const reviewVerdict = extra => base(extra);

// The REAL record run-chair.js announces on a task run (`src/council/run-chair.js ::
// runChair`, kind:'info' channel 'ledger-skipped'), copied field for field — a
// fixture that invents its own wording would pin nothing about the live producer.
const LEDGER_SKIPPED = {
  kind: 'info', channel: 'ledger-skipped',
  what: 'task runs write no reliability rows',
  why: 'ledger-driven chair promotion draws only on review-run history — task rankings measure concurrence, never defect confirmation',
  effect: 'fallback candidates come from review runs only; a task-only install has none',
};
const DEAD_LEG = {
  kind: 'degrade', channel: 'dead-leg', what: 'seat beta did not review',
  why: "the leg ended 'timeout' with no usable output", effect: '1 of 2 seats reviewed',
};
const HEALED = {
  kind: 'heal', channel: 'shared-server-unavailable', what: 'the shared OpenCode server failed to start',
  why: 'database is locked', effect: 'retried and succeeded; no seats lost',
};
// A record with NO kind key at all — every degrade written by hand or parsed off an
// older verdict.json. `utils/degrade.js :: formatDegrade` still serves it ('Notice'),
// and HEAD renders it as a loss; it is here so the filter change cannot silently
// swallow one.
const LEGACY = {
  channel: 'dropped-members', what: 'a legacy record', why: 'written before kinds existed',
  effect: 'still a loss',
};

const QUALIFIER = 'Tiers report peer concurrence, never verification.';

describe('toModel — intent rides the model (W8 T-A)', () => {
  test('absent ⇒ review; task ⇒ task; anything else fails CLOSED to review', () => {
    expect(toModel(reviewVerdict()).intent).toBe('review');
    expect(toModel(taskVerdict()).intent).toBe('task');
    // verdict.js emits `intent` ONLY as the literal 'task' (emit-when-task), so any
    // other value is a hand-assembled or corrupted document. Fail closed — the same
    // direction parseChairTerminal takes on an unknown intent.
    expect(toModel(base({ intent: 'review' })).intent).toBe('review');
    expect(toModel(base({ intent: 'TASK' })).intent).toBe('review');
  });

  test('the header WORD forks; the runType of a review run is untouched', () => {
    // The KEY stays `runType` — both renderers print `h.runType` — and only its
    // VALUE forks, so neither renderer had to learn the rule twice.
    expect(toModel(taskVerdict()).header.runType).toBe('task');
    expect(toModel(reviewVerdict()).header.runType).toBe('council');
    expect(toModel(base({ runType: undefined })).header.runType).toBe('review');
    // A task run's transport word is NOT what the reader is told it was.
    expect(toModel(taskVerdict({ runType: 'headless' })).header.runType).toBe('task');
  });

  test('both renderers print the forked word in their title', () => {
    expect(buildReport({ verdict: taskVerdict() }, { format: 'md' })).toContain('# Council Report — task (r1)');
    expect(buildReport({ verdict: taskVerdict() }, { format: 'html' })).toContain('<h1>Council Report — task (r1)</h1>');
    expect(buildReport({ verdict: reviewVerdict() }, { format: 'md' })).toContain('# Council Report — council (r1)');
    expect(buildReport({ verdict: reviewVerdict() }, { format: 'html' })).toContain('<h1>Council Report — council (r1)</h1>');
  });
});

describe('the concurrence qualifier (spec §5.4) — named mutant QUALIFIERDROP', () => {
  // MUTANT QUALIFIERDROP: the qualifier never renders (both emits forced off —
  // `report-md.js :: renderMd`'s `if (m.intent === 'task')` and the `qualifier`
  // const in `report-html.js :: renderHtml`). MEASURED red set, run over the seven
  // report suites (report-intent, report, report-cost, report-md, report-debate,
  // report-claude-column, report-cred-seat): EXACTLY the three tests below —
  // 'md: the qualifier sits directly under the tier table', 'html: …directly after
  // the tier table', and 'placement: …BEFORE the adjudication matrix'. 3 failed,
  // 70 passed. Nothing else moves, which is the point: both .snap documents and
  // every review-run pin stay green because the line is additive on task runs only.
  test('md: the qualifier sits directly under the tier table', () => {
    const md = buildReport({ verdict: taskVerdict() }, { format: 'md' });
    expect(md).toContain([
      '| Tier | Count |',
      '|---|---|',
      '| Disputed | 0 |',
      '| Contested | 0 |',
      '| Confirmed | 1 |',
      '| Singleton | 2 |',
      '',
      `_${QUALIFIER}_`,
    ].join('\n'));
  });

  test('html: the qualifier sits directly after the tier table', () => {
    const html = buildReport({ verdict: taskVerdict() }, { format: 'html' });
    expect(html).toContain(`</table>\n<p class="legend">${QUALIFIER}</p>`);
  });

  test('placement: a reader of the tiers sees it BEFORE the adjudication matrix', () => {
    for (const format of ['md', 'html']) {
      const out = buildReport({ verdict: taskVerdict() }, { format });
      const tiers = out.indexOf('Verdict summary');
      const qual = out.indexOf(QUALIFIER);
      const matrix = out.indexOf('Adjudication matrix');
      expect(tiers).toBeGreaterThan(-1);
      expect(qual).toBeGreaterThan(tiers);
      expect(qual).toBeLessThan(matrix);
    }
  });

  test('ABSENT on a review run, both formats (byte-identity half of the fork)', () => {
    for (const format of ['md', 'html']) {
      expect(buildReport({ verdict: reviewVerdict() }, { format })).not.toContain(QUALIFIER);
      expect(buildReport({ verdict: reviewVerdict() }, { format })).not.toContain('peer concurrence');
    }
  });
});

describe("'What was lost' is losses only — an announcement is not a loss (W5.1 handoff)", () => {
  const mixed = () => taskVerdict({ degrades: [DEAD_LEG, LEDGER_SKIPPED, HEALED] });

  test('md: the info note lands under Notes, NOT under What was lost', () => {
    const md = buildReport({ verdict: mixed() }, { format: 'md' });
    const lost = md.indexOf('## What was lost');
    const notes = md.indexOf('**Notes:**');
    expect(lost).toBeGreaterThan(-1);
    expect(notes).toBeGreaterThan(lost);
    // The losses section holds the dead leg and NOTHING else.
    expect(md.slice(lost, notes)).toContain('- Notice: seat beta did not review');
    expect(md.slice(lost, notes)).not.toContain('task runs write no reliability rows');
    // ONE voice, still: formatDegrade leads an info record with 'Note'.
    expect(md.slice(notes)).toContain('- Note: task runs write no reliability rows —');
    // A heal is neither a loss nor a note.
    expect(md).not.toContain('the shared OpenCode server failed to start');
  });

  test('html: same split, same one voice', () => {
    const html = buildReport({ verdict: mixed() }, { format: 'html' });
    const lost = html.indexOf('<h2>What was lost</h2>');
    const notes = html.indexOf('<strong>Notes:</strong>');
    expect(lost).toBeGreaterThan(-1);
    expect(notes).toBeGreaterThan(lost);
    expect(html.slice(lost, notes)).toContain('seat beta did not review');
    expect(html.slice(lost, notes)).not.toContain('task runs write no reliability rows');
    expect(html.slice(notes)).toContain('<li>Note: task runs write no reliability rows');
    expect(html).not.toContain('the shared OpenCode server failed to start');
  });

  test('an info-only run grows NO What-was-lost heading at all', () => {
    const v = taskVerdict({ degrades: [LEDGER_SKIPPED] });
    for (const format of ['md', 'html']) {
      const out = buildReport({ verdict: v }, { format });
      expect(out).not.toContain('What was lost');
      expect(out).toContain('Notes:');
      expect(out).toContain('task runs write no reliability rows');
    }
  });

  test('a losses-only run grows NO Notes list (heading-over-nothing, both ways)', () => {
    const v = reviewVerdict({ degrades: [DEAD_LEG, HEALED] });
    for (const format of ['md', 'html']) {
      const out = buildReport({ verdict: v }, { format });
      expect(out).toContain('What was lost');
      expect(out).not.toContain('Notes:');
    }
  });

  test('a KIND-LESS legacy record is still a loss (the filter must not swallow it)', () => {
    // ⚠️ This is why the predicate is `!== 'heal' && !== 'info'` and not the
    // positive `=== 'degrade'`: HEAD renders a kind-less record as a loss, and the
    // positive spelling drops it from BOTH lists — a silent deletion on exactly the
    // documents (hand-written, or written before kinds) this renderer must not lie
    // about. Named mutant LEGACYDROP (`filter(d => d.kind === 'degrade')`), MEASURED:
    // red set is this test ALONE across the eight report/render suites, and the
    // rendered review document changes byte-length 1016 -> 944 (md) and
    // 10136 -> 10025 (html) — i.e. it is a byte-identity break nothing else sees.
    const v = reviewVerdict({ degrades: [LEGACY] });
    for (const format of ['md', 'html']) {
      const out = buildReport({ verdict: v }, { format });
      expect(out).toContain('What was lost');
      expect(out).toContain('a legacy record');
      expect(out).not.toContain('Notes:');
    }
  });

  test('the Notes list is KIND-driven, not intent-driven', () => {
    // No review path produces an info record today, so this changes no shipped
    // review byte; it pins that the split follows `kind`, which is the property
    // that keeps the two lists honest if one ever does.
    const md = buildReport({ verdict: reviewVerdict({ degrades: [LEDGER_SKIPPED] }) }, { format: 'md' });
    expect(md).toContain('**Notes:**');
    expect(md).not.toContain(QUALIFIER);
  });

  test('the model splits the two lists; a clean verdict keeps both empty', () => {
    const m = toModel(mixed());
    expect(m.degrades).toEqual([DEAD_LEG]);
    expect(m.notes).toEqual([LEDGER_SKIPPED]);
    const clean = toModel(reviewVerdict());
    expect(clean.degrades).toEqual([]);
    expect(clean.notes).toEqual([]);
  });
});
