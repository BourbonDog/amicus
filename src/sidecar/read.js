/**
 * Sidecar Read Operations Module
 *
 * Handles reading and listing sidecar sessions.
 * Spec Reference: §4.2, §4.5
 */

const fs = require('fs');
const path = require('path');
const { safeSessionDir, TASK_ID_PATTERN } = require('../utils/validators');
const { SESSIONS_DIR } = require('../session-manager');
const { fenceSidecarOutput } = require('../utils/untrusted-fence');

/**
 * Format a timestamp as relative age
 * @param {string} dateStr - ISO date string
 * @returns {string} Relative age (e.g., "30m ago", "5h ago", "3d ago")
 */
function formatAge(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) {
    return `${mins}m ago`;
  }
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Enumerate sessions under the canonical amicus_sessions root.
 * @param {string} project
 * @param {{status?: string}} [opts] - status filter ('running', etc.); omit/'all' for all
 * @returns {Array<{id, model, status, agent, briefing, createdAt}>}
 */
function enumerateSessions(project, opts = {}) {
  const root = path.join(project, '.claude', SESSIONS_DIR);

  const byId = new Map();
  if (fs.existsSync(root)) {
    for (const d of fs.readdirSync(root)) {
      if (!TASK_ID_PATTERN.test(d)) { continue; }
      if (byId.has(d)) { continue; }
      const metaPath = path.join(root, d, 'metadata.json');
      if (!fs.existsSync(metaPath)) { continue; }
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        byId.set(d, {
          id: d, model: meta.model, status: meta.status, agent: meta.agent,
          briefing: meta.briefing, createdAt: meta.createdAt,
          type: meta.type || 'run',
          parentWave: meta.parentWave || null,
          legCount: Array.isArray(meta.legs) ? meta.legs.length : null,
          mode: meta.mode || (meta.headless ? 'headless' : 'interactive'),
          ...(meta.tag ? { tag: meta.tag } : {}),
        });
      } catch { /* skip unreadable */ }
    }
  }

  let sessions = Array.from(byId.values())
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  if (opts.status && opts.status !== 'all') {
    sessions = sessions.filter(s => s.status === opts.status);
  }
  return sessions;
}

/**
 * Enumerate sessions across every project the global sessions-index
 * (src/utils/session-index.js) knows about, plus the current project. --all
 * support (F8 D14): the index is a navigation aid, never authoritative, so a
 * stale entry pointing at a missing/unreadable project directory is skipped
 * silently rather than surfaced as an error.
 *
 * Dedup is by CANONICAL identity (T5 review fix-wave): the index stores
 * canonical spellings (canonicalProjectPath — forward slashes, upper-cased
 * drive letter) while `project` arrives however the caller spelled it
 * (process.cwd() is backslashed on Windows). A raw string Set treated those
 * as two different projects, double-counting every row of the current
 * project whenever it was also present in the index (which it usually is —
 * every session start records itself). The current project is seeded FIRST
 * so its rows keep the caller's spelling rather than the index's.
 * @param {{status?: string, project?: string}} [opts]
 * @returns {Array<object>} enumerateSessions rows, each stamped with `project`
 */
function enumerateAllProjects(opts = {}) {
  const { status, project = process.cwd() } = opts;
  const { readIndex } = require('../utils/session-index');
  const { canonicalProjectPath } = require('../utils/project-path');
  const index = readIndex();

  const byCanonical = new Map();
  for (const p of [project, ...Object.values(index)]) {
    if (!p || typeof p !== 'string') { continue; }
    const key = canonicalProjectPath(p);
    if (!byCanonical.has(key)) { byCanonical.set(key, p); }
  }

  let sessions = [];
  for (const p of byCanonical.values()) {
    try {
      const rows = enumerateSessions(p, {}).map(s => ({ ...s, project: p }));
      sessions = sessions.concat(rows);
    } catch { /* unreadable project — skip silently */ }
  }

  sessions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  if (status && status !== 'all') {
    sessions = sessions.filter(s => s.status === status);
  }
  return sessions;
}

/**
 * List previous sidecar sessions
 * Spec Reference: §4.2
 *
 * @param {object} options
 * @param {string} [options.status] - Filter by status (all, running, complete)
 * @param {boolean} [options.all] - Cross-project via the global sessions-index (F8 D14)
 * @param {boolean} [options.json] - Output as JSON
 * @param {string} [options.project] - Project directory
 */
async function listSidecars(options) {
  const { status, all, json, project = process.cwd() } = options;

  const sessions = all
    ? enumerateAllProjects({ status, project })
    : enumerateSessions(project, { status });
  if (sessions.length === 0) {
    console.log('No amicus sessions found.');
    return;
  }

  if (json) {
    console.log(JSON.stringify(sessions, null, 2));
  } else {
    console.log(
      'ID'.padEnd(10) + 'MODEL'.padEnd(23) + 'STATUS'.padEnd(11) +
      'TAG'.padEnd(12) + 'AGE'.padEnd(12) + 'BRIEFING' +
      (all ? '  PROJECT' : '')
    );
    console.log('─'.repeat(all ? 100 : 80));
    sessions.forEach(s => {
      const age = formatAge(s.createdAt);
      const briefingShort = (s.briefing || '').slice(0, 30) +
        ((s.briefing?.length > 30) ? '...' : '');
      console.log(
        `${(s.id || '').padEnd(10)}` +
        `${(s.type === 'wave' ? `wave(${s.legCount ?? 0} legs)` : (s.model || '')).padEnd(23)}` +
        `${(s.status || 'unknown').padEnd(11)}` +
        `${(s.tag || '').padEnd(12)}` +
        `${age.padEnd(12)}` +
        `${briefingShort}` +
        (all ? `  ${s.project || ''}` : '')
      );
    });
  }
}

/**
 * Read sidecar session data
 * Spec Reference: §4.5
 *
 * @param {object} options
 * @param {string} options.taskId - Task ID to read
 * @param {boolean} [options.conversation] - Read conversation
 * @param {boolean} [options.metadata] - Read metadata
 * @param {string} [options.project] - Project directory
 */
async function readSidecar(options) {
  const { taskId, conversation, metadata, json, project = process.cwd() } = options;

  const sessionDir = safeSessionDir(project, taskId);

  if (!fs.existsSync(sessionDir)) {
    throw new Error(`Session ${taskId} not found`);
  }

  const metaPath = path.join(sessionDir, 'metadata.json');
  let meta = {};
  try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')); } catch { /* legacy/partial */ }

  if (json) {
    const { buildRunResultFromSession, buildWaveResultFromSession } = require('../utils/result-schema');
    const doc = meta.type === 'wave'
      ? buildWaveResultFromSession(project, taskId)
      : buildRunResultFromSession(project, taskId);
    console.log(JSON.stringify(doc, null, 2));
    return;
  }

  if (meta.type === 'wave' && !conversation && !metadata) {
    const { buildWaveResultFromSession } = require('../utils/result-schema');
    const { formatWaveHuman } = require('./fanout-output');
    // Fence the whole human-readable wave report: it embeds each leg's
    // folded-back summary/error, which is untrusted model prose (B03).
    console.log(fenceSidecarOutput(formatWaveHuman(buildWaveResultFromSession(project, taskId))));
    return;
  }

  if (conversation) {
    const convPath = path.join(sessionDir, 'conversation.jsonl');
    if (fs.existsSync(convPath)) {
      const lines = fs.readFileSync(convPath, 'utf-8').split('\n').filter(Boolean);
      const formatted = lines.map(line => {
        try {
          const msg = JSON.parse(line);
          const time = new Date(msg.timestamp).toLocaleTimeString();
          return `[${msg.role} @ ${time}] ${msg.content}\n`;
        } catch {
          // Skip malformed lines
          return null;
        }
      }).filter(Boolean).join('\n');
      // Fence the WHOLE conversation dump in ONE fence, not per-line: it is
      // untrusted model prose entering an agent's context (B03).
      console.log(fenceSidecarOutput(formatted));
    } else {
      console.log('No conversation recorded.');
    }
  } else if (metadata) {
    const metaPath = path.join(sessionDir, 'metadata.json');
    console.log(fs.readFileSync(metaPath, 'utf-8'));
  } else {
    // Default: show summary
    const summaryPath = path.join(sessionDir, 'summary.md');
    if (fs.existsSync(summaryPath)) {
      // Fence the folded-back summary: untrusted model prose (B03).
      console.log(fenceSidecarOutput(fs.readFileSync(summaryPath, 'utf-8')));
    } else {
      console.log('No summary available (session may not have been folded).');
    }
  }
}

module.exports = {
  formatAge,
  enumerateSessions,
  enumerateAllProjects,
  listSidecars,
  readSidecar
};
