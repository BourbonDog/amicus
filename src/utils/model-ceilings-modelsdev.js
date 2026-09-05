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
 *     flags on the row objects ride through untouched;
 *   - the FETCH ITSELF is skipped when no candidate row is missing a ceiling,
 *     and `model-catalog.js` skips this module entirely when the config key
 *     `modelsDevCeilings` is `false` (council #230 D1/C2): a refresh that has
 *     nothing to fill must not spend up to 10 s asking.
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
 * Why this row is not a fill candidate, or null when it is one. THE single
 * definition: `fillCeilings` counts each class and `needsFillCount` collapses
 * them to a boolean, so the pass and the nothing-to-fill check cannot disagree
 * about which rows the fetch could serve.
 * @param {*} row a catalog row
 * @returns {null|'malformed'|'local'|'router'}
 */
function skipClass(row) {
  if (!row || typeof row !== 'object' || typeof row.id !== 'string') { return 'malformed'; }
  if (row.local === true) { return 'local'; }
  if (row.id.startsWith('openrouter/openrouter/')) { return 'router'; }
  return null;
}

/**
 * Does this row still lack a number outputBudget needs? computeModelLimit
 * refuses to emit a descriptor unless BOTH ceilings are known, so one usable
 * field is not "known" for any purpose the fill exists to serve.
 * @param {object} row a catalog row
 * @returns {boolean}
 */
function missingACeiling(row) {
  return positiveCount(row.contextLength) === null || positiveCount(row.maxOutputTokens) === null;
}

/**
 * Fill contextLength / maxOutputTokens in place. A field is filled ONLY when the
 * provider gave no usable positive integer for it — `positiveCount(...) === null`,
 * i.e. null, 0, negative, below 1 or non-numeric. (`positiveCount` FLOORS, so
 * 1.5 is a usable 1; only a fraction below 1 falls through.) A usable provider
 * value is never overwritten. A filled row is stamped `limitSource: 'models.dev'`,
 * which marks a row where AT LEAST ONE field was filled from models.dev — not a
 * claim that both numbers came from there (council #230 D2).
 *
 * COUNTERS. `filled` / `alreadyKnown` / `unknown` describe what the pass did;
 * `stillMissing` describes the STATE it left behind and deliberately overlaps
 * them. `alreadyKnown` means both fields were usable BEFORE the pass — a row
 * with one field known and the other unfillable is `stillMissing`, never
 * "already known" (council #230 C1/D5): outputBudget cannot clamp it.
 * @param {Array<object>} rows catalog rows (mutated)
 * @param {Map<string, {context: number|null, output: number|null}>} limits
 * @returns {{filled: number, alreadyKnown: number, unknown: number, stillMissing: number,
 *   skippedRouters: number, skippedLocal: number}}
 */
function fillCeilings(rows, limits) {
  const counts = { filled: 0, alreadyKnown: 0, unknown: 0, stillMissing: 0, skippedRouters: 0, skippedLocal: 0 };
  for (const row of Array.isArray(rows) ? rows : []) {
    const skip = skipClass(row);
    if (skip === 'malformed') { continue; }
    if (skip === 'local') { counts.skippedLocal++; continue; }
    if (skip === 'router') { counts.skippedRouters++; continue; }
    const knownBefore = !missingACeiling(row);
    const lim = limits.get(row.id);
    if (!lim) {
      counts.unknown++;
    } else {
      let touched = false;
      if (positiveCount(row.contextLength) === null && lim.context !== null) { row.contextLength = lim.context; touched = true; }
      if (positiveCount(row.maxOutputTokens) === null && lim.output !== null) { row.maxOutputTokens = lim.output; touched = true; }
      if (touched) { row.limitSource = 'models.dev'; counts.filled++; } else if (knownBefore) { counts.alreadyKnown++; }
    }
    if (missingACeiling(row)) { counts.stillMissing++; }
  }
  return counts;
}

/**
 * How many candidate rows the fetch could possibly help. Zero means the network
 * call has nothing to do and is skipped entirely (council #230 D1/C2).
 * @param {Array<object>} rows catalog rows
 * @returns {number}
 */
function needsFillCount(rows) {
  let n = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    if (skipClass(row) === null && missingACeiling(row)) { n++; }
  }
  return n;
}

/**
 * The outcome a FAILED — or SKIPPED — enrichment persists: the failure plus
 * every counter at zero. One shape, so this module's own failure returns and
 * `model-catalog.js :: refreshCatalog`'s belt-and-braces catch cannot drift
 * apart and `models-ceiling-line.js :: fmtCeilingLine` always has the counters
 * it prints. `skipped` defaults to null and a caller that skipped the fetch
 * spreads its own reason over it.
 * @param {null|{reason: string, status?: number, detail?: string}} failure
 * @returns {{source: 'models.dev', failure: object|null, skipped: null, filled: number,
 *   alreadyKnown: number, unknown: number, stillMissing: number, skippedRouters: number,
 *   skippedLocal: number}}
 */
function emptyOutcome(failure) {
  return {
    source: 'models.dev', failure, skipped: null,
    filled: 0, alreadyKnown: 0, unknown: 0, stillMissing: 0, skippedRouters: 0, skippedLocal: 0,
  };
}

/**
 * Fetch models.dev and fill `rows`. ALWAYS resolves; the outcome travels with
 * the rows it describes (model-catalog.js persists it as ceilingEnrichment).
 * Failure reasons are http-get's (`timeout`, `network-error`, `http-status`,
 * `too-large`, `parse-error`) plus `bad-shape` and `exception`.
 *
 * NO CALL IS MADE when no candidate row is missing a ceiling: the outcome is
 * `skipped: 'nothing-to-fill'` and models.dev is never contacted (council #230
 * D1/C2 — a refresh on a fully-known catalog paid up to 10 s for nothing).
 * @param {Array<object>} rows catalog rows (mutated in place)
 * @param {{getJson?: Function}} [deps] test seam
 * @returns {Promise<{source: 'models.dev', failure: null|{reason: string, status?: number, detail?: string},
 *   skipped: null|'nothing-to-fill', filled: number, alreadyKnown: number, unknown: number,
 *   stillMissing: number, skippedRouters: number, skippedLocal: number}>}
 */
async function enrichCeilings(rows, deps = {}) {
  const getJson = deps.getJson || require('./http-get').getJson;
  if (needsFillCount(rows) === 0) {
    return { ...emptyOutcome(null), skipped: 'nothing-to-fill' };
  }
  let res;
  try {
    res = await getJson(MODELS_DEV_URL, {
      timeoutMs: MODELS_DEV_TIMEOUT_MS,
      followRedirects: true,
      headers: { 'User-Agent': `amicus/${require('../../package.json').version}` },
    });
  } catch (err) {
    return emptyOutcome({ reason: 'exception', detail: err.message });
  }
  if (!res || !res.ok) {
    return emptyOutcome((res && res.failure) || { reason: 'exception', detail: 'no result' });
  }
  const limits = limitsFromModelsDev(res.json);
  // A 200 that parses but carries no recognised vendor limits — `{}`, an error
  // object, a reshaped api.json — would otherwise persist as a SUCCESSFUL
  // enrichment with every row `unknown`, silently leaving direct-provider
  // ceilings unfilled and outputBudget unable to clamp them (council #230 C1).
  // It is a failure, and the rows are not touched.
  if (limits.size === 0) {
    return emptyOutcome({ reason: 'bad-shape', detail: 'no recognised vendor limits in api.json' });
  }
  return { source: 'models.dev', failure: null, skipped: null, ...fillCeilings(rows, limits) };
}

module.exports = {
  MODELS_DEV_URL, MODELS_DEV_TIMEOUT_MS,
  limitsFromModelsDev, fillCeilings, needsFillCount, enrichCeilings, emptyOutcome,
};
