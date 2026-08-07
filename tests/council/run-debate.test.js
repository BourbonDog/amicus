// tests/council/run-debate.test.js
'use strict';
const path = require('path');
const os = require('os');
const fs = require('fs');
const { runDebate, nothingToDebate, disputingJudges } = require('../../src/council/run-debate');
const { tally } = require('../../src/council/tally');
const runState = require('../../src/council/run-state');
const { runCouncil } = require('../../src/council/run');
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

// Fake launchers: defense solo defends A1; re-vote wave has gpt flip to agree, qwen hold dispute.
// Mirrors the run-launch.js DI contract: launchSolo → {wave, exitCode, leg}; launchWave → {wave, exitCode}.
function fakeLaunchers(script, seen) {
  return {
    launchSolo: async (opts) => { if (seen) { seen.push(opts); } return { ...script.solos[opts.waveId], exitCode: 0 }; },
    launchWave: async (opts) => { if (seen) { seen.push(opts); } return { wave: script.waves[opts.waveId], exitCode: 0 }; },
  };
}
function leg(model, summary, waveId) {
  return { model, modelInput: model, status: 'complete', summary, taskId: `${model}-t`,
    ...(waveId !== undefined ? { waveId } : {}) };
}
function wave(legs) { return { status: 'complete', legs }; }
const defenseOut = (resp) => `Defending.\n\`\`\`json\n${JSON.stringify({ responses: resp })}\n\`\`\`\n`;
const revoteOut = (rv) => `Re-voting.\n\`\`\`json\n${JSON.stringify({ revotes: rv })}\n\`\`\`\n`;

function ctxFor(tmp, launchers) {
  return {
    // v4.3 Task 3 (spec §7.2): non-null councilName so legOpts()'s attribution
    // fields can be asserted below, not just checked against a falsy default.
    o: { runId: 'r', runDir: tmp, timeout: 10, gateway: 'auto', date: '2026-07-19', maxCost: null,
      noCostGate: false, councilName: 'nightly-council' },
    launchers, addWave: () => {}, overBudget: () => false, scratchDir: path.join(tmp, '_scratch'),
  };
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
    expect(d1).toMatchObject({ councilRunId: 'r', councilName: 'nightly-council' });
    expect(rv).toMatchObject({ councilRunId: 'r', councilName: 'nightly-council' });
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
        return { wave: wave([leg('gemini', summary)]), leg: leg('gemini', summary), exitCode: 0 };
      },
      launchWave: async () => ({ wave: wave([leg('gpt', revoteOut([{ id: 'A1', verdict: 'agree' }]))]), exitCode: 0 }),
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
        return { wave: wave([leg('gemini', summary)]), leg: leg('gemini', summary), exitCode: 0 };
      },
      launchWave: async () => ({ wave: wave([leg('gpt', revoteOut([{ id: 'A1', verdict: 'agree' }]))]), exitCode: 0 }),
    }), { provisionalRecord: tally(input), tallyInput: input });

    expect(prompts['r-d1r']).toContain(bad);
    expect(prompts['r-d1r']).toContain('YOUR PREVIOUS DEFENSE');
  });
});

// ---- re-vote repair branch (run-debate.js:138-152) — an ALIVE-but-unparseable judge leg is
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
        wave: wave([leg('gpt', 'prose only, no json block', 'r-rv'), leg('qwen', revoteOut([{ id: 'A1', verdict: 'agree' }]), 'r-rv')]),
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
      launchSolo: async () => {
        const out = defenseOut([{ id: 'A1', action: 'defend', argument: 'caps at 5' }]);
        return { wave: wave([leg('gemini', out)]), leg: leg('gemini', out), exitCode: 0 };
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
      launchSolo: async () => ({ wave: wave([leg('gemini', out)]), leg: leg('gemini', out), exitCode: 0 }),
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
      launchSolo: async () => ({ wave: wave([leg('gemini', out)]), leg: leg('gemini', out), exitCode: 0 }),
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
        return { wave: wave([leg(model, out)]), leg: leg(model, out), exitCode: 0 };
      },
      launchWave: async () => { throw new Error('no re-vote wave expected'); },
    };
    await runDebate(ctxFor(tmp, launchers), { provisionalRecord, tallyInput: input });
    expect(maxInFlight).toBe(2);   // a sequential `await` in a for-loop caps this at 1
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
