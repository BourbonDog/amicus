// src/utils/remediation-hints.js
'use strict';

/**
 * Shared, copy-paste remediation hint strings.
 *
 * One source of truth for the fix commands surfaced by `amicus doctor` and by
 * failure messages across the CLI, so the guidance never drifts. Consumed by
 * src/cli-handlers-doctor.js (per-check hints) and reused by sweep'd failure
 * sites (#32) and the MCP recovery surface (#43).
 *
 * The object is frozen — these are a stable copy-paste contract; callers read
 * fields, they do not mutate them.
 */
const REMEDIATION_HINTS = Object.freeze({
  /** Canonical global (re)install. */
  reinstall: 'npm install -g amicus',

  /** `npm cache clean --force` — clears a corrupt npm cache before reinstalling. */
  cacheClean: 'npm cache clean --force',

  /**
   * Engine binaries missing/rolled back. A transient install error can roll
   * back the platform engine packages; re-run, or clean the cache and reinstall.
   */
  reinstallEngine:
    'npm install -g amicus  (a transient install error can roll back the engine binaries — re-run, or: npm cache clean --force && npm install -g amicus)',

  /**
   * Engine binary missing/rolled back AND possibly AV-quarantined. The doctor
   * opencode-bin hint: combines the transient-rollback reinstall guidance with
   * the Windows-Defender allow-list note, matching the electron avHint contract.
   */
  reinstallEngineAv:
    'npm install -g amicus  (a transient install error can roll back the engine binaries — re-run, or: npm cache clean --force && npm install -g amicus). '
    + 'If your antivirus (e.g. Windows Defender) quarantined opencode.exe — unverified, but a known cause — allow-list it first, then reinstall.',

  /**
   * Runtime server-start failure when the opencode engine binary does not
   * resolve on disk. One clear, actionable message replacing the opaque
   * spawn ENOENT — surfaced by startServer (the missing-binary boundary).
   */
  engineMissing:
    'OpenCode engine binary not found — the cause was not verified. Common causes (unverified): '
    + 'an install that skipped or rolled back the engine packages, or antivirus quarantine of opencode.exe. '
    + 'Run "amicus doctor" to check the actual install, reinstall with "npm i -g amicus", '
    + 'and allow-list opencode.exe in your antivirus if quarantine was the cause.',

  /** Electron absent — reinstall to add the interactive GUI (headless still works). */
  reinstallElectron: 'npm install -g amicus  (reinstall to add Electron)',

  /** Point the user at the single recovery hub. */
  runDoctor: 'run: amicus doctor  (diagnoses config, keys, engine & MCP, with copy-paste fixes)',

  /**
   * Self-heal the optional Electron GUI in place (#56). The convergence target
   * for the "reinstall to fix Electron" hints — it provisions the binary from
   * cache (or downloads on demand) WITHOUT a global reinstall, so it can't
   * loop the way `npm install -g amicus` could when the rollback recurs.
   * (`rebuildElectron`, the manual rm-rf-and-reinstall variant, was deleted
   * 2026-08-03 by owner ruling: no live call site once this hint became the
   * target, and its prose asserted unverified causes. A reintroduction must
   * use the unverified-cause voice — absence-pinned in
   * tests/remediation-hints.test.js.)
   */
  doctorFix: 'amicus doctor --fix  (self-heal the Electron GUI in place — provisions the binary; no reinstall, so it can\'t loop)',

  /**
   * Duplicate legacy 'sidecar' MCP registration (Phase 4 de-bloat): pre-1.8
   * postinstalls registered the same server twice. `doctor --fix` removes the
   * twin only when it points at amicus; a customized entry is never touched.
   */
  removeLegacySidecar:
    "amicus doctor --fix  (removes the duplicate legacy 'sidecar' MCP entry — same server registered twice; the 'amicus' entry stays)",

  /**
   * Orphaned sessions-index.json.*.tmp files (15a.1/B15): a kill between the
   * atomic tmp-write and rename leaves a stray temp file in the config dir
   * forever. `doctor --fix` sweeps files older than 60s (never a live writer's
   * ms-lived tmp).
   *
   * Voice ruling (Christian, 2026-08-03): this hint keeps its confident cause.
   * "Left by an interrupted write" is definitional, not a guess — the atomic
   * write pattern admits no other producer, and the age gate excludes live
   * writers — so the Plan 3 unverified-cause voice deliberately does NOT
   * apply. Do not re-file it against that criterion.
   */
  sweepSessionIndexTmp:
    'amicus doctor --fix  (sweeps orphaned .sessions-index.json.*.tmp files left by an interrupted write)',

  /**
   * Orphaned per-session metadata.json.*.tmp files (v4.6.3 PR3 Task 3 / D8):
   * same producer shape as sweepSessionIndexTmp above, one level down — a
   * kill between an atomic write's tmp-write and rename leaves a stray temp
   * file in a session directory forever. `doctor --fix` sweeps files older
   * than 60s (never a live writer's ms-lived tmp).
   *
   * Voice ruling (Christian, 2026-08-03, sweepSessionIndexTmp above): applies
   * verbatim here — the cause is definitional, not a guess, so this hint also
   * keeps its confident voice rather than the unverified-cause voice.
   */
  sweepSessionMetadataTmp:
    'amicus doctor --fix  (sweeps orphaned .metadata.json.*.tmp files left by an interrupted write)',
});

module.exports = REMEDIATION_HINTS;
