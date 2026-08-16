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
const { buildSeats, bindSeats } = require('../../src/council/seats');
// The REAL judgeResults[].seat -> adjudications[].seat join, so the F1 pins
// below assert against the shipped projection rather than re-implementing it.
const { buildTallyInput } = require('../../src/council/run-assemble');
// v4.8 PR4c: the dead-seat row producer is exported, so its two seat shapes are
// pinnable with no runCouncil, no launchers and no disk.
const { pushDeadSeatRows } = require('../../src/council/run-stage1-rows');

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
const okWave = (legs, waveId) => ({ wave: { status: 'complete', ...(waveId ? { waveId } : {}), legs }, exitCode: 0 });
// SL-2 Task 5: legs for the retry-seam tests. usableLeg materializes cleanly;
// deadLeg defaults to the exact status/error pair ('error'/'boom') the
// pre-existing dead-leg test already uses inline, so the enriched-why pins
// below read the same as the rest of this file. Mirrors the same-named
// helpers in tests/council/run-retry.test.js.
// v4.8 PR2a Task 1: both take the same trailing (waveId, slot) pair as mkLeg.
const usableLeg = (model, waveId, slot) => mkLeg(model, review(model), 'complete', waveId, slot);
// CI council finding on PR #152: every status this file's deadLeg call sites
// actually pass (default 'error', plus explicit 'error'/'timeout'/'timed-out').
const DEAD_LEG_STATUSES = new Set(['error', 'timeout', 'timed-out']);
const deadLeg = (model, status = 'error', error = 'boom', waveId, slot) => {
  // waveId/slot trail two DEFAULTED params, so `deadLeg('b', 'r1-s1', 2)` would
  // silently land the wave id in `status`. Fail loudly instead: the binding gate
  // cannot see a bogus status, only a bogus id.
  if (!DEAD_LEG_STATUSES.has(status)) {
    throw new Error(`deadLeg: status '${status}' is not a leg status — did you mean deadLeg(model, status, error, waveId, slot)?`);
  }
  return { ...mkLeg(model, '', status, waveId, slot), error };
};

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
  // Production sets these at run.js:133-134 (asm.preflightSeats). Without them
  // every consumer under test falls through roleAt's unknown-id default and an
  // empty bindSeats roster — green for the wrong reason.
  const seats = buildSeats(models, critic, lenses);
  const criticSeat = (seats.find(s => s.alias === critic) || {}).id || null;
  return {
    o: { briefing: 'material', models, chair: 'deepseek', critic, lenses,
      runId: 'abc123', runDir, timeout: 10, gateway: 'auto', noValidateModel: false, date: '2026-07-19',
      // v4.3 Task 3 (spec §7.2): non-null so every launch-site assertion below
      // can prove the id actually reached the launcher, not just a falsy default.
      // v4.7 F8 D16 (T7 review): tag joins it on the same idiom.
      councilName: 'nightly-council', tag: 'sprint42', seats, criticSeat },
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

describe('deadLeg fixture guard (CI council finding, PR #152)', () => {
  test('a misordered call — waveId landing in the status slot — throws loudly instead of silently corrupting the leg', () => {
    expect(() => deadLeg('b', 'r1-s1', 2)).toThrow(/not a leg status/);
  });
});

describe('runStage1', () => {
  test('happy path: one wave for standard seats, reviews materialized + validated', async () => {
    const waves = [];
    const ctx = makeCtx({
      onWave: (opts) => { waves.push(opts); return okWave(opts.models.map((m, i) => mkLeg(m, review(m), 'complete', opts.waveId, i + 1))); },
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
      onWave: (opts) => okWave(opts.models.map((m, i) => mkLeg(m, review(m), 'complete', opts.waveId, i + 1))),
      onSolo: (opts) => { solos.push(opts); return okWave([mkLeg(opts.model, review(opts.model), 'complete', opts.waveId, 1)]); },
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
      onSolo: (opts) => { solos.push(opts); return okWave([mkLeg(opts.model, review(opts.model), 'complete', opts.waveId, 1)]); },
    });
    const { reviews } = await runStage1(ctx);
    expect(solos.map(s => s.waveId)).toEqual(['abc123-l1', 'abc123-l2', 'abc123-l3']);
    expect(solos[0].prompt).toContain('growth-stage VC');
    expect(reviews.find(r => r.model === 'gpt').role).toBe(`lens:${slug('security architect')}`);
  });

  test('twin lens seats get their OWN lens, not the first twin’s (roleAt vs roleFor)', async () => {
    const ctx = makeCtx({ models: ['deepseek', 'deepseek'], lenses: ['risk', 'cost'],
      onSolo: (opts) => { const leg = mkLeg(opts.model, review(), 'complete', opts.waveId, 1);
        return { wave: { waveId: opts.waveId, legs: [leg] }, exitCode: 0, leg }; } });
    const r = await runStage1(ctx);
    expect(r.reviews.map(x => x.role)).toEqual(['lens:risk', 'lens:cost']);
  });

  test('roleFor is still exported for the alias-space shim', () => {
    expect(typeof require('../../src/council/run-stages').roleFor).toBe('function');
  });

  // ⚠️ v4.8 PR2b final review — the o.seats FALLBACK path was not merely
  // untested, it was BROKEN. run-stage1-launch.js:20-22 re-derives the seat
  // table with buildSeats when o.seats is absent (a direct require() caller, or
  // a legacy run dir), so every leg binds and `m.seat` is TRUTHY while `o.seats`
  // stays UNDEFINED. roleAt returns 'seat' for an unknown id without throwing
  // (seats.js:83-86), so every critic and lens role silently collapsed to
  // 'seat' on exactly the path the fallback exists to serve. The seat object
  // carries its own role — read THAT, never a lookup into a table that may not
  // be there. Restoring `roleAt(o.seats, ...)` at run-stages.js's review push
  // (or run-stage1-rows.js's dead-seat push) turns this red.
  test('o.seats absent: the re-derived seat table still gives the critic role critic', async () => {
    const ctx = makeCtx({ models: ['a', 'b', 'crit'], critic: 'crit',
      onWave: (opts) => okWave(opts.models.map((m, i) => mkLeg(m, review(m), 'complete', opts.waveId, i + 1))),
      onSolo: (opts) => okWave([mkLeg(opts.model, review(opts.model), 'complete', opts.waveId, 1)]) });
    delete ctx.o.seats;
    delete ctx.o.criticSeat;
    const r = await runStage1(ctx);
    expect(r.reviews.map(x => [x.model, x.role])).toEqual([['a', 'seat'], ['b', 'seat'], ['crit', 'critic']]);
  });

  test('malformed findings → repair solo → conformance repaired', async () => {
    const solos = [];
    const ctx = makeCtx({
      onWave: (opts) => okWave(opts.models.map((m, i) =>
        mkLeg(m, m === 'gpt' ? 'prose without json' : review(m), 'complete', opts.waveId, i + 1))),
      onSolo: (opts) => { solos.push(opts); return okWave([mkLeg('gpt', review('gpt'), 'complete', opts.waveId, 1)]); },
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
      onWave: (opts) => okWave(opts.models.map((m, i) => mkLeg(m, m === 'gpt' ? badReview : review(m), 'complete', opts.waveId, i + 1))),
      onSolo: (opts) => { solos.push(opts); return okWave([mkLeg('gpt', review('gpt'), 'complete', opts.waveId, 1)]); },
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
      onWave: (opts) => okWave(opts.models.map((m, i) => mkLeg(m, m === 'gpt' ? badReview : review(m), 'complete', opts.waveId, i + 1))),
      onSolo: (opts) => {
        solos.push(opts);
        return okWave([mkLeg('gpt', solos.length === 1 ? firstRepair : 'second repair, still no json', 'complete', opts.waveId, 1)]);
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
      onWave: (opts) => okWave(opts.models.map((m, i) => mkLeg(m, m === 'gpt' ? badReview : review(m), 'complete', opts.waveId, i + 1))),
      onSolo: (opts) => { solos.push(opts); return okWave([mkLeg('gpt', '', 'complete', opts.waveId, 1)]); },
    });
    await runStage1(ctx);
    expect(solos).toHaveLength(2);
    expect(solos[1].prompt).toContain(badReview);
  });

  test('still malformed after 2 repairs → unstructured, findings [], review KEPT', async () => {
    let soloCount = 0;
    const ctx = makeCtx({
      onWave: (opts) => okWave(opts.models.map((m, i) =>
        mkLeg(m, m === 'gpt' ? 'no json at all' : review(m), 'complete', opts.waveId, i + 1))),
      onSolo: (opts) => { soloCount += 1; return okWave([mkLeg('gpt', 'still no json', 'complete', opts.waveId, 1)]); },
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
      onWave: (opts) => okWave(opts.models.map((m, i) =>
        mkLeg(m, m === 'gpt' ? 'prose without json' : review(m), 'complete', opts.waveId, i + 1))),
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
      onWave: (opts) => okWave(opts.models.map((m, i) =>
        m === 'qwen' ? mkLeg(m, '', 'error', opts.waveId, i + 1) : mkLeg(m, review(m), 'complete', opts.waveId, i + 1))),
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
      onWave: (opts) => okWave(opts.models.map((m, i) => mkLeg(m, original, 'complete', opts.waveId, i + 1))),
      onSolo: (opts) => okWave([mkLeg('gemini', repaired, 'complete', opts.waveId, 1)]),
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
      onWave: (opts) => okWave(opts.models.map((m, i) => mkLeg(m, 'prose, no block', 'complete', opts.waveId, i + 1))),
      onSolo: (opts) => okWave([mkLeg('gemini', 'still no block', 'complete', opts.waveId, 1)]),
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
      onWave: (opts) => okWave(opts.models.map((m, i) => mkLeg(m, original, 'complete', opts.waveId, i + 1))),
      onSolo: (opts) => { solos += 1; return okWave([mkLeg('gemini', review('gemini'), 'complete', opts.waveId, 1)]); },
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
      onWave: (opts) => okWave(opts.models.map((m, i) => mkLeg(m, original, 'complete', opts.waveId, i + 1))),
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
      onWave: (opts) => okWave(opts.models.map((m, i) => mkLeg(m, original, 'complete', opts.waveId, i + 1))),
      onSolo: (opts) => { solos += 1; return okWave([mkLeg('gemini', repaired, 'complete', opts.waveId, 1)]); },
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
      onWave: (opts) => okWave(opts.models.map((m, i) => mkLeg(m, review(m), 'complete', opts.waveId, i + 1))),
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

  // ---- v4.8 PR2b Task 6 (H4): twin seats retry independently ----

  test('H4: a twin bench whose retry heals BOTH seats emits no degrade and exits clean', async () => {
    // Before H4 the two twins collapsed into ONE retry leg, so one paid seat
    // was silently abandoned. Both must relaunch, and both must heal cleanly.
    const ctx = makeCtx({ models: ['deepseek', 'deepseek'] });
    // roster (-s1): ['deepseek','deepseek'] -> #1=slot1, #2=slot2; retry roster
    // (-s1r1) is the same pair in the same order.
    ctx.launchers.launchWave
      .mockResolvedValueOnce({ wave: { waveId: 'abc123-s1',
        legs: [deadLeg('deepseek', undefined, undefined, 'abc123-s1', 1),
          deadLeg('deepseek', undefined, undefined, 'abc123-s1', 2)] }, exitCode: 0 })
      .mockResolvedValueOnce({ wave: { waveId: 'abc123-s1r1',
        legs: [usableLeg('deepseek', 'abc123-s1r1', 1),
          usableLeg('deepseek', 'abc123-s1r1', 2)] }, exitCode: 0 });
    const r = await runStage1(ctx);
    expect(ctx.launchers.launchWave.mock.calls[1][0].models).toEqual(['deepseek', 'deepseek']);
    expect(ctx._notes.map(n => n.channel)).toEqual(['stage1-retry', 'stage1-retry']);
    expect(r.degraded).toBe(false);
    expect(r.reviews).toHaveLength(2);
  });

  test('H4: a retry abort after ONE twin healed keeps the OTHER twin in deadLegs', async () => {
    // Lens mode makes each twin its own retry unit, so unit 1 can heal before
    // unit 2 aborts. run-stages.js's `healed` set is OUTSIDE run-retry.js and
    // was alias-keyed: it marks BOTH twins healed the moment one of them is,
    // and run.js persists that return into stage-1 state — the still-dead twin
    // disappears from the record as if it had reviewed.
    let solo = 0;
    const ctx = makeCtx({ models: ['deepseek', 'deepseek'], lenses: ['risk', 'cost'],
      onSolo: (opts) => {
        solo += 1;
        if (solo <= 2) { // first pass: both lens solos die
          return { wave: { waveId: opts.waveId,
            legs: [deadLeg('deepseek', undefined, undefined, opts.waveId, 1)] }, exitCode: 0 };
        }
        if (solo === 3) { // lens-1 retry heals
          return { wave: { waveId: opts.waveId,
            legs: [mkLeg('deepseek', review(), 'complete', opts.waveId, 1)] }, exitCode: 0 };
        }
        return { wave: null, exitCode: 130 }; // lens-2 retry aborts
      } });
    const r = await runStage1(ctx);
    expect(r.aborted).toBe(130);
    expect(r.deadLegs.map(l => l.waveId)).toEqual(['abc123-l2']);
  });
});

// ---- v4.8 PR2b Task 7 (R-B): a launched seat whose leg never came back ----
//
// The class this block owns is invisible before it: the wave DID return legs,
// just not this seat's, so the loss lands in neither deadLegs (no leg object
// exists) nor deadWaves (the wave produced legs). It is routed into the retry as
// a single-seat `partial` dead wave, and — per the SL-2 invariant at
// run-stages.js:77-78 — announced ONLY when the retry does not save it.
describe('v4.8 PR2b Task 7: an unbound seat is retried, then announced', () => {
  test('a partial wave return is retried, and healing it emits NO degrade', async () => {
    // roster (-s1): ['a','b'] -> a=slot1, b=slot2. Only a's leg comes back, so
    // seat b is unbound. retry roster (-s1r1): ['b'] alone -> slot1.
    const ctx = makeCtx({ models: ['a', 'b'] });
    ctx.launchers.launchWave
      .mockResolvedValueOnce({ wave: { waveId: 'abc123-s1',
        legs: [usableLeg('a', 'abc123-s1', 1)] }, exitCode: 0 })
      .mockResolvedValueOnce({ wave: { waveId: 'abc123-s1r1',
        legs: [usableLeg('b', 'abc123-s1r1', 1)] }, exitCode: 0 });
    const r = await runStage1(ctx);
    expect(ctx.launchers.launchWave).toHaveBeenCalledTimes(2);
    expect(ctx.launchers.launchWave.mock.calls[1][0].models).toEqual(['b']);
    expect(r.reviews.map(x => x.model).sort()).toEqual(['a', 'b']);
    expect(r.degraded).toBe(false);
    // ctx._notes holds the RAW note argument, and no degrade builder in this
    // path sets `kind` (it is defaulted inside makeDegrade, which this stub sink
    // never calls) — so assert on the channels that actually appear.
    expect(ctx._notes.map(n => n.channel)).toEqual(['stage1-retry']);
    expect(ctx._notes.filter(n => n.kind !== 'heal')).toEqual([]);
    // The heal's own prose: a `missing` first failure has no `status`, so
    // without its arm this reads "its first leg ended 'undefined'" for a seat
    // that never had a leg at all.
    expect(ctx._notes[0].why).toContain('returned 1 of 2 legs');
    expect(ctx._notes[0].why).not.toContain("ended 'undefined'");
  });

  test('a partial return the retry cannot save degrades on seat-unbound, with honest prose', async () => {
    // The RETRY wave must not return anything bindable to b: an 'a'-labelled leg
    // stamped `${waveId}-1` would bind to b BY SLOT and heal. An off-roster alias
    // in an out-of-range slot is an orphan, so b reaches the reconcile loop as a
    // still-missing seat and missingLegStillDeadNote is what fires.
    const ctx = makeCtx({ models: ['a', 'b'] });
    ctx.launchers.launchWave
      .mockResolvedValueOnce({ wave: { waveId: 'abc123-s1',
        legs: [usableLeg('a', 'abc123-s1', 1)] }, exitCode: 0 })
      .mockResolvedValueOnce({ wave: { waveId: 'abc123-s1r1',
        legs: [usableLeg('zzz', 'abc123-s1r1', 9)] }, exitCode: 0 });
    const r = await runStage1(ctx);
    expect(r.degraded).toBe(true);
    const note = ctx._notes.find(n => n.channel === 'seat-unbound' && n.data.seat === 'b');
    expect(note).toBeDefined();
    expect(note.what).toBe('seat b did not review');
    expect(note.why).toContain('returned 1 of 2 legs');
    expect(note.why).not.toContain('produced no legs');   // the first wave DID produce legs
    expect(note.why).not.toContain("ended 'undefined'");  // there was never a leg for this seat
    // The count is SEATS, not returned legs: legs.length alone would render
    // "1 of 1 seats reviewed" in the same breath as a degrade.
    expect(note.effect).toBe('1 of 2 seats reviewed; the run continues with the bench that did '
      + 'and will exit degraded (2)');
    // Both shapes of the join failure share the channel: the unbindable retry
    // leg is announced as an orphan alongside b's loss, never instead of it.
    expect(ctx._notes.some(n => n.channel === 'seat-unbound' && n.data.seat === 'zzz')).toBe(true);
  });

  test('a budget-SKIPPED partial seat is announced on seat-unbound, with no retry launch', async () => {
    // The third emission site (run-stages.js's skippedDeadWaves loop): the loss
    // is real, the retry was never affordable, and the plain dead-wave sentence
    // would still be false about a wave that produced a's leg.
    const ctx = makeCtx({ models: ['a', 'b'], overBudget: () => true });
    ctx.launchers.launchWave.mockResolvedValueOnce({ wave: { waveId: 'abc123-s1',
      legs: [usableLeg('a', 'abc123-s1', 1)] }, exitCode: 0 });
    const r = await runStage1(ctx);
    expect(ctx.launchers.launchWave).toHaveBeenCalledTimes(1);   // skipped: no paid retry
    const note = ctx._notes.find(n => n.channel === 'seat-unbound');
    expect(note.what).toBe('seat b did not review');
    expect(note.why).toBe("the wave returned 1 of 2 legs and none of them was this seat's");
    expect(note.data).toEqual({ waveId: 'abc123-s1', models: ['b'],
      reason: "the wave returned 1 of 2 legs and none of them was this seat's", seat: 'b' });
    expect(r.degraded).toBe(true);
  });

  test('a budget-SKIPPED run counts the MISSING seat in the dead-leg denominator', async () => {
    // Fix round 1, finding (1). Same budget-skip fixture, one seat wider: a
    // reviews, b's leg comes back dead, c's never comes back at all. Both losses
    // are announced in the same run, so the two notes must agree about how many
    // seats there were — `legs.length` alone counts only what RETURNED and says
    // "1 of 2" beside two separate losses.
    const ctx = makeCtx({ models: ['a', 'b', 'c'], overBudget: () => true });
    ctx.launchers.launchWave.mockResolvedValueOnce({ wave: { waveId: 'abc123-s1',
      legs: [usableLeg('a', 'abc123-s1', 1),
        deadLeg('b', undefined, undefined, 'abc123-s1', 2)] }, exitCode: 0 });
    const r = await runStage1(ctx);
    const legNote = ctx._notes.find(n => n.channel === 'dead-leg');
    expect(legNote.effect).toBe('1 of 3 seats reviewed; the run continues with the bench that did '
      + 'and will exit degraded (2)');
    const seatNote = ctx._notes.find(n => n.channel === 'seat-unbound');
    expect(seatNote.what).toBe('seat c did not review');
    expect(seatNote.why).toBe("the wave returned 2 of 3 legs and none of them was this seat's");
    expect(r.degraded).toBe(true);
  });

  test('a partial seat whose RETRY WAVE dies wholesale keeps the honest wave sentence', async () => {
    // waveStillDeadNote's arm: the plain dead-wave sentence would claim wave
    // abc123-s1 "produced NO legs", which is demonstrably false — it produced a's.
    const ctx = makeCtx({ models: ['a', 'b'] });
    ctx.launchers.launchWave
      .mockResolvedValueOnce({ wave: { waveId: 'abc123-s1',
        legs: [usableLeg('a', 'abc123-s1', 1)] }, exitCode: 0 })
      .mockResolvedValueOnce({ wave: { waveId: 'abc123-s1r1', legs: [] }, exitCode: 1 });
    const r = await runStage1(ctx);
    expect(r.degraded).toBe(true);
    expect(ctx._notes.some(n => n.channel === 'dead-wave')).toBe(false);
    const note = ctx._notes.find(n => n.channel === 'seat-unbound');
    expect(note.what).toBe('seat b did not review');
    expect(note.why).toContain('returned 1 of 2 legs');
    expect(note.why).toContain('the once-only retry wave also produced no legs');
    expect(note.data.seat).toBe('b');
    expect(note.data.retryWaveId).toBe('abc123-s1r1');
  });

  test('NEGATIVE PIN: a WHOLLY dead wave emits exactly one dead-wave note and ZERO seat-unbound', async () => {
    // bindStage1Waves skips zero-leg waves precisely so a dead wave is never
    // also re-announced seat by seat. A regression here is invisible without
    // this pin — the run would simply grow N extra notes.
    const ctx = makeCtx({ models: ['a', 'b'] });
    ctx.launchers.launchWave
      .mockResolvedValueOnce({ wave: { waveId: 'abc123-s1', legs: [], reason: 'server never started' }, exitCode: 1 })
      .mockResolvedValueOnce({ wave: { waveId: 'abc123-s1r1', legs: [] }, exitCode: 1 });
    const r = await runStage1(ctx);
    expect(ctx._notes.filter(n => n.channel === 'dead-wave')).toHaveLength(1);
    expect(ctx._notes.filter(n => n.channel === 'seat-unbound')).toHaveLength(0);
    expect(ctx._notes[0].what).toBe('Stage-1 wave abc123-s1 (a, b) produced NO legs');
    expect(r.degraded).toBe(true);
  });

  test('NEGATIVE PIN: two seats lost from ONE wave reconcile into ONE stillDeadWaves entry', async () => {
    // roster (-s1): a=1, b=2, c=3; only a's leg returns, so b and c are BOTH
    // unbound and become two single-seat `partial` records sharing waveId
    // abc123-s1. retry roster (-s1r1): ['b','c'] -> b=slot1, c=slot2; b's retry
    // leg comes back dead and c's never comes back at all, so the two halves of
    // the still-lost path (leg loop + reconcile loop) both fire for one wave.
    const ctx = makeCtx({ models: ['a', 'b', 'c'] });
    ctx.launchers.launchWave
      .mockResolvedValueOnce({ wave: { waveId: 'abc123-s1',
        legs: [usableLeg('a', 'abc123-s1', 1)] }, exitCode: 0 })
      .mockResolvedValueOnce({ wave: { waveId: 'abc123-s1r1',
        legs: [deadLeg('b', undefined, undefined, 'abc123-s1r1', 1)] }, exitCode: 0 });
    const r = await runStage1(ctx);
    expect(r.deadWaves).toHaveLength(1);                       // the `reconciled` Set collapses the repeated waveId
    expect(r.deadWaves[0].waveId).toBe('abc123-s1');
    expect(r.deadWaves[0].models).toEqual(['b', 'c']);
    expect(r.deadWaves[0].seats.map(s => s && s.id)).toEqual(['b', 'c']);
    expect(r.reviews.map(x => x.model)).toEqual(['a']);
    expect(r.degraded).toBe(true);
  });

  test('CARRY (Task 6 Minor 1): an UNBINDABLE retry leg keeps the roster seat on the still-dead record', async () => {
    // The retry leg is unbindable (its taskId names no slot of -s1r1 and it
    // carries no waveId stamp, so the alias path is refused too). The leg loop
    // is still reached — `key` is in `launched` — so the record must fall back
    // to the launched seat instead of publishing seats:[null] where the roster
    // slot was known all along.
    const ctx = makeCtx({ models: ['a', 'b'] });
    ctx.launchers.launchWave
      .mockResolvedValueOnce({ wave: { waveId: 'abc123-s1',
        legs: [usableLeg('a', 'abc123-s1', 1)] }, exitCode: 0 })
      .mockResolvedValueOnce({ wave: { waveId: 'abc123-s1r1',
        legs: [{ ...deadLeg('b'), taskId: 'stray-1' }] }, exitCode: 0 });
    const r = await runStage1(ctx);
    expect(r.deadWaves).toHaveLength(1);
    expect(r.deadWaves[0].models).toEqual(['b']);
    expect(r.deadWaves[0].seats.map(s => s && s.id)).toEqual(['b']);
  });

  test('REQUIRED PIN (no third leg): a wave with an orphan leg never ALSO retries its unbound seat', async () => {
    // stage1-bind.js:40's `strays.length > 0` clause. Post-H4 a wave record and a
    // leg record for one alias no longer collapse, so relaxing that guard would
    // grow the bench retry unit a THIRD slot and buy a paid leg whose output is
    // unattributable. One bound leg + one orphan + one unbound seat must yield
    // ZERO missing seats: exactly one wave is ever launched.
    const ctx = makeCtx({ models: ['a', 'b'] });
    ctx.launchers.launchWave.mockResolvedValueOnce({ wave: { waveId: 'abc123-s1',
      legs: [usableLeg('a', 'abc123-s1', 1),
        { ...usableLeg('zzz', 'abc123-s1', 9), taskId: 'stray-1' }] }, exitCode: 0 });
    const r = await runStage1(ctx);
    expect(ctx.launchers.launchWave).toHaveBeenCalledTimes(1);   // no retry — no third paid leg
    const unbound = ctx._notes.filter(n => n.channel === 'seat-unbound');
    expect(unbound).toHaveLength(1);
    expect(unbound[0].data.legId).toBe('stray-1');               // the ORPHAN, announced at bind time
    expect(ctx._notes.some(n => /seat b did not review/.test(n.what))).toBe(false);
    expect(r.degraded).toBe(false);
  });

  test('CARRY (Task 6 minor): a twin bench retry with ONE seat bound and one not heals exactly one twin', async () => {
    // Both twins die on the first pass, so the retry launches for [#1, #2].
    // Its response binds slot 1 to deepseek#1 and carries a second leg nothing
    // can attribute — an alias is no longer a seat identity, so it must NOT be
    // adopted by #2. #1 heals; #2 stays dead through its own srcLeg.
    const ctx = makeCtx({ models: ['deepseek', 'deepseek'] });
    ctx.launchers.launchWave
      .mockResolvedValueOnce({ wave: { waveId: 'abc123-s1',
        legs: [deadLeg('deepseek', undefined, undefined, 'abc123-s1', 1),
          deadLeg('deepseek', undefined, undefined, 'abc123-s1', 2)] }, exitCode: 0 })
      .mockResolvedValueOnce({ wave: { waveId: 'abc123-s1r1',
        legs: [usableLeg('deepseek', 'abc123-s1r1', 1),
          { ...usableLeg('deepseek'), taskId: 'stray-1' }] }, exitCode: 0 });
    const r = await runStage1(ctx);
    const heals = ctx._notes.filter(n => n.kind === 'heal');
    expect(heals).toHaveLength(1);
    expect(r.reviews).toHaveLength(1);
    expect(r.deadLegs).toHaveLength(1);
    expect(r.deadLegs[0].taskId).toBe('abc123-s1-2');            // the SECOND twin's own first leg
    expect(r.degraded).toBe(true);
  });
});

describe('Task 4: extraRows — repair, dead-seat error, superseded (v4.7 D2/E4)', () => {
  test('a repair launch gets its own extraRows row: role repair, its own waveId, usage attributed', async () => {
    const ctx = makeCtx({
      onWave: (opts) => okWave(opts.models.map((m, i) =>
        mkLeg(m, m === 'gpt' ? 'prose without json' : review(m), 'complete', opts.waveId, i + 1))),
      onSolo: (opts) => okWave([mkLeg('gpt', review('gpt'), 'complete', opts.waveId, 1)]),
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
      onWave: (opts) => okWave(opts.models.map((m, i) => mkLeg(m, 'prose without json', 'complete', opts.waveId, i + 1))),
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

// ---- v4.8 PR2b Task 8: dead-seat rows key on the SEAT, not the alias ----
// run-cost-bijection.test.js's six scenarios are all UNIQUE-alias benches — it
// will pass whether or not the twin accounting is right. These are the twin gate.
describe('Task 8: dead-seat rows key on the seat (v4.8 PR2b)', () => {
  const primaryRows = (r) => r.extraRows.filter(x => x.role !== 'repair' && x.role !== 'superseded');

  test('two dead twin seats produce TWO dead-seat rows, not one', async () => {
    const ctx = makeCtx({ models: ['deepseek', 'deepseek'] });
    // roster (-s1): #1=slot1, #2=slot2; retry roster (-s1r1): the same two, same order.
    ctx.launchers.launchWave
      .mockResolvedValueOnce({ wave: { waveId: 'abc123-s1',
        legs: [deadLeg('deepseek', undefined, undefined, 'abc123-s1', 1),
          deadLeg('deepseek', undefined, undefined, 'abc123-s1', 2)] }, exitCode: 0 })
      .mockResolvedValueOnce({ wave: { waveId: 'abc123-s1r1',
        legs: [deadLeg('deepseek', 'timed-out', null, 'abc123-s1r1', 1),
          deadLeg('deepseek', 'timed-out', null, 'abc123-s1r1', 2)] }, exitCode: 0 });
    const r = await runStage1(ctx);
    const primary = primaryRows(r);
    expect(primary).toHaveLength(2);
    // ⚠️ spec §4.7: the ledger row keeps the ALIAS — pickFallbackChair launches
    // top.aliases[0] and 'deepseek#2' is not routable. Two rows both reading
    // 'deepseek' is the CORRECT count; (model, resolvedModel) grouping is PR4.
    expect(primary.every(x => x.model === 'deepseek')).toBe(true);
    expect(primary.map(x => x.waveId)).toEqual(['abc123-s1r1', 'abc123-s1r1']);
    expect(primary.every(x => x.status === 'timed-out')).toBe(true);
    expect(r.extraRows.filter(x => x.role === 'superseded')).toHaveLength(2);
  });

  test('two dead twins whose retry wave dies wholesale get TWO leg-less rows (no first-leg phantom)', async () => {
    // Gates `retry.attemptedSeats` being SEAT-keyed: derived from the notes
    // instead, `data.seat` is alias-valued, so neither twin's seat id would
    // match and each row would re-attach its own first-attempt leg.
    const ctx = makeCtx({ models: ['deepseek', 'deepseek'] });
    ctx.launchers.launchWave
      .mockResolvedValueOnce({ wave: { waveId: 'abc123-s1',
        legs: [deadLeg('deepseek', undefined, undefined, 'abc123-s1', 1),
          deadLeg('deepseek', undefined, undefined, 'abc123-s1', 2)] }, exitCode: 0 })
      .mockResolvedValueOnce({ wave: { waveId: 'abc123-s1r1', legs: [] }, exitCode: 0 });
    const r = await runStage1(ctx);
    const primary = primaryRows(r);
    expect(primary).toHaveLength(2);
    expect(primary.every(x => !('waveId' in x))).toBe(true);      // no real leg backs either row
    expect(primary.every(x => x.usage === null)).toBe(true);
    expect(r.extraRows.filter(x => x.role === 'superseded')).toHaveLength(2);
  });

  test('a partially healed dead wave yields exactly ONE dead-seat row, for the seat that stayed lost', async () => {
    const ctx = makeCtx({ models: ['a', 'b'] });
    // The whole -s1 wave dies; the retry names only 'a', so 'b' stays lost.
    ctx.launchers.launchWave
      .mockResolvedValueOnce({ wave: { waveId: 'abc123-s1', legs: [] }, exitCode: 0 })
      .mockResolvedValueOnce({ wave: { waveId: 'abc123-s1r1',
        legs: [usableLeg('a', 'abc123-s1r1', 1)] }, exitCode: 0 });
    const r = await runStage1(ctx);
    const primary = primaryRows(r);
    expect(primary).toHaveLength(1);
    expect(primary[0].model).toBe('b');
  });

  test('CARRY (a): a healed twin\'s first leg is never borrowed by its still-lost sibling', async () => {
    // The -s1 wave returns ONE leg (slot 1 => deepseek#1, dead); deepseek#2's
    // leg never comes back, so it reaches the retry as a `partial` dead wave
    // whose still-dead note rides `seat-unbound`, NOT `dead-leg`. The retry
    // heals #1 only. Alias-keyed, #2's row would borrow #1's first leg — a
    // phantom waveId/status pairing on a seat that never had a leg at all.
    const ctx = makeCtx({ models: ['deepseek', 'deepseek'] });
    // retry roster (-s1r1): wave-origin losses are grouped BEFORE leg-origin
    // ones, so slot1=#2 (the missing seat) and slot2=#1 (the dead leg).
    ctx.launchers.launchWave
      .mockResolvedValueOnce({ wave: { waveId: 'abc123-s1',
        legs: [deadLeg('deepseek', undefined, undefined, 'abc123-s1', 1)] }, exitCode: 0 })
      .mockResolvedValueOnce({ wave: { waveId: 'abc123-s1r1',
        legs: [usableLeg('deepseek', 'abc123-s1r1', 2)] }, exitCode: 0 });
    const r = await runStage1(ctx);
    expect(r.reviews).toHaveLength(1);                            // #1 healed
    const primary = primaryRows(r);
    expect(primary).toHaveLength(1);                              // #2 alone stayed lost
    expect(primary[0].model).toBe('deepseek');
    expect('waveId' in primary[0]).toBe(false);                   // NOT borrowed from #1's first leg
    expect(primary[0].usage).toBeNull();
    expect(primary[0].durationMs).toBeNull();
    const superseded = r.extraRows.filter(x => x.role === 'superseded');
    expect(superseded).toHaveLength(1);                           // #1's first leg, and only that
    expect(superseded[0].waveId).toBe('abc123-s1');
  });

  test('a dead twin LENS seat gets its own lens role on its row (roleAt, not roleFor)', async () => {
    // roleFor's o.models.indexOf hands BOTH twins the first twin's lens.
    const ctx = makeCtx({ models: ['deepseek', 'deepseek'], lenses: ['risk', 'cost'],
      onSolo: (opts) => ({ wave: { waveId: opts.waveId, legs: [] }, exitCode: 0 }) });
    const r = await runStage1(ctx);
    const primary = primaryRows(r);
    expect(primary.map(x => x.role).sort()).toEqual(['lens:cost', 'lens:risk']);
    expect(primary.every(x => x.model === 'deepseek')).toBe(true);
  });
});

// ---- v4.8 PR4c Task 1 (plan §3.1): dead-seat rows name their SEAT ----
// pushDeadSeatRows is exported (run-stage1-rows.js:111), so both shapes are
// three-line fixtures over the REAL bindSeats/buildSeats rather than a scripted
// run. The two shapes are NOT symmetric and that asymmetry is the point:
//   bound   -> one row per seat, each stamped with its own seat id
//   orphaned-> deadSeats is a Map keyed by keyOf's ALIAS fallback, so two dead
//              twins collapse into ONE row and the stamp is inert there
//              (pre-existing collapse; plan §4.6 lists it as a shape PR4c does
//              NOT close). Revision 1's T12 was satisfiable on the bound path
//              alone, which is precisely the false confidence this pins away.
describe('v4.8 PR4c: runStats[].seat on the dead-seat rows (§3.1, T12/T14)', () => {
  const SEATS = buildSeats(['deepseek', 'deepseek', 'gpt'], null, null);
  const twinLeg = (waveId, slot) => ({
    taskId: waveId != null ? `${waveId}-${slot}` : 'deepseek-orphan',
    model: 'deepseek', modelInput: 'deepseek', status: 'error', summary: '',
    durationMs: null, usage: null, ...(waveId != null ? { waveId } : {}),
  });
  const noRetry = () => ({ recoveredLegs: [], stillDeadLegs: [], stillDeadRetryLegs: [],
    attemptedSeats: new Set() });
  const roleFor = () => 'seat';
  // ⚠️ v4.8 T2.2: `o` carries the REAL roster, never `{}`. run-stages.js's call site
  // passes `ctx.o`, which run.js populates with `o.seats = seatPre.seats`, and the
  // roster is the only evidence that two losses on one alias are two seats. Measured
  // with `o: {}` these fixtures reported success both for a change that does nothing
  // and for a change that works — they could not express the twin case at all.
  const run = (args) => {
    const extraRows = [];
    pushDeadSeatRows({ o: { seats: SEATS }, deadLegs0: [], stillDeadWaves: [], roleFor,
      extraRows, retry: noRetry(), ...args });
    return extraRows;
  };

  test('T12: two BOUND dead twin seats get TWO rows, each stamped with its OWN seat id', () => {
    const legs = [twinLeg('w', 1), twinLeg('w', 2)];
    const { bound } = bindSeats('w', SEATS.slice(0, 2), legs);
    expect(bound.map(b => b.seat.id)).toEqual(['deepseek#1', 'deepseek#2']);
    const rows = run({ stillDeadLegs: legs, seatOf: new Map(bound.map(b => [b.leg, b.seat])) });
    expect(rows.map(r => r.model)).toEqual(['deepseek', 'deepseek']);   // §4.7: the ALIAS stays routable
    expect(rows.map(r => r.seat)).toEqual(['deepseek#1', 'deepseek#2']);
  });

  test('T12: two ORPHANED twin seats collapse to ONE row that carries NO seat (§4.6, pre-existing)', () => {
    // Two DISTINCT non-conforming ids, not one shared literal. Production mints a
    // unique taskId per launched slot (src/sidecar/leg-ids.js), so a shared id was a
    // shape the producer cannot emit — and it hid the one distinguisher these legs
    // actually carry. Measured: both spellings leave bindSeats with bound=[] and two
    // orphan legs, so the fixture still pins the ORPHANED path it was written for.
    const legs = [{ ...twinLeg(), taskId: 'orphan-a' }, { ...twinLeg(), taskId: 'orphan-b' }];
    const { bound, unbound } = bindSeats('w', SEATS.slice(0, 2), legs);
    expect(bound).toEqual([]);                        // the alias fallback needs hits.length === 1
    expect(unbound.map(s => s.id)).toEqual(['deepseek#1', 'deepseek#2']);
    const rows = run({ stillDeadLegs: legs, seatOf: new Map() });
    expect(rows).toHaveLength(1);                     // ONE row for TWO paid seats
    expect('seat' in rows[0]).toBe(false);            // …and the stamp is inert, not wrong
  });

  test('T12: a bound seat on a UNIQUE-alias bench emits no seat key (byte parity)', () => {
    const legs = [{ ...twinLeg('w', 1), model: 'gpt', modelInput: 'gpt' }];
    const { bound } = bindSeats('w', [SEATS[2]], legs);
    const rows = run({ stillDeadLegs: legs, seatOf: new Map(bound.map(b => [b.leg, b.seat])) });
    expect(rows).toHaveLength(1);
    expect('seat' in rows[0]).toBe(false);
  });

  test('T14: a superseded row carries NO seat, even on a twin bench', () => {
    // Role `superseded` is excluded by joinsLedger (ledger.js:49-53), so it can
    // never win the ledger join — stamping it would put a seat id in a row no
    // seat-aware consumer ever reads. The SAME call emits stamped dead-seat rows
    // from the same seat table, so this is a scoping pin, not an inert fixture.
    const first = [twinLeg('w', 1), twinLeg('w', 2)];
    const retryLegs = [twinLeg('r', 1), twinLeg('r', 2)];
    const seatOf = new Map([...bindSeats('w', SEATS.slice(0, 2), first).bound,
      ...bindSeats('r', SEATS.slice(0, 2), retryLegs).bound].map(b => [b.leg, b.seat]));
    const rows = run({ deadLegs0: first, stillDeadLegs: retryLegs, seatOf,
      retry: { recoveredLegs: [], stillDeadLegs: retryLegs, stillDeadRetryLegs: retryLegs,
        attemptedSeats: new Set(['deepseek#1', 'deepseek#2']) } });
    const superseded = rows.filter(r => r.role === 'superseded');
    expect(superseded).toHaveLength(2);
    for (const r of superseded) { expect('seat' in r).toBe(false); }
    expect(rows.filter(r => r.role === 'seat').map(r => r.seat))
      .toEqual(['deepseek#1', 'deepseek#2']);
  });
});

describe('runStage2', () => {
  function stage1Reviews() {
    // v4.8 PR3 Task 2: seat: per entry, mirroring Task 3's production shape —
    // built positionally from the same bench these reviews are for.
    const stage1Seats = buildSeats(['gemini', 'gpt'], null, null);
    return [
      { model: 'gemini', modelInput: 'gemini', role: 'seat', text: review('gemini'),
        findings: [{ id: 1, severity: 'major', claim: 'c', location: 'l', rationale: 'r' }],
        conformance: 'clean', leg: mkLeg('gemini', review('gemini')), seat: stage1Seats[0] },
      { model: 'gpt', modelInput: 'gpt', role: 'seat', text: review('gpt'),
        findings: [{ id: 1, severity: 'nit', claim: 'c', location: 'l', rationale: 'r' }],
        conformance: 'clean', leg: mkLeg('gpt', review('gpt')), seat: stage1Seats[1] },
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
            [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'neutral' }]), 'complete', opts.waveId, 1),
          mkLeg('gpt', judgeOut(['Review A', 'Review B'],
            [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'dispute' }]), 'complete', opts.waveId, 2),
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
      onWave: (opts) => okWave([
        mkLeg('gemini', judgeOut(['Review B', 'Review A'],
          [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'neutral' }]), 'complete', opts.waveId, 1),
        mkLeg('gpt', judgeOut(['Review A', 'Review B'],
          [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'dispute' }]), 'complete', opts.waveId, 2),
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
      onWave: (opts) => okWave([
        mkLeg('gemini', 'no json', 'complete', opts.waveId, 1),
        mkLeg('gpt', judgeOut(['Review A', 'Review B'], [{ id: 'A1', verdict: 'agree' }]), 'complete', opts.waveId, 2),
      ]),
      onSolo: (opts) => {
        solos.push(opts);
        return okWave([mkLeg('gemini', judgeOut(['Review B', 'Review A'], [{ id: 'B1', verdict: 'agree' }]), 'complete', opts.waveId, 1)]);
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
      onWave: (opts) => okWave([
        mkLeg('gemini', badJudge, 'complete', opts.waveId, 1),
        mkLeg('gpt', judgeOut(['Review A', 'Review B'], [{ id: 'A1', verdict: 'agree' }]), 'complete', opts.waveId, 2),
      ]),
      onSolo: (opts) => {
        solos.push(opts);
        return okWave([mkLeg('gemini', judgeOut(['Review B', 'Review A'], [{ id: 'B1', verdict: 'agree' }]), 'complete', opts.waveId, 1)]);
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
      onWave: (opts) => okWave([
        mkLeg('gemini', badJudge, 'complete', opts.waveId, 1),
        mkLeg('gpt', judgeOut(['Review A', 'Review B'], [{ id: 'A1', verdict: 'agree' }]), 'complete', opts.waveId, 2),
      ]),
      onSolo: (opts) => {
        solos.push(opts);
        return okWave([mkLeg('gemini', solos.length === 1 ? firstRepair : 'second repair, still no json', 'complete', opts.waveId, 1)]);
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
      onWave: (opts) => okWave([
        mkLeg('gemini', badJudge, 'complete', opts.waveId, 1),
        mkLeg('gpt', judgeOut(['Review A', 'Review B'], [{ id: 'A1', verdict: 'agree' }]), 'complete', opts.waveId, 2),
      ]),
      onSolo: (opts) => { solos.push(opts); return okWave([mkLeg('gemini', '', 'complete', opts.waveId, 1)]); },
    });
    await runStage2(ctx, { reviews: stage1Reviews(), labels, globalFindings });
    expect(solos).toHaveLength(2);
    expect(solos[1].prompt).toContain(badJudge);
  });

  test('judge still bad after 2 repairs → ok false, conformance unstructured', async () => {
    let soloCount = 0;
    const ctx = makeCtx({
      models: ['gemini', 'gpt'],
      onWave: (opts) => okWave([
        mkLeg('gemini', 'never json', 'complete', opts.waveId, 1),
        mkLeg('gpt', judgeOut(['Review A', 'Review B'], [{ id: 'A1', verdict: 'agree' }]), 'complete', opts.waveId, 2),
      ]),
      onSolo: (opts) => { soloCount += 1; return okWave([mkLeg('gemini', 'still bad', 'complete', opts.waveId, 1)]); },
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
      onWave: (opts) => okWave([
        mkLeg('gemini', 'no json', 'complete', opts.waveId, 1),
        mkLeg('gpt', judgeOut(['Review A', 'Review B'], [{ id: 'A1', verdict: 'agree' }]), 'complete', opts.waveId, 2),
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
      onWave: (opts) => okWave([
        mkLeg('gemini', '', 'complete', opts.waveId, 1),   // status 'complete' (default), summary empty
        mkLeg('gpt', judgeOut(['Review A', 'Review B'], [{ id: 'A1', verdict: 'agree' }]), 'complete', opts.waveId, 2),
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
      onWave: (opts) => okWave([
        mkLeg('gemini', '', 'timeout', opts.waveId, 1),
        mkLeg('gpt', judgeOut(['Review A', 'Review B'], [{ id: 'A1', verdict: 'agree' }]), 'complete', opts.waveId, 2),
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
      onWave: (opts) => okWave([
        mkLeg('gemini', 'no json', 'complete', opts.waveId, 1),
        mkLeg('gpt', judgeOut(['Review A', 'Review B'], [{ id: 'A1', verdict: 'agree' }]), 'complete', opts.waveId, 2),
      ]),
      onSolo: (opts) => okWave([mkLeg('gemini',
        judgeOut(['Review B', 'Review A'], [{ id: 'B1', verdict: 'agree' }]), 'complete', opts.waveId, 1)]),
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
      onWave: (opts) => okWave([
        mkLeg('gemini', 'never json', 'complete', opts.waveId, 1),
        mkLeg('gpt', judgeOut(['Review A', 'Review B'], [{ id: 'A1', verdict: 'agree' }]), 'complete', opts.waveId, 2),
      ]),
      onSolo: (opts) => okWave([deadLeg('gemini', 'error', 'boom', opts.waveId, 1)]),
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
      onWave: (opts) => okWave([
        mkLeg('gemini', judgeOut(['Review B', 'Review A'],
          [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'agree' }]), 'complete', opts.waveId, 1),
        mkLeg('gpt', judgeOut(['Review A', 'Review B'],
          [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'agree' }]), 'complete', opts.waveId, 2),
      ]),
      onSolo: () => { throw new Error('no repairs expected'); },
    });
    await runStage2(ctx, { reviews: stage1Reviews(), labels, globalFindings });
    const bundle = fs.readFileSync(path.join(ctx.o.runDir, 'bundle-stage2.md'), 'utf-8');
    expect(bundle).toContain("Today's date is 2026-07-19.");
    expect(bundle.split('\n')[0]).toBe(s2.JUDGE_NO_TOOLS_PREAMBLE);  // preamble is still line 1
  });

  // v4.8 PR3 Task 4: the seat reaches Stage 2. A twin bench's reviews each carry
  // their OWN seat (buildSeats(['deepseek','deepseek'], null, null) — 'deepseek#1'
  // / 'deepseek#2') built the same positional way Task 2's stage1Reviews() does.
  describe('PR3 Task 4: judge artifacts + judgeResults carry the SEAT (twin bench)', () => {
    function twinReviews() {
      const twinSeats = buildSeats(['deepseek', 'deepseek'], null, null);
      return [
        { model: 'deepseek', modelInput: 'deepseek', role: 'seat', text: review('deepseek-1'),
          findings: [{ id: 1, severity: 'major', claim: 'c', location: 'l', rationale: 'r' }],
          conformance: 'clean', leg: mkLeg('deepseek', review('deepseek-1')), seat: twinSeats[0] },
        { model: 'deepseek', modelInput: 'deepseek', role: 'seat', text: review('deepseek-2'),
          findings: [{ id: 1, severity: 'nit', claim: 'c', location: 'l', rationale: 'r' }],
          conformance: 'clean', leg: mkLeg('deepseek', review('deepseek-2')), seat: twinSeats[1] },
      ];
    }
    const twinLabels = assignLabels(['deepseek', 'deepseek']);
    const twinGlobalFindings = [
      ...toGlobalFindings('A', 'deepseek', [{ id: 1, severity: 'major', claim: 'c' }]),
      ...toGlobalFindings('B', 'deepseek', [{ id: 1, severity: 'nit', claim: 'c' }]),
    ];

    test('RED1: a twin bench writes TWO judge files (judge-deepseek-1.md, judge-deepseek-2.md)', async () => {
      // RED today (measured): the run dir contains only ["judge-deepseek.md"] —
      // one file for two judges, the second twin's judge-output clobbering the
      // first's under the shared alias filename.
      const ctx = makeCtx({
        models: ['deepseek', 'deepseek'],
        onWave: (opts) => okWave([
          mkLeg('deepseek', judgeOut(['Review B', 'Review A'],
            [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'neutral' }]), 'complete', opts.waveId, 1),
          mkLeg('deepseek', judgeOut(['Review A', 'Review B'],
            [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'dispute' }]), 'complete', opts.waveId, 2),
        ]),
        onSolo: () => { throw new Error('no repairs expected'); },
      });
      await runStage2(ctx, { reviews: twinReviews(), labels: twinLabels, globalFindings: twinGlobalFindings });
      const judgeFiles = fs.readdirSync(ctx.o.runDir).filter(f => f.startsWith('judge-')).sort();
      expect(judgeFiles).toEqual(['judge-deepseek-1.md', 'judge-deepseek-2.md']);
    });

    test('RED2: judgeResults[] carries a distinct seat per twin; judge stays the alias on both', async () => {
      const ctx = makeCtx({
        models: ['deepseek', 'deepseek'],
        onWave: (opts) => okWave([
          mkLeg('deepseek', judgeOut(['Review B', 'Review A'],
            [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'neutral' }]), 'complete', opts.waveId, 1),
          mkLeg('deepseek', judgeOut(['Review A', 'Review B'],
            [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'dispute' }]), 'complete', opts.waveId, 2),
        ]),
        onSolo: () => { throw new Error('no repairs expected'); },
      });
      const { judgeResults } = await runStage2(ctx,
        { reviews: twinReviews(), labels: twinLabels, globalFindings: twinGlobalFindings });
      expect(judgeResults).toHaveLength(2);
      expect(judgeResults.every(j => j.judge === 'deepseek')).toBe(true);       // launch alias unchanged
      expect(judgeResults.map(j => j.seat && j.seat.id)).toEqual(['deepseek#1', 'deepseek#2']);
    });

    test('parity: a unique bench still writes judge-gemini.md byte-identically (must stay GREEN)', async () => {
      const geminiOut = judgeOut(['Review B', 'Review A'],
        [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'neutral' }]);
      const ctx = makeCtx({
        models: ['gemini', 'gpt'],
        onWave: (opts) => okWave([
          mkLeg('gemini', geminiOut, 'complete', opts.waveId, 1),
          mkLeg('gpt', judgeOut(['Review A', 'Review B'],
            [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'dispute' }]), 'complete', opts.waveId, 2),
        ]),
        onSolo: () => { throw new Error('no repairs expected'); },
      });
      await runStage2(ctx, { reviews: stage1Reviews(), labels, globalFindings });
      const file = path.join(ctx.o.runDir, 'judge-gemini.md');
      expect(fs.existsSync(file)).toBe(true);
      expect(fs.readFileSync(file, 'utf-8')).toBe(geminiOut);
    });

    // Code-review Finding 1 (CRITICAL): `bindSeats(s2WaveId, roster, wave.legs)`
    // used to dereference `wave.legs` unguarded, but `wave` is legitimately
    // null on a budget/args refusal (run-budget.js's failPre returns
    // `{wave: null, exitCode: 1}`), and isAbortExit only catches 130/143 — so
    // execution reached the crash instead of returning early. Mirrors the
    // guard the leg loop already had (`(wave && wave.legs) || []`).
    test('Finding 1 regression: a refused -s2 wave (wave: null, exitCode: 1) does not throw and returns a notesless empty shape', async () => {
      const ctx = makeCtx({
        models: ['gemini', 'gpt'],
        // BUDGET_EXCEEDED/BAD_ARGS shape — a refusal, not an abort code.
        onWave: () => ({ wave: null, exitCode: 1 }),
        onSolo: () => { throw new Error('no repairs expected'); },
      });
      const result = await runStage2(ctx, { reviews: stage1Reviews(), labels, globalFindings });
      expect(result).toEqual({ aborted: null, judgeResults: [], extraRows: [] });
      expect(ctx._notes).toEqual([]);   // no spurious seat-unbound notes either
    });

    // Code-review Finding 2 (IMPORTANT): the "missing seat" loop used to have
    // no suppression rule, so an orphan leg (a judge that DID land, just
    // unattributable) ALSO got double-counted as a "seat never returned" —
    // false twice over (the leg did return; the wave returned exactly as many
    // legs as its roster). Mirrors stage1-bind.js:40's guard verbatim.
    test('Finding 2 regression: an orphan -s2 leg suppresses the false "missing seat" note (mirrors stage1-bind.js:40)', async () => {
      const ctx = makeCtx({
        models: ['deepseek', 'deepseek'],
        onWave: (opts) => okWave([
          // No waveId/slot -> taskId `deepseek-N` matches no roster slot AND
          // carries no waveId field, so the alias fallback (ambiguous: two
          // 'deepseek' seats) can't claim it either -> orphan.
          mkLeg('deepseek', judgeOut(['Review B', 'Review A'],
            [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'neutral' }])),
          // Bound normally to roster slot 2.
          mkLeg('deepseek', judgeOut(['Review A', 'Review B'],
            [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'dispute' }]), 'complete', opts.waveId, 2),
        ]),
        onSolo: () => { throw new Error('no repairs expected'); },
      });
      await runStage2(ctx, { reviews: twinReviews(), labels: twinLabels, globalFindings: twinGlobalFindings });
      // Exactly ONE seat-unbound note (the orphan leg) — never a second,
      // false "missing seat" note for the roster slot the orphan left unclaimed.
      expect(ctx._notes.map(n => n.channel)).toEqual(['seat-unbound']);
      expect('legId' in ctx._notes[0].data).toBe(true);   // the orphan-leg discriminator
    });

    // Code-review Finding 3 (promoted from Minor): the placeholder identity
    // rule (`placeholders.has(b.seat)`, never an id-name prefix test) had zero
    // coverage. A bench alias literally beginning `__unbound-` proves the
    // difference: mutating the check to `!b.seat.id.startsWith('__unbound-')`
    // would drop BOTH twins' real binds (their ids legitimately start with
    // that prefix), collapsing back to RED1's one-file bug.
    test('Finding 3: an adversarial "__unbound-"-prefixed alias still binds by seat IDENTITY, never by an id-name prefix test', async () => {
      const adversarialSeats = buildSeats(['__unbound-x', '__unbound-x'], null, null);
      const adversarialReviews = [
        { model: '__unbound-x', modelInput: '__unbound-x', role: 'seat', text: review('u1'),
          findings: [{ id: 1, severity: 'major', claim: 'c', location: 'l', rationale: 'r' }],
          conformance: 'clean', leg: mkLeg('__unbound-x', review('u1')), seat: adversarialSeats[0] },
        { model: '__unbound-x', modelInput: '__unbound-x', role: 'seat', text: review('u2'),
          findings: [{ id: 1, severity: 'nit', claim: 'c', location: 'l', rationale: 'r' }],
          conformance: 'clean', leg: mkLeg('__unbound-x', review('u2')), seat: adversarialSeats[1] },
      ];
      const advLabels = assignLabels(['__unbound-x', '__unbound-x']);
      const advGlobalFindings = [
        ...toGlobalFindings('A', '__unbound-x', [{ id: 1, severity: 'major', claim: 'c' }]),
        ...toGlobalFindings('B', '__unbound-x', [{ id: 1, severity: 'nit', claim: 'c' }]),
      ];
      const ctx = makeCtx({
        models: ['__unbound-x', '__unbound-x'],
        onWave: (opts) => okWave([
          mkLeg('__unbound-x', judgeOut(['Review B', 'Review A'],
            [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'neutral' }]), 'complete', opts.waveId, 1),
          mkLeg('__unbound-x', judgeOut(['Review A', 'Review B'],
            [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'dispute' }]), 'complete', opts.waveId, 2),
        ]),
        onSolo: () => { throw new Error('no repairs expected'); },
      });
      const { judgeResults } = await runStage2(ctx,
        { reviews: adversarialReviews, labels: advLabels, globalFindings: advGlobalFindings });
      const judgeFiles = fs.readdirSync(ctx.o.runDir).filter(f => f.startsWith('judge-')).sort();
      expect(judgeFiles).toEqual(['judge-__unbound-x-1.md', 'judge-__unbound-x-2.md']);
      expect(judgeResults.map(j => j.seat && j.seat.id)).toEqual(['__unbound-x#1', '__unbound-x#2']);
    });

    // ---- Final whole-branch review, F1 ------------------------------------
    // Finding 3 above pins identity-vs-name-prefix on a bench where EVERY seat
    // is real, so §3.4's padding branch never executes there and two mutations
    // survived all 520 suites:
    //   M2  drop `.filter(b => !placeholders.has(b.seat))`
    //   M3  neuter `if (placeholders.has(seat)) { continue; }` in the
    //       seat-unbound loop
    // What makes the branch run is a ROSTER HOLE: a review with no `seat`,
    // which is what an orphaned/unbound Stage-1 leg leaves behind
    // (stage1-bind.js binds; a leg it could not attribute leaves `seat` unset).
    // M2's consequence is a SYNTHETIC `__unbound-…` sentinel reaching a judge
    // filename, judgeResults[].seat and — through buildTallyInput — the
    // `adjudications[].seat` that ships in tally-input.json/tally.json.
    describe('F1: a roster HOLE exercises §3.4 padding — the placeholder never leaks', () => {
      // reviews[0] lost its seat in Stage 1; reviews[1] kept deepseek#2.
      function holedReviews() {
        const rs = twinReviews();
        rs[0].seat = null;
        return rs;
      }

      test('M2: the placeholder never becomes judgeResults[].seat, a judge filename, or adjudications[].seat', async () => {
        const ctx = makeCtx({
          models: ['deepseek', 'deepseek'],
          // BOTH roster slots return a leg, so slot 1's leg genuinely BINDS to
          // the placeholder — that bind is exactly what the identity filter
          // throws away and what M2 would keep.
          onWave: (opts) => okWave([
            mkLeg('deepseek', judgeOut(['Review B', 'Review A'],
              [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'neutral' }]), 'complete', opts.waveId, 1),
            mkLeg('deepseek', judgeOut(['Review A', 'Review B'],
              [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'dispute' }]), 'complete', opts.waveId, 2),
          ]),
          onSolo: () => { throw new Error('no repairs expected'); },
        });
        const { judgeResults } = await runStage2(ctx,
          { reviews: holedReviews(), labels: twinLabels, globalFindings: twinGlobalFindings });
        // null, never a sentinel object: nothing was guessed for the hole.
        expect(judgeResults.map(j => j.seat && j.seat.id)).toEqual([null, 'deepseek#2']);
        // The unbound judge falls back to the ALIAS filename (today's shape).
        const judgeFiles = fs.readdirSync(ctx.o.runDir).filter(f => f.startsWith('judge-')).sort();
        expect(judgeFiles).toEqual(['judge-deepseek-2.md', 'judge-deepseek.md']);
        // ⚠️ v4.8 PR5a fix-wave (council B2) reads this pair of facts as ONE claim, so both
        // halves are asserted here rather than one being left to inference. A Stage-1 orphan
        // is re-admitted to Stage 2 under a placeholder, BINDS to it, and therefore
        // (a) writes an ALIAS-named judge file — the line above — and (b) emits NO -s2
        // seat-unbound note of its own. src/workspace/artifact-names.js's orphanClaims
        // depends on exactly that: a Stage-1 note has to claim review- AND judge-, because
        // no second note will ever arrive to claim the judge half. Narrowing a Stage-1
        // note to review- alone (the shape council finding B2's rationale argued for)
        // would leave `judge-deepseek.md` attributed to seat deepseek#1.
        expect(ctx._notes).toEqual([]);
        // …and the sentinel never reaches the shipped artifact either. This is
        // the real production join (run-assemble.js), not a re-implementation.
        const { adjudications } = buildTallyInput({
          runId: 'abc123', date: '2026-07-19', bench: ['deepseek', 'deepseek'], chair: 'gemini',
          reviews: holedReviews().map(r => ({ ...r, globalFindings: [] })),
          judgeResults, chairStats: null,
        });
        expect(adjudications.length).toBeGreaterThan(0);
        for (const a of adjudications) {
          expect(a.judge).toBe('deepseek');                 // alias/ledger-join space, intact
          expect(a.seat || '').not.toMatch(/__unbound-/);
        }
        expect(adjudications.filter(a => a.seat)).toHaveLength(2);   // only the REAL seat is named
      });

      test('M3: a padded slot that never returns a leg fires NO false seat-unbound note', async () => {
        const ctx = makeCtx({
          models: ['deepseek', 'deepseek'],
          // Only roster slot 2 comes back, so the PLACEHOLDER is what lands in
          // bindRes.unbound — the exact input the `continue` guard exists for.
          onWave: (opts) => okWave([
            mkLeg('deepseek', judgeOut(['Review A', 'Review B'],
              [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'dispute' }]), 'complete', opts.waveId, 2),
          ]),
          onSolo: () => { throw new Error('no repairs expected'); },
        });
        const { judgeResults } = await runStage2(ctx,
          { reviews: holedReviews(), labels: twinLabels, globalFindings: twinGlobalFindings });
        // The suppressions ahead of the loop do NOT cover this: the wave
        // returned a leg (so it is not the zero-leg thin-cross-review branch)
        // and produced no orphan (so the orphan pre-emption does not fire).
        // Only the placeholder guard stands between this and a note naming a
        // seat the run was never able to identify.
        expect(ctx._notes).toEqual([]);
        expect(judgeResults.map(j => j.seat && j.seat.id)).toEqual(['deepseek#2']);
      });
    });
  });
});

describe('launchStage1 roster return', () => {
  const { launchStage1 } = require('../../src/council/run-stage1-launch');

  test('a twin bench gets one wave entry whose roster is seat-space and slot-ordered', async () => {
    const ctx = makeCtx({ models: ['deepseek', 'deepseek', 'gpt'],
      onWave: (opts) => okWave([], opts.waveId) });
    const r = await launchStage1(ctx);
    expect(r.waves).toHaveLength(1);
    expect(r.waves[0].waveId).toBe('abc123-s1');
    expect(r.waves[0].roster.map(s => s.id)).toEqual(['deepseek#1', 'deepseek#2', 'gpt']);
  });

  test('the -s1 roster drops the critic by ALIAS, in lockstep with the launch plan', async () => {
    // A unique-alias bench cannot see this: `models.filter(m => m !== critic)`,
    // `seats.filter(s => s.alias !== critic)` and `seats.filter(s => s.id !== criticSeat)`
    // are byte-identical there. They diverge ONLY on a repeated critic alias —
    // the alias filter drops BOTH twins, the criticSeat filter drops ONE, and the
    // roster then runs one longer than the launch plan, shifting every legId slot.
    // preflightSeats rejects an ambiguous critic, which is exactly why bindSeats
    // has to be total.
    const seen = [];
    const ctx = makeCtx({ models: ['a', 'crit', 'crit'], critic: 'crit',
      onWave: (opts) => { seen.push(opts.models.slice()); return okWave([], opts.waveId); },
      onSolo: (opts) => ({ wave: { waveId: opts.waveId, legs: [] }, exitCode: 0, leg: null }) });
    const r = await launchStage1(ctx);
    const s1 = r.waves.find(w => w.waveId === 'abc123-s1');
    expect(seen[0]).toEqual(['a']);                       // :47 drops BOTH twins
    expect(s1.roster.map(s => s.alias)).toEqual(['a']);   // criticSeat filter would give ['a','crit']
    expect(s1.roster).toHaveLength(seen[0].length);
    const c1 = r.waves.find(w => w.waveId === 'abc123-c1');
    expect(c1.roster.map(s => s.id)).toEqual(['crit#1']);
  });

  test('lens mode gives each bench position its own wave and its own seat', async () => {
    const ctx = makeCtx({ models: ['deepseek', 'deepseek'], lenses: ['risk', 'cost'],
      onSolo: (opts) => ({ wave: { waveId: opts.waveId, legs: [] }, exitCode: 0, leg: null }) });
    const r = await launchStage1(ctx);
    expect(r.waves.map(w => w.waveId)).toEqual(['abc123-l1', 'abc123-l2']);
    expect(r.waves.map(w => w.roster[0].id)).toEqual(['deepseek#1', 'deepseek#2']);
  });

  test('a dead wave carries its roster as seats alongside the alias models', async () => {
    const ctx = makeCtx({ models: ['a', 'b'], onWave: (opts) => okWave([], opts.waveId) });
    const r = await launchStage1(ctx);
    expect(r.deadWaves).toHaveLength(1);
    expect(r.deadWaves[0].models).toEqual(['a', 'b']);
    expect(r.deadWaves[0].seats.map(s => s.id)).toEqual(['a', 'b']);
  });

  test('each wave entry carries its OWN legs, never the flattened union', async () => {
    const ctx = makeCtx({ models: ['a', 'b', 'crit'], critic: 'crit',
      onWave: (opts) => okWave([mkLeg('a', 'r', 'complete', opts.waveId, 1),
        mkLeg('b', 'r', 'complete', opts.waveId, 2)], opts.waveId),
      onSolo: (opts) => { const leg = mkLeg('crit', 'r', 'complete', opts.waveId, 1);
        return { wave: { waveId: opts.waveId, legs: [leg] }, exitCode: 0, leg }; } });
    const r = await launchStage1(ctx);
    expect(r.legs).toHaveLength(3);                                   // flattened, unchanged
    expect(r.waves.map(w => w.legs.length)).toEqual([2, 1]);          // partitioned
  });
});
