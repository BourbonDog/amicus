'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { getRunDetail, TERMINAL_STATUSES } = require('../../src/workspace/run-detail');

const FX = path.join(__dirname, '..', 'fixtures');

function seedProject(entries) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-detail-'));
  const sessions = path.join(project, '.claude', 'amicus_sessions');
  fs.mkdirSync(sessions, { recursive: true });
  for (const [runId, runDir] of Object.entries(entries)) {
    fs.writeFileSync(path.join(sessions, `council-${runId}.json`), JSON.stringify({ runId, runDir }));
  }
  return project;
}

describe('getRunDetail', () => {
  test('complete fixture: docs parsed, derived models populated', () => {
    const project = seedProject({ aaaa1111: path.join(FX, 'council-run-complete') });
    const d = getRunDetail(project, 'aaaa1111');
    expect(d.run.schemaVersion).toBe(2);
    expect(d.derived.schemaSupported).toBe(true);
    expect(d.derived.names).toEqual([
      { label: 'Review A', model: 'gemini' },
      { label: 'Review B', model: 'gpt' },
      { label: 'Review C', model: 'qwen' },
    ]);
    // ⚠️ DE-ROT (F27): was ['stage1','stage2','tally','chair','verdict']. The engine runs the chair
    // BEFORE the final tally — run.js:261 runChair (stamps the stage at run-chair.js:92) precedes
    // run.js:283-285 writeTallyFiles + updateStage — and stages[] is append-ordered
    // (run-state.js:95-102). Pinned by the shipped tests/council/run-debate.test.js:616.
    // REQUIRED COMPANION EDIT (Task 1): swap the `chair` entry ahead of `tally` in BOTH run.json
    // fixtures (complete + degraded) and shift the timestamps so chair completes before tally starts.
    expect(d.derived.stageRail.map((s) => s.name)).toEqual(['stage1', 'stage2', 'chair', 'tally', 'verdict']);
    // ⚠️ PRE-FLIGHT (P1): was 'Stage 1 · reviews' — see the STAGE_LABELS note in Step 4.
    expect(d.derived.stageRail[0].label).toBe('Stage 1 — independent review');
    expect(d.derived.matrix.rows).toHaveLength(4);
    expect(d.derived.cost.rows).toHaveLength(4);
    expect(d.derived.cost.totalDisplay).toBe('$0.4321');
    expect(d.derived.cost.maxCost).toBe(2);
    expect(d.derived.cost.costAmount).toBeCloseTo(0.4321);
    expect(d.derived.verdictPanel.overallVerdict).toBe('Fix these first');
    expect(d.derived.verdictPanel.decisions).toEqual([{ id: 'A1', decision: 'accept', applied: true }]);
    expect(d.artifacts['chair-output.md']).toMatchObject({ present: true });
    expect(d.artifacts['report.html'].present).toBe(true);
  });

  test('degraded fixture: null overallVerdict + run.json error reason + absent chair artifact', () => {
    const project = seedProject({ bbbb2222: path.join(FX, 'council-run-degraded') });
    const d = getRunDetail(project, 'bbbb2222');
    expect(d.derived.verdictPanel.overallVerdict).toBeNull();
    // ⚠️ PRE-FLIGHT (P3): was the raw fixture string. `run.error` is null on every partial run
    // (verified: run.js:293 is the only exit-2 finalize and passes no error), so the reason is
    // derived from the chair stage's `status:'error'`. See degradedReason() in Step 4.
    expect(d.derived.verdictPanel.reason).toBe('Chair synthesis stage failed');
    expect(d.artifacts['chair-output.md'].present).toBe(false);
    expect(d.run.status).toBe('partial');
  });

  test('malformed tally.json yields {parseError, rawPath} and a null matrix; run still renders', () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-detail-run-'));
    for (const f of ['run.json', 'verdict.json']) {
      fs.copyFileSync(path.join(FX, 'council-run-complete', f), path.join(runDir, f));
    }
    fs.writeFileSync(path.join(runDir, 'tally.json'), '{broken');
    const project = seedProject({ aaaa1111: runDir });
    const d = getRunDetail(project, 'aaaa1111');
    expect(d.tally.parseError).toBeTruthy();
    expect(d.tally.rawPath).toBe(path.join(runDir, 'tally.json'));
    expect(d.derived.matrix).toBeNull();
    expect(d.derived.verdictPanel.overallVerdict).toBe('Fix these first');
  });

  test('schemaVersion mismatch flips schemaSupported; absent verdict yields present:false panel', () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-detail-run2-'));
    const run = JSON.parse(fs.readFileSync(path.join(FX, 'council-run-complete', 'run.json'), 'utf-8'));
    run.schemaVersion = 3;
    fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify(run));
    const project = seedProject({ aaaa1111: runDir });
    const d = getRunDetail(project, 'aaaa1111');
    expect(d.derived.schemaSupported).toBe(false);
    expect(d.verdict).toBeNull();
    expect(d.derived.verdictPanel.present).toBe(false);
  });

  test('missing pointer / missing run.json produce top-level {error}', () => {
    const project = seedProject({});
    expect(getRunDetail(project, '99999999').error).toBeTruthy();
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-detail-empty-'));
    const project2 = seedProject({ aaaa1111: emptyDir });
    expect(getRunDetail(project2, 'aaaa1111').error).toBe('run.json missing');
  });

  test('TERMINAL_STATUSES mirrors the shipped composed-doc terminal set', () => {
    // ⚠️ DE-ROT (F26): widened from 5 names to the 7 in src/observe/live-doc.js:18
    // (added 'crashed' and 'idle-timeout'), same order, so the Task 14 drift pin passes.
    expect(TERMINAL_STATUSES).toEqual(
      ['complete', 'partial', 'error', 'crashed', 'aborted', 'timeout', 'idle-timeout']
    );
  });
});
