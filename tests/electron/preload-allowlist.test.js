/** F5: the preload allowlist must expose the catalog IPC channels the wizard invokes (T7 review). */
const fs = require('fs');
const path = require('path');

describe('preload-setup allowlist', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'electron', 'preload-setup.js'), 'utf-8');

  it('allows the catalog channels the Step 2 picker invokes', () => {
    expect(src).toContain("'sidecar:get-catalog'");
    expect(src).toContain("'sidecar:refresh-catalog'");
  });

  it('every sidecar: channel the wizard script invokes is allowlisted', () => {
    const { buildSetupHTML } = require('../../electron/setup-ui');
    const script = buildSetupHTML().match(/<script>([\s\S]*)<\/script>/)[1];
    const invoked = [...new Set([...script.matchAll(/invoke\('([^']+)'/g)].map(m => m[1]))];
    expect(invoked.length).toBeGreaterThan(0);
    for (const channel of invoked) {
      expect(src).toContain(`'${channel}'`);
    }
  });
});
