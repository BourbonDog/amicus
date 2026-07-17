# Engine Self-Heal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the opencode engine binary is missing at server start, self-heal in place by copying the `opencode-*` packages from a healthy sibling amicus install instead of throwing — and let `amicus doctor --fix` repair broken npx-cache copies proactively.

**Architecture:** Mirror the existing Electron self-heal triad with three new `src/utils/` modules — `engine-lock.js` (cross-process stale-aware lock), `engine-repair.js` (pure copy primitive), `engine-ensure.js` (in-process single-flight wrapper). Wire `ensureEngine()` into `opencode-client.startServer` before its missing-binary throw, and add an async fix-aware `evaluateEngineMcp()` to the doctor engine check. The repair copies from a same-machine donor (running/global/npx), so no network and a guaranteed platform match.

**Tech Stack:** Node.js (CommonJS `require`), Jest (unit tests, injected seams / fake fs — never real fs or network), ESLint. `fs.cpSync` for cross-platform recursive copy.

## Global Constraints

- **Node floor:** `>=22.12.0` (package.json `engines`). `fs.cpSync` is available — use it for recursive copy.
- **File size:** no file > 300 lines; no function > 50 lines (pre-commit `check-file-sizes.js` blocks violations).
- **ESM/CJS:** `src/` uses CommonJS (`require`/`module.exports`), `'use strict';` at top of new files. The `@opencode-ai/sdk` is ESM and loaded via dynamic `import()` elsewhere — do not `require` it.
- **Tests:** TDD, RED before GREEN. All fs/lock/scan behind injected seams. **Colon-free fixtures** — never put a literal `:` or `;` PATH-delimiter in a test; use `path.join` / `path.delimiter`. (Dev is Windows, CI is Linux; a green Windows run can still fail POSIX CI.)
- **Copy strategy:** copy from a healthy sibling — never re-fetch / re-run the opencode postinstall (the flaky optional-dependency trap the `startServer` guard warns about).
- **Docs sync (HARD RULE):** any commit that adds a `src/` file must update CLAUDE.md in the same commit. The pre-commit hook runs `generate-docs.js`, which regenerates the auto sections from each file's JSDoc header and **auto-stages CLAUDE.md** — so give every new file a `/** @module ... */` header and let the hook fold CLAUDE.md into your commit.
- **Commit trailer:** end every commit message with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Test runner:** run a single test file with `npx jest <path>`; full unit suite with `npm test`; lint with `npm run lint`.

---

### Task 1: `engine-lock.js` — cross-process stale-aware repair lock

**Files:**
- Create: `src/utils/engine-lock.js`
- Test: `tests/utils/engine-lock.test.js`

**Interfaces:**
- Consumes: nothing (leaf module; `fs`, `os`, `path` only).
- Produces: `acquireRepairLock({ pkgDir, fs? }) → { release():void }` (throws an `EEXIST`-coded error on live contention); `isStaleLock(lockPath, fs?, now?) → boolean`; `lockPathFor(pkgDir) → string`; `STALE_MS` (number).

- [ ] **Step 1: Write the failing test**

Create `tests/utils/engine-lock.test.js` (mirrors `tests/sidecar/electron-lock.test.js`, keyed by `pkgDir`, real fs in the OS tmpdir so cases never collide):

```js
// tests/utils/engine-lock.test.js
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  acquireRepairLock, isStaleLock, lockPathFor, STALE_MS,
} = require('../../src/utils/engine-lock');

describe('engine-lock (stale-aware single-flight)', () => {
  let pkgDir;
  let lockPath;

  beforeEach(() => {
    pkgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-engine-lock-test-'));
    lockPath = lockPathFor(pkgDir);
  });

  afterEach(() => {
    try { fs.rmSync(lockPath, { force: true }); } catch { /* ignore */ }
    try { fs.rmSync(pkgDir, { recursive: true, force: true }); } catch { /* ignore */ }
    jest.restoreAllMocks();
  });

  const writeLock = (obj) => fs.writeFileSync(lockPath, typeof obj === 'string' ? obj : JSON.stringify(obj));

  describe('isStaleLock', () => {
    it('an empty / corrupt lockfile is stale', () => {
      writeLock('');
      expect(isStaleLock(lockPath, fs)).toBe(true);
      writeLock('not json {{{');
      expect(isStaleLock(lockPath, fs)).toBe(true);
    });

    it('a too-old lock is stale even if its pid is alive', () => {
      writeLock({ pid: process.pid, at: Date.now() - STALE_MS - 1000 });
      expect(isStaleLock(lockPath, fs)).toBe(true);
    });

    it('a recent lock held by THIS live process is NOT stale', () => {
      writeLock({ pid: process.pid, at: Date.now() });
      expect(isStaleLock(lockPath, fs)).toBe(false);
    });

    it('a recent lock whose holder is GONE (ESRCH) is stale', () => {
      jest.spyOn(process, 'kill').mockImplementation(() => {
        const e = new Error('gone'); e.code = 'ESRCH'; throw e;
      });
      writeLock({ pid: 424242, at: Date.now() });
      expect(isStaleLock(lockPath, fs)).toBe(true);
    });

    it('an absent lockfile is not stale', () => {
      expect(isStaleLock(lockPath, fs)).toBe(false);
    });
  });

  describe('acquireRepairLock', () => {
    it('acquires when none exists (records pid+at) and releases cleanly', () => {
      const lock = acquireRepairLock({ pkgDir, fs });
      expect(fs.existsSync(lockPath)).toBe(true);
      const meta = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
      expect(meta.pid).toBe(process.pid);
      expect(typeof meta.at).toBe('number');
      lock.release();
      expect(fs.existsSync(lockPath)).toBe(false);
    });

    it('STEALS an orphaned empty lock and acquires', () => {
      writeLock('');
      const lock = acquireRepairLock({ pkgDir, fs });
      expect(JSON.parse(fs.readFileSync(lockPath, 'utf-8')).pid).toBe(process.pid);
      lock.release();
    });

    it('THROWS EEXIST when a live, recent process holds the lock', () => {
      writeLock({ pid: process.pid, at: Date.now() });
      let err;
      try { acquireRepairLock({ pkgDir, fs }); } catch (e) { err = e; }
      expect(err).toBeDefined();
      expect(err.code).toBe('EEXIST');
      expect(fs.existsSync(lockPath)).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/utils/engine-lock.test.js`
Expected: FAIL — `Cannot find module '../../src/utils/engine-lock'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/utils/engine-lock.js`:

```js
/**
 * @module utils/engine-lock
 * Stale-aware single-flight lock for the engine self-heal (report #2).
 *
 * Only one process may copy the opencode engine into a given install at a time:
 * the report saw multiple live MCP processes, so two could self-heal the SAME
 * npx-cache copy at once and a leg could spawn a half-written opencode.exe. The
 * lock is a file in the OS temp dir keyed by the destination pkgDir, recording
 * the holder PID + timestamp so a LATER caller can detect and STEAL a lock
 * orphaned by a killed/crashed repair rather than wedging every future repair.
 * Mirrors src/sidecar/electron-lock.js (kept separate so the shipped GUI heal is
 * never touched).
 */

'use strict';

const fsDefault = require('fs');
const path = require('path');
const os = require('os');

/** A real engine copy (a few tens of MB) finishes well within this. */
const STALE_MS = 15 * 60 * 1000;

/** Temp-dir lockfile path, keyed by the destination install dir. */
function lockPathFor(pkgDir) {
  const key = Buffer.from(pkgDir).toString('hex').slice(0, 16);
  return path.join(os.tmpdir(), `amicus-engine-repair-${key}.lock`);
}

/**
 * Is an existing lockfile orphaned? Stale when it predates STALE_MS, its holder
 * process is gone (ESRCH), or it is empty / corrupt. A lock held by a live,
 * recent process is NOT stale (real contention).
 * @returns {boolean}
 */
function isStaleLock(lockPath, fs = fsDefault, now = Date.now()) {
  let raw;
  try {
    raw = fs.readFileSync(lockPath, 'utf-8');
  } catch {
    return false; // already gone — absent, not stale
  }
  let meta;
  try {
    meta = JSON.parse(raw);
  } catch {
    return true; // empty / corrupt -> orphaned
  }
  if (typeof meta.at === 'number' && now - meta.at > STALE_MS) {
    return true;
  }
  if (typeof meta.pid === 'number') {
    try {
      process.kill(meta.pid, 0); // throws if the process is gone
      return false; // holder alive
    } catch (err) {
      return !!(err && err.code === 'ESRCH'); // ESRCH => dead; EPERM => alive
    }
  }
  return true;
}

/**
 * Acquire the single-flight repair lock. Throws an EEXIST-coded error ONLY when
 * a live, recent process genuinely holds it; otherwise steals an orphaned lock.
 * @param {{pkgDir:string, fs?:object}} opts
 * @returns {{ release: () => void }}
 */
function acquireRepairLock({ pkgDir, fs = fsDefault }) {
  const lockPath = lockPathFor(pkgDir);

  function create() {
    // Atomic exclusive create WITH content: never observable empty. 'wx' throws
    // EEXIST if held.
    fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, at: Date.now() }), { flag: 'wx' });
  }

  try {
    create();
  } catch (e) {
    if (!e || e.code !== 'EEXIST') { throw e; }
    if (!isStaleLock(lockPath, fs)) { throw e; } // live holder -> honest contention
    try { fs.rmSync(lockPath, { force: true }); } catch { /* ignore */ }
    create();
  }

  return {
    release() {
      try { fs.rmSync(lockPath, { force: true }); } catch { /* ignore */ }
    },
  };
}

module.exports = { acquireRepairLock, isStaleLock, lockPathFor, STALE_MS };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/utils/engine-lock.test.js`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

The pre-commit hook regenerates CLAUDE.md (new module) and auto-stages it into this commit.

```bash
git add src/utils/engine-lock.js tests/utils/engine-lock.test.js
git commit -m "$(cat <<'EOF'
feat(engine): stale-aware cross-process lock for engine self-heal (report #2)

Mirror of electron-lock, keyed by the destination pkgDir, so two MCP
processes can't copy the engine into the same npx copy at once.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `engine-repair.js` — pure copy-from-sibling primitive

**Files:**
- Create: `src/utils/engine-repair.js`
- Test: `tests/utils/engine-repair.test.js`

**Interfaces:**
- Consumes: `engine-lock.acquireRepairLock` (Task 1); `path-setup.hasOpencodeBinary({pkgDir?|nodeModulesRoot?, fs?})` and `path-setup.opencodeRoots({pkgDir}) → string[]`; `engine-install-scan.scanEngineInstalls() → { installs: Array<{kind,pkgDir,engineOk,roots}>, mcpLaunch }`.
- Produces: `repairEngine({ destPkgDir?, deps? }) → Promise<{repaired:boolean, reason?:string, contended?:boolean, donor?:string, copied?:string[]}>` — never throws; `runningPkgDir()`; helper exports `findDonor`, `engineSourceRoot`, `copyEnginePackages`.

- [ ] **Step 1: Write the failing test**

Create `tests/utils/engine-repair.test.js`. A fake fs (colon-free, `path.join`-built fixtures) drives `readdirSync`/`cpSync`; injected `hasOpencodeBinary` flips the destination healthy once a copy lands:

```js
// tests/utils/engine-repair.test.js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/utils/engine-repair.test.js`
Expected: FAIL — `Cannot find module '../../src/utils/engine-repair'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/utils/engine-repair.js`:

```js
/**
 * @module utils/engine-repair
 * Engine self-heal primitive (report #2): make the opencode engine present ON
 * DISK in a target amicus install by COPYING the opencode-* packages from a
 * healthy sibling install (running/global/npx). No network, and the donor is on
 * the same machine so its platform binaries match — unlike re-running the
 * opencode postinstall, the flaky optional-dependency trap the startServer guard
 * warns about.
 *
 * PURE copy — no PATH mutation — so it is targetable at ANY copy: the runtime
 * path (engine-ensure) repairs the RUNNING copy; `amicus doctor --fix` repairs a
 * foreign broken npx copy. Everything is injectable so tests never touch the real
 * fs. Mirrors the Electron self-heal primitive (src/sidecar/electron-install.js).
 */

'use strict';

const fsDefault = require('fs');
const path = require('path');

/** The running amicus package root (this file lives in <pkg>/src/utils). */
function runningPkgDir() {
  return path.join(__dirname, '..', '..');
}

/** First healthy install whose real path differs from the destination. */
function findDonor({ installs, destPkgDir, fs }) {
  const norm = (p) => { try { return path.normalize(fs.realpathSync(p)); } catch { return path.normalize(p); } };
  const destReal = norm(destPkgDir);
  return installs.find((i) => i.engineOk && norm(i.pkgDir) !== destReal) || null;
}

/** The donor root (nested or hoisted) that actually holds the engine binary. */
function engineSourceRoot({ donorPkgDir, hasOpencodeBinary, opencodeRoots, fs }) {
  for (const root of opencodeRoots({ pkgDir: donorPkgDir })) {
    if (hasOpencodeBinary({ nodeModulesRoot: root, fs })) { return root; }
  }
  return null;
}

/** Copy every opencode-* package dir + the .bin/opencode* shims source→dest. */
function copyEnginePackages({ sourceRoot, destRoot, fs }) {
  const copied = [];
  fs.mkdirSync(destRoot, { recursive: true });
  for (const name of fs.readdirSync(sourceRoot)) {
    if (!name.startsWith('opencode-')) { continue; }
    fs.cpSync(path.join(sourceRoot, name), path.join(destRoot, name), { recursive: true, force: true });
    copied.push(name);
  }
  // The engine resolver checks <root>/.bin/opencode on non-Windows, so carry the
  // shims across too (relative symlinks resolve against the copied opencode-ai).
  const srcBin = path.join(sourceRoot, '.bin');
  let shims = [];
  try { shims = fs.readdirSync(srcBin).filter((n) => n.startsWith('opencode')); } catch { shims = []; }
  if (shims.length) {
    const dstBin = path.join(destRoot, '.bin');
    fs.mkdirSync(dstBin, { recursive: true });
    for (const n of shims) {
      fs.cpSync(path.join(srcBin, n), path.join(dstBin, n), { recursive: true, force: true });
      copied.push(path.join('.bin', n));
    }
  }
  return copied;
}

/**
 * Copy the opencode engine into destPkgDir from a healthy sibling install.
 * Never throws — every failure mode is a {repaired:false, ...} document.
 *
 * @param {object} [opts]
 * @param {string} [opts.destPkgDir] install to repair (default: running copy)
 * @param {object} [opts.deps] injected { fs, scanEngineInstalls, hasOpencodeBinary, opencodeRoots, acquireLock }
 * @returns {Promise<{repaired:boolean, reason?:string, contended?:boolean, donor?:string, copied?:string[]}>}
 */
async function repairEngine({ destPkgDir = runningPkgDir(), deps = {} } = {}) {
  const fs = deps.fs || fsDefault;
  const scanEngineInstalls = deps.scanEngineInstalls
    || (() => require('./engine-install-scan').scanEngineInstalls());
  const hasOpencodeBinary = deps.hasOpencodeBinary || require('./path-setup').hasOpencodeBinary;
  const opencodeRoots = deps.opencodeRoots || require('./path-setup').opencodeRoots;
  const acquireLock = deps.acquireLock
    || ((o) => require('./engine-lock').acquireRepairLock({ ...o, fs }));

  // Already healthy — nothing to do (ensureEngine fast-paths, but doctor --fix
  // may call us directly on a copy a prior leg already healed).
  if (hasOpencodeBinary({ pkgDir: destPkgDir, fs })) {
    return { repaired: true };
  }

  const { installs } = scanEngineInstalls();
  const donor = findDonor({ installs, destPkgDir, fs });
  if (!donor) {
    return { repaired: false, reason: 'no healthy sibling install to copy the engine from' };
  }

  const sourceRoot = engineSourceRoot({ donorPkgDir: donor.pkgDir, hasOpencodeBinary, opencodeRoots, fs });
  if (!sourceRoot) {
    return { repaired: false, reason: `donor ${donor.pkgDir} has no resolvable engine root` };
  }

  let lock;
  try {
    lock = acquireLock({ pkgDir: destPkgDir });
  } catch (e) {
    if (e && e.code === 'EEXIST') {
      return { repaired: false, contended: true, reason: 'another engine repair is in progress' };
    }
    return { repaired: false, reason: `could not acquire repair lock: ${e && e.message}` };
  }

  try {
    const destRoot = path.join(destPkgDir, 'node_modules');
    const copied = copyEnginePackages({ sourceRoot, destRoot, fs });
    const repaired = !!hasOpencodeBinary({ pkgDir: destPkgDir, fs });
    return repaired
      ? { repaired: true, donor: donor.pkgDir, copied }
      : { repaired: false, reason: 'engine still missing after copy', donor: donor.pkgDir, copied };
  } catch (e) {
    return { repaired: false, reason: `engine copy failed: ${e && e.message}` };
  } finally {
    try { lock.release(); } catch { /* ignore */ }
  }
}

module.exports = { repairEngine, findDonor, engineSourceRoot, copyEnginePackages, runningPkgDir };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/utils/engine-repair.test.js`
Expected: PASS (6 cases green).

- [ ] **Step 5: Commit**

```bash
git add src/utils/engine-repair.js tests/utils/engine-repair.test.js
git commit -m "$(cat <<'EOF'
feat(engine): copy-from-sibling engine repair primitive (report #2)

repairEngine copies opencode-* packages (and .bin shims) from a healthy
running/global/npx install into a broken copy under the engine-lock, then
re-checks. Pure copy, no PATH mutation, never throws.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `engine-ensure.js` — in-process single-flight wrapper

**Files:**
- Create: `src/utils/engine-ensure.js`
- Test: `tests/utils/engine-ensure.test.js`

**Interfaces:**
- Consumes: `path-setup.hasOpencodeBinary()`, `path-setup.ensureNodeModulesBinInPath()`; `engine-repair.repairEngine({destPkgDir?}) → Promise<{repaired,reason?,donor?}>` (Task 2).
- Produces: `ensureEngine({ deps?, repairOptions? }) → Promise<{ok:boolean, reason?:string, donor?:string}>`; `_resetEnsureEngine()` (test-only). Injected `deps`: `{ hasOpencodeBinary, repairEngine, ensurePath, logProgress }`.

- [ ] **Step 1: Write the failing test**

Create `tests/utils/engine-ensure.test.js` (mirrors `tests/ensure-electron.test.js`):

```js
// tests/utils/engine-ensure.test.js
'use strict';
const ee = require('../../src/utils/engine-ensure');

beforeEach(() => { ee._resetEnsureEngine(); });

const noop = () => {};

describe('ensureEngine — fast path', () => {
  test('already present → ok:true, repairEngine NOT called', async () => {
    const repairEngine = jest.fn();
    const r = await ee.ensureEngine({
      deps: { hasOpencodeBinary: () => true, repairEngine, ensurePath: noop, logProgress: noop },
    });
    expect(r).toEqual({ ok: true });
    expect(repairEngine).not.toHaveBeenCalled();
  });
});

describe('ensureEngine — self-heal path', () => {
  test('missing → repairs, refreshes PATH, re-checks → ok:true with donor', async () => {
    let present = false;
    const ensurePath = jest.fn();
    const repairEngine = jest.fn(async () => { present = true; return { repaired: true, donor: 'C:/global/amicus' }; });
    const r = await ee.ensureEngine({
      deps: { hasOpencodeBinary: () => present, repairEngine, ensurePath, logProgress: noop },
    });
    expect(repairEngine).toHaveBeenCalledTimes(1);
    expect(ensurePath).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ ok: true, donor: 'C:/global/amicus' });
  });

  test('repair does not restore the binary → ok:false with the repair reason', async () => {
    const repairEngine = jest.fn(async () => ({ repaired: false, reason: 'no healthy sibling install to copy the engine from' }));
    const r = await ee.ensureEngine({
      deps: { hasOpencodeBinary: () => false, repairEngine, ensurePath: noop, logProgress: noop },
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/no healthy sibling/i);
  });

  test('a thrown repairEngine → ok:false with a reason (never rejects)', async () => {
    const repairEngine = jest.fn(async () => { throw new Error('boom'); });
    const r = await ee.ensureEngine({
      deps: { hasOpencodeBinary: () => false, repairEngine, ensurePath: noop, logProgress: noop },
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/boom/);
  });
});

describe('ensureEngine — single-flight', () => {
  test('concurrent calls share ONE repair', async () => {
    let present = false;
    let release;
    const repairEngine = jest.fn(() => new Promise((res) => { release = () => { present = true; res({ repaired: true }); }; }));
    const deps = { hasOpencodeBinary: () => present, repairEngine, ensurePath: noop, logProgress: noop };
    const p1 = ee.ensureEngine({ deps });
    const p2 = ee.ensureEngine({ deps });
    release();
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(repairEngine).toHaveBeenCalledTimes(1);
  });

  test('a FAILED repair is not memoized — a later call retries', async () => {
    let present = false;
    const repairEngine = jest.fn()
      .mockImplementationOnce(async () => ({ repaired: false, reason: 'no donor' }))
      .mockImplementationOnce(async () => { present = true; return { repaired: true }; });
    const deps = { hasOpencodeBinary: () => present, repairEngine, ensurePath: noop, logProgress: noop };
    const first = await ee.ensureEngine({ deps });
    expect(first.ok).toBe(false);
    const second = await ee.ensureEngine({ deps });
    expect(second.ok).toBe(true);
    expect(repairEngine).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/utils/engine-ensure.test.js`
Expected: FAIL — `Cannot find module '../../src/utils/engine-ensure'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/utils/engine-ensure.js`:

```js
/**
 * @module utils/engine-ensure
 * ensureEngine() — runtime engine self-heal at server start (report #2).
 *
 * The single-flight wrapper opencode-client.startServer calls when the engine
 * binary is missing: fast-path hasOpencodeBinary(); otherwise copy the engine
 * from a healthy sibling install via engine-repair, refresh PATH, and re-check.
 * A module-level promise stops concurrent fanout-leg server starts in one
 * process from re-copying. Only success is memoized; a failed attempt clears the
 * guard so a later call may retry. Mirrors src/sidecar/electron-ensure.js.
 */

'use strict';

const { hasOpencodeBinary: defaultHas } = require('./path-setup');

let _ensurePromise = null;

/** Test-only: clear the single-flight guard so each test starts clean. */
function _resetEnsureEngine() {
  _ensurePromise = null;
}

/**
 * Ensure the opencode engine is present, self-healing by copy if missing.
 * @param {object} [opts]
 * @param {object} [opts.deps] injected { hasOpencodeBinary, repairEngine, ensurePath, logProgress }
 * @param {object} [opts.repairOptions] forwarded to repairEngine (destPkgDir, etc.)
 * @returns {Promise<{ok:boolean, reason?:string, donor?:string}>}
 */
function ensureEngine({ deps = {}, repairOptions = {} } = {}) {
  const has = deps.hasOpencodeBinary || defaultHas;
  const repair = deps.repairEngine || ((o) => require('./engine-repair').repairEngine(o));
  const ensurePath = deps.ensurePath || require('./path-setup').ensureNodeModulesBinInPath;
  const logProgress = deps.logProgress
    || ((msg) => { try { process.stderr.write(`${msg}\n`); } catch { /* ignore */ } });

  // Fast path: already present. Cheap disk stat — safe every call.
  if (has()) { return Promise.resolve({ ok: true }); }

  // Single-flight: reuse an in-flight repair.
  if (_ensurePromise) { return _ensurePromise; }

  _ensurePromise = (async () => {
    logProgress('[amicus] OpenCode engine missing — self-healing by copying from a healthy install...');
    let result;
    try {
      result = await repair({ ...repairOptions });
    } catch (err) {
      return { ok: false, reason: `engine self-heal failed: ${err && err.message}` };
    }
    if (has()) {
      logProgress('[amicus] OpenCode engine restored.');
      return { ok: true, donor: result && result.donor };
    }
    return { ok: false, reason: (result && result.reason) || 'engine self-heal did not restore the binary' };
  })().then((r) => {
    if (r.ok) {
      try { ensurePath(); } catch { /* ignore */ } // refresh PATH so spawn('opencode') resolves
    } else {
      _ensurePromise = null; // failure is not memoized — a later call may retry
    }
    return r;
  }, (err) => {
    _ensurePromise = null;
    throw err;
  });

  return _ensurePromise;
}

module.exports = { ensureEngine, _resetEnsureEngine };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/utils/engine-ensure.test.js`
Expected: PASS.

Note: `ensureEngine` returns `{ ok: true, donor: undefined }` when a repair reports no donor field. The success-with-donor test asserts a concrete donor; the fast-path test asserts exactly `{ ok: true }` (no repair ran, so no donor key is added — the fast path returns the literal `{ ok: true }`).

- [ ] **Step 5: Commit**

```bash
git add src/utils/engine-ensure.js tests/utils/engine-ensure.test.js
git commit -m "$(cat <<'EOF'
feat(engine): single-flight ensureEngine wrapper for runtime self-heal (report #2)

Fast-path hasOpencodeBinary; else copy via repairEngine, refresh PATH,
re-check. Memoizes success only; a failed heal is retryable.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Wire `ensureEngine` into `startServer`

**Files:**
- Modify: `src/opencode-client.js:627-644` (the `startServer` missing-binary guard)
- Test: `tests/opencode-client-engine-missing.test.js` (update existing cases + add self-heal cases)

**Interfaces:**
- Consumes: `engine-ensure.ensureEngine() → Promise<{ok, reason?}>` (Task 3).
- Produces: no new exports. New `startServer` option seam `_ensureEngine` (alongside existing `_hasOpencodeBinary`, `_opencodeRoots`). Behaviour: when the binary is missing, `await ensureEngine()`; only if it returns `{ok:false}` does `startServer` throw `${HINTS.engineMissing} Searched: <roots>[ (self-heal: <reason>)]`.

- [ ] **Step 1: Write the failing test**

Edit `tests/opencode-client-engine-missing.test.js`. First, update the FOUR existing `startServer({ _hasOpencodeBinary: () => false })` calls (lines ~29, ~37, ~46-48, ~55) so self-heal is stubbed to fail — otherwise they now invoke the real `ensureEngine`. Add `_ensureEngine: async () => ({ ok: false })` to each existing call, e.g.:

```js
  test('throws a CLEAR actionable error (not a bare ENOENT) when the binary is absent', async () => {
    await expect(
      startServer({ _hasOpencodeBinary: () => false, _ensureEngine: async () => ({ ok: false }) })
    ).rejects.toThrow(/OpenCode engine binary not found/i);
  });
```

Apply the same `_ensureEngine: async () => ({ ok: false })` addition to the other three existing tests (the remediation-message test, the fails-fast test, and the searched-roots test).

Then append two new cases:

```js
describe('startServer — engine self-heal', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('when self-heal succeeds, the missing-binary guard is passed (no engine-missing throw)', async () => {
    const ensureEngine = jest.fn(async () => ({ ok: true }));
    let err;
    try {
      await startServer({ _hasOpencodeBinary: () => false, _ensureEngine: ensureEngine });
    } catch (e) { err = e; }
    expect(ensureEngine).toHaveBeenCalledTimes(1);
    // Past the guard: any error now is the mocked SDK spawn, never engineMissing.
    expect(err && err.message).not.toMatch(/OpenCode engine binary not found/i);
    expect(mockCreateOpencodeServer).toHaveBeenCalled();
  });

  test('when self-heal fails, the thrown error carries the self-heal reason', async () => {
    let err;
    try {
      await startServer({
        _hasOpencodeBinary: () => false,
        _ensureEngine: async () => ({ ok: false, reason: 'no healthy sibling install to copy the engine from' }),
        _opencodeRoots: () => [require('path').join('C:', 'npx', '_npx', 'h1', 'node_modules')],
      });
    } catch (e) { err = e; }
    expect(err).toBeDefined();
    expect(err.message).toMatch(/OpenCode engine binary not found/i);
    expect(err.message).toMatch(/self-heal: no healthy sibling/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/opencode-client-engine-missing.test.js`
Expected: the two new tests FAIL — the success case still throws `engineMissing` (no self-heal wired yet) and `mockCreateOpencodeServer` is not called; the reason case lacks the `self-heal:` suffix.

- [ ] **Step 3: Write minimal implementation**

In `src/opencode-client.js`, replace the missing-binary guard block (currently lines 627-644, from `async function startServer` through the `throw new Error(...)`):

```js
async function startServer(options = {}) {
  // Fail fast when the opencode engine binary is absent (skipped
  // optionalDependency install or AV quarantine). Before giving up, attempt an
  // in-place self-heal: COPY the opencode-* packages from a healthy sibling
  // install (engine-ensure) — NOT re-running the opencode postinstall, which is
  // the same flaky optional-dependency trap. Only runs when truly missing; the
  // fast path skips it. `_hasOpencodeBinary` / `_ensureEngine` are test seams.
  const hasOpencodeBinary = options._hasOpencodeBinary
    || require('./utils/path-setup').hasOpencodeBinary;
  if (!hasOpencodeBinary()) {
    const ensureEngine = options._ensureEngine
      || require('./utils/engine-ensure').ensureEngine;
    const healed = await ensureEngine().catch(() => ({ ok: false }));
    if (!healed.ok) {
      const HINTS = require('./utils/remediation-hints');
      // Append the roots we probed so an npx-cache-vs-global divergence is visible
      // at the point of failure, not just in `amicus doctor` (report #4).
      const opencodeRoots = options._opencodeRoots
        || require('./utils/path-setup').opencodeRoots;
      const note = healed.reason ? ` (self-heal: ${healed.reason})` : '';
      throw new Error(`${HINTS.engineMissing} Searched: ${opencodeRoots().join(', ')}${note}`);
    }
  }
```

(Leave the rest of `startServer` — `getCreateOpencodeServer()` onward — unchanged.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/opencode-client-engine-missing.test.js`
Expected: PASS (4 updated + 2 new cases green).

- [ ] **Step 5: Commit**

```bash
git add src/opencode-client.js tests/opencode-client-engine-missing.test.js
git commit -m "$(cat <<'EOF'
feat(engine): self-heal at startServer before failing on missing engine (report #2)

startServer now awaits ensureEngine() when the binary is missing and only
throws if the copy-from-sibling heal fails; the error gains a
"(self-heal: <reason>)" suffix. Preserves the engineMissing + Searched:
contract.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `amicus doctor --fix` proactively repairs broken npx copies

**Files:**
- Modify: `src/utils/doctor-engine-check.js` (add async `evaluateEngineMcp`; keep `evaluateEngineInstalls` pure)
- Modify: `src/cli-handlers-doctor.js` (add `repairEngine` dep; make the `engine-mcp` check async)
- Test: `tests/utils/doctor-engine-check.test.js` (add `evaluateEngineMcp` cases)
- Test: `tests/cli-handlers-doctor.test.js` (add a `--fix` engine case; add `repairEngine` to the `allGood` fixture)

**Interfaces:**
- Consumes: `evaluateEngineInstalls(d)` (existing, unchanged); `d.repairEngine({destPkgDir}) → Promise<{repaired, reason?}>` (Task 2, injected via doctor deps); `d.scanEngineInstalls()`; `d.fix` (boolean).
- Produces: `evaluateEngineMcp(d) → Promise<{id,name,status,message,hint}>` (async, fix-aware). `cli-handlers-doctor.realDeps()` gains `repairEngine`.

- [ ] **Step 1: Write the failing test**

Append an `evaluateEngineMcp` describe block to `tests/utils/doctor-engine-check.test.js` (reuse the file's existing `npxDir` helper):

```js
const { evaluateEngineMcp } = require('../../src/utils/doctor-engine-check');

describe('evaluateEngineMcp (--fix)', () => {
  test('without fix, returns the plain verdict (single broken → error)', async () => {
    const r = await evaluateEngineMcp(withScan({ installs: [npxCopy('only', false)], mcpLaunch: 'npx' }));
    expect(r.status).toBe('error');
  });

  test('--fix heals a broken npx copy and reports self-healed', async () => {
    const healed = { v: false };
    const scan = () => ({
      installs: [{ kind: 'npx', pkgDir: npxDir('h1'), engineOk: healed.v, roots: [] }],
      mcpLaunch: 'npx',
    });
    const repairEngine = jest.fn(async ({ destPkgDir }) => { healed.v = true; return { repaired: true, destPkgDir }; });
    const r = await evaluateEngineMcp({ scanEngineInstalls: scan, fix: true, repairEngine });
    expect(repairEngine).toHaveBeenCalledWith({ destPkgDir: npxDir('h1') });
    expect(r.status).toBe('ok');
    expect(r.message).toMatch(/self-healed/i);
  });

  test('--fix that cannot heal reports "self-heal incomplete" with the reason', async () => {
    const scan = () => ({ installs: [{ kind: 'npx', pkgDir: npxDir('h1'), engineOk: false, roots: [] }], mcpLaunch: 'npx' });
    const repairEngine = jest.fn(async () => ({ repaired: false, reason: 'no healthy sibling install to copy the engine from' }));
    const r = await evaluateEngineMcp({ scanEngineInstalls: scan, fix: true, repairEngine });
    expect(r.status).not.toBe('ok');
    expect(r.message).toMatch(/self-heal incomplete/i);
    expect(r.message).toMatch(/no healthy sibling/i);
  });

  test('--fix does not call repairEngine when already healthy', async () => {
    const repairEngine = jest.fn();
    const r = await evaluateEngineMcp({
      scanEngineInstalls: () => ({ installs: [npxCopy('h1', true)], mcpLaunch: 'npx' }),
      fix: true, repairEngine,
    });
    expect(repairEngine).not.toHaveBeenCalled();
    expect(r.status).toBe('ok');
  });

  test('--fix leaves the "no cached copy yet" warn untouched (nothing to copy)', async () => {
    const repairEngine = jest.fn();
    const r = await evaluateEngineMcp({
      scanEngineInstalls: () => ({
        installs: [{ kind: 'running', pkgDir: path.join('C:', 'g', 'amicus'), engineOk: true, roots: [] }],
        mcpLaunch: 'npx',
      }),
      fix: true, repairEngine,
    });
    expect(repairEngine).not.toHaveBeenCalled();
    expect(r.status).toBe('warn');
  });
});
```

Also add a doctor-integration case to `tests/cli-handlers-doctor.test.js`. First add `repairEngine` to the shared `allGood` fixture (so no test can reach the real one):

```js
  // engine self-heal (--fix): deterministic no-op unless a test overrides it.
  repairEngine: async () => ({ repaired: false }),
```

Then add, inside the top-level `describe('runDoctorChecks', ...)`:

```js
  test('engine-mcp --fix: a broken single npx copy is self-healed → ok', async () => {
    const healed = { v: false };
    const pkgDir = 'C:\\cache\\_npx\\h1\\node_modules\\amicus';
    const checks = await runDoctorChecks({ ...allGood,
      fix: true,
      scanEngineInstalls: () => ({
        installs: [{ kind: 'npx', pkgDir, engineOk: healed.v, roots: [pkgDir + '\\node_modules'] }],
        mcpLaunch: 'npx',
      }),
      repairEngine: async ({ destPkgDir }) => { healed.v = true; return { repaired: true, destPkgDir }; },
    });
    const engine = byId(checks)['engine-mcp'];
    expect(engine.status).toBe('ok');
    expect(engine.message).toMatch(/self-healed/i);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/utils/doctor-engine-check.test.js tests/cli-handlers-doctor.test.js`
Expected: FAIL — `evaluateEngineMcp` is not exported / not a function; the doctor `--fix` case does not yet self-heal.

- [ ] **Step 3: Write minimal implementation**

In `src/utils/doctor-engine-check.js`, add the async wrapper before `module.exports` and export it (the `plural` helper and `evaluateEngineInstalls` already exist in the file):

```js
/**
 * Fix-aware wrapper. When d.fix and the scan shows broken npx-cache copies, copy
 * the engine into each via d.repairEngine, then re-report from a fresh scan.
 * Without d.fix — or when nothing is copy-fixable — returns the plain verdict.
 * @param {object} d doctor deps (scanEngineInstalls, fix?, repairEngine?)
 * @returns {Promise<{id,name,status,message,hint}>}
 */
async function evaluateEngineMcp(d) {
  const verdict = evaluateEngineInstalls(d);
  if (!d.fix || verdict.status === 'ok') { return verdict; }

  const { installs } = d.scanEngineInstalls();
  const broken = installs.filter((i) => i.kind === 'npx' && !i.engineOk);
  if (broken.length === 0) { return verdict; }

  const results = [];
  for (const b of broken) {
    let r;
    try { r = await d.repairEngine({ destPkgDir: b.pkgDir }); }
    catch (e) { r = { repaired: false, reason: e && e.message }; }
    results.push({ pkgDir: b.pkgDir, ...r });
  }

  const after = evaluateEngineInstalls(d); // fresh scan reflects the copies
  if (after.status === 'ok') {
    const n = results.length;
    return { ...after, message: `${after.message} (self-healed ${n} npx-cache ${plural(n, 'copy', 'copies')})` };
  }
  const failed = results.filter((r) => !r.repaired)
    .map((r) => `${r.pkgDir}${r.reason ? ` — ${r.reason}` : ''}`).join('; ');
  return { ...after, message: `${after.message}; self-heal incomplete: ${failed}` };
}

module.exports = { evaluateEngineInstalls, evaluateEngineMcp };
```

In `src/cli-handlers-doctor.js`:

1. Add to `realDeps()` (near the existing `scanEngineInstalls` dep, ~line 44):

```js
    // report #2: copy-from-sibling self-heal for `doctor --fix`.
    repairEngine: (o) => require('./utils/engine-repair').repairEngine(o),
```

2. Change the `engine-mcp` check (currently line 153) from the sync `guard` to the async fix-aware wrapper:

```js
  checks.push(await guardAsync('engine-mcp', 'OpenCode engine (MCP launch path)', () => engineCheck.evaluateEngineMcp(d)));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/utils/doctor-engine-check.test.js tests/cli-handlers-doctor.test.js`
Expected: PASS (existing `evaluateEngineInstalls` cases still green; new `evaluateEngineMcp` + doctor `--fix` cases green).

- [ ] **Step 5: Commit**

```bash
git add src/utils/doctor-engine-check.js src/cli-handlers-doctor.js tests/utils/doctor-engine-check.test.js tests/cli-handlers-doctor.test.js
git commit -m "$(cat <<'EOF'
feat(doctor): --fix self-heals broken npx-cache engine copies (report #2)

evaluateEngineMcp repairs each broken npx copy via repairEngine, then
re-reports from a fresh scan (self-healed / self-heal incomplete). The
engine-mcp check is now async; evaluateEngineInstalls stays pure.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full unit suite**

Run: `npm test`
Expected: all suites PASS (no `.integration.test.js` run).

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Confirm docs are current**

Run: `node scripts/generate-docs.js --check`
Expected: exit 0 (CLAUDE.md auto sections already regenerated + committed by the pre-commit hooks in Tasks 1-3). If it reports drift, run `node scripts/generate-docs.js`, then `git add CLAUDE.md && git commit -m "docs: regenerate CLAUDE.md for engine self-heal modules" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"`.

- [ ] **Step 4: Finishing the branch**

Use the superpowers:finishing-a-development-branch skill to decide merge / PR / cleanup.

---

## Self-Review

**1. Spec coverage** (against `docs/superpowers/specs/2026-07-17-engine-self-heal-design.md`):
- Component 1 `engine-repair.js` (copy from sibling, nested dest, `.bin` shims, no PATH) → Task 2. ✓
- Component 2 `engine-lock.js` (stale-aware, keyed by pkgDir) → Task 1. ✓
- Component 3 `engine-ensure.js` (fast-path, single-flight, memoize success only) → Task 3. ✓
- Component 4 `startServer` wiring (`_ensureEngine` seam, `(self-heal: …)` suffix, contract preserved) → Task 4. ✓
- Component 5 `doctor --fix` (async `evaluateEngineMcp`, `repairEngine` dep, sync `evaluateEngineInstalls` kept) → Task 5. ✓
- Testing section (every RED-first unit, colon-free, extend engine-missing + doctor tests) → covered across Tasks 1-5. ✓
- Data flow + Error handling (never-throw repair, lock released in finally, ensureEngine catches, startServer `.catch`) → implemented in Tasks 2-4. ✓
- Known limitation (AV re-quarantine) → no code required; documented in spec. ✓

**2. Placeholder scan:** No TBD/TODO; every code + test step shows complete content; every command has an expected result.

**3. Type consistency:**
- `repairEngine({ destPkgDir?, deps? }) → {repaired, reason?, contended?, donor?, copied?}` — same shape produced in Task 2 and consumed in Tasks 3 (`ensureEngine`) and 5 (`evaluateEngineMcp`). ✓
- `ensureEngine() → {ok, reason?, donor?}` — produced in Task 3, consumed in Task 4 (`healed.ok` / `healed.reason`). ✓
- `acquireRepairLock({ pkgDir, fs? }) → {release}` — produced in Task 1, consumed in Task 2 via the `acquireLock` seam (called as `acquireLock({ pkgDir })`). ✓
- `hasOpencodeBinary` is called both as `{pkgDir, fs}` and `{nodeModulesRoot, fs}` — both supported by the existing `path-setup` signature (verified: `opencodeRoots` returns `[nodeModulesRoot]` when set). ✓
- `evaluateEngineInstalls` stays sync (existing tests) while `evaluateEngineMcp` is the async addition — the doctor check switches to `guardAsync`. ✓

No issues found.
