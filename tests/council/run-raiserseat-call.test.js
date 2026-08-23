// tests/council/run-raiserseat-call.test.js
'use strict';

/**
 * @module tests/council/run-raiserseat-call
 * PR3 Task 5 review finding (Important): run.js's `raiserSeat` emit-when-
 * different guard (run.js's toGlobalFindings call site) had ZERO coverage of
 * its own. anonymize.js's toGlobalFindings independently re-implements the
 * same `raiserSeat && raiserSeat !== raiser` check, so a mutation of run.js's
 * guard to the naive `r.seat ? r.seat.id : null` form silently absorbs into a
 * correct artifact — every artifact-level test (run-happy, run-all-clean,
 * run-claude-review, run-waveids, and this task's own target gate) stays
 * green even though the CALLER contract is broken.
 *
 * This file pins what run.js PASSES as toGlobalFindings' 4th argument,
 * independently of what anonymize.js does with it — by spying on the real
 * anonymize.js (jest.requireActual, so behavior is untouched; the mock only
 * wraps toGlobalFindings to record its call args) and asserting on
 * `mock.calls[i][3]` directly. Defense in depth is correct here (both guards
 * stay); this file exists so removing EITHER one fails a test.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

jest.mock('../../src/council/anonymize', () => {
  const actual = jest.requireActual('../../src/council/anonymize');
  return { ...actual, toGlobalFindings: jest.fn(actual.toGlobalFindings) };
});
const { toGlobalFindings } = require('../../src/council/anonymize');
const { runCouncil } = require('../../src/council/run');
const {
  review, judgeOut, mkLeg, okWave, scriptedLaunchers, launchersFromScript, happyScript, baseOptions,
} = require('./helpers/fake-launchers');

let tmp;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'council-raiserseat-call-'));
  toGlobalFindings.mockClear();
});
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const noSignals = () => () => {};

describe("run.js's toGlobalFindings call site (v4.8 PR3 Task 5 review finding)", () => {
  test('unique-alias bench: every bench call passes null as the 4th arg (seat.id === alias)', async () => {
    const opts = baseOptions(tmp); // gemini/gpt/qwen — no repeated alias
    const result = await runCouncil(opts, {
      launchers: scriptedLaunchers(happyScript()),
      appendRunFn: () => {}, statsFn: () => [], installSignalAbortFn: noSignals,
    });
    expect(result.exitCode).toBe(0);
    // One call per s1 review (3, no claudeReview here so no 3-arg 'claude' call).
    expect(toGlobalFindings.mock.calls).toHaveLength(3);
    for (const call of toGlobalFindings.mock.calls) {
      expect(call[3]).toBeNull();
    }
  });

  test('twin-alias bench: each bench call passes ITS OWN differing seat id', async () => {
    const runId = 'twin01';
    const script = {
      [`${runId}-s1`]: (opts) => okWave(opts.models.map(m => mkLeg(m, review(m)))),
      [`${runId}-s2`]: () => okWave([
        mkLeg('gemini', judgeOut(['Review B', 'Review A'],
          [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'agree' }])),
        mkLeg('gemini', judgeOut(['Review A', 'Review B'],
          [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'agree' }])),
      ]),
      [`${runId}-ch1`]: () => okWave([
        mkLeg('deepseek', 'Synthesis of the twin bench.\n\nVERDICT: Ship it', 'complete', 0.03),
      ]),
    };
    const opts = baseOptions(tmp, {
      models: ['gemini', 'gemini'], runId, runDir: path.join(tmp, `council-${runId}`),
    });
    const result = await runCouncil(opts, {
      launchers: launchersFromScript(script),
      appendRunFn: () => {}, statsFn: () => [], installSignalAbortFn: noSignals,
    });
    expect(result.exitCode).toBe(0);
    expect(toGlobalFindings.mock.calls).toHaveLength(2);
    // Both calls are raiser 'gemini' (arg[1]) but each carries a DIFFERENT
    // 4th-arg seat id — the exact shape the naive `r.seat ? r.seat.id : null`
    // form cannot distinguish, since it would pass the same non-null seat id
    // regardless of whether it differs from the alias.
    const seatArgs = toGlobalFindings.mock.calls.map(c => c[3]).sort();
    expect(seatArgs).toEqual(['gemini#1', 'gemini#2']);
  });

  /**
   * v4.8 PR4c R4c-9. The guard's OPERAND moved from `r.model` (the leg's
   * modelInput) to `r.seat.alias`, so that all four seat-emit producers share
   * one predicate. §5 named no test for either PR3 producer, and measured, both
   * reverts were invisible to every other pin in the suite — including the twin
   * case above, where `seat.id !== r.model` and `seat.id !== seat.alias` agree.
   *
   * A whitespace-padded bench member separates them on a bench with no twin at
   * all: the seat's alias keeps its padding while fanout-validate.js:24 trims
   * the leg's — `seat.id !== r.model` is then TRUE, and PR3 emitted a seat id
   * that is byte-equal to its own alias into three artifacts, with nothing able
   * to resolve it (plan §1.2, on the engine path, on a unique-alias bench).
   * This drives BOTH producers at once: `raiserSeat` through the spied 4th arg,
   * and `adjudications[].seat` through the tally input it actually writes.
   *
   * ⚠️ THE PRODUCER MOVED, the shape did not. v4.8 SI-22.4 made
   * `src/utils/config.js :: classifyCouncilMembers` trim each `--council`
   * preset member, and both `--models` spellings already trimmed
   * (`src/cli-council-run-bench.js :: parseList`,
   * `src/sidecar/fanout-validate.js :: parseModelsList`), so a preset can no
   * longer put padding on a bench alias. The MCP `models` ARRAY still can:
   * `src/mcp-council-bench.js :: resolveBenchInput` returns it untrimmed —
   * measured, not assumed. This case passes `models` straight into runCouncil,
   * which is that shape. Do not retire it as unreachable.
   */
  test('R4c-9: a padded bench member emits NEITHER seat field (seat.id === its own alias)', async () => {
    const runId = 'pad01';
    const script = {
      [`${runId}-s1`]: (opts) => okWave(opts.models.map(m => mkLeg(m.trim(), review(m.trim())))),
      [`${runId}-s2`]: () => okWave([
        mkLeg('openai/gpt-5', judgeOut(['Review B', 'Review A'],
          [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'agree' }])),
        mkLeg('gpt', judgeOut(['Review A', 'Review B'],
          [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'agree' }])),
      ]),
      [`${runId}-ch1`]: () => okWave([
        mkLeg('deepseek', 'Synthesis of the padded bench.\n\nVERDICT: Ship it', 'complete', 0.03),
      ]),
    };
    const opts = baseOptions(tmp, {
      models: ['openai/gpt-5 ', 'gpt'], runId, runDir: path.join(tmp, `council-${runId}`),
    });
    const result = await runCouncil(opts, {
      launchers: launchersFromScript(script),
      appendRunFn: () => {}, statsFn: () => [], installSignalAbortFn: noSignals,
    });
    expect(result.exitCode).toBe(0);
    // The bench alias really is padded and the leg really did report it trimmed
    // — otherwise the two operands coincide and this whole case is vacuous.
    expect(toGlobalFindings.mock.calls.map(c => c[1])).toEqual(['openai/gpt-5', 'gpt']);
    expect(toGlobalFindings.mock.calls.map(c => c[3])).toEqual([null, null]);
    const input = JSON.parse(fs.readFileSync(path.join(opts.runDir, 'tally-input.json'), 'utf-8'));
    expect(input.meta.models).toEqual(['openai/gpt-5 ', 'gpt']);
    for (const a of input.adjudications) { expect('seat' in a).toBe(false); }
    for (const f of input.findings) { expect('raiserSeat' in f).toBe(false); }
    for (const r of input.runStats) { expect('seat' in r).toBe(false); }
  });
});
