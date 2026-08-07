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

  test('amicus_list: briefing is sanitized (fence/tag chars stripped, newlines collapsed) and truncated at 80', async () => {
    const dirty = 'Line one with `backticks` and <tags>\nLine two continues on and on to push past eighty characters total length here';
    createSession(tmpDir, 'ls-dirty', { status: 'complete', mode: 'interactive', briefing: dirty });
    const body = parse(await handlers.amicus_list({}, tmpDir));
    const row = body.find(s => s.id === 'ls-dirty');
    expect(row.briefing).not.toMatch(/[`<>]/);
    expect(row.briefing).not.toMatch(/\n/);
    expect(row.briefing.length).toBeLessThanOrEqual(81); // 80 chars + ellipsis
    expect(row.briefing.endsWith('…')).toBe(true);
  });

  // v4.7 F8 (D14): amicus_list now consumes the shared enumerateSessions core.
  // Ordinary rows additively gain tag (when stored) and type/parentWave/legCount
  // (previously MCP-only fields were id/model/status/agent/briefing/createdAt/mode).
  test('amicus_list: rows carry tag when stored, and additively carry type/parentWave/legCount (D14)', async () => {
    createSession(tmpDir, 'ls-tagged', { status: 'complete', tag: 'sprint-42', briefing: 'b3' });
    createSession(tmpDir, 'ls-notag', { status: 'complete', briefing: 'b4' });
    const body = parse(await handlers.amicus_list({}, tmpDir));
    const tagged = body.find(s => s.id === 'ls-tagged');
    const notag = body.find(s => s.id === 'ls-notag');
    expect(tagged.tag).toBe('sprint-42');
    expect('tag' in notag).toBe(false);
    expect(tagged.type).toBe('run');
    expect('parentWave' in tagged).toBe(true);
    expect('legCount' in tagged).toBe(true);
  });
});

describe('Surface C: composed live doc (Task 9 — view:live + read-time leg usage)', () => {
  let tmpDir; let handlers;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'status-livedoc-'));
    handlers = require('../src/mcp-server').handlers;
  });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); jest.resetModules(); });

  test('a running wave status doc carries view:live; a terminal wave does not', async () => {
    createSession(tmpDir, 'wv-live', { type: 'wave', status: 'running', legs: [], pid: process.pid });
    const running = parse(await handlers.amicus_status({ taskId: 'wv-live' }, tmpDir));
    expect(running.view).toBe('live');

    createSession(tmpDir, 'wv-done', { type: 'wave', status: 'complete', legs: [] });
    const terminal = parse(await handlers.amicus_status({ taskId: 'wv-done' }, tmpDir));
    expect('view' in terminal).toBe(false);
  });

  test('a running single-session status doc carries view:live; a terminal one does not', async () => {
    createSession(tmpDir, 'run-live', { status: 'running', pid: process.pid });
    const running = parse(await handlers.amicus_status({ taskId: 'run-live' }, tmpDir));
    expect(running.view).toBe('live');

    createSession(tmpDir, 'run-done', { status: 'complete' });
    const terminal = parse(await handlers.amicus_status({ taskId: 'run-done' }, tmpDir));
    expect('view' in terminal).toBe(false);
  });

  test('a wave leg with seeded progress.usage surfaces leg.usage.cost; a leg without it surfaces no usage key (N3)', async () => {
    const { writeProgress } = require('../src/sidecar/progress');
    createSession(tmpDir, 'wv-usage', {
      type: 'wave', status: 'running', legs: ['wv-usage-1', 'wv-usage-2'], pid: process.pid,
    });
    const legPriced = createSession(tmpDir, 'wv-usage-1', { status: 'running', model: 'openrouter/x/y' });
    writeProgress(legPriced, 'receiving', {
      usage: { tokens: { input: 100, output: 50, reasoning: 0, cacheRead: 0, cacheWrite: 0 }, costReported: 0.05 },
    });
    createSession(tmpDir, 'wv-usage-2', { status: 'running', model: 'openrouter/a/b' }); // no progress.json at all

    const body = parse(await handlers.amicus_status({ taskId: 'wv-usage' }, tmpDir));
    const priced = body.legs.find(l => l.taskId === 'wv-usage-1');
    const unpriced = body.legs.find(l => l.taskId === 'wv-usage-2');
    expect(priced.usage.cost.amount).toBe(0.05);
    expect(priced.usage.cost.source).toBe('reported');
    expect('usage' in unpriced).toBe(false);
    // Wave-level rollup is additive and must never read a ledger — it's built
    // purely from the per-leg progress.json usage snapshots above (A8).
    expect(body.usage.cost.amount).toBeCloseTo(0.05, 5);
  });

  test('a single-session leg with seeded progress.usage surfaces response.usage.cost; without it, no usage key (N3)', async () => {
    const { writeProgress } = require('../src/sidecar/progress');
    const sessDir = createSession(tmpDir, 'run-usage', { status: 'running', model: 'openrouter/x/y', pid: process.pid });
    writeProgress(sessDir, 'receiving', {
      usage: { tokens: { input: 10, output: 5, reasoning: 0, cacheRead: 0, cacheWrite: 0 }, costReported: 0.01 },
    });
    const priced = parse(await handlers.amicus_status({ taskId: 'run-usage' }, tmpDir));
    expect(priced.usage.cost.amount).toBe(0.01);

    createSession(tmpDir, 'run-nousage', { status: 'running', model: 'openrouter/a/b', pid: process.pid }); // no progress.json
    const unpriced = parse(await handlers.amicus_status({ taskId: 'run-nousage' }, tmpDir));
    expect('usage' in unpriced).toBe(false);
  });
});
