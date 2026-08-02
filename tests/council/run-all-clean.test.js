// tests/council/run-all-clean.test.js
'use strict';

/**
 * LC-10 (owner ruling, 2026-07-26): a bench where EVERY seat honestly reports zero
 * findings must produce a coherent run — not a repair storm, not a degraded exit,
 * not a NaN in verdict.json.
 *
 * This is the end-to-end proof for the half of Task 3 that is not the validator:
 * the tally, street-cred, chair packet, verdict and report all have to survive an
 * empty findings pool. `scriptedLaunchers` throws on an unscripted waveId, so the
 * absence of any `-p*` (findings repair) or `-q*` (judge repair) key in the script
 * is itself the assertion that NO paid repair leg fired.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { runCouncil } = require('../../src/council/run');
const { scriptedLaunchers, baseOptions, mkLeg, okWave, judgeOut } = require('./helpers/fake-launchers');

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'council-clean-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const noSignals = () => () => {};

/** A review that read the material and found nothing — valid since LC-10. */
const cleanReview = (n) => `Prose review ${n}. Nothing to report.\n\n\`\`\`json\n`
  + `${JSON.stringify({ overall: `${n} read the whole thing and found no defects.`, findings: [] })}\n\`\`\`\n`;

/** Every seat clean; every judge ranks and adjudicates nothing; the chair verdicts. */
function allCleanScript() {
  return {
    'abc123-s1': (opts) => okWave(opts.models.map(m => mkLeg(m, cleanReview(m)))),
    'abc123-s2': () => okWave([
      mkLeg('gemini', judgeOut(['Review B', 'Review C', 'Review A'], [])),
      mkLeg('gpt', judgeOut(['Review A', 'Review C', 'Review B'], [])),
      mkLeg('qwen', judgeOut(['Review A', 'Review B', 'Review C'], [])),
    ]),
    'abc123-ch1': () => okWave([
      mkLeg('deepseek', 'The bench read it clean.\n\nHARD QUESTIONS\n1. Q?\n\nVERDICT: Ship it',
        'complete', 0.03),
    ]),
  };
}

describe('an all-clean bench produces a coherent run (LC-10)', () => {
  let result; let runDir; let appendRunFn; let launchers;

  beforeEach(async () => {
    appendRunFn = jest.fn();
    const opts = baseOptions(tmp);
    runDir = opts.runDir;
    launchers = scriptedLaunchers(allCleanScript());
    result = await runCouncil(opts, {
      launchers, appendRunFn, statsFn: () => [], installSignalAbortFn: noSignals,
    });
  });

  const readJson = (f) => JSON.parse(fs.readFileSync(path.join(runDir, f), 'utf-8'));

  test('exit 0 — a clean bench is a healthy run, never a degraded one', () => {
    expect(result.exitCode).toBe(0);
    const run = readJson('run.json');
    expect(run.status).toBe('complete');
    expect(run.stages.map(s => [s.name, s.status])).toEqual([
      ['stage1', 'complete'], ['stage2', 'complete'], ['chair', 'complete'],
      ['tally', 'complete'], ['verdict', 'complete'],
    ]);
  });

  test('not one paid repair leg fires — the whole bench is CLEAN', () => {
    // Before LC-10 each of these three seats would have entered the findings
    // repair loop (review F2's guard is what stopped the spend, at the cost of
    // labelling every honest seat 'unstructured').
    const waveIds = launchers.calls.map(c => c.waveId);
    expect(waveIds).toEqual(['abc123-s1', 'abc123-s2', 'abc123-ch1']);
    const tally = readJson('tally.json');
    // #83 (v4.6 Plan 2): 3 seat rows + 3 judge rows (one per bench model, all clean).
    expect(tally.runStats.filter(r => !r.wasChair).map(r => r.conformance))
      .toEqual(['clean', 'clean', 'clean', 'clean', 'clean', 'clean']);
    expect(JSON.stringify(tally)).not.toContain('findingsUnverified');
    expect(JSON.stringify(tally)).not.toContain('repairRefused');
  });

  test('the tally is empty but well-formed — no NaN, no division by zero', () => {
    const tally = readJson('tally.json');
    expect(tally.findings).toEqual([]);
    // countTiers always seeds all four tiers, so this is all-zeros — NOT `{}`.
    expect(tally.tierCounts).toEqual({ Confirmed: 0, Contested: 0, Singleton: 0, Disputed: 0 });
    expect(JSON.stringify(tally)).not.toMatch(/NaN|null,"basis"/);
  });

  test('Stage 2 still earns its keep: street-cred survives a zero-findings pool', () => {
    // The evidence for RUNNING Stage 2 rather than skipping it. Task B (adjudicate)
    // is vacuous on a clean bench, but Task A (rank) is not: it is the only source
    // of street-cred, which feeds verdict.json, the ledger and `council stats`.
    const tally = readJson('tally.json');
    expect(tally.judged).toBe(true);
    for (const s of tally.streetCred) {
      expect(typeof s.peersOnly).toBe('number');
      expect(Number.isNaN(s.peersOnly)).toBe(false);
      expect(Number.isNaN(s.withSelf)).toBe(false);
    }
  });

  test('verdict.json renders with the chair verdict and nothing broken in it', () => {
    const verdict = readJson('verdict.json');
    expect(verdict.findings).toEqual([]);
    expect(verdict.tierCounts).toEqual({ Confirmed: 0, Contested: 0, Singleton: 0, Disputed: 0 });
    expect(verdict.overallVerdict).toBe('Ship it');      // the chair still verdicts
    expect(JSON.stringify(verdict)).not.toMatch(/NaN|undefined/);
    expect(fs.readFileSync(path.join(runDir, 'report.html'), 'utf-8')).toContain('Council Report');
  });

  test('the judge bundle states the empty index instead of a heading over nothing', () => {
    const bundle = fs.readFileSync(path.join(runDir, 'bundle-stage2.md'), 'utf-8');
    expect(bundle).toContain('(none — no review in this bundle raised a finding)');
    expect(bundle).toContain('"adjudications": []');
    expect(bundle).not.toContain('for EVERY finding id listed below');
  });

  test('the chair packet says the bench was clean rather than asking for findings', () => {
    const packet = fs.readFileSync(path.join(runDir, 'chair-packet.md'), 'utf-8');
    expect(packet).toContain('this bench raised NO findings');
    expect(packet).toContain('(none — the bench raised no findings, so there was nothing to adjudicate)');
    // The rankings the judges DID cast are still there — the packet is not blank.
    expect(packet).toMatch(/gemini: \[/);
  });

  test('the ledger records a real clean run, not a null one', () => {
    expect(appendRunFn).toHaveBeenCalledTimes(1);
    const record = appendRunFn.mock.calls[0][0];
    const { buildLedgerRows } = require('../../src/council/ledger');
    const rows = buildLedgerRows(record);
    for (const row of rows.filter(r => r.role !== 'chair')) {
      expect(row.findingsRaised).toBe(0);
      expect(row.bySeverity).toEqual({ blocker: 0, major: 0, minor: 0, nit: 0 });
      // No findings ⇒ no rate to compute. null, never NaN and never a fake 0.
      expect(row.confirmRate).toBeNull();
      expect(row.factErrorRate).toBeNull();
      expect(row.judged).toBe(true);
      expect(typeof row.streetCredPeersOnly).toBe('number');
      expect(row.conformance).toBe('clean');
    }
  });
});

describe('the Stage-2 seam an empty findings index sits on', () => {
  const { parseJudgeOutput } = require('../../src/council/parse-stage2');
  const ctx = { labels: ['Review A', 'Review B'], findingIds: [] };

  test('an empty adjudications array is VALID when no finding ids exist', () => {
    const out = judgeOut(['Review B', 'Review A'], []);
    expect(parseJudgeOutput(out, ctx).ok).toBe(true);
  });

  test('an INVENTED id is still rejected — which is why the bundle must say "[]"', () => {
    // The cost this protects: parse-stage2 validates every adjudication id against
    // the run-global set, so a judge that answers a dangling "adjudicate EVERY
    // finding id listed below" by inventing one fails UNKNOWN_FINDING_ID and buys
    // up to two paid repair solos that cannot succeed either.
    const r = parseJudgeOutput(judgeOut(['Review B', 'Review A'],
      [{ id: 'A1', verdict: 'agree' }]), ctx);
    expect(r.ok).toBe(false);
    expect(r.errors.map(e => e.code)).toContain('UNKNOWN_FINDING_ID');
  });

  test('the ranking is still required — a clean bench does not excuse Task A', () => {
    expect(parseJudgeOutput(judgeOut([], []), ctx).errors.map(e => e.code))
      .toContain('BAD_RANKING');
  });
});

describe('an all-clean bench under --debate', () => {
  test('the debate is skipped with a RECORDED reason, never silently', async () => {
    // The codebase's existing convention for a stage that has nothing to work on:
    // run.json carries `debate.outcome`, so a reader can tell "skipped because
    // there was nothing contested" from "never ran". Zero findings ⇒ zero
    // Contested/Disputed ⇒ nothingToDebate, with no defense or re-vote leg paid for.
    const opts = baseOptions(tmp, { debate: true });
    const launchers = scriptedLaunchers(allCleanScript());
    const result = await runCouncil(opts, {
      launchers, appendRunFn: jest.fn(), statsFn: () => [], installSignalAbortFn: noSignals,
    });
    expect(result.exitCode).toBe(0);
    const run = JSON.parse(fs.readFileSync(path.join(opts.runDir, 'run.json'), 'utf-8'));
    expect(run.debate).toMatchObject({ enabled: true, outcome: 'nothing-to-debate', contested: 0, disputed: 0 });
    expect(launchers.calls.map(c => c.waveId)).toEqual(['abc123-s1', 'abc123-s2', 'abc123-ch1']);
  });
});

describe('a MIXED bench — one clean seat among findings-raising ones (LC-10)', () => {
  test('the clean seat is kept, marked clean, and simply raises nothing', async () => {
    const { review } = require('./helpers/fake-launchers');
    const script = {
      'abc123-s1': () => okWave([
        mkLeg('gemini', review('gemini')),
        mkLeg('gpt', cleanReview('gpt')),
        mkLeg('qwen', review('qwen')),
      ]),
      // Only A1 and C1 exist: gpt raised nothing, so there is no B1 to adjudicate.
      'abc123-s2': () => okWave([
        mkLeg('gemini', judgeOut(['Review B', 'Review C', 'Review A'],
          [{ id: 'A1', verdict: 'agree' }, { id: 'C1', verdict: 'agree' }])),
        mkLeg('gpt', judgeOut(['Review A', 'Review C', 'Review B'],
          [{ id: 'A1', verdict: 'agree' }, { id: 'C1', verdict: 'neutral' }])),
        mkLeg('qwen', judgeOut(['Review A', 'Review B', 'Review C'],
          [{ id: 'A1', verdict: 'neutral' }, { id: 'C1', verdict: 'agree' }])),
      ]),
      'abc123-ch1': () => okWave([mkLeg('deepseek', 'Synthesis.\n\nVERDICT: Ship it', 'complete', 0.03)]),
    };
    const opts = baseOptions(tmp);
    const result = await runCouncil(opts, {
      launchers: scriptedLaunchers(script), appendRunFn: jest.fn(),
      statsFn: () => [], installSignalAbortFn: noSignals,
    });
    expect(result.exitCode).toBe(0);
    const tally = JSON.parse(fs.readFileSync(path.join(opts.runDir, 'tally.json'), 'utf-8'));
    expect(tally.findings.map(f => f.id)).toEqual(['A1', 'C1']);
    expect(tally.runStats.find(r => r.model === 'gpt').conformance).toBe('clean');
    // gpt is still ranked by its peers — an honest clean review keeps its seat AND
    // its street cred, which is the asymmetry EMPTY_FINDINGS used to create.
    expect(typeof tally.streetCred.find(s => s.model === 'gpt').peersOnly).toBe('number');
  });
});
