/**
 * CLI handler for the fanout command (multi-model parallel runs).
 *
 * Extracted verbatim from cli-handlers-run.js (v4.7 PR0) to keep that file
 * under the 300-line gate before F8 adds --tag forwarding. Whole-handler
 * split precedent: cli-handlers-resume-continue.js.
 */

'use strict';

const { validateTaskId, validateTag } = require('./utils/validators');
const { failJson, ERROR_CODES } = require('./utils/error-doc');
const { GATEWAY_MODES } = require('./utils/model-descriptor');
const { applyTemplateForArgs } = require('./cli-template-args');

/**
 * Handle 'amicus fanout' command (F4).
 * Returns the wave exit code: 0 all complete, 2 partial, 1 none/hard failure,
 * 130/143 when the wave was signal-aborted.
 */
async function handleFanout(args) {
  const useJson = !!args.json;

  // v4.7 F8 (D13): a retried wave replays each leg's own saved context
  // byte-identical — there is no fresh session to attach a new --tag to, so
  // reject the combination before the retry-failed dispatch below.
  if (args.tag !== undefined && args['retry-failed']) {
    process.exit(failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: 'Error: --tag cannot be combined with --retry-failed' }));
  }

  // --retry-failed <waveId> (v4.3 Task 19, spec 6.1): a completely different
  // path from the --prompt/--models launch below (no briefing, no required
  // --models — the original wave's failed legs supply their own saved
  // context) — dispatch BEFORE any of that validation runs. --models here is
  // optional and, when present, filters which failed legs get retried.
  // --pack is likewise ignored on this path (deliberate, same precedent: retry
  // replays the wave's recorded per-leg config; flags that reshape a wave don't apply).
  if (args['retry-failed']) {
    const { retryFailedWave } = require('./sidecar/fanout-retry');
    const { parseModelsList } = require('./sidecar/fanout-validate');
    const { exitCode, errorDoc } = await retryFailedWave(String(args['retry-failed']), args.cwd || process.cwd(), {
      models: parseModelsList(args.models), json: useJson,
    });
    if (errorDoc && useJson) { process.stdout.write(JSON.stringify(errorDoc) + '\n'); }
    return exitCode;
  }
  const packRecord = require('./pack/pack-cli').applyPackOrExit(args, 'fanout', useJson);

  // FIX 4 (#61 whole-branch review, cheap parity): handleStart validates
  // --gateway via validateStartArgs (cli.js) — fanout never did, so a typo'd
  // value silently fell through to resolveGatewayMode's pass-through instead
  // of failing fast with a clear error.
  if (args.gateway !== undefined && !GATEWAY_MODES.includes(args.gateway)) {
    process.exit(failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: `Error: --gateway must be one of: ${GATEWAY_MODES.join(', ')}` }));
  }

  const { resolvePromptSource } = require('./utils/prompt-source');
  let promptRes;
  if (args.prompt !== undefined || args['prompt-file'] !== undefined || args.template === undefined) {
    promptRes = resolvePromptSource(args);
    if (promptRes.error) { process.exit(failJson(useJson, { code: ERROR_CODES.MISSING_PROMPT, message: promptRes.error })); }
  } else {
    promptRes = { prompt: undefined, promptMeta: null };
  }
  const tpl = applyTemplateForArgs(args, promptRes.prompt, useJson);
  if (tpl.fail !== undefined) { process.exit(tpl.fail); }
  if (tpl.applied) { promptRes = { prompt: tpl.prompt, promptMeta: tpl.promptMeta }; }
  // Council preset: expand a saved council into args.models (mutually exclusive with --models).
  const hasModels = typeof args.models === 'string' && args.models.trim();
  const hasCouncil = args.council !== undefined && args.council !== false;
  if (hasModels && hasCouncil) {
    process.exit(failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: 'Error: pass exactly one of --models / --council, not both' }));
  }
  if (!hasModels && !hasCouncil) {
    process.exit(failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: 'Error: --models is required (comma-separated aliases or provider/model IDs), or use --council <name>' }));
  }
  if (hasCouncil) {
    if (typeof args.council !== 'string' || !args.council.trim()) {
      process.exit(failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: 'Error: --council requires a council name (e.g. --council free)' }));
    }
    const { resolveCouncilMembers } = require('./utils/config');
    const { readCache } = require('./utils/model-catalog');
    const catalog = (readCache() || {}).models || [];
    const expanded = resolveCouncilMembers(args.council.trim(), catalog);
    if (expanded.error) {
      process.exit(failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: `Error: ${expanded.error}` }));
    }
    if (expanded.dropped && expanded.dropped.length && !useJson) {
      process.stderr.write(`Notice: dropped unavailable council member(s): ${expanded.dropped.join(', ')}\n`);
    }
    args.models = expanded.models.join(',');
  }
  if (args['wave-id']) {
    const check = validateTaskId(String(args['wave-id']));
    if (!check.valid) {
      process.exit(failJson(useJson, { code: ERROR_CODES.BAD_SESSION, message: check.error }));
    }
  }
  if (args.agent && String(args.agent).toLowerCase() === 'chat') {
    process.exit(failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: 'Error: --agent chat is interactive-only; fanout is headless' }));
  }
  if (args.timeout !== undefined && args.timeout <= 0) {
    process.exit(failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: 'Error: --timeout must be a positive number' }));
  }
  const mc = args['max-cost'];
  if (mc !== undefined && (typeof mc !== 'number' || !Number.isFinite(mc) || mc <= 0)) {
    process.exit(failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: 'Error: --max-cost must be a positive number' }));
  }
  // v4.7 F8 (D13): reject-style (unlike sanitizeCouncilName, which cleans) —
  // a stored tag is a user-chosen search key, so silent truncation/stripping
  // would make --search/--group-by tag miss it.
  if (args.tag !== undefined) {
    const tagCheck = validateTag(args.tag);
    if (!tagCheck.ok) {
      process.exit(failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: tagCheck.error }));
    }
  }
  const { parseModelsList } = require('./sidecar/fanout');
  if (parseModelsList(args.models).length === 0) {
    process.exit(failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: 'Error: --models must contain at least one non-empty entry' }));
  }

  // Direct require (fanout stays internal — no src/index.js public re-export).
  const { runFanout } = require('./sidecar/fanout');
  const { loadConfig, resolveGatewayMode } = require('./utils/config');
  const { resolveFallbackConfig } = require('./sidecar/fallback-chains');
  const { readCache } = require('./utils/model-catalog');
  const cfg = loadConfig() || {};
  const { exitCode } = await runFanout({
    models: args.models,
    prompt: promptRes.prompt,
    promptMeta: promptRes.promptMeta,
    waveId: args['wave-id'],
    project: args.cwd || process.cwd(),
    agent: args.agent || args.mode,
    thinking: args.thinking,
    timeout: args.timeout,
    summaryLength: args['summary-length'],
    includeContext: !args['no-context'],
    sessionId: args['session-id'],
    contextTurns: args['context-turns'],
    contextSince: args['context-since'],
    contextMaxTokens: args['context-max-tokens'],
    // #10: forward the Cowork parent so MCP-spawned fanout legs pin the right
    // session (mirrors handleStart's coworkProcess plumbing). Without this the
    // spawned `--cowork-process` flag is dropped and buildContext gets null.
    coworkProcess: args['cowork-process'],
    mcp: args.mcp,
    mcpConfig: args['mcp-config'],
    noMcp: args['no-mcp'],
    excludeMcp: args['exclude-mcp'],
    noValidateModel: args['no-validate-model'],
    // #61 Task 7.3: --gateway merged with routing.prefer, applied per leg
    // by validateFanoutModels' router call.
    gatewayMode: resolveGatewayMode(args.gateway),
    json: !!args.json,
    // v4.7 PR3 rider: `quiet` is a repo-wide known flag, so `fanout --quiet`
    // parsed and exited 0 while runFanout still printed — forward it.
    quiet: !!args.quiet,
    client: args.client,
    maxCost: args['max-cost'] !== null && args['max-cost'] !== undefined ? args['max-cost'] : cfg.maxCost,
    noCostGate: !!args['no-cost-gate'],
    maxCostPerMtok: cfg.maxCostPerMtok,
    follow: !!args.follow,
    onComplete: args['on-complete'],
    // v4.3 Task 18 (spec §6.2): opt-in cheaper-model substitution. --fallback
    // forces on, --no-fallback forces off; unset defers to config `fallbacks.enabled`.
    fallback: resolveFallbackConfig({
      flagFallback: args.fallback === true ? true : (args['no-fallback'] ? false : undefined),
      config: cfg,
    }),
    catalog: (readCache() || {}).models || [],
    pack: packRecord, // v4.5 Task 13: null when no --pack; additive on wave metadata.json + wave.json.
    tag: args.tag, // v4.7 F8: undefined when no --tag; Task 3 stores it on wave metadata.
  });
  return exitCode;
}

module.exports = { handleFanout };
