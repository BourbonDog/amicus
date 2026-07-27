// tests/council/run-assemble.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const asm = require('../../src/council/run-assemble');
const { tally } = require('../../src/council/tally');

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'council-asm-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const leg = (model, cost = 0.02) => ({
  taskId: `${model}-1`, model, modelInput: model, status: 'complete', summary: 's',
  durationMs: 4200, usage: { cost: { amount: cost, source: 'reported' } },
});

const REVIEWS = [
  { model: 'gemini', role: 'seat', conformance: 'clean', leg: leg('gemini'),
    globalFindings: [{ id: 'A1', raiser: 'gemini', severity: 'major', claim: 'c1' }] },
  { model: 'gpt', role: 'seat', conformance: 'repaired', leg: leg('gpt'),
    globalFindings: [{ id: 'B1', raiser: 'gpt', severity: 'nit', claim: 'c2' }] },
  { model: 'qwen', role: 'critic', conformance: 'clean', leg: leg('qwen'),
    globalFindings: [] },
];
const JUDGES = [
  { judge: 'gemini', ok: true, order: ['gpt', 'gemini', 'qwen'],
    adjudications: [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'neutral' }] },
  { judge: 'gpt', ok: true, order: ['gpt', 'qwen', 'gemini'],
    adjudications: [{ id: 'A1', verdict: 'agree' }, { id: 'B1', verdict: 'agree' }] },
  { judge: 'qwen', ok: false, order: null, adjudications: null },
];

describe('buildTallyInput — five keys + meta pins (spec §5)', () => {
  const input = asm.buildTallyInput({
    runId: 'abc123', date: '2026-07-19', bench: ['gemini', 'gpt', 'qwen'],
    chair: 'deepseek', reviews: REVIEWS, judgeResults: JUDGES,
    chairStats: asm.buildRunStatsEntry({ leg: leg('deepseek', 0.03), role: 'chair', wasChair: true, conformance: 'clean' }),
  });

  test('meta is pinned: headless, claudeInCouncil false, models = bench exactly', () => {
    expect(input.meta).toEqual({
      runId: 'abc123', date: '2026-07-19', runType: 'headless',
      models: ['gemini', 'gpt', 'qwen'],       // critic included, chair excluded
      chair: 'deepseek', claudeInCouncil: false,
    });
  });

  test('all five keys are present', () => {
    for (const k of ['meta', 'findings', 'adjudications', 'rankings', 'runStats']) {
      expect(input).toHaveProperty(k);
    }
  });

  test('adjudications carry the judge field and INCLUDE raiser self-votes (no pre-filter)', () => {
    expect(input.adjudications).toContainEqual({ findingId: 'A1', judge: 'gemini', verdict: 'agree' });
    // gemini is A1's raiser — its vote must still be in the input (tally excludes it itself).
  });

  test('only ok judges contribute rankings; dropped judge absent', () => {
    expect(input.rankings.map(r => r.judge).sort()).toEqual(['gemini', 'gpt']);
  });

  test('runStats: one row per seat + the chair row; verbatim durations/usage', () => {
    expect(input.runStats).toHaveLength(4);
    const chairRow = input.runStats.find(r => r.wasChair);
    expect(chairRow).toMatchObject({ model: 'deepseek', role: 'chair', durationMs: 4200 });
    const gpt = input.runStats.find(r => r.model === 'gpt');
    expect(gpt.conformance).toBe('repaired');
  });

  test('the input feeds tally() without throwing (five-keys contract)', () => {
    const record = tally(input);
    expect(record.tierCounts.Confirmed).toBe(1);   // A1: gpt agrees (peer), gemini self-vote excluded
  });
});

// Finding 3: --models containing the reserved 'claude' seat, combined with
// --claude-review, corrupts the append-only ledger (a synthesized claude row
// collides with a real bench leg's claude row on ledger.js's Map join). The
// CLI whitelist happens to block claudeReviewFile, but MCP/GitHub
// Action/direct require('./council/run') callers all bypass it — so the guard
// belongs at the engine level, next to the sibling `--chair claude` guard.
describe('preflightClaudeReview rejects a reserved-seat collision in --models (Finding 3)', () => {
  test('models containing "claude" + a claude-review file is a pre-flight error', () => {
    // A REAL, valid review file: if the models-collision guard weren't there,
    // pre-flight would succeed (claudeReview non-null, error null) rather than
    // failing for the unrelated "cannot read" reason — so this proves the
    // guard itself, not a file-read accident.
    const reviewPath = path.join(tmp, 'review-claude.md');
    fs.writeFileSync(reviewPath,
      'Claude review prose.\n```json\n{"overall":"t","findings":[{"id":1,"severity":"major","claim":"c","location":"l","rationale":"r"}]}\n```\n');
    const res = asm.preflightClaudeReview({
      claudeReviewFile: reviewPath, chair: 'deepseek', models: ['gemini', 'claude', 'qwen'],
    });
    expect(res.claudeReview).toBeNull();
    expect(res.error.code).toBe('COUNCIL_CLAUDE_REVIEW_INVALID');
    expect(res.error.message).toContain('models');
  });

  test('the guard is scoped to --claude-review runs: no claudeReviewFile ⇒ untouched', () => {
    // Without --claude-review there is no reserved seat at all — 'claude' in
    // --models is somebody else's problem (model-catalog validation), not this
    // pre-flight's.
    expect(asm.preflightClaudeReview({ claudeReviewFile: null, chair: 'deepseek', models: ['claude'] }))
      .toEqual({ claudeReview: null, error: null });
  });
});

describe('buildRunStatsEntry / worseConformance', () => {
  test('missing leg → null duration and usage (never invent)', () => {
    const row = asm.buildRunStatsEntry({ leg: null, role: 'seat', wasChair: false, conformance: 'clean' });
    expect(row).toEqual({
      model: null, role: 'seat', wasChair: false, conformance: 'clean',
      status: 'error', durationMs: null, usage: null,
    });
  });

  test('explicit model overrides leg.model (alias vs resolved-id join, ledger.js:20-24)', () => {
    const row = asm.buildRunStatsEntry({
      leg: { ...leg('openai/gpt-5.2'), modelInput: 'gpt' },
      model: 'gpt', role: 'seat', wasChair: false, conformance: 'clean',
    });
    expect(row.model).toBe('gpt');
  });

  test('LC-11: findingsUnverified rides the row, but ONLY when true', () => {
    // Same class of fact as `conformance`: a 'repaired' seat whose repair contract
    // could not be checked (no original count to compare) is recorded as unchecked
    // rather than implying a check passed. Absent otherwise, so the v4.4 row shape
    // is byte-for-byte unchanged for every other run.
    const row = asm.buildRunStatsEntry({
      leg: null, role: 'seat', wasChair: false, conformance: 'repaired', findingsUnverified: true,
    });
    expect(row.findingsUnverified).toBe(true);
    for (const v of [false, undefined]) {
      const clean = asm.buildRunStatsEntry({
        leg: null, role: 'seat', wasChair: false, conformance: 'repaired', findingsUnverified: v,
      });
      expect('findingsUnverified' in clean).toBe(false);
    }
  });

  test('LC-11: buildTallyInput carries a review\'s findingsUnverified onto its runStats row', () => {
    const input = asm.buildTallyInput({
      runId: 'abc123', date: '2026-07-19', bench: ['gemini', 'gpt'], chair: 'deepseek',
      reviews: [
        { model: 'gemini', role: 'seat', conformance: 'repaired', findingsUnverified: true,
          leg: leg('gemini'), globalFindings: [] },
        { model: 'gpt', role: 'seat', conformance: 'clean', leg: leg('gpt'), globalFindings: [] },
      ],
      judgeResults: [], chairStats: null,
    });
    expect(input.runStats[0].findingsUnverified).toBe(true);
    expect('findingsUnverified' in input.runStats[1]).toBe(false);
  });

  test('review F1: repairRefused rides the row, but ONLY when set', () => {
    const refused = { code: 'REPAIR_CHANGED_FINDING_COUNT',
      detail: 'repair returned 2 findings, original attempted 1' };
    const row = asm.buildRunStatsEntry({
      leg: null, role: 'seat', wasChair: false, conformance: 'unstructured', repairRefused: refused,
    });
    expect(row.repairRefused).toEqual(refused);
    const clean = asm.buildRunStatsEntry({
      leg: null, role: 'seat', wasChair: false, conformance: 'unstructured',
    });
    expect('repairRefused' in clean).toBe(false);
  });

  test('review F1: buildTallyInput carries a review\'s repairRefused onto its runStats row', () => {
    const refused = { code: 'REPAIR_CHANGED_FINDING_COUNT', detail: 'd' };
    const input = asm.buildTallyInput({
      runId: 'abc123', date: '2026-07-19', bench: ['gemini', 'gpt'], chair: 'deepseek',
      reviews: [
        { model: 'gemini', role: 'seat', conformance: 'unstructured', repairRefused: refused,
          leg: leg('gemini'), globalFindings: [] },
        { model: 'gpt', role: 'seat', conformance: 'clean', leg: leg('gpt'), globalFindings: [] },
      ],
      judgeResults: [], chairStats: null,
    });
    expect(input.runStats[0].repairRefused).toEqual(refused);
    expect('repairRefused' in input.runStats[1]).toBe(false);
  });

  test('worst conformance wins', () => {
    expect(asm.worseConformance('clean', 'repaired')).toBe('repaired');
    expect(asm.worseConformance('unstructured', 'repaired')).toBe('unstructured');
    expect(asm.worseConformance('clean', 'clean')).toBe('clean');
  });
});

describe('artifact emission', () => {
  const input = asm.buildTallyInput({
    runId: 'abc123', date: '2026-07-19', bench: ['gemini', 'gpt', 'qwen'],
    chair: 'deepseek', reviews: REVIEWS, judgeResults: JUDGES, chairStats: null,
  });
  const record = tally(input);

  test('writeTallyFiles writes tally-input.json + tally.json', () => {
    asm.writeTallyFiles({ runDir: tmp, tallyInput: input, record });
    expect(JSON.parse(fs.readFileSync(path.join(tmp, 'tally-input.json'), 'utf-8')).meta.runId).toBe('abc123');
    expect(JSON.parse(fs.readFileSync(path.join(tmp, 'tally.json'), 'utf-8')).tierCounts).toEqual(record.tierCounts);
  });

  test('writeVerdictFiles populates overallVerdict, writes verdict.json + report.html + chair-output.md', () => {
    const verdict = asm.writeVerdictFiles({
      runDir: tmp, record, overallVerdict: 'Fix these first', chairText: 'chair prose\nVERDICT: Fix these first',
    });
    expect(verdict.overallVerdict).toBe('Fix these first');
    const onDisk = JSON.parse(fs.readFileSync(path.join(tmp, 'verdict.json'), 'utf-8'));
    expect(onDisk.overallVerdict).toBe('Fix these first');
    expect(onDisk.findings.every(f => f.decision === null)).toBe(true);   // undecided verdict
    expect(fs.readFileSync(path.join(tmp, 'report.html'), 'utf-8')).toContain('Council Report');
    expect(fs.readFileSync(path.join(tmp, 'chair-output.md'), 'utf-8')).toContain('VERDICT: Fix these first');
  });

  test('writeVerdictFiles with no chair: overallVerdict null, no chair-output.md', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-asm2-'));
    const verdict = asm.writeVerdictFiles({ runDir: dir, record, overallVerdict: null, chairText: null });
    expect(verdict.overallVerdict).toBeNull();
    expect(fs.existsSync(path.join(dir, 'chair-output.md'))).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
