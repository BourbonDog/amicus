// src/cli-handlers-watch.js
'use strict';

/**
 * `amicus watch <id>` (spec 5.1) — render any in-flight (or terminal) run from
 * any process, reading only the data layer (Surfaces A/B/C). This file owns id
 * resolution + the command entry; the pure renderers live in
 * src/observe/watch-render.js (Task 12). No fs.watch — a poll loop over the
 * composed doc (via handlers.amicus_status) + the events tail.
 */

const fs = require('fs');
const path = require('path');
const { validateTaskId } = require('./utils/validators');

/**
 * Resolve a watch id to a wave / council / solo target (pure over disk).
 * Resolution order (spec 5.1): council pointer file -> council; else session
 * metadata (type:'wave' -> wave, else -> solo); nothing readable -> unknown.
 * Uses the SAME canonical path builders the rest of the codebase resolves
 * sessions/pointers with — readPointer (council/run-state.js) and
 * getSessionDir (session-manager.js) — rather than hand-rolling disk paths,
 * so watch can never drift from how start/status/council resolve ids.
 * @param {string} id
 * @param {string} project
 * @returns {{kind:'wave'|'council'|'solo'|'unknown', id: string, runDir?: string}}
 */
function resolveWatchTarget(id, project) {
  const clean = String(id).replace(/^council-/, '');

  const { readPointer } = require('./council/run-state');
  const ptr = readPointer(project, clean);
  if (ptr) { return { kind: 'council', id: clean, runDir: ptr.runDir }; }

  // getSessionDir THROWS on a path-traversal id ('..' / separators) — this
  // resolver is exported and docblocked "pure over disk", so it must be
  // total for arbitrary input, not just for ids that already passed
  // validateTaskId in the wired CLI path (handleWatch, below). A throw here
  // (traversal or otherwise) falls through to 'unknown' like any other
  // unreadable id, rather than propagating out of a "pure" resolver.
  try {
    const { getSessionDir } = require('./session-manager');
    const metaPath = path.join(getSessionDir(project, clean), 'metadata.json');
    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      return { kind: meta.type === 'wave' ? 'wave' : 'solo', id: clean };
    }
  } catch { /* fall through to unknown */ }
  return { kind: 'unknown', id: clean };
}

/**
 * `amicus watch <id> [--json|--plain] [--interval <sec>] [--project <p>] [--ui]`
 * @param {object} args parsed CLI args
 * @returns {Promise<number>} exit code (render loop: Task 12)
 */
async function handleWatch(args) {
  const { failJson, ERROR_CODES } = require('./utils/error-doc');
  const id = args._[1];
  if (!id || id === true) {
    process.stderr.write('Error: id is required for watch\nUsage: amicus watch <id> [--json] [--plain] [--interval <sec>]\n');
    return 1;
  }
  const check = validateTaskId(String(id));
  if (!check.valid) { process.stderr.write(`${check.error}\n`); return 1; }

  // --ui is registered as the v4.4 Council Workspace seam only; this rev
  // (v4.3) registers the flag + this fail-fast, the GUI itself is out of
  // scope. --ui alone is accepted and falls through to the loop.
  if (args.ui && args.json) {
    process.stderr.write('Error: --ui is interactive-only and cannot be combined with --json\n');
    return 1;
  }

  const project = args.project || args.cwd || process.cwd();
  const target = resolveWatchTarget(String(id), project);
  if (target.kind === 'unknown') {
    return failJson(!!args.json, {
      code: ERROR_CODES.BAD_SESSION,
      message: `watch: id '${id}' not found or unreadable in ${project}`,
      hint: 'Pass --project if the run was launched elsewhere.',
    });
  }

  const { runWatchLoop } = require('./observe/watch-render');
  return runWatchLoop(target, args, project);
}

module.exports = { handleWatch, resolveWatchTarget };
