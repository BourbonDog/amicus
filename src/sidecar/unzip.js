/**
 * Native OS unzip command-planning for the Electron self-heal, and the shared refusal-wording constant the in-memory extractor is tested against.
 *
 * `nativeUnzipPlan()` is the per-platform command list `./electron-native-plan
 * :: runNativePlan` spawns for the native-extractor RESCUE — the one path that
 * still shells out to `tar` / `Expand-Archive` / `ditto` / `unzip`. `MAX_MS` is
 * that rescue's default spawn timeout (`./electron-native-rescue ::
 * withNativeRescue`).
 *
 * `UNSAFE_PATTERNS` is not applied by any code in this file: the in-memory
 * extractor classifies its own refusals (`zip-entry-write.js :: outOfBound`,
 * `zip-from-buffer.js`'s own `NAME_REFUSAL`). It stays exported as the single
 * source of truth those two wordings are tested against
 * (tests/sidecar/unzip-refusal-strings.test.js, tests/electron-custody.test.js,
 * tests/sidecar/zip-name-scan.test.js), so an upstream yauzl reword still goes
 * red instead of silently letting a path-traversal refusal (C4) be retried.
 *
 * HISTORY: through v4.14.1 this file also owned `robustExtract()`, which ran
 * the `extract-zip` dependency (bounded by `IDLE_MS`/`MAX_MS`) and fell back to
 * these same native strategies when it stalled or threw — the Node-24 field
 * bug the module was built for. Removed (N-06): it had no production caller
 * (the self-heal extracts through `zip-from-buffer.js`'s in-memory path
 * instead), so it — and the one dependency only it required — were dead
 * weight carrying amicus's one production dependency with an unfixable
 * advisory. See CHANGELOG.md [Unreleased].
 */

'use strict';

const path = require('path');

/**
 * A SECURITY REFUSAL IS A REFUSAL, NOT A RETRY (M9).
 *
 * These four strings are verified against the installed `yauzl`, and against
 * `zip-entry-write.js :: outOfBound`'s own construction, by
 * tests/sidecar/unzip-refusal-strings.test.js, which fails both on a reworded
 * refusal and on a pattern no real message produces.
 *
 * DELIBERATELY NARROW: a stall or an ordinary corrupt-archive throw must not
 * match, or the native-extractor rescue this repo also carries is destroyed.
 */
const UNSAFE_PATTERNS = [
  /^Out of bound path /,
  /^absolute path: /,
  /^invalid relative path: /,
  /^invalid characters in fileName: /,
];

// Hard cap on one native-extractor spawn (`./electron-native-rescue ::
// withNativeRescue`'s default `maxMs`).
const MAX_MS = 240_000;

/** PowerShell single-quoted string literal, injection-safe (double any quote). */
function psQuote(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

/**
 * Native OS unzip strategies, tried in order per platform. Each writes the
 * zip's entries at the ROOT of `dir` — the SAME on-disk layout the in-memory
 * extractor produces (electron.exe, resources/, locales/, ...). Confirmed on
 * the field box (Expand-Archive) and locally (tar/bsdtar + Expand-Archive,
 * both <1s).
 * @returns {Array<{name:string, cmd:string, args:string[]}>}
 */
function nativeUnzipPlan(zip, dir, platform = process.platform) {
  if (platform === 'win32') {
    // ABSOLUTE path to System32 bsdtar (Win10 1803+/11). A bare "tar" resolves
    // to GNU tar when git-bash/MSYS is on PATH — GNU tar reads "C:\..." as a
    // remote host ("Cannot connect to C:") and can't read zips at all. path.win32
    // keeps this a valid Windows path even when the plan is built off-Windows.
    const winTar = path.win32.join(process.env.SystemRoot || process.env.windir || 'C:\\Windows', 'System32', 'tar.exe');
    return [
      // bsdtar — fast, auto-detects zip format. If absent (rare/WOW64), the
      // spawn errors ENOENT and we fall through to Expand-Archive below.
      { name: 'tar', cmd: winTar, args: ['-xf', zip, '-C', dir] },
      // Universal Windows fallback; silence progress so stdio:'ignore' is clean.
      {
        name: 'Expand-Archive',
        cmd: 'powershell',
        args: ['-NoProfile', '-NonInteractive', '-Command',
          `$ProgressPreference='SilentlyContinue'; Expand-Archive -LiteralPath ${psQuote(zip)} -DestinationPath ${psQuote(dir)} -Force`],
      },
    ];
  }
  if (platform === 'darwin') {
    return [
      { name: 'ditto', cmd: 'ditto', args: ['-x', '-k', zip, dir] },
      { name: 'unzip', cmd: 'unzip', args: ['-o', '-q', zip, '-d', dir] },
    ];
  }
  return [
    { name: 'unzip', cmd: 'unzip', args: ['-o', '-q', zip, '-d', dir] },
    { name: 'tar', cmd: 'tar', args: ['-xf', zip, '-C', dir] },
  ];
}

module.exports = { nativeUnzipPlan, MAX_MS, UNSAFE_PATTERNS };
