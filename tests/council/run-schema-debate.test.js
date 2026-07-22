// tests/council/run-schema-debate.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const Ajv = require('ajv/dist/2020');

const SCHEMA_DIR = path.join(__dirname, '..', '..', 'schemas');
const load = (name) => JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, name), 'utf-8'));
const ajv = new Ajv({ allErrors: true, strict: false });

describe('council-run schema accepts the debate summary (spec §5.1)', () => {
  const validate = ajv.compile(load('council-run.schema.json'));
  const base = {
    schemaVersion: 2, type: 'council-run', runId: 'aaaa1111', status: 'complete',
    bench: ['gemini', 'gpt', 'qwen'], chair: 'deepseek', critic: null, lenses: null,
    labelMap: { 'Review A': 'gemini' }, options: { timeout: 10, maxCost: 2, gateway: 'auto', outDir: null },
    // The SHIPPED schema pins `usage` to `{"type":"object"}`, so `usage: null` is REJECTED.
    // A finalized run.json carries `usage: {cost}` (run.js `finalize`), not the `usage: null`
    // that `initRun` seeds — `null` here makes every positive case fail for the wrong reason.
    usage: { cost: { amount: 0.42, source: 'reported' } }, createdAt: '2026-07-19T00:00:00.000Z',
    stages: [
      { name: 'stage1', status: 'complete' }, { name: 'stage2', status: 'complete' },
      { name: 'tally-provisional', status: 'complete' }, { name: 'debate-defense', status: 'complete' },
      { name: 'debate-revote', status: 'complete' }, { name: 'tally-final', status: 'complete' },
      { name: 'chair', status: 'complete' }, { name: 'verdict', status: 'complete' },
    ],
    debate: { enabled: true, outcome: 'ran', contested: 1, disputed: 1, defended: 1, amended: 0,
      withdrawn: 1, noResponse: 0, revoteJudges: 2, revoteApplied: 2, verdictChanges: 1 },
  };
  test('valid debate run.json passes', () => {
    expect(validate(base)).toBe(true);
  });
  test('a non-debate run.json (no debate key) still passes', () => {
    // Task 4 writes the `debate` key ONLY when --debate is on, so `debate` must stay OUT of the
    // schema's top-level `required` (spec §5.1: without --debate there is no `debate` key).
    const { debate, ...noDebate } = base;
    expect(validate(noDebate)).toBe(true);
  });
  test('a partially-written debate object (only `enabled`) still passes', () => {
    // Task 4's initRun seed carries `outcome` too, but the schema deliberately requires only
    // `enabled`, so a bare-seed `debate` object left by any partial write still validates —
    // `outcome` must NOT be required (see Step 3).
    expect(validate({ ...base, status: 'aborted', exitCode: 143, debate: { enabled: true } })).toBe(true);
  });
  test('a bad debate.outcome enum is rejected', () => {
    expect(validate({ ...base, debate: { ...base.debate, outcome: 'maybe' } })).toBe(false);
  });
  // 4.1.1 Fix C: run.js now checkpoints debate-revote 'skipped' (not a false
  // 'complete') when the re-vote wave never launched. stages[].status is
  // `{"type":"string"}` with no enum, so this is additive — pinned here so a
  // future tightening of that field to a closed enum can't silently reject it.
  test('a debate-revote stage with status "skipped" still validates (status is not a closed enum)', () => {
    const stages = base.stages.map(s => (s.name === 'debate-revote' ? { name: 'debate-revote', status: 'skipped' } : s));
    expect(validate({ ...base, stages })).toBe(true);
  });
});

describe('council-tally / council-verdict accept findings[].debate (spec §5.6)', () => {
  const vTally = ajv.compile(load('council-tally.schema.json'));
  const vVerdict = ajv.compile(load('council-verdict.schema.json'));
  const tallyDoc = {
    schemaVersion: 2, type: 'council-tally',
    meta: { runId: 'r', runType: 'headless', date: 'd', chair: 'deepseek', models: ['gemini', 'gpt', 'qwen'], claudeInCouncil: true },
    findings: [{ id: 'A1', raiser: 'gemini', severity: 'major', tier: 'Contested', basis: { a: 1, d: 1, n: 0 },
      confidence: 'solid', tierOverride: null, adjudications: [], debate: { action: 'defended', previousTier: 'Disputed' } }],
    rankings: [], streetCred: [], runStats: [], tierCounts: { Confirmed: 0, Contested: 1, Singleton: 0, Disputed: 0 }, judged: true,
  };
  test('claude-in-council + debate-decorated tally validates', () => {
    expect(vTally(tallyDoc)).toBe(true);
  });
  test('verdict with a debate-decorated finding validates', () => {
    const verdict = require('../../src/council/verdict').buildVerdict(tallyDoc, [], { overallVerdict: 'Fix these first' });
    expect(vVerdict(verdict)).toBe(true);
    expect(verdict.findings[0].debate).toEqual({ action: 'defended', previousTier: 'Disputed' });
  });
});
