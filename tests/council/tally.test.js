// tests/council/tally.test.js
'use strict';
const { assignTier } = require('../../src/council/tally');
const { computeStreetCred } = require('../../src/council/tally');
const { tally } = require('../../src/council/tally');
const avInput = require('./fixtures/av-receiver-input');
// v4.8 PR4c: `runStats[].seat` crosses THREE files — the producer's literal
// (run-assemble.js), tally's allowlist (tally.js) and verdict's verbatim copy
// (verdict.js:148). The T13 round trip below drives all three rather than
// re-declaring the row shape by hand at each hop.
const { buildRunStatsEntry } = require('../../src/council/run-assemble');
const { buildVerdict } = require('../../src/council/verdict');

describe('assignTier (peers-only cascade)', () => {
  const cases = [
    [2, 0, 'Confirmed', 'solid'],
    [3, 1, 'Confirmed', 'solid'],
    [0, 2, 'Disputed', 'solid'],
    [1, 2, 'Disputed', 'solid'],
    [1, 1, 'Contested', 'solid'],
    [0, 1, 'Contested', 'thin'],
    [1, 0, 'Confirmed', 'thin'],  // lone corroborating peer, no dispute → Confirmed (thin), not Singleton
    [0, 0, 'Singleton', 'thin'],
    [2, 2, 'Contested', 'solid'], // large-bench tie → Contested
  ];
  test.each(cases)('a=%i d=%i → %s/%s', (a, d, tier, confidence) => {
    expect(assignTier(a, d)).toEqual({ tier, confidence });
  });
});

describe('computeStreetCred', () => {
  test('withSelf differs from peersOnly when self-rank differs', () => {
    // X ranks itself #1 but peers rank it #3; Y and Z rank X last.
    const rankings = [
      { judge: 'X', order: ['X', 'Y', 'Z'] },
      { judge: 'Y', order: ['Y', 'Z', 'X'] },
      { judge: 'Z', order: ['Z', 'Y', 'X'] },
    ];
    const sc = computeStreetCred(rankings, ['X', 'Y', 'Z']);
    const x = sc.find(s => s.model === 'X');
    expect(x.withSelf).toBeCloseTo((1 + 3 + 3) / 3); // 2.333
    expect(x.peersOnly).toBeCloseTo((3 + 3) / 2);    // 3.0
    expect(x.withSelf).not.toBeCloseTo(x.peersOnly);
  });

  test('fractional ranking for a tie group', () => {
    const rankings = [{ judge: 'X', order: [['A', 'B'], 'C'] }];
    const sc = computeStreetCred(rankings, ['A', 'B', 'C']);
    expect(sc.find(s => s.model === 'A').withSelf).toBeCloseTo(1.5);
    expect(sc.find(s => s.model === 'B').withSelf).toBeCloseTo(1.5);
    expect(sc.find(s => s.model === 'C').withSelf).toBeCloseTo(3);
  });

  test('peersOnly is null when there are no peers (single judge ranks only self)', () => {
    const rankings = [{ judge: 'A', order: ['A'] }];
    const sc = computeStreetCred(rankings, ['A']);
    expect(sc[0].withSelf).toBe(1);
    expect(sc[0].peersOnly).toBeNull();
  });

  test('a model that casts no ranking has withSelf === peersOnly', () => {
    // Claude is reviewed (in models + others rank it) but never judges.
    const rankings = [
      { judge: 'X', order: ['X', 'claude'] },
      { judge: 'Y', order: ['claude', 'Y'] },
    ];
    const sc = computeStreetCred(rankings, ['X', 'Y', 'claude']);
    const c = sc.find(s => s.model === 'claude');
    expect(c.withSelf).toBeCloseTo((2 + 1) / 2);
    expect(c.peersOnly).toBeCloseTo(c.withSelf);
  });
});

describe('tally() — av-receiver golden fixture', () => {
  const record = tally(avInput);
  const tierOf = id => record.findings.find(f => f.id === id).tier;

  test('tierCounts match the verified peers-only result', () => {
    expect(record.tierCounts).toEqual({ Confirmed: 29, Contested: 2, Singleton: 1, Disputed: 3 });
  });

  test('lone-corroborating-peer findings (a=1,d=0) are Confirmed with thin confidence', () => {
    for (const id of ['A3','A6','B7','B8','B10','B11','B12','C9']) {
      const f = record.findings.find(x => x.id === id);
      expect(f.tier).toBe('Confirmed');
      expect(f.confidence).toBe('thin');
    }
  });

  test('only the true no-signal finding (a=0,d=0) stays Singleton', () => {
    expect(tierOf('A7')).toBe('Singleton');
    expect(record.findings.find(f => f.id === 'A7').basis).toEqual({ a: 0, d: 0, n: 2 });
  });

  test('C2 stays Contested (engine removes the grid/summary contradiction)', () => {
    expect(tierOf('C2')).toBe('Contested');
    expect(record.findings.find(f => f.id === 'C2').basis).toEqual({ a: 0, d: 1, n: 1 });
  });

  test('disputed findings are the three C-series factual errors', () => {
    expect(['C6','C7','C12'].map(tierOf)).toEqual(['Disputed','Disputed','Disputed']);
  });

  test('basis excludes the raiser; adjudications keep all votes; tierOverride is null', () => {
    const a1 = record.findings.find(f => f.id === 'A1');
    expect(a1.basis).toEqual({ a: 2, d: 0, n: 0 });          // peers gpt+mistral
    expect(a1.adjudications).toHaveLength(3);                 // incl. deepseek self
    expect(a1.tierOverride).toBeNull();                       // tally never records overrides (that's buildVerdict)
  });

  test('judged is true and runStats echo through with null durations', () => {
    expect(record.judged).toBe(true);
    expect(record.runStats.every(r => r.durationMs === null)).toBe(true);
  });

  test('schemaVersion is council family v2 with type council-tally (v4.0 §7)', () => {
    expect(record.schemaVersion).toBe(2);
    expect(record.type).toBe('council-tally');
  });
});

describe('tally() — defensive basis handling', () => {
  const baseInput = {
    meta: { runId: 'r', runType: 'review', date: 'd', models: ['x', 'y'], chair: 'x', claudeInCouncil: false },
    findings: [{ id: 'F1', raiser: 'x', severity: 'minor', claim: 'c' }],
    rankings: [],
    runStats: [],
  };

  test('unknown verdict strings are skipped, not counted as NaN (L9)', () => {
    const record = tally({
      ...baseInput,
      adjudications: [
        { judge: 'y', findingId: 'F1', verdict: 'agree' },
        { judge: 'z', findingId: 'F1', verdict: 'bogus' },
      ],
    });
    const f = record.findings[0];
    expect(f.basis).toEqual({ a: 1, d: 0, n: 0 });   // 'bogus' ignored, no basis.undefined / NaN
    expect(Object.keys(f.basis)).toEqual(['a', 'd', 'n']);
    expect(f.tier).toBe('Confirmed');                 // (a=1,d=0)
  });

  test('an unset raiser does not silently drop a peer vote (L8)', () => {
    const record = tally({
      ...baseInput,
      findings: [{ id: 'F1', severity: 'minor', claim: 'c' }], // raiser undefined
      adjudications: [
        { judge: 'x', findingId: 'F1', verdict: 'agree' },
        { judge: 'y', findingId: 'F1', verdict: 'agree' },
      ],
    });
    // With no raiser, every vote is a peer vote (nothing excluded).
    expect(record.findings[0].basis).toEqual({ a: 2, d: 0, n: 0 });
  });
});

describe('tally() — runStats carries what qualifies `conformance` (review F3)', () => {
  const baseInput = {
    meta: { runId: 'r', runType: 'review', date: 'd', models: ['x'], chair: 'x', claudeInCouncil: false },
    findings: [], rankings: [], adjudications: [],
  };
  const refused = { code: 'REPAIR_CHANGED_FINDING_COUNT',
    detail: 'repair returned 2 findings, original attempted 1' };

  test('findingsUnverified and repairRefused survive the runStats allowlist', () => {
    const record = tally({
      ...baseInput,
      runStats: [
        { model: 'a', role: 'seat', conformance: 'repaired', findingsUnverified: true,
          status: 'complete', durationMs: 1, usage: null },
        { model: 'b', role: 'seat', conformance: 'unstructured', repairRefused: refused,
          status: 'complete', durationMs: 1, usage: null },
      ],
    });
    expect(record.runStats[0].findingsUnverified).toBe(true);
    expect(record.runStats[1].repairRefused).toEqual(refused);
  });

  test('neither key is invented for a row that does not carry it', () => {
    const record = tally({
      ...baseInput,
      runStats: [{ model: 'a', role: 'seat', conformance: 'clean', status: 'complete',
        durationMs: 1, usage: null }],
    });
    expect(Object.keys(record.runStats[0]))
      .toEqual(['model', 'role', 'wasChair', 'conformance', 'status', 'durationMs', 'usage']);
  });

  test('waveId survives the allowlist when set; the no-waveId row above stays byte-identical', () => {
    const record = tally({
      ...baseInput,
      runStats: [{ model: 'a', role: 'seat', conformance: 'clean', status: 'complete',
        durationMs: 1, usage: null, waveId: 'r1-s1' }],
    });
    expect(record.runStats[0].waveId).toBe('r1-s1');
  });

  test('resolvedModel survives the tally allowlist when set (v4.7 GOA-7 D8)', () => {
    const record = tally({
      ...baseInput,
      runStats: [{ model: 'gpt', role: 'seat', wasChair: false, conformance: 'clean',
        resolvedModel: 'openai/gpt-5.2', status: 'complete', durationMs: 5, usage: null }],
    });
    expect(record.runStats[0].resolvedModel).toBe('openai/gpt-5.2');
  });

  test('absent resolvedModel stays absent through tally (legacy/hand-assembled rows)', () => {
    const record = tally({
      ...baseInput,
      runStats: [{ model: 'gpt', role: 'seat', wasChair: false, conformance: 'clean',
        status: 'complete', durationMs: 5, usage: null }],
    });
    expect('resolvedModel' in record.runStats[0]).toBe(false);
  });
});

// v4.8 PR3 Task 5: `seat` (on adjudications) and `raiserSeat` (on findings) are
// additive passthroughs — tally.js :: tally's adjudication push and its findings
// return are allowlists that silently DROP any key not named. RED today.
describe('tally() — seat/raiserSeat passthrough (v4.8 PR3 Task 5)', () => {
  const baseInput = {
    meta: { runId: 'r', runType: 'review', date: 'd', models: ['deepseek#1', 'deepseek#2'],
      chair: 'x', claudeInCouncil: false },
    rankings: [], runStats: [],
  };

  test('an adjudication built from a seat-carrying judgeResults survives tally() with its seat', () => {
    const record = tally({
      ...baseInput,
      findings: [{ id: 'F1', raiser: 'deepseek#1', severity: 'minor', claim: 'c' }],
      adjudications: [
        { findingId: 'F1', judge: 'deepseek#2', verdict: 'agree', seat: 'deepseek#2' },
      ],
    });
    const vote = record.findings[0].adjudications.find(v => v.judge === 'deepseek#2');
    expect(vote.seat).toBe('deepseek#2');
  });

  test('a finding raised by a seat-carrying review survives with its raiserSeat', () => {
    const record = tally({
      ...baseInput,
      findings: [{ id: 'F1', raiser: 'deepseek', severity: 'minor', claim: 'c', raiserSeat: 'deepseek#1' }],
      adjudications: [],
    });
    expect(record.findings[0].raiserSeat).toBe('deepseek#1');
  });

  test('an adjudication with no seat key emits no seat key on the survived vote', () => {
    const record = tally({
      ...baseInput,
      findings: [{ id: 'F1', raiser: 'x', severity: 'minor', claim: 'c' }],
      adjudications: [{ findingId: 'F1', judge: 'y', verdict: 'agree' }],
    });
    expect('seat' in record.findings[0].adjudications[0]).toBe(false);
  });

  test('a finding with no raiserSeat key emits no raiserSeat key on the survived finding', () => {
    const record = tally({
      ...baseInput,
      findings: [{ id: 'F1', raiser: 'x', severity: 'minor', claim: 'c' }],
      adjudications: [],
    });
    expect('raiserSeat' in record.findings[0]).toBe(false);
  });
});

// v4.8 PR4c Task 1 (plan §3.1, T13): tally.js :: tally's `runStats` map is an allowlist
// that builds a FRESH object literal, so a `seat` key on an input row is
// stripped before it can reach tally.json — and verdict.js:148 copies tally's
// output verbatim, so verdict.json inherits the strip. Producing the row with
// the REAL buildRunStatsEntry makes T13c a genuine round trip between two
// independently-written literals rather than a restatement of one of them.
describe('tally() — runStats[].seat round trip (v4.8 PR4c §3.1, T13)', () => {
  const seat = { id: 'deepseek#1', alias: 'deepseek', role: 'seat', lens: null, position: 1 };
  const input = {
    meta: { runId: 'r', runType: 'headless', date: 'd', models: ['deepseek', 'deepseek'],
      chair: 'x', claudeInCouncil: false },
    findings: [], rankings: [], adjudications: [],
    runStats: [
      buildRunStatsEntry({ leg: { model: 'deepseek', status: 'complete', durationMs: 1, usage: null,
        waveId: 'r-s1' }, model: 'deepseek', role: 'seat', wasChair: false, conformance: 'clean', seat }),
      buildRunStatsEntry({ leg: { model: 'gpt', status: 'complete', durationMs: 1, usage: null },
        model: 'gpt', role: 'seat', wasChair: false, conformance: 'clean',
        seat: { id: 'gpt', alias: 'gpt', role: 'seat', lens: null, position: 3 } }),
    ],
  };
  const record = tally(input);

  test('T13a: the seat survives tally()\'s allowlist into the tally record', () => {
    expect(input.runStats[0].seat).toBe('deepseek#1');       // the producer really emitted it
    expect(record.runStats[0].seat).toBe('deepseek#1');
    expect('seat' in record.runStats[1]).toBe(false);        // unique alias ⇒ nothing to say
  });

  test('T13b: the seat reaches verdict.json (verdict copies runStats verbatim)', () => {
    const onDisk = JSON.parse(JSON.stringify(buildVerdict(record, [])));
    expect(onDisk.runStats[0].seat).toBe('deepseek#1');
    expect('seat' in onDisk.runStats[1]).toBe(false);
  });

  test('T13c: the row\'s KEY ORDER is identical on both sides of tally()', () => {
    expect(Object.keys(record.runStats[0])).toEqual(Object.keys(input.runStats[0]));
    expect(Object.keys(record.runStats[0])).toEqual(
      ['model', 'role', 'wasChair', 'conformance', 'waveId', 'resolvedModel', 'seat',
        'status', 'durationMs', 'usage']);
  });
});

// v4.8 PR4c Task 3 (plan §3.3, R4c-4) — the GUARDED peer filter and the R8 stamp.
//
// tally.js's peer filter has THREE branches, and each test below names the one it
// drives: the OUTER `f.raiser ? … : votes`, and inside it the seat branch and the
// alias branch. Two spellings are being separated —
//   GUARDED  (v.seat && f.raiserSeat) ? v.seat !== f.raiserSeat : v.judge !== f.raiser
//   NAIVE    v.seat !== f.raiserSeat            (seat-valued, unguarded)
// — and NAIVE is wrong on a REAL run, not merely on hand-assembled input.
// `bindSeats` orphans a twin leg (a `deepseek` leg whose id is not `${waveId}-${n}`
// cannot take the alias fallback, because `deepseek` owns two seats) and both
// stages filter their `__unbound-` placeholders out, so "exactly one side of a
// twin pair carries its seat id" is a designed-for state in BOTH directions.
// There NAIVE compares a seat id against `undefined`, admits the raiser's own
// alias as its own peer, and silently promotes a Singleton to Confirmed.
describe('tally() — the guarded peer filter (v4.8 PR4c §3.3, T1-T3)', () => {
  const meta = { runId: 'r', runType: 'headless', date: 'd',
    models: ['deepseek', 'deepseek', 'gpt'], chair: 'gemini', claudeInCouncil: false };
  const base = { meta, rankings: [], runStats: [] };

  test('T1: direction A — finding HAS raiserSeat, the twin vote has NO seat ⇒ excluded', () => {
    // Stage-1 seat bound, the twin judge's Stage-2 seat orphaned. GUARDED takes
    // the ALIAS branch and excludes; NAIVE reads `undefined !== 'deepseek#1'`.
    const record = tally({
      ...base,
      findings: [{ id: 'F1', raiser: 'deepseek', raiserSeat: 'deepseek#1', severity: 'major', claim: 'c' }],
      adjudications: [{ findingId: 'F1', judge: 'deepseek', verdict: 'agree' }],
    });
    expect(record.findings[0].basis).toEqual({ a: 0, d: 0, n: 0 });
    expect(record.findings[0].tier).toBe('Singleton');
  });

  test('T2: direction B — finding has NO raiserSeat, the twin vote HAS a seat ⇒ excluded', () => {
    // The mirror: only ONE unbound Stage-1 twin review, so that review's judge is
    // a filtered placeholder while the other twin binds.
    const record = tally({
      ...base,
      findings: [{ id: 'F1', raiser: 'deepseek', severity: 'major', claim: 'c' }],
      adjudications: [{ findingId: 'F1', judge: 'deepseek', verdict: 'agree', seat: 'deepseek#2' }],
    });
    expect(record.findings[0].basis).toEqual({ a: 0, d: 0, n: 0 });
    expect(record.findings[0].tier).toBe('Singleton');
  });

  test('T3: symmetric seats, same alias, DIFFERENT seats ⇒ the twin is a peer (#137)', () => {
    // Row 8 of §1.3's truth table — the fix itself. ⚠️ This separates GUARDED
    // from HEAD ONLY. NAIVE admits this vote too, so it does not separate GUARDED
    // from NAIVE; T1 and T2 carry that.
    const record = tally({
      ...base,
      findings: [{ id: 'F1', raiser: 'deepseek', raiserSeat: 'deepseek#1', severity: 'major', claim: 'c' }],
      adjudications: [
        { findingId: 'F1', judge: 'deepseek', verdict: 'agree', seat: 'deepseek#1' }, // the raiser's OWN vote
        { findingId: 'F1', judge: 'deepseek', verdict: 'agree', seat: 'deepseek#2' }, // its twin — a real peer
        { findingId: 'F1', judge: 'gpt', verdict: 'agree', seat: 'gpt' },
      ],
    });
    const f = record.findings[0];
    expect(f.basis).toEqual({ a: 2, d: 0, n: 0 });   // HEAD counts 1: the whole alias is dropped
    expect(f.confidence).toBe('solid');              // HEAD: 'thin'
    expect(f.tier).toBe('Confirmed');
    expect(f.adjudications).toHaveLength(3);         // every vote still travels on the record
  });
});

// The R8 stamp (§3.3). It is computed on the POST-filter `peers`, emitted only
// when TRUE, and reads THIS document — the tally record. `verdict.json`'s
// carry-through is a separate step with its own test (T6c).
//
// The achievable property, stated rather than assumed: the stamp is unreachable
// unless a raiser is NAMED (a truthy `f.raiser`, which '' is not) AND a vote and
// its finding BOTH carry seat ids. Each conjunct is asserted in the expression
// itself; none is inferred from a branch. T7/T7b/T7d pin one conjunct each.
describe('tally() — sameModelCorroboration, the R8 stamp (v4.8 PR4c §3.3)', () => {
  const meta = { runId: 'r', runType: 'headless', date: 'd',
    models: ['deepseek', 'deepseek', 'gpt'], chair: 'gemini', claudeInCouncil: false };
  const base = { meta, rankings: [], runStats: [] };

  test('T6a: a twin agree stamps the tally finding', () => {
    // `peers` has already excluded the raiser BY SEAT, so a surviving peer whose
    // ALIAS equals the raiser's is a different seat of the same model.
    const record = tally({
      ...base,
      findings: [{ id: 'F1', raiser: 'deepseek', raiserSeat: 'deepseek#1', severity: 'major', claim: 'c' }],
      adjudications: [{ findingId: 'F1', judge: 'deepseek', verdict: 'agree', seat: 'deepseek#2' }],
    });
    expect(record.findings[0].sameModelCorroboration).toBe(true);
    expect(record.findings[0].basis).toEqual({ a: 1, d: 0, n: 0 });
  });

  test('T6b: an ordinary unique-alias document carries NO key at all — absent, not false', () => {
    const record = tally({
      ...base,
      meta: { ...meta, models: ['gemini', 'gpt'] },
      findings: [{ id: 'F1', raiser: 'gemini', severity: 'major', claim: 'c' }],
      adjudications: [{ findingId: 'F1', judge: 'gpt', verdict: 'agree' }],
    });
    const f = record.findings[0];
    expect(f.basis).toEqual({ a: 1, d: 0, n: 0 });
    expect('sameModelCorroboration' in f).toBe(false);   // an unconditional `false` fails here
  });

  test('T7: seat ids that EQUAL their aliases do not stamp', () => {
    // A raiser IS named here, so the leading `f.raiser &&` cannot short-circuit
    // the expression: this document reaches the `v.judge === f.raiser` conjunct
    // and is RED without it.
    const record = tally({
      ...base,
      meta: { ...meta, models: ['gemini', 'gpt'] },
      findings: [{ id: 'F1', raiser: 'gemini', severity: 'major', claim: 'c', raiserSeat: 'gemini' }],
      adjudications: [{ findingId: 'F1', judge: 'gpt', verdict: 'agree', seat: 'gpt' }],
    });
    const f = record.findings[0];
    expect(f.basis).toEqual({ a: 1, d: 0, n: 0 });       // the seat branch ADMITS it
    expect('sameModelCorroboration' in f).toBe(false);
  });

  test('T7b: no raiser and no judge, but BOTH seat fields set, does not stamp', () => {
    // The outer `f.raiser ? … : votes` skips the filter entirely, so `peers` holds
    // a seat-carrying vote with the seat branch never having run, and
    // `v.judge === f.raiser` is `undefined === undefined`. Reachable through
    // cli-handlers-council.js's raw JSON.parse, which has no schema at all.
    const record = tally({
      ...base,
      findings: [{ id: 'F1', severity: 'major', claim: 'c', raiserSeat: 'deepseek#1' }],
      adjudications: [{ findingId: 'F1', verdict: 'agree', seat: 'deepseek#2' }],
    });
    expect('sameModelCorroboration' in record.findings[0]).toBe(false);
  });

  test('T7d: an EMPTY-STRING raiser and judge do not stamp', () => {
    // mcp-tools.js makes `raiser`/`judge` required z.string(), which ACCEPTS '',
    // and that path reaches the append-only ledger via mcp-server.js.
    const record = tally({
      ...base,
      findings: [{ id: 'F1', raiser: '', severity: 'major', claim: 'c', raiserSeat: 'deepseek#1' }],
      adjudications: [{ findingId: 'F1', judge: '', verdict: 'agree', seat: 'deepseek#2' }],
    });
    expect('sameModelCorroboration' in record.findings[0]).toBe(false);
  });
});
