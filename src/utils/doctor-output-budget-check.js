/**
 * @module doctor-output-budget-check
 * #218 PR 2: the 'output-budget' doctor row.
 *
 * VERIFIABLE voice (same rule as doctor-base-url-check.js): the row states only
 * what it read — the configured `outputBudget` as stored, the ambient
 * OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX this process sees, and which alias
 * routes the cached catalog can clamp. It never claims what a provider will do.
 *
 * What earns a WARN, and why (probe rows in brackets, BACKLOG "v4.9.4 records"):
 *   - a malformed budget or a malformed ambient flag: the engine falls back to
 *     32000 SILENTLY (D1/D2) — the one failure the product principle forbids;
 *   - a budget above the engine default with alias routes the catalog cannot
 *     clamp: the engine clamps routes its own catalog knows (K5), but a model
 *     neither catalog knows receives the budget as-is (J2/K13);
 *   - a reservation of at least half a route's context window: input plus
 *     max_tokens has to fit the window, and the engine subtracts the same
 *     reservation from the window before compaction (read in the binary), so
 *     such a budget starves the prompt.
 */
'use strict';

const { normalizeOutputBudget, buildLimitLookup, computeModelLimit, positiveCount } = require('./model-output-limit');
const { OUTPUT_TOKEN_FLAG, ENGINE_DEFAULT_OUTPUT_TOKENS } = require('./engine-output-flag');

const ID = 'output-budget';
const NAME = 'Output budget';
const row = (status, message, hint = null) => ({ id: ID, name: NAME, status, message, hint });

/** Up to three names, then "+N more". @param {string[]} names @returns {string} */
function shortList(names) {
  const head = names.slice(0, 3).join(', ');
  return names.length > 3 ? `${head}, +${names.length - 3} more` : head;
}

/**
 * @param {{readOutputBudgetRaw:Function, readCache:Function, collectAliasSources:Function,
 *   getConfigDir:Function, env?:NodeJS.ProcessEnv}} d
 * @returns {{id:string,name:string,status:string,message:string,hint:?string}}
 */
function evaluateOutputBudget(d) {
  const env = d.env || process.env;
  const ambient = env[OUTPUT_TOKEN_FLAG];
  const raw = d.readOutputBudgetRaw();
  const dflt = `the engine default (${ENGINE_DEFAULT_OUTPUT_TOKENS} per leg) applies`;

  if (raw === undefined) {
    if (ambient === undefined) { return row('ok', `not set — ${dflt}`); }
    // The engine parses the flag as a positive integer and otherwise ignores it
    // without a word (D1 `64000abc`, D2 `0`): the value has to be checked here
    // or a user following the docs' "export the flag" advice gets a silent 32000.
    const n = positiveCount(Number(ambient));
    return n === null
      ? row('warn',
        `not set — ${OUTPUT_TOKEN_FLAG}=${ambient} in this environment is not a positive integer; the engine silently falls back to ${ENGINE_DEFAULT_OUTPUT_TOKENS}`,
        `unset ${OUTPUT_TOKEN_FLAG}, or set it to a positive integer`)
      : row('ok', `not set — ${OUTPUT_TOKEN_FLAG}=${ambient} in this environment raises the engine default to ${n} per leg`);
  }

  const budget = normalizeOutputBudget(raw);
  if (budget === null) {
    return row('warn', `${JSON.stringify(raw)} is not a positive integer — ignored; ${dflt}`,
      `set outputBudget to a positive integer in ${d.getConfigDir()}/config.json, or remove it`);
  }
  const overridden = ambient === undefined ? ''
    : `; ${OUTPUT_TOKEN_FLAG}=${ambient} in this environment is overridden by outputBudget for engines amicus starts`;

  const cache = d.readCache();
  if (!cache || !Array.isArray(cache.models)) {
    return row('warn',
      `${budget} per leg — no catalog cache, so no route is clamped to a known ceiling (the engine clamps routes its own catalog knows; an unknown model receives ${budget} as-is)${overridden}`,
      'amicus models --refresh');
  }

  const limits = buildLimitLookup(cache.models);
  const routes = [...new Set(d.collectAliasSources().map((s) => s.model))];
  const unclamped = [];
  const starved = [];
  for (const id of routes) {
    const limit = computeModelLimit(limits.get(id), budget);
    if (!limit) { unclamped.push(id); continue; }
    if (limit.output * 2 >= limit.context) { starved.push(`${id} (${limit.output} of ${limit.context})`); }
  }

  let message = `${budget} per leg; ${routes.length - unclamped.length} of ${routes.length} alias routes clamped to a catalog ceiling`;
  let status = 'ok';
  let hint = null;
  if (unclamped.length > 0) {
    message += `; ${unclamped.length} without a catalog ceiling (${shortList(unclamped)}) — the engine clamps those its own catalog knows, an unknown model receives ${budget} as-is`;
    // At or below the default the flag can only lower what the engine sends
    // (K12); above it an unknown model is the one place the number goes out
    // unclamped (J2/K13), so that is the only case worth a warning.
    if (budget > ENGINE_DEFAULT_OUTPUT_TOKENS) {
      status = 'warn';
      hint = 'amicus models --refresh  (a budget above the engine default reaches an unknown model unclamped)';
    }
  }
  if (starved.length > 0) {
    message += `; reserves at least half the context window of ${shortList(starved)}`;
    status = 'warn';
    hint = hint || 'lower outputBudget — input plus the reservation must fit the context window';
  }
  return row(status, message + overridden, hint);
}

module.exports = { evaluateOutputBudget };
