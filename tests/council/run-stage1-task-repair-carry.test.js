// tests/council/run-stage1-task-repair-carry.test.js
'use strict';

// PR #200 round-2 finding A1 (REFUTED BY MEASUREMENT — these are the pins that
// hold the refutation in place). The finding read the task repair prompt
// ("Re-emit ONLY the corrected findings JSON block") and concluded the seat's
// deliverable is DISCARDED, so a repaired task seat reaches Stage 2 without
// having produced the requested work. The engine never substitutes it:
// run-stages.js:258 pushes `text: m.text` — the seat's OWN Stage-1 output —
// and only `res.findings` comes from the repair leg. The on-disk
// review-<seat>.md was written by materializeReviews (run-launch.js:218)
// BEFORE the repair loop runs, from that same original text, and no repair leg
// is ever handed to materializeReviews. Stage 2 zips its bundle off `r.text`
// (run-stage2.js:112), so the judges read the deliverable, not the JSON.
//
// TWO named mutants, because the deliverable reaches Stage 2 down two
// independent paths and no single mutant reaches both. Both measured 2026-08-25
// over the same bench (--maxWorkers=2: this suite + run-stages +
// run-stage1-task-dispatch + run-happy = 132 tests), both reverted byte-exact
// (sha256 c6ece472…).
//
// "REPAIRTEXTSWAP" — the IN-MEMORY path. In run-stages.js:258 push the repair's
// output instead of the seat's prose (`text: repairing,` — literally the state
// A1 asserts). 6 RED: THIS file 3 — "the repaired seat's review body is still
// the DELIVERABLE", "Stage 2 judges the DELIVERABLE…", and the review control;
// run-stages.test.js 3 (the pre-existing LC-11 prose pins). The on-disk pin
// stayed GREEN, correctly: materializeReviews runs BEFORE the repair loop, so
// this mutant cannot touch the file — which is why the second mutant exists.
//
// "MATERIALIZEREPAIR" — the ON-DISK path. After `conformance = 'repaired'`,
// re-write `review-<alias>.md` with the repair's output. 2 RED, BOTH in this
// file — "the on-disk review-<seat>.md is still the DELIVERABLE" and the review
// control. Nothing in run-stages/run-happy/run-stage1-task-dispatch caught it:
// the artifact half of A1 had no pin before this file.
//
// The second half of the finding ("initially empty seats can enter Stage 2")
// is refuted structurally by materializeReviews' empty-summary guard
// (run-launch.js:213) — pinned in the last describe.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { runStage1, runStage2 } = require('../../src/council/run-stages');
const { assignLabels, toGlobalFindings } = require('../../src/council/anonymize');
const { buildSeats } = require('../../src/council/seats');

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'council-task-repair-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

// Three markers, each reachable from exactly one artifact, so no assertion below
// can pass for the wrong reason:
//   DELIVERABLE-PROSE — the task work, present ONLY in the seat's own Stage-1 output
//   REPAIR-ONLY-OVERALL — present ONLY in the repair leg's raw text (`overall` is
//     dropped by validateFindings, so it can reach an artifact only as raw text)
//   REPAIRED-CLAIM — present only in the repair leg's FINDINGS, which the engine
//     does adopt, so it proves the repair actually landed rather than being ignored
const DELIVERABLE = 'DELIVERABLE-PROSE: SMB churn rises 4.1pp at a 12% increase.\n\n'
  + '```json\n' + JSON.stringify({
    overall: 'the answer',
    findings: [{ id: 1, severity: 'high', claim: 'original-claim', location: 'loc', rationale: 'why' }],
  }) + '\n```\n';
// What a repair turn actually returns under both contracts: a bare fenced block,
// no prose (briefings.js:150-152 / briefings-task.js:136-138 keep the two-part
// framing OUT of the repair prompt by design).
const REPAIR_JSON_ONLY = '```json\n' + JSON.stringify({
  overall: 'REPAIR-ONLY-OVERALL',
  findings: [{ id: 1, severity: 'major', claim: 'REPAIRED-CLAIM', location: 'loc', rationale: 'why' }],
}) + '\n```\n';
const clean = (n) => `Prose ${n}.\n\n\`\`\`json\n${JSON.stringify({
  overall: 'take',
  findings: [{ id: 1, severity: 'major', claim: `claim-${n}`, location: 'loc', rationale: 'why' }],
})}\n\`\`\`\n`;
const judgeOut = (ranking, adjudications) =>
  `Judged.\n\n\`\`\`json\n${JSON.stringify({ ranking, adjudications })}\n\`\`\`\n`;

let legSeq = 0;
const mkLeg = (model, summary, status = 'complete', waveId, slot) => ({
  taskId: waveId != null ? `${waveId}-${slot}` : `${model}-${++legSeq}`,
  model, modelInput: model, status, summary,
  durationMs: 1000, usage: { cost: { amount: 0.01, source: 'reported' } },
  ...(waveId != null ? { waveId } : {}),
});
const okWave = (legs, waveId) =>
  ({ wave: { status: 'complete', ...(waveId ? { waveId } : {}), legs }, exitCode: 0 });

/**
 * ctx for the real runStage1/runStage2, shaped like run-stages.test.js :: makeCtx.
 * `intent` is the production channel (W5): 'task' or ABSENT.
 */
function makeCtx({ intent, onWave, onSolo, models = ['gemini', 'gpt'] }) {
  const runDir = path.join(tmp, 'council-abc123');
  fs.mkdirSync(runDir, { recursive: true });
  const notes = [];
  const seats = buildSeats(models, null, null);
  return {
    o: { briefing: 'Size the SMB churn risk of a 12% price increase.',
      models, chair: 'deepseek', critic: null, lenses: null,
      runId: 'abc123', runDir, timeout: 10, gateway: 'auto', noValidateModel: false,
      date: '2026-07-19', seats, criticSeat: null, ...(intent ? { intent } : {}) },
    launchers: {
      launchWave: async (opts) => onWave(opts),
      launchSolo: async (opts) => {
        const r = await onSolo(opts);
        return { ...r, leg: (r.wave && r.wave.legs && r.wave.legs[0]) || null };
      },
    },
    addWave: () => {}, overBudget: () => false,
    degrade: { note: (n) => notes.push(n) },
    scratchDir: path.join(runDir, '_scratch'),
    _notes: notes,
  };
}

/** gemini emits the deliverable with an invalid severity; -p1 repairs it JSON-only. */
function driveRepairedSeat(intent) {
  const solos = [];
  const ctx = makeCtx({
    intent,
    onWave: (opts) => okWave([
      mkLeg('gemini', DELIVERABLE, 'complete', opts.waveId, 1),
      mkLeg('gpt', clean('gpt'), 'complete', opts.waveId, 2),
    ], opts.waveId),
    onSolo: (opts) => {
      solos.push(opts);
      return okWave([mkLeg(opts.model, REPAIR_JSON_ONLY, 'complete', opts.waveId, 1)], opts.waveId);
    },
  });
  return { ctx, solos };
}

describe('A1 refuted: a task repair swaps the JSON, never the deliverable', () => {
  test("the repaired seat's review body is still the DELIVERABLE, with the repair's findings", async () => {
    const { ctx, solos } = driveRepairedSeat('task');
    const r = await runStage1(ctx);
    // The repair really ran, and really landed.
    expect(solos.map(s => s.waveId)).toEqual(['abc123-p1']);
    const gemini = r.reviews.find(x => x.modelInput === 'gemini');
    expect(gemini.conformance).toBe('repaired');
    expect(gemini.findings).toHaveLength(1);
    expect(gemini.findings[0].claim).toBe('REPAIRED-CLAIM');   // JSON came from the repair
    // …and the work the briefing asked for is untouched, byte for byte.
    expect(gemini.text).toBe(DELIVERABLE);
    expect(gemini.text).toContain('DELIVERABLE-PROSE');
    expect(gemini.text).not.toContain('REPAIR-ONLY-OVERALL');
  });

  test('the on-disk review-<seat>.md is still the DELIVERABLE', async () => {
    const { ctx } = driveRepairedSeat('task');
    await runStage1(ctx);
    const onDisk = fs.readFileSync(path.join(ctx.o.runDir, 'review-gemini.md'), 'utf-8');
    expect(onDisk).toBe(DELIVERABLE);
    expect(onDisk).not.toContain('REPAIR-ONLY-OVERALL');
  });

  test("Stage 2 judges the DELIVERABLE, never the repair's JSON-only output", async () => {
    const { ctx } = driveRepairedSeat('task');
    const r = await runStage1(ctx);
    const labels = assignLabels(r.reviews.map(x => x.modelInput));
    const globalFindings = r.reviews.flatMap((x, i) =>
      toGlobalFindings(labels.entries[i].label, x.modelInput, x.findings));
    let s2Prompt = null;
    ctx.launchers.launchWave = async (opts) => {
      s2Prompt = opts.prompt;
      return okWave([
        mkLeg('gemini', judgeOut(['Review B', 'Review A'],
          [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'agree' }]), 'complete', opts.waveId, 1),
        mkLeg('gpt', judgeOut(['Review A', 'Review B'],
          [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'agree' }]), 'complete', opts.waveId, 2),
      ], opts.waveId);
    };
    await runStage2(ctx, { reviews: r.reviews, labels, globalFindings });
    // The judges read the deliverable…
    expect(s2Prompt).toContain('DELIVERABLE-PROSE');
    // …and the repair's raw text reached no judge. `overall` is dropped by
    // validateFindings, so this marker can only arrive as substituted body text.
    expect(s2Prompt).not.toContain('REPAIR-ONLY-OVERALL');
    // The adopted findings DID travel — the bundle is not simply stale.
    expect(s2Prompt).toContain('REPAIRED-CLAIM');
    expect(fs.readFileSync(path.join(ctx.o.runDir, 'bundle-stage2.md'), 'utf-8')).toBe(s2Prompt);
  });

  test('review control: the same carry, byte-identical, with intent absent', async () => {
    const { ctx, solos } = driveRepairedSeat(null);
    const r = await runStage1(ctx);
    expect(solos.map(s => s.waveId)).toEqual(['abc123-p1']);
    const gemini = r.reviews.find(x => x.modelInput === 'gemini');
    expect(gemini.conformance).toBe('repaired');
    expect(gemini.findings[0].claim).toBe('REPAIRED-CLAIM');
    expect(gemini.text).toBe(DELIVERABLE);
    expect(fs.readFileSync(path.join(ctx.o.runDir, 'review-gemini.md'), 'utf-8')).toBe(DELIVERABLE);
  });
});

describe('A1 second half refuted: an EMPTY task seat never reaches the repair loop', () => {
  // materializeReviews skips a leg with no usable summary (run-launch.js:213),
  // so an empty seat is a LOSS on the degrade path — it never becomes a
  // `materialized` entry, never buys a -p<N> repair, and can never enter Stage 2
  // "without having produced the requested work", because it never enters at all.
  test('no review, no repair solo, no review-<seat>.md — the seat is announced as lost', async () => {
    const solos = [];
    const ctx = makeCtx({
      intent: 'task',
      onWave: (opts) => okWave(opts.waveId.includes('-s1')
        ? [mkLeg('gemini', '', 'complete', opts.waveId, 1), mkLeg('gpt', clean('gpt'), 'complete', opts.waveId, 2)]
        // The SL-2 retry re-launch: the seat is still empty the second time.
        : [mkLeg('gemini', '', 'complete', opts.waveId, 1)], opts.waveId),
      onSolo: (opts) => { solos.push(opts); return okWave([mkLeg(opts.model, '', 'complete', opts.waveId, 1)], opts.waveId); },
    });
    const r = await runStage1(ctx);
    expect(r.reviews.map(x => x.modelInput)).toEqual(['gpt']);
    expect(solos.filter(s => /-p\d+$/.test(s.waveId))).toEqual([]);
    expect(fs.existsSync(path.join(ctx.o.runDir, 'review-gemini.md'))).toBe(false);
    expect(ctx._notes.length).toBeGreaterThan(0);
  });
});
