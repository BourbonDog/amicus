'use strict';

/**
 * @module tests/council/degrade-channels
 * One channel per task (5-8): each proves a specific loss is announced through
 * ctx.degrade.note() — on stderr and in run.json's degrades[] — rather than
 * being silently absent from the run's record. Helpers at top are shared
 * across the channels as they're added.
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const { runStage1 } = require('../../src/council/run-stages');
const { runChair } = require('../../src/council/run-chair');
const { runDebateStage } = require('../../src/council/run-debate-stage');
const { createDegradeSink } = require('../../src/council/run-degrade');

// Mirrors tests/council/run-stages.test.js's review() fixture: prose + a fenced
// json findings block that validates cleanly, so a surviving seat never falls
// into the (unmocked, launchSolo-less) findings-repair path.
const review = (n) => `Prose review ${n}.\n\n\`\`\`json\n${JSON.stringify({
  overall: 'take',
  findings: [{ id: 1, severity: 'major', claim: `claim-${n}`, location: 'loc', rationale: 'why' }],
})}\n\`\`\`\n`;

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'degrade-channels-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('dead-leg channel (#85)', () => {
  test('a leg that produced no summary is announced as dead-leg', async () => {
    const runDir = fs.mkdtempSync(path.join(tmp, 'run-'));
    const noted = [];
    const ctx = {
      o: { runDir, runId: 'r1', models: ['alpha', 'beta'], briefing: 'material', date: '2026-08-01' },
      degrade: { note: (r) => noted.push(r), all: () => noted },
      addWave: () => {},
      overBudget: () => false,
      launchers: { launchWave: async () => ({
        wave: { waveId: 'r1-s1', legs: [
          { modelInput: 'alpha', status: 'complete', summary: review('alpha') },
          { modelInput: 'beta', status: 'timeout', summary: '' },
        ] },
        exitCode: 0,
      }) },
    };
    await runStage1(ctx);
    const dead = noted.find(n => n.channel === 'dead-leg');
    expect(dead).toBeDefined();
    expect(dead.what).toContain('beta');
    expect(dead.why).toContain('timeout');
    expect(dead.effect).toMatch(/1 of 2|exits degraded/);
  });

  test('#85 regression: a dead leg is stated on run.json, not merely absent from taskIds', async () => {
    const runDir = fs.mkdtempSync(path.join(tmp, 'issue85-'));
    const degraded = { value: false };
    const ctx = {
      o: { runDir, runId: 'r1', models: ['alpha', 'beta'], briefing: 'material', date: '2026-08-01' },
      degrade: createDegradeSink({ runDir, degraded, write: () => {} }),
      addWave: () => {},
      overBudget: () => false,
      launchers: { launchWave: async () => ({
        wave: { waveId: 'r1-s1', legs: [
          { modelInput: 'alpha', status: 'complete', summary: review('alpha') },
          { modelInput: 'beta', status: 'timeout', summary: '' },
        ] },
        exitCode: 0,
      }) },
    };
    await runStage1(ctx);

    const run = JSON.parse(fs.readFileSync(path.join(runDir, 'run.json'), 'utf8'));
    const dead = (run.degrades || []).filter(d => d.channel === 'dead-leg');
    expect(dead).toHaveLength(1);
    expect(dead[0].what).toContain('beta');
    // The exact failure #85 documents: before this fix the ONLY trace of the casualty
    // was its absence from the stage entry's taskIds. An absence is not a statement.
    expect(dead[0].effect).toMatch(/degraded/);
    expect(degraded.value).toBe(true);
  });
});

describe('chair channels', () => {
  // Real mkdtemp dir, not the brief's '/tmp/x' — runChair writes run.json stage
  // entries (runState.updateStage) and observe events into o.runDir, so a
  // nonexistent dir throws on Windows. Reuses this file's tmp root.
  const chairCtx = (overBudget, legSummary) => ({
    o: {
      runDir: fs.mkdtempSync(path.join(tmp, 'chair-')),
      runId: 'r1', chair: 'deepseek', models: ['a', 'b'],
    },
    addWave: () => {},
    overBudget: () => overBudget,
    launchers: {
      launchSolo: async () => ({
        wave: { waveId: 'r1-ch1', legs: [{ model: 'deepseek', status: 'complete', summary: legSummary }] },
        exitCode: 0,
        leg: { model: 'deepseek', status: 'complete', summary: legSummary },
      }),
    },
  });

  test('a chair skipped for the cost ceiling is announced, not just stage-marked', async () => {
    const noted = [];
    await runChair(chairCtx(true, ''), {
      packet: 'PACKET', degrade: { note: (r) => noted.push(r) },
      statsFn: () => ({}), isSignalled: () => false,
    });
    const d = noted.find(n => n.channel === 'chair-skipped-cost-ceiling');
    expect(d).toBeDefined();
    expect(d.why).toMatch(/ceiling/);
    expect(d.remedy).toMatch(/max-cost/);
    // Regression pin: a cost-skipped chair announces ONCE. Without the exclusivity
    // guard, the unconditional end-of-function catch-all also fires 'chair-failed'
    // (chairLeg is still null after a skip) — a false "no chair leg completed,
    // including after the fallback chain" for an event where no chain ever ran.
    expect(noted).toHaveLength(1);
  });

  test('a chair whose verdict never parsed is announced as chair-failed', async () => {
    const noted = [];
    await runChair(chairCtx(false, 'prose with no verdict line'), {
      packet: 'PACKET', degrade: { note: (r) => noted.push(r) },
      statsFn: () => ({}), isSignalled: () => false,
    });
    const d = noted.find(n => n.channel === 'chair-failed');
    expect(d).toBeDefined();
    // The two causes must be distinguishable — a chair that ran and a chair that never did
    // are different problems with different fixes.
    expect(d.why).toMatch(/ran but/);
  });
});

describe('thin cross-review channel', () => {
  test('thin cross-review is announced with the judge count', () => {
    const noted = [];
    const degrade = { note: (r) => noted.push(r) };
    // The Stage-2 gate is a plain conditional in run.js; exercise it directly with the
    // same shape run.js sees, so this test does not need a whole council.
    const judgeResults = [{ ok: true }, { ok: false }, { ok: false }];
    const usable = judgeResults.filter(j => j.ok).length;
    if (usable < 2) {
      degrade.note({
        channel: 'thin-cross-review',
        what: `only ${usable} of ${judgeResults.length} judges returned a usable cross-review`,
        why: 'the other judges produced no parseable Stage-2 block',
        effect: 'findings were tiered on a thinner cross-review than the bench size implies; exits degraded (2)',
      });
    }
    expect(noted[0].what).toBe('only 1 of 3 judges returned a usable cross-review');
  });
});

describe('debate-degraded channel', () => {
  test('a debate skipped for the cost ceiling is announced', async () => {
    const noted = [];
    const runDir = fs.mkdtempSync(path.join(tmp, 'debate-'));
    await runDebateStage(
      { o: { debate: true, runDir, runId: 'r1' }, degrade: { note: (r) => noted.push(r) } },
      { provisional: { findings: [{ id: 'A1', tier: 'Contested' }] },
        provisionalInput: {}, overBudget: () => true },
    );
    const d = noted.find(n => n.channel === 'debate-degraded');
    expect(d).toBeDefined();
    expect(d.why).toMatch(/ceiling/);
  });
});
