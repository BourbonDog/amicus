// tests/postinstall-prefetch-electron.test.js
'use strict';

/**
 * #60: opt-in AMICUS_PREFETCH_ELECTRON=1 aggressively PREWARMS electron during
 * postinstall via repairElectron({force:true}) — a full fetch if no cache.
 *
 * Behaviour contract:
 *  - DEFAULT (env unset): only the cache-only path runs (#57) — repairElectron
 *    is called with {cacheOnly:true}, NEVER with {force:true}.
 *  - AMICUS_PREFETCH_ELECTRON=1: the force path runs — repairElectron is called
 *    with {force:true}. (Cache-only never hits the network; force may.)
 *  - Non-fatal: a throwing/rejecting repairElectron on the force path must STILL
 *    exit 0 (the #29 always-exit-0 guard is preserved). provisionElectron must
 *    never throw out of postinstall.
 *
 * repairElectron is dependency-injected so NOTHING touches the network or
 * extracts a real binary (electron download/extract are MOCKED).
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

describe('postinstall opt-in AMICUS_PREFETCH_ELECTRON prewarm (#60)', () => {
  const ORIG = process.env.AMICUS_PREFETCH_ELECTRON;
  afterEach(() => {
    if (ORIG === undefined) { delete process.env.AMICUS_PREFETCH_ELECTRON; }
    else { process.env.AMICUS_PREFETCH_ELECTRON = ORIG; }
  });

  test('default (env unset): only the cache-only path runs — never force', async () => {
    delete process.env.AMICUS_PREFETCH_ELECTRON;
    const repairElectron = jest.fn().mockResolvedValue({ repaired: true });
    await postinstall.provisionElectron({ repairElectron });

    expect(repairElectron).toHaveBeenCalledTimes(1);
    const opts = repairElectron.mock.calls[0][0] || {};
    expect(opts.cacheOnly).toBe(true);
    expect(opts.force).not.toBe(true);
  });

  test('AMICUS_PREFETCH_ELECTRON=1: drives the force prewarm path', async () => {
    process.env.AMICUS_PREFETCH_ELECTRON = '1';
    const repairElectron = jest.fn().mockResolvedValue({ repaired: true });
    await postinstall.provisionElectron({ repairElectron });

    // At least one call must request the aggressive force fetch.
    const forcedCalls = repairElectron.mock.calls.filter(([o]) => o && o.force === true);
    expect(forcedCalls.length).toBeGreaterThanOrEqual(1);
  });

  test('prewarm (force:true) does NOT print prewarmed/success when repair fails', async () => {
    process.env.AMICUS_PREFETCH_ELECTRON = '1';
    // Installer ran but produced no usable exe → honest repaired:false.
    const repairElectron = jest.fn().mockResolvedValue({ repaired: false });
    const logs = [];
    const warnings = [];
    const logSpy = jest.spyOn(console, 'log').mockImplementation((...a) => logs.push(a.join(' ')));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation((...a) => warnings.push(a.join(' ')));
    try {
      await postinstall.provisionElectron({ repairElectron });
    } finally {
      logSpy.mockRestore();
      warnSpy.mockRestore();
    }
    // No false success: must NOT claim the GUI binary was prewarmed.
    expect(logs.join('\n')).not.toMatch(/prewarmed/i);
    // Must surface the "provisions on first use" deferral notice instead.
    expect(warnings.join('\n')).toMatch(/first use/i);
  });

  test('AMICUS_PREFETCH_ELECTRON other than 1 does NOT force', async () => {
    process.env.AMICUS_PREFETCH_ELECTRON = '0';
    const repairElectron = jest.fn().mockResolvedValue({ repaired: true });
    await postinstall.provisionElectron({ repairElectron });

    const forcedCalls = repairElectron.mock.calls.filter(([o]) => o && o.force === true);
    expect(forcedCalls.length).toBe(0);
  });

  test('prefetch force path is non-fatal: a rejecting repairElectron still exits 0', async () => {
    process.env.AMICUS_PREFETCH_ELECTRON = '1';
    const repairElectron = jest.fn().mockRejectedValue(new Error('prefetch boom'));
    const { exits } = await runWithSpies({ repairElectron });
    expect(exits).toEqual([0]);
  });

  test('prefetch force path is non-fatal: a synchronously-throwing repairElectron never throws out', async () => {
    process.env.AMICUS_PREFETCH_ELECTRON = '1';
    const repairElectron = () => { throw new Error('sync prefetch boom'); };
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(postinstall.provisionElectron({ repairElectron })).resolves.not.toThrow();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
