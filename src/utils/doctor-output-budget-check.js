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
 *     only a plain decimal integer is measured to be honoured (D1/D2 measured
 *     64000abc and 0), so any other form is reported as unmeasured, never healthy;
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
  // Not "32000 per leg": under the default a leg reserves min(32000, the
  // ceiling the engine's catalog knows for it) — probe B sent 4096 for a
  // 4096-ceiling row with no flag at all.
  const dflt = `the engine default applies (OUTPUT_TOKEN_MAX ${ENGINE_DEFAULT_OUTPUT_TOKENS}: each leg reserves min(${ENGINE_DEFAULT_OUTPUT_TOKENS}, the ceiling the engine's catalog knows for it))`;

  // Only a PLAIN decimal integer is measured to be honoured — it is the shape
  // amicus itself writes (engine-output-flag.js :: outputTokenFlagValue) and
  // the shape the probe ran (C1, K5, K12). `64000abc` and `0` fall back to
  // 32000 silently (D1/D2); ' 64000 ', '1e5', '0x10' and '64000.7' have never
  // been probed, so they are reported as unmeasured rather than as healthy.
  const ambientOk = (ambient !== undefined && /^\d+$/.test(ambient)) ? positiveCount(Number(ambient)) : null;
  const ambientBad = ambient !== undefined && ambientOk === null;
  const ambientBadText = `${OUTPUT_TOKEN_FLAG}=${ambient} in this environment is not a plain positive integer — the only form measured to be honoured (probe D1/D2: 64000abc and 0 fell back to ${ENGINE_DEFAULT_OUTPUT_TOKENS} silently); any other form is unmeasured`;
  const ambientHint = `unset ${OUTPUT_TOKEN_FLAG}, or set it to a plain positive integer`;

  if (raw === undefined) {
    if (ambient === undefined) { return row('ok', `not set — ${dflt}`); }
    return ambientBad
      ? row('warn', `not set — ${ambientBadText}`, ambientHint)
      : row('ok', `not set — ${OUTPUT_TOKEN_FLAG}=${ambient} in this environment sets the engine's OUTPUT_TOKEN_MAX to ${ambientOk} (its default is ${ENGINE_DEFAULT_OUTPUT_TOKENS}): each leg reserves min(${ambientOk}, the ceiling the engine's catalog knows for it), and ${ambientOk} as-is on a model it does not know`);
  }

  const budget = normalizeOutputBudget(raw);
  if (budget === null) {
    // A malformed budget sets no flag (engine-output-flag.js), so whatever is
    // ambient governs the spawn — the row has to say which value that leaves.
    const then = ambient === undefined ? dflt
      : (ambientBad ? `${dflt} (${ambientBadText})`
        : `${OUTPUT_TOKEN_FLAG}=${ambient} in this environment governs engines amicus starts (OUTPUT_TOKEN_MAX ${ambientOk}: each leg reserves min(${ambientOk}, the ceiling the engine's catalog knows for it))`);
    return row('warn', `${JSON.stringify(raw)} is not a positive integer — ignored; ${then}`,
      `set outputBudget to a positive integer in ${d.getConfigDir()}/config.json, or remove it`);
  }
  const overridden = ambient === undefined ? ''
    : `; ${OUTPUT_TOKEN_FLAG}=${ambient} in this environment is overridden by outputBudget for engines amicus starts`;
  const aboveDefault = budget > ENGINE_DEFAULT_OUTPUT_TOKENS;

  const cache = d.readCache();
  if (!cache || !Array.isArray(cache.models)) {
    // At or below the engine default the flag alone never raises what goes
    // out (K12), so a missing cache is informational; above it an unknown model
    // receives the budget as-is (J2/K13) and the cache is what would name a
    // ceiling — the same gate as the unclamped-routes case below.
    // Named mutant "NOCACHEALWAYSWARN": make this branch warn regardless.
    return row(aboveDefault ? 'warn' : 'ok',
      `budget ${budget} — each leg reserves min(${budget}, its ceiling where one is known); no catalog cache, so no route has a known ceiling here (the engine clamps routes its own catalog knows; an unknown model receives ${budget} as-is)${overridden}`,
      aboveDefault ? 'amicus models --refresh' : null);
  }

  const limits = buildLimitLookup(cache.models);
  const routes = [...new Set(d.collectAliasSources()
    .map((s) => s && s.model)
    .filter((m) => typeof m === 'string' && m.length > 0))];
  const unclamped = [];
  const starved = [];
  for (const id of routes) {
    const limit = computeModelLimit(limits.get(id), budget);
    if (!limit) { unclamped.push(id); continue; }
    if (limit.output * 2 >= limit.context) { starved.push(`${id} (${limit.output} of ${limit.context})`); }
  }

  let message = `budget ${budget} — each leg reserves min(${budget}, its ceiling where one is known); ${routes.length - unclamped.length} of ${routes.length} alias routes have a known catalog ceiling`;
  let status = 'ok';
  let hint = null;
  if (unclamped.length > 0) {
    message += `; ${unclamped.length} without one (${shortList(unclamped)}) — the engine clamps those its own catalog knows, an unknown model receives ${budget} as-is`;
    // At or below the default the flag never raises what the engine sends
    // (K12); above it an unknown model is the one place the number goes out
    // unclamped (J2/K13), so that is the only case worth a warning.
    if (aboveDefault) {
      status = 'warn';
      hint = 'amicus models --refresh  (a budget above the engine default reaches an unknown model unclamped)';
    }
  }
  if (starved.length > 0) {
    message += `; reserves at least half the context window of ${shortList(starved)}`;
    status = 'warn';
    // Starvation leads: a catalog refresh cannot fix it, lowering the budget can.
    hint = 'lower outputBudget — input plus the reservation must fit the context window' + (hint ? `; ${hint}` : '');
  }
  return row(status, message + overridden, hint);
}

module.exports = { evaluateOutputBudget };
