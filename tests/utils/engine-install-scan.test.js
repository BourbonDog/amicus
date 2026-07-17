// tests/utils/engine-install-scan.test.js
'use strict';
const path = require('path');
const { listAmicusInstalls, scanEngineInstalls } = require('../../src/utils/engine-install-scan');

// Fake fs seam: existsSync true only for seeded paths; readdirSync/realpathSync
// driven by maps. Normalizes so backslash/forward-slash never matters.
function fakeFs({ present = [], readdir = {}, realpath = {} } = {}) {
  const set = new Set(present.map((p) => path.normalize(p)));
  const rd = {};
  for (const [k, v] of Object.entries(readdir)) { rd[path.normalize(k)] = v; }
  const rp = {};
  for (const [k, v] of Object.entries(realpath)) { rp[path.normalize(k)] = v; }
  return {
    existsSync: (p) => set.has(path.normalize(p)),
    readdirSync: (p) => rd[path.normalize(p)] || [],
    realpathSync: (p) => rp[path.normalize(p)] || p,
  };
}

const CACHE = path.join('C:', 'cache');
const NPX_ROOT = path.join(CACHE, '_npx');
const RUNNING = path.join('C:', 'proj', 'amicus');
const GLOBAL_NM = path.join('C:', 'global', 'node_modules');
const GLOBAL_AMICUS = path.join(GLOBAL_NM, 'amicus');
const npxAmicus = (hash) => path.join(NPX_ROOT, hash, 'node_modules', 'amicus');

// Base seams: running exists, global resolves, two npx hashes (one with amicus,
// one without), plus a non-amicus junk entry in _npx. `realpath`/`readdir`/
// `present` overrides feed the fake fs; everything else is a normal dep.
function baseDeps(overrides = {}) {
  const { realpath, readdir, present, ...rest } = overrides;
  return {
    fs: fakeFs({
      present: present || [RUNNING, GLOBAL_AMICUS, npxAmicus('hashA'), npxAmicus('hashB')],
      readdir: readdir || { [NPX_ROOT]: ['hashA', 'hashB', 'hashNoAmicus', 'stray.txt'] },
      realpath: realpath || {},
    }),
    platform: 'win32',
    runningPkgDir: RUNNING,
    npmCacheDir: CACHE,
    npmRootG: () => GLOBAL_NM,
    ...rest,
  };
}

describe('listAmicusInstalls', () => {
  test('enumerates running, global, and every npx-cache copy; skips hashes without amicus', () => {
    const installs = listAmicusInstalls(baseDeps());
    expect(installs).toEqual([
      { kind: 'running', pkgDir: RUNNING },
      { kind: 'global', pkgDir: GLOBAL_AMICUS },
      { kind: 'npx', pkgDir: npxAmicus('hashA') },
      { kind: 'npx', pkgDir: npxAmicus('hashB') },
    ]);
  });

  test('global omitted when npm root -g returns null', () => {
    const installs = listAmicusInstalls(baseDeps({ npmRootG: () => null }));
    expect(installs.some((i) => i.kind === 'global')).toBe(false);
  });

  test('global is best-effort: npmRootG throwing never throws the scan', () => {
    const installs = listAmicusInstalls(baseDeps({ npmRootG: () => { throw new Error('npm not found'); } }));
    expect(installs.some((i) => i.kind === 'global')).toBe(false);
    expect(installs.some((i) => i.kind === 'running')).toBe(true);
  });

  test('no _npx directory yields no npx installs', () => {
    const deps = baseDeps();
    deps.fs = fakeFs({ present: [RUNNING, GLOBAL_AMICUS] }); // no _npx readdir entries
    const installs = listAmicusInstalls(deps);
    expect(installs.filter((i) => i.kind === 'npx')).toEqual([]);
  });

  test('running and global that resolve to the same real path are deduped (running kept)', () => {
    const SHARED = path.join('C:', 'real', 'amicus');
    const installs = listAmicusInstalls(baseDeps({
      realpath: { [RUNNING]: SHARED, [GLOBAL_AMICUS]: SHARED },
    }));
    const forShared = installs.filter((i) => i.pkgDir === RUNNING || i.pkgDir === GLOBAL_AMICUS);
    expect(forShared).toEqual([{ kind: 'running', pkgDir: RUNNING }]);
  });
});

describe('scanEngineInstalls', () => {
  // Inject the engine probe + roots so no real fs/arch is touched.
  const engineSeams = (brokenPkgDirs = []) => ({
    hasOpencodeBinary: ({ pkgDir }) => !brokenPkgDirs.includes(pkgDir),
    opencodeRoots: ({ pkgDir }) => [path.join(pkgDir, 'node_modules'), path.dirname(pkgDir)],
  });

  test('annotates each install with engineOk and its searched roots', () => {
    const { installs } = scanEngineInstalls(baseDeps({
      ...engineSeams([npxAmicus('hashB')]),
      readAmicusMcpConfig: () => ({ command: 'npx', args: ['-y', 'amicus@latest', 'mcp'] }),
    }));
    const byDir = Object.fromEntries(installs.map((i) => [i.pkgDir, i]));
    expect(byDir[npxAmicus('hashA')].engineOk).toBe(true);
    expect(byDir[npxAmicus('hashB')].engineOk).toBe(false);
    expect(byDir[npxAmicus('hashA')].roots).toEqual([
      path.join(npxAmicus('hashA'), 'node_modules'), path.dirname(npxAmicus('hashA')),
    ]);
  });

  test('mcpLaunch = npx when the registration command is npx', () => {
    const { mcpLaunch } = scanEngineInstalls(baseDeps({
      ...engineSeams(),
      readAmicusMcpConfig: () => ({ command: 'npx', args: ['-y', 'amicus@latest', 'mcp'] }),
    }));
    expect(mcpLaunch).toBe('npx');
  });

  test('mcpLaunch = path when the registration is a fixed amicus binary', () => {
    const { mcpLaunch } = scanEngineInstalls(baseDeps({
      ...engineSeams(),
      readAmicusMcpConfig: () => ({ command: path.join('C:', 'global', 'amicus.cmd'), args: ['mcp'] }),
    }));
    expect(mcpLaunch).toBe('path');
  });

  test('mcpLaunch = none when no amicus MCP is registered', () => {
    const { mcpLaunch } = scanEngineInstalls(baseDeps({
      ...engineSeams(),
      readAmicusMcpConfig: () => null,
    }));
    expect(mcpLaunch).toBe('none');
  });

  test('mcpLaunch = unknown when a registration exists but is not recognizable', () => {
    const { mcpLaunch } = scanEngineInstalls(baseDeps({
      ...engineSeams(),
      readAmicusMcpConfig: () => ({ command: 'node', args: ['weird.js'] }),
    }));
    expect(mcpLaunch).toBe('unknown');
  });
});
