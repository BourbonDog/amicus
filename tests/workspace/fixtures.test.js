'use strict';

const fs = require('fs');
const path = require('path');

const FX = path.join(__dirname, '..', 'fixtures');
const COMPLETE = path.join(FX, 'council-run-complete');
const DEGRADED = path.join(FX, 'council-run-degraded');
const LIVE = path.join(FX, 'council-run-live');

const readJson = (dir, name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf-8'));

describe('council workspace fixtures', () => {
  test('complete run: envelope, bench, labelMap, all prose artifacts present', () => {
    const run = readJson(COMPLETE, 'run.json');
    expect(run.schemaVersion).toBe(2);
    expect(run.type).toBe('council-run');
    expect(run.runId).toBe('aaaa1111');
    expect(run.status).toBe('complete');
    expect(run.bench).toEqual(['gemini', 'gpt', 'qwen']);
    expect(run.labelMap['Review A']).toBe('gemini');
    for (const f of ['briefing-stage1.md', 'bundle-stage2.md', 'chair-packet.md', 'chair-output.md',
      'tally-input.json', 'tally.json', 'verdict.json', 'report.html',
      'review-gemini.md', 'review-gpt.md', 'review-qwen.md',
      'judge-gemini.md', 'judge-gpt.md', 'judge-qwen.md']) {
      expect(fs.existsSync(path.join(COMPLETE, f))).toBe(true);
    }
  });

  test('complete run: tally has the four tiers incl. one thin singleton', () => {
    const tally = readJson(COMPLETE, 'tally.json');
    expect(tally.tierCounts).toEqual({ Confirmed: 1, Contested: 1, Singleton: 1, Disputed: 1 });
    const c2 = tally.findings.find((f) => f.id === 'C2');
    expect(c2.confidence).toBe('thin');
  });

  test('complete run: chair prose contains a PLANTED fold marker (strip test bait)', () => {
    const chair = fs.readFileSync(path.join(COMPLETE, 'chair-output.md'), 'utf-8');
    expect(chair).toContain('[SIDECAR_FOLD:deadbeefdeadbeef]');
  });

  test('degraded run: partial, chair failed, overallVerdict null, chair-output.md absent', () => {
    const run = readJson(DEGRADED, 'run.json');
    expect(run.status).toBe('partial');
    expect(run.exitCode).toBe(2);
    const verdict = readJson(DEGRADED, 'verdict.json');
    expect(verdict.overallVerdict).toBeNull();
    expect(fs.existsSync(path.join(DEGRADED, 'chair-output.md'))).toBe(false);
  });

  test('live run: non-terminal with an active stage1 wave and leg progress files', () => {
    const run = readJson(LIVE, 'run.json');
    expect(run.status).toBe('running');
    expect(run.stages[0]).toMatchObject({ name: 'stage1', status: 'running', waveId: 'cccc3333-s1' });
    const legDir = path.join(LIVE, '.claude', 'amicus_sessions', 'dddd0001');
    expect(readJson(legDir, 'progress.json').type).toBe('progress');
  });

  // ⚠️ DE-ROT (F16): the engine writes ABSOLUTE paths into `stages[].project`
  // (run.js:127 `project: o.runDir`, run.js:166 `project: <runDir>/_scratch`,
  // run-chair.js:92) and into `options.outDir` (run.js:78). A relative "." would
  // make the live leg rollup resolve sessions against process.cwd(). Fixtures
  // therefore ship the `__RUNDIR__` sentinel; `copyRunFixture()` rewrites it.
  test('fixtures carry the __RUNDIR__ sentinel, never a relative path', () => {
    for (const dir of [COMPLETE, DEGRADED, LIVE]) {
      const run = readJson(dir, 'run.json');
      expect(run.options.outDir).toBe('__RUNDIR__');
      for (const s of run.stages) {
        if (s.project) { expect(s.project.startsWith('__RUNDIR__')).toBe(true); }
      }
    }
  });
});
