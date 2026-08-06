// tests/electron-quarantine.test.js
'use strict';

/**
 * #53 (B-quarantine): the dominant real-world Windows failure is antivirus /
 * Windows Defender quarantining electron.exe AFTER each extract. No re-extract
 * can win that race — the user must allow-list the binary. The self-heal must
 * DETECT this, INSTRUCT, and NOT loop or claim success.
 *
 * Signature: a NON-throwing extract (cache OR controlled download) where the exe
 * is STILL absent afterward — it was written then vanished. repairElectron must
 * return { repaired:false, quarantined:true, reason } with an actionable
 * allow-list instruction, and EVERY caller (ensureElectron, doctor --fix,
 * provisionElectron) must surface that reason WITHOUT reporting success or
 * looping.
 *
 * EVERYTHING that downloads/extracts/touches the network is MOCKED / injected.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ei = require('../src/sidecar/electron-install');

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function fakeElectronDir({ platform = 'win32' } = {}) {
  const dir = mkTmp('amicus-electron-q-');
  const exeName = platform === 'win32' ? 'electron.exe' : 'electron';
  fs.writeFileSync(path.join(dir, 'path.txt'), exeName);
  fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
  return { dir, exeName };
}

describe('repairElectron detects AV quarantine (#53 B-quarantine)', () => {
  test('cacheOnly: extract does NOT throw but the exe is absent → quarantined:true, repaired:false, allow-list reason', async () => {
    const { dir } = fakeElectronDir({ platform: 'win32' });
    const zipPath = path.join(mkTmp('amicus-qz-'), 'electron-v43.1.1-win32-x64.zip');
    fs.writeFileSync(zipPath, 'PKzip');

    // Extract "succeeds" (no throw) but the exe never lands — the AV-quarantine
    // signature: electron.exe was written then removed right after.
    const extract = jest.fn(async () => { /* exe written then vanished */ });

    const res = await ei.repairElectron({
      cacheOnly: true,
      electronDir: dir,
      platform: 'win32',
      version: '43.1.1',
      arch: 'x64',
      deps: {
        cachedZip: () => zipPath,
        extract,
        spawn: jest.fn(),
        acquireLock: () => ({ release: () => {} }),
      },
    });

    expect(extract).toHaveBeenCalledTimes(1);
    expect(res.repaired).toBe(false);
    expect(res.quarantined).toBe(true);
    expect(res.reason).toMatch(/quarantin|allow/i);
    // Names the binary path so the user knows exactly what to allow-list.
    expect(res.reason).toMatch(/electron\.exe/i);
    // Points at the self-heal re-run, not a reinstall loop.
    expect(res.reason).toMatch(/doctor --fix/i);
  });

  test('controlled download: extract does NOT throw but the exe is absent → quarantined:true, repaired:false', async () => {
    const { dir } = fakeElectronDir({ platform: 'win32' });
    const dlZip = path.join(mkTmp('amicus-qdl-'), 'electron-v43.1.1-win32-x64.zip');
    fs.writeFileSync(dlZip, 'PKzip');

    const downloadArtifact = jest.fn(async () => dlZip);
    const extract = jest.fn(async () => { /* exe written then vanished */ });
    // install.js fallback also yields nothing (still quarantined).
    const spawn = jest.fn(() => ({ status: 0 }));

    const res = await ei.repairElectron({
      force: true,
      cacheOnly: false,
      electronDir: dir,
      platform: 'win32',
      version: '43.1.1',
      arch: 'x64',
      deps: {
        cachedZip: () => null,
        downloadArtifact,
        extract,
        spawn,
        acquireLock: () => ({ release: () => {} }),
      },
    });

    expect(downloadArtifact).toHaveBeenCalledTimes(1);
    expect(res.repaired).toBe(false);
    expect(res.quarantined).toBe(true);
    expect(res.reason).toMatch(/quarantin|allow/i);
  });

  test('does NOT auto-retry the extract in a loop on quarantine (no re-extract)', async () => {
    const { dir } = fakeElectronDir({ platform: 'win32' });
    const zipPath = path.join(mkTmp('amicus-qz2-'), 'electron-v43.1.1-win32-x64.zip');
    fs.writeFileSync(zipPath, 'PKzip');

    const extract = jest.fn(async () => { /* exe vanished */ });

    await ei.repairElectron({
      cacheOnly: true,
      electronDir: dir,
      platform: 'win32',
      version: '43.1.1',
      arch: 'x64',
      deps: {
        cachedZip: () => zipPath,
        extract,
        spawn: jest.fn(),
        acquireLock: () => ({ release: () => {} }),
      },
    });

    // Exactly one extract — never re-extracts in a loop chasing the quarantine.
    expect(extract).toHaveBeenCalledTimes(1);
  });

  test('a CLEAN extract (exe present) is NOT flagged as quarantined', async () => {
    const { dir, exeName } = fakeElectronDir({ platform: 'win32' });
    const zipPath = path.join(mkTmp('amicus-qz3-'), 'electron-v43.1.1-win32-x64.zip');
    fs.writeFileSync(zipPath, 'PKzip');

    const extract = jest.fn(async (_zip, opts) => {
      fs.writeFileSync(path.join(opts.dir, exeName), 'MZextracted');
    });

    const res = await ei.repairElectron({
      cacheOnly: true,
      electronDir: dir,
      platform: 'win32',
      version: '43.1.1',
      arch: 'x64',
      deps: {
        cachedZip: () => zipPath,
        extract,
        spawn: jest.fn(),
        acquireLock: () => ({ release: () => {} }),
      },
    });

    expect(res.repaired).toBe(true);
    expect(res.quarantined).toBeFalsy();
  });
});

describe('ensureElectron surfaces the quarantine reason (#53 B-quarantine)', () => {
  const ee = require('../src/sidecar/electron-ensure');
  beforeEach(() => ee._resetEnsureElectron());

  test('ok:false and the reason is the quarantine instruction (not a generic message)', async () => {
    const quarantineReason = 'electron.exe was removed right after it was extracted — antivirus (e.g. Windows Defender) likely quarantined it. Allow node_modules/electron/dist/electron.exe in your AV, then run amicus doctor --fix.';
    const repairElectron = jest.fn(async () => ({ repaired: false, quarantined: true, reason: quarantineReason }));
    const res = await ee.ensureElectron({
      deps: {
        isElectronUsable: () => false,
        resolveElectronBinary: () => '/fake/dist/electron.exe',
        repairElectron,
        logProgress: () => {},
      },
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe(quarantineReason);
    expect(res.reason).toMatch(/quarantin|allow/i);
  });
});

// Hermeticity guard (same class as the v4.6.2-pr1 wave; see allGood's M14
// comment in tests/cli-handlers-doctor.test.js): runDoctorChecks computes the
// FULL check list, so pinning only getElectronPath (as the test below used to)
// let every other dep run for real -- engine-install subprocess scans, the
// OpenRouter credit network probe, real config reads -- and, with fix:true,
// real self-heals on a machine with a broken engine install or a legacy
// sidecar entry. Pinning scanElectronInstalls also stops the electron-mcp
// check from consuming this suite's repairElectron mock (#76), keeping the
// exactly-once assertion deterministic. baseDeps mirrors allGood's shape.
const { makeBaseDeps } = require('./helpers/doctor-base-deps');
const baseDeps = makeBaseDeps();

describe('doctor --fix surfaces the quarantine instruction (#53 B-quarantine)', () => {
  const doctor = require('../src/cli-handlers-doctor');

  test('quarantined maps to a non-ok WARN with the allow-list instruction, NOT provisioned, no retry', async () => {
    const quarantineReason = 'electron.exe was removed right after it was extracted — antivirus (e.g. Windows Defender) likely quarantined it. Allow node_modules/electron/dist/electron.exe in your AV, then run amicus doctor --fix.';
    const repairElectron = jest.fn().mockResolvedValue({ repaired: false, quarantined: true, reason: quarantineReason });
    const checks = await doctor.runDoctorChecks({ ...baseDeps, getElectronPath: () => null, fix: true, repairElectron });
    const electron = checks.find((c) => c.id === 'electron');

    // Exactly one repair attempt — quarantine is NEVER auto-retried in a loop.
    expect(repairElectron).toHaveBeenCalledTimes(1);
    expect(electron.status).not.toBe('ok');
    // Must not falsely claim success.
    expect(electron.message).not.toMatch(/self-healed|installed/i);
    // Surfaces the allow-list instruction so the user can act.
    expect(electron.message).toMatch(/quarantin|allow/i);
    expect(electron.message).toMatch(/electron\.exe/i);
  });
});

describe('postinstall provisionElectron surfaces the quarantine reason (#53 B-quarantine)', () => {
  const postinstall = require('../scripts/postinstall');

  test('prints the quarantine reason, NOT a generic provisions-on-first-use notice', async () => {
    const quarantineReason = 'electron.exe was removed right after it was extracted — antivirus (e.g. Windows Defender) likely quarantined it. Allow node_modules/electron/dist/electron.exe in your AV, then run amicus doctor --fix.';
    const repairElectron = jest.fn().mockResolvedValue({ repaired: false, quarantined: true, reason: quarantineReason });
    const warnings = [];
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation((...a) => warnings.push(a.join(' ')));
    try {
      await postinstall.provisionElectron({ repairElectron });
    } finally {
      warnSpy.mockRestore();
    }
    const all = warnings.join('\n');
    expect(all).toMatch(/quarantin|allow/i);
    expect(all).toMatch(/electron\.exe/i);
  });
});
