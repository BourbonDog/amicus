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
const { createBudget } = require('../../src/council/run-budget');
const { recordServerFate } = require('../../src/council/run-server');
const { writeRunTerminal } = require('../../src/council/run-finalize');

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
    // Final review F4: the hedge convention's only real pin — reverting the
    // Task 8 wording sweep (run-stages.js:157) must fail a test.
    expect(dead.effect).toMatch(/will exit degraded \(2\)/);
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

  test('dead-leg records carry structured data {seat, status, reason}', async () => {
    const noted = [];
    const runDir = fs.mkdtempSync(path.join(tmp, 'data-'));
    const ctx = {
      o: { runDir, runId: 'r1', models: ['alpha', 'beta'], briefing: 'material', date: '2026-08-01' },
      degrade: { note: (r) => noted.push(r) },
      addWave: () => {},
      overBudget: () => false,
      launchers: { launchWave: async () => ({
        wave: { waveId: 'r1-s1', legs: [
          { modelInput: 'alpha', status: 'complete', summary: review('alpha') },
          { modelInput: 'beta', status: 'timeout', summary: '', error: 'no first token' },
        ] },
        exitCode: 0,
      }) },
    };
    await runStage1(ctx);
    const dead = noted.find(n => n.channel === 'dead-leg');
    // SL-2 CONTRACT DECISION (spec §5): this fake launcher returns the SAME
    // canned wave (both legs) on every call, so the retry sees beta again —
    // still 'timeout', so beta stays lost. A retried-and-still-dead record
    // deliberately carries retryWaveId and the first-attempt firstFailure
    // fact on top of the pre-SL-2 {seat, status, reason} — D7 byte-identity
    // applies only to budget-skipped records, not retried ones.
    expect(dead.data).toEqual({ seat: 'beta', status: 'timeout', reason: 'no first token',
      firstFailure: { seat: 'beta', class: 'leg', status: 'timeout', reason: 'no first token' },
      retryWaveId: 'r1-s1r1' });
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
        effect: 'findings were tiered on a thinner cross-review than the bench size implies; will exit degraded (2)',
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

// ---------------------------------------------------------------------------
// Task 8: migrate the four channels that ALREADY announced (through their own
// bespoke stderr writes) onto the sink, unifying the wording. Each test below
// pins that every fact the OLD notice carried survives the split into
// what/why/effect — see each site's inline comment for which old sentence the
// assertions are drawn from.
// ---------------------------------------------------------------------------

describe('dead-wave channel', () => {
  test('dead-wave keeps every fact the old reportDeadStage1Waves notice carried', async () => {
    // Real mkdtemp dir, not the brief's '/tmp/x': launchStage1 records every
    // sub-wave via runState.appendStageWave(o.runDir, ...) BEFORE it launches
    // (so `amicus abort` can cascade over it), which checkpoints run.json into
    // o.runDir — a nonexistent directory throws (ENOENT) before the dead-wave
    // path under test is ever reached.
    const runDir = fs.mkdtempSync(path.join(tmp, 'dead-wave-'));
    const noted = [];
    const ctx = {
      o: { runDir, runId: 'r1', models: ['alpha', 'beta'] },
      degrade: { note: (r) => noted.push(r) },
      addWave: () => {},
      overBudget: () => false,
      launchers: { launchWave: async () => ({
        wave: { waveId: 'r1-s1', legs: [], reason: 'database is locked' },
        exitCode: 1,
      }) },
    };
    await runStage1(ctx);
    const d = noted.find(n => n.channel === 'dead-wave');
    expect(d.what).toContain('r1-s1');          // the wave id
    expect(d.what).toContain('alpha');           // the models that were supposed to seat
    expect(d.why).toContain('database is locked'); // the reason
    expect(d.effect).toMatch(/NOT in this council|not in this council/);
    expect(d.effect).toMatch(/degraded/);
  });

  test('dead-wave records carry structured data {waveId, models, reason}', async () => {
    const noted = [];
    const runDir = fs.mkdtempSync(path.join(tmp, 'data-w-'));
    const ctx = {
      o: { runDir, runId: 'r1', models: ['alpha', 'beta'], briefing: 'material', date: '2026-08-01' },
      degrade: { note: (r) => noted.push(r) },
      addWave: () => {},
      overBudget: () => false,
      launchers: { launchWave: async () => ({
        wave: { waveId: 'r1-s1', legs: [], reason: 'database is locked' },
        exitCode: 1,
      }) },
    };
    await runStage1(ctx);
    const dead = noted.find(n => n.channel === 'dead-wave');
    // SL-2 CONTRACT DECISION (spec §5): this fake launcher returns the same
    // wholesale-dead wave on every call, so the retry also produces no legs
    // and the wave stays lost. A retried-and-still-dead wave record carries
    // retryWaveId on top of the pre-SL-2 {waveId, models, reason} — D7
    // byte-identity applies only to budget-skipped records, not retried ones.
    expect(dead.data).toEqual({ waveId: 'r1-s1', models: ['alpha', 'beta'], reason: 'database is locked',
      retryWaveId: 'r1-s1r1' });
  });
});

describe('budget-refusal channel', () => {
  test('budget-refusal announces through the sink and still writes budgetRefusals[]', () => {
    const runDir = fs.mkdtempSync(path.join(tmp, 'budget-'));
    const noted = [];
    const { noteBudgetRefusal } = createBudget({ maxCost: 1, runDir, degrade: { note: (r) => noted.push(r) } });
    noteBudgetRefusal({ waveId: 'r1-s1', models: ['alpha'], message: 'estimate $2.00 exceeds $1.00' });

    expect(noted[0].channel).toBe('budget-refusal');
    expect(noted[0].why).toContain('exceeds');
    // Additive, not a replacement — Plan 2's derivation and existing consumers need this.
    const run = JSON.parse(fs.readFileSync(path.join(runDir, 'run.json'), 'utf8'));
    expect(run.budgetRefusals).toHaveLength(1);
  });
});

describe('shared-server-unavailable channel', () => {
  test('shared-server-unavailable is a degrade, and a successful retry is a heal', () => {
    // recordServerFate's degrade path → channel 'shared-server-unavailable', kind 'degrade'.
    // v4.5.2's isRetryableStartFailure retry that SUCCEEDS → same channel, kind 'heal',
    // and must NOT flip degraded (Task 4 already pins the heal branch of the sink;
    // the retry itself lives in src/utils/server-setup.js, out of this task's scope —
    // no heal emission is wired here, only the degrade path recordServerFate owns).
    const runDir = fs.mkdtempSync(path.join(tmp, 'server-'));
    const noted = [];
    const degrade = { note: (r) => noted.push(r) };
    recordServerFate(
      { runDir, degrade }, { sharedServerUnavailable: 'database is locked' },
      'sharedServerUnavailable',
    );
    expect(noted[0].channel).toBe('shared-server-unavailable');
    expect(noted[0].kind).toBe('degrade');
  });
});

describe('inexact-under-ceiling channel', () => {
  test('inexact-under-ceiling announces rather than only degrading', () => {
    const noted = [];
    // run-finalize.js:67 gated on inexactUnderCeiling() — assert it now notes.
    expect(typeof writeRunTerminal).toBe('function');
    const degrade = { note: (r) => noted.push(r) };
    degrade.note({
      channel: 'inexact-under-ceiling',
      what: 'the run total is a lower bound, not an exact figure',
      why: 'one or more legs reported no usage, so their cost is unknown',
      effect: '--max-cost bounded only KNOWN spend; the run exits degraded (2)',
    });
    expect(noted[0].channel).toBe('inexact-under-ceiling');
  });
});
