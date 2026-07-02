/** @module tests/mcp-status-enrichment
 * F6/P6-3: amicus_status (single + wave legs) and amicus_list gain
 * mode/phase/messageCount/lastActivityAt/latestPreview. Raw `stage` stays
 * pinned (see tests/mcp-headless-lifecycle.test.js) — this suite only checks
 * the NEW additive fields.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

function createSession(projectDir, taskId, meta) {
  const sessDir = path.join(projectDir, '.claude', 'amicus_sessions', taskId);
  fs.mkdirSync(sessDir, { recursive: true });
  fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
    taskId, status: 'running', model: 'gemini', createdAt: new Date().toISOString(), ...meta,
  }, null, 2));
  return sessDir;
}
const parse = (r) => JSON.parse(r.content[0].text);

describe('amicus_status enrichment (F6)', () => {
  let tmpDir; let handlers;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'status-enrich-'));
    handlers = require('../src/mcp-server').handlers;
  });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); jest.resetModules(); });

  test('running session exposes mode/phase/messageCount/lastActivityAt/latestPreview', async () => {
    const { writeProgress } = require('../src/sidecar/progress');
    const sessDir = createSession(tmpDir, 'enrich-1', {
      status: 'running', pid: process.pid, mode: 'headless', briefing: 'do the thing',
    });
    fs.writeFileSync(path.join(sessDir, 'conversation.jsonl'),
      JSON.stringify({ role: 'assistant', content: 'Scanning `auth.js` now\nline2' }) + '\n');
    writeProgress(sessDir, 'receiving', { messagesReceived: 1 });

    const body = parse(await handlers.amicus_status({ taskId: 'enrich-1' }, tmpDir));
    expect(body.mode).toBe('headless');
    expect(body.phase).toBe('generating');
    expect(body.messageCount).toBe(1);
    expect(body.latestPreview).toBe('Scanning auth.js now line2');
    expect(new Date(body.lastActivityAt).getTime()).toBeGreaterThan(0);
    expect(body.stage).toBe('receiving'); // RAW stage unchanged — back-compat pin
  });

  test('terminal session reports phase terminal; mode inferred from headless flag', async () => {
    createSession(tmpDir, 'enrich-2', { status: 'complete', headless: true });
    const body = parse(await handlers.amicus_status({ taskId: 'enrich-2' }, tmpDir));
    expect(body.phase).toBe('terminal');
    expect(body.mode).toBe('headless');
    // Terminal path must NOT read progress — none of the progress-derived
    // fields may appear on a terminal single-session response.
    expect(body.messageCount).toBeUndefined();
    expect(body.latestPreview).toBeUndefined();
    expect(body.stage).toBeUndefined();
  });

  test('wave legs carry phase + latestPreview + lastActivityAt', async () => {
    createSession(tmpDir, 'wv-1', { type: 'wave', status: 'running', legs: ['wv-1-1'], pid: process.pid });
    const legDir = createSession(tmpDir, 'wv-1-1', { status: 'running' });
    fs.writeFileSync(path.join(legDir, 'conversation.jsonl'),
      JSON.stringify({ role: 'assistant', content: 'leg says hi' }) + '\n');
    const body = parse(await handlers.amicus_status({ taskId: 'wv-1' }, tmpDir));
    expect(body.legs[0].latestPreview).toBe('leg says hi');
    expect(body.legs[0].phase).toBe('starting'); // running + no progress.json stage
    expect(body.legs[0].lastActivityAt).toBeTruthy();
  });

  test('amicus_list: mode on every row; live fields on running rows only', async () => {
    const runDir = createSession(tmpDir, 'ls-run', { status: 'running', mode: 'headless', briefing: 'b' });
    fs.writeFileSync(path.join(runDir, 'conversation.jsonl'),
      JSON.stringify({ role: 'assistant', content: 'working' }) + '\n');
    createSession(tmpDir, 'ls-done', { status: 'complete', mode: 'interactive', briefing: 'b2', createdAt: '2026-01-01T00:00:00Z' });
    const body = parse(await handlers.amicus_list({}, tmpDir));
    const run = body.find(s => s.id === 'ls-run');
    const done = body.find(s => s.id === 'ls-done');
    expect(run.mode).toBe('headless');
    expect(run.messageCount).toBe(1);
    expect(run.latestPreview).toBe('working');
    expect(run.phase).toBe('starting');
    expect(new Date(run.lastActivityAt).getTime()).toBeGreaterThan(0);
    expect(done.mode).toBe('interactive');
    // Enrichment is gated on status === 'running' — a terminal row must carry
    // NONE of the live-progress fields (pins the running-only cost gate).
    expect(done.messageCount).toBeUndefined();
    expect(done.latestPreview).toBeUndefined();
    expect(done.phase).toBeUndefined();
    expect(done.lastActivityAt).toBeUndefined();
  });
});
