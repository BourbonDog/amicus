// tests/council/run-cost-unknown.test.js
'use strict';

/**
 * v4.4 — the --max-cost ceiling in the presence of legs whose cost is UNKNOWN.
 *
 * Diagnosis §9: `spent()` mapped a null amount to 0 and discarded
 * `sumWaveUsage`'s `unpricedLegs`/`source`, so unknown spend was invisible to
 * the ceiling AND to every reader of run.json. `council-wsgate02` really spent
 * $0.9859 against a $0.75 ceiling (131%) while `spent()` believed $0.3720 and
 * never emitted COST_EXCEEDED.
 *
 * OWNER'S RULING (Christian, v4.4): fail LOUD, not fail CLOSED —
 * "I don't want hitting a ceiling to stop us from solving real problems."
 * So an unknown-cost leg must NOT by itself halt a run or trip the ceiling.
 * It must instead be impossible to miss. These tests pin both halves: the
 * ceiling keeps tripping on KNOWN spend only, and the unknown is stamped into
 * run.json + announced on stderr rather than being silently zeroed.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { runCouncil } = require('../../src/council/run');
const { scriptedLaunchers, happyScript, baseOptions, mkLeg, okWave, review, judgeOut } = require('./helpers/fake-launchers');

let tmp;
let stderrSpy;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'council-cost-unknown-'));
  stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
});
afterEach(() => {
  stderrSpy.mockRestore();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const noSignals = () => () => {};
const deps = (launchers) => ({ launchers, appendRunFn: jest.fn(), statsFn: () => [], installSignalAbortFn: noSignals });
const stderrText = () => stderrSpy.mock.calls.map((c) => String(c[0])).join('');

/** A leg whose provider reported no usage at all → {amount:null, source:'unknown'}. */
const unknownLeg = (model, summary) => ({
  taskId: `${model}-leg`, model, modelInput: model, status: 'complete', summary,
  durationMs: 1000,
  usage: {
    tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
    cost: { amount: null, currency: 'USD', source: 'unknown' },
  },
});

/**
 * happyScript with ONE Stage-1 seat reporting unknown cost — the shape of
 * council-wsgate02's `wsgate02-s1-3` (qwen, 166 chars of preamble, no usage,
 * whose session subtree actually billed $0.6138).
 */
function scriptWithUnknownSeat() {
  const s = happyScript();
  s['abc123-s1'] = (opts) => okWave(opts.models.map((m) => (
    m === 'qwen' ? unknownLeg(m, review(m)) : mkLeg(m, review(m))
  )));
  return s;
}

describe('an unknown-cost leg never halts the run (fail LOUD, not CLOSED)', () => {
  test('a run with an unknown leg and a generous ceiling still completes', async () => {
    const { exitCode, run } = await runCouncil(
      baseOptions(tmp, { maxCost: 5 }), deps(scriptedLaunchers(scriptWithUnknownSeat())));
    expect(exitCode).toBe(0);
    expect(run.status).toBe('complete');
  });

  test('unknown legs alone never trip the ceiling — only KNOWN spend does', async () => {
    // Every single leg unknown: known spend stays $0, so a $0.01 ceiling that
    // would normally have tripped after Stage 1 must NOT fire.
    const allUnknown = {
      'abc123-s1': (opts) => okWave(opts.models.map((m) => unknownLeg(m, review(m)))),
      'abc123-s2': () => okWave([
        unknownLeg('gemini', judgeOut(['Review B', 'Review C', 'Review A'],
          [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'agree' }, { id: 'C1', verdict: 'neutral' }])),
        unknownLeg('gpt', judgeOut(['Review A', 'Review C', 'Review B'],
          [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'agree' }, { id: 'C1', verdict: 'dispute' }])),
        unknownLeg('qwen', judgeOut(['Review A', 'Review B', 'Review C'],
          [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'neutral' }, { id: 'C1', verdict: 'agree' }])),
      ]),
      'abc123-ch1': () => okWave([unknownLeg('deepseek', 'Synthesis.\n\nVERDICT: Ship it')]),
    };
    const { exitCode, run } = await runCouncil(
      baseOptions(tmp, { maxCost: 0.01 }), deps(scriptedLaunchers(allUnknown)));
    expect(exitCode).toBe(0);
    expect(run.error).toBeNull();
  });

  test('the ceiling still trips on KNOWN spend crossing it (regression guard)', async () => {
    const { exitCode, run } = await runCouncil(
      baseOptions(tmp, { maxCost: 0.02 }), deps(scriptedLaunchers(happyScript())));
    expect(exitCode).toBe(1);
    expect(run.error).toMatchObject({ code: 'COST_EXCEEDED' });
  });
});

describe('run.json makes the unknown impossible to miss', () => {
  test('usage carries unknownLegs + costExact:false alongside the known total', async () => {
    const { run } = await runCouncil(
      baseOptions(tmp, { maxCost: 5 }), deps(scriptedLaunchers(scriptWithUnknownSeat())));
    // The known figure is unchanged and still exact about what it covers…
    expect(run.usage.cost.amount).toBeGreaterThan(0);
    // …but the run no longer presents it as the whole bill.
    expect(run.usage.unknownLegs).toBeGreaterThanOrEqual(1);
    expect(run.usage.costExact).toBe(false);
    // The underlying rollup counters stay where they always were.
    expect(run.usage.cost.unpricedLegs).toBe(run.usage.unknownLegs);
  });

  test('a fully priced run says so: unknownLegs 0, costExact true', async () => {
    const { run } = await runCouncil(
      baseOptions(tmp, { maxCost: 5 }), deps(scriptedLaunchers(happyScript())));
    expect(run.usage.unknownLegs).toBe(0);
    expect(run.usage.costExact).toBe(true);
  });

  test('the on-disk run.json agrees with the returned record', async () => {
    await runCouncil(baseOptions(tmp, { maxCost: 5 }), deps(scriptedLaunchers(scriptWithUnknownSeat())));
    const onDisk = JSON.parse(fs.readFileSync(path.join(tmp, 'council-abc123', 'run.json'), 'utf-8'));
    expect(onDisk.usage.costExact).toBe(false);
    expect(onDisk.usage.unknownLegs).toBeGreaterThanOrEqual(1);
  });
});

describe('the run announces unknown spend on stderr', () => {
  test('a notice names the count, says the total is a floor, and names the ceiling', async () => {
    await runCouncil(baseOptions(tmp, { maxCost: 0.75 }), deps(scriptedLaunchers(scriptWithUnknownSeat())));
    const out = stderrText();
    expect(out).toMatch(/unknown/i);
    expect(out).toMatch(/0\.75/);              // the ceiling it is NOT counted against
    expect(out).toMatch(/higher/i);            // real spend is HIGHER than reported
  });

  test('no notice at all when every leg is priced', async () => {
    await runCouncil(baseOptions(tmp, { maxCost: 5 }), deps(scriptedLaunchers(happyScript())));
    expect(stderrText()).not.toMatch(/cost is UNKNOWN/i);
  });

  test('the notice fires exactly once, not once per budget gate', async () => {
    await runCouncil(baseOptions(tmp, { maxCost: 5 }), deps(scriptedLaunchers(scriptWithUnknownSeat())));
    const hits = stderrText().match(/cost is UNKNOWN/gi) || [];
    expect(hits).toHaveLength(1);
  });
});
