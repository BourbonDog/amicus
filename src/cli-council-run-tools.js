// src/cli-council-run-tools.js
'use strict';

/**
 * @module cli-council-run-tools
 * `--tools`/`--agent` shape validation plus the v4.7 PR6 out-dir fence for
 * `amicus council run` (spec 2026-09-11 §4). Split out of
 * cli-handlers-council-run.js (P2-R15, PR 2 Task 5): that file sits at the
 * 300-line pre-commit size gate and the combined block does not fit inline.
 *
 * Shape only — refusals and the engine's declared-tool check are NOT here,
 * they live in `runCouncil` (Task 4) so MCP, the workflow and any direct
 * `require('./council/run')` caller share them. The out-dir fence IS a
 * CLI-only concern (MCP has fenced `project`/cwd since v4.5 via
 * project-root-allowlist.js), which is why it lives beside the flags it
 * depends on rather than in the engine.
 *
 * The fence is the v4.7 PR6 rule (`--out-dir` must stay inside the project)
 * RELAXED for a run whose seats carry a LOCAL tool (read, grep, glob, bash):
 * spec §4 requires such a run's directory sit OUTSIDE the project tree, and
 * `runCouncil` enforces that placement (outside AND under an allowed root)
 * itself — this module only has to stop blocking it. `--agent` is the escape
 * hatch (no council agents, no allowlist), so it never wants the relaxation
 * even when `--tools` is also present.
 */

const { ERROR_CODES } = require('./utils/error-doc');
const { isPathInside } = require('./project-root-allowlist');
const { parseToolsFlag, REMOTE_TOOL_IDS } = require('./council/seat-tools');

/**
 * @param {{args: object, explicitKeys: Set<string>, runDir: string, project: string}} ctx
 * @returns {{error: ({code: string, message: string, hint?: string}|null),
 *   toolIds?: string[], agentOverride?: ('Plan'|'Build')}}
 */
function checkCouncilRunTools({ args, explicitKeys, runDir, project }) {
  // Spec 2026-09-11 §4: shape only (refusals + the engine check live in
  // runCouncil so every door — CLI, MCP, workflow — shares them).
  let toolIds;
  if (explicitKeys.has('tools') || args.tools !== undefined) {
    const parsed = parseToolsFlag(args.tools);
    if (!parsed.ok) { return { error: { code: ERROR_CODES.BAD_ARGS, message: `Error: ${parsed.message}` } }; }
    toolIds = parsed.ids;
  }
  let agentOverride;
  if (explicitKeys.has('agent') || args.agent !== undefined) {
    const a = typeof args.agent === 'string' ? args.agent.toLowerCase() : '';
    if (a !== 'plan' && a !== 'build') {
      return {
        error: {
          code: ERROR_CODES.BAD_ARGS,
          message: `Error: --agent must be Plan or Build; got '${args.agent}'`,
          hint: 'Chat is not supported headless; omit --agent to run seats on the council agents',
        },
      };
    }
    agentOverride = a === 'plan' ? 'Plan' : 'Build';
  }

  // Spec 2026-09-11 §4: a run whose seats carry a LOCAL tool must put its run dir
  // OUTSIDE the project tree (runCouncil refuses inside, and requires an allowed
  // root); every other run keeps the v4.7 fence exactly as it was.
  //
  // Named mutant: FENCEALWAYS — dropping the `!wantsLocalTool &&` conjunct (so
  // the condition is just `!isPathInside(...)`) restores the unconditional v4.7
  // fence; reddens "a local tool lets --out-dir sit outside the project" in
  // tests/cli-council-run-flags.test.js (a --tools read run with an
  // out-of-project --out-dir would then fail BAD_ARGS instead of reaching
  // runCouncil).
  //
  // Named mutant: AGENTFENCELEAK — dropping the `!agentOverride &&` conjunct
  // lets a --agent run's fence relax whenever --tools ALSO names a local id,
  // even though --agent is the escape hatch (no council agents, no allowlist)
  // and never builds the tools-based agent this relaxation exists for.
  // Reddens "--agent never relaxes the out-dir fence, even with a local
  // --tools value" in tests/cli-council-run-flags.test.js.
  const wantsLocalTool = !agentOverride && Array.isArray(toolIds) && toolIds.some((id) => !REMOTE_TOOL_IDS.includes(id));
  if (!wantsLocalTool && !isPathInside(runDir, project)) {
    return {
      error: {
        code: ERROR_CODES.BAD_ARGS,
        message: `Error: --out-dir must stay inside the project: '${args['out-dir']}' resolves outside ${project}`,
      },
    };
  }

  return { error: null, toolIds, agentOverride };
}

module.exports = { checkCouncilRunTools };
