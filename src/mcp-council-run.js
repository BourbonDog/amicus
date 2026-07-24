// src/mcp-council-run.js
'use strict';

/**
 * @module mcp-council-run
 * MCP surface for headless council runs (spec §8): the amicus_council_run
 * handler (15th tool, born-fenced). Lives outside mcp-server.js
 * (grandfathered-oversized); the spawn helper is INJECTED by mcp-server at call
 * time to avoid a require cycle. The council-awareness helpers that
 * amicus_status / amicus_list / amicus_abort call now live in
 * mcp-council-awareness.js and are re-exported from here.
 */

const fs = require('fs');
const path = require('path');
const runState = require('./council/run-state');
const { fenceSidecarOutput } = require('./utils/untrusted-fence');
const { isPathInside } = require('./project-root-allowlist');

function textResult(text, isError) {
  const result = { content: [{ type: 'text', text }] };
  if (isError) { result.isError = true; }
  return result;
}

/**
 * Resolve the bench: models XOR council preset (amicus_fanout parity).
 * Also returns `presetName` (v4.3 Task 3, spec §7.1): the trimmed council
 * preset name when that branch was taken, else null — this handler always
 * spawns the CLI child with an already-expanded `--models` list (never
 * `--council`), so the preset name would otherwise be lost; the caller
 * forwards it via the internal `--council-name` passthrough instead.
 */
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
    const presetName = input.council.trim();
    const expanded = resolveCouncilMembers(presetName, catalog);
    if (expanded.error) { return { error: expanded.error }; }
    return { bench: expanded.models, presetName };
  }
  return { bench: inputModels, presetName: null };
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
  const presetName = benchRes.presetName;
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
  // v4.3 Task 3 (spec §7.1): the bench above is already expanded, so `--council`
  // itself is never spawned (it would collide with `--models`) — this internal,
  // undocumented flag carries the preset NAME through for attribution only.
  if (presetName) { args.push('--council-name', presetName); }
  // v4.1 §4.5b/§4.5d. claudeReviewFile is resolved against `project` for the same
  // reason outDir is — an MCP client may send a relative path, and the child's cwd
  // is the run dir. Validation of the file itself stays in the spawned engine's
  // pre-flight (run-assemble.preflightClaudeReview), so every entry point shares it.
  if (input.debate) { args.push('--debate'); }
  if (input.claudeReviewFile) { args.push('--claude-review', path.resolve(project, String(input.claudeReviewFile))); }
  if (input.noCostGate) { args.push('--no-cost-gate'); }

  let child;
  try { child = helpers.spawnFn(args, runDir); } catch (err) {
    try {
      runState.checkpoint(runDir, { status: 'error', error: { code: 'INTERNAL', message: err.message }, completedAt: new Date().toISOString() });
    } catch { /* best-effort */ }
    return textResult(`Failed to start council run: ${err.message}`, true);
  }
  // Record the child's pid NOW: the engine writes its own pid at startup, but a
  // child that dies before that leaves a pid-less status:'running' run.json that
  // crash detection skips and abort cannot signal. Written to its own file, not
  // patched into run.json — the child owns run.json and a cross-process
  // read-merge-write has no lock (see run-state.writeSpawnPid).
  try { if (typeof child?.pid === 'number') { runState.writeSpawnPid(runDir, child.pid); } }
  catch { /* best-effort */ }

  const body = JSON.stringify({
    schemaVersion: 2, type: 'council-run', runId, runDir, status: 'running',
    message: 'Council run started. Preferred: call amicus_wait with the runId — one blocking ' +
      'call replaces polling; re-call it while it returns timedOut: true. Fallback: poll ' +
      'amicus_status with the runId. Artifacts land in runDir (verdict.json, report.html).',
  });
  // Born-fenced (spec §8): council MCP tool text is wrapped like amicus_read.
  return textResult(fenceSidecarOutput(body));
}

// The council-awareness helpers live in their own module; re-exported here so
// mcp-server and cli-handlers-abort keep requiring one council MCP entry point.
const awareness = require('./mcp-council-awareness');

module.exports = {
  handleCouncilRunTool,
  buildCouncilStatusPayload: awareness.buildCouncilStatusPayload,
  listCouncilRuns: awareness.listCouncilRuns,
  abortCouncilRun: awareness.abortCouncilRun,
};
