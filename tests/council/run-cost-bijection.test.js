// tests/council/run-cost-bijection.test.js
'use strict';

/**
 * @module tests/council/run-cost-bijection
 * v4.7 D5 — "the count is the count": the leg-row bijection invariant this
 * whole PR (CA-4) was built toward. Every council leg that gets `ctx.addWave`'d
 * (and therefore counted into run.json's terminal `usage` block, via
 * run-budget.js's usageBlock() -> sumWaveUsage(allLegs)) must appear on
 * EXACTLY ONE tally.json runStats row — no leg silently dropped from the
 * total, no leg double-counted, no row inventing money nobody spent.
 *
 * Each scenario below drives a FULL `runCouncil` through fake launchers (the
 * same DI seam the other ~19 driver suites use), stamping an explicit
 * `waveId` on every fake leg — happyScript()'s shared fixtures deliberately
 * omit it (their own tests never needed it), but the bijection this suite
 * checks is meaningless against a leg that never carries the id its row is
 * supposed to be keyed on. `sumWaveUsage` (src/utils/pricing.js) is the SAME
 * aggregator on both sides of the identity: run-budget.js's usageBlock() folds
 * it over every addWave'd leg to produce run.json's `usage`; this suite folds
 * it over the "legged" runStats rows (tally.json) to produce the other side.
 * Any drift between them is a real leg that got lost, doubled, or mis-priced
 * somewhere in the row-per-launch machinery Tasks 1-7 built.
 *
 * ---- Why `runStats.filter(r => r.waveId)` is the right bijection filter ----
 * Every row built FROM a billed leg carries `leg.waveId` (Task 2, emit-only-
 * when-set). The rows that carry NO waveId are exactly the leg-LESS rows —
 * they were never going to appear in run.json's usage total in the first
 * place, so excluding them from `legged` is not a gap in the invariant, it is
 * the invariant's other (correct) half:
 *   - the synthesized `claude` row (run-assemble.js claudeRunStatsRow) — a
 *     file-sourced review with no leg ever launched for it (v4.1 §4.4);
 *   - the give-up chair's error row (errata E3) — `wasChair:false`, and it
 *     exists ONLY when the walk actually happened (chairAttempts non-empty);
 *     a cost-skipped chair (zero attempts) gets no row at all — no leg, no
 *     money, no row, full stop;
 *   - the two SL-2 retry note-classes that never produced a REAL leg for a
 *     seat at all (errata E5's residual half): `srcLegStillDeadNote` (the
 *     retry wave died wholesale — zero legs) and `missingLegStillDeadNote`
 *     (a partial wave return that never named this seat). Both yield
 *     `leg: null` in run-stages.js's primary-error-row loop, on purpose — no
 *     real leg exists to attribute a waveId to, so inventing one would be a
 *     phantom waveId over a leg that was never billed. E5 was AMENDED
 *     (Task-4 review, owner-ruled) for the THIRD retry note-class only —
 *     `retryLegStillDeadNote`, the one case where the retry itself produced a
 *     REAL (if unusable, e.g. timed-out) leg — that leg now rides the
 *     primary error row for real, waveId and usage included (scenario 6).
 *   - errata E4's dead-wave asymmetry: a WAVE-origin seat (the whole Stage-1
 *     wave died before any legs existed) never had a first leg to begin
 *     with, so healing it produces no `superseded` row — there is nothing to
 *     supersede. Only LEG-origin losses (a wave that ran but this seat's own
 *     leg came back unusable) get a superseded row for their first leg. The
 *     scenarios below are all leg-origin for that reason; the wave-origin
 *     half is unit-pinned in run-stages.test.js and doesn't need a second
 *     full-driver fixture here to be true.
 *
 * ---- The one acknowledged residual D1 hole (out of scope, review-adjudicated) ----
 * run-retry.js:226's `if (!ff) { continue; }` silently drops a retry response
 * that names a seat which never lost its seat in the first place (transport
 * misbehavior — a bogus/duplicate leg riding a retry wave's response for a
 * seat nobody retried). That leg was still `ctx.addWave`'d by the caller
 * (run-retry.js:182, before this per-leg loop runs) and would count toward
 * run.json's usage total, but there is no ff/firstFailure to key a row off,
 * so it produces no row at all — a genuine, deliberately-not-fixed rowless
 * leg. No fixture for it here: reproducing it would require a scripted
 * launcher lying about which seats a retry wave covers, which is a
 * transport-honesty assumption every other fixture in this file (and the
 * other ~19 driver suites) already relies on holding.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { runCouncil } = require('../../src/council/run');
const { sumWaveUsage } = require('../../src/utils/pricing');
const { review, judgeOut, mkLeg, okWave, scriptedLaunchers, baseOptions,
  defenseOut, revoteOut } = require('./helpers/fake-launchers');

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'council-bijection-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const noSignals = () => () => {};

/**
 * A leg carrying an explicit waveId. `mkLeg`'s 5th param has taken waveId
 * since Task 2 (fake-launchers.js, additive); this suite is the first to
 * lean on it for EVERY leg in EVERY fixture, because the invariant under
 * test is exactly about waveId-keyed rows.
 */
const wLeg = (model, waveId, summary, status = 'complete', cost = 0.01) =>
  mkLeg(model, summary, status, cost, waveId);

/** The clean 3-judge Stage-2 wave + a clean 1-shot chair — shared by the
 *  scenarios that don't themselves exercise Stage-2/chair degradation. */
const cleanStage2 = () => okWave([
  wLeg('gemini', 'abc123-s2', judgeOut(['Review B', 'Review C', 'Review A'],
    [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'agree' }, { id: 'C1', verdict: 'neutral' }])),
  wLeg('gpt', 'abc123-s2', judgeOut(['Review A', 'Review C', 'Review B'],
    [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'agree' }, { id: 'C1', verdict: 'dispute' }])),
  wLeg('qwen', 'abc123-s2', judgeOut(['Review A', 'Review B', 'Review C'],
    [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'neutral' }, { id: 'C1', verdict: 'agree' }])),
]);
const cleanChair = () =>
  okWave([wLeg('deepseek', 'abc123-ch1', 'Synthesis of the bench.\n\nVERDICT: Ship it', 'complete', 0.03)]);

/**
 * Drive a full runCouncil, then assert the D5 invariant against its output.
 * @param {object} opts runCouncil options (must carry the real runDir)
 * @param {object} launchers a scriptedLaunchers(...) instance
 * @returns {Promise<{run: object, tallyDoc: object, legged: Array}>}
 */
async function driveAndAssertBijection(opts, launchers) {
  const { run } = await runCouncil(opts, {
    launchers, appendRunFn: jest.fn(), statsFn: () => [], installSignalAbortFn: noSignals,
  });
  const tallyDoc = JSON.parse(fs.readFileSync(path.join(opts.runDir, 'tally.json'), 'utf-8'));
  const legged = tallyDoc.runStats.filter(r => r.waveId);
  const rows = sumWaveUsage(legged);

  // The cross-foot identity: independently summing the "legged" rows must
  // land on EXACTLY the same total run-budget.js already computed by folding
  // sumWaveUsage over every addWave'd leg (run.json's terminal usage block).
  expect(rows.cost.amount).toBeCloseTo(run.usage.cost.amount, 10);
  expect(rows.cost.reportedLegs).toBe(run.usage.cost.reportedLegs);
  expect(rows.cost.unpricedLegs).toBe(run.usage.cost.unpricedLegs);

  // The bijection, literally: every billed leg's (waveId, model) pair
  // appears on EXACTLY one row. Never zero — the cost/count identity above
  // would already have failed for a leg silently dropped from `legged` while
  // still counted in run.usage. Never two — a doubled row would inflate
  // `rows` past `run.usage` even if some OTHER leg were dropped to
  // compensate and net the totals out by coincidence.
  const keys = legged.map(r => `${r.waveId}::${r.model}`);
  expect(new Set(keys).size).toBe(keys.length);

  return { run, tallyDoc, legged };
}

describe('D5 invariant — the leg-row bijection (v4.7 "the count is the count")', () => {
  test('scenario 1 — clean run: the cross-foot identity holds with no repairs, retries or failures', async () => {
    const script = {
      'abc123-s1': (opts) => okWave(opts.models.map(m => wLeg(m, 'abc123-s1', review(m)))),
      'abc123-s2': cleanStage2,
      'abc123-ch1': cleanChair,
    };
    const { run, legged } = await driveAndAssertBijection(
      baseOptions(tmp), scriptedLaunchers(script));

    expect(run.exitCode).toBe(0);
    // 3 seat rows + 3 judge rows + 1 chair row — the pre-v4.7 #83 shape (run-happy.test.js:69),
    // every one of them now also carrying its waveId.
    expect(legged).toHaveLength(7);
    expect(legged.every(r => r.waveId)).toBe(true);
  });

  test('scenario 2 — repair run: a Stage-1 findings-repair leg rides its OWN row, distinct from the seat\'s primary review (E4)', async () => {
    const script = {
      // gpt's first-pass review is malformed prose (no fenced JSON block) — it
      // still MATERIALIZES (status complete, non-empty text), so this is the
      // findings-VALIDATION repair loop, not an SL-2 materialization retry:
      // the seat's primary row keeps this SAME leg (abc123-s1) throughout;
      // only the repair solo (abc123-p1) gets its own extra row.
      'abc123-s1': (opts) => okWave(opts.models.map(m =>
        wLeg(m, 'abc123-s1', m === 'gpt' ? 'prose without any json block at all' : review(m)))),
      'abc123-p1': (opts) => okWave([wLeg('gpt', opts.waveId, review('gpt'))]),
      'abc123-s2': cleanStage2,
      'abc123-ch1': cleanChair,
    };
    const { run, legged } = await driveAndAssertBijection(
      baseOptions(tmp), scriptedLaunchers(script));

    expect(run.exitCode).toBe(0);
    const repairRows = legged.filter(r => r.role === 'repair');
    expect(repairRows).toHaveLength(1);
    expect(repairRows[0]).toMatchObject({ model: 'gpt', waveId: 'abc123-p1' });
    const gptPrimary = legged.find(r => r.model === 'gpt' && r.role === 'seat');
    expect(gptPrimary).toMatchObject({ waveId: 'abc123-s1', conformance: 'repaired' });
    // 3 seat (incl. gpt's ORIGINAL malformed leg) + 1 repair + 3 judge + 1 chair.
    expect(legged).toHaveLength(8);
  });

  test('scenario 3 — chair-walk failure: ch1 fails carrying real usage, ch2 succeeds; ch1\'s spend rides a chair-attempt row', async () => {
    const script = {
      'abc123-s1': (opts) => okWave(opts.models.map(m => wLeg(m, 'abc123-s1', review(m)))),
      'abc123-s2': cleanStage2,
      'abc123-ch1': () => okWave([wLeg('deepseek', 'abc123-ch1', '', 'error', 0.02)], 1, 'error'),
      'abc123-ch2': () =>
        okWave([wLeg('deepseek', 'abc123-ch2', 'Synthesis.\n\nVERDICT: Ship it', 'complete', 0.03)]),
    };
    const { run, legged } = await driveAndAssertBijection(
      baseOptions(tmp), scriptedLaunchers(script));

    expect(run.exitCode).toBe(0);
    const attemptRows = legged.filter(r => r.role === 'chair-attempt');
    expect(attemptRows).toHaveLength(1);
    expect(attemptRows[0]).toMatchObject({ model: 'deepseek', waveId: 'abc123-ch1', status: 'error' });
    expect(attemptRows[0].usage.cost.amount).toBeCloseTo(0.02);
    expect(legged.find(r => r.wasChair)).toMatchObject({ waveId: 'abc123-ch2' });
    // 3 seat + 3 judge + 1 chair-attempt (ch1) + 1 primary chair (ch2).
    expect(legged).toHaveLength(8);
  });

  test('scenario 4 — debate-repair run: a defense repair replaces a leg; BOTH legs\' money is counted', async () => {
    const e2eOpts = {
      briefing: 'Review X', models: ['gemini', 'gpt', 'qwen'], chair: 'deepseek',
      project: tmp, runId: 'r', runDir: tmp, date: '2026-07-19', debate: true,
    };
    const script = {
      'r-s1': (opts) => okWave(opts.models.map(m => wLeg(m, 'r-s1', review(m)))),
      'r-s2': () => okWave([
        wLeg('gemini', 'r-s2', judgeOut(['Review B', 'Review C', 'Review A'],
          [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'agree' }, { id: 'C1', verdict: 'agree' }])),
        wLeg('gpt', 'r-s2', judgeOut(['Review B', 'Review C', 'Review A'],
          [{ id: 'A1', verdict: 'dispute' }, { id: 'B1', verdict: 'agree' }, { id: 'C1', verdict: 'agree' }])),
        wLeg('qwen', 'r-s2', judgeOut(['Review B', 'Review C', 'Review A'],
          [{ id: 'A1', verdict: 'dispute' }, { id: 'B1', verdict: 'agree' }, { id: 'C1', verdict: 'agree' }])),
      ]),
      // gemini raised A1 (Disputed by gpt+qwen). Its first defense is bare prose
      // (no parseable {responses:[...]} block) -> ONE repair solo fires at -d1r.
      'r-d1': (opts) => okWave([wLeg('gemini', opts.waveId, 'prose only, no json block at all')]),
      'r-d1r': (opts) => okWave([
        wLeg('gemini', opts.waveId, defenseOut([{ id: 'A1', action: 'defend', argument: 'measured' }])),
      ]),
      'r-rv': () => okWave([
        wLeg('gpt', 'r-rv', revoteOut([{ id: 'A1', verdict: 'agree', reason: 'defense convincing' }])),
        wLeg('qwen', 'r-rv', revoteOut([{ id: 'A1', verdict: 'dispute', reason: 'still unsupported' }])),
      ]),
      'r-ch1': () =>
        okWave([wLeg('deepseek', 'r-ch1', 'Synthesis after debate.\n\nVERDICT: Fix these first', 'complete', 0.03)]),
    };
    const { run, legged } = await driveAndAssertBijection(e2eOpts, scriptedLaunchers(script));

    expect(run.exitCode).toBe(0);
    const superseded = legged.find(r => r.role === 'superseded');
    expect(superseded).toMatchObject({ model: 'gemini', waveId: 'r-d1', conformance: 'unstructured' });
    const rebuttal = legged.find(r => r.role === 'rebuttal');
    expect(rebuttal).toMatchObject({ model: 'gemini', waveId: 'r-d1r', conformance: 'repaired' });
    // 3 seat + 3 judge + rebuttal(post-repair) + superseded(pre-repair) + 2 revote + 1 chair.
    expect(legged).toHaveLength(11);
  });

  test('scenario 5 — retry-healed run: the healed seat\'s original dead leg is superseded, the retry leg becomes primary', async () => {
    const script = {
      'abc123-s1': () => okWave([
        wLeg('gemini', 'abc123-s1', review('gemini')),
        wLeg('gpt', 'abc123-s1', review('gpt')),
        { ...wLeg('qwen', 'abc123-s1', '', 'error', 0.01), error: 'boom' },
      ]),
      'abc123-s1r1': (opts) => okWave([wLeg('qwen', opts.waveId, review('qwen'))]),
      'abc123-s2': cleanStage2,
      'abc123-ch1': cleanChair,
    };
    const { run, legged } = await driveAndAssertBijection(
      baseOptions(tmp), scriptedLaunchers(script));

    expect(run.exitCode).toBe(0); // SL-2: a healed seat is NOT a degrade
    const superseded = legged.filter(r => r.role === 'superseded');
    expect(superseded).toHaveLength(1);
    expect(superseded[0]).toMatchObject({ model: 'qwen', waveId: 'abc123-s1' });
    const qwenPrimary = legged.find(r => r.model === 'qwen' && r.role === 'seat');
    expect(qwenPrimary).toMatchObject({ waveId: 'abc123-s1r1' }); // primary carries the RETRY leg
    // 3 seat (gemini, gpt, qwen-retry) + 1 superseded (qwen's original) + 3 judge + 1 chair.
    expect(legged).toHaveLength(8);
  });

  test('scenario 6 — retry-FAILED run: a timed-out retry leg with real usage lands on the primary error row (E5 amendment)', async () => {
    const script = {
      'abc123-s1': () => okWave([
        wLeg('gemini', 'abc123-s1', review('gemini')),
        wLeg('gpt', 'abc123-s1', review('gpt')),
        { ...wLeg('qwen', 'abc123-s1', '', 'error', 0.01), error: 'boom' },
      ]),
      // The retry itself times out — but it IS a real leg (real waveId,
      // status, duration, usage), unlike the wholesale-dead-wave or
      // never-named-this-seat retry classes (see the file docblock's E5
      // paragraph). E5 was amended precisely so this leg's spend lands on a
      // row instead of vanishing behind a phantom `leg: null`.
      'abc123-s1r1': (opts) => okWave([wLeg('qwen', opts.waveId, '', 'timed-out', 0.01)]),
      // Only gemini+gpt survive to Stage 2 — qwen never produced a usable
      // review, so it is neither judged nor a judge.
      'abc123-s2': () => okWave([
        wLeg('gemini', 'abc123-s2', judgeOut(['Review B', 'Review A'],
          [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'agree' }])),
        wLeg('gpt', 'abc123-s2', judgeOut(['Review A', 'Review B'],
          [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'agree' }])),
      ]),
      'abc123-ch1': cleanChair,
    };
    const { run, legged } = await driveAndAssertBijection(
      baseOptions(tmp), scriptedLaunchers(script));

    expect(run.exitCode).toBe(2); // qwen never recovers a review — the run degrades
    const superseded = legged.find(r => r.role === 'superseded' && r.model === 'qwen');
    expect(superseded).toMatchObject({ waveId: 'abc123-s1' });   // the ORIGINAL leg is what's superseded
    const primaryErr = legged.find(r => r.model === 'qwen' && r.role === 'seat');
    expect(primaryErr).toMatchObject({ waveId: 'abc123-s1r1', status: 'timed-out' }); // FROM THE RETRY leg
    expect(primaryErr.usage.cost.amount).toBeCloseTo(0.01);      // real usage — not nulled out
    // 2 seat (gemini, gpt) + 1 superseded (qwen original) + 1 primary error (qwen retry) + 2 judge + 1 chair.
    expect(legged).toHaveLength(7);
  });
});
