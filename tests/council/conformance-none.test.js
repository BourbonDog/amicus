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
 * the value their own check produced. Three tests, one fact each, so each can be
 * seen failing on its own.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { runCouncil } = require('../../src/council/run');
const { scriptedLaunchers, baseOptions, review, judgeOut, mkLeg, okWave } =
  require('./helpers/fake-launchers');

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'conformance-none-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const deps = (launchers) => ({ launchers, appendRunFn: jest.fn(), statsFn: () => [],
  installSignalAbortFn: () => () => {} });

/** Runs the one council the three tests read; returns a (model, role) → rows lookup. */
async function runWithDeadSeatAndDeadJudge() {
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
    await runCouncil(opts, deps(scriptedLaunchers(script)));
    const verdict = JSON.parse(fs.readFileSync(path.join(opts.runDir, 'verdict.json'), 'utf-8'));
    return (model, role) => verdict.runStats.filter(r => r.model === model && r.role === role);
  } finally { spy.mockRestore(); }
}

test('a dead Stage-1 seat reads conformance none in verdict.json, not clean', async () => {
  const rows = await runWithDeadSeatAndDeadJudge();
  expect(rows('gpt', 'seat').length).toBeGreaterThan(0);          // non-vacuity: the row exists
  expect(rows('gpt', 'seat').map(r => r.conformance)).toEqual(rows('gpt', 'seat').map(() => 'none'));
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
