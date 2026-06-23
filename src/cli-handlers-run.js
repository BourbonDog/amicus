/**
 * CLI Run Handlers (WS-2 extraction)
 *
 * Extracted from bin/amicus.js to keep the CLI entry point under the 300-line
 * size gate and to make handlers unit-testable without running main().
 *
 * Contains: handleStart, handleFanout, handleRead
 * Remaining inline in bin/amicus.js: handleList, handleResume, handleContinue
 */

'use strict';

const { validateStartArgs } = require('./cli');
const { validateTaskId } = require('./utils/validators');
const { resolveModelFromArgs, validateFallbackModel } = require('./utils/start-helpers');
const { failJson, ERROR_CODES } = require('./utils/error-doc');

/**
 * Handle 'sidecar start' command
 * Spec Reference: §4.1
 */
async function handleStart(args) {
  const useJson = !!args.json;

  // F4: --prompt-file support (XOR --prompt) and --json gating
  if (args.prompt !== undefined || args['prompt-file'] !== undefined) {
    const { resolvePromptSource } = require('./utils/prompt-source');
    const promptRes = resolvePromptSource(args);
    if (promptRes.error) { process.exit(failJson(useJson, { code: ERROR_CODES.MISSING_PROMPT, message: promptRes.error })); }
    args.prompt = promptRes.prompt;
  }
  if (args.json && !args['no-ui']) {
    process.exit(failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: 'Error: --json requires --no-ui' }));
  }

  const { model, alias } = resolveModelFromArgs(args);
  args.model = model;
  args.model = await validateFallbackModel(args, alias);

  // Normalize agent: --agent takes precedence, otherwise use --mode
  args.agent = args.agent || args.mode;

  const validation = validateStartArgs(args);
  if (!validation.valid) {
    process.exit(failJson(useJson, { code: validation.code || ERROR_CODES.BAD_ARGS, message: validation.error }));
  }

  const { startSidecar } = require('./index');

  return await startSidecar({
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
  });
}

/**
 * Handle 'amicus fanout' command (F4).
 * Returns the wave exit code: 0 all complete, 2 partial, 1 none/hard failure,
 * 130/143 when the wave was signal-aborted.
 */
async function handleFanout(args) {
  const useJson = !!args.json;

  const { resolvePromptSource } = require('./utils/prompt-source');
  const promptRes = resolvePromptSource(args);
  if (promptRes.error) {
    process.exit(failJson(useJson, { code: ERROR_CODES.MISSING_PROMPT, message: promptRes.error }));
  }
  if (typeof args.models !== 'string' || !args.models.trim()) {
    process.exit(failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: 'Error: --models is required (comma-separated aliases or provider/model IDs)' }));
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
  const { parseModelsList } = require('./sidecar/fanout');
  if (parseModelsList(args.models).length === 0) {
    process.exit(failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: 'Error: --models must contain at least one non-empty entry' }));
  }

  // Direct require — the src/index.js public re-export is added later (Task 13)
  const { runFanout } = require('./sidecar/fanout');
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
    mcp: args.mcp,
    mcpConfig: args['mcp-config'],
    noMcp: args['no-mcp'],
    excludeMcp: args['exclude-mcp'],
    noValidateModel: args['no-validate-model'],
    json: !!args.json,
    client: args.client,
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

  const { readSidecar } = require('./index');

  await readSidecar({
    taskId,
    conversation: args.conversation,
    metadata: args.metadata,
    json: args.json,
    project: args.cwd
  });
}

module.exports = { handleStart, handleFanout, handleRead };
