// tests/electron-install.test.js
'use strict';

/**
 * Unit tests for the self-heal keystone src/sidecar/electron-install.js (#53, #59).
 *
 * Electron is an optionalDependency. A flaky/interrupted extract (or AV
 * quarantine) can leave path.txt on disk but the actual dist/electron.exe
 * MISSING -> a silently broken GUI. This module:
 *   - resolveElectronBinary(): resolve the on-disk exe path from electron's
 *     layout, mirroring ELECTRON_OVERRIDE_DIST_PATH semantics (#59).
 *   - isElectronUsable(): true ONLY if the resolved exe actually EXISTS.
 *   - cachedZip(): locate a previously-downloaded electron zip in cache roots.
 *   - repairElectron(): heal offline from cache, or trigger the installer.
 *
 * EVERYTHING that downloads/extracts/touches the network is MOCKED / injected;
 * no test fetches or extracts a real electron binary.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ei = require('../src/sidecar/electron-install');

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// Build a fake electron package dir with a path.txt and (optionally) the exe.
function fakeElectronDir({ withExe, platform = 'win32' } = {}) {
  const dir = mkTmp('amicus-electron-');
  const exeName = platform === 'win32' ? 'electron.exe' : 'electron';
  fs.writeFileSync(path.join(dir, 'path.txt'), exeName);
  const distDir = path.join(dir, 'dist');
  fs.mkdirSync(distDir, { recursive: true });
  if (withExe) {
    fs.writeFileSync(path.join(distDir, exeName), 'MZbinary');
  }
  return { dir, exeName, distDir };
}

describe('electron-install module API (#53)', () => {
  test('exports the self-heal primitives', () => {
    expect(typeof ei.resolveElectronBinary).toBe('function');
    expect(typeof ei.isElectronUsable).toBe('function');
    expect(typeof ei.cachedZip).toBe('function');
    expect(typeof ei.repairElectron).toBe('function');
  });
});

describe('resolveElectronBinary + isElectronUsable (#53, #59)', () => {
  test('resolves dist/<exe> from path.txt for the default layout', () => {
    const { dir, exeName } = fakeElectronDir({ withExe: true, platform: 'win32' });
    const resolved = ei.resolveElectronBinary({ electronDir: dir, env: {}, platform: 'win32' });
    expect(resolved).toBe(path.join(dir, 'dist', exeName));
  });

  test('isElectronUsable is FALSE when path.txt exists but the exe is MISSING', () => {
    const { dir } = fakeElectronDir({ withExe: false, platform: 'win32' });
    expect(ei.isElectronUsable({ electronDir: dir, env: {}, platform: 'win32' })).toBe(false);
  });

  test('isElectronUsable is TRUE when the exe actually exists on disk', () => {
    const { dir } = fakeElectronDir({ withExe: true, platform: 'win32' });
    expect(ei.isElectronUsable({ electronDir: dir, env: {}, platform: 'win32' })).toBe(true);
  });

  test('honors ELECTRON_OVERRIDE_DIST_PATH (#59) instead of the fixed dist dir', () => {
    const { dir, exeName } = fakeElectronDir({ withExe: false, platform: 'win32' });
    // Put the exe in an override dir, NOT in the package dist dir.
    const overrideDir = mkTmp('amicus-electron-override-');
    fs.writeFileSync(path.join(overrideDir, exeName), 'MZbinary');

    const env = { ELECTRON_OVERRIDE_DIST_PATH: overrideDir };
    const resolved = ei.resolveElectronBinary({ electronDir: dir, env, platform: 'win32' });
    expect(resolved).toBe(path.join(overrideDir, exeName));
    expect(ei.isElectronUsable({ electronDir: dir, env, platform: 'win32' })).toBe(true);
  });
});

describe('cachedZip (#53)', () => {
  test('locates a fixtured electron-v<ver>-<platform>-<arch>.zip under a cache root', () => {
    const cacheRoot = mkTmp('amicus-electron-cache-');
    const version = '28.3.3';
    const platform = 'win32';
    const arch = 'x64';
    const zipName = `electron-v${version}-${platform}-${arch}.zip`;
    // @electron/get nests the zip under a sha subdir.
    const shaDir = path.join(cacheRoot, 'deadbeefsha');
    fs.mkdirSync(shaDir, { recursive: true });
    const zipPath = path.join(shaDir, zipName);
    fs.writeFileSync(zipPath, 'PKzip');

    const found = ei.cachedZip({
      version,
      platform,
      arch,
      env: { electron_config_cache: cacheRoot },
    });
    expect(found).toBe(zipPath);
  });

  test('returns null when no cached zip is present', () => {
    const emptyRoot = mkTmp('amicus-electron-cache-empty-');
    // Fully isolate the env so the real default cache root cannot leak in.
    const found = ei.cachedZip({
      version: '28.3.3',
      platform: 'win32',
      arch: 'x64',
      env: {
        electron_config_cache: emptyRoot,
        ELECTRON_CACHE: emptyRoot,
        LOCALAPPDATA: emptyRoot,
        HOME: emptyRoot,
        XDG_CACHE_HOME: emptyRoot,
      },
    });
    expect(found).toBeNull();
  });
});

describe('repairElectron (#53)', () => {
  test('cacheOnly: extracts a cached zip + writes path.txt OFFLINE (never downloads)', async () => {
    const { dir, exeName, distDir } = fakeElectronDir({ withExe: false, platform: 'win32' });
    const zipPath = path.join(mkTmp('amicus-cz-'), 'electron-v28.3.3-win32-x64.zip');
    fs.writeFileSync(zipPath, 'PKzip');

    const extract = jest.fn(async (_zip, opts) => {
      // Simulate extraction by materializing the exe in the dist dir.
      fs.writeFileSync(path.join(opts.dir, exeName), 'MZextracted');
    });
    const spawn = jest.fn(() => { throw new Error('network must NOT be hit in cacheOnly'); });

    const res = await ei.repairElectron({
      cacheOnly: true,
      electronDir: dir,
      platform: 'win32',
      version: '28.3.3',
      arch: 'x64',
      deps: {
        cachedZip: () => zipPath,
        extract,
        spawn,
        // single-flight lock no-op
        acquireLock: () => ({ release: () => {} }),
      },
    });

    expect(extract).toHaveBeenCalledTimes(1);
    expect(extract.mock.calls[0][1].dir).toBe(distDir);
    expect(spawn).not.toHaveBeenCalled();
    // path.txt restored + exe present => repaired.
    expect(fs.existsSync(path.join(distDir, exeName))).toBe(true);
    expect(fs.readFileSync(path.join(dir, 'path.txt'), 'utf8')).toBe(exeName);
    expect(res.repaired).toBe(true);
  });

  test('cacheOnly: a silently-failed extract (no usable exe) reports repaired:false', async () => {
    const { dir, exeName, distDir } = fakeElectronDir({ withExe: false, platform: 'win32' });
    const zipPath = path.join(mkTmp('amicus-cz-'), 'electron-v28.3.3-win32-x64.zip');
    fs.writeFileSync(zipPath, 'PKzip');

    // Extract runs but does NOT materialize the exe (interrupted unzip / AV quarantine).
    const extract = jest.fn(async () => { /* no exe written */ });
    const spawn = jest.fn(() => { throw new Error('network must NOT be hit in cacheOnly'); });

    const res = await ei.repairElectron({
      cacheOnly: true,
      electronDir: dir,
      platform: 'win32',
      version: '28.3.3',
      arch: 'x64',
      deps: {
        cachedZip: () => zipPath,
        extract,
        spawn,
        acquireLock: () => ({ release: () => {} }),
      },
    });

    expect(extract).toHaveBeenCalledTimes(1);
    expect(spawn).not.toHaveBeenCalled();
    // The exe never landed → repaired must be FALSE. Regression guard for the
    // `|| true` bug that reported every repair as successful even when the exe
    // was missing (which #57's postinstall message trusts).
    expect(fs.existsSync(path.join(distDir, exeName))).toBe(false);
    expect(res.repaired).toBe(false);
  });

  test('cacheOnly with NO cache returns {deferred:true, reason} and never downloads', async () => {
    const { dir } = fakeElectronDir({ withExe: false, platform: 'win32' });
    const extract = jest.fn();
    const spawn = jest.fn();

    const res = await ei.repairElectron({
      cacheOnly: true,
      electronDir: dir,
      platform: 'win32',
      version: '28.3.3',
      arch: 'x64',
      deps: {
        cachedZip: () => null,
        extract,
        spawn,
        acquireLock: () => ({ release: () => {} }),
      },
    });

    expect(res.deferred).toBe(true);
    expect(typeof res.reason).toBe('string');
    expect(res.reason.length).toBeGreaterThan(0);
    expect(extract).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  test('win32 deferred reason mentions Windows Defender / AV quarantine', async () => {
    const { dir } = fakeElectronDir({ withExe: false, platform: 'win32' });
    const res = await ei.repairElectron({
      cacheOnly: true,
      electronDir: dir,
      platform: 'win32',
      version: '28.3.3',
      arch: 'x64',
      deps: {
        cachedZip: () => null,
        extract: jest.fn(),
        spawn: jest.fn(),
        acquireLock: () => ({ release: () => {} }),
      },
    });
    expect(res.reason).toMatch(/defender|antivirus|av|quarantine/i);
  });

  test('single-flight lock blocks a concurrent double-extract', async () => {
    const { dir, exeName } = fakeElectronDir({ withExe: false, platform: 'win32' });
    const zipPath = path.join(mkTmp('amicus-cz2-'), 'electron-v28.3.3-win32-x64.zip');
    fs.writeFileSync(zipPath, 'PKzip');

    // A single shared lock: second acquire throws (EEXIST-style).
    let held = false;
    const acquireLock = jest.fn(() => {
      if (held) {
        const e = new Error('EEXIST: lock held');
        e.code = 'EEXIST';
        throw e;
      }
      held = true;
      return { release: () => { held = false; } };
    });

    let resolveExtract;
    const extractGate = new Promise((r) => { resolveExtract = r; });
    const extract = jest.fn(async (_zip, opts) => {
      await extractGate;
      fs.writeFileSync(path.join(opts.dir, exeName), 'MZextracted');
    });

    const common = {
      cacheOnly: true,
      electronDir: dir,
      platform: 'win32',
      version: '28.3.3',
      arch: 'x64',
      deps: { cachedZip: () => zipPath, extract, spawn: jest.fn(), acquireLock },
    };

    const first = ei.repairElectron(common);
    const second = ei.repairElectron(common); // contends while first holds the lock

    const secondRes = await second;
    resolveExtract();
    await first;

    // Only ONE extraction ran; the contender backed off (single-flight).
    expect(extract).toHaveBeenCalledTimes(1);
    expect(secondRes.contended || secondRes.deferred).toBe(true);
  });

  test('force (no cache, !cacheOnly): drives the installer via injected spawn (two-attempt ladder)', async () => {
    const { dir, exeName, distDir } = fakeElectronDir({ withExe: false, platform: 'win32' });

    // spawn simulates electron's install.js succeeding (materializes exe).
    const spawn = jest.fn(() => {
      fs.writeFileSync(path.join(distDir, exeName), 'MZfromInstaller');
      return { status: 0 };
    });

    const res = await ei.repairElectron({
      force: true,
      cacheOnly: false,
      electronDir: dir,
      platform: 'win32',
      version: '28.3.3',
      arch: 'x64',
      deps: {
        cachedZip: () => null,
        extract: jest.fn(),
        spawn,
        acquireLock: () => ({ release: () => {} }),
      },
    });

    expect(spawn).toHaveBeenCalled();
    // force_no_cache semantics surfaced to the installer env.
    const spawnEnv = spawn.mock.calls[spawn.mock.calls.length - 1][2]?.env || {};
    expect(spawnEnv.force_no_cache).toBe('true');
    expect(res.repaired).toBe(true);
    expect(fs.existsSync(path.join(distDir, exeName))).toBe(true);
  });
});
