const api = require('../src/index');

describe('public API amicus aliases', () => {
  it('exposes canonical *Amicus names', () => {
    expect(typeof api.startAmicus).toBe('function');
    expect(typeof api.listAmicus).toBe('function');
    expect(typeof api.resumeAmicus).toBe('function');
    expect(typeof api.continueAmicus).toBe('function');
    expect(typeof api.readAmicus).toBe('function');
  });
  it('does NOT export legacy *Sidecar public API aliases (#19 absence pin)', () => {
    expect(api.startSidecar).toBeUndefined();
    expect(api.listSidecars).toBeUndefined();
    expect(api.resumeSidecar).toBeUndefined();
    expect(api.continueSidecar).toBeUndefined();
    expect(api.readSidecar).toBeUndefined();
  });
});

describe('F4 exports', () => {
  it('exposes runFanout on the public API', () => {
    const api = require('../src/index');
    expect(typeof api.runFanout).toBe('function');
  });
});
