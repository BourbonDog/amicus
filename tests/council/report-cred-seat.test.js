// tests/council/report-cred-seat.test.js
'use strict';

/**
 * @module tests/council/report-cred-seat
 * v4.8 SI-22.4 / T-22.4.3 (R22.4-6) — the street-cred row label in BOTH
 * renderers is `s.seat || s.model`, not `s.model`.
 *
 * THE DEFECT, measured at BASE `276d5a18` by loading that commit's own
 * `report-md.js` and rendering the TWIN fixture below through it:
 *
 *   | gemini | 1.00 | 1.33 |
 *   | gemini | 2.00 | 2.00 |
 *
 * Two different scores under one identical label, with nothing in the document
 * to say which seat each belongs to. `street-cred.js :: computeStreetCred`
 * emits ONE ROW PER SEAT, so a twin bench necessarily produces same-`model`
 * rows; the rows already carry `seat` (`credSeats`: `seat: id === m ? null :
 * id`), so the fix is the same `|| ` fallback SI-25 used at the chair packet's
 * rendering sites.
 *
 * WHY IT RIDES SI-22.4. The rider was deferred twice as "SI-25-adjacent" — an
 * association, not a schedule. It belongs to THIS change because SI-22.4 is what
 * makes a twin bench reachable from a saved `--council` preset (a padded member
 * now collides with its unpadded sibling instead of standing as a second
 * alias), so this is the first release in which an ordinary preset user can
 * print the ambiguous table. tests/council/preset-trim-twin-bench.test.js drives
 * that path end to end.
 *
 * BYTE-IDENTITY, measured the same way rather than argued: `seat` is
 * emit-when-DIFFERENT, so a unique-alias bench has no `seat` field and both
 * renderers write exactly what they wrote before. BASE's `renderMd` and HEAD's
 * returned the same 733 bytes on the UNIQ fixture, and BASE's `renderHtml` and
 * HEAD's the same 9667 — full documents, not just the block. The literals below
 * are those bytes. The two full report snapshots (report-claude-column,
 * report-debate) are unique-alias documents and guard the same property
 * independently.
 *
 * ONE TEST PER RENDERER, deliberately — a shared assertion would let either
 * regress silently (the rule report-html.js's R8 marker note already states).
 *
 * Named mutant: tests/council/preset-trim-mutants.js :: CREDALIAS.
 */

const { toModel } = require('../../src/council/report');
const { renderMd } = require('../../src/council/report-md');
const { renderHtml } = require('../../src/council/report-html');
const { computeStreetCred } = require('../../src/council/street-cred');

// The street-cred rows are DERIVED by the real producer, never hand-written, so
// these pins cannot pass against a shape computeStreetCred does not emit; the
// renderable model is then built by the real `toModel`.
//
// ⚠️ THE TWIN FIXTURE IS DELIBERATELY ASYMMETRIC. A two-seat twin bench where
// each seat judges the other is symmetric by construction — both rows come back
// with identical numbers (measured: peers-only 1.00, with-self 1.50 on both),
// and the ambiguity this rider fixes would not be visible at all. The third
// seat (`gpt`, a unique alias) breaks that symmetry, and it earns its place
// twice over: it makes the two `gemini` rows differ, and it puts a SEAT-LESS
// row in the same table, so the `|| s.model` half of the fallback is exercised
// beside the `s.seat` half.
const TWIN_MODELS = ['gemini', 'gemini', 'gpt'];
const TWIN_SEATS = [{ id: 'gemini#1', alias: 'gemini' }, { id: 'gemini#2', alias: 'gemini' },
  { id: 'gpt', alias: 'gpt' }];
const TWIN_RANKINGS = [
  { judge: 'gemini', seat: 'gemini#1', order: ['gemini', 'gemini', 'gpt'],
    orderSeats: ['gemini#2', 'gemini#1', 'gpt'] },
  { judge: 'gemini', seat: 'gemini#2', order: ['gemini', 'gemini', 'gpt'],
    orderSeats: ['gemini#1', 'gemini#2', 'gpt'] },
  // Unique alias ⇒ `rankings[].seat` is emit-when-DIFFERENT and therefore absent.
  { judge: 'gpt', order: ['gemini', 'gpt', 'gemini'],
    orderSeats: ['gemini#1', 'gpt', 'gemini#2'] },
];
const UNIQ_RANKINGS = [
  { judge: 'gemini', order: ['gpt', 'gemini'] },
  { judge: 'gpt', order: ['gemini', 'gpt'] },
];

const twinCred = () => computeStreetCred(TWIN_RANKINGS, TWIN_MODELS, TWIN_SEATS);
const uniqCred = () => computeStreetCred(UNIQ_RANKINGS, ['gemini', 'gpt'], null);

const twinModel = () => toModel({ findings: [], council: TWIN_MODELS, seats: TWIN_SEATS,
  streetCred: twinCred(), runId: 'r', date: '2026-08-23', chair: 'deepseek' });
const uniqModel = () => toModel({ findings: [], council: ['gemini', 'gpt'],
  streetCred: uniqCred(), runId: 'r', date: '2026-08-23', chair: 'deepseek' });

describe('T-22.4.3: the producer really hands the renderers two same-alias rows', () => {
  test('a twin bench yields same-model rows with distinct seats and distinct numbers', () => {
    const rows = twinCred();
    expect(rows.map(r => r.model)).toEqual(['gemini', 'gemini', 'gpt']);
    expect(rows.map(r => r.seat)).toEqual(['gemini#1', 'gemini#2', undefined]);
    // Different numbers under that identical `model` — the ambiguity itself.
    expect(rows[0].peersOnly).not.toBe(rows[1].peersOnly);
  });

  test('a unique-alias bench yields NO seat field at all', () => {
    for (const r of uniqCred()) { expect('seat' in r).toBe(false); }
  });
});

describe('T-22.4.3: report-md.js', () => {
  test('a twin bench renders two DISTINGUISHABLE street-cred rows', () => {
    const md = renderMd(twinModel());
    expect(md).toContain([
      '| Model | peers-only | with-self |',
      '|---|---|---|',
      '| gemini#1 | 1.00 | 1.33 |',
      '| gemini#2 | 2.00 | 2.00 |',
      '| gpt | 3.00 | 2.67 |',
    ].join('\n'));
    // BASE wrote `| gemini | …` twice here. Neither ambiguous row survives.
    expect(md).not.toMatch(/^\| gemini \| /m);
  });

  test('a unique-alias bench renders BYTE-IDENTICALLY to the pre-rider output', () => {
    expect(renderMd(uniqModel())).toContain([
      '## Street-cred (peers-only; lower = better)',
      '',
      '| Model | peers-only | with-self |',
      '|---|---|---|',
      '| gemini | 1.00 | 1.50 |',
      '| gpt | 1.00 | 1.50 |',
    ].join('\n'));
  });
});

describe('T-22.4.3: report-html.js', () => {
  test('a twin bench renders two DISTINGUISHABLE street-cred rows', () => {
    const html = renderHtml(twinModel());
    expect(html).toContain(
      '<tr><td>gemini#1</td><td>1.00</td><td>1.33</td></tr>' +
      '<tr><td>gemini#2</td><td>2.00</td><td>2.00</td></tr>' +
      '<tr><td>gpt</td><td>3.00</td><td>2.67</td></tr>');
    expect(html).not.toContain('<tr><td>gemini</td><td>');
  });

  test('a unique-alias bench renders BYTE-IDENTICALLY to the pre-rider output', () => {
    expect(renderHtml(uniqModel())).toContain(
      '<h2>Street-cred <span class="meta">(peers-only; lower = better)</span></h2>\n' +
      '<table><tr><th>Model</th><th>peers-only</th><th>with-self</th></tr>' +
      '<tr><td>gemini</td><td>1.00</td><td>1.50</td></tr>' +
      '<tr><td>gpt</td><td>1.00</td><td>1.50</td></tr></table>');
  });
});
