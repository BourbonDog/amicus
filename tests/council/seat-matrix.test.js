// tests/council/seat-matrix.test.js
'use strict';

/**
 * v4.8 PR4c §3.6 (R4c-8) — the adjudication matrix is seat-keyed.
 *
 * ONE file for BOTH renderers on purpose. §3.6's claim is not "the report is
 * seat-keyed" and separately "the workspace is seat-keyed"; it is that the
 * rendered row and the tally's own `basis` AGREE, on every reader. `report.js`
 * (markdown + html) and `src/workspace/matrix-model.js` read the same two
 * documents through the same `seatSpace` flag, so splitting them across suites
 * would let one drift and still be green.
 *
 * The first describe drives the REAL `runCouncil` on a twin bench end to end
 * (§5's "an end-to-end twin test is CHEAP") and asserts against the
 * `verdict.json`, `tally.json` and `report.html` it actually writes — the
 * §5 ⚠️ systemic gap is that unit tests on these functions cannot see a broken
 * seam. The second describe holds the shapes an engine run cannot produce:
 * a PR3-era verdict already on disk, an orphaned seat, and a malformed table
 * arriving through one of the three schema-free JSON.parse entry points.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { runCouncil } = require('../../src/council/run');
const { tally } = require('../../src/council/tally');
const { buildVerdict } = require('../../src/council/verdict');
const { buildReport, toModel, SYMBOL, isSeatSpace } = require('../../src/council/report');
const { buildMatrixModel } = require('../../src/workspace/matrix-model');
const {
  review, judgeOut, mkLeg, okWave, launchersFromScript, baseOptions,
} = require('./helpers/fake-launchers');

/** The matrix row for `id`, as rendered into the markdown report. */
function rowFor(md, id) {
  return md.split('\n').find(l => l.startsWith(`| ${id} |`));
}
function headerFor(md) {
  return md.split('\n').find(l => l.startsWith('| Finding |'));
}

/**
 * Recompute `basis` from what the row actually SHOWS: every vote cell except
 * the starred (raiser's own) one. §3.6's whole property is that this equals the
 * tally's basis — a vote keyed to a column no roster entry reads is invisible
 * here while still counting there, which is exactly the defect the alias
 * last-wins used to hide.
 */
function renderedBasis(rowLine, judgeCount) {
  const parts = rowLine.split('|').slice(1, -1).map(s => s.trim());
  const cells = parts.slice(3, 3 + judgeCount);
  const b = { a: 0, d: 0, n: 0 };
  // Symbols come from report.js itself — a hand-copied glyph (the neutral one
  // is an EN DASH) would silently stop matching if SYMBOL ever changed.
  for (const c of cells) {
    if (c.endsWith('*')) { continue; }
    if (c.startsWith(SYMBOL.agree)) { b.a += 1; } else if (c.startsWith(SYMBOL.dispute)) { b.d += 1; } else if (c.startsWith(SYMBOL.neutral)) { b.n += 1; }
  }
  return b;
}

// ---------------------------------------------------------------------------
// T17 + T18 — the engine path, end to end.
// ---------------------------------------------------------------------------

describe('T17/T18 twin bench, on disk: one column per SEAT and the row agrees with basis', () => {
  let verdict, tallyDoc, runDoc, md, html;

  beforeAll(async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'seat-matrix-'));
    const runId = 'twin03';
    // Both seats review (A1 ← gemini#1, B1 ← gemini#2) and both judge. The
    // votes are deliberately SPLIT: seat #2 disputes A1 while seat #1 agrees
    // with it. Under the shipped alias last-wins (`byJudge[adj.judge]`) the two
    // twins overwrite each other and one real vote is erased — the data loss
    // §3.6 exists to fix, and the reason this fixture is not the symmetric
    // all-agree twin already in seat-parity-ondisk.test.js.
    const script = {
      [`${runId}-s1`]: (opts) => okWave(opts.models.map((m, i) => mkLeg(m, review(`${m}${i + 1}`)))),
      [`${runId}-s2`]: () => okWave([
        mkLeg('gemini', judgeOut(['Review B', 'Review A'],
          [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'agree' }])),
        mkLeg('gemini', judgeOut(['Review A', 'Review B'],
          [{ id: 'A1', verdict: 'dispute' }, { id: 'B1', verdict: 'agree' }])),
      ]),
      [`${runId}-ch1`]: () => okWave([
        mkLeg('deepseek', 'Synthesis of the twin bench.\n\nVERDICT: Ship it', 'complete', 0.03),
      ]),
    };
    const opts = baseOptions(tmp, {
      models: ['gemini', 'gemini'], runId, runDir: path.join(tmp, `council-${runId}`),
    });
    const { exitCode } = await runCouncil(opts, {
      launchers: launchersFromScript(script),
      appendRunFn: () => {}, statsFn: () => [], installSignalAbortFn: () => () => {},
    });
    // A degraded run would skip artifacts and make every pin below vacuous.
    expect(exitCode).toBe(0);
    verdict = JSON.parse(fs.readFileSync(path.join(opts.runDir, 'verdict.json'), 'utf-8'));
    tallyDoc = JSON.parse(fs.readFileSync(path.join(opts.runDir, 'tally.json'), 'utf-8'));
    runDoc = JSON.parse(fs.readFileSync(path.join(opts.runDir, 'run.json'), 'utf-8'));
    md = buildReport({ verdict }, { format: 'md' });
    // The HTML the RUN wrote, not one this test re-rendered: §3.6 claims
    // report-html.js needs zero edits, and only the shipped artifact proves it.
    html = fs.readFileSync(path.join(opts.runDir, 'report.html'), 'utf-8');
  });

  test('the fixture really is a twin bench with a SPLIT vote (guard against a vacuous pin)', () => {
    expect(verdict.seats.map(s => s.id)).toEqual(['gemini#1', 'gemini#2']);
    expect(verdict.council).toEqual(['gemini', 'gemini']);
    const byId = Object.fromEntries(verdict.findings.map(f => [f.id, f]));
    expect(byId.A1.raiserSeat).toBe('gemini#1');
    expect(byId.B1.raiserSeat).toBe('gemini#2');
    expect(byId.A1.basis).toEqual({ a: 0, d: 1, n: 0 });
    expect(byId.B1.basis).toEqual({ a: 1, d: 0, n: 0 });
  });

  test('markdown: one column per seat, the star on the raiser SEAT only', () => {
    expect(headerFor(md)).toBe('| Finding | Sev | Raiser | gemini#1 | gemini#2 | Tier | Decision |');
    expect(rowFor(md, 'A1')).toBe('| A1 | major | gemini#1 | ✓* | ✗ | Contested |  |');
    // ⚠️ v4.8 PR5a T6 (R5-10) UPDATES THIS PIN DELIBERATELY. B1 is the finding that carries
    // sameModelCorroboration on this fixture, so the tier cell now reads `Confirmed†`. The
    // marker rides the TIER because that is the claim R8 qualifies — a Confirmed reached
    // only via the raiser's own twin is concurrence, not independent support. The star and
    // the seat columns are unchanged, which is what keeps PR4c's assertion intact.
    expect(rowFor(md, 'B1')).toBe('| B1 | major | gemini#2 | ✓ | ✓* | Confirmed† |  |');
  });

  test('markdown: EVERY reader of the raiser moves together — matrix, Findings-by-tier, and NOT the council line', () => {
    // The third render site of the model's `raiser` (renderMd's by-tier list).
    // Leaving any one reader behind is how revision 2 and revision 3 each
    // shipped a document that contradicted itself.
    expect(md).toContain('- **A1** (major, raiser gemini#1) — a0/d1/n0');
    expect(md).toContain('- **B1** (major, raiser gemini#2) — a1/d0/n0');
    // …while `council` stays the ALIAS list: it is the street-cred universe,
    // not a column set, and re-keying it would break the meta line and the
    // street-cred join at once.
    expect(md).toContain('council: gemini, gemini');
    expect(md).toMatch(/\|\s*gemini\s*\|\s*[\d.—]+\s*\|/); // street-cred row, alias-keyed
  });

  test('markdown: every rendered row agrees with its own basis', () => {
    for (const f of verdict.findings) {
      expect(renderedBasis(rowFor(md, f.id), 2)).toEqual(f.basis);
    }
  });

  test('html (the artifact the run wrote): seat headers and a seat-placed star, with NO edit to report-html.js', () => {
    expect(html).toContain('<th>gemini#1</th><th>gemini#2</th><th>Tier</th>');
    const a1 = html.match(/<tr[^>]*><td>A1<\/td>.*?<\/tr>/)[0];
    expect(a1).toContain('<td>gemini#1</td>');
    expect(a1).toContain('<td class="c">✓<sup>*</sup></td><td class="c">✗</td>');
    const b1 = html.match(/<tr[^>]*><td>B1<\/td>.*?<\/tr>/)[0];
    expect(b1).toContain('<td class="c">✓</td><td class="c">✓<sup>*</sup></td>');
  });

  test('workspace: the same run\'s tally.json produces one cell per seat, isRaiser on the raiser seat only', () => {
    const m = buildMatrixModel(tallyDoc, runDoc.labelMap, verdict);
    // NON-BLIND identity is the seat id; the blind LABEL is resolved from the
    // seat's ALIAS (both twins collapse to 'Review A', exactly as at HEAD) —
    // T19's pairFor(seat.id) mutant would leave every label null and leak.
    expect(m.judges.map(j => j.model)).toEqual(['gemini#1', 'gemini#2']);
    expect(m.judges.map(j => j.label)).toEqual(['Review A', 'Review A']);
    const a1 = m.rows.find(r => r.id === 'A1');
    expect(a1.raiser).toEqual({ model: 'gemini#1', label: 'Review A' });
    expect(a1.cells.map(c => c.verdict)).toEqual(['agree', 'dispute']);
    expect(a1.cells.map(c => c.isRaiser)).toEqual([true, false]);
    const b1 = m.rows.find(r => r.id === 'B1');
    expect(b1.raiser).toEqual({ model: 'gemini#2', label: 'Review A' });
    expect(b1.cells.map(c => c.verdict)).toEqual(['agree', 'agree']);
    expect(b1.cells.map(c => c.isRaiser)).toEqual([false, true]);
  });
});

// ---------------------------------------------------------------------------
// T20/T21/T22 + the malformed table — shapes an engine run cannot produce.
// ---------------------------------------------------------------------------

const SEATS_UNIQUE = [
  { id: 'gemini', alias: 'gemini', role: 'seat', lens: null, position: 1 },
  { id: 'gpt', alias: 'gpt', role: 'seat', lens: null, position: 2 },
];
const SEATS_TWIN = [
  { id: 'gemini#1', alias: 'gemini', role: 'seat', lens: null, position: 1 },
  { id: 'gemini#2', alias: 'gemini', role: 'seat', lens: null, position: 2 },
];

function claudeInput(seats) {
  return {
    meta: {
      runId: 'claude-council', runType: 'headless', date: '2026-07-20',
      models: ['gemini', 'gpt', 'claude'], chair: 'deepseek', claudeInCouncil: true,
      ...(seats ? { seats } : {}),
    },
    findings: [
      { id: 'A1', raiser: 'gemini', severity: 'high' },
      { id: 'D1', raiser: 'claude', severity: 'medium' },
    ],
    adjudications: [
      { findingId: 'A1', judge: 'gemini', verdict: 'agree' },
      { findingId: 'A1', judge: 'gpt', verdict: 'agree' },
      { findingId: 'D1', judge: 'gemini', verdict: 'dispute' },
      { findingId: 'D1', judge: 'gpt', verdict: 'agree' },
    ],
    rankings: [
      { judge: 'gemini', order: ['gpt', 'claude'] },
      { judge: 'gpt', order: ['claude', 'gemini'] },
    ],
    runStats: [
      { model: 'gemini', role: 'seat', wasChair: false, conformance: 'clean', status: 'complete', durationMs: 1000, usage: { cost: 0.01 } },
      { model: 'gpt', role: 'seat', wasChair: false, conformance: 'clean', status: 'complete', durationMs: 1200, usage: { cost: 0.02 } },
      { model: 'claude', role: 'claude', wasChair: false, conformance: 'clean', status: 'complete', durationMs: null, usage: null },
    ],
  };
}

describe('T20: a unique-alias bench renders identically WITH and WITHOUT a seats table', () => {
  const withSeats = tally(claudeInput(SEATS_UNIQUE));
  const without = tally(claudeInput(null));
  const vWith = buildVerdict(withSeats, []);
  const vWithout = buildVerdict(without, []);

  test('the defensive case is real: the table is present and the ids equal their aliases', () => {
    expect(vWith.seats).toEqual(SEATS_UNIQUE);
    expect('seats' in vWithout).toBe(false);
  });

  test('report markdown and html are byte-identical either way', () => {
    expect(buildReport({ verdict: vWith }, { format: 'md' }))
      .toBe(buildReport({ verdict: vWithout }, { format: 'md' }));
    expect(buildReport({ verdict: vWith }, { format: 'html' }))
      .toBe(buildReport({ verdict: vWithout }, { format: 'html' }));
  });

  test('the workspace model is identical too — the claude column is NOT deleted', () => {
    const map = { 'Review A': 'gemini', 'Review B': 'gpt', 'Review D': 'claude' };
    const mWith = buildMatrixModel(withSeats, map, vWith);
    const mWithout = buildMatrixModel(without, map, vWithout);
    // seats[] is bench-only (seats.js excludes claude) while tally.meta.models
    // carries the reserved claude seat and the workspace — unlike report.js —
    // does NOT filter it. Without the re-append the column silently vanishes.
    expect(mWith.judges.map(j => j.model)).toEqual(['gemini', 'gpt', 'claude']);
    expect(mWith).toEqual(mWithout);
  });
});

describe('T21: a PR3-shaped twin verdict (adjudications[].seat, NO seats table) renders as HEAD', () => {
  // Exactly what PR3/PR4a/PR4b wrote to disk: seat-keyed votes, seat-keyed
  // raiser, and no roster to resolve them against. Independent fallbacks for
  // the roster and the vote key make every cell blank here.
  const input = {
    meta: { runId: 'pr3-twin', runType: 'headless', date: '2026-07-20',
      models: ['gemini', 'gemini'], chair: 'deepseek', claudeInCouncil: false },
    findings: [{ id: 'A1', raiser: 'gemini', severity: 'major', raiserSeat: 'gemini#1' }],
    adjudications: [
      { findingId: 'A1', judge: 'gemini', verdict: 'agree', seat: 'gemini#1' },
      { findingId: 'A1', judge: 'gemini', verdict: 'dispute', seat: 'gemini#2' },
    ],
    rankings: [{ judge: 'gemini', order: ['gemini'] }],
    runStats: [],
  };
  const record = tally(input);
  const verdict = buildVerdict(record, []);

  test('the fixture is genuinely PR3-shaped', () => {
    expect('seats' in verdict).toBe(false);
    expect(verdict.findings[0].raiserSeat).toBe('gemini#1');
    expect(verdict.findings[0].adjudications.map(a => a.seat)).toEqual(['gemini#1', 'gemini#2']);
  });

  test('markdown falls all the way back to alias space — columns, votes AND raiser', () => {
    const md = buildReport({ verdict }, { format: 'md' });
    expect(headerFor(md)).toBe('| Finding | Sev | Raiser | gemini | gemini | Tier | Decision |');
    // The alias last-wins collapse this PR fixes on SEATED documents is still
    // exactly what a seat-table-less document renders: unchanged, not improved.
    expect(rowFor(md, 'A1')).toBe('| A1 | major | gemini | ✗* | ✗* | Contested |  |');
  });

  test('the workspace model falls back the same way', () => {
    const m = buildMatrixModel(record, { 'Review A': 'gemini' }, verdict);
    expect(m.judges.map(j => j.model)).toEqual(['gemini', 'gemini']);
    expect(m.rows[0].raiser).toEqual({ model: 'gemini', label: 'Review A' });
    expect(m.rows[0].cells.map(c => c.verdict)).toEqual(['dispute', 'dispute']);
    expect(m.rows[0].cells.map(c => c.isRaiser)).toEqual([true, true]);
  });
});

describe('T22: the two orphaned-seat shapes (§4.6)', () => {
  // Shape 1 — a JUDGE's Stage-2 seat orphaned. The raiser is a unique alias, so
  // `raiserSeat` is absent and tally's guard is a pure alias compare: BOTH twin
  // votes count in `basis`, but the seat-less one keys to the bare alias
  // `gemini`, which names no seat column. Until v4.8 T-C1 that vote was counted
  // and rendered nowhere; the report now folds it into an UNATTRIBUTED column.
  const orphanJudge = {
    meta: { runId: 'orphan-judge', runType: 'headless', date: '2026-07-20',
      models: ['gemini', 'gemini', 'gpt'], chair: 'deepseek', claudeInCouncil: false,
      seats: SEATS_TWIN.concat([{ id: 'gpt', alias: 'gpt', role: 'seat', lens: null, position: 3 }]) },
    findings: [{ id: 'A1', raiser: 'gpt', severity: 'major' }],
    adjudications: [
      { findingId: 'A1', judge: 'gemini', verdict: 'agree', seat: 'gemini#1' },
      { findingId: 'A1', judge: 'gemini', verdict: 'dispute' }, // seat orphaned
    ],
    rankings: [{ judge: 'gemini', order: ['gpt'] }],
    runStats: [],
  };

  test('shape 1 (judge seat orphaned): the report folds the vote into UNATTRIBUTED and the row agrees with basis', () => {
    const record = tally(orphanJudge);
    const verdict = buildVerdict(record, []);
    const md = buildReport({ verdict }, { format: 'md' });
    expect(headerFor(md)).toBe('| Finding | Sev | Raiser | gemini#1 | gemini#2 | gpt | UNATTRIBUTED | Tier | Decision |');
    expect(rowFor(md, 'A1')).toBe('| A1 | major | gpt | ✓ |   |  * | ✗ | Contested |  |');
    // v4.8 T-C1 (SI-12, ruling R18) REPLACED this block. It used to assert the
    // divergence — basis 1a/1d against a row showing 1a/0d — and its own comment
    // said a future fix must edit it deliberately. This is that edit: `basis` is
    // untouched and the row now recomputes to the SAME counts, which is the
    // property renderedBasis() was written for.
    expect(verdict.findings[0].basis).toEqual({ a: 1, d: 1, n: 0 });
    expect(renderedBasis(rowFor(md, 'A1'), 4)).toEqual(verdict.findings[0].basis);
    // ⚠️ The workspace model is UNCHANGED here, and this line says so rather
    // than reading as if both consumers moved: ruling R17 gives matrix-model.js
    // the same rule as a SECOND implementation in its own task, not a shared
    // module, so report.js and matrix-model.js diverge on this document today.
    const m = buildMatrixModel(record, {}, verdict);
    expect(m.rows[0].cells.map(c => c.verdict)).toEqual(['agree', null, null]);
  });

  // Shape 2 — the RAISER's Stage-1 seat orphaned on a twin bench. meta.seats is
  // independent of binding, so the table still ships; `raiserSeat` does not.
  // The raiser cell then names no column and the star disappears.
  const orphanRaiser = {
    meta: { runId: 'orphan-raiser', runType: 'headless', date: '2026-07-20',
      models: ['gemini', 'gemini'], chair: 'deepseek', claudeInCouncil: false, seats: SEATS_TWIN },
    findings: [{ id: 'A1', raiser: 'gemini', severity: 'major' }], // no raiserSeat
    adjudications: [
      { findingId: 'A1', judge: 'gemini', verdict: 'agree', seat: 'gemini#1' },
      { findingId: 'A1', judge: 'gemini', verdict: 'agree', seat: 'gemini#2' },
    ],
    rankings: [{ judge: 'gemini', order: ['gemini'] }],
    runStats: [],
  };

  test('shape 2 (raiser seat orphaned): the star disappears and the Raiser cell names no column', () => {
    const record = tally(orphanRaiser);
    const verdict = buildVerdict(record, []);
    const md = buildReport({ verdict }, { format: 'md' });
    expect(headerFor(md)).toBe('| Finding | Sev | Raiser | gemini#1 | gemini#2 | Tier | Decision |');
    expect(rowFor(md, 'A1')).toBe('| A1 | major | gemini | ✓ | ✓ | Singleton |  |');
    const m = buildMatrixModel(record, {}, verdict);
    expect(m.rows[0].raiser).toEqual({ model: 'gemini', label: null });
    expect(m.rows[0].cells.map(c => c.isRaiser)).toEqual([false, false]);
  });
});

// ---------------------------------------------------------------------------
// SI-12 (v4.8 T-C1) — the join refuses a key that identifies nothing.
// ---------------------------------------------------------------------------

/**
 * `toModel` used to key every vote on `(seatSpace && adj.seat) || adj.judge`
 * and write it into `byJudge` whatever came out. Six key shapes were measured
 * at c8867b48 landing as a key no column reads: an orphaned seat id, `''` and
 * an absent `judge` in either space (the absent one arriving as the STRING
 * `"undefined"`, a JS coercion artifact), and a non-string judge.
 *
 * Ruling R18: everything the join refuses folds into ONE `UNATTRIBUTED`
 * column, and `basis` does not move. Ruling R17: `src/workspace/matrix-model.js`
 * gets the same rule as a separate implementation in its own task — no shared
 * module — so nothing in THIS block asserts anything about that file.
 *
 * NAMED MUTANTS on `src/council/report.js :: toModel`. The protocol for each:
 * applied by hand, run against the FULL suite, reverted by hand, byte-verified
 * with `git show HEAD:src/council/report.js`, never shipped — and measured LAST,
 * after every other edit, so a recorded set describes the tree that ships.
 *
 * ⚠️ RE-RUN, NEVER RENUMBER. A recorded red set ASSERTS that the set still
 * holds; editing the number instead of re-running the mutant is the defect the
 * peer-split records were rewritten twice to remove. Re-take the denominator
 * with it.
 *
 * Named mutant "ALWAYSCOL": drop the `folded &&` conditional so the roster
 * always ends in `UNATTRIBUTED`, i.e. emit the column whether or not any vote
 * routed to it. It is the "byte-unchanged artifact" mutant — every report that
 * has no unattributable vote grows a column.
 * MEASURED red set, run against 774dcdc2:
 * 3 suites / 24 tests + 4 SNAPSHOTS, out of 541 / 7686. By suite:
 *   seat-matrix 13 · report-claude-column 9 · report-debate 2.
 * The four snapshot failures ARE the contract this conditional exists for: both
 * pinned byte-unchanged report snapshots (report-claude-column's no-flag run and
 * report-debate's v4.0 baseline) fail in both formats. Of this block's own pins
 * it reds exactly ONE — the no-unattributable-vote pin — which is the division
 * of labour with JUNKKEY below, measured rather than assumed.
 *
 * Named mutant "JUNKKEY": revert the join to c8867b48's bare
 * `byJudge[(seatSpace && adj.seat) || adj.judge]`, leaving the roster code in
 * place. It is the "T-C1 never happened" mutant for the refusal half.
 * MEASURED red set, run against 774dcdc2:
 * 1 suite / 11 tests, out of 541 / 7686. By suite: seat-matrix 11.
 * Those 11 are every refusal pin in this block plus T22 shape 1 above, and they
 * are the same 11 that were RED before the fix was written (one has since been
 * retitled and had an assertion strengthened). Two pins stay GREEN
 * under it and that is not a weakness: the no-unattributable-vote pin is
 * ALWAYSCOL's, and the `basis` pin is a preservation pin that NEITHER mutant
 * moves — `basis` is copied by reference on every path, which is the point.
 */
describe('SI-12 (R17/R18): a vote whose key identifies no column folds into ONE UNATTRIBUTED column', () => {
  const SEATS = [
    { id: 'deepseek#1', alias: 'deepseek', role: 'seat', lens: null, position: 1 },
    { id: 'gpt', alias: 'gpt', role: 'seat', lens: null, position: 2 },
  ];
  const SEAT_COLS = ['deepseek#1', 'gpt'];
  const ALIAS_COLS = ['deepseek', 'gpt'];
  /** The one vote every fixture below carries whose key DOES name a column. */
  const SEATED = { judge: 'deepseek', verdict: 'agree', seat: 'deepseek#1' };

  /**
   * A hand-built verdict, driven straight at `toModel`. The classes below
   * differ only in a key the join reads, so routing them through
   * tally/buildVerdict would mix producer behaviour into a pin about the
   * consumer. The orphaned-seat class, which a real run DOES produce, is driven
   * end to end through tally + buildVerdict by T22 shape 1 above.
   */
  function verdictOf(seats, adjudications) {
    return {
      runId: 'si12', runType: 'headless', date: '2026-07-20',
      chair: 'deepseek', council: ALIAS_COLS.slice(), claudeInCouncil: false,
      ...(seats ? { seats } : {}),
      findings: [{ id: 'F1', raiser: 'gpt', severity: 'major', tier: 'Contested',
        basis: { a: 1, d: 1, n: 0 }, adjudications }],
      streetCred: [], runStats: [],
      tierCounts: { Confirmed: 0, Contested: 1, Singleton: 0, Disputed: 0 },
    };
  }

  // One row per refusal class — a string naming no column, the empty string, an
  // absent key, a non-string — with the two that can arrive through EITHER field
  // driven in both spaces, since `seatSpace` decides which field the join reads.
  // Each row's trailing comment is the junk key that shape produced at
  // c8867b48, measured by probe rather than inferred.
  for (const [name, seats, cols, adj] of [
    ['seat space · an ORPHANED seat id', SEATS, SEAT_COLS,           // was "deepseek#9"
      { judge: 'deepseek', verdict: 'dispute', seat: 'deepseek#9' }],
    ['seat space · seat falsy, judge is the empty string', SEATS, SEAT_COLS,   // was ""
      { judge: '', verdict: 'dispute', seat: '' }],
    ['seat space · seat falsy, judge absent', SEATS, SEAT_COLS,      // was "undefined"
      { verdict: 'dispute', seat: null }],
    ['alias space · judge is the empty string', null, ALIAS_COLS,    // was ""
      { judge: '', verdict: 'dispute' }],
    ['alias space · judge absent', null, ALIAS_COLS,                 // was "undefined"
      { verdict: 'dispute' }],
    ['alias space · judge is not a string', null, ALIAS_COLS,        // was "42"
      { judge: 42, verdict: 'dispute' }],
  ]) {
    test(`${name}: the vote lands in UNATTRIBUTED and no junk key survives`, () => {
      const m = toModel(verdictOf(seats, [SEATED, adj]));
      expect(m.judges).toEqual(cols.concat('UNATTRIBUTED'));
      const { byJudge } = m.findings[0];
      // The whole key set, not a spot check: `""` and `"undefined"` are absent
      // because the join can only write a key the roster already seeded.
      expect(Object.keys(byJudge)).toEqual(cols.concat('UNATTRIBUTED'));
      expect(byJudge.UNATTRIBUTED).toBe('dispute');
      // Class 1 is untouched: the identifying vote still keys to its own column.
      expect(byJudge[cols[0]]).toBe('agree');
    });
  }

  test('a document with NO unattributable vote grows no UNATTRIBUTED column, in either space or format', () => {
    for (const [seats, cols] of [[SEATS, SEAT_COLS], [null, ALIAS_COLS]]) {
      const verdict = verdictOf(seats, [SEATED,
        { judge: 'gpt', verdict: 'agree', ...(seats ? { seat: 'gpt' } : {}) }]);
      const m = toModel(verdict);
      expect(m.judges).toEqual(cols);
      expect(Object.keys(m.findings[0].byJudge)).toEqual(cols);
      expect(buildReport({ verdict }, { format: 'md' })).not.toContain('UNATTRIBUTED');
      expect(buildReport({ verdict }, { format: 'html' })).not.toContain('UNATTRIBUTED');
    }
  });

  test('the folded vote reaches BOTH rendered formats', () => {
    // No renderer needed an edit for this and none received one: report-md.js
    // and report-html.js each iterate `m.judges` and read `f.byJudge[j]`, so a
    // roster entry IS a column and the model alone decides both documents.
    const verdict = verdictOf(SEATS, [SEATED,
      { judge: 'deepseek', verdict: 'dispute', seat: 'deepseek#9' }]);
    const md = buildReport({ verdict }, { format: 'md' });
    expect(headerFor(md)).toBe('| Finding | Sev | Raiser | deepseek#1 | gpt | UNATTRIBUTED | Tier | Decision |');
    expect(rowFor(md, 'F1')).toBe('| F1 | major | gpt | ✓ |  * | ✗ | Contested |  |');
    const html = buildReport({ verdict }, { format: 'html' });
    expect(html).toContain('<th>UNATTRIBUTED</th>');
    // The whole cell run, in roster order, so the ✗ is pinned to the THIRD
    // column rather than to "somewhere in the document".
    expect(html).toContain(`<td class="c">${SYMBOL.agree}</td>`
      + '<td class="c"><sup>*</sup></td>'
      + `<td class="c">${SYMBOL.dispute}</td>`);
  });

  test('`basis` does not move: the model passes the verdict\'s own object through', () => {
    const verdict = verdictOf(SEATS, [SEATED,
      { judge: 'deepseek', verdict: 'dispute', seat: 'deepseek#9' }]);
    const m = toModel(verdict);
    // Reference identity, not deep equality: it pins that nothing recomputed
    // basis from the folded column. R3 keeps the vote counted where it was.
    expect(m.findings[0].basis).toBe(verdict.findings[0].basis);
    expect(m.findings[0].basis).toEqual({ a: 1, d: 1, n: 0 });
  });

  test('two unattributable votes on ONE finding collapse into ONE cell — LAST WINS (measured)', () => {
    const m = toModel(verdictOf(SEATS, [
      { judge: 'deepseek', verdict: 'agree', seat: 'deepseek#9' },
      { judge: 'deepseek', verdict: 'dispute', seat: 'deepseek#7' },
    ]));
    expect(m.judges).toEqual(SEAT_COLS.concat('UNATTRIBUTED'));
    // R18 folds both into one column, so the second write overwrites the first
    // exactly as two votes on any other shared key always have. What the row
    // shows is the LAST vote; the first is shown nowhere. Measured, and pinned
    // as measured rather than claimed to be more.
    expect(m.findings[0].byJudge.UNATTRIBUTED).toBe('dispute');
  });

  test('the roster is COPIED, never appended in place: the verdict\'s own council array is untouched', () => {
    const council = ALIAS_COLS.slice();
    const verdict = { ...verdictOf(null, [{ judge: 'nobody', verdict: 'dispute' }]), council };
    const m = toModel(verdict);
    expect(m.judges).toEqual(ALIAS_COLS.concat('UNATTRIBUTED'));
    // ⚠️ In alias space with `claudeInCouncil !== true`, the roster IS
    // `verdict.council` BY REFERENCE — measured at c8867b48, where
    // `toModel(v).judges === v.council` reads true. A `push` would therefore
    // write UNATTRIBUTED into the caller's own document and into `header.council`,
    // which both renderers print on the meta line as `council: …`.
    expect(council).toEqual(ALIAS_COLS);
    expect(m.header.council).toEqual(ALIAS_COLS);
  });

  test('a bench model literally aliased UNATTRIBUTED is not columned twice', () => {
    const verdict = { ...verdictOf(null, [{ judge: 'nobody', verdict: 'dispute' }]),
      council: ['UNATTRIBUTED', 'gpt'] };
    const m = toModel(verdict);
    // DISCLOSED, not fixed: the label is also the map key, so that model's
    // column and the folded vote share one cell. The roster keeps ONE entry
    // (R18) instead of rendering the same key under two identical headers.
    expect(m.judges).toEqual(['UNATTRIBUTED', 'gpt']);
    expect(m.findings[0].byJudge.UNATTRIBUTED).toBe('dispute');
  });
});

describe('a malformed seats table falls back to alias space instead of throwing', () => {
  // Every shape below is reachable: the three schema-free JSON.parse entry
  // points (cli-handlers-council.js's tally/report/verdict handlers) and
  // R4c-5's deliberately permissive `z.array(z.any())` on the MCP tally path,
  // which §3.3 chose PRECISELY so that `seats: ["deepseek#1","deepseek#2"]`,
  // `[null,{…}]` and `[42]` are all accepted rather than forked. Under §3.6's
  // literal flag the null element makes `.map(s => s.id)` THROW where HEAD
  // renders, and the bare strings yield a roster of `undefined` columns.
  const base = {
    meta: { runId: 'malformed', runType: 'headless', date: '2026-07-20',
      models: ['gemini', 'gpt'], chair: 'deepseek', claudeInCouncil: false },
    findings: [{ id: 'A1', raiser: 'gemini', severity: 'major' }],
    adjudications: [{ findingId: 'A1', judge: 'gpt', verdict: 'agree' }],
    rankings: [{ judge: 'gpt', order: ['gemini'] }],
    runStats: [],
  };
  const clean = buildVerdict(tally(base), []);
  const cleanMd = buildReport({ verdict: clean }, { format: 'md' });

  for (const [name, seats] of [
    ['an empty table', []],
    ['a non-array', {}],
    ['a null element', [null, SEATS_UNIQUE[1]]],
    ['bare id strings', ['gemini', 'gpt']],
  ]) {
    test(`${name} renders exactly as a document with no table at all`, () => {
      const input = { ...base, meta: { ...base.meta, seats } };
      const record = tally(input);
      const verdict = buildVerdict(record, []);
      expect(buildReport({ verdict }, { format: 'md' })).toBe(cleanMd);
      expect(buildMatrixModel(record, {}, verdict).judges.map(j => j.model))
        .toEqual(['gemini', 'gpt']);
    });
  }
});

// ---------------------------------------------------------------------------
// Council A3/B1 — the seat-space decision has ONE source, and this is its guard.
// ---------------------------------------------------------------------------

/**
 * `report.js` and `matrix-model.js` used to compute the flag with two
 * VERBATIM-IDENTICAL expressions. Two models raised it independently: editing
 * one site alone yields two renderers that disagree about which space a
 * document is in — the exact class §3.6 exists to remove.
 *
 * ⚠️ This is NOT `ledger.js:61-69`'s documented-copy situation. That copy is
 * paid for because `ledger.js` requires only fs/path/utils-config while its
 * sibling pulls findings → anonymize → seats. MEASURED here instead: a fresh
 * `require('src/workspace/matrix-model')` already loads four first-party
 * modules (v4.8 Phase 1 T1.2 moved renderMd's own pricing/format-duration/
 * degrade requires out to report-md.js, which this path never reaches —
 * report-md is required lazily from inside buildReport, not at module load,
 * so the count fell from six to four) and `src/council/report.js` is one of
 * them — matrix-model has imported SYMBOL from it since v4.4, for this very
 * "single source" reason.
 * Sharing therefore costs ZERO new require edges, so the copy bought nothing
 * and `isSeatSpace` is exported and shared.
 *
 * The table below drives BOTH renderers over every shape the three
 * schema-free JSON.parse entry points and R4c-5's permissive zod can deliver,
 * and pins each against the exported predicate's own answer — so a renderer
 * that drifted from `isSeatSpace` fails here even though it can no longer
 * drift from its sibling. Named mutants, both measured RED: deleting the
 * `.every(...)` conjunct, and re-splitting the predicate back into two copies
 * and editing only `matrix-model.js`'s.
 */
describe('ONE shared predicate decides seat space for BOTH renderers (council A3/B1)', () => {
  /** A twin bench: alias space and seat space render observably DIFFERENT rosters. */
  function twinInput(seats) {
    return {
      meta: {
        runId: 'shared-predicate', runType: 'headless', date: '2026-07-20',
        models: ['gemini', 'gemini'], chair: 'deepseek', claudeInCouncil: false,
        ...(seats === undefined ? {} : { seats }),
      },
      findings: [{ id: 'A1', raiser: 'gemini', severity: 'major', raiserSeat: 'gemini#1' }],
      adjudications: [
        { findingId: 'A1', judge: 'gemini', verdict: 'agree', seat: 'gemini#1' },
        { findingId: 'A1', judge: 'gemini', verdict: 'dispute', seat: 'gemini#2' },
      ],
      rankings: [{ judge: 'gemini', order: ['gemini'] }],
      runStats: [],
    };
  }
  /** The judge columns the MARKDOWN report actually renders, from its header row. */
  function reportJudges(verdict) {
    return headerFor(buildReport({ verdict }, { format: 'md' }))
      .split('|').slice(1, -1).map(s => s.trim())
      .slice(3, -2);   // drop Finding/Sev/Raiser and Tier/Decision
  }
  const workspaceJudges = (record, verdict) =>
    buildMatrixModel(record, {}, verdict).judges.map(j => j.model);

  const ALIAS = ['gemini', 'gemini'];
  const SEAT = ['gemini#1', 'gemini#2'];
  // Well-formed but ID-LESS: the shape a `{alias, role, lens, position}` row
  // takes if a producer ever emits the table without seats.js's `id`.
  const NO_ID = SEATS_TWIN.map(({ id: _id, ...rest }) => rest);

  for (const [name, seats, expected] of [
    ['absent', undefined, ALIAS],
    ['null — the `|| null` idiom R4c-5 accepts on both paths', null, ALIAS],
    ['an empty table', [], ALIAS],
    ['a non-array', {}, ALIAS],
    ['a null element', [null, SEATS_TWIN[1]], ALIAS],
    ['bare id strings', ['gemini#1', 'gemini#2'], ALIAS],
    ['elements carrying an alias but NO id', NO_ID, ALIAS],
    ['a well-formed twin table', SEATS_TWIN, SEAT],
  ]) {
    test(`${name}: both renderers land in the same space`, () => {
      const record = tally(twinInput(seats));
      const verdict = buildVerdict(record, []);
      // Not "the two agree with each other" — each is pinned to the SHARED
      // predicate's answer, and to the roster that answer implies.
      expect(isSeatSpace(seats)).toBe(expected === SEAT);
      expect(reportJudges(verdict)).toEqual(expected);
      expect(workspaceJudges(record, verdict)).toEqual(expected);
    });
  }

  test('a well-formed table on a UNIQUE-alias bench: seat space on both, and invisible', () => {
    // The ninth shape. Seat ids EQUAL their aliases here, so the rosters are
    // byte-identical to the no-table document even though the predicate says
    // seat space — a renderer that gated on "is there a table" instead of the
    // shared predicate would still pass; one that fell back to alias space
    // for the wrong reason would still pass too. Hence the isSeatSpace pins.
    const rWith = tally(claudeInput(SEATS_UNIQUE));
    const rNone = tally(claudeInput(null));
    const vWith = buildVerdict(rWith, []);
    const vNone = buildVerdict(rNone, []);
    expect(isSeatSpace(vWith.seats)).toBe(true);
    expect(isSeatSpace(vNone.seats)).toBe(false);
    expect(reportJudges(vWith)).toEqual(reportJudges(vNone));
    expect(workspaceJudges(rWith, vWith)).toEqual(workspaceJudges(rNone, vNone));
  });
});
