// tests/council/run-finish-ledger-gate.test.js
'use strict';

/**
 * v4.9 W5.4 gate 1 (engine): a task run (o.intent === 'task') never feeds the
 * cross-run reliability ledger — run-finish.js's append gate reads
 * `!o.lenses && o.intent !== 'task'`. Task rankings measure concurrence, never
 * defect confirmation (spec §5.6), so a task row would poison chair promotion.
 *
 * Named mutant LEDGERGATE1: drop the `o.intent !== 'task'` conjunct at
 * run-finish.js — the task test below goes red (appendRunFn fires once).
 *
 * Driven through the REAL runCouncil driver (the run-all-clean.test.js shape)
 * rather than a hand-built finishRun ctx, so the gate is measured where run.js
 * actually threads `o`.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { runCouncil } = require('../../src/council/run');
const { scriptedLaunchers, happyScript, baseOptions } = require('./helpers/fake-launchers');

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'council-ledger-gate-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const noSignals = () => () => {};

test("a task run (intent:'task') never calls appendRunFn — and is still a clean exit-0 run", async () => {
  const appendRunFn = jest.fn();
  const { exitCode } = await runCouncil(baseOptions(tmp, { intent: 'task' }), {
    launchers: scriptedLaunchers(happyScript()), appendRunFn,
    statsFn: () => [], installSignalAbortFn: noSignals,
  });
  expect(exitCode).toBe(0);
  expect(appendRunFn).not.toHaveBeenCalled();
  // The ledger skip is the ONLY change: the tally artifact still lands.
  expect(fs.existsSync(path.join(tmp, 'council-abc123', 'tally.json'))).toBe(true);
});

test('review control: the same run WITHOUT intent appends exactly once', async () => {
  const appendRunFn = jest.fn();
  const { exitCode } = await runCouncil(baseOptions(tmp), {
    launchers: scriptedLaunchers(happyScript()), appendRunFn,
    statsFn: () => [], installSignalAbortFn: noSignals,
  });
  expect(exitCode).toBe(0);
  expect(appendRunFn).toHaveBeenCalledTimes(1);
});
