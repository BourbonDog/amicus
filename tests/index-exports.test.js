const api = require('../src/index');

describe('public API amicus aliases', () => {
  it('exposes canonical *Amicus names', () => {
    expect(typeof api.startAmicus).toBe('function');
    expect(typeof api.listAmicus).toBe('function');
    expect(typeof api.resumeAmicus).toBe('function');
    expect(typeof api.continueAmicus).toBe('function');
    expect(typeof api.readAmicus).toBe('function');
  });
  it('keeps legacy *Sidecar aliases pointing to the same fns (shim)', () => {
    expect(api.startAmicus).toBe(api.startSidecar);
    expect(api.listAmicus).toBe(api.listSidecars);
  });
});
