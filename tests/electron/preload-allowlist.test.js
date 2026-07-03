/** F5: the preload allowlist must expose the catalog IPC channels the wizard invokes (T7 review). */
const fs = require('fs');
const path = require('path');

describe('preload-setup allowlist', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'electron', 'preload-setup.js'), 'utf-8');

  it('allows the catalog channels the Step 2 picker invokes', () => {
    expect(src).toContain("'sidecar:get-catalog'");
    expect(src).toContain("'sidecar:refresh-catalog'");
  });

  // B33 / #12: Step 3 now shares Step 2's cached catalog load instead of a
  // separate live fetch; the retired channel should not linger in the allowlist.
  it('no longer allows the retired sidecar:fetch-models channel', () => {
    expect(src).not.toContain("'sidecar:fetch-models'");
  });

  it('every sidecar: channel the wizard script invokes is allowlisted', () => {
    const { buildSetupHTML } = require('../../electron/setup-ui');
    const script = buildSetupHTML().match(/<script>([\s\S]*)<\/script>/)[1];
    const invoked = [...new Set([...script.matchAll(/invoke\('([^']+)'/g)].map(m => m[1]))];
    expect(invoked.length).toBeGreaterThan(0);
    for (const channel of invoked) {
      expect(src).toContain(`'${channel}'`);
    }
    const totalInvokes = (script.match(/\.invoke\(/g) || []).length;
    const literalInvokes = [...script.matchAll(/invoke\('([^']+)'/g)].length;
    expect(totalInvokes).toBe(literalInvokes); // a non-literal invoke(channelVar) must fail loudly
  });
});
