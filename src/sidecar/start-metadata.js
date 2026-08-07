// src/sidecar/start-metadata.js
'use strict';

/**
 * @module start-metadata
 * createSessionMetadata, split out of start.js to keep that file under the
 * hard size gate (v4.7 PR3 Task 1: F8 relief). Pure move — same writes, same
 * order, same atomicity. start.js re-exports this so no importer changes.
 */

const fs = require('fs');

const { writeFileAtomic } = require('../utils/atomic-write');
const { SessionPaths } = require('./session-utils');

/** Create session directory and save metadata */
function createSessionMetadata(taskId, project, options) {
  const { model, prompt, briefing, noUi, headless, agent, thinking, pack } = options;

  const sessionDir = SessionPaths.sessionDir(project, taskId);
  fs.mkdirSync(sessionDir, { recursive: true, mode: 0o700 });

  const effectiveBriefing = prompt || briefing;
  const isHeadless = noUi !== undefined ? noUi : headless;

  // Preserve fields from existing metadata (e.g., pid written by MCP handler)
  const metaPath = SessionPaths.metadataFile(sessionDir);
  let existing = {};
  if (fs.existsSync(metaPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    } catch {
      // ignore corrupt metadata
    }
  }

  const metadata = {
    ...existing,
    taskId,
    model,
    project,
    briefing: effectiveBriefing,
    mode: isHeadless ? 'headless' : 'interactive',
    agent: agent || (isHeadless ? 'build' : 'chat'),
    thinking: thinking || 'medium',
    status: 'running',
    pid: existing.pid || process.pid,
    createdAt: existing.createdAt || new Date().toISOString(),
    ...(pack ? { pack } : {}), // v4.5 Task 13: absent-not-null; ...existing above preserves a prior write when this call omits pack.
  };

  writeFileAtomic(metaPath, JSON.stringify(metadata, null, 2), { mode: 0o600 });

  return sessionDir;
}

module.exports = { createSessionMetadata };
