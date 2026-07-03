/**
 * Session path resolution.
 *
 * Resolves the on-disk directory for a session taskId under a project, with the
 * path-traversal guard and (issue #40) a cross-project fallback via the global
 * session index when the session is not found under the project this lookup
 * defaulted to.
 *
 * Extracted from validators.js to keep that module under the size gate.
 */

const fs = require('fs');
const path = require('path');
const { SESSIONS_DIR } = require('../session-manager');
const { lookupSessionProject } = require('./session-index');
const { canonicalProjectPath } = require('./project-path');

/** Resolve a session path under a single root, throwing on path traversal. */
function safeSessionDirUnder(project, root, taskId) {
  // Resolve so both sides share the same drive/separator form; on Windows path.join
  // yields a driveless root (\tmp\...) while path.resolve(taskId) adds the drive.
  const sessionsDir = path.resolve(path.join(project, '.claude', root));
  const resolved = path.resolve(sessionsDir, taskId);
  if (!resolved.startsWith(sessionsDir + path.sep)) {
    throw new Error('Invalid task ID: path traversal detected');
  }
  return resolved;
}

/** Probe the canonical root under one project; null if it doesn't exist. */
function existingDirUnderProject(project, taskId) {
  const canonical = safeSessionDirUnder(project, SESSIONS_DIR, taskId);
  if (fs.existsSync(canonical)) { return canonical; }
  return null;
}

/**
 * Resolve an EXISTING session path under the canonical amicus_sessions dir.
 *
 * On a per-project MISS (#40), consult the global index for the project the
 * taskId was actually recorded under and probe there — so a session created
 * under project A is still found when the lookup defaulted to project B. The
 * index read is guarded (corrupt index → null), the indexed project is
 * re-validated through the same traversal guard, and an index hit is only
 * returned when the dir actually exists; otherwise fall back to the canonical
 * (writeable) path under the given project.
 *
 * @throws {Error} If resolved path escapes the sessions directory
 */
function safeSessionDir(project, taskId) {
  const local = existingDirUnderProject(project, taskId);
  if (local) { return local; }

  const indexedProject = lookupSessionProject(taskId);
  if (indexedProject && canonicalProjectPath(indexedProject) !== canonicalProjectPath(project)) {
    const indexed = existingDirUnderProject(indexedProject, taskId);
    if (indexed) { return indexed; }
  }

  // Default to the canonical (writeable) path under the given project.
  return safeSessionDirUnder(project, SESSIONS_DIR, taskId);
}

module.exports = { safeSessionDir, safeSessionDirUnder };
