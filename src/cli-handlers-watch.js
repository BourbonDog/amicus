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
  const { containsOnDisk } = require('./utils/path-fence');
  const ptr = readPointer(project, clean);
  // readPointer validates `council-<id>.json`'s {runId, runDir} only for
  // truthiness (run-state.js:133-139), so a tampered or stale pointer can point
  // runDir anywhere on disk — and this resolver's runDir is what
  // observe/watch-render.js opens events.jsonl from. Same realpath-containment
  // fence the v4.4 workspace reads use (src/utils/path-fence.js); a real
  // runDir is always nested inside project (src/mcp-council-run.js:109 enforces
  // it at creation time), so nothing legitimate is refused. An escaping pointer
  // falls through to the session lookup and then 'unknown' — the same outcome a
  // missing pointer already produces, so handleWatch's BAD_SESSION contract is
  // unchanged.
  if (ptr && containsOnDisk(project, ptr.runDir)) {
    return { kind: 'council', id: clean, runDir: ptr.runDir };
  }

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
 * `amicus watch [--ui] <id> [--json|--plain] [--interval <sec>] [--project <p>]`
 * @param {object} args parsed CLI args
 * @returns {Promise<number>} exit code (render loop: Task 12)
 */
async function handleWatch(args) {
  // v4.4: `amicus watch [--ui] [runId]` — GUI watch is the same verb (spec
  // §4.4), not a separate command. Handled at the very top, above id
  // resolution: unlike the machine-readable path, `--ui` alone (no runId)
  // is valid and opens the Council Workspace run-list landing, so this
  // branch must run BEFORE the "id is required" gate below.
  if (args.ui) {
    if (args.json) {
      process.stderr.write('Error: --ui is interactive-only (no --json). Use amicus watch <id> --json for machine output.\n');
      return 1;
    }
    // --project wins over --cwd (same precedence as the non-UI path below) —
    // DE-ROT F46: `--project` is the documented first-priority option for
    // `watch`; resolving from --cwd only would silently point the workspace
    // at the wrong directory when a run was launched elsewhere.
    const project = args.project || args.cwd || process.cwd();
    const runId = args._[1] ? String(args._[1]) : '';
    // ⚠️ v4.4.1 DOC-3: validate HERE, not by moving the branch. The branch's
    // POSITION above the `id is required` gate is load-bearing (bare `--ui`
    // opens the run-list landing and must keep working), so the runId check is
    // pushed inside it and made conditional on a runId actually being supplied.
    // Without this, `amicus watch <typo> --ui` skipped validateTaskId entirely
    // and surfaced whatever getRunDetail produced — a vaguer error than the
    // identical typo gets on the terminal path.
    if (runId) {
      const uiCheck = validateTaskId(runId);
      if (!uiCheck.valid) { process.stderr.write(`${uiCheck.error}\n`); return 1; }
    }
    const { launchWorkspaceWindow } = require('./sidecar/workspace-window');
    const res = await launchWorkspaceWindow({ project, runId });
    if (res.error) { process.stderr.write(`${res.error}\n`); }
    return res.code;
  }

  const { failJson, ERROR_CODES } = require('./utils/error-doc');
  const id = args._[1];
  if (!id || id === true) {
    process.stderr.write('Error: id is required for watch\nUsage: amicus watch <id> [--json] [--plain] [--interval <sec>]\n');
    return 1;
  }
  const check = validateTaskId(String(id));
  if (!check.valid) { process.stderr.write(`${check.error}\n`); return 1; }

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
