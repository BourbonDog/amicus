// tests/council/run-debate.test.js
'use strict';
const path = require('path');
const os = require('os');
const fs = require('fs');
const { runDebate, nothingToDebate, disputingJudges } = require('../../src/council/run-debate');
// T5.1 (SI-10/R8): runRevoteWave and applyDebate driven DIRECTLY, not through
// runDebate/runCouncil — the unit-level seam
// docs/superpowers/plans/2026-08-21-v48-phase5-debate-join.md's Task 1 asks
// for (that plan is committed; the task brief that also asked for this lives
// under .superpowers/, deleted at branch end — cite the file that survives).
const { runRevoteWave } = require('../../src/council/run-debate-revote');
// T5.5: the exit-2 composition block at the bottom of this file drives the REAL
// degrade sink and the REAL terminal-exit resolver, not a double — that pairing
// is the whole point of it (BACKLOG.md's SI-10 exit-2 follow-up).
const { createDegradeSink } = require('../../src/council/run-degrade');
const { resolveTerminalExit } = require('../../src/council/run-finalize');
const { applyDebate } = require('../../src/council/debate');
const { tally } = require('../../src/council/tally');
const runState = require('../../src/council/run-state');
const { runCouncil } = require('../../src/council/run');
const { buildSeats } = require('../../src/council/seats');
const flh = require('./helpers/fake-launchers');
const { scriptedLaunchers, debateScriptMap, debateScript, okWave, mkLeg, launchersFromScript } = flh;

function provisionalInput() {
  return {
    meta: { runId: 'r', models: ['gemini', 'gpt', 'qwen'], chair: 'deepseek', claudeInCouncil: false, date: '2026-07-19' },
    findings: [
      { id: 'A1', raiser: 'gemini', severity: 'major', claim: 'infinite retry' },  // disputed by gpt+qwen → Disputed
      { id: 'B1', raiser: 'gpt', severity: 'nit', claim: 'typo' },                  // agreed → Confirmed
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

// v4.8 PR3 Task 6: a TWIN bench — `--models deepseek,deepseek,gpt` mints seats
// deepseek#1 / deepseek#2 / gpt while every alias-space field keeps the bare
// `deepseek` spelling. BOTH twins raise (so an alias-keyed `byRaiser` collapses
// them onto one defense solo) and BOTH twins judge (so an alias-keyed
// `disputingJudges` collapses them onto one re-vote seat and one repair id).
// `seat`/`raiserSeat` are emit-when-DIFFERENT, exactly as Task 5 writes them.
function twinInput() {
  return {
    meta: { runId: 'r', models: ['deepseek', 'deepseek', 'gpt'], chair: 'gemini', claudeInCouncil: false, date: '2026-07-19' },
    findings: [
      { id: 'A1', raiser: 'deepseek', raiserSeat: 'deepseek#1', severity: 'major', claim: 'infinite retry' },
      { id: 'B1', raiser: 'deepseek', raiserSeat: 'deepseek#2', severity: 'major', claim: 'unbounded queue' },
    ],
    adjudications: [
      { findingId: 'A1', judge: 'gpt', verdict: 'dispute' },
      { findingId: 'A1', judge: 'deepseek', seat: 'deepseek#2', verdict: 'dispute' },
      { findingId: 'B1', judge: 'gpt', verdict: 'dispute' },
      { findingId: 'B1', judge: 'deepseek', seat: 'deepseek#1', verdict: 'dispute' },
    ],
    rankings: [{ judge: 'deepseek', order: ['gpt'] }, { judge: 'gpt', order: ['deepseek'] }],
    runStats: [],
  };
}
const TWIN_BENCH = ['deepseek', 'deepseek', 'gpt'];

// v4.8 PR3 Task 3: real fanout stamps taskId `${waveId}-${slot}` (roster position,
// consumed without replacement) onto every leg BEFORE handing it back — the exact
// re-stamp scriptedLaunchers/launchersFromScript perform in fake-launchers.js. This
// fixture skipped that step and returned script-literal legs untouched, so a leg's
// taskId never carried the wave it actually belonged to — bindSeats' `/^(.*)-(\d+)$/`
// could never match it. `stampFanout` reproduces that same roster-slot re-stamp
// (NOT a file-global counter, which indexes the wrong roster position — see mkLeg
// at helpers/fake-launchers.js:14-18, which this deliberately does NOT copy).
function stampFanout(waveId, models, res) {
  if (res && res.wave && Array.isArray(res.wave.legs)) {
    const remaining = (models || []).slice();
    res.wave.legs.forEach((l, i) => {
      const alias = l.modelInput || l.model;
      const k = remaining.indexOf(alias);
      if (k >= 0) { remaining[k] = null; }
      l.taskId = `${waveId}-${k >= 0 ? k + 1 : i + 1}`;
      l.waveId = waveId;
    });
    // Solo callers built `leg` as a SEPARATE leg(...) call from the one inside
    // wave.legs (same content, different object) — collapse onto the re-stamped
    // one so both surfaces agree, mirroring launchersFromScript's solo wrapper.
    res.leg = res.wave.legs[0] || res.leg || null;
  }
  return res;
}
// Fake launchers: defense solo defends A1; re-vote wave has gpt flip to agree, qwen hold dispute.
// Mirrors the run-launch.js DI contract: launchSolo → {wave, exitCode, leg}; launchWave → {wave, exitCode}.
function fakeLaunchers(script, seen) {
  return {
    launchSolo: async (opts) => {
      if (seen) { seen.push(opts); }
      return stampFanout(opts.waveId, [opts.model], { ...script.solos[opts.waveId], exitCode: 0 });
    },
    launchWave: async (opts) => {
      if (seen) { seen.push(opts); }
      return stampFanout(opts.waveId, opts.models, { wave: script.waves[opts.waveId], exitCode: 0 });
    },
  };
}
// v4.8 PR3 Task 3: leg() now takes an explicit (waveId, slot) pair, mirroring
// run-stages.test.js's mkLeg (PR2a Task 1) — slot is the leg's 1-based index in
// the wave's LAUNCH ROSTER (seats.js:93-96), defaulting to 1 because every call
// site that passes a bare waveId is a SOLO (one-model roster, always slot 1).
// Omitting waveId omits taskId/waveId entirely rather than falling back to the
// old `${model}-t` shape — no leg this file returns is meant to reach a wave
// unstamped; the ~34 call sites that omit waveId are all consumed through
// fakeLaunchers/stampFanout above, which re-stamps them before they leave.
function leg(model, summary, waveId, slot = 1) {
  return { model, modelInput: model, status: 'complete', summary,
    ...(waveId !== undefined ? { taskId: `${waveId}-${slot}`, waveId } : {}) };
}
function wave(legs) { return { status: 'complete', legs }; }
const defenseOut = (resp) => `Defending.\n\`\`\`json\n${JSON.stringify({ responses: resp })}\n\`\`\`\n`;
const revoteOut = (rv) => `Re-voting.\n\`\`\`json\n${JSON.stringify({ revotes: rv })}\n\`\`\`\n`;

// v4.8 PR3 Task 3: models/seats/criticSeat + degrade widened onto ctxFor, mirroring
// how PR2a widened run-stages.test.js's makeCtx (:58-101). Production sets seats/
// criticSeat/models at run.js:131-135 (via asm.preflightSeats) and ctx.degrade at
// run.js:119. Every debate fixture here runs the fixed 3-seat gemini/gpt/qwen bench
// (provisionalInput()'s meta.models, e2eOpts()'s models) — no critic, no lenses —
// so, unlike makeCtx, this stays a fixed table rather than a parameterized one.
// Without ctx.degrade, any ctx.degrade.note(...) call throws
// "Cannot read properties of undefined"; without o.seats/o.criticSeat/o.models,
// any bindSeats-driven consumer falls through to an empty roster — green for the
// wrong reason.
// v4.8 PR3 Task 6 widened this to take the bench, so a TWIN bench
// (`['deepseek','deepseek','gpt']` → seats deepseek#1/deepseek#2/gpt) can be
// driven through the same fixture. `ctxFor` keeps the fixed 3-seat table every
// pre-existing test in this file relies on.
function ctxFor(tmp, launchers, models = ['gemini', 'gpt', 'qwen']) {
  const seats = buildSeats(models, null, null);
  const notes = [];
  return {
    // v4.3 Task 3 (spec §7.2): non-null councilName so legOpts()'s attribution
    // fields can be asserted below, not just checked against a falsy default.
    // v4.7 F8 D16 (T7 review): tag joins it on the same idiom — non-null so
    // legOpts()'s `tag: ctx.o.tag` forward can be asserted too.
    o: { runId: 'r', runDir: tmp, timeout: 10, gateway: 'auto', date: '2026-07-19', maxCost: null,
      noCostGate: false, councilName: 'nightly-council', tag: 'sprint42',
      models, critic: null, lenses: null, seats, criticSeat: null },
    launchers, addWave: () => {}, overBudget: () => false, scratchDir: path.join(tmp, '_scratch'),
    // A real recording sink (not a no-op) so a later ctx.degrade.note(...) call is
    // both safe AND assertable — not the production createDegradeSink, which
    // drags in fs writes this fixture doesn't need.
    degrade: { note: (rec) => notes.push(rec), all: () => notes },
  };
}

// T5.1: seat id -> bench alias, built the same way run-debate.js:129 does.
function aliasOfFor(seats) {
  const byId = new Map(seats.map(s => [s.id, s]));
  return (key) => { const s = byId.get(key); return s ? s.alias : key; };
}

function mkTmp(prefix) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(tmp, '_scratch'), { recursive: true });
  return tmp;
}

const VALID_ADDENDUM_ACTIONS = new Set(['defended', 'amended', 'withdrawn', 'no-response']);

describe('nothingToDebate / disputingJudges', () => {
  test('nothingToDebate true when no Contested+Disputed', () => {
    const rec = tally({ ...provisionalInput(), findings: [{ id: 'B1', raiser: 'gpt', severity: 'nit', claim: 't' }],
      adjudications: [{ findingId: 'B1', judge: 'gemini', verdict: 'agree' }, { findingId: 'B1', judge: 'qwen', verdict: 'agree' }] });
    expect(nothingToDebate(rec)).toBe(true);
  });
  test('nothingToDebate true when judged is false (fewer than 2 rankings)', () => {
    const rec = tally({ ...provisionalInput(), rankings: [{ judge: 'gpt', order: ['gemini', 'qwen'] }] });
    expect(rec.judged).toBe(false);
    expect(nothingToDebate(rec)).toBe(true);
  });
  test('nothingToDebate false when a Disputed finding exists', () => {
    expect(nothingToDebate(tally(provisionalInput()))).toBe(false);
  });
  test('disputingJudges picks judges with a dispute on a bundled id', () => {
    const rec = tally(provisionalInput());
    expect(disputingJudges(rec, ['A1']).sort()).toEqual(['gpt', 'qwen']);
  });
  test('disputingJudges ignores disputes on ids that are NOT bundled', () => {
    const rec = tally(provisionalInput());
    expect(disputingJudges(rec, ['B1'])).toEqual([]);
  });

  // v4.8 PR3 Task 6: the Set dedups by SEAT, not by alias (D6). Alias-deduping
  // twins collapses two disputing bench positions into one re-vote leg, so the
  // twin that never re-voted silently keeps a verdict the round meant to replace.
  test('disputingJudges does NOT collapse twin judges onto one entry', () => {
    const rec = tally(twinInput());
    expect(disputingJudges(rec, ['A1', 'B1']).sort()).toEqual(['deepseek#1', 'deepseek#2', 'gpt']);
  });
});

describe('runDebate — happy path (defend + partial re-vote flip)', () => {
  let tmp, result, launched, midDefenseStage, midRevoteStage;
  beforeAll(async () => {
    tmp = mkTmp('run-debate-');
    const input = provisionalInput();
    const provisionalRecord = tally(input);
    launched = [];                       // every launch's opts, so the briefs can be asserted
    const stageOf = (name) => ((runState.readRun(tmp) || {}).stages || []).find(s => s.name === name) || null;
    const script = {
      solos: { 'r-d1': { wave: wave([leg('gemini', defenseOut([{ id: 'A1', action: 'defend', argument: 'caps at 5' }]))]),
                         leg: leg('gemini', defenseOut([{ id: 'A1', action: 'defend', argument: 'caps at 5' }])) } },
      waves: { 'r-rv': wave([leg('gpt', revoteOut([{ id: 'A1', verdict: 'agree' }])),
                             leg('qwen', revoteOut([{ id: 'A1', verdict: 'dispute' }]))]) },
    };
    const base = fakeLaunchers(script, launched);
    // Observe run.json from INSIDE each launch: proves the sub-wave id was
    // registered BEFORE the leg went in flight (v4.0.1 abort-cascade contract).
    const launchers = {
      launchSolo: (opts) => { midDefenseStage = stageOf('debate-defense'); return base.launchSolo(opts); },
      launchWave: (opts) => { midRevoteStage = stageOf('debate-revote'); return base.launchWave(opts); },
    };
    result = await runDebate(ctxFor(tmp, launchers), { provisionalRecord, tallyInput: input });
  });

  test('debateSummary counts the round', () => {
    expect(result.debateSummary.outcome).toBe('ran');
    expect(result.debateSummary.disputed).toBe(1);
    expect(result.debateSummary.defended).toBe(1);
    expect(result.debateSummary.revoteJudges).toBe(2);
  });

  test('a clean round is neither degraded nor aborted', () => {
    expect(result.degraded).toBe(false);
    expect(result.aborted).toBeNull();
  });

  // 4.1.1 Fix C: run.js needs to know whether the re-vote wave actually
  // launched so it can checkpoint debate-revote 'skipped' (not a false
  // 'complete') when it did not — this is the launched case.
  test('revoteLaunched is true when the re-vote wave actually launches', () => {
    expect(result.revoteLaunched).toBe(true);
  });

  test('the debated tally flips A1 from Disputed toward Contested (gpt agreed)', () => {
    const rec = tally(result.debatedInput);
    const a1 = rec.findings.find(f => f.id === 'A1');
    // peers now a=1 (gpt agree), d=1 (qwen dispute) → Contested
    expect(a1.basis).toEqual({ a: 1, d: 1, n: 0 });
    expect(a1.tier).toBe('Contested');
    expect(result.verdictChanges).toBe(1);
  });

  test('writes rebuttal-, revote- and the shared re-vote bundle artifacts', () => {
    expect(fs.existsSync(path.join(tmp, 'rebuttal-gemini.md'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'revote-gpt.md'))).toBe(true);
    // spec §5.1 names revote-bundle.md a run-dir artifact — audit parity with
    // briefing-stage1.md / bundle-stage2.md / chair-packet.md.
    expect(fs.existsSync(path.join(tmp, 'revote-bundle.md'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'debate.json'))).toBe(true);
  });

  test('the chair addendum carries the REAL prior verdicts and re-votes, not assumed ones', () => {
    const a1 = result.addendumOutcomes.find(o => o.id === 'A1');
    expect(a1.priorVerdicts).toEqual({ gpt: 'dispute', qwen: 'dispute' });
    expect(a1.revotes).toEqual({ gpt: 'agree', qwen: 'dispute' });
  });

  test('the defense brief carries the REAL peer split, not an empty one', () => {
    const d1 = launched.find(o => o.waveId === 'r-d1');
    expect(d1.prompt).toContain('Peer verdicts (anonymized): 2 dispute, 0 agree, 0 neutral.');
  });

  // v4.3 Task 3 (spec §7.2): legOpts() stamps council attribution onto every
  // debate leg — defense solo AND re-vote wave (the two shapes it builds).
  test('every debate leg (defense solo and re-vote wave) carries council attribution', () => {
    const d1 = launched.find(o => o.waveId === 'r-d1');
    const rv = launched.find(o => o.waveId === 'r-rv');
    // v4.7 F8 D16 (T7 review): tag rides the SAME legOpts() forward as
    // councilRunId/councilName — deleting `tag: ctx.o.tag` from run-debate.js's
    // legOpts restores the silent degrade this pins against.
    expect(d1).toMatchObject({ councilRunId: 'r', councilName: 'nightly-council', tag: 'sprint42' });
    expect(rv).toMatchObject({ councilRunId: 'r', councilName: 'nightly-council', tag: 'sprint42' });
  });

  // ---- carry-forward gap 3a: previousTier stamping ----
  test('previousTier is stamped from the PROVISIONAL record onto every debate finding', () => {
    // applyDebate deliberately ignores provisionalRecord and reads previousTier off
    // tallyInput.findings[]; run-debate must stamp it or every row silently reads null.
    expect(result.debateFindings).toHaveLength(1);
    expect(result.debateFindings[0]).toMatchObject(
      { id: 'A1', raiser: 'gemini', action: 'defend', previousTier: 'Disputed' });
    const doc = JSON.parse(fs.readFileSync(path.join(tmp, 'debate.json'), 'utf-8'));
    expect(doc.findings[0].previousTier).toBe('Disputed');
  });

  test('previousTier is a provisional-only scratch field — it never lands in the debated input', () => {
    for (const f of result.debatedInput.findings) {
      expect(Object.prototype.hasOwnProperty.call(f, 'previousTier')).toBe(false);
    }
  });

  // ---- carry-forward gap 3c: only valid PAST_TENSE actions reach buildDebateAddendum ----
  test('every addendum outcome carries a valid past-tense action', () => {
    for (const o of result.addendumOutcomes) {
      expect(VALID_ADDENDUM_ACTIONS.has(o.action)).toBe(true);
    }
  });

  // ---- carry-forward gap: abort cascade (spec/v4.0.1) ----
  test('each debate sub-wave id is registered BEFORE its leg goes in flight', () => {
    expect(midDefenseStage.waveIds).toContain('r-d1');
    expect(midRevoteStage.waveIds).toContain('r-rv');
    expect(midRevoteStage.status).toBe('running');
    expect(midRevoteStage.project).toBeTruthy();
  });

  test('debate.json records the applied re-votes', () => {
    const doc = JSON.parse(fs.readFileSync(path.join(tmp, 'debate.json'), 'utf-8'));
    expect(doc.revotes).toEqual(expect.arrayContaining([
      expect.objectContaining({ judge: 'gpt', id: 'A1', verdict: 'agree', applied: true }),
      expect.objectContaining({ judge: 'qwen', id: 'A1', verdict: 'dispute', applied: true }),
    ]));
  });

  test('the debate legs are appended to runStats with the rebuttal/revote roles', () => {
    const roles = result.debatedInput.runStats.map(r => r.role).sort();
    expect(roles).toEqual(['rebuttal', 'revote', 'revote']);
  });
});

// v4.8 Phase 6 PR1 Task 3, fix rounds 1-2 (SI-24) — WHAT ACTUALLY PROTECTS
// addendumOutcomes' `PAST_TENSE[df.action] || PAST_TENSE['no-response']`
// (run-debate.js:262) is NOT PAST_TENSE's null prototype. It is
// parseDebateDefense's ALLOWLIST, one file upstream.
//
// Fix round 1 set out to pin PAST_TENSE's SECOND consumer here (the FIRST is
// debate.js's decorateRecord, pinned in debate.test.js's D1-D3 — which call
// decorateRecord directly with a hand-built debateFindings array and so never
// touch this file at all). MEASURED, NOT ASSUMED: driving a REAL defense
// response through the ACTUAL runDebate -> parseDebateDefense -> applyDebate
// -> addendumOutcomes path (the same fixture shape as the happy-path describe
// above, :212-215) with an inherited `action` does NOT exercise PAST_TENSE's
// null prototype at this call site. parseDebateDefense
// (src/council/parse-stage2.js:142-153) is an ALLOWLIST: only
// 'defend'/'amend'/'withdraw' ever overwrite the per-id default of
// `{action: 'no-response'}` — every other action string a model could emit,
// inherited-key or ordinary junk alike, is already the literal 'no-response'
// before `debateFindings` (and therefore `df.action`) exists.
// `PAST_TENSE[df.action]` at this call site is therefore ALWAYS an own-key
// hit on any input the real pipeline can deliver — confirmed by running the
// two tests below under the PROTOACTION mutation: neither reds (see the
// updated PROTOACTION record in debate.test.js).
//
// So what DO the two tests below pin? The allowlist itself — that no defense
// action, however adversarial, ever reaches PAST_TENSE un-normalised. That is
// a real and worth-keeping invariant; it earns its own named mutant,
// ACTIONPASSTHRU (below), which removes the allowlist's fallthrough so
// `r.action` passes through verbatim instead of defaulting to 'no-response'.
// The two tests DO red under ACTIONPASSTHRU — see its record for the measured
// set. Full chase in task-3-report.md's "Fix round 1" and "Fix round 2"
// sections.
describe('runDebate — the parseDebateDefense allowlist keeps a foreign action away from PAST_TENSE (addendumOutcomes)', () => {
  /** Drives a real (raw-text, parseDebateDefense-parsed) defense response —
   * same shape as the happy-path fixture above — with the given `action`. */
  async function runWithAction(action) {
    const tmp = mkTmp('run-debate-proto-');
    const input = provisionalInput();
    const provisionalRecord = tally(input);
    const script = {
      solos: { 'r-d1': { wave: wave([leg('gemini', defenseOut([{ id: 'A1', action, argument: 'caps at 5' }]))]),
                         leg: leg('gemini', defenseOut([{ id: 'A1', action, argument: 'caps at 5' }])) } },
      waves: { 'r-rv': wave([leg('gpt', revoteOut([{ id: 'A1', verdict: 'agree' }])),
                             leg('qwen', revoteOut([{ id: 'A1', verdict: 'dispute' }]))]) },
    };
    return runDebate(ctxFor(tmp, fakeLaunchers(script, null)), { provisionalRecord, tallyInput: input });
  }

  test.each([['toString'], ['__proto__']])(
    'a defense action of %j is normalised to "no-response" by the parseDebateDefense allowlist before PAST_TENSE ever sees it — addendumOutcomes[].action is a STRING, surviving JSON.stringify',
    async (action) => {
      const result = await runWithAction(action);
      const a1 = result.addendumOutcomes.find(o => o.id === 'A1');
      // Same shape as debate.test.js's D1/D2: toEqual alone cannot tell a
      // MISSING key from an undefined value, so assert the type explicitly
      // and round-trip through JSON.stringify — debate.json is exactly what
      // addendumOutcomes feeds (briefings-debate.js's chair addendum).
      expect(typeof a1.action).toBe('string');
      expect(a1.action).toBe('no-response');
      const onDisk = JSON.parse(JSON.stringify(result.addendumOutcomes));
      const a1OnDisk = onDisk.find(o => o.id === 'A1');
      expect(a1OnDisk).toHaveProperty('action');
      expect(a1OnDisk.action).toBe('no-response');
    },
  );

  test('CONTROL: the harness really does deliver a recognised action end to end (defend -> defended)', () => {
    // Guards the two tests above against a fixture bug that would make EVERY
    // action normalise to 'no-response' regardless of parseDebateDefense's
    // allowlist (e.g. a missing `argument`, which silently fails the 'defend'
    // branch) — exactly the failure this control caught while this test was
    // being written: an early draft omitted `argument` and 'defend' itself
    // read back as 'no-response', which would have made the two tests above
    // pass for the wrong reason.
    return runWithAction('defend').then((result) => {
      expect(result.debateFindings[0]).toMatchObject({ action: 'defend' });
      expect(result.addendumOutcomes.find(o => o.id === 'A1').action).toBe('defended');
    });
  });
});

// Named mutant "ACTIONPASSTHRU" (v4.8 Phase 6 PR1 Task 3 fix round 2, SI-24):
// remove parseDebateDefense's allowlist fallthrough so an unmatched action
// passes through verbatim instead of defaulting to 'no-response'.
//   } // else leave as no-response
//   -> } else { byId[id] = { action: r.action }; }
// (src/council/parse-stage2.js, inside parseDebateDefense's response loop.)
//
// Introduced at this task. RED: 1 test / 1 suite (command `npx jest
// --no-coverage`, the FULL suite):
//   tests/council/parse-debate.test.js — "parseDebateDefense — good input ›
//     present-but-invalid entries become no-response without triggering a
//     repair" (PRE-EXISTING coverage, not written by this task — its
//     "present-but-invalid" fixture omits `argument` on a `'defend'` entry,
//     which the allowlist rejects and this mutant lets through unchanged).
//
// ⚠️ THIS ALONE DOES NOT RED THE TWO TESTS ABOVE — measured, not assumed, and
// exactly the outcome the brief for this fix round anticipated as a possible
// finding ("if they still do not red under ACTIONPASSTHRU... chase it and
// report, do not force it"). Chased: with PAST_TENSE still `__proto__: null`
// (unmutated), an unmatched action passed through by this mutant (e.g.
// 'toString') reaches `PAST_TENSE['toString']`, which is a safe `undefined`
// — the null prototype alone is sufficient to keep `addendumOutcomes[].action`
// a string even once the allowlist stops normalising. The two tests above pin
// a DEFENSE-IN-DEPTH property (either guard alone is enough), which by
// construction has no SINGLE-mutation red — it needs both guards broken at
// once. See "DOUBLEBREACH" below, the compound mutant that actually covers
// them, and the updated PROTOACTION record in debate.test.js.
//
// NO PIN THAT PRE-DATES THIS TASK REDS.

// Named mutant "DOUBLEBREACH" (v4.8 Phase 6 PR1 Task 3 fix round 2, SI-24): a
// COMPOUND mutant — ACTIONPASSTHRU (above) applied TOGETHER with PROTOACTION
// (debate.test.js's record: revert PAST_TENSE's literal to drop
// `__proto__: null`). Neither guard alone is a live defect (both are
// defense-in-depth, per ACTIONPASSTHRU's record above and PROTOACTION's own
// "why it does not grow" note) — this is the mutant that actually reaches the
// two tests in the describe block above, because it breaks BOTH layers at
// once, the only way `addendumOutcomes[].action` can become a non-string.
//
// Introduced at this task. RED: 6 tests / 3 suites (command `npx jest
// --no-coverage`, the FULL suite, both mutations hand-applied together):
//   tests/council/run-debate.test.js — the two tests THIS record exists for:
//     'a defense action of "toString" is normalised to "no-response" by the
//     parseDebateDefense allowlist before PAST_TENSE ever sees it —
//     addendumOutcomes[].action is a STRING, surviving JSON.stringify' ·
//     the same test for "__proto__"
//   tests/council/parse-debate.test.js — "present-but-invalid entries become
//     no-response without triggering a repair" (ACTIONPASSTHRU's own red,
//     unioned in — it does not depend on PROTOACTION)
//   tests/council/debate.test.js — D1 ('toString'), D2 ('__proto__'), D2
//     ('constructor') (PROTOACTION's own red, unioned in — it does not
//     depend on ACTIONPASSTHRU)
//
// The CONTROL test ('defend' -> 'defended') does NOT red under either mutant
// alone or combined — it never touches the allowlist's fallthrough branch or
// an inherited PAST_TENSE key, by construction.
//
// Applied and reverted together as a pair, never independently, for this
// record: guard clean before, both hand-applied, guard clean after (only
// these two files modified — no contamination from the concurrent Task 2
// review agent), both hand-reverted and byte-verified separately against
// `git show HEAD:<path>` (sha256 match, both files) before re-confirming
// green. Same full-suite denominator as ACTIONPASSTHRU's own run except for
// the 5 additional reds: 544 suites (541 passed / 3 failed), 7847 tests
// (7833 passed / 6 failed / 8 skipped), 4 snapshots passed and unchanged.
//
// NO PIN THAT PRE-DATES THIS TASK REDS.

// ---- carry-forward gap 3b: withdrawn findings NEVER reach the re-vote bundle (spec §5.1) ----
describe('runDebate — withdrawn findings are excluded from the re-vote bundle', () => {
  let tmp, result, launched;
  beforeAll(async () => {
    tmp = mkTmp('run-debate-withdraw-');
    const input = provisionalInput();
    input.findings.unshift({ id: 'A2', raiser: 'gemini', severity: 'major', claim: 'unbounded queue growth' });
    input.adjudications.push(
      { findingId: 'A2', judge: 'gpt', verdict: 'dispute' },
      { findingId: 'A2', judge: 'qwen', verdict: 'dispute' });
    const provisionalRecord = tally(input);
    launched = [];
    const out = defenseOut([
      { id: 'A1', action: 'defend', argument: 'caps at 5' },
      { id: 'A2', action: 'withdraw' },
    ]);
    result = await runDebate(ctxFor(tmp, fakeLaunchers({
      solos: { 'r-d1': { wave: wave([leg('gemini', out)]), leg: leg('gemini', out) } },
      waves: { 'r-rv': wave([leg('gpt', revoteOut([{ id: 'A1', verdict: 'agree' }])),
                             leg('qwen', revoteOut([{ id: 'A1', verdict: 'dispute' }]))]) },
    }, launched)), { provisionalRecord, tallyInput: input });
  });

  test('the round counts one defended and one withdrawn', () => {
    expect(result.debateSummary).toMatchObject({ defended: 1, withdrawn: 1, disputed: 2 });
  });

  test('revote-bundle.md holds the defended finding and NOT the withdrawn one', () => {
    const bundle = fs.readFileSync(path.join(tmp, 'revote-bundle.md'), 'utf-8');
    expect(bundle).toContain('infinite retry');
    expect(bundle).not.toContain('unbounded queue growth');
    expect(bundle).not.toContain('A2');
  });

  test('the launched re-vote prompt is that same bundle — buildRevoteBundle is a trusting renderer', () => {
    const rv = launched.find(o => o.waveId === 'r-rv');
    expect(rv.prompt).not.toContain('unbounded queue growth');
    expect(rv.prompt).toBe(fs.readFileSync(path.join(tmp, 'revote-bundle.md'), 'utf-8'));
  });

  test('the withdrawn finding stays in findings[] and is decorated withdrawn', () => {
    expect(result.debatedInput.findings.some(f => f.id === 'A2')).toBe(true);
    const a2 = result.addendumOutcomes.find(o => o.id === 'A2');
    expect(a2.action).toBe('withdrawn');
    expect(VALID_ADDENDUM_ACTIONS.has(a2.action)).toBe(true);
    expect(a2.revotes).toEqual({});
  });
});

describe('runDebate — a dead defense solo degrades and leaves the originals standing', () => {
  let tmp, result;
  beforeAll(async () => {
    tmp = mkTmp('run-debate-dead-');
    const input = provisionalInput();
    const provisionalRecord = tally(input);
    result = await runDebate(ctxFor(tmp, {
      launchSolo: async () => ({ wave: wave([]), leg: null, exitCode: 0 }),
      launchWave: async () => { throw new Error('no re-vote wave expected'); },
    }), { provisionalRecord, tallyInput: input });
  });

  test('every bundled id becomes no-response (spec §5.7) and the run degrades', () => {
    expect(result.degraded).toBe(true);
    expect(result.debateSummary.outcome).toBe('ran');
    expect(result.debateSummary.noResponse).toBe(1);
    expect(result.debateFindings).toEqual([
      expect.objectContaining({ id: 'A1', action: 'no-response', previousTier: 'Disputed' })]);
  });

  test('the addendum renders the no-response action, not undefined', () => {
    const a1 = result.addendumOutcomes.find(o => o.id === 'A1');
    expect(a1.action).toBe('no-response');
    expect(VALID_ADDENDUM_ACTIONS.has(a1.action)).toBe(true);
  });

  test('no adjudication changed — the original verdicts stand', () => {
    const rec = tally(result.debatedInput);
    expect(rec.findings.find(f => f.id === 'A1').tier).toBe('Disputed');
    expect(result.verdictChanges).toBe(0);
  });
});

describe('runDebate — one bounded repair per defense solo', () => {
  test('an unstructured defense is repaired once; the repaired leg is what gets materialized', async () => {
    const tmp = mkTmp('run-debate-repair-');
    const input = provisionalInput();
    const provisionalRecord = tally(input);
    const seen = [];
    const good = defenseOut([{ id: 'A1', action: 'amend', claim: 'retry caps at 5', argument: 'measured' }]);
    const result = await runDebate(ctxFor(tmp, {
      launchSolo: async (opts) => {
        seen.push(opts.waveId);
        const summary = opts.waveId === 'r-d1' ? 'prose only, no json block' : good;
        return { wave: wave([leg('gemini', summary, opts.waveId)]), leg: leg('gemini', summary, opts.waveId), exitCode: 0 };
      },
      launchWave: async (opts) => ({ wave: wave([leg('gpt', revoteOut([{ id: 'A1', verdict: 'agree' }]), opts.waveId)]), exitCode: 0 }),
    }), { provisionalRecord, tallyInput: input });

    expect(seen).toEqual(['r-d1', 'r-d1r']);
    expect(result.debateSummary.amended).toBe(1);
    expect(result.degraded).toBe(false);                        // 'repaired', not 'unstructured'
    expect(result.defenseLegs[0].conformance).toBe('repaired');
    expect(fs.readFileSync(path.join(tmp, 'rebuttal-gemini.md'), 'utf-8')).toBe(good);
    // The amended claim reaches the re-vote bundle marked AMENDED (spec §5.3b).
    const bundle = fs.readFileSync(path.join(tmp, 'revote-bundle.md'), 'utf-8');
    expect(bundle).toContain('**AMENDED**');
    expect(bundle).toContain('retry caps at 5');
  });

  test('LC-12: the defense repair solo carries the defense it is repairing', async () => {
    // A repair solo is a FRESH session. Shipping only the validation errors asked
    // the raiser to correct a defense it had never seen.
    const tmp = mkTmp('run-debate-repair-artifact-');
    const input = provisionalInput();
    const bad = 'I defend A1 at length in prose, but I never emitted a json block.';
    const good = defenseOut([{ id: 'A1', action: 'defend', argument: 'measured' }]);
    const prompts = {};
    await runDebate(ctxFor(tmp, {
      launchSolo: async (opts) => {
        prompts[opts.waveId] = opts.prompt;
        const summary = opts.waveId === 'r-d1' ? bad : good;
        return { wave: wave([leg('gemini', summary, opts.waveId)]), leg: leg('gemini', summary, opts.waveId), exitCode: 0 };
      },
      launchWave: async (opts) => ({ wave: wave([leg('gpt', revoteOut([{ id: 'A1', verdict: 'agree' }]), opts.waveId)]), exitCode: 0 }),
    }), { provisionalRecord: tally(input), tallyInput: input });

    expect(prompts['r-d1r']).toContain(bad);
    expect(prompts['r-d1r']).toContain('YOUR PREVIOUS DEFENSE');
  });
});

// ---- re-vote repair branch (run-debate-revote.js :: runRevoteWave) — an ALIVE-but-unparseable judge leg is
// the only door into this branch: a DEAD leg (mkLeg(model, '', 'error')) never reaches it.
describe('runDebate — re-vote repair branch', () => {
  describe('repair SUCCEEDS: an alive-but-unstructured judge leg is repaired once, and the repair is used', () => {
    let tmp, result, launched, midRepairStage;
    const repaired = revoteOut([{ id: 'A1', verdict: 'agree' }]);
    beforeAll(async () => {
      tmp = mkTmp('run-debate-revote-repair-');
      const input = provisionalInput();
      const provisionalRecord = tally(input);
      launched = [];
      const stageOf = (name) => ((runState.readRun(tmp) || {}).stages || []).find(s => s.name === name) || null;
      const defended = defenseOut([{ id: 'A1', action: 'defend', argument: 'caps at 5' }]);
      const script = {
        solos: {
          'r-d1': { wave: wave([leg('gemini', defended)]), leg: leg('gemini', defended) },
          // The repair, launched solo to the SAME judge (waveId `${waveId}-${judge}r`).
          'r-rv-gptr': { wave: wave([leg('gpt', repaired)]), leg: leg('gpt', repaired) },
        },
        // gpt's first attempt is ALIVE (status complete, non-empty summary) but carries no
        // parseable json block — the only way into the repair branch. qwen parses cleanly.
        waves: { 'r-rv': wave([leg('gpt', 'prose only, no json block'),
                               leg('qwen', revoteOut([{ id: 'A1', verdict: 'dispute' }]))]) },
      };
      const base = fakeLaunchers(script, launched);
      // Observe run.json from INSIDE the repair launch: proves the repair's waveId was
      // registered (abort-cascade guard) BEFORE the leg went in flight.
      const launchers = {
        launchSolo: (opts) => {
          if (opts.waveId === 'r-rv-gptr') { midRepairStage = stageOf('debate-revote'); }
          return base.launchSolo(opts);
        },
        launchWave: (opts) => base.launchWave(opts),
      };
      result = await runDebate(ctxFor(tmp, launchers), { provisionalRecord, tallyInput: input });
    });

    test('the repair waveId is registered on debate-revote BEFORE the repair leg goes in flight', () => {
      expect(midRepairStage.waveIds).toContain('r-rv-gptr');
    });

    test('LC-12: the repair solo carries the unparseable re-vote it is repairing', () => {
      const repairCall = launched.find(o => o.waveId === 'r-rv-gptr');
      expect(repairCall.prompt).toContain('prose only, no json block');
      expect(repairCall.prompt).toContain('YOUR PREVIOUS RE-VOTE');
    });

    test("the repaired leg's conformance is 'repaired', and the round is not degraded", () => {
      const gptLeg = result.revoteLegs.find(l => l.model === 'gpt');
      expect(gptLeg.conformance).toBe('repaired');
      expect(result.degraded).toBe(false);
    });

    test('revote-gpt.md holds the POST-repair body, not the unstructured first attempt', () => {
      const body = fs.readFileSync(path.join(tmp, 'revote-gpt.md'), 'utf-8');
      expect(body).toBe(repaired);
      expect(body).not.toContain('prose only, no json block');
    });

    test('the repaired verdict actually applies to the final tally (gpt now agrees)', () => {
      const rec = tally(result.debatedInput);
      const a1 = rec.findings.find(f => f.id === 'A1');
      // gpt repaired → agree, qwen clean → dispute: a=1,d=1 → Contested.
      expect(a1.basis).toEqual({ a: 1, d: 1, n: 0 });
      expect(a1.tier).toBe('Contested');
      const doc = JSON.parse(fs.readFileSync(path.join(tmp, 'debate.json'), 'utf-8'));
      expect(doc.revotes).toEqual(expect.arrayContaining([
        expect.objectContaining({ judge: 'gpt', id: 'A1', verdict: 'agree', applied: true }),
      ]));
    });
  });

  describe('repair is EXHAUSTED: the repair output is also unparseable', () => {
    let tmp, result, launched;
    beforeAll(async () => {
      tmp = mkTmp('run-debate-revote-exhausted-');
      const input = provisionalInput();
      const provisionalRecord = tally(input);
      launched = [];
      const defended = defenseOut([{ id: 'A1', action: 'defend', argument: 'caps at 5' }]);
      const script = {
        solos: {
          'r-d1': { wave: wave([leg('gemini', defended)]), leg: leg('gemini', defended) },
          // The repair ALSO fails to parse — exhausted, per spec §5.7 only ONE repair is spent.
          'r-rv-gptr': { wave: wave([leg('gpt', 'still no json block')]), leg: leg('gpt', 'still no json block') },
        },
        waves: { 'r-rv': wave([leg('gpt', 'prose only, no json block'),
                               leg('qwen', revoteOut([{ id: 'A1', verdict: 'agree' }]))]) },
      };
      const launchers = fakeLaunchers(script, launched);
      result = await runDebate(ctxFor(tmp, launchers), { provisionalRecord, tallyInput: input });
    });

    test('exactly ONE repair is attempted for the exhausted judge, never two', () => {
      const waveIds = launched.map(o => o.waveId);
      expect(waveIds.filter(id => id === 'r-rv-gptr')).toHaveLength(1);
      expect(waveIds.sort()).toEqual(['r-d1', 'r-rv', 'r-rv-gptr']);
    });

    test("the leg's conformance is 'unstructured', and the round degrades", () => {
      const gptLeg = result.revoteLegs.find(l => l.model === 'gpt');
      expect(gptLeg.conformance).toBe('unstructured');
      expect(result.degraded).toBe(true);
    });

    test("the judge's ORIGINAL Stage-2 verdict stands — the exhausted re-vote is discarded, not applied empty", () => {
      const rec = tally(result.debatedInput);
      const a1 = rec.findings.find(f => f.id === 'A1');
      // gpt's ORIGINAL dispute stands (exhausted re-vote discarded); qwen's clean agree applies.
      expect(a1.basis).toEqual({ a: 1, d: 1, n: 0 });
      expect(a1.tier).toBe('Contested');
      const doc = JSON.parse(fs.readFileSync(path.join(tmp, 'debate.json'), 'utf-8'));
      expect(doc.revotes.some(r => r.judge === 'gpt')).toBe(false);
      expect(doc.revotes).toEqual(expect.arrayContaining([
        expect.objectContaining({ judge: 'qwen', id: 'A1', verdict: 'agree', applied: true }),
      ]));
    });
  });
});

// ---- v4.7 D2/E4: superseded pre-repair legs + failed-repair rows, end to end ----
describe('runDebate — v4.7 D2/E4 debate rows: superseded pre-repair legs and failed-repair rows', () => {
  test('a successful defense repair supersedes the original leg — waveIds -d1 (superseded) vs -d1r (primary)', async () => {
    const tmp = mkTmp('run-debate-repair-superseded-');
    const input = provisionalInput();
    const provisionalRecord = tally(input);
    const good = defenseOut([{ id: 'A1', action: 'defend', argument: 'measured' }]);
    const result = await runDebate(ctxFor(tmp, {
      launchSolo: async (opts) => {
        const summary = opts.waveId === 'r-d1' ? 'prose only, no json block' : good;
        return { wave: wave([leg('gemini', summary, opts.waveId)]), leg: leg('gemini', summary, opts.waveId), exitCode: 0 };
      },
      launchWave: async () => ({ wave: wave([leg('gpt', revoteOut([{ id: 'A1', verdict: 'agree' }]), 'r-rv')]), exitCode: 0 }),
    }), { provisionalRecord, tallyInput: input });

    const rows = result.debatedInput.runStats.filter(r => r.model === 'gemini');
    expect(rows).toHaveLength(2);                            // exactly one extra row, never two
    const primary = rows.find(r => r.role === 'rebuttal');
    const superseded = rows.find(r => r.role === 'superseded');
    expect(primary).toMatchObject({ waveId: 'r-d1r', conformance: 'repaired' });
    expect(superseded).toMatchObject({ waveId: 'r-d1', conformance: 'unstructured', wasChair: false });
  });

  test('a re-vote repair that never completes keeps the primary on the original and adds its own repair row', async () => {
    const tmp = mkTmp('run-debate-repair-failed-row-');
    const input = provisionalInput();
    const provisionalRecord = tally(input);
    const defended = defenseOut([{ id: 'A1', action: 'defend', argument: 'caps at 5' }]);
    const result = await runDebate(ctxFor(tmp, {
      launchSolo: async (opts) => {
        if (opts.waveId === 'r-d1') { return { wave: wave([leg('gemini', defended, 'r-d1')]), leg: leg('gemini', defended, 'r-d1'), exitCode: 0 }; }
        if (opts.waveId === 'r-rv-gptr') {
          // A repair that LAUNCHED but never reached 'complete' (timeout) — the
          // real leg carries its own waveId, unlike a wholesale-dead wave.
          const dead = { model: 'gpt', modelInput: 'gpt', status: 'timeout', summary: '', waveId: 'r-rv-gptr', durationMs: 5000, usage: null };
          return { wave: { status: 'timeout', legs: [dead] }, leg: dead, exitCode: 0 };
        }
        throw new Error(`unscripted solo waveId ${opts.waveId}`);
      },
      launchWave: async () => ({
        // Two judges share ONE wave: each needs its OWN roster slot (gpt=1, qwen=2)
        // — leg()'s default slot=1 is only correct for a solo's single-model roster.
        wave: wave([leg('gpt', 'prose only, no json block', 'r-rv', 1),
                    leg('qwen', revoteOut([{ id: 'A1', verdict: 'agree' }]), 'r-rv', 2)]),
        exitCode: 0,
      }),
    }), { provisionalRecord, tallyInput: input });

    const rows = result.debatedInput.runStats.filter(r => r.model === 'gpt');
    expect(rows).toHaveLength(2);                            // exactly one extra row, never two
    const primary = rows.find(r => r.role === 'revote');
    const repair = rows.find(r => r.role === 'repair');
    expect(primary).toMatchObject({ waveId: 'r-rv', conformance: 'unstructured' }); // primary stays on the ORIGINAL
    expect(repair).toMatchObject({ waveId: 'r-rv-gptr', status: 'timeout', conformance: 'unstructured', wasChair: false });
  });
});

describe('runDebate — cost ceiling is a WHOLE-ROUND gate before the re-vote wave (spec §5.7)', () => {
  test('over budget after the defense wave skips the re-vote and reports skipped-cost-ceiling', async () => {
    const tmp = mkTmp('run-debate-cc-');
    const input = provisionalInput();
    const provisionalRecord = tally(input);
    const ctx = ctxFor(tmp, {
      launchSolo: async (opts) => {
        const out = defenseOut([{ id: 'A1', action: 'defend', argument: 'caps at 5' }]);
        return { wave: wave([leg('gemini', out, opts.waveId)]), leg: leg('gemini', out, opts.waveId), exitCode: 0 };
      },
      launchWave: async () => { throw new Error('re-vote wave must not launch over budget'); },
    });
    ctx.overBudget = () => true;
    const result = await runDebate(ctx, { provisionalRecord, tallyInput: input });

    expect(result.debateSummary.outcome).toBe('skipped-cost-ceiling');
    expect(result.degraded).toBe(true);
    expect(result.debateSummary.revoteJudges).toBe(0);
    expect(fs.existsSync(path.join(tmp, 'revote-bundle.md'))).toBe(false);
    // 4.1.1 Fix C: the cost ceiling skipped the wave — run.js must not
    // checkpoint debate-revote 'complete' for this (nothing launched).
    expect(result.revoteLaunched).toBe(false);
  });

  test('nothing to re-vote (all withdrawn) is NOT a cost-ceiling degradation', async () => {
    const tmp = mkTmp('run-debate-nowd-');
    const input = provisionalInput();
    const provisionalRecord = tally(input);
    const out = defenseOut([{ id: 'A1', action: 'withdraw' }]);
    const result = await runDebate(ctxFor(tmp, {
      launchSolo: async (opts) => ({ wave: wave([leg('gemini', out, opts.waveId)]), leg: leg('gemini', out, opts.waveId), exitCode: 0 }),
      launchWave: async () => { throw new Error('no re-vote wave expected'); },
    }), { provisionalRecord, tallyInput: input });

    expect(result.debateSummary.outcome).toBe('ran');
    expect(result.degraded).toBe(false);
    // 4.1.1 Fix C: nothing was defended/amended, so the wave never launched —
    // 'ran' as the debate OUTCOME is correct, but the re-vote sub-stage did
    // not, and run.js must not checkpoint it 'complete'.
    expect(result.revoteLaunched).toBe(false);
  });
});

describe('runDebate — abort short-circuits the round', () => {
  test('an abort exit code from a defense solo returns {aborted, contested, disputed} and writes no debate.json', async () => {
    const tmp = mkTmp('run-debate-abort-');
    const input = provisionalInput();
    const provisionalRecord = tally(input);
    const result = await runDebate(ctxFor(tmp, {
      launchSolo: async () => ({ wave: wave([]), leg: null, exitCode: 143 }),
      launchWave: async () => { throw new Error('no re-vote wave expected'); },
    }), { provisionalRecord, tallyInput: input });

    expect(result).toEqual({ aborted: 143, contested: 0, disputed: 1 });
    expect(fs.existsSync(path.join(tmp, 'debate.json'))).toBe(false);
  });

  test('an abort exit code from the re-vote wave short-circuits too', async () => {
    const tmp = mkTmp('run-debate-abort-rv-');
    const input = provisionalInput();
    const provisionalRecord = tally(input);
    const out = defenseOut([{ id: 'A1', action: 'defend', argument: 'caps at 5' }]);
    const result = await runDebate(ctxFor(tmp, {
      launchSolo: async (opts) => ({ wave: wave([leg('gemini', out, opts.waveId)]), leg: leg('gemini', out, opts.waveId), exitCode: 0 }),
      launchWave: async () => ({ wave: wave([]), exitCode: 130 }),
    }), { provisionalRecord, tallyInput: input });

    expect(result).toEqual({ aborted: 130, contested: 0, disputed: 1 });
    expect(fs.existsSync(path.join(tmp, 'debate.json'))).toBe(false);
  });
});

describe('runDebate — defense solos run CONCURRENTLY (spec §5.1)', () => {
  test('two raisers are in flight at the same time', async () => {
    const tmp = mkTmp('run-debate-conc-');
    const input = provisionalInput();
    // Make B1 Disputed too, so gpt is a SECOND raiser with its own defense solo.
    input.adjudications = [
      { findingId: 'A1', judge: 'gpt', verdict: 'dispute' },
      { findingId: 'A1', judge: 'qwen', verdict: 'dispute' },
      { findingId: 'B1', judge: 'gemini', verdict: 'dispute' },
      { findingId: 'B1', judge: 'qwen', verdict: 'dispute' },
    ];
    const provisionalRecord = tally(input);
    let inFlight = 0;
    let maxInFlight = 0;
    const launchers = {
      launchSolo: async ({ waveId, model }) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise(r => setTimeout(r, 5));
        inFlight -= 1;
        // Both withdraw ⇒ nothing defended/amended ⇒ the re-vote wave never launches.
        const out = defenseOut([{ id: waveId === 'r-d1' ? 'A1' : 'B1', action: 'withdraw' }]);
        return { wave: wave([leg(model, out, waveId)]), leg: leg(model, out, waveId), exitCode: 0 };
      },
      launchWave: async () => { throw new Error('no re-vote wave expected'); },
    };
    await runDebate(ctxFor(tmp, launchers), { provisionalRecord, tallyInput: input });
    expect(maxInFlight).toBe(2);   // a sequential `await` in a for-loop caps this at 1
  });
});

// ============================================================================
// v4.8 PR3 Task 6 — the debate round on a TWIN bench: every JOIN moves to the
// seat, every LAUNCH argument stays a routable bench alias.
// ============================================================================
describe('runDebate — twin bench: joins on the seat, launches on the alias', () => {
  let tmp, result, launched, ctx;
  const bothDefended = defenseOut([
    { id: 'A1', action: 'defend', argument: 'caps at 5' },
    { id: 'B1', action: 'defend', argument: 'bounded by config' },
  ]);
  const agreeBoth = revoteOut([{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'agree' }]);
  const disputeBoth = revoteOut([{ id: 'A1', verdict: 'dispute' }, { id: 'B1', verdict: 'dispute' }]);

  beforeAll(async () => {
    tmp = mkTmp('run-debate-twin-');
    const input = twinInput();
    const provisionalRecord = tally(input);
    launched = [];
    const script = {
      solos: {
        // deepseek#1's defense is unparseable → one repair. That repair solo is
        // the launch site the spec and two plan drafts both missed: a seat id
        // there is a non-routable model name on a REAL paid leg.
        'r-d1': { wave: wave([leg('deepseek', 'prose only, no json block')]) },
        'r-d1r': { wave: wave([leg('deepseek', bothDefended)]) },
        'r-d2': { wave: wave([leg('deepseek', bothDefended)]) },
        // One re-vote repair per twin judge — DISTINCT ids only once the repair
        // id is built from the seat key (today both are `r-rv-deepseekr`).
        'r-rv-deepseek-1r': { wave: wave([leg('deepseek', disputeBoth)]) },
        'r-rv-deepseek-2r': { wave: wave([leg('deepseek', agreeBoth)]) },
      },
      // The wave answers with one leg per disputing SEAT, in roster order
      // (gpt, deepseek#2, deepseek#1) — both twin legs alive-but-unparseable,
      // the only door into the re-vote repair branch.
      waves: {
        'r-rv': wave([leg('gpt', agreeBoth),
          leg('deepseek', 'prose only, no json block'),
          leg('deepseek', 'prose only, no json block')]),
      },
    };
    ctx = ctxFor(tmp, fakeLaunchers(script, launched), TWIN_BENCH);
    result = await runDebate(ctx, { provisionalRecord, tallyInput: input });
  });

  // ---- PARITY PIN (GREEN today, and green after Tasks 1-5). Its value is that
  // omitting the raiser-boundary projection turns it RED — a seat id in any of
  // the four model-carrying launch sites is a non-routable model name and a real
  // paid failure, not a test failure.
  test('PARITY PIN: every launcher model/models argument is a routable bench alias', () => {
    const captured = launched.flatMap(o => (o.models ? o.models : [o.model]));
    expect(captured.length).toBeGreaterThanOrEqual(5);   // 2 defense + 1 repair + wave + 2 repairs
    for (const m of captured) { expect(ctx.o.models).toContain(m); }
  });

  test('each twin raiser gets its OWN defense solo, both launched as the alias', () => {
    const solos = launched.filter(o => /^r-d\d+$/.test(o.waveId));
    expect(solos.map(o => o.waveId).sort()).toEqual(['r-d1', 'r-d2']);
    expect(solos.map(o => o.model)).toEqual(['deepseek', 'deepseek']);
  });

  // §3.3: defenseByRaiser MUST stay seat-keyed. Re-keying it to the alias is
  // last-wins and silently drops one twin's entire debate row.
  test('both twins keep their debate row — defenseByRaiser is seat-keyed, never last-wins', () => {
    expect(result.debateFindings.map(d => [d.id, d.raiser]).sort())
      .toEqual([['A1', 'deepseek#1'], ['B1', 'deepseek#2']]);
    expect(result.debateSummary.defended).toBe(2);
  });

  // R3-2: one re-vote leg per disputing SEAT, not per alias.
  test('the -rv roster is one entry per disputing seat', () => {
    const rv = launched.find(o => o.waveId === 'r-rv');
    expect(rv.models).toEqual(['gpt', 'deepseek', 'deepseek']);
    expect(result.debateSummary.revoteJudges).toBe(3);
  });

  test('each twin judge gets its OWN re-vote repair id', () => {
    const repairIds = launched.map(o => o.waveId).filter(id => /^r-rv-.+r$/.test(id));
    expect(repairIds.sort()).toEqual(['r-rv-deepseek-1r', 'r-rv-deepseek-2r']);
  });

  // R3-3 / Step 8: without a seat-named artifact both twins write the same file
  // and one clobbers the other.
  test('rebuttal-/revote- artifacts are seat-named, so twins never clobber one file', () => {
    for (const f of ['rebuttal-deepseek-1.md', 'rebuttal-deepseek-2.md',
      'revote-gpt.md', 'revote-deepseek-1.md', 'revote-deepseek-2.md']) {
      expect(fs.existsSync(path.join(tmp, f))).toBe(true);
    }
  });

  // Step 9: debate.json's `revotes[]` has a REAL consumer that joins on the
  // alias (electron/workspace-ui/workspace-panels.js's drillIntoJudge, :98-100),
  // so the seat rides ALONGSIDE rather than replacing it.
  test('debate.json keeps the alias join and carries the seat beside it', () => {
    const doc = JSON.parse(fs.readFileSync(path.join(tmp, 'debate.json'), 'utf-8'));
    expect(doc.revotes.every(r => r.judge === 'gpt' || r.judge === 'deepseek')).toBe(true);
    expect(doc.revotes.some(r => r.seat === 'deepseek#1')).toBe(true);
    expect(doc.revotes.some(r => r.seat === 'deepseek#2')).toBe(true);
  });

  // Step 9: priorVerdicts and revotes must be keyed in the SAME space —
  // briefings-debate.js :: buildDebateAddendum looks up prior[j] over Object.keys(revotes), so a
  // skew prints `no prior verdict` on every line.
  test('priorVerdicts and the re-vote map share ONE key space', () => {
    const a1 = result.addendumOutcomes.find(o => o.id === 'A1');
    expect(a1.priorVerdicts).toEqual({ gpt: 'dispute', 'deepseek#2': 'dispute' });
    expect(Object.keys(a1.revotes).sort()).toEqual(['deepseek#1', 'deepseek#2', 'gpt']);
    for (const j of Object.keys(a1.priorVerdicts)) { expect(a1.revotes[j]).toBeDefined(); }
  });

  // Step 10 INVARIANT (GREEN today; Step 2 changes the SPACE the literals read,
  // so holding those lines constant is exactly what would break it).
  test('every debate runStats row carries a bench alias, never a seat id', () => {
    const DEBATE = new Set(['rebuttal', 'revote', 'superseded', 'repair']);
    const rows = result.debatedInput.runStats.filter(r => DEBATE.has(r.role));
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(result.debatedInput.meta.models).toContain(r.model);
      expect(r.model).not.toMatch(/#/);
      expect('seat' in r).toBe(false);          // that field is PR4's
    }
  });

  // The point of the whole task: each twin's re-vote lands on ITS OWN
  // adjudication instead of failing open into an invented row.
  test('each twin re-vote lands on its own adjudication row', () => {
    const rows = result.debatedInput.adjudications.filter(a => a.findingId === 'A1');
    expect(rows.find(a => (a.seat || a.judge) === 'gpt').verdict).toBe('agree');
    expect(rows.find(a => (a.seat || a.judge) === 'deepseek#2').verdict).toBe('agree');
    // deepseek#1 RAISED A1, so it never adjudicated it — its stateless re-vote
    // legitimately appends (the same contract debate.test.js pins for gpt/A2),
    // and the appended row carries the ALIAS in `judge` with the seat beside it.
    expect(rows.find(a => (a.seat || a.judge) === 'deepseek#1'))
      .toEqual({ findingId: 'A1', judge: 'deepseek', verdict: 'dispute', seat: 'deepseek#1' });
    expect(rows).toHaveLength(3);
  });
});

// ============================================================================
// T5.1 (SI-10/R8): refuse a re-vote whose key this wave cannot account for —
// its key names none of the judges this wave actually launched — and announce
// it. ⚠️ This read "it NEITHER bound to any roster slot NOR names one of the
// judges this wave actually launched" until T5.5 deleted the `boundLegs` arm.
// Binding is no longer part of the condition and the refusal set is now the
// strict superset. That sentence was the verbatim TWIN of the one repaired in
// run-debate-revote.js :: reVoteUnboundNote's docblock — same branch, same
// commit, different file — and this file's own T5.5 block below already
// contradicted it. Grep the distinctive phrase repo-wide when you edit a
// sentence like this; a same-file sweep cannot find twins, and a whole-repo
// one found no fifth copy. Driving runRevoteWave DIRECTLY (Task 1 of
// docs/superpowers/plans/2026-08-21-v48-phase5-debate-join.md),
// never through runDebate/runCouncil's fakeLaunchers. fakeLaunchers'
// run-debate.test.js :: stampFanout (above) re-stamps taskId/waveId on every
// leg it sees (including its `k < 0` arm), so ANY leg routed through it
// always binds and a fixture built on it would be green at HEAD, proving
// nothing. Both tests below supply a bespoke launchWave that returns its
// wave's legs untouched, and make one leg unbindable by omitting BOTH
// waveId and taskId (leg()'s waveId argument left undefined) —
// seats.js :: bindSeats then has no id to match a roster slot AND its alias
// fallback requires leg.waveId === waveId, so omitting both skips it entirely.
//
// Named mutants, each hand-applied to run-debate-revote.js then reverted and
// byte-verified against a `cp` backup taken before mutating (diff empty) —
// red sets measured by running tests/council/run-debate.test.js +
// debate.test.js. Re-measured after review round 1 collapsed the guard's
// second arm from `rosterIds.has(key)` to `judgeKeys.includes(key)`, and
// AGAIN at T5.5 (2026-08-22) when the guard lost its `boundLegs` arm and
// three tests were added — that pass ran all six of run-debate.test.js +
// debate.test.js + run-stages.test.js + seat-space.test.js +
// degrade-sink.test.js + run-finalize.test.js (243 tests):
//   JOINBLIND  delete the new guard, restoring BASE's unconditional
//              `byJudge[key] = parsed.byId`. Red set (1): this file's "twin
//              bench, one twin leg unbindable" test below. ⚠️ GREW to (2)
//              once T5.2's end-to-end test existed further down this file
//              (re-measured there, under that task's own name E2EBLIND —
//              identical deletion, cross-checked against this one so this
//              count is not left stale). ⚠️ GREW AGAIN at T5.5 — to (5)
//              when its two refusal tests and its exit-2 composition test
//              entered the path, and to **(6)** in review round 1 when the
//              note-fallback test joined them (it asserts an exact `why`, and
//              with the guard gone there is no note at all). Re-measured
//              2026-08-22 across the six suites above. Deleting the guard reds
//              SIX tests; any smaller number written here is stale.
//   REFUSEALL  weaken the guard to `if (seat)` (refuse on bare `!seat`). Red
//              set (3): this file's "unique-alias bench, leg equally
//              unbindable" test AND its "roster hole whose leg is ALSO
//              unbindable" test (both below), AND the pre-existing §3.4
//              fixture's "M1: no `__unbound-` sentinel reaches
//              adjudications[].seat or the alias-space .judge (C1)" —
//              REFUSEALL over-refuses the placeholder-hole and roster-hole
//              cases too, not only the unique-alias one. (Grew from 2 to 3
//              when the roster-hole test was added — Global Constraint 3's
//              "proof that test entered the path.")
//   LEGDROP    `continue` right after the degrade note, so a refused leg
//              never reaches `legs.push` and loses its runStats row, its
//              revote-<name>.md and its conformance. Red set (1): this
//              file's "twin bench, one twin leg unbindable" test below,
//              whose `rv.legs` length/conformance/seat assertions are what
//              closes it — LEGDROP survived the entire suite (544 suites /
//              7812 tests, exit 0) before those assertions existed.
//              ⚠️ GREW to (2) at T5.5, re-measured 2026-08-22: that task's
//              "it BINDS to the placeholder slot … and is refused anyway"
//              test asserts the refused leg is STILL recorded
//              (`revoteLegs` seats `['gpt', null]`), so it reds too.
// ============================================================================
describe('runRevoteWave (T5.1, SI-10/R8) — refuse an unbindable leg that names no seat', () => {
  // No waveId argument -> run-debate.test.js :: leg (above) omits taskId/waveId entirely.
  const unboundLeg = (model, summary) => leg(model, summary);

  // RED-before-GREEN, measured directly against this test: with the new
  // guard removed (restoring BASE — the JOINBLIND mutant below), byJudge
  // gains a bare 'deepseek' key here and ctx.degrade.all() stays empty,
  // reproducing the SI-10 defect
  // (docs/superpowers/plans/2026-08-21-v48-phase5-debate-join.md §0.3's shape).
  test('twin bench, one twin leg unbindable: its key is withheld and announced, not invented', async () => {
    const tmp = mkTmp('run-revote-twin-unbound-');
    const seats = buildSeats(TWIN_BENCH, null, null);      // deepseek#1 / deepseek#2 / gpt
    const aliasOf = aliasOfFor(seats);
    const seatById = new Map(seats.map(s => [s.id, s]));
    // All THREE judgeKeys are REAL, resolvable seat ids (unlike the §3.4
    // placeholder-hole fixture above, where 'deepseek' is not a seat id at
    // all) — this wave's roster is fully real; only the deepseek#2 LEG fails
    // to bind, which is the defect this task fixes.
    const judgeKeys = ['gpt', 'deepseek#1', 'deepseek#2'];
    const judgeSeats = judgeKeys.map(k => seatById.get(k));
    const waveId = 'r-rv';
    const revoteLegs = [
      leg('gpt', revoteOut([{ id: 'A1', verdict: 'agree' }]), waveId, 1),
      leg('deepseek', revoteOut([{ id: 'A1', verdict: 'agree' }]), waveId, 2),   // deepseek#1: binds
      unboundLeg('deepseek', revoteOut([{ id: 'A1', verdict: 'dispute' }])),    // deepseek#2: orphaned
    ];
    const launchers = {
      launchWave: async () => ({ wave: wave(revoteLegs), exitCode: 0 }),
      launchSolo: async () => { throw new Error('unexpected repair: both legs parse cleanly'); },
    };
    const ctx = ctxFor(tmp, launchers, TWIN_BENCH);
    const bundleFindings = [{ id: 'A1', severity: 'major', amended: false,
      claim: 'infinite retry', argument: 'defended without extra argument' }];

    const rv = await runRevoteWave(ctx, judgeKeys, bundleFindings, judgeSeats, aliasOf);

    // No bare-alias 'deepseek' key — applyDebate's fail-open push would
    // otherwise turn it into a phantom adjudication row (debate.js :: applyDebate).
    expect(Object.keys(rv.byJudge).sort()).toEqual(['deepseek#1', 'gpt']);
    expect(rv.byJudge.deepseek).toBeUndefined();
    expect(rv.byJudge.gpt).toEqual({ A1: { verdict: 'agree' } });

    const notes = ctx.degrade.all();
    expect(notes).toHaveLength(1);
    expect(notes[0].channel).toBe('seat-unbound');
    expect(notes[0].data.judge).toBe('deepseek');
    expect(notes[0].data.waveId).toBe('r-rv');
    expect(notes[0].effect).toMatch(/not applied/i);
    expect(notes[0].effect).toMatch(/provisional verdict stands/i);

    // Important #2 (review round 1): ONLY the parsed votes are withheld —
    // the leg itself is still recorded (its runStats row, its
    // revote-<name>.md, its conformance), so it must still reach `legs`.
    // Named mutant LEGDROP (below) is what pins this: a `continue` right
    // after the note above survived the entire suite until this existed.
    expect(rv.legs).toHaveLength(3);
    const refusedLeg = rv.legs.find(l => l.seat === null);
    expect(refusedLeg).toMatchObject({ model: 'deepseek', conformance: 'clean', seat: null });
  });

  // Preservation: an unbindable leg on a bench with NO repeated alias must
  // still publish and still apply — seatKey(null, 'qwen') === 'qwen', which
  // IS that seat's own id (seats.js:67), so refusing it would be a
  // regression, not a fix (plan §0.5's "NOT `seat === null`" warning).
  // Named mutant REFUSEALL (weaken the guard to `!seat`) must red THIS test.
  test('unique-alias bench, leg equally unbindable: the key IS published and the re-vote still applies', async () => {
    const tmp = mkTmp('run-revote-unique-unbound-');
    const bench = ['gemini', 'gpt', 'qwen'];               // plan §0.5's own measured shape
    const seats = buildSeats(bench, null, null);
    const aliasOf = aliasOfFor(seats);
    const seatById = new Map(seats.map(s => [s.id, s]));
    const judgeKeys = ['gpt', 'qwen'];
    const judgeSeats = judgeKeys.map(k => seatById.get(k));
    const waveId = 'r-rv';
    const revoteLegs = [
      leg('gpt', revoteOut([{ id: 'A1', verdict: 'agree' }]), waveId, 1),
      unboundLeg('qwen', revoteOut([{ id: 'A1', verdict: 'agree' }])),   // qwen: orphaned
    ];
    const launchers = {
      launchWave: async () => ({ wave: wave(revoteLegs), exitCode: 0 }),
      launchSolo: async () => { throw new Error('unexpected repair: both legs parse cleanly'); },
    };
    const ctx = ctxFor(tmp, launchers, bench);
    const bundleFindings = [{ id: 'A1', severity: 'major', amended: false,
      claim: 'infinite retry', argument: 'defended without extra argument' }];

    const rv = await runRevoteWave(ctx, judgeKeys, bundleFindings, judgeSeats, aliasOf);

    expect(rv.byJudge.qwen).toEqual({ A1: { verdict: 'agree' } });
    expect(ctx.degrade.all()).toEqual([]);

    // And it still APPLIES through the real applyDebate join: qwen's
    // provisional dispute is REPLACED, not left standing and not duplicated.
    const tallyInput = {
      findings: [{ id: 'A1', raiser: 'gemini', severity: 'major', claim: 'infinite retry' }],
      adjudications: [
        { findingId: 'A1', judge: 'gpt', verdict: 'dispute' },
        { findingId: 'A1', judge: 'qwen', verdict: 'dispute' },
      ],
    };
    const { input } = applyDebate({ tallyInput, defenseByRaiser: {}, revoteByJudge: rv.byJudge, aliasOf });
    expect(input.adjudications).toHaveLength(2);   // no invented row
    expect(input.adjudications.find(a => (a.seat || a.judge) === 'qwen').verdict).toBe('agree');
  });

  // Important #1 (review round 1): a roster hole (a Stage-2-orphaned judge —
  // its bare alias is no seat id at all, so runRevoteWave pads a §3.4
  // placeholder for it) whose OWN -rv leg is ALSO unbindable. A third, distinct
  // shape from both tests above: unlike "twin bench, one twin leg unbindable"
  // (where every judgeKey resolves to a real seat), one judgeKey here —
  // 'deepseek' — does not (judgeSeats has a null for it); unlike the
  // "§3.4 placeholder contract" describe block below, this leg does not
  // bind to the placeholder either (fakeLaunchers' stampFanout would stamp
  // it there — this fixture deliberately withholds taskId/waveId instead,
  // the same trap-avoidance as every test in this block).
  //
  // Measured against BASE (the guard removed entirely): byJudge publishes
  // the bare 'deepseek' key, and applyDebate takes 2 adjudications in to 2
  // out — the seat-less provisional row's dispute correctly replaced by
  // agree, NO phantom row. `judgeKeys.includes(key)` is what preserves that:
  // 'deepseek' names no REAL seat, and this leg bound to nothing at all —
  // not even the §3.4 placeholder — but the key IS one of the judges this
  // wave launched (`judgeKeys` itself), so refusing it would discard a
  // re-vote BASE already joined correctly. ⚠️ This sentence also said the
  // leg was "absent from `boundLegs`"; T5.5 deleted that Set, and the fact
  // it named is carried by the clause before it.
  test('roster hole whose leg is ALSO unbindable: the key IS published and the re-vote still applies', async () => {
    const tmp = mkTmp('run-revote-hole-unbound-');
    const seats = buildSeats(TWIN_BENCH, null, null);
    const aliasOf = aliasOfFor(seats);
    const seatById = new Map(seats.map(s => [s.id, s]));
    // 'deepseek' is not a seat id on a twin bench (only deepseek#1/#2 are) —
    // the same orphaned-Stage-2-judge shape the §3.4 fixture below builds via
    // holedInput(), driven here directly through runRevoteWave's own params.
    const judgeKeys = ['gpt', 'deepseek'];
    const judgeSeats = judgeKeys.map(k => seatById.get(k) || null);
    const waveId = 'r-rv';
    const revoteLegs = [
      leg('gpt', revoteOut([{ id: 'A1', verdict: 'agree' }]), waveId, 1),
      unboundLeg('deepseek', revoteOut([{ id: 'A1', verdict: 'agree' }])),   // the hole's leg, ALSO unbindable
    ];
    const launchers = {
      launchWave: async () => ({ wave: wave(revoteLegs), exitCode: 0 }),
      launchSolo: async () => { throw new Error('unexpected repair: both legs parse cleanly'); },
    };
    const ctx = ctxFor(tmp, launchers, TWIN_BENCH);
    const bundleFindings = [{ id: 'A1', severity: 'major', amended: false,
      claim: 'infinite retry', argument: 'defended without extra argument' }];

    const rv = await runRevoteWave(ctx, judgeKeys, bundleFindings, judgeSeats, aliasOf);

    expect(rv.byJudge.deepseek).toEqual({ A1: { verdict: 'agree' } });
    expect(ctx.degrade.all()).toEqual([]);

    // And it still APPLIES: the orphaned judge's own provisional row — also
    // seat-less, the same shape Stage 2 left it in — is REPLACED, not left
    // standing and not duplicated into a phantom row.
    const tallyInput = {
      findings: [{ id: 'A1', raiser: 'gpt', severity: 'major', claim: 'infinite retry' }],
      adjudications: [
        { findingId: 'A1', judge: 'gpt', verdict: 'dispute' },
        { findingId: 'A1', judge: 'deepseek', verdict: 'dispute' },   // seat-less, same as holedInput()
      ],
    };
    const { input } = applyDebate({ tallyInput, defenseByRaiser: {}, revoteByJudge: rv.byJudge, aliasOf });
    expect(input.adjudications).toHaveLength(2);   // no invented row
    expect(input.adjudications.find(a => (a.seat || a.judge) === 'deepseek').verdict).toBe('agree');
  });
});

// ============================================================================
// T5.2 (SI-10/R8): the END-TO-END pin — the CONSEQUENCE of T5.1's refusal, not
// its mechanism. T5.1 above drives runRevoteWave directly; this drives the real
// runDebate, so the bare-alias key T5.1 withholds is produced by the real
// function, never hand-built (docs/superpowers/plans/2026-08-21-v48-phase5-debate-join.md
// Global Constraint 5 / Task 2).
//
// ⚠️ fakeLaunchers CANNOT build this fixture: stampFanout (top of file) re-stamps
// taskId/waveId onto EVERY leg it returns, including the one this fixture needs
// to come back unbound — routed through it, this test would be green at HEAD
// regardless of whether the guard exists, proving nothing (same trap as T5.1,
// noted above it). This block supplies its own launchSolo/launchWave instead,
// mirroring the task brief's own controller-verified fixture — a throwaway
// script under .superpowers/, deleted at branch end; this test is its
// permanent, committed form, and the plan doc above is the durable citation.
//
// Bench: TWIN_BENCH. Finding C1 is raised by 'gpt' — unlike twinInput() above
// (where each twin raises its OWN finding and so never judges the other's),
// that makes BOTH deepseek twins legitimate judges of C1, both disputing it
// provisionally. Both re-vote 'agree'; only deepseek#1's -rv leg comes back
// unstamped (no taskId, no waveId) and so cannot bind; deepseek#2's leg is
// stamped to roster slot 2 and binds normally. Measured at this plan's BASE
// (Task 1's guard absent): 3 adjudications out of 2 in (rows deepseek#1:dispute
// | deepseek#2:agree | a phantom seat-less deepseek:agree), tier Confirmed,
// basis {a:2,d:1}. Measured at HEAD (guard present, below): 2 out, no phantom
// row, tier Contested, basis {a:1,d:1} — the refusal is SURGICAL: deepseek#2's
// leg still binds and its re-vote still applies; only deepseek#1's unbindable
// leg is withheld.
//
// Named mutant E2EBLIND — the IDENTICAL deletion to T5.1's JOINBLIND above
// (restore run-debate-revote.js's BASE-shape unconditional
// `byJudge[key] = parsed.byId`, dropping the guard entirely) — hand-applied to
// the committed file, run, then reverted from a `cp` backup and byte-verified
// (`git diff --quiet`) against HEAD:
//   Red set (2) as measured at T5.2, against this file + debate.test.js: this
//   block's "the re-vote refusal is surgical" test below, AND T5.1's "twin
//   bench, one twin leg unbindable" test above. Global
//   Constraint 3 — a red set that GROWS when a test is added is proof the new
//   test entered the path: T5.1's own commit recorded JOINBLIND's red set as
//   (1 test) before this block existed; it was (2) then.
//   ⚠️ **(6) since T5.5's review round 1**, re-measured 2026-08-22 across all
//   six suites named at the JOINBLIND entry: the two T5.5 refusal tests, the
//   T5.5 exit-2 composition test and the T5.5 note-fallback test joined it —
//   (5) before that last one existed. Two things about the mutant itself also
//   changed and are recorded so nobody re-derives them: the guard it deletes
//   is now `if (judgeKeys.includes(key))` — T5.5 removed the
//   `boundLegs.has(leg) ||` arm, so deleting "the guard" is a SMALLER edit
//   than it was — and the count above is the one that must not be trusted
//   stale.
// ============================================================================
describe('runDebate — T5.2 (SI-10/R8): the re-vote refusal stops the adjudication basis from being corrupted', () => {
  let tmp, result, ctx;
  const defended = defenseOut([{ id: 'C1', action: 'defend', argument: 'bounded' }]);
  const agree = revoteOut([{ id: 'C1', verdict: 'agree' }]);

  // C1 raised by 'gpt' -> both deepseek twins are legitimate judges (the shape
  // task-2-verified-fixture.js's `input()` measured, not twinInput() above).
  function e2eJoinInput() {
    return {
      meta: { runId: 'r', models: TWIN_BENCH, chair: 'gemini', claudeInCouncil: false, date: '2026-07-19' },
      findings: [{ id: 'C1', raiser: 'gpt', raiserSeat: 'gpt', severity: 'major', claim: 'leaks fd' }],
      adjudications: [
        { findingId: 'C1', judge: 'deepseek', seat: 'deepseek#1', verdict: 'dispute' },
        { findingId: 'C1', judge: 'deepseek', seat: 'deepseek#2', verdict: 'dispute' },
      ],
      rankings: [], runStats: [],
    };
  }

  beforeAll(async () => {
    tmp = mkTmp('run-debate-e2e-join-');
    const input = e2eJoinInput();
    const provisionalRecord = tally(input);
    // gpt is the sole raiser -> one defense solo, stamped so it binds normally.
    // The -rv wave: deepseek#1's leg comes back UNSTAMPED -> bindSeats cannot
    // attribute it on a twin bench. deepseek#2's leg (stamped to slot 2) and
    // gpt's defense solo bind normally.
    const launchers = {
      launchSolo: async (o) => {
        const l = { model: 'gpt', modelInput: 'gpt', status: 'complete', summary: defended,
          taskId: `${o.waveId}-1`, waveId: o.waveId };
        return { exitCode: 0, wave: wave([l]), leg: l };
      },
      launchWave: async (o) => {
        const legs = [
          { model: 'deepseek', modelInput: 'deepseek', status: 'complete', summary: agree },  // deepseek#1: unbindable
          { model: 'deepseek', modelInput: 'deepseek', status: 'complete', summary: agree,
            taskId: `${o.waveId}-2`, waveId: o.waveId },                                      // deepseek#2: binds
        ];
        return { exitCode: 0, wave: wave(legs) };
      },
    };
    ctx = ctxFor(tmp, launchers, TWIN_BENCH);
    result = await runDebate(ctx, { provisionalRecord, tallyInput: input });
  });

  // One test, bundling all three assertions from the ONE fixture above — this
  // file's own convention (T5.1's "twin bench, one twin leg unbindable" test
  // does the same) and what makes the E2EBLIND cross-check below an exact
  // count rather than an approximation.
  test('the re-vote refusal is surgical: adjudications back to 2, no seat-less row, basis/tier corrected, one degrade note', () => {
    const rows = result.debatedInput.adjudications.filter(a => a.findingId === 'C1');
    expect(rows).toHaveLength(2);
    expect(rows.some(a => a.judge === 'deepseek' && !a.seat)).toBe(false);
    expect(rows.map(a => `${a.seat}:${a.verdict}`).sort()).toEqual(['deepseek#1:dispute', 'deepseek#2:agree']);

    // The point of the whole task: three votes on a two-judge finding (and a
    // tier of Confirmed) at BASE becomes two votes and Contested at HEAD.
    const c1 = tally(result.debatedInput).findings.find(f => f.id === 'C1');
    expect(c1.basis).toEqual({ a: 1, d: 1, n: 0 });
    expect(c1.tier).toBe('Contested');

    const notes = ctx.degrade.all();
    expect(notes).toHaveLength(1);
    expect(notes[0].channel).toBe('seat-unbound');
    expect(notes[0].data.judge).toBe('deepseek');
    expect(notes[0].data.waveId).toBe('r-rv');
  });
});

// ============================================================================
// Final whole-branch review, fix wave — F1 (§3.4 placeholder contract at the
// -rv call site), F2 (an absent `o.seats`) and F4 (emit-when-different).
// ============================================================================

// F1. The plan's §3.4 padding pattern only EXECUTES when the roster has a hole,
// and every twin test above runs a bench where every seat is real — so the
// placeholder branch never ran and three mutations survived all 520 suites:
//   M1  drop `.filter(b => !placeholders.has(b.seat))` in run-debate-revote.js
//   M2  drop the same filter in run-stage2.js          (pinned in run-stages.test.js)
//   M3  neuter `if (placeholders.has(seat)) { continue; }` in run-stage2.js's
//       seat-unbound loop                               (pinned in run-stages.test.js)
// M1's consequence is a SYNTHETIC `__unbound-…` sentinel reaching disk as
// revote-__unbound-r-rv-N.md and — through applyDebate's fail-open push, where
// `aliasOf` is the identity for an unknown key — `adjudications[].judge`, the
// alias/ledger-join space. That is standing-constraint C1, violated silently.
describe('runDebate — §3.4 placeholder contract at the -rv call site (a ROSTER HOLE)', () => {
  let tmp, result, launched, ctx;
  // twinInput()'s A1 dispute with its `seat` REMOVED — exactly the row an
  // orphaned Stage-2 judge leg leaves behind (run-assemble.js emits `seat` only
  // when that judge bound to one). `disputingJudges` then yields the bare alias
  // 'deepseek', which is no seat id on this bench, so runDebate's
  // `judgeKeys.map(k => seatById.get(k) || null)` hands runRevoteWave a null
  // hole and §3.4's placeholder is minted for it.
  function holedInput() {
    const input = twinInput();
    input.adjudications = input.adjudications.map(a =>
      (a.findingId === 'A1' && a.judge === 'deepseek')
        ? { findingId: 'A1', judge: 'deepseek', verdict: 'dispute' }   // no `seat`
        : a);
    return input;
  }

  beforeAll(async () => {
    tmp = mkTmp('run-debate-rv-hole-');
    const input = holedInput();
    const provisionalRecord = tally(input);
    launched = [];
    // deepseek#2 WITHDRAWS B1, so the re-vote bundle is A1 only and the -rv
    // roster is exactly [gpt, <hole>] — one real seat, one placeholder.
    const script = {
      solos: {
        'r-d1': { wave: wave([leg('deepseek', defenseOut([{ id: 'A1', action: 'defend', argument: 'caps at 5' }]))]) },
        'r-d2': { wave: wave([leg('deepseek', defenseOut([{ id: 'B1', action: 'withdraw' }]))]) },
      },
      waves: {
        'r-rv': wave([leg('gpt', revoteOut([{ id: 'A1', verdict: 'agree' }])),
          leg('deepseek', revoteOut([{ id: 'A1', verdict: 'agree' }]))]),
      },
    };
    ctx = ctxFor(tmp, fakeLaunchers(script, launched), TWIN_BENCH);
    result = await runDebate(ctx, { provisionalRecord, tallyInput: input });
  });

  test('the padding branch really executed — the -rv roster had exactly one hole', () => {
    const rv = launched.find(o => o.waveId === 'r-rv');
    expect(rv.models).toEqual(['gpt', 'deepseek']);            // the hole launches on its ALIAS
    // One leg bound to a real seat, one to the placeholder that §3.4 filters
    // back out. A null here is the whole point: nothing was guessed.
    expect(result.revoteLegs.map(l => l.seat && l.seat.id)).toEqual(['gpt', null]);
  });

  test('M1: the placeholder never becomes the seat of a leg, so no `__unbound-` artifact is written', () => {
    const files = fs.readdirSync(tmp).sort();
    expect(files.filter(f => f.startsWith('__') || f.includes('__unbound-'))).toEqual([]);
    // The unbound leg falls back to the ALIAS filename (materializeDebate's
    // `${prefix}-${sanitizeName(leg.model)}.md`), which is today's behaviour.
    expect(files).toContain('revote-gpt.md');
    expect(files).toContain('revote-deepseek.md');
  });

  test('M1: no `__unbound-` sentinel reaches adjudications[].seat or the alias-space .judge (C1)', () => {
    const rows = result.debatedInput.adjudications;
    expect(rows.length).toBeGreaterThan(0);
    for (const a of rows) {
      expect(a.judge).not.toMatch(/__unbound-/);
      expect(a.seat || '').not.toMatch(/__unbound-/);
      expect(result.debatedInput.meta.models).toContain(a.judge);   // still ledger-joinable
    }
    // Positive control — the hole's re-vote is not merely sanitized away, it
    // APPLIED: the seat-less A1 row is the one it replaced, and applyDebate
    // invented nothing (2 rows in, 2 rows out).
    const a1 = rows.filter(a => a.findingId === 'A1');
    expect(a1).toHaveLength(2);
    expect(a1.find(a => a.judge === 'deepseek')).toEqual({ findingId: 'A1', judge: 'deepseek', verdict: 'agree' });
  });

  test('M1: no `__unbound-` sentinel reaches debate.json or any runStats row', () => {
    expect(fs.readFileSync(path.join(tmp, 'debate.json'), 'utf-8')).not.toContain('__unbound-');
    const rows = result.debatedInput.runStats;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) { expect(r.model).not.toMatch(/__unbound-/); }
  });
});

// ============================================================================
// T5.5 — the `boundLegs` arm is GONE, and this block pins its absence.
// `run-debate-revote.js :: runRevoteWave` now publishes on
// `judgeKeys.includes(key)` ALONE.
//
// ⚠️ THE ASSERTIONS BELOW ARE THE INVERSE OF THE ONES THIS BLOCK SHIPPED WITH.
// The whole-branch fix wave (round 2) added this fixture under the name
// BOUNDDROP to pin arm 1's effect as a DISCLOSED DEFECT — it asserted 3
// adjudication rows and ZERO degrade notes, on purpose, so the defect could not
// rot silently. A paid multi-model council then confirmed the same mechanism
// against PR #179 from three independent seats and reproduced this branch's own
// measured figure, and the owner ruled: delete the arm. So the defect assertions
// invert here, and the mutant's name inverts with them — dropping the arm WAS
// the mutant (`BOUNDDROP`) and IS now the fix, so the mutant is `BOUNDREADD`.
//
// The mechanism arm 1 admitted: `seats.js :: bindSeats` binds a leg to a roster
// slot from `leg.legId || leg.taskId` alone — `roster[Number(m[2]) - 1]`, with NO
// alias check — and the alias fallback under it only runs `if (!seat && …)`. So a
// leg stamped into the §3.4 PLACEHOLDER's slot while carrying an alias that is in
// no roster and no `judgeKeys` BOUND (arm 1 true) while keying on that foreign
// alias (arm 2 false): the foreign key was published, no note was emitted, and
// `applyDebate`'s fail-open push invented a phantom `zzz` row while the roster
// hole's own seat-less row kept its stale `dispute`. That is the SI-10 shape
// T5.1 exists to close, surviving through arm 1. This is the §3.4 fixture above
// with exactly ONE change: the hole leg's alias 'deepseek' -> 'zzz'.
//
// ⚠️ A BEHAVIOUR change, so these are RED-before-GREEN, not preservation pins.
// Measured by execution against BASE `269badf1` (arm 1 present): both tests
// below FAIL there — the first on `0 notes` where it wants 1, the second on
// `3 rows` where it wants 2 — and both pass at HEAD.
//
// ⚠️ The §3.4 roster hole is NOT regressed by the deletion, which is the whole
// reason arm 2 survives: a hole's own alias IS one of `judgeKeys` (run-debate.js
// builds `judgeSeats` as `judgeKeys.map(k => seatById.get(k) || null)`, so the
// hole keeps its `judgeKeys` slot and only loses its seat), so it still publishes
// and still emits no note. The "§3.4 placeholder contract" block above and
// T5.1's "roster hole whose leg is ALSO unbindable" test are that pin; both are
// untouched by this change and both stay green.
//
// ⚠️ NOT reachable from the production launcher: runRevoteWave launches
// `models: judgeKeys.map(aliasOf)` and fanout-leg.js carries `leg.modelInput`
// straight from that request (`:62`, `:101`), so a real -rv leg's alias is
// always one the wave asked for. Same latency class as SI-10 itself.
//
// Named mutant BOUNDREADD — re-add the deleted arm, i.e. restore BOTH halves of
// what T5.5 removed: the Set (`const boundLegs = new Set(bindRes.bound.map(b =>
// b.leg));`, after the `seatOf` build) and the widened predicate
// (`if (boundLegs.has(leg) || judgeKeys.includes(key))`). Red set (2): BOTH
// tests in this block and nothing else, measured across run-debate.test.js +
// debate.test.js + seat-space.test.js + run-stages.test.js + degrade-sink.test.js
// + run-finalize.test.js. Hand-applied to the committed file, run, then restored
// from a `cp` backup and byte-verified with `git diff --quiet`.
// ============================================================================
describe('runDebate — T5.5: a taskId-bound leg carrying a FOREIGN alias is REFUSED', () => {
  let tmp, result, ctx;
  // The §3.4 roster hole again: A1's deepseek dispute with its `seat` removed,
  // so `disputingJudges` yields the bare alias 'deepseek', which is no seat id
  // on a twin bench, so runRevoteWave pads slot 2 with a placeholder.
  function holedInput() {
    const input = twinInput();
    input.adjudications = input.adjudications.map(a =>
      (a.findingId === 'A1' && a.judge === 'deepseek')
        ? { findingId: 'A1', judge: 'deepseek', verdict: 'dispute' }
        : a);
    return input;
  }

  beforeAll(async () => {
    tmp = mkTmp('run-debate-rv-foreign-');
    const input = holedInput();
    const provisionalRecord = tally(input);
    const script = {
      solos: {
        'r-d1': { wave: wave([leg('deepseek', defenseOut([{ id: 'A1', action: 'defend', argument: 'caps at 5' }]))]) },
        'r-d2': { wave: wave([leg('deepseek', defenseOut([{ id: 'B1', action: 'withdraw' }]))]) },
      },
      // 'zzz' is in NO roster and NO judgeKeys. stampFanout's `k < 0` arm still
      // stamps it `r-rv-2` by POSITION, which is the whole point.
      waves: {
        'r-rv': wave([leg('gpt', revoteOut([{ id: 'A1', verdict: 'agree' }])),
          leg('zzz', revoteOut([{ id: 'A1', verdict: 'agree' }]))]),
      },
    };
    ctx = ctxFor(tmp, fakeLaunchers(script, []), TWIN_BENCH);
    result = await runDebate(ctx, { provisionalRecord, tallyInput: input });
  });

  test('it BINDS to the placeholder slot yet keys on the foreign alias — and is refused anyway', () => {
    // Bound (so arm 1 WOULD have published it) but the placeholder is filtered
    // back out, so the leg's seat is null and its key is the bare 'zzz'.
    // The leg itself is untouched — LEGDROP's contract: only the votes are withheld.
    expect(result.revoteLegs.map(l => l.seat && l.seat.id)).toEqual(['gpt', null]);
    // 'zzz' names no seat and no launched judge, so the ONLY surviving arm is
    // false and the refusal is announced. This is BOUNDREADD's red edge.
    const notes = ctx.degrade.all();
    expect(notes).toHaveLength(1);
    expect(notes[0].channel).toBe('seat-unbound');
    expect(notes[0].data.judge).toBe('zzz');
    expect(notes[0].data.key).toBe('zzz');
    expect(notes[0].data.waveId).toBe('r-rv');
    // The taskId that bound it to the placeholder slot, carried on the record.
    expect(notes[0].data.legId).toBe('r-rv-2');
    // ⚠️ EXACT `what`, pinned HERE because this is the leg the old wording lied about:
    // it DID match a roster slot (the §3.4 placeholder's, by taskId) and was refused
    // anyway, so "matches no seat on that wave's roster" was false for three rounds while
    // the `why` three lines under it had already been corrected twice. Named mutant
    // WHATSTALE. The negative assertion is the load-bearing half — it is what stops the
    // old sentence being reinstated from stage1-bind.js :: orphanLegNote, where the same
    // words are TRUE.
    expect(notes[0].what)
      .toBe('re-vote leg r-rv-2 in wave r-rv could not be attributed to a judge on that wave');
    expect(notes[0].what).not.toMatch(/matches no seat/);
    // ⚠️ And the note's own `why` must not claim the leg bound to nothing — THIS one
    // bound, to the placeholder's slot, which is what the taskId above shows. That
    // sentence read "it bound to no roster slot, and … names no seat there either"
    // until T5.5 deleted the arm that made the first half true — an ANNOUNCED string
    // the correct edit turned false. Named mutant WHYSTALE (restore the old `why`
    // literal in run-debate-revote.js :: reVoteUnboundNote): red set (2) — this test
    // and the "NEITHER modelInput NOR model" test below, which pins the exact string.
    // It was (1) before that test existed; re-measured 2026-08-22 across the same six
    // suites as the others.
    expect(notes[0].why).toMatch(/names none of the judges this wave launched/);
    expect(notes[0].why).not.toMatch(/bound to no roster slot/);
  });

  test('refusing that key invents no phantom row and leaves the roster hole its own', () => {
    const a1 = result.debatedInput.adjudications.filter(a => a.findingId === 'A1');
    // 2 out, not 3: gpt's bound re-vote applied, and nothing invented.
    expect(a1).toHaveLength(2);
    expect(a1.find(a => a.judge === 'zzz')).toBeUndefined();
    expect(a1.find(a => a.judge === 'gpt').verdict).toBe('agree');
    // The roster hole's own seat-less row is INTACT — the phantom never
    // displaced it, and no re-vote of its own ever arrived to replace it.
    expect(a1.find(a => a.judge === 'deepseek' && !a.seat))
      .toEqual({ findingId: 'A1', judge: 'deepseek', verdict: 'dispute' });
  });
});

// ============================================================================
// T5.5 — the note's own FALLBACKS, and the one T5.5 nearly shipped missing.
// `reVoteUnboundNote` normalizes three values before rendering: `legId`, the
// judge `alias`, and — only since T5.5 started interpolating it — the join
// `key`. That third one was raw for one commit, and the review caught it:
// measured against the real runRevoteWave with a leg carrying NEITHER
// `modelInput` NOR `model`, the record rendered "its join key 'undefined' …"
// and `data.key` fell out of the JSON entirely — precisely the "reads like a
// bug in the announcer instead of a fact about the leg" shape that the alias
// fallback exists to prevent (run-debate-revote.js :: reVoteUnboundNote's own
// comment says so, and now covers both interpolations).
//
// Why `key` goes undefined with `judge`: the caller computes
// `key = seatKey(seat, judge)`, which RETURNS `judge` whenever `seat` is null —
// and `seat` is null in every refusal runDebate can produce.
//
// Named mutants:
//   KEYRAW    drop `|| 'unknown'` from `joinKey`. Red set (1): this test.
//   WHYSTALE  restore the pre-T5.5 `why` literal ("it bound to no roster slot,
//             and its judge alias '${alias}' names no seat there either").
//             Red set (2) now that this block exists — it was (1) before.
//   WHATSTALE restore the pre-round-2 `what` literal ("re-vote leg … matches no
//             seat on that wave's roster"), which a paid council caught still
//             making the claim `why` had been fixed twice to drop. A COMPANION
//             to WHYSTALE rather than a widening of it, so a red set attributes
//             to one string. Red set (3): this test's exact `what`, the T5.5
//             refusal block's exact `what` + its `not.toMatch(/matches no
//             seat/)`, and the exit-2 composition test's emitted-line regex.
// Both hand-applied to the committed file, run across the same six suites as
// this branch's other mutants, then restored from a `cp` copy and byte-verified
// with `git diff --quiet`.
// ============================================================================
describe('runRevoteWave — T5.5: a leg carrying NEITHER modelInput NOR model still announces cleanly', () => {
  test('the note renders `unknown`, never `undefined`, in the sentence AND in `data`', async () => {
    const tmp = mkTmp('run-revote-noalias-');
    const seats = buildSeats(TWIN_BENCH, null, null);
    const aliasOf = aliasOfFor(seats);
    const seatById = new Map(seats.map(s => [s.id, s]));
    const judgeKeys = ['gpt', 'deepseek#1'];
    const judgeSeats = judgeKeys.map(k => seatById.get(k));
    // No model, no modelInput, no taskId, no waveId. bindSeats keeps it in `mine`
    // (`!l.waveId`), finds no id to match and skips the alias fallback (which
    // needs `leg.waveId === waveId`), so it binds to nothing; `judge` is
    // undefined, and `seatKey(null, undefined)` carries that into `key`.
    const nameless = { status: 'complete', summary: revoteOut([{ id: 'A1', verdict: 'agree' }]) };
    const ctx = ctxFor(tmp, {
      launchWave: async () => ({ wave: wave([nameless]), exitCode: 0 }),
      launchSolo: async () => { throw new Error('unexpected repair: the leg parses cleanly'); },
    }, TWIN_BENCH);
    const bundleFindings = [{ id: 'A1', severity: 'major', amended: false,
      claim: 'infinite retry', argument: 'defended without extra argument' }];

    await runRevoteWave(ctx, judgeKeys, bundleFindings, judgeSeats, aliasOf);

    const notes = ctx.degrade.all();
    expect(notes).toHaveLength(1);
    // EXACT strings, because this pins two decisions at once: the join-key
    // fallback, and T5.5's removal of the "(judge alias '…')" parenthetical —
    // which printed the SAME string twice in every refusal runDebate can produce,
    // since a real seat's id is always a judgeKey and so a real-seat bind is
    // always published, leaving `key === judge` in every refusal.
    expect(notes[0].why).toBe("its join key 'unknown' names none of the judges this wave launched");
    expect(notes[0].what)
      .toBe('re-vote leg unidentified in wave r-rv could not be attributed to a judge on that wave');
    expect(notes[0].data)
      .toEqual({ waveId: 'r-rv', legId: 'unidentified', judge: 'unknown', key: 'unknown' });
    // Belt and braces over the WHOLE record: nothing anywhere renders `undefined`.
    expect(JSON.stringify(notes[0])).not.toMatch(/undefined/);
  });
});

// ============================================================================
// T5.5 — the exit-2 COMPOSITION. Both halves were already pinned SEPARATELY:
// `tests/council/degrade-sink.test.js` :: "note() writes stderr, appends
// run.json, and flips degraded" (a default-kind record sets `degraded.value`),
// and `tests/council/run-finalize.test.js` :: "the degrade flag turns 0 into 2
// (a shrunken bench, a thin cross-review, …)". Nothing pinned the JOIN: every
// other -rv fixture in this file runs on `ctxFor`'s `degrade`, which is a
// RECORDING DOUBLE (`{ note: (rec) => notes.push(rec), all: () => notes }`),
// so no committed test carried a `seat-unbound` refusal to an exit code. Filed
// as an open follow-up under SI-10 in BACKLOG.md; closed by this block.
//
// ⚠️ The record under test is DERIVED, never hand-built — it is whatever the
// real `runRevoteWave` hands the real `createDegradeSink`. Hand-building the
// intermediate value is precisely how earlier fixtures on this branch went
// green at HEAD for the wrong reason (plan Global Constraint 5).
//
// The fixture is T5.1's "twin bench, one twin leg unbindable" shape, with ONE
// substitution: `ctx.degrade` swapped from the recording double to the
// production `run-degrade.js :: createDegradeSink`, wired to the same
// `{value:false}` flag `run.js:64-65` gives it.
//
// Named mutant NOTEHEAL — add `kind: 'heal'` to the record `reVoteUnboundNote`
// returns (`run-debate-revote.js :: reVoteUnboundNote`). That is the exact edit
// this block exists to catch, and it is a QUIET one: `utils/degrade.js`'s
// `KINDS` accepts 'heal', so `makeDegrade` does not throw, every
// channel/what/why/effect/data assertion in this file still passes, and only
// `createDegradeSink`'s `if (record.kind === 'degrade' && degraded)` stops
// firing — the refusal becomes exit-code-neutral in silence. Red set (1): this
// block's test and nothing else, measured across run-debate.test.js +
// debate.test.js + run-stages.test.js + seat-space.test.js +
// degrade-sink.test.js + run-finalize.test.js. Hand-applied to the committed
// file, run, then restored from a `cp` backup and byte-verified with
// `git diff --quiet`.
// ============================================================================
describe('runRevoteWave — T5.5: a seat-unbound refusal reaches terminal exit 2', () => {
  test('the real degrade sink flips `degraded`, and resolveTerminalExit turns a clean 0 into 2', async () => {
    const tmp = mkTmp('run-revote-exit2-');
    const seats = buildSeats(TWIN_BENCH, null, null);      // deepseek#1 / deepseek#2 / gpt
    const aliasOf = aliasOfFor(seats);
    const seatById = new Map(seats.map(s => [s.id, s]));
    const judgeKeys = ['gpt', 'deepseek#1', 'deepseek#2'];
    const judgeSeats = judgeKeys.map(k => seatById.get(k));
    const waveId = 'r-rv';
    const revoteLegs = [
      leg('gpt', revoteOut([{ id: 'A1', verdict: 'agree' }]), waveId, 1),
      leg('deepseek', revoteOut([{ id: 'A1', verdict: 'agree' }]), waveId, 2),  // deepseek#1: binds
      // deepseek#2: no taskId and no waveId, so bindSeats can match neither an
      // id nor (its alias fallback needs `leg.waveId === waveId`) an alias.
      leg('deepseek', revoteOut([{ id: 'A1', verdict: 'dispute' }])),
    ];
    const ctx = ctxFor(tmp, {
      launchWave: async () => ({ wave: wave(revoteLegs), exitCode: 0 }),
      launchSolo: async () => { throw new Error('unexpected repair: every leg parses cleanly'); },
    }, TWIN_BENCH);
    const degraded = { value: false };
    const emitted = [];
    ctx.degrade = createDegradeSink({ runDir: tmp, degraded, write: (s) => emitted.push(s) });
    const bundleFindings = [{ id: 'A1', severity: 'major', amended: false,
      claim: 'infinite retry', argument: 'defended without extra argument' }];

    const rv = await runRevoteWave(ctx, judgeKeys, bundleFindings, judgeSeats, aliasOf);

    // The refusal happened at all (guard against a fixture that quietly binds).
    expect(rv.byJudge.deepseek).toBeUndefined();
    const records = ctx.degrade.all();
    expect(records).toHaveLength(1);
    expect(records[0].channel).toBe('seat-unbound');

    // Half 1 — the production sink flipped the run's flag.
    expect(degraded.value).toBe(true);
    // Half 2, and the composition this block exists for: an otherwise-clean run
    // finalizes as 2. Arguments mirror the sole production call, run.js:111.
    expect(resolveTerminalExit({ signalled: null, exitCode: 0, degraded,
      degrade: ctx.degrade, inexactUnderCeiling: () => false })).toBe(2);
    // Control: the same call with an unflipped flag stays 0, so the 2 above is
    // the refusal's doing and not the shape of these arguments.
    expect(resolveTerminalExit({ signalled: null, exitCode: 0, degraded: { value: false },
      degrade: ctx.degrade, inexactUnderCeiling: () => false })).toBe(0);

    // ⚠️ These two are LAST on purpose. `kind` is the load-bearing link in the
    // chain (reVoteUnboundNote never sets it; `utils/degrade.js :: makeDegrade`
    // defaults it to 'degrade'), and BOTH of these read it — `formatDegrade`
    // leads with "Recovered" instead of "Notice" for a 'heal'. Asserted ABOVE,
    // either one would let NOTEHEAL red on a PROXY and leave the composition
    // itself unproven; both were measured in that position and did exactly that.
    // Measured in this position: NOTEHEAL reds on `degraded.value` above.
    expect(records[0].kind).toBe('degrade');
    expect(emitted.join('')).toMatch(/^Notice: re-vote leg .* could not be attributed to a judge/);
  });
});

// F2. `seatById` used to be built from `ctx.o.seats || []`, so an absent seat
// table made `aliasOf` the identity over COMPOSED seat ids and sent
// `deepseek#1` to three launchers as a model name (measured: r-d1
// model="deepseek#1", r-d2 "deepseek#2", r-rv models
// ["gpt","deepseek#2","deepseek#1"]). That is exactly the PR2b shape:
// run-stage1-launch.js:20-22 RE-DERIVES the seat table when `o.seats` is
// absent, so `raiserSeat`/`seat` can be truthy while `o.seats` is falsy — the
// two facts do not travel together. Standing constraint C1.
describe('runDebate — an absent `o.seats` is re-derived, never treated as "no seats"', () => {
  test('every launcher argument is still a routable bench alias with `o.seats` absent', async () => {
    const tmp = mkTmp('run-debate-noseats-');
    const input = twinInput();
    const provisionalRecord = tally(input);
    const launched = [];
    const bothDefended = defenseOut([
      { id: 'A1', action: 'defend', argument: 'caps at 5' },
      { id: 'B1', action: 'defend', argument: 'bounded by config' },
    ]);
    const agreeBoth = revoteOut([{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'agree' }]);
    const script = {
      solos: { 'r-d1': { wave: wave([leg('deepseek', bothDefended)]) },
        'r-d2': { wave: wave([leg('deepseek', bothDefended)]) } },
      waves: { 'r-rv': wave([leg('gpt', agreeBoth), leg('deepseek', agreeBoth), leg('deepseek', agreeBoth)]) },
    };
    const ctx = ctxFor(tmp, fakeLaunchers(script, launched), TWIN_BENCH);
    ctx.o.seats = null;             // a direct-require caller; run.js:133 normally fills it
    const res = await runDebate(ctx, { provisionalRecord, tallyInput: input });
    const captured = launched.flatMap(o => (o.models ? o.models : [o.model]));
    expect(captured.length).toBeGreaterThanOrEqual(3);          // 2 defense solos + the wave
    for (const m of captured) {
      expect(ctx.o.models).toContain(m);
      expect(m).not.toMatch(/#/);
    }
    // …and the re-derived table is the SAME table, so the round still joins on
    // the seat rather than degrading to the alias-collapsed merge-base shape.
    expect(res.debateFindings.map(d => [d.id, d.raiser]).sort())
      .toEqual([['A1', 'deepseek#1'], ['B1', 'deepseek#2']]);
  });
});

// F4. `run-debate.js`'s `alias !== key` guard on debate.json's revotes[] rows —
// the third of three emit-when-different sites (run.js:198 and
// run-assemble.js:215 are its siblings and were both already pinned). Mutating
// it to a bare `key` adds a `seat` key to EVERY revotes[] row on EVERY
// unique-alias bench, which is a universal artifact-shape change, and it
// survived the whole suite.
describe('runDebate — debate.json revotes[] emit `seat` ONLY when it differs from the alias', () => {
  test('a unique-alias bench writes revotes[] rows with NO seat key at all', async () => {
    const tmp = mkTmp('run-debate-emitdiff-');
    const input = provisionalInput();
    const provisionalRecord = tally(input);
    const out = defenseOut([{ id: 'A1', action: 'defend', argument: 'caps at 5' }]);
    await runDebate(ctxFor(tmp, fakeLaunchers({
      solos: { 'r-d1': { wave: wave([leg('gemini', out)]) } },
      waves: { 'r-rv': wave([leg('gpt', revoteOut([{ id: 'A1', verdict: 'agree' }])),
        leg('qwen', revoteOut([{ id: 'A1', verdict: 'dispute' }]))]) },
    })), { provisionalRecord, tallyInput: input });
    const doc = JSON.parse(fs.readFileSync(path.join(tmp, 'debate.json'), 'utf-8'));
    expect(doc.revotes.length).toBe(2);
    // EXACT key set, in emit order — a `seat` key here is the mutation, and an
    // added/removed key of any other name is an unreviewed artifact change.
    for (const r of doc.revotes) {
      expect(Object.keys(r)).toEqual(['judge', 'id', 'verdict', 'reason', 'applied']);
    }
    expect(doc.revotes.map(r => r.judge).sort()).toEqual(['gpt', 'qwen']);
  });
});

// ============================================================================
// Driver-level (`runCouncil --debate`) — Step 7 of the task brief.
// ============================================================================

function e2eOpts(tmp, extra) {
  return { briefing: 'Review X', models: ['gemini', 'gpt', 'qwen'], chair: 'deepseek',
    project: tmp, runId: 'r', runDir: tmp, date: '2026-07-19', debate: true, ...extra };
}

describe('runCouncil --debate happy path (fake launchers)', () => {
  test('ledger appends exactly once; run.json carries the debate summary; tally.json decorated; exit 0', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'run-debate-e2e-'));
    let appends = 0;
    const { exitCode, run } = await runCouncil(e2eOpts(tmp),
      { launchers: debateScript(), appendRunFn: () => { appends += 1; } });
    expect(exitCode).toBe(0);
    expect(appends).toBe(1);                          // provisional never appends; final appends once
    expect(run.debate.outcome).toBe('ran');
    expect(run.debate.verdictChanges).toBe(1);
    const tallyDoc = JSON.parse(fs.readFileSync(path.join(tmp, 'tally.json'), 'utf-8'));
    expect(tallyDoc.findings.some(f => f.debate)).toBe(true);
    // spec §5.1 audit artifact: the provisional tally is written, and is the
    // PRE-debate record (A1 still Disputed) — distinct from the decorated final tally.
    const provPath = path.join(tmp, 'tally-provisional.json');
    expect(fs.existsSync(provPath)).toBe(true);
    const prov = JSON.parse(fs.readFileSync(provPath, 'utf-8'));
    expect(prov.findings.find(f => f.id === 'A1').tier).toBe('Disputed');
    expect(prov.findings.some(f => f.debate)).toBe(false);
  });

  test('the debate stage ladder + every spec §5.1 run-dir artifact is written', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'run-debate-artifacts-'));
    const { exitCode, run } = await runCouncil(e2eOpts(tmp),
      { launchers: debateScript(), appendRunFn: () => {} });
    expect(exitCode).toBe(0);
    expect(run.stages.map(s => [s.name, s.status])).toEqual([
      ['stage1', 'complete'], ['stage2', 'complete'], ['tally-provisional', 'complete'],
      ['debate-defense', 'complete'], ['debate-revote', 'complete'], ['chair', 'complete'],
      ['tally-final', 'complete'], ['verdict', 'complete'],
    ]);
    for (const f of ['tally-provisional.json', 'revote-bundle.md', 'debate.json',
      'rebuttal-gemini.md', 'revote-gpt.md', 'revote-qwen.md', 'tally.json']) {
      expect(fs.existsSync(path.join(tmp, f))).toBe(true);
    }
    // A1's decoration carries the tier it held BEFORE the round (carry-forward gap 3a
    // end-to-end: a null previousTier here means run-debate never stamped the input).
    const tallyDoc = JSON.parse(fs.readFileSync(path.join(tmp, 'tally.json'), 'utf-8'));
    expect(tallyDoc.findings.find(f => f.id === 'A1').debate)
      .toEqual({ action: 'defended', previousTier: 'Disputed' });
  });

  test('the chair packet ends with the debate addendum built from the REAL outcomes', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'run-debate-packet-'));
    const map = { ...debateScriptMap() };
    let ch1Prompt = null;
    const ch1 = map['r-ch1'];
    map['r-ch1'] = (opts) => { ch1Prompt = opts.prompt; return ch1(opts); };
    const { exitCode } = await runCouncil(e2eOpts(tmp),
      { launchers: scriptedLaunchers(map), appendRunFn: () => {} });
    expect(exitCode).toBe(0);
    expect(ch1Prompt).toContain('--- Debate round outcomes ---');
    expect(ch1Prompt).toContain('defended');
    expect(ch1Prompt).toContain('gpt: dispute → agree');
    expect(ch1Prompt).toContain('qwen: dispute → dispute');
    // The launched packet stays byte-identical to the on-disk audit artifact.
    expect(ch1Prompt).toBe(fs.readFileSync(path.join(tmp, 'chair-packet.md'), 'utf-8'));
  });

  test('WITHOUT --debate run.json carries no `debate` key at all (durable contract)', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'run-debate-off-'));
    const { exitCode, run } = await runCouncil(e2eOpts(tmp, { debate: false }),
      { launchers: debateScript(), appendRunFn: () => {} });
    expect(exitCode).toBe(0);
    expect('debate' in run).toBe(false);   // a `debate:null` seed would fail Task 5's schema
    expect(fs.existsSync(path.join(tmp, 'tally-provisional.json'))).toBe(false);
    // v4.0 stage ladder unchanged: no debate stages, `tally` not `tally-final`.
    expect(run.stages.map(s => s.name)).toEqual(['stage1', 'stage2', 'chair', 'tally', 'verdict']);
  });

  test('nothing to debate → outcome nothing-to-debate, no waves launched, ledger still appends', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'run-debate-nothing-'));
    // Every finding agreed by both peers → 0 Contested + 0 Disputed.
    const agreeAll = [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'agree' }, { id: 'C1', verdict: 'agree' }];
    const map = { ...debateScriptMap(),
      'r-s2': () => okWave([
        mkLeg('gemini', flh.judgeOut(['Review B', 'Review C', 'Review A'], agreeAll)),
        mkLeg('gpt', flh.judgeOut(['Review B', 'Review C', 'Review A'], agreeAll)),
        mkLeg('qwen', flh.judgeOut(['Review B', 'Review C', 'Review A'], agreeAll)),
      ]) };
    delete map['r-d1'];
    delete map['r-rv'];                        // scriptedLaunchers throws if either launches
    let appends = 0;
    const { exitCode, run } = await runCouncil(e2eOpts(tmp),
      { launchers: scriptedLaunchers(map), appendRunFn: () => { appends += 1; } });
    expect(exitCode).toBe(0);
    expect(run.debate.outcome).toBe('nothing-to-debate');
    expect(appends).toBe(1);
    expect(fs.existsSync(path.join(tmp, 'debate.json'))).toBe(false);
  });
});

describe('runCouncil --debate rows carry resolvedModel (v4.7 GOA-7 D8)', () => {
  test('debate rows carry resolvedModel from the raw legs', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'run-debate-resolved-'));
    const resolved = (m) => ({ gemini: 'google/gemini-3.5-pro', gpt: 'openai/gpt-5.2',
      qwen: 'qwen/qwen3-max', deepseek: 'deepseek/deepseek-v4' }[m] || m);
    const script = debateScriptMap();
    // Re-wrap every scripted wave so each leg's .model is the executable id
    // while .modelInput stays the alias (mkLeg sets both to the alias).
    for (const [k, fn] of Object.entries(script)) {
      script[k] = (opts) => {
        const r = fn(opts);
        r.wave.legs = r.wave.legs.map(l => ({ ...l, model: resolved(l.model) }));
        return r;
      };
    }
    const { exitCode } = await runCouncil(e2eOpts(tmp),
      { launchers: launchersFromScript(script), appendRunFn: () => {} });
    expect(exitCode).toBe(0);
    const input = JSON.parse(fs.readFileSync(path.join(tmp, 'tally-input.json'), 'utf-8'));
    const rebuttal = input.runStats.find(r => r.role === 'rebuttal');
    const revote = input.runStats.find(r => r.role === 'revote');
    expect(rebuttal.resolvedModel).toBe('google/gemini-3.5-pro');
    expect(rebuttal.model).toBe('gemini');
    expect(revote.resolvedModel).toBe('openai/gpt-5.2');
  });
});

describe('runCouncil --debate registers its sub-waves for the abort cascade', () => {
  // Same idiom as tests/council/run-waveids.test.js: read run.json from INSIDE the
  // launch, proving the id was written BEFORE the leg went in flight.
  test('debate-defense and debate-revote carry their in-flight waveIds', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dbg-waveids-'));
    const stageOf = (name) =>
      ((runState.readRun(tmp) || {}).stages || []).find(s => s.name === name) || null;
    let midDefense = null;
    let midRevote = null;
    const map = { ...debateScriptMap() };
    const d1 = map['r-d1'];
    const rv = map['r-rv'];
    map['r-d1'] = (opts) => { midDefense = stageOf('debate-defense'); return d1(opts); };
    map['r-rv'] = (opts) => { midRevote = stageOf('debate-revote'); return rv(opts); };
    const { exitCode } = await runCouncil(e2eOpts(tmp),
      { launchers: scriptedLaunchers(map), appendRunFn: () => {} });
    expect(exitCode).toBe(0);
    // abortCouncilRun cascades ONLY over stages that are status 'running' AND carry a
    // truthy `project` — waveIds alone would leave the leg unreachable.
    expect(midDefense.status).toBe('running');
    expect(midDefense.project).toBeTruthy();
    expect(midDefense.waveIds).toContain('r-d1');
    expect(midRevote.status).toBe('running');
    expect(midRevote.project).toBeTruthy();
    expect(midRevote.waveIds).toContain('r-rv');
  });

  test('a skipped re-vote never advertises the -rv wave id', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dbg-norv-'));
    // gemini withdraws A1 → nothing defended/amended → the re-vote wave never launches.
    const map = { ...debateScriptMap(),
      'r-d1': () => okWave([mkLeg('gemini', defenseOut([{ id: 'A1', action: 'withdraw' }]))]) };
    delete map['r-rv'];                       // scriptedLaunchers throws if it launches anyway
    const { exitCode, run } = await runCouncil(e2eOpts(tmp),
      { launchers: scriptedLaunchers(map), appendRunFn: () => {} });
    expect(exitCode).toBe(0);
    const rvStage = run.stages.find(s => s.name === 'debate-revote');
    expect(rvStage.waveId).toBeUndefined();
    expect(rvStage.waveIds).toBeUndefined();
  });
});

describe('runCouncil --debate degradation → exit 2 (spec §5.7 / §6)', () => {
  // Each case overrides one key of the happy debate map; scriptedLaunchers throws on an
  // unscripted waveId, so a skipped wave is proven by its absence from launchers.calls.
  function runWith(tmp, overrides, extra) {
    const launchers = scriptedLaunchers({ ...debateScriptMap(), ...overrides });
    const p = runCouncil(e2eOpts(tmp, extra), { launchers, appendRunFn: () => {} });
    return p.then((r) => ({ ...r, calls: launchers.calls }));
  }

  test('dead defense solo (no leg) → exit 2, outcome still "ran"', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dbg-deaddef-'));
    const { exitCode, run } = await runWith(tmp, { 'r-d1': () => okWave([]) });
    expect(exitCode).toBe(2);
    expect(run.debate.outcome).toBe('ran');
    expect(run.debate.noResponse).toBe(1);       // spec §5.7: that raiser's ids → no-response
  });

  test('unstructured defense after the one repair → exit 2', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dbg-unstrdef-'));
    const { exitCode } = await runWith(tmp, {
      'r-d1': () => okWave([mkLeg('gemini', 'prose only, no json block')]),
      'r-d1r': () => okWave([mkLeg('gemini', 'still no json block')]),
    });
    expect(exitCode).toBe(2);
  });

  test('partial re-vote wave (one judge leg dead) → exit 2', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dbg-partrv-'));
    const { exitCode } = await runWith(tmp, {
      'r-rv': () => okWave([
        mkLeg('gpt', revoteOut([{ id: 'A1', verdict: 'agree' }])),
        mkLeg('qwen', '', 'error'),
      ]),
    });
    expect(exitCode).toBe(2);
  });

  test('fully-dead re-vote wave → exit 2', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dbg-deadrv-'));
    const { exitCode } = await runWith(tmp, {
      'r-rv': () => okWave([mkLeg('gpt', '', 'error'), mkLeg('qwen', '', 'error')]),
    });
    expect(exitCode).toBe(2);
  });

  test('cost ceiling BEFORE the defense wave → skipped-cost-ceiling, exit 2, no defense launched', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dbg-cc-pre-'));
    // Make Stage 2 blow the whole-run ceiling so overBudget() is true at the debate gate.
    const dear = (m) => mkLeg(m, debateScriptMap()['r-s2']().wave.legs.find(l => l.model === m).summary, 'complete', 5);
    const { exitCode, run, calls } = await runWith(tmp,
      { 'r-s2': () => okWave(['gemini', 'gpt', 'qwen'].map(dear)) }, { maxCost: 1 });
    expect(exitCode).toBe(2);
    expect(run.debate.outcome).toBe('skipped-cost-ceiling');
    expect(calls.every(c => c.waveId !== 'r-d1')).toBe(true);   // defense never launched
  });

  test('cost ceiling BEFORE the re-vote wave → skipped-cost-ceiling, exit 2, no re-vote launched', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dbg-cc-rv-'));
    // Cheap stage1/2 (under the ceiling at the debate gate); an expensive defense leg
    // pushes spend past the ceiling before the re-vote wave is considered.
    const bigDefense = () => okWave([mkLeg('gemini',
      defenseOut([{ id: 'A1', action: 'defend', argument: 'x' }]), 'complete', 5)]);
    const { exitCode, run, calls } = await runWith(tmp, { 'r-d1': bigDefense }, { maxCost: 1 });
    expect(exitCode).toBe(2);
    expect(run.debate.outcome).toBe('skipped-cost-ceiling');
    expect(calls.every(c => c.waveId !== 'r-rv')).toBe(true);   // re-vote never launched

    // 4.1.1 Fix C: the re-vote wave never launched, so the debate-revote
    // stage must checkpoint 'skipped' (run-chair.js's convention for the
    // analogous chair-skipped-over-budget case), not a false 'complete' —
    // and, matching that convention, no startedAt/waveId for work that
    // never happened. debate-defense DID launch and stays 'complete'.
    const revoteStage = run.stages.find(s => s.name === 'debate-revote');
    expect(revoteStage.status).toBe('skipped');
    expect(revoteStage.startedAt).toBeUndefined();
    expect(revoteStage.waveId).toBeUndefined();
    const defenseStage = run.stages.find(s => s.name === 'debate-defense');
    expect(defenseStage.status).toBe('complete');
  });

  test('abort mid-debate (defense wave signalled) → finalize aborted, NO tally-final, NO ledger', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dbg-abort-'));
    let appends = 0;
    const launchers = scriptedLaunchers({ ...debateScriptMap(),
      'r-d1': () => okWave([], 143, 'aborted') });          // abort exit code, no leg
    const { exitCode, run } = await runCouncil(e2eOpts(tmp),
      { launchers, appendRunFn: () => { appends += 1; } });
    expect(exitCode).toBe(143);
    expect(run.status).toBe('aborted');
    expect(appends).toBe(0);                                 // ledger never appended
    expect(fs.existsSync(path.join(tmp, 'tally.json'))).toBe(false);  // no tally-final written
    // Even aborted, the debate summary honors the WRITER contract (the key always
    // carries a valid outcome). Task 5's schema requires only `enabled`.
    expect(run.debate).toEqual(expect.objectContaining({ enabled: true, outcome: 'ran' }));
    expect(run.debate.disputed).toBe(1);
  });

  test('lenses + debate → run.json carries the debate summary but NO ledger row', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dbg-lenses-'));
    let appends = 0;
    // Under --lenses Stage 1 is one solo per seat: run-stages.js launches one
    // launchSolo per model with waveId `<runId>-l<i+1>` and run.js writes NO waveId
    // on the stage1 checkpoint (there is no `-s1` wave to name). Verified in Task 0.
    const map = { ...debateScriptMap() };
    delete map['r-s1'];
    map['r-l1'] = () => okWave([mkLeg('gemini', flh.review('gemini'))]);
    map['r-l2'] = () => okWave([mkLeg('gpt', flh.review('gpt'))]);
    map['r-l3'] = () => okWave([mkLeg('qwen', flh.review('qwen'))]);
    const { exitCode, run } = await runCouncil(
      e2eOpts(tmp, { lenses: ['security architect', 'growth-stage VC', 'skeptical buyer'] }),
      { launchers: scriptedLaunchers(map), appendRunFn: () => { appends += 1; } });
    expect(exitCode).toBe(0);
    expect(run.debate.outcome).toBe('ran');
    expect(appends).toBe(0);                                 // lens runs never feed the ledger (v4.0 gate)
    expect(fs.existsSync(path.join(tmp, 'tally.json'))).toBe(true);   // tally-final still written
  });
});
