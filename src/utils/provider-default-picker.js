/**
 * Provider-default picker core (Part 2, Task 4).
 *
 * Builds the priced, tier-preselected choice list a vendor's model picker
 * (CLI/Electron/readline, later tasks) renders. This module is PURE and
 * transport-agnostic: the catalog is always injected by the caller, and it
 * never imports a renderer's formatting helper (e.g. Electron's `fmtPrice`)
 * -- `pricePerMInput` is returned as a raw number; each surface formats it.
 *
 * The one documented impurity: when `tier` is omitted, `getCostTier()` reads
 * the user's persisted config (Task 1). Callers that need full purity can
 * always pass `tier` explicitly to skip that read entirely.
 */

'use strict';

const { resolveTier } = require('./model-tiers');
const { getCostTier } = require('./config');
const { pairAcrossGateways } = require('./gateway-route-catalog');
const { toCanonicalDefault } = require('./curated-models');

/**
 * @param {{pricing?: {prompt?: string|number|null}|null}|null|undefined} orRow
 *   the OpenRouter-namespace catalog row paired to a logical model, if any.
 * @returns {number|null} `pricing.prompt * 1e6` ($/M input tokens), or null
 *   when there is no priced OpenRouter twin.
 */
function pricePerMInputFrom(orRow) {
  if (!orRow || !orRow.pricing || orRow.pricing.prompt === null || orRow.pricing.prompt === undefined) {
    return null;
  }
  const n = Number(orRow.pricing.prompt);
  return Number.isFinite(n) ? n * 1e6 : null;
}

/**
 * Every catalog row belonging to `vendor`, in either namespace (direct
 * `<vendor>/<model>` or OpenRouter `openrouter/<vendor>/<model>`).
 * @param {Array<{id:string}>} catalog
 * @param {string} vendor
 * @returns {Array<{id:string}>}
 */
function vendorRowsIn(catalog, vendor) {
  const directPrefix = `${vendor}/`;
  const orPrefix = `openrouter/${vendor}/`;
  return catalog.filter(r => r && typeof r.id === 'string' &&
    (r.id.startsWith(directPrefix) || r.id.startsWith(orPrefix)));
}

/**
 * Dedupe `vendor`'s catalog rows across gateways into one row per logical
 * model, reusing `pairAcrossGateways` (never re-deriving the pairing logic).
 * Ambiguous models pairAcrossGateways can't confidently resolve on EITHER
 * side are dropped -- omit rather than guess, same policy as the helper
 * itself.
 * @param {Array<{id:string,name:string,contextLength:(number|null)}>} catalog
 * @param {string} vendor
 * @returns {Array<{id:string,name:string,contextLength:(number|null),pricePerMInput:(number|null),isPreselected:boolean}>}
 */
function buildRows(catalog, vendor) {
  const byId = new Map(catalog.filter(r => r && typeof r.id === 'string').map(r => [r.id, r]));
  const catalogInfo = { models: catalog };
  const directPrefix = `${vendor}/`;
  const orPrefix = `openrouter/${vendor}/`;

  const rows = [];
  const seenIds = new Set();

  for (const row of vendorRowsIn(catalog, vendor)) {
    const isDirect = row.id.startsWith(directPrefix);
    const token = isDirect ? row.id.slice(directPrefix.length) : row.id.slice(orPrefix.length);
    const paired = pairAcrossGateways(vendor, token, catalogInfo);
    const chosenId = paired.direct || (paired.openrouter ? toCanonicalDefault(paired.openrouter) : null);
    if (!chosenId || seenIds.has(chosenId)) { continue; }
    seenIds.add(chosenId);

    const orRow = paired.openrouter ? byId.get(paired.openrouter) : null;
    const sourceRow = (paired.direct && byId.get(paired.direct)) || orRow || row;

    rows.push({
      id: chosenId,
      name: sourceRow.name,
      contextLength: (sourceRow.contextLength === undefined ? null : sourceRow.contextLength),
      pricePerMInput: pricePerMInputFrom(orRow),
      isPreselected: false,
    });
  }
  return rows;
}

/**
 * Decide which row (by id) should be preselected.
 * Primary: `resolveTier(vendor, tier, catalog)`, canonicalized the same way
 * row ids are (direct-first) so it can match a row exactly. Falls back to
 * the cheapest priced row, then the first row, whenever the primary result
 * is null OR (defensively) doesn't correspond to any built row.
 * @param {string} vendor
 * @param {string|undefined} tier
 * @param {Array<{id:string}>} catalog
 * @param {Array<{id:string,pricePerMInput:(number|null)}>} rows non-empty
 * @returns {string} a row id from `rows`
 */
function computePreselectedId(vendor, tier, catalog, rows) {
  const effectiveTier = tier || getCostTier();
  const resolved = resolveTier(vendor, effectiveTier, catalog);
  const canonical = resolved ? toCanonicalDefault(resolved) : null;
  if (canonical && rows.some(r => r.id === canonical)) { return canonical; }

  const priced = rows.filter(r => r.pricePerMInput !== null);
  if (priced.length > 0) {
    return priced.reduce((cheapest, r) => (r.pricePerMInput < cheapest.pricePerMInput ? r : cheapest)).id;
  }
  return rows[0].id;
}

/** Preselected first; then price ascending; null prices last. Stable otherwise. */
function compareRows(a, b) {
  if (a.isPreselected !== b.isPreselected) { return a.isPreselected ? -1 : 1; }
  if (a.pricePerMInput === null && b.pricePerMInput === null) { return 0; }
  if (a.pricePerMInput === null) { return 1; }
  if (b.pricePerMInput === null) { return -1; }
  return a.pricePerMInput - b.pricePerMInput;
}

/**
 * Build the choice list for a vendor's model picker.
 * @param {string} vendor e.g. 'anthropic'
 * @param {{catalog?: Array<{id:string,name:string,contextLength:(number|null),pricing:(object|null)}>, tier?: string}} [options]
 * @returns {{preselectedId: (string|null), rows: Array<{id:string,name:string,contextLength:(number|null),pricePerMInput:(number|null),isPreselected:boolean}>}}
 */
function buildProviderDefaultChoices(vendor, options = {}) {
  if (typeof vendor !== 'string' || !vendor) { return { preselectedId: null, rows: [] }; }

  const catalog = Array.isArray(options.catalog) ? options.catalog : [];
  const rows = buildRows(catalog, vendor);
  if (rows.length === 0) { return { preselectedId: null, rows: [] }; }

  const preselectedId = computePreselectedId(vendor, options.tier, catalog, rows);
  for (const r of rows) { r.isPreselected = r.id === preselectedId; }
  rows.sort(compareRows);

  return { preselectedId, rows };
}

module.exports = { buildProviderDefaultChoices };
