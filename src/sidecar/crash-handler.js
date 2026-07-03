/**
 * Crash Handler - Updates metadata to 'error' on uncaught exceptions
 *
 * Installed by bin/amicus.js for MCP-spawned processes that have a --task-id.
 * When the process crashes, the handler marks the session as failed so the
 * MCP client can detect the error instead of seeing a stuck 'running' status.
 */

const fs = require('fs');
const path = require('path');
const { SessionPaths } = require('./session-utils');
const { writeFileAtomic } = require('../utils/atomic-write');

/**
 * Create a crash handler that updates session metadata on error.
 *
 * @param {string} taskId - The sidecar task ID
 * @param {string} project - The project root directory
 * @returns {function(Error): void} Handler function to call with the error
 */
function installCrashHandler(taskId, project) {
  return function handleCrash(err) {
    try {
      // Operates on an EXISTING (possibly legacy) session — resolve dual-dir.
      const sessionDir = SessionPaths.resolveSessionDir(project, taskId);
      const metaPath = SessionPaths.metadataFile(sessionDir);

      if (!fs.existsSync(metaPath)) {
        return;
      }

      const metadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));

      if (metadata.status !== 'running') {
        return;
      }

      metadata.status = 'error';
      metadata.reason = err.message;
      metadata.errorAt = new Date().toISOString();

      writeFileAtomic(metaPath, JSON.stringify(metadata, null, 2), { mode: 0o600 });

      // Delete session lock if it exists
      const lockPath = path.join(sessionDir, 'session.lock');
      try {
        fs.unlinkSync(lockPath);
      } catch {
        // Lock may not exist yet
      }
    } catch (_ignored) {
      // Crash handler must never throw - swallow all errors
    }
  };
}

module.exports = { installCrashHandler };
