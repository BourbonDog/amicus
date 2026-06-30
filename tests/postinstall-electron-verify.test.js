// tests/postinstall-electron-verify.test.js
'use strict';

/**
 * Regression test for #30: postinstall must verify the OPTIONAL electron
 * dependency binary actually extracted. When electron's download/extract fails
 * (or AV quarantines electron.exe), npm still exits 0 and the user only finds
 * out the GUI is broken later. The post-install must emit a NON-FATAL warning
 * (exit code stays 0) pointing at headless/council still working + `amicus
 * doctor` / reinstall. When electron resolves, NO warning must be emitted.
 *
 * The electron resolver is injected via the deps param so nothing touches the
 * network or the real electron binary.
 */

const postinstall = require('../scripts/postinstall');

const NOOP_DEPS = {
  installSkill: () => {},
  installCouncilSkill: () => {},
  registerClaudeCode: () => {},
  registerClaudeDesktop: () => {},
};

function runWithSpies(deps) {
  const warnings = [];
  const exits = [];
  const warnSpy = jest.spyOn(console, 'warn').mockImplementation((...a) => warnings.push(a.join(' ')));
  const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  const exitSpy = jest.spyOn(process, 'exit').mockImplementation((code) => { exits.push(code); });
  try {
    postinstall.runCli({ ...NOOP_DEPS, ...deps });
  } finally {
    warnSpy.mockRestore();
    logSpy.mockRestore();
    exitSpy.mockRestore();
  }
  return { warnings: warnings.join('\n'), exits };
}

describe('postinstall verifies the electron binary extracted (#30)', () => {
  test('verifyElectron is exported', () => {
    expect(typeof postinstall.verifyElectron).toBe('function');
  });

  test('warns non-fatally and still exits 0 when electron does not resolve', () => {
    const { warnings, exits } = runWithSpies({
      resolveElectron: () => null, // simulate a failed extract / quarantined binary
    });

    expect(exits).toEqual([0]);
    expect(warnings).toMatch(/electron/i);
    // Must reassure the user that headless + council still work.
    expect(warnings).toMatch(/headless/i);
    // Must point at the recovery path (doctor / reinstall).
    expect(warnings).toMatch(/doctor|reinstall|install -g amicus/i);
  });

  test('warns when electron resolves to a path that does not exist (quarantined binary)', () => {
    const { warnings, exits } = runWithSpies({
      resolveElectron: () => '/nope/does/not/exist/electron',
    });

    expect(exits).toEqual([0]);
    expect(warnings).toMatch(/electron/i);
  });

  test('emits NO warning when electron resolves to an existing binary', () => {
    // Use a path that actually exists so the fs.existsSync extract-check passes.
    const { warnings, exits } = runWithSpies({
      resolveElectron: () => __filename,
    });

    expect(exits).toEqual([0]);
    expect(warnings).not.toMatch(/electron/i);
  });

  test('verifyElectron never throws even if the resolver throws', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(() => postinstall.verifyElectron({
        resolveElectron: () => { throw new Error('boom'); },
      })).not.toThrow();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
