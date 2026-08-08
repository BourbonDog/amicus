// src/utils/session-index-tmp-sweep.js
'use strict';

/**
 * 15a.1/B15: orphaned sessions-index.json.*.tmp sweep for `amicus doctor --fix`.
 *
 * A kill between writeFileAtomic's tmp-write and rename (src/utils/session-index.js
 * recordSession) leaves a stray `.sessions-index.json.<pid>.<hex>.tmp` file in the
 * config dir forever — 60-73 were observed accumulating. This module lists and
 * removes them; src/cli-handlers-doctor.js composes the result into a check line.
 *
 * The glob matches BOTH writeFileAtomic's naming and the (identical)
 * pre-consolidation hand-rolled scheme, so orphans from either era are found.
 */

const fs = require('fs');
const path = require('path');
const HINTS = require('./remediation-hints');

/** Files older than this survive to the next --fix, never a live writer's ms-lived tmp. */
const AGE_THRESHOLD_MS = 60 * 1000;

/**
 * List orphaned sessions-index.json.*.tmp files in the config dir.
 * @returns {Array<{name: string, mtimeMs: number}>}
 */
function listSessionIndexTmpFiles() {
  const { INDEX_FILENAME } = require('./session-index');
  const dir = require('./config').getConfigDir();
  let entries;
  try { entries = fs.readdirSync(dir); } catch { return []; }
  const prefix = `.${INDEX_FILENAME}.`;
  return entries
    .filter((name) => name.startsWith(prefix) && name.endsWith('.tmp'))
    .map((name) => {
      let st = null;
      // statSync (not lstatSync) is deliberate here — see session-metadata-tmp-sweep.js:27-31
      // for why that sibling never follows symlinks; this file's choice to follow them is a
      // separate, unreviewed symlink-policy decision left as-is (SR-3 only added the isFile() gate).
      try { st = fs.statSync(path.join(dir, name)); } catch { /* raced away */ }
      return { name, mtimeMs: st && st.isFile() ? st.mtimeMs : null };
    })
    .filter((f) => f.mtimeMs !== null);
}

/** Delete one orphaned tmp file by name (relative to the config dir). */
function unlinkSessionIndexTmp(name) {
  const dir = require('./config').getConfigDir();
  fs.unlinkSync(path.join(dir, name));
}

/**
 * Compose the doctor check line for the tmp-orphan sweep. Pure decision logic
 * (list/sweep side effects come in via `d`); src/cli-handlers-doctor.js wraps
 * this in guard() the same way it wires the mcp-legacy check's inspect/migrate.
 * @param {{listSessionIndexTmpFiles: () => Array<{name:string, mtimeMs:number}>,
 *   fix?: boolean, now: () => number, unlinkSessionIndexTmp: (name: string) => void}} d
 * Its four `message` strings are byte-identical to
 * session-metadata-tmp-sweep.js's evaluateSessionMetadataTmpSweep by design
 * (only `id`/`name`/`fixDetail` differ) — reword both or neither.
 */
function evaluateSessionIndexTmpSweep(d) {
  const id = 'sessions-index-tmp'; const name = 'Session index tmp files';
  const files = d.listSessionIndexTmpFiles() || [];
  if (files.length === 0) {
    return { id, name, status: 'ok', message: '0 orphaned tmp files', hint: null };
  }
  if (!d.fix) {
    return { id, name, status: 'warn', message: `${files.length} orphaned tmp file(s) — run with --fix`, hint: HINTS.sweepSessionIndexTmp };
  }
  const nowMs = d.now();
  const sweepable = files.filter((f) => (nowMs - f.mtimeMs) > AGE_THRESHOLD_MS);
  let swept = 0;
  for (const f of sweepable) {
    try { d.unlinkSessionIndexTmp(f.name); swept += 1; } catch { /* best-effort — report what we got */ }
  }
  const remaining = files.length - swept;
  if (remaining === 0) {
    const fixFields = swept > 0 ? { fixed: true, fixDetail: `swept ${swept} orphaned session-index tmp file(s)` } : {};
    return { id, name, status: 'ok', message: `swept ${swept} orphaned tmp file(s)`, hint: null, ...fixFields };
  }
  return { id, name, status: 'warn', message: `swept ${swept}, ${remaining} remaining (too fresh or unremovable)`, hint: HINTS.sweepSessionIndexTmp };
}

module.exports = {
  AGE_THRESHOLD_MS, listSessionIndexTmpFiles, unlinkSessionIndexTmp, evaluateSessionIndexTmpSweep,
};
