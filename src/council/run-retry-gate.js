/**
 * @module council/run-retry-gate
 * The once-only Stage-1 retry's death-class gate (D-06): an OUTPUT_LENGTH death is held, never relaunched.
 *
 * An OUTPUT_LENGTH death (`utils/output-length.js :: isOutputLengthDeath`) is a leg whose
 * provider stopped at the max_tokens reservation before any answer text. Its retry would run on
 * the run's one engine (`run-server.js :: acquireRunServer`), whose output budget was read once at
 * spawn (`opencode-client.js :: startServer`), so the relaunch reserves the same budget again.
 * The lever for this death is `outputBudget`, ONE top-level key in config.json
 * (`utils/config.js :: getOutputBudget`; amicus has no per-alias budget), and the leg's own reason
 * already names the value in force and the fix.
 *
 * MEASURED before the ruling, across every CI council run since 4.9.4: two first attempts died
 * OUTPUT_LENGTH, both were retried at the same budget, and neither retry delivered a review. Run
 * 34376584500's glm retry died OUTPUT_LENGTH again and billed $0.2224 a second time; run
 * 35514703539's deepseek retry stopped early, and its only "heal" was promoted reasoning.
 *
 * Keyed on the reason's PREFIX (`utils/output-length.js :: OUTPUT_LENGTH_PREFIX`, exported for
 * exactly this), never on `finish` or a token count: an error the engine itself put on the
 * message wins the leg's reason (`headless.js :: runHeadless`), and that leg is not the named
 * death. The one require is that module, whose closure holds src/utils modules only; nothing
 * under src/utils requires council/, so no cycle can form.
 */
'use strict';

const { OUTPUT_LENGTH_PREFIX } = require('../utils/output-length');

/**
 * Did this Stage-1 loss die OUTPUT_LENGTH? `run-retry-group.js :: groupStage1Losses` holds such a
 * leg out of every retry unit. Named mutant "PREFIXANYWHERE": `includes` for `startsWith`.
 * @param {?object} leg a Stage-1 leg document that produced no usable review
 * @returns {boolean}
 */
function isOutputLengthLoss(leg) {
  return !!leg && typeof leg.error === 'string' && leg.error.startsWith(OUTPUT_LENGTH_PREFIX);
}

/** The words a held leg's skipped-leg note ends with. */
const OUTPUT_LENGTH_SKIP_CLAUSE = '; its once-only retry was skipped: a relaunch reserves the same output budget';

/**
 * The closing clause for run-stages.js's skipped-leg `why`: the clause for a held OUTPUT_LENGTH
 * leg, and the EMPTY string for every other leg, so every other note stays byte-identical (the
 * `promoted.js :: reasoningOnlyClause` idiom). Named mutants "CLAUSEEVERYLEG" (return the clause
 * unconditionally) and "CLAUSEDROPPED" (run-stages.js stops appending it).
 * @param {?object} leg a Stage-1 leg document on the skipped path
 * @returns {string}
 */
function outputLengthSkipClause(leg) {
  return isOutputLengthLoss(leg) ? OUTPUT_LENGTH_SKIP_CLAUSE : '';
}

module.exports = { isOutputLengthLoss, outputLengthSkipClause, OUTPUT_LENGTH_SKIP_CLAUSE };
