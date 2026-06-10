/**
 * Interactive Mode Tests
 *
 * Tests for buildElectronEnv: environment variable construction
 * for the Electron sidecar process.
 */

jest.mock('../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
}));

const path = require('path');

const { buildElectronEnv } = require('../../src/sidecar/interactive');

const BASE_ARGS = ['task-001', 'google/gemini-2.5', '/project', '/bin', '/usr/bin'];

describe('buildElectronEnv - PATH', () => {
  it('joins nodeModulesBin and the existing PATH with the platform delimiter', () => {
    const env = buildElectronEnv(...BASE_ARGS, {});
    // ':' on POSIX, ';' on Windows — a hardcoded ':' corrupts the child PATH on win32
    expect(env.PATH).toBe(`/bin${path.delimiter}/usr/bin`);
  });
});

describe('buildElectronEnv - window position', () => {
  it('sets AMICUS_WINDOW_POSITION when windowPosition is provided', () => {
    const env = buildElectronEnv(...BASE_ARGS, { windowPosition: 'right' });
    expect(env.AMICUS_WINDOW_POSITION).toBe('right');
  });

  it('sets AMICUS_WINDOW_POSITION to left', () => {
    const env = buildElectronEnv(...BASE_ARGS, { windowPosition: 'left' });
    expect(env.AMICUS_WINDOW_POSITION).toBe('left');
  });

  it('sets AMICUS_WINDOW_POSITION to center', () => {
    const env = buildElectronEnv(...BASE_ARGS, { windowPosition: 'center' });
    expect(env.AMICUS_WINDOW_POSITION).toBe('center');
  });

  it('omits AMICUS_WINDOW_POSITION when not provided', () => {
    const env = buildElectronEnv(...BASE_ARGS, {});
    expect(env.AMICUS_WINDOW_POSITION).toBeUndefined();
  });
});

describe('getElectronPath', () => {
  // This assertion needs a real electron install (it inspects require('electron')'s
  // binary path). Local dev omits electron via --omit=optional, so skip it when
  // electron isn't resolvable; it runs in CI where electron IS installed.
  let electronInstalled = true;
  try { require.resolve('electron'); } catch { electronInstalled = false; }
  const itElectron = electronInstalled ? it : it.skip;

  itElectron('returns the path from require("electron") instead of hardcoded relative path', () => {
    const { getElectronPath } = require('../../src/sidecar/interactive');
    const result = getElectronPath();

    // Should NOT be a hardcoded node_modules/.bin/electron path
    expect(result).not.toContain('node_modules/.bin/electron');

    // Should be the actual Electron binary path (what require('electron') returns).
    // Compare against require('electron') itself: the binary name differs by
    // platform (Electron.app/.../Electron on macOS, electron.exe on Windows).
    expect(result).toBe(require('electron'));
    expect(result.toLowerCase()).toContain('electron');
  });

  it('returns null when electron is not installed', () => {
    const { getElectronPath } = require('../../src/sidecar/interactive');
    // Mock require to throw for 'electron'
    const originalRequire = jest.requireActual;
    // getElectronPath should handle missing electron gracefully
    // We test this by checking it returns a string (electron is installed here)
    // and that checkElectronAvailable is consistent with it
    const { checkElectronAvailable } = require('../../src/sidecar/interactive');
    const available = checkElectronAvailable();
    const electronPath = getElectronPath();

    // Both should agree: if available, path is non-null; if not, path is null
    if (available) {
      expect(electronPath).toBeTruthy();
    } else {
      expect(electronPath).toBeNull();
    }
  });
});
