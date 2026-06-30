/**
 * AV / antivirus quarantine detection for the electron self-heal (#53).
 *
 * The DOMINANT real-world Windows failure: Windows Defender / antivirus deletes
 * electron.exe right AFTER each extract. No re-extract can ever win that race —
 * the user MUST allow-list the binary. This module owns the quarantine MESSAGE
 * + the post-extract VERIFY so electron-install.js stays under the size gate and
 * the wording lives in one place.
 *
 * Split out of src/sidecar/electron-install.js (kept <300 lines).
 */

'use strict';

/** Quarantine / AV note appended to win32 deferral reasons. */
function avHint(platform) {
  if (platform === 'win32') {
    return ' Windows Defender / antivirus may have quarantined electron.exe; '
      + 'allow it and re-run, or reinstall.';
  }
  return '';
}

/**
 * Actionable quarantine instruction. AV / Windows Defender deletes electron.exe
 * right AFTER each extract, so no re-extract can win — the user MUST allow-list
 * the binary. We name the exact path to allow and point at the in-place
 * self-heal re-run (NOT a reinstall, which would loop). win32-specific; other
 * platforms get the generic avHint fallback.
 */
function quarantineReason({ platform, exePath }) {
  if (platform === 'win32') {
    const target = exePath || 'node_modules/electron/dist/electron.exe';
    return 'electron.exe was removed right after it was extracted — antivirus '
      + '(e.g. Windows Defender) likely quarantined it. Allow '
      + `${target} in your AV, then run amicus doctor --fix.`;
  }
  return 'The electron binary vanished right after extraction — your antivirus '
    + `may have quarantined it. Allow it, then run amicus doctor --fix.${avHint(platform)}`;
}

/**
 * Verify the outcome of a NON-throwing extract (cache OR controlled download).
 *
 * THE QUARANTINE SIGNATURE: the extract did not throw, yet isElectronUsable()
 * is STILL false — the exe was written then vanished. On win32 that is almost
 * always AV / Windows Defender quarantining electron.exe, and NO re-extract can
 * win. We report { repaired:false, quarantined:true, reason } with an ACTIONABLE
 * allow-list instruction — NEVER a false success, and the caller MUST NOT
 * auto-retry (a quarantine loop is the bug we're killing).
 *
 * When the exe IS present, this is a clean { repaired:true }.
 *
 * @param {object} opts
 * @param {() => boolean} opts.isElectronUsable bound usability probe.
 * @param {() => string}  opts.resolveExe resolves the on-disk exe path.
 * @param {string} opts.platform
 */
function verifyExtractOutcome({ isElectronUsable, resolveExe, platform }) {
  if (isElectronUsable()) {
    return { repaired: true };
  }
  return {
    repaired: false,
    quarantined: true,
    reason: quarantineReason({ platform, exePath: resolveExe() }),
  };
}

module.exports = { avHint, quarantineReason, verifyExtractOutcome };
