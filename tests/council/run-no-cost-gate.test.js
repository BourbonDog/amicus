// tests/council/run-no-cost-gate.test.js
'use strict';

/**
 * v4.1 Task 8 — `noCostGate` must survive from the run options all the way to
 * `runFanout` (which guards its budget gate with `if (!options.noCostGate)`),
 * on EVERY internal launch. The launch option objects are assembled by the
 * CALLERS (run-stages, run-chair, run-debate), so a single missed call site
 * silently re-arms the per-leg price gate mid-council — exactly the failure the
 * flag exists to prevent (an intentional o3-class run refused on its repair or
 * its chair).
 *
 * The scripts below therefore drive a run through ALL of them in one go:
 *   stage-1 seat wave, stage-1 critic solo, stage-1 findings-repair solo,
 *   stage-2 judge wave, stage-2 judge-repair solo, debate defense solo,
 *   debate defense-repair solo, debate re-vote wave, re-vote repair solo,
 *   chair solo, chair VERDICT-repair solo — plus a second run for the lens solos.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { runCouncil } = require('../../src/council/run');
const { createLaunchers } = require('../../src/council/run-launch');
const { review, judgeOut, mkLeg, okWave, defenseOut, revoteOut } = require('./helpers/fake-launchers');

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'council-gate-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const deps = (launchers) => ({
  launchers, appendRunFn: () => {}, statsFn: () => [], installSignalAbortFn: () => () => {},
});

/** Records every launch's opts; dispatches to `responder(opts)` by waveId. */
function recordingLaunchers(responder) {
  const calls = [];
  async function launchWave(opts) {
    calls.push(opts);
    const r = await responder(opts);
    // v4.8: stamp the roster slot so bindSeats can attribute these legs — this
    // seam has its own launchers and never went through helpers/fake-launchers.js's
    // sweep, so its legs carried `taskId: 'gemini-1'` and no waveId, which
    // bindSeats correctly refuses to adopt (every leg an orphan, every run
    // degraded to 2). Mirrors helpers/fake-launchers.js:42-49, including
    // slot consumption WITHOUT replacement so a twin roster yields -1/-2.
    if (r && r.wave && Array.isArray(r.wave.legs)) {
      const remaining = (opts.models || []).slice();
      r.wave.legs.forEach((leg, i) => {
        const k = remaining.indexOf(leg.modelInput || leg.model);
        if (k >= 0) { remaining[k] = null; }
        leg.taskId = `${opts.waveId}-${k >= 0 ? k + 1 : i + 1}`;
        leg.waveId = opts.waveId;
      });
    }
    return r;
  }
  async function launchSolo(opts) {
    const r = await launchWave({ ...opts, models: [opts.model] });
    return { ...r, leg: (r.wave && r.wave.legs && r.wave.legs[0]) || null };
  }
  return { launchWave, launchSolo, calls };
}

const opts = (extra = {}) => ({
  briefing: 'Review this material.', models: ['gemini', 'gpt', 'qwen'], chair: 'deepseek',
  critic: null, lenses: null, project: tmp, runId: 'r', runDir: tmp,
  timeout: 5, maxCost: null, gateway: 'auto', noValidateModel: false, date: '2026-07-19', ...extra,
});

// Every judge ranks all three labels; A1 (gemini's finding) is disputed by both
// peers → Disputed → there is something to debate.
const RANK = ['Review A', 'Review B', 'Review C'];
const ADJ = {
  gemini: [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'agree' }, { id: 'C1', verdict: 'agree' }],
  gpt: [{ id: 'A1', verdict: 'dispute' }, { id: 'B1', verdict: 'agree' }, { id: 'C1', verdict: 'agree' }],
  qwen: [{ id: 'A1', verdict: 'dispute' }, { id: 'B1', verdict: 'agree' }, { id: 'C1', verdict: 'agree' }],
};
const UNPARSEABLE = 'Prose only — no JSON block at all.';

/**
 * Drives EVERY launch site: gpt's review is malformed (findings repair), qwen's
 * judging is malformed (judge repair), the defense is malformed (defense
 * repair), the first re-vote leg is malformed (re-vote repair), and the chair
 * omits its VERDICT line (chair repair).
 */
function allSitesResponder(o) {
  const id = o.waveId;
  if (id === 'r-s1') { return okWave(o.models.map(m => mkLeg(m, m === 'gpt' ? UNPARSEABLE : review(m)))); }
  if (id === 'r-c1') { return okWave([mkLeg('qwen', review('qwen'))]); }
  if (id === 'r-p1') { return okWave([mkLeg('gpt', review('gpt'))]); }
  if (id === 'r-s2') { return okWave(o.models.map(m => mkLeg(m, m === 'qwen' ? UNPARSEABLE : judgeOut(RANK, ADJ[m])))); }
  if (id === 'r-q1') { return okWave([mkLeg('qwen', judgeOut(RANK, ADJ.qwen))]); }
  if (id === 'r-d1') { return okWave([mkLeg('gemini', UNPARSEABLE)]); }
  if (id === 'r-d1r') { return okWave([mkLeg('gemini', defenseOut([{ id: 'A1', action: 'defend', argument: 'the retry caps at 5' }]))]); }
  if (id === 'r-rv') {
    return okWave(o.models.map((m, i) => mkLeg(m, i === 0 ? UNPARSEABLE
      : revoteOut([{ id: 'A1', verdict: 'dispute', reason: 'still unsupported' }]))));
  }
  if (/^r-rv-.+r$/.test(id)) { return okWave([mkLeg(o.model, revoteOut([{ id: 'A1', verdict: 'agree', reason: 'defense convincing' }]))]); }
  if (id === 'r-ch1') { return okWave([mkLeg('deepseek', 'Synthesis with no verdict line.', 'complete', 0.03)]); }
  if (id === 'r-ch4') { return okWave([mkLeg('deepseek', 'VERDICT: Ship it', 'complete', 0.01)]); }
  throw new Error(`unscripted waveId ${id}`);
}

/** Lens mode: one solo per seat instead of a seat wave (no critic, no debate). */
function lensResponder(o) {
  const id = o.waveId;
  if (/^r-l[123]$/.test(id)) { return okWave([mkLeg(o.model, review(o.model))]); }
  if (id === 'r-s2') { return okWave(o.models.map(m => mkLeg(m, judgeOut(RANK, ADJ[m])))); }
  if (id === 'r-ch1') { return okWave([mkLeg('deepseek', 'Synthesis.\n\nVERDICT: Ship it', 'complete', 0.03)]); }
  throw new Error(`unscripted waveId ${id}`);
}

// A `r-rv-<judge>r` id embeds whichever disputing judge was ordered first.
const normalize = (id) => (/^r-rv-.+r$/.test(id) ? 'r-rv-*r' : id);

const ALL_SITES = ['r-s1', 'r-c1', 'r-p1', 'r-s2', 'r-q1', 'r-d1', 'r-d1r',
  'r-rv', 'r-rv-*r', 'r-ch1', 'r-ch4'];

describe('launchWave → runFanout', () => {
  test('forwards noCostGate into the fanout options', async () => {
    const seen = [];
    const fanoutFn = async (o) => { seen.push(o); return { wave: { status: 'complete', legs: [] }, exitCode: 0 }; };
    const { launchWave } = createLaunchers({ fanoutFn });
    await launchWave({ models: ['gemini'], prompt: 'p', project: tmp, waveId: 'w1', noCostGate: true });
    expect(seen[0].noCostGate).toBe(true);
  });

  test('without the flag the fanout options keep the gate armed', async () => {
    const seen = [];
    const fanoutFn = async (o) => { seen.push(o); return { wave: { status: 'complete', legs: [] }, exitCode: 0 }; };
    const { launchWave } = createLaunchers({ fanoutFn });
    await launchWave({ models: ['gemini'], prompt: 'p', project: tmp, waveId: 'w1' });
    expect(seen[0].noCostGate).toBeFalsy();
  });
});

describe('noCostGate reaches EVERY internal launch', () => {
  test('stage-1 wave + critic solo + repairs + stage-2 + debate + chair + chair repair', async () => {
    const launchers = recordingLaunchers(allSitesResponder);
    const { exitCode } = await runCouncil(
      opts({ critic: 'qwen', debate: true, noCostGate: true }), deps(launchers));
    expect(exitCode).toBe(0);
    // Proof the script really drove every call site (not just the happy three).
    expect(launchers.calls.map(c => normalize(c.waveId)).sort()).toEqual([...ALL_SITES].sort());
    for (const call of launchers.calls) {
      expect({ waveId: call.waveId, noCostGate: call.noCostGate })
        .toEqual({ waveId: call.waveId, noCostGate: true });
    }
  });

  test('lens solos carry it too', async () => {
    const launchers = recordingLaunchers(lensResponder);
    const { exitCode } = await runCouncil(
      opts({ lenses: ['security', 'perf', 'ux'], noCostGate: true }), deps(launchers));
    expect(exitCode).toBe(0);
    expect(launchers.calls.map(c => c.waveId).sort()).toEqual(['r-ch1', 'r-l1', 'r-l2', 'r-l3', 'r-s2']);
    for (const call of launchers.calls) {
      expect({ waveId: call.waveId, noCostGate: call.noCostGate })
        .toEqual({ waveId: call.waveId, noCostGate: true });
    }
  });

  test('without the flag no launch claims it (the budget gate still runs)', async () => {
    const launchers = recordingLaunchers(allSitesResponder);
    const { exitCode } = await runCouncil(opts({ critic: 'qwen', debate: true }), deps(launchers));
    expect(exitCode).toBe(0);
    expect(launchers.calls.length).toBe(ALL_SITES.length);
    for (const call of launchers.calls) {
      // Boolean() (not toBeFalsy) so a failure names the site that leaked it.
      expect({ waveId: call.waveId, gateOff: Boolean(call.noCostGate) })
        .toEqual({ waveId: call.waveId, gateOff: false });
    }
  });
});
