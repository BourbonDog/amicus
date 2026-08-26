// tests/council/report-claude-column.test.js
'use strict';
const { tally } = require('../../src/council/tally');
const { buildVerdict } = require('../../src/council/verdict');
const { buildReport } = require('../../src/council/report');
const avInput = require('./fixtures/av-receiver-input');

// SKILL.md:448 / run-stage2.js :: runStage2 (the ROSTER-not-bundle derivation
// of `judges`) guarantee: a --claude-review file is
// judged by the council but never joins the judge roster. 'claude' legitimately
// sits in meta.models (verdict.council) — that's the street-cred universe
// (run-assemble.js:226, and the `meta.models` row of docs/council.md's
// `### Tally-input schema` section, whose wording is "this is the street-cred
// universe") — but it must never grow an
// adjudication-matrix column, or the report asserts claude cast a vote it never
// cast (the legend under docs/council.md's `## Adjudication matrix` section:
// a bare `*` means "raiser's own vote" —
// under v4.8 PR4c that is the raiser's SEAT, and seats[] is bench-only, so a
// seat-space roster can never grow a claude column either).
function claudeInCouncilVerdict() {
  const tallyInput = {
    meta: { runId: 'claude-council', runType: 'headless', date: '2026-07-20',
      models: ['gemini', 'gpt', 'claude'], chair: 'deepseek', claudeInCouncil: true },
    findings: [
      { id: 'A1', raiser: 'gemini', severity: 'high' },
      { id: 'D1', raiser: 'claude', severity: 'medium' }, // claude's own file-sourced finding
    ],
    adjudications: [
      { findingId: 'A1', judge: 'gemini', verdict: 'agree' },
      { findingId: 'A1', judge: 'gpt', verdict: 'agree' },
      { findingId: 'D1', judge: 'gemini', verdict: 'dispute' },
      { findingId: 'D1', judge: 'gpt', verdict: 'agree' },
      // deliberately NO 'claude' judge entries anywhere — claude never judges.
    ],
    rankings: [
      { judge: 'gemini', order: ['gpt', 'claude'] },
      { judge: 'gpt', order: ['claude', 'gemini'] },
    ],
    runStats: [
      { model: 'gemini', role: 'gemini', wasChair: false, conformance: 'clean', status: 'complete', durationMs: 1000, usage: { cost: 0.01 } },
      { model: 'gpt', role: 'gpt', wasChair: false, conformance: 'clean', status: 'complete', durationMs: 1200, usage: { cost: 0.02 } },
      { model: 'claude', role: 'claude', wasChair: false, conformance: 'clean', status: 'complete', durationMs: null, usage: null },
    ],
  };
  const record = tally(tallyInput);
  return buildVerdict(record, []);
}

// The trap: a NON-claude run where one bench judge (qwen) cast zero
// adjudications — e.g. it failed its repair loop and was dropped
// (run-stages.js:204-207). It is still in meta.models and MUST still render
// its (blank) column. A vote-derived judge roster would silently delete this
// column too, which is exactly the shortcut item 8 forbids.
function degradedNonClaudeVerdict() {
  const tallyInput = {
    meta: { runId: 'degraded', runType: 'headless', date: '2026-07-20',
      models: ['gemini', 'gpt', 'qwen'], chair: 'deepseek', claudeInCouncil: false },
    findings: [{ id: 'A1', raiser: 'gemini', severity: 'major' }],
    adjudications: [
      { findingId: 'A1', judge: 'gemini', verdict: 'agree' },
      { findingId: 'A1', judge: 'gpt', verdict: 'agree' },
      // qwen produced zero adjudications (dead/unstructured judge leg).
    ],
    rankings: [
      { judge: 'gemini', order: ['gpt'] },
      { judge: 'gpt', order: ['gemini'] },
    ],
    runStats: [
      { model: 'gemini', role: 'gemini', wasChair: false, conformance: 'clean', status: 'complete', durationMs: 900, usage: { cost: 0.01 } },
      { model: 'gpt', role: 'gpt', wasChair: false, conformance: 'clean', status: 'complete', durationMs: 950, usage: { cost: 0.01 } },
      { model: 'qwen', role: 'qwen', wasChair: false, conformance: 'unstructured', status: 'complete', durationMs: 800, usage: null },
    ],
  };
  const record = tally(tallyInput);
  return buildVerdict(record, []);
}

describe('claude-in-council report: no judge column for claude', () => {
  const verdict = claudeInCouncilVerdict();
  const md = buildReport({ verdict }, { format: 'md' });
  const html = buildReport({ verdict }, { format: 'html' });

  test('meta/council line still lists claude and flags "Claude in council"', () => {
    expect(md).toContain('council: gemini, gpt, claude');
    expect(md).toContain('Claude in council');
    expect(html).toContain('council: gemini, gpt, claude');
    expect(html).toContain('Claude in council');
  });

  test('street-cred still carries a real (non-null) claude row', () => {
    expect(md).toMatch(/\|\s*claude\s*\|\s*1\.50\s*\|\s*1\.50\s*\|/);
    expect(html).toMatch(/<td>claude<\/td><td>1\.50<\/td><td>1\.50<\/td>/);
  });

  test('markdown adjudication matrix header has exactly gemini + gpt columns, no claude', () => {
    const headerLine = md.split('\n').find(l => l.startsWith('| Finding |'));
    expect(headerLine).toBe('| Finding | Sev | Raiser | gemini | gpt | Tier | Decision |');
  });

  test('markdown row for claude\'s own finding shows no bare-star claude cell', () => {
    const d1Line = md.split('\n').find(l => l.includes('| D1 |'));
    // Before the fix this rendered "| D1 | medium | claude | ✗ | ✓ |  * | Contested |  |"
    // — a bare `*` asserting claude voted for its own finding. After the fix
    // there must be exactly 2 vote cells (gemini, gpt) and no claude cell at all.
    expect(d1Line).toBe('| D1 | medium | claude | ✗ | ✓ | Contested |  |');
  });

  test('html adjudication matrix has no <th>claude</th> and no claude data column', () => {
    expect(html).not.toContain('<th>claude</th>');
    expect(html).toContain('<th>gemini</th><th>gpt</th><th>Tier</th>');
  });

  test('html row for claude\'s own finding has exactly 2 vote cells', () => {
    const rowMatch = html.match(/<tr[^>]*><td>D1<\/td>.*?<\/tr>/);
    expect(rowMatch).not.toBeNull();
    const voteCells = rowMatch[0].match(/<td class="c">/g) || [];
    expect(voteCells.length).toBe(2);
  });
});

describe('TRAP GUARD: a dead/unstructured bench judge with zero adjudications still gets a column', () => {
  const verdict = degradedNonClaudeVerdict();
  const md = buildReport({ verdict }, { format: 'md' });
  const html = buildReport({ verdict }, { format: 'html' });

  test('markdown header still has the qwen column (3 judge columns)', () => {
    const headerLine = md.split('\n').find(l => l.startsWith('| Finding |'));
    expect(headerLine).toBe('| Finding | Sev | Raiser | gemini | gpt | qwen | Tier | Decision |');
  });

  test('markdown row shows a blank qwen cell, not a removed column', () => {
    const a1Line = md.split('\n').find(l => l.includes('| A1 |'));
    expect(a1Line).toBe('| A1 | major | gemini | ✓* | ✓ |   | Confirmed |  |');
  });

  test('html still has a <th>qwen</th> column', () => {
    expect(html).toContain('<th>gemini</th><th>gpt</th><th>qwen</th><th>Tier</th>');
  });
});

describe('byte-unchanged-artifact contract: a no-flag (claudeInCouncil:false) run is untouched', () => {
  function noFlagVerdict() {
    const record = tally(avInput);
    return buildVerdict(record, [{ id: 'C6', decision: 'denied', applied: false }]);
  }
  test('markdown output matches the pinned snapshot exactly', () => {
    expect(buildReport({ verdict: noFlagVerdict() }, { format: 'md' })).toMatchSnapshot();
  });
  test('html output matches the pinned snapshot exactly', () => {
    expect(buildReport({ verdict: noFlagVerdict() }, { format: 'html' })).toMatchSnapshot();
  });
});
