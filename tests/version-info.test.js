/**
 * version-info helper tests (#33)
 *
 * The helper surfaces the running amicus version and detects when the on-disk
 * package.json has been upgraded under a still-running process. The call-time
 * fs re-read is wrapped in try/catch so a read failure never crashes a tool.
 */

describe('version-info helper (#33)', () => {
  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
  });

  test('RUNNING_VERSION matches the in-memory package.json version', () => {
    const { RUNNING_VERSION } = require('../src/utils/version-info');
    const expected = require('../package.json').version;
    expect(RUNNING_VERSION).toBe(expected);
  });

  test('versionWarning() returns null when on-disk version matches running', () => {
    const running = require('../package.json').version;
    jest.doMock('fs', () => {
      const real = jest.requireActual('fs');
      return {
        ...real,
        readFileSync: jest.fn((p, ...rest) => {
          if (String(p).endsWith('package.json')) {
            return JSON.stringify({ version: running });
          }
          return real.readFileSync(p, ...rest);
        }),
      };
    });
    const { versionWarning } = require('../src/utils/version-info');
    expect(versionWarning()).toBeNull();
  });

  test('versionWarning() warns when on-disk version is newer than running', () => {
    jest.doMock('fs', () => {
      const real = jest.requireActual('fs');
      return {
        ...real,
        readFileSync: jest.fn((p, ...rest) => {
          if (String(p).endsWith('package.json')) {
            return JSON.stringify({ version: '99.99.99' });
          }
          return real.readFileSync(p, ...rest);
        }),
      };
    });
    const { versionWarning } = require('../src/utils/version-info');
    const warn = versionWarning();
    expect(typeof warn).toBe('string');
    expect(warn).toContain('99.99.99');
    expect(warn.toLowerCase()).toContain('restart');
  });

  test('versionWarning() returns null (no crash) when the fs re-read throws', () => {
    jest.doMock('fs', () => {
      const real = jest.requireActual('fs');
      return {
        ...real,
        readFileSync: jest.fn((p, ...rest) => {
          if (String(p).endsWith('package.json')) {
            throw new Error('boom');
          }
          return real.readFileSync(p, ...rest);
        }),
      };
    });
    const { versionWarning } = require('../src/utils/version-info');
    expect(() => versionWarning()).not.toThrow();
    expect(versionWarning()).toBeNull();
  });
});
