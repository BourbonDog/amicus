// tests/ensure-electron.test.js
'use strict';

/**
 * Unit tests for ensureElectron() — lazy first-GUI provisioning (#55).
 *
 * ensureElectron() is the ONLY caller allowed to PROVISION (download/extract)
 * electron, and only on FIRST GUI use. It must:
 *   - return the resolved exe path when electron is already usable (NO repair).
 *   - call repairElectron() (network allowed) when electron is NOT usable.
 *   - single-flight: a once-guard prevents re-provision across repeated launches.
 *   - leave getElectronPath()/checkElectronAvailable() PURE PROBES (no provision).
 *
 * EVERYTHING that downloads/extracts/touches the network is MOCKED / injected;
 * no test fetches or extracts a real electron binary.
 */

const ei = require('../src/sidecar/electron-install');
const ee = require('../src/sidecar/electron-ensure');

beforeEach(() => {
  // ensureElectron memoizes across launches via a once-guard; reset between
  // tests so each case starts from a clean single-flight slate.
  ee._resetEnsureElectron();
});

describe('ensureElectron API (#55)', () => {
  test('is exported as a function', () => {
    expect(typeof ee.ensureElectron).toBe('function');
  });

  test('exposes a test-only reset for the once-guard', () => {
    expect(typeof ee._resetEnsureElectron).toBe('function');
  });
});

describe('ensureElectron — already usable (#55)', () => {
  test('returns the resolved path and does NOT call repair when usable', async () => {
    const repairElectron = jest.fn();
    const result = await ee.ensureElectron({
      deps: {
        isElectronUsable: () => true,
        resolveElectronBinary: () => '/fake/dist/electron.exe',
        repairElectron,
        logProgress: () => {},
      },
    });
    expect(repairElectron).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, path: '/fake/dist/electron.exe' });
  });
});

describe('ensureElectron — provisioning when not usable (#55)', () => {
  test('calls repairElectron (network allowed) when not usable, then returns the path', async () => {
    let usable = false;
    const repairElectron = jest.fn(async () => {
      usable = true; // simulate a successful provision
      return { repaired: true };
    });
    const result = await ee.ensureElectron({
      deps: {
        isElectronUsable: () => usable,
        resolveElectronBinary: () => '/fake/dist/electron.exe',
        repairElectron,
        logProgress: () => {},
      },
    });
    expect(repairElectron).toHaveBeenCalledTimes(1);
    // repair must be invoked with network ALLOWED (NOT cacheOnly).
    expect(repairElectron.mock.calls[0][0]).toMatchObject({ cacheOnly: false });
    expect(result).toEqual({ ok: true, path: '/fake/dist/electron.exe' });
  });

  test('emits progress messaging while provisioning', async () => {
    const logProgress = jest.fn();
    let usable = false;
    await ee.ensureElectron({
      deps: {
        isElectronUsable: () => usable,
        resolveElectronBinary: () => '/fake/dist/electron.exe',
        repairElectron: async () => { usable = true; return { repaired: true }; },
        logProgress,
      },
    });
    expect(logProgress).toHaveBeenCalled();
  });

  test('returns ok:false with a reason when provisioning fails to produce a usable binary', async () => {
    const repairElectron = jest.fn(async () => ({ deferred: true, reason: 'no cache and offline' }));
    const result = await ee.ensureElectron({
      deps: {
        isElectronUsable: () => false, // still not usable after repair
        resolveElectronBinary: () => '/fake/dist/electron.exe',
        repairElectron,
        logProgress: () => {},
      },
    });
    expect(repairElectron).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
    expect(typeof result.reason).toBe('string');
    expect(result.reason.length).toBeGreaterThan(0);
  });
});

describe('ensureElectron — once-guard / single-flight (#55)', () => {
  test('does NOT re-provision on a second call after a successful provision', async () => {
    let usable = false;
    const repairElectron = jest.fn(async () => { usable = true; return { repaired: true }; });
    const deps = {
      isElectronUsable: () => usable,
      resolveElectronBinary: () => '/fake/dist/electron.exe',
      repairElectron,
      logProgress: () => {},
    };
    const first = await ee.ensureElectron({ deps });
    const second = await ee.ensureElectron({ deps });
    expect(first).toEqual({ ok: true, path: '/fake/dist/electron.exe' });
    expect(second).toEqual({ ok: true, path: '/fake/dist/electron.exe' });
    // Provisioned exactly once despite two launches.
    expect(repairElectron).toHaveBeenCalledTimes(1);
  });

  test('concurrent calls share a single in-flight provision (no double download)', async () => {
    let usable = false;
    let resolveRepair;
    const repairElectron = jest.fn(() => new Promise((res) => {
      resolveRepair = () => { usable = true; res({ repaired: true }); };
    }));
    const deps = {
      isElectronUsable: () => usable,
      resolveElectronBinary: () => '/fake/dist/electron.exe',
      repairElectron,
      logProgress: () => {},
    };
    const p1 = ee.ensureElectron({ deps });
    const p2 = ee.ensureElectron({ deps });
    resolveRepair();
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toEqual({ ok: true, path: '/fake/dist/electron.exe' });
    expect(r2).toEqual({ ok: true, path: '/fake/dist/electron.exe' });
    expect(repairElectron).toHaveBeenCalledTimes(1);
  });

  test('a FAILED provision does NOT poison the guard — a later call may retry', async () => {
    let usable = false;
    const repairElectron = jest.fn()
      .mockImplementationOnce(async () => ({ deferred: true, reason: 'no cache' }))
      .mockImplementationOnce(async () => { usable = true; return { repaired: true }; });
    const deps = {
      isElectronUsable: () => usable,
      resolveElectronBinary: () => '/fake/dist/electron.exe',
      repairElectron,
      logProgress: () => {},
    };
    const first = await ee.ensureElectron({ deps });
    expect(first.ok).toBe(false);
    const second = await ee.ensureElectron({ deps });
    expect(second).toEqual({ ok: true, path: '/fake/dist/electron.exe' });
    expect(repairElectron).toHaveBeenCalledTimes(2);
  });
});

describe('getElectronPath / checkElectronAvailable remain PURE PROBES (#55)', () => {
  test('the probes never trigger provisioning side-effects', () => {
    // Spy on repairElectron at the module boundary: a pure probe must never
    // reach it. interactive-process.js owns the probes; they call require('electron').
    const interactiveProcess = require('../src/sidecar/interactive-process');
    const repairSpy = jest.spyOn(ei, 'repairElectron');
    // Calling the probes must not throw and must not provision.
    const path1 = interactiveProcess.getElectronPath();
    const avail = interactiveProcess.checkElectronAvailable();
    expect(typeof avail).toBe('boolean');
    // Probe returns a string path or null — never a provisioning result.
    expect(path1 === null || typeof path1 === 'string').toBe(true);
    expect(repairSpy).not.toHaveBeenCalled();
    repairSpy.mockRestore();
  });
});
