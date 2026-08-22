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
  // reaches peer-split.js :: peersOf's `v.judge !== f.raiser` and, as an
  // out-of-contract `judge`, report.js :: columnFor's vote→column join.
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

// ---------------------------------------------------------------------------
// v4.8 Phase 6 PR1 Task 3 (SI-24) — PAST_TENSE is prototype-safe.
// ---------------------------------------------------------------------------

/**
 * PAST_TENSE was a plain object literal, so an inherited/unknown `action`
 * (e.g. "toString", "constructor", "__proto__") resolved Object.prototype's
 * own value instead of `undefined`, defeating the `|| 'no-response'` guard
 * here and at run-debate.js's addendumOutcomes. JSON.stringify drops function
 * values, so toString/constructor SILENTLY DELETE `debate.action` from the
 * serialized document; __proto__ resolves to Object.prototype itself, which
 * stringifies as `{}` — wrong either way, and both close identically to an
 * ordinary unknown action ("bogus") once the table carries `__proto__: null`.
 *
 * ⚠️ CORRECTED at fix round 2 (task-3-report.md) — the sentence this replaced
 * claimed a real paid run could hit this with no hand-assembled document.
 * MEASURED FALSE: `parseDebateDefense` (src/council/parse-stage2.js:142-153)
 * is an ALLOWLIST. Only 'defend'/'amend'/'withdraw' (each gated on its own
 * required field) ever overwrite a per-id default of `{action:'no-response'}`;
 * every other action a model could emit, inherited-key or ordinary junk
 * alike, is ALREADY the literal 'no-response' before `debateFindings` (and
 * therefore `d.action`) exists. Traced and verified: `debateFindings` has
 * exactly ONE producer (`debate.js :: applyDebate`), which has ONE caller in
 * src/ (`run-debate.js:203`); `decorateRecord` has ONE caller
 * (`run-finish.js:50`, fed by `run.js`'s own `runDebate` result). No MCP or
 * CLI entry hands either function a hand-assembled document. So this table's
 * null prototype is DEFENSE-IN-DEPTH here, not a fix for a reachable defect —
 * what actually protects today's document is `parseDebateDefense`'s
 * allowlist. See run-debate.test.js's "a defense action a model cannot make
 * PAST_TENSE-inherited" describe block (its ACTIONPASSTHRU named mutant pins
 * the allowlist itself, since PROTOACTION cannot reach this path).
 */
describe('decorateRecord — PAST_TENSE is prototype-safe against an inherited action', () => {
  test('D1 — action "toString" maps to "no-response", and the key survives JSON.stringify', () => {
    const record = { findings: [{ id: 'A1', tier: 'Confirmed' }] };
    decorateRecord(record, [{ id: 'A1', action: 'toString', previousTier: 'Contested' }]);
    // ⚠️ THE SINGLE MOST IMPORTANT PIN IN THIS TASK. toEqual() alone can miss
    // this: a MISSING key and an `undefined` value compare equal under
    // toEqual, but the BASE failure was the key vanishing from the
    // serialized document (JSON.stringify drops a function value outright).
    // Assert the type explicitly, then round-trip for real.
    expect(typeof record.findings[0].debate.action).toBe('string');
    expect(record.findings[0].debate.action).toBe('no-response');
    const onDisk = JSON.parse(JSON.stringify(record));
    expect(onDisk.findings[0].debate).toHaveProperty('action');
    expect(onDisk.findings[0].debate.action).toBe('no-response');
  });

  test.each([['__proto__'], ['constructor']])(
    'D2 — action %j also maps to "no-response", and the key survives JSON.stringify',
    (action) => {
      const record = { findings: [{ id: 'A1', tier: 'Confirmed' }] };
      decorateRecord(record, [{ id: 'A1', action, previousTier: 'Contested' }]);
      expect(typeof record.findings[0].debate.action).toBe('string');
      expect(record.findings[0].debate.action).toBe('no-response');
      const onDisk = JSON.parse(JSON.stringify(record));
      expect(onDisk.findings[0].debate).toHaveProperty('action');
      expect(onDisk.findings[0].debate.action).toBe('no-response');
    },
  );

  test('D3 — the four real actions still map to defended / amended / withdrawn / no-response', () => {
    const record = { findings: ['A1', 'A2', 'A3', 'A4'].map(id => ({ id, tier: 'Confirmed' })) };
    const debateFindings = [
      { id: 'A1', action: 'defend', previousTier: 'Contested' },
      { id: 'A2', action: 'amend', previousTier: 'Contested' },
      { id: 'A3', action: 'withdraw', previousTier: 'Contested' },
      { id: 'A4', action: 'no-response', previousTier: 'Contested' },
    ];
    decorateRecord(record, debateFindings);
    expect(record.findings.map(f => f.debate.action)).toEqual(['defended', 'amended', 'withdrawn', 'no-response']);
  });
});

// Named mutant "PROTOACTION": revert PAST_TENSE's literal to drop its null
// prototype (v4.8 Phase 6 PR1 Task 3, SI-24) — the debate.js half of this
// task. Mirrors Task 1's PROTOVERDICT (tests/council/tally.test.js) and Task
// 2's PROTORANK (tests/council/street-cred-mutants.js); this one's own
// sibling is PROTOSYMBOL, in tests/council/seat-matrix.test.js.
//   const PAST_TENSE = { __proto__: null, defend: 'defended', amend: 'amended',
//     withdraw: 'withdrawn', 'no-response': 'no-response' };
//   -> const PAST_TENSE = { defend: 'defended', amend: 'amended',
//     withdraw: 'withdrawn', 'no-response': 'no-response' };
//
// Introduced at this task. RED: 3 tests / 1 suite (command `npx jest
// --no-coverage`, the FULL suite, per this task's brief).
//   tests/council/debate.test.js — "D1 — action 'toString' maps to
//     'no-response', and the key survives JSON.stringify" · "D2 — action
//     '__proto__' also maps to 'no-response', and the key survives
//     JSON.stringify" · "D2 — action 'constructor' also maps to
//     'no-response', and the key survives JSON.stringify"
//
// ⚠️ WHY NOT 4: D3 (the four real actions) does NOT red. defend/amend/
// withdraw/no-response are OWN properties on PAST_TENSE either way, so a pin
// built entirely from real actions cannot see a mutation that only changes
// what happens to a key PAST_TENSE never owned.
//
// Measured with the concurrency guard this task was briefed on (a second
// agent was mutating src/council/street-cred.js in this same checkout):
// `git status --porcelain -- src/ tests/` immediately before AND after this
// run showed ONLY src/council/debate.js (this mutation) modified — no
// contamination. Full-suite denominator at this measurement: 544 suites (543
// passed / 1 failed), 7844 tests (7833 passed / 3 failed / 8 skipped), 4
// snapshots passed and UNCHANGED — identical denominator to PROTOSYMBOL's
// run, measured separately. Hand-revert byte-verified against `git show
// HEAD:src/council/debate.js`, sha256 match.
//
// NO PIN THAT PRE-DATES THIS TASK REDS.
//
// ⚠️ RE-RUN at fix round 1 (SI-24 review): PAST_TENSE has a SECOND consumer,
// run-debate.js:262's `PAST_TENSE[df.action] || PAST_TENSE['no-response']`
// inside runDebate's addendumOutcomes, which the three tests above never
// reach (they call decorateRecord directly). Added
// tests/council/run-debate.test.js coverage driving a REAL defense response
// through the actual runDebate -> parseDebateDefense -> applyDebate path with
// an inherited action ('toString', '__proto__') — see that file's "a defense
// action a model cannot make PAST_TENSE-inherited" describe block.
//
// RE-RUN command `npx jest --no-coverage` (the FULL suite, with the new
// run-debate.test.js pins in place): RED remains 3 tests / 1 suite —
// UNCHANGED. The new tests do NOT enter the set. THIS IS NOT AN EMPTY-SET
// FAILURE TO CHASE; it is a chased and CONFIRMED non-reachability: measured
// directly (a scratch script calling the real parseDebateDefense, then the
// full runDebate pipeline under this exact mutation, both before recording),
// parseDebateDefense (src/council/parse-stage2.js:142-153) is an ALLOWLIST —
// only 'defend'/'amend'/'withdraw' ever overwrite a per-id default of
// `{action: 'no-response'}`. Every other action string a model could emit,
// inherited-key or ordinary junk alike, is ALREADY the literal 'no-response'
// before `debateFindings` (and therefore `df.action`) exists — regardless of
// PROTOACTION. `PAST_TENSE[df.action]` at run-debate.js:262 is an own-key hit
// on every input the real pipeline can deliver, mutated or not. Denominator
// at this re-run: 544 suites (543/1), 7847 tests (7836 passed / 3 failed / 8
// skipped — +3 over the prior 7844, exactly the three new tests, all
// passing), 4 snapshots passed and unchanged. Same guard, same hand-revert
// discipline, confirmed clean.
//
// This narrows, rather than fills, the WHY-NOT-4 note above: run-debate.js's
// addendumOutcomes is real, exported-table-consuming code, and the new tests
// are a legitimate regression pin on it — but the property they prove is
// "parseDebateDefense's allowlist protects this call site", not "PAST_TENSE's
// null prototype protects this call site". Full chase in task-3-report.md.
//
// FIX ROUND 2: why PROTOACTION stays at 3/1 rather than growing. The two
// run-debate.test.js tests cannot red under PROTOACTION alone (measured) --
// with the allowlist intact, no action ever reaches this table as an
// inherited key, mutated or not. They also cannot red under ACTIONPASSTHRU
// alone (run-debate.test.js's own record) for the mirror reason: with THIS
// table's null prototype intact, a passed-through inherited action resolves
// to a safe `undefined` here regardless. Only the COMPOUND mutant
// "DOUBLEBREACH" (run-debate.test.js, both mutations applied together)
// covers them -- measured RED 6/3, listed there. PROTOACTION's own record is
// therefore complete and correct as originally measured; it is not the
// mutant those two tests need.

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
    // One per distinct (model, resolvedModel) pair (v4.8 PR4b). This bench's
    // three aliases are unique and none carries a resolvedModel, so that is
    // also one per meta.models entry — and debate legs still add none.
    expect(rows).toHaveLength(3);
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

// v4.8 PR4c Task 3 (plan §3.3, R4c-4) — what was then the SECOND alias-space
// peer filter. ⚠️ Heading and history corrected in v4.8 Phase 2 T-B2: there is
// no second filter any more, so nothing here is a claim about today's code.
//
// PR4c gave `debate.js`'s own copy of the filter the same seat/alias guard as
// `tally.js`'s `peers`. T-B2 deleted the copy outright: `peerVerdicts` now CALLS
// peer-split.js :: peersOf — the one predicate `tally.js` also calls — so it has
// no guard of its own to keep in step, and the hazard that sentence was written
// about (fixing one site and not the other) is closed by construction rather
// than by two spellings maintained by hand. That move landed in T-B2's commit,
// not PR4c's. debate.js :: applyDebate and debate.js :: disputingJudges were
// already seat-space, so this was the last hand-rolled peer filter in the file.
//
// T4a/T4b below still pin the SEAT-vs-ALIAS behaviour, now through the shared
// function; the T5 and T6 blocks at the end of this file pin what T-B2 changed.
//
// ⚠️ The trailing `.map(a => a.verdict)` is load-bearing: briefings-debate.js's
// `verdictCounts` indexes its counter BY THE ELEMENT, so a list of adjudication
// OBJECTS renders "0 dispute, 0 agree, 0 neutral" — byte-identical to the
// no-data case, i.e. a paid defense brief telling the model nobody disputed it.
// `run-debate.test.js`'s "the defense brief carries the REAL peer split" is the
// end-to-end guard; the `toEqual` on VERDICT STRINGS below is the unit one.
describe('debateTargets — peerVerdicts takes the guarded filter (v4.8 PR4c §3.3, T4)', () => {
  const meta = { runId: 'r', models: ['deepseek', 'deepseek', 'gpt'], chair: 'gemini',
    claudeInCouncil: false };

  test('T4a: symmetric twin seats ⇒ the twin\'s dispute IS a peer verdict', () => {
    const input = {
      meta,
      findings: [{ id: 'A1', raiser: 'deepseek', raiserSeat: 'deepseek#1', severity: 'major',
        claim: 'infinite retry' }],
      adjudications: [
        { findingId: 'A1', judge: 'deepseek', verdict: 'dispute', seat: 'deepseek#2' },
        { findingId: 'A1', judge: 'gpt', verdict: 'dispute', seat: 'gpt' },
      ],
      rankings: [], runStats: [],
    };
    const { byRaiser } = debateTargets(tally(input), input);
    // HEAD drops the twin by alias and briefs "1 dispute" against a tally of two.
    expect(byRaiser['deepseek#1'][0].peerVerdicts).toEqual(['dispute', 'dispute']);
  });

  test('T4b: direction A — the twin vote carries NO seat ⇒ still excluded', () => {
    const input = {
      meta,
      findings: [{ id: 'A1', raiser: 'deepseek', raiserSeat: 'deepseek#1', severity: 'major',
        claim: 'infinite retry' }],
      adjudications: [
        { findingId: 'A1', judge: 'deepseek', verdict: 'agree' },   // Stage-2 seat orphaned
        { findingId: 'A1', judge: 'gpt', verdict: 'dispute', seat: 'gpt' },
      ],
      rankings: [], runStats: [],
    };
    const { byRaiser } = debateTargets(tally(input), input);
    // NAIVE (`a.seat !== f.raiserSeat`) would brief the raiser's own alias back
    // to it as a corroborating peer.
    expect(byRaiser['deepseek#1'][0].peerVerdicts).toEqual(['dispute']);
  });
});
// v4.8 Phase 2 T-B2 (T5) — `debateTargets` CALLS peer-split.js :: peersOf.
//
// Until this commit `peerVerdicts` spelled its own copy of the filter with TWO
// branches, while `peersOf` has THREE: its outer `f.raiser ? … : …` arm was
// missing here — and at T-B2 that arm was a bare `: votes`, which is what T-B4
// later changed. On any finding whose raiser is falsy the two documents
// therefore computed DIFFERENT peer splits — the tally counted those votes, the
// defense brief did not. Both shapes are engine-reachable, not hypothetical:
// `''` arrives through the MCP path (mcp-tools.js's raiser/judge are required
// z.string(), which accepts the empty string) and `undefined` through the CLI
// path (cli-handlers-council.js is a raw JSON.parse with no schema).
//
// Each test below asserts the peer split the TALLY computes and the split the
// BRIEF renders, on one fixture, so "the two documents must agree" is an
// assertion pair rather than prose. Every "measured at 8e97faaf" number in the
// comments below was read off a run of that tree, not reasoned out.
//
// ⚠️ v4.8 T-B4 moved every VALUE in this block and left the property standing.
// Making the two documents agree exposed what they were agreeing ON: a falsy
// raiser was counting its own vote (council C1). T-B4 drops the votes that
// cannot be attributed and announces them, so the agreed peer split is smaller
// here — and on two fixtures the finding no longer reaches a defense brief at
// all. Each test states which of those two things it now measures. Nothing in
// this block was re-valued by arithmetic; the numbers come from running it.
describe('debateTargets — the two documents must agree on the peer split (v4.8 T-B2, T5)', () => {
  const meta = { runId: 'r', runType: 'headless', date: 'd',
    models: ['deepseek', 'gpt'], chair: 'gemini', claudeInCouncil: false };
  const base = { meta, rankings: [], runStats: [] };

  test('T5a: an EMPTY-STRING raiser (MCP path) — the tally counts its 1 real peer, so the brief must brief 1', () => {
    // Measured at 8e97faaf: tally basis {a:0,d:2,n:0} ⇒ Disputed, but
    // peerVerdicts was ['dispute'] — the brief dropped the '' judge on
    // `'' !== ''`, a compare the tally never reached. T-B2 made both count 2.
    // ⚠️ v4.8 T-B4 moved the VALUE, not the property: counting the '' judge was
    // the raiser corroborating itself (council C1), so it is now dropped and
    // announced, and BOTH documents say 1. Every number below re-measured.
    const input = { ...base,
      findings: [{ id: 'A1', raiser: '', severity: 'major', claim: 'infinite retry' }],
      adjudications: [{ findingId: 'A1', judge: '', verdict: 'dispute' },
        { findingId: 'A1', judge: 'gpt', verdict: 'dispute' }] };
    const record = tally(input);
    expect(record.findings[0].basis).toEqual({ a: 0, d: 1, n: 0 });
    expect(record.findings[0].tier).toBe('Contested');       // T-B2 read Disputed
    expect(record.findings[0].unattributedPeerDrops).toBe(1);
    const { byRaiser } = debateTargets(record, input);
    // `f.raiserSeat || f.raiser` is '' here, so '' is the literal bucket key.
    expect(byRaiser[''][0].peerVerdicts).toEqual(['dispute']);
    expect(byRaiser[''][0].unattributedPeerDrops).toBe(1);
  });

  test('T5b: an UNDEFINED raiser (CLI path) — the tally counts its 1 real peer, so the brief must brief 1', () => {
    // Measured at 8e97faaf: tally basis {a:1,d:1,n:0} ⇒ Contested, but
    // peerVerdicts was ['agree'] — `undefined !== undefined` is false.
    //
    // ⚠️ The `gpt` vote moved from `agree` to `dispute` at v4.8 T-B4, and the
    // reason is measured, not stylistic. With T-B4 dropping the unattributable
    // `undefined` judge, the old fixture leaves exactly one AGREE peer ⇒
    // basis {a:1,d:0} ⇒ **Confirmed** — and `debateTargets` skips every finding
    // that is not Contested or Disputed, so there would be no `byRaiser` bucket
    // to compare against and this test would stop pinning agreement at all
    // (that mechanism is T5d's subject, executed there). Making the surviving
    // peer DISPUTE keeps the finding in the brief and keeps the two documents
    // comparable on the CLI path, which is the property this test exists for.
    const input = { ...base,
      findings: [{ id: 'A1', severity: 'major', claim: 'infinite retry' }],
      adjudications: [{ findingId: 'A1', verdict: 'dispute' },
        { findingId: 'A1', judge: 'gpt', verdict: 'dispute' }] };
    const record = tally(input);
    expect(record.findings[0].basis).toEqual({ a: 0, d: 1, n: 0 });
    expect(record.findings[0].unattributedPeerDrops).toBe(1);
    const { byRaiser } = debateTargets(record, input);
    // `f.raiserSeat || f.raiser` is `undefined`, which becomes the string key
    // 'undefined' on the plain object — measured, not assumed.
    expect(byRaiser.undefined[0].peerVerdicts).toEqual(['dispute']);
    expect(byRaiser.undefined[0].unattributedPeerDrops).toBe(1);
  });

  test('T5c: every vote from an empty-string judge — nothing is attributable, so the tally is Singleton and the brief renders no row at all', () => {
    // The sharpest case, and it moved twice. Measured at 8e97faaf the tally
    // scored this Disputed on two disputes while peerVerdicts was [] — so
    // briefings-debate.js's verdictCounts rendered "0 dispute, 0 agree, 0
    // neutral", byte-identical to the no-data case: a paid defense brief
    // telling the model nobody disputed it. T-B2 made the brief carry both
    // disputes, matching the tally.
    //
    // ⚠️ v4.8 T-B4 says neither document should have carried them. Both votes
    // come from an empty-string judge beside an empty-string raiser, so NEITHER
    // is attributable to anyone but the raiser: `basis` empties, the tier falls
    // **Disputed → Singleton**, the drop count is 2, and a Singleton never
    // reaches a defense brief — so `byRaiser` is empty rather than rendering
    // zeros. That is the same visible absence as the base defect and the
    // opposite of it in kind: at base the brief silently contradicted a
    // Disputed tally, and now both documents agree there is no peer signal and
    // the tally says out loud that two votes were discarded.
    const input = { ...base,
      findings: [{ id: 'A1', raiser: '', severity: 'major', claim: 'infinite retry' }],
      adjudications: [{ findingId: 'A1', judge: '', verdict: 'dispute' },
        { findingId: 'A1', judge: '', verdict: 'dispute' }] };
    const record = tally(input);
    expect(record.findings[0].tier).toBe('Singleton');
    expect(record.findings[0].basis).toEqual({ a: 0, d: 0, n: 0 });
    expect(record.findings[0].unattributedPeerDrops).toBe(2);
    expect(Object.keys(debateTargets(record, input).byRaiser)).toEqual([]);
  });

  // Measured evidence for a correction, not a behaviour pin. T-B2's brief
  // named an all-AGREE variant of T5c as its sharpest case — "the tally reads
  // Confirmed while the defense brief renders the all-zero case". That cannot
  // happen: `debateTargets` skips every finding that is not Contested or
  // Disputed, so a Confirmed finding never reaches a defense brief at all and
  // there is no row to disagree with. This test EXECUTES that reason instead
  // of restating it, and is why T5c uses `dispute` rather than `agree`.
  //
  // ⚠️ The FIXTURE moved at v4.8 T-B4 and the reason had to move with it. It
  // used to be two `''` votes, both agreeing, which T-B2 scored Confirmed. T-B4
  // drops both as unattributable, so that shape now scores **Singleton** — it
  // would have stopped exercising the Confirmed skip entirely. The fixture
  // below is council C1's own: the `''` vote is dropped, the `gpt` peer's agree
  // stands alone at `{a:1,d:0}`, and `assignTier` still calls that Confirmed.
  test('T5d: a Confirmed finding gets NO bucket at all, so it can never render an all-zero brief', () => {
    const input = { ...base,
      findings: [{ id: 'A1', raiser: '', severity: 'major', claim: 'infinite retry' }],
      adjudications: [{ findingId: 'A1', judge: '', verdict: 'agree' },
        { findingId: 'A1', judge: 'gpt', verdict: 'agree' }] };
    const record = tally(input);
    expect(record.findings[0].tier).toBe('Confirmed');
    expect(record.findings[0].basis).toEqual({ a: 1, d: 0, n: 0 });
    expect(Object.keys(debateTargets(record, input).byRaiser)).toEqual([]);
  });

  // The two controls. Both already agreed at 8e97faaf (1 and 2 respectively);
  // they are here so a future edit that "fixes" the falsy-raiser cases by
  // moving the ordinary ones goes red instead of silently trading one for the
  // other.
  test('T5e CONTROL: a real raiser on a unique-alias bench still briefs exactly its 1 peer', () => {
    const input = { ...base,
      findings: [{ id: 'A1', raiser: 'gemini', severity: 'major', claim: 'infinite retry' }],
      adjudications: [{ findingId: 'A1', judge: 'gemini', verdict: 'dispute' },
        { findingId: 'A1', judge: 'gpt', verdict: 'dispute' }] };
    const { byRaiser } = debateTargets(tally(input), input);
    expect(byRaiser.gemini[0].peerVerdicts).toEqual(['dispute']);
  });

  test('T5f CONTROL: a twin bench with seats on BOTH sides still briefs exactly its 2 peers', () => {
    const input = { ...base,
      meta: { ...meta, models: ['deepseek', 'deepseek', 'gpt'] },
      findings: [{ id: 'A1', raiser: 'deepseek', raiserSeat: 'deepseek#1',
        severity: 'major', claim: 'infinite retry' }],
      adjudications: [
        { findingId: 'A1', judge: 'deepseek', verdict: 'dispute', seat: 'deepseek#1' },
        { findingId: 'A1', judge: 'deepseek', verdict: 'dispute', seat: 'deepseek#2' },
        { findingId: 'A1', judge: 'gpt', verdict: 'dispute', seat: 'gpt' }] };
    const { byRaiser } = debateTargets(tally(input), input);
    expect(byRaiser['deepseek#1'][0].peerVerdicts).toEqual(['dispute', 'dispute']);
  });
});

// v4.8 Phase 2 T-B2 (T6) — the `unattributedPeerDrops` mark on the BRIEF side.
// Same function, same number and same emit rule as tally.js's: present only
// when > 0, so any run that does not orphan exactly one side of a twin pair
// produces a byte-identical byRaiser row.
describe('debateTargets — the unattributable-drop mark rides beside peerVerdicts (v4.8 T-B2, T6)', () => {
  const meta = { runId: 'r', runType: 'headless', date: 'd',
    models: ['deepseek', 'deepseek', 'gpt'], chair: 'gemini', claudeInCouncil: false };
  const base = { meta, rankings: [], runStats: [] };

  test('T6a: one orphaned twin leg ⇒ the row carries unattributedPeerDrops: 1, and the tally row carries the SAME 1', () => {
    const input = { ...base,
      findings: [{ id: 'A1', raiser: 'deepseek', raiserSeat: 'deepseek#1',
        severity: 'major', claim: 'infinite retry' }],
      adjudications: [
        { findingId: 'A1', judge: 'deepseek', verdict: 'agree' },        // Stage-2 seat orphaned
        { findingId: 'A1', judge: 'gpt', verdict: 'dispute', seat: 'gpt' }] };
    const record = tally(input);
    const row = debateTargets(record, input).byRaiser['deepseek#1'][0];
    expect(row.peerVerdicts).toEqual(['dispute']);
    expect(row.unattributedPeerDrops).toBe(1);
    // Both documents call peer-split.js :: unattributedPeerDrops, so the two
    // marks cannot drift apart. Asserted, not assumed.
    expect(record.findings[0].unattributedPeerDrops).toBe(1);
  });

  test('T6b: symmetric twin seats ⇒ the key is ABSENT from the row, not present-and-zero', () => {
    const input = { ...base,
      findings: [{ id: 'A1', raiser: 'deepseek', raiserSeat: 'deepseek#1',
        severity: 'major', claim: 'infinite retry' }],
      adjudications: [
        { findingId: 'A1', judge: 'deepseek', verdict: 'dispute', seat: 'deepseek#2' },
        { findingId: 'A1', judge: 'gpt', verdict: 'dispute', seat: 'gpt' }] };
    const row = debateTargets(tally(input), input).byRaiser['deepseek#1'][0];
    expect(row.peerVerdicts).toEqual(['dispute', 'dispute']);
    expect('unattributedPeerDrops' in row).toBe(false);
  });

  test('T6c: an ordinary unique-alias bench ⇒ the key is ABSENT from the row', () => {
    const input = { ...base,
      meta: { ...meta, models: ['gemini', 'gpt'] },
      findings: [{ id: 'A1', raiser: 'gemini', severity: 'major', claim: 'infinite retry' }],
      adjudications: [{ findingId: 'A1', judge: 'gpt', verdict: 'dispute' }] };
    const row = debateTargets(tally(input), input).byRaiser.gemini[0];
    expect(row.peerVerdicts).toEqual(['dispute']);
    expect('unattributedPeerDrops' in row).toBe(false);
  });
});
