/**
 * The on-disk LAYOUT of an installed `electron` package: where the executable
 * lives, and how a verified zip becomes a `dist/`.
 *
 * Layout (npm `electron`): `path.txt` -> the exe basename, `dist/<exe>` -> the
 * binary. Extraction restores `path.txt` afterwards, because a half-healed
 * package with a `dist/` and no `path.txt` is a shape `electron/index.js` cannot
 * resolve.
 *
 * SPLIT OUT of electron-install.js (v4.9.6, second council round): that file is
 * at the repo's 300-line gate, and the round's repairs had to land inside
 * `repairElectron` itself. These three functions were the cleanest thing to lift
 * — they answer "where does the package keep its exe", which is a different
 * question from "how do I heal a broken install". A PURE MOVE: no behaviour
 * changed, and `electron-install.js` re-exports `platformExe` so every existing
 * `ei.platformExe` import stays valid.
 *
 * TRUE LEAF: `path` only, with `fs` and the extractor injected by the caller —
 * so electron-provision.js could require it too without any risk of a cycle.
 *
 * @module sidecar/electron-layout
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

/** Restore path.txt so electron/index.js resolves the freshly-extracted exe. */
function writePathTxt({ electronDir, platform, fs }) {
  fs.writeFileSync(path.join(electronDir, 'path.txt'), platformExe(platform));
}

/**
 * Extract a staged zip into `<electronDir>/dist` offline.
 *
 * `zip` is ALWAYS a path inside amicus's own private staging directory — see
 * sidecar/electron-stage.js. Handing this function a cache path is the
 * hash-then-reopen race three council seats filed against v4.9.5.
 */
async function extractFromCache({ zip, electronDir, platform, extract, fs }) {
  const distDir = path.join(electronDir, 'dist');
  fs.mkdirSync(distDir, { recursive: true });
  await extract(zip, { dir: distDir });
  writePathTxt({ electronDir, platform, fs });
}

module.exports = { platformExe, writePathTxt, extractFromCache };
