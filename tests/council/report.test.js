'use strict';
const { tally } = require('../../src/council/tally');
const { buildVerdict } = require('../../src/council/verdict');
const { buildReport } = require('../../src/council/report');
const avInput = require('./fixtures/av-receiver-input');

function verdictFixture() {
  const record = tally(avInput);
  return buildVerdict(record, [{ id: 'C6', decision: 'denied', applied: false }]);
}

describe('buildReport markdown', () => {
  const md = buildReport({ verdict: verdictFixture() }, { format: 'md' });
  test('has a titled header with run metadata', () => {
    expect(md).toContain('# Council Report');
    expect(md).toContain('av-receiver-council');
  });
  test('renders the adjudication matrix with judge columns', () => {
    expect(md).toContain('Adjudication matrix');
    for (const judge of ['deepseek', 'gpt', 'mistral']) { expect(md).toContain(judge); }
  });
  test('renders the tier counts (peers-only, WS-3 golden)', () => {
    expect(md).toContain('Confirmed');
    expect(md).toMatch(/Disputed[^\n]*\|\s*3/);
  });
  test('groups findings by tier, Disputed-first, and shows the decision', () => {
    const disputedIdx = md.indexOf('### Disputed');
    const singletonIdx = md.indexOf('### Singleton');
    expect(disputedIdx).toBeGreaterThan(-1);
    expect(disputedIdx).toBeLessThan(singletonIdx);
    expect(md).toContain('C6'); // a Disputed finding, decided "denied"
    expect(md).toContain('denied');
  });
  test('renders a street-cred table and a cost table (no invented numbers)', () => {
    expect(md).toContain('Street-cred');
    expect(md).toContain('Cost');
    expect(md).toContain('—'); // av-receiver runStats.usage is null → em dash
  });
});

describe('buildReport html', () => {
  const html = buildReport({ verdict: verdictFixture() }, { format: 'html' });
  test('is a self-contained document with inline styles and a table', () => {
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<style');
    expect(html).toContain('<table');
    expect(html).toContain('av-receiver-council');
  });
  test('injects the bundled Outfit / IBM Plex Mono @font-face and leads the sans stack with Outfit', () => {
    expect(html).toContain('@font-face');
    expect(html).toContain('Outfit');
    expect(html).toContain('IBM Plex Mono');
    // Finding #5: assert Outfit LEADS every sans stack, not merely that one
    // 'system-ui, sans-serif' substring is absent. system-ui stays as a
    // legitimate fallback AFTER Outfit.
    const sansStacks = html.match(/font(?:-family)?:\s*[^;]*sans-serif/g) || [];
    expect(sansStacks.length).toBeGreaterThan(0);
    for (const stack of sansStacks) {
      // the first quoted family in the stack must be 'Outfit'
      expect(stack).toMatch(/(?:font-family|font):\s*[^'";]*'Outfit'/);
      const firstFamily = stack.match(/'([^']+)'/);
      expect(firstFamily && firstFamily[1]).toBe('Outfit');
    }
  });
  test('declares the shared light-ground tier palette as CSS vars (not a hardcoded map)', () => {
    expect(html).toContain('--tier-confirmed: #d7ead0');
    expect(html).toContain('--tier-contested: #efe4c4');
    expect(html).toContain('--tier-disputed: #ecd4ec');
    expect(html).toContain('--tier-singleton: #e2e0ea');
    expect(html).toContain('--tier-confirmed-ink: #15803d');
    expect(html).toContain('--tier-contested-ink: #b45309');
    expect(html).toContain('--tier-disputed-ink: #a21caf');
    expect(html).toContain('--tier-singleton-ink: #4b5563');
  });
  test('tints finding rows via the tier var, not an inline hex', () => {
    // av-receiver golden has Disputed + Singleton findings (WS-3)
    expect(html).toContain('background:var(--tier-disputed)');
    expect(html).toContain('background:var(--tier-singleton)');
    expect(html).not.toContain('#fde2e1'); // the old Disputed hex is gone
    expect(html).not.toContain('#dcfce7'); // the old Confirmed hex is gone
  });
});

describe('buildReport guards', () => {
  test('throws on a verdict missing findings', () => {
    expect(() => buildReport({ verdict: { runId: 'x' } }, { format: 'md' })).toThrow();
  });
});

describe('buildReport markdown — an all-clean bench (review minor M3, LC-10 fast-follow)', () => {
  // Task 3 disclosed and deliberately left this one: on a run where every seat
  // honestly reported nothing, m.findings is [], so every TIER_ORDER group is
  // empty and the old code emitted '## Findings by tier' with nothing beneath
  // it before '## Cost' — the same heading-over-nothing class Task 3 closed in
  // the Stage-2 prompts, human-facing here instead of model-facing.
  const cleanVerdict = {
    runType: 'review', runId: 'clean-bench', date: '2026-07-26', chair: 'chair-model',
    council: ['gemini', 'gpt'], claudeInCouncil: false,
    tierCounts: { Confirmed: 0, Contested: 0, Singleton: 0, Disputed: 0 },
    findings: [], streetCred: [{ model: 'gemini', peersOnly: 1, withSelf: 1 }], runStats: [],
  };
  const md = buildReport({ verdict: cleanVerdict }, { format: 'md' });

  test('states the clean bench instead of leaving the heading to dangle', () => {
    expect(md).toContain('## Findings by tier');
    expect(md).toContain('No findings were raised on this bench');
    expect(md).toMatch(/clean review is a valid review/);
  });

  test('the heading is never immediately followed by the next heading with nothing between', () => {
    const tierIdx = md.indexOf('## Findings by tier');
    const costIdx = md.indexOf('## Cost');
    expect(tierIdx).toBeGreaterThan(-1);
    expect(costIdx).toBeGreaterThan(tierIdx);
    const between = md.slice(tierIdx + '## Findings by tier'.length, costIdx).trim();
    expect(between.length).toBeGreaterThan(0);
    expect(between).not.toMatch(/^#{1,6}\s/); // not itself a bare heading straight into the next
  });

  test('a bench that raised findings is unaffected (no clean-bench text, tier groups still render)', () => {
    const ordinary = buildReport({ verdict: verdictFixture() }, { format: 'md' });
    expect(ordinary).not.toContain('No findings were raised on this bench');
    expect(ordinary).toContain('### Disputed');
  });
});

const { renderHtml } = require('../../src/council/report-html');

describe('report tier palette ↔ design tokens', () => {
  const html = renderHtml({
    header: { runType: 'review', runId: 'x', date: '', chair: null, council: [], claudeInCouncil: false },
    judges: [], findings: [], tierCounts: { Confirmed: 0, Contested: 0, Singleton: 0, Disputed: 0 },
    streetCred: [], cost: { rows: [], total: null },
  });
  test('the light-ground tier hexes match src/design/tokens.css', () => {
    // canonical values live in the shared token source; assert the report copies them verbatim
    expect(html).toContain('--tier-confirmed: #d7ead0');
    expect(html).toContain('--tier-singleton-ink: #4b5563');
  });
});

describe('What was lost (v4.6 Plan 2)', () => {
  const lostVerdict = () => ({
    schemaVersion: 2, type: 'council-verdict', runId: 'r1', runType: 'council',
    date: '2026-08-01', chair: 'deepseek', council: ['alpha', 'beta'],
    claudeInCouncil: false, overallVerdict: null,
    findings: [], streetCred: [], runStats: [], tierCounts: {},
    degrades: [{
      kind: 'degrade', channel: 'dead-leg',
      what: 'seat beta did not review',
      why: "the leg ended 'timeout' with no usable output",
      effect: '1 of 2 seats reviewed; the run continues with the bench that did and will exit degraded (2)',
      data: { seat: 'beta', status: 'timeout', reason: null },
    }],
  });

  test('md: renders the section through the one voice', () => {
    const md = buildReport({ verdict: lostVerdict() }, { format: 'md' });
    expect(md).toContain('## What was lost');
    expect(md).toContain('- Notice: seat beta did not review — the leg ended');
  });

  test('md: NO heading when the run lost nothing', () => {
    const v = lostVerdict(); delete v.degrades;
    expect(buildReport({ verdict: v }, { format: 'md' })).not.toContain('What was lost');
  });

  test('html: section present, channel and voice line escaped and rendered', () => {
    const html = buildReport({ verdict: lostVerdict() }, { format: 'html' });
    expect(html).toContain('What was lost');
    expect(html).toContain('dead-leg');
    expect(html).toContain('seat beta did not review');
  });

  test('html: absent section on a clean verdict', () => {
    const v = lostVerdict(); delete v.degrades;
    expect(buildReport({ verdict: v }, { format: 'html' })).not.toContain('What was lost');
  });
});
