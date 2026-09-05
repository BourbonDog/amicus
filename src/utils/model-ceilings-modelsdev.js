/**
 * @module model-ceilings-modelsdev
 * #218 P3 — output ceilings for the direct-provider catalog rows.
 *
 * WHY: computeModelLimit (model-output-limit.js) refuses to emit a `limit`
 * descriptor unless the catalog knows BOTH a model's context and its output
 * ceiling — a blanket budget against an unknown ceiling would send an
 * over-ceiling max_tokens. OpenRouter publishes its ceiling on /models; the
 * direct openai/anthropic/deepseek lists do not (google's does, lifted
 * first-party in model-fetcher.js). models.dev publishes all of them, keyless.
 *
 * WHAT THIS DOES NOT CHANGE: the engine already resolves every `{}` descriptor's
 * limit from its own models.dev copy. This gives AMICUS the same numbers so it
 * can clamp an outputBudget on direct routes and name a reservation in a
 * dead-leg note. It reads models.dev directly, not the engine's cache file,
 * because that file's path and refresh flags are engine-private.
 *
 * RULES (measured 2026-09-04 against live data, see the plan):
 *   - the provider's own value WINS: models.dev fills a field only when the
 *     provider gave no usable positive integer — null, 0, negative or malformed
 *     — and a usable provider value is never overwritten (OpenRouter and
 *     models.dev disagree on 24 of 344 openrouter ceilings);
 *   - a zero/absent models.dev limit is never written (openai image rows);
 *   - `openrouter/openrouter/*` meta-routers are skipped (models.dev says
 *     2,000,000 for `auto`, a number no underlying model honours);
 *   - local rows are skipped; the fill is IN PLACE so `authoritative`/`local`
 *     flags on the row objects ride through untouched.
 */
'use strict';

const { positiveCount } = require('./model-output-limit');

const MODELS_DEV_URL = 'https://models.dev/api.json';
const MODELS_DEV_TIMEOUT_MS = 10000;
/** The vendors amicus catalogs under these exact id prefixes (model-fetcher.js normalizers). */
const VENDORS = ['anthropic', 'openai', 'google', 'deepseek', 'openrouter'];

/**
 * Index a models.dev api.json document by amicus catalog id. A positive
 * finite integer count, or null — reuses `positiveCount` from
 * model-output-limit.js so this module holds the same discipline as that one.
 * @param {*} api parsed https://models.dev/api.json
 * @returns {Map<string, {context: number|null, output: number|null}>}
 */
function limitsFromModelsDev(api) {
  const out = new Map();
  if (!api || typeof api !== 'object') { return out; }
  for (const vendor of VENDORS) {
    const models = api[vendor] && api[vendor].models;
    if (!models || typeof models !== 'object') { continue; }
    for (const [modelId, m] of Object.entries(models)) {
      const limit = (m && typeof m === 'object' && m.limit) || {};
      const context = positiveCount(limit.context);
      const output = positiveCount(limit.output);
      if (context === null && output === null) { continue; }
      out.set(`${vendor}/${modelId}`, { context, output });
    }
  }
  return out;
}

/**
 * Fill contextLength / maxOutputTokens in place. A field is filled ONLY when the
 * provider gave no usable positive integer for it — `positiveCount(...) === null`,
 * i.e. null, 0, negative, fractional or non-numeric. A usable provider value is
 * never overwritten.
 * @param {Array<object>} rows catalog rows (mutated)
 * @param {Map<string, {context: number|null, output: number|null}>} limits
 * @returns {{filled: number, alreadyKnown: number, unknown: number, skippedRouters: number, skippedLocal: number}}
 */
function fillCeilings(rows, limits) {
  const counts = { filled: 0, alreadyKnown: 0, unknown: 0, skippedRouters: 0, skippedLocal: 0 };
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== 'object' || typeof row.id !== 'string') { continue; }
    if (row.local === true) { counts.skippedLocal++; continue; }
    if (row.id.startsWith('openrouter/openrouter/')) { counts.skippedRouters++; continue; }
    const lim = limits.get(row.id);
    if (!lim) { counts.unknown++; continue; }
    let touched = false;
    if (positiveCount(row.contextLength) === null && lim.context !== null) { row.contextLength = lim.context; touched = true; }
    if (positiveCount(row.maxOutputTokens) === null && lim.output !== null) { row.maxOutputTokens = lim.output; touched = true; }
    if (touched) { row.limitSource = 'models.dev'; counts.filled++; } else { counts.alreadyKnown++; }
  }
  return counts;
}

/**
 * The outcome a FAILED enrichment persists: the failure plus every counter at
 * zero. One shape, so this module's own failure returns and `model-catalog.js ::
 * refreshCatalog`'s belt-and-braces catch cannot drift apart and
 * `models.js :: fmtCeilingLine` always has the counters it prints.
 * @param {{reason: string, status?: number, detail?: string}} failure
 * @returns {{source: 'models.dev', failure: object, filled: number, alreadyKnown: number,
 *   unknown: number, skippedRouters: number, skippedLocal: number}}
 */
function emptyOutcome(failure) {
  return { source: 'models.dev', failure, filled: 0, alreadyKnown: 0, unknown: 0, skippedRouters: 0, skippedLocal: 0 };
}

/**
 * Fetch models.dev and fill `rows`. ALWAYS resolves; the outcome travels with
 * the rows it describes (model-catalog.js persists it as ceilingEnrichment).
 * @param {Array<object>} rows catalog rows (mutated in place)
 * @param {{getJson?: Function}} [deps] test seam
 * @returns {Promise<{source: 'models.dev', failure: null|{reason: string, status?: number, detail?: string},
 *   filled: number, alreadyKnown: number, unknown: number, skippedRouters: number, skippedLocal: number}>}
 */
async function enrichCeilings(rows, deps = {}) {
  const getJson = deps.getJson || require('./http-get').getJson;
  let res;
  try {
    res = await getJson(MODELS_DEV_URL, {
      timeoutMs: MODELS_DEV_TIMEOUT_MS,
      headers: { 'User-Agent': `amicus/${require('../../package.json').version}` },
    });
  } catch (err) {
    return emptyOutcome({ reason: 'exception', detail: err.message });
  }
  if (!res || !res.ok) {
    return emptyOutcome((res && res.failure) || { reason: 'exception', detail: 'no result' });
  }
  return { source: 'models.dev', failure: null, ...fillCeilings(rows, limitsFromModelsDev(res.json)) };
}

module.exports = { MODELS_DEV_URL, MODELS_DEV_TIMEOUT_MS, limitsFromModelsDev, fillCeilings, enrichCeilings, emptyOutcome };
