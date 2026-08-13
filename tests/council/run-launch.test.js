// tests/council/run-launch.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createLaunchers, materializeReviews } = require('../../src/council/run-launch');
const { buildSeats } = require('../../src/council/seats');

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'council-launch-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

let legSeq = 0;
const mkLeg = (model, summary, status = 'complete') => ({
  taskId: `${model}-${++legSeq}`, model, modelInput: model, status, summary,
  durationMs: 1000, usage: { cost: { amount: 0.01, source: 'reported' } },
});

describe('launchWave (DI over runFanout)', () => {
  test('forwards council defaults: agent Plan, no context, quiet, verbose summaries', async () => {
    const seen = [];
    const fanoutFn = async (opts) => {
      seen.push(opts);
      return { wave: { waveId: opts.waveId, status: 'complete', legs: [] }, exitCode: 0 };
    };
    const { launchWave } = createLaunchers({ fanoutFn });
    const { exitCode } = await launchWave({
      models: ['gemini', 'gpt'], prompt: 'briefing text', project: tmp,
      waveId: 'abc123-s1', timeout: 10, gateway: 'auto', noValidateModel: false,
    });
    expect(exitCode).toBe(0);
    expect(seen[0].models).toBe('gemini,gpt');       // runFanout takes the comma string
    expect(seen[0].agent).toBe('Plan');              // engine default (fanout.js:184 is 'build')
    expect(seen[0].includeContext).toBe(false);      // self-contained briefings
    expect(seen[0].quiet).toBe(true);
    expect(seen[0].json).toBe(false);
    expect(seen[0].summaryLength).toBe('verbose');
    expect(seen[0].timeout).toBe(10);
    expect(seen[0].waveId).toBe('abc123-s1');
    expect(seen[0].project).toBe(tmp);
  });

  // Spec §6 judge isolation: a tool-capable judge leg must not be able to read
  // the de-anonymized review-*.md files or the plaintext labelMap in run.json.
  // The transport enforces this via `directory` (pins the OpenCode tool-exec
  // cwd) and `noMcp` (strips inherited MCP servers) — launchWave must forward
  // both on every council call (reviewers, judges, critic, lenses, chair).
  test('pins tool-exec directory to the run scope and disables MCP (spec §6 isolation)', async () => {
    const seen = [];
    const fanoutFn = async (opts) => {
      seen.push(opts);
      return { wave: { waveId: opts.waveId, status: 'complete', legs: [] }, exitCode: 0 };
    };
    const { launchWave } = createLaunchers({ fanoutFn });
    await launchWave({
      models: ['gemini', 'gpt'], prompt: 'briefing text', project: tmp,
      waveId: 'abc123-s2',
    });
    expect(seen[0].directory).toBe(tmp);
    expect(seen[0].noMcp).toBe(true);
  });

  /**
   * v4.4 (diagnosis §9, final paragraph): the council's `--max-cost` was NEVER
   * threaded into the per-wave pre-flight estimate. launchWave passed
   * `noCostGate` but no `maxCost`, so src/sidecar/fanout.js fell back to
   * `cfg.maxCost` — a key that does not exist in src/utils/config.js. Result:
   * for council runs the src/sidecar/budget.js SOFT ceiling was inert, and
   * src/council/run.js's post-hoc `overBudget()` was the ONLY ceiling, which by
   * construction can only refuse AFTER money has already been spent.
   *
   * The value threaded is REMAINING budget (ceiling − known spend), not the raw
   * ceiling: a mid-run wave must be measured against what is left, not against
   * the whole allowance it has already partly consumed.
   */
  test('threads the REMAINING budget into the fanout pre-flight cost gate', async () => {
    const seen = [];
    const fanoutFn = async (opts) => {
      seen.push(opts);
      return { wave: { waveId: opts.waveId, status: 'complete', legs: [] }, exitCode: 0 };
    };
    const { launchWave } = createLaunchers({ fanoutFn, remainingBudget: () => 0.42 });
    await launchWave({ models: ['gemini'], prompt: 'p', project: tmp, waveId: 'abc123-s2' });
    expect(seen[0].maxCost).toBeCloseTo(0.42, 6);
  });

  test('omits maxCost entirely when no budget provider is wired (non-council callers unchanged)', async () => {
    const seen = [];
    const fanoutFn = async (opts) => {
      seen.push(opts);
      return { wave: { waveId: opts.waveId, status: 'complete', legs: [] }, exitCode: 0 };
    };
    const { launchWave } = createLaunchers({ fanoutFn });
    await launchWave({ models: ['gemini'], prompt: 'p', project: tmp, waveId: 'abc123-s1' });
    expect(seen[0].maxCost).toBeUndefined();
  });

  test('a null/undefined remaining budget (no ceiling set) forwards nothing', async () => {
    const seen = [];
    const fanoutFn = async (opts) => {
      seen.push(opts);
      return { wave: { waveId: opts.waveId, status: 'complete', legs: [] }, exitCode: 0 };
    };
    const { launchWave } = createLaunchers({ fanoutFn, remainingBudget: () => null });
    await launchWave({ models: ['gemini'], prompt: 'p', project: tmp, waveId: 'abc123-s1' });
    expect(seen[0].maxCost).toBeUndefined();
  });
});

describe('launchSolo (single-leg wave)', () => {
  test('wraps one model and returns the leg', async () => {
    const fanoutFn = async (opts) => ({
      wave: { waveId: opts.waveId, status: 'complete', legs: [mkLeg('deepseek', 'chair says hi')] },
      exitCode: 0,
    });
    const { launchSolo } = createLaunchers({ fanoutFn });
    const { leg } = await launchSolo({ model: 'deepseek', prompt: 'p', project: tmp, waveId: 'abc123-ch1' });
    expect(leg.model).toBe('deepseek');
    expect(leg.summary).toBe('chair says hi');
  });

  test('a wave with no legs yields leg null (routing failure surface)', async () => {
    const fanoutFn = async () => ({ wave: { status: 'error', legs: [] }, exitCode: 1 });
    const { launchSolo } = createLaunchers({ fanoutFn });
    const { leg, exitCode } = await launchSolo({ model: 'x', prompt: 'p', project: tmp, waveId: 'w' });
    expect(leg).toBeNull();
    expect(exitCode).toBe(1);
  });

  test('inherits the spec §6 isolation knobs from launchWave (critic/lens/chair legs)', async () => {
    const seen = [];
    const fanoutFn = async (opts) => {
      seen.push(opts);
      return { wave: { waveId: opts.waveId, status: 'complete', legs: [mkLeg('deepseek', 'x')] }, exitCode: 0 };
    };
    const { launchSolo } = createLaunchers({ fanoutFn });
    await launchSolo({ model: 'deepseek', prompt: 'p', project: tmp, waveId: 'abc123-ch1' });
    expect(seen[0].directory).toBe(tmp);
    expect(seen[0].noMcp).toBe(true);
  });
});

describe('materializeReviews', () => {
  test('writes review-<modelInput>.md for completed legs, skips dead/empty legs', () => {
    const legs = [
      mkLeg('gemini', 'gemini review text'),
      mkLeg('gpt', '', 'complete'),            // empty summary → skipped
      mkLeg('deepseek', 'x', 'error'),         // dead leg → skipped
    ];
    const out = materializeReviews(tmp, legs);
    expect(out).toHaveLength(1);
    expect(out[0].model).toBe('gemini');
    expect(fs.readFileSync(path.join(tmp, 'review-gemini.md'), 'utf-8')).toBe('gemini review text');
    expect(fs.existsSync(path.join(tmp, 'review-gpt.md'))).toBe(false);
  });

  test('sanitizes provider/model ids in filenames', () => {
    const out = materializeReviews(tmp, [mkLeg('openrouter/deepseek/deepseek-chat', 'text')]);
    expect(path.basename(out[0].file)).toBe('review-openrouter-deepseek-deepseek-chat.md');
  });
});

describe('materializeReviews seat naming', () => {
  test('a bound seat names the file via artifactName; twins no longer clobber', () => {
    const seats = buildSeats(['deepseek', 'deepseek'], null, null);
    const legs = [{ modelInput: 'deepseek', status: 'complete', summary: 'first' },
      { modelInput: 'deepseek', status: 'complete', summary: 'second' }];
    const seatOf = new Map([[legs[0], seats[0]], [legs[1], seats[1]]]);
    const out = materializeReviews(tmp, legs, seatOf);
    expect(out.map(m => path.basename(m.file)))
      .toEqual(['review-deepseek-1.md', 'review-deepseek-2.md']);
    expect(fs.readFileSync(out[0].file, 'utf8')).toBe('first');
    expect(fs.readFileSync(out[1].file, 'utf8')).toBe('second');
    expect(out.map(m => m.seat.id)).toEqual(['deepseek#1', 'deepseek#2']);
  });

  test('a unique-alias bench is BYTE-IDENTICAL with or without a seat', () => {
    const seats = buildSeats(['gpt'], null, null);
    const legs = [{ modelInput: 'gpt', status: 'complete', summary: 'r' }];
    const withSeat = materializeReviews(tmp, legs, new Map([[legs[0], seats[0]]]));
    const without = materializeReviews(tmp, legs);
    expect(path.basename(withSeat[0].file)).toBe('review-gpt.md');
    expect(path.basename(without[0].file)).toBe('review-gpt.md');
  });

  test('an unbound (orphan) leg keeps its alias filename and reports seat null', () => {
    const legs = [{ modelInput: 'zzz', status: 'complete', summary: 'r' }];
    const out = materializeReviews(tmp, legs, new Map());
    expect(path.basename(out[0].file)).toBe('review-zzz.md');
    expect(out[0].seat).toBeNull();
  });

  test('a bound but DEAD leg is still rejected — bound does not mean usable', () => {
    const seats = buildSeats(['gpt'], null, null);
    const legs = [{ modelInput: 'gpt', status: 'timeout', summary: 'r' }];
    expect(materializeReviews(tmp, legs, new Map([[legs[0], seats[0]]]))).toEqual([]);
  });
});

describe('retryOfWaveId passthrough (SL-2)', () => {
  test('launchWave forwards retryOfWaveId to the transport when present', async () => {
    const fanoutFn = jest.fn().mockResolvedValue({ wave: { waveId: 'r-s1r1', legs: [] }, exitCode: 0 });
    const { launchWave } = createLaunchers({ fanoutFn });
    await launchWave({ models: ['gpt'], prompt: 'p', project: tmp, waveId: 'r-s1r1',
      retryOfWaveId: 'r-s1' });
    expect(fanoutFn.mock.calls[0][0].retryOfWaveId).toBe('r-s1');
  });

  test('a launch without retryOfWaveId sends NO retryOfWaveId key (byte-identical transport call)', async () => {
    const fanoutFn = jest.fn().mockResolvedValue({ wave: { waveId: 'r-s1', legs: [] }, exitCode: 0 });
    const { launchWave } = createLaunchers({ fanoutFn });
    await launchWave({ models: ['gpt'], prompt: 'p', project: tmp, waveId: 'r-s1' });
    expect('retryOfWaveId' in fanoutFn.mock.calls[0][0]).toBe(false);
  });
});

describe('noOutputBackstopMs passthrough (Task 5, #129)', () => {
  test('forwards a provided noOutputBackstopMs to the transport', async () => {
    const fanoutFn = jest.fn().mockResolvedValue({ wave: { waveId: 'w', legs: [] }, exitCode: 0 });
    const { launchWave } = createLaunchers({ fanoutFn });
    await launchWave({ models: ['gpt'], prompt: 'p', project: tmp, waveId: 'w', noOutputBackstopMs: 240000 });
    expect(fanoutFn.mock.calls[0][0].noOutputBackstopMs).toBe(240000);
  });

  test('forwards an explicit 0 unchanged — 0 is the documented disable hatch', async () => {
    // A truthiness spread-guard would drop this. no-output-backstop.js:13-15
    // exists precisely so an explicit 0 is honoured; createNoOutputBackstop
    // arms only on ms > 0, so 0 means "never arm".
    const fanoutFn = jest.fn().mockResolvedValue({ wave: { waveId: 'w', legs: [] }, exitCode: 0 });
    const { launchWave } = createLaunchers({ fanoutFn });
    await launchWave({ models: ['gpt'], prompt: 'p', project: tmp, waveId: 'w', noOutputBackstopMs: 0 });
    expect(fanoutFn.mock.calls[0][0].noOutputBackstopMs).toBe(0);
  });

  test('omits the key entirely when the caller does not set it', async () => {
    const fanoutFn = jest.fn().mockResolvedValue({ wave: { waveId: 'w', legs: [] }, exitCode: 0 });
    const { launchWave } = createLaunchers({ fanoutFn });
    await launchWave({ models: ['gpt'], prompt: 'p', project: tmp, waveId: 'w' });
    expect('noOutputBackstopMs' in fanoutFn.mock.calls[0][0]).toBe(false);
  });
});
