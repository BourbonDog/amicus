/**
 * WHICH exe a package resolves through, and whether a `dist/` HOLDS one.
 *
 * ONE RULE, ONE HOME. `resolveElectronBinary` (electron-install.js) decides what
 * amicus will SPAWN; `promoteDist`'s retirement guard (electron-layout.js)
 * decides what amicus may DELETE. Until v4.9.7 only the first one read
 * `path.txt` — the second asked whether `dist/` held THIS HOST'S default exe —
 * and a package cross-installed through `npm_config_platform` holds a different
 * basename, so a failed promote destroyed a working tree (A1). Two copies of a
 * rule are free to drift; this module exists so there is one.
 *
 * WHICH VALUE `promoteDist`'S GUARD MAY READ, since getting this wrong is how
 * the fix would have been as blind as the defect:
 *   - `raw`, the bytes `path.txt` held BEFORE the promote's step 0 — YES.
 *   - `replaced` (electron-layout.js) — NO. It is nulled in exactly the branch
 *     the guard most needs a name for, and it is untrimmed, so feeding it to
 *     `path.join` fails OPEN on a trailing newline.
 *   - A RE-READ of `path.txt` at the guard — NO, and this is the sharp one.
 *     Step 0 has already written `platformExe` there, so a re-reading guard
 *     reads its own writer's value and learns nothing. MEASURED: at the guard
 *     the file says `electron.exe` even for a package cross-installed as
 *     `electron`, and the tree is deleted exactly as before the fix. That is
 *     failure mode #21, the echoed read-back.
 *
 * `ELECTRON_OVERRIDE_DIST_PATH` IS DELIBERATELY NOT PART OF THIS RULE, and
 * `promoteDist` gains no `env`. The guard governs a DELETE of `distDir` and
 * nothing else, so the only question is what THAT tree holds; under an override
 * `resolveElectronBinary` does not look in `dist/` at all. Ignoring it can only
 * make the guard readier to find an exe — the fail-CLOSED direction.
 *
 * TRUE LEAF: `path` only, with `fs` injected by the caller — so both callers can
 * require it with no risk of a cycle.
 *
 * @module sidecar/electron-exe-rel
 */

'use strict';

const path = require('path');

/** Platform exe basename, matching electron's getPlatformPath(). */
function platformExe(platform) {
  switch (platform) {
    case 'mas':
    case 'darwin':
      return path.join('Electron.app', 'Contents', 'MacOS', 'Electron');
    case 'win32':
      return 'electron.exe';
    default:
      return 'electron';
  }
}

/**
 * The relative exe path a package RESOLVES through, from `path.txt`'s RAW bytes.
 *
 * `resolveElectronBinary`'s rule, stated once: TRIM, and fall back to
 * `platformExe` when the file is absent, unreadable OR blank. `null` is the
 * caller's "the read threw".
 *
 * THE TRIM AND THE BLANK ARM ARE BOTH LOAD-BEARING, and the A1 filing named
 * neither — it said "absent or unreadable". MEASURED: a guard that skips the
 * trim deletes a real `dist/electron.exe` under a `path.txt` of
 * `"electron.exe\n"`, because `existsSync(join(dist, 'electron.exe\n'))` is
 * false on Windows; and one that returns a blank value names `dist/` ITSELF,
 * which exists, so it would refuse every promote forever.
 */
function heldExeRel(raw, platform) {
  const rel = typeof raw === 'string' ? raw.trim() : '';
  return rel || platformExe(platform);
}

/**
 * WHICH executable `distDir` holds — under either name it could resolve
 * through — or `null` for a tree that is not an install under any of them.
 *
 * A UNION, NEVER A REPLACEMENT, and the union is why this returns a NAME. The
 * filing's literal rule ("judge by what `path.txt` names") was MEASURED to open
 * three new holes it does not mention: a whitespace-only `path.txt`, one with a
 * trailing newline, and a TRUNCATED one (`electr` — the shape `promoteDist`'s
 * own best-effort put-back can leave) each turned a real `dist/electron.exe`
 * into "not an install, delete it". So `platformExe` is not replaced by the
 * `path.txt` name; it is joined by it, and the set of trees this licenses
 * deleting can only ever SHRINK.
 *
 * ARM 1 IS THE PRE-FIX RULE, BYTE FOR BYTE, and it runs first and
 * unconditionally. That ordering is the guarantee: no tree the shipped guard
 * protects today can be deleted by this one.
 *
 * ARM 2 CARRIES TWO BOUNDS THE FIRST DOES NOT NEED.
 *   CONTAINED — a `path.txt` of `..`, `.`, `''` or `../SIBLING` joins to
 *   something that EXISTS outside `dist/` (all MEASURED true), which would
 *   refuse every promote forever while claiming `dist/` held an exe it never
 *   held. The predicate is `zip-entry-write.js :: writeSymlink`'s, verbatim —
 *   including the `path.sep`, whose absence MEASURABLY fails OPEN: a legal
 *   `dist/..electron.exe` reads as escaping and the tree is deleted.
 *   A FILE, NOT A DIRECTORY — every natural truncation of the darwin name
 *   (`Electron.app`, `Electron.app/Contents`, `Electron.app/Contents/MacOS`) is
 *   a real DIRECTORY in a real tree, and `existsSync` says true for all three.
 *   Accepting one would wedge the self-heal permanently on the AV-quarantine
 *   shape it exists for, printing "dist/ holds a usable Electron.app".
 *
 * A throwing `existsSync` (only an injected fs does this) reads as "I could not
 * establish that this tree is empty", which refuses. Fail closed.
 *
 * @param {object} o
 * @param {string} o.distDir
 * @param {string|null} o.raw  path.txt's bytes BEFORE any writer touched them
 * @param {string} o.platform
 * @param {object} o.fs
 * @returns {string|null} the exe path, relative to `distDir`, that was found
 */
function distHeldExe({ distDir, raw, platform, fs }) {
  const fallback = platformExe(platform);
  // ARM 1 — the pre-fix rule, unchanged and first.
  try { if (fs.existsSync(path.join(distDir, fallback))) { return fallback; } } catch { return fallback; }
  const held = heldExeRel(raw, platform);
  if (held === fallback) { return null; }
  // ARM 2 — the name path.txt gives, contained and required to be a file.
  const full = path.join(distDir, held);
  const inside = path.relative(distDir, full);
  if (inside === '' || inside === '..' || inside.startsWith(`..${path.sep}`) || path.isAbsolute(inside)) { return null; }
  try { return fs.statSync(full).isFile() ? held : null; } catch { return null; }
}

/** Write path.txt: the basename `electron/index.js` joins onto `dist/`. */
function writePathTxt({ electronDir, platform, fs }) {
  fs.writeFileSync(path.join(electronDir, 'path.txt'), platformExe(platform));
}

module.exports = { platformExe, writePathTxt, heldExeRel, distHeldExe };
