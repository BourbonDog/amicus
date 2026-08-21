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

describe('pickFallbackChair under resolved-id keys (v4.7 GOA-7 D11)', () => {
  const agg = (model, cred, aliases) => ({ model, avgStreetCredPeersOnly: cred,
    ...(aliases ? { aliases } : {}) });

  test('a bench seat is excluded even when its group is keyed by executable id', () => {
    const rows = [agg('google/gemini-3.5-pro', 1.0, ['gemini']), agg('grok', 2.0, ['grok'])];
    // 'gemini' is on the bench — its resolved-keyed group must NOT be promoted.
    expect(pickFallbackChair(rows, ['gemini', 'gpt'], 'deepseek')).toBe('grok');
  });

  test('the just-failed chair is excluded via aliases[] too', () => {
    const rows = [agg('deepseek/deepseek-v4', 1.0, ['deepseek']), agg('grok', 2.0, ['grok'])];
    expect(pickFallbackChair(rows, ['gemini'], 'deepseek')).toBe('grok');
  });

  test('the promoted name is the most-recent ALIAS (aliases[0]), never the raw key', () => {
    const rows = [agg('openai/gpt-5.2', 1.0, ['gpt4', 'gpt'])];
    expect(pickFallbackChair(rows, ['gemini'], 'deepseek')).toBe('gpt4');
  });

  test('rows without aliases (pre-D10 shape) fall back to the key — old fixtures stay valid', () => {
    const rows = [agg('grok', 1.5)];
    expect(pickFallbackChair(rows, ['gemini'], 'deepseek')).toBe('grok');
  });

  test("a group with 'claude' anywhere in its name set is never promoted (paranoia pin)", () => {
    const rows = [agg('some/exec-id', 0.5, ['claude']), agg('grok', 2.0, ['grok'])];
    expect(pickFallbackChair(rows, ['gemini'], 'deepseek')).toBe('grok');
  });
});

// v4.8 PR4a — the full rationale for run-chair.js's tie-break (kept here because
// src/ is size-gated at 300 lines and tests/ is not).
//
// THE DEFECT. `pickFallbackChair` sorted on `avgStreetCredPeersOnly` alone over
// a STABLE Array#sort, so an exact tie resolved by input array order. That order
// is `deriveReliability`'s Map insertion order, which is council-ledger.jsonl
// ROW ORDER — so which model the engine PROMOTED AND LAUNCHED as fallback chair
// depended on the layout of an append-only file, with nothing pinning it.
//
// WHY TIES ARE ORDINARY, NOT EXOTIC. On a two-seat bench `peersOnly` is a mean
// over ranks drawn from {1,2} — `street-cred.js :: computeStreetCred` excludes
// the judge's own SEAT where both sides carry one and its alias otherwise
// (v4.8 T3.3; before that it was always the alias, and the function lived in
// tally.js, which still re-exports it) — so equal means are a common
// arithmetic outcome. (Note the tying groups reach
// this function via a PAST run's ledger: `excluded()` already filters every
// alias on the CURRENT bench.)
//
// WHY `runs` IS ONLY A TIE-BREAK. `runs` is the group's TOTAL ledger row count
// (`ledger-stats.js :: countRuns`) and includes `judged:false` runs that wrote no street cred.
// A model with 10 runs of which 2 were judged therefore outranks one with 5 all
// judged, on a tie — so `runs` proxies operational history, NOT the sample
// behind the mean, and must never be read as a ranking signal. The model-id term
// is what actually guarantees a total order.
//
// This changes which model is promoted on a tie. No existing fixture ties.
describe('pickFallbackChair tie-break is explicit and order-independent (v4.8 PR4a)', () => {
  const agg = (model, cred, runs) => ({ model, aliases: [model],
    avgStreetCredPeersOnly: cred, runs });

  test('an exact street-cred tie does not resolve by input order', () => {
    const a = agg('alpha', 2, 1);
    const b = agg('beta', 2, 5);
    const forward = pickFallbackChair([a, b], ['zz'], 'zzchair');
    const reversed = pickFallbackChair([b, a], ['zz'], 'zzchair');
    expect(forward).toBe(reversed);
  });

  // `runs` is total ledger appearances (ledger-stats.js :: countRuns), including judged:false
  // runs that contributed no street cred — a tie-break, not a ranking signal.
  test('on a tie the group with more council appearances wins', () => {
    const a = agg('alpha', 2, 1);
    const b = agg('beta', 2, 5);
    expect(pickFallbackChair([a, b], ['zz'], 'zzchair')).toBe('beta');
    expect(pickFallbackChair([b, a], ['zz'], 'zzchair')).toBe('beta');
  });

  test('when street cred AND runs tie, the model id breaks it deterministically', () => {
    const a = agg('alpha', 2, 3);
    const z = agg('zeta', 2, 3);
    expect(pickFallbackChair([a, z], ['zz'], 'zzchair')).toBe('alpha');
    expect(pickFallbackChair([z, a], ['zz'], 'zzchair')).toBe('alpha');
  });

  test('a missing runs count never beats a real one, and stays order-independent', () => {
    const noRuns = { model: 'alpha', aliases: ['alpha'], avgStreetCredPeersOnly: 2 };
    const withRuns = agg('beta', 2, 4);
    expect(pickFallbackChair([noRuns, withRuns], ['zz'], 'zzchair')).toBe('beta');
    expect(pickFallbackChair([withRuns, noRuns], ['zz'], 'zzchair')).toBe('beta');
  });

  test('street cred still dominates both tie-breaks', () => {
    const best = agg('alpha', 1.0, 1);      // lower mean rank = better
    const worse = agg('beta', 2.0, 99);
    expect(pickFallbackChair([worse, best], ['zz'], 'zzchair')).toBe('alpha');
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
    const { exitCode } = await runCouncil(baseOptions(tmp, { councilName: 'nightly-council', tag: 'sprint42' }), {
      launchers, appendRunFn: jest.fn(), statsFn: () => [], installSignalAbortFn: noSignals,
    });
    expect(exitCode).toBe(0);
    const ch1 = launchers.calls.find(c => c.waveId === 'abc123-ch1');
    // v4.7 F8 D16 (T7 review): tag rides the SAME forward as councilRunId/
    // councilName — deleting `tag: o.tag` from run-chair.js's attemptChair
    // launch restores the silent degrade this pins against.
    expect(ch1).toMatchObject({ councilRunId: 'abc123', councilName: 'nightly-council', tag: 'sprint42' });
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
    await runCouncil(baseOptions(tmp, { councilName: 'nightly-council', tag: 'sprint42' }), {
      launchers, appendRunFn: jest.fn(), statsFn: () => [], installSignalAbortFn: noSignals,
    });
    const ch4 = launchers.calls.find(c => c.waveId === 'abc123-ch4');
    // v4.7 F8 D16 (T7 review): the -ch4 repair is its OWN launch site, distinct
    // from ch1/ch2/ch3 — pinned separately so a fix to one can't hide a
    // regression in the other.
    expect(ch4).toMatchObject({ councilRunId: 'abc123', councilName: 'nightly-council', tag: 'sprint42' });
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

  // Item 10, final-review consolidated wave: mirrors the "still missing after
  // the one repair" test above, but for a ch4 that LAUNCHED and then FAILED
  // outright (status 'error', no summary at all) rather than one that
  // completed with prose simply lacking a VERDICT line. run-chair.js's
  // `if (repair.leg)` guard (item 3's comment fix) pushes a repair row for
  // ANY launched ch4 leg regardless of its status — repair.leg is the raw,
  // un-nulled leg — so this pins that the row still appears (carrying the
  // leg's own error status) and that chairConformance still resolves to
  // 'unstructured' off the empty/failed repair summary.
  test('ch4 launches but its own leg FAILS (status error, no VERDICT): the repair row still appears with an error status; chairConformance is unstructured', async () => {
    const script = happyScript();
    script['abc123-ch1'] = () => okWave([mkLeg('deepseek', 'Prose only, forever.', 'complete', 0.03)]);
    script['abc123-ch4'] = () => okWave([mkLeg('deepseek', '', 'error', 0.01, 'abc123-ch4')], 1, 'error');
    const { exitCode } = await runCouncil(baseOptions(tmp), {
      launchers: scriptedLaunchers(script), appendRunFn: jest.fn(), statsFn: () => [],
      installSignalAbortFn: noSignals,
    });
    expect(exitCode).toBe(2);
    expect(readVerdict().overallVerdict).toBeNull();
    const input = JSON.parse(fs.readFileSync(path.join(tmp, 'council-abc123', 'tally-input.json'), 'utf-8'));
    const repairRows = input.runStats.filter(r => r.role === 'repair');
    expect(repairRows).toHaveLength(1);
    expect(repairRows[0]).toMatchObject({ model: 'deepseek', wasChair: false, status: 'error', waveId: 'abc123-ch4' });
    expect(input.runStats.find(r => r.wasChair).conformance).toBe('unstructured');
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
