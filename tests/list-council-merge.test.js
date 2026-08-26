// tests/list-council-merge.test.js
'use strict';
/**
 * v4.9 W12 — council runs are first-class rows in the CLI `amicus list`.
 *
 * WHY. `amicus_list` (the MCP surface) has merged council runs since v4.0 §8;
 * the CLI never did, so a council run launched from the terminal was invisible
 * to the terminal — `amicus list` said "No amicus sessions found." in a project
 * whose only work was a council. `listCouncilRuns`
 * (src/mcp-council-awareness.js :: listCouncilRuns) has no MCP-specific
 * coupling; the merge is
 * the same one, on the other surface.
 *
 * THE KICKOFF RULINGS this pins:
 *  - each surface owns its TRUNCATION: `listCouncilRuns` sanitizes the briefing
 *    to an 80-char preview for the MCP document, and the CLI re-truncates that
 *    preview to its own 30-char BRIEFING column exactly as it does a session's;
 *  - the MODEL cell renders `council(<stage>)`, mirroring the wave row's
 *    `wave(N legs)` — a council run has no model of its own.
 *
 * THE ORDERING STORY, measured rather than assumed. Both enumerators already
 * return newest-first by `createdAt` (`enumerateSessions`, read.js; and
 * `enumerateAllProjects`), and the merge re-sorts the concatenation with THAT
 * SAME comparator — which is what makes it honest: `Array.prototype.sort` is
 * stable, so re-sorting an already-sorted array cannot reorder the session rows
 * among themselves. Council rows join the one newest-first order, and on an
 * exact `createdAt` tie the session row (concatenated first) stays first.
 *
 * ── NAMED MUTANTS with MEASURED red sets ───────────────────────────────────
 * Scope for all three: `npx jest tests/list-council-merge.test.js
 * tests/list-limit.test.js tests/list-search.test.js
 * tests/mcp-council-list.test.js tests/read-json.test.js --maxWorkers=2` →
 * 5 suites / 57 tests. Measured 2026-08-26, each applied ALONE to
 * src/sidecar/list-council.js and reverted; source restored by byte copy and
 * checksum-verified, never by `git checkout`.
 *
 * `NOCOUNCILROWS` — `mergeCouncilRows` returns `rows` untouched, i.e. the
 *   pre-W12 CLI: **1 suite / 13 tests red**, all here. The two that stay GREEN
 *   are the point, not a gap — "session rows are BYTE-IDENTICAL" and "a wave row
 *   is untouched" are the absence-of-change controls, and a merge that never
 *   happens satisfies both by construction. The other four suites stay green
 *   too, which is what says the MCP surface was not disturbed.
 * `UNCAPPEDSTAGE` — the council MODEL cell stops owning its width (returns the
 *   raw `council(<stage>)`): **1 suite / 1 test red**, here — "the widest
 *   RUNNING stage name still leaves the column a space". Precisely scoped: the
 *   cap is pinned independently of the cell's content.
 * `NORESORT` — council rows are appended instead of merged into the newest-first
 *   order: **1 suite / 3 tests red**, all here — the ordering test, `--limit`
 *   (which slices the top N of that order) and `--json` (whose row order is the
 *   document's order). The TIE test stays green by design: appending and a
 *   stable re-sort agree on a tie, which is exactly why the tie needed its own
 *   test rather than being read off the ordering one.
 * ⚠️ RE-RUN, NEVER RENUMBER: a recorded red set asserts the set still fails.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const runState = require('../src/council/run-state');
const { listSidecars, formatAge } = require('../src/sidecar/read');

let project; let logSpy; let errSpy;
beforeEach(() => {
  project = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-clist-cli-'));
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  logSpy.mockRestore();
  errSpy.mockRestore();
  fs.rmSync(project, { recursive: true, force: true });
});

const lines = () => logSpy.mock.calls.map(c => c[0]).join('\n').split('\n');
const stdout = () => logSpy.mock.calls.map(c => c[0]).join('\n');
/** The one printed row whose ID cell is `id` (never a substring match). */
const rowFor = (id) => lines().find(l => l.startsWith(id.padEnd(10)));

function seedSession(taskId, meta = {}) {
  const dir = path.join(project, '.claude', 'amicus_sessions', taskId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify({
    taskId, model: 'vendorx/model-a', status: 'complete', mode: 'headless',
    briefing: 'ordinary session briefing', createdAt: '2026-07-19T01:00:00.000Z', ...meta,
  }, null, 2));
}

function seedCouncil(runId, status, createdAt, opts = {}) {
  const runDir = path.join(project, `council-${runId}`);
  runState.initRun(runDir, {
    schemaVersion: 2, type: 'council-run', runId, status,
    stages: [{ name: opts.stage || 'stage1', status: status === 'running' ? 'running' : 'complete' }],
    bench: ['vendorx/model-a', 'vendorx/model-b'], chair: 'vendorx/chair',
    critic: null, lenses: null, labelMap: null, options: { outDir: runDir },
    usage: null, createdAt, ...(opts.tag ? { tag: opts.tag } : {}),
  });
  fs.writeFileSync(path.join(runDir, 'briefing.md'),
    opts.briefing === undefined ? 'council briefing text' : opts.briefing);
  runState.writePointer(project, runId, runDir);
  return runDir;
}

describe('amicus list — council runs are merged (W12)', () => {
  it('a project whose ONLY work is a council run no longer reports an empty list', async () => {
    seedCouncil('cnl00001', 'running', '2026-07-19T02:00:00.000Z');
    await listSidecars({ project });
    expect(stdout()).not.toContain('No amicus sessions found.');
    expect(rowFor('cnl00001')).toBeDefined();
  });

  it('the MODEL cell renders council(<stage>), mirroring wave(N legs)', async () => {
    seedCouncil('cnl00001', 'running', '2026-07-19T02:00:00.000Z', { stage: 'stage2' });
    await listSidecars({ project });
    const row = rowFor('cnl00001');
    expect(row.slice(10, 33)).toBe('council(stage2)'.padEnd(23));
    // The cell OWNS its column: STATUS starts where the header says it does.
    expect(row.slice(33)).toMatch(/^running/);
  });

  it('the widest RUNNING stage name still leaves the column a space', async () => {
    // `debate-defense` is the longest stage that is ever checkpointed
    // `running` (src/council/run-debate-stage.js :: runDebateStage) —
    // `council(debate-defense)` is 23
    // characters, exactly the column, which would butt against STATUS.
    seedCouncil('cnl00002', 'running', '2026-07-19T02:00:00.000Z', { stage: 'debate-defense' });
    await listSidecars({ project });
    const row = rowFor('cnl00002');
    expect(row.slice(10, 33)).toBe('council(debate-defen…)'.padEnd(23));
    expect(row.slice(33)).toMatch(/^running/);
  });

  it('a TERMINAL run has no running stage, so the cell is a bare council', async () => {
    seedCouncil('cnl00003', 'complete', '2026-07-19T02:00:00.000Z');
    await listSidecars({ project });
    expect(rowFor('cnl00003').slice(10, 33)).toBe('council'.padEnd(23));
  });

  it('the STATUS, TAG, AGE and BRIEFING cells all render for a council row', async () => {
    seedCouncil('cnl00004', 'running', '2026-07-19T02:00:00.000Z', { tag: 'sprint-42' });
    await listSidecars({ project });
    const age = formatAge('2026-07-19T02:00:00.000Z');
    expect(rowFor('cnl00004')).toBe(
      'cnl00004'.padEnd(10) + 'council(stage1)'.padEnd(23) + 'running'.padEnd(11)
      + 'sprint-42'.padEnd(12) + age.padEnd(12) + 'council briefing text');
  });

  it('the CLI re-truncates the 80-char preview to its OWN 30 (each surface owns its width)', async () => {
    const long = `${'B'.repeat(40)} ${'C'.repeat(60)}`; // 101 chars: over both widths
    seedCouncil('cnl00005', 'running', '2026-07-19T02:00:00.000Z', { briefing: long });
    await listSidecars({ project });
    // listCouncilRuns hands over sanitizePreview(text, 80); the CLI cuts that
    // to 30 and marks the cut, exactly as it does a session's briefing.
    expect(rowFor('cnl00005').slice(68)).toBe(`${long.slice(0, 30)}...`);
  });
});

describe('amicus list — the merged ordering, and what it must not disturb', () => {
  it('council and session rows share ONE newest-first order', async () => {
    seedSession('sesold01', { createdAt: '2026-07-19T01:00:00.000Z' });
    seedCouncil('cnlmid01', 'complete', '2026-07-19T02:00:00.000Z');
    seedSession('sesnew01', { createdAt: '2026-07-19T03:00:00.000Z' });
    await listSidecars({ project });
    const ids = lines().slice(2).map(l => l.slice(0, 8));
    expect(ids).toEqual(['sesnew01', 'cnlmid01', 'sesold01']);
  });

  it('an exact createdAt tie keeps the session row first (the sort is stable)', async () => {
    seedSession('sestie01', { createdAt: '2026-07-19T02:00:00.000Z' });
    seedCouncil('cnltie01', 'complete', '2026-07-19T02:00:00.000Z');
    await listSidecars({ project });
    expect(lines().slice(2).map(l => l.slice(0, 8))).toEqual(['sestie01', 'cnltie01']);
  });

  it('session rows are BYTE-IDENTICAL to what they were before the merge', async () => {
    seedSession('sesbyte1', { createdAt: '2026-07-19T01:00:00.000Z' });
    seedCouncil('cnlbyte1', 'running', '2026-07-19T02:00:00.000Z');
    await listSidecars({ project });
    const age = formatAge('2026-07-19T01:00:00.000Z');
    expect(rowFor('sesbyte1')).toBe(
      'sesbyte1'.padEnd(10) + 'vendorx/model-a'.padEnd(23) + 'complete'.padEnd(11)
      + ''.padEnd(12) + age.padEnd(12) + 'ordinary session briefing');
    // …header and rule included: the columns did not move.
    expect(lines()[0]).toBe(
      'ID'.padEnd(10) + 'MODEL'.padEnd(23) + 'STATUS'.padEnd(11)
      + 'TAG'.padEnd(12) + 'AGE'.padEnd(12) + 'BRIEFING');
    expect(lines()[1]).toBe('─'.repeat(80));
  });

  it('a wave row is untouched by the merge', async () => {
    seedSession('wav00001', { type: 'wave', legs: ['l1', 'l2', 'l3'], createdAt: '2026-07-19T04:00:00.000Z' });
    seedCouncil('cnlwav01', 'running', '2026-07-19T02:00:00.000Z');
    await listSidecars({ project });
    expect(rowFor('wav00001').slice(10, 33)).toBe('wave(3 legs)'.padEnd(23));
  });
});

describe('amicus list — the flags apply to council rows too', () => {
  it('--status filters them exactly as it filters sessions', async () => {
    seedSession('sesrun01', { status: 'running', createdAt: '2026-07-19T01:00:00.000Z' });
    seedCouncil('cnldone1', 'complete', '2026-07-19T02:00:00.000Z');
    await listSidecars({ project, status: 'complete' });
    expect(lines().slice(2).map(l => l.slice(0, 8))).toEqual(['cnldone1']);
  });

  it('--limit counts them, and the elision notice names the real merged total', async () => {
    seedSession('sesold02', { createdAt: '2026-07-19T01:00:00.000Z' });
    seedCouncil('cnlnew02', 'running', '2026-07-19T03:00:00.000Z');
    await listSidecars({ project, limit: 1 });
    expect(rowFor('cnlnew02')).toBeDefined();
    expect(rowFor('sesold02')).toBeUndefined();
    expect(stdout()).toMatch(/Showing 1 of 2/);
  });

  it('--search reaches a council row through its own on-disk material', async () => {
    seedCouncil('cnlfnd01', 'complete', '2026-07-19T02:00:00.000Z',
      { briefing: 'council material with FLAMINGO inside' });
    seedCouncil('cnloth01', 'complete', '2026-07-19T02:00:00.000Z');
    seedSession('sesoth02', { createdAt: '2026-07-19T01:00:00.000Z' });
    await listSidecars({ project, search: 'flamingo' });
    expect(lines().slice(2).map(l => l.slice(0, 8))).toEqual(['cnlfnd01']);
  });

  it('--json emits council rows as structured documents beside the sessions', async () => {
    seedSession('sesjsn01', { createdAt: '2026-07-19T01:00:00.000Z' });
    seedCouncil('cnljsn01', 'running', '2026-07-19T02:00:00.000Z');
    await listSidecars({ project, json: true });
    const rows = JSON.parse(stdout());
    expect(rows.map(r => r.id)).toEqual(['cnljsn01', 'sesjsn01']);
    expect(rows[0]).toMatchObject({
      id: 'cnljsn01', type: 'council-run', status: 'running', stage: 'stage1', model: null,
    });
  });

  it('--all stamps the council rows with the project they were read from', async () => {
    seedCouncil('cnlall01', 'running', '2026-07-19T02:00:00.000Z');
    await listSidecars({ project, all: true, json: true });
    const row = JSON.parse(stdout()).find(r => r.id === 'cnlall01');
    expect(row.project).toBe(project);
  });
});
