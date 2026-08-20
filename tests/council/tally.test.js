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
    // With no raiser, every NAMED vote is a peer vote. ⚠️ v4.8 T-B4 narrowed
    // that from "every vote": a vote whose `judge` is falsy beside a falsy
    // raiser may be the raiser's own, so it is dropped and announced instead.
    // Both judges here are named, so this fixture is unchanged — which is the
    // half of L8 that was ever load-bearing.
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
// The peer filter (peer-split.js :: peersOf, called by tally.js since v4.8
// Phase 2 T-B1 and by debate.js :: debateTargets since T-B2) has THREE ORDERED
// branches, and each test below names the one it
// drives: the SEAT compare, which decides first for ANY raiser; then, only when
// the seats cannot decide, the ALIAS compare for a named raiser and the
// named-judge rule for a falsy one. ⚠️ v4.8 T-B4 changed the last of those from
// a bare `: votes` — an unnamed raiser used to corroborate itself — and then
// lifted the seat compare above the raiser test entirely, so a vote carrying
// the raiser's own seat id is excluded whatever its judge field says. T1-T3b
// all name a raiser and all take the first two branches. Two spellings are
// being separated —
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

  test('T1: direction A — finding HAS raiserSeat, the twin vote has NO seat ⇒ excluded AND announced', () => {
    // SI-22.2 — the PEER's leg is the orphaned one: Stage-1 seat bound, with
    // the twin judge's Stage-2 seat orphaned. GUARDED takes the ALIAS branch and
    // excludes; NAIVE reads `undefined !== 'deepseek#1'`.
    // ⚠️ Keep that phrase on ONE line — BACKLOG.md's SI-22.2 filing quotes it
    // verbatim to identify this fixture, and a re-wrap silently voids the quote.
    //
    // ⚠️ `basis` and `tier` are UNCHANGED from this test's pre-T-B2 form. That
    // is an owner ruling, not an oversight: counting the ambiguous vote
    // reproduces NAIVE's own outcome — measured on THIS fixture, {a:1,d:0,n:0}
    // ⇒ Confirmed — which is exactly the "silently promotes a Singleton to
    // Confirmed on the raiser's own vote" re-arm of #137, and it would leave
    // the naive form unpinned in the very release that fixes the bug it re-arms.
    //
    // What v4.8 T-B2 changes is the third assertion, and only that: the drop is
    // no longer SILENTLY correct. It is excluded AND announced.
    const record = tally({
      ...base,
      findings: [{ id: 'F1', raiser: 'deepseek', raiserSeat: 'deepseek#1', severity: 'major', claim: 'c' }],
      adjudications: [{ findingId: 'F1', judge: 'deepseek', verdict: 'agree' }],
    });
    expect(record.findings[0].basis).toEqual({ a: 0, d: 0, n: 0 });
    expect(record.findings[0].tier).toBe('Singleton');
    expect(record.findings[0].unattributedPeerDrops).toBe(1);
  });

  test('T2: direction B — finding has NO raiserSeat, the twin vote HAS a seat ⇒ excluded AND announced', () => {
    // SI-22.1 — the RAISER's OWN leg is the orphaned one. The mirror of T1, not
    // a restatement of it: only ONE unbound Stage-1 twin review, so that
    // review's judge is a filtered placeholder while the other twin binds.
    // ⚠️ Keep that phrase on ONE line — BACKLOG.md's SI-22.1 filing quotes it
    // verbatim to identify this fixture, and a re-wrap silently voids the quote.
    //
    // ⚠️ `basis` and `tier` are UNCHANGED here for the same ruling as T1:
    // measured on THIS fixture, counting the ambiguous vote gives {a:1,d:0,n:0}
    // ⇒ Confirmed, i.e. NAIVE's outcome and #137's re-arm.
    const record = tally({
      ...base,
      findings: [{ id: 'F1', raiser: 'deepseek', severity: 'major', claim: 'c' }],
      adjudications: [{ findingId: 'F1', judge: 'deepseek', verdict: 'agree', seat: 'deepseek#2' }],
    });
    expect(record.findings[0].basis).toEqual({ a: 0, d: 0, n: 0 });
    expect(record.findings[0].tier).toBe('Singleton');
    expect(record.findings[0].unattributedPeerDrops).toBe(1);
  });

  test('T3: symmetric seats, same alias, DIFFERENT seats ⇒ the twin is a peer (#137)', () => {
    // Row 8 of §1.3's truth table — the fix itself. ⚠️ This separates GUARDED
    // from HEAD ONLY. NAIVE admits this vote too, so it does not separate
    // GUARDED from NAIVE.
    //
    // ⚠️ CORRECTED by measurement (v4.8 T-B2). This comment used to end "T1 and
    // T2 carry that", and BACKLOG.md read that as "T1 and T2 are the ONLY tests
    // separating GUARDED from NAIVE". They are not. Running the named mutant
    // NAIVESPLIT (peer-split.js :: peersOf, inner ternary replaced by the
    // unguarded `v.seat !== f.raiserSeat`) against the FULL suite turns 17
    // suites and 97 tests red, 10 of them in THIS file — because NAIVE also
    // breaks the ordinary unique-alias bench, where it reads
    // `undefined !== undefined` and drops a real peer. What T1 and T2 alone
    // carry is the one-side-seated TWIN pair, in both directions.
    // ⚠️ SUPERSEDED COUNT, not a superseded point — the sentence above was true
    // at T-B2 (`e23e56cd`) and stands. T-B4 re-ran the mutant twice: it is now
    // 17 suites / 109 tests, 13 of them here. (T-B5's round-1 volume pin in
    // peer-split.test.js briefly made it 110 by firing on a line-count change
    // rather than on behaviour; round 3 moved that guard onto the extractor and
    // it measured back to 109.) The point is unaffected; only the numbers moved.
    // Single source, re-run and never renumbered:
    // peer-split-mutants.js :: NAIVESPLIT.
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

  test('T3b: the T-B2 mark is ABSENT — not 0 — on both shapes the predicate does not fire', () => {
    // Emitted only when > 0, so any run that does not orphan exactly one side
    // of a twin pair is byte-for-byte unchanged. Pinned as absence, because a
    // `0` would change the shape of every document in the repo.
    const symmetric = tally({
      ...base,
      findings: [{ id: 'F1', raiser: 'deepseek', raiserSeat: 'deepseek#1', severity: 'major', claim: 'c' }],
      adjudications: [
        { findingId: 'F1', judge: 'deepseek', verdict: 'agree', seat: 'deepseek#1' },
        { findingId: 'F1', judge: 'deepseek', verdict: 'agree', seat: 'deepseek#2' },
      ],
    });
    expect('unattributedPeerDrops' in symmetric.findings[0]).toBe(false);

    const uniqueAlias = tally({
      ...base,
      meta: { ...meta, models: ['gemini', 'gpt'] },
      findings: [{ id: 'F1', raiser: 'gemini', severity: 'major', claim: 'c' }],
      adjudications: [{ findingId: 'F1', judge: 'gpt', verdict: 'agree' }],
    });
    expect('unattributedPeerDrops' in uniqueAlias.findings[0]).toBe(false);
  });
});

// The R8 stamp (§3.3). It is computed on the POST-filter `peers`, emitted only
// when TRUE, and reads THIS document — the tally record. `verdict.json`'s
// carry-through is a separate step with its own test (T6c).
//
// The achievable property, stated rather than assumed: the stamp is unreachable
// unless a raiser is NAMED (a truthy `f.raiser`, which '' is not) AND a vote and
// its finding BOTH carry seat ids. Each conjunct is asserted in the expression
// itself; none is inferred from a branch. T7 pins `v.judge === f.raiser`.
//
// ⚠️ T7b and T7d pin `f.raiser &&` — but that sentence was FALSE for one commit
// and the reason is worth keeping. T-B4 round 1 made `peersOf` drop every
// falsy-judge vote of a falsy raiser, which emptied `peers` on both fixtures and
// left the stamp unable to fire whether the guard was there or not: a hardening
// had disarmed the very pins that guarded it. Round 2's P0 rule counts those
// votes again — the two seat ids DIFFER, so they are provably real peers —
// which restores the guard as the deciding term.
// MEASURED at each step over the 768-shape cross-product of (f.raiser,
// f.raiserSeat, v.judge, v.seat, verdict): deleting `f.raiser &&` flipped 8
// shapes at 64b835b8, ZERO after round 1, and 4 after round 2 — the seat-DIFFER
// shapes of the T7b family (2) and the T7d family (2), i.e. exactly these two
// tests. It is 4 rather than 8 because P0 excludes the seat-EQUAL shapes
// outright, so `peers` never holds them and the guard has nothing to suppress
// there. ⚠️ This sentence shipped "8 again" for one commit: the number was
// reasoned, measured at 4, and corrected in tally.js — and this twin was
// missed, because a same-file sweep cannot see a twin in another file. The
// escape that found it is a repo-wide grep for the distinctive phrase
// `768-shape`, which appears in exactly two files. Never infer this number;
// re-run it after every edit to peer-split.js :: peersOf.
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
    // Reachable through cli-handlers-council.js's raw JSON.parse, which has no
    // schema at all. ⚠️ This fixture moved TWICE inside T-B4 and the second move
    // put it back where it started, so read the values, not the history: the two
    // seat ids DIFFER, so P0 attributes the vote as a real peer and it is
    // COUNTED — `basis {a:1}`, no mark. Round 1 briefly dropped and marked it for
    // having no judge, which the corrected specification calls a mistake: the
    // seats already prove it is not the raiser's.
    //
    // ⚠️ THIS TEST PINS `f.raiser &&` AGAIN. Because the vote is counted, `peers`
    // holds a seat-carrying vote whose `v.judge === f.raiser` reads
    // `undefined === undefined`, so the stamp's inner expression is TRUE here and
    // the leading guard is the only thing suppressing it. Deleting the guard
    // turns this assertion red.
    const record = tally({
      ...base,
      findings: [{ id: 'F1', severity: 'major', claim: 'c', raiserSeat: 'deepseek#1' }],
      adjudications: [{ findingId: 'F1', verdict: 'agree', seat: 'deepseek#2' }],
    });
    expect(record.findings[0].basis).toEqual({ a: 1, d: 0, n: 0 });
    expect('unattributedPeerDrops' in record.findings[0]).toBe(false);
    expect('sameModelCorroboration' in record.findings[0]).toBe(false);
  });

  test('T7d: an EMPTY-STRING raiser and judge do not stamp', () => {
    // mcp-tools.js makes `raiser`/`judge` required z.string(), which ACCEPTS '',
    // and that path reaches the append-only ledger via mcp-server.js. The mirror
    // of T7b on the other engine path, and it pins the guard the same way:
    // `'' === ''` is the reading that makes the stamp's inner expression true.
    const record = tally({
      ...base,
      findings: [{ id: 'F1', raiser: '', severity: 'major', claim: 'c', raiserSeat: 'deepseek#1' }],
      adjudications: [{ findingId: 'F1', judge: '', verdict: 'agree', seat: 'deepseek#2' }],
    });
    expect(record.findings[0].basis).toEqual({ a: 1, d: 0, n: 0 });
    expect('unattributedPeerDrops' in record.findings[0]).toBe(false);
    expect('sameModelCorroboration' in record.findings[0]).toBe(false);
  });
});

// v4.8 T-B4 (T8) — council C1, end to end through `tally()`: the finding the
// council actually raised against PR #174, and the named-raiser control it was
// measured against. The defect was PRE-EXISTING, not introduced by PR B —
// measured at base e7cf54b0, the tally read `{a:2}` Confirmed there too.
describe('tally() — an unnamed raiser does not corroborate itself (v4.8 T-B4, C1)', () => {
  const meta = { runId: 'r', runType: 'headless', date: 'd',
    models: ['deepseek', 'gpt'], chair: 'gemini', claudeInCouncil: false };
  const base = { meta, rankings: [], runStats: [] };

  test('T8a: `raiser:\'\'` with its own vote beside a real peer counts ONE peer, and says so', () => {
    // HEAD counted BOTH: `basis {a:2}`, tier Confirmed, confidence SOLID, and no
    // mark — an empty-string raiser voting its own finding up to a two-peer
    // majority on a live MCP code path (mcp-tools.js's `raiser` is a bare
    // `z.string()`, which accepts '').
    const record = tally({
      ...base,
      findings: [{ id: 'A1', raiser: '', severity: 'major', claim: 'c' }],
      adjudications: [{ findingId: 'A1', judge: '', verdict: 'agree' },
        { findingId: 'A1', judge: 'gpt', verdict: 'agree' }],
    });
    const f = record.findings[0];
    expect(f.basis).toEqual({ a: 1, d: 0, n: 0 });
    expect(f.tier).toBe('Confirmed');
    expect(f.confidence).toBe('thin');
    expect(f.unattributedPeerDrops).toBe(1);
  });

  test('T8b CONTROL: the same shape with a NAMED raiser — identical basis, and no mark', () => {
    // The control the finding was adjudicated against. It reads the same
    // `{a:1}` it always has: T-B4 moved the falsy-raiser case TO the control,
    // it did not move the control. The only difference that survives is the
    // mark, which is the whole point — the ambiguous vote is announced, and
    // an ordinary alias exclusion is not.
    const record = tally({
      ...base,
      findings: [{ id: 'A1', raiser: 'gemini', severity: 'major', claim: 'c' }],
      adjudications: [{ findingId: 'A1', judge: 'gemini', verdict: 'agree' },
        { findingId: 'A1', judge: 'gpt', verdict: 'agree' }],
    });
    const f = record.findings[0];
    expect(f.basis).toEqual({ a: 1, d: 0, n: 0 });
    expect(f.tier).toBe('Confirmed');
    expect('unattributedPeerDrops' in f).toBe(false);
  });
});
