'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { scanCouncilRuns, readPointer } = require('../../src/workspace/run-scan');

const FX = path.join(__dirname, '..', 'fixtures');

/** Seed a temp project whose sessions dir points at the given fixture dirs. */
function seedProject(entries) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-scan-'));
  const sessions = path.join(project, '.claude', 'amicus_sessions');
  fs.mkdirSync(sessions, { recursive: true });
  for (const [runId, runDir] of Object.entries(entries)) {
    fs.writeFileSync(path.join(sessions, `council-${runId}.json`), JSON.stringify({ runId, runDir }));
  }
  return project;
}

describe('scanCouncilRuns', () => {
  test('builds rows for every pointer, sorted startedAt desc', () => {
    const project = seedProject({
      aaaa1111: path.join(FX, 'council-run-complete'),
      bbbb2222: path.join(FX, 'council-run-degraded'),
      cccc3333: path.join(FX, 'council-run-live'),
    });
    const rows = scanCouncilRuns(project);
    expect(rows.map((r) => r.runId)).toEqual(['cccc3333', 'aaaa1111', 'bbbb2222']);
    const complete = rows.find((r) => r.runId === 'aaaa1111');
    expect(complete.status).toBe('complete');
    expect(complete.bench).toEqual(['gemini', 'gpt', 'qwen']);
    expect(complete.chair).toBe('deepseek');
    expect(complete.overallVerdict).toBe('Fix these first');
    expect(complete.costDisplay).toBe('$0.4321');
    const degraded = rows.find((r) => r.runId === 'bbbb2222');
    expect(degraded.overallVerdict).toBeNull();
    // ⚠️ DE-ROT (F24): was '~$0.31' — unreachable. formatCost gives any amount < 1
    // four decimals (pricing.js:118), so {amount:0.31, source:'estimated'} → '~$0.3100'.
    expect(degraded.costDisplay).toBe('~$0.3100');
  });

  test('dangling pointer and unreadable run.json become error rows, never throw', () => {
    const project = seedProject({ eeee4444: path.join(os.tmpdir(), 'ws-scan-nowhere-' + Date.now()) });
    const badDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-scan-bad-'));
    fs.writeFileSync(path.join(badDir, 'run.json'), '{not json');
    fs.writeFileSync(
      path.join(project, '.claude', 'amicus_sessions', 'council-ffff5555.json'),
      JSON.stringify({ runId: 'ffff5555', runDir: badDir })
    );
    const rows = scanCouncilRuns(project);
    expect(rows).toHaveLength(2);
    for (const row of rows) { expect(row.error).toBeTruthy(); }
  });

  test('non-council files in the sessions dir are ignored; missing dir yields []', () => {
    const project = seedProject({ aaaa1111: path.join(FX, 'council-run-complete') });
    fs.writeFileSync(path.join(project, '.claude', 'amicus_sessions', 'notes.txt'), 'x');
    fs.mkdirSync(path.join(project, '.claude', 'amicus_sessions', 'dddd0001'));
    expect(scanCouncilRuns(project)).toHaveLength(1);
    expect(scanCouncilRuns(path.join(os.tmpdir(), 'ws-scan-empty-' + Date.now()))).toEqual([]);
  });
});

describe('readPointer', () => {
  test('resolves runDir, accepts the council- prefix, errors on missing pointer', () => {
    const project = seedProject({ aaaa1111: path.join(FX, 'council-run-complete') });
    expect(readPointer(project, 'aaaa1111').runDir).toBe(path.join(FX, 'council-run-complete'));
    expect(readPointer(project, 'council-aaaa1111').runDir).toBe(path.join(FX, 'council-run-complete'));
    expect(readPointer(project, '99999999').error).toBeTruthy();
  });
});
