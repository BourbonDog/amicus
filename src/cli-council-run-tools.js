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
  // council #247 round 5 (P2-R51, B3): `tools: null` is the CLI house style
  // for an unset option, exactly as `agent: null` below, and runCouncil's
  // own preflight (preflightSeatTools) already treats a null `o.tools` as
  // absent — so this door must too.
  if (args.tools !== null && (explicitKeys.has('tools') || args.tools !== undefined)) {
    // B6 (P2-R35): a repeated `--tools a --tools b` (or a caller that builds
    // args directly, MCP-input style) can arrive as an array — join it before
    // parseToolsFlag, which only ever spoke the comma-string shape.
    const raw = Array.isArray(args.tools) ? args.tools.join(',') : args.tools;
    const parsed = parseToolsFlag(raw);
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
  //
  // council #247 round 5 (P2-R51, D4): an `--agent` run carries no toolIds of
  // its own (the conflict check above refuses combining `--agent` with
  // `--tools`), so `wantsLocalTool` is false and this same fence applies to
  // it too — an outside run directory would put the `--agent` leg's working
  // directory outside the tree it must read, and the engine's own
  // `external_directory` default is `ask`, a prompt a headless leg can never
  // answer.
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
  const notices = [];
  if (Array.isArray(toolIds) && toolIds.includes('bash')) {
    notices.push('Notice: --tools bash gives every stage-1 seat a shell as you: no fence applies — it can ' +
      'reach the run directory outside the tree (this run\'s own records included: the label map ' +
      'that anonymizes the bench and every review already on disk, so bench anonymity and ' +
      'independence do not hold under bash), your home directory and the network, and the webfetch ' +
      'deny does not bind a shell.');
  }
  // council #247 round 5 (P2-R50, B2/D5/C2): `grep`/`glob` search the whole
  // project tree with no per-file fence either (grep returns `.env`
  // contents, glob lists `.env` names — the read fence only ever binds
  // `read`), so the CLI names that in a Notice too, whenever either is
  // opted in (both together name both ids, `grep/glob`).
  const grepGlobIds = ['grep', 'glob'].filter((id) => Array.isArray(toolIds) && toolIds.includes(id));
  if (grepGlobIds.length) {
    notices.push(`Notice: --tools ${grepGlobIds.join('/')} search the whole project tree with no per-file fence — ` +
      'grep returns .env contents and glob lists .env names; the read fence does not bind them. Opt them in ' +
      'only on a tree without secrets.');
  }
  // Ruling P2-R41b (A4, round 3): --agent Build is the escape hatch running
  // every leg on the engine's own agent, full tool set included — unlike the
  // council-seat allowlist, Build can edit files and run commands, so the CLI
  // names that in a Notice too.
  if (agentOverride === 'Build') {
    notices.push('Notice: --agent Build runs every leg on the engine\'s Build agent, which can edit files ' +
      'and run commands, with the run directory (inside the project) as its ' +
      'working directory.');
  }
  // council #247 round 5 (P2-R50, D3): --agent Plan runs every leg — judges
  // and the chair included, not only stage-1 — on the engine's own Plan
  // agent, which can read, search and run shell commands (only edits are
  // denied); the CLI names that in a Notice too.
  if (agentOverride === 'Plan') {
    notices.push('Notice: --agent Plan runs every leg (judges and the chair included) on the engine\'s Plan ' +
      'agent, which can read, search and run commands (edits denied) — v4.9.7\'s behaviour — with the run ' +
      'directory (inside the project) as its working directory.');
  }

  return { error: null, toolIds, agentOverride, ...(notices.length ? { notices } : {}) };
}

module.exports = { checkCouncilRunTools };
