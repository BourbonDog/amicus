// src/observe/on-complete.js
'use strict';

/**
 * @module observe/on-complete
 * CLI --on-complete exec hook (spec 5.3). The command is user-authored on the
 * command line of THIS invocation — the same trust level as typing it into the
 * shell. Amicus never sources hook commands from config/briefings/model output
 * (D8 withdrawn) and never interpolates anything into the command string. The
 * payload rides via ENVIRONMENT only, ids/paths only — never model-generated
 * text — so untrusted previews can never enter a user's shell pipeline. The
 * hook can never change the run's exit code, docs, or events. CLI-only: MCP
 * never gets exec (Task 15 gives MCP a notify-only hook).
 */

const HOOK_TIMEOUT_MS = Number(process.env.AMICUS_HOOK_TIMEOUT_MS) || 60000;

/** ids/paths ONLY (spec 5.3). Every value is a string; cost/paths default ''. */
function buildHookEnv(info) {
  return {
    AMICUS_TASK_ID: String(info.taskId || ''),
    AMICUS_TYPE: String(info.type || ''),
    AMICUS_STATUS: String(info.status || ''),
    AMICUS_EXIT_CODE: String(info.exitCode !== null && info.exitCode !== undefined ? info.exitCode : ''),
    AMICUS_RESULT_FILE: String(info.resultFile || ''),
    AMICUS_EVENTS_FILE: String(info.eventsFile || ''),
    AMICUS_COST: String(info.cost || ''),
    AMICUS_PROJECT: String(info.project || ''),
  };
}

/**
 * Fire the exec hook once at terminal state. Never throws/rejects; a non-zero
 * exit or timeout is a warning only — the run's exit code/docs/events are
 * never touched by this function.
 */
function runOnComplete(cmd, info, deps = {}) {
  const spawn = deps.spawn || require('child_process').spawn;
  const logger = deps.logger || require('../utils/logger').logger;
  const timeoutMs = deps.timeoutMs || HOOK_TIMEOUT_MS;
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, {
        shell: true, cwd: info.project || process.cwd(),
        env: { ...process.env, ...buildHookEnv(info) },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      logger.warn('on-complete hook failed to spawn (run unaffected)', { error: e.message });
      return resolve();
    }
    let done = false;
    const finish = () => { if (!done) { done = true; clearTimeout(timer); resolve(); } };
    const timer = setTimeout(() => {
      logger.warn('on-complete hook timed out — killing (run unaffected)', { timeoutMs });
      try { child.kill(); } catch { /* already gone */ }
      finish();
    }, timeoutMs);
    if (child.stdout) { child.stdout.on('data', (d) => process.stderr.write(d)); }
    if (child.stderr) { child.stderr.on('data', (d) => process.stderr.write(d)); }
    child.on('error', (e) => { logger.warn('on-complete hook error (run unaffected)', { error: e.message }); finish(); });
    child.on('close', (code) => {
      if (code && code !== 0) { logger.warn('on-complete hook exited non-zero (run unaffected)', { code }); }
      finish();
    });
  });
}

/**
 * Thin fire helper for fanout's two terminal sites (normal finalize + the
 * all-legs-failed short-circuit). No-ops on a falsy/non-string cmd so call
 * sites stay one line with no guard of their own.
 */
async function fireWaveOnComplete(cmd, wave, { waveId, waveDir, wavePath, exitCode, project }, deps) {
  if (!cmd || typeof cmd !== 'string') { return; }
  const path = require('path');
  const { formatCost } = require('../utils/pricing');
  const { EVENTS_FILE } = require('./events');
  await runOnComplete(cmd, {
    taskId: waveId, type: 'wave', status: wave.status, exitCode,
    resultFile: wavePath, eventsFile: path.join(waveDir, EVENTS_FILE),
    cost: wave.usage && wave.usage.cost ? formatCost(wave.usage.cost) : '',
    project,
  }, deps);
}

/**
 * Thin fire helper for council run.js's single finalize choke point. No-ops
 * on a falsy/non-string cmd so the call site stays one line.
 */
async function fireCouncilOnComplete(cmd, run, { runId, runDir, exitCode, project }, deps) {
  if (!cmd || typeof cmd !== 'string') { return; }
  const path = require('path');
  const { formatCost } = require('../utils/pricing');
  const { EVENTS_FILE } = require('./events');
  await runOnComplete(cmd, {
    taskId: runId, type: 'council-run', status: run.status, exitCode,
    resultFile: path.join(runDir, 'run.json'), eventsFile: path.join(runDir, EVENTS_FILE),
    cost: run.usage && run.usage.cost ? formatCost(run.usage.cost) : '',
    project,
  }, deps);
}

module.exports = {
  buildHookEnv, runOnComplete, fireWaveOnComplete, fireCouncilOnComplete, HOOK_TIMEOUT_MS,
};
