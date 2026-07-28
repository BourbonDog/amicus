/**
 * CLI Run Handlers (WS-2 extraction)
 *
 * Extracted from bin/amicus.js to keep the CLI entry point under the 300-line
 * size gate and to make handlers unit-testable without running main().
 *
 * Contains: handleStart, handleFanout, handleRead
 * See also: src/cli-handlers-resume-continue.js (handleResume, handleContinue —
 * split out to stay under the size gate) and src/cli-handlers.js (handleList
 * remains inline in bin/amicus.js).
 */

'use strict';

const { validateStartArgs } = require('./cli');
const { validateTaskId } = require('./utils/validators');
const { resolveLaunchModel, maybeOfferProviderDefaults } = require('./utils/start-helpers');
const { failJson, ERROR_CODES } = require('./utils/error-doc');
const { requireNoUiForJson } = require('./utils/cli-preflight');
const { GATEWAY_MODES } = require('./utils/model-descriptor');

/**
 * Handle 'sidecar start' command
 * Spec Reference: §4.1
 */
async function handleStart(args) {
  const useJson = !!args.json;
  const packRecord = require('./pack/pack-cli').applyPackOrExit(args, 'solo', useJson);
  // F4: --prompt-file support (XOR --prompt) and --json gating
  // F9 (v4.5): --template renders {{prompt}}/{{artifact}}/{{var.*}} into the prompt; byte-identical without it.
  let templateMeta = null;
  if (args.prompt !== undefined || args['prompt-file'] !== undefined) {
    const { resolvePromptSource } = require('./utils/prompt-source');
    const promptRes = resolvePromptSource(args);
    if (promptRes.error) { process.exit(failJson(useJson, { code: ERROR_CODES.MISSING_PROMPT, message: promptRes.error })); }
    args.prompt = promptRes.prompt;
    // Drop --prompt-file post-resolve or validateStartArgs re-trips its XOR guard.
    delete args['prompt-file'];
  }
  if (args.template !== undefined) {
    const { applyTemplate } = require('./template/apply');
    const t = applyTemplate({ templateRef: args.template, prompt: args.prompt,
      artifactFile: args.artifact, varList: args.var, project: args.cwd || process.cwd() });
    if (t.error) { process.exit(failJson(useJson, t.error)); }
    for (const n of t.notices) { process.stderr.write(n + '\n'); }
    args.prompt = t.prompt;
    templateMeta = t.promptMeta.template;
  } else if (args.artifact !== undefined || args.var !== undefined) {
    process.exit(failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: 'Error: --artifact/--var require --template (expansion happens only in template files)' }));
  }
  requireNoUiForJson(args, useJson);

  const mc = args['max-cost'];
  if (mc !== undefined && (typeof mc !== 'number' || !Number.isFinite(mc) || mc <= 0)) {
    process.exit(failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: 'Error: --max-cost must be a positive number' }));
  }

  const { model, alias } = await resolveLaunchModel(args);
  args.model = model;

  // Normalize agent: --agent takes precedence, otherwise use --mode
  args.agent = args.agent || args.mode;

  const validation = validateStartArgs(args);
  if (!validation.valid) {
    process.exit(failJson(useJson, { code: validation.code || ERROR_CODES.BAD_ARGS, message: validation.error }));
  }

  // Existing-user one-time onboarding offer (Part 2, Task 9): a non-blocking
  // notice, printed at most once ever, pointing users who already have direct
  // provider keys at the per-provider cost-aware default picker. No-ops on
  // any non-interactive/--json run (see maybeOfferProviderDefaults). Fired
  // only after validateStartArgs succeeds so a failed first `amicus start`
  // doesn't burn the one-time flag.
  maybeOfferProviderDefaults(args);

  // Budget gate for solo start
  if (!args['no-cost-gate']) {
    const { lookupPricing } = require('./utils/pricing');
    const { checkBudget, formatBudgetError } = require('./sidecar/budget');
    const { loadConfig } = require('./utils/config');
    const cfg = loadConfig() || {};
    const soloLeg = { modelInput: alias || args.model, model: args.model, pricing: lookupPricing(args.model) };
    const promptChars = (args.prompt && String(args.prompt).length) || 0;
    const budget = checkBudget([soloLeg], { maxCostPerMtok: cfg.maxCostPerMtok, maxCost: args['max-cost'] !== null && args['max-cost'] !== undefined ? args['max-cost'] : cfg.maxCost, promptChars });
    if (!budget.ok) {
      process.exit(failJson(useJson, { code: ERROR_CODES.BUDGET_EXCEEDED, message: 'Error: budget gate refused the run', hint: formatBudgetError(budget) }));
    }
  }

  const { startAmicus } = require('./index');

  return await startAmicus({
    taskId: args['task-id'],
    model: args.model,
    prompt: args.prompt,
    sessionId: args['session-id'],
    cwd: args.cwd,
    contextTurns: args['context-turns'],
    contextSince: args['context-since'],
    contextMaxTokens: args['context-max-tokens'],
    noUi: args['no-ui'],
    timeout: args.timeout,
    agent: args.agent,
    mcp: args.mcp,
    mcpConfig: args['mcp-config'],
    thinking: args.thinking,
    summaryLength: args['summary-length'],
    client: args.client,
    sessionDir: args['session-dir'],
    foldShortcut: args['fold-shortcut'],
    opencodePort: args['opencode-port'],
    noMcp: args['no-mcp'],
    excludeMcp: args['exclude-mcp'],
    coworkProcess: args['cowork-process'],
    position: args.position,
    json: !!args.json,
    modelInput: alias || null,
    template: templateMeta, // F9 (v4.5): startSidecar ignores unknown keys; inert until a future task reads it.
    pack: packRecord, // v4.5 Task 13: null when no --pack; additively recorded on solo session metadata.
  });
}

/**
 * Handle 'amicus fanout' command (F4).
 * Returns the wave exit code: 0 all complete, 2 partial, 1 none/hard failure,
 * 130/143 when the wave was signal-aborted.
 */
async function handleFanout(args) {
  const useJson = !!args.json;

  // --retry-failed <waveId> (v4.3 Task 19, spec 6.1): a completely different
  // path from the --prompt/--models launch below (no briefing, no required
  // --models — the original wave's failed legs supply their own saved
  // context) — dispatch BEFORE any of that validation runs. --models here is
  // optional and, when present, filters which failed legs get retried.
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
  if (args.template !== undefined) {
    const { applyTemplate } = require('./template/apply');
    const t = applyTemplate({ templateRef: args.template, prompt: promptRes.prompt,
      artifactFile: args.artifact, varList: args.var, project: args.cwd || process.cwd() });
    if (t.error) { process.exit(failJson(useJson, t.error)); }
    for (const n of t.notices) { process.stderr.write(n + '\n'); }
    promptRes = { prompt: t.prompt, promptMeta: t.promptMeta };
  } else if (args.artifact !== undefined || args.var !== undefined) {
    process.exit(failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: 'Error: --artifact/--var require --template (expansion happens only in template files)' }));
  }
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
  });
  return exitCode;
}

/**
 * Handle 'sidecar read' command
 * Spec Reference: §4.5
 */
async function handleRead(args) {
  const useJson = !!args.json;
  const taskId = args._[1];

  if (!taskId) {
    process.exit(failJson(useJson, { code: ERROR_CODES.BAD_SESSION, message: 'Error: task_id is required for read' }));
  }

  const taskIdCheck = validateTaskId(taskId);
  if (!taskIdCheck.valid) {
    process.exit(failJson(useJson, { code: ERROR_CODES.BAD_SESSION, message: taskIdCheck.error }));
  }

  const { readAmicus } = require('./index');

  await readAmicus({
    taskId,
    conversation: args.conversation,
    metadata: args.metadata,
    json: args.json,
    project: args.cwd
  });
}

module.exports = { handleStart, handleFanout, handleRead };
