// tests/council/debate.test.js
'use strict';
const { applyDebate, decorateRecord, debateRunStatsRows, PAST_TENSE, DEBATE_ROLES } =
  require('../../src/council/debate');
const { tally } = require('../../src/council/tally');
const { buildLedgerRows } = require('../../src/council/ledger');

// A provisional tally-input: 3 findings, judges gpt+qwen adjudicated.
function baseInput() {
  return {
    meta: { runId: 'r', models: ['gemini', 'gpt', 'qwen'], chair: 'deepseek', claudeInCouncil: false },
    findings: [
      { id: 'A1', raiser: 'gemini', severity: 'major', claim: 'infinite retry' },
      { id: 'A2', raiser: 'gemini', severity: 'minor', claim: 'log leak' },
      { id: 'B1', raiser: 'gpt', severity: 'nit', claim: 'typo' },
    ],
    adjudications: [
      { findingId: 'A1', judge: 'gpt', verdict: 'dispute' },
      { findingId: 'A1', judge: 'qwen', verdict: 'dispute' },
      { findingId: 'A2', judge: 'gpt', verdict: 'dispute' },
      { findingId: 'B1', judge: 'gemini', verdict: 'neutral' },
    ],
    rankings: [{ judge: 'gpt', order: ['gemini', 'qwen'] }, { judge: 'qwen', order: ['gemini', 'gpt'] }],
    runStats: [{ model: 'gemini', role: 'seat', status: 'complete', durationMs: 100, usage: null }],
  };
}

describe('applyDebate — amend replaces claim only', () => {
  test('amended finding keeps id/raiser/severity, swaps claim', () => {
    const { input } = applyDebate({
      provisionalRecord: null, tallyInput: baseInput(),
      defenseByRaiser: { gemini: { A1: { action: 'amend', claim: 'retry caps at 5' } } },
      revoteByJudge: {},
    });
    const a1 = input.findings.find(f => f.id === 'A1');
    expect(a1).toEqual({ id: 'A1', raiser: 'gemini', severity: 'major', claim: 'retry caps at 5' });
  });
});

describe('applyDebate — withdraw retains the finding', () => {
  test('withdrawn finding stays in findings[] unchanged', () => {
    const { input, debateFindings } = applyDebate({
      provisionalRecord: null, tallyInput: baseInput(),
      defenseByRaiser: { gemini: { A2: { action: 'withdraw' } } },
      revoteByJudge: {},
    });
    expect(input.findings.find(f => f.id === 'A2')).toBeTruthy();
    expect(debateFindings.find(f => f.id === 'A2').action).toBe('withdraw');
  });
});

describe('applyDebate — re-vote replaces only wave judges\' entries on bundled ids', () => {
  test('gpt flips A1 dispute→agree; qwen unchanged; raiser self-vote untouched', () => {
    const { input } = applyDebate({
      provisionalRecord: null, tallyInput: baseInput(),
      defenseByRaiser: { gemini: { A1: { action: 'defend', argument: 'holds' } } },
      revoteByJudge: { gpt: { A1: { verdict: 'agree' } } },
    });
    const gptA1 = input.adjudications.find(a => a.findingId === 'A1' && a.judge === 'gpt');
    const qwenA1 = input.adjudications.find(a => a.findingId === 'A1' && a.judge === 'qwen');
    expect(gptA1.verdict).toBe('agree');
    expect(qwenA1.verdict).toBe('dispute'); // qwen was not in the re-vote wave
  });

  test('a re-vote on an id the judge never disputed is still applied (stateless legs)', () => {
    const { input } = applyDebate({
      provisionalRecord: null, tallyInput: baseInput(),
      defenseByRaiser: {}, revoteByJudge: { gpt: { A2: { verdict: 'agree' } } },
    });
    expect(input.adjudications.find(a => a.findingId === 'A2' && a.judge === 'gpt').verdict).toBe('agree');
  });
});

describe('decorateRecord — additive past-tense debate field', () => {
  test('maps present-tense action to past-tense and attaches previousTier', () => {
    const record = { findings: [
      { id: 'A1', tier: 'Confirmed' }, { id: 'A2', tier: 'Singleton' }, { id: 'B1', tier: 'Singleton' },
    ] };
    const debateFindings = [
      { id: 'A1', action: 'defend', previousTier: 'Contested' },
      { id: 'A2', action: 'withdraw', previousTier: 'Disputed' },
    ];
    decorateRecord(record, debateFindings);
    expect(record.findings[0].debate).toEqual({ action: 'defended', previousTier: 'Contested' });
    expect(record.findings[1].debate).toEqual({ action: 'withdrawn', previousTier: 'Disputed' });
    expect(record.findings[2].debate).toBeUndefined(); // not in the debate
  });
  test('PAST_TENSE maps every action', () => {
    expect(PAST_TENSE).toEqual({ defend: 'defended', amend: 'amended', withdraw: 'withdrawn', 'no-response': 'no-response' });
  });
});

describe('debateRunStatsRows', () => {
  test('emits rebuttal + revote rows tagged with the debate roles', () => {
    const rows = debateRunStatsRows({
      defenseLegs: [{ model: 'gemini', status: 'complete', durationMs: 50, usage: null, conformance: 'clean' }],
      revoteLegs: [{ model: 'gpt', status: 'complete', durationMs: 60, usage: null, conformance: 'unstructured' }],
    });
    expect(rows).toEqual([
      { model: 'gemini', role: 'rebuttal', wasChair: false, conformance: 'clean', status: 'complete', durationMs: 50, usage: null },
      { model: 'gpt', role: 'revote', wasChair: false, conformance: 'unstructured', status: 'complete', durationMs: 60, usage: null },
    ]);
    expect([...DEBATE_ROLES].sort()).toEqual(['rebuttal', 'revote']);
  });

  // A debate leg is an EXTRA leg by a model that already has a bench row. buildLedgerRows
  // joins runStats by model with a last-wins Map, so without the ledger.js guard these rows
  // would clobber the bench row's role/wasChair/conformance. Pin that they do not.
  test('debate legs never overwrite a bench model ledger row', () => {
    const input = baseInput();
    input.runStats = [
      { model: 'gemini', role: 'seat', wasChair: false, conformance: 'clean', status: 'complete', durationMs: 100, usage: null },
      { model: 'gpt', role: 'critic', wasChair: false, conformance: 'clean', status: 'complete', durationMs: 110, usage: null },
      ...debateRunStatsRows({
        defenseLegs: [{ model: 'gemini', status: 'complete', durationMs: 50, usage: null, conformance: 'unstructured' }],
        revoteLegs: [{ model: 'gpt', status: 'complete', durationMs: 60, usage: null, conformance: 'repaired' }],
      }),
    ];
    const rows = buildLedgerRows(tally(input));
    expect(rows).toHaveLength(3);               // one per meta.models entry — debate legs add none
    const gemini = rows.find(r => r.model === 'gemini');
    const gpt = rows.find(r => r.model === 'gpt');
    expect(gemini.role).toBe('seat');           // NOT 'rebuttal'
    expect(gemini.conformance).toBe('clean');   // NOT the defense leg's 'unstructured'
    expect(gpt.role).toBe('critic');            // NOT 'revote'
    expect(gpt.conformance).toBe('clean');      // NOT the re-vote leg's 'repaired'
  });
});
