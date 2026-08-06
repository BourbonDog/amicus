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
const { handleFanout } = require('./cli-handlers-fanout');

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
