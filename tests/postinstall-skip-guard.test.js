// tests/postinstall-skip-guard.test.js
'use strict';
const postinstall = require('../scripts/postinstall');

describe('postinstall honors AMICUS_SKIP_POSTINSTALL', () => {
  test('main() is exported', () => {
    expect(typeof postinstall.main).toBe('function');
  });

  test('main() no-ops (installs nothing) when AMICUS_SKIP_POSTINSTALL=1', async () => {
    const calls = [];
    const prev = process.env.AMICUS_SKIP_POSTINSTALL;
    process.env.AMICUS_SKIP_POSTINSTALL = '1';
    try {
      // deps injection: main() must accept overridable side-effect fns
      await postinstall.main({
        installSkill: () => calls.push('skill'),
        installCouncilSkill: () => calls.push('council'),
        registerClaudeCode: () => calls.push('code'),
        registerClaudeDesktop: () => calls.push('desktop'),
        provisionElectron: () => calls.push('electron'),
      });
      expect(calls).toEqual([]);
    } finally {
      if (prev === undefined) { delete process.env.AMICUS_SKIP_POSTINSTALL; }
      else { process.env.AMICUS_SKIP_POSTINSTALL = prev; }
    }
  });

  test('main() runs all side effects when the env is unset', async () => {
    const calls = [];
    const prev = process.env.AMICUS_SKIP_POSTINSTALL;
    delete process.env.AMICUS_SKIP_POSTINSTALL;
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await postinstall.main({
        installSkill: () => calls.push('skill'),
        installCouncilSkill: () => calls.push('council'),
        registerClaudeCode: () => calls.push('code'),
        registerClaudeDesktop: () => calls.push('desktop'),
        provisionElectron: () => calls.push('electron'),
      });
      expect(calls).toEqual(['skill', 'council', 'code', 'desktop', 'electron']);
    } finally {
      logSpy.mockRestore();
      if (prev !== undefined) { process.env.AMICUS_SKIP_POSTINSTALL = prev; }
    }
  });
});
