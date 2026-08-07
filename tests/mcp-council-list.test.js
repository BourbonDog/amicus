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
