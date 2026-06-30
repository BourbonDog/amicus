/**
 * Global session index (issue #40).
 *
 * The on-disk session store is PROJECT-scoped:
 *   <project>/.claude/amicus_sessions/<taskId>/
 * but the project a lookup resolves to can differ from the one a session was
 * created under (a stdio MCP server defaults to its install-dir cwd, MCP roots
 * may be absent, etc.). When that happens a perfectly valid session reads back
 * as "not found".
 *
 * This module maintains ONE global index, under the config dir, mapping
 *   taskId -> canonicalProjectPath(project)
 * written at session START and consulted ONLY on a per-project miss. It is a
 * navigation aid, never authoritative: a corrupt/partial index must NEVER crash
 * a lookup, so every read is guarded and degrades to "no entry".
 *
 * Concurrency: parallel fan-out/council runs write here at once. Writes are
 * atomic via write-temp + rename (rename is atomic on a single filesystem), and
 * a unique temp name per write avoids two writers colliding on the temp file.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getConfigDir } = require('./config');
const { canonicalProjectPath } = require('./project-path');

/** Index filename under the config dir. */
const INDEX_FILENAME = 'sessions-index.json';

/** @returns {string} Absolute path to the index file. */
function indexPath() {
  return path.join(getConfigDir(), INDEX_FILENAME);
}

/**
 * Read the index, returning a plain object. Never throws: a missing,
 * unreadable, or corrupt file yields an empty map.
 * @returns {Record<string, string>}
 */
function readIndex() {
  try {
    const raw = fs.readFileSync(indexPath(), 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    // Missing / unreadable / corrupt — fall through to a fresh map.
  }
  return {};
}

/**
 * Record taskId -> canonical project path at session START.
 *
 * Best-effort and crash-safe: a failure here must never block starting a
 * session, and a pre-existing corrupt index is recovered to a fresh map rather
 * than propagated. The write is atomic (temp file + rename).
 *
 * @param {string} taskId
 * @param {string} project - any spelling of the project dir; canonicalized here.
 */
function recordSession(taskId, project) {
  if (!taskId || !project) { return; }
  const canonical = canonicalProjectPath(project);
  try {
    const dir = getConfigDir();
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const index = readIndex(); // already guarded; corrupt -> {}
    index[taskId] = canonical;
    const target = path.join(dir, INDEX_FILENAME);
    // Unique temp name so concurrent writers never clobber the same temp file.
    const tmp = path.join(dir, `.${INDEX_FILENAME}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(index, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, target); // atomic on a single filesystem
  } catch {
    // Index is a navigation aid; never let its failure break a session start.
  }
}

/**
 * Look up the canonical project path a taskId was created under.
 * @param {string} taskId
 * @returns {string|null} canonical project path, or null if unknown.
 */
function lookupSessionProject(taskId) {
  if (!taskId) { return null; }
  const index = readIndex(); // guarded; never throws
  const project = index[taskId];
  return (typeof project === 'string' && project) ? project : null;
}

module.exports = {
  INDEX_FILENAME,
  recordSession,
  lookupSessionProject,
};
