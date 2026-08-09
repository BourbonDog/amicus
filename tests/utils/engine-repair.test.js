'use strict';
const path = require('path');
const { repairEngine, findDonor } = require('../../src/utils/engine-repair');

const RUNNING = path.join('C:', 'proj', 'amicus');
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

describe('findDonor', () => {
  // Ruling R-A: prefer an explicitly-`global` healthy donor over any other
  // kind. `kind !== 'running'` is the WRONG proxy for "not the dev tree":
  // listAmicusInstalls pushes `running` first and `global` second, and
  // dedupByRealpath keeps the FIRST of two entries sharing a real path. On
  // an ordinary end-user machine the running process IS the global install,
  // so the `global` record never survives dedup — that copy is labeled
  // `kind: 'running'`. A `kind !== 'running'` filter would skip that good
  // global engine and donate some other (possibly stale) healthy copy,
  // importing the exact version skew this self-heal exists to prevent.
  // Preferring `global` explicitly, falling back to listAmicusInstalls order
  // (running-first) otherwise, is correct on both topologies.
  const fs = { realpathSync: (p) => p };
  const NPX_SIBLING = path.join('C:', 'cache', '_npx', 'h2', 'node_modules', 'amicus');

  test('prefers the explicitly-global donor when both a healthy running and a healthy global are present', () => {
    const installs = [
      { kind: 'running', pkgDir: RUNNING, engineOk: true },
      { kind: 'global', pkgDir: DONOR, engineOk: true },
    ];
    const donor = findDonor({ installs, destPkgDir: DEST, fs });
    expect(donor.kind).toBe('global');
    expect(donor.pkgDir).toBe(DONOR);
  });

  test('falls back to the running donor when it is the only healthy copy present', () => {
    const installs = [
      { kind: 'running', pkgDir: RUNNING, engineOk: true },
    ];
    const donor = findDonor({ installs, destPkgDir: DEST, fs });
    expect(donor.kind).toBe('running');
    expect(donor.pkgDir).toBe(RUNNING);
  });

  test('running-that-is-really-global (no separate global record) wins over a healthy npx sibling', () => {
    // Simulates the dedup outcome on an end-user machine: running IS global,
    // so there is no separate `global` entry — only `running` plus whatever
    // npx-cache copies exist. A `kind !== 'running'` proxy would wrongly
    // donate the npx sibling (possibly stale) instead of the good running
    // copy. destPkgDir is a THIRD, broken npx copy being repaired.
    const installs = [
      { kind: 'running', pkgDir: RUNNING, engineOk: true },
      { kind: 'npx', pkgDir: NPX_SIBLING, engineOk: true },
    ];
    const donor = findDonor({ installs, destPkgDir: DEST, fs });
    expect(donor.kind).toBe('running');
    expect(donor.pkgDir).toBe(RUNNING);
  });

  // R-A residual hole (reviewer finding, closed by this task's engineVersion
  // field): on a machine with a dev checkout, NO npm-global amicus install, a
  // broken npx destination, and a healthy npx sibling, no record has
  // kind:'global' — the old kind-only rule fell through to healthy[0], i.e.
  // the running dev tree, and could donate a version-skewed dev engine. Once
  // engineVersion exists, ranking healthy donors by version (highest first)
  // must win over the kind-based fallback so the newer sibling is chosen
  // instead. Before this task's findDonor change, this test fails: the old
  // code returns `healthy[0]` unconditionally (kind fallback, ignoring
  // version), i.e. the OLDER running dev tree — not the sibling.
  test('ranks by engineVersion over the kind-based fallback: a newer healthy npx sibling beats an older running dev tree', () => {
    const installs = [
      { kind: 'running', pkgDir: RUNNING, engineOk: true, engineVersion: '1.2.20' }, // dev tree, older
      { kind: 'npx', pkgDir: NPX_SIBLING, engineOk: true, engineVersion: '1.18.15' }, // healthy sibling, newer
      // destPkgDir itself: broken npx copy being repaired — excluded via engineOk:false anyway.
    ];
    const donor = findDonor({ installs, destPkgDir: DEST, fs });
    expect(donor.kind).toBe('npx');
    expect(donor.pkgDir).toBe(NPX_SIBLING);
  });

  test('a tie on engineVersion falls back to the kind-based rule (global preferred)', () => {
    const installs = [
      { kind: 'running', pkgDir: RUNNING, engineOk: true, engineVersion: '1.18.15' },
      { kind: 'global', pkgDir: DONOR, engineOk: true, engineVersion: '1.18.15' },
    ];
    const donor = findDonor({ installs, destPkgDir: DEST, fs });
    expect(donor.kind).toBe('global');
  });

  test('a non-semver engineVersion is treated as absent (sorts last, never throws)', () => {
    const installs = [
      { kind: 'running', pkgDir: RUNNING, engineOk: true, engineVersion: 'not-a-version' },
      { kind: 'npx', pkgDir: NPX_SIBLING, engineOk: true, engineVersion: '1.18.15' },
    ];
    expect(() => findDonor({ installs, destPkgDir: DEST, fs })).not.toThrow();
    const donor = findDonor({ installs, destPkgDir: DEST, fs });
    expect(donor.pkgDir).toBe(NPX_SIBLING);
  });
});
