'use strict';

/**
 * @module cli-template-args
 * v4.7 PR6 sweep: the single application point for --template/--artifact/--var,
 * shared by the three CLI handlers (handleStart, handleFanout, handleCouncilRun)
 * that used to carry this block verbatim-triplicated.
 *
 * NEVER calls process.exit: handleStart and handleFanout exit on failure, but
 * handleCouncilRun RETURNS its exit code (its whole handler contract is
 * return-the-code) — so the decision belongs to the caller, not this helper.
 */

const { failJson, ERROR_CODES } = require('./utils/error-doc');

const NEEDS_TEMPLATE_MSG =
  'Error: --artifact/--var require --template (expansion happens only in template files)';

/**
 * @param {object} args parsed argv
 * @param {string|undefined} prompt pre-template prompt text
 * @param {boolean} useJson
 * @returns {{applied:false}
 *   | {applied:true, prompt:string, promptMeta:object, templateMeta:object}
 *   | {fail:number}}
 */
function applyTemplateForArgs(args, prompt, useJson) {
  if (args.template !== undefined) {
    const { applyTemplate } = require('./template/apply');
    const t = applyTemplate({
      templateRef: args.template, prompt,
      artifactFile: args.artifact, varList: args.var,
      project: args.cwd || process.cwd(),
    });
    if (t.error) { return { fail: failJson(useJson, t.error) }; }
    for (const n of t.notices) { process.stderr.write(n + '\n'); }
    return {
      applied: true, prompt: t.prompt, promptMeta: t.promptMeta,
      templateMeta: t.promptMeta.template,
    };
  }
  if (args.artifact !== undefined || args.var !== undefined) {
    return { fail: failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: NEEDS_TEMPLATE_MSG }) };
  }
  return { applied: false };
}

module.exports = { applyTemplateForArgs, NEEDS_TEMPLATE_MSG };
