// tests/sidecar/unzip-missing-extract-zip.test.js
'use strict';

/**
 * The Electron self-heal was DEAD CODE in every published install (v4.5.2 fix).
 *
 * `src/sidecar/unzip.js` did `deps.extractZip || require('extract-zip')` OUTSIDE
 * any try/catch, but `extract-zip` was never declared in `dependencies` or
 * `optionalDependencies`. It resolved in the dev tree only because `puppeteer`
 * (a devDependency) pulls it transitively — `npm ls extract-zip --omit=dev`
 * returns EMPTY. So on a real `npm i -g amicus`, `robustExtract` threw
 * MODULE_NOT_FOUND before Strategy 1, which meant:
 *
 *   - the native-unzip fallback below it was unreachable,
 *   - the bounded idle/max timers the extract-zip-node24 work added never ran,
 *   - `amicus doctor --fix` dead-ended at "self-heal incomplete",
 *   - and the user was routed toward AV allow-listing for a missing module.
 *
 * Every existing unzip test injects `deps.extractZip`, so none of them ever
 * executed the bare `require` — which is exactly how this shipped.
 *
 * Two independent guards below: the require must be GUARDED (a broken
 * extract-zip degrades to native rather than throwing), and the dependency must
 * be DECLARED (so the guard is a safety net, not the normal path).
 */

const os = require('os');
const path = require('path');
const { robustExtract } = require('../../src/sidecar/unzip');

/** Minimal in-memory fs double; `dirNonEmpty` drives the strategy choice. */
function makeFs({ filesAfterNative = ['electron.exe'] } = {}) {
  let landed = [];
  return {
    _land: () => { landed = filesAfterNative; },
    mkdirSync: jest.fn(),
    existsSync: jest.fn(() => true),
    readdirSync: jest.fn(() => landed),
    rmSync: jest.fn(() => { landed = []; }),
  };
}

describe('robustExtract when extract-zip cannot be required', () => {
  // makeFs() is an in-memory double, so this path is never touched on disk —
  // but it stays os.tmpdir()-based so the hermeticity guard needs no exceptions.
  const dir = path.join(os.tmpdir(), 'amicus-electron-test');

  it('falls back to native unzip instead of throwing MODULE_NOT_FOUND', async () => {
    const fs = makeFs();
    const extractZip = () => {
      const e = new Error("Cannot find module 'extract-zip'");
      e.code = 'MODULE_NOT_FOUND';
      throw e;
    };
    const spawn = jest.fn(() => { fs._land(); return { status: 0 }; });

    const res = await robustExtract('electron.zip', {
      dir, platform: 'win32', deps: { fs, extractZip, spawn, log: () => {} },
    });

    expect(res.strategy).not.toBe('extract-zip');
    expect(spawn).toHaveBeenCalled();
  });

  /**
   * The real shape of the bug: not an injected throwing stub, but the module
   * genuinely absent. `deps.extractZip` omitted forces the bare `require`.
   */
  it('survives the bare require path when the module is absent', async () => {
    jest.resetModules();
    jest.doMock('extract-zip', () => { throw new Error('Cannot find module'); },
      { virtual: true });
    const { robustExtract: fresh } = require('../../src/sidecar/unzip');

    const fs = makeFs();
    const spawn = jest.fn(() => { fs._land(); return { status: 0 }; });

    await expect(fresh('electron.zip', {
      dir, platform: 'win32', deps: { fs, spawn, log: () => {} },
    })).resolves.toEqual(expect.objectContaining({
      strategy: expect.not.stringMatching(/^extract-zip$/),
    }));

    jest.dontMock('extract-zip');
    jest.resetModules();
  });

  it('reports the require failure as the reason it fell back', async () => {
    const fs = makeFs();
    const logged = [];
    const extractZip = () => {
      const e = new Error("Cannot find module 'extract-zip'");
      e.code = 'MODULE_NOT_FOUND';
      throw e;
    };
    const spawn = jest.fn(() => { fs._land(); return { status: 0 }; });

    await robustExtract('electron.zip', {
      dir, platform: 'win32', deps: { fs, extractZip, spawn, log: m => logged.push(m) },
    });

    expect(logged.join('\n')).toMatch(/extract-zip did not complete/i);
  });

  it('still surfaces a real failure when native unzip also fails', async () => {
    const fs = makeFs({ filesAfterNative: [] });
    const extractZip = () => { throw new Error('Cannot find module'); };
    const spawn = jest.fn(() => ({ status: 1 }));

    await expect(robustExtract('electron.zip', {
      dir, platform: 'win32', deps: { fs, extractZip, spawn, log: () => {} },
    })).rejects.toThrow();
  });
});

/**
 * The guard above makes a missing extract-zip survivable. This makes it not
 * happen: the dependency must be DECLARED, so Strategy 1 is actually available
 * in a published install rather than permanently skipped.
 */
describe('extract-zip is a declared production dependency', () => {
  const pkg = require('../../package.json');

  it('is listed in dependencies (not devDependencies, not transitive)', () => {
    expect(pkg.dependencies).toHaveProperty('extract-zip');
  });

  it('is NOT relied on transitively via a devDependency', () => {
    // puppeteer is what silently provided it before v4.5.2. A prod install has
    // no puppeteer, so a transitive-only extract-zip is not a dependency at all.
    expect(pkg.dependencies.puppeteer).toBeUndefined();
  });

  it('resolves from src/sidecar/, where unzip.js requires it', () => {
    expect(() => require.resolve('extract-zip', {
      paths: [path.join(__dirname, '..', '..', 'src', 'sidecar')],
    })).not.toThrow();
  });
});
