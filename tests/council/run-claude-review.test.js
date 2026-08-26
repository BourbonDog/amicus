// tests/council/run-claude-review.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runCouncil, pickFallbackChair } = require('../../src/council/run');
const { happyLaunchers } = require('./helpers/fake-launchers');
const { runDebate } = require('../../src/council/run-debate');
const { tally } = require('../../src/council/tally');

function writeReview(dir, ok) {
  const p = path.join(dir, 'review-claude.md');
  const body = ok
    ? 'Claude review prose.\n```json\n{"overall":"t","findings":[{"id":1,"severity":"major","claim":"c","location":"l","rationale":"r"}]}\n```\n'
    : 'Claude review prose but no findings block at all.';
  fs.writeFileSync(p, body);
  return p;
}

function opts(tmp, extra) {
  return { briefing: 'Review X', models: ['gemini', 'gpt', 'qwen'], chair: 'deepseek',
    project: tmp, runId: 'r', runDir: tmp, date: '2026-07-19', ...extra };
}

// Repo idiom for every driver test (run-happy/run-chair/run-degrade): inject the
// ledger + stats + signal seams. Without appendRunFn the run appends a REAL
// 'claude' row to the developer's ~/.amicus/council-ledger.jsonl — the exact row
// that makes claude a promotable fallback chair (see the pickFallbackChair test).
const noSignals = () => () => {};

describe('--claude-review valid file', () => {
  test('claude joins the bundle as review N+1; meta + runStats reflect it; no extra leg', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-rev-'));
    const reviewPath = writeReview(tmp, true);
    let launchCount = 0;
    const script = happyLaunchers({ onLaunch: () => { launchCount += 1; } });
    const { exitCode } = await runCouncil(opts(tmp, { claudeReviewFile: reviewPath }),
      { launchers: script, appendRunFn: jest.fn(), statsFn: () => [], installSignalAbortFn: noSignals });
    expect(exitCode).toBe(0);
    const tallyDoc = JSON.parse(fs.readFileSync(path.join(tmp, 'tally.json'), 'utf-8'));
    expect(tallyDoc.meta.claudeInCouncil).toBe(true);
    expect(tallyDoc.meta.models).toContain('claude');
    const row = tallyDoc.runStats.find(r => r.model === 'claude');
    expect(row).toMatchObject({ role: 'claude', status: 'complete', durationMs: null, usage: null, conformance: 'clean' });
    expect(row.wasChair).toBe(false);
    // claude's findings entered the tally with a run-global label id (D-series for a 3-seat bench)
    expect(tallyDoc.findings.some(f => f.id.startsWith('D'))).toBe(true);
    // Follow-up 4: at least one judge ranks Review D (claude) too, exercising
    // claude's street-cred/ledger path — the exact path pickFallbackChair's
    // claude-exclusion guard defends against, and previously untouched by any
    // fixture (every ranking array stopped at Review C).
    const claudeSC = tallyDoc.streetCred.find(s => s.model === 'claude');
    expect(claudeSC.peersOnly).not.toBeNull();
    // §4.4: the chair packet includes Claude's de-anonymized review like any other bench review.
    const packet = fs.readFileSync(path.join(tmp, 'chair-packet.md'), 'utf-8');
    expect(packet).toContain('Review by claude');
    expect(packet).toContain('Claude review prose.');
    // §4.4 BUNDLE vs ROSTER — claude's review IS in the Stage-2 judge bundle (label D)…
    const bundle = fs.readFileSync(path.join(tmp, 'bundle-stage2.md'), 'utf-8');
    expect(bundle).toContain('--- Review D ---');
    expect(bundle).toContain('Claude review prose.');
    expect(bundle).toContain('D1 [major] c');   // its findings joined the run-global index
    // …but the judge ROSTER is bench-only: no judge leg is launched for claude.
    const s2call = script.calls.find(c => c.waveId === 'r-s2');
    expect(s2call.models).toEqual(['gemini', 'gpt', 'qwen']);
    expect(script.calls.every(c => !(c.models || []).includes('claude'))).toBe(true);
    expect(script.calls.every(c => c.model !== 'claude')).toBe(true);
    // exactly one launch per bench seat + one judge wave + one chair solo — none for 'claude'.
    expect(launchCount).toBe(3); // r-s1 (wave), r-s2 (wave), r-ch1 (solo); claude never launches
    // the label map is checkpointed with claude as the LAST label (review N+1).
    const runDoc = JSON.parse(fs.readFileSync(path.join(tmp, 'run.json'), 'utf-8'));
    expect(runDoc.labelMap['Review D']).toBe('claude');
  });
});

describe('claude is never a fallback chair (spec §4.4 "never chairs")', () => {
  test('pickFallbackChair skips a claude ledger row even with the best street cred', () => {
    // Every claude-review run puts 'claude' in meta.models → the ledger → `council
    // stats`. pickFallbackChair only filters the bench and the failed chair, so
    // without an explicit exclusion a LATER run would promote claude to chair.
    const rows = [
      { model: 'claude', avgStreetCredPeersOnly: 1.0 },   // best (lowest mean rank)
      { model: 'kimi', avgStreetCredPeersOnly: 2.0 },
    ];
    expect(pickFallbackChair(rows, ['gemini', 'gpt', 'qwen'], 'deepseek')).toBe('kimi');
  });
  test('a claude-only candidate pool yields no fallback chair at all', () => {
    expect(pickFallbackChair([{ model: 'claude', avgStreetCredPeersOnly: 1.0 }],
      ['gemini', 'gpt', 'qwen'], 'deepseek')).toBe(null);
  });

  test('a resolvedModel-bearing rowset still never yields claude (v4.7 D11 guard pin)', () => {
    const rows = [
      { model: 'claude', aliases: ['claude'], avgStreetCredPeersOnly: 0.5 },
      { model: 'x/exec', aliases: ['x'], avgStreetCredPeersOnly: 3.0 },
    ];
    expect(pickFallbackChair(rows, [], null)).toBe('x');
  });
});

describe('--claude-review invalid file → pre-flight error, zero spend', () => {
  test('exit 1, COUNCIL_CLAUDE_REVIEW_INVALID, no launches', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-bad-'));
    const reviewPath = writeReview(tmp, false);
    let launches = 0;
    const { exitCode, run } = await runCouncil(opts(tmp, { claudeReviewFile: reviewPath }),
      { launchers: { launchWave: async () => { launches += 1; return { wave: { legs: [] } }; },
        launchSolo: async () => { launches += 1; return { wave: { legs: [] }, leg: null }; } },
        appendRunFn: jest.fn(), statsFn: () => [], installSignalAbortFn: noSignals });
    expect(exitCode).toBe(1);
    expect(launches).toBe(0);
    expect(run.error.code).toBe('COUNCIL_CLAUDE_REVIEW_INVALID');
    expect(run.error.message).toContain('council_claude_review_invalid');
    // The pre-flight runs AFTER initRun, so the error doc lands in a run dir that
    // exists — status 'error', exit 1, and no ledger row (nothing was tallied).
    const runDoc = JSON.parse(fs.readFileSync(path.join(tmp, 'run.json'), 'utf-8'));
    expect(runDoc.status).toBe('error');
  });

  test('an unreadable path is the same pre-flight error, zero launches', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-enoent-'));
    let launches = 0;
    const { exitCode, run } = await runCouncil(
      opts(tmp, { claudeReviewFile: path.join(tmp, 'nope.md') }),
      { launchers: { launchWave: async () => { launches += 1; return { wave: { legs: [] } }; },
        launchSolo: async () => { launches += 1; return { wave: { legs: [] }, leg: null }; } },
        appendRunFn: jest.fn(), statsFn: () => [], installSignalAbortFn: noSignals });
    expect(exitCode).toBe(1);
    expect(launches).toBe(0);
    expect(run.error.code).toBe('COUNCIL_CLAUDE_REVIEW_INVALID');
    expect(run.error.message).toContain('cannot read');
  });
});

describe('--chair claude → pre-flight error', () => {
  test('exit 1, no launches', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chair-claude-'));
    const reviewPath = writeReview(tmp, true);
    let launches = 0;
    const { exitCode, run } = await runCouncil(opts(tmp, { chair: 'claude', claudeReviewFile: reviewPath }),
      { launchers: { launchWave: async () => { launches += 1; return { wave: { legs: [] } }; },
        launchSolo: async () => { launches += 1; return { wave: { legs: [] }, leg: null }; } },
        appendRunFn: jest.fn(), statsFn: () => [], installSignalAbortFn: noSignals });
    expect(exitCode).toBe(1);
    expect(launches).toBe(0);
    expect(run.error.code).toBe('COUNCIL_CLAUDE_REVIEW_INVALID');
  });
});

// Finding 1 (v4.1 final whole-branch review): preflightClaudeReview guarded
// o.chair and o.models but NOT o.critic — a library caller (MCP/GitHub
// Action/direct require('./council/run'), none of which route through the
// CLI's option whitelist at cli-handlers-council-run.js:101) could pass
// critic:'claude' straight through pre-flight, and run-stages.js:71 would
// launch a REAL paid solo for the reserved seat — the exact invariant v4.1
// promises never happens. Mirrors the sibling --chair claude test above.
describe('--critic claude → pre-flight error (Finding 1)', () => {
  test('exit 1, no launches, ledger never appended', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'critic-claude-'));
    const reviewPath = writeReview(tmp, true);
    let launches = 0;
    const appendRunFn = jest.fn();
    const { exitCode, run } = await runCouncil(
      opts(tmp, { critic: 'claude', claudeReviewFile: reviewPath }),
      { launchers: { launchWave: async () => { launches += 1; return { wave: { legs: [] } }; },
        launchSolo: async () => { launches += 1; return { wave: { legs: [] }, leg: null }; } },
        appendRunFn, statsFn: () => [], installSignalAbortFn: noSignals });
    expect(exitCode).toBe(1);
    expect(launches).toBe(0);
    expect(run.error.code).toBe('COUNCIL_CLAUDE_REVIEW_INVALID');
    expect(run.error.message).toContain('critic');
    expect(appendRunFn).not.toHaveBeenCalled();
  });
});

// Finding 3: unreachable via the CLI's option whitelist, but MCP / the GitHub
// Action / a direct require('./council/run') all bypass that whitelist — the
// engine itself must refuse the collision, exactly like the sibling
// `--chair claude` guard above, or a synthesized claude row permanently
// corrupts the append-only ledger's real bench-leg claude row.
describe('--models includes "claude" + --claude-review → pre-flight error (Finding 3)', () => {
  test('exit 1, no launches, ledger never appended', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-bench-collision-'));
    const reviewPath = writeReview(tmp, true);
    let launches = 0;
    const appendRunFn = jest.fn();
    const { exitCode, run } = await runCouncil(
      opts(tmp, { models: ['gemini', 'claude', 'qwen'], claudeReviewFile: reviewPath }),
      { launchers: { launchWave: async () => { launches += 1; return { wave: { legs: [] } }; },
        launchSolo: async () => { launches += 1; return { wave: { legs: [] }, leg: null }; } },
        appendRunFn, statsFn: () => [], installSignalAbortFn: noSignals });
    expect(exitCode).toBe(1);
    expect(launches).toBe(0);
    expect(run.error.code).toBe('COUNCIL_CLAUDE_REVIEW_INVALID');
    expect(appendRunFn).not.toHaveBeenCalled();
  });
});

describe('debate never launches a defense leg for claude (§4.4 no leg, ever)', () => {
  test('a Disputed claude-raised finding gets no defense solo — the original stands', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-debate-'));
    fs.mkdirSync(path.join(tmp, '_scratch'), { recursive: true });
    const tallyInput = {
      meta: { runId: 'r', models: ['gemini', 'gpt', 'qwen', 'claude'], chair: 'deepseek',
        claudeInCouncil: true, date: '2026-07-19' },
      findings: [
        { id: 'A1', raiser: 'gemini', severity: 'major', claim: 'bench claim', location: 'l' },
        { id: 'D1', raiser: 'claude', severity: 'major', claim: 'claude claim', location: 'l' },
      ],
      adjudications: [
        { findingId: 'A1', judge: 'gpt', verdict: 'agree' },
        { findingId: 'A1', judge: 'qwen', verdict: 'agree' },
        { findingId: 'D1', judge: 'gpt', verdict: 'dispute' },
        { findingId: 'D1', judge: 'qwen', verdict: 'dispute' },
      ],
      rankings: [{ judge: 'gpt', order: ['gemini', 'qwen'] }, { judge: 'qwen', order: ['gemini', 'gpt'] }],
      runStats: [],
    };
    const provisionalRecord = tally(tallyInput);
    expect(provisionalRecord.findings.find(f => f.id === 'D1').tier).toBe('Disputed');
    const seen = [];
    const ctx = {
      o: { runId: 'r', runDir: tmp, timeout: 10, gateway: 'auto', date: '2026-07-19',
        maxCost: null, noCostGate: false, models: ['gemini', 'gpt', 'qwen'] },
      launchers: {
        launchSolo: async (o) => { seen.push(o); throw new Error(`launched a leg for ${o.model}`); },
        launchWave: async (o) => { seen.push(o); throw new Error(`launched a wave ${o.models}`); },
      },
      addWave: () => {}, overBudget: () => false, scratchDir: path.join(tmp, '_scratch'),
    };
    const dbg = await runDebate(ctx, { provisionalRecord, tallyInput });
    expect(seen).toEqual([]);                       // claude has no leg to launch
    expect(dbg.debateSummary.disputed).toBe(1);     // it is still counted as disputed
    // Finding 1 fix: claude's contested/disputed findings are recorded as
    // 'no-response' (spec §5.7's dead/no-response fallback) — audit parity with
    // a dead defense leg — WITHOUT ever adding a claude entry to defenseResults.
    expect(dbg.debateFindings).toEqual([
      { id: 'D1', raiser: 'claude', action: 'no-response', previousTier: 'Disputed' },
    ]);
    expect(dbg.debateSummary.noResponse).toBe(1);
    expect(dbg.debateSummary.defended).toBe(0);
    expect(tally(dbg.debatedInput).findings.find(f => f.id === 'D1').tier).toBe('Disputed');
  });
});

describe('Finding 1: debate round with claude as the ONLY raiser of a debatable finding', () => {
  test('end-to-end: no dangling "--- Debate round outcomes ---" heading in the chair packet', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-debate-e2e-'));
    const reviewPath = writeReview(tmp, true);
    const { review, judgeOut, mkLeg, okWave, launchersFromScript } = require('./helpers/fake-launchers');
    // A1/B1/C1 (bench) are uncontested (2 peer agrees each); D1 (claude's, the
    // only claude-review finding) is Disputed by 2 of 3 bench judges — the ONLY
    // debatable finding, and its raiser ('claude') has no leg to defend it.
    const map = {
      'r-s1': (opts) => okWave(opts.models.map(m => mkLeg(m, review(m)))),
      'r-s2': () => okWave([
        mkLeg('gemini', judgeOut(['Review B', 'Review C', 'Review A'],
          [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'agree' }, { id: 'C1', verdict: 'agree' }, { id: 'D1', verdict: 'dispute' }])),
        mkLeg('gpt', judgeOut(['Review A', 'Review C', 'Review B'],
          [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'agree' }, { id: 'C1', verdict: 'agree' }, { id: 'D1', verdict: 'dispute' }])),
        mkLeg('qwen', judgeOut(['Review A', 'Review B', 'Review C'],
          [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'agree' }, { id: 'C1', verdict: 'agree' }, { id: 'D1', verdict: 'agree' }])),
      ]),
      'r-ch1': () => okWave([mkLeg('deepseek', 'Synthesis.\n\nVERDICT: Ship it', 'complete', 0.03)]),
      // Deliberately NOT scripting 'r-d1'/'r-rv' — a launch attempt for either
      // throws (launchersFromScript), proving no leg is ever launched for claude.
    };
    const { exitCode, run } = await runCouncil(
      opts(tmp, { claudeReviewFile: reviewPath, debate: true }),
      { launchers: launchersFromScript(map), appendRunFn: jest.fn(), statsFn: () => [], installSignalAbortFn: noSignals });
    expect(exitCode).toBe(0);          // no leg failed → not degraded
    expect(run.debate).toMatchObject({ outcome: 'ran', disputed: 1, defended: 0, noResponse: 1 });

    const debateDoc = JSON.parse(fs.readFileSync(path.join(tmp, 'debate.json'), 'utf-8'));
    expect(debateDoc.findings).toEqual([
      { id: 'D1', raiser: 'claude', action: 'no-response', previousTier: 'Disputed' },
    ]);
    expect(debateDoc.revotes).toEqual([]);

    const packet = fs.readFileSync(path.join(tmp, 'chair-packet.md'), 'utf-8');
    expect(packet).toContain('--- Debate round outcomes ---');
    expect(packet).toContain('D1');
    expect(packet).toContain('no-response');
    // The dangling-heading bug: the heading followed immediately by nothing but
    // whitespace/EOF. Must NOT occur now that D1's outcome is real content.
    expect(packet).not.toMatch(/--- Debate round outcomes ---\n\n$/);

    const tallyDoc = JSON.parse(fs.readFileSync(path.join(tmp, 'tally.json'), 'utf-8'));
    expect(tallyDoc.findings.find(f => f.id === 'D1').debate)
      .toEqual({ action: 'no-response', previousTier: 'Disputed' });
  });
});
