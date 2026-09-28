// tests/council/conformance-none.test.js
'use strict';

/**
 * #244 residue — a runStats row says `clean` only when a check said so
 * (docs/superpowers/specs/2026-09-27-244-conformance-none-design.md).
 *
 * Driven end to end through runCouncil with the scripted launchers, so the value is
 * read where a user meets it — verdict.json — and not at the builder, which
 * run-stats-entry.test.js pins separately. One run carries both producers the fix
 * touches: gpt's Stage-1 leg dies (a dead-seat row built on the builder's default),
 * and qwen's Stage-2 judge leg dies (run-stage2-judge.js :: adjudicateJudgeLeg's
 * unusable-judge row). The living seat and judge are the controls: their rows keep
 * the value their own check produced. Five tests, one fact each, so each can be
 * seen failing on its own.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { runCouncil } = require('../../src/council/run');
const { buildLedgerRows, appendRun, deriveReliability } = require('../../src/council/ledger');
const { scriptedLaunchers, baseOptions, review, judgeOut, mkLeg, okWave } =
  require('./helpers/fake-launchers');

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'conformance-none-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const deps = (launchers, appendRunFn = jest.fn()) => ({ launchers, appendRunFn, statsFn: () => [],
  installSignalAbortFn: () => () => {} });

/** Runs the one council the five tests read; returns a (model, role) → rows lookup. A caller that
 *  passes `appendRunFn` receives the record the run hands the ledger. */
async function runWithDeadSeatAndDeadJudge(appendRunFn) {
  const spy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  try {
    const script = {
      // gpt's leg times out and its once-only retry returns no legs, so the seat is lost.
      'abc123-s1': () => okWave([
        mkLeg('gemini', review('gemini')),
        mkLeg('gpt', '', 'timeout'),
        mkLeg('qwen', review('qwen')),
      ], 2, 'partial'),
      'abc123-s1r1': () => okWave([]),
      // The survivors judge; qwen's judge leg dies. A dead judge never enters the repair
      // loop (it requires a completed leg with a summary), so no -q wave is launched.
      'abc123-s2': (o) => okWave(o.models.map(m => (m === 'qwen'
        ? mkLeg(m, '', 'error')
        : mkLeg(m, judgeOut(['Review A', 'Review B'], []))))),
      'abc123-ch1': (o) => okWave([mkLeg(o.model, 'Synthesis.\n\nVERDICT: Ship it')]),
    };
    const opts = baseOptions(tmp);
    await runCouncil(opts, deps(scriptedLaunchers(script), appendRunFn));
    const verdict = JSON.parse(fs.readFileSync(path.join(opts.runDir, 'verdict.json'), 'utf-8'));
    return (model, role) => verdict.runStats.filter(r => r.model === model && r.role === role);
  } finally { spy.mockRestore(); }
}

test('a dead Stage-1 seat reads conformance none in verdict.json, not clean', async () => {
  const rows = await runWithDeadSeatAndDeadJudge();
  expect(rows('gpt', 'seat').length).toBeGreaterThan(0);          // non-vacuity: the row exists
  expect(rows('gpt', 'seat').map(r => r.conformance)).toEqual(rows('gpt', 'seat').map(() => 'none'));
});

test('a model whose only leg died gets a none ledger row and a none count in council stats, not clean (spec §6)', async () => {
  const appendRunFn = jest.fn();
  await runWithDeadSeatAndDeadJudge(appendRunFn);
  expect(appendRunFn).toHaveBeenCalledTimes(1);   // non-vacuity: the run handed the ledger its record
  const record = appendRunFn.mock.calls[0][0];
  appendRun(record, { dir: tmp });                 // the test's own temp dir, never the config dir
  const ledger = buildLedgerRows(record).filter(r => r.model === 'gpt').map(r => r.conformance);
  const stats = deriveReliability({ dir: tmp }).filter(m => m.aliases.includes('gpt')).map(m => m.conformance);
  // One assertion over both hops, so a failure shows what each hop read.
  expect([ledger, stats]).toEqual([['none'], [{ none: 1 }]]);
});

test('a dead Stage-2 judge reads conformance none in verdict.json, not clean', async () => {
  const rows = await runWithDeadSeatAndDeadJudge();
  expect(rows('qwen', 'judge').map(r => [r.status, r.conformance])).toEqual([['error', 'none']]);
});

test('controls: the completed seat and the completed judge keep the value their check found', async () => {
  const rows = await runWithDeadSeatAndDeadJudge();
  expect(rows('gemini', 'seat').map(r => r.conformance)).toEqual(['clean']);
  expect(rows('gemini', 'judge').map(r => r.conformance)).toEqual(['clean']);
});

test('a completed seat whose own judge died keeps its review\'s value through the Stage-1 × Stage-2 merge (named mutant NONEOUTRANKS)', async () => {
  const rows = await runWithDeadSeatAndDeadJudge();
  // qwen reviewed in Stage 1 and its own judge leg died. run.js :: runCouncil merges each
  // review with its own judge row by worst-wins (worseConformance(review, judge)), so the
  // judge's `none` must never replace the review's `clean` (spec §6). NONEOUTRANKS: rank
  // `none` above `clean` in run-assemble.js's CONFORMANCE_RANK (for example `none: 3`).
  expect(rows('qwen', 'seat').map(r => r.conformance)).toEqual(['clean']);
});
