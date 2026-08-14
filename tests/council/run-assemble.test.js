// tests/council/run-assemble.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const asm = require('../../src/council/run-assemble');
const { tally } = require('../../src/council/tally');
const { buildSeats } = require('../../src/council/seats');
const { mkLeg } = require('./helpers/fake-launchers');

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'council-asm-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const leg = (model, cost = 0.02) => ({
  taskId: `${model}-1`, model, modelInput: model, status: 'complete', summary: 's',
  durationMs: 4200, usage: { cost: { amount: cost, source: 'reported' } },
});

const REVIEWS = [
  { model: 'gemini', role: 'seat', conformance: 'clean', leg: leg('gemini'),
    globalFindings: [{ id: 'A1', raiser: 'gemini', severity: 'major', claim: 'c1' }] },
  { model: 'gpt', role: 'seat', conformance: 'repaired', leg: leg('gpt'),
    globalFindings: [{ id: 'B1', raiser: 'gpt', severity: 'nit', claim: 'c2' }] },
  { model: 'qwen', role: 'critic', conformance: 'clean', leg: leg('qwen'),
    globalFindings: [] },
];
const JUDGES = [
  { judge: 'gemini', ok: true, order: ['gpt', 'gemini', 'qwen'],
    adjudications: [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'neutral' }] },
  { judge: 'gpt', ok: true, order: ['gpt', 'qwen', 'gemini'],
    adjudications: [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'agree' }] },
  { judge: 'qwen', ok: false, order: null, adjudications: null },
];

describe('buildTallyInput — five keys + meta pins (spec §5)', () => {
  // ⚠️ v4.8 PR4c §3.2: this fixture PASSES a real `seats` array on purpose. The
  // engine always does (run.js:133 sets o.seats unconditionally past the
  // preflight, and buildSeats always returns an array), so a fixture that omits
  // it exercises a state that never occurs — and measured, both the meta pin
  // below and T8 are GREEN against the vacuous `...(seats ? …)` guard when
  // `seats` is left undefined. Supplying it is what turns them into pins.
  const input = asm.buildTallyInput({
    runId: 'abc123', date: '2026-07-19', bench: ['gemini', 'gpt', 'qwen'],
    chair: 'deepseek', reviews: REVIEWS, judgeResults: JUDGES,
    chairStats: asm.buildRunStatsEntry({ leg: leg('deepseek', 0.03), role: 'chair', wasChair: true, conformance: 'clean' }),
    seats: buildSeats(['gemini', 'gpt', 'qwen'], null, null),
  });

  test('meta is pinned: headless, claudeInCouncil false, models = bench exactly', () => {
    expect(input.meta).toEqual({
      runId: 'abc123', date: '2026-07-19', runType: 'headless',
      models: ['gemini', 'gpt', 'qwen'],       // critic included, chair excluded
      chair: 'deepseek', claudeInCouncil: false,
    });
  });

  test('all five keys are present', () => {
    for (const k of ['meta', 'findings', 'adjudications', 'rankings', 'runStats']) {
      expect(input).toHaveProperty(k);
    }
  });

  test('adjudications carry the judge field and INCLUDE raiser self-votes (no pre-filter)', () => {
    expect(input.adjudications).toContainEqual({ findingId: 'A1', judge: 'gemini', verdict: 'agree' });
    // gemini is A1's raiser — its vote must still be in the input (tally excludes it itself).
  });

  test('only ok judges contribute rankings; dropped judge absent', () => {
    expect(input.rankings.map(r => r.judge).sort()).toEqual(['gemini', 'gpt']);
  });

  test('runStats: one row per seat + the chair row; verbatim durations/usage', () => {
    // #83 (v4.6 Plan 2): 3 seat/critic rows + 3 judge rows (JUDGES has one entry
    // per bench model) + 1 chair row.
    expect(input.runStats).toHaveLength(7);
    const chairRow = input.runStats.find(r => r.wasChair);
    expect(chairRow).toMatchObject({ model: 'deepseek', role: 'chair', durationMs: 4200 });
    const gpt = input.runStats.find(r => r.model === 'gpt');
    expect(gpt.conformance).toBe('repaired');
  });

  test('the input feeds tally() without throwing (five-keys contract)', () => {
    const record = tally(input);
    expect(record.tierCounts.Confirmed).toBe(1);   // A1: gpt agrees (peer), gemini self-vote excluded
  });

  // T8 (v4.8 PR4c §3.2) — no seat id in this document needs a table to resolve
  // it: buildSeats mints `alias#N` only when an alias repeats, so every id here
  // IS its alias and meta.models already carries them.
  // Named mutants, both measured RED: (a) a bare `seats,` in the meta literal,
  // (b) `...(seats ? { seats: seats.slice() } : {})` — the vacuous guard, which
  // is what makes the `seats:` line in the fixture above load-bearing.
  test('v4.8 PR4c T8: meta carries NO seats table on a unique-alias bench', () => {
    expect('seats' in input.meta).toBe(false);
  });
});

// T8b (v4.8 PR4c R4c-7) — the guard is NARROW BY OWNER RULING. It asks "does the
// bench repeat an alias?", NOT "does seats[] carry anything unrecoverable?" —
// and on a --lenses or --critic bench with unique aliases those two questions
// disagree: `position` is unrecoverable on every bench, and the raw lens text
// survives nowhere in the tally input (runStats[].role carries only the slug).
// R4c-7 chose byte-identity on those benches over a table PR5 can request when
// it needs one, and filed the gap to BACKLOG. Without this test the ruling and
// its revert are indistinguishable — the T14c lesson from Task 1.
// Named mutant, measured RED: the WIDENED predicate R4c-7 rejected,
//   seats.some(s => s.id !== s.alias || s.role !== 'seat' || s.lens !== null)
test('v4.8 PR4c T8b/R4c-7: lens and critic benches with unique aliases emit NO seats table', () => {
  const mk = (bench, critic, lenses) => asm.buildTallyInput({
    runId: 'r', date: 'd', bench, chair: 'x', reviews: [], judgeResults: [],
    chairStats: null, seats: buildSeats(bench, critic, lenses),
  });
  // Both widened conjuncts are genuinely PRESENT in these fixtures, so the
  // mutant really can fire — a fixture that cannot trigger it is a pin that
  // passes for the wrong reason (§8 item 7).
  expect(buildSeats(['alpha', 'beta'], null, ['Security Review', 'perf']).map(s => s.role))
    .toEqual(['lens:security-review', 'lens:perf']);
  expect(buildSeats(['alpha', 'beta'], 'beta', null).map(s => s.role)).toEqual(['seat', 'critic']);
  const lensed = mk(['alpha', 'beta'], null, ['Security Review', 'perf']);
  expect('seats' in lensed.meta).toBe(false);
  expect('seats' in mk(['alpha', 'beta'], 'beta', null).meta).toBe(false);
  // …and this is the cost R4c-7 accepted, stated rather than assumed:
  expect(JSON.stringify(lensed)).not.toContain('Security Review');
});

// T9 (v4.8 PR4c §3.2) — a twin bench mints `deepseek#1`/`deepseek#2`, ids that
// join to nothing else in the document (meta.models is the ALIAS list), so the
// table ships. RED at HEAD, which emits a six-key meta on every bench.
test('v4.8 PR4c T9: a twin bench emits meta.seats, equal to buildSeats output', () => {
  const bench = ['deepseek', 'deepseek', 'gpt'];
  const seats = buildSeats(bench, null, null);
  const input = asm.buildTallyInput({
    runId: 'r', date: 'd', bench, chair: 'x', reviews: [], judgeResults: [],
    chairStats: null, seats,
  });
  expect(input.meta.seats).toEqual(seats);
  expect(input.meta.seats.map(s => s.id)).toEqual(['deepseek#1', 'deepseek#2', 'gpt']);
  // ⚠️ seats[] is BENCH-ONLY and meta.models is not — never join them
  // positionally. `claude` joins meta.models synthetically
  // (run-assemble.js:226) and buildSeats never mints a seat for it (seats.js:44-46).
  expect(input.meta.models).toEqual(bench);
});

// T9b — placement. §3.2 requires a pure TAIL so the shipped six-key order is
// byte-identical in every case; T9 asserts only the value.
test('v4.8 PR4c T9b: meta.seats is a pure tail; the six-key order is untouched', () => {
  const SIX = ['runId', 'date', 'runType', 'models', 'chair', 'claudeInCouncil'];
  const mk = (bench) => asm.buildTallyInput({
    runId: 'r', date: 'd', bench, chair: 'x', reviews: [], judgeResults: [],
    chairStats: null, seats: buildSeats(bench, null, null),
  });
  expect(Object.keys(mk(['deepseek', 'deepseek']).meta)).toEqual([...SIX, 'seats']);
  expect(Object.keys(mk(['deepseek', 'gpt']).meta)).toEqual(SIX);
});

// v4.8 PR3 Task 5: buildTallyInput's adjudications carry `seat` alongside the
// unchanged alias-valued `judge` — emit-when-DIFFERENT (§3.3), mirroring Task
// 4's judgeResults[].seat guard. `judge: j.judge` stays the alias; rankings
// (street-cred) are untouched.
describe('buildTallyInput adjudications seat (v4.8 PR3 Task 5, emit-when-different)', () => {
  const judgesWithSeat = (seat) => [
    { judge: 'gemini', ok: true, order: ['gemini'], seat,
      adjudications: [{ id: 'A1', verdict: 'agree' }] },
  ];

  test('a seat id differing from the judge alias (twin bench) is emitted onto adjudications', () => {
    const input = asm.buildTallyInput({
      runId: 'r', date: 'd', bench: ['gemini', 'gemini'], chair: 'x',
      reviews: REVIEWS, judgeResults: judgesWithSeat({ id: 'gemini#2', alias: 'gemini' }),
      chairStats: null,
    });
    expect(input.adjudications[0]).toEqual({ findingId: 'A1', judge: 'gemini', verdict: 'agree', seat: 'gemini#2' });
  });

  test('a seat id byte-equal to the judge alias (unique-alias bench) emits NO seat key', () => {
    const input = asm.buildTallyInput({
      runId: 'r', date: 'd', bench: ['gemini'], chair: 'x',
      reviews: REVIEWS, judgeResults: judgesWithSeat({ id: 'gemini', alias: 'gemini' }),
      chairStats: null,
    });
    expect(input.adjudications[0]).toEqual({ findingId: 'A1', judge: 'gemini', verdict: 'agree' });
    expect('seat' in input.adjudications[0]).toBe(false);
  });

  test('a judge with no seat (null) emits NO seat key', () => {
    const input = asm.buildTallyInput({
      runId: 'r', date: 'd', bench: ['gemini'], chair: 'x',
      reviews: REVIEWS, judgeResults: judgesWithSeat(null),
      chairStats: null,
    });
    expect('seat' in input.adjudications[0]).toBe(false);
  });

  test('rankings (street-cred) stay alias-valued — unchanged by seat', () => {
    const input = asm.buildTallyInput({
      runId: 'r', date: 'd', bench: ['gemini', 'gemini'], chair: 'x',
      reviews: REVIEWS, judgeResults: judgesWithSeat({ id: 'gemini#2', alias: 'gemini' }),
      chairStats: null,
    });
    expect(input.rankings).toEqual([{ judge: 'gemini', order: ['gemini'] }]);
  });
});

// ---- v4.8 PR4c Task 1 (plan §3.1): runStats rows name their SEAT ----
// buildRunStatsEntry takes the seat OBJECT and compares the seat id to the
// seat's OWN alias, never to the caller's `model`. buildSeats mints `alias#N`
// only when an alias repeats (seats.js:67), so `id !== alias` IS "the bench
// repeats this alias" — the identical predicate every other seat-emit producer
// uses after R4c-9. `model` is the LEG's modelInput, which is NOT the alias
// when a leg reports none or when a --council preset carries a padded member;
// T12b pins both of those, and the seat OBJECT (not an id string) is what makes
// the contract structural instead of prose.
describe('v4.8 PR4c: runStats[].seat on the primary review rows (§3.1, T12)', () => {
  const seats = buildSeats(['deepseek', 'deepseek', 'gpt'], null, null);
  const twinReviews = seats.map(s => ({
    model: s.alias, role: s.role, conformance: 'clean', seat: s, globalFindings: [],
    leg: { ...leg(s.alias), waveId: 'r-s1' },
  }));
  const twinInput = () => asm.buildTallyInput({
    runId: 'r', date: 'd', bench: ['deepseek', 'deepseek', 'gpt'], chair: 'x',
    reviews: twinReviews, judgeResults: [], chairStats: null,
  });

  test('each twin review row carries ITS OWN seat id; the unique-alias row carries none', () => {
    const rows = twinInput().runStats;
    expect(rows.map(r => r.model)).toEqual(['deepseek', 'deepseek', 'gpt']);   // §4.7: model stays the ALIAS
    expect(rows[0].seat).toBe('deepseek#1');
    expect(rows[1].seat).toBe('deepseek#2');
    expect('seat' in rows[2]).toBe(false);        // gpt's seat id IS its alias
  });

  test('the seat rides in the resolvedModel slot — before status, after resolvedModel', () => {
    expect(Object.keys(twinInput().runStats[0])).toEqual(
      ['model', 'role', 'wasChair', 'conformance', 'waveId', 'resolvedModel', 'seat',
        'status', 'durationMs', 'usage']);
  });

  test('a review with NO seat (orphaned Stage-1 leg) emits no seat key', () => {
    const input = asm.buildTallyInput({
      runId: 'r', date: 'd', bench: ['deepseek', 'deepseek'], chair: 'x',
      reviews: [{ model: 'deepseek', role: 'seat', conformance: 'clean', leg: leg('deepseek'),
        seat: null, globalFindings: [] }],
      judgeResults: [], chairStats: null,
    });
    expect('seat' in input.runStats[0]).toBe(false);
  });
});

// T12b — the two shapes that separate `seat.id !== seat.alias` from revision 1's
// `seat.id !== rowModel`. Both are UNIQUE-alias benches, so a correct guard
// emits nothing; the named mutant emits a seat id with no seat table behind it
// (plan §1.2 verbatim, on the engine path).
describe('v4.8 PR4c: the guard compares the seat to its OWN alias, never to `model` (§3.1, T12b)', () => {
  test('(a) a leg that reports no modelInput still emits NO seat', () => {
    // result-schema.js:63 can yield modelInput: null; materializeReviews
    // (run-launch.js:205) then falls back to `leg.model`, the RESOLVED
    // executable id, and run-stages.js:264 copies that onto the review as
    // `model`. So rowModel is the resolved id here while the seat is a
    // perfectly ordinary unique alias — two strings that never coincide.
    const [seat] = buildSeats(['gemini', 'gpt'], null, null);
    const row = asm.buildRunStatsEntry({
      leg: { model: 'openai/gemini-2.5', modelInput: null, status: 'complete',
        durationMs: 1, usage: null },
      model: 'openai/gemini-2.5', role: 'seat', wasChair: false, conformance: 'clean', seat,
    });
    expect(seat.id).toBe('gemini');
    expect('seat' in row).toBe(false);
  });

  test('(b) a whitespace-padded --council member still emits NO seat', () => {
    // config.js:445-459 classifyCouncilMembers pushes the member RAW, so the
    // bench alias keeps its padding while fanout-validate.js:24 trims the leg's
    // — rowModel and seat.id differ by a space on a bench with no twin at all.
    const [seat] = buildSeats(['openai/gpt-5 ', 'gpt'], null, null);
    expect(seat.id).toBe('openai/gpt-5 ');
    const row = asm.buildRunStatsEntry({
      leg: { model: 'openai/gpt-5', modelInput: 'openai/gpt-5', status: 'complete',
        durationMs: 1, usage: null },
      model: 'openai/gpt-5', role: 'seat', wasChair: false, conformance: 'clean', seat,
    });
    expect('seat' in row).toBe(false);
  });
});

// T14b — `joinsLedger` (ledger.js:49-53) excludes role `judge`, so a judge row
// can never win the ledger join and must not be stamped. `j.seat` IS in scope
// at the judge push, which is exactly why this needs a pin rather than a note:
// run-debate.test.js:838's role Set is {rebuttal,revote,superseded,repair} and
// does not contain `judge`.
test('v4.8 PR4c T14b: judge rows carry NO seat, even on a twin bench', () => {
  const seats = buildSeats(['deepseek', 'deepseek'], null, null);
  const input = asm.buildTallyInput({
    runId: 'r', date: 'd', bench: ['deepseek', 'deepseek'], chair: 'x',
    reviews: [], chairStats: null,
    judgeResults: seats.map(s => ({
      judge: s.alias, ok: true, order: ['deepseek'], seat: s, conformance: 'clean',
      leg: leg('deepseek'), adjudications: [{ id: 'A1', verdict: 'agree' }],
    })),
  });
  const judges = input.runStats.filter(r => r.role === 'judge');
  expect(judges).toHaveLength(2);
  for (const j of judges) { expect('seat' in j).toBe(false); }
  // …while the SAME judgeResults DO stamp the adjudication projection, so this
  // is a scoping pin, not "the seats never reached this function".
  expect(input.adjudications.map(a => a.seat)).toEqual(['deepseek#1', 'deepseek#2']);
});

// Task 4 (v4.7 D2/E4): extraRows is the row-per-launch channel runStage1 now
// returns (repair/dead-seat-error/superseded rows) — buildTallyInput appends
// it right after the primary review rows, before judge/chair accounting.
test('Task 4: buildTallyInput appends extraRows right after the primary review rows', () => {
  const extraRows = [
    { model: 'gpt', role: 'repair', wasChair: false, conformance: 'clean',
      status: 'complete', durationMs: 500, usage: null, waveId: 'abc123-p1' },
  ];
  const input = asm.buildTallyInput({
    runId: 'abc123', date: '2026-07-19', bench: ['gemini', 'gpt', 'qwen'],
    chair: 'deepseek', reviews: REVIEWS, judgeResults: JUDGES,
    chairStats: asm.buildRunStatsEntry({ leg: leg('deepseek', 0.03), role: 'chair', wasChair: true, conformance: 'clean' }),
    extraRows,
  });
  // 3 primary review rows + 1 extraRow + 3 judge rows + 1 chair row = 8.
  expect(input.runStats).toHaveLength(8);
  expect(input.runStats[3]).toEqual(extraRows[0]);           // right after the 3 primary rows
  expect(input.runStats.filter(r => r.role === 'judge')).toHaveLength(3);
});

test('Task 4: extraRows absent/empty ⇒ byte-for-byte unchanged (the length-7 pin stays valid)', () => {
  const withoutKey = asm.buildTallyInput({
    runId: 'abc123', date: '2026-07-19', bench: ['gemini', 'gpt', 'qwen'],
    chair: 'deepseek', reviews: REVIEWS, judgeResults: JUDGES,
    chairStats: asm.buildRunStatsEntry({ leg: leg('deepseek', 0.03), role: 'chair', wasChair: true, conformance: 'clean' }),
  });
  const withEmpty = asm.buildTallyInput({
    runId: 'abc123', date: '2026-07-19', bench: ['gemini', 'gpt', 'qwen'],
    chair: 'deepseek', reviews: REVIEWS, judgeResults: JUDGES,
    chairStats: asm.buildRunStatsEntry({ leg: leg('deepseek', 0.03), role: 'chair', wasChair: true, conformance: 'clean' }),
    extraRows: [],
  });
  expect(withoutKey.runStats).toHaveLength(7);
  expect(withEmpty).toEqual(withoutKey);
});

test('#83: buildTallyInput emits a runStats row per judge, role judge', () => {
  const input = asm.buildTallyInput({
    runId: 'r1', date: '2026-08-01', bench: ['alpha', 'beta'], chair: 'deepseek',
    reviews: [
      { model: 'alpha', modelInput: 'alpha', role: 'seat', text: 't', findings: [], conformance: 'clean',
        leg: { model: 'alpha', status: 'complete', durationMs: 100, usage: { cost: { amount: 0.01 } } } },
    ],
    judgeResults: [
      // adjudications: [] completes the fixture — buildTallyInput's rankings/
      // adjudications reduction runs unconditionally over every ok:true judge
      // (okJudges.flatMap(j => j.adjudications.map(...))), so an ok:true entry
      // with no adjudications key would throw before ever reaching runStats.
      { judge: 'alpha', ok: true, conformance: 'clean', adjudications: [],
        leg: { model: 'alpha', status: 'complete', durationMs: 50, usage: { cost: { amount: 0.005 } } } },
      { judge: 'beta', ok: false, conformance: 'unstructured', leg: null },
    ],
    chairStats: null, claudeReview: null,
  });
  const judges = input.runStats.filter(r => r.role === 'judge');
  expect(judges).toHaveLength(2);
  expect(judges[0]).toMatchObject({ model: 'alpha', role: 'judge', status: 'complete' });
  expect(judges[0].usage.cost.amount).toBe(0.005);
  expect(judges[1]).toMatchObject({ model: 'beta', role: 'judge', status: 'error', usage: null });
});

// Finding 3: --models containing the reserved 'claude' seat, combined with
// --claude-review, corrupts the append-only ledger (a synthesized claude row
// collides with a real bench leg's claude row on ledger.js's Map join). The
// CLI whitelist happens to block claudeReviewFile, but MCP/GitHub
// Action/direct require('./council/run') callers all bypass it — so the guard
// belongs at the engine level, next to the sibling `--chair claude` guard.
describe('preflightClaudeReview rejects a reserved-seat collision in --models (Finding 3)', () => {
  test('models containing "claude" + a claude-review file is a pre-flight error', () => {
    // A REAL, valid review file: if the models-collision guard weren't there,
    // pre-flight would succeed (claudeReview non-null, error null) rather than
    // failing for the unrelated "cannot read" reason — so this proves the
    // guard itself, not a file-read accident.
    const reviewPath = path.join(tmp, 'review-claude.md');
    fs.writeFileSync(reviewPath,
      'Claude review prose.\n```json\n{"overall":"t","findings":[{"id":1,"severity":"major","claim":"c","location":"l","rationale":"r"}]}\n```\n');
    const res = asm.preflightClaudeReview({
      claudeReviewFile: reviewPath, chair: 'deepseek', models: ['gemini', 'claude', 'qwen'],
    });
    expect(res.claudeReview).toBeNull();
    expect(res.error.code).toBe('COUNCIL_CLAUDE_REVIEW_INVALID');
    expect(res.error.message).toContain('models');
  });

  test('the guard is scoped to --claude-review runs: no claudeReviewFile ⇒ untouched', () => {
    // Without --claude-review there is no reserved seat at all — 'claude' in
    // --models is somebody else's problem (model-catalog validation), not this
    // pre-flight's.
    expect(asm.preflightClaudeReview({ claudeReviewFile: null, chair: 'deepseek', models: ['claude'] }))
      .toEqual({ claudeReview: null, error: null });
  });
});

describe('buildRunStatsEntry / worseConformance', () => {
  test('missing leg → null duration and usage (never invent)', () => {
    const row = asm.buildRunStatsEntry({ leg: null, role: 'seat', wasChair: false, conformance: 'clean' });
    expect(row).toEqual({
      model: null, role: 'seat', wasChair: false, conformance: 'clean',
      status: 'error', durationMs: null, usage: null,
    });
  });

  test('explicit model overrides leg.model (alias vs resolved-id join, ledger.js:20-24)', () => {
    const row = asm.buildRunStatsEntry({
      leg: { ...leg('openai/gpt-5.2'), modelInput: 'gpt' },
      model: 'gpt', role: 'seat', wasChair: false, conformance: 'clean',
    });
    expect(row.model).toBe('gpt');
  });

  describe('resolvedModel (v4.7 GOA-7 D8)', () => {
    test('carries leg.model (the executable id) alongside the alias override', () => {
      const row = asm.buildRunStatsEntry({
        leg: { model: 'openai/gpt-5.2', modelInput: 'gpt', status: 'complete', durationMs: 5, usage: null },
        model: 'gpt', role: 'seat',
      });
      expect(row.model).toBe('gpt');
      expect(row.resolvedModel).toBe('openai/gpt-5.2');
    });

    test('leg:null emits NO resolvedModel key (give-up chair / dead-seat shape)', () => {
      const row = asm.buildRunStatsEntry({ leg: null, model: 'gpt', role: 'chair' });
      expect('resolvedModel' in row).toBe(false);
    });

    test('a leg with model:null (routing-failure/setup-throw class) emits NO resolvedModel — and never falls back to modelInput', () => {
      const row = asm.buildRunStatsEntry({
        leg: { model: null, modelInput: 'gpt', status: 'error', durationMs: null, usage: null },
        model: 'gpt', role: 'seat',
      });
      expect('resolvedModel' in row).toBe(false);
    });
  });

  test('LC-11: findingsUnverified rides the row, but ONLY when true', () => {
    // Same class of fact as `conformance`: a 'repaired' seat whose repair contract
    // could not be checked (no original count to compare) is recorded as unchecked
    // rather than implying a check passed. Absent otherwise, so the v4.4 row shape
    // is byte-for-byte unchanged for every other run.
    const row = asm.buildRunStatsEntry({
      leg: null, role: 'seat', wasChair: false, conformance: 'repaired', findingsUnverified: true,
    });
    expect(row.findingsUnverified).toBe(true);
    for (const v of [false, undefined]) {
      const clean = asm.buildRunStatsEntry({
        leg: null, role: 'seat', wasChair: false, conformance: 'repaired', findingsUnverified: v,
      });
      expect('findingsUnverified' in clean).toBe(false);
    }
  });

  test('LC-11: buildTallyInput carries a review\'s findingsUnverified onto its runStats row', () => {
    const input = asm.buildTallyInput({
      runId: 'abc123', date: '2026-07-19', bench: ['gemini', 'gpt'], chair: 'deepseek',
      reviews: [
        { model: 'gemini', role: 'seat', conformance: 'repaired', findingsUnverified: true,
          leg: leg('gemini'), globalFindings: [] },
        { model: 'gpt', role: 'seat', conformance: 'clean', leg: leg('gpt'), globalFindings: [] },
      ],
      judgeResults: [], chairStats: null,
    });
    expect(input.runStats[0].findingsUnverified).toBe(true);
    expect('findingsUnverified' in input.runStats[1]).toBe(false);
  });

  test('review F1: repairRefused rides the row, but ONLY when set', () => {
    const refused = { code: 'REPAIR_CHANGED_FINDING_COUNT',
      detail: 'repair returned 2 findings, original attempted 1' };
    const row = asm.buildRunStatsEntry({
      leg: null, role: 'seat', wasChair: false, conformance: 'unstructured', repairRefused: refused,
    });
    expect(row.repairRefused).toEqual(refused);
    const clean = asm.buildRunStatsEntry({
      leg: null, role: 'seat', wasChair: false, conformance: 'unstructured',
    });
    expect('repairRefused' in clean).toBe(false);
  });

  test('review F1: buildTallyInput carries a review\'s repairRefused onto its runStats row', () => {
    const refused = { code: 'REPAIR_CHANGED_FINDING_COUNT', detail: 'd' };
    const input = asm.buildTallyInput({
      runId: 'abc123', date: '2026-07-19', bench: ['gemini', 'gpt'], chair: 'deepseek',
      reviews: [
        { model: 'gemini', role: 'seat', conformance: 'unstructured', repairRefused: refused,
          leg: leg('gemini'), globalFindings: [] },
        { model: 'gpt', role: 'seat', conformance: 'clean', leg: leg('gpt'), globalFindings: [] },
      ],
      judgeResults: [], chairStats: null,
    });
    expect(input.runStats[0].repairRefused).toEqual(refused);
    expect('repairRefused' in input.runStats[1]).toBe(false);
  });

  test('worst conformance wins', () => {
    expect(asm.worseConformance('clean', 'repaired')).toBe('repaired');
    expect(asm.worseConformance('unstructured', 'repaired')).toBe('unstructured');
    expect(asm.worseConformance('clean', 'clean')).toBe('clean');
  });

  test('buildRunStatsEntry carries the leg waveId, absent when the leg has none', () => {
    const row = asm.buildRunStatsEntry({ leg: { ...mkLeg('m1'), waveId: 'r1-s1' }, model: 'm1', role: 'seat', wasChair: false });
    expect(row.waveId).toBe('r1-s1');
    const bare = asm.buildRunStatsEntry({ leg: null, model: 'claude', role: 'claude', wasChair: false });
    expect('waveId' in bare).toBe(false);
  });
});

describe('artifact emission', () => {
  const input = asm.buildTallyInput({
    runId: 'abc123', date: '2026-07-19', bench: ['gemini', 'gpt', 'qwen'],
    chair: 'deepseek', reviews: REVIEWS, judgeResults: JUDGES, chairStats: null,
  });
  const record = tally(input);

  test('writeTallyFiles writes tally-input.json + tally.json', () => {
    asm.writeTallyFiles({ runDir: tmp, tallyInput: input, record });
    expect(JSON.parse(fs.readFileSync(path.join(tmp, 'tally-input.json'), 'utf-8')).meta.runId).toBe('abc123');
    expect(JSON.parse(fs.readFileSync(path.join(tmp, 'tally.json'), 'utf-8')).tierCounts).toEqual(record.tierCounts);
  });

  test('writeVerdictFiles populates overallVerdict, writes verdict.json + report.html + chair-output.md', () => {
    const verdict = asm.writeVerdictFiles({
      runDir: tmp, record, overallVerdict: 'Fix these first', chairText: 'chair prose\nVERDICT: Fix these first',
    });
    expect(verdict.overallVerdict).toBe('Fix these first');
    const onDisk = JSON.parse(fs.readFileSync(path.join(tmp, 'verdict.json'), 'utf-8'));
    expect(onDisk.overallVerdict).toBe('Fix these first');
    expect(onDisk.findings.every(f => f.decision === null)).toBe(true);   // undecided verdict
    expect(fs.readFileSync(path.join(tmp, 'report.html'), 'utf-8')).toContain('Council Report');
    expect(fs.readFileSync(path.join(tmp, 'chair-output.md'), 'utf-8')).toContain('VERDICT: Fix these first');
  });

  test('writeVerdictFiles with no chair: overallVerdict null, no chair-output.md', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-asm2-'));
    const verdict = asm.writeVerdictFiles({ runDir: dir, record, overallVerdict: null, chairText: null });
    expect(verdict.overallVerdict).toBeNull();
    expect(fs.existsSync(path.join(dir, 'chair-output.md'))).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /**
   * v4.5.2: a lost critic has to reach the file a reader actually opens. The
   * summary is computed upstream (src/council/verdict.js summarizeSeatLoss);
   * this pins that the assembler carries it ONTO DISK rather than dropping it.
   */
  test('writeVerdictFiles records a lost critic in verdict.json', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-asm3-'));
    const reason = 'Failed to start server: Timeout waiting for server to start after 5000ms';
    asm.writeVerdictFiles({
      runDir: dir, record, overallVerdict: null, chairText: null,
      critic: 'qwen',
      deadWaves: [{ waveId: `${record.meta.runId}-c1`, models: ['qwen'], reason }],
    });
    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'verdict.json'), 'utf-8'));
    expect(onDisk.seatLoss).toEqual({
      criticRequested: 'qwen', criticSeated: false, reason, deadBenchSeats: [],
    });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('writeVerdictFiles records a seated critic when no wave died', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-asm4-'));
    asm.writeVerdictFiles({
      runDir: dir, record, overallVerdict: null, chairText: null,
      critic: 'qwen', deadWaves: [],
    });
    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'verdict.json'), 'utf-8'));
    expect(onDisk.seatLoss.criticSeated).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('writeVerdictFiles omits seatLoss when no critic was requested', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-asm5-'));
    asm.writeVerdictFiles({ runDir: dir, record, overallVerdict: null, chairText: null });
    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'verdict.json'), 'utf-8'));
    expect(onDisk.seatLoss).toBeUndefined();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
