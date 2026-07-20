// src/cli-handlers-council-run.js
'use strict';

/**
 * CLI `amicus council run` (v4.0 spec §4): flag validation, headless engine
 * invocation, document emission, exit codes. Lives in its own file because
 * cli-handlers-council.js is near the 300-line gate; dispatched from
 * handleCouncil. Pre-flight failures go through the error envelope (exit 1)
 * BEFORE any spend.
 */

const path = require('path');
const { failJson, buildErrorDoc, ERROR_CODES } = require('./utils/error-doc');
const { validateTaskId } = require('./utils/validators');
const { GATEWAY_MODES } = require('./utils/model-descriptor');

const CHAIR_DEFAULT = 'deepseek';

function parseList(value) {
  return String(value).split(',').map(s => s.trim()).filter(Boolean);
}

/** Resolve bench models from --models XOR --council (mirrors handleFanout). */
function resolveBench(args, useJson) {
  const hasModels = typeof args.models === 'string' && args.models.trim();
  const hasCouncil = args.council !== undefined && args.council !== false;
  if (hasModels && hasCouncil) {
    return { fail: failJson(useJson, { code: ERROR_CODES.BAD_ARGS,
      message: 'Error: pass exactly one of --models / --council, not both' }) };
  }
  if (!hasModels && !hasCouncil) {
    return { fail: failJson(useJson, { code: ERROR_CODES.BAD_ARGS,
      message: 'Error: council run needs --models a,b,c or --council <preset> (at least 2 seats)' }) };
  }
  if (hasCouncil) {
    if (typeof args.council !== 'string' || !args.council.trim()) {
      return { fail: failJson(useJson, { code: ERROR_CODES.BAD_ARGS,
        message: 'Error: --council requires a council name (e.g. --council budget)' }) };
    }
    const { resolveCouncilMembers } = require('./utils/config');
    const { readCache } = require('./utils/model-catalog');
    const catalog = (readCache() || {}).models || [];
    const expanded = resolveCouncilMembers(args.council.trim(), catalog);
    if (expanded.error) {
      return { fail: failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: `Error: ${expanded.error}` }) };
    }
    if (expanded.dropped && expanded.dropped.length && !useJson) {
      process.stderr.write(`Notice: dropped unavailable council member(s): ${expanded.dropped.join(', ')}\n`);
    }
    return { bench: expanded.models };
  }
  return { bench: parseList(args.models) };
}

function renderRunHuman(run) {
  const lines = [
    `Council run ${run.runId}: ${run.status} (exit ${run.exitCode})`,
    `  bench: ${(run.bench || []).join(', ')}  chair: ${run.chair}`,
    `  dir:   ${run.options && run.options.outDir}`,
  ];
  if (run.usage && run.usage.cost && typeof run.usage.cost.amount === 'number') {
    lines.push(`  cost:  $${run.usage.cost.amount.toFixed(4)} (${run.usage.cost.source})`);
  }
  if (run.error) { lines.push(`  error: ${run.error.code}: ${run.error.message}`); }
  return lines.join('\n') + '\n';
}

/** @param {object} args parsed CLI args @returns {Promise<number>} exit code */
async function handleCouncilRun(args) {
  const useJson = !!args.json;

  // --prompt-file required; inline --prompt rejected (councils always have
  // real briefings — same rationale as MCP fanout's briefing-via-file).
  if (args.prompt !== undefined) {
    return failJson(useJson, { code: ERROR_CODES.BAD_ARGS,
      message: 'Error: council run takes --prompt-file only (no inline --prompt)',
      hint: 'write the briefing to a file and pass --prompt-file <path>' });
  }
  const { resolvePromptSource } = require('./utils/prompt-source');
  const promptRes = resolvePromptSource(args);
  if (promptRes.error) {
    return failJson(useJson, { code: ERROR_CODES.MISSING_PROMPT, message: promptRes.error });
  }

  const benchRes = resolveBench(args, useJson);
  if (benchRes.fail !== undefined) { return benchRes.fail; }
  const bench = benchRes.bench;
  if (bench.length < 2) {
    return failJson(useJson, { code: ERROR_CODES.BAD_ARGS,
      message: 'Error: a council needs at least 2 seats (fanout semantics)' });
  }

  const chair = (typeof args.chair === 'string' && args.chair.trim())
    ? args.chair.trim() : CHAIR_DEFAULT;
  if (bench.includes(chair)) {
    return failJson(useJson, { code: ERROR_CODES.BAD_ARGS,
      message: `Error: chair '${chair}' is a bench seat — the chair must not review`,
      hint: `pick a chair outside --models (default: ${CHAIR_DEFAULT}), or remove '${chair}' from the bench` });
  }
  const critic = (typeof args.critic === 'string' && args.critic.trim()) ? args.critic.trim() : null;
  if (critic && !bench.includes(critic)) {
    return failJson(useJson, { code: ERROR_CODES.BAD_ARGS,
      message: `Error: critic '${critic}' must be one of the bench seats`,
      hint: `--critic swaps one seat's brief; pass one of: ${bench.join(', ')}` });
  }
  const lenses = (typeof args.lenses === 'string' && args.lenses.trim()) ? parseList(args.lenses) : null;
  if (critic && lenses) {
    return failJson(useJson, { code: ERROR_CODES.BAD_ARGS,
      message: 'Error: --critic and --lenses are mutually exclusive in v4.0' });
  }
  if (lenses && lenses.length !== bench.length) {
    return failJson(useJson, { code: ERROR_CODES.BAD_ARGS,
      message: `Error: --lenses needs exactly one lens per seat (${bench.length} seats, got ${lenses.length})` });
  }
  if (args.timeout !== undefined && args.timeout <= 0) {
    return failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: 'Error: --timeout must be a positive number' });
  }
  const mc = args['max-cost'];
  if (mc !== undefined && (typeof mc !== 'number' || !Number.isFinite(mc) || mc <= 0)) {
    return failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: 'Error: --max-cost must be a positive number' });
  }
  if (args.gateway !== undefined && !GATEWAY_MODES.includes(args.gateway)) {
    return failJson(useJson, { code: ERROR_CODES.BAD_ARGS,
      message: `Error: --gateway must be one of: ${GATEWAY_MODES.join(', ')}` });
  }
  let runId;
  if (args['run-id']) {
    const check = validateTaskId(String(args['run-id']));
    if (!check.valid) {
      return failJson(useJson, { code: ERROR_CODES.BAD_SESSION, message: check.error });
    }
    runId = String(args['run-id']);
  } else {
    runId = require('./sidecar/start').generateTaskId();
  }

  const project = args.cwd || process.cwd();
  const runDir = args['out-dir']
    ? path.resolve(project, String(args['out-dir']))
    : path.resolve(project, `council-${runId}`);

  const { resolveGatewayMode } = require('./utils/config');
  const { runCouncil } = require('./council/run');
  const { exitCode, run } = await runCouncil({
    briefing: promptRes.prompt, models: bench, chair, critic, lenses,
    project, runId, runDir,
    timeout: args.timeout, maxCost: mc !== undefined ? mc : null,
    gateway: resolveGatewayMode(args.gateway),
    noValidateModel: !!args['no-validate-model'],
    date: new Date().toISOString().slice(0, 10),
  });

  if (useJson) {
    // Spec §4: exit-1 rows fail through the error envelope; 0/2 emit the manifest.
    if (exitCode === 1 && run && run.error) {
      process.stdout.write(JSON.stringify(buildErrorDoc({
        code: run.error.code, message: run.error.message, command: 'council run',
      }), null, 2) + '\n');
    } else {
      process.stdout.write(JSON.stringify(run, null, 2) + '\n');
    }
  } else {
    process.stdout.write(renderRunHuman(run));
  }
  return exitCode;
}

module.exports = { handleCouncilRun, CHAIR_DEFAULT };
