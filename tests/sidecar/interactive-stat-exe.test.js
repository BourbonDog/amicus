/**
 * #54 — stat the exe (not just path.txt) at runtime check sites.
 *
 * The bug: getElectronPath()/checkElectronAvailable() returned a truthy path as
 * long as require('electron') resolved (path.txt present), even when the actual
 * dist/<exe> was MISSING (Windows Defender quarantine, interrupted extract).
 * The fix repoints both probes to isElectronUsable() (stat the exe), WITHOUT
 * losing pure-probe behaviour (no provisioning side-effect, no signature change).
 */

'use strict';

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));

describe('#54 getElectronPath / checkElectronAvailable stat the exe', () => {
  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
  });

  test('getElectronPath returns null when path.txt exists but the exe is MISSING (quarantine)', () => {
    jest.doMock('../../src/sidecar/electron-install', () => ({
      isElectronUsable: jest.fn(() => false),         // exe missing on disk
      resolveElectronBinary: jest.fn(() => '/pkg/dist/electron.exe'),
    }));
    const { getElectronPath } = require('../../src/sidecar/interactive-process');
    expect(getElectronPath()).toBeNull();
  });

  test('checkElectronAvailable is false when the exe is MISSING even though path.txt survives', () => {
    jest.doMock('../../src/sidecar/electron-install', () => ({
      isElectronUsable: jest.fn(() => false),
      resolveElectronBinary: jest.fn(() => '/pkg/dist/electron.exe'),
    }));
    const { checkElectronAvailable } = require('../../src/sidecar/interactive-process');
    expect(checkElectronAvailable()).toBe(false);
  });

  test('getElectronPath returns the resolved exe path when usable', () => {
    jest.doMock('../../src/sidecar/electron-install', () => ({
      isElectronUsable: jest.fn(() => true),
      resolveElectronBinary: jest.fn(() => '/pkg/dist/electron.exe'),
    }));
    const { getElectronPath } = require('../../src/sidecar/interactive-process');
    expect(getElectronPath()).toBe('/pkg/dist/electron.exe');
  });

  test('checkElectronAvailable is true when the exe is usable', () => {
    jest.doMock('../../src/sidecar/electron-install', () => ({
      isElectronUsable: jest.fn(() => true),
      resolveElectronBinary: jest.fn(() => '/pkg/dist/electron.exe'),
    }));
    const { checkElectronAvailable } = require('../../src/sidecar/interactive-process');
    expect(checkElectronAvailable()).toBe(true);
  });

  test('checkElectronAvailable stays a PURE PROBE — never provisions/repairs', () => {
    const repairElectron = jest.fn();
    jest.doMock('../../src/sidecar/electron-install', () => ({
      isElectronUsable: jest.fn(() => false),
      resolveElectronBinary: jest.fn(() => '/pkg/dist/electron.exe'),
      repairElectron,
    }));
    const { checkElectronAvailable } = require('../../src/sidecar/interactive-process');
    checkElectronAvailable();
    expect(repairElectron).not.toHaveBeenCalled();
  });

  test('checkElectronAvailable signature is unchanged — a zero-arg () => boolean probe', () => {
    jest.doMock('../../src/sidecar/electron-install', () => ({
      isElectronUsable: jest.fn(() => true),
      resolveElectronBinary: jest.fn(() => '/pkg/dist/electron.exe'),
    }));
    const { checkElectronAvailable } = require('../../src/sidecar/interactive-process');
    expect(checkElectronAvailable.length).toBe(0);
    expect(typeof checkElectronAvailable()).toBe('boolean');
  });
});
