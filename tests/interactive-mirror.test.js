// tests/interactive-mirror.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startInteractiveMirror } = require('../src/sidecar/interactive-mirror');

function tmpSessionDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-sess-'));
  fs.writeFileSync(path.join(d, 'conversation.jsonl'), '');
  return d;
}

const msg = (id, text, completed, usage) => ({ info: { role: 'assistant', id, time: completed ? { completed: 1 } : {}, ...(usage || {}) }, parts: [{ id: `${id}:t`, type: 'text', text }] });

describe('startInteractiveMirror', () => {
  test('mirrors messages to conversation.jsonl live and writes progress', async () => {
    const dir = tmpSessionDir();
    let snapshot = [msg('m1', 'Hello')];
    const mirror = startInteractiveMirror({
      getMessages: async () => snapshot,
      sessionDir: dir,
      intervalMs: 5,
    });
    await new Promise(r => setTimeout(r, 30));
    snapshot = [msg('m1', 'Hello world', true, { tokens: { input: 4, output: 2 }, cost: 0.001 })];
    await new Promise(r => setTimeout(r, 30));
    const res = await mirror.stop();

    const lines = fs.readFileSync(path.join(dir, 'conversation.jsonl'), 'utf-8').split('\n').filter(Boolean).map(JSON.parse);
    expect(lines.map(l => l.content).join('')).toContain('Hello world');
    const progress = JSON.parse(fs.readFileSync(path.join(dir, 'progress.json'), 'utf-8'));
    expect(progress.stage).toBe('complete');
    expect(res.usage).toBeTruthy(); // usageTotals object
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('onActivity fires when new lines are mirrored', async () => {
    const dir = tmpSessionDir();
    let hits = 0;
    let snapshot = [];
    const mirror = startInteractiveMirror({
      getMessages: async () => snapshot, sessionDir: dir, intervalMs: 5, onActivity: () => { hits++; },
    });
    snapshot = [msg('m1', 'hi')];
    await new Promise(r => setTimeout(r, 30));
    await mirror.stop();
    expect(hits).toBeGreaterThan(0);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('getMessages errors are swallowed (best-effort)', async () => {
    const dir = tmpSessionDir();
    const mirror = startInteractiveMirror({ getMessages: async () => { throw new Error('boom'); }, sessionDir: dir, intervalMs: 5 });
    await new Promise(r => setTimeout(r, 20));
    await expect(mirror.stop()).resolves.toBeTruthy();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('stop() resolves even when the final flush poll hangs', async () => {
    const dir = tmpSessionDir();
    // getMessages never resolves — a wedged server. stop() must not hang.
    const mirror = startInteractiveMirror({
      getMessages: () => new Promise(() => {}),
      sessionDir: dir,
      intervalMs: 100000, // don't let the scheduled tick fire during the test
      stopFlushTimeoutMs: 20,
    });
    const start = Date.now();
    await expect(mirror.stop()).resolves.toBeTruthy();
    expect(Date.now() - start).toBeLessThan(2000);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
