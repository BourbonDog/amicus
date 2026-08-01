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
