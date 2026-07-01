/**
 * Robust unzip for the electron self-heal (#53 follow-up; extract-zip-node24).
 *
 * FIELD BUG: on some Node 24 boxes `extract-zip@2.0.1` STALLS mid-extract — its
 * promise never resolves AND never rejects. Because the self-heal `await`s it,
 * when the event loop drains Node exits 0 with a partial extract and no
 * electron.exe, so `repairElectron` silently no-ops. extract-zip 2.0.1 is the
 * LATEST published release, so "just bump it" is impossible.
 *
 * robustExtract() survives that with three independent layers, none of which
 * can report a false success:
 *   1. BOUND extract-zip with an idle timer (reset on each onEntry) + a hard max
 *      timer, so a stall becomes a catchable outcome — and the live timer keeps
 *      the event loop alive so the process can't exit 0 before we fall back.
 *   2. FALL BACK to a native OS unzip (tar / Expand-Archive on Windows,
 *      ditto / unzip on macOS, unzip / tar on Linux) — each confirmed to extract
 *      the exact electron zip the field box choked on.
 *   3. Only report success when files actually landed on disk. The electron
 *      exe-stat verify stays upstream (electron-quarantine.verifyExtractOutcome).
 *
 * Everything network/spawn/timer-facing is dependency-INJECTABLE so tests never
 * hit the real clock, spawn a real process, or extract a real binary.
 */

'use strict';

const path = require('path');
const fsDefault = require('fs');
const { spawnSync } = require('child_process');

// No-progress window: if extract-zip reports no new entry for this long AND has
// not settled, treat it as the silent stall. Reset on every onEntry so a slow-
// but-progressing extract is never falsely aborted.
const IDLE_MS = 30_000;
// Hard cap so a "drips one entry forever" pathology can't run unbounded.
const MAX_MS = 240_000;

/** PowerShell single-quoted string literal, injection-safe (double any quote). */
function psQuote(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

/**
 * Native OS unzip strategies, tried in order per platform. Each writes the
 * zip's entries at the ROOT of `dir` — the SAME on-disk layout extract-zip
 * produces (electron.exe, resources/, locales/, ...). Confirmed on the field
 * box (Expand-Archive) and locally (tar/bsdtar + Expand-Archive, both <1s).
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

/** True if `dir` exists and holds at least one entry. */
function dirNonEmpty(fs, dir) {
  try {
    return fs.readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

/** Remove everything inside `dir` (best-effort) so the next strategy starts clean. */
function cleanDir(fs, dir) {
  try {
    for (const entry of fs.readdirSync(dir)) {
      fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
    }
  } catch {
    /* best-effort */
  }
}

/**
 * Run extract-zip bounded by an idle timer (reset on each onEntry) and a hard
 * max timer. NEVER rejects — resolves {ok:true} on completion, {ok:false,reason}
 * on stall/throw. The timers keep the event loop alive so a stalled extract
 * can't let the process exit 0 before we fall back. NOTE: a stalled extract-zip
 * promise is abandoned (2.0.1 has no cancel API); it holds a fd until the short-
 * lived process exits — acceptable versus a wedged, no-op self-heal.
 */
function runExtractZipBounded({ zip, dir, onEntry, extractZip, idleMs, maxMs, setTimer, clearTimer }) {
  return new Promise((resolve) => {
    let settled = false;
    let idleTimer = null;
    let maxTimer = null;
    const done = (val) => {
      if (settled) { return; }
      settled = true;
      if (idleTimer !== null) { clearTimer(idleTimer); }
      if (maxTimer !== null) { clearTimer(maxTimer); }
      resolve(val);
    };
    const armIdle = () => {
      if (idleTimer !== null) { clearTimer(idleTimer); }
      idleTimer = setTimer(() => done({ ok: false, reason: `stalled: no extract progress for ${idleMs}ms` }), idleMs);
    };
    maxTimer = setTimer(() => done({ ok: false, reason: `stalled: exceeded ${maxMs}ms` }), maxMs);
    armIdle();
    try {
      const result = extractZip(zip, {
        dir,
        onEntry: (entry, zipfile) => {
          armIdle(); // progress → restart the idle window
          if (onEntry) {
            try { onEntry(entry, zipfile); } catch { /* caller onEntry must not break extraction */ }
          }
        },
      });
      Promise.resolve(result).then(
        () => done({ ok: true }),
        (e) => done({ ok: false, reason: (e && e.message) || 'extract-zip threw' }),
      );
    } catch (e) {
      done({ ok: false, reason: (e && e.message) || 'extract-zip threw synchronously' });
    }
  });
}

/**
 * Extract `zip` into `dir`, surviving a stalled or broken extract-zip.
 *
 * CONTRACT: a returned {strategy} means files LANDED in `dir` — NOT that any
 * specific payload (e.g. electron.exe) is present. Callers needing a usable
 * binary MUST still stat it (electron-quarantine.verifyExtractOutcome does).
 *
 * @param {string} zip absolute path to the .zip
 * @param {object} opts
 * @param {string}   opts.dir destination dir (created if absent)
 * @param {function} [opts.onEntry] forwarded to extract-zip's onEntry
 * @param {string}   [opts.platform] override process.platform (native plan)
 * @param {number}   [opts.idleMs] no-progress window before treating as stalled
 * @param {number}   [opts.maxMs] hard cap for both extract-zip and each spawn
 * @param {object}   [opts.deps] injected { fs, extractZip, spawn, setTimeout, clearTimeout, log }
 * @returns {Promise<{strategy:string, fallback?:boolean, extractZipReason?:string}>}
 * @throws {Error} code 'UNZIP_ALL_FAILED' when no strategy produced files.
 */
async function robustExtract(zip, opts = {}) {
  const {
    dir,
    onEntry,
    platform = process.platform,
    idleMs = IDLE_MS,
    maxMs = MAX_MS,
    deps = {},
  } = opts;
  const fs = deps.fs || fsDefault;
  const extractZip = deps.extractZip || require('extract-zip');
  const spawn = deps.spawn || spawnSync;
  const setTimer = deps.setTimeout || setTimeout;
  const clearTimer = deps.clearTimeout || clearTimeout;
  const log = deps.log || (() => {});

  fs.mkdirSync(dir, { recursive: true });

  // Strategy 1: extract-zip, bounded. Trust it only if it RESOLVED and files landed.
  const z = await runExtractZipBounded({ zip, dir, onEntry, extractZip, idleMs, maxMs, setTimer, clearTimer });
  if (z.ok && dirNonEmpty(fs, dir)) {
    return { strategy: 'extract-zip' };
  }

  // extract-zip stalled / threw / produced nothing → clean partial output, go native.
  const zipReason = z.ok ? 'extract-zip produced no files' : z.reason;
  cleanDir(fs, dir);
  log(`[amicus] extract-zip did not complete (${zipReason}); falling back to native unzip.`);

  const failures = [];
  for (const strat of nativeUnzipPlan(zip, dir, platform)) {
    let res;
    try {
      res = spawn(strat.cmd, strat.args, { stdio: 'ignore', windowsHide: true, timeout: maxMs });
    } catch (e) {
      failures.push(`${strat.name}: spawn ${(e && e.code) || (e && e.message) || 'threw'}`);
      continue;
    }
    // A spawn error OR an external signal-kill (status:null, e.g. SIGKILL/OOM,
    // possibly leaving partial files) is a FAILURE — never trust dirNonEmpty here.
    if (res && (res.error || res.signal)) {
      failures.push(`${strat.name}: ${res.error ? (res.error.code || res.error.message) : `killed by ${res.signal}`}`);
      cleanDir(fs, dir);
      continue;
    }
    if (res && typeof res.status === 'number' && res.status !== 0) {
      failures.push(`${strat.name}: exit ${res.status}`);
      cleanDir(fs, dir);
      continue;
    }
    if (dirNonEmpty(fs, dir)) {
      log(`[amicus] recovered via native unzip (${strat.name}).`);
      return { strategy: strat.name, fallback: true, extractZipReason: zipReason };
    }
    failures.push(`${strat.name}: produced no files`);
    cleanDir(fs, dir);
  }

  const err = new Error(
    `unzip failed for ${zip} (extract-zip: ${zipReason}; native: ${failures.join('; ') || 'no native strategy available'})`,
  );
  err.code = 'UNZIP_ALL_FAILED';
  throw err;
}

module.exports = { robustExtract, nativeUnzipPlan, IDLE_MS, MAX_MS };
