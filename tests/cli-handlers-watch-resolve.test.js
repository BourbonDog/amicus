'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveWatchTarget, handleWatch } = require('../src/cli-handlers-watch');

function project() { return fs.mkdtempSync(path.join(os.tmpdir(), 'watch-')); }
function sess(proj, id, meta) {
  const dir = path.join(proj, '.claude', 'amicus_sessions', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify(meta));
  return dir;
}

describe('resolveWatchTarget (spec 5.1 id resolution)', () => {
  test('a wave metadata resolves to kind wave', () => {
    const proj = project();
    sess(proj, 'w1', { taskId: 'w1', type: 'wave', status: 'running' });
    expect(resolveWatchTarget('w1', proj)).toMatchObject({ kind: 'wave', id: 'w1' });
  });

  test('a council pointer file resolves to kind council', () => {
    const proj = project();
    const runDir = path.join(proj, 'council-c1');
    fs.mkdirSync(runDir, { recursive: true });
    const ptrDir = path.join(proj, '.claude', 'amicus_sessions');
    fs.mkdirSync(ptrDir, { recursive: true });
    fs.writeFileSync(path.join(ptrDir, 'council-c1.json'), JSON.stringify({ runId: 'c1', runDir }));
    expect(resolveWatchTarget('c1', proj)).toMatchObject({ kind: 'council', id: 'c1', runDir });
  });

  test('a plain session resolves to kind solo', () => {
    const proj = project();
    sess(proj, 's1', { taskId: 's1', status: 'running', mode: 'headless' });
    expect(resolveWatchTarget('s1', proj)).toMatchObject({ kind: 'solo', id: 's1' });
  });

  test('an unknown id resolves to kind unknown', () => {
    expect(resolveWatchTarget('nope', project())).toMatchObject({ kind: 'unknown' });
  });

  test('a "council-" prefixed id strips the prefix before resolving (both c1 and council-c1 resolve)', () => {
    const proj = project();
    const runDir = path.join(proj, 'council-c1');
    fs.mkdirSync(runDir, { recursive: true });
    const ptrDir = path.join(proj, '.claude', 'amicus_sessions');
    fs.mkdirSync(ptrDir, { recursive: true });
    fs.writeFileSync(path.join(ptrDir, 'council-c1.json'), JSON.stringify({ runId: 'c1', runDir }));
    expect(resolveWatchTarget('council-c1', proj)).toMatchObject({ kind: 'council', id: 'c1', runDir });
  });

  // Task 12 improvement 2: getSessionDir (session-manager.js) THROWS 'Invalid
  // task ID: path traversal detected' for an id containing '..' or path
  // separators. resolveWatchTarget is exported and docblocked "pure over
  // disk" — it must be total for arbitrary input (not just ids that already
  // passed validateTaskId in the wired handleWatch path), so a traversal id
  // must resolve to 'unknown' rather than throwing out of this function.
  test('a path-traversal id resolves to kind unknown instead of throwing', () => {
    expect(() => resolveWatchTarget('../evil', project())).not.toThrow();
    expect(resolveWatchTarget('../evil', project())).toMatchObject({ kind: 'unknown' });
  });
});

// Repo convention (mirrors tests/cli-handlers-status.test.js): CLI output
// handlers write via process.stdout/stderr.write, not console.log/error, so
// capture swaps those out rather than jest.spyOn(console, ...).
function capture(fn) {
  const out = []; const err = [];
  const origOut = process.stdout.write;
  const origErr = process.stderr.write;
  process.stdout.write = (s) => { out.push(s); return true; };
  process.stderr.write = (s) => { err.push(s); return true; };
  const restore = () => { process.stdout.write = origOut; process.stderr.write = origErr; };
  return Promise.resolve(fn())
    .then((code) => { restore(); return { code, out: out.join(''), err: err.join('') }; })
    .catch((e) => { restore(); throw e; });
}

// This proves the command ENTRY works end-to-end (not just the pure
// resolver): handleWatch must return 1 (never throw) on a missing id and on
// --ui --json, and an unknown id under --json must produce a failJson error
// doc carrying code:'BAD_SESSION' — the schema's closed enum has no
// 'NOT_FOUND', so that would be the wrong contract to ship.
describe('handleWatch (command entry)', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-watch-')); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  test('missing id returns 1 (not throw) and prints usage to stderr', async () => {
    const { code, err } = await capture(() => handleWatch({ _: ['watch'], project: tmpDir }));
    expect(code).toBe(1);
    expect(err).toMatch(/id is required/);
  });

  test('--ui --json fails fast, returns 1, with a stderr hint', async () => {
    const { code, err } = await capture(() =>
      handleWatch({ _: ['watch', 'w1'], project: tmpDir, ui: true, json: true }));
    expect(code).toBe(1);
    expect(err).toMatch(/--ui/);
  });

  test('an unknown id under --json returns 1 and emits a failJson doc with code BAD_SESSION (not NOT_FOUND)', async () => {
    const { code, out } = await capture(() =>
      handleWatch({ _: ['watch', 'nope'], project: tmpDir, json: true }));
    expect(code).toBe(1);
    const doc = JSON.parse(out);
    expect(doc.ok).toBe(false);
    expect(doc.error.code).toBe('BAD_SESSION');
    expect(doc.error.code).not.toBe('NOT_FOUND');
  });

  test('an invalid id format returns 1 and does not throw', async () => {
    const { code, err } = await capture(() =>
      handleWatch({ _: ['watch', 'bad id with spaces'], project: tmpDir }));
    expect(code).toBe(1);
    expect(err.length).toBeGreaterThan(0);
  });
});
