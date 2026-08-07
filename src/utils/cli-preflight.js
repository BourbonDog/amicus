/**
 * @module cli-preflight
 * Tiny shared preflight guards used by more than one CLI run handler
 * (start/resume/continue/fanout), split out so each handler file can stay
 * under the size gate without duplicating the same few lines.
 */

'use strict';

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

/**
 * `pack save --version <semver>` can never work, and used to fail SILENTLY:
 * `version` is a global BOOLEAN_FLAG (src/cli.js), so parseArgs sets
 * `args.version = true` and drops the semver into positionals, then
 * bin/amicus.js prints the version banner BEFORE command dispatch — so
 * `handlePack` never runs and no pack is written, at exit 0. `--version=2.0.0`
 * fails identically (the inline value is discarded at the isBooleanFlag branch,
 * ahead of the --key=value branch). The pack's own version is `--pack-version`.
 *
 * Returns the failure rather than exiting, so bin/amicus.js keeps one exit site
 * and this stays unit-testable (bin/amicus.js is a script, not a module).
 *
 * @param {object} args - parsed CLI args
 * @returns {{code: string, message: string, hint: string}|null} null when there is no conflict
 */
function packSaveVersionConflict(args) {
  if (!args || !args.version) { return null; }
  const argv = Array.isArray(args._) ? args._ : [];
  if (argv[0] !== 'pack' || argv[1] !== 'save') { return null; }
  return {
    code: ERROR_CODES.BAD_ARGS,
    message: "Error: --version is amicus's own global flag, not the saved pack's version",
    hint: 'Use --pack-version <semver> to set the version of the pack being saved.',
  };
}

module.exports = { requireNoUiForJson, requireValidTaskId, packSaveVersionConflict };
