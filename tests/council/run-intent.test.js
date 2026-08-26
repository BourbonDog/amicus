// tests/council/run-intent.test.js — v4.9 W5.3: engine intent plumbing.
//
// The intent channel (spec §5.3 / phasing rulings V9+V12, as amended by the
// W4/W5 plan's emit-when-'task' ruling): DOWNSTREAM of validation `o.intent` is
// 'task' or ABSENT, and every artifact materializes the key ONLY on a task run,
// so a review run's tally-input.json, tally.json, run.json and verdict.json stay
// byte-identical to pre-wave.
// ⚠️ AT THE DOOR the engine also ACCEPTS the third spelling (PR #200 A3): both
// transports strip 'review', but runCouncil is a public entry point too, so it
// normalizes 'review' to absent rather than refusing it — see the flipped pin
// below. Unknown values are still BAD_ARGS pre-spend.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runCouncil } = require('../../src/council/run');
const { scriptedLaunchers, happyScript, baseOptions, mkLeg, okWave } =
  require('./helpers/fake-launchers');

// v4.9 W7: a TASK chair closes with an `ANSWER:` line, never a `VERDICT:` one
// (src/council/briefings-chair-task.js :: ANSWER_SCALE_ADDENDUM). happyScript's
// chair speaks review mode, so a task run driven with it has no parseable
// terminal line and buys an unscripted ch4 repair — the task runs below answer.
const taskChair = (script) => ({
  ...script,
  'abc123-ch1': () => okWave([mkLeg('deepseek', 'Synthesis.\n\nANSWER: Converged', 'complete', 0.03)]),
});

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'council-intent-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

// Repo idiom for every driver test: inject the ledger + stats + signal seams.
const deps = (launchers) => ({
  launchers, appendRunFn: jest.fn(), statsFn: () => [], installSignalAbortFn: () => () => {},
});

// Launchers that only count — a validation that fires PRE-SPEND never reaches them.
const countingLaunchers = (counter) => ({
  launchWave: async () => { counter.n += 1; return { wave: { legs: [] } }; },
  launchSolo: async () => { counter.n += 1; return { wave: { legs: [] }, leg: null }; },
});

const readDoc = (name) =>
  JSON.parse(fs.readFileSync(path.join(tmp, 'council-abc123', name), 'utf-8'));

describe('v4.9 W5.3: runCouncil intent validation — BAD_ARGS pre-spend', () => {
  test("intent:'bogus' exits 1 BAD_ARGS with zero launches", async () => {
    const counter = { n: 0 };
    const { exitCode, run } = await runCouncil(
      baseOptions(tmp, { intent: 'bogus' }), deps(countingLaunchers(counter)));
    expect(exitCode).toBe(1);
    expect(counter.n).toBe(0);
    expect(run.error.code).toBe('BAD_ARGS');
    expect(run.error.message).toContain("'task'");
    expect(run.error.message).toContain('bogus');
  });

  /**
   * ⚠️ FLIPPED by PR #200 round-3 finding A3 (lead ruling). This pin used to
   * assert `intent:'review'` was BAD_ARGS at the engine, on the reasoning that
   * both transports strip it so the engine can only ever see it by mistake.
   * They do strip it — `--intent review` is accepted and dropped
   * (cli-handlers-council-run.js) and the MCP path forwards only 'task'
   * (mcp-council-run.js) — but runCouncil is a public entry point in its own
   * right, so one spelling meant two different things at two doors: accepted
   * and ignored at the CLI, a hard refusal one layer in.
   *
   * The ENGINE NORMALIZES instead: 'review' is the default spelled out loud, so
   * it becomes ABSENT — which is exactly what "never materialized" already
   * means everywhere downstream — and the run proceeds as the review run it
   * asked to be. Only a genuinely unknown value is still BAD_ARGS (the pin
   * directly above). What must NOT change is the byte-identity contract: a
   * normalized 'review' has to leave the same artifacts as an omitted intent,
   * which is what the second half of this test measures.
   */
  test("intent:'review' is NORMALIZED to absent, not refused — and materializes nowhere", async () => {
    const { exitCode } = await runCouncil(
      baseOptions(tmp, { intent: 'review' }), deps(scriptedLaunchers(happyScript())));
    expect(exitCode).toBe(0);
    expect('intent' in readDoc('tally-input.json').meta).toBe(false);
    expect('intent' in readDoc('tally.json').meta).toBe(false);
    expect('intent' in readDoc('run.json')).toBe(false);
    expect('intent' in readDoc('verdict.json')).toBe(false);
    for (const name of ['tally-input.json', 'tally.json', 'run.json', 'verdict.json']) {
      expect(fs.readFileSync(path.join(tmp, 'council-abc123', name), 'utf-8'))
        .not.toContain('"intent"');
    }
  });

  test("V12: intent:'task' + claudeReviewFile → BAD_ARGS pre-spend, message names the limitation", async () => {
    // A VALID review file, so the only thing that can refuse is the V12 block.
    const reviewPath = path.join(tmp, 'review-claude.md');
    fs.writeFileSync(reviewPath,
      'Claude review prose.\n```json\n{"overall":"t","findings":[{"id":1,"severity":"major","claim":"c","location":"l","rationale":"r"}]}\n```\n');
    const counter = { n: 0 };
    const { exitCode, run } = await runCouncil(
      baseOptions(tmp, { intent: 'task', claudeReviewFile: reviewPath }),
      deps(countingLaunchers(counter)));
    expect(exitCode).toBe(1);
    expect(counter.n).toBe(0);
    expect(run.error.code).toBe('BAD_ARGS');
    expect(run.error.message).toContain('--claude-review');
    expect(run.error.message).toContain('review N+1');
  });
});

describe("v4.9 W5.3: a task run stamps intent:'task' on meta, run.json and the verdict", () => {
  test('emit-when-task, all four artifacts', async () => {
    const { exitCode } = await runCouncil(
      baseOptions(tmp, { intent: 'task' }), deps(scriptedLaunchers(taskChair(happyScript()))));
    expect(exitCode).toBe(0);
    expect(readDoc('tally-input.json').meta.intent).toBe('task');
    expect(readDoc('tally.json').meta.intent).toBe('task');
    expect(readDoc('run.json').intent).toBe('task');
    expect(readDoc('verdict.json').intent).toBe('task');
  });

  test('meta.intent is a pure TAIL — the shipped six-key meta order is untouched', async () => {
    await runCouncil(baseOptions(tmp, { intent: 'task' }),
      deps(scriptedLaunchers(taskChair(happyScript()))));
    expect(Object.keys(readDoc('tally.json').meta)).toEqual(
      ['runId', 'date', 'runType', 'models', 'chair', 'claudeInCouncil', 'intent']);
  });
});

describe('v4.9 W5.3: a review run carries NO intent key ANYWHERE (byte-identity absence pins)', () => {
  test("absent option → no 'intent' key in any artifact, and no such byte sequence at all", async () => {
    const { exitCode } = await runCouncil(baseOptions(tmp), deps(scriptedLaunchers(happyScript())));
    expect(exitCode).toBe(0);
    // ⚠️ `in`, not toBeUndefined: `{intent: undefined}` reads as undefined but
    // still changes JSON output paths — the T10 lesson (verdict.test.js).
    expect('intent' in readDoc('tally-input.json').meta).toBe(false);
    expect('intent' in readDoc('tally.json').meta).toBe(false);
    expect('intent' in readDoc('run.json')).toBe(false);
    expect('intent' in readDoc('verdict.json')).toBe(false);
    for (const name of ['tally-input.json', 'tally.json', 'run.json', 'verdict.json']) {
      expect(fs.readFileSync(path.join(tmp, 'council-abc123', name), 'utf-8'))
        .not.toContain('"intent"');
    }
  });
});
