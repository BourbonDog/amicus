// tests/electron-native-rescue.test.js
'use strict';

/**
 * C2 — THE NATIVE-EXTRACTOR RESCUE, and the boundary that is the whole point.
 *
 * The finding (council run 34182994208, major, deepseek seat): deleting the
 * native-unzip fallback left an air-gapped machine with a permanent no-rescue
 * failure for archives yauzl cannot parse. The owner's answer was to re-wire it
 * behind `AMICUS_ALLOW_UNVERIFIED_ELECTRON=1` — and the dangerous version of that
 * answer is "fall back when extraction fails", which would silently re-arm the
 * laundering bug C4 already fixed: a security refusal retried through a tool
 * amicus does not control.
 *
 * So most of this suite is about what may NOT reach the rescue. Each excluded
 * class gets its own test, because "the classification is right" is not a claim
 * a happy path can carry.
 *
 * ── NAMED MUTANTS ─────────────────────────────────────────────────────────
 * Each is a ONE-LINE sabotage, applied and reverted by BYTE COPY (never
 * `git checkout --`), MEASURED against the named test.
 *
 * RESCUEWITHOUTHATCH   electron-native-rescue.js :: withNativeRescue — delete the
 *   `if (!policy.allowUnverified)` guard, so a parse failure is rescued whether
 *   or not the hatch is set.
 *   RED: "a parse failure with the hatch UNSET is never rescued".
 * RESCUEONUNSAFE       electron-native-rescue.js :: isRescuableFailure — accept
 *   `UNZIP_UNSAFE_ARCHIVE` as well, so a path-traversal refusal is laundered
 *   through tar / Expand-Archive.
 *   RED: "a SECURITY refusal never reaches the rescue, hatch or no hatch".
 * RESCUEONSTALL        electron-native-rescue.js :: isRescuableFailure — accept
 *   `UNZIP_BUFFER_STALLED` as well, so the bound hands its work to a child
 *   process instead of stopping it.
 *   RED: "a STALL never reaches the rescue".
 * RESCUENOTOFFERED     electron-refuse.js :: offerNativeRescue — drop the line
 *   naming AMICUS_ALLOW_UNVERIFIED_ELECTRON, so an air-gapped user cannot find
 *   the escape hatch without reading the source.
 *   RED: "the no-hatch refusal NAMES the flag and says what it would do".
 * RESCUEONMISMATCH     electron-native-rescue.js :: withNativeRescue — drop the
 *   `gate.verdict === 'mismatch'` exclusion. The hatch that opens the rescue ALSO
 *   downgrades a mismatch refusal to a warning, so contradicted bytes really do
 *   reach the extractor and would really be rescued.
 *   RED: "a digest MISMATCH the hatch let through never reaches the rescue".
 * RESCUEKEEPSPARTIAL   electron-native-rescue.js :: nativeRescue — delete the
 *   `cleanDir(fs, dir)` before the child runs, so the failed extractor's PARTIAL
 *   tree is read by `dirNonEmpty` as a successful rescue and promoted.
 *   RED: "the failed extractor's PARTIAL tree is cleaned before the child runs".
 * RESCUEREPORTSCLEAN   electron-repair-cache.js :: repairFromCache — drop
 *   `&& !rescue.used`, so a rescued install reports a clean, verified repair.
 *   RED: "the CACHE route marks a rescued repair unverified".
 * ──────────────────────────────────────────────────────────────────────────
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ei = require('../src/sidecar/electron-install');
const { withNativeRescue, RESCUE_ZIP } = require('../src/sidecar/electron-native-rescue');
const { extractBytesToDist } = require('../src/sidecar/electron-layout');
const { fakeElectronDir, SELF_ANCHOR_OFF, ZIP_BODY } = require('./helpers/fake-electron-dir');

const VERSION = '43.1.1';
const PLATFORM = 'win32';
const ARCH = 'x64';
const ZIP_NAME = `electron-v${VERSION}-${PLATFORM}-${ARCH}.zip`;
const BYTES = Buffer.from(ZIP_BODY);

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** A classified extractor failure, exactly as zip-entry-write.js constructs one. */
function boom(code, message = 'the archive could not be read') {
  return Object.assign(new Error(message), { code });
}

/** The directory shape `extractBytesToDist` really creates: <incoming>/dist. */
function incomingTree() {
  const root = mkTmp('amicus-rescue-');
  const incoming = path.join(root, '.amicus-incoming-abc123');
  const dir = path.join(incoming, 'dist');
  fs.mkdirSync(dir, { recursive: true });
  return { root, incoming, dir };
}

/**
 * A native extractor that "works": it writes `lands` into whatever directory the
 * plan told it to extract into. `nativeUnzipPlan`'s win32 tar entry is
 * `['-xf', zip, '-C', dir]`, so the destination is args[3] — read from the ARGS
 * rather than a closure, so the test also pins that the plan really was handed
 * the incoming dist and not something else.
 */
function nativeSpawn({ lands = { 'electron.exe': 'MZnative' }, status = 0, error, signal } = {}) {
  return jest.fn((cmd, args) => {
    if (status === 0 && !error && !signal) {
      const dest = args[3];
      for (const [name, body] of Object.entries(lands)) {
        fs.mkdirSync(path.dirname(path.join(dest, name)), { recursive: true });
        fs.writeFileSync(path.join(dest, name), body);
      }
    }
    return { status, error, signal };
  });
}

/** `withNativeRescue` with every leaf injected, and the log captured. */
function wrap({ extract, hatch = false, verdict = 'verified', spawn = nativeSpawn(), rescue = {} } = {}) {
  const lines = [];
  const wrapped = withNativeRescue({
    extract,
    gate: { verdict },
    policy: { allowUnverified: hatch },
    rescue,
    platform: PLATFORM,
    fs,
    spawn,
    log: (m) => lines.push(m),
  });
  return { wrapped, lines, spawn, rescue, said: () => lines.join('\n') };
}

// ---------------------------------------------------------------------------
// THE TRIGGER BOUNDARY
// ---------------------------------------------------------------------------

describe('C2 — which failure reaches the rescue, and which cannot', () => {
  test('a PARSE failure with the hatch SET is rescued — the one authorised case', async () => {
    const { dir } = incomingTree();
    const extract = jest.fn(async () => { throw boom('UNZIP_BUFFER_FAILED', 'could not read the archive: invalid central directory'); });
    const { wrapped, spawn, rescue, said } = wrap({ extract, hatch: true });

    const out = await wrapped(BYTES, { dir });

    expect(spawn).toHaveBeenCalled();
    expect(out).toEqual({ strategy: 'tar', rescued: true });
    expect(rescue.used).toBe(true);
    expect(fs.existsSync(path.join(dir, 'electron.exe'))).toBe(true);
    expect(said()).toMatch(/NATIVE-EXTRACTOR RESCUE/);
  });

  test('a parse failure with the hatch UNSET is never rescued (RESCUEWITHOUTHATCH)', async () => {
    const { dir, incoming } = incomingTree();
    const err = boom('UNZIP_BUFFER_FAILED');
    const extract = jest.fn(async () => { throw err; });
    const { wrapped, spawn, rescue } = wrap({ extract, hatch: false });

    await expect(wrapped(BYTES, { dir })).rejects.toBe(err);

    expect(spawn).not.toHaveBeenCalled();
    expect(rescue.used).toBeUndefined();
    // Nothing was written down: no path was ever handed to anyone.
    expect(fs.existsSync(path.join(incoming, RESCUE_ZIP))).toBe(false);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  test('the no-hatch refusal NAMES the flag and says what it would do (RESCUENOTOFFERED)', async () => {
    const { dir } = incomingTree();
    const extract = jest.fn(async () => { throw boom('UNZIP_BUFFER_FAILED'); });
    const { wrapped, said } = wrap({ extract, hatch: false });

    await expect(wrapped(BYTES, { dir })).rejects.toThrow();

    // The flag, by name, and what setting it buys — an air-gapped user reads
    // this and nothing else.
    expect(said()).toMatch(/AMICUS_ALLOW_UNVERIFIED_ELECTRON=1/);
    expect(said()).toMatch(/native extractor/);
    expect(said()).toMatch(/tar \/ Expand-Archive \/ ditto \/ unzip/);
    // ...and the cost, in the same breath. An offer that hid it would be worse
    // than no offer.
    expect(said()).toMatch(/COSTS custody/);
    expect(said()).toMatch(/without ever being hashed again/);
    expect(said()).toMatch(/not\n?\[amicus\] safe|is not[\s\S]{0,40}safe/);
  });

  test('a SECURITY refusal never reaches the rescue, hatch or no hatch (RESCUEONUNSAFE)', async () => {
    // HATCH-ON FIRST: the strongest form of the exclusion is "even with the
      // rescue armed, this class does not reach it", so that is the case that
      // fires first when the boundary is widened.
      for (const hatch of [true, false]) {
      const { dir, incoming } = incomingTree();
      const err = boom('UNZIP_UNSAFE_ARCHIVE', 'Out of bound path "C:\\victim" found while processing file ../../x');
      const extract = jest.fn(async () => { throw err; });
      const { wrapped, spawn, rescue, said } = wrap({ extract, hatch });

      await expect(wrapped(BYTES, { dir })).rejects.toBe(err);

      expect(spawn).not.toHaveBeenCalled();
      expect(rescue.used).toBeUndefined();
      expect(fs.existsSync(path.join(incoming, RESCUE_ZIP))).toBe(false);
      // C4 with a human in the loop is still C4: the hatch is not even MENTIONED
      // on a refusal, so nobody is invited to set it and retry.
      expect(said()).not.toMatch(/AMICUS_ALLOW_UNVERIFIED_ELECTRON/);
      expect(said()).toBe('');
    }
  });

  test('a STALL never reaches the rescue (RESCUEONSTALL)', async () => {
    // HATCH-ON FIRST: the strongest form of the exclusion is "even with the
      // rescue armed, this class does not reach it", so that is the case that
      // fires first when the boundary is widened.
      for (const hatch of [true, false]) {
      const { dir, incoming } = incomingTree();
      const err = boom('UNZIP_BUFFER_STALLED', 'the in-memory extraction stalled: no extract progress for 30000ms');
      const extract = jest.fn(async () => { throw err; });
      const { wrapped, spawn, rescue, said } = wrap({ extract, hatch });

      await expect(wrapped(BYTES, { dir })).rejects.toBe(err);

      // The bound exists to STOP work, not to hand it to someone else.
      expect(spawn).not.toHaveBeenCalled();
      expect(rescue.used).toBeUndefined();
      expect(fs.existsSync(path.join(incoming, RESCUE_ZIP))).toBe(false);
      expect(said()).toBe('');
    }
  });

  test('a DESTINATION failure never reaches the rescue (RESCUEONDESTFAIL)', async () => {
    const { dir, incoming } = incomingTree();
    const err = boom('UNZIP_DEST_FAILED', 'could not write electron.exe: ENOSPC');
    const extract = jest.fn(async () => { throw err; });
    const { wrapped, spawn, said } = wrap({ extract, hatch: true });

    await expect(wrapped(BYTES, { dir })).rejects.toBe(err);

    // Not the archive's fault, and a native extractor writing to the SAME full
    // disk fails identically — writing 138 MB more to it is the opposite of help.
    expect(spawn).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(incoming, RESCUE_ZIP))).toBe(false);
    expect(said()).toBe('');
  });

  test('a digest MISMATCH the hatch let through never reaches the rescue (RESCUEONMISMATCH)', async () => {
    // The exclusion that needs its own check. The SAME flag that opens the
    // rescue downgrades a mismatch refusal to a warning, so with the hatch set
    // the bytes really are extracted — and the bytes are known WRONG, so there
    // is nothing to rescue.
    const { dir, incoming } = incomingTree();
    const err = boom('UNZIP_BUFFER_FAILED');
    const extract = jest.fn(async () => { throw err; });
    const { wrapped, spawn, rescue, said } = wrap({ extract, hatch: true, verdict: 'mismatch' });

    await expect(wrapped(BYTES, { dir })).rejects.toBe(err);

    expect(spawn).not.toHaveBeenCalled();
    expect(rescue.used).toBeUndefined();
    expect(fs.existsSync(path.join(incoming, RESCUE_ZIP))).toBe(false);
    expect(said()).toMatch(/contradict the published sha256/);
  });

  test('a no-digest artifact IS rescuable — the air-gapped case the finding is about', async () => {
    // `no-digest` is not `mismatch`: nobody ever published a digest for an
    // Electron that predates checksums.json, so nothing contradicts these bytes.
    // Excluding it would delete the rescue for its main case.
    const { dir } = incomingTree();
    const extract = jest.fn(async () => { throw boom('UNZIP_BUFFER_FAILED'); });
    const { wrapped, spawn, rescue } = wrap({ extract, hatch: true, verdict: 'no-digest' });

    await wrapped(BYTES, { dir });

    expect(spawn).toHaveBeenCalled();
    expect(rescue.used).toBe(true);
  });

  test('an extractor that would not LOAD is not a parse failure (RESCUEONUNAVAILABLE)', async () => {
    const { dir } = incomingTree();
    const err = boom('UNZIP_BUFFER_UNAVAILABLE', 'the in-memory zip extractor is unavailable: MODULE_NOT_FOUND');
    const extract = jest.fn(async () => { throw err; });
    const { wrapped, spawn, said } = wrap({ extract, hatch: true });

    await expect(wrapped(BYTES, { dir })).rejects.toBe(err);

    // Nobody learned anything about this archive. The owner authorised one case.
    expect(spawn).not.toHaveBeenCalled();
    expect(said()).toBe('');
  });

  test('an extract failure amicus cannot CLASSIFY never reaches the rescue (fail closed)', async () => {
    const { dir } = incomingTree();
    const err = new Error('an internal bug with no code at all');
    const extract = jest.fn(async () => { throw err; });
    const { wrapped, spawn } = wrap({ extract, hatch: true });

    await expect(wrapped(BYTES, { dir })).rejects.toBe(err);

    expect(spawn).not.toHaveBeenCalled();
  });

  test('an extract that SUCCEEDS is passed straight through, rescue untouched', async () => {
    const { dir } = incomingTree();
    const extract = jest.fn(async () => ({ strategy: 'buffer', entries: 7 }));
    const { wrapped, spawn, rescue, said } = wrap({ extract, hatch: true });

    expect(await wrapped(BYTES, { dir })).toEqual({ strategy: 'buffer', entries: 7 });
    expect(spawn).not.toHaveBeenCalled();
    expect(rescue.used).toBeUndefined();
    expect(said()).toBe('');
  });
});

// ---------------------------------------------------------------------------
// WHAT THE RESCUE DOES, AND WHAT IT COSTS
// ---------------------------------------------------------------------------

describe('C2 — the mechanics, and the window they open', () => {
  test('the buffer is written into the INCOMING tree, beside dist/ and never inside it', async () => {
    const { dir, incoming } = incomingTree();
    let seenAtSpawn = null;
    const spawn = jest.fn((cmd, args) => {
      // What the child would actually see, at the moment it is handed the path.
      seenAtSpawn = {
        zip: args.find((a) => typeof a === 'string' && a.endsWith(RESCUE_ZIP)) || args[1],
        bytes: fs.readFileSync(path.join(incoming, RESCUE_ZIP)).toString('utf8'),
        insideDist: fs.readdirSync(dir),
      };
      fs.writeFileSync(path.join(args[3], 'electron.exe'), 'MZnative');
      return { status: 0 };
    });
    const extract = jest.fn(async () => { throw boom('UNZIP_BUFFER_FAILED'); });
    const { wrapped } = wrap({ extract, hatch: true, spawn });

    await wrapped(BYTES, { dir });

    // The child was handed the file amicus wrote, holding the bytes it hashed.
    expect(seenAtSpawn.bytes).toBe(ZIP_BODY);
    expect(path.dirname(seenAtSpawn.zip)).toBe(incoming);
    // ...and it is NOT inside dist/, which `promoteDist` renames wholesale: a
    // 138 MB stray zip would be carried into the user's electron package.
    expect(seenAtSpawn.insideDist).toEqual([]);
    // The copy does not outlive the child.
    expect(fs.existsSync(path.join(incoming, RESCUE_ZIP))).toBe(false);
  });

  test('the incoming-tree coupling holds against a REAL extractBytesToDist', async () => {
    // The rescue derives its write location from the caller's `dir`, so the
    // shape it derives from must be the shape the production caller really
    // creates. This runs the real `extractBytesToDist` — which is what names
    // `.amicus-incoming-<hex>` and promotes `<incoming>/dist` — rather than the
    // hand-built fixture the rest of this block uses, so a rename over there
    // reddens here instead of silently disarming the rescue.
    const electronDir = mkTmp('amicus-realincoming-');
    let observed = null;
    const spawn = jest.fn((cmd, args) => {
      observed = { zip: args[1], dest: args[3] };
      fs.writeFileSync(path.join(args[3], 'electron.exe'), 'MZnative');
      return { status: 0 };
    });
    const { wrapped } = wrap({
      extract: async () => { throw boom('UNZIP_BUFFER_FAILED'); }, hatch: true, spawn,
    });

    await extractBytesToDist({ bytes: BYTES, electronDir, platform: PLATFORM, extract: wrapped, fs });

    expect(path.basename(observed.zip)).toBe(RESCUE_ZIP);
    expect(path.basename(path.dirname(observed.zip))).toMatch(/^\.amicus-incoming-/);
    expect(path.dirname(path.dirname(observed.zip))).toBe(electronDir);
    expect(observed.dest).toBe(path.join(path.dirname(observed.zip), 'dist'));
    // The promote then did its ONE rename, and swept its own litter.
    expect(fs.existsSync(path.join(electronDir, 'dist', 'electron.exe'))).toBe(true);
    expect(fs.readdirSync(electronDir).filter((n) => n.startsWith('.amicus-'))).toEqual([]);
  });

  test("the failed extractor's PARTIAL tree is cleaned before the child runs (RESCUEKEEPSPARTIAL)", async () => {
    const { dir } = incomingTree();
    const extract = jest.fn(async (_b, o) => {
      fs.writeFileSync(path.join(o.dir, 'half-written.bin'), 'PARTIAL');
      throw boom('UNZIP_BUFFER_FAILED');
    });
    // A native extractor that exits 0 and produces NOTHING. Without the clean,
    // the partial tree makes `dirNonEmpty` true and the leftovers get promoted
    // as if they were a rescue.
    const spawn = nativeSpawn({ lands: {} });
    const { wrapped, rescue } = wrap({ extract, hatch: true, spawn });

    await expect(wrapped(BYTES, { dir })).rejects.toMatchObject({ code: 'UNZIP_BUFFER_FAILED' });

    expect(rescue.used).toBeUndefined();
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  test('a rescue no native strategy recovers rethrows the ORIGINAL classified failure', async () => {
    // Load-bearing: `UNZIP_BUFFER_FAILED` is what lets the cache route evict a
    // genuinely bad artifact. A rescue that failed must not blunt that verdict.
    const { dir } = incomingTree();
    const err = boom('UNZIP_BUFFER_FAILED', 'could not read the archive: bad EOCD');
    const extract = jest.fn(async () => { throw err; });
    const spawn = nativeSpawn({ status: 1 });
    const { wrapped, said } = wrap({ extract, hatch: true, spawn });

    await expect(wrapped(BYTES, { dir })).rejects.toBe(err);

    expect(spawn).toHaveBeenCalledTimes(2);          // both win32 strategies tried
    expect(said()).toMatch(/did not recover this archive/);
    expect(said()).toMatch(/exit 1/);
  });

  test('a signal-killed native extractor is a FAILURE even if files landed', async () => {
    const { dir } = incomingTree();
    const extract = jest.fn(async () => { throw boom('UNZIP_BUFFER_FAILED'); });
    const spawn = jest.fn((cmd, args) => {
      fs.writeFileSync(path.join(args[3], 'partial.bin'), 'HALF');
      return { status: null, signal: 'SIGKILL' };
    });
    const { wrapped, rescue, said } = wrap({ extract, hatch: true, spawn });

    await expect(wrapped(BYTES, { dir })).rejects.toMatchObject({ code: 'UNZIP_BUFFER_FAILED' });

    expect(rescue.used).toBeUndefined();
    expect(fs.readdirSync(dir)).toEqual([]);         // and its debris is swept
    expect(said()).toMatch(/killed by SIGKILL/);
  });

  test('the rescue REFUSES to write anywhere but an amicus incoming directory', async () => {
    // The destination is derived from the caller's `dir`, so the derivation is
    // CHECKED rather than assumed: a wrapper wired somewhere unexpected refuses
    // instead of dropping a 138 MB zip next to somebody's files.
    const root = mkTmp('amicus-notincoming-');
    const dir = path.join(root, 'somewhere', 'dist');
    fs.mkdirSync(dir, { recursive: true });
    const err = boom('UNZIP_BUFFER_FAILED');
    const extract = jest.fn(async () => { throw err; });
    const { wrapped, spawn, said } = wrap({ extract, hatch: true });

    await expect(wrapped(BYTES, { dir })).rejects.toBe(err);

    expect(spawn).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(root, 'somewhere', RESCUE_ZIP))).toBe(false);
    expect(said()).toMatch(/not inside an amicus incoming directory/);
  });

  test('a name already sitting at the rescue path is never written through', async () => {
    // `flag: 'wx'` — O_EXCL refuses an existing name, INCLUDING a symlink someone
    // pre-planted at it. A small control, and the only one available on this
    // side of the window.
    const { dir, incoming } = incomingTree();
    fs.writeFileSync(path.join(incoming, RESCUE_ZIP), 'PLANTED');
    const err = boom('UNZIP_BUFFER_FAILED');
    const extract = jest.fn(async () => { throw err; });
    const { wrapped, spawn, said } = wrap({ extract, hatch: true });

    await expect(wrapped(BYTES, { dir })).rejects.toBe(err);

    expect(spawn).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(incoming, RESCUE_ZIP), 'utf8')).toBe('PLANTED');
    expect(said()).toMatch(/could not write the archive out/);
  });

  test('the notice DISCLOSES the window before the child is spawned, and never calls it safe', async () => {
    const { dir, incoming } = incomingTree();
    const lines = [];
    let saidBeforeSpawn = '';
    const spawn = jest.fn((cmd, args) => {
      saidBeforeSpawn = lines.join('\n');
      fs.writeFileSync(path.join(args[3], 'electron.exe'), 'MZnative');
      return { status: 0 };
    });
    const wrapped = withNativeRescue({
      extract: async () => { throw boom('UNZIP_BUFFER_FAILED'); },
      gate: { verdict: 'verified' },
      policy: { allowUnverified: true },
      rescue: {},
      platform: PLATFORM,
      fs,
      spawn,
      log: (m) => lines.push(m),
    });

    await wrapped(BYTES, { dir });

    // The window opens at the WRITE, so the disclosure has to precede the spawn.
    expect(saidBeforeSpawn).toMatch(/THE WINDOW THIS OPENS/);
    expect(saidBeforeSpawn).toContain(path.join(incoming, RESCUE_ZIP));
    expect(saidBeforeSpawn).toMatch(/anything running as your user can/);
    expect(saidBeforeSpawn).toMatch(/WITHOUT being/);
    expect(saidBeforeSpawn).toMatch(/hashed again/);
    expect(saidBeforeSpawn).toMatch(/It is NOT/);
    // And it never dresses the trade up as a safe one.
    expect(lines.join('\n')).not.toMatch(/\bis safe\b|safely|securely/);
    expect(lines.join('\n')).toMatch(/reported as unverified|marked unverified/);
  });
});

// ---------------------------------------------------------------------------
// WIRED — the rescue is reachable from the real provision routes, on both
// ---------------------------------------------------------------------------

/** A zip at <root>/<sha>/<ZIP_NAME>, the @electron/get cache layout. */
function writeZip({ body = ZIP_BODY, root = mkTmp('amicus-zip-') } = {}) {
  const shaDir = path.join(root, 'a'.repeat(16));
  fs.mkdirSync(shaDir, { recursive: true });
  const zip = path.join(shaDir, ZIP_NAME);
  fs.writeFileSync(zip, body);
  return zip;
}

describe('C2 — wired into BOTH provision routes', () => {
  let stderr;
  let stderrSpy;
  let savedHatch;
  beforeEach(() => {
    stderr = [];
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation((chunk) => { stderr.push(String(chunk)); return true; });
    savedHatch = process.env.AMICUS_ALLOW_UNVERIFIED_ELECTRON;
    delete process.env.AMICUS_ALLOW_UNVERIFIED_ELECTRON;
  });
  afterEach(() => {
    stderrSpy.mockRestore();
    if (savedHatch === undefined) { delete process.env.AMICUS_ALLOW_UNVERIFIED_ELECTRON; } else { process.env.AMICUS_ALLOW_UNVERIFIED_ELECTRON = savedHatch; }
  });

  /** repairElectron with a parse-failing extractor and a working native plan. */
  async function repair({ dir, zip = null, cacheOnly = true, spawn = nativeSpawn(), deps = {} }) {
    const extract = jest.fn(async () => { throw boom('UNZIP_BUFFER_FAILED', 'could not read the archive: invalid central directory'); });
    const res = await ei.repairElectron({
      cacheOnly,
      electronDir: dir,
      platform: PLATFORM,
      version: VERSION,
      arch: ARCH,
      deps: {
        ...SELF_ANCHOR_OFF,
        cachedZip: () => zip,
        extract,
        spawn,
        acquireLock: () => ({ release: () => {} }),
        ...deps,
      },
    });
    return { res, extract, spawn };
  }

  test('the CACHE route rescues a parse failure and marks it unverified (RESCUEREPORTSCLEAN)', async () => {
    process.env.AMICUS_ALLOW_UNVERIFIED_ELECTRON = '1';
    const { dir, exeName, distDir } = fakeElectronDir({ withExe: false, platform: PLATFORM });
    const zip = writeZip();

    const { res, spawn } = await repair({ dir, zip });

    expect(spawn).toHaveBeenCalled();
    // The rescue landed in dist/ by the SAME promote — one rename, nothing new.
    expect(fs.existsSync(path.join(distDir, exeName))).toBe(true);
    expect(res.repaired).toBe(true);
    // The artifact's own sha256 MATCHED (verdict 'verified'), and the repair is
    // still not clean: a child process extracted a path, so what is in dist/ is
    // not what amicus hashed. Reporting that as verified is the overclaim the
    // whole custody property forbids.
    expect(res.unverified).toBe(true);
    // No litter: the incoming tree, zip and all, is gone.
    expect(fs.readdirSync(dir).filter((n) => n.startsWith('.amicus-incoming-'))).toEqual([]);
  });

  test('the DOWNLOAD route rescues a parse failure too (F3 — never one route only)', async () => {
    process.env.AMICUS_ALLOW_UNVERIFIED_ELECTRON = '1';
    const { dir, exeName, distDir } = fakeElectronDir({ withExe: false, platform: PLATFORM });
    const downloadArtifact = jest.fn(async () => writeZip());

    const { res, spawn } = await repair({ dir, zip: null, cacheOnly: false, deps: { downloadArtifact } });

    expect(downloadArtifact).toHaveBeenCalled();
    expect(spawn).toHaveBeenCalled();
    expect(fs.existsSync(path.join(distDir, exeName))).toBe(true);
    expect(res.repaired).toBe(true);
    // NOTE on what this does and does not prove: on the download route the hatch
    // has already dropped the digest pin, so `pinned` is false — and therefore
    // `unverified` true — for every hatch-on provision, rescue or not. The
    // `!rescue.used` term there is a guard against that coupling changing, not a
    // difference this assertion can isolate. The CACHE route's test above is the
    // one where the term is load-bearing.
    expect(res.unverified).toBe(true);
  });

  test('with the hatch UNSET the CACHE route refuses and OFFERS the flag, extracting nothing', async () => {
    const { dir, exeName, distDir } = fakeElectronDir({ withExe: false, platform: PLATFORM });
    const zip = writeZip();

    const { res, spawn } = await repair({ dir, zip });

    expect(spawn).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(distDir, exeName))).toBe(false);
    expect(res.repaired).toBe(false);
    // The artifact is EVICTED, exactly as before C2 — a parse failure is still
    // the one verdict that says the archive is worthless.
    expect(res.reason).toMatch(/corrupt/);
    // ...and the user is told, in the same output, that there is a way through.
    expect(stderr.join('')).toMatch(/AMICUS_ALLOW_UNVERIFIED_ELECTRON=1/);
    expect(stderr.join('')).toMatch(/native extractor/);
  });

  test('with the hatch set, an UNSAFE archive is still terminal on the wired route', async () => {
    process.env.AMICUS_ALLOW_UNVERIFIED_ELECTRON = '1';
    const { dir, exeName, distDir } = fakeElectronDir({ withExe: false, platform: PLATFORM });
    const zip = writeZip();
    const extract = jest.fn(async () => { throw boom('UNZIP_UNSAFE_ARCHIVE', 'Out of bound path "/victim" found while processing file ../x'); });
    const spawn = nativeSpawn();

    const res = await ei.repairElectron({
      cacheOnly: true,
      electronDir: dir,
      platform: PLATFORM,
      version: VERSION,
      arch: ARCH,
      deps: {
        ...SELF_ANCHOR_OFF, cachedZip: () => zip, extract, spawn, acquireLock: () => ({ release: () => {} }),
      },
    });

    expect(spawn).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(distDir, exeName))).toBe(false);
    expect(res.integrity).toBe('unsafe-archive');
    // The refused archive is evidence: still there, still not retried.
    expect(fs.existsSync(zip)).toBe(true);
    expect(stderr.join('')).toMatch(/will not retry it with another extractor/);
  });
});
