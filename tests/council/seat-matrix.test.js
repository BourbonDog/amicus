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
const { buildReport, SYMBOL } = require('../../src/council/report');
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
    expect(rowFor(md, 'B1')).toBe('| B1 | major | gemini#2 | ✓ | ✓* | Confirmed |  |');
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

describe('T22: the two orphaned-seat shapes, pinned as DISCLOSED behaviour (§4.6)', () => {
  // Shape 1 — a JUDGE's Stage-2 seat orphaned. The raiser is a unique alias, so
  // `raiserSeat` is absent and tally's guard is a pure alias compare: BOTH twin
  // votes count in `basis`, but the seat-less one keys to the bare alias
  // `gemini`, which no seat column reads. It is counted and rendered nowhere.
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

  test('shape 1 (judge seat orphaned): the vote counts in basis and renders NOWHERE', () => {
    const record = tally(orphanJudge);
    const verdict = buildVerdict(record, []);
    const md = buildReport({ verdict }, { format: 'md' });
    expect(headerFor(md)).toBe('| Finding | Sev | Raiser | gemini#1 | gemini#2 | gpt | Tier | Decision |');
    expect(rowFor(md, 'A1')).toBe('| A1 | major | gpt | ✓ |   |  * | Contested |  |');
    // The DISCLOSED divergence, asserted rather than assumed: basis counts the
    // orphaned dispute, the row cannot show it. A future fix must edit this
    // line deliberately, not discover the gap in production.
    expect(verdict.findings[0].basis).toEqual({ a: 1, d: 1, n: 0 });
    expect(renderedBasis(rowFor(md, 'A1'), 3)).toEqual({ a: 1, d: 0, n: 0 });
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
