'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { scanCouncilRuns, readPointer } = require('../../src/workspace/run-scan');

const FX = path.join(__dirname, '..', 'fixtures');

/** Seed a temp project whose sessions dir points at the given fixture dirs. Registers
 *  whatever literal runDir string it's given — including nonexistent or
 *  external-to-project ones — which is exactly what the dangling-pointer, malformed-run.json,
 *  and readPointer-resolution tests below need. NOT used for tests that need
 *  scanCouncilRuns to actually read the fixture content: since the outer containment fence
 *  (runDir must resolve inside project — see the describe block below) rejects any runDir
 *  outside project, those use seedProjectNested instead. */
function seedProject(entries) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-scan-'));
  const sessions = path.join(project, '.claude', 'amicus_sessions');
  fs.mkdirSync(sessions, { recursive: true });
  for (const [runId, runDir] of Object.entries(entries)) {
    fs.writeFileSync(path.join(sessions, `council-${runId}.json`), JSON.stringify({ runId, runDir }));
  }
  return project;
}

/** Seed a temp project whose sessions dir points at COPIES of the given fixture dirs,
 *  nested under the project (mirrors production: a real runDir is always inside project —
 *  src/mcp-council-run.js:109 rejects an outDir outside the project at creation time).
 *  `entries` maps runId -> a fixture SOURCE dir to copy in. */
function seedProjectNested(entries) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-scan-'));
  const sessions = path.join(project, '.claude', 'amicus_sessions');
  fs.mkdirSync(sessions, { recursive: true });
  for (const [runId, source] of Object.entries(entries)) {
    const runDir = path.join(project, 'runs', `council-${runId}`);
    fs.mkdirSync(runDir, { recursive: true });
    fs.cpSync(source, runDir, { recursive: true });
    fs.writeFileSync(path.join(sessions, `council-${runId}.json`), JSON.stringify({ runId, runDir }));
  }
  return project;
}

describe('scanCouncilRuns', () => {
  test('builds rows for every pointer, sorted startedAt desc', () => {
    const project = seedProjectNested({
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
    // Nested under project (not a separate temp dir) so this exercises the intended
    // "well-formed pointer, unreadable run.json" path rather than tripping the outer
    // containment fence below — that fence has its own dedicated describe block.
    const badDir = path.join(project, 'runs', 'council-ffff5555');
    fs.mkdirSync(badDir, { recursive: true });
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
    const project = seedProjectNested({ aaaa1111: path.join(FX, 'council-run-complete') });
    fs.writeFileSync(path.join(project, '.claude', 'amicus_sessions', 'notes.txt'), 'x');
    fs.mkdirSync(path.join(project, '.claude', 'amicus_sessions', 'dddd0001'));
    expect(scanCouncilRuns(project)).toHaveLength(1);
    expect(scanCouncilRuns(path.join(os.tmpdir(), 'ws-scan-empty-' + Date.now()))).toEqual([]);
  });
});

// Third council-review pass: scanCouncilRuns resolved each pointer and read run.json
// (+ verdict.json) straight from ptr.runDir with no check that runDir itself resolves
// inside project. The pointer file's {runId, runDir} JSON is validated only for
// truthiness (src/council/run-state.js:133-139) — a tampered/stale pointer can point
// runDir anywhere on disk. Mirrors artifact-guard.js's readRunArtifact / run-detail.js's
// getRunDetail outer fence — same isRealpathContained helper (src/workspace/path-fence.js).
// This feeds the GUI run list, so unlike the other two call sites the fenced-out pointer
// must become an error row, not a thrown exception — scanCouncilRuns must keep returning
// every OTHER row.
describe('scanCouncilRuns — outer fence (runDir must resolve inside project)', () => {
  test('a tampered/stale pointer whose runDir resolves outside the project becomes an error row; other rows still return', () => {
    const project = seedProjectNested({ aaaa1111: path.join(FX, 'council-run-complete') });
    // Tamper a second pointer to point completely outside the project — a real,
    // existing, fully-readable directory, just not nested under `project`.
    fs.writeFileSync(
      path.join(project, '.claude', 'amicus_sessions', 'council-bbbb2222.json'),
      JSON.stringify({ runId: 'bbbb2222', runDir: path.join(FX, 'council-run-degraded') })
    );

    const rows = scanCouncilRuns(project);

    expect(rows).toHaveLength(2);
    const escaped = rows.find((r) => r.runId === 'bbbb2222');
    // Distinguishable from the existing dangling-pointer / unreadable-run.json error
    // rows' messages — this is the outer fence firing, before run.json is ever read.
    expect(escaped.error).toBe('run directory escapes project');
    expect(escaped.status).toBeUndefined();
    const ok = rows.find((r) => r.runId === 'aaaa1111');
    expect(ok.error).toBeUndefined();
    expect(ok.status).toBe('complete');
  });
});

describe('readPointer', () => {
  test('resolves runDir, accepts the council- prefix, errors on missing pointer', () => {
    const project = seedProject({ aaaa1111: path.join(FX, 'council-run-complete') });
    expect(readPointer(project, 'aaaa1111').runDir).toBe(path.join(FX, 'council-run-complete'));
    expect(readPointer(project, 'council-aaaa1111').runDir).toBe(path.join(FX, 'council-run-complete'));
    expect(readPointer(project, '99999999').error).toBeTruthy();
  });

  // Security regression (Task 4 review finding #1): a caller-supplied runId reaches
  // runState.readPointer's `council-${runId}.json` path.join with no separator/traversal
  // filtering. A runId like '../../../secret' collapses the literal 'council-..' segment
  // against the following '..' and can resolve anywhere on disk. Proven two ways: the
  // returned row is an error (never a runDir), and the filesystem is never even touched —
  // if fs.readFileSync were called at all here, the traversal path.join would have already
  // been built and reachable.
  test('rejects a runId containing path-traversal segments before any filesystem read', () => {
    const project = seedProject({ aaaa1111: path.join(FX, 'council-run-complete') });
    const spy = jest.spyOn(fs, 'readFileSync');
    try {
      for (const evil of ['../../../../Users/sendt/.ssh/id', '..\\..\\secrets', 'council-../../../etc/passwd']) {
        const res = readPointer(project, evil);
        expect(res.error).toBeTruthy();
        expect(res.runDir).toBeUndefined();
      }
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
