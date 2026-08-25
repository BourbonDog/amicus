/**
 * Vendor model shortlist (#138) -- the family -> model second level.
 *
 * Turns a vendor's deduped, priced picker rows into a
 * `{suggested, rest}` split so a surface can show a short list without
 * hiding anything: the GUI renders both groups in one <select>, readline
 * prints `suggested` and offers `a` to print `rest` too.
 *
 * PURE and transport-agnostic, exactly like `provider-default-picker.js`:
 * the catalog is always injected, and nothing here formats for a renderer.
 *
 * Why the caller supplies `recommendedId`: the picker's own preselect is
 * COST-TIER driven (`computePreselectedId`), which disagrees with the
 * wizard card's family flagship -- for DeepSeek, `v3.2` vs `v4-pro`.
 * Owner ruling (#138, 2026-08-24) is that the flagship wins, so that
 * opening the drill-down and accepting is a guaranteed no-op. The tier
 * preselect remains the fallback when the flagship matches no row.
 */

'use strict';

const { buildProviderDefaultChoices } = require('./provider-default-picker');
const { pairAcrossGateways } = require('./gateway-route-catalog');

/** Rows shown before the "all models" group. */
const SHORTLIST_LIMIT = 8;

/**
 * Both gateway spellings of a row id, so a surface can honour an explicit
 * "via OpenRouter" choice for a drilled-down model. NEVER derives one form
 * from the other -- `pairAcrossGateways` reads real catalog rows, which is
 * the only safe move for DIVERGENT_VENDORS (anthropic's direct and
 * OpenRouter ids are different strings, not differently prefixed).
 * @param {string} vendor
 * @param {string} id verbatim picker row id
 * @param {Array<{id:string}>} catalog
 * @returns {{directId: (string|null), openrouterId: (string|null)}}
 */
function routeFormsFor(vendor, id, catalog) {
  const token = id.replace(/^openrouter\//, '').replace(`${vendor}/`, '');
  const paired = pairAcrossGateways(vendor, token, { models: catalog });
  return {
    directId: paired.direct || null,
    openrouterId: paired.openrouter || null,
  };
}

/**
 * Recommended-first, then price-ascending, nulls last -- the same order
 * `provider-default-picker.js`'s `compareRows` already establishes, so the
 * drill-down reads like the picker the user may already have seen.
 */
function compareShortlistRows(a, b) {
  if (a.isRecommended !== b.isRecommended) { return a.isRecommended ? -1 : 1; }
  if (a.pricePerMInput === null && b.pricePerMInput === null) { return 0; }
  if (a.pricePerMInput === null) { return 1; }
  if (b.pricePerMInput === null) { return -1; }
  return a.pricePerMInput - b.pricePerMInput;
}

/**
 * @param {string} vendor e.g. 'deepseek'
 * @param {{catalog?: Array<object>, recommendedId?: string, limit?: number}} [options]
 * @returns {{recommendedId: (string|null), suggested: Array<object>,
 *   rest: Array<object>, total: number}}
 */
function buildModelShortlist(vendor, options = {}) {
  const catalog = Array.isArray(options.catalog) ? options.catalog : [];
  const limit = Number.isInteger(options.limit) && options.limit > 0
    ? options.limit : SHORTLIST_LIMIT;

  const { preselectedId, rows } = buildProviderDefaultChoices(vendor, { catalog });
  if (!rows || rows.length === 0) {
    return { recommendedId: null, suggested: [], rest: [], total: 0 };
  }

  // Owner ruling: the family flagship wins when it names a real row;
  // otherwise keep the picker's tier preselect rather than inventing one.
  const wanted = options.recommendedId;
  const recommendedId = (wanted && rows.some(r => r.id === wanted)) ? wanted : preselectedId;

  const annotated = rows.map(r => Object.assign({
    id: r.id,
    name: r.name,
    contextLength: r.contextLength,
    pricePerMInput: r.pricePerMInput,
    isRecommended: r.id === recommendedId,
  }, routeFormsFor(vendor, r.id, catalog)));

  annotated.sort(compareShortlistRows);

  return {
    recommendedId,
    suggested: annotated.slice(0, limit),
    rest: annotated.slice(limit),
    total: annotated.length,
  };
}

module.exports = { buildModelShortlist, compareShortlistRows, SHORTLIST_LIMIT };
