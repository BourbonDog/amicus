// src/utils/session-metadata-tmp-sweep.js
'use strict';

/**
 * v4.6.3 PR3 Task 3 (D8): orphaned per-session metadata.json.*.tmp sweep for
 * `amicus doctor --fix`.
 *
 * A kill between writeFileAtomic's tmp-write and rename (any of the ~30
 * metadata.json write sites — session-manager.js, sidecar/session-finalize.js,
 * etc.) leaves a stray `.metadata.json.<pid>.<hex>.tmp` file in a session
 * directory forever (the B09 orphan class). This module lists and removes
 * them; src/cli-handlers-doctor.js composes the result into a check line.
 * Structurally mirrors utils/session-index-tmp-sweep.js (B15's sibling).
 *
 * Enumeration decision (cwd-scoped, index rejected — recorded at plan time,
 * docs/superpowers/plans/2026-08-05-v463-pr3-cli-doctor-odds.md): this walks
 * `<process.cwd()>/.claude/amicus_sessions/` — each taskId dir plus its
 * `subagents/<id>/` children — rather than consulting sessions-index.json.
 * `amicus doctor` is a per-project surface; the index is best-effort and can
 * point at OTHER projects (issue #40's cross-project fallback exists exactly
 * because the index can be stale). Trusting it here to decide which
 * directories a --fix sweep may unlink from risks touching an unrelated
 * project on stale data — the wrong failure direction for a destructive
 * operation. Walking the cwd-scoped tree directly can only ever find/remove
 * files under the project doctor is already running against.
 *
 * Symlink safety (Task 3 review carry, v4.6.3 PR3): every stat in this walk
 * is lstatSync, never statSync — this module never follows symlinks. A
 * symlinked taskId or subagents directory could otherwise be traversed and
 * have files unlinked through the link, effectively outside the sessions
 * root; lstat closes that off at zero cost.
 *
 * Consequence of the SR-3 isFile() gate (listTmpIn, below): a SYMLINK whose
 * basename matches the tmp pattern is now excluded from the list entirely —
 * neither swept nor reported. Before SR-3 it was swept (unlink removes the
 * link, never the target — a safe success). Deliberate: this module's
 * never-follow policy applies to the entries it unlinks too. Note the sibling
 * session-index-tmp-sweep.js diverges here — it uses statSync, so a
 * symlink-to-a-file with the matching name IS still swept there.
 */

const fs = require('fs');
const path = require('path');
const HINTS = require('./remediation-hints');

/** Files older than this survive to the next --fix, never a live writer's ms-lived tmp. */
const AGE_THRESHOLD_MS = 60 * 1000;

/**
 * The cwd-scoped sessions root: <cwd>/.claude/amicus_sessions.
 * Reads process.cwd() directly, NOT doctor's injected getCwd
 * (cli-handlers-doctor.js's realDeps().getCwd) — the
 * listSessionMetadataTmpFiles/unlinkSessionMetadataTmp deps are wired
 * argument-free in that same realDeps(), so that seam does not reach here.
 * Thread cwd through those deps if a `doctor --cwd <dir>` mode ever lands.
 */
function sessionsRoot() {
  const { SESSIONS_DIR } = require('../session-manager');
  return path.join(process.cwd(), '.claude', SESSIONS_DIR);
}

/** True when `basename` is an orphaned metadata tmp file (not e.g. progress.json.*.tmp). */
function isMetadataTmp(basename) {
  return basename.startsWith('.metadata.json.') && basename.endsWith('.tmp');
}

/** List metadata tmp files directly inside `dir`, named relative to `root`. */
function listTmpIn(dir, root) {
  let entries;
  try { entries = fs.readdirSync(dir); } catch { return []; }
  return entries
    .filter(isMetadataTmp)
    .map((basename) => {
      let st = null;
      try { st = fs.lstatSync(path.join(dir, basename)); } catch { /* raced away */ }
      return { name: path.relative(root, path.join(dir, basename)), mtimeMs: st && st.isFile() ? st.mtimeMs : null };
    })
    .filter((f) => f.mtimeMs !== null);
}

/**
 * List orphaned per-session metadata.json.*.tmp files under the cwd-scoped
 * sessions root, covering both `<taskId>/` and `<taskId>/subagents/<id>/`.
 * @returns {Array<{name: string, mtimeMs: number}>}
 */
function listSessionMetadataTmpFiles() {
  const { SUBAGENTS_DIR } = require('../session-manager');
  const root = sessionsRoot();
  let taskIds;
  try { taskIds = fs.readdirSync(root); } catch { return []; }
  const found = [];
  for (const taskId of taskIds) {
    const taskDir = path.join(root, taskId);
    let stat;
    try { stat = fs.lstatSync(taskDir); } catch { continue; }
    if (!stat.isDirectory()) { continue; }
    found.push(...listTmpIn(taskDir, root));

    const subagentsDir = path.join(taskDir, SUBAGENTS_DIR);
    let subIds;
    try { subIds = fs.readdirSync(subagentsDir); } catch { continue; }
    for (const subId of subIds) {
      const subDir = path.join(subagentsDir, subId);
      let subStat;
      try { subStat = fs.lstatSync(subDir); } catch { continue; }
      if (!subStat.isDirectory()) { continue; }
      found.push(...listTmpIn(subDir, root));
    }
  }
  return found;
}

/** Delete one orphaned tmp file by name (relative to the sessions root; never an absolute/caller path). */
function unlinkSessionMetadataTmp(name) {
  const root = sessionsRoot();
  fs.unlinkSync(path.join(root, name));
}

/**
 * Compose the doctor check line for the metadata tmp-orphan sweep. Pure
 * decision logic (list/sweep side effects come in via `d`); src/cli-handlers-doctor.js
 * wraps this in guard() the same way it wires the sibling sessions-index-tmp check.
 * @param {{listSessionMetadataTmpFiles: () => Array<{name:string, mtimeMs:number}>,
 *   fix?: boolean, now: () => number, unlinkSessionMetadataTmp: (name: string) => void}} d
 * The four `message` strings below are byte-identical to the index sibling's
 * (session-index-tmp-sweep.js's evaluateSessionIndexTmpSweep, same four
 * ok/warn returns) on purpose — `id`/`name` and the `fixDetail` wording are
 * the only disambiguators between the two rows. Reword one side and the
 * pairing silently breaks: reword both, or neither.
 */
function evaluateSessionMetadataTmpSweep(d) {
  const id = 'session-metadata-tmp'; const name = 'Session metadata tmp files';
  const files = d.listSessionMetadataTmpFiles() || [];
  if (files.length === 0) {
    return { id, name, status: 'ok', message: '0 orphaned tmp files', hint: null };
  }
  if (!d.fix) {
    return { id, name, status: 'warn', message: `${files.length} orphaned tmp file(s) — run with --fix`, hint: HINTS.sweepSessionMetadataTmp };
  }
  const nowMs = d.now();
  const sweepable = files.filter((f) => (nowMs - f.mtimeMs) > AGE_THRESHOLD_MS);
  let swept = 0;
  for (const f of sweepable) {
    try { d.unlinkSessionMetadataTmp(f.name); swept += 1; } catch { /* best-effort — report what we got */ }
  }
  const remaining = files.length - swept;
  if (remaining === 0) {
    const fixFields = swept > 0 ? { fixed: true, fixDetail: `swept ${swept} orphaned session-metadata tmp file(s)` } : {};
    return { id, name, status: 'ok', message: `swept ${swept} orphaned tmp file(s)`, hint: null, ...fixFields };
  }
  return { id, name, status: 'warn', message: `swept ${swept}, ${remaining} remaining (too fresh or unremovable)`, hint: HINTS.sweepSessionMetadataTmp };
}

module.exports = {
  AGE_THRESHOLD_MS, listSessionMetadataTmpFiles, unlinkSessionMetadataTmp, evaluateSessionMetadataTmpSweep,
};
