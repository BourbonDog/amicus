'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { runCouncil } = require('../../src/council/run');
const { createEventTail, EVENTS_FILE } = require('../../src/observe/events');
const {
  scriptedLaunchers, happyScript, baseOptions, debateScript,
} = require('../council/helpers/fake-launchers');

const noSignals = () => () => {};

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'council-ev-')); }

describe('council run events (spec 4.2) — Task 7', () => {
  test('run-started/stage-started+terminal/run-terminal land in the run dir events.jsonl, including a chair pair (B3 guard)', async () => {
    const t = tmp();
    const opts = baseOptions(t);
    const result = await runCouncil(opts, {
      launchers: scriptedLaunchers(happyScript()),
      appendRunFn: () => {}, statsFn: () => [], installSignalAbortFn: noSignals,
    });
    expect(result.exitCode).toBe(0);

    const events = createEventTail(path.join(opts.runDir, EVENTS_FILE)).poll();
    const names = events.map(e => e.event);
    expect(names[0]).toBe('run-started');
    expect(names[names.length - 1]).toBe('run-terminal');

    const runStarted = events.find(e => e.event === 'run-started');
    expect(runStarted).toMatchObject({ id: 'abc123', bench: ['gemini', 'gpt', 'qwen'], chair: 'deepseek' });

    const runTerminal = events.find(e => e.event === 'run-terminal');
    expect(runTerminal).toMatchObject({ id: 'abc123', status: 'complete', exitCode: 0 });

    // At least one stage-started/stage-terminal pair (run.js-owned: stage1).
    const stage1Started = events.find(e => e.event === 'stage-started' && e.stage === 'stage1');
    const stage1Terminal = events.find(e => e.event === 'stage-terminal' && e.stage === 'stage1');
    expect(stage1Started).toMatchObject({ id: 'abc123', waveId: 'abc123-s1' });
    expect(stage1Terminal).toMatchObject({ id: 'abc123', status: 'complete', waveId: 'abc123-s1' });
    const stage2Started = events.find(e => e.event === 'stage-started' && e.stage === 'stage2');
    const stage2Terminal = events.find(e => e.event === 'stage-terminal' && e.stage === 'stage2');
    expect(stage2Started).toMatchObject({ waveId: 'abc123-s2' });
    expect(stage2Terminal).toMatchObject({ status: 'complete' });

    // ---- THE B3 GUARD ----
    // The chair stage lives ENTIRELY in run-chair.js, not run.js (v4.3 Task 7
    // DE-ROT B3). Emitting stage events only from run.js's own updateStage
    // call sites would write ZERO chair events here — this is the exact
    // defect the trap names, and the assertion below is what proves it fixed.
    const chairStarted = events.find(e => e.event === 'stage-started' && e.stage === 'chair');
    const chairTerminal = events.find(e => e.event === 'stage-terminal' && e.stage === 'chair');
    expect(chairStarted).toMatchObject({ id: 'abc123', stage: 'chair' });
    expect(chairTerminal).toMatchObject({ id: 'abc123', stage: 'chair', status: 'complete' });
    // chair-started must precede chair-terminal on the stream.
    expect(events.indexOf(chairStarted)).toBeLessThan(events.indexOf(chairTerminal));

    // tally + verdict (run.js-owned, instant complete — both events at the same site).
    expect(events.some(e => e.event === 'stage-terminal' && e.stage === 'tally' && e.status === 'complete')).toBe(true);
    expect(events.some(e => e.event === 'stage-terminal' && e.stage === 'verdict' && e.status === 'complete')).toBe(true);
  });

  test('a skipped chair (over-budget) writes ONLY a chair stage-terminal — no stage-started (B3 site coverage)', async () => {
    const t = tmp();
    const opts = baseOptions(t, { maxCost: 0.05 }); // clears the pre-stage2 gate at 0.03 but blown before chair (0.06 after stage2)
    const result = await runCouncil(opts, {
      launchers: scriptedLaunchers(happyScript()),
      appendRunFn: () => {}, statsFn: () => [], installSignalAbortFn: noSignals,
    });
    // Degraded (exit 2), not the earlier COST_EXCEEDED bail (exit 1) — proves
    // stage2 actually ran and this is the run-chair.js 'skipped' branch, not a
    // finalize() short-circuit before chair ever entered the picture.
    expect(result.exitCode).toBe(2);
    const events = createEventTail(path.join(opts.runDir, EVENTS_FILE)).poll();
    expect(events.some(e => e.event === 'stage-terminal' && e.stage === 'stage2' && e.status === 'complete')).toBe(true);
    const chairStarted = events.find(e => e.event === 'stage-started' && e.stage === 'chair');
    const chairTerminal = events.find(e => e.event === 'stage-terminal' && e.stage === 'chair');
    expect(chairStarted).toBeUndefined();
    expect(chairTerminal).toMatchObject({ status: 'skipped' });
  });
});

describe('council debate-revote events — run-debate.js owns the START (Task 7)', () => {
  function e2eOpts(dir, extra) {
    return { briefing: 'Review X', models: ['gemini', 'gpt', 'qwen'], chair: 'deepseek',
      project: dir, runId: 'r', runDir: dir, date: '2026-07-19', debate: true, ...extra };
  }

  test('debate-revote stage-started fires from run-debate.js with the real -rv waveId; run.js closes the pair', async () => {
    const t = tmp();
    const opts = e2eOpts(t);
    const { exitCode } = await runCouncil(opts, { launchers: debateScript(), appendRunFn: () => {} });
    expect(exitCode).toBe(0);

    const events = createEventTail(path.join(opts.runDir, EVENTS_FILE)).poll();
    const revoteStarted = events.find(e => e.event === 'stage-started' && e.stage === 'debate-revote');
    const revoteTerminal = events.find(e => e.event === 'stage-terminal' && e.stage === 'debate-revote');
    // Only run-debate.js knows the real sub-wave id at launch time (spec §4.2 / B3 note).
    expect(revoteStarted).toMatchObject({ id: 'r', stage: 'debate-revote', waveId: 'r-rv' });
    expect(revoteTerminal).toMatchObject({ id: 'r', stage: 'debate-revote', status: 'complete', waveId: 'r-rv' });

    const defenseStarted = events.find(e => e.event === 'stage-started' && e.stage === 'debate-defense');
    const defenseTerminal = events.find(e => e.event === 'stage-terminal' && e.stage === 'debate-defense');
    expect(defenseStarted).toBeDefined();
    expect(defenseTerminal).toMatchObject({ status: 'complete' });
  });
});
