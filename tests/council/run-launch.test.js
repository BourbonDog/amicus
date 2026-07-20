// tests/council/run-launch.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createLaunchers, materializeReviews } = require('../../src/council/run-launch');

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'council-launch-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const mkLeg = (model, summary, status = 'complete') => ({
  taskId: `${model}-leg`, model, modelInput: model, status, summary,
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
