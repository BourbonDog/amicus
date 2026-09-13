// tests/council/report-unverified.test.js
'use strict';

/**
 * #242 / spec §5 (v4.9.8, PR 3 of 3): the report surfaces what the tally already knows.
 *
 * `run-stages.js :: runStage1` marks a review `findingsUnverified: true` when the ORIGINAL
 * response carried no parseable findings block — the bounded repair's contract ("the same
 * findings, fixed") could not be checked — and `repairRefused: {code, detail}` when the
 * contract was checked and broken. Both ride the runStats row through tally.json into
 * verdict.json (tally.js's allowlist) and, before this change, died at the renderer: "What was
 * lost" was built from the sink's `degrades[]` alone. Study run D0 (2026-09-11) is the fixture:
 * three narration stubs, three repairs, `3 of 3` reviewed, and report.html said nothing.
 *
 * Rows are derived from `verdict.runStats` at RENDER time (`report-lost-rows.js ::
 * lostRowsOf`), appended to the model's `degrades` AFTER the sink's own records, and rendered
 * through `formatDegrade` — the one voice — by both renderers untouched. Nothing is written to
 * run.json or verdict.json, so re-rendering a pre-4.9.8 verdict.json shows the rows too (the D0
 * verdict.json on disk IS such a document: its census is the old `{reviewed, of}`).
 *
 * The wording never says "stub": the flag also fires on a real 19,064-byte review whose
 * trailing JSON block was malformed (study run B2, qwen-flash).
 *
 * Named mutants (exact edits in src/council/report-lost-rows.js; red sets measured on the
 * committed tree and recorded here by the implementer):
 *   ROWALWAYS   — `if (r.findingsUnverified === true) { rows.push(unverifiedRow(r)); }`
 *                 → `rows.push(unverifiedRow(r));` (every row becomes a loss). Red set (10 of
 *                 72): "D0: one unverified-repair row per flagged seat, in runStats order, as
 *                 frozen makeDegrade records", "a refused repair gets a repair-refused row
 *                 naming the code, with the detail as the why", "a refused repair with no
 *                 code/detail (hand-assembled input) still renders, with fallbacks",
 *                 "emit-when-TRUE, matching the producer: a truthy non-boolean flag is not a
 *                 flag, a string repairRefused is not a refusal", "tolerates every schema-free
 *                 shape the report entry points can deliver", 'never says "stub", and both
 *                 channels are registered (the degrade-contract drift pin reads src/)', "the
 *                 fixture is the pre-4.9.8 verdict.json — the rows come from runStats, not from
 *                 a rebuild", "html: the section table carries the channel column and the voice
 *                 line", "av-receiver (three rows, no flags): no rows, no section — GREEN at
 *                 HEAD by construction, pinned by ROWALWAYS", and "D0 with its three flags
 *                 stripped renders to the same byte LENGTHS main 5541bb44 produced (md 2007 /
 *                 html 12560; content is pinned by the report snapshots)".
 *   REFUSEDDROP — the `if (isPlainObject(r.repairRefused)) { rows.push(refusedRow(r)); }` statement removed.
 *                 Red set (4 of 72): "a refused repair gets a repair-refused row naming the
 *                 code, with the detail as the why", "a refused repair with no code/detail
 *                 (hand-assembled input) still renders, with fallbacks", "a row carrying BOTH
 *                 facts yields both rows, unverified first — the exclusivity is the producer's,
 *                 not the renderer's", and 'never says "stub", and both channels are registered
 *                 (the degrade-contract drift pin reads src/)'.
 */

const fs = require('fs');
const path = require('path');
const { buildReport, toModel } = require('../../src/council/report');
const { buildVerdict } = require('../../src/council/verdict');
const { tally } = require('../../src/council/tally');
const { lostRowsOf } = require('../../src/council/report-lost-rows');
const { formatDegrade, DEGRADE_CHANNELS } = require('../../src/utils/degrade');
const avInput = require('./fixtures/av-receiver-input');

const FX = path.join(__dirname, 'fixtures', 'study-d0');
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(FX, name), 'utf-8'));

const base = (extra) => ({
  schemaVersion: 2, type: 'council-verdict', runId: 'r1', runType: 'council',
  date: '2026-09-13', chair: 'deepseek', council: ['alpha', 'beta'],
  claudeInCouncil: false, overallVerdict: null,
  findings: [], streetCred: [], runStats: [],
  tierCounts: { Confirmed: 0, Contested: 0, Singleton: 0, Disputed: 0 },
  ...extra,
});
const seatRow = (model, extra) => ({ model, role: 'seat', wasChair: false, conformance: 'clean',
  status: 'complete', durationMs: 1, usage: null, ...extra });
const DEAD_LEG = {
  kind: 'degrade', channel: 'dead-leg', what: 'seat beta did not review',
  why: "the leg ended 'timeout' with no usable output", effect: '1 of 2 seats reviewed',
};

// The exact voice line (formatDegrade output without its trailing newline). Task 3's docs and
// CHANGELOG quote the what/why/effect; a paraphrase anywhere is a defect.
const UNVERIFIED_LINE = (seat) => `Notice: seat ${seat}'s findings came from a repair of a response with no findings block — nothing verified them. the tiers they were given rest on the repair alone; the seat still counts as reviewed.`;
const REFUSED_LINE = "Notice: seat beta's repair was refused (REPAIR_CHANGED_FINDING_COUNT) — repair returned 2 findings, original attempted 3. the seat contributed no findings; its review text still reached the judges and it counts as reviewed.";

describe('lostRowsOf — the rows the tally already knows (#242, spec §5)', () => {
  test('D0: one unverified-repair row per flagged seat, in runStats order, as frozen makeDegrade records', () => {
    const rows = lostRowsOf(readJson('tally.json').runStats);
    expect(rows.map(r => r.channel)).toEqual(['unverified-repair', 'unverified-repair', 'unverified-repair']);
    expect(rows.map(r => r.data.seat)).toEqual(['kimi', 'grok', 'qwen']);
    for (const r of rows) {
      expect(r.kind).toBe('degrade');
      expect(Object.isFrozen(r)).toBe(true);
      expect(formatDegrade(r)).toBe(`${UNVERIFIED_LINE(r.data.seat)}\n`);
    }
  });

  test('a refused repair gets a repair-refused row naming the code, with the detail as the why', () => {
    const rows = lostRowsOf([seatRow('beta', { conformance: 'unstructured',
      repairRefused: { code: 'REPAIR_CHANGED_FINDING_COUNT', detail: 'repair returned 2 findings, original attempted 3' } })]);
    expect(rows).toHaveLength(1);
    expect(rows[0].channel).toBe('repair-refused');
    expect(rows[0].data).toEqual({ seat: 'beta', code: 'REPAIR_CHANGED_FINDING_COUNT' });
    expect(formatDegrade(rows[0])).toBe(`${REFUSED_LINE}\n`);
  });

  test('a refused repair with no code/detail (hand-assembled input) still renders, with fallbacks', () => {
    const rows = lostRowsOf([seatRow('beta', { repairRefused: {} })]);
    expect(rows).toHaveLength(1);
    expect(rows[0].what).toBe("seat beta's repair was refused (REPAIR_REFUSED)");
    expect(rows[0].why).toBe('the repair broke its contract');
    expect(rows[0].data).toEqual({ seat: 'beta', code: 'REPAIR_REFUSED' });

    // The fallback isn't just for ABSENT code/detail: a non-string pair and a
    // whitespace-only/empty pair both fall back the same way.
    for (const bad of [{ code: 42, detail: 7 }, { code: '   ', detail: '' }]) {
      const r = lostRowsOf([seatRow('beta', { repairRefused: bad })])[0];
      expect(r.what).toBe("seat beta's repair was refused (REPAIR_REFUSED)");
      expect(r.why).toBe('the repair broke its contract');
    }

    // An array is not a refusal — isPlainObject refuses it, same as any other non-plain-object.
    expect(lostRowsOf([seatRow('beta', { repairRefused: ['REPAIR_CHANGED_FINDING_COUNT'] })])).toEqual([]);
  });

  test('the seat LABEL is the seat id when the bench repeats an alias, else the alias (the street-cred rule)', () => {
    const rows = lostRowsOf([seatRow('kimi', { seat: 'kimi#2', findingsUnverified: true }),
      seatRow('grok', { findingsUnverified: true })]);
    expect(rows.map(r => r.data.seat)).toEqual(['kimi#2', 'grok']);
    expect(rows[0].what).toContain("seat kimi#2's");
  });

  test("a row carrying BOTH facts yields both rows, unverified first — the exclusivity is the producer's, not the renderer's", () => {
    const rows = lostRowsOf([seatRow('x', { findingsUnverified: true, repairRefused: { code: 'C', detail: 'd' } })]);
    expect(rows.map(r => r.channel)).toEqual(['unverified-repair', 'repair-refused']);
  });

  test('emit-when-TRUE, matching the producer: a truthy non-boolean flag is not a flag, a string repairRefused is not a refusal', () => {
    expect(lostRowsOf([seatRow('x', { findingsUnverified: 'yes' }), seatRow('y', { findingsUnverified: 1 })])).toEqual([]);
    expect(lostRowsOf([seatRow('z', { repairRefused: 'REPAIR_CHANGED_FINDING_COUNT' })])).toEqual([]);
  });

  test('tolerates every schema-free shape the report entry points can deliver', () => {
    for (const bad of [undefined, null, {}, 'runStats', 42, [], [null, 42, 'x', {}, [], true]]) {
      expect(lostRowsOf(bad)).toEqual([]);
    }
    // A flagged row with neither `seat` nor `model` still renders — seatLabel's final
    // fallback, otherwise unreached by any test in this file.
    expect(lostRowsOf([{ findingsUnverified: true }])[0].data.seat).toBe('unknown');
  });

  test('never says "stub", and both channels are registered (the degrade-contract drift pin reads src/)', () => {
    const rows = lostRowsOf(readJson('tally.json').runStats)
      .concat(lostRowsOf([seatRow('b', { repairRefused: { code: 'C', detail: 'd' } })]));
    expect(rows).toHaveLength(4);
    for (const r of rows) { expect(`${r.what} ${r.why} ${r.effect}`).not.toMatch(/stub/i); }
    expect(DEGRADE_CHANNELS.has('unverified-repair')).toBe(true);
    expect(DEGRADE_CHANNELS.has('repair-refused')).toBe(true);
  });
});

describe('the report renders the rows through the one voice, in both formats', () => {
  const verdict = readJson('verdict.json'); // the PRE-4.9.8 document: census {reviewed, of}

  test('the fixture is the pre-4.9.8 verdict.json — the rows come from runStats, not from a rebuild', () => {
    expect(verdict.seatsReviewed).toEqual({ reviewed: 3, of: 3 });
    expect('degrades' in verdict).toBe(false);
    const m = toModel(verdict);
    expect(m.degrades.map(d => d.data.seat)).toEqual(['kimi', 'grok', 'qwen']);
    expect(m.notes).toEqual([]);
  });

  test('md: a What-was-lost section between the tier table and the matrix, one line per seat', () => {
    const md = buildReport({ verdict }, { format: 'md' });
    const lost = md.indexOf('## What was lost');
    expect(lost).toBeGreaterThan(md.indexOf('_Tiers report peer concurrence, never verification._'));
    expect(lost).toBeLessThan(md.indexOf('## Adjudication matrix'));
    for (const seat of ['kimi', 'grok', 'qwen']) { expect(md).toContain(`- ${UNVERIFIED_LINE(seat)}`); }
  });

  test('html: the section table carries the channel column and the voice line', () => {
    const html = buildReport({ verdict }, { format: 'html' });
    expect(html).toContain('<h2>What was lost</h2>');
    expect((html.match(/<td>unverified-repair<\/td>/g) || []).length).toBe(3);
    expect(html).toContain(`<td>${UNVERIFIED_LINE('kimi')}</td>`);
  });

  test("the sink's own records come FIRST; the runStats rows are appended after them", () => {
    const v = base({ degrades: [DEAD_LEG], runStats: [seatRow('alpha', { findingsUnverified: true })] });
    expect(toModel(v).degrades.map(d => d.channel)).toEqual(['dead-leg', 'unverified-repair']);
    const md = buildReport({ verdict: v }, { format: 'md' });
    expect(md.indexOf('seat beta did not review')).toBeLessThan(md.indexOf("seat alpha's findings"));
  });

  test('a heal or info record is still not a loss; an unverified row still is', () => {
    const v = base({
      degrades: [{ kind: 'info', channel: 'ledger-skipped', what: 'w', why: 'y', effect: 'e' },
        { kind: 'heal', channel: 'stage1-retry', what: 'h', why: 'y', effect: 'e' }],
      runStats: [seatRow('alpha', { findingsUnverified: true })],
    });
    const m = toModel(v);
    expect(m.notes.map(d => d.channel)).toEqual(['ledger-skipped']);
    expect(m.degrades.map(d => d.channel)).toEqual(['unverified-repair']);
  });
});

describe('byte-identity: a verdict with no flagged row renders exactly as before (mutant ROWALWAYS)', () => {
  test('av-receiver (three rows, no flags): no rows, no section — GREEN at HEAD by construction, pinned by ROWALWAYS', () => {
    const v = buildVerdict(tally(avInput), []);
    expect(v.runStats.length).toBeGreaterThan(0);
    expect(toModel(v).degrades).toEqual([]);
    for (const format of ['md', 'html']) {
      expect(buildReport({ verdict: v }, { format })).not.toContain('What was lost');
    }
  });

  test('D0 with its three flags stripped renders to the same byte LENGTHS main 5541bb44 produced (md 2007 / html 12560; content is pinned by the report snapshots)', () => {
    // Measured 2026-09-13 on main 5541bb44, before this change, on this same fixture: the
    // renderer must not move a single byte of an unflagged document. If this reddens with a
    // different length while lostRowsOf is untouched, something ELSE changed the renderer —
    // stop and say so rather than re-pinning the number.
    const v = JSON.parse(JSON.stringify(readJson('verdict.json')));
    for (const r of v.runStats) { delete r.findingsUnverified; delete r.repairRefused; }
    const md = buildReport({ verdict: v }, { format: 'md' });
    const html = buildReport({ verdict: v }, { format: 'html' });
    expect(md).not.toContain('What was lost');
    expect(`md ${Buffer.byteLength(md)} html ${Buffer.byteLength(html)}`).toBe('md 2007 html 12560');
  });
});
