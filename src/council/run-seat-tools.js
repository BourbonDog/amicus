// src/council/run-seat-tools.js
'use strict';

/**
 * @module council/run-seat-tools
 * `runCouncil`'s seat-tools wiring (spec 2026-09-11 §4, PR 2 of 3), split out of
 * run.js under controller ruling P2-R14 (the 300-line size gate: run.js sat at
 * exactly 300 lines with no headroom for this task's ~20 lines of logic).
 *
 * Two pure-ish steps, called from run.js on either side of `acquireRunServer`:
 *   - `preflightSeatTools` (BEFORE the server): shape + refusals need no
 *     engine, and the run-directory placement rule for a local tool is a
 *     property of the tool id alone (seat-tools.js :: isLocal) — so both are
 *     decided, and refused, at ZERO SPEND. Its `councilAgents` output feeds
 *     `acquireRunServer`'s `agents` config, which is why it must run first.
 *   - `validateSeatToolsAgainstEngine` (AFTER the server, before any launch):
 *     the opt-in ids are checked against the engine's OWN declared tool list
 *     (run-server.js :: listEngineToolIds), so the accepted set is never
 *     hand-listed and never launched unvalidated.
 *
 * Neither function calls `finalize` — that stays run.js's job (the single exit
 * every terminal outcome funnels through) — they return `{error}` and run.js
 * decides what to do with it.
 */

/**
 * The seat-tools `intent` argument both functions derive from `o.intent`
 * (`'task'` or absent — never a bare boolean or the raw `o.intent` string).
 * One helper so the two derivations can never drift apart.
 * @param {{intent?: string}} o @returns {'task'|undefined}
 */
function seatIntentOf(o) { return o.intent === 'task' ? 'task' : undefined; }

/**
 * Decide the run's seat-tools policy before the server starts. Pure except for
 * the two lazy `require`s (seat-tools.js, project-root-allowlist.js), which
 * carry no state of their own.
 * @param {{agent?: string, intent?: string, tools?: string[], runDir: string, project: string}} o
 * @returns {{error: {code: string, message: string}}|{error: null, seatTools: string[],
 *   seatToolsLocal: boolean, councilAgents: object|null}}
 */
function preflightSeatTools(o) {
  const seatTools = require('./seat-tools');
  // Review r1: not-null-and-not-undefined (not just `!== undefined`), so
  // `agent: null` — the CLI house style for an unset option (run.js's own `o`
  // seed spreads `critic: null, lenses: null, maxCost: null, ...` the same
  // way) — is treated as absent, not as an invalid override. Every OTHER
  // `o.agent` check in this module already does this for free (`null` is
  // falsy), so this guard was the one place stricter than the rest of the
  // module. `!= null` would say the same thing in one operator, but the
  // repo's eqeqeq('always') lint rule bans loose equality outright.
  if (o.agent !== null && o.agent !== undefined && o.agent !== 'Plan' && o.agent !== 'Build') {
    return { error: { code: 'BAD_ARGS', message: `Error: agent must be Plan or Build; got '${o.agent}'` } };
  }
  // The --agent escape hatch wins: no council agents, every leg runs on the
  // engine's own agent — so --tools is never even consulted under it (the
  // "--agent Build skips the council agents" pin, tests/council/run-tools.test.js).
  const seatPolicy = o.agent
    ? { ok: true, tools: [], local: false }
    : seatTools.resolveSeatTools({ intent: seatIntentOf(o), optIn: Array.isArray(o.tools) ? o.tools : [] });
  if (!seatPolicy.ok) { return { error: { code: seatPolicy.code, message: `Error: ${seatPolicy.message}` } }; }
  if (seatPolicy.local) {
    // Run-directory placement (spec §4): a seat that can read the project tree
    // must not be able to read this run's sibling sessions, so the run dir must
    // sit OUTSIDE the tree (and still under a root amicus is willing to write to).
    // Named mutant DIRPLACEDROP: dropping the `isPathInside(...) ||` conjunct
    // (keeping only the allowed-root half) would accept a runDir NESTED inside
    // the project as long as the project itself sits under an allowed root —
    // exactly the escape this rule exists to close. Pinned by run-tools.test.js's
    // "run dir INSIDE the project" case (allowed root, still refused) and by its
    // "outside the project" case (same allowed root, not refused once sibling).
    const { isPathInside, isAllowedProjectRoot } = require('../project-root-allowlist');
    if (isPathInside(o.runDir, o.project) || !isAllowedProjectRoot(o.runDir)) {
      return {
        error: {
          code: 'BAD_ARGS',
          message: 'Error: --tools with a local tool (read, grep, glob, bash) needs --out-dir OUTSIDE the project tree '
            + '(a seat that can read the tree must not be able to read the run\'s sibling sessions) and under your home, tmp or AMICUS_PROJECT_ROOTS',
        },
      };
    }
  }
  return {
    error: null,
    seatTools: seatPolicy.tools,
    seatToolsLocal: seatPolicy.local,
    councilAgents: o.agent ? null : seatTools.buildCouncilAgents({ tools: seatPolicy.tools, local: seatPolicy.local }),
  };
}

/**
 * Validate the run's opt-in tool ids against the engine's own declaration,
 * after the server is up and before any Stage-1 leg launches. A no-op
 * (`{error: null}`) whenever there is nothing to validate: no `--agent`
 * override was requested is implied by the caller having reached this point
 * with council agents in play, and an EMPTY/absent `--tools` never needed the
 * engine's own list in the first place (the intent default alone — `webfetch`
 * for task mode, nothing for review — was already cleared by
 * `preflightSeatTools`, which needs no engine).
 * @param {{agent?: string, intent?: string, tools?: string[], project: string}} o
 * @param {{serverClient: object}|null} sharedServer
 * @param {{listEngineToolIdsFn?: Function}} deps test seam; default = the real
 *   run-server.js :: listEngineToolIds
 * @returns {Promise<{error: {code: string, message: string}|null}>}
 */
async function validateSeatToolsAgainstEngine(o, sharedServer, deps) {
  // Named mutant NOAGENTGUARD: dropping the `!o.agent &&` conjunct would run
  // this check even under the --agent escape hatch, where `preflightSeatTools`
  // never turned --tools into a seat policy at all (it short-circuits to
  // `{tools: [], local: false}` for any --agent value) — refusing a run that
  // legitimately opted out of the council-agent tool policy. Pinned by
  // run-tools.test.js's "--agent Build skips…" case (tools: ['task'], which
  // IS a refused id under the normal policy, yet the run must NOT refuse).
  if (!o.agent && Array.isArray(o.tools) && o.tools.length) {
    const seatTools = require('./seat-tools');
    const listIds = deps.listEngineToolIdsFn || require('./run-server').listEngineToolIds;
    const declared = await listIds(sharedServer, o.project);
    if (!declared) {
      return {
        error: {
          code: 'BAD_ARGS',
          message: 'Error: --tools could not be validated: the run\'s engine did not list its tools '
            + '(no shared server, or the tool-ids endpoint failed); nothing was launched',
        },
      };
    }
    // This second resolveSeatTools call is a GATE, not a recompute: `o.seatTools`
    // (preflightSeatTools's result) is already authoritative and unchanged by
    // this check, so `checked.tools`/`checked.local` are deliberately discarded
    // here — only `checked.ok` (declared-id refusals) is consulted.
    const checked = seatTools.resolveSeatTools({ intent: seatIntentOf(o), optIn: o.tools, declaredIds: declared });
    if (!checked.ok) { return { error: { code: checked.code, message: `Error: ${checked.message}` } }; }
  }
  return { error: null };
}

module.exports = { preflightSeatTools, validateSeatToolsAgainstEngine };
