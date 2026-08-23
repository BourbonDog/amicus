// src/utils/session-index-prune.js
'use strict';

/**
 * R16: sessions-index.json stale-entry prune for `amicus doctor --fix`.
 *
 * session-index.js :: recordSession appends taskId -> canonicalProjectPath on
 * every session start and nothing ever removes one. A project that is
 * deleted, renamed or moved leaves its rows behind forever, and every
 * recordSession call pays for rewriting the WHOLE index (full read -> parse
 * -> mutate -> stringify -> atomic write), so the per-start cost grows with
 * total sessions ever, not live ones (docs/superpowers/plans/
 * 2026-08-22-v48-wave25-r16-index-prune.md §0.1). This module lists and
 * removes the dead rows; src/cli-handlers-doctor.js composes the result into
 * a check line. Structurally mirrors utils/session-index-tmp-sweep.js (R16-1:
 * reuse that whole warn/fix/hint shape rather than inventing a new one).
 *
 * R16-2 (liveness, NEVER age): an entry is stale IFF its project path no
 * longer resolves to a directory on disk. No TTL, no mtime sort — a
 * five-year-old entry for a project that still exists is still a valid
 * lookup target; a one-day-old entry for a deleted project is not. Unlike its
 * tmp-file sibling (which age-gates in `evaluate` so a live writer's ms-lived
 * tmp is never swept), there is no such grace window here by design.
 *
 * R16-3 (probe distinct projects, not entries): the index is
 * taskId -> project and many task ids share one project (measured: `amicus
 * list --all`'s enumerateAllProjects walks every distinct project — 21,145
 * rows in 8,275ms before a manual prune to 187 entries, 132 rows in 53ms
 * after). Probing per-entry would repeat the same statSync for every task id
 * that shares a project; `listStaleSessionIndexEntries` dedupes to the
 * distinct project set FIRST, statSyncs each ONCE, then marks entries whose
 * project is in the dead set. Both counts are reported.
 */

const fs = require('fs');
const path = require('path');
const HINTS = require('./remediation-hints');

const EMPTY_RESULT = Object.freeze({
  staleTaskIds: [], entryCount: 0, distinctProjectCount: 0, staleProjectCount: 0,
});

/**
 * Whether `project` still resolves to a directory.
 *
 * statSync (not lstatSync) is deliberate: unlike session-index-tmp-sweep.js's
 * DESTRUCTIVE unlink (see that file's symlink-safety comment) or
 * session-metadata-tmp-sweep.js's never-follow walk, nothing here ever
 * deletes anything AT `project` — only the taskId's row in a wholly separate
 * JSON file. A project reached through a symlink is a live lookup target
 * exactly like any other; a DANGLING symlink should read as gone the same way
 * a deleted real directory does, which is what following (statSync), not
 * lstatSync, gives us.
 *
 * Judgment call (R16, left open by the plan on purpose): only ENOENT/ENOTDIR
 * is treated as "confirmed gone". Everything else — EACCES, EPERM, a
 * transient EIO, an unmounted network share timing out — means "cannot
 * confirm", not "confirmed gone", so it is treated as LIVE. This mirrors the
 * ENOENT-only split workspace/artifact-guard.js :: readRunArtifact already
 * uses for the identical ambiguity (its RN-10 fix). Treating "cannot read" as
 * "does not exist" would prune a LIVE entry on a permissions blip — both a
 * liveness-check correctness bug (R16-2) and a silent loss of user state
 * (plan Global Constraint 5).
 *
 * @param {string} project
 * @param {(p: string) => import('fs').Stats} statSync
 * @returns {boolean}
 */
function projectExists(project, statSync) {
  try {
    return statSync(project).isDirectory();
  } catch (err) {
    if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) { return false; }
    return true;
  }
}

/**
 * List session-index entries whose project no longer exists.
 *
 * Never throws: the corrupt/missing-index case is handled exactly as
 * session-index.js :: readIndex already handles it (corrupt/missing -> {}),
 * and any other unexpected failure degrades to the all-clear empty shape
 * rather than propagating into `doctor`.
 *
 * @param {{statSync?: (p: string) => import('fs').Stats,
 *   readIndex?: () => Record<string,string>}} [deps] - injectable for tests
 *   (e.g. to simulate EACCES without needing real OS permissions).
 * @returns {{staleTaskIds: string[], entryCount: number,
 *   distinctProjectCount: number, staleProjectCount: number}}
 */
function listStaleSessionIndexEntries(deps = {}) {
  try {
    const statSync = deps.statSync || fs.statSync;
    const readIndex = deps.readIndex || require('./session-index').readIndex;

    const index = readIndex() || {};
    const taskIds = Object.keys(index);

    // R16-3: dedupe to the DISTINCT project set before ever touching the disk.
    const projects = new Set();
    for (const taskId of taskIds) {
      const project = index[taskId];
      if (typeof project === 'string' && project) { projects.add(project); }
    }

    const deadProjects = new Set();
    for (const project of projects) {
      if (!projectExists(project, statSync)) { deadProjects.add(project); }
    }

    const staleTaskIds = taskIds.filter((taskId) => {
      const project = index[taskId];
      // A non-string/empty project can never resolve to a lookup target
      // either — dead weight from the same "nothing ever removes a row" gap,
      // and this is the only place that can ever clean it up.
      return !(typeof project === 'string' && project) || deadProjects.has(project);
    });

    return {
      staleTaskIds,
      entryCount: taskIds.length,
      distinctProjectCount: projects.size,
      staleProjectCount: deadProjects.size,
    };
  } catch {
    return EMPTY_RESULT;
  }
}

/**
 * Remove the given taskIds from the index, atomically, through the same
 * writeFileAtomic path session-index.js :: recordSession uses. Re-reads the
 * index fresh (never reuses a list-time snapshot) so a concurrent
 * recordSession between list and prune is never clobbered, and writes only
 * when at least one given id is still actually present.
 *
 * Unlike listStaleSessionIndexEntries, this does NOT guard its own throws —
 * matching session-index-tmp-sweep.js :: unlinkSessionIndexTmp, which also
 * lets fs errors propagate to its caller. evaluateSessionIndexPrune (below)
 * is that caller, and catches.
 *
 * @param {string[]} staleTaskIds
 * @returns {number} count actually removed (may be less than
 *   staleTaskIds.length if an id was already gone by the time this ran).
 */
function pruneStaleSessionIndexEntries(staleTaskIds) {
  const ids = staleTaskIds || [];
  if (ids.length === 0) { return 0; }

  const { readIndex, INDEX_FILENAME } = require('./session-index');
  const { getConfigDir } = require('./config');
  const { writeFileAtomic } = require('./atomic-write');

  const index = readIndex();
  let removed = 0;
  for (const taskId of ids) {
    if (Object.prototype.hasOwnProperty.call(index, taskId)) {
      delete index[taskId];
      removed += 1;
    }
  }
  if (removed === 0) { return 0; }

  const target = path.join(getConfigDir(), INDEX_FILENAME);
  writeFileAtomic(target, JSON.stringify(index, null, 2), { mode: 0o600 });
  return removed;
}

/**
 * Compose the doctor check line for the stale-entry prune. Pure decision
 * logic (list/prune side effects come in via `d`); src/cli-handlers-doctor.js
 * wraps this in guard() the same way it wires the tmp-sweep check beside it.
 * @param {{listStaleSessionIndexEntries: () => {staleTaskIds:string[],
 *   entryCount:number, distinctProjectCount:number, staleProjectCount:number},
 *   fix?: boolean,
 *   pruneStaleSessionIndexEntries: (ids: string[]) => number}} d
 */
function evaluateSessionIndexPrune(d) {
  const id = 'sessions-index-prune'; const name = 'Session index stale entries';
  const list = d.listStaleSessionIndexEntries() || EMPTY_RESULT;
  const { staleTaskIds, entryCount, distinctProjectCount, staleProjectCount } = list;
  const staleCount = staleTaskIds.length;

  if (staleCount === 0) {
    return {
      id, name, status: 'ok',
      message: `0 stale rows (${entryCount} entries, ${distinctProjectCount} distinct project(s) checked)`,
      hint: null,
    };
  }
  if (!d.fix) {
    return {
      id, name, status: 'warn',
      message: `${staleCount} stale row(s) of ${entryCount} — ${staleProjectCount} of ${distinctProjectCount} distinct project(s) gone — run with --fix`,
      hint: HINTS.pruneSessionIndex,
    };
  }

  let pruned = 0;
  try { pruned = d.pruneStaleSessionIndexEntries(staleTaskIds) || 0; }
  catch { /* best-effort — report what we found, not what we could not write */ }

  if (pruned === staleCount) {
    return {
      id, name, status: 'ok', message: `pruned ${pruned} stale row(s)`, hint: null,
      fixed: true,
      fixDetail: `pruned ${pruned} stale session-index row(s) (${staleProjectCount} deleted project(s))`,
    };
  }
  const remaining = staleCount - pruned;
  return {
    id, name, status: 'warn',
    message: `pruned ${pruned}, ${remaining} remaining (index changed or write failed)`,
    hint: HINTS.pruneSessionIndex,
  };
}

module.exports = {
  listStaleSessionIndexEntries, pruneStaleSessionIndexEntries, evaluateSessionIndexPrune,
};
