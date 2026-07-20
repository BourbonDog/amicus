// src/mcp-council-run.js
'use strict';

/**
 * @module mcp-council-run
 * MCP surface for headless council runs (spec §8): the amicus_council_run
 * handler (15th tool, born-fenced) plus the council-awareness helpers that
 * amicus_status / amicus_list / amicus_abort call through the sessions-dir
 * pointer file. Lives outside mcp-server.js (grandfathered-oversized); the
 * spawn helper is INJECTED by mcp-server at call time to avoid a require
 * cycle.
 */

const fs = require('fs');
const path = require('path');
const runState = require('./council/run-state');
const { fenceSidecarOutput } = require('./utils/untrusted-fence');
const { RUNNING_VERSION } = require('./utils/version-info');
const { isPathInside } = require('./project-root-allowlist');

function textResult(text, isError) {
  const result = { content: [{ type: 'text', text }] };
  if (isError) { result.isError = true; }
  return result;
}

/** Resolve the bench: models XOR council preset (amicus_fanout parity). */
function resolveBenchInput(input) {
  const inputModels = Array.isArray(input.models) ? input.models : [];
  const hasModels = inputModels.length > 0;
  const hasCouncil = typeof input.council === 'string' && input.council.trim();
  if (hasModels && hasCouncil) { return { error: "Pass exactly one of 'models' / 'council', not both." }; }
  if (!hasModels && !hasCouncil) { return { error: "Provide 'models' or 'council'." }; }
  if (hasCouncil) {
    const { resolveCouncilMembers } = require('./utils/config');
    const { readCache } = require('./utils/model-catalog');
    const catalog = (readCache() || {}).models || [];
    const expanded = resolveCouncilMembers(input.council.trim(), catalog);
    if (expanded.error) { return { error: expanded.error }; }
    return { bench: expanded.models };
  }
  return { bench: inputModels };
}

/**
 * amicus_council_run: validate → prep run dir → spawn CLI child → return
 * {runId, runDir} immediately (fenced).
 * @param {object} input tool input
 * @param {string} project resolved project dir
 * @param {{spawnFn: Function, clientName: string}} helpers injected by mcp-server
 */
async function handleCouncilRunTool(input, project, helpers) {
  const CHAIR_DEFAULT = 'deepseek';
  if (typeof input.briefingFile !== 'string' || !input.briefingFile.trim()) {
    return textResult("amicus_council_run requires 'briefingFile' (a path to the briefing).", true);
  }
  let briefing;
  try { briefing = fs.readFileSync(input.briefingFile, 'utf-8'); }
  catch (e) { return textResult(`Cannot read briefingFile ${input.briefingFile}: ${e.message}`, true); }
  if (briefing.charCodeAt(0) === 0xFEFF) { briefing = briefing.slice(1); }
  if (!briefing.trim()) { return textResult(`briefingFile ${input.briefingFile} is empty.`, true); }

  const benchRes = resolveBenchInput(input);
  if (benchRes.error) { return textResult(benchRes.error, true); }
  const bench = benchRes.bench;
  if (bench.length < 2) { return textResult('A council needs at least 2 seats.', true); }
  const chair = (typeof input.chair === 'string' && input.chair.trim()) ? input.chair.trim() : CHAIR_DEFAULT;
  if (bench.includes(chair)) {
    return textResult(`Chair '${chair}' is a bench seat — pick a chair outside the bench (default: ${CHAIR_DEFAULT}).`, true);
  }
  const critic = (typeof input.critic === 'string' && input.critic.trim()) ? input.critic.trim() : null;
  if (critic && !bench.includes(critic)) {
    return textResult(`Critic '${critic}' must be one of the bench seats (${bench.join(', ')}).`, true);
  }
  const lenses = Array.isArray(input.lenses) && input.lenses.length ? input.lenses : null;
  if (critic && lenses) { return textResult('critic and lenses are mutually exclusive in v4.0.', true); }
  if (lenses && lenses.length !== bench.length) {
    return textResult(`lenses needs exactly one lens per seat (${bench.length} seats, got ${lenses.length}).`, true);
  }
  if (input.timeoutMinutes !== undefined &&
      (typeof input.timeoutMinutes !== 'number' || !Number.isFinite(input.timeoutMinutes) || input.timeoutMinutes <= 0)) {
    return textResult('timeoutMinutes must be a positive number.', true);
  }
  if (input.maxCost !== undefined &&
      (typeof input.maxCost !== 'number' || !Number.isFinite(input.maxCost) || input.maxCost <= 0)) {
    return textResult('maxCost must be a positive number.', true);
  }

  const { generateTaskId } = require('./sidecar/start');
  const runId = generateTaskId();
  const runDir = input.outDir
    ? path.resolve(project, String(input.outDir))
    : path.join(project, `council-${runId}`);
  if (!isPathInside(runDir, project)) {
    return textResult(`outDir must resolve to a path inside the project directory (${project}).`, true);
  }
  const briefingPath = path.join(runDir, 'briefing.md');
  try {
    fs.mkdirSync(runDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(briefingPath, briefing, { mode: 0o600 });
    runState.initRun(runDir, {
      schemaVersion: 2, type: 'council-run', runId, status: 'running', stages: [],
      bench, chair, critic, lenses, labelMap: null,
      options: {
        timeout: input.timeoutMinutes || null,
        maxCost: (typeof input.maxCost === 'number') ? input.maxCost : null,
        gateway: input.gateway || 'auto', outDir: runDir,
      },
      usage: null, createdAt: new Date().toISOString(),
    });
    runState.writePointer(project, runId, runDir);
  } catch (err) {
    return textResult(`Failed to prepare council run: ${err.message}`, true);
  }

  const args = [
    'council', 'run', '--prompt-file', briefingPath, '--run-id', runId,
    '--out-dir', runDir, '--json', '--cwd', project,
    '--models', bench.join(','), '--chair', chair,
    '--client', helpers.clientName,
  ];
  if (critic) { args.push('--critic', critic); }
  if (lenses) { args.push('--lenses', lenses.join(',')); }
  if (input.timeoutMinutes) { args.push('--timeout', String(input.timeoutMinutes)); }
  if (typeof input.maxCost === 'number') { args.push('--max-cost', String(input.maxCost)); }
  if (input.gateway) { args.push('--gateway', input.gateway); }

  try { helpers.spawnFn(args, runDir); } catch (err) {
    try {
      runState.checkpoint(runDir, { status: 'error', error: { code: 'INTERNAL', message: err.message }, completedAt: new Date().toISOString() });
    } catch { /* best-effort */ }
    return textResult(`Failed to start council run: ${err.message}`, true);
  }

  const body = JSON.stringify({
    schemaVersion: 2, type: 'council-run', runId, runDir, status: 'running',
    message: 'Council run started. Preferred: call amicus_wait with the runId — one blocking ' +
      'call replaces polling; re-call it while it returns timedOut: true. Fallback: poll ' +
      'amicus_status with the runId. Artifacts land in runDir (verdict.json, report.html).',
  });
  // Born-fenced (spec §8): council MCP tool text is wrapped like amicus_read.
  return textResult(fenceSidecarOutput(body));
}

/** ---- council-awareness helpers (consumed by mcp-server status/list/abort) ---- */

function elapsedOf(run) {
  const end = run.completedAt || new Date().toISOString();
  const ms = Math.max(0, new Date(end).getTime() - new Date(run.createdAt || end).getTime());
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

/** Status payload for a council runId, or null when the id is not a council run. */
function buildCouncilStatusPayload(project, taskId) {
  const ptr = runState.readPointer(project, taskId);
  if (!ptr) { return null; }
  const run = runState.readRun(ptr.runDir);
  if (!run) { return null; }

  // Crash detection: a running run.json whose engine pid is gone is 'error'.
  if (run.status === 'running' && run.pid) {
    try { process.kill(run.pid, 0); } catch (err) {
      if (err.code !== 'EPERM') {
        runState.checkpoint(ptr.runDir, {
          status: 'error', completedAt: new Date().toISOString(),
          error: { code: 'INTERNAL', message: 'Council engine process exited unexpectedly' },
        });
        run.status = 'error';
        run.error = { code: 'INTERNAL', message: 'Council engine process exited unexpectedly' };
      }
    }
  }

  const stages = (run.stages || []).map(s => ({
    name: s.name, status: s.status, waveId: s.waveId || null,
  }));
  const active = (run.stages || []).find(s => s.status === 'running') || null;
  let legsTotal = null; let legsComplete = null;
  if (active && active.waveId && active.project) {
    try {
      const { getSessionDir } = require('./session-manager');
      const { TERMINAL_STATUSES } = require('./utils/result-schema');
      const meta = JSON.parse(fs.readFileSync(
        path.join(getSessionDir(active.project, active.waveId), 'metadata.json'), 'utf-8'));
      const legs = meta.legs || [];
      legsTotal = legs.length;
      legsComplete = legs.filter((id) => {
        try {
          const m = JSON.parse(fs.readFileSync(
            path.join(getSessionDir(active.project, id), 'metadata.json'), 'utf-8'));
          return TERMINAL_STATUSES.includes(m.status);
        } catch { return false; }
      }).length;
    } catch { /* stage wave not on disk yet */ }
  }
  const payload = {
    taskId: run.runId, type: 'council-run', runId: run.runId, runDir: ptr.runDir,
    status: run.status, currentStage: active ? active.name : null, stages,
    legsTotal, legsComplete, elapsed: elapsedOf(run),
    exitCode: run.exitCode !== undefined ? run.exitCode : null,
    version: RUNNING_VERSION,
  };
  if (run.error) { payload.reason = `${run.error.code}: ${run.error.message}`; }
  return payload;
}

/** amicus_list entries for every council pointer in the project. */
function listCouncilRuns(project) {
  const { sanitizePreview } = require('./sidecar/progress-fields');
  const out = [];
  for (const ptr of runState.listPointers(project)) {
    const run = runState.readRun(ptr.runDir);
    if (!run) { continue; }
    let briefing = '';
    try { briefing = fs.readFileSync(path.join(ptr.runDir, 'briefing.md'), 'utf-8'); }
    catch { /* optional */ }
    const active = (run.stages || []).find(s => s.status === 'running');
    out.push({
      id: run.runId, type: 'council-run', status: run.status, mode: 'headless',
      model: null, agent: 'Plan', createdAt: run.createdAt,
      briefing: sanitizePreview(briefing, 80),
      stage: active ? active.name : null,
    });
  }
  return out;
}

/**
 * Abort a council run via its pointer: checkpoint run.json aborted (abort-wins)
 * and cascade to the active stage's wave + legs so in-flight legs settle.
 * @returns {null|{notFound?: true}|{alreadyTerminal: true, status}|{aborted: true, cascaded: number}}
 */
function abortCouncilRun(project, taskId) {
  const ptr = runState.readPointer(project, taskId);
  if (!ptr) { return null; }
  const run = runState.readRun(ptr.runDir);
  if (!run) { return null; }
  if (run.status !== 'running') { return { alreadyTerminal: true, status: run.status }; }

  const { markAborted } = require('./utils/session-abort');
  const { getSessionDir } = require('./session-manager');
  let cascaded = 0;
  for (const s of run.stages || []) {
    if (s.status !== 'running' || !s.waveId || !s.project) { continue; }
    try {
      const waveDir = getSessionDir(s.project, s.waveId);
      let meta = {};
      try { meta = JSON.parse(fs.readFileSync(path.join(waveDir, 'metadata.json'), 'utf-8')); }
      catch { /* wave record may not exist yet */ }
      for (const legId of meta.legs || []) {
        try { if (markAborted(getSessionDir(s.project, legId), 'council abort')) { cascaded++; } }
        catch { /* skip leg */ }
      }
      markAborted(waveDir, 'council abort');
    } catch { /* skip stage */ }
  }
  runState.checkpoint(ptr.runDir, { status: 'aborted', completedAt: new Date().toISOString() });
  if (run.pid) {
    try { require('./utils/abort-coordinator').waitThenKill(run.pid).catch(() => {}); }
    catch { /* best-effort */ }
  }
  return { aborted: true, cascaded };
}

module.exports = {
  handleCouncilRunTool, buildCouncilStatusPayload, listCouncilRuns, abortCouncilRun,
};
