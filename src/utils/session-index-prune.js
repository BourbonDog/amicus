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

// The zeroed shape for "checked, nothing stale". Also the base (via spread)
// for the distinguishable failure shape listStaleSessionIndexEntries returns
// on an internal error — see that function's catch, below.
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
 * Never THROWS: the corrupt/missing-index case is handled exactly as
 * session-index.js :: readIndex already handles it (corrupt/missing -> {}),
 * so it never reaches the catch below. An unexpected internal failure still
 * degrades rather than propagates into `doctor` — but (council R16 fix round
 * A3) the degraded result now carries `error`, which an all-clear result
 * never has, so "checked, 0 stale" and "could not check" can never collapse
 * to the same value. See evaluateSessionIndexPrune for how that distinction
 * is read.
 *
 * @param {{statSync?: (p: string) => import('fs').Stats,
 *   readIndex?: () => Record<string,string>}} [deps] - injectable for tests
 *   (e.g. to simulate EACCES without needing real OS permissions).
 * @returns {{staleTaskIds: string[], entryCount: number,
 *   distinctProjectCount: number, staleProjectCount: number, error?: string}}
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
  } catch (err) {
    // Council R16 fix round (A3): landing here must not read the same as "0
    // stale rows" — this project's stated north star is that a
    // correct-but-SILENT degrade fails the bar as hard as a crash. The
    // expected corrupt/missing-index case never reaches this catch (readIndex
    // itself already guards to {}); what DOES land here is either a real bug
    // or a throwing injected dep (deps.readIndex/deps.statSync are both real
    // injection points). Tag the result so evaluateSessionIndexPrune can tell
    // "checked, found nothing" apart from "could not check" — still never
    // throws into doctor, just stops reporting a failure as an all-clear.
    return { ...EMPTY_RESULT, error: (err && err.message) || String(err) };
  }
}

/**
 * Remove the given taskIds from the index, atomically, through the same
 * writeFileAtomic path session-index.js :: recordSession uses. Re-reads the
 * index fresh (never reuses a list-time snapshot), deletes ONLY the given
 * ids — never any other key a concurrent writer may have added to the
 * freshly-read index (verified: tests/doctor-index-prune.test.js's "removes
 * only the given ids" and the B1 concurrent-add case below) — and writes
 * only when at least one given id is still actually present.
 *
 * `deps.readIndex` plus the `|| {}` guard below mirror
 * listStaleSessionIndexEntries (council R16 fix round A1/A4): that was the
 * one asymmetry between the two siblings — `list` was stub-testable for a
 * corrupt/absent readIndex, `prune` was not testable at all without a real
 * config dir, and an injected readIndex() returning null/undefined would
 * TypeError on `Object.prototype.hasOwnProperty.call(null, ...)`. The REAL
 * readIndex can never return null (session-index.js :: readIndex always
 * yields a validated object or `{}`), so this never fires in production —
 * it closes a tested gap, not a live bug. Still does NOT guard its own
 * THROWS, matching session-index-tmp-sweep.js :: unlinkSessionIndexTmp,
 * which also lets fs errors propagate to its caller; evaluateSessionIndexPrune
 * (below) is that catcher.
 *
 * B1/D1 (council R16 fix round 2 — raised again by two more models;
 * adjudicated, real, pre-existing, still NOT fixed here): the race is
 * TWO-SIDED. `target` is computed before the read so only the in-memory
 * filter below runs between read and write — the narrowest this window gets
 * without real synchronization — but session-index.js :: recordSession
 * performs the IDENTICAL unlocked read-modify-write. Locking only THIS side
 * would be theater: closing the race properly requires locking
 * recordSession too, exactly the hot-start-path cost ruling R16-1 rejected
 * when it chose this doctor-check design over "prune on write". Consequence,
 * unchanged: a session recorded by another process between this read and
 * this write is lost, degrading `amicus read <id>` from another project
 * into a not-found. `src/utils/session-lock.js` already provides atomic
 * PID/staleness lock-file primitives (used today per-session-dir, not for
 * this file) — the natural home for that future lock/CAS, noted so it is
 * not re-derived, but NOT wired in here: its own change, beyond R16.
 *
 * @param {string[]} staleTaskIds
 * @param {{readIndex?: () => Record<string,string>}} [deps] - injectable for
 *   tests (matches listStaleSessionIndexEntries's shape/rationale above).
 * @returns {number} count actually removed (may be less than
 *   staleTaskIds.length if an id was already gone by the time this ran).
 */
function pruneStaleSessionIndexEntries(staleTaskIds, deps = {}) {
  // Array.isArray, not `|| []` (council R16 fix round 2, A2/d1): the old
  // guard caught null/undefined but let any OTHER truthy value through — a
  // string would iterate per character below, a plain object would throw.
  const ids = Array.isArray(staleTaskIds) ? staleTaskIds : [];
  if (ids.length === 0) { return 0; }

  // Lazy requires here match session-index-tmp-sweep.js's established
  // convention for these same deps (council R16 fix round 2, A4) — kept, not hoisted.
  const { INDEX_FILENAME, readIndex: realReadIndex } = require('./session-index');
  const readIndex = deps.readIndex || realReadIndex;
  const { getConfigDir } = require('./config');
  const { writeFileAtomic } = require('./atomic-write');
  const target = path.join(getConfigDir(), INDEX_FILENAME);

  const index = readIndex() || {};
  let removed = 0;
  for (const taskId of ids) {
    if (Object.prototype.hasOwnProperty.call(index, taskId)) {
      delete index[taskId];
      removed += 1;
    }
  }
  if (removed === 0) { return 0; }

  writeFileAtomic(target, JSON.stringify(index, null, 2), { mode: 0o600 });
  return removed;
}

/**
 * Compose the doctor check line for the stale-entry prune. Pure decision
 * logic (list/prune side effects come in via `d`); src/cli-handlers-doctor.js
 * wraps this in guard() the same way it wires the tmp-sweep check beside it.
 * @param {{listStaleSessionIndexEntries: () => {staleTaskIds:string[],
 *   entryCount:number, distinctProjectCount:number, staleProjectCount:number,
 *   error?:string},
 *   fix?: boolean,
 *   pruneStaleSessionIndexEntries: (ids: string[]) => number}} d
 */
function evaluateSessionIndexPrune(d) {
  const id = 'sessions-index-prune'; const name = 'Session index stale entries';
  const list = d.listStaleSessionIndexEntries();

  // Council R16 fix round (A3): a listing failure gets its own status, never
  // coalesced into the "0 stale" shape below. `status: 'error'` is the same
  // vocabulary guard() uses for every other doctor check failure —
  // doctor-degrade.js turns it into a 'doctor-check-failed' record; doctor
  // still finishes and prints every other line (loud, not fatal).
  if (!list || list.error) {
    return {
      id, name, status: 'error',
      message: `could not determine stale session-index entries: ${(list && list.error) || 'unknown error'}`,
      hint: null,
    };
  }
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

  // Council R16 fix round (A2): capture WHY a write underperformed instead of
  // reporting every cause as the same generic guess — a thrown exception
  // (disk full, EACCES, a bug) is a different fact from some ids having
  // already been removed by a racing prune, and swallowing the exception's
  // own message was hiding that difference. Status stays 'warn' either way
  // (never crashes doctor — see the throwing-prune test) but the message no
  // longer lies about which one happened.
  let pruned = 0;
  let writeError = null;
  try { pruned = d.pruneStaleSessionIndexEntries(staleTaskIds) || 0; }
  catch (e) { writeError = (e && e.message) || 'unknown error'; }

  if (pruned === staleCount && !writeError) {
    return {
      id, name, status: 'ok', message: `pruned ${pruned} stale row(s)`, hint: null,
      fixed: true,
      fixDetail: `pruned ${pruned} stale session-index row(s) (${staleProjectCount} deleted project(s))`,
    };
  }
  // Council R16 fix round 2 (A3): name the OBSERVATION (fewer removed than
  // listed), not an inferred cause — the count can differ for reasons other
  // than "the index changed" underneath us.
  const remaining = staleCount - pruned;
  const reason = writeError ? `write failed: ${writeError}` : 'fewer entries removed than expected';
  return {
    id, name, status: 'warn',
    message: `pruned ${pruned}, ${remaining} remaining (${reason})`,
    hint: HINTS.pruneSessionIndex,
  };
}

module.exports = {
  listStaleSessionIndexEntries, pruneStaleSessionIndexEntries, evaluateSessionIndexPrune,
};
