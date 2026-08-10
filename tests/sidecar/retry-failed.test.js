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
function writeWave(proj, id, status, legIds, models, extra) {
  const dir = getSessionDir(proj, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify({ taskId: id, type: 'wave', status, legs: legIds, models, ...extra }));
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

// Task 8 (v4.7.1): --retry-failed inherits the ORIGINAL wave's tag. The
// mechanism it must travel through is options.tag -> stampLegAttribution
// (fanout-wave-io.js:84, called at fanout.js:126, BEFORE the new wave dir
// exists) -> leg.tag -> recordAttemptSpend's row.tag. A pre-seeded
// metadata.json implementation produces a correctly-tagged wave.json/
// metadata.json while every leg spend row stays tag:null — see "THE SPEND
// ROW" test below, which is the one that would catch that trap.
describe('Task 8: --retry-failed inherits the original wave tag', () => {
  const { stampLegAttribution } = require('../../src/sidecar/fanout-wave-io');
  const { recordAttemptSpend } = require('../../src/sidecar/fanout-leg-fallback');
  const { readSpendRows } = require('../../src/utils/spend-ledger');
  const { writeWaveMetadata } = require('../../src/sidecar/fanout');

  test('buildRetryPlan surfaces the original wave tag', () => {
    const proj = project();
    writeWave(proj, 't1', 'partial', ['t1-1'], ['gpt'], { tag: 'demo' });
    writeLeg(proj, 't1-1', { taskId: 't1-1', model: 'gpt', status: 'error' }, 'c1');
    const plan = buildRetryPlan('t1', proj, {});
    expect(plan.tag).toBe('demo');
  });

  test('retryFailedWave forwards the inherited tag as options.tag (never args.tag)', async () => {
    const proj = project();
    writeWave(proj, 't2', 'partial', ['t2-1'], ['gpt'], { tag: 'demo' });
    writeLeg(proj, 't2-1', { taskId: 't2-1', model: 'gpt', status: 'error' }, 'c1');
    let captured = null;
    const fake = async (o) => { captured = o; return { wave: null, exitCode: 0 }; };
    // Fix-wave: opts carries a DIFFERENT tag ('sneaky') so this actually pins
    // fanout-retry.js's `...opts` -then- explicit `...(plan.tag ? {tag} : {})`
    // ordering. Without a competing opts.tag, a misordered spread or an
    // `opts.tag` fallback would still land on 'demo' by coincidence and this
    // test would pass either way.
    await retryFailedWave('t2', proj, { runFanout: fake, quiet: true, tag: 'sneaky' });
    expect(captured.tag).toBe('demo');
  });

  // THE decisive test: simulates the real fanout.js mechanism end to end
  // (minus actual model execution — zero paid legs) via a fake runFanout that
  // performs the SAME two calls the real one does, in the SAME order:
  //   1. stampLegAttribution(legs, options) — reads ONLY options.tag, runs
  //      BEFORE any wave dir exists (fanout.js:126, before :144-146).
  //   2. writeWaveMetadata (real, read-merge-write) — so a pre-seeded tag on
  //      the new wave dir would survive this merge exactly like production.
  //   3. recordAttemptSpend per leg, via its deps.spendDir test seam, with a
  //      fabricated usage block (no network call, no real ledger touched).
  // A pre-seed-metadata implementation leaves options.tag undefined, so step
  // 1 never stamps leg.tag, so step 3's rows stay tag:null even though step
  // 2's wave metadata carries the pre-seeded tag — exactly the trap.
  test('THE SPEND ROW carries the tag — not just the wave doc', async () => {
    const proj = project();
    writeWave(proj, 't3', 'partial', ['t3-1'], ['gpt'], { tag: 'demo' });
    writeLeg(proj, 't3-1', { taskId: 't3-1', model: 'gpt', status: 'error' }, 'c1');
    const spendDir = fs.mkdtempSync(path.join(os.tmpdir(), 'retry-spend-'));

    const fakeRunFanout = async (o) => {
      const modelList = o.models.split(',');
      const legs = modelList.map(model => ({ ok: true, model }));
      stampLegAttribution(legs, o); // mirrors fanout.js:126 exactly
      const legIds = deriveLegIds(o.waveId, modelList.length);
      const wDir = getSessionDir(proj, o.waveId);
      fs.mkdirSync(wDir, { recursive: true, mode: 0o700 });
      const merged = writeWaveMetadata(wDir, { // mirrors fanout.js:146-154 (read-merge-write)
        taskId: o.waveId, type: 'wave', status: 'complete', legs: legIds,
        ...(o.tag ? { tag: o.tag } : {}),
      });
      const legDocs = legIds.map((legId, i) => {
        const lDir = getSessionDir(proj, legId);
        fs.mkdirSync(lDir, { recursive: true });
        fs.writeFileSync(path.join(lDir, 'metadata.json'),
          JSON.stringify({ taskId: legId, model: legs[i].model, status: 'complete' }));
        const usage = { tokens: { input: 1, output: 1, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
          cost: { amount: 0, currency: 'USD', source: 'reported' } };
        // mirrors fanout-leg.js:210 exactly, routed to a scratch ledger dir
        recordAttemptSpend({ doc: { status: 'complete', usage }, leg: legs[i], currentModel: legs[i].model,
          legId, waveId: o.waveId, project: proj, attempt: 0, originalModel: legs[i].model }, { spendDir });
        return { taskId: legId, model: legs[i].model, status: 'complete', usage };
      });
      return { wave: { type: 'wave', waveId: o.waveId, status: 'complete', tag: merged.tag, legs: legDocs }, exitCode: 0 };
    };

    await retryFailedWave('t3', proj, { runFanout: fakeRunFanout, quiet: true });

    const rows = readSpendRows(spendDir);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every(r => r.tag === 'demo')).toBe(true);
  });

  test("the retry wave's own metadata carries the tag, so retry-of-a-retry inherits", async () => {
    const proj = project();
    writeWave(proj, 't4', 'partial', ['t4-1'], ['gpt'], { tag: 'demo' });
    writeLeg(proj, 't4-1', { taskId: 't4-1', model: 'gpt', status: 'error' }, 'c1');
    let newWaveId;
    // Uses the REAL writeWaveMetadata (read-merge-write), exactly like
    // fanout.js:146-154, rather than a raw overwrite — a raw overwrite would
    // erase a pre-seeded field instead of merging over it, understating what
    // a pre-seed trap implementation would actually leave behind on disk.
    const fake = async (o) => {
      newWaveId = o.waveId;
      const legIds = deriveLegIds(o.waveId, 1);
      const wDir = getSessionDir(proj, o.waveId);
      fs.mkdirSync(wDir, { recursive: true, mode: 0o700 });
      writeWaveMetadata(wDir, { taskId: o.waveId, type: 'wave', status: 'complete', legs: legIds, ...(o.tag ? { tag: o.tag } : {}) });
      fs.mkdirSync(getSessionDir(proj, legIds[0]), { recursive: true });
      fs.writeFileSync(path.join(getSessionDir(proj, legIds[0]), 'metadata.json'),
        JSON.stringify({ taskId: legIds[0], model: 'gpt', status: 'complete' }));
      return { wave: { type: 'wave', waveId: o.waveId, status: 'complete',
        legs: [{ taskId: legIds[0], model: 'gpt', status: 'complete' }] }, exitCode: 0 };
    };
    await retryFailedWave('t4', proj, { runFanout: fake, quiet: true });
    const newMeta = JSON.parse(fs.readFileSync(path.join(getSessionDir(proj, newWaveId), 'metadata.json'), 'utf-8'));
    expect(newMeta.tag).toBe('demo');
  });

  test('an untagged original produces no tag anywhere', async () => {
    const proj = project();
    writeWave(proj, 't5', 'partial', ['t5-1'], ['gpt']); // no tag
    writeLeg(proj, 't5-1', { taskId: 't5-1', model: 'gpt', status: 'error' }, 'c1');
    let newWaveId;
    let captured = null;
    const fake = async (o) => {
      captured = o;
      newWaveId = o.waveId;
      const legIds = deriveLegIds(o.waveId, 1);
      const wDir = getSessionDir(proj, o.waveId);
      fs.mkdirSync(wDir, { recursive: true, mode: 0o700 });
      writeWaveMetadata(wDir, { taskId: o.waveId, type: 'wave', status: 'complete', legs: legIds, ...(o.tag ? { tag: o.tag } : {}) });
      fs.mkdirSync(getSessionDir(proj, legIds[0]), { recursive: true });
      fs.writeFileSync(path.join(getSessionDir(proj, legIds[0]), 'metadata.json'),
        JSON.stringify({ taskId: legIds[0], model: 'gpt', status: 'complete' }));
      return { wave: { type: 'wave', waveId: o.waveId, status: 'complete',
        legs: [{ taskId: legIds[0], model: 'gpt', status: 'complete' }] }, exitCode: 0 };
    };
    await retryFailedWave('t5', proj, { runFanout: fake, quiet: true });
    // Fix-wave: assert directly on the CAPTURED fanout options, not just the
    // fake's derived metadata — the fake writes tag via
    // `...(o.tag ? { tag: o.tag } : {})`, which would launder a
    // `tag: plan.tag || null` regression in fanout-retry.js (o.tag === null
    // is falsy, so the fake still omits the key) and this test would still
    // pass on newMeta alone.
    expect(captured).not.toHaveProperty('tag');
    const newMeta = JSON.parse(fs.readFileSync(path.join(getSessionDir(proj, newWaveId), 'metadata.json'), 'utf-8'));
    expect(newMeta.tag).toBeUndefined();
    expect(newMeta).not.toHaveProperty('tag');
  });

  test('the zero-eligible no-op doc still carries the tag (--json)', async () => {
    const proj = project();
    writeWave(proj, 't6', 'complete', ['t6-1'], ['gpt'], { tag: 'demo' });
    writeLeg(proj, 't6-1', { taskId: 't6-1', model: 'gpt', status: 'complete' });

    const out = [];
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation((s) => { out.push(s); return true; });
    try {
      await retryFailedWave('t6', proj, { json: true });
    } finally {
      spy.mockRestore();
    }
    const doc = JSON.parse(out.join(''));
    expect(doc.tag).toBe('demo');
  });
});
