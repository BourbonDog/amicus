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

const ESCAPE_HATCH = '--agent Build';
const ID_SHAPE = /^[a-z][a-z0-9_]*$/;

/** @param {'task'|undefined} intent @returns {string[]} */
function defaultToolsFor(intent) {
  return intent === 'task' ? ['webfetch'] : [];
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
  const ids = [...new Set(value.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean))];
  if (!ids.length) { return { ok: false, message: '--tools requires at least one tool id' }; }
  const bad = ids.filter((id) => !ID_SHAPE.test(id));
  if (bad.length) { return { ok: false, message: `--tools: not a tool id: ${bad.join(', ')}` }; }
  return { ok: true, ids };
}

/**
 * Decide the seat's tool list: `defaultToolsFor(intent) ∪ optIn`, minus nothing —
 * a refused or unknown id fails the whole run BEFORE any spend.
 * @param {{intent?: 'task'|undefined, optIn?: string[], declaredIds?: string[]|null}} args
 *   `declaredIds` null/absent = the engine has not been asked yet (shape + refusals only).
 * @returns {{ok: true, tools: string[], local: boolean}|{ok: false, code: 'BAD_ARGS', message: string}}
 */
function resolveSeatTools({ intent, optIn = [], declaredIds = null } = {}) {
  const requested = [...new Set([...defaultToolsFor(intent), ...optIn])];
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
  const local = tools.some((id) => !REMOTE_TOOL_IDS.includes(id));
  return { ok: true, tools, local };
}

/**
 * The two agents the run's server registers (spec §4). `'*': false` is the
 * engine's wildcard (measured 2026-09-12: renders a `*=deny` rule, and each
 * `true` renders `<id>=allow` after it). Never emits `chat`.
 * @param {{tools: string[], local: boolean}} args
 * @returns {{'council-seat': object, 'council-support': object}}
 */
function buildCouncilAgents({ tools = [], local = false } = {}) {
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
        ...(local ? { external_directory: 'deny' } : {}),
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
  const local = tools.some((id) => !REMOTE_TOOL_IDS.includes(id));
  const forbid = local ? '' : ' — do not attempt to read files, search directories, or run commands';
  return `Your tools: ${tools.join(', ')}. You have no others${forbid}; if research is incomplete, ` +
    'say so in the deliverable rather than leave it unwritten.';
}

module.exports = {
  REFUSED_TOOL_IDS, REMOTE_TOOL_IDS, defaultToolsFor, parseToolsFlag, resolveSeatTools,
  buildCouncilAgents, seatToolsSentence,
};
