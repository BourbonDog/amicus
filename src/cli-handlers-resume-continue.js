/**
 * CLI Resume/Continue Handlers (B21-rest extraction)
 *
 * Split out of src/cli-handlers-run.js (which stayed over the 300-line size
 * gate once --json plumbing landed here) — same extraction rationale as the
 * original WS-2 split of bin/amicus.js.
 *
 * Contains: handleResume, handleContinue
 */

'use strict';

const { resolveLaunchModel } = require('./utils/start-helpers');
const { failJson, ERROR_CODES } = require('./utils/error-doc');
const { requireNoUiForJson, requireValidTaskId } = require('./utils/cli-preflight');

/**
 * Handle 'amicus resume' command
 * Spec Reference: §4.3
 */
async function handleResume(args) {
  const useJson = !!args.json;
  const taskId = requireValidTaskId(args, useJson, 'resume', 'Usage: amicus resume <task_id>');
  requireNoUiForJson(args, useJson);

  const { resumeAmicus } = require('./index');

  try {
    return await resumeAmicus({
      taskId,
      project: args.cwd,
      headless: args['no-ui'],
      timeout: args.timeout,
      json: useJson,
    });
  } catch (err) {
    // resumeSidecar throws a plain Error before it has a chance to consult
    // `json` (e.g. the session directory doesn't exist) — under --json that
    // must still land as ONE parseable envelope on stdout, not an uncaught
    // throw. Non-json mode is unaffected: re-throw so bin/amicus.js's
    // existing top-level catch prints `Error: <message>` exactly as before.
    if (!useJson) { throw err; }
    process.exit(failJson(true, { code: ERROR_CODES.BAD_SESSION, message: err.message }));
  }
}

/**
 * Handle 'amicus continue' command
 * Spec Reference: §4.4
 */
async function handleContinue(args) {
  const useJson = !!args.json;
  const taskId = requireValidTaskId(args, useJson, 'continue', 'Usage: amicus continue <task_id> --prompt "..."');

  // BL-1: accept --prompt-file (XOR --prompt) so the MCP handler can pass a long
  // follow-up prompt via file, dodging the ~32KB Windows command-line cap.
  if (args['prompt-file'] !== undefined) {
    const { resolvePromptSource } = require('./utils/prompt-source');
    const promptRes = resolvePromptSource(args);
    if (promptRes.error) {
      process.exit(failJson(useJson, { code: ERROR_CODES.MISSING_PROMPT, message: promptRes.error }));
    }
    args.prompt = promptRes.prompt;
    delete args['prompt-file'];
  }

  if (!args.prompt && !args.briefing) {
    process.exit(failJson(useJson, { code: ERROR_CODES.MISSING_PROMPT, message: 'Error: --prompt is required for continue' }));
  }

  requireNoUiForJson(args, useJson);

  // F5/#61 Task 7.3: an explicitly passed --model routes through the gateway
  // router exactly like start (resolveLaunchModel), so --gateway / direct-first
  // policy / structured route errors apply here too. The NO-`--model` case
  // (inherit the prior session's model) is unchanged below — that IS the
  // "preserve prior route" behavior: the prior concrete id is reused verbatim,
  // never re-resolved.
  // #61 Task 5.2 (best-effort provenance): stash the freshly-resolved
  // gateway/resolutionVersion so the NEW session's metadata can record them.
  // These stay undefined on the inherit-prior-model path (no fresh routing
  // happened there), so the metadata writer simply omits them — the prior
  // concrete model id being reused verbatim already prevents a silent gateway
  // change for a continued session without a fresh --model.
  let routeGateway;
  let routeResolutionVersion;
  if (args.model !== undefined) {
    const { model, gateway, provenance } = await resolveLaunchModel(args);
    args.model = model;
    routeGateway = gateway;
    routeResolutionVersion = provenance && provenance.resolutionVersion;
  }

  const { continueAmicus } = require('./index');

  try {
    return await continueAmicus({
      taskId,
      newTaskId: args['task-id'],
      briefing: args.prompt || args.briefing,
      model: args.model,
      project: args.cwd,
      contextTurns: args['context-turns'],
      contextMaxTokens: args['context-max-tokens'],
      headless: args['no-ui'],
      timeout: args.timeout,
      json: useJson,
      gateway: routeGateway,
      resolutionVersion: routeResolutionVersion,
    });
  } catch (err) {
    // Same rationale as handleResume above: continueSidecar/loadPreviousSession
    // throws before consulting `json` when the PREVIOUS session doesn't exist.
    if (!useJson) { throw err; }
    process.exit(failJson(true, { code: ERROR_CODES.BAD_SESSION, message: err.message }));
  }
}

module.exports = { handleResume, handleContinue };
