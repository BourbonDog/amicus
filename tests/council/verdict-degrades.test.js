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

const { deriveSeatLoss, summarizeSeatLoss } = require('../../src/council/verdict');

const mk = (channel, data, extra = {}) => makeDegrade({
  channel, what: 'w', why: 'y', effect: 'e', data, ...extra,
});

describe('deriveSeatLoss (spec D3 — closes #84)', () => {
  test('wave-only records reproduce summarizeSeatLoss byte-for-byte', () => {
    const degrades = [mk('dead-wave', { waveId: 'r1-c1', models: ['critic-m'], reason: 'server timeout' })];
    const derived = deriveSeatLoss({ runId: 'r1', critic: 'critic-m', degrades });
    const legacy = summarizeSeatLoss({ runId: 'r1', critic: 'critic-m',
      deadWaves: [{ waveId: 'r1-c1', models: ['critic-m'], reason: 'server timeout' }] });
    expect(derived).toEqual(legacy);
  });

  test('#84 pin: a dead CRITIC LEG flips criticSeated — deadWaves never could', () => {
    const degrades = [mk('dead-leg', { seat: 'critic-m', status: 'timeout', reason: 'no first token' })];
    const s = deriveSeatLoss({ runId: 'r1', critic: 'critic-m', degrades });
    expect(s.criticSeated).toBe(false);
    expect(s.reason).toBe('no first token');
    // The exact #84 failure: summarizeSeatLoss reads only deadWaves, so the same
    // loss reported as a leg leaves the verdict claiming the critic seated.
    expect(summarizeSeatLoss({ runId: 'r1', critic: 'critic-m', deadWaves: [] }).criticSeated).toBe(true);
  });

  test('#84 pin: a dead BENCH LEG reaches deadBenchSeats', () => {
    const degrades = [mk('dead-leg', { seat: 'beta', status: 'timeout', reason: null })];
    const s = deriveSeatLoss({ runId: 'r1', critic: 'critic-m', degrades });
    expect(s.criticSeated).toBe(true);
    expect(s.deadBenchSeats).toEqual(['beta']);
  });

  test('a dead critic leg with no reason falls back to naming the status', () => {
    const degrades = [mk('dead-leg', { seat: 'critic-m', status: 'error', reason: null })];
    const s = deriveSeatLoss({ runId: 'r1', critic: 'critic-m', degrades });
    expect(s.reason).toBe("the critic leg ended 'error' with no usable output");
  });

  test('no critic requested → null, exactly like the shipped shape', () => {
    expect(deriveSeatLoss({ runId: 'r1', critic: null,
      degrades: [mk('dead-leg', { seat: 'beta', status: 'timeout', reason: null })] })).toBeNull();
  });

  test('heals and dataless records are ignored by the derivation', () => {
    const degrades = [
      mk('shared-server-unavailable', undefined, { kind: 'heal' }),
      mk('thin-cross-review', undefined),
    ];
    const s = deriveSeatLoss({ runId: 'r1', critic: 'critic-m', degrades });
    expect(s.criticSeated).toBe(true);
    expect(s.deadBenchSeats).toEqual([]);
  });

  test('writeVerdictFiles prefers the derivation when degrades is provided', () => {
    const runDir = fs.mkdtempSync(path.join(tmp, 'derive-'));
    writeVerdictFiles({ runDir, record: record(), overallVerdict: null, chairText: null,
      critic: 'critic-m', deadWaves: [],   // legacy input says "all seated"
      degrades: [mk('dead-leg', { seat: 'critic-m', status: 'timeout', reason: 'no first token' })] });
    const onDisk = JSON.parse(fs.readFileSync(path.join(runDir, 'verdict.json'), 'utf-8'));
    expect(onDisk.seatLoss.criticSeated).toBe(false);  // the records win — one source of truth
  });
});
