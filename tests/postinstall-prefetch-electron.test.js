// tests/postinstall-prefetch-electron.test.js
'use strict';

/**
 * #60: opt-in AMICUS_PREFETCH_ELECTRON=1 aggressively PREWARMS electron during
 * postinstall via a NON-cacheOnly repairElectron() — a full fetch if no cache.
 *
 * Behaviour contract:
 *  - DEFAULT (env unset): only the cache-only path runs (#57) — repairElectron
 *    is called with {cacheOnly:true}, so it never touches the network.
 *  - AMICUS_PREFETCH_ELECTRON=1: the prewarm runs — repairElectron is called
 *    WITHOUT cacheOnly. (Cache-only never hits the network; the prewarm may.)
 *  - Non-fatal: a throwing/rejecting repairElectron on the prewarm path must STILL
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

  test('default (env unset): only the cache-only path runs — never the network', async () => {
    delete process.env.AMICUS_PREFETCH_ELECTRON;
    const repairElectron = jest.fn().mockResolvedValue({ repaired: true });
    await postinstall.provisionElectron({ repairElectron });

    expect(repairElectron).toHaveBeenCalledTimes(1);
    const opts = repairElectron.mock.calls[0][0] || {};
    expect(opts.cacheOnly).toBe(true);
  });

  test('AMICUS_PREFETCH_ELECTRON=1: drives the prewarm path, which MAY download', async () => {
    // `cacheOnly` is the whole distinction now. The prewarm used to pass
    // `{force:true}` as well, and that flag never did anything: it only reached
    // the deleted install.js spawn, and @electron/get's own `force` is dead in
    // 5.0.0 (`effectiveCacheMode` never reads it, MEASURED). It is gone rather
    // than accepted-and-ignored.
    process.env.AMICUS_PREFETCH_ELECTRON = '1';
    const repairElectron = jest.fn().mockResolvedValue({ repaired: true });
    await postinstall.provisionElectron({ repairElectron });

    const prewarm = repairElectron.mock.calls.filter(([o]) => !o || o.cacheOnly !== true);
    expect(prewarm.length).toBeGreaterThanOrEqual(1);
    expect(repairElectron.mock.calls.every(([o]) => !o || o.force === undefined)).toBe(true);
  });

  test('the prewarm does NOT print prewarmed/success when repair fails', async () => {
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

  test('AMICUS_PREFETCH_ELECTRON other than 1 stays cache-only', async () => {
    process.env.AMICUS_PREFETCH_ELECTRON = '0';
    const repairElectron = jest.fn().mockResolvedValue({ repaired: true });
    await postinstall.provisionElectron({ repairElectron });

    const prewarm = repairElectron.mock.calls.filter(([o]) => !o || o.cacheOnly !== true);
    expect(prewarm.length).toBe(0);
  });

  test('prefetch prewarm path is non-fatal: a rejecting repairElectron still exits 0', async () => {
    process.env.AMICUS_PREFETCH_ELECTRON = '1';
    const repairElectron = jest.fn().mockRejectedValue(new Error('prefetch boom'));
    const { exits } = await runWithSpies({ repairElectron });
    expect(exits).toEqual([0]);
  });

  test('prefetch prewarm path is non-fatal: a synchronously-throwing repairElectron never throws out', async () => {
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
