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
  // Named mutant TOOLSNOTARRAY: dropping this check lets a non-array `tools`
  // (a bare string, say) reach resolveSeatTools below, where
  // `Array.isArray(o.tools) ? o.tools : []` silently discards it as `[]`
  // instead of refusing the run. Pinned by run-tools.test.js's `tools: 'read'`
  // case (BAD_ARGS naming the received type; nothing launches).
  if (o.tools !== undefined && o.tools !== null && !Array.isArray(o.tools)) {
    return { error: { code: 'BAD_ARGS', message: 'Error: tools must be an array of tool ids (got ' + typeof o.tools + ')' } };
  }
  // Ruling P2-R28 (supersedes P2-R25): --tools/--agent are refused together on
  // every door. Named mutant AGENTTOOLSCONFLICT: dropping this check reddens
  // the runCouncil conflict test (agent + a non-empty tools array must exit 1
  // naming "cannot be combined", never reach a launch).
  const conflict = seatTools.agentToolsConflict(o.agent, o.tools);
  if (conflict) { return { error: { code: 'BAD_ARGS', message: `Error: ${conflict}` } }; }
  // The --agent escape hatch wins: no council agents, every leg runs on the
  // engine's own agent — so --tools is never even consulted under it. Pinned
  // by run-tools.test.js's "--agent Build short-circuits resolveSeatTools
  // even under task intent" case — review intent alone can't tell the
  // short-circuit apart from an unconditional resolveSeatTools call (both
  // give `tools: []`), only the task default (`['webfetch']`) can.
  const seatPolicy = o.agent
    ? { ok: true, tools: [], local: false }
    : seatTools.resolveSeatTools({ intent: seatIntentOf(o), optIn: Array.isArray(o.tools) ? o.tools : [] });
  if (!seatPolicy.ok) { return { error: { code: seatPolicy.code, message: `Error: ${seatPolicy.message}` } }; }
  if (seatPolicy.local) {
    // Defensive refusal: with a local tool and a falsy o.project,
    // isPathInside(runDir, undefined) is false, so the placement rule below
    // would PASS, and run-launch.js's directory fallback
    // (`(opts.role === 'seat' && opts.directory) || opts.project`) resolves to
    // the run dir itself — a direct caller (bypassing the CLI's required
    // --project) could scope a seat to the very dir holding its own sibling
    // sessions, exactly what the placement rule below exists to prevent.
    // Named mutant NOPROJECTSCOPE: dropping this guard lets that through.
    // Pinned by run-tools.test.js's "project: undefined" case.
    if (!o.project) {
      return { error: { code: 'BAD_ARGS', message: 'Error: a local tool needs a project directory to scope the seats to' } };
    }
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
 * Validate the run's seat tools against the engine's own declaration, after
 * the server is up and before any Stage-1 leg launches. Ruling P2-R30: this
 * runs for the intent's DEFAULT too, not only an explicit opt-in — a
 * defaults-only run is never launched against an engine that does not
 * actually declare it. A no-op (`{error: null}`) whenever there is nothing to
 * validate at all (`--agent`, or a review run with no tools); and whenever the
 * engine could not be asked (no shared server), a defaults-only run degrades
 * quietly rather than refusing over a check nobody opted into.
 * @param {{agent?: string, intent?: string, tools?: string[], seatTools?: string[], project: string}} o
 * @param {{serverClient: object}|null} sharedServer
 * @param {{listEngineToolIdsFn?: Function}} deps test seam; default = the real
 *   run-server.js :: listEngineToolIds
 * @returns {Promise<{error: {code: string, message: string}|null}>}
 */
async function validateSeatToolsAgainstEngine(o, sharedServer, deps = {}) {
  // Named mutant DEFAULTSUNCHECKED: narrowing this to `Array.isArray(o.tools)
  // && o.tools.length` (the pre-P2-R30 guard) would skip a task-intent run
  // with NO explicit --tools even when the engine declares no `webfetch` at
  // all. Pinned by run-tools.test.js's "no tools, engine has no webfetch" case.
  if (Array.isArray(o.seatTools) && o.seatTools.length) {
    const seatTools = require('./seat-tools');
    const listIds = deps.listEngineToolIdsFn || require('./run-server').listEngineToolIds;
    const declared = await listIds(sharedServer, o.project);
    if (!declared) {
      // No way to ask: an explicit opt-in is refused (as before P2-R30) —
      // a defaults-only run is not, since nobody asked for that check and the
      // shared-server degrade is already recorded elsewhere.
      if (Array.isArray(o.tools) && o.tools.length) {
        return {
          error: {
            code: 'BAD_ARGS',
            message: 'Error: --tools could not be validated: the run\'s engine did not list its tools '
              + '(no shared server, or the tool-ids endpoint failed); nothing was launched',
          },
        };
      }
      return { error: null };
    }
    // This second resolveSeatTools call is a GATE, not a recompute: `o.seatTools`
    // (preflightSeatTools's result) is already authoritative and unchanged by
    // this check, so `checked.tools`/`checked.local` are deliberately discarded
    // here — only `checked.ok` (declared-id refusals, now over the default too)
    // is consulted.
    const checked = seatTools.resolveSeatTools({ intent: seatIntentOf(o), optIn: o.tools || [], declaredIds: declared });
    if (!checked.ok) { return { error: { code: checked.code, message: `Error: ${checked.message}` } }; }
  }
  return { error: null };
}

module.exports = { preflightSeatTools, validateSeatToolsAgainstEngine };
