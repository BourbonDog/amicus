// tests/postinstall-nonfatal.test.js
'use strict';

/**
 * Regression test for #29: the top-level postinstall invocation must be
 * non-fatal. A throw anywhere under main() (e.g. a MODULE_NOT_FOUND from an
 * internal helper) must NOT exit non-zero, because npm treats a failing
 * postinstall as a reason to roll back / uninstall the ENTIRE global package.
 * Skill-copy + MCP registration are optional; amicus itself still works.
 */

const postinstall = require('../scripts/postinstall');

describe('postinstall top-level invocation is non-fatal (#29)', () => {
  test('runCli is exported', () => {
    expect(typeof postinstall.runCli).toBe('function');
  });

  test('runCli exits 0 and warns when main() throws', () => {
    const warnings = [];
    const exits = [];
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation((...a) => warnings.push(a.join(' ')));
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((code) => { exits.push(code); });

    try {
      // Inject a throwing dependency via the existing deps param on main().
      postinstall.runCli({
        installSkill: () => { throw new Error('boom: MODULE_NOT_FOUND'); },
      });
    } finally {
      warnSpy.mockRestore();
      exitSpy.mockRestore();
    }

    // Must exit 0 so npm never rolls back the global install.
    expect(exits).toEqual([0]);
    // Must warn clearly that the optional setup failed and amicus still works.
    const text = warnings.join('\n');
    expect(text).toMatch(/amicus/i);
    expect(text).toMatch(/doctor/i);
  });

  test('runCli exits 0 (no warning, no rollback) on the happy path', () => {
    const exits = [];
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((code) => { exits.push(code); });
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const calls = [];

    try {
      postinstall.runCli({
        installSkill: () => calls.push('skill'),
        installCouncilSkill: () => calls.push('council'),
        registerClaudeCode: () => calls.push('code'),
        registerClaudeDesktop: () => calls.push('desktop'),
      });
    } finally {
      exitSpy.mockRestore();
      warnSpy.mockRestore();
    }

    expect(calls).toEqual(['skill', 'council', 'code', 'desktop']);
    // On success we must not have warned about a failure.
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
