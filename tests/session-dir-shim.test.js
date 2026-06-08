const fs = require('fs');
const os = require('os');
const path = require('path');
const sm = require('../src/session-manager');

describe('session dir shim', () => {
  let proj;
  beforeEach(() => { proj = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-sess-')); });
  afterEach(() => { fs.rmSync(proj, { recursive: true, force: true }); });

  it('getSessionDir returns the amicus_sessions path for writes', () => {
    expect(sm.getSessionDir(proj, 'abc')).toBe(
      path.join(proj, '.claude', 'amicus_sessions', 'abc')
    );
  });

  it('resolveExistingSessionDir prefers amicus_sessions', () => {
    const dir = path.join(proj, '.claude', 'amicus_sessions', 'abc');
    fs.mkdirSync(dir, { recursive: true });
    expect(sm.resolveExistingSessionDir(proj, 'abc')).toBe(dir);
  });

  it('resolveExistingSessionDir falls back to legacy sidecar_sessions', () => {
    const legacy = path.join(proj, '.claude', 'sidecar_sessions', 'abc');
    fs.mkdirSync(legacy, { recursive: true });
    expect(sm.resolveExistingSessionDir(proj, 'abc')).toBe(legacy);
  });
});
