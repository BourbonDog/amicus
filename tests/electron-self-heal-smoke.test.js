// tests/electron-self-heal-smoke.test.js
'use strict';

/**
 * #58 — self-heal SMOKE + cross-cutting coverage (the "can't silently regress"
 * guarantee for the electron self-heal cluster shipped by #53/#54/#55/#56/#57/#60).
 *
 * The piecewise unit suites (electron-install / ensure-electron / doctor-fix /
 * postinstall-provision-electron / postinstall-prefetch-electron) each INJECT
 * repairElectron and isElectronUsable. That leaves the cluster's REAL wiring —
 * the consumers (ensureElectron, doctor --fix, postinstall) driving the ACTUAL
 * repairElectron + the ACTUAL stat-the-exe isElectronUsable over a real on-disk
 * fake-electron package — unexercised end-to-end.
 *
 * This suite locks that integration. We build a REAL temp electron package dir
 * and inject ONLY the leaf operations that must never run for real:
 *   - extract  (no real zip extraction)
 *   - spawn    (no real installer / child process)
 *   - cachedZip / acquireLock (deterministic, no FS races)
 * Everything else — resolveElectronBinary, isElectronUsable (real fs.existsSync),
 * repairElectron's control flow, ensureElectron's once-guard, the doctor mapping,
 * and provisionElectron's exit-0 guard — runs FOR REAL.
 *
 * HEADLINE: the LATENT-BUG guard — path.txt present but the dist exe MISSING must
 * read as NOT usable (the Windows AV-quarantine / interrupted-extract failure that
 * silently broke the GUI). It is asserted directly AND propagated through every
 * consumer (doctor probe, ensureElectron fast-path, repairElectron's post-extract
 * re-check) so a regression in ANY of them trips here.
 *
 * NO network. NO real electron download/extract. NO npm install.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ei = require('../src/sidecar/electron-install');
const ee = require('../src/sidecar/electron-ensure');

const WIN_EXE = 'electron.exe';

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * A REAL on-disk fake electron package. `withExe:false` reproduces the latent
 * bug: path.txt survives but dist/<exe> is missing.
 */
function fakeElectronDir({ withExe } = {}) {
  const dir = mkTmp('amicus-selfheal-');
  fs.writeFileSync(path.join(dir, 'path.txt'), WIN_EXE);
  fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
  if (withExe) { fs.writeFileSync(path.join(dir, 'dist', WIN_EXE), 'MZreal'); }
  return dir;
}

/** A no-op single-flight lock so the smoke flows don't touch os.tmpdir lockfiles. */
function noopLock() {
  return { acquireLock: () => ({ release: () => {} }) };
}

// Hermeticity guard (same class as the v4.6.2-pr1 wave; see allGood's M14
// comment in tests/cli-handlers-doctor.test.js): the doctor smokes below
// inject every ELECTRON seam, but runDoctorChecks computes the FULL check
// list, so the remaining deps used to fall through to realDeps() and run for
// real -- engine-install subprocess scans and the OpenRouter credit network
// probe included, violating this suite's own "NO network" headline. baseDeps
// mirrors allGood's shape and pins the non-electron checks; every electron
// seam in the calls below stays exactly as injected, so the REAL-wiring smoke
// coverage is untouched.
const { makeBaseDeps } = require('./helpers/doctor-base-deps');
const baseDeps = makeBaseDeps();

beforeEach(() => {
  // ensureElectron memoizes its provision across launches; reset between tests.
  ee._resetEnsureElectron();
});

// ---------------------------------------------------------------------------
// HEADLINE: the latent-bug guard (path.txt-without-exe -> not usable)
// ---------------------------------------------------------------------------
describe('#58 latent-bug guard: path.txt present but exe MISSING is NOT usable', () => {
  test('isElectronUsable is FALSE on the real package when only path.txt survives', () => {
    const dir = fakeElectronDir({ withExe: false });
    expect(fs.existsSync(path.join(dir, 'path.txt'))).toBe(true); // path.txt DID survive
    expect(ei.isElectronUsable({ electronDir: dir, env: {}, platform: 'win32' })).toBe(false);
  });

  test('isElectronUsable flips to TRUE the instant the real exe lands on disk', () => {
    const dir = fakeElectronDir({ withExe: false });
    expect(ei.isElectronUsable({ electronDir: dir, env: {}, platform: 'win32' })).toBe(false);
    // Simulate a successful extract materializing the binary.
    fs.writeFileSync(path.join(dir, 'dist', WIN_EXE), 'MZreal');
    expect(ei.isElectronUsable({ electronDir: dir, env: {}, platform: 'win32' })).toBe(true);
  });

  test('the broken state propagates to the doctor probe (getElectronPath-style stat)', async () => {
    // Doctor treats a path-but-no-exe install as broken (probe returns null).
    const dir = fakeElectronDir({ withExe: false });
    const doctor = require('../src/cli-handlers-doctor');
    const checks = await doctor.runDoctorChecks({
      ...baseDeps,
      // Probe wired to the REAL stat check over the broken package.
      getElectronPath: () =>
        (ei.isElectronUsable({ electronDir: dir, env: {}, platform: 'win32' })
          ? ei.resolveElectronBinary({ electronDir: dir, env: {}, platform: 'win32' })
          : null),
    });
    const electron = checks.find((c) => c.id === 'electron');
    expect(electron.status).toBe('warn'); // broken GUI is a warn, not silent ok
  });
});

// ---------------------------------------------------------------------------
// repairElectron over the REAL package (only extract/spawn injected)
// ---------------------------------------------------------------------------
describe('#58 repairElectron heals the REAL broken package (cache-only, offline)', () => {
  test('cacheOnly extract materializes the exe -> isElectronUsable becomes TRUE', async () => {
    const dir = fakeElectronDir({ withExe: false });
    const zip = path.join(mkTmp('amicus-cz-'), 'electron-v43.1.1-win32-x64.zip');
    fs.writeFileSync(zip, 'PKzip');

    const extract = jest.fn(async (_zip, opts) => {
      fs.writeFileSync(path.join(opts.dir, WIN_EXE), 'MZextracted');
    });
    const spawn = jest.fn(() => { throw new Error('network must NOT be hit in cacheOnly'); });

    // Pre-condition: broken.
    expect(ei.isElectronUsable({ electronDir: dir, env: {}, platform: 'win32' })).toBe(false);

    const res = await ei.repairElectron({
      cacheOnly: true,
      electronDir: dir,
      platform: 'win32',
      version: '43.1.1',
      arch: 'x64',
      deps: { cachedZip: () => zip, extract, spawn, ...noopLock() },
    });

    expect(res.repaired).toBe(true);
    expect(spawn).not.toHaveBeenCalled();
    // Post-condition asserted through the REAL stat check, not the return value.
    expect(ei.isElectronUsable({ electronDir: dir, env: {}, platform: 'win32' })).toBe(true);
  });

  test('cacheOnly with NO cache defers (no extract, no spawn) and leaves the package broken', async () => {
    const dir = fakeElectronDir({ withExe: false });
    const extract = jest.fn();
    const spawn = jest.fn();

    const res = await ei.repairElectron({
      cacheOnly: true,
      electronDir: dir,
      platform: 'win32',
      version: '43.1.1',
      arch: 'x64',
      deps: { cachedZip: () => null, extract, spawn, ...noopLock() },
    });

    expect(res.deferred).toBe(true);
    expect(extract).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
    expect(ei.isElectronUsable({ electronDir: dir, env: {}, platform: 'win32' })).toBe(false);
  });

  test('single-flight lock: a concurrent caller backs off — extract runs exactly once', async () => {
    const dir = fakeElectronDir({ withExe: false });
    const zip = path.join(mkTmp('amicus-cz2-'), 'electron-v43.1.1-win32-x64.zip');
    fs.writeFileSync(zip, 'PKzip');

    let held = false;
    const acquireLock = jest.fn(() => {
      if (held) { const e = new Error('EEXIST'); e.code = 'EEXIST'; throw e; }
      held = true;
      return { release: () => { held = false; } };
    });

    let openGate;
    const gate = new Promise((r) => { openGate = r; });
    const extract = jest.fn(async (_zip, opts) => {
      await gate;
      fs.writeFileSync(path.join(opts.dir, WIN_EXE), 'MZextracted');
    });

    const common = {
      cacheOnly: true,
      electronDir: dir,
      platform: 'win32',
      version: '43.1.1',
      arch: 'x64',
      deps: { cachedZip: () => zip, extract, spawn: jest.fn(), acquireLock },
    };

    const first = ei.repairElectron(common);
    const second = ei.repairElectron(common); // contends while first holds the lock

    const secondRes = await second;
    expect(secondRes.contended).toBe(true);
    openGate();
    const firstRes = await first;
    expect(firstRes.repaired).toBe(true);
    expect(extract).toHaveBeenCalledTimes(1); // no double-extract
  });
});

// ---------------------------------------------------------------------------
// ensureElectron over the REAL package + REAL repairElectron
// ---------------------------------------------------------------------------
describe('#58 ensureElectron drives the REAL repair on first GUI use', () => {
  test('lazy provision: broken package -> real repair extracts -> ok:true with the resolved path', async () => {
    const dir = fakeElectronDir({ withExe: false });
    const zip = path.join(mkTmp('amicus-cz3-'), 'electron-v43.1.1-win32-x64.zip');
    fs.writeFileSync(zip, 'PKzip');

    const extract = jest.fn(async (_zip, opts) => {
      fs.writeFileSync(path.join(opts.dir, WIN_EXE), 'MZextracted');
    });

    // No deps.isElectronUsable / deps.repairElectron override: ensureElectron
    // uses the REAL ones, bound to our temp package via repairOptions.
    const result = await ee.ensureElectron({
      deps: {
        // Bind the real stat check + resolver to the temp package.
        isElectronUsable: () => ei.isElectronUsable({ electronDir: dir, env: {}, platform: 'win32' }),
        resolveElectronBinary: () => ei.resolveElectronBinary({ electronDir: dir, env: {}, platform: 'win32' }),
        repairElectron: (opts) => ei.repairElectron({
          ...opts,
          electronDir: dir,
          platform: 'win32',
          version: '43.1.1',
          arch: 'x64',
          deps: { cachedZip: () => zip, extract, spawn: jest.fn(), ...noopLock() },
        }),
        logProgress: () => {},
      },
    });

    expect(result.ok).toBe(true);
    expect(result.path).toBe(path.join(dir, 'dist', WIN_EXE));
    expect(extract).toHaveBeenCalledTimes(1);
  });

  test('once-guard: a usable package is fast-pathed — real repair never runs', async () => {
    const dir = fakeElectronDir({ withExe: true });
    const repair = jest.fn();
    const result = await ee.ensureElectron({
      deps: {
        isElectronUsable: () => ei.isElectronUsable({ electronDir: dir, env: {}, platform: 'win32' }),
        resolveElectronBinary: () => ei.resolveElectronBinary({ electronDir: dir, env: {}, platform: 'win32' }),
        repairElectron: repair,
        logProgress: () => {},
      },
    });
    expect(result).toEqual({ ok: true, path: path.join(dir, 'dist', WIN_EXE) });
    expect(repair).not.toHaveBeenCalled();
  });

  test('deferred real repair surfaces ok:false with a doctor --fix pointer', async () => {
    const dir = fakeElectronDir({ withExe: false });
    const result = await ee.ensureElectron({
      deps: {
        isElectronUsable: () => ei.isElectronUsable({ electronDir: dir, env: {}, platform: 'win32' }),
        resolveElectronBinary: () => ei.resolveElectronBinary({ electronDir: dir, env: {}, platform: 'win32' }),
        // Real repair, no cache -> {deferred}; exe never materializes -> still broken.
        repairElectron: (opts) => ei.repairElectron({
          ...opts,
          electronDir: dir,
          platform: 'win32',
          version: '43.1.1',
          arch: 'x64',
          deps: { cachedZip: () => null, extract: jest.fn(), spawn: jest.fn(), ...noopLock() },
        }),
        logProgress: () => {},
      },
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/amicus doctor --fix/);
  });
});

// ---------------------------------------------------------------------------
// doctor --fix over the REAL repairElectron
// ---------------------------------------------------------------------------
describe('#58 doctor --fix heals through the REAL repairElectron', () => {
  function realRepairOverPackage(dir, {
    extract = jest.fn(),
    cachedZip = () => null,
    spawn = jest.fn(),
    // downloadArtifact is ALWAYS injected so the controlled path never hits the
    // real @electron/get network. Default: reject (simulates an offline fetch).
    downloadArtifact = jest.fn(async () => { throw new Error('network blocked in test'); }),
  } = {}) {
    return (opts) => ei.repairElectron({
      ...opts,
      electronDir: dir,
      platform: 'win32',
      version: '43.1.1',
      arch: 'x64',
      deps: { cachedZip, extract, spawn, downloadArtifact, ...noopLock() },
    });
  }

  test('--fix with a cache hit: real extract repairs in place -> ok (self-healed)', async () => {
    const dir = fakeElectronDir({ withExe: false });
    const zip = path.join(mkTmp('amicus-cz4-'), 'electron-v43.1.1-win32-x64.zip');
    fs.writeFileSync(zip, 'PKzip');
    const extract = jest.fn(async (_zip, opts) => {
      fs.writeFileSync(path.join(opts.dir, WIN_EXE), 'MZextracted');
    });

    const doctor = require('../src/cli-handlers-doctor');
    const checks = await doctor.runDoctorChecks({
      ...baseDeps,
      getElectronPath: () => null, // broken before fix
      fix: true,
      repairElectron: realRepairOverPackage(dir, { extract, cachedZip: () => zip }),
    });
    const electron = checks.find((c) => c.id === 'electron');
    expect(electron.status).toBe('ok');
    expect(electron.message).toMatch(/self-healed/i);
    // The REAL package is genuinely usable now.
    expect(ei.isElectronUsable({ electronDir: dir, env: {}, platform: 'win32' })).toBe(true);
  });

  test('--fix with NO cache: real repair drives the CONTROLLED download (downloadArtifact) and NEVER errors', async () => {
    // doctor --fix allows the network (no cacheOnly), so with no cache the REAL
    // repairElectron does a CONTROLLED provision: fetch the zip ourselves via
    // downloadArtifact (the SAME api install.js uses), extract, then verify.
    // The smoke guarantee: the controlled path is actually driven (NOT a blind
    // install.js spawn), and the check never degrades to a hard error.
    const dir = fakeElectronDir({ withExe: false });
    const dlZip = path.join(mkTmp('amicus-dl-smoke-'), 'electron-v43.1.1-win32-x64.zip');
    fs.writeFileSync(dlZip, 'PKzip');
    const downloadArtifact = jest.fn(async () => dlZip);
    const extract = jest.fn(async (_zip, opts) => {
      fs.writeFileSync(path.join(opts.dir, WIN_EXE), 'MZdownloaded');
    });
    const spawn = jest.fn(() => { throw new Error('install.js spawn must NOT be the controlled provision path'); });
    const doctor = require('../src/cli-handlers-doctor');
    const checks = await doctor.runDoctorChecks({
      ...baseDeps,
      getElectronPath: () => null,
      fix: true,
      repairElectron: realRepairOverPackage(dir, { downloadArtifact, extract, spawn }),
    });
    const electron = checks.find((c) => c.id === 'electron');
    expect(downloadArtifact).toHaveBeenCalledTimes(1); // controlled download driven
    expect(spawn).not.toHaveBeenCalled(); // no blind install.js spawn
    expect(electron.status).not.toBe('error');
    expect(ei.isElectronUsable({ electronDir: dir, env: {}, platform: 'win32' })).toBe(true);
  });

  test('--fix maps an INJECTED {deferred} to WARN, not error (no-cache classification)', async () => {
    // The deferred->WARN mapping itself (doctor folding a {deferred} repair into
    // a non-error warn). Inject the deferred result so the classification is
    // exercised end-to-end through runDoctorChecks.
    const doctor = require('../src/cli-handlers-doctor');
    const checks = await doctor.runDoctorChecks({
      ...baseDeps,
      getElectronPath: () => null,
      fix: true,
      repairElectron: async () => ({ deferred: true, reason: 'no cached zip; deferring download' }),
    });
    const electron = checks.find((c) => c.id === 'electron');
    expect(electron.status).toBe('warn');
    expect(electron.status).not.toBe('error');
    expect(electron.message).toMatch(/defer/i);
  });
});

// ---------------------------------------------------------------------------
// postinstall provisionElectron over the REAL repairElectron
// ---------------------------------------------------------------------------
describe('#58 postinstall provisionElectron over the REAL repairElectron', () => {
  const ORIG = process.env.AMICUS_PREFETCH_ELECTRON;
  afterEach(() => {
    if (ORIG === undefined) { delete process.env.AMICUS_PREFETCH_ELECTRON; }
    else { process.env.AMICUS_PREFETCH_ELECTRON = ORIG; }
  });

  function realRepairOverPackage(dir, deps) {
    return (opts) => ei.repairElectron({
      ...opts,
      electronDir: dir,
      platform: 'win32',
      version: '43.1.1',
      arch: 'x64',
      deps: { ...noopLock(), spawn: jest.fn(), extract: jest.fn(), cachedZip: () => null, ...deps },
    });
  }

  test('cache hit: real cache-only extract heals the package -> no electron warning', async () => {
    delete process.env.AMICUS_PREFETCH_ELECTRON;
    const dir = fakeElectronDir({ withExe: false });
    const zip = path.join(mkTmp('amicus-cz5-'), 'electron-v43.1.1-win32-x64.zip');
    fs.writeFileSync(zip, 'PKzip');
    const extract = jest.fn(async (_zip, opts) => {
      fs.writeFileSync(path.join(opts.dir, WIN_EXE), 'MZextracted');
    });

    const postinstall = require('../scripts/postinstall');
    const warnings = [];
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation((...a) => warnings.push(a.join(' ')));
    try {
      await postinstall.provisionElectron({
        repairElectron: realRepairOverPackage(dir, { extract, cachedZip: () => zip }),
      });
    } finally {
      warnSpy.mockRestore();
    }
    expect(warnings.join('\n')).not.toMatch(/electron/i);
    expect(ei.isElectronUsable({ electronDir: dir, env: {}, platform: 'win32' })).toBe(true);
  });

  test('no cache: real cache-only repair defers -> deferred notice, NEVER throws', async () => {
    delete process.env.AMICUS_PREFETCH_ELECTRON;
    const dir = fakeElectronDir({ withExe: false });
    const postinstall = require('../scripts/postinstall');
    const warnings = [];
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation((...a) => warnings.push(a.join(' ')));
    try {
      await expect(
        postinstall.provisionElectron({ repairElectron: realRepairOverPackage(dir) }),
      ).resolves.toBeUndefined();
    } finally {
      warnSpy.mockRestore();
    }
    const joined = warnings.join('\n');
    expect(joined).toMatch(/electron/i);
    expect(joined).toMatch(/doctor --fix/i);
    expect(joined).not.toMatch(/npm install -g amicus/i);
    // The cache-only path must NEVER hit the network: package stays broken.
    expect(ei.isElectronUsable({ electronDir: dir, env: {}, platform: 'win32' })).toBe(false);
  });

  test('cache-only provision NEVER spawns the installer (no network during install)', async () => {
    delete process.env.AMICUS_PREFETCH_ELECTRON;
    const dir = fakeElectronDir({ withExe: false });
    const spawn = jest.fn(() => { throw new Error('installer/network must NOT run cache-only'); });
    const postinstall = require('../scripts/postinstall');
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await postinstall.provisionElectron({
        repairElectron: realRepairOverPackage(dir, { spawn }),
      });
    } finally {
      warnSpy.mockRestore();
    }
    expect(spawn).not.toHaveBeenCalled();
  });

  test('prefetch opt-in (#60): real forced repair extracts via cache -> prewarmed, exit-0 guard intact', async () => {
    process.env.AMICUS_PREFETCH_ELECTRON = '1';
    const dir = fakeElectronDir({ withExe: false });
    const zip = path.join(mkTmp('amicus-cz6-'), 'electron-v43.1.1-win32-x64.zip');
    fs.writeFileSync(zip, 'PKzip');
    const extract = jest.fn(async (_zip, opts) => {
      fs.writeFileSync(path.join(opts.dir, WIN_EXE), 'MZextracted');
    });

    const postinstall = require('../scripts/postinstall');
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await expect(
        postinstall.provisionElectron({
          repairElectron: realRepairOverPackage(dir, { extract, cachedZip: () => zip }),
        }),
      ).resolves.toBeUndefined();
    } finally {
      warnSpy.mockRestore();
      logSpy.mockRestore();
    }
    expect(ei.isElectronUsable({ electronDir: dir, env: {}, platform: 'win32' })).toBe(true);
  });

  test('a synchronously-throwing repairElectron is non-fatal (provisionElectron resolves)', async () => {
    delete process.env.AMICUS_PREFETCH_ELECTRON;
    const postinstall = require('../scripts/postinstall');
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(
        postinstall.provisionElectron({ repairElectron: () => { throw new Error('sync boom'); } }),
      ).resolves.toBeUndefined();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
