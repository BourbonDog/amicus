const api = require('../src/index');

describe('src/index.js internal entry point', () => {
  it('exposes exactly the canonical *Amicus names the CLI uses', () => {
    expect(Object.keys(api).sort()).toEqual(
      ['continueAmicus', 'listAmicus', 'readAmicus', 'resumeAmicus', 'startAmicus']
    );
    for (const fn of Object.values(api)) { expect(typeof fn).toBe('function'); }
  });
  it('does NOT export legacy *Sidecar public API aliases (#19 absence pin)', () => {
    expect(api.startSidecar).toBeUndefined();
    expect(api.listSidecars).toBeUndefined();
    expect(api.resumeSidecar).toBeUndefined();
    expect(api.continueSidecar).toBeUndefined();
    expect(api.readSidecar).toBeUndefined();
  });
});
