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

/**
 * Sanitize the internal `--council-name` passthrough before it can reach the
 * spend ledger's `councilName` column (v4.3 Task 4 review fix, spec §7.3:
 * spend docs hold only ids/numbers/paths "by construction"). That value is
 * user-supplied (via mcp-council-run.js, ultimately an MCP caller's `input`),
 * unbounded, and unvalidated — unlike a real `--council <preset>`, which is
 * catalog-validated upstream. Strips control/non-printable characters, trims,
 * and caps length so a hostile/malformed passthrough can't land raw in a
 * `--group-by council` rollup. Precedence is untouched by this: it's applied
 * only to the passthrough branch, never to the catalog-validated preset name.
 * @param {string} name @returns {string|null} sanitized name, or null if empty after cleanup
 */
function sanitizeCouncilName(name) {
  // eslint-disable-next-line no-control-regex -- deliberately stripping C0/DEL control chars
  const cleaned = String(name).replace(/[\x00-\x1F\x7F]/g, '').trim().slice(0, 64);
  return cleaned || null;
}

/**
 * Resolve bench models from --models XOR --council (mirrors handleFanout).
 * Also returns `presetName` (v4.3 Task 3, spec §7.1): the trimmed --council
 * name when that branch was taken, else null — threaded into runCouncil's
 * `councilName` option so council ledger rows can be attributed to a preset.
 */
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
    const presetName = args.council.trim();
    const expanded = resolveCouncilMembers(presetName, catalog);
    if (expanded.error) {
      return { fail: failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: `Error: ${expanded.error}` }) };
    }
    if (expanded.dropped && expanded.dropped.length && !useJson) {
      process.stderr.write(`Notice: dropped unavailable council member(s): ${expanded.dropped.join(', ')}\n`);
    }
    return { bench: expanded.models, presetName };
  }
  return { bench: parseList(args.models), presetName: null };
}

function renderRunHuman(run) {
  const lines = [
    `Council run ${run.runId}: ${run.status} (exit ${run.exitCode})`,
    `  bench: ${(run.bench || []).join(', ')}  chair: ${run.chair}`,
    `  dir:   ${run.options && run.options.outDir}`,
  ];
  // v4.4: a cost line that omits unpriced legs reads as the whole bill. The
  // diagnosis measured council-wsgate02 printing $0.3720 for a run that really
  // spent $0.9859. Say what we know, then say what we cannot know — and print
  // the line even when NOTHING resolved (the old `typeof amount === 'number'`
  // guard silently dropped it, so a fully unpriced run looked free).
  const u = run.usage || null;
  const unknownLegs = u && typeof u.unknownLegs === 'number'
    ? u.unknownLegs
    : (u && u.cost && u.cost.unpricedLegs) || 0;
  // v4.4 Task 2: a fully-priced run can still be short. `council-wsgate01`
  // printed an unqualified $0.2821 for a run that really spent $0.3036 — every
  // leg `reported`, and 100% of the gap one unattributed `explore` child session.
  const subtreeLegs = u && typeof u.subtreeUnknownLegs === 'number'
    ? u.subtreeUnknownLegs
    : (u && u.cost && u.cost.subtreeUnknownLegs) || 0;
  if (u && u.cost && (typeof u.cost.amount === 'number' || unknownLegs > 0 || subtreeLegs > 0)) {
    const known = typeof u.cost.amount === 'number' ? `$${u.cost.amount.toFixed(4)}` : '$0.0000';
    const gaps = [];
    if (unknownLegs > 0) { gaps.push(`${unknownLegs} leg(s) unknown`); }
    if (subtreeLegs > 0) { gaps.push(`${subtreeLegs} leg(s) with unattributed subagent child-session spend`); }
    const tail = gaps.length > 0
      ? ` + ${gaps.join(' + ')} — real spend is at least this much`
      : '';
    lines.push(`  cost:  ${known} (${u.cost.source})${tail}`);
  }
  if (run.error) { lines.push(`  error: ${run.error.code}: ${run.error.message}`); }
  return lines.join('\n') + '\n';
}

/** @param {object} args parsed CLI args @returns {Promise<number>} exit code */
async function handleCouncilRun(args) {
  const useJson = !!args.json;

  // v4.5 Task 12 (B7/F5): resolve --pack FIRST, above the Task-5 template
  // block, so a pack-filled args.template renders through that single
  // existing application point exactly like a typed --template.
  let packRecord = null;
  const explicitKeys = args.__explicit || new Set();
  if (args.pack !== undefined) {
    const { applyPackToArgs } = require('./pack/pack-resolve');
    const pr = applyPackToArgs({
      packRef: args.pack, expectedKind: 'council', args,
      explicit: explicitKeys, useJson,
    });
    if (pr.error) { return failJson(useJson, pr.error); }
    for (const n of pr.notices) { process.stderr.write(n + '\n'); }
    packRecord = pr.packRecord;
  }
  // 2026-07-28 ruling (Task-11 review): attribute a pre-flight failure to the
  // pack that supplied the failing value — ONLY when the pack filled it (an
  // explicit flag always wins and is never "blamed" on the pack).
  const packSuffix = (key) => (packRecord && args[key] !== undefined && !explicitKeys.has(key))
    ? ` (set by pack '${packRecord.name}')` : '';

  // --prompt-file required; inline --prompt rejected (councils always have
  // real briefings — same rationale as MCP fanout's briefing-via-file).
  if (args.prompt !== undefined) {
    return failJson(useJson, { code: ERROR_CODES.BAD_ARGS,
      message: 'Error: council run takes --prompt-file only (no inline --prompt)',
      hint: 'write the briefing to a file and pass --prompt-file <path>' });
  }
  const { resolvePromptSource } = require('./utils/prompt-source');
  // F9 (v4.5): with --template and no {{prompt}} slot, --prompt-file may be
  // absent (mirrors handleFanout's guard); byte-identical without --template.
  let promptRes;
  if (args.prompt !== undefined || args['prompt-file'] !== undefined || args.template === undefined) {
    promptRes = resolvePromptSource(args);
    if (promptRes.error) { return failJson(useJson, { code: ERROR_CODES.MISSING_PROMPT, message: promptRes.error }); }
  } else {
    promptRes = { prompt: undefined, promptMeta: null };
  }
  let templateMeta = null;
  if (args.template !== undefined) {
    const { applyTemplate } = require('./template/apply');
    const t = applyTemplate({ templateRef: args.template, prompt: promptRes.prompt,
      artifactFile: args.artifact, varList: args.var, project: args.cwd || process.cwd() });
    if (t.error) { return failJson(useJson, t.error); }
    for (const n of t.notices) { process.stderr.write(n + '\n'); }
    promptRes = { prompt: t.prompt, promptMeta: t.promptMeta };
    templateMeta = t.promptMeta.template;
  } else if (args.artifact !== undefined || args.var !== undefined) {
    return failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: 'Error: --artifact/--var require --template (expansion happens only in template files)' });
  }

  const benchRes = resolveBench(args, useJson);
  if (benchRes.fail !== undefined) { return benchRes.fail; }
  const bench = benchRes.bench;
  // v4.3 Task 3 (spec §7.1): the preset name, when this run came from a real
  // --council <preset>. `--council-name` is an internal, undocumented passthrough
  // set by mcp-council-run.js — the MCP handler always expands a preset to
  // `--models` before spawning (so `--council`/`--models` stay mutually exclusive
  // on this CLI surface), which would otherwise strand the preset name with no
  // way to reach this process. Never fabricated: --models with neither flag
  // stays null, matching spec §7.1 ("preset name … else null"). The
  // passthrough branch is sanitized (see sanitizeCouncilName docblock) — the
  // preset-name branch is catalog-validated upstream and never touched here,
  // so precedence (a real --council preset always outranks the passthrough)
  // is unchanged.
  const councilName = benchRes.presetName
    || (typeof args['council-name'] === 'string' ? sanitizeCouncilName(args['council-name']) : null);
  if (bench.length < 2) {
    return failJson(useJson, { code: ERROR_CODES.BAD_ARGS,
      message: 'Error: a council needs at least 2 seats (fanout semantics)' });
  }

  const chair = (typeof args.chair === 'string' && args.chair.trim())
    ? args.chair.trim() : CHAIR_DEFAULT;
  if (bench.includes(chair)) {
    return failJson(useJson, { code: ERROR_CODES.BAD_ARGS,
      message: `Error: chair '${chair}' is a bench seat — the chair must not review${packSuffix('chair')}`,
      hint: `pick a chair outside --models (default: ${CHAIR_DEFAULT}), or remove '${chair}' from the bench` });
  }
  const critic = (typeof args.critic === 'string' && args.critic.trim()) ? args.critic.trim() : null;
  if (critic && !bench.includes(critic)) {
    return failJson(useJson, { code: ERROR_CODES.BAD_ARGS,
      message: `Error: critic '${critic}' must be one of the bench seats${packSuffix('critic')}`,
      hint: `--critic swaps one seat's brief; pass one of: ${bench.join(', ')}` });
  }
  const lenses = (typeof args.lenses === 'string' && args.lenses.trim()) ? parseList(args.lenses) : null;
  if (critic && lenses) {
    return failJson(useJson, { code: ERROR_CODES.BAD_ARGS,
      message: `Error: --critic and --lenses are mutually exclusive in v4.0${packSuffix('critic') || packSuffix('lenses')}` });
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

  const { resolveGatewayMode, loadConfig } = require('./utils/config');
  const { resolveFallbackConfig } = require('./sidecar/fallback-chains');
  const { readCache } = require('./utils/model-catalog');
  const { runCouncil } = require('./council/run');
  const cfg = loadConfig() || {};
  const { exitCode, run } = await runCouncil({
    briefing: promptRes.prompt, models: bench, chair, critic, lenses,
    project, runId, runDir,
    timeout: args.timeout, maxCost: mc !== undefined ? mc : null,
    gateway: resolveGatewayMode(args.gateway),
    noValidateModel: !!args['no-validate-model'],
    date: new Date().toISOString().slice(0, 10),
    councilName,
    template: templateMeta, // F9 (v4.5): null when no --template; additive on the run.json seed (run-state.js).
    pack: packRecord, // v4.5 Task 12 (B7/F5): null when no --pack; additive on the run.json seed (run-state.js).
    // v4.1 §4.5b/§4.5d. `--claude-review` is resolved here but VALIDATED by the
    // engine's preflightClaudeReview (run-assemble.js): the reserved-seat and
    // 'claude may not chair' guards live there on purpose so MCP, the GitHub
    // Action and direct `require('./council/run')` callers hit the same rule and
    // the same COUNCIL_CLAUDE_REVIEW_INVALID code. Re-checking them here would
    // give the identical mistake two different error codes by entry point.
    debate: !!args.debate,
    claudeReviewFile: args['claude-review'] ? path.resolve(args['claude-review']) : null,
    noCostGate: !!args['no-cost-gate'],
    // v4.3 Task 13: --follow's json-vs-human mode mirrors the same --json this
    // handler already resolved for the final run doc, so `--json --follow`
    // NDJSON on stderr and the `--json` final doc on stdout agree.
    follow: !!args.follow,
    json: useJson,
    onComplete: args['on-complete'],
    // v4.3 Task 18 (spec §6.2): opt-in cheaper-model substitution for STAGE
    // legs only (run-stages.js threads it through; the chair is excluded —
    // see run-chair.js). --fallback forces on, --no-fallback forces off;
    // unset defers to config `fallbacks.enabled`.
    fallback: resolveFallbackConfig({
      flagFallback: args.fallback === true ? true : (args['no-fallback'] ? false : undefined),
      config: cfg,
    }),
    catalog: (readCache() || {}).models || [],
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

module.exports = { handleCouncilRun, renderRunHuman, CHAIR_DEFAULT };
