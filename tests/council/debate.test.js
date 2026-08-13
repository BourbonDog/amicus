// tests/council/debate.test.js
'use strict';
const { applyDebate, decorateRecord, debateRunStatsRows, debateTargets, PAST_TENSE, DEBATE_ROLES } =
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

// ============================================================================
// v4.8 PR3 Task 6 — the debate round joins on the SEAT, not the alias.
// A twin bench (`--models deepseek,deepseek`) mints seat ids `deepseek#1` /
// `deepseek#2` while BOTH adjudication rows keep `judge: 'deepseek'`. Task 5
// put `seat` on adjudications[] and `raiserSeat` on findings[] (emit-when-
// DIFFERENT, so a unique bench is byte-identical); this is where the debate
// round starts joining on them.
// ============================================================================

/** One finding, adjudicated by BOTH twins plus a unique third seat. */
function twinAdjInput() {
  return {
    meta: { runId: 'r', models: ['deepseek', 'deepseek', 'gpt'], chair: 'gemini', claudeInCouncil: false },
    findings: [{ id: 'A1', raiser: 'gpt', severity: 'major', claim: 'infinite retry' }],
    adjudications: [
      { findingId: 'A1', judge: 'deepseek', seat: 'deepseek#1', verdict: 'dispute' },
      { findingId: 'A1', judge: 'deepseek', seat: 'deepseek#2', verdict: 'dispute' },
      { findingId: 'A1', judge: 'gpt', verdict: 'dispute' },
    ],
    rankings: [{ judge: 'deepseek', order: ['gpt'] }, { judge: 'gpt', order: ['deepseek'] }],
    runStats: [],
  };
}
/** The projection run-debate.js builds from o.seats — identity for any non-seat key. */
const twinAliasOf = (key) => ({ 'deepseek#1': 'deepseek', 'deepseek#2': 'deepseek' }[key] || key);
const adjOf = (input, findingId, seatOrJudge) => input.adjudications.find(
  a => a.findingId === findingId && (a.seat || a.judge) === seatOrJudge);

describe('applyDebate — the re-vote join is SEAT-exact (v4.8 PR3 Task 6)', () => {
  test('both twins flip, each from its OWN seat key', () => {
    const { input } = applyDebate({
      provisionalRecord: null, tallyInput: twinAdjInput(), defenseByRaiser: {},
      revoteByJudge: {
        'deepseek#1': { A1: { verdict: 'agree' } },
        'deepseek#2': { A1: { verdict: 'neutral' } },
      },
      aliasOf: twinAliasOf,
    });
    // ⚠️ Today this fails by GROWTH, not by "only the first flips": the seat keys
    // match no `a.judge`, so debate.js's `.find()` misses and the else-branch
    // FAILS OPEN and pushes two brand-new rows (3 → 5).
    expect(input.adjudications).toHaveLength(3);
    expect(adjOf(input, 'A1', 'deepseek#1').verdict).toBe('agree');
    expect(adjOf(input, 'A1', 'deepseek#2').verdict).toBe('neutral');
    expect(adjOf(input, 'A1', 'gpt').verdict).toBe('dispute');   // never in the wave
  });

  // The discriminating companion to the test above: it is what makes the key
  // seat-EXACT. Loosening the match back toward alias equality to "fix" the test
  // above reinstates D5 (first-wins), the defect this task exists to kill.
  test('ONE twin re-votes: its row flips and the OTHER twin is untouched', () => {
    const { input } = applyDebate({
      provisionalRecord: null, tallyInput: twinAdjInput(), defenseByRaiser: {},
      revoteByJudge: { 'deepseek#1': { A1: { verdict: 'agree' } } },
      aliasOf: twinAliasOf,
    });
    expect(input.adjudications).toHaveLength(3);
    expect(adjOf(input, 'A1', 'deepseek#1').verdict).toBe('agree');
    expect(adjOf(input, 'A1', 'deepseek#2').verdict).toBe('dispute');
  });

  // The contract pin that makes a future half-flip fail LOUDLY instead of
  // inventing rows: debate.js's else-branch fails open.
  test('the adjudications array never GROWS when every re-vote key names a known judge', () => {
    const { input } = applyDebate({
      provisionalRecord: null, tallyInput: twinAdjInput(), defenseByRaiser: {},
      revoteByJudge: {
        'deepseek#1': { A1: { verdict: 'agree' } },
        'deepseek#2': { A1: { verdict: 'agree' } },
        gpt: { A1: { verdict: 'agree' } },
      },
      aliasOf: twinAliasOf,
    });
    expect(input.adjudications).toHaveLength(3);
  });

  // The push branch itself. debate.test.js's "a re-vote on an id the judge never
  // disputed" case does NOT reach it (baseInput already carries {A2, gpt}), so
  // this branch is otherwise uncovered by the whole suite — and it is where a
  // missing `aliasOf` writes a SEAT ID into the alias-space `judge` field, which
  // reaches tally.js's `v.judge !== f.raiser` and report.js's `byJudge[adj.judge]`.
  test('a genuinely new row carries the ALIAS in `judge` and the seat in `seat`', () => {
    const { input } = applyDebate({
      provisionalRecord: null, tallyInput: twinAdjInput(), defenseByRaiser: {},
      revoteByJudge: { 'deepseek#2': { A2: { verdict: 'agree' } } },
      aliasOf: twinAliasOf,
    });
    expect(input.adjudications).toHaveLength(4);
    expect(input.adjudications.find(a => a.findingId === 'A2'))
      .toEqual({ findingId: 'A2', judge: 'deepseek', verdict: 'agree', seat: 'deepseek#2' });
  });

  // Legacy parity: no seats anywhere ⇒ (a.seat || a.judge) === a.judge and
  // alias === key, so the pushed row is byte-identical to today's.
  test('a unique bench pushes the byte-identical {findingId, judge, verdict} row', () => {
    const { input } = applyDebate({
      provisionalRecord: null, tallyInput: baseInput(), defenseByRaiser: {},
      revoteByJudge: { qwen: { B1: { verdict: 'agree' } } },
    });
    expect(input.adjudications.find(a => a.findingId === 'B1' && a.judge === 'qwen'))
      .toEqual({ findingId: 'B1', judge: 'qwen', verdict: 'agree' });
  });
});

describe('debateTargets — byRaiser is keyed on the SEAT (v4.8 PR3 Task 6)', () => {
  /** BOTH twins raise: the alias key collapses them onto one defense solo. */
  function twinRaiserInput() {
    return {
      meta: { runId: 'r', models: ['deepseek', 'deepseek', 'gpt'], chair: 'gemini', claudeInCouncil: false },
      findings: [
        { id: 'A1', raiser: 'deepseek', raiserSeat: 'deepseek#1', severity: 'major', claim: 'infinite retry' },
        { id: 'B1', raiser: 'deepseek', raiserSeat: 'deepseek#2', severity: 'major', claim: 'unbounded queue' },
      ],
      adjudications: [
        { findingId: 'A1', judge: 'gpt', verdict: 'dispute' },
        { findingId: 'B1', judge: 'gpt', verdict: 'dispute' },
      ],
      rankings: [{ judge: 'deepseek', order: ['gpt'] }, { judge: 'gpt', order: ['deepseek'] }],
      runStats: [],
    };
  }

  test('twin raisers get one bucket EACH, not one shared bucket', () => {
    const input = twinRaiserInput();
    const { byRaiser } = debateTargets(tally(input), input);
    expect(Object.keys(byRaiser).sort()).toEqual(['deepseek#1', 'deepseek#2']);
    expect(byRaiser['deepseek#1'].map(f => f.id)).toEqual(['A1']);
    expect(byRaiser['deepseek#2'].map(f => f.id)).toEqual(['B1']);
  });

  test('a unique bench keeps its ALIAS keys, and the reserved `claude` key is untouched', () => {
    const input = baseInput();
    input.findings.push({ id: 'C1', raiser: 'claude', severity: 'major', claim: 'from the file review' });
    input.adjudications.push({ findingId: 'C1', judge: 'gpt', verdict: 'dispute' });
    const { byRaiser } = debateTargets(tally(input), input);
    // A1+A2 are gemini's (both disputed), C1 is the reserved file-sourced seat.
    expect(Object.keys(byRaiser).sort()).toEqual(['claude', 'gemini']);
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

  test('waveId rides the row when the leg carries one, absent otherwise (byte-compat with the row above)', () => {
    const rows = debateRunStatsRows({
      defenseLegs: [{ model: 'gemini', status: 'complete', durationMs: 50, usage: null, conformance: 'clean', waveId: 'r-d1' }],
      revoteLegs: [{ model: 'gpt', status: 'complete', durationMs: 60, usage: null, conformance: 'unstructured' }],
    });
    expect(rows[0].waveId).toBe('r-d1');
    expect('waveId' in rows[1]).toBe(false);
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

  // ---- v4.7 D2/E4: superseded pre-repair legs + failed-repair rows ----
  describe('v4.7 D2/E4 — superseded and failed-repair rows', () => {
    // Repair SUCCEEDED (leg2 usable): the primary keeps the post-repair leg
    // (today's rebuttal/revote row, unchanged) and the ORIGINAL pre-repair leg
    // becomes a separate role:'superseded' row — never lost, never billed twice
    // as the primary.
    test('a successful repair supersedes the original leg; primary keeps the post-repair leg (waveId -d1r vs -d1)', () => {
      const rows = debateRunStatsRows({
        defenseLegs: [{ model: 'gemini', status: 'complete', durationMs: 60, usage: null, conformance: 'repaired', waveId: 'r-d1r' }],
        revoteLegs: [],
        supersededLegs: [{ model: 'gemini', status: 'complete', durationMs: 50, usage: null, conformance: 'unstructured', waveId: 'r-d1' }],
        repairLegs: [],
      });
      expect(rows).toEqual([
        { model: 'gemini', role: 'rebuttal', wasChair: false, conformance: 'repaired', status: 'complete', durationMs: 60, usage: null, waveId: 'r-d1r' },
        { model: 'gemini', role: 'superseded', wasChair: false, conformance: 'unstructured', status: 'complete', durationMs: 50, usage: null, waveId: 'r-d1' },
      ]);
    });

    // Repair FAILED (leg2 launched but never became usable — a dead/timeout
    // attempt, not merely unparseable content): the primary keeps the
    // ORIGINAL leg (today's behavior) and the failed repair attempt gets its
    // own role:'repair' row, error status riding naturally off the raw leg.
    test('a failed repair keeps the primary on the original; the failed attempt gets its own repair row (waveId -rv-gptr)', () => {
      const rows = debateRunStatsRows({
        defenseLegs: [],
        revoteLegs: [{ model: 'gpt', status: 'complete', durationMs: 40, usage: null, conformance: 'unstructured', waveId: 'r-rv' }],
        supersededLegs: [],
        repairLegs: [{ model: 'gpt', status: 'timeout', durationMs: 5000, usage: null, conformance: 'unstructured', waveId: 'r-rv-gptr' }],
      });
      expect(rows).toEqual([
        { model: 'gpt', role: 'revote', wasChair: false, conformance: 'unstructured', status: 'complete', durationMs: 40, usage: null, waveId: 'r-rv' },
        { model: 'gpt', role: 'repair', wasChair: false, conformance: 'unstructured', status: 'timeout', durationMs: 5000, usage: null, waveId: 'r-rv-gptr' },
      ]);
    });

    test('no repair attempted: supersededLegs/repairLegs absent or empty leaves rows byte-identical to today', () => {
      const withoutParams = debateRunStatsRows({
        defenseLegs: [{ model: 'gemini', status: 'complete', durationMs: 50, usage: null, conformance: 'clean' }],
        revoteLegs: [{ model: 'gpt', status: 'complete', durationMs: 60, usage: null, conformance: 'clean' }],
      });
      const withEmptyParams = debateRunStatsRows({
        defenseLegs: [{ model: 'gemini', status: 'complete', durationMs: 50, usage: null, conformance: 'clean' }],
        revoteLegs: [{ model: 'gpt', status: 'complete', durationMs: 60, usage: null, conformance: 'clean' }],
        supersededLegs: [], repairLegs: [],
      });
      expect(withoutParams).toEqual(withEmptyParams);
      expect(withoutParams).toHaveLength(2);
    });
  });

  test('mk passes resolvedModel through when the normalized leg carries it (v4.7 GOA-7 D8)', () => {
    const rows = debateRunStatsRows({
      defenseLegs: [{ model: 'gemini', resolvedModel: 'google/gemini-3.5-pro', status: 'complete',
        durationMs: 5, usage: null, conformance: 'clean', waveId: 'r-d1' }],
      revoteLegs: [{ model: 'gpt', status: 'complete', durationMs: 5, usage: null, conformance: 'clean' }],
    });
    expect(rows[0]).toMatchObject({ role: 'rebuttal', resolvedModel: 'google/gemini-3.5-pro' });
    expect('resolvedModel' in rows[1]).toBe(false);
  });
});
