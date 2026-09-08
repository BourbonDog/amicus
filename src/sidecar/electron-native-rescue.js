/**
 * THE NATIVE-EXTRACTOR RESCUE — the one way an archive amicus's own extractor
 * cannot parse still becomes an install, what it costs, and why it is reachable
 * from exactly one place.
 *
 * ── THE FINDING (council run 34182994208, major, deepseek seat) ───────────
 * "Deleting the native-unzip fallback and the last-resort install.js spawn
 * weakens the air-gapped recovery path to a permanent no-rescue failure for
 * archives yauzl cannot parse." True as filed. `zip-stall-bound.js` had already
 * written the loss down honestly — "an archive yauzl cannot parse but a native
 * extractor could is a failed repair plus a re-download" — and on a machine with
 * no network to re-download from, that is the end of the road.
 *
 * ── WHY IT CANNOT SIMPLY BE PUT BACK, WHICH IS THE WHOLE JUSTIFICATION ────
 * Every native extractor — `tar`, `Expand-Archive`, `ditto`, `unzip` — takes a
 * PATH. Using one therefore means writing bytes down and letting a child process
 * open them: the SECOND PATH RESOLUTION the custody design exists to eliminate
 * (`electron-custody.js` carries the three refuted remedies and the measurements
 * that killed them). The custody property — **amicus never itself writes, or
 * reports as verified, bytes it did not hash** — and a path-taking extractor
 * cannot both hold on the same run. There is no clever version of this: the two
 * properties are in direct contradiction.
 *
 * That trade is acceptable ONLY under a flag whose existing documented meaning is
 * already "I accept Electron bytes amicus cannot vouch for", and it must not be
 * reachable any other way. `AMICUS_ALLOW_UNVERIFIED_ELECTRON=1` is that flag, and
 * it is read in exactly one place (`electron-trust.js :: electronTrustPolicy`),
 * from a bare environment name a repository's `.npmrc` cannot plant. Custody
 * stays absolute by default. `runInstaller` is NOT coming back — it did its own
 * download with its own anchor, which is a different and much worse thing (see
 * `electron-provision.js`).
 *
 * ── THE TRIGGER BOUNDARY, WHICH MATTERS MORE THAN THE MECHANISM ───────────
 * "Fall back when extraction fails" would re-arm the laundering bug this cluster
 * already fixed once (C4): a security refusal handed to a tool with no such
 * check. So the trigger is ONE extractor verdict, `UNZIP_BUFFER_FAILED` — the
 * code whose defined meaning is "the ARCHIVE is bad", and already the only
 * failure that licences an eviction (`electron-repair-cache.js ::
 * EVICTS_THE_ARTIFACT`). The rescue and the eviction now share one trigger.
 *
 *   YES  the extractor positively identified the ARCHIVE as unreadable.
 *   NO   `UNZIP_UNSAFE_ARCHIVE` — a path-traversal REFUSAL. Terminal by design;
 *        C4 exists precisely to stop a refusal being retried through a tool
 *        amicus does not control, and the hatch is not even MENTIONED on that
 *        exit — advertising it there would be the same laundering with a human
 *        in the loop.
 *   NO   `UNZIP_BUFFER_STALLED` — the bound exists to STOP work, not to hand it
 *        to someone else, and a stall is a verdict about nothing.
 *   NO   a digest MISMATCH. The bytes are known wrong; there is nothing to
 *        rescue. This is the exclusion that is easy to get wrong, because the
 *        same flag that opens the rescue ALSO downgrades a mismatch refusal to a
 *        warning (`electron-trust.js :: verifyArtifactBytes`) — so with the hatch
 *        set, contradicted bytes really do reach the extractor. `gate.verdict`
 *        is checked here for that one reason.
 *   NO   `UNZIP_DEST_FAILED` — not the archive's fault, and a native extractor
 *        writing to the same full or unwritable destination fails identically.
 *   NO   `UNZIP_BUFFER_UNAVAILABLE`, and NO an error carrying no `code` at all.
 *        Neither is a parse failure, and a rule that fails OPEN on the shapes
 *        nobody enumerated is the shape D2 was filed against. Fail closed.
 *
 * ── AND `no-digest` IS ALLOWED, DELIBERATELY ──────────────────────────────
 * Only `mismatch` is excluded. `no-digest` means nobody ever published a digest
 * for this artifact — an Electron package predating `checksums.json` — which is
 * exactly the old, air-gapped machine the finding is about. Nothing contradicts
 * those bytes; refusing them would delete the rescue for its main case.
 *
 * ── WHAT A RESCUE CAN NEVER DO: REPORT CLEAN ──────────────────────────────
 * `rescue.used` is set when the rescue runs, and both routes fold it into their
 * `unverified` mark, so a rescued install is never reported as verified even
 * when the artifact's own sha256 matched. It has to be: the bytes in `dist/` were
 * placed there by a child process reading a path, not by amicus writing what it
 * hashed. Reporting that as verified is the exact overclaim the custody property
 * forbids.
 *
 * @module sidecar/electron-native-rescue
 */

'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

// The plan and the cap come from `unzip.js`, which is byte-for-byte unchanged:
// this is a re-wiring of a caller, not a change to that module.
const { nativeUnzipPlan, MAX_MS } = require('./unzip');
// The two multi-line notices live where every other user-facing sentence in this
// subsystem is written; this module decides, that one speaks.
const { PATH_EXCERPT_CHARS, offerNativeRescue, announceNativeRescue } = require('./electron-refuse');
const { collapseExcerpt } = require('../utils/text-sanitize');

/** The ONE extractor verdict a rescue may act on. See the docblock's boundary. */
const RESCUE_TRIGGER = 'UNZIP_BUFFER_FAILED';

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

/** True for the ONE failure class the owner authorised a rescue for. */
function isRescuableFailure(err) {
  return !!err && err.code === RESCUE_TRIGGER;
}

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
 * `flag: 'wx'` is a real control and a small one: `O_EXCL` refuses to write
 * through a name that already exists, INCLUDING a symlink someone pre-planted at
 * it. It does nothing about a substitution AFTER the write — that window is the
 * whole cost of the rescue and is stated in the notice, not engineered away.
 * The copy is deleted as soon as the child is done; the `finally` in
 * `extractBytesToDist` removes the whole incoming tree regardless.
 * @returns {string|null} the strategy name that recovered the archive, or null
 */
function nativeRescue({ bytes, dir, reason, platform, fs, spawn, maxMs, log }) {
  const incoming = path.dirname(dir);
  if (!path.basename(incoming).startsWith(INCOMING_PREFIX)) {
    log(`[amicus] the native-extractor rescue was NOT attempted: ${collapseExcerpt(dir, PATH_EXCERPT_CHARS)} is not inside an amicus incoming directory.`);
    return null;
  }
  const zip = path.join(incoming, RESCUE_ZIP);
  announceNativeRescue({ zip, reason, log });
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

/**
 * Wrap a buffer extractor so a PARSE FAILURE — and nothing else — may be rescued
 * by the native plan when the hatch is set.
 *
 * ONE WRAPPER, WIRED AT BOTH CALL SITES. `gate` and `policy` are only known after
 * the digest gate has run, which is why this is composed inside each route rather
 * than once in `repairElectron`; F3 is the standing reminder of what happens when
 * a rule lands on one provision route and not the other, so a test asserts both.
 *
 * @param {object} o
 * @param {function} o.extract  the buffer extractor being wrapped
 * @param {object}   o.gate     verifyArtifactBytes's result (its `verdict` is read)
 * @param {object}   o.policy   electronTrustPolicy's result (the hatch)
 * @param {object}   o.rescue   OUT: `{used, strategy}` is set when a rescue ran
 * @returns {function} an extractor with the same (bytes, {dir}) signature
 */
function withNativeRescue({
  extract, gate = {}, policy = {}, rescue = {}, platform = process.platform,
  fs, spawn = spawnSync, maxMs = MAX_MS, log = () => {},
}) {
  return async (bytes, o) => {
    try {
      return await extract(bytes, o);
    } catch (err) {
      // Every class but one leaves through here untouched and unadvertised.
      if (!isRescuableFailure(err)) { throw err; }
      if (!policy.allowUnverified) {
        offerNativeRescue({ reason: (err && err.message) || '', log });
        throw err;
      }
      if (gate.verdict === 'mismatch') {
        log('[amicus] the native-extractor rescue was NOT attempted: these bytes contradict the published sha256, so there is nothing to rescue.');
        throw err;
      }
      const strategy = nativeRescue({
        bytes, dir: o.dir, reason: (err && err.message) || '', platform, fs, spawn, maxMs, log,
      });
      // A rescue that failed leaves the ORIGINAL classified error in flight, so
      // a genuinely bad archive is still evicted exactly as it was before.
      if (!strategy) { throw err; }
      rescue.used = true;
      rescue.strategy = strategy;
      return { strategy, rescued: true };
    }
  };
}

module.exports = {
  withNativeRescue, isRescuableFailure, RESCUE_TRIGGER, RESCUE_ZIP, INCOMING_PREFIX,
};
