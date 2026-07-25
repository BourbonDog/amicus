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
    // Live/running run: usage is null (only finalize() ever writes it) and there is
    // no verdict.json yet — costDisplay/tierCounts/overallVerdict must reflect that
    // absent state rather than being left untested.
    const live = rows.find((r) => r.runId === 'cccc3333');
    expect(live.status).toBe('running');
    expect(live.costDisplay).toBe('—');
    expect(live.tierCounts).toBeNull();
    expect(live.overallVerdict).toBeNull();
  });

  test('dangling pointer and unreadable run.json become error rows, never throw', () => {
    const project = seedProject({ eeee4444: path.join(os.tmpdir(), 'ws-scan-nowhere-' + Date.now()) });
    const badDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-scan-bad-'));
    fs.writeFileSync(path.join(badDir, 'run.json'), '{not json');
    fs.writeFileSync(
      path.join(project, '.claude', 'amicus_sessions', 'council-ffff5555.json'),
      JSON.stringify({ runId: 'ffff5555', runDir: badDir })
    );
    // A pointer file that is itself malformed JSON. Unlike the two cases above (both
    // well-formed pointers that fail later at the run.json read), this one exercises
    // scanCouncilRuns's own `if (ptr.error)` branch — the readPointer adapter's
    // null-pointer path, reached here because the walk loop only calls readPointer
    // for filenames readdirSync just returned (so the missing-pointer-file case in
    // the readPointer describe block below is unreachable from inside the scan).
    fs.writeFileSync(path.join(project, '.claude', 'amicus_sessions', 'council-gggg6666.json'), '{not json');
    const rows = scanCouncilRuns(project);
    expect(rows).toHaveLength(3);
    for (const row of rows) { expect(row.error).toBeTruthy(); }
    const malformedPointer = rows.find((r) => r.runId === 'gggg6666');
    expect(malformedPointer.runDir).toBeNull();
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
