// tests/electron-custody.test.js
'use strict';

/**
 * CUSTODY — one open, one Buffer, and an extractor with no filesystem source.
 *
 * THE FINDING THIS ANSWERS (council run 34165289952, seat D1, confirmed 4 of 4).
 * v4.9.6 staged the artifact by COPYING it into a fresh 0700 `mkdtemp`
 * directory and asserted the attacker had "no name for it and no handle on it".
 * That is false for the attacker the threat model actually names — one running
 * as the SAME USER — and it was measured false: a spinner found the fixed
 * `amicus-electron-stage-` prefix on its first `readdir`, opened the copy `r+`,
 * and overwrote it between the hash and the extract. The fd remedy that looked
 * like the answer is worse: a descriptor names an inode, not a version of one,
 * so a same-uid `writeFileSync` at the path is visible THROUGH our retained fd
 * (measured twice, independently).
 *
 * What closes it is that the bytes stop being a file. `readArtifactBytes` opens
 * the path once, `fstat`s the DESCRIPTOR, reads positionally into one Buffer and
 * closes; the gate hashes that Buffer; `extractZipBuffer` extracts that Buffer.
 * No filesystem write can reach a Buffer in this process's heap.
 *
 * The property being certified, and the only one claimed:
 *   **Amicus never itself writes, or reports as verified, bytes it did not hash.**
 *
 * ── NAMED MUTANTS ─────────────────────────────────────────────────────────
 * Each is a one-line sabotage, applied and reverted by BYTE COPY (never
 * `git checkout --`), MEASURED against the named test.
 *
 * YAUZLHANG        zip-from-buffer.js :: extractZipBuffer — resolve on the
 *   zipfile's 'close' event, as extract-zip does, instead of 'end'.
 *   RED: "extraction resolves on 'end' — 'close' NEVER fires under fromBuffer".
 * SYMLINKESCAPE    zip-from-buffer.js :: writeSymlink — drop the resolved-target
 *   bounds check, so a symlink may point anywhere.
 *   RED: "a symlink whose target leaves the extraction root is REFUSED".
 * SYMLINKCHAIN     zip-from-buffer.js :: writeSymlink — resolve the target
 *   against the LEXICAL `path.dirname(dest)` instead of the realpath'd
 *   `canonical` the caller already computed.
 *   RED: "the target is resolved against the REAL directory, not the lexical one".
 * PROMOTEPARTIAL   electron-layout.js :: extractBytesToDist — extract straight
 *   into `<electronDir>/dist` instead of into `.amicus-incoming-<hex>/dist`.
 *   RED: "a failed extraction never becomes dist/".
 * DESTERRORISARCHIVE zip-from-buffer.js :: writeEntry — tag a write failure
 *   `UNZIP_BUFFER_FAILED` instead of `UNZIP_DEST_FAILED`.
 *   RED: "a DESTINATION failure is not reported as a bad archive (D2)".
 * ──────────────────────────────────────────────────────────────────────────
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { readArtifactBytes, isSafeArtifactName, MAX_ARTIFACT_BYTES } = require('../src/sidecar/electron-custody');
const { extractZipBuffer } = require('../src/sidecar/zip-from-buffer');
const { extractBytesToDist, promoteDist } = require('../src/sidecar/electron-layout');
const {
  buildZip, zipFile, realZip, MODE_DIR, MODE_SYMLINK,
} = require('./helpers/zip-fixture');

function mkTmp(prefix = 'amicus-custody-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Every regular file under `dir`, as `relative/path:size`, sorted. */
function treeOf(dir, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { return treeOf(full, `${prefix}${e.name}/`); }
    return [`${prefix}${e.name}:${fs.statSync(full).size}`];
  }).sort();
}

describe('readArtifactBytes — the one read', () => {
  test('reads the whole artifact into ONE Buffer, through ONE open', () => {
    const file = zipFile(Buffer.from('PKzip-and-then-some'));
    const opens = [];
    const spyFs = { ...fs, openSync: (...a) => { opens.push(a[0]); return fs.openSync(...a); } };

    const held = readArtifactBytes({ zip: file, fs: spyFs });

    expect(held.why).toBeUndefined();
    expect(held.bytes.toString('utf8')).toBe('PKzip-and-then-some');
    expect(held.size).toBe(19);
    expect(opens).toEqual([file]);          // exactly one open, of exactly that path
  });

  test('the size it trusts comes from FSTAT, never from a second stat of the name', () => {
    // A path-based `stat` is a SECOND resolution of an attacker-influenced name,
    // which is the class of bug this module exists to remove. If the size were
    // taken from `statSync(zip)` a swapped symlink could describe a file we are
    // not reading; taking it from the descriptor makes that unreachable.
    const file = zipFile(Buffer.from('0123456789'));
    const statCalls = [];
    const spyFs = {
      ...fs,
      statSync: (...a) => { statCalls.push(a[0]); return fs.statSync(...a); },
      lstatSync: (...a) => { statCalls.push(a[0]); return fs.lstatSync(...a); },
    };

    const held = readArtifactBytes({ zip: file, fs: spyFs });

    expect(held.size).toBe(10);
    expect(statCalls).toEqual([]);          // nothing ever stat'd the NAME
  });

  test('every read is POSITIONAL, so a shared file offset can never be used', () => {
    const body = Buffer.alloc(3000, 0x41);
    const file = zipFile(body);
    const positions = [];
    const spyFs = {
      ...fs,
      readSync: (fd, buf, off, len, pos) => { positions.push(pos); return fs.readSync(fd, buf, off, len, pos); },
    };

    const held = readArtifactBytes({ zip: file, fs: spyFs });

    expect(held.bytes.equals(body)).toBe(true);
    expect(positions.every((p) => typeof p === 'number')).toBe(true);   // never null/undefined
    expect(positions[0]).toBe(0);
  });

  test('a chunked read reassembles the artifact exactly (many positional reads)', () => {
    // A short-read fs that returns at most 7 bytes per call, to drive the loop
    // the way an 8 MiB chunk drives it on a 138 MiB artifact.
    const body = crypto.randomBytes(5000);
    const file = zipFile(body);
    const dribbleFs = {
      ...fs,
      readSync: (fd, buf, off, len, pos) => fs.readSync(fd, buf, off, Math.min(len, 7), pos),
    };

    const held = readArtifactBytes({ zip: file, fs: dribbleFs });

    expect(held.bytes.equals(body)).toBe(true);
  });

  test('every refusal is NAMED, and none of them throws', () => {
    const gone = path.join(mkTmp(), 'nope', 'x.zip');
    expect(readArtifactBytes({ zip: gone, fs })).toMatchObject({ bytes: null, why: 'unreadable' });

    const dir = mkTmp();
    // A directory: `openSync` refuses it on some platforms and `fstat` on others
    // — MEASURED here as 'not-a-file' (Windows 11 / Node 24 opens a directory
    // read-only and lets fstat answer). Either way it is never read as bytes.
    expect(['not-a-file', 'unreadable']).toContain(readArtifactBytes({ zip: dir, fs }).why);

    const empty = zipFile(Buffer.alloc(0));
    expect(readArtifactBytes({ zip: empty, fs })).toMatchObject({ bytes: null, why: 'empty' });

    const small = zipFile(Buffer.from('abc'));
    expect(readArtifactBytes({ zip: small, fs, maxBytes: 2 })).toMatchObject({ bytes: null, why: 'too-large' });

    // A read that ends early mid-buffer: the file is not what fstat described.
    const truncatingFs = { ...fs, readSync: () => 0 };
    expect(readArtifactBytes({ zip: small, fs: truncatingFs })).toMatchObject({ bytes: null, why: 'short-read' });
  });

  test('a file that GREW under the read is refused rather than hashed as a prefix', () => {
    // What an active swap looks like from inside: fstat said N, the file is now
    // longer, so the Buffer we hold is a PREFIX of something else. Hashing that
    // and reporting a verdict on it would describe bytes nobody will extract.
    const file = zipFile(Buffer.from('SHORT'));
    let grown = false;
    const growingFs = {
      ...fs,
      readSync: (fd, buf, off, len, pos) => {
        if (!grown) { grown = true; fs.appendFileSync(file, 'MORE'); }
        return fs.readSync(fd, buf, off, len, pos);
      },
    };

    expect(readArtifactBytes({ zip: file, fs: growingFs })).toMatchObject({ bytes: null, why: 'grew' });
  });

  test('the descriptor is CLOSED on every exit, including the refusals', () => {
    const file = zipFile(Buffer.from('abc'));
    const closed = [];
    const countingFs = { ...fs, closeSync: (fd) => { closed.push(fd); return fs.closeSync(fd); } };

    readArtifactBytes({ zip: file, fs: countingFs });
    readArtifactBytes({ zip: file, fs: { ...countingFs, fstatSync: () => { throw new Error('EIO'); } } });

    expect(closed).toHaveLength(2);
  });

  test('the ceiling is checked BEFORE a byte is allocated', () => {
    // A 4 GiB sparse file reports 4 GiB to fstat. The cap must refuse from the
    // stat alone — there is no clean "could not allocate" branch to fall into,
    // because Buffer.allocUnsafe does not throw on exhaustion, the process dies.
    const file = zipFile(Buffer.from('x'));
    const hugeFs = {
      ...fs,
      fstatSync: () => ({ isFile: () => true, size: 4 * 1024 * 1024 * 1024 }),
      readSync: () => { throw new Error('must not read'); },
    };

    const held = readArtifactBytes({ zip: file, fs: hugeFs });

    expect(held).toMatchObject({ bytes: null, why: 'too-large' });
    expect(held.detail).toMatch(String(MAX_ARTIFACT_BYTES));
  });

  test('isSafeArtifactName moved here unchanged, and is still an ALLOW-list', () => {
    expect(isSafeArtifactName('electron-v43.1.1-win32-x64.zip')).toBe(true);
    expect(isSafeArtifactName('electron-v43.1.1-beta.3-linux-arm64.zip')).toBe(true);
    for (const bad of [
      'electron-v43.1.1/../../victim-win32-x64.zip', '../electron-v43.1.1-win32-x64.zip',
      'sub\\electron-v43.1.1-win32-x64.zip', 'electron-v43.1.1-win32-x64.tar.gz', '', null, 42,
    ]) {
      expect(isSafeArtifactName(bad)).toBe(false);
    }
  });
});

describe('extractZipBuffer — extraction with no filesystem source', () => {
  test("extraction resolves on 'end' — 'close' NEVER fires under fromBuffer (YAUZLHANG)", async () => {
    // MEASURED on the installed yauzl@2.10.0: `fromBuffer` sets autoClose=false
    // UNCONDITIONALLY (index.js, line 67) and fd-slicer's BufferSlicer emits nothing
    // on unref (index.js, lines 282-288), so the 'close' event extract-zip resolves
    // on is UNREACHABLE — a naive port hangs forever. This test states both halves:
    // the extraction completes, and 'close' is never seen even though close() runs.
    const yauzl = require('yauzl');
    let sawClose = false;
    let autoClose = null;
    const spy = {
      fromBuffer: (bytes, opts, cb) => yauzl.fromBuffer(bytes, opts, (err, zf) => {
        if (zf) {
          autoClose = zf.autoClose;
          zf.on('close', () => { sawClose = true; });
        }
        cb(err, zf);
      }),
    };
    const dir = mkTmp();

    const res = await extractZipBuffer(buildZip([{ name: 'a.txt', body: 'hi' }]), { dir, deps: { yauzl: spy } });

    expect(res).toEqual({ strategy: 'buffer', entries: 1 });
    expect(autoClose).toBe(false);            // the option we did not ask for
    await new Promise((r) => setTimeout(r, 50));
    expect(sawClose).toBe(false);             // ...and the event that never comes
  });

  test('a real, DEFLATED archive round-trips byte-for-byte', async () => {
    const bytes = realZip();
    if (!bytes) { return; }                   // no archiver on this box; nothing to assert
    const dir = mkTmp();

    const res = await extractZipBuffer(bytes, { dir });

    expect(res.entries).toBeGreaterThan(0);
    expect(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8')).toBe('hello from a\n');
    expect(fs.readFileSync(path.join(dir, 'sub', 'b.txt'), 'utf8')).toBe('nested\n');
  });

  test('directories, nesting and __MACOSX are handled as extract-zip handles them', async () => {
    const dir = mkTmp();
    const res = await extractZipBuffer(buildZip([
      { name: 'top/', mode: MODE_DIR },
      { name: 'top/one.txt', body: 'one' },
      { name: 'top/deep/two.txt', body: 'two' },
      { name: '__MACOSX/top/._one.txt', body: 'junk' },
    ]), { dir });

    expect(treeOf(dir)).toEqual(['top/deep/two.txt:3', 'top/one.txt:3']);
    expect(fs.existsSync(path.join(dir, '__MACOSX'))).toBe(false);
    expect(res.entries).toBe(3);              // the skipped entry is not counted
  });

  test('a name yauzl refuses is TERMINAL, in the words UNSAFE_PATTERNS classifies', async () => {
    const { UNSAFE_PATTERNS } = require('../src/sidecar/unzip');
    for (const name of ['../../victim.exe', '/etc/cron.d/pwn', 'dist/../../victim.exe']) {
      const dir = mkTmp();
      const err = await extractZipBuffer(buildZip([{ name, body: 'x' }]), { dir }).catch((e) => e);
      expect(err.code).toBe('UNZIP_UNSAFE_ARCHIVE');
      expect(UNSAFE_PATTERNS.some((p) => p.test(err.message))).toBe(true);
    }
  });

  test('an entry that escapes through a pre-planted directory symlink is REFUSED', async () => {
    // extract-zip's own out-of-bound check, kept VERBATIM and re-run per entry:
    // `realpath(destDir)` resolving outside the root is the shape a symlink an
    // earlier entry created produces. Simulated with a planted link, because a
    // real one needs elevation on Windows.
    const dir = mkTmp();
    const outside = mkTmp('amicus-outside-');
    const escapingFs = {
      ...fs,
      realpathSync: (p) => (String(p).endsWith('escape') ? outside : fs.realpathSync(p)),
    };

    const err = await extractZipBuffer(buildZip([{ name: 'escape/x.txt', body: 'x' }]), {
      dir, deps: { fs: escapingFs },
    }).catch((e) => e);

    expect(err.code).toBe('UNZIP_UNSAFE_ARCHIVE');
    expect(err.message).toMatch(/^Out of bound path /);
    expect(fs.existsSync(path.join(outside, 'x.txt'))).toBe(false);
  });

  test('an encrypted entry is refused rather than written as ciphertext', async () => {
    const dir = mkTmp();
    // General-purpose bit 0 set: yauzl's Entry.isEncrypted(). The compression
    // method is moved to 8 as well, because yauzl's own stored-entry size check
    // (compressedSize must be uncompressedSize + 12 when encrypted) would
    // otherwise fire first and hide the branch under test.
    const bytes = buildZip([{ name: 'secret.bin', body: 'x' }]);
    bytes.writeUInt16LE(0x0001, 6);            // local header flags
    bytes.writeUInt16LE(8, 8);                 // local header method
    const centralAt = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    bytes.writeUInt16LE(0x0001, centralAt + 8);
    bytes.writeUInt16LE(8, centralAt + 10);

    const err = await extractZipBuffer(bytes, { dir }).catch((e) => e);

    expect(err.code).toBe('UNZIP_BUFFER_FAILED');
    expect(err.message).toMatch(/encrypted/);
  });

  test('a corrupt archive fails as UNZIP_BUFFER_FAILED, never as a destination error', async () => {
    const dir = mkTmp();
    const err = await extractZipBuffer(Buffer.from('not a zip at all'), { dir }).catch((e) => e);
    expect(err.code).toBe('UNZIP_BUFFER_FAILED');
  });

  test('a DESTINATION failure is not reported as a bad archive (D2) (DESTERRORISARCHIVE)', async () => {
    // The council finding: a full disk while writing dist/ evicted a PRISTINE
    // cache entry, because every extract failure was read as "the archive is
    // corrupt". The code now carries the causal claim, and the caller acts on it.
    const dir = mkTmp();
    const fullFs = {
      ...fs,
      createWriteStream: () => { const e = new Error('ENOSPC: no space left on device'); throw e; },
    };

    const err = await extractZipBuffer(buildZip([{ name: 'a.txt', body: 'x' }]), {
      dir, deps: { fs: fullFs },
    }).catch((e) => e);

    expect(err.code).toBe('UNZIP_DEST_FAILED');
    expect(err.message).toMatch(/ENOSPC/);
  });

  test('a CRC-32 that disagrees with the archive is caught, and named as the archive', async () => {
    const bytes = buildZip([{ name: 'a.txt', body: 'hello' }]);
    bytes.writeUInt32LE(0xdeadbeef, 14);       // local header CRC
    const centralCrcAt = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 16;
    bytes.writeUInt32LE(0xdeadbeef, centralCrcAt);
    const dir = mkTmp();

    const err = await extractZipBuffer(bytes, { dir }).catch((e) => e);

    expect(err.code).toBe('UNZIP_BUFFER_FAILED');
    expect(err.message).toMatch(/crc32 mismatch/);
  });
});

describe('symlinks — the darwin .app shape, which cannot be run here', () => {
  // MEASURED-UNVERIFIABLE ON THIS MACHINE. The only electron artifact that
  // contains symlinks is the darwin `.app` bundle (`Versions/Current` and the
  // framework chains); the win32 artifact has ZERO symlink entries, measured on
  // the real 138 MiB file. So these tests build the SHAPES a real `.app` uses
  // and drive them through an injected fs — which pins the DECISION amicus makes
  // about each shape, on every platform, and does not pretend to have extracted
  // a real bundle. `fs.symlinkSync` needs Developer Mode on Windows, so the
  // recording fs also makes the assertion possible at all here.
  function recordingFs(links) {
    return { ...fs, symlinkSync: (target, dest) => links.push({ target, dest }) };
  }

  test('a RELATIVE symlink inside the tree is created, target preserved', async () => {
    const links = [];
    const dir = mkTmp();

    // The real shape: Electron.app/Contents/Frameworks/X.framework/Versions/Current -> A
    const res = await extractZipBuffer(buildZip([
      { name: 'Electron.app/Contents/Frameworks/X.framework/Versions/A/X', body: 'MZ' },
      { name: 'Electron.app/Contents/Frameworks/X.framework/Versions/Current', body: 'A', mode: MODE_SYMLINK },
      { name: 'Electron.app/Contents/Frameworks/X.framework/X', body: 'Versions/Current/X', mode: MODE_SYMLINK },
    ]), { dir, deps: { fs: recordingFs(links) } });

    expect(res.entries).toBe(3);
    expect(links.map((l) => l.target)).toEqual(['A', 'Versions/Current/X']);
    expect(links[0].dest.endsWith(path.join('Versions', 'Current'))).toBe(true);
  });

  test('a symlink whose target leaves the extraction root is REFUSED (SYMLINKESCAPE)', async () => {
    for (const target of ['../../../../etc/passwd', '/etc/passwd', 'Versions/../../../../out']) {
      const links = [];
      const dir = mkTmp();

      const err = await extractZipBuffer(buildZip([
        { name: 'app/Contents/link', body: target, mode: MODE_SYMLINK },
      ]), { dir, deps: { fs: recordingFs(links) } }).catch((e) => e);

      expect(err.code).toBe('UNZIP_UNSAFE_ARCHIVE');
      expect(err.message).toMatch(/^Out of bound path /);
      expect(links).toEqual([]);            // nothing was created before the refusal
    }
  });

  test('the target is resolved against the REAL directory, not the lexical one (SYMLINKCHAIN)', async () => {
    // MEASURED on the code as shipped in this branch, twice: with the check
    // resolving against `path.dirname(dest)`, ONE archive of four ordinary
    // entries — `L0`, `L0/L1`, `L0/L1/L2` each a symlink to `.`, then
    // `L0/L1/L2/x -> ../../../victim.txt` — extracted with NO error at all
    // ({strategy:'buffer',entries:4}) and planted a link outside the root.
    // Escape depth tracked chain length 1:1. Every name passes yauzl's
    // validateFileName: all relative, no `..` component, no backslash.
    //
    // The chain is planted in the injected fs's realpathSync rather than on
    // disk because `symlinkSync` is EPERM on Windows without Developer Mode —
    // and `realpath` returning the root for a three-deep lexical path is
    // EXACTLY what a real chain of `.` links makes it return (measured on
    // POSIX by the reviewer, with junctions here).
    const dir = mkTmp();
    const root = fs.realpathSync(dir);
    const links = [];
    const chainFs = {
      ...fs,
      symlinkSync: (target, dest) => links.push({ target, dest }),
      realpathSync: (p) => {
        const rel = path.relative(root, String(p));
        return rel !== '' && rel.split(path.sep).every((seg) => /^L[0-9]$/.test(seg))
          ? root
          : fs.realpathSync(p);
      },
    };

    const err = await extractZipBuffer(buildZip([
      { name: 'L0', body: '.', mode: MODE_SYMLINK },
      { name: 'L0/L1', body: '.', mode: MODE_SYMLINK },
      { name: 'L0/L1/L2', body: '.', mode: MODE_SYMLINK },
      { name: 'L0/L1/L2/x', body: '../../../victim.txt', mode: MODE_SYMLINK },
    ]), { dir, deps: { fs: chainFs } }).catch((e) => e);

    expect(err.code).toBe('UNZIP_UNSAFE_ARCHIVE');
    expect(err.message).toMatch(/^Out of bound path /);
    expect(err.message).toMatch(/L0\/L1\/L2\/x$/);
    // The three `.` links are legitimate (they resolve to the root itself); the
    // escaping fourth is the only one refused, and it was never created.
    expect(links).toHaveLength(3);
    expect(links.every((l) => l.target === '.')).toBe(true);
  });

  test('a symlink that walks UP and back DOWN inside the root is allowed', async () => {
    // `../Resources/x` from `Contents/MacOS/` is a normal bundle shape and must
    // not be caught by a check that only looks for a leading `..`.
    const links = [];
    const dir = mkTmp();

    await extractZipBuffer(buildZip([
      { name: 'app/Contents/MacOS/link', body: '../Resources/x', mode: MODE_SYMLINK },
    ]), { dir, deps: { fs: recordingFs(links) } });

    expect(links).toHaveLength(1);
    expect(links[0].target).toBe('../Resources/x');
  });

  test('a symlink amicus cannot create is a DESTINATION failure, not a bad archive', async () => {
    // Windows without Developer Mode: EPERM. The archive is fine; the machine
    // cannot represent it. Reporting that as corruption would evict a good
    // cache entry (D2 again, on a shape only non-Windows produces).
    const dir = mkTmp();
    const epermFs = { ...fs, symlinkSync: () => { const e = new Error('EPERM'); e.code = 'EPERM'; throw e; } };

    const err = await extractZipBuffer(buildZip([
      { name: 'app/link', body: 'target', mode: MODE_SYMLINK },
    ]), { dir, deps: { fs: epermFs } }).catch((e) => e);

    expect(err.code).toBe('UNZIP_DEST_FAILED');
  });
});

describe('extractBytesToDist — a partial extraction never becomes dist/', () => {
  test('the extractor is handed a BUFFER and a path OUTSIDE dist/', async () => {
    const electronDir = mkTmp('amicus-electron-');
    const bytes = Buffer.from('THE-VERIFIED-BYTES');
    let sawBytes = null;
    let sawDir = null;
    const extract = jest.fn(async (b, o) => {
      sawBytes = b; sawDir = o.dir;
      fs.writeFileSync(path.join(o.dir, 'electron.exe'), 'MZ');
    });

    await extractBytesToDist({ bytes, electronDir, platform: 'win32', extract, fs });

    expect(sawBytes).toBe(bytes);                                   // the same object, not a re-read
    expect(sawDir).not.toBe(path.join(electronDir, 'dist'));
    expect(path.basename(path.dirname(sawDir)).startsWith('.amicus-incoming-')).toBe(true);
    expect(fs.readFileSync(path.join(electronDir, 'dist', 'electron.exe'), 'utf8')).toBe('MZ');
    expect(fs.readFileSync(path.join(electronDir, 'path.txt'), 'utf8')).toBe('electron.exe');
  });

  test('a failed extraction never becomes dist/ (PROMOTEPARTIAL)', async () => {
    // The whole point of the incoming directory. A half-written tree in `dist/`
    // is a shape `isElectronUsable` and `verifyExtractOutcome` both READ, so an
    // ENOSPC used to leave a broken install where a working one had been.
    const electronDir = mkTmp('amicus-electron-');
    fs.mkdirSync(path.join(electronDir, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(electronDir, 'dist', 'electron.exe'), 'MZ-OLD-BUT-WORKING');
    const extract = jest.fn(async (_b, o) => {
      fs.writeFileSync(path.join(o.dir, 'partial.bin'), 'HALF');
      const e = new Error('ENOSPC'); e.code = 'UNZIP_DEST_FAILED'; throw e;
    });

    await expect(extractBytesToDist({ bytes: Buffer.from('x'), electronDir, platform: 'win32', extract, fs }))
      .rejects.toMatchObject({ code: 'UNZIP_DEST_FAILED' });

    expect(fs.readFileSync(path.join(electronDir, 'dist', 'electron.exe'), 'utf8')).toBe('MZ-OLD-BUT-WORKING');
    expect(fs.existsSync(path.join(electronDir, 'dist', 'partial.bin'))).toBe(false);
    // ...and the incoming directory is not left behind as litter.
    expect(fs.readdirSync(electronDir).filter((n) => n.startsWith('.amicus-incoming-'))).toEqual([]);
  });

  test('the promote REPLACES the old tree rather than merging into it', async () => {
    const electronDir = mkTmp('amicus-electron-');
    fs.mkdirSync(path.join(electronDir, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(electronDir, 'dist', 'stale.dll'), 'FROM-A-PREVIOUS-VERSION');
    const extract = async (_b, o) => { fs.writeFileSync(path.join(o.dir, 'electron.exe'), 'MZ-NEW'); };

    await extractBytesToDist({ bytes: Buffer.from('x'), electronDir, platform: 'win32', extract, fs });

    expect(treeOf(path.join(electronDir, 'dist'))).toEqual(['electron.exe:6']);
    expect(fs.readdirSync(electronDir).filter((n) => n.startsWith('.amicus-retired-'))).toEqual([]);
  });

  test('a promote that cannot swap ROLLS BACK to the tree that was there', async () => {
    const electronDir = mkTmp('amicus-electron-');
    const distDir = path.join(electronDir, 'dist');
    fs.mkdirSync(distDir, { recursive: true });
    fs.writeFileSync(path.join(distDir, 'electron.exe'), 'MZ-OLD');
    const incoming = path.join(electronDir, '.amicus-incoming-test', 'dist');
    fs.mkdirSync(incoming, { recursive: true });
    fs.writeFileSync(path.join(incoming, 'electron.exe'), 'MZ-NEW');
    let renames = 0;
    const failingSwapFs = {
      ...fs,
      renameSync: (from, to) => {
        renames += 1;
        if (renames === 2) { const e = new Error('EPERM'); e.code = 'EPERM'; throw e; }
        return fs.renameSync(from, to);
      },
    };

    expect(() => promoteDist({ electronDir, incomingDist: incoming, platform: 'win32', fs: failingSwapFs }))
      .toThrow(/EPERM/);

    expect(fs.readFileSync(path.join(distDir, 'electron.exe'), 'utf8')).toBe('MZ-OLD');
    expect(fs.readdirSync(electronDir).filter((n) => n.startsWith('.amicus-retired-'))).toEqual([]);
  });

  test('path.txt is written only AFTER dist/ is in place', async () => {
    const electronDir = mkTmp('amicus-electron-');
    const order = [];
    const orderedFs = {
      ...fs,
      renameSync: (a, b) => { order.push('rename'); return fs.renameSync(a, b); },
      writeFileSync: (p, d) => { if (String(p).endsWith('path.txt')) { order.push('path.txt'); } return fs.writeFileSync(p, d); },
    };
    const extract = async (_b, o) => { fs.writeFileSync(path.join(o.dir, 'electron'), 'ELF'); };

    await extractBytesToDist({ bytes: Buffer.from('x'), electronDir, platform: 'linux', extract, fs: orderedFs });

    expect(order).toEqual(['rename', 'path.txt']);
  });
});
