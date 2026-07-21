// tests/council/report-debate.test.js
'use strict';
const { buildReport, toModel } = require('../../src/council/report');
const { tally } = require('../../src/council/tally');
const { buildVerdict } = require('../../src/council/verdict');
const avInput = require('./fixtures/av-receiver-input');

function verdictWithDebate() {
  return {
    schemaVersion: 2, type: 'council-verdict', runId: 'r', runType: 'headless', date: 'd',
    chair: 'deepseek', council: ['gemini', 'gpt', 'qwen'], claudeInCouncil: false, overallVerdict: 'Fix these first',
    tierCounts: { Confirmed: 1, Contested: 1, Singleton: 0, Disputed: 0 },
    streetCred: [], runStats: [],
    findings: [
      { id: 'A1', raiser: 'gemini', severity: 'major', tier: 'Contested', basis: { a: 1, d: 1, n: 0 },
        adjudications: [], debate: { action: 'defended', previousTier: 'Disputed' } },
      { id: 'A2', raiser: 'gemini', severity: 'minor', tier: 'Singleton', basis: { a: 0, d: 0, n: 0 },
        adjudications: [], debate: { action: 'withdrawn', previousTier: 'Contested' } },
      { id: 'B1', raiser: 'gpt', severity: 'nit', tier: 'Confirmed', basis: { a: 2, d: 0, n: 0 }, adjudications: [] },
    ],
  };
}

describe('toModel debate view', () => {
  test('collects withdrawn + tier movements only for debated findings', () => {
    const m = toModel(verdictWithDebate());
    expect(m.debate.present).toBe(true);
    expect(m.debate.withdrawn.map(w => w.id)).toEqual(['A2']);
    expect(m.debate.movements.find(x => x.id === 'A1')).toMatchObject({ previousTier: 'Disputed', tier: 'Contested' });
  });
  test('no debate metadata → present:false', () => {
    const v = verdictWithDebate();
    for (const f of v.findings) { delete f.debate; }
    expect(toModel(v).debate.present).toBe(false);
  });
});

describe('renderers emit the debate section only when present', () => {
  test('markdown carries a Debate round section', () => {
    const md = buildReport({ verdict: verdictWithDebate() }, { format: 'md' });
    expect(md).toContain('## Debate round');
    expect(md).toContain('Withdrawn by raiser');
    expect(md).toContain('A2');
    expect(md).toContain('Disputed → Contested');
  });
  test('html carries a Debate round section', () => {
    const html = buildReport({ verdict: verdictWithDebate() }, { format: 'html' });
    expect(html).toContain('Debate round');
    expect(html).toContain('A2');
  });
  test('a non-debate verdict renders no Debate round section', () => {
    const v = verdictWithDebate();
    for (const f of v.findings) { delete f.debate; }
    expect(buildReport({ verdict: v }, { format: 'md' })).not.toContain('## Debate round');
  });
});

// v4.0 byte-unchanged pin (spec §5.6): a run with NO debate round must render
// identically to what v4.0 produced. av-receiver-input's findings carry no
// `.debate` key at all (real-world "never debated" shape); the snapshot below
// was captured against the pre-Task-6 renderers and must keep matching
// verbatim now that the conditional Debate-round block exists in both
// renderers — proves the new branch never fires when debate is absent.
describe('no-debate report is byte-unchanged from the v4.0 baseline', () => {
  function noDebateVerdict() {
    const record = tally(avInput);
    return buildVerdict(record, [{ id: 'C6', decision: 'denied', applied: false }]);
  }
  test('markdown output matches the pinned v4.0 snapshot exactly', () => {
    expect(buildReport({ verdict: noDebateVerdict() }, { format: 'md' })).toMatchSnapshot();
  });
  test('html output matches the pinned v4.0 snapshot exactly', () => {
    expect(buildReport({ verdict: noDebateVerdict() }, { format: 'html' })).toMatchSnapshot();
  });
  test('a findings array with no .debate decoration on any finding ⇒ debate.present is false', () => {
    const m = toModel(noDebateVerdict());
    expect(m.debate.present).toBe(false);
    expect(m.debate.withdrawn).toEqual([]);
    expect(m.debate.movements).toEqual([]);
  });
});

// Defense-in-depth for item 7 of the task brief: anything interpolated into the
// new Debate-round HTML block must go through the file's existing esc() helper,
// same as every other cell in the file — no new unescaped-interpolation vector.
describe('HTML debate section follows the file\'s existing escaping discipline', () => {
  test('a finding id carrying HTML-significant characters is escaped, not injected raw', () => {
    const v = verdictWithDebate();
    v.findings[0].id = 'A1<script>alert(1)</script>';
    v.findings[1].id = 'A2<img src=x onerror=alert(2)>';
    const html = buildReport({ verdict: v }, { format: 'html' });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x onerror=alert(2)>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(2)&gt;');
  });
});
