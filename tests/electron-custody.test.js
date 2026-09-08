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
 * SYMLINKESCAPE    zip-entry-write.js :: writeSymlink — drop the resolved-target
 *   bounds check, so a symlink may point anywhere.
 *   RED: "a symlink whose target leaves the extraction root is REFUSED".
 * SYMLINKCHAIN     zip-entry-write.js :: writeSymlink — resolve the target
 *   against the LEXICAL `path.dirname(dest)` instead of the realpath'd
 *   `canonical` the caller already computed.
 *   RED: "the target is resolved against the REAL directory, not the lexical one".
 * PROMOTEPARTIAL   electron-layout.js :: extractBytesToDist — extract straight
 *   into `<electronDir>/dist` instead of into `.amicus-incoming-<hex>/dist`.
 *   RED: "a failed extraction never becomes dist/".
 * PROMOTEDESTROYSOLD electron-layout.js :: promoteDist — drop the
 *   holds-an-executable guard, so a step-1 rename failure removes the old tree
 *   in place with nothing to roll back to.
 *   RED: "a promote that cannot retire a WORKING dist/ REFUSES rather than
 *   destroying it".
 * DESTERRORISARCHIVE zip-entry-write.js :: writeEntry — tag a write failure
 *   `UNZIP_BUFFER_FAILED` instead of `UNZIP_DEST_FAILED`.
 *   RED: "a DESTINATION failure is not reported as a bad archive (D2)".
 * COLLECTUNCLASSIFIED zip-entry-write.js :: collect — restore the bare
 *   `stream.on('error', reject)`, so a read error reaches the caller with no
 *   `code` and is read as "the archive is bad".
 *   RED: "a read error on the symlink TARGET is CLASSIFIED, never raw".
 * SWEEPMISSING    electron-layout.js :: extractBytesToDist — delete the
 *   `sweepPromoteLitter` call, restoring the state where nothing in src/,
 *   scripts/ or bin/ ever removed `.amicus-incoming-*` or `.amicus-retired-*`.
 *   RED: "abandoned incoming and retired trees are SWEPT by the next provision".
 * STALLUNBOUNDED  zip-from-buffer.js :: extractZipBuffer — delete the idle and
 *   hard-cap timers, restoring the unbounded promise the electron path had.
 *   RED: "an extract that makes no progress rejects on the IDLE bound", "an
 *   extract that never ends rejects on the HARD cap", and "the default bounds
 *   are unzip.js's own numbers".
 * IDLEONENTRIES   zip-from-buffer.js :: extractZipBuffer — arm the idle watchdog
 *   against ENTRY COMPLETION instead of bytes written (drop the
 *   `written !== atBytes` term), which is what the first cut of the bound did.
 *   RED: "ONE big entry writing steadily is progress, not a stall".
 * FIREDBUTRAN     zip-from-buffer.js :: extractZipBuffer — let `fail()` reject
 *   without aborting, so the bound REPORTS a stall while the write it was
 *   supposed to stop carries on.
 *   RED: "when the bound FIRES nothing further is written, and no incoming tree
 *   is left".
 * UNWINDUNBOUNDED zip-from-buffer.js :: extractZipBuffer — restore the round-3
 *   `await inFlight.catch(() => {})` in place of the bounded `awaitUnwind`, so
 *   the extractor waits forever for a write that can never come apart (yauzl's
 *   endpoint `destroy` emits nothing, so `pipeline` never settles).
 *   RED: "the bound SETTLES even when the aborted write can NEVER come apart",
 *   and both fake-timer bound tests, which now fire with an entry in flight.
 * ──────────────────────────────────────────────────────────────────────────
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable, Writable } = require('stream');

const { readArtifactBytes, isSafeArtifactName, MAX_ARTIFACT_BYTES } = require('../src/sidecar/electron-custody');
const { extractZipBuffer } = require('../src/sidecar/zip-from-buffer');
const {
  extractBytesToDist, promoteDist, sweepPromoteLitter,
} = require('../src/sidecar/electron-layout');
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

describe('the extraction is BOUNDED — a stall is an outcome, not a hang (STALLUNBOUNDED)', () => {
  // THE LOSS THIS CLOSES. unzip.js exists for a field bug that was never
  // root-caused: extract-zip@2.0.1 stalls mid-extract on some Node 24 boxes, its
  // promise never resolving and never rejecting, so the awaiting self-heal let
  // the event loop drain and Node exited 0 with a partial extract and NO
  // message. Its layer 1 was an idle timer plus a hard cap, whose LIVE handle is
  // what stops the process exiting mid-stall. When the electron artifact moved
  // onto extractZipBuffer that bound went with unzip.js and nothing replaced
  // it — grep for stall/idle/timeout across the new modules and their tests
  // returned nothing on the subject. It is back, with unzip.js's own numbers,
  // and unzip.js itself is untouched.

  /** Injectable timers: nothing here waits on a real clock. */
  function fakeTimers() {
    const pending = new Map();
    let id = 0;
    return {
      pending,
      setTimeout: (fn, ms) => { id += 1; pending.set(id, { fn, ms }); return id; },
      clearTimeout: (t) => { pending.delete(t); },
      fireByMs: (ms) => {
        for (const [key, entry] of [...pending]) {
          if (entry.ms === ms) { pending.delete(key); entry.fn(); return true; }
        }
        return false;
      },
    };
  }

  /**
   * A yauzl whose openReadStream NEVER calls back: the entry never settles.
   * `reached.hit` records that the driver actually got that far — round 4, where
   * firing the bound BEFORE yauzl's first 'entry' was measured to skip the whole
   * in-flight path and hide a blocker inside it.
   */
  function wedgedYauzl(reached = {}) {
    // eslint-disable-next-line global-require
    const yauzl = require('yauzl');
    return {
      fromBuffer: (b, o, cb) => yauzl.fromBuffer(b, o, (e, zf) => {
        if (zf) { zf.openReadStream = () => { reached.hit = true; }; }
        cb(e, zf);
      }),
    };
  }

  /** Let the microtask/immediate queues drain so a stream stage can run. */
  const settleIo = async (turns = 6) => {
    for (let i = 0; i < turns; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setImmediate(r));
    }
  };

  // ROUND 4 — BOTH OF THESE FIRED THE BOUND TOO EARLY TO REACH THE BUG.
  // They ran ONE `setImmediate` before firing, which is before yauzl has emitted
  // its first 'entry', so `inFlight` was still null and the extractor's wait for
  // the aborted write was skipped entirely. MEASURED by varying only the number
  // of turns, everything else identical: turns=1 rejected, turns=2 rejected,
  // turns=4 STILL PENDING. So they passed on a timing accident while the code
  // they cover could not settle at all. Both now wait for `openReadStream` to be
  // REACHED, and assert it.

  test('an extract that makes no progress rejects on the IDLE bound', async () => {
    const timers = fakeTimers();
    const dir = mkTmp();
    const reached = {};

    const p = extractZipBuffer(buildZip([{ name: 'a.txt', body: 'x' }]), {
      dir,
      idleMs: 1234,
      maxMs: 5678,
      unwindMs: 4321,
      deps: {
        yauzl: wedgedYauzl(reached), setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout,
      },
    });
    await settleIo();
    expect(reached.hit).toBe(true);              // an entry really is in flight
    expect(timers.fireByMs(1234)).toBe(true);
    await settleIo();
    // That entry can NEVER come apart — its openReadStream callback never
    // arrives — so the UNWIND bound is what ends the wait for it.
    expect(timers.fireByMs(4321)).toBe(true);

    const err = await p.catch((e) => e);
    expect(err.code).toBe('UNZIP_BUFFER_STALLED');
    expect(err.message).toMatch(/no extract progress for 1234ms/);
    // ...and NOT a verdict about the artifact, which is what evicts it.
    expect(err.code).not.toBe('UNZIP_BUFFER_FAILED');
  });

  test('an extract that never ends rejects on the HARD cap', async () => {
    const timers = fakeTimers();
    const dir = mkTmp();
    const reached = {};

    const p = extractZipBuffer(buildZip([{ name: 'a.txt', body: 'x' }]), {
      dir,
      idleMs: 1234,
      maxMs: 5678,
      unwindMs: 4321,
      deps: {
        yauzl: wedgedYauzl(reached), setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout,
      },
    });
    await settleIo();
    expect(reached.hit).toBe(true);
    expect(timers.fireByMs(5678)).toBe(true);
    await settleIo();
    expect(timers.fireByMs(4321)).toBe(true);

    const err = await p.catch((e) => e);
    expect(err.code).toBe('UNZIP_BUFFER_STALLED');
    expect(err.message).toMatch(/exceeded 5678ms/);
  });

  test('a normal extraction leaves NO timer behind, and re-arms the idle window per entry', async () => {
    const timers = fakeTimers();
    const dir = mkTmp();

    const res = await extractZipBuffer(buildZip([
      { name: 'a.txt', body: 'one' },
      { name: 'b.txt', body: 'two' },
      { name: 'c.txt', body: 'three' },
    ]), {
      dir,
      idleMs: 1234,
      maxMs: 5678,
      deps: { setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout },
    });

    expect(res).toEqual({ strategy: 'buffer', entries: 3 });
    // No live handle survives a completed extraction, so nothing here can hold
    // the event loop open after the repair returns.
    expect(timers.pending.size).toBe(0);
  });

  test('the default bounds are unzip.js\'s own numbers, so the electron path is bounded again', async () => {
    // The production call site (electron-install.js) passes no idleMs/maxMs, so
    // what matters is that the DEFAULTS arm real timers. Measured through the
    // injected clock: two timers, 30 s and 240 s.
    const timers = fakeTimers();
    const dir = mkTmp();
    const armed = [];

    const p = extractZipBuffer(buildZip([{ name: 'a.txt', body: 'x' }]), {
      dir,
      deps: {
        yauzl: wedgedYauzl(),
        setTimeout: (fn, ms) => { armed.push(ms); return timers.setTimeout(fn, ms); },
        clearTimeout: timers.clearTimeout,
      },
    });
    await settleIo();

    expect(armed).toEqual([240_000, 30_000]);
    expect(timers.fireByMs(30_000)).toBe(true);
    await settleIo();
    // ...and the THIRD default, armed only once there is an aborted write to
    // wait for: `zip-stall-bound.UNWIND_MS`. Without it this call never settles.
    expect(armed).toEqual([240_000, 30_000, 5_000]);
    expect(timers.fireByMs(5_000)).toBe(true);

    await expect(p).rejects.toMatchObject({ code: 'UNZIP_BUFFER_STALLED' });
  });

  // ── ROUND 3: the bound above was armed against the wrong signal, and did not
  // stop anything when it fired. Seat A1 and seat B2 filed opposite halves of
  // the same defect. These two tests are the halves.

  /**
   * A yauzl whose entry stream is driven BY THE TEST. Everything else about the
   * entry is the real library's — attributes, mode, crc32 — so only the PACE is
   * synthetic. `feed(n)` releases the next n bytes of `body`.
   */
  function pacedYauzl(body) {
    // eslint-disable-next-line global-require
    const yauzl = require('yauzl');
    let source = null;
    let at = 0;
    return {
      deps: {
        fromBuffer: (b, o, cb) => yauzl.fromBuffer(b, o, (e, zf) => {
          if (zf) {
            zf.openReadStream = (_entry, callback) => {
              source = new Readable({ read() {} });
              callback(null, source);
            };
          }
          cb(e, zf);
        }),
      },
      feed(n) {
        source.push(body.subarray(at, Math.min(at + n, body.length)));
        at = Math.min(at + n, body.length);
        if (at >= body.length) { source.push(null); }
      },
    };
  }

  /** An fs whose write stream RECORDS every chunk it is handed and accepts it. */
  function recordingFs(writes) {
    return {
      ...fs,
      createWriteStream: () => new Writable({
        write(chunk, _enc, cb) { writes.push(chunk.length); cb(); },
      }),
    };
  }

  test('ONE big entry writing steadily is progress, not a stall (IDLEONENTRIES)', async () => {
    // Seat B2. The real artifact contains a 225 MB electron.exe — ONE entry. The
    // first bound re-armed on ENTRY COMPLETION, so on storage slower than
    // 7.5 MB/s that single entry blew a 30 s window while writing perfectly
    // well, and a VALID repair was failed. Here the idle window expires FIVE
    // times while one entry is mid-write and never completes; each time bytes
    // have moved, so each is progress. The body is deliberately larger than the
    // five 64 KiB feeds, so the entry is still unfinished at every expiry.
    const body = Buffer.alloc(640 * 1024, 7);
    const paced = pacedYauzl(body);
    const timers = fakeTimers();
    const writes = [];
    const dir = mkTmp();

    const p = extractZipBuffer(buildZip([{ name: 'big.bin', body: body.toString('latin1') }]), {
      dir,
      idleMs: 1234,
      maxMs: 999_999,
      deps: {
        fs: recordingFs(writes),
        yauzl: paced.deps,
        setTimeout: timers.setTimeout,
        clearTimeout: timers.clearTimeout,
      },
    });
    await settleIo();
    for (let i = 0; i < 5; i += 1) {
      paced.feed(64 * 1024);
      // eslint-disable-next-line no-await-in-loop
      await settleIo();
      expect(timers.fireByMs(1234)).toBe(true);   // the window expires...
      // eslint-disable-next-line no-await-in-loop
      await settleIo();                           // ...and re-arms, because BYTES moved
    }
    paced.feed(body.length);                      // finish the entry
    await settleIo();

    // Zero entries had completed at every one of those five expiries, so a bound
    // armed against entries would have failed this repair five times over.
    expect(await p).toEqual({ strategy: 'buffer', entries: 1 });
    expect(writes.reduce((a, b) => a + b, 0)).toBe(body.length);
  });

  test('when the bound FIRES nothing further is written, and no incoming tree is left (FIREDBUTRAN)', async () => {
    // Seat A1: the bound "does not actually stop extraction". It rejected the
    // outer promise and left the write in flight, so bytes kept landing in a
    // directory the caller was already deleting. Driven end to end through
    // extractBytesToDist, which is the caller that does the deleting.
    const body = Buffer.alloc(320 * 1024, 3);
    const paced = pacedYauzl(body);
    const timers = fakeTimers();
    const writes = [];
    const rfs = recordingFs(writes);
    const electronDir = mkTmp('amicus-firedbutran-');

    const p = extractBytesToDist({
      bytes: buildZip([{ name: 'big.bin', body: body.toString('latin1') }]),
      electronDir,
      platform: 'win32',
      fs: rfs,
      extract: (bytes, o) => extractZipBuffer(bytes, {
        ...o,
        idleMs: 1234,
        maxMs: 999_999,
        deps: {
          fs: rfs,
          yauzl: paced.deps,
          setTimeout: timers.setTimeout,
          clearTimeout: timers.clearTimeout,
        },
      }),
    }).then(() => ({ ok: true }), (e) => ({ err: e }));

    await settleIo();
    paced.feed(64 * 1024);                        // one chunk of real progress
    await settleIo();
    expect(timers.fireByMs(1234)).toBe(true);     // progress seen -> re-armed
    await settleIo();
    expect(writes.length).toBeGreaterThan(0);
    expect(timers.fireByMs(1234)).toBe(true);     // nothing moved -> THE BOUND FIRES
    const atFire = writes.length;

    // The archive still has 256 KiB to give. A bound that only REPORTS would let
    // every byte of it land; this asserts the work stopped, not that a rejection
    // happened.
    paced.feed(body.length);
    await settleIo(12);
    expect(writes.length).toBe(atFire);

    const out = await p;
    expect(out.err.code).toBe('UNZIP_BUFFER_STALLED');
    expect(out.err.code).not.toBe('UNZIP_BUFFER_FAILED');   // never an artifact verdict
    // ...and the half-written tree is gone, which is only safe because the
    // extractor waits for the aborted write to unwind before it throws.
    expect(fs.readdirSync(electronDir).filter((n) => n.startsWith('.amicus-incoming-'))).toEqual([]);
    expect(fs.existsSync(path.join(electronDir, 'dist'))).toBe(false);
  });

  // ── ROUND 4: the round-3 remedy above reintroduced the hang it removed. To
  // keep the caller's cleanup off a live descriptor it made the extractor's
  // `finally` `await inFlight` — AFTER `cancelTimers()` had cleared both live
  // handles — so on the one shape the bound exists for, `extractZipBuffer`
  // never settled and nothing was left alive to keep Node running.

  test('the bound SETTLES even when the aborted write can NEVER come apart (UNWINDUNBOUNDED)', async () => {
    // REAL timers and REAL `yauzl.openReadStream` on both shapes: nothing here
    // replaces the component whose destroy semantics the halt depends on.
    // yauzl@2.10.0 overrides its endpoint stream's `destroy` with a no-arg
    // function that emits neither 'error' nor 'close' (node_modules/yauzl/
    // index.js, lines 566-573 and 698-713), so `pipeline` — which waits for
    // every stream to close — never settles after the abort.
    //
    // MEASURED on the parent commit, Node 24.18.0: shape (B) was still PENDING
    // at 6 s with the sink accepting nothing further, and in a bare process
    // with no other handle the loop drained and Node exited 0 having printed
    // nothing. That is the ORIGINAL field bug's shape. Nothing external fires a
    // timer here — if the extractor does not end its own wait, this test hangs
    // until jest kills it.
    const bounds = { idleMs: 250, maxMs: 120_000, unwindMs: 250 };

    // (A) `openReadStream`'s callback never arrives, with an entry IN FLIGHT.
    const reached = {};
    const a = await extractZipBuffer(buildZip([{ name: 'a.txt', body: 'x' }]), {
      ...bounds, dir: mkTmp(), deps: { yauzl: wedgedYauzl(reached) },
    }).catch((e) => e);

    expect(reached.hit).toBe(true);
    expect(a.code).toBe('UNZIP_BUFFER_STALLED');

    // (B) the SINK wedges mid-entry under a real `pipeline` over yauzl's own
    // endpoint stream — a hung AV filter, or a network volume that stops
    // acknowledging writes. This is the shape a stub Readable cannot model.
    const accepted = [];
    const wedgingFs = {
      ...fs,
      createWriteStream: () => new Writable({
        write(chunk, _enc, cb) { accepted.push(chunk.length); if (accepted.length === 1) { cb(); } },
      }),
    };
    const body = Buffer.alloc(1024 * 1024, 7);
    const b = await extractZipBuffer(buildZip([{ name: 'big.bin', body: body.toString('latin1') }]), {
      ...bounds, dir: mkTmp(), deps: { fs: wedgingFs },
    }).catch((e) => e);

    expect(b.code).toBe('UNZIP_BUFFER_STALLED');
    expect(accepted.length).toBeGreaterThan(0);     // it really was mid-write
    expect(accepted.reduce((x, y) => x + y, 0)).toBeLessThan(body.length);
  }, 20_000);
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

  test('a read error on the symlink TARGET is CLASSIFIED, never raw (COLLECTUNCLASSIFIED)', async () => {
    // `collect()` was the ONLY throw site in the extractor that did not go
    // through a classified constructor: it rejected with the raw yauzl/stream
    // error, which carries no `code`. `electron-repair-cache` reads an
    // unclassified extract failure as "the archive is bad" and DELETES the
    // user's cached artifact, so this one un-tagged rejection was a live path
    // from an internal read error to a destroyed air-gapped cache.
    const yauzl = require('yauzl');
    const { Readable } = require('stream');
    const spy = {
      fromBuffer: (bytes, opts, cb) => yauzl.fromBuffer(bytes, opts, (err, zf) => {
        if (zf) {
          const real = zf.openReadStream.bind(zf);
          zf.openReadStream = (entry, ecb) => real(entry, (e, stream) => {
            if (e) { ecb(e); return; }
            stream.destroy();
            // Raised from `read()`, so it lands AFTER the consumer has attached
            // its listeners — which is what a real mid-read I/O error looks like.
            ecb(null, new Readable({ read() { this.destroy(new Error('EIO: a raw stream error')); } }));
          });
        }
        cb(err, zf);
      }),
    };
    const dir = mkTmp();

    const err = await extractZipBuffer(buildZip([
      { name: 'app/link', body: 'target', mode: MODE_SYMLINK },
    ]), { dir, deps: { yauzl: spy, fs: { ...fs, symlinkSync: () => {} } } }).catch((e) => e);

    expect(err.code).toBe('UNZIP_BUFFER_FAILED');
    expect(err.message).toMatch(/could not read the symlink target for app\/link/);
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

  test('a promote that cannot retire a WORKING dist/ REFUSES rather than destroying it (PROMOTEDESTROYSOLD)', () => {
    // MEASURED on the code as shipped in this branch: with every `renameSync`
    // throwing EPERM and real deletes (a Windows AV filter driver denying
    // MoveFile on a tree holding a freshly written electron.exe — this module's
    // most-documented field failure), the step-1 catch deleted the working tree,
    // `retiredExists` stayed false, the step-2 rename then failed with NO
    // rollback, and extractBytesToDist's `finally` deleted the new tree too:
    //   {"threw":"EPERM","distExists":false,"userHasOldTree":false}
    // The docblock certified that could not happen. A user who had a working GUI
    // was left with an electron package holding no dist/ at all.
    const electronDir = mkTmp('amicus-electron-');
    const distDir = path.join(electronDir, 'dist');
    fs.mkdirSync(distDir, { recursive: true });
    fs.writeFileSync(path.join(distDir, 'electron.exe'), 'MZ-OLD-BUT-WORKING');
    const incoming = path.join(electronDir, '.amicus-incoming-test', 'dist');
    fs.mkdirSync(incoming, { recursive: true });
    fs.writeFileSync(path.join(incoming, 'electron.exe'), 'MZ-NEW');
    const noRenameFs = {
      ...fs,
      renameSync: () => { const e = new Error('EPERM: operation not permitted, rename'); e.code = 'EPERM'; throw e; },
    };

    expect(() => promoteDist({ electronDir, incomingDist: incoming, platform: 'win32', fs: noRenameFs }))
      .toThrow(/EPERM/);

    // The guarantee: a dist/ that held an executable is never removed unless the
    // new tree is already in its place.
    expect(fs.readFileSync(path.join(distDir, 'electron.exe'), 'utf8')).toBe('MZ-OLD-BUT-WORKING');
  });

  test('a promote that cannot retire a BROKEN dist/ still lands the new tree', () => {
    // The control for the test above, and the reason the guard is "holds an
    // executable" rather than "refuse whenever the rename fails": repairElectron
    // runs precisely when dist/ is broken, so refusing there would make the
    // self-heal unable to fix the case it exists for. A dist/ with no exe is not
    // an install, and removing it costs the user nothing they had.
    const electronDir = mkTmp('amicus-electron-');
    const distDir = path.join(electronDir, 'dist');
    fs.mkdirSync(distDir, { recursive: true });
    fs.writeFileSync(path.join(distDir, 'quarantined-leftovers.dll'), 'JUNK');
    const incoming = path.join(electronDir, '.amicus-incoming-test', 'dist');
    fs.mkdirSync(incoming, { recursive: true });
    fs.writeFileSync(path.join(incoming, 'electron.exe'), 'MZ-NEW');
    const noRetireFs = {
      ...fs,
      renameSync: (from, to) => {
        if (from === distDir) { const e = new Error('EPERM: rename'); e.code = 'EPERM'; throw e; }
        return fs.renameSync(from, to);
      },
    };

    promoteDist({ electronDir, incomingDist: incoming, platform: 'win32', fs: noRetireFs });

    expect(fs.readFileSync(path.join(distDir, 'electron.exe'), 'utf8')).toBe('MZ-NEW');
    expect(fs.existsSync(path.join(distDir, 'quarantined-leftovers.dll'))).toBe(false);
  });

  test('when the ROLLBACK also fails, the old tree survives and the message names where', () => {
    // The one exit that can still leave a user without the dist/ they had. It is
    // not silent: the retired tree is whole, is NOT deleted, and the thrown
    // message tells the user which directory to rename back.
    const electronDir = mkTmp('amicus-electron-');
    const distDir = path.join(electronDir, 'dist');
    fs.mkdirSync(distDir, { recursive: true });
    fs.writeFileSync(path.join(distDir, 'electron.exe'), 'MZ-OLD');
    const incoming = path.join(electronDir, '.amicus-incoming-test', 'dist');
    fs.mkdirSync(incoming, { recursive: true });
    fs.writeFileSync(path.join(incoming, 'electron.exe'), 'MZ-NEW');
    let renames = 0;
    const failAfterRetire = {
      ...fs,
      renameSync: (from, to) => {
        renames += 1;
        if (renames === 1) { return fs.renameSync(from, to); }
        const e = new Error('EPERM: rename'); e.code = 'EPERM'; throw e;
      },
    };

    let thrown = null;
    try {
      promoteDist({ electronDir, incomingDist: incoming, platform: 'win32', fs: failAfterRetire });
    } catch (e) { thrown = e; }

    const retired = fs.readdirSync(electronDir).filter((n) => n.startsWith('.amicus-retired-'));
    expect(retired).toHaveLength(1);
    expect(fs.readFileSync(path.join(electronDir, retired[0], 'electron.exe'), 'utf8')).toBe('MZ-OLD');
    expect(thrown.message).toContain(retired[0]);
    expect(thrown.message).toMatch(/rename it back to dist/);
  });

  test('abandoned incoming and retired trees are SWEPT by the next provision (SWEEPMISSING)', async () => {
    // MEASURED before the sweeper existed: a week-old `.amicus-incoming-<hex>`
    // and a week-old `.amicus-retired-<hex>` both survived a full provision on
    // the same electronDir. The docs said "a killed run leaves nothing to sweep
    // up" — but the incoming tree's removal is a `finally`, which a SIGKILL, a
    // Ctrl-C during `npm install`, a lid close or an AV kill does not run; and
    // the retired tree's removal fails EPERM whenever an Electron is live off
    // it. Both are inside the electron package directory, where no OS temp
    // cleaner reaches them, and each is up to a full extracted dist (~350 MB).
    const electronDir = mkTmp('amicus-electron-');
    const orphanIn = path.join(electronDir, '.amicus-incoming-6684f2a1df92');
    fs.mkdirSync(path.join(orphanIn, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(orphanIn, 'dist', 'electron.exe'), 'PARTIAL');
    const orphanRetired = path.join(electronDir, '.amicus-retired-deadbeefcafe');
    fs.mkdirSync(orphanRetired, { recursive: true });
    fs.writeFileSync(path.join(orphanRetired, 'electron.exe'), 'THE-WHOLE-PREVIOUS-DIST');
    const old = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    fs.utimesSync(orphanIn, old, old);
    fs.utimesSync(orphanRetired, old, old);
    const extract = async (_b, o) => { fs.writeFileSync(path.join(o.dir, 'electron.exe'), 'MZ-NEW'); };

    await extractBytesToDist({ bytes: Buffer.from('x'), electronDir, platform: 'win32', extract, fs });

    expect(fs.readdirSync(electronDir).sort()).toEqual(['dist', 'path.txt']);
  });

  test('a FRESH tree is LEFT ALONE, and so is this run\'s own incoming directory', async () => {
    // The age rule is not zero on purpose. A provision holds the per-electronDir
    // repair lock, but promoteDist/extractBytesToDist are callable without it,
    // and deleting a tree another process is actively writing is a worse failure
    // than leaving one behind. This is the rule the deleted `sweepStaleStages`
    // used and the one the old docs stated honestly.
    const electronDir = mkTmp('amicus-electron-');
    const fresh = path.join(electronDir, '.amicus-incoming-freshfreshfre');
    fs.mkdirSync(fresh, { recursive: true });
    let sawOwnIncoming = null;
    const extract = async (_b, o) => {
      sawOwnIncoming = path.dirname(o.dir);
      // ...and the sweep already ran, before this extractor was called.
      expect(fs.existsSync(sawOwnIncoming)).toBe(true);
      fs.writeFileSync(path.join(o.dir, 'electron.exe'), 'MZ-NEW');
    };

    await extractBytesToDist({ bytes: Buffer.from('x'), electronDir, platform: 'win32', extract, fs });

    expect(fs.existsSync(fresh)).toBe(true);
    expect(path.basename(sawOwnIncoming)).not.toBe(path.basename(fresh));
  });

  test('the sweep can never fail a provision', () => {
    // Best-effort by contract: an unreadable directory, an unstattable entry and
    // an undeletable tree all leave the provision alone.
    const electronDir = mkTmp('amicus-electron-');
    expect(sweepPromoteLitter({ electronDir, fs: { ...fs, readdirSync: () => { throw new Error('EACCES'); } } }))
      .toEqual([]);

    const stuck = path.join(electronDir, '.amicus-retired-cannotremove');
    fs.mkdirSync(stuck, { recursive: true });
    const old = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    fs.utimesSync(stuck, old, old);
    const lockedFs = { ...fs, rmSync: () => { const e = new Error('EPERM'); e.code = 'EPERM'; throw e; } };

    expect(sweepPromoteLitter({ electronDir, fs: lockedFs })).toEqual([]);
    expect(fs.existsSync(stuck)).toBe(true);                 // left for the next run
    expect(sweepPromoteLitter({ electronDir, fs })).toEqual(['.amicus-retired-cannotremove']);
  });

  test('the sweep touches ONLY the two promote prefixes', () => {
    const electronDir = mkTmp('amicus-electron-');
    const old = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    for (const name of ['dist', 'path.txt', 'package.json', '.amicus-repair.lock', '.amicus-incoming-aaaaaaaaaaaa']) {
      const full = path.join(electronDir, name);
      if (name.includes('.') && !name.startsWith('.amicus-incoming')) { fs.writeFileSync(full, 'x'); } else { fs.mkdirSync(full, { recursive: true }); }
      fs.utimesSync(full, old, old);
    }

    expect(sweepPromoteLitter({ electronDir, fs })).toEqual(['.amicus-incoming-aaaaaaaaaaaa']);
    expect(fs.readdirSync(electronDir).sort())
      .toEqual(['.amicus-repair.lock', 'dist', 'package.json', 'path.txt']);
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
