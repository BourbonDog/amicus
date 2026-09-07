'use strict';

/**
 * Issue #36 — shared-server finalize must never default a failed run to 'complete'.
 *
 * The shared-server MCP path (.then handler in mcp-server.js) used to call
 * finalizeSession with NO opts, so session-utils.js defaulted an errored/empty
 * run to 'complete' with a 0-byte summary, and amicus_status reported success.
 *
 * These tests cover:
 *  1. finalizeHeadlessResult routes through resolveTerminalState exactly like
 *     the CLI start.js path: error/timed-out/aborted/complete classification +
 *     reason written from result.error.
 *  2. The defense-in-depth guard in finalizeSession: an empty summary or an
 *     explicitly-incomplete run can never silently default to 'complete'.
 *  3. The CLI path (explicit status) is NOT double-classified by the guard.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { finalizeHeadlessResult } = require('../src/sidecar/session-finalize');
const { finalizeSession } = require('../src/sidecar/session-utils');

function tmpSession(meta = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-shf-'));
  const sdir = path.join(dir, 'session');
  fs.mkdirSync(sdir, { recursive: true });
  fs.writeFileSync(
    path.join(sdir, 'metadata.json'),
    JSON.stringify({ taskId: 't', status: 'running', createdAt: new Date().toISOString(), ...meta })
  );
  return sdir;
}

function readMeta(sdir) {
  return JSON.parse(fs.readFileSync(path.join(sdir, 'metadata.json'), 'utf-8'));
}

describe('finalizeHeadlessResult (shared-server path)', () => {
  it('errored run → status error + reason from result.error (not complete)', () => {
    const sdir = tmpSession();
    const meta = readMeta(sdir);
    finalizeHeadlessResult(sdir, { completed: false, error: '402 insufficient credits' }, os.tmpdir(), meta);
    const m = readMeta(sdir);
    expect(m.status).toBe('error');
    expect(m.reason).toBe('402 insufficient credits');
  });

  it('errored run writes an existing (0-byte) summary.md so amicus_read hits the file-exists branch', () => {
    const sdir = tmpSession();
    finalizeHeadlessResult(sdir, { completed: false, error: 'boom' }, os.tmpdir(), readMeta(sdir));
    expect(fs.existsSync(path.join(sdir, 'summary.md'))).toBe(true);
  });

  it('timed-out run (no error) → status timed-out, not complete', () => {
    const sdir = tmpSession();
    finalizeHeadlessResult(sdir, { completed: false, timedOut: true, summary: 'partial' }, os.tmpdir(), readMeta(sdir));
    expect(readMeta(sdir).status).toBe('timed-out');
  });

  it('aborted run → status aborted, not complete', () => {
    const sdir = tmpSession();
    finalizeHeadlessResult(sdir, { completed: false, aborted: true }, os.tmpdir(), readMeta(sdir));
    expect(readMeta(sdir).status).toBe('aborted');
  });

  it('completed run with a real summary → status complete', () => {
    const sdir = tmpSession();
    finalizeHeadlessResult(sdir, { completed: true, summary: 'all done' }, os.tmpdir(), readMeta(sdir));
    expect(readMeta(sdir).status).toBe('complete');
    expect(fs.readFileSync(path.join(sdir, 'summary.md'), 'utf-8')).toBe('all done');
  });

  it('a completed run carrying finish threads it onto metadata (#218 PR 3)', () => {
    const sdir = tmpSession();
    finalizeHeadlessResult(sdir, { completed: true, summary: 'cut', finish: 'length' }, os.tmpdir(), readMeta(sdir));
    const m = readMeta(sdir);
    expect(m.status).toBe('complete');
    expect(m.finish).toBe('length');
  });

  it('an OUTPUT_LENGTH error run carries finish alongside its reason (#218 PR 3)', () => {
    const sdir = tmpSession();
    finalizeHeadlessResult(sdir, { completed: false, error: 'OUTPUT_LENGTH: no answer text', summary: '', finish: 'length' }, os.tmpdir(), readMeta(sdir));
    const m = readMeta(sdir);
    expect(m.status).toBe('error');
    expect(m.reason).toMatch(/^OUTPUT_LENGTH:/);
    expect(m.finish).toBe('length');
  });

  it('an error run with no finish REMOVES a prior one from metadata (council #232 r1 B1)', () => {
    const sdir = tmpSession({ finish: 'length' });
    finalizeHeadlessResult(sdir, { completed: false, error: 'connection reset' }, os.tmpdir(), readMeta(sdir));
    const m = readMeta(sdir);
    expect(m.status).toBe('error');
    // Named mutant "STALEFINISH": drop the `else { delete metadata.finish; }`.
    expect('finish' in m).toBe(false);
  });

  it('a completed run carrying variant threads it onto metadata (#218 PR 4)', () => {
    const sdir = tmpSession();
    finalizeHeadlessResult(sdir, { completed: true, summary: 'cut', variant: 'low', variantUnverified: true }, os.tmpdir(), readMeta(sdir));
    const m = readMeta(sdir);
    expect(m.status).toBe('complete');
    expect(m.variant).toBe('low');
    expect(m.variantUnverified).toBe(true);
  });

  it('a run with no variant REMOVES prior variant keys from metadata', () => {
    const sdir = tmpSession({ variant: 'low', variantUnverified: true });
    finalizeHeadlessResult(sdir, { completed: false, error: 'connection reset' }, os.tmpdir(), readMeta(sdir));
    const m = readMeta(sdir);
    expect(m.status).toBe('error');
    // Named mutant "SHAREDNOVARIANT": drop the stamp/delete line in session-finalize.js.
    expect('variant' in m).toBe(false);
    expect('variantUnverified' in m).toBe(false);
  });
});

describe('finalizeSession defense-in-depth guard (#36)', () => {
  it('empty summary with no explicit status never silently defaults to complete', () => {
    const sdir = tmpSession();
    finalizeSession(sdir, '', os.tmpdir(), readMeta(sdir), { quietStdout: true });
    expect(readMeta(sdir).status).not.toBe('complete');
  });

  it('non-empty summary with no explicit status still defaults to complete (unchanged)', () => {
    const sdir = tmpSession();
    finalizeSession(sdir, 'real summary', os.tmpdir(), readMeta(sdir), { quietStdout: true });
    expect(readMeta(sdir).status).toBe('complete');
  });

  it('CLI path is NOT double-classified: explicit status wins even with empty summary', () => {
    const sdir = tmpSession();
    // start.js passes the resolved terminal status explicitly for non-error states.
    finalizeSession(sdir, '', os.tmpdir(), readMeta(sdir), { quietStdout: true, status: 'timed-out' });
    expect(readMeta(sdir).status).toBe('timed-out');
  });

  it('explicit complete status is honored even with empty summary', () => {
    const sdir = tmpSession();
    finalizeSession(sdir, '', os.tmpdir(), readMeta(sdir), { quietStdout: true, status: 'complete' });
    expect(readMeta(sdir).status).toBe('complete');
  });
});
