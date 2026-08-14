// tests/council/seat-parity-ondisk.test.js
'use strict';

/**
 * v4.8 PR3 — the ON-DISK legacy-parity pin (plan §3.5).
 *
 * PR3's whole promise is that a bench with **no repeated alias** writes exactly
 * the documents it wrote before: every new field (`adjudications[].seat`,
 * `findings[].raiserSeat`, `revotes[].seat`) is emit-when-DIFFERENT, and on a
 * unique bench a seat id IS its alias, so none of them is ever emitted.
 *
 * That promise was verified out-of-tree only — three separate sha256 sweeps
 * across ad8c83c/057a9dc/18dc0e9 — and out-of-tree evidence does not ship.
 * Nothing in the suite read a run's real `tally-input.json` / `tally.json` /
 * `verdict.json` / `debate.json` off disk and compared their KEY SETS against
 * an expectation, which is why mutating any one of the three
 * emit-when-different guards to emit unconditionally survived all 520 suites.
 *
 * This drives the real `runCouncil` (`--debate`, fake launchers) end to end and
 * pins the shipped shape of all five documents it writes (v4.8 PR4c added
 * tally-provisional.json, the fifth on the same seam). Key sets are asserted exactly,
 * not by `toContain`: an added key is the mutation this exists to catch, and a
 * REMOVED key is an unreviewed artifact-shape change of the same weight.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { runCouncil } = require('../../src/council/run');
const {
  debateScript, review, judgeOut, mkLeg, okWave, launchersFromScript, baseOptions,
} = require('./helpers/fake-launchers');

// The keys a unique-alias bench must NEVER write, matched in KEY position
// (`"seat":`) rather than as a bare token — every runStats row legitimately
// carries the VALUE `"role": "seat"`, so a token match is a false positive.
// `__unbound-` is §3.4's roster placeholder id and is never a legal substring
// of any document this bench produces.
// `"seats":` is v4.8 PR4c §3.2's seat table. It is the END-TO-END half of T8:
// `...(seats ? …)` — the vacuous guard, which the engine ALWAYS satisfies
// because run.js sets o.seats unconditionally and buildSeats always returns an
// array — writes a full table into tally-input.json, tally.json and
// verdict.json on every unique-alias bench. This is a --debate run, so
// tally-provisional.json (run-debate-stage.js:45) is a FIFTH document on that
// same seam; it is read below for exactly that reason.
const FORBIDDEN = ['"seat":', '"raiserSeat":', '"seats":', '__unbound-'];

/** The union of every row's key set, sorted — one row shape or a real skew. */
function keyUnion(rows) {
  const keys = new Set();
  for (const r of rows) { for (const k of Object.keys(r)) { keys.add(k); } }
  return [...keys].sort();
}

describe('unique-alias bench: on-disk artifact parity (plan §3.5)', () => {
  let tmp, docs, raw;

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'seat-parity-ondisk-'));
    const { exitCode } = await runCouncil({
      briefing: 'Review X', models: ['gemini', 'gpt', 'qwen'], chair: 'deepseek',
      project: tmp, runId: 'r', runDir: tmp, date: '2026-07-19', debate: true,
    }, { launchers: debateScript(), appendRunFn: () => {} });
    // A degraded run would skip artifacts and make every pin below vacuous.
    expect(exitCode).toBe(0);
    raw = {};
    docs = {};
    for (const f of ['tally-input.json', 'tally.json', 'verdict.json', 'debate.json',
      'tally-provisional.json']) {
      raw[f] = fs.readFileSync(path.join(tmp, f), 'utf-8');
      docs[f] = JSON.parse(raw[f]);
    }
  });

  test('all five documents exist and none contains a seat key or a placeholder id', () => {
    const hits = [];
    for (const [name, text] of Object.entries(raw)) {
      for (const needle of FORBIDDEN) { if (text.includes(needle)) { hits.push(`${name} contains ${needle}`); } }
    }
    expect(hits).toEqual([]);
  });

  test('tally-input.json: adjudications and findings carry the pre-PR3 key sets exactly', () => {
    const doc = docs['tally-input.json'];
    expect(doc.adjudications.length).toBeGreaterThan(0);
    expect(keyUnion(doc.adjudications)).toEqual(['findingId', 'judge', 'verdict']);
    expect(keyUnion(doc.findings)).toEqual(['claim', 'id', 'location', 'raiser', 'severity']);
  });

  test('tally.json: the tally record adds no seat column to votes or findings', () => {
    const doc = docs['tally.json'];
    const votes = doc.findings.flatMap(f => f.adjudications || []);
    expect(votes.length).toBeGreaterThan(0);
    expect(keyUnion(votes)).toEqual(['judge', 'verdict']);
    expect(keyUnion(doc.findings)).not.toContain('raiserSeat');
    // Every debate row is still ALIAS-keyed, so the ledger join is intact.
    for (const r of doc.runStats) { expect(doc.meta.models.concat(doc.meta.chair)).toContain(r.model); }
  });

  test('verdict.json: findings and their adjudications carry no seat field', () => {
    const doc = docs['verdict.json'];
    const votes = doc.findings.flatMap(f => f.adjudications || []);
    expect(votes.length).toBeGreaterThan(0);
    expect(keyUnion(votes)).toEqual(['judge', 'verdict']);
    expect(keyUnion(doc.findings)).not.toContain('raiserSeat');
  });

  // This is the pin that kills the `alias !== key` -> `key` mutation at
  // run-debate.js's revotesJson push: that mutant adds `seat` to EVERY row of
  // EVERY unique-alias bench's debate.json.
  test('debate.json: revotes[] rows are exactly {judge,id,verdict,reason,applied}, with NO seat', () => {
    const doc = docs['debate.json'];
    expect(doc.revotes.length).toBeGreaterThan(0);
    for (const r of doc.revotes) {
      expect(Object.keys(r)).toEqual(['judge', 'id', 'verdict', 'reason', 'applied']);
    }
    // `raiser` on a debate finding is the RAISING SEAT's id (debate.js's
    // debateTargets keys byRaiser on `f.raiserSeat || f.raiser`) — on this
    // bench that id is byte-equal to the alias, which is the parity claim.
    expect(doc.findings.length).toBeGreaterThan(0);
    for (const f of doc.findings) { expect(['gemini', 'gpt', 'qwen']).toContain(f.raiser); }
  });
});

/**
 * v4.8 PR4c §3.2 — the OTHER half, and the one the plan named no test for.
 *
 * `run.js`'s `mkInput` is the single production seam `meta.seats` enters
 * through; every §5 test for §3.2 (T8/T8b/T9/T9b/T10) calls `buildTallyInput`
 * or `buildVerdict` DIRECTLY. Measured before this file was written: deleting
 * `seats: o.seats` from that call — which ships the whole feature dead on the
 * engine path — passed 91 suites / 1551 tests of tests/council + tests/workspace.
 * That is Task 1's T14c failure class (an owner ruling indistinguishable from
 * its revert) repeating on §3.2's own step 2, so the pin is on-disk and
 * end-to-end rather than on the unit.
 *
 * Scope, stated rather than assumed: this run has no `--debate`, so
 * `tally-provisional.json` is not among the documents read. It rides the same
 * `mkInput` return value (run.js's provisional tally) and needs no separate
 * seam; the unique-alias describe above IS a --debate run, so the
 * never-emit direction is covered on all five documents.
 */
describe('twin bench: the seat table reaches disk (§3.2, the run.js seam)', () => {
  let docs;

  beforeAll(async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'seat-parity-twin-'));
    const runId = 'twin02';
    const script = {
      [`${runId}-s1`]: (opts) => okWave(opts.models.map(m => mkLeg(m, review(m)))),
      [`${runId}-s2`]: () => okWave([
        mkLeg('gemini', judgeOut(['Review B', 'Review A'],
          [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'agree' }])),
        mkLeg('gemini', judgeOut(['Review A', 'Review B'],
          [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'agree' }])),
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
    expect(exitCode).toBe(0);
    docs = {};
    for (const f of ['tally-input.json', 'tally.json', 'verdict.json']) {
      docs[f] = JSON.parse(fs.readFileSync(path.join(opts.runDir, f), 'utf-8'));
    }
  });

  const EXPECTED = [
    { id: 'gemini#1', alias: 'gemini', role: 'seat', lens: null, position: 1 },
    { id: 'gemini#2', alias: 'gemini', role: 'seat', lens: null, position: 2 },
  ];

  test('tally-input.json and tally.json carry meta.seats verbatim', () => {
    expect(docs['tally-input.json'].meta.seats).toEqual(EXPECTED);
    expect(docs['tally.json'].meta.seats).toEqual(EXPECTED);
    // The table is what makes the ids the same run already writes RESOLVABLE —
    // otherwise this document names seats nothing in it defines.
    expect(docs['tally.json'].findings.map(f => f.raiserSeat).sort())
      .toEqual(['gemini#1', 'gemini#2']);
  });

  test('verdict.json carries them under `seats`, the name PR5 codes against', () => {
    const v = docs['verdict.json'];
    expect(v.seats).toEqual(EXPECTED);
    // …and NOT positionally joinable to `council`, which is the ALIAS list.
    expect(v.council).toEqual(['gemini', 'gemini']);
  });
});
