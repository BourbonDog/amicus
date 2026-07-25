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
const { saveInitialContext } = require('../../src/sidecar/session-utils');

describe('retryFailedWave (spec 6.1 — new linked wave + additive linkage)', () => {
  test('retries only failed legs; writes retryOf/retriedBy/retry-started/effective', async () => {
    const proj = project();
    writeWave(proj, 'w1', 'partial', ['w1-1', 'w1-2'], ['gpt', 'qwen']);
    writeLeg(proj, 'w1-1', { taskId: 'w1-1', model: 'gpt', status: 'complete' }, 'c1');
    writeLeg(proj, 'w1-2', { taskId: 'w1-2', model: 'qwen', status: 'error' }, 'c2');

    // fake runFanout: simulates the new wave + leg dirs on disk, returns a doc.
    // Real runFanout requires `models` as a comma-separated STRING (its own
    // parseModelsList/validateFanoutModels contract) — the fake mirrors that
    // real contract rather than the old (buggy) array shape.
    let launched = null;
    const fakeRunFanout = async (o) => {
      launched = o;
      const wDir = getSessionDir(proj, o.waveId);
      fs.mkdirSync(wDir, { recursive: true });
      const modelList = o.models.split(',');
      const legIds = deriveLegIds(o.waveId, modelList.length);
      fs.writeFileSync(path.join(wDir, 'metadata.json'),
        JSON.stringify({ taskId: o.waveId, type: 'wave', status: 'complete', legs: legIds }));
      legIds.forEach((legId, i) => {
        const lDir = getSessionDir(proj, legId);
        fs.mkdirSync(lDir, { recursive: true });
        fs.writeFileSync(path.join(lDir, 'metadata.json'),
          JSON.stringify({ taskId: legId, model: modelList[i], status: 'complete' }));
      });
      return {
        wave: {
          type: 'wave', waveId: o.waveId, status: 'complete',
          legs: legIds.map((legId, i) => ({ taskId: legId, model: modelList[i], status: 'complete',
            usage: { tokens: { input: 10, output: 4 }, cost: { amount: 0.001, source: 'reported' } } })),
        },
        exitCode: 0,
      };
    };

    const { wave, exitCode } = await retryFailedWave('w1', proj, { runFanout: fakeRunFanout, quiet: true });

    // only the failed leg (qwen) was retried, with its retryOfWaveId threaded
    expect(launched.models).toBe('qwen');
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

  // Fix Wave 1, Finding 1 (CRITICAL): `models` MUST reach runFanout as a
  // comma-separated STRING (its own parseModelsList/validateFanoutModels
  // contract) — an array silently fails validateFanoutModels, which bails
  // BEFORE any leg launches. Dedicated multi-leg test so array-vs-string is
  // unambiguous (`.toEqual(['gpt','qwen'])` would still "pass" a naive
  // single-model check; `typeof ... === 'string'` cannot).
  test('Finding 1: models is threaded to runFanout as a comma-separated STRING, not an array', async () => {
    const proj = project();
    writeWave(proj, 'w5', 'partial', ['w5-1', 'w5-2'], ['gpt', 'qwen']);
    writeLeg(proj, 'w5-1', { taskId: 'w5-1', model: 'gpt', status: 'error' }, 'c1');
    writeLeg(proj, 'w5-2', { taskId: 'w5-2', model: 'qwen', status: 'timeout' }, 'c2');

    // wave:null keeps this test focused on the CAPTURED CALL ARGS — the
    // linkage-write path (which needs on-disk new-wave/leg dirs) is already
    // covered end-to-end by the first test above.
    let captured = null;
    const fake = async (o) => { captured = o; return { wave: null, exitCode: 0 }; };
    await retryFailedWave('w5', proj, { runFanout: fake, quiet: true });

    expect(typeof captured.models).toBe('string');
    expect(captured.models).toBe('gpt,qwen');
  });

  // Fix Wave 1, Finding 2 (CRITICAL): if runFanout returns no wave (a
  // pre-flight failure INSIDE the retry launch itself, e.g. the budget gate —
  // distinct from buildRetryPlan's own error, which never calls runFanout at
  // all), retryFailedWave must NOT record a false retry on the original wave.
  test('Finding 2: a pre-flight failure inside the retry launch (wave:null) leaves the original wave metadata untouched', async () => {
    const proj = project();
    writeWave(proj, 'w6', 'partial', ['w6-1'], ['gpt']);
    writeLeg(proj, 'w6-1', { taskId: 'w6-1', model: 'gpt', status: 'error' }, 'c1');
    const origMetaPath = path.join(getSessionDir(proj, 'w6'), 'metadata.json');
    const origMetaBefore = fs.readFileSync(origMetaPath, 'utf-8');

    const fakeFail = async () => ({
      wave: null, exitCode: 1,
      errorDoc: { error: { code: 'BUDGET_EXCEEDED', message: 'refused' } },
    });
    const out = await retryFailedWave('w6', proj, { runFanout: fakeFail, quiet: true });

    expect(out.wave).toBeNull();
    expect(out.exitCode).toBe(1);
    // ORIGINAL wave metadata byte-identical — no retriedBy, nothing rewritten
    expect(fs.readFileSync(origMetaPath, 'utf-8')).toBe(origMetaBefore);
    const origMeta = JSON.parse(origMetaBefore);
    expect(origMeta.retriedBy).toBeUndefined();
  });

  // Fix Wave 1, Finding 4 (IMPORTANT): the saved-context happy path was
  // previously untested — every fixture used a non-matching legacy string, so
  // parseInitialContext always returned null and hadSavedContext was false in
  // EVERY prior test. This exercises the REAL saveInitialContext framing and
  // proves the byte-identical relaunch: plan-level parse + end-to-end thread
  // into runFanout's retryContexts.
  test('Finding 4: saved-context happy path — properly-framed initial_context.md round-trips verbatim', async () => {
    const proj = project();
    writeWave(proj, 'w7', 'partial', ['w7-1'], ['qwen']);
    const legDir = writeLeg(proj, 'w7-1', { taskId: 'w7-1', model: 'qwen', status: 'error' });
    saveInitialContext(legDir, 'SYSTEM PROMPT TEXT', 'USER MESSAGE TEXT');

    // (a) buildRetryPlan parses the real framing: hadSavedContext:true + verbatim fields
    const plan = buildRetryPlan('w7', proj, {});
    expect(plan.eligible).toHaveLength(1);
    expect(plan.eligible[0].hadSavedContext).toBe(true);
    expect(plan.eligible[0].systemPrompt).toBe('SYSTEM PROMPT TEXT');
    expect(plan.eligible[0].userMessage).toBe('USER MESSAGE TEXT');

    // (b) retryFailedWave threads it through to runFanout's retryContexts
    // verbatim. wave:null keeps this focused on the captured call args — the
    // linkage-write path is already covered end-to-end by the first test.
    let captured = null;
    const fake = async (o) => { captured = o; return { wave: null, exitCode: 0 }; };
    await retryFailedWave('w7', proj, { runFanout: fake, quiet: true });

    expect(captured.retryContexts[0].hadSavedContext).toBe(true);
    expect(captured.retryContexts[0].systemPrompt).toBe('SYSTEM PROMPT TEXT');
    expect(captured.retryContexts[0].userMessage).toBe('USER MESSAGE TEXT');
  });
});
