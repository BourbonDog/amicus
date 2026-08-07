// tests/council/run-chair.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { runCouncil, pickFallbackChair } = require('../../src/council/run');
const runState = require('../../src/council/run-state');
const { scriptedLaunchers, happyScript, baseOptions, mkLeg, okWave } =
  require('./helpers/fake-launchers');

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'council-chair-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const noSignals = () => () => {};
const readVerdict = () => JSON.parse(
  fs.readFileSync(path.join(tmp, 'council-abc123', 'verdict.json'), 'utf-8'));

describe('pickFallbackChair (highest peers-only street-cred = LOWEST mean rank)', () => {
  const rows = [
    { model: 'mistral', avgStreetCredPeersOnly: 2.4 },
    { model: 'grok', avgStreetCredPeersOnly: 1.2 },
    { model: 'gemini', avgStreetCredPeersOnly: 1.0 },   // bench → excluded
    { model: 'deepseek', avgStreetCredPeersOnly: 1.1 }, // failed chair → excluded
    { model: 'unjudged', avgStreetCredPeersOnly: null }, // never judged → excluded
  ];
  test('picks the best non-bench, non-failed-chair model', () => {
    expect(pickFallbackChair(rows, ['gemini', 'gpt', 'qwen'], 'deepseek')).toBe('grok');
  });
  test('returns null when no candidate exists', () => {
    expect(pickFallbackChair([], ['gemini'], 'deepseek')).toBeNull();
    expect(pickFallbackChair(rows.slice(2), ['gemini', 'unjudged'], 'deepseek')).toBeNull();
  });
});

// v4.3 Task 3 (spec §7.2 named defect): "council chair spend is invisible"
// without this — a chair solo's launch options must carry councilRunId/
// councilName end-to-end (run.js's o.runId/o.councilName -> run-chair.js's
// attemptChair -> launchers.launchSolo), threaded through the REAL runCouncil
// driver rather than a hand-built ctx.
describe('chair solo attribution (spec §7.2)', () => {
  test('the chair launch carries councilRunId + the requested councilName', async () => {
    const script = happyScript();
    const launchers = scriptedLaunchers(script);
    const { exitCode } = await runCouncil(baseOptions(tmp, { councilName: 'nightly-council' }), {
      launchers, appendRunFn: jest.fn(), statsFn: () => [], installSignalAbortFn: noSignals,
    });
    expect(exitCode).toBe(0);
    const ch1 = launchers.calls.find(c => c.waveId === 'abc123-ch1');
    expect(ch1).toMatchObject({ councilRunId: 'abc123', councilName: 'nightly-council' });
  });

  test('--models with no preset leaves councilName null on the chair launch (spec §7.1: never fabricated)', async () => {
    const script = happyScript();
    const launchers = scriptedLaunchers(script);
    await runCouncil(baseOptions(tmp), { // no councilName override -> defaults null
      launchers, appendRunFn: jest.fn(), statsFn: () => [], installSignalAbortFn: noSignals,
    });
    const ch1 = launchers.calls.find(c => c.waveId === 'abc123-ch1');
    expect(ch1.councilRunId).toBe('abc123');
    expect(ch1.councilName).toBeNull();
  });
});

describe('chair retry + fallback promotion', () => {
  test('transient failure: retry same chair once succeeds → exit 0', async () => {
    const script = happyScript();
    script['abc123-ch1'] = () => okWave([mkLeg('deepseek', '', 'error')], 1, 'error');
    script['abc123-ch2'] = () => okWave([mkLeg('deepseek', 'Synthesis.\nVERDICT: Ship it', 'complete', 0.03)]);
    const launchers = scriptedLaunchers(script);
    const { exitCode } = await runCouncil(baseOptions(tmp), {
      launchers, appendRunFn: jest.fn(), statsFn: () => [], installSignalAbortFn: noSignals,
    });
    expect(exitCode).toBe(0);
    expect(readVerdict().overallVerdict).toBe('Ship it');
  });

  test('both chair attempts die → ledger fallback promoted; meta.chair = actual chair', async () => {
    const script = happyScript();
    script['abc123-ch1'] = () => okWave([mkLeg('deepseek', '', 'error')], 1, 'error');
    script['abc123-ch2'] = () => okWave([mkLeg('deepseek', '', 'timeout')], 1, 'error');
    script['abc123-ch3'] = (opts) => {
      expect(opts.model).toBe('grok');
      return okWave([mkLeg('grok', 'Fallback synthesis.\nVERDICT: Fix these first', 'complete', 0.02)]);
    };
    const statsFn = () => [
      { model: 'grok', avgStreetCredPeersOnly: 1.2 },
      { model: 'gemini', avgStreetCredPeersOnly: 1.0 },
    ];
    const { exitCode } = await runCouncil(baseOptions(tmp), {
      launchers: scriptedLaunchers(script), appendRunFn: jest.fn(), statsFn,
      installSignalAbortFn: noSignals,
    });
    expect(exitCode).toBe(0);
    const verdict = readVerdict();
    expect(verdict.overallVerdict).toBe('Fix these first');
    expect(verdict.chair).toBe('grok');   // final tally meta.chair = actual chair
    const input = JSON.parse(fs.readFileSync(path.join(tmp, 'council-abc123', 'tally-input.json'), 'utf-8'));
    expect(input.runStats.find(r => r.wasChair).model).toBe('grok');
    // run.json must also reflect the promoted chair — status/report/`--json`
    // consumers all read run.json.chair, not just the tally artifacts.
    expect(runState.readRun(path.join(tmp, 'council-abc123')).chair).toBe('grok');
  });

  test('give up: no fallback candidate → overallVerdict null, exit 2', async () => {
    const script = happyScript();
    script['abc123-ch1'] = () => okWave([mkLeg('deepseek', '', 'error')], 1, 'error');
    script['abc123-ch2'] = () => okWave([mkLeg('deepseek', '', 'error')], 1, 'error');
    const { exitCode, run } = await runCouncil(baseOptions(tmp), {
      launchers: scriptedLaunchers(script), appendRunFn: jest.fn(), statsFn: () => [],
      installSignalAbortFn: noSignals,
    });
    expect(exitCode).toBe(2);
    expect(run.status).toBe('partial');
    expect(readVerdict().overallVerdict).toBeNull();
  });
});

describe('chairAttempts[] recording (LC-5)', () => {
  test('happy path: ch1 completes → run.json checkpoint carries one chairAttempts entry', async () => {
    const launchers = scriptedLaunchers(happyScript());
    const { exitCode, run } = await runCouncil(baseOptions(tmp), {
      launchers, appendRunFn: jest.fn(), statsFn: () => [], installSignalAbortFn: noSignals,
    });
    expect(exitCode).toBe(0);
    expect(run.chairAttempts).toEqual([
      { waveId: 'abc123-ch1', model: 'deepseek', outcome: 'completed', reason: null },
    ]);
  });

  test('N-attempt walk: three entries in order with reasons carried; chair-failed why cites each cause', async () => {
    const script = happyScript();
    // ch1: a pre-flight refusal — no wave at all, so the leg is null and the
    // classifier must read the reason off errorDoc.
    script['abc123-ch1'] = () => ({ wave: null, exitCode: 1, errorDoc: { message: 'OpenRouter spend limit' } });
    // ch2: the chair "completes" but with no output — classifies as 'no-output'.
    script['abc123-ch2'] = () => okWave([mkLeg('deepseek', '', 'complete')]);
    // ch3: the ledger-promoted fallback times out.
    script['abc123-ch3'] = (opts) => {
      expect(opts.model).toBe('grok');
      return okWave([mkLeg('grok', '', 'timeout')]);
    };
    const statsFn = () => [
      { model: 'grok', avgStreetCredPeersOnly: 1.2 },
      { model: 'gemini', avgStreetCredPeersOnly: 1.0 },
    ];
    const { exitCode, run } = await runCouncil(baseOptions(tmp), {
      launchers: scriptedLaunchers(script), appendRunFn: jest.fn(), statsFn,
      installSignalAbortFn: noSignals,
    });
    expect(exitCode).toBe(2);
    expect(run.chairAttempts).toEqual([
      { waveId: 'abc123-ch1', model: 'deepseek', outcome: 'error', reason: 'OpenRouter spend limit' },
      { waveId: 'abc123-ch2', model: 'deepseek', outcome: 'no-output', reason: null },
      { waveId: 'abc123-ch3', model: 'grok', outcome: 'timeout', reason: null },
    ]);
    const chairFailed = (run.degrades || []).find(d => d.channel === 'chair-failed');
    expect(chairFailed).toBeDefined();
    expect(chairFailed.why).toContain('ch1 deepseek: OpenRouter spend limit · ch2');
  });

  test('chairless (over budget from the start): chairAttempts is never checkpointed', async () => {
    const launchers = scriptedLaunchers(happyScript());
    const { exitCode, run } = await runCouncil(baseOptions(tmp, { maxCost: 0.05 }), {
      launchers, appendRunFn: jest.fn(), statsFn: () => [], installSignalAbortFn: noSignals,
    });
    expect(exitCode).toBe(2);
    expect(launchers.calls.some(c => c.waveId === 'abc123-ch1')).toBe(false);
    expect(run.chairAttempts).toBeUndefined();
  });

  test('kill-mid-walk: the ch1 attempt is already checkpointed before the ch2 abort bails the walk', async () => {
    const script = happyScript();
    script['abc123-ch1'] = () => okWave([mkLeg('deepseek', '', 'error')], 1, 'error');
    // A real signal-killed solo still produces ONE leg at status 'aborted'
    // (src/utils/result-schema.js's statusFromResult) — not an empty legs
    // array. Using the production shape here (rather than legs:[]) is what
    // makes ch2's own attempt classifiable, which is what lets this test
    // actually pin the record-before-bail ordering below: recordAttempt(ch2)
    // can only have run if it executes BEFORE the isAbortExit bail returns.
    script['abc123-ch2'] = () => okWave([mkLeg('deepseek', '', 'aborted')], 130, 'aborted');
    const { exitCode, run } = await runCouncil(baseOptions(tmp), {
      launchers: scriptedLaunchers(script), appendRunFn: jest.fn(), statsFn: () => [],
      installSignalAbortFn: noSignals,
    });
    expect(exitCode).toBe(130);
    expect(run.status).toBe('aborted');
    // The mid-walk kill must not lose the checkpoint already written for ch1,
    // AND ch2's own (aborted) attempt must itself be recorded — proof the
    // record call sits BEFORE the isAbortExit check at this site, not after
    // it (a record-after-bail regression would leave this at length 1).
    expect(run.chairAttempts).toHaveLength(2);
    expect(run.chairAttempts[0]).toEqual(
      { waveId: 'abc123-ch1', model: 'deepseek', outcome: 'error', reason: 'error' });
    expect(run.chairAttempts[1]).toEqual(
      { waveId: 'abc123-ch2', model: 'deepseek', outcome: 'error', reason: 'aborted' });
  });
});

// v4.7 D2: chair-class rows beyond the primary — a chair-attempt row per
// FAILED attempt that produced a wave (spend is attributable), a repair row
// for a launched ch4 VERDICT re-prompt, and a give-up error row when the
// whole walk dies. The successful attempt's leg is never duplicated here —
// it becomes the primary 'chair' row (wasChair:true) via chairStats in run.js.
describe('chair-class runStats rows (v4.7 D2)', () => {
  test('a failed ch1 followed by a successful ch2 yields one chair-attempt row carrying ch1 usage', async () => {
    const script = happyScript();
    script['abc123-ch1'] = () => okWave([mkLeg('deepseek', '', 'error', 0.02, 'abc123-ch1')], 1, 'error');
    script['abc123-ch2'] = () => okWave([mkLeg('deepseek', 'Synthesis.\nVERDICT: Ship it', 'complete', 0.03, 'abc123-ch2')]);
    const { exitCode } = await runCouncil(baseOptions(tmp), {
      launchers: scriptedLaunchers(script), appendRunFn: jest.fn(), statsFn: () => [], installSignalAbortFn: noSignals,
    });
    expect(exitCode).toBe(0);
    const input = JSON.parse(fs.readFileSync(path.join(tmp, 'council-abc123', 'tally-input.json'), 'utf-8'));
    const attemptRows = input.runStats.filter(r => r.role === 'chair-attempt');
    expect(attemptRows).toHaveLength(1);
    expect(attemptRows[0]).toMatchObject({
      model: 'deepseek', wasChair: false, status: 'error', waveId: 'abc123-ch1',
    });
    expect(attemptRows[0].usage.cost.amount).toBeCloseTo(0.02);
    // The successful ch2 leg becomes the primary chair row, not a second chair-attempt row.
    expect(input.runStats.find(r => r.wasChair))
      .toMatchObject({ model: 'deepseek', role: 'chair', waveId: 'abc123-ch2' });
  });

  test('a launched ch4 repair yields a repair row; an unlaunched one yields none', async () => {
    // Scenario A: no VERDICT on the first pass -> ch4 launches and produces a
    // leg -> a role:'repair' row is added.
    const script = happyScript();
    script['abc123-ch1'] = () => okWave([mkLeg('deepseek', 'Prose only, no verdict.', 'complete', 0.03, 'abc123-ch1')]);
    script['abc123-ch4'] = () => okWave([mkLeg('deepseek', 'VERDICT: Ship it', 'complete', 0.01, 'abc123-ch4')]);
    const { exitCode } = await runCouncil(baseOptions(tmp), {
      launchers: scriptedLaunchers(script), appendRunFn: jest.fn(), statsFn: () => [], installSignalAbortFn: noSignals,
    });
    expect(exitCode).toBe(0);
    const input = JSON.parse(fs.readFileSync(path.join(tmp, 'council-abc123', 'tally-input.json'), 'utf-8'));
    const repairRows = input.runStats.filter(r => r.role === 'repair');
    expect(repairRows).toHaveLength(1);
    expect(repairRows[0]).toMatchObject({ model: 'deepseek', wasChair: false, waveId: 'abc123-ch4' });

    // Scenario B: a VERDICT line lands on the first attempt -> ch4 never
    // launches -> no repair row at all.
    const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'council-chair-repair2-'));
    try {
      const script2 = happyScript();
      script2['abc123-ch1'] = () =>
        okWave([mkLeg('deepseek', 'Synthesis.\nVERDICT: Ship it', 'complete', 0.03, 'abc123-ch1')]);
      const { exitCode: exit2 } = await runCouncil(baseOptions(tmp2), {
        launchers: scriptedLaunchers(script2), appendRunFn: jest.fn(), statsFn: () => [], installSignalAbortFn: noSignals,
      });
      expect(exit2).toBe(0);
      const input2 = JSON.parse(fs.readFileSync(path.join(tmp2, 'council-abc123', 'tally-input.json'), 'utf-8'));
      expect(input2.runStats.filter(r => r.role === 'repair')).toHaveLength(0);
    } finally {
      fs.rmSync(tmp2, { recursive: true, force: true });
    }
  });

  test('give-up after a walk: chairRows carry every failed attempt; no row has wasChair true', async () => {
    const script = happyScript();
    script['abc123-ch1'] = () => okWave([mkLeg('deepseek', '', 'error', 0.02, 'abc123-ch1')], 1, 'error');
    script['abc123-ch2'] = () => okWave([mkLeg('deepseek', '', 'timeout', 0.01, 'abc123-ch2')], 1, 'error');
    const { exitCode } = await runCouncil(baseOptions(tmp), {
      launchers: scriptedLaunchers(script), appendRunFn: jest.fn(), statsFn: () => [], installSignalAbortFn: noSignals,
    });
    expect(exitCode).toBe(2);
    const input = JSON.parse(fs.readFileSync(path.join(tmp, 'council-abc123', 'tally-input.json'), 'utf-8'));
    expect(input.runStats.some(r => r.wasChair === true)).toBe(false);
    const attemptRows = input.runStats.filter(r => r.role === 'chair-attempt');
    expect(attemptRows.map(r => r.waveId)).toEqual(['abc123-ch1', 'abc123-ch2']);
    const giveUpRows = input.runStats.filter(r => r.role === 'chair' && r.status === 'error');
    expect(giveUpRows).toHaveLength(1);
    expect(giveUpRows[0]).toMatchObject({ model: 'deepseek', wasChair: false, usage: null });
    expect('waveId' in giveUpRows[0]).toBe(false);
  });

  // v4.7 D2 review fix (errata E3): both attempts die PRE-WAVE — no leg
  // document at all (a pre-flight refusal, the errorDoc path classifyChairAttempt
  // already models; scriptedLaunchers surfaces this as {wave: null, ...}, which
  // launchSolo collapses to leg:null, so attemptChair's rawLeg is null too — no
  // money spent, no chair-attempt row). chairAttempts still records both
  // outcomes. This pins the give-up row to chairAttempts.length, NOT
  // chairRows.length: keying on chairRows would wrongly suppress the give-up
  // row here since chairRows is empty.
  test('give-up when both attempts die pre-wave: zero chair-attempt rows, chairAttempts still length 2, one give-up row', async () => {
    const script = happyScript();
    script['abc123-ch1'] = () => ({ wave: null, exitCode: 1, errorDoc: { message: 'OpenRouter spend limit' } });
    script['abc123-ch2'] = () => ({ wave: null, exitCode: 1, errorDoc: { message: 'OpenRouter spend limit' } });
    const { exitCode, run } = await runCouncil(baseOptions(tmp), {
      launchers: scriptedLaunchers(script), appendRunFn: jest.fn(), statsFn: () => [], installSignalAbortFn: noSignals,
    });
    expect(exitCode).toBe(2);
    expect(run.chairAttempts).toHaveLength(2);
    const input = JSON.parse(fs.readFileSync(path.join(tmp, 'council-abc123', 'tally-input.json'), 'utf-8'));
    expect(input.runStats.filter(r => r.role === 'chair-attempt')).toHaveLength(0);
    const giveUpRows = input.runStats.filter(r => r.role === 'chair');
    expect(giveUpRows).toHaveLength(1);
    expect(giveUpRows[0]).toMatchObject({
      model: 'deepseek', status: 'error', wasChair: false, usage: null,
    });
  });
});

describe('chair VERDICT-line repair (one re-prompt)', () => {
  // v4.3 Task 3 (spec §7.2): the ch4 VERDICT-repair launch is a SEPARATE call
  // site from the ch1/ch2/ch3 chain (attemptChair) — its own attribution wiring.
  test('the VERDICT-repair (-ch4) launch also carries council attribution', async () => {
    const script = happyScript();
    script['abc123-ch1'] = () => okWave([mkLeg('deepseek', 'Great synthesis, no verdict line.', 'complete', 0.03)]);
    script['abc123-ch4'] = () => okWave([mkLeg('deepseek', 'VERDICT: Fundamental rethink')]);
    const launchers = scriptedLaunchers(script);
    await runCouncil(baseOptions(tmp, { councilName: 'nightly-council' }), {
      launchers, appendRunFn: jest.fn(), statsFn: () => [], installSignalAbortFn: noSignals,
    });
    const ch4 = launchers.calls.find(c => c.waveId === 'abc123-ch4');
    expect(ch4).toMatchObject({ councilRunId: 'abc123', councilName: 'nightly-council' });
  });

  test('LC-12: the -ch4 repair carries the synthesis it must verdict on', async () => {
    // buildChairRepairPrompt took NO arguments at all, so a fresh repair session
    // was asked to pick a verdict on a synthesis it had never read. The chair leg
    // SUCCEEDED here — only the VERDICT line is missing.
    const synthesis = 'The bench converged on three blockers in the migration plan.';
    const script = happyScript();
    script['abc123-ch1'] = () => okWave([mkLeg('deepseek', synthesis, 'complete', 0.03)]);
    script['abc123-ch4'] = () => okWave([mkLeg('deepseek', 'VERDICT: Fix these first')]);
    const launchers = scriptedLaunchers(script);
    await runCouncil(baseOptions(tmp), {
      launchers, appendRunFn: jest.fn(), statsFn: () => [], installSignalAbortFn: noSignals,
    });
    const ch4 = launchers.calls.find(c => c.waveId === 'abc123-ch4');
    expect(ch4.prompt).toContain(synthesis);
    expect(ch4.prompt).toContain('YOUR SYNTHESIS');
    expect(ch4.prompt).toContain('VERDICT: Ship it');   // the three-way choice survives
  });

  test('missing VERDICT → repair -ch4 supplies it → exit 0', async () => {
    const script = happyScript();
    script['abc123-ch1'] = () => okWave([mkLeg('deepseek', 'Great synthesis, no verdict line.', 'complete', 0.03)]);
    script['abc123-ch4'] = () => okWave([mkLeg('deepseek', 'VERDICT: Fundamental rethink')]);
    const { exitCode } = await runCouncil(baseOptions(tmp), {
      launchers: scriptedLaunchers(script), appendRunFn: jest.fn(), statsFn: () => [],
      installSignalAbortFn: noSignals,
    });
    expect(exitCode).toBe(0);
    expect(readVerdict().overallVerdict).toBe('Fundamental rethink');
  });

  test('still missing after the one repair → keep prose, overallVerdict null, exit 2', async () => {
    const script = happyScript();
    script['abc123-ch1'] = () => okWave([mkLeg('deepseek', 'Prose only, forever.', 'complete', 0.03)]);
    script['abc123-ch4'] = () => okWave([mkLeg('deepseek', 'still no verdict line')]);
    const { exitCode } = await runCouncil(baseOptions(tmp), {
      launchers: scriptedLaunchers(script), appendRunFn: jest.fn(), statsFn: () => [],
      installSignalAbortFn: noSignals,
    });
    expect(exitCode).toBe(2);
    expect(readVerdict().overallVerdict).toBeNull();
    // chair prose is kept (spec: "keep chair prose")
    expect(fs.readFileSync(path.join(tmp, 'council-abc123', 'chair-output.md'), 'utf-8'))
      .toContain('Prose only, forever.');
  });

  test('chair completes verdict-less but its cost trips --max-cost: repair skipped, conformance unstructured, exit 2', async () => {
    const script = happyScript();
    script['abc123-ch1'] = () => okWave([mkLeg('deepseek', 'Prose but no verdict line at all.', 'complete', 0.03)]);
    const launchers = scriptedLaunchers(script);
    const { exitCode } = await runCouncil(baseOptions(tmp, { maxCost: 0.08 }), {
      launchers, appendRunFn: jest.fn(), statsFn: () => [], installSignalAbortFn: noSignals,
    });
    expect(exitCode).toBe(2);
    expect(launchers.calls.some(c => c.waveId === 'abc123-ch4')).toBe(false); // repair skipped by budget
    const input = JSON.parse(fs.readFileSync(path.join(tmp, 'council-abc123', 'tally-input.json'), 'utf-8'));
    expect(input.runStats.find(r => r.wasChair).conformance).toBe('unstructured');
    expect(readVerdict().overallVerdict).toBeNull();
  });
});
