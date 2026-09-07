/**
 * PRIVATE STAGING for an Electron artifact, so the bytes that are hashed are the
 * bytes that are extracted (v4.9.6 F1).
 *
 * THE HOLE THIS CLOSES. v4.9.5's cache route hashed the zip at its path in the
 * download cache and then handed that SAME path to the extractor. Anything that
 * can write the cache directory — precisely the actor the digest gate exists to
 * stop — could swap the file between those two opens, and the unhashed
 * replacement was extracted and later launched as Electron. Three council seats
 * found it independently. A re-hash after extraction would not fix it either:
 * the swap window simply moves. The only fix is to take the bytes away from the
 * writer first.
 *
 * SO: `renameSync` the artifact into a fresh `fs.mkdtempSync` directory under
 * `os.tmpdir()`, then hash and extract THERE. The staging directory is
 * unpredictable per attempt, 0700 on POSIX, per-user on Windows, and — the whole
 * point — is NOT a subdirectory of the cache root, which would have inherited
 * exactly the write permission the attack needs.
 *
 * WHY RENAME, AND WHAT THE FALLBACK COSTS. A rename is atomic and copies no
 * bytes, and after it the attacker cannot reach them at all. It fails with
 * `EXDEV` when the cache root and `os.tmpdir()` are on different volumes (common
 * on Linux, where `/tmp` is often tmpfs and the cache is under `$HOME`); there we
 * copy instead. A copy leaves the original reachable, so the WRITER can still
 * change the file we no longer read — which is harmless, because the staged copy
 * is the one hashed and the one extracted. It costs a ~170 MB write; when that
 * write fails (no space) staging returns null and the caller falls back to a
 * download rather than extracting bytes it could not privately hold.
 *
 * NOBODY ENDS UP WITH NEITHER A CACHE ENTRY NOR A DIST. `releaseStage` is called
 * from a `finally` on every exit path and puts a moved artifact BACK where it
 * came from, unless the caller set `discard` — which it does only where v4.9.5
 * already deleted the file (a fenced digest mismatch, a corrupt archive). If the
 * move back fails, the staging directory is KEPT and its path is printed, rather
 * than deleting the user's only copy. A hard kill between the two renames strands
 * the artifact under `os.tmpdir()/amicus-electron-stage-*`; the next staging
 * attempt sweeps any such directory older than a day, and the OS reaps the temp
 * tree besides.
 *
 * LEAF MODULE: `fs` + `os` + `path` and nothing from this repo, so it can be
 * required from either side of the electron-install -> electron-provision arrow.
 *
 * @module sidecar/electron-stage
 */

'use strict';

const fsDefault = require('fs');
const os = require('os');
const path = require('path');

/** Directory-name prefix, so a stranded staging dir is identifiable and sweepable. */
const STAGE_PREFIX = 'amicus-electron-stage-';

/** How old a leftover staging directory must be before a later run removes it.
 *  A day is far longer than any provision, so this can never race a live repair
 *  in another process (which holds its own electron-lock besides). */
const STALE_STAGE_MS = 24 * 60 * 60 * 1000;

/**
 * Best-effort removal of staging directories a killed run left behind. NEVER
 * THROWS, and never follows a symlink: `lstatSync` + `isDirectory()` means a
 * planted `amicus-electron-stage-x -> /etc` link is skipped rather than walked,
 * which matters because `os.tmpdir()` is world-writable on POSIX.
 */
function sweepStaleStages({ fs = fsDefault, parent = os.tmpdir(), now = Date.now() } = {}) {
  let entries;
  try { entries = fs.readdirSync(parent); } catch { return; }
  for (const name of entries) {
    if (!String(name).startsWith(STAGE_PREFIX)) { continue; }
    const dir = path.join(parent, name);
    try {
      const stat = fs.lstatSync(dir);
      if (!stat.isDirectory() || now - stat.mtimeMs < STALE_STAGE_MS) { continue; }
      fs.rmSync(dir, { recursive: true, force: true });
    } catch { /* another user's, already gone, or not ours to remove */ }
  }
}

/**
 * Move (or, cross-volume, copy) `zip` into a fresh private directory.
 *
 * The staged file is named from the artifact name AMICUS resolved, never from
 * `basename(zip)` — the cache path is attacker-influenced and must not choose
 * a filename inside our own directory.
 *
 * @param {object} opts
 * @param {string} opts.zip      the artifact's current (attacker-reachable) path
 * @param {string} opts.fileName `electron-v<ver>-<plat>-<arch>.zip`
 * @param {object} [opts.fs]
 * @param {string} [opts.parent] staging parent; MUST NOT be inside a cache root
 * @param {function} [opts.log]
 * @returns {{path:string, dir:string, origin:string, moved:boolean, discard:boolean}|null}
 *   null when the bytes could not be staged at all — the caller must then NOT
 *   extract them.
 */
function stageArtifact({ zip, fileName, fs = fsDefault, parent = os.tmpdir(), log = () => {} }) {
  sweepStaleStages({ fs, parent });
  let dir;
  try {
    dir = fs.mkdtempSync(path.join(parent, STAGE_PREFIX));
    // mkdtemp is already 0700 on POSIX; make it explicit rather than inherited.
    if (process.platform !== 'win32') { try { fs.chmodSync(dir, 0o700); } catch { /* best-effort */ } }
  } catch {
    log('[amicus] NOTE: could not create a private staging directory for the Electron artifact;');
    log('[amicus]   the cached bytes will not be extracted (a download can still provision).');
    return null;
  }
  const staged = path.join(dir, fileName);
  try {
    fs.renameSync(zip, staged);
    return { path: staged, dir, origin: zip, moved: true, discard: false };
  } catch { /* EXDEV and friends: fall back to a copy */ }
  try {
    fs.copyFileSync(zip, staged);
    return { path: staged, dir, origin: zip, moved: false, discard: false };
  } catch {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* nothing to undo */ }
    return null;
  }
}

/**
 * Undo `stageArtifact`. Called from a `finally`, so it must NEVER THROW.
 *
 * A MOVED artifact is renamed back to where it came from, so the shared cache
 * ends the repair exactly as it began it — unless `stage.discard` is set, which
 * the caller does only in the two places v4.9.5 already removed the file: a
 * fenced digest mismatch, and an archive that failed to extract. A COPIED
 * artifact's original never left, so there is nothing to put back.
 *
 * If the move back fails, the staging directory is deliberately LEFT on disk and
 * its path printed. Deleting it would be the one outcome the F1 remedy forbids:
 * a user holding neither a cached artifact nor a working dist.
 */
function releaseStage({ stage, fs = fsDefault, log = () => {} }) {
  if (!stage) { return; }
  if (stage.moved && !stage.discard) {
    let restored = false;
    try { fs.mkdirSync(path.dirname(stage.origin), { recursive: true }); } catch { /* may already exist */ }
    try { fs.renameSync(stage.path, stage.origin); restored = true; } catch { /* try a copy */ }
    if (!restored) {
      try { fs.copyFileSync(stage.path, stage.origin); restored = true; } catch { /* keep the bytes */ }
    }
    if (!restored) {
      log(`[amicus] WARNING: could not return the Electron artifact to ${stage.origin}`);
      log(`[amicus]   It has been LEFT at ${stage.path} — move it back or delete it by hand.`);
      return;
    }
  }
  try { fs.rmSync(stage.dir, { recursive: true, force: true }); } catch { /* the sweep gets it */ }
}

module.exports = {
  stageArtifact, releaseStage, sweepStaleStages, STAGE_PREFIX, STALE_STAGE_MS,
};
