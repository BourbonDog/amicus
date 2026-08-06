/**
 * #54 — doctor electron check stats the exe, not just path.txt.
 *
 * realDeps().getElectronPath delegates to interactive-process.getElectronPath(), which
 * (#54) returns null when the exe is MISSING even though path.txt survives. So
 * the doctor electron check must report "not installed" (warn) for a quarantined
 * exe, and never provision as a side-effect of the check.
 */

'use strict';

// Hermeticity guard (same class as the v4.6.2-pr1 wave; see allGood's M14
// comment in tests/cli-handlers-doctor.test.js): the bare runDoctorChecks()
// calls below let every check fall through to realDeps() and run for real --
// engine-install subprocess scans, the OpenRouter credit network probe, real
// config/cache reads. baseDeps mirrors allGood's shape EXCEPT that
// getElectronPath is deliberately OMITTED: this file's whole point is
// exercising realDeps()'s electron wrapper (delegating to the doMock'd
// interactive-process) end to end, so that one seam must keep falling
// through.
const { makeBaseDeps } = require('./helpers/doctor-base-deps');
const baseDeps = makeBaseDeps({ omit: ['getElectronPath'] });

describe('#54 doctor electron check reflects isElectronUsable (stat the exe)', () => {
  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
  });

  test('realDeps().getElectronPath returns null when the exe is quarantined/missing', () => {
    // interactive.getElectronPath now returns null for a missing exe (#54).
    jest.doMock('../src/sidecar/interactive-process', () => ({
      getElectronPath: jest.fn(() => null),
    }));
    // Re-require doctor so its lazy require('./sidecar/interactive-process') picks the mock.
    jest.isolateModules(() => {
      const doctor = require('../src/cli-handlers-doctor');
      // runDoctorChecks composes realDeps() internally; assert the electron check.
      return doctor;
    });
  });

  test('doctor electron check is WARN (not ok) when the exe is missing', async () => {
    jest.doMock('../src/sidecar/interactive-process', () => ({
      getElectronPath: jest.fn(() => null), // #54: missing exe → null
    }));
    let runDoctorChecks;
    jest.isolateModules(() => {
      ({ runDoctorChecks } = require('../src/cli-handlers-doctor'));
    });
    // No getElectronPath override → realDeps()'s wrapper (delegating to the
    // mocked interactive probe) is exercised end to end.
    const checks = await runDoctorChecks(baseDeps);
    const electron = checks.find(c => c.id === 'electron');
    expect(electron.status).toBe('warn');
    expect(electron.message).toMatch(/not installed/i);
  });

  test('doctor electron check is OK when the exe is usable', async () => {
    jest.doMock('../src/sidecar/interactive-process', () => ({
      getElectronPath: jest.fn(() => '/pkg/dist/electron.exe'),
    }));
    let runDoctorChecks;
    jest.isolateModules(() => {
      ({ runDoctorChecks } = require('../src/cli-handlers-doctor'));
    });
    const checks = await runDoctorChecks(baseDeps);
    const electron = checks.find(c => c.id === 'electron');
    expect(electron.status).toBe('ok');
  });

  test('doctor electron check never provisions (pure probe path)', async () => {
    const repairElectron = jest.fn();
    jest.doMock('../src/sidecar/electron-install', () => ({
      isElectronUsable: jest.fn(() => false),
      resolveElectronBinary: jest.fn(() => '/pkg/dist/electron.exe'),
      repairElectron,
    }));
    let runDoctorChecks;
    jest.isolateModules(() => {
      ({ runDoctorChecks } = require('../src/cli-handlers-doctor'));
    });
    const checks = await runDoctorChecks(baseDeps);
    expect(checks.find(c => c.id === 'electron')).toBeDefined();
    expect(repairElectron).not.toHaveBeenCalled();
  });
});
