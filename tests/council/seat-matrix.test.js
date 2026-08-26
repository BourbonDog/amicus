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
    // ⚠️ v4.8 SI-22.4's rider (R22.4-6) UPDATES THIS PIN DELIBERATELY. This line
    // used to assert the street-cred ROW was alias-keyed. Both renderers now
    // label it `s.seat || s.model`: `street-cred.js :: computeStreetCred` emits
    // one row PER SEAT, so the alias key printed two rows under one identical
    // name — here, two `| gemini |` rows — with nothing to say which seat each
    // belonged to. The Cost table above was already seat-keyed, so the whole
    // document now agrees. `council` on the meta line did NOT move: the
    // street-cred UNIVERSE is still the alias list, and only the row LABEL is a
    // seat — which is why both assertions stand together here.
    // Pinned per renderer in tests/council/report-cred-seat.test.js.
    expect(md).toContain('| gemini#1 | 1.00 | 1.50 |');
    expect(md).toContain('| gemini#2 | 1.00 | 1.50 |');
    expect(md).not.toMatch(/^\| gemini \| /m);
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
  // and rendered nowhere; the report folds it into an UNATTRIBUTED column, and
  // since T-C2 so does the workspace matrix — separately, under ruling R17.
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
    // v4.8 T-C1 (SI-22.5, ruling R18) REPLACED this block. It used to assert the
    // divergence — basis 1a/1d against a row showing 1a/0d — and its own comment
    // said a future fix must edit it deliberately. This is that edit: `basis` is
    // untouched and the row now recomputes to the SAME counts, which is the
    // property renderedBasis() was written for.
    expect(verdict.findings[0].basis).toEqual({ a: 1, d: 1, n: 0 });
    expect(renderedBasis(rowFor(md, 'A1'), 4)).toEqual(verdict.findings[0].basis);
    // v4.8 T-C2 closed the matrix-model side, so BOTH consumers now move on this
    // document. Read out of 32a63e92, the line that stood here said the workspace
    // model was "UNCHANGED", that ruling R17 gives matrix-model.js the same rule
    // "as a SECOND implementation in its own task", and that the two files
    // "diverge on this document today". It named NO task — `T-C2` appears nowhere
    // in src/, tests/ or electron/ at that commit — so what is closed here is the
    // deferral it described, not a promise it made.
    // The columns ARE the report's judge columns above, in order, and the
    // seat-less vote takes the same fourth one.
    const m = buildMatrixModel(record, {}, verdict);
    expect(m.judges.map(j => j.model)).toEqual(['gemini#1', 'gemini#2', 'gpt', 'UNATTRIBUTED']);
    expect(m.rows[0].cells.map(c => c.verdict)).toEqual(['agree', null, null, 'dispute']);
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
// SI-22.5 (v4.8 T-C1) — the join refuses a key that identifies nothing.
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
 * ⚠️ EVERY NUMBER BELOW WAS RE-RUN AT v4.8 T2.4 FIX ROUND 1, AGAINST THE TREE
 * THAT SHIPS. The previous sets were measured at d82e2127 and committed at
 * 32a63e92 — and then this file changed EIGHT more times (09212e97, 70481ccf,
 * fa0c5ae7, bd83c2ef, 3a7dde42, 0814624c, e5376399, 0cb2d4d9), adding the whole
 * T-C2 workspace block, the fuzz block and the R20 block. The T-C1 records were
 * never re-run, so the docblock asserted a measurement that no longer
 * reproduced: exactly the defect this banner exists to prevent, committed
 * inside the banner. Every superseded number was DELETED, not edited, and the
 * denominator was re-taken with them.
 *
 * ⚠️ WHAT CHANGED AND WHY, so the growth is accounted for rather than absorbed:
 * the denominator moved 7691 -> 7719 because T-C2 and this round added tests,
 * and three of the four red sets GREW because the pins T-C2 added to detect a
 * report.js/matrix-model.js desync are, by construction, red under a report.js
 * mutation. No set shrank; nothing became unpinned.
 * (Comments — and, in fix round 2, one test TITLE — were edited after these runs.
 * No test was added or removed and no assertion changed, so the denominator and
 * every set below still describe this tree. The one title that moved is in the
 * R20 block and is not named by any record here; `R20 > report.js FOLDS it`,
 * which JUNKKEY's record DOES name, is unchanged.)
 *
 *
 * ⚠️ EVERY NUMBER BELOW WAS RE-RUN AT v4.8 T-C4, AGAINST THE TREE THAT SHIPS.
 * T-C4 changed what `report.js :: adjOf` accepts and added twelve pins plus
 * sixty fuzz cases, so every set recorded against a515400c was invalid. They
 * were DELETED and re-measured, never edited, and the denominator was re-taken
 * with them (7719 / 7715 -> 7731).
 *
 * ⚠️ WHAT THE T-C4 PINS DO TO THESE SETS, so the growth is accounted for rather
 * than absorbed: the block splits cleanly in two, and MEASUREMENT put it there.
 * Its five FALSY-element pins red under the three column-EMISSION mutants
 * (ALWAYSCOL, WSALWAYSCOL, ELEMKEEP); its five TRUTHY-element agreement pins red
 * under the two ROUTING mutants (JUNKKEY, WSJUNKKEY), which is the evidence that
 * those preservation pins are real pins and not decoration.
 *
 * Named mutant "ALWAYSCOL": drop the `folded &&` conditional so the roster
 * always ends in `UNATTRIBUTED`, i.e. emit the column whether or not any vote
 * routed to it. It is the "byte-unchanged artifact" mutant — every report that
 * has no unattributable vote grows a column.
 * MEASURED red set, RE-RUN against 32609ac8 (T-C4):
 * 3 suites / 34 tests + 4 SNAPSHOTS, out of 541 / 7731. By suite:
 *   seat-matrix 23 · report-claude-column 9 · report-debate 2.
 * The four snapshot failures ARE the contract this conditional exists for: both
 * pinned byte-unchanged report snapshots (report-claude-column's no-flag run and
 * report-debate's v4.0 baseline) fail in both formats.
 * ⚠️ Of THIS block's own pins it reds FOUR — re-derived, not carried: the
 * no-unattributable-vote pin plus the three malformed-`adjudications` pins,
 * which assert that such a document keeps the bench roster EXACTLY. The
 * seat-matrix total of 23 is those 4, plus SIX in the T-C4 block (all five
 * falsy-element pins and the rendered-header pin — T-C4's gain, and the reason
 * this set moved 17 -> 23), plus 8 in the A3/B1 table, 2 in T17/T18, 1 in T21,
 * 1 in T22 and 1 fuzz pin.
 *
 * Named mutant "JUNKKEY": revert the join to c8867b48's bare
 * `byJudge[(seatSpace && adj.seat) || adj.judge]`, leaving the roster code in
 * place. It is the "T-C1 never happened" mutant for the refusal half.
 * MEASURED red set, RE-RUN against 32609ac8 (T-C4):
 * 1 suite / 21 tests, out of 541 / 7731. By suite: seat-matrix 21 — 12 of this
 * block's own pins, 5 in the T-C4 block, 1 in the workspace block (its
 * BOTH-CONSUMERS agreement pin), 1 fuzz pin, 1 in T22, and 1 in the R20 block.
 * ⚠️ THE FIVE T-C4 REDS ARE ITS TRUTHY-ELEMENT PINS, NOT ITS FALSY ONES, and
 * that is worth reading rather than counting. Those five assert only that the two
 * consumers fold `42`/`'x'`/`true`/`[]`/`{}` the SAME WAY — a property green
 * before T-C4 as well as after. Under this mutation report.js routes such an
 * element to the junk key `undefined` and grows no column while matrix-model
 * still grows one, so the agreement breaks and the pins fire. A preservation pin
 * that reds under a named mutant is a pin; this measurement is what makes them so.
 * ⚠️ THE R20 RED IS WORTH READING. `R20 > report.js FOLDS it` goes red because
 * under the bare join a `judge: 'claude'` vote lands in `byJudge['claude']` — a
 * key no column reads — instead of folding. That pin was written to DISCLOSE a
 * divergence, and it independently catches the refusal being removed.
 * Two pins stay GREEN under it and that is not a weakness: the
 * no-unattributable-vote pin is ALWAYSCOL's, and the `basis` pin is a
 * preservation pin that NO mutant here moves — `basis` is copied by reference on
 * every path, which is the point.
 *
 * Named mutant "PERFINDING" (v4.8 T-C1 fix round 1): leave `m.judges` global and
 * move only the `byJudge` SEEDING inside the per-finding map, so each finding is
 * seeded from a roster decided by ITS OWN votes. It is the exact failure the
 * `⚠️ TWO-PHASE` comment on report.js names.
 * MEASURED red set, RE-RUN against 32609ac8 (T-C4):
 * 1 suite / 1 test, out of 541 / 7731 — seat-matrix 1, the multi-finding pin
 * (`the roster decision is GLOBAL, not per finding`).
 * ⚠️ READ THAT NUMBER THE RIGHT WAY. A one-test red set is small because this
 * mutant is INVISIBLE to every other shape, not because the pin is weak: against
 * 3938d64f, where every fixture in this block had exactly ONE finding, the same
 * mutation ran the FULL suite GREEN — 541 suites, 0 failures. One finding cannot
 * tell a global roster from a per-finding one, and the rendered ROW cannot tell
 * them apart even with two, because a missing key and a `null` key both read
 * falsy. The pin asserts `Object.keys` for exactly that reason.
 * ⚠️ It is the ONLY one of the five whose red set has never grown — through
 * T-C1 fix round 1, T-C2 and T-C4, only its denominator moved. Re-run each time,
 * never adjusted: a set that happens to be stable is still an assertion.
 *
 * Named mutant "EMPTYOK" (v4.8 T-C1 fix round 1): drop the `key !== ''` conjunct
 * from `columnFor`, leaving `typeof key === 'string' && columns.has(key)`.
 * MEASURED red set, RE-RUN against 32609ac8 (T-C4):
 * 1 suite / 3 tests, out of 541 / 7731 — seat-matrix 3: this block's `''`-roster
 * pin, the workspace block's `''`-roster BOTH-CONSUMERS pin, and the fuzz block's
 * ZERO-disagreements pin. Unmoved by T-C4, which touched the ELEMENT and not the
 * key: measured, not assumed.
 * ⚠️ IT USED TO READ 1, AND THE PROSE BUILT ON THAT NUMBER WAS WRONG TOO: the
 * old record said "that ONE test is the entire reason the mutant is named". It is
 * three, and the two it gained are both T-C2's cross-consumer pins — which is
 * the more interesting fact, because it means a report.js-only mutation is now
 * caught by the machinery built to prove the two consumers agree.
 * The six class pins are still GREEN against it — measured, they are not in this
 * set — because on their rosters `columns.has('')` is already false, so
 * `columns.has` does the refusing and the conjunct is green against its own
 * mutant. Only a roster that HOLDS `''` separates the two spellings.
 *
 * Named mutant "ELEMKEEP" (v4.8 T-C4): drop `.filter(Boolean)` from
 * `report.js :: adjOf`, so every element is kept whatever it is. It is the
 * "T-C4 never happened" mutant: a falsy element folds again and grows a blank
 * column `matrix-model.js` does not grow, and `null`/`undefined` throw.
 * MEASURED red set, run against 32609ac8 (T-C4):
 * 1 suite / 8 tests, out of 541 / 7731 — seat-matrix 8: all five falsy-element
 * pins, the rendered-header pin, the throw pin, and the fuzz block's
 * ZERO-disagreements pin.
 * ⚠️ The fuzz red is the one that matters, and it is the measurement the old
 * 504-case axis could not make: under this mutation the cross-product reports 60
 * disagreements of 564, every one on the element axis. The eight-test set and the
 * sixty-case set are the same defect counted two ways.
 * ⚠️ Its five TRUTHY-element siblings stay GREEN under it, correctly: this
 * mutation only restores elements the filter drops, and a truthy non-object was
 * never dropped. What still folds them is JUNKKEY.
 */
describe('SI-22.5 (R17/R18): a vote whose key identifies no column folds into ONE UNATTRIBUTED column', () => {
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
      runId: 'unattr', runType: 'headless', date: '2026-07-20',
      chair: 'deepseek', council: ALIAS_COLS.slice(), claudeInCouncil: false,
      ...(seats ? { seats } : {}),
      findings: [{ id: 'F1', raiser: 'gpt', severity: 'major', tier: 'Contested',
        basis: { a: 1, d: 1, n: 0 }, adjudications }],
      streetCred: [], runStats: [],
      tierCounts: { Confirmed: 0, Contested: 1, Singleton: 0, Disputed: 0 },
    };
  }

  /** Two findings on one seated document, where only the SECOND folds a vote. */
  function twoFindings() {
    return {
      runId: 'unattr-multi', runType: 'headless', date: '2026-07-20',
      chair: 'deepseek', council: ALIAS_COLS.slice(), claudeInCouncil: false, seats: SEATS,
      findings: [
        { id: 'F1', raiser: 'gpt', severity: 'major', tier: 'Contested',
          basis: { a: 1, d: 0, n: 0 }, adjudications: [SEATED] },
        { id: 'F2', raiser: 'gpt', severity: 'major', tier: 'Contested',
          basis: { a: 1, d: 1, n: 0 },
          adjudications: [SEATED, { judge: 'deepseek', verdict: 'dispute', seat: 'deepseek#9' }] },
      ],
      streetCred: [], runStats: [],
      tierCounts: { Confirmed: 0, Contested: 2, Singleton: 0, Disputed: 0 },
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
    expect(Object.keys(m.findings[0].byJudge)).toEqual(SEAT_COLS.concat('UNATTRIBUTED'));
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

  test('the roster decision is GLOBAL, not per finding (v4.8 T-C1 fix round 1)', () => {
    const verdict = twoFindings();
    const m = toModel(verdict);
    expect(m.judges).toEqual(SEAT_COLS.concat('UNATTRIBUTED'));
    // ⚠️ THE ONLY SHAPE THAT CAN SEE THE TWO-PHASE INVARIANT. Every other fixture
    // in this block carries exactly ONE finding, and on a one-finding document a
    // global roster and a per-finding one are indistinguishable — measured: the
    // PERFINDING mutant ran the FULL suite green before this pin existed. Both
    // findings must carry the SAME key set, seeded from the FINAL roster.
    expect(Object.keys(m.findings[0].byJudge)).toEqual(Object.keys(m.findings[1].byJudge));
    expect(Object.keys(m.findings[0].byJudge)).toEqual(SEAT_COLS.concat('UNATTRIBUTED'));
    expect(m.findings[0].byJudge.UNATTRIBUTED).toBeNull();
    expect(m.findings[1].byJudge.UNATTRIBUTED).toBe('dispute');
    // ⚠️ The RENDERED rows cannot separate the two: a missing key and a `null` key
    // both read falsy, so both render the same blank cell. Stated because it is
    // the reason the assertions above are on `Object.keys` and not on the row.
    const md = buildReport({ verdict }, { format: 'md' });
    expect(rowFor(md, 'F1')).toBe('| F1 | major | gpt | ✓ |  * |   | Contested |  |');
    expect(rowFor(md, 'F2')).toBe('| F2 | major | gpt | ✓ |  * | ✗ | Contested |  |');
  });

  test("a `''` ROSTER entry is seeded by the roster and still refused by the join (v4.8 T-C1 fix round 1)", () => {
    const verdict = verdictOf(
      [{ id: '', alias: 'deepseek', role: 'seat', lens: null, position: 1 },
        { id: 'gpt', alias: 'gpt', role: 'seat', lens: null, position: 2 }],
      [{ judge: '', verdict: 'agree', seat: '' }, { judge: 'gpt', verdict: 'dispute', seat: 'gpt' }]);
    const m = toModel(verdict);
    // `isSeatSpace` accepts `{id:''}` — it checks `typeof s.id === 'string'` and
    // `''` IS one — so a roster can hold `''`, and the seeding loop puts it in
    // `byJudge` exactly as it did at c8867b48. The brief's property 5 is therefore
    // a statement about the JOIN, not about the model's whole key set: nothing the
    // join WRITES is `""` or `"undefined"`.
    expect(m.judges).toEqual(['', 'gpt', 'UNATTRIBUTED']);
    expect(Object.keys(m.findings[0].byJudge)).toEqual(['', 'gpt', 'UNATTRIBUTED']);
    expect(m.findings[0].byJudge['']).toBeNull();
    // ⚠️ This is also the WITNESS for the `key !== ''` conjunct, which the other
    // six class pins do NOT cover: on their rosters `columns.has('')` is false, so
    // `columns.has` refuses the empty key and the conjunct is green against its own
    // mutant. Here `columns.has('')` is TRUE, and measured, dropping `key !== ''`
    // puts this agree in `byJudge['']` and emits no UNATTRIBUTED column at all.
    expect(m.findings[0].byJudge.UNATTRIBUTED).toBe('agree');
  });

  // A non-array `adjudications` is reachable through the same schema-free
  // `JSON.parse` entry points as a malformed seats table. ⚠️ The COUNT is
  // deliberately dropped: "the three schema-free entry points" has two conflicting
  // enumerations in this repo, and this comment RESOLVES that ambiguity rather than
  // merely noting it — see below for which reading it takes and why.
  //   A  {council report, council verdict --render, amicus_verdict}
  //      — `src/council/report.js :: isSeatSpace`'s docblock, which is the docblock
  //        `adjOf` explicitly back-references ("isSeatSpace ABOVE … for the same
  //        reason"), so it is the referent the sentence above actually names.
  //   B  {runTally, runReport, runVerdict}, with amicus_verdict listed SEPARATELY
  //      — nearest instances are IN THIS FILE: the file docblock at the top, and the
  //        `a malformed seats table falls back to alias space` block near the end
  //        ("cli-handlers-council.js's tally/report/verdict handlers"). Also
  //        pr4c-seat-spine.md@ed5c0c02:751-752.
  // THIS COMMENT TAKES READING A, because A is what `adjOf` back-references.
  // Measured for THIS shape by enumerating every `buildReport` caller in live code
  // — there are FOUR: `src/cli-handlers-council.js :: runReport`,
  // `src/cli-handlers-council.js :: runVerdict` on --render (via `buildVerdict`,
  // which copies `adjudications` straight through),
  // `src/mcp-server.js :: amicus_verdict`, and
  // `src/council/run-verdict-files.js :: writeVerdictFiles`, which is
  // engine-internal (it builds its verdict in process from a live record) and so
  // is NOT a schema-free vector. `src/cli-handlers-council.js
  // :: runTally` never calls `buildReport` at all. The three that ARE schema-free are
  // exactly set A, so under the referent the sentence names, the
  // "same … as a malformed seats table" claim above is exact. Measured at c8867b48:
  // `'abc'` RENDERED (a string is iterable, so `for...of` walked it and left a junk
  // `"undefined"` key), while `{}` and `42` THREW. At 774dcdc2 all three threw,
  // because the pre-pass reached for Array-only `.some` while the map still used
  // `for...of` — the two phases had drifted apart on type. `adjOf` is now the one
  // expression both read, and it refuses all three the same way.
  for (const [name, bad] of [['a string', 'abc'], ['an object', {}], ['a number', 42]]) {
    test(`${name} adjudications contributes no votes and does not throw (v4.8 T-C1 fix round 1)`, () => {
      const empty = buildReport({ verdict: verdictOf(null, []) }, { format: 'md' });
      expect(buildReport({ verdict: verdictOf(null, bad) }, { format: 'md' })).toBe(empty);
      const m = toModel(verdictOf(null, bad));
      expect(m.judges).toEqual(ALIAS_COLS);
      expect(Object.keys(m.findings[0].byJudge)).toEqual(ALIAS_COLS);
    });
  }

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

// ---------------------------------------------------------------------------
// SI-22.5 (v4.8 T-C2) — the SAME rule, written AGAIN for the workspace matrix.
// ---------------------------------------------------------------------------

/**
 * `buildMatrixModel` keyed every vote on `(seatSpace && adj.seat) || adj.judge`
 * from behind `typeof adj.judge !== 'string'`, and the domain split in two —
 * with BOTH halves losing the vote. Measured by probe at 32a63e92:
 *
 *   REFUSED by the guard, contributing nothing: `judge` absent, `judge` a
 *   non-string — in EITHER space, and whatever `seat` said.
 *   WRITTEN to a key no column reads: an orphaned seat id; `''`.
 *
 * The observable defect here is NOT report.js's polluted key set. `votes` is
 * internal and every cell is read BY COLUMN KEY, so no junk key ever escaped
 * into the model; what was lost is the COLUMN, and that is what this block pins.
 *
 * ⚠️ RULING R17 TOOK THE NARROW OPTION — this is a SECOND IMPLEMENTATION of
 * ruling R18's rule, not a shared one. Nothing is imported from `report.js` for
 * it and nothing is extracted. Two implementations can DRIFT, so the classes
 * below are pinned as an AGREEMENT rather than as two separate behaviours: the
 * `''`-roster document is driven through BOTH consumers and asserted to render
 * the same columns and the same vote placement. T-C2 shipped that one document
 * divergent for a single commit — `report.js` folded the `''` vote while this
 * file landed it in a `''` column — which is exactly the two-consumers-one-
 * document desync PR B exists to remove; fix round 1 closed it and that pin is
 * what keeps it closed.
 *
 * ⚠️ THE ONE REMAINING DIFFERENCE THIS DOCBLOCK RECORDED IS CLOSED. It read
 * that a null `adjudications` ELEMENT threw in `report.js` while this file
 * skipped it, and that R17 left that standing. v4.8 T-C4 gave
 * `report.js :: adjOf` a `.filter(Boolean)` — this file's `!adj` spelled a second
 * time, not shared — so both consumers now skip every falsy element. Measured
 * across ten element types, they disagree on none.
 *
 * NAMED MUTANTS on `src/workspace/matrix-model.js :: buildMatrixModel`. Protocol
 * per mutant: applied by hand, run against the FULL suite, hand-reverted,
 * byte-verified with `git show HEAD:src/workspace/matrix-model.js`, never
 * shipped — and measured LAST, after every other edit, so a recorded set
 * describes the tree that ships.
 *
 * ⚠️ RE-RUN, NEVER RENUMBER. A recorded red set ASSERTS that the set still
 * holds; editing the number instead of re-running the mutant is the defect these
 * records exist to prevent. Re-take the denominator with it.
 *
 * ⚠️ AN EMPTY RED SET MEANS THE PROPERTY IS UNPINNED, NOT THAT THE CODE IS SAFE.
 * T-C1 shipped a conjunct that was green against its own mutant because every
 * fixture it had made the conjunct unobservable. Two pins below exist purely to
 * make a decision observable: the `''` ROSTER, and a labelMap that maps a label
 * TO the model name `UNATTRIBUTED`.
 *
 * ⚠️ AND ALL FOUR RED SETS BELOW WERE RE-RUN AT BOTH FIX ROUNDS, NOT ADJUSTED.
 * Round 1 changed what the join accepts, REPLACED a pin and added another; round 2
 * added the fuzz block. Every number recorded against the previous tree was
 * therefore invalid each time — they were DELETED and re-measured, never edited,
 * and the denominator was re-taken with them (7711 -> 7712 -> 7715). One mutant was
 * replaced outright at round 1: `WSEMPTYFOLD` pinned the behaviour that round
 * reversed, so it is gone rather than renamed, and `WSEMPTYOK` is a different
 * mutation of the opposite code. Re-run, never renumber.
 *
 *
 * ⚠️ EVERY NUMBER BELOW WAS RE-RUN AT v4.8 T-C4, AGAINST THE TREE THAT SHIPS.
 * T-C4 changed what `report.js :: adjOf` accepts and added twelve pins plus
 * sixty fuzz cases, so every set recorded against a515400c was invalid. They
 * were DELETED and re-measured, never edited, and the denominator was re-taken
 * with them (7719 / 7715 -> 7731).
 *
 * ⚠️ WHAT THE T-C4 PINS DO TO THESE SETS, so the growth is accounted for rather
 * than absorbed: the block splits cleanly in two, and MEASUREMENT put it there.
 * Its five FALSY-element pins red under the three column-EMISSION mutants
 * (ALWAYSCOL, WSALWAYSCOL, ELEMKEEP); its five TRUTHY-element agreement pins red
 * under the two ROUTING mutants (JUNKKEY, WSJUNKKEY), which is the evidence that
 * those preservation pins are real pins and not decoration.
 *
 * Named mutant "WSALWAYSCOL": drop the `folded &&` conditional so the roster
 * always ends in UNATTRIBUTED. It is the "every existing matrix grows a column"
 * mutant — the one the conditional exists for.
 * MEASURED red set, RE-RUN against 32609ac8 (T-C4):
 * 3 suites / 37 tests, out of 541 / 7731. By suite:
 *   seat-matrix 30 · matrix-model 6 · workspace-matrix 1.
 * ⚠️ It read 31 (seat-matrix 24) before T-C4; the six it gained are five
 * T-C4 falsy-element pins and one more fuzz pin. Re-run, never renumbered.
 * ⚠️ TWENTY-THREE of the 37 are pins that PREDATE T-C2 and assert an exact judge
 * or cell list — T17/T18, T20, T21, T22 shape 2, the eight shared-predicate rows,
 * the four malformed-table rows, all six buildMatrixModel pins in
 * tests/workspace/matrix-model.test.js, and T19's blind header. That breadth IS
 * the contract: the roster is the header, so an unconditional column changes
 * every matrix ever rendered. The remaining eight are T-C2's own: six of this
 * block's twenty pins, plus two of the fuzz block's three.
 * ⚠️ ZERO snapshots move, unlike report.js's ALWAYSCOL which took four. Not a
 * weaker mutant — measured, no snapshot in this repo captures a rendered
 * workspace matrix, so those 23 pins are the only thing standing where report.js
 * has snapshots.
 * ⚠️ It read 30 (seat-matrix 23) at 09212e97 and 29 at fa0c5ae7. It LOST one to
 * fix round 1 — the replaced `''`-roster pin asserted a two-column roster, so an
 * unconditional third column broke it, while the new one already expects
 * UNATTRIBUTED — and GAINED two to fix round 2, both of them the fuzz's.
 * ⚠️ THE FUZZ IS THE SHARPER MEASUREMENT, and it still agrees with the pins
 * exactly on the widened axis: 92 of its 564 cases disagree under this mutant,
 * every one a COLUMN disagreement, and they are precisely the 92 cases that grow
 * no fold column at HEAD — the other half of the non-vacuity pin, which reads 564
 * instead of 472 here. By shape, 46 ordinary + 46 holdsEmpty and NONE on
 * holdsUnattributed, whose roster already carries the key so the append was
 * already skipped. It read 52 of 504 before T-C4; the 40 it gained are the new
 * element cases on those two roster shapes.
 *
 * Named mutant "WSJUNKKEY": revert the join to 32a63e92's
 * `if (!adj || typeof adj.judge !== 'string') { continue; }` plus
 * `votes[(seatSpace && adj.seat) || adj.judge] = adj.verdict`, leaving the
 * roster code in place. It is the "T-C2 never happened" mutant.
 * MEASURED red set, RE-RUN against 32609ac8 (T-C4):
 * 2 suites / 21 tests, out of 541 / 7731. By suite:
 *   seat-matrix 20 · workspace-matrix 1.
 * Those 20 are thirteen of this block's own pins, FIVE T-C4 pins, T22 shape 1,
 * and the fuzz's agreement pin. ⚠️ The five are T-C4's TRUTHY-element agreement
 * pins, exactly as for report.js's JUNKKEY and by the mirror-image mechanism:
 * this mutation refuses a non-string `judge`, so matrix-model grows no column for
 * `42`/`'x'`/`true` while report.js still does. SIX pins
 * here stay green under it, and the record names them rather than implying full
 * coverage: the no-unattributable-vote pin is WSALWAYSCOL's; `basis` is a
 * preservation pin no mutant here can move; so are the null-element and the three
 * malformed-`adjudications` pins; and the both-name-slots pin survives because
 * this mutation reverts only the ROUTING — the roster code is left in place, so
 * the column is still appended with the right pair.
 * ⚠️ It read 13 at 09212e97 and 15 at fa0c5ae7; round 1's two gains were both
 * `''`-roster pins, because 32a63e92's expression lands a `''` judge in a `''`
 * roster column and so reproduces the exact desync that round removed. Round 2
 * added one more, the fuzz.
 * ⚠️ AND THE FUZZ IS WHERE THIS MUTANT'S REAL SIZE SHOWS: 352 of its 564 cases
 * disagree under it — 117 ordinary + 118 holdsEmpty + 117 holdsUnattributed — and
 * every one is a PLACEMENT disagreement, never a COLUMN one, because the mutation
 * reverts only the routing and leaves the roster code to build identical headers.
 * A twenty-one-test red set understates a mutation that desyncs 62% of the axis.
 * ⚠️ It read 351 of 504 before T-C4. The single-case move is the verdict
 * rotation the element cases introduce, not a behaviour change — re-measured
 * rather than assumed stable, which is the only reason it is known to be one.
 *
 * Named mutant "WSEMPTYOK" (v4.8 T-C2 fix round 1): drop the `key !== ''`
 * conjunct from `columnFor`, leaving `typeof key === 'string' && keys.has(key)`.
 * It is the mutant for the fix round itself — the spelling T-C2 shipped for one
 * commit, under which a `''` judge matches a `''` roster key and the two
 * consumers render one document two ways. The ONLY thing that can see it is a
 * roster holding `''`.
 * ⚠️ THIS REPLACES a mutant named WSEMPTYFOLD, which is GONE rather than
 * renamed. WSEMPTYFOLD mutated the opposite code (it ADDED the conjunct) and its
 * pin asserted the behaviour this round reversed, so neither its mutation nor its
 * number could be carried forward.
 * MEASURED red set, RE-RUN against 32609ac8 (T-C4):
 * 1 suite / 4 tests, out of 541 / 7731 — seat-matrix 4: the `''`-fold pin, the
 * BOTH-CONSUMERS agreement pin, and BOTH of the fuzz's behaviour pins. Unmoved by
 * T-C4, which touched the ELEMENT and not the key: measured, not assumed.
 * ⚠️ WHICH FOUR is the whole point. A small set here means the conjunct is
 * invisible everywhere else, not that the pin is weak: on every other fixture's
 * roster `keys.has('')` is already false, so `keys.has` does the refusing and the
 * conjunct is unobservable — T-C1 shipped that exact blind spot. Only a roster
 * HOLDING `''` separates the spellings.
 * ⚠️ It read 2 at fa0c5ae7, and the two it gained are fix round 2's whole purpose.
 * The fuzz reports 20 disagreements out of 564 under it, every one a COLUMN
 * disagreement and every one on the `holdsEmpty` roster — 0 on `ordinary`, 0 on
 * `holdsUnattributed`. That is the "only a roster holding `''` can see it" claim
 * MEASURED across the whole axis rather than argued from one document, and it is
 * the same mutation that made this file and report.js render one document two ways.
 * The count is UNCHANGED at 20 across the widening, which is itself the claim
 * holding: none of the sixty new element cases can see a key conjunct. The
 * non-vacuity pin moves with it, 472 -> 452.
 *
 * Named mutant "WSPAIRFOR": build the fold column's pair as
 * `pairFor(UNATTRIBUTED, map)` instead of carrying the literal in both slots.
 * Invisible on every ordinary labelMap — `labelFor` returns null and display()
 * falls back to `pair.model`, printing the same string — so the only fixture
 * that can see it is one whose labelMap maps a label TO `UNATTRIBUTED`.
 * MEASURED red set, RE-RUN against 32609ac8 (T-C4):
 * 2 suites / 2 tests, out of 541 / 7731. By suite:
 *   seat-matrix 1 (the both-name-slots pin) · workspace-matrix 1 (the painter).
 * Unchanged in mechanism and size across BOTH fix rounds; re-run each time rather
 * than carried over, because a set that happens to be stable is still an assertion
 * about a tree.
 * ⚠️ THE FUZZ DOES NOT SEE IT — 0 of 564, re-run on the widened axis — and that
 * is correct rather than a gap.
 * The fuzz drives labelMap `{}` and compares vote PLACEMENT; this mutant changes
 * only a column's DISPLAY NAMES, which is a different axis and is why the painter
 * test with its adversarial labelMap exists.
 * ⚠️ THE PAINTER PIN ONLY REDS BECAUSE ITS labelMap IS ADVERSARIAL. Measured, it
 * fails on the blind header rendering `Review Z` where the fold column belongs —
 * the mechanism this decision was made against, not a restatement of it. On an
 * ordinary labelMap the two spellings are indistinguishable, also measured:
 * `display(pairFor('UNATTRIBUTED', {}), true)` and
 * `display({model: 'UNATTRIBUTED', label: 'UNATTRIBUTED'}, true)` both return
 * `UNATTRIBUTED`. Written with the map T19 uses, that test would have been GREEN
 * against its own mutant — an EMPTY red set proving nothing.
 */
describe('SI-22.5 (R17/R18): the workspace matrix folds a vote whose key names no column', () => {
  const SEATS = [
    { id: 'deepseek#1', alias: 'deepseek', role: 'seat', lens: null, position: 1 },
    { id: 'gpt', alias: 'gpt', role: 'seat', lens: null, position: 2 },
  ];
  const SEAT_COLS = ['deepseek#1', 'gpt'];
  const ALIAS_COLS = ['deepseek', 'gpt'];
  /** The one vote every fixture below carries whose key DOES name a column. */
  const SEATED = { judge: 'deepseek', verdict: 'agree', seat: 'deepseek#1' };

  /**
   * A hand-built `tally.json`, driven straight at `buildMatrixModel`. The
   * classes below differ only in a key the join reads, so routing them through
   * `tally()` would mix producer behaviour into a pin about the consumer. The
   * orphaned-seat class, which a real run DOES produce, is driven end to end
   * through tally + buildVerdict by T22 shape 1 above.
   */
  function tallyOf(seats, adjudications, meta) {
    return {
      meta: { runId: 'unattr-ws', runType: 'headless', date: '2026-07-20',
        models: ALIAS_COLS.slice(), chair: 'deepseek', claudeInCouncil: false,
        ...(seats ? { seats } : {}), ...(meta || {}) },
      findings: [{ id: 'F1', raiser: 'gpt', severity: 'major', tier: 'Contested',
        basis: { a: 1, d: 1, n: 0 }, adjudications }],
      tierCounts: { Confirmed: 0, Contested: 1, Singleton: 0, Disputed: 0 },
    };
  }
  const modelsOf = m => m.judges.map(j => j.model);
  const votesOf = m => m.rows[0].cells.map(c => c.verdict);

  // One row per refusal class — an orphan, the empty string, an absent key, a
  // non-string — with each driven in the space whose field carries it. The
  // trailing comment is what that shape did at 32a63e92, measured by probe.
  for (const [name, seats, cols, adj] of [
    ['seat space · an ORPHANED seat id', SEATS, SEAT_COLS,                  // votes["deepseek#9"]
      { judge: 'deepseek', verdict: 'dispute', seat: 'deepseek#9' }],
    ['seat space · seat falsy, judge is the empty string', SEATS, SEAT_COLS, // votes[""]
      { judge: '', verdict: 'dispute', seat: '' }],
    ['seat space · seat falsy, judge absent', SEATS, SEAT_COLS,             // REFUSED by the guard
      { verdict: 'dispute', seat: null }],
    ['alias space · judge is the empty string', null, ALIAS_COLS,           // votes[""]
      { judge: '', verdict: 'dispute' }],
    ['alias space · judge absent', null, ALIAS_COLS,                        // REFUSED by the guard
      { verdict: 'dispute' }],
    ['alias space · judge is not a string', null, ALIAS_COLS,               // REFUSED by the guard
      { judge: 42, verdict: 'dispute' }],
  ]) {
    test(`${name}: the vote gets a column instead of vanishing`, () => {
      const m = buildMatrixModel(tallyOf(seats, [SEATED, adj]), {}, null);
      expect(modelsOf(m)).toEqual(cols.concat('UNATTRIBUTED'));
      // The whole cell run, in roster order: the identifying vote is untouched
      // in column 1, the bench member who never voted stays blank, and the
      // refused vote is the LAST cell rather than no cell at all.
      expect(votesOf(m)).toEqual(['agree', null, 'dispute']);
      expect(m.rows[0].cells[2].sym).toBe(SYMBOL.dispute);
      expect(m.rows[0].cells[2].isRaiser).toBe(false);
    });
  }

  test('seat space · a VALID seat with a non-string judge lands in its OWN column (measured widening)', () => {
    // ⚠️ NOT a fold, and the one shape where this task WIDENS rather than
    // redirects. At 32a63e92 the guard tested `adj.judge` even in seat space,
    // where the judge is not the key, so this vote was refused outright and
    // rendered nowhere: measured `[null, null]`. R18 classifies the KEY, and
    // here the key is `gpt` — a string naming a real column. Measured, this
    // CLOSES a pre-existing divergence rather than opening one:
    // `src/council/report.js :: toModel` has never had the guard and already
    // puts this vote in `gpt`.
    const m = buildMatrixModel(tallyOf(SEATS, [{ judge: 42, verdict: 'dispute', seat: 'gpt' }]), {}, null);
    expect(modelsOf(m)).toEqual(SEAT_COLS);
    expect(votesOf(m)).toEqual([null, 'dispute']);
  });

  test('a document with NO unattributable vote grows no UNATTRIBUTED column, in either space', () => {
    for (const [seats, cols] of [[SEATS, SEAT_COLS], [null, ALIAS_COLS]]) {
      const m = buildMatrixModel(tallyOf(seats, [SEATED,
        { judge: 'gpt', verdict: 'agree', ...(seats ? { seat: 'gpt' } : {}) }]), {}, null);
      expect(modelsOf(m)).toEqual(cols);
      expect(m.rows[0].cells).toHaveLength(cols.length);
    }
  });

  test('UNATTRIBUTED is appended AFTER the reserved claude column, and moves no existing column', () => {
    const m = buildMatrixModel(tallyOf(SEATS, [SEATED,
      { judge: 'deepseek', verdict: 'dispute', seat: 'deepseek#9' }],
    { models: ALIAS_COLS.concat('claude'), claudeInCouncil: true }), {}, null);
    // `claudeTail` re-appends the reserved claude seat that `meta.seats` omits;
    // the fold column is not a bench member at all, so it goes LAST — which is
    // also what keeps every existing column at the index it had at 32a63e92.
    expect(modelsOf(m)).toEqual(SEAT_COLS.concat(['claude', 'UNATTRIBUTED']));
    expect(votesOf(m)).toEqual(['agree', null, null, 'dispute']);
  });

  test('the roster decision is GLOBAL, not per finding — every row gets the same cells', () => {
    const t = tallyOf(SEATS, [SEATED]);
    t.findings.push({ id: 'F2', raiser: 'gpt', severity: 'major', tier: 'Contested',
      basis: { a: 1, d: 1, n: 0 },
      adjudications: [SEATED, { judge: 'deepseek', verdict: 'dispute', seat: 'deepseek#9' }] });
    const m = buildMatrixModel(t, {}, null);
    expect(modelsOf(m)).toEqual(SEAT_COLS.concat('UNATTRIBUTED'));
    // ⚠️ The two-phase invariant is STRICTLY more visible here than in report.js.
    // `cells` is built by MAPPING the roster, so a roster decided inside the
    // per-finding map gives the two rows DIFFERENT CELL COUNTS — a table whose
    // body no longer matches its own header, not merely a key-set difference.
    expect(m.rows[0].cells).toHaveLength(3);
    expect(m.rows[1].cells).toHaveLength(3);
    expect(m.rows[0].cells[2].verdict).toBeNull();
    expect(m.rows[1].cells[2].verdict).toBe('dispute');
  });

  test('two unattributable votes on ONE finding collapse into ONE cell — LAST WINS (measured)', () => {
    const m = buildMatrixModel(tallyOf(SEATS, [
      { judge: 'deepseek', verdict: 'agree', seat: 'deepseek#9' },
      { judge: 'deepseek', verdict: 'dispute', seat: 'deepseek#7' },
    ]), {}, null);
    // R18 folds both into one column, so the second write overwrites the first
    // exactly as two votes on any other shared key always have. The row shows
    // the LAST vote; the first is shown nowhere. Pinned as measured rather than
    // claimed to be more.
    expect(modelsOf(m)).toEqual(SEAT_COLS.concat('UNATTRIBUTED'));
    expect(votesOf(m)).toEqual([null, null, 'dispute']);
  });

  test('basis does not move: the row passes the tally own object through', () => {
    const t = tallyOf(SEATS, [SEATED, { judge: 'deepseek', verdict: 'dispute', seat: 'deepseek#9' }]);
    const m = buildMatrixModel(t, {}, null);
    // Reference identity, not deep equality: it pins that nothing recomputed
    // basis from the folded column. R3 keeps the vote counted where it was.
    expect(m.rows[0].basis).toBe(t.findings[0].basis);
    expect(m.rows[0].basis).toEqual({ a: 1, d: 1, n: 0 });
  });

  test('the fold column carries the SAME string in both name slots', () => {
    const m = buildMatrixModel(tallyOf(SEATS, [SEATED,
      { judge: 'deepseek', verdict: 'dispute', seat: 'deepseek#9' }]),
    { 'Review A': 'deepseek', 'Review B': 'gpt' }, null);
    // ⚠️ NOT `pairFor(UNATTRIBUTED, map)`. UNATTRIBUTED has no alias to protect
    // and no identity to reveal, so the blind flip must be a no-op on it BY
    // CONSTRUCTION rather than by the accident of `labelFor` returning null —
    // which stops being an accident that helps the moment a labelMap value IS
    // `UNATTRIBUTED`. The rendered proof of that, through the real display(),
    // is in tests/workspace/workspace-matrix.test.js.
    expect(m.judges[2]).toEqual({ model: 'UNATTRIBUTED', label: 'UNATTRIBUTED' });
    expect(m.rows[0].cells[2].judge).toEqual({ model: 'UNATTRIBUTED', label: 'UNATTRIBUTED' });
  });

  /**
   * The `''`-roster document. ONE fixture, TWO pins — the behaviour, then the
   * agreement — because they fail for different reasons and a reviewer needs to
   * see which one broke.
   *
   * ⚠️ REPLACED, NOT ADJUSTED (v4.8 T-C2 fix round 1). The pin that stood here
   * asserted the OPPOSITE: that `''` names a real column when the roster holds it,
   * so the vote LANDS there. That was wrong and the owner ruled it out. Matching a
   * `''` roster key against a `''` judge matches TWO NON-IDENTITIES — structurally
   * the defect v4.8 T-B4 removed from src/council/peer-split.js :: peersOf, where a
   * falsy raiser matched a falsy judge and corroborated its own finding. R18 and R2
   * both say `''` is not an identity, and a malformed roster carrying `''` does not
   * make it into a name. The old pin and its mutant were deleted rather than edited:
   * this project has measured twice that an adjusted pin can go green against its
   * own mutant.
   */
  const EMPTY_SEATS = [
    { id: '', alias: 'deepseek', role: 'seat', lens: null, position: 1 },
    { id: 'gpt', alias: 'gpt', role: 'seat', lens: null, position: 2 },
  ];
  const EMPTY_ADJ = [{ judge: '', verdict: 'agree', seat: '' },
    { judge: 'gpt', verdict: 'dispute', seat: 'gpt' }];
  /** The same document as a verdict, for driving `report.js :: toModel` over it. */
  function emptyRosterVerdict() {
    return { runId: 'unattr-ws-empty', runType: 'headless', date: '2026-07-20',
      chair: 'deepseek', council: ALIAS_COLS.slice(), claudeInCouncil: false,
      seats: EMPTY_SEATS,
      findings: [{ id: 'F1', raiser: 'gpt', severity: 'major', tier: 'Contested',
        basis: { a: 1, d: 1, n: 0 }, adjudications: EMPTY_ADJ }],
      streetCred: [], runStats: [],
      tierCounts: { Confirmed: 0, Contested: 1, Singleton: 0, Disputed: 0 } };
  }

  test("a `''` key FOLDS even when the roster HOLDS `''` — two non-identities are not a match (v4.8 T-C2 fix round 1)", () => {
    // `isSeatSpace` accepts `{id: ''}` — it tests `typeof s.id === 'string'` and
    // `''` IS one — so this roster genuinely seeds a `''` COLUMN. That column is
    // still rendered; what it does not do is CLAIM a vote. `key !== ''` is what
    // separates the two, and `keys.has` cannot: on every other fixture's roster
    // `keys.has('')` is already false, so the conjunct is unobservable there.
    expect(isSeatSpace(EMPTY_SEATS)).toBe(true);
    const m = buildMatrixModel(tallyOf(EMPTY_SEATS, EMPTY_ADJ), {}, null);
    expect(modelsOf(m)).toEqual(['', 'gpt', 'UNATTRIBUTED']);
    // The `''` column stays BLANK and the vote goes to the fold column; the
    // identifying vote beside it is untouched.
    expect(votesOf(m)).toEqual([null, 'dispute', 'agree']);
  });

  test("the `''`-roster document renders the SAME through report.js and the matrix — one document, one answer", () => {
    // ⚠️ THE DURABLE PIN OF FIX ROUND 1, and the reason it exists is that this
    // exact document rendered TWO WAYS for one commit: report.js folded the `''`
    // vote while the matrix landed it in the `''` column. Two consumers disagreeing
    // about one document is the desync class PR B exists to remove, and R17's
    // second implementation is precisely what can drift back into it — so the
    // agreement is ASSERTED here rather than left to be re-derived from two
    // separate behaviour pins.
    const r = toModel(emptyRosterVerdict());
    const m = buildMatrixModel(tallyOf(EMPTY_SEATS, EMPTY_ADJ), {}, null);
    // Same columns, in the same order. (A column's `pair.model` IS its key on
    // every branch of this roster: seat columns carry `s.id`, alias and claude
    // columns carry the alias, and the fold column carries the literal.)
    expect(modelsOf(m)).toEqual(r.judges);
    // Same vote in the same column — compared as a whole map, not spot-checked,
    // so a vote appearing in one and not the other cannot pass.
    expect(Object.fromEntries(m.rows[0].cells.map(c => [c.judge.model, c.verdict])))
      .toEqual(r.findings[0].byJudge);
    // And stated absolutely, so the pin still means something if both sides
    // regress together: the vote is FOLDED on both, and `''` claims nothing.
    expect(r.findings[0].byJudge).toEqual({ '': null, gpt: 'dispute', UNATTRIBUTED: 'agree' });
  });

  test('a bench model literally aliased UNATTRIBUTED is not columned twice — it SHARES the cell', () => {
    const m = buildMatrixModel(tallyOf(null, [{ judge: 'nobody', verdict: 'dispute' }],
      { models: ['UNATTRIBUTED', 'gpt'] }), { 'Review A': 'gpt' }, null);
    // DISCLOSED, not fixed: the column key is what the fold writes, so that
    // model's column and the folded vote share one cell. R18 says ONE column,
    // so the roster keeps ONE entry rather than rendering one key under two
    // identical headers — and the entry it keeps is the BENCH member's, pair
    // and all, because the append is what is skipped.
    expect(modelsOf(m)).toEqual(['UNATTRIBUTED', 'gpt']);
    expect(m.judges[0]).toEqual({ model: 'UNATTRIBUTED', label: null });
    expect(votesOf(m)).toEqual(['dispute', null]);
  });

  test('a null adjudication element is still SKIPPED, not folded — the surviving guard is doing work', () => {
    // ⚠️ Only HALF the old guard was subsumed by the classification. `!adj`
    // stays: a null element carries no verdict to fold, and `columnFor` would
    // dereference it. Already pinned for the CELL in
    // tests/workspace/matrix-model.test.js; re-pinned here for the COLUMN set.
    // ⚠️ THIS COMMENT USED TO SAY `report.js :: toModel` THROWS on this exact
    // document while this file renders. That was true until v4.8 T-C4, which gave
    // `report.js` the same predicate; the two now agree here, pinned in the T-C4
    // block below. This pin is unchanged and still guards THIS file's guard.
    const m = buildMatrixModel(tallyOf(SEATS, [null, SEATED]), {}, null);
    expect(modelsOf(m)).toEqual(SEAT_COLS);
    expect(votesOf(m)).toEqual(['agree', null]);
  });

  // A non-array `adjudications` reaches this function through run-detail.js's
  // defensive parse of a hand-editable tally.json. `adjOf` is the ONE expression
  // both phases read, so they cannot drift apart on type the way report.js's
  // did for one commit (T-C1 fix round 1) — a pre-pass reaching for Array-only
  // `.some` while the loop still took any iterable made `'abc'` throw.
  for (const [name, bad] of [['a string', 'abc'], ['an object', {}], ['a number', 42]]) {
    test(`${name} adjudications contributes no votes and grows no column`, () => {
      const m = buildMatrixModel(tallyOf(SEATS, bad), {}, null);
      expect(modelsOf(m)).toEqual(SEAT_COLS);
      expect(votesOf(m)).toEqual([null, null]);
    });
  }
});


// ---------------------------------------------------------------------------
// SI-22.5 (v4.8 T-C4) — an adjudication ELEMENT that is not a vote.
// ---------------------------------------------------------------------------

/**
 * The council's second run found the one shape T-C1 and T-C2 both got wrong, and
 * it was not a key shape at all — it was the ELEMENT. A falsy non-null entry in
 * `adjudications` has no `.seat` and no `.judge`, so `columnFor` classified it
 * unattributable and `folded` grew a column; its `.verdict` is `undefined` too,
 * so the column rendered BLANK. It announced an unattributable vote and showed
 * nothing. `matrix-model.js` skipped the same element through its `!adj` guard
 * and grew no column, so ONE document rendered two ways — the desync this PR
 * exists to remove. Measured at ed5c0c02, no column grew on either side, so the
 * divergence was introduced by this PR rather than inherited.
 *
 * THE FIX IS THE PREDICATE `matrix-model.js` ALREADY HAD. `report.js :: adjOf`
 * now drops falsy elements, which is `!adj` spelled a second time rather than
 * shared — R17 keeps the two implementations separate.
 *
 * ⚠️ THE PROTOTYPE HANDED TO THIS TASK WAS `a && typeof a === 'object'`, AND
 * MEASUREMENT REJECTED IT. Over ten element types against the live
 * `matrix-model.js`: `filter(Boolean)` disagrees on 0 of 10, that expression on
 * 3 of 10. It filters TRUTHY non-objects — `42`, `'x'`, `true` — which
 * `matrix-model.js` keeps, so it would have closed one divergence by opening
 * three. The whole point of this block is that the two consumers agree; an
 * expression that de-aligns them fails on its own terms.
 *
 * ⚠️ WHAT IS STILL OPEN, MEASURED AND PINNED BELOW RATHER THAN QUIETLY LEFT: a
 * TRUTHY non-object element (`42`, `'x'`, `true`) — and `[]`/`{}` — still grows a
 * blank fold column. That is the same phantom-column defect, but on BOTH
 * consumers and identically, so it is not a desync and not what was filed.
 * Closing it means editing both files, which is a scope call, not an
 * implementer's. Filed in BACKLOG.md; pinned here as the AGREEMENT it is.
 */
describe('T-C4: an adjudication ELEMENT that is not a vote, on BOTH consumers', () => {
  const SEATS = [
    { id: 'deepseek#1', alias: 'deepseek', role: 'seat', lens: null, position: 1 },
    { id: 'gpt', alias: 'gpt', role: 'seat', lens: null, position: 2 },
  ];
  const COLS = ['deepseek#1', 'gpt'];
  const SEATED = { judge: 'deepseek', verdict: 'agree', seat: 'deepseek#1' };

  /** ONE finding object, shared BY REFERENCE by both documents — as the fuzz does. */
  function docsFor(el) {
    const finding = { id: 'F1', raiser: 'gpt', severity: 'major', tier: 'Contested',
      basis: { a: 1, d: 1, n: 0 }, adjudications: [SEATED, el] };
    return {
      verdict: { runId: 'tc4', runType: 'headless', date: '2026-07-20', chair: 'chair',
        council: ['deepseek', 'gpt'], claudeInCouncil: false, seats: SEATS,
        findings: [finding], streetCred: [], runStats: [], tierCounts: {} },
      tally: { meta: { runId: 'tc4', runType: 'headless', date: '2026-07-20',
        models: ['deepseek', 'gpt'], chair: 'chair', claudeInCouncil: false, seats: SEATS },
      findings: [finding], tierCounts: {} },
    };
  }
  /** Both consumers' answers in one comparable shape: columns, then vote per column. */
  function bothOf(el) {
    const { verdict, tally } = docsFor(el);
    const r = toModel(verdict);
    const m = buildMatrixModel(tally, {}, null);
    return {
      reportCols: r.judges,
      matrixCols: m.judges.map(j => j.model),
      reportVotes: r.findings[0].byJudge,
      matrixVotes: Object.fromEntries(m.rows[0].cells.map(c => [c.judge.model, c.verdict])),
    };
  }

  for (const [name, el] of [['0', 0], ['false', false], ['the empty string', ''],
    ['null', null], ['undefined', undefined]]) {
    test(`a ${name} element: no phantom column, and the two consumers agree exactly`, () => {
      const b = bothOf(el);
      // ⚠️ THE AGREEMENT IS THE PROPERTY; the literal values below are only its
      // evidence. Asserted first so a future change that breaks both files the
      // same way still fails here.
      expect(b.reportCols).toEqual(b.matrixCols);
      expect(b.reportVotes).toEqual(b.matrixVotes);
      // And the answer they agree on is the one ed5c0c02 gave: no fold column.
      expect(b.reportCols).toEqual(COLS);
      expect(b.reportVotes).toEqual({ 'deepseek#1': 'agree', gpt: null });
    });
  }

  test('the rendered header carries no phantom column either', () => {
    const md = buildReport({ verdict: docsFor(0).verdict }, { format: 'md' });
    expect(headerFor(md)).toBe('| Finding | Sev | Raiser | deepseek#1 | gpt | Tier | Decision |');
    expect(md).not.toContain('UNATTRIBUTED');
    expect(buildReport({ verdict: docsFor(0).verdict }, { format: 'html' })).not.toContain('UNATTRIBUTED');
  });

  test('null and undefined stop THROWING in report.js — the widening is named, not a side effect', () => {
    // A null element threw `Cannot read properties of null (reading 'seat')` in
    // BOTH of report.js's phases at a515400c, while matrix-model.js rendered.
    // Dropping it is the same throw -> render widening already taken for the
    // adjudications CONTAINER at T-C1 fix round 1, and it is what removes the
    // last element-level strictness difference between the two files.
    expect(() => toModel(docsFor(null).verdict)).not.toThrow();
    expect(() => toModel(docsFor(undefined).verdict)).not.toThrow();
  });

  // ⚠️ PRESERVATION PINS, and green before this task as well as after — they are
  // here to keep the REMAINING phantom column symmetric, not to endorse it. A
  // truthy non-object carries no `.verdict` either, so its column is blank too;
  // both consumers grow it, and the pin fails the moment only one of them stops.
  for (const [name, el] of [['42', 42], ['a string', 'x'], ['true', true],
    ['an empty array', []], ['an empty object', {}]]) {
    test(`${name}: still folded, but folded the SAME WAY by both consumers`, () => {
      const b = bothOf(el);
      expect(b.reportCols).toEqual(b.matrixCols);
      expect(b.reportVotes).toEqual(b.matrixVotes);
      expect(b.reportCols).toEqual(COLS.concat('UNATTRIBUTED'));
      // The blank cell, asserted rather than described: the column exists and
      // shows nothing, which is why it is still filed as open.
      expect(b.reportVotes.UNATTRIBUTED).toBeUndefined();
    });
  }
});

// ---------------------------------------------------------------------------
// SI-22.5 (v4.8 T-C2 fix round 2) — the agreement, proved by FUZZ, not by one shape.
// ---------------------------------------------------------------------------

/**
 * Fix round 1 pinned `report.js` and `matrix-model.js` in agreement on ONE
 * document — the `''` roster. That is the weakest possible place for the
 * property: it is the document we already knew to look at, because a wrong brief
 * sent it divergent. This block drives the whole axis instead.
 *
 * ⚠️ A CROSS-REFERENCE TO AN EARLIER PR'S FUZZ STOOD HERE AND IS DELETED, with no
 * substitute. Its case and disagreement counts came from conversation rather than
 * from this repository, and `git grep` over src/, tests/, electron/, docs/ and
 * BACKLOG.md finds them nowhere — every hit is an unrelated `240000` timeout. The
 * truthiness cross-products that ARE recorded in tracked code measure a different
 * function (src/council/peer-split.js :: peersOf) and are not this fuzz's
 * precedent; quoting them here would be a second invented equivalence. A comment
 * that cites nothing beats one that cites something unverifiable. Every number
 * below is re-derivable from this tree by the recipe stated.
 *
 * EXHAUSTIVE, NOT SAMPLED. 564 cases is the complete cross-product of
 *   roster shape  {ordinary, one holding `''`, one holding `UNATTRIBUTED`}
 *   x seatSpace   {on, off}
 *   x a companion identifying vote {present, absent}
 * with, per (shape, space, companion):
 *   x adj.seat    {absent, null, `''`, a roster id, an orphan id, 42, 'UNATTRIBUTED'}
 *   x adj.judge   {absent, `''`, a roster alias, an unknown alias, 42, 'UNATTRIBUTED'}
 *     — 504 cases whose element is a well-formed OBJECT, and
 *   x the ELEMENT itself {0, false, `''`, null, undefined}
 *     — 60 cases where the element is not a vote at all (v4.8 T-C4).
 * so there is no seed, no randomness and nothing to re-run for luck.
 *
 * ⚠️ THE ELEMENT AXIS IS T-C4's, AND ITS ABSENCE IS WHY A DEFECT SHIPPED. The
 * seat/judge axes vary a vote's KEY and presuppose a vote; nothing varied whether
 * the entry was a vote. A falsy element made `columnFor` fold and grew a blank
 * column in `report.js` while `matrix-model.js` skipped it — 60 disagreements the
 * 504-case axis could not see. The element does NOT multiply through seat/judge:
 * those properties are meaningless on a non-object, so 60 cases carry the axis
 * rather than 2520 duplicates of it.
 *
 * ⚠️ MEASURED, and these are the numbers that make the block mean anything.
 * Every figure below is against THIS 564-case axis; the 504-case figures this
 * docblock used to carry were DELETED rather than carried forward, because the
 * element cases shift `out.length` and therefore the verdict rotation of the
 * object cases — a re-run, not a renumber, and it moved.
 *   T-C4 BASE  a515400c:report.js    x shipped matrix-model    60 / 564
 *   T-C2 BASE  shipped report.js     x 32a63e92:matrix-model  408 / 564
 *   SHIPPED    x SHIPPED                                        0 / 564
 * Of T-C4's 60: 24 COLUMN, 12 PLACEMENT and 24 THROW (`null`/`undefined` threw in
 * `report.js`); 20 per roster shape; 12 per element, and `@object` scored 0 of its
 * 504 — the axis that already existed was clean, which is the point.
 * Of T-C2's 408: 284 COLUMN, 124 PLACEMENT, all 408 on `@object`; by roster shape
 * 145 ordinary + 146 holdsEmpty + 117 holdsUnattributed. ⚠️ It read 407 (123
 * PLACEMENT, 145 holdsEmpty) on the 504-case axis; the one-case move is the
 * verdict rotation named above, re-measured rather than assumed to be stable.
 * TO RE-DERIVE EITHER FIGURE: write `git show <ref>:<path>` to a NEW, UNTRACKED
 * SIBLING file inside the SAME directory — the requires are relative — run this
 * cross-product against that copy, and delete it in a `finally`.
 * ⚠️ NEVER by editing the tracked file. A working tree left dirty is one
 * interruption away from a half-reverted source file; the sibling leaves the
 * tracked tree untouched throughout. A fuzz that cannot fail proves nothing; this
 * one fails 72% of its cases against the code T-C2 replaced and, on the axis T-C4
 * added, every single case that axis exists to cover.
 *
 * ⚠️ TWO KNOWN, LEGITIMATE DIVERGENCES ARE EXCLUDED BY CONSTRUCTION, never by
 * filtering a result set — a fuzz that silently skips cases reads as coverage it
 * does not have. Each is excluded by how the fixtures are BUILT. There were
 * THREE; the first is gone, and it is kept here as a record rather than deleted
 * because its removal is what this task is:
 *   1. THE ELEMENT TYPE — NO LONGER EXCLUDED. This exclusion read "no
 *      `adjudications` entry is ever null, so the case cannot arise; report.js
 *      throws on it and this file skips it". v4.8 T-C4 measured what that
 *      exclusion was hiding — a falsy non-null element grew a phantom blank
 *      column in `report.js` and none here — so the axis now VARIES the element
 *      itself and the exclusion is deleted rather than re-worded.
 *   2. THE ROSTER SOURCES. ONE roster literal builds BOTH documents —
 *      `meta.seats`/`meta.models` for the tally and `seats`/`council` for the
 *      verdict are the SAME arrays. The two files genuinely read different
 *      fields, and that difference is real but is not about the vote key.
 *   3. THE CLAUDE TAIL. `claudeInCouncil` is always false and no roster carries
 *      `claude`, so `claudeTail` — which this file re-appends and `report.js`
 *      does not — never fires. ⚠️ READ THE R20 BLOCK BELOW BEFORE ACTING ON THIS
 *      EXCLUSION: its cost is measured there, and the divergence it hides is
 *      caused by an ABSENT alias-side filter, NOT by `claudeTail`, which is on
 *      the seat-space arm only.
 * Anything OUTSIDE those three is in scope, and a disagreement there is a defect
 * in one of the two files.
 *
 * ⚠️ WHAT THIS BLOCK DOES NOT PROVE. The axis is the VOTE KEY, as bounded. It
 * says nothing about the raiser, the tier/override/debate joins, `basis`, blind
 * mode, or the three excluded shapes above — all pinned elsewhere in this file
 * and in tests/workspace/.
 */
describe('SI-22.5 (R17/R18): the two consumers agree on EVERY vote-key shape (fuzz, fix round 2)', () => {
  // ONE roster per shape. Each object is shared BY REFERENCE between the tally
  // and the verdict below, which is what makes exclusion 2 structural.
  const ROSTERS = {
    ordinary: {
      seats: [{ id: 'deepseek#1', alias: 'deepseek', role: 'seat', lens: null, position: 1 },
        { id: 'gpt#1', alias: 'gpt', role: 'seat', lens: null, position: 2 }],
      aliases: ['deepseek', 'gpt'],
    },
    // `isSeatSpace` accepts `{id: ''}`, so this roster is reachable and is the
    // document fix round 1 was about.
    holdsEmpty: {
      seats: [{ id: '', alias: 'deepseek', role: 'seat', lens: null, position: 1 },
        { id: 'gpt#1', alias: 'gpt', role: 'seat', lens: null, position: 2 }],
      aliases: ['', 'gpt'],
    },
    // A bench member literally aliased UNATTRIBUTED — model names are user-supplied.
    holdsUnattributed: {
      seats: [{ id: 'UNATTRIBUTED', alias: 'deepseek', role: 'seat', lens: null, position: 1 },
        { id: 'gpt#1', alias: 'gpt', role: 'seat', lens: null, position: 2 }],
      aliases: ['UNATTRIBUTED', 'gpt'],
    },
  };
  // `'@absent'` is a SENTINEL meaning "omit the property entirely", which is a
  // different shape from `undefined` for `Object.keys`/spread and is the shape a
  // producer actually emits. `null` is separate and deliberate: both seat
  // producers are `|| null` by design (peer-split.js :: peersOf documents why).
  const SEATS_AXIS = ['@absent', null, '', 'gpt#1', 'deepseek#9', 42, 'UNATTRIBUTED'];
  const JUDGE_AXIS = ['@absent', '', 'gpt', 'nobody', 42, 'UNATTRIBUTED'];
  // v4.8 T-C4 — THE ELEMENT ITSELF, the axis whose absence let the phantom
  // column ship. The seat/judge axes are meaningless on a non-object element, so
  // these do NOT multiply through them: each gets one case per roster shape x
  // space x companion, which is 60 cases rather than 2520 duplicates.
  const ELEMENT_AXIS = [0, false, '', null, undefined];
  const VERDICTS = ['agree', 'dispute', 'neutral'];
  /** Identifies a real column in EITHER space and on EVERY roster shape above. */
  const COMPANION = { judge: 'gpt', verdict: 'agree', seat: 'gpt#1' };

  function fuzzCases() {
    const out = [];
    for (const shape of Object.keys(ROSTERS)) {
      for (const seatSpace of [true, false]) {
        for (const seat of SEATS_AXIS) {
          for (const judge of JUDGE_AXIS) {
            for (const withCompanion of [true, false]) {
              const adj = { verdict: VERDICTS[out.length % VERDICTS.length] };
              if (seat !== '@absent') { adj.seat = seat; }
              if (judge !== '@absent') { adj.judge = judge; }
              out.push({ shape, seatSpace, seat, judge, withCompanion, adj, element: '@object' });
            }
          }
        }
        for (const element of ELEMENT_AXIS) {
          for (const withCompanion of [true, false]) {
            out.push({ shape, seatSpace, seat: '@element', judge: '@element',
              withCompanion, adj: element, element: String(element) });
          }
        }
      }
    }
    return out;
  }

  /** One case -> the tally and the verdict that carry the SAME roster and finding. */
  function docsFor(c) {
    const { seats, aliases } = ROSTERS[c.shape];
    const finding = { id: 'F1', raiser: 'gpt', severity: 'major', tier: 'Contested',
      basis: { a: 1, d: 1, n: 0 },
      adjudications: c.withCompanion ? [COMPANION, c.adj] : [c.adj] };
    return {
      tally: { meta: { runId: 'fz', runType: 'headless', date: '2026-07-20',
        models: aliases, chair: 'chair', claudeInCouncil: false,
        ...(c.seatSpace ? { seats } : {}) },
      findings: [finding], tierCounts: {} },
      verdict: { runId: 'fz', runType: 'headless', date: '2026-07-20', chair: 'chair',
        council: aliases, claudeInCouncil: false, ...(c.seatSpace ? { seats } : {}),
        findings: [finding], streetCred: [], runStats: [], tierCounts: {} },
    };
  }

  /** null when the two consumers agree; otherwise WHY, with both renderings. */
  function disagreement(c) {
    const { tally, verdict } = docsFor(c);
    const r = toModel(verdict);
    const m = buildMatrixModel(tally, {}, null);
    const label = `${c.shape} seatSpace=${c.seatSpace} element=${c.element} `
      + `seat=${JSON.stringify(c.seat)} judge=${JSON.stringify(c.judge)} `
      + `companion=${c.withCompanion}`;
    const mCols = m.judges.map(j => j.model);
    if (JSON.stringify(r.judges) !== JSON.stringify(mCols)) {
      return `${label} — COLUMNS report=${JSON.stringify(r.judges)} matrix=${JSON.stringify(mCols)}`;
    }
    // A column's `pair.model` IS its key on every branch of this roster (seat
    // columns carry `s.id`, alias columns the alias, the fold column the literal),
    // so this map is directly comparable to report.js's `byJudge`.
    const mMap = Object.fromEntries(m.rows[0].cells.map(x => [x.judge.model, x.verdict]));
    if (JSON.stringify(r.findings[0].byJudge) !== JSON.stringify(mMap)) {
      return `${label} — PLACEMENT report=${JSON.stringify(r.findings[0].byJudge)} matrix=${JSON.stringify(mMap)}`;
    }
    return null;
  }

  test('the axis is the size it claims to be: 564 cases, and every one is distinct', () => {
    const all = fuzzCases();
    // ⚠️ THE ANTI-SHRINK PIN. A fuzz that quietly loses half its axis still passes
    // its own zero-disagreement assertion, and reads as coverage it no longer has.
    // 3 shapes x 2 spaces x (7 seats x 6 judges + 5 elements) x 2 companion states.
    expect(all).toHaveLength(3 * 2 * (SEATS_AXIS.length * JUDGE_AXIS.length + ELEMENT_AXIS.length) * 2);
    expect(all).toHaveLength(564);
    // ⚠️ `element` is part of the key, and it has to be: the 60 element cases all
    // carry the SAME seat/judge sentinel, so a key without it would collapse them
    // to 12 and the distinctness pin would fail for the wrong reason.
    const keys = new Set(all.map(c => `${c.shape}|${c.seatSpace}|${c.element}|${String(c.seat)}|${String(c.judge)}|${c.withCompanion}`));
    expect(keys.size).toBe(564);
    expect(all.filter(c => c.element === '@object')).toHaveLength(504);
    expect(all.filter(c => c.element !== '@object')).toHaveLength(60);
  });

  test('the axis DRIVES BOTH BRANCHES of the conditional column — it is not vacuous', () => {
    // Observed, never recomputed from the rule under test: how many cases end up
    // with a fold column at all. Both branches must be well populated, or a
    // "0 disagreements" result would be agreement about nothing happening.
    const grew = fuzzCases().filter((c) => {
      const { tally } = docsFor(c);
      return buildMatrixModel(tally, {}, null).judges.some(j => j.model === 'UNATTRIBUTED');
    }).length;
    expect(grew).toBe(472);
    expect(564 - grew).toBe(92);
    // ⚠️ The 60 element cases moved this by exactly 20, and the 20 are named
    // rather than left as a delta: on the `holdsUnattributed` roster the column
    // is a BENCH member, present whatever the element does. On the other two
    // rosters a falsy element now grows nothing — which is the fix.
    const byElement = fuzzCases().filter(c => c.element !== '@object' && (() => {
      const { tally } = docsFor(c);
      return buildMatrixModel(tally, {}, null).judges.some(j => j.model === 'UNATTRIBUTED');
    })());
    expect(byElement).toHaveLength(20);
    expect(new Set(byElement.map(c => c.shape))).toEqual(new Set(['holdsUnattributed']));
  });

  test('ZERO disagreements across all 564 cases — same columns, same vote in the same column', () => {
    // ⚠️ This same cross-product produces 408 disagreements against 32a63e92's
    // matrix-model (284 columns, 124 placement) and 60 against a515400c's
    // report.js (24 columns, 12 placement, 24 throws — every one on the element
    // axis). The zero below is a result, not a tautology. See this block's
    // docblock for how each BASE was run.
    const found = fuzzCases().map(disagreement).filter(Boolean);
    expect(found).toEqual([]);
  });
});
/**
 * R20 (v4.8 T2.4 fix round 1) — THE COST OF THE FUZZ'S EXCLUSION 3, MEASURED.
 *
 * The agreement fuzz above excludes the claude tail BY CONSTRUCTION: no fixture
 * there sets `claudeInCouncil` and no roster carries `claude`. That is a
 * statement about the fixtures, not about the world, and until this block its
 * cost was nowhere measured. It is NOT zero.
 *
 * ⚠️ THE CAUSE IS AN ABSENT FILTER, NOT `claudeTail`. An earlier draft of this
 * block said matrix-model.js "re-appends it as `claudeTail`" — that is INVERTED,
 * and it is measurably false on this very fixture. What actually happens:
 *   report.js       FILTERS claude OUT of its own roster when the flag is on:
 *                   `claudeInCouncil === true ? council.filter(j => j !== 'claude')
 *                   : council` — so `columns.has('claude')` is false and the
 *                   vote FOLDS.
 *   matrix-model.js has NO counterpart filter AT ALL. Its alias branch is a bare
 *                   `aliasJudges.map(...)` over `meta.models`, which carries
 *                   `claude` — so the vote lands in the `claude` column. That
 *                   file's own comment says so: "report.js filters the reserved
 *                   claude seat out of ITS roster; this one never has".
 *
 * ⚠️ `claudeTail` DOES THE OPPOSITE JOB, ON THE OTHER BRANCH. It is concatenated
 * only on the SEAT-SPACE arm, where it RE-ADDS claude because `meta.seats` is
 * bench-only and excludes the reserved seat. THIS FIXTURE IS ALIAS SPACE, so that
 * arm is never taken. Measured control: rebuilding the module with
 * `claudeTail = []` leaves the divergence below completely UNCHANGED.
 *
 * ⚠️ AND THE FLAG FLIPS report.js ONLY — measured, alias space, both values:
 *   claudeInCouncil=true   report [deepseek,gpt,UNATTRIBUTED]  matrix [deepseek,gpt,claude]  DIVERGE
 *   claudeInCouncil=false  report [deepseek,gpt,claude]        matrix [deepseek,gpt,claude]  AGREE
 * The matrix output is IDENTICAL at both flag values. Only `report.js` moves.
 * This matters beyond bookkeeping: the roster-SOURCES lever this is filed against
 * must be aimed at the MISSING ALIAS FILTER, not at `claudeTail`.
 *
 * ⚠️ OWNER RULING R20: DISCLOSE, PIN AND FILE — do NOT align the rosters. That is
 * a roster-SOURCES question and R17 keeps it out of this PR. These pins exist so
 * the divergence cannot drift silently, and so that whoever takes the roster-
 * sources lever inherits the measured behaviour of BOTH sides rather than a
 * sentence about it. Filed in BACKLOG.md under the NEXT LEVER entry.
 *
 * ⚠️ NO ENGINE RUN EMITS THIS VOTE — `run-stage2.js :: runStage2` (the
 * ROSTER-not-bundle derivation of `judges`) guarantees Claude is
 * judged but never judges. It is reachable exactly the way every other shape in
 * this file is: the schema-free `JSON.parse` entry points.
 *
 * ⚠️ THIS SHAPE IS WHY THE COLUMN'S DOCUMENTED MEANING WAS CORRECTED. `judge`
 * names the voter here, so "nobody could attribute this vote" would be false.
 * The rule the code applies is "no COLUMN for this key on this document's
 * bench", which is not the same rule. docs/council.md and CHANGELOG.md say so.
 */
describe('R20: a claude vote is placed DIFFERENTLY by the two consumers, pinned as measured', () => {
  const ADJS = [
    { findingId: 'A1', judge: 'gpt', verdict: 'agree' },
    { findingId: 'A1', judge: 'claude', verdict: 'dispute' },
  ];
  const BASIS = { a: 1, d: 1, n: 0 };
  const finding = () => ({ id: 'A1', severity: 'major', raiser: 'deepseek', tier: 'Contested',
    basis: BASIS, adjudications: ADJS });
  const verdict = () => ({ runType: 'council', id: 'r', date: 'd', chair: 'gpt',
    council: ['deepseek', 'gpt', 'claude'], claudeInCouncil: true,
    findings: [finding()], runStats: [] });
  const tally = () => ({ meta: { runId: 'r', runType: 'headless', date: 'd', chair: 'gpt',
    models: ['deepseek', 'gpt', 'claude'], claudeInCouncil: true },
  findings: [finding()], rankings: [], runStats: [] });

  test('report.js FOLDS it — claude is off its bench, so the key names no column', () => {
    const m = toModel(verdict(), null);
    expect(m.judges).toEqual(['deepseek', 'gpt', 'UNATTRIBUTED']);
    expect(m.findings[0].byJudge).toEqual({ deepseek: null, gpt: 'agree', UNATTRIBUTED: 'dispute' });
    // No junk key survives on this side either — the refusal still holds.
    expect(Object.keys(m.findings[0].byJudge)).not.toContain('claude');
  });

  test('matrix-model.js PLACES it in the claude column — it has no claude filter at all', () => {
    const w = buildMatrixModel(tally(), {}, verdict());
    // ALIAS space: the bare `aliasJudges.map(...)` arm, so `claudeTail` is never
    // reached. `meta.models` carries `claude` and nothing removes it.
    expect(w.judges.map(j => j.model)).toEqual(['deepseek', 'gpt', 'claude']);
    expect(w.rows[0].cells.map(c => c.verdict)).toEqual([null, 'agree', 'dispute']);
    // And it grows NO fold column, because nothing was refused here.
    expect(w.judges.map(j => j.model)).not.toContain('UNATTRIBUTED');
  });

  test('the two DISAGREE — asserted, not hoped: this is exclusion 3 costing something', () => {
    const rep = toModel(verdict(), null).judges;
    const ws = buildMatrixModel(tally(), {}, verdict()).judges.map(j => j.model);
    expect(rep).not.toEqual(ws);
  });

  test('`basis` is unmoved on BOTH sides — the divergence is placement only', () => {
    expect(toModel(verdict(), null).findings[0].basis).toEqual(BASIS);
    expect(buildMatrixModel(tally(), {}, verdict()).rows[0].basis).toEqual(BASIS);
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
 * ⚠️ This is NOT `ledger.js :: CONFORMANCE_RANK`'s documented-copy situation.
 * That copy is paid for because `ledger.js` (plus its two size-gate
 * extractions, both shallow) never reaches findings/anonymize/seats, while its
 * sibling pulls all three. MEASURED here instead: a fresh
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

// ---------------------------------------------------------------------------
// v4.8 Phase 6 PR1 Task 3 (SI-24) — SYMBOL is prototype-safe.
// ---------------------------------------------------------------------------

/**
 * `report.js`'s SYMBOL was a plain object literal, so an inherited/unknown
 * vote key (e.g. "toString") resolved Object.prototype's own method instead
 * of `undefined` — report-md.js and report-html.js have no fallback at all,
 * and matrix-model.js's `|| '?'` is defeated because a function is truthy.
 * Fixed on the table (`__proto__: null`), the same shape as tally.js's
 * VERDICTS (Task 1) and street-cred.js's perJudgeRank (Task 2).
 *
 * These fixtures are hand-built, alias-space (no seats table) documents —
 * the defect and its fix are keyed on the vote VALUE at three fixed
 * consumers, not on which space the roster is in; T17-T22 and SI-22.5 above
 * already cover the roster/column-space behaviour exhaustively.
 */
describe('SYMBOL is prototype-safe: an inherited/unknown vote key must not resolve off Object.prototype', () => {
  const RAISER = 'nobody'; // never equals the sole judge, so no '*' rides the cell and the glyph stays bare.

  /** ONE minimal verdict.json-shaped doc, one judge, one finding. */
  function verdictFor(vote) {
    return {
      runId: 't3-symbol', runType: 'headless', date: '2026-08-22',
      council: ['gpt'], claudeInCouncil: false,
      findings: [{ id: 'F1', raiser: RAISER, severity: 'major', tier: 'Contested',
        adjudications: [{ judge: 'gpt', verdict: vote }] }],
    };
  }
  /** The tally.json-shaped twin, for the workspace consumer. */
  function tallyFor(vote) {
    return {
      meta: { runId: 't3-symbol', runType: 'headless', date: '2026-08-22', models: ['gpt'] },
      findings: [{ id: 'F1', raiser: RAISER, severity: 'major', tier: 'Contested',
        adjudications: [{ judge: 'gpt', verdict: vote }] }],
    };
  }

  test('S1 — markdown: a vote of "toString" renders the SAME cell as a vote of "bogus"', () => {
    // ⚠️ Assert the EQUIVALENCE, not the literal. The literal is "undefined"
    // and is a separate, pre-existing defect (BASE already renders it for
    // ANY unknown verdict, "bogus" included) — out of scope here, and a test
    // hard-coding it would read as an endorsement of that rendering.
    const mdToString = buildReport({ verdict: verdictFor('toString') }, { format: 'md' });
    const mdBogus = buildReport({ verdict: verdictFor('bogus') }, { format: 'md' });
    expect(rowFor(mdToString, 'F1')).toBe(rowFor(mdBogus, 'F1'));
  });

  test('S2 — html: the same equivalence at the report-html.js consumer', () => {
    const htmlToString = buildReport({ verdict: verdictFor('toString') }, { format: 'html' });
    const htmlBogus = buildReport({ verdict: verdictFor('bogus') }, { format: 'html' });
    const rowToString = htmlToString.match(/<tr[^>]*><td>F1<\/td>.*?<\/tr>/)[0];
    const rowBogus = htmlBogus.match(/<tr[^>]*><td>F1<\/td>.*?<\/tr>/)[0];
    expect(rowToString).toBe(rowBogus);
  });

  test('S3 — buildMatrixModel: a vote of "toString" yields sym: "?" — the || fallback is no longer defeated', () => {
    // This one CAN assert the literal: '?' is the intended value here, not a
    // pre-existing defect shared with an ordinary unknown vote.
    const m = buildMatrixModel(tallyFor('toString'), {}, null);
    expect(m.rows[0].cells[0].sym).toBe('?');
  });

  test('S4 — the three real verdicts still render ✓ / ✗ / – at all three consumers', () => {
    for (const [vote, glyph] of [['agree', '✓'], ['dispute', '✗'], ['neutral', '–']]) {
      const md = buildReport({ verdict: verdictFor(vote) }, { format: 'md' });
      expect(rowFor(md, 'F1')).toBe(`| F1 | major | ${RAISER} | ${glyph} | Contested |  |`);
      const html = buildReport({ verdict: verdictFor(vote) }, { format: 'html' });
      expect(html).toContain(`<td class="c">${glyph}</td>`);
      const m = buildMatrixModel(tallyFor(vote), {}, null);
      expect(m.rows[0].cells[0].sym).toBe(glyph);
    }
  });
});

// Named mutant "PROTOSYMBOL": revert SYMBOL's literal to drop its null
// prototype (v4.8 Phase 6 PR1 Task 3, SI-24) — the report.js half of this
// task. Mirrors Task 1's PROTOVERDICT (a different READ-site table,
// tests/council/tally.test.js) and Task 2's PROTORANK (a WRITE-site table,
// tests/council/street-cred-mutants.js).
//   const SYMBOL = { __proto__: null, agree: '✓', dispute: '✗', neutral: '–' };
//   -> const SYMBOL = { agree: '✓', dispute: '✗', neutral: '–' };
//
// Introduced at this task. RED: 3 tests / 1 suite (command `npx jest
// --no-coverage`, the FULL suite, per this task's brief — a correction over
// Task 2's own brief, which mandated the narrower `tests/council/
// tests/workspace/` scope and mismeasured one red set as a shrink).
//   tests/council/seat-matrix.test.js — "S1 — markdown: a vote of 'toString'
//     renders the SAME cell as a vote of 'bogus'" · "S2 — html: the same
//     equivalence at the report-html.js consumer" · "S3 — buildMatrixModel:
//     a vote of 'toString' yields sym: '?' — the || fallback is no longer
//     defeated"
//
// ⚠️ WHY NOT 4: S4 (the three real verdicts) does NOT red. agree/dispute/
// neutral are OWN properties on SYMBOL either way, so a pin built entirely
// from real verdicts cannot see a mutation that only changes what happens to
// a key SYMBOL never owned.
//
// Measured with the concurrency guard this task was briefed on (a second
// agent was mutating src/council/street-cred.js in this same checkout):
// `git status --porcelain -- src/ tests/` immediately before AND after this
// run showed ONLY src/council/report.js (this mutation) modified — no
// contamination. Full-suite denominator at this measurement: 544 suites (543
// passed / 1 failed), 7844 tests (7833 passed / 3 failed / 8 skipped), 4
// snapshots passed and UNCHANGED (report-claude-column.test.js.snap and
// report-debate.test.js.snap included) — neither this mutation nor its
// hand-revert (byte-verified against `git show HEAD:src/council/report.js`,
// sha256 match) touched a snapshot.
//
// NO PIN THAT PRE-DATES THIS TASK REDS.
