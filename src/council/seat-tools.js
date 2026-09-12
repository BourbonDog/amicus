// src/council/seat-tools.js
'use strict';

/**
 * @module council/seat-tools
 * Per-run tool policy for council seats (spec 2026-09-11 §4, PR 2 of 3).
 *
 * The study (§1) found two of the three leg-loss classes share one precondition:
 * a stage-1 seat reached for a tool it did not need (gemini grep/glob over the
 * global install, cohere `task {}`). Tool access is a property of the RUN, set
 * by the caller according to whether the seat must go and get its material
 * (§2.1): task mode defaults to `webfetch`, review to nothing, `--tools` opts
 * more in, and two ids are never available to a headless seat without the
 * `--agent` override. This module is pure: it decides, and builds the two agent
 * configs the run's OpenCode server registers (run-server.js). Nothing here
 * talks to the engine — the engine's declared ids are passed IN (`declaredIds`)
 * by run.js after the server is up, so the accepted set is never hand-listed.
 */

const { CHAIR_NO_TOOLS_LEAD } = require('./briefings-chair');

/**
 * Ids a council seat may never opt into. Hand-listed on purpose: each names why.
 * Everything else is validated against the engine's own `tool.ids()`.
 */
const REFUSED_TOOL_IDS = Object.freeze({
  task: 'spawns child sessions amicus cannot observe',
  skill: 'is where a seat starts reading the harness instead of the brief',
  question: 'asks a human, and a headless leg has none',
  invalid: 'is the engine\'s error surface, not a tool',
  edit: 'a council seat never modifies the tree',
  write: 'a council seat never modifies the tree',
  apply_patch: 'a council seat never modifies the tree',
});

/** Ids that never touch the local tree; every other accepted id is LOCAL. */
const REMOTE_TOOL_IDS = Object.freeze(['webfetch', 'websearch']);

/**
 * True if `tools` contains anything outside REMOTE_TOOL_IDS. Single source for the
 * local/remote predicate — resolveSeatTools, buildCouncilAgents and seatToolsSentence
 * all call this instead of each re-writing the same `.some()` (review r1 P2-R8: the
 * duplication let `buildCouncilAgents` accept a `local` flag that could contradict its
 * own `tools`, silently dropping `external_directory: 'deny'`).
 * @param {string[]} tools @returns {boolean}
 */
function isLocal(tools) {
  return tools.some((id) => !REMOTE_TOOL_IDS.includes(id));
}

const ESCAPE_HATCH = '--agent Build';
const ID_SHAPE = /^[a-z][a-z0-9_]*$/;

/** @param {'task'|undefined} intent @returns {string[]} */
function defaultToolsFor(intent) {
  return intent === 'task' ? ['webfetch'] : [];
}

/**
 * Normalize raw values the way `--tools` does: String, trim, lowercase, drop empties.
 * Shared by parseToolsFlag and resolveSeatTools so a value from EITHER door — the CLI
 * flag's comma string or a direct `optIn` array (MCP arg, a config list) — is cleaned
 * identically before it is ever compared against REFUSED_TOOL_IDS or ID_SHAPE.
 * @param {unknown[]} raw @returns {string[]}
 */
function normalizeIds(raw) {
  return raw.map((s) => String(s).trim().toLowerCase()).filter(Boolean);
}

/**
 * The one shape-error message text both doors use, so it has a single source.
 * @param {string[]} ids @returns {string|null}
 */
function shapeErrorFor(ids) {
  const bad = ids.filter((id) => !ID_SHAPE.test(id));
  return bad.length ? `--tools: not a tool id: ${bad.join(', ')}` : null;
}

/**
 * The `--tools` flag's value → ids. Shape only; refusals and the engine check
 * live in resolveSeatTools so every door reaches them.
 * @param {unknown} value
 * @returns {{ok: true, ids: string[]}|{ok: false, message: string}}
 */
function parseToolsFlag(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return { ok: false, message: '--tools requires a comma-separated list of tool ids (e.g. --tools webfetch,read)' };
  }
  const ids = [...new Set(normalizeIds(value.split(',')))];
  if (!ids.length) { return { ok: false, message: '--tools requires at least one tool id' }; }
  const shapeError = shapeErrorFor(ids);
  if (shapeError) { return { ok: false, message: shapeError }; }
  return { ok: true, ids };
}

/**
 * Decide the seat's tool list: `defaultToolsFor(intent) ∪ optIn`, minus nothing —
 * a refused, malformed, or unknown id fails the whole run BEFORE any spend.
 * @param {{intent?: 'task'|undefined, optIn?: string[], declaredIds?: string[]|null}} args
 *   `declaredIds` null/absent = the engine has not been asked yet (shape + refusals only).
 * @returns {{ok: true, tools: string[], local: boolean}|{ok: false, code: 'BAD_ARGS', message: string}}
 */
function resolveSeatTools({ intent, optIn = [], declaredIds = null } = {}) {
  // Normalize + shape-check optIn BEFORE anything else, so a door that never goes
  // through parseToolsFlag (an MCP arg array, a config list) reaches the same gates
  // the --tools flag does. Skipping this is a named mutant: OPTINRAW — 'Task' would
  // then dodge the refusal check below (REFUSED_TOOL_IDS keys are lowercase) and
  // '../x' would dodge the shape check whenever declaredIds is null; reddens 'a
  // case-variant refused id is caught without the engine list' and 'an opted-in id
  // with a bad shape is refused without the engine list' in seat-tools.test.js.
  const normalizedOptIn = normalizeIds(optIn);
  const shapeError = shapeErrorFor(normalizedOptIn);
  if (shapeError) { return { ok: false, code: 'BAD_ARGS', message: shapeError }; }
  const requested = [...new Set([...defaultToolsFor(intent), ...normalizedOptIn])];
  const refused = requested.filter((id) => Object.prototype.hasOwnProperty.call(REFUSED_TOOL_IDS, id));
  if (refused.length) {
    return {
      ok: false, code: 'BAD_ARGS',
      message: `--tools: ${refused.map((id) => `${id} (${REFUSED_TOOL_IDS[id]})`).join('; ')} — refused for council seats; ` +
        `${ESCAPE_HATCH} runs every leg on the engine's full Build agent instead`,
    };
  }
  if (Array.isArray(declaredIds)) {
    const unknown = requested.filter((id) => !declaredIds.includes(id));
    if (unknown.length) {
      const offered = declaredIds.filter((id) => !Object.prototype.hasOwnProperty.call(REFUSED_TOOL_IDS, id)).sort();
      return {
        ok: false, code: 'BAD_ARGS',
        message: `--tools: the engine does not declare ${unknown.join(', ')}; it declares: ${offered.join(', ')}`,
      };
    }
  }
  const tools = requested.slice().sort();
  return { ok: true, tools, local: isLocal(tools) };
}

/**
 * The two agents the run's server registers (spec §4). `'*': false` is the
 * engine's wildcard (measured 2026-09-12: renders a `*=deny` rule, and each
 * `true` renders `<id>=allow` after it). The `webfetch` permission key below
 * follows the `tools` map by construction, not by separate measurement — the
 * 2026-09-12 pass measured `edit`/`bash`/`external_directory`, not `webfetch`;
 * Task 7's engine probe is what asserts the map and the permission stay in
 * agreement on the pinned engine.
 *
 * `.env` files (review r1 P2-R9, superseding the brief's "read[*.env]=ask → B53
 * stall" sentence): the engine evaluates permission with `findLast` over the
 * merged rule list (opencode v1.18.15, packages/opencode/src/permission/index.ts),
 * and its own `read[*.env]=ask` default rule renders BEFORE the seat's tools-map
 * `read=allow` — so a bare `tools.includes('read')` would let a seat granted
 * `read` read `.env` outright, not stall; that is a secrets exposure, not a
 * documented limitation. Measured fix: a nested `permission.read` object renders
 * AFTER the tools map and wins under `findLast`. `read: { '*': 'allow', '*.env':
 * 'deny', '*.env.*': 'deny' }` is measured to deny `.env`/`.env.*` and allow
 * everything else; the `'*': 'allow'` entry is REQUIRED — measured without it,
 * the object REPLACES rather than refines the tools-derived allow and ordinary
 * reads fall through to `*=deny`. `grep` and `bash` have no such fence: opting
 * either in trusts the seat with the tree's contents, `.env` included. Never
 * emits `chat`.
 * @param {{tools: string[], local: boolean}} args
 * @returns {{'council-seat': object, 'council-support': object}}
 */
function buildCouncilAgents({ tools = [], local = false } = {}) {
  const allow = Object.fromEntries(tools.map((id) => [id, true]));
  // `local` is a caller-supplied hint, not a second source of truth: OR it with the
  // real predicate (review r1 P2-R8) so a caller can never drop external_directory's
  // deny by omitting or mis-stating the flag — `resolveSeatTools` already always
  // passes a consistent pair, but this module has no other caller yet to hold to that.
  const isLocalRun = local || isLocal(tools);
  return {
    'council-support': {
      description: 'Council support role (repair, judge, debate, chair): no tools — the material is in the briefing.',
      mode: 'primary',
      tools: { '*': false },
      permission: { edit: 'deny', bash: 'deny', webfetch: 'deny', external_directory: 'deny' },
    },
    'council-seat': {
      description: `Council stage-1 seat: tools ${tools.length ? tools.join(', ') : 'none'}.`,
      mode: 'primary',
      tools: { '*': false, ...allow },
      permission: {
        edit: 'deny',
        bash: tools.includes('bash') ? 'allow' : 'deny',
        webfetch: tools.includes('webfetch') ? 'allow' : 'deny',
        ...(isLocalRun ? { external_directory: 'deny' } : {}),
        // The '*': 'allow' entry is load-bearing, not decorative (measured 2026-09-12):
        // a nested `read` object REPLACES, rather than refines, the tools-map's
        // read=allow under the engine's findLast evaluation. Dropping it is a named
        // mutant: ENVALLOWDROP — every ordinary read would then fall through to the
        // wildcard *=deny; reddens 'a read seat gets a nested .env-denying read
        // permission' in seat-tools.test.js.
        ...(tools.includes('read') ? { read: { '*': 'allow', '*.env': 'deny', '*.env.*': 'deny' } } : {}),
      },
    },
  };
}

/**
 * The briefing line a seat gets about its tools (spec §4 "briefing lines").
 * No tools → the shared no-tools sentence (briefings-chair.js), forked only on
 * its last word, exactly like the chair's. Config enforces; this informs (E1:
 * told not to, gemini complied).
 * @param {string[]} tools @param {'review'|'answer'} kind
 */
function seatToolsSentence(tools, kind) {
  if (!tools || !tools.length) { return `${CHAIR_NO_TOOLS_LEAD}${kind}.`; }
  const forbid = isLocal(tools) ? '' : ' — do not attempt to read files, search directories, or run commands';
  return `Your tools: ${tools.join(', ')}. You have no others${forbid}; if research is incomplete, ` +
    'say so in the deliverable rather than leave it unwritten.';
}

module.exports = {
  REFUSED_TOOL_IDS, REMOTE_TOOL_IDS, defaultToolsFor, parseToolsFlag, resolveSeatTools,
  buildCouncilAgents, seatToolsSentence,
};
