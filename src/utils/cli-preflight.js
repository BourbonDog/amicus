'use strict';

/**
 * @module cli-preflight
 * Tiny shared preflight guards used by more than one CLI run handler
 * (start/resume/continue/fanout), split out so each handler file can stay
 * under the size gate without duplicating the same few lines.
 */

const { failJson, ERROR_CODES } = require('./error-doc');
const { validateTaskId } = require('./validators');

/** Shared --json requires --no-ui gate. Exits (never returns) on violation. */
function requireNoUiForJson(args, useJson) {
  if (args.json && !args['no-ui']) {
    process.exit(failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: 'Error: --json requires --no-ui' }));
  }
}

/**
 * Shared task-id presence + format check. Exits (never returns) on violation.
 * @param {object} args - parsed CLI args (positional task id at args._[1])
 * @param {boolean} useJson
 * @param {string} commandLabel - e.g. 'resume', 'continue'
 * @param {string} [usage] - appended to the missing-id message
 * @returns {string} the validated task id
 */
function requireValidTaskId(args, useJson, commandLabel, usage) {
  const taskId = args._[1];
  if (!taskId) {
    process.exit(failJson(useJson, {
      code: ERROR_CODES.BAD_SESSION,
      message: `Error: task_id is required for ${commandLabel}${usage ? `\n${usage}` : ''}`,
    }));
  }
  const check = validateTaskId(taskId);
  if (!check.valid) {
    process.exit(failJson(useJson, { code: ERROR_CODES.BAD_SESSION, message: check.error }));
  }
  return taskId;
}

module.exports = { requireNoUiForJson, requireValidTaskId };
