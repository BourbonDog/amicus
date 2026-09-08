/**
 * CUSTODY of the Electron artifact: one open, one read, one Buffer.
 *
 * THE PROPERTY THIS MODULE EXISTS TO MAKE TRUE, and the only one it claims:
 *
 *   **Amicus never itself writes, or reports as verified, bytes it did not hash.**
 *
 * Deliberately NOT "the user launches genuine Electron". A live attacker
 * running as the same uid can overwrite `<electronDir>/dist/electron.exe`
 * directly, at any moment, with no artifact involved at all — so no
 * acquisition-time design can promise that, and claiming it would be the
 * overclaim this whole change exists to stop.
 *
 * WHY A BUFFER, AND NOT A FILE DESCRIPTOR. Two council designs independently
 * probed the fd remedy and both refuted it: a descriptor names an INODE, not a
 * version of an inode. A same-uid `writeFileSync` at the path truncates and
 * rewrites that same inode, and a positional read through our retained fd then
 * returns the attacker's bytes (MEASURED twice, on Windows 11 / NTFS / Node
 * 24.18: `"CLEANCLEANCLEAN"` before, `"POISONPOISONPOI"` after, through the
 * SAME fd). A Buffer is different in kind: once the bytes are in this process's
 * heap, no filesystem write can reach them. That is the whole design.
 *
 * WHY NOT A PRIVATE COPY EITHER — the remedy this replaces. v4.9.6 copied the
 * artifact into a fresh 0700 `mkdtempSync` directory and asserted the attacker
 * had "no name for it and no handle on it". MEASURED false on both halves: a
 * spinner found the fixed `amicus-electron-stage-` prefix on its FIRST readdir
 * of `os.tmpdir()`, opened the copy `r+` as the same user, and overwrote it;
 * and on Windows `mkdtempSync` yields mode 666 while the module skipped its own
 * `chmod(0o700)` on win32, so the 0700 was never even attempted. 0700 excludes
 * OTHER users; the attacker in this threat model is THIS user.
 *
 * WHAT THE THREAT MODEL IS. An attacker who can write the Electron download
 * cache directory, running as the same user as amicus. Out of scope, and stated
 * rather than implied: that same user can also read and write amicus's process
 * memory (`WriteProcessMemory`, or `process_vm_writev` under
 * `yama.ptrace_scope=0`), rewrite amicus's own `node_modules`, or edit its
 * config. Against THAT capability nothing here matters — an attacker in our
 * address space can simply flip the gate's own verdict. This module closes the
 * attacker whose capability is WRITING FILES, which is the one the digest gate
 * makes sense against: a less-trusted cache root — a shared build box, a
 * restored CI cache volume, a container bind-mount — read by a process whose
 * own tree is trusted.
 *
 * NEAR-LEAF MODULE: `fs` + `path`, plus the pure house sanitizer
 * `utils/text-sanitize`. Requires nothing in this cluster, so it can be
 * required from either side of the electron-install -> electron-provision arrow.
 *
 * @module sidecar/electron-custody
 */

'use strict';

const fsDefault = require('fs');
const path = require('path');

/** Positional-read chunk. 8 MiB keeps the loop at ~18 reads for a 138 MiB artifact. */
const READ_CHUNK = 8 * 1024 * 1024;

/**
 * An electron artifact larger than this is not an electron artifact. The real
 * win32 x64 artifact measured 138 MiB (144,265,219 bytes); darwin and linux are
 * the same order. The cap is checked against `fstat`'s size BEFORE anything is
 * allocated, so a 4 GiB sparse file planted in the cache costs one `fstat`.
 */
const MAX_ARTIFACT_BYTES = 1024 * 1024 * 1024;

/**
 * The ONLY shape allowed to become a path component:
 * `electron-v<version>-<platform>-<arch>.zip`, with each field restricted to
 * characters an electron version / platform / arch can actually contain.
 *
 * An ALLOW-list on purpose. A deny-list of `..` and separators is the shape
 * that keeps losing — it has to anticipate every dialect (`..`, `%2e%2e`, a
 * bare `\` that only win32's `path` treats as a separator), and it fails open
 * on the one it did not think of. This fails closed on everything it was not
 * written for.
 *
 * MOVED HERE from the deleted `electron-stage.js`, unchanged. It is still
 * load-bearing: `version` is read out of `<electronDir>/package.json` whenever
 * the caller supplies none, and `doctor --fix` — the one production caller —
 * supplies none, for a directory it located by SCANNING npx caches. MEASURED
 * before the check, end to end, with a planted `"version": "43.1.1/../../victim"`:
 * a path two levels outside the intended directory was written and a
 * pre-existing file there was destroyed.
 */
const ARTIFACT_NAME = /^electron-v[0-9A-Za-z][0-9A-Za-z.+-]*-[0-9A-Za-z_]+-[0-9A-Za-z_]+\.zip$/;

/**
 * True when `fileName` is a plain filename amicus itself could have produced.
 *
 * Both halves are checked deliberately. The pattern is the real control; the
 * `path.basename` equality states the property in the platform's OWN dialect,
 * so the claim "this is a filename, not a path" is asserted by the module that
 * defines what a path is rather than only by a regex that has to imitate it.
 * @param {*} fileName
 * @returns {boolean}
 */
function isSafeArtifactName(fileName) {
  return typeof fileName === 'string'
    && fileName === path.basename(fileName)
    && ARTIFACT_NAME.test(fileName);
}

/**
 * Read `zip` into memory EXACTLY ONCE, through ONE descriptor.
 *
 * THE PATH IS RESOLVED ONCE AND NEVER AGAIN. `fstatSync(fd)` — never
 * `statSync(zip)` — so even the size we act on comes from the handle we opened;
 * a symlink is already resolved, and a swap after this point cannot change the
 * answer. Every read is POSITIONAL (`readSync(fd, buf, off, len, POSITION)`),
 * so the shared file offset is never used and nothing else in this process can
 * perturb it.
 *
 * THERE IS NO "COULD NOT ALLOCATE" BRANCH, and that is deliberate. Two council
 * designs promised one; both were MEASURED wrong. `Buffer.allocUnsafe` does not
 * throw when the machine is out of memory — the process dies, exactly as it
 * does today when extract-zip inflates a 215 MiB entry. Writing a clean
 * `{why:'no-memory'}` refusal and claiming it works would be a failure branch
 * this change never executed. What DOES protect the allocation is `maxBytes`,
 * checked against `fstat` before a byte is reserved.
 *
 * A TORN READ NEEDS NO SPECIAL HANDLING. If the attacker mutates the file while
 * we are reading it, the buffer we assembled is what would have been extracted,
 * its sha256 will not match the anchor, and the gate refuses. `grew` and
 * `short-read` exist to name the shape, not to provide the security.
 *
 * @param {object} o
 * @param {string} o.zip        attacker-influenced path (a cache entry, or what
 *                              `downloadArtifact` handed back)
 * @param {number} [o.maxBytes] default MAX_ARTIFACT_BYTES
 * @param {object} [o.fs]
 * @returns {{bytes: Buffer, size: number}
 *         | {bytes: null, why: 'unreadable'|'not-a-file'|'empty'|'too-large'|'short-read'|'grew',
 *            detail: string}}
 */
function readArtifactBytes({ zip, maxBytes = MAX_ARTIFACT_BYTES, fs = fsDefault }) {
  let fd;
  try {
    fd = fs.openSync(zip, 'r');
  } catch (e) {
    return { bytes: null, why: 'unreadable', detail: (e && e.message) || String(e) };
  }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) {
      return { bytes: null, why: 'not-a-file', detail: 'it is not a regular file' };
    }
    if (st.size === 0) {
      return { bytes: null, why: 'empty', detail: 'it is empty' };
    }
    if (st.size > maxBytes) {
      return { bytes: null, why: 'too-large', detail: `${st.size} bytes exceeds the ${maxBytes}-byte ceiling` };
    }
    const bytes = Buffer.allocUnsafe(st.size);
    let off = 0;
    while (off < st.size) {
      const n = fs.readSync(fd, bytes, off, Math.min(READ_CHUNK, st.size - off), off);
      if (!(n > 0)) {
        return { bytes: null, why: 'short-read', detail: `the file ended after ${off} of ${st.size} bytes` };
      }
      off += n;
    }
    // One positional read PAST the size we trusted. A file that grew under us is
    // what an active swap looks like, and it means the bytes we hold are a prefix
    // of something else — say that, rather than hashing a truncation.
    const tail = Buffer.allocUnsafe(1);
    if (fs.readSync(fd, tail, 0, 1, st.size) > 0) {
      return { bytes: null, why: 'grew', detail: 'it changed size while amicus was reading it' };
    }
    return { bytes, size: st.size };
  } catch (e) {
    return { bytes: null, why: 'unreadable', detail: (e && e.message) || String(e) };
  } finally {
    try { fs.closeSync(fd); } catch { /* already closed */ }
  }
}

module.exports = {
  readArtifactBytes, isSafeArtifactName, MAX_ARTIFACT_BYTES, READ_CHUNK,
};
