// tests/utils/engine-install-scan.test.js
'use strict';
const path = require('path');
const { listAmicusInstalls, scanEngineInstalls, resolveNpmRootG } = require('../../src/utils/engine-install-scan');

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
    // Hermetic default: without this, scanEngineInstalls tests that don't
    // override readEngineVersion fall through to defaultReadEngineVersion,
    // which calls the REAL require('fs').readFileSync against these
    // fabricated C:\cache\... paths on every CI leg (harmless today — ENOENT
    // → undefined — but one seam away from the hermeticity hole the brief
    // warned about). Tests that care override it via `...rest`.
    readEngineVersion: () => undefined,
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

describe('resolveNpmRootG', () => {
  it('resolves the global root on win32, where bare `npm` is not spawnable without a shell', () => {
    // Node 24 hardening (CVE-2024-27980) rejects .cmd without shell:true, so
    // execFileSync('npm', …) throws ENOENT and execFileSync('npm.cmd', …) throws
    // EINVAL. Before this fix defaultNpmRootG returned null on every Windows box
    // and the global install was invisible to the scan — and to findDonor.
    const calls = [];
    const execFileSync = (cmd, args, opts) => {
      calls.push({ cmd, args, shell: opts && opts.shell });
      if (!opts || opts.shell !== true) { const e = new Error('spawnSync ENOENT'); e.code = 'ENOENT'; throw e; }
      return 'C:\\Users\\t\\AppData\\Roaming\\npm\\node_modules\n';
    };
    expect(resolveNpmRootG({ execFileSync, platform: 'win32' }))
      .toBe('C:\\Users\\t\\AppData\\Roaming\\npm\\node_modules');
    expect(calls.some((c) => c.shell === true)).toBe(true);
  });

  it('returns null rather than throwing when npm cannot be resolved at all', () => {
    const execFileSync = () => { throw new Error('nope'); };
    expect(resolveNpmRootG({ execFileSync, platform: 'win32' })).toBe(null);
  });

  it('does not pass shell:true on POSIX — pinning against a regression to shell:true everywhere', () => {
    // Both tests above pass platform:'win32', so a regression to an
    // unconditional shell:true (forbidden by the plan's global constraints:
    // a shell widens the quoting surface for no benefit on POSIX) would
    // stay green without this. Assert opts.shell is falsy off win32.
    let seenShell;
    const execFileSync = (cmd, args, opts) => {
      seenShell = opts && opts.shell;
      return '/usr/local/lib/node_modules\n';
    };
    expect(resolveNpmRootG({ execFileSync, platform: 'linux' })).toBe('/usr/local/lib/node_modules');
    expect(seenShell).toBeFalsy();
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

  // #133 R-A: doctor grading only on binary presence let a version-skewed
  // engine (right binary, wrong opencode-ai release) report green. These two
  // tests pin engineVersion landing on scanEngineInstalls' record — never on
  // listAmicusInstalls', whose fixtures above assert exact toEqual — and pin
  // that the reader is an injected dep driven by the record's own `roots`,
  // not deps.fs.readFileSync (fakeFs here implements no such method) and not
  // a direct require('fs') read (would hit the real disk against fake paths).
  test('stamps engineVersion per install from the reader injected as readEngineVersion', () => {
    const { installs } = scanEngineInstalls(baseDeps({
      ...engineSeams(),
      readAmicusMcpConfig: () => ({ command: 'npx', args: ['-y', 'amicus@latest', 'mcp'] }),
      readEngineVersion: ({ pkgDir }) => (pkgDir === GLOBAL_AMICUS ? '1.18.15' : '1.2.20'),
    }));
    const byDir = Object.fromEntries(installs.map((i) => [i.pkgDir, i]));
    expect(byDir[GLOBAL_AMICUS].engineVersion).toBe('1.18.15');
    expect(byDir[RUNNING].engineVersion).toBe('1.2.20');
    expect(byDir[npxAmicus('hashA')].engineVersion).toBe('1.2.20');
  });

  test('the injected reader receives the roots already resolved onto the record', () => {
    const seen = [];
    scanEngineInstalls(baseDeps({
      ...engineSeams(),
      readAmicusMcpConfig: () => null,
      readEngineVersion: ({ pkgDir, roots }) => { seen.push({ pkgDir, roots }); return undefined; },
    }));
    expect(seen.length).toBeGreaterThan(0);
    for (const { pkgDir, roots } of seen) {
      expect(roots).toEqual([path.join(pkgDir, 'node_modules'), path.dirname(pkgDir)]);
    }
  });

  test('leaves engineVersion undefined (never null, and always present as an own key) when it cannot be resolved', () => {
    let calls = 0;
    const { installs } = scanEngineInstalls(baseDeps({
      ...engineSeams(),
      readAmicusMcpConfig: () => null,
      readEngineVersion: () => { calls += 1; return undefined; },
    }));
    // hasOwnProperty, not just `=== undefined`, so this fails pre-implementation
    // (no engineVersion key at all) rather than passing vacuously either way.
    expect(installs.every((i) => Object.prototype.hasOwnProperty.call(i, 'engineVersion'))).toBe(true);
    expect(installs.every((i) => i.engineVersion === undefined)).toBe(true);
    expect(installs.some((i) => i.engineVersion === null)).toBe(false);
    expect(calls).toBeGreaterThan(0); // proves the injected reader was actually invoked
  });

  test('a throwing readEngineVersion is swallowed to undefined, not thrown, and does not stop the scan', () => {
    let calls = 0;
    const { installs } = scanEngineInstalls(baseDeps({
      ...engineSeams(),
      readAmicusMcpConfig: () => null,
      readEngineVersion: () => { calls += 1; throw new Error('ENOENT package.json'); },
    }));
    expect(calls).toBeGreaterThan(0);
    expect(installs.length).toBeGreaterThan(0);
    expect(installs.every((i) => i.engineVersion === undefined)).toBe(true);
  });

  // #133 R-A finding 1 (review round 2): listAmicusInstalls pushes `running`
  // first and `global` second, and its own dedupByRealpath keeps the FIRST of
  // two entries sharing a real path. So on the documented end-user
  // invocation — `amicus doctor` run from the globally-installed copy —
  // `runningPkgDir` IS `<npm root -g>/amicus`, and the separate `global`
  // record never survives dedup. Without recovering that fact, the skew
  // baseline (installs.find(kind==='global')) can never fire for exactly the
  // topology #133 was filed from. `isGlobal` recovers it in scanEngineInstalls
  // ONLY — never in listAmicusInstalls, whose output is pinned exact by
  // toEqual at :50 and :82 above (verified unchanged by the two tests there
  // still passing, unedited, after this change).
  test('stamps isGlobal on the running record when dedup collapsed it with the would-be global entry', () => {
    const SHARED = path.join('C:', 'real', 'amicus');
    const { installs } = scanEngineInstalls(baseDeps({
      ...engineSeams(),
      readAmicusMcpConfig: () => null,
      realpath: { [RUNNING]: SHARED, [GLOBAL_AMICUS]: SHARED },
    }));
    expect(installs.some((i) => i.kind === 'global')).toBe(false); // dedup still drops the separate record
    const running = installs.find((i) => i.pkgDir === RUNNING);
    expect(running.isGlobal).toBe(true);
  });

  test('does not stamp isGlobal when running and global are genuinely distinct real installs (a true dev checkout)', () => {
    const { installs } = scanEngineInstalls(baseDeps({
      ...engineSeams(),
      readAmicusMcpConfig: () => null,
      // no realpath collision — running and GLOBAL_AMICUS stay distinct
    }));
    const running = installs.find((i) => i.pkgDir === RUNNING);
    expect(running.isGlobal).toBeUndefined();
    const globalRec = installs.find((i) => i.kind === 'global');
    expect(globalRec.isGlobal).toBeUndefined(); // kind:'global' already says it; no redundant flag
  });

  test('does not stamp isGlobal on an npx-cache copy that happens not to collide with the global root', () => {
    const { installs } = scanEngineInstalls(baseDeps({
      ...engineSeams(),
      readAmicusMcpConfig: () => null,
    }));
    expect(installs.filter((i) => i.kind === 'npx').every((i) => i.isGlobal === undefined)).toBe(true);
  });
});
