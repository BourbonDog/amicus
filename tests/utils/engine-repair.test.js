'use strict';
const path = require('path');
const { repairEngine } = require('../../src/utils/engine-repair');

const DEST = path.join('C:', 'cache', '_npx', 'h1', 'node_modules', 'amicus');
const DEST_NM = path.join(DEST, 'node_modules');
const DONOR = path.join('C:', 'global', 'node_modules', 'amicus');
const DONOR_NM = path.join(DONOR, 'node_modules'); // donor engine lives nested

const OPENCODE_DIRS = ['opencode-ai', 'opencode-windows-x64', 'opencode-windows-x64-baseline'];

// Fake fs: readdir seeded per dir; cpSync + mkdirSync recorded; realpath identity.
function makeFakeFs({ onCopyIntoDest } = {}) {
  const rd = {
    [path.normalize(DONOR_NM)]: [...OPENCODE_DIRS, '.bin', 'other-dep'],
    [path.normalize(path.join(DONOR_NM, '.bin'))]: ['opencode', 'opencode.cmd'],
  };
  const cpCalls = [];
  const mkdirCalls = [];
  return {
    cpCalls,
    mkdirCalls,
    fs: {
      readdirSync: (p) => { const v = rd[path.normalize(p)]; if (!v) { throw new Error(`ENOENT ${p}`); } return v; },
      mkdirSync: (p) => { mkdirCalls.push(path.normalize(p)); },
      cpSync: (src, dst) => {
        cpCalls.push({ src: path.normalize(src), dst: path.normalize(dst) });
        if (onCopyIntoDest && path.normalize(dst).startsWith(path.normalize(DEST_NM))) { onCopyIntoDest(); }
      },
      realpathSync: (p) => p,
      existsSync: () => false,
    },
  };
}

// installs double: dest broken (running), donor healthy (global).
const installs = [
  { kind: 'running', pkgDir: DEST, engineOk: false, roots: [] },
  { kind: 'global', pkgDir: DONOR, engineOk: true, roots: [] },
];
const opencodeRoots = ({ pkgDir }) => [path.join(pkgDir, 'node_modules'), path.dirname(pkgDir)];

// hasOpencodeBinary double: donor healthy (engine nested); dest healthy only after copy.
function makeHas(destHealedRef) {
  return ({ pkgDir, nodeModulesRoot }) => {
    if (nodeModulesRoot) { return path.normalize(nodeModulesRoot) === path.normalize(DONOR_NM); }
    if (path.normalize(pkgDir) === path.normalize(DONOR)) { return true; }
    if (path.normalize(pkgDir) === path.normalize(DEST)) { return destHealedRef.v; }
    return false;
  };
}

function baseDeps(overrides = {}) {
  const healed = { v: false };
  const { fs, cpCalls, mkdirCalls } = makeFakeFs({ onCopyIntoDest: () => { healed.v = true; } });
  const lock = { release: jest.fn() };
  const acquireLock = jest.fn(() => lock);
  return {
    healed, cpCalls, mkdirCalls, lock, acquireLock,
    deps: {
      fs,
      scanEngineInstalls: () => ({ installs, mcpLaunch: 'npx' }),
      hasOpencodeBinary: makeHas(healed),
      opencodeRoots,
      acquireLock,
      ...overrides,
    },
  };
}

describe('repairEngine', () => {
  test('copies every opencode-* dir + .bin shims donor→dest and reports repaired', async () => {
    const PATH0 = process.env.PATH;
    const b = baseDeps();
    const r = await repairEngine({ destPkgDir: DEST, deps: b.deps });

    expect(r.repaired).toBe(true);
    expect(path.normalize(r.donor)).toBe(path.normalize(DONOR));
    expect(r.copied).toEqual(expect.arrayContaining([
      'opencode-ai', 'opencode-windows-x64', 'opencode-windows-x64-baseline',
      path.join('.bin', 'opencode'), path.join('.bin', 'opencode.cmd'),
    ]));
    expect(r.copied).not.toContain('other-dep');
    // Copied FROM the donor nested root INTO the dest nested root.
    const win = b.cpCalls.find((c) => c.dst.endsWith(path.normalize(path.join('node_modules', 'opencode-windows-x64'))));
    expect(win.src).toBe(path.normalize(path.join(DONOR_NM, 'opencode-windows-x64')));
    expect(win.dst).toBe(path.normalize(path.join(DEST_NM, 'opencode-windows-x64')));
    // Locked on the destination, released after.
    expect(b.acquireLock).toHaveBeenCalledWith({ pkgDir: DEST });
    expect(b.lock.release).toHaveBeenCalled();
    // repairEngine is pure copy — it must not mutate PATH.
    expect(process.env.PATH).toBe(PATH0);
  });

  test('picks the HOISTED donor root when that is where the engine lives', async () => {
    const b = baseDeps({
      // engine now lives at the donor's hoisted root, not nested
      hasOpencodeBinary: ({ pkgDir, nodeModulesRoot }) => {
        if (nodeModulesRoot) { return path.normalize(nodeModulesRoot) === path.normalize(path.dirname(DONOR)); }
        if (path.normalize(pkgDir) === path.normalize(DONOR)) { return true; }
        return b.healed.v; // dest
      },
    });
    // seed the hoisted root's listing
    b.deps.fs.readdirSync = (p) => {
      if (path.normalize(p) === path.normalize(path.dirname(DONOR))) { return ['opencode-windows-x64']; }
      throw new Error(`ENOENT ${p}`);
    };
    const r = await repairEngine({ destPkgDir: DEST, deps: b.deps });
    expect(r.repaired).toBe(true);
    const win = b.cpCalls.find((c) => c.dst.endsWith(path.normalize(path.join('node_modules', 'opencode-windows-x64'))));
    expect(win.src).toBe(path.normalize(path.join(path.dirname(DONOR), 'opencode-windows-x64')));
  });

  test('no healthy sibling → repaired:false with a reason, nothing copied', async () => {
    const b = baseDeps({ scanEngineInstalls: () => ({ installs: [installs[0]], mcpLaunch: 'npx' }) });
    const r = await repairEngine({ destPkgDir: DEST, deps: b.deps });
    expect(r.repaired).toBe(false);
    expect(r.reason).toMatch(/no healthy sibling/i);
    expect(b.cpCalls).toHaveLength(0);
  });

  test('already healthy dest short-circuits without scanning or copying', async () => {
    const scan = jest.fn(() => ({ installs, mcpLaunch: 'npx' }));
    const b = baseDeps({ scanEngineInstalls: scan, hasOpencodeBinary: () => true });
    const r = await repairEngine({ destPkgDir: DEST, deps: b.deps });
    expect(r).toEqual({ repaired: true });
    expect(scan).not.toHaveBeenCalled();
    expect(b.cpCalls).toHaveLength(0);
  });

  test('lock contention (EEXIST) → repaired:false, contended:true, nothing copied', async () => {
    const b = baseDeps({
      acquireLock: () => { const e = new Error('held'); e.code = 'EEXIST'; throw e; },
    });
    const r = await repairEngine({ destPkgDir: DEST, deps: b.deps });
    expect(r.repaired).toBe(false);
    expect(r.contended).toBe(true);
    expect(b.cpCalls).toHaveLength(0);
  });

  test('a cpSync failure → repaired:false with a reason, and the lock is released', async () => {
    const b = baseDeps();
    b.deps.fs.cpSync = () => { throw new Error('EBUSY'); };
    const r = await repairEngine({ destPkgDir: DEST, deps: b.deps });
    expect(r.repaired).toBe(false);
    expect(r.reason).toMatch(/copy failed/i);
    expect(b.lock.release).toHaveBeenCalled();
  });
});
