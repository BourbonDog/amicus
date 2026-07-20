// tests/mcp-envelope.test.js
'use strict';

/**
 * v4.0 §7 — "MCP success returns get schemaVersion + type injected additively."
 * Session-shaped docs/acks carry type 'run', wave-shaped 'wave', abort acks
 * 'abort'. amicus_list stays a bare array (documented exclusion). The CLI
 * `status --json` doc inherits the envelope because handleStatus delegates to
 * handlers.amicus_status.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('child_process', () => ({
  spawn: jest.fn(() => ({ pid: 4242, unref: jest.fn() })),
}));

const { handlers } = require('../src/mcp-server');

function writeSession(projectDir, taskId, meta) {
  const dir = path.join(projectDir, '.claude', 'amicus_sessions', taskId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify({
    taskId, status: 'complete', model: 'gemini', createdAt: new Date().toISOString(), ...meta,
  }, null, 2));
  return dir;
}

describe('MCP success-return envelope (v4.0 §7)', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-envelope-')); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  test('amicus_status (session) carries schemaVersion and type run', async () => {
    writeSession(tmpDir, 'env-run-1', { status: 'complete', mode: 'headless' });
    const res = await handlers.amicus_status({ taskId: 'env-run-1' }, tmpDir);
    const doc = JSON.parse(res.content[0].text);
    expect(doc.schemaVersion).toBe(2);
    expect(doc.type).toBe('run');
    expect(doc.taskId).toBe('env-run-1');
    expect(doc.status).toBe('complete');
  });

  test('amicus_status (wave) keeps type wave and gains schemaVersion', async () => {
    writeSession(tmpDir, 'env-wv-1-1', { status: 'complete' });
    writeSession(tmpDir, 'env-wv-1', { type: 'wave', status: 'complete', legs: ['env-wv-1-1'] });
    const res = await handlers.amicus_status({ taskId: 'env-wv-1' }, tmpDir);
    const doc = JSON.parse(res.content[0].text);
    expect(doc.schemaVersion).toBe(2);
    expect(doc.type).toBe('wave');
    expect(doc.legsTotal).toBe(1);
  });

  test('amicus_continue ack carries {schemaVersion, type: run}', async () => {
    writeSession(tmpDir, 'env-cont-1', { status: 'complete' });
    const res = await handlers.amicus_continue(
      { taskId: 'env-cont-1', prompt: 'follow up', noUi: true }, tmpDir);
    expect(res.isError).toBeFalsy();
    const doc = JSON.parse(res.content[0].text);
    expect(doc.schemaVersion).toBe(2);
    expect(doc.type).toBe('run');
    expect(doc.status).toBe('running');
  });

  test('amicus_resume ack carries {schemaVersion, type: run}', async () => {
    writeSession(tmpDir, 'env-res-1', { status: 'complete' });
    const res = await handlers.amicus_resume({ taskId: 'env-res-1' }, tmpDir, null);
    expect(res.isError).toBeFalsy();
    const doc = JSON.parse(res.content[0].text);
    expect(doc.schemaVersion).toBe(2);
    expect(doc.type).toBe('run');
    expect(doc.taskId).toBe('env-res-1');
  });

  test('amicus_abort (session) ack carries {schemaVersion, type: abort}', async () => {
    writeSession(tmpDir, 'env-ab-1', { status: 'running', pid: 999999 });
    const res = await handlers.amicus_abort({ taskId: 'env-ab-1' }, tmpDir);
    const doc = JSON.parse(res.content[0].text);
    expect(doc.schemaVersion).toBe(2);
    expect(doc.type).toBe('abort');
    expect(doc.status).toBe('aborted');
  });

  test('amicus_abort (wave) ack carries {schemaVersion, type: abort}', async () => {
    writeSession(tmpDir, 'env-abw-1-1', { status: 'running', pid: 999999 });
    writeSession(tmpDir, 'env-abw-1', { type: 'wave', status: 'running', legs: ['env-abw-1-1'], pid: 999999 });
    const res = await handlers.amicus_abort({ taskId: 'env-abw-1' }, tmpDir);
    const doc = JSON.parse(res.content[0].text);
    expect(doc.schemaVersion).toBe(2);
    expect(doc.type).toBe('abort');
    expect(doc.legsAborted).toBe(1);
  });

  test('amicus_fanout ack carries {schemaVersion, type: wave}', async () => {
    const res = await handlers.amicus_fanout(
      { prompt: 'compare approaches', models: ['a/b', 'c/d'] }, tmpDir, null);
    expect(res.isError).toBeFalsy();
    const doc = JSON.parse(res.content[0].text);
    expect(doc.schemaVersion).toBe(2);
    expect(doc.type).toBe('wave');
    expect(Array.isArray(doc.taskIds)).toBe(true);
  });

  test('amicus_list stays a bare array (documented exclusion)', async () => {
    writeSession(tmpDir, 'env-ls-1', { status: 'complete' });
    const res = await handlers.amicus_list({}, tmpDir);
    const doc = JSON.parse(res.content[0].text);
    expect(Array.isArray(doc)).toBe(true);
  });
});
