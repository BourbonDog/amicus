const fs = require('fs');
const os = require('os');
const path = require('path');
const sm = require('../src/session-manager');

describe('session dir (legacy sidecar_sessions dual-read removed, #19)', () => {
  let proj;
  beforeEach(() => { proj = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-sess-')); });
  afterEach(() => { fs.rmSync(proj, { recursive: true, force: true }); });

  it('getSessionDir returns the amicus_sessions path for writes', () => {
    expect(sm.getSessionDir(proj, 'abc')).toBe(
      path.join(proj, '.claude', 'amicus_sessions', 'abc')
    );
  });

  it('resolveExistingSessionDir resolves to amicus_sessions', () => {
    const dir = path.join(proj, '.claude', 'amicus_sessions', 'abc');
    fs.mkdirSync(dir, { recursive: true });
    expect(sm.resolveExistingSessionDir(proj, 'abc')).toBe(dir);
  });

  it('resolveExistingSessionDir does NOT consult legacy sidecar_sessions (#19 absence pin)', () => {
    const legacy = path.join(proj, '.claude', 'sidecar_sessions', 'abc');
    fs.mkdirSync(legacy, { recursive: true });
    // The legacy dir exists on disk but is never read; resolution still
    // points at the (non-existent) canonical amicus_sessions path.
    expect(sm.resolveExistingSessionDir(proj, 'abc')).not.toBe(legacy);
    expect(sm.resolveExistingSessionDir(proj, 'abc')).toBe(
      path.join(proj, '.claude', 'amicus_sessions', 'abc')
    );
  });

  it('LEGACY_SESSIONS_DIR is no longer exported (#19 absence pin)', () => {
    expect(sm.LEGACY_SESSIONS_DIR).toBeUndefined();
  });
});
