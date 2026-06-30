// tests/postinstall-provision-electron.test.js
'use strict';

/**
 * #57: postinstall provisions the OPTIONAL electron binary from the LOCAL cache
 * (NO network during install) by calling repairElectron({cacheOnly:true}). This
 * supersedes #30's warn-only verifyElectron.
 *
 * Behaviour contract:
 *  - a cached zip heals the install (repairElectron -> {repaired}) -> NO warning.
 *  - no cache (repairElectron -> {deferred}) -> a clear deferred notice that the
 *    GUI provisions on first use, headless + council still work, exit stays 0.
 *  - a THROWING repairElectron must STILL exit 0 (the #29 always-exit-0 guard is
 *    preserved): provisionElectron must never throw out of postinstall.
 *  - the reinstall (loop-inducing) hint is replaced by a pointer at
 *    `amicus doctor --fix` (#56).
 *
 * repairElectron is dependency-injected so NOTHING touches the network or
 * extracts a real binary.
 */

const postinstall = require('../scripts/postinstall');

const NOOP_DEPS = {
  installSkill: () => {},
  installCouncilSkill: () => {},
  registerClaudeCode: () => {},
  registerClaudeDesktop: () => {},
  setupHooks: () => {},
};

async function runWithSpies(deps) {
  const warnings = [];
  const logs = [];
  const exits = [];
  const warnSpy = jest.spyOn(console, 'warn').mockImplementation((...a) => warnings.push(a.join(' ')));
  const logSpy = jest.spyOn(console, 'log').mockImplementation((...a) => logs.push(a.join(' ')));
  const exitSpy = jest.spyOn(process, 'exit').mockImplementation((code) => { exits.push(code); });
  try {
    await postinstall.runCli({ ...NOOP_DEPS, ...deps });
  } finally {
    warnSpy.mockRestore();
    logSpy.mockRestore();
    exitSpy.mockRestore();
  }
  return { warnings: warnings.join('\n'), logs: logs.join('\n'), exits };
}

describe('postinstall provisions electron cache-only (#57)', () => {
  test('provisionElectron is exported', () => {
    expect(typeof postinstall.provisionElectron).toBe('function');
  });

  test('heals from a cached zip — no warning, exit 0', async () => {
    const repairElectron = jest.fn().mockResolvedValue({ repaired: true });
    const { warnings, exits } = await runWithSpies({ repairElectron });

    expect(exits).toEqual([0]);
    expect(warnings).not.toMatch(/electron/i);
  });

  test('calls repairElectron in cache-only mode with a short timeout', async () => {
    const repairElectron = jest.fn().mockResolvedValue({ repaired: true });
    await postinstall.provisionElectron({ repairElectron });

    expect(repairElectron).toHaveBeenCalledTimes(1);
    const opts = repairElectron.mock.calls[0][0] || {};
    expect(opts.cacheOnly).toBe(true);
    expect(typeof opts.timeoutMs).toBe('number');
    expect(opts.timeoutMs).toBeGreaterThan(0);
  });

  test('emits a deferred notice + exits 0 when there is no cache', async () => {
    const repairElectron = jest.fn().mockResolvedValue({
      deferred: true,
      reason: 'No cached electron zip found for v28.0.0 (win32-x64); deferring download.',
    });
    const { warnings, exits } = await runWithSpies({ repairElectron });

    expect(exits).toEqual([0]);
    expect(warnings).toMatch(/electron/i);
    // Reassure the user that headless + council still work.
    expect(warnings).toMatch(/headless/i);
    // GUI provisions on first use.
    expect(warnings).toMatch(/first use|first run|on demand|when you/i);
    // Points at doctor --fix (#56), NOT a reinstall loop.
    expect(warnings).toMatch(/doctor --fix/i);
    expect(warnings).not.toMatch(/npm install -g amicus/i);
  });

  test('a throwing repairElectron still exits 0 (non-fatal, #29 guard preserved)', async () => {
    const repairElectron = jest.fn().mockRejectedValue(new Error('boom'));
    const { exits } = await runWithSpies({ repairElectron });
    expect(exits).toEqual([0]);
  });

  test('provisionElectron never throws even when repairElectron throws synchronously', async () => {
    const repairElectron = () => { throw new Error('sync boom'); };
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(postinstall.provisionElectron({ repairElectron })).resolves.not.toThrow();
    } finally {
      warnSpy.mockRestore();
    }
  });

  test('provisionElectron never throws even when repairElectron rejects', async () => {
    const repairElectron = jest.fn().mockRejectedValue(new Error('async boom'));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(postinstall.provisionElectron({ repairElectron })).resolves.toBeUndefined();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
