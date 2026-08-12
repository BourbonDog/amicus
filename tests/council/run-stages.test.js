// tests/council/run-stages.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
// Stage 2 was split into its own module for the 300-line gate (v4.4.1 Task 2) and
// is re-exported from run-stages, which is again the single import surface for the
// stage loops (review F5). Its tests stay here, next to Stage 1's — they share makeCtx.
const { runStage1, runStage2, slug } = require('../../src/council/run-stages');
const { assignLabels, toGlobalFindings } = require('../../src/council/anonymize');

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'council-stages-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const review = (n) => `Prose review ${n}.\n\n\`\`\`json\n${JSON.stringify({
  overall: 'take',
  findings: [{ id: 1, severity: 'major', claim: `claim-${n}`, location: 'loc', rationale: 'why' }],
})}\n\`\`\`\n`;
const judgeOut = (ranking, adjudications) =>
  `Judged.\n\n\`\`\`json\n${JSON.stringify({ ranking, adjudications })}\n\`\`\`\n`;
let legSeq = 0;
// v4.8 PR2a Task 1: mkLeg now takes an explicit (waveId, slot) pair — slot is
// the leg's 1-based index in the wave's LAUNCH ROSTER, never the index in the
// returned legs array (seats.js:93-96) — so callers can emit an engine-shaped
// taskId: `${waveId}-${slot}` plus a matching waveId field, the two things
// bindSeats (seats.js:130) needs to bind a leg to its seat. Both are optional
// and default to the pre-v4.8 fallback (a bare model-prefixed counter, no
// waveId field) so every call site that predates seat binding is unchanged.
const mkLeg = (model, summary, status = 'complete', waveId, slot) => ({
  taskId: waveId != null ? `${waveId}-${slot}` : `${model}-${++legSeq}`,
  model, modelInput: model, status, summary,
  durationMs: 1000, usage: { cost: { amount: 0.01, source: 'reported' } },
  ...(waveId != null ? { waveId } : {}),
});
const okWave = (legs) => ({ wave: { status: 'complete', legs }, exitCode: 0 });
// SL-2 Task 5: legs for the retry-seam tests. usableLeg materializes cleanly;
// deadLeg defaults to the exact status/error pair ('error'/'boom') the
// pre-existing dead-leg test already uses inline, so the enriched-why pins
// below read the same as the rest of this file. Mirrors the same-named
// helpers in tests/council/run-retry.test.js.
// v4.8 PR2a Task 1: both take the same trailing (waveId, slot) pair as mkLeg.
const usableLeg = (model, waveId, slot) => mkLeg(model, review(model), 'complete', waveId, slot);
const deadLeg = (model, status = 'error', error = 'boom', waveId, slot) =>
  ({ ...mkLeg(model, '', status, waveId, slot), error });

function makeCtx({ onWave, onSolo, models = ['gemini', 'gpt', 'qwen'], critic = null, lenses = null, overBudget = () => false, degrade } = {}) {
  const runDir = path.join(tmp, 'council-abc123');
  fs.mkdirSync(runDir, { recursive: true });
  const added = [];
  // v4.6 Plan 1 Task 5 / SL-2 Task 5: a stub default so every pre-existing test
  // in this file (most of which don't exercise the degrade sink) keeps driving
  // runStage1/2 without wiring one up — real coverage of the sink lives in
  // tests/council/degrade-channels.test.js. The default now COLLECTS into
  // `_notes` (the SL-2 retry-seam tests read notes back off the ctx directly);
  // additive — a test wanting a different sink still passes its own `degrade`
  // and reads that back instead.
  const notes = [];
  return {
    o: { briefing: 'material', models, chair: 'deepseek', critic, lenses,
      runId: 'abc123', runDir, timeout: 10, gateway: 'auto', noValidateModel: false, date: '2026-07-19',
      // v4.3 Task 3 (spec §7.2): non-null so every launch-site assertion below
      // can prove the id actually reached the launcher, not just a falsy default.
      // v4.7 F8 D16 (T7 review): tag joins it on the same idiom.
      councilName: 'nightly-council', tag: 'sprint42' },
    launchers: {
      // jest.fn()-wrapped (not a plain arrow) so the SL-2 tests can queue
      // per-call responses with `.mockResolvedValueOnce(...)` across the
      // first-launch + retry-launch sequence; falls back to the injected
      // onWave/onSolo callback once the queue is empty, so every pre-existing
      // test's plain-callback setup keeps working untouched.
      launchWave: jest.fn(async (opts) => onWave(opts)),
      launchSolo: jest.fn(async (opts) => {
        const r = await onSolo(opts);
        return { ...r, leg: (r.wave && r.wave.legs && r.wave.legs[0]) || null };
      }),
    },
    addWave: (w) => added.push(w),
    overBudget,
    degrade: degrade || { note: (n) => notes.push(n) },
    scratchDir: path.join(runDir, '_scratch'),
    _added: added,
    _notes: notes,
  };
}

describe('runStage1', () => {
  test('happy path: one wave for standard seats, reviews materialized + validated', async () => {
    const waves = [];
    const ctx = makeCtx({
      onWave: (opts) => { waves.push(opts); return okWave(opts.models.map(m => mkLeg(m, review(m)))); },
      onSolo: () => { throw new Error('no solos expected'); },
    });
    const { aborted, reviews, deadLegs } = await runStage1(ctx);
    expect(aborted).toBeNull();
    expect(waves).toHaveLength(1);
    expect(waves[0].waveId).toBe('abc123-s1');
    expect(waves[0].project).toBe(ctx.o.runDir);
    // v4.3 Task 3 (spec §7.2): the seat wave carries council attribution.
    expect(waves[0].councilRunId).toBe('abc123');
    expect(waves[0].councilName).toBe('nightly-council');
    // v4.7 F8 D16 (T7 review): tag rides the same forward — deleting
    // `tag: o.tag` from run-stage1-launch.js's `common` restores the silent
    // degrade this pins against.
    expect(waves[0].tag).toBe('sprint42');
    expect(reviews.map(r => r.model)).toEqual(['gemini', 'gpt', 'qwen']);
    expect(reviews.every(r => r.conformance === 'clean' && r.findings.length === 1)).toBe(true);
    expect(deadLegs).toHaveLength(0);
    expect(fs.existsSync(path.join(ctx.o.runDir, 'review-gemini.md'))).toBe(true);
  });

  test('critic seat launches as a concurrent solo with role critic', async () => {
    const solos = [];
    const ctx = makeCtx({
      critic: 'qwen',
      onWave: (opts) => okWave(opts.models.map(m => mkLeg(m, review(m)))),
      onSolo: (opts) => { solos.push(opts); return okWave([mkLeg(opts.model, review(opts.model))]); },
    });
    const { reviews } = await runStage1(ctx);
    expect(solos.map(s => s.waveId)).toEqual(['abc123-c1']);
    expect(solos[0].prompt).toContain('designated critic');
    expect(reviews.find(r => r.model === 'qwen').role).toBe('critic');
    expect(reviews.find(r => r.model === 'gemini').role).toBe('seat');
  });

  test('lenses: NO shared wave, one solo per seat, positional lens assignment', async () => {
    const solos = [];
    const ctx = makeCtx({
      lenses: ['growth-stage VC', 'security architect', 'skeptical buyer'],
      onWave: () => { throw new Error('no wave expected under lenses'); },
      onSolo: (opts) => { solos.push(opts); return okWave([mkLeg(opts.model, review(opts.model))]); },
    });
    const { reviews } = await runStage1(ctx);
    expect(solos.map(s => s.waveId)).toEqual(['abc123-l1', 'abc123-l2', 'abc123-l3']);
    expect(solos[0].prompt).toContain('growth-stage VC');
    expect(reviews.find(r => r.model === 'gpt').role).toBe(`lens:${slug('security architect')}`);
  });

  test('malformed findings → repair solo → conformance repaired', async () => {
    const solos = [];
    const ctx = makeCtx({
      onWave: (opts) => okWave(opts.models.map(m =>
        mkLeg(m, m === 'gpt' ? 'prose without json' : review(m)))),
      onSolo: (opts) => { solos.push(opts); return okWave([mkLeg('gpt', review('gpt'))]); },
    });
    const { reviews } = await runStage1(ctx);
    expect(solos).toHaveLength(1);
    expect(solos[0].model).toBe('gpt');
    expect(solos[0].waveId).toBe('abc123-p1');
    // v4.3 Task 3 (spec §7.2): the findings-repair solo carries council attribution too.
    expect(solos[0].councilRunId).toBe('abc123');
    expect(solos[0].councilName).toBe('nightly-council');
    // v4.7 F8 D16 (T7 review): tag rides the same forward.
    expect(solos[0].tag).toBe('sprint42');
    expect(reviews.find(r => r.model === 'gpt').conformance).toBe('repaired');
  });

  test('LC-6: the repair solo carries the review it is repairing', async () => {
    // The defect: the repair prompt shipped the validation ERRORS without the
    // REVIEW they were errors about, so three of five paid councils burned a
    // seat — two models refused ("I don't have a previous review to correct")
    // and one fabricated a finding to satisfy the schema.
    const solos = [];
    const badReview = 'Prose about the material, but no fenced block at all.';
    const ctx = makeCtx({
      onWave: (opts) => okWave(opts.models.map(m => mkLeg(m, m === 'gpt' ? badReview : review(m)))),
      onSolo: (opts) => { solos.push(opts); return okWave([mkLeg('gpt', review('gpt'))]); },
    });
    await runStage1(ctx);
    expect(solos).toHaveLength(1);
    expect(solos[0].prompt).toContain(badReview);
    expect(solos[0].prompt).toContain('YOUR PREVIOUS REVIEW');
  });

  test('LC-6: the SECOND repair carries the first repair output, which is what failed', async () => {
    // Errors and artifact must describe the same thing. On attempt 2 the errors
    // come from validating attempt 1's output, so attempt 1's output — not the
    // original review — is the text being repaired.
    const solos = [];
    const badReview = 'original prose, no json';
    const firstRepair = 'first repair attempt, still no json';
    const ctx = makeCtx({
      onWave: (opts) => okWave(opts.models.map(m => mkLeg(m, m === 'gpt' ? badReview : review(m)))),
      onSolo: (opts) => {
        solos.push(opts);
        return okWave([mkLeg('gpt', solos.length === 1 ? firstRepair : 'second repair, still no json')]);
      },
    });
    await runStage1(ctx);
    expect(solos).toHaveLength(2);
    expect(solos[0].prompt).toContain(badReview);
    expect(solos[1].prompt).toContain(firstRepair);
    expect(solos[1].prompt).not.toContain(badReview);
  });

  test('LC-6: a repair whose leg came back empty still names the text that failed', async () => {
    // A dead/empty repair leg validates as '' — there is no newer artifact, so
    // the next attempt must keep pointing at the last text we actually have
    // rather than opening an empty "previous review" block.
    const solos = [];
    const badReview = 'original prose, no json';
    const ctx = makeCtx({
      onWave: (opts) => okWave(opts.models.map(m => mkLeg(m, m === 'gpt' ? badReview : review(m)))),
      onSolo: (opts) => { solos.push(opts); return okWave([mkLeg('gpt', '')]); },
    });
    await runStage1(ctx);
    expect(solos).toHaveLength(2);
    expect(solos[1].prompt).toContain(badReview);
  });

  test('still malformed after 2 repairs → unstructured, findings [], review KEPT', async () => {
    let soloCount = 0;
    const ctx = makeCtx({
      onWave: (opts) => okWave(opts.models.map(m =>
        mkLeg(m, m === 'gpt' ? 'no json at all' : review(m)))),
      onSolo: () => { soloCount += 1; return okWave([mkLeg('gpt', 'still no json')]); },
    });
    const { reviews } = await runStage1(ctx);
    expect(soloCount).toBe(2);                       // cap = 2 re-prompts
    const gpt = reviews.find(r => r.model === 'gpt');
    expect(gpt.conformance).toBe('unstructured');
    expect(gpt.findings).toEqual([]);
    expect(reviews).toHaveLength(3);                 // never dropped for a formatting miss
  });

  test('cost ceiling blocks findings repair: no solo fires, review ends unstructured (KEPT)', async () => {
    let soloCalls = 0;
    const ctx = makeCtx({
      overBudget: () => true,
      onWave: (opts) => okWave(opts.models.map(m =>
        mkLeg(m, m === 'gpt' ? 'prose without json' : review(m)))),
      onSolo: () => { soloCalls += 1; throw new Error('no repair solos expected over budget'); },
    });
    const { reviews } = await runStage1(ctx);
    expect(soloCalls).toBe(0);
    const gpt = reviews.find(r => r.model === 'gpt');
    expect(gpt.conformance).toBe('unstructured');
    expect(gpt.findings).toEqual([]);
    expect(reviews).toHaveLength(3);                 // still KEPT, never dropped
  });

  test('dead leg is reported in deadLegs and its review absent', async () => {
    const ctx = makeCtx({
      onWave: (opts) => okWave(opts.models.map(m =>
        m === 'qwen' ? mkLeg(m, '', 'error') : mkLeg(m, review(m)))),
      onSolo: () => { throw new Error('no solos'); },
    });
    const { reviews, deadLegs } = await runStage1(ctx);
    expect(reviews.map(r => r.model)).toEqual(['gemini', 'gpt']);
    expect(deadLegs).toHaveLength(1);
    expect(deadLegs[0].model).toBe('qwen');
  });

  // ---- LC-11: a repaired review keeps its own prose, and the repair's contract
  // ("the same findings, fixed — do not add or remove findings") is enforced. ----
  async function runStage1WithFixture({ original, repaired }) {
    const ctx = makeCtx({
      models: ['gemini'],
      onWave: (opts) => okWave(opts.models.map(m => mkLeg(m, original))),
      onSolo: () => okWave([mkLeg('gemini', repaired)]),
    });
    return runStage1(ctx);
  }

  test('a repaired review always keeps its own prose — never the repair JSON', async () => {
    const original = 'Original prose naming the ordering bug.\n```json\n'
      + '{"overall":"o","findings":[{"id":1,"severity":"huge","claim":"c",'
      + '"location":"l","rationale":"r"}]}\n```';
    // A repair leg returns ONLY the corrected JSON — briefings.js:19-26 omits the
    // two-part prose framing on purpose. Substituting this as `text` would hand the
    // judges a review with no narrative and put a JSON dump in bundle-stage2.md.
    const repaired = '```json\n{"overall":"o","findings":[{"id":1,"severity":"major",'
      + '"claim":"c","location":"l","rationale":"r"}]}\n```';
    const { reviews } = await runStage1WithFixture({ original, repaired });
    expect(reviews[0].conformance).toBe('repaired');
    expect(reviews[0].text).toBe(original);
    expect(reviews[0].text).toContain('Original prose naming the ordering bug');
    expect(reviews[0].findings).toHaveLength(1);
    expect(reviews[0].findingsUnverified).toBeFalsy();   // count matched: contract honored
  });

  test('a repair that ADDS a finding is refused — the prose cannot support it', async () => {
    const original = 'Prose about exactly one problem.\n```json\n'
      + '{"overall":"o","findings":[{"id":1,"severity":"huge","claim":"c",'
      + '"location":"l","rationale":"r"}]}\n```';
    // Two findings out, one in: the repair invented a claim the prose never made.
    // NOT the costgate01 shape — that leg emitted no fenced block at all, so the
    // count is unverifiable and the repair is accepted-but-flagged below; LC-12's
    // prompt fix is what addresses that incident (review F4).
    const repaired = '```json\n{"overall":"o","findings":['
      + '{"id":1,"severity":"major","claim":"c","location":"l","rationale":"r"},'
      + '{"id":2,"severity":"major","claim":"invented","location":"l","rationale":"r"}]}\n```';
    const { reviews } = await runStage1WithFixture({ original, repaired });
    expect(reviews[0].conformance).toBe('unstructured');
    expect(reviews[0].findings).toEqual([]);
    expect(reviews[0].text).toBe(original);
  });

  test('review F1: the refusal is RECORDED, not silently folded into unstructured', async () => {
    // Without this the strongest case (contract provably broken) is invisible while
    // the weakest (contract uncheckable) carries findingsUnverified — backwards.
    const original = 'Prose about exactly one problem.\n```json\n'
      + '{"overall":"o","findings":[{"id":1,"severity":"huge","claim":"c",'
      + '"location":"l","rationale":"r"}]}\n```';
    const repaired = '```json\n{"overall":"o","findings":['
      + '{"id":1,"severity":"major","claim":"c","location":"l","rationale":"r"},'
      + '{"id":2,"severity":"major","claim":"invented","location":"l","rationale":"r"}]}\n```';
    const { reviews } = await runStage1WithFixture({ original, repaired });
    expect(reviews[0].repairRefused.code).toBe('REPAIR_CHANGED_FINDING_COUNT');
    expect(reviews[0].repairRefused.detail).toBe('repair returned 2 findings, original attempted 1');
    // …and it is the OTHER half of the contract outcome, never both at once.
    expect(reviews[0].findingsUnverified).toBeUndefined();
  });

  test('review F1: an unstructured seat that never emitted JSON carries NO refusal', async () => {
    const ctx = makeCtx({
      models: ['gemini'],
      onWave: (opts) => okWave(opts.models.map(m => mkLeg(m, 'prose, no block'))),
      onSolo: () => okWave([mkLeg('gemini', 'still no block')]),
    });
    const { reviews } = await runStage1(ctx);
    expect(reviews[0].conformance).toBe('unstructured');
    expect('repairRefused' in reviews[0]).toBe(false);
  });

  test('a repair that DROPS a finding is refused too', async () => {
    const original = 'Prose about two problems.\n```json\n{"overall":"o","findings":['
      + '{"id":1,"severity":"huge","claim":"c","location":"l","rationale":"r"},'
      + '{"id":2,"severity":"major","claim":"c2","location":"l","rationale":"r"}]}\n```';
    const repaired = '```json\n{"overall":"o","findings":[{"id":1,"severity":"major",'
      + '"claim":"c","location":"l","rationale":"r"}]}\n```';
    const { reviews } = await runStage1WithFixture({ original, repaired });
    expect(reviews[0].conformance).toBe('unstructured');
    expect(reviews[0].findings).toEqual([]);
  });

  test('an unparseable original accepts the repair but marks it unverified', async () => {
    const original = 'Prose about three problems.\n```json\n{this is not json\n```';
    const repaired = '```json\n{"overall":"o","findings":[{"id":1,"severity":"major",'
      + '"claim":"c","location":"l","rationale":"r"}]}\n```';
    const { reviews } = await runStage1WithFixture({ original, repaired });
    expect(reviews[0].conformance).toBe('repaired');
    expect(reviews[0].findingsUnverified).toBe(true);
    expect(reviews[0].text).toBe(original);
  });

  test('an original with NO fenced block accepts the repair but marks it unverified', async () => {
    // The main legitimate use of the repair wave: nothing to compare against.
    const repaired = '```json\n{"overall":"o","findings":[{"id":1,"severity":"major",'
      + '"claim":"c","location":"l","rationale":"r"}]}\n```';
    const { reviews } = await runStage1WithFixture({ original: 'Prose, no block.', repaired });
    expect(reviews[0].conformance).toBe('repaired');
    expect(reviews[0].findingsUnverified).toBe(true);
  });

  test('review F2: an original declaring ZERO findings never pays for a repair', async () => {
    // v4.5 FR-2: the repairCanHonorContract guard this test once exercised was
    // deleted (constant-true post-LC-10). The behavior it pinned still holds for
    // a simpler reason: this original VALIDATES (empty set + real overall), so
    // the repair loop is never entered. solos === 0 remains the invariant.
    const original = 'I read it and found nothing.\n```json\n{"overall":"o","findings":[]}\n```';
    let solos = 0;
    const ctx = makeCtx({
      models: ['gemini'],
      onWave: (opts) => okWave(opts.models.map(m => mkLeg(m, original))),
      onSolo: () => { solos += 1; return okWave([mkLeg('gemini', review('gemini'))]); },
    });
    const { reviews } = await runStage1(ctx);
    expect(solos).toBe(0);
    expect(reviews).toHaveLength(1);          // the seat is KEPT, as always
    expect(reviews[0].text).toBe(original);
    expect(reviews[0].findings).toEqual([]);
    expect('repairRefused' in reviews[0]).toBe(false);
  });

  test('LC-10: a seat that honestly found nothing ends CLEAN, not unstructured', async () => {
    // The marker gap review F2 left open, closed by the validator flip: this seat
    // used to fall out of the loop as a bare `conformance: 'unstructured'` with no
    // qualifying key — indistinguishable, in tally.json and verdict.json, from a
    // seat whose output was broken. It is now what it always was: a clean review.
    const original = 'I read the material and found nothing to report.\n```json\n'
      + '{"overall":"No defects in any category.","findings":[]}\n```';
    const ctx = makeCtx({
      models: ['gemini'],
      onWave: (opts) => okWave(opts.models.map(m => mkLeg(m, original))),
      onSolo: () => { throw new Error('no repairs expected on a clean review'); },
    });
    const { reviews } = await runStage1(ctx);
    expect(reviews[0].conformance).toBe('clean');
    expect(reviews[0].findings).toEqual([]);
    expect(reviews[0].text).toBe(original);
    expect('findingsUnverified' in reviews[0]).toBe(false);
    expect('repairRefused' in reviews[0]).toBe(false);
  });

  test('LC-10: an empty set with a BLANK overall still repairs — and can now succeed', async () => {
    // The other half of the flip. A hollow shell stays invalid, so it re-enters the
    // repair loop (the review F2 guard that once skipped it for a zero-finding
    // original is gone — v4.5 FR-2) — and the contract-honoring repair, another
    // empty set with a real `overall`, now VALIDATES instead of being a
    // predetermined 'unstructured'. One paid leg that can actually buy an outcome.
    const original = 'Prose.\n```json\n{"overall":"","findings":[]}\n```';
    const repaired = '```json\n{"overall":"I read the material and found nothing.","findings":[]}\n```';
    let solos = 0;
    const ctx = makeCtx({
      models: ['gemini'],
      onWave: (opts) => okWave(opts.models.map(m => mkLeg(m, original))),
      onSolo: () => { solos += 1; return okWave([mkLeg('gemini', repaired)]); },
    });
    const { reviews } = await runStage1(ctx);
    expect(solos).toBe(1);
    expect(reviews[0].conformance).toBe('repaired');
    expect(reviews[0].findings).toEqual([]);
    // The count contract WAS checkable here (0 attempted, 0 returned), so the
    // repair is verified rather than merely accepted.
    expect('findingsUnverified' in reviews[0]).toBe(false);
    expect('repairRefused' in reviews[0]).toBe(false);
  });

  test('a CLEAN review is never marked unverified and never count-checked', async () => {
    const ctx = makeCtx({
      models: ['gemini'],
      onWave: (opts) => okWave(opts.models.map(m => mkLeg(m, review(m)))),
      onSolo: () => { throw new Error('no repairs expected'); },
    });
    const { reviews } = await runStage1(ctx);
    expect(reviews[0].conformance).toBe('clean');
    expect(reviews[0].findingsUnverified).toBeUndefined();
    expect('findingsUnverified' in reviews[0]).toBe(false);
  });

  test('signal-aborted wave short-circuits with the abort exit code', async () => {
    const ctx = makeCtx({
      onWave: () => ({ wave: { status: 'aborted', legs: [] }, exitCode: 130 }),
      onSolo: () => { throw new Error('no solos'); },
    });
    const { aborted } = await runStage1(ctx);
    expect(aborted).toBe(130);
  });
});

describe('SL-2: the Stage-1 once-only retry seam', () => {
  test('a dead leg whose retry recovers: heal noted, NO degrade, review counted, deadLegs empty', async () => {
    // first launch: bench wave with one usable + one dead leg; retry launch: usable leg for the dead seat
    const ctx = makeCtx({ models: ['a', 'b'] });
    // roster (-s1): o.models.filter(m => m !== critic) = ['a', 'b'] -> a=slot1, b=slot2.
    // retry roster (-s1r1): groupStage1Losses's dead-legs order = ['b'] alone -> slot1.
    ctx.launchers.launchWave
      .mockResolvedValueOnce({ wave: { waveId: 'abc123-s1',
        legs: [usableLeg('a', 'abc123-s1', 1), deadLeg('b', undefined, undefined, 'abc123-s1', 2)] }, exitCode: 0 })
      .mockResolvedValueOnce({ wave: { waveId: 'abc123-s1r1',
        legs: [usableLeg('b', 'abc123-s1r1', 1)] }, exitCode: 0 });
    const r = await runStage1(ctx);
    const chans = ctx._notes.map(n => [n.channel, n.kind || 'degrade']);
    expect(chans).toEqual([['stage1-retry', 'heal']]);
    expect(r.reviews.map(v => v.model).sort()).toEqual(['a', 'b']);
    expect(r.deadLegs).toEqual([]);
    expect(r.degraded).toBe(false);
  });

  test('retry also dies: exactly ONE dead-leg degrade, enriched why, degraded true', async () => {
    // Reconciliation (Step 2): makeCtx() defaults to the gemini/gpt/qwen bench,
    // but the legs below are for a/b — pass the matching bench so the roster
    // these legs are stamped against is the one actually launched.
    const ctx = makeCtx({ models: ['a', 'b'] });
    // roster (-s1): ['a', 'b'] -> a=slot1, b=slot2. retry roster (-s1r1): ['b'] alone -> slot1.
    ctx.launchers.launchWave
      .mockResolvedValueOnce({ wave: { waveId: 'abc123-s1',
        legs: [usableLeg('a', 'abc123-s1', 1), deadLeg('b', undefined, undefined, 'abc123-s1', 2)] }, exitCode: 0 })
      .mockResolvedValueOnce({ wave: { waveId: 'abc123-s1r1',
        legs: [deadLeg('b', 'timeout', null, 'abc123-s1r1', 1)] }, exitCode: 0 });
    const r = await runStage1(ctx);
    const deadNotes = ctx._notes.filter(n => n.channel === 'dead-leg');
    expect(deadNotes).toHaveLength(1);
    expect(deadNotes[0].why).toMatch(/its once-only retry also ended 'timeout'/);
    expect(r.degraded).toBe(true);
    expect(r.deadLegs.map(l => l.modelInput)).toEqual(['b']);
  });

  test('overBudget: no retry launch, degrade fields byte-identical to the pre-SL-2 text', async () => {
    // Reconciliation (Step 2): same off-bench mismatch as above.
    const ctx = makeCtx({ overBudget: () => true, models: ['a', 'b'] });
    // roster (-s1): ['a', 'b'] -> a=slot1, b=slot2.
    ctx.launchers.launchWave
      .mockResolvedValueOnce({ wave: { waveId: 'abc123-s1',
        legs: [usableLeg('a', 'abc123-s1', 1), deadLeg('b', undefined, undefined, 'abc123-s1', 2)] }, exitCode: 0 });
    const r = await runStage1(ctx);
    expect(ctx.launchers.launchWave).toHaveBeenCalledTimes(1); // no second launch
    const n = ctx._notes.find(x => x.channel === 'dead-leg');
    expect(n.why).toBe("the leg ended 'error': boom with no usable output");
    expect(n.effect).toBe('1 of 2 seats reviewed; the run continues with the bench that did and will exit degraded (2)');
    expect(r.degraded).toBe(true);
  });

  test('abort during the retry propagates without noting anything', async () => {
    // Reconciliation (Step 2): same off-bench mismatch as above.
    const ctx = makeCtx({ models: ['a', 'b'] });
    // roster (-s1): ['a', 'b'] -> a=slot1, b=slot2.
    ctx.launchers.launchWave
      .mockResolvedValueOnce({ wave: { waveId: 'abc123-s1',
        legs: [deadLeg('a', undefined, undefined, 'abc123-s1', 1), deadLeg('b', undefined, undefined, 'abc123-s1', 2)] }, exitCode: 0 })
      .mockResolvedValueOnce({ wave: null, exitCode: 130 });
    const r = await runStage1(ctx);
    expect(r.aborted).toBe(130);
    expect(ctx._notes).toEqual([]);
  });

  // ---- Fix-wave (coordinator review, appended after Task 5's initial commit) ----

  test('CODE FIX 1: abort during a POST-retry repair reports post-retry dead sets, not the pre-retry ones', async () => {
    // The whole first-pass wave dies; the retry heals BOTH seats (so the
    // pre-retry deadWaves record and the post-retry stillDeadWaves diverge:
    // [{...}] vs []). The retry-recovered leg for 'b' is malformed, which
    // enters the findings-repair loop below; that repair solo aborts. Before
    // the fix, the abort-mid-repair return leaked the stale pre-retry
    // `deadWaves` binding — a heal-then-abort run reported a seat as dead
    // that had actually reviewed.
    const ctx = makeCtx({
      models: ['a', 'b'],
      onSolo: () => ({ wave: { status: 'aborted', legs: [] }, exitCode: 130 }),
    });
    // retry roster (-s1r1): the whole first wave died naming ['a', 'b'] -> a=slot1, b=slot2.
    ctx.launchers.launchWave
      .mockResolvedValueOnce({ wave: { waveId: 'abc123-s1', legs: [] }, exitCode: 1 }) // whole wave dies
      .mockResolvedValueOnce({ wave: { waveId: 'abc123-s1r1',
        legs: [usableLeg('a', 'abc123-s1r1', 1), mkLeg('b', 'prose without json', 'complete', 'abc123-s1r1', 2)] },
        exitCode: 0 }); // retry heals both
    const r = await runStage1(ctx);
    expect(r.aborted).toBe(130);
    expect(r.deadWaves).toEqual([]);
    expect(r.deadLegs).toEqual([]);
    expect(r.reviews.map(v => v.model)).toEqual(['a']); // 'b' never got pushed — abort landed first
  });

  test('CODE FIX 2: a retry leg for a seat that never failed is ignored — exactly one review per seat', async () => {
    // Only 'b' failed; the bench retry is launched for 'b' alone, but the
    // (mocked) response also names 'a', who never lost its seat. Before the
    // fix this fabricated a bogus heal for 'a' ("ended 'unknown'") and a
    // second, duplicate review row for 'a' alongside its real first-pass one.
    const ctx = makeCtx({ models: ['a', 'b'] });
    // roster (-s1): ['a', 'b'] -> a=slot1, b=slot2. retry roster (-s1r1): only
    // 'b' lost its seat -> ['b'] alone, slot1. The mocked retry response also
    // names 'a' — an engine can never do this (the retry roster IS ['b']
    // alone), so 'a' gets a taskId no real wave could produce and carries no
    // waveId stamp, modeling that engine-impossible response so PR2b's
    // orphanLegs assertion on it is meaningful rather than accidental.
    ctx.launchers.launchWave
      .mockResolvedValueOnce({ wave: { waveId: 'abc123-s1',
        legs: [usableLeg('a', 'abc123-s1', 1), deadLeg('b', undefined, undefined, 'abc123-s1', 2)] }, exitCode: 0 })
      .mockResolvedValueOnce({ wave: { waveId: 'abc123-s1r1',
        legs: [usableLeg('b', 'abc123-s1r1', 1), { ...usableLeg('a'), taskId: 'stray-1' }] }, exitCode: 0 });
    const r = await runStage1(ctx);
    expect(r.reviews.filter(v => v.model === 'a')).toHaveLength(1);
    expect(r.reviews.map(v => v.model).sort()).toEqual(['a', 'b']);
    const heals = ctx._notes.filter(n => n.channel === 'stage1-retry' && n.kind === 'heal');
    expect(heals.map(n => n.data.seat)).toEqual(['b']); // no bogus heal for 'a'
  });

  test('CODE FIX 3: abort during the RETRY UNIT ITSELF (not the post-retry repair) also reports post-retry dead sets', async () => {
    // Sibling of CODE FIX 1, for the OTHER abort return in this seam (line
    // ~145, the `retry.aborted` short-circuit) rather than the post-retry
    // findings-repair abort CODE FIX 1 covers. Whole bench wave [a,b] dies
    // first pass; critic solo dies too. Retry pass (serial: bench, then
    // critic): the bench retry unit heals BOTH a and b, THEN the critic
    // retry unit's solo aborts. Before this fix, the `retry.aborted` return
    // handed back the pre-retry `deadLegs0`/`deadWaves` bindings verbatim —
    // a heal-then-abort run recorded a+b as dead even though their heals
    // were already noted on ctx.degrade a moment earlier in the same
    // (serial) retry pass.
    const ctx = makeCtx({ models: ['a', 'b'], critic: 'crit' });
    // retry roster (-s1r1): the whole first bench wave died naming ['a', 'b'] -> a=slot1, b=slot2.
    ctx.launchers.launchWave
      .mockResolvedValueOnce({ wave: { waveId: 'abc123-s1', legs: [], reason: 'server never started' }, exitCode: 1 })
      .mockResolvedValueOnce({ wave: { waveId: 'abc123-s1r1',
        legs: [usableLeg('a', 'abc123-s1r1', 1), usableLeg('b', 'abc123-s1r1', 2)] }, exitCode: 0 });
    // critic roster (-c1 / -c1r1): a one-seat roster, slot is always 1.
    ctx.launchers.launchSolo
      .mockResolvedValueOnce({ wave: { waveId: 'abc123-c1', legs: [deadLeg('crit', undefined, undefined, 'abc123-c1', 1)] },
        exitCode: 0, leg: deadLeg('crit', undefined, undefined, 'abc123-c1', 1) })
      .mockResolvedValueOnce({ wave: null, exitCode: 130, leg: null });
    const r = await runStage1(ctx);
    expect(r.aborted).toBe(130);
    expect(r.deadWaves).toEqual([]); // a, b healed — the wave entry is gone, not just emptied of names
    expect(r.deadLegs.map(l => l.modelInput)).toEqual(['crit']); // crit's retry itself aborted — still dead
    expect(r.reviews).toEqual([]);
    const heals = ctx._notes.filter(n => n.channel === 'stage1-retry' && n.kind === 'heal');
    expect(heals.map(n => n.data.seat).sort()).toEqual(['a', 'b']); // heals for a+b noted regardless of the later abort
  });

  test('D7 twin: overBudget dead-WAVE skip — degrade fields byte-identical to the pre-SL-2 text', async () => {
    // The sibling of the existing dead-LEG byte-identity pin above, for a
    // whole-wave loss: budget-skipped records must read exactly as they did
    // before SL-2 existed, for waves same as for legs.
    const ctx = makeCtx({ overBudget: () => true });
    ctx.launchers.launchWave
      .mockResolvedValueOnce({ wave: { waveId: 'abc123-s1', legs: [] }, exitCode: 1 });
    const r = await runStage1(ctx);
    expect(ctx.launchers.launchWave).toHaveBeenCalledTimes(1); // no retry launch
    const n = ctx._notes.find(x => x.channel === 'dead-wave');
    expect(n.what).toBe('Stage-1 wave abc123-s1 (gemini, gpt, qwen) produced NO legs');
    expect(n.why).toBe('the wave produced no legs');
    expect(n.effect).toBe('Those seats are NOT in this council. The run continues with the bench that did '
      + 'launch and will exit degraded (2)');
    expect(r.degraded).toBe(true);
  });
});

describe('Task 4: extraRows — repair, dead-seat error, superseded (v4.7 D2/E4)', () => {
  test('a repair launch gets its own extraRows row: role repair, its own waveId, usage attributed', async () => {
    const ctx = makeCtx({
      onWave: (opts) => okWave(opts.models.map(m =>
        mkLeg(m, m === 'gpt' ? 'prose without json' : review(m)))),
      onSolo: (opts) => okWave([{ ...mkLeg('gpt', review('gpt')), waveId: opts.waveId }]),
    });
    const { extraRows } = await runStage1(ctx);
    expect(extraRows).toHaveLength(1);
    expect(extraRows[0]).toMatchObject({ model: 'gpt', role: 'repair', wasChair: false, waveId: 'abc123-p1' });
    expect(extraRows[0].usage.cost.amount).toBe(0.01);
    expect(extraRows[0].durationMs).toBe(1000);
  });

  test('a repair whose own leg dies still gets its row — error status rides naturally, no special-casing', async () => {
    const ctx = makeCtx({
      models: ['gemini'],
      onWave: (opts) => okWave(opts.models.map(m => mkLeg(m, 'prose without json'))),
      // repair-solo roster: a one-seat roster (the seat being repaired), slot is always 1.
      onSolo: (opts) => okWave([deadLeg('gemini', undefined, undefined, opts.waveId, 1)]),
    });
    const { extraRows } = await runStage1(ctx);
    const repairRows = extraRows.filter(r => r.role === 'repair');
    expect(repairRows).toHaveLength(2);                          // cap = 2 re-prompts; BOTH get a row
    expect(repairRows.map(r => r.waveId)).toEqual(['abc123-p1', 'abc123-p2']);
    expect(repairRows.every(r => r.status === 'error')).toBe(true);
  });

  test('a dead seat with no retry attempted gets a primary error row from its own (only) dead leg', async () => {
    const ctx = makeCtx({ overBudget: () => true, models: ['a', 'b'] });
    // roster (-s1): ['a', 'b'] -> a=slot1, b=slot2.
    ctx.launchers.launchWave.mockResolvedValueOnce({
      wave: { waveId: 'abc123-s1',
        legs: [usableLeg('a', 'abc123-s1', 1), deadLeg('b', undefined, undefined, 'abc123-s1', 2)] }, exitCode: 0 });
    const r = await runStage1(ctx);
    const errRow = r.extraRows.find(x => x.model === 'b');
    expect(errRow).toMatchObject({ role: 'seat', wasChair: false, status: 'error', waveId: 'abc123-s1' });
    expect(errRow.usage.cost.amount).toBe(0.01);          // the dead leg's own usage — never invented
    expect(errRow.durationMs).toBe(1000);
    expect(r.extraRows.filter(x => x.role === 'superseded')).toHaveLength(0); // never retried — no 2nd leg, no supersession
  });

  test('a healed seat gets a superseded row for its first leg; the primary review still carries the retry leg (unchanged)', async () => {
    const ctx = makeCtx({ models: ['a', 'b'] });
    // roster (-s1): ['a', 'b'] -> a=slot1, b=slot2. retry roster (-s1r1): ['b'] alone -> slot1.
    ctx.launchers.launchWave
      .mockResolvedValueOnce({ wave: { waveId: 'abc123-s1',
        legs: [usableLeg('a', 'abc123-s1', 1), deadLeg('b', undefined, undefined, 'abc123-s1', 2)] }, exitCode: 0 })
      .mockResolvedValueOnce({ wave: { waveId: 'abc123-s1r1',
        legs: [usableLeg('b', 'abc123-s1r1', 1)] }, exitCode: 0 });
    const r = await runStage1(ctx);
    const bReview = r.reviews.find(v => v.model === 'b');
    expect(bReview.leg.waveId).toBe('abc123-s1r1');               // primary carries the RETRY leg — today's behavior, pinned
    const superseded = r.extraRows.filter(x => x.role === 'superseded');
    expect(superseded).toHaveLength(1);
    expect(superseded[0]).toMatchObject({ model: 'b', wasChair: false, status: 'error', waveId: 'abc123-s1' });
    // healed ⇒ a surviving review exists ⇒ no primary ERROR row for 'b'.
    expect(r.extraRows.some(x => x.model === 'b' && x.role === 'seat')).toBe(false);
  });

  test('a failed-retry seat gets its primary error row from the REAL retry leg (real usage/duration), and its original leg superseded', async () => {
    // v4.7 D2/E4 review fix wave: E5 was amended — run-retry.js now surfaces
    // the actual retry leg (stillDeadRetryLegs), so this row carries the
    // retry's REAL usage/durationMs (the $0.01/1000ms mkLeg fixture) rather
    // than nulling them out. 'timed-out' (not 'timeout') is the canonical
    // status vocabulary (session-finalize.js:11).
    const ctx = makeCtx({ models: ['a', 'b'] });
    // roster (-s1): ['a', 'b'] -> a=slot1, b=slot2. retry roster (-s1r1): ['b'] alone -> slot1.
    ctx.launchers.launchWave
      .mockResolvedValueOnce({ wave: { waveId: 'abc123-s1',
        legs: [usableLeg('a', 'abc123-s1', 1), deadLeg('b', undefined, undefined, 'abc123-s1', 2)] }, exitCode: 0 })
      .mockResolvedValueOnce({ wave: { waveId: 'abc123-s1r1',
        legs: [deadLeg('b', 'timed-out', null, 'abc123-s1r1', 1)] }, exitCode: 0 });
    const r = await runStage1(ctx);
    expect(r.reviews.map(v => v.model)).toEqual(['a']);           // 'b' never got a surviving review
    const superseded = r.extraRows.filter(x => x.role === 'superseded' && x.model === 'b');
    expect(superseded).toHaveLength(1);
    expect(superseded[0].waveId).toBe('abc123-s1');                // the ORIGINAL leg is what's superseded
    const primaryErr = r.extraRows.find(x => x.model === 'b' && x.role === 'seat');
    expect(primaryErr).toBeDefined();
    expect(primaryErr.waveId).toBe('abc123-s1r1');                 // FROM THE RETRY leg, not the original
    expect(primaryErr.status).toBe('timed-out');                   // the RETRY's own status — not silently coerced
    expect(primaryErr.usage.cost.amount).toBe(0.01);               // REAL usage — the retry leg genuinely carries it now
    expect(primaryErr.durationMs).toBe(1000);                      // REAL duration — same real, same attempt, no mixing
  });

  test('a retry wave that dies wholesale (no leg at all for this seat) gets a leg-less primary error row: no phantom waveId', async () => {
    // srcLegStillDeadNote class: the retry unit launched but the wave itself
    // produced ZERO legs. There is no real leg to attribute anything to —
    // the row must still exist (the seat is still dead), but with no waveId
    // key at all rather than borrowing the retry's wave id for a leg that
    // never happened.
    const ctx = makeCtx({ models: ['a', 'b'] });
    // roster (-s1): ['a', 'b'] -> a=slot1, b=slot2.
    ctx.launchers.launchWave
      .mockResolvedValueOnce({ wave: { waveId: 'abc123-s1',
        legs: [usableLeg('a', 'abc123-s1', 1), deadLeg('b', undefined, undefined, 'abc123-s1', 2)] }, exitCode: 0 })
      .mockResolvedValueOnce({ wave: { waveId: 'abc123-s1r1', legs: [] }, exitCode: 0 });
    const r = await runStage1(ctx);
    const primaryErr = r.extraRows.find(x => x.model === 'b' && x.role === 'seat');
    expect(primaryErr).toBeDefined();
    expect(primaryErr.status).toBe('error');
    expect(primaryErr.usage).toBeNull();
    expect(primaryErr.durationMs).toBeNull();
    expect('waveId' in primaryErr).toBe(false);                    // no real leg backs it — no phantom waveId
  });

  test('a retry wave that partially returns (no leg named for this seat) gets a leg-less primary error row: no phantom waveId', async () => {
    // missingLegStillDeadNote class: the bench retry unit launched for
    // ['a','b'] but the response only names 'a' — 'b' has no leg record at
    // all in the retry response (distinct from a leg that came back and was
    // simply unusable).
    const ctx = makeCtx({ models: ['a', 'b', 'c'] });
    // roster (-s1): ['a', 'b', 'c'] -> a=slot1, b=slot2, c=slot3. retry
    // roster (-s1r1): both b and c lost their seat, grouped in that order ->
    // ['b', 'c'], so b=slot1. Only b's leg comes back (the partial-return
    // fixture this test is named for) — slot1 is correct for b here, but the
    // same single-leg shape naming c ALONE would need slot2, not slot1.
    ctx.launchers.launchWave
      .mockResolvedValueOnce({ wave: { waveId: 'abc123-s1', legs: [usableLeg('a', 'abc123-s1', 1),
        deadLeg('b', undefined, undefined, 'abc123-s1', 2), deadLeg('c', undefined, undefined, 'abc123-s1', 3)] }, exitCode: 0 })
      .mockResolvedValueOnce({ wave: { waveId: 'abc123-s1r1',
        legs: [usableLeg('b', 'abc123-s1r1', 1)] }, exitCode: 0 }); // 'c' never named in the retry response
    const r = await runStage1(ctx);
    const primaryErr = r.extraRows.find(x => x.model === 'c' && x.role === 'seat');
    expect(primaryErr).toBeDefined();
    expect(primaryErr.status).toBe('error');
    expect(primaryErr.usage).toBeNull();
    expect(primaryErr.durationMs).toBeNull();
    expect('waveId' in primaryErr).toBe(false);                    // no real leg backs it — no phantom waveId
  });

  test('no seat appears twice as primary, and every extraRow with a real leg carries its waveId', async () => {
    const ctx = makeCtx({ models: ['a', 'b'] });
    // roster (-s1): ['a', 'b'] -> a=slot1, b=slot2. retry roster (-s1r1): ['b'] alone -> slot1.
    ctx.launchers.launchWave
      .mockResolvedValueOnce({ wave: { waveId: 'abc123-s1',
        legs: [usableLeg('a', 'abc123-s1', 1), deadLeg('b', undefined, undefined, 'abc123-s1', 2)] }, exitCode: 0 })
      .mockResolvedValueOnce({ wave: { waveId: 'abc123-s1r1',
        legs: [usableLeg('b', 'abc123-s1r1', 1)] }, exitCode: 0 });
    const r = await runStage1(ctx);
    const primaryModels = [...r.reviews.map(v => v.model), ...r.extraRows.filter(x => x.role === 'seat').map(x => x.model)];
    expect(new Set(primaryModels).size).toBe(primaryModels.length);   // each seat: at most one primary
    // 'b' healed — this fixture's only extraRow is its superseded original leg,
    // which carries real usage/duration, so it must carry the real waveId too.
    const superseded = r.extraRows.find(x => x.role === 'superseded' && x.model === 'b');
    expect(superseded.waveId).toBe('abc123-s1');
  });
});

describe('runStage2', () => {
  function stage1Reviews() {
    return [
      { model: 'gemini', modelInput: 'gemini', role: 'seat', text: review('gemini'),
        findings: [{ id: 1, severity: 'major', claim: 'c', location: 'l', rationale: 'r' }],
        conformance: 'clean', leg: mkLeg('gemini', review('gemini')) },
      { model: 'gpt', modelInput: 'gpt', role: 'seat', text: review('gpt'),
        findings: [{ id: 1, severity: 'nit', claim: 'c', location: 'l', rationale: 'r' }],
        conformance: 'clean', leg: mkLeg('gpt', review('gpt')) },
    ];
  }
  const labels = assignLabels(['gemini', 'gpt']);
  const globalFindings = [
    ...toGlobalFindings('A', 'gemini', [{ id: 1, severity: 'major', claim: 'c' }]),
    ...toGlobalFindings('B', 'gpt', [{ id: 1, severity: 'nit', claim: 'c' }]),
  ];

  test('happy path: shared bundle wave in _scratch, judge files written, order de-anonymized', async () => {
    const waves = [];
    const ctx = makeCtx({
      models: ['gemini', 'gpt'],
      onWave: (opts) => {
        waves.push(opts);
        return okWave([
          mkLeg('gemini', judgeOut(['Review B', 'Review A'],
            [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'neutral' }])),
          mkLeg('gpt', judgeOut(['Review A', 'Review B'],
            [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'dispute' }])),
        ]);
      },
      onSolo: () => { throw new Error('no repairs expected'); },
    });
    const { aborted, judgeResults } = await runStage2(ctx, { reviews: stage1Reviews(), labels, globalFindings });
    expect(aborted).toBeNull();
    expect(waves[0].waveId).toBe('abc123-s2');
    expect(waves[0].project).toBe(ctx.scratchDir);           // judge isolation (spec §6)
    // v4.3 Task 3 (spec §7.2): the judge wave carries council attribution.
    expect(waves[0].councilRunId).toBe('abc123');
    expect(waves[0].councilName).toBe('nightly-council');
    // v4.7 F8 D16 (T7 review): tag rides the same forward — deleting
    // `tag: o.tag` from run-stage2.js's Stage-2 launchWave call restores the
    // silent degrade this pins against.
    expect(waves[0].tag).toBe('sprint42');
    expect(waves[0].prompt.split('\n')[0]).toContain('Do NOT use any tools');
    expect(fs.existsSync(path.join(ctx.o.runDir, 'bundle-stage2.md'))).toBe(true);
    expect(fs.existsSync(path.join(ctx.o.runDir, 'judge-gemini.md'))).toBe(true);
    const g = judgeResults.find(j => j.judge === 'gemini');
    expect(g.ok).toBe(true);
    expect(g.order).toEqual(['gpt', 'gemini']);              // labels → models
    expect(g.adjudications).toEqual([{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'neutral' }]);
  });

  test('#83: each judgeResult carries its leg for cost attribution', async () => {
    // Same ctx-construction pattern as the happy-path test above (no repairs;
    // both judges parse clean on the first pass) — driven the same way.
    const ctx = makeCtx({
      models: ['gemini', 'gpt'],
      onWave: () => okWave([
        mkLeg('gemini', judgeOut(['Review B', 'Review A'],
          [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'neutral' }])),
        mkLeg('gpt', judgeOut(['Review A', 'Review B'],
          [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'dispute' }])),
      ]),
      onSolo: () => { throw new Error('no repairs expected'); },
    });
    const { judgeResults } = await runStage2(ctx, { reviews: stage1Reviews(), labels, globalFindings });
    for (const j of judgeResults) {
      expect(j).toHaveProperty('leg');
      expect(j.leg === null || typeof j.leg === 'object').toBe(true);
    }
    // Regression pin (controller ruling, post-#83): a judge that parses on the
    // FIRST pass (the common path — this fixture's onSolo throws, so NO repair
    // fires for either judge) must carry its own wave leg, non-null, status
    // 'complete' — never null. Before this ruling, `leg: (solo && solo.leg) ||
    // null` left every non-repaired judge with `leg: null`, which downstream
    // renders as a false `status: 'error'` row — worse than the missing row
    // #83 complained about. Confirmed RED against that pre-fix form (stash-check).
    const gemini = judgeResults.find(j => j.judge === 'gemini');
    expect(gemini.leg).not.toBeNull();
    expect(gemini.leg.status).toBe('complete');
  });

  test('malformed judge → repair solo in _scratch → ok with conformance repaired', async () => {
    const solos = [];
    const ctx = makeCtx({
      models: ['gemini', 'gpt'],
      onWave: () => okWave([
        mkLeg('gemini', 'no json'),
        mkLeg('gpt', judgeOut(['Review A', 'Review B'], [{ id: 'A1', verdict: 'agree' }])),
      ]),
      onSolo: (opts) => {
        solos.push(opts);
        return okWave([mkLeg('gemini', judgeOut(['Review B', 'Review A'], [{ id: 'B1', verdict: 'agree' }]))]);
      },
    });
    const { judgeResults } = await runStage2(ctx, { reviews: stage1Reviews(), labels, globalFindings });
    expect(solos[0].waveId).toBe('abc123-q1');
    expect(solos[0].project).toBe(ctx.scratchDir);
    // v4.3 Task 3 (spec §7.2): the judge-repair solo carries council attribution too.
    expect(solos[0].councilRunId).toBe('abc123');
    expect(solos[0].councilName).toBe('nightly-council');
    // v4.7 F8 D16 (T7 review): tag rides the same forward.
    expect(solos[0].tag).toBe('sprint42');
    const g = judgeResults.find(j => j.judge === 'gemini');
    expect(g.ok).toBe(true);
    expect(g.conformance).toBe('repaired');
  });

  test('LC-12: the judge repair solo carries the judgement it is repairing', async () => {
    // The defect: the repair prompt shipped the validation ERRORS without the
    // JUDGEMENT they were errors about. Stage 2 is the worse place for it — a
    // refused judge has no conformance column, so the tally silently shows fewer
    // votes and a finding's basis counts can flip its tier.
    const badJudge = 'Judged at length in prose, but the trailing JSON never appeared.';
    const solos = [];
    const ctx = makeCtx({
      models: ['gemini', 'gpt'],
      onWave: () => okWave([
        mkLeg('gemini', badJudge),
        mkLeg('gpt', judgeOut(['Review A', 'Review B'], [{ id: 'A1', verdict: 'agree' }])),
      ]),
      onSolo: (opts) => {
        solos.push(opts);
        return okWave([mkLeg('gemini', judgeOut(['Review B', 'Review A'], [{ id: 'B1', verdict: 'agree' }]))]);
      },
    });
    await runStage2(ctx, { reviews: stage1Reviews(), labels, globalFindings });
    expect(solos).toHaveLength(1);
    expect(solos[0].prompt).toContain(badJudge);
    expect(solos[0].prompt).toContain('YOUR PREVIOUS JUDGEMENT');
  });

  test('LC-12: the SECOND judge repair carries the first repair output, which is what failed', async () => {
    const solos = [];
    const badJudge = 'original judging prose, no json';
    const firstRepair = 'first judge repair, still no json';
    const ctx = makeCtx({
      models: ['gemini', 'gpt'],
      onWave: () => okWave([
        mkLeg('gemini', badJudge),
        mkLeg('gpt', judgeOut(['Review A', 'Review B'], [{ id: 'A1', verdict: 'agree' }])),
      ]),
      onSolo: (opts) => {
        solos.push(opts);
        return okWave([mkLeg('gemini', solos.length === 1 ? firstRepair : 'second repair, still no json')]);
      },
    });
    await runStage2(ctx, { reviews: stage1Reviews(), labels, globalFindings });
    expect(solos).toHaveLength(2);
    expect(solos[0].prompt).toContain(badJudge);
    expect(solos[1].prompt).toContain(firstRepair);
    expect(solos[1].prompt).not.toContain(badJudge);
  });

  test('LC-12: a judge repair whose leg came back empty still names the text that failed', async () => {
    const solos = [];
    const badJudge = 'original judging prose, no json';
    const ctx = makeCtx({
      models: ['gemini', 'gpt'],
      onWave: () => okWave([
        mkLeg('gemini', badJudge),
        mkLeg('gpt', judgeOut(['Review A', 'Review B'], [{ id: 'A1', verdict: 'agree' }])),
      ]),
      onSolo: (opts) => { solos.push(opts); return okWave([mkLeg('gemini', '')]); },
    });
    await runStage2(ctx, { reviews: stage1Reviews(), labels, globalFindings });
    expect(solos).toHaveLength(2);
    expect(solos[1].prompt).toContain(badJudge);
  });

  test('judge still bad after 2 repairs → ok false, conformance unstructured', async () => {
    let soloCount = 0;
    const ctx = makeCtx({
      models: ['gemini', 'gpt'],
      onWave: () => okWave([
        mkLeg('gemini', 'never json'),
        mkLeg('gpt', judgeOut(['Review A', 'Review B'], [{ id: 'A1', verdict: 'agree' }])),
      ]),
      onSolo: () => { soloCount += 1; return okWave([mkLeg('gemini', 'still bad')]); },
    });
    const { judgeResults } = await runStage2(ctx, { reviews: stage1Reviews(), labels, globalFindings });
    expect(soloCount).toBe(2);
    const g = judgeResults.find(j => j.judge === 'gemini');
    expect(g.ok).toBe(false);
    expect(g.conformance).toBe('unstructured');
  });

  test('cost ceiling blocks judge repair: no solo fires, judge ends unstructured', async () => {
    let soloCalls = 0;
    const ctx = makeCtx({
      models: ['gemini', 'gpt'],
      overBudget: () => true,
      onWave: () => okWave([
        mkLeg('gemini', 'no json'),
        mkLeg('gpt', judgeOut(['Review A', 'Review B'], [{ id: 'A1', verdict: 'agree' }])),
      ]),
      onSolo: () => { soloCalls += 1; throw new Error('no repair solos expected over budget'); },
    });
    const { judgeResults } = await runStage2(ctx, { reviews: stage1Reviews(), labels, globalFindings });
    expect(soloCalls).toBe(0);
    const g = judgeResults.find(j => j.judge === 'gemini');
    expect(g.ok).toBe(false);
    expect(g.conformance).toBe('unstructured');
  });

  test('judge leg complete but empty summary: no repair solo fires, ok false unstructured', async () => {
    // Regression: the repair while-loop used to guard only on leg.status === 'complete',
    // so a complete-but-empty-summary leg (nothing to repair FROM) still fired up to 2
    // paid repair solos — inconsistent with Stage-1, where materializeReviews filters
    // empty-summary legs out before repair ever starts.
    let soloCalls = 0;
    const ctx = makeCtx({
      models: ['gemini', 'gpt'],
      onWave: () => okWave([
        mkLeg('gemini', ''),   // status 'complete' (default), summary empty
        mkLeg('gpt', judgeOut(['Review A', 'Review B'], [{ id: 'A1', verdict: 'agree' }])),
      ]),
      onSolo: () => { soloCalls += 1; throw new Error('no repair solos expected for an empty-summary complete leg'); },
    });
    const { judgeResults } = await runStage2(ctx, { reviews: stage1Reviews(), labels, globalFindings });
    expect(soloCalls).toBe(0);
    const g = judgeResults.find(j => j.judge === 'gemini');
    expect(g.ok).toBe(false);
    expect(g.conformance).toBe('unstructured');
  });

  test('dead judge leg → ok false (tally over survivors; tiers unchanged)', async () => {
    const ctx = makeCtx({
      models: ['gemini', 'gpt'],
      onWave: () => okWave([
        mkLeg('gemini', '', 'timeout'),
        mkLeg('gpt', judgeOut(['Review A', 'Review B'], [{ id: 'A1', verdict: 'agree' }])),
      ]),
      onSolo: () => { throw new Error('dead legs are not repaired'); },
    });
    const { judgeResults } = await runStage2(ctx, { reviews: stage1Reviews(), labels, globalFindings });
    expect(judgeResults.find(j => j.judge === 'gemini').ok).toBe(false);
    expect(judgeResults.find(j => j.judge === 'gpt').ok).toBe(true);
  });

  test('Task 5: a repaired judge yields its primary row (original wave leg) PLUS one repair row carrying the -q1 solo usage', async () => {
    // v4.7 D2: mirrors Task 4's Stage-1 repair row, on the Stage-2 judge-repair
    // loop. The judge's OWN judgeResults entry must still carry the ORIGINAL
    // wave leg (the #83 comment at :110-116) — the repair solo's leg rides a
    // SEPARATE extraRows row instead of overwriting the primary attribution.
    const ctx = makeCtx({
      models: ['gemini', 'gpt'],
      onWave: () => okWave([
        mkLeg('gemini', 'no json'),
        mkLeg('gpt', judgeOut(['Review A', 'Review B'], [{ id: 'A1', verdict: 'agree' }])),
      ]),
      onSolo: (opts) => okWave([{ ...mkLeg('gemini',
        judgeOut(['Review B', 'Review A'], [{ id: 'B1', verdict: 'agree' }])), waveId: opts.waveId }]),
    });
    const { judgeResults, extraRows } = await runStage2(ctx, { reviews: stage1Reviews(), labels, globalFindings });
    const g = judgeResults.find(j => j.judge === 'gemini');
    expect(g.ok).toBe(true);
    expect(g.conformance).toBe('repaired');
    expect(g.leg.summary).toBe('no json');                    // primary row: the ORIGINAL wave leg, unchanged
    expect(extraRows).toHaveLength(1);
    expect(extraRows[0]).toMatchObject({
      model: 'gemini', role: 'repair', wasChair: false, waveId: 'abc123-q1', status: 'complete',
    });
    expect(extraRows[0].usage.cost.amount).toBe(0.01);
    expect(extraRows[0].durationMs).toBe(1000);
  });

  test('Task 5: a FAILED judge repair still yields its repair row (error status)', async () => {
    const ctx = makeCtx({
      models: ['gemini', 'gpt'],
      onWave: () => okWave([
        mkLeg('gemini', 'never json'),
        mkLeg('gpt', judgeOut(['Review A', 'Review B'], [{ id: 'A1', verdict: 'agree' }])),
      ]),
      onSolo: (opts) => okWave([{ ...deadLeg('gemini'), waveId: opts.waveId }]),
    });
    const { judgeResults, extraRows } = await runStage2(ctx, { reviews: stage1Reviews(), labels, globalFindings });
    const g = judgeResults.find(j => j.judge === 'gemini');
    expect(g.ok).toBe(false);
    expect(g.conformance).toBe('unstructured');
    const repairRows = extraRows.filter(r => r.role === 'repair');
    expect(repairRows).toHaveLength(2);                       // cap = 2 re-prompts; BOTH get a row
    expect(repairRows.map(r => r.waveId)).toEqual(['abc123-q1', 'abc123-q2']);
    expect(repairRows.every(r => r.status === 'error')).toBe(true);
    expect(repairRows.every(r => r.model === 'gemini')).toBe(true);
  });

  test('date-stamps the judge bundle it writes to bundle-stage2.md (spec §4.3)', async () => {
    const s2 = require('../../src/council/briefings-stage2');
    const ctx = makeCtx({
      models: ['gemini', 'gpt'],
      onWave: () => okWave([
        mkLeg('gemini', judgeOut(['Review B', 'Review A'],
          [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'agree' }])),
        mkLeg('gpt', judgeOut(['Review A', 'Review B'],
          [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'agree' }])),
      ]),
      onSolo: () => { throw new Error('no repairs expected'); },
    });
    await runStage2(ctx, { reviews: stage1Reviews(), labels, globalFindings });
    const bundle = fs.readFileSync(path.join(ctx.o.runDir, 'bundle-stage2.md'), 'utf-8');
    expect(bundle).toContain("Today's date is 2026-07-19.");
    expect(bundle.split('\n')[0]).toBe(s2.JUDGE_NO_TOOLS_PREAMBLE);  // preamble is still line 1
  });
});
