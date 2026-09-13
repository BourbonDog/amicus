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
const { finishRun } = require('../../src/council/run-finish');
const { scriptedLaunchers, happyScript, baseOptions, mkLeg, okWave } =
  require('./helpers/fake-launchers');

// v4.9 W7: a TASK chair closes with an `ANSWER:` line, never a `VERDICT:` one
// (src/council/briefings-chair-task.js :: ANSWER_SCALE_ADDENDUM), so the task
// run below answers rather than leaving the terminal line unparseable.
const taskChair = (script) => ({
  ...script,
  'abc123-ch1': () => okWave([mkLeg('deepseek', 'Synthesis.\n\nANSWER: Converged', 'complete', 0.03)]),
});

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'council-ledger-gate-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const noSignals = () => () => {};

test("a task run (intent:'task') never calls appendRunFn — and is still a clean exit-0 run", async () => {
  const appendRunFn = jest.fn();
  const { exitCode } = await runCouncil(baseOptions(tmp, { intent: 'task' }), {
    launchers: scriptedLaunchers(taskChair(happyScript())), appendRunFn,
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

/**
 * P3-R13 (council #248 round 1, C1/D1, provisional — the owner may veto): finishRun's new
 * end-of-run stderr Notice. Driven by calling finishRun DIRECTLY with a hand-built context —
 * the plain data the function already takes as parameters, not a new harness — because
 * producing a `findingsUnverified: true` row through the real bounded-repair loop would need a
 * from-scratch stage1/repair/stage2/chair script keyed to a model ('glm') this suite never
 * benches, disproportionate to what this stderr-only change needs to be exercised.
 */
function finishRunCtx(runDir, runStatsRows) {
  fs.mkdirSync(runDir, { recursive: true });
  return {
    o: { runDir, runId: 'g1', chair: 'deepseek', debate: false, critic: null, lenses: null,
      intent: undefined, follow: null },
    chairRes: { chairLeg: null, actualChair: null, chairText: '', chairConformance: null,
      overallVerdict: null, chairRows: [], chairAttempts: [] },
    debatedInput: {
      meta: { runId: 'g1', runType: 'headless', date: '2026-09-13', chair: 'deepseek',
        models: ['glm'], claudeInCouncil: false },
      findings: [], rankings: [], adjudications: [],
      // A single hand-built row (every P3-R13 case) or an array of them (P3-R17's mixed case).
      runStats: Array.isArray(runStatsRows) ? runStatsRows : [runStatsRows],
    },
    debateFindings: null, appendRunFn: jest.fn(), degrade: { all: () => [] }, deadWaves: [],
    now: () => '2026-09-13T00:00:00.000Z',
  };
}

test('a completed bench seat flagged findingsUnverified prints exactly one Notice: line on stderr naming it (P3-R13)', () => {
  const runDir = path.join(tmp, 'council-g1');
  const row = { model: 'glm', role: 'seat', wasChair: false, conformance: 'repaired',
    status: 'complete', durationMs: 1, usage: null, findingsUnverified: true };
  const spy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  try {
    finishRun(finishRunCtx(runDir, row));
    expect(spy).toHaveBeenCalledTimes(1);
    const notice = spy.mock.calls[0][0];
    expect(notice.startsWith('Notice: 1 of ')).toBe(true);
    expect(notice).toContain('(glm)');
    expect(notice).toContain('report.html');
  } finally {
    spy.mockRestore();
  }
});

test('a run with no unverified seats prints no Notice: line about verification (P3-R13)', () => {
  const runDir = path.join(tmp, 'council-g2');
  const row = { model: 'glm', role: 'seat', wasChair: false, conformance: 'clean',
    status: 'complete', durationMs: 1, usage: null };
  const spy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  try {
    finishRun(finishRunCtx(runDir, row));
    const notice = spy.mock.calls.map(c => c[0]).find(s => s.includes('nothing could verify'));
    expect(notice).toBeUndefined();
  } finally {
    spy.mockRestore();
  }
});

test('a completed bench seat with a refused repair prints exactly one Notice: line on stderr naming it (P3-R17)', () => {
  const runDir = path.join(tmp, 'council-g3');
  const row = { model: 'qwen', role: 'seat', wasChair: false, conformance: 'unstructured',
    status: 'complete', durationMs: 1, usage: null,
    repairRefused: { code: 'REPAIR_CHANGED_FINDING_COUNT', detail: 'repair returned 2 findings, original attempted 3' } };
  const spy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  try {
    finishRun(finishRunCtx(runDir, row));
    expect(spy).toHaveBeenCalledTimes(1);
    const notice = spy.mock.calls[0][0];
    expect(notice.startsWith('Notice: 1 of ')).toBe(true);
    expect(notice).toContain("repairs were refused and contributed no findings (qwen)");
    expect(notice).not.toContain('nothing could verify');
  } finally {
    spy.mockRestore();
  }
});

test('a run with both an unverified seat and a refused seat prints one Notice: line naming both, unverified first (P3-R17)', () => {
  const runDir = path.join(tmp, 'council-g4');
  const glmRow = { model: 'glm', role: 'seat', wasChair: false, conformance: 'repaired',
    status: 'complete', durationMs: 1, usage: null, findingsUnverified: true };
  const qwenRow = { model: 'qwen', role: 'seat', wasChair: false, conformance: 'unstructured',
    status: 'complete', durationMs: 1, usage: null,
    repairRefused: { code: 'REPAIR_CHANGED_FINDING_COUNT', detail: 'repair returned 2 findings, original attempted 3' } };
  const spy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  try {
    finishRun(finishRunCtx(runDir, [glmRow, qwenRow]));
    expect(spy).toHaveBeenCalledTimes(1);
    const notice = spy.mock.calls[0][0];
    expect(notice).toContain("nothing could verify (glm)");
    expect(notice).toContain("contributed no findings (qwen)");
    // Joined by '; ', unverified first — the exact separator the code emits between clauses.
    expect(notice).toContain('(glm); ');
    expect(notice.indexOf('(glm)')).toBeLessThan(notice.indexOf('(qwen)'));
  } finally {
    spy.mockRestore();
  }
});
