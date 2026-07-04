/**
 * CLI Abort Handler (B21-rest extraction)
 *
 * Split out of src/cli-handlers.js — that file was already near the 300-line
 * size gate and had no headroom for the --json branch added here. Re-exported
 * from src/cli-handlers.js so existing callers/tests are unaffected.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { validateTaskId, safeSessionDir } = require('./utils/validators');
const { failJson, ERROR_CODES } = require('./utils/error-doc');
const { buildAbortResult } = require('./utils/result-schema');

/**
 * Handle 'amicus abort --all --json': mark every running session aborted.
 * @returns {number} exit code (always 0 — even a no-op --all is a success)
 */
function handleAbortAllJson(project) {
  const { enumerateSessions } = require('./sidecar/read');
  const { markAborted } = require('./utils/session-abort');
  const { resolveExistingSessionDir } = require('./session-manager');
  const running = enumerateSessions(project, { status: 'running' });
  const aborted = [];
  for (const s of running) {
    if (markAborted(resolveExistingSessionDir(project, s.id), 'abort --all')) { aborted.push(s.id); }
  }
  console.log(JSON.stringify(buildAbortResult({ scope: 'all', taskId: null, aborted }), null, 2));
  return 0;
}

/**
 * Handle 'amicus abort <taskId> --json' for a single session or a wave.
 * Mirrors the human-mode logic in handleAbort below but emits ONE doc on
 * stdout instead of the multi-line console.log prose; the same waitThenKill
 * fallback still runs, its narration routed to stderr instead of stdout.
 * @returns {Promise<number>} exit code (always 0 for a resolved abort doc/error
 *   doc — both are "the command ran"; ok:false is signaled inside the doc)
 */
async function handleAbortTaskJson(args, taskId) {
  const project = args.cwd || process.cwd();
  const sessionDir = safeSessionDir(project, taskId);
  const metaPath = path.join(sessionDir, 'metadata.json');

  if (!fs.existsSync(metaPath)) {
    process.exit(failJson(true, { code: ERROR_CODES.BAD_SESSION, message: `Session ${taskId} not found` }));
  }

  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  } catch (_err) {
    process.exit(failJson(true, { code: ERROR_CODES.BAD_SESSION, message: `Session ${taskId} has malformed metadata` }));
  }

  if (meta.status !== 'running') {
    // Not a hard error — the task exists — but nothing was aborted by this call.
    console.log(JSON.stringify(buildAbortResult({ scope: 'session', taskId, aborted: [] }), null, 2));
    return 0;
  }

  const { markAborted } = require('./utils/session-abort');

  if (meta.type === 'wave') {
    const { resolveExistingSessionDir } = require('./session-manager');
    const aborted = [];
    for (const legId of meta.legs || []) {
      const legDir = resolveExistingSessionDir(project, legId);
      try {
        const legMeta = JSON.parse(fs.readFileSync(path.join(legDir, 'metadata.json'), 'utf-8'));
        if (legMeta.status === 'running') {
          if (markAborted(legDir, 'wave abort')) { aborted.push(legId); }
        }
      } catch { /* skip unreadable leg */ }
    }
    markAborted(sessionDir, 'manual abort');
    aborted.unshift(taskId);
    console.log(JSON.stringify(buildAbortResult({ scope: 'wave', taskId, aborted }), null, 2));
    return 0;
  }

  markAborted(sessionDir, 'manual abort');

  // Same fallback direct-kill as human mode (see the comment on the
  // equivalent block in handleAbort below) — json mode still needs the
  // process actually signalled, it just can't narrate it on stdout (stdout
  // must carry ONLY the doc). Route the same chatter to stderr instead.
  if (meta.pid) {
    const { waitThenKill, abortGraceMs } = require('./utils/abort-coordinator');
    const graceSec = Math.ceil(abortGraceMs() / 1000);
    process.stderr.write(`Waiting up to ${graceSec}s for the session process (pid ${meta.pid}) to exit gracefully...\n`);
    const { killed, exited } = await waitThenKill(meta.pid);
    if (killed.length > 0) {
      process.stderr.write(`Process ${meta.pid} did not exit in time — sent SIGTERM (a hard kill on Windows).\n`);
    } else if (exited.length > 0) {
      process.stderr.write('Process exited cleanly.\n');
    } else {
      process.stderr.write(`Process ${meta.pid} is still running — could not signal it (insufficient permission). It may require manual termination.\n`);
    }
  }

  console.log(JSON.stringify(buildAbortResult({ scope: 'session', taskId, aborted: [taskId] }), null, 2));
  return 0;
}

/**
 * Handle 'sidecar abort' command
 * Marks a running session as aborted
 * @returns {Promise<number|undefined>} exit code (json mode only; human mode
 *   uses process.exit internally on failure paths and implicitly returns 0)
 */
async function handleAbort(args) {
  const useJson = !!args.json;

  if (args.all) {
    const project = args.cwd || process.cwd();
    if (useJson) { return handleAbortAllJson(project); }

    const { enumerateSessions } = require('./sidecar/read');
    const { markAborted } = require('./utils/session-abort');
    const { resolveExistingSessionDir } = require('./session-manager');
    // A session may complete between enumeration and the write (TOCTOU); the
    // window is tiny for a local CLI and markAborted is best-effort, so we count
    // only sessions actually marked aborted.
    const running = enumerateSessions(project, { status: 'running' });
    if (running.length === 0) {
      console.log('No running sessions to abort.');
      return 0;
    }
    let aborted = 0;
    for (const s of running) {
      if (markAborted(resolveExistingSessionDir(project, s.id), 'abort --all')) {
        aborted++;
        console.log(`Aborted ${s.id}`);
      }
    }
    console.log(`Aborted ${aborted} running session(s).`);
    return 0;
  }

  const taskId = args._[1];

  if (!taskId) {
    if (useJson) { process.exit(failJson(true, { code: ERROR_CODES.BAD_SESSION, message: 'Error: task_id is required for abort' })); }
    console.error('Error: task_id is required for abort');
    console.error('Usage: amicus abort <task_id>');
    process.exit(1);
  }

  const taskIdCheck = validateTaskId(taskId);
  if (!taskIdCheck.valid) {
    if (useJson) { process.exit(failJson(true, { code: ERROR_CODES.BAD_SESSION, message: taskIdCheck.error })); }
    console.error(taskIdCheck.error);
    process.exit(1);
  }

  if (useJson) { return await handleAbortTaskJson(args, taskId); }

  const project = args.cwd || process.cwd();
  const sessionDir = safeSessionDir(project, taskId);
  const metaPath = path.join(sessionDir, 'metadata.json');

  if (!fs.existsSync(metaPath)) {
    console.error(`Session ${taskId} not found`);
    process.exit(1);
  }

  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  } catch (_err) {
    console.error(`Session ${taskId} has malformed metadata`);
    process.exit(1);
  }
  // Guard against a completed/terminal session: without this, metadata.pid
  // still holds a value forever and `amicus abort <completed-task>` would
  // wait the grace window then TerminateProcess whatever unrelated process
  // now owns that (possibly recycled) pid. Mirrors MCP's amicus_abort guard
  // (src/mcp-server.js) — same wording, no re-mark, no kill.
  if (meta.status !== 'running') {
    console.log(`Session ${taskId} is not running (status: ${meta.status}).`);
    return 0;
  }

  const { markAborted } = require('./utils/session-abort');

  // F4: aborting a wave aborts every still-running leg too.
  if (meta.type === 'wave') {
    const { resolveExistingSessionDir } = require('./session-manager');
    let aborted = 0;
    for (const legId of meta.legs || []) {
      const legDir = resolveExistingSessionDir(project, legId);
      try {
        const legMeta = JSON.parse(fs.readFileSync(path.join(legDir, 'metadata.json'), 'utf-8'));
        // TOCTOU: a leg may complete between this read and markAborted —
        // best-effort, same contract as abort --all above.
        if (legMeta.status === 'running') {
          if (markAborted(legDir, 'wave abort')) { aborted++; }
        }
      } catch { /* skip unreadable leg */ }
    }
    markAborted(sessionDir, 'manual abort');
    console.log(`Wave ${taskId} marked as aborted (${aborted} running leg(s) aborted).`);
    return 0;
  }

  markAborted(sessionDir, 'manual abort');
  console.log(`Session ${taskId} marked as aborted.`);

  // Phase 3: fallback direct-kill for a session that does not honor the
  // marker. Headless loops poll the marker every ~2s and the interactive
  // abort watch does too, so the normal outcome is a graceful exit during
  // the grace window; only a wedged/legacy process gets SIGTERM. The wait is
  // awaited on purpose — bin/amicus.js arms its force-exit watchdog only
  // after this handler returns.
  if (meta.pid) {
    const { waitThenKill, abortGraceMs } = require('./utils/abort-coordinator');
    const graceSec = Math.ceil(abortGraceMs() / 1000);
    console.log(`Waiting up to ${graceSec}s for the session process (pid ${meta.pid}) to exit gracefully...`);
    const { killed, exited } = await waitThenKill(meta.pid);
    if (killed.length > 0) {
      console.log(`Process ${meta.pid} did not exit in time — sent SIGTERM (a hard kill on Windows).`);
    } else if (exited.length > 0) {
      console.log('Process exited cleanly.');
    } else {
      // 3.1 contract: an EPERM-unkillable pid lands in NEITHER array —
      // it is still alive and we could not signal it. Say so honestly.
      console.log(`Process ${meta.pid} is still running — could not signal it (insufficient permission). It may require manual termination.`);
    }
  }
  return 0;
}

module.exports = { handleAbort };
