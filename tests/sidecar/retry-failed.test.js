'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildRetryPlan } = require('../../src/sidecar/fanout-retry'); // DE-ROT (B1): retry engine extracted here
const { getSessionDir } = require('../../src/session-manager');

function project() { return fs.mkdtempSync(path.join(os.tmpdir(), 'retry-')); }
function writeLeg(proj, id, meta, ctx) {
  const dir = getSessionDir(proj, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify(meta));
  if (ctx) { fs.writeFileSync(path.join(dir, 'initial_context.md'), ctx); }
  return dir;
}
function writeWave(proj, id, status, legIds, models) {
  const dir = getSessionDir(proj, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify({ taskId: id, type: 'wave', status, legs: legIds, models }));
  fs.writeFileSync(path.join(dir, 'briefing.md'), 'BRIEFING');
  return dir;
}

describe('buildRetryPlan (spec 6.1, resolved Q4)', () => {
  test('selects only terminal non-complete legs; loads saved context', () => {
    const proj = project();
    writeWave(proj, 'w1', 'partial', ['w1-1', 'w1-2'], ['gpt', 'qwen']);
    writeLeg(proj, 'w1-1', { taskId: 'w1-1', model: 'gpt', status: 'complete' }, 'CTX1');
    writeLeg(proj, 'w1-2', { taskId: 'w1-2', model: 'qwen', status: 'error' }, 'sys\n---\nuser');
    const plan = buildRetryPlan('w1', proj, {});
    expect(plan.eligible.map(e => e.legId)).toEqual(['w1-2']);
    expect(plan.eligible[0].model).toBe('qwen');
  });

  test('refuses while the original wave is still running', () => {
    const proj = project();
    writeWave(proj, 'w1', 'running', ['w1-1'], ['gpt']);
    writeLeg(proj, 'w1-1', { taskId: 'w1-1', model: 'gpt', status: 'running' });
    expect(buildRetryPlan('w1', proj, {}).error).toMatch(/running/i);
  });

  test('zero eligible -> empty plan (friendly no-op)', () => {
    const proj = project();
    writeWave(proj, 'w1', 'complete', ['w1-1'], ['gpt']);
    writeLeg(proj, 'w1-1', { taskId: 'w1-1', model: 'gpt', status: 'complete' });
    const plan = buildRetryPlan('w1', proj, {});
    expect(plan.error).toBeUndefined();
    expect(plan.eligible).toEqual([]);
  });

  test('--models filters the eligible set', () => {
    const proj = project();
    writeWave(proj, 'w1', 'partial', ['w1-1', 'w1-2'], ['gpt', 'qwen']);
    writeLeg(proj, 'w1-1', { taskId: 'w1-1', model: 'gpt', status: 'error' }, 'c');
    writeLeg(proj, 'w1-2', { taskId: 'w1-2', model: 'qwen', status: 'timeout' }, 'c');
    const plan = buildRetryPlan('w1', proj, { models: ['qwen'] });
    expect(plan.eligible.map(e => e.model)).toEqual(['qwen']);
  });
});

const { retryFailedWave } = require('../../src/sidecar/fanout-retry'); // DE-ROT (B1): moved to fanout-retry
const { deriveLegIds } = require('../../src/sidecar/fanout');
const { createEventTail, EVENTS_FILE } = require('../../src/observe/events');

describe('retryFailedWave (spec 6.1 — new linked wave + additive linkage)', () => {
  test('retries only failed legs; writes retryOf/retriedBy/retry-started/effective', async () => {
    const proj = project();
    writeWave(proj, 'w1', 'partial', ['w1-1', 'w1-2'], ['gpt', 'qwen']);
    writeLeg(proj, 'w1-1', { taskId: 'w1-1', model: 'gpt', status: 'complete' }, 'c1');
    writeLeg(proj, 'w1-2', { taskId: 'w1-2', model: 'qwen', status: 'error' }, 'c2');

    // fake runFanout: simulates the new wave + leg dirs on disk, returns a doc
    let launched = null;
    const fakeRunFanout = async (o) => {
      launched = o;
      const wDir = getSessionDir(proj, o.waveId);
      fs.mkdirSync(wDir, { recursive: true });
      const legIds = deriveLegIds(o.waveId, o.models.length);
      fs.writeFileSync(path.join(wDir, 'metadata.json'),
        JSON.stringify({ taskId: o.waveId, type: 'wave', status: 'complete', legs: legIds }));
      legIds.forEach((legId, i) => {
        const lDir = getSessionDir(proj, legId);
        fs.mkdirSync(lDir, { recursive: true });
        fs.writeFileSync(path.join(lDir, 'metadata.json'),
          JSON.stringify({ taskId: legId, model: o.models[i], status: 'complete' }));
      });
      return {
        wave: {
          type: 'wave', waveId: o.waveId, status: 'complete',
          legs: legIds.map((legId, i) => ({ taskId: legId, model: o.models[i], status: 'complete',
            usage: { tokens: { input: 10, output: 4 }, cost: { amount: 0.001, source: 'reported' } } })),
        },
        exitCode: 0,
      };
    };

    const { wave, exitCode } = await retryFailedWave('w1', proj, { runFanout: fakeRunFanout, quiet: true });

    // only the failed leg (qwen) was retried, with its retryOfWaveId threaded
    expect(launched.models).toEqual(['qwen']);
    expect(launched.retryOfWaveId).toBe('w1');
    expect(launched.retryContexts[0].origLegId).toBe('w1-2');
    expect(exitCode).toBe(0);

    // new wave doc + metadata carry retryOf
    const newWaveId = launched.waveId;
    expect(wave.retryOf).toBe('w1');
    const newMeta = JSON.parse(fs.readFileSync(path.join(getSessionDir(proj, newWaveId), 'metadata.json'), 'utf-8'));
    expect(newMeta.retryOf).toBe('w1');

    // new leg metadata gains retryOf:<origLegId>
    const newLegId = deriveLegIds(newWaveId, 1)[0];
    const newLegMeta = JSON.parse(fs.readFileSync(path.join(getSessionDir(proj, newLegId), 'metadata.json'), 'utf-8'));
    expect(newLegMeta.retryOf).toBe('w1-2');

    // ORIGINAL wave gains retriedBy:[newWaveId]
    const origMeta = JSON.parse(fs.readFileSync(path.join(getSessionDir(proj, 'w1'), 'metadata.json'), 'utf-8'));
    expect(origMeta.retriedBy).toContain(newWaveId);

    // retry-started event in the new wave dir
    const evs = createEventTail(path.join(getSessionDir(proj, newWaveId), EVENTS_FILE)).poll();
    expect(evs.some(e => e.event === 'retry-started' && e.retryOf === 'w1')).toBe(true);

    // effective block: one entry per original failed slot, latest status + usage
    expect(wave.effective).toEqual([{
      origLegId: 'w1-2', model: 'qwen', status: 'complete',
      usage: { tokens: { input: 10, output: 4 }, cost: { amount: 0.001, source: 'reported' } },
    }]);
  });

  test('error plan -> exit 1 error envelope; zero eligible -> exit 0 no-op (runFanout never called)', async () => {
    const proj = project();
    writeWave(proj, 'w1', 'complete', ['w1-1'], ['gpt']);
    writeLeg(proj, 'w1-1', { taskId: 'w1-1', model: 'gpt', status: 'complete' });
    let called = false;
    const fake = async () => { called = true; return { wave: null, exitCode: 0 }; };
    const out = await retryFailedWave('w1', proj, { runFanout: fake, quiet: true });
    expect(out.exitCode).toBe(0);
    expect(out.wave).toBeNull();
    expect(called).toBe(false); // nothing to retry -> no wave launched

    const running = project();
    writeWave(running, 'w2', 'running', ['w2-1'], ['gpt']);
    writeLeg(running, 'w2-1', { taskId: 'w2-1', model: 'gpt', status: 'running' });
    const err = await retryFailedWave('w2', running, { runFanout: fake, quiet: true });
    expect(err.exitCode).toBe(1);
    expect(err.errorDoc.error.message).toMatch(/running/i); // ⚠️ DE-ROT (N7): buildErrorDoc nests the message at errorDoc.error.message — `errorDoc.error || errorDoc.message` yields the error OBJECT, and toMatch on an object throws "received must be a string".
  });
});
