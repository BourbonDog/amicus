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

/** Ids that never touch the local tree: the remote fetchers, plus the engine's own todo list. */
const NON_LOCAL_TOOL_IDS = Object.freeze(['webfetch', 'websearch', 'todowrite']);
const REMOTE_TOOL_IDS = NON_LOCAL_TOOL_IDS; // alias: existing importers keep resolving it

/**
 * True if `tools` contains anything outside NON_LOCAL_TOOL_IDS. Single source for the
 * local/remote predicate — resolveSeatTools and seatToolsSentence both call this
 * instead of each re-writing the same `.some()` (review r1 P2-R8: before this fix,
 * `buildCouncilAgents` accepted a `local` flag that could contradict its own `tools`,
 * silently dropping `external_directory: 'deny'`; it now denies that key
 * unconditionally and takes no `local` flag). A third caller (PR 2
 * Task 5 review r1, P2-R19): cli-council-run-tools.js's out-dir fence, which decides
 * whether a run's directory may sit outside the project tree.
 * @param {string[]} tools @returns {boolean}
 */
function isLocal(tools) {
  return tools.some((id) => !NON_LOCAL_TOOL_IDS.includes(id));
}

/**
 * `--tools`/`--agent` are mutually exclusive (ruling P2-R28, supersedes P2-R25's
 * MCP-only short-circuit): the override already runs every leg on its own agent.
 * @param {string|null|undefined} agent @param {string[]|undefined} tools
 * @returns {string|null} the refusal message, or null when there is no conflict
 */
function agentToolsConflict(agent, tools) {
  if (!agent || !Array.isArray(tools) || !tools.length) { return null; }
  return `--tools cannot be combined with --agent: the override runs every leg on the engine's own ${agent} agent with its full tool set; drop one of them`;
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
 * The REFUSED_TOOL_IDS check, factored out of resolveSeatTools (review r1
 * P2-R20) so it has one message and one caller list: resolveSeatTools (CLI
 * defaults + opt-in) and resolveRemoteOnlyTools (the MCP door) must refuse
 * `task`/`skill`/… identically — a permanently-refused id is refused for the
 * SAME reason regardless of which door it arrived through, never described
 * as a placement (local-vs-remote) problem the way an ordinary local tool is.
 * `ids` must already be normalized (lowercase/trimmed) — every caller here
 * goes through normalizeIds or parseToolsFlag first.
 * @param {string[]} ids @returns {{ok: false, code: 'BAD_ARGS', message: string}|null}
 */
function refusalFor(ids) {
  const refused = ids.filter((id) => Object.prototype.hasOwnProperty.call(REFUSED_TOOL_IDS, id));
  if (!refused.length) { return null; }
  return {
    ok: false, code: 'BAD_ARGS',
    message: `--tools: ${refused.map((id) => `${id} (${REFUSED_TOOL_IDS[id]})`).join('; ')} — refused for council seats; ` +
      `${ESCAPE_HATCH} runs every leg on the engine's full Build agent instead`,
  };
}

/**
 * The MCP door's tool policy (spec 2026-09-11 §4, ledger P2-R2): over MCP the
 * run directory must stay inside the project (the fence in mcp-council-run.js),
 * so a seat cannot be placed there with a LOCAL tool — refused with a message
 * naming the CLI command that DOES allow it (an out-of-project --out-dir). A
 * PERMANENTLY-refused id (review r1 P2-R20: task/skill/question/invalid/edit/
 * write/apply_patch) is refused first, with refusalFor's reason — it is not a
 * placement problem, and NON_LOCAL_TOOL_IDS.includes(id) is false for every one
 * of them, so without this check the local-tools branch below caught them too
 * and suggested an --out-dir command that would ALSO fail (resolveSeatTools
 * refuses these ids unconditionally, everywhere, run-directory or not).
 * Tools that never touch the tree (webfetch, websearch, todowrite) carry no
 * placement requirement and ride through. Shape-checked the same way the CLI flag is (parseToolsFlag), so
 * `mcp-council-run.js` never re-implements comma-splitting/normalizing for an
 * input that happens to arrive as an array instead of a flag string. An empty
 * array is treated as absent (`{ok: true, ids: []}`) rather than the
 * `--tools`-with-nothing-typed shape error parseToolsFlag('') would raise —
 * the MCP schema's `z.array(z.string().min(1))` allows `[]` (`.min(1)`
 * constrains each string, not the array), so a caller can send it without
 * ever having typed a flag at all.
 * @param {string[]|string} input MCP `tools` input: an array (the declared
 *   schema shape) or a string (defense-in-depth for a caller that bypasses it).
 * @returns {{ok: true, ids: string[]}|{ok: false, message: string}}
 */
function resolveRemoteOnlyTools(input) {
  if (Array.isArray(input) && !input.length) { return { ok: true, ids: [] }; }
  const parsed = parseToolsFlag(Array.isArray(input) ? input.join(',') : String(input));
  if (!parsed.ok) { return { ok: false, message: parsed.message }; }
  const refusal = refusalFor(parsed.ids);
  if (refusal) { return { ok: false, message: refusal.message }; }
  // Named mutant MCPLOCALLEAK: dropping this filter/refusal lets a local id
  // (e.g. `read`) ride through as `ok: true`, reaching the spawned CLI child
  // whose run dir is fenced INSIDE the project — the exact placement spec §4
  // forbids. Reddens 'a local id is refused with a message naming the CLI
  // (MCPLOCALLEAK target)' in tests/council/seat-tools.test.js and 'a local
  // tool over MCP is refused before anything spawns — the MCP run dir must
  // stay inside the project' in tests/mcp-council-run.test.js.
  const local = parsed.ids.filter((id) => !NON_LOCAL_TOOL_IDS.includes(id));
  if (local.length) {
    return {
      ok: false,
      message: `tools: ${local.join(', ')} are local tools; over MCP the run directory must stay inside the project, ` +
        'and a seat with local tools must not run there. Use `amicus council run --tools ' + parsed.ids.join(',') +
        ' --out-dir <dir outside the project>` from the CLI.',
    };
  }
  return { ok: true, ids: parsed.ids };
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
  const refusal = refusalFor(requested);
  if (refusal) { return refusal; }
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
 * @param {{tools: string[]}} args
 * @returns {{'council-seat': object, 'council-support': object}}
 */
function buildCouncilAgents({ tools = [] } = {}) {
  const allow = Object.fromEntries(tools.map((id) => [id, true]));
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
        // council-seat always denies external directories; a tree cannot own
        // that key — even a webfetch-only seat gets this rule (measured 2026-09-12).
        external_directory: 'deny',
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
 * told not to, gemini complied). Under `--agent` (ruling P2-R31), `tools` is ignored.
 * @param {string[]} tools @param {'review'|'answer'} kind @param {{agent?: string}} [opts]
 */
function seatToolsSentence(tools, kind, { agent } = {}) {
  // Named mutant OVERRIDESENTENCEDROP: dropping this branch would brief an
  // --agent-override seat as if a computed allowlist still applied.
  if (agent) {
    return `You run as the engine's ${agent} agent with its own tool set; use tools only where ` +
      'the deliverable needs them; if research is incomplete, say so in the deliverable rather ' +
      'than leave it unwritten.';
  }
  if (!tools || !tools.length) { return `${CHAIR_NO_TOOLS_LEAD}${kind}.`; }
  const forbid = isLocal(tools) ? '' : ' — do not attempt to read files, search directories, or run commands';
  return `Your tools: ${tools.join(', ')}. You have no others${forbid}; if research is incomplete, ` +
    'say so in the deliverable rather than leave it unwritten.';
}

module.exports = {
  REFUSED_TOOL_IDS, REMOTE_TOOL_IDS, NON_LOCAL_TOOL_IDS, defaultToolsFor, parseToolsFlag, resolveSeatTools,
  resolveRemoteOnlyTools, buildCouncilAgents, seatToolsSentence, isLocal, agentToolsConflict,
};
