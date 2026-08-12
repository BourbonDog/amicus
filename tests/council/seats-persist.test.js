// tests/council/seats-persist.test.js
'use strict';
// run.json must actually carry the derived table: the pure suites cannot see
// the wiring, and the schema is open so an ajv pass proves nothing.
// Harness copied verbatim from tests/council/run-schema.test.js (the only
// suite that drives runCouncil to completion cheaply via scriptedLaunchers).
const fs = require('fs');
const path = require('path');
const os = require('os');
const { runCouncil } = require('../../src/council/run');
const { scriptedLaunchers, baseOptions, mkLeg, okWave, review, judgeOut } =
  require('./helpers/fake-launchers');

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'council-schema-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const deps = (launchers) => ({
  launchers, appendRunFn: jest.fn(), statsFn: () => [], installSignalAbortFn: () => () => {},
});

test('seats[] + criticSeat are checkpointed into run.json', async () => {
  // 2-bench council: 'gemini' is a plain seat, 'gpt' is both a bench member and
  // the critic — critic runs via its own -c1 solo (run-stage1-launch.js), so it
  // still materializes a review and is judged like any other seat.
  const script = {
    'abc123-s1': (opts) => okWave(opts.models.map(m => mkLeg(m, review(m)))),
    'abc123-c1': () => okWave([mkLeg('gpt', review('gpt'))]),
    'abc123-s2': () => okWave([
      mkLeg('gemini', judgeOut(['Review B', 'Review A'],
        [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'agree' }])),
      mkLeg('gpt', judgeOut(['Review A', 'Review B'],
        [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'dispute' }])),
    ]),
    'abc123-ch1': () => okWave([
      mkLeg('deepseek', 'Synthesis of the bench.\n\nVERDICT: Ship it', 'complete', 0.03),
    ]),
  };
  const opts = baseOptions(tmp, { models: ['gemini', 'gpt'], critic: 'gpt' });
  await runCouncil(opts, deps(scriptedLaunchers(script)));

  const run = JSON.parse(fs.readFileSync(path.join(opts.runDir, 'run.json'), 'utf-8'));
  expect(run.seats.map(s => s.id)).toEqual(['gemini', 'gpt']);
  expect(run.seats.map(s => s.role)).toEqual(['seat', 'critic']);
  expect(run.criticSeat).toBe('gpt');
});
