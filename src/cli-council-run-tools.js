/**
 * @module cli-council-run-tools
 * `--tools`/`--agent` validation and the v4.7 out-dir fence for `council run`.
 *
 * Spec 2026-09-11 §4. Split out of cli-handlers-council-run.js (P2-R15, PR 2
 * Task 5): that file sits at the 300-line pre-commit size gate and the
 * combined block does not fit inline.
 *
 * Shape only — refusals and the engine's declared-tool check are NOT here,
 * they live in `runCouncil` (Task 4) so MCP, the workflow and any direct
 * `require('./council/run')` caller share them. The out-dir fence IS a
 * CLI-only concern: MCP has fenced the out-dir since v4.5
 * (mcp-council-run.js:137-141's own `isPathInside(runDir, project)`) — this
 * module is what gives the CLI door the same fence, which is why it lives
 * beside the flags it depends on rather than in the engine.
 *
 * The fence is the v4.7 PR6 rule (`--out-dir` must stay inside the project)
 * RELAXED for a run whose seats carry a LOCAL tool (read, grep, glob, bash):
 * spec §4 requires such a run's directory sit OUTSIDE the project tree, and
 * `runCouncil` enforces that placement (outside AND under an allowed root)
 * itself — this module only has to stop blocking it. `--agent` combined with
 * `--tools` is refused outright (ruling P2-R28), before this fence is ever
 * consulted — the escape hatch (no council agents, no allowlist) has no
 * tools-based agent for the relaxation to apply to.
 */

'use strict';

const { ERROR_CODES } = require('./utils/error-doc');
const { isPathInside } = require('./project-root-allowlist');
const { parseToolsFlag, isLocal, agentToolsConflict } = require('./council/seat-tools');

/**
 * @param {{args: object, explicitKeys: Set<string>, runDir: string, project: string}} ctx
 * @returns {{error: ({code: string, message: string, hint?: string}|null),
 *   toolIds?: string[], agentOverride?: ('Plan'|'Build'), notices?: string[]}}
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
  // council #247 D5: `agent: null` is the CLI house style for an unset
  // option, never an invalid override and never `--agent`'s own skip branch.
  if (args.agent !== null && (explicitKeys.has('agent') || args.agent !== undefined)) {
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

  // Ruling P2-R28 (supersedes P2-R25): --tools/--agent are refused together,
  // before either is consulted further, on every door.
  const conflict = agentToolsConflict(agentOverride, toolIds);
  if (conflict) { return { error: { code: ERROR_CODES.BAD_ARGS, message: `Error: ${conflict}` } }; }

  // Spec 2026-09-11 §4: a run whose seats carry a LOCAL tool must put its run dir
  // OUTSIDE the project tree (runCouncil refuses inside, and requires an allowed
  // root); every other run keeps the v4.7 fence exactly as it was.
  //
  // Named mutant: FENCEALWAYS — dropping the `!wantsLocalTool &&` conjunct (so
  // the condition is just `!isPathInside(...)`) restores the unconditional v4.7
  // fence; reddens "a local tool lets --out-dir sit outside the project" in
  // tests/cli-council-run-flags.test.js (a --tools read run with an
  // out-of-project --out-dir would then fail BAD_ARGS instead of reaching
  // runCouncil). `agentOverride` no longer needs its own conjunct here: the
  // conflict check above already refuses any run where both are set.
  //
  // isLocal (not a hand-rolled `.some()`) — review r1 P2-R19: it is
  // council/seat-tools.js's single source for the local/remote predicate
  // (its own JSDoc names three other callers); re-deriving it here was a
  // fourth, silently-driftable copy of the same test.
  const wantsLocalTool = Array.isArray(toolIds) && isLocal(toolIds);
  if (!wantsLocalTool && !isPathInside(runDir, project)) {
    return {
      error: {
        code: ERROR_CODES.BAD_ARGS,
        message: `Error: --out-dir must stay inside the project: '${args['out-dir']}' resolves outside ${project}`,
      },
    };
  }

  // A1/D2: `bash` sits outside every fence (run directory, home, network) —
  // the CLI names that in a Notice whenever a caller opts it in.
  const notices = (Array.isArray(toolIds) && toolIds.includes('bash'))
    ? ['Notice: --tools bash gives every stage-1 seat a shell as you: no fence applies — it can ' +
      'reach the run directory outside the tree, your home directory and the network, and the ' +
      'webfetch deny does not bind a shell.']
    : undefined;

  return { error: null, toolIds, agentOverride, ...(notices ? { notices } : {}) };
}

module.exports = { checkCouncilRunTools };
