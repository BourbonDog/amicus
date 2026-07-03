/**
 * Updater Module Tests
 *
 * Tests for self-update functionality: checking for updates,
 * notifying users, and performing updates via npm.
 *
 * update-notifier v6+ is ESM-only, so the updater loads it through the
 * CJS seam src/utils/update-notifier-loader.js (a wrapped dynamic import).
 * Tests mock that seam: jest's CJS test VM cannot execute a native
 * import() without --experimental-vm-modules. The seam itself is covered
 * by a child-process test that runs the real import in real Node.
 */

const path = require('path');

// Store original env
const originalEnv = { ...process.env };

beforeEach(() => {
  process.env = { ...originalEnv };
  delete process.env.AMICUS_MOCK_UPDATE;
  delete process.env.SIDECAR_MOCK_UPDATE;
  jest.resetModules();
  jest.restoreAllMocks();
});

afterAll(() => {
  process.env = { ...originalEnv };
});

/**
 * Mock the update-notifier loader seam to resolve with a fake module
 * whose default export is the given notifier constructor.
 * @param {Function} constructor - Fake update-notifier constructor
 * @returns {jest.Mock} The mocked loadUpdateNotifier function
 */
function mockLoader(constructor) {
  const loadUpdateNotifier = jest.fn(() => Promise.resolve({ default: constructor }));
  jest.doMock('../src/utils/update-notifier-loader', () => ({ loadUpdateNotifier }));
  return loadUpdateNotifier;
}

describe('Updater Module', () => {

  describe('getUpdateInfo()', () => {
    it('should return null before initUpdateCheck is called', () => {
      const updater = require('../src/utils/updater');
      const info = updater.getUpdateInfo();
      expect(info).toBeNull();
    });

    it('should return null when no update is available', async () => {
      mockLoader(jest.fn(() => ({
        update: undefined,
        notify: jest.fn()
      })));
      const updater = require('../src/utils/updater');

      await updater.initUpdateCheck();
      const info = updater.getUpdateInfo();
      expect(info).toBeNull();
    });

    it('should return update info when update is available', async () => {
      mockLoader(jest.fn(() => ({
        update: { current: '0.3.0', latest: '1.0.0' },
        notify: jest.fn()
      })));
      const updater = require('../src/utils/updater');

      await updater.initUpdateCheck();
      const info = updater.getUpdateInfo();

      expect(info).not.toBeNull();
      expect(info).toHaveProperty('current', '0.3.0');
      expect(info).toHaveProperty('latest', '1.0.0');
      expect(info).toHaveProperty('hasUpdate', true);
    });
  });

  describe('notifyUpdate()', () => {
    it('should call notifier.notify()', async () => {
      const mockNotify = jest.fn();
      mockLoader(jest.fn(() => ({
        update: { current: '0.3.0', latest: '1.0.0' },
        notify: mockNotify
      })));
      const updater = require('../src/utils/updater');

      await updater.initUpdateCheck();
      updater.notifyUpdate();

      expect(mockNotify).toHaveBeenCalled();
    });

    it('should not throw if called before init', () => {
      const updater = require('../src/utils/updater');
      expect(() => updater.notifyUpdate()).not.toThrow();
    });
  });

  describe('initUpdateCheck()', () => {
    it('should initialize with package info', async () => {
      const mockConstructor = jest.fn(() => ({
        update: undefined,
        notify: jest.fn()
      }));
      const loadUpdateNotifier = mockLoader(mockConstructor);
      const updater = require('../src/utils/updater');

      await updater.initUpdateCheck();

      expect(loadUpdateNotifier).toHaveBeenCalled();
      expect(mockConstructor).toHaveBeenCalledWith(
        expect.objectContaining({
          pkg: expect.objectContaining({
            name: 'amicus',
            version: expect.any(String)
          })
        })
      );
    });

    it('should use the module itself when there is no default export', async () => {
      const mockConstructor = jest.fn(() => ({
        update: { current: '0.3.0', latest: '1.0.0' },
        notify: jest.fn()
      }));
      const loadUpdateNotifier = jest.fn(() => Promise.resolve(mockConstructor));
      jest.doMock('../src/utils/update-notifier-loader', () => ({ loadUpdateNotifier }));
      const updater = require('../src/utils/updater');

      await updater.initUpdateCheck();

      expect(mockConstructor).toHaveBeenCalled();
      expect(updater.getUpdateInfo()).toHaveProperty('latest', '1.0.0');
    });

    it('should skip initialization in mock mode', async () => {
      const loadUpdateNotifier = mockLoader(jest.fn());

      process.env.AMICUS_MOCK_UPDATE = 'available';
      const updater = require('../src/utils/updater');

      await updater.initUpdateCheck();

      // Should NOT load the real update-notifier in mock mode
      expect(loadUpdateNotifier).not.toHaveBeenCalled();
    });

    it('should resolve without throwing when the loader fails', async () => {
      const loadUpdateNotifier = jest.fn(() =>
        Promise.reject(new Error('require() of ES Module not supported'))
      );
      jest.doMock('../src/utils/update-notifier-loader', () => ({ loadUpdateNotifier }));
      const updater = require('../src/utils/updater');

      await expect(updater.initUpdateCheck()).resolves.toBeUndefined();
      expect(updater.getUpdateInfo()).toBeNull();
      expect(() => updater.notifyUpdate()).not.toThrow();
    });
  });

  describe('update-notifier-loader (real dynamic import)', () => {
    // Regression test for the ERR_REQUIRE_ESM bug: update-notifier is
    // ESM-only, so require() always threw and update checks silently never
    // ran. Verify the real loader can import it in a real Node process
    // (jest's CJS VM cannot execute a native import(), hence the child).
    it('loads update-notifier and exposes a callable constructor', () => {
      const { spawnSync } = require('child_process');
      const loaderPath = path.join(__dirname, '..', 'src', 'utils', 'update-notifier-loader.js');
      const script =
        `require(${JSON.stringify(loaderPath)}).loadUpdateNotifier()` +
        ".then((mod) => { process.exit(typeof (mod.default || mod) === 'function' ? 0 : 2); })" +
        '.catch((err) => { console.error(err && err.message); process.exit(1); });';

      const res = spawnSync(process.execPath, ['-e', script], {
        cwd: path.join(__dirname, '..'),
        encoding: 'utf-8',
        timeout: 30000
      });

      const outcome = res.status === 0
        ? 'ok'
        : `exit ${res.status}: ${(res.stderr || '').trim()}`;
      expect(outcome).toBe('ok');
    }, 30000);
  });

  describe('performUpdate()', () => {
    it('should resolve with success on exit code 0', async () => {
      const EventEmitter = require('events');
      jest.doMock('child_process', () => ({
        spawn: jest.fn(() => {
          const proc = new EventEmitter();
          proc.stdout = new EventEmitter();
          proc.stderr = new EventEmitter();
          process.nextTick(() => proc.emit('close', 0));
          return proc;
        })
      }));
      const updater = require('../src/utils/updater');

      const result = await updater.performUpdate();

      expect(result).toHaveProperty('success', true);
    });

    it('should resolve with failure on non-zero exit', async () => {
      const EventEmitter = require('events');
      jest.doMock('child_process', () => ({
        spawn: jest.fn(() => {
          const proc = new EventEmitter();
          proc.stdout = new EventEmitter();
          proc.stderr = new EventEmitter();
          process.nextTick(() => {
            proc.stderr.emit('data', Buffer.from('permission denied'));
            proc.emit('close', 1);
          });
          return proc;
        })
      }));
      const updater = require('../src/utils/updater');

      const result = await updater.performUpdate();

      expect(result).toHaveProperty('success', false);
      expect(result).toHaveProperty('error');
    });

    it('should handle spawn errors', async () => {
      const EventEmitter = require('events');
      jest.doMock('child_process', () => ({
        spawn: jest.fn(() => {
          const proc = new EventEmitter();
          proc.stdout = new EventEmitter();
          proc.stderr = new EventEmitter();
          process.nextTick(() => proc.emit('error', new Error('ENOENT')));
          return proc;
        })
      }));
      const updater = require('../src/utils/updater');

      const result = await updater.performUpdate();

      expect(result).toHaveProperty('success', false);
      expect(result.error).toContain('ENOENT');
    });
  });

  describe('AMICUS_MOCK_UPDATE env var', () => {
    describe('mode: "available"', () => {
      it('should return fake update info from getUpdateInfo', async () => {
        process.env.AMICUS_MOCK_UPDATE = 'available';
        const updater = require('../src/utils/updater');

        await updater.initUpdateCheck();
        const info = updater.getUpdateInfo();

        expect(info).not.toBeNull();
        expect(info.hasUpdate).toBe(true);
        expect(info.latest).toBe('99.0.0');
        expect(info.current).toBe(require('../package.json').version);
      });
    });

    describe('mode: "success"', () => {
      it('should make performUpdate resolve immediately with success', async () => {
        process.env.AMICUS_MOCK_UPDATE = 'success';
        const updater = require('../src/utils/updater');

        const result = await updater.performUpdate();

        expect(result).toHaveProperty('success', true);
      });

      it('should return fake update info from getUpdateInfo', async () => {
        process.env.AMICUS_MOCK_UPDATE = 'success';
        const updater = require('../src/utils/updater');

        await updater.initUpdateCheck();
        const info = updater.getUpdateInfo();

        expect(info).not.toBeNull();
        expect(info.hasUpdate).toBe(true);
      });
    });

    describe('mode: "error"', () => {
      it('should make performUpdate return failure', async () => {
        process.env.AMICUS_MOCK_UPDATE = 'error';
        const updater = require('../src/utils/updater');

        const result = await updater.performUpdate();

        expect(result).toHaveProperty('success', false);
        expect(result).toHaveProperty('error');
      });
    });

    describe('mode: "updating"', () => {
      it('should return fake update info from getUpdateInfo', async () => {
        process.env.AMICUS_MOCK_UPDATE = 'updating';
        const updater = require('../src/utils/updater');

        await updater.initUpdateCheck();
        const info = updater.getUpdateInfo();

        expect(info).not.toBeNull();
        expect(info.hasUpdate).toBe(true);
        expect(info.latest).toBe('99.0.0');
      });
    });
  });

  describe('legacy SIDECAR_MOCK_UPDATE (#19 absence pin)', () => {
    it('is ignored — no longer activates mock mode', async () => {
      process.env.SIDECAR_MOCK_UPDATE = 'available';
      const loadUpdateNotifier = mockLoader(jest.fn());
      const updater = require('../src/utils/updater');

      await updater.initUpdateCheck();

      // Real loader path is taken (not short-circuited into mock mode).
      expect(loadUpdateNotifier).toHaveBeenCalled();
    });
  });
});
