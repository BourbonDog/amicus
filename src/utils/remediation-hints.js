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

  /** Electron absent — reinstall to add the interactive GUI (headless still works). */
  reinstallElectron: 'npm install -g amicus  (reinstall to add Electron)',

  /**
   * Electron present but broken (ABI mismatch / partial unpack). Delete the
   * vendored copy and reinstall to force a clean rebuild.
   */
  rebuildElectron:
    'rm -rf node_modules/electron && npm install -g amicus  (rebuild Electron after an ABI mismatch or partial unpack)',

  /** Point the user at the single recovery hub. */
  runDoctor: 'run: amicus doctor  (diagnoses config, keys, engine & MCP, with copy-paste fixes)',

  /**
   * Self-heal the optional Electron GUI in place (#56). This is the convergence
   * target for the three "reinstall to fix Electron" hints — it provisions the
   * binary from cache (or downloads on demand) WITHOUT a global reinstall, so it
   * can't loop the way `npm install -g amicus` could when the rollback recurs.
   */
  doctorFix: 'amicus doctor --fix  (self-heal the Electron GUI in place — provisions the binary; no reinstall, so it can\'t loop)',
});

module.exports = REMEDIATION_HINTS;
