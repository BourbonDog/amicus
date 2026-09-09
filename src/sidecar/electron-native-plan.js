/**
 * THE MECHANICS OF A RESCUE: write the verified buffer down, walk the platform's
 * native plan against it, and leave the extracted tree where the promote will
 * find it. Nothing here decides WHETHER a rescue may happen — that is
 * `./electron-native-rescue`, which is the only caller.
 *
 * SPLIT OUT of that module (v4.9.6, C2 round 4) when the trigger boundary grew
 * the entry-name scan and the file passed the repo's 300-line gate. The seam is
 * the one its own docblock names: "THE TRIGGER BOUNDARY, WHICH MATTERS MORE THAN
 * THE MECHANISM". The boundary stayed; the mechanism moved here.
 *
 * WHAT IT COSTS, once, so it is not restated in every function: the rescue
 * writes bytes amicus hashed to a path and hands that path to a child process.
 * Between those two moments a same-user writer can substitute the file, and what
 * the child extracts is promoted WITHOUT being hashed again. `announceNativeRescue`
 * says exactly that on stderr before the first spawn, and the caller marks the
 * result unverified. It is the trade the hatch buys, not a safe operation.
 *
 * NEAR-LEAF: `./unzip` (the plan and the cap, byte-for-byte unchanged),
 * `./electron-rescue-notice`, `./electron-refuse` and `../utils/text-sanitize`.
 * Nothing requires it back.
 *
 * @module sidecar/electron-native-plan
 */

'use strict';

const path = require('path');

// The plan and the cap come from `unzip.js`, which is byte-for-byte unchanged:
// this is a re-wiring of a caller, not a change to that module.
const { nativeUnzipPlan } = require('./unzip');
const { PATH_EXCERPT_CHARS } = require('./electron-refuse');
const { announceNativeRescue } = require('./electron-rescue-notice');
const { collapseExcerpt } = require('../utils/text-sanitize');

/**
 * The directory `electron-layout.js :: extractBytesToDist` extracts into is
 * `<electronDir>/.amicus-incoming-<hex>/dist`, so its PARENT is the private
 * incoming tree that the promote renames out of and the `finally` deletes. The
 * rescue writes its zip there — beside `dist`, never inside it, because
 * `promoteDist` renames the whole `dist` directory into place and would carry a
 * 138 MB stray zip with it.
 *
 * CHECKED, NOT ASSUMED. Deriving a write location from a caller's argument is
 * how a stray file lands somewhere nobody expected, so the prefix is verified
 * before a byte is written and the rescue refuses otherwise. The coupling is
 * also pinned end-to-end by tests/electron-native-rescue.test.js, which runs a
 * real `extractBytesToDist` and asserts the zip landed in the incoming tree.
 */
const INCOMING_PREFIX = '.amicus-incoming-';

/** The name the rescue writes the verified buffer under, inside that tree. */
const RESCUE_ZIP = 'rescue-artifact.zip';
/** True if `dir` exists and holds at least one entry (unzip.js's layer 3). */
function dirNonEmpty(fs, dir) {
  try {
    return fs.readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

/**
 * Remove everything inside `dir` (best-effort).
 *
 * LOAD-BEARING, not tidiness: the extractor that just failed may have left a
 * PARTIAL tree there, and `dirNonEmpty` would then read those leftovers as a
 * successful rescue and promote them into `dist/`. unzip.js cleans for the same
 * reason before its own native strategies.
 */
function cleanDir(fs, dir) {
  try {
    for (const entry of fs.readdirSync(dir)) {
      fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
    }
  } catch { /* best-effort */ }
}

/**
 * Walk the platform's native plan until one strategy leaves files in `dir`.

 *
 * The verdicts are unzip.js's, because they were right there: a spawn error or
 * an external signal-kill (`status: null` — SIGKILL, an OOM) is a FAILURE even
 * if files landed, a non-zero exit is a failure, and a clean exit that produced
 * nothing is a failure. Every failure cleans up after itself so the next
 * strategy starts from an empty directory.
 * @returns {string|null} the strategy name that worked, or null
 */
function runNativePlan({ zip, dir, platform, fs, spawn, maxMs, log }) {
  const failures = [];
  for (const strat of nativeUnzipPlan(zip, dir, platform)) {
    let res;
    try {
      res = spawn(strat.cmd, strat.args, { stdio: 'ignore', windowsHide: true, timeout: maxMs });
    } catch (e) {
      failures.push(`${strat.name}: spawn ${(e && e.code) || (e && e.message) || 'threw'}`);
      continue;
    }
    if (res && (res.error || res.signal)) {
      failures.push(`${strat.name}: ${res.error ? (res.error.code || res.error.message) : `killed by ${res.signal}`}`);
    } else if (res && typeof res.status === 'number' && res.status !== 0) {
      failures.push(`${strat.name}: exit ${res.status}`);
    } else if (dirNonEmpty(fs, dir)) {
      return strat.name;
    } else {
      failures.push(`${strat.name}: produced no files`);
    }
    cleanDir(fs, dir);
  }
  log(`[amicus] the native-extractor rescue did not recover this archive (${collapseExcerpt(failures.join('; ') || 'no native strategy available')}).`);
  return null;
}

/**
 * Write the verified buffer beside the incoming `dist`, hand that path to the
 * native plan, and leave the extracted tree where the existing promote sequence
 * will find it — so a rescue lands in `dist/` by the SAME single rename, with the
 * same litter sweep, and this module never touches the promote at all.
 *
 * `namesComplete`/`namesChecked` are REQUIRED and deliberately have no defaults:
 * they drive a disclosure, and a caller that forgot to thread them must not get
 * the reassuring branch by omission. `announceNativeRescue` treats `undefined` as
 * "not complete" for the same reason.
 *
 * `flag: 'wx'` is a real control and a small one: `O_EXCL` refuses to write
 * through a name that already exists, INCLUDING a symlink someone pre-planted at
 * it. It does nothing about a substitution AFTER the write — that window is the
 * whole cost of the rescue and is stated in the notice, not engineered away.
 * The copy is deleted as soon as the child is done; the `finally` in
 * `extractBytesToDist` removes the whole incoming tree regardless.
 * @returns {string|null} the strategy name that recovered the archive, or null
 */
function nativeRescue({ bytes, dir, reason, namesComplete, namesChecked, platform, fs, spawn, maxMs, log }) {
  const incoming = path.dirname(dir);
  if (!path.basename(incoming).startsWith(INCOMING_PREFIX)) {
    log(`[amicus] the native-extractor rescue was NOT attempted: ${collapseExcerpt(dir, PATH_EXCERPT_CHARS)} is not inside an amicus incoming directory.`);
    return null;
  }
  const zip = path.join(incoming, RESCUE_ZIP);
  announceNativeRescue({ zip, reason, namesComplete, namesChecked, log });
  try {
    fs.writeFileSync(zip, bytes, { flag: 'wx', mode: 0o600 });
  } catch (e) {
    log(`[amicus] the native-extractor rescue could not write the archive out: ${collapseExcerpt((e && e.message) || String(e))}`);
    return null;
  }
  try {
    // The failed extractor's partial tree is evidence of nothing and would be
    // promoted as if it were a rescue. It goes before the child runs.
    cleanDir(fs, dir);
    const strategy = runNativePlan({ zip, dir, platform, fs, spawn, maxMs, log });
    if (strategy) {
      log(`[amicus] recovered via the native extractor (${strategy}). These bytes were NOT re-hashed; the result is marked unverified.`);
    }
    return strategy;
  } finally {
    try { fs.rmSync(zip, { force: true }); } catch { /* the incoming tree is removed anyway */ }
  }
}

module.exports = { nativeRescue, RESCUE_ZIP, INCOMING_PREFIX };
