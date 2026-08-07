// tests/mcp-council-list.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const runState = require('../src/council/run-state');

let tmp; let handlers;
beforeEach(() => {
  jest.resetModules();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-clist-'));
  handlers = require('../src/mcp-server').handlers;
});
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); jest.resetModules(); });

function seedSession(taskId, meta) {
  const d = path.join(tmp, '.claude', 'amicus_sessions', taskId);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'metadata.json'), JSON.stringify({
    taskId, model: 'gemini', status: 'complete', createdAt: '2026-07-19T01:00:00.000Z',
    briefing: 'ordinary session', mode: 'headless', ...meta,
  }));
}
function seedCouncil(runId, status, createdAt, extra = {}) {
  const runDir = path.join(tmp, `council-${runId}`);
  runState.initRun(runDir, {
    schemaVersion: 2, type: 'council-run', runId, status,
    stages: [{ name: 'stage1', status: status === 'running' ? 'running' : 'complete' }],
    bench: ['gemini', 'gpt'], chair: 'deepseek', critic: null, lenses: null,
    labelMap: null, options: { outDir: runDir }, usage: null, createdAt,
    ...extra,
  });
  fs.writeFileSync(path.join(runDir, 'briefing.md'), 'council briefing text');
  runState.writePointer(tmp, runId, runDir);
}
const parse = (r) => JSON.parse(r.content[0].text);

describe('amicus_list merges council runs', () => {
  test('council entries appear with type council-run, newest first', async () => {
    seedSession('a1b2c3d4', {});
    seedCouncil('abc123', 'running', '2026-07-19T02:00:00.000Z');
    const rows = parse(await handlers.amicus_list({}, tmp));
    expect(rows[0]).toMatchObject({
      id: 'abc123', type: 'council-run', status: 'running', mode: 'headless', stage: 'stage1',
    });
    expect(rows[0].briefing).toBe('council briefing text');
    expect(rows[1].id).toBe('a1b2c3d4');
  });

  test('status filter applies to council rows too', async () => {
    seedSession('a1b2c3d4', { status: 'running', pid: process.pid });
    seedCouncil('abc123', 'complete', '2026-07-19T02:00:00.000Z');
    const rows = parse(await handlers.amicus_list({ status: 'complete' }, tmp));
    expect(rows.map(r => r.id)).toEqual(['abc123']);
  });

  test('a project with only council runs still lists them', async () => {
    seedCouncil('abc123', 'complete', '2026-07-19T02:00:00.000Z');
    const rows = parse(await handlers.amicus_list({}, tmp));
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('council-run');
  });

  // v4.7 F8 (D14): mcp-council-awareness.js's listCouncilRuns row literal gains
  // tag, absent-not-null (same idiom as the ordinary-session rows).
  test('council rows carry tag when the run recorded one (D14)', async () => {
    seedCouncil('tagged11', 'complete', '2026-07-19T02:00:00.000Z', { tag: 'sprint-42' });
    const rows = parse(await handlers.amicus_list({}, tmp));
    expect(rows.find(r => r.id === 'tagged11').tag).toBe('sprint-42');
  });

  test('council rows omit tag entirely when the run recorded none', async () => {
    seedCouncil('notagged1', 'complete', '2026-07-19T02:00:00.000Z');
    const rows = parse(await handlers.amicus_list({}, tmp));
    expect('tag' in rows.find(r => r.id === 'notagged1')).toBe(false);
  });
});

// v4.7 F8 (D15, errata E-PR3-5): --search over council-run rows on the MCP
// surface. Material resolution re-derives runDir from the pointer file
// (never trusts anything already on the row) and re-fences it with
// containsOnDisk, same as listCouncilRuns itself does at :214.
function seedCouncilNoBriefingMd(runId, status, createdAt, stage1Material) {
  const runDir = path.join(tmp, `council-${runId}`);
  runState.initRun(runDir, {
    schemaVersion: 2, type: 'council-run', runId, status,
    stages: [{ name: 'stage1', status: status === 'running' ? 'running' : 'complete' }],
    bench: ['gemini', 'gpt'], chair: 'deepseek', critic: null, lenses: null,
    labelMap: null, options: { outDir: runDir }, usage: null, createdAt,
  });
  // No briefing.md — mirrors a CLI-launched `amicus council run`, which only
  // ever writes briefing-stage1.md (src/council/run.js:129).
  fs.writeFileSync(path.join(runDir, 'briefing-stage1.md'),
    `some findings-contract prose\n\n--- MATERIAL / BRIEFING ---\n\n${stage1Material}`);
  runState.writePointer(tmp, runId, runDir);
}

describe('amicus_list --search over council rows (F8 D15, errata E-PR3-5)', () => {
  test('matches a council row via its briefing.md text', async () => {
    seedCouncil('needle01', 'complete', '2026-07-19T02:00:00.000Z');
    fs.writeFileSync(path.join(tmp, 'council-needle01', 'briefing.md'), 'council material with FLAMINGO inside');
    seedCouncil('other001', 'complete', '2026-07-19T02:00:00.000Z');
    const rows = parse(await handlers.amicus_list({ search: 'flamingo' }, tmp));
    expect(rows.map(r => r.id)).toEqual(['needle01']);
  });

  test('matches via briefing-stage1.md (post-separator) when briefing.md is absent', async () => {
    seedCouncilNoBriefingMd('stage1a1', 'complete', '2026-07-19T02:00:00.000Z', 'material text with PELICAN inside');
    seedCouncil('other002', 'complete', '2026-07-19T02:00:00.000Z');
    const rows = parse(await handlers.amicus_list({ search: 'pelican' }, tmp));
    expect(rows.map(r => r.id)).toEqual(['stage1a1']);
  });

  test('a council row with neither briefing.md nor briefing-stage1.md degrades to id/tag matching, never throws', async () => {
    const runDir = path.join(tmp, 'council-nomatc1');
    runState.initRun(runDir, {
      schemaVersion: 2, type: 'council-run', runId: 'nomatc1', status: 'complete',
      stages: [{ name: 'stage1', status: 'complete' }],
      bench: ['gemini'], chair: 'deepseek', critic: null, lenses: null,
      labelMap: null, options: { outDir: runDir }, usage: null, createdAt: '2026-07-19T02:00:00.000Z',
    });
    runState.writePointer(tmp, 'nomatc1', runDir);

    const noMatch = await handlers.amicus_list({ search: 'anything' }, tmp);
    expect(noMatch.content[0].text).toContain('No amicus sessions found');

    const byId = parse(await handlers.amicus_list({ search: 'nomatc1' }, tmp));
    expect(byId.map(r => r.id)).toEqual(['nomatc1']);
  });
});
