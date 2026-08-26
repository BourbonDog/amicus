// tests/council/run-debate-task-dispatch.test.js
'use strict';

// v4.9 W7 T-C (ruling V2) — end-to-end debate dispatch pins. Stage 2.5 has
// exactly TWO prompt-composition sites, and both fork on `o.intent`
// ('task' | absent): the per-raiser defense solo (run-debate.js ::
// runDefenseSolo) and the ONE shared re-vote bundle (run-debate-revote.js ::
// runRevoteWave, which also persists it as revote-bundle.md). A review run
// stays byte-identical at both. Drives the REAL runDebate with stubbed
// launchers — house style from run-debate.test.js, minus the seat-binding
// fixtures this file does not need (a unique gemini/gpt/qwen bench).
//
// ── NAMED MUTANT "TASKDEBATEDROP" ──────────────────────────────────────────
// MUTATION: in src/council/briefings-debate.js :: buildDefenseBrief, push
// `DEFENSE_FRAME` unconditionally — i.e. the builder ignores `intent` and every
// task raiser is asked to defend "findings you raised about an artifact" when
// what it declared was a load-bearing claim under its own answer.
// MEASURED 2026-08-25, RED SET 4 of 191, in 2 suites — first at sha 691e1967
// (W7 T-C), then RE-MEASURED unchanged at 96e009bb with the W7 fix round in the
// working tree, applied and reverted by hand both times (the second revert
// checksum-verified). Scope — the 9 debate suites,
// `npx jest tests/council/{briefings-debate,debate,parse-debate,report-debate,
// run-debate-addendum-guard,run-debate-stage,run-debate-task-dispatch,
// run-debate,run-schema-debate}.test.js --maxWorkers=2` = 191 tests:
//   briefings-debate 3 —
//     "TASK defense brief swaps ONLY the frame — same preamble, date, block, contract"
//     "the frames are disjoint in BOTH directions, on both builders"
//     "a dateless brief still forks on intent (the date line is optional, the frame is not)"
//   run-debate-task-dispatch 1 — "task run: the defense solo composes the TASK frame"
// ⚠️ Every re-vote pin and every review-byte-identity pin stays GREEN — which is
// the point of pinning the two dispatch sites separately: this mutant is scoped
// to ONE of them, and the red set says so rather than smearing across both.
// ⚠️ RE-RUN, NEVER RENUMBER (house rule, tests/council/chair-packet-seat-mutants.js).

const path = require('path');
const os = require('os');
const fs = require('fs');
const { runDebate } = require('../../src/council/run-debate');
const { tally } = require('../../src/council/tally');
const { buildSeats } = require('../../src/council/seats');

const DATE = '2026-07-19';
// Literals, not imports (same rule as briefings-debate.test.js): a pin that
// reads the constant it is pinning cannot notice that constant changing.
const REVIEW_DEFENSE_OPENER = 'You reviewed an artifact and raised the findings below.';
const TASK_DEFENSE_OPENER = 'You produced an answer and declared the claims below as load-bearing.';
const REVIEW_REVOTE_OPENER = 'You previously adjudicated findings on this artifact';
const TASK_REVOTE_OPENER = 'You previously adjudicated claims from this bench\'s answers';

// A1 is raised by gemini and disputed by gpt + qwen → Disputed, so the defense
// solo launches; the scripted defense DEFENDS it, so the re-vote wave launches
// too (both dispatch sites reached in one drive).
function provisionalInput() {
  return {
    meta: { runId: 'r', models: ['gemini', 'gpt', 'qwen'], chair: 'deepseek',
      claudeInCouncil: false, date: DATE },
    findings: [
      { id: 'A1', raiser: 'gemini', severity: 'major', claim: 'infinite retry' },
      { id: 'B1', raiser: 'gpt', severity: 'nit', claim: 'typo' },
    ],
    adjudications: [
      { findingId: 'A1', judge: 'gpt', verdict: 'dispute' },
      { findingId: 'A1', judge: 'qwen', verdict: 'dispute' },
      { findingId: 'B1', judge: 'gemini', verdict: 'agree' },
      { findingId: 'B1', judge: 'qwen', verdict: 'agree' },
    ],
    rankings: [{ judge: 'gpt', order: ['gemini', 'qwen'] }, { judge: 'qwen', order: ['gemini', 'gpt'] }],
    runStats: [],
  };
}

const leg = (model, summary) => ({ model, modelInput: model, status: 'complete', summary });
const wave = (legs) => ({ status: 'complete', legs });
const defenseOut = (r) => `Defending.\n\`\`\`json\n${JSON.stringify({ responses: r })}\n\`\`\`\n`;
const revoteOut = (r) => `Re-voting.\n\`\`\`json\n${JSON.stringify({ revotes: r })}\n\`\`\`\n`;

const tmps = [];
function mkTmp() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'run-debate-task-'));
  fs.mkdirSync(path.join(tmp, '_scratch'), { recursive: true });
  tmps.push(tmp);
  return tmp;
}
afterAll(() => { for (const t of tmps) { fs.rmSync(t, { recursive: true, force: true }); } });

/** Drive the real runDebate; `intent` is threaded onto o exactly as run.js does. */
async function driveDebate(intent) {
  const tmp = mkTmp();
  const models = ['gemini', 'gpt', 'qwen'];
  const calls = [];
  const launchers = {
    launchSolo: async (opts) => {
      calls.push(opts);
      const l = leg('gemini', defenseOut([{ id: 'A1', action: 'defend', argument: 'caps at 5' }]));
      return { wave: wave([l]), leg: l, exitCode: 0 };
    },
    launchWave: async (opts) => {
      calls.push(opts);
      return { exitCode: 0, wave: wave([
        leg('gpt', revoteOut([{ id: 'A1', verdict: 'agree' }])),
        leg('qwen', revoteOut([{ id: 'A1', verdict: 'dispute' }]))]) };
    },
  };
  const ctx = {
    o: { runId: 'r', runDir: tmp, timeout: 10, gateway: 'auto', date: DATE, maxCost: null,
      noCostGate: false, councilName: 'nightly-council', tag: 'sprint42',
      models, critic: null, lenses: null, seats: buildSeats(models, null, null), criticSeat: null,
      // run.js:123 rejects any intent that is neither 'task' nor undefined, so
      // those are the only two shapes a real ctx can carry here.
      ...(intent ? { intent } : {}) },
    launchers, addWave: () => {}, overBudget: () => false, scratchDir: path.join(tmp, '_scratch'),
    degrade: { note: () => {}, all: () => [] },
  };
  const input = provisionalInput();
  const result = await runDebate(ctx, { provisionalRecord: tally(input), tallyInput: input });
  return { tmp, result, defense: calls.find(c => c.waveId === 'r-d1'),
    revote: calls.find(c => c.waveId === 'r-rv') };
}

describe('runDebate threads o.intent into both Stage-2.5 dispatch sites', () => {
  let task, review;
  beforeAll(async () => { task = await driveDebate('task'); review = await driveDebate(null); });

  test('task run: the defense solo composes the TASK frame', () => {
    expect(task.defense.prompt).toContain(TASK_DEFENSE_OPENER);
    expect(task.defense.prompt).not.toContain(REVIEW_DEFENSE_OPENER);
  });

  test('task run: the re-vote bundle composes the TASK frame, and revote-bundle.md IS it', () => {
    expect(task.revote.prompt).toContain(TASK_REVOTE_OPENER);
    expect(task.revote.prompt).not.toContain(REVIEW_REVOTE_OPENER);
    expect(fs.readFileSync(path.join(task.tmp, 'revote-bundle.md'), 'utf-8'))
      .toBe(task.revote.prompt);
  });

  test('review run (intent absent): both sites compose the REVIEW frames', () => {
    expect(review.defense.prompt).toContain(REVIEW_DEFENSE_OPENER);
    expect(review.defense.prompt).not.toContain(TASK_DEFENSE_OPENER);
    expect(review.revote.prompt).toContain(REVIEW_REVOTE_OPENER);
    expect(review.revote.prompt).not.toContain(TASK_REVOTE_OPENER);
  });

  // The parsers are frame-neutral (parse-stage2.js is untouched by W7 T-C): the
  // task-framed round parses, applies and tallies exactly like the review one.
  test('the task round parses and applies identically — the parsers are frame-neutral', () => {
    for (const r of [task.result, review.result]) {
      expect(r.debateSummary.outcome).toBe('ran');
      expect(r.debateSummary.defended).toBe(1);
      expect(r.debateSummary.revoteJudges).toBe(2);
      expect(r.degraded).toBe(false);
      expect(r.aborted).toBeNull();
    }
    const a = tally(task.result.debatedInput).findings.find(f => f.id === 'A1');
    const b = tally(review.result.debatedInput).findings.find(f => f.id === 'A1');
    expect(a.basis).toEqual(b.basis);
    expect(a.tier).toBe(b.tier);
  });
});
