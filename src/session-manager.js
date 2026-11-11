/**
 * Session Manager Module
 *
 * Spec Reference: Section 8.1 What Gets Persisted, Section 7.4 Metadata Tracking
 * Session directory paths for sidecar sessions.
 */

const path = require('path');

/** Canonical session dir name — new sessions are written here. */
const SESSIONS_DIR = 'amicus_sessions';

/** Subagent sessions nest one level under their parent taskId dir. */
const SUBAGENTS_DIR = 'subagents';

/**
 * Get the canonical session directory path for a task (used for WRITES).
 * Spec Reference: §8.1 Session directory structure
 *
 * @param {string} projectDir - Project directory path
 * @param {string} taskId - Sidecar task ID
 * @returns {string} Path to the session directory
 *
 * @example
 * getSessionDir('/path/to/project', 'abc123')
 * // Returns: '/path/to/project/.claude/amicus_sessions/abc123'
 */
function getSessionDir(projectDir, taskId) {
  const sessionDir = path.join(projectDir, '.claude', SESSIONS_DIR, taskId);
  // Defense-in-depth: reject a taskId that would escape the sessions dir
  // (path separators / '..'). Callers pre-validate today; this is a backstop.
  const base = path.resolve(projectDir, '.claude', SESSIONS_DIR);
  const resolved = path.resolve(sessionDir);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new Error('Invalid task ID: path traversal detected');
  }
  return sessionDir;
}

/**
 * Resolve an EXISTING session dir for reads. Currently identical to
 * getSessionDir (kept as a distinct name for call-site clarity/history —
 * pre-#19 it also probed a legacy session-dir root).
 *
 * @param {string} projectDir - Project directory path
 * @param {string} taskId - Sidecar task ID
 * @returns {string} Path to the resolved session directory
 */
function resolveExistingSessionDir(projectDir, taskId) {
  return getSessionDir(projectDir, taskId);
}

module.exports = {
  getSessionDir,
  resolveExistingSessionDir,
  SESSIONS_DIR,
  SUBAGENTS_DIR
};
