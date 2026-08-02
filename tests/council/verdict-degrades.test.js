// tests/council/verdict-degrades.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { buildVerdict } = require('../../src/council/verdict');
const { writeVerdictFiles } = require('../../src/council/run-assemble');
const { makeDegrade } = require('../../src/utils/degrade');

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verdict-degrades-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const record = () => ({
  meta: { runId: 'r1', runType: 'council', date: '2026-08-01', chair: 'deepseek',
    models: ['alpha', 'beta'], claudeInCouncil: false },
  findings: [], streetCred: [], runStats: [], tierCounts: {},
});

const deadLeg = () => makeDegrade({
  channel: 'dead-leg',
  what: 'seat beta did not review',
  why: "the leg ended 'timeout' with no usable output",
  effect: '1 of 2 seats reviewed; the run continues with the bench that did and exits degraded (2)',
  data: { seat: 'beta', status: 'timeout', reason: null },
});

describe('verdict.degrades[]', () => {
  test('buildVerdict carries degrades verbatim when non-empty', () => {
    const v = buildVerdict(record(), [], { degrades: [deadLeg()] });
    expect(v.degrades).toHaveLength(1);
    expect(v.degrades[0].channel).toBe('dead-leg');
    expect(v.degrades[0].data.seat).toBe('beta');
    expect(v.schemaVersion).toBe(2);           // additive — version does not move
  });

  test('degrades is ABSENT when empty — absence never has to be interpreted', () => {
    expect(buildVerdict(record(), [], { degrades: [] }).degrades).toBeUndefined();
    expect(buildVerdict(record(), [], {}).degrades).toBeUndefined();
  });

  test('writeVerdictFiles lands degrades on verdict.json', () => {
    const runDir = fs.mkdtempSync(path.join(tmp, 'run-'));
    writeVerdictFiles({ runDir, record: record(), overallVerdict: null, chairText: null,
      critic: null, deadWaves: [], degrades: [deadLeg()] });
    const onDisk = JSON.parse(fs.readFileSync(path.join(runDir, 'verdict.json'), 'utf-8'));
    expect(onDisk.degrades).toHaveLength(1);
    expect(onDisk.degrades[0].what).toBe('seat beta did not review');
  });
});
