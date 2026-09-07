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
 * the swap window simply moves. The only fix is to put the bytes somewhere the
 * writer cannot reach, and hash them THERE.
 *
 * WHY THIS COPIES — AND WHY THE FIRST ATTEMPT'S RENAME DID NOT WORK. The first
 * cut of this module renamed the artifact into the private directory and
 * asserted that "a rename is atomic and copies no bytes, and after it the
 * attacker cannot reach them at all". That assertion is FALSE for any cache
 * entry that is not a plain, singly-linked, non-symlink file, and a council
 * probe demonstrated it end to end. A rename moves a directory ENTRY, not an
 * inode:
 *   - HARD LINK. The attacker gives the artifact a second name of their own
 *     before amicus ever looks. After the rename, amicus's staged path and the
 *     retained name are the SAME FILE, and a write through their name lands
 *     between the gate's open and the extractor's. MEASURED on this tree
 *     (NTFS, `fs.linkSync`): verdict `verified`, then `BYTES EXTRACTED:
 *     "POISONED-BYTES"` and `{"repaired":true}` — no `integrity`, no
 *     `unverified`, and those bytes are what gets launched as Electron.
 *   - SYMLINK. A link planted at the cache path is what moves; both opens
 *     follow it back to a file the attacker owns.
 *   - RETAINED DESCRIPTOR. On POSIX an fd opened before the rename still writes
 *     the inode afterwards, and nothing can revoke it. No stat-time check can
 *     see this one, which is why the "refuse `nlink !== 1`" variant of the
 *     remedy is incomplete and this module does not rely on it.
 * A COPY has none of these problems, because it makes a NEW INODE: the attacker
 * has no name for it and no handle on it, and it lives in a fresh 0700
 * `mkdtempSync` directory under `os.tmpdir()` — unpredictable per attempt, and
 * never a subdirectory of the cache root, which would have inherited exactly the
 * write permission the attack needs. So staging ALWAYS copies, on every
 * platform. The `EXDEV` special case is gone with the rename that needed it.
 *
 * WHAT THE COPY COSTS, AND WHAT IT BUYS BACK. It costs a ~170 MB write into the
 * temp directory, and a provision that refuses (loudly) when there is no room
 * for it. What it buys is the failure story the F1 remedy demanded, for free:
 * THE ORIGINAL NEVER LEAVES THE CACHE. There is no artifact to put back on any
 * exit path, so no exit path — success, refusal, corrupt archive, `Ctrl-C`
 * mid-extract, hard kill — can leave a user holding neither a cached artifact
 * nor a dist. A killed run strands a temp COPY, never the user's only artifact,
 * and `sweepStaleStages` removes one older than a day on the next staging
 * attempt — which always comes, because the cache entry that triggers staging
 * is still sitting there. `docs/troubleshooting.md` names the directory and its
 * prefix for anyone who wants to clear one by hand.
 *
 * THE STAGED NAME IS VALIDATED, NOT TRUSTED (v4.9.6 F#3). `fileName` arrives
 * from `artifactFileName({version, ...})`, and `version` is read out of
 * `<electronDir>/package.json` whenever the caller supplies none — which the one
 * production caller, `doctor --fix`, does, for a directory it located by
 * SCANNING npx caches. Joined unchecked, that string is a path component, and a
 * `..` in it escapes the private directory this module exists to provide.
 * MEASURED before the check, end to end through `repairElectron` with a planted
 * `"version": "43.1.1/../../victim"`: the extractor was handed
 * `<tmp>\victim-win32-x64.zip`, two levels OUTSIDE the staging directory, and a
 * pre-existing file at that path was destroyed.
 *
 * NEAR-LEAF MODULE: `fs` + `os` + `path`, plus the pure house sanitizer
 * `utils/text-sanitize`, which requires nothing itself — so this can be required
 * from either side of the electron-install -> electron-provision arrow without
 * making a cycle possible.
 *
 * @module sidecar/electron-stage
 */

'use strict';

const fsDefault = require('fs');
const os = require('os');
const path = require('path');

const { collapseExcerpt } = require('../utils/text-sanitize');

/** F5: a refused artifact name is attacker-influenced text on its way to stderr. */
const NAME_EXCERPT_CHARS = 160;

/** Directory-name prefix, so a stranded staging dir is identifiable and sweepable. */
const STAGE_PREFIX = 'amicus-electron-stage-';

/** How old a leftover staging directory must be before a later run removes it.
 *  A day is far longer than any provision, so this can never race a live repair
 *  in another process (which holds its own electron-lock besides). */
const STALE_STAGE_MS = 24 * 60 * 60 * 1000;

/**
 * The ONLY shape allowed to become a path component here:
 * `electron-v<version>-<platform>-<arch>.zip`, with each field restricted to
 * characters an electron version / platform / arch can actually contain.
 *
 * An ALLOW-list on purpose. A deny-list of `..` and separators is the shape that
 * keeps losing — it has to anticipate every dialect (`..`, `%2e%2e`, a bare `\`
 * that only win32's `path` treats as a separator), and it fails open on the one
 * it did not think of. This fails closed on everything it was not written for.
 */
const ARTIFACT_NAME = /^electron-v[0-9A-Za-z][0-9A-Za-z.+-]*-[0-9A-Za-z_]+-[0-9A-Za-z_]+\.zip$/;

/**
 * True when `fileName` is a plain filename amicus itself could have produced.
 *
 * Both halves are checked deliberately. The pattern is the real control; the
 * `path.basename` equality states the property in the platform's OWN dialect, so
 * the claim "this is a filename, not a path" is asserted by the module that
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
 * COPY `zip` into a fresh private directory. The original is left exactly where
 * it was; only the copy is ever hashed or extracted.
 *
 * The staged file is named from the artifact name AMICUS resolved and VALIDATED,
 * never from `basename(zip)` — the cache path is attacker-influenced and must not
 * choose a filename, let alone a directory, inside our own tree.
 *
 * EVERY `null` RETURN IS ANNOUNCED. A caller that cannot stage must not extract
 * (see electron-install.js and controlledProvision), and a control that stands
 * down in silence is the failure mode council seats F#6/F#8 filed against the
 * first cut: a full temp directory made amicus extract bytes it never hashed
 * with nothing at all on screen.
 *
 * @param {object} opts
 * @param {string} opts.zip      the artifact's current (attacker-reachable) path
 * @param {string} opts.fileName `electron-v<ver>-<plat>-<arch>.zip`
 * @param {object} [opts.fs]
 * @param {string} [opts.parent] staging parent; MUST NOT be inside a cache root
 * @param {function} [opts.log]
 * @returns {{path:string, dir:string}|null} null when the bytes could not be
 *   staged at all — the caller must then NOT extract them.
 */
function stageArtifact({ zip, fileName, fs = fsDefault, parent = os.tmpdir(), log = () => {} }) {
  if (!isSafeArtifactName(fileName)) {
    log(`[amicus] REFUSING an implausible Electron artifact name: ${collapseExcerpt(fileName, NAME_EXCERPT_CHARS)}`);
    log('[amicus]   It is not a plain filename, so it will not be joined into a private path.');
    return null;
  }
  sweepStaleStages({ fs, parent });
  // A COURTESY, NOT THE CONTROL. A symlink or a fifo at the cache path is a
  // mistake worth naming rather than copying, so it is named. The control is
  // that whatever bytes land in the staged file are the bytes hashed AND the
  // bytes extracted — which holds however the source happened to resolve, so
  // this check racing a swap costs nothing but a clearer message.
  try {
    if (!fs.lstatSync(zip).isFile()) {
      log('[amicus] NOTE: the Electron artifact is not a regular file; its bytes will NOT be extracted.');
      return null;
    }
  } catch {
    log('[amicus] NOTE: the Electron artifact could not be read at all; its bytes will NOT be extracted.');
    return null;
  }
  let dir;
  try {
    dir = fs.mkdtempSync(path.join(parent, STAGE_PREFIX));
    // mkdtemp is already 0700 on POSIX; make it explicit rather than inherited.
    if (process.platform !== 'win32') { try { fs.chmodSync(dir, 0o700); } catch { /* best-effort */ } }
  } catch {
    log('[amicus] NOTE: could not create a private staging directory for the Electron artifact;');
    log('[amicus]   its bytes will NOT be extracted (a fresh download can still provision).');
    return null;
  }
  const staged = path.join(dir, fileName);
  try {
    fs.copyFileSync(zip, staged);
    return { path: staged, dir };
  } catch {
    log('[amicus] NOTE: could not copy the Electron artifact into a private staging directory');
    log('[amicus]   (no space, or an unwritable temp directory); its bytes will NOT be extracted.');
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* nothing to undo */ }
    return null;
  }
}

/**
 * Undo `stageArtifact`: remove the private directory and the copy inside it.
 * Called from a `finally`, so it must NEVER THROW.
 *
 * There is deliberately nothing to "put back", and no `discard` switch. Staging
 * COPIES, so the artifact never left the cache. That is what makes the eviction
 * of a refused or corrupt artifact an ordinary, visible `rmSync` at the call
 * site instead of a flag read back out of the stage object — the shape council
 * seats F#4/F#5 caught, where "delete the corrupt zip" silently became a no-op
 * on whichever platform had taken the other branch.
 */
function releaseStage({ stage, fs = fsDefault }) {
  if (!stage) { return; }
  try { fs.rmSync(stage.dir, { recursive: true, force: true }); } catch { /* the sweep gets it */ }
}

module.exports = {
  stageArtifact, releaseStage, sweepStaleStages, isSafeArtifactName, STAGE_PREFIX, STALE_STAGE_MS,
};
