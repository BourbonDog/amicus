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
 * Scope for all six: `npx jest tests/list-council-merge.test.js
 * tests/list-limit.test.js tests/list-search.test.js
 * tests/mcp-council-list.test.js tests/read-json.test.js --maxWorkers=2` →
 * 5 suites / 68 tests. Measured 2026-08-26, each applied ALONE to
 * src/sidecar/list-council.js (`NOTEALWAYS`/`NOTEINJSON`: src/sidecar/read.js)
 * and reverted; source restored by byte copy and checksum-verified, never by
 * `git checkout`. Every count below was RE-RUN against the round-2 suite, not
 * renumbered from the round-1 record.
 *
 * `NOCOUNCILROWS` — `mergeCouncilRows` returns `rows` untouched, i.e. the
 *   pre-W12 CLI: **1 suite / 19 tests red**, all here. The seven that stay GREEN
 *   are the point, not a gap — "session rows are BYTE-IDENTICAL", "a wave row is
 *   untouched", the three note controls that seed no council run, "the premise
 *   is true" and "a status matching neither row kind" all assert an ABSENCE, and
 *   a merge that never happens satisfies every one of them by construction. The
 *   other four suites stay green too, which is what says the MCP surface was not
 *   disturbed.
 * `UNCAPPEDSTAGE` — the council MODEL cell stops owning its width (returns the
 *   raw `council(<stage>)`): **1 suite / 1 test red**, here — "the widest
 *   RUNNING stage name still leaves the column a space". Precisely scoped: the
 *   cap is pinned independently of the cell's content.
 * `NORESORT` — council rows are appended instead of merged into the newest-first
 *   order: **1 suite / 5 tests red**, all here — the ordering test, `--limit`
 *   (which slices the top N of that order), `--json` (whose row order is the
 *   document's order), and round 2's two whole-document pins (the
 *   byte-identical listing and B3's exact-spelling row order). The TIE test
 *   stays green by design: appending and a stable re-sort agree on a tie, which
 *   is exactly why the tie needed its own test rather than being read off the
 *   ordering one — and B2's "keeps its concatenation slot" stays green for the
 *   same reason, which is itself the measurement B2 rests on.
 * `NOSCOPENOTE` — `councilScopeNotice` returns `''`, i.e. the round-1 CLI that
 *   documented the `--all` scope limit without ever saying it: **1 suite / 3
 *   tests red** — A1's three positive assertions (under the table, without a
 *   council row, and on the empty listing). A1's two controls stay green by
 *   construction — they assert the note's ABSENCE without `--all` and in
 *   `--json`, which an empty note satisfies.
 * `NOTEALWAYS` — the print loses its `if (all)` gate in read.js's human branch:
 *   **1 suite / 7 tests red**. The intended killer is "WITHOUT --all the human
 *   output is byte-identical"; the other six are row-order assertions that read
 *   the printed `lines()` and now find one more of them. Named because that
 *   byte-identical control is a PRESERVATION pin — green at HEAD by
 *   construction — and a preservation pin without a mutant proves nothing.
 * `NOTEINJSON` — the EMPTY-listing note loses its `!json` half (read.js's early
 *   return, the one line both modes share): **1 suite / 1 test red**, the
 *   `--json` empty control. The other preservation pin, precisely scoped: it
 *   fails for the guard alone, not for anything about the note's text.
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

/**
 * ROUND 2, A1 — the `--all` scope limit is SPOKEN, not merely documented.
 *
 * Round 1 wrote the caveat into docs/usage.md and `mergeCouncilRows`'s docblock:
 * under `--all` the session rows span every indexed project while the council
 * rows do not, because council runs are found through per-project pointer files
 * (`src/council/run-state.js :: listPointers`) and there is no cross-project
 * council index to walk. A caveat only a reader of the source can see is
 * exactly the correct-but-silent degrade the product principle rejects (README /
 * BACKLOG.md: self-heal or self-diagnose, ALWAYS transparently). So the runtime
 * says it, once, under the table.
 *
 * The disclosure is HUMAN-SURFACE ONLY, and the two controls below are why:
 * `--json` is a machine contract whose shape may not change (not even on
 * stderr, where the truncation notice legitimately goes — that one names a cap
 * a script can raise; this one names a limit nothing can lift), and a listing
 * without `--all` must stay byte-identical to its pre-note self.
 */
describe('amicus list --all — the scope limit speaks (round 2, A1)', () => {
  const NOTE = 'council runs: current project only (no cross-project index).';

  it('--all prints the disclosure exactly once, as the last line under the table', async () => {
    seedSession('sesall03', { createdAt: '2026-07-19T01:00:00.000Z' });
    seedCouncil('cnlall03', 'running', '2026-07-19T02:00:00.000Z');
    await listSidecars({ project, all: true });
    expect(lines().filter(l => l === NOTE)).toHaveLength(1);
    expect(lines()[lines().length - 1]).toBe(NOTE);
    // …and the rows it qualifies are still printed above it.
    expect(rowFor('cnlall03')).toBeDefined();
  });

  it('the note does not wait for a council row — the OMISSION is what it discloses', async () => {
    seedSession('sesall04', { createdAt: '2026-07-19T01:00:00.000Z' });
    await listSidecars({ project, all: true });
    expect(stdout()).toContain(NOTE);
  });

  it('WITHOUT --all the human output is byte-identical to the pre-note listing', async () => {
    seedSession('sesall05', { createdAt: '2026-07-19T01:00:00.000Z' });
    seedCouncil('cnlall05', 'running', '2026-07-19T02:00:00.000Z');
    await listSidecars({ project });
    expect(stdout()).toBe([
      'ID'.padEnd(10) + 'MODEL'.padEnd(23) + 'STATUS'.padEnd(11)
        + 'TAG'.padEnd(12) + 'AGE'.padEnd(12) + 'BRIEFING',
      '─'.repeat(80),
      'cnlall05'.padEnd(10) + 'council(stage1)'.padEnd(23) + 'running'.padEnd(11)
        + ''.padEnd(12) + formatAge('2026-07-19T02:00:00.000Z').padEnd(12)
        + 'council briefing text',
      'sesall05'.padEnd(10) + 'vendorx/model-a'.padEnd(23) + 'complete'.padEnd(11)
        + ''.padEnd(12) + formatAge('2026-07-19T01:00:00.000Z').padEnd(12)
        + 'ordinary session briefing',
    ].join('\n'));
  });

  it('an EMPTY --all listing carries it too — that is where the silence was loudest', async () => {
    // The residual case the table-side note cannot reach: a project with
    // nothing of its own, `--all`, and a council run sitting in some OTHER
    // project. Pre-fix that printed a bare "No amicus sessions found." — the
    // most complete version of the omission A1 is about.
    await listSidecars({ project, all: true });
    expect(stdout()).toContain('No amicus sessions found.');
    expect(stdout()).toContain(NOTE);
  });

  it('…but the empty listing under --json is untouched (that path prints in both modes)', async () => {
    await listSidecars({ project, all: true, json: true });
    expect(stdout()).toBe('No amicus sessions found.');
  });

  it('--json --all keeps its shape — the note is on neither stdout nor stderr', async () => {
    seedCouncil('cnlall06', 'running', '2026-07-19T02:00:00.000Z');
    await listSidecars({ project, all: true, json: true });
    // Parses at all only if the note stayed out of the document.
    expect(JSON.parse(stdout()).map(r => r.id)).toContain('cnlall06');
    expect(stdout()).not.toContain('council runs:');
    expect(errSpy.mock.calls.map(c => String(c[0])).join('\n')).not.toContain('council runs:');
  });
});

/**
 * ROUND 2, B2 — the createdAt-less row, MEASURED rather than argued.
 *
 * The claim: such a row makes the merge comparator return NaN, so it "silently
 * keeps relative order instead of being placed deterministically". Both halves
 * are answered here.
 *
 *  - NaN is not a third outcome. ECMA-262's SortCompare maps a NaN comparator
 *    result to +0 — "equal" — and V8's sort is stable, so the row keeps its slot
 *    in the concatenation (session rows first, then `listCouncilRuns` order).
 *    KEEPING THAT ORDER *IS* BEING PLACED DETERMINISTICALLY: same input, same
 *    output, every run — which is what the second test pins, by listing twice.
 *  - And nothing silent about it: with no `createdAt` the AGE cell renders
 *    `NaNd ago`, in the row, in front of the reader.
 *
 * PRODUCIBILITY, measured: no first-party writer can emit such a row. Every
 * session metadata.json is stamped at creation
 * (`src/session-manager.js :: createSession`,
 * `src/sidecar/fanout.js :: runFanout`,
 * `src/sidecar/continue.js :: createContinueSessionMetadata`,
 * `src/sidecar/start-metadata.js :: createSessionMetadata`) and so is every
 * council run.json (`src/council/run-state.js :: initCouncilRun` for a CLI run,
 * `src/mcp-council-run.js :: handleCouncilRunTool` for the MCP pre-seed, with
 * `initRun` preserving whichever landed first). The row below is manufactured
 * by seeding run.json with the key absent — reachable only from a hand-edited,
 * legacy, or foreign file, which is exactly why it is worth a control.
 */
describe('amicus list — a row with no createdAt is placed, not lost (round 2, B2)', () => {
  it('the premise is true: the comparator really does go NaN', () => {
    expect(Number.isNaN(new Date(undefined) - new Date('2026-07-19T02:00:00.000Z'))).toBe(true);
  });

  it('it keeps its concatenation slot, and the same input prints the same list every time', async () => {
    seedSession('sesnan01', { createdAt: '2026-07-19T01:00:00.000Z' });
    seedCouncil('cnlnan01', 'complete', undefined);
    await listSidecars({ project });
    const first = stdout();
    expect(lines().slice(2).map(l => l.slice(0, 8))).toEqual(['sesnan01', 'cnlnan01']);
    logSpy.mockClear();
    await listSidecars({ project });
    expect(stdout()).toBe(first);
  });

  it('and the AGE cell says so out loud (a control on today\'s behavior, not an endorsement)', async () => {
    seedCouncil('cnlnan02', 'complete', undefined);
    await listSidecars({ project });
    expect(rowFor('cnlnan02').slice(56, 68)).toBe('NaNd ago'.padEnd(12));
  });
});

/**
 * ROUND 2, B3 — `--status` is EXACT EQUALITY on BOTH sides of the merge.
 *
 * The claim was that the council filter's exact `===` might disagree with a
 * broader session-side match (an `error` that also caught `crashed`/
 * `timed-out`), leaving the merged list internally inconsistent. Measured: all
 * three status filters in the repo are the same `s.status === <wanted>` —
 * `src/sidecar/read.js :: enumerateSessions`,
 * `src/sidecar/read.js :: enumerateAllProjects`, and
 * `src/mcp-server.js :: amicus_list`, which applies one filter to the already
 * merged array — against `src/sidecar/list-council.js :: mergeCouncilRows`.
 * Refuted; this is the drift pin that keeps it refuted, driving BOTH filters
 * with a status that matches neither row kind.
 */
describe('amicus list — --status is exact on both sides of the merge (round 2, B3)', () => {
  it('a status matching neither row kind returns neither (no broader match on either side)', async () => {
    seedSession('sesst001', { status: 'error', createdAt: '2026-07-19T01:00:00.000Z' });
    seedCouncil('cnlst001', 'error', '2026-07-19T02:00:00.000Z');
    await listSidecars({ project, status: 'crashed' });
    expect(stdout()).toContain('No amicus sessions found.');
  });

  it('the exact spelling returns both kinds', async () => {
    seedSession('sesst002', { status: 'error', createdAt: '2026-07-19T01:00:00.000Z' });
    seedCouncil('cnlst002', 'error', '2026-07-19T02:00:00.000Z');
    await listSidecars({ project, status: 'error' });
    expect(lines().slice(2).map(l => l.slice(0, 8))).toEqual(['cnlst002', 'sesst002']);
  });
});
